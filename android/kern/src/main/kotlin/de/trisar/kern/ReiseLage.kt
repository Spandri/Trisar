package de.trisar.kern

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.wrapContentSize
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.sqrt

/**
 * Wo ist der Fahrer gerade auf seiner Dienstreise? (14.11.2026, fahrer/src/shared/reiseLage.js,
 * admin/src/shared/reiseLage.js, iOS ReiseLage.swift)
 *
 * - Laufender Abschnitt nach Uhrzeit (Abfahrt/Ankunft live, sonst aus Ticket/Plan).
 * - Position: Handy-Standort des Fahrers, wenn hoechstens 3 Minuten alt und vom Handy (nicht vom OBD-Tracker,
 *   das Auto steht waehrend der Reise woanders). Sonst errechnet: Anteil der Fahrzeit entlang der Linie
 *   des Abschnitts. Beim Umstieg wartet er am Start des naechsten Abschnitts.
 * - Linie geteilt: gefahren (grau) bis zur Position, offen (blau) danach.
 */
data class ReiseStandort(val lat: Double, val lng: Double, val erfasst: Instant? = null, val quelle: String? = null)

data class ReiseLageErgebnis(
    val index: Int,
    /** je Abschnitt "fertig", "jetzt" oder "offen" */
    val status: List<String>,
    val vorStart: Boolean,
    val imUmstieg: Boolean,
    val vorbei: Boolean,
    val position: GeoPunkt?,
    /** "gps" oder "fahrplan" */
    val quelle: String,
    val art: String,
    val aktuell: DienstreiseAbschnitt?,
    val gefahren: List<GeoPunkt>,
    val offen: List<GeoPunkt>,
    val gesamt: List<GeoPunkt>,
    /** 15 min nach der letzten Ankunft: kein GPS mehr am Zug, Dispo-Karten zeigen den normalen Pin (15.11.). */
    val abgeschlossen: Boolean = false,
)

object ReiseLage {
    private const val FRISCH_MS = 3 * 60 * 1000L
    private const val NACHLAUF_MS = 15 * 60 * 1000L

    /** "HH:MM" am Tag (YYYY-MM-DD) in der Zeit des Geraets -> ms (wie im Web). */
    private fun zeitpunkt(tag: String?, uhr: String?): Long? {
        if (tag.isNullOrBlank()) return null
        val u = Regex("^(\\d{1,2}):(\\d{2})").find(uhr.orEmpty()) ?: return null
        return runCatching {
            LocalDate.parse(tag.take(10)).atTime(LocalTime.of(u.groupValues[1].toInt(), u.groupValues[2].toInt()))
                .atZone(ZoneId.systemDefault()).toInstant().toEpochMilli()
        }.getOrNull()
    }

    private fun abstand2(a: GeoPunkt, b: GeoPunkt): Double {
        val dx = (a.lng - b.lng) * cos(a.lat * PI / 180)
        val dy = a.lat - b.lat
        return dx * dx + dy * dy
    }

    /** Punkt auf einer Linie nach Anteil der Laenge (0..1). */
    private fun punktBeiAnteil(linie: List<GeoPunkt>, anteil: Double): GeoPunkt? {
        if (linie.isEmpty()) return null
        if (linie.size == 1 || anteil <= 0) return linie[0]
        val laengen = (1 until linie.size).map { sqrt(abstand2(linie[it - 1], linie[it])) }
        var rest = minOf(anteil, 1.0) * laengen.sum()
        for (i in laengen.indices) {
            if (rest <= laengen[i] || i == laengen.size - 1) {
                val f = if (laengen[i] > 0) minOf(1.0, rest / laengen[i]) else 0.0
                val a = linie[i]; val b = linie[i + 1]
                return GeoPunkt(a.lat + (b.lat - a.lat) * f, a.lng + (b.lng - a.lng) * f)
            }
            rest -= laengen[i]
        }
        return linie.last()
    }

    /**
     * Linie eines Abschnitts: Gleise (live), sonst Halte (live), sonst Linie vom Server (Bus entlang der
     * Strassen, U-Bahn/Tram entlang der Gleise), sonst gerade von Start zu Ziel.
     */
    fun abschnittLinie(a: DienstreiseAbschnitt, live: ReiseVerbindung?): List<GeoPunkt> {
        if (live != null && live.linie.size >= 2) return live.linie
        if (live != null && live.strecke.size >= 2) return live.strecke.map { it.punkt }
        val server = a.linie.orEmpty().mapNotNull { p ->
            val lng = p.getOrNull(0); val lat = p.getOrNull(1)
            if (lng != null && lat != null && lng.isFinite() && lat.isFinite()) GeoPunkt(lat, lng) else null
        }
        if (server.size >= 2) return server
        val von = a.von; val nach = a.nach
        if (von != null && nach != null) return listOf(von, nach)
        return emptyList()
    }

    fun berechnen(
        teile: List<DienstreiseAbschnitt>, liveJe: Map<String, ReiseVerbindung>, datum: String,
        standort: ReiseStandort?, jetzt: Long = System.currentTimeMillis(),
    ): ReiseLageErgebnis? {
        if (teile.isEmpty()) return null
        val zeiten = teile.map { a ->
            val live = liveJe[a.id]
            val tag = a.ab_datum?.ifBlank { null } ?: datum
            val ab = zeitpunkt(tag, live?.abfahrt?.ifEmpty { null } ?: a.ab_zeit)
            var an = zeitpunkt(a.an_datum?.ifBlank { null } ?: tag, live?.ankunft?.ifEmpty { null } ?: a.an_zeit)
            if (ab != null && an != null && an < ab) an += 24 * 3600 * 1000L
            ab to an
        }

        // Laufender Abschnitt: erster, dessen Ankunft noch nicht vorbei ist.
        var index = zeiten.indexOfFirst { it.second == null || jetzt < it.second!! }
        val vorbei = index < 0
        if (vorbei) index = teile.size - 1
        val ab0 = zeiten[0].first
        val vorStart = !vorbei && index == 0 && ab0 != null && jetzt < ab0
        val status = teile.indices.map { i ->
            val ab = zeiten[i].first
            when {
                vorbei || i < index -> "fertig"
                i == index && !vorStart && (ab == null || jetzt >= ab) -> "jetzt"
                else -> "offen"
            }
        }
        // Zwischen Ankunft und naechster Abfahrt: Umstieg (wartet am Start des Abschnitts `index`).
        val imUmstieg = !vorbei && !vorStart && status[index] == "offen"
        val letzteAn = zeiten.last().second
        val abgeschlossen = vorbei && letzteAn != null && jetzt > letzteAn + NACHLAUF_MS

        // Linien je Abschnitt und gesamt (mit Grenzen, um die Position einzuordnen).
        val linien = teile.map { abschnittLinie(it, liveJe[it.id]) }
        val gesamt = mutableListOf<GeoPunkt>()
        val grenzen = mutableListOf<Int>()
        linien.forEach { grenzen += gesamt.size; gesamt += it }
        grenzen += gesamt.size

        // Position: Handy (frisch), sonst errechnet.
        val handy = !abgeschlossen && standort != null && standort.lat.isFinite() && standort.lng.isFinite()
            && !Regex("teltonika|obd|tracker", RegexOption.IGNORE_CASE).containsMatchIn(standort.quelle.orEmpty())
            && (standort.erfasst == null || jetzt - standort.erfasst.toEpochMilli() <= FRISCH_MS)
        val position: GeoPunkt?
        val quelle: String
        if (handy) {
            position = GeoPunkt(standort!!.lat, standort.lng)
            quelle = "gps"
        } else {
            quelle = "fahrplan"
            val l = linien[index]
            val (ab, an) = zeiten[index]
            position = when {
                vorbei -> l.lastOrNull()
                vorStart || imUmstieg -> l.firstOrNull()
                else -> {
                    val anteil = if (ab != null && an != null && an > ab) (jetzt - ab).toDouble() / (an - ab) else 0.0
                    punktBeiAnteil(l, anteil.coerceIn(0.0, 1.0))
                }
            }
        }

        // Grenze grau/blau: naechster Punkt der Gesamtlinie zur Position (im Bereich des laufenden Abschnitts).
        var teilung = 0
        if (position != null && gesamt.isNotEmpty()) {
            val von = grenzen[index]
            val bis = maxOf(von, grenzen[index + 1] - 1)
            var bester = Double.POSITIVE_INFINITY
            for (i in von..bis) {
                if (i >= gesamt.size) break
                val d = abstand2(gesamt[i], position)
                if (d < bester) { bester = d; teilung = i }
            }
            if (vorbei) teilung = gesamt.size - 1
        }
        val gefahren = if (position != null) gesamt.take(teilung + 1) + position else emptyList()
        val offen = if (position != null) listOf(position) + gesamt.drop(teilung + 1) else gesamt.toList()

        val aktuell = teile[index]
        return ReiseLageErgebnis(index, status, vorStart, imUmstieg, vorbei, position, quelle, aktuell.art.ifBlank { "zug" },
            aktuell, gefahren, offen, gesamt, abgeschlossen)
    }

    /**
     * Umstiege einer Reise (umstiegPunkte): Start jedes weiteren Abschnitts mit Art und
     * "U2 ab 06:56" (Abfahrt live, sonst Plan).
     */
    fun umstiegPunkte(teile: List<DienstreiseAbschnitt>, liveJe: Map<String, ReiseVerbindung>): List<KartenUmstieg> =
        teile.drop(1).mapNotNull { a ->
            val ort = a.von ?: return@mapNotNull null
            val ab = liveJe[a.id]?.abfahrt?.ifEmpty { null } ?: a.ab_zeit.orEmpty().take(5)
            KartenUmstieg(ort, a.art.ifBlank { "zug" }, (a.nummer.orEmpty() + (if (ab.isNotEmpty()) " ab $ab" else "")).trim())
        }

    /** Icon des Fahrzeugs (Lime). */
    fun fahrzeugIcon(art: String): String = when (art) {
        "bus" -> "Bus_Trisar_Icons_01_Lime"
        "ubahn", "tram" -> "U_Bahn_Trisar_Icons_01_Lime"
        "flug" -> "Plain_Abflug_Trisar_Icons_01_Lime"
        else -> "Bahnhof_Zug_Trisar_Icons_01_Lime"
    }

    /** Verspaetung in Minuten (live ankunft - ankunft_plan), sonst null. */
    fun verspaetungMin(live: ReiseVerbindung?): Int? {
        val a = DienstreiseAbschnitt.minuten(live?.ankunft) ?: return null
        val p = DienstreiseAbschnitt.minuten(live?.ankunftPlan) ?: return null
        return (a - p + 1440) % 1440
    }

    /**
     * Ohne Abschnitte: die Reise als ein Abschnitt (id "haupt"). Flug-Linie als Bogen gibt der Aufrufer
     * ueber liveJe["haupt"].linie mit.
     */
    fun alsAbschnitt(r: DienstreiseZeile): DienstreiseAbschnitt = DienstreiseAbschnitt(
        id = "haupt", dienstreise_id = r.id, art = if (r.flug) "flug" else "zug", nummer = r.nummer,
        von_name = r.start_name, von_lat = r.start_lat, von_lng = r.start_lng,
        nach_name = r.ziel_name, nach_lat = r.ziel_lat, nach_lng = r.ziel_lng,
        ab_datum = r.datum, ab_zeit = r.start_zeit, an_zeit = null,
    )
}

/** Umstieg einer Dienstreise: Ort, Art des naechsten Abschnitts, Schild "U2 ab 06:56". */
data class KartenUmstieg(val ort: GeoPunkt, val art: String, val text: String)

/**
 * Umstieg-Marker (umstiegMarkerElement): schwarzer Kreis 30 mit weissem Rand 2, darin das Lime-Icon des
 * naechsten Abschnitts 17, rechts daneben (links 36, oben 4) das Schild weiss 12 fett auf 1A1A1A 92 %,
 * Radius 6. Groesse 30 x 30 (Mitte = Ort), das Schild ragt heraus.
 */
@Composable
fun UmstiegMarker(art: String, text: String, modifier: Modifier = Modifier) {
    Box(modifier.size(30.dp)) {
        Box(
            Modifier.size(30.dp).background(Color.Black, CircleShape).border(2.dp, Color.White, CircleShape),
            contentAlignment = Alignment.Center,
        ) { Icon(ReiseLage.fahrzeugIcon(art), Modifier.size(17.dp)) }
        if (text.isNotEmpty()) {
            Box(Modifier.offset(36.dp, 4.dp).wrapContentSize(Alignment.TopStart, unbounded = true)) {
                Text(text, style = grotesk(12f, 700, farbe = Color.White), maxLines = 1, softWrap = false,
                    modifier = Modifier.background(hex(0x1A1A1A, 0.92f), RoundedCornerShape(6.dp)).padding(horizontal = 7.dp, vertical = 3.dp))
            }
        }
    }
}

/**
 * Marker "Fahrer sitzt im Fahrzeug" (fahrzeugMarkerElement): schwarzer Kreis 48 mit Lime-Rand 2,5 und
 * Lime-Fahrzeug, unten rechts (right -12, bottom -8) der Fahrer-Punkt 28 mit Nummer: Fahrer-App blau
 * (punktFarbe null), Dispo in Statusfarbe mit schwarzem Rand. Rechts daneben ein Schild mit einer Zeile.
 * Die Groesse ist 48 x 48 (Mitte = Ort), Punkt und Schild ragen heraus.
 */
@Composable
fun FahrzeugMarker(art: String, nummer: String, text: String, punktFarbe: Color? = null, modifier: Modifier = Modifier) {
    Box(modifier.size(48.dp)) {
        Box(
            Modifier.size(48.dp).shadow(14.dp, CircleShape, ambientColor = Color.Black, spotColor = Color.Black)
                .background(Color.Black, CircleShape).border(2.5.dp, hex(0xE3F654), CircleShape),
            contentAlignment = Alignment.Center,
        ) { Icon(ReiseLage.fahrzeugIcon(art), Modifier.size(26.dp)) }
        val punkt = Modifier.align(Alignment.BottomEnd).offset(12.dp, 8.dp).size(28.dp)
        if (punktFarbe != null) {
            Box(punkt.background(punktFarbe, CircleShape).border(2.dp, Color.Black, CircleShape), contentAlignment = Alignment.Center) {
                Text(nummer, style = grotesk(12f, 700, farbe = Color.Black), textAlign = TextAlign.Center, maxLines = 1)
            }
        } else {
            Box(punkt, contentAlignment = Alignment.Center) {
                Icon("Fahrer_Standort_Trisar_01_blau", Modifier.fillMaxSize())
                Text(nummer, style = grotesk(12f, 700), textAlign = TextAlign.Center, maxLines = 1)
            }
        }
        if (text.isNotEmpty()) {
            Box(Modifier.offset(58.dp, 10.dp).wrapContentSize(Alignment.TopStart, unbounded = true)) {
                Text(text, style = grotesk(13f, 700, farbe = hex(0xE3F654)), maxLines = 1, softWrap = false,
                    modifier = Modifier.background(hex(0x1A1A1A, 0.92f), RoundedCornerShape(6.dp)).padding(horizontal = 8.dp, vertical = 4.dp))
            }
        }
    }
}
