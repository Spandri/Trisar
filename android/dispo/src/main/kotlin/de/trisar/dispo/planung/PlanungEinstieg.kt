package de.trisar.dispo.planung

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import de.trisar.dispo.DispoZiel
import de.trisar.dispo.Navileiste
import de.trisar.kern.DispoHintergrund
import de.trisar.kern.grotesk
import de.trisar.kern.hex
import de.trisar.kern.platz

// PLATZHALTER von dispo-a: wird beim Zusammenfuehren durch die echte Umsetzung ersetzt.

@Composable
fun PlanungSeite(zeigen: (DispoZiel) -> Unit, oeffneFahrt: (String) -> Unit) = Platzhalter("Planung", DispoZiel.PLANUNG, zeigen)

@Composable
fun KiAssistentSeite(zeigen: (DispoZiel) -> Unit, oeffneFahrt: (String) -> Unit) = Platzhalter("KI-Assistent", DispoZiel.KI_ASSISTENT, zeigen)

@Composable
private fun Platzhalter(titel: String, aktiv: DispoZiel, zeigen: (DispoZiel) -> Unit) {
    Box(Modifier.fillMaxSize()) {
        DispoHintergrund()
        Text(titel, style = grotesk(42f, 700, 42f, -0.5f, hex(0xE2F754)), modifier = Modifier.platz(20f, 140f))
        Navileiste(aktiv, zeigen)
    }
}
