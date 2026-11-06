package de.trisar.dispo.stamm

import android.app.DatePickerDialog
import android.app.TimePickerDialog
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
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.core.content.FileProvider
import de.trisar.kern.Backend
import de.trisar.kern.CssRadial
import de.trisar.kern.FussleisteUnten
import de.trisar.kern.Stunden
import de.trisar.kern.ZurueckKnopf
import de.trisar.kern.grotesk
import de.trisar.kern.hex
import de.trisar.kern.tippen
import io.github.jan.supabase.exceptions.RestException
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
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.put
import java.io.File
import java.time.Instant
import java.time.LocalDate

private val S_LIME = hex(0xE3F654)
private val S_ORANGE = hex(0xFFCD8A)
private val S_ROT = hex(0xFF6F63)
private val S_GRUEN = hex(0x8DFFAF)
private val S_DUNKEL = hex(0x18181B)

private fun st(groesse: Float, gewicht: Int = 500, farbe: Color = Color.White, zeile: Float? = null): TextStyle = grotesk(groesse, gewicht, zeile, 0f, farbe)

private class KommenderDienst(val id: String, val datum: String, val beginn: String, val ende: String, val status: String)
private class TagFahrt(val id: String, val datum: String, val etd: String, val pickupName: String)
private class FahrerWahl(val id: String, val name: String)

private fun txt(o: JsonObject, k: String): String = (o[k] as? JsonPrimitive)?.takeIf { it !is JsonNull }?.content ?: ""

/**
 * FahrerStunden.jsx: Stunden eines Fahrers fuer die Dispo. Eingereichte Stunden pruefen, Pausen der
 * kommenden Dienste planen, Excel-Export (Zeitraum und Fahrer frei waehlbar).
 * Daten: stunden_verlauf(), stundenzettel, dienst_pausen, driver_service_requests, dispo-admin (stunden_export).
 */
@Composable
internal fun FahrerStundenSeite(fahrerID: String, fahrerName: String, schliessen: () -> Unit) {
    var verlauf by remember { mutableStateOf<List<Stunden.Eintrag>?>(null) }
    var dienste by remember { mutableStateOf<List<KommenderDienst>>(emptyList()) }
    val pausenJe = remember { mutableStateMapOf<String, List<JsonObject>>() }
    var fahrtenJe by remember { mutableStateOf<Map<String, List<TagFahrt>>>(emptyMap()) }
    var alleFahrer by remember { mutableStateOf<List<FahrerWahl>>(emptyList()) }
    var stand by remember { mutableStateOf(0) }
    val scope = rememberCoroutineScope()

    BackHandler(onBack = schliessen)

    LaunchedEffect(fahrerID, stand) {
        val heute = LocalDate.now().toString()
        val v = runCatching { Stunden.verlauf(fahrerID, 60) }.getOrElse { if (it is kotlinx.coroutines.CancellationException) throw it; emptyList() }
        val kommende = runCatching {
            Backend.client.from("driver_service_requests").select(Columns.raw("id, service_date, service_start_time, service_end_time, status")) {
                filter { eq("driver_id", fahrerID); gte("service_date", heute); isIn("status", listOf("pending", "accepted")) }
                order("service_date", Order.ASCENDING)
                limit(30)
            }.decodeList<JsonObject>()
        }.getOrElse { if (it is kotlinx.coroutines.CancellationException) throw it; emptyList() }
            .map { KommenderDienst(txt(it, "id"), txt(it, "service_date"), txt(it, "service_start_time"), txt(it, "service_end_time"), txt(it, "status")) }
        val ids = kommende.map { it.id }
        val tage = kommende.map { it.datum }.distinct()
        val pausen = if (ids.isEmpty()) emptyList() else runCatching {
            Backend.client.from("dienst_pausen").select { filter { isIn("dienst_id", ids) } }.decodeList<JsonObject>()
        }.getOrElse { if (it is kotlinx.coroutines.CancellationException) throw it; emptyList() }
        val fahrten = if (tage.isEmpty()) emptyList() else runCatching {
            Backend.client.from("jobs").select(Columns.raw("id, ride_date, etd, pickup_name")) {
                filter { eq("driver_id", fahrerID); isIn("ride_date", tage) }
                order("etd", Order.ASCENDING)
            }.decodeList<JsonObject>()
        }.getOrElse { if (it is kotlinx.coroutines.CancellationException) throw it; emptyList() }
        val profile = runCatching {
            Backend.client.from("profiles").select(Columns.raw("id, first_name, last_name, role, is_dispo")) { order("first_name", Order.ASCENDING) }
                .decodeList<JsonObject>()
        }.getOrElse { if (it is kotlinx.coroutines.CancellationException) throw it; emptyList() }

        verlauf = v
        dienste = kommende
        pausenJe.clear()
        pausen.forEach { p -> pausenJe[txt(p, "dienst_id")] = (p["pausen"] as? JsonArray).orEmpty().mapNotNull { it as? JsonObject } }
        fahrtenJe = fahrten.map { TagFahrt(txt(it, "id"), txt(it, "ride_date"), txt(it, "etd"), txt(it, "pickup_name")) }.groupBy { it.datum }
        alleFahrer = profile.filter { p ->
            (p["is_dispo"] as? JsonPrimitive)?.booleanOrNull != true &&
                txt(p, "role").lowercase() !in listOf("dispo", "dispatcher", "admin", "koordinator", "pruefung")
        }.map { p -> FahrerWahl(txt(p, "id"), "${txt(p, "first_name")} ${txt(p, "last_name")}".trim().ifEmpty { "Fahrer" }) }
    }

    fun pausenSpeichern(dienstID: String, pausen: List<JsonObject>) {
        pausenJe[dienstID] = pausen
        scope.launch {
            runCatching {
                Backend.client.from("dienst_pausen").upsert(buildJsonObject {
                    put("dienst_id", dienstID)
                    put("pausen", JsonArray(pausen))
                    put("aktualisiert", Instant.now().toString())
                })
            }
        }
    }

    val liste = verlauf.orEmpty()
    val zuPruefen = liste.filter { it.zettel?.status == "eingereicht" }
    val erledigt = liste.filter { it.zettel != null && it.zettel?.status != "eingereicht" }
    val offen = liste.filter { it.zettel == null && it.vorbei }
    val monat = LocalDate.now().toString().take(7)
    val summeMonat = liste.filter { it.zettel?.status == "bestaetigt" && it.dienst.datum.take(7) == monat }.sumOf { it.zettel?.arbeitsMin ?: 0 }

    Box(Modifier.fillMaxSize().background(Color.Black).pointerInput(Unit) { awaitPointerEventScope { while (true) awaitPointerEvent() } }) {
        CssRadial(1.4142f, 1.0221f, listOf(0x0048CFL to 0f, 0x001234L to 0.34f, 0x000000L to 0.46f, 0x000000L to 1f))
        Box(Modifier.fillMaxSize().imePadding().verticalScroll(rememberScrollState()), contentAlignment = Alignment.TopCenter) {
            Column(Modifier.width(402.dp).padding(start = 20.dp, end = 20.dp, top = 60.dp, bottom = 80.dp)) {
                ZurueckKnopf(aktion = schliessen)
                Text("Stunden", style = grotesk(42f, 700, zeilenHoehe = 42f, abstand = -0.5f, farbe = S_LIME), modifier = Modifier.padding(top = 30.dp))
                Text(fahrerName, style = st(16f, 500, Color.White.copy(alpha = 0.7f)), modifier = Modifier.padding(top = 6.dp))

                Row(Modifier.padding(top = 16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Kachel("${zuPruefen.size}", "zu prüfen", Modifier.weight(1f), if (zuPruefen.isNotEmpty()) S_ORANGE else null)
                    Kachel("${offen.size}", "nicht erfasst", Modifier.weight(1f), if (offen.isNotEmpty()) S_ROT else null)
                    Kachel(Stunden.hmm(summeMonat), "bestätigt (Monat)", Modifier.weight(1f), hell = true)
                }

                if (verlauf == null) Text("Lädt …", style = st(14f, 500, Color.White.copy(alpha = 0.5f)), modifier = Modifier.padding(top = 24.dp))

                if (zuPruefen.isNotEmpty()) {
                    Ueberschrift("Zu prüfen", zuPruefen.size)
                    Column(Modifier.padding(top = 10.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        zuPruefen.forEach { e -> androidx.compose.runtime.key(e.dienst.id) { ZettelKarte(e) { stand++ } } }
                    }
                }

                if (offen.isNotEmpty()) {
                    Ueberschrift("Nicht erfasst", offen.size)
                    Column(Modifier.padding(top = 10.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        offen.forEach { e ->
                            Row(Modifier.fillMaxWidth().height(48.dp).border(1.dp, S_ROT.copy(alpha = 0.6f)).padding(horizontal = 16.dp),
                                verticalAlignment = Alignment.CenterVertically) {
                                Text(Stunden.tagKurz(e.dienst.datum), style = st(15f, 700))
                                Spacer(Modifier.weight(1f))
                                Text("Vorschlag ${Stunden.uhr(e.vorschlag.beginn)}–${Stunden.uhr(e.vorschlag.ende)} · ${Stunden.hmm(e.vorschlag.arbeitsMin)} h",
                                    style = st(13f, 500, Color.White.copy(alpha = 0.6f)), maxLines = 1)
                            }
                        }
                    }
                }

                Ueberschrift("Dienste und Pausen")
                Column(Modifier.padding(top = 10.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    if (dienste.isEmpty()) Text("Keine kommenden Dienste.", style = st(14f, 400, Color.White.copy(alpha = 0.5f)))
                    dienste.forEach { d ->
                        androidx.compose.runtime.key(d.id) {
                            DienstPausen(d, pausenJe[d.id].orEmpty(), fahrtenJe[d.datum].orEmpty()) { pausenSpeichern(d.id, it) }
                        }
                    }
                }

                if (erledigt.isNotEmpty()) {
                    Ueberschrift("Geprüft", erledigt.size)
                    Column(Modifier.padding(top = 10.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        erledigt.forEach { e -> androidx.compose.runtime.key(e.dienst.id) { ZettelKarte(e) { stand++ } } }
                    }
                }

                Ueberschrift("Excel")
                Box(Modifier.padding(top = 10.dp)) {
                    Export(FahrerWahl(fahrerID, fahrerName), alleFahrer.ifEmpty { listOf(FahrerWahl(fahrerID, fahrerName)) })
                }
            }
        }
        FussleisteUnten()
    }
}

@Composable
private fun Kachel(zahl: String, text: String, modifier: Modifier, farbe: Color? = null, hell: Boolean = false) {
    val m = if (hell) modifier.background(S_LIME) else modifier.background(hex(0x0F0F0F)).border(1.dp, farbe ?: S_LIME.copy(alpha = 0.35f))
    Column(m.height(64.dp).padding(horizontal = 12.dp), verticalArrangement = Arrangement.Center) {
        Text(zahl, style = st(24f, 700, if (hell) Color.Black else (farbe ?: S_LIME), 26f), maxLines = 1)
        Text(text, style = st(11f, 500, if (hell) Color.Black.copy(alpha = 0.7f) else Color.White.copy(alpha = 0.55f)), maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

@Composable
private fun Ueberschrift(text: String, zahl: Int? = null) {
    Row(Modifier.padding(top = 28.dp).fillMaxWidth(), verticalAlignment = Alignment.Bottom) {
        Text(text, style = st(22f, 700, S_LIME))
        Spacer(Modifier.weight(1f))
        if (zahl != null) Text("$zahl", style = st(13f, 500, Color.White.copy(alpha = 0.5f)))
    }
}

@Composable
private fun Knopf(text: String, hell: Boolean = false, farbe: Color = S_LIME, aktiv: Boolean = true, aktion: () -> Unit) {
    val m = Modifier.height(44.dp).alpha(if (aktiv) 1f else 0.4f).let { if (hell) it.background(farbe) else it.border(2.dp, farbe) }
    Box(m.tippen { if (aktiv) aktion() }.padding(horizontal = 16.dp), contentAlignment = Alignment.Center) {
        Text(text, style = st(14f, 700, if (hell) Color.Black else farbe), maxLines = 1)
    }
}

@Composable
private fun Eingabe(label: String, wert: String, aendern: (String) -> Unit, modifier: Modifier = Modifier, tastatur: KeyboardType = KeyboardType.Text) {
    Column(modifier, verticalArrangement = Arrangement.spacedBy(3.dp)) {
        Text(label, style = st(10f, 500, Color.White.copy(alpha = 0.5f)))
        BasicTextField(
            value = wert, onValueChange = aendern, singleLine = true,
            textStyle = st(14f, 500), cursorBrush = SolidColor(S_LIME),
            keyboardOptions = KeyboardOptions(keyboardType = tastatur),
            modifier = Modifier.fillMaxWidth().height(38.dp).background(Color.Black).border(1.dp, Color.White.copy(alpha = 0.3f)).padding(horizontal = 8.dp),
            decorationBox = { f -> Box(contentAlignment = Alignment.CenterStart) { f() } },
        )
    }
}

/** Feld, das einen Zeit- oder Datumsdialog oeffnet. */
@Composable
private fun WaehlFeld(label: String, anzeige: String, modifier: Modifier = Modifier, oeffnen: () -> Unit) {
    Column(modifier, verticalArrangement = Arrangement.spacedBy(3.dp)) {
        Text(label, style = st(10f, 500, Color.White.copy(alpha = 0.5f)))
        Box(Modifier.fillMaxWidth().height(38.dp).background(Color.Black).border(1.dp, Color.White.copy(alpha = 0.3f)).tippen(oeffnen).padding(horizontal = 8.dp),
            contentAlignment = Alignment.CenterStart) { Text(anzeige.ifEmpty { "--:--" }, style = st(14f, 500, if (anzeige.isEmpty()) Color.White.copy(alpha = 0.4f) else Color.White)) }
    }
}

private fun zeitDialog(ctx: Context, wert: String, setzen: (String) -> Unit) {
    val (h, m) = Regex("^(\\d{1,2}):(\\d{2})").find(wert)?.destructured?.let { (a, b) -> a.toInt() to b.toInt() } ?: (12 to 0)
    TimePickerDialog(ctx, android.R.style.Theme_Material_Dialog_Alert, { _, hh, mm -> setzen("%02d:%02d".format(hh, mm)) }, h, m, true).show()
}

private fun datumDialog(ctx: Context, iso: String, setzen: (String) -> Unit) {
    val d = runCatching { LocalDate.parse(iso) }.getOrElse { LocalDate.now() }
    DatePickerDialog(ctx, android.R.style.Theme_Material_Dialog_Alert, { _, y, mo, t -> setzen(LocalDate.of(y, mo + 1, t).toString()) },
        d.year, d.monthValue - 1, d.dayOfMonth).show()
}

private fun datumLang(iso: String): String = if (iso.length >= 10) "${iso.substring(8, 10)}.${iso.substring(5, 7)}.${iso.substring(0, 4)}" else iso

/** Eingereichte Stunden: Vergleich mit dem Vorschlag, bestaetigen oder zurueckgeben. */
@Composable
private fun ZettelKarte(e: Stunden.Eintrag, neuLaden: () -> Unit) {
    val z = e.zettel ?: return
    val v = z.vorschlag ?: e.vorschlag
    val scope = rememberCoroutineScope()
    var notiz by remember { mutableStateOf(z.dispoNotiz) }
    var zurueck by remember { mutableStateOf(false) }
    var beschaeftigt by remember { mutableStateOf(false) }
    var fehler by remember { mutableStateOf("") }
    val farbe = when (z.status) { "bestaetigt" -> S_GRUEN; "zurueckgewiesen" -> S_ROT; else -> S_ORANGE }

    fun setzen(status: String) {
        beschaeftigt = true
        fehler = ""
        scope.launch {
            try {
                Stunden.pruefen(z.id, status, notiz)
                neuLaden()
            } catch (ex: kotlinx.coroutines.CancellationException) {
                throw ex
            } catch (ex: Exception) {
                fehler = (ex as? RestException)?.error ?: ex.message ?: ""
            } finally {
                beschaeftigt = false
            }
        }
    }
    fun abweichung(a: String, b: String) = if (Stunden.uhr(a) != Stunden.uhr(b)) S_ORANGE else Color.White

    Column(Modifier.fillMaxWidth().background(hex(0x0F0F0F)).border(2.dp, farbe).padding(16.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(Stunden.tagKurz(e.dienst.datum), style = st(18f, 700))
            Spacer(Modifier.weight(1f))
            Text("${Stunden.hmm(z.arbeitsMin)} h", style = st(24f, 700, farbe))
        }
        Row(Modifier.padding(top = 6.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Wert("Beginn", Stunden.uhr(z.beginn), abweichung(z.beginn, v.beginn), Modifier.weight(1f))
            Wert("Ende", Stunden.uhr(z.ende), abweichung(z.ende, v.ende), Modifier.weight(1f))
            Wert("Pause", "${z.pauseMin} Min.", if (z.pauseMin != v.pauseMin) S_ORANGE else Color.White, Modifier.weight(1f))
        }
        if (z.angepasst) {
            Text("Angepasst · Vorschlag ${Stunden.uhr(v.beginn)}–${Stunden.uhr(v.ende)}, ${Stunden.hmm(v.arbeitsMin)} h",
                style = st(12f, 500, S_ORANGE), modifier = Modifier.padding(top = 8.dp))
            if (z.begruendung.isNotEmpty()) Text("„${z.begruendung}“", style = st(12f, 500, Color.White.copy(alpha = 0.8f)), modifier = Modifier.padding(top = 2.dp))
        } else {
            Text("Wie vorgeschlagen · ${v.fahrten.size} Fahrten", style = st(12f, 500, Color.White.copy(alpha = 0.45f)), modifier = Modifier.padding(top = 8.dp))
        }
        if (z.status == "eingereicht") {
            if (zurueck) {
                Column(Modifier.padding(top = 10.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Eingabe("Hinweis an den Fahrer", notiz, { notiz = it })
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Knopf("Zurückgeben", hell = true, farbe = S_ROT, aktiv = !beschaeftigt && notiz.isNotBlank()) { setzen("zurueckgewiesen") }
                        Knopf("Abbrechen") { zurueck = false }
                    }
                }
            } else {
                Row(Modifier.padding(top = 10.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Knopf("Bestätigen", hell = true, aktiv = !beschaeftigt) { setzen("bestaetigt") }
                    Knopf("Zurückgeben", farbe = S_ROT) { zurueck = true }
                }
            }
        } else {
            Text((if (z.status == "bestaetigt") "Bestätigt" else "Zurückgegeben") + if (z.dispoNotiz.isNotEmpty()) " · ${z.dispoNotiz}" else "",
                style = st(12f, 700, farbe), modifier = Modifier.padding(top = 8.dp))
        }
        if (fehler.isNotEmpty()) Text(fehler, style = st(12f, 500, S_ORANGE), modifier = Modifier.padding(top = 6.dp))
    }
}

@Composable
private fun Wert(label: String, wert: String, farbe: Color, modifier: Modifier) {
    Column(modifier) {
        Text(label, style = st(10f, 400, Color.White.copy(alpha = 0.5f)))
        Text(wert, style = st(16f, 700, farbe))
    }
}

/** Pausen eines Dienstes planen: fest (von–bis) oder nach einer Fahrt (Abstand, Dauer). */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun DienstPausen(dienst: KommenderDienst, pausen: List<JsonObject>, fahrten: List<TagFahrt>, speichern: (List<JsonObject>) -> Unit) {
    val ctx = LocalContext.current
    var neu by remember { mutableStateOf(false) }
    var art by remember { mutableStateOf("fest") }
    var von by remember { mutableStateOf("") }
    var bis by remember { mutableStateOf("") }
    var fahrtID by remember { mutableStateOf("") }
    var nachMin by remember { mutableStateOf("") }
    var dauerMin by remember { mutableStateOf("") }
    var fahrtWahl by remember { mutableStateOf(false) }

    fun fahrtText(id: String): String = fahrten.firstOrNull { it.id == id }?.let { "${it.etd.take(5)} ${it.pickupName}".trim() } ?: "Fahrt"
    fun pausenText(p: JsonObject): String {
        if (txt(p, "art") == "fest") return "Pause ${txt(p, "von")}–${txt(p, "bis")}"
        val nach = txt(p, "nach_min").toIntOrNull() ?: 0
        return "Pause ${txt(p, "dauer_min")} Min. ${if (nach > 0) "$nach Min. " else ""}nach ${fahrtText(txt(p, "job_id"))}"
    }
    val gueltig = if (art == "fest") Regex("^\\d{2}:\\d{2}$").matches(von) && Regex("^\\d{2}:\\d{2}$").matches(bis)
    else fahrtID.isNotEmpty() && (dauerMin.toIntOrNull() ?: 0) > 0

    fun hinzufuegen() {
        if (!gueltig) return
        val p = if (art == "fest") buildJsonObject { put("art", "fest"); put("von", von); put("bis", bis) }
        else buildJsonObject {
            put("art", "nach_fahrt"); put("job_id", fahrtID)
            put("nach_min", nachMin.toIntOrNull() ?: 0); put("dauer_min", dauerMin.toIntOrNull() ?: 0)
        }
        speichern(pausen + p)
        neu = false; von = ""; bis = ""; fahrtID = ""; nachMin = ""; dauerMin = ""
    }

    Column(Modifier.fillMaxWidth().background(Color.White).padding(16.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(Stunden.tagKurz(dienst.datum), style = st(18f, 700, S_DUNKEL))
            Spacer(Modifier.weight(1f))
            Text("${dienst.beginn.take(5)}–${dienst.ende.take(5)}", style = st(16f, 700, S_DUNKEL))
        }
        Text("${fahrten.size} Fahrten · ${if (dienst.status == "accepted") "angenommen" else "angefragt"}", style = st(12f, 500, hex(0x71717B)))
        FlowRow(Modifier.padding(top = 8.dp), horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            pausen.forEachIndexed { i, p ->
                Row(Modifier.height(28.dp).background(S_DUNKEL).padding(horizontal = 8.dp), verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(pausenText(p), style = st(12f, 500, S_LIME), maxLines = 1)
                    Text("✕", style = st(12f, 500, Color.White.copy(alpha = 0.6f)), modifier = Modifier.tippen { speichern(pausen.filterIndexed { j, _ -> j != i }) })
                }
            }
            if (!neu) {
                Box(Modifier.height(28.dp).border(1.dp, S_DUNKEL).tippen { neu = true; art = "fest" }.padding(horizontal = 8.dp), contentAlignment = Alignment.Center) {
                    Text("+ Pause", style = st(12f, 700, S_DUNKEL))
                }
            }
        }
        if (neu) {
            Column(Modifier.padding(top = 10.dp).fillMaxWidth().background(S_DUNKEL).padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    listOf("fest" to "Feste Zeit", "nach_fahrt" to "Nach einer Fahrt").forEach { (a, text) ->
                        val an = art == a
                        Box(Modifier.height(32.dp).background(if (an) S_LIME else Color.Transparent).border(1.dp, if (an) S_LIME else Color.White.copy(alpha = 0.3f))
                            .tippen { art = a }.padding(horizontal = 12.dp), contentAlignment = Alignment.Center) {
                            Text(text, style = st(12f, 700, if (an) Color.Black else Color.White))
                        }
                    }
                }
                if (art == "fest") {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        WaehlFeld("Von", von, Modifier.weight(1f)) { zeitDialog(ctx, von) { von = it } }
                        WaehlFeld("Bis", bis, Modifier.weight(1f)) { zeitDialog(ctx, bis.ifEmpty { von }) { bis = it } }
                    }
                } else {
                    Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
                        Text("Nach Ende der Fahrt", style = st(10f, 500, Color.White.copy(alpha = 0.5f)))
                        Box(Modifier.fillMaxWidth().height(38.dp).background(Color.Black).border(1.dp, Color.White.copy(alpha = 0.3f))
                            .tippen { fahrtWahl = !fahrtWahl }.padding(horizontal = 8.dp), contentAlignment = Alignment.CenterStart) {
                            Text(if (fahrtID.isEmpty()) "Fahrt wählen" else fahrtText(fahrtID), style = st(14f, 400, Color.White), maxLines = 1)
                            Text("▾", style = st(12f, 500, Color.White.copy(alpha = 0.5f)), modifier = Modifier.align(Alignment.CenterEnd))
                        }
                        if (fahrtWahl) {
                            Column(Modifier.fillMaxWidth().background(Color.Black).border(1.dp, Color.White.copy(alpha = 0.3f))) {
                                if (fahrten.isEmpty()) Text("Keine Fahrten an dem Tag.", style = st(13f, 400, Color.White.copy(alpha = 0.5f)), modifier = Modifier.padding(8.dp))
                                fahrten.forEach { f ->
                                    Box(Modifier.fillMaxWidth().height(36.dp).tippen { fahrtID = f.id; fahrtWahl = false }.padding(horizontal = 8.dp),
                                        contentAlignment = Alignment.CenterStart) {
                                        Text(fahrtText(f.id), style = st(14f, 400, if (f.id == fahrtID) S_LIME else Color.White), maxLines = 1)
                                    }
                                }
                            }
                        }
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Eingabe("Abstand (Min.)", nachMin, { nachMin = it.filter { c -> c.isDigit() } }, Modifier.weight(1f), KeyboardType.Number)
                        Eingabe("Dauer (Min.)", dauerMin, { dauerMin = it.filter { c -> c.isDigit() } }, Modifier.weight(1f), KeyboardType.Number)
                    }
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Knopf("Pause speichern", hell = true, aktiv = gueltig) { hinzufuegen() }
                    Knopf("Abbrechen") { neu = false }
                }
            }
        }
    }
}

/** Excel-Export: Zeitraum und Fahrer frei waehlbar, Datei ueber das Teilen-Menue. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun Export(fahrer: FahrerWahl, alleFahrer: List<FahrerWahl>) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    val heute = LocalDate.now()
    var von by remember { mutableStateOf(heute.withDayOfMonth(1).toString()) }
    var bis by remember { mutableStateOf(heute.withDayOfMonth(heute.lengthOfMonth()).toString()) }
    var auswahl by remember { mutableStateOf(listOf(fahrer.id)) }
    var beschaeftigt by remember { mutableStateOf(false) }
    var meldung by remember { mutableStateOf("") }
    val alle = auswahl.size == alleFahrer.size && alleFahrer.all { it.id in auswahl }

    fun exportieren() {
        beschaeftigt = true
        meldung = ""
        scope.launch {
            try {
                val koerper = buildJsonObject {
                    put("aktion", "stunden_export"); put("von", von); put("bis", bis)
                    put("fahrer", if (alle) JsonNull else JsonArray(auswahl.map { JsonPrimitive(it) }))
                }
                val text = Backend.client.functions.invoke("dispo-admin") {
                    contentType(ContentType.Application.Json)
                    setBody(koerper.toString())
                    timeout { requestTimeoutMillis = 120_000; socketTimeoutMillis = 120_000 }
                }.bodyAsText()
                val r = Backend.json.parseToJsonElement(text).jsonObject
                val datei = txt(r, "datei")
                if (datei.isEmpty()) { meldung = "Export fehlgeschlagen."; return@launch }
                val name = txt(r, "dateiname").ifEmpty { "stunden.xlsx" }
                excelTeilen(ctx, Base64.decode(datei, Base64.DEFAULT), name)
                meldung = "${txt(r, "dienste").ifEmpty { "0" }} Dienste exportiert."
            } catch (e: kotlinx.coroutines.CancellationException) {
                throw e
            } catch (e: Exception) {
                meldung = "Export fehlgeschlagen."
            } finally {
                beschaeftigt = false
            }
        }
    }

    Column(Modifier.fillMaxWidth().background(hex(0x0F0F0F)).border(1.dp, Color.White.copy(alpha = 0.15f)).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            WaehlFeld("Von", datumLang(von), Modifier.weight(1f)) { datumDialog(ctx, von) { von = it } }
            WaehlFeld("Bis", datumLang(bis), Modifier.weight(1f)) { datumDialog(ctx, bis) { bis = it } }
        }
        FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Box(Modifier.height(30.dp).background(if (alle) S_LIME else Color.Transparent).border(1.dp, S_LIME)
                .tippen { auswahl = if (alle) listOf(fahrer.id) else alleFahrer.map { it.id } }.padding(horizontal = 12.dp), contentAlignment = Alignment.Center) {
                Text("Alle Fahrer", style = st(12f, 700, if (alle) Color.Black else S_LIME))
            }
            alleFahrer.forEach { f ->
                val an = f.id in auswahl
                Box(Modifier.height(30.dp).background(if (an) S_LIME else Color.Transparent).border(1.dp, if (an) S_LIME else Color.White.copy(alpha = 0.3f))
                    .tippen { auswahl = if (an) auswahl - f.id else auswahl + f.id }.padding(horizontal = 12.dp), contentAlignment = Alignment.Center) {
                    Text(f.name, style = st(12f, 500, if (an) Color.Black else Color.White.copy(alpha = 0.75f)), maxLines = 1)
                }
            }
        }
        Knopf(if (beschaeftigt) "Excel wird erstellt …" else "Excel exportieren", hell = true, aktiv = !beschaeftigt && auswahl.isNotEmpty()) { exportieren() }
        if (meldung.isNotEmpty()) Text(meldung, style = st(12f, 400, Color.White.copy(alpha = 0.6f)))
    }
}

/** Wie teilenOeffnen in EinsatzUebersicht.kt, mit Excel-Typ. */
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
