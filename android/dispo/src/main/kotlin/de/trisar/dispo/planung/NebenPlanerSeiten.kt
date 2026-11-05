package de.trisar.dispo.planung

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.RectangleShape
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import de.trisar.kern.Icon
import de.trisar.kern.grotesk
import de.trisar.kern.hex
import de.trisar.kern.tippen
import kotlinx.coroutines.delay
import java.text.NumberFormat
import java.util.Locale
import kotlin.math.floor

// Planer-Unterseiten (EreignisseAnsicht.swift, PufferAnsicht.swift, NeuplanungAnsicht.swift). Im Betrieb liegen
// keine Risikodaten vor (nur die Demo hat sie), darum zeigen Puffer und Neuplanung live nur den Hinweis.

private typealias RFS = NebenRisikoFarbe

// MARK: - Ereignisse

/**
 * Ereignisse eines Einsatztages (EreignisseView.jsx): was die Engine automatisch eingerechnet hat (mit Quelle)
 * und was die Disposition ergaenzt, anpasst oder entfernt. Eigene Aenderungen rechnet die App nicht neu.
 */
@Composable
internal fun EreignisseAnsicht(tagIso: String, zurueck: () -> Unit) {
    val speicher = NebenRisikoSpeicher
    val liste = speicher.ereignisse(tagIso)
    val entfernt = speicher.entfernte(tagIso)
    val auto = liste.count { it.quelleArt == "auto" }
    val eigene = liste.size - auto
    var zeitWahl by remember { mutableStateOf<Pair<String, (String) -> Unit>?>(null) }

    Box(Modifier.fillMaxSize()) {
        NebenPlanerSeite(
            "Ereignisse",
            "${NebenRisiko.datumText(tagIso)} · $auto automatisch gefunden${if (eigene > 0) " · $eigene von dir" else ""}",
            zurueck,
        ) {
            Column(Modifier.padding(top = 22.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                for (e in liste) {
                    androidx.compose.runtime.key(e.schluessel) { EreignisKarte(e, tagIso) { w, setzen -> zeitWahl = w to setzen } }
                }
                if (liste.isEmpty()) PAbsatz("Für diesen Tag sind keine Ereignisse eingetragen.", 14f, 400, 18f, RFS.lime)
            }
            if (entfernt.isNotEmpty()) {
                Column(Modifier.padding(top = 14.dp)) {
                    for (e in entfernt) {
                        Row(Modifier.height(18.dp), verticalAlignment = Alignment.CenterVertically) {
                            PText("Entfernt: ${e.titel} · ", 12f, 400, hex(0xE3F654, 0.7f))
                            Text(
                                "wiederherstellen", style = grotesk(12f, farbe = hex(0xE3F654, 0.7f)).copy(textDecoration = TextDecoration.Underline),
                                modifier = Modifier.tippen { speicher.wiederherstellen(tagIso, e.id) },
                            )
                        }
                    }
                }
            }
            Box(Modifier.padding(top = 18.dp)) { EreignisErgaenzen(tagIso) }
            PAbsatz(
                "Eintippen, was passiert und wann. Die Demo zeigt den Plan der Engine ohne eigene Änderungen.",
                11f, 400, 15f, hex(0xE3F654, 0.5f), modifier = Modifier.padding(top = 10.dp).width(362.dp), ausrichtung = TextAlign.Center,
            )
        }
        zeitWahl?.let { (wert, setzen) -> ZeitBlatt(wert, { if (it.isNotEmpty()) setzen(it) }) { zeitWahl = null } }
    }
}

private fun plusMin(wirkung: String): Int? = NebenRisiko.treffer("""\+(\d+)\s*min""", wirkung).firstOrNull()?.toIntOrNull()

@Composable
private fun EreignisKarte(e: NebenEreignis, iso: String, zeitWaehlen: (String, (String) -> Unit) -> Unit) {
    var bearbeiten by remember { mutableStateOf(false) }
    var von by remember { mutableStateOf(e.von ?: "") }
    var bis by remember { mutableStateOf(e.bis ?: "") }
    var zusatz by remember { mutableStateOf(plusMin(e.wirkung)?.toString() ?: "") }
    val eigen = e.quelleArt == "eigen"
    val d = RFS.dunkel

    fun speichern() {
        var w = NebenEreignisWerte()
        // Zeit nur ersetzen, wenn sie geaendert wurde (sonst blieben zwei Fenster nicht erhalten).
        if (von.isNotEmpty() && bis.isNotEmpty() && (von != (e.von ?: "") || bis != (e.bis ?: ""))) {
            w = w.copy(von = von, bis = bis, zeit = "$von–$bis")
        }
        val alt = plusMin(e.wirkung)
        val neu = zusatz.trim().toIntOrNull()
        if (alt != null && neu != null && neu != alt) w = w.copy(wirkung = e.wirkung.replace(Regex("""\+\d+\s*min"""), "+$neu min"))
        if (w != NebenEreignisWerte()) NebenRisikoSpeicher.aendern(iso, e.id, w)
        bearbeiten = false
    }

    Column(
        Modifier.fillMaxWidth().background(hex(0xFEFFFE)).border(2.dp, if (bearbeiten) RFS.lime else Color.Transparent, RectangleShape)
            .padding(horizontal = 16.dp, vertical = 14.dp)
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            PText(
                if (eigen) "von dir" else if (e.angepasst) "automatisch · angepasst" else "automatisch", 11f, 700, d,
                modifier = Modifier.background(if (eigen) RFS.lime else hex(0xE9E9E9)).padding(horizontal = 6.dp, vertical = 2.dp),
            )
            Spacer(Modifier.weight(1f))
            e.fahrten?.let { n -> PText("$n ${if (n == 1) "Fahrt" else "Fahrten"}", 12f, 700, d) }
        }
        PAbsatz(e.titel, 18f, 700, 22f, d, -0.3f, Modifier.padding(top = 8.dp))
        if (!e.zusatz.isNullOrEmpty()) PAbsatz(e.zusatz, 12f, 400, 16f, d.copy(alpha = 0.6f))
        Column(Modifier.padding(top = 8.dp), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            for ((label, wert) in listOf("Zeit" to e.zeit, "Wirkung" to e.wirkung, "Quelle" to e.quelle)) {
                Row {
                    Box(Modifier.width(64.dp)) { PText(label, 12f, 400, d.copy(alpha = 0.55f)) }
                    Spacer(Modifier.width(8.dp))
                    PAbsatz(wert, 12f, 500, 16f, d)
                }
            }
        }
        if (bearbeiten) {
            Column(Modifier.padding(top = 10.dp).fillMaxWidth().background(hex(0xF3F3F3)).padding(horizontal = 12.dp, vertical = 10.dp)) {
                PText("Wird angepasst", 11f, 400, d.copy(alpha = 0.6f), modifier = Modifier.padding(bottom = 6.dp))
                Row(Modifier.height(32.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Box(Modifier.width(40.dp)) { PText("Zeit", 13f, 400, d.copy(alpha = 0.55f)) }
                    ZeitKnopf(von) { zeitWaehlen(von) { von = it } }
                    PText("–", 13f, 400, d.copy(alpha = 0.4f))
                    ZeitKnopf(bis) { zeitWaehlen(bis) { bis = it } }
                }
                if (plusMin(e.wirkung) != null) {
                    Row(Modifier.height(32.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Box(Modifier.width(40.dp)) { PText("bis +", 13f, 400, d.copy(alpha = 0.55f)) }
                        BasicTextField(
                            zusatz,
                            { neu ->
                                // min 0, max 120 wie das Zahlenfeld im Web
                                val ziffern = neu.filter { it.isDigit() }
                                zusatz = if ((ziffern.toIntOrNull() ?: 0) > 120) "120" else ziffern
                            },
                            textStyle = grotesk(13f, farbe = d),
                            singleLine = true,
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                            modifier = Modifier.size(64.dp, 28.dp).background(Color.White).border(1.dp, hex(0xD9D9D9), RectangleShape).padding(horizontal = 6.dp, vertical = 5.dp),
                        )
                        PText("min", 13f, 400, d)
                    }
                }
            }
        }
        Row(Modifier.padding(top = 12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            if (bearbeiten) {
                KartenKnopf("Speichern", "voll", ::speichern)
                KartenKnopf("Abbrechen", "grau") { bearbeiten = false }
            } else {
                KartenKnopf("Anpassen", "rand") { bearbeiten = true }
                KartenKnopf("Entfernen", "rot") { NebenRisikoSpeicher.entfernen(iso, e.id) }
            }
        }
    }
}

@Composable
private fun ZeitKnopf(wert: String, oeffnen: () -> Unit) {
    Box(
        Modifier.height(28.dp).background(hex(0xE4E4E6), RoundedCornerShape(6.dp)).tippen(oeffnen).padding(horizontal = 10.dp),
        contentAlignment = Alignment.Center,
    ) { PText(wert.ifEmpty { "--:--" }, 14f, 500, RFS.dunkel) }
}

@Composable
private fun RowScope.KartenKnopf(text: String, art: String, aktion: () -> Unit) {
    val (rand, farbe, grund) = when (art) {
        "rand" -> Triple(RFS.dunkel, RFS.dunkel, Color.Transparent)
        "rot" -> Triple(RFS.rot, RFS.rot, Color.Transparent)
        "voll" -> Triple(RFS.lime, Color.Black, RFS.lime)
        else -> Triple(hex(0xC9C9C9), hex(0x888888), Color.Transparent)
    }
    Box(
        Modifier.weight(1f).height(36.dp).background(grund).border(2.dp, rand, RectangleShape).tippen(aktion),
        contentAlignment = Alignment.Center,
    ) { PText(text, 13f, 500, farbe) }
}

@Composable
private fun EreignisErgaenzen(iso: String) {
    var offen by remember { mutableStateOf(false) }
    var text by remember { mutableStateOf("") }
    var entwurf by remember { mutableStateOf<NebenEreignis?>(null) }
    var fehler by remember { mutableStateOf("") }
    val fokus = remember { FocusRequester() }

    fun senden() {
        val e = NebenRisiko.ereignisAusText(text)
        if (e == null) { fehler = "Beschreibe kurz, was passiert und wann."; return }
        fehler = ""
        entwurf = e
    }

    if (!offen) {
        NebenPlanenKnopf("Ereignis ergänzen") { offen = true }
        return
    }
    LaunchedEffect(Unit) { delay(100); runCatching { fokus.requestFocus() } }
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically) {
            Icon("Planen_Sparkle_Lime", Modifier.size(14.dp))
            Spacer(Modifier.width(8.dp))
            PText("Ereignis ergänzen", 10f, 700, RFS.lime)
        }
        val e = entwurf
        if (e != null) {
            Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.CenterEnd) {
                PAbsatz(
                    e.text ?: "", 16f, 500, 20f, Color.Black,
                    modifier = Modifier.width(314.dp).background(RFS.lime, RoundedCornerShape(16.dp, 16.dp, 6.dp, 16.dp))
                        .padding(start = 12.dp, end = 12.dp, top = 12.dp, bottom = 8.dp),
                )
            }
            Column(
                Modifier.width(314.dp).background(hex(0x242525), RoundedCornerShape(16.dp, 16.dp, 16.dp, 6.dp))
                    .border(1.dp, hex(0x3A3A3A), RoundedCornerShape(16.dp, 16.dp, 16.dp, 6.dp)).padding(12.dp)
            ) {
                Column(Modifier.fillMaxWidth().background(hex(0xFEFFFE)).padding(horizontal = 14.dp, vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    PText(e.kachelWerte.name, 13f, 400, RFS.dunkel)
                    Box(Modifier.height(36.dp), contentAlignment = Alignment.CenterStart) { PText(e.kachelWerte.gross, 32f, 700, RFS.dunkel, -0.5f) }
                    PText(e.titel, 12f, 400, RFS.dunkel)
                }
                PAbsatz(
                    "Die Demo rechnet eigene Ereignisse nicht neu. In der App fließen sie in die nächste Planung ein.",
                    12f, 400, 16f, Color.White.copy(alpha = 0.7f), modifier = Modifier.padding(top = 10.dp),
                )
                Row(Modifier.padding(top = 10.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Box(
                        Modifier.weight(1f).height(36.dp).background(RFS.lime).tippen {
                            NebenRisikoSpeicher.hinzufuegen(iso, e)
                            entwurf = null; text = ""; offen = false
                        },
                        contentAlignment = Alignment.Center,
                    ) { PText("Übernehmen", 13f, 700, Color.Black) }
                    Box(
                        Modifier.weight(1f).height(36.dp).border(1.dp, hex(0x5A5A5A), RectangleShape).tippen { entwurf = null },
                        contentAlignment = Alignment.Center,
                    ) { PText("Verwerfen", 13f, 500, Color.White) }
                }
            }
        } else {
            Row(
                Modifier.fillMaxWidth().height(56.dp).border(2.dp, RFS.lime, RectangleShape).padding(start = 18.dp, end = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Box(Modifier.weight(1f), contentAlignment = Alignment.CenterStart) {
                    if (text.isEmpty()) PText("Ludwigstraße 14 bis 18 Uhr gesperrt", 16f, 400, hex(0x8F9A3A))
                    BasicTextField(
                        text, { text = it; fehler = "" },
                        textStyle = grotesk(16f, farbe = Color.White), singleLine = true, cursorBrush = SolidColor(RFS.lime),
                        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send),
                        keyboardActions = KeyboardActions(onSend = { senden() }),
                        modifier = Modifier.fillMaxWidth().focusRequester(fokus),
                    )
                }
                Spacer(Modifier.width(10.dp))
                Icon("weiter_gross", Modifier.size(34.dp, 21.dp).rotate(180f).tippen(::senden), skalierung = ContentScale.FillBounds)
            }
        }
        if (fehler.isNotEmpty()) PText(fehler, 13f, 400, RFS.rot)
    }
}

// MARK: - Puffer

/** Nicht auf 100 aufrunden, solange noch einzelne Abholungen zu spaet sind. */
private fun prozent(x: Double): String {
    if (x >= 1) return "100"
    val f = NumberFormat.getNumberInstance(Locale.GERMANY)
    f.maximumFractionDigits = 2
    return f.format(floor(x * 10000) / 100)
}

/**
 * Detailseite zum Dash "Puffer je Fahrt" (PufferView.jsx): wie viel Luft die Engine je Fahrt freihaelt,
 * wie knapp es ueber den Tag wird und welche Fahrten das hoechste Risiko tragen.
 */
@Composable
internal fun PufferAnsicht(tagIso: String, option: String = "standard", optionTitel: String = "Standard", zurueck: () -> Unit) {
    val o = NebenRisikoSpeicher.option(tagIso, option)
    NebenPlanerSeite("Puffer je Fahrt", "${NebenRisiko.datumText(tagIso)} · $optionTitel", zurueck) {
        if (o != null) PufferInhalt(tagIso, o)
        else PAbsatz("Für diesen Tag liegt keine Rechnung der Engine vor.", 14f, 400, 18f, RFS.lime, modifier = Modifier.padding(top = 24.dp))
    }
}

@Composable
private fun PufferInhalt(tagIso: String, o: NebenRisikoOption) {
    var alle by remember { mutableStateOf(false) }
    var stunde by remember { mutableStateOf<Int?>(null) }
    val ereignisse = NebenRisikoSpeicher.ereignisse(tagIso)
    val verlaeufe = NebenRisikoSpeicher.tag(tagIso)?.verlaeufe ?: 500
    val gesamt = o.fahrten.size
    val hoch = o.hoch.mapNotNull { id -> o.fahrten[id]?.let { id to it } }
    val gewaehlt = (o.faecher ?: emptyList()).firstOrNull { it.h == stunde && (it.n ?: 0) > 0 }
    val lime = RFS.lime

    Row(Modifier.padding(top = 24.dp).height(IntrinsicSize.Min), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        PufferKachel("Puffer Ø", "${RFS.zahl(o.puffer_mittel)} min", "bisher mind. $NEBEN_BISHER_PUFFER_MIN min, plus Wartezeit", lime)
        PufferKachel("Hohes Risiko", "${o.hoch.size}", "von $gesamt Fahrten", if (o.hoch.isEmpty()) lime else RFS.rot)
    }

    Column(Modifier.padding(top = 12.dp).fillMaxWidth().border(2.dp, lime, RectangleShape).padding(horizontal = 16.dp, vertical = 14.dp)) {
        Row(verticalAlignment = Alignment.Bottom) {
            PText("Wie knapp wird es?", 16f, 700, lime)
            Spacer(Modifier.weight(1f))
            PText("$verlaeufe Verläufe des Tages", 11f, 400, lime.copy(alpha = 0.75f))
        }
        Box(Modifier.padding(top = 10.dp)) { LuftFaecher(o.faecher ?: emptyList(), stunde, { stunde = it }) }
        Row(Modifier.padding(top = 6.dp), horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
            Row(verticalAlignment = Alignment.CenterVertically) { Box(Modifier.size(14.dp, 2.dp).background(Color.White)); Spacer(Modifier.width(4.dp)); PText("Median", 11f, 400, lime) }
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(34.dp, 9.dp).background(Brush.horizontalGradient(listOf(lime.copy(alpha = 0.08f), lime.copy(alpha = 0.75f), lime.copy(alpha = 0.08f)))))
                Spacer(Modifier.width(4.dp)); PText("90-%-Bereich", 11f, 400, lime)
            }
            Row(verticalAlignment = Alignment.CenterVertically) { Box(Modifier.size(14.dp, 9.dp).background(RFS.rot.copy(alpha = 0.7f))); Spacer(Modifier.width(4.dp)); PText("zu spät", 11f, 400, lime) }
        }
        val info = if (gewaehlt != null) buildAnnotatedString {
            withStyle(SpanStyle(fontWeight = FontWeight(700))) { append("${gewaehlt.h}–${gewaehlt.h + 1} Uhr") }
            val spaet = gewaehlt.spaet ?: 0.0
            append(" · ${RFS.zahl(gewaehlt.p50)} min Luft · ${if (spaet >= 0.01) "${rund(spaet * 100).toInt()} % zu spät" else "pünktlich"}")
        } else buildAnnotatedString { append("Tippe auf eine Stunde.") }
        Text(info, style = grotesk(12f, zeilenHoehe = 16f, farbe = Color.White.copy(alpha = 0.85f)), modifier = Modifier.padding(top = 8.dp))
        o.knappste_stunde?.let { knapp ->
            val t = buildAnnotatedString {
                append("Am knappsten "); withStyle(SpanStyle(fontWeight = FontWeight(700))) { append("$knapp–${knapp + 1} Uhr") }; append(".")
                o.puenktlich_abholung?.let { p ->
                    append(" Mit Nachsteuern "); withStyle(SpanStyle(fontWeight = FontWeight(700))) { append("${prozent(p)} %") }; append(" pünktlich abgeholt.")
                }
            }
            Text(t, style = grotesk(13f, farbe = Color.White), modifier = Modifier.padding(top = 8.dp))
        }
    }

    Column(Modifier.padding(top = 12.dp).fillMaxWidth().border(2.dp, lime, RectangleShape).padding(horizontal = 16.dp, vertical = 14.dp)) {
        PufferStreuung(o.fahrten, ereignisse)
        val leg = buildAnnotatedString {
            withStyle(SpanStyle(color = RFS.gruen)) { append("●") }; append(" niedrig   ● mittel   ")
            withStyle(SpanStyle(color = RFS.rot)) { append("●") }; append(" hoch   ")
            withStyle(SpanStyle(color = Color.White)) { append("- - bisher mind. $NEBEN_BISHER_PUFFER_MIN min") }
        }
        Text(leg, style = grotesk(11f, farbe = lime), modifier = Modifier.padding(top = 6.dp))
        PAbsatz(
            "Jeder Punkt ist ein Anschluss. ${o.unter_bisher ?: 0} haben weniger als $NEBEN_BISHER_PUFFER_MIN min, ${o.ueber_bisher ?: 0} mehr.",
            13f, 400, 17f, Color.White, modifier = Modifier.padding(top = 8.dp),
        )
    }

    if (hoch.isNotEmpty()) {
        Column(Modifier.padding(top = 12.dp).fillMaxWidth().background(hex(0xFEFFFE)).padding(start = 18.dp, end = 18.dp, top = 16.dp, bottom = 8.dp)) {
            PText("Hohes Risiko", 16f, 700, RFS.dunkel)
            for ((id, f) in if (alle) hoch else hoch.take(3)) {
                androidx.compose.runtime.key(id) {
                    Column(Modifier.padding(top = 8.dp).fillMaxWidth().background(hex(0xD9D9D9)).padding(top = 1.dp).background(hex(0xFEFFFE)).padding(vertical = 9.dp)) {
                        Row {
                            Column(Modifier.weight(1f)) {
                                val t = buildAnnotatedString {
                                    withStyle(SpanStyle(fontWeight = FontWeight(700))) { append(f.abfahrt ?: "") }
                                    append(" ${f.von ?: ""} – ${f.nach ?: ""}")
                                }
                                Text(t, style = grotesk(13f, zeilenHoehe = 17f, farbe = RFS.dunkel))
                                PAbsatz(
                                    NebenRisiko.grund(f) + (f.luft?.let { " · Puffer ${RFS.zahl(it.puffer)} min" } ?: " · letzte Fahrt im Dienst"),
                                    11f, 400, 14f, RFS.dunkel.copy(alpha = 0.6f),
                                )
                            }
                            Spacer(Modifier.width(10.dp))
                            PText("hoch", 11f, 700, RFS.dunkel, modifier = Modifier.background(RFS.rot).padding(horizontal = 6.dp, vertical = 2.dp))
                        }
                    }
                }
            }
            if (hoch.size > 3) {
                Text(
                    if (alle) "Weniger anzeigen" else "Alle ${hoch.size} ansehen",
                    style = grotesk(13f, farbe = RFS.dunkel).copy(textDecoration = TextDecoration.Underline),
                    modifier = Modifier.padding(vertical = 8.dp).tippen { alle = !alle },
                )
            }
        }
    }

    PAbsatz(
        "$verlaeufe Verläufe des Tages. Puffer = Zeit, die die Engine zwischen zwei Fahrten über die normale Fahrzeit hinaus freihält. Flug- und Zugverspätung nach Pünktlichkeitsstatistik 2025, Spieltagsfaktoren angenommen. Keine Messwerte.",
        10f, 400, 14f, hex(0xE3F654, 0.6f), modifier = Modifier.padding(top = 10.dp).width(362.dp),
    )
}

@Composable
private fun RowScope.PufferKachel(label: String, wert: String, unter: String, farbe: Color) {
    Column(
        Modifier.weight(1f).fillMaxHeight().border(2.dp, farbe, RectangleShape).padding(horizontal = 16.dp, vertical = 14.dp),
        verticalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        PText(label, 13f, 400, farbe)
        Box(Modifier.height(36.dp), contentAlignment = Alignment.CenterStart) { PText(wert, 32f, 700, farbe, -0.5f) }
        PAbsatz(unter, 12f, 400, 15f, farbe)
    }
}

// MARK: - Neuplanung

/** `tag.stoerung` aus der Engine-Antwort (engine-ergebnisse.json, stoerung_neu.py). */
internal data class NebenStoerung(
    val ereignisName: String, val meldung: String?, val spaeteAbholungen: Map<String, Double>?, val ohneAnzahl: Int?,
    val mitAnzahl: Int?, val aenderungen: List<Aenderung>, val spaetereAnkunft: Map<String, Double>?,
) {
    data class Aenderung(val rideIds: List<String>, val abfahrt: String, val von: String, val alterFahrer: String?, val neuerFahrer: String, val reservefahrzeug: Boolean?)
}

/** `tag.bisheriger_planer` (nur wenn `passend` nicht false ist). */
internal data class NebenBisherPlaner(val stoerungSpaet: Map<String, Double>?, val normalSpaet: Map<String, Double>?)

/** Was die Karte zu einer Fahrt braucht (im Web aus demoStore.jobs). */
internal data class NebenNeuplanungFahrt(val namen: List<String> = emptyList(), val anzahl: Int = 1, val abholung: String = "", val ziel: String = "")

/**
 * Neuplanung am Einsatztag (NeuplanungView.jsx): Der Tag ist vorab geplant und angenommen, dann kommt eine Stoerung.
 * Die Seite zeigt nur die Aenderungen der Neuplanung, die Disposition uebernimmt oder lehnt sie ab. Live gibt es keine
 * Stoerungsdaten, die Seite zeigt dann den Hinweis.
 */
@Composable
internal fun NeuplanungAnsicht(
    tagIso: String, stoerung: NebenStoerung?, bisher: NebenBisherPlaner? = null, status: String? = null, fehler: String? = null,
    laeuft: Boolean = false, fahrten: Map<String, NebenNeuplanungFahrt> = emptyMap(),
    uebernehmen: () -> Unit, ablehnen: () -> Unit, zurueck: () -> Unit,
) {
    NebenPlanerSeite("Neuplanung", "${NebenRisiko.datumText(tagIso)} · Meldung ${stoerung?.meldung ?: ""} Uhr", zurueck) {
        if (stoerung == null) {
            PAbsatz("Für diesen Tag liegt keine Störung vor.", 14f, 400, 18f, RFS.lime, modifier = Modifier.padding(top = 24.dp))
            return@NebenPlanerSeite
        }
        val spaet = stoerung.spaeteAbholungen ?: emptyMap()
        // Erst die Fahrten, die ohne Eingriff zu spaet waeren, dann die Folgetausche.
        val aenderungen = stoerung.aenderungen.withIndex().sortedWith(compareBy(
            { if (it.value.rideIds.any { id -> spaet.containsKey(id) }) 0 else 1 }, { it.value.abfahrt }, { it.index },
        )).map { it.value }
        val stau = (stoerung.spaetereAnkunft ?: emptyMap()).size
        val ohneAnzahl = stoerung.ohneAnzahl ?: 0

        Column(Modifier.padding(top = 24.dp).fillMaxWidth().border(1.dp, RFS.rot, RectangleShape).padding(horizontal = 14.dp, vertical = 12.dp)) {
            PText(stoerung.ereignisName.split(" (").first(), 13f, 700, RFS.rot)
            Row(Modifier.padding(top = 10.dp).height(IntrinsicSize.Min), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Vergleich("Bisheriger Planer", bisher?.stoerungSpaet?.size, bisher?.normalSpaet?.let { "ohne Unfall ${it.size}" } ?: "nicht gerechnet")
                Vergleich("TRISAR ohne Eingriff", ohneAnzahl, if (ohneAnzahl > 0) "bis ${RFS.zahl(spaet.values.maxOrNull())} min" else "Reserve hält")
                Vergleich("nach Neuplanung", stoerung.mitAnzahl ?: 0, "${stoerung.aenderungen.size} Fahrten neu")
            }
            if (stau > 0) {
                PAbsatz("$stau Gäste stehen selbst im Stau. Sie und das Ziel werden automatisch informiert.", 12f, 400, 17f, Color.White.copy(alpha = 0.7f), modifier = Modifier.padding(top = 8.dp))
            }
        }
        PText("Vorgeschlagene Änderungen (${aenderungen.size})", 13f, 700, RFS.lime, modifier = Modifier.padding(top = 24.dp))
        Column(Modifier.padding(top = 10.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            for (a in aenderungen) NeuplanungKarte(a, spaet, fahrten)
        }
        if (!fehler.isNullOrEmpty()) PAbsatz(fehler, 12f, 400, 16f, RFS.rot, modifier = Modifier.padding(top = 12.dp))
        if (status != null) {
            val uebernommen = status == "uebernommen"
            Box(
                Modifier.padding(top = 20.dp).fillMaxWidth().height(51.dp).background(if (uebernommen) RFS.lime else Color.Transparent)
                    .border(2.dp, if (uebernommen) Color.Transparent else RFS.rot, RectangleShape),
                contentAlignment = Alignment.Center,
            ) { PText(if (uebernommen) "Übernommen, Fahrer informiert" else "Abgelehnt", 22f, 700, if (uebernommen) Color.Black else RFS.rot, -0.5f) }
        } else {
            Row(Modifier.padding(top = 20.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Box(Modifier.weight(1f).height(51.dp).border(2.dp, RFS.rot, RectangleShape).tippen { if (!laeuft) ablehnen() }, contentAlignment = Alignment.Center) {
                    PText("Ablehnen", 24f, 700, RFS.rot, -0.5f)
                }
                Box(Modifier.weight(1f).height(51.dp).alpha(if (laeuft) 0.5f else 1f).background(RFS.lime).tippen { if (!laeuft) uebernehmen() }, contentAlignment = Alignment.Center) {
                    PText("Übernehmen", 24f, 700, Color.Black, -0.5f)
                }
            }
        }
    }
}

@Composable
private fun RowScope.Vergleich(titel: String, n: Int?, unter: String) {
    Column(Modifier.weight(1f).fillMaxHeight().background(hex(0x2A2A2B)).padding(8.dp)) {
        PAbsatz(titel, 10f, 400, 13f, Color.White.copy(alpha = 0.7f))
        PText(n?.let { "$it zu spät" } ?: "–", 15f, 700, if ((n ?: 0) > 0) RFS.rot else RFS.gruen)
        PAbsatz(unter, 10f, 400, 13f, Color.White.copy(alpha = 0.7f))
    }
}

@Composable
private fun NeuplanungKarte(a: NebenStoerung.Aenderung, spaet: Map<String, Double>, fahrten: Map<String, NebenNeuplanungFahrt>) {
    val fahrt = a.rideIds.firstOrNull()?.let { fahrten[it] }
    val min = a.rideIds.firstNotNullOfOrNull { spaet[it] }
    val teile = a.von.split(" → ")
    fun ort(name: String) = name.split(",").first()
    val ab = ort(fahrt?.abholung ?: "")
    val zu = ort(fahrt?.ziel ?: "")
    val gaeste = if (fahrt != null && fahrt.namen.isNotEmpty()) fahrt.namen.joinToString(", ") else {
        val n = maxOf(1, fahrt?.anzahl ?: 1); if (n == 1) "1 Gast" else "$n Gäste"
    }
    val d = RFS.dunkel
    Column(Modifier.fillMaxWidth().background(hex(0xFEFFFE)).border(4.dp, RFS.lime, RectangleShape).padding(horizontal = 18.dp, vertical = 14.dp)) {
        Row {
            PAbsatz(gaeste, 20f, 700, 24f, d, modifier = Modifier.weight(1f))
            Spacer(Modifier.width(10.dp))
            PText(a.abfahrt, 15f, 700, d)
        }
        PAbsatz(
            "${ab.ifEmpty { teile.firstOrNull() ?: "" }} → ${zu.ifEmpty { if (teile.size > 1) teile[1] else "" }}",
            12f, 400, 16f, d.copy(alpha = 0.8f), modifier = Modifier.padding(top = 4.dp),
        )
        val wechsel = buildAnnotatedString {
            withStyle(SpanStyle(color = d.copy(alpha = 0.5f), textDecoration = TextDecoration.LineThrough)) { append(a.alterFahrer ?: "–") }
            withStyle(SpanStyle(fontWeight = FontWeight(700))) { append("  →  ${a.neuerFahrer}${if (a.reservefahrzeug == true) " · Bereitschaft" else ""}") }
        }
        Text(wechsel, style = grotesk(14f, zeilenHoehe = 18f, farbe = d), modifier = Modifier.padding(top = 8.dp))
        val folge = if (min != null) buildAnnotatedString {
            withStyle(SpanStyle(fontWeight = FontWeight(700), color = RFS.rot)) { append("wäre ${RFS.zahl(min)} min zu spät") }
            append(", jetzt pünktlich")
        } else buildAnnotatedString { withStyle(SpanStyle(color = d.copy(alpha = 0.7f))) { append("Folge des Tauschs, bleibt pünktlich") } }
        Text(folge, style = grotesk(12f, zeilenHoehe = 16f, farbe = d), modifier = Modifier.padding(top = 6.dp))
    }
}
