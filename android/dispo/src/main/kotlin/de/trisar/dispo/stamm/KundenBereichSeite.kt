package de.trisar.dispo.stamm

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import de.trisar.dispo.DispoZiel
import de.trisar.dispo.Navileiste
import de.trisar.kern.DispoHintergrund
import de.trisar.kern.FussleisteUnten
import de.trisar.kern.Icon
import de.trisar.kern.ZurueckKnopf
import de.trisar.kern.grotesk
import de.trisar.kern.hex
import de.trisar.kern.platz
import de.trisar.kern.tippen
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlin.math.max

private sealed interface KundenSeite {
    data object Liste : KundenSeite
    data object Erstellen : KundenSeite
    data class Bearbeiten(val gast: StammFahrgast) : KundenSeite
}

/**
 * Kunden-Bereich der Dispo (KundenBereichAnsicht.swift): Fahrgastliste (AlleKunden.jsx) und
 * Anlegen/Bearbeiten (FahrgastErstellenView.jsx). Der Import (ImportView, mode guests) kommt ueber
 * `importieren` von aussen, die Importseite gehoert zum Fahrten-Teil.
 */
@Composable
internal fun KundenBereichSeite(zeigen: (DispoZiel) -> Unit, importieren: () -> Unit) {
    var seite by remember { mutableStateOf<KundenSeite>(KundenSeite.Liste) }
    androidx.compose.runtime.key(seite) {
        when (val s = seite) {
            KundenSeite.Liste -> KundenListeSeite(zeigen, erstellen = { seite = KundenSeite.Erstellen },
                bearbeiten = { seite = KundenSeite.Bearbeiten(it) }, importieren = importieren)
            KundenSeite.Erstellen -> FahrgastFormularSeite(null) { seite = KundenSeite.Liste }
            is KundenSeite.Bearbeiten -> FahrgastFormularSeite(s.gast) { seite = KundenSeite.Liste }
        }
    }
}

// MARK: - Liste

@Composable
private fun KundenListeSeite(
    zeigen: (DispoZiel) -> Unit,
    erstellen: () -> Unit,
    bearbeiten: (StammFahrgast) -> Unit,
    importieren: () -> Unit,
) {
    val dienst = remember { FahrgaesteDienst() }
    val scope = rememberCoroutineScope()
    var suche by remember { mutableStateOf("") }
    DisposableEffect(Unit) {
        scope.launch {
            dienst.laden()
            dienst.beobachten(scope)
        }
        onDispose { dienst.beenden() }
    }
    val q = suche.trim().lowercase()
    val liste = if (q.isEmpty()) dienst.gaeste else dienst.gaeste.filter { g -> listOf(g.name, g.email, g.phone).any { it.lowercase().contains(q) } }
    val bloecke = buildList {
        if (dienst.laedt) add(21f)
        if (!dienst.laedt && dienst.fehler.isNotEmpty()) add(90f)
        if (!dienst.laedt && dienst.fehler.isEmpty() && liste.isEmpty()) add(21f)
        repeat(liste.size) { add(96f) }
    }
    val listenHoehe = bloecke.sum() + max(0, bloecke.size - 1) * 12f

    Box(Modifier.fillMaxSize().background(Color.Black)) {
        Leinwand(874f, 446f + listenHoehe + 24f + 157f) { rahmen ->
            DispoHintergrund(Modifier.platz(0f, 0f, 402f, rahmen))
            ZurueckKnopf(Modifier.platz(20f, 60f)) { zeigen(DispoZiel.START) }
            StammTitel("Fahrgäste", Modifier.platz(20f, 140f))

            Row(Modifier.platz(20f, 206f, 362f, 56f).border(2.dp, LIME).tippen(importieren).padding(horizontal = 16.dp),
                verticalAlignment = Alignment.CenterVertically) {
                Text("Kunden importieren", style = grotesk(16f, 500, abstand = 0.5f, farbe = LIME))
                Spacer(Modifier.weight(1f))
                Icon("Import_Trisar_Icons_01_Lime", Modifier.size(24.dp))
            }

            Row(Modifier.platz(20f, 274f, 362f, 56f).border(2.dp, LIME).padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically) {
                Eingabe(suche, { suche = it }, "Kunden Suchen", grotesk(16f, 500, abstand = 0.5f, farbe = LIME), LIME.copy(alpha = 0.9f),
                    Modifier.weight(1f), gross = KeyboardCapitalization.None)
                Icon("karten-filter-search", Modifier.size(24.dp))
            }

            Row(Modifier.platz(20f, 342f, 362f, 56f).background(LIME).tippen(erstellen).padding(horizontal = 18.dp),
                verticalAlignment = Alignment.CenterVertically) {
                Icon("Person_Trisar_Icons_01", Modifier.size(16.dp, 19.dp))
                Text("Fahrgast erstellen", style = grotesk(16f, 500, abstand = 0.5f, farbe = hex(0x1D1C1D)), modifier = Modifier.padding(start = 10.dp))
                Spacer(Modifier.weight(1f))
                Icon("alle-kunden-add-cross", Modifier.size(20.dp))
            }

            // Dunkle Flaeche mit runden oberen Ecken ueber die volle Breite.
            Box(Modifier.platz(0f, 422f, 402f, 24f + listenHoehe + 24f).background(hex(0x17181B), RoundedCornerShape(topStart = 16.dp, topEnd = 16.dp)))

            Column(Modifier.platz(20f, 446f, 362f), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                if (dienst.laedt) Text("Fahrgäste werden geladen ...", style = grotesk(16f, 500, farbe = LIME))
                if (!dienst.laedt && dienst.fehler.isNotEmpty()) FehlerKasten(dienst.fehler, Modifier.fillMaxWidth())
                if (!dienst.laedt && dienst.fehler.isEmpty() && liste.isEmpty()) Text("Keine Fahrgäste gefunden.", style = grotesk(16f, 500, farbe = LIME))
                for (g in liste) {
                    androidx.compose.runtime.key(g.id) { FahrgastKarte(g, Modifier.tippen { bearbeiten(g) }) }
                }
            }
        }
        // Im Web activeTab="home": die Kundenliste hat keinen eigenen Reiter.
        Navileiste(DispoZiel.START, zeigen)
    }
}

/** CustomerCard aus AlleKunden.jsx: weiss 362 x 96, drei Zeilen links, Stift rechts. */
@Composable
private fun FahrgastKarte(gast: StammFahrgast, modifier: Modifier) {
    Row(
        modifier.size(362.dp, 96.dp).background(Color.White).padding(start = 16.dp, end = 18.dp, top = 10.dp, bottom = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(5.dp)) {
            TextZeile("Fahrgast", grotesk(12f, 500, abstand = 0.3f, farbe = hex(0x18181B, 0.8f)), hoehe = 16f)
            TextZeile(gast.name, grotesk(16f, 700, abstand = 0.4f, farbe = hex(0x18181B)), hoehe = 24f)
            TextZeile(gast.email.ifEmpty { gast.phone.ifEmpty { "-" } }, grotesk(14f, 500, abstand = -0.35f, farbe = hex(0x71717A)), hoehe = 20f)
        }
        Icon("Edit_Trisar_Icon_01", Modifier.size(15.dp))
    }
}

// MARK: - Anlegen / Bearbeiten

/** GUEST_LANGUAGES: gespeichert wird der deutsche Klarname. */
private val GAST_SPRACHEN = listOf("Deutsch", "Englisch", "Spanisch", "Franzoesisch", "Italienisch", "Portugiesisch", "Niederlaendisch", "Polnisch")

@Composable
private fun FahrgastFormularSeite(gast: StammFahrgast?, zurueck: () -> Unit) {
    val scope = rememberCoroutineScope()
    val bearbeiten = !(gast?.id ?: "").isEmpty()
    var vorname by remember { mutableStateOf("") }
    var nachname by remember { mutableStateOf("") }
    var telefon by remember { mutableStateOf("") }
    var email by remember { mutableStateOf("") }
    var vorwahl by remember { mutableStateOf("+49") }
    var strasse by remember { mutableStateOf("") }
    var hausnummer by remember { mutableStateOf("") }
    var ort by remember { mutableStateOf("") }
    var plz by remember { mutableStateOf("") }
    var sprache by remember { mutableStateOf("Deutsch") }
    var notiz by remember { mutableStateOf("") }
    var vip by remember { mutableStateOf(false) }
    var barrierefrei by remember { mutableStateOf(false) }
    var kindersitz by remember { mutableStateOf(false) }
    var gepaeck by remember { mutableStateOf(false) }
    var spracheOffen by remember { mutableStateOf(false) }
    var speichert by remember { mutableStateOf(false) }
    var rueckmeldung by remember { mutableStateOf("") }

    // hydrate: erst Werte aus der Liste, dann die volle Zeile aus guests.
    LaunchedEffect(Unit) {
        rueckmeldung = ""
        val g = gast ?: return@LaunchedEffect
        if (!bearbeiten) return@LaunchedEffect
        vorname = g.firstName; nachname = g.lastName; telefon = g.phone; email = g.email
        strasse = g.street; hausnummer = g.streetNumber; ort = g.city; plz = g.zip
        sprache = g.language.ifEmpty { "Deutsch" }; notiz = g.notes
        val d = FahrgaesteDienst.einzeln(g.id) ?: return@LaunchedEffect
        // normalizePhone: "+49 170 ..." -> Vorwahl und Rest.
        val tel = d.text("phone")
        val m = Regex("^\\+\\d{1,4}").find(tel)
        when {
            tel.isEmpty() -> { vorwahl = "+49"; telefon = "" }
            m != null -> { vorwahl = m.value; telefon = tel.substring(m.range.last + 1).trim() }
            else -> { vorwahl = "+49"; telefon = tel }
        }
        vorname = d.text("first_name"); nachname = d.text("last_name"); email = d.text("email")
        strasse = d.text("street"); hausnummer = d.text("street_number"); ort = d.text("city"); plz = d.text("zip")
        sprache = d.text("language").ifEmpty { "Deutsch" }
        notiz = d.text("notes").ifEmpty { d.text("note_text") }
        vip = d.wahr("is_vip") || d.wahr("vip_status")
        barrierefrei = d.wahr("needs_accessibility")
        kindersitz = d.wahr("needs_child_seat")
        gepaeck = d.wahr("needs_luggage")
    }

    fun leeren() {
        vorname = ""; nachname = ""; telefon = ""; email = ""
        vorwahl = "+49"; strasse = ""; hausnummer = ""; ort = ""; plz = ""; sprache = "Deutsch"; notiz = ""
        vip = false; barrierefrei = false; kindersitz = false; gepaeck = false
    }

    /** createGuest: Pflicht Vor- und Nachname, Telefon = Vorwahl + Nummer, Notiz in notes und note_text. */
    fun speichern() {
        val vn = vorname.trim(); val nn = nachname.trim()
        if (vn.isEmpty() || nn.isEmpty()) { rueckmeldung = "Bitte Vorname und Nachname angeben."; return }
        val tel = "$vorwahl $telefon".trim()
        val inhalt = linkedMapOf<String, JsonElement>(
            "first_name" to JsonPrimitive(vn),
            "last_name" to JsonPrimitive(nn),
            "phone" to if (tel.isEmpty()) JsonNull else JsonPrimitive(tel),
            "email" to jsonText(email),
            "street" to jsonText(strasse),
            "street_number" to jsonText(hausnummer),
            "city" to jsonText(ort),
            "zip" to jsonText(plz),
            "language" to JsonPrimitive(sprache.ifEmpty { "Deutsch" }),
            "notes" to jsonText(notiz),
            "note_text" to jsonText(notiz),
            "is_vip" to JsonPrimitive(vip),
            "vip_status" to JsonPrimitive(vip),
            "needs_accessibility" to JsonPrimitive(barrierefrei),
            "needs_child_seat" to JsonPrimitive(kindersitz),
            "needs_luggage" to JsonPrimitive(gepaeck),
        )
        speichert = true
        rueckmeldung = ""
        val id = if (bearbeiten) gast?.id else null
        scope.launch {
            val fehler = FahrgaesteDienst.speichern(inhalt, id)
            if (fehler != null) {
                rueckmeldung = "Fahrgast konnte nicht gespeichert werden: $fehler"
            } else {
                rueckmeldung = if (id != null) "Fahrgast gespeichert." else "Fahrgast angelegt."
                if (id == null) leeren()
            }
            speichert = false
        }
    }

    @Composable
    fun eingabe(platzhalter: String, wert: String, aendern: (String) -> Unit, modifier: Modifier, rechts: Float = 16f, tastatur: KeyboardType = KeyboardType.Text) =
        Box(modifier.border(2.dp, LIME), contentAlignment = Alignment.CenterStart) {
            Eingabe(wert, aendern, platzhalter, grotesk(16f, 500, farbe = LIME), LIME.copy(alpha = 0.6f),
                Modifier.fillMaxWidth().padding(start = 16.dp, end = rechts.dp), tastatur = tastatur,
                gross = if (tastatur == KeyboardType.Email) KeyboardCapitalization.None else KeyboardCapitalization.Words)
        }

    val feedbackHoehe = if (rueckmeldung.isEmpty()) 0f else 12f + 24f + 16f * rueckmeldung.split("\n").size
    Box(Modifier.fillMaxSize().background(Color.Black)) {
        Leinwand(874f, 1010f + feedbackHoehe + 40f + 32f) { rahmen ->
            DispoHintergrund(Modifier.platz(0f, 0f, 402f, rahmen))
            ZurueckKnopf(Modifier.platz(20f, 60f), zurueck)
            StammTitel(if (bearbeiten) "Fahrgast bearbeiten" else "Fahrgast erstellen", Modifier.platz(20f, 140f), abstand = -0.5f)

            eingabe("Vorname", vorname, { vorname = it }, Modifier.platz(20f, 206f, 177f, 56f))
            eingabe("Nachname", nachname, { nachname = it }, Modifier.platz(205f, 206f, 177f, 56f))
            Box(Modifier.platz(20f, 274f, 362f, 56f)) {
                eingabe("E-Mail", email, { email = it }, Modifier.fillMaxSize(), rechts = 48f, tastatur = KeyboardType.Email)
                Icon("lucide-mail", Modifier.align(Alignment.CenterEnd).padding(end = 16.dp).size(20.dp), farbe = ColorFilter.tint(LIME))
            }
            eingabe("+49", vorwahl, { vorwahl = it }, Modifier.platz(20f, 342f, 90f, 56f), tastatur = KeyboardType.Phone)
            eingabe("Telefon", telefon, { telefon = it }, Modifier.platz(118f, 342f, 264f, 56f), tastatur = KeyboardType.Phone)
            eingabe("Strasse", strasse, { strasse = it }, Modifier.platz(20f, 410f, 268f, 56f))
            eingabe("Nr.", hausnummer, { hausnummer = it }, Modifier.platz(296f, 410f, 86f, 56f))
            eingabe("Ort", ort, { ort = it }, Modifier.platz(20f, 478f, 362f, 56f))
            eingabe("PLZ", plz, { plz = it }, Modifier.platz(20f, 546f, 177f, 56f), tastatur = KeyboardType.Number)

            Row(Modifier.platz(205f, 546f, 177f, 56f).border(2.dp, LIME).tippen { spracheOffen = !spracheOffen }.padding(horizontal = 16.dp),
                verticalAlignment = Alignment.CenterVertically) {
                Text(sprache, style = grotesk(16f, 500, farbe = LIME), maxLines = 1, modifier = Modifier.weight(1f))
                Icon("lucide-chevron-down", Modifier.size(22.dp), farbe = ColorFilter.tint(LIME))
            }

            val schalter = listOf(
                Triple("lucide-star", vip) { vip = !vip },
                Triple("lucide-accessibility", barrierefrei) { barrierefrei = !barrierefrei },
                Triple("lucide-baby", kindersitz) { kindersitz = !kindersitz },
                Triple("lucide-baggage-claim", gepaeck) { gepaeck = !gepaeck },
            )
            schalter.forEachIndexed { i, (icon, an, umschalten) ->
                val farbe = hex(if (an) 0xE3F654 else 0x7F8A2B)
                Box(Modifier.platz(20f + i * (84.5f + 8f), 614f, 84.5f, 48f).border(2.dp, farbe, RoundedCornerShape(8.dp)).tippen(umschalten),
                    contentAlignment = Alignment.Center) {
                    Icon(icon, Modifier.size(22.dp), farbe = ColorFilter.tint(farbe))
                }
            }

            // Notizen: dunkle Karte, darin weisses Blatt mit Ueberschrift und Textfeld.
            Box(Modifier.platz(20f, 692f, 362f, 224f).background(hex(0x1A1A1A), RoundedCornerShape(12.dp))) {
                Column(Modifier.platz(20f, 20f, 322f, 184f).background(Color.White).padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text("Notizen", style = grotesk(16f, 700, abstand = 0.5f, farbe = hex(0x1D1C1D)))
                        Spacer(Modifier.weight(1f))
                        Icon("Arrow-kurz_Trisar_Icons_01_Lime", Modifier.size(10.dp, 13.dp))
                    }
                    val notizStil = grotesk(14f, 400, abstand = 0.25f, farbe = Color(129, 129, 129, 128))
                    Eingabe(notiz, { notiz = it }, "Schreiben...", notizStil, notizStil.color, Modifier.fillMaxSize(), einzeilig = false)
                }
            }

            Row(Modifier.platz(20f, 946f, 362f, 64f).background(LIME).tippen { if (!speichert) speichern() }.padding(horizontal = 20.dp),
                verticalAlignment = Alignment.CenterVertically) {
                Text(if (speichert) "Speichern ..." else if (bearbeiten) "Fahrgast speichern" else "Fahrgast erstellen",
                    style = grotesk(18f, 700, farbe = Color.Black))
                Spacer(Modifier.weight(1f))
                Icon("Arrow_Nav_Trisar_Icons_01", Modifier.size(34.dp, 20.dp))
            }

            if (rueckmeldung.isNotEmpty()) {
                Box(Modifier.platz(20f, 1022f, 362f).background(hex(0x17181C), RoundedCornerShape(12.dp))
                    .border(1.dp, hex(0x2A2A2D), RoundedCornerShape(12.dp)).padding(12.dp)) {
                    Text(rueckmeldung, style = grotesk(12f, farbe = LIME))
                }
            }

            // Sprachliste liegt ueber den Schaltern (z-20 im Web).
            if (spracheOffen) {
                Column(Modifier.platz(205f, 606f, 177f).background(hex(0x161618), RoundedCornerShape(8.dp)).border(1.dp, LIME, RoundedCornerShape(8.dp))) {
                    for (s in GAST_SPRACHEN) {
                        Box(Modifier.fillMaxWidth().tippen { sprache = s; spracheOffen = false }.padding(horizontal = 12.dp, vertical = 8.dp)) {
                            Text(s, style = grotesk(14f, 700, farbe = LIME))
                        }
                    }
                }
            }
        }
        FussleisteUnten()
    }
}

