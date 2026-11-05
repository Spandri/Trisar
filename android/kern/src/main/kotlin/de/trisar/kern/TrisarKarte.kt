package de.trisar.kern

import android.graphics.Color as AColor
import android.view.Gravity
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.State
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.layout.layout
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import kotlinx.coroutines.delay
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
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.roundToInt

/** Kollege der Kolonne: Lime-Pin, Fahrernummer (15 fett) oder Kuerzel (13 fett). */
data class KartenKollege(val ort: GeoPunkt, val beschriftung: String, val nummer: Boolean)

/** Was die Karte zeigt, wie KarteAnsicht.Inhalt in iOS. */
data class KartenInhalt(
    val anfahrt: List<GeoPunkt> = emptyList(),     // gelb gestrichelt
    val fahrt: List<GeoPunkt> = emptyList(),       // blau
    val abholort: GeoPunkt? = null,                // roter Pin
    val ziel: GeoPunkt? = null,                    // Ziel-Pin
    val fahrer: GeoPunkt? = null,                  // blauer Punkt mit Fahrernummer
    val fahrerNummer: String = "",
    val anfahrtMinuten: Int? = null,
    val fahrtMinuten: Int? = null,
    val flugzeug: GeoPunkt? = null,                // Live-Position des Flugs
    val flugKurs: Double = 0.0,
    val flugSpur: List<GeoPunkt> = emptyList(),    // Lime, 3 breit
    val kollegen: List<KartenKollege> = emptyList(),
)

/** formatDuration der Web-App: "12 min" oder "1:05 h". */
fun kartenDauer(m: Int): String = when {
    m <= 0 -> "0 min"
    m < 60 -> "$m min"
    else -> "${m / 60}:${"%02d".format(m % 60)} h"
}

private val KARTEN_MITTE = GeoPunkt(48.1215, 11.6644)

/**
 * Karte der Fahrt-Ansicht, Nachbau von KarteAnsicht.swift (GoogleMapComponent in SoloNormal.jsx).
 * MapLibre mit CARTO Dark Matter, Linien als Ebenen, Pins als Compose-Bausteine ueber der Karte.
 * untenFrei: Hoehe (Raster-dp) des Blatts darueber, damit die Route im freien Teil liegt.
 */
@Composable
fun TrisarKarte(inhalt: KartenInhalt, untenFrei: Float, modifier: Modifier = Modifier) {
    val ctx = LocalContext.current
    val dichte = LocalDensity.current
    val kartenAnsicht = remember {
        MapLibre.getInstance(ctx)
        MapView(ctx).apply { onCreate(null) }
    }
    var karte by remember { mutableStateOf<MapLibreMap?>(null) }
    var stil by remember { mutableStateOf<Style?>(null) }
    val kamera = remember { mutableIntStateOf(0) }
    val zuletzt = remember { arrayOfNulls<Any>(1) }

    // Lebenszyklus der MapView an die Seite haengen.
    val lebenszyklus = LocalLifecycleOwner.current.lifecycle
    DisposableEffect(lebenszyklus) {
        var gestartet = false
        var aktiv = false
        val beobachter = LifecycleEventObserver { _, e ->
            when (e) {
                Lifecycle.Event.ON_START -> { kartenAnsicht.onStart(); gestartet = true }
                Lifecycle.Event.ON_RESUME -> { kartenAnsicht.onResume(); aktiv = true }
                Lifecycle.Event.ON_PAUSE -> { kartenAnsicht.onPause(); aktiv = false }
                Lifecycle.Event.ON_STOP -> { kartenAnsicht.onStop(); gestartet = false }
                else -> {}
            }
        }
        lebenszyklus.addObserver(beobachter)
        onDispose {
            lebenszyklus.removeObserver(beobachter)
            if (aktiv) kartenAnsicht.onPause()
            if (gestartet) kartenAnsicht.onStop()
            kartenAnsicht.onDestroy()
        }
    }

    LaunchedEffect(kartenAnsicht) {
        kartenAnsicht.getMapAsync { m ->
            m.uiSettings.isLogoEnabled = false
            m.uiSettings.isCompassEnabled = false
            m.uiSettings.isRotateGesturesEnabled = false
            m.uiSettings.isTiltGesturesEnabled = false
            // Wie im Web (attributionControl compact): unten rechts, dort liegt das Infoblatt darueber.
            m.uiSettings.attributionGravity = Gravity.BOTTOM or Gravity.END
            m.uiSettings.setAttributionTintColor(AColor.argb(204, 153, 153, 153))
            m.moveCamera(CameraUpdateFactory.newLatLngZoom(LatLng(KARTEN_MITTE.lat, KARTEN_MITTE.lng), 12.0))
            m.addOnCameraMoveListener { kamera.intValue++ }
            m.addOnCameraIdleListener { kamera.intValue++ }
            m.setStyle(Style.Builder().fromUri(Konfig.KARTEN_STIL)) { s -> stil = s; kamera.intValue++ }
            karte = m
        }
    }

    // Linien: MapLibre misst in System-dp, das Raster ist breiter oder schmaler. Darum umrechnen.
    val faktor = dichte.density / ctx.resources.displayMetrics.density
    LaunchedEffect(stil, inhalt.fahrt, inhalt.anfahrt, inhalt.flugSpur) {
        val s = stil ?: return@LaunchedEffect
        linie(s, "fahrt", inhalt.fahrt, 0xFF0059FF.toInt(), 6f * faktor, false)
        linie(s, "anfahrt", inhalt.anfahrt, 0xFFE3F654.toInt(), 5f * faktor, true)
        linie(s, "flugspur", inhalt.flugSpur, 0xFFE3F654.toInt(), 3f * faktor, false, 0.95f)
    }

    // Ausschnitt (fitBounds mit Polsterung wie getFitPadding).
    LaunchedEffect(karte, stil, inhalt, untenFrei) {
        val m = karte ?: return@LaunchedEffect
        if (stil == null) return@LaunchedEffect
        // Vor dem ersten Layout hat die Karte keine Groesse, dann spaeter nochmal.
        while (kartenAnsicht.width < 10 || kartenAnsicht.height < 10) delay(200)
        val alle = inhalt.fahrt + inhalt.anfahrt + listOfNotNull(inhalt.abholort, inhalt.ziel, inhalt.flugzeug) + inhalt.kollegen.map { it.ort }
        if (alle.size < 2) {
            (inhalt.fahrer ?: alle.firstOrNull())?.let { m.moveCamera(CameraUpdateFactory.newLatLngZoom(LatLng(it.lat, it.lng), 13.0)) }
            return@LaunchedEffect
        }
        val hoeheDp = kartenAnsicht.height / dichte.density
        val schluessel = Triple(alle.size, (alle[0].lat * 1e5).toInt(), untenFrei + hoeheDp)
        if (zuletzt[0] == schluessel) return@LaunchedEffect
        zuletzt[0] = schluessel
        val nord = alle.maxOf { it.lat }; val sued = alle.minOf { it.lat }
        val ost = alle.maxOf { it.lng }; val west = alle.minOf { it.lng }
        if (nord - sued < 1e-6 && ost - west < 1e-6) {
            m.moveCamera(CameraUpdateFactory.newLatLngZoom(LatLng(nord, ost), 15.0))
            return@LaunchedEffect
        }
        val grenzen = LatLngBounds.Builder().include(LatLng(nord, ost)).include(LatLng(sued, west)).build()
        // Kollegen-Pins ragen nach oben ueber ihren Ort, dafuer oben 42 mehr Platz.
        fun px(dp: Float) = (dp * dichte.density).roundToInt()
        val oben = px(44f + if (inhalt.kollegen.isEmpty()) 0f else 42f)
        val unten = px(max(170f, untenFrei + 12f))
        m.easeCamera(CameraUpdateFactory.newLatLngBounds(grenzen, px(28f), oben, px(28f), unten), 300)
    }

    Box(modifier.background(hex(0x101112))) {
        AndroidView(factory = { kartenAnsicht }, modifier = Modifier.fillMaxSize())
        val m = karte
        if (m != null && stil != null) {
            Box(Modifier.fillMaxSize()) {
                inhalt.ziel?.let { PinBild("Ziel_Pin_Trisar_01", Modifier.amOrt(m, it, kamera, true)) }
                inhalt.abholort?.let { PinBild("Abholort_Pin_Trisar_01_rot", Modifier.amOrt(m, it, kamera, true)) }
                inhalt.kollegen.forEach { k -> KollegenPin(k, Modifier.amOrt(m, k.ort, kamera, true)) }
                inhalt.flugzeug?.let {
                    Icon("Flugzeug_Karte_Trisar_01_lime", Modifier.amOrt(m, it, kamera, false).size(46.dp).rotate(inhalt.flugKurs.toFloat()))
                }
                Zeitblasen(m, inhalt, kamera)
                inhalt.fahrer?.let { FahrerPunkt(inhalt.fahrerNummer, Modifier.amOrt(m, it, kamera, false)) }
            }
        }
    }
}

/** Legt einen Baustein auf einen Ort der Karte: Spitze unten (Pins) oder Mitte (Punkte). */
private fun Modifier.amOrt(karte: MapLibreMap, ort: GeoPunkt, kamera: State<Int>, spitzeUnten: Boolean): Modifier = layout { m, _ ->
    val p = m.measure(Constraints())
    layout(0, 0) {
        kamera.value // neu platzieren, wenn sich die Karte bewegt
        val s = karte.projection.toScreenLocation(LatLng(ort.lat, ort.lng))
        val y = if (spitzeUnten) s.y - p.height else s.y - p.height / 2f
        p.place((s.x - p.width / 2f).roundToInt(), y.roundToInt())
    }
}

@Composable
private fun PinBild(name: String, modifier: Modifier) {
    Icon(name, modifier.size(35.dp, 41.1367.dp))
}

/** Kollege: Kollege_Pin_Trisar_01_lime 35 x 41, Spitze auf dem Ort, Text im Kopf (Mitte bei 17,5). */
@Composable
private fun KollegenPin(k: KartenKollege, modifier: Modifier) {
    Box(modifier.size(35.dp, 41.1367.dp)) {
        Icon("Kollege_Pin_Trisar_01_lime", Modifier.fillMaxSize())
        Box(Modifier.offset(y = 5.5.dp).size(35.dp, 24.dp), contentAlignment = Alignment.Center) {
            Text(k.beschriftung, style = grotesk(if (k.nummer) 15f else 13f, 700, farbe = hex(0x1A1A1A)), textAlign = TextAlign.Center, maxLines = 1)
        }
    }
}

/** Blauer Standortpunkt (35 x 35) mit Fahrernummer, weiss 20 fett. */
@Composable
private fun FahrerPunkt(nummer: String, modifier: Modifier) {
    Box(modifier.size(35.dp), contentAlignment = Alignment.Center) {
        Icon("Fahrer_Standort_Trisar_01_blau", Modifier.fillMaxSize())
        Text(nummer, style = grotesk(20f, 700), textAlign = TextAlign.Center, maxLines = 1)
    }
}

/**
 * Zeitblasen auf der Routenmitte (Pille, 13 fett, Schatten, Unterkante auf dem Punkt).
 * entzerreDauerLabels: liegen beide uebereinander, wird die untere mit 8 Luft nach oben geschoben.
 */
@Composable
private fun Zeitblasen(karte: MapLibreMap, inhalt: KartenInhalt, kamera: State<Int>) {
    data class Blase(val ort: GeoPunkt, val text: String, val hinten: Color, val vorne: Color)
    val blasen = buildList {
        val f = inhalt.fahrtMinuten
        if (f != null && inhalt.fahrt.size >= 2) add(Blase(inhalt.fahrt[inhalt.fahrt.size / 2], kartenDauer(f), hex(0x0059FF), Color.White))
        val a = inhalt.anfahrtMinuten
        if (a != null && a > 0 && inhalt.anfahrt.size >= 2) add(Blase(inhalt.anfahrt[inhalt.anfahrt.size / 2], kartenDauer(a), hex(0xE3F654), hex(0x111111)))
    }
    if (blasen.isEmpty()) return
    Layout(content = {
        blasen.forEach { b ->
            Box(
                Modifier.shadow(9.dp, RoundedCornerShape(50), ambientColor = Color.Black, spotColor = Color.Black)
                    .background(b.hinten, RoundedCornerShape(50))
                    .padding(horizontal = 12.dp, vertical = 6.dp)
            ) { Text(b.text, style = grotesk(13f, 700, farbe = b.vorne), maxLines = 1) }
        }
    }) { messbare, _ ->
        val teile = messbare.map { it.measure(Constraints()) }
        layout(0, 0) {
            kamera.value
            val luft = 8.dp.toPx()
            val punkte = blasen.map { karte.projection.toScreenLocation(LatLng(it.ort.lat, it.ort.lng)) }
            val reihe = punkte.indices.sortedBy { punkte[it].y }
            val verschoben = FloatArray(blasen.size)
            reihe.forEachIndexed { i, idx ->
                var dy = 0f
                val h = teile[idx].height.toFloat(); val w = teile[idx].width.toFloat()
                val pt = punkte[idx]
                for (j in 0 until i) {
                    val o = reihe[j]
                    val obenUnten = punkte[o].y - verschoben[o]
                    val obenOben = obenUnten - teile[o].height
                    val meinUnten = pt.y - dy
                    val meinOben = meinUnten - h
                    val waagerecht = abs(pt.x - punkte[o].x) < (w + teile[o].width) / 2 + luft
                    val senkrecht = meinOben < obenUnten + luft && meinUnten > obenOben - luft
                    if (waagerecht && senkrecht) dy = pt.y - (obenOben - luft)
                }
                verschoben[idx] = dy
                teile[idx].place((pt.x - w / 2).roundToInt(), (pt.y - h - dy).roundToInt())
            }
        }
    }
}

private fun linie(stil: Style, kennung: String, pfad: List<GeoPunkt>, farbe: Int, breite: Float, gestrichelt: Boolean, deckkraft: Float = 1f) {
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
        PropertyFactory.lineCap(Property.LINE_CAP_ROUND),
        PropertyFactory.lineJoin(Property.LINE_JOIN_ROUND),
        PropertyFactory.lineOpacity(deckkraft),
    )
    if (gestrichelt) eigenschaften.add(PropertyFactory.lineDasharray(arrayOf(0.8f, 1.6f)))
    stil.addLayer(LineLayer(kennung, kennung).withProperties(*eigenschaften.toTypedArray()))
}
