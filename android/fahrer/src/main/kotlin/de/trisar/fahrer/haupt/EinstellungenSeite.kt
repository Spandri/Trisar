package de.trisar.fahrer.haupt

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
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
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import de.trisar.kern.Anmeldung
import de.trisar.kern.Farbe
import de.trisar.kern.FahrzeugBild
import de.trisar.kern.FussleisteUnten
import de.trisar.kern.Icon
import de.trisar.kern.ZurueckKnopf
import de.trisar.kern.grotesk
import de.trisar.kern.hex
import de.trisar.kern.platz
import de.trisar.kern.tippen
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

private enum class Feld { VORNAME, NACHNAME, EMAIL, VORWAHL, TELEFON, STRASSE, HAUSNUMMER, ORT, PLZ }
private val SPRACHEN = listOf("Deutsch", "English", "Français", "Italiano", "Español", "Türkçe")

/**
 * Nachbau von SettingsFahrer.jsx wie EinstellungenAnsicht.swift (Raster 402 x 873). Jedes Feld speichert
 * beim Verlassen, Sprache sofort, Profilbild beim Auswaehlen. Abmelden nur auf diesem Geraet.
 */
@Composable
internal fun EinstellungenSeite(anmeldung: Anmeldung, fahrerID: String, zurueck: () -> Unit) {
    var mitteilungenOffen by remember { mutableStateOf(false) }
    val ctx = LocalContext.current
    val bereich = rememberCoroutineScope()
    val fokus = LocalFocusManager.current
    val dienst = remember { ProfilDienst() }
    val dienstFehler by dienst.fehler.collectAsState()

    val werte = remember { mutableStateOf(Feld.entries.associateWith { "" }) }
    fun wert(f: Feld) = werte.value[f].orEmpty()
    fun setze(f: Feld, w: String) { werte.value = werte.value + (f to w) }
    var sprache by remember { mutableStateOf("Deutsch") }
    var bildURL by remember { mutableStateOf("") }
    var spracheOffen by remember { mutableStateOf(false) }
    var bildMenueOffen by remember { mutableStateOf(false) }
    var bildVorschau by remember { mutableStateOf(false) }
    var bildFehler by remember { mutableStateOf<String?>(null) }

    suspend fun speichernSpalte(spalte: String, w: String) {
        dienst.speichern(spalte, w, fahrerID)
        if (spalte == "first_name" || spalte == "last_name") anmeldung.profilLaden()
    }

    fun speichern(f: Feld) = bereich.launch {
        when (f) {
            Feld.VORNAME -> speichernSpalte("first_name", wert(f))
            Feld.NACHNAME -> speichernSpalte("last_name", wert(f))
            Feld.EMAIL -> dienst.emailSpeichern(wert(f))
            Feld.VORWAHL, Feld.TELEFON ->
                speichernSpalte("phone", "${wert(Feld.VORWAHL).ifEmpty { "+49" }.trim()} ${wert(Feld.TELEFON).trim()}")
            Feld.STRASSE -> speichernSpalte("street", wert(f))
            Feld.HAUSNUMMER -> speichernSpalte("street_number", wert(f))
            Feld.ORT -> speichernSpalte("city", wert(f))
            Feld.PLZ -> speichernSpalte("zip", wert(f))
        }
    }

    LaunchedEffect(fahrerID) {
        dienst.laden(fahrerID)
        val d = dienst.daten.value
        // normalizePhone: "+49 170 ..." -> Vorwahl und Rest
        val tel = d.phone.orEmpty().trim()
        val vorwahl = Regex("^\\+\\d{1,4}").find(tel)
        werte.value = mapOf(
            Feld.VORNAME to d.first_name.orEmpty(), Feld.NACHNAME to d.last_name.orEmpty(), Feld.EMAIL to dienst.email.value,
            Feld.VORWAHL to (vorwahl?.value ?: "+49"), Feld.TELEFON to (if (vorwahl != null) tel.substring(vorwahl.range.last + 1).trim() else tel),
            Feld.STRASSE to d.street.orEmpty(), Feld.HAUSNUMMER to d.street_number.orEmpty(), Feld.ORT to d.city.orEmpty(), Feld.PLZ to d.zip.orEmpty(),
        )
        sprache = d.language?.ifEmpty { null } ?: "Deutsch"
        bildURL = d.avatar_url.orEmpty()
    }

    val bildWahl = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        if (uri == null) return@rememberLauncherForActivityResult
        bereich.launch {
            val bild = ProfilDienst.bildLaden(ctx, uri)
            if (bild == null) { bildFehler = "Bitte eine Bilddatei auswählen."; return@launch }
            val url = ProfilDienst.profilbildDataURL(bild)
            bildURL = url
            speichernSpalte("avatar_url", url)
        }
    }

    val initialen = (wert(Feld.VORNAME).trim().take(1) + wert(Feld.NACHNAME).trim().take(1)).uppercase()
        .filter { it.isLetterOrDigit() }.ifEmpty { "P" }.take(2)

    @Composable
    fun Profilbild(modifier: Modifier) {
        val daten = remember(bildURL) { ProfilDienst.bildAusDataURL(bildURL) }
        Box(modifier, contentAlignment = Alignment.Center) {
            when {
                daten != null -> Image(daten.asImageBitmap(), null, Modifier.fillMaxSize(), contentScale = ContentScale.Crop)
                bildURL.isNotEmpty() -> FahrzeugBild(bildURL, Modifier.fillMaxSize(), platzhalter = Color.Transparent, skalierung = ContentScale.Crop)
                else -> Text(initialen, style = grotesk(16f, 700, abstand = 0.5f, farbe = hex(0xE3F654)))
            }
        }
    }

    Box(Modifier.fillMaxSize().tippen { fokus.clearFocus() }) {
        Leinwand(basisHoehe = 873f) {
            ZurueckKnopf(Modifier.platz(20f, 60f), zurueck)
            Text("Einstellungen", style = grotesk(42f, 700, zeilenHoehe = 42f, abstand = -0.5f, farbe = hex(0xE2F754)), maxLines = 1,
                modifier = Modifier.platz(20f, 140f))

            @Composable
            fun Eingabe(f: Feld, platzhalter: String, x: Float, y: Float, w: Float, links: Float = 16f, rechts: Float = 56f,
                        icon: String? = null, iconB: Float = 0f, iconH: Float = 0f, bearbeiten: Boolean = true) {
                val anfrage = remember { FocusRequester() }
                var hatteFokus by remember { mutableStateOf(false) }
                Box(Modifier.platz(x, y, w, 56f).border(2.dp, hex(0xE3F654)), contentAlignment = Alignment.CenterStart) {
                    if (icon != null) Icon(icon, Modifier.padding(start = 12.dp).size(iconB.dp, iconH.dp))
                    BasicTextField(
                        wert(f), { setze(f, it) }, singleLine = true,
                        textStyle = grotesk(16f, 500, abstand = 0.5f, farbe = hex(0x8A9728)),
                        cursorBrush = SolidColor(Farbe.lime),
                        keyboardOptions = KeyboardOptions(
                            capitalization = if (f == Feld.EMAIL) KeyboardCapitalization.None else KeyboardCapitalization.Words,
                            autoCorrectEnabled = false,
                            keyboardType = when (f) {
                                Feld.EMAIL -> KeyboardType.Email
                                Feld.TELEFON, Feld.VORWAHL, Feld.PLZ -> KeyboardType.Phone
                                else -> KeyboardType.Text
                            },
                        ),
                        modifier = Modifier.padding(start = links.dp, end = rechts.dp).fillMaxWidth().focusRequester(anfrage)
                            .onFocusChanged {
                                if (hatteFokus && !it.isFocused) speichern(f)
                                hatteFokus = it.isFocused
                            },
                        decorationBox = { inner ->
                            Box {
                                if (wert(f).isEmpty()) Text(platzhalter, style = grotesk(16f, 500, abstand = 0.5f, farbe = hex(0x8A9728).copy(alpha = 0.9f)), maxLines = 1)
                                inner()
                            }
                        },
                    )
                    if (bearbeiten) {
                        Box(Modifier.fillMaxWidth().padding(end = 2.dp), contentAlignment = Alignment.CenterEnd) {
                            Box(Modifier.size(30.dp, 40.dp).tippen { anfrage.requestFocus() }, contentAlignment = Alignment.Center) {
                                Icon("Arrow-kurz_Trisar_Icons_01_Lime", Modifier.size(10.dp, 13.dp))
                            }
                        }
                    }
                }
            }

            Eingabe(Feld.VORNAME, "Vorname", 20f, 190f, 178f)
            Eingabe(Feld.NACHNAME, "Nachname", 204f, 190f, 178f)
            Eingabe(Feld.EMAIL, "E-Mail", 21f, 254f, 360f, links = 40f, rechts = 40f, icon = "Mail_Trisar_Icons_01_Lime", iconB = 12f, iconH = 15.6f)
            Eingabe(Feld.VORWAHL, "+49", 20f, 322f, 85f, rechts = 8f, bearbeiten = false)
            Eingabe(Feld.TELEFON, "Telefon", 111f, 322f, 270f, links = 40f, rechts = 40f, icon = "contact-phone", iconB = 12f, iconH = 12f)
            Eingabe(Feld.STRASSE, "Straße", 20f, 390f, 270f, rechts = 48f)
            Eingabe(Feld.HAUSNUMMER, "Nr.", 296f, 390f, 85f, rechts = 40f)
            Eingabe(Feld.ORT, "Ort", 20f, 458f, 361f, rechts = 48f)
            Eingabe(Feld.PLZ, "PLZ", 20f, 526f, 178f, rechts = 48f)

            Box(Modifier.platz(20f, 607f, 362f, 56f).border(1.dp, hex(0xE3F654)).tippen { mitteilungenOffen = true },
                contentAlignment = Alignment.Center) {
                Text("Mitteilungen", style = grotesk(16f, 500, abstand = 0.5f, farbe = hex(0xE3F654)))
            }

            Box(Modifier.platz(20f, 675f, 362f, 56f).border(1.dp, hex(0x7F8A2B)).tippen { fokus.clearFocus(); anmeldung.abmelden() },
                contentAlignment = Alignment.Center) {
                Text("Abmelden", style = grotesk(16f, 500, abstand = 0.5f, farbe = hex(0x7F8A2B)))
            }

            // Im Web nur Beschriftung ohne Funktion.
            Box(Modifier.platz(20f, 750f, 362f, 24f), contentAlignment = Alignment.Center) {
                Text("Account löschen", style = grotesk(12f, 500, abstand = 0.5f, farbe = hex(0xE3F654).copy(alpha = 0.35f)))
            }

            // Sprache
            Column(Modifier.platz(204f, 526f, 177f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Row(Modifier.size(177.dp, 56.dp).border(2.dp, hex(0xE3F654)).tippen { spracheOffen = !spracheOffen }.padding(start = 16.dp, end = 12.dp),
                    verticalAlignment = Alignment.CenterVertically) {
                    Text(sprache, style = grotesk(16f, 500, abstand = 0.5f, farbe = hex(0x8A9728)))
                    Spacer(Modifier.weight(1f))
                    Icon("Arrow-kurz_Trisar_Icons_01_Lime", Modifier.size(10.dp, 13.dp).rotate(90f))
                }
                if (spracheOffen) {
                    Column(Modifier.width(177.dp).background(Color.Black).border(2.dp, hex(0xE3F654))) {
                        for (s in SPRACHEN) {
                            Text(s, style = grotesk(16f, farbe = hex(0x8A9728)),
                                modifier = Modifier.fillMaxWidth().tippen {
                                    sprache = s; spracheOffen = false
                                    bereich.launch { speichernSpalte("language", s) }
                                }.padding(horizontal = 16.dp, vertical = 8.dp))
                        }
                    }
                }
            }

            // Profilbild oben rechts mit Menue
            Column(Modifier.platz(402f - 20f - 228f, 60f, 228f), horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Profilbild(Modifier.size(50.dp).clip(CircleShape).background(Color.Black).border(1.dp, hex(0x8B8B8D), CircleShape)
                    .tippen { bildMenueOffen = !bildMenueOffen })
                if (bildMenueOffen) {
                    Column(Modifier.width(228.dp).background(Color.Black).border(2.dp, hex(0xE3F654))) {
                        MenuePunkt("Profilbild anzeigen", hex(0xE3F654), true) {
                            bildMenueOffen = false
                            if (bildURL.isEmpty()) bildFehler = "Kein Profilbild vorhanden." else bildVorschau = true
                        }
                        MenuePunkt("Neues Profilbild hochladen", hex(0xE3F654), true) {
                            bildMenueOffen = false
                            bildWahl.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))
                        }
                        MenuePunkt("Profilbild entfernen", hex(0xF55757), false) {
                            bildMenueOffen = false
                            bildURL = ""
                            bereich.launch { speichernSpalte("avatar_url", "") }
                        }
                    }
                }
            }
        }
        FussleisteUnten()
        if (mitteilungenOffen) de.trisar.kern.MitteilungenSeite(fahrerID, de.trisar.kern.PushArten.fahrer) { mitteilungenOffen = false }

        val f = bildFehler ?: dienstFehler
        if (f != null) {
            LaunchedEffect(f) { delay(3200); bildFehler = null; dienst.fehler.value = null }
            Box(Modifier.fillMaxSize().padding(bottom = 64.dp), contentAlignment = Alignment.BottomCenter) {
                Text(f, style = grotesk(12f, 500, farbe = hex(0xFF8E8E)),
                    modifier = Modifier.background(hex(0x220F0F)).border(1.dp, hex(0xF55757)).padding(horizontal = 16.dp, vertical = 8.dp))
            }
        }

        if (bildVorschau) {
            Box(Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.85f)).tippen { }, contentAlignment = Alignment.Center) {
                Column(Modifier.width(360.dp).background(Color.Black).border(2.dp, hex(0xE3F654)).padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(16.dp)) {
                    Text("Profilbild", style = grotesk(18f, 700, farbe = hex(0xE3F654)))
                    Profilbild(Modifier.size(324.dp).background(hex(0x101108)).clipToBounds().border(1.dp, hex(0x5D6620)))
                    Box(Modifier.fillMaxWidth().height(48.dp).background(hex(0xE3F654)).tippen { bildVorschau = false }, contentAlignment = Alignment.Center) {
                        Text("Schließen", style = grotesk(16f, 500, farbe = hex(0x0E1008)))
                    }
                }
            }
        }
    }
}

@Composable
private fun MenuePunkt(text: String, farbe: Color, linie: Boolean, aktion: () -> Unit) {
    Box(Modifier.fillMaxWidth().heightIn(min = 48.dp).tippen(aktion), contentAlignment = Alignment.CenterStart) {
        Text(text, style = grotesk(14f, 500, farbe = farbe), modifier = Modifier.padding(horizontal = 16.dp), textAlign = TextAlign.Start)
        if (linie) Box(Modifier.align(Alignment.BottomCenter).fillMaxWidth().height(1.dp).background(hex(0x5D6620)))
    }
}
