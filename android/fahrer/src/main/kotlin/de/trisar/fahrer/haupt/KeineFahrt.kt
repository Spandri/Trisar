package de.trisar.fahrer.haupt

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.ime
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.unit.dp
import de.trisar.kern.FahrzeugKarte
import de.trisar.kern.FahrzeugZeile
import de.trisar.kern.FussleisteUnten
import de.trisar.kern.Icon
import de.trisar.kern.ProfilKnopf
import de.trisar.kern.ZurueckKnopf
import de.trisar.kern.grotesk
import de.trisar.kern.hex
import de.trisar.kern.platz
import de.trisar.kern.tippen
import de.trisar.kern.Farbe

/**
 * Nachbau von KeineFahrtTrisar.jsx (mit Fahrzeug) und KeinAuto.jsx (ohne Fahrzeug), wie KeineFahrtAnsicht.swift.
 * Beide Web-Bildschirme sind im Raster 393 x 874 gebaut.
 */
@Composable
internal fun KeineFahrtSeite(
    fahrzeug: FahrzeugZeile?,
    oeffneProfil: () -> Unit,
    oeffneFahrzeug: () -> Unit,
    abmelden: () -> Unit,
    stundenStand: Int = 0,
    stundenErfassen: (de.trisar.kern.Stunden.Eintrag) -> Unit = {},
) {
    Box(Modifier.fillMaxSize()) {
        Leinwand(breite = 393f) {
            Icon("trisar_logo", Modifier.platz(20f, 116f, 161.79f, 24f))
            ProfilKnopf(Modifier.platz(393f - 20f - 52f, 86f), oeffneProfil)

            Text(
                if (fahrzeug == null) "Hey aktuell gibt es keine Fahrt und kein Auto für dich!" else "Hey aktuell gibt es keine Fahrt für dich!",
                style = grotesk(34f, 500, zeilenHoehe = 34f * 1.18f, abstand = -0.5f),
                modifier = Modifier.platz(20f, 194f, 362f),
            )

            // Offene Stunden nach einem Dienst (StundenHinweis, top 380).
            StundenHinweis(stundenStand, Modifier.platz(20f, 380f, 362f, 56f), stundenErfassen)

            if (fahrzeug != null) {
                FahrzeugKarte(fahrzeug, listOf(fahrzeug.brand_model, fahrzeug.license_plate).map { it?.trim().orEmpty() }.firstOrNull { it.isNotEmpty() }.orEmpty(), Modifier.platz(20f, 462f).tippen(oeffneFahrzeug), bildOben = 55.57f)
            } else {
                Box(Modifier.platz(20f, 432f, 362f, 40f), contentAlignment = Alignment.CenterStart) {
                    Text("Komm später nochmal", style = grotesk(34f, 500, abstand = -0.5f), maxLines = 1)
                }
                Icon("Arrow_Trisar_Icons_01", Modifier.platz(20f, 496f, 362f, 234f))
            }

            Box(
                Modifier.platz(20f, 754f, 362f, 56f).border(1.dp, hex(0x7F8A2B)).tippen(abmelden),
                contentAlignment = Alignment.Center,
            ) { Text("Abmelden", style = grotesk(16f, 500, abstand = 0.5f, farbe = hex(0x7F8A2B))) }
        }
        // Fest am unteren Rand wie auf allen anderen Seiten.
        FussleisteUnten()
    }
}

/** Nachbau von CancelRideSheet.jsx: „Warum wollen Sie diese Fahrt stornieren?“ mit Notiz. */
@Composable
internal fun AblehnenBlatt(schliessen: () -> Unit, bestaetigen: (String) -> Unit) {
    NotizBlatt(
        titel = "Warum wollen Sie diese Fahrt stornieren?", titelFarbe = Farbe.lime,
        knopf = "Stornieren beenden", knopfFarbe = Farbe.lime,
        schliessen = schliessen, bestaetigen = bestaetigen,
    )
}

/**
 * Gemeinsames Layout von CancelRideSheet, FahrtBeenden und NotizSend (Raster 402 x 864):
 * Zurueck bei 20/60, Titel bei 140 (42 fett, Zeile 48), Notizfeld bei 460, Knopf bei 742.
 */
@Composable
internal fun NotizBlatt(
    titel: String,
    titelFarbe: Color,
    knopf: String,
    knopfFarbe: Color,
    schliessen: () -> Unit,
    bestaetigen: (String) -> Unit,
    beschaeftigt: Boolean = false,
) {
    var notiz by remember { mutableStateOf("") }
    val fokus = LocalFocusManager.current
    val feld = remember { FocusRequester() }
    val tastaturOffen = WindowInsets.ime.getBottom(LocalDensity.current) > 0

    Box(Modifier.fillMaxSize().tippen { fokus.clearFocus() }) {
        Leinwand(basisHoehe = 864f) {
            ZurueckKnopf(Modifier.platz(20f, 60f), schliessen)

            Text(titel, style = grotesk(42f, 700, zeilenHoehe = 48f, abstand = -0.5f, farbe = titelFarbe), modifier = Modifier.platz(20f, 140f, 362f))

            Box(Modifier.platz(0f, 460f, 402f, 224f).background(hex(0x1A1A1A), RoundedCornerShape(12.dp))) {
                Column(
                    Modifier.padding(start = 20.dp, top = 20.dp).size(362.dp, 184.dp).background(Color.White)
                        .tippen { feld.requestFocus() }.padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                        Text("Notizen", style = grotesk(16f, 700, abstand = 0.5f, farbe = hex(0x1D1C1D)))
                        Spacer(Modifier.weight(1f))
                        Icon("Stift", Modifier.size(20.dp))
                    }
                    BasicTextField(
                        notiz, { notiz = it },
                        textStyle = grotesk(14f, abstand = 0.25f, farbe = hex(0x1D1C1D)),
                        cursorBrush = SolidColor(hex(0x1D1C1D)),
                        minLines = 6, maxLines = 6,
                        modifier = Modifier.fillMaxWidth().focusRequester(feld),
                        decorationBox = { inner ->
                            Box {
                                if (notiz.isEmpty()) Text("Schreiben...", style = grotesk(14f, abstand = 0.25f, farbe = Color(129, 129, 129).copy(alpha = 0.5f)))
                                inner()
                            }
                        },
                    )
                }
            }

            Row(
                Modifier.platz(20f, 742f, 362f, 56f).background(knopfFarbe)
                    .tippen { if (!beschaeftigt) { fokus.clearFocus(); bestaetigen(notiz) } }
                    .padding(horizontal = 24.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(knopf, style = grotesk(16f, 700, abstand = -0.5f, farbe = Color.Black))
                Spacer(Modifier.weight(1f))
                if (beschaeftigt) CircularProgressIndicator(Modifier.size(20.dp), color = Color.Black, strokeWidth = 2.dp)
                else Icon("PfeilDunkel", Modifier.size(34.dp, 20.dp))
            }
        }
        if (!tastaturOffen) FussleisteUnten()
    }
}
