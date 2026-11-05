package de.trisar.dispo.stamm

import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
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
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
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
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModelProvider
import de.trisar.dispo.DispoZiel
import de.trisar.kern.Anmeldung
import de.trisar.kern.Backend
import de.trisar.kern.DispoHintergrund
import de.trisar.kern.FussleisteUnten
import de.trisar.kern.Icon
import de.trisar.kern.ZurueckKnopf
import de.trisar.kern.grotesk
import de.trisar.kern.hex
import de.trisar.kern.platz
import de.trisar.kern.tippen
import io.github.jan.supabase.auth.SignOutScope
import io.github.jan.supabase.auth.auth
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

private enum class ProfilUnterseite { PROFIL, ANSPRECHPARTNER, VERLAUF, EINSTELLUNGEN }

/** Anmeldung der Aktivitaet (dieselbe Instanz wie im Einstieg), fuer Profil neu laden und Abmelden. */
@Composable
private fun aktivitaetsAnmeldung(): Anmeldung? {
    val ctx = LocalContext.current
    return remember(ctx) {
        var c: android.content.Context? = ctx
        while (c is android.content.ContextWrapper && c !is ComponentActivity) c = c.baseContext
        (c as? ComponentActivity)?.let { runCatching { ViewModelProvider(it)[Anmeldung::class.java] }.getOrNull() }
    }
}

/**
 * Profil der Disposition (KoordinatorProfilAnsicht.swift): Profil (ProfilKoordinatorView.jsx),
 * Ansprechpartner (AnsprechpartnerView.jsx, Live-Zweig), Verlauf (VerlaufView.jsx) und
 * Einstellungen (SettingsViewKo.jsx).
 */
@Composable
internal fun KoordinatorProfilSeite(zeigen: (DispoZiel) -> Unit) {
    val ctx = LocalContext.current
    val dienst = remember { KoordinatorProfilDienst(ctx) }
    var seite by remember { mutableStateOf(ProfilUnterseite.PROFIL) }
    LaunchedEffect(Unit) { dienst.laden() }
    androidx.compose.runtime.key(seite) {
        when (seite) {
            ProfilUnterseite.PROFIL -> ProfilStart(dienst.profil.name, zurueck = { zeigen(DispoZiel.START) },
                ansprechpartner = { seite = ProfilUnterseite.ANSPRECHPARTNER },
                verlauf = { seite = ProfilUnterseite.VERLAUF },
                einstellungen = { seite = ProfilUnterseite.EINSTELLUNGEN })
            ProfilUnterseite.ANSPRECHPARTNER -> AnsprechpartnerSeite { seite = ProfilUnterseite.PROFIL }
            ProfilUnterseite.VERLAUF -> VerlaufSeite { seite = ProfilUnterseite.PROFIL }
            ProfilUnterseite.EINSTELLUNGEN -> EinstellungenSeite(dienst) { seite = ProfilUnterseite.PROFIL }
        }
    }
}

// MARK: - Profil

@Composable
private fun ProfilStart(name: String, zurueck: () -> Unit, ansprechpartner: () -> Unit, verlauf: () -> Unit, einstellungen: () -> Unit) {
    @Composable
    fun kachel(x: Float, y: Float, wert: String, einheit: String, bx: Float, by: Float) {
        Box(Modifier.platz(x, y, 178f, 115f).border(2.dp, LIME))
        Row(Modifier.platz(x + 20f, y + 71f), verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            TextZeile(wert, grotesk(36f, 500, 36f, 0.5f, LIME), hoehe = 36f)
            TextZeile(einheit, grotesk(16f, 500, 16f, 0.5f, LIME.copy(alpha = 0.5f)), Modifier.padding(bottom = 2.dp), hoehe = 16f)
        }
        Icon("Blitz_Trisar_Icons_01_Lime", Modifier.platz(bx, by, 16f, 20f).alpha(0.5f))
    }

    Box(Modifier.fillMaxSize().background(Color.Black)) {
        Leinwand(875f) { rahmen ->
            DispoHintergrund(Modifier.platz(0f, 0f, 402f, rahmen))
            ZurueckKnopf(Modifier.platz(20f, 60f), zurueck)

            // Der Name haengt mit der Unterkante ueber dem Datum und waechst bei Umbruch nach oben.
            Box(Modifier.platz(20f, 0f, 362f, 292f), contentAlignment = Alignment.BottomStart) {
                Text(name, style = grotesk(48f, 700, 48f, -0.5f, hex(0xE2F754)))
            }
            // Im Web fest eingetragen, auch live.
            TextZeile("Seit 20.01.25", grotesk(16f, 500, abstand = 0.5f, farbe = LIME.copy(alpha = 0.5f)), Modifier.platz(21f, 293f), hoehe = 24f)

            // Kennzahl-Kacheln: im Web feste Werte, auch im Live-Zweig.
            kachel(20f, 329f, "5234", "km", 169f, 341f)
            kachel(204f, 329f, "634", "Liter", 353f, 341f)
            kachel(20f, 450f, "56", "Fahrten", 168f, 460.71f)
            kachel(204f, 450f, "51", "Stunden", 353f, 462f)

            Row(Modifier.platz(21f, 589f, 360f, 56f).background(LIME).tippen(ansprechpartner).padding(start = 16.dp, end = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                Text("Ansprechpartner", style = grotesk(16f, 500, abstand = 0.5f, farbe = hex(0x262626)))
                Spacer(Modifier.weight(1f))
                Icon("Arrow_Trisar_Icons_01", Modifier.size(34.dp, 19.92.dp))
            }
            Row(Modifier.platz(21f, 657f, 360f, 56f).background(LIME).tippen(verlauf).padding(start = 16.dp, end = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                Text("Verlauf", style = grotesk(16f, 500, abstand = 0.5f, farbe = hex(0x262626)))
                Spacer(Modifier.weight(1f))
                Icon("Arrow_Trisar_Icons_01", Modifier.size(34.dp, 19.92.dp))
            }

            Box(Modifier.platz(21f, 737f, 360f, 56f).alpha(0.5f).border(2.dp, LIME).tippen(einstellungen), contentAlignment = Alignment.Center) {
                Text("Einstellungen", style = grotesk(16f, 500, abstand = 0.5f, farbe = LIME))
            }
        }
        FussleisteUnten()
    }
}

// MARK: - Ansprechpartner

/** Live-Zweig: nur die Karte „TRISAR Team“ mit E-Mail, keine Beispielpersonen und keine Hotline. */
@Composable
private fun AnsprechpartnerSeite(zurueck: () -> Unit) {
    val ctx = LocalContext.current
    val name = "TRISAR Team"
    val email = "team@trisar.de"
    Box(Modifier.fillMaxSize().background(Color.Black)) {
        Leinwand(874f, 838f) { rahmen ->
            DispoHintergrund(Modifier.platz(0f, 0f, 402f, rahmen))
            Box(Modifier.platz(0f, 206f, 402f, maxOf(838f, rahmen) - 206f).background(hex(0x1A1A1A), RoundedCornerShape(topStart = 12.dp, topEnd = 12.dp)))
            ZurueckKnopf(Modifier.platz(20f, 60f), zurueck)
            StammTitel("Support", Modifier.platz(20f, 140f), abstand = -0.5f, farbe = 0xE2F754)

            // ContactCard: Foto-Feld mit Initialen, Name, E-Mail, Knopf „Get in touch“ (ohne Telefon per Mail).
            Box(Modifier.platz(20f, 230f, 362f, 543f).background(Color.White)) {
                Box(Modifier.platz(12f, 12f, 338f, 244f).background(hex(0xD9D9D9)), contentAlignment = Alignment.Center) {
                    Text(name.split(" ").mapNotNull { it.firstOrNull()?.toString() }.joinToString(""), style = grotesk(48f, 700, farbe = hex(0x6B7280)))
                }
                TextZeile(name, grotesk(30f, 700, abstand = 0.5f, farbe = Color.Black), Modifier.platz(11f, 279f), hoehe = 30f)
                TextZeile(email, grotesk(18f, 700, abstand = 0.5f, farbe = Color.Black), Modifier.platz(12f, 408f), hoehe = 24f)
                Box(Modifier.platz(12f, 457f, 338f, 56f).background(LIME).tippen { mailOeffnen(ctx, email) }, contentAlignment = Alignment.Center) {
                    Text("Get in touch", style = grotesk(24f, 700, abstand = -0.5f, farbe = Color.Black))
                }
            }
        }
        FussleisteUnten()
    }
}

// MARK: - Verlauf

/**
 * VerlaufView.jsx, Live-Zweig (VerlaufAnsicht.swift): Schichtverlauf gibt es im Betrieb noch nicht,
 * die Seite ist nur bildschirmhoch (812) und zeigt „Noch keine Einträge.“.
 */
@Composable
private fun VerlaufSeite(zurueck: () -> Unit) {
    Box(Modifier.fillMaxSize().background(Color.Black)) {
        Leinwand(812f) { rahmen ->
            DispoHintergrund(Modifier.platz(0f, 0f, 402f, rahmen))
            ZurueckKnopf(Modifier.platz(20f, 60f), zurueck)
            // bg-zinc-900, oben rund (rounded-t-xl)
            Box(Modifier.platz(0f, 206f, 402f, rahmen - 206f).background(hex(0x18181B), RoundedCornerShape(topStart = 12.dp, topEnd = 12.dp)))
            StammTitel("Verlauf", Modifier.platz(20f, 140f), abstand = -0.5f)
            Text("Noch keine Einträge.", style = grotesk(18f, 700, 24f, 0.5f, Color.White.copy(alpha = 0.6f)), modifier = Modifier.platz(20f, 230f, 362f))
        }
        FussleisteUnten()
    }
}

// MARK: - Einstellungen

private val PROFIL_SPRACHEN = listOf("Deutsch", "English", "Français", "Italiano", "Español", "Türkçe")

@Composable
private fun EinstellungenSeite(dienst: KoordinatorProfilDienst, zurueck: () -> Unit) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    val anmeldung = aktivitaetsAnmeldung()
    val fokusManager = LocalFocusManager.current

    var vorname by remember { mutableStateOf("") }
    var nachname by remember { mutableStateOf("") }
    var email by remember { mutableStateOf("") }
    var vorwahl by remember { mutableStateOf("+49") }
    var telefon by remember { mutableStateOf("") }
    var strasse by remember { mutableStateOf("") }
    var hausnummer by remember { mutableStateOf("") }
    var ort by remember { mutableStateOf("") }
    var plz by remember { mutableStateOf("") }
    var sprache by remember { mutableStateOf("Deutsch") }
    var bildURL by remember { mutableStateOf("") }
    var spracheOffen by remember { mutableStateOf(false) }
    var bildMenueOffen by remember { mutableStateOf(false) }
    var bildVorschau by remember { mutableStateOf(false) }
    var bildFehler by remember { mutableStateOf("") }
    var fokusFeld by remember { mutableStateOf<ProfilFeld?>(null) }

    /** Werte aus profileData in die Felder (Telefon getrennt in Vorwahl und Nummer). */
    fun uebernehmen(p: KoordinatorProfilDaten) {
        vorname = p.firstName; nachname = p.lastName; email = p.email
        val tel = p.phone.trim()
        val m = Regex("^\\+\\d{1,4}").find(tel)
        when {
            tel.isEmpty() -> { vorwahl = "+49"; telefon = "" }
            m != null -> { vorwahl = m.value; telefon = tel.substring(m.range.last + 1).trim() }
            else -> { vorwahl = "+49"; telefon = tel }
        }
        strasse = p.street; hausnummer = p.streetNumber; ort = p.city; plz = p.zip
        sprache = p.language.ifEmpty { "Deutsch" }
        bildURL = p.avatarUrl
    }
    LaunchedEffect(dienst.profil) { if (fokusFeld == null) uebernehmen(dienst.profil) }
    LaunchedEffect(bildFehler) {
        if (bildFehler.isNotEmpty()) { delay(3200); bildFehler = "" }
    }

    /** Jedes Feld speichert beim Verlassen (onBlur im Web). */
    fun speichern(feld: ProfilFeld) {
        scope.launch {
            when (feld) {
                ProfilFeld.FIRST_NAME -> { dienst.speichern(mapOf(feld to vorname.trim())); anmeldung?.profilLaden() }
                ProfilFeld.LAST_NAME -> { dienst.speichern(mapOf(feld to nachname.trim())); anmeldung?.profilLaden() }
                ProfilFeld.EMAIL -> dienst.speichern(mapOf(feld to email.trim()))
                ProfilFeld.PHONE -> dienst.speichern(mapOf(feld to "${vorwahl.ifEmpty { "+49" }.trim()} ${telefon.trim()}".trim()))
                ProfilFeld.STREET -> dienst.speichern(mapOf(feld to strasse.trim()))
                ProfilFeld.STREET_NUMBER -> dienst.speichern(mapOf(feld to hausnummer.trim()))
                ProfilFeld.CITY -> dienst.speichern(mapOf(feld to ort.trim()))
                ProfilFeld.ZIP -> dienst.speichern(mapOf(feld to plz.trim()))
                else -> {}
            }
        }
    }
    fun fokus(feld: ProfilFeld): (Boolean) -> Unit = { an ->
        if (an) fokusFeld = feld
        else if (fokusFeld == feld) { fokusFeld = null; speichern(feld) }
    }

    // prepareAvatarDataUrl: laengste Seite 720, PNG bleibt PNG, sonst JPEG 0.84 (zu gross: 0.76).
    val bildWahl = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        if (uri == null) return@rememberLauncherForActivityResult
        var url = bildAlsDataURL(ctx, uri, 720, qualitaet = 84)
        if (url != null && url.length > 2_200_000) url = bildAlsDataURL(ctx, uri, 720, png = false, qualitaet = 76)
        if (url == null) { bildFehler = "Profilbild konnte nicht geladen werden."; return@rememberLauncherForActivityResult }
        bildURL = url
        bildMenueOffen = false
        bildFehler = ""
        scope.launch { dienst.speichern(mapOf(ProfilFeld.AVATAR_URL to url)) }
    }

    val initialen = run {
        val i = "${vorname.trim().take(1)}${nachname.trim().take(1)}".uppercase().filter { it in 'A'..'Z' || it.isDigit() }
        i.ifEmpty { "P" }.take(2)
    }

    @Composable
    fun profilbild(modifier: Modifier) {
        if (ausDataURL(bildURL) != null || bildURL(bildURL) != null) {
            StammBild(bildURL, modifier, ContentScale.Crop)
        } else {
            Box(modifier, contentAlignment = Alignment.Center) { Text(initialen, style = grotesk(18f, 700, abstand = 0.45f, farbe = LIME)) }
        }
    }

    @Composable
    fun menuePunkt(text: String, farbe: Long, linie: Boolean, aktion: () -> Unit) {
        Box(Modifier.fillMaxWidth().heightIn(min = 48.dp).tippen(aktion), contentAlignment = Alignment.CenterStart) {
            Text(text, style = grotesk(14f, 500, farbe = hex(farbe)), modifier = Modifier.padding(horizontal = 16.dp))
            if (linie) Box(Modifier.align(Alignment.BottomCenter).fillMaxWidth().height(1.dp).background(hex(0x5D6620)))
        }
    }

    Box(Modifier.fillMaxSize().background(Color.Black)) {
        Leinwand(873f) { rahmen ->
            DispoHintergrund(Modifier.platz(0f, 0f, 402f, rahmen))
            ZurueckKnopf(Modifier.platz(20f, 60f), zurueck)
            StammTitel("Einstellungen", Modifier.platz(20f, 140f), abstand = -0.5f, farbe = 0xE2F754)

            BoxFeld("Vorname", vorname, { vorname = it }, Modifier.platz(20f, 206f, 178f, 56f), rechts = 56f,
                gross = KeyboardCapitalization.Words, fokusGeaendert = fokus(ProfilFeld.FIRST_NAME))
            BoxFeld("Nachname", nachname, { nachname = it }, Modifier.platz(204f, 206f, 178f, 56f), rechts = 56f,
                gross = KeyboardCapitalization.Words, fokusGeaendert = fokus(ProfilFeld.LAST_NAME))
            Box(Modifier.platz(20f, 274f, 362f, 56f)) {
                BoxFeld("E-Mail", email, { email = it }, Modifier.fillMaxSize(), links = 40f, rechts = 40f,
                    tastatur = KeyboardType.Email, gross = KeyboardCapitalization.None, fokusGeaendert = fokus(ProfilFeld.EMAIL))
                Icon("Mail_Trisar_Icons_01_Lime", Modifier.align(Alignment.CenterStart).padding(start = 12.dp).size(10.dp, 13.dp).scale(1.2f))
            }
            BoxFeld("+49", vorwahl, { vorwahl = it }, Modifier.platz(20f, 342f, 85f, 56f), rechts = 8f, pfeil = false,
                tastatur = KeyboardType.Phone, fokusGeaendert = fokus(ProfilFeld.PHONE))
            Box(Modifier.platz(111f, 342f, 271f, 56f)) {
                BoxFeld("Telefon", telefon, { telefon = it }, Modifier.fillMaxSize(), links = 40f, rechts = 40f,
                    tastatur = KeyboardType.Phone, fokusGeaendert = fokus(ProfilFeld.PHONE))
                Icon("contact-phone", Modifier.align(Alignment.CenterStart).padding(start = 12.dp).size(12.dp))
            }
            BoxFeld("Straße", strasse, { strasse = it }, Modifier.platz(20f, 410f, 271f, 56f), gross = KeyboardCapitalization.Words,
                fokusGeaendert = fokus(ProfilFeld.STREET))
            BoxFeld("Nr.", hausnummer, { hausnummer = it }, Modifier.platz(297f, 410f, 85f, 56f), rechts = 40f,
                fokusGeaendert = fokus(ProfilFeld.STREET_NUMBER))
            BoxFeld("Ort", ort, { ort = it }, Modifier.platz(20f, 478f, 362f, 56f), gross = KeyboardCapitalization.Words,
                fokusGeaendert = fokus(ProfilFeld.CITY))
            BoxFeld("PLZ", plz, { plz = it }, Modifier.platz(20f, 546f, 178f, 56f), tastatur = KeyboardType.Number,
                fokusGeaendert = fokus(ProfilFeld.ZIP))

            Box(Modifier.platz(204f, 546f, 178f, 56f).border(2.dp, LIME).tippen { spracheOffen = !spracheOffen }, contentAlignment = Alignment.CenterStart) {
                Text(sprache.ifEmpty { "Sprache" }, style = grotesk(16f, 500, abstand = 0.5f, farbe = hex(0x8A9728)), maxLines = 1,
                    modifier = Modifier.padding(start = 16.dp, end = 36.dp))
                Icon("Arrow-kurz_Trisar_Icons_01_Lime", Modifier.align(Alignment.CenterEnd).padding(end = 12.dp).size(10.dp, 13.dp).rotate(90f))
            }

            Box(Modifier.platz(20f, 626f, 362f, 56f).border(1.dp, hex(0x7F8A2B)).tippen {
                fokusManager.clearFocus()
                scope.launch {
                    // Nur dieses Geraet abmelden, wie Anmeldung.abmelden().
                    if (anmeldung != null) anmeldung.abmelden() else runCatching { Backend.client.auth.signOut(SignOutScope.LOCAL) }
                    dienst.vergessen()
                }
            }, contentAlignment = Alignment.Center) {
                Text("Abmelden", style = grotesk(16f, 500, abstand = 0.5f, farbe = hex(0x7F8A2B)))
            }

            // Im Web nur Beschriftung ohne Funktion.
            Box(Modifier.platz(20f, 694f, 362f, 24f).alpha(0.35f), contentAlignment = Alignment.Center) {
                Text("Account löschen", style = grotesk(12f, 500, abstand = 0.5f, farbe = LIME))
            }

            if (spracheOffen) {
                Box(Modifier.platz(204f, 604f, 178f, 192f).background(Color.Black).border(2.dp, LIME)) {
                    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
                        for (s in PROFIL_SPRACHEN) {
                            Box(Modifier.fillMaxWidth().tippen {
                                sprache = s
                                spracheOffen = false
                                scope.launch { dienst.speichern(mapOf(ProfilFeld.LANGUAGE to s)) }
                            }.padding(horizontal = 16.dp, vertical = 8.dp)) {
                                Text(s, style = grotesk(16f, farbe = hex(0x8A9728)))
                            }
                        }
                    }
                }
            }

            Column(Modifier.platz(402f - 20f - 228f, 60f, 228f), horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Box(Modifier.size(56.dp).clip(CircleShape).background(Color.Black).border(2.dp, LIME, CircleShape).tippen { bildMenueOffen = !bildMenueOffen }) {
                    profilbild(Modifier.fillMaxSize())
                }
                if (bildMenueOffen) {
                    Column(Modifier.width(228.dp).background(Color.Black).border(2.dp, LIME)) {
                        menuePunkt("Profilbild anzeigen", 0xE3F654, true) {
                            bildMenueOffen = false
                            if (bildURL.isEmpty()) bildFehler = "Kein Profilbild vorhanden." else bildVorschau = true
                        }
                        menuePunkt("Neues Profilbild hochladen", 0xE3F654, true) {
                            bildMenueOffen = false
                            bildWahl.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))
                        }
                        menuePunkt("Profilbild entfernen", 0xF55757, false) {
                            bildURL = ""
                            bildVorschau = false
                            bildMenueOffen = false
                            bildFehler = ""
                            scope.launch { dienst.speichern(mapOf(ProfilFeld.AVATAR_URL to "")) }
                        }
                    }
                }
            }
        }
        FussleisteUnten()

        if (bildVorschau) {
            Box(Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.85f)).tippen { }, contentAlignment = Alignment.Center) {
                Column(Modifier.width(360.dp).background(Color.Black).border(2.dp, LIME).padding(16.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                    Text("Profilbild", style = grotesk(18f, 700, farbe = LIME))
                    Box(Modifier.size(324.dp).background(hex(0x101108)).border(1.dp, hex(0x5D6620)), contentAlignment = Alignment.Center) {
                        if (bildURL.isEmpty()) Text("Kein Bild", style = grotesk(14f, farbe = hex(0x798321)))
                        else profilbild(Modifier.fillMaxSize())
                    }
                    Box(Modifier.fillMaxWidth().height(48.dp).background(LIME).tippen { bildVorschau = false }, contentAlignment = Alignment.Center) {
                        Text("Schließen", style = grotesk(16f, 500, farbe = hex(0x0E1008)))
                    }
                }
            }
        }

        if (bildFehler.isNotEmpty()) {
            Box(Modifier.fillMaxSize().navigationBarsPadding().padding(bottom = 64.dp), contentAlignment = Alignment.BottomCenter) {
                Box(Modifier.background(hex(0x220F0F)).border(1.dp, hex(0xF55757)).padding(horizontal = 16.dp, vertical = 8.dp)) {
                    Text(bildFehler, style = grotesk(12f, 500, farbe = hex(0xFF8E8E)), textAlign = TextAlign.Center)
                }
            }
        }
    }
}
