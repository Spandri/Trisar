package de.trisar.fahrer

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import de.trisar.fahrer.haupt.FahrerOrtung
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull

/**
 * Mitteilung "Arbeitszeit beginnt" (art ortung_start, Push.AKTION_ORTUNG_START): Die App kann
 * geschlafen haben oder frisch gestartet sein. Ortung einrichten, Fahrer aus der Sitzung holen,
 * Arbeitszeit pruefen und den Ortungsdienst starten (wie ortung_wecken auf dem Server).
 */
class OrtungWeckEmpfaenger : BroadcastReceiver() {
    private val bereich = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    override fun onReceive(ctx: Context, intent: Intent) {
        val rest = goAsync()
        FahrerOrtung.einrichten(ctx)
        bereich.launch {
            withTimeoutOrNull(25_000) { FahrerOrtung.wecken() }
            rest.finish()
        }
    }
}
