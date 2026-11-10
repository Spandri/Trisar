package de.trisar.dispo.stamm

import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import de.trisar.kern.Backend
import io.github.jan.supabase.auth.auth
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
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import java.text.Collator
import java.util.Locale
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.put

// Stammdaten der Dispo (vehicles, guests, eigenes profiles-Profil), Abfragen 1:1 wie in admin/src
// und Stammdaten.swift. Zeilen kommen als JsonObject, weil das Web mit select('*') liest und Spalten
// je nach Datenbankstand fehlen koennen (z. B. note_text, is_vip).

/** Zum Aufraeumen nach dem Verlassen einer Seite (Kanal abmelden), unabhaengig von deren Scope. */
internal val stammAufraeumen = CoroutineScope(SupervisorJob() + Dispatchers.Main)

internal class StammFehler(text: String) : Exception(text)

/** Ein Realtime-Kanal auf eine Tabelle, jede Aenderung laedt neu (wie beobachten() in iOS). */
internal class TabellenBeobachter(private val name: String, private val tabellen: List<String>) {
    private var kanal: RealtimeChannel? = null
    private val auftraege = mutableListOf<Job>()

    fun starten(scope: CoroutineScope, neuLaden: suspend () -> Unit) {
        if (kanal != null) return
        val k = Backend.client.channel("$name-${System.currentTimeMillis()}")
        val stroeme = tabellen.map { t -> k.postgresChangeFlow<PostgresAction>(schema = "public") { table = t } }
        kanal = k
        stroeme.forEach { s -> auftraege += scope.launch { s.collect { neuLaden() } } }
        auftraege += scope.launch { runCatching { k.subscribe() } }
    }

    fun beenden() {
        auftraege.forEach { it.cancel() }
        auftraege.clear()
        val k = kanal ?: return
        kanal = null
        stammAufraeumen.launch { runCatching { Backend.client.realtime.removeChannel(k) } }
    }
}

// MARK: - Fahrzeuge

/** toVehicleCardRow aus FahrzeugeView.jsx. */
internal data class StammFahrzeug(
    val id: String,
    val brandModel: String,
    val trim: String,
    val vin: String,
    val licensePlate: String,
    val color: String,
    val seatCount: Int?,
    val fill: Double?,
    val range: Double?,
    val fuelType: String,
    val imageUrl: String,
) {
    constructor(z: JsonObject) : this(
        id = z.text("id"),
        brandModel = z.text("brand_model"),
        trim = z.text("trim"),
        vin = z.text("vin"),
        licensePlate = z.text("license_plate"),
        color = z.text("color"),
        seatCount = z.ganz("seat_count"),
        fill = z.zahl("battery_fuel_percent"),
        range = z.zahl("range_km"),
        fuelType = z.text("fuel_type"),
        imageUrl = z.text("image_url"),
    )

    val plate get() = licensePlate.ifEmpty { "-" }
    val vinLabel get() = vin.ifEmpty { "-" }

    /** resolveBodyType: Karosserie aus Modell/Variante (keine eigene Spalte). */
    val karosserie: String get() {
        val t = "$brandModel $trim".lowercase()
        if (Regex("\\b(ix|x1|x2|x3|x5|x6|x7|xm)\\b").containsMatchIn(t) || t.contains("ix3")) return "suv"
        if (t.contains("van") || t.contains("tourer") || t.contains("multivan")) return "van"
        if (t.contains("coup")) return "coupe"
        return "limosine"
    }

    /** vehicleHaystack: alle Felder in einem Suchtext. */
    val suchtext get() = listOf(plate, vin, brandModel, trim, color, fuelType, seatCount?.let { "$it sitze" } ?: "", karosserie)
        .joinToString(" ").lowercase()
}

/**
 * Filter-Zustand wie DEFAULT_FAHRZEUG_FILTERS. Lebt im Web in App.jsx (bleibt beim Seitenwechsel),
 * hier darum ausserhalb der Seite.
 */
internal object FahrzeugFilterAblage {
    var suche by mutableStateOf("")
    var limosine by mutableStateOf(false)
    var suv by mutableStateOf(false)
    var van by mutableStateOf(false)
    var coupe by mutableStateOf(false)
    var sortierung by mutableStateOf("plate")
    var absteigend by mutableStateOf(false)

    fun zuruecksetzen() {
        suche = ""; limosine = false; suv = false; van = false; coupe = false
        sortierung = "plate"; absteigend = false
    }

    /** Filter und Sortierung aus FahrzeugeView.jsx. */
    fun anwenden(alle: List<StammFahrzeug>): List<StammFahrzeug> {
        // ";" trennt mehrere Suchbegriffe (ODER).
        val begriffe = suche.lowercase().split(";").map { it.trim() }.filter { it.isNotEmpty() }
        val formen = listOfNotNull(if (limosine) "limosine" else null, if (suv) "suv" else null, if (van) "van" else null, if (coupe) "coupe" else null)
        val gefiltert = alle.filter { v ->
            if (begriffe.isNotEmpty() && begriffe.none { v.suchtext.contains(it) }) return@filter false
            formen.isEmpty() || v.karosserie in formen
        }
        val deutsch = Collator.getInstance(Locale.GERMAN)
        val vergleich: Comparator<StammFahrzeug> = when (sortierung) {
            "seats" -> compareBy { it.seatCount ?: 0 }
            // Ohne Wert im Betrieb als niedrigster Stand (kein erfundener Fuellstand).
            "fill" -> compareBy { it.fill ?: -1.0 }
            "model" -> Comparator { a, b -> deutsch.compare("${a.brandModel} ${a.trim}".trim().lowercase(), "${b.brandModel} ${b.trim}".trim().lowercase()) }
            else -> Comparator { a, b -> deutsch.compare(a.plate.lowercase(), b.plate.lowercase()) }
        }
        return gefiltert.sortedWith(if (absteigend) vergleich.reversed() else vergleich)
    }
}

/** Fahrzeugliste laden und live halten (vehicles, Realtime auf alle Aenderungen). */
@Serializable
internal data class TrackerWahl(val imei: String, val nummer: Int, val vehicle_id: String? = null, val nfc_code: String? = null) {
    /** Link, der auf den NFC-Tag geschrieben wird. */
    val nfcLink: String? get() = nfc_code?.let { "https://fahrer.trisar.de/nfc/$it" }
}

@Serializable private data class NfcTracker(val imei: String, val nummer: Int, val vehicle_id: String? = null)
@Serializable private data class NfcAuto(val brand_model: String? = null, val license_plate: String? = null)
@Serializable private data class NfcZuordnung(val driver_id: String)
@Serializable private data class NfcFahrer(val first_name: String? = null, val last_name: String? = null)

internal class FahrzeugeDienst {
    var fahrzeuge by mutableStateOf<List<StammFahrzeug>>(emptyList())
        private set
    var laedt by mutableStateOf(true)
        private set
    var fehler by mutableStateOf("")
        private set
    private val beobachter = TabellenBeobachter("admin-vehicles-live", listOf("vehicles"))

    suspend fun laden() {
        laedt = true
        fehler = ""
        try {
            fahrzeuge = Backend.client.from("vehicles").select { order("brand_model", Order.ASCENDING) }
                .decodeList<JsonObject>().map { StammFahrzeug(it) }
        } catch (e: kotlinx.coroutines.CancellationException) {
            throw e
        } catch (e: Exception) {
            fahrzeuge = emptyList()
            fehler = dbMeldung(e)
        }
        laedt = false
    }

    fun beobachten(scope: CoroutineScope) = beobachter.starten(scope) { laden() }
    fun beenden() = beobachter.beenden()

    companion object {
        /**
         * saveVehicle aus FahrzeugErstellenView.jsx: Update mit Rueckgabe der Zeile, sonst Insert.
         * Den Admin-Schluessel-Rueckfall des Webs gibt es in der App nicht.
         */
        suspend fun speichern(inhalt: JsonObject, id: String?): JsonObject? {
            if (id != null) {
                val zeilen = Backend.client.from("vehicles").update(inhalt) {
                    select()
                    filter { eq("id", id) }
                }.decodeList<JsonObject>()
                return zeilen.firstOrNull() ?: throw StammFehler("Kein Fahrzeug aktualisiert (ID nicht gefunden oder keine Schreibrechte).")
            }
            return Backend.client.from("vehicles").insert(inhalt) { select() }.decodeList<JsonObject>().firstOrNull()
        }

        /** OBD-Tracker fuer die Auswahl am Fahrzeug (obd_tracker.vehicle_id). */
        suspend fun trackerLaden(): List<TrackerWahl> = runCatching {
            Backend.client.from("obd_tracker").select(Columns.raw("imei, nummer, vehicle_id, nfc_code")) {
                order("nummer", Order.ASCENDING)
            }.decodeList<TrackerWahl>()
        }.getOrDefault(emptyList())

        /** Was auf einem gelesenen Tag steht, in Worten: Tracker, Auto und aktueller Fahrer. */
        suspend fun tagBeschreibung(link: String): String {
            if (!Regex("""^https://fahrer\.trisar\.de/nfc/[a-f0-9]{18}/?$""").matches(link)) {
                return if (link.isEmpty()) "Auf diesem Tag steht nichts." else "Das ist kein TRISAR-Tag."
            }
            val code = link.trimEnd('/').substringAfterLast('/')
            val t = runCatching {
                Backend.client.from("obd_tracker").select(Columns.raw("imei, nummer, vehicle_id")) {
                    filter { eq("nfc_code", code) }
                }.decodeList<NfcTracker>().firstOrNull()
            }.getOrNull() ?: return "Diesen Tag kenne ich nicht."
            val auto = t.vehicle_id?.let { vid ->
                runCatching {
                    Backend.client.from("vehicles").select(Columns.raw("brand_model, license_plate")) {
                        filter { eq("id", vid) }
                    }.decodeList<NfcAuto>().firstOrNull()
                }.getOrNull()?.let { listOfNotNull(it.brand_model, it.license_plate).joinToString(" ") }
            } ?: "keinem Auto zugeordnet"
            val zuordnung = runCatching {
                Backend.client.from("imei_driver_map").select(Columns.raw("driver_id")) {
                    filter { eq("imei", t.imei); eq("is_active", true) }
                }.decodeList<NfcZuordnung>().firstOrNull()
            }.getOrNull()
            val fahrer = zuordnung?.let { z ->
                runCatching {
                    Backend.client.from("profiles").select(Columns.raw("first_name, last_name")) {
                        filter { eq("id", z.driver_id) }
                    }.decodeList<NfcFahrer>().firstOrNull()
                }.getOrNull()?.let { "Fahrer: " + listOfNotNull(it.first_name, it.last_name).joinToString(" ") }
            } ?: "kein Fahrer verbunden"
            return "Tracker ${t.nummer}, $auto, $fahrer."
        }

        /** Ein Auto hat einen Tracker: bisherige Zuordnung loesen, dann den gewaehlten setzen. */
        suspend fun trackerZuordnen(fahrzeug: String, imei: String) {
            Backend.client.from("obd_tracker").update(buildJsonObject { put("vehicle_id", JsonNull) }) {
                filter { eq("vehicle_id", fahrzeug) }
            }
            if (imei.isNotEmpty()) {
                Backend.client.from("obd_tracker").update(buildJsonObject { put("vehicle_id", JsonPrimitive(fahrzeug)) }) {
                    filter { eq("imei", imei) }
                }
            }
        }

        /** Fahrzeug endgueltig loeschen. Schaeden fallen per CASCADE mit, Fahrer/Fahrten verlieren die Zuordnung. */
        suspend fun loeschen(id: String) {
            val weg = Backend.client.from("vehicles").delete {
                select()
                filter { eq("id", id) }
            }.decodeList<JsonObject>()
            if (weg.isEmpty()) throw StammFehler("Fahrzeug nicht gelöscht (nicht gefunden oder keine Rechte).")
        }
    }
}

// MARK: - Fahrgaeste

/** Zeile aus AlleKunden.jsx (guests). */
internal data class StammFahrgast(
    val id: String,
    val firstName: String,
    val lastName: String,
    val name: String,
    val email: String,
    val phone: String,
    val language: String,
    val street: String,
    val streetNumber: String,
    val city: String,
    val zip: String,
    val notes: String,
) {
    companion object {
        fun aus(z: JsonObject): StammFahrgast {
            val vor = z.text("first_name")
            val nach = z.text("last_name")
            val n = listOf(vor, nach).filter { it.isNotEmpty() }.joinToString(" ")
            return StammFahrgast(
                id = z.text("id"), firstName = vor, lastName = nach, name = n.ifEmpty { "Ohne Name" },
                email = z.text("email"), phone = z.text("phone"), language = z.text("language"),
                street = z.text("street"), streetNumber = z.text("street_number"), city = z.text("city"), zip = z.text("zip"),
                notes = z.text("notes").ifEmpty { z.text("note_text") },
            )
        }
    }
}

internal class FahrgaesteDienst {
    var gaeste by mutableStateOf<List<StammFahrgast>>(emptyList())
        private set
    var laedt by mutableStateOf(true)
        private set
    var fehler by mutableStateOf("")
        private set
    private val beobachter = TabellenBeobachter("admin-guests-live", listOf("guests"))

    suspend fun laden() {
        laedt = true
        fehler = ""
        try {
            gaeste = Backend.client.from("guests").select { order("last_name", Order.ASCENDING) }
                .decodeList<JsonObject>().map { StammFahrgast.aus(it) }
        } catch (e: kotlinx.coroutines.CancellationException) {
            throw e
        } catch (e: Exception) {
            gaeste = emptyList()
            fehler = "Fahrgäste konnten nicht geladen werden: ${dbMeldung(e)}"
        }
        laedt = false
    }

    fun beobachten(scope: CoroutineScope) = beobachter.starten(scope) { laden() }
    fun beenden() = beobachter.beenden()

    companion object {
        /** Volle Zeile fuer das Bearbeiten (select * eq id maybeSingle). */
        suspend fun einzeln(id: String): JsonObject? = runCatching {
            Backend.client.from("guests").select { filter { eq("id", id) }; limit(1) }.decodeList<JsonObject>().firstOrNull()
        }.getOrNull()

        /**
         * saveWithColumnFallback: fehlt eine Spalte in der Datenbank, wird sie weggelassen und neu versucht.
         * Rueckgabe: Fehlermeldung oder null.
         */
        suspend fun speichern(inhalt: Map<String, JsonElement>, id: String?): String? {
            val rest = inhalt.toMutableMap()
            repeat(20) {
                try {
                    if (id != null) {
                        Backend.client.from("guests").update(JsonObject(rest)) { filter { eq("id", id) } }
                    } else {
                        Backend.client.from("guests").insert(JsonObject(rest))
                    }
                    return null
                } catch (e: kotlinx.coroutines.CancellationException) {
                    throw e
                } catch (e: Exception) {
                    val meldung = dbMeldung(e)
                    val spalte = fehlendeSpalte(meldung)
                    if (spalte != null && rest.containsKey(spalte)) {
                        rest.remove(spalte)
                    } else {
                        return meldung
                    }
                }
            }
            return "Fahrgast konnte nicht gespeichert werden."
        }

        private fun fehlendeSpalte(meldung: String): String? {
            for (muster in listOf("Could not find the ['\"]?([a-zA-Z0-9_]+)['\"]? column", "column [\"']?([a-zA-Z0-9_]+)[\"']?")) {
                Regex(muster, RegexOption.IGNORE_CASE).find(meldung)?.let { return it.groupValues[1] }
            }
            return null
        }
    }
}

// MARK: - Eigenes Profil der Disposition

/** profileData aus App.jsx (Live-Zweig): Grundwerte, lokal gemerkt, dann aus profiles ergaenzt. */
@Serializable
internal data class KoordinatorProfilDaten(
    val firstName: String = "",
    val lastName: String = "",
    val email: String = "",
    val phone: String = "+49",
    val street: String = "",
    val streetNumber: String = "",
    val city: String = "",
    val zip: String = "",
    val language: String = "Deutsch",
    val avatarUrl: String = "",
) {
    val name get() = listOf(firstName, lastName).filter { it.isNotEmpty() }.joinToString(" ").trim()
}

/** Feld im Profil -> Spalte in profiles (PROFIL_SPALTEN). */
internal enum class ProfilFeld(val spalte: String) {
    FIRST_NAME("first_name"), LAST_NAME("last_name"), EMAIL("email"), PHONE("phone"), STREET("street"),
    STREET_NUMBER("street_number"), CITY("city"), ZIP("zip"), LANGUAGE("language"), AVATAR_URL("avatar_url"),
}

internal class KoordinatorProfilDienst(ctx: Context) {
    /** Gleicher Schluessel wie das Web (dispo_profil_live_v1). */
    private val ablage = ctx.applicationContext.getSharedPreferences("trisar-dispo-profil", Context.MODE_PRIVATE)
    var profil by mutableStateOf(
        runCatching { Backend.json.decodeFromString<KoordinatorProfilDaten>(ablage.getString(SCHLUESSEL, null)!!) }
            .getOrDefault(KoordinatorProfilDaten()),
    )
        private set

    companion object { private const val SCHLUESSEL = "dispo_profil_live_v1" }

    /** Live: Name und Kontaktdaten der angemeldeten Disposition aus profiles. */
    suspend fun laden() {
        val nutzer = Backend.client.auth.currentUserOrNull() ?: return
        val d = runCatching {
            Backend.client.from("profiles")
                .select(Columns.raw("first_name, last_name, email, phone, street, street_number, city, zip, language, avatar_url")) {
                    filter { eq("id", nutzer.id) }; limit(1)
                }.decodeList<JsonObject>().firstOrNull()
        }.getOrNull() ?: return
        val p = profil
        fun nimm(k: String, alt: String) = d.text(k).ifEmpty { alt }
        setzen(
            p.copy(
                firstName = nimm("first_name", p.firstName),
                lastName = nimm("last_name", p.lastName),
                email = nimm("email", nutzer.email?.takeIf { it.isNotEmpty() } ?: p.email),
                phone = nimm("phone", p.phone),
                street = nimm("street", p.street),
                streetNumber = nimm("street_number", p.streetNumber),
                city = nimm("city", p.city),
                zip = nimm("zip", p.zip),
                language = nimm("language", p.language),
                avatarUrl = nimm("avatar_url", p.avatarUrl),
            ),
        )
    }

    /** onSaveProfile + profilInDbSpeichern: lokal uebernehmen, dann die Spalten in profiles schreiben. */
    suspend fun speichern(aenderung: Map<ProfilFeld, String>) {
        var p = profil
        for ((feld, wert) in aenderung) {
            p = when (feld) {
                ProfilFeld.FIRST_NAME -> p.copy(firstName = wert)
                ProfilFeld.LAST_NAME -> p.copy(lastName = wert)
                ProfilFeld.EMAIL -> p.copy(email = wert)
                ProfilFeld.PHONE -> p.copy(phone = wert)
                ProfilFeld.STREET -> p.copy(street = wert)
                ProfilFeld.STREET_NUMBER -> p.copy(streetNumber = wert)
                ProfilFeld.CITY -> p.copy(city = wert)
                ProfilFeld.ZIP -> p.copy(zip = wert)
                ProfilFeld.LANGUAGE -> p.copy(language = wert)
                ProfilFeld.AVATAR_URL -> p.copy(avatarUrl = wert)
            }
        }
        setzen(p)
        val id = Backend.client.auth.currentUserOrNull()?.id
        if (aenderung.isEmpty() || id == null) return
        val zeile = buildJsonObject { aenderung.forEach { (f, w) -> put(f.spalte, JsonPrimitive(w)) } }
        try {
            Backend.client.from("profiles").update(zeile) { filter { eq("id", id) } }
        } catch (e: kotlinx.coroutines.CancellationException) {
            throw e
        } catch (e: Exception) {
            android.util.Log.w("TRISAR", "Profil konnte nicht gespeichert werden: ${dbMeldung(e)}")
        }
    }

    /** Beim Abmelden die gemerkten Daten verwerfen (Web: STARTPROFIL). */
    fun vergessen() {
        ablage.edit().remove(SCHLUESSEL).apply()
        profil = KoordinatorProfilDaten()
    }

    private fun setzen(p: KoordinatorProfilDaten) {
        profil = p
        ablage.edit().putString(SCHLUESSEL, Backend.json.encodeToString(KoordinatorProfilDaten.serializer(), p)).apply()
    }
}
