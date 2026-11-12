package de.trisar.kern

import io.github.jan.supabase.auth.auth
import io.github.jan.supabase.postgrest.from
import io.github.jan.supabase.postgrest.postgrest
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.put
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

/**
 * Stundenerfassung (Fahrer- und Dispo-App), wie fahrer/src/features/fahrer/views/Stunden.jsx und
 * admin/src/components/views/FahrerStunden.jsx. Daten: Datenbank-Funktion stunden_verlauf() und
 * Tabelle stundenzettel (Migration 20261106060000_stundenerfassung.sql). Zeiten in Europe/Berlin.
 */
object Stunden {
    val BERLIN: ZoneId = ZoneId.of("Europe/Berlin")

    class Pause(val von: String, val bis: String, val art: String)

    class Fahrt(
        val id: String, val zeit: String, val gaeste: String, val von: String, val nach: String,
        val start: String, val ende: String, val genau: Boolean, val status: String,
    )

    class Vorschlag(
        val beginn: String, val ende: String, val pausen: List<Pause>, val pauseMin: Int, val arbeitsMin: Int,
        val fahrten: List<Fahrt>, val roh: JsonElement,
    )

    class Zettel(
        val id: String, val status: String, val beginn: String, val ende: String, val pauseMin: Int, val arbeitsMin: Int,
        val angepasst: Boolean, val begruendung: String, val dispoNotiz: String, val vorschlag: Vorschlag?,
        val pausen: List<Pause> = emptyList(),
    )

    /** pausen: geplante Pausen des Dienstes (dienst_pausen, HH:MM von/bis), fuer den Ablauf der Dispo. */
    class Dienst(val id: String, val datum: String, val beginn: String, val ende: String,
                 val pausen: List<Pair<String, String>> = emptyList())

    class Eintrag(val dienst: Dienst, val vorschlag: Vorschlag, val zettel: Zettel?, val vorbei: Boolean) {
        /** Noch zu erfassen: vorbei und ohne Zettel oder zurueckgegeben. */
        val offen: Boolean get() = vorbei && fahrerDran(zettel)
    }

    // MARK: Heute

    /**
     * Heute (wie heuteStand in Stunden.jsx): Start, begonnene Pausen, Ende erst nach dem Dienst und die
     * Arbeitszeit bis jetzt. Geplante Pausen ab 3 Stunden halten die Zeit an, kuerzere sind Arbeitszeit.
     */
    class HeutePause(val von: Instant, val bis: Instant?, val laeuft: Boolean)
    class Heute(val start: Instant, val ende: Instant?, val fertig: Boolean, val pausen: List<HeutePause>, val arbeitsMin: Int)

    private fun zeit(iso: String): Instant? = if (iso.isEmpty()) null else runCatching { OffsetDateTime.parse(iso).toInstant() }.getOrNull()

    /** Fahrt laeuft gerade (gestartet, noch nicht erledigt). Solange endet der Tag nicht. */
    private val LAEUFT = setOf("at_pickup", "pickup", "beim_pickup", "in_progress", "unterwegs", "started", "on_trip", "ongoing", "active")

    /** Geplante Pausen ab 3 Stunden halten die Zeit an (auch waehrend sie laufen), kuerzere sind Arbeitszeit. */
    fun pausenMin(pausen: List<Pair<Instant, Instant?>>, bis: Instant): Double = pausen.sumOf { (von, pb) ->
        if (pb == null || java.time.Duration.between(von, pb).toMinutes() < PAUSE_MINDEST) 0.0
        else maxOf(0.0, java.time.Duration.between(von, minOf(pb, bis)).seconds / 60.0)
    }
    /** Fahrer ist dran: nicht erfasst, zurueckgegeben (alt) oder von der Dispo geaendert (12.11.). */
    fun fahrerDran(z: Zettel?): Boolean = z == null || z.status == "zurueckgewiesen" || z.status == "dispo_geaendert"

    /** Aenderung der Dispo annehmen: Stunden sind dann fertig (stunden_fahrer_zustimmen). */
    suspend fun dispoAenderungAnnehmen(zettelID: String) {
        Backend.client.postgrest.rpc("stunden_fahrer_zustimmen", buildJsonObject { put("p_zettel", zettelID) })
    }

    fun halbeAuf(min: Double): Int = (Math.ceil(maxOf(0.0, min) / 30.0) * 30).toInt()

    /**
     * Heute (wie heuteStand in Stunden.jsx). Fertig: Dienstende erreicht und keine Fahrt mehr unterwegs.
     * Danach zeigt die Karte, was eingereicht wird bzw. wurde (Zettel), Arbeitszeit auf halbe Stunden auf.
     */
    fun heute(e: Eintrag, jetzt: Instant = Instant.now()): Heute? {
        val roh = e.vorschlag.roh as? JsonObject
        val fertig = e.vorbei && e.vorschlag.fahrten.none { it.status.lowercase() in LAEUFT }
        val z = e.zettel
        val zb = z?.let { zeit(it.beginn) }
        val ze = z?.let { zeit(it.ende) }
        val zettelGilt = fertig && zb != null && ze != null && ze.isAfter(zb)
        val start = (if (zettelGilt) zb else zeit(s(roh?.get("beginn_genau")).ifEmpty { e.vorschlag.beginn })) ?: return null
        if (start.isAfter(jetzt)) return null
        val ende = if (!fertig) null else if (zettelGilt) ze else zeit(s(roh?.get("ende_genau")).ifEmpty { e.vorschlag.ende })
        val bis = ende ?: jetzt
        val quelle = if (zettelGilt) z!!.pausen else e.vorschlag.pausen
        val pausen = quelle.mapNotNull { p ->
            val von = zeit(p.von) ?: return@mapNotNull null
            if (von.isAfter(bis)) null else von to zeit(p.bis)
        }.sortedBy { it.first }
        val genau = maxOf(0.0, java.time.Duration.between(start, bis).seconds / 60.0 - pausenMin(pausen, bis))
        val arbeits = if (!fertig) genau.toInt() else if (zettelGilt) z!!.arbeitsMin else halbeAuf(genau)
        return Heute(start, ende, fertig, pausen.map { (von, pb) -> HeutePause(von, pb, pb == null || pb.isAfter(bis)) }, arbeits)
    }

    /** Speichert die Zeiten von heute (Bestaetigen so wie gezeigt, Bearbeiten mit Notiz), wie heuteSpeichern im Web. */
    suspend fun heuteSpeichern(
        fahrerID: String, e: Eintrag, beginn: Instant, ende: Instant, pausen: List<Pair<Instant, Instant>>,
        angepasst: Boolean, begruendung: String?,
    ) {
        val jetzt = Instant.now().toString()
        val pause = Math.round(pausenMin(pausen.map { it.first to it.second }, ende)).toInt()
        val arbeits = halbeAuf(java.time.Duration.between(beginn, ende).seconds / 60.0 - pause)
        val zeile = buildJsonObject {
            put("driver_id", fahrerID)
            put("dienst_id", e.dienst.id)
            put("datum", e.dienst.datum)
            put("beginn", beginn.toString())
            put("ende", ende.toString())
            put("pausen", JsonArray(pausen.map { (v, b) -> buildJsonObject { put("von", v.toString()); put("bis", b.toString()) } }))
            put("pause_min", pause)
            put("arbeits_min", arbeits)
            put("vorschlag", e.vorschlag.roh)
            put("angepasst", angepasst)
            put("begruendung", if (angepasst && begruendung != null) JsonPrimitive(begruendung) else JsonNull)
            put("status", "eingereicht")
            put("eingereicht_am", jetzt)
            put("aktualisiert", jetzt)
        }
        val z = e.zettel
        if (z != null) Backend.client.from("stundenzettel").update(zeile) { filter { eq("id", z.id) } }
        else Backend.client.from("stundenzettel").insert(zeile)
    }

    fun heuteDatum(): String = LocalDate.now(BERLIN).toString()
    fun uhrZeit(t: Instant?): String = t?.atZone(BERLIN)?.format(DateTimeFormatter.ofPattern("HH:mm")) ?: "--:--"

    // MARK: Laden

    /** stunden_verlauf(p_driver, p_tage): `fahrer == null` = angemeldeter Fahrer. */
    suspend fun verlauf(fahrer: String?, tage: Int): List<Eintrag> {
        val parameter = buildJsonObject {
            if (fahrer != null) put("p_driver", fahrer)
            put("p_tage", tage)
        }
        val text = Backend.client.postgrest.rpc("stunden_verlauf", parameter).data
        val liste = runCatching { Backend.json.parseToJsonElement(text) as? JsonArray }.getOrNull() ?: return emptyList()
        return liste.mapNotNull { e -> (e as? JsonObject)?.let { eintragLesen(it) } }
    }

    private fun s(w: JsonElement?): String = (w as? JsonPrimitive)?.takeIf { it !is JsonNull }?.content ?: ""
    private fun n(w: JsonElement?): Int = (w as? JsonPrimitive)?.takeIf { it !is JsonNull }?.let { it.doubleOrNull?.toInt() ?: it.content.toDoubleOrNull()?.toInt() } ?: 0
    private fun b(w: JsonElement?): Boolean = (w as? JsonPrimitive)?.takeIf { it !is JsonNull }?.booleanOrNull ?: false

    private fun vorschlagLesen(o: JsonObject?): Vorschlag = Vorschlag(
        beginn = s(o?.get("beginn")),
        ende = s(o?.get("ende")),
        pausen = (o?.get("pausen") as? JsonArray).orEmpty().mapNotNull { p ->
            (p as? JsonObject)?.let { Pause(s(it["von"]), s(it["bis"]), s(it["art"])) }
        },
        pauseMin = n(o?.get("pause_min")),
        arbeitsMin = n(o?.get("arbeits_min")),
        fahrten = (o?.get("fahrten") as? JsonArray).orEmpty().mapNotNull { f ->
            (f as? JsonObject)?.let {
                Fahrt(s(it["id"]), s(it["zeit"]), s(it["gaeste"]), s(it["von"]), s(it["nach"]), s(it["start"]), s(it["ende"]), b(it["genau"]), s(it["status"]))
            }
        },
        roh = o ?: JsonObject(emptyMap()),
    )

    private fun eintragLesen(e: JsonObject): Eintrag {
        val d = e["dienst"] as? JsonObject
        val z = e["zettel"] as? JsonObject
        return Eintrag(
            dienst = Dienst(s(d?.get("id")), s(d?.get("datum")), s(d?.get("beginn")), s(d?.get("ende")),
                ((d?.get("pausen") as? kotlinx.serialization.json.JsonArray) ?: emptyList()).mapNotNull { p ->
                    (p as? JsonObject)?.let { s(it["von"]) to s(it["bis"]) }
                }),
            vorschlag = vorschlagLesen(e["vorschlag"] as? JsonObject),
            zettel = z?.let {
                Zettel(
                    id = s(it["id"]), status = s(it["status"]), beginn = s(it["beginn"]), ende = s(it["ende"]),
                    pauseMin = n(it["pause_min"]), arbeitsMin = n(it["arbeits_min"]), angepasst = b(it["angepasst"]),
                    begruendung = s(it["begruendung"]), dispoNotiz = s(it["dispo_notiz"]),
                    vorschlag = (it["vorschlag"] as? JsonObject)?.let { v -> vorschlagLesen(v) },
                    pausen = (it["pausen"] as? JsonArray).orEmpty().mapNotNull { p ->
                        (p as? JsonObject)?.let { q -> Pause(s(q["von"]), s(q["bis"]), s(q["art"])) }
                    },
                )
            },
            vorbei = b(e["vorbei"]),
        )
    }

    // MARK: Schreiben

    /**
     * Fahrer reicht ein (neu oder Aenderung eines zurueckgegebenen Zettels), wie Stunden.speichern in iOS.
     * Arbeitszeit immer auf halbe Stunden gerundet.
     */
    const val PAUSE_MINDEST = 180

    suspend fun speichern(
        fahrerID: String, e: Eintrag, beginn: String, ende: String, pauseMin: Int, angepasst: Boolean, begruendung: String?,
    ) {
        val jetzt = Instant.now().toString()
        val dauer = maxOf(0, minutenGanz(beginn, ende))
        // Als Pause zaehlt nur eine Unterbrechung von mindestens 3 Stunden, kuerzere sind Arbeitszeit.
        val pause = if (pauseMin >= PAUSE_MINDEST) pauseMin else 0
        val arbeits = maxOf(0, Math.ceil((dauer - pause) / 30.0).toInt() * 30) // zugunsten des Fahrers
        val zeile = buildJsonObject {
            put("driver_id", fahrerID)
            put("dienst_id", e.dienst.id)
            put("datum", e.dienst.datum)
            put("beginn", beginn)
            put("ende", ende)
            put("pausen", if (angepasst) JsonArray(emptyList()) else ((e.vorschlag.roh as? JsonObject)?.get("pausen") ?: JsonArray(emptyList())))
            put("pause_min", pause)
            put("arbeits_min", arbeits)
            put("vorschlag", e.vorschlag.roh)
            put("angepasst", angepasst)
            put("begruendung", if (angepasst && begruendung != null) JsonPrimitive(begruendung) else JsonNull)
            put("status", "eingereicht")
            put("eingereicht_am", jetzt)
            put("aktualisiert", jetzt)
        }
        val z = e.zettel
        if (z != null) Backend.client.from("stundenzettel").update(zeile) { filter { eq("id", z.id) } }
        else Backend.client.from("stundenzettel").insert(zeile)
    }

    /** Ganze Minuten zwischen zwei Zeitpunkten (abgeschnitten wie Int(interval / 60) in iOS). */
    private fun minutenGanz(von: String, bis: String): Int {
        val a = instant(von) ?: return 0
        val b = instant(bis) ?: return 0
        return ((b.toEpochMilli() - a.toEpochMilli()) / 60000L).toInt()
    }

    /** Dispo bestaetigt oder gibt zurueck. */
    suspend fun pruefen(zettelID: String, status: String, notiz: String) {
        val jetzt = Instant.now().toString()
        val wer = Backend.client.auth.currentUserOrNull()?.id
        Backend.client.from("stundenzettel").update(buildJsonObject {
            put("status", status)
            put("dispo_notiz", notiz.trim().ifEmpty { null }?.let { JsonPrimitive(it) } ?: JsonNull)
            put("geprueft_von", wer?.let { JsonPrimitive(it) } ?: JsonNull)
            put("geprueft_am", jetzt)
            put("aktualisiert", jetzt)
        }) { filter { eq("id", zettelID) } }
    }

    // MARK: Zeiten

    private fun instant(iso: String): Instant? =
        runCatching { OffsetDateTime.parse(iso).toInstant() }.getOrNull()
            ?: runCatching { OffsetDateTime.parse(iso.replace(' ', 'T')).toInstant() }.getOrNull()
            ?: runCatching { Instant.parse(iso) }.getOrNull()

    /** Uhrzeit HH:MM in Berlin, "--:--" ohne Wert. */
    fun uhr(iso: String?): String {
        val t = iso?.takeIf { it.isNotEmpty() }?.let { instant(it) } ?: return "--:--"
        return t.atZone(BERLIN).format(DateTimeFormatter.ofPattern("HH:mm"))
    }

    /** Minuten als H:MM. */
    fun hmm(min: Int): String = "${min / 60}:${(min % 60).toString().padStart(2, '0')}"

    /** "Samstag 07.11." */
    fun tagTitel(iso: String): String =
        runCatching { LocalDate.parse(iso).format(DateTimeFormatter.ofPattern("EEEE dd.MM.", Locale.GERMANY)) }.getOrElse { iso }

    /** "Sa 07.11." */
    fun tagKurz(iso: String): String = runCatching {
        val d = LocalDate.parse(iso)
        "${d.format(DateTimeFormatter.ofPattern("EEE", Locale.GERMANY)).trimEnd('.')} ${d.format(DateTimeFormatter.ofPattern("dd.MM.", Locale.GERMANY))}"
    }.getOrElse { iso }

    /** HH:MM am Tag des Dienstes (Berlin) als ISO. Ein Ende vor `nach` rutscht auf den Folgetag. */
    fun zuZeitpunkt(datum: String, hhmm: String, nach: String? = null): String? {
        if (!Regex("^\\d{1,2}:\\d{2}$").matches(hhmm)) return null
        val (h, m) = hhmm.split(":").map { it.toInt() }
        if (h > 23 || m > 59) return null
        var t = runCatching { LocalDate.parse(datum).atTime(LocalTime.of(h, m)).atZone(BERLIN).toInstant() }.getOrNull() ?: return null
        val grenze = nach?.let { instant(it) }
        if (grenze != null && !t.isAfter(grenze)) t = t.plusSeconds(86_400)
        return t.toString()
    }

    /** Minuten zwischen zwei Zeitpunkten (gerundet), 0 wenn einer fehlt. */
    fun minuten(von: String?, bis: String?): Int {
        val a = von?.let { instant(it) } ?: return 0
        val e = bis?.let { instant(it) } ?: return 0
        return Math.round((e.toEpochMilli() - a.toEpochMilli()) / 60000.0).toInt()
    }
}
