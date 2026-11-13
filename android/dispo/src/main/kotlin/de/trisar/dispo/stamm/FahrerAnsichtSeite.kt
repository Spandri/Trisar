package de.trisar.dispo.stamm

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
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
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
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.text.withStyle
import de.trisar.dispo.fahrten.DispoFahrt
import de.trisar.dispo.fahrten.DispoFahrtenSpeicher
import de.trisar.dispo.fahrten.FahrtKarte
import de.trisar.dispo.fahrten.Rueckfrage
import de.trisar.dispo.fahrten.TagTrenner
import de.trisar.kern.Backend
import de.trisar.kern.DispoHintergrund
import de.trisar.kern.FussleisteUnten
import de.trisar.kern.Icon
import de.trisar.kern.Stunden
import de.trisar.kern.ZurueckKnopf
import de.trisar.kern.grotesk
import de.trisar.kern.hex
import de.trisar.kern.tippen
import io.github.jan.supabase.auth.auth
import io.github.jan.supabase.postgrest.from
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonObject
import io.github.jan.supabase.postgrest.query.Order
import io.github.jan.supabase.postgrest.query.Columns
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.time.Instant
import java.time.LocalDate
import java.time.OffsetDateTime

private val FA_LIME = hex(0xE3F654)
private val FA_ROT = hex(0xFF6F63)
private val FA_ORANGE = hex(0xFFCD8A)
private val FA_GRUEN = hex(0x59BE80)
private val FA_FLAECHE = hex(0x1A1A1A)

private fun faZeit(iso: String?): Instant? =
    if (iso.isNullOrEmpty()) null else runCatching { OffsetDateTime.parse(iso).toInstant() }.getOrNull()
private fun faHhmm(min: Int) = "%02d:%02d".format(min / 60, min % 60)

/** Ein Dienst im Ablauf. eintrag nur bis heute (stunden_verlauf), danach geplant. */
private class AblaufDienst(val id: String, val datum: String, val beginn: String, val ende: String,
                           val pausen: List<Pair<String, String>>, val eintrag: Stunden.Eintrag? = null)

private sealed class AblaufTeil(val m: Int) {
    class Dienst(val d: AblaufDienst, val fahrten: List<DispoFahrt>, m: Int) : AblaufTeil(m)
    class Fahrt(val f: DispoFahrt, m: Int) : AblaufTeil(m)
}

private fun hmMin(hm: String): Int? = Regex("^(\\d{1,2}):(\\d{2})").find(hm)?.destructured?.let { (h, m) -> h.toInt() * 60 + m.toInt() }

/** Hat der Dienst eine Stundenkarte? Vorbei, oder heute und laeuft schon. */
private fun hatKarte(e: Stunden.Eintrag): Boolean = e.vorbei || (e.dienst.datum == Stunden.heuteDatum() && e.vorschlag.beginn.isNotEmpty())

/**
 * Fahrer-Ansicht der Dispo (wie FahrerAnsichtView.jsx und FahrerAnsichtDispo.swift): Ablauf wie der Verlauf
 * der Fahrer-App. Unter jedem Datum zuerst die Stundenerfassung (auch bestaetigte), dann je Dienst Dienststart,
 * Fahrten mit Pausenstart und Pausenende dazwischen, Dienstende. Oben rechts Export: alle Stunden als Excel.
 */
@Composable
internal fun FahrerAnsichtSeite(fahrer: DispoFahrer, zurueck: () -> Unit, bearbeiten: () -> Unit, oeffneFahrt: (String) -> Unit,
                                fahrzeugOeffnen: ((String) -> Unit)? = null) {
    val speicher = DispoFahrtenSpeicher
    val dienste = remember(fahrer.id) { FahrerDiensteZustand(fahrer.id) }
    var eintraege by remember { mutableStateOf<List<Stunden.Eintrag>?>(null) }
    var kommende by remember { mutableStateOf<List<AblaufDienst>>(emptyList()) }
    var stand by remember { mutableStateOf(0) }
    var exportLaeuft by remember { mutableStateOf(false) }
    var exportMeldung by remember { mutableStateOf("") }
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()

    LaunchedEffect(Unit) { speicher.starten() }
    LaunchedEffect(fahrer.id, stand) {
        eintraege = runCatching { Stunden.verlauf(fahrer.id, 14) }.getOrDefault(emptyList())
    }
    // Kommende Dienste (ab morgen) mit ihren geplanten Pausen. Bis heute kommen sie aus stunden_verlauf.
    LaunchedEffect(fahrer.id) {
        kommende = runCatching {
            val heute = LocalDate.now(Stunden.BERLIN).toString()
            val zeilen = Backend.client.from("driver_service_requests")
                .select(Columns.raw("id, service_date, service_start_time, service_end_time, status")) {
                    filter { eq("driver_id", fahrer.id); gt("service_date", heute) }
                    order("service_date", Order.ASCENDING); limit(30)
                }.decodeList<JsonObject>()
                .filter { faTxt(it, "status").lowercase() in setOf("accepted", "assigned", "approved") }
            val ids = zeilen.map { faTxt(it, "id") }
            val pausen = if (ids.isEmpty()) emptyMap() else Backend.client.from("dienst_pausen")
                .select(Columns.raw("dienst_id, pausen")) { filter { isIn("dienst_id", ids) } }
                .decodeList<JsonObject>().associate { z ->
                    faTxt(z, "dienst_id").lowercase() to ((z["pausen"] as? JsonArray) ?: emptyList()).mapNotNull { p ->
                        (p as? JsonObject)?.let { faTxt(it, "von") to faTxt(it, "bis") }
                    }
                }
            zeilen.map { z ->
                AblaufDienst(faTxt(z, "id").lowercase(), faTxt(z, "service_date"), faTxt(z, "service_start_time").take(5),
                    faTxt(z, "service_end_time").take(5), pausen[faTxt(z, "id").lowercase()] ?: emptyList())
            }
        }.getOrDefault(emptyList())
    }
    BackHandler { zurueck() }

    val alleDienste = (eintraege ?: emptyList()).map { e ->
        AblaufDienst(e.dienst.id.lowercase(), e.dienst.datum, e.dienst.beginn, e.dienst.ende, e.dienst.pausen, e)
    } + kommende
    // Treffpunkt und Notiz beim Dienststart (dienst_treffpunkt), eine Abfrage fuer alle gezeigten Dienste.
    var treffpunktJe by remember { mutableStateOf<Map<String, de.trisar.kern.DienstTreffpunkt>>(emptyMap()) }
    val tpSchluessel = alleDienste.map { it.id }.filter { it.isNotEmpty() }.distinct().sorted().joinToString(",")
    LaunchedEffect(tpSchluessel) {
        if (tpSchluessel.isEmpty()) { treffpunktJe = emptyMap(); return@LaunchedEffect }
        val zeilen = runCatching {
            Backend.client.from("dienst_treffpunkt").select(Columns.raw(de.trisar.kern.DienstTreffpunkt.SPALTEN)) {
                filter { isIn("dienst_id", tpSchluessel.split(",")) }
            }.decodeList<de.trisar.kern.DienstTreffpunktZeile>()
        }.getOrDefault(emptyList())
        // Eigener Ort als Treffpunkt: Orte fuer sein Icon laden.
        if (zeilen.any { it.ort_id != null }) runCatching { de.trisar.kern.EigeneOrte.einmalLaden() }
        treffpunktJe = zeilen.mapNotNull { z -> de.trisar.kern.DienstTreffpunkt.ausZeile(z)?.let { z.dienst_id.lowercase() to it } }.toMap()
    }
    // Ablauf ab gestern. Aeltere Tage nur, solange dort Stunden noch nicht bestaetigt sind.
    val ab = LocalDate.now(Stunden.BERLIN).minusDays(1).toString()
    fun offen(d: AblaufDienst) = d.eintrag?.let { hatKarte(it) && it.zettel?.status != "bestaetigt" } == true
    fun zeigen(tag: String) = tag.isEmpty() || tag >= ab || alleDienste.any { it.datum == tag && offen(it) }
    val fahrten: List<DispoFahrt> = speicher.fahrten
        .filter { fahrer.id in it.fahrerIDs && !it.archiviert }
        .distinctBy { it.id }
        .filter { zeigen(it.datum.take(10)) }
    // Dienstfenster in Minuten, ueber Mitternacht hinaus verlaengert.
    class Rahmen(val d: AblaufDienst, val von: Int?, val bis: Int?, val fahrten: MutableList<DispoFahrt> = mutableListOf())
    val rahmen = alleDienste.filter { zeigen(it.datum) }.map { d ->
        val von = hmMin(d.beginn)
        var bis = hmMin(d.ende)
        if (von != null && bis != null && bis <= von) bis += 1440
        Rahmen(d, von, bis)
    }
    val nachTag = sortedMapOf<String, MutableList<AblaufTeil>>()
    val lose = mutableListOf<Pair<String, AblaufTeil>>()
    for (f in fahrten) {
        val tag = f.datum.take(10)
        val m = hmMin(f.startZeit) ?: Int.MAX_VALUE
        val r = rahmen.firstOrNull { it.d.datum == tag && it.von != null && it.bis != null && m >= it.von && m <= it.bis }
        if (r != null) r.fahrten.add(f) else lose.add(tag.ifEmpty { "9999-99-99" } to AblaufTeil.Fahrt(f, m))
    }
    for (r in rahmen) nachTag.getOrPut(r.d.datum) { mutableListOf() }
        .add(AblaufTeil.Dienst(r.d, r.fahrten.sortedBy { hmMin(it.startZeit) ?: 0 }, r.von ?: Int.MAX_VALUE))
    for ((tag, t) in lose) nachTag.getOrPut(tag) { mutableListOf() }.add(t)
    val tage = nachTag.map { (tag, teile) -> tag to teile.sortedBy { it.m } }
    val fahrtenAnzahl = tage.sumOf { (_, t) -> t.sumOf { if (it is AblaufTeil.Dienst) it.fahrten.size else 1 } }

    Box(Modifier.fillMaxSize()) {
        DispoHintergrund()
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(start = 20.dp, top = 60.dp, bottom = 120.dp)) {
            Column(Modifier.width(362.dp)) {
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    ZurueckKnopf { zurueck() }
                    Spacer(Modifier.weight(1f))
                    ExportKnopf(busy = exportLaeuft) {
                        exportLaeuft = true
                        scope.launch {
                            val m = alleStundenExportieren(ctx, fahrer.id)
                            exportMeldung = if (m.startsWith("Export")) m else ""
                            exportLaeuft = false
                        }
                    }
                }
                if (exportMeldung.isNotEmpty()) Text(exportMeldung, style = grotesk(13f, 500, farbe = FA_ROT), modifier = Modifier.padding(top = 6.dp))
                Text(fahrer.name.ifEmpty { "Fahrer" }, style = grotesk(42f, 700, zeilenHoehe = 42f, abstand = -0.5f, farbe = FA_LIME), modifier = Modifier.padding(top = 30.dp))
                val dienstText = if (fahrer.serviceStartTime.isNotEmpty() || fahrer.serviceEndTime.isNotEmpty())
                    "Dienst ${fahrer.serviceStartTime.ifEmpty { "?" }}–${fahrer.serviceEndTime.ifEmpty { "?" }}" else ""
                if (fahrer.vehicleId.isNotEmpty() && fahrzeugOeffnen != null) {
                    // Fahrzeug antippen: Fahrzeug bearbeiten (12.11.), Lime und unterstrichen wie im Web.
                    Text(androidx.compose.ui.text.buildAnnotatedString {
                        withStyle(androidx.compose.ui.text.SpanStyle(color = FA_LIME, textDecoration = androidx.compose.ui.text.style.TextDecoration.Underline)) {
                            append(fahrer.vehicle.ifEmpty { "Fahrzeug" })
                        }
                        if (dienstText.isNotEmpty()) append(" · $dienstText")
                    }, style = grotesk(16f, 500, farbe = Color.White.copy(alpha = 0.7f)),
                        modifier = Modifier.padding(top = 6.dp).tippen { fahrzeugOeffnen(fahrer.vehicleId) })
                } else {
                    val kopf = listOf(fahrer.vehicle.ifEmpty { "Kein Fahrzeug" }, dienstText).filter { it.isNotEmpty() }.joinToString(" · ")
                    Text(kopf, style = grotesk(16f, 500, farbe = Color.White.copy(alpha = 0.7f)), modifier = Modifier.padding(top = 6.dp))
                }

                FaAbschnitt("Ablauf", fahrtenAnzahl.takeIf { it > 0 })
                Column(Modifier.padding(top = 14.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    tage.forEachIndexed { i, (tag, teile) ->
                        if (tag != "9999-99-99") TagTrenner(tag, i == 0)
                        // Stundenerfassung immer als erstes unter dem Datum.
                        for (t in teile) {
                            val st = (t as? AblaufTeil.Dienst)?.d?.eintrag
                            if (st != null && hatKarte(st)) androidx.compose.runtime.key(st.dienst.id) {
                                Box(Modifier.padding(bottom = 6.dp)) { DispoStundenKarte(st, fahrer.id, ohneTitel = true) { stand++ } }
                            }
                        }
                        for (t in teile) when (t) {
                            is AblaufTeil.Fahrt -> FahrtKarte(t.f, t.f.zeiten, datumAlsStatus = false, wischen = false, oeffnen = { oeffneFahrt(t.f.id) },
                                erledigt = {}, archivieren = {}, duplizieren = {})
                            is AblaufTeil.Dienst -> DienstBlock(t.d, t.fahrten, oeffneFahrt, treffpunktJe[t.d.id])
                        }
                    }
                    if (tage.isEmpty()) Text("Keine Fahrten und Dienste ab gestern.", style = grotesk(16f, 500, farbe = FA_LIME.copy(alpha = 0.7f)))
                }

                FahrerDiensteAbschnitt(dienste, Modifier.width(362.dp).padding(top = 32.dp))
            }
        }
        FussleisteUnten()
        FahrerDiensteUeberlagerung(dienste, fahrer.name)
    }
}

private fun faTxt(o: JsonObject, k: String): String = (o[k] as? JsonPrimitive)?.takeIf { it !is JsonNull }?.content ?: ""

/** Zeile wie im Verlauf der Fahrer-App: Rahmen und Text in einer Farbe. */
@Composable
private fun StatusZeile(text: String, farbe: Color) {
    Box(Modifier.width(362.dp).height(48.dp).border(1.dp, farbe).padding(horizontal = 16.dp), contentAlignment = Alignment.CenterStart) {
        Text(text, style = grotesk(24f, 700, abstand = 0.5f, farbe = farbe), maxLines = 1)
    }
}

/**
 * Dienststart mit Treffpunkt und Notiz (dienst_treffpunkt), wie die Karte in der Fahrer-App (Figma 2908-12498)
 * und DienstStartMitOrt im Web: Lime-Rahmen, Icon-Kachel 44 und Ort, darunter die Notiz grau.
 */
@Composable
private fun FaDienstStartMitOrt(zeit: String, tp: de.trisar.kern.DienstTreffpunkt) {
    Column(Modifier.width(362.dp).border(1.dp, FA_LIME).padding(start = 16.dp, end = 16.dp, top = 14.dp, bottom = 12.dp)) {
        Text("Dienststart $zeit", style = grotesk(24f, 700, zeilenHoehe = 24f, abstand = 0.5f, farbe = FA_LIME), maxLines = 1)
        if (tp.name.isNotEmpty()) {
            Row(Modifier.padding(top = 8.dp).offset(x = (-4).dp), verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(44.dp).background(hex(0x242525), RoundedCornerShape(12.dp)), contentAlignment = Alignment.Center) {
                    Icon(tp.iconGrau, Modifier.size(24.dp))
                }
                Column(Modifier.padding(start = 20.dp)) {
                    Text(tp.name, style = grotesk(18f, 700, zeilenHoehe = 20f, abstand = -0.5f), maxLines = 1,
                        overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis)
                    if (tp.adresse.isNotEmpty() && tp.adresse != tp.name) Text(tp.adresse,
                        style = grotesk(13f, 500, farbe = Color.White.copy(alpha = 0.5f)), maxLines = 1,
                        overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis)
                }
            }
        }
        if (tp.notiz.isNotEmpty()) Text(tp.notiz, style = grotesk(15f, 700, zeilenHoehe = 19f, abstand = -0.3f, farbe = hex(0x868687)),
            modifier = Modifier.padding(top = 10.dp))
    }
}

/** Ein Dienst: Dienststart, Fahrten und Pausen nach Uhrzeit, Dienstende. */
@Composable
private fun DienstBlock(d: AblaufDienst, fahrten: List<DispoFahrt>, oeffneFahrt: (String) -> Unit, tp: de.trisar.kern.DienstTreffpunkt? = null) {
    val start = hmMin(d.beginn)
    // Zeilen nach Minuten: Fahrten und Pausen (Pausenende knapp hinter einer Fahrt zur selben Minute).
    val zeilen = mutableListOf<Pair<Double, Any>>()
    fahrten.forEach { zeilen.add((hmMin(it.startZeit) ?: 0).toDouble() to it) }
    d.pausen.forEach { (von, bis) ->
        val v = hmMin(von)
        var b = hmMin(bis)
        if (v != null && b != null && b < v) b += 1440
        var mv = (v ?: -1).toDouble()
        var mb = (b ?: v ?: -1) + 0.5
        if (start != null && mv < start) { mv += 1440; mb += 1440 }
        zeilen.add(mv to "Pausenstart ${von.take(5)}")
        zeilen.add(mb to "Pausenende ${bis.take(5)}")
    }
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        if (tp != null) FaDienstStartMitOrt(d.beginn.take(5).ifEmpty { "--:--" }, tp)
        else StatusZeile("Dienststart ${d.beginn.take(5).ifEmpty { "--:--" }}", FA_LIME)
        for ((_, z) in zeilen.sortedBy { it.first }) {
            if (z is DispoFahrt) FahrtKarte(z, z.zeiten, datumAlsStatus = false, wischen = false, oeffnen = { oeffneFahrt(z.id) },
                erledigt = {}, archivieren = {}, duplizieren = {})
            else StatusZeile(z as String, hex(0x868687))
        }
        StatusZeile("Dienstende ${d.ende.take(5).ifEmpty { "--:--" }}", FA_ROT)
    }
}

@Composable
private fun FaAbschnitt(titel: String, zahl: Int?) {
    Row(Modifier.width(362.dp).padding(top = 32.dp), verticalAlignment = Alignment.Bottom) {
        Text(titel, style = grotesk(26f, 700, abstand = -0.5f, farbe = FA_LIME), modifier = Modifier.weight(1f))
        if (zahl != null) Text("$zahl", style = grotesk(13f, 500, farbe = Color.White.copy(alpha = 0.5f)))
    }
}

// MARK: - Stundenkarte (wie FahrerStundenKarten.jsx bzw. HeuteStundenKarte der Fahrer-App)

private class FaWerte(val start: Instant, val ende: Instant, val pausen: List<Pair<Instant, Instant>>)

private class FaStand(val start: Instant, val ende: Instant?, val pausen: List<Pair<Instant, Instant?>>, val arbeits: Int)

private val FA_LAEUFT = setOf("at_pickup", "pickup", "beim_pickup", "in_progress", "unterwegs", "started", "on_trip", "ongoing", "active")

private fun standVon(e: Stunden.Eintrag, laeuftNoch: Boolean): FaStand? {
    val z = e.zettel
    if (z != null) {
        val b = faZeit(z.beginn); val en = faZeit(z.ende)
        if (b != null && en != null && en.isAfter(b)) {
            return FaStand(b, en, z.pausen.mapNotNull { p -> faZeit(p.von)?.let { it to faZeit(p.bis) } }, z.arbeitsMin)
        }
    }
    val v = e.vorschlag
    val b = faZeit(v.beginn) ?: return null
    val ende = if (laeuftNoch) null else faZeit(v.ende)
    val bis = ende ?: maxOf(Instant.now(), b)
    val p = v.pausen.mapNotNull { p -> faZeit(p.von)?.takeIf { !it.isAfter(bis) }?.let { it to faZeit(p.bis) } }
    val genau = maxOf(0.0, (bis.epochSecond - b.epochSecond) / 60.0 - Stunden.pausenMin(p, bis))
    return FaStand(b, ende, p, if (ende != null) Stunden.halbeAuf(genau) else genau.toInt())
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun DispoStundenKarte(e: Stunden.Eintrag, fahrerID: String, ohneTitel: Boolean = false, nachher: () -> Unit) {
    val z = e.zettel
    val laeuftNoch = !e.vorbei || e.vorschlag.fahrten.any { it.status.lowercase() in FA_LAEUFT }
    val s = standVon(e, laeuftNoch) ?: return
    var werte by remember { mutableStateOf<FaWerte?>(null) }
    var notiz by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var fehler by remember { mutableStateOf<String?>(null) }
    var loeschFrage by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val ctx = LocalContext.current
    val tag = e.dienst.datum

    fun minutenVon(t: Instant): Int { val l = t.atZone(Stunden.BERLIN).toLocalTime(); return l.hour * 60 + l.minute }
    fun aus(hm: String, nach: Instant? = null): Instant? =
        Stunden.zuZeitpunkt(tag, hm, nach?.toString())?.let { Instant.parse(it) }
    fun waehlen(t: Instant, setzen: (Instant) -> Unit) = zeitRadWaehlen(ctx, minutenVon(t)) { hm -> aus(hm)?.let(setzen) }

    // Reihenfolge: Start < Pausenanfang < Pausenende < Ende (ueber Mitternacht ab Start).
    val reihenfolge = werte?.let { w ->
        Stunden.reihenfolgeFehler(Stunden.uhrZeit(w.start), Stunden.uhrZeit(w.ende),
            w.pausen.map { Stunden.uhrZeit(it.first) to Stunden.uhrZeit(it.second) })
    }
    val arbeits = werte?.let { w ->
        Stunden.halbeAuf((w.ende.epochSecond - w.start.epochSecond) / 60.0 - Stunden.pausenMin(w.pausen.map { it.first to it.second }, w.ende))
    } ?: s.arbeits
    val rand = if (werte != null || z == null) FA_LIME else when (z.status) {
        "bestaetigt" -> FA_GRUEN; "eingereicht" -> FA_LIME; "zurueckgewiesen" -> FA_ROT; else -> FA_ORANGE
    }
    val (statusText, statusFarbe) = when (z?.status) {
        "eingereicht" -> "Fahrer hat bestätigt, bitte prüfen." to FA_LIME
        "dispo_geaendert" -> "Geändert, wartet auf den Fahrer." to FA_ORANGE
        "bestaetigt" -> "Bestätigt." to hex(0x8DFFAF)
        "zurueckgewiesen" -> "Zurückgegeben, wartet auf den Fahrer." to FA_ROT
        else -> if (laeuftNoch) "Dienst läuft." to Color.White.copy(alpha = 0.6f) else "Fahrer hat noch nicht erfasst." to FA_ORANGE
    }

    suspend fun ausfuehren(arbeit: suspend () -> Unit) {
        busy = true; fehler = null
        try { arbeit(); werte = null; nachher() } catch (x: kotlinx.coroutines.CancellationException) { throw x } catch (x: Exception) {
            fehler = "Speichern fehlgeschlagen: ${x.message}"
        }
        busy = false
    }

    Column(Modifier.width(362.dp)) {
        if (!ohneTitel) Text(Stunden.tagTitel(tag), style = grotesk(14f, 700, farbe = Color.White.copy(alpha = 0.7f)), modifier = Modifier.padding(bottom = 8.dp))
        Column(
            Modifier.width(362.dp).background(FA_FLAECHE).border(2.dp, rand).padding(bottom = 12.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text("Stundenerfassung", style = grotesk(18f, 700, zeilenHoehe = 23f, abstand = -0.5f, farbe = FA_LIME), modifier = Modifier.padding(top = 11.dp))
            FlowRow(
                Modifier.padding(horizontal = 10.dp).padding(top = 21.dp),
                horizontalArrangement = Arrangement.spacedBy(5.dp, Alignment.CenterHorizontally),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                val w = werte
                if (w != null) {
                    FaKasten("Start", Stunden.uhrZeit(w.start), aktiv = true, obenTippen = { waehlen(w.start) { werte = FaWerte(it, w.ende, w.pausen) } })
                    w.pausen.forEachIndexed { i, p ->
                        FaKasten("Pause", Stunden.uhrZeit(p.first), Stunden.uhrZeit(p.second), grau = true, aktiv = true,
                            obenTippen = { waehlen(p.first) { n -> werte = FaWerte(w.start, w.ende, w.pausen.mapIndexed { j, q -> if (j == i) n to q.second else q }) } },
                            untenTippen = { waehlen(p.second) { n -> werte = FaWerte(w.start, w.ende, w.pausen.mapIndexed { j, q -> if (j == i) q.first to n else q }) } },
                            entfernen = { werte = FaWerte(w.start, w.ende, w.pausen.filterIndexed { j, _ -> j != i }) })
                    }
                    // Neue Pause 3 Stunden: an die letzte anschliessend, sonst Mitte des Dienstes.
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Box(
                            Modifier.size(78.dp).drawBehind {
                                drawRoundRect(FA_LIME, cornerRadius = CornerRadius(12.dp.toPx()),
                                    style = Stroke(2.dp.toPx(), pathEffect = PathEffect.dashPathEffect(floatArrayOf(10f, 8f))))
                            }.tippen {
                                val ab = w.pausen.lastOrNull()?.second ?: w.start.plusSeconds(maxOf(0L, (w.ende.epochSecond - w.start.epochSecond) / 2 - 90 * 60))
                                val von = Instant.ofEpochSecond(Math.round(ab.epochSecond / 1800.0) * 1800)
                                werte = FaWerte(w.start, w.ende, w.pausen + (von to von.plusSeconds(180 * 60)))
                            },
                            contentAlignment = Alignment.Center,
                        ) { Text("+", style = grotesk(30f, 700, farbe = FA_LIME)) }
                        Text("Pause", style = grotesk(16f, 700, zeilenHoehe = 20f, abstand = -0.5f, farbe = FA_LIME), modifier = Modifier.padding(top = 8.dp))
                    }
                    FaKasten("Ende", Stunden.uhrZeit(w.ende), aktiv = true, obenTippen = { waehlen(w.ende) { werte = FaWerte(w.start, it, w.pausen) } })
                } else {
                    FaKasten("Start", Stunden.uhrZeit(s.start))
                    for (p in s.pausen) FaKasten("Pause", Stunden.uhrZeit(p.first), p.second?.let { Stunden.uhrZeit(it) }, grau = true)
                    if (s.ende != null) FaKasten("Ende", Stunden.uhrZeit(s.ende))
                }
            }
            Text(faHhmm(arbeits), style = grotesk(35f, 700, zeilenHoehe = 45f, abstand = -0.5f, farbe = hex(0xE2F754)), modifier = Modifier.padding(top = 9.dp))
        }

        // Standby am Event-Ort an diesem Tag (FahrerStundenKarten.jsx).
        e.standby.forEach { sb ->
            Text(sb.text, style = grotesk(14f, 700, farbe = hex(0x868687)), maxLines = 1, modifier = Modifier.padding(top = 6.dp))
        }
        if (werte == null) {
            Text(statusText, style = grotesk(14f, 700, farbe = statusFarbe), modifier = Modifier.padding(top = 10.dp))
            if (z != null && z.status == "eingereicht" && z.begruendung.isNotEmpty())
                Text("Fahrer: „${z.begruendung}“", style = grotesk(14f, 500, farbe = Color.White.copy(alpha = 0.7f)), modifier = Modifier.padding(top = 2.dp))
            if (z != null && z.status != "eingereicht" && z.dispoNotiz.isNotEmpty())
                Text("Dispo: „${z.dispoNotiz}“", style = grotesk(14f, 500, farbe = Color.White.copy(alpha = 0.7f)), modifier = Modifier.padding(top = 2.dp))
            if ((!laeuftNoch || z != null) && z?.status != "bestaetigt") {
                Row(Modifier.padding(top = 10.dp).width(362.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    FaKnopf("Bearbeiten", FA_ROT, Modifier.weight(1f), busy) {
                        val ende = s.ende ?: Instant.now()
                        werte = FaWerte(s.start, ende, s.pausen.map { it.first to (it.second ?: ende) })
                        notiz = ""; fehler = null
                    }
                    if (z?.status == "eingereicht") FaKnopf("Bestätigen", FA_GRUEN, Modifier.weight(1f), busy) {
                        scope.launch {
                            ausfuehren {
                                val jetzt = Instant.now().toString()
                                val wer = Backend.client.auth.currentUserOrNull()?.id
                                Backend.client.from("stundenzettel").update(buildJsonObject {
                                    put("status", "bestaetigt")
                                    put("geprueft_von", wer?.let { JsonPrimitive(it) } ?: JsonNull)
                                    put("geprueft_am", jetzt); put("aktualisiert", jetzt)
                                }) { filter { eq("id", z.id) } }
                            }
                        }
                    }
                }
            }
            // Bestaetigt: wie Ablehnen und Annehmen ein Knopfpaar, Loeschen und Bearbeiten.
            if (z?.status == "bestaetigt") {
                Row(Modifier.padding(top = 10.dp).width(362.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    FaKnopf("Löschen", FA_ROT, Modifier.weight(1f), busy) { loeschFrage = true }
                    FaKnopf("Bearbeiten", FA_LIME, Modifier.weight(1f), busy) {
                        val ende = s.ende ?: Instant.now()
                        werte = FaWerte(s.start, ende, s.pausen.map { it.first to (it.second ?: ende) })
                        notiz = ""; fehler = null
                    }
                }
            }
            if (z != null && z.status != "bestaetigt") {
                Box(Modifier.padding(top = 10.dp).width(362.dp).height(40.dp).border(1.dp, FA_ROT.copy(alpha = 0.6f)).alpha(if (busy) 0.6f else 1f)
                    .tippen { if (!busy) loeschFrage = true }, contentAlignment = Alignment.Center) {
                    Text("Erfasste Stunden löschen", style = grotesk(14f, 700, farbe = FA_ROT))
                }
            }
        } else {
            val w = werte!!
            reihenfolge?.let { Text(it, style = grotesk(14f, 700, farbe = FA_ROT), modifier = Modifier.padding(top = 8.dp)) }
            Text("Zeiten antippen zum Ändern, × entfernt eine Pause, + fügt eine hinzu. Pausen unter 3 Stunden zählen als Arbeitszeit. Der Fahrer muss die Änderung bestätigen.",
                style = grotesk(13f, 500, farbe = Color.White.copy(alpha = 0.5f)), modifier = Modifier.padding(top = 8.dp))
            Box(Modifier.padding(top = 12.dp).width(362.dp).height(80.dp).background(Color.White).padding(12.dp)) {
                if (notiz.isEmpty()) Text("Notiz an den Fahrer (optional)", style = grotesk(14f, 400, farbe = Color.Gray))
                BasicTextField(notiz, { notiz = it }, Modifier.fillMaxSize(), textStyle = TextStyle(color = Color.Black, fontFamily = grotesk(14f).fontFamily, fontSize = grotesk(14f).fontSize))
            }
            Row(
                Modifier.padding(top = 12.dp).width(362.dp).height(56.dp).background(FA_LIME).alpha(if (busy || reihenfolge != null) 0.5f else 1f).tippen {
                    if (busy || reihenfolge != null) return@tippen
                    scope.launch { ausfuehren { senden(e, fahrerID, w, notiz) } }
                }.padding(horizontal = 24.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text("An Fahrer senden", style = grotesk(16f, 700, abstand = -0.5f, farbe = Color.Black), modifier = Modifier.weight(1f))
                Icon("Arrow_Trisar_Icons_01", Modifier.size(34.dp, 20.dp))
            }
            Text("Abbrechen", style = grotesk(14f, 700, farbe = Color.White.copy(alpha = 0.6f)),
                modifier = Modifier.padding(top = 12.dp).align(Alignment.CenterHorizontally).tippen { werte = null; fehler = null })
        }
        fehler?.let { Text(it, style = grotesk(14f, 500, farbe = FA_ROT), modifier = Modifier.padding(top = 10.dp)) }
    }

    if (loeschFrage && z != null) {
        Rueckfrage("Erfasste Stunden vom ${Stunden.tagTitel(tag)} löschen? Der Fahrer kann danach neu erfassen.",
            ok = {
                loeschFrage = false
                scope.launch { ausfuehren { Backend.client.from("stundenzettel").delete { filter { eq("id", z.id) } } } }
            },
            abbrechen = { loeschFrage = false })
    }
}

/** Dispo bearbeitet: Zeiten speichern, der Fahrer muss zustimmen (Stand dispo_geaendert). */
private suspend fun senden(e: Stunden.Eintrag, fahrerID: String, w: FaWerte, notiz: String) {
    // Enden vor dem Beginn liegen am Folgetag (Nachtdienst).
    val ende = if (!w.ende.isAfter(w.start)) w.ende.plusSeconds(86_400) else w.ende
    val pausen = w.pausen.map { (v0, b0) ->
        val von = if (v0.isBefore(w.start)) v0.plusSeconds(86_400) else v0
        von to (if (!b0.isAfter(von)) b0.plusSeconds(86_400) else b0)
    }
    val pauseMin = Math.round(Stunden.pausenMin(pausen.map { it.first to it.second }, ende)).toInt()
    val arbeits = Stunden.halbeAuf((ende.epochSecond - w.start.epochSecond) / 60.0 - pauseMin)
    val jetzt = Instant.now().toString()
    val n = notiz.trim()
    val zeile = buildJsonObject {
        put("beginn", w.start.toString()); put("ende", ende.toString())
        put("pausen", buildJsonArray { pausen.forEach { (v, b) -> add(buildJsonObject { put("von", v.toString()); put("bis", b.toString()) }) } })
        put("pause_min", pauseMin); put("arbeits_min", arbeits)
        put("dispo_notiz", if (n.isEmpty()) JsonNull else JsonPrimitive(n))
        put("status", "dispo_geaendert"); put("aktualisiert", jetzt)
    }
    val z = e.zettel
    if (z != null) {
        Backend.client.from("stundenzettel").update(zeile) { filter { eq("id", z.id) } }
    } else {
        Backend.client.from("stundenzettel").insert(buildJsonObject {
            zeile.forEach { (k, v) -> put(k, v) }
            put("driver_id", fahrerID); put("dienst_id", e.dienst.id); put("datum", e.dienst.datum)
            put("vorschlag", e.vorschlag.roh); put("eingereicht_am", jetzt)
        })
    }
}

@Composable
private fun FaKasten(
    titel: String, oben: String, unten: String? = null, grau: Boolean = false, aktiv: Boolean = false,
    obenTippen: (() -> Unit)? = null, untenTippen: (() -> Unit)? = null, entfernen: (() -> Unit)? = null,
) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Box {
            Column(
                Modifier.size(78.dp).background(hex(0x242525), RoundedCornerShape(12.dp))
                    .then(if (aktiv) Modifier.border(2.dp, FA_LIME, RoundedCornerShape(12.dp)) else Modifier),
                horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center,
            ) {
                val farbeGrau = if (aktiv) Color.White else hex(0x5F5F5F)
                if (grau) {
                    Text(oben, style = grotesk(17f, 700, zeilenHoehe = 24.5f, abstand = -0.5f, farbe = farbeGrau),
                        modifier = if (obenTippen != null) Modifier.tippen(obenTippen) else Modifier)
                    if (unten != null) Text(unten, style = grotesk(17f, 700, zeilenHoehe = 24.5f, abstand = -0.5f, farbe = farbeGrau),
                        modifier = Modifier.padding(top = 4.dp).then(if (untenTippen != null) Modifier.tippen(untenTippen) else Modifier))
                } else {
                    Text(oben, style = grotesk(22f, 700, zeilenHoehe = 28f, abstand = -0.5f, farbe = hex(0xE2F754)),
                        modifier = if (obenTippen != null) Modifier.tippen(obenTippen) else Modifier)
                }
            }
            if (entfernen != null) {
                Box(Modifier.align(Alignment.TopEnd).offset(8.dp, (-8).dp).size(24.dp).background(FA_ROT, CircleShape).tippen(entfernen),
                    contentAlignment = Alignment.Center) { Text("×", style = grotesk(16f, 700, farbe = Color.Black)) }
            }
        }
        Text(titel, style = grotesk(16f, 700, zeilenHoehe = 20f, abstand = -0.5f, farbe = if (grau) hex(0x5F5F5F) else Color.White),
            modifier = Modifier.padding(top = 8.dp))
    }
}

@Composable
private fun FaKnopf(titel: String, farbe: Color, modifier: Modifier, busy: Boolean, aktion: () -> Unit) {
    Row(modifier.height(56.dp).background(farbe).alpha(if (busy) 0.6f else 1f).tippen { if (!busy) aktion() }.padding(start = 16.dp, end = 10.dp),
        verticalAlignment = Alignment.CenterVertically) {
        Text(titel, style = grotesk(16f, 400, abstand = 0.5f, farbe = Color.Black), modifier = Modifier.weight(1f))
        Icon("Arrow_Trisar_Icons_01", Modifier.size(34.dp, 19.dp))
    }
}

/** Drehrad (NumberPicker) fuer Stunden und Minuten in 15-Minuten-Schritten (Stundenerfassung, Dienste planen). */
internal fun zeitRadWaehlen(ctx: android.content.Context, minuten: Int, leerenText: String = "Nicht senden",
                            leeren: (() -> Unit)? = null, setzen: (String) -> Unit) {
    val viertel = ((minuten + 7) / 15 * 15) % 1440
    val stunden = android.widget.NumberPicker(ctx).apply {
        minValue = 0; maxValue = 23; value = viertel / 60
        displayedValues = Array(24) { "%02d".format(it) }
        descendantFocusability = android.view.ViewGroup.FOCUS_BLOCK_DESCENDANTS
    }
    val mins = android.widget.NumberPicker(ctx).apply {
        minValue = 0; maxValue = 3; value = (viertel % 60) / 15
        displayedValues = arrayOf("00", "15", "30", "45")
        descendantFocusability = android.view.ViewGroup.FOCUS_BLOCK_DESCENDANTS
    }
    val zeile = android.widget.LinearLayout(ctx).apply {
        orientation = android.widget.LinearLayout.HORIZONTAL
        gravity = android.view.Gravity.CENTER
        addView(stunden)
        addView(android.widget.TextView(ctx).apply { text = ":"; textSize = 22f; setPadding(24, 0, 24, 0) })
        addView(mins)
    }
    val dialog = android.app.AlertDialog.Builder(ctx, android.R.style.Theme_Material_Dialog_Alert)
        .setView(zeile)
        .setPositiveButton("Fertig") { _, _ -> setzen("%02d:%02d".format(stunden.value, mins.value * 15)) }
        .setNegativeButton("Abbrechen", null)
    // Feld wieder leeren (z. B. Dienststart nicht senden).
    if (leeren != null) dialog.setNeutralButton(leerenText) { _, _ -> leeren() }
    dialog.show()
}
