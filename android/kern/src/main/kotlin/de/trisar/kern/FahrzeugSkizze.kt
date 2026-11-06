package de.trisar.kern

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.unit.dp
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.doubleOrNull
import kotlin.math.max
import kotlin.math.min

/**
 * Aufsicht des Fahrzeugs (Front oben, 120 x 240) mit optionaler Marke, wie FahrzeugSkizze.swift
 * und WagenAufsicht im Web. Beim Melden und im Schadensbericht (Fahrer + Dispo) gleich.
 */
object FahrzeugSkizze {
    const val BREITE = 120f
    const val HOEHE = 240f

    /** Zeichnet in Koordinaten 120 x 240 (vorher skalieren). */
    fun DrawScope.zeichnen(punkt: Offset?) {
        val schwarz = hex(0x1C1C1D)
        for (r in listOf(Rect(5f, 40f, 18f, 76f), Rect(102f, 40f, 115f, 76f), Rect(5f, 164f, 18f, 200f),
            Rect(102f, 164f, 115f, 200f), Rect(6f, 84f, 20f, 93f), Rect(100f, 84f, 114f, 93f))) {
            drawRect(schwarz, r.topLeft, r.size)
        }
        drawRoundRect(hex(0xF7F7F7), Offset(16f, 4f), Size(88f, 232f), CornerRadius(24f))
        drawRoundRect(schwarz, Offset(16f, 4f), Size(88f, 232f), CornerRadius(24f), style = Stroke(3f))
        drawPath(Path().apply { moveTo(31f, 100f); lineTo(89f, 100f); lineTo(83f, 72f); lineTo(37f, 72f); close() }, schwarz)
        drawPath(Path().apply { moveTo(31f, 148f); lineTo(89f, 148f); lineTo(83f, 178f); lineTo(37f, 178f); close() }, schwarz)
        if (punkt != null) {
            // Marke bleibt ganz im Bild (Radius 17 + 2 Rand).
            val x = min(BREITE - 19f, max(19f, punkt.x))
            val y = min(HOEHE - 19f, max(19f, punkt.y))
            drawCircle(hex(0xE3F754), 17f, Offset(x, y))
            drawCircle(schwarz, 17f, Offset(x, y), style = Stroke(2.5f))
            drawCircle(schwarz, 5f, Offset(x, y))
        }
    }

    /** Punkt aus vehicle_damages.stelle ({"x": .., "y": ..}). */
    fun punkt(stelle: JsonObject?): Offset? {
        val x = (stelle?.get("x") as? JsonPrimitive)?.takeIf { it !is JsonNull }?.doubleOrNull ?: return null
        val y = (stelle["y"] as? JsonPrimitive)?.takeIf { it !is JsonNull }?.doubleOrNull ?: return null
        return Offset(x.toFloat(), y.toFloat())
    }

    fun geschaetzt(stelle: JsonObject?) = (stelle?.get("geschaetzt") as? JsonPrimitive)?.content == "true"
}

/** Fertige Skizze in gewuenschter Hoehe (Breite folgt dem Seitenverhaeltnis). */
@Composable
fun FahrzeugSkizzeAnsicht(punkt: Offset?, hoehe: Float, modifier: Modifier = Modifier) {
    Canvas(modifier.size((FahrzeugSkizze.BREITE * hoehe / FahrzeugSkizze.HOEHE).dp, hoehe.dp)) {
        val f = size.height / FahrzeugSkizze.HOEHE
        scale(f, f, pivot = Offset.Zero) { with(FahrzeugSkizze) { zeichnen(punkt) } }
    }
}
