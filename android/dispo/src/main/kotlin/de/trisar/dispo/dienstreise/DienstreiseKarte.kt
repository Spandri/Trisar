package de.trisar.dispo.dienstreise

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import de.trisar.dispo.karte.KartenFahrer
import de.trisar.dispo.karte.KartenPunkt
import de.trisar.dispo.karte.KartenReise
import de.trisar.kern.DienstreiseAbschnitt
import de.trisar.kern.ReiseLage
import de.trisar.kern.ReiseStandort
import de.trisar.kern.ReiseVerbindung
import de.trisar.kern.hex
import kotlinx.coroutines.delay
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId

/**
 * Fahrer auf Dienstreise auf der Dispo-Karte (DienstreiseKartenSchicht.jsx, KartenView.jsx, 14.11.):
 * offene Strecke blau, gefahrenes Stueck grau, darauf das Fahrzeug mit dem Fahrer-Punkt in seiner
 * Statusfarbe und einer Zeile "ICE 612 → Mannheim 10:29 +3" (vor Start und im Umstieg "Bus 192 ab 06:45"),
 * Umstieg-Marker und Zielflagge. Position: Handy-Standort (frisch),
 * sonst aus Fahrplan und Verspaetung.
 */

private fun ms(tag: String?, uhr: String?): Long? {
    if (tag.isNullOrBlank()) return null
    val u = Regex("^(\\d{1,2}):(\\d{2})").find(uhr.orEmpty()) ?: return null
    return runCatching {
        LocalDate.parse(tag.take(10)).atTime(LocalTime.of(u.groupValues[1].toInt(), u.groupValues[2].toInt()))
            .atZone(ZoneId.systemDefault()).toInstant().toEpochMilli()
    }.getOrNull()
}

/** Laeuft die Dienstreise fuer diesen Fahrer gerade (angenommen, nicht beendet, 30 min vor Start bis 2 h nach Ankunft)? */
internal fun reiseLaeuft(d: DispoDienstreise, f: ReiseFahrer, jetzt: Long = System.currentTimeMillis()): Boolean {
    if (f.zeile.status != "accepted" || f.zeile.beendet != null) return false
    val start = ms(d.r.datum, d.r.start_zeit) ?: return false
    if (jetzt < start - 30 * 60_000L) return false
    val letzter = d.abschnitte.lastOrNull()
    var ende = if (!letzter?.an_zeit.isNullOrBlank()) ms(letzter?.an_datum?.ifBlank { null } ?: letzter?.ab_datum?.ifBlank { null } ?: d.r.datum, letzter?.an_zeit) else null
    if (ende != null && ende < start) ende += 24 * 3_600_000L
    val bis = if (ende != null) ende + 2 * 3_600_000L else start + 18 * 3_600_000L
    return jetzt < bis
}

internal fun kurz(t: String?): String = t.orEmpty().split(",").first().replace(Regex("\\s*Hbf$", RegexOption.IGNORE_CASE), "").trim()

/** Live-Stand je Abschnitt (reiseId -> abschnittId -> Verbindung), auch fuer das Fahrerblatt. */
internal object ReiseLiveStand {
    var je by mutableStateOf<Map<String, Map<String, ReiseVerbindung>>>(emptyMap())
}

/**
 * Dienstreise im Fahrerblatt (ActiveRideSheet, Prop reise, 14.11.): statt "Nächste Fahrt" gleiches Layout.
 * jetztTitel null: keine Zeile (vor Start). Sonst "JETZT" bzw. "UMSTIEG" mit Text und Verspaetung.
 */
internal data class BlattReise(
    val start: String,
    val ankunft: String,
    /** "ICE 612 · 3 Umstiege", leer = keine Zeile */
    val unter: String,
    val icon: String,
    val vonName: String,
    val nachName: String,
    val jetztTitel: String?,
    val jetztText: String,
    val spaet: Int?,
    /** Verspaetung der Abfahrt (erster Abschnitt) und der Ankunft (letzter Abschnitt), 0 = puenktlich. */
    val startSpaet: Int = 0,
    val ankunftSpaet: Int = 0,
)

/**
 * Dienstreise fuers Blatt: laeuft gerade (reiseLaeuft, Ankunft noch nicht vorbei) oder kommt heute noch
 * (angenommen, nicht beendet, Start in Zukunft) und beginnt vor der naechsten Fahrt (oder es gibt keine).
 */
internal fun blattReise(fahrer: KartenFahrer, jetzt: Long = System.currentTimeMillis()): BlattReise? {
    val (d, lage) = blattDienstreise(fahrer, jetzt) ?: return null
    return blattReiseAus(d, lage)
}

/** Die Dienstreise, die das Fahrerblatt zeigt, mit ihrer Lage (fuer Blatt und Karte). */
private fun blattDienstreise(fahrer: KartenFahrer, jetzt: Long): Pair<DispoDienstreise, de.trisar.kern.ReiseLageErgebnis>? {
    val liste = DispoDienstreiseSpeicher.liste ?: return null
    val heute = LocalDate.now().toString()
    val fahrtMs = fahrer.info.fahrtBeginn?.atZone(ZoneId.systemDefault())?.toInstant()?.toEpochMilli()
    val kandidaten = liste.mapNotNull { d ->
        val f = d.fahrer.firstOrNull { it.driverId == fahrer.id } ?: return@mapNotNull null
        val teile = d.abschnitte.ifEmpty { listOf(ReiseLage.alsAbschnitt(d.r)) }
        val live = ReiseLiveStand.je[d.id] ?: emptyMap()
        val lage = ReiseLage.berechnen(teile, live, d.r.datum, null, jetzt) ?: return@mapNotNull null
        val start = ms(d.r.datum, d.r.start_zeit)
        val laeuft = reiseLaeuft(d, f, jetzt) && !lage.vorbei
        val kommt = f.zeile.status == "accepted" && f.zeile.beendet == null && d.r.datum.take(10) == heute &&
            start != null && start > jetzt && (fahrtMs == null || start < fahrtMs)
        if (!laeuft && !kommt) null else Triple(d, lage, start ?: Long.MAX_VALUE)
    }
    val (d, lage, _) = kandidaten.minByOrNull { it.third } ?: return null
    return d to lage
}

private fun blattReiseAus(d: DispoDienstreise, lage: de.trisar.kern.ReiseLageErgebnis): BlattReise {
    val teile = d.abschnitte.ifEmpty { listOf(ReiseLage.alsAbschnitt(d.r)) }
    val live = ReiseLiveStand.je[d.id] ?: emptyMap()
    val erster = teile.first()
    val letzter = teile.last()
    val start = live[erster.id]?.abfahrt?.ifEmpty { null } ?: erster.ab_zeit?.take(5)?.ifEmpty { null } ?: d.r.zeit.ifEmpty { "--:--" }
    val ankunft = live[letzter.id]?.ankunft?.ifEmpty { null } ?: letzter.an_zeit?.take(5)?.ifEmpty { null }
        ?: (if (d.abschnitte.isEmpty()) d.r.gespeicherteVerbindung?.ankunft?.ifEmpty { null } else null) ?: "--:--"
    // Nummer des ersten Zug- oder Flug-Abschnitts, sonst erster Abschnitt, sonst Zug-/Flugnummer der Reise.
    val nummer = (d.abschnitte.firstOrNull { it.art !in setOf("bus", "ubahn", "tram") && !it.nummer.isNullOrBlank() }?.nummer
        ?: d.abschnitte.firstOrNull()?.nummer?.ifBlank { null } ?: d.r.nummer).trim()
    val umstiege = maxOf(0, d.abschnitte.size - 1)
    val unter = listOfNotNull(nummer.ifEmpty { null }, when (umstiege) {
        0 -> null
        1 -> "1 Umstieg"
        else -> "$umstiege Umstiege"
    }).joinToString(" · ")
    var titel: String? = null
    var text = ""
    var spaet: Int? = null
    val a = lage.aktuell
    if (a != null && !lage.vorStart && !lage.vorbei) {
        val w = live[a.id]
        if (lage.imUmstieg) {
            titel = "UMSTIEG"
            val ab = w?.abfahrt?.ifEmpty { null } ?: a.ab_zeit.orEmpty().take(5)
            text = ("→ ${a.nummer.orEmpty()}" + (if (ab.isNotEmpty()) " ab $ab" else "")).replace("  ", " ")
            val p = DienstreiseAbschnitt.minuten(w?.abfahrtPlan)
            val l = DienstreiseAbschnitt.minuten(w?.abfahrt)
            spaet = if (p != null && l != null) (l - p + 1440) % 1440 else null
        } else if (lage.status.getOrNull(lage.index) == "jetzt") {
            titel = "JETZT"
            val an = w?.ankunft?.ifEmpty { null } ?: a.an_zeit.orEmpty().take(5)
            text = ("${a.nummer.orEmpty()} → ${kurz(a.nach_name)}" + (if (an.isNotEmpty()) " $an" else "")).trim()
            spaet = ReiseLage.verspaetungMin(w)
        }
    }
    return BlattReise(
        start = start.take(5), ankunft = ankunft.take(5), unter = unter,
        icon = DienstreiseAbschnitt.icon(erster.art.ifBlank { "zug" }),
        vonName = kurz(d.r.start_name.ifBlank { erster.von_name }),
        nachName = kurz(d.r.ziel_name.ifBlank { letzter.nach_name.orEmpty() }),
        jetztTitel = titel, jetztText = text, spaet = spaet?.takeIf { it > 0 },
        startSpaet = live[erster.id]?.let { DienstreiseAbschnitt.verspaetung(it.abfahrtPlan, it.abfahrt) } ?: 0,
        ankunftSpaet = live[letzter.id]?.let { DienstreiseAbschnitt.verspaetung(it.ankunftPlan, it.ankunft) } ?: 0,
    )
}

/**
 * Laufende Dienstreisen fuer die Karte. fahrer: alle Fahrer der Karte (Standort, Quelle, Statusfarbe).
 * Live je Abschnitt alle 2 min (useAbschnittVerbindungen), neu einordnen alle 30 s.
 */
@Composable
internal fun rememberKartenReisen(fahrer: List<KartenFahrer>, blattFahrer: KartenFahrer? = null): List<KartenReise> {
    val sp = DispoDienstreiseSpeicher
    LaunchedEffect(Unit) { sp.starten() }
    var jetzt by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(Unit) { while (true) { delay(30_000); jetzt = System.currentTimeMillis() } }

    // 15 min nach der letzten Ankunft (15.11.): Reise raus, der normale Pin kommt zurueck.
    val laufende = (sp.liste ?: emptyList()).filter { d ->
        val teile = d.abschnitte.ifEmpty { listOf(ReiseLage.alsAbschnitt(d.r)) }
        ReiseLage.berechnen(teile, ReiseLiveStand.je[d.id] ?: emptyMap(), d.r.datum, null, jetzt)?.abgeschlossen != true
    }.flatMap { d -> d.fahrer.filter { reiseLaeuft(d, it, jetzt) }.map { d to it } }
    // Vor dem Start: Reise im Blatt des gewaehlten Fahrers, wenn er nicht schon auf einer laufenden Reise ist.
    val reiseFahrer = laufende.map { it.second.driverId }.toSet()
    val vorschauReise = blattFahrer?.takeIf { it.id !in reiseFahrer }?.let { blattDienstreise(it, jetzt)?.first }
    // Live je Abschnitt auch fuer die Vorschau, damit Zug-Abschnitte schon vor dem Start auf den Gleisen liegen.
    val reisen = (laufende.map { it.first } + listOfNotNull(vorschauReise)).distinctBy { it.id }

    // Live-Stand je Abschnitt (reiseId -> abschnittId -> Verbindung).
    var liveJe by ReiseLiveStand::je
    val schluessel = reisen.joinToString(";") { d -> d.id + ":" + d.abschnitte.joinToString(",") { "${it.id}|${it.nummer}|${it.ab_zeit}" } }
    LaunchedEffect(schluessel) {
        if (reisen.isEmpty()) return@LaunchedEffect
        while (true) {
            for (d in reisen) {
                for (a in d.abschnitte) {
                    val art = a.art.ifBlank { DienstreiseAbschnitt.artAus(a.nummer.orEmpty()) }
                    if (!DienstreiseAbschnitt.mitLive(art) || a.nummer.isNullOrBlank()) continue
                    val v = runCatching { ReiseVerbindung.holen(a.copy(art = art).alsReise(d.r.datum), a.nach_name.orEmpty()) }.getOrNull()
                    if (v != null && v.fehler == null) {
                        liveJe = liveJe + (d.id to ((liveJe[d.id] ?: emptyMap()) + (a.id to v)))
                    }
                }
            }
            delay(120_000)
        }
    }

    val jeFahrer = fahrer.associateBy { it.id }
    // Eine Reise wie DienstreiseKartenSchicht: Strecke, Fahrzeug mit Text, Umstieg-Marker und Zielflagge.
    fun zeichnen(d: DispoDienstreise, fahrerID: String, nummer: String, kennung: String): KartenReise? {
        // Ohne Abschnitte: die Reise als ein Abschnitt.
        val teile = d.abschnitte.ifEmpty { listOf(ReiseLage.alsAbschnitt(d.r)) }
        val live = liveJe[d.id] ?: emptyMap()
        val k = jeFahrer[fahrerID]
        val standort = k?.let { ReiseStandort(it.lat, it.lng, it.letztesSignal?.toInstant(), it.standortQuelle) }
        val lage = ReiseLage.berechnen(teile, live, d.r.datum, standort, jetzt) ?: return null
        val a = lage.aktuell
        val text = if (a == null) "" else {
            val w = live[a.id]
            // Vor dem Start und im Umstieg wie beim Fahrer: "Bus 192 ab 06:45".
            if (lage.vorStart || lage.imUmstieg) "${a.nummer.orEmpty()} ab ${w?.abfahrt?.ifEmpty { null } ?: a.ab_zeit.orEmpty().take(5)}".trim()
            else {
                val an = w?.ankunft?.ifEmpty { null } ?: a.an_zeit.orEmpty().take(5)
                val spaet = ReiseLage.verspaetungMin(w)
                ("${a.nummer.orEmpty()} → ${kurz(a.nach_name)}" + (if (an.isNotEmpty()) " $an" else "") + (if (spaet != null && spaet > 0) " +$spaet" else "")).trim()
            }
        }
        val zLat = d.r.ziel_lat; val zLng = d.r.ziel_lng
        return KartenReise(
            kennung = kennung,
            fahrerID = fahrerID,
            offen = lage.offen.map { KartenPunkt(it.lat, it.lng) },
            gefahren = lage.gefahren.map { KartenPunkt(it.lat, it.lng) },
            position = lage.position?.let { KartenPunkt(it.lat, it.lng) },
            art = lage.art,
            nummer = nummer,
            text = text,
            farbe = k?.zustand?.farbe ?: hex(0x59BE80),
            umstiege = if (teile.size > 1) ReiseLage.umstiegPunkte(teile, live) else emptyList(),
            ziel = if (zLat != null && zLng != null) KartenPunkt(zLat, zLng) else null,
            // Wie im Web: Strecke, Umstiege und Ziel nur beim gewaehlten Fahrer, sonst nur das Fahrzeug.
            mitLinie = fahrerID == blattFahrer?.id,
        )
    }
    // Vor dem Start (KartenView.jsx): zeigt das Blatt eine Dienstreise des gewaehlten Fahrers, die noch nicht
    // laeuft, dann wie eine laufende (Fahrzeug am Start mit "Bus 192 ab 06:45"), der Fahrer-Pin ist aus.
    val vorschau = blattFahrer?.takeIf { it.id !in reiseFahrer }?.let { bf ->
        val d = vorschauReise ?: return@let null
        val nummer = d.fahrer.firstOrNull { it.driverId == bf.id }?.profil?.nummer?.ifEmpty { null } ?: bf.nummer.orEmpty()
        zeichnen(d, bf.id, nummer, "vorschau-${d.id}-${bf.id}")
    }
    return listOfNotNull(vorschau) + laufende.mapNotNull { (d, f) ->
        zeichnen(d, f.driverId, f.profil?.nummer.orEmpty(), "dienstreise-${d.id}-${f.driverId}")
    }
}
