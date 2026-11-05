package de.trisar.dispo.einlesen

import android.net.Uri
import android.provider.OpenableColumns
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
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
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
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.style.LineHeightStyle
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
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
import kotlinx.serialization.json.JsonPrimitive

private val LIME = hex(0xE3F654)
private val LIME_HALB = hex(0xE3F654, 0.7f)
private val ORANGE = hex(0xFFCD8A)

private fun stil(groesse: Float, gewicht: Int = 400, zeile: Float? = null, abstand: Float = 0f, farbe: Color = Color.White): TextStyle =
    grotesk(groesse, gewicht, zeile, abstand, farbe).copy(lineHeightStyle = LineHeightStyle(LineHeightStyle.Alignment.Center, LineHeightStyle.Trim.None))

private enum class Schritt { DATEI, ERKENNUNG, ZUORDNUNG, FERTIG }

/**
 * ImportView.jsx (ImportAnsicht.swift): Fahrten oder Fahrgaeste aus beliebiger Tabelle.
 * Ablauf: Datei -> Erkennung -> Zuordnung pruefen -> Vorschau -> Import.
 * `zurueck` = backView (Fahrt erstellen bzw. Fahrgastliste), `zumZiel` = zielView (Fahrtenliste bzw. Fahrgastliste).
 */
@Composable
fun ImportSeite(modus: ImportModus, zurueck: () -> Unit, zumZiel: () -> Unit) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    var schritt by remember { mutableStateOf(Schritt.DATEI) }
    var dateiname by remember { mutableStateOf("") }
    var erkennung by remember { mutableStateOf<SpaltenErkennung.Ergebnis?>(null) }
    var zuordnung by remember { mutableStateOf<Map<Int, String>>(emptyMap()) }
    var fehler by remember { mutableStateOf("") }
    var importiert by remember { mutableStateOf(0) }
    var beschaeftigt by remember { mutableStateOf(false) }
    var offenesMenue by remember { mutableStateOf<Int?>(null) }

    val felder = SpaltenErkennung.felder(modus)
    val fahrten = modus == ImportModus.FAHRTEN
    val erg = erkennung?.let {
        if (fahrten) SpaltenErkennung.fahrtenBauen(it.datenzeilen, zuordnung) else SpaltenErkennung.gaesteBauen(it.datenzeilen, zuordnung)
    } ?: SpaltenErkennung.Gebaut(emptyList(), emptyList())

    fun neuStarten() { schritt = Schritt.DATEI; erkennung = null; zuordnung = emptyMap(); dateiname = ""; fehler = "" }

    fun auswerten(uri: Uri) {
        fehler = ""
        dateiname = runCatching {
            ctx.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
                if (c.moveToFirst()) c.getString(0) else null
            }
        }.getOrNull() ?: (uri.lastPathSegment ?: "")
        schritt = Schritt.ERKENNUNG
        val name = dateiname
        scope.launch {
            // Kleine Pause, damit die Erkennung als eigener Schritt sichtbar ist (ERKENNUNG_MS).
            val pause = async { delay(1400) }
            val gelesen = withContext(Dispatchers.IO) {
                runCatching {
                    val daten = ctx.contentResolver.openInputStream(uri)?.use { it.readBytes() } ?: throw TabellenLeser.Fehler("Datei leer.")
                    SpaltenErkennung.erkennen(TabellenLeser.lesen(name, daten), modus)
                }
            }
            pause.await()
            gelesen.onSuccess { e ->
                if (e.spalten.isEmpty() || e.datenzeilen.isEmpty()) {
                    fehler = t("imp.leer")
                    schritt = Schritt.DATEI
                    return@onSuccess
                }
                erkennung = e
                zuordnung = e.spalten.mapNotNull { s -> s.vorschlag?.let { s.index to it } }.toMap()
                schritt = Schritt.ZUORDNUNG
            }.onFailure { e ->
                fehler = t("sonstige.dateiLesenFehler", mapOf("message" to (e.message ?: "")))
                schritt = Schritt.DATEI
            }
        }
    }

    // accept=".xlsx,.xls,.csv,.tsv,.txt,text/csv"
    val waehler = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri -> if (uri != null) auswerten(uri) }

    /** Ein Feld gehoert immer nur einer Spalte, wird es anderswo gewaehlt, verliert die alte Spalte die Zuordnung. */
    fun zuordnen(spaltenIndex: Int, feld: String) {
        val neu = zuordnung.toMutableMap()
        val belegt = felder.firstOrNull { it.key == feld }?.belegt ?: emptyList()
        for ((idx, f) in zuordnung) {
            val kollidiert = f == feld || f in belegt || feld in (felder.firstOrNull { it.key == f }?.belegt ?: emptyList())
            if (feld.isNotEmpty() && kollidiert && idx != spaltenIndex) neu.remove(idx)
        }
        if (feld.isEmpty()) neu.remove(spaltenIndex) else neu[spaltenIndex] = feld
        zuordnung = neu
    }

    fun uebernehmen(saetze: List<Map<String, JsonElement>>) {
        if (saetze.isEmpty() || beschaeftigt) return
        beschaeftigt = true
        fehler = ""
        scope.launch {
            try {
                SpaltenErkennung.importieren(saetze, modus)
                importiert = saetze.size
                schritt = Schritt.FERTIG
            } catch (e: kotlinx.coroutines.CancellationException) {
                throw e
            } catch (e: Exception) {
                val text = (e as? io.github.jan.supabase.exceptions.RestException)?.error ?: e.message ?: ""
                fehler = t("sonstige.importFehlgeschlagen", mapOf("message" to text))
            } finally {
                beschaeftigt = false
            }
        }
    }

    // Liegt ueber dem Formular: Tipps nicht nach unten durchreichen.
    Box(Modifier.fillMaxSize().background(Color.Black).pointerInput(Unit) { awaitPointerEventScope { while (true) awaitPointerEvent() } }) {
        DispoHintergrund()
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(start = 20.dp, end = 20.dp, top = 60.dp, bottom = 90.dp)) {
            ZurueckKnopf(aktion = zurueck)
            Text(t(if (fahrten) "sonstige.fahrtenImportTitle" else "sonstige.kundenImportTitle"), style = stil(42f, 700, 42f, farbe = LIME),
                modifier = Modifier.padding(top = 30.dp))
            when (schritt) {
                Schritt.DATEI -> {
                    Text(t("imp.hinweis"), style = stil(13f, 500, 18f, farbe = LIME_HALB), modifier = Modifier.padding(top = 24.dp))
                    Row(
                        Modifier.padding(top = 24.dp).fillMaxWidth().height(56.dp).background(LIME).tippen {
                            waehler.launch(arrayOf(
                                "text/csv", "text/comma-separated-values", "text/tab-separated-values", "text/plain",
                                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/vnd.ms-excel",
                                "application/octet-stream",
                            ))
                        }.padding(horizontal = 16.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(t("sonstige.dateiAuswaehlen"), style = stil(16f, 500, abstand = 0.4f, farbe = hex(0x1D1C1D)))
                        Spacer(Modifier.weight(1f))
                        Icon("import-datei", Modifier.size(42.dp, 40.dp))
                    }
                }
                Schritt.ERKENNUNG -> Column(Modifier.fillMaxWidth().padding(top = 40.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                    ImportFunken(pulsieren = true)
                    Text(t("imp.erkennt"), style = stil(18f, 700, farbe = LIME), textAlign = TextAlign.Center, modifier = Modifier.padding(top = 14.dp))
                    Text(dateiname, style = stil(12f, 500, farbe = Color.White.copy(alpha = 0.5f)), textAlign = TextAlign.Center, modifier = Modifier.padding(top = 6.dp))
                }
                Schritt.ZUORDNUNG -> erkennung?.let { e ->
                    val zugeordnet = e.spalten.count { zuordnung[it.index] != null }
                    Row(Modifier.padding(top = 20.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text(dateiname, style = stil(12f, 500, farbe = Color.White.copy(alpha = 0.5f)), maxLines = 1, overflow = TextOverflow.Ellipsis,
                            modifier = Modifier.weight(1f, fill = false).padding(end = 12.dp))
                        Spacer(Modifier.weight(1f))
                        Text(t("imp.andereDatei"), style = stil(12f, 500, farbe = LIME).copy(textDecoration = TextDecoration.Underline), modifier = Modifier.tippen { neuStarten() })
                    }
                    Row(Modifier.padding(top = 20.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        ImportFunken(pulsieren = false)
                        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            Text(t("imp.zuordnung"), style = stil(20f, 700, 20f, farbe = LIME))
                            Text(t("imp.zugeordnetVon", mapOf("n" to "$zugeordnet", "gesamt" to "${e.spalten.size}")), style = stil(12f, 500, farbe = LIME_HALB))
                        }
                    }
                    Column(Modifier.padding(top = 14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        e.spalten.forEach { s ->
                            SpaltenKarte(s, zuordnung[s.index] ?: "", felder, offenesMenue == s.index, { offenesMenue = if (it) s.index else null }) { zuordnen(s.index, it) }
                        }
                    }

                    Text(t("imp.vorschau"), style = stil(20f, 700, farbe = LIME), modifier = Modifier.padding(top = 24.dp))
                    val fehlend = erg.unvollstaendig.flatMap { it.fehlt }.distinct()
                    Text(buildAnnotatedString {
                        withStyle(SpanStyle(color = LIME_HALB)) { append(t("imp.bereit", mapOf("n" to "${erg.fertig.size}"))) }
                        if (erg.unvollstaendig.isNotEmpty()) {
                            val felderText = fehlend.joinToString(", ") { t("imp.feld.${if (it == "name") "vollname" else it}") }
                            withStyle(SpanStyle(color = ORANGE)) {
                                append(" · " + t("imp.unvollstaendig", mapOf("n" to "${erg.unvollstaendig.size}", "felder" to felderText)))
                            }
                        }
                    }, style = stil(12f, 500), modifier = Modifier.padding(top = 4.dp))

                    Column(Modifier.padding(top = 10.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        erg.fertig.take(20).forEach { satz ->
                            Column(Modifier.fillMaxWidth().background(hex(0x0F0F0F)).border(2.dp, LIME.copy(alpha = 0.4f)).padding(horizontal = 12.dp, vertical = 8.dp)) {
                                Text(beschreibung(satz, fahrten), style = stil(14f, 500, farbe = LIME), maxLines = 1, overflow = TextOverflow.Ellipsis)
                                val d = detail(satz, fahrten)
                                if (d.isNotEmpty()) Text(d, style = stil(11f, 500, farbe = Color.White.copy(alpha = 0.5f)), maxLines = 1, overflow = TextOverflow.Ellipsis)
                            }
                        }
                        if (erg.fertig.size > 20) {
                            Text(t("sonstige.weitereDatensaetze", mapOf("n" to "${erg.fertig.size - 20}")), style = stil(12f, 500, farbe = Color.White.copy(alpha = 0.5f)))
                        }
                    }

                    val gesperrt = beschaeftigt || erg.fertig.isEmpty()
                    Row(
                        Modifier.padding(top = 16.dp).fillMaxWidth().height(56.dp).alpha(if (gesperrt) 0.4f else 1f).background(LIME)
                            .tippen { if (!gesperrt) uebernehmen(erg.fertig) }.padding(horizontal = 16.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(
                            if (beschaeftigt) t("sonstige.uebernehme") else t(if (fahrten) "imp.fahrtenImportieren" else "imp.gaesteImportieren", mapOf("n" to "${erg.fertig.size}")),
                            style = stil(16f, 500, abstand = 0.4f, farbe = hex(0x1D1C1D)),
                        )
                        Spacer(Modifier.weight(1f))
                        Icon("Arrow_Trisar_Icons_01", Modifier.size(34.dp, 20.dp))
                    }
                }
                Schritt.FERTIG -> {
                    Text(t(if (fahrten) "imp.fahrtenImportiert" else "imp.gaesteImportiert", mapOf("n" to "$importiert")),
                        style = stil(18f, 700, farbe = hex(0x8DFFAF)), modifier = Modifier.padding(top = 28.dp))
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

@Composable
private fun SpaltenKarte(
    spalte: SpaltenErkennung.Spalte,
    feld: String,
    felder: List<SpaltenErkennung.Feld>,
    menueOffen: Boolean,
    menue: (Boolean) -> Unit,
    waehlen: (String) -> Unit,
) {
    val vorschlagGilt = feld.isNotEmpty() && feld == spalte.vorschlag
    val sicher = vorschlagGilt && spalte.sicherheit >= 0.8
    val pruefen = vorschlagGilt && !sicher
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
                    DropdownMenuItem({ Text(t("imp.nichtImportieren")) }, { waehlen(""); menue(false) })
                    felder.forEach { f -> DropdownMenuItem({ Text(t("imp.feld.${f.key}")) }, { waehlen(f.key); menue(false) }) }
                }
            }
        }
        Text(if (feld.isNotEmpty() && !vorschlagGilt) t("imp.vonHandGeaendert") else grundText(spalte),
            style = stil(10f, 500, 13f, farbe = Color.White.copy(alpha = 0.4f)), modifier = Modifier.padding(top = 6.dp))
    }
}

@Composable
private fun Abzeichen(text: String, farbe: Color) {
    Box(Modifier.height(20.dp).background(farbe).padding(horizontal = 8.dp), contentAlignment = Alignment.Center) {
        Text(text, style = stil(10f, 700, farbe = Color.Black))
    }
}

private fun grundText(s: SpaltenErkennung.Spalte): String {
    if (s.vorschlag == null) return t("imp.keinTreffer")
    val teile = mutableListOf<String>()
    s.grundKopf?.let { teile.add(t("imp.grundKopf", mapOf("titel" to it))) }
    s.grundWerte?.let { teile.add(t("imp.grundWerte", mapOf("anteil" to "${s.grundAnteil}", "art" to t("imp.art.$it")))) }
    return teile.joinToString(" · ")
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

// MARK: Vorschau-Texte (describe / detail)

private fun s(satz: Map<String, JsonElement>, k: String): String =
    (satz[k] as? JsonPrimitive)?.takeIf { it !is JsonNull && it.isString }?.content ?: ""

private fun beschreibung(satz: Map<String, JsonElement>, fahrten: Boolean): String {
    if (fahrten) {
        val ab = s(satz, "pickup_name")
        val an = s(satz, "dropoff_name")
        return "${s(satz, "etd").take(5)} ${ab.ifEmpty { "—" }} → ${an.ifEmpty { "—" }}"
    }
    return "${s(satz, "first_name")} ${s(satz, "last_name")}".trim()
}

private fun detail(satz: Map<String, JsonElement>, fahrten: Boolean): String {
    if (fahrten) {
        val gaeste = (satz["passengers"] as? JsonArray)?.mapNotNull { (it as? JsonPrimitive)?.takeIf { p -> p.isString }?.content } ?: emptyList()
        val flug = s(satz, "flight_number")
        return listOf(s(satz, "ride_date"), flug.ifEmpty { s(satz, "train_number") }, gaeste.joinToString(", ")).filter { it.isNotEmpty() }.joinToString(" · ")
    }
    return listOf(s(satz, "company"), s(satz, "email"), s(satz, "phone")).filter { it.isNotEmpty() }.joinToString(" · ")
}

// MARK: Texte aus admin/src/i18n/de.js

private fun t(k: String, w: Map<String, String> = emptyMap()): String {
    var s = texte[k] ?: k
    for ((a, b) in w) s = s.replace("{$a}", b)
    return s
}

private val texte = mapOf(
    "sonstige.fahrtenImportTitle" to "Fahrten Import",
    "sonstige.kundenImportTitle" to "Kunden Import",
    "sonstige.dateiAuswaehlen" to "Datei auswählen",
    "sonstige.dateiLesenFehler" to "Datei konnte nicht gelesen werden: {message}",
    "sonstige.importFehlgeschlagen" to "Import fehlgeschlagen: {message}",
    "sonstige.uebernehme" to "Übernehme ...",
    "sonstige.weitereDatensaetze" to "+ {n} weitere Datensätze",
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
    "imp.gaesteImportieren" to "{n} Fahrgäste importieren",
    "imp.gaesteImportiert" to "{n} Fahrgäste importiert.",
    "imp.grundKopf" to "Überschrift „{titel}“",
    "imp.grundWerte" to "{anteil} % der Werte: {art}",
    "imp.hinweis" to "Beliebige Tabelle aus Excel oder CSV — kein festes Spaltenschema. Die Spalten werden erkannt, du prüfst den Vorschlag und importierst.",
    "imp.keinTreffer" to "Keine passende Bedeutung erkannt",
    "imp.leer" to "In der Datei wurden keine Datenzeilen gefunden.",
    "imp.nichtImportieren" to "Nicht importieren",
    "imp.pruefen" to "prüfen",
    "imp.sicher" to "sicher",
    "imp.unvollstaendig" to "{n} unvollständig, fehlt: {felder}",
    "imp.vonHandGeaendert" to "Von Hand zugeordnet",
    "imp.vorschau" to "Vorschau",
    "imp.weitereDatei" to "Weitere Datei importieren",
    "imp.zuDenFahrgaesten" to "Zu den Fahrgästen",
    "imp.zuDenFahrten" to "Zu den Fahrten",
    "imp.zugeordnetVon" to "{n} von {gesamt} Spalten zugeordnet",
    "imp.zuordnung" to "Zuordnung",
)
