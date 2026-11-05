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

// Konstanten aus FahrtenScreen01View.jsx
private const val VERSATZ = 20f            // <div className="absolute left-0 top-[20px]">
private const val FAHRZEUG_UNTERKANTE = 118f + 268f
private const val KARTEN_ABSTAND = 12f
private const val KNOPF_ABSTAND = 12f
private const val KNOPF_HOEHE = 51f
private const val NACH_KNOPF = 24f
private const val TAG_OBEN = 44f
private const val TAG_HOEHE = 32f
private const val TAG_UNTEN = 56f
private const val DIENST_HOEHE = 124f
private const val DIENST_ABSTAND = 12f
private const val DIENST_LISTE = 48f

private class ListenRaster {
    val zeilen = mutableListOf<Pair<String, Float>>()
    val dienste = mutableListOf<Pair<DienstAnfrage, Float>>()
    val fahrten = mutableListOf<Triple<Fahrt, Float, Boolean>>()
    var unterkante = 0f
}

/** buildListenLayout der Web-App. */
private fun rasterBerechnen(alle: List<Fahrt>, anfragen: List<DienstAnfrage>, hoehe: (Fahrt) -> Float): ListenRaster {
    fun minuten(zeit: String): Int {
        val t = zeit.split(":").mapNotNull { it.toIntOrNull() }
        return if (t.size >= 2) t[0] * 60 + t[1] else Int.MAX_VALUE
    }
    val fahrten = alle.sortedWith(compareBy<Fahrt>({ it.fahrtDatum }, { minuten(it.etd) }, { it.id }))
    val proTag = LinkedHashMap<String, MutableList<DienstAnfrage>>()
    for (a in anfragen) {
        val tag = a.service_date.orEmpty().take(10)
        if (tag.isEmpty()) continue
        proTag.getOrPut(tag) { mutableListOf() }.add(a)
    }
    val offeneTage = proTag.keys.toMutableSet()
    val r = ListenRaster()
    var cursor = FAHRZEUG_UNTERKANTE + TAG_UNTEN

    fun tagBeginnen(tag: String, erster: Boolean) {
        if (!erster) cursor += TAG_OBEN
        r.zeilen += tag to cursor
        cursor += TAG_HOEHE + TAG_UNTEN
        val liste = proTag[tag].orEmpty()
        liste.forEachIndexed { i, a ->
            r.dienste += a to cursor
            cursor += if (a.angenommen) DIENST_HOEHE else DIENST_HOEHE + KNOPF_ABSTAND + KNOPF_HOEHE
            if (i < liste.size - 1) cursor += DIENST_ABSTAND
        }
        if (liste.isNotEmpty()) cursor += DIENST_LISTE
        offeneTage.remove(tag)
    }

    var letzterTag: String? = null
    fahrten.forEachIndexed { i, f ->
        if (f.fahrtDatum != letzterTag) {
            tagBeginnen(f.fahrtDatum, i == 0)
            letzterTag = f.fahrtDatum
        }
        val mitKnoepfen = f.wartetAufAntwort
        r.fahrten += Triple(f, cursor, mitKnoepfen)
        val h = hoehe(f)
        cursor += if (mitKnoepfen) h + KNOPF_ABSTAND + KNOPF_HOEHE + NACH_KNOPF else h + KARTEN_ABSTAND
    }
    for (tag in offeneTage.sorted()) tagBeginnen(tag, r.zeilen.isEmpty())
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
    val raster = remember(fahrten, anfragen) { rasterBerechnen(fahrten, anfragen, kartenHoehe) }

    Box(Modifier.fillMaxSize()) {
        Leinwand(inhaltHoehe = raster.unterkante + VERSATZ + NACH_KNOPF + 64f + 40f) {
            Icon("trisar_logo", Modifier.platz(20f, VERSATZ + 70f, 162f, 24f))
            ProfilKnopf(Modifier.platz(402f - 20f - 52f, VERSATZ + 40f), oeffneProfil)

            FahrzeugKarte(fahrzeug, fahrzeug?.license_plate ?: "Kein Kennzeichen",
                Modifier.platz(20f, VERSATZ + 118f).tippen(oeffneFahrzeug))

            for ((datum, oben) in raster.zeilen) Tageszeile(datum, Modifier.platz(20f, VERSATZ + oben, 362f, TAG_HOEHE))

            for ((anfrage, oben) in raster.dienste) {
                DienstKarte(anfrage, dienstArbeitet == anfrage.id, Modifier.platz(20f, VERSATZ + oben, 362f)) { annehmen ->
                    speicher.dienstAntworten(anfrage, annehmen)
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

        val f = fehler
        if (f != null) {
            Box(Modifier.fillMaxWidth().padding(top = 50.dp).background(Farbe.fehler).tippen { speicher.fehler.value = null }.padding(12.dp),
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

/** Dienstplan-Anfrage (Dienststart/Dienstende), darunter Ablehnen/Annehmen solange offen. */
@Composable
private fun DienstKarte(anfrage: DienstAnfrage, beschaeftigt: Boolean, modifier: Modifier, antworten: (Boolean) -> Unit) {
    Column(modifier, verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Column(
            Modifier.size(362.dp, 124.dp).background(hex(0x1A1A1A))
                .then(if (anfrage.angenommen) Modifier.border(2.dp, Farbe.lime) else Modifier)
                .padding(start = 12.dp, end = 12.dp, top = 19.dp),
            verticalArrangement = Arrangement.spacedBy(20.dp),
        ) {
            val start = anfrage.service_start_time
            if (!start.isNullOrEmpty()) Text("Dienststart ${start.take(5)}", style = grotesk(38f, 700, farbe = hex(0xE3F654)), maxLines = 1)
            val ende = anfrage.service_end_time
            if (!ende.isNullOrEmpty()) Text("Dienstende ${ende.take(5)}", style = grotesk(24f, 700, farbe = hex(0xFF6F63)), maxLines = 1)
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

        OrtIcon(ortIcon(fahrt.abholName + " " + fahrt.abholAdresse + " " + fahrt.abholKurz, true), Modifier.platz(53f, 42f, 70f, 70f))
        OrtIcon(ortIcon(fahrt.zielName + " " + fahrt.zielAdresse + " " + fahrt.zielKurz, false), Modifier.platz(276f, 42f, 70f, 70f))

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
