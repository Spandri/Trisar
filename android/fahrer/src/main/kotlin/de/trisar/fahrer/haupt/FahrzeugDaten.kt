package de.trisar.fahrer.haupt

import android.content.Context
import android.graphics.Bitmap
import de.trisar.kern.Backend
import io.github.jan.supabase.postgrest.from
import io.github.jan.supabase.postgrest.query.Columns
import io.github.jan.supabase.postgrest.query.Order
import io.github.jan.supabase.postgrest.query.filter.FilterOperator
import io.github.jan.supabase.realtime.PostgresAction
import io.github.jan.supabase.realtime.RealtimeChannel
import io.github.jan.supabase.realtime.channel
import io.github.jan.supabase.realtime.postgresChangeFlow
import io.github.jan.supabase.realtime.realtime
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.launchIn
import kotlinx.coroutines.flow.onEach
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.put
import java.text.NumberFormat
import java.util.Locale
import kotlin.math.roundToInt

/** Punkt auf der Karte (Breite, Laenge). */
data class Ort(val lat: Double, val lng: Double)

/**
 * Daten der Fahrzeug-Seite (VehicleView.jsx): Ausstattung (trim), letzter OBD-Standort,
 * Fahrzeugdaten aus dem Tracker (fahrzeugTelemetrie.js) und Schadensbericht. Wie FahrzeugDaten.swift.
 */
class FahrzeugDaten(private val ctx: Context, private val fahrerID: String, private val bereich: CoroutineScope) {
    data class Schaden(val id: String, val datum: String, val stelle: String, val beschreibung: String, val bilder: List<String>)
    data class TelemetrieZeile(val id: String, val titel: String, val wert: String, val warnung: Boolean)
    data class Ereignis(val id: String, val zeit: String, val text: String)

    val ausstattung = MutableStateFlow("")
    val standort = MutableStateFlow<Ort?>(null)
    val schaeden = MutableStateFlow<List<Schaden>>(emptyList())
    val telemetrie = MutableStateFlow<List<TelemetrieZeile>>(emptyList())
    val ereignisse = MutableStateFlow<List<Ereignis>>(emptyList())
    val telemetrieStand = MutableStateFlow("")
    val fehler = MutableStateFlow<String?>(null)

    private var fahrzeugID: String? = null
    private var kanal: RealtimeChannel? = null
    private val beobachter = mutableListOf<Job>()
    private val prefs = ctx.getSharedPreferences("trisar", Context.MODE_PRIVATE)

    init {
        // Letzten bekannten Standort sofort zeigen, die Karte muss nicht auf die Datenbank warten.
        val w = prefs.getString(STANDORT_SCHLUESSEL, null)?.split(",")?.mapNotNull { it.toDoubleOrNull() }
        if (w != null && w.size == 2) standort.value = Ort(w[0], w[1])
    }

    suspend fun starten(fahrzeugID: String?) {
        this.fahrzeugID = fahrzeugID
        laden()
        // Wie im Web: Telemetrie per Realtime, Rueckfall alle 30 s.
        val k = Backend.client.channel("fahrzeug-telemetrie-$fahrerID")
        val stroeme = listOf("vehicle_telemetry_live", "vehicle_telemetry_events").map { t ->
            k.postgresChangeFlow<PostgresAction>(schema = "public") { table = t; filter("driver_id", FilterOperator.EQ, fahrerID) }
        }
        kanal = k
        stroeme.forEach { s -> beobachter += s.onEach { telemetrieLaden() }.launchIn(bereich) }
        runCatching { k.subscribe() }
        beobachter += bereich.launch {
            while (isActive) { delay(30_000); telemetrieLaden() }
        }
    }

    suspend fun beenden() {
        beobachter.forEach { it.cancel() }
        beobachter.clear()
        kanal?.let { runCatching { Backend.client.realtime.removeChannel(it) } }
        kanal = null
    }

    suspend fun laden() = coroutineScope {
        launch { ausstattungLaden() }
        launch { standortLaden() }
        launch { schaedenLaden() }
        launch { telemetrieLaden() }
    }

    @Serializable private data class TrimZeile(val trim: String? = null)
    @Serializable private data class OrtZeile(val lat: Double? = null, val lng: Double? = null, val source: String? = null)

    private suspend fun ausstattungLaden() {
        val id = fahrzeugID ?: run { ausstattung.value = ""; return }
        val z = runCatching {
            Backend.client.from("vehicles").select(Columns.raw("trim")) { filter { eq("id", id) }; limit(1) }.liste<TrimZeile>()
        }.getOrNull() ?: run { ausstattung.value = ""; return }
        ausstattung.value = z.firstOrNull()?.trim.orEmpty()
    }

    /** Web: letzter OBD-Standort des Fahrers, sonst der Handy-Standort. */
    private suspend fun standortLaden() {
        val zeilen = runCatching {
            Backend.client.from("driver_live_locations").select(Columns.raw("lat,lng,source")) {
                filter { eq("driver_id", fahrerID) }; limit(5)
            }.liste<OrtZeile>()
        }.getOrNull() ?: return
        val muster = Regex("teltonika|fmb\\d*|obd|telematik|telematics|tracker", RegexOption.IGNORE_CASE)
        val obd = zeilen.firstOrNull { muster.containsMatchIn(it.source.orEmpty()) }
        val z = obd ?: zeilen.firstOrNull() ?: return
        val lat = z.lat ?: return
        val lng = z.lng ?: return
        standort.value = Ort(lat, lng)
        prefs.edit().putString(STANDORT_SCHLUESSEL, "$lat,$lng").apply()
    }

    // Schaeden

    @Serializable
    private data class SchadenZeile(
        val id: String,
        val report_date: String? = null,
        val part_name: String? = null,
        val description: String? = null,
        val image_url: String? = null,
        val image_urls: List<String>? = null,
    )

    suspend fun schaedenLaden() {
        val id = fahrzeugID ?: run { schaeden.value = emptyList(); return }
        val zeilen = runCatching {
            Backend.client.from("vehicle_damages").select(Columns.raw("id,report_date,part_name,description,image_url,image_urls")) {
                filter { eq("vehicle_id", id) }
                order("report_date", Order.DESCENDING)
            }.liste<SchadenZeile>()
        }.getOrNull() ?: return
        schaeden.value = zeilen.map { z ->
            val bilder = (if (!z.image_urls.isNullOrEmpty()) z.image_urls else listOfNotNull(z.image_url))
                .filter { it.isNotEmpty() && !it.startsWith("blob:") }
            Schaden(z.id, datumKurz(z.report_date.orEmpty()), z.part_name.orEmpty(), z.description.orEmpty(), bilder)
        }
    }

    /**
     * addVehicleDamage der Web-App. Fotos: Es gibt (noch) keinen Storage-Bucket, darum
     * verkleinert als data-URL in image_urls (die Web-App zeigt sie so direkt an).
     */
    suspend fun melden(stelle: String, beschreibung: String, fotos: List<Bitmap>): Boolean {
        val id = fahrzeugID ?: run { fehler.value = "Kein Fahrzeug zugeteilt."; return false }
        val heute = Datum.tagWert()
        val heuteKurz = datumKurz(heute)
        // Gleiche Meldung nicht doppelt eintragen.
        if (schaeden.value.any { it.datum == heuteKurz && it.stelle == stelle && it.beschreibung == beschreibung }) return true
        // Lange Kante 900, JPEG 0,6 -> grob 60-120 KB je Foto.
        val bilder = fotos.take(3).map { ProfilDienst.datenURL(ProfilDienst.verkleinern(it, 900), 60) }
        return try {
            Backend.client.from("vehicle_damages").insert(buildJsonObject {
                put("vehicle_id", id); put("report_date", heute); put("part_name", stelle); put("description", beschreibung)
                put("image_url", bilder.firstOrNull()?.let { JsonPrimitive(it) } ?: JsonNull)
                put("image_urls", buildJsonArray { bilder.forEach { add(JsonPrimitive(it)) } })
                put("reported_by_driver", true)
            })
            schaedenLaden()
            true
        } catch (e: Exception) {
            if (e is kotlinx.coroutines.CancellationException) throw e
            fehler.value = "Schaden konnte nicht gemeldet werden: ${e.message}"
            false
        }
    }

    // Telemetrie (telemetrieZeilen)

    suspend fun telemetrieLaden() {
        val live = runCatching {
            Backend.client.from("vehicle_telemetry_live").select { filter { eq("driver_id", fahrerID) }; limit(1) }.data
        }.getOrNull()
        val zeile = live?.let { runCatching { Backend.json.parseToJsonElement(it).jsonArray.firstOrNull()?.jsonObject }.getOrNull() }
        telemetrie.value = zeilen(zeile)
        telemetrieStand.value = text(zeile?.get("captured_at"))?.let { Datum.ausISO(it) }?.let { Datum.uhrzeit(it) }.orEmpty()

        val ev = runCatching {
            Backend.client.from("vehicle_telemetry_events").select(Columns.raw("id,event_type,value,captured_at")) {
                filter { eq("driver_id", fahrerID) }
                order("captured_at", Order.DESCENDING); limit(3)
            }.data
        }.getOrNull()
        val evZeilen = ev?.let { runCatching { Backend.json.parseToJsonElement(it).jsonArray.map { e -> e.jsonObject } }.getOrNull() }.orEmpty()
        ereignisse.value = evZeilen.map { e ->
            Ereignis(
                id = text(e["id"]) ?: java.util.UUID.randomUUID().toString(),
                zeit = text(e["captured_at"])?.let { Datum.ausISO(it) }?.let { Datum.uhrzeit(it) }.orEmpty(),
                text = EREIGNIS_TEXTE[text(e["event_type"]).orEmpty()] ?: "Ereignis",
            )
        }
    }

    companion object {
        private const val STANDORT_SCHLUESSEL = "trisar_fahrzeug_letzter_standort"

        /** 2026-09-12 -> 12.09.26 */
        fun datumKurz(wert: String): String {
            val t = wert.take(10).split("-")
            if (t.size != 3) return wert
            return "${t[2]}.${t[1]}.${t[0].takeLast(2)}"
        }

        private val EREIGNIS_TEXTE = mapOf(
            "ignition_on" to "Zündung an", "ignition_off" to "Zündung aus", "trip_start" to "Fahrt begonnen", "trip_end" to "Fahrt beendet",
            "idling_start" to "Leerlauf begonnen", "idling_end" to "Leerlauf beendet", "unplugged" to "Tracker abgesteckt",
            "plugged_in" to "Tracker eingesteckt", "harsh_acceleration" to "Starkes Beschleunigen", "harsh_braking" to "Starkes Bremsen",
            "harsh_cornering" to "Scharfe Kurve", "overspeeding" to "Zu schnell", "crash" to "Aufprall erkannt",
            "towing" to "Abschleppen erkannt", "jamming" to "Störsender erkannt", "alarm" to "Alarm",
        )

        private fun text(e: JsonElement?): String? = (e as? JsonPrimitive)?.takeIf { e !is JsonNull }?.contentOrNull

        private fun zahl(e: JsonElement?): Double? {
            val p = e as? JsonPrimitive ?: return null
            if (p is JsonNull) return null
            p.doubleOrNull?.let { return it }
            return p.contentOrNull?.takeIf { it.isNotEmpty() }?.toDoubleOrNull()
        }

        private fun dezimal(d: Double): String = NumberFormat.getNumberInstance(Locale.GERMANY).apply {
            minimumFractionDigits = 1; maximumFractionDigits = 1
        }.format(d)

        private fun ganz(d: Double): String = NumberFormat.getNumberInstance(Locale.GERMANY).apply { maximumFractionDigits = 0 }.format(Math.round(d))

        fun zeilen(live: JsonObject?): List<TelemetrieZeile> {
            if (live == null) return emptyList()
            val z = mutableListOf<TelemetrieZeile>()
            (live["ignition"] as? JsonPrimitive)?.takeIf { it !is JsonNull }?.booleanOrNull?.let {
                z += TelemetrieZeile("ignition", "Zündung", if (it) "An" else "Aus", false)
            }
            zahl(live["rpm"])?.let { z += TelemetrieZeile("rpm", "Drehzahl", "${it.roundToInt()}", false) }
            zahl(live["obd_speed_kph"])?.let { z += TelemetrieZeile("speed", "Tempo (OBD)", "${it.roundToInt()} km/h", false) }
            val tank = zahl(live["fuel_level_pct"])
            if (tank != null) z += TelemetrieZeile("fuel", "Tank", "${tank.roundToInt()} %", tank < 15)
            if (tank == null) zahl(live["oem_fuel_l"])?.let { z += TelemetrieZeile("fuel", "Tank", "${dezimal(it)} l", false) }
            zahl(live["oem_remaining_distance_km"])?.let { z += TelemetrieZeile("range", "Reichweite", "${ganz(it)} km", it < 50) }
            zahl(live["coolant_c"])?.let { z += TelemetrieZeile("coolant", "Kühlmittel", "${it.roundToInt()} °C", it > 110) }
            zahl(live["ext_voltage_v"])?.let { z += TelemetrieZeile("voltage", "Bordspannung", "${dezimal(it)} V", it > 0 && it < 11.8) }
            (zahl(live["oem_mileage_km"]) ?: zahl(live["total_odometer_km"]))?.let { z += TelemetrieZeile("odometer", "Kilometerstand", "${ganz(it)} km", false) }
            zahl(live["dtc_count"])?.let { z += TelemetrieZeile("dtc", "Fehlercodes", "${it.toInt()}", it > 0) }
            zahl(live["engine_load_pct"])?.let { z += TelemetrieZeile("load", "Motorlast", "${it.roundToInt()} %", false) }
            zahl(live["gsm_signal"])?.let { z += TelemetrieZeile("gsm", "Mobilfunk", "${it.toInt()}/5", false) }
            return z
        }
    }
}
