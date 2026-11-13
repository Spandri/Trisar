package de.trisar.fahrer.fahrt

import androidx.activity.compose.BackHandler
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.animate
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectVerticalDragGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import de.trisar.fahrer.haupt.DienstAnfrage
import de.trisar.kern.EigeneOrte
import de.trisar.kern.FussleisteUnten
import de.trisar.kern.GeoPunkt
import de.trisar.kern.KartenInhalt
import de.trisar.kern.Routen
import de.trisar.kern.TrisarKarte
import de.trisar.kern.grotesk
import de.trisar.kern.hex
import de.trisar.kern.platz
import io.github.jan.supabase.auth.auth
import io.github.jan.supabase.postgrest.from
import kotlinx.coroutines.launch
import java.net.URLEncoder
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.util.Locale

private val DS_SCHNAPP = CubicBezierEasing(0.22f, 1f, 0.36f, 1f)

@kotlinx.serialization.Serializable
private data class DsLive(val lat: Double? = null, val lng: Double? = null, val source: String? = null, val captured_at: String? = null)

@kotlinx.serialization.Serializable
private data class DsNummer(val driver_number: Int? = null)

/**
 * Standort und Fahrernummer aus der Datenbank wie in FahrtDetails.laden: driver_live_locations des Fahrers,
 * OBD-Tracker (Teltonika) vor dem Handy, dazu profiles.driver_number fuer den Punkt auf der Karte.
 */
private suspend fun dsFahrerAusDB(): Pair<GeoPunkt?, String> {
    val id = runCatching { de.trisar.kern.Backend.client.auth.currentUserOrNull()?.id }.getOrNull() ?: return null to ""
    val live = runCatching {
        de.trisar.kern.Backend.client.from("driver_live_locations").select(io.github.jan.supabase.postgrest.query.Columns.raw("lat,lng,source,captured_at")) {
            filter { eq("driver_id", id) }; limit(5)
        }.decodeList<DsLive>()
    }.getOrDefault(emptyList())
    val nummer = runCatching {
        de.trisar.kern.Backend.client.from("profiles").select(io.github.jan.supabase.postgrest.query.Columns.raw("driver_number")) {
            filter { eq("id", id) }; limit(1)
        }.decodeList<DsNummer>().firstOrNull()?.driver_number?.toString()
    }.getOrNull() ?: ""
    val obdMuster = Regex("teltonika|fmb|obd|telematik|telematics|tracker", RegexOption.IGNORE_CASE)
    val p = live.firstOrNull { obdMuster.containsMatchIn(it.source ?: "") } ?: live.firstOrNull()
    val ort = if (p?.lat != null && p.lng != null) GeoPunkt(p.lat, p.lng) else null
    return ort to nummer
}

/**
 * Dienststart mit Treffpunkt, angetippt in der Fahrtenliste (13.11., DienstStartDetail.jsx). Aufbau wie
 * eine Fahrt (FahrtSeite): oben die Karte mit der Route vom Standort zum Treffpunkt (Flagge am Ziel),
 * darunter das ziehbare Blatt mit Dienststart, Ort (antippen = Navigation) und der Notiz der Dispo.
 */
@Composable
fun DienstStartSeite(anfrage: DienstAnfrage, zurueck: () -> Unit) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    val standort by rememberFahrtStandort()
    val tp = anfrage.treffpunkt

    var blattProzent by remember { mutableFloatStateOf(50f) }
    var ziehBeginn by remember { mutableStateOf<Float?>(null) }
    var karte by remember { mutableStateOf(KartenInhalt()) }
    // Rueckfall ohne frisches Handy-GPS: letzter Standort aus der Datenbank (auch OBD), dazu die Fahrernummer.
    var standortDB by remember { mutableStateOf<GeoPunkt?>(null) }
    var fahrerNummer by remember { mutableStateOf("") }
    LaunchedEffect(anfrage.id) {
        while (true) {
            val (ort, nummer) = dsFahrerAusDB()
            if (ort != null) standortDB = ort
            if (nummer.isNotEmpty()) fahrerNummer = nummer
            kotlinx.coroutines.delay(30_000)
        }
    }

    BackHandler { zurueck() }

    val fahrerOrt: GeoPunkt? = standort?.takeIf { kotlin.math.abs(System.currentTimeMillis() - it.zeit) < 120_000 }?.ort ?: standortDB
    // Neu rechnen, wenn sich Treffpunkt oder (grob) der Standort aendert.
    val routenSchluessel = "${tp?.ortID}|${tp?.adresse}|${tp?.punkt}|${EigeneOrte.liste.size}|$fahrerNummer|" +
        (fahrerOrt?.let { "${(it.lat * 200).toInt()},${(it.lng * 200).toInt()}" } ?: "-")
    LaunchedEffect(routenSchluessel) {
        if (tp == null) return@LaunchedEffect
        // Eigener Ort: sein Pin, dann die gespeicherten Koordinaten, sonst die Adresse suchen.
        val ziel = EigeneOrte.zuID(tp.ortID)?.punkt ?: tp.punkt ?: Routen.punkt(ctx, tp.adresse.ifEmpty { tp.name })
        val fahrer = fahrerOrt
        var neu = KartenInhalt(ziel = ziel, fahrer = fahrer, fahrerNummer = fahrerNummer)
        if (fahrer != null && ziel != null) {
            val s = Routen.strecke(ctx, fahrer, ziel)
            if (s.punkte.size >= 2) neu = neu.copy(fahrt = s.punkte, fahrtMinuten = s.minuten)
        }
        karte = neu
    }
    LaunchedEffect(standort, standortDB) {
        val f = fahrerOrt ?: return@LaunchedEffect
        karte = karte.copy(fahrer = f)
    }

    BoxWithConstraints(Modifier.fillMaxSize().background(hex(0x0A0A0A))) {
        val hoehe = maxHeight.value
        val hoehePx = constraints.maxHeight.toFloat()
        val blattHoehe = hoehe * blattProzent / 100f

        if (tp != null) TrisarKarte(karte, blattHoehe, Modifier.fillMaxSize())
        else Box(Modifier.fillMaxSize().background(hex(0x101112)))

        Column(
            Modifier.align(Alignment.BottomCenter).fillMaxWidth().height(blattHoehe.dp)
                .shadow(20.dp, RoundedCornerShape(topStart = 20.dp, topEnd = 20.dp), ambientColor = Color.Black, spotColor = Color.Black)
                .clip(RoundedCornerShape(topStart = 20.dp, topEnd = 20.dp))
                .background(hex(0x1A1A1A)),
        ) {
            // Griff: 87 x 6 Lime, 18 Luft oben und unten (wie bei der Fahrt).
            Box(
                Modifier.fillMaxWidth().height(42.dp).pointerInput(hoehePx) {
                    var weg = 0f
                    detectVerticalDragGestures(
                        onDragStart = { ziehBeginn = blattProzent; weg = 0f },
                        onDragEnd = {
                            ziehBeginn = null
                            val ziel = if (blattProzent > 70) 85f else if (blattProzent < 40) 25f else 50f
                            scope.launch { animate(blattProzent, ziel, animationSpec = tween(320, easing = DS_SCHNAPP)) { v, _ -> blattProzent = v } }
                        },
                        onDragCancel = { ziehBeginn = null },
                    ) { aenderung, betrag ->
                        aenderung.consume()
                        weg += betrag
                        val neu = (ziehBeginn ?: 50f) - weg / hoehePx * 100f
                        blattProzent = neu.coerceIn(25f, 85f)
                    }
                },
                contentAlignment = Alignment.Center,
            ) { Box(Modifier.size(87.dp, 6.dp).background(hex(0xE2F754))) }

            Box(Modifier.weight(1f).fillMaxWidth().verticalScroll(rememberScrollState())) {
                DienstStartBlatt(anfrage)
            }
        }

        FussleisteUnten()

        KarteZurueck(Modifier.platz(20f, 60f)) { zurueck() }
    }
}

/** "Freitag, 13.11." wie toLocaleDateString(weekday long, day, month) im Web. */
private fun dienstTagText(iso: String): String {
    val d = runCatching { LocalDate.parse(iso.take(10)) }.getOrNull() ?: return ""
    return d.format(DateTimeFormatter.ofPattern("EEEE, dd.MM.", Locale.GERMAN)).replaceFirstChar { it.uppercase() }
}

/** Google Maps zum Treffpunkt (eigener Ort: nur die Adresse, wie bei Start und Ziel einer Fahrt). */
private fun treffpunktNavigation(name: String, adresse: String, eigenerOrt: Boolean): String? {
    val ziel = FahrtAdresse.fuerNavigation(name, adresse, eigenerOrt)
    if (ziel.isEmpty()) return null
    return "https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=" + URLEncoder.encode(ziel, "UTF-8").replace("+", "%20")
}

/** Inhalt des Blatts: Dienststart wie ETD, Treffpunkt wie ein Ort der Fahrt, Notiz wie bei der Fahrt. */
@Composable
private fun DienstStartBlatt(anfrage: DienstAnfrage) {
    val tp = anfrage.treffpunkt
    val lime = hex(0xE2F754)
    val grau = hex(0x868786)
    val unten = WindowInsets.navigationBars.asPaddingValues().calculateBottomPadding()
    val zeit = anfrage.service_start_time.orEmpty().take(5).ifEmpty { "--:--" }

    Column(Modifier.fillMaxWidth().padding(start = 20.dp, end = 20.dp, bottom = 24.dp + unten)) {
        // Wie ETD einer Fahrt: Beschriftung klein grau, Zeit gross in Lime, Datum rechts.
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.Top) {
            Column {
                Text("Dienststart", style = grotesk(12f, 700, abstand = -0.3f, farbe = hex(0x868687)))
                Text(zeit, style = grotesk(32f, 700, zeilenHoehe = 32f * 0.88f, abstand = -1f, farbe = lime), modifier = Modifier.padding(top = 6.dp))
            }
            Spacer(Modifier.weight(1f))
            Text(dienstTagText(anfrage.service_date.orEmpty()), style = grotesk(12f, 700, abstand = -0.3f, farbe = hex(0x868687)), textAlign = TextAlign.End)
        }

        if (tp != null && tp.name.isNotEmpty()) {
            // Treffpunkt: Kachel 64 (Radius 16), daneben grau "Treffpunkt", Name als Link (Lime unterstrichen), Adresse grau.
            Row(Modifier.fillMaxWidth().padding(top = 44.dp), verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                OrtKachel(tp.iconGrau, Modifier)
                Column(Modifier.weight(1f)) {
                    OrtText("Treffpunkt", tp.name, treffpunktNavigation(tp.name, tp.adresse, tp.ortID != null), false, Modifier)
                    if (tp.adresse.isNotEmpty() && tp.adresse != tp.name) {
                        Text(tp.adresse, style = grotesk(14f, 700, zeilenHoehe = 14f * 1.2f, abstand = -0.5f, farbe = grau), modifier = Modifier.padding(top = 4.dp))
                    }
                }
            }
        }

        if (tp != null && tp.notiz.isNotEmpty()) {
            // Notiz wie bei einer Fahrt: Titel gross in Lime, Zeit und Datum grau, "Dispo" rechts, Text weiss.
            val geaendert = FahrtZeit.ausISO(tp.aktualisiert)
            Box(Modifier.padding(top = 40.dp).height(52.dp)) {
                Text("Notiz", style = grotesk(58f, 700, zeilenHoehe = 52f, abstand = -1f, farbe = lime), softWrap = false)
            }
            Column(Modifier.padding(top = 12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                val stil = grotesk(16f, 700, abstand = -0.5f, farbe = grau)
                Row(Modifier.fillMaxWidth().height(16.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text(geaendert?.let { FahrtZeit.uhrzeit(it) } ?: "", style = stil)
                    if (geaendert != null) Text(FahrtZeit.datumKurz(geaendert), style = stil, modifier = Modifier.padding(start = 44.dp))
                    Spacer(Modifier.weight(1f).width(8.dp))
                    Text("Dispo", style = stil, textAlign = TextAlign.End, maxLines = 1)
                }
                Text(tp.notiz, style = grotesk(18f, 700, zeilenHoehe = 22f, abstand = -0.5f, farbe = hex(0xF4F5F4)))
            }
        }

        // Luft ueber der Fussleiste (40) wie bei der Fahrt.
        Spacer(Modifier.height(100.dp))
    }
}
