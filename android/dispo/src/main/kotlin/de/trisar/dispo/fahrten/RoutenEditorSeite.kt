package de.trisar.dispo.fahrten

import de.trisar.dispo.karte.KartenStil
import de.trisar.dispo.karte.StilFolgen
import android.view.Gravity
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.MutableIntState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import de.trisar.kern.GeoPunkt
import de.trisar.kern.Konfig
import de.trisar.kern.Routen
import de.trisar.kern.RoutenPunkt
import de.trisar.kern.RoutenPunkte
import de.trisar.kern.googlePolylineLesen
import de.trisar.kern.grotesk
import de.trisar.kern.hex
import de.trisar.kern.platz
import de.trisar.kern.tippen
import kotlinx.coroutines.delay
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.maplibre.android.MapLibre
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
import java.util.Locale
import kotlin.math.roundToInt

/** Vorschau-Route vom Server (places-proxy, aktion route_vorschau). */
internal object RoutenVorschau {
    data class Ergebnis(
        val pfad: List<GeoPunkt>,
        val meter: Int,
        val minuten: Int,
        val verkehrMinuten: Int,
        /** Geocodet: Start, Stopps, Ziel (null = nicht gefunden). */
        val orte: List<GeoPunkt?>,
        /** Freigabe-Paket des Servers (nur mit Punkten): nicht auswerten, 1:1 als jobs.route_fest speichern. */
        val fest: JsonElement? = null,
    ) {
        val wirksameMinuten get() = if (verkehrMinuten > 0) verkehrMinuten else minuten
    }

    private fun zahl(o: JsonObject, k: String): Double? = (o[k] as? JsonPrimitive)?.content?.toDoubleOrNull()

    suspend fun holen(adressen: List<String>, punkte: List<RoutenPunkt>): Ergebnis? {
        val r = FahrtPruefung.aufrufen("places-proxy", buildJsonObject {
            put("aktion", "route_vorschau")
            put("adressen", JsonArray(adressen.map { JsonPrimitive(FahrtText.getrimmt(it)) }))
            put("punkte", RoutenPunkte.json(punkte))
        })
        if (r !is FahrtPruefung.Aufruf.Ok) return null
        val o = r.daten as? JsonObject ?: return null
        if ((o["ok"] as? JsonPrimitive)?.content != "true") return null
        val orte = (o["orte"] as? JsonArray).orEmpty().map { e ->
            val p = e as? JsonObject ?: return@map null
            val lat = zahl(p, "lat"); val lng = zahl(p, "lng")
            if (lat == null || lng == null) null else GeoPunkt(lat, lng)
        }
        return Ergebnis(
            pfad = googlePolylineLesen((o["polyline"] as? JsonPrimitive)?.content),
            meter = (zahl(o, "distanz_m") ?: 0.0).roundToInt(),
            minuten = (zahl(o, "dauer_min") ?: 0.0).roundToInt(),
            verkehrMinuten = (zahl(o, "dauer_verkehr_min") ?: 0.0).roundToInt(),
            orte = orte,
            fest = o["fest"] as? JsonObject,
        )
    }
}

/** Wert der Formularzeile „Route“: Schnellste oder Angepasst mit Lime-Chip „N Punkte“. */
@Composable
internal fun RoutenZeilenWert(anzahl: Int, aktion: () -> Unit) {
    Row(Modifier.fillMaxSize().tippen(aktion), verticalAlignment = Alignment.CenterVertically) {
        Text(if (anzahl == 0) "Schnellste" else "Angepasst", style = css(16f, 500, abstand = 0.5f, farbe = LIME), maxLines = 1)
        Spacer(Modifier.weight(1f))
        if (anzahl > 0) {
            Box(Modifier.background(LIME, RoundedCornerShape(50)).padding(horizontal = 8.dp, vertical = 2.dp)) {
                Text(if (anzahl == 1) "1 Punkt" else "$anzahl Punkte", style = grotesk(12f, 700, farbe = Color.Black), maxLines = 1)
            }
        }
    }
}

/**
 * Routen-Editor (15.11.): Vollbild-Karte ueber dem Fahrt-Formular. Tipp auf die Karte setzt einen
 * Routenpunkt an die guenstigste Stelle der Fahrt, Tipp auf einen Punkt nimmt ihn wieder weg.
 * adressen = Start, Stopps, Ziel. Uebernehmen gibt die Punkte und die Freigabe (fest) der gezeigten
 * Vorschau ans Formular, gespeichert wird dort.
 */
@Composable
internal fun RoutenEditorSeite(
    adressen: List<String>,
    stoppAnzahl: Int,
    anfang: List<RoutenPunkt>,
    abbrechen: () -> Unit,
    uebernehmen: (List<RoutenPunkt>, JsonElement?) -> Unit,
) {
    val hoechstens = RoutenPunkte.hoechstens(stoppAnzahl)
    // Nach Abschnitt sortiert (stabil), damit Einfuegen per Index stimmt.
    var punkte by remember { mutableStateOf(anfang.map { it.copy(nach = it.nach.coerceIn(0, stoppAnzahl)) }.sortedBy { it.nach }.take(hoechstens)) }
    var schnell by remember { mutableStateOf<RoutenVorschau.Ergebnis?>(null) }
    var schnellFertig by remember { mutableStateOf(false) }
    var angepasst by remember { mutableStateOf<RoutenVorschau.Ergebnis?>(null) }
    var angepasstLaedt by remember { mutableStateOf(false) }
    // Punktliste, zu der die Vorschau in angepasst gehoert (waehrend neu gerechnet wird, steht dort noch die alte).
    var angepasstFuer by remember { mutableStateOf<List<RoutenPunkt>?>(null) }
    var meldung by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(Unit) {
        schnell = RoutenVorschau.holen(adressen, emptyList())
        schnellFertig = true
    }
    // Nach jeder Aenderung neu rechnen, kurz entprellt (ein neuer Tipp bricht den alten Lauf ab).
    LaunchedEffect(punkte) {
        if (punkte.isEmpty()) { angepasst = null; angepasstFuer = null; angepasstLaedt = false; return@LaunchedEffect }
        val fuer = punkte
        angepasstLaedt = true
        delay(300)
        val r = RoutenVorschau.holen(adressen, fuer)
        angepasst = r
        angepasstFuer = if (r != null) fuer else null
        angepasstLaedt = false
    }
    LaunchedEffect(meldung) {
        if (meldung != null) { delay(2200); meldung = null }
    }

    val anzeige = if (punkte.isEmpty()) schnell else angepasst
    val orte = (schnell?.orte ?: angepasst?.orte).orEmpty()
    // Freigabe (16.11.): uebernommen wird genau die Route, die zu sehen ist. Solange die Vorschau zu den
    // aktuellen Punkten fehlt, ist der Knopf gesperrt. Ohne Punkte gibt es nichts festzuschreiben.
    val freigabeBereit = punkte.isEmpty() || (angepasst != null && angepasstFuer == punkte)

    fun einfuegen(x: GeoPunkt) {
        if (punkte.size >= hoechstens) { meldung = "Höchstens $hoechstens Routenpunkte"; return }
        // Geordnete Wegpunkte A, Punkte(0), Stopp 1, Punkte(1), ..., B.
        // stopps = Anzahl Stopps bis hier, bei = Index in punkte direkt hinter diesem Wegpunkt.
        data class W(val ort: GeoPunkt?, val stopps: Int, val bei: Int)
        val folge = mutableListOf(W(orte.getOrNull(0), 0, 0))
        for (k in 0..stoppAnzahl) {
            punkte.forEachIndexed { i, p -> if (p.nach == k) folge += W(GeoPunkt(p.lat, p.lng), k, i + 1) }
            if (k < stoppAnzahl) folge += W(orte.getOrNull(k + 1), k + 1, punkte.count { it.nach <= k })
        }
        folge += W(orte.getOrNull(stoppAnzahl + 1), stoppAnzahl, punkte.size)
        var besteKosten = Double.MAX_VALUE
        var beste: W? = null
        for (i in 0 until folge.size - 1) {
            val p = folge[i].ort ?: continue
            val q = folge[i + 1].ort ?: continue
            val kosten = Routen.abstand(p, x) + Routen.abstand(x, q) - Routen.abstand(p, q)
            if (kosten < besteKosten) { besteKosten = kosten; beste = folge[i] }
        }
        // Ohne bekannte Orte: hinten anhaengen, letzter Abschnitt.
        val w = beste ?: W(null, stoppAnzahl, punkte.size)
        punkte = punkte.toMutableList().also { it.add(w.bei.coerceIn(0, it.size), RoutenPunkt(x.lat, x.lng, w.stopps)) }
    }

    BoxWithConstraints(Modifier.fillMaxSize().background(Color.Black).blockieren()) {
        val einfuegenAktuell by rememberUpdatedState(::einfuegen)
        val einpassen = remember(schnell, angepasst) { anzeige?.pfad.orEmpty() + orte.filterNotNull() + punkte.map { GeoPunkt(it.lat, it.lng) } }
        val bereit = schnellFertig && (punkte.isEmpty() || !angepasstLaedt || angepasst != null)
        RoutenKarte(
            schnell = if (punkte.isNotEmpty()) schnell?.pfad.orEmpty() else emptyList(),
            aktuell = anzeige?.pfad.orEmpty(),
            orte = orte,
            punkte = punkte,
            einpassen = if (bereit) einpassen else emptyList(),
            antippen = { einfuegenAktuell(it) },
            entfernen = { i -> punkte = punkte.toMutableList().also { l -> if (i in l.indices) l.removeAt(i) } },
        )

        // Oben: Abbrechen, Hinweis, Zuruecksetzen.
        RunderKnopf("←", Modifier.platz(20f, 60f, 56f, 56f), abbrechen)
        RunderKnopf("↺", Modifier.platz(402f - 20f - 56f, 60f, 56f, 56f)) { punkte = emptyList() }
        Box(Modifier.platz(84f, 60f, 234f), contentAlignment = Alignment.TopCenter) {
            Column(
                Modifier.background(Color.Black.copy(alpha = 0.85f), RoundedCornerShape(14.dp)).padding(horizontal = 12.dp, vertical = 8.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                val stil = grotesk(12.5f, 500, farbe = Color.White)
                Text(buildAnnotatedString {
                    append("Karte antippen = ")
                    withStyle(SpanStyle(color = LIME, fontWeight = androidx.compose.ui.text.font.FontWeight.Bold)) { append("Routenpunkt") }
                }, style = stil, textAlign = TextAlign.Center, maxLines = 1)
                Text("Punkt antippen = entfernen", style = stil, textAlign = TextAlign.Center, maxLines = 1)
                Text("grau = schnellste Route", style = stil.copy(color = hex(0x9A9A9A)), textAlign = TextAlign.Center, maxLines = 1)
            }
        }

        // Unten: Strecke, Zeit, Hinweis und die beiden Knoepfe.
        Column(
            Modifier.align(Alignment.BottomCenter).fillMaxWidth().blockieren().background(Color.Black)
                .drawBehind { drawLine(LIME, Offset(0f, 0f), Offset(size.width, 0f), strokeWidth = 1.5f.dp.toPx()) }
                .navigationBarsPadding().padding(start = 20.dp, end = 20.dp, top = 16.dp, bottom = 16.dp),
        ) {
            meldung?.let {
                Box(Modifier.fillMaxWidth().padding(bottom = 10.dp), contentAlignment = Alignment.Center) {
                    Text(it, style = grotesk(13f, 700, farbe = Color.Black), maxLines = 1,
                        modifier = Modifier.background(LIME, RoundedCornerShape(50)).padding(horizontal = 12.dp, vertical = 4.dp))
                }
            }
            Row(verticalAlignment = Alignment.Bottom) {
                Text(if (punkte.isEmpty()) "Schnellste" else "Angepasst", style = grotesk(15f, 500, farbe = Color.White), maxLines = 1)
                Spacer(Modifier.width(8.dp))
                val laedt = !schnellFertig || (punkte.isNotEmpty() && angepasstLaedt && angepasst == null)
                val kmText = when {
                    anzeige != null -> String.format(Locale.GERMANY, "%.1f km", anzeige.meter / 1000.0)
                    laedt -> "…"
                    else -> "Keine Route"
                }
                Text(kmText, style = grotesk(20f, 700, farbe = LIME), maxLines = 1)
                Spacer(Modifier.weight(1f))
                if (anzeige != null) {
                    Text("${anzeige.wirksameMinuten} min", style = grotesk(20f, 700, farbe = LIME), maxLines = 1)
                    val s = schnell
                    if (punkte.isNotEmpty() && s != null) {
                        val mehr = anzeige.wirksameMinuten - s.wirksameMinuten
                        Spacer(Modifier.width(4.dp))
                        Text(if (mehr >= 0) "(+$mehr)" else "($mehr)", style = grotesk(13f, 500, farbe = hex(0x9A9A9A)), maxLines = 1)
                    }
                }
            }
            Spacer(Modifier.height(6.dp))
            val frei = hoechstens - punkte.size
            val anzahlText = when (punkte.size) { 0 -> "Keine Routenpunkte"; 1 -> "1 Routenpunkt"; else -> "${punkte.size} Routenpunkte" }
            Text("$anzahlText · noch $frei frei. Der Fahrer wird in der TRISAR-App entlang dieser Route geführt.",
                style = grotesk(12.5f, 500, farbe = hex(0x9A9A9A)))
            Spacer(Modifier.height(14.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Box(Modifier.weight(1f).height(52.dp).border(2.dp, LIME).tippen { punkte = emptyList() }, contentAlignment = Alignment.Center) {
                    Text("Zurücksetzen", style = grotesk(16f, 700, farbe = LIME), maxLines = 1)
                }
                Box(
                    Modifier.weight(1f).height(52.dp).background(if (freigabeBereit) LIME else LIME.copy(alpha = 0.35f)).tippen {
                        if (!freigabeBereit) return@tippen
                        uebernehmen(punkte, if (punkte.isEmpty()) null else angepasst?.fest)
                    },
                    contentAlignment = Alignment.Center,
                ) {
                    Text("Übernehmen", style = grotesk(16f, 700, farbe = Color.Black), maxLines = 1)
                }
            }
        }
    }
}

/** Runder Lime-Knopf 56 wie auf der Karte, schwarzes Zeichen. */
@Composable
private fun RunderKnopf(zeichen: String, modifier: Modifier, aktion: () -> Unit) {
    Box(
        modifier.background(LIME, CircleShape).border(2.dp, Color.Black, CircleShape).tippen(aktion),
        contentAlignment = Alignment.Center,
    ) { Text(zeichen, style = grotesk(24f, 700, farbe = Color.Black), maxLines = 1) }
}

/**
 * Karte des Editors: dunkler Stil wie die anderen Karten, Linien als Ebenen,
 * Marker als Compose-Bausteine ueber der Karte (Routenpunkte antippbar).
 */
@Composable
private fun RoutenKarte(
    schnell: List<GeoPunkt>,
    aktuell: List<GeoPunkt>,
    orte: List<GeoPunkt?>,
    punkte: List<RoutenPunkt>,
    einpassen: List<GeoPunkt>,
    antippen: (GeoPunkt) -> Unit,
    entfernen: (Int) -> Unit,
) {
    val ctx = LocalContext.current
    val dichte = LocalDensity.current
    val ansicht = remember {
        MapLibre.getInstance(ctx)
        MapView(ctx).apply { onCreate(null) }
    }
    var karte by remember { mutableStateOf<MapLibreMap?>(null) }
    var stil by remember { mutableStateOf<Style?>(null) }
    // Kartenstil aus dem Karten Filter, wechselt live.
    val takt = remember { mutableIntStateOf(0) }
    StilFolgen(karte) { s -> stil = s; takt.intValue++ }
    val antippenAktuell by rememberUpdatedState(antippen)
    var eingepasst by remember { mutableStateOf(false) }

    val lebenszyklus = LocalLifecycleOwner.current.lifecycle
    DisposableEffect(lebenszyklus) {
        var gestartet = false
        var aktiv = false
        // Seite oeffnet sich im laufenden Betrieb: gleich starten, die Ereignisse kamen schon.
        if (lebenszyklus.currentState.isAtLeast(Lifecycle.State.STARTED)) { ansicht.onStart(); gestartet = true }
        if (lebenszyklus.currentState.isAtLeast(Lifecycle.State.RESUMED)) { ansicht.onResume(); aktiv = true }
        val beobachter = LifecycleEventObserver { _, e ->
            when (e) {
                Lifecycle.Event.ON_START -> if (!gestartet) { ansicht.onStart(); gestartet = true }
                Lifecycle.Event.ON_RESUME -> if (!aktiv) { ansicht.onResume(); aktiv = true }
                Lifecycle.Event.ON_PAUSE -> if (aktiv) { ansicht.onPause(); aktiv = false }
                Lifecycle.Event.ON_STOP -> if (gestartet) { ansicht.onStop(); gestartet = false }
                else -> {}
            }
        }
        lebenszyklus.addObserver(beobachter)
        onDispose {
            lebenszyklus.removeObserver(beobachter)
            if (aktiv) ansicht.onPause()
            if (gestartet) ansicht.onStop()
            ansicht.onDestroy()
        }
    }

    LaunchedEffect(ansicht) {
        ansicht.getMapAsync { m ->
            m.uiSettings.isLogoEnabled = false
            m.uiSettings.isCompassEnabled = false
            m.uiSettings.isRotateGesturesEnabled = false
            m.uiSettings.isTiltGesturesEnabled = false
            m.uiSettings.attributionGravity = Gravity.BOTTOM or Gravity.END
            m.uiSettings.setAttributionTintColor(Color(0xCC999999).toArgb())
            m.moveCamera(CameraUpdateFactory.newLatLngZoom(LatLng(48.137154, 11.576124), 10.0))
            m.addOnCameraMoveListener { takt.intValue++ }
            m.addOnCameraIdleListener { takt.intValue++ }
            m.addOnMapClickListener { ll -> antippenAktuell(GeoPunkt(ll.latitude, ll.longitude)); true }
            KartenStil.stilSetzen(m) { s -> stil = s; takt.intValue++ }
            karte = m
        }
    }

    // MapLibre misst Linien in System-dp, das Raster ist breiter oder schmaler: umrechnen.
    val faktor = dichte.density / ctx.resources.displayMetrics.density
    LaunchedEffect(stil, schnell, aktuell) {
        val s = stil ?: return@LaunchedEffect
        // Grau zuerst, damit Lime darueber liegt.
        routenLinie(s, "route-schnellste", schnell, 0xFF666666.toInt(), 5f * faktor, true)
        routenLinie(s, "route-aktuell", aktuell, 0xFFE3F654.toInt(), 7f * faktor, false)
    }

    // Beim Oeffnen einmal auf die Route zoomen (oben Knoepfe, unten das Feld frei lassen).
    LaunchedEffect(karte, stil, einpassen) {
        val m = karte ?: return@LaunchedEffect
        if (stil == null || eingepasst || einpassen.isEmpty()) return@LaunchedEffect
        while (ansicht.width < 10 || ansicht.height < 10) delay(200)
        eingepasst = true
        fun px(dp: Float) = (dp * dichte.density).roundToInt()
        if (einpassen.size < 2) {
            val p = einpassen.first()
            m.moveCamera(CameraUpdateFactory.newLatLngZoom(LatLng(p.lat, p.lng), 13.0))
            return@LaunchedEffect
        }
        val nord = einpassen.maxOf { it.lat }; val sued = einpassen.minOf { it.lat }
        val ost = einpassen.maxOf { it.lng }; val west = einpassen.minOf { it.lng }
        if (nord - sued < 1e-6 && ost - west < 1e-6) {
            m.moveCamera(CameraUpdateFactory.newLatLngZoom(LatLng(nord, ost), 14.0))
            return@LaunchedEffect
        }
        val grenzen = LatLngBounds.Builder().include(LatLng(nord, ost)).include(LatLng(sued, west)).build()
        m.moveCamera(CameraUpdateFactory.newLatLngBounds(grenzen, px(40f), px(150f), px(40f), px(250f)))
    }

    Box(Modifier.fillMaxSize().background(hex(0x101112))) {
        AndroidView(factory = { ansicht }, modifier = Modifier.fillMaxSize())
        val m = karte
        if (m != null && stil != null) {
            Box(Modifier.fillMaxSize()) {
                val stoppAnzahl = maxOf(0, orte.size - 2)
                orte.forEachIndexed { i, o ->
                    if (o == null) return@forEachIndexed
                    when (i) {
                        0 -> KartenMarke(m, o, takt, 32f) { Kreis("A", 32f, LIME, Color.Black, 15f) }
                        orte.size - 1 -> KartenMarke(m, o, takt, 32f) { Kreis("B", 32f, LIME, Color.Black, 15f) }
                        else -> if (i <= stoppAnzahl) KartenMarke(m, o, takt, 26f) { Kreis("$i", 26f, Color.White, Color.Black, 13f) }
                    }
                }
                // Routenpunkte: schwarzer Kreis 22 mit Lime-Rand 4, Tippflaeche 44.
                punkte.forEachIndexed { i, p ->
                    KartenMarke(m, GeoPunkt(p.lat, p.lng), takt, 44f, Modifier.tippen { entfernen(i) }) {
                        Box(Modifier.size(22.dp).background(Color.Black, CircleShape).border(4.dp, LIME, CircleShape))
                    }
                }
            }
        }
    }
}

/** Baustein mittig auf einem Ort der Karte, wandert mit der Kamera mit. */
@Composable
private fun KartenMarke(karte: MapLibreMap, ort: GeoPunkt, takt: MutableIntState, groesse: Float, extra: Modifier = Modifier, inhalt: @Composable () -> Unit) {
    val halb = with(LocalDensity.current) { (groesse / 2f).dp.toPx() }
    Box(
        Modifier.offset {
            takt.intValue // neu platzieren, wenn sich die Karte bewegt
            val s = karte.projection.toScreenLocation(LatLng(ort.lat, ort.lng))
            IntOffset((s.x - halb).roundToInt(), (s.y - halb).roundToInt())
        }.size(groesse.dp).then(extra),
        contentAlignment = Alignment.Center,
    ) { inhalt() }
}

@Composable
private fun Kreis(text: String, groesse: Float, grund: Color, schrift: Color, schriftGroesse: Float) {
    Box(Modifier.size(groesse.dp).background(grund, CircleShape), contentAlignment = Alignment.Center) {
        Text(text, style = grotesk(schriftGroesse, 700, farbe = schrift), maxLines = 1, textAlign = TextAlign.Center)
    }
}

private fun routenLinie(stil: Style, kennung: String, pfad: List<GeoPunkt>, farbe: Int, breite: Float, gestrichelt: Boolean) {
    val daten = if (pfad.size >= 2) {
        FeatureCollection.fromFeature(Feature.fromGeometry(LineString.fromLngLats(pfad.map { Point.fromLngLat(it.lng, it.lat) })))
    } else {
        FeatureCollection.fromFeatures(emptyList<Feature>())
    }
    val quelle = stil.getSourceAs<GeoJsonSource>(kennung)
    if (quelle != null) { quelle.setGeoJson(daten); return }
    stil.addSource(GeoJsonSource(kennung, daten))
    val eigenschaften = mutableListOf<org.maplibre.android.style.layers.PropertyValue<*>>(
        PropertyFactory.lineColor(farbe),
        PropertyFactory.lineWidth(breite),
        PropertyFactory.lineCap(if (gestrichelt) Property.LINE_CAP_BUTT else Property.LINE_CAP_ROUND),
        PropertyFactory.lineJoin(Property.LINE_JOIN_ROUND),
    )
    if (gestrichelt) eigenschaften.add(PropertyFactory.lineDasharray(arrayOf(1.2f, 1.6f)))
    stil.addLayer(LineLayer(kennung, kennung).withProperties(*eigenschaften.toTypedArray()))
}
