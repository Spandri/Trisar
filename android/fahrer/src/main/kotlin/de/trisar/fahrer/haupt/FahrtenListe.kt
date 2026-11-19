package de.trisar.fahrer.haupt

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import de.trisar.kern.EigeneOrte
import de.trisar.kern.Farbe
import de.trisar.kern.FahrzeugKarte
import de.trisar.kern.FussleisteUnten
import de.trisar.kern.Icon
import de.trisar.kern.ProfilKnopf
import de.trisar.kern.grotesk
import de.trisar.kern.hex
import de.trisar.kern.mittig
import de.trisar.kern.platz
import de.trisar.kern.tippen
import kotlinx.coroutines.launch

// Konstanten aus FahrtenScreen01View.jsx
private const val VERSATZ = 20f            // <div className="absolute left-0 top-[20px]">
private const val KARTEN_ABSTAND = 12f
private const val KNOPF_ABSTAND = 12f
private const val KNOPF_HOEHE = 51f
private const val NACH_KNOPF = 24f
private const val TAG_OBEN = 44f
private const val TAG_HOEHE = 32f
private const val TAG_UNTEN = 56f
private const val DIENST_ABSTAND = 12f
private const val DIENST_LISTE = 48f
// Angenommener Dienst (12.11.): wie im Verlauf je eine Zeile Dienststart (vor den Fahrten) und
// Dienstende (danach). Beide bleiben stehen, bis die Stundenerfassung des Tages kommt (13.11.),
// danach ist der Tag abgeschlossen. Ohne Stundenerfassung: bis die Endzeit vorbei ist.
private const val DIENST_ZEILE = 48f
// Dienststart mit Treffpunkt (13.11.): Karte wie Figma 2908-12498 (Zeile + Icon-Kachel 44 + Ortsname), 102 hoch.
private const val DIENST_START_ORT = 102f
// In der offenen Anfrage eine Zeile Icon + Ort darunter (20 Luft + 44 Kachel).
private const val TREFFPUNKT_ZEILE = 64f
private fun hatTreffpunktOrt(a: DienstAnfrage) = !a.treffpunkt?.name.isNullOrEmpty()
/** Treffpunkt in der offenen Anfrage nur, wenn sie den Dienststart betrifft (nicht bei "nur Dienstende"). */
private fun ortInAnfrage(a: DienstAnfrage) = hatTreffpunktOrt(a) && AnfrageZeile.zeilen(a).any { it.art == AnfrageZeile.Art.START }
private fun anfrageHoehe(a: DienstAnfrage) = AnfrageZeile.kartenHoehe(AnfrageZeile.zeilen(a)) + if (ortInAnfrage(a)) TREFFPUNKT_ZEILE else 0f

private fun dienstZeiten(a: DienstAnfrage): Pair<java.time.Instant?, java.time.Instant?> {
    val tag = a.service_date.orEmpty().take(10)
    val start = de.trisar.kern.Stunden.zuZeitpunkt(tag, a.service_start_time.orEmpty().take(5))
    val ende = de.trisar.kern.Stunden.zuZeitpunkt(tag, a.service_end_time.orEmpty().take(5), start) // Nachtdienst
    return start?.let { java.time.Instant.parse(it) } to ende?.let { java.time.Instant.parse(it) }
}
/** vorbei: Dienst-ID -> Stundenkarte da. Ohne Eintrag (Stundenerfassung aus, noch nicht geladen) zaehlt die Endzeit. */
private fun tagOffen(a: DienstAnfrage, jetzt: java.time.Instant, vorbei: Map<String, Boolean>): Boolean =
    vorbei[a.id.lowercase()]?.let { !it } ?: (dienstZeiten(a).second?.isAfter(jetzt) ?: true)
private fun zeigeStart(a: DienstAnfrage, jetzt: java.time.Instant, vorbei: Map<String, Boolean>) =
    a.service_start_time.orEmpty().isNotEmpty() && tagOffen(a, jetzt, vorbei)
private fun zeigeEnde(a: DienstAnfrage, jetzt: java.time.Instant, vorbei: Map<String, Boolean>) =
    a.service_end_time.orEmpty().isNotEmpty() && tagOffen(a, jetzt, vorbei)

/** Pausen-Zeilen eines angenommenen Dienstes, deren Uhrzeit noch nicht vorbei ist. */
private fun offenePausen(a: DienstAnfrage, jetzt: java.time.Instant): List<AnfrageZeile> {
    val tag = a.service_date.orEmpty().take(10)
    return AnfrageZeile.pausenZeilen(a).filter { z ->
        val t = de.trisar.kern.Stunden.zuZeitpunkt(tag, z.zeit)?.let { java.time.Instant.parse(it) } ?: return@filter true
        t.plusSeconds(if (z.m >= 1440) 86_400 else 0).isAfter(jetzt)
    }
}

/** Ein Dienst-Eintrag im Raster. art: "karte" (offene Anfrage), "start", "ende" oder "pause" (angenommen). */
private class DienstEintrag(val anfrage: DienstAnfrage, val oben: Float, val art: String, val zeile: AnfrageZeile? = null)

private class ListenRaster {
    val zeilen = mutableListOf<Pair<String, Float>>()
    val dienste = mutableListOf<DienstEintrag>()
    val fahrten = mutableListOf<Triple<Fahrt, Float, Boolean>>()
    val stunden = mutableListOf<Pair<de.trisar.kern.Stunden.Eintrag, Float>>()
    val standbys = mutableListOf<Pair<FahrerStandby, Float>>()
    val reisen = mutableListOf<Pair<FahrerDienstreise, Float>>()
    /** Danach Dienstende (19.11.): rote Zeile direkt unter der Fahrt. */
    val fahrtEnden = mutableListOf<Pair<Fahrt, Float>>()
    var unterkante = 0f
}

/**
 * buildListenLayout der Web-App wie rasterBerechnen in iOS: alle Tage (Fahrten, Dienstanfragen, Stunden)
 * sortiert, je Tag Dienste, Fahrten und am Ende des Tages die Stundenkarte.
 */
private fun rasterBerechnen(
    alle: List<Fahrt>, anfragen: List<DienstAnfrage>, stundenKarten: List<de.trisar.kern.Stunden.Eintrag>,
    hoehe: (Fahrt) -> Float, fahrzeugKarte: Float = 268f, jetzt: java.time.Instant = java.time.Instant.now(),
    standbys: List<FahrerStandby> = emptyList(), vorbei: Map<String, Boolean> = emptyMap(),
    reisen: List<FahrerDienstreise> = emptyList(),
): ListenRaster {
    fun minuten(zeit: String): Int {
        val t = zeit.split(":").mapNotNull { it.toIntOrNull() }
        return if (t.size >= 2) t[0] * 60 + t[1] else Int.MAX_VALUE
    }
    val fahrten = alle.sortedWith(compareBy<Fahrt>({ it.fahrtDatum }, { minuten(it.etd) }, { it.id }))
    val anfragenProTag = LinkedHashMap<String, MutableList<DienstAnfrage>>()
    for (a in anfragen) {
        val tag = a.service_date.orEmpty().take(10)
        if (tag.isEmpty()) continue
        // Angenommen und Dienstende vorbei: nur noch im Verlauf.
        if (a.angenommen && !zeigeStart(a, jetzt, vorbei) && !zeigeEnde(a, jetzt, vorbei) && offenePausen(a, jetzt).isEmpty()) continue
        anfragenProTag.getOrPut(tag) { mutableListOf() }.add(a)
    }
    val fahrtenProTag = fahrten.groupBy { it.fahrtDatum }
    val stundenProTag = stundenKarten.groupBy { it.dienst.datum }
    val standbyProTag = standbys.groupBy { it.s.datum.take(10) }
    val reisenProTag = reisen.groupBy { it.r.datum.take(10) }
    val tage = (fahrtenProTag.keys + anfragenProTag.keys + stundenProTag.keys + standbyProTag.keys + reisenProTag.keys).toSortedSet()
    val r = ListenRaster()
    // Fahrzeugkarte top 118, Hoehe je nach vorhandenen Angaben (mit allem 268).
    var cursor = 118f + fahrzeugKarte + TAG_UNTEN

    tage.forEachIndexed { t, tag ->
        if (t > 0) cursor += TAG_OBEN
        r.zeilen += tag to cursor
        cursor += TAG_HOEHE + TAG_UNTEN
        val alleDienste = anfragenProTag[tag].orEmpty()
        val liste = alleDienste.filter { !it.angenommen }
        liste.forEachIndexed { i, a ->
            r.dienste += DienstEintrag(a, cursor, "karte")
            cursor += anfrageHoehe(a) + KNOPF_ABSTAND + KNOPF_HOEHE
            if (i < liste.size - 1) cursor += DIENST_ABSTAND
        }
        if (liste.isNotEmpty()) cursor += DIENST_LISTE
        // Standby am Event-Ort: Karte mit Knoepfen, unter den Dienstanfragen des Tages.
        for (sb in standbyProTag[tag].orEmpty()) {
            r.standbys += sb to cursor
            cursor += standbyBlockHoehe(sb) + DIENST_LISTE
        }
        // Dienstreise nach Startzeit (14.11.): vor dem Dienststart nur, wenn sie frueher beginnt (oder kein
        // Dienststart/keine Zeit), sonst zwischen den Fahrten an ihrer Uhrzeit (wie die Pausen).
        val starts = alleDienste.filter { it.angenommen && zeigeStart(it, jetzt, vorbei) }
        val dienstMinute = starts.map { minuten(it.service_start_time.orEmpty().take(5)) }
            .filter { it != Int.MAX_VALUE }.minOrNull()
        val tagesReisen = reisenProTag[tag].orEmpty()
            .map { it to minuten(it.r.start_zeit.take(5)).takeIf { m -> m != Int.MAX_VALUE } }
            .sortedBy { it.second ?: -1 }
        for ((dr, m) in tagesReisen) {
            if (dienstMinute != null && m != null && m >= dienstMinute) continue
            r.reisen += dr to cursor
            cursor += reiseBlockHoehe(dr) + DIENST_LISTE
        }
        val reisenWarte = ArrayDeque(tagesReisen.filter { dienstMinute != null && it.second != null && it.second!! >= dienstMinute })
        for (a in starts) {
            r.dienste += DienstEintrag(a, cursor, "start")
            cursor += (if (hatTreffpunktOrt(a)) DIENST_START_ORT else DIENST_ZEILE) + KARTEN_ABSTAND
        }
        // Pausen des angenommenen Dienstes warten, bis ihre Uhrzeit zwischen den Fahrten dran ist.
        val pausenWarte = ArrayDeque(alleDienste.filter { it.angenommen }
            .flatMap { a -> offenePausen(a, jetzt).map { a to it } }.sortedBy { it.second.m })
        fun pausenBis(m: Double) {
            while (reisenWarte.isNotEmpty() && reisenWarte.first().second!! <= m) {
                val (dr, _) = reisenWarte.removeFirst()
                r.reisen += dr to cursor
                cursor += reiseBlockHoehe(dr) + KARTEN_ABSTAND
            }
            while (pausenWarte.isNotEmpty() && pausenWarte.first().second.m <= m) {
                val (a, z) = pausenWarte.removeFirst()
                r.dienste += DienstEintrag(a, cursor, "pause", z)
                cursor += DIENST_ZEILE + KARTEN_ABSTAND
            }
        }
        val tagesFahrten = fahrtenProTag[tag].orEmpty()
        for (f in tagesFahrten) {
            val fm = minuten(f.etd)
            if (fm != Int.MAX_VALUE) pausenBis(fm.toDouble())
            val mitKnoepfen = f.wartetAufAntwort
            r.fahrten += Triple(f, cursor, mitKnoepfen)
            val h = hoehe(f)
            cursor += if (mitKnoepfen) h + KNOPF_ABSTAND + KNOPF_HOEHE + NACH_KNOPF else h + KARTEN_ABSTAND
            if (f.danachDienstende) {
                r.fahrtEnden += f to cursor
                cursor += DIENST_ZEILE + KARTEN_ABSTAND
            }
        }
        pausenBis(Double.POSITIVE_INFINITY)
        // Mit "Danach Dienstende" steht das Dienstende schon unter der Fahrt.
        val endeUnterFahrt = tagesFahrten.any { it.danachDienstende }
        for (a in alleDienste.filter { !endeUnterFahrt && it.angenommen && zeigeEnde(it, jetzt, vorbei) }) {
            r.dienste += DienstEintrag(a, cursor, "ende")
            cursor += DIENST_ZEILE + KARTEN_ABSTAND
        }
        for (e in stundenProTag[tag].orEmpty()) {
            if (tagesFahrten.isNotEmpty()) cursor += KARTEN_ABSTAND
            r.stunden += e to cursor
            cursor += heuteKartenHoehe(e) + KARTEN_ABSTAND
        }
    }
    r.unterkante = cursor
    return r
}

/**
 * Nachbau von FahrtenScreen01View.jsx wie FahrtenListeAnsicht.swift: Fahrzeugkarte, Tageszeilen,
 * Dienstanfragen, Auftragskarten. Alle Masse aus dem Web-Code (Raster 402).
 */
@Composable
internal fun FahrtenListeSeite(
    speicher: FahrtenSpeicher,
    oeffneProfil: () -> Unit,
    oeffneFahrzeug: () -> Unit,
    oeffneFahrt: (Fahrt) -> Unit,
    fahrerID: String,
    /** Dienststart mit Treffpunkt angetippt: Karte und Notiz wie bei einer Fahrt. */
    oeffneDienst: (DienstAnfrage) -> Unit = {},
    /** Dienstreise angetippt: Karte mit Strecke, Abfahrt und Ankunft wie bei einer Fahrt. */
    oeffneDienstreise: (FahrerDienstreise) -> Unit = {},
    stundenBearbeiten: (de.trisar.kern.Stunden.Eintrag) -> Unit,
    stundenAblehnen: (de.trisar.kern.Stunden.Eintrag) -> Unit,
) {
    val fahrten by speicher.fahrten.collectAsState()
    val anfragen by speicher.dienstAnfragen.collectAsState()
    val fahrzeug by speicher.fahrzeug.collectAsState()
    val arbeitet by speicher.arbeitet.collectAsState()
    val dienstArbeitet by speicher.dienstArbeitetID.collectAsState()
    val ungelesen by speicher.ungelesen.collectAsState()
    val fehler by speicher.fehler.collectAsState()
    var ablehnenFahrt by remember { mutableStateOf<Fahrt?>(null) }

    val kartenHoehe = kartenHoeheMesser()
    val fahrzeugHoehe = de.trisar.kern.fahrzeugKartenHoehe(fahrzeug, ctx = androidx.compose.ui.platform.LocalContext.current)
    val stundenAlle by StundenSpeicher.eintraege.collectAsState()
    val stundenFehler by StundenSpeicher.fehler.collectAsState()
    val stundenKarten = remember(stundenAlle) { StundenSpeicher.karten(stundenAlle) }
    val stundenScope = androidx.compose.runtime.rememberCoroutineScope()
    // Halbminutentakt, damit Pausen und Dienstende weiterruecken.
    var jetzt by remember { mutableStateOf(java.time.Instant.now()) }
    androidx.compose.runtime.LaunchedEffect(Unit) {
        while (true) { kotlinx.coroutines.delay(30_000); jetzt = java.time.Instant.now() }
    }
    val standbys by StandbySpeicher.liste.collectAsState()
    val standbyFehler by StandbySpeicher.fehler.collectAsState()
    val reisen by DienstreiseSpeicher.liste.collectAsState()
    val reiseFehler by DienstreiseSpeicher.fehler.collectAsState()
    // Endzeit vorbei, Stundenkarte aber noch nicht geladen: Stunden einmal neu holen, dann wechselt es.
    val nachgeladen = remember { mutableSetOf<String>() }
    androidx.compose.runtime.LaunchedEffect(jetzt, anfragen, stundenAlle) {
        val vorbei = stundenAlle.associate { it.dienst.id.lowercase() to it.vorbei }
        val faellig = anfragen.filter { a ->
            a.angenommen && a.id.lowercase() !in nachgeladen && vorbei[a.id.lowercase()] == false
                && dienstZeiten(a).second?.isAfter(jetzt) == false
        }
        if (faellig.isNotEmpty()) { nachgeladen += faellig.map { it.id.lowercase() }; StundenSpeicher.laden() }
    }
    val raster = remember(fahrten, anfragen, fahrzeugHoehe, stundenKarten, stundenAlle, jetzt, standbys, reisen) {
        rasterBerechnen(fahrten, anfragen, stundenKarten, kartenHoehe, fahrzeugHoehe, jetzt, standbys,
            stundenAlle.associate { it.dienst.id.lowercase() to it.vorbei }, reisen)
    }

    Box(Modifier.fillMaxSize()) {
        Leinwand(inhaltHoehe = raster.unterkante + VERSATZ + NACH_KNOPF + 64f + 40f) {
            Icon("trisar_logo", Modifier.platz(20f, VERSATZ + 70f, 162f, 24f))
            ProfilKnopf(Modifier.platz(402f - 20f - 52f, VERSATZ + 40f), oeffneProfil)

            FahrzeugKarte(fahrzeug, fahrzeug?.license_plate ?: "Kein Kennzeichen",
                Modifier.platz(20f, VERSATZ + 118f).tippen(oeffneFahrzeug))

            for ((datum, oben) in raster.zeilen) Tageszeile(datum, Modifier.platz(20f, VERSATZ + oben, 362f, TAG_HOEHE))

            for (d in raster.dienste) {
                val anfrage = d.anfrage
                val oben = d.oben
                val art = d.art
                val z = d.zeile
                if (art == "pause" && z != null) {
                    // Pausenstart/-ende des angenommenen Dienstes, nach Uhrzeit zwischen den Fahrten.
                    Box(Modifier.platz(20f, VERSATZ + oben, 362f, DIENST_ZEILE).border(1.dp, z.farbe).padding(horizontal = 16.dp), contentAlignment = Alignment.CenterStart) {
                        Text(z.text, style = grotesk(24f, 700, zeilenHoehe = 24f, abstand = 0.6f, farbe = z.farbe), maxLines = 1)
                    }
                    continue
                }
                val tp = anfrage.treffpunkt
                if (art == "start" && tp != null) {
                    // Dienststart mit Treffpunkt (Figma 2908-12498): Lime-Rahmen, darunter Icon-Kachel
                    // und Ort. Antippen oeffnet Karte und Notiz wie bei einer Fahrt.
                    val lime = hex(0xE3F654)
                    val mitOrt = hatTreffpunktOrt(anfrage)
                    Box(Modifier.platz(20f, VERSATZ + oben, 362f, if (mitOrt) DIENST_START_ORT else DIENST_ZEILE).border(1.dp, lime).tippen { oeffneDienst(anfrage) }) {
                        Text("Dienststart ${anfrage.service_start_time.orEmpty().take(5)}",
                            style = grotesk(24f, 700, zeilenHoehe = 24f, abstand = 0.6f, farbe = lime), maxLines = 1,
                            modifier = Modifier.platz(16f, if (mitOrt) 14f else 12f))
                        if (mitOrt) {
                            Box(Modifier.platz(12f, 46f, 44f, 44f).background(hex(0x242525), RoundedCornerShape(12.dp)), contentAlignment = Alignment.Center) {
                                Icon(tp.iconGrau, Modifier.size(24.dp))
                            }
                            Box(Modifier.platz(76f, 46f, 362f - 76f - 12f, 44f), contentAlignment = Alignment.CenterStart) {
                                Text(tp.name, style = grotesk(18f, 700, zeilenHoehe = 20f, abstand = -0.5f), maxLines = 1,
                                    overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis)
                            }
                        }
                    }
                    continue
                }
                if (art == "start" || art == "ende") {
                    val farbe = if (art == "start") hex(0xE3F654) else hex(0xFF6F63)
                    val zeit = (if (art == "start") anfrage.service_start_time else anfrage.service_end_time).orEmpty().take(5)
                    Box(Modifier.platz(20f, VERSATZ + oben, 362f, DIENST_ZEILE).border(1.dp, farbe).padding(horizontal = 16.dp), contentAlignment = Alignment.CenterStart) {
                        Text(if (art == "start") "Dienststart $zeit" else "Dienstende $zeit",
                            style = grotesk(24f, 700, zeilenHoehe = 24f, abstand = 0.6f, farbe = farbe), maxLines = 1)
                    }
                    continue
                }
                DienstKarte(anfrage, dienstArbeitet == anfrage.id, Modifier.platz(20f, VERSATZ + oben, 362f), { oeffneDienst(anfrage) }) { annehmen ->
                    speicher.dienstAntworten(anfrage, annehmen)
                }
            }

            for ((fe, oben) in raster.fahrtEnden) {
                androidx.compose.runtime.key("fahrtende-${fe.id}") {
                    // Vor dem Ende ohne Zeit, danach mit der echten Ankunft (Europe/Berlin).
                    val rot = hex(0xFF6F63)
                    val zeit = fe.ankunftEcht?.let { Datum.ausISO(it) }?.let {
                        java.time.format.DateTimeFormatter.ofPattern("HH:mm").withZone(java.time.ZoneId.of("Europe/Berlin")).format(it)
                    }
                    Box(Modifier.platz(20f, VERSATZ + oben, 362f, DIENST_ZEILE).border(1.dp, rot).padding(horizontal = 16.dp), contentAlignment = Alignment.CenterStart) {
                        Text(if (zeit != null) "Dienstende $zeit" else "Danach Dienstende",
                            style = grotesk(24f, 700, zeilenHoehe = 24f, abstand = 0.6f, farbe = rot), maxLines = 1)
                    }
                }
            }

            for ((sb, oben) in raster.standbys) {
                androidx.compose.runtime.key("standby-${sb.id}") { StandbyKarte(sb, Modifier.platz(20f, VERSATZ + oben, 362f)) }
            }

            for ((dr, oben) in raster.reisen) {
                androidx.compose.runtime.key("reise-${dr.id}") { DienstreiseKarte(dr, Modifier.platz(20f, VERSATZ + oben, 362f)) { oeffneDienstreise(dr) } }
            }

            // Stunden am Ende des Diensttages
            for ((e, oben) in raster.stunden) {
                androidx.compose.runtime.key(e.dienst.id) {
                    // Stundenerfassung wie im Verlauf (Figma 2823-12431), Bearbeiten als Vollbild.
                    Box(Modifier.platz(20f, VERSATZ + oben, 362f)) {
                        HeuteStundenKarte(fahrerID, e, nachher = { stundenScope.launch { StundenSpeicher.laden() } }, vollbild = true)
                    }
                }
            }

            for ((fahrt, oben, mitKnoepfen) in raster.fahrten) {
                AuftragsKarte(
                    fahrt = fahrt,
                    mitKnoepfen = mitKnoepfen,
                    beschaeftigt = arbeitet,
                    ungelesen = fahrt.kolonnenID?.let { ungelesen[it] } ?: 0,
                    modifier = Modifier.platz(0f, VERSATZ + oben, 402f),
                    oeffnen = { oeffneFahrt(fahrt) },
                    annehmen = { speicher.antworten(fahrt, true) },
                    ablehnen = { ablehnenFahrt = fahrt },
                )
            }
        }
        FussleisteUnten()

        val f = fehler ?: stundenFehler ?: standbyFehler ?: reiseFehler
        if (f != null) {
            Box(Modifier.fillMaxWidth().padding(top = 50.dp).background(Farbe.fehler).tippen { speicher.fehler.value = null; StundenSpeicher.fehler.value = null; StandbySpeicher.fehler.value = null; DienstreiseSpeicher.fehler.value = null }.padding(12.dp),
                contentAlignment = Alignment.Center) {
                Text(f, style = grotesk(13f, 500, farbe = Color.Black), textAlign = TextAlign.Center)
            }
        }

        val ablehnen = ablehnenFahrt
        if (ablehnen != null) {
            Vollbild {
                AblehnenBlatt(schliessen = { ablehnenFahrt = null }) { notiz ->
                    ablehnenFahrt = null
                    speicher.antworten(ablehnen, false, notiz)
                }
            }
        }
    }
}

/** Linie — „Mittwoch 04.11.“ — Linie */
@Composable
private fun Tageszeile(datum: String, modifier: Modifier) {
    Row(modifier, verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(44.dp, 2.dp).background(Farbe.lime))
        Spacer(Modifier.weight(1f))
        Text(Datum.trennzeile(datum), style = grotesk(26f, 700, abstand = -0.5f, farbe = Farbe.lime), maxLines = 1)
        Spacer(Modifier.weight(1f))
        Box(Modifier.size(44.dp, 2.dp).background(Farbe.lime))
    }
}

/** Dienstplan-Anfrage: Dienststart (Lime), Pausen (Grau), Dienstende (Rot), einzeln oder zusammen.
 *  Erste Zeile gross, weitere kleiner. Darunter Ablehnen/Annehmen solange offen. */
@Composable
private fun DienstKarte(anfrage: DienstAnfrage, beschaeftigt: Boolean, modifier: Modifier, oeffnen: () -> Unit, antworten: (Boolean) -> Unit) {
    val zeilen = AnfrageZeile.zeilen(anfrage)
    val tp = anfrage.treffpunkt
    Column(modifier, verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Column(
            Modifier.size(362.dp, anfrageHoehe(anfrage).dp).background(hex(0x1A1A1A))
                .then(if (anfrage.angenommen) Modifier.border(2.dp, Farbe.lime) else Modifier)
                .padding(start = 12.dp, end = 12.dp, top = 19.dp),
            verticalArrangement = Arrangement.spacedBy(20.dp),
        ) {
            zeilen.forEachIndexed { i, z ->
                val g = z.groesse(i == 0)
                Text(z.text, style = grotesk(g, 700, zeilenHoehe = g, farbe = z.farbe), maxLines = 1, softWrap = false)
            }
            if (tp != null && ortInAnfrage(anfrage)) {
                // Treffpunkt wie in der Dienststart-Karte: Icon-Kachel und Ort (20 Luft aus spacedBy).
                Row(Modifier.fillMaxWidth().height(44.dp).tippen(oeffnen), verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(20.dp)) {
                    Box(Modifier.size(44.dp).background(hex(0x242525), RoundedCornerShape(12.dp)), contentAlignment = Alignment.Center) {
                        Icon(tp.iconGrau, Modifier.size(24.dp))
                    }
                    Text(tp.name, style = grotesk(18f, 700, zeilenHoehe = 20f, abstand = -0.5f), maxLines = 1,
                        overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis)
                }
            }
        }
        if (!anfrage.angenommen) AntwortKnoepfe(beschaeftigt, Modifier, { antworten(false) }, { antworten(true) })
    }
}

/** Ablehnen (roter Rand) und Annehmen (Lime), je 178 x 51, bei x 20 und 204. */
@Composable
private fun AntwortKnoepfe(beschaeftigt: Boolean, modifier: Modifier, ablehnen: () -> Unit, annehmen: () -> Unit) {
    Row(modifier.alpha(if (beschaeftigt) 0.6f else 1f), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        Box(Modifier.size(178.dp, 51.dp).border(2.dp, hex(0xFF6F63)).tippen { if (!beschaeftigt) ablehnen() }, contentAlignment = Alignment.Center) {
            Text("Ablehnen", style = grotesk(24f, 700, abstand = -0.5f, farbe = hex(0xFF6F63)))
        }
        Box(Modifier.size(178.dp, 51.dp).background(Farbe.lime).tippen { if (!beschaeftigt) annehmen() }, contentAlignment = Alignment.Center) {
            Text("Annehmen", style = grotesk(24f, 700, abstand = -0.5f, farbe = Color.Black))
        }
    }
}

/**
 * Auftragskarte (RideCard). Liegt ueber die volle Breite 402, damit die Web-Masse
 * (Icons bei x 53 und 276, Mitte 201) direkt passen.
 */
@Composable
private fun AuftragsKarte(
    fahrt: Fahrt,
    mitKnoepfen: Boolean,
    beschaeftigt: Boolean,
    ungelesen: Int,
    modifier: Modifier,
    oeffnen: () -> Unit,
    annehmen: () -> Unit,
    ablehnen: () -> Unit,
) {
    val iconMitte = 42f + 35f
    val zeigeEtd = fahrt.istFlughafen || fahrt.istZug
    val plan = fahrt.planEtd
    val zeigePlan = zeigeEtd && !plan.isNullOrEmpty()

    val h = kartenHoeheMesser()(fahrt)
    Box(modifier.height((if (mitKnoepfen) h + KNOPF_ABSTAND + KNOPF_HOEHE else h).dp)) {
        Box(
            Modifier.platz(20f, 0f, 362f, h).background(hex(0x1A1A1A))
                .then(if (fahrt.angenommen) Modifier.border(2.dp, Farbe.lime) else Modifier)
                .tippen(oeffnen)
        )

        // Tag oben mittig, mind. 90 breit, bei Kolonne mit Konvoi-Icon.
        Box(Modifier.width(402.dp).height(29.dp), contentAlignment = Alignment.TopCenter) {
            Row(
                Modifier.height(29.dp).widthIn(min = 90.dp).background(Farbe.lime).padding(horizontal = 10.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp, Alignment.CenterHorizontally),
            ) {
                Text(Datum.tagEtikett(fahrt.fahrtDatum), style = grotesk(18f, 700, abstand = -0.5f, farbe = Color.Black), maxLines = 1)
                if (fahrt.kolonnenID != null) Icon("Konvoi_Trisar_Icons_01", Modifier.size(23.dp, 18.dp))
            }
        }

        // Ungelesen im Kolonnen-Chat: roter Kreis 28 auf der oberen rechten Kartenecke.
        if (ungelesen > 0) {
            Box(Modifier.platz(354f, -12f, 28f, 28f).background(hex(0xFF6E63), CircleShape), contentAlignment = Alignment.Center) {
                Text(if (ungelesen > 9) "9+" else "$ungelesen", style = grotesk(18f, 700, farbe = hex(0x1A1A1A)), maxLines = 1)
            }
        }

        // Eigener Ort der Dispo: sein Icon, sonst Textmuster wie im Web.
        OrtIcon(EigeneOrte.iconGrau(fahrt.abholOrtID) ?: ortIcon(fahrt.abholName + " " + fahrt.abholAdresse + " " + fahrt.abholKurz, true), Modifier.platz(53f, 42f, 70f, 70f))
        OrtIcon(EigeneOrte.iconGrau(fahrt.zielOrtID) ?: ortIcon(fahrt.zielName + " " + fahrt.zielAdresse + " " + fahrt.zielKurz, false), Modifier.platz(276f, 42f, 70f, 70f))

        if (zeigeEtd) {
            Text("ETD", style = grotesk(10f, 700, abstand = -0.5f, farbe = Farbe.grauText), textAlign = TextAlign.Center,
                modifier = Modifier.mittig(201f, iconMitte - 30f, 40f))
        }
        Box(Modifier.mittig(201f, iconMitte - 15f, 100f, 30f), contentAlignment = Alignment.Center) {
            Text(fahrt.etd, style = grotesk(30f, 700, abstand = -0.5f, farbe = hex(0xE2F754)), maxLines = 1, softWrap = false)
        }
        if (zeigePlan) {
            Text("Plan $plan", style = grotesk(10f, abstand = -0.5f, farbe = hex(0xF4F5F4).copy(alpha = 0.5f)), textAlign = TextAlign.Center,
                modifier = Modifier.mittig(201f, iconMitte + 18f, 64f))
        }
        // Start Zeitraum: Ende klein unter der Zeit ("bis 14:30"), wie im Web.
        fahrt.etdBis?.let { bis ->
            Text("bis $bis", style = grotesk(12f, 700, abstand = -0.5f, farbe = hex(0xE2F754)), textAlign = TextAlign.Center,
                maxLines = 1, softWrap = false, modifier = Modifier.mittig(201f, iconMitte + (if (zeigePlan) 30f else 18f), 80f))
        }

        // Orte: links 40, rechts 39, Spalten 1fr | 29 | 1fr mit 18 Abstand.
        Row(Modifier.platz(40f, 127f, 402f - 40f - 39f), verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(18.dp)) {
            Text(fahrt.abholKurz, style = grotesk(16f, 700, abstand = -0.5f), textAlign = TextAlign.Start, modifier = Modifier.weight(1f))
            Icon("Arrow_Trisar_Icons_01_Lime", Modifier.size(29.dp, 20.dp).scale(1.15f))
            Text(fahrt.zielKurz, style = grotesk(16f, 700, abstand = -0.5f), textAlign = TextAlign.End, modifier = Modifier.weight(1f))
        }

        if (mitKnoepfen) AntwortKnoepfe(beschaeftigt, Modifier.platz(20f, h + 12f), ablehnen, annehmen)
    }
}

/** pickRideIcon der Web-App. */
private fun ortIcon(text: String, start: Boolean): String {
    val t = text.lowercase()
    if ("muc" in t || "flughafen" in t || "airport" in t || "terminal" in t) {
        return if (start) "Plain_Landen_Trisar_Icons_01_grau" else "Plain_Abflug_Trisar_Icons_01_grau"
    }
    if (Regex("\\b(hotel|resort|hostel|inn|motel|guesthouse|suite|aparthotel|residence)\\b").containsMatchIn(t)) return "House_Nav_Trisar_01_grau"
    return "Pin_Nav_Trisar_Icons_01_grau"
}

@Composable
private fun OrtIcon(name: String, modifier: Modifier) {
    Box(modifier.clip(RoundedCornerShape(12.dp)).background(hex(0x242525)), contentAlignment = Alignment.Center) {
        Icon(name, Modifier.size(30.dp))
    }
}


/**
 * Kartenhoehe wie AuftragsKarte.hoehe in iOS: 187 reicht fuer zwei Zeilen Ortsname, laengere
 * Namen machen die Karte hoeher (Text ab 127, 20 je Zeile, 20 Rand unten).
 * Gemessen mit genau der Schrift der Karte in der 129 breiten Spalte.
 */
@Composable
private fun kartenHoeheMesser(): (Fahrt) -> Float {
    val messer = androidx.compose.ui.text.rememberTextMeasurer()
    val stil = grotesk(16f, 700, abstand = -0.5f)
    val breite = with(androidx.compose.ui.platform.LocalDensity.current) { 129.dp.roundToPx() }
    return remember(messer, stil, breite) {
        val speicher = HashMap<String, Int>()
        fun zeilen(text: String): Int = if (text.isEmpty()) 1 else speicher.getOrPut(text) {
            messer.measure(text, stil, constraints = androidx.compose.ui.unit.Constraints(maxWidth = breite)).lineCount
        }
        val messen: (Fahrt) -> Float = { f -> maxOf(187f, 147f + 20f * maxOf(zeilen(f.abholKurz), zeilen(f.zielKurz))) }
        messen
    }
}
