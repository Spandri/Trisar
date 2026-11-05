package de.trisar.fahrer.fahrt

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import de.trisar.kern.CssRadial
import de.trisar.kern.FussleisteUnten
import de.trisar.kern.Icon
import de.trisar.kern.ZurueckKnopf
import de.trisar.kern.grotesk
import de.trisar.kern.hex
import de.trisar.kern.platz
import de.trisar.kern.tippen

/**
 * Support-Seite, Nachbau von SupportAnsicht.swift (AnsprechpartnerView.jsx im Live-Betrieb):
 * eine Kontaktkarte „TRISAR Disposition“ an der Stelle der Hotline (top 242),
 * dunkler Bereich ab 221, Titel „Support“ bei 140.
 * SCHNITTSTELLE: Signatur nicht aendern.
 */
@Composable
fun SupportSeite(zurueck: () -> Unit) {
    BackHandler { zurueck() }
    val karteOben = 242f
    val karteHoehe = 543f
    val gesamt = karteOben + karteHoehe + 30f + 40f + 1f

    BoxWithConstraints(Modifier.fillMaxSize().background(Color.Black)) {
        val hoehe = maxOf(gesamt, maxHeight.value)
        Box(Modifier.fillMaxSize().verticalScroll(rememberScrollState(), enabled = gesamt > maxHeight.value)) {
            Box(Modifier.fillMaxWidth().height(hoehe.dp)) {
                CssRadial(
                    1.4142f, 2.0732f,
                    listOf(0x313701L to 0f, 0x191C00L to 0.2283f, 0x0C0E00L to 0.3424f, 0x000000L to 0.45659f, 0x000000L to 1f),
                )
                Box(Modifier.platz(0f, 221f, 402f, hoehe - 221f).background(hex(0x1A1A1A), RoundedCornerShape(topStart = 12.dp, topEnd = 12.dp)))

                ZurueckKnopf(Modifier.platz(20f, 60f)) { zurueck() }

                Text("Support", style = grotesk(42f, 700, zeilenHoehe = 42f, abstand = -0.5f, farbe = hex(0xE2F754)),
                    modifier = Modifier.platz(20f, 140f))

                KontaktKarte(
                    name = "TRISAR Disposition",
                    rolle = "Schichtplanung & Disposition",
                    beschreibung = "Verantwortlich für Schichten und Disposition: Einsatzzeiten, Schichttausch, Pausen und kurzfristige Ausfälle.",
                    zeiten = "",
                    email = "team@trisar.de",
                    telefon = null,
                    modifier = Modifier.platz(20f, karteOben, 362f, karteHoehe),
                )
            }
        }
        FussleisteUnten()
    }
}

/**
 * ContactCard: weisse Karte 362 x 543, Foto-Feld mit Initialen, Name, Rolle, Zeiten, Mail,
 * Knopf „Get in touch“ (Telefon, ohne Nummer Mail).
 */
@Composable
private fun KontaktKarte(
    name: String, rolle: String, beschreibung: String, zeiten: String, email: String, telefon: String?, modifier: Modifier,
) {
    val oeffnen = LocalUriHandler.current
    val initialen = name.split(" ").filter { it.isNotEmpty() }.joinToString("") { it.take(1) }
    Box(modifier.background(Color.White)) {
        Box(Modifier.platz(12f, 12f, 338f, 244f).background(hex(0xD9D9D9)), contentAlignment = Alignment.Center) {
            Text(initialen, style = grotesk(48f, 700, farbe = hex(0x6B7280)))
        }
        Text(name, style = grotesk(30f, 700, abstand = 0.5f, farbe = Color.Black), modifier = Modifier.platz(11f, 279f))
        Text(
            buildAnnotatedString {
                withStyle(SpanStyle(color = Color.Black)) { append(rolle + "\n") }
                withStyle(SpanStyle(color = hex(0x9A9A9A))) { append(beschreibung) }
            },
            style = grotesk(12f, 700, zeilenHoehe = 16f, abstand = 0.5f),
            modifier = Modifier.platz(12f, 317f, 338f),
        )
        if (zeiten.isNotEmpty()) {
            Text(zeiten, style = grotesk(18f, 700, abstand = 0.5f, farbe = Color.Black), modifier = Modifier.platz(13f, 386f))
        }
        Text(email, style = grotesk(18f, 700, abstand = 0.5f, farbe = Color.Black), modifier = Modifier.platz(12f, 408f))
        Row(
            Modifier.platz(12f, 457f, 338f, 56f).background(hex(0xE3F654)).tippen {
                runCatching { if (telefon != null) oeffnen.openUri("tel:$telefon") else oeffnen.openUri("mailto:$email") }
            },
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Spacer(Modifier.weight(1f))
            Text("Get in touch", style = grotesk(24f, 700, abstand = -0.5f, farbe = Color.Black))
            Spacer(Modifier.width(10.dp))
            Box(Modifier.size(35.dp), contentAlignment = Alignment.Center) {
                Icon(if (telefon == null) "lucide-mail" else "contact-phone", Modifier.size(20.dp), farbe = ColorFilter.tint(Color.Black))
            }
            Spacer(Modifier.weight(1f))
        }
    }
}
