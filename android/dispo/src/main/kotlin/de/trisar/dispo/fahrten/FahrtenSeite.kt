package de.trisar.dispo.fahrten

import androidx.compose.animation.core.animate
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.Orientation
import androidx.compose.foundation.gestures.draggable
import androidx.compose.foundation.gestures.rememberDraggableState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.InlineTextContent
import androidx.compose.foundation.text.appendInlineContent
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.Placeholder
import androidx.compose.ui.text.PlaceholderVerticalAlign
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import de.trisar.dispo.DispoZiel
import de.trisar.dispo.Navileiste
import de.trisar.kern.DispoHintergrund
import de.trisar.kern.Icon
import de.trisar.kern.ZurueckKnopf
import de.trisar.kern.hex
import de.trisar.kern.tippen
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

/** Seiten innerhalb von „Fahrten“ wie die Views ankuenfte/abfahrten/archivAnkuenfte/archivAbfahrten/fahrtenFilter. */
private enum class Teil {
    ANKUENFTE, ABFAHRTEN, ARCHIV_ANKUENFTE, ARCHIV_ABFAHRTEN, FILTER;

    val istArchiv get() = this == ARCHIV_ANKUENFTE || this == ARCHIV_ABFAHRTEN
    val istAbfahrten get() = this == ABFAHRTEN || this == ARCHIV_ABFAHRTEN
}

/**
 * Einstieg fuer DispoZiel.FAHRTEN (FahrtenAnsicht.swift): AnkuenfteView/AbfahrtenView mit Archiv-Schalter
 * und Fahrten-Filter. Tipp auf eine Fahrt ruft `oeffneFahrt` mit der Job-ID („Fahrt bearbeiten“).
 */
@Composable
fun FahrtenSeite(zeigen: (DispoZiel) -> Unit, oeffneFahrt: (String) -> Unit) {
    val speicher = DispoFahrtenSpeicher
    var teil by remember { mutableStateOf(Teil.ANKUENFTE) }
    /** Fuer „Zurueck“ im Filter (window.history.back im Web). */
    var vorFilter by remember { mutableStateOf(Teil.ANKUENFTE) }
    fun wechseln(neu: Teil) { if (neu == Teil.FILTER) vorFilter = teil; teil = neu }

    LaunchedEffect(Unit) { speicher.starten() }
    LifecycleEventEffect(Lifecycle.Event.ON_RESUME) { speicher.wiederAktiv() }
    // Board nur in den Live-Listen, alle 60 s neu (useEffect auf view in App.jsx).
    LaunchedEffect(teil, speicher.standort) {
        if (teil != Teil.ANKUENFTE && teil != Teil.ABFAHRTEN) return@LaunchedEffect
        while (true) {
            speicher.boardLaden(teil == Teil.ABFAHRTEN)
            delay(60_000)
        }
    }

    Box(Modifier.fillMaxSize()) {
        DispoHintergrund()
        if (teil == Teil.FILTER) {
            FahrtenFilterSeite(speicher.filter, { speicher.filter = it }) { teil = vorFilter }
        } else {
            // Suche wie im Web: bleibt beim Wechsel ins Archiv, neu bei Ankuenfte <-> Abfahrten.
            key(teil.istAbfahrten) {
                Liste(teil, ::wechseln, zeigen, oeffneFahrt)
            }
            Navileiste(DispoZiel.FAHRTEN) { ziel ->
                // onNavigateToFahrten fuehrt im Web immer zu den Ankuenften.
                if (ziel == DispoZiel.FAHRTEN) teil = Teil.ANKUENFTE else zeigen(ziel)
            }
        }
        speicher.meldung?.let { Hinweis("Hinweis", it) { speicher.meldung = null } }
    }
}

// MARK: - Liste (AnkuenfteView.jsx / AbfahrtenView.jsx)

private data class Eintrag(val fahrt: DispoFahrt, val zeiten: FahrtZeiten, val neuerTag: String?)

@Composable
private fun Liste(teil: Teil, wechseln: (Teil) -> Unit, zeigen: (DispoZiel) -> Unit, oeffneFahrt: (String) -> Unit) {
    val speicher = DispoFahrtenSpeicher
    var suche by remember { mutableStateOf("") }
    val scope = rememberCoroutineScope()
    val archiv = teil.istArchiv
    val abfahrten = teil.istAbfahrten
    val mitStandort = W.ortNormal(speicher.standort).isNotEmpty()
    val liste = sichtbareFahrten(speicher.fahrten, speicher.filter, speicher.standort, suche, archiv, abfahrten, mitStandort)

    fun zurueck() = when (teil) {
        Teil.ARCHIV_ANKUENFTE -> wechseln(Teil.ANKUENFTE)
        Teil.ARCHIV_ABFAHRTEN -> wechseln(Teil.ABFAHRTEN)
        else -> zeigen(DispoZiel.START)
    }

    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState())
            .padding(start = 20.dp, top = 60.dp, bottom = 175.dp)
    ) {
        Column(Modifier.width(362.dp)) {
            ZurueckKnopf { zurueck() }
            Text(if (archiv) "Archiv" else if (mitStandort) "Meine Fahrten" else "Alle Fahrten",
                style = css(42f, 700, 42f, farbe = LIME), modifier = Modifier.padding(top = 30.dp))

            // Mein Standort
            Row(
                Modifier.padding(top = 24.dp).size(362.dp, 56.dp).border(2.dp, LIME).padding(horizontal = 16.dp),
                verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Text("Mein Standort", style = css(16f, 500, farbe = LIME.copy(alpha = 0.7f)))
                LimeEingabe(speicher.standort, { speicher.standort = it }, Modifier.weight(1f), platzhalter = "Ort eingeben")
                if (speicher.standort.isNotBlank()) {
                    Icon("clear-x-green-24", Modifier.size(24.dp).tippen { speicher.standort = "" })
                }
            }

            if (mitStandort) {
                Row(Modifier.padding(top = 12.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    RichtungsKnopf("Ankünfte", !abfahrten) { if (abfahrten) wechseln(if (archiv) Teil.ARCHIV_ANKUENFTE else Teil.ANKUENFTE) }
                    RichtungsKnopf("Abfahrten", abfahrten) { if (!abfahrten) wechseln(if (archiv) Teil.ARCHIV_ABFAHRTEN else Teil.ABFAHRTEN) }
                }
            }

            // Filter + Archiv bzw. Aktualisieren
            Row(Modifier.padding(top = 12.dp), horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
                Row(
                    Modifier.size(if (mitStandort) (362 - 12 - 36).dp else 260.dp, 56.dp).background(LIME).tippen { wechseln(Teil.FILTER) }
                        .padding(horizontal = 16.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text("Filter", style = css(16f, 500, abstand = 0.4f, farbe = Color.Black))
                    Spacer(Modifier.weight(1f))
                    // _Icon_Schwarz/Filter.svg, eigener Name: kollidiert sonst mit _Icon_Planung/filter.svg.
                    Icon("FilterSchwarz", Modifier.size(34.dp, 21.dp))
                }
                if (!mitStandort) {
                    val ziel = when (teil) {
                        Teil.ANKUENFTE -> Teil.ARCHIV_ANKUENFTE
                        Teil.ARCHIV_ANKUENFTE -> Teil.ANKUENFTE
                        Teil.ABFAHRTEN -> Teil.ARCHIV_ABFAHRTEN
                        else -> Teil.ABFAHRTEN
                    }
                    Box(
                        Modifier.size(90.dp, 56.dp).background(if (archiv) LIME else Color.Black).border(2.dp, LIME).tippen { wechseln(ziel) },
                        contentAlignment = Alignment.Center,
                    ) {
                        Icon("Archiv", Modifier.size(32.dp), farbe = if (archiv) ColorFilter.tint(Color.Black) else null)
                    }
                } else {
                    Icon("Arrow_Nav_Trisar_Icons_01", Modifier.size(36.dp).tippen {
                        speicher.neuLaden()
                        scope.launch { speicher.boardLaden(abfahrten) }
                    })
                }
            }

            // Suche
            val hatSuche = suche.isNotBlank()
            Row(
                Modifier.padding(top = 12.dp).size(362.dp, 56.dp).border(2.dp, LIME).padding(horizontal = 16.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                LimeEingabe(suche, { suche = it }, Modifier.weight(1f), platzhalter = "Kunden/Fahrer Suchen", platzhalterFarbe = LIME.copy(alpha = 0.7f))
                Icon(if (hatSuche) "clear-x-green-24" else "vehicle-search", Modifier.size(24.dp).tippen { if (hatSuche) suche = "" })
            }

            if (speicher.ladeFehler.isNotEmpty()) {
                Text(
                    "Fahrten konnten nicht geladen werden: ${speicher.ladeFehler}",
                    style = css(12f, 500, 12f * 1.35f, farbe = hex(0xFF8E8E)),
                    modifier = Modifier.padding(top = 16.dp).width(362.dp).background(hex(0x171717)).border(1.dp, hex(0x3A3A3A)).padding(12.dp),
                )
            }

            if (mitStandort) {
                BoardKasten(speicher.board, abfahrten, Modifier.padding(top = 16.dp)) {
                    scope.launch { speicher.boardLaden(abfahrten) }
                }
            }

            Column(Modifier.padding(top = 24.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                liste.forEachIndexed { i, eintrag ->
                    key(eintrag.fahrt.id) {
                        if (!abfahrten && eintrag.neuerTag != null) TagTrenner(eintrag.neuerTag, i == 0)
                        FahrtKarte(
                            fahrt = eintrag.fahrt,
                            zeiten = eintrag.zeiten,
                            datumAlsStatus = !abfahrten && W.passt(eintrag.zeiten.status, """^\d{2}\.\d{2}$"""),
                            wischen = !mitStandort && !archiv,
                            oeffnen = { oeffneFahrt(eintrag.fahrt.id) },
                            erledigt = { speicher.erledigt(eintrag.fahrt) },
                            archivieren = { speicher.archivieren(eintrag.fahrt, "ankuenfte") },
                            duplizieren = { speicher.duplizieren(eintrag.fahrt) },
                        )
                    }
                }
                if (liste.isEmpty()) {
                    Text(
                        if (archiv) "Keine archivierten Fahrten gefunden." else "Keine passenden Fahrten gefunden.",
                        style = css(16f, 500, 24f, farbe = LIME), textAlign = TextAlign.Center,
                        modifier = Modifier.width(362.dp).padding(vertical = 24.dp),
                    )
                }
            }
        }
    }
}

// MARK: Filtern, Status, Sortieren (wie in den beiden Web-Ansichten)

/** getRideTargetTime */
private fun zielZeit(f: DispoFahrt, abfahrten: Boolean, mitStandort: Boolean): String {
    val z = f.zeiten
    if (abfahrten) return (if (f.verspaetet) W.erste(z.neu, z.zeit, z.original) else W.erste(z.zeit, z.neu, z.original)) ?: ""
    if (f.aktuellerStatus == "unterwegs") return W.erste(z.ankunftZeit, z.ankunftNeu, z.neu, z.zeit, z.original) ?: ""
    if (!mitStandort) {
        return (if (f.verspaetet) W.erste(z.neu, z.zeit, z.original, z.ankunftNeu, z.ankunftZeit)
        else W.erste(z.zeit, z.neu, z.original, z.ankunftZeit, z.ankunftNeu)) ?: ""
    }
    return (if (f.verspaetet) W.erste(z.ankunftNeu, z.ankunftZeit, z.neu, z.zeit, z.original)
    else W.erste(z.ankunftZeit, z.ankunftNeu, z.zeit, z.neu, z.original)) ?: ""
}

/** buildMinutesLabel (nur Ankuenfte) */
private fun minutenEtikett(f: DispoFahrt, mitStandort: Boolean): String {
    when (f.aktuellerStatus) {
        "beendet" -> return "Beendet"
        "stoniert" -> return "Storniert"
        "unterwegs" -> return "Unterwegs"
    }
    if (f.verzugMinuten > 0) return "+${f.verzugMinuten} min"
    val ziel = W.minuten(zielZeit(f, false, mitStandort), praefix = false) ?: return ""
    val tag = W.tagWert(f.datum.take(10))
    val heute = DispoDatum.heute()
    fun tagMonat(): String { val t = tag.split("-"); return if (t.size == 3) "${t[2]}.${t[1]}" else tag }
    if (tag.isNotEmpty() && tag > heute) return tagMonat()
    if (tag.isNotEmpty() && tag < heute) return "Überfällig"
    val diff = ziel - DispoDatum.jetztMinuten()
    if (diff < 0) return "Überfällig"
    if (diff == 0) return "Jetzt"
    if (diff >= 360 && tag.isNotEmpty()) return tagMonat()
    if (diff >= 60) return "in ${diff / 60}:${"%02d".format(diff % 60)} h"
    return "in $diff min."
}

/** displayTime der Ankuenfte (Abfahrten zeigen ride.time unveraendert). */
private fun anzeigeZeiten(f: DispoFahrt, abfahrten: Boolean, mitStandort: Boolean): FahrtZeiten {
    val z = f.zeiten
    if (abfahrten) return z
    val ziel = zielZeit(f, false, mitStandort)
    val abfahrt = !mitStandort && f.aktuellerStatus != "unterwegs"
    val alt = f.zeiten
    var neu = z.copy(status = minutenEtikett(f, mitStandort))
    neu = if (f.verspaetet) neu.copy(
        original = (if (abfahrt) W.erste(alt.original, alt.zeit, alt.neu, ziel) else W.erste(alt.ankunftOriginal, alt.original, ziel)) ?: "--:--",
        neu = (if (abfahrt) W.erste(alt.neu, alt.zeit, alt.original, ziel) else W.erste(alt.ankunftNeu, alt.ankunftZeit, alt.neu, ziel)) ?: "--:--",
    ) else neu.copy(
        zeit = (if (abfahrt) W.erste(alt.zeit, alt.neu, alt.original, ziel) else W.erste(alt.ankunftZeit, alt.ankunftNeu, alt.zeit, ziel)) ?: "--:--",
    )
    return neu
}

private fun sichtbareFahrten(
    fahrten: List<DispoFahrt>, fi: FahrtenFilterWerte, standort: String, suche: String,
    archiv: Boolean, abfahrten: Boolean, mitStandort: Boolean,
): List<Eintrag> {
    // Vorauswahl aus App.jsx: Live/Archiv, bei Standort Ziel (Ankuenfte) bzw. Start (Abfahrten).
    val basis = fahrten.filter { f ->
        if (f.archiviert != archiv) false
        else if (!mitStandort) true
        else W.ortPasst(if (abfahrten) f.startOrt else f.zielOrt, standort)
    }
    val startSuche = fi.startSuche.trim().lowercase()
    val zielSuche = fi.zielSuche.trim().lowercase()
    val datum = fi.datum.trim()
    val suchText = suche.trim().lowercase()
    val heute = DispoDatum.heute()
    val jetzt = DispoDatum.jetztMinuten()

    val gefiltert = basis.filter { f ->
        val ohneFahrer = f.fahrer.lowercase() == "fahrer fehlt" || f.ohneFahrerVariante
        val teile = f.route.split(" - ")
        val start = teile.first().trim()
        val ziel = teile.drop(1).joinToString(" - ").trim()
        if (fi.ohneFahrer && !ohneFahrer) return@filter false
        if (fi.bestaetigung && !f.bestaetigt) return@filter false
        if (startSuche.isNotEmpty() && !start.lowercase().contains(startSuche)) return@filter false
        if (zielSuche.isNotEmpty() && !ziel.lowercase().contains(zielSuche)) return@filter false
        if (datum.isNotEmpty() && f.datum.take(10) != datum) return@filter false
        if (fi.konvoi && f.konvoi.isEmpty()) return@filter false
        if (fi.besonderheiten && !f.verspaetet) return@filter false
        if (!archiv && !fi.vergangene) {
            val tag = W.tagWert(f.datum.take(10))
            if (tag.isNotEmpty() && tag < heute) return@filter false
            if (!(tag > heute && tag.isNotEmpty())) {
                val zm = W.minuten(zielZeit(f, abfahrten, mitStandort), praefix = false)
                if (zm != null) {
                    val nichtGestartet = f.aktuellerStatus !in setOf("unterwegs", "beendet", "stoniert")
                    if (zm < jetzt && !nichtGestartet) return@filter false
                }
            }
        }
        if (suchText.isEmpty()) return@filter true
        val eintraege = FahrtText.fahrerEintraege(f)
        val nummern = FahrtText.fahrerNummern(eintraege, f.fahrerNummer)
        val heuhaufen = "${f.name} ${f.fahrer} ${eintraege.joinToString(" ")} ${nummern.joinToString(" ")} ${nummern.joinToString(" ") { "#$it" }} $start $ziel".lowercase()
        heuhaufen.contains(suchText)
    }

    fun sortMinuten(f: DispoFahrt): Int {
        val z = f.zeiten
        val zeit = if (abfahrten) W.erste(z.neu, z.zeit, z.original) ?: "" else zielZeit(f, false, mitStandort)
        if (!W.passt(zeit, """^\d{1,2}:\d{2}$""")) return Int.MAX_VALUE
        val t = zeit.split(":").map { it.toInt() }
        return t[0] * 60 + t[1]
    }
    fun sortTag(f: DispoFahrt): String = W.tagWert(f.datum.take(10)).ifEmpty { "9999-12-31" }
    val sortiert = gefiltert.withIndex().sortedWith(
        compareBy<IndexedValue<DispoFahrt>> { sortTag(it.value) }.thenBy { sortMinuten(it.value) }.thenBy { it.index }
    ).map { it.value }

    var vorher: String? = null
    return sortiert.map { f ->
        val tag = W.tagWert(f.datum.take(10))
        val neu = if (tag.isNotEmpty() && tag != vorher) tag else null
        vorher = tag
        Eintrag(f, anzeigeZeiten(f, abfahrten, mitStandort), neu)
    }
}

// MARK: - Fahrtkarte (RideCard)

@Composable
private fun FahrtKarte(
    fahrt: DispoFahrt,
    zeiten: FahrtZeiten,
    /** Ankuenfte: Datum statt Minuten in Schwarz statt Gruen. */
    datumAlsStatus: Boolean,
    wischen: Boolean,
    oeffnen: () -> Unit,
    erledigt: () -> Unit,
    archivieren: () -> Unit,
    duplizieren: () -> Unit,
) {
    val aktionBreite = 90f
    var versatz by remember { mutableFloatStateOf(0f) }
    val scope = rememberCoroutineScope()
    val dichte = LocalDensity.current
    fun gleiten(ziel: Float) { scope.launch { animate(versatz, ziel, animationSpec = tween(180)) { v, _ -> versatz = v } } }

    val rot = fahrt.ohneFahrerVariante
    val textFarbe = if (rot) Color.Black else hex(0x18181B)
    val notizFarbe = if (rot) Color.Black else hex(0x71717B)
    val strichFarbe = if (rot) hex(0x262626) else hex(0xFB2C36)
    val statusFarbe = if (rot) hex(0x262626) else if (datumAlsStatus) hex(0x18181B) else hex(0x59BE80)

    Box(
        Modifier.width(362.dp).clipToBounds().draggable(
            rememberDraggableState { d -> versatz = (versatz + with(dichte) { d.toDp().value }).coerceIn(-aktionBreite, aktionBreite) },
            Orientation.Horizontal, enabled = wischen,
            onDragStopped = { gleiten(if (versatz > 36) aktionBreite else if (versatz < -36) -aktionBreite else 0f) },
        )
    ) {
        if (wischen) {
            Row(Modifier.matchParentSize()) {
                Column(Modifier.width(aktionBreite.dp).fillMaxHeight().background(LIME)) {
                    AktionsKnopf("Faecher_Done", Modifier.weight(1f)) { gleiten(0f); erledigt() }
                    AktionsKnopf("Faecher_Archievieren", Modifier.weight(1f)) { gleiten(0f); archivieren() }
                }
                Spacer(Modifier.weight(1f))
                Column(Modifier.width(aktionBreite.dp).fillMaxHeight().background(LIME)) {
                    // Im Web ohne Aktion, setzt nur die Karte zurueck.
                    AktionsKnopf("Faecher_AddDriver", Modifier.weight(1f)) { gleiten(0f) }
                    AktionsKnopf("Faecher_Duplicat", Modifier.weight(1f)) { gleiten(0f); duplizieren() }
                }
            }
        }
        Box(
            Modifier.offset { IntOffset(if (wischen) versatz.dp.roundToPx() else 0, 0) }
                .width(362.dp).heightIn(min = 144.dp)
                .background(if (rot) hex(0xFB2C36) else Color.White)
                .tippen { if (wischen && versatz != 0f) gleiten(0f) else oeffnen() }
        ) {
            Row(Modifier.padding(18.dp), horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                    NamensZeile(fahrt, textFarbe)
                    Text(fahrt.route, style = css(12f, 500, 16f, 0.3f, textFarbe.copy(alpha = 0.8f)))
                    FahrerZeile(fahrt, textFarbe)
                    NotizBlock(fahrt, notizFarbe)
                }
                RechteSpalte(fahrt, zeiten, strichFarbe, statusFarbe, textFarbe)
            }
            if (fahrt.kiGebucht) {
                Icon(if (rot) "KI_Trisar_Icons_01_Lime" else "KI_Trisar_Icons_01_green", Modifier.padding(start = 8.dp, top = 8.dp).size(14.dp, 13.dp))
            }
            Icon("Arrow_Trisar_Icons_01", Modifier.align(Alignment.BottomEnd).padding(end = 16.dp, bottom = 18.dp).size(34.dp, 21.dp).scale(1.2f))
        }
    }
}

@Composable
private fun NamensZeile(fahrt: DispoFahrt, textFarbe: Color) {
    val kurz = if (fahrt.alleGaeste.isEmpty()) FahrtText.kurzName(fahrt.name) else fahrt.alleGaeste.joinToString(", ") { FahrtText.kurzName(it) }
    val groesse = if (kurz.length > 45) 18f else if (kurz.length > 30) 20f else 24f
    val text = buildAnnotatedString {
        append(kurz)
        if (fahrt.anonymeGaeste > 0) {
            append("  + ${fahrt.anonymeGaeste} ")
            appendInlineContent("person", "[p]")
        }
    }
    val inhalt = mapOf("person" to InlineTextContent(Placeholder(16.sp, 18.sp, PlaceholderVerticalAlign.TextCenter)) {
        Icon("Person_Trisar_Icons_01", Modifier.fillMaxSize(), farbe = ColorFilter.tint(textFarbe.copy(alpha = 0.6f)))
    })
    Text(text, style = css(groesse, 700, groesse * 1.5f, farbe = textFarbe), maxLines = 2, overflow = TextOverflow.Ellipsis, inlineContent = inhalt)
}

@Composable
private fun FahrerZeile(fahrt: DispoFahrt, textFarbe: Color) {
    val eintraege = FahrtText.fahrerEintraege(fahrt)
    val fehlt = eintraege.isEmpty() || eintraege.all { it.lowercase() == FahrtText.FAHRER_FEHLT.lowercase() }
    var teile = mutableListOf<Pair<String, Color>>()
    if (fehlt) {
        teile = mutableListOf(FahrtText.FAHRER_FEHLT to textFarbe)
    } else {
        eintraege.forEachIndexed { i, e ->
            val t = FahrtText.fahrerKurz(e, if (i == 0) fahrt.fahrerNummer else null)
            if (t.isEmpty()) return@forEachIndexed
            val antwort = W.antwort(if (i < fahrt.fahrerAntworten.size) fahrt.fahrerAntworten[i] else "pending")
            val farbe = if (antwort == "refused") hex(0xF55757) else if (antwort == "pending") hex(0xFF8A00) else hex(0x18181B)
            teile.add(t to farbe)
        }
        if (teile.isEmpty()) teile = mutableListOf(FahrtText.FAHRER_FEHLT to textFarbe)
    }
    val text = buildAnnotatedString {
        teile.forEachIndexed { i, (t, farbe) -> withStyle(SpanStyle(color = farbe)) { append((if (i > 0) ", " else "") + t) } }
    }
    Text(text, style = css(16f, 700, 24f, 0.4f, textFarbe))
}

@Composable
private fun NotizBlock(fahrt: DispoFahrt, notizFarbe: Color) {
    val zeilen = (fahrt.notizen.ifEmpty { listOf(fahrt.notiz) }).map { it.trim() }.filter { it.isNotEmpty() }
    if (zeilen.isEmpty()) return
    Column {
        zeilen.forEachIndexed { i, zeile ->
            if (i > 0) Box(Modifier.fillMaxWidth().height(1.dp).background(Color.Black.copy(alpha = 0.1f)))
            Text(if (i == 0) "Notiz: $zeile" else zeile, style = css(12f, 500, 20f, -0.3f, notizFarbe),
                maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.fillMaxWidth())
        }
    }
}

@Composable
private fun RechteSpalte(fahrt: DispoFahrt, zeiten: FahrtZeiten, strichFarbe: Color, statusFarbe: Color, textFarbe: Color) {
    Column(horizontalAlignment = Alignment.End) {
        if (fahrt.verspaetet) {
            Text(zeiten.original, style = css(16f, 400, 20f, farbe = strichFarbe).copy(textDecoration = TextDecoration.LineThrough))
            if (zeiten.status.isNotEmpty()) Text(zeiten.status, style = css(16f, 700, 20f, farbe = statusFarbe))
            Text(zeiten.neu, style = css(16f, 400, 20f, farbe = statusFarbe))
        } else {
            if (zeiten.status.isNotEmpty()) Text(zeiten.status, style = css(16f, 700, 20f, farbe = statusFarbe))
            Text(zeiten.zeit, style = css(16f, 400, 20f, farbe = statusFarbe))
        }
        // Losfahr- bzw. Ankunftszeit klein unter der grossen Zeit.
        val gezeigt = (if (fahrt.verspaetet) zeiten.neu else zeiten.zeit).trim()
        val ankunft = (W.erste(zeiten.ankunftNeu, zeiten.ankunftZeit) ?: "").trim()
        val abfahrt = fahrt.startZeit.trim()
        fun gueltig(z: String) = W.passt(z, """^\d{1,2}:\d{2}$""")
        val zusatz = if (gueltig(ankunft) && ankunft != gezeigt) "Ankunft $ankunft"
        else if (gueltig(abfahrt) && abfahrt != gezeigt) "Abfahrt $abfahrt" else null
        if (zusatz != null) Text(zusatz, style = css(12f, 500, 16f, farbe = textFarbe.copy(alpha = 0.6f)), modifier = Modifier.padding(top = 4.dp))
    }
}

@Composable
private fun AktionsKnopf(icon: String, modifier: Modifier, aktion: () -> Unit) {
    Box(modifier.fillMaxWidth().tippen(aktion), contentAlignment = Alignment.Center) {
        Icon(icon, Modifier.size(36.dp))
    }
}

/** Trennzeile zwischen den Tagen (nur Ankuenfte): Strich — „Mittwoch 04.11.“ — Strich. */
@Composable
private fun TagTrenner(datum: String, erster: Boolean) {
    Row(Modifier.width(362.dp).padding(top = if (erster) 0.dp else 12.dp, bottom = 12.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(44.dp, 2.dp).background(hex(0xE3F754)))
        Spacer(Modifier.weight(1f))
        Text(DispoDatum.trennzeile(datum), style = css(26f, 700, 39f, -0.5f, hex(0xE3F754)), maxLines = 1)
        Spacer(Modifier.weight(1f))
        Box(Modifier.size(44.dp, 2.dp).background(hex(0xE3F754)))
    }
}

/** Ankuenfte/Abfahrten-Umschalter (w-44 h-14), nur mit Standort. */
@Composable
private fun RichtungsKnopf(text: String, aktiv: Boolean, aktion: () -> Unit) {
    Box(
        Modifier.size(176.dp, 56.dp).background(if (aktiv) LIME else Color.Transparent).border(2.dp, LIME).tippen(aktion),
        contentAlignment = Alignment.Center,
    ) { Text(text, style = css(16f, 500, abstand = 0.4f, farbe = if (aktiv) Color.Black else LIME)) }
}

/** Live-Board des Flughafens am Standort (nur mit Standort). */
@Composable
private fun BoardKasten(board: FlughafenBoard, abfahrten: Boolean, modifier: Modifier, aktualisieren: () -> Unit) {
    val gruenGrau = hex(0x9EA57D)
    fun wert(e: DBZeile, k: String, ersatz: String) = W.t(e[k]).ifEmpty { ersatz }
    fun unterzeile(e: DBZeile): String {
        var s = W.t(e["status_description"]).ifEmpty { W.t(e["status_code"]) }.ifEmpty { "-" }
        val terminal = W.t(e["terminal"])
        val gate = W.t(e["gate"])
        if (terminal.isNotEmpty()) s += " · T$terminal"
        if (gate.isNotEmpty()) s += " · G$gate"
        return s
    }
    val stand = board.stand.takeIf { it.isNotEmpty() }?.let {
        runCatching { DateTimeFormatter.ofPattern("HH:mm").withZone(ZoneId.systemDefault()).format(Instant.parse(it)) }.getOrNull()
    }
    Column(modifier.width(362.dp).background(hex(0x101108)).border(1.dp, hex(0x4A4F22)).padding(12.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("${if (abfahrten) "Live-Board Abfahrten" else "Live-Board Ankünfte"} ${if (board.code.isEmpty()) "" else "(${board.code})"}",
                style = css(12f, 700, abstand = 0.3f, farbe = LIME))
            Spacer(Modifier.weight(1f))
            Text("Aktualisieren", style = css(11f, 500, farbe = LIME).copy(textDecoration = TextDecoration.Underline), modifier = Modifier.tippen(aktualisieren))
        }
        if (stand != null) Text("Stand: $stand", style = css(11f, 500, farbe = gruenGrau), modifier = Modifier.padding(top = 4.dp))
        when {
            board.fehler.isNotEmpty() -> Text(board.fehler, style = css(12f, 500, farbe = hex(0xFF8E8E)), modifier = Modifier.padding(top = 8.dp))
            board.laedt -> Text("Lade Live-Flugdaten...", style = css(12f, 500, farbe = LIME.copy(alpha = 0.8f)), modifier = Modifier.padding(top = 8.dp))
            board.eintraege.isEmpty() -> Text("Keine Board-Einträge gefunden.", style = css(12f, 500, farbe = LIME.copy(alpha = 0.8f)), modifier = Modifier.padding(top = 8.dp))
        }
        if (board.fehler.isEmpty() && board.eintraege.isNotEmpty()) {
            Column(Modifier.padding(top = 8.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                board.eintraege.take(5).forEach { e ->
                    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        Column(Modifier.weight(1f)) {
                            Text("${wert(e, "flight_number", "---")} · ${wert(e, "route_label", "-")}", style = css(12f, 500, farbe = LIME), maxLines = 1, overflow = TextOverflow.Ellipsis)
                            Text(unterzeile(e), style = css(12f, 500, farbe = gruenGrau), maxLines = 1, overflow = TextOverflow.Ellipsis)
                        }
                        Text(wert(e, "time_label", "--:--"), style = css(12f, 500, farbe = LIME))
                    }
                }
            }
        }
    }
}
