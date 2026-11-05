package de.trisar.fahrer

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import de.trisar.kern.Anmeldung
import de.trisar.kern.LoginSeite
import de.trisar.kern.TrisarHintergrund
import de.trisar.kern.WebMassstab
import de.trisar.kern.Zustand

/** Einstieg der Fahrer-App, wie TrisarFahrerApp in iOS. */
class HauptAktivitaet : ComponentActivity() {
    private val anmeldung: Anmeldung by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Helle Symbole in Status- und Navigationsleiste, der Hintergrund ist immer dunkel (wie iOS).
        enableEdgeToEdge(
            statusBarStyle = androidx.activity.SystemBarStyle.dark(android.graphics.Color.TRANSPARENT),
            navigationBarStyle = androidx.activity.SystemBarStyle.dark(android.graphics.Color.BLACK),
        )
        setContent {
            WebMassstab {
                Box(Modifier.fillMaxSize().background(Color.Black)) {
                    val zustand by anmeldung.zustand.collectAsState()
                    when (val z = zustand) {
                        Zustand.Pruefe -> TrisarHintergrund()
                        Zustand.Abgemeldet -> LoginSeite(anmeldung)
                        is Zustand.Angemeldet -> FahrerHaupt(anmeldung, z.id)
                    }
                }
            }
        }
    }
}
