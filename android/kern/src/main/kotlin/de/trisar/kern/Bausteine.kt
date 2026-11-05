package de.trisar.kern

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp

/** Tippen ohne Ripple/Abdunkeln, wie Knoepfe im Web (und .web-Stil in iOS). */
fun Modifier.tippen(aktion: () -> Unit): Modifier = this.then(
    Modifier.clickable(interactionSource = MutableInteractionSource(), indication = null, onClick = aktion)
)

/** Fussleiste wie TrisarFooter: © impressum · Logo · support, 40 hoch, schwarz. */
@Composable
fun TrisarFussleiste(support: () -> Unit = { SupportSignal.oeffnen() }) {
    Row(
        Modifier.fillMaxWidth().height(40.dp).background(Color.Black),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text("© impressum", style = grotesk(10f, 500, abstand = -0.5f, farbe = Farbe.limeIcon),
            modifier = Modifier.width(116.dp), textAlign = TextAlign.Center)
        Spacer(Modifier.weight(1f))
        Icon("TrisarLogo", Modifier.size(73.dp, 10.83.dp))
        Spacer(Modifier.weight(1f))
        Box(Modifier.width(116.dp).height(40.dp).tippen(support), contentAlignment = Alignment.Center) {
            Text("support", style = grotesk(10f, 500, abstand = -0.5f, farbe = Farbe.limeIcon))
        }
    }
}

/** Fussleiste fest am unteren Bildschirmrand (ueber der Navigationsleiste von Android). */
@Composable
fun FussleisteUnten() {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.BottomCenter) {
        Box(Modifier.background(Color.Black).navigationBarsPadding()) { TrisarFussleiste() }
    }
}

/** Zurueck-Knopf (ZurueckKnopf.jsx): 50er Kreis, grauer Rand, gedrehter Pfeil. */
@Composable
fun ZurueckKnopf(modifier: Modifier = Modifier, aktion: () -> Unit) {
    Box(modifier.size(50.dp).border(1.dp, hex(0x747474), CircleShape).tippen(aktion)) {
        Icon("Arrow_Trisar_Icons_01_grau",
            Modifier.padding(start = 12.5.dp, top = 17.05.dp).size(26.14.dp, 15.91.dp).rotate(180f).scale(1.2f))
    }
}

/** Runder Profil-Knopf oben rechts, 52er Kreis. */
@Composable
fun ProfilKnopf(modifier: Modifier = Modifier, aktion: () -> Unit) {
    Box(modifier.size(52.dp).border(1.dp, hex(0x8F8F90), CircleShape).tippen(aktion), contentAlignment = Alignment.Center) {
        Icon("Person_Trisar_Icons_01_grau", Modifier.size(24.dp))
    }
}

/** Lime-Knopf ueber die volle Breite (wie „Anmelden“). */
@Composable
fun LimeKnopf(text: String, modifier: Modifier = Modifier, gesperrt: Boolean = false, aktion: () -> Unit) {
    Box(
        modifier.fillMaxWidth().height(56.dp).background(Farbe.lime).tippen { if (!gesperrt) aktion() },
        contentAlignment = Alignment.Center,
    ) { Text(text, style = grotesk(15f, farbe = Color.Black)) }
}

/** Support-Knopf in der Fussleiste oeffnet die gerade passende Support-Seite (wie Notification in iOS). */
object SupportSignal {
    var empfaenger: (() -> Unit)? = null
    fun oeffnen() { empfaenger?.invoke() }
}

@Composable
fun Abstand(h: Float) = Spacer(Modifier.height(h.dp))

@Composable
fun Spalte(abstand: Float, modifier: Modifier = Modifier, inhalt: @Composable () -> Unit) =
    Column(modifier, verticalArrangement = Arrangement.spacedBy(abstand.dp)) { inhalt() }
