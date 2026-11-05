package de.trisar.kern

import android.content.Intent
import android.provider.Settings
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch

/** Seite "Mitteilungen" wie MitteilungenAnsicht in iOS: je Gruppe ein Schalter. */
@Composable
fun MitteilungenSeite(nutzer: String, gruppen: List<PushArten.Gruppe>, zurueck: () -> Unit) {
    val ctx = LocalContext.current
    var aus by remember { mutableStateOf<Set<String>>(emptySet()) }
    val bereich = rememberCoroutineScope()
    val erlaubt = remember { PushEinstellungen.systemErlaubt(ctx) }
    LaunchedEffect(nutzer) { aus = PushEinstellungen.laden(nutzer) }
    BackHandler(onBack = zurueck)

    Box(Modifier.fillMaxSize().background(Color.Black)) {
        TrisarHintergrund()
        ZurueckKnopf(Modifier.platz(20f, 60f), zurueck)
        Text("Mitteilungen", style = grotesk(42f, 700, abstand = -0.5f, farbe = Farbe.limeIcon), modifier = Modifier.platz(20f, 140f))
        Column(Modifier.platz(20f, 200f, 362f), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            if (!erlaubt) {
                Text(
                    "Mitteilungen sind in den Android-Einstellungen aus. Hier tippen, um sie zu erlauben.",
                    style = grotesk(14f, 500, farbe = Color.Black),
                    modifier = Modifier.fillMaxWidth().background(Farbe.limeIcon).tippen {
                        ctx.startActivity(Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                            .putExtra(Settings.EXTRA_APP_PACKAGE, ctx.packageName)
                            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                    }.padding(16.dp),
                )
            }
            for (g in gruppen) {
                val an = !g.arten.all { it in aus }
                Row(
                    Modifier.fillMaxWidth().height(64.dp).background(Color(0xFF1A1A1A)).padding(horizontal = 16.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(g.titel, style = grotesk(16f, 500), modifier = Modifier.weight(1f))
                    Switch(
                        checked = an,
                        onCheckedChange = { neu ->
                            aus = if (neu) aus - g.arten.toSet() else aus + g.arten
                            val stand = aus
                            bereich.launch { PushEinstellungen.speichern(nutzer, stand) }
                        },
                        colors = SwitchDefaults.colors(checkedTrackColor = Farbe.limeIcon, checkedThumbColor = Color.Black),
                    )
                }
            }
        }
        FussleisteUnten()
    }
}
