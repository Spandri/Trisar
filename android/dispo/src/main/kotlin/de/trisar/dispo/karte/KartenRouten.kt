package de.trisar.dispo.karte

import android.content.Context
import android.content.SharedPreferences
import android.location.Location
import de.trisar.kern.Backend
import de.trisar.kern.Routen
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import kotlin.math.roundToInt

/**
 * Adressen und Strecken wie in der Web-App (shared/karte/maplibreKarte.js), wie Routen.swift:
 * Adresse -> Koordinate ueber Nominatim, Strecke ueber den oeffentlichen OSRM-Dienst.
 * Beides wird auf dem Geraet gemerkt, damit nicht jede Ansicht neu anfragt.
 */
internal object DispoRouten {
    data class Strecke(val punkte: List<KartenPunkt>, val sekunden: Int, val meter: Int, val notloesung: Boolean = false)

    private const val OSRM = "https://router.project-osrm.org/route/v1/driving/"
    private var ablage: SharedPreferences? = null
    private val orte = HashMap<String, KartenPunkt>()
    private var strecken: MutableMap<String, JsonObject> = LinkedHashMap()
    private val laufend = HashMap<String, CompletableDeferred<KartenPunkt?>>()

    fun vorbereiten(ctx: Context) {
        if (ablage != null) return
        val a = ctx.applicationContext.getSharedPreferences("trisar-dispo-routen", Context.MODE_PRIVATE)
        ablage = a
        runCatching {
            Backend.json.parseToJsonElement(a.getString("trisar-orte", "{}") ?: "{}").jsonObject.forEach { (k, v) ->
                val l = v.jsonArray
                orte[k] = KartenPunkt(l[0].jsonPrimitive.doubleOrNull ?: 0.0, l[1].jsonPrimitive.doubleOrNull ?: 0.0)
            }
        }
        runCatching {
            strecken = LinkedHashMap(Backend.json.parseToJsonElement(a.getString("trisar-routen-v1", "{}") ?: "{}").jsonObject
                .mapValues { it.value.jsonObject })
        }
    }

    private fun orteMerken() {
        val o = buildJsonObject {
            orte.forEach { (k, p) -> put(k, buildJsonArray { add(kotlinx.serialization.json.JsonPrimitive(p.lat)); add(kotlinx.serialization.json.JsonPrimitive(p.lng)) }) }
        }
        ablage?.edit()?.putString("trisar-orte", o.toString())?.apply()
    }

    private suspend fun holen(adresse: String): Pair<Int, String>? = withContext(Dispatchers.IO) {
        runCatching {
            val v = URL(adresse).openConnection() as HttpURLConnection
            v.connectTimeout = 15_000; v.readTimeout = 20_000
            v.setRequestProperty("Accept", "application/json")
            // Nominatim verlangt eine Kennung der App.
            v.setRequestProperty("User-Agent", "TRISAR-Dispo-Android/0.1")
            val code = v.responseCode
            val text = (if (code in 200..299) v.inputStream else v.errorStream)?.bufferedReader()?.readText() ?: ""
            v.disconnect()
            code to text
        }.getOrNull()
    }

    // MARK: Adresse -> Punkt

    suspend fun punkt(text: String): KartenPunkt? {
        val schluessel = text.trim().lowercase().replace(Regex("\\s+"), " ")
        if (schluessel.isEmpty()) return null
        orte[schluessel]?.let { return it }
        if (Routen.fehltrefferAktiv(schluessel)) return null
        laufend[schluessel]?.let { return it.await() }
        val lauf = CompletableDeferred<KartenPunkt?>()
        laufend[schluessel] = lauf
        // Erst der ganze Text, dann ohne das erste Stueck (Ortsname vorne).
        var ergebnis: KartenPunkt? = null
        for (suche in Routen.suchTexte(text)) {
            val adresse = "https://nominatim.openstreetmap.org/search?format=json&countrycodes=de,at,ch&limit=1&q=" + URLEncoder.encode(suche, "UTF-8")
            ergebnis = holen(adresse)?.let { (code, inhalt) ->
                if (code != 200) return@let null
                runCatching {
                    val erster = (Backend.json.parseToJsonElement(inhalt) as JsonArray).firstOrNull()?.jsonObject ?: return@runCatching null
                    val lat = erster["lat"]?.jsonPrimitive?.content?.toDoubleOrNull()
                    val lng = erster["lon"]?.jsonPrimitive?.content?.toDoubleOrNull()
                    if (lat != null && lng != null) KartenPunkt(lat, lng) else null
                }.getOrNull()
            }
            if (ergebnis != null) break
        }
        laufend.remove(schluessel)
        lauf.complete(ergebnis)
        Routen.fehltrefferMerken(schluessel, ergebnis != null)
        if (ergebnis != null) {
            orte[schluessel] = ergebnis
            orteMerken()
        }
        return ergebnis
    }

    // MARK: Strecke

    private fun ausEintrag(e: JsonObject): Strecke? {
        val k = e["k"]?.jsonArray ?: return null
        if (k.size < 2) return null
        return Strecke(
            k.map { val p = it.jsonArray; KartenPunkt(p[1].jsonPrimitive.doubleOrNull ?: 0.0, p[0].jsonPrimitive.doubleOrNull ?: 0.0) },
            e["s"]?.jsonPrimitive?.intOrNull ?: 0, e["m"]?.jsonPrimitive?.intOrNull ?: 0,
        )
    }

    suspend fun strecke(von: KartenPunkt, bis: KartenPunkt): Strecke {
        val punkte = "${von.lng},${von.lat};${bis.lng},${bis.lat}"
        val adresse = "$OSRM$punkte?overview=full&geometries=geojson&alternatives=false&steps=false"
        strecken[adresse]?.let { e -> ausEintrag(e)?.let { return it } }
        val antwort = holen(adresse)
        if (antwort != null && antwort.first == 200) {
            val route = runCatching {
                Backend.json.parseToJsonElement(antwort.second).jsonObject["routes"]?.jsonArray?.firstOrNull()?.jsonObject
            }.getOrNull()
            val koord = route?.get("geometry")?.jsonObject?.get("coordinates")?.jsonArray
            if (route != null && koord != null && koord.size >= 2) {
                val sekunden = (route["duration"]?.jsonPrimitive?.doubleOrNull ?: 0.0).roundToInt()
                val meter = (route["distance"]?.jsonPrimitive?.doubleOrNull ?: 0.0).roundToInt()
                val eintrag = buildJsonObject { put("k", koord); put("s", sekunden); put("m", meter) }
                strecken[adresse] = eintrag
                if (strecken.size > 250) strecken.remove(strecken.keys.first())
                ablage?.edit()?.putString("trisar-routen-v1", JsonObject(strecken).toString())?.apply()
                ausEintrag(eintrag)?.let { return it }
            }
        }
        // Luftlinie, 45 km/h Schnitt (80 s je km) wie im Web.
        val m = FloatArray(1)
        Location.distanceBetween(von.lat, von.lng, bis.lat, bis.lng, m)
        return Strecke(listOf(von, bis), ((m[0] / 1000.0) * 80).toInt(), m[0].toInt(), notloesung = true)
    }
}

/**
 * Route des gewaehlten Fahrers wie im Routen-Effekt von GoogleMapSurface (KartenView.jsx),
 * Live-Zweig: Anfahrt (gelb gestrichelt) vom Fahrer zum Abholort nur bei offener Fahrt und
 * nicht aktivem Fahrer, Fahrt (blau) vom Abholort zum Ziel.
 */
internal data class KartenRoutenBild(
    val schluessel: String = "",
    val anfahrt: List<KartenPunkt> = emptyList(),
    val fahrt: List<KartenPunkt> = emptyList(),
    val anfahrtMinuten: Int? = null,
    val fahrtMinuten: Int? = null,
    val abholort: KartenPunkt? = null,
    val ziel: KartenPunkt? = null,
    /** Kolonnenkollegen: ihre Standorte gehoeren mit ins Bild. */
    val kolonne: List<KartenPunkt> = emptyList(),
) {
    /** Alles, was beim Einpassen ins Bild muss. */
    val allePunkte get() = anfahrt + fahrt + kolonne
}

internal object KartenRouten {
    /** routeFitKey: neu rechnen, wenn sich Fahrer, Fahrt, Status oder Orte aendern. */
    fun schluessel(f: KartenFahrer?): String {
        val r = f?.fahrt ?: return ""
        return listOf(f.id, r.id, r.status, r.vonSuche, r.nachSuche, r.vonPunkt, r.nachPunkt).joinToString("|")
    }

    suspend fun berechnen(fahrer: KartenFahrer, ursprung: KartenPunkt?, alle: List<KartenFahrer>): KartenRoutenBild? {
        val ride = fahrer.fahrt ?: return null
        var bild = KartenRoutenBild(schluessel = schluessel(fahrer))
        // Aktive Fahrer haben den Gast schon an Bord: fuer sie gibt es keine Anfahrt.
        val mitAnfahrt = KartenRegeln.istOffen(ride.status) && fahrer.zustand != FahrerZustand.AKTIV
        // Eigener Ort (Pin, Einfahrt) oder TomTom-Payload, erst ohne beide die Adresssuche.
        val abholort = ride.vonPunkt ?: DispoRouten.punkt(ride.vonSuche)
        val ziel = ride.nachPunkt ?: DispoRouten.punkt(ride.nachSuche)
        val anfahrtGeplant = mitAnfahrt && ursprung != null && abholort != null

        if (mitAnfahrt && ursprung != null && abholort != null) {
            val s = DispoRouten.strecke(ursprung, abholort)
            if (s.punkte.size >= 2) {
                bild = bild.copy(anfahrt = s.punkte, anfahrtMinuten = KartenRegeln.minutenAufrunden(s.sekunden), abholort = s.punkte.last())
            }
        }
        if (abholort != null && ziel != null) {
            val s = DispoRouten.strecke(abholort, ziel)
            if (s.punkte.size >= 2) {
                bild = bild.copy(
                    fahrt = s.punkte, fahrtMinuten = KartenRegeln.minutenAufrunden(s.sekunden),
                    abholort = if (!anfahrtGeplant) s.punkte.first() else bild.abholort, ziel = s.punkte.last(),
                )
            }
        }
        return bild.copy(kolonne = ride.kolonnenFahrerIDs.mapNotNull { id -> alle.firstOrNull { it.id == id }?.ort })
    }
}
