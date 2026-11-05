package de.trisar.kern

import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.height
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp

/** Breite des Web-Rasters. Alle Masse aus dem Web (left/top/width/height) gelten in dp 1:1. */
const val RASTER_BREITE = 402f

/**
 * Ganze App auf die Breite des Handys skalieren, wie WebMassstab in iOS:
 * 1 dp = Bildschirmbreite / 402. Damit sieht jedes Android-Handy gleich aus, nur groesser
 * oder kleiner. Schrift skaliert mit (fontScale 1, Systemschriftgroesse wird ignoriert, wie im Web).
 * Raender (Statusleiste, Navigationsleiste, Tastatur) bleiben in Pixeln und passen damit von selbst.
 */
@Composable
fun WebMassstab(inhalt: @Composable () -> Unit) {
    BoxWithConstraints {
        val dichte = LocalDensity.current
        val breitePx = with(dichte) { maxWidth.toPx() }
        val neu = Density(density = breitePx / RASTER_BREITE, fontScale = 1f)
        // Kein Nachfedern/Leuchten am Listenende, wie overscroll-none im Web.
        @OptIn(androidx.compose.foundation.ExperimentalFoundationApi::class)
        CompositionLocalProvider(
            LocalDensity provides neu,
            androidx.compose.foundation.LocalOverscrollConfiguration provides null,
        ) { inhalt() }
    }
}

/** `position: absolute; left: x; top: y; width: w; height: h` im 402er Raster. */
fun Modifier.platz(x: Float, y: Float, w: Float? = null, h: Float? = null): Modifier {
    var m = this.offset(x.dp, y.dp)
    if (w != null && h != null) m = m.size(w.dp, h.dp)
    else if (w != null) m = m.width(w.dp)
    else if (h != null) m = m.height(h.dp)
    return m
}

/** Wie `left: 50%; translateX(-50%)` bei Mitte x. */
fun Modifier.mittig(mitteX: Float, y: Float, w: Float, h: Float? = null): Modifier =
    platz(mitteX - w / 2f, y, w, h)
