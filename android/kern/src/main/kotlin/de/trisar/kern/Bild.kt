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
    val pfad = IconIndex.pfad(ctx, name)
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

/**
 * Sucht ein Bild in assets/bild und assets/icon. iOS-Asset-Namen sind ohne Gross-/Kleinschreibung,
 * Android-Assets nicht. Darum zuerst exakt, dann ohne Gross-/Kleinschreibung.
 */
private object IconIndex {
    @Volatile private var cache: Map<String, String>? = null

    private fun index(ctx: android.content.Context): Map<String, String> = cache ?: run {
        val m = HashMap<String, String>()
        for (ordner in listOf("icon", "bild")) {
            ctx.assets.list(ordner)?.forEach { datei ->
                if (datei.endsWith(".svg")) {
                    val name = datei.substringBeforeLast('.')
                    m["$ordner/$name"] = "$ordner/$datei"
                    m.putIfAbsent(name, "$ordner/$datei")
                    m.putIfAbsent(name.lowercase(), "$ordner/$datei")
                }
            }
        }
        m.also { cache = it }
    }

    fun pfad(ctx: android.content.Context, name: String): String {
        val i = index(ctx)
        return i["bild/$name"] ?: i["icon/$name"] ?: i[name.lowercase()] ?: "icon/$name.svg"
    }
}
