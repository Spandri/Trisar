package de.trisar.dispo.planung

import android.content.Context
import android.content.SharedPreferences
import de.trisar.kern.Backend
import io.github.jan.supabase.postgrest.from
import io.github.jan.supabase.postgrest.query.Columns
import io.github.jan.supabase.postgrest.query.Order
import io.github.jan.supabase.realtime.PostgresAction
import io.github.jan.supabase.realtime.RealtimeChannel
import io.github.jan.supabase.realtime.channel
import io.github.jan.supabase.realtime.postgresChangeFlow
import io.github.jan.supabase.realtime.realtime
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.doubleOrNull
import java.text.NumberFormat
import java.time.LocalDate
import java.time.LocalTime
import java.time.format.DateTimeFormatter
import java.time.temporal.ChronoUnit
import java.util.Locale
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min

// Daten und Hilfen der Einsatzplanung, 1:1 aus EinsatzPlaner.swift, EinsatzPlanungModell.swift
// und FahrerVerwaltung.swift (iOS). Zeilen bleiben JsonObject, weil das Web die Fahrten, Fahrer
// und Fahrzeuge unveraendert an den Planer-Server schickt.

internal typealias PlanerZeile = JsonObject

internal val planJson = Json { ignoreUnknownKeys = true; explicitNulls = false; encodeDefaults = true }

/** Lauf ueber die Seite hinaus: Planung und Schreibwege laufen weiter, wenn man die Seite verlaesst (wie Task in iOS). */
internal val planLauf = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

/** Swift `.rounded()`: halbe Werte weg von null (Kotlins round() rundet zur geraden Zahl). */
internal fun rund(x: Double): Double = if (x >= 0) floor(x + 0.5) else -floor(-x + 0.5)

internal fun zwei(n: Int): String = String.format(Locale.ROOT, "%02d", n)

// MARK: - JSON-Werte wie im Web

/** Number(x): Zahl, Zahl als Text, Wahrheitswert, sonst null. */
internal val JsonElement?.planZahl: Double?
    get() {
        val p = this as? JsonPrimitive ?: return null
        if (p is JsonNull) return null
        if (p.isString) return p.content.trim().toDoubleOrNull()
        p.booleanOrNull?.let { return if (it) 1.0 else 0.0 }
        return p.doubleOrNull
    }

/** String(x || '').trim() */
internal val JsonElement?.planText: String
    get() {
        val p = this as? JsonPrimitive ?: return ""
        if (p is JsonNull) return ""
        if (p.isString) return p.content.trim()
        p.booleanOrNull?.let { return if (it) "true" else "" }
        val d = p.doubleOrNull ?: return p.content
        return if (d == rund(d) && kotlin.math.abs(d) < 1e15) d.toLong().toString() else d.toString()
    }

internal val JsonElement?.istNull: Boolean get() = this == null || this is JsonNull

internal fun JsonObject.text(k: String): String = this[k].planText

/** Zahl oder null (Number.parseFloat), Komma als Dezimalzeichen erlaubt. */
internal fun JsonObject.zahl(k: String): Double? {
    val p = this[k] as? JsonPrimitive ?: return null
    if (p is JsonNull) return null
    if (p.isString) return p.content.trim().replace(",", ".").toDoubleOrNull()
    if (p.booleanOrNull != null) return null
    return p.doubleOrNull
}

/** toBool: true, 1, '1', 'true'. */
internal fun JsonObject.wahr(k: String): Boolean {
    val p = this[k] as? JsonPrimitive ?: return false
    if (p is JsonNull) return false
    if (p.isString) return p.content == "1" || p.content == "true"
    p.booleanOrNull?.let { return it }
    return p.doubleOrNull == 1.0
}

internal fun JsonElement?.alsObjekt(): JsonObject? = this as? JsonObject
internal fun JsonElement?.alsListe(): List<JsonElement>? = this as? kotlinx.serialization.json.JsonArray
internal fun JsonElement?.alsWahr(): Boolean? = (this as? JsonPrimitive)?.takeIf { it !is JsonNull && !it.isString }?.booleanOrNull

internal fun js(t: String) = JsonPrimitive(t)
internal fun js(n: Number) = JsonPrimitive(n)
internal fun js(b: Boolean) = JsonPrimitive(b)

/** Leerer Text wird null (fuer `a || b` aus dem Web). */
internal val String.planOderNull: String? get() = ifEmpty { null }

// MARK: - Uhrzeit und Datum

internal object EinsatzUhr {
    private val uhrMuster = Regex("""(\d{1,2}):(\d{2})""")

    /** normalizeClock: erste "h:mm" im Text, Stunde zweistellig. */
    fun normal(wert: String?): String {
        val m = uhrMuster.find(wert ?: "") ?: return ""
        val h = m.groupValues[1].toIntOrNull() ?: return ""
        return zwei(h) + ":" + m.groupValues[2]
    }

    fun minuten(wert: String?): Int? {
        val n = normal(wert)
        if (n.isEmpty()) return null
        val t = n.split(":").mapNotNull { it.toIntOrNull() }
        return if (t.size == 2) t[0] * 60 + t[1] else null
    }

    /** pad2(floor(min/60) % 24):pad2(min % 60) */
    fun uhr(minute: Int): String {
        val m = max(0, minute)
        return zwei((m / 60) % 24) + ":" + zwei(m % 60)
    }

    fun heute(): String = LocalDate.now().toString()

    fun datum(iso: String): LocalDate = runCatching { LocalDate.parse(iso.trim().take(10)) }.getOrElse { LocalDate.now() }

    fun plusTage(iso: String, tage: Int): String = datum(iso).plusDays(tage.toLong()).toString()

    /** Tage von `heute` bis `iso`. */
    fun tagNr(iso: String, heute: String = heute()): Int = ChronoUnit.DAYS.between(datum(heute), datum(iso)).toInt()

    /** Intl.DateTimeFormat('de-DE', ...) nachgebaut. */
    fun format(iso: String, muster: String): String = DateTimeFormatter.ofPattern(muster, Locale.GERMAN).format(datum(iso))

    /** "Mi., 04.11.2026" */
    fun tagLang(iso: String) = format(iso, "EEE, dd.MM.yyyy")
    /** "Mi., 4. Nov." */
    fun tagKurz(iso: String) = format(iso, "EEE, d. MMM")
}

/** Zahl mit deutscher Schreibweise wie Intl.NumberFormat('de-DE'). */
internal fun einsatzZahl(wert: Double, stellen: Int = 0): String {
    val f = NumberFormat.getNumberInstance(Locale.GERMANY)
    f.minimumFractionDigits = stellen
    f.maximumFractionDigits = stellen
    f.roundingMode = java.math.RoundingMode.HALF_UP
    return f.format(wert)
}

/** Uhrzeit-Hilfen aus AlleFahrer.jsx (normalizeClockValue mit Bereichspruefung). */
internal object PlanDienstzeit {
    private val muster = Regex("""^(\d{1,2}):(\d{2})""")

    fun normal(wert: String?): String {
        val m = muster.find((wert ?: "").trim()) ?: return ""
        val h = m.groupValues[1].toInt()
        val mi = m.groupValues[2].toInt()
        if (h !in 0..23 || mi !in 0..59) return ""
        return zwei(h) + ":" + zwei(mi)
    }

    fun minuten(wert: String?): Int? {
        val n = normal(wert)
        if (n.isEmpty()) return null
        val t = n.split(":").map { it.toInt() }
        return t[0] * 60 + t[1]
    }

    fun segmente(s: Int, e: Int): List<Pair<Int, Int>> = if (e >= s) listOf(s to e) else listOf(s to 1439, 0 to e)

    /** Tagesabstand zu heute (0 = heute, 1 = morgen ...). */
    fun tagAbstand(iso: String?): Int? {
        val t = (iso ?: "").trim()
        if (!Regex("""\d{4}-\d{2}-\d{2}""").matches(t)) return null
        return ChronoUnit.DAYS.between(LocalDate.now(), EinsatzUhr.datum(t)).toInt()
    }

    /** normalizePlanRequestStatus */
    fun anfrageStatus(wert: String?): String {
        val n = (wert ?: "").trim().lowercase()
        return when (n) {
            "cancelled", "canceled", "reset" -> "cancelled"
            "accepted", "assigned", "approved" -> "accepted"
            "refused", "rejected", "declined" -> "refused"
            "pending", "new", "requested", "offered" -> "pending"
            else -> ""
        }
    }
}

// MARK: - Fahrer (mapRowsToDrivers in AlleFahrer.jsx)

internal data class PlanFahrer(
    val id: String,
    val name: String,
    val firstName: String,
    val lastName: String,
    val email: String,
    val vehicle: String,
    val role: String?,
    val driverNumber: Long?,
    val driverActivityState: String?,
    val serviceStartTime: String,
    val serviceEndTime: String,
    val serviceStartDate: String,
    val planRequestStatus: String,
) {
    /** isDriverIncomplete: ohne Fahrzeug, Nummer oder vollstaendige Dienstzeit. */
    val unfertig: Boolean
        get() = vehicle.isBlank() || driverNumber == null ||
            PlanDienstzeit.normal(serviceStartTime).isEmpty() || PlanDienstzeit.normal(serviceEndTime).isEmpty()

    /** isDriverInServiceNow: jetzt innerhalb der Dienstzeit (auch ueber Mitternacht). */
    fun imDienst(): Boolean {
        val s = PlanDienstzeit.minuten(serviceStartTime) ?: return false
        val e = PlanDienstzeit.minuten(serviceEndTime) ?: return false
        val jetzt = LocalTime.now()
        val n = jetzt.hour * 60 + jetzt.minute
        return PlanDienstzeit.segmente(s, e).any { n >= it.first && n <= it.second }
    }
}

/** Planungshorizont der Kurven: heute + 2 Folgetage. */
internal object PlanKurven {
    const val TAGE = 3
    const val STUNDEN = TAGE * 24
    const val FENSTER_LAENGE = 23 - 6 + 1
    val ausgeschlossen = setOf("done", "completed", "arrived", "archived", "cancelled", "canceled", "refused", "rejected")

    /** Fahrer je Stunde (72 h). Schicht mit Datum zaehlt nur an ihrem Tag. */
    fun angebot(fahrer: List<PlanFahrer>): List<Int> {
        val z = IntArray(STUNDEN)
        val heute = EinsatzUhr.heute()
        for (f in fahrer) {
            val s = PlanDienstzeit.minuten(f.serviceStartTime) ?: continue
            val e = PlanDienstzeit.minuten(f.serviceEndTime) ?: continue
            val seg = PlanDienstzeit.segmente(s, e)
            val datum = f.serviceStartDate.trim()
            for (tag in 0 until TAGE) {
                if (datum.isNotEmpty() && datum != EinsatzUhr.plusTage(heute, tag)) continue
                for (h in 0 until 24) {
                    val a = h * 60
                    val b = min(1439, a + 59)
                    if (seg.any { max(it.first, a) <= min(it.second, b) }) z[tag * 24 + h] += 1
                }
            }
        }
        return z.toList()
    }

    /** computeDemandCurve (demo/planungsKurven.js): geglaettete gebuchte Fahrten, leere Stunden 0. */
    fun bedarf(gebucht: List<Int>): List<Int> {
        val n = max(gebucht.size, FENSTER_LAENGE)
        val b = (0 until n).map { if (it < gebucht.size) max(0, gebucht[it]) else 0 }
        return (0 until n).map { i ->
            val vor = if (i > 0) b[i - 1] else 0
            val nach = if (i + 1 < n) b[i + 1] else 0
            if (b[i] == 0) 0 else max(b[i], rund((vor + 2 * b[i] + nach) / 4.0).toInt())
        }
    }
}

/** Fehlermeldung wie `error.message` im Web. */
internal fun dbMeldung(e: Throwable): String = (e.message ?: "").trim()

/**
 * Fahrerliste wie FahrerListeDienst in iOS (AlleFahrer.jsx: loadDrivers + Realtime auf profiles,
 * vehicles, jobs, driver_service_requests, dazu Abfrage jede Minute).
 */
internal class PlanFahrerDienst {
    val fahrer = MutableStateFlow<List<PlanFahrer>?>(null)

    private var bevorzugt = ""
    private var kanal: RealtimeChannel? = null
    private var jobs = mutableListOf<Job>()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    @Serializable
    private data class Fahrzeug(val license_plate: String? = null)

    @Serializable
    private data class Zeile(
        val id: String? = null,
        val first_name: String? = null,
        val last_name: String? = null,
        val email: String? = null,
        val role: String? = null,
        val driver_number: Long? = null,
        val driver_activity_state: String? = null,
        val service_start_time: String? = null,
        val service_end_time: String? = null,
        val service_start_date: String? = null,
        val vehicles: Fahrzeug? = null,
    )

    @Serializable
    private data class Anfrage(val driver_id: String? = null, val status: String? = null)

    private val auswahlListe = listOf(
        "id, first_name, last_name, email, created_at, vehicle_id, role, is_dispo, driver_number, driver_activity_state, service_start_time, service_end_time, vehicles:vehicle_id(license_plate)",
        "id, first_name, last_name, created_at, vehicle_id, role, is_dispo, driver_number, driver_activity_state, service_start_time, service_end_time, vehicles:vehicle_id(license_plate)",
        "id, first_name, last_name, email, created_at, vehicle_id, role, is_dispo, driver_number, vehicles:vehicle_id(license_plate)",
        "id, first_name, last_name, created_at, vehicle_id, role, is_dispo, driver_number, vehicles:vehicle_id(license_plate)",
    )

    suspend fun laden() {
        val reihe = if (bevorzugt.isEmpty()) auswahlListe else listOf(bevorzugt) + auswahlListe.filter { it != bevorzugt }
        var zeilen: List<Zeile>? = null
        for (auswahl in reihe) {
            try {
                zeilen = Backend.client.from("profiles").select(Columns.raw(auswahl)) {
                    order("last_name", Order.ASCENDING, nullsFirst = false)
                    order("first_name", Order.ASCENDING, nullsFirst = false)
                }.decodeList<Zeile>()
                bevorzugt = auswahl
                break
            } catch (e: Exception) {
                if (e is kotlinx.coroutines.CancellationException) throw e
            }
        }
        val z = zeilen ?: return
        var liste = z.map { r ->
            val vor = (r.first_name ?: "").trim()
            val nach = (r.last_name ?: "").trim()
            val name = listOfNotNull(r.first_name, r.last_name).filter { it.isNotEmpty() }.joinToString(" ").trim()
            val id = (r.id ?: "").trim()
            PlanFahrer(
                id = id.ifEmpty { "-" }, name = name.ifEmpty { "Ohne Name" }, firstName = vor, lastName = nach,
                email = (r.email ?: "").trim(), vehicle = r.vehicles?.license_plate ?: "", role = r.role,
                driverNumber = r.driver_number, driverActivityState = r.driver_activity_state,
                serviceStartTime = PlanDienstzeit.normal(r.service_start_time),
                serviceEndTime = PlanDienstzeit.normal(r.service_end_time),
                serviceStartDate = (r.service_start_date ?: "").trim(), planRequestStatus = "",
            )
        }
        // Neueste Dienstanfrage je Fahrer liefert nur die Farbe der Zeiten.
        val ids = liste.map { it.id }.filter { it != "-" }
        if (ids.isNotEmpty()) {
            runCatching {
                val anfragen = Backend.client.from("driver_service_requests")
                    .select(Columns.raw("driver_id,status,service_start_time,service_end_time,created_at")) {
                        filter { isIn("driver_id", ids) }
                        order("created_at", Order.DESCENDING)
                    }.decodeList<Anfrage>()
                val neueste = mutableMapOf<String, String>()
                for (a in anfragen) {
                    val d = (a.driver_id ?: "").trim()
                    if (d.isEmpty() || neueste.containsKey(d)) continue
                    neueste[d] = PlanDienstzeit.anfrageStatus(a.status)
                }
                liste = liste.map { it.copy(planRequestStatus = neueste[it.id] ?: "") }
            }
        }
        fahrer.value = liste
    }

    fun starten() {
        if (kanal != null) return
        scope.launch {
            laden()
            val k = Backend.client.channel("admin-drivers-live-${System.currentTimeMillis()}")
            val stroeme = listOf("profiles", "vehicles", "jobs", "driver_service_requests").map { t ->
                k.postgresChangeFlow<PostgresAction>(schema = "public") { table = t }
            }
            kanal = k
            stroeme.forEach { s -> jobs += scope.launch { s.collect { laden() } } }
            runCatching { k.subscribe() }
        }
        jobs += scope.launch {
            while (isActive) {
                delay(60_000)
                laden()
            }
        }
    }

    fun stoppen() {
        jobs.forEach { it.cancel() }
        jobs.clear()
        val k = kanal
        kanal = null
        if (k != null) planLauf.launch { runCatching { Backend.client.realtime.removeChannel(k) } }
    }
}

// MARK: - Ablage (UserDefaults in iOS)

/** SharedPreferences der Planung. Wird beim ersten Anzeigen einer Planungsseite eingerichtet. */
internal object PlanAblage {
    private var prefs: SharedPreferences? = null

    fun einrichten(ctx: Context) {
        if (prefs == null) prefs = ctx.applicationContext.getSharedPreferences("trisar_dispo", Context.MODE_PRIVATE)
    }

    fun text(k: String): String? = prefs?.getString(k, null)
    fun setzen(k: String, wert: String) { prefs?.edit()?.putString(k, wert)?.apply() }
    fun entfernen(k: String) { prefs?.edit()?.remove(k)?.apply() }
}

// MARK: - Planungsregeln und Optionen

/**
 * Planungsregeln wie DEFAULT_PLANNER_SETTINGS (KiPlanerSettingsView.jsx). Gespeichert wie im Web
 * unter `trisar_planner_settings_v1` als JSON-Text; unbekannte Felder kommen aus den Voreinstellungen dazu.
 */
internal object PlanerRegeln {
    const val SCHLUESSEL = "trisar_planner_settings_v1"
    val standard: PlanerZeile = JsonObject(
        mapOf(
            "mode" to js("balanced"), "maxWorkHours" to js(8), "minWorkHours" to js(3), "bufferMinutes" to js(20),
            "rideDurationMinutes" to js(80), "driverPool" to js(101), "minPauseHours" to js(3), "restHours" to js(11),
            "qualityGapPercent" to js(5),
        )
    )

    fun lesen(): PlanerZeile {
        val gespeichert = PlanAblage.text(SCHLUESSEL)?.let { runCatching { planJson.parseToJsonElement(it) as? JsonObject }.getOrNull() }
        return JsonObject(standard + (gespeichert ?: emptyMap()))
    }

    fun schreiben(werte: PlanerZeile) = PlanAblage.setzen(SCHLUESSEL, werte.toString())
}

/**
 * Planungsregeln fuer die Einstellungsseite (PlanerEinstellungen.swift). Grenzen nach
 * Arbeitszeitgesetz: Regelarbeitszeit 8 h, bis 10 h (§ 3 ArbZG), Ruhezeit mind. 11 h (§ 5 ArbZG).
 */
internal data class PlanerEinstellungen(
    val mode: String = "balanced",
    val maxWorkHours: Double = 8.0,
    val minWorkHours: Double = 3.0,
    val bufferMinutes: Double = 20.0,
    /** Nur Rueckfall, falls eine Fahrt keine echte Fahrzeit hat. */
    val rideDurationMinutes: Double = 80.0,
    val driverPool: Double = 101.0,
    val minPauseHours: Double = 3.0,
    val restHours: Double = 11.0,
    val qualityGapPercent: Double = 5.0,
    /** "osrm" = Strassenzeit x Stundenfaktor (Standard), "osrm_raum" = Faktor je Gegend, Wochentag und Stunde. */
    val travelModel: String = "osrm",
) {
    fun alsJson(): JsonObject = JsonObject(
        mapOf(
            "mode" to js(mode), "maxWorkHours" to js(maxWorkHours), "minWorkHours" to js(minWorkHours),
            "bufferMinutes" to js(bufferMinutes), "rideDurationMinutes" to js(rideDurationMinutes),
            "driverPool" to js(driverPool), "minPauseHours" to js(minPauseHours), "restHours" to js(restHours),
            "qualityGapPercent" to js(qualityGapPercent), "travelModel" to js(travelModel),
        )
    )

    fun speichern() = PlanAblage.setzen(PlanerRegeln.SCHLUESSEL, alsJson().toString())

    companion object {
        val standard = PlanerEinstellungen()

        /** Wie `{ ...DEFAULT_PLANNER_SETTINGS, ...gespeichert }`: fehlende Felder bleiben Standard. */
        fun laden(): PlanerEinstellungen {
            val o = PlanAblage.text(PlanerRegeln.SCHLUESSEL)?.let {
                runCatching { planJson.parseToJsonElement(it) as? JsonObject }.getOrNull()
            } ?: return standard
            val s = standard
            fun zahl(k: String, std: Double) = o[k].planZahl.takeIf { o[k] !is JsonPrimitive || (o[k] as JsonPrimitive).booleanOrNull == null } ?: std
            return PlanerEinstellungen(
                mode = (o["mode"] as? JsonPrimitive)?.takeIf { it.isString }?.content ?: s.mode,
                maxWorkHours = zahl("maxWorkHours", s.maxWorkHours),
                minWorkHours = zahl("minWorkHours", s.minWorkHours),
                bufferMinutes = zahl("bufferMinutes", s.bufferMinutes),
                rideDurationMinutes = zahl("rideDurationMinutes", s.rideDurationMinutes),
                driverPool = zahl("driverPool", s.driverPool),
                minPauseHours = zahl("minPauseHours", s.minPauseHours),
                restHours = zahl("restHours", s.restHours),
                qualityGapPercent = zahl("qualityGapPercent", s.qualityGapPercent),
                travelModel = if (o["travelModel"].planText == "osrm_raum") "osrm_raum" else "osrm",
            )
        }
    }
}

/** STRATEGIES: Optionen der TRISAR-Engine. Sie setzen das Ziel des Solvers (mode) und Regeln. */
internal data class EinsatzStrategie(val key: String, val titel: String, val regeln: PlanerZeile) {
    companion object {
        private fun r(mode: String) = JsonObject(
            mapOf("mode" to js(mode), "maxWorkHours" to js(10), "minWorkHours" to js(3), "minPauseHours" to js(3), "bufferMinutes" to js(0))
        )

        val alle = listOf(
            EinsatzStrategie("standard", "Standard", r("standard")),
            EinsatzStrategie("sicher", "Sicher", r("sicher")),
        )

        fun finden(key: String) = alle.firstOrNull { it.key == key } ?: alle[0]
    }
}

// MARK: - Datenmodell der Vorschlaege

@Serializable
internal data class EinsatzFahrt(
    val etd: String,
    val pickup: String,
    val dropoff: String,
    val adresseAb: String,
    val adresseZiel: String,
    val ankunft: String,
    val passengers: Double,
    val km: Double,
    val durationMinutes: Double? = null,
    val id: String,
    val sammel: Boolean = false,
    val route: String? = null,
    val reserveMin: Double? = null,
)

/** Ein Dienst-Vorschlag wie in mapPlannerSuggestions. */
@Serializable
internal data class EinsatzVorschlag(
    val rides: List<EinsatzFahrt>,
    val chargeStops: List<JsonElement> = emptyList(),
    val standby: Boolean = false,
    val id: String,
    val dayIso: String,
    val driverId: String,
    val name: String,
    val start: String,
    val end: String,
    val hours: String,
    val stops: List<String>,
    val startMinutes: Int,
    val endMinutes: Int,
    val vehicleLabel: String,
    val vehicleIsEv: Boolean,
    val vehicleId: String,
    val shiftKm: Int? = null,
    val chargeStopCount: Int,
    val rideIds: List<String>,
    val minRangeReserveKm: Int? = null,
)

/** Ergebnis eines Planungstags (plannedByDay[iso]). */
@Serializable
internal data class EinsatzTagErgebnis(
    val strategyKey: String,
    val suggestions: List<EinsatzVorschlag>,
    val source: String,
    val gap: Double? = null,
    val solverStatus: String,
    val unassignedCount: Int,
    val rideCount: Int,
    val tunnel: JsonElement? = null,
    val fleetKpis: JsonElement? = null,
    val engine: JsonElement? = null,
    val neueFahrten: List<String> = emptyList(),
)

/** Vergebene Schicht, wie die Zeilen an onApplySuggestions. */
@Serializable
internal data class EinsatzDienstZeile(
    val driverId: String,
    val serviceStart: String,
    val serviceEnd: String,
    val rideIds: List<String>,
    val vehicleId: String,
)

/** Zeitraum aus dem Kalender. */
@Serializable
internal data class EinsatzZeitraum(val von: String, val bis: String, val startZeit: String, val endZeit: String)

/** Fertig geplanter Einsatz (einsatzCache). */
@Serializable
internal data class EinsatzFertig(val tage: List<String>, val auswahl: EinsatzZeitraum? = null)

// MARK: - Speicher ueber das Schliessen hinaus (sessionStorage trisar_planer_cache_v1)

/**
 * Die Web-Caches leben im Modul und zusaetzlich im sessionStorage, damit ein teurer Solver-Lauf
 * das Schliessen und Neuladen uebersteht. Hier: im Speicher der App plus SharedPreferences,
 * mit dem heutigen Datum als Schluessel wie im Web.
 */
internal object EinsatzSpeicher {
    private const val SCHLUESSEL = "trisar_planer_cache_v1"

    var geplant: MutableMap<String, EinsatzTagErgebnis> = mutableMapOf()
    var angenommen: MutableMap<String, List<EinsatzDienstZeile>> = mutableMapOf()
    var abgelehnt: MutableSet<String> = mutableSetOf()
    var uebernommen: MutableSet<String> = mutableSetOf()
    var einsatz: EinsatzFertig? = null
    private var geladen = false

    @Serializable
    private data class Ablage(
        val today: String,
        val planned: Map<String, EinsatzTagErgebnis> = emptyMap(),
        val accepted: Map<String, List<EinsatzDienstZeile>> = emptyMap(),
        val dismissed: List<String> = emptyList(),
        val acceptedIds: List<String> = emptyList(),
        val einsatz: EinsatzFertig? = null,
    )

    /** Einmal aus der Ablage lesen (nach PlanAblage.einrichten). */
    fun laden() {
        if (geladen) return
        geladen = true
        val roh = PlanAblage.text(SCHLUESSEL) ?: return
        val a = runCatching { planJson.decodeFromString(Ablage.serializer(), roh) }.getOrNull() ?: return
        if (a.today != EinsatzUhr.heute()) return
        geplant = a.planned.toMutableMap()
        angenommen = a.accepted.toMutableMap()
        abgelehnt = a.dismissed.toMutableSet()
        uebernommen = a.acceptedIds.toMutableSet()
        einsatz = a.einsatz
    }

    fun sichern() {
        val a = Ablage(EinsatzUhr.heute(), geplant, angenommen, abgelehnt.toList(), uebernommen.toList(), einsatz)
        runCatching { PlanAblage.setzen(SCHLUESSEL, planJson.encodeToString(Ablage.serializer(), a)) }
    }
}
