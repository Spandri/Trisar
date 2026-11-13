package de.trisar.kern

import kotlinx.serialization.Serializable

/**
 * Treffpunkt und Notiz beim Dienststart (Tabelle dienst_treffpunkt, Migration 20261113140000).
 * Die Dispo setzt sie beim Dienste planen, der Fahrer sieht den Ort in der Dienststart-Karte und
 * beim Antippen wie bei einer Fahrt auf der Karte. Gleich in Web dienstTreffpunkt.js und iOS.
 */
@Serializable
data class DienstTreffpunktZeile(
    val dienst_id: String,
    val ort_id: String? = null,
    val name: String? = null,
    val adresse: String? = null,
    val lat: Double? = null,
    val lng: Double? = null,
    val notiz: String? = null,
    val aktualisiert: String? = null,
)

/** Treffpunkt der App (treffpunktAusZeile im Web). */
data class DienstTreffpunkt(
    val ortID: String?,
    val name: String,
    val adresse: String,
    val punkt: GeoPunkt?,
    val notiz: String,
    val aktualisiert: String?,
) {
    /**
     * Graues Icon wie bei Start und Ziel einer Fahrt: eigener Ort mit seinem Icon, sonst nach dem Namen
     * (treffpunktIcon im Web). Liest EigeneOrte, darum nach dem Laden der Orte neu.
     */
    val iconGrau: String
        get() {
            EigeneOrte.iconGrau(ortID)?.let { return it }
            val text = "$name $adresse".lowercase()
            return when {
                Regex("\\b(hotel|hof|resort|hostel|inn|motel|suite|residence)\\b").containsMatchIn(text) -> OrtIcons.grau("hotel")
                Regex("muc|flughafen|airport|terminal").containsMatchIn(text) -> OrtIcons.grau("flughafen_landung")
                text.contains("messe") -> OrtIcons.grau("messe_halle")
                else -> OrtIcons.grau("pin")
            }
        }

    companion object {
        const val SPALTEN = "dienst_id,ort_id,name,adresse,lat,lng,notiz,aktualisiert"

        /** Zeile aus dienst_treffpunkt -> Treffpunkt. Ohne Ort und Notiz: null. */
        fun ausZeile(z: DienstTreffpunktZeile?): DienstTreffpunkt? {
            if (z == null) return null
            val lat = z.lat
            val lng = z.lng
            val punkt = if (lat != null && lng != null && lat.isFinite() && lng.isFinite() && !(lat == 0.0 && lng == 0.0)) GeoPunkt(lat, lng) else null
            val name = z.name.orEmpty().trim()
            val adresse = z.adresse.orEmpty().trim()
            val notiz = z.notiz.orEmpty().trim()
            if (name.isEmpty() && adresse.isEmpty() && notiz.isEmpty()) return null
            return DienstTreffpunkt(z.ort_id, name.ifEmpty { adresse.split(",").first().trim() }, adresse, punkt, notiz, z.aktualisiert)
        }
    }
}
