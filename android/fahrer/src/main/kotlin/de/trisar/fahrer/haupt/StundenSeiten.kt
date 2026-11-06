package de.trisar.fahrer.haupt

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
    fun karten(liste: List<Stunden.Eintrag>): List<Stunden.Eintrag> = liste.filter { it.vorbei && it.zettel?.status != "bestaetigt" }

    suspend fun laden() {
        eintraege.value = try { Stunden.verlauf(null, 14) } catch (e: kotlinx.coroutines.CancellationException) { throw e } catch (e: Exception) { eintraege.value }
    }

    suspend fun annehmen(fahrerID: String, e: Stunden.Eintrag) {
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
    val rand = when (z?.status) { "eingereicht" -> LIME; "zurueckgewiesen" -> ROT; else -> Color.Transparent }
    val etikett = when (z?.status) {
        "eingereicht" -> "Eingereicht" to LIME
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

/** Verlauf (Profil -> Verlauf): jeder vergangene Dienst als Stundenkarte unter seinem Tag. */
@Composable
internal fun VerlaufSeite(
    fahrerID: String,
    stand: Int,
    zurueck: () -> Unit,
    bearbeiten: (Stunden.Eintrag) -> Unit,
    ablehnen: (Stunden.Eintrag) -> Unit,
) {
    var eintraege by remember { mutableStateOf<List<Stunden.Eintrag>?>(null) }
    var neu by remember { mutableIntStateOf(0) }
    val arbeitet by StundenSpeicher.arbeitetID.collectAsState()
    val scope = rememberCoroutineScope()
    LaunchedEffect(stand, neu) {
        eintraege = try { Stunden.verlauf(null, 60) } catch (e: kotlinx.coroutines.CancellationException) { throw e } catch (e: Exception) { emptyList() }
    }
    Box(Modifier.fillMaxSize().background(Color.Black)) {
        ProfilHintergrund()
        Box(Modifier.fillMaxSize().verticalScroll(rememberScrollState()), contentAlignment = Alignment.TopCenter) {
            Column(Modifier.width(402.dp).padding(start = 20.dp, end = 20.dp, top = 60.dp, bottom = 90.dp)) {
                ZurueckKnopf(aktion = zurueck)
                Text("Verlauf", style = grotesk(42f, 700, zeilenHoehe = 42f, abstand = -0.5f, farbe = LIME), modifier = Modifier.padding(top = 30.dp))
                val liste = eintraege
                if (liste != null) {
                    if (liste.isEmpty()) {
                        Text("Noch keine abgeschlossenen Dienste.", style = grotesk(16f, 500, farbe = Color.White.copy(alpha = 0.7f)), modifier = Modifier.padding(top = 24.dp))
                    }
                    Column(Modifier.padding(top = 32.dp), verticalArrangement = Arrangement.spacedBy(44.dp)) {
                        liste.forEach { e ->
                            androidx.compose.runtime.key(e.dienst.id) {
                                Column(verticalArrangement = Arrangement.spacedBy(24.dp)) {
                                    StundenTageszeile(e.dienst.datum)
                                    if (e.vorbei) {
                                        StundenKarte(
                                            e, beschaeftigt = arbeitet == e.dienst.id,
                                            annehmen = { scope.launch { StundenSpeicher.annehmen(fahrerID, e); neu++ } },
                                            bearbeiten = { bearbeiten(e) },
                                            ablehnen = { ablehnen(e) },
                                        )
                                    } else {
                                        Text("Dienst läuft noch", style = grotesk(16f, 500, farbe = Color.White.copy(alpha = 0.5f)))
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
private val PAUSEN = (0..180 step 30).toList()

/** Bearbeiten: Beginn, Ende und Pause in halben Stunden, dazu eine Notiz, warum es abweicht. */
@Composable
internal fun StundenBearbeitenSeite(eintrag: Stunden.Eintrag, fahrerID: String, schliessen: () -> Unit, fertig: () -> Unit) {
    val z = eintrag.zettel
    val v = eintrag.vorschlag
    val tag = eintrag.dienst.datum

    /** Uhrzeit (Berlin) als Minuten ab Mitternacht, auf halbe Stunden gerundet. */
    fun minuten(iso: String?): Int? {
        val u = Stunden.uhr(iso)
        val t = u.split(":").mapNotNull { it.toIntOrNull() }
        if (t.size != 2) return null
        return (Math.round((t[0] * 60 + t[1]) / 30.0).toInt() * 30) % (24 * 60)
    }

    var beginn by remember {
        mutableIntStateOf(minuten(z?.beginn ?: v.beginn.ifEmpty { null }) ?: minuten(Stunden.zuZeitpunkt(tag, eintrag.dienst.beginn)) ?: 8 * 60)
    }
    var ende by remember {
        mutableIntStateOf(minuten(z?.ende ?: v.ende.ifEmpty { null }) ?: minuten(Stunden.zuZeitpunkt(tag, eintrag.dienst.ende)) ?: 16 * 60)
    }
    var pause by remember { mutableIntStateOf(Math.round((z?.pauseMin ?: v.pauseMin) / 30.0).toInt() * 30) }
    var begruendung by remember { mutableStateOf((z?.begruendung ?: "").replace("Abgelehnt: ", "")) }
    var fehler by remember { mutableStateOf("") }
    var beschaeftigt by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val tastaturOffen = WindowInsets.ime.getBottom(LocalDensity.current) > 0

    val arbeitsMin = run {
        var dauer = ende - beginn
        if (dauer <= 0) dauer += 24 * 60
        maxOf(0, dauer - pause)
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
