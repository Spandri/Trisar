package de.trisar.dispo.karte

import androidx.compose.animation.core.EaseOut
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.snap
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import coil3.compose.AsyncImage
import de.trisar.dispo.DispoZiel
import de.trisar.dispo.Navileiste
import de.trisar.dispo.stamm.TextZeile
import de.trisar.dispo.stamm.anrufen
import de.trisar.kern.EigeneOrte
import de.trisar.kern.Icon
import de.trisar.kern.grotesk
import de.trisar.kern.hex
import de.trisar.kern.mittig
import de.trisar.kern.platz
import de.trisar.kern.tippen
import kotlinx.coroutines.launch
import java.time.LocalDateTime
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

private val LIME = hex(0xE3F654)
private val GRAU = hex(0x868687)

// Masse im Web-Raster (NAV_BLOCK_OFFSET_PX, SHEET_MAX_TOP_GAP_PX, SHEET_PEEK_PX).
private const val BLATT_UNTEN = 120f
/** Oberkante der Navileiste ueber dem unteren Rand: 79 (Abstand + Fussleiste) + 131 - 32. */
private const val LEISTE_OBEN = 178f
private val BLATT_MIN = max(34f, (LEISTE_OBEN - BLATT_UNTEN) + 34f)

/**
 * Live-Karte der Dispo (KartenView.jsx, Live-Zweig, wie DispoKarteAnsicht.swift): Fahrer mit Zustand
 * und Zuendung, Schnellfilter Aktiv/Inaktiv/Frei (lang auf Inaktiv = Inaktiv-Fenster), Fahrerblatt mit
 * naechster Fahrt, Fahrerprofil mit Fahrzeugdaten und der Karten-Filter (KartenFilterView.jsx).
 */
@Composable
fun DispoKarteSeite(zeigen: (DispoZiel) -> Unit) {
    val ctx = LocalContext.current
    remember { DispoRouten.vorbereiten(ctx) }
    val daten = remember { KartenDaten() }
    val scope = rememberCoroutineScope()
    val filter = KartenFilter

    DisposableEffect(Unit) {
        daten.starten(scope)
        onDispose { daten.beenden() }
    }
    // Zurueck in die App: sofort frisch laden (Realtime war im Hintergrund weg).
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    DisposableEffect(lifecycle) {
        var erstes = true
        val b = LifecycleEventObserver { _, e ->
            if (e == Lifecycle.Event.ON_RESUME) {
                if (erstes) erstes = false else scope.launch { daten.laden() }
            }
        }
        lifecycle.addObserver(b)
        onDispose { lifecycle.removeObserver(b) }
    }

    var gewaehltID by remember { mutableStateOf<String?>(null) }
    var schnellFilter by remember { mutableStateOf(FahrerZustand.entries.toList()) }
    var blatt by remember { mutableFloatStateOf(BLATT_MIN) }
    var ziehtBlatt by remember { mutableStateOf(false) }
    var zeigeFenster by remember { mutableStateOf(false) }
    var fensterStunden by remember { mutableFloatStateOf(daten.vorschauStunden.toFloat()) }
    var route by remember { mutableStateOf<KartenRoutenBild?>(null) }
    var fahrtMinuten by remember { mutableStateOf<Pair<String, Int?>?>(null) }
    var einpassen by remember { mutableIntStateOf(0) }
    var filterOffen by remember { mutableStateOf(false) }
    var profilOffen by remember { mutableStateOf(false) }
    var abseitsZaehler by remember { mutableIntStateOf(0) }
    var ortGewaehlt by remember { mutableStateOf<String?>(null) }
    DisposableEffect(Unit) {
        EigeneOrte.beobachten()
        onDispose { EigeneOrte.nichtMehrBeobachten() }
    }
    var letzteNeuberechnung by remember { mutableLongStateOf(0L) }

    // Filterkette wie im Web.
    val begriffe = filter.fahrerSuche.split(";").map { it.trim().lowercase() }.filter { it.isNotEmpty() }
    val ids = filter.gewaehlteFahrerIDs.toSet()
    val auswahl = if (ids.isEmpty()) daten.fahrer else daten.fahrer.filter { it.id in ids }
    val passende = if (begriffe.isEmpty()) auswahl else auswahl.filter { f ->
        val nummer = f.nummer ?: ""
        val heu = listOf(f.name, f.kennzeichen, f.telefon, f.fahrzeug, nummer, if (nummer.isEmpty()) "" else "#$nummer")
            .filter { it.isNotEmpty() }.joinToString(" ").lowercase()
        begriffe.any { heu.contains(it) }
    }
    val gefiltert = passende.filter { it.zustand in schnellFilter }
    val gewaehlt = gefiltert.firstOrNull { it.id == gewaehltID }
    val zaehler = passende.groupingBy { it.zustand }.eachCount()

    // selectedDriverForSheet: fehlt die Ankunft, aus Abfahrt + Fahrdauer der Route.
    val blattFahrer = gewaehlt?.let { g ->
        var info = g.info
        val m = fahrtMinuten
        val min = if (m != null && m.first == g.id) m.second else null
        if (info.ankunft == "--:--" && min != null) {
            KartenRegeln.plusMinuten(info.abfahrt, min)?.let { info = info.copy(ankunft = it) }
        }
        // Unterwegs ohne Fahrzeit aus der Datenbank: Restfahrzeit der Kartenroute statt "<1 min".
        if (info.unterwegs && info.fahrMinuten <= 0 && min != null && min > 0) {
            val t = LocalDateTime.now().plusMinutes(min.toLong())
            info = info.copy(ankunft = "%02d:%02d".format(t.hour, t.minute), fahrMinuten = min)
        }
        g.copy(info = info)
    }

    fun auswahlAufheben() {
        gewaehltID = null
        fahrtMinuten = null
        blatt = BLATT_MIN
    }

    // Route: neu bei anderem Fahrer, anderer Fahrt oder Abseits-Meldung.
    val routenAufgabe = KartenRouten.schluessel(gewaehlt) + "#$abseitsZaehler"
    val gewaehltAktuell by rememberUpdatedState(gewaehlt)
    LaunchedEffect(routenAufgabe) {
        route = null
        val f = gewaehltAktuell ?: return@LaunchedEffect
        if (f.fahrt == null) return@LaunchedEffect
        val bild = KartenRouten.berechnen(f, f.ort, daten.fahrer)
        route = bild
        fahrtMinuten = f.id to bild?.fahrtMinuten
    }
    LaunchedEffect(gefiltert.map { it.id }) {
        val id = gewaehltID
        if (id != null && gefiltert.none { it.id == id }) gewaehltID = null
    }
    LaunchedEffect(gewaehltID) { profilOffen = false }

    BoxWithConstraints(Modifier.fillMaxSize().background(hex(0x0E0E0E))) {
        val rasterHoehe = maxHeight.value
        val blattMax = max(BLATT_MIN, rasterHoehe - BLATT_UNTEN - 54f)
        val blattHoehe = min(max(blatt, BLATT_MIN), blattMax)

        DispoKarte(
            KartenStand(
                fahrer = gefiltert, gewaehlt = gewaehlt, route = route,
                blattHoehe = if (gewaehlt == null) 0f else blattHoehe,
                rasterHoehe = rasterHoehe, einpassenSignal = einpassen,
                orte = EigeneOrte.liste, ortGewaehlt = ortGewaehlt,
            ),
            waehlen = { id ->
                // Zweiter Tipp auf denselben Fahrer hebt den Fokus wieder auf.
                gewaehltID = if (gewaehltID == id) null else id
                fahrtMinuten = null
                blatt = BLATT_MIN
            },
            leerTippen = { auswahlAufheben(); ortGewaehlt = null },
            abseits = {
                // Mehr als 200 m neben der Route: neu rechnen, hoechstens alle 15 s.
                val jetzt = System.currentTimeMillis()
                if (jetzt - letzteNeuberechnung > 15_000) {
                    letzteNeuberechnung = jetzt
                    abseitsZaehler++
                }
            },
            // Erneuter Tipp auf denselben Ort blendet die Kreise wieder aus.
            ortTippen = { id -> ortGewaehlt = if (ortGewaehlt == id) null else id },
        )

        // Oberflaeche ueber der Karte (Raster 402 breit).
        Box(Modifier.fillMaxSize()) {
            if (daten.fehler.isNotEmpty()) {
                Box(Modifier.platz(20f, 196f, 362f).background(hex(0x171717)).border(1.dp, hex(0x3A3A3A)).padding(12.dp)) {
                    Text(daten.fehler, style = grotesk(12f, 500, 12f * 1.35f, farbe = hex(0xFF8E8E)))
                }
            }
            // Zurueck: schwarzer Kreis als Unterlage, sonst schimmert am Rand die Karte durch.
            Box(Modifier.platz(20f, 60f, 50f, 50f).clip(CircleShape).background(Color.Black).tippen { zeigen(DispoZiel.START) }) {
                Icon("Backbutton_Karte", Modifier.fillMaxSize())
            }
            Box(Modifier.platz(402f - 20f - 50f, 60f, 50f, 50f).tippen { filterOffen = true }) {
                Icon("karten-layer-button", Modifier.fillMaxSize(), skalierung = ContentScale.FillBounds)
            }

            SchnellFilterLeiste(zaehler, schnellFilter, Modifier.mittig(201f, 142f, 362f, 44f),
                umschalten = { z ->
                    // Sind alle Zustaende an, zeigt ein Tipp nur diesen. Nie leer: dann wieder alle.
                    val neu = schnellFilter.toMutableSet()
                    if (neu.size == FahrerZustand.entries.size) { neu.clear(); neu += z }
                    else if (z in neu) neu -= z else neu += z
                    val liste = FahrerZustand.entries.filter { it in neu }
                    schnellFilter = liste.ifEmpty { FahrerZustand.entries.toList() }
                    blatt = BLATT_MIN
                },
                fensterUmschalten = { zeigeFenster = !zeigeFenster },
            )

            if (zeigeFenster) {
                InaktivFenster(fensterStunden, Modifier.mittig(201f, 190f, 362f),
                    aendern = { neu ->
                        if (neu != fensterStunden) {
                            fensterStunden = neu
                            daten.vorschauStunden = neu.toDouble()
                            scope.launch { daten.laden() }
                        }
                    },
                    schliessen = { zeigeFenster = false },
                )
            }

            if (blattFahrer != null) {
                val angezeigt by animateFloatAsState(
                    blattHoehe, if (ziehtBlatt) snap() else tween(300, easing = EaseOut), label = "blatt",
                )
                FahrerBlatt(
                    blattFahrer, Modifier.platz(0f, rasterHoehe - BLATT_UNTEN - angezeigt, 402f, angezeigt),
                    hoehe = { blattHoehe }, setzen = { blatt = it }, ziehen = { ziehtBlatt = it },
                    minimum = BLATT_MIN, maximum = blattMax,
                    profilOeffnen = { profilOffen = true },
                )
            }
        }

        if (profilOffen && blattFahrer != null) {
            Box(Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.95f))) {
                FahrerProfilFenster(blattFahrer) { profilOffen = false }
            }
        }

        Navileiste(DispoZiel.KARTE) { ziel ->
            if (ziel == DispoZiel.KARTE) {
                // Tipp auf "Karte" in der Leiste: Auswahl weg, alle Fahrer einpassen.
                auswahlAufheben()
                einpassen++
            } else {
                zeigen(ziel)
            }
        }

        if (filterOffen) KartenFilterSeite(zurueck = { filterOffen = false })
    }
}

// MARK: - Schnellfilter (DriverQuickFilterBar)

@Composable
private fun SchnellFilterLeiste(
    zaehler: Map<FahrerZustand, Int>,
    gewaehlt: List<FahrerZustand>,
    modifier: Modifier,
    umschalten: (FahrerZustand) -> Unit,
    fensterUmschalten: () -> Unit,
) {
    Row(
        modifier.background(Color.Black, RoundedCornerShape(12.dp)).padding(horizontal = 16.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        for (z in FahrerZustand.entries) {
            val umschaltenAktuell by rememberUpdatedState(umschalten)
            val fensterAktuell by rememberUpdatedState(fensterUmschalten)
            Row(
                Modifier.height(44.dp).alpha(if (z in gewaehlt) 1f else 0.2f).pointerInput(z) {
                    detectTapGestures(
                        onTap = { umschaltenAktuell(z) },
                        // Lang druecken oeffnet bei Inaktiv das Inaktiv-Fenster statt umzuschalten.
                        onLongPress = if (z == FahrerZustand.INAKTIV) { { _: Offset -> fensterAktuell() } } else null,
                    )
                },
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                Box(Modifier.size(12.dp).background(z.farbe, CircleShape).border(1.dp, hex(0x202020), CircleShape))
                Text(buildAnnotatedString {
                    withStyle(SpanStyle(fontWeight = FontWeight(700))) { append("${z.titel} ") }
                    append("(${zaehler[z] ?: 0})")
                }, style = grotesk(16f, 400, farbe = Color.White), maxLines = 1)
            }
        }
    }
}

/** Regler fuer das Inaktiv-Fenster (0 bis 8 h in halben Stunden). */
@Composable
private fun InaktivFenster(stunden: Float, modifier: Modifier, aendern: (Float) -> Unit, schliessen: () -> Unit) {
    val r = (stunden * 10).roundToInt() / 10f
    val etikett = if (r == r.roundToInt().toFloat()) "${r.roundToInt()}h" else "%.1fh".format(r).replace(".", ",")
    Box(
        modifier.background(Color.Black.copy(alpha = 0.9f), RoundedCornerShape(12.dp))
            .border(1.dp, hex(0x2C2C2C), RoundedCornerShape(12.dp)),
    ) {
        Column(Modifier.fillMaxWidth().padding(12.dp)) {
            Row(Modifier.fillMaxWidth().padding(end = 30.dp)) {
                Text("Inaktiv-Fenster", style = grotesk(13f, 500, farbe = LIME))
                Spacer(Modifier.weight(1f))
                Text(etikett, style = grotesk(13f, 500, farbe = LIME))
            }
            Slider(
                value = stunden,
                onValueChange = { aendern((it * 2).roundToInt() / 2f) },
                valueRange = 0f..8f,
                steps = 15,
                colors = SliderDefaults.colors(
                    thumbColor = LIME, activeTrackColor = LIME, inactiveTrackColor = hex(0x3A3A3A),
                    activeTickColor = Color.Transparent, inactiveTickColor = Color.Transparent,
                ),
                modifier = Modifier.padding(top = 8.dp).height(28.dp),
            )
            Row(Modifier.fillMaxWidth().padding(top = 4.dp)) {
                Text("0h", style = grotesk(11f, 500, farbe = hex(0x8A8A8D)))
                Spacer(Modifier.weight(1f))
                Text("8h", style = grotesk(11f, 500, farbe = hex(0x8A8A8D)))
            }
        }
        Box(Modifier.align(Alignment.TopEnd).padding(top = 2.dp, end = 2.dp).size(28.dp).tippen(schliessen), contentAlignment = Alignment.Center) {
            Text("×", style = grotesk(20f, 700, farbe = LIME))
        }
    }
}

// MARK: - Fahrerblatt (ActiveRideSheet)

@Composable
private fun FahrerBlatt(
    fahrer: KartenFahrer,
    modifier: Modifier,
    hoehe: () -> Float,
    setzen: (Float) -> Unit,
    ziehen: (Boolean) -> Unit,
    minimum: Float,
    maximum: Float,
    profilOeffnen: () -> Unit,
) {
    val ctx = LocalContext.current
    val hoeheAktuell by rememberUpdatedState(hoehe)
    val maxAktuell by rememberUpdatedState(maximum)
    /** Unterkante des Namensblocks: Griff 42 + Markieren 56 + 12 + Kennzeichen 70 + 12 + Name 96. */
    val nameRast = min(max(288f, minimum), maximum)
    val rastAktuell by rememberUpdatedState(nameRast)

    Column(
        modifier.shadow(20.dp, RoundedCornerShape(topStart = 12.dp, topEnd = 12.dp), ambientColor = Color.Black.copy(alpha = 0.5f))
            .background(hex(0x17181B), RoundedCornerShape(topStart = 12.dp, topEnd = 12.dp)),
    ) {
        // Griff: ziehen veraendert die Hoehe, ein Tipp klappt ganz auf oder zu.
        Box(
            Modifier.fillMaxWidth().height(42.dp).pointerInput(Unit) {
                awaitEachGesture {
                    val start = awaitFirstDown()
                    val startHoehe = hoeheAktuell()
                    var bewegt = false
                    ziehen(true)
                    while (true) {
                        val e = awaitPointerEvent()
                        val c = e.changes.firstOrNull { it.id == start.id } ?: break
                        val dy = (c.position.y - start.position.y) / density
                        if (abs(dy) > 3) bewegt = true
                        setzen(max(minimum, min(maxAktuell, startHoehe - dy)))
                        c.consume()
                        if (!c.pressed) break
                    }
                    ziehen(false)
                    val h = hoeheAktuell()
                    val mx = maxAktuell
                    if (!bewegt) {
                        // Tipp auf den Griff: zu -> ganz auf, ganz auf -> zu.
                        if (h <= minimum + 1) setzen(mx) else if (h >= mx - 1) setzen(minimum)
                    } else if (h >= rastAktuell) {
                        setzen(min(h, mx))
                    } else {
                        setzen(if (abs(h - minimum) <= abs(h - rastAktuell)) minimum else rastAktuell)
                    }
                }
            },
            contentAlignment = Alignment.Center,
        ) {
            Box(Modifier.size(87.dp, 6.dp).background(LIME))
        }

        Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(start = 20.dp, end = 20.dp, bottom = 30.dp)) {
            val info = fahrer.info
            // Markieren ist im Web noch ohne Funktion.
            Row(
                Modifier.size(362.dp, 56.dp).border(2.dp, LIME),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.Center,
            ) {
                Text("Markieren", style = grotesk(32f, 700, abstand = -0.5f, farbe = LIME), maxLines = 1)
                Spacer(Modifier.width(10.dp))
                Icon("Stern_Trisar_Icon_01_schwarz", Modifier.size(17.dp, 18.dp))
            }

            Column(
                Modifier.padding(top = 12.dp).width(362.dp).background(Color.White).padding(vertical = 10.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                TextZeile(fahrer.kennzeichen, grotesk(30f, 700, abstand = -0.8f, farbe = hex(0x1D1C1D)), hoehe = 30f, ausrichtung = Alignment.Center)
                TextZeile(fahrer.fahrzeug, grotesk(16f, 700, abstand = -0.5f, farbe = hex(0x1D1C1D, 0.35f)), hoehe = 16f, ausrichtung = Alignment.Center)
            }

            Column(
                Modifier.padding(top = 12.dp).size(362.dp, 96.dp).background(LIME).padding(horizontal = 18.dp),
                verticalArrangement = Arrangement.spacedBy(5.dp, Alignment.CenterVertically),
            ) {
                TextZeile(fahrer.name, grotesk(30f, 700, abstand = -0.8f, farbe = hex(0x1D1C1D)), Modifier.fillMaxWidth().tippen(profilOeffnen), hoehe = 30f)
                TextZeile(fahrer.telefon, grotesk(16f, 700, abstand = 0.4f, farbe = hex(0x1D1C1D)), Modifier.tippen { anrufen(ctx, fahrer.telefon) }, hoehe = 24f)
            }

            TextZeile("Nächste Fahrt", grotesk(22f, 700, abstand = -1f, farbe = LIME), Modifier.padding(top = 36.dp), hoehe = 21f)

            val fahrText = when {
                info.fahrMinuten > 0 -> "-${info.fahrMinuten} min Fahrt"
                info.unterwegs && info.ankunft != "--:--" -> "-<1 min Fahrt"
                else -> "- min Fahrt"
            }
            ZeitPaar("ETD" to info.abfahrt, "ETA" to info.ankunft, fahrText, Modifier.padding(top = 12.dp))

            Row(Modifier.padding(top = 24.dp).width(362.dp), verticalAlignment = Alignment.CenterVertically) {
                OrtKachel(info.von.icon)
                Box(Modifier.weight(1f).padding(horizontal = 16.dp), contentAlignment = Alignment.Center) {
                    Icon("Arrow_Trisar_Icons_01_Lime", Modifier.size(59.dp, 38.dp))
                }
                OrtKachel(info.nach.icon)
            }

            Row(Modifier.padding(top = 12.dp).width(362.dp), horizontalArrangement = Arrangement.spacedBy(24.dp)) {
                OrtText(info.von, rechts = false, Modifier.weight(1f))
                OrtText(info.nach, rechts = true, Modifier.weight(1f))
            }

            ZeitPaar("Dienststart" to info.dienststart, "Dienstende" to info.dienstende, null, Modifier.padding(top = 24.dp, bottom = 30.dp))
        }
    }
}

@Composable
private fun ZeitPaar(links: Pair<String, String>, rechts: Pair<String, String>, unterRechts: String?, modifier: Modifier) {
    Row(modifier.width(362.dp), horizontalArrangement = Arrangement.spacedBy(24.dp)) {
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            TextZeile(links.first, grotesk(12f, 700, abstand = -0.3f, farbe = GRAU), hoehe = 12f)
            TextZeile(links.second, grotesk(42f, 700, abstand = -1f, farbe = LIME), hoehe = 38f)
        }
        Column(Modifier.weight(1f), horizontalAlignment = Alignment.End) {
            TextZeile(rechts.first, grotesk(12f, 700, abstand = -0.3f, farbe = GRAU), hoehe = 12f, ausrichtung = Alignment.CenterEnd)
            TextZeile(rechts.second, grotesk(42f, 700, abstand = -1f, farbe = LIME), Modifier.padding(top = 8.dp), hoehe = 38f, ausrichtung = Alignment.CenterEnd)
            if (unterRechts != null) {
                Text(unterRechts, style = grotesk(12f, 700, abstand = -0.5f, farbe = hex(0xF4F5F4, 0.5f)), modifier = Modifier.padding(top = 6.dp), maxLines = 1)
            }
        }
    }
}

@Composable
private fun OrtKachel(icon: String?) {
    Box(Modifier.size(64.dp).background(hex(0x242525), RoundedCornerShape(16.dp)), contentAlignment = Alignment.Center) {
        if (icon != null) Icon(icon, Modifier.size(30.dp))
    }
}

@Composable
private fun OrtText(ort: KartenOrt, rechts: Boolean, modifier: Modifier) {
    Column(modifier, horizontalAlignment = if (rechts) Alignment.End else Alignment.Start, verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(ort.typ, style = grotesk(12f, 700, abstand = -0.4f, farbe = GRAU))
        Text(ort.name, style = grotesk(18f, 700, 18f * 1.05f, -0.5f, Color.White), textAlign = if (rechts) TextAlign.End else TextAlign.Start)
    }
}

// MARK: - Fahrerprofil (DriverProfilePopup)

@Composable
private fun FahrerProfilFenster(fahrer: KartenFahrer, schliessen: () -> Unit) {
    val ctx = LocalContext.current
    Box(Modifier.fillMaxSize().tippen(schliessen), contentAlignment = Alignment.Center) {
        Column(Modifier.width(362.dp).verticalScroll(rememberScrollState()).tippen { }) {
            Box(
                Modifier.padding(bottom = 18.dp).size(54.dp).background(Color.Black.copy(alpha = 0.85f), CircleShape)
                    .border(2.dp, LIME, CircleShape).tippen(schliessen),
                contentAlignment = Alignment.Center,
            ) {
                Icon("Arrow_Trisar_Icons_01_Lime", Modifier.size(29.dp, 18.dp).rotate(180f))
            }

            Column(
                Modifier.width(362.dp).background(Color.Black).border(2.dp, LIME).padding(vertical = 18.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Box(Modifier.size(138.dp).background(hex(0x1F2023)), contentAlignment = Alignment.Center) {
                    Icon("Person_Trisar_Icons_01", Modifier.size(82.dp).alpha(0.75f))
                    if (fahrer.bildURL.startsWith("http")) {
                        AsyncImage(fahrer.bildURL, null, Modifier.fillMaxSize(), contentScale = ContentScale.Crop)
                    }
                }
                Text(fahrer.name, style = grotesk(30f, 700, farbe = LIME), textAlign = TextAlign.Center, modifier = Modifier.padding(top = 18.dp))
                Text(fahrer.kennzeichen, style = grotesk(30f, 700, farbe = hex(0xD6D6D6)), modifier = Modifier.padding(top = 18.dp))
                Box(Modifier.heightIn(min = 22.dp), contentAlignment = Alignment.Center) {
                    Text(fahrer.fahrzeug, style = grotesk(20f, farbe = hex(0xD6D6D6)))
                }
                TelemetrieBlock(fahrer.id)
            }

            val hatTelefon = fahrer.telefon.isNotBlank()
            Box(
                Modifier.padding(top = 18.dp).size(362.dp, 48.dp).background(LIME).tippen { if (hatTelefon) anrufen(ctx, fahrer.telefon) },
                contentAlignment = Alignment.Center,
            ) {
                Text("${fahrer.vorname} anrufen", style = grotesk(16f, 500, farbe = hex(if (hatTelefon) 0x1D1C1D else 0x5F6130)))
                Icon("contact-phone", Modifier.align(Alignment.CenterEnd).padding(end = 14.dp).size(22.dp))
            }
        }
    }
}

/** FahrzeugTelemetrie.jsx: Fahrzeugdaten aus dem OBD-Tracker, dunkle Variante. */
@Composable
private fun TelemetrieBlock(fahrerID: String) {
    val t = remember(fahrerID) { DispoTelemetrie(fahrerID) }
    val scope = rememberCoroutineScope()
    DisposableEffect(t) {
        t.starten(scope)
        onDispose { t.beenden() }
    }
    Column(Modifier.fillMaxWidth().padding(start = 18.dp, end = 18.dp, top = 18.dp)) {
        Box(Modifier.fillMaxWidth().height(1.dp).background(hex(0x3A3B2A)))
        Text("FAHRZEUGDATEN (OBD)", style = grotesk(13f, 700, abstand = 0.5f, farbe = LIME), modifier = Modifier.padding(top = 14.dp))
        if (t.zeilen.isEmpty()) {
            Text("Noch keine Fahrzeugdaten vom Tracker.", style = grotesk(14f, farbe = hex(0x8D8D8D)), modifier = Modifier.padding(top = 10.dp))
        } else {
            Column(Modifier.padding(top = 10.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                for (reihe in t.zeilen.chunked(3)) {
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        for (i in 0 until 3) {
                            val z = reihe.getOrNull(i)
                            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                                if (z != null) {
                                    Text(z.titel, style = grotesk(11f, farbe = hex(0x8D8D8D)), maxLines = 1)
                                    Text(z.wert, style = grotesk(18f, 700, farbe = hex(if (z.warnung) 0xFF6B57 else 0xD6D6D6)), maxLines = 1)
                                }
                            }
                        }
                    }
                }
            }
        }
        if (t.ereignisse.isNotEmpty()) {
            Column(Modifier.padding(top = 12.dp)) {
                for (e in t.ereignisse) {
                    TextZeile("${e.zeit} · ${e.text}", grotesk(11f, farbe = hex(0x8D8D8D)), hoehe = 15.4f)
                }
            }
        }
        if (t.stand.isNotEmpty()) {
            Text("Stand ${t.stand}", style = grotesk(11f, farbe = hex(0x5F6130)), modifier = Modifier.padding(top = 10.dp))
        }
    }
}
