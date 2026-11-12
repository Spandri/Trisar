package de.trisar.fahrer.haupt

import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.snapping.rememberSnapFlingBehavior
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.ime
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import de.trisar.kern.FussleisteUnten
import de.trisar.kern.GaesteAnzeige
import de.trisar.kern.Icon
import de.trisar.kern.Stunden
import de.trisar.kern.ZurueckKnopf
import de.trisar.kern.grotesk
import de.trisar.kern.hex
import de.trisar.kern.tippen
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.filter
import kotlinx.coroutines.launch

/*
 * Stundenerfassung im Fahrer (wie Stunden.jsx und StundenAnsicht.swift): eine Karte am Ende jedes
 * Diensttages, gebaut wie die Dienstkarte (dunkle Flaeche, grosse Zeiten), darin die Fahrten des
 * Dienstes. Darunter Ablehnen, Bearbeiten, Annehmen wie bei Diensten und Fahrten.
 * Zeiten immer auf halbe Stunden gerundet.
 */

private val LIME = hex(0xE3F654)
private val ROT = hex(0xFF6F63)
private val ORANGE = hex(0xFFCD8A)
private val GRUEN = hex(0x8DFFAF)
private val FLAECHE = hex(0x1A1A1A)

/** Offene und eingereichte Stunden der letzten zwei Wochen fuer die Fahrtenliste (StundenSpeicher in iOS). */
internal object StundenSpeicher {
    val eintraege = MutableStateFlow<List<Stunden.Eintrag>>(emptyList())
    val arbeitetID = MutableStateFlow<String?>(null)
    val fehler = MutableStateFlow<String?>(null)

    /** Karten fuer die Startseite: Dienst vorbei, noch nicht bestaetigt. */
    /** Vorbei und noch nicht bestaetigt, dazu der laufende Dienst von heute (Figma 2823-12431). */
    fun karten(liste: List<Stunden.Eintrag>): List<Stunden.Eintrag> = liste.filter {
        (it.vorbei && it.zettel?.status != "bestaetigt")
            || (!it.vorbei && it.dienst.datum == Stunden.heuteDatum() && Stunden.heute(it) != null)
    }

    suspend fun laden() {
        eintraege.value = try { Stunden.verlauf(null, 14) } catch (e: kotlinx.coroutines.CancellationException) { throw e } catch (e: Exception) { eintraege.value }
    }

    suspend fun annehmen(fahrerID: String, e: Stunden.Eintrag) {
        val z = e.zettel
        if (z != null && z.status == "dispo_geaendert") { ausfuehren(e) { Stunden.dispoAenderungAnnehmen(z.id) }; return }
        val v = e.vorschlag
        if (v.beginn.isEmpty() || v.ende.isEmpty()) { fehler.value = "Kein Vorschlag, bitte bearbeiten."; return }
        ausfuehren(e) { Stunden.speichern(fahrerID, e, v.beginn, v.ende, v.pauseMin, angepasst = false, begruendung = null) }
    }

    suspend fun ablehnen(fahrerID: String, e: Stunden.Eintrag, grund: String) {
        val b = e.vorschlag.beginn.ifEmpty { null } ?: Stunden.zuZeitpunkt(e.dienst.datum, e.dienst.beginn.ifEmpty { "00:00" }) ?: java.time.Instant.now().toString()
        ausfuehren(e) { Stunden.speichern(fahrerID, e, b, b, 0, angepasst = true, begruendung = "Abgelehnt: " + grund.trim()) }
    }

    private suspend fun ausfuehren(e: Stunden.Eintrag, arbeit: suspend () -> Unit) {
        arbeitetID.value = e.dienst.id
        try {
            arbeit()
            fehler.value = null
        } catch (ex: kotlinx.coroutines.CancellationException) {
            throw ex
        } catch (ex: Exception) {
            fehler.value = "Speichern fehlgeschlagen: " + ((ex as? io.github.jan.supabase.exceptions.RestException)?.error ?: ex.message ?: "")
        }
        laden()
        arbeitetID.value = null
    }
}

/** Linie — „Mittwoch 04.11.“ — Linie (wie in der Fahrtenliste). */
@Composable
internal fun StundenTageszeile(datum: String, modifier: Modifier = Modifier) {
    Row(modifier.width(362.dp).height(32.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(44.dp, 2.dp).background(LIME))
        Spacer(Modifier.weight(1f))
        Text(Stunden.tagTitel(datum), style = grotesk(26f, 700, abstand = -0.5f, farbe = LIME), maxLines = 1)
        Spacer(Modifier.weight(1f))
        Box(Modifier.size(44.dp, 2.dp).background(LIME))
    }
}

// MARK: Karte

internal object StundenKarteMass {
    const val KOPF = 124f
    const val ZEILE = 46f
    const val ZEILEN_ABSTAND = 8f

    /** Knoepfe solange offen oder von der Dispo zurueckgegeben. */
    fun mitKnoepfen(e: Stunden.Eintrag): Boolean = e.offen

    fun notiz(e: Stunden.Eintrag): String? {
        val z = e.zettel ?: return null
        if (z.status == "zurueckgewiesen" && z.dispoNotiz.isNotEmpty()) return "Dispo: " + z.dispoNotiz
        if (z.begruendung.isNotEmpty()) return z.begruendung
        return null
    }

    /** Hoehe der dunklen Karte (ohne Knoepfe). */
    fun kartenHoehe(e: Stunden.Eintrag): Float {
        val n = e.vorschlag.fahrten.size
        var h = KOPF
        if (n > 0) h += 1 + 14 + n * ZEILE + (n - 1) * ZEILEN_ABSTAND + 16
        if (notiz(e) != null) h += 30
        return h
    }

    fun hoehe(e: Stunden.Eintrag): Float = kartenHoehe(e) + if (mitKnoepfen(e)) 12f + 51f else 0f
}

/** Die Stundenkarte. Breite 362, Hoehe aus StundenKarteMass.hoehe (fuer das Raster der Fahrtenliste). */
@Composable
internal fun StundenKarte(
    eintrag: Stunden.Eintrag,
    modifier: Modifier = Modifier,
    beschaeftigt: Boolean = false,
    annehmen: () -> Unit,
    bearbeiten: () -> Unit,
    ablehnen: () -> Unit,
) {
    val z = eintrag.zettel
    val v = eintrag.vorschlag
    val arbeitsMin = z?.arbeitsMin ?: v.arbeitsMin
    val beginn = Stunden.uhr(z?.beginn ?: v.beginn)
    val ende = Stunden.uhr(z?.ende ?: v.ende)
    val pauseMin = z?.pauseMin ?: v.pauseMin
    val rand = when (z?.status) { "eingereicht" -> LIME; "zurueckgewiesen" -> ROT; "dispo_geaendert" -> ORANGE; else -> Color.Transparent }
    val etikett = when (z?.status) {
        "eingereicht" -> "Eingereicht" to LIME
        "dispo_geaendert" -> "Von Dispo geändert" to ORANGE
        "zurueckgewiesen" -> "Zurückgegeben" to ROT
        "bestaetigt" -> "Bestätigt" to GRUEN
        else -> null
    }
    val notiz = StundenKarteMass.notiz(eintrag)

    Column(modifier.width(362.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Column(Modifier.width(362.dp).height(StundenKarteMass.kartenHoehe(eintrag).dp).background(FLAECHE).border(2.dp, rand)) {
            // Kopf wie die Dienstkarte: grosse Zeile Lime, darunter Zeiten
            Column(Modifier.height(StundenKarteMass.KOPF.dp).padding(start = 12.dp, end = 12.dp, top = 19.dp), verticalArrangement = Arrangement.spacedBy(20.dp)) {
                Row(verticalAlignment = Alignment.Bottom) {
                    Text("Stunden ${Stunden.hmm(arbeitsMin)}", style = grotesk(38f, 700, farbe = LIME), maxLines = 1, softWrap = false)
                    Spacer(Modifier.weight(1f))
                    if (etikett != null) Text(etikett.first, style = grotesk(13f, 700, farbe = etikett.second), modifier = Modifier.padding(bottom = 8.dp))
                }
                Text("$beginn – $ende" + if (pauseMin > 0) " · Pause ${Stunden.hmm(pauseMin)}" else "",
                    style = grotesk(24f, 700, farbe = Color.White), maxLines = 1, softWrap = false)
            }
            if (v.fahrten.isNotEmpty()) {
                Box(Modifier.padding(horizontal = 12.dp).fillMaxWidth().height(1.dp).background(Color.White.copy(alpha = 0.1f)))
                Column(Modifier.padding(start = 12.dp, end = 12.dp, top = 14.dp, bottom = 16.dp), verticalArrangement = Arrangement.spacedBy(StundenKarteMass.ZEILEN_ABSTAND.dp)) {
                    v.fahrten.forEach { f -> FahrtZeile(f) }
                }
            }
            if (notiz != null) {
                Text(notiz, style = grotesk(13f, 500, farbe = if (z?.status == "zurueckgewiesen") ROT else ORANGE), maxLines = 1,
                    overflow = TextOverflow.Ellipsis, modifier = Modifier.height(18.dp).padding(horizontal = 12.dp))
            }
        }
        if (StundenKarteMass.mitKnoepfen(eintrag)) StundenKnoepfe(beschaeftigt, ablehnen, bearbeiten, annehmen)
    }
}

/** Eine Fahrt: Planzeit gross in Lime, Strecke, darunter gefahrene Zeit und Gaeste. */
@Composable
private fun FahrtZeile(f: Stunden.Fahrt) {
    Row(Modifier.fillMaxWidth().height(StundenKarteMass.ZEILE.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(f.zeit.ifEmpty { Stunden.uhr(f.start) }, style = grotesk(18f, 700, farbe = LIME), maxLines = 1, modifier = Modifier.width(52.dp))
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(f.von, style = grotesk(16f, 700, abstand = -0.5f, farbe = Color.White), maxLines = 1, overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f, fill = false))
                Icon("Arrow_Trisar_Icons_01_Lime", Modifier.size(18.dp, 12.dp))
                Text(f.nach, style = grotesk(16f, 700, abstand = -0.5f, farbe = Color.White), maxLines = 1, overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f, fill = false))
            }
            Text(
                listOf("${Stunden.uhr(f.start)} – ${Stunden.uhr(f.ende)}" + if (!f.genau) " geplant" else " gefahren", f.gaeste)
                    .filter { it.isNotEmpty() }.joinToString(" · "),
                style = grotesk(12f, 500, farbe = Color.White.copy(alpha = 0.5f)), maxLines = 1, overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

/** Ablehnen (roter Rand), Bearbeiten (Lime-Rand), Annehmen (Lime), zusammen 362 breit, 51 hoch. */
@Composable
private fun StundenKnoepfe(beschaeftigt: Boolean, ablehnen: () -> Unit, bearbeiten: () -> Unit, annehmen: () -> Unit) {
    val breite = ((362f - 12f) / 3f).dp
    Row(Modifier.alpha(if (beschaeftigt) 0.6f else 1f), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        Box(Modifier.size(breite, 51.dp).border(2.dp, ROT).tippen { if (!beschaeftigt) ablehnen() }, contentAlignment = Alignment.Center) {
            Text("Ablehnen", style = grotesk(20f, 700, abstand = -0.5f, farbe = ROT), maxLines = 1)
        }
        Box(Modifier.size(breite, 51.dp).border(2.dp, LIME).tippen { if (!beschaeftigt) bearbeiten() }, contentAlignment = Alignment.Center) {
            Text("Bearbeiten", style = grotesk(20f, 700, abstand = -0.5f, farbe = LIME), maxLines = 1)
        }
        Box(Modifier.size(breite, 51.dp).background(LIME).tippen { if (!beschaeftigt) annehmen() }, contentAlignment = Alignment.Center) {
            Text("Annehmen", style = grotesk(20f, 700, abstand = -0.5f, farbe = Color.Black), maxLines = 1)
        }
    }
}

/** Notizseite zum Ablehnen, wie „Fahrt stornieren“ (NotizBlatt), Titel und Knopf rot. */
@Composable
internal fun StundenAblehnenBlatt(schliessen: () -> Unit, senden: (String) -> Unit) {
    NotizBlatt(
        titel = "Warum stimmen die Stunden nicht?", titelFarbe = ROT,
        knopf = "Ablehnen senden", knopfFarbe = ROT,
        schliessen = schliessen, bestaetigen = senden,
    )
}

// MARK: Verlauf

/** Weisse Fahrtkarte wie EntryCard im Demo-Verlauf (Verlauf.jsx): Datum und Uhrzeit, darunter die Gaeste. */
@Composable
private fun VerlaufFahrtKarte(f: Verlauf.Fahrt) {
    val namen = GaesteAnzeige.zeilen(f.gaeste, f.anonym)
    val dunkel = hex(0x18181B)
    val hoehe = when { namen.size > 2 -> Modifier; namen.size > 1 -> Modifier.height(112.dp); else -> Modifier.height(96.dp) }
    Column(
        Modifier.width(362.dp).then(hoehe).background(Color.White)
            .padding(horizontal = 16.dp, vertical = if (namen.size > 2) 18.dp else 10.dp),
        verticalArrangement = Arrangement.spacedBy(5.dp, Alignment.CenterVertically),
    ) {
        Text(Verlauf.kartenZeile(f), style = grotesk(14f, 500, zeilenHoehe = 16f, abstand = 0.35f, farbe = dunkel.copy(alpha = 0.8f)), maxLines = 1)
        Column {
            namen.forEach { name ->
                Text(name, style = grotesk(24f, 700, zeilenHoehe = if (namen.size > 1) 28f else 24f, abstand = 0.6f, farbe = dunkel), maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
    }
}

/** Rahmenzeile Dienststart (Lime) bzw. Dienstende (Rot) wie StatusRow im Demo-Verlauf. */
@Composable
private fun VerlaufRahmenZeile(text: String, farbe: Color, modifier: Modifier = Modifier) {
    Box(modifier.width(362.dp).height(48.dp).border(1.dp, farbe).padding(horizontal = 16.dp), contentAlignment = Alignment.CenterStart) {
        Text(text, style = grotesk(24f, 700, zeilenHoehe = 24f, abstand = 0.6f, farbe = farbe), maxLines = 1)
    }
}

/**
 * Verlauf (Profil -> Verlauf, wie Verlauf.jsx): erledigte Fahrten nach Tagen, neueste zuerst. Dienste aus der
 * Stundenerfassung stehen als Rahmen (Dienststart, Fahrten, Dienstende) mit Stundenkarte darin.
 */
/**
 * Heute (Figma 2837-12573, wie HeuteStunden in Stunden.jsx): Karte 362 x 220 mit Start, begonnenen
 * Pausen und nach dem Dienst Ende, immer mittig. Darunter die Arbeitszeit, die jede Minute hochrollt.
 * Fertig (Dienstende, keine Fahrt mehr unterwegs, Figma 2838-12842): Bearbeiten und Bestaetigen.
 * Bearbeiten macht die Zeiten antippbar, dazu Notiz wie beim Stornieren und „Anfrage senden“.
 * Rand Lime bis bestaetigt bzw. gesendet, dann gruen, von der Dispo zurueckgegeben rot.
 */
private class HeuteWerte(val start: java.time.Instant, val ende: java.time.Instant, val pausen: List<Pair<java.time.Instant, java.time.Instant>>)

/** Hoehe im Raster der Fahrtenliste: Karte 220, Statuszeile 10 + 20, Knoepfe 10 + 56. */
internal fun heuteKartenHoehe(e: Stunden.Eintrag): Float {
    val s = Stunden.heute(e) ?: return 0f
    val z = e.zettel
    val offen = s.fertig && Stunden.fahrerDran(z)
    return 220f + (if (s.fertig && z != null) 30f else 0f) + (if (offen) 66f else 0f)
}

/**
 * vollbild: in der Fahrtenliste (festes Raster) oeffnet Bearbeiten ein Vollbild statt unter der Karte.
 * startetBearbeitet/schliessen: das Vollbild selbst (startet im Bearbeiten-Modus, Abbrechen schliesst).
 */
@Composable
internal fun HeuteStundenKarte(
    fahrerID: String, e: Stunden.Eintrag, nachher: () -> Unit,
    vollbild: Boolean = false, startetBearbeitet: Boolean = false, schliessen: (() -> Unit)? = null,
) {
    var jetzt by remember { mutableStateOf(java.time.Instant.now()) }
    var zeigeVollbild by remember { mutableStateOf(false) }
    var werte by remember(e.dienst.id) {
        mutableStateOf<HeuteWerte?>(if (!startetBearbeitet) null else Stunden.heute(e)?.let { s ->
            val ende = s.ende ?: s.start
            HeuteWerte(s.start, ende, s.pausen.map { it.von to (it.bis ?: ende) })
        })
    }
    var notiz by remember(e.dienst.id) { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var fehler by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    val kontext = androidx.compose.ui.platform.LocalContext.current
    val s0 = Stunden.heute(e, jetzt)
    LaunchedEffect(s0?.fertig) {
        while (s0?.fertig != true) { kotlinx.coroutines.delay(1000); jetzt = java.time.Instant.now() }
    }
    if (s0 == null) return
    val z = e.zettel
    val offen = s0.fertig && Stunden.fahrerDran(z)
    val w = werte
    val arbeits = if (w == null) s0.arbeitsMin
        else Stunden.halbeAuf(java.time.Duration.between(w.start, w.ende).seconds / 60.0 - Stunden.pausenMin(w.pausen.map { it.first to it.second }, w.ende))
    val zeit = "%02d:%02d".format(arbeits / 60, arbeits % 60)
    val zahl = hex(0xE2F754)
    val grau = hex(0x5F5F5F)
    val gruen = hex(0x59BE80)
    val rotKnopf = hex(0xFF6F63)
    val rand = if (!s0.fertig || w != null || z == null) LIME else if (z.status == "zurueckgewiesen") ROT else if (z.status == "dispo_geaendert") ORANGE else gruen

    // Uhrzeit-Auswahl des Geraets, behaelt den Tag (Europe/Berlin).
    fun waehlen(t: java.time.Instant, setzen: (java.time.Instant) -> Unit) {
        val z0 = t.atZone(Stunden.BERLIN)
        android.app.TimePickerDialog(kontext, { _, h, m -> setzen(z0.withHour(h).withMinute(m).withSecond(0).withNano(0).toInstant()) }, z0.hour, z0.minute, true).show()
    }

    @Composable
    fun kasten(titel: String, oben: java.time.Instant?, unten: java.time.Instant? = null, istGrau: Boolean = false,
               setOben: ((java.time.Instant) -> Unit)? = null, setUnten: ((java.time.Instant) -> Unit)? = null) {
        val aktiv = setOben != null
        val farbe = if (istGrau) (if (aktiv) Color.White else grau) else zahl
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Column(
                Modifier.size(78.dp).background(hex(0x242525), androidx.compose.foundation.shape.RoundedCornerShape(12.dp))
                    .then(if (aktiv) Modifier.border(2.dp, LIME, androidx.compose.foundation.shape.RoundedCornerShape(12.dp)) else Modifier),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(4.5.dp, Alignment.CenterVertically),
            ) {
                val gross = if (istGrau) 17f else 22f
                Text(Stunden.uhrZeit(oben), style = grotesk(gross, 700, abstand = -0.5f, farbe = farbe),
                    modifier = if (setOben != null && oben != null) Modifier.tippen { waehlen(oben, setOben) } else Modifier)
                if (unten != null) Text(Stunden.uhrZeit(unten), style = grotesk(gross, 700, abstand = -0.5f, farbe = farbe),
                    modifier = if (setUnten != null) Modifier.tippen { waehlen(unten, setUnten) } else Modifier)
            }
            Text(titel, style = grotesk(16f, 700, zeilenHoehe = 20f, abstand = -0.5f, farbe = if (istGrau) grau else Color.White), modifier = Modifier.padding(top = 8.dp))
        }
    }

    /** Aenderung der Dispo annehmen (Stand dispo_geaendert): fertig, keine neue Einreichung. */
    fun zustimmen(zettelID: String) {
        busy = true; fehler = null
        scope.launch {
            try {
                Stunden.dispoAenderungAnnehmen(zettelID)
                nachher()
            } catch (x: kotlinx.coroutines.CancellationException) { throw x } catch (x: Exception) {
                fehler = "Speichern fehlgeschlagen: ${x.message}"
            }
            busy = false
        }
    }

    fun senden(beginn: java.time.Instant, ende0: java.time.Instant, pausen: List<Pair<java.time.Instant, java.time.Instant>>, angepasst: Boolean, begruendung: String? = null) {
        val ende = if (!ende0.isAfter(beginn)) ende0.plusSeconds(86400) else ende0 // Nachtdienst
        busy = true; fehler = null
        scope.launch {
            try {
                Stunden.heuteSpeichern(fahrerID, e, beginn, ende, pausen, angepasst, begruendung)
                werte = null
                nachher()
            } catch (x: kotlinx.coroutines.CancellationException) { throw x } catch (x: Exception) {
                fehler = "Speichern fehlgeschlagen: ${x.message}"
            }
            busy = false
        }
    }

    @Composable
    fun knopf(titel: String, farbe: Color, breite: Float, fett: Boolean, aktion: () -> Unit) {
        Row(
            Modifier.size(breite.dp, 56.dp).background(farbe).tippen { if (!busy) aktion() }
                .padding(start = if (fett) 24.dp else 16.dp, end = if (fett) 24.dp else 10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(titel, style = grotesk(16f, if (fett) 700 else 400, abstand = if (fett) -0.5f else 0.5f, farbe = Color.Black))
            Spacer(Modifier.weight(1f))
            if (busy) androidx.compose.material3.CircularProgressIndicator(Modifier.size(20.dp), color = Color.Black, strokeWidth = 2.dp)
            else Icon("PfeilDunkel", Modifier.size(34.dp, 19.dp))
        }
    }

    Column(Modifier.width(362.dp)) {
        Column(Modifier.size(362.dp, 220.dp).background(FLAECHE).border(2.dp, rand), horizontalAlignment = Alignment.CenterHorizontally) {
            Text("Stundenerfassung", style = grotesk(18f, 700, zeilenHoehe = 23f, abstand = -0.5f, farbe = LIME), modifier = Modifier.padding(top = 11.dp))
            Row(Modifier.padding(top = 13.dp), horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                if (w != null) {
                    kasten("Start", w.start, setOben = { t -> werte = HeuteWerte(t, w.ende, w.pausen) })
                    w.pausen.forEachIndexed { i, p ->
                        kasten("Pause", p.first, p.second, istGrau = true,
                            setOben = { t -> werte = HeuteWerte(w.start, w.ende, w.pausen.mapIndexed { j, q -> if (j == i) t to q.second else q }) },
                            setUnten = { t -> werte = HeuteWerte(w.start, w.ende, w.pausen.mapIndexed { j, q -> if (j == i) q.first to t else q }) })
                    }
                    kasten("Ende", w.ende, setOben = { t -> werte = HeuteWerte(w.start, t, w.pausen) })
                } else {
                    kasten("Start", s0.start)
                    s0.pausen.forEach { p -> kasten("Pause", p.von, if (p.laeuft) null else p.bis, istGrau = true) }
                    if (s0.ende != null) kasten("Ende", s0.ende)
                }
            }
            // Jede Ziffer rollt beim Wechsel von unten nach oben (wie im Entwurf 08:45 -> 08:46).
            Row(Modifier.padding(top = 9.dp).height(45.dp).clipToBounds()) {
                zeit.forEachIndexed { i, c ->
                    androidx.compose.runtime.key(i) {
                        androidx.compose.animation.AnimatedContent(
                            targetState = c,
                            transitionSpec = {
                                (androidx.compose.animation.slideInVertically(androidx.compose.animation.core.tween(450)) { it } togetherWith
                                    androidx.compose.animation.slideOutVertically(androidx.compose.animation.core.tween(450)) { -it })
                            },
                            label = "ziffer",
                        ) { d -> Text(d.toString(), style = grotesk(35f, 700, zeilenHoehe = 45f, abstand = -0.5f, farbe = zahl)) }
                    }
                }
            }
        }

        if (s0.fertig && z != null && w == null) {
            val (text, farbe) = when (z.status) {
                "eingereicht" -> "Anfrage gesendet, Dispo prüft." to LIME
                "bestaetigt" -> "Von der Dispo bestätigt." to GRUEN
                "dispo_geaendert" -> ("Dispo hat geändert, bitte bestätigen." + (if (z.dispoNotiz.isNotEmpty()) " ${z.dispoNotiz}" else "")) to ORANGE
                else -> ("Von der Dispo zurückgegeben" + (if (z.dispoNotiz.isNotEmpty()) ": ${z.dispoNotiz}" else "")) to ROT
            }
            Text(text, style = grotesk(14f, 700, zeilenHoehe = 20f, farbe = farbe), maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 10.dp).height(20.dp))
        }

        if (offen && w == null) {
            Row(Modifier.padding(top = 10.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                knopf("Bearbeiten", rotKnopf, 176f, false) {
                    if (vollbild) { zeigeVollbild = true; return@knopf }
                    val ende = s0.ende ?: s0.start
                    werte = HeuteWerte(s0.start, ende, s0.pausen.map { it.von to (it.bis ?: ende) })
                    notiz = ""; fehler = null
                }
                knopf("Bestätigen", gruen, 176f, false) {
                    if (z != null && z.status == "dispo_geaendert") { zustimmen(z.id); return@knopf }
                    val ende = s0.ende ?: s0.start
                    senden(s0.start, ende, s0.pausen.map { it.von to (it.bis ?: ende) }, angepasst = false)
                }
            }
        }

        if (w != null) {
            Text("Zeiten antippen zum Ändern. Pause erst ab 3 Stunden, kürzere Pausen sind Arbeitszeit.",
                style = grotesk(13f, 500, farbe = Color.White.copy(alpha = 0.5f)), modifier = Modifier.padding(top = 8.dp))
            // Notiz wie beim Stornieren (NotizBlatt in KeineFahrt.kt): dunkle Flaeche 402 breit, weisses Feld 362.
            Box(Modifier.padding(top = 16.dp).offset(x = (-20).dp).size(402.dp, 224.dp).background(hex(0x1A1A1A), androidx.compose.foundation.shape.RoundedCornerShape(12.dp))) {
                Column(
                    Modifier.padding(start = 20.dp, top = 20.dp).size(362.dp, 184.dp).background(Color.White).padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                        Text("Notizen", style = grotesk(16f, 700, abstand = 0.5f, farbe = hex(0x1D1C1D)))
                        Spacer(Modifier.weight(1f))
                        Icon("Stift", Modifier.size(20.dp))
                    }
                    BasicTextField(
                        notiz, { notiz = it },
                        textStyle = grotesk(14f, abstand = 0.25f, farbe = hex(0x1D1C1D)),
                        cursorBrush = SolidColor(hex(0x1D1C1D)),
                        minLines = 6, maxLines = 6,
                        modifier = Modifier.fillMaxWidth(),
                        decorationBox = { inner ->
                            Box {
                                if (notiz.isEmpty()) Text("Schreiben...", style = grotesk(14f, abstand = 0.25f, farbe = Color(129, 129, 129).copy(alpha = 0.5f)))
                                inner()
                            }
                        },
                    )
                }
            }
            Box(Modifier.padding(top = 20.dp)) {
                knopf("Anfrage senden", LIME, 362f, true) {
                    val n = notiz.trim()
                    if (n.isEmpty()) fehler = "Bitte kurz schreiben, warum die Zeiten abweichen."
                    else senden(w.start, w.ende, w.pausen, angepasst = true, begruendung = n)
                }
            }
            Text("Abbrechen", style = grotesk(14f, 700, farbe = Color.White.copy(alpha = 0.6f)),
                modifier = Modifier.padding(top = 12.dp).align(Alignment.CenterHorizontally).tippen { werte = null; fehler = null; schliessen?.invoke() })
        }
        fehler?.let { Text(it, style = grotesk(14f, 500, farbe = ROT), modifier = Modifier.padding(top = 10.dp)) }
    }

    if (zeigeVollbild) {
        androidx.compose.ui.window.Dialog(
            onDismissRequest = { zeigeVollbild = false },
            properties = androidx.compose.ui.window.DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false),
        ) {
            Box(Modifier.fillMaxSize().background(Color.Black)) {
                ProfilHintergrund()
                Box(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).imePadding(), contentAlignment = Alignment.TopCenter) {
                    Column(Modifier.width(402.dp).padding(start = 20.dp, end = 20.dp, top = 70.dp, bottom = 120.dp), verticalArrangement = Arrangement.spacedBy(24.dp)) {
                        Text("Stunden bearbeiten", style = grotesk(42f, 700, zeilenHoehe = 48f, abstand = -0.5f, farbe = LIME))
                        HeuteStundenKarte(fahrerID, e, nachher = { zeigeVollbild = false; nachher() },
                            startetBearbeitet = true, schliessen = { zeigeVollbild = false })
                    }
                }
            }
        }
    }
}

@Composable
internal fun VerlaufSeite(
    fahrerID: String,
    stand: Int,
    zurueck: () -> Unit,
    bearbeiten: (Stunden.Eintrag) -> Unit,
    ablehnen: (Stunden.Eintrag) -> Unit,
) {
    var tage by remember { mutableStateOf<List<Verlauf.Tag>?>(null) }
    var neu by remember { mutableIntStateOf(0) }
    var dienstListe by remember { mutableStateOf<List<Stunden.Eintrag>>(emptyList()) }
    val arbeitet by StundenSpeicher.arbeitetID.collectAsState()
    val scope = rememberCoroutineScope()
    LaunchedEffect(stand, neu) {
        val dienste = try { Stunden.verlauf(null, 60) } catch (e: kotlinx.coroutines.CancellationException) { throw e } catch (e: Exception) { emptyList() }
        val fahrten = try { Verlauf.fahrten(fahrerID, 60) } catch (e: kotlinx.coroutines.CancellationException) { throw e } catch (e: Exception) { emptyList() }
        tage = Verlauf.tage(fahrten, dienste)
        dienstListe = dienste
    }
    val heute = Stunden.heuteDatum()
    // Letzter Dienst von heute, der schon begonnen hat.
    val heuteEintrag = dienstListe.firstOrNull { it.dienst.datum == heute && Stunden.heute(it) != null }
    // Solange heute ein Dienst ansteht oder laeuft jede Minute neu laden (Start, Pausen, Ende kommen dazu).
    val heuteOffen = dienstListe.any { it.dienst.datum == heute && !it.vorbei }
    LaunchedEffect(heuteOffen) {
        while (heuteOffen) { kotlinx.coroutines.delay(60_000); neu++ }
    }
    Box(Modifier.fillMaxSize().background(Color.Black)) {
        ProfilHintergrund()
        Box(Modifier.fillMaxSize().verticalScroll(rememberScrollState()), contentAlignment = Alignment.TopCenter) {
            Column(Modifier.width(402.dp).padding(start = 20.dp, end = 20.dp, top = 60.dp, bottom = 90.dp)) {
                ZurueckKnopf(aktion = zurueck)
                Text("Verlauf", style = grotesk(42f, 700, zeilenHoehe = 42f, abstand = -0.5f, farbe = LIME), modifier = Modifier.padding(top = 30.dp))
                val liste = tage
                if (liste != null) {
                    if (liste.isEmpty()) {
                        Text("Noch keine erledigten Fahrten.", style = grotesk(16f, 500, farbe = Color.White.copy(alpha = 0.7f)), modifier = Modifier.padding(top = 24.dp))
                    }
                    Column(Modifier.padding(top = 32.dp), verticalArrangement = Arrangement.spacedBy(44.dp)) {
                        liste.forEach { tag ->
                            androidx.compose.runtime.key(tag.datum) {
                                Column(verticalArrangement = Arrangement.spacedBy(24.dp)) {
                                    StundenTageszeile(tag.datum)
                                    if (tag.datum == heute && heuteEintrag != null) HeuteStundenKarte(fahrerID, heuteEintrag, nachher = { neu++ })
                                    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                                        tag.eintraege.forEach { eintrag ->
                                            androidx.compose.runtime.key(eintrag.schluessel) {
                                                when (eintrag) {
                                                    is Verlauf.Eintrag.Lose -> VerlaufFahrtKarte(eintrag.f)
                                                    is Verlauf.Eintrag.Dienst -> {
                                                        val e = eintrag.e
                                                        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                                                            VerlaufRahmenZeile("Dienststart ${e.dienst.beginn.ifEmpty { "--:--" }}", LIME, Modifier.padding(bottom = 9.dp))
                                                            eintrag.fahrten.forEach { VerlaufFahrtKarte(it) }
                                                            if (e.vorbei) {
                                                                VerlaufRahmenZeile("Dienstende ${e.dienst.ende.ifEmpty { "--:--" }}", ROT, Modifier.padding(top = 9.dp))
                                                                // Stundenerfassung im neuen Look (Figma 2823-12622) an jedem vergangenen Dienst.
                                                                if (e !== heuteEintrag) Box(Modifier.padding(top = 18.dp)) {
                                                                    HeuteStundenKarte(fahrerID, e, nachher = { neu++ })
                                                                }
                                                            } else {
                                                                Text("Dienst läuft noch", style = grotesk(16f, 500, farbe = Color.White.copy(alpha = 0.5f)), modifier = Modifier.padding(top = 9.dp))
                                                            }
                                                        }
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
        FussleisteUnten()
    }
}

// MARK: Bearbeiten

private val HALBE = (0 until 24 * 60 step 30).toList()
private val PAUSEN = listOf(0) + (180..600 step 30).toList()

/** Bearbeiten: Beginn, Ende und Pause in halben Stunden, dazu eine Notiz, warum es abweicht. */
@Composable
internal fun StundenBearbeitenSeite(eintrag: Stunden.Eintrag, fahrerID: String, schliessen: () -> Unit, fertig: () -> Unit) {
    val z = eintrag.zettel
    val v = eintrag.vorschlag
    val tag = eintrag.dienst.datum

    /** Uhrzeit (Berlin) als Minuten ab Mitternacht in halben Stunden, zugunsten des Fahrers (Beginn ab, Ende auf). */
    fun minuten(iso: String?, auf: Boolean = false): Int? {
        val u = Stunden.uhr(iso)
        val t = u.split(":").mapNotNull { it.toIntOrNull() }
        if (t.size != 2) return null
        val m = (t[0] * 60 + t[1]) / 30.0
        return ((if (auf) Math.ceil(m) else Math.floor(m)).toInt() * 30) % (24 * 60)
    }

    var beginn by remember {
        mutableIntStateOf(minuten(z?.beginn ?: v.beginn.ifEmpty { null }) ?: minuten(Stunden.zuZeitpunkt(tag, eintrag.dienst.beginn)) ?: 8 * 60)
    }
    var ende by remember {
        mutableIntStateOf(minuten(z?.ende ?: v.ende.ifEmpty { null }, auf = true) ?: minuten(Stunden.zuZeitpunkt(tag, eintrag.dienst.ende), auf = true) ?: 16 * 60)
    }
    var pause by remember { mutableIntStateOf((Math.floor((z?.pauseMin ?: v.pauseMin) / 30.0).toInt() * 30).let { if (it >= Stunden.PAUSE_MINDEST) it else 0 }) }
    var begruendung by remember { mutableStateOf((z?.begruendung ?: "").replace("Abgelehnt: ", "")) }
    var fehler by remember { mutableStateOf("") }
    var beschaeftigt by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val tastaturOffen = WindowInsets.ime.getBottom(LocalDensity.current) > 0

    val arbeitsMin = run {
        var dauer = ende - beginn
        if (dauer <= 0) dauer += 24 * 60
        maxOf(0, dauer - (if (pause >= Stunden.PAUSE_MINDEST) pause else 0))
    }

    fun speichern() {
        val grund = begruendung.trim()
        if (grund.isEmpty()) { fehler = "Bitte kurz schreiben, warum die Zeiten abweichen."; return }
        fun hhmm(m: Int) = "%02d:%02d".format(m / 60, m % 60)
        val b = Stunden.zuZeitpunkt(tag, hhmm(beginn))
        val e = b?.let { Stunden.zuZeitpunkt(tag, hhmm(ende), it) }
        if (b == null || e == null) { fehler = "Beginn und Ende wählen."; return }
        beschaeftigt = true
        fehler = ""
        scope.launch {
            try {
                Stunden.speichern(fahrerID, eintrag, b, e, pause, angepasst = true, begruendung = grund)
                beschaeftigt = false
                fertig()
            } catch (ex: kotlinx.coroutines.CancellationException) {
                throw ex
            } catch (ex: Exception) {
                beschaeftigt = false
                fehler = "Speichern fehlgeschlagen: " + ((ex as? io.github.jan.supabase.exceptions.RestException)?.error ?: ex.message ?: "")
            }
        }
    }

    Box(Modifier.fillMaxSize().background(Color.Black)) {
        ProfilHintergrund()
        Box(Modifier.fillMaxSize().imePadding().verticalScroll(rememberScrollState()), contentAlignment = Alignment.TopCenter) {
            Column(Modifier.width(402.dp).padding(start = 20.dp, end = 20.dp, top = 60.dp, bottom = 200.dp)) {
                ZurueckKnopf(aktion = schliessen)
                Text("Stunden bearbeiten", style = grotesk(42f, 700, abstand = -0.5f, farbe = LIME), modifier = Modifier.padding(top = 30.dp))
                Text(Stunden.tagTitel(tag), style = grotesk(20f, 700, farbe = Color.White.copy(alpha = 0.7f)), modifier = Modifier.padding(top = 8.dp))

                Column(
                    Modifier.padding(top = 28.dp).size(362.dp, 124.dp).background(FLAECHE).padding(start = 12.dp, end = 12.dp, top = 19.dp),
                    verticalArrangement = Arrangement.spacedBy(20.dp),
                ) {
                    Text("Stunden ${Stunden.hmm(arbeitsMin)}", style = grotesk(38f, 700, farbe = LIME), maxLines = 1)
                    Text("Vorschlag ${Stunden.uhr(v.beginn)} – ${Stunden.uhr(v.ende)} · ${Stunden.hmm(v.arbeitsMin)}",
                        style = grotesk(16f, 700, farbe = Color.White.copy(alpha = 0.5f)), maxLines = 1)
                }

                Row(Modifier.padding(top = 12.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    Rad("Beginn", beginn, HALBE, { Stunden.hmm(it) }) { beginn = it }
                    Rad("Ende", ende, HALBE, { Stunden.hmm(it) }) { ende = it }
                    Rad("Pause", pause, PAUSEN, { "${Stunden.hmm(it)} h" }) { pause = it }
                }
                Text("Pause erst ab 3 Stunden, kürzere Pausen sind Arbeitszeit.", style = grotesk(13f, 500, farbe = Color.White.copy(alpha = 0.5f)), modifier = Modifier.padding(top = 8.dp))

                Column(Modifier.padding(top = 12.dp).width(362.dp).background(Color.White).padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("Warum weicht es ab?", style = grotesk(16f, 700, abstand = 0.5f, farbe = hex(0x1D1C1D)))
                    BasicTextField(
                        begruendung, { begruendung = it },
                        textStyle = grotesk(14f, farbe = hex(0x1D1C1D)),
                        cursorBrush = SolidColor(hex(0x1D1C1D)),
                        minLines = 4,
                        modifier = Modifier.fillMaxWidth(),
                        decorationBox = { inner ->
                            Box {
                                if (begruendung.isEmpty()) Text("Schreiben...", style = grotesk(14f, farbe = Color(129, 129, 129).copy(alpha = 0.5f)))
                                inner()
                            }
                        },
                    )
                }
                if (fehler.isNotEmpty()) Text(fehler, style = grotesk(14f, 500, farbe = ROT), modifier = Modifier.padding(top = 12.dp))
            }
        }

        // Knopf fest unten mit Verlauf dahinter.
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.BottomCenter) {
            Box(
                Modifier.fillMaxWidth().background(Brush.verticalGradient(0f to Color.Transparent, 0.35f to Color.Black, 1f to Color.Black))
                    .navigationBarsPadding().padding(top = 24.dp, bottom = if (tastaturOffen) 16.dp else 70.dp).imePadding(),
                contentAlignment = Alignment.Center,
            ) {
                Row(
                    Modifier.size(362.dp, 56.dp).alpha(if (beschaeftigt) 0.6f else 1f).background(LIME).tippen { if (!beschaeftigt) speichern() }
                        .padding(horizontal = 24.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text("Bearbeitung senden", style = grotesk(16f, 700, abstand = -0.5f, farbe = Color.Black))
                    Spacer(Modifier.weight(1f))
                    Icon("PfeilDunkel", Modifier.size(34.dp, 20.dp))
                }
            }
        }
        if (!tastaturOffen) FussleisteUnten()
    }
}

/** Dunkle Kachel mit Zeitrad (Werte in halben Stunden), mittlere Zeile ist gewaehlt. */
@Composable
private fun Rad(titel: String, wert: Int, werte: List<Int>, text: (Int) -> String, setzen: (Int) -> Unit) {
    val zeile = 40
    val start = werte.indexOf(wert).coerceAtLeast(0)
    val liste = rememberLazyListState(initialFirstVisibleItemIndex = start)
    val dichte = LocalDensity.current
    // Nach dem Ausrollen: mittlere Zeile uebernehmen.
    LaunchedEffect(liste) {
        snapshotFlow { liste.isScrollInProgress }.distinctUntilChanged().filter { !it }.collect {
            val halbe = with(dichte) { (zeile / 2).dp.toPx() }
            val i = (liste.firstVisibleItemIndex + if (liste.firstVisibleItemScrollOffset > halbe) 1 else 0).coerceIn(0, werte.size - 1)
            setzen(werte[i])
        }
    }
    val gewaehlt = werte.indexOf(wert)
    Column(Modifier.width(((362f - 12f) / 3f).dp).background(FLAECHE)) {
        Text(titel, style = grotesk(13f, 700, farbe = Color.White.copy(alpha = 0.5f)), modifier = Modifier.padding(start = 12.dp, top = 12.dp))
        Box(Modifier.fillMaxWidth().height((zeile * 3).dp).clipToBounds()) {
            Box(Modifier.align(Alignment.Center).fillMaxWidth().height(zeile.dp).background(Color.White.copy(alpha = 0.08f)))
            LazyColumn(
                state = liste,
                flingBehavior = rememberSnapFlingBehavior(liste),
                contentPadding = PaddingValues(vertical = zeile.dp),
                modifier = Modifier.fillMaxSize(),
            ) {
                itemsIndexed(werte) { i, m ->
                    Box(Modifier.fillMaxWidth().height(zeile.dp), contentAlignment = Alignment.Center) {
                        Text(text(m), style = grotesk(22f, 700, farbe = if (i == gewaehlt) Color.White else Color.White.copy(alpha = 0.35f)))
                    }
                }
            }
        }
    }
}
