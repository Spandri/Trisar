package de.trisar.fahrer.haupt

import de.trisar.kern.Backend
import de.trisar.kern.Stunden
import io.github.jan.supabase.postgrest.from
import io.github.jan.supabase.postgrest.postgrest
import io.github.jan.supabase.postgrest.query.Columns
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.put
import java.time.Instant
import java.time.LocalDate
import java.time.OffsetDateTime

/**
 * Verlauf (Profil -> Verlauf, wie Verlauf.jsx und Stunden.swift/Verlauf): erledigte Fahrten der letzten
 * Tage aus verlauf_fahrten(), Dienste aus stunden_verlauf() als Rahmen darum.
 */
internal object Verlauf {
    class Fahrt(val id: String, val datum: String, val abfahrt: String?, val ankunft: String?, val gaeste: List<String>, val anonym: Int)

    /** Ein Eintrag im Tag: ein Dienst mit seinen Fahrten oder eine lose Fahrt. */
    sealed class Eintrag(val schluessel: String) {
        class Dienst(val e: Stunden.Eintrag, val fahrten: List<Fahrt>) : Eintrag(e.dienst.id)
        class Lose(val f: Fahrt) : Eintrag(f.id)
    }
    class Tag(val datum: String, val eintraege: List<Eintrag>)

    private val ERLEDIGT = listOf("done", "completed", "arrived", "beendet")

    private fun s(w: JsonElement?): String? = (w as? JsonPrimitive)?.takeIf { it !is JsonNull }?.content?.takeIf { it.isNotEmpty() }
    private fun n(w: JsonElement?): Int = (w as? JsonPrimitive)?.takeIf { it !is JsonNull }?.let { it.doubleOrNull?.toInt() } ?: 0
    private fun liste(w: JsonElement?): List<String> = (w as? JsonArray).orEmpty().mapNotNull { s(it) }
    private fun zeit(iso: String?): Long = iso?.let {
        runCatching { OffsetDateTime.parse(it).toInstant() }.getOrNull() ?: runCatching { Instant.parse(it) }.getOrNull()
    }?.toEpochMilli() ?: 0L

    suspend fun fahrten(fahrerID: String, tage: Int = 60): List<Fahrt> {
        val text = runCatching {
            Backend.client.postgrest.rpc("verlauf_fahrten", buildJsonObject { put("p_tage", tage) }).data
        }.getOrNull()
        val daten = text?.let { runCatching { Backend.json.parseToJsonElement(it) as? JsonArray }.getOrNull() }
        if (daten != null) {
            return daten.mapNotNull { e ->
                (e as? JsonObject)?.let { Fahrt(s(it["id"]) ?: return@let null, s(it["datum"]) ?: "", s(it["abfahrt"]), s(it["ankunft"]), liste(it["gaeste"]), n(it["anonym"])) }
            }
        }
        // Rueckfall, solange verlauf_fahrten() fehlt: eigene Fahrten ueber die Fahrer-RLS, Ankunft = Abfahrt + Fahrzeit.
        val ab = LocalDate.now(Stunden.BERLIN).minusDays(tage.toLong()).toString()
        val roh = runCatching {
            Backend.client.from("jobs").select(Columns.raw("id,ride_date,etd,original_etd,ext_route_duration_mins,passengers,anonymous_guests")) {
                filter { eq("driver_id", fahrerID); isIn("status", ERLEDIGT); gte("ride_date", ab) }
            }.data
        }.getOrNull() ?: return emptyList()
        val jobs = runCatching { Backend.json.parseToJsonElement(roh) as? JsonArray }.getOrNull().orEmpty()
        return jobs.mapNotNull { e ->
            val j = e as? JsonObject ?: return@mapNotNull null
            val datum = s(j["ride_date"]) ?: return@mapNotNull null
            val start = Stunden.zuZeitpunkt(datum, (s(j["etd"]) ?: s(j["original_etd"]) ?: "").take(5))
            val dauer = n(j["ext_route_duration_mins"])
            val ende = start?.takeIf { dauer > 0 }?.let { Instant.ofEpochMilli(zeit(it) + dauer * 60_000L).toString() }
            Fahrt(s(j["id"]) ?: return@mapNotNull null, datum, start, ende, liste(j["passengers"]), n(j["anonymous_guests"]))
        }
    }

    /**
     * Tage neueste zuerst, im Tag chronologisch. Eine Fahrt gehoert zum Dienst, wenn der Stundenvorschlag
     * sie nennt oder sie im Dienstfenster startet.
     */
    fun tage(fahrten: List<Fahrt>, dienste: List<Stunden.Eintrag>): List<Tag> {
        class Rahmen(val e: Stunden.Eintrag, val start: String?, val ende: String?, val ids: Set<String>, val fahrten: MutableList<Fahrt> = mutableListOf())
        val rahmen = dienste.map { e ->
            val b = Stunden.zuZeitpunkt(e.dienst.datum, e.dienst.beginn)
            Rahmen(e, b, Stunden.zuZeitpunkt(e.dienst.datum, e.dienst.ende, b), e.vorschlag.fahrten.map { it.id }.toSet())
        }
        val nachTag = linkedMapOf<String, MutableList<Pair<Long, Eintrag>>>()
        fahrten.forEach { f ->
            val t = zeit(f.abfahrt)
            val r = rahmen.firstOrNull { f.id in it.ids }
                ?: rahmen.firstOrNull { it.start != null && it.ende != null && t >= zeit(it.start) && t <= zeit(it.ende) }
            if (r != null) r.fahrten += f else nachTag.getOrPut(f.datum) { mutableListOf() } += t to Eintrag.Lose(f)
        }
        rahmen.forEach { r ->
            nachTag.getOrPut(r.e.dienst.datum) { mutableListOf() } += zeit(r.start) to Eintrag.Dienst(r.e, r.fahrten.sortedBy { zeit(it.abfahrt) })
        }
        return nachTag.keys.sortedDescending().map { d -> Tag(d, nachTag.getValue(d).sortedBy { it.first }.map { it.second }) }
    }

    /** "07.11.2026 20:06 - 20:28" wie die Demo-Karten im Web (dort fallen die Leerzeichen zu einem zusammen). */
    fun kartenZeile(f: Fahrt): String {
        val t = f.datum.split("-")
        val datum = if (t.size == 3) "${t[2]}.${t[1]}.${t[0]}" else f.datum
        return "$datum ${Stunden.uhr(f.abfahrt)}" + (f.ankunft?.let { " - ${Stunden.uhr(it)}" } ?: "")
    }
}
