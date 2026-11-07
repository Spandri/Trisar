package de.trisar.kern

/**
 * Eine Regel fuer alle Stellen, an denen Gaeste einer Fahrt angezeigt werden
 * (wie admin/src/shared/gaesteAnzeige.js).
 * Nur anonyme Gaeste: "1 Anonymer Gast" bzw. "N Anonyme Gäste".
 * Namen und anonyme: Namen wie bisher, die anonymen kommen als "+ N" dazu.
 * Weder noch: "Keine Gäste". Der Startort ist nie ein Gastname.
 */
object GaesteAnzeige {
    /** Alte Eintraege wie "Anonymer Fahrgast 2" in passengers zaehlen als anonym. */
    private val ALT_ANONYM = Regex("""^anonymer?\s+fahrgast(?:\s+\d+)?$""", RegexOption.IGNORE_CASE)
    const val KEINE = "Keine Gäste"

    data class Teile(val namen: List<String>, val anonym: Int)

    /** Namen bereinigen und alte Anonym-Eintraege in die Anzahl uebernehmen. */
    fun teile(namen: List<String>, anonym: Int): Teile {
        val roh = namen.map { it.trim() }.filter { it.isNotEmpty() }
        val alt = roh.count { ALT_ANONYM.containsMatchIn(it) }
        return Teile(roh.filter { !ALT_ANONYM.containsMatchIn(it) }.distinct(), maxOf(maxOf(0, anonym), alt))
    }

    fun anonymText(anzahl: Int): String = if (anzahl == 1) "1 Anonymer Gast" else "$anzahl Anonyme Gäste"

    /** Ganzer Text in einer Zeile, z. B. fuer Titel. */
    fun text(namen: List<String>, anonym: Int, keine: String = KEINE): String {
        val g = teile(namen, anonym)
        return when {
            g.namen.isNotEmpty() && g.anonym > 0 -> g.namen.joinToString(", ") + " + ${g.anonym}"
            g.namen.isNotEmpty() -> g.namen.joinToString(", ")
            g.anonym > 0 -> anonymText(g.anonym)
            else -> keine
        }
    }

    /** Zeilen fuer Gaestelisten: jeder Name eine Zeile, die anonymen als eigene Zeile. */
    fun zeilen(namen: List<String>, anonym: Int, keine: String = KEINE): List<String> {
        val g = teile(namen, anonym)
        val z = g.namen.toMutableList()
        if (g.anonym > 0) z += if (g.namen.isEmpty()) anonymText(g.anonym) else "+ " + anonymText(g.anonym)
        return z.ifEmpty { listOf(keine) }
    }
}
