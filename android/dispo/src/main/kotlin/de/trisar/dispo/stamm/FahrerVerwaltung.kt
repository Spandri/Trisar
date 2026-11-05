package de.trisar.dispo.stamm

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import de.trisar.kern.Backend
import io.github.jan.supabase.exceptions.RestException
import io.github.jan.supabase.functions.functions
import io.github.jan.supabase.postgrest.from
import io.github.jan.supabase.postgrest.query.Columns
import io.github.jan.supabase.postgrest.query.Order
import io.ktor.client.statement.bodyAsText
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.put
import java.time.LocalDate
import java.time.LocalTime
import java.time.temporal.ChronoUnit

// Daten und Logik des Fahrer-Bereichs, 1:1 aus admin/src/components/views/AlleFahrer.jsx
// und FahrerErstellenView.jsx (FahrerVerwaltung.swift). Gleiche Tabellen, Spalten, Filter und Fehlertexte.

/** Ein Fahrer wie `mapRowsToDrivers` in AlleFahrer.jsx. */
internal data class DispoFahrer(
    val id: String,
    val name: String,
    val firstName: String,
    val lastName: String,
    val email: String,
    val vehicle: String,
    val role: String?,
    val driverNumber: Int?,
    val driverActivityState: String?,
    val serviceStartTime: String,
    val serviceEndTime: String,
    val serviceStartDate: String,
    val planRequestStatus: String,
) {
    /** isDriverIncomplete: ohne Fahrzeug, Nummer oder vollstaendige Dienstzeit. */
    val unfertig get() = vehicle.isBlank() || driverNumber == null ||
        Dienstzeit.normal(serviceStartTime).isEmpty() || Dienstzeit.normal(serviceEndTime).isEmpty()

    /** isDriverInServiceNow: jetzt innerhalb der Dienstzeit (auch ueber Mitternacht). */
    fun imDienst(jetzt: LocalTime = LocalTime.now()): Boolean {
        val s = Dienstzeit.minuten(serviceStartTime) ?: return false
        val e = Dienstzeit.minuten(serviceEndTime) ?: return false
        val n = jetzt.hour * 60 + jetzt.minute
        return Dienstzeit.segmente(s, e).any { n >= it.first && n <= it.second }
    }
}

/** Fahrt im Planungshorizont (nur die Spalten, die die Uebersicht braucht). */
internal data class PlanFahrt(val rideDate: String, val etd: String, val status: String)

/** Uhrzeit- und Datumshilfen aus AlleFahrer.jsx (normalizeClockValue, buildDailySegments ...). */
internal object Dienstzeit {
    fun normal(wert: String?): String {
        val m = Regex("^(\\d{1,2}):(\\d{2})").find((wert ?: "").trim()) ?: return ""
        val h = m.groupValues[1].toInt(); val mi = m.groupValues[2].toInt()
        if (h !in 0..23 || mi !in 0..59) return ""
        return "%02d:%02d".format(h, mi)
    }

    fun minuten(wert: String?): Int? {
        val n = normal(wert)
        if (n.isEmpty()) return null
        val t = n.split(":")
        return t[0].toInt() * 60 + t[1].toInt()
    }

    fun segmente(s: Int, e: Int): List<Pair<Int, Int>> = if (e >= s) listOf(s to e) else listOf(s to 1439, 0 to e)

    fun heute(): String = LocalDate.now().toString()

    fun plusTage(iso: String, tage: Int): String {
        if (!Regex("\\d{4}-\\d{2}-\\d{2}").matches(iso)) return iso
        return runCatching { LocalDate.parse(iso).plusDays(tage.toLong()).toString() }.getOrDefault(iso)
    }

    /** Tagesabstand zu heute (0 = heute, 1 = morgen ...). */
    fun tagAbstand(iso: String?): Int? {
        val t = iso?.trim() ?: return null
        if (!Regex("\\d{4}-\\d{2}-\\d{2}").matches(t)) return null
        return runCatching { ChronoUnit.DAYS.between(LocalDate.now(), LocalDate.parse(t)).toInt() }.getOrNull()
    }

    /** formatDayMonthDisplay: "dd.MM." */
    fun tagMonat(iso: String): String {
        val m = Regex("(\\d{4})-(\\d{2})-(\\d{2})").matchEntire(iso.trim()) ?: return ""
        return "${m.groupValues[3]}.${m.groupValues[2]}."
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

    /** getPlanRequestStatusColor */
    fun anfrageFarbe(wert: String): Long = when (anfrageStatus(wert)) {
        "refused" -> 0xF55757
        "pending" -> 0xFF8A00
        else -> 0x1D1C1D
    }
}

/** Planungshorizont der wischbaren Zeitachse: heute + 2 Folgetage. */
internal object Planung {
    const val TAGE = 3
    const val STUNDEN = TAGE * 24
    const val CHART_START = 6
    const val CHART_ENDE = 23
    const val FENSTER = CHART_ENDE - CHART_START + 1
    private val ausgeschlossen = setOf("done", "completed", "arrived", "archived", "cancelled", "canceled", "refused", "rejected")

    /** Fahrer je Stunde (72 h). Schicht mit Datum zaehlt nur an ihrem Tag. */
    fun angebot(fahrer: List<DispoFahrer>): List<Int> {
        val z = IntArray(STUNDEN)
        val heute = Dienstzeit.heute()
        for (f in fahrer) {
            val s = Dienstzeit.minuten(f.serviceStartTime) ?: continue
            val e = Dienstzeit.minuten(f.serviceEndTime) ?: continue
            val seg = Dienstzeit.segmente(s, e)
            val datum = f.serviceStartDate.trim()
            for (tag in 0 until TAGE) {
                if (datum.isNotEmpty() && datum != Dienstzeit.plusTage(heute, tag)) continue
                for (h in 0 until 24) {
                    val a = h * 60; val b = minOf(1439, a + 59)
                    if (seg.any { maxOf(it.first, a) <= minOf(it.second, b) }) z[tag * 24 + h]++
                }
            }
        }
        return z.toList()
    }

    /** Geplante Fahrten je Stunde (72 h). */
    fun fahrten(liste: List<PlanFahrt>): List<Int> {
        val z = IntArray(STUNDEN)
        for (f in liste) {
            if (f.status.trim().lowercase() in ausgeschlossen) continue
            val tag = Dienstzeit.tagAbstand(f.rideDate) ?: continue
            if (tag < 0 || tag >= TAGE) continue
            val m = Regex("^(\\d{1,2}):(\\d{2})").find(f.etd.trim()) ?: continue
            val h = m.groupValues[1].toInt()
            if (h !in 0..23) continue
            z[tag * 24 + h]++
        }
        return z.toList()
    }

    /** computeDemandCurve (demo/planungsKurven.js): geglaettete gebuchte Fahrten, leere Stunden 0. */
    fun bedarf(gebucht: List<Int>): List<Int> {
        val n = maxOf(gebucht.size, FENSTER)
        val b = (0 until n).map { if (it < gebucht.size) maxOf(0, gebucht[it]) else 0 }
        return (0 until n).map { i ->
            val vor = if (i > 0) b[i - 1] else 0
            val nach = if (i + 1 < n) b[i + 1] else 0
            if (b[i] == 0) 0 else maxOf(b[i], Math.round((vor + 2 * b[i] + nach) / 4.0).toInt())
        }
    }
}

private val fehlendesSchemaSQL = """
-- Falls noch nicht vorhanden:
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'fahrer';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS vehicle_id UUID REFERENCES public.vehicles(id) ON DELETE SET NULL;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS driver_number BIGINT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS driver_activity_state TEXT DEFAULT 'frei';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS service_start_time TIME;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS service_end_time TIME;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS service_start_date DATE;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS service_end_date DATE;
ALTER TABLE public.vehicles ADD COLUMN IF NOT EXISTS license_plate TEXT;
CREATE TABLE IF NOT EXISTS public.driver_service_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  service_date DATE NOT NULL,
  service_start_time TIME,
  service_end_time TIME,
  status TEXT NOT NULL DEFAULT 'pending',
  requested_by TEXT,
  refusal_reason TEXT,
  responded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
""".trimStart()

// MARK: - Fahrerliste (AlleFahrer.jsx: loadDrivers + Realtime)

internal class FahrerListeDienst {
    var fahrer by mutableStateOf<List<DispoFahrer>>(emptyList())
        private set
    var fahrten by mutableStateOf<List<PlanFahrt>>(emptyList())
        private set
    var laedt by mutableStateOf(true)
        private set
    var fehler by mutableStateOf("")
        private set

    private var geladen = false
    private var bevorzugteAuswahl = ""
    private val beobachter = TabellenBeobachter("admin-drivers-live", listOf("profiles", "vehicles", "jobs", "driver_service_requests"))
    private var abfrage: Job? = null

    companion object {
        // Gleiche Rueckfall-Reihe wie im Web, falls Spalten fehlen.
        private val auswahlListe = listOf(
            "id, first_name, last_name, email, created_at, vehicle_id, role, is_dispo, driver_number, driver_activity_state, service_start_time, service_end_time, vehicles:vehicle_id(license_plate)",
            "id, first_name, last_name, created_at, vehicle_id, role, is_dispo, driver_number, driver_activity_state, service_start_time, service_end_time, vehicles:vehicle_id(license_plate)",
            "id, first_name, last_name, email, created_at, vehicle_id, role, is_dispo, driver_number, vehicles:vehicle_id(license_plate)",
            "id, first_name, last_name, created_at, vehicle_id, role, is_dispo, driver_number, vehicles:vehicle_id(license_plate)",
        )
    }

    suspend fun laden() {
        if (!geladen) laedt = true
        fehler = ""
        val reihe = if (bevorzugteAuswahl.isEmpty()) auswahlListe else listOf(bevorzugteAuswahl) + auswahlListe.filter { it != bevorzugteAuswahl }
        var zeilen: List<JsonObject>? = null
        var letzterFehler: Exception? = null
        for (auswahl in reihe) {
            try {
                zeilen = Backend.client.from("profiles").select(Columns.raw(auswahl)) {
                    order("last_name", Order.ASCENDING, nullsFirst = false)
                    order("first_name", Order.ASCENDING, nullsFirst = false)
                }.decodeList<JsonObject>()
                bevorzugteAuswahl = auswahl
                break
            } catch (e: kotlinx.coroutines.CancellationException) {
                throw e
            } catch (e: Exception) {
                letzterFehler = e
            }
        }

        if (zeilen == null) {
            val meldung = letzterFehler?.let { dbMeldung(it) } ?: ""
            if (!geladen) fahrer = emptyList()
            fehler = when {
                Regex("no suitable key|wrong key type|jwt|invalid api key|unauthorized", RegexOption.IGNORE_CASE).containsMatchIn(meldung) ->
                    "Supabase-Key ist ungültig oder falscher Typ. Nutze den anon public key (nicht service_role) in admin-app-lokal/.env.local als VITE_SUPABASE_ANON_KEY."
                Regex("vehicle_id|license_plate|driver_number|driver_activity_state|service_start_time|service_end_time|relation .*vehicles|column .*is_dispo|column .*role", RegexOption.IGNORE_CASE).containsMatchIn(meldung) ->
                    "DB-Schema unvollständig. Bitte ausführen:\n$fehlendesSchemaSQL"
                else -> meldung.ifEmpty { "Fahrer konnten nicht geladen werden." }
            }
            laedt = false
            return
        }

        var liste = zeilen.map { z ->
            val vor = z.text("first_name")
            val nach = z.text("last_name")
            val name = listOf(vor, nach).filter { it.isNotEmpty() }.joinToString(" ").trim()
            val id = z.text("id")
            DispoFahrer(
                id = id.ifEmpty { "-" },
                name = name.ifEmpty { "Ohne Name" },
                firstName = vor, lastName = nach,
                email = z.text("email"),
                vehicle = (z["vehicles"] as? JsonObject)?.text("license_plate") ?: "",
                role = z.text("role").ifEmpty { null },
                driverNumber = z.ganz("driver_number"),
                driverActivityState = z.text("driver_activity_state").ifEmpty { null },
                serviceStartTime = Dienstzeit.normal(z.text("service_start_time")),
                serviceEndTime = Dienstzeit.normal(z.text("service_end_time")),
                serviceStartDate = z.text("service_start_date"),
                planRequestStatus = "",
            )
        }

        // Neueste Dienstanfrage je Fahrer liefert nur die Farbe der Zeiten.
        val ids = liste.map { it.id }.filter { it != "-" }
        if (ids.isNotEmpty()) {
            try {
                val anfragen = Backend.client.from("driver_service_requests")
                    .select(Columns.raw("driver_id,status,service_start_time,service_end_time,created_at")) {
                        filter { isIn("driver_id", ids) }
                        order("created_at", Order.DESCENDING)
                    }.decodeList<JsonObject>()
                val neueste = HashMap<String, String>()
                for (a in anfragen) {
                    val d = a.text("driver_id")
                    if (d.isEmpty() || neueste.containsKey(d)) continue
                    neueste[d] = Dienstzeit.anfrageStatus(a.text("status"))
                }
                liste = liste.map { it.copy(planRequestStatus = neueste[it.id] ?: "") }
            } catch (e: kotlinx.coroutines.CancellationException) {
                throw e
            } catch (e: Exception) {
                android.util.Log.w("TRISAR", "driver_service_requests konnte nicht gelesen werden (AlleFahrer/Admin): $e")
            }
        }
        fahrer = liste

        // Planungshorizont: heute bis uebermorgen. Im Betrieb gilt der echte Zeitraum, auch leer.
        val heute = Dienstzeit.heute()
        val ende = Dienstzeit.plusTage(heute, Planung.TAGE - 1)
        fahrten = runCatching {
            Backend.client.from("jobs")
                .select(Columns.raw("id, ride_date, etd, status, pickup_name, pickup_address, dropoff_name, dropoff_address, ext_route_duration_mins, ext_route_duration_in_traffic_mins")) {
                    filter { gte("ride_date", heute); lte("ride_date", ende) }
                }.decodeList<JsonObject>().map { PlanFahrt(it.text("ride_date"), it.text("etd"), it.text("status")) }
        }.getOrDefault(emptyList())

        geladen = true
        laedt = false
    }

    /** Realtime auf profiles, vehicles, jobs, driver_service_requests plus Abfrage jede Minute. */
    fun starten(scope: CoroutineScope) {
        if (abfrage != null) return
        abfrage = scope.launch {
            laden()
            beobachter.starten(scope) { laden() }
            while (isActive) {
                delay(60_000)
                laden()
            }
        }
    }

    fun stoppen() {
        abfrage?.cancel()
        abfrage = null
        beobachter.beenden()
    }
}

// MARK: - Fahrer anlegen / bearbeiten (FahrerErstellenView.jsx)

internal data class DispoFahrzeugWahl(val id: String, val brandModel: String, val licensePlate: String) {
    /** "Marke Modell (Kennzeichen)" wie im Web. */
    val etikett: String get() {
        val m = brandModel.trim(); val p = licensePlate.trim()
        if (m.isNotEmpty() && p.isNotEmpty()) return "$m ($p)"
        return m.ifEmpty { p }
    }
}

internal data class TrackerEintrag(val imei: String, val driverID: String?, val isActive: Boolean?, val besitzerName: String)

internal class FahrerEditorModell(val ursprung: DispoFahrer?) {
    companion object {
        val sprachen = listOf("Deutsch", "English", "Français", "Italiano", "Español", "Türkçe")
        /** resolveDriverPasswordSetupRedirect: von admin.trisar.de aus immer die Fahrer-App. */
        const val PASSWORT_ZIEL = "https://fahrer.trisar.de"

        /** normalizePhone: "+49 1234" -> ("+49", "1234"). */
        fun telefonTeilen(wert: String): Pair<String, String> {
            val v = wert.trim()
            if (v.isEmpty()) return "+49" to ""
            val m = Regex("(\\+\\d{1,4})\\s*(.*)").matchEntire(v) ?: return "+49" to v
            return m.groupValues[1] to m.groupValues[2]
        }

        private fun fehltEmailSpalte(meldung: String) =
            Regex("column .*email|could not find the ['\"]?email['\"]? column", RegexOption.IGNORE_CASE).containsMatchIn(meldung)
    }

    val bearbeiten get() = ursprung != null

    var vorname by mutableStateOf("")
    var nachname by mutableStateOf("")
    var email by mutableStateOf("")
    var landesvorwahl by mutableStateOf("+49")
    var telefon by mutableStateOf("")
    var strasse by mutableStateOf("")
    var hausnummer by mutableStateOf("")
    var ort by mutableStateOf("")
    var plz by mutableStateOf("")
    var sprache by mutableStateOf("Deutsch")
    var fahrzeugID by mutableStateOf("")
    var nummer by mutableStateOf("")
    var nummerWarnung by mutableStateOf("")
    /** 'app' = Handy-Standort aus der Fahrer-App, 'obd' = Tracker (IMEI) im Auto. */
    var ortung by mutableStateOf("app")
    var imei by mutableStateOf("")
    var fahrzeuge by mutableStateOf<List<DispoFahrzeugWahl>>(emptyList())
        private set
    var fahrzeugeLaden by mutableStateOf(false)
        private set
    var tracker by mutableStateOf<List<TrackerEintrag>>(emptyList())
        private set
    var speichert by mutableStateOf(false)
        private set
    var rueckmeldung by mutableStateOf("")

    private var urspruenglicheEmail = ""
    private var nummerPruefung: Job? = null

    val fahrzeugEtikett: String get() {
        val f = fahrzeuge.firstOrNull { it.id == fahrzeugID } ?: return "Fahrzeug koppeln"
        return f.etikett.ifEmpty { "Fahrzeug" }
    }

    /** Tracker, der gerade bei jemand anderem aktiv ist (Hinweis unter dem IMEI-Feld). */
    val trackerBeiAnderem: TrackerEintrag? get() {
        if (ortung != "obd") return null
        return tracker.firstOrNull { it.imei == imei && it.isActive == true && it.driverID != ursprung?.id }
    }

    fun start(scope: CoroutineScope) {
        scope.launch { fahrzeugeHolen() }
        scope.launch { trackerHolen() }
        scope.launch { fahrerHolen() }
    }

    private suspend fun fahrzeugeHolen() {
        fahrzeugeLaden = true
        try {
            val liste = try {
                Backend.client.from("vehicles").select { order("brand_model", Order.ASCENDING) }.decodeList<JsonObject>()
            } catch (e: Exception) {
                if (!dbMeldung(e).contains("brand_model", ignoreCase = true)) throw e
                Backend.client.from("vehicles").select { order("created_at", Order.DESCENDING) }.decodeList<JsonObject>()
            }
            fahrzeuge = liste.map { DispoFahrzeugWahl(it.text("id"), it.text("brand_model"), it.text("license_plate")) }
        } catch (e: kotlinx.coroutines.CancellationException) {
            throw e
        } catch (e: Exception) {
            fahrzeuge = emptyList()
            rueckmeldung = "Fahrzeuge konnten nicht geladen werden: ${dbMeldung(e)}"
        }
        fahrzeugeLaden = false
    }

    /** Bekannte Tracker (alle IMEIs, die schon einmal einem Fahrer zugeordnet waren). */
    private suspend fun trackerHolen() {
        // Tabelle fehlt: Liste bleibt leer, IMEI kann von Hand eingetragen werden.
        tracker = runCatching {
            Backend.client.from("imei_driver_map")
                .select(Columns.raw("imei, driver_id, is_active, driver:driver_id(first_name, last_name)")) { order("imei", Order.ASCENDING) }
                .decodeList<JsonObject>().map { z ->
                    val d = z["driver"] as? JsonObject
                    val besitzer = listOf(d?.text("first_name") ?: "", d?.text("last_name") ?: "").filter { it.isNotEmpty() }.joinToString(" ").trim()
                    val aktiv = (z["is_active"] as? JsonPrimitive)?.let { if (it is JsonNull) null else it.content == "true" }
                    TrackerEintrag(z.text("imei"), z.text("driver_id").ifEmpty { null }, aktiv, besitzer)
                }
        }.getOrDefault(emptyList())
    }

    private suspend fun fahrerHolen() {
        val f = ursprung ?: return
        rueckmeldung = ""
        vorname = f.firstName
        nachname = f.lastName
        nummer = f.driverNumber?.toString() ?: ""
        email = f.email
        urspruenglicheEmail = f.email.lowercase()
        try {
            val d = try {
                Backend.client.from("profiles").select(Columns.raw("*, auth_user:auth.users!profiles_id_fkey(email)")) {
                    filter { eq("id", f.id) }; limit(1)
                }.decodeList<JsonObject>().firstOrNull()
            } catch (e: kotlinx.coroutines.CancellationException) {
                throw e
            } catch (e: Exception) {
                Backend.client.from("profiles").select { filter { eq("id", f.id) }; limit(1) }.decodeList<JsonObject>().firstOrNull()
            } ?: return
            val tel = telefonTeilen(d.text("phone"))
            vorname = d.text("first_name").ifEmpty { f.firstName }
            nachname = d.text("last_name").ifEmpty { f.lastName }
            val mail = d.text("email").ifEmpty { f.email }
            if (mail.isNotEmpty()) {
                email = mail
                urspruenglicheEmail = mail.lowercase()
            }
            landesvorwahl = tel.first
            telefon = tel.second
            strasse = d.text("street")
            hausnummer = d.text("street_number")
            ort = d.text("city")
            plz = d.text("zip")
            sprache = d.text("language").ifEmpty { "Deutsch" }
            fahrzeugID = d.text("vehicle_id")
            nummer = d.ganz("driver_number")?.toString() ?: (f.driverNumber?.toString() ?: "")
            ortung = if (d.text("tracking_mode") == "obd") "obd" else "app"

            val aktiv = Backend.client.from("imei_driver_map").select(Columns.raw("imei")) {
                filter { eq("driver_id", f.id); eq("is_active", true) }
                limit(1)
            }.decodeList<JsonObject>().firstOrNull()
            imei = aktiv?.text("imei") ?: ""
        } catch (e: kotlinx.coroutines.CancellationException) {
            throw e
        } catch (e: Exception) {
            rueckmeldung = "Fahrerdaten konnten nicht geladen werden: ${dbMeldung(e)}"
        }
    }

    /** Fahrernummer nur aus Ziffern, Doppel-Pruefung nach 500 ms (nur beim Anlegen). */
    fun nummerGeaendert(wert: String, scope: CoroutineScope) {
        val ziffern = wert.filter { it.isDigit() }
        if (ziffern != nummer) nummer = ziffern
        nummerPruefung?.cancel()
        nummerPruefung = scope.launch {
            delay(500)
            nummerPruefen(ziffern)
        }
    }

    private suspend fun nummerPruefen(wert: String) {
        val n = wert.toIntOrNull()
        if (wert.isEmpty() || bearbeiten || n == null || n <= 0) { nummerWarnung = ""; return }
        nummerWarnung = try {
            val t = Backend.client.from("profiles").select(Columns.raw("id, first_name, last_name, driver_number")) {
                filter { eq("driver_number", n) }; limit(1)
            }.decodeList<JsonObject>().firstOrNull()
            if (t != null) {
                val name = listOf(t.text("first_name"), t.text("last_name")).filter { it.isNotEmpty() }.joinToString(" ")
                "⚠️ Nummer $n bereits vergeben an: $name"
            } else ""
        } catch (e: kotlinx.coroutines.CancellationException) {
            throw e
        } catch (e: Exception) {
            ""
        }
    }

    private fun formularLeeren() {
        vorname = ""; nachname = ""; email = ""
        landesvorwahl = "+49"; telefon = ""
        strasse = ""; hausnummer = ""; ort = ""; plz = ""
        sprache = "Deutsch"; fahrzeugID = ""; nummer = ""
        urspruenglicheEmail = ""
        ortung = "app"; imei = ""
    }

    /** createDriver aus FahrerErstellenView.jsx. Wird nur durch den Knopf ausgeloest. */
    suspend fun speichern() {
        if (vorname.isBlank() || nachname.isBlank()) { rueckmeldung = "Bitte Vorname und Nachname angeben."; return }
        if (!bearbeiten && email.isBlank()) { rueckmeldung = "Bitte E-Mail angeben."; return }
        if (nummer.isBlank()) { rueckmeldung = "Bitte eine Fahrernummer in \"Nr.\" angeben."; return }
        val fahrerNummer = nummer.toIntOrNull()
        if (fahrerNummer == null || fahrerNummer <= 0) { rueckmeldung = "Fahrernummer muss eine positive ganze Zahl sein."; return }
        val imeiZiffern = imei.filter { it.isDigit() }
        if (ortung == "obd" && imeiZiffern.length != 15) { rueckmeldung = "Bitte die 15-stellige IMEI des Trackers eintragen."; return }

        speichert = true
        rueckmeldung = ""
        try {
            val mail = email.trim().lowercase()
            if (!bearbeiten && !Regex("[^\\s@]+@[^\\s@]+\\.[^\\s@]+").matches(mail)) {
                rueckmeldung = "Bitte eine gültige E-Mail-Adresse eingeben (z. B. name@firma.de)."; return
            }
            val mailFuerProfil: JsonElement = when {
                mail.isNotEmpty() -> JsonPrimitive(mail)
                bearbeiten && urspruenglicheEmail.isNotEmpty() -> JsonPrimitive(urspruenglicheEmail)
                else -> JsonNull
            }
            val profil = linkedMapOf<String, JsonElement>(
                "first_name" to JsonPrimitive(vorname.trim()),
                "last_name" to JsonPrimitive(nachname.trim()),
                "email" to mailFuerProfil,
                "phone" to JsonPrimitive("${landesvorwahl.trim()} ${telefon.trim()}".trim()),
                "street" to jsonText(strasse),
                "street_number" to jsonText(hausnummer),
                "city" to jsonText(ort),
                "zip" to jsonText(plz),
                "language" to JsonPrimitive(sprache.ifEmpty { "Deutsch" }),
                "role" to JsonPrimitive("fahrer"),
                "is_dispo" to JsonPrimitive(false),
                "vehicle_id" to if (fahrzeugID.isEmpty()) JsonNull else JsonPrimitive(fahrzeugID),
                "driver_number" to JsonPrimitive(fahrerNummer),
                "tracking_mode" to JsonPrimitive(ortung),
            )

            val f = ursprung
            if (f != null) {
                val ziel = f.id.trim()
                if (ziel.isEmpty()) throw StammFehler("Fahrer-ID fehlt.")
                // Im Web erst Admin-, dann oeffentlicher Client. Live sind beide derselbe angemeldete Client.
                profilAktualisieren(ziel, profil)?.let { throw StammFehler("Speichern fehlgeschlagen. Admin: $it | Public: $it") }
                try { trackerSpeichern(ziel, imeiZiffern) } catch (e: Exception) {
                    throw StammFehler("Tracker-Zuordnung nicht gespeichert: ${dbMeldung(e)}")
                }
                rueckmeldung = "Fahrer gespeichert."
                if (mail.isNotEmpty()) urspruenglicheEmail = mail
                return
            }

            // Einladung ueber die Funktion dispo-admin, der Admin-Schluessel bleibt auf dem Server.
            val nutzerID = einladen(mail)
            val zeile = LinkedHashMap(profil).apply { put("id", JsonPrimitive(nutzerID)) }
            profilEinfuegen(zeile)?.let { throw StammFehler(it) }
            try { trackerSpeichern(nutzerID, imeiZiffern) } catch (e: Exception) {
                throw StammFehler("Tracker-Zuordnung nicht gespeichert: ${dbMeldung(e)}")
            }
            rueckmeldung = "Fahrer angelegt. Die Einladungs-Mail zum Passwort setzen wurde versendet."
            formularLeeren()
        } catch (e: kotlinx.coroutines.CancellationException) {
            throw e
        } catch (e: Exception) {
            rueckmeldung = "Fahrer konnte nicht gespeichert werden: ${dbMeldung(e)}"
        } finally {
            speichert = false
        }
    }

    /** updateProfile: bei fehlender email-Spalte einmal ohne email. */
    private suspend fun profilAktualisieren(id: String, profil: Map<String, JsonElement>): String? {
        val inhalt = profil.toMutableMap()
        repeat(2) {
            try {
                val z = Backend.client.from("profiles").update(JsonObject(inhalt)) {
                    select(Columns.raw("id, first_name, last_name, phone, street, street_number, city, zip, language, vehicle_id, driver_number"))
                    filter { eq("id", id) }
                }.decodeList<JsonObject>().firstOrNull()
                if ((z?.text("id") ?: "").isEmpty()) return "Kein Profil aktualisiert (keine Schreibrechte oder Fahrer nicht gefunden)."
                return null
            } catch (e: kotlinx.coroutines.CancellationException) {
                throw e
            } catch (e: Exception) {
                val m = dbMeldung(e)
                if (fehltEmailSpalte(m) && inhalt.containsKey("email")) inhalt.remove("email") else return m
            }
        }
        return null
    }

    /** upsertProfile: bei fehlender email-Spalte einmal ohne email. */
    private suspend fun profilEinfuegen(zeile: Map<String, JsonElement>): String? {
        val inhalt = zeile.toMutableMap()
        repeat(2) {
            try {
                Backend.client.from("profiles").upsert(listOf(JsonObject(inhalt)))
                return null
            } catch (e: kotlinx.coroutines.CancellationException) {
                throw e
            } catch (e: Exception) {
                val m = dbMeldung(e)
                if (fehltEmailSpalte(m) && inhalt.containsKey("email")) inhalt.remove("email") else return m
            }
        }
        return null
    }

    /**
     * Tracker-Zuordnung passend zur Ortung. Bei 'app' wird jeder Tracker des Fahrers abgeschaltet,
     * sonst schreiben Handy und Tracker abwechselnd den Standort. Bei 'obd' bekommt der Fahrer
     * genau diese IMEI. War sie bei jemand anderem, wandert sie mit.
     */
    private suspend fun trackerSpeichern(fahrerID: String, imeiZiffern: String) {
        Backend.client.from("imei_driver_map").update(buildJsonObject { put("is_active", false) }) {
            filter {
                eq("driver_id", fahrerID)
                neq("imei", if (ortung == "obd") imeiZiffern else "")
            }
        }
        if (ortung != "obd") return
        Backend.client.from("imei_driver_map").upsert(
            listOf(buildJsonObject { put("imei", imeiZiffern); put("driver_id", fahrerID); put("is_active", true) }),
        ) { onConflict = "imei" }
    }

    /** dispo-admin, aktion fahrer_einladen. Liefert die neue user_id. */
    private suspend fun einladen(mail: String): String {
        val koerper = buildJsonObject {
            put("aktion", "fahrer_einladen")
            put("email", mail)
            put("redirectTo", PASSWORT_ZIEL)
            put("first_name", vorname.trim())
            put("last_name", nachname.trim())
        }
        val text = try {
            Backend.client.functions.invoke("dispo-admin", body = koerper).bodyAsText()
        } catch (e: kotlinx.coroutines.CancellationException) {
            throw e
        } catch (e: Exception) {
            var t = e.message ?: e.toString()
            if (e is RestException) {
                val roh = e.error
                t = runCatching { (Backend.json.parseToJsonElement(roh).jsonObject["error"] as? JsonPrimitive)?.content }.getOrNull()
                    ?.takeIf { it.isNotEmpty() } ?: roh.ifEmpty { t }
            }
            if (Regex("invalid format|unable to validate email address", RegexOption.IGNORE_CASE).containsMatchIn(t)) {
                throw StammFehler("Bitte eine gültige E-Mail-Adresse eingeben (z. B. name@firma.de).")
            }
            if (t.contains("not_signed_in", ignoreCase = true)) {
                // Sitzung ist serverseitig weg, Token im Geraet noch da.
                throw StammFehler("Deine Anmeldung ist abgelaufen. Bitte einmal abmelden und neu anmelden, dann den Fahrer erneut anlegen.")
            }
            throw StammFehler("Einladungs-Mail konnte nicht versendet werden: $t")
        }
        val id = runCatching { (Backend.json.parseToJsonElement(text).jsonObject["user_id"] as? JsonPrimitive)?.content }.getOrNull()
        if (id.isNullOrEmpty() || id == "null") throw StammFehler("Auth-User wurde nicht erstellt (keine user.id erhalten).")
        return id
    }
}
