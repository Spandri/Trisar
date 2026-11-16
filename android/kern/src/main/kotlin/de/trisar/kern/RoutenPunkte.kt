package de.trisar.kern

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import java.util.Locale

/**
 * Routenpunkt der Dispo (jobs.routen_punkte, 15.11.): Ort auf der Karte, durch den die Fahrt fuehren soll.
 * nach = Abschnitt: 0 = zwischen Start und erstem Zwischenstopp (ohne Stopps: bis Ziel), k = nach Zwischenstopp k.
 * Reihenfolge in der Liste = Fahrtreihenfolge.
 */
data class RoutenPunkt(val lat: Double, val lng: Double, val nach: Int)

object RoutenPunkte {
    /** Google erlaubt 9 Zwischenziele, Abholung und Stopps zaehlen mit. */
    const val GOOGLE_ZWISCHENZIELE = 9

    fun hoechstens(stoppAnzahl: Int) = maxOf(0, 8 - stoppAnzahl)

    /** Wie routenPunkteLesen auf dem Server: kaputte Eintraege weg, nach >= 0, hoechstens 8. */
    fun lesen(wert: JsonElement?): List<RoutenPunkt> {
        val liste = wert as? JsonArray ?: return emptyList()
        return liste.mapNotNull { e ->
            val o = e as? JsonObject ?: return@mapNotNull null
            fun zahl(k: String) = (o[k] as? JsonPrimitive)?.content?.toDoubleOrNull()
            val lat = zahl("lat") ?: return@mapNotNull null
            val lng = zahl("lng") ?: zahl("lon") ?: return@mapNotNull null
            if (!lat.isFinite() || !lng.isFinite() || kotlin.math.abs(lat) > 90 || kotlin.math.abs(lng) > 180) return@mapNotNull null
            RoutenPunkt(lat, lng, maxOf(0, (zahl("nach") ?: 0.0).toInt()))
        }.take(8)
    }

    fun json(punkte: List<RoutenPunkt>): JsonArray = JsonArray(punkte.map {
        JsonObject(mapOf("lat" to JsonPrimitive(it.lat), "lng" to JsonPrimitive(it.lng), "nach" to JsonPrimitive(it.nach)))
    })

    /** "lat,lng" mit 6 Nachkommastellen fuer den Google-Maps-Link. */
    fun text(p: RoutenPunkt): String = String.format(Locale.US, "%.6f,%.6f", p.lat, p.lng)

    /**
     * Zwischenziele nach der Abholung in Fahrtreihenfolge:
     * Punkte(nach 0), Stopp 1, Punkte(nach 1), ..., Stopp n, Punkte(nach n).
     */
    fun zwischenziele(stopps: List<String>, punkte: List<RoutenPunkt>): List<String> = buildList {
        for (k in 0..stopps.size) {
            punkte.filter { minOf(it.nach, stopps.size) == k }.forEach { add(text(it)) }
            if (k < stopps.size) add(stopps[k])
        }
    }
}

/** Google-Polyline (Genauigkeit 1e5) in Punkte, wie decodeGooglePolyline im Web. */
fun googlePolylineLesen(text: String?): List<GeoPunkt> {
    if (text.isNullOrEmpty()) return emptyList()
    val punkte = mutableListOf<GeoPunkt>()
    var i = 0; var lat = 0; var lng = 0
    fun zahl(): Int? {
        var ergebnis = 0; var verschiebung = 0
        while (i < text.length) {
            val b = text[i].code - 63
            i++
            ergebnis = ergebnis or ((b and 0x1f) shl verschiebung)
            verschiebung += 5
            if (b < 0x20) return if (ergebnis and 1 != 0) (ergebnis shr 1).inv() else (ergebnis shr 1)
        }
        return null
    }
    while (i < text.length) {
        val dLat = zahl() ?: break
        val dLng = zahl() ?: break
        lat += dLat; lng += dLng
        punkte.add(GeoPunkt(lat / 1e5, lng / 1e5))
    }
    return punkte
}
