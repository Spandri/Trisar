package de.trisar.fahrer.fahrt

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.requiredSize
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil3.compose.SubcomposeAsyncImage
import de.trisar.kern.Farbe
import de.trisar.kern.FussleisteUnten
import de.trisar.kern.Icon
import de.trisar.kern.TrisarHintergrund
import de.trisar.kern.ZurueckKnopf
import de.trisar.kern.grotesk
import de.trisar.kern.hex
import de.trisar.kern.platz
import de.trisar.kern.tippen

/**
 * Gemeinsames Layout von CancelRideSheet, FahrtBeenden und NotizSend (NotizBlatt in iOS, Raster 402 x 864):
 * Zurueck bei 20/60, Titel bei 140 (42 fett, Zeile 48), Notizfeld bei 460, Knopf bei 742.
 */
@Composable
internal fun FahrtNotizBlatt(
    titel: String, titelFarbe: Color, knopf: String, knopfFarbe: Color,
    schliessen: () -> Unit, bestaetigen: (String) -> Unit, beschaeftigt: Boolean = false,
) {
    var notiz by remember { mutableStateOf("") }
    var fokus by remember { mutableStateOf(false) }
    val feld = remember { FocusRequester() }
    val fokusVerwalter = LocalFocusManager.current
    BackHandler { schliessen() }

    BoxWithConstraints(Modifier.fillMaxSize().background(Color.Black)) {
        val hoehe = maxOf(864f, maxHeight.value)
        TrisarHintergrund()
        Box(Modifier.fillMaxSize().imePadding().verticalScroll(rememberScrollState())) {
            Box(Modifier.fillMaxWidth().height(hoehe.dp).tippen { fokusVerwalter.clearFocus() }) {
                ZurueckKnopf(Modifier.platz(20f, 60f)) { schliessen() }

                Text(titel, style = grotesk(42f, 700, zeilenHoehe = 48f, abstand = -0.5f, farbe = titelFarbe),
                    modifier = Modifier.platz(20f, 140f, 362f))

                Box(Modifier.platz(0f, 460f, 402f, 224f).background(hex(0x1A1A1A), RoundedCornerShape(12.dp))) {
                    Column(
                        Modifier.platz(20f, 20f, 362f, 184f).background(Color.White).tippen { feld.requestFocus() }.padding(16.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text("Notizen", style = grotesk(16f, 700, abstand = 0.5f, farbe = Farbe.schwarzText))
                            Spacer(Modifier.weight(1f))
                            Icon("Stift", Modifier.size(20.dp))
                        }
                        BasicTextField(
                            notiz, { notiz = it },
                            textStyle = grotesk(14f, abstand = 0.25f, farbe = Farbe.schwarzText),
                            cursorBrush = androidx.compose.ui.graphics.SolidColor(Farbe.schwarzText),
                            minLines = 6, maxLines = 6,
                            modifier = Modifier.fillMaxWidth().focusRequester(feld).onFocusChanged { fokus = it.isFocused },
                            decorationBox = { inner ->
                                Box {
                                    if (notiz.isEmpty()) Text("Schreiben...", style = grotesk(14f, abstand = 0.25f, farbe = Color(129, 129, 129, 128)))
                                    inner()
                                }
                            },
                        )
                    }
                }

                Row(
                    Modifier.platz(20f, 742f, 362f, 56f).background(knopfFarbe).tippen {
                        if (!beschaeftigt) { fokusVerwalter.clearFocus(); bestaetigen(notiz) }
                    }.padding(horizontal = 24.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(knopf, style = grotesk(16f, 700, abstand = -0.5f, farbe = Color.Black))
                    Spacer(Modifier.weight(1f))
                    if (beschaeftigt) CircularProgressIndicator(Modifier.size(20.dp), color = Color.Black, strokeWidth = 2.dp)
                    else Icon("PfeilDunkel", Modifier.size(34.dp, 20.dp))
                }
            }
        }
        if (!fokus) FussleisteUnten()
    }
}

/** Abholschild.jsx: Gaestenamen gross, quer gedreht, Tipp dreht um 180 Grad. */
@Composable
internal fun FahrtAbholschild(namen: List<String>, schliessen: () -> Unit) {
    var umgedreht by remember { mutableStateOf(false) }
    val messer = rememberTextMeasurer()
    BackHandler { schliessen() }
    BoxWithConstraints(Modifier.fillMaxSize().background(Color.Black).tippen { umgedreht = !umgedreht }, contentAlignment = Alignment.Center) {
        val b = maxWidth.value; val h = maxHeight.value
        val lang = maxOf(b, h); val kurz = minOf(b, h)
        val laengster = maxOf(1, namen.maxOfOrNull { it.length } ?: 1).toFloat()
        val zeilen = maxOf(1, namen.size).toFloat()
        val groesse = minOf(lang * 1.5f / laengster, kurz * 0.72f / zeilen, 160f)
        Column(
            Modifier.requiredSize(lang.dp, kurz.dp).rotate((if (b > h) 0f else -90f) + if (umgedreht) 180f else 0f),
            verticalArrangement = Arrangement.spacedBy((groesse * 0.15f).dp, Alignment.CenterVertically),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            namen.forEach { name ->
                // lineLimit(1).minimumScaleFactor(0.3): bei Ueberbreite kleiner setzen.
                val platzBreite = lang - groesse * 0.6f
                fun stil(g: Float) = TextStyle(fontFamily = de.trisar.kern.Grotesk, fontWeight = androidx.compose.ui.text.font.FontWeight.Bold,
                    fontSize = g.sp, letterSpacing = (-0.04f * g).sp, color = hex(0xE2F754))
                val gemessen = messer.measure(name, stil(groesse), maxLines = 1, softWrap = false, constraints = Constraints()).size.width / androidx.compose.ui.platform.LocalDensity.current.density
                val g = if (gemessen > platzBreite) maxOf(groesse * 0.3f, groesse * platzBreite / gemessen) else groesse
                Text(name, style = stil(g), maxLines = 1, softWrap = false, modifier = Modifier.padding(horizontal = (groesse * 0.3f).dp))
            }
        }
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.TopEnd) {
            Box(
                Modifier.padding(top = 60.dp, end = 16.dp).size(50.dp).border(1.dp, hex(0x747474), CircleShape).tippen { schliessen() },
                contentAlignment = Alignment.Center,
            ) { Text("×", style = TextStyle(fontSize = 30.sp, color = hex(0xE2F754))) }
        }
    }
}

/** ConvoyDriverPopup: Profilbild, Name, Kennzeichen, Fahrzeug, „Name anrufen“. */
@Composable
internal fun FahrtKollegenKarte(fahrer: FahrtDetails.KolonnenFahrer, schliessen: () -> Unit) {
    val oeffnen = LocalUriHandler.current
    val vorname = fahrer.name.split(" ").firstOrNull { it.isNotEmpty() } ?: "Fahrer"
    val telefon = fahrer.telefon.replace(Regex("[\\s()\\-]"), "")
    BackHandler { schliessen() }
    Box(Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.95f)).tippen { schliessen() }, contentAlignment = Alignment.Center) {
        Column(Modifier.padding(horizontal = 20.dp).widthIn(max = 362.dp).tippen { }) {
            Box(
                Modifier.size(54.dp).background(Color.Black.copy(alpha = 0.85f), CircleShape).border(2.dp, hex(0xE3F654), CircleShape).tippen { schliessen() },
                contentAlignment = Alignment.Center,
            ) { Icon("Arrow_Trisar_Icons_01_Lime", Modifier.size(29.dp, 18.dp).rotate(180f)) }
            Spacer(Modifier.height(18.dp))

            Column(
                Modifier.fillMaxWidth().background(Color.Black).border(2.dp, hex(0xE3F654)).padding(vertical = 18.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Box(Modifier.size(138.dp).background(hex(0x1F2023)).clip(RoundedCornerShape(0.dp)), contentAlignment = Alignment.Center) {
                    val url = bildURL(fahrer.bild)
                    if (url != null) {
                        SubcomposeAsyncImage(
                            model = url, contentDescription = null, contentScale = ContentScale.Crop,
                            modifier = Modifier.fillMaxSize(),
                            loading = { PersonBild() }, error = { PersonBild() },
                        )
                    } else PersonBild()
                }
                Text(fahrer.name, style = grotesk(30f, 700, farbe = hex(0xE3F654)), textAlign = TextAlign.Center, modifier = Modifier.padding(top = 18.dp))
                Text(fahrer.kennzeichen.ifEmpty { "-" }, style = grotesk(30f, 700, farbe = hex(0xD6D6D6)), modifier = Modifier.padding(top = 18.dp))
                Text(fahrer.fahrzeug.ifEmpty { "-" }, style = grotesk(20f, farbe = hex(0xD6D6D6)))
            }

            Box(
                Modifier.padding(top = 18.dp).fillMaxWidth().height(48.dp).background(hex(0xE3F654))
                    .tippen { if (telefon.isNotEmpty()) runCatching { oeffnen.openUri("tel:$telefon") } },
                contentAlignment = Alignment.Center,
            ) {
                Text("$vorname anrufen", style = grotesk(16f, 500, farbe = if (telefon.isEmpty()) hex(0x5F6130) else hex(0x1D1C1D)))
                Box(Modifier.fillMaxSize().padding(end = 14.dp), contentAlignment = Alignment.CenterEnd) {
                    Icon("contact-phone", Modifier.size(22.dp))
                }
            }
        }
    }
}

@Composable
private fun PersonBild() {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Icon("Person_Trisar_Icons_01", Modifier.size(82.dp).alpha(0.75f))
    }
}

/** Bilder liegen teils als Pfad der Web-App vor (/fahrzeuge/...). */
internal fun bildURL(wert: String?): String? {
    val roh = wert?.trim().orEmpty()
    if (roh.isEmpty()) return null
    if (roh.startsWith("http")) return roh
    return "https://fahrer.trisar.de" + (if (roh.startsWith("/")) roh else "/$roh")
}

/** Orts-Kachel 64 x 64 mit Icon 30. */
@Composable
internal fun OrtKachel(name: String, modifier: Modifier) {
    Box(modifier.size(64.dp).background(hex(0x242525), RoundedCornerShape(16.dp)), contentAlignment = Alignment.Center) {
        Icon(name, Modifier.size(30.dp))
    }
}

/** Ortsart (grau) und Name (weiss, Lime unterstrichen, fuehrt zu Google Maps). */
@Composable
internal fun OrtText(art: String, name: String, url: String?, rechts: Boolean, modifier: Modifier) {
    val oeffnen = LocalUriHandler.current
    Column(modifier, horizontalAlignment = if (rechts) Alignment.End else Alignment.Start) {
        Text(art, style = grotesk(14f, 700, abstand = -0.5f, farbe = Farbe.grauText))
        // Unterstrich in Lime (underline color E2F754), Compose kann nur in Textfarbe unterstreichen.
        var layout by remember { mutableStateOf<androidx.compose.ui.text.TextLayoutResult?>(null) }
        Text(
            name,
            style = grotesk(18f, 700, zeilenHoehe = 18f * 1.15f, abstand = -0.5f),
            textAlign = if (rechts) TextAlign.End else TextAlign.Start,
            onTextLayout = { layout = it },
            modifier = Modifier
                .drawBehind {
                    val l = layout ?: return@drawBehind
                    if (url == null) return@drawBehind
                    for (i in 0 until l.lineCount) {
                        val y = l.getLineBaseline(i) + 2.dp.toPx()
                        drawLine(hex(0xE2F754), Offset(l.getLineLeft(i), y), Offset(l.getLineRight(i), y), 1.dp.toPx())
                    }
                }
                .tippen { if (url != null) runCatching { oeffnen.openUri(url) } },
        )
    }
}

/** Knopf im Blatt: farbig, Text links (16 medium, neutral-800), dunkler Pfeil rechts. */
@Composable
internal fun AktionsKnopf(text: String, farbe: Color, aktion: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().height(56.dp).background(farbe).tippen(aktion).padding(start = 16.dp, end = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(text, style = grotesk(16f, 500, abstand = 0.5f, farbe = hex(0x262626)))
        Spacer(Modifier.weight(1f))
        Icon("PfeilDunkel", Modifier.size(34.dp, 20.dp))
    }
}

/** Zurueck auf der Karte: schwarzer Kreis 50 mit Backbutton_Karte, Schatten. */
@Composable
internal fun KarteZurueck(modifier: Modifier, aktion: () -> Unit) {
    Box(modifier.size(50.dp).shadow(8.dp, CircleShape).background(Color.Black, CircleShape).clip(CircleShape).tippen(aktion)) {
        Icon("Backbutton_Karte", Modifier.fillMaxSize())
    }
}
