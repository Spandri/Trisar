package de.trisar.dispo.standby

import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import de.trisar.kern.Backend
import de.trisar.kern.GeoPunkt
import de.trisar.kern.Routen
import de.trisar.kern.hex
import io.github.jan.supabase.postgrest.from
import io.github.jan.supabase.postgrest.query.Columns
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
import java.time.LocalTime
import java.time.OffsetDateTime
import java.time.ZoneId

/**
 * Standby am Event-Ort in der Dispo (admin/src/shared/standby.js). Tabellen standby, standby_fahrer,
 * standby_ereignis (Migration 20261112060000). Laden mit Realtime, Anlegen, Zeiten aendern,
 * Fahrer dazu/weg, Loeschen, Standby-Fahrten aus den Ereignissen.
 */
internal val SB_LIME = hex(0xE3F654)
internal val SB_ROT = hex(0xFF6F63)
internal val SB_ORANGE = hex(0xFFCD8A)
internal val SB_GRAU = hex(0x868687)
internal val SB_GRUEN = hex(0x59BE80)

internal val BERLIN: ZoneId = ZoneId.of("Europe/Berlin")
internal fun hm(wert: String?): String = (wert ?: "").take(5)
internal fun heuteBerlin(): String = LocalDate.now(BERLIN).toString()

/** Zeitpunkt aus Postgres ("2026-11-12 18:03:00+00" oder ISO) als Uhrzeit HH:MM in Berlin. */
internal fun uhrIso(iso: String?): String {
    if (iso.isNullOrBlank()) return ""
    val t = runCatching { Instant.parse(iso) }.getOrNull()
        ?: runCatching { OffsetDateTime.parse(iso.replace(" ", "T")).toInstant() }.getOrNull()
        ?: runCatching { OffsetDateTime.parse(iso.replace(" ", "T") + ":00").toInstant() }.getOrNull()
        ?: return ""
    val l = t.atZone(BERLIN).toLocalTime()
    return "%02d:%02d".format(l.hour, l.minute)
}

internal fun zeitpunkt(iso: String?): Instant? {
    if (iso.isNullOrBlank()) return null
    return runCatching { Instant.parse(iso) }.getOrNull()
        ?: runCatching { OffsetDateTime.parse(iso.replace(" ", "T")).toInstant() }.getOrNull()
        ?: runCatching { OffsetDateTime.parse(iso.replace(" ", "T") + ":00").toInstant() }.getOrNull()
}

@Serializable
internal data class StandbyDaten(
    val id: String,
    val datum: String,
    val von: String,
    val bis: String,
    val ort_id: String? = null,
    val ort_name: String = "",
    val adresse: String? = null,
    val lat: Double = 0.0,
    val lng: Double = 0.0,
    val notiz: String? = null,
)

/**
 * Standby-Karte des KI-Assistenten (dispo-admin/standbyKi.ts standbyKarte), auch Vorlage fuer "Standby verschicken".
 * ortId leer = kein eigener Ort, lat/lng null = Ort noch nicht gefunden, fehlt aus von, bis, zeiten, ort, fahrer.
 */
@Serializable
data class StandbyVorlage(
    val datum: String = "", val von: String = "", val bis: String = "",
    val ortName: String = "", val ortId: String = "", val adresse: String = "",
    val lat: Double? = null, val lng: Double? = null,
    val radiusRein: Int? = null, val radiusRaus: Int? = null,
    val fahrerNamen: List<String> = emptyList(), val fahrerIds: List<String> = emptyList(),
    val notiz: String = "", val fehlt: List<String> = emptyList(),
) {
    /** Text im Ortsfeld: Name beim eigenen Ort, sonst die Adresse. */
    val ortFeld: String get() = if (ortId.isNotBlank()) ortName else adresse.ifBlank { ortName }
}

@Serializable
internal data class StandbyFahrerZeile(
    val standby_id: String,
    val driver_id: String,
    val status: String = "pending",
    val vorher: JsonElement? = null,
    val zustand: String? = null,
    val zustand_seit: String? = null,
    /** Ankunft zurueck am Event auf dem Rueckweg (Server, TomTom mit Verkehr). */
    val rueck_ankunft: String? = null,
)

internal data class SbProfil(val id: String, val vorname: String, val nachname: String, val nummer: String) {
    val name: String get() = "$vorname $nachname".trim().ifEmpty { "Fahrer" }
    /** "S. Spandri (99)", damit der Zustand rechts daneben Platz hat. */
    val kurz: String get() {
        val n = (if (vorname.isNotEmpty() && nachname.isNotEmpty()) "${vorname.first()}. " else vorname) + nachname
        return n.trim().ifEmpty { "Fahrer" } + if (nummer.isNotEmpty()) " ($nummer)" else ""
    }
}

internal data class SbFahrer(val zeile: StandbyFahrerZeile, val profil: SbProfil?) {
    val driverId get() = zeile.driver_id
    val name get() = profil?.name ?: "Fahrer"
}

internal data class DispoStandby(val d: StandbyDaten, val fahrer: List<SbFahrer>) {
    val id get() = d.id
}

@Serializable
internal data class StandbyEreignis(
    val id: Long,
    val standby_id: String,
    val driver_id: String,
    val art: String,
    val zeit: String,
    val lat: Double? = null,
    val lng: Double? = null,
)

/** Standby-Fahrt fuer Alle Fahrten: gast_drin = losgefahren, abgesetzt = Rueckweg, zurueck = wieder am Event. */
internal data class StandbyFahrt(
    val id: String, val standbyId: String, val driverId: String, val start: String,
    var abgesetzt: String? = null, var zurueck: String? = null, var ende: String? = null,
) {
    val status: String get() = when {
        zurueck != null -> "zurueck"
        ende != null -> "beendet"
        abgesetzt != null -> "rueckweg"
        else -> "unterwegs"
    }
}

/** Zustand eines Fahrers als Text und Farbe (Dispo-Uebersicht). */
internal fun zustandAnzeige(f: SbFahrer): Pair<String, androidx.compose.ui.graphics.Color> {
    val z = f.zeile
    if (z.status == "pending") return (if (z.vorher != null && z.vorher !is JsonNull) "Änderung angefragt" else "Angefragt") to SB_GRAU
    if (z.status == "refused") return "Abgelehnt" to SB_ROT
    val seit = if (!z.zustand_seit.isNullOrBlank()) " seit ${uhrIso(z.zustand_seit)}" else ""
    return when (z.zustand) {
        "vor_ort" -> "Vor Ort$seit" to SB_LIME
        "mit_gast" -> "Mit Gast$seit" to SB_ORANGE
        "rueckweg" -> "Auf Rückweg$seit" to SB_LIME
        else -> "Angenommen" to SB_LIME
    }
}

/** Laeuft gerade oder kommt noch (Ende nicht vorbei). */
internal fun standbyAktuell(s: DispoStandby): Boolean {
    val tag = runCatching { LocalDate.parse(s.d.datum.take(10)) }.getOrNull() ?: return false
    val von = runCatching { LocalTime.parse(hm(s.d.von)) }.getOrDefault(LocalTime.MIDNIGHT)
    val bis = runCatching { LocalTime.parse(hm(s.d.bis)) }.getOrDefault(LocalTime.MIDNIGHT)
    val ende = (if (!bis.isAfter(von)) tag.plusDays(1) else tag).atTime(bis).atZone(BERLIN).toInstant()
    return ende.isAfter(Instant.now()) || s.d.datum.take(10) >= heuteBerlin()
}

/** Gleiche Wahl wie fahrtenBilden im Web. */
internal fun fahrtenBilden(ereignisse: List<StandbyEreignis>): List<StandbyFahrt> {
    val fahrten = mutableListOf<StandbyFahrt>()
    val offen = HashMap<String, StandbyFahrt>()
    ereignisse.sortedBy { zeitpunkt(it.zeit) ?: Instant.EPOCH }.forEach { e ->
        val k = "${e.standby_id}|${e.driver_id}"
        val f = offen[k]
        when (e.art) {
            "gast_drin" -> {
                if (f != null) { f.ende = e.zeit; offen.remove(k) }
                val neu = StandbyFahrt("$k|${e.id}", e.standby_id, e.driver_id, e.zeit)
                fahrten += neu
                offen[k] = neu
            }
            "abgesetzt" -> if (f != null) f.abgesetzt = e.zeit
            "zurueck" -> if (f != null) { f.zurueck = e.zeit; f.ende = e.zeit; offen.remove(k) }
        }
    }
    return fahrten
}

/** Standbys ab gestern mit ihren Fahrern und Ereignissen, live (useStandbys + useStandbyFahrten). */
internal object DispoStandbySpeicher {
    var liste by mutableStateOf<List<DispoStandby>?>(null)
        private set
    var ereignisse by mutableStateOf<List<StandbyEreignis>>(emptyList())
        private set
    /** Ankunft zurueck am Event je Standby-Fahrt (Route vom Live-Standort), als Instant. */
    var ankunft by mutableStateOf<Map<String, Instant>>(emptyMap())
        private set

    private val bereich = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private var gestartet = false

    fun starten() {
        if (gestartet) { bereich.launch { laden() }; return }
        gestartet = true
        bereich.launch { laden() }
        val k = Backend.client.channel("dispo-standby-${System.currentTimeMillis()}")
        val a = k.postgresChangeFlow<PostgresAction>(schema = "public") { table = "standby" }
        val b = k.postgresChangeFlow<PostgresAction>(schema = "public") { table = "standby_fahrer" }
        val c = k.postgresChangeFlow<PostgresAction>(schema = "public") { table = "standby_ereignis" }
        bereich.launch { a.collect { laden() } }
        bereich.launch { b.collect { laden() } }
        bereich.launch { c.collect { ereignisseLaden() } }
        bereich.launch { runCatching { k.subscribe() } }
    }

    private fun s(o: JsonObject, k: String): String = (o[k] as? JsonPrimitive)?.takeIf { it !is JsonNull }?.content.orEmpty()

    suspend fun laden() {
        runCatching {
            val gestern = LocalDate.now(BERLIN).minusDays(1).toString()
            val standbys = Backend.client.from("standby").select(Columns.raw("id, datum, von, bis, ort_id, ort_name, adresse, lat, lng, notiz")) {
                filter { gte("datum", gestern) }
                order("datum", io.github.jan.supabase.postgrest.query.Order.ASCENDING)
                order("von", io.github.jan.supabase.postgrest.query.Order.ASCENDING)
            }.decodeList<StandbyDaten>()
            val ids = standbys.map { it.id }
            val fahrer = if (ids.isEmpty()) emptyList() else Backend.client.from("standby_fahrer")
                .select(Columns.raw("standby_id, driver_id, status, vorher, zustand, zustand_seit, rueck_ankunft")) { filter { isIn("standby_id", ids) } }
                .decodeList<StandbyFahrerZeile>()
            val fids = fahrer.map { it.driver_id }.distinct()
            val profile = if (fids.isEmpty()) emptyList() else Backend.client.from("profiles")
                .select(Columns.raw("id, first_name, last_name, driver_number")) { filter { isIn("id", fids) } }
                .decodeList<JsonObject>().map { SbProfil(s(it, "id"), s(it, "first_name"), s(it, "last_name"), s(it, "driver_number")) }
            val je = profile.associateBy { it.id }
            standbys.map { sb ->
                DispoStandby(sb, fahrer.filter { it.standby_id == sb.id }.map { SbFahrer(it, je[it.driver_id]) }.sortedBy { it.name.lowercase() })
            }
        }.onSuccess { liste = it; ereignisseLaden() }
            .onFailure { if (liste == null) liste = emptyList() }
    }

    suspend fun ereignisseLaden() {
        val ids = (liste ?: emptyList()).filter(::standbyAktuell).map { it.id }
        if (ids.isEmpty()) { ereignisse = emptyList(); return }
        runCatching {
            Backend.client.from("standby_ereignis").select(Columns.raw("id, standby_id, driver_id, art, zeit, lat, lng")) {
                filter { isIn("standby_id", ids) }
                order("zeit", io.github.jan.supabase.postgrest.query.Order.ASCENDING)
            }.decodeList<StandbyEreignis>()
        }.onSuccess { ereignisse = it; ankunftAusListe() }
    }

    /** Ankunftszeit fuer Fahrten auf dem Rueckweg: rechnet der Server mit TomTom (standby_fahrer.rueck_ankunft),
     *  kommt per Realtime mit laden(). ctx bleibt fuer den Aufrufer. */
    @Suppress("UNUSED_PARAMETER")
    suspend fun ankunftRechnen(ctx: Context) = ankunftAusListe()

    private fun ankunftAusListe() {
        val aktuell = (liste ?: emptyList()).filter(::standbyAktuell)
        val neu = mutableMapOf<String, Instant>()
        for (f in fahrtenBilden(ereignisse).filter { it.status == "rueckweg" }) {
            val z = aktuell.firstOrNull { it.d.id == f.standbyId }?.fahrer?.firstOrNull { it.zeile.driver_id == f.driverId }?.zeile
            zeitpunkt(z?.rueck_ankunft)?.let { neu[f.id] = it }
        }
        ankunft = neu
    }

    // MARK: Schreiben

    data class OrtWahl(val id: String?, val name: String, val adresse: String?, val lat: Double, val lng: Double, val rein: Int = 150, val raus: Int = 300)

    /** Neuer Standby mit je einer Anfrage pro Fahrer. Ergebnis: ID oder Fehlertext. */
    suspend fun anlegen(datum: String, von: String, bis: String, ort: OrtWahl, notiz: String, fahrerIds: List<String>): Result<String> = runCatching {
        val zeile = buildJsonObject {
            put("datum", datum); put("von", von); put("bis", bis)
            put("ort_id", ort.id?.let { JsonPrimitive(it) } ?: JsonNull)
            put("ort_name", ort.name)
            put("adresse", ort.adresse?.let { JsonPrimitive(it) } ?: JsonNull)
            put("lat", ort.lat); put("lng", ort.lng)
            put("radius_rein_m", ort.rein); put("radius_raus_m", ort.raus)
            put("notiz", notiz.ifBlank { null }?.let { JsonPrimitive(it) } ?: JsonNull)
        }
        val neu = Backend.client.from("standby").insert(zeile) { select(Columns.raw("id")) }.decodeList<JsonObject>().first()
        val id = s(neu, "id")
        Backend.client.from("standby_fahrer").insert(JsonArray(fahrerIds.map { f -> buildJsonObject { put("standby_id", id); put("driver_id", f) } }))
        laden()
        id
    }

    /** Zeiten, Datum oder Notiz: der Trigger macht aus geaenderten Zeiten Anfragen an die Fahrer. */
    suspend fun aendern(id: String, aenderung: JsonObject): String = runCatching {
        Backend.client.from("standby").update(aenderung) { filter { eq("id", id) } }
        laden()
    }.exceptionOrNull()?.message.orEmpty()

    suspend fun fahrerDazu(id: String, fahrerIds: List<String>): String = runCatching {
        Backend.client.from("standby_fahrer").upsert(JsonArray(fahrerIds.map { f ->
            buildJsonObject { put("standby_id", id); put("driver_id", f); put("status", "pending") }
        })) { onConflict = "standby_id,driver_id" }
        laden()
    }.exceptionOrNull()?.message.orEmpty()

    suspend fun fahrerWeg(id: String, driverId: String): String = runCatching {
        Backend.client.from("standby_fahrer").delete { filter { eq("standby_id", id); eq("driver_id", driverId) } }
        laden()
    }.exceptionOrNull()?.message.orEmpty()

    /** Erst die Fahrer (jeder bekommt "Standby zurückgezogen"), dann den Standby. */
    suspend fun loeschen(id: String): String = runCatching {
        runCatching { Backend.client.from("standby_fahrer").delete { filter { eq("standby_id", id) } } }
        Backend.client.from("standby").delete { filter { eq("id", id) } }
        laden()
    }.exceptionOrNull()?.message.orEmpty()
}
