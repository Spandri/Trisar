package de.trisar.dispo.fahrten

import de.trisar.kern.Backend
import io.github.jan.supabase.exceptions.RestException
import io.github.jan.supabase.functions.functions
import io.ktor.client.statement.bodyAsText
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

/**
 * Edge-Functions und Adresssuche wie in admin/src/App.jsx (FahrtPruefung.swift):
 * places-proxy (dann OpenStreetMap, dann feste Liste), flight-validate, train-validate, external-sync.
 */
object FahrtPruefung {

    sealed interface Aufruf {
        data class Ok(val daten: JsonElement) : Aufruf
        /** voruebergehend: im Web liefert jeder Nicht-2xx-Status "Edge Function returned a non-2xx status code". */
        data class Fehler(val text: String, val voruebergehend: Boolean, val status: Int?) : Aufruf
    }

    suspend fun aufrufen(name: String, body: JsonObject): Aufruf = try {
        val antwort = Backend.client.functions.invoke(name, body)
        val text = antwort.bodyAsText()
        Aufruf.Ok(if (text.isBlank()) JsonNull else Json.parseToJsonElement(text))
    } catch (e: RestException) {
        Aufruf.Fehler("Edge Function returned a non-2xx status code", true, e.statusCode)
    } catch (e: kotlinx.coroutines.CancellationException) {
        throw e
    } catch (e: Exception) {
        Aufruf.Fehler(e.message ?: "", false, null)
    }

    // MARK: Adressvorschlaege (handleFetchPlaceSuggestions)

    private val festeOrte = listOf(
        "Flughafen München (MUC), Nordallee, München-Flughafen, Deutschland",
        "Flughafen Hamburg (HAM), Flughafenstraße, Hamburg, Deutschland",
        "Flughafen Berlin Brandenburg (BER), Willy-Brandt-Platz, Schönefeld, Deutschland",
        "Flughafen Frankfurt am Main (FRA), Frankfurt am Main, Deutschland",
        "Flughafen Stuttgart (STR), Flughafenstraße, Stuttgart, Deutschland",
        "Flughafen Düsseldorf (DUS), Flughafenstraße, Düsseldorf, Deutschland",
        "Hauptbahnhof München, Bayerstraße, München, Deutschland",
        "Hauptbahnhof Hamburg, Hachmannplatz, Hamburg, Deutschland",
        "Hauptbahnhof Berlin, Europaplatz, Berlin, Deutschland",
        "Hotel Bayerischer Hof, Promenadeplatz 2-6, München, Deutschland",
    )

    private fun festeVorschlaege(eingabe: String): List<String> {
        val q = FahrtText.ortNormal(eingabe)
        if (q.isEmpty()) return emptyList()
        return festeOrte.filter { FahrtText.ortNormal(it).contains(q) }.take(8)
    }

    /** Vor dem Speichern: Hinweis, wenn eine Adresse fehlt oder nicht zur Fahrt passt, sonst leer. */
    suspend fun adressWarnung(adressen: List<String>): String {
        val liste = adressen.map { FahrtText.getrimmt(it) }.filter { it.isNotEmpty() }
        val r = aufrufen("places-proxy", buildJsonObject {
            put("aktion", "adressen_pruefen")
            put("adressen", JsonArray(liste.map { JsonPrimitive(it) }))
        })
        if (r !is Aufruf.Ok) return ""
        val warnungen = (r.daten as? JsonObject)?.get("warnungen") as? JsonArray ?: return ""
        return warnungen.mapNotNull { w ->
            val o = w as? JsonObject ?: return@mapNotNull null
            val adresse = s(o, "adresse")
            when (s(o, "grund")) {
                "nicht_gefunden" -> FahrtText.tr("fahrt.adresseNichtGefunden", mapOf("adresse" to adresse))
                "weit_weg" -> FahrtText.tr("fahrt.adresseWeitWeg", mapOf("adresse" to adresse, "km" to s(o, "km")))
                else -> FahrtText.tr("fahrt.adresseOhneStadt", mapOf("adresse" to adresse))
            }
        }.joinToString("\n")
    }

    suspend fun ortsVorschlaege(eingabe: String): List<String> {
        val text = FahrtText.getrimmt(eingabe)
        if (text.isEmpty()) return emptyList()
        val r = aufrufen("places-proxy", buildJsonObject { put("input", text); put("country", "de") })
        if (r is Aufruf.Ok) {
            val treffer = ((r.daten as? JsonObject)?.get("predictions") as? JsonArray ?: JsonArray(emptyList()))
                .mapNotNull { (it as? JsonObject)?.let { o -> s(o, "description") } }
                .filter { it.isNotEmpty() }
            val api = treffer.distinct().take(8)
            if (api.isNotEmpty()) return api
        }
        val osm = osmVorschlaege(text)
        if (osm.isNotEmpty()) return osm
        return festeVorschlaege(text)
    }

    /** fetchOsmPlaceSuggestions + formatOsmEntry: "Name, Strasse Nr, Ort". */
    private suspend fun osmVorschlaege(text: String): List<String> = withContext(Dispatchers.IO) {
        runCatching {
            val q = URLEncoder.encode(text, "UTF-8")
            val verbindung = URL("https://nominatim.openstreetmap.org/search?format=jsonv2&limit=8&addressdetails=1&q=$q").openConnection() as HttpURLConnection
            verbindung.setRequestProperty("Accept", "application/json")
            // Nominatim verlangt eine Kennung der App.
            verbindung.setRequestProperty("User-Agent", "TRISAR-Dispo-Android/0.1")
            verbindung.connectTimeout = 8000
            verbindung.readTimeout = 8000
            if (verbindung.responseCode != 200) return@runCatching emptyList<String>()
            val liste = Json.parseToJsonElement(verbindung.inputStream.bufferedReader().readText()) as? JsonArray ?: return@runCatching emptyList<String>()
            val namen = liste.mapNotNull { eintrag ->
                val e = eintrag as? JsonObject ?: return@mapNotNull null
                val a = e["address"] as? JsonObject
                fun w(k: String) = a?.let { s(it, k) } ?: ""
                val strasse = listOf(w("road"), w("pedestrian"), w("footway"), w("path"), w("square")).firstOrNull { it.isNotEmpty() } ?: ""
                val nr = w("house_number")
                val ort = listOf(w("city"), w("town"), w("village"), w("municipality"), w("county")).firstOrNull { it.isNotEmpty() } ?: ""
                val strasseTeil = listOf(strasse, nr).filter { it.isNotEmpty() }.joinToString(" ")
                val name = s(e, "name")
                val nameIstAdresse = name.isEmpty() || name == strasse || name == strasseTeil || name.first().isDigit() || name == ort
                val label = (if (nameIstAdresse) listOf(strasseTeil, ort) else listOf(name, strasseTeil, ort)).filter { it.isNotEmpty() }.joinToString(", ")
                label.ifEmpty { s(e, "display_name") }.ifEmpty { null }
            }
            namen.distinct().take(8)
        }.getOrDefault(emptyList())
    }

    // MARK: Flug / Zug pruefen

    data class FlugKandidat(val abflug: String, val ankunft: String, val ankunftGeplant: String)

    /** Ergebnis von validateFlightForDisplay / validateTrainForDisplay. */
    data class Anzeige(
        val status: String = "empty",
        val etaLabel: String = "",
        val gueltig: Boolean = false,
        val startOrt: String = "",
        val kandidaten: List<FlugKandidat> = emptyList(),
    ) { companion object { val leer = Anzeige() } }

    /** Ergebnis von validateFlightForSave / validateTrainForSave. */
    data class ZumSpeichern(val ok: Boolean = true, val gueltig: Boolean = false, val fehler: String? = null, val daten: JsonElement? = null)

    private suspend fun flugAufruf(nummer: String, datum: String, hinweis: String, ankunft: String): Aufruf {
        val rohHinweis = FahrtText.getrimmt(hinweis).uppercase()
        var code = FahrtText.flughafenCode(hinweis)
        if (code.isEmpty() && Regex("^[A-Z]{3}$").matches(rohHinweis)) code = rohHinweis
        val geplant = FahrtText.getrimmt(ankunft)
        val body = buildJsonObject {
            put("flight_number", FahrtText.nummer(nummer))
            put("ride_date", datum)
            put("require_lufthansa_group", false)
            if (code.isNotEmpty()) put("target_airport_iata", code)
            if (geplant.isNotEmpty()) put("selected_arrival_scheduled", geplant)
        }
        var ergebnis = aufrufen("flight-validate", body)
        // shouldUseAdminFallbackForInvokeError: bei 5xx ein zweiter Versuch.
        if (ergebnis is Aufruf.Fehler && (ergebnis.status ?: 0) >= 500) ergebnis = aufrufen("flight-validate", body)
        return ergebnis
    }

    private suspend fun zugAufruf(nummer: String, datum: String, hinweis: String): Aufruf =
        aufrufen("train-validate", buildJsonObject {
            put("train_number", FahrtText.nummer(nummer))
            put("ride_date", datum)
            put("target_station", FahrtText.getrimmt(hinweis))
        })

    /** Textwert eines Felds, wie stringValue in iOS (Zahlen zaehlen nicht). */
    internal fun s(o: JsonObject?, k: String): String {
        val w = o?.get(k) as? JsonPrimitive ?: return ""
        if (w is JsonNull || !w.isString) return ""
        return w.content.trim()
    }

    private fun gueltigFeld(o: JsonObject?): Boolean = (o?.get("valid") as? JsonPrimitive)?.let { if (it is JsonNull) null else it.booleanOrNull } == true

    suspend fun flugAnzeige(nummer: String, datum: String, hinweis: String, ankunftGeplant: String): Anzeige {
        val n = FahrtText.nummer(nummer)
        if (n.isEmpty()) return Anzeige.leer
        if (!FahrtText.flugnummerGueltig(n)) return Anzeige(status = "invalid", etaLabel = "NaN")
        val tag = FahrtText.fahrtDatum(datum)
        if (tag.isEmpty()) return Anzeige(status = "missing_date", etaLabel = "NaN")
        return when (val r = flugAufruf(n, tag, hinweis, ankunftGeplant)) {
            is Aufruf.Fehler -> if (r.voruebergehend) Anzeige(status = "unavailable", etaLabel = "Srv") else Anzeige(status = "error", etaLabel = "NaN")
            is Aufruf.Ok -> {
                val d = r.daten as? JsonObject
                if (s(d, "reason") == "multiple_matches") {
                    val kandidaten = (d?.get("candidates") as? JsonArray ?: JsonArray(emptyList())).map { k ->
                        val o = k as? JsonObject
                        FlugKandidat(s(o, "departure_airport"), s(o, "arrival_airport"), s(o, "scheduled_arrival_local"))
                    }
                    return Anzeige(status = "multi", etaLabel = "Multi", kandidaten = kandidaten)
                }
                if (!gueltigFeld(d)) {
                    val ava = s(d, "provider") == "aviationstack" || s(d, "fallback_reason").isNotEmpty()
                    return Anzeige(status = "invalid", etaLabel = if (ava) "AVA" else "NaN")
                }
                val summary = d?.get("summary") as? JsonObject
                val eta = etaAusFlug(summary)
                val ort = ankunftsOrt(summary)
                if (eta.isEmpty()) Anzeige(status = "unknown_eta", etaLabel = if (s(d, "provider") == "aviationstack") "AVA" else "NaN", gueltig = true, startOrt = ort)
                else Anzeige(status = "ok", etaLabel = eta, gueltig = true, startOrt = ort)
            }
        }
    }

    suspend fun zugAnzeige(nummer: String, datum: String, hinweis: String): Anzeige {
        val n = FahrtText.nummer(nummer)
        if (n.isEmpty()) return Anzeige.leer
        if (!FahrtText.zugnummerGueltig(n)) return Anzeige(status = "invalid", etaLabel = "NaN")
        val tag = FahrtText.fahrtDatum(datum)
        if (tag.isEmpty()) return Anzeige(status = "missing_date", etaLabel = "NaN")
        return when (val r = zugAufruf(n, tag, hinweis)) {
            is Aufruf.Fehler -> Anzeige(status = "error", etaLabel = "NaN")
            is Aufruf.Ok -> {
                val d = r.daten as? JsonObject
                if (s(d, "reason") == "multiple_matches") return Anzeige(status = "multi", etaLabel = "Multi")
                if (!gueltigFeld(d)) return Anzeige(status = "invalid", etaLabel = "NaN")
                val eta = s(d, "eta_label")
                val ort = s(d, "target_station")
                if (eta.isEmpty()) Anzeige(status = "unknown_eta", etaLabel = "NaN", gueltig = true, startOrt = ort)
                else Anzeige(status = "ok", etaLabel = eta, gueltig = true, startOrt = ort)
            }
        }
    }

    suspend fun flugZumSpeichern(nummer: String, datum: String, hinweis: String, ankunftGeplant: String): ZumSpeichern {
        val n = FahrtText.nummer(nummer)
        if (n.isEmpty()) return ZumSpeichern()
        if (!FahrtText.flugnummerGueltig(n)) return ZumSpeichern(ok = false, fehler = FahrtText.tr("app.ungueltigeFlugnummer"))
        val tag = FahrtText.fahrtDatum(datum)
        if (tag.isEmpty()) return ZumSpeichern(ok = false, fehler = FahrtText.tr("app.flugDatumFehlt"))
        return when (val r = flugAufruf(n, tag, hinweis, ankunftGeplant)) {
            // Flugdienst gerade nicht erreichbar: Fahrt ohne Flugnummer speichern wie im Web.
            is Aufruf.Fehler -> if (r.voruebergehend) ZumSpeichern()
            else ZumSpeichern(ok = false, fehler = FahrtText.tr("app.flugpruefungFehlgeschlagen", mapOf("error" to r.text)))
            is Aufruf.Ok -> {
                val d = r.daten as? JsonObject
                if (!gueltigFeld(d)) {
                    val text = s(d, "message")
                    ZumSpeichern(ok = false, fehler = text.ifEmpty { FahrtText.tr("app.flugNichtValidierbar") })
                } else ZumSpeichern(gueltig = true, daten = r.daten)
            }
        }
    }

    suspend fun zugZumSpeichern(nummer: String, datum: String, hinweis: String): ZumSpeichern {
        val n = FahrtText.nummer(nummer)
        if (n.isEmpty()) return ZumSpeichern()
        if (!FahrtText.zugnummerGueltig(n)) return ZumSpeichern(ok = false, fehler = FahrtText.tr("app.ungueltigeZugnummer"))
        val tag = FahrtText.fahrtDatum(datum)
        if (tag.isEmpty()) return ZumSpeichern(ok = false, fehler = FahrtText.tr("app.zugDatumFehlt"))
        return when (val r = zugAufruf(n, tag, hinweis)) {
            is Aufruf.Fehler -> ZumSpeichern(ok = false, fehler = FahrtText.tr("app.zugpruefungFehlgeschlagen", mapOf("error" to r.text)))
            is Aufruf.Ok -> {
                val d = r.daten as? JsonObject
                when {
                    s(d, "reason") == "multiple_matches" -> ZumSpeichern(ok = false, fehler = FahrtText.tr("app.mehrereZuegeGefunden"))
                    !gueltigFeld(d) -> ZumSpeichern(ok = false, fehler = s(d, "message").ifEmpty { FahrtText.tr("app.zugNichtValidierbar") })
                    else -> ZumSpeichern(gueltig = true, daten = r.daten)
                }
            }
        }
    }

    /** extractEtaFromFlightSummary */
    private fun etaAusFlug(summary: JsonObject?): String {
        val roh = listOf(s(summary, "estimated_arrival_local"), s(summary, "actual_arrival_local"), s(summary, "scheduled_arrival_local"))
            .firstOrNull { it.isNotEmpty() } ?: return ""
        Regex("""T\d{2}:\d{2}""").find(roh)?.let { return it.value.drop(1) }
        Regex("""^\d{1,2}:\d{2}""").find(roh)?.let { return FahrtText.uhrzeit(it.value, "") }
        return ""
    }

    /** extractArrivalLocationFromFlightSummary */
    private fun ankunftsOrt(summary: JsonObject?): String {
        val flughafen = s(summary, "arrival_airport")
        val terminal = s(summary, "arrival_terminal")
        if (flughafen.isEmpty() && terminal.isEmpty()) return ""
        if (flughafen.isNotEmpty() && terminal.isNotEmpty()) return "$flughafen Terminal $terminal"
        return if (flughafen.isEmpty()) "Terminal $terminal" else flughafen
    }

    // MARK: Zugzeiten (resolveTrainEtdValues, buildTrainLivePayload)

    data class ZugZeiten(val geplant: String = "", val erwartet: String = "", val etd: String = "", val etdOriginal: String = "")

    fun zugZeiten(daten: JsonElement?, startZeit: String): ZugZeiten {
        val d = daten as? JsonObject
        val summary = d?.get("summary") as? JsonObject
        val etaLabel = s(d, "eta_label")
        val erwartet = FahrtText.uhrzeit(etaLabel.ifEmpty { FahrtText.uhrAusISO(s(summary, "predicted_arrival")) }, "")
        val geplant = FahrtText.uhrzeit(FahrtText.uhrAusISO(s(summary, "planned_arrival")), "")
        val rueckfall = FahrtText.uhrzeit(startZeit, "")
        val etd = listOf(erwartet, rueckfall, geplant).firstOrNull { it.isNotEmpty() } ?: ""
        val original = listOf(geplant, rueckfall, etd).firstOrNull { it.isNotEmpty() } ?: ""
        return ZugZeiten(geplant, erwartet, etd, original)
    }

    fun zugLiveDaten(daten: JsonElement?, abgerufen: String): JsonElement {
        val d = daten as? JsonObject
        val summary = d?.get("summary") as? JsonObject
        val live = d?.get("live_tracking") as? JsonObject
        fun liste(w: JsonElement?): JsonArray? = (w as? JsonArray)?.let { a ->
            JsonArray(a.map { e -> ((e as? JsonPrimitive)?.takeIf { it !is JsonNull }?.content ?: "").trim() }.filter { it.isNotEmpty() }.map { JsonPrimitive(it) })
        }
        val halte = liste(summary?.get("route_stops")) ?: liste(live?.get("route_stops")) ?: JsonArray(emptyList())
        fun textOderNull(t: String): JsonElement = if (t.isEmpty()) JsonNull else JsonPrimitive(t)
        // Number(x): Zahl oder Zahl-als-Text, sonst null.
        fun zahl(w: JsonElement?): JsonElement = (w as? JsonPrimitive)?.takeIf { it !is JsonNull }?.content?.trim()?.toDoubleOrNull()?.let { JsonPrimitive(it) } ?: JsonNull
        val zugNr = s(summary, "train_number")
        val liveObjekt: JsonElement = if (live != null) {
            val rufname = listOf(s(live, "callsign"), s(summary, "line_name"), zugNr).firstOrNull { it.isNotEmpty() } ?: ""
            val zeit = s(live, "captured_at")
            buildJsonObject {
                put("provider", "deutsche_bahn_api")
                put("mode", "train")
                put("callsign", textOderNull(rufname))
                put("radar_hex", JsonNull)
                put("latitude", zahl(live["latitude"]))
                put("longitude", zahl(live["longitude"]))
                put("heading_deg", zahl(live["heading_deg"]))
                put("captured_at", zeit.ifEmpty { abgerufen })
                put("on_ground", false)
                put("trail_points", live["trail_points"] as? JsonArray ?: JsonArray(emptyList()))
                put("route_stops", halte)
            }
        } else JsonNull
        return buildJsonObject {
            put("provider", "deutsche_bahn_api")
            put("fetched_at", abgerufen)
            put("summary", buildJsonObject {
                put("provider", "deutsche_bahn_api")
                put("flight_iata", textOderNull(zugNr))
                put("operating_carrier", "DB")
                put("operating_flight_number", textOderNull(zugNr))
                put("marketing_carrier", "DB")
                put("marketing_flight_number", textOderNull(zugNr))
                put("flight_status_code", JsonNull)
                put("flight_status_description", "Train live tracking")
                for (k in listOf("departure_airport", "departure_terminal", "departure_gate")) put(k, JsonNull)
                put("arrival_airport", textOderNull(s(summary, "target_station_name")))
                put("arrival_terminal", JsonNull)
                put("arrival_gate", JsonNull)
                for (k in listOf("scheduled_departure_local", "estimated_departure_local", "actual_departure_local")) put(k, JsonNull)
                put("scheduled_arrival_local", textOderNull(s(summary, "planned_arrival")))
                put("estimated_arrival_local", textOderNull(s(summary, "predicted_arrival")))
                put("actual_arrival_local", JsonNull)
                for (k in listOf("aircraft_code", "aircraft_registration", "aircraft_icao24", "delay_minutes")) put(k, JsonNull)
                put("route_stops", halte)
            })
            put("live_tracking", liveObjekt)
        }
    }

    // MARK: external-sync (invokeExternalSyncForJob)

    suspend fun externerAbgleich(fahrtID: String, grund: String): Boolean =
        aufrufen("external-sync", buildJsonObject {
            put("reason", grund)
            put("job_ids", buildJsonArray { add(JsonPrimitive(fahrtID.lowercase())) })
            put("force_refresh", true)
        }) is Aufruf.Ok
}
