package de.trisar.dispo.karte

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
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
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonObject
import java.text.NumberFormat
import java.util.Locale
import kotlin.math.roundToInt

internal data class TelemetrieZeile(val id: String, val titel: String, val wert: String, val warnung: Boolean)
internal data class TelemetrieEreignis(val id: String, val zeit: String, val text: String)

/**
 * useFahrzeugTelemetrie (shared/fahrzeugTelemetrie.js) fuer einen Fahrer: letzter Stand aus
 * vehicle_telemetry_live und die drei juengsten Ereignisse, per Realtime und alle 30 s neu.
 * Anzeigezeilen nach den gleichen Regeln wie FahrzeugDaten.zeilen in der Fahrer-App.
 */
internal class DispoTelemetrie(private val fahrerID: String) {
    var zeilen by mutableStateOf<List<TelemetrieZeile>>(emptyList())
        private set
    var ereignisse by mutableStateOf<List<TelemetrieEreignis>>(emptyList())
        private set
    var stand by mutableStateOf("")
        private set

    private var kanal: RealtimeChannel? = null
    private val auftraege = mutableListOf<Job>()

    companion object {
        private val ereignisTexte = mapOf(
            "ignition_on" to "Zündung an", "ignition_off" to "Zündung aus", "trip_start" to "Fahrt begonnen", "trip_end" to "Fahrt beendet",
            "idling_start" to "Leerlauf begonnen", "idling_end" to "Leerlauf beendet", "unplugged" to "Tracker abgesteckt",
            "plugged_in" to "Tracker eingesteckt", "harsh_acceleration" to "Starkes Beschleunigen", "harsh_braking" to "Starkes Bremsen",
            "harsh_cornering" to "Scharfe Kurve", "overspeeding" to "Zu schnell", "crash" to "Aufprall erkannt",
            "towing" to "Abschleppen erkannt", "jamming" to "Störsender erkannt", "alarm" to "Alarm",
        )

        private fun dezimal(d: Double): String = NumberFormat.getNumberInstance(Locale.GERMANY).apply {
            minimumFractionDigits = 1; maximumFractionDigits = 1
        }.format(d)

        private fun ganz(d: Double): String = NumberFormat.getIntegerInstance(Locale.GERMANY).format(d.roundToInt())

        /** telemetrieZeilen aus fahrzeugTelemetrie.js. */
        fun zeilen(live: JsonObject?): List<TelemetrieZeile> {
            if (live == null) return emptyList()
            val z = mutableListOf<TelemetrieZeile>()
            fun zahl(k: String) = jZahl(live[k])
            jBool(live["ignition"])?.let { z += TelemetrieZeile("ignition", "Zündung", if (it) "An" else "Aus", false) }
            zahl("rpm")?.let { z += TelemetrieZeile("rpm", "Drehzahl", "${it.roundToInt()}", false) }
            zahl("obd_speed_kph")?.let { z += TelemetrieZeile("speed", "Tempo (OBD)", "${it.roundToInt()} km/h", false) }
            val tank = zahl("fuel_level_pct")
            tank?.let { z += TelemetrieZeile("fuel", "Tank", "${it.roundToInt()} %", it < 15) }
            if (tank == null) zahl("oem_fuel_l")?.let { z += TelemetrieZeile("fuel", "Tank", "${dezimal(it)} l", false) }
            zahl("oem_remaining_distance_km")?.let { z += TelemetrieZeile("range", "Reichweite", "${ganz(it)} km", it < 50) }
            zahl("coolant_c")?.let { z += TelemetrieZeile("coolant", "Kühlmittel", "${it.roundToInt()} °C", it > 110) }
            zahl("ext_voltage_v")?.let { z += TelemetrieZeile("voltage", "Bordspannung", "${dezimal(it)} V", it > 0 && it < 11.8) }
            (zahl("oem_mileage_km") ?: zahl("total_odometer_km"))?.let { z += TelemetrieZeile("odometer", "Kilometerstand", "${ganz(it)} km", false) }
            zahl("dtc_count")?.let { z += TelemetrieZeile("dtc", "Fehlercodes", "${it.toInt()}", it > 0) }
            zahl("engine_load_pct")?.let { z += TelemetrieZeile("load", "Motorlast", "${it.roundToInt()} %", false) }
            zahl("gsm_signal")?.let { z += TelemetrieZeile("gsm", "Mobilfunk", "${it.toInt()}/5", false) }
            return z
        }
    }

    fun starten(scope: CoroutineScope) {
        auftraege += scope.launch {
            laden()
            val k = Backend.client.channel("fahrzeug-telemetrie-$fahrerID-${System.currentTimeMillis()}")
            val stroeme = listOf("vehicle_telemetry_live", "vehicle_telemetry_events").map { t ->
                k.postgresChangeFlow<PostgresAction>(schema = "public") {
                    table = t
                    filter("driver_id", FilterOperator.EQ, fahrerID)
                }
            }
            kanal = k
            stroeme.forEach { s -> auftraege += scope.launch { s.collect { laden() } } }
            runCatching { k.subscribe() }
        }
        auftraege += scope.launch {
            while (isActive) {
                delay(30_000)
                laden()
            }
        }
    }

    fun beenden() {
        auftraege.forEach { it.cancel() }
        auftraege.clear()
        val k = kanal ?: return
        kanal = null
        kartenAufraeumen.launch { runCatching { Backend.client.realtime.removeChannel(k) } }
    }

    suspend fun laden() {
        val zeile = runCatching {
            Backend.client.from("vehicle_telemetry_live").select { filter { eq("driver_id", fahrerID) }; limit(1) }
                .decodeList<JsonObject>().firstOrNull()
        }.getOrNull()
        zeilen = zeilen(zeile)
        stand = KartenRegeln.isoUhrzeit(jText(zeile?.get("captured_at")))

        val ev = runCatching {
            Backend.client.from("vehicle_telemetry_events").select(Columns.raw("id,event_type,value,captured_at")) {
                filter { eq("driver_id", fahrerID) }
                order("captured_at", Order.DESCENDING)
                limit(3)
            }.decodeList<JsonObject>()
        }.getOrDefault(emptyList())
        ereignisse = ev.map { e ->
            val art = jText(e["event_type"])
            var text = ereignisTexte[art] ?: "Ereignis"
            // Zu schnell: Tempo dahinter.
            if (art == "overspeeding") jZahl(e["value"])?.let { text += " (${it.roundToInt()} km/h)" }
            TelemetrieEreignis(jText(e["id"]).ifEmpty { java.util.UUID.randomUUID().toString() },
                KartenRegeln.isoUhrzeit(jText(e["captured_at"])), text)
        }
    }
}
