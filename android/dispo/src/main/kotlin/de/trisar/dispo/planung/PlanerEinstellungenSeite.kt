package de.trisar.dispo.planung

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.RectangleShape
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import de.trisar.kern.DispoHintergrund
import de.trisar.kern.FussleisteUnten
import de.trisar.kern.ZurueckKnopf
import de.trisar.kern.hex
import de.trisar.kern.tippen
import kotlin.math.max
import kotlin.math.min

/**
 * Planungsregeln (PlanerEinstellungenAnsicht.swift, KiPlanerSettingsView.jsx, Figma 2407:11491): je Regel ein
 * Schieber mit Minus/Plus, darunter Bezeichnung samt Wert und ein Erklaertext. Wie im Web wird jede Aenderung
 * sofort unter `trisar_planner_settings_v1` gespeichert.
 */
@Composable
internal fun PlanerEinstellungenSeite(fahrerAnzahl: Int = 0, zurueck: () -> Unit) {
    var einstellungen by remember { mutableStateOf(PlanerEinstellungen.laden()) }
    PlanerEinstellungenAnsicht(fahrerAnzahl, einstellungen, { neu -> einstellungen = neu; neu.speichern() }, zurueck)
}

private class Regel(
    val lesen: (PlanerEinstellungen) -> Double,
    val schreiben: (PlanerEinstellungen, Double) -> PlanerEinstellungen,
    val min: Double, val max: Double, val schritt: Double, val maxAusBestand: Boolean = false,
    val label: String, val hinweis: String, val format: (Double) -> String,
)

/** String(v) wie in JS: 8 statt 8.0. */
private fun zahlText(v: Double): String = if (v == rund(v)) v.toLong().toString() else v.toString()
private fun stunden(v: Double) = "${zahlText(v).replace(".", ",")} h"

private val regeln = listOf(
    Regel({ it.maxWorkHours }, { e, v -> e.copy(maxWorkHours = v) }, 3.0, 10.0, 0.5, label = "Max. Schichtlänge",
        hinweis = "§ 3 ArbZG: 8 h Regelarbeitszeit, bis 10 h zulässig bei Ausgleich.", format = ::stunden),
    Regel({ it.minWorkHours }, { e, v -> e.copy(minWorkHours = v) }, 3.0, 10.0, 0.5, label = "Min. Schichtlänge",
        hinweis = "Mindestlänge je Arbeitsblock. Geteilte Dienste sind erlaubt: zwei Blöcke pro Tag mit mindestens 3 h unbezahlter Pause dazwischen.",
        format = ::stunden),
    Regel({ it.bufferMinutes }, { e, v -> e.copy(bufferMinutes = v) }, 0.0, 60.0, 5.0, label = "Puffer vor Fahrt",
        hinweis = "Vorlauf vor der Abholung, zusätzlich zum Puffer aus dem Abholtyp.", format = { "${zahlText(it)} min" }),
    Regel({ it.minPauseHours }, { e, v -> e.copy(minPauseHours = v) }, 3.0, 8.0, 0.5, label = "Pause bei geteiltem Dienst",
        hinweis = "Mindestpause zwischen den beiden Blöcken eines geteilten Dienstes.", format = ::stunden),
    Regel({ it.restHours }, { e, v -> e.copy(restHours = v) }, 11.0, 16.0, 0.5, label = "Min. Ruhezeit zwischen Tagen",
        hinweis = "§ 5 ArbZG: mindestens 11 h zwischen Dienstende und nächstem Dienstbeginn.", format = ::stunden),
    // Obergrenze ist der tatsaechliche Fahrerbestand (fahrerAnzahl).
    Regel({ it.driverPool }, { e, v -> e.copy(driverPool = v) }, 1.0, 101.0, 1.0, maxAusBestand = true, label = "Fahrerpool",
        hinweis = "Wie viele Fahrer höchstens eingeplant werden.", format = ::zahlText),
    Regel({ it.qualityGapPercent }, { e, v -> e.copy(qualityGapPercent = v) }, 0.0, 20.0, 1.0, label = "Lösungsgüte",
        hinweis = "Abbruch nach Güte statt nach Zeit: der Solver rechnet, bis die Lösung nachweislich höchstens so weit vom Optimum entfernt ist. „Optimal“ kann an vollen Tagen mehrere Minuten dauern.",
        format = { if (it == 0.0) "Optimal" else "≤ ${zahlText(it)} %" }),
)

@Composable
internal fun PlanerEinstellungenAnsicht(
    fahrerAnzahl: Int,
    einstellungen: PlanerEinstellungen,
    aendern: (PlanerEinstellungen) -> Unit,
    zurueck: () -> Unit,
) {
    val lime = hex(0xE3F654)
    /** Min- und Max-Schichtlaenge sind gekoppelt (beide duerfen gleich sein). */
    fun setzen(r: Regel, wert: Double) {
        var neu = r.schreiben(einstellungen, wert)
        if (r === regeln[1] && wert > neu.maxWorkHours) neu = neu.copy(maxWorkHours = wert)
        if (r === regeln[0] && wert < neu.minWorkHours) neu = neu.copy(minWorkHours = wert)
        aendern(neu)
    }
    Box(Modifier.fillMaxSize().background(Color.Black).abschirmen()) {
        DispoHintergrund()
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(start = 20.dp, end = 20.dp, top = 60.dp, bottom = 90.dp)) {
            ZurueckKnopf(aktion = zurueck)
            Spacer(Modifier.height(30.dp))
            PlanTitel("Planung", -0.5f)
            Spacer(Modifier.height(24.dp))
            Column(verticalArrangement = Arrangement.spacedBy(42.dp)) {
                for (r in regeln) {
                    val max = if (r.maxAusBestand && fahrerAnzahl > 0) max(r.min, fahrerAnzahl.toDouble()) else r.max
                    val wert = min(max, r.lesen(einstellungen))
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        NebenRegler(wert, r.min, max, r.schritt) { setzen(r, it) }
                        Spacer(Modifier.height(12.dp))
                        PAbsatz("${r.label} ${r.format(wert)}", 20f, 700, 26f, lime, -0.3f, Modifier.fillMaxWidth(), TextAlign.Center)
                        Spacer(Modifier.height(6.dp))
                        PAbsatz(r.hinweis, 11f, 500, 15f, Color.White.copy(alpha = 0.45f), modifier = Modifier.fillMaxWidth(), ausrichtung = TextAlign.Center)
                    }
                }
            }
            Spacer(Modifier.height(42.dp))
            VerkehrWahl(einstellungen, aendern)
            Spacer(Modifier.height(40.dp))
            EinstellKnopf("Einstellungen übernehmen", voll = true, aktion = zurueck)
            Spacer(Modifier.height(10.dp))
            EinstellKnopf("Auf Standard zurücksetzen", voll = false) { aendern(PlanerEinstellungen.standard) }
        }
        FussleisteUnten()
    }
}

/** Verkehrsmodell der Leerfahrten (travelModel), wie im Web zwei Felder nebeneinander. */
@Composable
private fun VerkehrWahl(einstellungen: PlanerEinstellungen, aendern: (PlanerEinstellungen) -> Unit) {
    val lime = hex(0xE3F654)
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        PAbsatz("Verkehr bei Leerfahrten", 20f, 700, 26f, lime, -0.3f, Modifier.fillMaxWidth(), TextAlign.Center)
        Spacer(Modifier.height(12.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            for ((wert, text) in listOf("osrm" to "Standard", "osrm_raum" to "Nach Gegend")) {
                val aktiv = einstellungen.travelModel == wert
                Box(
                    Modifier.weight(1f).height(52.dp).background(if (aktiv) lime else Color.Transparent)
                        .border(2.dp, lime, RectangleShape).tippen { aendern(einstellungen.copy(travelModel = wert)) },
                    contentAlignment = Alignment.Center,
                ) { PText(text, 16f, 500, if (aktiv) hex(0x1D1C1D) else lime, 0.4f) }
            }
        }
        Spacer(Modifier.height(6.dp))
        PAbsatz(
            "Standard: echte Straßenzeit mal Tageszeit-Faktor für ganz München. Nach Gegend: Faktor je Innenstadt, Stadt, Umland, Flughafen, Wochentag und Stunde, genauer (im Test 2,7 statt 4,6 min Abweichung).",
            11f, 500, 15f, Color.White.copy(alpha = 0.45f), modifier = Modifier.fillMaxWidth(), ausrichtung = TextAlign.Center,
        )
    }
}

@Composable
private fun EinstellKnopf(text: String, voll: Boolean, aktion: () -> Unit) {
    val lime = hex(0xE3F654)
    Box(
        Modifier.fillMaxWidth().height(52.dp).background(if (voll) lime else Color.Transparent)
            .border(2.dp, lime, RectangleShape).tippen(aktion).padding(horizontal = 16.dp),
        contentAlignment = Alignment.CenterStart,
    ) { PText(text, 16f, 500, if (voll) hex(0x1D1C1D) else lime, 0.4f) }
}

/** Schieber: Minus, Schiene mit Knopf, Plus. Der Wert folgt dem Ziehen sofort. */
@Composable
private fun NebenRegler(wert: Double, min: Double, max: Double, schritt: Double, aendern: (Double) -> Unit) {
    val lime = hex(0xE3F654)
    fun sauber(v: Double) = rund(v * 100) / 100
    val anteil = ((wert - min) / max(max - min, 0.0001)).coerceIn(0.0, 1.0).toFloat()
    val aktuell by rememberUpdatedState(wert)
    val melden by rememberUpdatedState(aendern)
    val grenzen by rememberUpdatedState(Triple(min, max, schritt))
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
        Box(Modifier.size(23.dp).tippen { aendern(sauber(max(min, wert - schritt))) }, contentAlignment = Alignment.Center) {
            Box(Modifier.size(23.dp, 3.dp).background(lime))
        }
        BoxWithConstraints(
            Modifier.weight(1f).height(27.dp).pointerInput(Unit) {
                awaitEachGesture {
                    val runter = awaitFirstDown()
                    fun setzen(x: Float) {
                        if (size.width <= 0) return
                        val (mi, ma, sc) = grenzen
                        val p = (x / size.width).coerceIn(0f, 1f)
                        val v = sauber(max(mi, min(ma, rund((mi + p * (ma - mi)) / sc) * sc)))
                        if (v != aktuell) melden(v)
                    }
                    runter.consume()
                    setzen(runter.position.x)
                    while (true) {
                        val e = awaitPointerEvent()
                        val c = e.changes.firstOrNull { it.id == runter.id } ?: break
                        if (!c.pressed) break
                        c.consume()
                        setzen(c.position.x)
                    }
                }
            },
            contentAlignment = Alignment.CenterStart,
        ) {
            val b = maxWidth.value
            Box(Modifier.fillMaxWidth().height(2.dp).background(hex(0x3F4436)))
            Box(Modifier.width((b * anteil).dp).height(2.dp).background(lime))
            Box(Modifier.offset((b * anteil - 13.5f).dp).size(27.dp).background(lime, CircleShape))
        }
        Box(Modifier.size(23.dp).tippen { aendern(sauber(min(max, wert + schritt))) }, contentAlignment = Alignment.Center) {
            Box(Modifier.size(23.dp, 3.dp).background(lime))
            Box(Modifier.size(3.dp, 23.dp).background(lime))
        }
    }
}
