package de.trisar.kern

import android.content.Context
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.MutableState
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
import coil3.ImageLoader
import coil3.disk.DiskCache
import coil3.memory.MemoryCache
import coil3.network.okhttp.OkHttpNetworkFetcherFactory
import coil3.request.ImageRequest
import coil3.request.allowHardware
import coil3.size.Size
import coil3.toBitmap
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okio.Path.Companion.toOkioPath
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.roundToInt

/*
 * 360-Grad-Ansicht des Fahrzeugs aus 36 Einzelbildern, wie FahrzeugDrehung.jsx der Web-App.
 * Katalog und Bilder liegen auf dem Server (fahrer.trisar.de/fahrzeug-dreh, erzeugt mit
 * werkzeuge/fahrzeugbilder), damit neue Modelle ohne App-Update dazukommen. Der Katalog wird als Datei
 * gemerkt, die Bilder im Festplatten-Cache von DrehBilder. assets/fahrzeug-dreh/fahrzeug-dreh.json
 * ist nur der Rueckfall fuer den allerersten Start ohne Netz.
 * Beim Oeffnen dreht sich das Auto einmal und bleibt schraeg vorne links stehen (Bild 32, eng
 * zugeschnitten wie das Standbild). Von Hand gedreht bleibt es dort, wo der Fahrer loslaesst.
 * Mit stehend: nur Bild 32 wie das Standbild (Startseiten-Karte), ohne Drehen und Wischen.
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
    class Lack(val code: String, val name: String, val hex: String)

    /** breite/hoehe/endbox je Modell, aeltere Kataloge haben nur die gemeinsamen Werte. */
    class Modell(
        val id: String,
        val marke: String,
        val name: String,
        val modell: List<String>,
        val farben: List<Pair<String, String>>,
        val lacke: List<String>,
        val lackliste: List<Lack>,
        val breite: Float,
        val hoehe: Float,
        val endbox: List<Float>,
        /** Unsichtbare Form fuer "Schaden melden" (FahrzeugForm), Volumen in <id>-form.bin */
        val form: FormInfo? = null,
    ) {
        /** Lack-Code zur Farbe (Freitext): erstes Farbwort, das vorkommt und dessen Code es als Bilder gibt. */
        fun lackZu(farbe: String): String? {
            val f = DrehSatz.glatt(farbe)
            if (f.isEmpty()) return null
            return farben.firstOrNull { f.contains(it.first) && it.second in lacke }?.second
        }
    }

    /** Modell zu brand_model (Freitext): das laengste passende Modellwort gewinnt ("sklasselang" vor "sklasse"). */
    fun modellZu(markeModell: String): Modell? {
        val m = DrehSatz.glatt(markeModell)
        if (m.isEmpty()) return null
        var treffer: Modell? = null
        var laenge = 0
        for (x in modelle) for (w in x.modell) if (w.length > laenge && m.contains(w)) { treffer = x; laenge = w.length }
        return treffer
    }

    companion object {
        /** Katalog und Bilder */
        const val SERVER = "https://fahrer.trisar.de/fahrzeug-dreh/"
        private const val DATEI = "fahrzeug-dreh.json"

        // Compose liest den Katalog ueber diesen Zustand und zeichnet neu, sobald er vom Server da ist.
        // Beim ersten Zugriff mit dem gemerkten Katalog angelegt (kein Schreiben waehrend des Zeichnens).
        @Volatile private var stand: MutableState<DrehInfo?>? = null
        @Volatile private var holtGerade = false
        @Volatile private var letzterVersuch = 0L
        @Volatile private var vomServer = false
        private val hintergrund = CoroutineScope(SupervisorJob() + Dispatchers.IO)

        /**
         * Aktueller Katalog: sofort der gemerkte (sonst der aus den Assets), im Hintergrund der vom Server.
         * In Compose gelesen, wird neu gerechnet, sobald der Serverkatalog da ist.
         */
        fun laden(ctx: Context): DrehInfo? {
            val app = ctx.applicationContext ?: ctx
            val z = stand ?: synchronized(this) {
                stand ?: mutableStateOf(
                    runCatching { lesen(cacheDatei(app).readText()) }.getOrNull()
                        ?: runCatching { lesen(app.assets.open("fahrzeug-dreh/$DATEI").bufferedReader().use { it.readText() }) }.getOrNull(),
                ).also { stand = it }
            }
            nachladen(app)
            return z.value
        }

        private fun cacheDatei(ctx: Context) = File(ctx.filesDir, DATEI)

        // Einmal je Start vom Server, nach Fehlern frühestens nach einer Minute wieder, sonst alle sechs Stunden.
        private fun nachladen(ctx: Context) {
            val jetzt = System.currentTimeMillis()
            val pause = if (vomServer) 6 * 3_600_000L else 60_000L
            if (holtGerade || (letzterVersuch != 0L && jetzt - letzterVersuch < pause)) return
            holtGerade = true
            letzterVersuch = jetzt
            hintergrund.launch {
                try {
                    val text = holen(SERVER + DATEI)
                    val neu = lesen(text) ?: return@launch
                    vomServer = true
                    // erst in eine Hilfsdatei, dann umbenennen: nie eine halbe Datei als Cache
                    runCatching {
                        val ziel = cacheDatei(ctx)
                        val tmp = File(ctx.filesDir, "$DATEI.tmp")
                        tmp.writeText(text)
                        if (!tmp.renameTo(ziel)) { ziel.delete(); tmp.renameTo(ziel) }
                    }
                    withContext(Dispatchers.Main) { stand?.value = neu }
                } catch (_: Throwable) {
                } finally {
                    holtGerade = false
                }
            }
        }

        private fun holen(adresse: String): String {
            val v = URL(adresse).openConnection() as HttpURLConnection
            try {
                v.connectTimeout = 10_000
                v.readTimeout = 15_000
                v.useCaches = false
                if (v.responseCode != 200) error("HTTP ${v.responseCode}")
                return v.inputStream.bufferedReader().use { it.readText() }
            } finally {
                v.disconnect()
            }
        }

        /** Liest den Katalog, alt (gemeinsame Geometrie, Zahlen als Lack-Code) und neu. Unbrauchbar: null. */
        private fun lesen(text: String): DrehInfo? = runCatching {
            val j = JSONObject(text)
            fun liste(a: JSONArray?) = if (a == null) emptyList() else List(a.length()) { a.getString(it) }
            fun box(a: JSONArray?) = if (a == null || a.length() < 4) null else List(4) { a.getDouble(it).toFloat() }
            val breite = j.getDouble("breite").toFloat()
            val hoehe = j.getDouble("hoehe").toFloat()
            val endbox = box(j.optJSONArray("endbox")) ?: listOf(0f, 0f, breite, hoehe)
            val modelle = j.getJSONArray("modelle")
            val info = DrehInfo(
                bilder = j.getInt("bilder"),
                start = j.getInt("start"),
                breite = breite,
                hoehe = hoehe,
                endbox = endbox,
                modelle = List(modelle.length()) { i ->
                    val m = modelle.getJSONObject(i)
                    val f = m.getJSONArray("farben")
                    val l = m.optJSONArray("lackliste")
                    Modell(
                        id = m.getString("id"),
                        marke = m.optString("marke"),
                        name = m.optString("name", m.getString("id")),
                        modell = liste(m.getJSONArray("modell")),
                        farben = List(f.length()) { k -> f.getJSONArray(k).let { it.getString(0) to it.getString(1) } },
                        lacke = liste(m.optJSONArray("lacke")),
                        lackliste = if (l == null) emptyList() else List(l.length()) { k ->
                            l.getJSONObject(k).let { Lack(it.getString("code"), it.optString("name", it.getString("code")), it.optString("hex", "#000000")) }
                        },
                        breite = m.optDouble("breite", breite.toDouble()).toFloat(),
                        hoehe = m.optDouble("hoehe", hoehe.toDouble()).toFloat(),
                        endbox = box(m.optJSONArray("endbox")) ?: endbox,
                        form = FormInfo.lesen(m.optJSONObject("form")),
                    )
                },
            )
            info.takeIf { it.bilder > 0 && it.modelle.isNotEmpty() }
        }.getOrNull()
    }
}

/** Bilder vom Server mit eigenem Festplatten-Cache (cacheDir/fahrzeug-dreh), getrennt von den anderen Bildern. */
object DrehBilder {
    @Volatile private var lader: ImageLoader? = null

    fun lader(ctx: Context): ImageLoader = lader ?: synchronized(this) {
        lader ?: run {
            val app = ctx.applicationContext ?: ctx
            ImageLoader.Builder(app)
                .components { add(OkHttpNetworkFetcherFactory()) }
                .diskCache { DiskCache.Builder().directory(File(app.cacheDir, "fahrzeug-dreh").toOkioPath()).maxSizeBytes(250L * 1024 * 1024).build() }
                .memoryCache { MemoryCache.Builder().maxSizePercent(app, 0.15).build() }
                .build()
                .also { lader = it }
        }
    }

    /** Ein Bild in Originalgroesse als Software-Bitmap (zum Zeichnen auf dem Canvas), null bei Fehler. */
    suspend fun bild(ctx: Context, adresse: String): ImageBitmap? = runCatching {
        val anfrage = ImageRequest.Builder(ctx).data(adresse).size(Size.ORIGINAL).allowHardware(false).build()
        lader(ctx).execute(anfrage).image?.toBitmap()?.asImageBitmap()
    }.getOrNull()
}

/** Passender Bildsatz zu brand_model und color (Freitext), mit der Bildgeometrie des Modells. */
data class DrehSatz(
    val modell: String,
    val lack: String,
    val bilder: Int,
    val start: Int,
    val breite: Float,
    val hoehe: Float,
    val endbox: List<Float>,
    val form: FormInfo? = null,
) {
    fun datei(i: Int) = "$modell-$lack-${i.toString().padStart(2, '0')}.webp"
    fun adresse(i: Int) = DrehInfo.SERVER + datei(i)

    companion object {
        /** klein, Umlaute ausgeschrieben, nur Buchstaben und Ziffern: "V-Klasse 250 d" -> "vklasse250d" */
        fun glatt(s: String) = s.lowercase()
            .replace("ä", "ae").replace("ö", "oe").replace("ü", "ue").replace("ß", "ss")
            .filter { it in 'a'..'z' || it in '0'..'9' }

        /** In Compose aufgerufen: rechnet neu, sobald der Katalog vom Server da ist. */
        fun finden(ctx: Context, modell: String, farbe: String): DrehSatz? = finden(DrehInfo.laden(ctx), modell, farbe)

        fun finden(info: DrehInfo?, modell: String, farbe: String): DrehSatz? {
            if (info == null) return null
            val m = info.modellZu(modell) ?: return null
            val lack = m.lackZu(farbe) ?: return null
            return DrehSatz(m.id, lack, info.bilder, info.start, m.breite, m.hoehe, m.endbox, m.form)
        }
    }
}

@Composable
fun FahrzeugDrehung(satz: DrehSatz, modifier: Modifier = Modifier, stehend: Boolean = false) {
    val ctx = LocalContext.current
    val n = satz.bilder
    var bilder by remember(satz) { mutableStateOf<List<ImageBitmap>>(emptyList()) }
    var pos by remember(satz) { mutableFloatStateOf(satz.start.toFloat()) }
    val scope = rememberCoroutineScope()
    var drehJob by remember { mutableStateOf<Job?>(null) }

    // einmal ganz herum und in der Endstellung aufhoeren
    fun drehen() {
        drehJob?.cancel()
        val von = pos
        val r = von.roundToInt()
        val nach = (r + (((satz.start - r) % n) + n) % n + n).toFloat()
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

    LaunchedEffect(satz, stehend) {
        if (stehend) {
            // nur das Standbild, keine Drehung
            DrehBilder.bild(ctx, satz.adresse(satz.start))?.let { b -> bilder = List(n) { b } }
            return@LaunchedEffect
        }
        // erst alle Bilder (parallel) laden, dann einmal drehen (sonst ruckelt die erste Runde)
        val geladen = coroutineScope { (0 until n).map { i -> async { DrehBilder.bild(ctx, satz.adresse(i)) } }.awaitAll() }
        if (geladen.all { it != null }) {
            bilder = geladen.map { it!! }
            drehen()
        } else geladen[satz.start]?.let { b ->
            // ohne Netz und nicht alles im Cache: wenigstens die Endstellung zeigen
            bilder = List(n) { b }
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
        val b = satz.endbox
        val bw = b[2] - b[0]
        val bh = b[3] - b[1]
        // Endstellung: Bild 32 fuellt die Flaeche. Beim Drehen herauszoomen, damit Seite und Heck ganz zu sehen sind.
        val sE = min(w / bw, h / bh)
        val xE = (w - bw * sE) / 2f - b[0] * sE
        val yE = (h - bh * sE) / 2f - b[1] * sE
        val sA = min(w / satz.breite, h / satz.hoehe)
        val xA = (w - satz.breite * sA) / 2f
        val yA = (h - satz.hoehe * sA) / 2f
        val d = (((pos - satz.start) % n) + n) % n
        var g = min(min(d, n - d) / 4f, 1f)
        g = g * g * (3f - 2f * g)
        val s = sE + (sA - sE) * g
        drawImage(
            image = bilder[f],
            dstOffset = IntOffset((xE + (xA - xE) * g).roundToInt(), (yE + (yA - yE) * g).roundToInt()),
            dstSize = IntSize((satz.breite * s).roundToInt(), (satz.hoehe * s).roundToInt()),
            filterQuality = FilterQuality.High,
        )
    }
}
