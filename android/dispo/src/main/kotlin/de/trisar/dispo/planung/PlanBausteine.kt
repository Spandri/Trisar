package de.trisar.dispo.planung

import android.graphics.Matrix
import android.graphics.RadialGradient
import android.graphics.Shader
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.ScrollState
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameMillis
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.RectangleShape
import androidx.compose.ui.graphics.ShaderBrush
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.TextMeasurer
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import de.trisar.kern.Icon
import de.trisar.kern.ZurueckKnopf
import de.trisar.kern.grotesk
import de.trisar.kern.hex
import de.trisar.kern.mittig
import de.trisar.kern.platz
import de.trisar.kern.tippen
import de.trisar.kern.FussleisteUnten
import kotlin.math.max

// Gemeinsame Bausteine der Einsatzplanung (EinsatzBausteine.swift, NebenPlanerSeite.swift):
// Hintergrund, Raster-Leinwand, Texte, Wallet-Karten, Seitenpunkte.

internal object EinsatzFarbe {
    val lime = hex(0xE3F654)
    val titel = hex(0xE2F754)
    val trenner = hex(0xE3F754)
    val gruen = hex(0x59BE80)
    val rot = hex(0xFF6F63)
    val blau = hex(0x0059FF)
}

/** Faengt alle Beruehrungen ab, damit nichts zur Seite darunter durchgeht (Unterseiten liegen darueber). */
internal fun Modifier.abschirmen(): Modifier = this.pointerInput(Unit) {
    awaitPointerEventScope { while (true) awaitPointerEvent() }
}

/**
 * Raster 402 breit wie Leinwand in iOS: Grundhoehe 873, groesser als der Bildschirm = scrollbar.
 * `inhalt` bekommt die Rahmenhoehe (sichtbare Hoehe im Raster).
 */
@Composable
internal fun PlanLeinwand(
    inhaltHoehe: Float = 0f,
    basisHoehe: Float = 873f,
    scroll: ScrollState = rememberScrollState(),
    inhalt: @Composable BoxScope.(Float) -> Unit,
) {
    BoxWithConstraints(Modifier.fillMaxSize()) {
        val rahmen = max(basisHoehe, maxHeight.value)
        val hoehe = max(rahmen, inhaltHoehe)
        Box(Modifier.fillMaxSize().verticalScroll(scroll, enabled = hoehe > rahmen)) {
            Box(Modifier.width(402.dp).height(hoehe.dp)) { inhalt(rahmen) }
        }
    }
}

/** Radialverlauf mit SVG-Matrix (a b c d), gestreckt auf 402 x 873, wie die Canvas in iOS. */
private fun DrawScope.svgVerlauf(a: Float, b: Float, c: Float, d: Float, stopps: List<Pair<Color, Float>>) {
    val sx = size.width / 402f
    val sy = size.height / 873f
    val shader = RadialGradient(0f, 0f, 10f, stopps.map { it.first.toArgb() }.toIntArray(), stopps.map { it.second }.toFloatArray(), Shader.TileMode.CLAMP)
    shader.setLocalMatrix(Matrix().apply { setValues(floatArrayOf(a * sx, c * sx, 0f, b * sy, d * sy, 0f, 0f, 0f, 1f)) })
    drawRect(Color.Black)
    drawRect(ShaderBrush(shader))
}

private fun rgb(r: Int, g: Int, b: Int) = Color(r, g, b)

private val planVerlauf = listOf(
    rgb(49, 55, 1) to 0f, rgb(25, 28, 0) to 0.2283f, rgb(12, 14, 0) to 0.34244f, Color.Black to 0.45659f,
    Color.Black to 0.6782f, rgb(0, 6, 16) to 0.69832f, rgb(0, 11, 32) to 0.71843f, rgb(0, 22, 64) to 0.75865f,
    rgb(0, 33, 96) to 0.79888f, rgb(0, 45, 128) to 0.8391f, rgb(0, 67, 191) to 0.91955f, rgb(0, 89, 255) to 1f,
)

/**
 * Hintergrund von Kalender, Bedarf, Tagesplanung und Uebersicht (auch der Planer-Unterseiten):
 * SVG 402 x 873 gestreckt, radialGradient r=10, matrix(43.25 96.3 -44.344 19.869 0 0).
 */
@Composable
internal fun EinsatzHintergrund(modifier: Modifier = Modifier.fillMaxSize()) {
    Canvas(modifier) { svgVerlauf(43.25f, 96.3f, -44.344f, 19.869f, planVerlauf) }
}

/** Text im Web-Stil, eine Zeile, nicht umbrechen (fixedSize in iOS). */
@Composable
internal fun PText(
    text: String, groesse: Float, gewicht: Int = 400, farbe: Color = Color.White, abstand: Float = 0f,
    modifier: Modifier = Modifier, ausrichtung: TextAlign? = null, zeilenHoehe: Float? = null,
) {
    Text(
        text, modifier = modifier, style = grotesk(groesse, gewicht, zeilenHoehe, abstand, farbe),
        maxLines = 1, softWrap = false, overflow = TextOverflow.Clip, textAlign = ausrichtung,
    )
}

/** Mehrzeiliger Text wie WebText in iOS (CSS line-height). */
@Composable
internal fun PAbsatz(
    text: String, groesse: Float, gewicht: Int = 400, zeilenHoehe: Float, farbe: Color = Color.White,
    abstand: Float = 0f, modifier: Modifier = Modifier, ausrichtung: TextAlign = TextAlign.Start,
) {
    Text(text, modifier = modifier, style = grotesk(groesse, gewicht, zeilenHoehe, abstand, farbe), textAlign = ausrichtung)
}

/** Text in einem festen Rahmen, mittig ausgerichtet (frame + alignment in iOS). */
@Composable
internal fun RahmenText(
    text: String, groesse: Float, gewicht: Int, farbe: Color, modifier: Modifier,
    abstand: Float = 0.5f, ausrichtung: Alignment = Alignment.Center,
) {
    Box(modifier, contentAlignment = ausrichtung) { PText(text, groesse, gewicht, farbe, abstand) }
}

/** Zurueck-Knopf, Titel 42, Unterzeile: fliessender Rahmen der Planer-Unterseiten (NebenPlanerSeite.swift). */
@Composable
internal fun NebenPlanerSeite(titel: String, unterzeile: String, zurueck: () -> Unit, inhalt: @Composable () -> Unit) {
    Box(Modifier.fillMaxSize().background(Color.Black).abschirmen()) {
        EinsatzHintergrund()
        Column(
            Modifier.fillMaxSize().verticalScroll(rememberScrollState())
                .padding(start = 20.dp, end = 20.dp, top = 40.dp, bottom = 160.dp)
        ) {
            ZurueckKnopf(aktion = zurueck)
            Spacer(Modifier.height(50.dp))
            PText(titel, 42f, 700, EinsatzFarbe.lime, zeilenHoehe = 42f)
            Spacer(Modifier.height(8.dp))
            PAbsatz(unterzeile, 14f, zeilenHoehe = 18f, farbe = hex(0xE3F654, 0.5f))
            inhalt()
        }
        FussleisteUnten()
    }
}

/** Langsam drehender Farbverlauf Blau -> Schwarz -> Lime (planen-farbe), wie PlanungsKnopf in iOS. */
@Composable
internal fun Modifier.planenVerlauf(): Modifier {
    var winkel by remember { mutableFloatStateOf(22.66f) }
    LaunchedEffect(Unit) {
        val beginn = withFrameMillis { it }
        while (true) {
            withFrameMillis { t -> winkel = 22.66f + ((t - beginn) / 120_000f * 360f) % 360f }
        }
    }
    val hsv = android.graphics.Color.HSVToColor(floatArrayOf(66f, 0.44f, 0.76f))
    return this.drawBehind {
        drawRect(Color.Black)
        val seite = 420.dp.toPx()
        rotate(winkel) {
            val links = center.x - seite / 2
            drawRect(
                Brush.horizontalGradient(
                    0f to Color(0f, 89f / 255f, 1f, 0.78f), 0.314f to Color(0f, 89f / 255f, 1f, 0.78f),
                    // Der Lime-Stopp liegt in iOS bei 1.2, am Rand ist also erst 0.6875 des Wegs erreicht.
                    0.56f to Color.Black, 1f to androidx.compose.ui.graphics.lerp(Color.Black, Color(hsv), 0.6875f),
                    startX = links, endX = links + seite,
                ),
                topLeft = androidx.compose.ui.geometry.Offset(links, center.y - seite / 2),
                size = androidx.compose.ui.geometry.Size(seite, seite),
            )
        }
    }
}

/** Knopf "Planung"-Stil mit wanderndem Farbverlauf, Text links, Sparkle rechts (NebenPlanenKnopf). */
@Composable
internal fun NebenPlanenKnopf(text: String, aktion: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().height(56.dp).clipToBounds().planenVerlauf()
            .border(2.dp, hex(0xE2F754), RectangleShape).tippen(aktion)
            .padding(start = 22.dp, end = 26.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        PText(text, 16f, 500, EinsatzFarbe.lime, 0.5f)
        Spacer(Modifier.weight(1f))
        Icon("Planen_Sparkle_Lime", Modifier.size(24.dp))
    }
}

/** Seitentitel: 42 fett, Lime (StammTitel). */
@Composable
internal fun PlanTitel(text: String, abstand: Float = 0f) = PText(text, 42f, 700, EinsatzFarbe.lime, abstand, zeilenHoehe = 42f)

/** Text auf eine Canvas setzen (SVG-Text), Anker 0..1 in x und y. */
internal fun DrawScope.leinwandText(
    messer: TextMeasurer, text: String, x: Float, y: Float, stil: TextStyle, ankerX: Float = 0f, ankerY: Float = 0.5f,
) {
    val m = messer.measure(AnnotatedString(text), stil, softWrap = false)
    drawText(m, topLeft = androidx.compose.ui.geometry.Offset(x - m.size.width * ankerX, y - m.size.height * ankerY))
}

// MARK: - Wallet-Karten

private data class WalletZeile(val a: String, val b: String, val c: String, val d: String)

@Composable
private fun WalletZeilen(zeilen: List<WalletZeile>, labelOben: Float, farbe: Color) {
    zeilen.forEachIndexed { nr, z ->
        val y = labelOben + nr * 68f
        Box(Modifier.platz(20f, y - 12f, null, 24f), contentAlignment = Alignment.CenterStart) { PText(z.a, 13f, 500, farbe.copy(alpha = farbe.alpha * 0.4f), 0.5f) }
        Box(Modifier.platz(20f, y + 12f, null, 24f), contentAlignment = Alignment.CenterStart) { PText(z.b, 22f, 500, farbe, 0.5f) }
        Box(Modifier.platz(20f, y - 12f, 322f, 24f), contentAlignment = Alignment.CenterEnd) {
            if (z.c == "CO2") {
                val t = buildAnnotatedString {
                    append("CO")
                    withStyle(SpanStyle(fontSize = 8.385.sp)) { append("2 ") }
                    append("Verbrauch")
                }
                Text(t, style = grotesk(13f, 500, abstand = 0.5f, farbe = farbe.copy(alpha = 0.4f)), maxLines = 1, softWrap = false)
            } else {
                PText(z.c, 13f, 500, farbe.copy(alpha = 0.4f), 0.5f)
            }
        }
        Box(Modifier.platz(20f, y + 12f, 322f, 24f), contentAlignment = Alignment.CenterEnd) { PText(z.d, 22f, 500, farbe, 0.5f) }
    }
}

internal const val TAGES_WALLET_HOEHE = 433f
internal const val GESAMT_WALLET_HOEHE = 389f

/** Tageskarte (Figma 2571:12781): Lime, Kennzahlen eines Tages, 362 x 433. */
@Composable
internal fun TagesWalletKarte(titel: String, wallet: EinsatzWallet, modifier: Modifier = Modifier) {
    val schwarz = Color.Black
    Box(modifier.size(362.dp, 433.dp)) {
        Icon("wallet", Modifier.size(362.dp, 433.dp), skalierung = ContentScale.FillBounds)
        Icon("wallet_logo", Modifier.platz(117f, 26f, 128.081f, 19f), skalierung = ContentScale.FillBounds)
        Icon("wallet_strich", Modifier.platz(29f, 78f, 70.5f, 1f), skalierung = ContentScale.FillBounds)
        Icon("wallet_strich", Modifier.platz(260f, 78f, 70.5f, 1f), skalierung = ContentScale.FillBounds)
        RahmenText(titel, 18f, 700, schwarz, Modifier.mittig(181f, 67f, 300f, 24f))
        WalletZeilen(
            listOf(
                WalletZeile("Startzeit", wallet.start, "Endzeit", wallet.ende),
                WalletZeile("Anzahl der Fahrer", wallet.fahrer, "Anzahl der Kunden", wallet.kunden),
                WalletZeile("Ø Kunden auf Fahrer", wallet.schnitt, "Anzahl der Fahrten", wallet.fahrten),
                WalletZeile("Gefahrene Km", wallet.km, "CO2", wallet.co2),
            ), 111f, schwarz,
        )
        RahmenText("inkl. MwSt.", 13f, 500, schwarz.copy(alpha = 0.4f), Modifier.mittig(181f, 360f, 300f, 24f))
        RahmenText(wallet.preis, 32f, 700, schwarz, Modifier.mittig(181f, 385f, 300f, 24f))
        Icon("wallet_strich", Modifier.platz(33f, 396f, 70.5f, 1f), skalierung = ContentScale.FillBounds)
        Icon("wallet_strich", Modifier.platz(260f, 396f, 70.5f, 1f), skalierung = ContentScale.FillBounds)
    }
}

/** Gesamtkarte (Figma 2596:12648): Lime-Rahmen auf dunklem Grund, 362 x 389. */
@Composable
internal fun GesamtWalletKarte(titel: String, wallet: EinsatzWallet, modifier: Modifier = Modifier) {
    val lime = EinsatzFarbe.lime
    Box(modifier.size(362.dp, 389.dp)) {
        Icon("gesamt_rahmen", Modifier.size(362.dp, 389.dp), skalierung = ContentScale.FillBounds)
        Icon("gesamt_logo", Modifier.platz(117f, 26f, 128.081f, 19f), skalierung = ContentScale.FillBounds)
        Icon("gesamt_strich_kurz", Modifier.platz(32f, 78f, 35.5f, 1f), skalierung = ContentScale.FillBounds)
        Icon("gesamt_strich_kurz", Modifier.platz(295f, 78f, 35.5f, 1f), skalierung = ContentScale.FillBounds)
        RahmenText(titel, 18f, 700, lime, Modifier.mittig(181f, 67f, 300f, 24f))
        WalletZeilen(
            listOf(
                WalletZeile("Anzahl der Fahrer", wallet.fahrer, "Anzahl der Kunden", wallet.kunden),
                WalletZeile("Ø Kunden auf Fahrer", wallet.schnitt, "Anzahl der Fahrten", wallet.fahrten),
                WalletZeile("Gefahrene Km", wallet.km, "CO2", wallet.co2),
            ), 129f, lime,
        )
        RahmenText("inkl. MwSt.", 13f, 500, lime.copy(alpha = 0.4f), Modifier.mittig(181f, 310f, 300f, 24f))
        RahmenText(wallet.preis, 32f, 700, lime, Modifier.mittig(181f, 335f, 300f, 24f))
        Icon("gesamt_strich", Modifier.platz(33f, 346f, 70.5f, 1f), skalierung = ContentScale.FillBounds)
        Icon("gesamt_strich", Modifier.platz(260f, 346f, 70.5f, 1f), skalierung = ContentScale.FillBounds)
    }
}

/** Seitenpunkte: 7er Punkte im 17er Abstand, aktiver voll. */
@Composable
internal fun EinsatzPunkte(anzahl: Int, aktiv: Int, modifier: Modifier = Modifier) {
    Box(modifier.size(((max(1, anzahl) - 1) * 17 + 7).dp, 7.dp)) {
        for (i in 0 until anzahl) {
            Box(
                Modifier.platz(i * 17f, 0f, 7f, 7f)
                    .background(EinsatzFarbe.lime.copy(alpha = if (i == aktiv) 1f else 0.25f), androidx.compose.foundation.shape.CircleShape)
            )
        }
    }
}

/** Grosser Pfeil (weiter_gross), gedreht wie in iOS. */
@Composable
internal fun GrosserPfeil(name: String = "weiter_gross", vor: Boolean = true, modifier: Modifier) {
    Box(modifier, contentAlignment = Alignment.Center) {
        Icon(name, Modifier.size(45.dp, 28.dp).rotate(if (vor) 180f else 0f), skalierung = ContentScale.FillBounds)
    }
}

internal val Float.pdp: Dp get() = this.dp
