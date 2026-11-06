package de.trisar.dispo.stamm

import androidx.compose.foundation.layout.height
import androidx.compose.ui.layout.onSizeChanged
import io.github.jan.supabase.postgrest.from
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import de.trisar.dispo.DispoZiel
import de.trisar.dispo.Navileiste
import de.trisar.kern.DispoHintergrund
import de.trisar.kern.FussleisteUnten
import de.trisar.kern.Icon
import de.trisar.kern.ZurueckKnopf
import de.trisar.kern.grotesk
import de.trisar.kern.hex
import de.trisar.kern.platz
import de.trisar.kern.tippen
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/** Fahrzeug, das nach einem Tipp auf eine Mitteilung direkt geoeffnet werden soll. */
internal object FahrzeugSprung { var id: String? = null }

private sealed interface FahrzeugSeite {
    data object Liste : FahrzeugSeite
    data object Filter : FahrzeugSeite
    data object Erstellen : FahrzeugSeite
    data class Bearbeiten(val fahrzeug: StammFahrzeug) : FahrzeugSeite
}

/**
 * Fahrzeug-Bereich der Dispo (FahrzeugBereichAnsicht.swift): Liste (FahrzeugeView.jsx), Filter
 * (FahrzeugFilterView.jsx), Anlegen/Bearbeiten (FahrzeugErstellenView.jsx).
 */
@Composable
internal fun FahrzeugBereichSeite(zeigen: (DispoZiel) -> Unit) {
    var seite by remember { mutableStateOf<FahrzeugSeite>(FahrzeugSeite.Liste) }
    androidx.compose.runtime.key(seite) {
        when (val s = seite) {
            FahrzeugSeite.Liste -> FahrzeugListeSeite(zeigen, filterOeffnen = { seite = FahrzeugSeite.Filter },
                erstellen = { seite = FahrzeugSeite.Erstellen }, bearbeiten = { seite = FahrzeugSeite.Bearbeiten(it) })
            FahrzeugSeite.Filter -> FahrzeugFilterSeite { seite = FahrzeugSeite.Liste }
            FahrzeugSeite.Erstellen -> FahrzeugFormularSeite(null) { seite = FahrzeugSeite.Liste }
            is FahrzeugSeite.Bearbeiten -> FahrzeugFormularSeite(s.fahrzeug) { seite = FahrzeugSeite.Liste }
        }
    }
}

// MARK: - Liste

@Composable
private fun FahrzeugListeSeite(
    zeigen: (DispoZiel) -> Unit,
    filterOeffnen: () -> Unit,
    erstellen: () -> Unit,
    bearbeiten: (StammFahrzeug) -> Unit,
) {
    val filter = FahrzeugFilterAblage
    val dienst = remember { FahrzeugeDienst() }
    val scope = rememberCoroutineScope()
    DisposableEffect(Unit) {
        scope.launch {
            dienst.laden()
            dienst.beobachten(scope)
        }
        onDispose { dienst.beenden() }
    }
    val liste = filter.anwenden(dienst.fahrzeuge)
    androidx.compose.runtime.LaunchedEffect(dienst.fahrzeuge) {
        val ziel = FahrzeugSprung.id ?: return@LaunchedEffect
        val f = dienst.fahrzeuge.firstOrNull { it.id == ziel } ?: return@LaunchedEffect
        FahrzeugSprung.id = null
        bearbeiten(f)
    }

    /** Hoehe der Liste im Raster, damit die Leinwand weit genug scrollt. */
    val bloecke = buildList {
        if (dienst.laedt) add(21f)
        if (!dienst.laedt && dienst.fehler.isNotEmpty()) add(90f)
        if (!dienst.laedt && dienst.fehler.isEmpty() && liste.isEmpty()) add(21f)
        repeat(liste.size) { add(128f) }
    }
    val listenHoehe = bloecke.sum() + max(0, bloecke.size - 1) * 12f

    Box(Modifier.fillMaxSize().background(Color.Black)) {
        Leinwand(874f, 354f + listenHoehe + 157f) { rahmen ->
            DispoHintergrund(Modifier.platz(0f, 0f, 402f, rahmen))
            ZurueckKnopf(Modifier.platz(20f, 60f)) { zeigen(DispoZiel.START) }
            Box(Modifier.platz(332f, 60f, 50f, 50f).tippen(filterOeffnen)) {
                Icon("karten-layer-button", Modifier.fillMaxSize(), skalierung = ContentScale.FillBounds)
            }
            StammTitel("Fahrzeuge", Modifier.platz(20f, 140f))
            StammZeilenKnopf("Fahrzeug erstellen", "vehicle-car-small", Modifier.platz(20f, 206f, 362f, 56f), aktion = erstellen)

            Row(Modifier.platz(20f, 274f, 362f, 56f).border(2.dp, LIME).padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically) {
                Eingabe(filter.suche, { filter.suche = it }, "Fahrzeug Suchen", grotesk(16f, 500, farbe = LIME), LIME,
                    Modifier.weight(1f), gross = KeyboardCapitalization.None)
                if (filter.suche.isNotBlank()) {
                    Box(Modifier.size(24.dp).tippen { filter.suche = "" }, contentAlignment = Alignment.Center) { Icon("clear-field-green", Modifier.size(20.dp)) }
                } else {
                    Icon("vehicle-search", Modifier.size(24.dp))
                }
            }

            Column(Modifier.platz(20f, 354f, 362f), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                if (dienst.laedt) Text("Fahrzeuge werden geladen ...", style = grotesk(16f, 500, farbe = LIME))
                if (!dienst.laedt && dienst.fehler.isNotEmpty()) {
                    FehlerKasten("Fahrzeuge konnten nicht geladen werden: ${dienst.fehler}", Modifier.fillMaxWidth())
                }
                if (!dienst.laedt && dienst.fehler.isEmpty() && liste.isEmpty()) {
                    Text("Keine Fahrzeuge gefunden.", style = grotesk(16f, 500, farbe = LIME))
                }
                for (f in liste) {
                    androidx.compose.runtime.key(f.id) {
                        FahrzeugListenKarte(f, Modifier.tippen { bearbeiten(f) })
                    }
                }
            }
        }
        Navileiste(DispoZiel.FAHRZEUGE, zeigen)
    }
}

/** VehicleCard aus FahrzeugeView.jsx: weiss 362 x 128, Bild links, Kennzeichen und Kacheln (36) rechts. */
@Composable
private fun FahrzeugListenKarte(fahrzeug: StammFahrzeug, modifier: Modifier) {
    Box(modifier.size(362.dp, 128.dp).background(Color.White).clipToBounds()) {
        Box(Modifier.platz(6f, 38f, 150f, 74f).background(hex(0xECECEC)))
        if (fahrzeug.imageUrl.isNotEmpty()) StammBild(fahrzeug.imageUrl, Modifier.platz(6f, 38f, 150f, 74f))
        Box(Modifier.platz(0f, 10f, 362f), contentAlignment = Alignment.TopCenter) {
            Text(buildAnnotatedString {
                withStyle(SpanStyle(fontWeight = FontWeight(700))) { append("VIN  ") }
                withStyle(SpanStyle(letterSpacing = 2.sp)) { append(fahrzeug.vinLabel) }
            }, style = grotesk(12f, farbe = hex(0x1D1C1D, 0.2f)), maxLines = 1)
        }
        TextZeile(fahrzeug.plate, grotesk(30f, 700, 32f, -0.5f, hex(0x1D1C1D)), Modifier.platz(170f, 38f), hoehe = 32f)
        Row(Modifier.platz(170f, 76f), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            // Die Kacheln sind fuer 52 gebaut, die Admin-Liste zeigt sie in 36.
            DispoKraftstoffKachel(fahrzeug.fuelType, 36f)
            DispoFarbKachel(fahrzeug.color, 36f)
            DispoEnergieKachel(fahrzeug.fuelType, fahrzeug.fill, fahrzeug.range, 36f)
            DispoSitzKachel(fahrzeug.seatCount, 36f)
        }
    }
}

// MARK: - Kacheln (vehicleBadges.jsx, Basis 36), wie in FahrzeugKarte.swift

/** Rahmen card-outline-52, Inhalt im 36er-Raster gebaut und auf `groesse` skaliert. */
@Composable
private fun DispoKachelRahmen(groesse: Float, inhalt: @Composable () -> Unit) {
    Box(Modifier.size(groesse.dp), contentAlignment = Alignment.Center) {
        Icon("card-outline-52", Modifier.fillMaxSize(), skalierung = ContentScale.FillBounds)
        Box(Modifier.size(36.dp).scale(groesse / 36f), contentAlignment = Alignment.Center) { inhalt() }
    }
}

@Composable
internal fun DispoKraftstoffKachel(kraftstoff: String?, groesse: Float = 52f) {
    DispoKachelRahmen(groesse) {
        val a = kraftstoffAufloesen(kraftstoff)
        if (a.first) {
            Icon(a.second, Modifier.size(23.dp))
        } else {
            Box(Modifier.size(23.dp, 20.dp).padding(1.05.dp).border(2.1.dp, hex(0x12120D), RoundedCornerShape(3.7.dp)), contentAlignment = Alignment.Center) {
                Text(a.second, style = grotesk(9f, 700, farbe = Color.Black), maxLines = 1)
            }
        }
    }
}

/** resolveFuelBadge der Web-App: (true, Icon) oder (false, Text). */
private fun kraftstoffAufloesen(wert: String?): Pair<Boolean, String> {
    val f = (wert ?: "").trim().lowercase()
    if (f.isEmpty() || f == "e10") return true to "E10_Tank_Trisar_Icons_01"
    if (f.contains("elektr") || f == "ev" || f == "bev" || f.contains("hybrid")) return true to "Blitz_Trisar_Icons_01"
    if (f.contains("b10")) return false to "B10"
    if (f.contains("diesel") || f.contains("b7")) return false to "B7"
    if (f.contains("plus") || f.contains("98")) return true to "E98_Tank_Trisar_Icons_01"
    if (f.contains("95") || f.contains("super") || f.contains("e5")) return true to "E95_Tank_Trisar_Icons_01"
    return false to (wert ?: "").trim().take(3)
}

@Composable
internal fun DispoFarbKachel(farbe: String?, groesse: Float = 52f) {
    DispoKachelRahmen(groesse) { Box(Modifier.size(23.dp).background(hex(autoFarbe(farbe)), CircleShape)) }
}

/** resolveCarColor der Web-App. */
private fun autoFarbe(wert: String?): Long {
    val roh = wert?.trim().orEmpty()
    if (roh.isEmpty()) return 0x0D0D0D
    val v = roh.lowercase()
    val tabelle = mapOf(
        "black" to 0x0D0D0DL, "schwarz" to 0x0D0D0DL, "white" to 0xF3F4F6L, "weiss" to 0xF3F4F6L,
        "silber" to 0xC4C6C8L, "silver" to 0xC4C6C8L, "grau" to 0x8B8E93L, "gray" to 0x8B8E93L, "grey" to 0x8B8E93L,
        "blau" to 0x1D4ED8L, "blue" to 0x1D4ED8L, "rot" to 0xB91C1CL, "red" to 0xB91C1CL, "gruen" to 0x15803DL, "green" to 0x15803DL,
    )
    tabelle[v]?.let { return it }
    if (roh.startsWith("#") && roh.length == 7) roh.drop(1).toLongOrNull(16)?.let { return it }
    return when {
        v.contains("weiß") || v.contains("weiss") -> 0xF3F4F6
        v.contains("blau") || v.contains("blue") -> 0x1D4ED8
        v.contains("rot") || v.contains("red") -> 0xB91C1C
        v.contains("grün") || v.contains("gruen") || v.contains("green") -> 0x15803D
        v.contains("bronze") -> 0x8A6D55
        v.contains("grau") || v.contains("grey") || v.contains("gray") -> 0x8B8E93
        v.contains("silber") || v.contains("silver") -> 0xC4C6C8
        else -> 0x0D0D0D
    }
}

@Composable
internal fun DispoSitzKachel(sitze: Int?, groesse: Float = 52f) {
    DispoKachelRahmen(groesse) {
        Icon(if (sitze == null) "Person_Trisar_Icons_01" else "${min(8, max(3, sitze))}x_Person_Trisar_Icons_01", Modifier.size(23.dp))
    }
}

/**
 * Energie-Kachel: Elektro = Batterie, Verbrenner = Zapfsaeule mit Fuellbalken.
 * Ohne Wert steht „–“ (kein erfundener Wert, wie im Live-Betrieb der Web-App).
 */
@Composable
internal fun DispoEnergieKachel(kraftstoff: String?, fuellstand: Double?, reichweite: Double?, groesse: Float = 52f) {
    val f = (kraftstoff ?: "").lowercase()
    val elektrisch = f.contains("elektr") || f == "ev" || f == "bev"
    val fill = fuellstand?.let { max(0.0, min(100.0, Math.rint(it))).toInt() }
    val maxReichweite = if ((reichweite ?: 0.0) > 0) reichweite!! else if (elektrisch) 500.0 else 650.0
    val km = fill?.let { (it / 100.0 * maxReichweite).roundToInt() }
    DispoKachelRahmen(groesse) {
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(3.dp)) {
            if (elektrisch) {
                val icon = when {
                    fill == null -> "40xBatterie_Trisar_Icon_01_green"
                    fill >= 60 -> "100xBatterie_Trisar_Icon_01_green"
                    fill >= 25 -> "40xBatterie_Trisar_Icon_01_green"
                    else -> "20xBatterie_Trisar_Icon_01_green"
                }
                Icon(icon, Modifier.size(13.dp).alpha(if (fill == null) 0.3f else 1f))
            } else {
                Box(Modifier.size(8.dp, 13.dp), contentAlignment = Alignment.BottomCenter) {
                    Box(Modifier.padding(bottom = (13 * 0.12).dp).size(4.dp, (13 * 0.76 * (fill ?: 0) / 100.0).dp).background(hex(0x1A171B)))
                    Icon("Zapfsaeule_Trisar_Icons_01", Modifier.size(8.dp, 13.dp), skalierung = ContentScale.FillBounds)
                }
            }
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Text(km?.let { "${it}km " } ?: "–", style = grotesk(5f, 700, 6f, farbe = Color.Black), maxLines = 1)
                Text(fill?.let { "$it%" } ?: "–", style = grotesk(5f, 700, 6f, farbe = hex(0x060606)), maxLines = 1)
            }
        }
    }
}

// MARK: - Filter

@Composable
private fun FahrzeugFilterSeite(zurueck: () -> Unit) {
    val f = FahrzeugFilterAblage
    val sortierungen = listOf("plate" to "Kennzeichen", "model" to "Modell", "fill" to "Füllstand", "seats" to "Sitzplätze")

    @Composable
    fun abschnitt(text: String, y: Float) =
        TextZeile(text, grotesk(13f, 500, abstand = 0.5f, farbe = LIME.copy(alpha = 0.6f)), Modifier.platz(20f, y, 362f, 16f), hoehe = 16f)

    /** TwoColButton: 175 x 40, Lime-Rahmen, aktiv gefuellt. */
    @Composable
    fun knopf(text: String, aktiv: Boolean, modifier: Modifier, aktion: () -> Unit) =
        Box(modifier.background(if (aktiv) LIME else Color.Transparent).border(2.dp, LIME).tippen(aktion), contentAlignment = Alignment.Center) {
            Text(text, style = grotesk(16f, 500, abstand = 0.4f, farbe = if (aktiv) hex(0x1D1C1D) else LIME))
        }

    Box(Modifier.fillMaxSize().background(Color.Black)) {
        Leinwand(874f, 834f + 70f) { rahmen ->
            DispoHintergrund(Modifier.platz(0f, 0f, 402f, max(rahmen, 904f)))
            ZurueckKnopf(Modifier.platz(20f, 60f), zurueck)
            StammTitel("Fahrzeug Filter", Modifier.platz(20f, 140f))

            abschnitt("Karosserie", 206f)
            knopf("Limosine", f.limosine, Modifier.platz(20f, 230f, 175f, 40f)) { f.limosine = !f.limosine }
            knopf("SUV", f.suv, Modifier.platz(207f, 230f, 175f, 40f)) { f.suv = !f.suv }
            knopf("VAN", f.van, Modifier.platz(20f, 282f, 175f, 40f)) { f.van = !f.van }
            knopf("Coupe", f.coupe, Modifier.platz(207f, 282f, 175f, 40f)) { f.coupe = !f.coupe }

            abschnitt("Sortieren nach", 346f)
            sortierungen.forEachIndexed { i, s ->
                knopf(s.second, f.sortierung == s.first, Modifier.platz(if (i % 2 == 0) 20f else 207f, 370f + (i / 2) * 52f, 175f, 40f)) {
                    f.sortierung = s.first
                }
            }
            knopf("A – Z", !f.absteigend, Modifier.platz(20f, 486f, 175f, 40f)) { f.absteigend = false }
            knopf("Z – A", f.absteigend, Modifier.platz(207f, 486f, 175f, 40f)) { f.absteigend = true }

            StammZeilenKnopf("Filter speichern", "Arrow_Trisar_Icons_01", Modifier.platz(20f, 550f, 362f, 56f).border(2.dp, LIME),
                iconBreite = 34f, iconHoehe = 20f, innen = 12f, aktion = zurueck)
            StammZeilenKnopf("Filter Löschen", "Arrow_Nav_Trisar_Icons_01", Modifier.platz(20f, 618f, 362f, 56f),
                iconBreite = 34f, iconHoehe = 20f, hintergrund = 0xFF6B6B, innen = 12f) { f.zuruecksetzen() }
        }
        FussleisteUnten()
    }
}

// MARK: - Anlegen / Bearbeiten

/** FUEL_TYPES: gespeichert wird genau dieser Text (steuert die EV-Erkennung der Planung). */
private val KRAFTSTOFFE = listOf("E10", "Super 95", "Super Plus", "Diesel B7", "Diesel B10", "Elektro", "Plug-in-Hybrid")

@Composable
private fun FahrzeugFormularSeite(fahrzeug: StammFahrzeug?, zurListe: () -> Unit) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    val fokus = LocalFocusManager.current
    val bearbeiten = !(fahrzeug?.id ?: "").isEmpty()

    var markeModell by remember { mutableStateOf(fahrzeug?.brandModel ?: "") }
    var variante by remember { mutableStateOf(fahrzeug?.trim ?: "") }
    var vin by remember { mutableStateOf(fahrzeug?.vin ?: "") }
    var kennzeichen by remember { mutableStateOf(fahrzeug?.licensePlate ?: "") }
    var farbe by remember { mutableStateOf(fahrzeug?.color ?: "") }
    var sitze by remember { mutableStateOf(fahrzeug?.seatCount?.toString() ?: "") }
    var kraftstoff by remember { mutableStateOf(fahrzeug?.fuelType ?: "") }
    var bildURL by remember { mutableStateOf(fahrzeug?.imageUrl ?: "") }
    var speichert by remember { mutableStateOf(false) }
    var rueckmeldung by remember { mutableStateOf("") }
    var kraftstoffOffen by remember { mutableStateOf(false) }

    // prepareVehicleImageDataUrl: laengste Seite hoechstens 1000, HEIC und Co. werden PNG.
    val bildWahl = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        if (uri == null) return@rememberLauncherForActivityResult
        val url = bildAlsDataURL(ctx, uri, 1000, png = !(ctx.contentResolver.getType(uri) ?: "").contains("jpeg"), qualitaet = 92)
        if (url == null) rueckmeldung = "Bild konnte nicht gelesen werden." else { bildURL = url; rueckmeldung = "" }
    }
    fun bildWaehlen() = bildWahl.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))

    fun leeren() {
        markeModell = ""; variante = ""; vin = ""; kennzeichen = ""; farbe = ""; sitze = ""; kraftstoff = ""; bildURL = ""
    }

    /** saveVehicle: Pflicht ist Marke & Modell, Sitze nur als ganze Zahl, leere Felder als null. */
    fun speichern() {
        fokus.clearFocus()
        val marke = markeModell.trim()
        if (marke.isEmpty()) { rueckmeldung = "Bitte Marke & Modell angeben."; return }
        val sitzText = sitze.trim()
        val sitzZahl = sitzText.toIntOrNull()
        if (sitzText.isNotEmpty() && (sitzZahl == null || sitzZahl < 0)) {
            rueckmeldung = "Beifahreranzahl muss eine positive ganze Zahl sein."; return
        }
        val inhalt = JsonObject(linkedMapOf<String, JsonElement>(
            "brand_model" to JsonPrimitive(marke),
            "trim" to jsonText(variante),
            "vin" to jsonText(vin),
            "license_plate" to jsonText(kennzeichen),
            "color" to jsonText(farbe),
            "seat_count" to (sitzZahl?.let { JsonPrimitive(it) } ?: JsonNull),
            "fuel_type" to jsonText(kraftstoff),
            "image_url" to jsonText(bildURL),
        ))
        speichert = true
        rueckmeldung = ""
        val id = if (bearbeiten) fahrzeug?.id else null
        scope.launch {
            try {
                FahrzeugeDienst.speichern(inhalt, id)
                rueckmeldung = if (id != null) "Fahrzeug erfolgreich aktualisiert." else "Fahrzeug erfolgreich erstellt."
                if (id != null) {
                    delay(200)
                    zurListe()
                } else {
                    leeren()
                }
            } catch (e: kotlinx.coroutines.CancellationException) {
                throw e
            } catch (e: Exception) {
                rueckmeldung = if (id != null) "Fahrzeug konnte nicht aktualisiert werden: ${dbMeldung(e)}"
                else "Fahrzeug konnte nicht gespeichert werden: ${dbMeldung(e)}"
            }
            speichert = false
        }
    }

    var schadenHoehe by remember { mutableStateOf(0f) }
    val inhalt = if (bearbeiten) max(913f, 842f + schadenHoehe + 70f) else 913f
    Box(Modifier.fillMaxSize().background(Color.Black)) {
        Leinwand(874f, inhalt) { rahmen ->
            DispoHintergrund(Modifier.platz(0f, 0f, 402f, max(rahmen, inhalt)))
            ZurueckKnopf(Modifier.platz(20f, 60f), zurListe)
            StammTitel(if (bearbeiten) "Fahrzeug bearbeiten" else "Fahrzeug erstellen", Modifier.platz(20f, 140f),
                groesse = if (bearbeiten) 36f else 42f, abstand = -0.5f, farbe = 0xE2F754)

            BoxFeld("Marke & Modell", markeModell, { markeModell = it }, Modifier.platz(20f, 206f, 178f, 56f), gross = KeyboardCapitalization.Words)
            BoxFeld("Modell Variante", variante, { variante = it }, Modifier.platz(204f, 206f, 178f, 56f), gross = KeyboardCapitalization.Words)
            BoxFeld("VIN", vin, { vin = it }, Modifier.platz(20f, 274f, 362f, 56f), gross = KeyboardCapitalization.Characters)
            BoxFeld("Kennzeichen", kennzeichen, { kennzeichen = it }, Modifier.platz(20f, 342f, 362f, 56f), gross = KeyboardCapitalization.Characters)
            BoxFeld("Farbe", farbe, { farbe = it }, Modifier.platz(20f, 410f, 362f, 56f))
            BoxFeld("Beifahreranzahl", sitze, { sitze = it.filter { c -> c.isDigit() } }, Modifier.platz(20f, 478f, 362f, 56f), tastatur = KeyboardType.Number)

            // Select mit festen Kraftstoffen, ein abweichender gespeicherter Wert bleibt waehlbar.
            Box(Modifier.platz(20f, 546f, 362f, 56f).border(2.dp, LIME).tippen { kraftstoffOffen = true }, contentAlignment = Alignment.CenterStart) {
                Text(kraftstoff.ifEmpty { "Antrieb / Kraftstoff" }, style = grotesk(16f, 500, abstand = 0.5f, farbe = hex(0x8A9728)),
                    modifier = Modifier.padding(start = 16.dp).alpha(if (kraftstoff.isEmpty()) 0.9f else 1f))
                Icon("Arrow-kurz_Trisar_Icons_01_Lime", Modifier.align(Alignment.CenterEnd).padding(end = 12.dp).size(10.dp, 13.dp).rotate(90f))
                DropdownMenu(kraftstoffOffen, { kraftstoffOffen = false }, Modifier.background(hex(0x1E1E1E))) {
                    val optionen = KRAFTSTOFFE + if (kraftstoff.isEmpty() || kraftstoff in KRAFTSTOFFE) emptyList() else listOf(kraftstoff)
                    for (k in optionen) {
                        DropdownMenuItem(text = { Text(k, style = grotesk(16f, farbe = Color.White)) }, onClick = { kraftstoff = k; kraftstoffOffen = false })
                    }
                }
            }

            Box(Modifier.platz(20f, 614f, 362f, 56f).border(2.dp, LIME), contentAlignment = Alignment.CenterStart) {
                Box(Modifier.fillMaxSize().padding(start = 16.dp, end = 48.dp).tippen { bildWaehlen() }, contentAlignment = Alignment.CenterStart) {
                    Text(if (bildURL.isEmpty()) "Fahrzeugbild hochladen" else "Fahrzeugbild ändern",
                        style = grotesk(16f, 500, abstand = 0.5f, farbe = hex(0x8A9728)), maxLines = 1)
                }
                if (bildURL.isNotEmpty()) {
                    StammBild(bildURL, Modifier.align(Alignment.CenterEnd).padding(end = 44.dp).size(64.dp, 40.dp))
                }
                Box(Modifier.align(Alignment.CenterEnd).size(34.dp, 44.dp).tippen { if (bildURL.isEmpty()) bildWaehlen() else bildURL = "" },
                    contentAlignment = Alignment.Center) {
                    if (bildURL.isEmpty()) Icon("Arrow-kurz_Trisar_Icons_01_Lime", Modifier.size(10.dp, 13.dp))
                    else Text("×", style = grotesk(16f, 700, farbe = hex(0xF55757)))
                }
            }

            Box(
                Modifier.platz(20f, 694f, 362f, 56f).alpha(if (speichert) 0.7f else 1f).background(hex(0xDBEE4A))
                    .tippen { if (!speichert) speichern() },
                contentAlignment = Alignment.Center,
            ) {
                Text(if (speichert) "Speichern ..." else if (bearbeiten) "Fahrzeug speichern" else "Fahrzeug erstellen",
                    style = grotesk(16f, 500, abstand = 0.5f, farbe = hex(0x0E1008)))
            }

            Box(Modifier.platz(20f, 762f, 362f).heightIn(min = 56.dp).border(1.dp, hex(0x7F8A2B)).padding(horizontal = 12.dp, vertical = 8.dp)) {
                Text(rueckmeldung.ifEmpty { if (bearbeiten) "Fahrzeugdaten ändern und speichern." else "Fahrzeugdaten eintragen und speichern." },
                    style = grotesk(12f, 400, 12f * 1.3f, farbe = hex(0xC8D85D)))
            }

            val fid = fahrzeug?.id
            if (bearbeiten && fid != null) {
                val dichte = androidx.compose.ui.platform.LocalDensity.current
                SchadensBerichtDispo(fid, Modifier.platz(20f, 842f, 362f)
                    .then(Modifier.onSizeChanged { schadenHoehe = with(dichte) { it.height.toDp().value } }))
            }
        }
        FussleisteUnten()
    }
}



// MARK: - Schadensbericht (nur lesen)

/** Gemeldete Schaeden wie SchadensBerichtDispo in iOS. Tipp auf ein Foto zeigt es gross. */
@Composable
private fun SchadensBerichtDispo(fahrzeugID: String, modifier: Modifier) {
    var schaeden by remember { mutableStateOf<List<JsonObject>>(emptyList()) }
    var geladen by remember { mutableStateOf(false) }
    var gross by remember { mutableStateOf<String?>(null) }
    var namen by remember { mutableStateOf<Map<String, String>>(emptyMap()) }
    androidx.compose.runtime.LaunchedEffect(fahrzeugID) {
        schaeden = runCatching {
            de.trisar.kern.Backend.client.from("vehicle_damages").select(
                io.github.jan.supabase.postgrest.query.Columns.ALL
            ) {
                filter { eq("vehicle_id", fahrzeugID) }
                order("report_date", io.github.jan.supabase.postgrest.query.Order.DESCENDING)
                order("created_at", io.github.jan.supabase.postgrest.query.Order.DESCENDING)
            }.decodeList<JsonObject>()
        }.getOrDefault(emptyList())
        val ids = schaeden.mapNotNull { (it["reported_by"] as? JsonPrimitive)?.takeIf { p -> p !is JsonNull }?.content }.distinct()
        if (ids.isNotEmpty()) {
            namen = runCatching {
                de.trisar.kern.Backend.client.from("profiles").select(
                    io.github.jan.supabase.postgrest.query.Columns.raw("id,first_name,last_name")) { filter { isIn("id", ids) } }
                    .decodeList<JsonObject>().associate { p ->
                        val t = { k: String -> (p[k] as? JsonPrimitive)?.takeIf { it !is JsonNull }?.content.orEmpty() }
                        t("id") to listOf(t("first_name"), t("last_name")).filter { it.isNotEmpty() }.joinToString(" ")
                    }
            }.getOrDefault(emptyMap())
        }
        geladen = true
    }
    fun text(o: JsonObject, k: String) = (o[k] as? JsonPrimitive)?.takeIf { it !is JsonNull }?.content.orEmpty()
    fun bilder(o: JsonObject): List<String> {
        val liste = (o["image_urls"] as? kotlinx.serialization.json.JsonArray)?.mapNotNull { (it as? JsonPrimitive)?.content }.orEmpty()
        return (liste.ifEmpty { listOf(text(o, "image_url")) }).filter { it.isNotEmpty() && !it.startsWith("blob:") }
    }
    val dunkel = hex(0x1D1C1C)
    val grau = hex(0x71717B)
    Column(modifier.background(Color.White).padding(24.dp)) {
        Text(if (schaeden.isEmpty()) "Schadensbericht" else "Schadensbericht (${schaeden.size})",
            style = grotesk(18f, 700, abstand = -0.5f, farbe = dunkel))
        Box(Modifier.padding(vertical = 10.dp).fillMaxWidth().height(1.dp).background(hex(0xDDDCDC)))
        if (geladen && schaeden.isEmpty()) Text("Keine Schäden gemeldet.", style = grotesk(14f, 400, farbe = grau))
        schaeden.forEachIndexed { i, s ->
            val tag = text(s, "report_date").take(10).split("-").let { if (it.size == 3) "${it[2]}.${it[1]}.${it[0]}" else "" }
            Row(Modifier.fillMaxWidth().padding(bottom = 6.dp), verticalAlignment = Alignment.Bottom) {
                Text(tag, style = grotesk(15f, 700, abstand = -0.5f, farbe = dunkel), modifier = Modifier.weight(1f))
                val melder = namen[text(s, "reported_by")].orEmpty()
                if (melder.isNotEmpty()) Text("gemeldet von $melder", style = grotesk(11f, 400, farbe = grau))
                else if (text(s, "reported_by_driver") == "true") Text("vom Fahrer gemeldet", style = grotesk(11f, 400, farbe = grau))
            }
            Row(Modifier.fillMaxWidth().padding(bottom = 10.dp), horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                Column(Modifier.weight(1f)) {
                    Text(text(s, "part_name").uppercase(), style = grotesk(11f, 700, abstand = -0.5f, farbe = dunkel), modifier = Modifier.padding(bottom = 4.dp))
                    Text(text(s, "description"), style = grotesk(14f, 700, abstand = -0.5f, farbe = dunkel))
                }
                val stelle = s["stelle"] as? JsonObject
                de.trisar.kern.FahrzeugSkizze.punkt(stelle)?.let { p ->
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        de.trisar.kern.FahrzeugSkizzeAnsicht(p, 110f)
                        if (de.trisar.kern.FahrzeugSkizze.geschaetzt(stelle)) Text("ungefähre Stelle", style = grotesk(9f, 400, farbe = grau))
                    }
                }
            }
            val b = bilder(s)
            if (b.isNotEmpty()) {
                Row(Modifier.fillMaxWidth().padding(bottom = 10.dp), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    for (url in b) {
                        coil3.compose.AsyncImage(model = url, contentDescription = "Schadensfoto",
                            contentScale = androidx.compose.ui.layout.ContentScale.Crop,
                            modifier = Modifier.weight(1f).height(96.dp).background(hex(0xF4F4F4)).clipToBounds().tippen { gross = url })
                    }
                }
            }
            if (i < schaeden.size - 1) Box(Modifier.padding(bottom = 10.dp).fillMaxWidth().height(1.dp).background(hex(0xDDDCDC)))
        }
    }
    gross?.let { url ->
        androidx.compose.ui.window.Dialog(onDismissRequest = { gross = null },
            properties = androidx.compose.ui.window.DialogProperties(usePlatformDefaultWidth = false)) {
            Box(Modifier.fillMaxSize().background(Color.Black).tippen { gross = null }, contentAlignment = Alignment.Center) {
                coil3.compose.AsyncImage(model = url, contentDescription = "Schadensfoto",
                    contentScale = androidx.compose.ui.layout.ContentScale.Fit, modifier = Modifier.fillMaxWidth())
            }
        }
    }
}
