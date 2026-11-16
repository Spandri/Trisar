package de.trisar.kern

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId

/**
 * Dienstreise, Zugabschnitt (Entwurf 14.11.): Verspaetung auf einen Blick (Zeit in Orange plus Kachel "+5")
 * und die Zwischenhalte zum Ausklappen. Gemeinsam fuer Fahrer und Dispo.
 */
object ReiseZeiten {
    val LIME = hex(0xE3F654)
    val ORANGE = hex(0xF0997B)
    val GRAU = hex(0x868687)
    val OFFEN = hex(0x5C5C5C)
    val KACHEL = hex(0x242525)
    val GRAU_KACHEL = hex(0x3A3A3A)

    /** Farbe einer Zeit: Orange bei Verspaetung, sonst Lime. */
    fun farbe(spaet: Int): Color = if (spaet > 0) ORANGE else LIME

    /** Zeitpunkt (ms) einer Uhrzeit HH:MM am Tag `datum`, null wenn eines fehlt. */
    fun ms(datum: String?, uhr: String?): Long? {
        val m = DienstreiseAbschnitt.minuten(uhr) ?: return null
        val tag = datum?.take(10)?.ifBlank { null } ?: return null
        return runCatching {
            LocalDate.parse(tag).atTime(LocalTime.of(m / 60 % 24, m % 60)).atZone(ZoneId.systemDefault()).toInstant().toEpochMilli()
        }.getOrNull()
    }

    /** Uhrzeit nach der Abfahrt `ab` (HH:MM) am Tag `datum`, ueber Mitternacht gerechnet. */
    fun nachAbfahrt(datum: String?, ab: String?, uhr: String?): Long? {
        val t = ms(datum, uhr) ?: return null
        val a = DienstreiseAbschnitt.minuten(ab) ?: return t
        val u = DienstreiseAbschnitt.minuten(uhr) ?: return t
        return if (u < a) t + 24 * 3_600_000L else t
    }

    /** Laeuft der Abschnitt gerade (Abfahrt vorbei, Ankunft noch nicht)? */
    fun laeuft(datum: String?, ab: String?, an: String?, jetzt: Long = System.currentTimeMillis()): Boolean {
        val start = ms(datum, ab) ?: return false
        val ende = nachAbfahrt(datum, ab, an) ?: return false
        return jetzt in start until ende
    }
}

/** Kachel "+5" rechts neben einer verspaeteten Zeit, gefahren grau. Nichts bei Puenktlichkeit. */
@Composable
fun VerspaetungKachel(spaet: Int, modifier: Modifier = Modifier, gefahren: Boolean = false) {
    if (spaet == 0) return
    // Spaet orange "+5", zu frueh gruen "-2" (14.11.).
    val frueh = spaet < 0
    Text(
        if (frueh) "\u2212${-spaet}" else "+$spaet", maxLines = 1, softWrap = false,
        style = grotesk(12f, 700, farbe = if (gefahren) ReiseZeiten.GRAU else Color.Black),
        modifier = modifier.background(
            if (gefahren) ReiseZeiten.GRAU_KACHEL else if (frueh) Color(0xFF59BE80) else ReiseZeiten.ORANGE,
            RoundedCornerShape(8.dp),
        )
            .padding(horizontal = 8.dp, vertical = 2.dp),
    )
}

/** Hoehen der Halte-Kachel (fuer Seiten mit festen Positionen). */
object HalteMasse {
    const val KNOPF = 36f
    const val ZEILE = 32f
    const val OBEN = 8f

    /** Hoehe der Kachel in dp, 0 ohne Halte. */
    fun hoehe(anzahl: Int, offen: Boolean): Float = when {
        anzahl == 0 -> 0f
        offen -> OBEN + anzahl * ZEILE + KNOPF
        else -> KNOPF
    }
}

/**
 * Halte zum Ausklappen unter einem Zugabschnitt: zu "▾ 5 Halte", auf der Strahl links mit Punkt je Halt,
 * Name und Zeit (ab, sonst an, Ist), unten "▴ Halte". Gefahren = Ist-Zeit vorbei, der erste offene Halt
 * ist der aktuelle (nur wenn `laeuft`). `datum`/`abfahrt`: Tag und Abfahrt des Abschnitts (fuer Mitternacht).
 */
@Composable
fun HalteKachel(
    halte: List<ReiseZwischenhalt>,
    datum: String?,
    abfahrt: String?,
    laeuft: Boolean,
    modifier: Modifier = Modifier,
    jetzt: Long = System.currentTimeMillis(),
    offen: Boolean? = null,
    umschalten: ((Boolean) -> Unit)? = null,
) {
    if (halte.isEmpty()) return
    var eigen by rememberSaveable { mutableStateOf(false) }
    val auf = offen ?: eigen
    val setzen: (Boolean) -> Unit = { neu -> if (umschalten != null) umschalten(neu) else eigen = neu }
    val knopf = grotesk(14f, 700, farbe = ReiseZeiten.LIME)

    Column(modifier.fillMaxWidth().background(ReiseZeiten.KACHEL, RoundedCornerShape(10.dp))) {
        if (!auf) {
            Box(Modifier.fillMaxWidth().height(HalteMasse.KNOPF.dp).tippen { setzen(true) }.padding(horizontal = 12.dp), contentAlignment = Alignment.CenterStart) {
                Text("▾ ${halte.size} " + (if (halte.size == 1) "Halt" else "Halte"), style = knopf, maxLines = 1)
            }
            return@Column
        }
        // Zeit je Halt: ab, sonst an (Ist, sonst Plan), Verspaetung gegen den passenden Plan.
        data class Zeile(val h: ReiseZwischenhalt, val zeit: String, val spaet: Int, val gefahren: Boolean)
        val zeilen = halte.map { h ->
            val mitAb = h.ab.isNotEmpty() || h.abPlan.isNotEmpty()
            val zeit = if (mitAb) h.ab.ifEmpty { h.abPlan } else h.an.ifEmpty { h.anPlan }
            val spaet = if (mitAb) DienstreiseAbschnitt.verspaetung(h.abPlan, h.ab) else DienstreiseAbschnitt.verspaetung(h.anPlan, h.an)
            val t = ReiseZeiten.nachAbfahrt(datum, abfahrt, zeit)
            Zeile(h, zeit, spaet, t != null && t < jetzt)
        }
        val aktuell = if (laeuft) zeilen.indexOfFirst { !it.gefahren } else -1

        Column(Modifier.padding(top = HalteMasse.OBEN.dp, start = 12.dp, end = 12.dp)) {
            zeilen.forEachIndexed { i, z ->
                val istAktuell = i == aktuell
                Row(Modifier.fillMaxWidth().height(HalteMasse.ZEILE.dp), verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    // Strahl 3dp: bis zum Halt Lime, wenn er gefahren oder der aktuelle ist, danach Lime nur wenn gefahren.
                    val obenLime = z.gefahren || istAktuell
                    val untenLime = z.gefahren && i < zeilen.lastIndex && (zeilen[i + 1].gefahren || i + 1 == aktuell)
                    val erste = i == 0
                    val letzte = i == zeilen.lastIndex
                    Canvas(Modifier.width(20.dp).fillMaxHeight()) {
                        val x = size.width / 2
                        val mitte = size.height / 2
                        val breite = 3.dp.toPx()
                        if (!erste) drawLine(if (obenLime) ReiseZeiten.LIME else ReiseZeiten.OFFEN, Offset(x, 0f), Offset(x, mitte), breite)
                        if (!letzte) drawLine(if (untenLime) ReiseZeiten.LIME else ReiseZeiten.OFFEN, Offset(x, mitte), Offset(x, size.height), breite)
                        when {
                            istAktuell -> {
                                drawCircle(ReiseZeiten.KACHEL, 10.dp.toPx(), Offset(x, mitte))
                                drawCircle(ReiseZeiten.LIME, 10.dp.toPx() - breite / 2, Offset(x, mitte), style = Stroke(breite))
                            }
                            z.gefahren -> drawCircle(ReiseZeiten.LIME, 6.dp.toPx(), Offset(x, mitte))
                            else -> drawCircle(ReiseZeiten.OFFEN, 6.dp.toPx(), Offset(x, mitte))
                        }
                    }
                    Text(z.h.name, style = grotesk(15f, 700, abstand = -0.3f, farbe = if (z.gefahren) ReiseZeiten.GRAU else Color.White),
                        maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                    if (z.zeit.isNotEmpty()) {
                        Text(z.zeit, maxLines = 1,
                            style = grotesk(15f, 700, farbe = if (z.gefahren) ReiseZeiten.GRAU else ReiseZeiten.farbe(z.spaet)))
                    }
                    VerspaetungKachel(z.spaet, gefahren = z.gefahren)
                }
            }
        }
        Box(Modifier.fillMaxWidth().height(HalteMasse.KNOPF.dp).tippen { setzen(false) }.padding(horizontal = 12.dp), contentAlignment = Alignment.CenterStart) {
            Text("▴ Halte", style = knopf, maxLines = 1)
        }
    }
}
