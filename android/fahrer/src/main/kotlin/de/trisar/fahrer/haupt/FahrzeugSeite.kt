package de.trisar.fahrer.haupt

import android.annotation.SuppressLint
import android.graphics.Bitmap
import android.view.MotionEvent
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import coil3.SingletonImageLoader
import coil3.request.ImageRequest
import coil3.request.allowHardware
import coil3.svg.SvgDecoder
import coil3.toBitmap
import de.trisar.kern.FahrzeugBild
import de.trisar.kern.FahrzeugAngaben
import de.trisar.kern.FahrzeugFoto
import de.trisar.kern.FahrzeugKacheln
import de.trisar.kern.FahrzeugTest
import de.trisar.kern.StandortChip
import de.trisar.kern.FahrzeugZeile
import de.trisar.kern.FussleisteUnten
import de.trisar.kern.Icon
import de.trisar.kern.Konfig
import de.trisar.kern.SchrumpfText
import de.trisar.kern.TrisarHintergrund
import de.trisar.kern.VinZeile
import de.trisar.kern.ZurueckKnopf
import de.trisar.kern.grotesk
import de.trisar.kern.hex
import de.trisar.kern.platz
import de.trisar.kern.tippen
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import org.maplibre.android.MapLibre
import org.maplibre.android.camera.CameraPosition
import org.maplibre.android.camera.CameraUpdateFactory
import org.maplibre.android.geometry.LatLng
import org.maplibre.android.maps.MapLibreMap
import org.maplibre.android.maps.MapView
import org.maplibre.android.maps.Style
import org.maplibre.android.style.layers.PropertyFactory
import org.maplibre.android.style.layers.SymbolLayer
import org.maplibre.android.style.sources.GeoJsonSource
import org.maplibre.geojson.Point
import kotlin.math.max

/**
 * Nachbau von VehicleView.jsx wie FahrzeugAnsicht.swift (Raster 402 x 1264, Inhalt in einem Block bei top 20):
 * Zurueck, Karte mit Standort (Quelle + Alter als Chip), Fahrzeugblock, Fahrzeugdaten (OBD), Schadensbericht.
 */
@Composable
internal fun FahrzeugSeite(fahrerID: String, fahrzeug: FahrzeugZeile?, zurueck: () -> Unit) {
    val ctx = LocalContext.current
    val bereich = rememberCoroutineScope()
    val daten = remember(fahrerID) { FahrzeugDaten(ctx.applicationContext, fahrerID, bereich) }
    val standort by daten.standort.collectAsState()
    val standortQuelle by daten.standortQuelle.collectAsState()
    val standortZeit by daten.standortZeit.collectAsState()
    val ausstattung by daten.ausstattung.collectAsState()
    val telemetrie by daten.telemetrie.collectAsState()
    val ereignisse by daten.ereignisse.collectAsState()
    val stand by daten.telemetrieStand.collectAsState()
    val schaeden by daten.schaeden.collectAsState()
    var meldenOffen by remember { mutableStateOf(false) }
    var unterHoehe by remember { mutableFloatStateOf(0f) }
    val dichte = LocalDensity.current

    LaunchedEffect(daten, fahrzeug?.id) { daten.starten(fahrzeug?.id) }
    DisposableEffect(daten) {
        onDispose { CoroutineScope(Dispatchers.Main).launch { daten.beenden() } }
    }
    DisposableEffect(Unit) {
        onDispose { de.trisar.kern.NfcTagDienst.activity(ctx)?.let { de.trisar.kern.NfcTagDienst.stoppen(it) } }
    }

    val versatz = 20f
    val angaben = FahrzeugAngaben.aus(fahrzeug, ausstattung)
    val raster = angaben.blockRaster()
    // Ohne Standort rueckt der Fahrzeugblock an die Stelle der Karte, darunter folgt alles
    // seiner Hoehe (die je nach vorhandenen Angaben schrumpft).
    val blockOben = if (standort == null) 99f else 440f
    // Ohne Fahrzeug: Knopf zum Scannen des Trackers unter dem Block.
    val scanHoehe = if (fahrzeug == null) 76f else 0f
    val unterBlock = blockOben + raster.hoehe - 1f + scanHoehe
    // Web: max(1264, Unterkante Bericht) + 40 Seitenversatz + 70 Platz fuer die Fussleiste.
    val inhalt = max(1264f, unterBlock + unterHoehe) + 40f + 70f

    Box(Modifier.fillMaxSize()) {
        Leinwand(inhaltHoehe = inhalt, mitHintergrund = false) { rahmen ->
            TrisarHintergrund(Modifier.size(402.dp, max(inhalt, rahmen).dp))

            ZurueckKnopf(Modifier.platz(20f, versatz + 40f), zurueck)

            standort?.let {
                Box(Modifier.platz(24.5f, versatz + 99f, 353f, 324f), contentAlignment = Alignment.BottomStart) {
                    StandortKarte(it, Modifier.fillMaxSize())
                    // Woher der Standort kommt und wie alt er ist.
                    if (standortQuelle.isNotEmpty()) StandortChip(standortQuelle, standortZeit, Modifier.padding(10.dp))
                }
            }

            FahrzeugBlock(angaben, raster, Modifier.platz(24.5f, versatz + blockOben, 353f, raster.hoehe))

            if (fahrzeug == null) {
                Box(
                    Modifier.platz(24.5f, versatz + blockOben + raster.hoehe + 9f, 353f, 56f).background(hex(0xE3F754))
                        .tippen { de.trisar.fahrer.NfcTag.scannen(ctx) },
                    contentAlignment = Alignment.Center,
                ) {
                    androidx.compose.material3.Text("Tracker scannen", style = grotesk(18f, 700, farbe = androidx.compose.ui.graphics.Color.Black))
                }
            }

            Column(
                Modifier.platz(24.5f, versatz + unterBlock, 353f).onSizeChanged { unterHoehe = with(dichte) { it.height.toDp().value } },
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                if (telemetrie.isNotEmpty() && !FahrzeugTest.nurKennzeichen) TelemetrieBlock(telemetrie, ereignisse, stand)
                SchadensBericht(schaeden) { meldenOffen = true }
            }
        }
        FussleisteUnten()

        if (meldenOffen) {
            Vollbild {
                SchadenMeldenSeite(schliessen = { meldenOffen = false }) { stelle, beschreibung, fotos, genau ->
                    val ok = daten.melden(stelle, beschreibung, fotos, genau)
                    if (ok) meldenOffen = false
                    ok
                }
            }
        }
    }
}

/** Fahrzeugblock (353 breit, weiss, mit allen Angaben 332 hoch). Nur Angaben mit Wert. */
@Composable
private fun FahrzeugBlock(a: FahrzeugAngaben, r: FahrzeugAngaben.BlockRaster, modifier: Modifier) {
    val blass = Color(28, 28, 29).copy(alpha = 0.15f)
    Box(modifier.background(Color.White)) {
        SchrumpfText(a.kennzeichen.ifEmpty { "Kein Fahrzeug" }, grotesk(30f, 700, abstand = -0.5f, farbe = hex(0x1C1C1D)), 353f,
            Modifier.platz(0f, 15.29f, 353f, 36.68f))
        val bild = a.bild
        r.bild?.let { o -> if (bild != null) FahrzeugFoto(bild, Modifier.platz(51f, o, 250f, 122f)) }
        r.vin?.let { VinZeile(a.vin, Modifier.platz(0f, it, 353f)) }
        r.modell?.let { SchrumpfText(a.modell, grotesk(20f, 700, abstand = -0.5f, farbe = hex(0x1C1C1D)), 353f,
            Modifier.platz(0f, it, 353f), minFaktor = 0.6f) }
        r.ausstattung?.let { Text(a.ausstattung, style = grotesk(13f, farbe = blass), textAlign = TextAlign.Center,
            modifier = Modifier.platz(0f, it, 353f)) }
        r.kacheln?.let { FahrzeugKacheln(a, Modifier.platz(0f, it, 353f)) }
    }
}

/** Fahrzeugdaten (FahrzeugTelemetrie.jsx). */
@Composable
private fun TelemetrieBlock(zeilen: List<FahrzeugDaten.TelemetrieZeile>, ereignisse: List<FahrzeugDaten.Ereignis>, stand: String) {
    val grundfarbe = Color(28, 28, 29)
    Column(Modifier.width(353.dp).background(Color.White).padding(29.dp)) {
        Text("Fahrzeugdaten (OBD)", style = grotesk(20f, 700, abstand = -0.5f, farbe = hex(0x1C1C1D)))
        Box(Modifier.padding(top = 12.dp, bottom = 14.dp).fillMaxWidth().height(1.dp).background(hex(0xDDDCDC)))
        Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
            for (reihe in zeilen.chunked(3)) {
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    for (z in reihe) {
                        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                            Text(z.titel, style = grotesk(11f, farbe = grundfarbe.copy(alpha = 0.5f)), maxLines = 1)
                            Text(z.wert, style = grotesk(18f, 700, farbe = if (z.warnung) hex(0xD9381E) else hex(0x1C1C1D)), maxLines = 1)
                        }
                    }
                    repeat(3 - reihe.size) { Spacer(Modifier.weight(1f)) }
                }
            }
        }
        if (ereignisse.isNotEmpty()) {
            Column(Modifier.padding(top = 14.dp)) {
                for (e in ereignisse) {
                    Box(Modifier.height(18.dp), contentAlignment = Alignment.CenterStart) {
                        Text("${e.zeit} · ${e.text}", style = grotesk(12f, farbe = grundfarbe.copy(alpha = 0.6f)), maxLines = 1)
                    }
                }
            }
        }
        if (stand.isNotEmpty()) {
            Text("Stand $stand", style = grotesk(11f, farbe = grundfarbe.copy(alpha = 0.35f)), modifier = Modifier.padding(top = 10.dp))
        }
    }
}

/** Schadensbericht mit Liste und „Schaden melden“. */
@Composable
private fun SchadensBericht(schaeden: List<FahrzeugDaten.Schaden>, melden: () -> Unit) {
    Column(Modifier.width(353.dp).background(Color.White).padding(29.dp)) {
        Text("Schadensbericht", style = grotesk(15f, 700, abstand = -0.5f, farbe = hex(0xDDDCDC)), modifier = Modifier.padding(bottom = 10.dp))
        Box(Modifier.padding(bottom = 10.dp).fillMaxWidth().height(1.dp).background(hex(0xDDDCDC)))
        schaeden.forEachIndexed { i, s ->
            Column(Modifier.padding(bottom = 10.dp)) {
                Text(s.datum, style = grotesk(15f, 700, abstand = -0.5f, farbe = hex(0xDDDCDC)), modifier = Modifier.padding(bottom = 10.dp))
                Row(Modifier.fillMaxWidth().padding(bottom = 10.dp), horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                    Column(Modifier.weight(1f)) {
                        Text(s.stelle, style = grotesk(10f, 700, abstand = -0.5f, farbe = hex(0x1D1C1C)), modifier = Modifier.padding(bottom = 5.dp))
                        Text(s.beschreibung, style = grotesk(14f, 700, abstand = -0.5f, farbe = hex(0x1D1C1C)))
                    }
                    s.punkt?.let { de.trisar.kern.FahrzeugSkizzeAnsicht(it, 96f) }
                }
                if (s.bilder.isNotEmpty()) {
                    Row(Modifier.padding(bottom = 10.dp), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                        for (url in s.bilder) {
                            val bild = remember(url) { ProfilDienst.bildAusDataURL(url) }
                            if (bild != null) {
                                androidx.compose.foundation.Image(bild.asImageBitmapSicher(), null, Modifier.weight(1f).height(96.dp), contentScale = ContentScale.Crop)
                            } else {
                                FahrzeugBild(url, Modifier.weight(1f).height(96.dp), platzhalter = hex(0xF4F4F4), skalierung = ContentScale.Crop)
                            }
                        }
                    }
                }
                if (i < schaeden.size - 1) Box(Modifier.padding(bottom = 10.dp).fillMaxWidth().height(1.dp).background(hex(0xDDDCDC)))
            }
        }
        Row(
            Modifier.padding(top = 10.dp).fillMaxWidth().height(56.dp).background(hex(0xE3F654)).tippen(melden).padding(horizontal = 24.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text("Schaden melden", style = grotesk(16f, 700, abstand = -0.5f, farbe = Color.Black))
            Spacer(Modifier.weight(1f))
            Icon("PfeilDunkel", Modifier.size(34.dp, 20.dp))
        }
    }
}

internal fun Bitmap.asImageBitmapSicher() = asImageBitmap()

/**
 * Karte (Start Zoom 15) mit dem Standortpunkt, zoom- und verschiebbar (Drehen und Kippen aus),
 * wie StandortKarte in iOS. CARTO Dark Matter wie Web und iOS.
 */
@SuppressLint("ClickableViewAccessibility")
@Composable
internal fun StandortKarte(ort: Ort, modifier: Modifier) {
    val ctx = LocalContext.current
    val lebenszyklus = LocalLifecycleOwner.current.lifecycle
    // Punkt in der Rastergroesse 30 auf echte Pixel umrechnen.
    val punktPx = with(LocalDensity.current) { 30.dp.roundToPx() }
    val karteZustand = remember { arrayOfNulls<MapLibreMap>(1) }
    val letzter = remember { arrayOfNulls<Ort>(1) }

    val ansicht = remember {
        MapLibre.getInstance(ctx.applicationContext)
        MapView(ctx).apply {
            onCreate(null)
            // Karte im scrollbaren Bildschirm: Gesten gehoeren der Karte, nicht der Seite.
            setOnTouchListener { v, e ->
                if (e.actionMasked == MotionEvent.ACTION_DOWN) v.parent?.requestDisallowInterceptTouchEvent(true)
                false
            }
            setBackgroundColor(android.graphics.Color.rgb(0x10, 0x11, 0x12))
            getMapAsync { karte ->
                karteZustand[0] = karte
                karte.uiSettings.apply {
                    isRotateGesturesEnabled = false
                    isTiltGesturesEnabled = false
                    isCompassEnabled = false
                    isLogoEnabled = false
                    isZoomGesturesEnabled = true
                    isScrollGesturesEnabled = true
                    isDoubleTapGesturesEnabled = true
                    attributionGravity = android.view.Gravity.BOTTOM or android.view.Gravity.END
                }
                karte.cameraPosition = CameraPosition.Builder().target(LatLng(ort.lat, ort.lng)).zoom(15.0).build()
                letzter[0] = ort
                karte.setStyle(Style.Builder().fromUri(Konfig.KARTEN_STIL)) { stil ->
                    stil.addSource(GeoJsonSource("standort", Point.fromLngLat(ort.lng, ort.lat)))
                    stil.addLayer(SymbolLayer("standort", "standort").withProperties(
                        PropertyFactory.iconImage("standort-punkt"),
                        PropertyFactory.iconAllowOverlap(true),
                        PropertyFactory.iconIgnorePlacement(true),
                    ))
                    // Punkt-Bild aus dem SVG (user-location-dot) laden.
                    CoroutineScope(Dispatchers.Main).launch {
                        val anfrage = ImageRequest.Builder(ctx)
                            .data("file:///android_asset/icon/user-location-dot.svg")
                            .decoderFactory(SvgDecoder.Factory())
                            .size(punktPx, punktPx)
                            .allowHardware(false)
                            .build()
                        val bild = SingletonImageLoader.get(ctx).execute(anfrage).image?.toBitmap(punktPx, punktPx) ?: return@launch
                        bild.density = ctx.resources.displayMetrics.densityDpi
                        if (stil.isFullyLoaded) stil.addImage("standort-punkt", bild)
                    }
                }
            }
        }
    }

    DisposableEffect(lebenszyklus) {
        val beobachter = LifecycleEventObserver { _, ereignis ->
            when (ereignis) {
                Lifecycle.Event.ON_START -> ansicht.onStart()
                Lifecycle.Event.ON_RESUME -> ansicht.onResume()
                Lifecycle.Event.ON_PAUSE -> ansicht.onPause()
                Lifecycle.Event.ON_STOP -> ansicht.onStop()
                else -> {}
            }
        }
        lebenszyklus.addObserver(beobachter)
        if (lebenszyklus.currentState.isAtLeast(Lifecycle.State.STARTED)) ansicht.onStart()
        if (lebenszyklus.currentState.isAtLeast(Lifecycle.State.RESUMED)) ansicht.onResume()
        onDispose {
            lebenszyklus.removeObserver(beobachter)
            ansicht.onPause(); ansicht.onStop(); ansicht.onDestroy()
        }
    }

    // Nur bei echter Bewegung (> 5 m) neu zentrieren, sonst bremst es die Karte.
    LaunchedEffect(ort) {
        val karte = karteZustand[0] ?: return@LaunchedEffect
        val alt = letzter[0]
        if (alt != null) {
            val weg = FloatArray(1)
            android.location.Location.distanceBetween(alt.lat, alt.lng, ort.lat, ort.lng, weg)
            if (weg[0] <= 5f) return@LaunchedEffect
        }
        letzter[0] = ort
        karte.style?.getSourceAs<GeoJsonSource>("standort")?.setGeoJson(Point.fromLngLat(ort.lng, ort.lat))
        karte.moveCamera(CameraUpdateFactory.newLatLng(LatLng(ort.lat, ort.lng)))
    }

    AndroidView({ ansicht }, modifier)
}
