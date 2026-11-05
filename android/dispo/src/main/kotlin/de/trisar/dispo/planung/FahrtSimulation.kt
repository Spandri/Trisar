package de.trisar.dispo.planung

import android.content.Intent
import android.net.Uri
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableDoubleStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.zIndex
import de.trisar.kern.Backend
import de.trisar.kern.FussleisteUnten
import de.trisar.kern.Icon
import de.trisar.kern.grotesk
import de.trisar.kern.hex
import de.trisar.kern.platz
import de.trisar.kern.tippen
import io.github.jan.supabase.postgrest.from
import io.github.jan.supabase.postgrest.query.Columns
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonObject
import java.net.HttpURLConnection
import java.net.URL
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.ZoneId
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min

// Fahrt-Simulation (FahrtSimulationAnsicht.swift, FahrtSimulationView.jsx): Tagesansicht eines Planer-
// Vorschlags. Spielt die geplante Route des Fahrers im Zeitraffer auf der echten Karte ab. Orte und
// Strecken wie in iOS ueber Nominatim und OSRM.

/** Eine Fahrt des Vorschlags (entry.rides). durationMinutes: echte Fahrzeit, null = Annahme aus den Regeln. */
internal data class NebenSimFahrt(val etd: String, val pickup: String, val dropoff: String, val durationMinutes: Double? = null)

/** Ladestopp aus dem Fahrzeugplan (Zeiten als ISO-Text). */
internal data class NebenSimLadestopp(val start: String, val end: String, val stationName: String = "", val kmGained: Double = 0.0)

/** Vorschlag eines Fahrers fuer einen Tag (entry im Web). */
internal data class NebenSimEintrag(
    val dayIso: String, val driverId: String, val name: String, val start: String, val end: String,
    val rides: List<NebenSimFahrt>, val chargeStops: List<NebenSimLadestopp> = emptyList(),
    val rideDurationMinutes: Double? = null, val vehicleId: String = "", val vehicleIsEv: Boolean = false,
    val vehicleLabel: String = "", val shiftKm: Int? = null,
) {
    companion object {
        /** Vorschlag aus dem Planer in den Eintrag der Fahrt-Simulation uebersetzen (entry im Web). */
        fun aus(v: EinsatzVorschlag, dauer: Int) = NebenSimEintrag(
            dayIso = v.dayIso, driverId = v.driverId, name = v.name, start = v.start, end = v.end,
            rides = v.rides.map { NebenSimFahrt(it.etd, it.pickup, it.dropoff, it.durationMinutes) },
            chargeStops = v.chargeStops.mapNotNull { s ->
                val o = s as? JsonObject ?: return@mapNotNull null
                NebenSimLadestopp(o["start"].planText, o["end"].planText, o["stationName"].planText, o["kmGained"].planZahl ?: 0.0)
            },
            rideDurationMinutes = dauer.toDouble(), vehicleId = v.vehicleId, vehicleIsEv = v.vehicleIsEv,
            vehicleLabel = v.vehicleLabel, shiftKm = v.shiftKm,
        )
    }
}

private class SimAbschnitt(val gast: Boolean, val vonMin: Double, val bisMin: Double, val pts: List<GeoPunkt>, val km: Double)
private class SimRoute(val legs: List<SimAbschnitt>, val stationen: List<Pair<GeoPunkt, Int>>, val allePunkte: List<GeoPunkt>, val endeMin: Double?, val fahrtIndex: List<Int>)
private data class PlanFahrtSim(val nr: Int, val etd: String, val von: String, val nach: String, val startMin: Double, val endMin: Double)
private data class PlanLaden(val startMin: Double, val endMin: Double, val station: String, val kmGained: Double)

/** Realer Verbrauch nach ev-database.org (services/evConsumption.js). */
private class SimEvModell(val muster: String, val nutzbarKwh: Double, val stadtKalt: Double, val stadtMild: Double, val autobahnKalt: Double, val autobahnMild: Double) {
    companion object {
        val modelle = listOf(
            SimEvModell("""ix\s*m70""", 108.9, 220.0, 153.0, 303.0, 237.0),
            SimEvModell("""i7\s*m70""", 101.7, 214.0, 148.0, 286.0, 224.0),
            SimEvModell("""ix3""", 82.6, 172.0, 114.0, 229.0, 178.0),
        )

        fun finden(modell: String?, ausstattung: String?): SimEvModell? {
            val text = "${modell ?: ""} ${ausstattung ?: ""}".trim()
            return modelle.firstOrNull { Regex(it.muster, RegexOption.IGNORE_CASE).containsMatchIn(text) }
        }

        private fun mix(kalt: Double, mild: Double, anteil: Double) = kalt + (mild - kalt) * anteil.coerceIn(0.0, 1.0)

        /** Tagesmitteltemperatur Muenchen ueber Open-Meteo (ohne Schluessel). */
        suspend fun tagesTemperatur(dayIso: String): Double? = withContext(Dispatchers.IO) {
            val tag = dayIso.take(10)
            if (!Regex("""^\d{4}-\d{2}-\d{2}$""").matches(tag)) return@withContext null
            runCatching {
                val v = URL("https://api.open-meteo.com/v1/forecast?latitude=48.137&longitude=11.575&daily=temperature_2m_max,temperature_2m_min&timezone=auto&start_date=$tag&end_date=$tag").openConnection() as HttpURLConnection
                try {
                    if (v.responseCode != 200) return@runCatching null
                    val o = planJson.parseToJsonElement(v.inputStream.bufferedReader().use { it.readText() }) as JsonObject
                    val d = o["daily"].alsObjekt() ?: return@runCatching null
                    val hoch = d["temperature_2m_max"].alsListe()?.firstOrNull().planZahl ?: return@runCatching null
                    val tief = d["temperature_2m_min"].alsListe()?.firstOrNull().planZahl ?: return@runCatching null
                    (hoch + tief) / 2
                } finally { v.disconnect() }
            }.getOrNull()
        }
    }

    fun prozentVerbraucht(celsius: Double?, km: Double, minuten: Double): Double {
        if (km <= 0) return 0.0
        val warm = celsius?.let { ((it + 10) / 33).coerceIn(0.0, 1.0) } ?: 1.0
        // Bis 50 km/h Stadt, ab 90 km/h Autobahn, dazwischen gemischt.
        val autobahn = if (minuten > 0) ((km / (minuten / 60) - 50) / 40).coerceIn(0.0, 1.0) else 0.0
        val wh = mix(mix(stadtKalt, stadtMild, warm), mix(autobahnKalt, autobahnMild, warm), autobahn)
        return (wh * km) / 1000 / nutzbarKwh * 100
    }
}

private fun uhrZuMin(text: String?): Int? {
    val t = (text ?: "").trim()
    val m = Regex("""^(\d{1,2}):(\d{2})""").find(t) ?: return null
    return m.groupValues[1].toInt() * 60 + m.groupValues[2].toInt()
}

private fun minZuUhr(min: Double): String {
    val m = max(0, rund(min).toInt())
    return zwei((m / 60) % 24) + ":" + zwei(m % 60)
}

/** new Date(text).getHours()*60 + getMinutes() in Ortszeit. */
private fun ortsMinuten(text: String): Double? {
    val z = runCatching { OffsetDateTime.parse(text).atZoneSameInstant(ZoneId.systemDefault()).toLocalTime() }.getOrNull()
        ?: runCatching { LocalDateTime.parse(text.take(19)).toLocalTime() }.getOrNull() ?: return null
    return (z.hour * 60 + z.minute).toDouble()
}

/** Position auf einer Linie bei Anteil p (0…1), laengenproportional. */
private fun punktAufLinie(pts: List<GeoPunkt>, p: Double): GeoPunkt? {
    val erster = pts.firstOrNull() ?: return null
    if (pts.size == 1) return erster
    val d = mutableListOf(0.0)
    for (i in 1 until pts.size) d += d[i - 1] + hypot(pts[i].lng - pts[i - 1].lng, pts[i].lat - pts[i - 1].lat)
    val gesamt = d.last()
    if (gesamt <= 0) return erster
    val ziel = p.coerceIn(0.0, 1.0) * gesamt
    for (i in 1 until pts.size) if (d[i] >= ziel) {
        val f = (ziel - d[i - 1]) / max(1e-9, d[i] - d[i - 1])
        return GeoPunkt(pts[i - 1].lat + (pts[i].lat - pts[i - 1].lat) * f, pts[i - 1].lng + (pts[i].lng - pts[i - 1].lng) * f)
    }
    return pts.last()
}

private fun abstandM(a: GeoPunkt, b: GeoPunkt) = hypot((b.lat - a.lat) * 110_574, (b.lng - a.lng) * 111_320 * kotlin.math.cos(a.lat * Math.PI / 180))

@Composable
internal fun FahrtSimulationAnsicht(entry: NebenSimEintrag, zurueck: () -> Unit) {
    val lime = hex(0xE3F754)
    val tempi = listOf(1.0, 2.0, 4.0)
    var telefon by remember { mutableStateOf("") }
    var fahrerNummer by remember { mutableStateOf("") }
    // Startet pausiert, erst Play (oder der Selbststart) laesst die Uhr laufen.
    var spielt by remember { mutableStateOf(false) }
    var gestartet by remember { mutableStateOf(false) }
    var fertig by remember { mutableStateOf(false) }
    var tempo by remember { mutableDoubleStateOf(2.0) }
    var simMin by remember { mutableDoubleStateOf((uhrZuMin(entry.start) ?: 360).toDouble()) }
    var route by remember { mutableStateOf<SimRoute?>(null) }
    var routeStatus by remember { mutableStateOf("laedt") }
    var routeNr by remember { mutableIntStateOf(0) }
    var modell by remember { mutableStateOf<SimEvModell?>(null) }
    var akkuStart by remember { mutableDoubleStateOf(100.0) }
    var tempC by remember { mutableStateOf<Double?>(null) }
    var ziehtVorher by remember { mutableStateOf<Boolean?>(null) }
    val halter = remember { PlanKarteHalter() }
    val ctx = LocalContext.current

    val fahrten = remember(entry) {
        entry.rides.mapIndexedNotNull { i, r ->
            val s = uhrZuMin(r.etd) ?: return@mapIndexedNotNull null
            val dauer = r.durationMinutes?.takeIf { it > 0 } ?: entry.rideDurationMinutes?.takeIf { it > 0 } ?: 80.0
            PlanFahrtSim(i + 1, r.etd, r.pickup, r.dropoff, s.toDouble(), s + dauer)
        }.sortedBy { it.startMin }
    }
    val laden = remember(entry) {
        entry.chargeStops.mapNotNull { c ->
            val a = ortsMinuten(c.start) ?: return@mapNotNull null
            val b = ortsMinuten(c.end) ?: return@mapNotNull null
            if (b <= a) null else PlanLaden(a, b, c.stationName.trim(), c.kmGained)
        }
    }
    /** Leerfahrtminuten = Luecken zwischen den Fahrten, Ladezeit zaehlt nicht. */
    val leerMinutenPlan = run {
        var leer = 0.0
        for (i in 1 until fahrten.size) leer += max(0.0, fahrten[i].startMin - fahrten[i - 1].endMin)
        for (c in laden) leer = max(0.0, leer - (c.endMin - c.startMin))
        leer
    }
    val dienstStart = (uhrZuMin(entry.start) ?: 360).toDouble()
    val dienstEnde = (uhrZuMin(entry.end) ?: (dienstStart.toInt() + 480)).toDouble()
    val r = route
    val simStart = r?.legs?.firstOrNull()?.vonMin ?: dienstStart
    val simEnde = r?.endeMin?.let { max(it, simStart + 30) } ?: dienstEnde

    fun aktiverAbschnitt(legs: List<SimAbschnitt>): Int {
        legs.indexOfFirst { simMin >= it.vonMin && simMin <= it.bisMin }.takeIf { it >= 0 }?.let { return it }
        legs.indexOfFirst { simMin < it.vonMin }.takeIf { it >= 0 }?.let { return it }
        return legs.size - 1
    }
    /** Rot mit Gast, gelb auf Leerfahrt, gruen beim Laden. */
    val zustand = when {
        laden.any { simMin >= it.startMin && simMin <= it.endMin } -> "laden"
        r == null -> "leer"
        r.legs.firstOrNull { simMin >= it.vonMin && simMin <= it.bisMin }?.gast == true -> "gast"
        else -> "leer"
    }
    val punkt = r?.takeIf { it.legs.isNotEmpty() }?.let { ro ->
        val leg = ro.legs[aktiverAbschnitt(ro.legs)]
        punktAufLinie(leg.pts, ((simMin - leg.vonMin) / max(1.0, leg.bisMin - leg.vonMin)).coerceIn(0.0, 1.0))
    }
    // aktiv: Gastfahrt (Fahrt, von, bis), Laden oder leer.
    val aktivLaden = laden.firstOrNull { simMin >= it.startMin && simMin <= it.endMin }
    val aktivGast: Triple<PlanFahrtSim, Double, Double>? = if (aktivLaden != null) null else if (r != null) {
        // Abschnitte wechseln: gerade = Gastfahrt k, ungerade = Leerfahrt danach.
        val i = r.legs.indexOfFirst { simMin >= it.vonMin && simMin <= it.bisMin }
        if (i >= 0 && r.legs[i].gast && i / 2 < r.fahrtIndex.size && r.fahrtIndex[i / 2] < fahrten.size) {
            Triple(fahrten[r.fahrtIndex[i / 2]], r.legs[i].vonMin, r.legs[i].bisMin)
        } else null
    } else fahrten.firstOrNull { simMin >= it.startMin && simMin <= it.endMin }?.let { Triple(it, it.startMin, it.endMin) }

    /** Kamera: vor dem Start und nach dem Ende der ganze Tag (-1), sonst die aktuelle Fahrt. */
    val kameraZiel: Int? = r?.takeIf { it.legs.isNotEmpty() }?.let { if (!gestartet || fertig) -1 else aktiverAbschnitt(it.legs) / 2 }

    /** Ladestand beim Start jeder Fahrt aus den echten Streckenkilometern. */
    val ladestaende: Map<Int, Int>? = run {
        val mo = modell
        if (!entry.vehicleIsEv || r == null || mo == null) return@run null
        val werte = mutableMapOf<Int, Int>()
        var prozent = akkuStart
        r.legs.forEachIndexed { i, leg ->
            if (leg.gast) werte[i / 2] = rund(prozent.coerceIn(0.0, 100.0)).toInt()
            prozent -= mo.prozentVerbraucht(tempC, leg.km, leg.bisMin - leg.vonMin)
            for (c in laden) if (c.endMin > leg.vonMin && c.endMin <= leg.bisMin) {
                val zuwachs = if (c.kmGained > 0) mo.prozentVerbraucht(tempC, c.kmGained, c.kmGained) else 40.0
                prozent = min(100.0, prozent + zuwachs)
            }
        }
        werte
    }
    val leerGesamt = r?.legs?.filter { !it.gast }?.sumOf { it.bisMin - it.vonMin } ?: leerMinutenPlan

    // Laden: Profil, Fahrzeug, Temperatur, Route.
    LaunchedEffect(entry.driverId) {
        if (entry.driverId.isEmpty()) return@LaunchedEffect
        runCatching {
            Backend.client.from("profiles").select(Columns.raw("phone, driver_number")) {
                filter { eq("id", entry.driverId) }; limit(1)
            }.decodeList<JsonObject>().firstOrNull()
        }.getOrNull()?.let { z ->
            telefon = z.text("phone")
            fahrerNummer = z.text("driver_number")
        }
    }
    LaunchedEffect(entry.vehicleId) {
        if (!entry.vehicleIsEv || entry.vehicleId.isEmpty()) { modell = null; return@LaunchedEffect }
        val z = runCatching {
            Backend.client.from("vehicles").select(Columns.raw("brand_model, trim, battery_fuel_percent")) {
                filter { eq("id", entry.vehicleId) }; limit(1)
            }.decodeList<JsonObject>().firstOrNull()
        }.getOrNull()
        if (z == null) { modell = null; return@LaunchedEffect }
        modell = SimEvModell.finden(z.text("brand_model"), z.text("trim"))
        akkuStart = z["battery_fuel_percent"].planZahl ?: 100.0
    }
    LaunchedEffect(entry.dayIso) { tempC = SimEvModell.tagesTemperatur(entry.dayIso) }
    LaunchedEffect(entry) {
        // Orte aufloesen, Strecken rechnen, Zeitleiste streng nacheinander aus den echten Fahrzeiten.
        route = null
        if (fahrten.isEmpty()) { routeStatus = "keine-fahrten"; return@LaunchedEffect }
        routeStatus = "laedt"
        data class KF(val index: Int, val fahrt: PlanFahrtSim, val von: GeoPunkt, val nach: GeoPunkt)
        val karte = mutableListOf<KF>()
        for ((i, f) in fahrten.withIndex()) {
            val von = PlanRouten.punkt(f.von)
            val nach = PlanRouten.punkt(f.nach)
            if (von != null && nach != null) karte += KF(i, f, von, nach)
        }
        val erste = karte.firstOrNull() ?: run { routeStatus = "fehler"; return@LaunchedEffect }
        val punkte = karte.flatMap { listOf(it.von, it.nach) }
        val legs = mutableListOf<SimAbschnitt>()
        var cursor = erste.fahrt.startMin
        for (i in 0 until punkte.size - 1) {
            val s = PlanRouten.strecke(punkte[i], punkte[i + 1])
            val k = i / 2
            val gast = i % 2 == 0
            if (gast) cursor = max(cursor, karte[k].fahrt.startMin)
            val von = cursor
            val bis = von + s.sekunden / 60.0
            legs += SimAbschnitt(gast, von, bis, s.punkte, s.meter / 1000.0)
            // Nach der Leerfahrt ggf. bis zur geplanten Abholzeit warten.
            cursor = if (!gast && k + 1 < karte.size) max(bis, karte[k + 1].fahrt.startMin) else bis
        }
        route = SimRoute(legs, karte.map { it.von to it.fahrt.nr }, legs.flatMap { it.pts }, legs.lastOrNull()?.bisMin, karte.map { it.index })
        routeNr += 1
        routeStatus = "ok"
        // Uhr an den Anfang der echten Route, kurz danach laeuft sie von selbst los.
        simMin = legs.firstOrNull()?.vonMin ?: simMin
        gestartet = false
        fertig = false
        spielt = false
        delay(900)
        gestartet = true
        spielt = true
    }
    // 1x = 6 Sim-Minuten pro Sekunde.
    LaunchedEffect(spielt) {
        if (!spielt) return@LaunchedEffect
        var zuletzt = System.nanoTime()
        while (spielt) {
            delay(33)
            val jetzt = System.nanoTime()
            val dt = min(0.5, (jetzt - zuletzt) / 1e9)
            zuletzt = jetzt
            val ende = route?.endeMin?.let { e -> max(e, (route?.legs?.firstOrNull()?.vonMin ?: dienstStart) + 30) } ?: dienstEnde
            val naechste = simMin + dt * 6 * tempo
            if (naechste >= ende) {
                // Ende der Route: stehenbleiben, nicht neu starten.
                simMin = ende
                spielt = false
                fertig = true
                return@LaunchedEffect
            }
            simMin = naechste
        }
    }
    // Linien der Route (gelb gestrichelt leer, blau mit Gast).
    LaunchedEffect(routeNr, halter.bereit) {
        if (!halter.bereit) return@LaunchedEffect
        val legs = route?.legs ?: emptyList()
        halter.linie("sim-leer", legs.filter { !it.gast }.map { it.pts }, hex(0xE3F654), 5f, arrayOf(1.6f, 0.8f), rund = false)
        halter.linie("sim-gast", legs.filter { it.gast }.map { it.pts }, hex(0x0059FF), 6f, deckung = 0.9f)
    }
    var kameraSchluessel by remember { mutableStateOf("") }
    LaunchedEffect(kameraZiel, routeNr, halter.bereit) {
        val ro = route ?: return@LaunchedEffect
        val ziel = kameraZiel ?: return@LaunchedEffect
        if (!halter.bereit) return@LaunchedEffect
        val schluessel = "$routeNr-$ziel"
        if (schluessel == kameraSchluessel) return@LaunchedEffect
        val pts = if (ziel < 0) ro.allePunkte else
            (if (ziel * 2 < ro.legs.size) ro.legs[ziel * 2].pts else emptyList()) + (if (ziel * 2 + 1 < ro.legs.size) ro.legs[ziel * 2 + 1].pts else emptyList())
        if (pts.isEmpty()) return@LaunchedEffect
        // Rand wie auf der Tageskarte: oben Knoepfe und Leisten, unten die Fahrerleiste.
        if (halter.einpassen(pts, 262f, 32f, 190f, 32f, 1400)) kameraSchluessel = schluessel
    }

    Box(Modifier.fillMaxSize().background(Color.Black).abschirmen()) {
        PlanKarteFlaeche(halter, Modifier.fillMaxSize(), 11.0)

        // Stationen (gruener Pin mit Fahrtnummer(n)) und Fahrer-Punkt.
        Box(Modifier.fillMaxSize()) {
            @Suppress("UNUSED_VARIABLE") val takt = halter.bewegt + routeNr
            if (halter.bereit && r != null) {
                // Mehrere Abholungen naeher als 40 m teilen sich einen Pin ("1/3").
                val orte = mutableListOf<Pair<GeoPunkt, MutableList<Int>>>()
                for ((ort, nr) in r.stationen) {
                    val i = orte.indexOfFirst { abstandM(it.first, ort) <= 40 }
                    if (i >= 0) orte[i].second += nr else orte += ort to mutableListOf(nr)
                }
                orte.forEachIndexed { i, (ort, nummern) ->
                    val o = halter.bildschirm(ort) ?: return@forEachIndexed
                    val text = nummern.joinToString("/")
                    Box(Modifier.offset((o.x - 17.5f).dp, (o.y - 41.1367f).dp).size(35.dp, 41.1367.dp).zIndex((320 + orte.size - i).toFloat())) {
                        Icon("Fahrer_Pin_Trisar_01_gruen", Modifier.size(35.dp, 41.1367.dp), skalierung = ContentScale.FillBounds)
                        Box(Modifier.offset(0.dp, 5.5.dp).size(35.dp, 24.dp), contentAlignment = Alignment.Center) {
                            PText(text, if (text.length > 3) 11f else 15f, 700, hex(0x1A1A1A))
                        }
                    }
                }
            }
            val ort = punkt
            if (halter.bereit && ort != null) {
                halter.bildschirm(ort)?.let { o ->
                    // Fahrer als Punkt mit Nummer: rot mit Gast, gruen beim Laden, gelb (Kopf des gelben Pins) leer.
                    Box(Modifier.offset((o.x - 17.5f).dp, (o.y - 17.5f).dp).size(35.dp).zIndex(400f).clipKreis()) {
                        when (zustand) {
                            "gast" -> Icon("Fahrer_Punkt_Trisar_01_rot", Modifier.size(35.dp), skalierung = ContentScale.FillBounds)
                            "laden" -> Icon("Fahrer_Punkt_Trisar_01_gruen", Modifier.size(35.dp), skalierung = ContentScale.FillBounds)
                            else -> Icon("Fahrer_Pin_Trisar_01_gelb", Modifier.size(35.dp, 41.1367.dp), skalierung = ContentScale.FillBounds)
                        }
                        Box(Modifier.size(35.dp), contentAlignment = Alignment.Center) {
                            PText(fahrerNummer.ifEmpty { "•" }, 15f, 700, hex(0x1A1A1A))
                        }
                    }
                }
            }
        }

        BoxWithConstraints(Modifier.fillMaxSize()) {
            val rasterHoehe = maxHeight.value
            Box(Modifier.width(402.dp).height(rasterHoehe.dp).align(Alignment.TopCenter)) {
                Box(Modifier.platz(20f, 60f, 50f, 50f).background(Color.Black, CircleShape).clipKreis().tippen(zurueck)) {
                    Icon("Backbutton_Karte", Modifier.size(50.dp))
                }
                Box(Modifier.platz(20f, 60f, 362f, 50f), contentAlignment = Alignment.CenterEnd) {
                    Box(Modifier.height(50.dp).background(Color.Black, RoundedCornerShape(25.dp)).padding(horizontal = 18.dp), contentAlignment = Alignment.Center) {
                        PText(EinsatzUhr.format(entry.dayIso, "EEE, d. MMM"), 16f, 700, lime, 0.5f)
                    }
                }

                Box(Modifier.platz(20f, 142f, 362f, 44f)) {
                    val spanne = max(1.0, simEnde - simStart)
                    SimZeitleiste(
                        spielt = spielt, fertig = fertig, bereit = r != null, uhr = minZuUhr(simMin),
                        anteil = ((simMin - simStart) / spanne).toFloat().coerceIn(0f, 1f),
                        striche = fahrten.map { ((it.startMin - simStart) / spanne).toFloat().coerceIn(0f, 1f) },
                        tempo = tempo.toInt(),
                        abspielen = {
                            if (fertig) {
                                // Nach dem Durchlauf startet Play die Simulation neu.
                                simMin = simStart
                                fertig = false
                            }
                            gestartet = true
                            spielt = !spielt
                        },
                        tempoWechseln = { tempo = tempi[(tempi.indexOf(tempo).coerceAtLeast(0) + 1) % tempi.size] },
                        ziehen = { a ->
                            if (ziehtVorher == null) {
                                ziehtVorher = spielt
                                spielt = false
                                gestartet = true
                                fertig = false
                            }
                            simMin = simStart + a * (simEnde - simStart)
                        },
                        ziehenEnde = {
                            if (ziehtVorher == true) spielt = true
                            ziehtVorher = null
                        },
                    )
                }

                Box(Modifier.platz(20f, 194f, 362f)) {
                    if (r != null) {
                        val naechste = fahrten.firstOrNull { it.startMin >= simMin }
                        val kmBisher = r.legs.sumOf { l ->
                            when {
                                simMin >= l.bisMin -> l.km
                                simMin <= l.vonMin -> 0.0
                                else -> l.km * ((simMin - l.vonMin) / max(1.0, l.bisMin - l.vonMin))
                            }
                        }
                        val aktivIndex = aktivGast?.let { g -> fahrten.indexOfFirst { it.nr == g.first.nr }.takeIf { it >= 0 } }
                        val akku = if (!fertig) aktivIndex?.let { ladestaende?.get(it) } else null
                        val farbe by animateColorAsState(
                            when (zustand) { "gast" -> hex(0xFF6F63); "laden" -> hex(0x59BE80); else -> hex(0xE3F654) }, tween(300), label = "zustand",
                        )
                        Column(
                            Modifier.width(362.dp).background(Color.Black, RoundedCornerShape(12.dp))
                                .padding(start = 16.dp, end = 16.dp, top = 14.dp, bottom = 12.dp)
                        ) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Box(Modifier.size(12.dp).background(farbe, CircleShape).border(1.dp, hex(0x202020), CircleShape))
                                Spacer(Modifier.width(10.dp))
                                val titel = when {
                                    fertig -> "Simulation beendet"
                                    aktivGast != null -> "#${aktivGast.first.nr} ${minZuUhr(aktivGast.second)} – ${minZuUhr(aktivGast.third)}"
                                    aktivLaden != null -> if (entry.vehicleIsEv) "Ladestopp" else "Tankstopp"
                                    naechste != null -> "Anfahrt #${naechste.nr}"
                                    else -> "frei"
                                }
                                Text(titel, style = grotesk(16f, 700), maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
                                if (akku != null) {
                                    Spacer(Modifier.width(10.dp))
                                    PText("$akku %", 13f, 700, hex(if (akku >= 40) 0x2E8B45 else if (akku >= 20) 0xC07A10 else 0xC0392B))
                                }
                                Spacer(Modifier.weight(1f))
                                PText(kmText(kmBisher), 16f, 700, lime)
                            }
                            val unter = when {
                                fertig -> buildAnnotatedString { append("${fahrten.size} Fahrten · ${rund(leerGesamt).toInt()} min Leerfahrt") }
                                aktivGast != null -> buildAnnotatedString {
                                    val f = aktivGast.first
                                    append("${kurzeAdresse(f.von).ifEmpty { f.von }} – ${kurzeAdresse(f.nach).ifEmpty { f.nach }}")
                                }
                                aktivLaden != null -> buildAnnotatedString { append(aktivLaden.station) }
                                naechste != null -> buildAnnotatedString {
                                    withStyle(SpanStyle(fontWeight = FontWeight(700), color = Color.White)) { append("${naechste.etd} Uhr") }
                                    append(" · ${kurzeAdresse(naechste.von).ifEmpty { naechste.von }}")
                                }
                                else -> buildAnnotatedString { append("Bereitschaft / Leerfahrt") }
                            }
                            Box(Modifier.padding(start = 22.dp, top = 8.dp).height(18.dp), contentAlignment = Alignment.CenterStart) {
                                Text(unter, style = grotesk(13f, farbe = Color.White.copy(alpha = 0.6f)), maxLines = 1, overflow = TextOverflow.Ellipsis)
                            }
                        }
                    } else {
                        Box(
                            Modifier.width(362.dp).heightIn(min = 44.dp).background(Color.Black, RoundedCornerShape(12.dp))
                                .padding(horizontal = 16.dp, vertical = 12.dp),
                            contentAlignment = Alignment.Center,
                        ) {
                            PAbsatz(
                                when (routeStatus) {
                                    "keine-fahrten" -> "Keine Fahrten in diesem Vorschlag — nichts zu simulieren."
                                    "fehler" -> "Route konnte nicht geladen werden."
                                    else -> "Echte Route wird geladen …"
                                },
                                13f, 500, 17f, lime, 0.5f, ausrichtung = TextAlign.Center,
                            )
                        }
                    }
                }

                // Fahrerkarte unten, 60 ueber dem Rand.
                val kmGesamt: Int? = r?.let { ro -> rund(ro.legs.sumOf { it.km }).toInt() } ?: entry.shiftKm
                val weiss = Color.White.copy(alpha = 0.6f)
                Column(
                    Modifier.align(Alignment.BottomCenter).offset(y = (-60).dp).width(362.dp)
                        .background(Color.Black, RoundedCornerShape(12.dp)).padding(start = 16.dp, end = 16.dp, top = 14.dp, bottom = 13.dp)
                ) {
                    Row(Modifier.heightIn(min = 22.dp), verticalAlignment = Alignment.CenterVertically) {
                        val name = buildAnnotatedString {
                            if (fahrerNummer.isNotEmpty()) withStyle(SpanStyle(color = lime)) { append("$fahrerNummer ") }
                            append(entry.name)
                        }
                        Text(name, style = grotesk(20f, 700), maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                        if (telefon.isNotEmpty()) {
                            PText(telefon, 14f, 700, lime, modifier = Modifier.padding(start = 10.dp).tippen {
                                val nummer = telefon.replace(Regex("""[\s()-]"""), "")
                                runCatching { ctx.startActivity(Intent(Intent.ACTION_DIAL, Uri.parse("tel:$nummer"))) }
                            })
                        }
                    }
                    val dienst = buildAnnotatedString {
                        append("Dienst ")
                        withStyle(SpanStyle(fontWeight = FontWeight(700), color = Color.White)) { append("${entry.start} – ${entry.end}") }
                        if (entry.vehicleLabel.isNotEmpty()) append(" · ${entry.vehicleLabel}")
                    }
                    Box(Modifier.padding(top = 8.dp).height(18.dp), contentAlignment = Alignment.CenterStart) {
                        Text(dienst, style = grotesk(13f, farbe = weiss), maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                    // "N Fahrten · km km · M min Leerfahrt · n× laden", Zahlen fett und weiss.
                    val kennzahlen = buildAnnotatedString {
                        fun fett(s: String) = withStyle(SpanStyle(fontWeight = FontWeight(700), color = Color.White)) { append(s) }
                        fett("${fahrten.size}"); append(" Fahrten · ")
                        if (kmGesamt != null) { fett("$kmGesamt"); append(" km · ") }
                        fett("${rund(leerGesamt).toInt()}"); append(" min Leerfahrt · ")
                        fett("${laden.size}×"); append(" ${if (entry.vehicleIsEv) "laden" else "tanken"}")
                    }
                    Box(Modifier.padding(top = 2.dp).height(18.dp), contentAlignment = Alignment.CenterStart) {
                        Text(kennzahlen, style = grotesk(13f, farbe = weiss), maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                }
            }
        }
        FussleisteUnten()
    }
}

private fun kmText(km: Double): String = "${einsatzZahl(km, 1)} km"

private fun Modifier.clipKreis(): Modifier = this.then(Modifier.clip(CircleShape))
