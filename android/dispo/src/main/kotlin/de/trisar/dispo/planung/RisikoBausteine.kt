package de.trisar.dispo.planung

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.RectangleShape
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.clipRect
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextMeasurer
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import de.trisar.kern.Icon
import de.trisar.kern.grotesk
import de.trisar.kern.hex
import de.trisar.kern.tippen
import kotlin.math.abs
import kotlin.math.ceil
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min

// Bausteine fuer "Risiko je Fahrt" (RisikoBausteine.swift, RisikoBausteine.jsx): Ereignis-Kacheln, Dash,
// Sicherheitsband, Faecher, Streudiagramm und Fahrzeit-Verteilung. Die SVGs sind als Canvas nachgezeichnet.

private typealias RF = NebenRisikoFarbe

/** SVG-Text: y ist die Grundlinie (Masse im Raster, Canvas in px). */
private fun DrawScope.svgText(m: TextMeasurer, text: String, x: Float, y: Float, farbe: Color, groesse: Float = 10f, ankerX: Float = 0f, deckung: Float = 1f) {
    leinwandText(m, text, x * density, (y - groesse * 0.35f) * density, grotesk(groesse, farbe = farbe.copy(alpha = farbe.alpha * deckung)), ankerX, 0.5f)
}

// MARK: - Ereignis-Kacheln

@Composable
internal fun EreignisKacheln(ereignisse: List<NebenEreignis>, klein: Boolean = false, oeffnen: ((NebenEreignis) -> Unit)? = null) {
    if (ereignisse.isEmpty()) return
    val breite = if (klein) 130f else 150f
    val hoehe = if (klein) 98f else 132f
    Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        for (e in ereignisse) {
            val eigen = e.quelleArt == "eigen"
            val k = e.kachelWerte
            val farbe = if (eigen) RF.dunkel else RF.lime
            Column(
                Modifier.size(breite.dp, hoehe.dp).background(if (eigen) hex(0xFEFFFE) else Color.Transparent)
                    .border(2.dp, if (eigen) hex(0xFEFFFE) else RF.lime, RectangleShape).tippen { oeffnen?.invoke(e) }
                    .padding(vertical = (if (klein) 10 else 14).dp, horizontal = (if (klein) 12 else 16).dp)
            ) {
                Text(k.name + if (eigen) " · von dir" else "", style = grotesk(if (klein) 11f else 13f, farbe = farbe), maxLines = 2)
                Spacer(Modifier.weight(1f))
                PText(k.gross, (if (klein) 24f else 32f) * (if (k.gross.length > 6) 0.75f else 1f), 700, farbe, -0.5f)
                Spacer(Modifier.weight(1f))
                Text(k.klein, style = grotesk(if (klein) 11f else 12f, farbe = farbe), maxLines = 2)
            }
        }
    }
}

// MARK: - Sicherheitsband: ein Feld je Stunde

@Composable
internal fun SicherheitsBand(verlauf: List<NebenStundenLuft>, breite: Float = 326f) {
    val m = rememberTextMeasurer()
    Canvas(Modifier.size(breite.dp, 34.dp)) {
        val s = density
        val n = max(1, verlauf.size)
        val b = breite / n
        verlauf.forEachIndexed { i, st ->
            drawRect(RF.luft(st.luft_p10), Offset((i * b + 1) * s, 0f), Size((b - 2) * s, 16 * s))
        }
        for (h in listOf(6, 10, 14, 18, 22)) svgText(m, zwei(h), (h - 6) * b + b / 2, 31f, RF.lime, ankerX = 0.5f)
    }
}

// MARK: - Dash im Planer

@Composable
internal fun PufferDash(option: NebenRisikoOption, ereignisAnzahl: Int, oeffnen: () -> Unit) {
    val knapp = option.knappste_stunde
    val knappFarbe = RF.luft(option.verlauf.firstOrNull { it.h == knapp }?.luft_p10)
    Column(Modifier.fillMaxWidth().border(2.dp, RF.lime, RectangleShape).tippen(oeffnen).padding(horizontal = 16.dp, vertical = 14.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            PText("Puffer je Fahrt", 16f, 700, RF.lime)
            Spacer(Modifier.weight(1f))
            Icon("Arrow_Trisar_Icons_01_Lime", Modifier.width(28.dp).height(17.dp))
        }
        Row(Modifier.padding(top = 12.dp)) {
            DashZelle(RF.zahl(option.puffer_mittel), "Ø min\nbisher mind. $NEBEN_BISHER_PUFFER_MIN", RF.lime)
            DashZelle(RF.zahl(option.hoch.size.toDouble()), "Fahrten\nhohes Risiko", if (option.hoch.isEmpty()) RF.lime else RF.rot)
            DashZelle(RF.zahl(ereignisAnzahl.toDouble()), "Ereignisse\neingerechnet", RF.lime)
        }
        Row(Modifier.padding(top = 14.dp), verticalAlignment = Alignment.Bottom) {
            PText("Sicherheit über den Tag", 12f, 500, RF.lime)
            Spacer(Modifier.weight(1f))
            if (knapp != null) PText("knappste Zeit $knapp–${knapp + 1} Uhr", 11f, 400, knappFarbe)
        }
        Box(Modifier.padding(top = 6.dp)) { SicherheitsBand(option.verlauf) }
    }
}

@Composable
private fun androidx.compose.foundation.layout.RowScope.DashZelle(wert: String, unter: String, farbe: Color) {
    Column(Modifier.weight(1f)) {
        Box(Modifier.height(32.dp), contentAlignment = Alignment.CenterStart) { PText(wert, 28f, 700, farbe, -0.5f) }
        PAbsatz(unter, 12f, 400, 15f, RF.lime.copy(alpha = 0.75f))
    }
}

// MARK: - Faecher: Luft je Stunde ueber alle Verlaeufe

/**
 * Je Verlauf zaehlt der knappste Anschluss der Stunde. Neun leicht deckende Baender
 * (5–95 %, 10–90 % … 45–55 %) ergeben den Farbverlauf, Linie = Median.
 */
@Composable
internal fun LuftFaecher(faecher: List<NebenFaecherStunde>, gewaehlt: Int?, waehlen: ((Int) -> Unit)?, breite: Float = 326f, hoehe: Float = 170f) {
    val f = faecher.filter { (it.n ?: 0) > 0 && it.q?.size == 19 }
    if (f.isEmpty()) return
    val m = rememberTextMeasurer()
    val x0 = 28f
    val x1 = breite - 4
    val y0 = hoehe - 22
    val ym = 8f
    val werte = f.flatMap { listOf(it.q!![0], it.q[18]) }
    val maxW = max(20.0, ceil(max(werte.maxOrNull() ?: 0.0, 0.0) / 10) * 10)
    val minW = max(-30.0, min(0.0, floor(min(werte.minOrNull() ?: 0.0, 0.0) / 10) * 10))
    fun X(h: Int) = x0 + (h - 6) / 17f * (x1 - x0)
    fun Y(v: Double) = y0 - ((max(v, minW) - minW) / (maxW - minW)).toFloat() * (y0 - ym)
    Canvas(
        Modifier.size(breite.dp, hoehe.dp).pointerInput(f) {
            detectTapGestures { ort ->
                val x = ort.x / density
                val y = ort.y / density
                // Tippflaeche 18 breit je Stunde wie im SVG.
                if (y < ym || y > y0) return@detectTapGestures
                f.firstOrNull { abs(X(it.h) - x) <= 9 }?.let { waehlen?.invoke(it.h) }
            }
        }
    ) {
        val s = density
        fun p(x: Float, y: Float) = Offset(x * s, y * s)
        // Zusammenhaengende Stunden als Stuecke.
        val stuecke = mutableListOf<MutableList<NebenFaecherStunde>>()
        f.forEachIndexed { i, pt -> if (i > 0 && pt.h == f[i - 1].h + 1) stuecke.last() += pt else stuecke += mutableListOf(pt) }
        fun schichten(farbe: Color) {
            for (lo in 0..8) {
                val hi = 18 - lo
                for (seg in stuecke) {
                    if (seg.size == 1) {
                        val q = seg[0].q!!
                        drawRect(farbe, p(X(seg[0].h) - 3, Y(q[hi])), Size(6 * s, (Y(q[lo]) - Y(q[hi])) * s))
                    } else {
                        val pfad = Path()
                        val oben = seg.map { p(X(it.h), Y(it.q!![hi])) }
                        val unten = seg.reversed().map { p(X(it.h), Y(it.q!![lo])) }
                        (oben + unten).forEachIndexed { i, o -> if (i == 0) pfad.moveTo(o.x, o.y) else pfad.lineTo(o.x, o.y) }
                        pfad.close()
                        drawPath(pfad, farbe)
                    }
                }
            }
        }
        val achse: List<Double> = if (minW < 0) listOf(minW) + (if (-minW / (maxW - minW) > 0.15) listOf(0.0) else emptyList()) + listOf(maxW) else listOf(0.0, maxW / 2, maxW)
        for (v in achse) svgText(m, RF.zahl(v), 0f, Y(v) + 4, RF.lime)
        for (h in listOf(6, 10, 14, 18, 22)) svgText(m, zwei(h), X(h), hoehe - 6, RF.lime, ankerX = 0.5f)
        drawLine(Color.White.copy(alpha = 0.35f), p(x0, Y(0.0)), p(x1, Y(0.0)), 1f * s, pathEffect = PathEffect.dashPathEffect(floatArrayOf(3 * s, 3 * s)))
        clipRect(0f, 0f, breite * s, Y(0.0) * s) { schichten(Color(227 / 255f, 246 / 255f, 84 / 255f, 0.12f)) }
        if (minW < 0) clipRect(x0 * s, Y(0.0) * s, x1 * s, (y0 + 1) * s) { schichten(Color(1f, 111 / 255f, 99 / 255f, 0.2f)) }
        for (seg in stuecke) {
            val pfad = Path()
            seg.forEachIndexed { i, pt -> val o = p(X(pt.h), Y(pt.p50 ?: 0.0)); if (i == 0) pfad.moveTo(o.x, o.y) else pfad.lineTo(o.x, o.y) }
            drawPath(pfad, Color.White, style = Stroke(1.8f * s))
        }
        if (gewaehlt != null) drawLine(Color.White.copy(alpha = 0.4f), p(X(gewaehlt), ym), p(X(gewaehlt), y0), 1f * s)
        for (pt in f) drawCircle(Color.White, (if (gewaehlt == pt.h) 5f else 2.6f) * s, p(X(pt.h), Y(pt.p50 ?: 0.0)))
    }
}

// MARK: - Streudiagramm: Puffer je Fahrt ueber den Tag

@Composable
internal fun PufferStreuung(fahrten: Map<String, NebenRisikoFahrt>, ereignisse: List<NebenEreignis> = emptyList(), breite: Float = 326f, hoehe: Float = 190f) {
    val m = rememberTextMeasurer()
    Canvas(Modifier.size(breite.dp, hoehe.dp)) {
        val s = density
        fun p(x: Float, y: Float) = Offset(x * s, y * s)
        val x0 = 26f
        val x1 = breite - 4
        val y0 = hoehe - 24
        val ym = 6f
        // Feste Reihenfolge, damit die Punkte nicht bei jedem Zeichnen anders liegen.
        val punkte = fahrten.keys.sorted().mapNotNull { id ->
            val f = fahrten[id] ?: return@mapNotNull null
            val luft = f.luft ?: return@mapNotNull null
            val mi = RF.minuten(f.abfahrt) ?: return@mapNotNull null
            Triple(mi, luft.puffer, f.klasse)
        }
        val maxW = max(40.0, ceil(max(punkte.maxOfOrNull { it.second } ?: 0.0, 0.0) / 10) * 10)
        fun X(mi: Double) = x0 + ((min(max(mi, 360.0), 1440.0) - 360) / 1080).toFloat() * (x1 - x0)
        fun Y(v: Double) = y0 - (max(0.0, v) / maxW).toFloat() * (y0 - ym)
        // Nur Ereignisse, die die Engine eingerechnet hat, Name nur am ersten Zeitfenster.
        for (e in ereignisse) {
            if (e.art != "ereignis" || e.quelleArt != "auto") continue
            RF.fenster(e.zeit).forEachIndexed { i, (a, b) ->
                drawRect(Color(1f, 111 / 255f, 99 / 255f, 0.12f), p(X(a.toDouble()), ym), Size(max(2f, X(b.toDouble()) - X(a.toDouble())) * s, (y0 - ym) * s))
                if (i == 0) svgText(m, e.kachelWerte.name, X(a.toDouble()) + 3, ym + 11, RF.rot)
            }
        }
        for (v in listOf(0.0, maxW / 2, maxW)) {
            drawLine(Color(227 / 255f, 246 / 255f, 84 / 255f, 0.18f), p(x0, Y(v)), p(x1, Y(v)), 1f * s)
            svgText(m, RF.zahl(v), 0f, Y(v) + 4, RF.lime)
        }
        svgText(m, "min", x0 + 4, Y(maxW) + 12, RF.lime)
        for (h in listOf(6, 10, 14, 18, 22)) svgText(m, zwei(h), X(h * 60.0), hoehe - 6, RF.lime, ankerX = 0.5f)
        drawLine(Color.White, p(x0, Y(NEBEN_BISHER_PUFFER_MIN.toDouble())), p(x1, Y(NEBEN_BISHER_PUFFER_MIN.toDouble())), 1.2f * s,
            pathEffect = PathEffect.dashPathEffect(floatArrayOf(5 * s, 4 * s)))
        for ((mi, puffer, klasse) in punkte) drawCircle(RF.klasse(klasse), 3.4f * s, p(X(mi.toDouble()), Y(puffer)))
    }
}

// MARK: - Fahrzeit-Verteilung einer Fahrt

@Composable
internal fun FahrzeitVerteilung(fahrzeit: NebenRisikoFahrt.Fahrzeit, breite: Float = 326f) {
    val hist = fahrzeit.hist
    if (hist.isEmpty()) return
    val m = rememberTextMeasurer()
    Canvas(Modifier.size(breite.dp, 70.dp)) {
        val s = density
        val bw = breite / hist.size
        val maxW = max(hist.maxOrNull() ?: 1.0, 1.0)
        val schritt = (fahrzeit.bis - fahrzeit.von) / hist.size
        hist.forEachIndexed { i, v ->
            val mitte = fahrzeit.von + (i + 0.5) * schritt
            val farbe = if (mitte <= fahrzeit.p50 + 2) RF.gruen else if (mitte <= fahrzeit.p90) RF.lime else RF.rot
            val h = (v / maxW).toFloat() * 48
            drawRect(farbe, Offset((i * bw + 1) * s, (52 - h) * s), Size((bw - 2) * s, h * s))
        }
        val xMed = ((fahrzeit.p50 - fahrzeit.von) / max(1.0, fahrzeit.bis - fahrzeit.von)).toFloat() * breite
        drawLine(RF.dunkel, Offset(xMed * s, 0f), Offset(xMed * s, 52 * s), 1.5f * s)
        svgText(m, "${RF.zahl(fahrzeit.von)} min", 0f, 66f, RF.dunkel, deckung = 0.6f)
        svgText(m, "${RF.zahl(fahrzeit.bis)} min", breite, 66f, RF.dunkel, ankerX = 1f, deckung = 0.6f)
    }
}

// MARK: - RisikoAbschnitt (Fahrt bearbeiten)

/** "Was dieser Fahrt passieren kann": Fahrzeit ueber alle Verlaeufe, Ursachen und was die Engine dafuer eingeplant hat. */
@Composable
internal fun RisikoAbschnitt(fahrt: NebenRisikoFahrt, geplant: Boolean = false, verlaeufe: Int = 500) {
    val trenner = hex(0xD9D9D9)
    data class Zeile(val name: String, val unter: String, val rechts: String, val bis: String)
    fun haeufigkeit(anteil: Double): String { val n = rund(anteil * 10).toInt(); return if (n >= 1) "$n von 10" else "selten" }
    val zeilen = buildList {
        fahrt.ereignis?.let { e ->
            add(Zeile("${e.name.replace(", Allianz Arena", "")} eingeplant",
                if (e.route == "FTO") "Route über Flughafentangente Ost · Planungsannahme" else "Planungsannahme", "vorhergesagt", "+${RF.zahl(e.min)} min"))
        }
        for (u in fahrt.ursachen ?: emptyList()) add(Zeile(u.name, "", haeufigkeit(u.anteil), "bis +${RF.zahl(u.bis_min)} min"))
    }
    val d = RF.dunkel
    Box(Modifier.fillMaxWidth().background(hex(0x1A1A1A), RoundedCornerShape(12.dp)).padding(20.dp)) {
        Column(Modifier.fillMaxWidth().background(Color.White).padding(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                PText("Was dieser Fahrt passieren kann", 16f, 700, d, 0.5f)
                Spacer(Modifier.weight(1f))
                PText(fahrt.klasse, 11f, 700, d, modifier = Modifier.background(RF.klasse(fahrt.klasse)).padding(horizontal = 6.dp, vertical = 2.dp))
            }
            PText("Fahrzeit in $verlaeufe Verläufen", 11f, 400, d.copy(alpha = 0.6f), modifier = Modifier.padding(top = 12.dp))
            fahrt.fahrzeit?.let { fz ->
                Box(Modifier.padding(top = 4.dp)) { FahrzeitVerteilung(fz, 330f) }
                val t = buildAnnotatedString {
                    append("Normal "); withStyle(SpanStyle(fontWeight = FontWeight(700))) { append("${RF.zahl(fz.p50)} min") }
                    append(", in 9 von 10 Verläufen höchstens "); withStyle(SpanStyle(fontWeight = FontWeight(700))) { append("${RF.zahl(fz.p90)} min") }
                    append(".")
                }
                Text(t, style = grotesk(13f, zeilenHoehe = 18f, farbe = d), modifier = Modifier.padding(top = 6.dp))
            }
            Column(Modifier.padding(top = 10.dp)) {
                if (zeilen.isEmpty()) {
                    Box(Modifier.fillMaxWidth().background(trenner).padding(top = 1.dp).background(Color.White).padding(vertical = 9.dp)) {
                        PText("In den Verläufen kaum Schwankung.", 13f, 400, d)
                    }
                } else for (z in zeilen) {
                    Column(Modifier.fillMaxWidth().background(trenner).padding(top = 1.dp).background(Color.White).padding(vertical = 9.dp)) {
                        Row {
                            Column(Modifier.weight(1f)) {
                                PAbsatz(z.name, 13f, 400, 17f, d)
                                if (z.unter.isNotEmpty()) PAbsatz(z.unter, 11f, 400, 14f, d.copy(alpha = 0.6f))
                            }
                            Spacer(Modifier.width(10.dp))
                            Column(horizontalAlignment = Alignment.End) {
                                PText(z.rechts, 13f, 700, d, zeilenHoehe = 17f)
                                PText(z.bis, 11f, 400, d.copy(alpha = 0.6f))
                            }
                        }
                    }
                }
            }
            Column(Modifier.padding(top = 10.dp).fillMaxWidth().background(trenner).padding(top = 1.dp).background(Color.White).padding(top = 10.dp)) {
                if (geplant) {
                    val luft = fahrt.luft
                    if (luft != null) {
                        Row(Modifier.height(22.dp), verticalAlignment = Alignment.CenterVertically) {
                            PText("Eingeplanter Puffer", 13f, 400, d); Spacer(Modifier.weight(1f)); PText("${RF.zahl(luft.puffer)} min", 13f, 700, d)
                        }
                        Row(Modifier.height(22.dp), verticalAlignment = Alignment.CenterVertically) {
                            PText("Bisher pauschal", 13f, 400, d.copy(alpha = 0.5f)); Spacer(Modifier.weight(1f)); PText("$NEBEN_BISHER_PUFFER_MIN min", 13f, 400, d.copy(alpha = 0.5f))
                        }
                        val alle = luft.folge_puenktlich == luft.verlaeufe
                        Row {
                            PText("Folgefahrt ${luft.folge_abfahrt ?: ""}", 13f, 400, d)
                            Spacer(Modifier.weight(1f).width(10.dp))
                            PAbsatz(
                                if (alle) "in allen Verläufen pünktlich" else "in ${luft.folge_puenktlich ?: 0} von ${luft.verlaeufe ?: 0} pünktlich",
                                13f, 700, 22f, if (alle) RF.gruen else d, ausrichtung = androidx.compose.ui.text.style.TextAlign.End,
                            )
                        }
                    } else {
                        Row(Modifier.height(22.dp), verticalAlignment = Alignment.CenterVertically) {
                            PText("Puffer", 13f, 400, d); Spacer(Modifier.weight(1f)); PText("letzte Fahrt im Dienst", 13f, 400, d.copy(alpha = 0.6f))
                        }
                    }
                } else {
                    PAbsatz("Den Puffer legt die Engine fest, wenn die Fahrt nach ihrem Plan eingeteilt ist.", 12f, 400, 16f, d.copy(alpha = 0.6f))
                }
            }
            PText("Planungsannahmen, keine Messwerte.", 10f, 400, d.copy(alpha = 0.5f), modifier = Modifier.padding(top = 10.dp))
        }
    }
}
