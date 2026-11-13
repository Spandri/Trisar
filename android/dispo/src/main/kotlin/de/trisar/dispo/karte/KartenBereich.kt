package de.trisar.dispo.karte

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.geometry.Offset
import de.trisar.kern.Backend
import io.github.jan.supabase.auth.auth
import io.github.jan.supabase.postgrest.from
import io.github.jan.supabase.postgrest.query.Columns
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.put

/**
 * Eigener Kartenbereich der Dispo (13.11.): frei gezeichneter Umriss, auf den "Karte" in der Leiste
 * zoomt. Persoenlich in public.dispo_kartenbereich, wie kartenBereich.js (Web) und KartenBereich (iOS).
 */
internal object KartenBereich {
    var punkte by mutableStateOf<List<KartenPunkt>?>(null)
        private set

    private fun nutzer() = Backend.client.auth.currentUserOrNull()?.id

    /** [[lng, lat]] wie im Web. */
    private fun aus(w: JsonArray?): List<KartenPunkt>? {
        val k = w.orEmpty().mapNotNull { p ->
            val a = p as? JsonArray ?: return@mapNotNull null
            val lng = (a.getOrNull(0) as? JsonPrimitive)?.doubleOrNull
            val lat = (a.getOrNull(1) as? JsonPrimitive)?.doubleOrNull
            if (lng == null || lat == null) null else KartenPunkt(lat, lng)
        }
        return k.takeIf { it.size >= 3 }
    }

    private fun rund(x: Double) = Math.round(x * 1e6) / 1e6

    suspend fun laden() {
        val id = nutzer() ?: return
        val zeilen = runCatching {
            Backend.client.from("dispo_kartenbereich").select(Columns.raw("punkte")) { filter { eq("user_id", id) } }.decodeList<JsonObject>()
        }.getOrNull() ?: return
        punkte = aus(zeilen.firstOrNull()?.get("punkte") as? JsonArray)
    }

    /** Gibt eine Fehlermeldung zurueck oder null. */
    suspend fun speichern(k: List<KartenPunkt>): String? {
        if (k.size < 3) return "Bereich zu klein."
        punkte = k
        val id = nutzer() ?: return "Nicht angemeldet."
        return runCatching {
            Backend.client.from("dispo_kartenbereich").upsert(
                listOf(buildJsonObject {
                    put("user_id", id)
                    put("punkte", buildJsonArray { k.forEach { p -> add(buildJsonArray { add(JsonPrimitive(rund(p.lng))); add(JsonPrimitive(rund(p.lat))) }) } })
                    put("aktualisiert", java.time.Instant.now().toString())
                }),
            ) { onConflict = "user_id" }
        }.exceptionOrNull()?.message
    }

    suspend fun loeschen(): String? {
        punkte = null
        val id = nutzer() ?: return null
        return runCatching {
            Backend.client.from("dispo_kartenbereich").delete { filter { eq("user_id", id) } }
        }.exceptionOrNull()?.message
    }

    /** Bildschirmpunkte ausduennen: naeher als `abstand` faellt weg, hoechstens `max` bleiben. */
    fun ausduennen(pfad: List<Offset>, abstand: Float, max: Int = 240): List<Offset> {
        val aus = mutableListOf<Offset>()
        for (p in pfad) if (aus.isEmpty() || (p - aus.last()).getDistance() >= abstand) aus += p
        if (aus.size <= max) return aus
        val schritt = aus.size.toDouble() / max
        return (0 until max).map { aus[(it * schritt).toInt()] }
    }
}
