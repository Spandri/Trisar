package de.trisar.dispo.dienstreise

import android.net.Uri
import android.provider.OpenableColumns
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalFocusManager
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
import de.trisar.dispo.standby.ArtUmschalter
import de.trisar.dispo.standby.BERLIN
import de.trisar.dispo.standby.NotizFeld
import de.trisar.dispo.standby.datumText
import de.trisar.dispo.standby.fahrerSetzen
import de.trisar.dispo.standby.hm
import de.trisar.dispo.standby.minuten
import de.trisar.dispo.standby.tagKurz
import de.trisar.kern.DienstreiseAbschnitt
import de.trisar.kern.DienstreiseZeile
import de.trisar.kern.TicketAblage
import de.trisar.kern.DispoHintergrund
import de.trisar.kern.EigeneOrte
import de.trisar.kern.Icon
import de.trisar.kern.ReiseVerbindung
import de.trisar.kern.HalteKachel
import de.trisar.kern.HalteMasse
import de.trisar.kern.ReiseZeiten
import de.trisar.kern.VerspaetungKachel
import de.trisar.kern.Routen
import de.trisar.kern.ZurueckKnopf
import de.trisar.kern.grotesk
import de.trisar.kern.hex
import de.trisar.kern.platz
import de.trisar.kern.tippen
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.withContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.time.LocalDate

// Raster aus DienstreiseAdd.jsx / DienstreiseView.jsx: Titel 140, Felder ab 206, Reihen alle 68, Zeilenhoehe 56.
private const val SCHRITT = 68f
private const val ZEILE = 56f
private const val KOPF = 36f

/** Farbe als Zahl fuer EtaMarke. */
private fun farbWert(c: Color): Long = c.toArgb().toLong() and 0xFFFFFF

/** Ein Abschnitt im Formular: Start Zeit, Start (Text + eigener Ort), Zug / Flug, uebernommene Nummer, Ticket-Angaben. */
private class AbschnittFeld(
    zeit: String = "", startText: String = "", nummer: String = "",
    val ticket: DispoDienstreiseSpeicher.TicketAbschnitt? = null,
) {
    val key: String = java.util.UUID.randomUUID().toString()
    var zeit by mutableStateOf(zeit)
    var startText by mutableStateOf(startText)
    var startOrtID by mutableStateOf<String?>(null)
    var nummer by mutableStateOf(nummer)
    var uebernommen by mutableStateOf("")
}

/** Pruefung je Abschnitt: laeuft, ohne Live-Abfrage (Bus/U-Bahn/Tram) oder das Ergebnis. */
private sealed interface Pruefung {
    data object Laeuft : Pruefung
    data object Ohne : Pruefung
    data class Fertig(val v: ReiseVerbindung) : Pruefung
}

private fun kurzOrt(text: String): String = text.split(",").first().trim()

/** Rahmen gestrichelt (border-2 border-dashed). */
private fun Modifier.gestrichelt(farbe: Color): Modifier = drawBehind {
    val b = 2.dp.toPx()
    drawRect(farbe, topLeft = androidx.compose.ui.geometry.Offset(b / 2, b / 2),
        size = androidx.compose.ui.geometry.Size(size.width - b, size.height - b),
        style = androidx.compose.ui.graphics.drawscope.Stroke(width = b, pathEffect = androidx.compose.ui.graphics.PathEffect.dashPathEffect(floatArrayOf(6.dp.toPx(), 4.dp.toPx()))))
}

/**
 * Dienstreise verschicken (DienstreiseAdd.jsx, Entwurf 14.11.): Datum, dann je Abschnitt Start Zeit, Start,
 * Zug / Flug (Pruefung 800 ms nach jeder Aenderung, Knopf Pfeil/Haken/x wie im Fahrt-Formular), dazwischen
 * "— Umstieg in … N min ✕", "+ Umstieg hinzufuegen", Ziel, Fahrer, Ticket, Notiz, "Dienstreise senden".
 * Upload-Icon oben rechts: Ticket (PDF/Bild) hochladen, der Server liest es (dispo-admin ticket_lesen) und
 * fuellt das Formular. Die Dispo prueft und schickt selbst ab.
 */
@Composable
fun DienstreiseNeuSeite(
    zurueck: () -> Unit, zurFahrt: () -> Unit, zuStandby: () -> Unit, gesendet: (String) -> Unit, zeigen: (DispoZiel) -> Unit,
) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    val fokusManager = LocalFocusManager.current
    // ID schon jetzt: das Ticket liegt im Ordner der Dienstreise, auch bevor sie gesendet ist.
    val reiseId = remember { java.util.UUID.randomUUID().toString() }
    var datum by remember { mutableStateOf(LocalDate.now(BERLIN).toString()) }
    val abschnitte = remember { mutableStateListOf(AbschnittFeld()) }
    var zielText by remember { mutableStateOf("") }
    var zielOrtID by remember { mutableStateOf<String?>(null) }
    val pruefungen = remember { mutableStateMapOf<String, Pruefung>() }
    val pruefNr = remember { HashMap<String, Int>() }
    val geprueft = remember { HashMap<String, String>() }
    var notiz by remember { mutableStateOf("") }
    var ticket by remember { mutableStateOf<DispoDienstreiseSpeicher.Ticket?>(null) }
    var reisender by remember { mutableStateOf("") }
    var auftragsnummer by remember { mutableStateOf("") }
    var hinweis by remember { mutableStateOf("") }
    var laedt by remember { mutableStateOf(false) }
    var fehler by remember { mutableStateOf("") }
    var sendet by remember { mutableStateOf(false) }
    // Auf der Karte markierte Fahrer sind schon eingetragen.
    var fahrerNamen by remember {
        val markierte = if (FahrerMarkierung.wirkt) FahrerMarkierung.fahrer.map { it.name }.filter { it.isNotEmpty() } else emptyList()
        mutableStateOf(markierte + "")
    }
    var fahrerAlle by remember { mutableStateOf(emptyList<FahrtSpeichern.FahrerEintrag>()) }
    var fokusFahrer by remember { mutableStateOf<Int?>(null) }
    var listeZu by remember { mutableStateOf(false) }

    // Ortsvorschlaege: immer nur ein Feld offen (Start eines Abschnitts oder Ziel).
    var offenesFeld by remember { mutableStateOf("") }
    var vorschlaege by remember { mutableStateOf(emptyList<String>()) }
    var vorschlagLauf by remember { mutableStateOf<Job?>(null) }
    var vorschlagNr by remember { mutableIntStateOf(0) }

    LaunchedEffect(Unit) { EigeneOrte.laden() }
    LaunchedEffect(Unit) { fahrerAlle = FahrtSpeichern.fahrerLaden() }
    val fahrerVorschlaege = remember(fahrerAlle) { FahrtSpeichern.fahrerVorschlaege(fahrerAlle) }
    val signatur = abschnitte.joinToString("§") { "${it.key}|${it.nummer.trim()}|${it.startText.trim()}|${it.startOrtID}|${it.zeit}" } + "#$datum"
    // Eine alte Meldung verschwindet, sobald ein Feld geaendert wird.
    LaunchedEffect(signatur, zielText, fahrerNamen) { fehler = "" }

    fun vorschlaegeHolen(feld: String, text: String) {
        vorschlagLauf?.cancel()
        val q = text.trim()
        if (q.isEmpty()) { vorschlaege = emptyList(); return }
        offenesFeld = feld
        val n = ++vorschlagNr
        vorschlagLauf = scope.launch {
            delay(250)
            val liste = FahrtPruefung.ortsVorschlaege(q)
            if (vorschlagNr == n) vorschlaege = liste
        }
    }

    /** Ort aufloesen: eigener Ort, sonst Adresse suchen. */
    suspend fun ortAufloesen(text: String, ortID: String?): DispoDienstreiseSpeicher.OrtWahl? {
        if (ortID != null) EigeneOrte.einmalLaden()
        EigeneOrte.zuID(ortID)?.let { return DispoDienstreiseSpeicher.OrtWahl(it.id, it.name, it.adresse, it.lat, it.lng) }
        if (text.isBlank()) return null
        val p = Routen.punkt(ctx, text) ?: return null
        return DispoDienstreiseSpeicher.OrtWahl(null, kurzOrt(text), text, p.lat, p.lng)
    }

    // Verbindung eines Abschnitts pruefen. Ausstieg: Start des naechsten Abschnitts (Umstieg), sonst Ticket, sonst Ziel.
    fun pruefen(a: AbschnittFeld, index: Int) {
        val nummer = a.nummer.trim()
        val art = DienstreiseAbschnitt.artAus(nummer)
        if (nummer.isEmpty() || a.startText.isBlank() || datum.isBlank()) { pruefungen.remove(a.key); return }
        if (!DienstreiseAbschnitt.mitLive(art)) { pruefungen[a.key] = Pruefung.Ohne; return }
        val nr = (pruefNr[a.key] ?: 0) + 1
        pruefNr[a.key] = nr
        pruefungen[a.key] = Pruefung.Laeuft
        val naechster = abschnitte.getOrNull(index + 1)
        scope.launch {
            val s = if (a.startOrtID != null) runCatching { ortAufloesen(a.startText, a.startOrtID) }.getOrNull() else null
            val z = if (naechster == null && zielText.isNotBlank()) runCatching { ortAufloesen(zielText, zielOrtID) }.getOrNull() else null
            val bahnhof = if (naechster != null) kurzOrt(naechster.startText) else a.ticket?.nach?.takeIf { it.isNotBlank() }?.let(::kurzOrt).orEmpty()
            val v = runCatching {
                ReiseVerbindung.holen(DienstreiseZeile(
                    id = "", datum = datum, start_zeit = a.zeit, start_name = s?.name ?: kurzOrt(a.startText), start_lat = s?.lat, start_lng = s?.lng,
                    ziel_name = z?.name ?: zielText, ziel_lat = z?.lat, ziel_lng = z?.lng,
                    zugnummer = if (art == "flug") null else nummer, flugnummer = if (art == "flug") nummer else null,
                ), bahnhof)
            }.getOrNull()
            if (pruefNr[a.key] == nr) { if (v != null) pruefungen[a.key] = Pruefung.Fertig(v) else pruefungen.remove(a.key) }
        }
    }

    // Automatisch pruefen, kurz (800 ms) nachdem Nummer, Start oder Datum eines Abschnitts geaendert wurden.
    LaunchedEffect(signatur) {
        delay(800)
        abschnitte.toList().forEachIndexed { i, a ->
            val s = "${a.nummer.trim()}|${a.startText.trim()}|${a.startOrtID}|$datum|${abschnitte.getOrNull(i + 1)?.startText.orEmpty()}"
            if (geprueft[a.key] == s) return@forEachIndexed
            geprueft[a.key] = s
            if (a.nummer.isNotBlank() && a.startText.isNotBlank()) pruefen(a, i)
        }
    }

    fun pruefText(p: Pruefung?): EtaMarke? = when (p) {
        null, Pruefung.Ohne -> null
        Pruefung.Laeuft -> EtaMarke("prüfe …", 0x868687)
        is Pruefung.Fertig -> if (p.v.fehler != null) EtaMarke("nicht gefunden", 0xFF6F63)
            else EtaMarke("ab ${p.v.abfahrt}" + (if (p.v.gleis.isNotEmpty()) " · ${if (p.v.art == "zug") "Gl. " else ""}${p.v.gleis}" else ""), 0xE3F654)
    }

    // Ankunft eines Abschnitts: live, sonst aus dem Ticket.
    fun ankunft(a: AbschnittFeld): String =
        ((pruefungen[a.key] as? Pruefung.Fertig)?.v?.takeIf { it.fehler == null }?.ankunft?.ifEmpty { null }) ?: a.ticket?.an.orEmpty()
    fun umstiegMinuten(vorher: AbschnittFeld, a: AbschnittFeld): Int? {
        val an = DienstreiseAbschnitt.minuten(ankunft(vorher)) ?: return null
        val ab = DienstreiseAbschnitt.minuten(a.zeit) ?: return null
        return (ab - an + 1440) % 1440
    }

    // Ticket hochladen und Formular ausfuellen.
    fun ticketGewaehlt(uri: Uri) {
        if (laedt) return
        laedt = true
        hinweis = "Ticket wird gelesen …"
        scope.launch {
            try {
                val gelesen = withContext(Dispatchers.IO) {
                    runCatching {
                        val name = runCatching {
                            ctx.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
                                if (c.moveToFirst()) c.getString(0) else null
                            }
                        }.getOrNull() ?: (uri.lastPathSegment ?: "Ticket.pdf")
                        val typ = ctx.contentResolver.getType(uri) ?: "application/pdf"
                        Triple(name, typ, ctx.contentResolver.openInputStream(uri)?.use { it.readBytes() } ?: ByteArray(0))
                    }
                }.getOrNull()
                if (gelesen == null || gelesen.third.isEmpty()) { hinweis = ""; fehler = "Datei konnte nicht gelesen werden."; return@launch }
                val r = DispoDienstreiseSpeicher.ticketHochladenUndLesen(reiseId, gelesen.first, gelesen.second, gelesen.third)
                if (!r.ok) { hinweis = ""; fehler = r.fehler; return@launch }
                ticket = r.ticket
                val g = r.gelesen
                if (g == null) { hinweis = r.fehler.ifEmpty { "Ticket gespeichert. Bitte die Felder von Hand ausfüllen." }; return@launch }
                if (g.datum.isNotBlank()) datum = g.datum
                val neu = g.abschnitte.map { x -> AbschnittFeld(zeit = x.ab, startText = x.von, nummer = x.nummer, ticket = x) }
                if (neu.isNotEmpty()) { abschnitte.clear(); abschnitte.addAll(neu); pruefungen.clear() }
                g.abschnitte.lastOrNull()?.nach?.takeIf { it.isNotBlank() }?.let { zielText = it; zielOrtID = null }
                reisender = g.name
                auftragsnummer = g.auftragsnummer
                val reservierung = g.abschnitte.map { it.hinweis }.filter { it.isNotBlank() }.joinToString(", ")
                notiz = listOf(
                    if (g.auftragsnummer.isNotBlank()) "Auftrag ${g.auftragsnummer}" else "",
                    listOf(g.tarif, g.klasse).filter { it.isNotBlank() }.joinToString(", "),
                    if (g.zugbindung.isNotEmpty()) "Zugbindung ${g.zugbindung.joinToString(" und ")}" else "",
                    reservierung,
                    "Ausweis mitnehmen.",
                ).filter { it.isNotBlank() }.joinToString(". ").replace("..", ".")
                // Reisender aus dem Ticket als Fahrer, wenn er in der Fahrerliste steht.
                var gefunden = false
                if (g.name.isNotBlank()) {
                    val alle = if (fahrerAlle.isEmpty()) FahrtSpeichern.fahrerLaden().also { fahrerAlle = it } else fahrerAlle
                    val p = FahrtSpeichern.fahrerID(g.name, alle)?.let { id -> alle.firstOrNull { it.id == id } }
                    if (p != null) {
                        gefunden = true
                        val anzeige = "${p.vorname.orEmpty()} ${p.nachname.orEmpty()}".trim() + (if (p.nummer.isNotEmpty()) " (${p.nummer})" else "")
                        fahrerNamen = (listOf(anzeige) + fahrerNamen.filter { it.isNotBlank() }).distinct() + ""
                    }
                }
                hinweis = if (gefunden || g.name.isBlank()) "Aus dem Ticket ausgefüllt. Bitte prüfen und dann senden."
                    else "Aus dem Ticket ausgefüllt. ${g.name} steht nicht in der Fahrerliste, bitte Fahrer eintragen."
            } finally {
                laedt = false
            }
        }
    }
    // accept="application/pdf,image/jpeg,image/png"
    val waehler = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri -> if (uri != null) ticketGewaehlt(uri) }

    fun senden() {
        if (sendet || laedt) return
        fehler = ""
        if (datum.isBlank()) { fehler = "Bitte ein Datum setzen."; return }
        val liste = abschnitte.toList()
        if (liste.any { it.zeit.isBlank() }) { fehler = "Bitte bei jedem Abschnitt die Start Zeit setzen."; return }
        if (liste.any { it.startText.isBlank() }) { fehler = "Bitte bei jedem Abschnitt einen Start wählen."; return }
        if (zielText.isBlank()) { fehler = "Bitte ein Ziel wählen."; return }
        val namen = fahrerNamen.map { it.trim() }.filter { it.isNotEmpty() }
        if (namen.isEmpty()) { fehler = "Bitte mindestens einen Fahrer eintragen."; return }
        sendet = true
        scope.launch {
            try {
                val starts = mutableListOf<DispoDienstreiseSpeicher.OrtWahl>()
                for (a in liste) {
                    val o = ortAufloesen(a.startText, a.startOrtID)
                    if (o == null) { fehler = "„${a.startText}“ nicht gefunden. Bitte genauer eingeben oder einen eigenen Ort wählen."; return@launch }
                    starts += o
                }
                val z = ortAufloesen(zielText, zielOrtID)
                if (z == null) { fehler = "Ziel nicht gefunden. Bitte genauer eingeben oder einen eigenen Ort wählen."; return@launch }
                val alle = if (fahrerAlle.isEmpty()) FahrtSpeichern.fahrerLaden().also { fahrerAlle = it } else fahrerAlle
                val ids = mutableListOf<String>()
                for (n in namen) {
                    val id = FahrtSpeichern.fahrerID(n, alle)
                    if (id == null) { fehler = "Fahrer „$n“ nicht gefunden."; return@launch }
                    if (id !in ids) ids += id
                }
                val teile = liste.mapIndexed { i, a ->
                    val p = (pruefungen[a.key] as? Pruefung.Fertig)?.v?.takeIf { it.fehler == null }
                    val nach = if (i + 1 < liste.size) starts[i + 1] else z
                    DispoDienstreiseSpeicher.NeuerAbschnitt(
                        art = DienstreiseAbschnitt.artAus(a.nummer), nummer = a.nummer.trim(),
                        vonName = starts[i].name, vonLat = starts[i].lat, vonLng = starts[i].lng,
                        abDatum = datum, abZeit = a.zeit,
                        gleisAb = p?.gleis?.ifEmpty { null } ?: a.ticket?.gleisAb.orEmpty(),
                        nachName = a.ticket?.nach?.takeIf { it.isNotBlank() }?.let(::kurzOrt) ?: nach.name, nachLat = nach.lat, nachLng = nach.lng,
                        anDatum = a.ticket?.anDatum.orEmpty(), anZeit = ankunft(a),
                        gleisAn = a.ticket?.gleisAn.orEmpty(), hinweis = a.ticket?.hinweis.orEmpty(),
                    )
                }
                val erster = teile.first()
                DispoDienstreiseSpeicher.anlegen(
                    datum, erster.abZeit, starts[0], z,
                    zugnummer = if (erster.art == "flug") "" else erster.nummer,
                    flugnummer = if (erster.art == "flug") erster.nummer else "",
                    notiz = notiz.trim(), fahrerIds = ids,
                    id = reiseId, abschnitte = teile, ticket = ticket, reisender = reisender, auftragsnummer = auftragsnummer,
                ).onSuccess { gesendet(it) }
                    .onFailure { fehler = it.message ?: "Dienstreise nicht gespeichert." }
            } finally {
                sendet = false
            }
        }
    }

    // Raster: Datum, je Abschnitt (Kopf "Umstieg", Start Zeit, Start, Zug / Flug), "+ Umstieg", Ziel, Fahrer, Ticket, Notiz.
    var y = 206f
    val datumOben = y; y += SCHRITT
    data class Block(val a: AbschnittFeld, val i: Int, val kopf: Float?, val zeit: Float, val start: Float, val nummer: Float)
    val bloecke = abschnitte.mapIndexed { i, a ->
        val kopf = if (i > 0) y else null
        if (i > 0) y += KOPF
        val zeit = y; y += SCHRITT
        val start = y; y += SCHRITT
        val nummer = y; y += SCHRITT
        Block(a, i, kopf, zeit, start, nummer)
    }
    val plusOben = y; y += SCHRITT
    val zielOben = y; y += SCHRITT
    val fahrerOben = y; y += fahrerNamen.size * SCHRITT
    val t = ticket
    val ticketOben = if (t != null) y else null
    if (t != null) y += SCHRITT
    val notizOben = y - SCHRITT + ZEILE + 24f
    val ctaOben = notizOben + 224f + 24f
    val hoehe = ctaOben + ZEILE + (if (fehler.isNotEmpty()) 60f else 30f) + 151f

    @Composable
    fun ortZeile(feld: String, text: String, oben: Float, titel: String, setzen: (String, String?) -> Unit) {
        FormularZeile(titel, text, Modifier.platz(20f, oben, 362f, ZEILE),
            zuruecksetzen = { setzen("", null); vorschlaege = emptyList() }) {
            ZeilenEingabe(text, { setzen(it, null); vorschlaegeHolen(feld, it) }, Modifier.onFocusChanged {
                if (it.isFocused) offenesFeld = feld else if (offenesFeld == feld) offenesFeld = ""
            })
        }
    }

    Box(Modifier.fillMaxSize().background(Color.Black).blockieren().imePadding()) {
        Box(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
            Box(Modifier.fillMaxWidth().height(hoehe.dp)) {
                DispoHintergrund(Modifier.fillMaxWidth().height(hoehe.dp))
                ZurueckKnopf(Modifier.platz(20f, 60f), zurueck)
                ArtUmschalter("dienstreise", Modifier.platz(0f, 67f, 402f, 40f), fahrt = zurFahrt, standbyWahl = zuStandby, dienstreiseWahl = {})
                // Ticket hochladen: gleiches Symbol wie der Import in Fahrt hinzufuegen.
                Icon("import-fahrten", Modifier.platz(402f - 20f - 42f, 65f, 42f, 40f).alpha(if (laedt) 0.5f else 1f).tippen {
                    if (!laedt) waehler.launch(arrayOf("application/pdf", "image/jpeg", "image/png"))
                })
                Text("Dienstreise", style = css(42f, 700, 42f, farbe = LIME), modifier = Modifier.platz(20f, 140f, 320f))
                if (hinweis.isNotEmpty()) {
                    Text(hinweis, style = grotesk(12f, 700, farbe = LIME), maxLines = 1, overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.platz(20f, 184f, 362f))
                }

                FormularZeile("Datum", datum, Modifier.platz(20f, datumOben, 362f, ZEILE), zuruecksetzen = { datum = "" }) {
                    ZeilenWert(datumText(datum)) {
                        fokusManager.clearFocus()
                        if (datum.isEmpty()) datum = LocalDate.now(BERLIN).toString()
                        datumWaehlen(ctx, datum) { datum = it }
                    }
                }

                for (b in bloecke) {
                    val a = b.a
                    key(a.key) {
                        if (b.kopf != null) {
                            val umstieg = umstiegMinuten(abschnitte[b.i - 1], a)
                            Row(Modifier.platz(20f, b.kopf + 6f, 362f), verticalAlignment = Alignment.CenterVertically) {
                                Row(Modifier.weight(1f), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                                    Box(Modifier.size(24.dp, 2.dp).background(LIME))
                                    Text("Umstieg" + (if (a.startText.isNotBlank()) " in ${kurzOrt(a.startText)}" else ""),
                                        style = grotesk(16f, 700, farbe = LIME), maxLines = 1, overflow = TextOverflow.Ellipsis)
                                }
                                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                                    if (umstieg != null) Text("$umstieg min", style = grotesk(14f, 700, farbe = REISE_GRAU))
                                    Text("✕", style = grotesk(16f, 700, farbe = hex(0xF55757)), modifier = Modifier.tippen {
                                        abschnitte.remove(a); pruefungen.remove(a.key)
                                    })
                                }
                            }
                        }
                        FormularZeile("Start Zeit", a.zeit, Modifier.platz(20f, b.zeit, 362f, ZEILE), zuruecksetzen = { a.zeit = "" }) {
                            ZeilenWert(a.zeit) { fokusManager.clearFocus(); zeitWaehlen(ctx, minuten(a.zeit)) { a.zeit = it } }
                        }
                        ortZeile("start-${a.key}", a.startText, b.start, "Start") { text, id -> a.startText = text; a.startOrtID = id }
                        val p = pruefungen[a.key]
                        val ist = a.uebernommen.isNotEmpty() && a.uebernommen == a.nummer.trim()
                        val gefunden = (p as? Pruefung.Fertig)?.v?.takeIf { it.fehler == null && it.abfahrt.isNotEmpty() }
                        val mitKnopf = a.nummer.isNotBlank() && p != Pruefung.Ohne
                        FormularZeile("Zug / Flug", a.nummer, Modifier.platz(20f, b.nummer, 362f, ZEILE),
                            eta = if (a.nummer.isNotBlank()) pruefText(p) else null,
                            rechts = if (mitKnopf) (if (ist) RechtsArt.KREUZ else if (gefunden != null) RechtsArt.HAKEN else RechtsArt.PFEIL) else null,
                            rechtsAktion = if (mitKnopf) ({
                                when {
                                    ist -> { a.uebernommen = ""; a.nummer = ""; pruefungen.remove(a.key) }
                                    gefunden != null -> { a.zeit = gefunden.abfahrt; a.uebernommen = a.nummer.trim() }
                                    else -> pruefen(a, b.i)
                                }
                            }) else null,
                            zuruecksetzen = { a.nummer = ""; a.uebernommen = ""; pruefungen.remove(a.key) }) {
                            ZeilenEingabe(a.nummer, { a.nummer = it; pruefungen.remove(a.key) }, Modifier)
                        }
                    }
                }

                // Neuer Abschnitt beginnt dort, wo der letzte ankommt (laut Ticket). Aenderbar.
                Box(
                    Modifier.platz(20f, plusOben, 362f, ZEILE).gestrichelt(LIME).tippen {
                        abschnitte.add(AbschnittFeld(startText = abschnitte.lastOrNull()?.ticket?.nach.orEmpty()))
                    },
                    contentAlignment = Alignment.Center,
                ) { Text("+ Umstieg hinzufügen", style = grotesk(16f, 700, farbe = LIME)) }

                ortZeile("ziel", zielText, zielOben, "Ziel") { text, id -> zielText = text; zielOrtID = id }

                fahrerNamen.forEachIndexed { i, n ->
                    key("fahrer-$i") {
                        val titel = if (fahrerNamen.size > 1) FahrtText.tr("fahrt.fahrerNumbered", mapOf("n" to "${i + 1}")) else FahrtText.tr("fahrt.fahrer")
                        FormularZeile(titel, n, Modifier.platz(20f, fahrerOben + i * SCHRITT, 362f, ZEILE), zuruecksetzen = { fahrerNamen = fahrerSetzen(fahrerNamen, i, "") }) {
                            ZeilenEingabe(n, { listeZu = false; fahrerNamen = fahrerSetzen(fahrerNamen, i, it) },
                                Modifier.onFocusChanged { if (it.isFocused) fokusFahrer = i else if (fokusFahrer == i) fokusFahrer = null })
                        }
                    }
                }

                if (t != null && ticketOben != null) {
                    FormularZeile("Ticket", t.name, Modifier.platz(20f, ticketOben, 362f, ZEILE),
                        rechts = RechtsArt.KREUZ, rechtsAktion = { ticket = null }, zuruecksetzen = { ticket = null }) {
                        Text(t.name, style = grotesk(16f, 500, abstand = 0.5f, farbe = LIME), maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                }

                NotizFeld(notiz, { notiz = it }, Modifier.platz(0f, notizOben, 402f, 224f))

                FormularSpeichernKnopf(if (sendet) "Wird gesendet …" else "Dienstreise senden", sendet || laedt, Modifier.platz(20f, ctaOben, 362f, ZEILE)) { senden() }
                if (fehler.isNotEmpty()) {
                    Text(fehler, style = grotesk(13f, 700, farbe = REISE_ROT), modifier = Modifier.platz(20f, ctaOben + ZEILE + 10f, 362f))
                }

                // Listen ueber den Reihen: eigene Orte zuerst, darunter Adressen (nur am offenen Feld).
                val offen: Triple<Float, String, String?>? = if (offenesFeld == "ziel") Triple(zielOben, zielText, zielOrtID)
                    else bloecke.firstOrNull { "start-${it.a.key}" == offenesFeld }?.let { Triple(it.start, it.a.startText, it.a.startOrtID) }
                if (offen != null) {
                    val (oben, text, id) = offen
                    val eigeneTreffer = if (id == null) EigeneOrte.vorschlaege(text) else emptyList()
                    if (eigeneTreffer.isNotEmpty() || vorschlaege.isNotEmpty()) {
                        fun setzen(neu: String, neuID: String?) {
                            if (offenesFeld == "ziel") { zielText = neu; zielOrtID = neuID }
                            else bloecke.firstOrNull { "start-${it.a.key}" == offenesFeld }?.a?.let { it.startText = neu; it.startOrtID = neuID }
                            vorschlaege = emptyList(); offenesFeld = ""; fokusManager.clearFocus()
                        }
                        OrtVorschlagListe(eigeneTreffer, vorschlaege, Modifier.platz(20f, oben + ZEILE + 4f), { o -> setzen(o.name, o.id) }) { i ->
                            setzen(vorschlaege[i], null)
                        }
                    }
                }
                val fi = fokusFahrer
                if (fi != null && !listeZu && fi < fahrerNamen.size) {
                    val treffer = autoTreffer(fahrerNamen[fi], fahrerVorschlaege)
                    if (treffer.isNotEmpty()) {
                        VorschlagListe(treffer, Modifier.platz(20f, fahrerOben + fi * SCHRITT + ZEILE + 4f)) { n ->
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
 * Dienstreise (DienstreiseView.jsx, Stil wie Standby): Datum, Start Zeit, Start, Ziel, Zug/Flug mit Live-Stand,
 * Fahrer #1, #2 ... mit Zustand rechts (Angefragt, Angenommen, Abgelehnt, Beendet), Notizen, Speichern,
 * Dienstreise loeschen. Geaenderte Zeit bestaetigen die Fahrer neu (Trigger), neue Fahrer bekommen eine
 * Anfrage, das Leeren-Zeichen nimmt einen raus.
 */
@Composable
fun DienstreiseBearbeitenSeite(reiseId: String, zurueck: () -> Unit, zeigen: (DispoZiel) -> Unit) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    val fokusManager = LocalFocusManager.current
    val sp = DispoDienstreiseSpeicher
    LaunchedEffect(Unit) { sp.starten() }
    val d = sp.liste?.firstOrNull { it.id == reiseId }

    var datum by remember { mutableStateOf<String?>(null) }
    var zeit by remember { mutableStateOf<String?>(null) }
    var notiz by remember { mutableStateOf<String?>(null) }
    var neue by remember { mutableStateOf(listOf("")) }
    var meldung by remember { mutableStateOf("") }
    var speichert by remember { mutableStateOf(false) }
    var wegFrage by remember { mutableStateOf<ReiseFahrer?>(null) }
    var loeschFrage by remember { mutableStateOf(false) }
    var fahrerAlle by remember { mutableStateOf(emptyList<FahrtSpeichern.FahrerEintrag>()) }
    var fokusNeu by remember { mutableStateOf<Int?>(null) }
    var listeZu by remember { mutableStateOf(false) }
    var live by remember { mutableStateOf<ReiseVerbindung?>(null) }
    LaunchedEffect(Unit) { fahrerAlle = FahrtSpeichern.fahrerLaden() }
    val fahrerVorschlaege = remember(fahrerAlle) { FahrtSpeichern.fahrerVorschlaege(fahrerAlle) }

    // Verbindung live holen (Abfahrt, Gleis, Ankunft), sonst Stand beim Anlegen.
    LaunchedEffect(d?.id, d?.r?.nummer, d?.r?.datum, d?.r?.start_name) {
        val r = d?.r ?: return@LaunchedEffect
        if (r.nummer.isEmpty()) return@LaunchedEffect
        live = runCatching { ReiseVerbindung.holen(r) }.getOrNull()
    }
    // Mit Umstiegen: Live je Zug/Flug-Abschnitt (Verspaetung, Halte), alle 2 Minuten.
    var liveJe by remember { mutableStateOf<Map<String, ReiseVerbindung>>(emptyMap()) }
    var halteOffen by remember { mutableStateOf<Set<String>>(emptySet()) }
    var uhr by remember { mutableStateOf(System.currentTimeMillis()) }
    LaunchedEffect(Unit) { while (true) { kotlinx.coroutines.delay(30_000); uhr = System.currentTimeMillis() } }
    val teilSchluessel = d?.abschnitte.orEmpty().joinToString(",") { "${it.id}|${it.nummer}|${it.ab_zeit}" }
    LaunchedEffect(d?.id, teilSchluessel) {
        val reise = d ?: return@LaunchedEffect
        if (reise.abschnitte.size < 2) return@LaunchedEffect
        while (true) {
            for (a in reise.abschnitte) {
                val art = a.art.ifBlank { DienstreiseAbschnitt.artAus(a.nummer.orEmpty()) }
                if (!DienstreiseAbschnitt.mitLive(art) || a.nummer.isNullOrBlank()) continue
                val w = runCatching { ReiseVerbindung.holen(a.copy(art = art).alsReise(reise.r.datum), a.nach_name.orEmpty()) }.getOrNull()
                if (w != null && w.fehler == null) liveJe = liveJe + (a.id to w)
            }
            kotlinx.coroutines.delay(120_000)
        }
    }

    Box(Modifier.fillMaxSize().background(Color.Black).blockieren().imePadding()) {
        if (d == null) {
            DispoHintergrund()
            ZurueckKnopf(Modifier.platz(20f, 60f), zurueck)
            if (sp.liste != null) Text("Dienstreise nicht mehr vorhanden.", style = grotesk(18f, 700, farbe = LIME), modifier = Modifier.platz(20f, 140f, 362f))
            Navileiste(DispoZiel.FAHRTEN, zeigen)
            return@Box
        }
        val r = d.r
        val wDatum = datum ?: r.datum.take(10)
        val wZeit = zeit ?: hm(r.start_zeit)
        val wNotiz = notiz ?: r.notiz.orEmpty()
        val nummer = r.nummer
        val gespeichert = r.gespeicherteVerbindung
        val v = live?.takeIf { it.fehler == null } ?: gespeichert
        val verbindungText: EtaMarke? = when {
            nummer.isEmpty() -> null
            live?.fehler != null && gespeichert == null -> EtaMarke("nicht gefunden", 0xFF6F63)
            v == null -> EtaMarke("prüfe …", 0x868687)
            else -> EtaMarke("ab ${v.abfahrt}" + (if (v.ankunft.isNotEmpty()) " · an ${v.ankunft}" else ""), 0xE3F654)
        }

        fun speichern() {
            if (speichert) return
            speichert = true; meldung = ""
            scope.launch {
                try {
                    var zeitGeaendert = false
                    val aenderung = buildJsonObject {
                        if (wDatum != r.datum.take(10)) { put("datum", wDatum); zeitGeaendert = true }
                        if (wZeit != hm(r.start_zeit)) { put("start_zeit", wZeit); zeitGeaendert = true }
                        if (wNotiz != r.notiz.orEmpty()) put("notiz", wNotiz.ifBlank { null }?.let { JsonPrimitive(it) } ?: JsonNull)
                    }
                    if (aenderung.isNotEmpty()) {
                        val f = sp.aendern(r.id, aenderung)
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
                        val f = sp.fahrerDazu(r.id, ids)
                        if (f.isNotEmpty()) { meldung = "Fahrer nicht gespeichert: $f"; return@launch }
                    }
                    datum = null; zeit = null; notiz = null; neue = listOf("")
                    meldung = if (zeitGeaendert) "Gespeichert, die Fahrer bestätigen die neue Zeit." else "Gespeichert."
                } finally {
                    speichert = false
                }
            }
        }

        // Mit Umstiegen: je Abschnitt eine Zeile (Nummer | Zeit Start → Ziel), sonst Start, Ziel, Nummer wie bisher.
        val teile = d.abschnitte.takeIf { it.size > 1 }
        val teileOben = 342f
        // Zugabschnitt mit Halten: Kachel darunter (zu oder offen), schiebt alles Folgende nach unten.
        val halteExtra = teile.orEmpty().map { a ->
            val n = liveJe[a.id]?.halte?.size ?: 0
            if (n == 0 || a.art == "flug") 0f else HalteMasse.hoehe(n, a.id in halteOffen) + 12f
        }
        val teilOben = teile.orEmpty().indices.map { i -> teileOben + i * SCHRITT + halteExtra.take(i).sum() }
        val zielOben = if (teile != null) teileOben + teile.size * SCHRITT + halteExtra.sum() else 410f
        val ticketOben = if (teile != null) zielOben + SCHRITT else 206f + 5 * SCHRITT
        val fahrerOben = ticketOben + (if (!r.ticket_pfad.isNullOrBlank()) SCHRITT else 0f)
        val alleZeilen = d.fahrer.size + neue.size
        val notizOben = fahrerOben + (alleZeilen - 1) * SCHRITT + ZEILE + 24f
        val ctaOben = notizOben + 224f + 24f
        val loeschOben = ctaOben + ZEILE + 16f
        val hoehe = loeschOben + ZEILE + (if (meldung.isNotEmpty()) 70f else 40f) + 151f
        fun nummerTitel(i: Int) = if (alleZeilen > 1) FahrtText.tr("fahrt.fahrerNumbered", mapOf("n" to "${i + 1}")) else FahrtText.tr("fahrt.fahrer")

        @Composable
        fun nurLesen(titel: String, wert: String, oben: Float, eta: EtaMarke? = null, aktion: (() -> Unit)? = null) {
            FormularZeile(titel, wert, Modifier.platz(20f, oben, 362f, ZEILE), eta = eta, rechts = RechtsArt.PFEIL, rechtsAktion = aktion, zuruecksetzen = {}) {
                Text(wert, style = grotesk(16f, 500, abstand = 0.5f, farbe = LIME), maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }

        Box(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
            Box(Modifier.fillMaxWidth().height(hoehe.dp)) {
                DispoHintergrund(Modifier.fillMaxWidth().height(hoehe.dp))
                ZurueckKnopf(Modifier.platz(20f, 60f), zurueck)
                Text("Dienstreise", style = css(42f, 700, 42f, farbe = LIME), modifier = Modifier.platz(20f, 140f, 320f))

                FormularZeile("Datum", wDatum, Modifier.platz(20f, 206f, 362f, ZEILE), zuruecksetzen = { datum = "" }) {
                    ZeilenWert(datumText(wDatum)) { fokusManager.clearFocus(); datumWaehlen(ctx, wDatum) { datum = it } }
                }
                FormularZeile("Start Zeit", wZeit, Modifier.platz(20f, 274f, 362f, ZEILE), zuruecksetzen = { zeit = "" }) {
                    ZeilenWert(wZeit) { fokusManager.clearFocus(); zeitWaehlen(ctx, minuten(wZeit)) { zeit = it } }
                }
                if (teile != null) {
                    teile.forEachIndexed { i, a ->
                        key(a.id) {
                            // Abfahrt live (sonst Ticket), bei Verspaetung Orange mit Kachel "+5" (Entwurf 14.11.).
                            val w = liveJe[a.id]
                            val ab = w?.abfahrt?.ifEmpty { null } ?: hm(a.ab_zeit)
                            val spaet = DienstreiseAbschnitt.verspaetung(w?.abfahrtPlan, w?.abfahrt)
                            val strecke = "${a.von_name} → ${a.nach_name.orEmpty()}"
                            FormularZeile(a.nummer?.ifBlank { null } ?: "Abschnitt ${i + 1}", "$ab $strecke", Modifier.platz(20f, teilOben[i], 362f, ZEILE),
                                eta = a.gleis_ab?.ifBlank { null }?.let { EtaMarke("Gl. $it", 0x868687) }, rechts = RechtsArt.PFEIL, zuruecksetzen = {}) {
                                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                    Text(ab, style = grotesk(16f, 500, abstand = 0.5f, farbe = ReiseZeiten.farbe(spaet)), maxLines = 1)
                                    VerspaetungKachel(spaet)
                                    Text(strecke, style = grotesk(16f, 500, abstand = 0.5f, farbe = LIME), maxLines = 1, overflow = TextOverflow.Ellipsis)
                                }
                            }
                            val halte = w?.halte.orEmpty()
                            if (halte.isNotEmpty() && a.art != "flug") {
                                val tag = a.ab_datum?.ifBlank { null } ?: r.datum
                                val an = w?.ankunft?.ifEmpty { null } ?: hm(a.an_zeit)
                                HalteKachel(halte, tag, ab, ReiseZeiten.laeuft(tag, ab, an, uhr), Modifier.platz(20f, teilOben[i] + ZEILE + 12f, 362f),
                                    jetzt = uhr, offen = a.id in halteOffen) { auf -> halteOffen = if (auf) halteOffen + a.id else halteOffen - a.id }
                            }
                        }
                    }
                    nurLesen("Ziel", r.ziel_name, zielOben)
                } else {
                    nurLesen("Start", r.start_name, 342f)
                    nurLesen("Ziel", r.ziel_name, 410f)
                    nurLesen(if (r.flug) "Flugnummer" else "Zugnummer", nummer.ifEmpty { "–" }, 478f, verbindungText)
                }
                if (!r.ticket_pfad.isNullOrBlank()) {
                    // Ticket: Link fuer eine Stunde, im PDF-Betrachter oeffnen.
                    nurLesen("Ticket", r.ticket_name?.ifBlank { null } ?: "Ticket.pdf", ticketOben) {
                        scope.launch {
                            val url = TicketAblage.link(r.ticket_pfad)
                            if (url.isNotEmpty()) TicketAblage.oeffnen(ctx, url) else meldung = "Ticket konnte nicht geöffnet werden."
                        }
                    }
                }

                d.fahrer.forEachIndexed { i, f ->
                    key(f.driverId) {
                        val (text, farbe) = reiseZustand(f)
                        FormularZeile(nummerTitel(i), f.profil?.kurz ?: "Fahrer", Modifier.platz(20f, fahrerOben + i * SCHRITT, 362f, ZEILE),
                            eta = EtaMarke(text, farbWert(farbe)), zuruecksetzen = { wegFrage = f }) {
                            Text(f.profil?.kurz ?: "Fahrer", style = grotesk(16f, 500, abstand = 0.5f, farbe = LIME), maxLines = 1, overflow = TextOverflow.Ellipsis)
                        }
                    }
                }
                neue.forEachIndexed { j, n ->
                    key("neu-$j") {
                        val i = d.fahrer.size + j
                        FormularZeile(nummerTitel(i), n, Modifier.platz(20f, fahrerOben + i * SCHRITT, 362f, ZEILE), zuruecksetzen = { neue = fahrerSetzen(neue, j, "") }) {
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
                ) { Text("Dienstreise löschen", style = css(16f, 500, abstand = 0.4f, farbe = hex(0xF55757))) }
                if (meldung.isNotEmpty()) {
                    Text(meldung, style = grotesk(13f, 700, farbe = Color.White.copy(alpha = 0.7f)), modifier = Modifier.platz(20f, loeschOben + ZEILE + 12f, 362f))
                }

                val fn = fokusNeu
                if (fn != null && !listeZu && fn < neue.size) {
                    val treffer = autoTreffer(neue[fn], fahrerVorschlaege)
                    if (treffer.isNotEmpty()) {
                        VorschlagListe(treffer, Modifier.platz(20f, fahrerOben + (d.fahrer.size + fn) * SCHRITT + ZEILE + 4f)) { k ->
                            listeZu = true
                            neue = fahrerSetzen(neue, fn, treffer[k])
                        }
                    }
                }
            }
        }
        Navileiste(DispoZiel.FAHRTEN, zeigen)

        wegFrage?.let { f ->
            Rueckfrage("${f.name} aus der Dienstreise nehmen?", ok = {
                wegFrage = null
                scope.launch {
                    val e = sp.fahrerWeg(r.id, f.driverId)
                    meldung = if (e.isNotEmpty()) "Nicht gespeichert: $e" else "${f.name} ist raus."
                }
            }, abbrechen = { wegFrage = null })
        }
        if (loeschFrage) {
            Rueckfrage("Dienstreise ${r.start_name} → ${r.ziel_name} löschen? Alle Fahrer bekommen „Dienstreise zurückgezogen“.", ok = {
                loeschFrage = false
                scope.launch {
                    val e = sp.loeschen(r.id)
                    if (e.isNotEmpty()) meldung = "Nicht gelöscht: $e" else zurueck()
                }
            }, abbrechen = { loeschFrage = false })
        }
    }
}

/**
 * Dienstreise-Kacheln oben in Alle Fahrten (DienstreiseKacheln.jsx, wie StandbyKacheln): Start → Ziel,
 * Tag und Startzeit, Zug/Flug, wie viele Fahrer angenommen haben.
 */
@Composable
fun DienstreiseKacheln(modifier: Modifier, oeffnen: (String) -> Unit) {
    val sp = DispoDienstreiseSpeicher
    LaunchedEffect(Unit) { sp.starten() }
    val aktuell = (sp.liste ?: emptyList()).filter(::reiseAktuell)
    if (aktuell.isEmpty()) return
    Column(modifier.width(362.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        for (d in aktuell) {
            key(d.id) {
                val r = d.r
                val ja = d.fahrer.count { it.zeile.status == "accepted" }
                val nein = d.fahrer.count { it.zeile.status == "refused" }
                val nummer = r.zugnummer?.ifBlank { null } ?: r.flugnummer?.ifBlank { null }
                Box(Modifier.width(362.dp).background(hex(0x1A1A1A)).border(2.dp, REISE_LIME).tippen { oeffnen(d.id) }) {
                    Column(Modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, top = 44.dp, bottom = 14.dp)) {
                        Text("${r.start_name} → ${r.ziel_name}", style = grotesk(22f, 700, farbe = Color.White))
                        Text("${tagKurz(r.datum.take(10))} ${hm(r.start_zeit)}", style = grotesk(30f, 700, zeilenHoehe = 34f, farbe = REISE_LIME))
                        Text((if (nummer != null) "$nummer · " else "") + "$ja/${d.fahrer.size} angenommen" + (if (nein > 0) " · $nein abgelehnt" else ""),
                            style = grotesk(13f, 700, farbe = REISE_GRAU), modifier = Modifier.padding(top = 6.dp))
                    }
                    Row(
                        Modifier.align(Alignment.TopCenter).height(30.dp).background(REISE_LIME).padding(horizontal = 16.dp),
                        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        Text("Dienstreise", style = grotesk(16f, 700, farbe = Color.Black))
                        Icon("Rollkoffer_Trisar_Icons_01", Modifier.size(16.dp))
                    }
                }
            }
        }
    }
}
