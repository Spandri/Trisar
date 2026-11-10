package de.trisar.fahrer

import android.content.Context
import android.content.Intent
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import de.trisar.kern.Anmeldung
import de.trisar.kern.Backend
import de.trisar.kern.NfcTagDienst
import io.github.jan.supabase.postgrest.postgrest
import io.github.jan.supabase.postgrest.rpc
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.put

/**
 * NFC-Tag am Tracker: https://fahrer.trisar.de/nfc/<code> uebernimmt Tracker und Fahrzeug
 * fuer den angemeldeten Fahrer (trisar_nfc_uebernehmen). Ohne Anmeldung wartet der Code.
 */
object NfcTag {
    val offen = MutableStateFlow<String?>(null)
    val meldung = MutableStateFlow<String?>(null)
    /** Zaehlt erfolgreiche Uebernahmen, damit Fahrzeug und Fahrten neu laden. */
    val stand = MutableStateFlow(0)
    private val muster = Regex("""^/nfc/([a-fA-F0-9]{18})/?$""")
    private val linkMuster = Regex("""^https://fahrer\.trisar\.de/nfc/([a-fA-F0-9]{18})/?$""")

    fun ausIntent(intent: Intent?) {
        val pfad = intent?.takeIf { it.action == Intent.ACTION_VIEW }?.data?.path ?: return
        muster.find(pfad)?.let { offen.value = it.groupValues[1].lowercase() }
    }

    /** Tag am Tracker aus der App heraus lesen. */
    fun scannen(ctx: Context) {
        val aktivitaet = NfcTagDienst.activity(ctx) ?: return
        val hinweis = NfcTagDienst.starten(aktivitaet, null) { ergebnis ->
            ergebnis.fold(
                { link ->
                    val code = linkMuster.find(link)?.groupValues?.get(1)
                    if (code != null) { meldung.value = null; offen.value = code.lowercase() }
                    else meldung.value = if (link.isEmpty()) "Auf diesem Tag steht nichts." else "Das ist kein TRISAR-Tag."
                },
                { meldung.value = "Lesen fehlgeschlagen. Tag ruhig halten und noch einmal versuchen." },
            )
        }
        meldung.value = hinweis ?: "Tag am Tracker jetzt ans Handy halten."
    }

    suspend fun einloesen(anmeldung: Anmeldung) {
        val code = offen.value ?: return
        offen.value = null
        meldung.value = try {
            val text = Backend.client.postgrest.rpc("trisar_nfc_uebernehmen", buildJsonObject { put("p_code", code) }).data
            anmeldung.profilLaden()
            stand.value += 1
            (Backend.json.parseToJsonElement(text).jsonObject["meldung"] as? JsonPrimitive)?.content
        } catch (e: kotlinx.coroutines.CancellationException) {
            throw e
        } catch (e: Exception) {
            "Das Fahrzeug konnte nicht verbunden werden. Bitte noch einmal antippen."
        }
    }
}

@Composable
fun NfcAbwicklung(anmeldung: Anmeldung) {
    val offen by NfcTag.offen.collectAsState()
    val meldung by NfcTag.meldung.collectAsState()
    LaunchedEffect(offen) { if (offen != null) NfcTag.einloesen(anmeldung) }
    meldung?.let { text ->
        AlertDialog(
            onDismissRequest = { NfcTag.meldung.value = null },
            confirmButton = { TextButton(onClick = { NfcTag.meldung.value = null }) { Text("OK") } },
            text = { Text(text) },
        )
    }
}
