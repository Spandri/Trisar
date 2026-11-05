package de.trisar.fahrer.haupt

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.ImageDecoder
import android.net.Uri
import android.os.Build
import android.util.Base64
import de.trisar.kern.Backend
import io.github.jan.supabase.auth.auth
import io.github.jan.supabase.postgrest.from
import io.github.jan.supabase.postgrest.query.Columns
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import java.io.ByteArrayOutputStream
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/** Eigenes Profil lesen und Felder einzeln speichern, wie handleSaveDriverProfile in FahrerApp.jsx. */
class ProfilDienst {
    @Serializable
    data class Daten(
        val first_name: String? = null,
        val last_name: String? = null,
        val phone: String? = null,
        val street: String? = null,
        val street_number: String? = null,
        val city: String? = null,
        val zip: String? = null,
        val language: String? = null,
        val avatar_url: String? = null,
    )

    val daten = MutableStateFlow(Daten())
    val email = MutableStateFlow("")
    val fehler = MutableStateFlow<String?>(null)

    suspend fun laden(fahrerID: String) {
        email.value = Backend.client.auth.currentUserOrNull()?.email.orEmpty()
        runCatching {
            Backend.client.from("profiles").select(Columns.raw("first_name,last_name,phone,street,street_number,city,zip,language,avatar_url")) {
                filter { eq("id", fahrerID) }; limit(1)
            }.liste<Daten>().firstOrNull()
        }.getOrNull()?.let { daten.value = it }
    }

    /** Ein Feld in profiles schreiben (leerer Text = null). Spaltennamen wie im Web. */
    suspend fun speichern(spalte: String, wert: String?, fahrerID: String) {
        val w = wert?.trim().orEmpty()
        try {
            Backend.client.from("profiles").update(buildJsonObject {
                put(spalte, if (w.isEmpty()) JsonNull else JsonPrimitive(w))
            }) { filter { eq("id", fahrerID) } }
            fehler.value = null
        } catch (e: Exception) {
            if (e is kotlinx.coroutines.CancellationException) throw e
            fehler.value = "Profil konnte nicht gespeichert werden."
        }
    }

    /** E-Mail liegt in Supabase Auth, nicht in profiles (wie im Web). */
    suspend fun emailSpeichern(neu: String) {
        val n = neu.trim()
        if (n.isEmpty() || n == email.value) return
        runCatching { Backend.client.auth.updateUser { email = n } }
    }

    companion object {
        /** prepareAvatarDataUrl: laengste Seite 720, JPEG 0.84 (bzw. 0.76 wenn zu gross) als Data-URL. */
        fun profilbildDataURL(bild: Bitmap): String {
            val klein = verkleinern(bild, 720)
            val url1 = datenURL(klein, 84)
            if (url1.length <= 2_200_000) return url1
            return datenURL(klein, 76)
        }

        /** Profilbild aus Data-URL. */
        fun bildAusDataURL(text: String?): Bitmap? {
            val t = text ?: return null
            if (!t.startsWith("data:")) return null
            val komma = t.indexOf(',')
            if (komma < 0) return null
            return runCatching {
                val bytes = Base64.decode(t.substring(komma + 1), Base64.DEFAULT)
                BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
            }.getOrNull()
        }

        fun verkleinern(bild: Bitmap, maxKante: Int): Bitmap {
            val seite = max(bild.width, bild.height)
            val faktor = min(1f, maxKante.toFloat() / max(seite, 1))
            if (faktor >= 1f) return bild
            return Bitmap.createScaledBitmap(bild, max(1, (bild.width * faktor).roundToInt()), max(1, (bild.height * faktor).roundToInt()), true)
        }

        fun datenURL(bild: Bitmap, qualitaet: Int): String {
            val aus = ByteArrayOutputStream()
            bild.compress(Bitmap.CompressFormat.JPEG, qualitaet, aus)
            return "data:image/jpeg;base64," + Base64.encodeToString(aus.toByteArray(), Base64.NO_WRAP)
        }

        /** Foto aus Kamera oder Galerie laden, gedreht wie aufgenommen (ImageDecoder beachtet EXIF), hoechstens maxKante. */
        suspend fun bildLaden(ctx: Context, uri: Uri, maxKante: Int = 1800): Bitmap? = withContext(Dispatchers.IO) {
            runCatching {
                if (Build.VERSION.SDK_INT >= 28) {
                    ImageDecoder.decodeBitmap(ImageDecoder.createSource(ctx.contentResolver, uri)) { decoder, info, _ ->
                        val s = info.size
                        val f = min(1f, maxKante.toFloat() / max(s.width, s.height))
                        if (f < 1f) decoder.setTargetSize(max(1, (s.width * f).roundToInt()), max(1, (s.height * f).roundToInt()))
                        decoder.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
                    }
                } else {
                    ctx.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it) }?.let { verkleinern(it, maxKante) }
                }
            }.getOrNull()
        }
    }
}
