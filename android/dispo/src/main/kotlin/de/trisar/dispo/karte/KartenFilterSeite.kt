package de.trisar.dispo.karte

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import de.trisar.dispo.stamm.Eingabe
import de.trisar.dispo.stamm.Leinwand
import de.trisar.dispo.stamm.StammZeilenKnopf
import de.trisar.kern.DispoHintergrund
import de.trisar.kern.FussleisteUnten
import de.trisar.kern.Icon
import de.trisar.kern.ZurueckKnopf
import de.trisar.kern.grotesk
import de.trisar.kern.hex
import de.trisar.kern.platz
import de.trisar.kern.tippen

private val LIME = hex(0xE3F654)

/**
 * KartenFilterView.jsx (KartenFilterAnsicht.swift): Fahrersuche, Karosserie, Feierabend, speichern
 * und loeschen. Wie im Web wirkt auf der Karte nur die Fahrersuche (mehrere Begriffe mit ';').
 */
@Composable
internal fun KartenFilterSeite(zurueck: () -> Unit) {
    val f = KartenFilter
    Box(Modifier.fillMaxSize().background(Color.Black).tippen { }) {
        DispoHintergrund()
        Leinwand(874f, 834f + 70f) {
            ZurueckKnopf(Modifier.platz(20f, 60f), zurueck)
            Text("Karten Filter", style = grotesk(42f, 700, 42f, farbe = LIME), modifier = Modifier.platz(20f, 140f, null, 42f), maxLines = 1)

            SuchZeile(Modifier.platz(20f, 206f, 362f, 56f))

            ZweierKnopf("Limosine", f.limousine, Modifier.platz(20f, 286f, 175f, 40f)) { f.limousine = !f.limousine }
            ZweierKnopf("SUV", f.suv, Modifier.platz(207f, 286f, 175f, 40f)) { f.suv = !f.suv }
            ZweierKnopf("VAN", f.van, Modifier.platz(20f, 338f, 175f, 40f)) { f.van = !f.van }
            ZweierKnopf("Coupe", f.coupe, Modifier.platz(207f, 338f, 175f, 40f)) { f.coupe = !f.coupe }

            FeierabendZeile(Modifier.platz(20f, 402f, 362f, 56f))

            StammZeilenKnopf("Filter speichern", "Arrow_Trisar_Icons_01", Modifier.platz(20f, 482f, 362f, 56f),
                iconBreite = 34f, iconHoehe = 20f, innen = 12f, aktion = zurueck)
            StammZeilenKnopf("Filter Löschen", "Arrow_Nav_Trisar_Icons_01", Modifier.platz(20f, 550f, 362f, 56f),
                iconBreite = 34f, iconHoehe = 20f, hintergrund = 0xFF6B6B, innen = 12f) { f.zuruecksetzen() }
        }
        FussleisteUnten()
    }
}

/** SearchInputRow: links "Fahrer Suchen", beim Tippen "Fahrer" und das Feld, rechts Lupe oder Loeschen. */
@Composable
private fun SuchZeile(modifier: Modifier) {
    val f = KartenFilter
    var fokus by remember { mutableStateOf(false) }
    val anfordern = remember { FocusRequester() }
    val hatWert = f.fahrerSuche.isNotBlank()
    Row(
        modifier.border(2.dp, LIME).tippen { runCatching { anfordern.requestFocus() } }.padding(horizontal = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(if (fokus || hatWert) "Fahrer" else "Fahrer Suchen", style = grotesk(16f, 500, abstand = 0.5f, farbe = LIME.copy(alpha = 0.6f)), maxLines = 1)
        Eingabe(
            f.fahrerSuche, { f.sucheSetzen(it) }, "", grotesk(16f, 500, abstand = 0.5f, farbe = LIME), Color.Transparent,
            Modifier.weight(1f), gross = KeyboardCapitalization.None, fokus = anfordern, fokusGeaendert = { fokus = it },
        )
        Box(Modifier.size(24.dp), contentAlignment = Alignment.Center) {
            if (hatWert) {
                Icon("clear-field-green", Modifier.size(20.dp).tippen { f.sucheSetzen(""); runCatching { anfordern.requestFocus() } })
            } else {
                Icon("karten-filter-search", Modifier.size(24.dp))
            }
        }
    }
}

/** TwoColButton: Rahmen Lime, an = Lime gefuellt mit dunkler Schrift. */
@Composable
private fun ZweierKnopf(text: String, an: Boolean, modifier: Modifier, aktion: () -> Unit) {
    Box(
        modifier.background(if (an) LIME else Color.Transparent).border(2.dp, LIME).tippen(aktion),
        contentAlignment = Alignment.Center,
    ) {
        Text(text, style = grotesk(16f, 500, abstand = 0.4f, farbe = if (an) hex(0x1D1C1D) else LIME))
    }
}

/** MinutePickerRow: "Feierabend in ... min", gewaehlt "Feierabend in 30 min", rechts Uhr oder Loeschen. */
@Composable
private fun FeierabendZeile(modifier: Modifier) {
    val f = KartenFilter
    var offen by remember { mutableStateOf(false) }
    val optionen = listOf("15 min", "30 min", "45 min", "60 min", "90 min", "120 min")
    Row(modifier.border(2.dp, LIME).padding(horizontal = 12.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.weight(1f).tippen { offen = true }, contentAlignment = Alignment.CenterStart) {
            Text(buildAnnotatedString {
                if (f.feierabendMinuten.isEmpty()) {
                    withStyle(SpanStyle(color = LIME.copy(alpha = 0.6f))) { append("Feierabend in ... min") }
                } else {
                    withStyle(SpanStyle(color = LIME.copy(alpha = 0.6f))) { append("Feierabend in ") }
                    withStyle(SpanStyle(color = LIME)) { append(f.feierabendMinuten) }
                }
            }, style = grotesk(16f, 500, abstand = 0.5f), modifier = Modifier.padding(vertical = 16.dp))
            DropdownMenu(offen, { offen = false }, Modifier.background(hex(0x1E1E1E))) {
                for (o in listOf("---") + optionen) {
                    DropdownMenuItem(
                        text = { Text(o, style = grotesk(16f, farbe = Color.White)) },
                        onClick = { f.feierabendMinuten = if (o == "---") "" else o; offen = false },
                    )
                }
            }
        }
        Box(Modifier.size(40.dp), contentAlignment = Alignment.Center) {
            if (f.feierabendMinuten.isEmpty()) {
                Icon("clock-green", Modifier.size(20.dp))
            } else {
                Icon("clear-field-green", Modifier.size(20.dp).tippen { f.feierabendMinuten = "" })
            }
        }
        Spacer(Modifier.size(0.dp))
    }
}
