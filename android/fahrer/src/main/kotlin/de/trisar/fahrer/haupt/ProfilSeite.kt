package de.trisar.fahrer.haupt

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import de.trisar.kern.Anmeldung
import de.trisar.kern.FussleisteUnten
import de.trisar.kern.Icon
import de.trisar.kern.ZurueckKnopf
import de.trisar.kern.grotesk
import de.trisar.kern.hex
import de.trisar.kern.platz
import de.trisar.kern.tippen

private data class Kachel(val x: Float, val y: Float, val einheit: String, val blitzX: Float, val blitzY: Float)

private val KACHELN = listOf(
    Kachel(20f, 329f, "km", 169f, 341f),
    Kachel(204f, 329f, "Liter", 353f, 341f),
    Kachel(20f, 450f, "Fahrten", 168f, 460.71f),
    Kachel(204f, 450f, "Stunden", 353f, 462f),
)

/** Nachbau von ProfilFahrerView.jsx wie ProfilAnsicht.swift (Raster 402 x 875). Kennzahlen sind im Live-Betrieb „–“. */
@Composable
internal fun ProfilSeite(
    anmeldung: Anmeldung,
    zurueck: () -> Unit,
    oeffneAnsprechpartner: () -> Unit,
    oeffneVerlauf: () -> Unit,
    oeffneEinstellungen: () -> Unit,
) {
    val profil by anmeldung.profil.collectAsState()
    val name = listOfNotNull(profil?.first_name?.trim(), profil?.last_name?.trim()).filter { it.isNotEmpty() }.joinToString(" ")

    Box(Modifier.fillMaxSize()) {
        Leinwand(basisHoehe = 875f, mitHintergrund = false) { rahmen ->
            ProfilHintergrund(Modifier.size(402.dp, rahmen.dp))
            ZurueckKnopf(Modifier.platz(20f, 60f), zurueck)

            Text(name, style = grotesk(48f, 700, abstand = -0.5f, farbe = hex(0xE2F754)), maxLines = 1, softWrap = false,
                modifier = Modifier.platz(20f, 272f - 28f))

            for (k in KACHELN) {
                Box(Modifier.platz(k.x, k.y, 178f, 115f).border(2.dp, hex(0xE3F654)))
                // Grundlinie wie lastTextBaseline in iOS.
                Row(Modifier.platz(k.x + 20f, k.y + 71f), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("–", style = grotesk(36f, 500, abstand = 0.5f, farbe = hex(0xE3F654)), modifier = Modifier.alignByBaseline())
                    Text(k.einheit, style = grotesk(16f, 500, abstand = 0.5f, farbe = hex(0xE3F654)),
                        modifier = Modifier.alignByBaseline().alpha(0.5f))
                }
                Icon("Blitz_Trisar_Icons_01_Lime", Modifier.platz(k.blitzX, k.blitzY, 16f, 20f).alpha(0.5f))
            }

            ProfilZeile("Ansprechpartner", Modifier.platz(21f, 589f, 360f, 56f), oeffneAnsprechpartner)
            ProfilZeile("Verlauf", Modifier.platz(21f, 657f, 360f, 56f), oeffneVerlauf)

            Box(Modifier.platz(21f, 737f, 360f, 56f).alpha(0.5f).border(2.dp, hex(0xE3F654)).tippen(oeffneEinstellungen),
                contentAlignment = Alignment.Center) {
                Text("Einstellungen", style = grotesk(16f, 500, abstand = 0.5f, farbe = hex(0xE3F654)))
            }
        }
        FussleisteUnten()
    }
}

/** Lime-Zeile mit Text links (16 medium, #262626) und schwarzem Pfeil rechts. */
@Composable
private fun ProfilZeile(text: String, modifier: Modifier, aktion: () -> Unit) {
    Row(modifier.background(hex(0xE3F654)).tippen(aktion).padding(start = 16.dp, end = 12.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(text, style = grotesk(16f, 500, abstand = 0.5f, farbe = hex(0x262626)))
        Spacer(Modifier.weight(1f))
        Icon("Arrow_Trisar_Icons_01", Modifier.size(34.dp, 19.92.dp))
    }
}
