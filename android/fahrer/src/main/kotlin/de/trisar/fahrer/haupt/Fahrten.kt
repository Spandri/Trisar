package de.trisar.fahrer.haupt

import android.app.Application
import android.content.Context
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import de.trisar.kern.Backend
import de.trisar.kern.FahrzeugZeile
import io.github.jan.supabase.functions.functions
import io.github.jan.supabase.postgrest.from
import io.github.jan.supabase.postgrest.query.Columns
import io.github.jan.supabase.postgrest.query.Count
import io.github.jan.supabase.postgrest.query.Order
import io.github.jan.supabase.postgrest.query.filter.FilterOperator
import io.github.jan.supabase.postgrest.result.PostgrestResult
import io.github.jan.supabase.realtime.PostgresAction
import io.github.jan.supabase.realtime.RealtimeChannel
import io.github.jan.supabase.realtime.channel
import io.github.jan.supabase.realtime.postgresChangeFlow
import io.github.jan.supabase.realtime.realtime
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.launchIn
import kotlinx.coroutines.flow.onEach
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.time.Instant
import java.time.LocalDate
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.temporal.ChronoUnit
import java.util.Locale

/** Antwort der Datenbank tolerant lesen (unbekannte Spalten ignorieren). */
internal inline fun <reified T> PostgrestResult.liste(): List<T> = Backend.json.decodeFromString(data)

// Datenzeilen (wie in der Datenbank)

@Serializable
internal data class FahrtZeile(
    val id: String,
    val status: String? = null,
    val trip_type: String? = null,
    val pickup_name: String? = null,
    val pickup_address: String? = null,
    val dropoff_name: String? = null,
    val dropoff_address: String? = null,
    val train_number: String? = null,
    val flight_number: String? = null,
    val ride_date: String? = null,
    val pickup_date: String? = null,
    val service_date: String? = null,
    val created_at: String? = null,
    val etd: String? = null,
    val original_etd: String? = null,
    val convoy_id: String? = null,
    val driver_id: String? = null,
) {
    companion object {
        // Alle Spalten wie iOS (select()). Eine feste Liste bricht das ganze Laden ab, sobald eine
        // Spalte live fehlt (pickup_date gibt es nicht ueberall). Unbekannte Felder ignoriert Backend.json.
        const val SPALTEN = "*"
    }
}

@Serializable
data class DienstAnfrage(
    val id: String,
    val service_date: String? = null,
    val service_start_time: String? = null,
    val service_end_time: String? = null,
    val status: String? = null,
) {
    val angenommen get() = status.orEmpty().lowercase() == "accepted"
}

@Serializable private data class ProfilFahrzeug(val vehicle_id: String? = null)
@Serializable private data class KolonnenLink(val job_id: String? = null, val response_status: String? = null)
@Serializable private data class KolonnenZuordnung(val job_id: String, val driver_id: String? = null, val response_status: String? = null)
@Serializable private data class IDZeile(val id: String)
@Serializable private data class GelesenZeile(val last_read_at: String? = null)

/** Aufbereitete Fahrt, entspricht dem Job-Objekt der Web-App (FahrerApp.jsx). */
data class Fahrt(
    val id: String,
    val status: String,
    val tripType: String?,
    val abholName: String,
    val abholAdresse: String,
    val zielName: String,
    val zielAdresse: String,
    val zugNummer: String?,
    val flug: String,
    val fahrtDatum: String,   // yyyy-MM-dd
    val etd: String,          // HH:mm
    val planEtd: String?,
    val kolonnenID: String?,
    val istKolonne: Boolean,
    val meineAntwort: String, // convoy_assignments.response_status
) {
    val abholKurz get() = Adresse.kurz(abholName, abholAdresse)
    val zielKurz get() = Adresse.kurz(zielName, zielAdresse)
    val istFlughafen get() = tripType == "airport"
    val istZug: Boolean get() {
        if (tripType == "train") return true
        if (!zugNummer.isNullOrBlank()) return true
        return Regex("^([A-Z]{1,4}\\s*)?\\d{2,5}$").matches(flug.trim().uppercase())
    }

    /** Fahrer muss noch annehmen oder ablehnen (canRespond der Web-App). */
    val wartetAufAntwort: Boolean get() =
        if (istKolonne) meineAntwort.lowercase() in setOf("pending", "new", "offered", "requested")
        else status.lowercase() in setOf("pending", "new", "offered", "requested", "assigned_pending")

    /** Angenommen = Lime-Rand um die Karte. */
    val angenommen get() = if (istKolonne) meineAntwort.lowercase() == "accepted" else status.lowercase() == "assigned"
}

object Adresse {
    private val hausnummer = Regex("^\\d+\\s?[a-zA-Z]?(\\s*[-/]\\s*\\d+\\s?[a-zA-Z]?)?$")

    /** Wie kurzAdresse() der Web-App: "153, Thalkirchner Straße, ..." -> "Thalkirchner Straße 153". */
    fun kurzAdresse(text: String): String {
        val roh = text.trim()
        if (roh.isEmpty()) return ""
        val teile = roh.split(",").map { it.trim() }.filter { it.isNotEmpty() }
        val erster = teile.firstOrNull() ?: return roh
        if (hausnummer.matches(erster) && teile.size > 1) return "${teile[1]} $erster"
        return erster
    }

    fun kurz(name: String, adresse: String): String {
        val n = name.trim()
        if (n.isNotEmpty()) return kurzAdresse(n).ifEmpty { n }
        val a = adresse.trim()
        if (a.isEmpty()) return "Unbekannt"
        return kurzAdresse(a).ifEmpty { a }
    }
}

/** Datumshilfen wie in der Web-App (lokale Zeit, yyyy-MM-dd). */
object Datum {
    private val de = Locale.GERMANY
    fun tagWert(datum: LocalDate = LocalDate.now()): String = datum.toString()
    fun ausTagWert(wert: String): LocalDate = runCatching { LocalDate.parse(wert.take(10)) }.getOrElse { LocalDate.now() }
    fun iso(): String = Instant.now().toString()

    /** "Heute", "Morgen", "Gestern" oder "dd.MM." (formatRideDayLabel). */
    fun tagEtikett(wert: String): String {
        val ziel = ausTagWert(wert)
        return when (ChronoUnit.DAYS.between(LocalDate.now(), ziel)) {
            0L -> "Heute"
            1L -> "Morgen"
            -1L -> "Gestern"
            else -> ziel.format(DateTimeFormatter.ofPattern("dd.MM.", de))
        }
    }

    /** "Mittwoch 04.11." (formatDividerLabel). */
    fun trennzeile(wert: String): String = ausTagWert(wert).format(DateTimeFormatter.ofPattern("EEEE dd.MM.", de))

    /** ISO oder Postgres-Zeit ("2026-11-04 15:44:47.304+00") lesen. */
    fun ausISO(text: String): Instant? {
        runCatching { return Instant.parse(text) }
        runCatching { return OffsetDateTime.parse(text).toInstant() }
        val t = text.replace(' ', 'T').let { if (Regex("[+-]\\d{2}$").containsMatchIn(it)) "$it:00" else it }
        runCatching { return OffsetDateTime.parse(t).toInstant() }
        return null
    }

    fun uhrzeit(i: Instant): String = DateTimeFormatter.ofPattern("HH:mm", de).withZone(ZoneId.systemDefault()).format(i)
}

/** Ungelesene Nachrichten im Kolonnen-Chat (refreshUnreadChatState). Gelesen-Stand lokal und in chat_reads. */
object KolonnenUngelesen {
    private fun schluessel(fahrer: String, chat: String) = "trisar-gelesen-$fahrer-group-$chat"

    suspend fun anzahl(ctx: Context, chatID: String, fahrerID: String): Int {
        val lokal = ctx.getSharedPreferences("trisar", Context.MODE_PRIVATE).getString(schluessel(fahrerID, chatID), null)
        val entfernt = runCatching {
            Backend.client.from("chat_reads").select(Columns.raw("last_read_at")) {
                filter { eq("user_id", fahrerID); eq("chat_type", "group"); eq("chat_id", chatID) }
                limit(1)
            }.liste<GelesenZeile>().firstOrNull()?.last_read_at
        }.getOrNull()
        // Spaeterer der beiden Zeitpunkte zaehlt.
        val zuletzt = listOfNotNull(lokal, entfernt).maxByOrNull { Datum.ausISO(it) ?: Instant.EPOCH }
        return runCatching {
            Backend.client.from("messages").select(Columns.raw("id")) {
                head = true
                count(Count.EXACT)
                filter {
                    eq("target_type", "group"); eq("target_id", chatID); neq("sender_id", fahrerID)
                    if (zuletzt != null) gt("created_at", zuletzt)
                }
            }.countOrNull()?.toInt() ?: 0
        }.getOrDefault(0)
    }
}

/**
 * Laedt Fahrten, Fahrzeug und Dienstanfragen des Fahrers, haelt sie per Realtime aktuell.
 * Gleiche Abfragen wie loadData() in FahrerApp.jsx (FahrtenSpeicher in iOS).
 */
class FahrtenSpeicher(app: Application) : AndroidViewModel(app) {
    val fahrten = MutableStateFlow<List<Fahrt>>(emptyList())
    val fahrzeug = MutableStateFlow<FahrzeugZeile?>(null)
    val dienstAnfragen = MutableStateFlow<List<DienstAnfrage>>(emptyList())
    val geladen = MutableStateFlow(false)
    val arbeitet = MutableStateFlow(false)
    val fehler = MutableStateFlow<String?>(null)
    /** Ungelesene Nachrichten je Kolonnen-Chat (convoy_id). */
    val ungelesen = MutableStateFlow<Map<String, Int>>(emptyMap())
    val dienstArbeitetID = MutableStateFlow<String?>(null)

    var fahrerID: String? = null
        private set
    private var kanal: RealtimeChannel? = null
    private val beobachter = mutableListOf<Job>()
    private var nachladen: Job? = null

    private val versteckt = setOf("done", "completed", "arrived", "beendet", "cancelled", "canceled", "refused", "storniert", "stoniert")

    fun setzeFahrer(id: String?) {
        if (id == fahrerID) return
        fahrerID = id
        fahrten.value = emptyList()
        fahrzeug.value = null
        dienstAnfragen.value = emptyList()
        geladen.value = false
        viewModelScope.launch {
            realtimeBeenden()
            if (id == null) return@launch
            laden()
            realtimeStarten()
        }
    }

    fun neuLaden() { viewModelScope.launch { laden() } }

    suspend fun laden() {
        val fahrer = fahrerID ?: return
        try {
            coroutineScope {
                val profilA = async {
                    Backend.client.from("profiles").select(Columns.raw("vehicle_id")) {
                        filter { eq("id", fahrer) }; limit(1)
                    }.liste<ProfilFahrzeug>()
                }
                val direktA = async {
                    Backend.client.from("jobs").select(Columns.raw(FahrtZeile.SPALTEN)) {
                        filter { eq("driver_id", fahrer); neq("status", "cancelled"); neq("status", "refused") }
                        order("created_at", Order.DESCENDING)
                    }.liste<FahrtZeile>()
                }
                val kolonnenA = async {
                    runCatching {
                        Backend.client.from("convoy_assignments").select(Columns.raw("job_id,response_status")) {
                            filter { eq("driver_id", fahrer) }
                        }.liste<KolonnenLink>()
                    }.getOrDefault(emptyList())
                }
                val dienstA = async {
                    runCatching {
                        Backend.client.from("driver_service_requests").select(Columns.raw("id,service_date,service_start_time,service_end_time,status")) {
                            filter { eq("driver_id", fahrer); isIn("status", listOf("pending", "accepted")) }
                            order("created_at", Order.DESCENDING)
                        }.liste<DienstAnfrage>()
                    }.getOrDefault(emptyList())
                }
                val profil = profilA.await()
                val direkt = direktA.await()
                val links = kolonnenA.await()
                val dienste = dienstA.await()

                val kolonnenIDs = links.filter { (it.response_status ?: "pending") != "refused" }.mapNotNull { it.job_id }.distinct()
                val kolonnenFahrten = if (kolonnenIDs.isEmpty()) emptyList() else
                    Backend.client.from("jobs").select(Columns.raw(FahrtZeile.SPALTEN)) {
                        filter { isIn("id", kolonnenIDs); neq("status", "cancelled") }
                    }.liste<FahrtZeile>()

                val proID = LinkedHashMap<String, FahrtZeile>()
                (direkt + kolonnenFahrten).forEach { proID[it.id] = it }
                val gestern = Datum.tagWert(LocalDate.now().minusDays(1))
                val sichtbar = proID.values.filter { z ->
                    z.status.orEmpty().lowercase() !in versteckt && fahrtDatum(z) >= gestern
                }

                // Kolonnen-Zuordnungen je Fahrt (fuer istKolonne und die eigene Antwort).
                val ids = sichtbar.map { it.id }
                val zuordnungen = if (ids.isEmpty()) emptyList() else runCatching {
                    Backend.client.from("convoy_assignments").select(Columns.raw("job_id,driver_id,response_status")) {
                        filter { isIn("job_id", ids) }
                    }.liste<KolonnenZuordnung>()
                }.getOrDefault(emptyList())
                val jeFahrt = zuordnungen.groupBy { it.job_id }

                fahrten.value = sichtbar.mapNotNull { z ->
                    val eigene = jeFahrt[z.id]?.firstOrNull { it.driver_id == fahrer }
                    val istKolonne = z.convoy_id != null || !jeFahrt[z.id].isNullOrEmpty()
                    if (istKolonne && eigene?.response_status == "refused") return@mapNotNull null
                    Fahrt(
                        id = z.id,
                        status = z.status.orEmpty(),
                        tripType = z.trip_type,
                        abholName = z.pickup_name.orEmpty(),
                        abholAdresse = z.pickup_address.orEmpty(),
                        zielName = z.dropoff_name.orEmpty(),
                        zielAdresse = z.dropoff_address.orEmpty(),
                        zugNummer = z.train_number,
                        flug = z.flight_number ?: z.train_number ?: "STADTFAHRT",
                        fahrtDatum = fahrtDatum(z),
                        etd = (z.etd ?: "12:00").take(5),
                        planEtd = z.original_etd?.take(5),
                        kolonnenID = z.convoy_id,
                        istKolonne = istKolonne,
                        meineAntwort = eigene?.response_status ?: "pending",
                    )
                }
                dienstAnfragen.value = dienste

                val fahrzeugID = profil.firstOrNull()?.vehicle_id
                fahrzeug.value = if (fahrzeugID != null) {
                    Backend.client.from("vehicles").select(Columns.raw(FahrzeugZeile.SPALTEN)) {
                        filter { eq("id", fahrzeugID) }; limit(1)
                    }.liste<FahrzeugZeile>().firstOrNull()
                } else null
                fehler.value = null
            }
        } catch (e: Exception) {
            if (e is kotlinx.coroutines.CancellationException) throw e
            fehler.value = e.message ?: e.toString()
        }
        geladen.value = true
        ungelesenAktualisieren()
    }

    suspend fun ungelesenAktualisieren() {
        val fahrer = fahrerID ?: return
        val neu = mutableMapOf<String, Int>()
        for (kolonne in fahrten.value.mapNotNull { it.kolonnenID }.toSet()) {
            neu[kolonne] = KolonnenUngelesen.anzahl(getApplication(), kolonne, fahrer)
        }
        ungelesen.value = neu
    }

    // Annehmen / Ablehnen (handleJobAction der Web-App)

    fun antworten(fahrt: Fahrt, annehmen: Boolean, grund: String? = null) {
        viewModelScope.launch { antwortenJetzt(fahrt, annehmen, grund) }
    }

    suspend fun antwortenJetzt(fahrt: Fahrt, annehmen: Boolean, grund: String? = null): Boolean {
        val fahrer = fahrerID ?: return false
        val vorher = fahrten.value
        // Sofort in der Liste zeigen, bei Fehler zuruecksetzen.
        fahrten.value = if (annehmen) vorher.map { f ->
            if (f.id != fahrt.id) f else if (f.istKolonne) f.copy(meineAntwort = "accepted") else f.copy(status = "assigned")
        } else vorher.filter { it.id != fahrt.id }
        arbeitet.value = true
        val jetzt = Datum.iso()
        val ablehnGrund = if (annehmen) null else grund?.trim()?.ifEmpty { null } ?: "Fahrer hat die Fahrt abgelehnt."
        try {
            if (fahrt.istKolonne) {
                Backend.client.from("convoy_assignments").upsert(buildJsonObject {
                    put("job_id", fahrt.id); put("driver_id", fahrer)
                    put("response_status", if (annehmen) "accepted" else "refused")
                    put("responded_at", jetzt)
                    put("refusal_reason", ablehnGrund?.let { JsonPrimitive(it) } ?: JsonNull)
                }) { onConflict = "job_id,driver_id" }
            } else {
                val ergebnis = Backend.client.from("jobs").update(buildJsonObject {
                    put("status", if (annehmen) "assigned" else "refused")
                    put("refused_by_driver_id", if (annehmen) JsonNull else JsonPrimitive(fahrer))
                    put("refusal_reason", ablehnGrund?.let { JsonPrimitive(it) } ?: JsonNull)
                    put("driver_response_status", if (annehmen) "accepted" else "refused")
                    put("driver_responded_at", jetzt)
                }) {
                    select(Columns.raw("id"))
                    filter { eq("id", fahrt.id); eq("driver_id", fahrer) }
                }.liste<IDZeile>()
                if (ergebnis.isEmpty()) throw IllegalStateException("Status konnte nicht gespeichert werden (keine Berechtigung).")
            }
            if (annehmen) {
                // Route und Anfahrt berechnen lassen, wie die Web-App nach dem Annehmen.
                runCatching {
                    Backend.client.functions.invoke("external-sync", body = buildJsonObject {
                        put("reason", "live_view")
                        put("job_ids", buildJsonArray { add(JsonPrimitive(fahrt.id)) })
                        put("requested_by", fahrer)
                    })
                }
            }
            arbeitet.value = false
            return true
        } catch (e: Exception) {
            if (e is kotlinx.coroutines.CancellationException) throw e
            fahrten.value = vorher
            fehler.value = "Aktion konnte nicht gespeichert werden: ${e.message}"
            arbeitet.value = false
            return false
        }
    }

    // Dienstanfrage (handleServiceRequestAction der Web-App)

    fun dienstAntworten(anfrage: DienstAnfrage, annehmen: Boolean) {
        val fahrer = fahrerID ?: return
        viewModelScope.launch {
            dienstArbeitetID.value = anfrage.id
            try {
                Backend.client.from("driver_service_requests").update(buildJsonObject {
                    put("status", if (annehmen) "accepted" else "refused")
                    put("responded_at", Datum.iso())
                    put("refusal_reason", if (annehmen) JsonNull else JsonPrimitive("Fahrer hat den Dienstplan abgelehnt."))
                }) { filter { eq("id", anfrage.id); eq("driver_id", fahrer) } }
                if (annehmen) {
                    Backend.client.from("profiles").update(buildJsonObject {
                        put("service_start_time", anfrage.service_start_time?.let { JsonPrimitive(it) } ?: JsonNull)
                        put("service_end_time", anfrage.service_end_time?.let { JsonPrimitive(it) } ?: JsonNull)
                        put("service_start_date", anfrage.service_date?.let { JsonPrimitive(it) } ?: JsonNull)
                        put("service_end_date", anfrage.service_date?.let { JsonPrimitive(it) } ?: JsonNull)
                    }) { filter { eq("id", fahrer) } }
                }
                dienstAnfragen.value = dienstAnfragen.value.mapNotNull { e ->
                    if (e.id != anfrage.id) e else if (annehmen) e.copy(status = "accepted") else null
                }
            } catch (e: Exception) {
                if (e is kotlinx.coroutines.CancellationException) throw e
                fehler.value = "Dienstplan-Anfrage konnte nicht gespeichert werden: ${e.message}"
            }
            dienstArbeitetID.value = null
        }
    }

    // Realtime

    private suspend fun realtimeStarten() {
        val fahrer = fahrerID ?: return
        val k = Backend.client.channel("fahrer-app-$fahrer")
        val stroeme = listOf("jobs" to "driver_id", "convoy_assignments" to "driver_id",
            "driver_service_requests" to "driver_id", "profiles" to "id").map { (tabelle, spalte) ->
            k.postgresChangeFlow<PostgresAction>(schema = "public") {
                table = tabelle
                filter(spalte, FilterOperator.EQ, fahrer)
            }
        }
        // Neue Chat-Nachrichten: nur Zaehler neu, die Fahrten bleiben.
        val nachrichten = k.postgresChangeFlow<PostgresAction>(schema = "public") { table = "messages" }
        kanal = k
        stroeme.forEach { s -> beobachter += s.onEach { spaeterLaden() }.launchIn(viewModelScope) }
        beobachter += nachrichten.onEach { ungelesenAktualisieren() }.launchIn(viewModelScope)
        runCatching { k.subscribe() }
    }

    private suspend fun realtimeBeenden() {
        beobachter.forEach { it.cancel() }
        beobachter.clear()
        kanal?.let { runCatching { Backend.client.realtime.removeChannel(it) } }
        kanal = null
    }

    /** Mehrere Aenderungen kurz hintereinander nur einmal laden. */
    private fun spaeterLaden() {
        nachladen?.cancel()
        nachladen = viewModelScope.launch {
            delay(400)
            laden()
        }
    }

    override fun onCleared() {
        val k = kanal
        beobachter.forEach { it.cancel() }
        if (k != null) CoroutineScope(Dispatchers.IO).launch { runCatching { Backend.client.realtime.removeChannel(k) } }
    }

    private fun fahrtDatum(z: FahrtZeile): String {
        val muster = Regex("^\\d{4}-\\d{2}-\\d{2}$")
        for (k in listOf(z.ride_date, z.pickup_date, z.service_date)) if (k != null && muster.matches(k)) return k
        val erstellt = z.created_at
        if (erstellt != null && erstellt.length >= 10 && muster.matches(erstellt.take(10))) return erstellt.take(10)
        return Datum.tagWert()
    }
}
