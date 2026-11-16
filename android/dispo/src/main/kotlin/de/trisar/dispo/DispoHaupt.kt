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
import io.github.jan.supabase.postgrest.postgrest
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.doubleOrNull
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
    /** Gaeste-Import aus der Kundenliste (ImportAnsicht(.gaeste) in iOS). */
    var gaesteImport by rememberSaveable { mutableStateOf(false) }
    /** Standby verschicken (setView('standbyAdd')) und offener Standby (setView('standby')). */
    var standbyNeu by rememberSaveable { mutableStateOf(false) }
    var offenerStandby by rememberSaveable { mutableStateOf<String?>(null) }
    /** Dienstreise verschicken (setView('dienstreiseAdd')) und offene Dienstreise (setView('dienstreise')). */
    var dienstreiseNeu by rememberSaveable { mutableStateOf(false) }
    var offeneDienstreise by rememberSaveable { mutableStateOf<String?>(null) }
    val standbyZeigen: (DispoZiel) -> Unit = {
        standbyNeu = false; offenerStandby = null; dienstreiseNeu = false; offeneDienstreise = null; ziel = it
    }
    // Tipp auf eine Mitteilung: Fahrt, Fahrzeuge, Fahrer oder Fahrten oeffnen.
    val pushZiel by de.trisar.kern.Push.ziel.collectAsState()
    androidx.compose.runtime.LaunchedEffect(pushZiel) {
        val z = pushZiel ?: return@LaunchedEffect
        de.trisar.kern.Push.ziel.value = null
        gaesteImport = false
        when (z["ziel"]) {
            "fahrt" -> z["job_id"]?.let { bearbeiteteFahrt = it }
            "fahrzeug" -> {
                de.trisar.dispo.stamm.FahrzeugSprung.id = z["vehicle_id"]
                ziel = DispoZiel.FAHRZEUGE
            }
            "fahrer" -> ziel = DispoZiel.FAHRER
            "chat" -> ziel = DispoZiel.FAHRTEN
            else -> ziel = DispoZiel.START
        }
    }

    // Android-Zurueck: erst den Editor schliessen, dann zur Startseite.
    BackHandler(enabled = gaesteImport || bearbeiteteFahrt != null || standbyNeu || offenerStandby != null
        || dienstreiseNeu || offeneDienstreise != null || ziel != DispoZiel.START) {
        when {
            gaesteImport -> gaesteImport = false
            offeneDienstreise != null -> offeneDienstreise = null
            dienstreiseNeu -> dienstreiseNeu = false
            offenerStandby != null -> offenerStandby = null
            standbyNeu -> standbyNeu = false
            bearbeiteteFahrt != null -> bearbeiteteFahrt = null
            else -> ziel = DispoZiel.START
        }
    }

    Box(Modifier.fillMaxSize().background(Color.Black)) {
        // Jede Seite neu wie .id(ziel) in iOS.
        key(ziel) {
            when (ziel) {
                DispoZiel.START -> DispoStartseite(anmeldung, zeigen)
                DispoZiel.FAHRER -> FahrerBereich(zeigen, oeffneFahrt)
                DispoZiel.FAHRZEUGE -> FahrzeugBereich(zeigen)
                DispoZiel.KUNDEN -> KundenBereich(zeigen, importieren = { gaesteImport = true })
                DispoZiel.PROFIL -> KoordinatorProfil(zeigen)
                DispoZiel.FAHRTEN -> FahrtenSeite(zeigen, oeffneFahrt, { offenerStandby = it }, { offeneDienstreise = it })
                DispoZiel.KARTE -> DispoKarteSeite(zeigen)
                DispoZiel.PLANUNG -> PlanungSeite(zeigen, oeffneFahrt)
                DispoZiel.KI_ASSISTENT -> KiAssistentSeite(zeigen, oeffneFahrt)
                DispoZiel.FAHRT_NEU -> FahrtFormularSeite(fahrtID = null, zurueck = { ziel = DispoZiel.START }, zeigen = zeigen, standbyWahl = { standbyNeu = true },
                    dienstreiseWahl = { dienstreiseNeu = true })
            }
        }
        // Editor liegt als eigene Seite darueber, ohne Hochschieben (wie setView im Web).
        bearbeiteteFahrt?.let { id ->
            key(id) { FahrtFormularSeite(fahrtID = id, zurueck = { bearbeiteteFahrt = null }, zeigen = null) }
        }
        // Standby verschicken liegt ueber "Fahrt hinzufuegen", der offene Standby ueber allem.
        if (standbyNeu) {
            de.trisar.dispo.standby.StandbyNeuSeite(
                zurueck = { standbyNeu = false; ziel = DispoZiel.FAHRTEN },
                zurFahrt = { standbyNeu = false; ziel = DispoZiel.FAHRT_NEU },
                zurDienstreise = { standbyNeu = false; dienstreiseNeu = true },
                gesendet = { id -> standbyNeu = false; ziel = DispoZiel.FAHRTEN; offenerStandby = id },
                zeigen = standbyZeigen,
            )
        }
        offenerStandby?.let { id ->
            key("standby-$id") {
                de.trisar.dispo.standby.StandbyBearbeitenSeite(id, zurueck = { offenerStandby = null; ziel = DispoZiel.FAHRTEN }, zeigen = standbyZeigen)
            }
        }
        // Dienstreise verschicken ebenso ueber "Fahrt hinzufuegen", die offene Dienstreise ueber allem.
        if (dienstreiseNeu) {
            de.trisar.dispo.dienstreise.DienstreiseNeuSeite(
                zurueck = { dienstreiseNeu = false; ziel = DispoZiel.FAHRTEN },
                zurFahrt = { dienstreiseNeu = false; ziel = DispoZiel.FAHRT_NEU },
                zuStandby = { dienstreiseNeu = false; standbyNeu = true },
                gesendet = { id -> dienstreiseNeu = false; ziel = DispoZiel.FAHRTEN; offeneDienstreise = id },
                zeigen = standbyZeigen,
            )
        }
        offeneDienstreise?.let { id ->
            key("dienstreise-$id") {
                de.trisar.dispo.dienstreise.DienstreiseBearbeitenSeite(id, zurueck = { offeneDienstreise = null; ziel = DispoZiel.FAHRTEN }, zeigen = standbyZeigen)
            }
        }
        if (gaesteImport) {
            de.trisar.dispo.einlesen.ImportSeite(
                modus = de.trisar.dispo.einlesen.ImportModus.GAESTE,
                zurueck = { gaesteImport = false },
                zumZiel = { gaesteImport = false; ziel = DispoZiel.KUNDEN },
            )
        }
    }
}

/** HomeScreen.jsx: Profil-Knopf, Logo, Begruessung, vier Knoepfe ab 442, Leiste unten. */
@Composable
private fun DispoStartseite(anmeldung: Anmeldung, zeigen: (DispoZiel) -> Unit) {
    val profil by anmeldung.profil.collectAsState()
    // Live: Einsatzkosten = gearbeitete Minuten x Stundenlohn aller Fahrer (DB einsatzkosten(), 12.11.), jede Minute neu.
    var kosten by remember { mutableStateOf<Pair<Double, Double>?>(null) }
    androidx.compose.runtime.LaunchedEffect(Unit) {
        while (true) {
            einsatzkostenLaden()?.let { kosten = it }
            kotlinx.coroutines.delay(60_000)
        }
    }
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
                kosten?.let { (euro, stunden) ->
                    Row(Modifier.platz(20f, 302f), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        StartKachel("Seit Einsatzbeginn", "${deutscheZahl(euro)} €", "Einsatzkosten")
                        StartKachel("Seit Einsatzbeginn", "${Math.round(stunden)} h", "Arbeitsstunden")
                    }
                }
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

/** RPC einsatzkosten(): {kosten, stunden, dienste_ohne_lohn}. null bei Fehler, dann bleibt der alte Wert stehen. */
private suspend fun einsatzkostenLaden(): Pair<Double, Double>? = try {
    val text = de.trisar.kern.Backend.client.postgrest.rpc("einsatzkosten").data
    val o = de.trisar.kern.Backend.json.parseToJsonElement(text) as? JsonObject
    if (o == null) null else {
        fun zahl(k: String) = (o[k] as? JsonPrimitive)?.let { it.doubleOrNull ?: it.content.toDoubleOrNull() } ?: 0.0
        zahl("kosten") to zahl("stunden")
    }
} catch (e: kotlinx.coroutines.CancellationException) {
    throw e
} catch (e: Exception) {
    null
}

/** Gerundet mit deutschem Tausenderpunkt wie toLocaleString('de-DE'). */
private fun deutscheZahl(n: Double): String =
    java.text.NumberFormat.getIntegerInstance(java.util.Locale.GERMANY).format(Math.round(n))

/** StatCard aus HomeScreen.jsx: 178 x 112, 2er Lime-Rand, Titel und Untertitel halb durchsichtig. */
@Composable
private fun StartKachel(titel: String, zahl: String, unten: String) {
    val lime = hex(0xE3F654)
    Box(Modifier.size(178.dp, 112.dp).border(2.dp, lime)) {
        Text(titel, style = grotesk(14f, 500, 24f, 0.3f, lime.copy(alpha = 0.5f)), maxLines = 1, softWrap = false, modifier = Modifier.platz(18f, 15f))
        Text(zahl, style = grotesk(30f, 500, 24f, 0.5f, lime), maxLines = 1, softWrap = false, modifier = Modifier.platz(18f, 47f))
        Text(unten, style = grotesk(14f, 500, 24f, 0.3f, lime.copy(alpha = 0.5f)), maxLines = 1, softWrap = false, modifier = Modifier.platz(18f, 77f))
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
