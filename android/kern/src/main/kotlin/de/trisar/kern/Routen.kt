package de.trisar.kern

import android.content.Context
import android.location.Location
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.double
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import kotlin.math.ceil
import kotlin.math.roundToInt

/** Ort auf der Karte (Breite, Laenge). */
data class GeoPunkt(val lat: Double, val lng: Double)

/**
 * Adressen und Strecken wie in der Web-App (shared/karte/maplibreKarte.js) und Routen.swift:
 * Adresse -> Koordinate ueber Nominatim, Strecke ueber den oeffentlichen OSRM-Dienst.
 * Beides wird auf dem Geraet gemerkt, damit nicht jede Ansicht neu anfragt.
 */
object Routen {
    data class Strecke(
        val punkte: List<GeoPunkt>,
        val sekunden: Int,
        val meter: Int,
        /** Routendienst nicht erreichbar: Luftlinie mit Schaetzung (wie notErgebnis im Web). */
        val notloesung: Boolean = false,
    ) {
        val minuten: Int get() = ceil(sekunden / 60.0).toInt()
    }

    private const val OSRM = "https://router.project-osrm.org/route/v1/driving/"
    private const val SPEICHER = "trisar-routen"
    private const val ORTE = "trisar-orte"
    private const val STRECKEN = "trisar-routen-v1"

    private var orte: MutableMap<String, GeoPunkt>? = null
    private var strecken: JsonObject? = null
    private val laufend = mutableMapOf<String, CompletableDeferred<GeoPunkt?>>()

    private fun prefs(ctx: Context) = ctx.applicationContext.getSharedPreferences(SPEICHER, Context.MODE_PRIVATE)

    private fun orteLaden(ctx: Context): MutableMap<String, GeoPunkt> = orte ?: run {
        val roh = prefs(ctx).getString(ORTE, null)
        val m = mutableMapOf<String, GeoPunkt>()
        runCatching {
            Backend.json.parseToJsonElement(roh ?: "{}").jsonObject.forEach { (k, v) ->
                val a = v.jsonArray
                if (a.size == 2) m[k] = GeoPunkt(a[0].jsonPrimitive.double, a[1].jsonPrimitive.double)
            }
        }
        m.also { orte = it }
    }

    // MARK: Adresse -> Punkt

    suspend fun punkt(ctx: Context, text: String): GeoPunkt? {
        val schluessel = text.trim().lowercase().replace(Regex("\\s+"), " ")
        if (schluessel.isEmpty()) return null
        val gemerkt = orteLaden(ctx)
        gemerkt[schluessel]?.let { return it }
        laufend[schluessel]?.let { return it.await() }
        val lauf = CompletableDeferred<GeoPunkt?>()
        laufend[schluessel] = lauf
        val ergebnis = withContext(Dispatchers.IO) {
            runCatching {
                val url = "https://nominatim.openstreetmap.org/search?format=json&limit=1&q=" + URLEncoder.encode(text, "UTF-8")
                val antwort = holen(url, mapOf("Accept" to "application/json", "User-Agent" to "TRISAR-Fahrer-Android/0.1")) ?: return@runCatching null
                val erster = Backend.json.parseToJsonElement(antwort).jsonArray.firstOrNull()?.jsonObject ?: return@runCatching null
                val lat = erster["lat"]?.jsonPrimitive?.content?.toDoubleOrNull()
                val lng = erster["lon"]?.jsonPrimitive?.content?.toDoubleOrNull()
                if (lat != null && lng != null) GeoPunkt(lat, lng) else null
            }.getOrNull()
        }
        laufend.remove(schluessel)
        lauf.complete(ergebnis)
        if (ergebnis != null) {
            gemerkt[schluessel] = ergebnis
            val json = buildJsonObject {
                gemerkt.forEach { (k, p) -> put(k, buildJsonArray { add(JsonPrimitive(p.lat)); add(JsonPrimitive(p.lng)) }) }
            }
            prefs(ctx).edit().putString(ORTE, json.toString()).apply()
        }
        return ergebnis
    }

    // MARK: Strecke

    suspend fun strecke(ctx: Context, von: GeoPunkt, bis: GeoPunkt): Strecke {
        val adresse = "$OSRM${von.lng},${von.lat};${bis.lng},${bis.lat}?overview=full&geometries=geojson&alternatives=false&steps=false"
        val speicher = strecken ?: runCatching { Backend.json.parseToJsonElement(prefs(ctx).getString(STRECKEN, null) ?: "{}").jsonObject }
            .getOrDefault(JsonObject(emptyMap())).also { strecken = it }
        speicher[adresse]?.let { e ->
            runCatching {
                val o = e.jsonObject
                val k = o["k"]!!.jsonArray.map { val p = it.jsonArray; GeoPunkt(p[1].jsonPrimitive.double, p[0].jsonPrimitive.double) }
                if (k.size >= 2) return Strecke(k, o["s"]?.jsonPrimitive?.int ?: 0, o["m"]?.jsonPrimitive?.int ?: 0)
            }
        }
        val neu = withContext(Dispatchers.IO) {
            runCatching {
                val antwort = holen(adresse, mapOf("Accept" to "application/json")) ?: return@runCatching null
                val route = Backend.json.parseToJsonElement(antwort).jsonObject["routes"]?.jsonArray?.firstOrNull()?.jsonObject ?: return@runCatching null
                val koords = route["geometry"]!!.jsonObject["coordinates"]!!.jsonArray
                if (koords.size < 2) return@runCatching null
                Triple(koords, route["duration"]!!.jsonPrimitive.double.roundToInt(), route["distance"]!!.jsonPrimitive.double.roundToInt())
            }.getOrNull()
        }
        if (neu != null) {
            val (koords, sekunden, meter) = neu
            val eintrag = buildJsonObject { put("k", koords); put("s", sekunden); put("m", meter) }
            val m = speicher.toMutableMap()
            m[adresse] = eintrag
            if (m.size > 250) m.remove(m.keys.first())
            val gesamt = JsonObject(m)
            strecken = gesamt
            prefs(ctx).edit().putString(STRECKEN, gesamt.toString()).apply()
            return Strecke(koords.map { val p = it.jsonArray; GeoPunkt(p[1].jsonPrimitive.double, p[0].jsonPrimitive.double) }, sekunden, meter)
        }
        // Luftlinie, 45 km/h Schnitt (80 s je km) wie im Web.
        val meter = abstand(von, bis)
        return Strecke(listOf(von, bis), ((meter / 1000) * 80).toInt(), meter.toInt(), notloesung = true)
    }

    /**
     * Anfahrt ab Fahrer kuerzen (anfahrtAbFahrer): naechster Punkt auf dem Pfad, Rest ab dort.
     * Mehr als 200 m daneben = abseits, dann neu rechnen.
     */
    fun abFahrer(pfad: List<GeoPunkt>, fahrer: GeoPunkt, toleranz: Double = 200.0): Pair<Boolean, List<GeoPunkt>?> {
        if (pfad.isEmpty()) return false to null
        var bester = 0
        var besterAbstand = Double.MAX_VALUE
        pfad.forEachIndexed { i, p ->
            val d = abstand(fahrer, p)
            if (d < besterAbstand) { besterAbstand = d; bester = i }
        }
        if (besterAbstand > toleranz) return true to null
        return false to (listOf(fahrer) + pfad.drop(bester + 1))
    }

    fun abstand(a: GeoPunkt, b: GeoPunkt): Double {
        val r = FloatArray(1)
        Location.distanceBetween(a.lat, a.lng, b.lat, b.lng, r)
        return r[0].toDouble()
    }

    private fun holen(adresse: String, kopf: Map<String, String>): String? {
        val v = URL(adresse).openConnection() as HttpURLConnection
        return try {
            v.connectTimeout = 15_000
            v.readTimeout = 20_000
            kopf.forEach { (k, w) -> v.setRequestProperty(k, w) }
            if (v.responseCode != 200) null else v.inputStream.bufferedReader().use { it.readText() }
        } finally {
            v.disconnect()
        }
    }
}
