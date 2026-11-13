package de.trisar.kern

import android.content.Context
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.FilterQuality
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.intOrNull
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import kotlin.math.cos
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.sin
import kotlin.math.sqrt

/*
 * Unsichtbare Form eines Fahrzeugmodells fuer "Schaden melden", wie fahrzeugForm.js der Web-App und
 * FahrzeugForm.swift (werkzeuge/fahrzeugbilder/form-bauen.py). Aus den 36 Umrissen geschnittenes Volumen
 * plus Kamera des Drehtellers. Damit wird ein Tipp auf das Bild zu einem Punkt am Auto, und dieser Punkt
 * laesst sich in jeder Ansicht wiederfinden. Koordinaten in Metern (Massstab geschaetzt): x quer
 * (+ = links), y hoch, z (+ = vorne). Bildpunkte immer im Drehbild (satz.breite x satz.hoehe, 800 px breit).
 */

/** Kamera des Drehtellers und Raster der Form (Eintrag "form" eines Modells in fahrzeug-dreh.json) */
data class FormInfo(
    val s: Double, val d: Double, val phi: Double, val cx: Double, val cy: Double, val h0: Double,
    val o: List<Double>, val schritt: Double, val n: List<Int>, val grenzen: List<Double>, val laeufe: Int,
) {
    companion object {
        fun lesen(j: JSONObject?): FormInfo? = runCatching {
            if (j == null) return null
            val k = j.getJSONObject("kamera")
            fun zahlen(name: String) = j.getJSONArray(name).let { a -> List(a.length()) { a.getDouble(it) } }
            FormInfo(
                k.getDouble("s"), k.getDouble("D"), k.getDouble("phi"), k.getDouble("cx"), k.getDouble("cy"), k.getDouble("h0"),
                zahlen("o"), j.getDouble("schritt"), zahlen("n").map { it.toInt() }, zahlen("grenzen"), j.optInt("laeufe"),
            ).takeIf { it.o.size == 3 && it.n.size == 3 && it.grenzen.size == 6 }
        }.getOrNull()
    }
}

class FahrzeugForm private constructor(
    private val info: FormInfo,
    private val anfang: IntArray,
    private val anzahl: ByteArray,
    private val laeufe: IntArray,
) {
    private val nx = info.n[0]
    private val ny = info.n[1]
    private val nz = info.n[2]
    private val g = info.grenzen
    private val radius = sqrt(max(-g[0], g[1]).let { it * it } + max(-g[4], g[5]).let { it * it } + max(-g[2], g[3]).let { it * it }) + 0.1

    private fun belegt(x: Double, y: Double, z: Double): Boolean {
        val ix = floor((x - info.o[0]) / info.schritt).toInt()
        val iy = floor((y - info.o[1]) / info.schritt).toInt()
        val iz = floor((z - info.o[2]) / info.schritt).toInt()
        if (ix < 0 || iy < 0 || iz < 0 || ix >= nx || iy >= ny || iz >= nz) return false
        val c = ix * ny + iy
        var a = anfang[c]
        repeat(anzahl[c].toInt() and 0xFF) {
            if (iz >= laeufe[a] && iz < laeufe[a + 1]) return true
            a += 2
        }
        return false
    }

    /** Punkt am Auto -> (u, v, Tiefe) im Drehbild der Ansicht k */
    fun abbilden(p: DoubleArray, k: Int): Triple<Double, Double, Double> {
        val th = Math.toRadians(k * 10.0)
        val ph = Math.toRadians(info.phi)
        val x = p[0] * cos(th) + p[2] * sin(th)
        val z = -p[0] * sin(th) + p[2] * cos(th)
        val y = p[1] - info.h0
        val y2 = y * cos(ph) - z * sin(ph)
        val z2 = y * sin(ph) + z * cos(ph)
        val d = info.d - z2
        val f = info.s * info.d
        return Triple(info.cx + f * x / d, info.cy - f * y2 / d, d)
    }

    /** Strahl durch Bildpunkt (u, v) der Ansicht k: erster belegter Wuerfel (Punkt, Tiefe) oder null */
    private fun strahl(k: Int, u: Double, v: Double, bis: Double = info.d + radius): Pair<DoubleArray, Double>? {
        val th = Math.toRadians(k * 10.0)
        val ph = Math.toRadians(info.phi)
        val f = info.s * info.d
        val a = (u - info.cx) / f
        val b = (info.cy - v) / f
        var t = max(0.1, info.d - radius)
        while (t <= bis) {
            val xs = a * t
            val y2 = b * t
            val z2 = info.d - t
            val y = y2 * cos(ph) + z2 * sin(ph)
            val z = -y2 * sin(ph) + z2 * cos(ph)
            val px = xs * cos(th) - z * sin(th)
            val pz = xs * sin(th) + z * cos(th)
            val py = y + info.h0
            if (belegt(px, py, pz)) return doubleArrayOf(px, py, pz) to t
            t += info.schritt / 2
        }
        return null
    }

    /** Tipp auf (u, v) in Ansicht k -> Punkt am Auto oder null (daneben getippt) */
    fun treffen(k: Int, u: Double, v: Double): DoubleArray? = strahl(k, u, v)?.first

    /** Bildpunkt, wenn die Stelle in Ansicht k zu sehen ist, sonst null */
    fun sichtbar(p: DoubleArray, k: Int): Offset? {
        val (u, v, d) = abbilden(p, k)
        val r = strahl(k, u, v, d + 0.05) ?: return null
        return if (d - r.second < SICHT_TOLERANZ) Offset(u.toFloat(), v.toFloat()) else null
    }

    /** Richtung der Flaeche bei P (nach aussen, grob): vom Schwerpunkt der belegten Nachbarn weg */
    private fun normaleY(p: DoubleArray): Double {
        val s = info.schritt
        var nx0 = 0.0; var ny0 = 0.0; var nz0 = 0.0
        for (a in -3..3) for (b in -3..3) for (c in -3..3) {
            if (belegt(p[0] + a * s, p[1] + b * s, p[2] + c * s)) { nx0 -= a; ny0 -= b; nz0 -= c }
        }
        val l = sqrt(nx0 * nx0 + ny0 * ny0 + nz0 * nz0)
        return if (l > 0) ny0 / l else 0.0
    }

    /** Bereich wie im bisherigen Bericht: zeile front/seite/heck, seite links/mitte/rechts */
    fun bereich(p: DoubleArray): Pair<String, String> {
        val lang = g[5] - g[4]; val breit = g[1] - g[0]; val hoch = g[3] - g[2]; val mitte = (g[0] + g[1]) / 2
        val zeile = if (p[2] > g[5] - 0.22 * lang) "front" else if (p[2] < g[4] + 0.2 * lang) "heck" else "seite"
        var seite = if (p[0] - mitte > 0.18 * breit) "links" else if (p[0] - mitte < -0.18 * breit) "rechts" else "mitte"
        // Dach: Flaeche zeigt nach oben und liegt oben (Motorhaube und Heckklappe bleiben vorne/hinten)
        if (zeile == "seite" && p[1] > g[2] + 0.6 * hoch && normaleY(p) > 0.6) seite = "mitte"
        return zeile to seite
    }

    /** Lage auf der bisherigen Aufsicht (120 x 240, Front oben), damit alte Anzeigen weiter passen */
    fun aufsicht(p: DoubleArray): Offset {
        val x = 16 + 88 * (g[1] - p[0]) / (g[1] - g[0])
        val y = 4 + 232 * (g[5] - p[2]) / (g[5] - g[4])
        return Offset(((x * 10).roundToInt() / 10f), ((y * 10).roundToInt() / 10f))
    }

    companion object {
        /** Ist die Stelle aus dieser Ansicht zu sehen? Der Strahl dorthin darf hoechstens so viel vorher auf das Auto treffen. */
        private const val SICHT_TOLERANZ = 0.11

        /** null, wenn die Daten nicht zur Beschreibung passen (z. B. HTML-Fehlerseite statt Datei) */
        fun bauen(info: FormInfo, b: ByteArray): FahrzeugForm? {
            val nx = info.n[0]; val ny = info.n[1]
            val anfang = IntArray(nx * ny)
            val anzahl = ByteArray(nx * ny)
            val laeufe = IntArray(max(info.laeufe * 2, 0) + 2)
            var i = 0
            var l = 0
            var liste = laeufe
            for (c in 0 until nx * ny) {
                if (i >= b.size) return null
                val n = b[i].toInt() and 0xFF; i += 1
                if (i + n * 4 > b.size) return null
                anfang[c] = l; anzahl[c] = n.toByte()
                if (l + n * 2 > liste.size) liste = liste.copyOf(max(liste.size * 2, l + n * 2))
                repeat(n) {
                    liste[l] = (b[i].toInt() and 0xFF) or ((b[i + 1].toInt() and 0xFF) shl 8)
                    liste[l + 1] = (b[i + 2].toInt() and 0xFF) or ((b[i + 3].toInt() and 0xFF) shl 8)
                    l += 2; i += 4
                }
            }
            if (i != b.size) return null
            return FahrzeugForm(info, anfang, anzahl, liste)
        }

        /** Ansicht k (0 = von vorne, 9 = rechte Seite, 27 = linke Seite) -> Name */
        fun ansichtName(k: Int): String {
            val w = ((k * 10) % 360 + 360) % 360
            val namen = listOf(20 to "Vorne", 70 to "Vorne rechts", 110 to "Seite rechts", 160 to "Hinten rechts", 200 to "Hinten",
                250 to "Hinten links", 290 to "Seite links", 340 to "Vorne links", 360 to "Vorne")
            return namen.first { w < it.first }.second
        }
    }
}

/** Formen vom Server (fahrer.trisar.de/fahrzeug-dreh/<modell>-form.bin), als Datei und im Speicher gemerkt. */
object FormSpeicher {
    private val fertig = mutableMapOf<String, FahrzeugForm>()

    suspend fun form(ctx: Context, satz: DrehSatz): FahrzeugForm? = withContext(Dispatchers.IO) {
        val info = satz.form ?: return@withContext null
        synchronized(fertig) { fertig[satz.modell] }?.let { return@withContext it }
        val name = "${satz.modell}-form.bin"
        val datei = File(File(ctx.applicationContext.cacheDir, "fahrzeug-form").apply { mkdirs() }, name)
        // Datei zuerst, aber nur wenn sie zur aktuellen Beschreibung passt
        val ausDatei = runCatching { FahrzeugForm.bauen(info, datei.readBytes()) }.getOrNull()
        val form = ausDatei ?: runCatching {
            val v = URL(DrehInfo.SERVER + name).openConnection() as HttpURLConnection
            try {
                v.connectTimeout = 10_000
                v.readTimeout = 30_000
                if (v.responseCode != 200) return@runCatching null
                val daten = v.inputStream.use { it.readBytes() }
                FahrzeugForm.bauen(info, daten)?.also {
                    val tmp = File(datei.parentFile, "$name.tmp")
                    tmp.writeBytes(daten)
                    if (!tmp.renameTo(datei)) { datei.delete(); tmp.renameTo(datei) }
                }
            } finally {
                v.disconnect()
            }
        }.getOrNull()
        if (form != null) synchronized(fertig) { fertig[satz.modell] = form }
        form
    }
}

/** Wo das Drehbild (wie ContentScale.Fit) in einer Flaeche liegt */
fun drehBildRahmen(satz: DrehSatz, breite: Float, hoehe: Float): Rect {
    val a = satz.breite / satz.hoehe
    val w = min(breite, hoehe * a)
    val h = w / a
    return Rect(Offset((breite - w) / 2, (hoehe - h) / 2), androidx.compose.ui.geometry.Size(w, h))
}

/** Bild in den Rahmen zeichnen */
fun DrawScope.drehBildZeichnen(bild: ImageBitmap, r: Rect) {
    drawImage(bild, dstOffset = IntOffset(r.left.roundToInt(), r.top.roundToInt()),
        dstSize = IntSize(r.width.roundToInt(), r.height.roundToInt()), filterQuality = FilterQuality.High)
}

/** Markierung der Schadensstelle (roter Ring mit Punkt), wie im Web. Radien in px. */
fun DrawScope.schadenMarke(mitte: Offset, gross: Boolean = true) {
    val d = (if (gross) 30f else 18f) * density
    val rand = (if (gross) 3f else 2f) * density
    val rot = Color(0xFFFF2D2D)
    drawCircle(rot.copy(alpha = 0.25f), d / 2, mitte)
    drawCircle(rot, d / 2 - rand / 2, mitte, style = Stroke(rand))
    drawCircle(rot, 3f * density, mitte)
}

/** Stelle am drehbaren Auto markiert und gleiches Modell wie der Bildsatz des Fahrzeugs? */
fun stellePasst(stelle: JsonObject?, satz: DrehSatz?): Boolean {
    if (stelle == null || satz == null) return false
    val modell = (stelle["modell"] as? JsonPrimitive)?.content
    val ansicht = (stelle["ansicht"] as? JsonPrimitive)?.intOrNull
    val bild = stelle["bild"] as? JsonArray
    return modell == satz.modell && ansicht != null && bild?.size == 2
}

/**
 * Kleines Bild fuer den Schadensbericht (Fahrer und Dispo): das Auto in der Ansicht, in der markiert
 * wurde, mit Punkt. Nur nutzen, wenn stellePasst gilt.
 */
@Composable
fun StelleAnsicht(satz: DrehSatz, stelle: JsonObject, breite: Float = 150f, hoehe: Float = 70f, modifier: Modifier = Modifier) {
    val ctx = LocalContext.current
    val k = (stelle["ansicht"] as? JsonPrimitive)?.intOrNull ?: return
    val b = (stelle["bild"] as? JsonArray) ?: return
    val u = (b[0] as? JsonPrimitive)?.doubleOrNull ?: return
    val v = (b[1] as? JsonPrimitive)?.doubleOrNull ?: return
    var bild by remember(satz, k) { mutableStateOf<ImageBitmap?>(null) }
    LaunchedEffect(satz, k) { bild = DrehBilder.bild(ctx, satz.adresse(k)) }
    Box(modifier.size(breite.dp, hoehe.dp)) {
        Canvas(Modifier.size(breite.dp, hoehe.dp)) {
            val b0 = bild ?: return@Canvas
            val r = drehBildRahmen(satz, size.width, size.height)
            drehBildZeichnen(b0, r)
            schadenMarke(Offset(r.left + (u / satz.breite).toFloat() * r.width, r.top + (v / satz.hoehe).toFloat() * r.height), gross = false)
        }
    }
}
