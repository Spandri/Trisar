package de.trisar.dispo.planung

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableDoubleStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.zIndex
import de.trisar.kern.Icon
import de.trisar.kern.grotesk
import de.trisar.kern.hex
import de.trisar.kern.tippen
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlin.math.abs
import kotlin.math.ceil
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min

/**
 * Der geplante Tag auf der Karte (EinsatzTagKarteAnsicht.swift, EinsatzTagKarte.jsx): oeffnet sich aus der
 * Tagesplanung ueber das Kartensymbol und spielt alle Fahrten im Zeitraffer ab. Jeder Fahrer faehrt seinen
 * Plan: Anfahrt zum Gast (gelb), Fahrt mit Gast (rot), danach frei (gruen). Oben Zeitleiste mit 1x/2x/4x.
 */
@Composable
internal fun EinsatzTagKarteAnsicht(
    tagIso: String,
    vorschlaege: List<EinsatzVorschlag>,
    fahrer: List<PlanFahrer>,
    kameraSignal: Int,
    zurueck: () -> Unit,
) {
    val m = remember { EinsatzKartenModell() }
    val halter = remember { PlanKarteHalter() }
    DisposableEffect(Unit) {
        m.starten(vorschlaege, fahrer)
        onDispose { m.anhalten() }
    }
    var erstesSignal by remember { mutableStateOf(kameraSignal) }
    LaunchedEffect(kameraSignal) {
        if (kameraSignal != erstesSignal) { erstesSignal = kameraSignal; m.gewaehlt = null; m.einpassenSignal += 1 }
    }
    // fitBounds ueber alle Orte; oben Knoepfe und Zeitleiste, unten die Navigation frei.
    LaunchedEffect(m.einpassenSignal, halter.bereit) {
        if (halter.bereit) halter.einpassen(m.orte.values.toList(), 250f, 32f, 200f, 32f, 600)
    }
    // Strecke des gewaehlten Fahrers: blau mit Gast, gelb gestrichelt zum Gast.
    LaunchedEffect(m.takt, halter.bereit) {
        if (!halter.bereit) return@LaunchedEffect
        val s = m.auswahlStrecke
        halter.linie("ek-fahrt", if (s?.first == "fahrt") listOf(s.second) else emptyList(), EinsatzFarbe.blau, 6f)
        halter.linie("ek-anfahrt", if (s?.first == "anfahrt") listOf(s.second) else emptyList(), EinsatzFarbe.lime, 5f, arrayOf(0.8f, 1.6f))
    }

    Box(Modifier.fillMaxSize().background(Color.Black).abschirmen()) {
        PlanKarteFlaeche(halter, Modifier.fillMaxSize(), 10.0, drehen = false) { stelle ->
            // Tipp auf einen Fahrer waehlt ihn (nochmal = abwaehlen), Tipp daneben hebt die Auswahl auf.
            val treffer = m.plaene.mapNotNull { p ->
                val s = m.stand(p, m.minute) ?: return@mapNotNull null
                val o = halter.bildschirm(s.ort) ?: return@mapNotNull null
                val links = o.x - 17.5f - 4f
                val oben = o.y - 41.1367f - 4f
                if (stelle.x in links..(links + 43f) && stelle.y in oben..(oben + 49.1367f)) p to m.oben(p, s) else null
            }.maxByOrNull { it.second }?.first
            m.waehlen(treffer?.id)
        }

        // Fahrer-Pins (35 x 41,14, Spitze auf dem Ort, Nummer im Kopf).
        Box(Modifier.fillMaxSize()) {
            @Suppress("UNUSED_VARIABLE") val takt = m.takt + halter.bewegt
            if (halter.bereit) {
                for (p in m.plaene) {
                    val s = m.stand(p, m.minute) ?: continue
                    val o = halter.bildschirm(s.ort) ?: continue
                    val bild = when (s.zustand) { "aktiv" -> "Fahrer_Pin_Trisar_01_rot"; "inaktiv" -> "Fahrer_Pin_Trisar_01_gelb"; else -> "Fahrer_Pin_Trisar_01_gruen" }
                    val blass = m.gewaehlt != null && m.gewaehlt != p.id
                    Box(
                        Modifier.offset((o.x - 17.5f).dp, (o.y - 41.1367f).dp).size(35.dp, 41.1367.dp)
                            .zIndex(m.oben(p, s)).alpha(if (blass) 0.3f else 1f)
                    ) {
                        Icon(bild, Modifier.size(35.dp, 41.1367.dp), skalierung = ContentScale.FillBounds)
                        Box(Modifier.offset(0.dp, 5.5.dp).size(35.dp, 24.dp), contentAlignment = Alignment.Center) {
                            PText(p.nummer?.toString() ?: "?", 15f, 700, hex(0x1A1A1A))
                        }
                    }
                }
            }
        }

        BoxWithConstraints(Modifier.fillMaxSize()) {
            val breite = min(402f, maxWidth.value)
            Column(Modifier.width(breite.dp).padding(horizontal = 20.dp).align(Alignment.TopCenter)) {
                Spacer(Modifier.height(60.dp))
                Row(Modifier.fillMaxWidth().height(50.dp), verticalAlignment = Alignment.CenterVertically) {
                    Box(Modifier.size(50.dp).background(Color.Black, CircleShape).tippen(zurueck)) {
                        Icon("Backbutton_Karte", Modifier.size(50.dp))
                    }
                    Spacer(Modifier.weight(1f))
                    Box(Modifier.height(50.dp).background(Color.Black, RoundedCornerShape(25.dp)).padding(horizontal = 18.dp), contentAlignment = Alignment.Center) {
                        PText(EinsatzUhr.tagKurz(tagIso), 16f, 700, EinsatzFarbe.lime, 0.5f)
                    }
                }
                Spacer(Modifier.height(32.dp))
                SimZeitleiste(
                    spielt = m.laeuft, fertig = m.fertig, bereit = m.plaene.isNotEmpty(), uhr = EinsatzUhr.uhr(m.minute.toInt()),
                    anteil = ((m.minute - m.von) / max(1, m.bis - m.von)).toFloat().coerceIn(0f, 1f),
                    striche = m.fahrtStriche, tempo = m.tempo,
                    abspielen = { m.abspielen() }, tempoWechseln = { m.tempoWechseln() },
                    ziehen = { m.ziehen(it.toDouble()) }, ziehenEnde = { m.ziehenEnde() },
                )
                Spacer(Modifier.height(8.dp))
                KartenLage(m)
            }
        }
    }
}

private val zustandFarbe = mapOf("aktiv" to hex(0xFF6F63), "inaktiv" to hex(0xE3F654), "frei" to hex(0x59BE80))

@Composable
private fun ZustandPunkt(z: String) {
    Box(Modifier.size(12.dp).background(zustandFarbe[z] ?: Color.Gray, CircleShape).border(1.dp, hex(0x202020), CircleShape))
}

@Composable
private fun KartenLage(m: EinsatzKartenModell) {
    val a = m.anzeige
    val karte = Modifier.fillMaxWidth().background(Color.Black, RoundedCornerShape(12.dp))
    if (a != null) {
        Column(karte.padding(start = 16.dp, end = 16.dp, top = 14.dp, bottom = 12.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                ZustandPunkt(a.zustand)
                Spacer(Modifier.width(10.dp))
                val name = buildAnnotatedString {
                    withStyle(SpanStyle(fontWeight = FontWeight(700))) { append(a.nummer?.let { "$it " } ?: "") }
                    append(a.name)
                }
                Text(name, style = grotesk(16f), maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                PText(EinsatzKartenModell.kmText(m.kmFahrer), 16f, 700, EinsatzFarbe.lime)
            }
            Spacer(Modifier.height(8.dp))
            val zeile = if (a.art == "frei" || a.etd == null) buildAnnotatedString { append("frei") } else buildAnnotatedString {
                append(if (a.art == "fahrt") "" else "${if (a.art == "anfahrt") "Anfahrt" else "wartet"} · ")
                withStyle(SpanStyle(fontWeight = FontWeight(700), color = Color.White)) { append("${a.etd} Uhr") }
                append(if (a.art == "fahrt") " · ${a.ab} – ${a.ziel}" else " · ${a.ab}")
            }
            Text(zeile, style = grotesk(13f, zeilenHoehe = 18f, farbe = Color.White.copy(alpha = 0.6f)), modifier = Modifier.padding(start = 22.dp))
        }
    } else if (m.orteFertig && m.plaene.isNotEmpty()) {
        Row(karte.height(44.dp).padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically) {
            val z = m.zaehler
            for (k in listOf("aktiv", "inaktiv", "frei")) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    ZustandPunkt(k)
                    PText("${z[k] ?: 0}", 16f, 700, Color.White)
                    PText(k, 13f, 400, Color.White.copy(alpha = 0.6f))
                }
                Spacer(Modifier.width(14.dp))
            }
            Spacer(Modifier.weight(1f))
            PText(EinsatzKartenModell.kmText(m.kmAlle), 16f, 700, EinsatzFarbe.lime)
        }
    } else {
        Box(karte.height(44.dp), contentAlignment = Alignment.Center) {
            PText(if (m.orteFertig) "Keine Fahrten an diesem Tag" else "Fahrten werden geladen …", 13f, 500, EinsatzFarbe.lime, 0.5f)
        }
    }
}

// MARK: - Zeitleiste (auch in der Fahrt-Simulation)

/** Play (Dreieck), Pause (zwei Balken) oder Nochmal (Kreispfeil), wie die SF-Symbole in iOS. */
@Composable
internal fun SpielSymbol(spielt: Boolean, fertig: Boolean, farbe: Color) {
    if (spielt) {
        Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            Box(Modifier.size(3.5.dp, 14.dp).background(farbe, RoundedCornerShape(1.dp)))
            Box(Modifier.size(3.5.dp, 14.dp).background(farbe, RoundedCornerShape(1.dp)))
        }
    } else if (fertig) {
        Canvas(Modifier.size(15.dp)) {
            val w = size.width
            val st = 2.2f * w / 15f
            drawArc(farbe, startAngle = -60f, sweepAngle = -270f, useCenter = false,
                topLeft = Offset(st, st), size = androidx.compose.ui.geometry.Size(w - 2 * st, w - 2 * st), style = Stroke(st, cap = StrokeCap.Round))
            val pfad = Path().apply {
                moveTo(w * 0.70f, 0f); lineTo(w * 0.98f, w * 0.30f); lineTo(w * 0.58f, w * 0.40f); close()
            }
            drawPath(pfad, farbe)
        }
    } else {
        Canvas(Modifier.padding(start = 2.dp).size(11.dp, 13.dp)) {
            val pfad = Path().apply { moveTo(0f, 0f); lineTo(size.width, size.height / 2); lineTo(0f, size.height); close() }
            drawPath(pfad, farbe)
        }
    }
}

@Composable
internal fun SimZeitleiste(
    spielt: Boolean, fertig: Boolean, bereit: Boolean, uhr: String, anteil: Float, striche: List<Float>, tempo: Int,
    abspielen: () -> Unit, tempoWechseln: () -> Unit, ziehen: (Float) -> Unit, ziehenEnde: () -> Unit,
) {
    val lime = EinsatzFarbe.lime
    Row(
        Modifier.fillMaxWidth().height(44.dp).background(Color.Black, RoundedCornerShape(12.dp)).padding(start = 8.dp, end = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.size(32.dp).alpha(if (bereit) 1f else 0.3f).tippen { if (bereit) abspielen() }, contentAlignment = Alignment.Center) {
            SpielSymbol(spielt, fertig, lime)
        }
        Box(Modifier.width(54.dp)) { PText(uhr, 16f, 700, Color.White) }
        BoxWithConstraints(
            Modifier.weight(1f).fillMaxSize().padding(horizontal = 8.dp).pointerInput(Unit) {
                awaitEachGesture {
                    val runter = awaitFirstDown()
                    runter.consume()
                    ziehen((runter.position.x / size.width).coerceIn(0f, 1f))
                    while (true) {
                        val e = awaitPointerEvent()
                        val c = e.changes.firstOrNull { it.id == runter.id } ?: break
                        if (!c.pressed) break
                        c.consume()
                        ziehen((c.position.x / size.width).coerceIn(0f, 1f))
                    }
                    ziehenEnde()
                }
            },
            contentAlignment = Alignment.CenterStart,
        ) {
            val b = maxWidth.value
            Box(Modifier.fillMaxWidth().height(2.dp).background(Color.White.copy(alpha = 0.2f), RoundedCornerShape(1.dp)))
            for (x in striche) Box(Modifier.offset((x * b - 0.5f).dp).size(1.dp, 8.dp).background(Color.White.copy(alpha = 0.25f)))
            Box(Modifier.width((anteil * b).dp).height(2.dp).background(lime, RoundedCornerShape(1.dp)))
            Box(Modifier.offset((anteil * b - 9f).dp).size(18.dp).background(lime.copy(alpha = 0.18f), CircleShape), contentAlignment = Alignment.Center) {
                Box(Modifier.size(12.dp).background(lime, CircleShape).border(1.dp, hex(0x202020), CircleShape))
            }
        }
        Box(Modifier.size(40.dp, 32.dp).tippen(tempoWechseln), contentAlignment = Alignment.Center) {
            PText("${tempo}x", 16f, 700, lime)
        }
    }
}

// MARK: - Modell (Plaene, Uhr, Strecken)

internal class EinsatzKartenModell {
    class Strecke(val pfad: List<GeoPunkt>) {
        val summen: List<Double> = buildList {
            add(0.0)
            for (i in 1 until max(1, pfad.size)) add(last() + meterZwischen(pfad[i - 1], pfad[i]))
        }
        val laenge: Double get() = summen.lastOrNull() ?: 0.0
    }

    class Weg(val strecke: Strecke, val minuten: Int)

    class Abschnitt(val art: String, val von: Double, val bis: Double, val a: GeoPunkt, val b: GeoPunkt, val fahrt: EinsatzFahrt?) {
        val gleich: Boolean get() = a.lat == b.lat && a.lng == b.lng
    }

    class FahrerPlan(val id: String, val name: String, val nummer: Long?, val abschnitte: List<Abschnitt>, val beginn: Double, val ende: Double, val fahrtBeginne: List<Int>)
    class Stand(val ort: GeoPunkt, val zustand: String, val abschnitt: Abschnitt)
    data class Anzeige(val nummer: Long?, val name: String, val zustand: String, val art: String, val etd: String?, val ab: String, val ziel: String)

    var plaene by mutableStateOf<List<FahrerPlan>>(emptyList()); private set
    var orteFertig by mutableStateOf(false); private set
    var von by mutableIntStateOf(6 * 60); private set
    var bis by mutableIntStateOf(22 * 60); private set
    var minute by mutableDoubleStateOf(0.0)
    var laeuft by mutableStateOf(false); private set
    var fertig by mutableStateOf(false); private set
    var tempo by mutableIntStateOf(1); private set
    var gewaehlt by mutableStateOf<String?>(null)
    var einpassenSignal by mutableIntStateOf(0)
    var takt by mutableIntStateOf(0); private set

    var orte: Map<String, GeoPunkt> = emptyMap(); private set
    private val wege = mutableMapOf<String, Weg>()
    private var vorschlaege: List<EinsatzVorschlag> = emptyList()
    private val nummern = mutableMapOf<String, Long>()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private var uhr: Job? = null
    private val offen = mutableSetOf<String>()
    private val warteschlange = mutableListOf<Triple<String, Pair<GeoPunkt, GeoPunkt>, Double>>()
    private var gestartet = false
    private var liefVorZiehen: Boolean? = null
    private var neueWege = 0
    private var buendel: Job? = null

    companion object {
        fun kmText(km: Double) = "${einsatzZahl(km, 1)} km"
        private fun schluessel(a: GeoPunkt, b: GeoPunkt) =
            String.format(java.util.Locale.ROOT, "%.5f,%.5f>%.5f,%.5f", a.lat, a.lng, b.lat, b.lng)
    }

    val fahrtStriche: List<Float>
        get() {
            val spanne = max(1, bis - von).toDouble()
            return plaene.flatMap { p -> p.fahrtBeginne.map { ((it - von) / spanne).toFloat() } }.filter { it in 0f..1f }
        }

    // MARK: Start

    fun starten(liste: List<EinsatzVorschlag>, fahrer: List<PlanFahrer>) {
        vorschlaege = liste
        for (f in fahrer) f.driverNumber?.let { nummern[f.id] = it }
        scope.launch {
            val adressen = mutableListOf<String>()
            for (v in liste) for (r in v.rides) for (a in listOf(r.adresseAb, r.adresseZiel)) {
                if (a.isNotBlank() && a !in adressen) adressen += a
            }
            val gefunden = mutableMapOf<String, GeoPunkt>()
            for (a in adressen) PlanRouten.punkt(a)?.let { gefunden[a] = it }
            orte = gefunden
            orteFertig = true
            planeBauen()
            einpassenSignal += 1
            if (plaene.isNotEmpty() && !gestartet) {
                gestartet = true
                minute = von.toDouble()
                takt += 1
                delay(900)
                laufen(true)
            }
            streckenLaden()
        }
    }

    fun anhalten() { scope.cancel() }

    // MARK: Plaene (planBauen)

    private fun dauer(a: GeoPunkt, b: GeoPunkt): Double {
        wege[schluessel(a, b)]?.let { return it.minuten.toDouble() }
        return max(4, rund((meterZwischen(a, b) * 1.35) / 1000 / 30 * 60).toInt()).toDouble()
    }

    private fun planeBauen() {
        plaene = vorschlaege.mapNotNull { v ->
            val fahrten = v.rides.mapNotNull { r ->
                val etd = EinsatzUhr.minuten(r.etd) ?: return@mapNotNull null
                val ab = orte[r.adresseAb] ?: orte[r.pickup] ?: return@mapNotNull null
                val ziel = orte[r.adresseZiel] ?: orte[r.dropoff] ?: return@mapNotNull null
                Triple(r, etd, ab to ziel)
            }.sortedBy { it.second }
            val erste = fahrten.firstOrNull() ?: return@mapNotNull null
            val beginn = v.startMinutes.toDouble()
            val abschnitte = mutableListOf<Abschnitt>()
            var ort = erste.third.first
            var zeit = beginn
            for ((f, etd, orte) in fahrten) {
                val (ab, ziel) = orte
                if (meterZwischen(ort, ab) > 60) {
                    val d = dauer(ort, ab)
                    abschnitte += Abschnitt("anfahrt", zeit, zeit + d, ort, ab, f)
                    zeit += d
                }
                val start = max(zeit, etd.toDouble())
                if (start > zeit) abschnitte += Abschnitt("warten", zeit, start, ab, ab, f)
                val fz = wege[schluessel(ab, ziel)]?.minuten?.toDouble() ?: (f.durationMinutes?.takeIf { it > 0 } ?: 25.0)
                abschnitte += Abschnitt("fahrt", start, start + fz, ab, ziel, f)
                zeit = start + fz
                ort = ziel
            }
            val ende = max(v.endMinutes.toDouble(), zeit)
            if (ende > zeit) abschnitte += Abschnitt("frei", zeit, ende, ort, ort, null)
            FahrerPlan(v.driverId.ifEmpty { v.id }, v.name, nummern[v.driverId], abschnitte, beginn, ende, fahrten.map { it.second })
        }
        if (plaene.isNotEmpty()) {
            val a = plaene.minOf { it.beginn }
            val b = plaene.maxOf { it.ende }
            von = floor(a / 30).toInt() * 30
            bis = ceil(b / 30).toInt() * 30
        }
        takt += 1
    }

    // MARK: Stand je Minute (standBei, kmBis)

    fun stand(p: FahrerPlan, minute: Double): Stand? {
        if (minute < p.beginn || minute > p.ende) return null
        val letzter = p.abschnitte.lastOrNull() ?: return null
        val s = p.abschnitte.firstOrNull { minute >= it.von && minute <= it.bis } ?: letzter
        val zustand = when (s.art) { "warten", "anfahrt" -> "inaktiv"; "fahrt" -> "aktiv"; else -> "frei" }
        if (s.gleich || s.art == "warten" || s.art == "frei") return Stand(s.a, zustand, s)
        val strecke = wege[schluessel(s.a, s.b)]?.strecke ?: Strecke(listOf(s.a, s.b))
        val anteil = (minute - s.von) / max(0.001, s.bis - s.von)
        return Stand(punkt(strecke, anteil), zustand, s)
    }

    /** Ebene des Pins: gewaehlt oben, aktive ueber den anderen. */
    fun oben(p: FahrerPlan, s: Stand): Float = if (gewaehlt == p.id) 2000f else if (s.zustand == "aktiv") 1200f else 1000f

    private fun punkt(s: Strecke, anteil: Double): GeoPunkt {
        if (s.pfad.size <= 1 || s.laenge <= 0) return s.pfad.firstOrNull() ?: GeoPunkt(0.0, 0.0)
        val ziel = anteil.coerceIn(0.0, 1.0) * s.laenge
        var i = 1
        while (i < s.summen.size - 1 && s.summen[i] < ziel) i += 1
        val a = s.pfad[i - 1]
        val b = s.pfad[i]
        val f = (ziel - s.summen[i - 1]) / max(1e-6, s.summen[i] - s.summen[i - 1])
        return GeoPunkt(a.lat + (b.lat - a.lat) * f, a.lng + (b.lng - a.lng) * f)
    }

    fun km(p: FahrerPlan, minute: Double): Double {
        if (minute <= p.beginn) return 0.0
        var meter = 0.0
        for (s in p.abschnitte) {
            if ((s.art == "fahrt" || s.art == "anfahrt") && !s.gleich && minute > s.von) {
                val laenge = wege[schluessel(s.a, s.b)]?.strecke?.laenge ?: (meterZwischen(s.a, s.b) * 1.35)
                meter += laenge * min(1.0, (minute - s.von) / max(0.001, s.bis - s.von))
            }
        }
        return meter / 1000
    }

    val zaehler: Map<String, Int>
        get() {
            val z = mutableMapOf("aktiv" to 0, "inaktiv" to 0, "frei" to 0)
            for (p in plaene) stand(p, minute)?.let { z[it.zustand] = (z[it.zustand] ?: 0) + 1 }
            return z
        }
    val kmAlle: Double get() = plaene.sumOf { km(it, minute) }
    val kmFahrer: Double get() = plaene.firstOrNull { it.id == gewaehlt }?.let { km(it, minute) } ?: 0.0

    val anzeige: Anzeige?
        get() {
            val id = gewaehlt ?: return null
            val p = plaene.firstOrNull { it.id == id } ?: return null
            val s = stand(p, minute) ?: return null
            val f = s.abschnitt.fahrt
            fun kurz(t: String) = t.split(",").firstOrNull()?.trim() ?: ""
            return Anzeige(
                p.nummer, p.name, s.zustand, s.abschnitt.art, f?.etd,
                kurz(f?.let { it.pickup.ifEmpty { it.adresseAb } } ?: ""),
                kurz(f?.let { it.dropoff.ifEmpty { it.adresseZiel } } ?: ""),
            )
        }

    /** Strecke des gewaehlten Fahrers (Art, Pfad). */
    val auswahlStrecke: Pair<String, List<GeoPunkt>>?
        get() {
            val id = gewaehlt ?: return null
            val p = plaene.firstOrNull { it.id == id } ?: return null
            val s = stand(p, minute) ?: return null
            val a = s.abschnitt
            if (!(a.art == "fahrt" || a.art == "anfahrt") || a.gleich) return null
            return a.art to (wege[schluessel(a.a, a.b)]?.strecke?.pfad ?: listOf(a.a, a.b))
        }

    // MARK: Uhr

    private fun laufen(an: Boolean) {
        laeuft = an
        uhr?.cancel()
        if (!an) return
        uhr = scope.launch {
            var zuletzt = System.nanoTime() / 1_000_000
            while (isActive) {
                delay(33)
                val jetzt = System.nanoTime() / 1_000_000
                val dt = min(0.1, (jetzt - zuletzt) / 1000.0).coerceAtLeast(0.0)
                zuletzt = jetzt
                val naechste = minute + dt * 6 * tempo
                if (naechste >= bis) {
                    minute = bis.toDouble()
                    takt += 1
                    laeuft = false
                    fertig = true
                    return@launch
                }
                minute = naechste
                takt += 1
            }
        }
    }

    fun abspielen() {
        if (fertig) {
            minute = von.toDouble()
            fertig = false
            takt += 1
        }
        laufen(!laeuft)
    }

    fun tempoWechseln() {
        val t = listOf(1, 2, 4)
        tempo = t[(t.indexOf(tempo).coerceAtLeast(0) + 1) % t.size]
    }

    /** Zeitleiste ziehen: waehrend des Ziehens steht die Uhr. */
    fun ziehen(anteil: Double) {
        if (liefVorZiehen == null) {
            liefVorZiehen = laeuft
            laufen(false)
            fertig = false
        }
        minute = von + anteil.coerceIn(0.0, 1.0) * (bis - von)
        takt += 1
    }

    fun ziehenEnde() {
        if (liefVorZiehen == true) laufen(true)
        liefVorZiehen = null
    }

    fun waehlen(id: String?) {
        gewaehlt = if (id == null || gewaehlt == id) null else id
        takt += 1
    }

    // MARK: Strecken nachladen (zwei gleichzeitig, kurze Pause, was bald gefahren wird zuerst)

    private fun streckenLaden() {
        val alle = linkedMapOf<String, Triple<String, Pair<GeoPunkt, GeoPunkt>, Double>>()
        for (p in plaene) for (s in p.abschnitte) {
            if ((s.art == "anfahrt" || s.art == "fahrt") && !s.gleich) {
                val k = schluessel(s.a, s.b)
                if (wege[k] == null && k !in offen && alle[k] == null) alle[k] = Triple(k, s.a to s.b, s.von)
            }
        }
        warteschlange.clear()
        warteschlange += alle.values
        if (warteschlange.isEmpty()) return
        warteschlange.forEach { offen += it.first }
        repeat(2) {
            scope.launch {
                while (isActive) {
                    val e = naechste() ?: break
                    val s = PlanRouten.strecke(e.second.first, e.second.second)
                    offen.remove(e.first)
                    if (!s.notloesung && s.punkte.size >= 2) {
                        wege[e.first] = Weg(Strecke(s.punkte), max(3, rund(s.sekunden / 60.0).toInt()))
                        neueWege += 1
                        melden()
                    }
                    delay(220)
                }
            }
        }
    }

    private fun naechste(): Triple<String, Pair<GeoPunkt, GeoPunkt>, Double>? {
        if (warteschlange.isEmpty()) return null
        val jetzt = minute
        fun rang(v: Double) = if (v < jetzt - 20) 10_000 + v else abs(v - jetzt)
        warteschlange.sortBy { rang(it.third) }
        return warteschlange.removeAt(0)
    }

    /** Neue Strecken gebuendelt alle 700 ms in die Plaene uebernehmen. */
    private fun melden() {
        if (buendel != null) return
        buendel = scope.launch {
            delay(700)
            buendel = null
            if (neueWege > 0) { neueWege = 0; planeBauen() }
        }
    }
}
