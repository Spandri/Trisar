package de.trisar.fahrer.haupt

import androidx.compose.ui.graphics.Color
import de.trisar.kern.hex

/**
 * Eine Zeile der Dienstanfrage (wie shared/dienstAnfrage.js der Web-App und AnfrageZeile in iOS).
 * Ganz neuer Dienst: Dienststart, jede Pause mit Pausenstart und Pausenende, Dienstende.
 * Geaenderter Dienst (vorher gesetzt): nur was sich geaendert hat, Pausen der Reihe nach verglichen,
 * weggefallene als "Pause 18:00–19:00 entfällt". Nichts erkennbar geaendert: wieder der ganze Dienst.
 */
internal data class AnfrageZeile(
    val art: Art,
    val zeit: String,
    val bis: String = "",
    /** Minuten ab Tagesbeginn (nach Mitternacht + 1440), fuer die Reihenfolge zwischen den Fahrten. */
    val m: Double = 0.0,
    val schluessel: String = "",
) {
    enum class Art { START, ENDE, PAUSE_START, PAUSE_ENDE, PAUSE_WEG }

    val text: String get() = when (art) {
        Art.START -> "Dienststart $zeit"
        Art.ENDE -> "Dienstende $zeit"
        Art.PAUSE_START -> "Pausenstart $zeit"
        Art.PAUSE_ENDE -> "Pausenende $zeit"
        Art.PAUSE_WEG -> "Pause $zeit–$bis entfällt"
    }
    val farbe: Color get() = when (art) {
        Art.START -> hex(0xE3F654)
        Art.ENDE -> hex(0xFF6F63)
        else -> hex(0x868687)
    }
    /** Erste Zeile gross (Dienst 38, Pause 33, Pause entfaellt 26), weitere 24. */
    fun groesse(erste: Boolean): Float = if (!erste) 24f else when (art) {
        Art.START, Art.ENDE -> 38f
        Art.PAUSE_WEG -> 26f
        else -> 33f
    }

    companion object {
        /** 2 Rand + 19 Luft + Zeilen (je 20 Abstand dazwischen) + 19 Luft + 2 Rand. */
        fun kartenHoehe(zeilen: List<AnfrageZeile>): Float =
            if (zeilen.isEmpty()) 124f else 42f + zeilen.mapIndexed { i, z -> z.groesse(i == 0) + if (i > 0) 20f else 0f }.sum()

        private fun hm(s: String?) = s.orEmpty().take(5)
        private fun minuten(s: String): Int? {
            val t = s.split(":").mapNotNull { it.toIntOrNull() }
            return if (t.size >= 2) t[0] * 60 + t[1] else null
        }
        private fun pausen(p: List<DienstPausenZeit>?) =
            p.orEmpty().map { hm(it.von) to hm(it.bis) }.filter { it.first.isNotEmpty() && it.second.isNotEmpty() }
        private fun sortierWert(zeit: String, beginn: Int?): Double {
            val m = minuten(zeit) ?: return Double.POSITIVE_INFINITY
            return if (beginn != null && m < beginn) (m + 1440).toDouble() else m.toDouble()
        }

        fun zeilen(a: DienstAnfrage): List<AnfrageZeile> {
            val start = hm(a.service_start_time)
            val ende = hm(a.service_end_time)
            val jetzt = pausen(a.pausen)
            fun ganz() = buildList {
                if (start.isNotEmpty()) add(AnfrageZeile(Art.START, start))
                jetzt.forEach { (von, bis) -> add(AnfrageZeile(Art.PAUSE_START, von)); add(AnfrageZeile(Art.PAUSE_ENDE, bis)) }
                if (ende.isNotEmpty()) add(AnfrageZeile(Art.ENDE, ende))
            }
            val v = a.vorher
            var z: List<AnfrageZeile> = if (v == null) ganz() else buildList {
                val alt = pausen(v.pausen)
                if (start.isNotEmpty() && start != hm(v.start)) add(AnfrageZeile(Art.START, start))
                jetzt.forEachIndexed { i, (von, bis) ->
                    val o = alt.getOrNull(i)
                    if (o == null || o.first != von) add(AnfrageZeile(Art.PAUSE_START, von))
                    if (o == null || o.second != bis) add(AnfrageZeile(Art.PAUSE_ENDE, bis))
                }
                alt.drop(jetzt.size).forEach { (von, bis) -> add(AnfrageZeile(Art.PAUSE_WEG, von, bis)) }
                if (ende.isNotEmpty() && ende != hm(v.ende)) add(AnfrageZeile(Art.ENDE, ende))
            }
            if (z.isEmpty()) z = ganz()
            val beginn = minuten(start.ifEmpty { hm(v?.start) })
            fun wert(x: AnfrageZeile) = when (x.art) {
                Art.START -> Double.NEGATIVE_INFINITY
                Art.ENDE -> Double.POSITIVE_INFINITY
                else -> sortierWert(x.zeit, beginn)
            }
            fun rang(x: AnfrageZeile) = when (x.art) { Art.START -> 0; Art.PAUSE_START, Art.PAUSE_WEG -> 1; Art.PAUSE_ENDE -> 2; Art.ENDE -> 3 }
            return z.sortedWith(compareBy<AnfrageZeile>({ wert(it) }, { rang(it) }))
        }

        /** Angenommener Dienst: Pausenstart/-ende mit Minuten fuer die Reihenfolge zwischen den Fahrten. */
        fun pausenZeilen(a: DienstAnfrage): List<AnfrageZeile> {
            val beginn = minuten(hm(a.service_start_time))
            return pausen(a.pausen).flatMapIndexed { i, (von, bis) ->
                listOf(
                    AnfrageZeile(Art.PAUSE_START, von, m = sortierWert(von, beginn), schluessel = "-ps$i"),
                    AnfrageZeile(Art.PAUSE_ENDE, bis, m = sortierWert(bis, beginn) + 0.5, schluessel = "-pe$i"),
                )
            }
        }
    }
}
