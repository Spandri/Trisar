package de.trisar.dispo.fahrten

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
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import de.trisar.kern.Icon
import de.trisar.kern.grotesk
import de.trisar.kern.hex
import de.trisar.kern.tippen

/** ETA-Marke rechts in der Zeile (etaIndicator). Farbe: #808080 grau, #f55757 rot, #ffb84d orange. */
internal data class EtaMarke(val text: String = "", val farbe: Long = 0x808080)

/** Knopf rechts in der Zeile (rightAction): Haken, Kreuz oder Pfeil. */
internal enum class RechtsArt { HAKEN, KREUZ, PFEIL }

/**
 * FormRow aus FahrtAdd.jsx (FormularZeile in iOS): 362 x 56, 2 px Lime-Rand, Beschriftung halb deckend,
 * Eingabe dahinter, rechts ETA-Marke und Leeren-Knopf bzw. Pfeil.
 */
@Composable
internal fun FormularZeile(
    beschriftung: String,
    wert: String,
    modifier: Modifier,
    eta: EtaMarke? = null,
    etaAktion: (() -> Unit)? = null,
    rechts: RechtsArt? = null,
    rechtsAktion: (() -> Unit)? = null,
    zuruecksetzen: () -> Unit,
    feld: @Composable () -> Unit,
) {
    val gefuellt = FahrtText.getrimmt(wert).isNotEmpty()
    val hatEta = !(eta?.text ?: "").isEmpty()
    Box(modifier.clipToBounds().border(2.dp, LIME)) {
        // p-1 + px-3 links, pr-10 bzw. pr-16 rechts, gap-4 zwischen Beschriftung und Eingabe.
        Row(
            Modifier.fillMaxSize().padding(start = 18.dp, end = (6 + if (hatEta) 64 else 40).dp),
            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Text(beschriftung, style = css(16f, 500, abstand = 0.5f, farbe = LIME.copy(alpha = 0.5f)), maxLines = 1, softWrap = false)
            Box(Modifier.weight(1f).fillMaxSize(), contentAlignment = Alignment.CenterStart) { feld() }
        }
        Row(
            Modifier.align(Alignment.CenterEnd).padding(end = 14.dp),
            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            if (eta != null && hatEta) {
                val stil = css(12f, 700, farbe = hex(eta.farbe))
                if (etaAktion != null) Text(eta.text, style = stil.copy(textDecoration = TextDecoration.Underline), modifier = Modifier.tippen(etaAktion))
                else Text(eta.text, style = stil)
            }
            when {
                rechts != null -> Box(
                    Modifier.size(20.dp).tippen { rechtsAktion?.invoke() },
                    // Pfeil buendig rechts wie in den Zeilen ohne Knopf, Haken/Kreuz mittig.
                    contentAlignment = if (rechts == RechtsArt.PFEIL) Alignment.CenterEnd else Alignment.Center,
                ) {
                    when (rechts) {
                        RechtsArt.HAKEN -> Text("✓", style = TextStyle(fontSize = 16.sp, fontWeight = FontWeight.Bold, color = hex(0x59BE80)))
                        RechtsArt.KREUZ -> Text("✕", style = TextStyle(fontSize = 16.sp, fontWeight = FontWeight.Bold, color = hex(0xF55757)))
                        RechtsArt.PFEIL -> Icon("Arrow-kurz_Trisar_Icons_01_Lime", Modifier.size(10.dp, 13.dp))
                    }
                }
                gefuellt -> Icon("clear-field-green", Modifier.size(20.dp).tippen(zuruecksetzen))
                else -> Icon("Arrow-kurz_Trisar_Icons_01_Lime", Modifier.size(10.dp, 13.dp))
            }
        }
    }
}

/** Wert-Anzeige fuer Datum/Uhrzeit/Auswahl (wie das native Feld im Browser). */
@Composable
internal fun ZeilenWert(text: String, aktion: () -> Unit) {
    Box(Modifier.fillMaxSize().tippen(aktion), contentAlignment = Alignment.CenterStart) {
        Text(text, style = css(16f, 500, abstand = 0.5f, farbe = LIME), maxLines = 1)
    }
}

/** Vorschlagsliste unter einer Zeile: max. 180 hoch, rounded-2xl, Rand #4a4f22, Grund #151607. */
@Composable
internal fun VorschlagListe(eintraege: List<String>, modifier: Modifier, kopf: String? = null, maxHoehe: Float = 180f, waehlen: (Int) -> Unit) {
    val form = RoundedCornerShape(16.dp)
    Column(
        modifier.width(362.dp).heightIn(max = maxHoehe.dp).clip(form).background(hex(0x151607)).border(1.dp, hex(0x4A4F22), form)
            .verticalScroll(rememberScrollState())
    ) {
        if (kopf != null) {
            Text(kopf.uppercase(), style = css(11f, 700, abstand = 0.275f, farbe = LIME),
                modifier = Modifier.alpha(0.6f).fillMaxWidth().padding(start = 12.dp, end = 12.dp, top = 12.dp, bottom = 4.dp))
        }
        eintraege.forEachIndexed { i, eintrag ->
            Text(eintrag, style = grotesk(13f, 500, farbe = LIME), modifier = Modifier.fillMaxWidth().tippen { waehlen(i) }.padding(12.dp))
            if (i < eintraege.size - 1) Box(Modifier.fillMaxWidth().height(1.dp).background(hex(0x2A2D15)))
        }
    }
}

/**
 * Vorschlaege fuer Start/Ziel: eigene Orte mit ihrem Icon ganz oben, darunter die Adressen.
 * Gleicher Look wie VorschlagListe.
 */
@Composable
internal fun OrtVorschlagListe(
    orte: List<de.trisar.kern.Ort>,
    adressen: List<String>,
    modifier: Modifier,
    ortWaehlen: (de.trisar.kern.Ort) -> Unit,
    adresseWaehlen: (Int) -> Unit,
) {
    val form = RoundedCornerShape(16.dp)
    val anzahl = orte.size + adressen.size
    Column(
        modifier.width(362.dp).heightIn(max = 180.dp).clip(form).background(hex(0x151607)).border(1.dp, hex(0x4A4F22), form)
            .verticalScroll(rememberScrollState())
    ) {
        orte.forEachIndexed { i, o ->
            Row(
                Modifier.fillMaxWidth().tippen { ortWaehlen(o) }.padding(12.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Icon(de.trisar.kern.OrtIcons.lime(o.icon), Modifier.size(18.dp))
                Text(o.name, style = grotesk(13f, 700, farbe = LIME), maxLines = 1)
            }
            if (i < anzahl - 1) Box(Modifier.fillMaxWidth().height(1.dp).background(hex(0x2A2D15)))
        }
        adressen.forEachIndexed { i, eintrag ->
            Text(eintrag, style = grotesk(13f, 500, farbe = LIME), modifier = Modifier.fillMaxWidth().tippen { adresseWaehlen(i) }.padding(12.dp))
            if (orte.size + i < anzahl - 1) Box(Modifier.fillMaxWidth().height(1.dp).background(hex(0x2A2D15)))
        }
    }
}

/** Lime-Knopf „Fahrt speichern“: Text links (p-1 + px-3), schwarzer Pfeil rechts (mr-4). */
@Composable
internal fun FormularSpeichernKnopf(text: String, gesperrt: Boolean, modifier: Modifier, aktion: () -> Unit) {
    Row(
        modifier.alpha(if (gesperrt) 0.7f else 1f).background(LIME).tippen { if (!gesperrt) aktion() }.padding(horizontal = 18.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(text, style = css(16f, 500, abstand = 0.4f, farbe = hex(0x262626)))
        Spacer(Modifier.weight(1f))
        Icon("Arrow_Trisar_Icons_01", Modifier.size(34.dp, 20.dp))
    }
}
