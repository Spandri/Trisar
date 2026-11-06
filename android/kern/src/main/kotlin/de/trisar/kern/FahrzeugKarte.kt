package de.trisar.kern

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.setValue
import androidx.compose.foundation.layout.height
import kotlinx.coroutines.delay
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil3.compose.SubcomposeAsyncImage
import kotlinx.serialization.Serializable
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/** Zeile aus `vehicles`, nur was Fahrzeugkarte und Fahrzeugseite brauchen. */
@Serializable
data class FahrzeugZeile(
    val id: String,
    val license_plate: String? = null,
    val brand_model: String? = null,
    val vin: String? = null,
    val image_url: String? = null,
    val fuel_type: String? = null,
    val color: String? = null,
    val seat_count: Int? = null,
    val battery_fuel_percent: Double? = null,
    val range_km: Double? = null,
) {
    companion object {
        const val SPALTEN = "id,license_plate,brand_model,vin,image_url,fuel_type,color,seat_count,battery_fuel_percent,range_km"
    }
}

/** Bilder liegen teils als Pfad der Web-App vor (/fahrzeuge/...). */
fun fahrzeugBildURL(wert: String?): String? {
    val roh = wert?.trim().orEmpty()
    if (roh.isEmpty()) return null
    if (roh.startsWith("http") || roh.startsWith("data:")) return roh
    return "https://fahrer.trisar.de" + (if (roh.startsWith("/")) roh else "/$roh")
}

/** Bild per URL, solange es laedt (oder fehlt) eine graue Flaeche wie AsyncImage in iOS. */
@Composable
fun FahrzeugBild(url: String?, modifier: Modifier, platzhalter: Color = hex(0xECECEC), skalierung: ContentScale = ContentScale.Fit) {
    val adresse = fahrzeugBildURL(url)
    if (adresse == null) {
        Box(modifier.background(platzhalter))
        return
    }
    SubcomposeAsyncImage(
        model = adresse, contentDescription = null, modifier = modifier, contentScale = skalierung,
        loading = { Box(Modifier.fillMaxSize().background(platzhalter)) },
        error = { Box(Modifier.fillMaxSize().background(platzhalter)) },
    )
}

/** Einzeiliger Text, der wie minimumScaleFactor in iOS bis `minFaktor` schrumpft, wenn er nicht passt. */
@Composable
fun SchrumpfText(text: String, stil: TextStyle, breite: Float, modifier: Modifier = Modifier, minFaktor: Float = 0.5f, ausrichtung: TextAlign = TextAlign.Center) {
    val messer = rememberTextMeasurer()
    val dichte = LocalDensity.current
    val gemessen = remember(text, stil) { messer.measure(text, stil, maxLines = 1, softWrap = false).size.width.toFloat() }
    val verfuegbar = with(dichte) { breite.dp.toPx() }
    val faktor = if (gemessen > verfuegbar && gemessen > 0) max(minFaktor, verfuegbar / gemessen) else 1f
    Text(
        text,
        style = stil.copy(fontSize = stil.fontSize * faktor, letterSpacing = stil.letterSpacing * faktor),
        maxLines = 1, softWrap = false, overflow = TextOverflow.Ellipsis, textAlign = ausrichtung, modifier = modifier,
    )
}

/** „VIN  “ fett, danach die Nummer mit Abstand 2, sehr blass (wie im Web mit z-10 ueber dem Bild). */
@Composable
fun VinZeile(vin: String?, modifier: Modifier) {
    val farbe = Color(28, 28, 29).copy(alpha = 0.15f)
    Text(
        buildAnnotatedString {
            withStyle(SpanStyle(fontWeight = FontWeight.Bold)) { append("VIN  ") }
            withStyle(SpanStyle(letterSpacing = 2.sp)) { append(vin.orEmpty()) }
        },
        style = grotesk(13f, farbe = farbe), maxLines = 1, textAlign = TextAlign.Center, modifier = modifier,
    )
}

/** Bilder, die nicht laden. Karten und Fahrzeugblock lassen den Bildplatz dann weg. */
object FahrzeugBildSpeicher {
    val kaputt = mutableStateListOf<String>()
    fun melden(url: String) { if (url !in kaputt) kaputt.add(url) }
}

/** Testansicht "nur Kennzeichen + Standort" (nur Debug-Build, per Intent-Extra TRISAR_NUR_KENNZEICHEN). */
object FahrzeugTest { var nurKennzeichen = false }

/**
 * Was wir ueber das Fahrzeug wissen (fahrzeugAngaben.js der Web-App, FahrzeugAngaben in iOS).
 * Leere Felder werden nicht gezeigt: kein "–", keine graue Bildflaeche.
 */
data class FahrzeugAngaben(
    val kennzeichen: String = "",
    val vin: String = "",
    val bild: String? = null,
    val modell: String = "",
    val ausstattung: String = "",
    val kraftstoff: String = "",
    val farbe: String = "",
    val sitze: Int? = null,
    val fuellstand: Double? = null,
    val reichweite: Double? = null,
) {
    val energie get() = fuellstand != null
    val hatKacheln get() = kraftstoff.isNotEmpty() || farbe.isNotEmpty() || energie || sitze != null

    data class KartenRaster(val vin: Float?, val bild: Float?, val kacheln: Float?, val hoehe: Float)
    data class BlockRaster(val vin: Float?, val bild: Float?, val modell: Float?, val ausstattung: Float?, val kacheln: Float?, val hoehe: Float)

    /** Startseiten-Karte (362 breit). Mit allem 268 hoch. */
    fun kartenRaster(bildOben: Float = 63f): KartenRaster {
        var y = 52f
        var v: Float? = null; var b: Float? = null
        if (vin.isNotEmpty()) { v = 51.97f; y = 68f }
        if (bild != null) { b = bildOben; y = bildOben + 114.91f }
        return if (hatKacheln) KartenRaster(v, b, y + 17.65f, y + 17.65f + 52f + 20.35f) else KartenRaster(v, b, null, y + 16f)
    }

    /** Fahrzeugblock der Fahrzeug-Seite (353 breit). Mit allem 332 hoch. */
    fun blockRaster(): BlockRaster {
        var y = 52f
        var v: Float? = null; var b: Float? = null; var m: Float? = null; var a: Float? = null
        if (vin.isNotEmpty()) { v = 51.97f; y = 68f }
        if (bild != null) { b = 75f; y = 197f }
        if (modell.isNotEmpty()) { m = y + 13f; y += 33f }
        if (ausstattung.isNotEmpty()) { val o = if (modell.isEmpty()) y + 8f else y; a = o; y = o + 16f }
        return if (hatKacheln) BlockRaster(v, b, m, a, y + 24f, y + 24f + 52f + 10f) else BlockRaster(v, b, m, a, null, y + 16f)
    }

    companion object {
        /** Liest FahrzeugBildSpeicher (Compose-Zustand): neu berechnen, sobald ein Bild ausfaellt. */
        fun aus(f: FahrzeugZeile?, ausstattung: String = ""): FahrzeugAngaben {
            fun t(v: String?) = v?.trim().orEmpty()
            val kennzeichen = t(f?.license_plate)
            if (FahrzeugTest.nurKennzeichen) return FahrzeugAngaben(kennzeichen = kennzeichen)
            val bild = fahrzeugBildURL(f?.image_url)?.takeIf { it !in FahrzeugBildSpeicher.kaputt }
            return FahrzeugAngaben(
                kennzeichen = kennzeichen, vin = t(f?.vin), bild = bild, modell = t(f?.brand_model), ausstattung = t(ausstattung),
                kraftstoff = t(f?.fuel_type), farbe = t(f?.color), sitze = f?.seat_count?.takeIf { it > 0 },
                fuellstand = f?.battery_fuel_percent, reichweite = f?.range_km,
            )
        }
    }
}

/** Hoehe der Startseiten-Karte fuer die Listen darunter. */
fun fahrzeugKartenHoehe(f: FahrzeugZeile?, bildOben: Float = 63f) = FahrzeugAngaben.aus(f).kartenRaster(bildOben).hoehe

/** Fahrzeugfoto ohne Platzhalter. Laedt es nicht, verschwindet es (und der Platz dafuer). */
@Composable
fun FahrzeugFoto(adresse: String, modifier: Modifier) {
    SubcomposeAsyncImage(
        model = adresse, contentDescription = null, modifier = modifier, contentScale = ContentScale.Fit,
        loading = { Box(Modifier.fillMaxSize()) },
        error = { LaunchedEffect(adresse) { FahrzeugBildSpeicher.melden(adresse) } },
    )
}

/**
 * Weisse Fahrzeugkarte (362 breit, mit allen Angaben 268 hoch) aus Fahrtenliste und „Keine Fahrt“,
 * wie FahrzeugKarte.swift / shared/FahrzeugKarte.jsx. titel: Liste Kennzeichen, „Keine Fahrt“ Modell.
 * bildOben: Liste 63, „Keine Fahrt“ 55.57.
 */
@Composable
fun FahrzeugKarte(fahrzeug: FahrzeugZeile?, titel: String, modifier: Modifier = Modifier, bildOben: Float = 63f) {
    val a = FahrzeugAngaben.aus(fahrzeug)
    val r = a.kartenRaster(bildOben)
    Box(modifier.size(362.dp, r.hoehe.dp).background(Color.White)) {
        SchrumpfText(titel, grotesk(30f, 700, abstand = -0.5f, farbe = hex(0x1C1C1D)), 338f,
            Modifier.platz(12f, 15.29f, 338f, 36.68f))
        if (r.bild != null && a.bild != null) FahrzeugFoto(a.bild, Modifier.platz(63.9f, r.bild, 234.53f, 114.91f))
        if (r.vin != null) VinZeile(a.vin, Modifier.platz(0f, r.vin, 362f))
        if (r.kacheln != null) FahrzeugKacheln(a, Modifier.platz(0f, r.kacheln, 362f))
    }
}

/** Nur Kacheln mit Wert (Kraftstoff, Farbe, Energie, Sitze), mittig, 16 Abstand. */
@Composable
fun FahrzeugKacheln(a: FahrzeugAngaben, modifier: Modifier = Modifier) {
    Row(modifier, horizontalArrangement = Arrangement.spacedBy(16.dp, Alignment.CenterHorizontally)) {
        if (a.kraftstoff.isNotEmpty()) KraftstoffKachel(a.kraftstoff)
        if (a.farbe.isNotEmpty()) FarbKachel(a.farbe)
        if (a.energie) EnergieKachel(a.kraftstoff, a.fuellstand, a.reichweite)
        a.sitze?.let { SitzKachel(it) }
    }
}

/** Woher der Standort kommt: driver_live_locations.source (teltonika_fmb010 = Tracker, sonst App). */
fun istObdQuelle(quelle: String?) =
    Regex("teltonika|fmb\\d*|obd|telematik|telematics|tracker", RegexOption.IGNORE_CASE).containsMatchIn(quelle.orEmpty())

/** 'gerade eben', 'vor 3 Min.', 'vor 2 Std.', 'vor 4 Tagen' */
fun standortAlter(erfasstMs: Long?, jetztMs: Long = System.currentTimeMillis()): String {
    if (erfasstMs == null) return ""
    val min = max(0L, (jetztMs - erfasstMs) / 60_000)
    if (min < 1) return "gerade eben"
    if (min < 60) return "vor $min Min."
    val std = min / 60
    if (std < 24) return "vor $std Std."
    val tage = std / 24
    return if (tage == 1L) "vor 1 Tag" else "vor $tage Tagen"
}

/** Chip an der Karte: "Standort: OBD-Tracker  vor 3 Min." Aktualisiert sich alle 30 s. */
@Composable
fun StandortChip(quelle: String, erfasstMs: Long?, modifier: Modifier = Modifier) {
    var jetzt by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(Unit) { while (true) { delay(30_000); jetzt = System.currentTimeMillis() } }
    Row(
        modifier.height(28.dp).background(Color.Black).padding(horizontal = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(7.dp),
    ) {
        Box(Modifier.size(7.dp).background(hex(0xE3F654), CircleShape))
        Text(if (istObdQuelle(quelle)) "Standort: OBD-Tracker" else "Standort: Fahrer-App",
            style = grotesk(12f, 700, farbe = hex(0xE3F654)), maxLines = 1)
        val alter = standortAlter(erfasstMs, jetzt)
        if (alter.isNotEmpty()) Text(alter, style = grotesk(12f, 500, farbe = Color.White.copy(alpha = 0.7f)), maxLines = 1)
    }
}

// Kacheln (vehicleBadges.jsx, Basis 36, angezeigt in 52)

@Composable
private fun KachelRahmen(inhalt: @Composable () -> Unit) {
    Box(Modifier.size(52.dp), contentAlignment = Alignment.Center) {
        Icon("card-outline-52", Modifier.fillMaxSize(), skalierung = ContentScale.FillBounds)
        Box(Modifier.scale(52f / 36f), contentAlignment = Alignment.Center) { inhalt() }
    }
}

@Composable
fun KraftstoffKachel(kraftstoff: String?) {
    KachelRahmen {
        val (icon, text) = kraftstoffAnzeige(kraftstoff)
        if (icon != null) {
            Icon(icon, Modifier.size(23.dp))
        } else {
            Box(Modifier.size(23.dp, 20.dp), contentAlignment = Alignment.Center) {
                Box(Modifier.fillMaxSize().padding(1.05.dp).border(2.1.dp, hex(0x12120D), RoundedCornerShape(3.7.dp)))
                Text(text.orEmpty(), style = grotesk(9f, 700, farbe = Color.Black), maxLines = 1)
            }
        }
    }
}

/** resolveFuelBadge der Web-App: (Icon, Text). */
fun kraftstoffAnzeige(wert: String?): Pair<String?, String?> {
    val f = wert.orEmpty().trim().lowercase()
    if (f.isEmpty() || f == "e10") return "E10_Tank_Trisar_Icons_01" to null
    if ("elektr" in f || f == "ev" || f == "bev" || "hybrid" in f) return "Blitz_Trisar_Icons_01" to null
    if ("b10" in f) return null to "B10"
    if ("diesel" in f || "b7" in f) return null to "B7"
    if ("plus" in f || "98" in f) return "E98_Tank_Trisar_Icons_01" to null
    if ("95" in f || "super" in f || "e5" in f) return "E95_Tank_Trisar_Icons_01" to null
    return null to wert.orEmpty().trim().take(3)
}

@Composable
fun FarbKachel(farbe: String?) {
    KachelRahmen { Box(Modifier.size(23.dp).background(autoFarbe(farbe), CircleShape)) }
}

/** resolveCarColor der Web-App. */
fun autoFarbe(wert: String?): Color {
    val roh = wert?.trim().orEmpty()
    if (roh.isEmpty()) return hex(0x0D0D0D)
    val v = roh.lowercase()
    val tabelle = mapOf(
        "black" to 0x0D0D0DL, "schwarz" to 0x0D0D0DL, "white" to 0xF3F4F6L, "weiss" to 0xF3F4F6L,
        "silber" to 0xC4C6C8L, "silver" to 0xC4C6C8L, "grau" to 0x8B8E93L, "gray" to 0x8B8E93L, "grey" to 0x8B8E93L,
        "blau" to 0x1D4ED8L, "blue" to 0x1D4ED8L, "rot" to 0xB91C1CL, "red" to 0xB91C1CL, "gruen" to 0x15803DL, "green" to 0x15803DL,
    )
    tabelle[v]?.let { return hex(it) }
    if (roh.startsWith("#") && roh.length == 7) roh.drop(1).toLongOrNull(16)?.let { return hex(it) }
    return when {
        "weiß" in v || "weiss" in v -> hex(0xF3F4F6)
        "blau" in v || "blue" in v -> hex(0x1D4ED8)
        "rot" in v || "red" in v -> hex(0xB91C1C)
        "grün" in v || "gruen" in v || "green" in v -> hex(0x15803D)
        "bronze" in v -> hex(0x8A6D55)
        "grau" in v || "grey" in v || "gray" in v -> hex(0x8B8E93)
        "silber" in v || "silver" in v -> hex(0xC4C6C8)
        else -> hex(0x0D0D0D)
    }
}

@Composable
fun SitzKachel(sitze: Int?) {
    KachelRahmen {
        val name = if (sitze == null) "Person_Trisar_Icons_01" else "${min(8, max(3, sitze))}x_Person_Trisar_Icons_01"
        Icon(name, Modifier.size(23.dp))
    }
}

/**
 * Energie-Kachel: Elektro = Batterie, Verbrenner = Zapfsaeule mit Fuellbalken.
 * Ohne Wert steht „–“ (kein erfundener Wert, wie im Live-Betrieb der Web-App).
 */
@Composable
fun EnergieKachel(kraftstoff: String?, fuellstand: Double?, reichweite: Double?) {
    val f = kraftstoff.orEmpty().lowercase()
    val elektrisch = "elektr" in f || f == "ev" || f == "bev"
    val fill = fuellstand?.let { it.roundToInt().coerceIn(0, 100) }
    val maxReichweite = if ((reichweite ?: 0.0) > 0) reichweite!! else if (elektrisch) 500.0 else 650.0
    val km = fill?.let { (it / 100.0 * maxReichweite).roundToInt() }
    KachelRahmen {
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
                Box(Modifier.size(8.dp, 13.dp)) {
                    val balken = 13f * 0.76f * (fill ?: 0) / 100f
                    Canvas(Modifier.fillMaxSize()) {
                        val b = 4.dp.toPx()
                        val h = balken.dp.toPx()
                        drawRect(hex(0x1A171B), topLeft = androidx.compose.ui.geometry.Offset((size.width - b) / 2f, size.height - (13f * 0.12f).dp.toPx() - h),
                            size = androidx.compose.ui.geometry.Size(b, h))
                    }
                    Icon("Zapfsaeule_Trisar_Icons_01", Modifier.fillMaxSize(), skalierung = ContentScale.FillBounds)
                }
            }
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                val stil = grotesk(5f, 700, zeilenHoehe = 6f, farbe = Color.Black)
                Text(km?.let { "${it}km " } ?: "–", style = stil, maxLines = 1)
                Text(fill?.let { "$it%" } ?: "–", style = stil.copy(color = hex(0x060606)), maxLines = 1)
            }
        }
    }
}
