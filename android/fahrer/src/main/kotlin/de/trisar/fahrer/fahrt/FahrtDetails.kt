package de.trisar.fahrer.fahrt

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import de.trisar.kern.Backend
import de.trisar.kern.EigeneOrte
import de.trisar.kern.GeoPunkt
import io.github.jan.supabase.postgrest.from
import io.github.jan.supabase.postgrest.query.Columns
import io.github.jan.supabase.postgrest.query.Order
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.jsonObject
import java.time.Instant
import java.time.LocalDate
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.DateTimeFormatterBuilder
import java.time.temporal.ChronoField

/** Aufraeumen (Realtime abmelden) ueberlebt das Schliessen der Seite, ihr eigener Scope nicht. */
internal val fahrtAufraeumen = kotlinx.coroutines.CoroutineScope(kotlinx.coroutines.SupervisorJob() + kotlinx.coroutines.Dispatchers.Main)

// MARK: - Zeit (Datum-Hilfen aus Fahrten.swift / FahrtDetails.swift)

internal object FahrtZeit {
    private val uhr = DateTimeFormatter.ofPattern("HH:mm")
    private val kurz = DateTimeFormatter.ofPattern("d.M.yyyy")
    private val postgres = DateTimeFormatterBuilder()
        .appendPattern("yyyy-MM-dd[ ]['T']HH:mm:ss")
        .optionalStart().appendFraction(ChronoField.NANO_OF_SECOND, 0, 9, true).optionalEnd()
        .appendPattern("[XXX][XX][X]")
        .toFormatter()

    fun ausISO(text: String?): Instant? {
        val t = text?.trim().orEmpty()
        if (t.isEmpty()) return null
        runCatching { return OffsetDateTime.parse(t).toInstant() }
        runCatching { return OffsetDateTime.parse(t, postgres).toInstant() }
        return null
    }

    fun uhrzeit(i: Instant): String = uhr.format(i.atZone(ZoneId.systemDefault()))
    fun datumKurz(i: Instant): String = kurz.format(i.atZone(ZoneId.systemDefault()))
    fun iso(i: Instant = Instant.now()): String = i.toString()

    fun ausTagWert(wert: String): LocalDate = runCatching { LocalDate.parse(wert) }.getOrDefault(LocalDate.now())
}

// MARK: - Fahrt (Zeile aus jobs, aufbereitet wie Fahrt in Fahrten.swift)

@Serializable
private data class FahrtZeileB(
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
    val pickup_ort_id: String? = null,
    val dropoff_ort_id: String? = null,
)

internal data class FahrtKopf(
    val id: String,
    val status: String,
    val tripType: String?,
    val abholName: String,
    val abholAdresse: String,
    val zielName: String,
    val zielAdresse: String,
    val flug: String,
    val fahrtDatum: String,
    val etd: String,
    val planEtd: String?,
    val kolonnenID: String?,
    val istKolonne: Boolean,
    val meineAntwort: String,
    /** Eigener Ort der Dispo (orte.id) fuer Start/Ziel. */
    val abholOrtID: String? = null,
    val zielOrtID: String? = null,
) {
    val abholKurz get() = FahrtAdresse.kurz(abholName, abholAdresse)
    val zielKurz get() = FahrtAdresse.kurz(zielName, zielAdresse)
    val istFlughafen get() = tripType == "airport"
}

internal object FahrtAdresse {
    private val hausnummer = Regex("^\\d+\\s?[a-zA-Z]?(\\s*[-/]\\s*\\d+\\s?[a-zA-Z]?)?$")

    /** kurzAdresse(): "153, Thalkirchner Straße, ..." -> "Thalkirchner Straße 153". */
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

    /** adresseNormal: Hausnummer hinter die Strasse. */
    fun normal(text: String): String {
        val teile = text.split(",").map { it.trim() }.filter { it.isNotEmpty() }
        if (teile.size > 1 && hausnummer.matches(teile[0])) return (listOf("${teile[1]} ${teile[0]}") + teile.drop(2)).joinToString(", ")
        return teile.joinToString(", ")
    }

    /** adresseFuerNavigation der Web-App. */
    fun fuerNavigation(name: String, adresse: String, eigenerOrt: Boolean = false): String {
        // Eigener Ort: nur die Adresse, den Namen ("Mercedes Event Location") findet Maps nicht.
        if (eigenerOrt) return normal(adresse).ifEmpty { normal(name) }
        val n = name.trim()
        val a = normal(adresse)
        if (n.isEmpty()) return a
        if (a.isEmpty()) return normal(n)
        if (a.lowercase().contains(n.lowercase()) || a.lowercase() == normal(n).lowercase()) return a
        return "$n, $a"
    }
}

// MARK: - Details

/**
 * Alles, was die Fahrt-Ansicht braucht (Fahrt selbst, Gaeste, Notizen, Merkmale, Fahrzeiten,
 * eigener Standort, Kolonne, Flug). Nachbau von FahrtDetails.swift, die Fahrt selbst kommt in iOS
 * aus dem FahrtenSpeicher, hier laedt die Seite sie selbst ueber die ID.
 */
internal class FahrtDetails(val fahrtID: String, private val fahrerID: String, private val ctx: android.content.Context) {
    data class Notiz(val zeit: String, val datum: String, val text: String, val autor: String)

    data class KolonnenFahrer(
        val id: String,
        val name: String,
        val telefon: String,
        val kennzeichen: String,
        val fahrzeug: String,
        val bild: String,
        val nummer: String,
        val antwort: String,
        val gaeste: List<String>,
        val standort: GeoPunkt?,
    )

    var fahrt by mutableStateOf<FahrtKopf?>(null); private set
    /** Fahrt wurde einmal geladen (danach heisst null: weg, zurueck zur Liste). */
    var fahrtGeladen by mutableStateOf(false); private set
    var gaeste by mutableStateOf<List<String>>(emptyList()); private set
    /** Gaeste ohne Namen (jobs.anonymous_guests plus alte "Anonymer Fahrgast"-Eintraege). */
    var anonym by mutableStateOf(0); private set
    var notizen by mutableStateOf<List<Notiz>>(emptyList()); private set
    var merkmale by mutableStateOf<List<String>>(emptyList()); private set
    var fahrzeitMin by mutableStateOf(0); private set
    var restZielMin by mutableStateOf<Int?>(null); private set
    /** Zeitpunkt der Messung von restZielMin. Die Restzeit gilt ab hier, nicht ab jetzt. */
    var restZielSync by mutableStateOf<Instant?>(null); private set

    /** Ankunft aus der Live-Restzeit: Messzeitpunkt + Restzeit, nie vor jetzt. */
    fun liveAnkunft(jetzt: Instant): Instant? {
        val rest = restZielMin ?: return null
        val sync = restZielSync ?: return null
        val ankunft = sync.plusSeconds(rest * 60L)
        return if (ankunft.isBefore(jetzt)) jetzt else ankunft
    }
    /** Gespeicherte TomTom-Linien (Rueckfall, wenn die Live-Route von OSRM ausfaellt). */
    var tomtomFahrt by mutableStateOf<List<de.trisar.kern.GeoPunkt>>(emptyList()); private set
    var tomtomAnfahrt by mutableStateOf<List<de.trisar.kern.GeoPunkt>>(emptyList()); private set
    var fahrerNummer by mutableStateOf(""); private set
    var fahrerName by mutableStateOf(""); private set
    var standortDB by mutableStateOf<GeoPunkt?>(null); private set
    var flugHerkunft by mutableStateOf(""); private set
    var flugStatusCode by mutableStateOf(""); private set
    var flugPosition by mutableStateOf<GeoPunkt?>(null); private set
    var flugKurs by mutableStateOf(0.0); private set
    var flugSpur by mutableStateOf<List<GeoPunkt>>(emptyList()); private set
    var kolonnenName by mutableStateOf(""); private set
    var kolonnenFahrer by mutableStateOf<List<KolonnenFahrer>>(emptyList()); private set
    var ungelesen by mutableStateOf(0); private set
    var fehler by mutableStateOf<String?>(null)

    /** hasKolonneColleagues: mindestens ein anderer Fahrer, der nicht abgelehnt hat. */
    val hatKollegen get() = kolonnenFahrer.any { it.id != fahrerID && it.antwort.lowercase() != "refused" }

    @Serializable private data class DetailZeile(
        val passengers: List<String>? = null,
        val anonymous_guests: Int? = null,
        val is_vip: Boolean? = null,
        val needs_child_seat: Boolean? = null,
        val needs_second_child_seat: Boolean? = null,
        val needs_accessibility: Boolean? = null,
        val needs_luggage: Boolean? = null,
        val ext_route_duration_mins: Int? = null,
        val ext_route_duration_in_traffic_mins: Int? = null,
        val ext_driver_to_dropoff_duration_mins: Int? = null,
        val ext_driver_to_dropoff_duration_in_traffic_mins: Int? = null,
        val ext_driver_to_dropoff_last_sync_at: String? = null,
        val ext_route_polyline: String? = null,
        val ext_driver_to_pickup_polyline: String? = null,
        val flight_origin: String? = null,
        val flug_text: String? = null,
    )
    @Serializable private data class NotizZeile(val note_text: String? = null, val created_at: String? = null, val author_name: String? = null)
    @Serializable private data class GastLink(val guest_id: String? = null)
    @Serializable private data class Gast(
        val id: String,
        val first_name: String? = null,
        val last_name: String? = null,
        val is_vip: Boolean? = null,
        val needs_child_seat: Boolean? = null,
        val needs_second_child_seat: Boolean? = null,
        val needs_accessibility: Boolean? = null,
        val needs_luggage: Boolean? = null,
    )
    @Serializable private data class Live(val lat: Double? = null, val lng: Double? = null, val source: String? = null, val captured_at: String? = null)
    @Serializable private data class Eigenes(val driver_number: Int? = null, val first_name: String? = null, val last_name: String? = null)
    @Serializable private data class Zuordnung(val driver_id: String, val guest_ids: List<String>? = null, val guest_names: List<String>? = null, val response_status: String? = null)
    @Serializable private data class ZuordnungKurz(val job_id: String? = null, val driver_id: String? = null, val response_status: String? = null)
    @Serializable private data class Kollege(
        val id: String, val first_name: String? = null, val last_name: String? = null, val phone: String? = null,
        val avatar_url: String? = null, val vehicle_id: String? = null, val driver_number: Int? = null,
    )
    @Serializable private data class Wagen(val id: String, val brand_model: String? = null, val license_plate: String? = null)
    @Serializable private data class KollegenOrt(val driver_id: String, val lat: Double? = null, val lng: Double? = null)
    @Serializable private data class GastName(val id: String, val first_name: String? = null, val last_name: String? = null)
    @Serializable private data class Kolonne(val name: String? = null)
    @Serializable private data class IDZeile(val id: String)

    companion object {
        private val versteckt = setOf("done", "completed", "arrived", "beendet", "cancelled", "canceled", "refused", "storniert", "stoniert")
        private val tag = Regex("^\\d{4}-\\d{2}-\\d{2}$")
        private fun name(vor: String?, nach: String?) = listOfNotNull(vor, nach).joinToString(" ").trim()
    }

    /** Fahrt wie loadData() in FahrerApp.jsx (eine Fahrt, mit Kolonnen-Zuordnungen). */
    suspend fun fahrtLaden() {
        try {
            // Alle Spalten: eine feste Liste scheitert, wenn eine Spalte live fehlt (pickup_date).
            val zeile = Backend.client.from("jobs").select(Columns.raw("*")) { filter { eq("id", fahrtID) }; limit(1) }
                .let { de.trisar.kern.Backend.json.decodeFromString<List<FahrtZeileB>>(it.data) }.firstOrNull()
            val zuordnungen = runCatching {
                Backend.client.from("convoy_assignments").select(Columns.raw("job_id,driver_id,response_status")) {
                    filter { eq("job_id", fahrtID) }
                }.decodeList<ZuordnungKurz>()
            }.getOrDefault(emptyList())
            fahrt = zeile?.let { z ->
                val eigene = zuordnungen.firstOrNull { it.driver_id == fahrerID }
                val istKolonne = z.convoy_id != null || zuordnungen.isNotEmpty()
                if (versteckt.contains((z.status ?: "").lowercase())) return@let null
                if (istKolonne && eigene?.response_status == "refused") return@let null
                FahrtKopf(
                    id = z.id,
                    status = z.status ?: "",
                    tripType = z.trip_type,
                    abholName = z.pickup_name ?: "",
                    abholAdresse = z.pickup_address ?: "",
                    zielName = z.dropoff_name ?: "",
                    zielAdresse = z.dropoff_address ?: "",
                    flug = z.flight_number ?: z.train_number ?: "STADTFAHRT",
                    fahrtDatum = fahrtDatum(z),
                    etd = (z.etd ?: "12:00").take(5),
                    planEtd = z.original_etd?.take(5),
                    kolonnenID = z.convoy_id,
                    istKolonne = istKolonne,
                    meineAntwort = eigene?.response_status ?: "pending",
                    abholOrtID = z.pickup_ort_id,
                    zielOrtID = z.dropoff_ort_id,
                )
            }
            if (zeile?.pickup_ort_id != null || zeile?.dropoff_ort_id != null) EigeneOrte.einmalLaden()
            fahrtGeladen = true
            ungelesenAktualisieren()
        } catch (e: Exception) {
            fehler = e.message
        }
    }

    suspend fun ungelesenAktualisieren() {
        val k = fahrt?.kolonnenID ?: return
        ungelesen = KolonnenChat.ungelesen(ctx, k, fahrerID)
    }

    private fun fahrtDatum(z: FahrtZeileB): String {
        for (k in listOf(z.ride_date, z.pickup_date, z.service_date)) if (k != null && tag.matches(k)) return k
        val e = z.created_at
        if (e != null && e.length >= 10 && tag.matches(e.take(10))) return e.take(10)
        return LocalDate.now().toString()
    }

    suspend fun laden() {
        try {
            coroutineScope {
                val zeileA = async {
                    Backend.client.from("jobs").select(Columns.raw(
                        "passengers,anonymous_guests,is_vip,needs_child_seat,needs_accessibility,needs_luggage,ext_route_duration_mins,ext_route_duration_in_traffic_mins,ext_driver_to_dropoff_duration_mins,ext_driver_to_dropoff_duration_in_traffic_mins,ext_driver_to_dropoff_last_sync_at,ext_route_polyline,ext_driver_to_pickup_polyline,flight_origin,flug_text:ext_flight_payload::text"
                    )) { filter { eq("id", fahrtID) }; limit(1) }.decodeList<DetailZeile>().firstOrNull()
                }
                val notizA = async {
                    runCatching {
                        Backend.client.from("job_notes").select(Columns.raw("note_text,created_at,author_name")) {
                            filter { eq("job_id", fahrtID) }; order("created_at", Order.DESCENDING)
                        }.decodeList<NotizZeile>()
                    }.getOrDefault(emptyList())
                }
                val linkA = async {
                    runCatching {
                        Backend.client.from("job_guests").select(Columns.raw("guest_id")) { filter { eq("job_id", fahrtID) } }.decodeList<GastLink>()
                    }.getOrDefault(emptyList())
                }
                val liveA = async {
                    runCatching {
                        Backend.client.from("driver_live_locations").select(Columns.raw("lat,lng,source,captured_at")) {
                            filter { eq("driver_id", fahrerID) }; limit(5)
                        }.decodeList<Live>()
                    }.getOrDefault(emptyList())
                }
                val eigenesA = async {
                    runCatching {
                        Backend.client.from("profiles").select(Columns.raw("driver_number,first_name,last_name")) {
                            filter { eq("id", fahrerID) }; limit(1)
                        }.decodeList<Eigenes>().firstOrNull()
                    }.getOrNull()
                }

                val zeile = zeileA.await()
                val notizZeilen = notizA.await()
                val links = linkA.await()
                val live = liveA.await()
                val eigenes = eigenesA.await()

                val gastIDs = links.mapNotNull { it.guest_id }
                val gastZeilen = if (gastIDs.isEmpty()) emptyList() else runCatching {
                    Backend.client.from("guests").select(Columns.raw(
                        "id,first_name,last_name,is_vip,needs_child_seat,needs_second_child_seat,needs_accessibility,needs_luggage"
                    )) { filter { isIn("id", gastIDs) } }.decodeList<Gast>()
                }.getOrDefault(emptyList())

                // Gaeste: verknuepfte Gaeste, sonst Namen aus passengers.
                val verknuepft = gastZeilen.map { name(it.first_name, it.last_name) }.filter { it.isNotEmpty() }
                val namen = verknuepft.ifEmpty { zeile?.passengers ?: emptyList() }
                val geteilt = de.trisar.kern.GaesteAnzeige.teile(namen, zeile?.anonymous_guests ?: 0)
                gaeste = geteilt.namen
                anonym = geteilt.anonym

                // Merkmale in der Reihenfolge der Web-App: Rollstuhl, VIP, Kind, Gepaeck.
                val vip = zeile?.is_vip == true || gastZeilen.any { it.is_vip == true }
                val kind = zeile?.needs_child_seat == true || zeile?.needs_second_child_seat == true ||
                    gastZeilen.any { it.needs_child_seat == true || it.needs_second_child_seat == true }
                val rollstuhl = zeile?.needs_accessibility == true || gastZeilen.any { it.needs_accessibility == true }
                val gepaeck = zeile?.needs_luggage == true || gastZeilen.any { it.needs_luggage == true }
                merkmale = listOfNotNull(
                    if (rollstuhl) "accessibility" else null, if (vip) "vip" else null,
                    if (kind) "child" else null, if (gepaeck) "luggage" else null,
                )

                fahrzeitMin = zeile?.ext_route_duration_in_traffic_mins ?: zeile?.ext_route_duration_mins ?: 0
                tomtomFahrt = polylineLesen(zeile?.ext_route_polyline)
                tomtomAnfahrt = polylineLesen(zeile?.ext_driver_to_pickup_polyline)
                val rest = zeile?.ext_driver_to_dropoff_duration_in_traffic_mins ?: zeile?.ext_driver_to_dropoff_duration_mins
                val sync = FahrtZeit.ausISO(zeile?.ext_driver_to_dropoff_last_sync_at)
                val frisch = rest != null && sync != null && Instant.now().epochSecond - sync.epochSecond < 600
                restZielMin = if (frisch) rest else null
                restZielSync = if (frisch) sync else null

                notizen = notizZeilen.mapNotNull { n ->
                    val text = (n.note_text ?: "").trim()
                    if (text.isEmpty()) return@mapNotNull null
                    val d = FahrtZeit.ausISO(n.created_at)
                    Notiz(d?.let { FahrtZeit.uhrzeit(it) } ?: "", d?.let { FahrtZeit.datumKurz(it) } ?: "", text, (n.author_name ?: "").trim())
                }

                flugLesen(zeile?.flug_text, zeile?.flight_origin)
                kolonneLaden(gaeste)
                fahrerNummer = eigenes?.driver_number?.toString() ?: ""
                fahrerName = name(eigenes?.first_name?.trim(), eigenes?.last_name?.trim())
                // Web nimmt fuer das Auto den OBD-Standort (Teltonika), wenn vorhanden.
                val obdMuster = Regex("teltonika|fmb|obd|telematik|telematics|tracker", RegexOption.IGNORE_CASE)
                val p = live.firstOrNull { obdMuster.containsMatchIn(it.source ?: "") } ?: live.firstOrNull()
                if (p?.lat != null && p.lng != null) standortDB = GeoPunkt(p.lat, p.lng)
                fehler = null
            }
        } catch (e: Exception) {
            fehler = e.message
        }
    }

    /**
     * Zuordnungen der Kolonne mit Namen, Fahrzeug, Telefon und Standort der Kollegen.
     * Gaeste: die Gaeste aller Fahrer der Kolonne, dazu die Fahrgaeste der Fahrt.
     */
    private suspend fun kolonneLaden(passagiere: List<String>) {
        val zuordnungen = runCatching {
            Backend.client.from("convoy_assignments").select(Columns.raw("driver_id,guest_ids,guest_names,response_status")) {
                filter { eq("job_id", fahrtID) }
            }.decodeList<Zuordnung>()
        }.getOrNull()
        if (zuordnungen.isNullOrEmpty()) { kolonnenFahrer = emptyList(); return }
        val ids = zuordnungen.map { it.driver_id }
        val (kollegen, orte, convoy) = coroutineScope {
            val a = async {
                runCatching {
                    Backend.client.from("profiles").select(Columns.raw("id,first_name,last_name,phone,avatar_url,vehicle_id,driver_number")) {
                        filter { isIn("id", ids) }
                    }.decodeList<Kollege>()
                }.getOrDefault(emptyList())
            }
            val b = async {
                runCatching {
                    Backend.client.from("driver_live_locations").select(Columns.raw("driver_id,lat,lng")) { filter { isIn("driver_id", ids) } }
                        .decodeList<KollegenOrt>()
                }.getOrDefault(emptyList())
            }
            val c = async {
                runCatching {
                    Backend.client.from("jobs").select(Columns.raw("convoy_id")) { filter { eq("id", fahrtID) }; limit(1) }
                        .decodeList<ZuordnungKurzConvoy>().firstOrNull()?.convoy_id
                }.getOrNull()
            }
            Triple(a.await(), b.await(), c.await())
        }
        if (convoy != null) {
            runCatching {
                Backend.client.from("convoys").select(Columns.raw("name")) { filter { eq("id", convoy) }; limit(1) }.decodeList<Kolonne>()
            }.getOrNull()?.let { kolonnenName = (it.firstOrNull()?.name ?: "").trim() }
        }
        val wagenIDs = kollegen.mapNotNull { it.vehicle_id }
        val wagen = if (wagenIDs.isEmpty()) emptyList() else runCatching {
            Backend.client.from("vehicles").select(Columns.raw("id,brand_model,license_plate")) { filter { isIn("id", wagenIDs) } }.decodeList<Wagen>()
        }.getOrDefault(emptyList())
        val gastIDs = zuordnungen.flatMap { it.guest_ids ?: emptyList() }.distinct()
        val gastZeilen = if (gastIDs.isEmpty()) emptyList() else runCatching {
            Backend.client.from("guests").select(Columns.raw("id,first_name,last_name")) { filter { isIn("id", gastIDs) } }.decodeList<GastName>()
        }.getOrDefault(emptyList())
        val gastName = gastZeilen.associate { it.id to name(it.first_name, it.last_name) }
        val profil = kollegen.associateBy { it.id }
        val wagenNach = wagen.associateBy { it.id }
        val ortNach = mutableMapOf<String, GeoPunkt>()
        orte.forEach { o -> if (o.lat != null && o.lng != null && !ortNach.containsKey(o.driver_id)) ortNach[o.driver_id] = GeoPunkt(o.lat, o.lng) }

        kolonnenFahrer = zuordnungen.map { z ->
            val p = profil[z.driver_id]
            val w = p?.vehicle_id?.let { wagenNach[it] }
            val g = (z.guest_ids ?: emptyList()).mapNotNull { gastName[it] }.filter { it.isNotEmpty() } + (z.guest_names ?: emptyList()).filter { it.isNotEmpty() }
            KolonnenFahrer(
                id = z.driver_id,
                name = p?.let { name(it.first_name, it.last_name) } ?: "Fahrer",
                telefon = p?.phone ?: "",
                kennzeichen = w?.license_plate ?: "",
                fahrzeug = w?.brand_model ?: "",
                bild = p?.avatar_url ?: "",
                nummer = p?.driver_number?.toString() ?: "",
                antwort = z.response_status ?: "pending",
                gaeste = g,
                standort = if (z.driver_id == fahrerID) null else ortNach[z.driver_id],
            )
        }
        // Gaesteliste wie im Web: alle Gaeste der Kolonne zuerst, dann die Fahrgaeste.
        gaeste = (kolonnenFahrer.flatMap { it.gaeste } + passagiere).distinct()
    }

    @Serializable private data class ZuordnungKurzConvoy(val convoy_id: String? = null)

    /** Live-Position nur, wenn hoechstens 2 min alt (OPENSKY_MAX_LIVE_AGE_MS). */
    private fun flugLesen(text: String?, herkunft: String?) {
        val wurzel = runCatching { Backend.json.parseToJsonElement(text ?: "{}") as? JsonObject }.getOrNull() ?: JsonObject(emptyMap())
        fun JsonElement?.obj() = this as? JsonObject
        fun JsonElement?.str() = (this as? JsonPrimitive)?.takeIf { it.isString }?.content
        fun zahl(w: JsonElement?): Double? = (w as? JsonPrimitive)?.let { it.doubleOrNull ?: it.content.toDoubleOrNull() }
        val zusammenfassung = wurzel["summary"].obj() ?: JsonObject(emptyMap())
        val roh = wurzel["raw"].obj()?.get("FlightStatusResource").obj()?.get("Flights").obj()?.get("Flight")
        val ersterFlug = (roh as? JsonArray)?.firstOrNull().obj() ?: roh.obj() ?: JsonObject(emptyMap())
        val code = zusammenfassung["flight_status_code"].str() ?: ersterFlug["FlightStatus"].obj()?.get("Code").str() ?: ""
        flugStatusCode = code.trim().uppercase()
        val abflug = zusammenfassung["departure_airport"].str() ?: ersterFlug["Departure"].obj()?.get("AirportCode").str() ?: ""
        flugHerkunft = (if (!herkunft.isNullOrEmpty()) herkunft else abflug).trim()

        flugPosition = null
        flugSpur = emptyList()
        val live = wurzel["live_tracking"].obj() ?: return
        val erfasst = FahrtZeit.ausISO(live["captured_at"].str())
        if (erfasst != null && Instant.now().epochSecond - erfasst.epochSecond > 120) return
        val lat = zahl(live["latitude"] ?: live["lat"])
        val lng = zahl(live["longitude"] ?: live["lng"] ?: live["lon"])
        if (lat != null && lng != null && kotlin.math.abs(lat) <= 90 && kotlin.math.abs(lng) <= 180 && kotlin.math.abs(lat) + kotlin.math.abs(lng) > 0.0002) {
            flugPosition = GeoPunkt(lat, lng)
        }
        flugKurs = zahl(live["heading_deg"] ?: live["true_track_deg"]) ?: 0.0
        val punkte = ((live["trail_points"] as? JsonArray) ?: JsonArray(emptyList())).mapNotNull { p ->
            if (p is JsonArray && p.size >= 3) {
                val a = zahl(p[1]); val b = zahl(p[2])
                if (a != null && b != null) return@mapNotNull GeoPunkt(a, b)
            }
            val o = p.obj() ?: return@mapNotNull null
            val a = zahl(o["latitude"] ?: o["lat"]); val b = zahl(o["longitude"] ?: o["lng"] ?: o["lon"])
            if (a != null && b != null) GeoPunkt(a, b) else null
        }
        // normalizeFlightTrailPath: doppelte Punkte raus, hoechstens die letzten 90.
        val spur = mutableListOf<GeoPunkt>()
        for (p in punkte) {
            val l = spur.lastOrNull()
            if (l == null || kotlin.math.abs(l.lat - p.lat) >= 0.00001 || kotlin.math.abs(l.lng - p.lng) >= 0.00001) spur.add(p)
        }
        flugSpur = if (punkte.size > 1) spur.takeLast(90) else emptyList()
    }

    // MARK: Aktionen (handleEndRideFromDetails / handleSendRideNoteFromDetails / handleJobAction)

    @Serializable private data class NeueNotiz(val job_id: String, val note_text: String, val author_name: String)
    @Serializable private data class Status(val status: String)
    @Serializable private data class ZuordnungStatus(val response_status: String? = null)

    suspend fun notizSenden(text: String, autor: String): Boolean {
        val t = text.trim()
        if (t.isEmpty()) return false
        return try {
            Backend.client.from("job_notes").insert(NeueNotiz(fahrtID, t, autor))
            val jetzt = Instant.now()
            notizen = listOf(Notiz(FahrtZeit.uhrzeit(jetzt), FahrtZeit.datumKurz(jetzt), t, autor)) + notizen
            true
        } catch (e: Exception) {
            fehler = "Notiz konnte nicht gespeichert werden: ${e.message}"
            false
        }
    }

    suspend fun beenden(notiz: String, autor: String): Boolean = try {
        val eigene = Backend.client.from("jobs").update(Status("done")) {
            select(Columns.raw("id"))
            filter { eq("id", fahrtID); eq("driver_id", fahrerID) }
        }.decodeList<IDZeile>()
        if (eigene.isEmpty()) {
            // Kolonne: Fahrt gehoert nicht direkt dem Fahrer, Zuordnung pruefen.
            val z = Backend.client.from("convoy_assignments").select(Columns.raw("response_status")) {
                filter { eq("job_id", fahrtID); eq("driver_id", fahrerID) }; limit(1)
            }.decodeList<ZuordnungStatus>()
            val erste = z.firstOrNull()
            if (erste == null || (erste.response_status ?: "").lowercase() == "refused") throw IllegalStateException("Du bist dieser Fahrt nicht zugeordnet.")
            val k = Backend.client.from("jobs").update(Status("done")) {
                select(Columns.raw("id")); filter { eq("id", fahrtID) }
            }.decodeList<IDZeile>()
            if (k.isEmpty()) throw IllegalStateException("Fahrt konnte nicht beendet werden.")
        }
        if (notiz.trim().isNotEmpty()) notizSenden(notiz, autor)
        true
    } catch (e: Exception) {
        fehler = "Fahrt beenden fehlgeschlagen: ${e.message}"
        false
    }

    @Serializable private data class KolonnenAntwort(
        val job_id: String, val driver_id: String, val response_status: String, val responded_at: String, val refusal_reason: String?,
    )
    @Serializable private data class FahrtAntwort(
        val status: String, val refused_by_driver_id: String?, val refusal_reason: String?,
        val driver_response_status: String, val driver_responded_at: String,
    )

    /** Stornieren = Ablehnen mit Grund (antworten(annehmen: false) in Fahrten.swift). */
    suspend fun stornieren(grund: String): Boolean {
        val f = fahrt ?: return false
        val jetzt = FahrtZeit.iso()
        val text = grund.trim().ifEmpty { "Fahrer hat die Fahrt abgelehnt." }
        return try {
            if (f.istKolonne) {
                Backend.client.from("convoy_assignments").upsert(KolonnenAntwort(f.id, fahrerID, "refused", jetzt, text)) {
                    onConflict = "job_id,driver_id"
                }
            } else {
                val ergebnis = Backend.client.from("jobs").update(FahrtAntwort("refused", fahrerID, text, "refused", jetzt)) {
                    select(Columns.raw("id")); filter { eq("id", f.id); eq("driver_id", fahrerID) }
                }.decodeList<IDZeile>()
                if (ergebnis.isEmpty()) throw IllegalStateException("Status konnte nicht gespeichert werden (keine Berechtigung).")
            }
            true
        } catch (e: Exception) {
            fehler = "Aktion konnte nicht gespeichert werden: ${e.message}"
            false
        }
    }
}

/** Google-Polyline (Genauigkeit 1e5) in Punkte, wie decodeGooglePolyline im Web und FahrtDetails.swift. */
fun polylineLesen(text: String?): List<de.trisar.kern.GeoPunkt> {
    if (text.isNullOrEmpty()) return emptyList()
    val punkte = mutableListOf<de.trisar.kern.GeoPunkt>()
    var i = 0; var lat = 0; var lng = 0
    fun zahl(): Int? {
        var ergebnis = 0; var verschiebung = 0
        while (i < text.length) {
            val b = text[i].code - 63
            i++
            ergebnis = ergebnis or ((b and 0x1f) shl verschiebung)
            verschiebung += 5
            if (b < 0x20) return if (ergebnis and 1 != 0) (ergebnis shr 1).inv() else (ergebnis shr 1)
        }
        return null
    }
    while (i < text.length) {
        val dLat = zahl() ?: break
        val dLng = zahl() ?: break
        lat += dLat; lng += dLng
        punkte.add(de.trisar.kern.GeoPunkt(lat / 1e5, lng / 1e5))
    }
    return punkte
}
