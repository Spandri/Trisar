package de.trisar.fahrer.haupt

import android.app.TimePickerDialog
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import de.trisar.kern.FussleisteUnten
import de.trisar.kern.Icon
import de.trisar.kern.Stunden
import de.trisar.kern.ZurueckKnopf
import de.trisar.kern.grotesk
import de.trisar.kern.hex
import de.trisar.kern.tippen
import kotlinx.coroutines.launch

private val LIME = hex(0xE3F654)
private val ROT = hex(0xFF6F63)
private val ORANGE = hex(0xFFCD8A)
private val GRUEN = hex(0x8DFFAF)
private val DUNKEL = hex(0x18181B)

private fun st(groesse: Float, gewicht: Int = 500, farbe: Color = Color.White, zeile: Float? = null): TextStyle = grotesk(groesse, gewicht, zeile, 0f, farbe)

// MARK: Texte aus Stunden.jsx (TEXTE)

private val TEXTE = mapOf(
    "verlauf" to "Verlauf",
    "leer" to "Noch keine abgeschlossenen Dienste.",
    "dienstbeginn" to "Dienstbeginn {zeit}",
    "dienstende" to "Dienstende {zeit}",
    "erfassen" to "Stunden erfassen",
    "laeuft" to "Dienst läuft noch",
    "eingereicht" to "Eingereicht",
    "bestaetigt" to "Bestätigt",
    "zurueckgegeben" to "Zurückgegeben",
    "neu" to "Neu erfassen",
    "arbeitszeit" to "Arbeitszeit",
    "beginn" to "Beginn",
    "ende" to "Ende",
    "pause" to "Pause",
    "pauseMin" to "Pause (Min.)",
    "fahrten" to "Fahrten",
    "stimmt" to "Stimmt so, bestätigen",
    "anpassen" to "Anpassen",
    "einreichen" to "Einreichen",
    "begruendung" to "Warum weicht es ab?",
    "begruendungFehlt" to "Bitte kurz begründen, warum die Zeiten abweichen.",
    "geschaetzt" to "geplant",
    "hinweisStart" to "Stunden erfassen: {tage}",
    "vorschlag" to "Vorschlag",
    "minuten" to "{n} Min.",
    "fehler" to "Speichern fehlgeschlagen: {meldung}",
)

private fun tx(k: String, w: Map<String, String> = emptyMap()): String {
    var s = TEXTE[k] ?: k
    for ((a, b) in w) s = s.replace("{$a}", b)
    return s
}

/** Hintergrund wie Profil und Verlauf, Inhalt scrollt in einer Spalte (402 breit). */
@Composable
private fun StundenRahmen(unten: Int = 90, inhalt: @Composable () -> Unit) {
    Box(Modifier.fillMaxSize().background(Color.Black)) {
        ProfilHintergrund()
        Box(Modifier.fillMaxSize().imePadding().verticalScroll(rememberScrollState()), contentAlignment = Alignment.TopCenter) {
            Column(Modifier.width(402.dp).padding(start = 20.dp, end = 20.dp, top = 60.dp, bottom = unten.dp)) { inhalt() }
        }
    }
}

// MARK: Verlauf (live)

/**
 * Verlauf.jsx (live): vergangene Dienste der letzten 60 Tage mit Fahrten und Stundenstatus.
 * `stand` erhoeht sich nach dem Einreichen, dann wird neu geladen.
 */
@Composable
internal fun VerlaufSeite(stand: Int, zurueck: () -> Unit, erfassen: (Stunden.Eintrag) -> Unit) {
    var eintraege by remember { mutableStateOf<List<Stunden.Eintrag>?>(null) }
    LaunchedEffect(stand) {
        eintraege = try { Stunden.verlauf(null, 60) } catch (e: kotlinx.coroutines.CancellationException) { throw e } catch (e: Exception) { emptyList() }
    }
    Box(Modifier.fillMaxSize()) {
        StundenRahmen {
            ZurueckKnopf(aktion = zurueck)
            Text(tx("verlauf"), style = grotesk(42f, 700, zeilenHoehe = 42f, abstand = -0.5f, farbe = LIME), modifier = Modifier.padding(top = 30.dp))
            val liste = eintraege
            Column(Modifier.padding(top = 24.dp), verticalArrangement = Arrangement.spacedBy(28.dp)) {
                if (liste != null && liste.isEmpty()) {
                    Text(tx("leer"), style = grotesk(16f, 500, zeilenHoehe = 24f, abstand = 0.5f, farbe = Color.White.copy(alpha = 0.7f)))
                }
                liste?.forEach { e -> DienstBlock(e) { erfassen(e) } }
            }
        }
        FussleisteUnten()
    }
}

@Composable
private fun DienstBlock(e: Stunden.Eintrag, oeffnen: () -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(44.dp, 2.dp).background(LIME))
            Spacer(Modifier.weight(1f))
            Text(Stunden.tagTitel(e.dienst.datum), style = st(24f, 700, LIME), maxLines = 1)
            Spacer(Modifier.weight(1f))
            Box(Modifier.size(44.dp, 2.dp).background(LIME))
        }
        StatusZeile(tx("dienstbeginn", mapOf("zeit" to e.dienst.beginn)), LIME)
        e.vorschlag.fahrten.forEach { f ->
            Column(Modifier.fillMaxWidth().background(Color.White).padding(horizontal = 16.dp, vertical = 12.dp)) {
                Text("${Stunden.uhr(f.start)} – ${Stunden.uhr(f.ende)}", style = st(13f, 500, DUNKEL.copy(alpha = 0.7f)))
                Text(f.gaeste.ifEmpty { "${f.von} → ${f.nach}" }, style = st(20f, 700, DUNKEL, 24f))
                if (f.gaeste.isNotEmpty()) Text("${f.von} → ${f.nach}", style = st(12f, 500, DUNKEL.copy(alpha = 0.7f)))
            }
        }
        StatusZeile(tx("dienstende", mapOf("zeit" to e.dienst.ende)), ROT)
        StundenStatus(e, oeffnen)
    }
}

@Composable
private fun StatusZeile(text: String, farbe: Color) {
    Box(Modifier.fillMaxWidth().height(48.dp).border(1.dp, farbe).padding(horizontal = 16.dp), contentAlignment = Alignment.CenterStart) {
        Text(text, style = st(22f, 700, farbe), maxLines = 1)
    }
}

@Composable
private fun StundenStatus(e: Stunden.Eintrag, oeffnen: () -> Unit) {
    val z = e.zettel
    if (z != null) {
        val farbe = when (z.status) { "bestaetigt" -> GRUEN; "zurueckgewiesen" -> ROT; else -> ORANGE }
        val label = when (z.status) { "bestaetigt" -> tx("bestaetigt"); "zurueckgewiesen" -> tx("zurueckgegeben"); else -> tx("eingereicht") }
        Column {
            Row(
                Modifier.fillMaxWidth().height(56.dp).border(2.dp, farbe).tippen { if (z.status != "bestaetigt") oeffnen() }.padding(horizontal = 16.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(label, style = st(16f, 700, farbe))
                Spacer(Modifier.weight(1f))
                Text("${Stunden.hmm(z.arbeitsMin)} h", style = st(20f, 700, farbe))
            }
            if (z.status == "zurueckgewiesen" && z.dispoNotiz.isNotEmpty()) {
                Text(z.dispoNotiz, style = st(13f, 500, ROT), modifier = Modifier.padding(top = 6.dp))
            }
            if (z.status == "zurueckgewiesen") {
                Text(tx("neu"), style = st(13f, 500, LIME).copy(textDecoration = TextDecoration.Underline), modifier = Modifier.padding(top = 6.dp).tippen(oeffnen))
            }
        }
        return
    }
    if (!e.vorbei) {
        Text(tx("laeuft"), style = st(13f, 500, Color.White.copy(alpha = 0.45f)))
        return
    }
    Row(Modifier.fillMaxWidth().height(56.dp).background(LIME).tippen(oeffnen).padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(tx("erfassen"), style = st(16f, 500, hex(0x1D1C1D)))
        Spacer(Modifier.weight(1f))
        Text("${Stunden.hmm(e.vorschlag.arbeitsMin)} h", style = st(16f, 700, hex(0x1D1C1D)))
    }
}

// MARK: Hinweis auf der Startseite

/**
 * StundenHinweis: offene Stunden der letzten zwei Wochen als Lime-Leiste. Antippen oeffnet direkt das
 * Erfassen des aeltesten offenen Dienstes. Ohne offene Stunden nichts.
 */
@Composable
internal fun StundenHinweis(stand: Int, modifier: Modifier = Modifier, oeffnen: (Stunden.Eintrag) -> Unit) {
    var liste by remember { mutableStateOf<List<Stunden.Eintrag>>(emptyList()) }
    LaunchedEffect(stand) {
        liste = try { Stunden.verlauf(null, 14).filter { it.offen } } catch (e: kotlinx.coroutines.CancellationException) { throw e } catch (e: Exception) { emptyList() }
    }
    val aeltester = liste.lastOrNull() ?: return
    Row(modifier.height(56.dp).background(LIME).tippen { oeffnen(aeltester) }.padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(
            tx("hinweisStart", mapOf("tage" to liste.take(3).joinToString(", ") { Stunden.tagKurz(it.dienst.datum) })),
            style = st(16f, 500, hex(0x1D1C1D)), maxLines = 1, overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f).padding(end = 12.dp),
        )
        Icon("Arrow_Trisar_Icons_01", Modifier.size(34.dp, 20.dp))
    }
}

// MARK: Erfassen

/** StundenErfassen: Vorschlag ansehen, bestaetigen oder anpassen (mit Begruendung). */
@Composable
internal fun StundenErfassenSeite(eintrag: Stunden.Eintrag, fahrerID: String, schliessen: () -> Unit, fertig: () -> Unit) {
    val v = eintrag.vorschlag
    val datum = eintrag.dienst.datum
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    var anpassen by remember { mutableStateOf(false) }
    var beginn by remember { mutableStateOf(Stunden.uhr(eintrag.zettel?.beginn ?: v.beginn)) }
    var ende by remember { mutableStateOf(Stunden.uhr(eintrag.zettel?.ende ?: v.ende)) }
    var pause by remember { mutableStateOf("${eintrag.zettel?.pauseMin ?: v.pauseMin}") }
    var begruendung by remember { mutableStateOf(eintrag.zettel?.begruendung ?: "") }
    var fehler by remember { mutableStateOf("") }
    var beschaeftigt by remember { mutableStateOf(false) }

    val beginnIso = if (anpassen) Stunden.zuZeitpunkt(datum, beginn) else v.beginn.ifEmpty { null }
    val endeIso = if (anpassen) Stunden.zuZeitpunkt(datum, ende, beginnIso) else v.ende.ifEmpty { null }
    val pauseMin = if (anpassen) maxOf(0, pause.trim().toIntOrNull() ?: 0) else v.pauseMin
    val arbeitsMin = if (beginnIso != null && endeIso != null) maxOf(0, Stunden.minuten(beginnIso, endeIso) - pauseMin) else 0
    val geaendert = anpassen && (Stunden.uhr(beginnIso) != Stunden.uhr(v.beginn) || Stunden.uhr(endeIso) != Stunden.uhr(v.ende) || pauseMin != v.pauseMin)

    fun speichern() {
        if (geaendert && begruendung.isBlank()) { fehler = tx("begruendungFehlt"); return }
        if (beginnIso == null || endeIso == null || beschaeftigt) return
        beschaeftigt = true
        fehler = ""
        scope.launch {
            try {
                Stunden.einreichen(fahrerID, eintrag, beginnIso, endeIso, pauseMin, arbeitsMin, geaendert, begruendung)
                fertig()
            } catch (e: kotlinx.coroutines.CancellationException) {
                throw e
            } catch (e: Exception) {
                val meldung = (e as? io.github.jan.supabase.exceptions.RestException)?.error ?: e.message ?: ""
                fehler = tx("fehler", mapOf("meldung" to meldung))
            } finally {
                beschaeftigt = false
            }
        }
    }

    fun zeitWaehlen(wert: String, setzen: (String) -> Unit) {
        val (h, m) = Regex("^(\\d{1,2}):(\\d{2})$").find(wert)?.destructured?.let { (a, b) -> a.toInt() to b.toInt() } ?: (8 to 0)
        TimePickerDialog(ctx, android.R.style.Theme_Material_Dialog_Alert, { _, hh, mm -> setzen("%02d:%02d".format(hh, mm)) }, h, m, true).show()
    }

    Box(Modifier.fillMaxSize()) {
        StundenRahmen(unten = if (anpassen) 120 else 180) {
            ZurueckKnopf(aktion = schliessen)
            Text(tx("erfassen"), style = grotesk(42f, 700, zeilenHoehe = 42f, abstand = -0.5f, farbe = LIME), modifier = Modifier.padding(top = 30.dp))
            Text(Stunden.tagTitel(datum), style = st(18f, 700, Color.White.copy(alpha = 0.8f)), modifier = Modifier.padding(top = 10.dp))

            // Arbeitszeit gross
            Column(Modifier.padding(top = 20.dp).fillMaxWidth().height(96.dp).background(LIME).padding(horizontal = 16.dp), verticalArrangement = Arrangement.Center) {
                Text("${Stunden.hmm(arbeitsMin)} h", style = st(44f, 700, Color.Black, 46f))
                Text(tx("arbeitszeit") + if (anpassen) "" else " · ${tx("vorschlag")}", style = st(12f, 500, Color.Black.copy(alpha = 0.7f)))
            }

            if (anpassen) {
                Column(Modifier.padding(top = 16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        WaehlEingabe(tx("beginn"), beginn, Modifier.weight(1f)) { zeitWaehlen(beginn) { beginn = it } }
                        WaehlEingabe(tx("ende"), ende, Modifier.weight(1f)) { zeitWaehlen(ende) { ende = it } }
                    }
                    TextEingabe(tx("pauseMin"), pause, { pause = it.filter { c -> c.isDigit() }.take(4) }, KeyboardType.Number)
                    TextEingabe(tx("begruendung"), begruendung, { begruendung = it }, KeyboardType.Text, mehrzeilig = true,
                        farbe = if (geaendert) ORANGE else null)
                }
            } else {
                Column(Modifier.padding(top = 16.dp)) {
                    ZeitZeile(tx("beginn"), Stunden.uhr(v.beginn))
                    ZeitZeile(tx("ende"), Stunden.uhr(v.ende))
                    ZeitZeile(tx("pause"), tx("minuten", mapOf("n" to "${v.pauseMin}")))
                    v.pausen.forEach { p ->
                        Text("${Stunden.uhr(p.von)} – ${Stunden.uhr(p.bis)}", style = st(12f, 500, Color.White.copy(alpha = 0.45f)), modifier = Modifier.padding(top = 4.dp))
                    }
                }
            }

            // Fahrten des Dienstes
            if (v.fahrten.isNotEmpty()) {
                Text("${tx("fahrten")} · ${v.fahrten.size}", style = st(13f, 700, LIME), modifier = Modifier.padding(top = 22.dp))
                Column(Modifier.padding(top = 8.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    v.fahrten.forEach { f ->
                        Column(Modifier.fillMaxWidth().background(Color.White).padding(horizontal = 16.dp, vertical = 12.dp)) {
                            Text("${Stunden.uhr(f.start)} – ${Stunden.uhr(f.ende)}" + if (f.genau) "" else " · ${tx("geschaetzt")}",
                                style = st(12f, 500, DUNKEL.copy(alpha = 0.7f)))
                            Text(f.gaeste.ifEmpty { "${f.von} → ${f.nach}" }, style = st(16f, 700, DUNKEL), maxLines = 1, overflow = TextOverflow.Ellipsis)
                            if (f.gaeste.isNotEmpty()) {
                                Text("${f.von} → ${f.nach}", style = st(12f, 500, DUNKEL.copy(alpha = 0.7f)), maxLines = 1, overflow = TextOverflow.Ellipsis)
                            }
                        }
                    }
                }
            }
            if (fehler.isNotEmpty()) Text(fehler, style = st(13f, 500, ORANGE), modifier = Modifier.padding(top = 14.dp))
        }

        // Knoepfe fest unten mit Verlauf dahinter.
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.BottomCenter) {
            Column(
                Modifier.fillMaxWidth().background(Brush.verticalGradient(0f to Color.Transparent, 0.35f to Color.Black, 1f to Color.Black))
                    .navigationBarsPadding().padding(start = 20.dp, end = 20.dp, top = 20.dp, bottom = 16.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                val aus = beschaeftigt || arbeitsMin == 0
                Row(
                    Modifier.fillMaxWidth().height(56.dp).alpha(if (aus) 0.4f else 1f).background(LIME).tippen { if (!aus) speichern() }.padding(horizontal = 16.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(if (anpassen) tx("einreichen") else tx("stimmt"), style = st(16f, 500, hex(0x1D1C1D)))
                    Spacer(Modifier.weight(1f))
                    Icon("Arrow_Trisar_Icons_01", Modifier.size(34.dp, 20.dp))
                }
                if (!anpassen) {
                    Box(Modifier.fillMaxWidth().height(48.dp).border(2.dp, LIME).tippen { anpassen = true }.padding(horizontal = 16.dp),
                        contentAlignment = Alignment.CenterStart) { Text(tx("anpassen"), style = st(15f, 500, LIME)) }
                }
            }
        }
    }
}

@Composable
private fun ZeitZeile(label: String, wert: String) {
    Column {
        Row(Modifier.fillMaxWidth().height(44.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(label, style = st(14f, 500, Color.White.copy(alpha = 0.6f)))
            Spacer(Modifier.weight(1f))
            Text(wert, style = st(20f, 700, Color.White))
        }
        Box(Modifier.fillMaxWidth().height(1.dp).background(Color.White.copy(alpha = 0.1f)))
    }
}

@Composable
private fun WaehlEingabe(label: String, wert: String, modifier: Modifier, oeffnen: () -> Unit) {
    Column(modifier, verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(label, style = st(11f, 500, Color.White.copy(alpha = 0.5f)))
        Box(Modifier.fillMaxWidth().height(44.dp).background(Color.Black).border(1.dp, Color.White.copy(alpha = 0.3f)).tippen(oeffnen).padding(horizontal = 12.dp),
            contentAlignment = Alignment.CenterStart) { Text(wert, style = st(18f, 700, Color.White)) }
    }
}

@Composable
private fun TextEingabe(label: String, wert: String, aendern: (String) -> Unit, tastatur: KeyboardType, mehrzeilig: Boolean = false, farbe: Color? = null) {
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(label, style = st(11f, 500, farbe ?: Color.White.copy(alpha = 0.5f)))
        BasicTextField(
            value = wert,
            onValueChange = aendern,
            singleLine = !mehrzeilig,
            minLines = if (mehrzeilig) 3 else 1,
            textStyle = st(if (mehrzeilig) 15f else 18f, if (mehrzeilig) 500 else 700, Color.White),
            cursorBrush = SolidColor(LIME),
            keyboardOptions = KeyboardOptions(keyboardType = tastatur),
            modifier = Modifier.fillMaxWidth().heightIn(min = 44.dp).background(Color.Black).border(1.dp, farbe ?: Color.White.copy(alpha = 0.3f))
                .padding(horizontal = 12.dp, vertical = 10.dp),
        )
    }
}
