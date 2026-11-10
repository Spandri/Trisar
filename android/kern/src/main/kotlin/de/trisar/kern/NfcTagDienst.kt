package de.trisar.kern

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import android.nfc.NdefMessage
import android.nfc.NdefRecord
import android.nfc.NfcAdapter
import android.nfc.Tag
import android.nfc.tech.Ndef
import android.nfc.tech.NdefFormatable
import android.os.Handler
import android.os.Looper

/** NFC-Tags der OBD-Tracker beschreiben und auslesen (Dispo und Fahrer). */
object NfcTagDienst {
    private const val ARTEN = NfcAdapter.FLAG_READER_NFC_A or NfcAdapter.FLAG_READER_NFC_B or
        NfcAdapter.FLAG_READER_NFC_F or NfcAdapter.FLAG_READER_NFC_V

    fun activity(ctx: Context): Activity? {
        var c = ctx
        while (c is ContextWrapper) {
            if (c is Activity) return c
            c = c.baseContext
        }
        return null
    }

    /**
     * Wartet auf einen Tag. Mit [link] wird er beschrieben, ohne wird er gelesen.
     * [fertig] laeuft auf dem Hauptfaden und liefert den Link, leer bei einem Tag ohne Link.
     * Liefert den Hinweis, falls NFC nicht geht, sonst null.
     */
    fun starten(activity: Activity, link: String?, fertig: (Result<String>) -> Unit): String? {
        val adapter = NfcAdapter.getDefaultAdapter(activity) ?: return "Dieses Gerät kann kein NFC."
        if (!adapter.isEnabled) return "Bitte NFC in den Einstellungen einschalten."
        val haupt = Handler(Looper.getMainLooper())
        adapter.enableReaderMode(activity, { tag ->
            val ergebnis = runCatching { if (link != null) schreiben(tag, link) else lesen(tag) }
            haupt.post {
                stoppen(activity)
                fertig(ergebnis)
            }
        }, ARTEN, null)
        return null
    }

    fun stoppen(activity: Activity) {
        NfcAdapter.getDefaultAdapter(activity)?.disableReaderMode(activity)
    }

    private fun schreiben(tag: Tag, link: String): String {
        val nachricht = NdefMessage(arrayOf(NdefRecord.createUri(link)))
        val ndef = Ndef.get(tag)
        if (ndef != null) {
            ndef.use {
                it.connect()
                check(it.isWritable) { "Dieser Tag ist schreibgeschützt." }
                check(it.maxSize >= nachricht.toByteArray().size) { "Auf diesem Tag ist zu wenig Platz." }
                it.writeNdefMessage(nachricht)
            }
            return link
        }
        val neu = NdefFormatable.get(tag) ?: error("Dieser Tag wird nicht unterstützt.")
        neu.use {
            it.connect()
            it.format(nachricht)
        }
        return link
    }

    private fun lesen(tag: Tag): String {
        val ndef = Ndef.get(tag) ?: return ""
        return ndef.use {
            it.connect()
            it.ndefMessage?.records?.firstNotNullOfOrNull { r -> r.toUri()?.toString() } ?: ""
        }
    }
}
