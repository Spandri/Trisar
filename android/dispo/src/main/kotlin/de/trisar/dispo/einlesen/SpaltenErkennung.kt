package de.trisar.dispo.einlesen

import de.trisar.kern.Backend
import io.github.jan.supabase.postgrest.from
import io.github.jan.supabase.postgrest.query.Columns
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import java.util.concurrent.ConcurrentHashMap
import kotlin.math.roundToInt

/** Fahrten (mode rides) oder Fahrgaeste (mode guests), wie in ImportView.jsx. */
enum class ImportModus { FAHRTEN, GAESTE }

/**
 * Spalten einer beliebigen Tabelle erkennen und auf Fahrten bzw. Fahrgaeste abbilden,
 * 1:1 nach admin/src/services/spaltenErkennung.js (SpaltenErkennung.swift: gleiche Muster, Gewichte, Schwellen).
 */
object SpaltenErkennung {
    class Feld(val key: String, val kopf: List<String>, val werte: List<String>, val belegt: List<String> = emptyList())

    data class Spalte(
        val index: Int,
        val titel: String,
        val ohneTitel: Boolean,
        val beispiele: List<String>,
        val vorschlag: String? = null,
        val sicherheit: Double = 0.0,
        val grundKopf: String? = null,
        val grundWerte: String? = null,
        val grundAnteil: Int = 0,
    )

    data class Ergebnis(val spalten: List<Spalte>, val datenzeilen: List<List<String>>)
    data class Unvollstaendig(val zeile: Int, val fehlt: List<String>)
    data class Gebaut(val fertig: List<Map<String, JsonElement>>, val unvollstaendig: List<Unvollstaendig>)

    // MARK: Regex-Hilfen

    private val cache = ConcurrentHashMap<String, Regex>()
    private fun rx(m: String, i: Boolean): Regex = cache.getOrPut((if (i) "i:" else "c:") + m) {
        if (i) Regex(m, RegexOption.IGNORE_CASE) else Regex(m)
    }

    fun passt(s: String, m: String, i: Boolean = false): Boolean = rx(m, i).containsMatchIn(s)

    /** Gruppen des ersten Treffers ("" fuer nicht getroffene Gruppen), null ohne Treffer. */
    fun treffer(s: String, m: String, i: Boolean = false): List<String>? = rx(m, i).find(s)?.groupValues

    /** JS `replace` ohne g: nur der erste Treffer. */
    fun ersetzeErsten(s: String, m: String, durch: String, i: Boolean = false): String = rx(m, i).replaceFirst(s, durch)

    fun text(s: String?): String = (s ?: "").trim()

    private fun schluessel(s: String): String = rx("[^a-z0-9äöüß]+", false).replace(text(s).lowercase(), " ").trim()

    // MARK: Werte erkennen

    private val monate = mapOf(
        "jan" to 1, "januar" to 1, "january" to 1, "feb" to 2, "februar" to 2, "february" to 2, "mär" to 3, "mar" to 3, "märz" to 3, "maerz" to 3, "march" to 3,
        "apr" to 4, "april" to 4, "mai" to 5, "may" to 5, "jun" to 6, "juni" to 6, "june" to 6, "jul" to 7, "juli" to 7, "july" to 7, "aug" to 8, "august" to 8,
        "sep" to 9, "sept" to 9, "september" to 9, "okt" to 10, "oct" to 10, "oktober" to 10, "october" to 10, "nov" to 11, "november" to 11,
        "dez" to 12, "dec" to 12, "dezember" to 12, "december" to 12,
    )

    private fun p2(s: String): String = s.padStart(2, '0')
    private fun p2(n: Int): String = p2(n.toString())
    private fun jahr4(j: String): String = if (j.length == 2) "20$j" else j

    fun datumLesen(wert: String): String {
        val t = text(wert)
        if (t.isEmpty()) return ""
        treffer(t, """(\d{4})-(\d{1,2})-(\d{1,2})""")?.let { return "${it[1]}-${p2(it[2])}-${p2(it[3])}" }
        treffer(t, """(\d{1,2})\.(\d{1,2})\.(\d{2,4})""")?.let { return "${jahr4(it[3])}-${p2(it[2])}-${p2(it[1])}" }
        // 16/08/2026 (europaeisch), bei Werten ueber 12 im zweiten Feld amerikanisch
        treffer(t, """(\d{1,2})/(\d{1,2})/(\d{2,4})""")?.let { m ->
            val a = m[1].toIntOrNull() ?: 0
            val b = m[2].toIntOrNull() ?: 0
            val (tag, monat) = if (b > 12) b to a else a to b
            return "${jahr4(m[3])}-${p2(monat)}-${p2(tag)}"
        }
        treffer(t.lowercase(), """(\d{1,2})\.?\s+([a-zäöü]{3,9})\.?\s+(\d{2,4})""")?.let { m ->
            monate[m[2]]?.let { mo -> return "${jahr4(m[3])}-${p2(mo)}-${p2(m[1])}" }
        }
        return ""
    }

    fun uhrzeitLesen(wert: String): String {
        val t = text(wert)
        val m = treffer(t, """(?:^|[^\d.])(\d{1,2})[:.h](\d{2})(?:\s*(am|pm))?(?!\d)""", i = true)
            ?: treffer(t, """^(\d{1,2})[:.](\d{2})""") ?: return ""
        var std = m[1].toIntOrNull() ?: 0
        val min = m[2].toIntOrNull() ?: 0
        val halb = if (m.size > 3) m[3].lowercase() else ""
        if (halb == "pm" && std < 12) std += 12
        if (halb == "am" && std == 12) std = 0
        if (std > 23 || min > 59) return ""
        return "${p2(std)}:${p2(min)}"
    }

    private const val DATUM_TEIL = """\d{1,2}\.\d{1,2}\.\d{2,4}|\d{4}-\d{1,2}-\d{1,2}"""

    fun muster(art: String, t: String): Boolean = when (art) {
        "datum" -> {
            val rest = ersetzeErsten(t, """^\S+\s*""", "").trim()
            datumLesen(t).isNotEmpty() && !passt(rest.ifEmpty { "x" }, """\d{1,2}[:.]\d{2}\s*(uhr|am|pm)?$""", i = true)
        }
        "uhrzeit" -> passt(t, """^\s*\d{1,2}[:.h]\d{2}(\s*(uhr|am|pm))?\s*$""", i = true)
        "datumUhrzeit" -> datumLesen(t).isNotEmpty() && uhrzeitLesen(ersetzeErsten(t, DATUM_TEIL, "")).isNotEmpty()
        "flug" -> passt(text(t.uppercase()), """^[A-Z][A-Z0-9]\s?\d{2,4}[A-Z]?$""") && !passt(t, """^(ICE|IC|EC|RJ|TGV|RE|RB)\s?\d""", i = true)
        "zug" -> passt(text(t), """^(ICE|IC|EC|RJ|RJX|TGV|RE|RB|NJ|FLX)\s?\d{1,5}$""", i = true)
        "flughafenCode" -> passt(text(t), """\(([A-Z]{3})\)|^[A-Z]{3}$""")
        "ort" -> passt(t, """(stra(ß|ss)e|str\.|platz|weg|allee|ring|gasse|damm|ufer|road|street|avenue|hotel|flughafen|airport|terminal|bahnhof|hbf|messe|zentrum|center)""", i = true)
            || passt(t, """\b\d{5}\b""") || passt(t, """\b[A-ZÄÖÜ][a-zäöüß]+\s\d{1,4}[a-z]?\b""")
        "name" -> {
            val ohne = text(ersetzeErsten(t, """^(herr|frau|mr|mrs|ms|dr)\.?\s+""", "", i = true))
            passt(ohne, """^([A-ZÄÖÜ][a-zäöüß'-]+\.?\s){1,3}[A-ZÄÖÜ][a-zäöüß'-]+(\s*[,;&/]\s*([A-ZÄÖÜ][a-zäöüß'-]+\.?\s){1,3}[A-ZÄÖÜ][a-zäöüß'-]+)*$""")
        }
        "anzahl" -> passt(text(t), """^\d{1,2}$""") && (text(t).toIntOrNull() ?: 0) in 1..30
        "janein" -> passt(text(t), """^(ja|nein|yes|no|x|true|false|1|0|y|n|✓|✔)$""", i = true)
        "email" -> passt(text(t), """^[^\s@]+@[^\s@]+\.[a-z]{2,}$""", i = true)
        "telefon" -> passt(text(t), """^\+?[\d\s()/-]{7,}$""") && t.count { it in '0'..'9' } >= 7
        "plz" -> passt(text(t), """^\d{4,5}$""")
        "freitext" -> text(t).split(Regex("\\s+")).filter { it.isNotEmpty() }.size >= 4
        else -> false
    }

    private fun anteil(werte: List<String>, art: String): Double =
        if (werte.isEmpty()) 0.0 else werte.count { muster(art, it) }.toDouble() / werte.size

    // MARK: Zielfelder

    val fahrtFelder = listOf(
        Feld("datumUhrzeit", listOf("datum uhrzeit", "datum zeit", "termin", "date time", "datetime", "zeitpunkt", "pickup datetime", "abholung am"), listOf("datumUhrzeit"), listOf("datum", "uhrzeit")),
        Feld("datum", listOf("datum", "date", "tag", "day", "service date", "fahrtdatum", "transferdatum", "ankunftstag", "arrival date"), listOf("datum")),
        Feld("uhrzeit", listOf("uhrzeit", "zeit", "time", "abholzeit", "pick up time", "pickup time", "etd", "abfahrt", "um", "start time"), listOf("uhrzeit")),
        Feld("abholort", listOf("abholort", "abholung", "abholadresse", "von", "start", "startadresse", "pick up location", "pickup location", "pick up", "pickup", "from address", "origin address", "treffpunkt"), listOf("ort")),
        Feld("zielort", listOf("zielort", "ziel", "zieladresse", "nach", "bis", "drop off", "dropoff", "drop off location", "destination", "to address", "hotel"), listOf("ort")),
        Feld("flugnummer", listOf("flug", "flugnummer", "flight", "flight no", "flight number", "flightnumber", "arrival flight", "zug flug", "flug zug"), listOf("flug", "zug")),
        Feld("zugnummer", listOf("zug", "zugnummer", "train", "train number"), listOf("zug")),
        Feld("herkunft", listOf("herkunft", "abflugort", "aus", "arriving from", "from", "origin", "kommt aus", "abflughafen"), listOf("flughafenCode")),
        Feld("gaeste", listOf("gast", "gäste", "gaeste", "fahrgast", "fahrgäste", "passagier", "passagiere", "guest", "guest name", "guests", "passenger", "passengers", "name", "kunde", "reisender"), listOf("name")),
        Feld("anzahl", listOf("anzahl", "anz", "personen", "pax", "persons", "people", "teilnehmer", "number of guests"), listOf("anzahl")),
        Feld("vip", listOf("vip"), listOf("janein")),
        Feld("kindersitz", listOf("kindersitz", "child seat", "kindersitze", "baby seat"), listOf("janein")),
        Feld("rollstuhl", listOf("rollstuhl", "barrierefrei", "wheelchair", "rollstuhlgerecht", "accessibility"), listOf("janein")),
        Feld("gepaeck", listOf("gepäck", "gepaeck", "koffer", "luggage", "baggage", "sondergepäck"), listOf("janein", "anzahl")),
        Feld("notiz", listOf("notiz", "notizen", "bemerkung", "bemerkungen", "hinweis", "hinweise", "kommentar", "note", "notes", "remarks", "comment", "comments", "info"), listOf("freitext")),
    )

    val gastFelder = listOf(
        Feld("vorname", listOf("vorname", "first name", "firstname", "given name"), listOf("name")),
        Feld("nachname", listOf("nachname", "familienname", "last name", "lastname", "surname"), listOf("name")),
        Feld("vollname", listOf("name", "gast", "kunde", "guest", "guest name", "full name", "fahrgast"), listOf("name"), listOf("vorname", "nachname")),
        Feld("email", listOf("email", "e mail", "mail", "e mail adresse"), listOf("email")),
        Feld("telefon", listOf("telefon", "tel", "phone", "mobil", "handy", "mobile"), listOf("telefon")),
        Feld("firma", listOf("firma", "unternehmen", "company", "organisation", "organization"), emptyList()),
        Feld("strasse", listOf("straße", "strasse", "str", "street", "adresse", "address"), listOf("ort")),
        Feld("plz", listOf("plz", "postleitzahl", "zip", "postcode", "postal code"), listOf("plz")),
        Feld("stadt", listOf("stadt", "ort", "city", "town"), emptyList()),
        Feld("sprache", listOf("sprache", "language", "lang"), emptyList()),
        Feld("vip", listOf("vip"), listOf("janein")),
        Feld("notiz", listOf("notiz", "bemerkung", "hinweis", "note", "notes", "remarks"), listOf("freitext")),
    )

    fun felder(m: ImportModus): List<Feld> = if (m == ImportModus.GAESTE) gastFelder else fahrtFelder

    // MARK: Kopfzeile finden

    private fun siehtAusWieDaten(t: String): Boolean =
        muster("uhrzeit", t) || datumLesen(t).isNotEmpty() || passt(t, """^\d+([.,]\d+)?$""") || muster("flug", t)

    private fun kopfzeileFinden(zeilen: List<List<String>>): Int {
        val gefuellt = { z: List<String> -> z.count { text(it).isNotEmpty() } }
        val maxBreite = zeilen.take(15).maxOfOrNull(gefuellt) ?: 0
        for (i in 0 until minOf(zeilen.size - 1, 12)) {
            val z = zeilen[i]
            val n = gefuellt(z)
            if (n < 2 || n.toDouble() < maxBreite * 0.6) continue
            val zellen = z.map { text(it) }.filter { it.isNotEmpty() }
            val datenhaft = zellen.count(::siehtAusWieDaten)
            val kurz = zellen.count { it.length <= 40 }
            if (datenhaft == 0 && kurz == zellen.size) return i
            // Erste Zeile sieht bereits wie Daten aus: es gibt keine Kopfzeile.
            if (datenhaft.toDouble() / zellen.size > 0.3) return -1
        }
        return -1
    }

    // MARK: Erkennung

    private fun kopfTreffer(titel: String, feld: Feld): Pair<Double, String?> {
        val k = schluessel(titel)
        if (k.isEmpty()) return 0.0 to null
        var bester: Pair<Double, String?> = 0.0 to null
        for (wort in feld.kopf) {
            if (k == wort) bester = 1.0 to wort
            else if (bester.first < 0.8 && " $k ".contains(" $wort ")) bester = 0.8 to wort
            else if (bester.first < 0.55 && wort.length >= 4 && k.contains(wort)) bester = 0.55 to wort
        }
        return bester
    }

    private fun werteTreffer(beispiele: List<String>, feld: Feld): Pair<Double, String?> {
        var bester: Pair<Double, String?> = 0.0 to null
        for (art in feld.werte) {
            val a = anteil(beispiele, art)
            if (a > bester.first) bester = a to art
        }
        return bester
    }

    private class Kandidat(val spalte: Int, val feld: Feld, val punkte: Double, val kopf: Double, val werte: Pair<Double, String?>, val rang: Int)

    fun erkennen(rohzeilen: List<List<String>>, modus: ImportModus): Ergebnis {
        val zeilen = rohzeilen.filter { z -> z.any { text(it).isNotEmpty() } }
        if (zeilen.isEmpty()) return Ergebnis(emptyList(), emptyList())

        val kopf = kopfzeileFinden(zeilen)
        val breite = zeilen.maxOf { it.size }
        val wert = { z: List<String>, i: Int -> if (i < z.size) text(z[i]) else "" }
        val titel = (0 until breite).map { if (kopf >= 0) wert(zeilen[kopf], it) else "" }
        val datenzeilen = zeilen.drop(kopf + 1).filter { z -> z.count { text(it).isNotEmpty() } >= 2 }

        val spalten = titel.mapIndexed { index, t ->
            val beispiele = datenzeilen.map { wert(it, index) }.filter { it.isNotEmpty() }.take(30)
            Spalte(index, t.ifEmpty { "Spalte ${index + 1}" }, t.isEmpty(), beispiele)
        }.filter { it.beispiele.isNotEmpty() }.toMutableList()

        val felder = felder(modus)
        val kandidaten = mutableListOf<Kandidat>()
        for (spalte in spalten) {
            felder.forEachIndexed { rang, feld ->
                val k = kopfTreffer(if (spalte.ohneTitel) "" else spalte.titel, feld)
                val w = werteTreffer(spalte.beispiele, feld)
                // Ueberschrift wiegt schwerer, Werte bestaetigen oder tragen allein.
                var punkte = k.first * 0.62 + w.first * 0.5
                if (k.first == 0.0 && feld.werte.isEmpty()) punkte = 0.0
                // Widerspruch: Ueberschrift passt, Werte sehen nach etwas anderem aus.
                if (k.first > 0 && feld.werte.isNotEmpty() && w.first < 0.2) punkte *= 0.75
                if (punkte >= 0.34) kandidaten.add(Kandidat(spalte.index, feld, minOf(1.0, punkte), k.first, w, rang))
            }
        }

        // Beste Paare zuerst vergeben, jede Spalte und jedes Feld nur einmal.
        kandidaten.sortWith(compareByDescending<Kandidat> { it.punkte }.thenBy { it.spalte }.thenBy { it.rang })
        val vergebenSpalte = HashMap<Int, Kandidat>()
        val vergebenFeld = HashSet<String>()
        for (c in kandidaten) {
            if (vergebenSpalte.containsKey(c.spalte)) continue
            val blockiert = listOf(c.feld.key) + c.feld.belegt
            if (blockiert.any { it in vergebenFeld }) continue
            // Datum+Uhrzeit in einer Spalte schliesst die Einzelfelder aus und umgekehrt.
            if (felder.any { c.feld.key in it.belegt && it.key in vergebenFeld }) continue
            vergebenSpalte[c.spalte] = c
            vergebenFeld.addAll(blockiert)
        }

        for (i in spalten.indices) {
            val c = vergebenSpalte[spalten[i].index] ?: continue
            spalten[i] = spalten[i].copy(
                vorschlag = c.feld.key,
                sicherheit = (c.punkte * 100).roundToInt() / 100.0,
                grundKopf = if (c.kopf >= 0.55) spalten[i].titel else null,
                grundWerte = if (c.werte.first >= 0.5) c.werte.second else null,
                grundAnteil = (c.werte.first * 100).roundToInt(),
            )
        }
        return Ergebnis(spalten, datenzeilen)
    }

    // MARK: Datensaetze bauen

    private fun ja(w: String): Boolean = passt(text(w), """^(ja|yes|x|true|1|y|✓|✔)$""", i = true)
    private fun kurzname(a: String): String = text(a).split(",").first().ifEmpty { text(a) }
    private const val FLUGHAFEN = """(flughafen|airport|terminal|\([A-Z]{3}\)|\bMUC\b|\bFRA\b|\bBER\b)"""

    /** JS parseInt: fuehrende Ziffern nach optionalem Vorzeichen. */
    private fun parseInt(s: String): Int? = treffer(s, """^\s*([+-]?\d+)""")?.get(1)?.toIntOrNull()

    private fun leser(zuordnung: Map<Int, String>): (List<String>, String) -> String = { zeile, feld ->
        val i = zuordnung.entries.firstOrNull { it.value == feld }?.key
        if (i == null || i >= zeile.size) "" else text(zeile[i])
    }

    private fun json(s: String): JsonElement = if (s.isEmpty()) JsonNull else JsonPrimitive(s)

    /** fahrtenBauen: Datensaetze fuer jobs, die Notiz steckt als "note" darin (kommt nach job_notes). */
    fun fahrtenBauen(datenzeilen: List<List<String>>, zuordnung: Map<Int, String>): Gebaut {
        val wert = leser(zuordnung)
        val fertig = mutableListOf<Map<String, JsonElement>>()
        val unvollstaendig = mutableListOf<Unvollstaendig>()
        datenzeilen.forEachIndexed { nr, zeile ->
            val kombi = wert(zeile, "datumUhrzeit")
            val datum = datumLesen(kombi).ifEmpty { datumLesen(wert(zeile, "datum")) }
            val u1 = if (kombi.isEmpty()) "" else uhrzeitLesen(ersetzeErsten(kombi, DATUM_TEIL, ""))
            val uhrzeit = u1.ifEmpty { uhrzeitLesen(wert(zeile, "uhrzeit")) }
            val abholort = wert(zeile, "abholort")
            val zielort = wert(zeile, "zielort")
            val flugOderZug = wert(zeile, "flugnummer")
            val istZug = muster("zug", flugOderZug)
            val zug = wert(zeile, "zugnummer").ifEmpty { if (istZug) flugOderZug else "" }
            val flug = if (istZug) "" else ersetzeErsten(flugOderZug.uppercase(), """^([A-Z0-9]{2})\s?(\d)""", "$1 $2")
            val gaesteText = wert(zeile, "gaeste")
            val gaeste = if (gaesteText.isEmpty()) emptyList()
            else rx("""\s*[,;&/]\s*|\s+und\s+|\s+and\s+""", true).split(gaesteText).filter { it.isNotEmpty() }
            val anzahl = parseInt(wert(zeile, "anzahl"))
            val gepaeck = wert(zeile, "gepaeck")

            val fehlt = mutableListOf<String>()
            if (datum.isEmpty()) fehlt.add("datum")
            if (uhrzeit.isEmpty()) fehlt.add("uhrzeit")
            if (abholort.isEmpty()) fehlt.add("abholort")
            if (zielort.isEmpty()) fehlt.add("zielort")

            val istFlughafen = flug.isNotEmpty() || passt(abholort, FLUGHAFEN, i = true) || passt(zielort, FLUGHAFEN, i = true)
            val satz = linkedMapOf(
                "ride_date" to json(datum),
                "etd" to (if (uhrzeit.isEmpty()) JsonNull else JsonPrimitive("$uhrzeit:00")),
                "original_etd" to (if (uhrzeit.isEmpty()) JsonNull else JsonPrimitive("$uhrzeit:00")),
                "pickup_name" to json(kurzname(abholort)),
                "pickup_address" to json(abholort),
                "dropoff_name" to json(kurzname(zielort)),
                "dropoff_address" to json(zielort),
                "flight_number" to json(flug),
                "flight_origin" to json(wert(zeile, "herkunft")),
                "train_number" to json(zug),
                "passengers" to JsonArray(gaeste.map { JsonPrimitive(it) }),
                // jobs kennt keine Gesamtzahl: wer ueber die Namen hinaus mitfaehrt, zaehlt als anonymer Gast.
                "anonymous_guests" to JsonPrimitive(anzahl?.let { maxOf(0, it - gaeste.size) } ?: 0),
                "trip_type" to JsonPrimitive(if (istFlughafen) "airport" else "normal"),
                "is_vip" to JsonPrimitive(ja(wert(zeile, "vip"))),
                "needs_child_seat" to JsonPrimitive(ja(wert(zeile, "kindersitz"))),
                "needs_accessibility" to JsonPrimitive(ja(wert(zeile, "rollstuhl"))),
                "needs_luggage" to JsonPrimitive(ja(gepaeck) || (parseInt(gepaeck) ?: 0) > 0),
                "note" to json(wert(zeile, "notiz")),
                "status" to JsonPrimitive("pending"),
                "driver_response_status" to JsonPrimitive("pending"),
            )
            if (fehlt.isEmpty()) fertig.add(satz) else unvollstaendig.add(Unvollstaendig(nr + 1, fehlt))
        }
        return Gebaut(fertig, unvollstaendig)
    }

    fun gaesteBauen(datenzeilen: List<List<String>>, zuordnung: Map<Int, String>): Gebaut {
        val wert = leser(zuordnung)
        val fertig = mutableListOf<Map<String, JsonElement>>()
        val unvollstaendig = mutableListOf<Unvollstaendig>()
        datenzeilen.forEachIndexed { nr, zeile ->
            var vorname = wert(zeile, "vorname")
            var nachname = wert(zeile, "nachname")
            val voll = ersetzeErsten(wert(zeile, "vollname"), """^(herr|frau|mr|mrs|ms|dr)\.?\s+""", "", i = true)
            if (voll.isNotEmpty() && vorname.isEmpty() && nachname.isEmpty()) {
                val teile = if (voll.contains(",")) voll.split(",").map { it.trim() }.reversed()
                else voll.split(Regex("\\s+")).filter { it.isNotEmpty() }
                nachname = if (teile.size > 1) teile.last() else teile.firstOrNull() ?: ""
                vorname = if (teile.size > 1) teile.dropLast(1).joinToString(" ") else ""
            }
            val vip = ja(wert(zeile, "vip"))
            val sprache = wert(zeile, "sprache")
            val satz = linkedMapOf(
                "first_name" to JsonPrimitive(vorname),
                "last_name" to JsonPrimitive(nachname),
                "email" to json(wert(zeile, "email")),
                "phone" to json(wert(zeile, "telefon")),
                "company" to json(wert(zeile, "firma")),
                "street" to json(wert(zeile, "strasse")),
                "zip" to json(wert(zeile, "plz")),
                "city" to json(wert(zeile, "stadt")),
                "language" to JsonPrimitive(sprache.ifEmpty { "Deutsch" }),
                "notes" to json(wert(zeile, "notiz")),
                "is_vip" to JsonPrimitive(vip),
                "vip_status" to JsonPrimitive(vip),
            )
            if (vorname.isEmpty() && nachname.isEmpty()) unvollstaendig.add(Unvollstaendig(nr + 1, listOf("name")))
            else fertig.add(satz)
        }
        return Gebaut(fertig, unvollstaendig)
    }

    // MARK: Import in die Datenbank

    /** handleApply: Fahrten nach jobs (Notizen danach in job_notes), Fahrgaeste nach guests. */
    suspend fun importieren(saetze: List<Map<String, JsonElement>>, modus: ImportModus) {
        val c = Backend.client
        if (modus == ImportModus.FAHRTEN) {
            val zeilen = saetze.map { JsonObject(it - "note") }
            val neu = c.from("jobs").insert(zeilen) { select(Columns.raw("id")) }.decodeList<JsonObject>()
            val notizen = saetze.mapIndexedNotNull { i, s ->
                if (i >= neu.size) return@mapIndexedNotNull null
                val n = (s["note"] as? JsonPrimitive)?.takeIf { it !is JsonNull }?.content?.trim() ?: return@mapIndexedNotNull null
                if (n.isEmpty()) null
                else JsonObject(mapOf("job_id" to JsonPrimitive((neu[i]["id"] as? JsonPrimitive)?.content?.lowercase() ?: ""), "note_text" to JsonPrimitive(n)))
            }
            if (notizen.isNotEmpty()) c.from("job_notes").insert(notizen)
        } else {
            c.from("guests").insert(saetze.map { JsonObject(it) })
        }
    }
}
