package de.trisar.dispo.fahrten

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import de.trisar.kern.Backend
import io.github.jan.supabase.auth.auth
import io.github.jan.supabase.postgrest.from
import io.github.jan.supabase.postgrest.query.Columns
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

// Glocke je Fahrt (17.11.2026), Nachbau von admin/src/shared/fahrtGlocke.js: Die Dispo wischt eine Fahrt auf
// und tippt die Glocke. Dann bekommt sie zu dieser Fahrt Meldungen (beim Gast, mit Gast unterwegs, 5 min vor
// Ankunft, angekommen). Die Karte zeigt oben rechts eine kleine Glocke. Nochmal tippen nimmt sie wieder weg.
// Tabelle fahrt_glocke je Konto, Meldungen schickt der push-dienst (Push-Art dispo_fahrt_glocke, ziel 'fahrt').
// Migration 20261117180000_fahrt_glocke.
internal object FahrtGlocke {
    /** job_ids (klein) mit Glocke. */
    var glocken by mutableStateOf<Set<String>>(emptySet()); private set

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private var ladeJob: Job? = null
    /** Konto, fuer das geladen ist. Anderes Konto laedt neu. */
    private var geladenFuer: String? = null

    private fun nutzerId(): String? = Backend.client.auth.currentUserOrNull()?.id
    private fun schluessel(id: String) = id.trim().lowercase()

    fun hat(jobId: String): Boolean = schluessel(jobId) in glocken

    /** Eigene Glocken einmal laden (glockenLaden). Fehlt die Tabelle, beim naechsten Aufruf noch einmal. */
    fun laden() {
        val uid = nutzerId() ?: return
        if (geladenFuer == uid || ladeJob?.isActive == true) return
        if (geladenFuer != null) glocken = emptySet()
        ladeJob = scope.launch {
            val zeilen = try {
                Backend.client.from("fahrt_glocke").select(Columns.list("job_id")) { filter { eq("user_id", uid) } }
                    .decodeList<JsonObject>()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                return@launch // Migration fehlt noch
            }
            glocken = zeilen.map { schluessel(W.t(it["job_id"])) }.filter { it.isNotEmpty() }.toSet()
            geladenFuer = uid
        }
    }

    /** Glocke an oder aus (glockeUmschalten). Sofort sichtbar, bei Fehler zurueck. */
    fun umschalten(jobId: String) {
        val id = jobId.trim()
        if (id.isEmpty()) return
        val uid = nutzerId() ?: return
        val s = schluessel(id)
        val war = s in glocken
        glocken = if (war) glocken - s else glocken + s
        scope.launch {
            val ok = try {
                if (war) {
                    Backend.client.from("fahrt_glocke").delete { filter { eq("user_id", uid); eq("job_id", id) } }
                } else {
                    Backend.client.from("fahrt_glocke").insert(buildJsonObject { put("user_id", uid); put("job_id", id) })
                }
                true
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                false
            }
            if (!ok) glocken = if (war) glocken + s else glocken - s
        }
    }
}
