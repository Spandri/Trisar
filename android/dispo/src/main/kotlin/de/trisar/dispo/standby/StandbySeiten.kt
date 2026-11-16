package de.trisar.dispo.standby

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
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import de.trisar.dispo.DispoZiel
import de.trisar.dispo.FahrerMarkierung
import de.trisar.dispo.Navileiste
import de.trisar.dispo.fahrten.EtaMarke
import de.trisar.dispo.fahrten.FahrtPruefung
import de.trisar.dispo.fahrten.FahrtSpeichern
import de.trisar.dispo.fahrten.FahrtText
import de.trisar.dispo.fahrten.FormularSpeichernKnopf
import de.trisar.dispo.fahrten.FormularZeile
import de.trisar.dispo.fahrten.Hinweis
import de.trisar.dispo.fahrten.LIME
import de.trisar.dispo.fahrten.OrtVorschlagListe
import de.trisar.dispo.fahrten.RechtsArt
import de.trisar.dispo.fahrten.Rueckfrage
import de.trisar.dispo.fahrten.VorschlagListe
import de.trisar.dispo.fahrten.ZeilenEingabe
import de.trisar.dispo.fahrten.ZeilenWert
import de.trisar.dispo.fahrten.autoTreffer
import de.trisar.dispo.fahrten.blockieren
import de.trisar.dispo.fahrten.css
import de.trisar.dispo.fahrten.datumWaehlen
import de.trisar.dispo.fahrten.zeitWaehlen
import de.trisar.kern.DispoHintergrund
import de.trisar.kern.EigeneOrte
import de.trisar.kern.Icon
import de.trisar.kern.Ort
import de.trisar.kern.Routen
import de.trisar.kern.ZurueckKnopf
import de.trisar.kern.grotesk
import de.trisar.kern.hex
import de.trisar.kern.platz
import de.trisar.kern.tippen
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.time.LocalDate

// Raster aus StandbyAdd.jsx / StandbyView.jsx: Titel 140, Felder ab 206, Reihen alle 68, Zeilenhoehe 56.
private const val SCHRITT = 68f
private const val ZEILE = 56f
private const val FAHRER_OBEN = 478f

/**
 * "Fahrt | Standby | Dienstreise" oben mittig zwischen Zurueck und Import (ArtUmschalter.jsx).
 * art: "fahrt", "standby" oder "dienstreise". Drei Knoepfe passen mit Padding 10 und Schrift 14 dazwischen.
 */
@Composable
fun ArtUmschalter(art: String, modifier: Modifier, fahrt: () -> Unit, standbyWahl: () -> Unit, dienstreiseWahl: () -> Unit) {
    Box(modifier, contentAlignment = Alignment.TopCenter) {
        Row(Modifier.border(2.dp, LIME)) {
            for ((text, an, aktion) in listOf(
                Triple("Fahrt", art == "fahrt", fahrt),
                Triple("Standby", art == "standby", standbyWahl),
                Triple("Dienstreise", art == "dienstreise", dienstreiseWahl),
            )) {
                Box(
                    Modifier.height(36.dp).background(if (an) LIME else Color.Transparent).tippen(aktion).padding(horizontal = 10.dp),
                    contentAlignment = Alignment.Center,
                ) { Text(text, style = grotesk(14f, 700, farbe = if (an) Color.Black else LIME)) }
            }
        }
    }
}

/** Notizen wie in Fahrt hinzufuegen: graue Flaeche, weisses Feld (402 breit, 224 hoch). */
@Composable
internal fun NotizFeld(notiz: String, aendern: (String) -> Unit, modifier: Modifier) {
    Box(modifier.background(hex(0x1A1A1A), RoundedCornerShape(12.dp))) {
        Column(Modifier.platz(20f, 20f, 362f, 184f).background(Color.White).padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(FahrtText.tr("fahrt.notizen"), style = css(16f, 700, abstand = 0.5f, farbe = hex(0x1D1C1D)))
                Spacer(Modifier.weight(1f))
                Icon("Arrow-kurz_Trisar_Icons_01_Lime", Modifier.size(10.dp, 13.dp))
            }
            val stil = grotesk(14f, abstand = 0.25f, farbe = hex(0x818181, 0.5f))
            BasicTextField(
                notiz, aendern, Modifier.fillMaxWidth().weight(1f),
                textStyle = stil, cursorBrush = SolidColor(hex(0x818181)),
                keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences),
                decorationBox = { inner ->
                    if (notiz.isEmpty()) Text(FahrtText.tr("fahrt.notesPlaceholder"), style = stil.copy(color = hex(0x818181, 0.25f)))
                    inner()
                },
            )
        }
    }
}

/** "TT.MM.JJJJ" fuer die Datumszeile. */
internal fun datumText(iso: String): String = iso.split("-").let { if (it.size == 3) "${it[2]}.${it[1]}.${it[0]}" else iso }
internal fun minuten(hhmm: String): Int? = hhmm.split(":").mapNotNull { it.toIntOrNull() }.let { if (it.size >= 2) it[0] * 60 + it[1] else null }

/** Fahrerzeilen: leere Zeile immer am Ende. */
internal fun fahrerSetzen(alt: List<String>, i: Int, wert: String): List<String> {
    val neu = alt.mapIndexed { j, n -> if (j == i) wert else n }.filter { it.isNotBlank() }
    return neu + ""
}

/**
 * Standby verschicken (StandbyAdd.jsx): Datum, von, bis, Ort (eigene Orte zuerst, sonst Adresse mit
 * Koordinaten), bestimmte Fahrer wie bei Fahrt hinzufuegen (Fahrer #1, #2 ...), Notiz.
 * Jeder Fahrer bekommt eine eigene Anfrage zum Annehmen oder Ablehnen.
 */
@Composable
fun StandbyNeuSeite(
    zurueck: () -> Unit, zurFahrt: () -> Unit, gesendet: (String) -> Unit, zeigen: (DispoZiel) -> Unit,
    /** Schalter "Dienstreise": wechselt zu Dienstreise verschicken. */
    zurDienstreise: () -> Unit = {},
    /** Standby-Karte des KI-Assistenten: Felder vorbelegt, ohne Umschalter Fahrt/Standby. */
    vorlage: StandbyVorlage? = null,
) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    val fokusManager = LocalFocusManager.current
    var datum by remember { mutableStateOf(vorlage?.datum?.ifBlank { null } ?: LocalDate.now(BERLIN).toString()) }
    var von by remember { mutableStateOf(vorlage?.von.orEmpty()) }
    var bis by remember { mutableStateOf(vorlage?.bis.orEmpty()) }
    var ortText by remember { mutableStateOf(vorlage?.ortFeld.orEmpty()) }
    var ortID by remember { mutableStateOf(vorlage?.ortId?.ifBlank { null }) }
    var ortOffen by remember { mutableStateOf(false) }
    var vorschlaege by remember { mutableStateOf(emptyList<String>()) }
    var vorschlagLauf by remember { mutableStateOf<Job?>(null) }
    var vorschlagNr by remember { mutableIntStateOf(0) }
    var notiz by remember { mutableStateOf(vorlage?.notiz.orEmpty()) }
    var fehler by remember { mutableStateOf("") }
    var sendet by remember { mutableStateOf(false) }
    // Auf der Karte markierte Fahrer sind schon eingetragen.
    var fahrerNamen by remember {
        if (vorlage != null) return@remember mutableStateOf(vorlage.fahrerNamen.filter { it.isNotBlank() } + "")
        val markierte = if (FahrerMarkierung.wirkt) FahrerMarkierung.fahrer.map { it.name }.filter { it.isNotEmpty() } else emptyList()
        mutableStateOf(markierte + "")
    }
    var fahrerAlle by remember { mutableStateOf(emptyList<FahrtSpeichern.FahrerEintrag>()) }
    var fokusFahrer by remember { mutableStateOf<Int?>(null) }
    var listeZu by remember { mutableStateOf(false) }

    LaunchedEffect(Unit) { EigeneOrte.laden() }
    LaunchedEffect(Unit) { fahrerAlle = FahrtSpeichern.fahrerLaden() }
    // Eine alte Meldung verschwindet, sobald ein Feld geaendert wird.
    LaunchedEffect(datum, von, bis, ortText, fahrerNamen) { fehler = "" }
    val fahrerVorschlaege = remember(fahrerAlle) { FahrtSpeichern.fahrerVorschlaege(fahrerAlle) }

    fun ortTippen(text: String) {
        ortText = text; ortID = null
        vorschlagLauf?.cancel()
        val q = text.trim()
        if (q.isEmpty()) { vorschlaege = emptyList(); return }
        ortOffen = true
        val n = ++vorschlagNr
        vorschlagLauf = scope.launch {
            delay(250)
            val liste = FahrtPruefung.ortsVorschlaege(q)
            if (vorschlagNr == n) vorschlaege = liste
        }
    }

    fun senden() {
        if (sendet) return
        fehler = ""
        val fehlt = listOfNotNull("Datum".takeIf { datum.isBlank() }, "Von".takeIf { von.isBlank() }, "Bis".takeIf { bis.isBlank() })
        if (fehlt.isNotEmpty()) { fehler = "Bitte ${fehlt.joinToString(", ")} setzen."; return }
        if (ortText.isBlank()) { fehler = "Bitte einen Ort wählen."; return }
        val namen = fahrerNamen.map { it.trim() }.filter { it.isNotEmpty() }
        if (namen.isEmpty()) { fehler = "Bitte mindestens einen Fahrer eintragen."; return }
        sendet = true
        scope.launch {
            try {
                // Ort: eigener Ort mit Radius, sonst Adresse suchen (Radius 150 rein, 300 raus).
                if (ortID != null) EigeneOrte.einmalLaden()
                val eigener: Ort? = EigeneOrte.zuID(ortID)
                val vLat = vorlage?.lat
                val vLng = vorlage?.lng
                val ort = if (eigener != null) {
                    DispoStandbySpeicher.OrtWahl(eigener.id, eigener.name, eigener.adresse, eigener.lat, eigener.lng,
                        maxOf(150, eigener.radius_rein_m), maxOf(300, eigener.radius_raus_m))
                } else if (vorlage != null && vLat != null && vLng != null && ortText == vorlage.adresse.ifBlank { vorlage.ortName }) {
                    // Ort vom Assistenten schon gefunden (Server, TomTom D/A/CH).
                    DispoStandbySpeicher.OrtWahl(null, vorlage.ortName.ifBlank { ortText.split(",").first().trim() },
                        vorlage.adresse.ifBlank { ortText }, vLat, vLng)
                } else {
                    val p = Routen.punkt(ctx, ortText)
                    if (p == null) { fehler = "Adresse nicht gefunden. Bitte genauer eingeben oder einen eigenen Ort wählen."; return@launch }
                    DispoStandbySpeicher.OrtWahl(null, ortText.split(",").first().trim(), ortText, p.lat, p.lng)
                }
                val alle = if (fahrerAlle.isEmpty()) FahrtSpeichern.fahrerLaden().also { fahrerAlle = it } else fahrerAlle
                val ids = mutableListOf<String>()
                for (n in namen) {
                    val id = FahrtSpeichern.fahrerID(n, alle)
                    if (id == null) { fehler = "Fahrer „$n“ nicht gefunden."; return@launch }
                    if (id !in ids) ids += id
                }
                DispoStandbySpeicher.anlegen(datum, von, bis, ort, notiz.trim(), ids)
                    .onSuccess { gesendet(it) }
                    .onFailure { fehler = it.message ?: "Standby nicht gespeichert." }
            } finally {
                sendet = false
            }
        }
    }

    val notizOben = FAHRER_OBEN + (fahrerNamen.size - 1) * SCHRITT + ZEILE + 24f
    val ctaOben = notizOben + 224f + 24f
    val hoehe = ctaOben + ZEILE + (if (fehler.isNotEmpty()) 60f else 30f) + 151f

    Box(Modifier.fillMaxSize().background(Color.Black).blockieren().imePadding()) {
        Box(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
            Box(Modifier.fillMaxWidth().height(hoehe.dp)) {
                DispoHintergrund(Modifier.fillMaxWidth().height(hoehe.dp))
                ZurueckKnopf(Modifier.platz(20f, 60f), zurueck)
                if (vorlage == null) ArtUmschalter("standby", Modifier.platz(0f, 67f, 402f, 40f), fahrt = zurFahrt, standbyWahl = {}, dienstreiseWahl = zurDienstreise)
                Text("Standby", style = css(42f, 700, 42f, farbe = LIME), modifier = Modifier.platz(20f, 140f, 320f))

                FormularZeile("Datum", datum, Modifier.platz(20f, 206f, 362f, ZEILE), zuruecksetzen = { datum = "" }) {
                    ZeilenWert(datumText(datum)) {
                        fokusManager.clearFocus()
                        if (datum.isEmpty()) datum = LocalDate.now(BERLIN).toString()
                        datumWaehlen(ctx, datum) { datum = it }
                    }
                }
                FormularZeile("Von", von, Modifier.platz(20f, 274f, 362f, ZEILE), zuruecksetzen = { von = "" }) {
                    ZeilenWert(von) { fokusManager.clearFocus(); zeitWaehlen(ctx, minuten(von)) { von = it } }
                }
                FormularZeile("Bis", bis, Modifier.platz(20f, 342f, 362f, ZEILE), zuruecksetzen = { bis = "" }) {
                    ZeilenWert(bis) { fokusManager.clearFocus(); zeitWaehlen(ctx, minuten(bis)) { bis = it } }
                }
                FormularZeile("Ort", ortText, Modifier.platz(20f, 410f, 362f, ZEILE), zuruecksetzen = { ortText = ""; ortID = null; vorschlaege = emptyList() }) {
                    ZeilenEingabe(ortText, ::ortTippen, Modifier.onFocusChanged { ortOffen = it.isFocused })
                }

                fahrerNamen.forEachIndexed { i, n ->
                    key("fahrer-$i") {
                        val titel = if (fahrerNamen.size > 1) FahrtText.tr("fahrt.fahrerNumbered", mapOf("n" to "${i + 1}")) else FahrtText.tr("fahrt.fahrer")
                        FormularZeile(titel, n, Modifier.platz(20f, FAHRER_OBEN + i * SCHRITT, 362f, ZEILE), zuruecksetzen = { fahrerNamen = fahrerSetzen(fahrerNamen, i, "") }) {
                            ZeilenEingabe(n, { listeZu = false; fahrerNamen = fahrerSetzen(fahrerNamen, i, it) },
                                Modifier.onFocusChanged { if (it.isFocused) fokusFahrer = i else if (fokusFahrer == i) fokusFahrer = null })
                        }
                    }
                }

                NotizFeld(notiz, { notiz = it }, Modifier.platz(0f, notizOben, 402f, 224f))

                FormularSpeichernKnopf(if (sendet) "Wird gesendet …" else "Standby senden", sendet, Modifier.platz(20f, ctaOben, 362f, ZEILE)) { senden() }
                if (fehler.isNotEmpty()) {
                    Text(fehler, style = grotesk(13f, 700, farbe = SB_ROT), modifier = Modifier.platz(20f, ctaOben + ZEILE + 10f, 362f))
                }

                // Listen ueber den Reihen: eigene Orte zuerst, darunter Adressen.
                val eigeneTreffer = if (ortID == null) EigeneOrte.vorschlaege(ortText) else emptyList()
                if (ortOffen && (eigeneTreffer.isNotEmpty() || vorschlaege.isNotEmpty())) {
                    OrtVorschlagListe(eigeneTreffer, vorschlaege, Modifier.platz(20f, 410f + ZEILE + 4f),
                        { o -> ortText = o.name; ortID = o.id; vorschlaege = emptyList(); ortOffen = false; fokusManager.clearFocus() }) { i ->
                        ortText = vorschlaege[i]; ortID = null; vorschlaege = emptyList(); ortOffen = false; fokusManager.clearFocus()
                    }
                }
                val fi = fokusFahrer
                if (fi != null && !listeZu && fi < fahrerNamen.size) {
                    val treffer = autoTreffer(fahrerNamen[fi], fahrerVorschlaege)
                    if (treffer.isNotEmpty()) {
                        VorschlagListe(treffer, Modifier.platz(20f, FAHRER_OBEN + fi * SCHRITT + ZEILE + 4f)) { n ->
                            listeZu = true
                            fahrerNamen = fahrerSetzen(fahrerNamen, fi, treffer[n])
                        }
                    }
                }
            }
        }
        Navileiste(DispoZiel.FAHRT_NEU, zeigen)
    }
}

/**
 * Standby bearbeiten (StandbyView.jsx, Stil wie Fahrt bearbeiten): Datum, Von, Bis, Ort, Fahrer #1, #2 ...
 * mit Zustand rechts in der Zeile, Notizen, Speichern, Standby loeschen. Geaenderte Zeiten bestaetigen
 * die Fahrer einzeln, neue Fahrer bekommen eine Anfrage, das Leeren-Zeichen nimmt einen raus.
 */
@Composable
fun StandbyBearbeitenSeite(standbyId: String, zurueck: () -> Unit, zeigen: (DispoZiel) -> Unit) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    val fokusManager = LocalFocusManager.current
    val sp = DispoStandbySpeicher
    LaunchedEffect(Unit) { sp.starten() }
    val s = sp.liste?.firstOrNull { it.id == standbyId }

    // Formularwerte: erst die gespeicherten, nach Aenderung die eigenen.
    var datum by remember { mutableStateOf<String?>(null) }
    var von by remember { mutableStateOf<String?>(null) }
    var bis by remember { mutableStateOf<String?>(null) }
    var notiz by remember { mutableStateOf<String?>(null) }
    var neue by remember { mutableStateOf(listOf("")) }
    var meldung by remember { mutableStateOf("") }
    var speichert by remember { mutableStateOf(false) }
    var wegFrage by remember { mutableStateOf<SbFahrer?>(null) }
    var loeschFrage by remember { mutableStateOf(false) }
    var fahrerAlle by remember { mutableStateOf(emptyList<FahrtSpeichern.FahrerEintrag>()) }
    var fokusNeu by remember { mutableStateOf<Int?>(null) }
    var listeZu by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) { fahrerAlle = FahrtSpeichern.fahrerLaden() }
    val fahrerVorschlaege = remember(fahrerAlle) { FahrtSpeichern.fahrerVorschlaege(fahrerAlle) }

    Box(Modifier.fillMaxSize().background(Color.Black).blockieren().imePadding()) {
        if (s == null) {
            DispoHintergrund()
            ZurueckKnopf(Modifier.platz(20f, 60f), zurueck)
            if (sp.liste != null) Text("Standby nicht mehr vorhanden.", style = grotesk(18f, 700, farbe = LIME), modifier = Modifier.platz(20f, 140f, 362f))
            Navileiste(DispoZiel.FAHRTEN, zeigen)
            return@Box
        }
        val wDatum = datum ?: s.d.datum.take(10)
        val wVon = von ?: hm(s.d.von)
        val wBis = bis ?: hm(s.d.bis)
        val wNotiz = notiz ?: s.d.notiz.orEmpty()

        fun speichern() {
            if (speichert) return
            speichert = true; meldung = ""
            scope.launch {
                try {
                    var zeitGeaendert = false
                    val aenderung = buildJsonObject {
                        if (wDatum != s.d.datum.take(10)) { put("datum", wDatum); zeitGeaendert = true }
                        if (wVon != hm(s.d.von)) { put("von", wVon); zeitGeaendert = true }
                        if (wBis != hm(s.d.bis)) { put("bis", wBis); zeitGeaendert = true }
                        if (wNotiz != s.d.notiz.orEmpty()) put("notiz", wNotiz.ifBlank { null }?.let { JsonPrimitive(it) } ?: JsonNull)
                    }
                    if (aenderung.isNotEmpty()) {
                        val f = sp.aendern(s.id, aenderung)
                        if (f.isNotEmpty()) { meldung = "Nicht gespeichert: $f"; return@launch }
                    }
                    val namen = neue.map { it.trim() }.filter { it.isNotEmpty() }
                    if (namen.isNotEmpty()) {
                        val alle = if (fahrerAlle.isEmpty()) FahrtSpeichern.fahrerLaden().also { fahrerAlle = it } else fahrerAlle
                        val ids = mutableListOf<String>()
                        for (n in namen) {
                            val id = FahrtSpeichern.fahrerID(n, alle)
                            if (id == null) { meldung = "Fahrer „$n“ nicht gefunden."; return@launch }
                            ids += id
                        }
                        val f = sp.fahrerDazu(s.id, ids)
                        if (f.isNotEmpty()) { meldung = "Fahrer nicht gespeichert: $f"; return@launch }
                    }
                    datum = null; von = null; bis = null; notiz = null; neue = listOf("")
                    meldung = if (zeitGeaendert) "Gespeichert, die Fahrer bestätigen die neuen Zeiten." else "Gespeichert."
                } finally {
                    speichert = false
                }
            }
        }

        val alleZeilen = s.fahrer.size + neue.size
        val notizOben = FAHRER_OBEN + (alleZeilen - 1) * SCHRITT + ZEILE + 24f
        val ctaOben = notizOben + 224f + 24f
        val loeschOben = ctaOben + ZEILE + 16f
        val hoehe = loeschOben + ZEILE + (if (meldung.isNotEmpty()) 70f else 40f) + 151f
        fun nummer(i: Int) = if (alleZeilen > 1) FahrtText.tr("fahrt.fahrerNumbered", mapOf("n" to "${i + 1}")) else FahrtText.tr("fahrt.fahrer")

        Box(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
            Box(Modifier.fillMaxWidth().height(hoehe.dp)) {
                DispoHintergrund(Modifier.fillMaxWidth().height(hoehe.dp))
                ZurueckKnopf(Modifier.platz(20f, 60f), zurueck)
                Text("Standby", style = css(42f, 700, 42f, farbe = LIME), modifier = Modifier.platz(20f, 140f, 320f))

                FormularZeile("Datum", wDatum, Modifier.platz(20f, 206f, 362f, ZEILE), zuruecksetzen = { datum = "" }) {
                    ZeilenWert(datumText(wDatum)) { fokusManager.clearFocus(); datumWaehlen(ctx, wDatum) { datum = it } }
                }
                FormularZeile("Von", wVon, Modifier.platz(20f, 274f, 362f, ZEILE), zuruecksetzen = { von = "" }) {
                    ZeilenWert(wVon) { fokusManager.clearFocus(); zeitWaehlen(ctx, minuten(wVon)) { von = it } }
                }
                FormularZeile("Bis", wBis, Modifier.platz(20f, 342f, 362f, ZEILE), zuruecksetzen = { bis = "" }) {
                    ZeilenWert(wBis) { fokusManager.clearFocus(); zeitWaehlen(ctx, minuten(wBis)) { bis = it } }
                }
                FormularZeile("Ort", s.d.ort_name, Modifier.platz(20f, 410f, 362f, ZEILE), rechts = RechtsArt.PFEIL, zuruecksetzen = {}) {
                    Text(s.d.ort_name, style = grotesk(16f, 500, abstand = 0.5f, farbe = LIME), maxLines = 1, overflow = TextOverflow.Ellipsis)
                }

                s.fahrer.forEachIndexed { i, f ->
                    key(f.driverId) {
                        val (text, farbe) = zustandAnzeige(f)
                        val farbeLong = farbe.toArgb().toLong() and 0xFFFFFF
                        FormularZeile(nummer(i), f.profil?.kurz ?: "Fahrer", Modifier.platz(20f, FAHRER_OBEN + i * SCHRITT, 362f, ZEILE),
                            eta = EtaMarke(text, farbeLong), zuruecksetzen = { wegFrage = f }) {
                            Text(f.profil?.kurz ?: "Fahrer", style = grotesk(16f, 500, abstand = 0.5f, farbe = LIME), maxLines = 1, overflow = TextOverflow.Ellipsis)
                        }
                    }
                }
                neue.forEachIndexed { j, n ->
                    key("neu-$j") {
                        val i = s.fahrer.size + j
                        FormularZeile(nummer(i), n, Modifier.platz(20f, FAHRER_OBEN + i * SCHRITT, 362f, ZEILE), zuruecksetzen = { neue = fahrerSetzen(neue, j, "") }) {
                            ZeilenEingabe(n, { listeZu = false; neue = fahrerSetzen(neue, j, it) },
                                Modifier.onFocusChanged { if (it.isFocused) fokusNeu = j else if (fokusNeu == j) fokusNeu = null })
                        }
                    }
                }

                NotizFeld(wNotiz, { notiz = it }, Modifier.platz(0f, notizOben, 402f, 224f))

                FormularSpeichernKnopf(if (speichert) FahrtText.tr("fahrt.saving") else "Speichern", speichert, Modifier.platz(20f, ctaOben, 362f, ZEILE)) { speichern() }
                Box(
                    Modifier.platz(20f, loeschOben, 362f, ZEILE).background(hex(0x221313)).border(2.dp, hex(0xF55757)).tippen { loeschFrage = true },
                    contentAlignment = Alignment.Center,
                ) { Text("Standby löschen", style = css(16f, 500, abstand = 0.4f, farbe = hex(0xF55757))) }
                if (meldung.isNotEmpty()) {
                    Text(meldung, style = grotesk(13f, 700, farbe = Color.White.copy(alpha = 0.7f)), modifier = Modifier.platz(20f, loeschOben + ZEILE + 12f, 362f))
                }

                val fn = fokusNeu
                if (fn != null && !listeZu && fn < neue.size) {
                    val treffer = autoTreffer(neue[fn], fahrerVorschlaege)
                    if (treffer.isNotEmpty()) {
                        VorschlagListe(treffer, Modifier.platz(20f, FAHRER_OBEN + (s.fahrer.size + fn) * SCHRITT + ZEILE + 4f)) { k ->
                            listeZu = true
                            neue = fahrerSetzen(neue, fn, treffer[k])
                        }
                    }
                }
            }
        }
        Navileiste(DispoZiel.FAHRTEN, zeigen)

        wegFrage?.let { f ->
            Rueckfrage("${f.name} aus dem Standby nehmen?", ok = {
                wegFrage = null
                scope.launch {
                    val e = sp.fahrerWeg(s.id, f.driverId)
                    meldung = if (e.isNotEmpty()) "Nicht gespeichert: $e" else "${f.name} ist raus."
                }
            }, abbrechen = { wegFrage = null })
        }
        if (loeschFrage) {
            Rueckfrage("Standby ${s.d.ort_name} löschen? Alle Fahrer bekommen „Standby zurückgezogen“.", ok = {
                loeschFrage = false
                scope.launch {
                    val e = sp.loeschen(s.id)
                    if (e.isNotEmpty()) meldung = "Nicht gelöscht: $e" else zurueck()
                }
            }, abbrechen = { loeschFrage = false })
        }
    }
}

/** Kurzer Tag fuer die Kacheln: "Heute" oder "Mi., 12.11.". */
internal fun tagKurz(iso: String): String {
    if (iso == heuteBerlin()) return "Heute"
    val d = runCatching { LocalDate.parse(iso) }.getOrNull() ?: return iso
    val w = d.format(java.time.format.DateTimeFormatter.ofPattern("EE", java.util.Locale.GERMAN))
    return "$w, ${d.format(java.time.format.DateTimeFormatter.ofPattern("dd.MM."))}"
}

/** Standby-Kacheln oben in Alle Fahrten (StandbyKacheln.jsx): Ort, Tag, von–bis, angenommen und Zustaende. */
@Composable
fun StandbyKacheln(modifier: Modifier, oeffnen: (String) -> Unit) {
    val sp = DispoStandbySpeicher
    LaunchedEffect(Unit) { sp.starten() }
    val aktuell = (sp.liste ?: emptyList()).filter(::standbyAktuell)
    if (aktuell.isEmpty()) return
    Column(modifier.width(362.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        for (s in aktuell) {
            key(s.id) {
                val ja = s.fahrer.filter { it.zeile.status == "accepted" }
                fun n(z: String) = ja.count { it.zeile.zustand == z }
                Box(Modifier.width(362.dp).background(hex(0x1A1A1A)).border(2.dp, SB_LIME).tippen { oeffnen(s.id) }) {
                    Column(Modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, top = 44.dp, bottom = 14.dp)) {
                        Text(s.d.ort_name, style = grotesk(22f, 700, farbe = Color.White), maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Text("${tagKurz(s.d.datum.take(10))} ${hm(s.d.von)} – ${hm(s.d.bis)}", style = grotesk(30f, 700, zeilenHoehe = 34f, farbe = SB_LIME))
                        Text("${ja.size}/${s.fahrer.size} angenommen · ${n("vor_ort")} vor Ort · ${n("mit_gast")} mit Gast · ${n("rueckweg")} Rückweg",
                            style = grotesk(13f, 700, farbe = SB_GRAU), modifier = Modifier.padding(top = 6.dp))
                    }
                    Box(Modifier.align(Alignment.TopCenter).height(30.dp).background(SB_LIME).padding(horizontal = 16.dp), contentAlignment = Alignment.Center) {
                        Text("Standby", style = grotesk(16f, 700, farbe = Color.Black))
                    }
                }
            }
        }
    }
}

/**
 * Standby-Fahrten in Alle Fahrten (StandbyFahrten.jsx): faehrt ein Fahrer vom Event los, erscheint eine
 * "Standby-Fahrt" mit Abfahrtszeit, Status Unterwegs (orange) bzw. Rueckweg mit Ankunft am Event,
 * danach "Zurück" mit Uhrzeit. Tipp oeffnet den Standby.
 */
@Composable
fun StandbyFahrten(modifier: Modifier, oeffnen: (String) -> Unit) {
    val ctx = LocalContext.current
    val sp = DispoStandbySpeicher
    LaunchedEffect(Unit) { sp.starten() }
    val aktuell = (sp.liste ?: emptyList()).filter(::standbyAktuell)
    val fahrten = remember(sp.ereignisse) { fahrtenBilden(sp.ereignisse) }
    val rueckSchluessel = fahrten.filter { it.status == "rueckweg" }.joinToString(",") { it.id }
    // Ankunft am Event: jede Minute neu, solange jemand auf dem Rueckweg ist.
    LaunchedEffect(rueckSchluessel) {
        if (rueckSchluessel.isEmpty()) return@LaunchedEffect
        while (true) { sp.ankunftRechnen(ctx); delay(60_000) }
    }
    if (fahrten.isEmpty()) return
    val sortiert = fahrten.sortedByDescending { zeitpunkt(it.start) ?: java.time.Instant.EPOCH }
    Column(modifier.width(362.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        for (f in sortiert) {
            key(f.id) {
                val s = aktuell.firstOrNull { it.id == f.standbyId }
                val p = s?.fahrer?.firstOrNull { it.driverId == f.driverId }?.profil
                val ankunft = sp.ankunft[f.id]
                val (text, farbe) = when (f.status) {
                    "unterwegs" -> "Unterwegs" to SB_ORANGE
                    "rueckweg" -> (if (ankunft != null) "Rückweg · an ${uhrIso(ankunft.toString())}" else "Rückweg") to SB_GRUEN
                    else -> (if (f.zurueck != null) "Zurück ${uhrIso(f.zurueck)}" else "Beendet") to SB_GRAU
                }
                Row(Modifier.width(362.dp).background(Color.White).tippen { oeffnen(f.standbyId) }.padding(horizontal = 16.dp, vertical = 12.dp),
                    horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    Column(Modifier.weight(1f)) {
                        Text("Standby-Fahrt", style = grotesk(22f, 700, zeilenHoehe = 26f, farbe = hex(0x1D1C1D)))
                        Text("${s?.d?.ort_name ?: "Event"} – ${if (f.abgesetzt != null) "abgesetzt ${uhrIso(f.abgesetzt)}" else "Ziel offen"}",
                            style = grotesk(13f, 500, farbe = hex(0x1D1C1D, 0.7f)), modifier = Modifier.padding(top = 4.dp), maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Text(p?.kurz ?: "Fahrer", style = grotesk(15f, 700, farbe = hex(0x1D1C1D)), modifier = Modifier.padding(top = 10.dp))
                    }
                    Column(horizontalAlignment = Alignment.End) {
                        Text(uhrIso(f.start), style = grotesk(30f, 700, zeilenHoehe = 32f, farbe = SB_GRUEN))
                        Text(text, style = grotesk(12f, 700, farbe = farbe), modifier = Modifier.padding(top = 4.dp))
                    }
                }
            }
        }
    }
}
