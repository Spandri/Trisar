package de.trisar.dispo.stamm

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.draw.scale
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import de.trisar.kern.FussleisteUnten
import de.trisar.kern.Icon
import de.trisar.kern.TrisarHintergrund
import de.trisar.kern.ZurueckKnopf
import de.trisar.kern.grotesk
import de.trisar.kern.hex
import de.trisar.kern.platz
import de.trisar.kern.tippen
import kotlinx.coroutines.launch

private val SCHRIFT = hex(0x8A9728)

private enum class EditorMenue { SPRACHE, FAHRZEUG, TRACKER }

/**
 * Nachbau von FahrerErstellenView.jsx (Raster 402 x 913, Inhalt 20 tiefer gesetzt), wie
 * FahrerErstellenAnsicht.swift. `fahrer == null` = anlegen (Einladung ueber dispo-admin), sonst bearbeiten.
 * Ortung: Handy-App oder OBD-Tracker mit IMEI (profiles.tracking_mode, imei_driver_map).
 */
@Composable
internal fun FahrerErstellenSeite(fahrer: DispoFahrer?, zurueck: () -> Unit) {
    val m = remember { FahrerEditorModell(fahrer) }
    val scope = rememberCoroutineScope()
    val fokusManager = LocalFocusManager.current
    var menue by remember { mutableStateOf<EditorMenue?>(null) }
    LaunchedEffect(Unit) { m.start(this) }

    val o = 20f // Container `top-[20px]`
    // Platz fuer die Ortungs-Zeilen: Auswahl (68) plus bei OBD IMEI-Feld und Hinweiszeile (88).
    val ortungsHoehe = if (m.ortung == "obd") 156f else 68f
    val warnung = m.nummerWarnung.isNotEmpty()

    fun umschalten(neu: EditorMenue) {
        fokusManager.clearFocus()
        menue = if (menue == neu) null else neu
    }

    /** Box: 56 hoch, 2er Lime-Rand. */
    @Composable
    fun kasten(x: Float, y: Float, w: Float) = Box(Modifier.platz(x, o + y, w, 56f).border(2.dp, LIME))

    @Composable
    fun feld(
        wert: String, aendern: (String) -> Unit, platzhalter: String, x: Float, y: Float, w: Float, fokus: FocusRequester,
        tastatur: KeyboardType = KeyboardType.Text, aktiv: Boolean = true, fokusGeaendert: ((Boolean) -> Unit)? = null,
    ) = Box(Modifier.platz(x, o + y, w, 56f), contentAlignment = Alignment.CenterStart) {
        Eingabe(wert, aendern, platzhalter, grotesk(16f, 500, abstand = 0.5f, farbe = SCHRIFT), SCHRIFT.copy(alpha = 0.9f),
            Modifier.fillMaxWidth(), tastatur = tastatur, fokus = fokus, aktiv = aktiv, fokusGeaendert = fokusGeaendert)
    }

    /** Kurzer Lime-Pfeil rechts im Feld, setzt den Fokus wie im Web. */
    @Composable
    fun pfeil(fokus: FocusRequester, x: Float, y: Float, w: Float) =
        Box(Modifier.platz(x + w - 34f, o + y, 34f, 56f).tippen { menue = null; runCatching { fokus.requestFocus() } },
            contentAlignment = Alignment.CenterEnd) {
            Icon("Arrow-kurz_Trisar_Icons_01_Lime", Modifier.padding(end = 12.dp).size(10.dp, 13.dp))
        }

    /** Feld mit Rahmen und Pfeil (`left-4`, rechts je nach Feld `right-10/12/14`). */
    @Composable
    fun eingabe(wert: String, aendern: (String) -> Unit, platzhalter: String, x: Float, y: Float, w: Float, rechts: Float = 56f,
                tastatur: KeyboardType = KeyboardType.Text) {
        val fokus = remember { FocusRequester() }
        kasten(x, y, w)
        feld(wert, aendern, platzhalter, x + 16f, y, w - 16f - rechts, fokus, tastatur)
        pfeil(fokus, x, y, w)
    }

    /** Klappauswahl mit "v" rechts (Sprache, Fahrzeug). */
    @Composable
    fun auswahl(text: String, x: Float, y: Float, w: Float, aktion: () -> Unit) =
        Box(Modifier.platz(x, o + y, w, 56f).clipToBounds().border(2.dp, LIME).tippen(aktion), contentAlignment = Alignment.CenterStart) {
            Text(text, style = grotesk(16f, 500, abstand = 0.5f, farbe = SCHRIFT), maxLines = 1, softWrap = false, modifier = Modifier.padding(start = 16.dp, end = 48.dp))
            Text("v", style = grotesk(32f, 700, farbe = LIME), modifier = Modifier.align(Alignment.CenterEnd).padding(end = 16.dp))
        }

    @Composable
    fun ortungsKnopf(wert: String, text: String, x: Float) {
        val an = m.ortung == wert
        Box(
            Modifier.platz(x, o + 662f, 178f, 56f).background(if (an) LIME else Color.Transparent).border(2.dp, LIME)
                .tippen { m.ortung = wert; if (menue == EditorMenue.TRACKER) menue = null },
            contentAlignment = Alignment.CenterStart,
        ) {
            Text(text, style = grotesk(16f, 500, abstand = 0.5f, farbe = if (an) hex(0x0E1008) else SCHRIFT), modifier = Modifier.padding(start = 16.dp))
        }
    }

    /** Aufgeklappte Liste 58 unter dem Feld: schwarz, Lime-Rand, scrollbar. */
    @Composable
    fun liste(x: Float, y: Float, w: Float, maxHoehe: Float, zeilen: Int, inhalt: @Composable () -> Unit) {
        // Zeile = py-2 + 24er Textzeile = 40, plus 2er Rand oben und unten.
        val hoehe = minOf(maxHoehe, zeilen * 40f + 4f)
        Box(Modifier.platz(x, o + y + 58f, w, hoehe).background(Color.Black).border(2.dp, LIME)) {
            Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(vertical = 2.dp)) { inhalt() }
        }
    }

    @Composable
    fun zeile(text: String, aktion: () -> Unit) =
        Box(Modifier.fillMaxWidth().height(40.dp).tippen(aktion).padding(horizontal = 16.dp), contentAlignment = Alignment.CenterStart) {
            Text(text, style = grotesk(16f, farbe = SCHRIFT), maxLines = 1)
        }

    Box(Modifier.fillMaxSize().background(Color.Black)) {
        TrisarHintergrund()
        Leinwand(913f, 913f + ortungsHoehe) {
            ZurueckKnopf(Modifier.platz(20f, 60f), zurueck)

            StammTitel(if (m.bearbeiten) "Fahrer bearbeiten" else "Fahrer erstellen", Modifier.platz(20f, o + 120f), abstand = -0.5f, farbe = 0xE2F754)

            eingabe(m.vorname, { m.vorname = it }, "Vorname", 20f, 186f, 178f)
            eingabe(m.nachname, { m.nachname = it }, "Nachname", 204f, 186f, 178f)

            // E-Mail: Brief-Icon links, beim Bearbeiten nur lesbar.
            val mailFokus = remember { FocusRequester() }
            kasten(20f, 254f, 362f)
            Icon("Mail_Trisar_Icons_01_Lime", Modifier.platz(12f, o + 254f + 21.5f, 10f, 13f).scale(1.2f))
            feld(m.email, { m.email = it }, "E-Mail", 60f, 254f, 362f - 80f, mailFokus, KeyboardType.Email, aktiv = !m.bearbeiten)
            pfeil(mailFokus, 20f, 254f, 362f)

            val vorwahlFokus = remember { FocusRequester() }
            kasten(20f, 322f, 85f)
            feld(m.landesvorwahl, { m.landesvorwahl = it }, "+49", 36f, 322f, 85f - 24f, vorwahlFokus, KeyboardType.Phone)

            val telFokus = remember { FocusRequester() }
            kasten(111f, 322f, 271f)
            Icon("contact-phone", Modifier.platz(123f, o + 322f + 22f, 12f, 12f))
            feld(m.telefon, { m.telefon = it }, "Telefon", 151f, 322f, 271f - 80f, telFokus, KeyboardType.Phone)
            pfeil(telFokus, 111f, 322f, 271f)

            eingabe(m.strasse, { m.strasse = it }, "Straße", 20f, 390f, 271f, rechts = 48f)
            eingabe(m.hausnummer, { m.hausnummer = it }, "Nr.", 297f, 390f, 85f, rechts = 40f)
            eingabe(m.ort, { m.ort = it }, "Ort", 20f, 458f, 362f, rechts = 48f)
            eingabe(m.plz, { m.plz = it }, "PLZ", 20f, 526f, 178f, rechts = 48f)

            auswahl(m.sprache.ifEmpty { "Sprache" }, 204f, 526f, 178f) { umschalten(EditorMenue.SPRACHE) }
            auswahl(if (m.fahrzeugeLaden) "Fahrzeuge laden ..." else m.fahrzeugEtikett, 20f, 594f, 271f) { umschalten(EditorMenue.FAHRZEUG) }

            eingabe(m.nummer, { m.nummerGeaendert(it, scope) }, "Nr.", 297f, 594f, 85f, rechts = 40f, tastatur = KeyboardType.Number)

            // Ortung: Handy-App oder OBD-Tracker.
            ortungsKnopf("app", "Handy-App", 20f)
            ortungsKnopf("obd", "OBD-Tracker", 204f)

            if (m.ortung == "obd") {
                val imeiFokus = remember { FocusRequester() }
                kasten(20f, 730f, 362f)
                feld(m.imei, { m.imei = it.filter { c -> c.isDigit() }.take(15) }, "IMEI des Trackers (15 Ziffern)",
                    36f, 730f, 362f - 16f - 56f, imeiFokus, KeyboardType.Number,
                    // Wie onFocus am IMEI-Feld: Tracker-Liste zu.
                    fokusGeaendert = { if (it && menue == EditorMenue.TRACKER) menue = null })
                if (m.tracker.isNotEmpty()) {
                    Box(Modifier.platz(20f + 362f - 64f, o + 730f, 64f, 56f).tippen { umschalten(EditorMenue.TRACKER) }, contentAlignment = Alignment.CenterEnd) {
                        Text("v", style = grotesk(32f, 700, farbe = LIME), modifier = Modifier.padding(end = 16.dp))
                    }
                }
                m.trackerBeiAnderem?.let { t ->
                    Text("Tracker ist gerade bei ${t.besitzerName.ifEmpty { "?" }} und wird dort abgeschaltet.",
                        style = grotesk(12f, 400, 12f * 1.3f, farbe = hex(0xFF9500)), modifier = Modifier.platz(20f, o + 790f, 362f))
                }
            }

            if (warnung) {
                Box(
                    Modifier.platz(20f, o + 662f + ortungsHoehe, 362f).background(hex(0x2D1E00), RoundedCornerShape(4.dp))
                        .border(1.dp, hex(0xFF9500), RoundedCornerShape(4.dp)).padding(horizontal = 12.dp, vertical = 4.dp),
                ) {
                    Text(m.nummerWarnung, style = grotesk(12f, 400, 12f * 1.3f, farbe = hex(0xFF9500)))
                }
            }

            // Speichern: loest erst der Knopf aus (createDriver).
            Box(
                Modifier.platz(20f, o + (if (warnung) 696f else 674f) + ortungsHoehe, 362f, 56f).alpha(if (m.speichert) 0.7f else 1f)
                    .background(hex(0xDBEE4A))
                    .tippen {
                        if (m.speichert) return@tippen
                        fokusManager.clearFocus()
                        menue = null
                        scope.launch { m.speichern() }
                    },
                contentAlignment = Alignment.Center,
            ) {
                Text(if (m.speichert) "Speichern ..." else if (m.bearbeiten) "Fahrer speichern" else "Fahrer erstellen",
                    style = grotesk(16f, 500, abstand = 0.5f, farbe = hex(0x0E1008)))
            }

            Box(
                Modifier.platz(20f, o + (if (warnung) 764f else 742f) + ortungsHoehe, 362f).heightIn(min = 56.dp)
                    .border(1.dp, hex(0x7F8A2B)).padding(horizontal = 12.dp, vertical = 8.dp),
            ) {
                Text(
                    m.rueckmeldung.ifEmpty { if (m.bearbeiten) "Fahrerdaten bearbeiten und speichern." else "Fahrzeug koppeln + Nr. setzen und dann Fahrer erstellen." },
                    style = grotesk(12f, 400, 12f * 1.3f, farbe = hex(0xC8D85D)),
                )
            }

            // Aufgeklappte Listen zuletzt, damit sie ueber allem liegen.
            if (menue == EditorMenue.SPRACHE) {
                liste(204f, 526f, 178f, 192f, FahrerEditorModell.sprachen.size) {
                    for (s in FahrerEditorModell.sprachen) zeile(s) { m.sprache = s; menue = null }
                }
            }
            if (menue == EditorMenue.FAHRZEUG) {
                liste(20f, 594f, 271f, 208f, m.fahrzeuge.size + 1) {
                    zeile("Kein Fahrzeug") { m.fahrzeugID = ""; menue = null }
                    for (f in m.fahrzeuge) zeile(f.etikett.ifEmpty { "Ohne Kennzeichen" }) { m.fahrzeugID = f.id; menue = null }
                }
            }
            if (menue == EditorMenue.TRACKER && m.ortung == "obd") {
                liste(20f, 730f, 362f, 208f, m.tracker.size) {
                    for (t in m.tracker) {
                        val notiz = if (t.isActive != true) "frei" else if (t.driverID == m.ursprung?.id) "dieser Fahrer" else t.besitzerName
                        Box(Modifier.fillMaxWidth().height(40.dp).tippen { m.imei = t.imei; menue = null }.padding(horizontal = 16.dp),
                            contentAlignment = Alignment.CenterStart) {
                            Text(buildAnnotatedString {
                                append(t.imei)
                                if (notiz.isNotEmpty()) withStyle(SpanStyle(fontSize = 12.sp, color = hex(0xC8D85D))) { append(" · $notiz") }
                            }, style = grotesk(16f, farbe = SCHRIFT), maxLines = 1)
                        }
                    }
                }
            }
        }
        FussleisteUnten()
    }
}
