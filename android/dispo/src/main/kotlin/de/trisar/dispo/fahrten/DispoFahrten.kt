package de.trisar.dispo.fahrten

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
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
import kotlinx.coroutines.flow.launchIn
import kotlinx.coroutines.flow.onEach
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.time.LocalTime

/** Zeiten einer Fahrt wie `ride.time` in admin/src/App.jsx. Leer = im Web undefined. */
data class FahrtZeiten(
    val original: String = "",
    val status: String = "",
    val neu: String = "",
    val zeit: String = "",
    val ankunftOriginal: String = "",
    val ankunftNeu: String = "",
    val ankunftZeit: String = "",
)

/** Eine Fahrt fuer die Listen, Felder wie das Mapping in loadRidesFromDb. */
data class DispoFahrt(
    val id: String,
    val name: String,
    val alleGaeste: List<String>,
    val route: String,
    val startOrt: String,
    val zielOrt: String,
    val startZeit: String,
    val fahrerNamen: List<String>,
    val fahrerAntworten: List<String>,
    val anonymeGaeste: Int,
    val aktuellerStatus: String,
    val fahrerNummer: String?,
    val fahrer: String,
    val konvoi: String,
    val notiz: String,
    val notizen: List<String>,
    val kiGebucht: Boolean,
    val zeiten: FahrtZeiten,
    val verzugMinuten: Int,
    /** `status === 'delayed'` */
    val verspaetet: Boolean,
    /** `variant === 'variant2'` (kein Fahrer) */
    val ohneFahrerVariante: Boolean,
    val datum: String,
    val bestaetigt: Boolean,
    val jobStatus: String,
) {
    val archiviert: Boolean get() = jobStatus in setOf("archived", "cancelled")
}

/** Filter der Fahrtenliste (fahrtenFilter in App.jsx). */
data class FahrtenFilterWerte(
    val startSuche: String = "",
    val zielSuche: String = "",
    val datum: String = "",
    val ohneFahrer: Boolean = false,
    val bestaetigung: Boolean = false,
    val konvoi: Boolean = false,
    val besonderheiten: Boolean = false,
    val vergangene: Boolean = false,
)

/** Flughafen-Board (airportBoardState in App.jsx). */
data class FlughafenBoard(
    val code: String = "",
    val laedt: Boolean = false,
    val fehler: String = "",
    val stand: String = "",
    val eintraege: List<DBZeile> = emptyList(),
)

/**
 * Laedt und haelt die Fahrten der Disposition wie loadRidesFromDb + Realtime in App.jsx (DispoFahrtenSpeicher in iOS).
 * Ein gemeinsamer Speicher, damit Filter und Standort erhalten bleiben, wenn man die Seite verlaesst.
 */
object DispoFahrtenSpeicher {
    var fahrten by mutableStateOf<List<DispoFahrt>>(emptyList()); private set
    var ladeFehler by mutableStateOf(""); private set
    var filter by mutableStateOf(FahrtenFilterWerte())
    var standort by mutableStateOf("")
    var board by mutableStateOf(FlughafenBoard()); private set
    /** Meldung wie demoAlert im Web (Fehler beim Abschliessen/Archivieren/Duplizieren). */
    var meldung by mutableStateOf<String?>(null)

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private var gestartet = false
    private var kanal: RealtimeChannel? = null
    private var beobachter: List<Job> = emptyList()
    private var spaeter: Job? = null
    private var laedt = false
    private var nochmal = false
    /** Lokal archivierte Fahrten, bis jobs_archive sie liefert (locallyArchivedJobIdsRef). */
    private val lokalArchiviert = mutableSetOf<String>()

    /** Die Dispo hat eine archivierte Fahrt im Editor wieder auf offen, unterwegs oder beendet gesetzt. */
    fun archivAufheben(id: String) { lokalArchiviert.remove(id); lokalArchiviert.remove(id.lowercase()) }

    // MARK: Start, Realtime, Abgleich

    /** Einmal starten: laden, Realtime auf jobs/convoy_assignments/job_guests/job_notes, alle 60 s abgleichen. */
    fun starten() {
        if (gestartet) return
        gestartet = true
        neuLaden()
        scope.launch { realtimeVerbinden() }
        scope.launch {
            while (true) {
                delay(60_000)
                neuLaden()
            }
        }
    }

    /** Beim Zurueckkehren in die App (didBecomeActive in iOS). */
    fun wiederAktiv() {
        if (!gestartet) return
        neuLaden()
        if (kanal == null) scope.launch { realtimeVerbinden() }
    }

    /** triggerRidesRefresh: laeuft schon eine Abfrage, danach genau einmal nachladen. */
    fun neuLaden() {
        if (laedt) { nochmal = true; return }
        laedt = true
        scope.launch {
            laden()
            laedt = false
            if (nochmal) { nochmal = false; neuLaden() }
        }
    }

    /** scheduleRidesRefresh(delayMs) */
    private fun spaeterLaden(ms: Long) {
        spaeter?.cancel()
        spaeter = scope.launch { delay(ms); neuLaden() }
    }

    private suspend fun realtimeVerbinden() {
        beobachter.forEach { it.cancel() }
        beobachter = emptyList()
        kanal?.let { runCatching { Backend.client.realtime.removeChannel(it) } }
        val neu = Backend.client.channel("koordinator-rides-live-${System.currentTimeMillis()}")
        val stroeme = listOf("jobs", "convoy_assignments", "job_guests", "job_notes").map { tab ->
            neu.postgresChangeFlow<PostgresAction>(schema = "public") { table = tab }
        }
        kanal = neu
        beobachter = stroeme.map { it.onEach { neuLaden() }.launchIn(scope) }
        try {
            neu.subscribe(blockUntilSubscribed = true)
            neuLaden()
        } catch (e: Exception) {
            // Wie im Web: neu laden und nach kurzer Pause wieder verbinden.
            neuLaden()
            kanal = null
            delay(5_000)
            realtimeVerbinden()
        }
    }

    // MARK: Laden (loadRidesFromDb)

    private const val SPALTEN_BASIS = "id, driver_id, pickup_name, pickup_address, dropoff_name, dropoff_address, ride_date, etd, original_etd, status, convoy_id, passengers, anonymous_guests, created_at, ext_flight_payload, ext_flight_last_sync_at, train_planned_time, train_predicted_time, ext_route_duration_mins, ext_route_duration_in_traffic_mins"
    private val spaltenVarianten = listOf(
        "$SPALTEN_BASIS, ai_booked, flight_number, train_number",
        "$SPALTEN_BASIS, flight_number, train_number",
        "$SPALTEN_BASIS, ai_booked, train_number",
        "$SPALTEN_BASIS, train_number",
        "$SPALTEN_BASIS, ai_booked, flight_number",
        "$SPALTEN_BASIS, flight_number",
        "$SPALTEN_BASIS, ai_booked",
        SPALTEN_BASIS,
    )

    suspend fun laden() {
        ladeFehler = ""
        try {
            var jobs: List<DBZeile> = emptyList()
            var letzterFehler: Exception? = null
            for (spalten in spaltenVarianten) {
                try {
                    jobs = Backend.client.from("jobs").select(Columns.raw(spalten)) {
                        order("ride_date", Order.ASCENDING)
                        order("etd", Order.ASCENDING)
                    }.decodeList<JsonObject>()
                    letzterFehler = null
                    break
                } catch (e: Exception) {
                    letzterFehler = e
                    val text = fehlerText(e)
                    val fehlendeSpalte = passt(text, """column .*flight_number|could not find the ['"]?flight_number['"]? column""")
                        || passt(text, """column .*ai_booked|could not find the ['"]?ai_booked['"]? column""")
                        || passt(text, """column .*train_planned_time|column .*train_predicted_time|could not find the ['"]?train_planned_time['"]? column|could not find the ['"]?train_predicted_time['"]? column""")
                        || passt(text, """column .*ext_flight_payload|column .*ext_flight_last_sync_at|could not find the ['"]?ext_flight_payload['"]? column|could not find the ['"]?ext_flight_last_sync_at['"]? column""")
                    if (!fehlendeSpalte) break
                }
            }
            letzterFehler?.let { throw it }

            val jobIDs = jobs.map { W.t(it["id"]) }.filter { it.isNotEmpty() }
            val jobFahrerIDs = jobs.map { W.t(it["driver_id"]) }.filter { it.isNotEmpty() }.distinct()
            val konvoiIDs = jobs.map { W.t(it["convoy_id"]) }.filter { it.isNotEmpty() }.distinct()

            val zuordnungen = stapelweise(jobIDs, """relation .*convoy_assignments|table .*convoy_assignments|does not exist""") {
                Backend.client.from("convoy_assignments").select(Columns.raw("job_id, driver_id, response_status")) { filter { isIn("job_id", it) } }.decodeList<JsonObject>()
            }
            val fahrerIDs = (jobFahrerIDs + zuordnungen.map { W.t(it["driver_id"]) }.filter { it.isNotEmpty() }).distinct()
            val profile = stapelweise(fahrerIDs) {
                Backend.client.from("profiles").select(Columns.raw("id, first_name, last_name, driver_number")) { filter { isIn("id", it) } }.decodeList<JsonObject>()
            }
            val jobGaeste = stapelweise(jobIDs) {
                Backend.client.from("job_guests").select(Columns.raw("job_id, guest_id, is_main_contact")) { filter { isIn("job_id", it) } }.decodeList<JsonObject>()
            }
            val notizZeilen = stapelweise(jobIDs, """relation .*job_notes|table .*job_notes|does not exist""") {
                Backend.client.from("job_notes").select(Columns.raw("job_id, note_text, created_at, author_name")) {
                    filter { isIn("job_id", it) }
                    order("created_at", Order.DESCENDING)
                }.decodeList<JsonObject>()
            }
            // Archiv: Fehler (fehlende Tabelle, keine Rechte) zaehlen wie leer.
            val archivZeilen = runCatching {
                stapelweise(jobIDs) {
                    Backend.client.from("jobs_archive").select(Columns.raw("job_id")) { filter { isIn("job_id", it) } }.decodeList<JsonObject>()
                }
            }.getOrDefault(emptyList())
            val archivIDs = lokalArchiviert + archivZeilen.map { W.t(it["job_id"]) }.filter { it.isNotEmpty() }
            val gastIDs = jobGaeste.map { W.t(it["guest_id"]) }.filter { it.isNotEmpty() }.distinct()
            val gaeste = stapelweise(gastIDs) {
                Backend.client.from("guests").select(Columns.raw("id, first_name, last_name")) { filter { isIn("id", it) } }.decodeList<JsonObject>()
            }
            val konvois = stapelweise(konvoiIDs) {
                Backend.client.from("convoys").select(Columns.raw("id, name")) { filter { isIn("id", it) } }.decodeList<JsonObject>()
            }

            fahrten = abbilden(jobs, zuordnungen, profile, jobGaeste, notizZeilen, archivIDs, gaeste, konvois)
        } catch (e: Exception) {
            if (e is kotlinx.coroutines.CancellationException) throw e
            fahrten = emptyList()
            ladeFehler = fehlerText(e).ifEmpty { "Fahrten konnten nicht geladen werden." }
        }
    }

    /** runInBatches: IN-Abfragen in Paketen zu 30 IDs. */
    private suspend fun stapelweise(ids: List<String>, tolerieren: String? = null, abfrage: suspend (List<String>) -> List<DBZeile>): List<DBZeile> {
        if (ids.isEmpty()) return emptyList()
        val alle = mutableListOf<DBZeile>()
        for (paket in ids.chunked(30)) {
            try {
                alle += abfrage(paket)
            } catch (e: Exception) {
                if (tolerieren != null && passt(fehlerText(e), tolerieren)) return emptyList()
                throw e
            }
        }
        return alle
    }

    // MARK: Abbilden (das grosse jobs.map in loadRidesFromDb)

    private val offenAehnlich = setOf("pending", "assigned", "offen", "new", "requested", "offered", "zugewiesen", "at_pickup", "beim_pickup", "beim pickup")
    private val unterwegsAehnlich = setOf("in_progress", "unterwegs", "started", "on_trip", "ongoing", "active")
    private const val ANONYM = """^anonymer?\s+fahrgast(?:\s+\d+)?$"""

    private data class FahrerEintrag(val id: String, val name: String, val nummer: String, val antwort: String, val etikett: String)
    private data class NotizMeta(val text: String, val ki: Boolean)

    private fun abbilden(
        jobs: List<DBZeile>, zuordnungen: List<DBZeile>, profile: List<DBZeile>, jobGaeste: List<DBZeile>,
        notizZeilen: List<DBZeile>, archivIDs: Set<String>, gaeste: List<DBZeile>, konvois: List<DBZeile>,
    ): List<DispoFahrt> {
        val profilNachID = LinkedHashMap<String, DBZeile>().apply { profile.forEach { putIfAbsent(W.t(it["id"]), it) } }
        val gastNachID = LinkedHashMap<String, DBZeile>().apply { gaeste.forEach { putIfAbsent(W.t(it["id"]), it) } }
        val konvoiName = LinkedHashMap<String, String>().apply { konvois.forEach { putIfAbsent(W.t(it["id"]), W.t(it["name"])) } }

        // Neueste Notiz je Fahrt (auch vom Fahrer) und alle Notizen fuer die Karte.
        val notizNachJob = HashMap<String, NotizMeta>()
        val dispoNotizNachJob = HashMap<String, NotizMeta>()
        val alleNotizen = HashMap<String, MutableList<String>>()
        for (zeile in notizZeilen) {
            val job = W.t(zeile["job_id"])
            if (job.isEmpty()) continue
            val roh = W.t(zeile["note_text"])
            val meta = NotizMeta(roh.replace("[AI_BOOKED]", "").trim(), roh.contains("[AI_BOOKED]"))
            notizNachJob.putIfAbsent(job, meta)
            if (meta.text.isNotEmpty()) alleNotizen.getOrPut(job) { mutableListOf() }.add(meta.text)
            if (W.t(zeile["author_name"]).isEmpty()) dispoNotizNachJob.putIfAbsent(job, meta)
        }

        val zuordnungNachJob = HashMap<String, MutableList<Pair<String, String>>>()
        for (zeile in zuordnungen) {
            val job = W.t(zeile["job_id"])
            val fahrer = W.t(zeile["driver_id"])
            if (job.isEmpty() || fahrer.isEmpty()) continue
            zuordnungNachJob.getOrPut(job) { mutableListOf() }.add(fahrer to W.antwort(W.t(zeile["response_status"])))
        }

        val gastLinks = HashMap<String, MutableList<DBZeile>>()
        for (zeile in jobGaeste) {
            val job = W.t(zeile["job_id"])
            if (job.isEmpty()) continue
            gastLinks.getOrPut(job) { mutableListOf() }.add(zeile)
        }

        val heute = DispoDatum.heute()
        val jetzt = LocalTime.now()
        val jetztUhr = "%02d:%02d".format(jetzt.hour, jetzt.minute)

        return jobs.map { job ->
            val jobID = W.t(job["id"])
            val fahrerID = W.t(job["driver_id"])
            val abholName = W.t(job["pickup_name"]); val abholAdresse = W.t(job["pickup_address"])
            val zielName = W.t(job["dropoff_name"]); val zielAdresse = W.t(job["dropoff_address"])
            val startEtikett = W.ortEtikett(abholName, abholAdresse)
            val zielEtikett = W.ortEtikett(zielName, zielAdresse)
            val startWert = abholAdresse.ifEmpty { abholName.ifEmpty { startEtikett } }
            val zielWert = zielAdresse.ifEmpty { zielName.ifEmpty { zielEtikett } }

            fun eintrag(profil: DBZeile?, ersatzID: String, antwort: String): FahrerEintrag {
                val name = listOf(W.t(profil?.get("first_name")), W.t(profil?.get("last_name"))).filter { it.isNotEmpty() }.joinToString(" ")
                val nummer = W.t(profil?.get("driver_number"))
                val etikett = if (name.isNotEmpty() && nummer.isNotEmpty()) "$name ($nummer)" else name.ifEmpty { nummer }
                val id = W.t(profil?.get("id"))
                return FahrerEintrag(id.ifEmpty { ersatzID }, name, nummer, W.antwort(antwort), etikett)
            }

            val zeilen = zuordnungNachJob[jobID] ?: emptyList()
            val antwortNachFahrer = HashMap<String, String>()
            for ((f, a) in zeilen) {
                val vorher = antwortNachFahrer[f]
                if (vorher == null || vorher == "pending") antwortNachFahrer[f] = a
                else if (vorher == "refused" && a == "accepted") antwortNachFahrer[f] = a
            }
            val hauptAntwort = antwortNachFahrer[fahrerID] ?: W.antwort(W.t(job["status"]))
            val hauptProfil = if (fahrerID.isEmpty()) null else profilNachID[fahrerID]
            val haupt = hauptProfil?.let { eintrag(it, fahrerID, hauptAntwort) }
            val zugeordneteIDs = mutableListOf<String>()
            for ((f, _) in zeilen) if (f !in zugeordneteIDs) zugeordneteIDs.add(f)
            val zugeordnete = zugeordneteIDs.map { eintrag(profilNachID[it], it, antwortNachFahrer[it] ?: "pending") }.filter { it.etikett.isNotEmpty() }

            // Doppelte Fahrer zusammenfuehren, Reihenfolge wie Map im Web.
            val zusammen = mutableListOf<FahrerEintrag>()
            val index = HashMap<String, Int>()
            for (e in listOfNotNull(haupt) + zugeordnete) {
                val schluessel = e.id.ifEmpty { W.ortNormal(e.name) }
                if (schluessel.isEmpty()) continue
                val i = index[schluessel]
                if (i != null) {
                    val alt = zusammen[i]
                    val antwort = if (alt.antwort == "accepted" || e.antwort == "accepted") "accepted"
                    else if (alt.antwort == "refused" || e.antwort == "refused") "refused" else "pending"
                    zusammen[i] = e.copy(etikett = alt.etikett.ifEmpty { e.etikett }, antwort = antwort)
                } else {
                    index[schluessel] = zusammen.size
                    zusammen.add(e)
                }
            }
            val etiketten = zusammen.map { it.etikett }.filter { it.isNotEmpty() }
            val antworten = zusammen.map { it.antwort }
            val hatFahrer = etiketten.isNotEmpty()
            val einzelNummer = if (hatFahrer && zusammen.size == 1 && zusammen[0].nummer.isNotEmpty()) zusammen[0].nummer else null
            val hatKonvoi = W.t(job["convoy_id"]).isNotEmpty() || zusammen.size > 1

            // Gaeste: Hauptkontakt zuerst.
            val links = (gastLinks[jobID] ?: emptyList()).withIndex().sortedWith { a, b ->
                val ha = W.bool(a.value["is_main_contact"]); val hb = W.bool(b.value["is_main_contact"])
                if (ha != hb) (if (ha) -1 else 1) else a.index.compareTo(b.index)
            }.map { it.value }
            val ersterGast = gastNachID[W.t(links.firstOrNull()?.get("guest_id"))]
            val gastNamen = links.mapNotNull { gastNachID[W.t(it["guest_id"])] }
                .map { g -> listOf(W.t(g["first_name"]), W.t(g["last_name"])).filter { it.isNotEmpty() }.joinToString(" ") }
                .filter { it.isNotEmpty() }
            val gastName = listOf(W.t(ersterGast?.get("first_name")), W.t(ersterGast?.get("last_name"))).filter { it.isNotEmpty() }.joinToString(" ")
            val passagiereRoh = W.passagiere(job["passengers"])
            val altAnonym = passagiereRoh.count { W.passt(it, ANONYM, gross = false) }
            val passagiere = passagiereRoh.filter { !W.passt(it, ANONYM, gross = false) }
            val anonym = maxOf(maxOf(0, W.ganzzahl(job["anonymous_guests"]) ?: 0), altAnonym)
            val hatPassagierObjekt = job["passengers"] is JsonArray || job["passengers"] is JsonObject
            val wirksameGaeste = if (hatPassagierObjekt) passagiere else gastNamen.ifEmpty { passagiere }
            val hauptGast = gastName.ifEmpty { wirksameGaeste.firstOrNull() ?: "" }

            var etd = W.uhr(W.t(job["etd"]))
            var originalEtd = W.uhr(W.t(job["original_etd"]))
            val rohStatus = W.t(job["status"]).lowercase()
            val jobStatus = if (jobID in archivIDs) "archived" else rohStatus
            val zugnummer = W.t(job["train_number"])
            val zugGeplant = W.uhr(W.t(job["train_planned_time"]))
            val zugErwartet = W.uhr(W.t(job["train_predicted_time"]))
            val summary = ((job["ext_flight_payload"] as? JsonObject)?.get("summary") as? JsonObject)
            if (zugnummer.isNotEmpty() && summary != null) {
                val geplant = W.uhr(W.uhrAusISO(W.t(summary["scheduled_arrival_local"])))
                val erwartet = W.uhr(W.uhrAusISO(W.t(summary["estimated_arrival_local"])))
                if (erwartet.isNotEmpty() && zugErwartet.isEmpty()) etd = erwartet
                if (geplant.isNotEmpty() && zugGeplant.isEmpty()) originalEtd = geplant
            }
            if (zugnummer.isNotEmpty()) {
                if (zugErwartet.isNotEmpty()) etd = zugErwartet
                if (zugGeplant.isNotEmpty()) originalEtd = zugGeplant
            }
            val unterwegs = jobStatus in unterwegsAehnlich
            val offen = jobStatus in offenAehnlich
            val datum = W.tagWert(W.t(job["ride_date"]), heute)
            val geplantMin = W.minuten(originalEtd.ifEmpty { etd })
            val jetztMin = W.minuten(jetztUhr)
            val verschieben = datum == heute && offen && geplantMin != null && jetztMin != null && jetztMin > geplantMin
            val verzug = if (verschieben) maxOf(0, jetztMin!! - geplantMin!!) else 0
            val wirksameEtd = if (verschieben) jetztUhr else etd.ifEmpty { originalEtd }
            val mitVerkehr = W.zahl(job["ext_route_duration_in_traffic_mins"]) ?: 0.0
            val ohneVerkehr = W.zahl(job["ext_route_duration_mins"]) ?: 0.0
            val dauer = if (mitVerkehr > 0) mitVerkehr else if (ohneVerkehr > 0) ohneVerkehr else 0.0
            val bezug = if (unterwegs) jetztUhr else wirksameEtd
            val ankunftNeu = W.erste(W.plus(bezug, dauer), W.plus(wirksameEtd, dauer), W.plus(originalEtd, dauer), bezug, wirksameEtd, originalEtd) ?: "--:--"
            val ankunftOriginal = W.erste(W.plus(originalEtd, dauer), W.plus(wirksameEtd, dauer), originalEtd, wirksameEtd) ?: "--:--"
            val verspaetet = verzug > 0 || (wirksameEtd.isNotEmpty() && originalEtd.isNotEmpty() && wirksameEtd != originalEtd)
            val notiz = notizNachJob[jobID] ?: NotizMeta("", false)
            val dispoNotiz = dispoNotizNachJob[jobID] ?: NotizMeta("", false)
            val kiSpalte = W.bool(job["ai_booked"])

            var zeiten = FahrtZeiten()
            zeiten = if (verspaetet) zeiten.copy(original = W.erste(originalEtd, wirksameEtd) ?: "--:--", neu = W.erste(wirksameEtd, originalEtd) ?: "--:--")
            else zeiten.copy(zeit = W.erste(wirksameEtd) ?: "--:--")
            zeiten = zeiten.copy(ankunftOriginal = ankunftOriginal, ankunftNeu = ankunftNeu, ankunftZeit = ankunftNeu)

            DispoFahrt(
                id = jobID,
                // Ohne Gastnamen bleibt der Name leer, die Karte zeigt dann anonyme Gaeste oder "Keine Gäste".
                name = hauptGast,
                alleGaeste = wirksameGaeste,
                route = "$startEtikett - $zielEtikett",
                startOrt = startWert,
                zielOrt = zielWert,
                startZeit = W.erste(wirksameEtd, originalEtd) ?: "--:--",
                fahrerNamen = if (hatFahrer) etiketten else listOf(""),
                fahrerAntworten = if (hatFahrer) antworten else emptyList(),
                anonymeGaeste = anonym,
                aktuellerStatus = W.editorStatus(jobStatus),
                fahrerNummer = einzelNummer,
                fahrer = if (hatFahrer) etiketten.joinToString(", ") else FahrtText.FAHRER_FEHLT,
                konvoi = konvoiName[W.t(job["convoy_id"])]?.takeIf { it.isNotEmpty() } ?: (if (hatKonvoi) "Kolonne" else ""),
                notiz = notiz.text,
                notizen = (alleNotizen[jobID] ?: emptyList<String>()).reversed(),
                kiGebucht = kiSpalte || notiz.ki || dispoNotiz.ki,
                zeiten = zeiten,
                verzugMinuten = verzug,
                verspaetet = verspaetet,
                ohneFahrerVariante = !hatFahrer,
                datum = datum,
                bestaetigt = "accepted" in antworten,
                jobStatus = jobStatus,
            )
        }
    }

    // MARK: Aktionen beim Wischen (nur auf Knopfdruck, wie im Web)

    /** handleMarkRideDone: status = done. */
    fun erledigt(fahrt: DispoFahrt) = scope.launch {
        try {
            Backend.client.from("jobs").update(buildJsonObject { put("status", "done") }) {
                select(Columns.raw("id"))
                filter { eq("id", fahrt.id) }
            }.decodeList<JsonObject>()
            fahrten = fahrten.map { if (it.id == fahrt.id) it.copy(aktuellerStatus = "beendet", bestaetigt = true) else it }
            spaeterLaden(1200)
        } catch (e: Exception) {
            meldung = "Status konnte nicht auf abgeschlossen gesetzt werden: ${textOderUnbekannt(e)}"
        }
    }

    /** handleArchiveRide: status = cancelled, dazu Eintrag in jobs_archive. */
    fun archivieren(fahrt: DispoFahrt, ansicht: String) = scope.launch {
        try {
            val ergebnis = Backend.client.from("jobs").update(buildJsonObject { put("status", "cancelled") }) {
                select(Columns.raw("id"))
                filter { eq("id", fahrt.id) }
            }.decodeList<JsonObject>()
            if (ergebnis.isEmpty()) throw IllegalStateException("Archivierung fehlgeschlagen: keine Zeile in jobs aktualisiert.")
            val eintrag = buildJsonObject {
                put("job_id", fahrt.id)
                put("archived_by", "admin-app")
                put("snapshot", buildJsonObject {
                    put("rideId", fahrt.id)
                    put("sourceView", ansicht)
                    put("date", fahrt.datum)
                    put("start", fahrt.startOrt)
                    put("ziel", fahrt.zielOrt)
                    put("driver", fahrt.fahrer)
                    put("status", fahrt.jobStatus.ifEmpty { fahrt.aktuellerStatus })
                    put("captured_at", DispoDatum.iso())
                })
            }
            // Fehlt die Archiv-Tabelle oder scheitert der Eintrag, bleibt die Fahrt trotzdem archiviert (Web: nur Warnung).
            runCatching { Backend.client.from("jobs_archive").insert(eintrag) }
            lokalArchiviert.add(fahrt.id)
            fahrten = fahrten.map { if (it.id == fahrt.id) it.copy(jobStatus = "cancelled", aktuellerStatus = "stoniert") else it }
            spaeterLaden(1200)
        } catch (e: Exception) {
            meldung = "Fahrt konnte nicht archiviert werden: ${textOderUnbekannt(e)}"
        }
    }

    /** handleDuplicateRide: Fahrt mit Notizen, Gaesten und Kolonnen-Zuordnungen kopieren. */
    fun duplizieren(fahrt: DispoFahrt) = scope.launch {
        try {
            val original = Backend.client.from("jobs").select(Columns.ALL) {
                filter { eq("id", fahrt.id) }
                limit(1)
            }.decodeList<JsonObject>().first()
            val kopie = JsonObject(original.filterKeys { it !in setOf("id", "created_at", "updated_at") })
            val neu = Backend.client.from("jobs").insert(kopie) {
                select(Columns.raw("id"))
            }.decodeList<JsonObject>().first()
            val neueID = W.t(neu["id"])
            if (neueID.isEmpty()) throw IllegalStateException("Duplizierte Fahrt konnte nicht angelegt werden.")

            val fehltNotizen = """relation .*job_notes|table .*job_notes|does not exist"""
            try {
                val notizen = Backend.client.from("job_notes").select(Columns.raw("note_text")) {
                    filter { eq("job_id", fahrt.id) }
                    order("created_at", Order.ASCENDING)
                }.decodeList<JsonObject>()
                val zeilen = notizen.map { W.t(it["note_text"]) }.filter { it.isNotEmpty() }
                    .map { buildJsonObject { put("job_id", neueID); put("note_text", it) } }
                if (zeilen.isNotEmpty()) {
                    try { Backend.client.from("job_notes").insert(zeilen) } catch (e: Exception) { if (!passt(fehlerText(e), fehltNotizen)) throw e }
                }
            } catch (e: Exception) {
                if (!passt(fehlerText(e), fehltNotizen)) throw e
            }

            val gaeste = Backend.client.from("job_guests").select(Columns.raw("guest_id, is_main_contact")) {
                filter { eq("job_id", fahrt.id) }
            }.decodeList<JsonObject>()
            val gastZeilen = gaeste.mapNotNull { z ->
                val gast = z["guest_id"]
                if (gast == null || gast is JsonNull) null
                else JsonObject(mapOf("job_id" to JsonPrimitive(neueID), "guest_id" to gast, "is_main_contact" to JsonPrimitive(W.bool(z["is_main_contact"]))))
            }
            if (gastZeilen.isNotEmpty()) {
                Backend.client.from("job_guests").upsert(gastZeilen) { onConflict = "job_id,guest_id" }
            }

            val fehltKolonne = """relation .*convoy_assignments|table .*convoy_assignments|does not exist"""
            try {
                val zuordnungen = Backend.client.from("convoy_assignments").select(Columns.raw("driver_id, response_status")) {
                    filter { eq("job_id", fahrt.id) }
                }.decodeList<JsonObject>()
                val zeilen = zuordnungen.mapNotNull { z ->
                    val fahrer = z["driver_id"]
                    if (fahrer == null || fahrer is JsonNull) null
                    else JsonObject(mapOf("job_id" to JsonPrimitive(neueID), "driver_id" to fahrer,
                        "response_status" to JsonPrimitive(W.t(z["response_status"]).ifEmpty { "pending" })))
                }
                if (zeilen.isNotEmpty()) {
                    try { Backend.client.from("convoy_assignments").upsert(zeilen) { onConflict = "job_id,driver_id" } }
                    catch (e: Exception) { if (!passt(fehlerText(e), fehltKolonne)) throw e }
                }
            } catch (e: Exception) {
                if (!passt(fehlerText(e), fehltKolonne)) throw e
            }

            // Sofort hinter dem Original zeigen, der Abgleich folgt.
            val lokal = fahrt.copy(id = neueID)
            val i = fahrten.indexOfFirst { it.id == fahrt.id }
            fahrten = fahrten.toMutableList().apply { if (i >= 0) add(i + 1, lokal) else add(0, lokal) }
            spaeterLaden(1200)
        } catch (e: Exception) {
            meldung = "Fahrt konnte nicht dupliziert werden: ${textOderUnbekannt(e)}"
        }
    }

    // MARK: Flughafen-Board (refreshAirportBoard)

    suspend fun boardLaden(abfahrten: Boolean) {
        val code = W.flughafenCode(standort)
        if (W.ortNormal(standort).isEmpty() || code.isEmpty()) {
            board = FlughafenBoard()
            return
        }
        board = board.copy(code = code, laedt = true, fehler = "")
        val koerper = buildJsonObject {
            put("airport_code", code)
            put("mode", if (abfahrten) "departures" else "arrivals")
            put("date", DispoDatum.heute())
            put("limit", 8)
            put("include_codeshare", false)
        }
        when (val r = FahrtPruefung.aufrufen("airport-board", koerper)) {
            is FahrtPruefung.Aufruf.Ok -> {
                val antwort = r.daten as? JsonObject ?: JsonObject(emptyMap())
                val stand = W.t(antwort["fetched_at"])
                board = FlughafenBoard(
                    code = code, laedt = false, fehler = W.t(antwort["error"]),
                    stand = stand.ifEmpty { DispoDatum.iso() },
                    eintraege = (antwort["items"] as? JsonArray)?.mapNotNull { it as? JsonObject } ?: emptyList(),
                )
            }
            is FahrtPruefung.Aufruf.Fehler -> {
                board = board.copy(laedt = false, fehler = r.text.ifEmpty { "Flughafenboard konnte nicht geladen werden." })
            }
        }
    }

    // MARK: Hilfen

    private fun textOderUnbekannt(e: Throwable): String = fehlerText(e).ifEmpty { "Unbekannter Fehler" }

    private fun passt(text: String, muster: String): Boolean = W.passt(text, muster, gross = false)
}
