package de.trisar.kern

import io.github.jan.supabase.auth.auth
import io.github.jan.supabase.functions.functions
import io.ktor.client.statement.bodyAsText
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.put

/**
 * Dienstreise (Tabellen dienstreise, dienstreise_fahrer, Migration 20261113220000). Gemeinsamer Teil
 * fuer Fahrer und Dispo wie fahrer/src/shared/dienstreise.js und admin/src/shared/dienstreise.js:
 * Zeile, Zug/Flug, Icons, Verbindung live ueber train-validate bzw. flight-validate.
 */
@Serializable
data class DienstreiseZeile(
    val id: String,
    val datum: String = "",
    val start_zeit: String = "",
    val start_ort_id: String? = null,
    val start_name: String = "",
    val start_adresse: String? = null,
    val start_lat: Double? = null,
    val start_lng: Double? = null,
    val ziel_ort_id: String? = null,
    val ziel_name: String = "",
    val ziel_adresse: String? = null,
    val ziel_lat: Double? = null,
    val ziel_lng: Double? = null,
    val zugnummer: String? = null,
    val flugnummer: String? = null,
    val notiz: String? = null,
    val verbindung: JsonElement? = null,
    val erstellt: String? = null,
    val geaendert: String? = null,
    /** Ticket im Speicher dienstreise-tickets ("<id>/ticket.pdf") und was die Dispo daraus gelesen hat (14.11.). */
    val ticket_pfad: String? = null,
    val ticket_name: String? = null,
    val auftragsnummer: String? = null,
    val reisender: String? = null,
) {
    val flug: Boolean get() = !flugnummer.isNullOrBlank()
    val nummer: String get() = (zugnummer?.trim()?.ifEmpty { null } ?: flugnummer?.trim()).orEmpty()
    val zeit: String get() = start_zeit.take(5)
    val startPunkt: GeoPunkt? get() = if (start_lat != null && start_lng != null) GeoPunkt(start_lat, start_lng) else null
    val zielPunkt: GeoPunkt? get() = if (ziel_lat != null && ziel_lng != null) GeoPunkt(ziel_lat, ziel_lng) else null

    /** Stand beim Anlegen (Rueckfall, wenn die Live-Abfrage nicht klappt). */
    val gespeicherteVerbindung: ReiseVerbindung? get() = ReiseVerbindung.aus(verbindung)

    /** Kachel Start: Zug oder Flug (startIcon im Web). */
    val startIcon: String get() = if (flug) "Plain_Abflug_Trisar_Icons_01_grau" else "Bahnhof_Zug_Trisar_Icons_01_grau"

    /** Kachel Ziel: eigener Ort mit Icon, sonst nach Name (zielIcon = treffpunktIcon im Web). */
    val zielIcon: String get() = DienstTreffpunkt(ziel_ort_id, ziel_name, ziel_adresse.orEmpty(), null, "", null).iconGrau

    companion object {
        /** Alle Spalten wie select('*') im Web (ticket_* fehlen in aelteren Datenbanken, dann bleiben sie leer). */
        const val SPALTEN = "*"
    }
}

/** Halt auf der Strecke (Zug) bzw. Start/Ziel (Flug). */
data class ReiseHalt(val name: String, val punkt: GeoPunkt)

/**
 * Zwischenhalt eines Zugs (train-validate `halte`, nur mit `mit_halten: true`, ohne Start und Ziel):
 * Plan- und Ist-Zeiten als HH:MM, leer wenn unbekannt (an fehlt am ersten, ab am letzten Halt).
 */
data class ReiseZwischenhalt(
    val name: String,
    val anPlan: String = "",
    val an: String = "",
    val abPlan: String = "",
    val ab: String = "",
    val gleis: String = "",
)

/**
 * Verbindung einheitlich fuer Zug und Flug (verbindungHolen im Web):
 * { art, nummer, abfahrt_plan, abfahrt, gleis, ankunft_plan, ankunft, ankunft_ort, strecke }
 */
data class ReiseVerbindung(
    val art: String,
    val nummer: String,
    val abfahrtPlan: String = "",
    val abfahrt: String = "",
    val gleis: String = "",
    /** Nur live (15.11.): Abfahrtsgleis laut Fahrplan, Ankunftsgleis live und laut Fahrplan. */
    val gleisPlan: String = "",
    val gleisAn: String = "",
    val gleisAnPlan: String = "",
    val ankunftPlan: String = "",
    val ankunft: String = "",
    val ankunftOrt: String = "",
    val strecke: List<ReiseHalt> = emptyList(),
    /** Zug: Verlauf entlang der Gleise (train-validate strecke_linie, [[lng, lat], ...]). */
    val linie: List<GeoPunkt> = emptyList(),
    /** Zug: Zwischenhalte (train-validate `halte`), leer wenn der Server keine liefert. */
    val halte: List<ReiseZwischenhalt> = emptyList(),
    val fehler: String? = null,
) {
    /** Als jsonb fuer dienstreise.verbindung (gleiche Schluessel wie im Web). */
    fun alsJson(): JsonObject = buildJsonObject {
        put("art", art); put("nummer", nummer)
        put("abfahrt_plan", abfahrtPlan); put("abfahrt", abfahrt); put("gleis", gleis)
        put("ankunft_plan", ankunftPlan); put("ankunft", ankunft); put("ankunft_ort", ankunftOrt)
        put("strecke", kotlinx.serialization.json.JsonArray(strecke.map { h ->
            buildJsonObject { put("name", h.name); put("lat", h.punkt.lat); put("lng", h.punkt.lng) }
        }))
        put("linie", kotlinx.serialization.json.JsonArray(linie.map { p ->
            kotlinx.serialization.json.JsonArray(listOf(JsonPrimitive(p.lng), JsonPrimitive(p.lat)))
        }))
    }

    companion object {
        private fun s(o: JsonObject?, k: String): String =
            (o?.get(k) as? JsonPrimitive)?.takeIf { it !is JsonNull }?.content.orEmpty()

        private fun d(o: JsonObject?, k: String): Double? = (o?.get(k) as? JsonPrimitive)?.takeIf { it !is JsonNull }?.doubleOrNull

        /** [[lng, lat], ...] -> Punkte (ungueltige weg). */
        private fun punkte(e: JsonElement?): List<GeoPunkt> =
            (e as? kotlinx.serialization.json.JsonArray).orEmpty().mapNotNull { p ->
                val a = p as? kotlinx.serialization.json.JsonArray ?: return@mapNotNull null
                val lng = (a.getOrNull(0) as? JsonPrimitive)?.doubleOrNull
                val lat = (a.getOrNull(1) as? JsonPrimitive)?.doubleOrNull
                if (lat == null || lng == null) null else GeoPunkt(lat, lng)
            }

        fun aus(e: JsonElement?): ReiseVerbindung? {
            val o = (e as? JsonObject) ?: return null
            val strecke = runCatching { o["strecke"]!!.jsonArray }.getOrNull().orEmpty().mapNotNull { h ->
                val ho = h as? JsonObject ?: return@mapNotNull null
                val lat = d(ho, "lat"); val lng = d(ho, "lng")
                if (lat == null || lng == null) null else ReiseHalt(s(ho, "name"), GeoPunkt(lat, lng))
            }
            return ReiseVerbindung(
                art = s(o, "art").ifEmpty { "zug" }, nummer = s(o, "nummer"),
                abfahrtPlan = s(o, "abfahrt_plan"), abfahrt = s(o, "abfahrt"), gleis = s(o, "gleis"),
                ankunftPlan = s(o, "ankunft_plan"), ankunft = s(o, "ankunft"), ankunftOrt = s(o, "ankunft_ort"),
                strecke = strecke,
                linie = punkte(o["linie"]),
            )
        }

        private fun hm(wert: String): String = wert.take(5)

        /** train-validate `halte` [{ name, an_plan, an, ab_plan, ab, gleis }] -> Zwischenhalte (ohne Namen weg). */
        private fun zwischenhalte(e: JsonElement?): List<ReiseZwischenhalt> =
            (e as? kotlinx.serialization.json.JsonArray).orEmpty().mapNotNull { h ->
                val o = h as? JsonObject ?: return@mapNotNull null
                val name = s(o, "name").trim()
                if (name.isEmpty()) null
                else ReiseZwischenhalt(name, hm(s(o, "an_plan")), hm(s(o, "an")), hm(s(o, "ab_plan")), hm(s(o, "ab")), s(o, "gleis"))
            }

        /** Edge Function aufrufen, Antwort als JSON (auch bei Fehlerstatus, wenn eine Meldung kommt). */
        private suspend fun aufrufen(name: String, body: JsonObject): Pair<JsonObject?, String> = try {
            val text = Backend.client.functions.invoke(name, body).bodyAsText()
            (runCatching { Backend.json.parseToJsonElement(text).jsonObject }.getOrNull()) to ""
        } catch (e: kotlinx.coroutines.CancellationException) {
            throw e
        } catch (e: Exception) {
            null to (e.message ?: "")
        }

        /**
         * Verbindung live holen (Zug: Abfahrt am Start, Ausstieg nahe am Ziel, Strecke; Flug: Abflug, Ankunft).
         * Ohne Nummer null, bei Fehler ein Ergebnis mit `fehler`.
         */
        /**
         * zielBahnhof: Abschnitt mit bekanntem Ausstieg (Umstieg, Ticket) -> genau dort (target_station),
         * sonst Halt am naechsten zu den Zielkoordinaten.
         */
        suspend fun holen(r: DienstreiseZeile, zielBahnhof: String = ""): ReiseVerbindung? {
            val nummer = r.nummer
            if (nummer.isEmpty()) return null
            if (!r.flug) {
                val (daten, fehler) = aufrufen("train-validate", buildJsonObject {
                    put("train_number", nummer)
                    put("ride_date", r.datum)
                    // Zwischenhalte (ohne Start/Ziel) fuer die Halte-Liste am Abschnitt.
                    put("mit_halten", true)
                    put("start_station", r.start_name)
                    // Abfahrt erst ab der Startzeit suchen (Grenze der Bahn-API).
                    if (r.start_zeit.isNotBlank()) put("start_zeit", r.start_zeit.take(5))
                    if (zielBahnhof.isNotBlank()) put("target_station", zielBahnhof)
                    else if (r.ziel_lat != null && r.ziel_lng != null) { put("target_lat", r.ziel_lat); put("target_lng", r.ziel_lng) }
                })
                if (daten == null || (daten["valid"] as? JsonPrimitive)?.booleanOrNull != true) {
                    return ReiseVerbindung("zug", nummer, fehler = s(daten, "message").ifEmpty { fehler.ifEmpty { "Zug nicht gefunden." } })
                }
                val sum = daten["summary"] as? JsonObject
                val strecke = runCatching { daten["strecke"]!!.jsonArray }.getOrNull().orEmpty().mapNotNull { h ->
                    val ho = h as? JsonObject ?: return@mapNotNull null
                    val lat = d(ho, "lat"); val lng = d(ho, "lng")
                    if (lat == null || lng == null) null else ReiseHalt(s(ho, "name"), GeoPunkt(lat, lng))
                }
                return ReiseVerbindung(
                    art = "zug",
                    nummer = s(sum, "line_name").ifEmpty { nummer },
                    abfahrtPlan = hm(s(sum, "planned_departure").drop(11)),
                    abfahrt = s(daten, "etd_label").ifEmpty { hm(s(sum, "predicted_departure").drop(11)) },
                    gleis = s(daten, "departure_platform"),
                    gleisPlan = s(sum, "departure_platform_planned"),
                    gleisAn = s(sum, "arrival_platform"),
                    gleisAnPlan = s(sum, "arrival_platform_planned"),
                    ankunftPlan = hm(s(sum, "planned_arrival").drop(11)),
                    ankunft = s(daten, "eta_label"),
                    ankunftOrt = s(sum, "target_station_name").ifEmpty { s(daten, "target_station") },
                    strecke = strecke,
                    linie = punkte(daten["strecke_linie"]),
                    halte = zwischenhalte(daten["halte"]),
                )
            }
            val (daten, fehler) = aufrufen("flight-validate", buildJsonObject {
                put("flight_number", nummer); put("ride_date", r.datum); put("require_lufthansa_group", false)
            })
            if (daten == null || (daten["valid"] as? JsonPrimitive)?.booleanOrNull != true) {
                return ReiseVerbindung("flug", nummer, fehler = s(daten, "message").ifEmpty { fehler.ifEmpty { "Flug nicht gefunden." } })
            }
            val sum = daten["summary"] as? JsonObject
            fun uhr(v: String): String = hm(v.replace(" ", "T").split("T").getOrNull(1).orEmpty())
            val terminal = s(sum, "departure_terminal")
            val gate = s(sum, "departure_gate")
            val start = r.startPunkt
            val ziel = r.zielPunkt
            return ReiseVerbindung(
                art = "flug",
                nummer = s(sum, "flight_iata").ifEmpty { nummer },
                abfahrtPlan = uhr(s(sum, "scheduled_departure_local")),
                abfahrt = uhr(s(sum, "actual_departure_local").ifEmpty { s(sum, "estimated_departure_local") }.ifEmpty { s(sum, "scheduled_departure_local") }),
                gleis = listOfNotNull(terminal.ifEmpty { null }?.let { "Terminal $it" }, gate.ifEmpty { null }?.let { "Gate $it" }).joinToString(" · "),
                ankunftPlan = uhr(s(sum, "scheduled_arrival_local")),
                ankunft = uhr(s(sum, "actual_arrival_local").ifEmpty { s(sum, "estimated_arrival_local") }.ifEmpty { s(sum, "scheduled_arrival_local") }),
                ankunftOrt = s(sum, "arrival_airport"),
                // Flug: Bogen vom Start zum Ziel der Dienstreise (wie die Flugbahn bei Fahrten).
                strecke = if (start != null && ziel != null) listOf(ReiseHalt(r.start_name, start), ReiseHalt(r.ziel_name, ziel)) else emptyList(),
            )
        }
    }
}

/**
 * Abschnitt einer Dienstreise mit Umstiegen (Tabelle dienstreise_abschnitt, Migration 20261114010000):
 * Bus, U-Bahn, Tram, S-Bahn, Zug oder Flug mit Nummer, von/nach, Zeiten und Gleisen.
 */
@Serializable
data class DienstreiseAbschnitt(
    val id: String,
    val dienstreise_id: String,
    val reihenfolge: Int = 0,
    val art: String = "zug",
    val nummer: String? = null,
    val von_name: String = "",
    val von_lat: Double? = null,
    val von_lng: Double? = null,
    val ab_datum: String? = null,
    val ab_zeit: String? = null,
    val gleis_ab: String? = null,
    val nach_name: String? = null,
    val nach_lat: Double? = null,
    val nach_lng: Double? = null,
    val an_datum: String? = null,
    val an_zeit: String? = null,
    val gleis_an: String? = null,
    val hinweis: String? = null,
    /**
     * Linie [[lng, lat], ...] vom Server (Edge Function abschnitt-linie): Bus entlang der Strassen,
     * U-Bahn/Tram entlang der Gleise. Null, solange keine da ist (oder die Spalte fehlt).
     */
    val linie: List<List<Double>>? = null,
) {
    val von: GeoPunkt? get() = if (von_lat != null && von_lng != null) GeoPunkt(von_lat, von_lng) else null
    val nach: GeoPunkt? get() = if (nach_lat != null && nach_lng != null) GeoPunkt(nach_lat, nach_lng) else null

    /** Als Dienstreise fuer die Live-Abfrage (useAbschnittVerbindungen im Web). */
    fun alsReise(datum: String): DienstreiseZeile = DienstreiseZeile(
        id = id, datum = ab_datum?.ifBlank { null } ?: datum, start_zeit = ab_zeit.orEmpty(),
        start_name = von_name, start_lat = von_lat, start_lng = von_lng,
        ziel_name = nach_name.orEmpty(), ziel_lat = nach_lat, ziel_lng = nach_lng,
        zugnummer = if (art == "flug") null else nummer, flugnummer = if (art == "flug") nummer else null,
    )

    companion object {
        /** Graues Icon je Art (abschnittIcon im Web). */
        fun icon(art: String): String = when (art) {
            "bus" -> "Bus_Trisar_Icons_01_grau"
            "ubahn", "tram" -> "U_Bahn_Trisar_Icons_01_grau"
            "flug" -> "Plain_Abflug_Trisar_Icons_01_grau"
            else -> "Bahnhof_Zug_Trisar_Icons_01_grau"
        }

        /** Live-Abfrage nur fuer Zug, S-Bahn und Flug (Bus/U-Bahn/Tram: Zeiten aus dem Ticket). */
        fun mitLive(art: String): Boolean = art == "zug" || art == "sbahn" || art == "flug"

        /** Art aus der Nummer (abschnittArt im Web). */
        fun artAus(nummer: String): String {
            val n = nummer.trim().uppercase()
            if (n.isEmpty()) return "zug"
            if (Regex("^BUS\\b").containsMatchIn(n)) return "bus"
            if (Regex("^U\\s?\\d|^U-?BAHN").containsMatchIn(n)) return "ubahn"
            if (Regex("^(STR|TRAM)\\b").containsMatchIn(n)) return "tram"
            if (Regex("^S\\s?\\d").containsMatchIn(n)) return "sbahn"
            if (Regex("^(ICE|IC|EC|ECE|RJX?|NJ|EN|TGV|FLX|WB|RE|RB|IRE|MEX|ALX|BRB|ARV|ERB|AG)\\s?\\d").containsMatchIn(n)) return "zug"
            if (Regex("^[A-Z0-9]{2}\\s?\\d{1,4}[A-Z]?$").containsMatchIn(n)) return "flug"
            return "zug"
        }

        /**
         * Verspaetung in Minuten (Ist minus Plan, HH:MM), ueber Mitternacht gerechnet (verspaetungMin im Web).
         * 0 wenn puenktlich oder unbekannt, negativ wenn zu frueh.
         */
        fun verspaetung(plan: String?, ist: String?): Int {
            val p = minuten(plan) ?: return 0
            val i = minuten(ist) ?: return 0
            var d = i - p
            if (d < -720) d += 1440
            if (d > 720) d -= 1440
            // Negativ = zu frueh (14.11.: gruene Kachel "-2").
            return d
        }

        /** "HH:MM" -> Minuten des Tages, sonst null. */
        fun minuten(hhmm: String?): Int? {
            val m = Regex("^(\\d{1,2}):(\\d{2})").find(hhmm.orEmpty()) ?: return null
            return m.groupValues[1].toInt() * 60 + m.groupValues[2].toInt()
        }
    }
}

/**
 * Ticket-Ablage (Speicher dienstreise-tickets, privat) ueber die Storage-Schnittstelle von Supabase:
 * hochladen (Dispo), Link fuer eine Stunde (Dispo und Fahrer) und im PDF-Betrachter oeffnen.
 */
object TicketAblage {
    const val SPEICHER = "dienstreise-tickets"

    private suspend fun token(): String =
        Backend.client.auth.currentAccessTokenOrNull() ?: Konfig.SUPABASE_KEY

    private fun pfadKodiert(pfad: String) = pfad.split("/").joinToString("/") { java.net.URLEncoder.encode(it, "UTF-8").replace("+", "%20") }

    /** Datei hochladen (ueberschreibt). Fehlertext oder leer. */
    suspend fun hochladen(pfad: String, daten: ByteArray, typ: String): String {
        val t = token()
        return kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
            runCatching {
                val c = java.net.URL("${Konfig.SUPABASE_URL}/storage/v1/object/$SPEICHER/${pfadKodiert(pfad)}").openConnection() as java.net.HttpURLConnection
                c.requestMethod = "POST"
                c.doOutput = true
                c.setRequestProperty("Authorization", "Bearer $t")
                c.setRequestProperty("apikey", Konfig.SUPABASE_KEY)
                c.setRequestProperty("Content-Type", typ)
                c.setRequestProperty("x-upsert", "true")
                c.outputStream.use { it.write(daten) }
                val code = c.responseCode
                if (code in 200..299) "" else (c.errorStream?.bufferedReader()?.readText() ?: "Status $code")
            }.getOrElse { it.message ?: "Hochladen fehlgeschlagen" }
        }
    }

    /** Signierter Link (1 Stunde) oder leer. */
    suspend fun link(pfad: String?): String {
        if (pfad.isNullOrBlank()) return ""
        val t = token()
        return kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
            runCatching {
                val c = java.net.URL("${Konfig.SUPABASE_URL}/storage/v1/object/sign/$SPEICHER/${pfadKodiert(pfad)}").openConnection() as java.net.HttpURLConnection
                c.requestMethod = "POST"
                c.doOutput = true
                c.setRequestProperty("Authorization", "Bearer $t")
                c.setRequestProperty("apikey", Konfig.SUPABASE_KEY)
                c.setRequestProperty("Content-Type", "application/json")
                c.outputStream.use { it.write("{\"expiresIn\":3600}".toByteArray()) }
                if (c.responseCode !in 200..299) return@runCatching ""
                val o = Backend.json.parseToJsonElement(c.inputStream.bufferedReader().readText()).jsonObject
                val rel = ((o["signedURL"] ?: o["signedUrl"]) as? JsonPrimitive)?.content.orEmpty()
                when {
                    rel.isEmpty() -> ""
                    rel.startsWith("http") -> rel
                    else -> "${Konfig.SUPABASE_URL}/storage/v1" + (if (rel.startsWith("/")) rel else "/$rel")
                }
            }.getOrDefault("")
        }
    }

    /** Im PDF-Betrachter oeffnen, sonst im Browser. */
    fun oeffnen(ctx: android.content.Context, url: String) {
        val uri = android.net.Uri.parse(url)
        val pdf = android.content.Intent(android.content.Intent.ACTION_VIEW).setDataAndType(uri, "application/pdf")
            .addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
        try {
            ctx.startActivity(pdf)
        } catch (e: android.content.ActivityNotFoundException) {
            runCatching { ctx.startActivity(android.content.Intent(android.content.Intent.ACTION_VIEW, uri).addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)) }
        }
    }
}

/**
 * Gleis live gegen Ticket bzw. Fahrplan (15.11.): gleis = aktuell, vorher = altes Gleis, leer wenn unveraendert.
 * Ohne Live-Gleis bleibt das Ticket-Gleis. Gleich in iOS (DienstreiseVerbindung.gleisStand) und Web (gleisStand).
 */
data class GleisStand(val gleis: String, val vorher: String) {
    val geaendert: Boolean get() = vorher.isNotEmpty()
    /** "Gleis 9 statt 7" bzw. "Gleis 9", leer ohne Gleis. */
    val text: String get() = when {
        gleis.isEmpty() -> ""
        geaendert -> "Gleis $gleis statt $vorher"
        else -> "Gleis $gleis"
    }

    companion object {
        fun von(live: String?, ticket: String?, fahrplan: String?): GleisStand {
            val l = live.orEmpty().trim()
            val t = ticket.orEmpty()
            val plan = t.ifEmpty { fahrplan.orEmpty() }
            if (l.isEmpty()) return GleisStand(t, "")
            return GleisStand(l, if (plan.isNotEmpty() && plan != l) plan else "")
        }
    }
}
