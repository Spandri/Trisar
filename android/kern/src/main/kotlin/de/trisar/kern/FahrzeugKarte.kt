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

/**
 * Weisse Fahrzeugkarte (362 x 268) aus Fahrtenliste und „Keine Fahrt“, wie FahrzeugKarte.swift
 * (VehicleBlock in FahrtenScreen01View.jsx). titel: Liste zeigt das Kennzeichen, „Keine Fahrt“ das Modell.
 * bildOben: Liste 63, „Keine Fahrt“ 55.57.
 */
@Composable
fun FahrzeugKarte(fahrzeug: FahrzeugZeile?, titel: String, modifier: Modifier = Modifier, bildOben: Float = 63f) {
    Box(modifier.size(362.dp, 268.dp).background(Color.White)) {
        SchrumpfText(titel, grotesk(30f, 700, abstand = -0.5f, farbe = hex(0x1C1C1D)), 362f,
            Modifier.platz(0f, 15.29f, 362f, 36.68f))
        FahrzeugBild(fahrzeug?.image_url, Modifier.platz(63.9f, bildOben, 234.53f, 114.91f))
        VinZeile(fahrzeug?.vin, Modifier.platz(0f, 51.97f, 362f))
        FahrzeugKacheln(fahrzeug, Modifier.platz(53f, 195.65f))
    }
}

/** Vier Kacheln: Kraftstoff, Farbe, Energie, Sitze (16 Abstand). */
@Composable
fun FahrzeugKacheln(f: FahrzeugZeile?, modifier: Modifier = Modifier) {
    Row(modifier, horizontalArrangement = Arrangement.spacedBy(16.dp)) {
        KraftstoffKachel(f?.fuel_type)
        FarbKachel(f?.color)
        EnergieKachel(f?.fuel_type, f?.battery_fuel_percent, f?.range_km)
        SitzKachel(f?.seat_count)
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
