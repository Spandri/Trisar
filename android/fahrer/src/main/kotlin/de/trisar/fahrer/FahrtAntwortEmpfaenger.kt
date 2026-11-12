package de.trisar.fahrer

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import de.trisar.fahrer.haupt.FahrtAntwort
import de.trisar.kern.Backend
import de.trisar.kern.Push
import io.github.jan.supabase.auth.auth
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeout

/**
 * Knoepfe „Annehmen“ / „Ablehnen“ in der Mitteilung (fahrt_neu, erinnerung_offen).
 * Antwortet wie die Fahrtenliste (FahrtAntwort.senden), ohne die App zu oeffnen,
 * und ersetzt die Mitteilung danach durch eine kurze Bestaetigung.
 */
class FahrtAntwortEmpfaenger : BroadcastReceiver() {
    private val bereich = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    override fun onReceive(ctx: Context, intent: Intent) {
        val fahrtID = intent.getStringExtra(Push.EXTRA_FAHRT) ?: return
        val annehmen = intent.getBooleanExtra(Push.EXTRA_ANNEHMEN, false)
        val mitteilung = intent.getIntExtra(Push.EXTRA_MITTEILUNG, 0)
        val fahrtText = intent.getStringExtra(Push.EXTRA_TEXT).orEmpty()
        val app = ctx.applicationContext
        val rest = goAsync()
        bereich.launch {
            val fehler = runCatching {
                withTimeout(25_000) {
                    // Die App kann beendet sein: gespeicherte Anmeldung erst laden.
                    Backend.client.auth.awaitInitialization()
                    val fahrer = Backend.client.auth.currentUserOrNull()?.id
                        ?: throw IllegalStateException("Nicht angemeldet. Bitte TRISAR öffnen.")
                    FahrtAntwort.senden(fahrer, fahrtID, FahrtAntwort.istKolonne(fahrtID), annehmen)
                }
            }.exceptionOrNull()
            if (fehler == null) {
                Push.zeigen(app, if (annehmen) "Fahrt angenommen" else "Fahrt abgelehnt", fahrtText,
                    mapOf("ziel" to "fahrt", "job_id" to fahrtID), id = mitteilung, leise = true)
            } else {
                Push.zeigen(app, "Antwort nicht gespeichert",
                    "${fehler.message ?: fehler}. Bitte in der App annehmen oder ablehnen.",
                    mapOf("ziel" to "fahrt", "job_id" to fahrtID), id = mitteilung)
            }
            rest.finish()
        }
    }
}
