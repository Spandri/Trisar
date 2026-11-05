package de.trisar.dispo

import androidx.activity.compose.BackHandler
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.unit.dp
import de.trisar.dispo.fahrten.FahrtFormularSeite
import de.trisar.dispo.fahrten.FahrtenSeite
import de.trisar.dispo.karte.DispoKarteSeite
import de.trisar.dispo.planung.KiAssistentSeite
import de.trisar.dispo.planung.PlanungSeite
import de.trisar.dispo.stamm.FahrerBereich
import de.trisar.dispo.stamm.FahrzeugBereich
import de.trisar.dispo.stamm.KoordinatorProfil
import de.trisar.dispo.stamm.KundenBereich
import de.trisar.kern.Anmeldung
import de.trisar.kern.DispoHintergrund
import de.trisar.kern.Icon
import de.trisar.kern.ProfilKnopf
import de.trisar.kern.grotesk
import de.trisar.kern.hex
import de.trisar.kern.platz
import de.trisar.kern.tippen

/**
 * Seitenwechsel der Dispo-App wie setView in admin/src/App.jsx (DispoHaupt.swift).
 * Jede Seite bekommt `zeigen` fuer die Navigation und baut ihre Navileiste selbst ein.
 * Die Unterseiten der Planung (Einstellungen, Simulation, Ereignisse, Puffer) oeffnet die Planung selbst.
 */
@Composable
fun DispoHaupt(anmeldung: Anmeldung) {
    var ziel by rememberSaveable { mutableStateOf(DispoZiel.START) }
    /** Fahrt im Editor (Tipp in der Fahrtenliste), wie setView('fahrtBearbeiten') im Web. */
    var bearbeiteteFahrt by rememberSaveable { mutableStateOf<String?>(null) }
    val zeigen: (DispoZiel) -> Unit = { ziel = it }
    val oeffneFahrt: (String) -> Unit = { bearbeiteteFahrt = it }

    // Android-Zurueck: erst den Editor schliessen, dann zur Startseite.
    BackHandler(enabled = bearbeiteteFahrt != null || ziel != DispoZiel.START) {
        if (bearbeiteteFahrt != null) bearbeiteteFahrt = null else ziel = DispoZiel.START
    }

    Box(Modifier.fillMaxSize().background(Color.Black)) {
        // Jede Seite neu wie .id(ziel) in iOS.
        key(ziel) {
            when (ziel) {
                DispoZiel.START -> DispoStartseite(anmeldung, zeigen)
                DispoZiel.FAHRER -> FahrerBereich(zeigen)
                DispoZiel.FAHRZEUGE -> FahrzeugBereich(zeigen)
                DispoZiel.KUNDEN -> KundenBereich(zeigen)
                DispoZiel.PROFIL -> KoordinatorProfil(zeigen)
                DispoZiel.FAHRTEN -> FahrtenSeite(zeigen, oeffneFahrt)
                DispoZiel.KARTE -> DispoKarteSeite(zeigen)
                DispoZiel.PLANUNG -> PlanungSeite(zeigen, oeffneFahrt)
                DispoZiel.KI_ASSISTENT -> KiAssistentSeite(zeigen, oeffneFahrt)
                DispoZiel.FAHRT_NEU -> FahrtFormularSeite(fahrtID = null, zurueck = { ziel = DispoZiel.START }, zeigen = zeigen)
            }
        }
        // Editor liegt als eigene Seite darueber, ohne Hochschieben (wie setView im Web).
        bearbeiteteFahrt?.let { id ->
            key(id) { FahrtFormularSeite(fahrtID = id, zurueck = { bearbeiteteFahrt = null }, zeigen = null) }
        }
    }
}

/** HomeScreen.jsx: Profil-Knopf, Logo, Begruessung, vier Knoepfe ab 442, Leiste unten. */
@Composable
private fun DispoStartseite(anmeldung: Anmeldung, zeigen: (DispoZiel) -> Unit) {
    val profil by anmeldung.profil.collectAsState()
    Box(Modifier.fillMaxSize()) {
        DispoHintergrund()
        Box(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
            Box(Modifier.fillMaxWidth().height(874.dp)) {
                ProfilKnopf(Modifier.platz(402f - 20f - 52f, 60f)) { zeigen(DispoZiel.PROFIL) }
                Icon("trisar_logo", Modifier.platz(20f, 115f, 161f, 24f))
                Text(
                    "Willkommen zurück ${profil?.vorname ?: ""}",
                    style = grotesk(34f, 500, 34f * 1.276f, -0.5f),
                    modifier = Modifier.platz(20f, 180f, 362f),
                )
                Column(Modifier.platz(20f, 442f, 362f), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    PlanungsKnopf { zeigen(DispoZiel.PLANUNG) }
                    StartKnopf("Fahrer Liste") { zeigen(DispoZiel.FAHRER) }
                    StartKnopf("Kunden Liste") { zeigen(DispoZiel.KUNDEN) }
                    StartKnopf("Fahrzeugliste") { zeigen(DispoZiel.FAHRZEUGE) }
                }
            }
        }
        Navileiste(DispoZiel.START, zeigen)
    }
}

/** ActionButton: Lime, Text links 16 medium, schwarzer Pfeil rechts. */
@Composable
private fun StartKnopf(text: String, aktion: () -> Unit) {
    Row(
        Modifier.size(362.dp, 56.dp).background(hex(0xE3F654)).tippen(aktion).padding(horizontal = 16.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(text, style = grotesk(16f, 500, abstand = 0.5f, farbe = Color.Black))
        Spacer(Modifier.weight(1f))
        Icon("Arrow_Trisar_Icons_01", Modifier.size(34.dp, 20.dp))
    }
}

/** PlanungsKnopf: schwarz mit Lime-Rand, langsam drehender Farbverlauf Blau -> Schwarz -> Lime. */
@Composable
private fun PlanungsKnopf(aktion: () -> Unit) {
    val dreh = rememberInfiniteTransition(label = "planung")
    val winkel by dreh.animateFloat(22.66f, 382.66f, infiniteRepeatable(tween(120_000, easing = LinearEasing), RepeatMode.Restart), label = "winkel")
    Box(Modifier.size(362.dp, 56.dp).background(Color.Black).clipToBounds().tippen(aktion)) {
        Canvas(Modifier.fillMaxSize()) {
            val c = Offset(size.width / 2f, size.height / 2f)
            val halb = 210.dp.toPx()
            rotate(winkel, c) {
                drawRect(
                    Brush.horizontalGradient(
                        0f to Color(0f, 89f / 255f, 1f, 0.78f),
                        0.314f to Color(0f, 89f / 255f, 1f, 0.78f),
                        0.56f to Color.Black,
                        // Stopp 1.2 in iOS: Farbe bei 1.0 auf dem Weg von Schwarz nach hsb(66, 44 %, 76 %).
                        1f to Color(127, 133, 75),
                        startX = c.x - halb, endX = c.x + halb,
                    ),
                    topLeft = Offset(c.x - halb, c.y - halb), size = Size(halb * 2, halb * 2),
                )
            }
        }
        Row(Modifier.fillMaxSize().padding(start = 22.dp, end = 26.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("Planung", style = grotesk(16f, 500, abstand = 0.5f, farbe = hex(0xE3F654)))
            Spacer(Modifier.weight(1f))
            Icon("Planen_Sparkle_Lime", Modifier.size(24.dp, 24.14.dp))
        }
        Box(Modifier.fillMaxSize().border(2.dp, hex(0xE2F754)))
    }
}
