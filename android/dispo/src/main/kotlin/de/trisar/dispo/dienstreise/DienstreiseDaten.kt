package de.trisar.dispo.dienstreise

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.graphics.Color
import de.trisar.dispo.standby.BERLIN
import de.trisar.dispo.standby.SbProfil
import de.trisar.dispo.standby.heuteBerlin
import de.trisar.kern.Backend
import de.trisar.kern.DienstreiseAbschnitt
import de.trisar.kern.DienstreiseZeile
import io.github.jan.supabase.functions.functions
import io.ktor.client.plugins.timeout
import io.ktor.client.request.setBody
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.contentType
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.jsonObject
import de.trisar.kern.ReiseVerbindung
import de.trisar.kern.hex
import io.github.jan.supabase.postgrest.from
import io.github.jan.supabase.postgrest.query.Columns
import io.github.jan.supabase.postgrest.query.Order
import io.github.jan.supabase.realtime.PostgresAction
import io.github.jan.supabase.realtime.channel
import io.github.jan.supabase.realtime.postgresChangeFlow
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.time.Instant
import java.time.LocalDate

/**
 * Dienstreise in der Dispo (admin/src/shared/dienstreise.js). Tabellen dienstreise, dienstreise_fahrer
 * (Migration 20261113220000). Laden mit Realtime, Anlegen, Fahrer dazu/weg, Loeschen.
 * Verbindung (Zug/Flug) ueber ReiseVerbindung.holen in kern.
 */
internal val REISE_LIME = hex(0xE3F654)
internal val REISE_ROT = hex(0xFF6F63)
internal val REISE_GRAU = hex(0x868687)

@Serializable
internal data class ReiseFahrerZeile(
    val dienstreise_id: String,
    val driver_id: String,
    val status: String = "pending",
    val beendet: String? = null,
)

internal data class ReiseFahrer(val zeile: ReiseFahrerZeile, val profil: SbProfil?) {
    val driverId get() = zeile.driver_id
    val name get() = profil?.name ?: "Fahrer"
}

internal data class DispoDienstreise(
    val r: DienstreiseZeile,
    val fahrer: List<ReiseFahrer>,
    /** Abschnitte (Umstiege) nach Reihenfolge, leer bei einer einzigen Verbindung. */
    val abschnitte: List<DienstreiseAbschnitt> = emptyList(),
) {
    val id get() = r.id
}

/** Zustand eines Fahrers als Text und Farbe (Dispo-Uebersicht). */
internal fun reiseZustand(f: ReiseFahrer): Pair<String, Color> = when {
    f.zeile.status == "pending" -> "Angefragt" to REISE_GRAU
    f.zeile.status == "refused" -> "Abgelehnt" to REISE_ROT
    f.zeile.beendet != null -> "Beendet" to REISE_GRAU
    else -> "Angenommen" to REISE_LIME
}

/** Kommt noch oder ist heute, oder jemand ist noch unterwegs. */
internal fun reiseAktuell(r: DispoDienstreise): Boolean {
    if (r.r.datum.take(10) >= heuteBerlin()) return true
    return r.fahrer.any { it.zeile.status == "accepted" && it.zeile.beendet == null }
}

/** Dienstreisen ab gestern mit ihren Fahrern, live (useDienstreisen). */
internal object DispoDienstreiseSpeicher {
    var liste by mutableStateOf<List<DispoDienstreise>?>(null)
        private set

    private val bereich = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private var gestartet = false

    fun starten() {
        if (gestartet) { bereich.launch { laden() }; return }
        gestartet = true
        bereich.launch { laden() }
        val k = Backend.client.channel("dispo-dienstreise-${System.currentTimeMillis()}")
        val a = k.postgresChangeFlow<PostgresAction>(schema = "public") { table = "dienstreise" }
        val b = k.postgresChangeFlow<PostgresAction>(schema = "public") { table = "dienstreise_fahrer" }
        val c = k.postgresChangeFlow<PostgresAction>(schema = "public") { table = "dienstreise_abschnitt" }
        bereich.launch { c.collect { laden() } }
        bereich.launch { a.collect { laden() } }
        bereich.launch { b.collect { laden() } }
        bereich.launch { runCatching { k.subscribe() } }
    }

    private fun s(o: JsonObject, k: String): String = (o[k] as? JsonPrimitive)?.takeIf { it !is JsonNull }?.content.orEmpty()

    suspend fun laden() {
        runCatching {
            val gestern = LocalDate.now(BERLIN).minusDays(1).toString()
            val reisen = Backend.client.from("dienstreise").select(Columns.raw(DienstreiseZeile.SPALTEN)) {
                filter { gte("datum", gestern) }
                order("datum", Order.ASCENDING)
                order("start_zeit", Order.ASCENDING)
            }.decodeList<DienstreiseZeile>()
            val ids = reisen.map { it.id }
            val fahrer = if (ids.isEmpty()) emptyList() else Backend.client.from("dienstreise_fahrer")
                .select(Columns.raw("dienstreise_id, driver_id, status, beendet")) { filter { isIn("dienstreise_id", ids) } }
                .decodeList<ReiseFahrerZeile>()
            // Abschnitte (Umstiege). Fehlt die Tabelle noch (alte Datenbank), bleibt es bei der einen Verbindung.
            val abschnitte = if (ids.isEmpty()) emptyList() else runCatching {
                Backend.client.from("dienstreise_abschnitt").select(Columns.raw("*")) {
                    filter { isIn("dienstreise_id", ids) }
                    order("reihenfolge", Order.ASCENDING)
                }.decodeList<DienstreiseAbschnitt>()
            }.getOrDefault(emptyList())
            val fids = fahrer.map { it.driver_id }.distinct()
            val profile = if (fids.isEmpty()) emptyList() else Backend.client.from("profiles")
                .select(Columns.raw("id, first_name, last_name, driver_number")) { filter { isIn("id", fids) } }
                .decodeList<JsonObject>().map { SbProfil(s(it, "id"), s(it, "first_name"), s(it, "last_name"), s(it, "driver_number")) }
            val je = profile.associateBy { it.id }
            reisen.map { r ->
                DispoDienstreise(r, fahrer.filter { it.dienstreise_id == r.id }.map { ReiseFahrer(it, je[it.driver_id]) }.sortedBy { it.name.lowercase() },
                    abschnitte.filter { it.dienstreise_id == r.id }.sortedBy { it.reihenfolge })
            }
        }.onSuccess { liste = it }
            .onFailure { if (liste == null) liste = emptyList() }
    }

    // MARK: Schreiben

    data class OrtWahl(val id: String?, val name: String, val adresse: String?, val lat: Double, val lng: Double)

    private fun text(wert: String?): JsonElement = wert?.ifBlank { null }?.let { JsonPrimitive(it) } ?: JsonNull

    /**
     * Neue Dienstreise mit je einer Anfrage pro Fahrer. Die Verbindung beim Anlegen wird gemerkt
     * (Rueckfall, falls die Abfrage spaeter nicht klappt). Ergebnis: ID oder Fehler.
     */
    suspend fun anlegen(
        datum: String, startZeit: String, start: OrtWahl, ziel: OrtWahl,
        zugnummer: String, flugnummer: String, notiz: String, fahrerIds: List<String>,
        /** ID schon beim Oeffnen erzeugt (Ticket liegt im Ordner der Dienstreise). */
        id: String? = null,
        abschnitte: List<NeuerAbschnitt> = emptyList(),
        ticket: Ticket? = null, reisender: String = "", auftragsnummer: String = "",
    ): Result<String> = runCatching {
        val vorlage = DienstreiseZeile(
            id = id.orEmpty(), datum = datum, start_zeit = startZeit,
            start_ort_id = start.id, start_name = start.name, start_adresse = start.adresse, start_lat = start.lat, start_lng = start.lng,
            ziel_ort_id = ziel.id, ziel_name = ziel.name, ziel_adresse = ziel.adresse, ziel_lat = ziel.lat, ziel_lng = ziel.lng,
            zugnummer = zugnummer.ifBlank { null }, flugnummer = flugnummer.ifBlank { null },
        )
        val verbindung = runCatching { ReiseVerbindung.holen(vorlage) }.getOrNull()?.takeIf { it.fehler == null }
        val zeile = buildJsonObject {
            if (id != null) put("id", id)
            put("datum", datum); put("start_zeit", startZeit)
            put("start_ort_id", text(start.id)); put("start_name", start.name); put("start_adresse", text(start.adresse))
            put("start_lat", start.lat); put("start_lng", start.lng)
            put("ziel_ort_id", text(ziel.id)); put("ziel_name", ziel.name); put("ziel_adresse", text(ziel.adresse))
            put("ziel_lat", ziel.lat); put("ziel_lng", ziel.lng)
            put("zugnummer", text(zugnummer)); put("flugnummer", text(flugnummer)); put("notiz", text(notiz))
            put("verbindung", verbindung?.alsJson() ?: JsonNull)
            put("verbindung_stand", if (verbindung != null) JsonPrimitive(Instant.now().toString()) else JsonNull)
            if (ticket != null) { put("ticket_pfad", ticket.pfad); put("ticket_name", ticket.name.ifBlank { "Ticket.pdf" }) }
            if (reisender.isNotBlank()) put("reisender", reisender)
            if (auftragsnummer.isNotBlank()) put("auftragsnummer", auftragsnummer)
        }
        val neu = Backend.client.from("dienstreise").insert(zeile) { select(Columns.raw("id")) }.decodeList<JsonObject>().first()
        val neueId = s(neu, "id")
        // Abschnitte vor den Fahrern speichern: die Fahrer bekommen die Push erst, wenn alles da ist.
        if (abschnitte.isNotEmpty()) {
            Backend.client.from("dienstreise_abschnitt").insert(JsonArray(abschnitte.mapIndexed { i, x ->
                buildJsonObject {
                    put("dienstreise_id", neueId); put("reihenfolge", i); put("art", x.art.ifBlank { "zug" })
                    put("nummer", text(x.nummer)); put("von_name", x.vonName)
                    put("von_lat", x.vonLat?.let { JsonPrimitive(it) } ?: JsonNull); put("von_lng", x.vonLng?.let { JsonPrimitive(it) } ?: JsonNull)
                    put("ab_datum", x.abDatum.ifBlank { datum }); put("ab_zeit", text(x.abZeit)); put("gleis_ab", text(x.gleisAb))
                    put("nach_name", text(x.nachName))
                    put("nach_lat", x.nachLat?.let { JsonPrimitive(it) } ?: JsonNull); put("nach_lng", x.nachLng?.let { JsonPrimitive(it) } ?: JsonNull)
                    put("an_datum", text(x.anDatum)); put("an_zeit", text(x.anZeit)); put("gleis_an", text(x.gleisAn)); put("hinweis", text(x.hinweis))
                }
            }))
        }
        Backend.client.from("dienstreise_fahrer").insert(JsonArray(fahrerIds.map { f -> buildJsonObject { put("dienstreise_id", neueId); put("driver_id", f) } }))
        laden()
        neueId
    }

    /** Ticket in der Ablage (Pfad "<dienstreise_id>/ticket.<endung>") mit Dateiname. */
    data class Ticket(val pfad: String, val name: String)

    /** Abschnitt zum Anlegen (wie die Zeilen in dienstreiseAnlegen im Web). */
    data class NeuerAbschnitt(
        val art: String, val nummer: String, val vonName: String, val vonLat: Double?, val vonLng: Double?,
        val abDatum: String, val abZeit: String, val gleisAb: String,
        val nachName: String, val nachLat: Double?, val nachLng: Double?,
        val anDatum: String, val anZeit: String, val gleisAn: String, val hinweis: String,
    )

    /** Ein Abschnitt, wie ihn dispo-admin ticket_lesen liefert. */
    data class TicketAbschnitt(
        val art: String, val nummer: String, val von: String, val nach: String, val abDatum: String, val ab: String,
        val anDatum: String, val an: String, val gleisAb: String, val gleisAn: String, val hinweis: String,
    )

    /** Was der Server aus dem Ticket gelesen hat. */
    data class TicketGelesen(
        val name: String, val auftragsnummer: String, val klasse: String, val tarif: String,
        val zugbindung: List<String>, val datum: String, val abschnitte: List<TicketAbschnitt>,
    )

    /** Ergebnis von ticketHochladenUndLesen: ok, Ticket, gelesen (oder null) und ein Hinweis/Fehler. */
    data class TicketErgebnis(val ok: Boolean, val ticket: Ticket? = null, val gelesen: TicketGelesen? = null, val fehler: String = "")

    /** Ticket in die Ablage legen (Ordner = ID der Dienstreise) und vom Server lesen lassen (ticket_lesen). */
    suspend fun ticketHochladenUndLesen(reiseId: String, name: String, typ: String, daten: ByteArray): TicketErgebnis {
        val endung = if (name.lowercase().endsWith(".pdf")) "pdf" else typ.substringAfter('/', "pdf").ifBlank { "pdf" }
        val pfad = "$reiseId/ticket.$endung"
        val fehler = de.trisar.kern.TicketAblage.hochladen(pfad, daten, typ.ifBlank { "application/pdf" })
        if (fehler.isNotEmpty()) return TicketErgebnis(false, fehler = "Hochladen fehlgeschlagen: $fehler")
        val ticket = Ticket(pfad, name)
        val o = runCatching {
            val text = Backend.client.functions.invoke("dispo-admin") {
                contentType(ContentType.Application.Json)
                setBody(buildJsonObject { put("aktion", "ticket_lesen"); put("pfad", pfad) }.toString())
                timeout { requestTimeoutMillis = 90_000; socketTimeoutMillis = 90_000 }
            }.bodyAsText()
            Backend.json.parseToJsonElement(text).jsonObject
        }.getOrNull() ?: return TicketErgebnis(true, ticket, null, "Ticket gespeichert, aber nicht gelesen.")
        val erkannt = (o["erkannt"] as? JsonPrimitive)?.booleanOrNull == true
        if (!erkannt) return TicketErgebnis(true, ticket, null, s(o, "meldung"))
        val teile = (o["abschnitte"] as? JsonArray).orEmpty().mapNotNull { e ->
            val a = e as? JsonObject ?: return@mapNotNull null
            TicketAbschnitt(s(a, "art"), s(a, "nummer"), s(a, "von"), s(a, "nach"), s(a, "ab_datum"), s(a, "ab"),
                s(a, "an_datum"), s(a, "an"), s(a, "gleis_ab"), s(a, "gleis_an"), s(a, "hinweis"))
        }
        val bindung = (o["zugbindung"] as? JsonArray).orEmpty().mapNotNull { (it as? JsonPrimitive)?.takeIf { p -> p !is JsonNull }?.content }
        return TicketErgebnis(true, ticket, TicketGelesen(s(o, "name"), s(o, "auftragsnummer"), s(o, "klasse"), s(o, "tarif"), bindung, s(o, "datum"), teile))
    }

    /** Datum, Startzeit oder Notiz: der Trigger macht aus geaenderten Zeiten neue Anfragen an die Fahrer. */
    suspend fun aendern(id: String, aenderung: JsonObject): String = runCatching {
        Backend.client.from("dienstreise").update(aenderung) { filter { eq("id", id) } }
        laden()
    }.exceptionOrNull()?.message.orEmpty()

    /** Neue Fahrer bekommen eine Anfrage, schon eingetragene bleiben wie sie sind (ignoreDuplicates). */
    suspend fun fahrerDazu(id: String, fahrerIds: List<String>): String = runCatching {
        val schon = liste?.firstOrNull { it.id == id }?.fahrer?.map { it.driverId }?.toSet().orEmpty()
        val neu = fahrerIds.distinct().filter { it !in schon }
        if (neu.isNotEmpty()) {
            Backend.client.from("dienstreise_fahrer").insert(JsonArray(neu.map { f -> buildJsonObject { put("dienstreise_id", id); put("driver_id", f) } }))
        }
        laden()
    }.exceptionOrNull()?.message.orEmpty()

    suspend fun fahrerWeg(id: String, driverId: String): String = runCatching {
        Backend.client.from("dienstreise_fahrer").delete { filter { eq("dienstreise_id", id); eq("driver_id", driverId) } }
        laden()
    }.exceptionOrNull()?.message.orEmpty()

    /** Erst die Fahrer (jeder bekommt "Dienstreise zurückgezogen"), dann die Reise. */
    suspend fun loeschen(id: String): String = runCatching {
        runCatching { Backend.client.from("dienstreise_fahrer").delete { filter { eq("dienstreise_id", id) } } }
        Backend.client.from("dienstreise").delete { filter { eq("id", id) } }
        laden()
    }.exceptionOrNull()?.message.orEmpty()
}
