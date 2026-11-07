package de.trisar.dispo.planung

import android.graphics.Color as AColor
import android.os.Bundle
import android.view.Gravity
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import de.trisar.kern.Konfig
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import org.maplibre.android.MapLibre
import org.maplibre.android.camera.CameraPosition
import org.maplibre.android.camera.CameraUpdateFactory
import org.maplibre.android.geometry.LatLng
import org.maplibre.android.geometry.LatLngBounds
import org.maplibre.android.maps.MapLibreMap
import org.maplibre.android.maps.MapView
import org.maplibre.android.maps.Style
import org.maplibre.android.style.layers.LineLayer
import org.maplibre.android.style.layers.Property
import org.maplibre.android.style.layers.PropertyFactory
import org.maplibre.android.style.sources.GeoJsonSource
import org.maplibre.geojson.Feature
import org.maplibre.geojson.FeatureCollection
import org.maplibre.geojson.LineString
import org.maplibre.geojson.Point
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import kotlin.math.asin
import kotlin.math.cos
import kotlin.math.pow
import kotlin.math.sin
import kotlin.math.sqrt

/** Koordinate (lat, lng). */
internal data class GeoPunkt(val lat: Double, val lng: Double)

/** Meter zwischen zwei Punkten (Haversine). */
internal fun meterZwischen(a: GeoPunkt, b: GeoPunkt): Double {
    fun rad(g: Double) = g * Math.PI / 180
    val dLat = rad(b.lat - a.lat)
    val dLng = rad(b.lng - a.lng)
    val h = sin(dLat / 2).pow(2) + cos(rad(a.lat)) * cos(rad(b.lat)) * sin(dLng / 2).pow(2)
    return 2 * 6_371_000 * asin(sqrt(h))
}

/**
 * Adressen und Strecken wie Routen.swift (shared/karte/maplibreKarte.js):
 * Adresse -> Koordinate ueber Nominatim, Strecke ueber den oeffentlichen OSRM-Dienst.
 * Beides wird auf dem Geraet gemerkt, damit nicht jede Ansicht neu anfragt.
 */
internal object PlanRouten {
    data class Strecke(val punkte: List<GeoPunkt>, val sekunden: Int, val meter: Int, val notloesung: Boolean = false)

    private const val OSRM = "https://router.project-osrm.org/route/v1/driving/"
    private const val ORT_SCHLUESSEL = "trisar-orte"
    private const val STRECKEN_SCHLUESSEL = "trisar-routen-v1"
    private var orte: MutableMap<String, GeoPunkt>? = null
    private var strecken: LinkedHashMap<String, Strecke>? = null
    private val laufend = mutableMapOf<String, Deferred<GeoPunkt?>>()

    private fun orteLaden(): MutableMap<String, GeoPunkt> = orte ?: run {
        val m = mutableMapOf<String, GeoPunkt>()
        PlanAblage.text(ORT_SCHLUESSEL)?.let { t ->
            runCatching {
                (planJson.parseToJsonElement(t) as JsonObject).forEach { (k, v) ->
                    val a = v.alsListe() ?: return@forEach
                    if (a.size == 2) m[k] = GeoPunkt(a[0].planZahl ?: return@forEach, a[1].planZahl ?: return@forEach)
                }
            }
        }
        m.also { orte = it }
    }

    private fun streckenLaden(): LinkedHashMap<String, Strecke> = strecken ?: run {
        val m = LinkedHashMap<String, Strecke>()
        PlanAblage.text(STRECKEN_SCHLUESSEL)?.let { t ->
            runCatching {
                (planJson.parseToJsonElement(t) as JsonObject).forEach { (k, v) ->
                    val o = v.alsObjekt() ?: return@forEach
                    val pts = (o["k"].alsListe() ?: return@forEach).mapNotNull { p ->
                        val a = p.alsListe() ?: return@mapNotNull null
                        GeoPunkt(a[1].planZahl ?: return@mapNotNull null, a[0].planZahl ?: return@mapNotNull null)
                    }
                    if (pts.size >= 2) m[k] = Strecke(pts, (o["s"].planZahl ?: 0.0).toInt(), (o["m"].planZahl ?: 0.0).toInt())
                }
            }
        }
        m.also { strecken = it }
    }

    private fun lesen(url: String): Pair<Int, String>? = runCatching {
        val v = URL(url).openConnection() as HttpURLConnection
        try {
            v.connectTimeout = 20_000
            v.readTimeout = 30_000
            v.setRequestProperty("Accept", "application/json")
            // Nominatim verlangt eine Kennung der App.
            v.setRequestProperty("User-Agent", "TRISAR-Dispo-Android/0.1")
            val status = v.responseCode
            status to (if (status in 200..299) v.inputStream else (v.errorStream ?: v.inputStream)).bufferedReader().use { it.readText() }
        } finally {
            v.disconnect()
        }
    }.getOrNull()

    suspend fun punkt(text: String): GeoPunkt? {
        val schluessel = text.trim().lowercase().replace(Regex("\\s+"), " ")
        if (schluessel.isEmpty()) return null
        val gemerkt = orteLaden()
        gemerkt[schluessel]?.let { return it }
        if (de.trisar.kern.Routen.fehltrefferAktiv(schluessel)) return null
        laufend[schluessel]?.let { return it.await() }
        val lauf = planLauf.async {
            withContext(Dispatchers.IO) {
                // Erst der ganze Text, dann ohne das erste Stueck (Ortsname vorne).
                de.trisar.kern.Routen.suchTexte(text).firstNotNullOfOrNull { suche ->
                    val url = "https://nominatim.openstreetmap.org/search?format=json&limit=1&q=" + URLEncoder.encode(suche, "UTF-8")
                    val (status, inhalt) = lesen(url) ?: return@firstNotNullOfOrNull null
                    if (status != 200) return@firstNotNullOfOrNull null
                    val erster = runCatching { (planJson.parseToJsonElement(inhalt) as JsonArray).firstOrNull() as? JsonObject }.getOrNull()
                        ?: return@firstNotNullOfOrNull null
                    val lat = erster.text("lat").toDoubleOrNull() ?: return@firstNotNullOfOrNull null
                    val lng = erster.text("lon").toDoubleOrNull() ?: return@firstNotNullOfOrNull null
                    GeoPunkt(lat, lng)
                }
            }
        }
        laufend[schluessel] = lauf
        val ergebnis = lauf.await()
        laufend.remove(schluessel)
        de.trisar.kern.Routen.fehltrefferMerken(schluessel, ergebnis != null)
        if (ergebnis != null) {
            gemerkt[schluessel] = ergebnis
            PlanAblage.setzen(ORT_SCHLUESSEL, JsonObject(gemerkt.mapValues { JsonArray(listOf(JsonPrimitive(it.value.lat), JsonPrimitive(it.value.lng))) }).toString())
        }
        return ergebnis
    }

    suspend fun strecke(von: GeoPunkt, bis: GeoPunkt): Strecke {
        val adresse = "$OSRM${von.lng},${von.lat};${bis.lng},${bis.lat}?overview=full&geometries=geojson&alternatives=false&steps=false"
        val gemerkt = streckenLaden()
        gemerkt[adresse]?.let { return it }
        val neu = withContext(Dispatchers.IO) {
            val (status, inhalt) = lesen(adresse) ?: return@withContext null
            if (status != 200) return@withContext null
            val route = runCatching { ((planJson.parseToJsonElement(inhalt) as JsonObject)["routes"].alsListe())?.firstOrNull().alsObjekt() }.getOrNull()
                ?: return@withContext null
            val k = route["geometry"].alsObjekt()?.get("coordinates").alsListe() ?: return@withContext null
            val pts = k.mapNotNull { p -> p.alsListe()?.let { a -> GeoPunkt(a[1].planZahl ?: 0.0, a[0].planZahl ?: 0.0) } }
            if (pts.size < 2) return@withContext null
            Strecke(pts, rund(route["duration"].planZahl ?: 0.0).toInt(), rund(route["distance"].planZahl ?: 0.0).toInt())
        }
        if (neu != null) {
            gemerkt[adresse] = neu
            if (gemerkt.size > 250) gemerkt.remove(gemerkt.keys.first())
            PlanAblage.setzen(STRECKEN_SCHLUESSEL, JsonObject(gemerkt.mapValues { (_, s) ->
                JsonObject(mapOf(
                    "k" to JsonArray(s.punkte.map { JsonArray(listOf(JsonPrimitive(it.lng), JsonPrimitive(it.lat))) }),
                    "s" to JsonPrimitive(s.sekunden), "m" to JsonPrimitive(s.meter),
                ))
            }).toString())
            return neu
        }
        // Luftlinie, 45 km/h Schnitt (80 s je km) wie im Web.
        val meter = meterZwischen(von, bis)
        return Strecke(listOf(von, bis), ((meter / 1000) * 80).toInt(), meter.toInt(), notloesung = true)
    }
}

/**
 * Halter einer MapLibre-Karte (CARTO Dark Matter wie DispoKarte.stil in iOS). Linien als GeoJSON-Ebenen,
 * Pins zeichnet die Seite selbst in Compose ueber der Karte (Lage ueber `bildschirm`).
 */
internal class PlanKarteHalter {
    var karte: MapLibreMap? = null
        private set
    var stil: Style? = null
        private set
    /** Zaehlt bei jeder Kamerabewegung hoch, damit Pins in Compose mitwandern. */
    var bewegt by mutableIntStateOf(0)
        private set
    var bereit by mutableStateOf(false)
        private set
    /** Pixel je Rastereinheit (fuer Raender und Lage der Pins). */
    var dichte = 1f

    fun einrichten(k: MapLibreMap, s: Style) {
        karte = k
        stil = s
        k.addOnCameraMoveListener { bewegt += 1 }
        bereit = true
        bewegt += 1
    }

    /** Lage eines Ortes im Raster (x, y) oder null. */
    fun bildschirm(p: GeoPunkt): Offset? {
        val k = karte ?: return null
        val px = k.projection.toScreenLocation(LatLng(p.lat, p.lng))
        return Offset(px.x / dichte, px.y / dichte)
    }

    fun ort(x: Float, y: Float): GeoPunkt? {
        val k = karte ?: return null
        val ll = k.projection.fromScreenLocation(android.graphics.PointF(x * dichte, y * dichte))
        return GeoPunkt(ll.latitude, ll.longitude)
    }

    /** Linien setzen (Quelle und Ebene werden beim ersten Mal angelegt). */
    fun linie(kennung: String, pfade: List<List<GeoPunkt>>, farbe: Color, breite: Float, strich: Array<Float>? = null, deckung: Float = 1f, rund: Boolean = true) {
        val s = stil ?: return
        // Linien ohne zwei Punkte fuehren in MapLibre zu Fehlern.
        val formen = FeatureCollection.fromFeatures(
            pfade.filter { it.size >= 2 }.map { pfad -> Feature.fromGeometry(LineString.fromLngLats(pfad.map { Point.fromLngLat(it.lng, it.lat) })) }
        )
        val quelle = s.getSourceAs<GeoJsonSource>(kennung)
        if (quelle != null) { quelle.setGeoJson(formen); return }
        s.addSource(GeoJsonSource(kennung, formen))
        val ebene = LineLayer(kennung, kennung).withProperties(
            PropertyFactory.lineColor(farbe.toArgb()),
            PropertyFactory.lineWidth(breite),
            PropertyFactory.lineOpacity(deckung),
            PropertyFactory.lineCap(if (rund) Property.LINE_CAP_ROUND else Property.LINE_CAP_BUTT),
            PropertyFactory.lineJoin(Property.LINE_JOIN_ROUND),
        )
        if (strich != null) ebene.setProperties(PropertyFactory.lineDasharray(strich))
        s.addLayer(ebene)
    }

    /** Auf Orte einpassen, Raender im Raster (oben, links, unten, rechts). */
    fun einpassen(orte: List<GeoPunkt>, oben: Float, links: Float, unten: Float, rechts: Float, dauerMs: Int = 1400): Boolean {
        val k = karte ?: return false
        if (orte.isEmpty()) return false
        val d = dichte
        val update = if (orte.distinct().size < 2) {
            CameraUpdateFactory.newLatLngZoom(LatLng(orte[0].lat, orte[0].lng), 14.0)
        } else {
            val b = LatLngBounds.Builder().includes(orte.map { LatLng(it.lat, it.lng) }).build()
            CameraUpdateFactory.newLatLngBounds(b, (links * d).toInt(), (oben * d).toInt(), (rechts * d).toInt(), (unten * d).toInt())
        }
        return runCatching { k.animateCamera(update, dauerMs); true }.getOrDefault(false)
    }
}

/**
 * Karte als Compose-Flaeche. `bereit` kommt einmal, wenn der Stil geladen ist.
 * Lebenszyklus der MapView haengt am Lifecycle der Seite.
 */
@Composable
internal fun PlanKarteFlaeche(halter: PlanKarteHalter, modifier: Modifier, zoom: Double, drehen: Boolean = true, tippen: ((Offset) -> Unit)? = null) {
    val ctx = LocalContext.current
    val dichte = LocalDensity.current.density
    halter.dichte = dichte
    val ansicht = remember {
        MapLibre.getInstance(ctx)
        MapView(ctx).apply {
            onCreate(Bundle())
            setBackgroundColor(AColor.rgb(14, 14, 14))
            getMapAsync { k ->
                k.uiSettings.isLogoEnabled = false
                k.uiSettings.isCompassEnabled = false
                k.uiSettings.isAttributionEnabled = true
                k.uiSettings.setAttributionGravity(Gravity.BOTTOM or Gravity.END)
                if (!drehen) {
                    k.uiSettings.isRotateGesturesEnabled = false
                    k.uiSettings.isTiltGesturesEnabled = false
                }
                k.cameraPosition = CameraPosition.Builder().target(LatLng(48.137154, 11.576124)).zoom(zoom).build()
                if (tippen != null) {
                    k.addOnMapClickListener { ll ->
                        val p = k.projection.toScreenLocation(ll)
                        tippen(Offset(p.x / halter.dichte, p.y / halter.dichte))
                        true
                    }
                }
                k.setStyle(Style.Builder().fromUri(Konfig.KARTEN_STIL)) { s -> halter.einrichten(k, s) }
            }
        }
    }
    val besitzer = LocalLifecycleOwner.current
    DisposableEffect(besitzer) {
        val beobachter = LifecycleEventObserver { _, e ->
            when (e) {
                Lifecycle.Event.ON_START -> ansicht.onStart()
                Lifecycle.Event.ON_RESUME -> ansicht.onResume()
                Lifecycle.Event.ON_PAUSE -> ansicht.onPause()
                Lifecycle.Event.ON_STOP -> ansicht.onStop()
                else -> {}
            }
        }
        besitzer.lifecycle.addObserver(beobachter)
        if (besitzer.lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)) ansicht.onStart()
        if (besitzer.lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED)) ansicht.onResume()
        onDispose {
            besitzer.lifecycle.removeObserver(beobachter)
            ansicht.onPause()
            ansicht.onStop()
            ansicht.onDestroy()
        }
    }
    AndroidView(factory = { ansicht }, modifier = modifier)
}
