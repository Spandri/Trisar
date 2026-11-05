package de.trisar.dispo.karte

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.graphics.Color
import de.trisar.kern.Backend
import de.trisar.kern.hex
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
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.doubleOrNull
import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.LocalTime
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.temporal.ChronoUnit
import kotlin.math.ceil
import kotlin.math.max
import kotlin.math.roundToInt

/** Zum Aufraeumen nach dem Verlassen einer Seite (Kanal abmelden), unabhaengig von deren Scope. */
internal val kartenAufraeumen = CoroutineScope(SupervisorJob() + Dispatchers.Main)

// MARK: Hilfen fuer JSON-Zeilen (wie text/zahl in KartenDaten.swift)

internal fun jText(w: JsonElement?): String = when (w) {
    null, is JsonNull -> ""
    is JsonPrimitive -> w.content.trim()
    else -> ""
}

internal fun jZahl(w: JsonElement?): Double? = when (w) {
    null, is JsonNull -> null
    is JsonPrimitive -> w.doubleOrNull
    else -> null
}

internal fun jBool(w: JsonElement?): Boolean? = (w as? JsonPrimitive)?.takeIf { !it.isString && it !is JsonNull }?.booleanOrNull

/** Zustand eines Fahrers auf der Karte (KartenView.jsx): Rot = aktiv, Gelb = inaktiv, Gruen = frei. */
internal enum class FahrerZustand(val titel: String, val farbe: Color) {
    AKTIV("Aktiv", hex(0xFF6F63)),
    INAKTIV("Inaktiv", hex(0xE3F654)),
    FREI("Frei", hex(0x59BE80));

    /** Fahrer_Pin_Trisar_01_*, bei Zuendung aus die Variante mit blassem Weiss. */
    fun pinBild(zuendungAus: Boolean): String {
        val f = when (this) { AKTIV -> "rot"; INAKTIV -> "gelb"; FREI -> "gruen" }
        return "Fahrer_Pin_Trisar_01_$f" + if (zuendungAus) "_zuendung_aus" else ""
    }
}

internal data class KartenPunkt(val lat: Double, val lng: Double)

/** Ort in der Fahrtinfo des Blatts (Typ, Icon, kurzer Name). */
internal data class KartenOrt(val typ: String, val icon: String?, val name: String)

/** buildDriverRideInfo: Zeiten und Orte fuer das Blatt. */
internal data class KartenFahrtInfo(
    val dienststart: String = "--:--",
    val dienstende: String = "--:--",
    val abfahrt: String = "--:--",
    val ankunft: String = "--:--",
    val fahrMinuten: Int = 0,
    val unterwegs: Boolean = false,
    val von: KartenOrt = KartenOrt("-", null, "Keine aktive Fahrt"),
    val nach: KartenOrt = KartenOrt("-", null, "-"),
)

/** buildDriverActiveRide: was die Karte als Route zeichnet. */
internal data class KartenFahrt(
    val id: String,
    val status: String,
    val vonSuche: String,
    val nachSuche: String,
    val kolonnenFahrerIDs: List<String> = emptyList(),
)

internal data class KartenFahrer(
    val id: String,
    val name: String,
    val bildURL: String,
    val zuendungAus: Boolean,
    val nummer: String?,
    val telefon: String,
    val kennzeichen: String,
    val fahrzeug: String,
    val lat: Double,
    val lng: Double,
    val zustand: FahrerZustand,
    val info: KartenFahrtInfo,
    val fahrt: KartenFahrt?,
) {
    val ort get() = KartenPunkt(lat, lng)
    val vorname get() = name.split(" ").firstOrNull { it.isNotEmpty() } ?: "Fahrer"
}

/**
 * Filter der Karte (kartenFilter in App.jsx). Geteilt, damit er wie im Web beim
 * Wechsel zwischen Karte und Filter erhalten bleibt.
 */
internal object KartenFilter {
    var fahrerSuche by mutableStateOf("")
        private set
    val gewaehlteFahrerIDs = mutableStateListOf<String>()
    var feierabendMinuten by mutableStateOf("")
    var limousine by mutableStateOf(false)
    var suv by mutableStateOf(false)
    var van by mutableStateOf(false)
    var coupe by mutableStateOf(false)

    fun sucheSetzen(neu: String) {
        fahrerSuche = neu
        if (neu.isBlank()) gewaehlteFahrerIDs.clear()
    }

    fun zuruecksetzen() {
        sucheSetzen(""); feierabendMinuten = ""
        limousine = false; suv = false; van = false; coupe = false
    }
}

/**
 * Laedt Fahrer, Live-Standorte, Zuendung, Fahrten und Kolonnen wie loadDriversFromDb in
 * KartenView.jsx und haelt sie per Realtime (driver_live_locations, vehicle_telemetry_live,
 * jobs, convoy_assignments) und alle 15 s aktuell. Liest nur.
 */
internal class KartenDaten {
    var fahrer by mutableStateOf(zwischenspeicher)
        private set
    var fehler by mutableStateOf("")
        private set
    /** Inaktiv-Fenster in Stunden (Regler nach langem Druck auf "Inaktiv"). */
    var vorschauStunden = 1.0

    /** Letzter Zuendungsstand je Fahrer, damit nur ein Wechsel neu laedt. */
    private val zuendungStand = HashMap<String, Boolean?>()
    private var laeuft = false
    /** Aenderung waehrend eines Ladens: danach noch einmal laden statt verwerfen. */
    private var nochmal = false
    private var kanal: RealtimeChannel? = null
    private val auftraege = mutableListOf<Job>()

    companion object {
        /** Wie lastDriverMapCache: beim erneuten Oeffnen stehen die Fahrer sofort da. */
        private var zwischenspeicher: List<KartenFahrer> = emptyList()
    }

    fun starten(scope: CoroutineScope) {
        auftraege += scope.launch {
            laden()
            // Eigener Name je Oeffnen: der alte Kanal wird im Hintergrund abgemeldet und darf den neuen nicht treffen.
            val k = Backend.client.channel("ko-karten-live-refresh-${System.currentTimeMillis()}")
            val stroeme: List<Flow<PostgresAction>> = listOf("driver_live_locations", "jobs", "convoy_assignments").map { t ->
                k.postgresChangeFlow<PostgresAction>(schema = "public") { table = t }
            }
            val zuendung = k.postgresChangeFlow<PostgresAction>(schema = "public") { table = "vehicle_telemetry_live" }
            kanal = k
            stroeme.forEach { s -> auftraege += scope.launch { s.collect { laden() } } }
            auftraege += scope.launch { zuendung.collect { zuendungGeaendert(it) } }
            runCatching { k.subscribe() }
        }
        auftraege += scope.launch {
            while (isActive) {
                delay(15_000)
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

    /** Nur bei Wechsel der Zuendung neu laden, nicht bei jedem Datensatz. */
    private suspend fun zuendungGeaendert(a: PostgresAction) {
        val satz = when (a) {
            is PostgresAction.Insert -> a.record
            is PostgresAction.Update -> a.record
            else -> return
        }
        val id = jText(satz["driver_id"])
        if (id.isEmpty()) return
        val an = jBool(satz["ignition"])
        if (zuendungStand.containsKey(id) && zuendungStand[id] == an) return
        zuendungStand[id] = an
        laden()
    }

    // MARK: Laden

    private suspend fun abfrage(tabelle: String, spalten: String): List<JsonObject> =
        Backend.client.from(tabelle).select(Columns.raw(spalten)).decodeList<JsonObject>()

    suspend fun laden() {
        if (laeuft) { nochmal = true; return }
        laeuft = true
        try {
            do {
                nochmal = false
                einmalLaden()
            } while (nochmal)
        } finally {
            laeuft = false
        }
    }

    private suspend fun einmalLaden() {
        fehler = ""
        try {
            // Gleiche Rueckfall-Reihe wie im Web, falls eine Spalte fehlt.
            val basis = "id, first_name, last_name, phone, role, is_dispo, vehicle_id, driver_number, vehicles:vehicle_id(license_plate, brand_model, trim)"
            val mitBild = "$basis, avatar_url"
            val kandidaten = listOf(
                "$mitBild, driver_activity_state, service_start_time, service_end_time",
                "$mitBild, driver_activity_state",
                "$mitBild, service_start_time, service_end_time",
                mitBild,
                "$basis, driver_activity_state, service_start_time, service_end_time",
                "$basis, driver_activity_state",
                "$basis, service_start_time, service_end_time",
                basis,
            )
            var profile: List<JsonObject>? = null
            var letzterFehler: Exception? = null
            for (k in kandidaten) {
                try { profile = abfrage("profiles", k); break } catch (e: Exception) { letzterFehler = e }
            }
            if (profile == null) throw letzterFehler ?: IllegalStateException("Keine Antwort")

            val live = abfrage("driver_live_locations", "driver_id, lat, lng, captured_at, active_job_id")

            // Zuendung aus dem OBD-Tracker. Fehlt die Tabelle oder das Recht, bleibt alles wie bisher.
            val zuendung = runCatching { abfrage("vehicle_telemetry_live", "driver_id, ignition, captured_at") }.getOrDefault(emptyList())
            val zuendungJe = HashMap<String, Boolean>()
            for (z in zuendung) {
                val id = jText(z["driver_id"])
                if (id.isEmpty()) continue
                val b = jBool(z["ignition"])
                if (b != null) zuendungJe[id] = b
                zuendungStand[id] = b
            }

            // Wie im Web (JOBS_SELECT_NO_ROUTE): mit Fahrzeit und Live-Restfahrzeit fuer die ETA.
            // Fehlen die ext_-Spalten, ohne sie.
            val jobsBasis = "id, driver_id, ride_date, etd, status, pickup_name, pickup_address, dropoff_name, dropoff_address"
            val jobsMitZeit = jobsBasis + ", ext_route_duration_mins, ext_route_duration_in_traffic_mins, " +
                "ext_driver_to_dropoff_duration_mins, ext_driver_to_dropoff_duration_in_traffic_mins, ext_driver_to_dropoff_last_sync_at"
            var jobs: List<JsonObject> = emptyList()
            for (spalten in listOf(jobsMitZeit, jobsBasis)) {
                try {
                    jobs = Backend.client.from("jobs").select(Columns.raw(spalten)) {
                        order("ride_date", Order.ASCENDING)
                        order("etd", Order.ASCENDING)
                    }.decodeList<JsonObject>()
                    break
                } catch (e: Exception) {
                    if (spalten == jobsBasis) throw e
                }
            }

            // Kolonnen in Stuecken zu 30 Fahrten (IN_QUERY_BATCH_SIZE). Fehlt die Tabelle: keine Kolonnen.
            val jobIDs = jobs.map { jText(it["id"]) }.filter { it.isNotEmpty() }
            val kolonnenZeilen = mutableListOf<JsonObject>()
            for (stueck in jobIDs.chunked(30)) {
                try {
                    kolonnenZeilen += Backend.client.from("convoy_assignments").select(Columns.raw("job_id, driver_id, response_status")) {
                        filter { isIn("job_id", stueck) }
                    }.decodeList<JsonObject>()
                } catch (e: Exception) {
                    if (Regex("convoy_assignments|does not exist", RegexOption.IGNORE_CASE).containsMatchIn(e.toString())) {
                        kolonnenZeilen.clear()
                        break
                    }
                    throw e
                }
            }

            val (liste, sichtbar) = abbilden(profile, live, zuendungJe, jobs, kolonnenZeilen)
            if (liste.isEmpty() && sichtbar > 0) {
                fehler = "Keine Live-Fahrerstandorte sichtbar. Bitte Anmeldung/Session und RLS-Policy fuer `driver_live_locations` pruefen."
            }
            if (liste.isNotEmpty()) {
                fahrer = liste
                zwischenspeicher = liste
            }
        } catch (e: kotlinx.coroutines.CancellationException) {
            throw e
        } catch (e: Exception) {
            fehler = "Fahrer-Standorte konnten nicht geladen werden: ${e.message ?: e}"
        }
    }

    // MARK: Abbilden (mapped in loadDriversFromDb)

    private fun abbilden(
        profile: List<JsonObject>, live: List<JsonObject>, zuendung: Map<String, Boolean>,
        jobs: List<JsonObject>, kolonnen: List<JsonObject>,
    ): Pair<List<KartenFahrer>, Int> {
        // Nur die Rolle entscheidet, das Dispo-Recht (is_dispo) macht niemanden zum Nicht-Fahrer.
        val dispoRollen = setOf("dispo", "dispatcher", "admin", "koordinator", "coordinator", "pruefung")
        val sichtbar = profile.filter { jText(it["role"]).lowercase() !in dispoRollen }
        val profilJe = sichtbar.associateBy { jText(it["id"]) }
        // Ausgeblendete Konten (Dispo, Pruefkonto) auch ohne Profil nicht als Punkt zeigen.
        val versteckt = profile.map { jText(it["id"]) }.toSet() - profilJe.keys
        val jobJe = jobs.associateBy { jText(it["id"]) }
        val jobsJeFahrer = HashMap<String, MutableList<JsonObject>>()
        fun zuordnen(f: String, job: JsonObject) {
            if (f.isEmpty()) return
            jobsJeFahrer.getOrPut(f) { mutableListOf() }.add(job)
        }
        for (j in jobs) zuordnen(jText(j["driver_id"]), j)

        // Wer faehrt in welcher Kolonne mit? Abgelehnte Zuweisungen zaehlen nicht.
        fun kStatus(k: JsonObject) = KartenRegeln.status(k["response_status"]).ifEmpty { "pending" }
        val kolonneJeFahrt = HashMap<String, MutableSet<String>>()
        for (k in kolonnen) {
            if (kStatus(k) == "refused") continue
            val jobID = jText(k["job_id"]); val fahrerID = jText(k["driver_id"])
            if (jobID.isEmpty() || fahrerID.isEmpty()) continue
            kolonneJeFahrt.getOrPut(jobID) { linkedSetOf() }.add(fahrerID)
        }
        for (j in jobs) {
            val jobID = jText(j["id"]); val fahrerID = jText(j["driver_id"])
            if (jobID.isNotEmpty() && fahrerID.isNotEmpty()) kolonneJeFahrt[jobID]?.add(fahrerID)
        }
        for (k in kolonnen) {
            if (kStatus(k) == "refused") continue
            jobJe[jText(k["job_id"])]?.let { zuordnen(jText(k["driver_id"]), it) }
        }

        val jetzt = LocalDateTime.now()
        val fensterMin = (max(0.0, vorschauStunden) * 60).roundToInt().toLong()

        val liste = live.mapNotNull { zeile ->
            val id = jText(zeile["driver_id"])
            val lat = jZahl(zeile["lat"]); val lng = jZahl(zeile["lng"])
            if (id.isEmpty() || lat == null || lng == null || id in versteckt) return@mapNotNull null
            val p = profilJe[id]
            val name = listOf(jText(p?.get("first_name")), jText(p?.get("last_name"))).filter { it.isNotEmpty() }.joinToString(" ")
            val fz = p?.get("vehicles") as? JsonObject
            val kennzeichen = jText(fz?.get("license_plate"))
            val fahrzeug = listOf(jText(fz?.get("brand_model")), jText(fz?.get("trim"))).filter { it.isNotEmpty() }.joinToString(" ")

            val seineJobs = jobsJeFahrer[id] ?: emptyList<JsonObject>()
            val liveJobID = jText(zeile["active_job_id"])
            val liveJob = if (liveJobID.isEmpty()) null else jobJe[liveJobID]
            val aktiverJob = seineJobs.firstOrNull { KartenRegeln.istAktiv(it["status"]) }
                ?: liveJob?.takeIf { KartenRegeln.istAktiv(it["status"]) }
            val kommende = seineJobs
                .filter { !KartenRegeln.istErledigt(it["status"]) && !KartenRegeln.istAktiv(it["status"]) }
                .mapNotNull { j -> KartenRegeln.zeitpunkt(j)?.let { j to it } }
                .sortedBy { it.second }
            val naechster = kommende.firstOrNull { !it.second.isBefore(jetzt) } ?: kommende.firstOrNull()
            val imFenster = naechster?.let { !it.second.isBefore(jetzt) && !it.second.isAfter(jetzt.plusMinutes(fensterMin)) } ?: false
            val zustand = if (aktiverJob != null) FahrerZustand.AKTIV else if (imFenster) FahrerZustand.INAKTIV else FahrerZustand.FREI

            val info = KartenRegeln.fahrtInfo(
                aktiverJob, naechster?.first, seineJobs,
                jText(p?.get("service_start_time")), jText(p?.get("service_end_time")), jetzt,
            )
            val routenJob = aktiverJob ?: naechster?.first
            var fahrt = routenJob?.let { KartenRegeln.fahrt(it) }
            val kolonne = fahrt?.let { kolonneJeFahrt[it.id] }
            if (fahrt != null && kolonne != null && kolonne.size > 1) fahrt = fahrt.copy(kolonnenFahrerIDs = kolonne.toList())
            val nummerText = jText(p?.get("driver_number"))

            KartenFahrer(
                id = id,
                name = name.ifEmpty { "Fahrer ${id.take(8)}" },
                bildURL = jText(p?.get("avatar_url")),
                zuendungAus = zuendung[id] == false,
                nummer = nummerText.ifEmpty { null },
                telefon = jText(p?.get("phone")),
                kennzeichen = kennzeichen.ifEmpty { "-" },
                fahrzeug = fahrzeug.ifEmpty { "Fahrzeug" },
                lat = lat, lng = lng, zustand = zustand, info = info, fahrt = fahrt,
            )
        }
        return liste to sichtbar.size
    }
}

/** Die kleinen Regeln aus KartenView.jsx und etaBerechnung.js (Status, Zeiten, Orte). */
internal object KartenRegeln {
    private val offen = setOf("pending", "assigned", "offen", "new", "requested", "offered", "zugewiesen")
    private val aktiv = setOf("at_pickup", "pickup", "beim_pickup", "beim pickup", "in_progress", "started",
        "unterwegs", "active", "ongoing", "on_trip")
    private val erledigt = setOf("done", "completed", "arrived", "cancelled", "canceled", "refused", "stoniert")
    private val unterwegsStatus = setOf("in_progress", "unterwegs", "started", "on_trip", "ongoing", "active")

    fun status(w: JsonElement?) = jText(w).lowercase()
    fun status(w: String) = w.trim().lowercase()
    fun istOffen(s: String) = status(s) in offen
    fun istAktiv(w: JsonElement?) = status(w) in aktiv
    fun istErledigt(w: JsonElement?) = status(w) in erledigt

    /** toIsoDate: yyyy-MM-dd, ISO mit T oder dd.MM.yyyy. */
    fun isoTag(w: JsonElement?): String {
        val roh = jText(w)
        if (Regex("^\\d{4}-\\d{2}-\\d{2}").containsMatchIn(roh)) return roh.take(10)
        val t = roh.split(".")
        if (t.size == 3 && t[0].length == 2 && t[1].length == 2 && t[2].length == 4) return "${t[2]}-${t[1]}-${t[0]}"
        return ""
    }

    /** toClockTime: "H:MM" am Anfang, gueltige Uhrzeit. */
    fun uhr(roh: String): Pair<Int, Int>? {
        val m = Regex("^(\\d{1,2}):(\\d{2})").find(roh.trim()) ?: return null
        val h = m.groupValues[1].toInt(); val mi = m.groupValues[2].toInt()
        if (h !in 0..23 || mi !in 0..59) return null
        return h to mi
    }

    fun uhrText(roh: String, ersatz: String = "--:--"): String {
        val (h, m) = uhr(roh) ?: return ersatz
        return "%02d:%02d".format(h, m)
    }

    fun zeitpunkt(job: JsonObject): LocalDateTime? {
        val tag = isoTag(job["ride_date"])
        if (tag.isEmpty()) return null
        val (h, m) = uhr(jText(job["etd"])) ?: return null
        return runCatching { LocalDate.parse(tag).atTime(h, m) }.getOrNull()
    }

    private fun uhrzeit(d: LocalDateTime) = "%02d:%02d".format(d.hour, d.minute)

    /** addMinutesToClock: heute um die Uhrzeit plus Minuten. */
    fun plusMinuten(uhrText: String, minuten: Int): String? {
        val (h, m) = uhr(uhrText) ?: return null
        return uhrzeit(LocalDate.now().atTime(h, m).plusMinutes(minuten.toLong()))
    }

    /** zeitAmTag aus etaBerechnung.js: Uhrzeit am Fahrtag (sonst heute). */
    private fun geplant(job: JsonObject, jetzt: LocalDateTime): LocalDateTime? {
        val (h, m) = uhr(uhrText(jText(job["etd"]), "")) ?: return null
        val tagRoh = jText(job["ride_date"]).take(10)
        val tag = if (Regex("^\\d{4}-\\d{2}-\\d{2}$").matches(tagRoh)) runCatching { LocalDate.parse(tagRoh) }.getOrNull() else null
        return (tag ?: jetzt.toLocalDate()).atTime(h, m)
    }

    /** berechneAbfahrt: noch nicht losgefahren und schon spaet dran -> jetzt. */
    fun abfahrt(job: JsonObject, jetzt: LocalDateTime): String? {
        val g = geplant(job, jetzt) ?: return null
        if (status(job["status"]) !in unterwegsStatus && g.isBefore(jetzt) && g.toLocalDate() == jetzt.toLocalDate()) return uhrzeit(jetzt)
        return uhrzeit(g)
    }

    /** Live-Restfahrzeit (ext_driver_to_dropoff_*), nur unterwegs und hoechstens 10 Minuten alt. */
    private fun liveRest(job: JsonObject, jetzt: LocalDateTime): Int? {
        if (status(job["status"]) !in unterwegsStatus) return null
        val verkehr = jZahl(job["ext_driver_to_dropoff_duration_in_traffic_mins"]) ?: 0.0
        val rest = if (verkehr != 0.0) verkehr else (jZahl(job["ext_driver_to_dropoff_duration_mins"]) ?: -1.0)
        if (rest < 0) return null
        val sync = isoDatum(jText(job["ext_driver_to_dropoff_last_sync_at"])) ?: return null
        val jetztInstant = jetzt.atZone(ZoneId.systemDefault()).toInstant()
        if (ChronoUnit.SECONDS.between(sync, jetztInstant) >= 10 * 60) return null
        return rest.toInt()
    }

    fun isoDatum(s: String): Instant? {
        if (s.isEmpty()) return null
        return runCatching { OffsetDateTime.parse(s).toInstant() }.getOrNull()
            ?: runCatching { Instant.parse(s) }.getOrNull()
            ?: runCatching { OffsetDateTime.parse(s.replace(" ", "T")).toInstant() }.getOrNull()
    }

    /** Uhrzeit "HH:mm" aus einem ISO-Zeitstempel (Datum.uhrzeit). */
    fun isoUhrzeit(s: String): String {
        val i = isoDatum(s) ?: return ""
        val t = LocalTime.ofInstant(i, ZoneId.systemDefault())
        return "%02d:%02d".format(t.hour, t.minute)
    }

    /** Fahrdauer der Fahrt: mit Verkehr, sonst ohne (toPositiveMinutes). */
    fun routenDauer(job: JsonObject): Int {
        for (k in listOf("ext_route_duration_in_traffic_mins", "ext_route_duration_mins")) {
            val z = jZahl(job[k])
            if (z != null && z > 0) return z.roundToInt()
        }
        return 0
    }

    /** restFahrzeit: Live-Rest, sonst Fahrdauer. */
    fun restFahrzeit(job: JsonObject, jetzt: LocalDateTime): Int = liveRest(job, jetzt) ?: routenDauer(job)

    /** berechneEta aus etaBerechnung.js. */
    fun ankunft(job: JsonObject, dauer: Int, jetzt: LocalDateTime): String? {
        liveRest(job, jetzt)?.let { return uhrzeit(jetzt.plusMinutes(it.toLong())) }
        val g = geplant(job, jetzt) ?: return null
        val start = if (g.isBefore(jetzt) && g.toLocalDate() == jetzt.toLocalDate()) jetzt else g
        return uhrzeit(start.plusMinutes(max(0, dauer).toLong()))
    }

    // MARK: Orte

    private fun kurz(text: String): String {
        val t = text.trim()
        if (t.isEmpty()) return ""
        val erster = t.split(",").firstOrNull()?.trim() ?: ""
        return erster.ifEmpty { t }
    }

    /** extractLocationLabel */
    fun ortName(name: String, adresse: String): String {
        val n = kurz(name)
        if (n.isNotEmpty()) return n
        val a = adresse.trim()
        if (a.isEmpty()) return "-"
        return kurz(a).ifEmpty { a }
    }

    /** buildLocationQuery */
    fun suche(name: String, adresse: String): String {
        if (name.isNotEmpty() && adresse.isNotEmpty() && name != adresse) return "$name, $adresse"
        return name.ifEmpty { adresse }
    }

    /** ortsArt + ortsIcon: Flughafen, Hotel oder Adresse (graue Icons). */
    fun ortsArt(name: String, adresse: String, start: Boolean): Pair<String, String> {
        val text = "$name $adresse".lowercase()
        fun passt(muster: String) = Regex("\\b($muster)\\b").containsMatchIn(text)
        if (passt("flughafen|airport|terminal|muc|fra|ber|ham|dus|str|cgn")) {
            return "Flughafen" to if (start) "Plain_Landen_Trisar_Icons_01_grau" else "Plain_Abflug_Trisar_Icons_01_grau"
        }
        if (passt("hotel|resort|hostel|inn|motel|guesthouse|suite|aparthotel|residence")) return "Hotel" to "House_Nav_Trisar_01_grau"
        return "Adresse" to "Pin_Nav_Trisar_Icons_01_grau"
    }

    private fun abholung(j: JsonObject) = jText(j["pickup_name"]) to jText(j["pickup_address"])
    private fun ziel(j: JsonObject) = jText(j["dropoff_name"]) to jText(j["dropoff_address"])

    /** buildDriverRideInfo */
    fun fahrtInfo(
        aktiv: JsonObject?, naechster: JsonObject?, alle: List<JsonObject>,
        dienstStart: String, dienstEnde: String, jetzt: LocalDateTime,
    ): KartenFahrtInfo {
        val sortiert = alle.mapNotNull { j -> zeitpunkt(j)?.let { j to it } }.sortedBy { it.second }
        val erster = sortiert.firstOrNull()?.first
        val letzter = sortiert.lastOrNull()?.first
        val start = uhrText(if (dienstStart.isEmpty()) jText(erster?.get("etd")) else dienstStart)
        val endeBasis = if (dienstEnde.isNotEmpty()) dienstEnde
        else plusMinuten(uhrText(jText(letzter?.get("etd"))), letzter?.let { routenDauer(it) } ?: 0) ?: jText(letzter?.get("etd"))
        var info = KartenFahrtInfo(dienststart = start, dienstende = uhrText(endeBasis))

        val job = aktiv ?: naechster ?: return info
        val geplanteAbfahrt = uhrText(jText(job["etd"]))
        val (vn, va) = abholung(job)
        val (zn, za) = ziel(job)
        val s = ortsArt(vn, va, true)
        val z = ortsArt(zn, za, false)
        info = info.copy(
            abfahrt = abfahrt(job, jetzt) ?: geplanteAbfahrt,
            ankunft = ankunft(job, routenDauer(job), jetzt) ?: "--:--",
            fahrMinuten = restFahrzeit(job, jetzt),
            unterwegs = status(job["status"]) in unterwegsStatus,
            von = KartenOrt(s.first, s.second, ortName(vn, va)),
            nach = KartenOrt(z.first, z.second, ortName(zn, za)),
        )
        return info
    }

    /** buildDriverActiveRide: ohne Abhol- oder Zieltext keine Route. */
    fun fahrt(job: JsonObject): KartenFahrt? {
        val (vn, va) = abholung(job)
        val (zn, za) = ziel(job)
        val von = suche(vn, va)
        val nach = suche(zn, za)
        if (von.isEmpty() || nach.isEmpty()) return null
        return KartenFahrt(jText(job["id"]), status(job["status"]), von, nach)
    }

    /** formatDuration: "12 min" oder "1:05 h". */
    fun dauer(m: Int): String {
        if (m <= 0) return "0 min"
        if (m < 60) return "$m min"
        return "${m / 60}:${"%02d".format(m % 60)} h"
    }

    fun minutenAufrunden(sekunden: Int) = ceil(sekunden / 60.0).toInt()
}
