package de.trisar.dispo.einlesen

import de.trisar.kern.Backend
import io.github.jan.supabase.exceptions.RestException
import io.github.jan.supabase.functions.functions
import io.ktor.client.plugins.timeout
import io.ktor.client.request.setBody
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.contentType
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.put
import java.time.LocalDate
import java.time.ZoneOffset

/** Fahrten (mode rides) oder Fahrgaeste (mode guests), wie in ImportView.jsx. */
enum class ImportModus { FAHRTEN, GAESTE }

/** Fehlercode aus dispo-admin ({"error": code}) oder Fehlertext. */
class ImportFehler(val code: String) : Exception(code)

/**
 * Excel-/CSV-Import ueber die Funktion dispo-admin (Aktionen import_*), wie admin/src/services/importDienst.js.
 * Datei lesen, Blatt waehlen, Spalten erkennen (Vorlage, Regeln, Llama), Dubletten und Import laufen auf dem Server.
 */
object ImportDienst {
    fun modusText(m: ImportModus): String = if (m == ImportModus.GAESTE) "guests" else "rides"

    // MARK: Datenmodell der Antworten

    class Blatt(val index: Int, val name: String)

    class Spalte(
        val index: Int,
        val titel: String,
        val ohneTitel: Boolean,
        val beispiele: List<String>,
        val vorschlag: String?,
        val sicherheit: Double,
        val grundVorlage: Boolean,
        val grundLlama: Boolean,
        val grundKopf: String?,
        val grundWerte: String?,
        val grundAnteil: Int,
    )

    /** Ein Datensatz der Vorschau. `aus` = nicht mit importieren. */
    data class Satz(
        val zeilen: List<Int>,
        val daten: JsonObject,
        val fehlt: List<String>,
        val hinweise: List<String>,
        val aus: Boolean = false,
    )

    class Analyse(
        val dateiname: String,
        val blaetter: List<Blatt>,
        val blatt: Int,
        val signatur: String,
        val vorlageGenutzt: Boolean,
        val vorlageName: String,
        val felder: List<String>,
        val spalten: List<Spalte>,
        val zuordnung: Map<Int, String>,
        val fehlendeZuordnung: List<String>,
        val datensaetze: List<Satz>,
        val llamaGenutzt: Boolean,
    )

    class Adresse(val gefunden: Boolean, val name: String)

    class Eintrag(val id: String, val dateiname: String, val anzahl: Int, val erstellt: String, val rueckgaengig: Boolean, val vorhanden: Int)

    class Ergebnis(val importId: String?, val anzahl: Int)

    class Rueckgaengig(val geloescht: Int, val behalten: Int)

    // MARK: Aufruf

    /**
     * dispo-admin mit JSON-Koerper. Fehler kommen als HTTP-Fehler mit {"error": code} und werden zu [ImportFehler].
     * Eigene Zeitgrenze, weil die Erkennung mit Llama bis zu 45 s dauert (Standard im Client sind 10 s).
     */
    private suspend fun aufruf(koerper: JsonObject, zeitMs: Long = 60_000): JsonObject {
        val text = try {
            Backend.client.functions.invoke("dispo-admin") {
                contentType(ContentType.Application.Json)
                setBody(koerper.toString())
                timeout { requestTimeoutMillis = zeitMs; socketTimeoutMillis = zeitMs }
            }.bodyAsText()
        } catch (e: kotlinx.coroutines.CancellationException) {
            throw e
        } catch (e: Exception) {
            var t = e.message ?: e.toString()
            if (e is RestException) {
                val roh = e.error
                t = runCatching { (Backend.json.parseToJsonElement(roh).jsonObject["error"] as? JsonPrimitive)?.content }.getOrNull()
                    ?.takeIf { it.isNotEmpty() } ?: roh.ifEmpty { t }
            }
            throw ImportFehler(t.trim())
        }
        return runCatching { Backend.json.parseToJsonElement(text).jsonObject }.getOrElse { throw ImportFehler("antwort_unlesbar") }
    }

    suspend fun analysieren(modus: ImportModus, datei: String, dateiname: String, blatt: Int?, zuordnung: Map<Int, String>?): Analyse {
        val koerper = buildJsonObject {
            put("aktion", "import_analysieren")
            put("modus", modusText(modus))
            put("datei", datei)
            put("dateiname", dateiname)
            put("blatt", blatt?.let { JsonPrimitive(it) } ?: JsonNull)
            put("zuordnung", zuordnung?.let { z -> JsonObject(z.entries.associate { "${it.key}" to JsonPrimitive(it.value) }) } ?: JsonNull)
        }
        return analyseLesen(aufruf(koerper, 120_000))
    }

    /** import_adressen: Adresse -> gefunden/Name. */
    suspend fun adressenPruefen(adressen: List<String>): Map<String, Adresse> {
        if (adressen.isEmpty()) return emptyMap()
        val koerper = buildJsonObject {
            put("aktion", "import_adressen")
            put("adressen", JsonArray(adressen.map { JsonPrimitive(it) }))
            put("stadt", "München")
        }
        val r = aufruf(koerper, 300_000)["adressen"] as? JsonObject ?: return emptyMap()
        return r.mapValues { (_, w) ->
            val o = w as? JsonObject
            Adresse(o?.get("gefunden")?.let { (it as? JsonPrimitive)?.booleanOrNull } ?: false, str(o?.get("name")))
        }
    }

    suspend fun ausfuehren(modus: ImportModus, datensaetze: List<JsonObject>, dateiname: String, signatur: String, vorlage: Map<String, String>): Ergebnis {
        val koerper = buildJsonObject {
            put("aktion", "import_ausfuehren")
            put("modus", modusText(modus))
            put("datensaetze", JsonArray(datensaetze))
            put("dateiname", dateiname)
            put("signatur", signatur)
            put("vorlage", JsonObject(vorlage.mapValues { JsonPrimitive(it.value) }))
        }
        val r = aufruf(koerper, 120_000)
        return Ergebnis(str(r["import_id"]).ifEmpty { null }, zahl(r["anzahl"]))
    }

    suspend fun liste(modus: ImportModus): List<Eintrag> {
        val r = aufruf(buildJsonObject { put("aktion", "import_liste"); put("modus", modusText(modus)) })
        return (r["importe"] as? JsonArray).orEmpty().mapNotNull { e ->
            val o = e as? JsonObject ?: return@mapNotNull null
            val rueck = o["rueckgaengig"]
            Eintrag(
                id = str(o["id"]),
                dateiname = str(o["dateiname"]),
                anzahl = zahl(o["anzahl"]),
                erstellt = str(o["erstellt"]),
                rueckgaengig = rueck != null && rueck !is JsonNull && str(rueck).isNotEmpty(),
                vorhanden = zahl(o["vorhanden"]),
            )
        }
    }

    suspend fun rueckgaengig(importId: String): Rueckgaengig {
        val r = aufruf(buildJsonObject { put("aktion", "import_rueckgaengig"); put("import_id", importId) })
        return Rueckgaengig(zahl(r["geloescht"]), zahl(r["behalten"]))
    }

    // MARK: Antwort lesen

    private fun str(w: JsonElement?): String = (w as? JsonPrimitive)?.takeIf { it !is JsonNull }?.content ?: ""
    private fun zahl(w: JsonElement?): Int = (w as? JsonPrimitive)?.let { it.intOrNull ?: it.doubleOrNull?.toInt() } ?: 0
    private fun strListe(w: JsonElement?): List<String> = (w as? JsonArray).orEmpty().mapNotNull { (it as? JsonPrimitive)?.takeIf { p -> p !is JsonNull }?.content }

    private fun analyseLesen(a: JsonObject): Analyse {
        val zuordnung = (a["zuordnung"] as? JsonObject).orEmpty().mapNotNull { (k, v) ->
            val i = k.toIntOrNull() ?: return@mapNotNull null
            val f = str(v).ifEmpty { return@mapNotNull null }
            i to f
        }.toMap()
        val vorlage = a["vorlage"] as? JsonObject
        val llama = a["llama"] as? JsonObject
        return Analyse(
            dateiname = str(a["dateiname"]),
            blaetter = (a["blaetter"] as? JsonArray).orEmpty().mapNotNull { b ->
                val o = b as? JsonObject ?: return@mapNotNull null
                Blatt(zahl(o["index"]), str(o["name"]))
            },
            blatt = zahl(a["blatt"]),
            signatur = str(a["signatur"]),
            vorlageGenutzt = vorlage != null,
            vorlageName = str(vorlage?.get("name")),
            felder = strListe(a["felder"]),
            spalten = (a["spalten"] as? JsonArray).orEmpty().mapNotNull { s ->
                val o = s as? JsonObject ?: return@mapNotNull null
                val g = o["grund"] as? JsonObject
                Spalte(
                    index = zahl(o["index"]),
                    titel = str(o["titel"]),
                    ohneTitel = (o["ohneTitel"] as? JsonPrimitive)?.booleanOrNull ?: false,
                    beispiele = strListe(o["beispiele"]),
                    vorschlag = str(o["vorschlag"]).ifEmpty { null },
                    sicherheit = (o["sicherheit"] as? JsonPrimitive)?.doubleOrNull ?: 0.0,
                    grundVorlage = (g?.get("vorlage") as? JsonPrimitive)?.booleanOrNull ?: false,
                    grundLlama = (g?.get("llama") as? JsonPrimitive)?.booleanOrNull ?: false,
                    grundKopf = str(g?.get("kopf")).ifEmpty { null },
                    grundWerte = str(g?.get("werte")).ifEmpty { null },
                    grundAnteil = zahl(g?.get("anteil")),
                )
            },
            zuordnung = zuordnung,
            fehlendeZuordnung = strListe(a["fehlendeZuordnung"]),
            datensaetze = (a["datensaetze"] as? JsonArray).orEmpty().mapNotNull { s ->
                val o = s as? JsonObject ?: return@mapNotNull null
                val hinweise = strListe(o["hinweise"])
                Satz(
                    zeilen = (o["zeilen"] as? JsonArray).orEmpty().map { zahl(it) },
                    daten = o["daten"] as? JsonObject ?: JsonObject(emptyMap()),
                    fehlt = strListe(o["fehlt"]),
                    hinweise = hinweise,
                    // Doppelte Fahrten sind zunaechst abgewaehlt.
                    aus = "doppelt" in hinweise,
                )
            },
            llamaGenutzt = (llama?.get("genutzt") as? JsonPrimitive)?.booleanOrNull ?: false,
        )
    }

    // MARK: Pruefen nach Bearbeitung (fahrtPruefen / gastPruefen aus importKern.js)

    /** text(): null -> "", Leerraum zusammenfassen, trimmen. */
    fun text(w: JsonElement?): String = (w as? JsonPrimitive)?.takeIf { it !is JsonNull }?.content?.let { text(it) } ?: ""
    fun text(s: String): String = s.replace(Regex("\\s+"), " ").trim()

    /** schluessel(): klein, alles ausser [a-z0-9äöüß] als ein Leerzeichen, trimmen. */
    fun schluessel(s: String): String = Regex("[^a-z0-9äöüß]+").replace(text(s).lowercase(), " ").trim()

    fun kurzname(adresse: String): String = text(adresse).split(",").first().ifEmpty { text(adresse) }

    private fun adresseVergleich(a: String): String =
        Regex("(?<![A-Za-z0-9_])(str|strasse|straße)(?![A-Za-z0-9_])").replace(schluessel(a), "str").replace(Regex("\\s+"), " ")

    private val EMAIL = Regex("^[^\\s@]+@[^\\s@]+\\.[a-z]{2,}$", RegexOption.IGNORE_CASE)

    /** JS-Wahrheitswert eines Feldes (null, "", 0, false = leer). */
    private fun gesetzt(w: JsonElement?): Boolean {
        val p = w as? JsonPrimitive ?: return w != null && w !is JsonNull
        if (p is JsonNull) return false
        if (p.isString) return p.content.isNotEmpty()
        p.booleanOrNull?.let { return it }
        p.doubleOrNull?.let { return it != 0.0 && !it.isNaN() }
        return true
    }

    fun pruefen(modus: ImportModus, satz: Satz): Satz = if (modus == ImportModus.GAESTE) gastPruefen(satz) else fahrtPruefen(satz)

    private fun fahrtPruefen(satz: Satz): Satz {
        val d = satz.daten
        val fehlt = mutableListOf<String>()
        if (!gesetzt(d["ride_date"])) fehlt.add("datum")
        if (!gesetzt(d["etd"])) fehlt.add("uhrzeit")
        val ab = text(d["pickup_address"])
        val an = text(d["dropoff_address"])
        if (ab.isEmpty()) fehlt.add("abholort")
        if (an.isEmpty()) fehlt.add("zielort")
        val behalten = satz.hinweise.filter { it in listOf("mehrereZeilen", "datumUebernommen", "llama", "doppelt", "adresseUnbekannt", "datumAusDatei", "zielAusDatei") }.toMutableList()
        val datum = str(d["ride_date"])
        if (datum.isNotEmpty() && datum < LocalDate.now(ZoneOffset.UTC).toString()) behalten.add("vergangen")
        val anzahl = (d["anzahl"] as? JsonPrimitive)?.takeIf { it !is JsonNull }?.let { it.doubleOrNull ?: it.content.toDoubleOrNull() } ?: 0.0
        val gaeste = (d["passengers"] as? JsonArray)?.size ?: 0
        if (anzahl != 0.0 && gaeste > anzahl) behalten.add("mehrNamenAlsPersonen")
        if (gesetzt(d["pickup_address"]) && gesetzt(d["dropoff_address"]) &&
            adresseVergleich(str(d["pickup_address"])) == adresseVergleich(str(d["dropoff_address"]))) behalten.add("gleicheAdresse")
        return satz.copy(fehlt = fehlt, hinweise = behalten.distinct())
    }

    private fun gastPruefen(satz: Satz): Satz {
        val d = satz.daten
        val fehlt = if (text(d["first_name"]).isEmpty() && text(d["last_name"]).isEmpty()) listOf("name") else emptyList()
        val behalten = satz.hinweise.filter { it == "doppelt" || it == "llama" }.toMutableList()
        val mail = str(d["email"])
        if (mail.isNotEmpty() && !EMAIL.matches(mail.trim())) behalten.add("emailUngueltig")
        return satz.copy(fehlt = fehlt, hinweise = behalten.distinct())
    }
}
