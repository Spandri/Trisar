package de.trisar.dispo.fahrten

import de.trisar.kern.Backend
import de.trisar.kern.EigeneOrte
import io.github.jan.supabase.postgrest.from
import io.github.jan.supabase.postgrest.query.Columns
import io.github.jan.supabase.postgrest.query.Order
import io.github.jan.supabase.postgrest.query.filter.FilterOperator
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/** Werte des Formulars (formValues in FahrtAdd.jsx / FahrtBearbeitenView.jsx). */
data class FahrtFormularWerte(
    val datum: String = "",
    val startZeit: String = "",
    val start: String = "",
    val ziel: String = "",
    val flugnummer: String = "",
    val zugnummer: String = "",
    val konvoi: String = "",
    val anzahlKinder: String = "",
    val anonymeGaeste: String = "",
    val aktuellerStatus: String = "",
    val anzahlFahrzeuge: String = "",
    /** Gewaehlter eigener Ort (orte.id) fuer Start/Ziel, leer bei frei getippter Adresse. */
    val startOrtID: String = "",
    val zielOrtID: String = "",
)

/** Stand einer Fahrt beim Oeffnen des Editors (rideEditorData aus openRideEditorById). */
data class GeladeneFahrt(
    val id: String,
    val werte: FahrtFormularWerte,
    val fahrerNamen: List<String>,
    /** Gaeste mit ", " verbunden wie ride.fahrgaeste. */
    val fahrgaeste: String,
    val notiz: String,
    val aiBooked: Boolean,
)

/** payload an onCreateRide / onSave. */
data class FahrtEingabe(
    val werte: FahrtFormularWerte,
    /** Gaeste mit "; " verbunden. */
    val fahrgaeste: String,
    val fahrerNamen: List<String>,
    val flugZielFlughafen: String,
    val flugAnkunftGeplant: String,
    val notiz: String,
)

/**
 * Laden, Anlegen, Aendern und Loeschen einer Fahrt wie handleCreateRide, handleSaveRideEdit,
 * handleDeleteRide und loadRidesFromDb in admin/src/App.jsx (FahrtSpeichern.swift).
 */
object FahrtSpeichern {
    data class Ergebnis(val ok: Boolean, val fehler: String? = null)

    private const val AI_TAG = "[AI_BOOKED]"
    private const val ALT_ANONYM = """^anonymer?\s+fahrgast(?:\s+\d+)?$"""

    // MARK: Verzeichnisse

    data class FahrerEintrag(val id: String, val vorname: String?, val nachname: String?, val nummer: String, val rolle: String?) {
        val name: String get() = FahrtText.name(vorname, nachname)
    }

    data class GastEintrag(val id: String, val vorname: String?, val nachname: String?, val email: String?) {
        val name: String get() = FahrtText.name(vorname, nachname)
    }

    private val dispoRollen = setOf("dispo", "dispatcher", "admin", "koordinator", "coordinator")

    private fun textOderNull(o: JsonObject, k: String): String? = (o[k] as? JsonPrimitive)?.takeIf { it !is JsonNull }?.content

    /** fetchDriverProfilesForLookup / FahrerAutocomplete: nur Fahrer (Rolle entscheidet, nicht is_dispo). */
    suspend fun fahrerLaden(): List<FahrerEintrag> = runCatching {
        Backend.client.from("profiles").select(Columns.raw("id, first_name, last_name, driver_number, role, is_dispo")) {
            order("driver_number", Order.ASCENDING, nullsFirst = false)
        }.decodeList<JsonObject>()
    }.getOrDefault(emptyList()).map {
        FahrerEintrag(W.t(it["id"]), textOderNull(it, "first_name"), textOderNull(it, "last_name"), W.t(it["driver_number"]), textOderNull(it, "role"))
    }.filter { it.id.isNotEmpty() && FahrtText.getrimmt(it.rolle).lowercase() !in dispoRollen }

    suspend fun gaesteLaden(): List<GastEintrag> = runCatching {
        Backend.client.from("guests").select(Columns.raw("id, first_name, last_name, email")) {
            order("first_name", Order.ASCENDING)
            order("last_name", Order.ASCENDING)
        }.decodeList<JsonObject>()
    }.getOrDefault(emptyList()).map {
        GastEintrag(W.t(it["id"]), textOderNull(it, "first_name"), textOderNull(it, "last_name"), textOderNull(it, "email"))
    }.filter { it.id.isNotEmpty() }

    /** buildDriverSuggestionOptions aus FahrerAutocomplete.jsx. */
    fun fahrerVorschlaege(fahrer: List<FahrerEintrag>): List<String> = fahrer.mapNotNull { f ->
        val n = f.name
        val d = f.nummer
        val label = if (n.isNotEmpty() && d.isNotEmpty()) "$n ($d)" else n.ifEmpty { d }
        label.ifEmpty { null }
    }.distinct()

    fun gastVorschlaege(gaeste: List<GastEintrag>): List<String> = gaeste.map { it.name }.filter { it.isNotEmpty() }.distinct()

    /** resolveDriverIdFromInput */
    fun fahrerID(eingabe: String, fahrer: List<FahrerEintrag>): String? {
        val e = FahrtText.ortNormal(eingabe)
        if (e.isEmpty()) return null
        val zahl = FahrtText.nummernTeil(eingabe)
        val liste = fahrer.map { Triple(it.id, FahrtText.ortNormal(it.name), it.nummer) }
        liste.firstOrNull { it.second.isNotEmpty() && it.second == e }?.let { return it.first }
        if (zahl.isNotEmpty()) liste.firstOrNull { it.third.isNotEmpty() && it.third == zahl }?.let { return it.first }
        liste.firstOrNull { it.second.isNotEmpty() && (e.contains(it.second) || it.second.contains(e)) }?.let { return it.first }
        if (zahl.isNotEmpty()) liste.firstOrNull { it.third.isNotEmpty() && it.third.contains(zahl) }?.let { return it.first }
        return null
    }

    /** resolveGuestIdFromInput */
    fun gastID(eingabe: String, gaeste: List<GastEintrag>): String? {
        val e = FahrtText.ortNormal(eingabe)
        if (e.isEmpty()) return null
        val liste = gaeste.map { Triple(it.id, FahrtText.ortNormal(it.name), FahrtText.ortNormal(it.email ?: "")) }
        liste.firstOrNull { it.second.isNotEmpty() && it.second == e }?.let { return it.first }
        liste.firstOrNull { it.third.isNotEmpty() && it.third == e }?.let { return it.first }
        liste.firstOrNull { it.second.isNotEmpty() && (e.contains(it.second) || it.second.contains(e)) }?.let { return it.first }
        liste.firstOrNull { it.third.isNotEmpty() && (e.contains(it.third) || it.third.contains(e)) }?.let { return it.first }
        return null
    }

    // MARK: Laden (Mapping aus loadRidesFromDb + openRideEditorById)

    private fun stringWert(w: JsonElement?): String? = (w as? JsonPrimitive)?.takeIf { it !is JsonNull && it.isString }?.content

    /** Ortsangabe fuer den Editor: Adresse, sonst Name, sonst "-". */
    private fun ortFuerEditor(name: String?, adresse: String?): String {
        val n = FahrtText.getrimmt(name)
        val a = FahrtText.getrimmt(adresse)
        return a.ifEmpty { n.ifEmpty { "-" } }
    }

    private suspend fun <T> still(standard: T, block: suspend () -> T): T = try { block() } catch (e: kotlinx.coroutines.CancellationException) { throw e } catch (e: Exception) { standard }

    suspend fun laden(id: String): GeladeneFahrt {
        val c = Backend.client
        val spalten = "id, driver_id, convoy_id, pickup_name, pickup_address, dropoff_name, dropoff_address, ride_date, etd, original_etd, status, passengers, anonymous_guests, flight_number, train_number, train_planned_time, train_predicted_time, ext_flight_payload, ai_booked"
        // Mit Ort-Zuordnung, ohne sie, falls die Spalten (Migration orte_radien) noch fehlen.
        suspend fun mit(s: String) = c.from("jobs").select(Columns.raw(s)) {
            filter { eq("id", id) }
            limit(1)
        }.decodeList<JsonObject>().firstOrNull()
        val job = (try { mit("$spalten, pickup_ort_id, dropoff_ort_id") } catch (e: kotlinx.coroutines.CancellationException) { throw e } catch (e: Exception) { mit(spalten) })
            ?: error("Fahrt nicht gefunden.")

        val archiv = still(emptyList()) { c.from("jobs_archive").select(Columns.raw("job_id")) { filter { eq("job_id", id) } }.decodeList<JsonObject>() }
        val zuordnungen = still(emptyList()) { c.from("convoy_assignments").select(Columns.raw("driver_id, response_status")) { filter { eq("job_id", id) } }.decodeList<JsonObject>() }
        val jobFahrer = W.t(job["driver_id"])
        val fahrerIDs = (listOf(jobFahrer) + zuordnungen.map { W.t(it["driver_id"]) }).filter { it.isNotEmpty() }.distinct()
        val profile = if (fahrerIDs.isEmpty()) emptyList() else still(emptyList()) {
            c.from("profiles").select(Columns.raw("id, first_name, last_name, driver_number")) { filter { isIn("id", fahrerIDs) } }.decodeList<JsonObject>()
        }
        val links = still(emptyList()) { c.from("job_guests").select(Columns.raw("guest_id, is_main_contact")) { filter { eq("job_id", id) } }.decodeList<JsonObject>() }
        val gastIDs = links.map { W.t(it["guest_id"]) }.filter { it.isNotEmpty() }.distinct()
        val gaeste = if (gastIDs.isEmpty()) emptyList() else still(emptyList()) {
            c.from("guests").select(Columns.raw("id, first_name, last_name")) { filter { isIn("id", gastIDs) } }.decodeList<JsonObject>()
        }
        var kolonnenName = ""
        val kolonnenID = W.t(job["convoy_id"])
        if (kolonnenID.isNotEmpty()) {
            val zeilen = still(emptyList()) { c.from("convoys").select(Columns.raw("id, name")) { filter { eq("id", kolonnenID) } }.decodeList<JsonObject>() }
            kolonnenName = FahrtText.getrimmt(stringWert(zeilen.firstOrNull()?.get("name")))
        }
        val notizen = still(emptyList()) {
            c.from("job_notes").select(Columns.raw("note_text, author_name")) {
                filter { eq("job_id", id) }
                order("created_at", Order.DESCENDING)
            }.decodeList<JsonObject>()
        }

        // Fahrer: Hauptfahrer + Kolonnen-Zuordnungen, doppelte nach ID entfernt.
        val profilNach = profile.associateBy { W.t(it["id"]) }
        val namen = mutableListOf<String>()
        val gesehen = HashSet<String>()
        for (fid in (listOf(jobFahrer) + zuordnungen.map { W.t(it["driver_id"]) }).filter { it.isNotEmpty() }) {
            val p = profilNach[fid] ?: continue
            if (!gesehen.add(fid)) continue
            val label = FahrtText.fahrerBeschriftung(FahrtText.name(stringWert(p["first_name"]), stringWert(p["last_name"])), W.t(p["driver_number"]))
            if (label.isNotEmpty()) namen.add(label)
        }
        val hatKolonne = kolonnenID.isNotEmpty() || namen.size > 1
        val fahrzeuge = if (hatKolonne) maxOf(1, namen.size).toString() else ""

        // Gaeste: passengers ist die Quelle, sobald es als Liste/Objekt vorliegt.
        val p = job["passengers"]
        val istObjekt = p is JsonArray || p is JsonObject
        val roh: List<String> = when (p) {
            is JsonArray -> p.mapNotNull { stringWert(it) }.map { FahrtText.getrimmt(it) }.filter { it.isNotEmpty() }
            is JsonObject -> p.values.mapNotNull { stringWert(it) }.map { FahrtText.getrimmt(it) }.filter { it.isNotEmpty() }
            else -> FahrtText.gaesteTeilen(stringWert(p))
        }
        val istAltAnonym = { s: String -> Regex(ALT_ANONYM, RegexOption.IGNORE_CASE).containsMatchIn(s) }
        val altAnzahl = roh.count(istAltAnonym)
        val passagiere = roh.filter { !istAltAnonym(it) }
        val gastNach = gaeste.associateBy { W.t(it["id"]) }
        val gastNamen = links.sortedByDescending { if (W.bool(it["is_main_contact"])) 1 else 0 }
            .mapNotNull { gastNach[W.t(it["guest_id"])] }
            .map { FahrtText.name(stringWert(it["first_name"]), stringWert(it["last_name"])) }.filter { it.isNotEmpty() }
        val wirksam = if (istObjekt) passagiere else gastNamen.ifEmpty { passagiere }
        val anonym = maxOf(W.t(job["anonymous_guests"]).toIntOrNull() ?: 0, altAnzahl)

        // Startzeit wie die Fahrtenliste: Zugzeiten bevorzugt, heute verspaetete offene Fahrten auf jetzt.
        var etd = FahrtText.uhrzeit(stringWert(job["etd"]), "")
        var original = FahrtText.uhrzeit(stringWert(job["original_etd"]), "")
        val zug = FahrtText.getrimmt(stringWert(job["train_number"]))
        val zugGeplant = FahrtText.uhrzeit(stringWert(job["train_planned_time"]), "")
        val zugErwartet = FahrtText.uhrzeit(stringWert(job["train_predicted_time"]), "")
        val summary = (job["ext_flight_payload"] as? JsonObject)?.get("summary") as? JsonObject
        if (zug.isNotEmpty() && summary != null) {
            val geplant = FahrtText.uhrzeit(FahrtText.uhrAusISO(stringWert(summary["scheduled_arrival_local"])), "")
            val erwartet = FahrtText.uhrzeit(FahrtText.uhrAusISO(stringWert(summary["estimated_arrival_local"])), "")
            if (erwartet.isNotEmpty() && zugErwartet.isEmpty()) etd = erwartet
            if (geplant.isNotEmpty() && zugGeplant.isEmpty()) original = geplant
        }
        if (zug.isNotEmpty()) {
            if (zugErwartet.isNotEmpty()) etd = zugErwartet
            if (zugGeplant.isNotEmpty()) original = zugGeplant
        }
        val jobStatus = if (archiv.isEmpty()) FahrtText.getrimmt(stringWert(job["status"])).lowercase() else "archived"
        val offenArtig = setOf("pending", "assigned", "offen", "new", "requested", "offered", "zugewiesen", "at_pickup", "beim_pickup", "beim pickup")
        val tag = FahrtText.fahrtDatum(stringWert(job["ride_date"]), FahrtText.heute())
        val jetzt = FahrtText.jetztUhr()
        val geplantUhr = original.ifEmpty { etd }
        var wirksameUhr = etd.ifEmpty { original }
        val g = FahrtText.minuten(geplantUhr)
        val n = FahrtText.minuten(jetzt)
        if (tag == FahrtText.heute() && jobStatus in offenArtig && g != null && n != null && n > g) wirksameUhr = jetzt
        val startZeit = wirksameUhr.ifEmpty { original.ifEmpty { "--:--" } }

        // Notizen: neueste ohne Autor = Dispo-Notiz, das KI-Kennzeichen wird herausgenommen.
        val neueste = notizen.firstOrNull()
        val dispo = notizen.firstOrNull { FahrtText.getrimmt(stringWert(it["author_name"])).isEmpty() }
        val dispoText = FahrtText.getrimmt((stringWert(dispo?.get("note_text")) ?: "").replace(AI_TAG, ""))
        val aiBooked = W.bool(job["ai_booked"]) || (stringWert(neueste?.get("note_text")) ?: "").contains(AI_TAG) || (stringWert(dispo?.get("note_text")) ?: "").contains(AI_TAG)

        // Mit eigenem Ort steht im Feld der Ortsname (pickup_name), sonst die Adresse.
        val startOrt = FahrtText.getrimmt(stringWert(job["pickup_ort_id"]))
        val zielOrt = FahrtText.getrimmt(stringWert(job["dropoff_ort_id"]))
        val werte = FahrtFormularWerte(
            datum = tag,
            startZeit = startZeit,
            start = if (startOrt.isNotEmpty()) FahrtText.getrimmt(stringWert(job["pickup_name"])).ifEmpty { ortFuerEditor(null, stringWert(job["pickup_address"])) }
                else ortFuerEditor(stringWert(job["pickup_name"]), stringWert(job["pickup_address"])),
            ziel = if (zielOrt.isNotEmpty()) FahrtText.getrimmt(stringWert(job["dropoff_name"])).ifEmpty { ortFuerEditor(null, stringWert(job["dropoff_address"])) }
                else ortFuerEditor(stringWert(job["dropoff_name"]), stringWert(job["dropoff_address"])),
            startOrtID = startOrt,
            zielOrtID = zielOrt,
            flugnummer = FahrtText.getrimmt(stringWert(job["flight_number"])),
            zugnummer = zug,
            konvoi = kolonnenName.ifEmpty { if (hatKolonne) "Kolonne" else "" },
            // openRideEditorById: String(ride.anzahlKinder || '0'), die Liste kennt keine Kinder.
            anzahlKinder = "0",
            anonymeGaeste = anonym.toString(),
            aktuellerStatus = FahrtText.editorStatus(jobStatus),
            anzahlFahrzeuge = fahrzeuge,
        )
        return GeladeneFahrt(W.t(job["id"]).ifEmpty { id }, werte, namen.ifEmpty { listOf("") }, wirksam.joinToString(", "), dispoText, aiBooked)
    }

    // MARK: Gemeinsame Vorbereitung (Pruefungen vor dem Schreiben)

    private data class Vorbereitet(
        val start: String,
        val ziel: String,
        /** pickup_/dropoff_-Werte: mit eigenem Ort Name und Adresse des Orts, sonst beides der getippte Text. */
        val startName: String,
        val startAdresse: String,
        val startOrt: String?,
        val zielName: String,
        val zielAdresse: String,
        val zielOrt: String?,
        val tag: String,
        val startZeit: String,
        val kolonne: String,
        val fahrerNamen: List<String>,
        val gaeste: List<String>,
        val anonym: Int,
        val flugNr: String,
        val zugNr: String,
        val flug: FahrtPruefung.ZumSpeichern,
        val zug: FahrtPruefung.ZumSpeichern,
        val zugZeiten: FahrtPruefung.ZugZeiten,
        val zugLive: JsonElement,
    )

    private class Abbruch(text: String) : Exception(text)

    private suspend fun vorbereiten(e: FahrtEingabe): Vorbereitet {
        val start = FahrtText.getrimmt(e.werte.start)
        val ziel = FahrtText.getrimmt(e.werte.ziel)
        if (start.isEmpty() || ziel.isEmpty()) throw Abbruch(FahrtText.tr("app.startZielFehlt"))
        val tag = FahrtText.fahrtDatum(e.werte.datum)
        if (tag.isEmpty()) throw Abbruch(FahrtText.tr("app.datumUngueltig"))
        var startZeit = FahrtText.uhrzeit(e.werte.startZeit, "")
        val flugNr = FahrtText.nummer(e.werte.flugnummer)
        val zugNr = FahrtText.nummer(e.werte.zugnummer)
        if (flugNr.isNotEmpty() && zugNr.isNotEmpty()) throw Abbruch(FahrtText.tr("app.nurFlugOderZug"))
        val hinweis = FahrtText.getrimmt(e.flugZielFlughafen)
        val flug = FahrtPruefung.flugZumSpeichern(flugNr, tag, hinweis.ifEmpty { start }, e.flugAnkunftGeplant)
        if (!flug.ok) throw Abbruch(flug.fehler ?: FahrtText.tr("app.flugValidierungFehler"))
        val zug = FahrtPruefung.zugZumSpeichern(zugNr, tag, start)
        if (!zug.ok) throw Abbruch(zug.fehler ?: FahrtText.tr("app.zugValidierungFehler"))
        val zeiten = if (zug.gueltig) FahrtPruefung.zugZeiten(zug.daten, startZeit) else FahrtPruefung.ZugZeiten(etd = startZeit, etdOriginal = startZeit)
        if (zeiten.etd.isNotEmpty()) startZeit = zeiten.etd
        val live = if (zug.gueltig) FahrtPruefung.zugLiveDaten(zug.daten, DispoDatum.iso()) else JsonNull
        val so = EigeneOrte.zuID(e.werte.startOrtID)
        val zo = EigeneOrte.zuID(e.werte.zielOrtID)
        return Vorbereitet(
            start, ziel,
            startName = so?.name ?: start, startAdresse = so?.adresse ?: start, startOrt = so?.id,
            zielName = zo?.name ?: ziel, zielAdresse = zo?.adresse ?: ziel, zielOrt = zo?.id,
            tag = tag, startZeit = startZeit,
            kolonne = FahrtText.getrimmt(e.werte.konvoi),
            fahrerNamen = FahrtText.fahrerNamenListe(e.fahrerNamen),
            gaeste = FahrtText.gaesteTeilen(e.fahrgaeste),
            anonym = maxOf(0, FahrtText.getrimmt(e.werte.anonymeGaeste.ifEmpty { "0" }).toIntOrNull() ?: 0),
            flugNr = flugNr, zugNr = zugNr, flug = flug, zug = zug, zugZeiten = zeiten, zugLive = live,
        )
    }

    private suspend fun kolonnenID(name: String): String? {
        if (name.isEmpty()) return null
        val zeilen = Backend.client.from("convoys").select(Columns.raw("id, name")) {
            filter { ilike("name", name) }
            limit(1)
        }.decodeList<JsonObject>()
        return zeilen.firstOrNull()?.let { W.t(it["id"]) }?.ifEmpty { null }
    }

    private fun text(t: String): JsonElement = if (t.isEmpty()) JsonNull else JsonPrimitive(t)
    private fun id(u: String?): JsonElement = u?.let { JsonPrimitive(it.lowercase()) } ?: JsonNull

    /** Gemeinsame Spalten von insertPayload / updatePayload. */
    private fun jobSpalten(v: Vorbereitet, status: String, kolonne: String?, fahrer: String?, aiBooked: Boolean): MutableMap<String, JsonElement> {
        val jetzt = DispoDatum.iso()
        return linkedMapOf(
            "pickup_name" to JsonPrimitive(v.startName),
            "pickup_address" to JsonPrimitive(v.startAdresse),
            "dropoff_name" to JsonPrimitive(v.zielName),
            "dropoff_address" to JsonPrimitive(v.zielAdresse),
            "ride_date" to JsonPrimitive(v.tag),
            "etd" to text(if (v.zug.gueltig) v.zugZeiten.etd else v.startZeit),
            "original_etd" to text(if (v.zug.gueltig) v.zugZeiten.etdOriginal else v.startZeit),
            "status" to JsonPrimitive(status),
            "convoy_id" to id(kolonne),
            "driver_id" to id(fahrer),
            "passengers" to JsonArray(v.gaeste.map { JsonPrimitive(it) }),
            "flight_number" to (if (v.flug.gueltig) JsonPrimitive(v.flugNr) else JsonNull),
            "train_number" to (if (v.zug.gueltig) JsonPrimitive(v.zugNr) else JsonNull),
            "train_planned_time" to (if (v.zug.gueltig) text(v.zugZeiten.geplant) else JsonNull),
            "train_predicted_time" to (if (v.zug.gueltig) text(v.zugZeiten.erwartet) else JsonNull),
            "trip_type" to JsonPrimitive(if (v.flug.gueltig) "airport" else if (v.zug.gueltig) "train" else "normal"),
            "ext_flight_payload" to (if (v.zug.gueltig) v.zugLive else JsonNull),
            "ext_flight_last_sync_at" to (if (v.zug.gueltig) JsonPrimitive(jetzt) else JsonNull),
            "anonymous_guests" to JsonPrimitive(v.anonym),
            "ai_booked" to JsonPrimitive(aiBooked),
        ).also {
            // Ort-Zuordnung nur schreiben, wenn es die Tabelle orte (und damit die Spalten) gibt.
            if (EigeneOrte.verfuegbar) {
                it["pickup_ort_id"] = id(v.startOrt)
                it["dropoff_ort_id"] = id(v.zielOrt)
            }
        }
    }

    /** Gaeste mit Eintrag in guests als job_guests verknuepfen (erster = Hauptkontakt). */
    private suspend fun gaesteVerknuepfen(fahrtID: String, namen: List<String>) {
        val verzeichnis = gaesteLaden()
        val gesehen = HashSet<String>()
        val zeilen = namen.mapIndexedNotNull { i, name ->
            val g = gastID(name, verzeichnis) ?: return@mapIndexedNotNull null
            if (!gesehen.add(g)) return@mapIndexedNotNull null
            JsonObject(mapOf("job_id" to id(fahrtID), "guest_id" to id(g), "is_main_contact" to JsonPrimitive(i == 0)))
        }
        if (zeilen.isEmpty()) return
        still(Unit) { Backend.client.from("job_guests").upsert(zeilen) { onConflict = "job_id,guest_id" }; Unit }
    }

    private suspend fun notizAnlegen(fahrtID: String, notiz: String) {
        Backend.client.from("job_notes").insert(buildJsonObject { put("job_id", fahrtID.lowercase()); put("note_text", notiz) })
    }

    // MARK: Anlegen (handleCreateRide)

    suspend fun anlegen(e: FahrtEingabe): Ergebnis {
        val v = try { vorbereiten(e) } catch (a: Abbruch) { return Ergebnis(false, a.message) }
        return try {
            val kolonne = kolonnenID(v.kolonne)
            val fahrer = if (v.fahrerNamen.isEmpty()) emptyList() else fahrerLaden()
            val fahrerIDs = mutableListOf<String>()
            for (n in v.fahrerNamen) fahrerID(n, fahrer)?.let { if (it !in fahrerIDs) fahrerIDs.add(it) }
            val kolonnenSync = kolonne != null || v.fahrerNamen.size > 1 || fahrerIDs.size > 1

            val zeile = JsonObject(jobSpalten(v, FahrtText.jobStatus(e.werte.aktuellerStatus), kolonne, fahrerIDs.firstOrNull(), false))
            val neu = Backend.client.from("jobs").insert(zeile) {
                select(Columns.raw("id"))
            }.decodeList<JsonObject>().first()
            val neuID = W.t(neu["id"])

            kolonneAbgleichen(neuID, if (kolonnenSync) fahrerIDs else emptyList())
            if (v.flug.gueltig) FahrtPruefung.externerAbgleich(neuID, "create")
            val notiz = FahrtText.getrimmt(e.notiz)
            if (notiz.isNotEmpty()) still(Unit) { notizAnlegen(neuID, notiz) }
            if (v.gaeste.isNotEmpty()) gaesteVerknuepfen(neuID, v.gaeste)
            Ergebnis(true)
        } catch (x: kotlinx.coroutines.CancellationException) {
            throw x
        } catch (x: Exception) {
            Ergebnis(false, fehlerText(x))
        }
    }

    // MARK: Aendern (handleSaveRideEdit)

    suspend fun aendern(e: FahrtEingabe, geladen: GeladeneFahrt): Ergebnis {
        val fahrtID = geladen.id
        val v = try { vorbereiten(e) } catch (a: Abbruch) { return Ergebnis(false, a.message) }
        val c = Backend.client
        return try {
            val kolonne = kolonnenID(v.kolonne)
            val fahrer = if (v.fahrerNamen.isEmpty()) emptyList() else fahrerLaden()
            val fahrerIDs = mutableListOf<String>()
            for (n in v.fahrerNamen) fahrerID(n, fahrer)?.let { if (it !in fahrerIDs) fahrerIDs.add(it) }
            val offen = v.fahrerNamen.filter { fahrerID(it, fahrer) == null }
            if (v.fahrerNamen.isNotEmpty() && fahrerIDs.isEmpty()) {
                return Ergebnis(false, FahrtText.tr("app.fahrerNichtZugeordnet", mapOf("names" to v.fahrerNamen.joinToString(", "))))
            }
            if (offen.isNotEmpty()) {
                return Ergebnis(false, FahrtText.tr("app.fahrerNichtAufgeloest", mapOf("names" to offen.joinToString(", "))))
            }

            // Bisheriger Stand: entscheidet, ob der Fahrer neu bestaetigen muss.
            val bisher = still<JsonObject?>(null) {
                c.from("jobs").select(Columns.raw("driver_id, status, ride_date, etd, pickup_address, dropoff_address")) {
                    filter { eq("id", fahrtID) }
                    limit(1)
                }.decodeList<JsonObject>().first()
            }
            val bisherFahrer = bisher?.let { W.t(it["driver_id"]).ifEmpty { null } }
            val fahrerNeu = fahrerIDs.firstOrNull() ?: bisherFahrer
            val gewuenscht = FahrtText.jobStatus(e.werte.aktuellerStatus)
            val endStatus = gewuenscht in setOf("done", "completed", "cancelled", "canceled", "refused", "in_progress")
            val gleicheUhr = { a: String?, b: String -> (a ?: "").take(5) == b.take(5) }
            // Uhrzeit im Formular nicht angefasst: die gespeicherte ETD bleibt. Bei ueberfaelligen offenen
            // Fahrten zeigt das Formular "jetzt" statt der Planzeit. Sonst schrieb jede reine Statusaenderung
            // die aktuelle Uhrzeit als neue ETD und setzte bei "offen" die Annahme des Fahrers zurueck.
            val zeitUnberuehrt = bisher != null && !v.zug.gueltig
                && FahrtText.uhrzeit(e.werte.startZeit, "") == FahrtText.uhrzeit(geladen.werte.startZeit, "")
            val fahrtGeaendert = bisher == null
                || fahrerNeu?.lowercase() != bisherFahrer?.lowercase()
                || (stringWert(bisher["ride_date"]) ?: "") != v.tag
                || (!zeitUnberuehrt && !gleicheUhr(stringWert(bisher["etd"]), v.startZeit))
                || FahrtText.getrimmt(stringWert(bisher["pickup_address"])) != v.startAdresse
                || FahrtText.getrimmt(stringWert(bisher["dropoff_address"])) != v.zielAdresse
            val neuAnfragen = fahrerNeu != null && !endStatus && fahrtGeaendert
            // Status nur schreiben, wenn die Dispo ihn im Editor geaendert hat. Sonst bleibt der
            // DB-Status (der Fahrer kann die Fahrt inzwischen beendet haben).
            val geladenStatus = FahrtText.jobStatus(geladen.werte.aktuellerStatus)
            val dispoGeaendert = gewuenscht != geladenStatus
            val bisherStatus = FahrtText.getrimmt(stringWert(bisher?.get("status")))
            val behalten = bisherStatus.isNotEmpty() && !dispoGeaendert && !fahrtGeaendert
            val naechster = if (neuAnfragen) "pending" else if (behalten) (stringWert(bisher?.get("status")) ?: gewuenscht) else gewuenscht
            val kolonnenSync = kolonne != null || v.fahrerNamen.size > 1 || fahrerIDs.size > 1
            val zuordnung = if (kolonnenSync) fahrerIDs else listOfNotNull(fahrerNeu)

            val spalten = jobSpalten(v, naechster, kolonne, fahrerNeu, geladen.aiBooked)
            if (neuAnfragen) {
                spalten["driver_response_status"] = JsonPrimitive("pending")
                spalten["driver_responded_at"] = JsonNull
            }
            if (zeitUnberuehrt) {
                spalten.remove("etd")
                spalten.remove("original_etd")
            }
            val geaendert = c.from("jobs").update(JsonObject(spalten)) {
                select(Columns.raw("id, passengers"))
                filter { eq("id", fahrtID) }
            }.decodeList<JsonObject>()
            if (geaendert.isEmpty()) throw Abbruch(FahrtText.tr("app.fahrtUpdateFehler"))

            if (v.flug.gueltig) FahrtPruefung.externerAbgleich(fahrtID, "manual_refresh")
            kolonneAbgleichen(fahrtID, zuordnung, statusZuruecksetzen = neuAnfragen, ersetzen = true)

            // Archivierte Fahrt bewusst auf offen, unterwegs oder beendet gesetzt: Archiv-Eintrag entfernen.
            // Die Liste zeigt jede Fahrt mit Eintrag in jobs_archive als storniert, egal was in jobs.status steht.
            if (dispoGeaendert && FahrtText.editorStatus(gewuenscht) != "stoniert") {
                still(Unit) { c.from("jobs_archive").delete { filter { eq("job_id", fahrtID) } }; Unit }
                withContext(Dispatchers.Main) { DispoFahrtenSpeicher.archivAufheben(fahrtID) }
            }

            // Nur die Notizen der Disposition ersetzen, Fahrernotizen (mit author_name) bleiben.
            val notiz = listOf(if (geladen.aiBooked) AI_TAG else "", FahrtText.getrimmt(e.notiz)).filter { it.isNotEmpty() }
                .joinToString("\n").trim()
            c.from("job_notes").delete {
                filter {
                    eq("job_id", fahrtID)
                    filter("author_name", FilterOperator.IS, "null")
                }
            }
            if (notiz.isNotEmpty()) notizAnlegen(fahrtID, notiz)

            // Gast-Verknuepfungen neu setzen (auch wenn die Liste jetzt leer ist).
            still(Unit) { c.from("job_guests").delete { filter { eq("job_id", fahrtID) } }; Unit }
            gaesteVerknuepfen(fahrtID, v.gaeste)
            Ergebnis(true)
        } catch (x: kotlinx.coroutines.CancellationException) {
            throw x
        } catch (x: Exception) {
            Ergebnis(false, if (x is Abbruch) x.message else fehlerText(x))
        }
    }

    // MARK: Loeschen (handleDeleteRide)

    suspend fun loeschen(fahrtID: String): Ergebnis = try {
        Backend.client.from("jobs").delete { filter { eq("id", fahrtID) } }
        Ergebnis(true)
    } catch (x: kotlinx.coroutines.CancellationException) {
        throw x
    } catch (x: Exception) {
        Ergebnis(false, FahrtText.tr("app.fahrtStornierenFehler", mapOf("error" to fehlerText(x))))
    }

    // MARK: Kolonne (syncConvoyAssignmentsForJob)

    suspend fun kolonneAbgleichen(fahrtID: String, fahrerIDs: List<String>, statusZuruecksetzen: Boolean = false, ersetzen: Boolean = false): Boolean {
        val c = Backend.client
        val ids = fahrerIDs.distinct()
        return try {
            val bisher = c.from("convoy_assignments").select(Columns.raw("driver_id, response_status")) {
                filter { eq("job_id", fahrtID) }
            }.decodeList<JsonObject>()
            val antwortNach = HashMap<String, String>()
            for (z in bisher) {
                val d = W.t(z["driver_id"]).lowercase()
                if (d.isEmpty() || antwortNach.containsKey(d)) continue
                antwortNach[d] = W.t(z["response_status"]).ifEmpty { "pending" }
            }
            if (ersetzen) c.from("convoy_assignments").delete { filter { eq("job_id", fahrtID) } }
            if (ids.isEmpty()) {
                c.from("convoy_assignments").delete { filter { eq("job_id", fahrtID) } }
                return true
            }
            val zeilen = ids.map { d ->
                JsonObject(mapOf("job_id" to id(fahrtID), "driver_id" to id(d),
                    "response_status" to JsonPrimitive(if (statusZuruecksetzen) "pending" else (antwortNach[d.lowercase()] ?: "pending"))))
            }
            c.from("convoy_assignments").upsert(zeilen) { onConflict = "job_id,driver_id" }
            val idsKlein = ids.map { it.lowercase() }
            val veraltet = bisher.map { W.t(it["driver_id"]) }.filter { it.isNotEmpty() && it.lowercase() !in idsKlein }
            if (!ersetzen && veraltet.isNotEmpty()) {
                c.from("convoy_assignments").delete {
                    filter {
                        eq("job_id", fahrtID)
                        isIn("driver_id", veraltet)
                    }
                }
            }
            true
        } catch (x: kotlinx.coroutines.CancellationException) {
            throw x
        } catch (x: Exception) {
            false
        }
    }
}
