package de.trisar.fahrer.haupt

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.unit.dp
import de.trisar.kern.CssRadial
import de.trisar.kern.TrisarHintergrund
import kotlin.math.max

/**
 * Wie Leinwand in iOS: festes Web-Raster (402 breit, Basis 874 hoch), absolut positionierte
 * Kinder mit Modifier.platz. Ist der Inhalt hoeher als der Bildschirm, wird gescrollt.
 * Der Inhalt beginnt an der Bildschirmkante (unter der Statusleiste), wie im Web.
 * rahmen = sichtbare Hoehe im Raster (mindestens basisHoehe).
 */
@Composable
internal fun Leinwand(
    breite: Float = 402f,
    basisHoehe: Float = 874f,
    inhaltHoehe: Float = 0f,
    mitHintergrund: Boolean = true,
    inhalt: @Composable BoxScope.(rahmen: Float) -> Unit,
) {
    BoxWithConstraints(Modifier.fillMaxSize()) {
        val rahmen = max(basisHoehe, maxHeight.value)
        val hoehe = max(rahmen, inhaltHoehe)
        if (mitHintergrund) TrisarHintergrund()
        // imePadding: bei offener Tastatur bleibt alles erreichbar (scrollt dann).
        Box(Modifier.fillMaxSize().imePadding().verticalScroll(rememberScrollState())) {
            Box(Modifier.fillMaxWidth().height(hoehe.dp), contentAlignment = Alignment.TopCenter) {
                Box(Modifier.width(breite.dp).height(hoehe.dp)) { inhalt(rahmen) }
            }
        }
    }
}

/** Vollbild-Seite ueber der Hauptansicht: schwarz und schluckt alle Tipps, damit nichts darunter reagiert. */
@Composable
internal fun Vollbild(inhalt: @Composable () -> Unit) {
    Box(Modifier.fillMaxSize().background(Color.Black).pointerInput(Unit) {
        awaitPointerEventScope { while (true) { awaitPointerEvent() } }
    }) { inhalt() }
}

/** radial-gradient(141.42% 102.21% at 0% 0%, #313701 0%, #000 46%) wie in Profil und Verlauf. */
@Composable
internal fun ProfilHintergrund(modifier: Modifier = Modifier.fillMaxSize()) {
    CssRadial(1.4142f, 1.0221f, listOf(0x313701L to 0f, 0x000000L to 0.46f, 0x000000L to 1f), modifier)
}
