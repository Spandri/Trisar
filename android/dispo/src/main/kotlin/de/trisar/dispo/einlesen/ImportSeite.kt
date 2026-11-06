package de.trisar.dispo.einlesen

import android.app.DatePickerDialog
import android.app.TimePickerDialog
import android.net.Uri
import android.provider.OpenableColumns
import android.util.Base64
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
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
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.LineHeightStyle
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import de.trisar.dispo.einlesen.ImportDienst.Analyse
import de.trisar.dispo.einlesen.ImportDienst.Satz
import de.trisar.kern.DispoHintergrund
import de.trisar.kern.FussleisteUnten
import de.trisar.kern.Icon
import de.trisar.kern.ZurueckKnopf
import de.trisar.kern.grotesk
import de.trisar.kern.hex
import de.trisar.kern.tippen
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import java.time.LocalDate
import java.time.LocalTime
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter

private val LIME = hex(0xE3F654)
private val LIME_HALB = hex(0xE3F654, 0.7f)
private val ORANGE = hex(0xFFCD8A)
private val ROT = hex(0xFF8A8A)
private val GRUEN = hex(0x8DFFAF)

private fun stil(groesse: Float, gewicht: Int = 400, zeile: Float? = null, abstand: Float = 0f, farbe: Color = Color.White): TextStyle =
    grotesk(groesse, gewicht, zeile, abstand, farbe).copy(lineHeightStyle = LineHeightStyle(LineHeightStyle.Alignment.Center, LineHeightStyle.Trim.None))

private enum class Schritt { DATEI, ERKENNUNG, ZUORDNUNG, FERTIG }

/** Kleine Pause, damit die Erkennung als eigener Schritt sichtbar ist (ERKENNUNG_MS). */
private const val ERKENNUNG_MS = 900L
private const val MAX_BYTES = 8 * 1024 * 1024

/** Hinweise, die eine Zeile nicht ausschliessen, aber angeschaut werden sollten. */
private val WARNUNGEN = setOf("doppelt", "vergangen", "adresseUnbekannt", "mehrNamenAlsPersonen", "gleicheAdresse", "emailUngueltig")

/** Felder, die andere mit belegen (felderFuer in importKern.js). */
private val BELEGT = mapOf("datumUhrzeit" to listOf("datum", "uhrzeit"), "vollname" to listOf("vorname", "nachname"))

private class Quelle(val datei: String, val dateiname: String)

/**
 * ImportView.jsx: Fahrten oder Fahrgaeste aus beliebiger Tabelle.
 * Ablauf: Datei -> Erkennung -> Zuordnung und Vorschau pruefen (jede Zeile aenderbar) -> Import.
 * Erkennung, Dubletten, Adresspruefung und Import laufen auf dem Server (dispo-admin, siehe ImportDienst).
 * `zurueck` = backView (Fahrt erstellen bzw. Fahrgastliste), `zumZiel` = zielView (Fahrtenliste bzw. Fahrgastliste).
 */
@Composable
fun ImportSeite(modus: ImportModus, zurueck: () -> Unit, zumZiel: () -> Unit) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    val fahrten = modus == ImportModus.FAHRTEN
    var schritt by remember { mutableStateOf(Schritt.DATEI) }
    var quelle by remember { mutableStateOf<Quelle?>(null) }
    var analyse by remember { mutableStateOf<Analyse?>(null) }
    var saetze by remember { mutableStateOf<List<Satz>>(emptyList()) }
    var offen by remember { mutableStateOf<Int?>(null) }
    var adressen by remember { mutableStateOf<Map<String, ImportDienst.Adresse>?>(null) }
    var neuBerechnen by remember { mutableStateOf(false) }
    var fehler by remember { mutableStateOf("") }
    var ergebnis by remember { mutableStateOf<ImportDienst.Ergebnis?>(null) }
    var rueckgaengigText by remember { mutableStateOf("") }
    var importe by remember { mutableStateOf<List<ImportDienst.Eintrag>>(emptyList()) }
    var beschaeftigt by remember { mutableStateOf(false) }
    var offenesMenue by remember { mutableStateOf<Int?>(null) }

    fun fehlerText(e: Throwable): String {
        val code = (e as? ImportFehler)?.code ?: e.message ?: ""
        if (code in listOf("datei_zu_gross", "datei_unlesbar", "datei_leer", "nichts_zu_importieren")) return t("imp.fehler.$code")
        if (code.contains("not_signed_in", ignoreCase = true)) return t("erstellen.errorSessionExpired")
        return t("sonstige.dateiLesenFehler", mapOf("message" to code))
    }

    fun listeLaden() {
        scope.launch { importe = runCatching { ImportDienst.liste(modus) }.getOrElse { if (it is kotlinx.coroutines.CancellationException) throw it; emptyList() } }
    }
    LaunchedEffect(modus) { listeLaden() }

    fun uebernehmen(a: Analyse) {
        analyse = a
        saetze = a.datensaetze
        offen = null
        adressen = null
    }

    fun auswerten(eingabe: Quelle, blatt: Int? = null, zuordnung: Map<Int, String>? = null, warten: Boolean = true) {
        fehler = ""
        if (warten) schritt = Schritt.ERKENNUNG else neuBerechnen = true
        scope.launch {
            try {
                val pause = async { if (warten) delay(ERKENNUNG_MS) }
                val a = ImportDienst.analysieren(modus, eingabe.datei, eingabe.dateiname, blatt, zuordnung)
                pause.await()
                uebernehmen(a)
                schritt = Schritt.ZUORDNUNG
            } catch (e: kotlinx.coroutines.CancellationException) {
                throw e
            } catch (e: Exception) {
                fehler = fehlerText(e)
                if (warten) schritt = Schritt.DATEI
            } finally {
                neuBerechnen = false
            }
        }
    }

    fun dateiGewaehlt(uri: Uri) {
        fehler = ""
        scope.launch {
            val gelesen = withContext(Dispatchers.IO) {
                runCatching {
                    val name = runCatching {
                        ctx.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
                            if (c.moveToFirst()) c.getString(0) else null
                        }
                    }.getOrNull() ?: (uri.lastPathSegment ?: "")
                    val daten = ctx.contentResolver.openInputStream(uri)?.use { it.readBytes() } ?: ByteArray(0)
                    name to daten
                }
            }
            gelesen.onSuccess { (name, daten) ->
                if (daten.size > MAX_BYTES) { fehler = t("imp.fehler.datei_zu_gross"); return@onSuccess }
                if (daten.isEmpty()) { fehler = t("imp.fehler.datei_leer"); return@onSuccess }
                val eingabe = Quelle(Base64.encodeToString(daten, Base64.NO_WRAP), name)
                quelle = eingabe
                auswerten(eingabe)
            }.onFailure { e ->
                fehler = t("sonstige.dateiLesenFehler", mapOf("message" to (e.message ?: "")))
            }
        }
    }

    // accept=".xlsx,.xlsm,.xls,.ods,.csv,.tsv,.txt,text/csv"
    val waehler = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri -> if (uri != null) dateiGewaehlt(uri) }

    // Adressen pruefen, sobald die Vorschau steht (nur Fahrten).
    LaunchedEffect(analyse, schritt) {
        val a = analyse
        if (schritt != Schritt.ZUORDNUNG || !fahrten || a == null) return@LaunchedEffect
        adressen = null
        val liste = a.datensaetze.flatMap { listOf(ImportDienst.text(it.daten["pickup_address"]), ImportDienst.text(it.daten["dropoff_address"])) }
            .filter { it.isNotEmpty() }.distinct()
        adressen = try {
            ImportDienst.adressenPruefen(liste)
        } catch (e: kotlinx.coroutines.CancellationException) {
            throw e
        } catch (e: Exception) {
            emptyMap()
        }
    }

    /** Spalte neu zuordnen: der Server baut die Datensaetze neu. Ein Feld gehoert immer nur einer Spalte. */
    fun zuordnen(spaltenIndex: Int, feld: String) {
        val a = analyse ?: return
        val q = quelle ?: return
        val neu = a.zuordnung.toMutableMap()
        val belegt = BELEGT[feld] ?: emptyList()
        for ((idx, f) in a.zuordnung) {
            val kollidiert = f == feld || f in belegt || feld in (BELEGT[f] ?: emptyList())
            if (feld.isNotEmpty() && kollidiert && idx != spaltenIndex) neu.remove(idx)
        }
        if (feld.isEmpty()) neu.remove(spaltenIndex) else neu[spaltenIndex] = feld
        auswerten(q, blatt = a.blatt, zuordnung = neu, warten = false)
    }

    fun blattWechseln(blatt: Int) { quelle?.let { auswerten(it, blatt = blatt, warten = false) } }

    /** Zeile bearbeiten und sofort neu pruefen. */
    fun satzAendern(index: Int, aenderung: Map<String, JsonElement>) {
        saetze = saetze.mapIndexed { i, s -> if (i != index) s else ImportDienst.pruefen(modus, s.copy(daten = JsonObject(s.daten + aenderung))) }
    }

    // Adresshinweise an die Saetze haengen (nur Anzeige, blockiert nichts).
    val mitAdressen = saetze.map { s ->
        val ad = adressen
        if (!fahrten || ad == null) return@map s
        val unbekannt = listOf(ImportDienst.text(s.daten["pickup_address"]), ImportDienst.text(s.daten["dropoff_address"]))
            .any { it.isNotEmpty() && ad[it]?.gefunden == false }
        val hinweise = s.hinweise.filter { it != "adresseUnbekannt" }
        s.copy(hinweise = if (unbekannt) hinweise + "adresseUnbekannt" else hinweise)
    }
    val bereit = mitAdressen.filter { !it.aus && it.fehlt.isEmpty() }
    val unvollstaendig = mitAdressen.filter { !it.aus && it.fehlt.isNotEmpty() }

    fun importieren() {
        val a = analyse ?: return
        if (bereit.isEmpty() || beschaeftigt) return
        beschaeftigt = true
        fehler = ""
        val vorlage = a.spalten.filter { !it.ohneTitel && a.zuordnung[it.index] != null }
            .associate { ImportDienst.schluessel(it.titel) to a.zuordnung.getValue(it.index) }
        val daten = bereit.map { it.daten }
        scope.launch {
            try {
                ergebnis = ImportDienst.ausfuehren(modus, daten, a.dateiname, a.signatur, vorlage)
                rueckgaengigText = ""
                schritt = Schritt.FERTIG
                listeLaden()
            } catch (e: kotlinx.coroutines.CancellationException) {
                throw e
            } catch (e: Exception) {
                fehler = t("sonstige.importFehlgeschlagen", mapOf("message" to fehlerText(e)))
            } finally {
                beschaeftigt = false
            }
        }
    }

    fun rueckgaengig(importId: String) {
        if (beschaeftigt) return
        beschaeftigt = true
        scope.launch {
            try {
                val r = ImportDienst.rueckgaengig(importId)
                rueckgaengigText = t("imp.rueckgaengigFertig", mapOf("n" to "${r.geloescht}")) +
                    (if (r.behalten > 0) " " + t("imp.rueckgaengigBehalten", mapOf("n" to "${r.behalten}")) else "")
                listeLaden()
            } catch (e: kotlinx.coroutines.CancellationException) {
                throw e
            } catch (e: Exception) {
                fehler = fehlerText(e)
            } finally {
                beschaeftigt = false
            }
        }
    }

    fun neuStarten() {
        schritt = Schritt.DATEI; analyse = null; saetze = emptyList(); quelle = null
        fehler = ""; ergebnis = null; rueckgaengigText = ""; offen = null
    }

    // Liegt ueber dem Formular: Tipps nicht nach unten durchreichen.
    Box(Modifier.fillMaxSize().background(Color.Black).pointerInput(Unit) { awaitPointerEventScope { while (true) awaitPointerEvent() } }) {
        DispoHintergrund()
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(start = 20.dp, end = 20.dp, top = 60.dp, bottom = 90.dp)) {
            ZurueckKnopf(aktion = zurueck)
            Text(t(if (fahrten) "sonstige.fahrtenImportTitle" else "sonstige.kundenImportTitle"), style = stil(42f, 700, 42f, farbe = LIME),
                modifier = Modifier.padding(top = 30.dp))
            when (schritt) {
                // --- 1. Datei ---
                Schritt.DATEI -> {
                    Text(t("imp.hinweis"), style = stil(13f, 500, 18f, farbe = LIME_HALB), modifier = Modifier.padding(top = 24.dp))
                    Row(
                        Modifier.padding(top = 24.dp).fillMaxWidth().height(56.dp).background(LIME).tippen {
                            waehler.launch(arrayOf(
                                "text/csv", "text/comma-separated-values", "text/tab-separated-values", "text/plain",
                                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/vnd.ms-excel",
                                "application/vnd.ms-excel.sheet.macroEnabled.12", "application/vnd.oasis.opendocument.spreadsheet",
                                "application/octet-stream",
                            ))
                        }.padding(horizontal = 16.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(t("sonstige.dateiAuswaehlen"), style = stil(16f, 500, abstand = 0.4f, farbe = hex(0x1D1C1D)))
                        Spacer(Modifier.weight(1f))
                        Icon("import-datei", Modifier.size(42.dp, 40.dp))
                    }
                    if (importe.isNotEmpty()) {
                        Text(t("imp.letzteImporte"), style = stil(13f, 500, farbe = LIME_HALB), modifier = Modifier.padding(top = 28.dp))
                        Column(Modifier.padding(top = 10.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            importe.forEach { imp -> ImportEintrag(imp, beschaeftigt) { rueckgaengig(imp.id) } }
                        }
                        if (rueckgaengigText.isNotEmpty()) {
                            Text(rueckgaengigText, style = stil(12f, 500, 16f, farbe = GRUEN), modifier = Modifier.padding(top = 8.dp))
                        }
                    }
                }
                // --- 2. Erkennung ---
                Schritt.ERKENNUNG -> Column(Modifier.fillMaxWidth().padding(top = 40.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                    ImportFunken(pulsieren = true)
                    Text(t("imp.erkennt"), style = stil(18f, 700, farbe = LIME), textAlign = TextAlign.Center, modifier = Modifier.padding(top = 14.dp))
                    Text(quelle?.dateiname ?: "", style = stil(12f, 500, farbe = Color.White.copy(alpha = 0.5f)), textAlign = TextAlign.Center,
                        modifier = Modifier.padding(top = 6.dp))
                }
                // --- 3. Zuordnung und Vorschau ---
                Schritt.ZUORDNUNG -> analyse?.let { a ->
                    Column(Modifier.alpha(if (neuBerechnen) 0.5f else 1f)) {
                        ZuordnungUndVorschau(
                            a = a,
                            fahrten = fahrten,
                            saetze = mitAdressen,
                            bereit = bereit.size,
                            unvollstaendig = unvollstaendig.size,
                            adressen = adressen,
                            offen = offen,
                            offenesMenue = offenesMenue,
                            gesperrt = neuBerechnen,
                            beschaeftigt = beschaeftigt,
                            neuStarten = { neuStarten() },
                            blattWechseln = { blattWechseln(it) },
                            menue = { offenesMenue = it },
                            zuordnen = { i, f -> zuordnen(i, f) },
                            umschalten = { i -> saetze = saetze.mapIndexed { j, s -> if (j == i) s.copy(aus = !s.aus) else s } },
                            oeffnen = { i -> offen = if (offen == i) null else i },
                            aendern = { i, w -> satzAendern(i, w) },
                            importieren = { importieren() },
                        )
                    }
                }
                // --- 4. Fertig ---
                Schritt.FERTIG -> {
                    Text(t(if (fahrten) "imp.fahrtenImportiert" else "imp.gaesteImportiert", mapOf("n" to "${ergebnis?.anzahl ?: 0}")),
                        style = stil(18f, 700, farbe = GRUEN), modifier = Modifier.padding(top = 28.dp))
                    Row(
                        Modifier.padding(top = 20.dp).fillMaxWidth().height(56.dp).background(LIME).tippen(zumZiel).padding(horizontal = 16.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(t(if (fahrten) "imp.zuDenFahrten" else "imp.zuDenFahrgaesten"), style = stil(16f, 500, abstand = 0.4f, farbe = hex(0x1D1C1D)))
                        Spacer(Modifier.weight(1f))
                        Icon("Arrow_Trisar_Icons_01", Modifier.size(34.dp, 20.dp))
                    }
                    Box(
                        Modifier.padding(top = 10.dp).fillMaxWidth().height(48.dp).border(2.dp, LIME).tippen { neuStarten() }.padding(horizontal = 16.dp),
                        contentAlignment = Alignment.CenterStart,
                    ) { Text(t("imp.weitereDatei"), style = stil(14f, 500, farbe = LIME)) }
                    val id = ergebnis?.importId
                    if (id != null && rueckgaengigText.isEmpty()) {
                        Box(
                            Modifier.padding(top = 10.dp).fillMaxWidth().height(48.dp).alpha(if (beschaeftigt) 0.4f else 1f).border(2.dp, ORANGE)
                                .tippen { rueckgaengig(id) }.padding(horizontal = 16.dp),
                            contentAlignment = Alignment.CenterStart,
                        ) { Text(t("imp.rueckgaengig"), style = stil(14f, 500, farbe = ORANGE)) }
                    }
                    if (rueckgaengigText.isNotEmpty()) {
                        Text(rueckgaengigText, style = stil(13f, 500, 17f, farbe = GRUEN), modifier = Modifier.padding(top = 10.dp))
                    }
                    // Weitere Blaetter derselben Datei: neu erkennen, schon importierte Fahrten kommen als 'doppelt' zurueck.
                    val a = analyse
                    val q = quelle
                    if (a != null && q != null && a.blaetter.size > 1) {
                        a.blaetter.filter { it.index != a.blatt }.forEach { b ->
                            Box(
                                Modifier.padding(top = 10.dp).fillMaxWidth().height(48.dp).alpha(if (beschaeftigt) 0.4f else 1f).border(2.dp, LIME)
                                    .tippen { if (!beschaeftigt) auswerten(q, blatt = b.index) }.padding(horizontal = 16.dp),
                                contentAlignment = Alignment.CenterStart,
                            ) {
                                Text(t("imp.blattImportieren", mapOf("name" to b.name)), style = stil(14f, 500, farbe = LIME),
                                    maxLines = 1, overflow = TextOverflow.Ellipsis)
                            }
                        }
                    }
                }
            }
            if (fehler.isNotEmpty()) {
                Text(fehler, style = stil(12f, 500, 16f, farbe = ORANGE),
                    modifier = Modifier.padding(top = 16.dp).fillMaxWidth().background(hex(0x171717)).border(2.dp, ORANGE.copy(alpha = 0.6f))
                        .padding(horizontal = 12.dp, vertical = 8.dp))
            }
        }
        FussleisteUnten()
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun ZuordnungUndVorschau(
    a: Analyse,
    fahrten: Boolean,
    saetze: List<Satz>,
    bereit: Int,
    unvollstaendig: Int,
    adressen: Map<String, ImportDienst.Adresse>?,
    offen: Int?,
    offenesMenue: Int?,
    gesperrt: Boolean,
    beschaeftigt: Boolean,
    neuStarten: () -> Unit,
    blattWechseln: (Int) -> Unit,
    menue: (Int?) -> Unit,
    zuordnen: (Int, String) -> Unit,
    umschalten: (Int) -> Unit,
    oeffnen: (Int) -> Unit,
    aendern: (Int, Map<String, JsonElement>) -> Unit,
    importieren: () -> Unit,
) {
    val zugeordnet = a.spalten.count { a.zuordnung[it.index] != null }
    Row(Modifier.padding(top = 20.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(a.dateiname, style = stil(12f, 500, farbe = Color.White.copy(alpha = 0.5f)), maxLines = 1, overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f, fill = false).padding(end = 12.dp))
        Spacer(Modifier.weight(1f))
        Text(t("imp.andereDatei"), style = stil(12f, 500, farbe = LIME).copy(textDecoration = TextDecoration.Underline),
            modifier = Modifier.tippen { if (!gesperrt) neuStarten() })
    }

    // Mehrere Tabellenblaetter: das passende ist gewaehlt, wechseln geht.
    if (a.blaetter.size > 1) {
        Text(t("imp.blatt"), style = stil(11f, 500, farbe = Color.White.copy(alpha = 0.5f)), modifier = Modifier.padding(top = 14.dp))
        FlowRow(Modifier.padding(top = 6.dp), horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            a.blaetter.forEach { b ->
                val aktiv = b.index == a.blatt
                Box(
                    Modifier.height(30.dp).background(if (aktiv) LIME else Color.Transparent)
                        .border(1.dp, if (aktiv) LIME else Color.White.copy(alpha = 0.3f))
                        .tippen { if (!aktiv && !gesperrt) blattWechseln(b.index) }.padding(horizontal = 12.dp),
                    contentAlignment = Alignment.Center,
                ) { Text(b.name, style = stil(12f, 500, farbe = if (aktiv) Color.Black else Color.White.copy(alpha = 0.7f))) }
            }
        }
    }

    if (a.vorlageGenutzt) Banner(t("imp.vorlageGenutzt", mapOf("name" to a.vorlageName)), GRUEN)
    if (a.llamaGenutzt) Banner(t("imp.llamaGenutzt"), ORANGE)

    Row(Modifier.padding(top = 20.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        ImportFunken(pulsieren = false)
        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(t("imp.zuordnung"), style = stil(20f, 700, 20f, farbe = LIME))
            Text(t("imp.zugeordnetVon", mapOf("n" to "$zugeordnet", "gesamt" to "${a.spalten.size}")), style = stil(12f, 500, farbe = LIME_HALB))
        }
    }
    if (a.fehlendeZuordnung.isNotEmpty()) {
        Text(t("imp.pflichtFehlt", mapOf("felder" to a.fehlendeZuordnung.joinToString(", ") { feldText(it) })),
            style = stil(12f, 500, 16f, farbe = ORANGE), modifier = Modifier.padding(top = 10.dp))
    }
    Column(Modifier.padding(top = 14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        a.spalten.forEach { s ->
            SpaltenKarte(s, a.zuordnung[s.index] ?: "", a.felder, offenesMenue == s.index, { menue(if (it && !gesperrt) s.index else null) }) { zuordnen(s.index, it) }
        }
    }

    Text(t("imp.vorschau"), style = stil(20f, 700, farbe = LIME), modifier = Modifier.padding(top = 24.dp))
    Text(buildAnnotatedString {
        withStyle(SpanStyle(color = LIME_HALB)) { append(t("imp.bereit", mapOf("n" to "$bereit"))) }
        if (unvollstaendig > 0) withStyle(SpanStyle(color = ROT)) { append(" · " + t("imp.unvollstaendigKurz", mapOf("n" to "$unvollstaendig"))) }
    }, style = stil(12f, 500, 16f), modifier = Modifier.padding(top = 4.dp))
    if (fahrten) {
        val stand = adressen?.let { ad -> t("imp.adressenOk", mapOf("n" to "${ad.values.count { it.gefunden }}", "gesamt" to "${ad.size}")) } ?: t("imp.adressenPruefen")
        Text(stand, style = stil(11f, 500, farbe = Color.White.copy(alpha = 0.45f)), modifier = Modifier.padding(top = 2.dp))
    }

    Column(Modifier.padding(top = 10.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        saetze.forEachIndexed { index, s ->
            key(index) {
                VorschauZeile(s, fahrten, adressen, offen == index, { if (!gesperrt) umschalten(index) }, { if (!gesperrt) oeffnen(index) }) { aendern(index, it) }
            }
        }
    }

    val aus = beschaeftigt || gesperrt || bereit == 0
    Row(
        Modifier.padding(top = 16.dp).fillMaxWidth().height(56.dp).alpha(if (aus) 0.4f else 1f).background(LIME)
            .tippen { if (!aus) importieren() }.padding(horizontal = 16.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            if (beschaeftigt) t("sonstige.uebernehme") else t(if (fahrten) "imp.fahrtenImportieren" else "imp.gaesteImportieren", mapOf("n" to "$bereit")),
            style = stil(16f, 500, abstand = 0.4f, farbe = hex(0x1D1C1D)),
        )
        Spacer(Modifier.weight(1f))
        Icon("Arrow_Trisar_Icons_01", Modifier.size(34.dp, 20.dp))
    }
    if (unvollstaendig > 0) {
        Text(t("imp.unvollstaendigHinweis"), style = stil(11f, 500, 16f, farbe = Color.White.copy(alpha = 0.45f)), modifier = Modifier.padding(top = 6.dp))
    }
}

@Composable
private fun Banner(text: String, farbe: Color) {
    Row(Modifier.padding(top = 14.dp).fillMaxWidth()) {
        Box(Modifier.width(2.dp).height(32.dp).background(farbe))
        Text(text, style = stil(12f, 500, 16f, farbe = farbe), modifier = Modifier.padding(start = 12.dp))
    }
}

@Composable
private fun ImportEintrag(imp: ImportDienst.Eintrag, beschaeftigt: Boolean, rueckgaengig: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().background(hex(0x0F0F0F)).border(2.dp, Color.White.copy(alpha = 0.12f)).padding(horizontal = 12.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Text(imp.dateiname.ifEmpty { "—" }, style = stil(13f, 500), maxLines = 1, overflow = TextOverflow.Ellipsis)
            val stand = if (imp.rueckgaengig) t("imp.wurdeRueckgaengig") else t("imp.nochDa", mapOf("n" to "${imp.vorhanden}", "gesamt" to "${imp.anzahl}"))
            Text("${zeitpunkt(imp.erstellt)} · $stand", style = stil(11f, 500, farbe = Color.White.copy(alpha = 0.45f)))
        }
        if (!imp.rueckgaengig && imp.vorhanden > 0) {
            Text(t("imp.rueckgaengigKurz"), style = stil(12f, 500, farbe = ORANGE).copy(textDecoration = TextDecoration.Underline),
                modifier = Modifier.padding(start = 8.dp).alpha(if (beschaeftigt) 0.4f else 1f).tippen { if (!beschaeftigt) rueckgaengig() })
        }
    }
}

@Composable
private fun SpaltenKarte(
    spalte: ImportDienst.Spalte,
    feld: String,
    felder: List<String>,
    menueOffen: Boolean,
    menue: (Boolean) -> Unit,
    waehlen: (String) -> Unit,
) {
    val sicher = feld.isNotEmpty() && (spalte.sicherheit >= 0.8 || spalte.grundVorlage)
    val pruefen = feld.isNotEmpty() && !sicher
    Column(
        Modifier.fillMaxWidth().background(hex(0x0F0F0F))
            .border(2.dp, if (feld.isEmpty()) Color.White.copy(alpha = 0.12f) else LIME.copy(alpha = 0.55f))
            .padding(horizontal = 12.dp, vertical = 10.dp)
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(spalte.titel, style = stil(15f, 700, farbe = if (feld.isEmpty()) Color.White.copy(alpha = 0.55f) else LIME), maxLines = 1,
                overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
            Spacer(Modifier.weight(1f))
            if (sicher) Abzeichen(t("imp.sicher"), LIME)
            if (pruefen) Abzeichen(t("imp.pruefen"), ORANGE)
        }
        Text(spalte.beispiele.take(3).joinToString(" · "), style = stil(11f, 500, farbe = Color.White.copy(alpha = 0.45f)), maxLines = 1,
            overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 3.dp))
        Box(Modifier.padding(top = 8.dp)) {
            Row(
                Modifier.fillMaxWidth().height(38.dp).background(Color.Black)
                    .border(1.dp, if (feld.isEmpty()) Color.White.copy(alpha = 0.25f) else LIME).tippen { menue(true) }.padding(horizontal = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(if (feld.isEmpty()) t("imp.nichtImportieren") else t("imp.feld.$feld"),
                    style = stil(14f, 500, farbe = if (feld.isEmpty()) Color.White.copy(alpha = 0.6f) else LIME), maxLines = 1, modifier = Modifier.weight(1f))
                Text("▾", style = TextStyle(fontSize = 12.sp, color = if (feld.isEmpty()) Color.White.copy(alpha = 0.5f) else LIME))
            }
            MaterialTheme(colorScheme = darkColorScheme()) {
                DropdownMenu(menueOffen, { menue(false) }) {
                    DropdownMenuItem({ Text(t("imp.nichtImportieren")) }, { menue(false); if (feld.isNotEmpty()) waehlen("") })
                    felder.forEach { f -> DropdownMenuItem({ Text(t("imp.feld.$f")) }, { menue(false); if (f != feld) waehlen(f) }) }
                }
            }
        }
        Text(grundText(spalte), style = stil(10f, 500, 13f, farbe = Color.White.copy(alpha = 0.4f)), modifier = Modifier.padding(top = 6.dp))
    }
}

@Composable
private fun Abzeichen(text: String, farbe: Color) {
    Box(Modifier.height(20.dp).background(farbe).padding(horizontal = 8.dp), contentAlignment = Alignment.Center) {
        Text(text, style = stil(10f, 700, farbe = Color.Black))
    }
}

private fun grundText(s: ImportDienst.Spalte): String {
    if (s.vorschlag == null) return t("imp.keinTreffer")
    if (s.grundVorlage) return t("imp.grundVorlage")
    if (s.grundLlama) return t("imp.grundLlama")
    val teile = mutableListOf<String>()
    s.grundKopf?.let { teile.add(t("imp.grundKopf", mapOf("titel" to it))) }
    s.grundWerte?.let { teile.add(t("imp.grundWerte", mapOf("anteil" to "${s.grundAnteil}", "art" to t("imp.art.$it")))) }
    return teile.joinToString(" · ").ifEmpty { t("imp.vonHandGeaendert") }
}

// MARK: Vorschau-Zeile mit Editor

@Composable
private fun VorschauZeile(
    s: Satz,
    fahrten: Boolean,
    adressen: Map<String, ImportDienst.Adresse>?,
    istOffen: Boolean,
    umschalten: () -> Unit,
    oeffnen: () -> Unit,
    aendern: (Map<String, JsonElement>) -> Unit,
) {
    val warnt = s.hinweise.any { it in WARNUNGEN }
    val rand = when {
        s.aus -> Color.White.copy(alpha = 0.1f)
        s.fehlt.isNotEmpty() -> ROT
        warnt -> ORANGE
        else -> LIME.copy(alpha = 0.4f)
    }
    val (titel, detail) = if (fahrten) fahrtZeile(s.daten) else gastZeile(s.daten)
    Column(Modifier.fillMaxWidth().alpha(if (s.aus) 0.5f else 1f).background(hex(0x0F0F0F)).border(2.dp, rand)) {
        Row(Modifier.padding(horizontal = 12.dp, vertical = 8.dp), verticalAlignment = Alignment.Top, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Haken(!s.aus, Modifier.padding(top = 2.dp).tippen(umschalten))
            Column(Modifier.weight(1f).tippen(oeffnen)) {
                Text(titel, style = stil(14f, 500, farbe = LIME), maxLines = 1, overflow = TextOverflow.Ellipsis)
                if (detail.isNotEmpty()) Text(detail, style = stil(11f, 500, farbe = Color.White.copy(alpha = 0.5f)), maxLines = 1, overflow = TextOverflow.Ellipsis)
                if (s.fehlt.isNotEmpty()) {
                    Text(t("imp.fehltFeld", mapOf("felder" to s.fehlt.joinToString(", ") { feldText(it) })), style = stil(11f, 500, 15f, farbe = ROT))
                }
                if (s.hinweise.isNotEmpty()) {
                    Text(s.hinweise.joinToString(" · ") { hinweisText(it, s) }, style = stil(11f, 500, 15f, farbe = if (warnt) ORANGE else Color.White.copy(alpha = 0.45f)))
                }
            }
            Text(if (istOffen) "▴" else "✎", style = stil(11f, 500, farbe = Color.White.copy(alpha = 0.4f)), modifier = Modifier.tippen(oeffnen))
        }
        if (istOffen) {
            Box(Modifier.fillMaxWidth().height(1.dp).background(Color.White.copy(alpha = 0.1f)))
            Column(Modifier.padding(start = 12.dp, end = 12.dp, top = 8.dp, bottom = 12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                if (fahrten) FahrtEditor(s.daten, adressen, aendern) else GastEditor(s.daten, aendern)
            }
        }
    }
}

@Composable
private fun FahrtEditor(d: JsonObject, adressen: Map<String, ImportDienst.Adresse>?, aendern: (Map<String, JsonElement>) -> Unit) {
    val ctx = LocalContext.current
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        val datum = wert(d, "ride_date")
        WaehlFeld(feldText("datum"), datumLang(datum), Modifier.weight(1f)) {
            val heute = runCatching { LocalDate.parse(datum) }.getOrElse { LocalDate.now() }
            DatePickerDialog(ctx, android.R.style.Theme_Material_Dialog_Alert, { _, y, mo, tag ->
                aendern(mapOf("ride_date" to JsonPrimitive(LocalDate.of(y, mo + 1, tag).toString())))
            }, heute.year, heute.monthValue - 1, heute.dayOfMonth).show()
        }
        val zeit = wert(d, "etd").take(5)
        WaehlFeld(feldText("uhrzeit"), zeit, Modifier.weight(1f)) {
            val jetzt = runCatching { LocalTime.parse(zeit) }.getOrElse { LocalTime.of(12, 0) }
            TimePickerDialog(ctx, android.R.style.Theme_Material_Dialog_Alert, { _, h, mi ->
                val neu = JsonPrimitive("%02d:%02d:00".format(h, mi))
                aendern(mapOf("etd" to neu, "original_etd" to neu))
            }, jetzt.hour, jetzt.minute, true).show()
        }
    }
    EditFeld(feldText("abholort"), wert(d, "pickup_address")) {
        aendern(mapOf("pickup_address" to JsonPrimitive(it), "pickup_name" to JsonPrimitive(ImportDienst.kurzname(it))))
    }
    EditFeld(feldText("zielort"), wert(d, "dropoff_address")) {
        aendern(mapOf("dropoff_address" to JsonPrimitive(it), "dropoff_name" to JsonPrimitive(ImportDienst.kurzname(it))))
    }
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        EditFeld(feldText("flugnummer"), wert(d, "flight_number").ifEmpty { wert(d, "train_number") }, Modifier.weight(1f), gross = KeyboardCapitalization.Characters) {
            aendern(
                if (ZUG.containsMatchIn(it)) mapOf("train_number" to JsonPrimitive(it), "flight_number" to JsonNull)
                else mapOf("flight_number" to JsonPrimitive(it), "train_number" to JsonNull)
            )
        }
        EditFeld(feldText("anzahl"), wert(d, "anzahl"), Modifier.weight(1f), tastatur = KeyboardType.Number) {
            val n = it.trim().toDoubleOrNull()
            aendern(mapOf("anzahl" to if (it.isEmpty() || n == null) JsonNull else if (n % 1.0 == 0.0) JsonPrimitive(n.toLong()) else JsonPrimitive(n)))
        }
    }
    val gaeste = (d["passengers"] as? JsonArray)?.mapNotNull { (it as? JsonPrimitive)?.takeIf { p -> p !is JsonNull }?.content } ?: emptyList()
    EditFeld(feldText("gaeste"), gaeste.joinToString(", "), gross = KeyboardCapitalization.Words) { v ->
        aendern(mapOf("passengers" to JsonArray(v.split(Regex("\\s*,\\s*")).filter { it.isNotEmpty() }.map { JsonPrimitive(it) })))
    }
    EditFeld(feldText("notiz"), wert(d, "note")) { aendern(mapOf("note" to JsonPrimitive(it))) }
    if (adressen != null) {
        listOf(ImportDienst.text(d["pickup_address"]), ImportDienst.text(d["dropoff_address"])).filter { it.isNotEmpty() && adressen[it]?.gefunden == true }.distinct().forEach { a ->
            Text("$a → ${adressen[a]?.name ?: ""}", style = stil(10f, 500, 13f, farbe = Color.White.copy(alpha = 0.4f)))
        }
    }
}

@Composable
private fun GastEditor(d: JsonObject, aendern: (Map<String, JsonElement>) -> Unit) {
    fun oderNull(v: String): JsonElement = if (v.isEmpty()) JsonNull else JsonPrimitive(v)
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        EditFeld(feldText("vorname"), wert(d, "first_name"), Modifier.weight(1f), gross = KeyboardCapitalization.Words) { aendern(mapOf("first_name" to JsonPrimitive(it))) }
        EditFeld(feldText("nachname"), wert(d, "last_name"), Modifier.weight(1f), gross = KeyboardCapitalization.Words) { aendern(mapOf("last_name" to JsonPrimitive(it))) }
    }
    EditFeld(feldText("email"), wert(d, "email"), tastatur = KeyboardType.Email, gross = KeyboardCapitalization.None) { aendern(mapOf("email" to oderNull(it))) }
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        EditFeld(feldText("telefon"), wert(d, "phone"), Modifier.weight(1f), tastatur = KeyboardType.Phone) { aendern(mapOf("phone" to oderNull(it))) }
        EditFeld(feldText("firma"), wert(d, "company"), Modifier.weight(1f)) { aendern(mapOf("company" to oderNull(it))) }
    }
}

private val ZUG = Regex("^(ICE|IC|EC|RJ|RE|RB)\\s?\\d", RegexOption.IGNORE_CASE)

/** Eingabefeld mit eigenem Textstand, damit Kommas und Leerzeichen beim Tippen stehen bleiben. */
@Composable
private fun EditFeld(
    label: String,
    anfang: String,
    modifier: Modifier = Modifier,
    tastatur: KeyboardType = KeyboardType.Text,
    gross: KeyboardCapitalization = KeyboardCapitalization.Sentences,
    aendern: (String) -> Unit,
) {
    var text by remember { mutableStateOf(anfang) }
    Column(modifier, verticalArrangement = Arrangement.spacedBy(3.dp)) {
        Text(label, style = stil(10f, 500, farbe = Color.White.copy(alpha = 0.5f)))
        BasicTextField(
            value = text,
            onValueChange = { text = it; aendern(it) },
            singleLine = true,
            textStyle = stil(13f, 500),
            cursorBrush = SolidColor(LIME),
            keyboardOptions = KeyboardOptions(capitalization = gross, autoCorrectEnabled = false, keyboardType = tastatur),
            modifier = Modifier.fillMaxWidth().height(34.dp).background(Color.Black).border(1.dp, Color.White.copy(alpha = 0.25f)).padding(horizontal = 8.dp),
            decorationBox = { feld -> Box(contentAlignment = Alignment.CenterStart) { feld() } },
        )
    }
}

/** Feld, das beim Antippen einen Datums- oder Zeitdialog oeffnet. */
@Composable
private fun WaehlFeld(label: String, anzeige: String, modifier: Modifier = Modifier, oeffnen: () -> Unit) {
    Column(modifier, verticalArrangement = Arrangement.spacedBy(3.dp)) {
        Text(label, style = stil(10f, 500, farbe = Color.White.copy(alpha = 0.5f)))
        Box(
            Modifier.fillMaxWidth().height(34.dp).background(Color.Black).border(1.dp, Color.White.copy(alpha = 0.25f)).tippen(oeffnen).padding(horizontal = 8.dp),
            contentAlignment = Alignment.CenterStart,
        ) { Text(anzeige.ifEmpty { "—" }, style = stil(13f, 500, farbe = if (anzeige.isEmpty()) Color.White.copy(alpha = 0.4f) else Color.White)) }
    }
}

@Composable
private fun Haken(an: Boolean, modifier: Modifier = Modifier) {
    Box(
        modifier.size(16.dp).background(if (an) LIME else Color.Transparent).border(1.dp, if (an) LIME else Color.White.copy(alpha = 0.5f)),
        contentAlignment = Alignment.Center,
    ) { if (an) Text("✓", style = TextStyle(fontSize = 11.sp, color = Color.Black)) }
}

/** FunkenIcon aus ImportView.jsx (viewBox 29 x 29.14, Strich 2), mit animate-pulse waehrend der Erkennung. */
@Composable
private fun ImportFunken(pulsieren: Boolean) {
    val puls = rememberInfiniteTransition(label = "funken")
    val a by puls.animateFloat(1f, 0.5f, infiniteRepeatable(tween(1000), RepeatMode.Reverse), label = "alpha")
    Canvas(Modifier.size(22.dp).alpha(if (pulsieren) a else 1f)) {
        // Jeder Bogen ist "M p0 S c2 p1": erster Kontrollpunkt = Startpunkt.
        val boegen = listOf(
            Triple(Offset(12.08f, 29.07f), Offset(11.27f, 16.99f), Offset(0f, 16.99f)),
            Triple(Offset(12.08f, 4.9f), Offset(12.89f, 16.99f), Offset(24.17f, 16.99f)),
            Triple(Offset(12.08f, 4.9f), Offset(11.27f, 16.99f), Offset(0f, 16.99f)),
            Triple(Offset(12.08f, 29.07f), Offset(12.89f, 16.99f), Offset(24.17f, 16.99f)),
            Triple(Offset(22.96f, 12.15f), Offset(22.55f, 6.11f), Offset(16.92f, 6.11f)),
            Triple(Offset(22.96f, 12.15f), Offset(23.36f, 6.11f), Offset(29f, 6.11f)),
            Triple(Offset(22.96f, 0.07f), Offset(22.55f, 6.11f), Offset(16.92f, 6.11f)),
            Triple(Offset(22.96f, 0.07f), Offset(23.36f, 6.11f), Offset(29f, 6.11f)),
        )
        val s = minOf(size.width / 29f, size.height / 29.14f)
        val dx = (size.width - 29f * s) / 2f
        val dy = (size.height - 29.14f * s) / 2f
        fun p(q: Offset) = Offset(dx + q.x * s, dy + q.y * s)
        val pfad = Path()
        for ((a0, c2, b) in boegen) {
            val pa = p(a0); val pc = p(c2); val pb = p(b)
            pfad.moveTo(pa.x, pa.y)
            pfad.cubicTo(pa.x, pa.y, pc.x, pc.y, pb.x, pb.y)
        }
        drawPath(pfad, LIME, style = Stroke(width = 2f * 22.dp.toPx() / 29.14f))
    }
}

// MARK: Vorschau-Texte (fahrtZeile / gastZeile)

/** Wert als Text, Zahlen ohne ".0". */
private fun wert(d: JsonObject, k: String): String {
    val p = d[k] as? JsonPrimitive ?: return ""
    if (p is JsonNull) return ""
    return p.content
}

private fun datumKurz(iso: String): String = if (iso.length >= 10) "${iso.substring(8, 10)}.${iso.substring(5, 7)}.${iso.substring(2, 4)}" else ""
private fun datumLang(iso: String): String = if (iso.length >= 10) "${iso.substring(8, 10)}.${iso.substring(5, 7)}.${iso.substring(0, 4)}" else ""

private fun fahrtZeile(d: JsonObject): Pair<String, String> {
    val ab = wert(d, "pickup_name").ifEmpty { wert(d, "pickup_address") }.ifEmpty { "—" }
    val an = wert(d, "dropoff_name").ifEmpty { wert(d, "dropoff_address") }.ifEmpty { "—" }
    val titel = "${wert(d, "etd").ifEmpty { "--:--" }.take(5)} $ab → $an"
    val gaeste = (d["passengers"] as? JsonArray)?.mapNotNull { (it as? JsonPrimitive)?.takeIf { p -> p !is JsonNull }?.content } ?: emptyList()
    val anzahl = (d["anzahl"] as? JsonPrimitive)?.takeIf { it !is JsonNull }?.content?.toDoubleOrNull()
        ?.takeIf { it != 0.0 }?.let { if (it % 1.0 == 0.0) "${it.toLong()} P." else "$it P." } ?: ""
    val detail = listOf(datumKurz(wert(d, "ride_date")), wert(d, "flight_number").ifEmpty { wert(d, "train_number") }, gaeste.joinToString(", "), anzahl)
        .filter { it.isNotEmpty() }.joinToString(" · ")
    return titel to detail
}

private fun gastZeile(d: JsonObject): Pair<String, String> {
    val titel = "${wert(d, "first_name")} ${wert(d, "last_name")}".trim().ifEmpty { "—" }
    val detail = listOf(wert(d, "company"), wert(d, "email"), wert(d, "phone")).filter { it.isNotEmpty() }.joinToString(" · ")
    return titel to detail
}

private fun hinweisText(h: String, s: Satz): String =
    if (h == "mehrereZeilen") t("imp.h.mehrereZeilen", mapOf("n" to "${s.zeilen.size}")) else t("imp.h.$h")

private fun feldText(f: String): String = t("imp.feld.${if (f == "name") "vollname" else f}")

private val ZEIT_FORMAT = DateTimeFormatter.ofPattern("dd.MM.yy, HH:mm")

/** toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' }). */
private fun zeitpunkt(iso: String): String =
    runCatching { OffsetDateTime.parse(iso).atZoneSameInstant(ZoneId.systemDefault()).format(ZEIT_FORMAT) }
        .getOrElse { runCatching { OffsetDateTime.parse(iso.replace(' ', 'T')).atZoneSameInstant(ZoneId.systemDefault()).format(ZEIT_FORMAT) }.getOrElse { iso } }

// MARK: Texte aus admin/src/i18n/de.js

private fun t(k: String, w: Map<String, String> = emptyMap()): String {
    var s = texte[k] ?: k
    for ((a, b) in w) s = s.replace("{$a}", b)
    return s
}

private val texte = mapOf(
    "erstellen.errorSessionExpired" to "Deine Anmeldung ist abgelaufen. Bitte einmal abmelden und neu anmelden, dann erneut importieren.",
    "sonstige.fahrtenImportTitle" to "Fahrten Import",
    "sonstige.kundenImportTitle" to "Kunden Import",
    "sonstige.dateiAuswaehlen" to "Datei auswählen",
    "sonstige.dateiLesenFehler" to "Datei konnte nicht gelesen werden: {message}",
    "sonstige.importFehlgeschlagen" to "Import fehlgeschlagen: {message}",
    "sonstige.uebernehme" to "Übernehme ...",
    "imp.adressenOk" to "{n} von {gesamt} Adressen auf der Karte gefunden",
    "imp.adressenPruefen" to "Adressen werden geprüft …",
    "imp.andereDatei" to "Andere Datei",
    "imp.art.anzahl" to "Personenzahlen",
    "imp.art.datum" to "Datumsangaben",
    "imp.art.datumUhrzeit" to "Datum mit Uhrzeit",
    "imp.art.email" to "E-Mail-Adressen",
    "imp.art.flug" to "Flugnummern",
    "imp.art.flughafenCode" to "Flughafenkürzel",
    "imp.art.freitext" to "Freitext",
    "imp.art.janein" to "Ja/Nein",
    "imp.art.name" to "Namen",
    "imp.art.ort" to "Orte und Adressen",
    "imp.art.plz" to "Postleitzahlen",
    "imp.art.telefon" to "Telefonnummern",
    "imp.art.uhrzeit" to "Uhrzeiten",
    "imp.art.zug" to "Zugnummern",
    "imp.bereit" to "{n} bereit",
    "imp.blatt" to "Tabellenblatt",
    "imp.blattImportieren" to "Blatt „{name}“ importieren",
    "imp.erkennt" to "Spalten werden erkannt …",
    "imp.fahrtenImportieren" to "{n} Fahrten importieren",
    "imp.fahrtenImportiert" to "{n} Fahrten importiert.",
    "imp.feld.abholort" to "Abholort",
    "imp.feld.anzahl" to "Anzahl Personen",
    "imp.feld.datum" to "Datum",
    "imp.feld.datumUhrzeit" to "Datum & Uhrzeit",
    "imp.feld.email" to "E-Mail",
    "imp.feld.firma" to "Firma",
    "imp.feld.flugnummer" to "Flug- / Zugnummer",
    "imp.feld.gaeste" to "Fahrgäste",
    "imp.feld.gepaeck" to "Gepäck",
    "imp.feld.herkunft" to "Abflugort",
    "imp.feld.kindersitz" to "Kindersitz",
    "imp.feld.nachname" to "Nachname",
    "imp.feld.notiz" to "Notiz",
    "imp.feld.plz" to "PLZ",
    "imp.feld.rollstuhl" to "Rollstuhl",
    "imp.feld.sprache" to "Sprache",
    "imp.feld.stadt" to "Stadt",
    "imp.feld.strasse" to "Straße",
    "imp.feld.telefon" to "Telefon",
    "imp.feld.uhrzeit" to "Abholzeit",
    "imp.feld.vip" to "VIP",
    "imp.feld.vollname" to "Name",
    "imp.feld.vorname" to "Vorname",
    "imp.feld.zielort" to "Zielort",
    "imp.feld.zugnummer" to "Zugnummer",
    "imp.fehler.datei_leer" to "In der Datei wurden keine Datenzeilen gefunden.",
    "imp.fehler.datei_unlesbar" to "Die Datei lässt sich nicht lesen. Bitte als .xlsx oder .csv speichern und erneut versuchen.",
    "imp.fehler.datei_zu_gross" to "Die Datei ist größer als 8 MB.",
    "imp.fehler.nichts_zu_importieren" to "Keine vollständige Zeile zum Importieren.",
    "imp.fehltFeld" to "Fehlt: {felder}",
    "imp.gaesteImportieren" to "{n} Fahrgäste importieren",
    "imp.gaesteImportiert" to "{n} Fahrgäste importiert.",
    "imp.grundKopf" to "Überschrift „{titel}“",
    "imp.grundLlama" to "Von Llama vorgeschlagen, durch die Werte bestätigt",
    "imp.grundVorlage" to "Wie beim letzten Import dieser Tabelle",
    "imp.grundWerte" to "{anteil} % der Werte: {art}",
    "imp.h.adresseUnbekannt" to "Adresse nicht auf der Karte gefunden",
    "imp.h.datumAusDatei" to "Datum aus dem Kopf der Datei",
    "imp.h.datumUebernommen" to "Datum aus der Zeile darüber",
    "imp.h.doppelt" to "schon im System, darum abgewählt",
    "imp.h.emailUngueltig" to "E-Mail-Adresse ungültig",
    "imp.h.gleicheAdresse" to "Abholort und Ziel sind gleich",
    "imp.h.llama" to "von Llama gelesen",
    "imp.h.mehrNamenAlsPersonen" to "mehr Namen als Personen",
    "imp.h.mehrereZeilen" to "aus {n} Zeilen zusammengefasst",
    "imp.h.vergangen" to "Datum liegt in der Vergangenheit",
    "imp.h.zielAusDatei" to "Ziel aus dem Kopf der Datei",
    "imp.hinweis" to "Beliebige Tabelle aus Excel (.xlsx, .xls) oder CSV, auch mit mehreren Blättern. Die Spalten werden erkannt, du prüfst den Vorschlag, ergänzt fehlende Angaben und importierst. Jeder Import lässt sich rückgängig machen.",
    "imp.keinTreffer" to "Keine passende Bedeutung erkannt",
    "imp.letzteImporte" to "Letzte Importe",
    "imp.llamaGenutzt" to "Llama hat Spalten zugeordnet, die die Regeln nicht sicher erkannt haben. Bitte die markierten Spalten prüfen.",
    "imp.mitImportieren" to "Mit importieren",
    "imp.nichtImportieren" to "Nicht importieren",
    "imp.nochDa" to "{n} von {gesamt} noch da",
    "imp.pflichtFehlt" to "Keiner Spalte zugeordnet: {felder}. Spalte zuordnen oder in den Zeilen ergänzen.",
    "imp.pruefen" to "prüfen",
    "imp.rueckgaengig" to "Import rückgängig machen",
    "imp.rueckgaengigBehalten" to "{n} schon begonnen oder gefahren, die bleiben.",
    "imp.rueckgaengigFertig" to "{n} wieder entfernt.",
    "imp.rueckgaengigKurz" to "Rückgängig",
    "imp.sicher" to "sicher",
    "imp.unvollstaendigHinweis" to "Rot markierte Zeilen fehlen Angaben. Zeile antippen und ergänzen, sonst werden sie nicht importiert.",
    "imp.unvollstaendigKurz" to "{n} unvollständig",
    "imp.vonHandGeaendert" to "Von Hand zugeordnet",
    "imp.vorlageGenutzt" to "Zuordnung wie beim letzten Import dieser Tabelle ({name}).",
    "imp.vorschau" to "Vorschau",
    "imp.weitereDatei" to "Weitere Datei importieren",
    "imp.wurdeRueckgaengig" to "rückgängig gemacht",
    "imp.zuDenFahrgaesten" to "Zu den Fahrgästen",
    "imp.zuDenFahrten" to "Zu den Fahrten",
    "imp.zugeordnetVon" to "{n} von {gesamt} Spalten zugeordnet",
    "imp.zuordnung" to "Zuordnung",
)
