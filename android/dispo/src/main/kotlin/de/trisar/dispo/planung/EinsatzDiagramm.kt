package de.trisar.dispo.planung

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.positionChange
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.unit.dp
import de.trisar.kern.grotesk
import de.trisar.kern.platz
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * Tagesdiagramm (EinsatzDiagramm.jsx, EinsatzBausteine.swift): Legende, Raster mit vier Abschnitten,
 * Fahrer als Balken, Bedarf (weiss, Punkte lime/rot), gebuchte Fahrten (blau), 20 Stunden ab 06:00.
 * `oben` = y-Mitte der Legende (Tagesplanung 194). Liegt in einer Raster-Box (absolute Lage).
 */
@Composable
internal fun EinsatzDiagramm(
    oben: Float = 194f,
    bedarf: List<Int>,
    gebucht: List<Int>,
    fahrer: List<Int>,
    bedarfBasis: List<Int>? = null,
    ziehbar: Boolean = false,
    beiBedarf: (Int, Int) -> Unit = { _, _ -> },
) {
    val ueber = 220f   // Platz nach oben, falls ein Punkt ueber das Raster gezogen wird
    var ziehIndex by remember { mutableStateOf<Int?>(null) }
    var festSchritt by remember { mutableStateOf<Int?>(null) }

    val schritt = festSchritt ?: run {
        val spitze = max((bedarf + gebucht + fahrer).maxOrNull() ?: 0, 4)
        val roh = max(1, spitze) / 4.0
        listOf(1, 2, 5, 10, 20, 25, 50, 100).firstOrNull { it >= roh } ?: (kotlin.math.ceil(roh / 100).toInt() * 100)
    }
    val zielMax = schritt * 4
    // Angezeigte Skala gleitet zur Zielskala (380 ms, ease-out), statt zu springen.
    val anzeige = remember { Animatable(zielMax.toFloat()) }
    LaunchedEffect(zielMax) { anzeige.animateTo(zielMax.toFloat(), tween(380, easing = CubicBezierEasing(0.33f, 1f, 0.68f, 1f))) }

    fun slotMitte(i: Int) = 66f + i * 16f + 6f
    fun wertY(v: Double): Float {
        val m = if (anzeige.value > 0) anzeige.value.toDouble() else zielMax.toDouble()
        return (440 - (v / m) * 200).toFloat()
    }

    val versatz = oben - 194f
    val lime = EinsatzFarbe.lime
    val messer = rememberTextMeasurer()

    // Legende
    Box(Modifier.platz(16f, oben - 8f, null, 16f), contentAlignment = Alignment.CenterStart) { PText("Fahrer", 12f, 500, lime, 0.5f) }
    Box(Modifier.platz(66f, oben - 6f, 12f, 12f).background(EinsatzFarbe.gruen))
    Box(Modifier.platz(102f, oben - 8f, null, 16f), contentAlignment = Alignment.CenterStart) { PText("Bedarf Fahrer", 12f, 500, lime, 0.5f) }
    Box(Modifier.platz(195f, oben - 6f, 12f, 12f).background(lime, CircleShape).border(1.dp, Color.Black, CircleShape))
    Box(Modifier.platz(219f, oben - 6f, 12f, 12f).background(EinsatzFarbe.rot, CircleShape).border(1.dp, Color.Black, CircleShape))
    Box(Modifier.platz(253f, oben - 8f, null, 16f), contentAlignment = Alignment.CenterStart) { PText("Gebuchte Fahrten", 12f, 500, lime, 0.5f) }
    Box(Modifier.platz(370f, oben - 1f, 9f, 2f).background(EinsatzFarbe.blau))

    Canvas(Modifier.platz(0f, versatz - ueber, 402f, 470f + ueber)) {
        val s = size.width / 402f
        fun p(x: Float, y: Float) = Offset(x * s, (y + ueber) * s)
        val m = zielMax
        val zahlStil = grotesk(16f, 500, abstand = 0.5f, farbe = lime)
        for (i in 0..4) {
            drawLine(lime, p(20f, 240f + i * 50 + 0.5f), p(382f, 240f + i * 50 + 0.5f), strokeWidth = 1f * s)
            leinwandText(messer, "${m - i * schritt}", 20f * s, (228f + i * 50 + ueber) * s, zahlStil)
        }
        val anz = if (anzeige.value > 0) anzeige.value.toDouble() else m.toDouble()
        fahrer.forEachIndexed { i, v ->
            if (v <= 0) return@forEachIndexed
            val h = max(12f, (min(v.toDouble(), anz) / anz * 200 - 3).toFloat())
            drawRect(EinsatzFarbe.gruen, p(66f + i * 16f, 437f - h), Size(12f * s, h * s))
        }
        if (bedarfBasis != null) {
            bedarf.forEachIndexed { i, v ->
                if (i < bedarfBasis.size && v != bedarfBasis[i]) {
                    drawLine(
                        lime.copy(alpha = 0.7f), p(slotMitte(i), wertY(bedarfBasis[i].toDouble())), p(slotMitte(i), wertY(v.toDouble())),
                        strokeWidth = 1.5f * s, pathEffect = PathEffect.dashPathEffect(floatArrayOf(2f * s, 3f * s)),
                    )
                }
            }
        }
        fun linie(werte: List<Int>, dx: Float, farbe: Color) {
            val pfad = Path()
            werte.forEachIndexed { i, v ->
                val pt = p(slotMitte(i) + dx, wertY(v.toDouble()))
                if (i == 0) pfad.moveTo(pt.x, pt.y) else pfad.lineTo(pt.x, pt.y)
            }
            drawPath(pfad, farbe, style = Stroke(2f * s))
        }
        linie(bedarf, 0.5f, Color.White)
        linie(gebucht, -0.5f, EinsatzFarbe.blau)
        val diffStil = grotesk(10f, 700, farbe = lime)
        bedarf.forEachIndexed { i, v ->
            val diff = bedarfBasis?.let { if (i < it.size) v - it[i] else 0 } ?: 0
            val r = if (ziehIndex == i) 6.5f else 4.5f
            val mitte = p(slotMitte(i), wertY(v.toDouble()))
            drawCircle(if (v > (if (i < fahrer.size) fahrer[i] else 0)) EinsatzFarbe.rot else lime, r * s, mitte)
            drawCircle(if (diff != 0) Color.White else Color.Black, r * s, mitte, style = Stroke((if (diff != 0) 1.5f else 1f) * s))
            if (diff != 0) {
                // Anker unten Mitte wie im iOS-Canvas
                leinwandText(messer, if (diff > 0) "+$diff" else "−${abs(diff)}", mitte.x, mitte.y + (if (diff > 0) -11f else 19f) * s, diffStil, 0.5f, 1f)
            }
        }
        val uhrStil = grotesk(11f, 500, abstand = 0.5f, farbe = lime)
        for (t in 0..6) {
            val x = slotMitte(t * 3) - 0.5f
            drawLine(lime, p(x, 439.5f), p(x, 446.5f), strokeWidth = 2f * s)
            leinwandText(messer, zwei((6 + t * 3) % 24) + ":00", x * s, (455f + ueber) * s, uhrStil, 0.5f, 0.5f)
        }
    }

    if (ziehbar) {
        val bedarfAktuell by rememberUpdatedState(bedarf)
        val schrittAktuell by rememberUpdatedState(schritt)
        val melden by rememberUpdatedState(beiBedarf)
        Box(
            Modifier.platz(58f, versatz - ueber, 336f, 470f + ueber - 12f).pointerInput(Unit) {
                val s = size.width / 336f
                awaitEachGesture {
                    val runter = awaitFirstDown(requireUnconsumed = false)
                    // Koordinaten im Raum des Diagramms (SVG beginnt bei oben - 194).
                    val x = runter.position.x / s + 58f
                    val i = ((x - 72f) / 16f).roundToInt()
                    val b = bedarfAktuell
                    if (i < 0 || i >= b.size || abs(x - slotMitte(i)) > 9f) return@awaitEachGesture
                    val oberkante = min(240f, wertY(b[i].toDouble())) - 14f
                    if (runter.position.y / s - ueber < oberkante) return@awaitEachGesture
                    festSchritt = schrittAktuell
                    ziehIndex = i
                    runter.consume()
                    fun setzen(yLokal: Float) {
                        val svgY = yLokal / s - ueber
                        val skala = (festSchritt ?: schrittAktuell) * 4.0
                        val wert = max(0, min(999, ((440 - svgY) / 200 * skala).roundToInt()))
                        if (wert != bedarfAktuell[i]) melden(i, wert)
                    }
                    setzen(runter.position.y)
                    while (true) {
                        val ereignis = awaitPointerEvent()
                        val c = ereignis.changes.firstOrNull { it.id == runter.id } ?: break
                        if (!c.pressed) break
                        if (c.positionChange() != Offset.Zero) {
                            c.consume()
                            setzen(c.position.y)
                        }
                    }
                    ziehIndex = null
                    festSchritt = null
                }
            }
        )
    }
}
