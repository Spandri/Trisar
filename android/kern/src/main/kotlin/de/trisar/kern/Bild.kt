package de.trisar.kern

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import coil3.compose.AsyncImage
import coil3.request.ImageRequest
import coil3.svg.SvgDecoder

/**
 * Icon aus public/icon (Dateiname ohne .svg), wie Image("<name>") in iOS.
 * Liegt flach in assets/icon, weitere Bilder (Logos, Pfeil) in assets/bild.
 */
@Composable
fun Icon(name: String, modifier: Modifier = Modifier, farbe: ColorFilter? = null, skalierung: ContentScale = ContentScale.Fit) {
    val ctx = LocalContext.current
    val pfad = if (IconIndex.bilder(ctx).contains(name)) "bild/$name.svg" else "icon/$name.svg"
    AsyncImage(
        model = ImageRequest.Builder(ctx)
            .data("file:///android_asset/$pfad")
            .decoderFactory(SvgDecoder.Factory())
            .build(),
        contentDescription = null,
        modifier = modifier,
        contentScale = skalierung,
        colorFilter = farbe,
    )
}

private object IconIndex {
    @Volatile private var cache: Set<String>? = null
    fun bilder(ctx: android.content.Context): Set<String> =
        cache ?: (ctx.assets.list("bild")?.map { it.substringBeforeLast('.') }?.toSet() ?: emptySet()).also { cache = it }
}
