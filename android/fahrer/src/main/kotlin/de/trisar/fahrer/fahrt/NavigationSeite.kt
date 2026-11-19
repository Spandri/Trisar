package de.trisar.fahrer.fahrt

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.Canvas as ACanvas
import android.graphics.Color as AColor
import android.graphics.Paint
import android.graphics.Path as APath
import android.graphics.PointF
import android.os.Looper
import android.os.SystemClock
import android.view.Gravity
import android.view.MotionEvent
import android.view.ViewConfiguration
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Fill
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.graphics.drawscope.withTransform
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.google.android.gms.location.LocationCallback
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationResult
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import de.trisar.kern.GeoPunkt
import de.trisar.kern.Konfig
import de.trisar.kern.grotesk
import de.trisar.kern.hex
import de.trisar.kern.kartenDauer
import de.trisar.kern.tippen
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay
import org.maplibre.android.MapLibre
import org.maplibre.android.camera.CameraPosition
import org.maplibre.android.camera.CameraUpdateFactory
import org.maplibre.android.geometry.LatLng
import org.maplibre.android.geometry.LatLngBounds
import org.maplibre.android.gestures.RotateGestureDetector
import org.maplibre.android.gestures.ShoveGestureDetector
import org.maplibre.android.maps.MapLibreMap
import org.maplibre.android.maps.MapView
import org.maplibre.android.maps.Style
import org.maplibre.android.style.expressions.Expression
import org.maplibre.android.style.layers.CircleLayer
import org.maplibre.android.style.layers.LineLayer
import org.maplibre.android.style.layers.Property
import org.maplibre.android.style.layers.PropertyFactory
import org.maplibre.android.style.layers.SymbolLayer
import org.maplibre.android.style.sources.GeoJsonSource
import org.maplibre.geojson.Feature
import org.maplibre.geojson.FeatureCollection
import org.maplibre.geojson.LineString
import org.maplibre.geojson.Point
import java.time.Instant
import kotlin.math.abs
import kotlin.math.ceil
import kotlin.math.hypot
import kotlin.math.roundToInt

private val NAVI_LIME = hex(0xE2F754)
private val NAVI_ORANGE = hex(0xFF9F43)
private val NAVI_KACHEL = hex(0x242525)
private val NAVI_BLAU = hex(0x2F6BFF)
/** Anfahrtslinie, wenn die Route der Dispo als Vorschau mitkommt. */
private val NAVI_ANFAHRT = hex(0x0059FF)
private const val NAVI_SPEICHER = "trisar_navi"

/**
 * Eigene Navigation (16.11.): Vollbild ueber dem Fahrtblatt, fuehrt entlang der Route der Dispo.
 * Karte in Fahrtrichtung, Banner mit dem naechsten Abbiegen, Fuss mit Ankunft, Ton und Beenden.
 * Die Karte ist frei bedienbar: Knoepfe „Uebersicht“ und (in freier Karte) „Zentrieren“ ueber dem Fuss.
 * Laeuft nur, solange die Ansicht offen ist. unterwegs = Gast an Bord (sonst Anfahrt zum Abholort).
 */
@Composable
internal fun NavigationSeite(fahrtID: String, unterwegs: Boolean, schliessen: () -> Unit) {
    val ctx = LocalContext.current
    val bereich = rememberCoroutineScope()
    val speicher = remember { ctx.applicationContext.getSharedPreferences(NAVI_SPEICHER, Context.MODE_PRIVATE) }
    var stumm by remember { mutableStateOf(speicher.getBoolean("stumm", false)) }
    val stimme = remember { NaviStimme(ctx).also { it.stumm = stumm } }
    val lauf = remember(fahrtID) { NaviLauf(fahrtID, unterwegs, bereich, stimme) }
    var jetzt by remember { mutableStateOf(Instant.now()) }
    var fussHoehe by remember { mutableIntStateOf(0) }
    val kamera = remember { NaviKamera() }

    DisposableEffect(lauf) { onDispose { lauf.ende() } }
    // Wechsel von der Anfahrt in „unterwegs“: die Route der Fahrt laden.
    LaunchedEffect(unterwegs) { lauf.phase(unterwegs) }
    LaunchedEffect(Unit) { while (true) { delay(10_000); jetzt = Instant.now() } }
    NaviStandort { lauf.standort(it) }

    // Bildschirm bleibt an, solange die Navigation offen ist.
    val ansicht = LocalView.current
    DisposableEffect(ansicht) {
        val vorher = ansicht.keepScreenOn
        ansicht.keepScreenOn = true
        onDispose { ansicht.keepScreenOn = vorher }
    }
    BackHandler { schliessen() }

    val route = lauf.route
    val fix = lauf.fix
    val restLinie = remember(route, lauf.abschnitt, lauf.anteil) { route?.rest(lauf.abschnitt, lauf.anteil).orEmpty() }
    // Auf der Route liegt der Fahrer genau auf der Linie, abseits am echten Standort.
    val ort = if (route != null && !lauf.abseits && lauf.abstand <= 30.0) restLinie.firstOrNull() ?: fix?.ort else fix?.ort
    // Route der Dispo ab Abholort, nur bei der Anfahrt (17.11.). Am Abholort nur noch sie.
    val vorschau = if (lauf.bisAbholung) route?.vorschau else null
    val amAbholort = vorschau != null && lauf.angekommen

    // Tipps nicht an das Fahrtblatt darunter durchlassen.
    Box(Modifier.fillMaxSize().background(hex(0x0E0E0E)).pointerInput(Unit) { detectTapGestures { } }) {
        NaviKarte(
            kamera, if (amAbholort) emptyList() else restLinie, lauf.abseits, vorschau?.punkte.orEmpty(), amAbholort,
            ort, lauf.kartenKurs ?: 0.0, fussHoehe, Modifier.fillMaxSize(),
        )

        // Banner und Lasche „dann“
        Column(Modifier.padding(start = 12.dp, end = 12.dp, top = 54.dp).fillMaxWidth()) {
            val nr = route?.naechster(lauf.stelle)
            val hinweis = if (route != null && nr != null) route.hinweise.getOrNull(nr) else null
            when {
                route != null && lauf.abseits ->
                    Banner("wenden", NAVI_ORANGE, "Abseits der Route", 22f, "Zurück zur Route von Dispo", 15f)
                route == null && fix == null -> Banner("gerade", NAVI_LIME, null, 0f, "Warte auf Standort", 18f)
                route == null && lauf.fehler -> Banner("gerade", NAVI_LIME, null, 0f, "Route konnte nicht geladen werden", 18f)
                route == null -> Banner("gerade", NAVI_LIME, null, 0f, "Route wird geladen", 18f)
                lauf.angekommen ->
                    Banner("ziel", NAVI_LIME, if (lauf.bisAbholung) "Abholort erreicht" else "Ziel erreicht", 22f, null, 0f)
                nr != null && hinweis != null -> {
                    Banner(hinweis.pfeil, NAVI_LIME, NaviRechnen.entfernung(hinweis.m - lauf.stelle), 32f, hinweis.kurz, 18f)
                    // Uebernaechster Hinweis, nur wenn er kurz nach dem naechsten kommt.
                    val dann = route.hinweise.getOrNull(nr + 1)
                    if (dann != null && dann.m - hinweis.m < 300.0) DannLasche(dann)
                }
                else -> Banner("gerade", NAVI_LIME, null, 0f, "Der Route folgen", 18f)
            }
            if (vorschau != null && !lauf.abseits) {
                Spacer(Modifier.height(8.dp))
                Legende(if (amAbholort) "Route Dispo · ${NaviRechnen.vorschauText(vorschau.laenge, vorschau.dauer)}" else null)
            }
        }

        // Rechts ueber dem Fuss: Zentrieren (nur in freier Karte, Lime damit er auffaellt) und darunter Uebersicht.
        Column(
            Modifier.align(Alignment.BottomEnd)
                .padding(end = 12.dp, bottom = with(LocalDensity.current) { fussHoehe.toDp() } + 12.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            if (!kamera.folgen) {
                Box(Modifier.size(50.dp).background(NAVI_LIME, CircleShape).tippen { kamera.zentrieren() }, contentAlignment = Alignment.Center) {
                    ZentrierenZeichen()
                }
            }
            Box(Modifier.size(50.dp).background(NAVI_KACHEL, CircleShape).tippen { kamera.uebersicht() }, contentAlignment = Alignment.Center) {
                UebersichtZeichen()
            }
        }

        // Fuss: Ankunft, Restzeit und Reststrecke, Ton, Beenden
        val unten = WindowInsets.navigationBars.asPaddingValues().calculateBottomPadding()
        Row(
            Modifier.align(Alignment.BottomCenter).fillMaxWidth().onSizeChanged { fussHoehe = it.height }
                .background(Color.Black)
                .drawBehind { drawRect(NAVI_LIME, size = androidx.compose.ui.geometry.Size(size.width, 1.5.dp.toPx())) }
                .padding(start = 20.dp, end = 20.dp, top = 16.dp, bottom = maxOf(30.dp, unten + 14.dp)),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Column(Modifier.weight(1f)) {
                Text(if (amAbholort) "ETA Ziel" else "ETA", style = grotesk(12f, 700, abstand = -0.3f, farbe = hex(0x868687)))
                val rest = if (amAbholort) vorschau?.dauer
                    else route?.let { if (lauf.angekommen) 0.0 else (it.dauer - it.zeitBis(lauf.stelle)).coerceAtLeast(0.0) }
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text(
                        rest?.let { FahrtZeit.uhrzeit(maxOf(jetzt, Instant.now()).plusSeconds(it.toLong())) } ?: "--:--",
                        style = grotesk(32f, 700, zeilenHoehe = 34f, abstand = -1f, farbe = NAVI_LIME),
                        maxLines = 1, softWrap = false, modifier = Modifier.alignByBaseline(),
                    )
                    if (route != null && rest != null && !amAbholort) {
                        val minuten = ceil(rest / 60.0).toInt()
                        val strecke = if (lauf.angekommen) 0.0 else (route.laenge - lauf.stelle).coerceAtLeast(0.0)
                        Text(
                            "${kartenDauer(minuten)} · ${NaviRechnen.restStrecke(strecke)}",
                            style = grotesk(14f, 700, farbe = hex(0xF4F5F4, 0.6f)),
                            maxLines = 1, softWrap = false, overflow = TextOverflow.Ellipsis,
                            modifier = Modifier.alignByBaseline(),
                        )
                    }
                }
            }
            // Ton an/aus (gemerkt je Geraet)
            Box(
                Modifier.size(56.dp).background(NAVI_KACHEL, CircleShape).tippen {
                    stumm = !stumm
                    stimme.stumm = stumm
                    speicher.edit().putBoolean("stumm", stumm).apply()
                },
                contentAlignment = Alignment.Center,
            ) { TonZeichen(stumm) }
            // Beenden
            Box(
                Modifier.size(56.dp).background(hex(0xFF6F63), CircleShape).border(2.dp, Color.Black, CircleShape).tippen(schliessen),
                contentAlignment = Alignment.Center,
            ) {
                Canvas(Modifier.size(22.dp)) {
                    val f = size.width / 22f
                    val breite = 3f * f
                    drawLine(Color.Black, Offset(4f * f, 4f * f), Offset(18f * f, 18f * f), breite)
                    drawLine(Color.Black, Offset(18f * f, 4f * f), Offset(4f * f, 18f * f), breite)
                }
            }
        }
    }
}

// MARK: - Standort

/**
 * Standort mit Kurs im Sekundentakt, nur solange die Navigation offen ist. Gleicher Dienst und
 * gleiche Erlaubnis wie die Fahrtkarte (FahrtStandort.kt), die hat aber nur alle 5 s und 10 m einen Punkt.
 */
@SuppressLint("MissingPermission")
@Composable
private fun NaviStandort(neu: (NaviFix) -> Unit) {
    val ctx = LocalContext.current
    val melden by androidx.compose.runtime.rememberUpdatedState(neu)
    DisposableEffect(ctx) {
        val erlaubt = ContextCompat.checkSelfPermission(ctx, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED ||
            ContextCompat.checkSelfPermission(ctx, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED
        if (!erlaubt) return@DisposableEffect onDispose { }
        val dienst = LocationServices.getFusedLocationProviderClient(ctx)
        fun fix(l: android.location.Location) = NaviFix(
            ort = GeoPunkt(l.latitude, l.longitude),
            // Kurs nur in Fahrt: im Stand dreht das GPS beliebig.
            kurs = if (l.hasBearing() && l.hasSpeed() && l.speed >= 2f) l.bearing.toDouble() else null,
            tempo = if (l.hasSpeed()) l.speed.toDouble() else 0.0,
            genauigkeit = if (l.hasAccuracy()) l.accuracy.toDouble() else 0.0,
            zeit = l.time,
        )
        var erster = false
        val rueckruf = object : LocationCallback() {
            override fun onLocationResult(r: LocationResult) {
                val l = r.lastLocation ?: return
                erster = true
                melden(fix(l))
            }
        }
        runCatching {
            // Letzter bekannter Standort sofort, wenn er frisch ist (sonst startet die Route am falschen Ort).
            dienst.lastLocation.addOnSuccessListener { l ->
                if (l != null && !erster && kotlin.math.abs(System.currentTimeMillis() - l.time) < 15_000) melden(fix(l))
            }
            dienst.requestLocationUpdates(
                LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, 1_000L).setMinUpdateIntervalMillis(1_000L).build(),
                rueckruf, Looper.getMainLooper(),
            )
        }
        onDispose { dienst.removeLocationUpdates(rueckruf) }
    }
}

// MARK: - Karte

private const val FOLGE_ZOOM = 16.5
private const val FOLGE_NEIGUNG = 45.0
/** Fahrer im unteren Drittel: dieser Anteil der Kartenhoehe ist oben Rand der Kamera. */
private const val FOLGE_RAND_OBEN = 0.44
/** Ein Standort je Sekunde: so lange gleitet der Pfeil zum naechsten. */
private const val PFEIL_NS = 1_000_000_000.0
private const val UEBERGANG_NS = 600_000_000.0

private fun winkelMischen(a: Double, b: Double, f: Double): Double {
    // Immer den kurzen Weg herum drehen.
    val d = ((b - a) % 360.0 + 540.0) % 360.0 - 180.0
    return ((a + d * f) % 360.0 + 360.0) % 360.0
}

/** Lage der Kamera zum Mischen zwischen zwei Lagen. Rand in Pixeln. */
private data class NaviLage(
    val lat: Double, val lng: Double, val zoom: Double, val kurs: Double, val neigung: Double,
    val links: Double, val oben: Double, val rechts: Double, val unten: Double,
) {
    fun mischen(z: NaviLage, f: Double) = NaviLage(
        lat + (z.lat - lat) * f, lng + (z.lng - lng) * f, zoom + (z.zoom - zoom) * f,
        winkelMischen(kurs, z.kurs, f), neigung + (z.neigung - neigung) * f,
        links + (z.links - links) * f, oben + (z.oben - oben) * f, rechts + (z.rechts - rechts) * f, unten + (z.unten - unten) * f,
    )

    fun kamera(): CameraPosition = CameraPosition.Builder()
        .target(LatLng(lat, lng)).zoom(zoom).bearing(kurs).tilt(neigung).padding(links, oben, rechts, unten).build()
}

/**
 * Kamera und Fahrerpfeil der Navigation (16.11.: Karte frei bedienbar wie in Navi-Apps).
 * Folgen: die Kamera faehrt mit dem Fahrer, Kurs oben. Frei: sobald der Nutzer die Karte verschiebt,
 * dreht oder neigt oder die Uebersicht waehlt, dann bewegt sich die Kamera nicht mehr von selbst.
 * Der Pfeil haengt als Symbol an der Karte und gleitet von Standort zu Standort. Im Folgen wird die
 * Kamera im selben Bild auf denselben Ort gesetzt (kein easeCamera: Pfeil und Karte liefen sonst auseinander).
 */
private class NaviKamera {
    var folgen by mutableStateOf(true)
        private set

    /** Weckt die Bildschleife, wenn sie ruht. */
    val anstoss = Channel<Unit>(Channel.CONFLATED)

    /** Restliche Route ab dem Fahrer und Hoehe des Fusses in Pixeln, fuer die Uebersicht. */
    var linie: List<GeoPunkt> = emptyList()
    var fussHoehe = 0

    private var karte: MapLibreMap? = null
    private var quelle: GeoJsonSource? = null
    private var breite = 0
    private var hoehe = 0
    private var dichte = 1f

    // Pfeil: gleitet von vonOrt nach nachOrt, zeigt* ist der Stand dieses Bildes.
    private var neuOrt: GeoPunkt? = null
    private var neuKurs = 0.0
    private var neu = false
    private var vonOrt: GeoPunkt? = null
    private var nachOrt: GeoPunkt? = null
    private var vonKurs = 0.0
    private var nachKurs = 0.0
    private var pfeilStart = 0L
    private var zeigtOrt: GeoPunkt? = null
    private var zeigtKurs = 0.0
    private var gemaltOrt: GeoPunkt? = null
    private var gemaltKurs = 0.0

    // Kamera im Folgen
    private var folgeZoom = FOLGE_ZOOM
    private var gesetzt = false
    private var letzteLage: NaviLage? = null
    /** Weicher Weg zurueck zum Fahrer (nach einer Geste oder „Zentrieren“): Lage, von der es losgeht. */
    private var uebergang: NaviLage? = null
    private var uebergangStart = 0L
    private var warPause = false

    // Gesten
    private var finger = false
    /** Eine Geste bewegt die Karte noch (auch der Auslauf nach dem Loslassen), bis die Karte ruht. */
    private var gestenBewegung = false
    private var ruhe = false
    private var hochZeit = 0L
    private var hochX = 0f
    private var hochY = 0f
    private var doppelt = false
    private var doppelZeit = 300L
    private var doppelWeg = 100f
    private var abschnittFinger = 0
    private var abschnittX = 0f
    private var abschnittY = 0f
    private var abschnittZoom = 0.0
    private var nachMehreren = false

    @SuppressLint("ClickableViewAccessibility")
    fun verbinden(m: MapLibreMap, ansicht: MapView, dichte: Float) {
        karte = m
        this.dichte = dichte
        doppelZeit = ViewConfiguration.getDoubleTapTimeout().toLong()
        doppelWeg = ViewConfiguration.get(ansicht.context).scaledDoubleTapSlop.toFloat()
        // Nur Gesten zaehlen, nicht die eigenen Kamerafahrten (die melden REASON_API_ANIMATION).
        m.addOnCameraMoveStartedListener { grund ->
            if (grund == MapLibreMap.OnCameraMoveStartedListener.REASON_API_GESTURE) {
                gestenBewegung = true
                ruhe = false
                anstoss.trySend(Unit)
            }
        }
        m.addOnCameraIdleListener {
            if (gestenBewegung) { ruhe = true; anstoss.trySend(Unit) }
        }
        // Drehen oder Neigen von Hand loest die Karte vom Fahrer.
        m.addOnRotateListener(object : MapLibreMap.OnRotateListener {
            override fun onRotateBegin(detector: RotateGestureDetector) { frei() }
            override fun onRotate(detector: RotateGestureDetector) {}
            override fun onRotateEnd(detector: RotateGestureDetector) {}
        })
        m.addOnShoveListener(object : MapLibreMap.OnShoveListener {
            override fun onShoveBegin(detector: ShoveGestureDetector) { frei() }
            override fun onShove(detector: ShoveGestureDetector) {}
            override fun onShoveEnd(detector: ShoveGestureDetector) {}
        })
        // Die Karte bekommt die Beruehrung danach ganz normal (false = nicht verbraucht).
        ansicht.setOnTouchListener { _, e -> beruehrung(e); false }
        gestenSetzen()
    }

    fun trennen() { karte = null; quelle = null }

    fun pfeilQuelle(q: GeoJsonSource) { quelle = q; gemaltOrt = null; anstoss.trySend(Unit) }

    fun groesse(b: Int, h: Int) {
        breite = b; hoehe = h
        gestenSetzen()
        anstoss.trySend(Unit)
    }

    /** Neuer Standort des Fahrers mit Fahrtrichtung. */
    fun standort(ort: GeoPunkt?, kurs: Double) {
        if (ort == null) return
        neuOrt = ort; neuKurs = kurs; neu = true
        anstoss.trySend(Unit)
    }

    /** Ganze restliche Route zeigen: Norden oben, ohne Neigung, Rand fuer Banner, Fuss und Knoepfe. */
    fun uebersicht() {
        val m = karte ?: return
        val punkte = linie + listOfNotNull(zeigtOrt)
        if (punkte.isEmpty() || hoehe < 10) return
        frei()
        val links = 50.0 * dichte
        val rechts = 70.0 * dichte
        val oben = 190.0 * dichte
        val unten = maxOf(150.0 * dichte, fussHoehe + 30.0 * dichte)
        val nord = punkte.maxOf { it.lat }; val sued = punkte.minOf { it.lat }
        val ost = punkte.maxOf { it.lng }; val west = punkte.minOf { it.lng }
        var mitte = LatLng((nord + sued) / 2, (ost + west) / 2)
        var zoom = 15.0
        if (nord - sued > 1e-5 || ost - west > 1e-5) {
            val grenzen = LatLngBounds.Builder().include(LatLng(nord, ost)).include(LatLng(sued, west)).build()
            val lage = m.getCameraForLatLngBounds(
                grenzen, intArrayOf(links.roundToInt(), oben.roundToInt(), rechts.roundToInt(), unten.roundToInt()), 0.0, 0.0,
            )
            lage?.target?.let { mitte = it }
            zoom = minOf(lage?.zoom ?: 13.0, 16.0)
        }
        // Rand ausdruecklich setzen: der Rand des Folgens (Fahrer im unteren Drittel) bliebe sonst an der Kamera haengen.
        val ziel = CameraPosition.Builder().target(mitte).zoom(zoom).bearing(0.0).tilt(0.0).padding(links, oben, rechts, unten).build()
        m.easeCamera(CameraUpdateFactory.newCameraPosition(ziel), 700)
    }

    /** Zurueck zum Mitfahren: Kurs oben, Neigung, Folge-Zoom. */
    fun zentrieren() {
        val m = karte ?: return
        folgen = true
        folgeZoom = FOLGE_ZOOM
        gestenBewegung = false
        warPause = false
        gestenSetzen()
        uebergangBeginnen(m)
        anstoss.trySend(Unit)
    }

    private fun frei() {
        if (!folgen) return
        folgen = false
        uebergang = null
        letzteLage = null
        gestenSetzen()
    }

    private fun gestenSetzen() {
        val m = karte ?: return
        // Im Folgen verschiebt MapLibre nicht selbst: beim Zoomen mit zwei Fingern rutschte die Karte sonst
        // mit weg. Ob der Nutzer verschieben will, erkennt beruehrung() und gibt die Karte dann frei.
        m.uiSettings.isScrollGesturesEnabled = !folgen
        // Im Folgen um den Fahrer zoomen (er bleibt an seinem Platz), frei um die Finger.
        m.uiSettings.focalPoint =
            if (folgen && hoehe > 10) PointF(breite / 2f, hoehe * (1f + FOLGE_RAND_OBEN.toFloat()) / 2f) else null
    }

    private fun uebergangBeginnen(m: MapLibreMap) {
        letzteLage = null
        val p = m.cameraPosition
        val t = p.target
        if (t == null || !gesetzt) { uebergang = null; return }
        val r = p.padding
        uebergang = NaviLage(
            t.latitude, t.longitude, p.zoom, p.bearing, p.tilt,
            r?.getOrNull(0) ?: 0.0, r?.getOrNull(1) ?: 0.0, r?.getOrNull(2) ?: 0.0, r?.getOrNull(3) ?: 0.0,
        )
        uebergangStart = 0L
    }

    // Verschieben selbst erkennen, getrennt nach Abschnitten mit gleicher Fingerzahl:
    // ein Finger zieht = verschieben, zwei Finger wandern gemeinsam ohne zu zoomen = verschieben.
    private fun beruehrung(e: MotionEvent) {
        when (e.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                finger = true
                // Zweiter Tipp kurz nach dem ersten: Doppeltipp (zoomt, auch mit Ziehen), kein Verschieben.
                doppelt = e.eventTime - hochZeit < doppelZeit && hypot(e.x - hochX, e.y - hochY) < doppelWeg
                abschnittFinger = 0
                abschnittBeginnen(e, -1)
            }
            MotionEvent.ACTION_POINTER_DOWN -> abschnittBeginnen(e, -1)
            MotionEvent.ACTION_POINTER_UP -> abschnittBeginnen(e, e.actionIndex)
            MotionEvent.ACTION_MOVE -> if (folgen) verschiebenPruefen(e)
            MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                finger = false
                hochZeit = e.eventTime; hochX = e.x; hochY = e.y
                anstoss.trySend(Unit)
            }
        }
    }

    private fun abschnittBeginnen(e: MotionEvent, ohne: Int) {
        var n = 0; var x = 0f; var y = 0f
        for (i in 0 until e.pointerCount) {
            if (i == ohne) continue
            n++; x += e.getX(i); y += e.getY(i)
        }
        if (n == 0) return
        // Nach zwei Fingern bleibt oft einer kurz liegen und rutscht: dann erst spaeter als Verschieben werten.
        nachMehreren = abschnittFinger > 1 && n == 1
        abschnittFinger = n
        abschnittX = x / n; abschnittY = y / n
        abschnittZoom = karte?.cameraPosition?.zoom ?: 0.0
    }

    private fun verschiebenPruefen(e: MotionEvent) {
        val n = e.pointerCount
        if (n != abschnittFinger) { abschnittBeginnen(e, -1); return }
        var x = 0f; var y = 0f
        for (i in 0 until n) { x += e.getX(i); y += e.getY(i) }
        val weg = hypot(x / n - abschnittX, y / n - abschnittY)
        val verschoben = if (n == 1) {
            !doppelt && weg > (if (nachMehreren) 32f else 16f) * dichte
        } else {
            weg > 80f * dichte && abs((karte?.cameraPosition?.zoom ?: abschnittZoom) - abschnittZoom) < 0.35
        }
        if (verschoben) frei()
    }

    /** Ein Bild: Pfeil weiterschieben, im Folgen die Kamera mitnehmen. false = nichts ist mehr in Bewegung. */
    fun bild(ns: Long): Boolean {
        val m = karte ?: return false

        // Pfeil
        if (neu) {
            neu = false
            val z = neuOrt
            if (z != null) {
                val alt = zeigtOrt
                // Erster Standort oder Sprung: nicht quer ueber die Karte gleiten.
                if (alt == null || NaviRechnen.meter(alt, z) > 200.0) { vonOrt = z; vonKurs = neuKurs } else { vonOrt = alt; vonKurs = zeigtKurs }
                nachOrt = z; nachKurs = neuKurs; pfeilStart = ns
            }
        }
        var pfeilLaeuft = false
        val nach = nachOrt
        if (nach != null) {
            val von = vonOrt ?: nach
            val t = ((ns - pfeilStart) / PFEIL_NS).coerceIn(0.0, 1.0)
            pfeilLaeuft = t < 1.0
            val o = if (t >= 1.0) nach else GeoPunkt(von.lat + (nach.lat - von.lat) * t, von.lng + (nach.lng - von.lng) * t)
            val k = if (t >= 1.0) nachKurs else winkelMischen(vonKurs, nachKurs, t)
            zeigtOrt = o; zeigtKurs = k
            val q = quelle
            if (q != null && (o != gemaltOrt || k != gemaltKurs)) {
                gemaltOrt = o; gemaltKurs = k
                q.setGeoJson(Feature.fromGeometry(Point.fromLngLat(o.lng, o.lat)).also { it.addNumberProperty("kurs", k) })
            }
        }

        // Geste zu Ende (Finger weg und Karte ruht, zur Sicherheit spaetestens nach 2,5 s)
        if (gestenBewegung && !finger && (ruhe || SystemClock.uptimeMillis() - hochZeit > 2500)) {
            gestenBewegung = false
            // Zoomen allein aendert nur die Zoomstufe, mit der die Karte weiter folgt.
            if (folgen) folgeZoom = m.cameraPosition.zoom
        }
        val pause = finger || gestenBewegung
        if (pause) letzteLage = null
        if (warPause && !pause && folgen) uebergangBeginnen(m)
        warPause = pause

        // Kamera
        var kameraLaeuft = false
        val o = zeigtOrt
        if (folgen && !pause && o != null && hoehe > 10) {
            var lage = NaviLage(o.lat, o.lng, folgeZoom, zeigtKurs, FOLGE_NEIGUNG, 0.0, hoehe * FOLGE_RAND_OBEN, 0.0, 0.0)
            val u = uebergang
            if (u != null) {
                if (uebergangStart == 0L) uebergangStart = ns
                val t = ((ns - uebergangStart) / UEBERGANG_NS).coerceIn(0.0, 1.0)
                if (t >= 1.0) uebergang = null else { lage = u.mischen(lage, t * t * (3.0 - 2.0 * t)); kameraLaeuft = true }
            }
            if (lage != letzteLage) {
                letzteLage = lage
                gesetzt = true
                m.moveCamera(CameraUpdateFactory.newCameraPosition(lage.kamera()))
            }
        }
        return pfeilLaeuft || kameraLaeuft || (gestenBewegung && !finger)
    }
}

/** Blauer Pfeil mit weissem Rand und blassem Kreis, Spitze nach oben (die Karte dreht ihn in Fahrtrichtung). */
private fun fahrerBild(px: Int, dpi: Int): Bitmap {
    val bild = Bitmap.createBitmap(px, px, Bitmap.Config.ARGB_8888)
    // Dichte des Geraets: MapLibre zeichnet das Bild dann Pixel fuer Pixel.
    bild.density = dpi
    val c = ACanvas(bild)
    val f = px / 68f
    val stift = Paint(Paint.ANTI_ALIAS_FLAG)
    stift.color = AColor.argb(46, 0x2F, 0x6B, 0xFF)
    c.drawCircle(34f * f, 34f * f, 34f * f, stift)
    val pfad = APath().apply {
        moveTo(34f * f, 6f * f); lineTo(54f * f, 56f * f); lineTo(34f * f, 44f * f); lineTo(14f * f, 56f * f); close()
    }
    stift.color = AColor.rgb(0x2F, 0x6B, 0xFF)
    stift.style = Paint.Style.FILL
    c.drawPath(pfad, stift)
    stift.color = AColor.WHITE
    stift.style = Paint.Style.STROKE
    stift.strokeWidth = 3f * f
    stift.strokeJoin = Paint.Join.ROUND
    c.drawPath(pfad, stift)
    return bild
}

/**
 * Dunkle Karte wie die Fahrtkarte (TrisarKarte), frei bedienbar. Im Folgen in Fahrtrichtung gedreht und
 * geneigt, Fahrer im unteren Drittel. Der Fahrerpfeil ist ein Symbol an seinem echten Ort auf der Karte.
 */
@Composable
private fun NaviKarte(
    kamera: NaviKamera, linie: List<GeoPunkt>, blass: Boolean, vorschau: List<GeoPunkt>, amAbholort: Boolean,
    ort: GeoPunkt?, kurs: Double, fussHoehe: Int, modifier: Modifier,
) {
    val ctx = LocalContext.current
    val dichte = LocalDensity.current
    val kartenAnsicht = remember {
        MapLibre.getInstance(ctx)
        MapView(ctx).apply { onCreate(null) }
    }
    var karte by remember { mutableStateOf<MapLibreMap?>(null) }
    var stil by remember { mutableStateOf<Style?>(null) }

    // Lebenszyklus der MapView an die Seite haengen (wie TrisarKarte).
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
            kamera.trennen()
            if (aktiv) kartenAnsicht.onPause()
            if (gestartet) kartenAnsicht.onStop()
            kartenAnsicht.onDestroy()
        }
    }

    LaunchedEffect(kartenAnsicht) {
        kartenAnsicht.getMapAsync { m ->
            m.uiSettings.isLogoEnabled = false
            m.uiSettings.isCompassEnabled = false
            // Alle Gesten bleiben an (verschieben, zoomen, Doppeltipp, drehen). Was davon die Karte
            // vom Fahrer loest, regelt NaviKamera.
            m.uiSettings.attributionGravity = Gravity.BOTTOM or Gravity.END
            m.uiSettings.setAttributionTintColor(AColor.argb(204, 153, 153, 153))
            m.moveCamera(CameraUpdateFactory.newLatLngZoom(LatLng(48.1215, 11.6644), 12.0))
            kamera.verbinden(m, kartenAnsicht, dichte.density)
            m.setStyle(Style.Builder().fromUri(Konfig.KARTEN_STIL)) { s -> stil = s }
            karte = m
        }
    }
    // Kartenhinweis (i) ueber dem Fuss statt darunter.
    LaunchedEffect(karte, fussHoehe) {
        val rand = (8f * dichte.density).roundToInt()
        karte?.uiSettings?.setAttributionMargins(0, 0, rand, fussHoehe + rand)
    }

    // Route Lime, runde Enden. MapLibre misst in System-dp, das Raster ist breiter oder schmaler.
    val faktor = dichte.density / ctx.resources.displayMetrics.density
    LaunchedEffect(stil, linie) {
        val s = stil ?: return@LaunchedEffect
        val daten = if (linie.size >= 2) {
            FeatureCollection.fromFeature(Feature.fromGeometry(LineString.fromLngLats(linie.map { Point.fromLngLat(it.lng, it.lat) })))
        } else {
            FeatureCollection.fromFeatures(emptyList<Feature>())
        }
        val quelle = s.getSourceAs<GeoJsonSource>("navi")
        if (quelle != null) { quelle.setGeoJson(daten); return@LaunchedEffect }
        s.addSource(GeoJsonSource("navi", daten))
        val ebene = LineLayer("navi", "navi").withProperties(
            PropertyFactory.lineColor(AColor.rgb(0xE2, 0xF7, 0x54)),
            PropertyFactory.lineWidth(11f * faktor),
            PropertyFactory.lineCap(Property.LINE_CAP_ROUND),
            PropertyFactory.lineJoin(Property.LINE_JOIN_ROUND),
        )
        // Unter die Strassennamen legen, damit sie lesbar bleiben.
        val schrift = s.layers.firstOrNull { it is SymbolLayer }
        if (schrift != null) s.addLayerBelow(ebene, schrift.id) else s.addLayer(ebene)
    }
    // Abseits: die alte Route blass, bis die neue da ist. Mit Vorschau ist die Anfahrt blau.
    val mitVorschau = vorschau.size >= 2
    LaunchedEffect(stil, blass, mitVorschau, linie.isEmpty()) {
        stil?.getLayerAs<LineLayer>("navi")?.setProperties(
            PropertyFactory.lineOpacity(if (blass) 0.35f else 1f),
            PropertyFactory.lineColor(if (mitVorschau) AColor.rgb(0x00, 0x59, 0xFF) else AColor.rgb(0xE2, 0xF7, 0x54)),
        )
    }

    // Vorschau: Route der Dispo bis zum Ziel in Lime, schmaler und unter der Anfahrt, am Ende ein Lime-Punkt.
    LaunchedEffect(stil, vorschau) {
        val s = stil ?: return@LaunchedEffect
        val linieDaten = if (vorschau.size >= 2) {
            FeatureCollection.fromFeature(Feature.fromGeometry(LineString.fromLngLats(vorschau.map { Point.fromLngLat(it.lng, it.lat) })))
        } else {
            FeatureCollection.fromFeatures(emptyList<Feature>())
        }
        val zielDaten = vorschau.lastOrNull()?.takeIf { vorschau.size >= 2 }
            ?.let { FeatureCollection.fromFeature(Feature.fromGeometry(Point.fromLngLat(it.lng, it.lat))) }
            ?: FeatureCollection.fromFeatures(emptyList<Feature>())
        val q = s.getSourceAs<GeoJsonSource>("navi-vorschau")
        if (q != null) {
            q.setGeoJson(linieDaten)
            s.getSourceAs<GeoJsonSource>("navi-vorschau-ziel")?.setGeoJson(zielDaten)
            return@LaunchedEffect
        }
        if (vorschau.size < 2) return@LaunchedEffect
        s.addSource(GeoJsonSource("navi-vorschau", linieDaten))
        s.addSource(GeoJsonSource("navi-vorschau-ziel", zielDaten))
        val ebene = LineLayer("navi-vorschau", "navi-vorschau").withProperties(
            PropertyFactory.lineColor(AColor.rgb(0xE2, 0xF7, 0x54)),
            PropertyFactory.lineWidth(11f * 0.7f * faktor),
            PropertyFactory.lineCap(Property.LINE_CAP_ROUND),
            PropertyFactory.lineJoin(Property.LINE_JOIN_ROUND),
        )
        val schrift = s.layers.firstOrNull { it is SymbolLayer }
        when {
            s.getLayer("navi") != null -> s.addLayerBelow(ebene, "navi")
            schrift != null -> s.addLayerBelow(ebene, schrift.id)
            else -> s.addLayer(ebene)
        }
        val punkt = CircleLayer("navi-vorschau-ziel", "navi-vorschau-ziel").withProperties(
            PropertyFactory.circleColor(AColor.rgb(0xE2, 0xF7, 0x54)),
            PropertyFactory.circleRadius(8f * faktor),
            PropertyFactory.circleStrokeColor(AColor.BLACK),
            PropertyFactory.circleStrokeWidth(3f * faktor),
            PropertyFactory.circlePitchAlignment(Property.CIRCLE_PITCH_ALIGNMENT_MAP),
        )
        if (s.getLayer("navi-fahrer") != null) s.addLayerBelow(punkt, "navi-fahrer") else s.addLayer(punkt)
    }

    // Fuer die Uebersicht: restliche Route samt Vorschau und Platz des Fusses.
    SideEffect { kamera.linie = linie + vorschau; kamera.fussHoehe = fussHoehe }
    // Am Abholort einmal auf die ganze Vorschau einpassen, danach ist die Karte frei.
    LaunchedEffect(amAbholort, karte) {
        if (!amAbholort || karte == null) return@LaunchedEffect
        while (kartenAnsicht.width < 10 || kartenAnsicht.height < 10) delay(100)
        kamera.linie = linie + vorschau
        kamera.uebersicht()
    }
    LaunchedEffect(ort, kurs) { kamera.standort(ort, kurs) }

    // Fahrerpfeil als Symbol ganz oben auf der Karte: haengt am Ort, dreht mit der Karte (Kurs relativ zur Karte).
    LaunchedEffect(karte, stil) {
        if (karte == null) return@LaunchedEffect
        val s = stil ?: return@LaunchedEffect
        if (s.getSource("navi-fahrer") == null) {
            s.addImage("navi-fahrer", fahrerBild((68f * dichte.density).roundToInt(), ctx.resources.displayMetrics.densityDpi))
            val quelle = GeoJsonSource("navi-fahrer", FeatureCollection.fromFeatures(emptyList<Feature>()))
            s.addSource(quelle)
            s.addLayer(
                SymbolLayer("navi-fahrer", "navi-fahrer").withProperties(
                    PropertyFactory.iconImage("navi-fahrer"),
                    PropertyFactory.iconRotate(Expression.get("kurs")),
                    PropertyFactory.iconRotationAlignment(Property.ICON_ROTATION_ALIGNMENT_MAP),
                    PropertyFactory.iconPitchAlignment(Property.ICON_PITCH_ALIGNMENT_VIEWPORT),
                    PropertyFactory.iconAllowOverlap(true),
                    PropertyFactory.iconIgnorePlacement(true),
                ),
            )
            kamera.pfeilQuelle(quelle)
        }
        // Vor dem ersten Layout hat die Karte keine Groesse.
        while (kartenAnsicht.width < 10 || kartenAnsicht.height < 10) delay(100)
        // Bildschleife: laeuft nur, solange sich Pfeil oder Kamera bewegen, sonst wartet sie auf den naechsten Anstoss.
        while (true) {
            val weiter = withFrameNanos { kamera.bild(it) }
            if (!weiter) kamera.anstoss.receive()
        }
    }

    Box(modifier.background(hex(0x101112))) {
        AndroidView(
            factory = { kartenAnsicht },
            modifier = Modifier.fillMaxSize().onSizeChanged { kamera.groesse(it.width, it.height) },
        )
    }
}

// MARK: - Banner

/** Schwarzes Banner mit Rand in der Farbe des Zustands: Kachel mit Pfeil, Titel (Entfernung) und Text. */
@Composable
private fun Banner(pfeil: String, farbe: Color, titel: String?, titelGroesse: Float, text: String?, textGroesse: Float) {
    Row(
        Modifier.fillMaxWidth().background(Color.Black).border(1.5.dp, farbe).padding(horizontal = 16.dp, vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Box(Modifier.size(64.dp).background(NAVI_KACHEL, RoundedCornerShape(16.dp)), contentAlignment = Alignment.Center) {
            NaviPfeil(pfeil, farbe, 38.dp, 4.5f)
        }
        Column(Modifier.weight(1f)) {
            if (titel != null) {
                Text(titel, style = grotesk(titelGroesse, 700, zeilenHoehe = titelGroesse, abstand = -1f, farbe = farbe), maxLines = 1, softWrap = false)
            }
            if (titel != null && text != null) Spacer(Modifier.height(4.dp))
            if (text != null) {
                Text(text, style = grotesk(textGroesse, 700, zeilenHoehe = textGroesse * 1.15f, abstand = -0.5f, farbe = Color.White),
                    maxLines = 2, overflow = TextOverflow.Ellipsis)
            }
        }
    }
}

/** Lasche „dann ⟨Pfeil⟩ ⟨Strasse⟩“ unter dem Banner, links buendig, ohne oberen Rand. */
@Composable
private fun DannLasche(hinweis: NaviHinweis) {
    val rand = hex(0x4A4F22)
    Row(
        Modifier.background(Color.Black)
            .drawBehind {
                val b = 1.5.dp.toPx()
                drawLine(rand, Offset(b / 2, 0f), Offset(b / 2, size.height), b)
                drawLine(rand, Offset(size.width - b / 2, 0f), Offset(size.width - b / 2, size.height), b)
                drawLine(rand, Offset(0f, size.height - b / 2), Offset(size.width, size.height - b / 2), b)
            }
            .padding(horizontal = 12.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        val grau = hex(0xCCCCCC)
        Text("dann", style = grotesk(13f, 700, farbe = grau), maxLines = 1)
        NaviPfeil(hinweis.pfeil, grau, 16.dp, 5f)
        Text(hinweis.strasse.ifEmpty { hinweis.kurz }, style = grotesk(13f, 700, farbe = grau), maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

/** Legende unter dem Banner: ohne Text „Anfahrt“ und „Route Dispo“, mit Text nur die Route der Dispo. */
@Composable
private fun Legende(amAbholort: String?) {
    Row(
        Modifier.background(Color.Black).border(1.5.dp, hex(0x4A4F22)).padding(horizontal = 12.dp, vertical = 7.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        val schrift = grotesk(13f, 700, farbe = hex(0xF4F5F4))
        if (amAbholort == null) {
            LegendenStrich(NAVI_ANFAHRT)
            Text("Anfahrt", style = schrift, maxLines = 1)
            Spacer(Modifier.size(6.dp))
            LegendenStrich(NAVI_LIME)
            Text("Route Dispo", style = schrift, maxLines = 1)
        } else {
            LegendenStrich(NAVI_LIME)
            Text(amAbholort, style = schrift, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
    }
}

@Composable
private fun LegendenStrich(farbe: Color) {
    Canvas(Modifier.size(width = 18.dp, height = 4.dp)) {
        drawLine(farbe, Offset(size.height / 2, size.height / 2), Offset(size.width - size.height / 2, size.height / 2), size.height, cap = StrokeCap.Round)
    }
}

// MARK: - Zeichen

/** Pfeilformen im 38er-Feld (wie navi-design). Links-Varianten sind die gespiegelten Rechts-Formen. */
private fun pfeilForm(pfeil: String): Pair<String, Boolean> = when (pfeil) {
    "rechts" -> "M10 34V18a6 6 0 0 1 6-6h14M22 4l9 8-9 8" to false
    "links" -> "M10 34V18a6 6 0 0 1 6-6h14M22 4l9 8-9 8" to true
    "leicht_rechts" -> "M13 34V22L27 8M15 8H27V20" to false
    "leicht_links" -> "M13 34V22L27 8M15 8H27V20" to true
    "scharf_rechts" -> "M12 34V9L27 24M27 12V24H15" to false
    "scharf_links" -> "M12 34V9L27 24M27 12V24H15" to true
    "wenden" -> "M26 34V16a8 8 0 0 0-16 0v10M3 19l7 8 7-8" to false
    "kreisel" -> "M19 34V25M19 11a7 7 0 1 0 0 14a7 7 0 1 0 0-14M24.5 12.5L32 5M23 5h9v9" to false
    "ziel" -> "M11 34V5M11 6h17l-4 6 4 6H11" to false
    // start, gerade und alles Unbekannte: Pfeil nach oben
    else -> "M19 34V7M9 16l10-10 10 10" to false
}

/** Abbiegepfeil als Vektorform, eckige Enden. staerke in Einheiten des 38er-Felds. */
@Composable
private fun NaviPfeil(pfeil: String, farbe: Color, groesse: Dp, staerke: Float) {
    val (daten, gespiegelt) = pfeilForm(pfeil)
    val pfad = remember(daten) { PathParser().parsePathString(daten).toPath() }
    Canvas(Modifier.size(groesse)) {
        val f = size.width / 38f
        withTransform({
            scale(if (gespiegelt) -f else f, f, pivot = Offset.Zero)
            // Gespiegelt liegt die Form links vom Ursprung, darum um die Feldbreite zurueckschieben.
            if (gespiegelt) translate(-38f, 0f)
        }) {
            drawPath(pfad, farbe, style = Stroke(width = staerke, cap = StrokeCap.Square, join = StrokeJoin.Miter))
        }
    }
}

/** Uebersicht: geschwungene Linie mit Punkt an beiden Enden, Lime. */
@Composable
private fun UebersichtZeichen() {
    val linie = remember { PathParser().parsePathString("M7 20c0-7 12-6 12-13").toPath() }
    Canvas(Modifier.size(26.dp)) {
        val f = size.width / 26f
        scale(f, f, pivot = Offset.Zero) {
            drawPath(linie, NAVI_LIME, style = Stroke(width = 2.2f, cap = StrokeCap.Round))
            drawCircle(NAVI_LIME, radius = 2.4f, center = Offset(7f, 21f))
            drawCircle(NAVI_LIME, radius = 2.4f, center = Offset(19f, 5f))
        }
    }
}

/** Zentrieren: Standortpfeil, schwarz auf Lime. */
@Composable
private fun ZentrierenZeichen() {
    val pfad = remember { PathParser().parsePathString("M12 2l8 19-8-4.5L4 21z").toPath() }
    Canvas(Modifier.size(24.dp)) {
        val f = size.width / 24f
        scale(f, f, pivot = Offset.Zero) { drawPath(pfad, Color.Black, style = Fill) }
    }
}

/** Lautsprecher in Lime, stumm mit Strich durch. */
@Composable
private fun TonZeichen(stumm: Boolean) {
    val pfad = remember { PathParser().parsePathString("M4 10h4l6-5v16l-6-5H4zM18 9a5 5 0 0 1 0 8M20.5 6a9 9 0 0 1 0 14").toPath() }
    val koerper = remember { PathParser().parsePathString("M4 10h4l6-5v16l-6-5H4z").toPath() }
    Canvas(Modifier.size(26.dp)) {
        val f = size.width / 26f
        scale(f, f, pivot = Offset.Zero) {
            drawPath(if (stumm) koerper else pfad, NAVI_LIME, style = Stroke(width = 2.2f))
            if (stumm) drawLine(NAVI_LIME, Offset(3f, 3f), Offset(23f, 23f), 2.2f)
        }
    }
}
