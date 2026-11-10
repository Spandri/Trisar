package de.trisar.fahrer.fahrt

import androidx.activity.compose.BackHandler
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.animate
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
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
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import de.trisar.kern.Backend
import de.trisar.kern.EigeneOrte
import de.trisar.kern.Farbe
import de.trisar.kern.FussleisteUnten
import de.trisar.kern.GeoPunkt
import de.trisar.kern.Icon
import de.trisar.kern.KartenInhalt
import de.trisar.kern.KartenKollege
import de.trisar.kern.Routen
import de.trisar.kern.SupportSignal
import de.trisar.kern.TrisarKarte
import de.trisar.kern.grotesk
import de.trisar.kern.hex
import de.trisar.kern.kartenDauer
import de.trisar.kern.platz
import de.trisar.kern.tippen
import io.github.jan.supabase.postgrest.query.filter.FilterOperator
import io.github.jan.supabase.realtime.PostgresAction
import io.github.jan.supabase.realtime.channel
import io.github.jan.supabase.realtime.postgresChangeFlow
import io.github.jan.supabase.realtime.realtime
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.launchIn
import kotlinx.coroutines.flow.onEach
import kotlinx.coroutines.launch
import java.net.URLEncoder
import java.time.Instant
import java.time.LocalDateTime
import java.time.LocalTime
import java.time.ZoneId

private enum class FahrtBlatt { BEENDEN, STORNIEREN, NOTIZ, SCHILD }

private val ENDE = setOf("done", "completed", "arrived", "beendet", "cancelled", "canceled", "refused", "storniert")
private val UNTERWEGS = setOf("at_pickup", "beim_pickup", "beim pickup", "in_progress", "started", "unterwegs", "active", "ongoing", "on_trip", "done", "completed", "arrived")
private val LAEUFT = setOf("in_progress", "unterwegs", "started", "on_trip", "ongoing", "active")
private val SCHNAPP = CubicBezierEasing(0.22f, 1f, 0.36f, 1f)

/** `position: absolute` im Blatt, aber mit Platzbedarf (wie platz() in iOS ueber Abstand statt offset). */
private fun Modifier.bei(x: Float, y: Float): Modifier = this.padding(start = x.dp, top = maxOf(0f, y).dp)

/**
 * Einzelne Fahrt (Solo, Flughafen, Kolonne) mit Karte, Chat und Support, wie SoloNormalAnsicht.swift
 * (SoloNormal.jsx / SoloFlughafen.jsx): Karte bildschirmhoch, darueber das ziehbare Infoblatt
 * (25 / 50 / 85 % der Hoehe) mit ETD/ETA, Orten, Gaesten, Notizen und vier Knoepfen.
 * SCHNITTSTELLE: Signatur nicht aendern. Aufrufer ist die Fahrtenliste (Agent "fahrer-a"),
 * Umsetzung baut der Agent "fahrer-b". Laedt ihre Daten selbst ueber fahrtID.
 */
@Composable
fun FahrtSeite(fahrtID: String, fahrerID: String, zurueck: () -> Unit) {
    val ctx = LocalContext.current
    val details = remember(fahrtID) { FahrtDetails(fahrtID, fahrerID, ctx) }
    val scope = rememberCoroutineScope()
    val standort by rememberFahrtStandort()

    var blattProzent by remember { mutableFloatStateOf(50f) }
    var ziehBeginn by remember { mutableStateOf<Float?>(null) }
    var karte by remember { mutableStateOf(KartenInhalt()) }
    var anfahrtVoll by remember { mutableStateOf<List<GeoPunkt>>(emptyList()) }
    var letzteNeuberechnung by remember { mutableLongStateOf(0L) }
    var neuRechnen by remember { mutableIntStateOf(0) }
    var fahrtMinutenLive by remember { mutableStateOf<Int?>(null) }
    var offenesBlatt by remember { mutableStateOf<FahrtBlatt?>(null) }
    var beschaeftigt by remember { mutableStateOf(false) }
    var jetzt by remember { mutableStateOf(Instant.now()) }
    var gewaehlterKollege by remember { mutableStateOf<FahrtDetails.KolonnenFahrer?>(null) }
    var chatOffen by remember { mutableStateOf(false) }
    var supportOffen by remember { mutableStateOf(false) }

    val fahrt = details.fahrt
    /** Kolonnen-Ansicht nur mit Kollegen in der Kolonne (hasKolonneColleagues). */
    val istKolonne = (fahrt?.istKolonne ?: false) && details.hatKollegen
    /** Wie hasFlightNumber im Web: Flug- oder Zugnummer vorhanden -> Flughafen-Ansicht. */
    val istFlug = (fahrt?.flug ?: "").trim().uppercase().let { it.isNotEmpty() && it != "STADTFAHRT" }
    val unterwegs = UNTERWEGS.contains((fahrt?.status ?: "").lowercase())
    val fahrerOrt: GeoPunkt? = standort?.takeIf { kotlin.math.abs(System.currentTimeMillis() - it.zeit) < 120_000 }?.ort ?: details.standortDB

    // MARK: Laden, Realtime, Takt

    LaunchedEffect(details) {
        details.fahrtLaden()
        details.laden()
    }
    DisposableEffect(details) {
        // Aenderungen an der Fahrt (Status, Zuordnung) und neue Chat-Nachrichten live.
        val kanal = Backend.client.channel("fahrt-seite-$fahrtID")
        val fahrten = kanal.postgresChangeFlow<PostgresAction>(schema = "public") { table = "jobs"; filter("id", FilterOperator.EQ, fahrtID) }
        val zuordnung = kanal.postgresChangeFlow<PostgresAction>(schema = "public") { table = "convoy_assignments"; filter("job_id", FilterOperator.EQ, fahrtID) }
        val nachrichten = kanal.postgresChangeFlow<PostgresAction>(schema = "public") { table = "messages" }
        var nachladen: Job? = null
        fun spaeterLaden() {
            nachladen?.cancel()
            nachladen = scope.launch { delay(400); details.fahrtLaden() }
        }
        val jobs = listOf(
            fahrten.onEach { spaeterLaden() }.launchIn(scope),
            zuordnung.onEach { spaeterLaden() }.launchIn(scope),
            nachrichten.onEach { if (!chatOffen) details.ungelesenAktualisieren() }.launchIn(scope),
        )
        scope.launch { runCatching { kanal.subscribe() } }
        onDispose {
            jobs.forEach { it.cancel() }
            fahrtAufraeumen.launch { runCatching { Backend.client.realtime.removeChannel(kanal) } }
        }
    }
    LaunchedEffect(istFlug) {
        while (true) {
            delay(30_000)
            jetzt = Instant.now()
            // Flugposition kommt ueber external-sync in die Fahrt, darum regelmaessig nachladen.
            if (istFlug) details.laden()
        }
    }
    // Fahrt weg (beendet, storniert, abgelehnt): zurueck zur Liste.
    LaunchedEffect(details.fahrtGeladen, fahrt == null) {
        if (details.fahrtGeladen && fahrt == null) zurueck()
    }
    // Support-Knopf der Fussleiste oeffnet hier den Support (wie .supportOeffnen in iOS).
    DisposableEffect(Unit) {
        val vorher = SupportSignal.empfaenger
        SupportSignal.empfaenger = { if (offenesBlatt == null && !chatOffen) supportOffen = true }
        onDispose { SupportSignal.empfaenger = vorher }
    }
    BackHandler { zurueck() }

    // MARK: Karte und Routen

    fun kollegenAufKarte(): List<KartenKollege> {
        val f = fahrt ?: return emptyList()
        if (!istKolonne) return emptyList()
        if (ENDE.contains(f.status.lowercase())) return emptyList()
        val beginn = fahrtBeginn(f) ?: return emptyList()
        // Kollegen nur im Zeitfenster ab 30 min vor Fahrtbeginn und solange die Fahrt laeuft.
        if (jetzt.isBefore(beginn.minusSeconds(30 * 60))) return emptyList()
        return details.kolonnenFahrer.mapNotNull { k ->
            val ort = k.standort ?: return@mapNotNull null
            val kuerzel = k.name.split(" ").filter { it.isNotEmpty() }.take(2).joinToString("") { it.take(1) }.uppercase()
            KartenKollege(ort, k.nummer.ifEmpty { kuerzel }, k.nummer.isNotEmpty())
        }
    }

    /** Neu rechnen, wenn sich Fahrt, Status oder (grob) der Standort aendert. */
    val routenSchluessel = "${fahrt?.abholAdresse}|${fahrt?.zielAdresse}|$unterwegs|${details.fahrerNummer}|" +
        (fahrerOrt?.let { "${(it.lat * 200).toInt()},${(it.lng * 200).toInt()}" } ?: "-") + "|$neuRechnen" +
        "|${details.tomtomFahrt.size}|${details.tomtomAnfahrt.size}|${EigeneOrte.liste.size}" +
        "|${details.payloadAbhol}|${details.payloadZiel}"
    LaunchedEffect(routenSchluessel) {
        val f = fahrt ?: return@LaunchedEffect
        val abholText = f.abholAdresse.ifEmpty { f.abholName }
        val zielText = f.zielAdresse.ifEmpty { f.zielName }
        // Eigener Ort: sein Pin (Einfahrt), dann der TomTom-Payload der Fahrt, sonst die Adresse suchen.
        val abholOrt = EigeneOrte.zuID(f.abholOrtID)?.punkt ?: details.payloadAbhol
        val zielOrt = EigeneOrte.zuID(f.zielOrtID)?.punkt ?: details.payloadZiel
        val abholA = async { abholOrt ?: Routen.punkt(ctx, abholText) }
        val zielA = async { zielOrt ?: Routen.punkt(ctx, zielText) }
        val abhol = abholA.await()
        val ziel = zielA.await()
        val fahrer = fahrerOrt
        var neu = KartenInhalt(ziel = ziel, fahrer = fahrer, fahrerNummer = details.fahrerNummer)
        // Blaue Fahrt: bei Gast an Bord ab Fahrer, sonst ab Abholort.
        val fahrtStart = (if (unterwegs) fahrer else null) ?: abhol
        if (fahrtStart != null && ziel != null) {
            val s = Routen.strecke(ctx, fahrtStart, ziel)
            // OSRM ausgefallen: gespeicherte TomTom-Linie zeigen (Fahrzeit dann aus details.fahrzeitMin).
            neu = neu.copy(fahrt = if (s.punkte.size >= 2) s.punkte else details.tomtomFahrt, fahrtMinuten = s.minuten)
            fahrtMinutenLive = s.minuten
        }
        if (!unterwegs) neu = neu.copy(abholort = abhol)
        // Gelbe Anfahrt vom Fahrer zum Abholort, solange der Gast noch nicht eingestiegen ist.
        if (!unterwegs && fahrer != null && abhol != null) {
            val s = Routen.strecke(ctx, fahrer, abhol)
            val anfahrt = if (s.punkte.size >= 2) s.punkte else details.tomtomAnfahrt
            anfahrtVoll = anfahrt
            neu = neu.copy(anfahrt = anfahrt, anfahrtMinuten = s.minuten)
        } else {
            anfahrtVoll = emptyList()
        }
        letzteNeuberechnung = System.currentTimeMillis()
        karte = neu.copy(
            flugzeug = if (istFlug) details.flugPosition else null,
            flugKurs = details.flugKurs,
            flugSpur = if (istFlug) details.flugSpur else emptyList(),
            kollegen = kollegenAufKarte(),
        )
    }
    // Gefahrenen Teil der Anfahrt abschneiden; mehr als 200 m daneben -> neu rechnen (hoechstens alle 15 s).
    LaunchedEffect(standort) {
        val f = fahrerOrt ?: return@LaunchedEffect
        karte = karte.copy(fahrer = f)
        if (anfahrtVoll.isEmpty()) return@LaunchedEffect
        val (abseits, pfad) = Routen.abFahrer(anfahrtVoll, f)
        if (abseits) {
            if (System.currentTimeMillis() - letzteNeuberechnung > 15_000) neuRechnen++
        } else if (pfad != null && pfad.size >= 2) {
            karte = karte.copy(anfahrt = pfad)
        }
    }
    LaunchedEffect(details.flugPosition, details.flugSpur, details.flugKurs) {
        if (istFlug) karte = karte.copy(flugzeug = details.flugPosition, flugKurs = details.flugKurs, flugSpur = details.flugSpur)
    }
    LaunchedEffect(details.kolonnenFahrer, istKolonne, jetzt) {
        karte = karte.copy(kollegen = kollegenAufKarte())
    }

    // MARK: Zeiten (etaBerechnung.js)

    val fahrzeitMin = fahrtMinutenLive?.takeIf { it > 0 } ?: details.fahrzeitMin

    fun eta(f: FahrtKopf): String {
        val ankunft = details.liveAnkunft(jetzt)
        if (LAEUFT.contains(f.status.lowercase()) && ankunft != null) return FahrtZeit.uhrzeit(ankunft)
        val geplant = fahrtBeginn(f) ?: return "--:--"
        val heute = jetzt.atZone(ZoneId.systemDefault()).toLocalDate()
        val start = if (geplant.isBefore(jetzt) && geplant.atZone(ZoneId.systemDefault()).toLocalDate() == heute) jetzt else geplant
        return FahrtZeit.uhrzeit(start.plusSeconds(fahrzeitMin * 60L))
    }

    /** SoloFlughafen: ETA = ETD + Fahrzeit (addMinutesToTime). */
    fun etaFlug(f: FahrtKopf): String {
        val t = f.etd.split(":").mapNotNull { it.toIntOrNull() }
        if (t.size != 2) return "--:--"
        val summe = t[0] * 60 + t[1] + fahrzeitMin
        return "%02d:%02d".format((summe / 60) % 24, summe % 60)
    }

    val fahrDauerText = if (fahrzeitMin > 0) "-${kartenDauer(fahrzeitMin)} Fahrt" else "- min Fahrt"

    // MARK: Aufbau

    BoxWithConstraints(Modifier.fillMaxSize().background(hex(0x0A0A0A))) {
        val hoehe = maxHeight.value
        val hoehePx = constraints.maxHeight.toFloat()
        val blattHoehe = hoehe * blattProzent / 100f

        TrisarKarte(karte, blattHoehe, Modifier.fillMaxSize())

        if (fahrt != null) {
            Column(
                Modifier.align(Alignment.BottomCenter).fillMaxWidth().height(blattHoehe.dp)
                    .shadow(20.dp, RoundedCornerShape(topStart = 20.dp, topEnd = 20.dp), ambientColor = Color.Black, spotColor = Color.Black)
                    .clip(RoundedCornerShape(topStart = 20.dp, topEnd = 20.dp))
                    .background(hex(0x1A1A1A)),
            ) {
                // Griff: 87 x 6 Lime, 18 Luft oben und unten.
                Box(
                    Modifier.fillMaxWidth().height(42.dp).pointerInput(hoehePx) {
                        var weg = 0f
                        detectVerticalDragGestures(
                            onDragStart = { ziehBeginn = blattProzent; weg = 0f },
                            onDragEnd = {
                                ziehBeginn = null
                                val ziel = if (blattProzent > 70) 85f else if (blattProzent < 40) 25f else 50f
                                scope.launch { animate(blattProzent, ziel, animationSpec = tween(320, easing = SCHNAPP)) { v, _ -> blattProzent = v } }
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
                    BlattInhalt(
                        fahrt = fahrt, details = details, istKolonne = istKolonne, istFlug = istFlug,
                        etaText = if (istFlug) etaFlug(fahrt) else eta(fahrt), fahrDauerText = fahrDauerText,
                        offnen = { offenesBlatt = it }, chat = { chatOffen = true }, support = { supportOffen = true },
                        kollege = { gewaehlterKollege = it },
                    )
                }
            }
        }

        FussleisteUnten()

        KarteZurueck(Modifier.platz(20f, 60f)) { zurueck() }

        details.fehler?.let { fehler ->
            Box(Modifier.padding(top = 120.dp).fillMaxWidth().background(Farbe.fehler).tippen { details.fehler = null }.padding(12.dp),
                contentAlignment = Alignment.Center) {
                Text(fehler, style = grotesk(13f, 500, farbe = Color.Black), textAlign = TextAlign.Center)
            }
        }

        gewaehlterKollege?.let { k -> FahrtKollegenKarte(k) { gewaehlterKollege = null } }

        if (supportOffen) SupportSeite { supportOffen = false }

        if (chatOffen) {
            val k = fahrt?.kolonnenID
            if (k != null) {
                KolonnenChatSeite(k, fahrerID, kolonnenKurz(details.kolonnenName)) {
                    chatOffen = false
                    scope.launch { details.ungelesenAktualisieren() }
                }
            }
        }

        offenesBlatt?.let { blatt ->
            val autor = details.fahrerName
            when (blatt) {
                FahrtBlatt.BEENDEN -> FahrtNotizBlatt(
                    "Warum wollen sie diese Fahrt beenden?", hex(0xFF6F63), "Fahrt beenden", hex(0xFF6F63),
                    schliessen = { offenesBlatt = null }, beschaeftigt = beschaeftigt,
                    bestaetigen = { notiz ->
                        scope.launch {
                            beschaeftigt = true
                            val ok = details.beenden(notiz, autor)
                            beschaeftigt = false
                            if (ok) { offenesBlatt = null; zurueck() }
                        }
                    },
                )
                FahrtBlatt.STORNIEREN -> FahrtNotizBlatt(
                    "Warum wollen Sie diese Fahrt stornieren?", Farbe.lime, "Stornieren beenden", Farbe.lime,
                    schliessen = { offenesBlatt = null }, beschaeftigt = beschaeftigt,
                    bestaetigen = { notiz ->
                        scope.launch {
                            beschaeftigt = true
                            val ok = details.stornieren(notiz)
                            beschaeftigt = false
                            if (ok) { offenesBlatt = null; zurueck() }
                        }
                    },
                )
                FahrtBlatt.NOTIZ -> FahrtNotizBlatt(
                    "Wichtige Infos zu dieser Fahrt!", Farbe.lime, "Notiz abschicken", Farbe.lime,
                    schliessen = { offenesBlatt = null }, beschaeftigt = beschaeftigt,
                    bestaetigen = { notiz ->
                        scope.launch {
                            beschaeftigt = true
                            val ok = details.notizSenden(notiz, autor)
                            beschaeftigt = false
                            if (ok) offenesBlatt = null
                        }
                    },
                )
                FahrtBlatt.SCHILD -> FahrtAbholschild(details.gaeste) { offenesBlatt = null }
            }
        }
    }
}

/** Geplanter Beginn aus Fahrtdatum und ETD (lokale Zeit). */
private fun fahrtBeginn(f: FahrtKopf): Instant? {
    val t = f.etd.split(":").mapNotNull { it.toIntOrNull() }
    if (t.size != 2 || t[0] !in 0..23 || t[1] !in 0..59) return null
    return LocalDateTime.of(FahrtZeit.ausTagWert(f.fahrtDatum), LocalTime.of(t[0], t[1])).atZone(ZoneId.systemDefault()).toInstant()
}

/** "Kolonne Name" bzw. "Kolonne" (Name ohne vorangestelltes "Kolonne"). */
private fun kolonnenTitel(name: String): String {
    val n = name.replace(Regex("^\\s*kolonn?e?\\s*", RegexOption.IGNORE_CASE), "")
        .replace(Regex("^[:\\-–]\\s*"), "").trim()
    return if (n.isEmpty()) "Kolonne" else "Kolonne $n"
}

/** kolonnenNameKurz: Gattungswort (Kolonne, Konvoi, Convoy ...) vorne weg, sonst "Kolonne". */
private fun kolonnenKurz(name: String): String {
    val n = name.replace(Regex("^\\s*(kolonn?e?|konvoi|konvoy|convoy|convoi|convoglio)\\b\\s*[:\\-–]?\\s*", RegexOption.IGNORE_CASE), "").trim()
    return n.ifEmpty { "Kolonne" }
}

/** getPlanOrFlightPhaseLabel: Flugphase nur bei Flughafenfahrt mit Statuscode. */
private fun flugPhase(code: String, flughafen: Boolean): String? {
    if (!flughafen || code.isEmpty()) return null
    return mapOf("CD" to "cancelled", "DP" to "departed", "LD" to "landed", "RT" to "rerouted", "NA" to "no status")[code] ?: code
}

private val HOTEL = Regex("\\b(hotel|resort|hostel|inn|motel|guesthouse|suite|aparthotel|residence)\\b")

private fun ortArt(name: String, adresse: String): String {
    val t = "$name $adresse".lowercase()
    if (Regex("\\b(flughafen|airport|terminal|muc|fra|ber|ham|dus|str|cgn)\\b").containsMatchIn(t)) return "Flughafen"
    if (HOTEL.containsMatchIn(t)) return "Hotel"
    return "Adresse"
}

private fun ortIcon(text: String, start: Boolean): String {
    val t = text.lowercase()
    if (t.contains("muc") || t.contains("flughafen") || t.contains("airport") || t.contains("terminal")) {
        return if (start) "Plain_Landen_Trisar_Icons_01_grau" else "Plain_Abflug_Trisar_Icons_01_grau"
    }
    if (HOTEL.containsMatchIn(t)) return "House_Nav_Trisar_01_grau"
    return "Pin_Nav_Trisar_Icons_01_grau"
}

private fun merkmalIcon(m: String) = when (m) {
    "vip" -> "Stern_Trisar_Icon_01_Lime"
    "child" -> "Kind_Trisar_Icons_01_Lime"
    "luggage" -> "Gepäck_viel_Trisar_Icons_01_Lime"
    else -> "Rollstuhl_Trisar_Icons_01_Lime"
}

/** getRouteNavigationUrl: Abholort als Zwischenziel, Ziel als Endpunkt. */
private fun navigationsURL(f: FahrtKopf): String? {
    val abhol = FahrtAdresse.fuerNavigation(f.abholName, f.abholAdresse, f.abholOrtID != null)
    val ziel = FahrtAdresse.fuerNavigation(f.zielName, f.zielAdresse, f.zielOrtID != null)
    if (abhol.isEmpty() && ziel.isEmpty()) return null
    fun k(s: String) = URLEncoder.encode(s, "UTF-8").replace("+", "%20")
    val basis = "https://www.google.com/maps/dir/?api=1&travelmode=driving"
    return if (abhol.isNotEmpty() && ziel.isNotEmpty()) "$basis&waypoints=${k((listOf(abhol) + f.zwischenstopps.take(8)).joinToString("|"))}&destination=${k(ziel)}"
    else "$basis&destination=${k(ziel.ifEmpty { abhol })}"
}

/** Inhalt im Raster des Webs, dort um 111 (Kolonne: 24) nach oben geschoben (ETD steht bei 111). */
@Composable
private fun BlattInhalt(
    fahrt: FahrtKopf, details: FahrtDetails, istKolonne: Boolean, istFlug: Boolean,
    etaText: String, fahrDauerText: String,
    offnen: (FahrtBlatt) -> Unit, chat: () -> Unit, support: () -> Unit, kollege: (FahrtDetails.KolonnenFahrer) -> Unit,
) {
    fun y(webOben: Float) = webOben - if (istKolonne) 24f else 111f
    val breite = 402f
    val innen = breite - 40f
    val merkmale = details.merkmale
    // Gemeinsame Regel: Namen je Zeile, anonyme Gaeste als eigene Zeile, sonst "Keine Gäste".
    val gaeste = de.trisar.kern.GaesteAnzeige.zeilen(details.gaeste, details.anonym)
    // Flughafen: Gaeste immer bei 482 (Platz fuer Flugnummer), sonst je nach Merkmalen.
    val gaesteOben = y(if (istFlug || merkmale.isNotEmpty()) 563f - 81f else 289f + 64f + 42f)
    val ersteGastZeile = gaesteOben + 50f
    val gaesteUnten = ersteGastZeile + (gaeste.size - 1) * 57f + 51f
    val nav = navigationsURL(fahrt)
    val grauHell = hex(0xF4F5F4)
    val lime = hex(0xE2F754)
    val unten = WindowInsets.navigationBars.asPaddingValues().calculateBottomPadding()

    Box(Modifier.width(breite.dp).padding(bottom = 24.dp + unten)) {
        // ETD / ETA
        Text("ETD", style = grotesk(12f, 700, abstand = -0.3f, farbe = hex(0x868687)), modifier = Modifier.bei(20f, y(111f)))
        Box(Modifier.bei(0f, y(111f)).width((breite - 20f).dp), contentAlignment = Alignment.TopEnd) {
            Text("ETA", style = grotesk(12f, 700, abstand = -0.3f, farbe = hex(0x868687)))
        }
        Text(fahrt.etd, style = grotesk(32f, 700, zeilenHoehe = 32f * 0.88f, abstand = -1f, farbe = lime), modifier = Modifier.bei(20f, y(129f)))
        Box(Modifier.bei(20f, y(129f)).width(innen.dp), contentAlignment = Alignment.TopEnd) {
            Text(etaText, style = grotesk(32f, 700, zeilenHoehe = 32f * 0.88f, abstand = -1f, farbe = lime), textAlign = TextAlign.End)
        }
        Box(Modifier.bei(0f, y(156f)).width((breite - 20f).dp), contentAlignment = Alignment.TopEnd) {
            Text(fahrDauerText, style = grotesk(12f, 700, abstand = -0.5f, farbe = grauHell.copy(alpha = 0.5f)))
        }

        if (istFlug) {
            // Planzeit durchgestrichen, darunter die Flugphase (nur bei bekanntem Statuscode).
            Text("Plan: ${fahrt.planEtd?.ifEmpty { null } ?: "--:--"}",
                style = grotesk(12f, 700, abstand = -0.5f, farbe = grauHell.copy(alpha = 0.5f)).copy(textDecoration = TextDecoration.LineThrough),
                modifier = Modifier.bei(20f, y(156f)))
            flugPhase(details.flugStatusCode, fahrt.istFlughafen)?.let { phase ->
                Text(phase, style = grotesk(12f, 700, abstand = -0.5f, farbe = grauHell.copy(alpha = 0.7f)), modifier = Modifier.bei(20f, y(174f)))
            }
        }

        // Orte: Icons, Pfeil, Bezeichnung und Name (Name fuehrt zu Google Maps).
        OrtKachel(EigeneOrte.iconGrau(fahrt.abholOrtID) ?: ortIcon("${fahrt.abholName} ${fahrt.abholAdresse} ${fahrt.abholKurz}", true), Modifier.bei(20f, y(211f)))
        Icon("Arrow_Trisar_Icons_01_Lime", Modifier.bei((breite - 59f) / 2f, y(231f)).size(59.dp, 38.dp))
        OrtKachel(EigeneOrte.iconGrau(fahrt.zielOrtID) ?: ortIcon("${fahrt.zielName} ${fahrt.zielAdresse} ${fahrt.zielKurz}", false), Modifier.bei(breite - 20f - 64f, y(211f)))

        Row(Modifier.bei(20f, y(289f)).width(innen.dp), horizontalArrangement = Arrangement.spacedBy(18.dp)) {
            OrtText(ortArt(fahrt.abholName, fahrt.abholAdresse), fahrt.abholKurz, nav, false, Modifier.weight(1f))
            OrtText(ortArt(fahrt.zielName, fahrt.zielAdresse), fahrt.zielKurz, nav, true, Modifier.weight(1f))
        }

        if (fahrt.zwischenstopps.isNotEmpty()) {
            Text(
                "Über: " + fahrt.zwischenstopps.joinToString("  ·  "),
                style = grotesk(13f, 700, abstand = -0.3f, farbe = androidx.compose.ui.graphics.Color(0xFFE2F754)),
                maxLines = 2,
                overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis,
                modifier = Modifier.bei(20f, y(352f)).width(innen.dp),
            )
        }

        if (merkmale.isNotEmpty()) {
            Box(Modifier.bei(20f, y(386f)).then(if (istFlug) Modifier.width(innen.dp) else Modifier),
                contentAlignment = if (istFlug) Alignment.TopEnd else Alignment.TopStart) {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    merkmale.forEach { m -> Icon(merkmalIcon(m), Modifier.size(58.dp)) }
                }
            }
        }

        if (istFlug) {
            Text(fahrt.flug.trim(), style = grotesk(42f, 700, zeilenHoehe = 42f * 0.88f, abstand = -1f, farbe = grauHell), modifier = Modifier.bei(20f, y(386f)))
            if (details.flugHerkunft.isNotEmpty()) {
                Text("Aus: ${details.flugHerkunft}", style = grotesk(16f, 700, zeilenHoehe = 16f, abstand = -0.5f, farbe = grauHell.copy(alpha = 0.5f)),
                    modifier = Modifier.bei(20f, y(424f)))
            }
        }

        Text("Gäste", style = grotesk(32f, 700, zeilenHoehe = 32f, abstand = -1f, farbe = lime), modifier = Modifier.bei(20f, gaesteOben))
        gaeste.forEachIndexed { i, name ->
            Box(
                Modifier.bei(20f, ersteGastZeile + i * 57f).size(innen.dp, 51.dp).background(hex(0x242425))
                    .tippen { if (details.gaeste.isNotEmpty()) offnen(FahrtBlatt.SCHILD) }.padding(horizontal = 12.dp),
                contentAlignment = Alignment.CenterStart,
            ) { Text(name, style = grotesk(18f, 700, abstand = -0.5f, farbe = lime), maxLines = 1) }
        }

        if (istKolonne) {
            // Chat-Balken der Kolonne, im Web nicht mitverschoben (top 18).
            Row(
                Modifier.bei(20f, 18f).size(innen.dp, 45.dp).background(lime).tippen(chat).padding(horizontal = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(kolonnenTitel(details.kolonnenName), style = grotesk(18f, 700, abstand = -0.5f, farbe = hex(0x262626)))
                Spacer(Modifier.weight(1f))
                Icon("Chat_Konnvoi_Trisar_Icons_01", Modifier.size(24.dp))
            }
            // Ungelesene: roter Kreis 28 mittig auf der oberen rechten Ecke.
            val n = details.ungelesen
            if (n > 0) {
                Box(Modifier.bei(20f + innen - 14f, 18f - 14f).size(28.dp).background(hex(0xFF6E63), CircleShape), contentAlignment = Alignment.Center) {
                    Text(if (n > 9) "9+" else "$n", style = grotesk(14f, 700, farbe = Color.Black))
                }
            }

            // Fahrerzeilen (convoyDriverRows): eindeutig nach Name, sonst „Keine Fahrer“.
            val zeilen = details.kolonnenFahrer.distinctBy { it.name.lowercase() }.map { it.id to it.name }
                .ifEmpty { listOf(null to "Keine Fahrer") }
            val fahrerOben = gaesteUnten + 30f
            Text("Fahrer", style = grotesk(32f, 700, zeilenHoehe = 32f, abstand = -1f, farbe = lime), modifier = Modifier.bei(20f, fahrerOben))
            zeilen.forEachIndexed { i, (id, name) ->
                Box(
                    Modifier.bei(20f, fahrerOben + 50f + i * 57f).size(innen.dp, 51.dp).alpha(if (id == null) 0.7f else 1f)
                        .background(lime)
                        .tippen { if (id != null) details.kolonnenFahrer.firstOrNull { it.id == id }?.let(kollege) }
                        .padding(horizontal = 12.dp),
                    contentAlignment = Alignment.CenterStart,
                ) { Text(name, style = grotesk(18f, 700, abstand = -0.5f, farbe = hex(0x242425)), maxLines = 1) }
            }
            Unterteil(details, innen, offnen, support, Modifier.bei(20f, fahrerOben + 50f + (zeilen.size - 1) * 57f + 51f + 60f))
        } else {
            Unterteil(details, innen, offnen, support, Modifier.bei(20f, gaesteUnten + 30f))
        }
    }
}

/** Notizen und Knoepfe. Im Web per gemessener Hoehe gestapelt, hier als Spalte. */
@Composable
private fun Unterteil(details: FahrtDetails, innen: Float, offnen: (FahrtBlatt) -> Unit, support: () -> Unit, modifier: Modifier) {
    val lime = hex(0xE2F754)
    Column(modifier.width(innen.dp)) {
        if (details.notizen.isNotEmpty()) {
            Box(Modifier.height(52.dp)) {
                Text("Notiz", style = grotesk(58f, 700, zeilenHoehe = 52f, abstand = -1f, farbe = lime), softWrap = false)
            }
            Spacer(Modifier.height(12.dp))
            Column(verticalArrangement = Arrangement.spacedBy(24.dp)) {
                details.notizen.forEach { notiz ->
                    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        val stil = grotesk(16f, 700, abstand = -0.5f, farbe = hex(0x868786))
                        Row(Modifier.fillMaxWidth().height(16.dp), verticalAlignment = Alignment.CenterVertically) {
                            Text(notiz.zeit, style = stil)
                            if (notiz.datum.isNotEmpty()) Text(notiz.datum, style = stil, modifier = Modifier.padding(start = 44.dp))
                            Spacer(Modifier.weight(1f).width(8.dp))
                            if (notiz.autor.isNotEmpty()) Text(notiz.autor, style = stil, textAlign = TextAlign.End, maxLines = 1)
                        }
                        Text(notiz.text, style = grotesk(18f, 700, zeilenHoehe = 18f, abstand = -0.5f, farbe = hex(0xF4F5F4)))
                    }
                }
            }
            Spacer(Modifier.height(54.dp))
        }
        Column(verticalArrangement = Arrangement.spacedBy(24.dp)) {
            AktionsKnopf("Fahrt beenden", hex(0xFF6F63)) { offnen(FahrtBlatt.BEENDEN) }
            AktionsKnopf("Stornieren", lime) { offnen(FahrtBlatt.STORNIEREN) }
            AktionsKnopf("Notiz zur Fahrt", lime) { offnen(FahrtBlatt.NOTIZ) }
            Box(Modifier.fillMaxWidth().height(56.dp).border(2.dp, lime).tippen(support), contentAlignment = Alignment.Center) {
                Text("Support", style = grotesk(16f, 500, abstand = 0.5f, farbe = lime.copy(alpha = 0.5f)))
            }
        }
        // Unter dem letzten Knopf: Fussleiste 40 + 30 Luft (minus pb-6, das unten dazukommt).
        Spacer(Modifier.height((40 + 30 - 24).dp))
    }
}
