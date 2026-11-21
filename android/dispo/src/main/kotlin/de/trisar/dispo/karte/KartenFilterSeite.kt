package de.trisar.dispo.karte

import androidx.compose.foundation.background
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.draw.alpha
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import de.trisar.dispo.stamm.Eingabe
import de.trisar.dispo.stamm.dbMeldung
import de.trisar.dispo.stamm.text
import de.trisar.dispo.stamm.Leinwand
import de.trisar.dispo.stamm.StammZeilenKnopf
import de.trisar.kern.Backend
import de.trisar.kern.DispoHintergrund
import de.trisar.kern.EigeneOrte
import de.trisar.kern.Ort
import de.trisar.kern.FussleisteUnten
import de.trisar.kern.Icon
import de.trisar.kern.ZurueckKnopf
import de.trisar.kern.grotesk
import de.trisar.kern.hex
import de.trisar.kern.platz
import de.trisar.kern.tippen
import io.github.jan.supabase.postgrest.from
import io.github.jan.supabase.postgrest.postgrest
import androidx.compose.foundation.shape.RoundedCornerShape
import io.github.jan.supabase.postgrest.query.Columns
import io.github.jan.supabase.postgrest.query.Order
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter

private val LIME = hex(0xE3F654)

/**
 * KartenFilterView.jsx (KartenFilterAnsicht.swift): Fahrersuche, Karosserie, Feierabend, speichern
 * und loeschen. Wie im Web wirkt auf der Karte nur die Fahrersuche (mehrere Begriffe mit ';').
 */
@Composable
internal fun KartenFilterSeite(zurueck: () -> Unit, langeOhneSignal: List<KartenFahrer> = emptyList()) {
    val f = KartenFilter
    val stufen = remember { TrackerStufen() }
    val scope = rememberCoroutineScope()
    // Laedt alle 10 s neu, solange der Filter offen ist (Quittung kommt vom Gateway).
    LaunchedEffect(Unit) {
        while (true) {
            stufen.laden()
            delay(10_000)
        }
    }
    // Wie im Web: Abschnitt "Punkte bei Fahrt" unter Feierabend (Web top 462, hier +20),
    // die Knoepfe darunter rutschen mit.
    // Abschnitt "Ohne Signal ausblenden nach" unter Feierabend (Web 462 + 20), feste Hoehe 180.
    // Abschnitt "Dienststart automatisch" direkt unter Feierabend (Web 462 + 20), feste Hoehe 132.
    val dienststart = remember { DienststartVorlauf() }
    LaunchedEffect(Unit) { dienststart.laden() }
    val dienststartTop = 482f
    val ohneSignalTop = if (dienststart.verfuegbar) dienststartTop + (if (dienststart.fehler == null) 80f else 112f) else dienststartTop
    // Abschnitt "Karte" (Dunkel/Hell/Farbig/Satellit) unter "Ohne Signal", Hoehe 96 wie im Web.
    val kartenStilTop = ohneSignalTop + 136f
    val stufeTop = kartenStilTop + 96f
    val stufeZeilenTop = stufeTop + 32f + 40f + 12f
    val orteTop = if (stufen.tracker.isEmpty()) stufeTop
        else stufeZeilenTop + (stufen.tracker.size + (if (stufen.fehler == null) 0 else 1)) * 24f + 20f

    // Abschnitt Orte: Standard-Radien und eigene Orte (orte, orte_standard).
    var ortOffen by remember { mutableStateOf(false) }
    var ortGewaehlt by remember { mutableStateOf<Ort?>(null) }
    var standardFehler by remember { mutableStateOf<String?>(null) }
    var standardGeladen by remember { mutableStateOf(false) }
    val standard = remember {
        StandardEingabe { rein, raus ->
            val f = OrteDienst.radienFehler(rein, raus)
            standardFehler = f
            if (f == null) scope.launch { standardFehler = OrteDienst.standardSpeichern(rein, raus)?.let { "Speichern fehlgeschlagen: $it" } }
        }
    }
    DisposableEffect(Unit) {
        EigeneOrte.beobachten()
        onDispose { EigeneOrte.nichtMehrBeobachten() }
    }
    LaunchedEffect(Unit) {
        OrteDienst.standardLaden()?.let { standard.rein = it.rein.toString(); standard.raus = it.raus.toString() }
        standardGeladen = true
    }
    LaunchedEffect(standard.zaehler) {
        if (!standardGeladen || standard.zaehler == 0) return@LaunchedEffect
        delay(800)
        standard.ausloesen()
    }
    val zeigeOrte = EigeneOrte.verfuegbar
    val speichernTop = if (zeigeOrte) orteTop + orteAbschnittHoehe(EigeneOrte.liste.size, standardFehler != null) else orteTop
    val inhaltHoehe = maxOf(834f, speichernTop - 20f + 68f + 56f + 120f) + 70f
    Box(Modifier.fillMaxSize().background(Color.Black).tippen { }) {
        DispoHintergrund()
        Leinwand(874f, inhaltHoehe) {
            ZurueckKnopf(Modifier.platz(20f, 60f), zurueck)
            Text("Karten Filter", style = grotesk(42f, 700, 42f, farbe = LIME), modifier = Modifier.platz(20f, 140f, null, 42f), maxLines = 1)

            SuchZeile(Modifier.platz(20f, 206f, 362f, 56f))

            ZweierKnopf("Limosine", f.limousine, Modifier.platz(20f, 286f, 175f, 40f)) { f.limousine = !f.limousine }
            ZweierKnopf("SUV", f.suv, Modifier.platz(207f, 286f, 175f, 40f)) { f.suv = !f.suv }
            ZweierKnopf("VAN", f.van, Modifier.platz(20f, 338f, 175f, 40f)) { f.van = !f.van }
            ZweierKnopf("Coupe", f.coupe, Modifier.platz(207f, 338f, 175f, 40f)) { f.coupe = !f.coupe }

            FeierabendZeile(Modifier.platz(20f, 402f, 362f, 56f))

            if (dienststart.verfuegbar) {
                // 20.11.: nur die Zeile, Ueberschrift und Hinweis raus. Fehler bleibt sichtbar.
                DienststartZeile(dienststart.minuten, Modifier.platz(20f, dienststartTop, 362f, 56f)) { neu ->
                    scope.launch { dienststart.setzen(neu) }
                }
                val fehler = dienststart.fehler
                if (fehler != null) {
                    Text("Speichern fehlgeschlagen: $fehler",
                        style = grotesk(12f, 500, abstand = 0.3f, farbe = hex(0xFF6B6B)),
                        maxLines = 2, overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.platz(20f, dienststartTop + 64f, 362f, 32f))
                }
            }

            Text("Ohne Signal ausblenden nach", style = grotesk(16f, 500, abstand = 0.5f, farbe = LIME.copy(alpha = 0.6f)),
                modifier = Modifier.platz(20f, ohneSignalTop, 362f, 24f), maxLines = 1)
            OhneSignalStunden(Modifier.platz(20f, ohneSignalTop + 32f, 236f, 56f))
            AusblendenKnopf(!OhneSignal.zeigen, Modifier.platz(264f, ohneSignalTop + 32f, 118f, 56f)) {
                OhneSignal.zeigenSetzen(!OhneSignal.zeigen)
            }
            if (langeOhneSignal.isNotEmpty()) {
                val liste = langeOhneSignal.take(4).joinToString(" · ") { OhneSignal.seit(it) } + if (langeOhneSignal.size > 4) " …" else ""
                val zeile = if (OhneSignal.zeigen) "${langeOhneSignal.size} länger ohne Signal, mit letztem Standort sichtbar"
                    else "${langeOhneSignal.size} länger ohne Signal: $liste"
                Text(zeile, style = grotesk(14f, 500, abstand = 0.3f, farbe = LIME.copy(alpha = 0.6f)),
                    maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.platz(20f, ohneSignalTop + 96f, 362f, 24f))
            }

            Text("Karte", style = grotesk(16f, 500, abstand = 0.5f, farbe = LIME.copy(alpha = 0.6f)),
                modifier = Modifier.platz(20f, kartenStilTop, 362f, 24f), maxLines = 1)
            val stile = KartenStil.Art.entries.filter { it != KartenStil.Art.SATELLIT || KartenStil.satellitMoeglich }
            val stilBreite = (362f - 8f * (stile.size - 1)) / stile.size
            stile.forEachIndexed { i, art ->
                ZweierKnopf(art.name_, KartenStil.wirksam == art, Modifier.platz(20f + i * (stilBreite + 8f), kartenStilTop + 32f, stilBreite, 40f)) {
                    KartenStil.setzen(art)
                }
            }

            if (stufen.tracker.isNotEmpty()) {
                Text("Punkte bei Fahrt", style = grotesk(16f, 500, abstand = 0.5f, farbe = LIME.copy(alpha = 0.6f)),
                    modifier = Modifier.platz(20f, stufeTop, 362f, 24f), maxLines = 1)
                TrackerStufen.STUFEN.forEachIndexed { i, stufe ->
                    ZweierKnopf(stufe, stufen.gemeinsameStufe == stufe, Modifier.platz(20f + i * 124f, stufeTop + 32f, 114f, 40f)) {
                        scope.launch { stufen.setzen(stufe) }
                    }
                }
                stufen.tracker.forEachIndexed { i, t ->
                    StufenStatusZeile(t, Modifier.platz(20f, stufeZeilenTop + i * 24f, 362f, 24f)) {
                        scope.launch { stufen.anschlussWechseln(t) }
                    }
                }
                stufen.fehler?.let {
                    Text("Speichern fehlgeschlagen: $it", style = grotesk(14f, 500, farbe = hex(0xFF6B6B)), maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.platz(20f, stufeZeilenTop + stufen.tracker.size * 24f, 362f, 24f))
                }
            }

            if (zeigeOrte) {
                OrteAbschnitt(orteTop, standardFehler, standard) { o -> ortGewaehlt = o; ortOffen = true }
            }

            StammZeilenKnopf("Filter speichern", "Arrow_Trisar_Icons_01", Modifier.platz(20f, speichernTop, 362f, 56f),
                iconBreite = 34f, iconHoehe = 20f, innen = 12f, aktion = zurueck)
            StammZeilenKnopf("Filter Löschen", "Arrow_Nav_Trisar_Icons_01", Modifier.platz(20f, speichernTop + 68f, 362f, 56f),
                iconBreite = 34f, iconHoehe = 20f, hintergrund = 0xFF6B6B, innen = 12f) { f.zuruecksetzen() }
        }
        FussleisteUnten()
        if (ortOffen) OrtBearbeitenSeite(ortGewaehlt, zurueck = { ortOffen = false; ortGewaehlt = null })
    }
}

/** SearchInputRow: links "Fahrer Suchen", beim Tippen "Fahrer" und das Feld, rechts Lupe oder Loeschen. */
@Composable
private fun SuchZeile(modifier: Modifier) {
    val f = KartenFilter
    var fokus by remember { mutableStateOf(false) }
    val anfordern = remember { FocusRequester() }
    val hatWert = f.fahrerSuche.isNotBlank()
    Row(
        modifier.border(2.dp, LIME).tippen { runCatching { anfordern.requestFocus() } }.padding(horizontal = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(if (fokus || hatWert) "Fahrer" else "Fahrer Suchen", style = grotesk(16f, 500, abstand = 0.5f, farbe = LIME.copy(alpha = 0.6f)), maxLines = 1)
        Eingabe(
            f.fahrerSuche, { f.sucheSetzen(it) }, "", grotesk(16f, 500, abstand = 0.5f, farbe = LIME), Color.Transparent,
            Modifier.weight(1f), gross = KeyboardCapitalization.None, fokus = anfordern, fokusGeaendert = { fokus = it },
        )
        Box(Modifier.size(24.dp), contentAlignment = Alignment.Center) {
            if (hatWert) {
                Icon("clear-field-green", Modifier.size(20.dp).tippen { f.sucheSetzen(""); runCatching { anfordern.requestFocus() } })
            } else {
                Icon("karten-filter-search", Modifier.size(24.dp))
            }
        }
    }
}

/**
 * Stunden-Feld fuer die Schwelle "ohne Signal": "nach 0,5 h", ganzes Kaestchen tippbar,
 * Zahlentastatur mit Komma. Gueltige Eingaben gelten sofort.
 */
@Composable
private fun OhneSignalStunden(modifier: Modifier) {
    val fokus = remember { FocusRequester() }
    var aktiv by remember { mutableStateOf(false) }
    var entwurf by remember { mutableStateOf(OhneSignal.stundenText(OhneSignal.minuten)) }
    LaunchedEffect(OhneSignal.minuten, aktiv) { if (!aktiv) entwurf = OhneSignal.stundenText(OhneSignal.minuten) }
    Row(
        modifier.alpha(if (OhneSignal.zeigen) 0.4f else 1f)
            .background(if (aktiv) LIME.copy(alpha = 0.08f) else Color.Transparent)
            .border(2.dp, LIME).tippen { runCatching { fokus.requestFocus() } }.padding(horizontal = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text("nach ", style = grotesk(16f, 500, abstand = 0.5f, farbe = LIME.copy(alpha = 0.6f)), maxLines = 1)
        Eingabe(
            wert = entwurf,
            aendern = { neu ->
                val sauber = neu.filter { it in "0123456789,." }.take(5)
                entwurf = sauber
                OhneSignal.stundenLesen(sauber)?.let { OhneSignal.minutenSetzen(it) }
            },
            platzhalter = "",
            stil = grotesk(16f, 500, abstand = 0.5f, farbe = LIME),
            platzhalterFarbe = LIME.copy(alpha = 0.6f),
            // Breite folgt der Zahl, damit "h" direkt dahinter steht.
            modifier = Modifier.width((entwurf.length.coerceAtLeast(2) * 10 + 6).dp),
            tastatur = KeyboardType.Decimal,
            gross = KeyboardCapitalization.None,
            fokus = fokus,
            fokusGeaendert = { aktiv = it },
        )
        Text(" h", style = grotesk(16f, 500, abstand = 0.5f, farbe = LIME.copy(alpha = 0.6f)), maxLines = 1)
        Spacer(Modifier.weight(1f))
    }
}

/** Knopf neben dem Stunden-Feld: an = "Ausblenden" (Lime gefuellt, Auge zu), aus = "Alle zeigen". */
@Composable
private fun AusblendenKnopf(an: Boolean, modifier: Modifier, aktion: () -> Unit) {
    val farbe = if (an) hex(0x1D1C1D) else LIME
    Row(
        modifier.background(if (an) LIME else Color.Transparent).border(2.dp, LIME).tippen(aktion),
        horizontalArrangement = Arrangement.Center,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        AugeIcon(an, farbe)
        Spacer(Modifier.width(6.dp))
        Text(if (an) "Ausblenden" else "Alle zeigen", style = grotesk(14f, 500, abstand = 0.3f, farbe = farbe), maxLines = 1)
    }
}

/** Auge (durchgestrichen bei Ausblenden), gleiche Form wie im Web. */
@Composable
private fun AugeIcon(zu: Boolean, farbe: Color) {
    Canvas(Modifier.size(18.dp)) {
        val s = size.width / 24f
        val strich = Stroke(width = 2f * s, cap = StrokeCap.Round, join = StrokeJoin.Round)
        val auge = Path().apply {
            moveTo(2f * s, 12f * s)
            quadraticTo(12f * s, -1f * s, 22f * s, 12f * s)
            quadraticTo(12f * s, 25f * s, 2f * s, 12f * s)
            close()
        }
        drawPath(auge, farbe, style = strich)
        drawCircle(farbe, radius = 3f * s, center = Offset(12f * s, 12f * s), style = strich)
        if (zu) drawLine(farbe, Offset(3f * s, 3f * s), Offset(21f * s, 21f * s), strokeWidth = 2f * s, cap = StrokeCap.Round)
    }
}

/** TwoColButton: Rahmen Lime, an = Lime gefuellt mit dunkler Schrift. */
@Composable
private fun ZweierKnopf(text: String, an: Boolean, modifier: Modifier, aktion: () -> Unit) {
    Box(
        modifier.background(if (an) LIME else Color.Transparent).border(2.dp, LIME).tippen(aktion),
        contentAlignment = Alignment.Center,
    ) {
        Text(text, style = grotesk(16f, 500, abstand = 0.4f, farbe = if (an) hex(0x1D1C1D) else LIME))
    }
}

/** MinutePickerRow: "Feierabend in ... min", gewaehlt "Feierabend in 30 min", rechts Uhr oder Loeschen. */
@Composable
private fun FeierabendZeile(modifier: Modifier) {
    val f = KartenFilter
    var offen by remember { mutableStateOf(false) }
    val optionen = listOf("15 min", "30 min", "45 min", "60 min", "90 min", "120 min")
    Row(modifier.border(2.dp, LIME).padding(horizontal = 12.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.weight(1f).tippen { offen = true }, contentAlignment = Alignment.CenterStart) {
            Text(buildAnnotatedString {
                if (f.feierabendMinuten.isEmpty()) {
                    withStyle(SpanStyle(color = LIME.copy(alpha = 0.6f))) { append("Feierabend in ... min") }
                } else {
                    withStyle(SpanStyle(color = LIME.copy(alpha = 0.6f))) { append("Feierabend in ") }
                    withStyle(SpanStyle(color = LIME)) { append(f.feierabendMinuten) }
                }
            }, style = grotesk(16f, 500, abstand = 0.5f), modifier = Modifier.padding(vertical = 16.dp))
            DropdownMenu(offen, { offen = false }, Modifier.background(hex(0x1E1E1E))) {
                for (o in listOf("---") + optionen) {
                    DropdownMenuItem(
                        text = { Text(o, style = grotesk(16f, farbe = Color.White)) },
                        onClick = { f.feierabendMinuten = if (o == "---") "" else o; offen = false },
                    )
                }
            }
        }
        Box(Modifier.size(40.dp), contentAlignment = Alignment.Center) {
            if (f.feierabendMinuten.isEmpty()) {
                Icon("clock-green", Modifier.size(20.dp))
            } else {
                Icon("clear-field-green", Modifier.size(20.dp).tippen { f.feierabendMinuten = "" })
            }
        }
        Spacer(Modifier.size(0.dp))
    }
}

/** Wie FeierabendZeile: "Dienststart 30 min vor 1. Fahrt", aus "Dienststart automatisch aus". */
@Composable
private fun DienststartZeile(minuten: Int?, modifier: Modifier, setzen: (Int?) -> Unit) {
    var offen by remember { mutableStateOf(false) }
    Row(modifier.border(2.dp, LIME).padding(horizontal = 12.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.weight(1f).tippen { offen = true }, contentAlignment = Alignment.CenterStart) {
            Text(buildAnnotatedString {
                if (minuten == null) {
                    withStyle(SpanStyle(color = LIME.copy(alpha = 0.6f))) { append("Dienststart automatisch aus") }
                } else {
                    withStyle(SpanStyle(color = LIME.copy(alpha = 0.6f))) { append("Dienststart ") }
                    withStyle(SpanStyle(color = LIME)) { append("$minuten min") }
                    withStyle(SpanStyle(color = LIME.copy(alpha = 0.6f))) { append(" vor 1. Fahrt") }
                }
            }, style = grotesk(16f, 500, abstand = 0.5f), maxLines = 1, modifier = Modifier.padding(vertical = 16.dp))
            DropdownMenu(offen, { offen = false }, Modifier.background(hex(0x1E1E1E))) {
                DropdownMenuItem(
                    text = { Text("Aus", style = grotesk(16f, farbe = Color.White)) },
                    onClick = { setzen(null); offen = false },
                )
                for (o in DienststartVorlauf.OPTIONEN) {
                    DropdownMenuItem(
                        text = { Text("$o min", style = grotesk(16f, farbe = Color.White)) },
                        onClick = { setzen(o); offen = false },
                    )
                }
            }
        }
        Box(Modifier.size(40.dp), contentAlignment = Alignment.Center) {
            if (minuten == null) {
                Icon("clock-green", Modifier.size(20.dp))
            } else {
                Icon("clear-field-green", Modifier.size(20.dp).tippen { setzen(null) })
            }
        }
    }
}

/**
 * Dienststart automatisch vor der ersten Fahrt (15.11.), wie useDienststartVorlauf im Web.
 * dispo_einstellungen 'dienststart_vorlauf_min', fehlt = aus. Der DB-Trigger trg_jobs_dienststart
 * schickt damit beim Zuteilen einer Fahrt den Dienststart (Migration 20261115140000).
 */
internal class DienststartVorlauf {
    var minuten by mutableStateOf<Int?>(null)
    /** false, wenn die Tabelle fehlt (Migration noch nicht da): Abschnitt bleibt weg. */
    var verfuegbar by mutableStateOf(false)
    var fehler by mutableStateOf<String?>(null)

    suspend fun laden() {
        val zeilen = runCatching {
            Backend.client.from("dispo_einstellungen")
                .select(Columns.raw("schluessel, wert")) { filter { eq("schluessel", SCHLUESSEL) } }
                .decodeList<JsonObject>()
        }.getOrNull() ?: return
        val wert = zeilen.firstOrNull()?.text("wert")?.toDoubleOrNull()
        minuten = wert?.takeIf { it > 0 }?.toInt()
        verfuegbar = true
    }

    suspend fun setzen(neu: Int?) {
        val alt = minuten
        minuten = neu
        fehler = null
        runCatching {
            // Aus = wert null (Zeile bleibt), Standard 60 min setzt die Migration.
            Backend.client.from("dispo_einstellungen").upsert(buildJsonObject {
                put("schluessel", SCHLUESSEL)
                put("wert", neu)
            }) { onConflict = "schluessel" }
        }.onFailure { minuten = alt; fehler = dbMeldung(it) }
    }

    companion object {
        const val SCHLUESSEL = "dienststart_vorlauf_min"
        val OPTIONEN = listOf(15, 30, 45, 60, 90, 120)
    }
}

/**
 * Punkte bei Fahrt fuer alle OBD-Tracker (obd_tracker.stufe), wie useTrackerStufen im Web.
 * Das Gateway uebernimmt die Stufe beim naechsten Verbinden und quittiert sie (stufe_status).
 */
internal class TrackerStufen {
    data class Tracker(
        val imei: String,
        val nummer: Int,
        val stufe: String,
        val status: String,
        val quittungAm: String,
        val anschluss: String = "",
        val anschlussStatus: String = "",
        val anschlussQuelle: String = "",
    )

    var tracker by mutableStateOf<List<Tracker>>(emptyList())
    var fehler by mutableStateOf<String?>(null)

    val gemeinsameStufe: String?
        get() = tracker.firstOrNull()?.stufe?.takeIf { erste -> tracker.all { it.stufe == erste } }

    suspend fun laden() {
        // Tabelle oder Spalte fehlt (Migration noch nicht da): Abschnitt bleibt weg.
        // Erst mit Anschluss, ohne die Spalten (Migration 20261118160000 noch nicht da) wie bisher.
        val zeilen = holen("imei, nummer, stufe, stufe_status, stufe_quittung_am, stufe_antwort, anschluss, anschluss_status, anschluss_quelle")
            ?: holen("imei, nummer, stufe, stufe_status, stufe_quittung_am, stufe_antwort")
            ?: return
        tracker = zeilen
    }

    private suspend fun holen(spalten: String): List<Tracker>? = runCatching {
        Backend.client.from("obd_tracker")
            .select(Columns.raw(spalten)) {
                order("nummer", Order.ASCENDING)
            }
            .decodeList<JsonObject>()
            .mapNotNull { z ->
                val nr = z.text("nummer").toIntOrNull() ?: return@mapNotNull null
                val stufe = z.text("stufe").ifEmpty { return@mapNotNull null }
                Tracker(z.text("imei"), nr, stufe, z.text("stufe_status"), z.text("stufe_quittung_am"),
                    z.text("anschluss"), z.text("anschluss_status"), z.text("anschluss_quelle"))
            }
    }.getOrNull()

    /** Anschluss von Hand umstellen (USB-C <-> OBD), sonst erkennt ihn der Server selbst (18.11.). */
    suspend fun anschlussWechseln(t: Tracker) {
        val neu = if (t.anschluss == "obd") "usbc" else "obd"
        fehler = null
        tracker = tracker.map { if (it.imei == t.imei) it.copy(anschluss = neu, anschlussStatus = "wartet", anschlussQuelle = "hand") else it }
        runCatching {
            Backend.client.postgrest.rpc("tracker_anschluss_waehlen", buildJsonObject {
                put("p_imei", t.imei)
                put("p_anschluss", neu)
            })
        }.onFailure { fehler = dbMeldung(it) }
        laden()
    }

    suspend fun setzen(stufe: String) {
        // Nur Tracker, die die Stufe noch nicht haben oder bei denen sie fehlschlug.
        val imeis = tracker.filter { it.stufe != stufe || it.status !in listOf("wartet", "gesendet", "uebernommen") }.map { it.imei }
        if (imeis.isEmpty()) return
        fehler = null
        tracker = tracker.map { if (it.imei in imeis) it.copy(stufe = stufe, status = "wartet") else it }
        runCatching {
            Backend.client.from("obd_tracker").update(buildJsonObject { put("stufe", stufe) }) {
                filter { isIn("imei", imeis) }
            }
        }.onFailure { fehler = dbMeldung(it) }
        laden()
    }

    companion object {
        val STUFEN = listOf("sparsam", "mittel", "fein")

        /** Heute nur Uhrzeit, sonst "07.11. 14:02". */
        fun uhrzeit(iso: String): String {
            val t = runCatching { Instant.parse(iso) }.getOrNull()
                ?: runCatching { java.time.OffsetDateTime.parse(iso).toInstant() }.getOrNull()
                ?: return ""
            val z = t.atZone(ZoneId.systemDefault())
            val muster = if (z.toLocalDate() == LocalDate.now()) "HH:mm" else "dd.MM. HH:mm"
            return z.format(DateTimeFormatter.ofPattern(muster))
        }
    }
}

/** "Nr. 2 · fein · übernommen 14:02" (TrackerStufeStatus im Web). */
@Composable
private fun StufenStatusZeile(t: TrackerStufen.Tracker, modifier: Modifier, anschlussTippen: () -> Unit) {
    val (text, farbe) = when (t.status) {
        "wartet" -> "wartet auf Tracker" to LIME.copy(alpha = 0.6f)
        "gesendet" -> "gesendet" to LIME.copy(alpha = 0.6f)
        "uebernommen" -> "übernommen ${TrackerStufen.uhrzeit(t.quittungAm)}".trim() to LIME
        "fehler" -> "Fehler" to hex(0xFF6B6B)
        else -> "Stand unbekannt" to LIME.copy(alpha = 0.6f)
    }
    Row(modifier, verticalAlignment = Alignment.CenterVertically) {
        Text(buildAnnotatedString {
            withStyle(SpanStyle(color = LIME, fontWeight = androidx.compose.ui.text.font.FontWeight.Bold)) { append("Nr. ${t.nummer}") }
            withStyle(SpanStyle(color = LIME.copy(alpha = 0.6f))) { append(" · ${t.stufe} · ") }
            withStyle(SpanStyle(color = farbe)) { append(text) }
        }, style = grotesk(14f, 500, abstand = 0.5f), maxLines = 1, overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f))
        if (t.anschluss.isNotEmpty()) {
            // Anschluss (vom Server erkannt), Antippen stellt von Hand um. Lime = uebernommen, blass = wartet.
            val (rahmen, schrift) = when (t.anschlussStatus) {
                "fehler" -> hex(0xFF6B6B) to hex(0xFF6B6B)
                "uebernommen" -> LIME to LIME
                else -> LIME.copy(alpha = 0.4f) to LIME.copy(alpha = 0.6f)
            }
            Box(
                Modifier.padding(start = 8.dp).height(20.dp)
                    .border(1.dp, rahmen, RoundedCornerShape(6.dp))
                    .tippen(anschlussTippen)
                    .padding(horizontal = 8.dp),
                contentAlignment = Alignment.Center,
            ) {
                Text(if (t.anschluss == "obd") "OBD" else "USB-C", style = grotesk(12f, 700, farbe = schrift), maxLines = 1)
            }
        }
    }
}
