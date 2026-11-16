package de.trisar.fahrer.fahrt

import androidx.activity.compose.BackHandler
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.animate
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.detectVerticalDragGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
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
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import de.trisar.fahrer.haupt.DienstreiseSpeicher
import de.trisar.fahrer.haupt.FahrerDienstreise
import de.trisar.kern.FussleisteUnten
import de.trisar.kern.GeoPunkt
import de.trisar.kern.Icon
import de.trisar.kern.KartenInhalt
import de.trisar.kern.DienstreiseAbschnitt
import de.trisar.kern.KartenFahrzeug
import de.trisar.kern.ReiseLage
import de.trisar.kern.ReiseStandort
import de.trisar.kern.ReiseVerbindung
import de.trisar.kern.TicketAblage
import de.trisar.kern.TrisarKarte
import de.trisar.kern.grotesk
import de.trisar.kern.hex
import de.trisar.kern.platz
import de.trisar.kern.tippen
import io.github.jan.supabase.auth.auth
import io.github.jan.supabase.postgrest.from
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.net.URLEncoder
import kotlin.math.PI
import kotlin.math.hypot
import kotlin.math.sin

private val DR_SCHNAPP = CubicBezierEasing(0.22f, 1f, 0.36f, 1f)
private val DR_LIME = hex(0xE2F754)
private val DR_GRAU = hex(0x868786)
private val DR_ORANGE = hex(0xF0997B)

/** Flug: Bogen zwischen zwei Punkten (wie die Flugbahn bei Fahrten), 48 Schritte. */
private fun bogen(a: GeoPunkt, b: GeoPunkt, schritte: Int = 48): List<GeoPunkt> {
    val dx = b.lng - a.lng
    val dy = b.lat - a.lat
    return (0..schritte).map { i ->
        val t = i.toDouble() / schritte
        val hoehe = sin(PI * t) * hypot(dx, dy) * 0.18
        GeoPunkt(a.lat + dy * t + hoehe, a.lng + dx * t)
    }
}

@kotlinx.serialization.Serializable
private data class DrNummer(val driver_number: Int? = null)

/** profiles.driver_number des angemeldeten Fahrers, leer wenn keine. */
private suspend fun eigeneFahrerNummer(): String = runCatching {
    val id = de.trisar.kern.Backend.client.auth.currentUserOrNull()?.id ?: return ""
    de.trisar.kern.Backend.client.from("profiles").select(io.github.jan.supabase.postgrest.query.Columns.raw("driver_number")) {
        filter { eq("id", id) }; limit(1)
    }.decodeList<DrNummer>().firstOrNull()?.driver_number?.toString()
}.getOrNull().orEmpty()

/** getNavigationUrl der Web-App: Koordinaten wenn vorhanden, sonst Name + Adresse. */
private fun reiseNavigation(name: String, adresse: String?, punkt: GeoPunkt?, eigenerOrt: Boolean): String? {
    val ziel = if (punkt != null) "${punkt.lat},${punkt.lng}"
    else FahrtAdresse.fuerNavigation(name, adresse?.ifBlank { null } ?: name, eigenerOrt)
    if (ziel.isEmpty()) return null
    return "https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=" + URLEncoder.encode(ziel, "UTF-8").replace("+", "%20")
}

/**
 * Dienstreise, angetippt in der Fahrtenliste (DienstreiseDetail.jsx, Aufbau wie eine Flughafen-Fahrt):
 * oben die Karte mit der Strecke (Zug ueber die Halte, Flug als Bogen), Startnadel und Zielflagge,
 * darunter das ziehbare Blatt: Abfahrt (Gleis/Gate) | Ankunft, Kacheln Start -> Ziel, grosse Zug-
 * bzw. Flugnummer, Notiz der Dispo, "Dienstreise beenden". Zeiten live, alle 2 Minuten neu.
 */
@Composable
fun DienstreiseSeite(reise: FahrerDienstreise, zurueck: () -> Unit) {
    val scope = rememberCoroutineScope()
    val r = reise.r
    var blattProzent by remember { mutableFloatStateOf(50f) }
    var ziehBeginn by remember { mutableStateOf<Float?>(null) }
    var live by remember { mutableStateOf<ReiseVerbindung?>(null) }
    var beendenFrage by remember { mutableStateOf(false) }

    // Live-Stand je Dienstreise, mit Rueckfall auf den Stand beim Anlegen (useVerbindung).
    LaunchedEffect(r.id, r.nummer, r.datum, r.start_name) {
        if (r.nummer.isEmpty()) return@LaunchedEffect
        while (true) {
            val v = runCatching { ReiseVerbindung.holen(r) }.getOrNull()
            if (v != null && v.fehler == null) live = v
            delay(120_000)
        }
    }
    val v = live ?: r.gespeicherteVerbindung

    // Mit Umstiegen: Live-Stand je Zug/Flug-Abschnitt (genauer Ausstieg), alle 2 Minuten (useAbschnittVerbindungen).
    val teile = reise.abschnitte
    val mehrere = teile.size > 1
    var liveJe by remember { mutableStateOf<Map<String, ReiseVerbindung>>(emptyMap()) }
    val teilSchluessel = teile.joinToString(",") { "${it.id}|${it.nummer}|${it.ab_zeit}" }
    LaunchedEffect(r.id, teilSchluessel) {
        if (!mehrere) return@LaunchedEffect
        while (true) {
            for (a in teile) {
                if (!DienstreiseAbschnitt.mitLive(a.art) || a.nummer.isNullOrBlank()) continue
                val w = runCatching { ReiseVerbindung.holen(a.alsReise(r.datum), a.nach_name.orEmpty()) }.getOrNull()
                if (w != null && w.fehler == null) liveJe = liveJe + (a.id to w)
            }
            delay(120_000)
        }
    }

    // Eigene Fahrernummer (profiles.driver_number) fuer den Fahrer-Punkt am Start, wie auf der Fahrt-Karte.
    var fahrerNummer by remember { mutableStateOf("") }
    LaunchedEffect(Unit) { fahrerNummer = eigeneFahrerNummer() }

    BackHandler { zurueck() }

    // Eigener Handy-Standort der App (Quelle App, mit Zeitpunkt): zaehlt, wenn hoechstens 3 min alt.
    val handy by rememberFahrtStandort()
    val standort = handy?.let { ReiseStandort(it.ort.lat, it.ort.lng, java.time.Instant.ofEpochMilli(it.zeit), de.trisar.kern.Konfig.QUELLE) }
    // Alle 30 s neu einordnen (errechnete Position wandert mit der Uhr).
    var jetzt by remember { mutableStateOf(System.currentTimeMillis()) }
    LaunchedEffect(Unit) { while (true) { delay(30_000); jetzt = System.currentTimeMillis() } }

    // Ohne Umstiege: die Reise als ein Abschnitt (Flug als Bogen, Zug ueber Gleise/Halte).
    val teileLage = if (mehrere) teile else listOf(ReiseLage.alsAbschnitt(r))
    val liveLage: Map<String, ReiseVerbindung> = if (mehrere) liveJe else {
        val start = r.startPunkt; val ziel = r.zielPunkt
        val flugBogen = if (r.flug && start != null && ziel != null) bogen(start, ziel) else null
        val basis = v ?: ReiseVerbindung(if (r.flug) "flug" else "zug", r.nummer)
        mapOf("haupt" to (if (flugBogen != null) basis.copy(linie = flugBogen) else basis))
    }
    val lage = remember(teileLage, liveLage, r.datum, standort, jetzt) { ReiseLage.berechnen(teileLage, liveLage, r.datum, standort, jetzt) }
    // Text am Fahrzeug: laufend "ICE 612 · +3 min", vor Start/im Umstieg "ICE 612 ab 07:28".
    val fahrzeugText = run {
        val a = lage?.aktuell ?: return@run ""
        val w = liveLage[a.id]
        if (lage.vorStart || lage.imUmstieg) "${a.nummer.orEmpty()} ab ${w?.abfahrt?.ifEmpty { null } ?: a.ab_zeit.orEmpty().take(5)}".trim()
        else {
            val spaet = ReiseLage.verspaetungMin(w)
            (a.nummer.orEmpty() + (if (spaet != null && spaet > 0) " · +$spaet min" else "")).trim()
        }
    }
    val karte = run {
        val ziel = r.zielPunkt
        val umstiege = if (mehrere) ReiseLage.umstiegPunkte(teile, liveLage) else emptyList()
        val pos = lage?.position
        // Offene Strecke blau, gefahrenes Stueck grau, Fahrzeug mit Fahrer an der Position, Zielflagge.
        // Eingepasst wird nur auf Strecke und Ziel, damit die wandernde Position nicht neu einpasst.
        KartenInhalt(
            fahrt = lage?.offen.orEmpty(), gefahren = lage?.gefahren.orEmpty(), ziel = ziel, umstiege = umstiege,
            fahrzeug = pos?.let { KartenFahrzeug(it, lage.art, fahrerNummer, fahrzeugText) },
            einpassen = lage?.gesamt.orEmpty() + listOfNotNull(ziel),
        )
    }

    BoxWithConstraints(Modifier.fillMaxSize().background(hex(0x0A0A0A))) {
        val hoehe = maxHeight.value
        val hoehePx = constraints.maxHeight.toFloat()
        val blattHoehe = hoehe * blattProzent / 100f

        TrisarKarte(karte, blattHoehe, Modifier.fillMaxSize())

        Column(
            Modifier.align(Alignment.BottomCenter).fillMaxWidth().height(blattHoehe.dp)
                .shadow(20.dp, RoundedCornerShape(topStart = 20.dp, topEnd = 20.dp), ambientColor = Color.Black, spotColor = Color.Black)
                .clip(RoundedCornerShape(topStart = 20.dp, topEnd = 20.dp))
                .background(hex(0x1A1A1A)),
        ) {
            // Griff: 87 x 6 Lime, 18 Luft oben und unten (wie bei der Fahrt).
            Box(
                Modifier.fillMaxWidth().height(42.dp).pointerInput(hoehePx) {
                    var weg = 0f
                    detectVerticalDragGestures(
                        onDragStart = { ziehBeginn = blattProzent; weg = 0f },
                        onDragEnd = {
                            ziehBeginn = null
                            val ziel = if (blattProzent > 70) 85f else if (blattProzent < 40) 25f else 50f
                            scope.launch { animate(blattProzent, ziel, animationSpec = tween(320, easing = DR_SCHNAPP)) { w, _ -> blattProzent = w } }
                        },
                        onDragCancel = { ziehBeginn = null },
                    ) { aenderung, betrag ->
                        aenderung.consume()
                        weg += betrag
                        val neu = (ziehBeginn ?: 50f) - weg / hoehePx * 100f
                        blattProzent = neu.coerceIn(25f, 85f)
                    }
                },
                contentAlignment = Alignment.Center,
            ) { Box(Modifier.size(87.dp, 6.dp).background(DR_LIME)) }

            Box(Modifier.weight(1f).fillMaxWidth().verticalScroll(rememberScrollState())) {
                DienstreiseBlatt(reise, v, liveJe, lage?.status.orEmpty()) { beendenFrage = true }
            }
        }

        FussleisteUnten()

        KarteZurueck(Modifier.platz(20f, 60f)) { zurueck() }
    }

    if (beendenFrage) {
        AlertDialog(
            onDismissRequest = { beendenFrage = false },
            confirmButton = {
                TextButton(onClick = {
                    beendenFrage = false
                    scope.launch { if (DienstreiseSpeicher.beenden(reise)) zurueck() }
                }) { Text("OK") }
            },
            dismissButton = { TextButton(onClick = { beendenFrage = false }) { Text("Abbrechen") } },
            text = { Text("Dienstreise beenden?") },
        )
    }
}

/** Inhalt des Blatts: Abfahrt | Ankunft, Start -> Ziel, Nummer, Notiz, Beenden. */
@Composable
private fun DienstreiseBlatt(
    reise: FahrerDienstreise, v: ReiseVerbindung?, liveJe: Map<String, ReiseVerbindung>,
    /** Status je Abschnitt aus ReiseLage: "fertig", "jetzt", "offen". */
    status: List<String>, beenden: () -> Unit,
) {
    val r = reise.r
    val flug = r.flug
    val unten = WindowInsets.navigationBars.asPaddingValues().calculateBottomPadding()
    val nummer = v?.nummer?.ifEmpty { null } ?: r.nummer
    // Mit Umstiegen: Abfahrt des ersten, Ankunft des letzten Abschnitts (live, sonst Ticket).
    val teile = reise.abschnitte
    val mehrere = teile.size > 1
    val erster = teile.firstOrNull()
    val letzter = teile.lastOrNull()
    val ersterLive = if (mehrere && erster != null) liveJe[erster.id] else null
    val letzterLive = if (mehrere && letzter != null) liveJe[letzter.id] else null
    val abfahrt = if (mehrere) ersterLive?.abfahrt?.ifEmpty { null } ?: erster?.ab_zeit.orEmpty().take(5)
        else v?.abfahrt?.ifEmpty { null } ?: r.zeit
    val abfahrtPlanRoh = if (mehrere) ersterLive?.abfahrtPlan.orEmpty() else v?.abfahrtPlan.orEmpty()
    val abfahrtPlan = abfahrtPlanRoh.takeIf { it.isNotEmpty() && it != abfahrt }.orEmpty()
    val ankunft = if (mehrere) ersterOderLeer(letzterLive?.ankunft, letzter?.an_zeit) else v?.ankunft?.ifEmpty { null } ?: "--:--"
    val ankunftPlanRoh = if (mehrere) letzterLive?.ankunftPlan.orEmpty() else v?.ankunftPlan.orEmpty()
    val ankunftPlan = ankunftPlanRoh.takeIf { it.isNotEmpty() && it != ankunft }.orEmpty()
    val gleisRoh = if (mehrere) ersterLive?.gleis?.ifEmpty { null } ?: erster?.gleis_ab.orEmpty() else v?.gleis.orEmpty()
    val gleis = gleisRoh.takeIf { it.isNotEmpty() }?.let { if (flug) it else "Gleis $it" }.orEmpty()
    val letzterGleis = letzter?.let { l -> de.trisar.kern.GleisStand.von(liveJe[l.id]?.gleisAn, l.gleis_an, liveJe[l.id]?.gleisAnPlan).gleis }
    val ankunftOrt = if (mehrere) listOfNotNull(letzter?.nach_name?.ifBlank { null }, letzterGleis?.ifBlank { null }?.let { "Gl. $it" }).joinToString(" · ")
        else v?.ankunftOrt.orEmpty()
    val unterStart = if (mehrere) erster?.von_name.orEmpty() else ""
    val klein = grotesk(12f, 700, abstand = -0.3f, farbe = DR_GRAU)
    val gross = grotesk(32f, 700, zeilenHoehe = 32f * 0.88f, abstand = -1f, farbe = DR_LIME)
    val plan = grotesk(12f, 700, farbe = DR_GRAU).copy(textDecoration = TextDecoration.LineThrough)

    Column(Modifier.fillMaxWidth().padding(start = 20.dp, end = 20.dp, bottom = 24.dp + unten)) {
        // Wie ETD/ETA einer Fahrt: Beschriftung klein grau, Zeit gross in Lime, darunter Gleis bzw. Ankunftsort.
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.Top) {
            Column {
                Text(if (flug) "Abflug" else "Abfahrt", style = klein)
                Text(abfahrt, style = gross, modifier = Modifier.padding(top = 6.dp))
                if (abfahrtPlan.isNotEmpty()) Text("Plan: $abfahrtPlan", style = plan, modifier = Modifier.padding(top = 4.dp))
                if (unterStart.isNotEmpty()) Text(unterStart, style = grotesk(12f, 700, farbe = DR_GRAU), modifier = Modifier.padding(top = 4.dp))
                if (gleis.isNotEmpty()) Text(gleis, style = grotesk(12f, 700, farbe = DR_GRAU), modifier = Modifier.padding(top = 4.dp))
            }
            Spacer(Modifier.weight(1f))
            Column(horizontalAlignment = Alignment.End) {
                Text("Ankunft", style = klein)
                Text(ankunft, style = gross, modifier = Modifier.padding(top = 6.dp))
                if (ankunftPlan.isNotEmpty()) Text("Plan: $ankunftPlan", style = plan, modifier = Modifier.padding(top = 4.dp))
                if (ankunftOrt.isNotEmpty()) Text(ankunftOrt, style = grotesk(12f, 700, farbe = DR_GRAU), textAlign = TextAlign.End, modifier = Modifier.padding(top = 4.dp))
            }
        }

        // Kacheln Start -> Ziel, Name fuehrt zu Google Maps.
        Row(Modifier.fillMaxWidth().padding(top = 40.dp), verticalAlignment = Alignment.Top,
            horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Column(Modifier.weight(1f), horizontalAlignment = Alignment.Start) {
                OrtKachel(r.startIcon, Modifier)
                OrtText(if (flug) "Abflug" else "Bahnhof", r.start_name,
                    reiseNavigation(r.start_name, r.start_adresse, r.startPunkt, r.start_ort_id != null), false, Modifier.padding(top = 24.dp))
            }
            Icon("Arrow_Trisar_Icons_01_Lime", Modifier.padding(top = 19.dp).size(46.dp, 26.dp))
            Column(Modifier.weight(1f), horizontalAlignment = Alignment.End) {
                OrtKachel(r.zielIcon, Modifier)
                OrtText("Ziel", r.ziel_name,
                    reiseNavigation(r.ziel_name, r.ziel_adresse, r.zielPunkt, r.ziel_ort_id != null), true, Modifier.padding(top = 24.dp))
            }
        }

        if (mehrere) {
            Text("Verbindung", style = grotesk(42f, 700, zeilenHoehe = 40f, abstand = -1f, farbe = DR_LIME), modifier = Modifier.padding(top = 40.dp))
            teile.forEachIndexed { i, a -> AbschnittZeile(a, teile.getOrNull(i + 1), liveJe, status.getOrNull(i) ?: "offen", r.datum) }
        } else if (nummer.isNotEmpty()) {
            Text(nummer, style = grotesk(58f, 700, zeilenHoehe = 52f, abstand = -1f), modifier = Modifier.padding(top = 44.dp))
            val nach = v?.ankunftOrt.orEmpty()
            if (nach.isNotEmpty()) {
                Text("Nach: $nach", style = grotesk(18f, 700, abstand = -0.5f, farbe = DR_GRAU), modifier = Modifier.padding(top = 6.dp))
            }
        }

        val notiz = r.notiz?.trim().orEmpty()
        if (notiz.isNotEmpty()) {
            // Notiz wie bei einer Fahrt: Titel gross in Lime, Zeit und Datum grau, "Dispo" rechts, Text weiss.
            val zeit = FahrtZeit.ausISO(r.geaendert ?: r.erstellt)
            Box(Modifier.padding(top = 40.dp).height(52.dp)) {
                Text("Notiz", style = grotesk(58f, 700, zeilenHoehe = 52f, abstand = -1f, farbe = DR_LIME), softWrap = false)
            }
            Column(Modifier.padding(top = 12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                val stil = grotesk(16f, 700, abstand = -0.5f, farbe = DR_GRAU)
                Row(Modifier.fillMaxWidth().height(16.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text(zeit?.let { FahrtZeit.uhrzeit(it) } ?: "", style = stil)
                    if (zeit != null) Text(FahrtZeit.datumKurz(zeit), style = stil, modifier = Modifier.padding(start = 44.dp))
                    Spacer(Modifier.weight(1f).width(8.dp))
                    Text("Dispo", style = stil, textAlign = TextAlign.End, maxLines = 1)
                }
                Text(notiz, style = grotesk(18f, 700, zeilenHoehe = 22f, abstand = -0.5f, farbe = hex(0xF4F5F4)))
            }
        }

        if (!r.ticket_pfad.isNullOrBlank()) {
            // Ticket (PDF): Link fuer eine Stunde, im PDF-Betrachter oeffnen.
            val ctx = androidx.compose.ui.platform.LocalContext.current
            val bereich = rememberCoroutineScope()
            var ticketFehler by remember { mutableStateOf(false) }
            Row(
                Modifier.padding(top = 20.dp).fillMaxWidth().border(2.dp, DR_LIME).tippen {
                    bereich.launch {
                        val url = TicketAblage.link(r.ticket_pfad)
                        if (url.isNotEmpty()) { ticketFehler = false; TicketAblage.oeffnen(ctx, url) } else ticketFehler = true
                    }
                }.padding(horizontal = 14.dp, vertical = 12.dp),
                verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                Icon("Ticket_Trisar_Icons_01_grau", Modifier.size(30.dp))
                Column(Modifier.weight(1f)) {
                    Text("Ticket (PDF)", style = grotesk(18f, 700))
                    val unter = listOfNotNull(r.auftragsnummer?.ifBlank { null }?.let { "Auftrag $it" }, r.reisender?.ifBlank { null })
                        .joinToString(" · ").ifEmpty { r.ticket_name.orEmpty() }
                    Text(unter, style = grotesk(13f, 700, farbe = DR_GRAU), maxLines = 1, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis)
                }
                Icon("Arrow-kurz_Trisar_Icons_01_Lime", Modifier.size(10.dp, 13.dp))
            }
            if (ticketFehler) Text("Ticket konnte nicht geöffnet werden.", style = grotesk(13f, 700, farbe = hex(0xFF6F63)), modifier = Modifier.padding(top = 6.dp))
        }

        if (reise.angenommen) {
            Row(
                Modifier.padding(top = 48.dp).fillMaxWidth().height(56.dp).background(hex(0xFF6F63)).tippen(beenden)
                    .padding(start = 18.dp, end = 16.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text("Dienstreise beenden", style = grotesk(18f, 500, abstand = 0.5f, farbe = Color.Black))
                Spacer(Modifier.weight(1f))
                Icon("Arrow_Trisar_Icons_01", Modifier.size(34.dp, 19.dp))
            }
        }

        // Luft ueber der Fussleiste (60 + 40) wie bei der Fahrt.
        Spacer(Modifier.height(100.dp))
    }
}

/** Erste nicht leere Uhrzeit (live, sonst Ticket), sonst "--:--". */
private fun ersterOderLeer(live: String?, plan: String?): String =
    live?.ifEmpty { null } ?: plan?.take(5)?.ifEmpty { null } ?: "--:--"

/**
 * Ein Abschnitt unter "Verbindung": Icon-Kachel 52, Nummer, "ab Start | Gl." und "an Ziel | Gl." (Zeit bei
 * Verspaetung in Orange mit Kachel "+5", Entwurf 14.11.), darunter beim Zug die Halte zum Ausklappen und
 * "— Umstieg N min · Gleis 3 → 4" zum naechsten Abschnitt.
 */
@Composable
private fun AbschnittZeile(a: DienstreiseAbschnitt, naechster: DienstreiseAbschnitt?, liveJe: Map<String, ReiseVerbindung>, zustand: String, datum: String) {
    val w = liveJe[a.id]
    val ab = w?.abfahrt?.ifEmpty { null } ?: a.ab_zeit.orEmpty().take(5)
    val an = w?.ankunft?.ifEmpty { null } ?: a.an_zeit.orEmpty().take(5)
    val spaetAb = DienstreiseAbschnitt.verspaetung(w?.abfahrtPlan, w?.abfahrt)
    val spaetAn = DienstreiseAbschnitt.verspaetung(w?.ankunftPlan, w?.ankunft)
    // Gleis live gegen Ticket/Fahrplan (15.11.): geaendert altes grau durchgestrichen, neues Orange.
    val gleisAb = de.trisar.kern.GleisStand.von(w?.gleis, a.gleis_ab, w?.gleisPlan)
    val gleisAn = de.trisar.kern.GleisStand.von(w?.gleisAn, a.gleis_an, w?.gleisAnPlan)
    // Laufender Abschnitt hervorgehoben (JETZT), erledigte blass mit "gefahren" (Entwurf 14.11.).
    val jetzt = zustand == "jetzt"
    Row(Modifier.padding(top = 22.dp).fillMaxWidth().alpha(if (zustand == "fertig") 0.45f else 1f),
        horizontalArrangement = Arrangement.spacedBy(14.dp), verticalAlignment = Alignment.Top) {
        val kachel = if (jetzt) Modifier.size(52.dp).background(Color.Black, RoundedCornerShape(14.dp)).border(2.5.dp, DR_LIME, RoundedCornerShape(14.dp))
            else Modifier.size(52.dp).background(hex(0x242525), RoundedCornerShape(14.dp))
        Box(kachel, contentAlignment = Alignment.Center) {
            Icon(if (jetzt) ReiseLage.fahrzeugIcon(a.art) else DienstreiseAbschnitt.icon(a.art), Modifier.size(26.dp))
        }
        Column(Modifier.weight(1f)) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(a.nummer.orEmpty(), style = grotesk(22f, 700, abstand = -0.5f), modifier = Modifier.weight(1f))
                when {
                    jetzt -> Text("JETZT", maxLines = 1,
                        style = grotesk(12f, 700, farbe = Color.Black), modifier = Modifier.background(DR_LIME).padding(horizontal = 8.dp, vertical = 3.dp))
                    zustand == "fertig" -> Text("✓ gefahren", style = grotesk(12f, 700, farbe = DR_GRAU), maxLines = 1)
                }
            }
            @Composable
            fun zeile(zeit: String, spaet: Int, ort: String, gleis: de.trisar.kern.GleisStand, oben: Int) {
                // Zeit Lime, bei Verspaetung Orange mit Kachel "+5" direkt daneben.
                Row(Modifier.padding(top = oben.dp).fillMaxWidth(), verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(zeit, style = grotesk(18f, 700, farbe = de.trisar.kern.ReiseZeiten.farbe(spaet)), maxLines = 1)
                    de.trisar.kern.VerspaetungKachel(spaet)
                    Text(ort, style = grotesk(18f, 700, farbe = Color.White), modifier = Modifier.weight(1f))
                    if (gleis.geaendert) Text(gleis.vorher, style = grotesk(13f, 700, farbe = DR_GRAU)
                        .copy(textDecoration = TextDecoration.LineThrough))
                    Text(if (gleis.gleis.isNotEmpty()) "Gl. ${gleis.gleis}" else "",
                        style = grotesk(13f, 700, farbe = if (gleis.geaendert) DR_ORANGE else DR_GRAU))
                }
            }
            zeile(ab, spaetAb, a.von_name, gleisAb, 6)
            zeile(an, spaetAn, a.nach_name.orEmpty(), gleisAn, 2)
            // Zug: Zwischenhalte zum Ausklappen (train-validate halte), fehlen sie, keine Kachel.
            val halte = w?.halte.orEmpty()
            if (halte.isNotEmpty() && a.art != "flug") {
                de.trisar.kern.HalteKachel(halte, a.ab_datum?.ifBlank { null } ?: datum, ab, laeuft = jetzt,
                    modifier = Modifier.padding(top = 12.dp))
            }
        }
    }
    if (naechster != null) {
        val nw = liveJe[naechster.id]
        val nAb = DienstreiseAbschnitt.minuten(nw?.abfahrt?.ifEmpty { null } ?: naechster.ab_zeit)
        val dAn = DienstreiseAbschnitt.minuten(an)
        val umstieg = if (nAb != null && dAn != null) (nAb - dAn + 1440) % 1440 else null
        val naechstesGleis = de.trisar.kern.GleisStand.von(nw?.gleis, naechster.gleis_ab, nw?.gleisPlan)
        // "Umstieg 44 min · Gleis 3 → 9", geaenderte Gleise Orange.
        val umstiegText = androidx.compose.ui.text.buildAnnotatedString {
            append("Umstieg" + (if (umstieg != null) " $umstieg min" else ""))
            if (gleisAn.gleis.isNotEmpty() && naechstesGleis.gleis.isNotEmpty()) {
                append(" · Gleis ")
                if (gleisAn.geaendert) withStyle(androidx.compose.ui.text.SpanStyle(color = DR_ORANGE)) { append(gleisAn.gleis) } else append(gleisAn.gleis)
                append(" → ")
                if (naechstesGleis.geaendert) withStyle(androidx.compose.ui.text.SpanStyle(color = DR_ORANGE)) { append(naechstesGleis.gleis) } else append(naechstesGleis.gleis)
            }
        }
        Row(Modifier.padding(start = 66.dp, top = 18.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Box(Modifier.size(20.dp, 2.dp).background(DR_LIME))
            Text(umstiegText, style = grotesk(14f, 700, farbe = DR_GRAU))
        }
    }
}
