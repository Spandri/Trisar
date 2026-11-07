package de.trisar.kern

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import io.github.jan.supabase.postgrest.from
import io.github.jan.supabase.postgrest.query.Columns
import io.github.jan.supabase.realtime.PostgresAction
import io.github.jan.supabase.realtime.RealtimeChannel
import io.github.jan.supabase.realtime.channel
import io.github.jan.supabase.realtime.postgresChangeFlow
import io.github.jan.supabase.realtime.realtime
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable

/** Eigener Ort der Dispo (Tabelle orte) mit Reinfahr-/Rausfahr-Radius und Icon. */
@Serializable
data class Ort(
    val id: String,
    val name: String = "",
    val adresse: String = "",
    val lat: Double = 0.0,
    val lng: Double = 0.0,
    val radius_rein_m: Int = 50,
    val radius_raus_m: Int = 100,
    val icon: String = "pin",
) {
    val punkt get() = GeoPunkt(lat, lng)
}

/** Die sechs Ort-Icons: grau in Listen und bei der Fahrt, Lime fuer aktiv/ausgewaehlt. */
object OrtIcons {
    val SCHLUESSEL = listOf("pin", "haus", "flughafen_abflug", "flughafen_landung", "fahrzeug", "stern")

    private fun basis(k: String): String = when (k) {
        "haus" -> "House_Nav_Trisar_01"
        "flughafen_abflug" -> "Plain_Abflug_Trisar_Icons_01"
        "flughafen_landung" -> "Plain_Landen_Trisar_Icons_01"
        "fahrzeug" -> "Vehicle_Nav_Trisar_01"
        "stern" -> "Stern_Trisar_Icon_01"
        else -> "Pin_Nav_Trisar_Icons_01"
    }

    fun grau(k: String) = basis(k) + "_grau"
    fun lime(k: String) = basis(k) + "_Lime"
}

/**
 * Eigene Orte, einmal geladen und per id nachgeschlagen (Fahrer-App) bzw. per Realtime aktuell
 * gehalten (Dispo). Fehlt die Tabelle noch, bleibt die Liste leer und `verfuegbar` false.
 */
object EigeneOrte {
    var liste by mutableStateOf<List<Ort>>(emptyList())
        private set
    /** true, sobald die Tabelle einmal gelesen werden konnte (Migration ist da). */
    var verfuegbar by mutableStateOf(false)
        private set

    private val bereich = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var kanal: RealtimeChannel? = null
    private val auftraege = mutableListOf<Job>()
    private var nutzer = 0

    suspend fun laden(): Boolean {
        val zeilen = runCatching {
            Backend.client.from("orte")
                .select(Columns.raw("id, name, adresse, lat, lng, radius_rein_m, radius_raus_m, icon"))
                .decodeList<Ort>()
        }.getOrNull() ?: return false
        liste = zeilen.sortedBy { it.name.lowercase() }
        verfuegbar = true
        return true
    }

    /** Nur laden, wenn noch nichts da ist (Fahrer-App: einmal laden). */
    suspend fun einmalLaden() {
        if (!verfuegbar) laden()
    }

    fun zuID(id: String?): Ort? {
        if (id.isNullOrBlank()) return null
        return liste.firstOrNull { it.id.equals(id, ignoreCase = true) }
    }

    /** Graues Icon des Orts der Fahrt, null ohne Ort (dann gilt das Textmuster). */
    fun iconGrau(id: String?): String? = zuID(id)?.let { OrtIcons.grau(it.icon) }

    /**
     * Vorschlaege fuer Start/Ziel: erst Namen, die mit dem Getippten beginnen, dann Namen mit
     * einem Wort, das so beginnt. Ohne Gross/klein, ab einem Buchstaben.
     */
    fun vorschlaege(eingabe: String): List<Ort> {
        val s = eingabe.trim().lowercase()
        if (s.isEmpty()) return emptyList()
        val anfang = liste.filter { it.name.trim().lowercase().startsWith(s) }
        val wort = liste.filter { o ->
            o !in anfang && o.name.lowercase().split(Regex("[\\s,./()-]+")).drop(1).any { it.startsWith(s) }
        }
        return anfang + wort
    }

    /** Realtime auf orte, solange mindestens eine Ansicht sie braucht. */
    fun beobachten() {
        nutzer += 1
        if (nutzer > 1) return
        auftraege += bereich.launch {
            laden()
            val k = Backend.client.channel("orte-${System.currentTimeMillis()}")
            val strom = k.postgresChangeFlow<PostgresAction>(schema = "public") { table = "orte" }
            kanal = k
            auftraege += bereich.launch { strom.collect { laden() } }
            runCatching { k.subscribe() }
        }
    }

    fun nichtMehrBeobachten() {
        nutzer = maxOf(0, nutzer - 1)
        if (nutzer > 0) return
        auftraege.forEach { it.cancel() }
        auftraege.clear()
        val k = kanal ?: return
        kanal = null
        bereich.launch { runCatching { Backend.client.realtime.removeChannel(k) } }
    }

    /** Nach eigenem Speichern sofort uebernehmen, ohne auf Realtime zu warten. */
    fun setzen(neu: List<Ort>) {
        liste = neu.sortedBy { it.name.lowercase() }
        verfuegbar = true
    }
}
