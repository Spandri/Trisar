package de.trisar.kern

import android.graphics.Matrix
import android.graphics.RadialGradient
import android.graphics.Shader
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ShaderBrush
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontVariation
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.sp

/** Farben wie in der Web-App (Tailwind-Werte), gleich wie Farbe in iOS. */
object Farbe {
    val lime = Color(0xFFE3F754)
    val limeIcon = Color(0xFFE3F654)
    val limeHover = Color(0xFFD4FF28)
    val grauText = Color(0xFF868786)
    val feld = Color(0xFF242525)
    val feldRand = Color(0xFF3A3A3A)
    val fehler = Color(0xFFF87171)
    val schwarzText = Color(0xFF1D1C1D)
}

fun hex(wert: Long, alpha: Float = 1f): Color =
    Color(((wert shr 16) and 0xFF).toInt(), ((wert shr 8) and 0xFF).toInt(), (wert and 0xFF).toInt(), (alpha * 255).toInt())

/** Space Grotesk wie im Web, variable Schrift: Gewicht ueber die wght-Achse. */
@OptIn(androidx.compose.ui.text.ExperimentalTextApi::class)
val Grotesk: FontFamily = FontFamily(
    listOf(300, 400, 500, 600, 700).map { w ->
        Font(R.font.space_grotesk, FontWeight(w), variationSettings = FontVariation.Settings(FontVariation.weight(w)))
    }
)

/** Text im Web-Stil: Groesse in px des Rasters, Gewicht, Zeilenhoehe, Buchstabenabstand. */
fun grotesk(groesse: Float, gewicht: Int = 400, zeilenHoehe: Float? = null, abstand: Float = 0f, farbe: Color = Color.White): TextStyle =
    TextStyle(
        fontFamily = Grotesk,
        fontWeight = FontWeight(gewicht),
        fontSize = groesse.sp,
        lineHeight = zeilenHoehe?.sp ?: TextUnit.Unspecified,
        letterSpacing = abstand.sp,
        color = farbe,
    )

/**
 * Hintergrund der Fahrer-App: dunkles Lime-Leuchten oben links, wie screenBg im Web
 * (SVG 402x874 gestreckt, radialGradient r=10, gradientTransform matrix(40.2 87.4 -40.2 18.49 0 0)).
 */
@Composable
fun TrisarHintergrund(modifier: Modifier = Modifier.fillMaxSize()) {
    Canvas(modifier) {
        val sx = size.width / 402f
        val sy = size.height / 874f
        val farben = intArrayOf(
            Color(49, 55, 1).toArgb(), Color(25, 28, 0).toArgb(), Color(12, 14, 0).toArgb(),
            Color.Black.toArgb(), Color.Black.toArgb(),
        )
        val shader = RadialGradient(0f, 0f, 10f, farben, floatArrayOf(0f, 0.2283f, 0.34244f, 0.45659f, 1f), Shader.TileMode.CLAMP)
        shader.setLocalMatrix(Matrix().apply {
            setValues(floatArrayOf(40.2f * sx, -40.2f * sx, 0f, 87.4f * sy, 18.49f * sy, 0f, 0f, 0f, 1f))
        })
        drawRect(Color.Black)
        drawRect(ShaderBrush(shader))
    }
}

/**
 * CSS radial-gradient(ellipse rx% ry% at 0% 0%, ...) wie CSSRadial in iOS.
 * stopps: (Farbe als 0xRRGGBB, Position 0..1).
 */
@Composable
fun CssRadial(rx: Float, ry: Float, stopps: List<Pair<Long, Float>>, modifier: Modifier = Modifier.fillMaxSize()) {
    Canvas(modifier) {
        val shader = RadialGradient(
            0f, 0f, 1f,
            stopps.map { hex(it.first).toArgb() }.toIntArray(),
            stopps.map { it.second }.toFloatArray(),
            Shader.TileMode.CLAMP,
        )
        shader.setLocalMatrix(Matrix().apply { setScale(rx * size.width, ry * size.height) })
        drawRect(Color.Black)
        drawRect(ShaderBrush(shader))
    }
}

/** Blauer Verlauf der Dispo: radial-gradient(ellipse 141.42% 102.21% at 0% 0%, #0048cf ...). */
@Composable
fun DispoHintergrund(modifier: Modifier = Modifier.fillMaxSize()) {
    CssRadial(
        1.4142f, 1.0221f,
        listOf(
            0x0048CFL to 0f, 0x00369BL to 0.11415f, 0x002468L to 0.2283f, 0x001B4EL to 0.28537f,
            0x001234L to 0.34244f, 0x00091AL to 0.39952f, 0x00050DL to 0.42805f, 0x000000L to 0.45659f, 0x000000L to 1f,
        ),
        modifier,
    )
}
