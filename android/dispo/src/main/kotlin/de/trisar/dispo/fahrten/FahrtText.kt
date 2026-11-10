package de.trisar.dispo.fahrten

import io.github.jan.supabase.exceptions.RestException
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import java.text.Normalizer
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlin.math.abs
import kotlin.math.floor

/** Eine Datenbankzeile lose gelesen wie im Web (`String(job.x || '')`), siehe DBZeile in iOS. */
typealias DBZeile = JsonObject

/** Datumshilfen wie Datum in iOS (lokale Zeit, yyyy-MM-dd). */
object DispoDatum {
    fun heute(): String = LocalDate.now().toString()
    fun iso(): String = Instant.now().toString()

    fun ausTagWert(wert: String): LocalDate = runCatching { LocalDate.parse(wert) }.getOrElse { LocalDate.now() }

    /** "Mittwoch 04.11." (formatDividerLabel). */
    fun trennzeile(wert: String): String =
        ausTagWert(wert).format(DateTimeFormatter.ofPattern("EEEE dd.MM.", Locale.GERMANY))

    fun jetztMinuten(): Int { val t = LocalTime.now(); return t.hour * 60 + t.minute }
}

/** Fehlertext wie PostgrestError.message in iOS. */
fun fehlerText(e: Throwable): String = ((e as? RestException)?.error ?: e.message ?: "").trim()

/** Gruppen des ersten Treffers wie treffer() in iOS ("" fuer nicht getroffene Gruppen). */
internal fun regexTreffer(text: String, muster: String, gross: Boolean = true): List<String>? {
    val r = if (gross) Regex(muster) else Regex(muster, RegexOption.IGNORE_CASE)
    val m = r.find(text) ?: return null
    return m.groupValues
}

/** Kleine Nachbauten der Web-Hilfsfunktionen aus App.jsx und den Listenansichten (W in iOS). */
object W {
    /** `String(wert || '').trim()` */
    fun t(wert: JsonElement?): String {
        val roh = when (wert) {
            null, is JsonNull -> ""
            is JsonPrimitive -> when {
                wert.isString -> wert.content
                wert.booleanOrNull != null -> if (wert.booleanOrNull == true) "true" else ""
                else -> wert.content.toDoubleOrNull()?.let { d ->
                    if (d == 0.0) "" else if (d == floor(d) && abs(d) < 1e15) d.toLong().toString() else d.toString()
                } ?: wert.content
            }
            else -> ""
        }
        return roh.trim()
    }

    fun zahl(wert: JsonElement?): Double? = when (wert) {
        is JsonPrimitive -> if (wert is JsonNull) null else wert.content.trim().toDoubleOrNull()
        else -> null
    }

    /** `Number.parseInt(String(wert), 10)` */
    fun ganzzahl(wert: JsonElement?): Int? = when (wert) {
        null, is JsonNull -> null
        is JsonPrimitive -> if (wert.isString) {
            wert.content.trim().takeWhile { it.isDigit() || it == '-' }.toIntOrNull()
        } else wert.content.toDoubleOrNull()?.toInt()
        else -> null
    }

    fun bool(wert: JsonElement?): Boolean = (wert as? JsonPrimitive)?.let { if (it is JsonNull) null else it.booleanOrNull } == true

    fun passt(text: String, muster: String, gross: Boolean = true): Boolean =
        (if (gross) Regex(muster) else Regex(muster, RegexOption.IGNORE_CASE)).containsMatchIn(text)

    fun erste(vararg werte: String): String? = werte.firstOrNull { it.isNotEmpty() }

    fun antwort(wert: String): String {
        val n = wert.trim().lowercase()
        if (n.isEmpty()) return "pending"
        if (n in setOf("accepted", "assigned", "in_progress", "done", "arrived", "completed")) return "accepted"
        if (n in setOf("refused", "cancelled", "canceled", "declined", "rejected")) return "refused"
        return "pending"
    }

    /** Alle Schreibweisen aus jobs_status_check, wie mapJobStatusToEditorStatus im Web. */
    fun editorStatus(status: String): String = FahrtText.editorStatus(status)

    /** normalizeClockValue(wert, '') */
    fun uhr(wert: String): String {
        val m = minuten(wert, true) ?: return ""
        return "%02d:%02d".format(m / 60, m % 60)
    }

    /** parseClockToMinutes; `praefix` = darf nach HH:MM weitergehen (z.B. Sekunden). */
    fun minuten(wert: String, praefix: Boolean = true): Int? {
        val s = wert.trim()
        val g = regexTreffer(s, if (praefix) """^(\d{1,2}):(\d{2})""" else """^(\d{1,2}):(\d{2})$""") ?: return null
        val h = g[1].toIntOrNull() ?: return null
        val m = g[2].toIntOrNull() ?: return null
        if (h !in 0..23 || m !in 0..59) return null
        return h * 60 + m
    }

    fun plus(uhr: String, dauer: Double): String {
        val basis = minuten(uhr) ?: return ""
        if (dauer <= 0) return ""
        val summe = ((basis + dauer.toInt()) % 1440 + 1440) % 1440
        return "%02d:%02d".format(summe / 60, summe % 60)
    }

    fun uhrAusISO(wert: String): String {
        Regex("""T\d{2}:\d{2}""").find(wert)?.let { return it.value.drop(1) }
        return uhr(wert)
    }

    /** normalizeRideDateValue */
    fun tagWert(wert: String, ersatz: String = ""): String {
        if (wert.isEmpty()) return ersatz
        if (passt(wert, """^\d{4}-\d{2}-\d{2}$""")) return wert
        if (passt(wert, """^\d{2}\.\d{2}\.\d{4}$""")) {
            val t = wert.split(".")
            return "${t[2]}-${t[1]}-${t[0]}"
        }
        if (passt(wert, """^\d{4}-\d{2}-\d{2}T""")) return wert.take(10)
        return ersatz
    }

    /** extractLocationLabel: Name bis zum ersten Komma, sonst Adresse, sonst '-'. */
    fun ortEtikett(name: String, adresse: String): String {
        fun kurz(s: String): String {
            val t = s.trim()
            if (t.isEmpty()) return ""
            val vorne = t.split(",").first().trim()
            return vorne.ifEmpty { t }
        }
        val n = kurz(name)
        if (n.isNotEmpty()) return n
        if (adresse.isEmpty()) return "-"
        return kurz(adresse).ifEmpty { adresse }
    }

    /** normalizeLocation */
    fun ortNormal(wert: String): String = FahrtText.ortNormal(wert)

    /** matchesLocation */
    fun ortPasst(heuhaufen: String, nadel: String): Boolean {
        val l = ortNormal(heuhaufen)
        val r = ortNormal(nadel)
        if (l.isEmpty() || r.isEmpty()) return false
        return l.contains(r) || r.contains(l)
    }

    /** extractPassengerNames */
    fun passagiere(wert: JsonElement?): List<String> = when (wert) {
        is JsonArray -> wert.map { t(it) }.filter { it.isNotEmpty() }
        is JsonObject -> wert.values.map { t(it) }.filter { it.isNotEmpty() }
        is JsonPrimitive -> if (wert is JsonNull || !wert.isString) emptyList()
        else wert.content.split('\n', ',', ';').map { it.trim() }.filter { it.isNotEmpty() }
        else -> emptyList()
    }

    fun flughafenCode(wert: String): String = FahrtText.flughafenCode(wert)
}

/**
 * Text-Hilfen aus admin/src/App.jsx (normalizeLocation, normalizeClockValue, ...), wie FahrtText.swift,
 * damit Formular und Speichern genau dieselben Werte erzeugen wie das Web.
 */
object FahrtText {
    const val FAHRER_FEHLT = "Fahrer fehlt"

    fun getrimmt(s: String?): String = (s ?: "").trim()

    private fun ohneAkzente(s: String): String =
        Normalizer.normalize(s, Normalizer.Form.NFD).filter { it.code !in 0x300..0x36F }

    /** normalizeLocation: klein, ohne Akzente, ae/oe/ue -> a/o/u, nur a-z0-9 und Leerzeichen. */
    fun ortNormal(wert: String): String {
        var s = ohneAkzente(wert.lowercase())
        s = s.replace("ß", "ss").replace("ae", "a").replace("oe", "o").replace("ue", "u")
            .replace(Regex("[^a-z0-9]+"), " ").replace(Regex("\\s+"), " ")
        return s.trim()
    }

    /** vergleichbar aus FahrerAutocomplete/FahrgastAutocomplete (fuer die Vorschlagsliste). */
    fun vergleichbar(wert: String): String {
        val s = ohneAkzente(Normalizer.normalize(getrimmt(wert).lowercase(), Normalizer.Form.NFKD))
        return s.replace(Regex("\\s+"), " ")
    }

    /** normalizeClockValue: "H:MM..." -> "HH:MM", sonst Rueckfall. */
    fun uhrzeit(wert: String?, rueckfall: String = ""): String {
        val t = regexTreffer(getrimmt(wert), """^(\d{1,2}):(\d{2})""") ?: return rueckfall
        val h = t[1].toIntOrNull() ?: return rueckfall
        val m = t[2].toIntOrNull() ?: return rueckfall
        if (h !in 0..23 || m !in 0..59) return rueckfall
        return "%02d:%02d".format(h, m)
    }

    /** normalizeRideDateValue: yyyy-MM-dd, dd.MM.yyyy oder ISO mit Zeit. */
    fun fahrtDatum(wert: String?, rueckfall: String = ""): String {
        val raw = getrimmt(wert)
        if (raw.isEmpty()) return rueckfall
        if (regexTreffer(raw, """^\d{4}-\d{2}-\d{2}$""") != null) return raw
        regexTreffer(raw, """^(\d{2})\.(\d{2})\.(\d{4})$""")?.let { return "${it[3]}-${it[2]}-${it[1]}" }
        if (regexTreffer(raw, """^\d{4}-\d{2}-\d{2}T""") != null) return raw.take(10)
        return rueckfall
    }

    /** extractClockFromIsoLike */
    fun uhrAusISO(wert: String?): String {
        val text = getrimmt(wert)
        if (text.isEmpty()) return ""
        regexTreffer(text, """T(\d{2}:\d{2})""")?.let { return it[1] }
        return uhrzeit(text, "")
    }

    /** mapJobStatusToEditorStatus */
    // Alle Schreibweisen, die jobs.status erlaubt (jobs_status_check), nicht nur die englischen Grundwerte.
    fun editorStatus(jobStatus: String?): String = when (getrimmt(jobStatus).lowercase()) {
        "in_progress", "unterwegs", "started", "on_trip", "ongoing", "active" -> "unterwegs"
        "done", "completed", "arrived", "beendet" -> "beendet"
        "cancelled", "canceled", "refused", "storniert", "stoniert", "archived" -> "stoniert"
        else -> "offen"
    }

    /** mapEditorStatusToJobStatus */
    fun jobStatus(editorStatus: String?): String = when (getrimmt(editorStatus).lowercase()) {
        "unterwegs" -> "in_progress"
        "beendet" -> "done"
        "stoniert" -> "cancelled"
        else -> "pending"
    }

    /** normalizeFlightNumberValue / normalizeTrainNumberValue */
    fun nummer(wert: String?): String = getrimmt((wert ?: "").replace(Regex("\\s+"), "").uppercase())

    fun flugnummerGueltig(wert: String): Boolean = regexTreffer(nummer(wert), """^[A-Z0-9]{2,3}\d{1,4}[A-Z]?$""") != null

    fun zugnummerGueltig(wert: String): Boolean {
        val n = nummer(wert)
        return n.length in 2..12 && n.any { it.isDigit() }
    }

    /** splitGuestNames */
    fun gaesteTeilen(wert: String?): List<String> =
        (wert ?: "").split('\n', ',', ';').map { getrimmt(it) }.filter { it.isNotEmpty() }

    /** normalizeDriverNameList: getrimmt, ohne Leere, ohne Doppelte (Reihenfolge bleibt). */
    fun fahrerNamenListe(werte: List<String>): List<String> {
        val gesehen = HashSet<String>()
        return werte.map { getrimmt(it) }.filter { it.isNotEmpty() && gesehen.add(it) }
    }

    /** extractDriverNumberToken */
    fun nummernTeil(wert: String): String = Regex("""\d+""").find(wert)?.value ?: ""

    /** formatDriverNameWithNumber */
    fun fahrerBeschriftung(name: String, nummer: String): String {
        val n = getrimmt(name)
        val d = getrimmt(nummer)
        if (n.isNotEmpty() && d.isNotEmpty()) return "$n ($d)"
        return n.ifEmpty { d }
    }

    fun name(vor: String?, nach: String?): String =
        listOfNotNull(vor, nach).filter { it.isNotEmpty() }.joinToString(" ").trim()

    fun heute(): String = DispoDatum.heute()

    fun jetztUhr(): String { val t = LocalTime.now(); return "%02d:%02d".format(t.hour, t.minute) }

    fun minuten(uhr: String): Int? {
        val t = regexTreffer(getrimmt(uhr), """^(\d{1,2}):(\d{2})""") ?: return null
        val h = t[1].toIntOrNull() ?: return null
        val m = t[2].toIntOrNull() ?: return null
        if (h !in 0..23 || m !in 0..59) return null
        return h * 60 + m
    }

    private val iataCodes = setOf(
        "MUC", "FRA", "BER", "HAM", "DUS", "STR", "CGN", "LEJ", "NUE", "HAJ", "BRE", "DRS",
        "VIE", "ZRH", "GVA", "BRU", "LUX", "PRG", "WAW", "MAD", "BCN", "CDG", "AMS", "LHR",
    )
    private val flughafenWoerter = listOf(
        "muenchen" to "MUC", "munchen" to "MUC", "münchen" to "MUC", "frankfurt" to "FRA",
        "berlin brandenburg" to "BER", "hamburg" to "HAM", "duesseldorf" to "DUS", "düsseldorf" to "DUS",
        "stuttgart" to "STR", "koeln" to "CGN", "köln" to "CGN", "vienna" to "VIE", "wien" to "VIE",
        "zurich" to "ZRH", "zuerich" to "ZRH", "zürich" to "ZRH", "brussels" to "BRU", "bruessel" to "BRU",
        "brüssel" to "BRU", "luxembourg" to "LUX",
    )

    /** Flughafen-Code aus einer Ortsangabe (resolveAirportCodeFromLocation). */
    fun flughafenCode(wert: String): String {
        val raw = getrimmt(wert)
        if (raw.isEmpty()) return ""
        val gross = raw.uppercase()
        regexTreffer(gross, """\(([A-Z]{3})\)""")?.let { if (it[1] in iataCodes) return it[1] }
        for (m in Regex("""\b[A-Z]{3}\b""").findAll(gross)) if (m.value in iataCodes) return m.value
        val normal = ortNormal(raw)
        for ((wort, code) in flughafenWoerter) if (normal.contains(wort)) return code
        return ""
    }

    // MARK: Fahrer-Texte (RideCard-Hilfen)

    /** getRideDriverEntries */
    fun fahrerEintraege(f: DispoFahrt): List<String> {
        val liste = f.fahrerNamen.map { it.trim() }.filter { it.isNotEmpty() }
        if (liste.isNotEmpty()) return liste
        return f.fahrer.split(",").map { it.trim() }.filter { it.isNotEmpty() }
    }

    /** extractDriverNumbers */
    fun fahrerNummern(eintraege: List<String>, ersatz: String?): List<String> {
        val nummern = mutableListOf<String>()
        fun dazu(s: String) { if (s.isNotEmpty() && s !in nummern) nummern.add(s) }
        for (e in eintraege) {
            Regex("""\(([^)]+)\)\s*$""").find(e)?.let { dazu(it.groupValues[1].trim()) }
            for (t in Regex("""\d+""").findAll(e)) dazu(t.value)
        }
        if (ersatz != null) dazu(ersatz.trim())
        return nummern
    }

    /** shortenName: "Vorname Nachname" -> "V. Nachname" */
    fun kurzName(name: String): String {
        val teile = name.trim().split(Regex("\\s+")).filter { it.isNotEmpty() }
        if (teile.size < 2) return name
        return "${teile[0].first().uppercase()}. ${teile.drop(1).joinToString(" ")}"
    }

    /** formatDriverEntry */
    fun fahrerKurz(eintrag: String, ersatzNummer: String?): String {
        val roh = eintrag.trim()
        if (roh.isEmpty()) return ""
        if (roh.lowercase() == FAHRER_FEHLT.lowercase()) return FAHRER_FEHLT
        var nummer = ersatzNummer ?: ""
        var namensTeil = roh
        Regex("""\(([^)]+)\)\s*$""").find(roh)?.let { m ->
            nummer = m.groupValues[1]
            namensTeil = roh.substring(0, m.range.first).trim()
        }
        nummer = nummer.trim()
        val kurz = kurzName(namensTeil)
        if (kurz.isNotEmpty() && nummer.isNotEmpty()) return "$kurz ($nummer)"
        if (kurz.isNotEmpty()) return kurz
        if (nummer.isNotEmpty()) return nummer
        return roh
    }

    /** i18n-Texte aus admin/src/i18n/de.js. */
    private val texte = mapOf(
        "fahrt.aktuellerStatus" to "aktueller Status",
        "fahrt.anonymeGaeste" to "Anonyme Gäste",
        "fahrt.anzahlFahrzeuge" to "Anzahl Fahrzeuge",
        "fahrt.anzahlKinder" to "Anzahl Kinder",
        "fahrt.arrivalLabel" to "Ankunft {time}",
        "fahrt.fahrerNumbered" to "Fahrer #{n}",
        "fahrt.zwischenstopp" to "Zwischenstopp",
        "fahrt.zwischenstoppNumbered" to "Zwischenstopp #{n}",
        "fahrt.adresseNichtGefunden" to "„{adresse}“ wurde nicht gefunden.",
        "fahrt.adresseOhneStadt" to "„{adresse}“ nennt keine Stadt.",
        "fahrt.adresseWeitWeg" to "„{adresse}“ liegt {km} km von den anderen Punkten der Fahrt entfernt.",
        "fahrt.trotzdemSpeichern" to "Trotzdem speichern",
        "fahrt.flightNumbered" to "Flug {n}",
        "fahrt.gastNumbered" to "Gast #{n}",
        "fahrt.noFlightDataForDate" to "Keine Flugdaten zum {date} – letzte bekannte Flüge:",
        "fahrt.saveError" to "Fahrt konnte nicht gespeichert werden: {error}",
        "fahrt.cancelRide" to "Fahrt stornieren",
        "fahrt.confirmCancelRide" to "Fahrt wirklich stornieren und löschen?",
        "fahrt.createTitle" to "Fahrt erstellen",
        "fahrt.datum" to "Datum",
        "fahrt.editTitle" to "Fahrt bearbeiten",
        "fahrt.fahrer" to "Fahrer",
        "fahrt.fahrgaeste" to "Fahrgäste",
        "fahrt.fillStartZiel" to "Bitte Start und Ziel ausfüllen.",
        "fahrt.flightMissingEta" to "Für diesen Flug fehlen ETA und Ankunftsort.",
        "fahrt.flugnummer" to "Flugnummer",
        "fahrt.konvoi" to "Konvoi",
        "fahrt.multipleFlightsFound" to "Mehrere Flüge gefunden – bitte auswählen",
        "fahrt.notesPlaceholder" to "Schreiben...",
        "fahrt.notizen" to "Notizen",
        "fahrt.saving" to "Speichern ...",
        "fahrt.start" to "Start",
        "fahrt.startZeit" to "Start Zeit",
        "fahrt.statusBeendet" to "beendet",
        "fahrt.statusOffen" to "offen",
        "fahrt.statusStoniert" to "storniert",
        "fahrt.statusUnterwegs" to "unterwegs",
        "fahrt.submitCreate" to "Fahrt speichern",
        "fahrt.submitEdit" to "Bearbeitung speichern",
        "fahrt.trainMissingEta" to "Für diesen Zug fehlen ETA und Ankunftsort.",
        "fahrt.unknownError" to "Unbekannter Fehler",
        "fahrt.ziel" to "Ziel",
        "fahrt.zugnummer" to "Zugnummer",
        "app.datumUngueltig" to "Bitte ein gültiges Datum eingeben.",
        "app.fahrerNichtAufgeloest" to "Diese Fahrer konnten nicht aufgelöst werden: {names}.",
        "app.fahrerNichtZugeordnet" to "Fahrer konnte nicht zugeordnet werden: {names}. Bitte Fahrer aus der Vorschlagsliste wählen.",
        "app.fahrtStornierenFehler" to "Fahrt konnte nicht storniert werden: {error}",
        "app.fahrtUpdateFehler" to "Fahrt konnte nicht aktualisiert werden (keine Schreibrechte oder Fahrt nicht gefunden).",
        "app.flugDatumFehlt" to "Bitte ein gültiges Datum eingeben, damit der Flug geprüft werden kann.",
        "app.flugNichtValidierbar" to "Flug nicht validierbar.",
        "app.flugValidierungFehler" to "Flug konnte nicht validiert werden.",
        "app.flugpruefungFehlgeschlagen" to "Flugprüfung fehlgeschlagen: {error}",
        "app.mehrereZuegeGefunden" to "Mehrere passende Züge gefunden. Bitte Zugnummer präzisieren.",
        "app.nurFlugOderZug" to "Bitte nur Flugnummer oder Zugnummer ausfüllen.",
        "app.startZielFehlt" to "Bitte Start und Ziel ausfüllen.",
        "app.unbekannterFehler" to "Unbekannter Fehler",
        "app.ungueltigeFahrtId" to "Ungültige Fahrt-ID.",
        "app.ungueltigeFlugnummer" to "Ungültige Flugnummer. Bitte z. B. LH1625 eingeben.",
        "app.ungueltigeZugnummer" to "Ungültige Zugnummer. Bitte z. B. ICE515 oder RE1 eingeben.",
        "app.zugDatumFehlt" to "Bitte ein gültiges Datum eingeben, damit der Zug geprüft werden kann.",
        "app.zugNichtValidierbar" to "Zug nicht validierbar.",
        "app.zugValidierungFehler" to "Zug konnte nicht validiert werden.",
        "app.zugpruefungFehlgeschlagen" to "Zugprüfung fehlgeschlagen: {error}",
    )

    fun tr(schluessel: String, werte: Map<String, String> = emptyMap()): String {
        var s = texte[schluessel] ?: schluessel
        for ((k, v) in werte) s = s.replace("{$k}", v)
        return s
    }
}
