package de.trisar.dispo.fahrzeug

import android.app.DatePickerDialog
import android.content.Context
import android.content.Intent
import android.util.Base64
import androidx.activity.compose.BackHandler
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
import androidx.compose.foundation.layout.width
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.core.content.FileProvider
import de.trisar.dispo.stamm.Leinwand
import de.trisar.kern.Backend
import de.trisar.kern.FussleisteUnten
import de.trisar.kern.Icon
import de.trisar.kern.ZurueckKnopf
import de.trisar.kern.grotesk
import de.trisar.kern.hex
import de.trisar.kern.platz
import de.trisar.kern.tippen
import io.github.jan.supabase.functions.functions
import io.github.jan.supabase.postgrest.postgrest
import io.ktor.client.plugins.timeout
import io.ktor.client.request.setBody
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.contentType
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.put
import java.io.File
import java.text.NumberFormat
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlin.math.roundToLong

/*
 * Fahrtenbuch auf der Fahrzeugseite der Dispo (wie Fahrtenbuch.jsx und FahrtenbuchAnsicht.swift).
 * - FahrtenbuchBlock: heller Block zwischen Fahrzeugdaten und Schadensbericht (Kilometerstand, heute,
 *   Monat, letzte drei Eintraege). Ohne Eintraege bleibt er weg. Tipp oeffnet die Seite.
 * - FahrtenbuchSeite: alle Eintraege im Zeitraum, nach Tagen, mit Export (Excel, PDF, CSV).
 * Daten: Datenbank-Funktion fahrtenbuch_lesen (haengt an der Fahrgestellnummer, nicht am Kennzeichen).
 * Export: dispo-admin, Aktion fahrtenbuch_export.
 */

private val FB_DUNKEL = hex(0x1C1C1D)
private val FB_BLASS = Color(28, 28, 29).copy(alpha = 0.5f)
private val FB_LINIE = hex(0xDDDCDC)
private val FB_LIME = hex(0xE3F654)
private val BERLIN: ZoneId = ZoneId.of("Europe/Berlin")

internal class FahrtenbuchZeile(val id: String, val tag: String, val art: String, val beginn: String, val ende: String,
    val kmStart: Double?, val kmEnde: Double?, val km: Double?, val genau: Boolean, val von: String, val nach: String, val fahrer: String)

internal class FahrtenbuchStand(val vin: String, val kennzeichen: String, val kmStand: Double?, val kmHeute: Double?, val kmMonat: Double?,
    val kmGesamt: Double?, val kmGast: Double?, val kmLeer: Double?, val anzahl: Int, val zeilen: List<FahrtenbuchZeile>)

private fun fbTxt(o: JsonObject, k: String): String = (o[k] as? JsonPrimitive)?.takeIf { it !is JsonNull }?.content ?: ""
private fun fbZahl(o: JsonObject, k: String): Double? = fbTxt(o, k).toDoubleOrNull()

internal suspend fun fahrtenbuchLesen(fahrzeugID: String, von: String? = null, bis: String? = null): FahrtenbuchStand? = try {
    val text = Backend.client.postgrest.rpc("fahrtenbuch_lesen", buildJsonObject {
        put("p_vehicle", fahrzeugID)
        put("p_von", von?.let { JsonPrimitive(it) } ?: JsonNull)
        put("p_bis", bis?.let { JsonPrimitive(it) } ?: JsonNull)
    }).data
    val o = Backend.json.parseToJsonElement(text) as? JsonObject
    if (o == null) null else FahrtenbuchStand(
        vin = fbTxt(o, "vin"), kennzeichen = fbTxt(o, "kennzeichen"),
        kmStand = fbZahl(o, "km_stand"), kmHeute = fbZahl(o, "km_heute"), kmMonat = fbZahl(o, "km_monat"),
        kmGesamt = fbZahl(o, "km_gesamt"), kmGast = fbZahl(o, "km_gast"), kmLeer = fbZahl(o, "km_leer"),
        anzahl = fbTxt(o, "anzahl").toIntOrNull() ?: 0,
        zeilen = ((o["zeilen"] as? JsonArray) ?: JsonArray(emptyList())).mapNotNull { it as? JsonObject }.map { z ->
            FahrtenbuchZeile(fbTxt(z, "id"), fbTxt(z, "tag"), fbTxt(z, "art"), fbTxt(z, "beginn"), fbTxt(z, "ende"),
                fbZahl(z, "km_start"), fbZahl(z, "km_ende"), fbZahl(z, "km"), fbTxt(z, "genau") != "false",
                fbTxt(z, "von"), fbTxt(z, "nach"), fbTxt(z, "fahrer"))
        },
    )
} catch (e: kotlinx.coroutines.CancellationException) {
    throw e
} catch (e: Exception) {
    null
}

private fun fbGanz(wert: Double?): String =
    if (wert == null) "–" else NumberFormat.getIntegerInstance(Locale.GERMANY).format(wert.roundToLong())

private fun fbKm(wert: Double?, genau: Boolean): String = when {
    wert == null -> ""
    genau -> NumberFormat.getNumberInstance(Locale.GERMANY).apply { minimumFractionDigits = 1; maximumFractionDigits = 1 }.format(wert) + " km"
    else -> "ca. ${fbGanz(wert)} km"
}

private fun fbUhr(iso: String): String = runCatching {
    DateTimeFormatter.ofPattern("HH:mm").format(java.time.OffsetDateTime.parse(iso).toInstant().atZone(BERLIN))
}.getOrElse { runCatching { DateTimeFormatter.ofPattern("HH:mm").format(Instant.parse(iso).atZone(BERLIN)) }.getOrDefault("") }

/** "2026-11-17" -> "Di. 17.11." */
private fun fbTag(iso: String): String = runCatching {
    DateTimeFormatter.ofPattern("EEE dd.MM.", Locale.GERMANY).format(LocalDate.parse(iso))
}.getOrDefault(iso)

private fun fbDatum(iso: String): String = if (iso.length >= 10) "${iso.substring(8, 10)}.${iso.substring(5, 7)}.${iso.substring(0, 4)}" else iso

/** Eine Zeile: Uhrzeit links, Strecke in der Mitte, km rechts. Auf der Seite mit Ende und Kilometerstand. */
@Composable
private fun Zeile(z: FahrtenbuchZeile, voll: Boolean = false) {
    val stand = if (voll && z.kmStart != null && z.kmEnde != null) "${fbGanz(z.kmStart)} → ${fbGanz(z.kmEnde)}" else ""
    val unter = listOf(z.fahrer, stand).filter { it.isNotEmpty() }.joinToString(" · ")
    Column {
        Box(Modifier.fillMaxWidth().height(1.dp).background(FB_LINIE))
        Row(Modifier.padding(vertical = 9.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Column(Modifier.width(38.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(fbUhr(z.beginn), style = grotesk(12f, farbe = FB_BLASS), maxLines = 1)
                if (voll) Text(fbUhr(z.ende), style = grotesk(12f, farbe = FB_BLASS), maxLines = 1)
            }
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                Box(Modifier.height(16.dp).background(if (z.art == "gast") FB_LIME else hex(0xECECEC)).padding(horizontal = 6.dp),
                    contentAlignment = Alignment.Center) {
                    Text(if (z.art == "gast") "Gast" else "Leer", style = grotesk(10f, 700, abstand = -0.3f, farbe = FB_DUNKEL))
                }
                Text(listOf(z.von, z.nach).filter { it.isNotEmpty() }.joinToString(" → "), style = grotesk(13f, 700, farbe = FB_DUNKEL),
                    maxLines = 1, overflow = TextOverflow.Ellipsis)
                if (unter.isNotEmpty()) Text(unter, style = grotesk(11f, farbe = FB_BLASS), maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            Text(fbKm(z.km, z.genau), style = grotesk(13f, 700, farbe = FB_DUNKEL), maxLines = 1, softWrap = false)
        }
    }
}

@Composable
private fun Wert(titel: String, wert: String, modifier: Modifier) {
    Column(modifier, verticalArrangement = Arrangement.spacedBy(5.dp)) {
        Text(titel, style = grotesk(11f, farbe = FB_BLASS), maxLines = 1)
        Text(wert, style = grotesk(18f, 700, farbe = FB_DUNKEL), maxLines = 1, softWrap = false)
    }
}

@Composable
internal fun FahrtenbuchBlock(fahrzeugID: String, oeffnen: () -> Unit) {
    var daten by remember(fahrzeugID) { mutableStateOf<FahrtenbuchStand?>(null) }
    LaunchedEffect(fahrzeugID) { daten = fahrtenbuchLesen(fahrzeugID) }
    val d = daten ?: return
    if (d.anzahl <= 0) return
    val monat = remember { DateTimeFormatter.ofPattern("LLLL", Locale.GERMANY).format(LocalDate.now(BERLIN)) }
    Column(Modifier.width(353.dp).background(Color.White).tippen(oeffnen).padding(29.dp)) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Text("Fahrtenbuch", style = grotesk(20f, 700, abstand = -0.5f, farbe = FB_DUNKEL))
            Spacer(Modifier.weight(1f))
            Icon("Arrow_Trisar_Icons_01", Modifier.size(26.dp, 15.dp))
        }
        Box(Modifier.padding(top = 12.dp, bottom = 14.dp).fillMaxWidth().height(1.dp).background(FB_LINIE))
        Row(Modifier.padding(bottom = 14.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Wert("Kilometerstand", fbGanz(d.kmStand), Modifier.weight(1f))
            Wert("Heute", "${fbGanz(d.kmHeute)} km", Modifier.weight(1f))
            Wert(monat, "${fbGanz(d.kmMonat)} km", Modifier.weight(1f))
        }
        for (z in d.zeilen.take(3)) Zeile(z)
    }
}

/** format: xlsx, pdf oder csv. true = Datei liegt im Teilen-Menue. */
private suspend fun fahrtenbuchExportieren(ctx: Context, fahrzeugID: String, von: String, bis: String, format: String): Boolean = try {
    val koerper = buildJsonObject {
        put("aktion", "fahrtenbuch_export"); put("vehicle_id", fahrzeugID); put("von", von); put("bis", bis); put("format", format)
    }
    val text = Backend.client.functions.invoke("dispo-admin") {
        contentType(ContentType.Application.Json)
        setBody(koerper.toString())
        timeout { requestTimeoutMillis = 120_000; socketTimeoutMillis = 120_000 }
    }.bodyAsText()
    val r = Backend.json.parseToJsonElement(text).jsonObject
    val datei = fbTxt(r, "datei")
    if (datei.isEmpty()) false else {
        val name = fbTxt(r, "dateiname").ifEmpty { "fahrtenbuch.$format" }
        val ablage = withContext(Dispatchers.IO) {
            val ordner = File(ctx.cacheDir, "teilen").apply { mkdirs() }
            File(ordner, name.replace(Regex("[/\\\\]"), "_")).also { it.writeBytes(Base64.decode(datei, Base64.DEFAULT)) }
        }
        val uri = FileProvider.getUriForFile(ctx, "${ctx.packageName}.teilen", ablage)
        val absicht = Intent(Intent.ACTION_SEND).apply {
            type = fbTxt(r, "typ").ifEmpty { "application/octet-stream" }
            putExtra(Intent.EXTRA_STREAM, uri)
            putExtra(Intent.EXTRA_TITLE, name)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        ctx.startActivity(Intent.createChooser(absicht, name).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        true
    }
} catch (e: kotlinx.coroutines.CancellationException) {
    throw e
} catch (e: Exception) {
    false
}

private fun fbDatumDialog(ctx: Context, iso: String, setzen: (String) -> Unit) {
    val d = runCatching { LocalDate.parse(iso) }.getOrElse { LocalDate.now() }
    DatePickerDialog(ctx, android.R.style.Theme_Material_Dialog_Alert, { _, y, mo, t -> setzen(LocalDate.of(y, mo + 1, t).toString()) },
        d.year, d.monthValue - 1, d.dayOfMonth).show()
}

@Composable
internal fun FahrtenbuchSeite(fahrzeugID: String, schliessen: () -> Unit) {
    BackHandler(onBack = schliessen)
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    val dichte = LocalDensity.current
    val heute = LocalDate.now(BERLIN)
    var von by remember { mutableStateOf(heute.withDayOfMonth(1).toString()) }
    var bis by remember { mutableStateOf(heute.toString()) }
    var daten by remember { mutableStateOf<FahrtenbuchStand?>(null) }
    var busy by remember { mutableStateOf("") }
    var fehler by remember { mutableStateOf(false) }
    var inhaltHoehe by remember { mutableFloatStateOf(0f) }
    val gueltig = von <= bis

    LaunchedEffect(fahrzeugID, von, bis) { if (gueltig) daten = fahrtenbuchLesen(fahrzeugID, von, bis) }

    // Zeilen nach Tagen, neuester Tag oben.
    val tage = remember(daten) {
        val liste = mutableListOf<Pair<String, MutableList<FahrtenbuchZeile>>>()
        for (z in daten?.zeilen ?: emptyList()) {
            if (liste.lastOrNull()?.first == z.tag) liste.last().second.add(z) else liste.add(z.tag to mutableListOf(z))
        }
        liste
    }

    val versatz = 20f
    val oben = 130f
    val inhalt = oben + inhaltHoehe + 40f + 70f
    Box(Modifier.fillMaxSize().background(Color.Black).pointerInput(Unit) {
        awaitPointerEventScope { while (true) { awaitPointerEvent() } }
    }) {
        Leinwand(inhaltHoehe = inhalt) { _ ->
            ZurueckKnopf(Modifier.platz(20f, versatz + 40f), schliessen)
            Column(Modifier.platz(86f, versatz + 42f, 292f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text("Fahrtenbuch", style = grotesk(26f, 700, abstand = -0.5f, farbe = FB_LIME))
                Text(listOf(daten?.kennzeichen ?: "", daten?.vin ?: "").filter { it.isNotEmpty() }.joinToString(" · "),
                    style = grotesk(13f, farbe = Color.White.copy(alpha = 0.6f)), maxLines = 1, overflow = TextOverflow.Ellipsis)
            }

            Column(Modifier.platz(24.5f, versatz + oben, 353f).onSizeChanged { inhaltHoehe = with(dichte) { it.height.toDp().value } }) {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    for ((titel, wert, setzen) in listOf(Triple("Von", von) { v: String -> von = v }, Triple("Bis", bis) { v: String -> bis = v })) {
                        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                            Text(titel, style = grotesk(10f, 500, farbe = Color.White.copy(alpha = 0.5f)))
                            Box(Modifier.fillMaxWidth().height(38.dp).background(Color.Black).border(1.dp, Color.White.copy(alpha = 0.3f))
                                .tippen { fbDatumDialog(ctx, wert, setzen) }.padding(horizontal = 8.dp), contentAlignment = Alignment.CenterStart) {
                                Text(fbDatum(wert), style = grotesk(14f, 500, farbe = Color.White))
                            }
                        }
                    }
                }
                Row(Modifier.padding(top = 10.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    for ((titel, format) in listOf("Excel" to "xlsx", "PDF" to "pdf", "CSV" to "csv")) {
                        Box(Modifier.weight(1f).height(38.dp).alpha(if (busy == format || !gueltig) 0.5f else 1f).border(1.dp, FB_LIME)
                            .tippen {
                                if (busy.isNotEmpty() || !gueltig) return@tippen
                                busy = format; fehler = false
                                scope.launch {
                                    fehler = !fahrtenbuchExportieren(ctx, fahrzeugID, von, bis, format)
                                    busy = ""
                                }
                            }, contentAlignment = Alignment.Center) {
                            Text(titel, style = grotesk(13f, 700, farbe = FB_LIME))
                        }
                    }
                }
                if (fehler) Text("Export fehlgeschlagen.", style = grotesk(13f, farbe = hex(0xFF6B57)), modifier = Modifier.padding(top = 8.dp))

                Row(Modifier.padding(top = 14.dp).fillMaxWidth().background(Color.White).padding(20.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Wert("Gesamt", "${fbGanz(daten?.kmGesamt)} km", Modifier.weight(1f))
                    Wert("Gast", "${fbGanz(daten?.kmGast)} km", Modifier.weight(1f))
                    Wert("Leer", "${fbGanz(daten?.kmLeer)} km", Modifier.weight(1f))
                }
                for ((tag, zeilen) in tage) {
                    Column(Modifier.padding(top = 10.dp).fillMaxWidth().background(Color.White).padding(start = 20.dp, end = 20.dp, top = 16.dp, bottom = 8.dp)) {
                        Row(Modifier.fillMaxWidth().padding(bottom = 10.dp), verticalAlignment = Alignment.Bottom) {
                            Text(fbTag(tag), style = grotesk(15f, 700, abstand = -0.5f, farbe = FB_DUNKEL))
                            Spacer(Modifier.weight(1f))
                            Text("${fbGanz(zeilen.sumOf { it.km ?: 0.0 })} km", style = grotesk(13f, 700, farbe = FB_BLASS))
                        }
                        for (z in zeilen) Zeile(z, voll = true)
                    }
                }
                if (daten != null && tage.isEmpty()) {
                    Box(Modifier.padding(top = 10.dp).fillMaxWidth().background(Color.White).padding(20.dp)) {
                        Text("Keine Einträge im Zeitraum", style = grotesk(14f, 700, farbe = FB_BLASS))
                    }
                }
            }
        }
        FussleisteUnten()
    }
}
