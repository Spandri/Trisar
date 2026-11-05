package de.trisar.fahrer

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import de.trisar.kern.Anmeldung
import de.trisar.kern.FussleisteUnten
import de.trisar.kern.TrisarHintergrund
import de.trisar.kern.grotesk
import de.trisar.kern.tippen

/** Platzhalter bis zum Nachbau (HauptAnsicht in iOS). */
@Composable
fun FahrerHaupt(anmeldung: Anmeldung, fahrerID: String) {
    Box(Modifier.fillMaxSize()) {
        TrisarHintergrund()
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            androidx.compose.material3.Text("Angemeldet. Abmelden", style = grotesk(20f), modifier = Modifier.tippen { anmeldung.abmelden() })
        }
        FussleisteUnten()
    }
}
