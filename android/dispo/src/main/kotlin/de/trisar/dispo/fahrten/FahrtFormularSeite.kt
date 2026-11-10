package de.trisar.dispo.fahrten

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.ime
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import de.trisar.dispo.DispoZiel
import de.trisar.dispo.Navileiste
import de.trisar.dispo.einlesen.ImportModus
import de.trisar.dispo.einlesen.ImportSeite
import de.trisar.kern.DispoHintergrund
import de.trisar.kern.EigeneOrte
import de.trisar.kern.Ort
import de.trisar.kern.FussleisteUnten
import de.trisar.kern.Icon
import de.trisar.kern.ZurueckKnopf
import de.trisar.kern.grotesk
import de.trisar.kern.hex
import de.trisar.kern.platz
import de.trisar.kern.tippen
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * „Fahrt erstellen“ (FahrtAdd.jsx, fahrtID null) und „Fahrt bearbeiten“ (FahrtBearbeitenView.jsx),
 * wie FahrtFormularAnsicht.swift. Beim Bearbeiten wird die Fahrt erst geladen.
 * `zeigen`: Navileiste beim Anlegen und Ziel nach dem Anlegen (setView('ankuenfte') = Fahrten).
 */
@Composable
fun FahrtFormularSeite(
    fahrtID: String?, zurueck: () -> Unit, zeigen: ((DispoZiel) -> Unit)?,
    /** Vorschlag des KI-Assistenten: fuellt das Formular, Speichern bucht ihn. */
    vorlage: FahrtVorlage? = null,
    /** Statt der Fahrtenliste: zurueck in den Chat, mit der ID der neuen Fahrt. */
    nachAnlegen: ((String?) -> Unit)? = null,
) {
    if (fahrtID == null) {
        FormularInhalt(null, zurueck, zeigen, vorlage, nachAnlegen)
        return
    }
    var geladen by remember(fahrtID) { mutableStateOf<GeladeneFahrt?>(null) }
    var ladeFehler by remember(fahrtID) { mutableStateOf<String?>(null) }
    LaunchedEffect(fahrtID) {
        try { geladen = FahrtSpeichern.laden(fahrtID) } catch (e: kotlinx.coroutines.CancellationException) { throw e } catch (e: Exception) { ladeFehler = fehlerText(e) }
    }
    val g = geladen
    if (g != null) {
        FormularInhalt(g, zurueck, zeigen)
    } else {
        Box(Modifier.fillMaxSize().background(Color.Black).blockieren()) {
            DispoHintergrund()
            ZurueckKnopf(Modifier.platz(20f, 60f), zurueck)
            val f = ladeFehler
            if (f != null) Text(f, style = css(16f, 500, 24f, farbe = hex(0xF55757)), modifier = Modifier.platz(20f, 140f, 362f))
            else CircularProgressIndicator(color = LIME, modifier = Modifier.platz(20f, 140f, 40f, 40f))
            FussleisteUnten()
        }
    }
}

private enum class ZeilenArt { ADRESSE, STOPP, TEXT, ZAHL, AUSWAHL, FAHRER, GAST }

private fun stoppZeilen(werte: List<String>): List<String> {
    val gefuellt = werte.filter { FahrtText.getrimmt(it).isNotEmpty() }.take(8)
    return if (gefuellt.size < 8) gefuellt + "" else gefuellt
}
private fun istAdressFeld(id: String) = id == "start" || id == "ziel" || id.startsWith("stopp-")
private fun stoppIndex(feld: String) = if (feld.startsWith("stopp-")) feld.removePrefix("stopp-").toIntOrNull() else null

private data class ZeilenDaten(val id: String, val beschriftung: String, val art: ZeilenArt, val index: Int = 0)

private data class FlugAnfrage(val nummer: String, val datum: String, val start: String, val flughafen: String, val ankunft: String, val uebernommen: String)
private data class ZugAnfrage(val nummer: String, val datum: String, val start: String, val uebernommen: String)

private val statusWerte = listOf("offen", "beendet", "stoniert", "unterwegs")

@Composable
private fun FormularInhalt(
    geladen: GeladeneFahrt?, zurueck: () -> Unit, zeigen: ((DispoZiel) -> Unit)?,
    vorlage: FahrtVorlage? = null, nachAnlegen: ((String?) -> Unit)? = null,
) {
    // Raster aus FahrtAdd.jsx: Titel 140, Felder ab 206, Reihen alle 68, Zeilenhoehe 56.
    val reihenStart = 410f
    val schritt = 68f
    val zeilenHoehe = 56f

    var werte by remember { mutableStateOf(geladen?.werte ?: vorlage?.werte ?: FahrtFormularWerte()) }
    var notiz by remember { mutableStateOf(geladen?.notiz ?: vorlage?.notiz ?: "") }
    var fahrerNamen by remember { mutableStateOf((geladen?.fahrerNamen ?: vorlage?.fahrerNamen ?: emptyList()).ifEmpty { listOf("") }) }
    var gaesteNamen by remember { mutableStateOf(FahrtText.gaesteTeilen(geladen?.fahrgaeste ?: vorlage?.fahrgaeste) + "") }
    var zwischenstopps by remember { mutableStateOf(stoppZeilen(geladen?.zwischenstopps ?: emptyList())) }
    var adressHinweis by remember { mutableStateOf<String?>(null) }
    var speichert by remember { mutableStateOf(false) }

    var vorschlaege by remember { mutableStateOf<Map<String, List<String>>>(mapOf("start" to emptyList(), "ziel" to emptyList())) }
    var aktivesAdressFeld by remember { mutableStateOf<String?>(null) }
    var vorschlagLauf by remember { mutableStateOf<Job?>(null) }
    var vorschlagNr by remember { mutableIntStateOf(0) }

    var flugEta by remember { mutableStateOf(EtaMarke()) }
    var flugPruefung by remember { mutableStateOf(FahrtPruefung.Anzeige.leer) }
    var flugUebernommen by remember { mutableStateOf("") }
    var flugKandidaten by remember { mutableStateOf(emptyList<FahrtPruefung.FlugKandidat>()) }
    var kandidatenOffen by remember { mutableStateOf(false) }
    var flughafenWahl by remember { mutableStateOf("") }
    var ankunftWahl by remember { mutableStateOf("") }
    var zugEta by remember { mutableStateOf(EtaMarke()) }
    var zugPruefung by remember { mutableStateOf(FahrtPruefung.Anzeige.leer) }
    var zugUebernommen by remember { mutableStateOf("") }

    var fahrerListe by remember { mutableStateOf(emptyList<String>()) }
    var gastListe by remember { mutableStateOf(emptyList<String>()) }
    var listenLaden by remember { mutableStateOf(true) }
    var autoListeZu by remember { mutableStateOf(false) }

    var meldung by remember { mutableStateOf<String?>(null) }
    var stornoFrage by remember { mutableStateOf(false) }
    var statusOffen by remember { mutableStateOf(false) }
    /** Sammel-Import (setView('importFahrten')), als Vollbild ueber dem Formular. */
    var importOffen by androidx.compose.runtime.saveable.rememberSaveable { mutableStateOf(false) }
    var fokus by remember { mutableStateOf<String?>(null) }

    val ctx = LocalContext.current
    val fokusManager = LocalFocusManager.current
    val scope = rememberCoroutineScope()
    val rollen = rememberScrollState()
    val dichte = LocalDensity.current
    val notizFokus = remember { FocusRequester() }

    val bearbeiten = geladen != null
    fun t(k: String, w: Map<String, String> = emptyMap()) = FahrtText.tr(k, w)

    // MARK: Abgeleitete Werte

    val mitFahrzeugen = FahrtText.getrimmt(werte.konvoi).isNotEmpty()
    val fahrerAnzahl = if (mitFahrzeugen) maxOf(1, werte.anzahlFahrzeuge.toIntOrNull() ?: 1) else 1
    val gefuellteGaeste = gaesteNamen.map { FahrtText.getrimmt(it) }.filter { it.isNotEmpty() }
    val flugNr = FahrtText.nummer(werte.flugnummer)
    val zugNr = FahrtText.nummer(werte.zugnummer)
    val flugAngewandt = flugUebernommen.isNotEmpty() && flugNr == flugUebernommen
    val zugAngewandt = zugUebernommen.isNotEmpty() && zugNr == zugUebernommen
    val kannFlug = flugNr.isNotEmpty() && (flugPruefung.gueltig || flugPruefung.status in setOf("ok", "unknown_eta"))
    val kannZug = zugNr.isNotEmpty() && (zugPruefung.gueltig || zugPruefung.status in setOf("ok", "unknown_eta"))

    val gefuellteStopps = zwischenstopps.map { FahrtText.getrimmt(it) }.filter { it.isNotEmpty() }
    val stoppsSichtbar = FahrtText.getrimmt(werte.start).isNotEmpty()

    val reihen = buildList {
        if (stoppsSichtbar) zwischenstopps.indices.forEach { i ->
            add(ZeilenDaten("stopp-$i", if (i == 0) t("fahrt.zwischenstopp") else t("fahrt.zwischenstoppNumbered", mapOf("n" to "${i + 1}")), ZeilenArt.STOPP, i))
        }
        add(ZeilenDaten("ziel", t("fahrt.ziel"), ZeilenArt.ADRESSE))
        add(ZeilenDaten("flugnummer", t("fahrt.flugnummer"), ZeilenArt.TEXT))
        add(ZeilenDaten("zugnummer", t("fahrt.zugnummer"), ZeilenArt.TEXT))
        add(ZeilenDaten("konvoi", t("fahrt.konvoi"), ZeilenArt.TEXT))
        if (mitFahrzeugen) add(ZeilenDaten("anzahlFahrzeuge", t("fahrt.anzahlFahrzeuge"), ZeilenArt.ZAHL))
        for (i in fahrerNamen.indices) {
            add(ZeilenDaten("fahrer-$i", if (mitFahrzeugen || fahrerNamen.size > 1) t("fahrt.fahrerNumbered", mapOf("n" to "${i + 1}")) else t("fahrt.fahrer"), ZeilenArt.FAHRER, i))
        }
        gaesteNamen.forEachIndexed { i, name ->
            val titel = if (i == 0) (if (FahrtText.getrimmt(name).isEmpty()) t("fahrt.fahrgaeste") else t("fahrt.gastNumbered", mapOf("n" to "1")))
            else t("fahrt.gastNumbered", mapOf("n" to "${i + 1}"))
            add(ZeilenDaten("fahrgast-$i", titel, ZeilenArt.GAST, i))
        }
        add(ZeilenDaten("anonymeGaeste", t("fahrt.anonymeGaeste"), ZeilenArt.ZAHL))
        add(ZeilenDaten("anzahlKinder", t("fahrt.anzahlKinder"), ZeilenArt.ZAHL))
        add(ZeilenDaten("aktuellerStatus", t("fahrt.aktuellerStatus"), ZeilenArt.AUSWAHL))
    }

    // MARK: Aenderungen

    fun gaesteSetzen(neu: List<String>) {
        // normalizeGuestRows: gefuellte Zeilen + eine leere. Der Text bleibt beim Tippen ungetrimmt.
        gaesteNamen = neu.filter { FahrtText.getrimmt(it).isNotEmpty() } + ""
    }

    fun adressEingabe(text: String, feld: String) {
        // Frei weitergetippt: die Zuordnung zum eigenen Ort faellt weg.
        val stopp = stoppIndex(feld)
        if (stopp != null) { if (stopp < zwischenstopps.size) zwischenstopps = stoppZeilen(zwischenstopps.toMutableList().also { it[stopp] = text }) }
        else werte = if (feld == "start") werte.copy(start = text, startOrtID = "") else werte.copy(ziel = text, zielOrtID = "")
        vorschlagLauf?.cancel()
        val suche = FahrtText.getrimmt(text)
        if (suche.isEmpty()) {
            vorschlaege = vorschlaege + (feld to emptyList())
            if (aktivesAdressFeld == feld) aktivesAdressFeld = null
            return
        }
        aktivesAdressFeld = feld
        vorschlagNr += 1
        val nr = vorschlagNr
        // fetchAddressPredictions: 250 ms warten, nur das juengste Ergebnis zaehlt.
        vorschlagLauf = scope.launch {
            delay(250)
            val treffer = FahrtPruefung.ortsVorschlaege(suche)
            if (nr == vorschlagNr) vorschlaege = vorschlaege + (feld to treffer)
        }
    }

    fun adresseWaehlen(wert: String, feld: String) {
        val stopp = stoppIndex(feld)
        if (stopp != null) { if (stopp < zwischenstopps.size) zwischenstopps = stoppZeilen(zwischenstopps.toMutableList().also { it[stopp] = wert }) }
        else werte = if (feld == "start") werte.copy(start = wert, startOrtID = "") else werte.copy(ziel = wert, zielOrtID = "")
        vorschlaege = vorschlaege + (feld to emptyList())
        aktivesAdressFeld = null
    }

    /** Eigener Ort gewaehlt: im Feld steht sein Name, beim Speichern kommen Name, Adresse und id in die Fahrt. */
    fun ortWaehlen(ort: Ort, feld: String) {
        vorschlagLauf?.cancel()
        val stopp = stoppIndex(feld)
        if (stopp != null) { if (stopp < zwischenstopps.size) zwischenstopps = stoppZeilen(zwischenstopps.toMutableList().also { it[stopp] = ort.adresse.ifEmpty { ort.name } }) }
        else werte = if (feld == "start") werte.copy(start = ort.name, startOrtID = ort.id) else werte.copy(ziel = ort.name, zielOrtID = ort.id)
        vorschlaege = vorschlaege + (feld to emptyList())
        aktivesAdressFeld = null
    }

    fun setzen(id: String, neu: String) {
        werte = when (id) {
            "flugnummer" -> werte.copy(flugnummer = neu)
            "zugnummer" -> werte.copy(zugnummer = neu)
            "konvoi" -> werte.copy(konvoi = neu)
            "anzahlFahrzeuge" -> werte.copy(anzahlFahrzeuge = neu)
            "anonymeGaeste" -> werte.copy(anonymeGaeste = neu)
            "anzahlKinder" -> werte.copy(anzahlKinder = neu)
            else -> werte
        }
    }

    fun lesen(z: ZeilenDaten): String = when (z.art) {
        ZeilenArt.FAHRER -> fahrerNamen.getOrElse(z.index) { "" }
        ZeilenArt.GAST -> gaesteNamen.getOrElse(z.index) { "" }
        ZeilenArt.STOPP -> zwischenstopps.getOrElse(z.index) { "" }
        else -> when (z.id) {
            "ziel" -> werte.ziel
            "flugnummer" -> werte.flugnummer
            "zugnummer" -> werte.zugnummer
            "konvoi" -> werte.konvoi
            "anzahlFahrzeuge" -> werte.anzahlFahrzeuge
            "anonymeGaeste" -> werte.anonymeGaeste
            "anzahlKinder" -> werte.anzahlKinder
            else -> ""
        }
    }

    /** onChange der Reihen im Web. */
    fun aendern(z: ZeilenDaten, roh: String) {
        when (z.art) {
            ZeilenArt.STOPP -> adressEingabe(roh, z.id)
            ZeilenArt.FAHRER -> { autoListeZu = false; if (z.index < fahrerNamen.size) fahrerNamen = fahrerNamen.toMutableList().also { it[z.index] = roh } }
            ZeilenArt.GAST -> { autoListeZu = false; if (z.index < gaesteNamen.size) gaesteSetzen(gaesteNamen.toMutableList().also { it[z.index] = roh }) }
            else -> {
                val neu = if (z.art == ZeilenArt.ZAHL) roh.filter { it.isDigit() } else roh
                when (z.id) {
                    "ziel" -> adressEingabe(neu, "ziel")
                    "konvoi" -> werte = if (FahrtText.getrimmt(neu).isEmpty()) werte.copy(konvoi = "", anzahlFahrzeuge = "") else werte.copy(konvoi = neu)
                    else -> {
                        if (z.id == "flugnummer") flugUebernommen = ""
                        if (z.id == "zugnummer") zugUebernommen = ""
                        setzen(z.id, neu)
                    }
                }
            }
        }
    }

    fun zuruecksetzen(z: ZeilenDaten) {
        when (z.art) {
            ZeilenArt.STOPP -> { adresseWaehlen("", z.id) }
            ZeilenArt.FAHRER -> if (z.index < fahrerNamen.size) fahrerNamen = fahrerNamen.toMutableList().also { it[z.index] = "" }
            ZeilenArt.GAST -> if (z.index < gaesteNamen.size) gaesteSetzen(gaesteNamen.toMutableList().also { it[z.index] = "" })
            else -> when (z.id) {
                "ziel" -> { werte = werte.copy(ziel = "", zielOrtID = ""); vorschlaege = vorschlaege + ("ziel" to emptyList()) }
                "konvoi" -> werte = werte.copy(konvoi = "", anzahlFahrzeuge = "")
                else -> {
                    if (z.id == "flugnummer") flugUebernommen = ""
                    if (z.id == "zugnummer") zugUebernommen = ""
                    setzen(z.id, "")
                }
            }
        }
    }

    /** handleFlightAction: Haken uebernimmt ETA und Ankunftsort, Kreuz leert die Flugnummer. */
    fun flugAnwenden() {
        if (flugAngewandt) { flugUebernommen = ""; werte = werte.copy(flugnummer = ""); return }
        if (!kannFlug) return
        val eta = FahrtText.getrimmt(flugPruefung.etaLabel)
        val ort = FahrtText.getrimmt(flugPruefung.startOrt)
        val zeit = if (eta.isNotEmpty() && eta != "NaN") eta else ""
        if (zeit.isEmpty() && ort.isEmpty()) { meldung = t("fahrt.flightMissingEta"); return }
        if (zeit.isNotEmpty()) werte = werte.copy(startZeit = zeit)
        if (ort.isNotEmpty()) werte = werte.copy(start = ort, startOrtID = "")
        flugUebernommen = flugNr
    }

    fun zugAnwenden() {
        if (zugAngewandt) { zugUebernommen = ""; werte = werte.copy(zugnummer = ""); return }
        if (!kannZug) return
        val eta = FahrtText.getrimmt(zugPruefung.etaLabel)
        val ort = FahrtText.getrimmt(zugPruefung.startOrt)
        val zeit = if (eta.isNotEmpty() && eta != "NaN") eta else ""
        if (zeit.isEmpty() && ort.isEmpty()) { meldung = t("fahrt.trainMissingEta"); return }
        if (zeit.isNotEmpty()) werte = werte.copy(startZeit = zeit)
        if (ort.isNotEmpty()) werte = werte.copy(start = ort, startOrtID = "")
        zugUebernommen = zugNr
    }

    fun fokusGewechselt(alt: String?, neu: String?) {
        if (neu != null && istAdressFeld(neu)) aktivesAdressFeld = neu
        if (alt != null && istAdressFeld(alt) && neu != alt) {
            // onBlur mit 120 ms Verzoegerung wie im Web.
            scope.launch { delay(120); if (aktivesAdressFeld == alt) aktivesAdressFeld = null }
        }
        if (neu != null) autoListeZu = false
    }

    fun fokusModifier(id: String): Modifier = Modifier.onFocusChanged { s ->
        if (s.isFocused && fokus != id) { val alt = fokus; fokus = id; fokusGewechselt(alt, id) }
        else if (!s.isFocused && fokus == id) { fokus = null; fokusGewechselt(id, null) }
    }

    // MARK: Pruefen und Laden (useEffects im Web)

    // Fahrer eingetragen: darunter eine freie Zeile, bei Kolonne mindestens so viele wie Fahrzeuge.
    LaunchedEffect(fahrerAnzahl, fahrerNamen) {
        val neu = fahrerNamen.filter { FahrtText.getrimmt(it).isNotEmpty() }.toMutableList().also { l ->
            l += ""
            while (l.size < fahrerAnzahl) l += ""
        }
        if (neu != fahrerNamen) fahrerNamen = neu
    }
    var letzteFlugnummer by remember { mutableStateOf(werte.flugnummer) }
    LaunchedEffect(werte.flugnummer) {
        if (werte.flugnummer != letzteFlugnummer) {
            letzteFlugnummer = werte.flugnummer
            flughafenWahl = ""
            ankunftWahl = ""
            kandidatenOffen = false
        }
    }
    /** gespeicherteZeitFuer: Zeit der Fahrt zeigen, solange die Nummer unveraendert ist (nur Bearbeiten). */
    fun gespeicherteZeit(nummer: String, gespeichert: String?): String {
        val n = FahrtText.nummer(nummer)
        if (n.isEmpty() || n != FahrtText.nummer(gespeichert)) return ""
        return FahrtText.uhrzeit(geladen?.werte?.startZeit, "")
    }
    LaunchedEffect(FlugAnfrage(werte.flugnummer, werte.datum, werte.start, flughafenWahl, ankunftWahl, flugUebernommen)) {
        val wert = FahrtText.getrimmt(werte.flugnummer)
        if (wert.isEmpty()) {
            flugEta = EtaMarke(); flugPruefung = FahrtPruefung.Anzeige.leer; flugUebernommen = ""
            flugKandidaten = emptyList(); kandidatenOffen = false
            return@LaunchedEffect
        }
        delay(350)
        val r = FahrtPruefung.flugAnzeige(wert, werte.datum, flughafenWahl.ifEmpty { werte.start }, ankunftWahl)
        flugPruefung = r
        if (r.status == "multi") flugKandidaten = r.kandidaten else { flugKandidaten = emptyList(); kandidatenOffen = false }
        val eta = FahrtText.getrimmt(r.etaLabel)
        flugEta = when {
            r.status == "ok" && eta.isNotEmpty() -> EtaMarke(eta, 0x808080)
            r.status == "multi" -> EtaMarke("Multi", 0xF55757)
            r.status == "unavailable" && !bearbeiten -> EtaMarke(if (eta.isEmpty()) "" else "Srv", 0xFFB84D)
            r.status == "unavailable" && eta.isEmpty() -> EtaMarke(gespeicherteZeit(wert, geladen?.werte?.flugnummer), 0x808080)
            else -> EtaMarke(eta.ifEmpty { "NaN" }, 0xF55757)
        }
        if (flugUebernommen.isNotEmpty() && FahrtText.nummer(wert) != flugUebernommen) flugUebernommen = ""
    }
    LaunchedEffect(ZugAnfrage(werte.zugnummer, werte.datum, werte.start, zugUebernommen)) {
        val wert = FahrtText.getrimmt(werte.zugnummer)
        if (wert.isEmpty()) {
            zugEta = EtaMarke(); zugPruefung = FahrtPruefung.Anzeige.leer; zugUebernommen = ""
            return@LaunchedEffect
        }
        delay(350)
        val r = FahrtPruefung.zugAnzeige(wert, werte.datum, werte.start)
        zugPruefung = r
        val eta = FahrtText.getrimmt(r.etaLabel)
        zugEta = when {
            r.status == "ok" && eta.isNotEmpty() -> EtaMarke(eta, 0x808080)
            r.status == "unavailable" -> EtaMarke(if (bearbeiten) gespeicherteZeit(wert, geladen?.werte?.zugnummer) else "", 0x808080)
            r.status == "multi" -> EtaMarke("Multi", 0xF55757)
            else -> EtaMarke("NaN", 0xF55757)
        }
        if (zugUebernommen.isNotEmpty() && FahrtText.nummer(wert) != zugUebernommen) zugUebernommen = ""
    }
    LaunchedEffect(Unit) { EigeneOrte.laden() }
    LaunchedEffect(Unit) {
        val fahrer = async { FahrtSpeichern.fahrerLaden() }
        val gaeste = async { FahrtSpeichern.gaesteLaden() }
        fahrerListe = FahrtSpeichern.fahrerVorschlaege(fahrer.await())
        gastListe = FahrtSpeichern.gastVorschlaege(gaeste.await())
        listenLaden = false
    }

    // MARK: Speichern

    fun speichern(geprueft: Boolean = false) {
        if (speichert) return
        // Adressen vor dem Speichern pruefen, faellt die Pruefung aus, wird normal gespeichert.
        if (!geprueft && FahrtText.getrimmt(werte.start).isNotEmpty() && FahrtText.getrimmt(werte.ziel).isNotEmpty()) {
            speichert = true
            scope.launch {
                val start = EigeneOrte.zuID(werte.startOrtID)?.adresse ?: werte.start
                val ziel = EigeneOrte.zuID(werte.zielOrtID)?.adresse ?: werte.ziel
                val hinweis = FahrtPruefung.adressWarnung(listOf(start) + gefuellteStopps + ziel)
                speichert = false
                if (hinweis.isNotEmpty()) adressHinweis = hinweis else speichern(geprueft = true)
            }
            return
        }
        if (!bearbeiten) {
            // handleCreateRide aus FahrtAdd.jsx.
            if (FahrtText.getrimmt(werte.start).isEmpty() || FahrtText.getrimmt(werte.ziel).isEmpty()) { meldung = t("fahrt.fillStartZiel"); return }
            speichert = true
            val w = werte.copy(anonymeGaeste = werte.anonymeGaeste.ifEmpty { "0" })
            scope.launch {
                val e = FahrtSpeichern.anlegen(FahrtEingabe(w, gefuellteGaeste.joinToString("; "), fahrerNamen, flughafenWahl, ankunftWahl, notiz, gefuellteStopps, aiBooked = vorlage != null))
                speichert = false
                if (!e.ok) { meldung = t("fahrt.saveError", mapOf("error" to (e.fehler ?: t("fahrt.unknownError")))); return@launch }
                if (nachAnlegen != null) { nachAnlegen(e.id); return@launch }
                if (zeigen != null) zeigen(DispoZiel.FAHRTEN) else zurueck()
            }
        } else {
            // handleSave aus FahrtBearbeitenView.jsx.
            val g = geladen ?: return
            val plaetze = if (mitFahrzeugen) maxOf(1, FahrtText.getrimmt(werte.anzahlFahrzeuge).toIntOrNull() ?: 1) else 1
            val namen = fahrerNamen.map { FahrtText.getrimmt(it) }.filter { it.isNotEmpty() }.let { it + List(maxOf(0, plaetze - it.size)) { "" } }
            val w = werte.copy(
                konvoi = if (mitFahrzeugen) FahrtText.getrimmt(werte.konvoi) else "",
                anzahlFahrzeuge = if (mitFahrzeugen) FahrtText.getrimmt(werte.anzahlFahrzeuge) else "",
                anonymeGaeste = werte.anonymeGaeste.ifEmpty { "0" },
            )
            speichert = true
            scope.launch {
                val e = FahrtSpeichern.aendern(FahrtEingabe(w, gefuellteGaeste.joinToString("; "), namen, flughafenWahl, ankunftWahl, notiz, gefuellteStopps), g)
                speichert = false
                if (!e.ok) { meldung = t("fahrt.saveError", mapOf("error" to (e.fehler ?: t("fahrt.unknownError")))); return@launch }
                zurueck()
            }
        }
    }

    /** handleCancelRide: nach Rueckfrage loeschen (handleDeleteRide). */
    fun stornieren() {
        val g = geladen ?: return
        scope.launch {
            val e = FahrtSpeichern.loeschen(g.id)
            if (!e.ok) { meldung = e.fehler; return@launch }
            zurueck()
        }
    }

    // MARK: Ansicht

    val letzteReihe = reihenStart + (reihen.size - 1) * schritt
    val notizTop = letzteReihe + zeilenHoehe + 24
    val knopfTop = notizTop + 224 + 24
    val stornoTop = knopfTop + zeilenHoehe + 12
    val inhaltHoehe = if (bearbeiten) stornoTop + zeilenHoehe + 30 + 40 else knopfTop + zeilenHoehe + 30
    val tastatur = with(dichte) { WindowInsets.ime.getBottom(dichte).toDp().value }
    // pb-[151px] beim Anlegen: Platz fuer die Navileiste.
    val rollHoehe = (if (bearbeiten) inhaltHoehe else inhaltHoehe + 151) + (if (tastatur > 0) tastatur + 40 else 0f)

    val tastaturJetzt by rememberUpdatedState(tastatur)
    BoxWithConstraints(Modifier.fillMaxSize().background(Color.Black).blockieren()) {
        val bildHoehe = maxHeight.value
        // Feld bei 35 % der sichtbaren Hoehe ueber der Tastatur (zumFeldRollen in iOS).
        LaunchedEffect(fokus) {
            val f = fokus ?: return@LaunchedEffect
            val tops = HashMap<String, Float>()
            tops["start"] = 342f
            tops["notiz"] = notizTop + 40
            reihen.forEachIndexed { i, z -> tops[z.id] = reihenStart + i * schritt }
            val feldTop = tops[f] ?: return@LaunchedEffect
            delay(350)
            val sichtbar = bildHoehe - tastaturJetzt
            val ziel = maxOf(0f, feldTop - 0.35f * sichtbar)
            rollen.animateScrollTo(with(dichte) { ziel.dp.roundToPx() })
        }

        Box(Modifier.fillMaxSize().verticalScroll(rollen)) {
            Box(Modifier.fillMaxWidth().height(rollHoehe.dp)) {
                DispoHintergrund(Modifier.fillMaxWidth().height(inhaltHoehe.dp))
                // Kopf
                ZurueckKnopf(Modifier.platz(20f, 60f), zurueck)
                if (!bearbeiten && vorlage == null) {
                    // Sammel-Import aus Excel/CSV statt Einzelanlage (setView('importFahrten')).
                    Icon("import-fahrten", Modifier.platz(402f - 20f - 42f, 65f, 42f, 40f).tippen { importOffen = true })
                }
                Text(t(if (bearbeiten) "fahrt.editTitle" else "fahrt.createTitle"), style = css(42f, 700, 42f, farbe = LIME),
                    modifier = Modifier.platz(20f, 140f, if (bearbeiten) 400f else 320f))

                // Datum
                val datumText = FahrtText.fahrtDatum(werte.datum).split("-").let { if (it.size == 3) "${it[2]}.${it[1]}.${it[0]}" else "" }
                FormularZeile(t("fahrt.datum"), werte.datum, Modifier.platz(20f, 206f, 362f, 56f), zuruecksetzen = { werte = werte.copy(datum = "") }) {
                    ZeilenWert(datumText) {
                        fokusManager.clearFocus()
                        // Wie Safari: beim Oeffnen steht sofort der heutige Tag im Feld.
                        if (werte.datum.isEmpty()) werte = werte.copy(datum = FahrtText.heute())
                        datumWaehlen(ctx, FahrtText.fahrtDatum(werte.datum)) { werte = werte.copy(datum = it) }
                    }
                }
                // Startzeit
                FormularZeile(t("fahrt.startZeit"), werte.startZeit, Modifier.platz(20f, 274f, 362f, 56f), zuruecksetzen = { werte = werte.copy(startZeit = "") }) {
                    ZeilenWert(FahrtText.uhrzeit(werte.startZeit, "")) {
                        fokusManager.clearFocus()
                        if (FahrtText.uhrzeit(werte.startZeit, "").isEmpty()) werte = werte.copy(startZeit = FahrtText.jetztUhr())
                        zeitWaehlen(ctx, FahrtText.minuten(werte.startZeit)) { werte = werte.copy(startZeit = it) }
                    }
                }
                // Start
                FormularZeile(t("fahrt.start"), werte.start, Modifier.platz(20f, 342f, 362f, 56f), zuruecksetzen = {
                    werte = werte.copy(start = "", startOrtID = "")
                    vorschlaege = vorschlaege + ("start" to emptyList())
                }) {
                    ZeilenEingabe(werte.start, { adressEingabe(it, "start") }, fokusModifier("start"))
                }

                reihen.forEachIndexed { i, z ->
                    key(z.id) {
                        val m = Modifier.platz(20f, reihenStart + i * schritt, 362f, 56f)
                        if (z.art == ZeilenArt.AUSWAHL) {
                            FormularZeile(z.beschriftung, werte.aktuellerStatus, m, zuruecksetzen = { werte = werte.copy(aktuellerStatus = "") }) {
                                Box {
                                    ZeilenWert(statusText(werte.aktuellerStatus)) { fokusManager.clearFocus(); statusOffen = true }
                                    DunklesThema {
                                        DropdownMenu(statusOffen, { statusOffen = false }) {
                                            DropdownMenuItem({ Text("–") }, { werte = werte.copy(aktuellerStatus = ""); statusOffen = false })
                                            statusWerte.forEach { w ->
                                                DropdownMenuItem({ Text(statusText(w)) }, { werte = werte.copy(aktuellerStatus = w); statusOffen = false })
                                            }
                                        }
                                    }
                                }
                            }
                        } else {
                            val eta = if (z.id == "flugnummer" && flugNr.isNotEmpty()) flugEta else if (z.id == "zugnummer" && zugNr.isNotEmpty()) zugEta else null
                            val etaAktion: (() -> Unit)? = if (z.id == "flugnummer" && flugEta.text == "Multi" && flugKandidaten.isNotEmpty()) ({ kandidatenOffen = !kandidatenOffen }) else null
                            val rechts = when (z.id) {
                                "flugnummer" -> if (flugAngewandt) RechtsArt.KREUZ else if (kannFlug) RechtsArt.HAKEN else RechtsArt.PFEIL
                                "zugnummer" -> if (zugAngewandt) RechtsArt.KREUZ else if (kannZug) RechtsArt.HAKEN else RechtsArt.PFEIL
                                else -> null
                            }
                            val rechtsAktion: (() -> Unit)? = when (z.id) {
                                "flugnummer" -> ({ flugAnwenden() })
                                "zugnummer" -> ({ zugAnwenden() })
                                else -> null
                            }
                            val laedtListe = listenLaden && (z.art == ZeilenArt.FAHRER || z.art == ZeilenArt.GAST)
                            FormularZeile(z.beschriftung, lesen(z), m, eta, etaAktion, rechts, rechtsAktion, { zuruecksetzen(z) }) {
                                ZeilenEingabe(
                                    lesen(z), { aendern(z, it) }, fokusModifier(z.id),
                                    zahl = z.art == ZeilenArt.ZAHL,
                                    platzhalter = if (listenLaden && z.art == ZeilenArt.FAHRER) "Fahrer werden geladen..."
                                    else if (listenLaden && z.art == ZeilenArt.GAST) "Fahrgäste werden geladen..." else "",
                                    gesperrt = laedtListe,
                                )
                            }
                        }
                    }
                }

                // Notes Section: #1a1a1a, rounded 12, darin weisses Blatt mit 20 Rand.
                Box(Modifier.platz(0f, notizTop, 402f, 224f).background(hex(0x1A1A1A), RoundedCornerShape(12.dp))) {
                    Column(
                        Modifier.platz(20f, 20f, 362f, 184f).background(Color.White).tippen { notizFokus.requestFocus() }.padding(16.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(t("fahrt.notizen"), style = css(16f, 700, abstand = 0.5f, farbe = hex(0x1D1C1D)))
                            Spacer(Modifier.weight(1f))
                            Icon("Arrow-kurz_Trisar_Icons_01_Lime", Modifier.size(10.dp, 13.dp))
                        }
                        val stil = grotesk(14f, abstand = 0.25f, farbe = hex(0x818181, 0.5f))
                        BasicTextField(
                            notiz, { notiz = it }, Modifier.fillMaxWidth().weight(1f).focusRequester(notizFokus).then(fokusModifier("notiz")),
                            textStyle = stil, cursorBrush = SolidColor(hex(0x818181)),
                            keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences),
                            decorationBox = { inner ->
                                if (notiz.isEmpty()) Text(t("fahrt.notesPlaceholder"), style = stil.copy(color = hex(0x818181, 0.25f)))
                                inner()
                            },
                        )
                    }
                }

                FormularSpeichernKnopf(
                    if (speichert) t("fahrt.saving") else t(if (bearbeiten) "fahrt.submitEdit" else "fahrt.submitCreate"),
                    speichert, Modifier.platz(20f, knopfTop, 362f, 56f),
                ) { speichern() }
                if (bearbeiten) {
                    Box(
                        Modifier.platz(20f, stornoTop, 362f, 56f).background(hex(0x221313)).border(2.dp, hex(0xF55757)).tippen { stornoFrage = true },
                        contentAlignment = Alignment.Center,
                    ) { Text(t("fahrt.cancelRide"), style = css(16f, 500, abstand = 0.4f, farbe = hex(0xF55757))) }
                }

                // Listen (Adressen, Fluege, Fahrer, Gaeste) ueber den Reihen.
                // Eigene Orte ganz oben (ab einem Buchstaben), darunter die Adressen.
                val startListe = vorschlaege["start"].orEmpty()
                val startOrte = if (werte.startOrtID.isEmpty()) EigeneOrte.vorschlaege(werte.start) else emptyList()
                if (aktivesAdressFeld == "start" && (startListe.isNotEmpty() || startOrte.isNotEmpty())) {
                    OrtVorschlagListe(startOrte, startListe, Modifier.platz(20f, 342f + zeilenHoehe + 4),
                        { ortWaehlen(it, "start") }) { adresseWaehlen(startListe[it], "start") }
                }
                val flugIndex = reihen.indexOfFirst { it.id == "flugnummer" }
                if (kandidatenOffen && flugKandidaten.isNotEmpty() && flugIndex >= 0) {
                    val roh = FahrtText.getrimmt(werte.datum)
                    val iso = if (FahrtText.fahrtDatum(roh).length == 10 && !roh.contains("T")) FahrtText.fahrtDatum(roh) else ""
                    val kopf = if (iso.isNotEmpty() && flugKandidaten.any { it.ankunftGeplant.startsWith(iso) }) t("fahrt.multipleFlightsFound")
                    else t("fahrt.noFlightDataForDate", mapOf("date" to roh.ifEmpty { t("fahrt.datum") }))
                    VorschlagListe(flugKandidaten.mapIndexed { n, k -> kandidatText(k, n) }, Modifier.platz(20f, reihenStart + flugIndex * schritt + zeilenHoehe + 4), kopf, 220f) { n ->
                        val k = flugKandidaten[n]
                        val flughafen = FahrtText.getrimmt(k.ankunft).uppercase()
                        val geplant = FahrtText.getrimmt(k.ankunftGeplant)
                        if (flughafen.isNotEmpty()) flughafenWahl = flughafen
                        if (geplant.isNotEmpty()) ankunftWahl = geplant
                        flugEta = EtaMarke("…", 0x808080)
                        kandidatenOffen = false
                    }
                }
                val zielListe = vorschlaege["ziel"].orEmpty()
                val zielOrte = if (werte.zielOrtID.isEmpty()) EigeneOrte.vorschlaege(werte.ziel) else emptyList()
                val aktiverStopp = aktivesAdressFeld?.takeIf { it.startsWith("stopp-") }
                val stoppReihe = reihen.indexOfFirst { it.id == aktiverStopp }
                if (aktiverStopp != null && stoppReihe >= 0) {
                    val stoppListe = vorschlaege[aktiverStopp].orEmpty()
                    val stoppOrte = EigeneOrte.vorschlaege(zwischenstopps.getOrElse(stoppReihe) { "" })
                    if (stoppListe.isNotEmpty() || stoppOrte.isNotEmpty()) {
                        OrtVorschlagListe(stoppOrte, stoppListe, Modifier.platz(20f, reihenStart + stoppReihe * schritt + zeilenHoehe + 4),
                            { ortWaehlen(it, aktiverStopp) }) { adresseWaehlen(stoppListe[it], aktiverStopp) }
                    }
                }
                val zielReihe = reihen.indexOfFirst { it.id == "ziel" }.coerceAtLeast(0)
                if (aktivesAdressFeld == "ziel" && (zielListe.isNotEmpty() || zielOrte.isNotEmpty())) {
                    OrtVorschlagListe(zielOrte, zielListe, Modifier.platz(20f, reihenStart + zielReihe * schritt + zeilenHoehe + 4),
                        { ortWaehlen(it, "ziel") }) { adresseWaehlen(zielListe[it], "ziel") }
                }
                val f = fokus
                val fi = reihen.indexOfFirst { it.id == f }
                if (f != null && !autoListeZu && fi >= 0 && (reihen[fi].art == ZeilenArt.FAHRER || reihen[fi].art == ZeilenArt.GAST)) {
                    val z = reihen[fi]
                    val treffer = autoTreffer(lesen(z), if (z.art == ZeilenArt.FAHRER) fahrerListe else gastListe)
                    if (treffer.isNotEmpty()) {
                        VorschlagListe(treffer, Modifier.platz(20f, reihenStart + fi * schritt + zeilenHoehe + 4)) { n ->
                            autoListeZu = true
                            if (z.art == ZeilenArt.FAHRER && z.index < fahrerNamen.size) fahrerNamen = fahrerNamen.toMutableList().also { it[z.index] = treffer[n] }
                            if (z.art == ZeilenArt.GAST && z.index < gaesteNamen.size) gaesteSetzen(gaesteNamen.toMutableList().also { it[z.index] = treffer[n] })
                        }
                    }
                }
            }
        }
        if (bearbeiten || vorlage != null) FussleisteUnten() else Navileiste(DispoZiel.FAHRT_NEU) { zeigen?.invoke(it) }

        meldung?.let { Hinweis(it, null) { meldung = null } }
        adressHinweis?.let { h -> Rueckfrage("$h\n\n${t("fahrt.trotzdemSpeichern")}?", { adressHinweis = null; speichern(geprueft = true) }, { adressHinweis = null }) }
        if (stornoFrage) Rueckfrage(t("fahrt.confirmCancelRide"), { stornoFrage = false; stornieren() }, { stornoFrage = false })
        if (importOffen) {
            BackHandler { importOffen = false }
            ImportSeite(ImportModus.FAHRTEN, zurueck = { importOffen = false }, zumZiel = {
                importOffen = false
                zeigen?.invoke(DispoZiel.FAHRTEN)
            })
        }
    }
}

private fun statusText(w: String): String = when (w) {
    "offen" -> FahrtText.tr("fahrt.statusOffen")
    "beendet" -> FahrtText.tr("fahrt.statusBeendet")
    "stoniert" -> FahrtText.tr("fahrt.statusStoniert")
    "unterwegs" -> FahrtText.tr("fahrt.statusUnterwegs")
    else -> w
}

/** Vorschlaege wie das datalist im Web: enthaltene Treffer, nichts mehr wenn der Name vollstaendig dasteht. */
private fun autoTreffer(wert: String, liste: List<String>): List<String> {
    val suche = FahrtText.vergleichbar(wert)
    if (suche.isEmpty()) return emptyList()
    val treffer = liste.filter { FahrtText.vergleichbar(it).contains(suche) }
    if (treffer.any { FahrtText.vergleichbar(it) == suche }) return emptyList()
    return treffer
}

/** formatFlightCandidateLabel: "MUC → HAM · Ankunft 04.11. 14:30". */
private fun kandidatText(k: FahrtPruefung.FlugKandidat, n: Int): String {
    val route = listOf(k.abflug, k.ankunft).filter { it.isNotEmpty() }.joinToString(" → ")
    var tag = ""
    var zeit = ""
    val s = k.ankunftGeplant
    if (Regex("""^\d{4}-\d{2}-\d{2}""").containsMatchIn(s)) {
        val teile = s.take(10).split("-")
        tag = "${teile[2]}.${teile[1]}."
    }
    Regex("""T\d{2}:\d{2}""").find(s)?.let { zeit = it.value.drop(1) }
    val ankunft = listOf(tag, zeit).filter { it.isNotEmpty() }.joinToString(" ")
    val text = listOf(route, if (ankunft.isEmpty()) "" else FahrtText.tr("fahrt.arrivalLabel", mapOf("time" to ankunft))).filter { it.isNotEmpty() }.joinToString(" · ")
    return text.ifEmpty { FahrtText.tr("fahrt.flightNumbered", mapOf("n" to "${n + 1}")) }
}

/** Eingabe in der Zeile: Space Grotesk 16 medium, Lime (ZeilenEingabe in iOS). */
@Composable
private fun ZeilenEingabe(wert: String, aendern: (String) -> Unit, modifier: Modifier, zahl: Boolean = false, platzhalter: String = "", gesperrt: Boolean = false) {
    val stil = grotesk(16f, 500, abstand = 0.5f, farbe = LIME)
    BasicTextField(
        wert, aendern, modifier.fillMaxWidth(), enabled = !gesperrt, singleLine = true, textStyle = stil,
        cursorBrush = SolidColor(LIME),
        keyboardOptions = KeyboardOptions(
            capitalization = if (zahl) KeyboardCapitalization.None else KeyboardCapitalization.Sentences,
            autoCorrectEnabled = false,
            keyboardType = if (zahl) KeyboardType.Number else KeyboardType.Text,
        ),
        decorationBox = { inner ->
            if (wert.isEmpty() && platzhalter.isNotEmpty()) Text(platzhalter, style = stil.copy(color = LIME.copy(alpha = 0.5f)), maxLines = 1)
            inner()
        },
    )
}
