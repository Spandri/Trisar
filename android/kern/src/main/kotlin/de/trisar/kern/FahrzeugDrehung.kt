package de.trisar.kern

import android.content.Context
import android.graphics.BitmapFactory
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.graphics.FilterQuality
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntSize
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.roundToInt

/*
 * 360-Grad-Ansicht des Fahrzeugs aus 36 Einzelbildern (assets/fahrzeug-dreh, erzeugt mit
 * werkzeuge/fahrzeugbilder/dreh-einbauen.py), wie FahrzeugDrehung.jsx der Web-App.
 * Beim Oeffnen dreht sich das Auto einmal und bleibt schraeg vorne links stehen (Bild 32, eng
 * zugeschnitten wie das Standbild). Von Hand gedreht bleibt es dort, wo der Fahrer loslaesst.
 * Mit stehend: nur Bild 32 wie das Standbild (Startseiten-Karte), ohne Drehen und Wischen.
 * Bilder liegen nur in der Fahrer-App (assets), die Dispo hat nur die Liste: dort findet finden() nichts.
 */

/** Inhalt von fahrzeug-dreh.json */
class DrehInfo(
    val bilder: Int,
    val start: Int,
    val breite: Float,
    val hoehe: Float,
    val endbox: List<Float>,
    val modelle: List<Modell>,
) {
    class Modell(val id: String, val modell: List<String>, val farben: List<Pair<String, String>>, val lacke: List<String>)

    companion object {
        @Volatile private var geladen: DrehInfo? = null
        @Volatile private var versucht = false
        @Volatile private var dateien: Set<String> = emptySet()

        /** Gibt es das Bild in den Assets? (Dispo: nein) */
        fun hatBild(ctx: Context, datei: String): Boolean {
            laden(ctx)
            return datei.removePrefix("fahrzeug-dreh/") in dateien
        }

        fun laden(ctx: Context): DrehInfo? {
            if (versucht) return geladen
            versucht = true
            dateien = runCatching { ctx.assets.list("fahrzeug-dreh")?.toSet() }.getOrNull() ?: emptySet()
            geladen = runCatching {
                val j = JSONObject(ctx.assets.open("fahrzeug-dreh/fahrzeug-dreh.json").bufferedReader().use { it.readText() })
                fun liste(a: org.json.JSONArray) = List(a.length()) { a.getString(it) }
                val box = j.getJSONArray("endbox")
                val modelle = j.getJSONArray("modelle")
                DrehInfo(
                    bilder = j.getInt("bilder"),
                    start = j.getInt("start"),
                    breite = j.getDouble("breite").toFloat(),
                    hoehe = j.getDouble("hoehe").toFloat(),
                    endbox = List(box.length()) { box.getDouble(it).toFloat() },
                    modelle = List(modelle.length()) { i ->
                        val m = modelle.getJSONObject(i)
                        val f = m.getJSONArray("farben")
                        Modell(
                            id = m.getString("id"),
                            modell = liste(m.getJSONArray("modell")),
                            farben = List(f.length()) { k -> f.getJSONArray(k).let { it.getString(0) to it.getString(1) } },
                            lacke = liste(m.getJSONArray("lacke")),
                        )
                    },
                )
            }.getOrNull()
            return geladen
        }
    }
}

/** Passender Bildsatz zu brand_model und color (Freitext). */
data class DrehSatz(val modell: String, val lack: String) {
    fun datei(i: Int) = "fahrzeug-dreh/$modell-$lack-${i.toString().padStart(2, '0')}.webp"

    companion object {
        /** klein, Umlaute ausgeschrieben, nur Buchstaben und Ziffern: "V-Klasse 250 d" -> "vklasse250d" */
        fun glatt(s: String) = s.lowercase()
            .replace("ä", "ae").replace("ö", "oe").replace("ü", "ue").replace("ß", "ss")
            .filter { it in 'a'..'z' || it in '0'..'9' }

        fun finden(ctx: Context, modell: String, farbe: String): DrehSatz? {
            val info = DrehInfo.laden(ctx) ?: return null
            val m = glatt(modell)
            val f = glatt(farbe)
            if (m.isEmpty() || f.isEmpty()) return null
            for (satz in info.modelle) {
                if (satz.modell.none { m.contains(it) }) continue
                val treffer = satz.farben.firstOrNull { f.contains(it.first) } ?: continue
                if (treffer.second !in satz.lacke) continue
                val gefunden = DrehSatz(satz.id, treffer.second)
                return if (DrehInfo.hatBild(ctx, gefunden.datei(info.start))) gefunden else null
            }
            return null
        }
    }
}

@Composable
fun FahrzeugDrehung(satz: DrehSatz, modifier: Modifier = Modifier, stehend: Boolean = false) {
    val ctx = LocalContext.current
    val info = remember { DrehInfo.laden(ctx) } ?: return
    val n = info.bilder
    var bilder by remember(satz) { mutableStateOf<List<ImageBitmap>>(emptyList()) }
    var pos by remember(satz) { mutableFloatStateOf(info.start.toFloat()) }
    val scope = rememberCoroutineScope()
    var drehJob by remember { mutableStateOf<Job?>(null) }

    // einmal ganz herum und in der Endstellung aufhoeren
    fun drehen() {
        drehJob?.cancel()
        val von = pos
        val r = von.roundToInt()
        val nach = (r + (((info.start - r) % n) + n) % n + n).toFloat()
        drehJob = scope.launch {
            val t0 = withFrameNanos { it }
            while (true) {
                val t = withFrameNanos { it }
                val q = min((t - t0) / 1_700_000_000f, 1f)
                val e = 1f - (1f - q).pow(3)
                pos = von + (nach - von) * e
                if (q >= 1f) break
            }
        }
    }

    LaunchedEffect(satz) {
        // erst alle Bilder laden, dann einmal drehen (sonst ruckelt die erste Runde)
        fun bild(i: Int) = runCatching { ctx.assets.open(satz.datei(i)).use { BitmapFactory.decodeStream(it)?.asImageBitmap() } }.getOrNull()
        if (stehend) {
            // nur das Standbild, keine Drehung
            withContext(Dispatchers.IO) { bild(info.start) }?.let { b -> bilder = List(n) { b } }
            return@LaunchedEffect
        }
        val geladen = withContext(Dispatchers.IO) { (0 until n).mapNotNull { bild(it) } }
        if (geladen.size == n) {
            bilder = geladen
            drehen()
        }
    }

    Canvas(
        modifier
            .clipToBounds()
            .pointerInput(satz, stehend) {
                if (stehend) return@pointerInput
                var start = 0f
                var weg = 0f
                detectHorizontalDragGestures(
                    onDragStart = { drehJob?.cancel(); start = pos; weg = 0f },
                    // von Hand gedreht: bleibt stehen, wo der Fahrer loslaesst
                    onDragEnd = { pos = pos.roundToInt().toFloat() },
                    onDragCancel = { pos = pos.roundToInt().toFloat() },
                ) { aenderung, dx ->
                    aenderung.consume()
                    weg += dx / density
                    pos = start + weg / 9f
                }
            },
    ) {
        if (bilder.size != n) return@Canvas
        val f = ((pos.roundToInt() % n) + n) % n
        val w = size.width
        val h = size.height
        val b = info.endbox
        val bw = b[2] - b[0]
        val bh = b[3] - b[1]
        // Endstellung: Bild 32 fuellt die Flaeche. Beim Drehen herauszoomen, damit Seite und Heck ganz zu sehen sind.
        val sE = min(w / bw, h / bh)
        val xE = (w - bw * sE) / 2f - b[0] * sE
        val yE = (h - bh * sE) / 2f - b[1] * sE
        val sA = min(w / info.breite, h / info.hoehe)
        val xA = (w - info.breite * sA) / 2f
        val yA = (h - info.hoehe * sA) / 2f
        val d = (((pos - info.start) % n) + n) % n
        var g = min(min(d, n - d) / 4f, 1f)
        g = g * g * (3f - 2f * g)
        val s = sE + (sA - sE) * g
        drawImage(
            image = bilder[f],
            dstOffset = IntOffset((xE + (xA - xE) * g).roundToInt(), (yE + (yA - yE) * g).roundToInt()),
            dstSize = IntSize((info.breite * s).roundToInt(), (info.hoehe * s).roundToInt()),
            filterQuality = FilterQuality.High,
        )
    }
}
