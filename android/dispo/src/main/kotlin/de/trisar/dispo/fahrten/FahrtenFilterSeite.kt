package de.trisar.dispo.fahrten

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import de.trisar.kern.FussleisteUnten
import de.trisar.kern.Icon
import de.trisar.kern.ZurueckKnopf
import de.trisar.kern.hex
import de.trisar.kern.platz
import de.trisar.kern.tippen

/**
 * Nachbau von FahrtenFilter.jsx (FahrtenFilterAnsicht.swift). Alles absolut im 402er Raster, Block ab top 40.
 * Die Werte gelten sofort (wie onChangeFilters im Web), „Filter speichern“ geht nur zurueck.
 */
@Composable
internal fun FahrtenFilterSeite(filter: FahrtenFilterWerte, aendern: (FahrtenFilterWerte) -> Unit, zurueck: () -> Unit) {
    // Konstanten aus FahrtenFilter.jsx
    val block = 40f
    val feldStart = 166f
    val schritt = 68f
    val schalterStart = feldStart + schritt * 3 + 12
    val knopfOben = feldStart + schritt * 8 + 12 + 12
    val inhaltHoehe = block + knopfOben + 56 + 30 + 40

    Box(Modifier.fillMaxSize()) {
        Box(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
            Box(Modifier.fillMaxWidth().height(inhaltHoehe.dp)) {
                ZurueckKnopf(Modifier.platz(20f, block + 20), zurueck)
                Text("Fahrten Filter", style = css(42f, 700, 42f, farbe = LIME), modifier = Modifier.platz(20f, block + 100))

                FilterEingabe("Start", filter.startSuche, { aendern(filter.copy(startSuche = it)) }, Modifier.platz(20f, block + feldStart, 362f, 56f))
                FilterEingabe("Ziel", filter.zielSuche, { aendern(filter.copy(zielSuche = it)) }, Modifier.platz(20f, block + feldStart + schritt, 362f, 56f))
                FilterDatum("Datum", filter.datum, { aendern(filter.copy(datum = it)) }, Modifier.platz(20f, block + feldStart + schritt * 2, 362f, 56f))

                FilterSchalter("ohne Fahrer*in", filter.ohneFahrer, Modifier.platz(20f, block + schalterStart, 362f, 56f)) { aendern(filter.copy(ohneFahrer = !filter.ohneFahrer)) }
                FilterSchalter("Fahrbestätigung", filter.bestaetigung, Modifier.platz(20f, block + schalterStart + schritt, 362f, 56f)) { aendern(filter.copy(bestaetigung = !filter.bestaetigung)) }
                FilterSchalter("Konvoi", filter.konvoi, Modifier.platz(20f, block + schalterStart + schritt * 2, 362f, 56f)) { aendern(filter.copy(konvoi = !filter.konvoi)) }
                FilterSchalter("mit Besonderheiten", filter.besonderheiten, Modifier.platz(20f, block + schalterStart + schritt * 3, 362f, 56f)) { aendern(filter.copy(besonderheiten = !filter.besonderheiten)) }
                FilterSchalter("auch vergangene", filter.vergangene, Modifier.platz(20f, block + schalterStart + schritt * 4, 362f, 56f)) { aendern(filter.copy(vergangene = !filter.vergangene)) }

                Row(
                    Modifier.platz(20f, block + knopfOben, 362f, 56f).background(LIME).tippen(zurueck),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text("Filter speichern", style = css(16f, 500, abstand = 0.4f, farbe = hex(0x262626)), modifier = Modifier.padding(start = 16.dp))
                    Spacer(Modifier.weight(1f))
                    Icon("Arrow_Trisar_Icons_01", Modifier.padding(end = 16.dp).size(34.dp, 20.dp))
                }
            }
        }
        FussleisteUnten()
    }
}

/** InputRow: Lime-Rahmen, Titel halbtransparent, Eingabe, rechts Loeschen oder kurzer Pfeil. */
@Composable
private fun FilterRahmen(titel: String, hatWert: Boolean, leeren: () -> Unit, modifier: Modifier, inhalt: @Composable () -> Unit) {
    Box(modifier.border(2.dp, LIME)) {
        // border 2 + p-1 + px-3, rechts pr-10 fuer das Icon
        Row(
            Modifier.fillMaxSize().padding(start = 18.dp, end = 46.dp),
            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Text(titel, style = css(16f, 500, abstand = 0.5f, farbe = LIME.copy(alpha = 0.5f)), maxLines = 1)
            Box(Modifier.weight(1f)) { inhalt() }
        }
        if (hatWert) {
            Box(Modifier.align(Alignment.CenterEnd).padding(end = 12.dp).size(32.dp, 40.dp).tippen(leeren), contentAlignment = Alignment.Center) {
                Icon("clear-field-green", Modifier.size(20.dp))
            }
        } else {
            Icon("Arrow-kurz_Trisar_Icons_01_Lime", Modifier.align(Alignment.CenterEnd).padding(end = 18.dp).size(10.dp, 13.dp))
        }
    }
}

@Composable
private fun FilterEingabe(titel: String, text: String, aendern: (String) -> Unit, modifier: Modifier) {
    FilterRahmen(titel, text.isNotBlank(), { aendern("") }, modifier) {
        LimeEingabe(text, aendern, Modifier.fillMaxWidth(), stil = css(16f, 500, farbe = LIME))
    }
}

/** `<input type="date">`: zeigt TT.MM.JJJJ wie der Browser, Tippen oeffnet die Datumsauswahl. */
@Composable
private fun FilterDatum(titel: String, wert: String, aendern: (String) -> Unit, modifier: Modifier) {
    val ctx = LocalContext.current
    val t = wert.split("-")
    val anzeige = if (t.size == 3) "${t[2]}.${t[1]}.${t[0]}" else "TT.MM.JJJJ"
    FilterRahmen(titel, wert.isNotEmpty(), { aendern("") }, modifier) {
        Box(Modifier.fillMaxWidth().fillMaxHeight().tippen { datumWaehlen(ctx, wert, aendern) }, contentAlignment = Alignment.CenterStart) {
            Text(anzeige, style = css(16f, 500, abstand = 0.5f, farbe = LIME.copy(alpha = if (wert.isEmpty()) 0.5f else 1f)))
        }
    }
}

/** ToggleRow: aktiv = Lime-Flaeche mit dunkler Schrift, sonst Lime-Rahmen. */
@Composable
private fun FilterSchalter(titel: String, an: Boolean, modifier: Modifier, umschalten: () -> Unit) {
    Box(
        modifier.background(if (an) LIME else Color.Transparent).border(2.dp, LIME).tippen(umschalten),
        contentAlignment = Alignment.Center,
    ) { Text(titel, style = css(16f, 500, abstand = 0.4f, farbe = if (an) hex(0x262626) else LIME)) }
}
