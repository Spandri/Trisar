package de.trisar.dispo.stamm

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
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.core.content.FileProvider
import de.trisar.kern.Backend
import de.trisar.kern.Icon
import de.trisar.kern.grotesk
import de.trisar.kern.hex
import de.trisar.kern.tippen
import io.github.jan.supabase.functions.functions
import io.github.jan.supabase.postgrest.from
import io.github.jan.supabase.postgrest.query.Columns
import io.github.jan.supabase.postgrest.query.Order
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
import java.time.LocalDate

/*
 * Stunden als Excel (wie StundenExport.jsx und StundenExport.swift): dispo-admin, Aktion stunden_export.
 * - ExportKnopf: Kreis wie der Zurueck-Knopf, darin das Export-Zeichen (Figma 1429-9895).
 * - stundenExportieren: holt die Datei und oeffnet das Teilen-Menue.
 * - StundenExportFenster: Zeitraum und Fahrer waehlen (alle oder einzelne).
 */

private val E_LIME = hex(0xE3F654)

private fun eTxt(o: JsonObject, k: String): String = (o[k] as? JsonPrimitive)?.takeIf { it !is JsonNull }?.content ?: ""

/** Kreis 50 dp mit grauem Rand wie ZurueckKnopf, darin das Export-Zeichen. */
@Composable
internal fun ExportKnopf(modifier: Modifier = Modifier, busy: Boolean = false, aktion: () -> Unit) {
    Box(modifier.size(50.dp).alpha(if (busy) 0.5f else 1f).border(1.dp, hex(0x747474), CircleShape).tippen { if (!busy) aktion() },
        contentAlignment = Alignment.Center) {
        Icon("Import_Trisar_Icons_01_Lime", Modifier.size(24.dp))
    }
}

/** fahrer null = alle Fahrer. Gibt die Meldung zurueck. */
internal suspend fun stundenExportieren(ctx: Context, von: String, bis: String, fahrer: List<String>?): String = try {
    val koerper = buildJsonObject {
        put("aktion", "stunden_export"); put("von", von); put("bis", bis)
        put("fahrer", if (fahrer == null) JsonNull else JsonArray(fahrer.map { JsonPrimitive(it) }))
    }
    val text = Backend.client.functions.invoke("dispo-admin") {
        contentType(ContentType.Application.Json)
        setBody(koerper.toString())
        timeout { requestTimeoutMillis = 120_000; socketTimeoutMillis = 120_000 }
    }.bodyAsText()
    val r = Backend.json.parseToJsonElement(text).jsonObject
    val datei = eTxt(r, "datei")
    if (datei.isEmpty()) "Export fehlgeschlagen." else {
        excelTeilen(ctx, Base64.decode(datei, Base64.DEFAULT), eTxt(r, "dateiname").ifEmpty { "stunden.xlsx" })
        "${eTxt(r, "dienste").ifEmpty { "0" }} Dienste exportiert."
    }
} catch (e: kotlinx.coroutines.CancellationException) {
    throw e
} catch (e: Exception) {
    "Export fehlgeschlagen."
}

/** Alle Stunden eines Fahrers: ab 2020 bis heute. */
internal suspend fun alleStundenExportieren(ctx: Context, fahrerID: String): String =
    stundenExportieren(ctx, "2020-01-01", LocalDate.now().toString(), listOf(fahrerID))

private suspend fun excelTeilen(ctx: Context, bytes: ByteArray, name: String) {
    val datei = withContext(Dispatchers.IO) {
        val ordner = File(ctx.cacheDir, "teilen").apply { mkdirs() }
        File(ordner, name.replace(Regex("[/\\\\]"), "_")).also { it.writeBytes(bytes) }
    }
    val uri = FileProvider.getUriForFile(ctx, "${ctx.packageName}.teilen", datei)
    val absicht = Intent(Intent.ACTION_SEND).apply {
        type = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        putExtra(Intent.EXTRA_STREAM, uri)
        putExtra(Intent.EXTRA_TITLE, name)
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    }
    ctx.startActivity(Intent.createChooser(absicht, name).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
}

private fun datumDialog(ctx: Context, iso: String, setzen: (String) -> Unit) {
    val d = runCatching { LocalDate.parse(iso) }.getOrElse { LocalDate.now() }
    DatePickerDialog(ctx, android.R.style.Theme_Material_Dialog_Alert, { _, y, mo, t -> setzen(LocalDate.of(y, mo + 1, t).toString()) },
        d.year, d.monthValue - 1, d.dayOfMonth).show()
}

private fun datumLang(iso: String): String = if (iso.length >= 10) "${iso.substring(8, 10)}.${iso.substring(5, 7)}.${iso.substring(0, 4)}" else iso

private class ExportFahrer(val id: String, val name: String)

/** Fenster fuer Alle Fahrer: Zeitraum (Standard dieser Monat) und Fahrer (Standard alle). */
@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun StundenExportFenster(schliessen: () -> Unit) {
    BackHandler(onBack = schliessen)
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    val heute = LocalDate.now()
    var von by remember { mutableStateOf(heute.withDayOfMonth(1).toString()) }
    var bis by remember { mutableStateOf(heute.withDayOfMonth(heute.lengthOfMonth()).toString()) }
    var fahrer by remember { mutableStateOf<List<ExportFahrer>>(emptyList()) }
    // null = alle Fahrer.
    var auswahl by remember { mutableStateOf<Set<String>?>(null) }
    var busy by remember { mutableStateOf(false) }
    var meldung by remember { mutableStateOf("") }

    LaunchedEffect(Unit) {
        val kein = setOf("dispo", "dispatcher", "admin", "koordinator", "pruefung")
        fahrer = runCatching {
            Backend.client.from("profiles").select(Columns.raw("id, first_name, last_name, role, is_dispo")) { order("first_name", Order.ASCENDING) }
                .decodeList<JsonObject>()
        }.getOrDefault(emptyList())
            .filter { (it["is_dispo"] as? JsonPrimitive)?.content != "true" && eTxt(it, "role").lowercase() !in kein }
            .map { ExportFahrer(eTxt(it, "id"), "${eTxt(it, "first_name")} ${eTxt(it, "last_name")}".trim().ifEmpty { "Fahrer" }) }
    }

    Box(Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.7f)).tippen(schliessen), contentAlignment = Alignment.BottomCenter) {
        Column(Modifier.width(402.dp).heightIn(max = 700.dp).background(hex(0x0F0F0F)).tippen {}
            .verticalScroll(rememberScrollState()).padding(start = 20.dp, end = 20.dp, top = 20.dp, bottom = 60.dp)) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Text("Stunden exportieren", style = grotesk(26f, 700, farbe = E_LIME), modifier = Modifier.weight(1f))
                Text("×", style = grotesk(28f, 400, farbe = Color.White.copy(alpha = 0.6f)), modifier = Modifier.tippen(schliessen))
            }
            Row(Modifier.padding(top = 16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                for ((titel, wert, setzen) in listOf(Triple("Von", von) { v: String -> von = v }, Triple("Bis", bis) { v: String -> bis = v })) {
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                        Text(titel, style = grotesk(10f, 500, farbe = Color.White.copy(alpha = 0.5f)))
                        Box(Modifier.fillMaxWidth().height(38.dp).background(Color.Black).border(1.dp, Color.White.copy(alpha = 0.3f))
                            .tippen { datumDialog(ctx, wert, setzen) }.padding(horizontal = 8.dp), contentAlignment = Alignment.CenterStart) {
                            Text(datumLang(wert), style = grotesk(14f, 500, farbe = Color.White))
                        }
                    }
                }
            }
            FlowRow(Modifier.padding(top = 16.dp), horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                val alle = auswahl == null
                Box(Modifier.height(30.dp).background(if (alle) E_LIME else Color.Transparent).border(1.dp, E_LIME)
                    .tippen { auswahl = null }.padding(horizontal = 12.dp), contentAlignment = Alignment.Center) {
                    Text("Alle Fahrer", style = grotesk(12f, 700, farbe = if (alle) Color.Black else E_LIME))
                }
                fahrer.forEach { f ->
                    val an = auswahl?.contains(f.id) == true
                    Box(Modifier.height(30.dp).background(if (an) E_LIME else Color.Transparent).border(1.dp, if (an) E_LIME else Color.White.copy(alpha = 0.3f))
                        .tippen {
                            val jetzt = (auswahl ?: emptySet()).let { if (an) it - f.id else it + f.id }
                            auswahl = jetzt.ifEmpty { null }
                        }.padding(horizontal = 12.dp), contentAlignment = Alignment.Center) {
                        Text(f.name, style = grotesk(12f, 500, farbe = if (an) Color.Black else Color.White.copy(alpha = 0.75f)), maxLines = 1)
                    }
                }
            }
            Row(Modifier.padding(top = 20.dp).fillMaxWidth().height(56.dp).background(E_LIME).alpha(if (busy) 0.5f else 1f)
                .tippen {
                    if (busy) return@tippen
                    busy = true; meldung = ""
                    scope.launch {
                        meldung = stundenExportieren(ctx, von, bis, auswahl?.toList())
                        busy = false
                    }
                }.padding(horizontal = 24.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(if (busy) "Excel wird erstellt …" else "Excel herunterladen", style = grotesk(16f, 700, abstand = -0.5f, farbe = Color.Black), modifier = Modifier.weight(1f))
                Icon("Arrow_Trisar_Icons_01", Modifier.size(34.dp, 20.dp))
            }
            if (meldung.isNotEmpty()) Text(meldung, style = grotesk(13f, 500, farbe = Color.White.copy(alpha = 0.6f)), modifier = Modifier.padding(top = 12.dp))
        }
    }
}
