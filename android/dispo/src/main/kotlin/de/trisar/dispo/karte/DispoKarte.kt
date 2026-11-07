package de.trisar.dispo.karte

import android.content.Context
import android.view.Gravity
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.wrapContentSize
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.layout.layout
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.zIndex
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import de.trisar.kern.Icon
import de.trisar.kern.Konfig
import de.trisar.kern.Ort
import de.trisar.kern.grotesk
import de.trisar.kern.hex
import de.trisar.kern.tippen
import org.maplibre.android.MapLibre
import org.maplibre.android.camera.CameraPosition
import org.maplibre.android.camera.CameraUpdateFactory
import org.maplibre.android.geometry.LatLng
import org.maplibre.android.geometry.LatLngBounds
import org.maplibre.android.maps.MapLibreMap
import org.maplibre.android.maps.MapView
import org.maplibre.android.maps.Style
import org.maplibre.android.style.layers.LineLayer
import org.maplibre.android.style.layers.PropertyFactory
import org.maplibre.android.style.sources.GeoJsonSource
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/** Was die Kartenflaeche von der Seite bekommt (wie die Eigenschaften von DispoKarte in iOS). */
internal data class KartenStand(
    val fahrer: List<KartenFahrer> = emptyList(),
    val gewaehlt: KartenFahrer? = null,
    val route: KartenRoutenBild? = null,
    /** Hoehe des Blatts im Raster (0 ohne Auswahl), fuer die Polsterung beim Einpassen. */
    val blattHoehe: Float = 0f,
    val rasterHoehe: Float = 874f,
    /** Erhoeht sich beim Tipp auf "Karte" in der Leiste: alle Fahrer einpassen. */
    val einpassenSignal: Int = 0,
    /** Eigene Orte als Icon-Marker, der gewaehlte zeigt seine beiden Kreise. */
    val orte: List<Ort> = emptyList(),
    val ortGewaehlt: String? = null,
)

/**
 * Kartenflaeche der Dispo (GoogleMapSurface in KartenView.jsx, DispoKarte.swift) mit MapLibre und
 * CARTO Dark Matter wie im Web: Fahrer-Pins mit Nummer in der Zustandsfarbe (Zuendung aus = blasses
 * Weiss), Gruppen ab fuenf sich beruehrenden Pins, Fokus auf den gewaehlten Fahrer (die anderen blass),
 * Route mit schon gefahrenem Teil, Dauer-Schildern, Abholort und Ziel.
 * Die Pins liegen als Compose-Ebene ueber der Karte und folgen der Kamera.
 */
@Composable
internal fun DispoKarte(
    stand: KartenStand,
    waehlen: (String) -> Unit,
    leerTippen: () -> Unit,
    /** Fahrer mehr als 200 m neben seiner Route: neu rechnen lassen. */
    abseits: (KartenPunkt) -> Unit,
    /** Tipp auf einen eigenen Ort: Kreise ein- oder ausblenden. */
    ortTippen: (String) -> Unit = {},
) {
    val dichte = LocalDensity.current.density
    val s = remember { KartenSteuerung() }
    s.dichte = dichte
    val leer by rememberUpdatedState(leerTippen)
    val abseitsAktuell by rememberUpdatedState(abseits)
    s.abseits = { abseitsAktuell(it) }

    val lifecycle = LocalLifecycleOwner.current.lifecycle
    DisposableEffect(lifecycle) {
        val beobachter = LifecycleEventObserver { _, e ->
            val v = s.ansicht ?: return@LifecycleEventObserver
            when (e) {
                Lifecycle.Event.ON_START -> v.onStart()
                Lifecycle.Event.ON_RESUME -> v.onResume()
                Lifecycle.Event.ON_PAUSE -> v.onPause()
                Lifecycle.Event.ON_STOP -> v.onStop()
                else -> {}
            }
        }
        lifecycle.addObserver(beobachter)
        onDispose {
            lifecycle.removeObserver(beobachter)
            s.ansicht?.let { v ->
                if (lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED)) v.onPause()
                if (lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)) v.onStop()
                v.onDestroy()
            }
            s.ansicht = null
            s.karte = null
        }
    }

    Box(Modifier.fillMaxSize().background(hex(0x0E0E0E))) {
        AndroidView(factory = { ctx -> s.erzeugen(ctx) { leer() } }, modifier = Modifier.fillMaxSize())
        KartenEbene(s, stand, waehlen, ortTippen)
    }

    SideEffect { s.setzen(stand) }
}

/** Pins, Gruppen, Abholort, Ziel und Dauer-Schilder ueber der Karte. */
@Composable
private fun KartenEbene(s: KartenSteuerung, stand: KartenStand, waehlen: (String) -> Unit, ortTippen: (String) -> Unit) {
    @Suppress("UNUSED_VARIABLE") val takt = s.takt.intValue
    val karte = s.karte ?: return
    val dichte = s.dichte
    val proj = karte.projection
    fun bild(p: KartenPunkt): Pair<Float, Float> {
        val pt = proj.toScreenLocation(LatLng(p.lat, p.lng))
        return pt.x / dichte to pt.y / dichte
    }

    // Eigene Orte unter den Fahrern: Icon im Kreis, gewaehlt in Lime mit Name und Radien darueber.
    for (o in stand.orte) {
        val (x, y) = bild(KartenPunkt(o.lat, o.lng))
        val an = o.id == stand.ortGewaehlt
        OrtMarke(o.icon, an, Modifier.ankern(x, y, 0.5f, 0.5f).zIndex(if (an) 190f else 100f).tippen { ortTippen(o.id) })
        if (an) OrtSchild(o, Modifier.ankern(x, y - 22f, 0.5f, 1f).zIndex(195f))
    }

    val gewaehltID = stand.gewaehlt?.id
    val kolonne = stand.gewaehlt?.fahrt?.kolonnenFahrerIDs?.toSet() ?: emptySet()
    val einzeln = kolonne + listOfNotNull(gewaehltID)
    val fokus = stand.gewaehlt != null

    // updateDriverClusters: Gruppen erst ab fuenf Fahrern, deren Pins (35) sich beruehren.
    // Der gewaehlte Fahrer und seine Kolonne bleiben immer einzeln.
    val kandidaten = stand.fahrer.filter { it.id !in einzeln }.map { it to bild(it.ort) }
    val radius = 35f + 1f
    val vergeben = HashSet<Int>()
    val gruppen = mutableListOf<List<KartenFahrer>>()
    for (i in kandidaten.indices) {
        if (i in vergeben) continue
        val mitglieder = mutableListOf(i)
        for (j in i + 1 until kandidaten.size) {
            if (j in vergeben) continue
            val a = kandidaten[i].second; val b = kandidaten[j].second
            if (hypot(a.first - b.first, a.second - b.second) <= radius) mitglieder += j
        }
        if (mitglieder.size < 5) continue
        vergeben += mitglieder
        gruppen += mitglieder.map { kandidaten[it].first }
    }
    val inGruppe = vergeben.map { kandidaten[it].first.id }.toSet()

    for (g in gruppen) {
        val mitte = KartenPunkt(g.sumOf { it.lat } / g.size, g.sumOf { it.lng } / g.size)
        val (x, y) = bild(mitte)
        // Gruppe nach Figma 2563-12242: weisser Kreis 35 mit der Anzahl in Fuenferschritten.
        Box(
            Modifier.ankern(x, y, 0.5f, 0.5f).zIndex(if (fokus) 210f else 1450f).size(35.dp)
                .tippen { s.gruppeOeffnen(g.map { it.ort }) },
        ) {
            if (fokus) Icon("Gruppe_Kreis_Trisar_01", Modifier.fillMaxSize(), farbe = ColorFilter.tint(hex(0x0E0E0E)))
            Box(Modifier.fillMaxSize().alpha(if (fokus) 0.3f else 1f), contentAlignment = Alignment.Center) {
                Icon("Gruppe_Kreis_Trisar_01", Modifier.fillMaxSize())
                Text("${g.size / 5 * 5}", style = grotesk(15f, 700, farbe = Color.Black), textAlign = TextAlign.Center)
            }
        }
    }

    for (f in stand.fahrer) {
        if (f.id in inGruppe) continue
        val istGewaehlt = gewaehltID == f.id
        val inKolonne = f.id in kolonne
        // Fokus: ist ein Fahrer gewaehlt, treten alle anderen zurueck (ausser seiner Kolonne).
        val blass = gewaehltID != null && !istGewaehlt && !inKolonne
        val hoehe = if (istGewaehlt) 2000f else if (blass) 200f else if (inKolonne) 1500f else 1000f
        val (x, y) = bild(f.ort)
        val name = f.zustand.pinBild(f.zuendungAus)
        // Fahrer-Pin 35 x 41,14, Spitze auf dem Ort, Nummer (15 fett, #1A1A1A) mittig im Kopf.
        Box(Modifier.ankern(x, y, 0.5f, 1f).zIndex(hoehe).size(35.dp, 41.1367.dp).tippen { waehlen(f.id) }) {
            if (blass) Icon(name, Modifier.fillMaxSize(), farbe = ColorFilter.tint(hex(0x0E0E0E)))
            Box(Modifier.fillMaxSize().alpha(if (blass) 0.3f else 1f)) {
                Icon(name, Modifier.fillMaxSize())
                Box(Modifier.padding(top = 5.5.dp).size(35.dp, 24.dp), contentAlignment = Alignment.Center) {
                    Text(f.nummer ?: "?", style = grotesk(15f, 700, farbe = hex(0x1A1A1A)), textAlign = TextAlign.Center, maxLines = 1)
                }
            }
        }
    }

    for (m in s.marken) {
        if (!m.sichtbar) continue
        val (x, y) = bild(m.ort)
        when (m.art) {
            // Abholort (rot, Gast) und Ziel (Schachbrett), 35 x 41,14, Spitze auf dem Ort.
            "abholort", "ziel" -> Icon(
                if (m.art == "abholort") "Abholort_Pin_Trisar_01_rot" else "Ziel_Pin_Trisar_01",
                Modifier.ankern(x, y, 0.5f, 1f).zIndex(320f).size(35.dp, 41.1367.dp),
            )
            // Dauer-Schild (openDurationLabel): Pille 13 fett, 6/12 Innenabstand, Schatten, Unterkante auf dem Punkt.
            else -> {
                val blau = m.art == "blase-blau"
                Box(
                    Modifier.ankern(x, y, 0.5f, 1f).zIndex(360f)
                        .shadow(9.dp, RoundedCornerShape(50), ambientColor = Color.Black, spotColor = Color.Black)
                        .background(if (blau) hex(0x0059FF) else hex(0xE3F654), RoundedCornerShape(50))
                        .padding(horizontal = 12.dp, vertical = 6.dp),
                ) {
                    Text(m.text, style = grotesk(13f, 700, farbe = if (blau) Color.White else hex(0x111111)), maxLines = 1)
                }
            }
        }
    }
}

/** Element so legen, dass der Anteil (ax, ay) seiner Groesse auf (x, y) im Raster liegt. */
private fun Modifier.ankern(x: Float, y: Float, ax: Float, ay: Float): Modifier = this.then(
    Modifier.wrapContentSize(unbounded = true, align = Alignment.TopStart).layout { messbar, grenzen ->
        val p = messbar.measure(grenzen.copy(minWidth = 0, minHeight = 0))
        layout(p.width, p.height) {
            p.place((x * density - p.width * ax).roundToInt(), (y * density - p.height * ay).roundToInt())
        }
    },
)

/** Punkt der Route, der als Compose-Zeichen gezeichnet wird. Das Schild wandert mit dem Fortschritt. */
internal class RoutenMarke(val art: String, val text: String, ort: KartenPunkt) {
    var ort by mutableStateOf(ort)
    var sichtbar by mutableStateOf(true)
}

/** Haelt MapView, Route und Fortschritt (Koordinator in DispoKarte.swift). */
internal class KartenSteuerung {
    var ansicht: MapView? = null
    var karte by mutableStateOf<MapLibreMap?>(null)
    var dichte = 1f
    /** Zaehlt jede Kamerabewegung, damit die Pins neu liegen. */
    val takt = mutableIntStateOf(0)
    val marken = mutableStateListOf<RoutenMarke>()
    var abseits: (KartenPunkt) -> Unit = {}

    private var stand = KartenStand()
    private var stilGeladen = false
    private var ablage: android.content.SharedPreferences? = null
    private var einpassenSignal = 0

    // Route: Teile (Anfahrt, Fahrt) je mit noch zu fahrender und schon gefahrener Linie.
    private class Teil(val art: String, val pfad: List<KartenPunkt>, val schild: RoutenMarke?)
    private var teile = listOf<Teil>()
    private var fpTeil = 0
    private var fpIndex = 0
    private var fpGefunden = false
    private var routenSchluessel = ""
    private var eingepasstFuer = ""
    private var letzteBlattHoehe = -1f
    private var letzterFortschritt = ""
    private var ortKreisSchluessel = ""

    companion object {
        private const val KAMERA = "admin_karten_camera_v1"
    }

    fun erzeugen(ctx: Context, leerTippen: () -> Unit): MapView {
        MapLibre.getInstance(ctx)
        ablage = ctx.getSharedPreferences("trisar-dispo-karte", Context.MODE_PRIVATE)
        val v = MapView(ctx)
        v.onCreate(null)
        ansicht = v
        v.getMapAsync { m ->
            // Letzter Ausschnitt (MAP_CAMERA_CACHE_KEY), sonst Muenchen bei Zoom 12.
            val k = ablage?.getString(KAMERA, null)?.split(",")?.mapNotNull { it.toDoubleOrNull() }
            m.cameraPosition = if (k != null && k.size == 3) {
                CameraPosition.Builder().target(LatLng(k[0], k[1])).zoom(k[2]).build()
            } else {
                CameraPosition.Builder().target(LatLng(48.137154, 11.576124)).zoom(12.0).build()
            }
            m.uiSettings.isLogoEnabled = false
            m.uiSettings.isCompassEnabled = false
            m.uiSettings.isRotateGesturesEnabled = false
            m.uiSettings.isTiltGesturesEnabled = false
            m.uiSettings.attributionGravity = Gravity.BOTTOM or Gravity.END
            m.uiSettings.setAttributionTintColor(Color(0xCC999999).toArgb())
            m.addOnCameraMoveListener { takt.intValue++ }
            m.addOnCameraIdleListener {
                takt.intValue++
                val c = m.cameraPosition
                c.target?.let { ablage?.edit()?.putString(KAMERA, "${it.latitude},${it.longitude},${c.zoom}")?.apply() }
            }
            m.addOnMapClickListener { leerTippen(); true }
            karte = m
            m.setStyle(Style.Builder().fromUri(Konfig.KARTEN_STIL)) {
                stilGeladen = true
                ortKreisSchluessel = ""
                routenSchluessel = ""
                letzterFortschritt = ""
                setzen(stand)
            }
        }
        return v
    }

    fun setzen(neu: KartenStand) {
        stand = neu
        if (karte == null) return
        if (neu.einpassenSignal != einpassenSignal) {
            einpassenSignal = neu.einpassenSignal
            eingepasstFuer = ""
            alleEinpassen()
        }
        routeAbgleichen()
        ortKreiseAbgleichen()
        val g = neu.gewaehlt
        val fk = "${g?.id}|${g?.lat}|${g?.lng}|$routenSchluessel"
        if (fk != letzterFortschritt) {
            letzterFortschritt = fk
            fortschrittAktualisieren()
        }
        if (abs(neu.blattHoehe - letzteBlattHoehe) > 0.5f) {
            letzteBlattHoehe = neu.blattHoehe
            if (routenSchluessel.isNotEmpty()) routeEinpassen()
        }
    }

    /** Kreise des gewaehlten Orts (innen rein, aussen raus), ohne Wahl leer. */
    private fun ortKreiseAbgleichen() {
        if (!stilGeladen) return
        val stil = karte?.style ?: return
        val o = stand.orte.firstOrNull { it.id == stand.ortGewaehlt }
        val k = o?.let { "${it.id}|${it.lat}|${it.lng}|${it.radius_rein_m}|${it.radius_raus_m}" } ?: ""
        if (k == ortKreisSchluessel) return
        ortKreisSchluessel = k
        OrtKreise.setzen(stil, "dk-ort", o?.lat, o?.lng, o?.radius_rein_m ?: 0, o?.radius_raus_m ?: 0)
    }

    // MARK: Einpassen (fitBounds, Polsterung im Raster)

    private fun einpassen(orte: List<KartenPunkt>, oben: Float, rechts: Float, unten: Float, links: Float, maxZoom: Double? = null) {
        val m = karte ?: return
        val v = ansicht ?: return
        if (orte.isEmpty()) return
        if (v.width < 10 || v.height < 10) {
            v.postDelayed({ einpassen(orte, oben, rechts, unten, links, maxZoom) }, 200)
            return
        }
        val grenzen = LatLngBounds.from(orte.maxOf { it.lat }, orte.maxOf { it.lng }, orte.minOf { it.lat }, orte.minOf { it.lng })
        val rand = intArrayOf((links * dichte).toInt(), (oben * dichte).toInt(), (rechts * dichte).toInt(), (unten * dichte).toInt())
        val kamera = runCatching { m.getCameraForLatLngBounds(grenzen, rand) }.getOrNull() ?: return
        // Wie maxZoom bei fitBounds im Web: die Kamera nie naeher als die Grenze.
        val zoom = if (maxZoom != null) min(kamera.zoom, maxZoom) else kamera.zoom
        m.animateCamera(CameraUpdateFactory.newCameraPosition(CameraPosition.Builder(kamera).zoom(zoom).build()), 500)
    }

    /** fitAllDriverMarkers: oben bleiben Zurueck, Filter und Statusleiste frei. */
    private fun alleEinpassen() {
        // Nicht naeher als ein Stadtviertel (Web: ALLE_FAHRER_MAX_ZOOM).
        einpassen(stand.fahrer.map { it.ort }, 200f, 24f, 190f, 24f, maxZoom = 13.5)
    }

    /** fitRouteBounds: unten Leiste + Blatt, oben so viel, wie die Hoehe hergibt. */
    private fun routeEinpassen() {
        val route = stand.route ?: return
        if (route.schluessel != routenSchluessel) return
        val orte = route.allePunkte
        if (orte.isEmpty()) { alleEinpassen(); return }
        val unten = 190f + stand.blattHoehe + 10f
        val oben = max(88f, min(210f, stand.rasterHoehe - unten - 140f))
        einpassen(orte, oben, 40f, unten, 40f)
    }

    /**
     * Gruppe antippen: auf ihre Fahrer einpassen. Liegen sie fast aufeinander, aendert das
     * kaum etwas, dann nach der Fahrt noch zwei Stufen hinein.
     */
    fun gruppeOeffnen(orte: List<KartenPunkt>) {
        val m = karte ?: return
        val vorher = m.cameraPosition.zoom
        einpassen(orte, 200f, 24f, 190f, 24f)
        ansicht?.postDelayed({
            val k = karte ?: return@postDelayed
            if (k.cameraPosition.zoom <= vorher + 0.5) k.animateCamera(CameraUpdateFactory.zoomTo(min(20.0, vorher + 2)), 300)
        }, 800)
    }

    // MARK: Route

    private fun routeAbgleichen() {
        if (karte == null || !stilGeladen) return
        val route = stand.route
        val schluessel = route?.schluessel ?: ""
        if (schluessel == routenSchluessel) return
        routenSchluessel = schluessel
        marken.clear()
        teile = emptyList()
        fpTeil = 0; fpIndex = 0; fpGefunden = false
        if (route == null || schluessel.isEmpty()) {
            linienSetzen()
            eingepasstFuer = ""
            return
        }
        fun punkt(ort: KartenPunkt?, art: String, text: String = ""): RoutenMarke? {
            ort ?: return null
            return RoutenMarke(art, text, ort).also { marken += it }
        }
        val neu = mutableListOf<Teil>()
        if (route.anfahrt.size >= 2) {
            val min = route.anfahrtMinuten ?: 0
            val schild = if (min > 0) punkt(route.anfahrt[route.anfahrt.size / 2], "blase-gelb", KartenRegeln.dauer(min)) else null
            neu += Teil("anfahrt", route.anfahrt, schild)
        }
        if (route.fahrt.size >= 2) {
            val min = route.fahrtMinuten ?: 0
            val schild = if (min > 0) punkt(route.fahrt[route.fahrt.size / 2], "blase-blau", KartenRegeln.dauer(min)) else null
            neu += Teil("fahrt", route.fahrt, schild)
        }
        teile = neu
        punkt(route.abholort, "abholort")
        punkt(route.ziel, "ziel")
        linienSetzen()
        if (eingepasstFuer != schluessel) {
            eingepasstFuer = schluessel
            routeEinpassen()
        }
    }

    /** Linien je Teil: Rest und schon gefahrener Teil (Startzustand: alles Rest). */
    private fun linienSetzen(rest: Map<String, List<KartenPunkt>> = emptyMap(), gefahren: Map<String, List<KartenPunkt>> = emptyMap()) {
        val stil = karte?.style ?: return
        if (!stil.isFullyLoaded) return
        val pfade = teile.associate { it.art to it.pfad }
        // Blau unter Gelb (zIndex 300 / 301 im Web).
        linie(stil, "dk-fahrt", rest["fahrt"] ?: pfade["fahrt"] ?: emptyList(), 0x0059FF, 6f, false, 1f)
        linie(stil, "dk-fahrt-gefahren", gefahren["fahrt"] ?: emptyList(), 0x0059FF, 5f, true, 0.8f)
        linie(stil, "dk-anfahrt", rest["anfahrt"] ?: pfade["anfahrt"] ?: emptyList(), 0xE3F654, 5f, true, 1f)
        linie(stil, "dk-anfahrt-gefahren", gefahren["anfahrt"] ?: emptyList(), 0xE3F654, 5f, true, 0.25f)
    }

    private fun linie(stil: Style, kennung: String, pfad: List<KartenPunkt>, farbe: Long, breite: Float, gestrichelt: Boolean, deckung: Float) {
        // Erst ab zwei Punkten eine Linie, sonst eine leere Sammlung.
        val json = if (pfad.size >= 2) {
            "{\"type\":\"Feature\",\"properties\":{},\"geometry\":{\"type\":\"LineString\",\"coordinates\":[" +
                pfad.joinToString(",") { "[${it.lng},${it.lat}]" } + "]}}"
        } else {
            "{\"type\":\"FeatureCollection\",\"features\":[]}"
        }
        val quelle = stil.getSourceAs<GeoJsonSource>(kennung)
        if (quelle != null) { quelle.setGeoJson(json); return }
        stil.addSource(GeoJsonSource(kennung, json))
        val ebene = LineLayer(kennung, kennung).withProperties(
            PropertyFactory.lineColor(hex(farbe).toArgb()),
            PropertyFactory.lineWidth(breite),
            PropertyFactory.lineOpacity(deckung),
            PropertyFactory.lineCap("round"),
            PropertyFactory.lineJoin("round"),
        )
        if (gestrichelt) ebene.setProperties(PropertyFactory.lineDasharray(arrayOf(0.8f, 1.6f)))
        stil.addLayer(ebene)
    }

    /**
     * routenFortschrittAktualisieren: Fahrer auf seine Route legen (nur vorwaerts), alles
     * davor wird zur blassen Linie, das Schild wandert mit der Mitte des Rests.
     */
    private fun fortschrittAktualisieren() {
        if (!stilGeladen || teile.isEmpty()) return
        val fahrer = stand.gewaehlt ?: return
        val hier = fahrer.ort
        fun meter(a: KartenPunkt, b: KartenPunkt): Double {
            val dx = (b.lng - a.lng) * cos(a.lat * PI / 180) * 111_320
            val dy = (b.lat - a.lat) * 110_540
            return hypot(dx, dy)
        }
        fun naechster(t: Teil, ab: Int, ganz: Boolean = false): Pair<Int, Double> {
            var index = -1
            var abstand = Double.POSITIVE_INFINITY
            val bis = if (ganz) t.pfad.size else min(t.pfad.size, ab + 150)
            for (i in ab until bis) {
                val d = meter(hier, t.pfad[i])
                if (d < abstand) { abstand = d; index = i }
            }
            return index to abstand
        }
        if (fpTeil >= teile.size) return
        val rest = HashMap<String, List<KartenPunkt>>()
        val gefahren = HashMap<String, List<KartenPunkt>>()
        for ((i, t) in teile.withIndex()) if (i < fpTeil) { gefahren[t.art] = t.pfad; rest[t.art] = emptyList() }
        var t = teile[fpTeil]
        var treffer = naechster(t, fpIndex, ganz = !fpGefunden)
        if (treffer.second <= 60) fpGefunden = true
        if (fpTeil + 1 < teile.size && fpIndex >= t.pfad.size - 3) {
            val folge = teile[fpTeil + 1]
            val weiter = naechster(folge, 0)
            if (weiter.second < 40) {
                gefahren[t.art] = t.pfad; rest[t.art] = emptyList()
                t.schild?.sichtbar = false
                fpTeil += 1
                fpIndex = 0
                t = folge
                treffer = weiter
            }
        }
        // Mehr als 200 m neben der Linie: Route passt nicht mehr. Ueber die Hauptschleife melden.
        if (treffer.first < 0 || treffer.second > 200) {
            val melden = abseits
            ansicht?.post { melden(hier) }
        }
        if (treffer.first < 0 || treffer.second > 60) {
            linienSetzen(rest, gefahren)
            return
        }
        fpIndex = max(fpIndex, treffer.first)
        gefahren[t.art] = t.pfad.subList(0, fpIndex + 1) + hier
        val r = listOf(hier) + t.pfad.drop(fpIndex + 1)
        rest[t.art] = r
        t.schild?.ort = r[r.size / 2]
        linienSetzen(rest, gefahren)
    }
}
