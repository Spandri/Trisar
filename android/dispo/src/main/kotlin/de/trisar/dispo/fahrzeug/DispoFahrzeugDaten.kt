package de.trisar.dispo.fahrzeug

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.ImageDecoder
import android.net.Uri
import android.os.Build
import android.util.Base64
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import de.trisar.kern.Backend
import de.trisar.kern.FahrzeugZeile
import io.github.jan.supabase.postgrest.from
import io.github.jan.supabase.postgrest.query.Columns
import io.github.jan.supabase.postgrest.query.Order
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.io.ByteArrayOutputStream
import java.time.LocalDate
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/** Schaden wie FahrzeugDaten.Schaden der Fahrer-App, dazu wer ihn gemeldet hat (vehicle_damages.gemeldet_von). */
internal data class DispoSchaden(
    val id: String, val datum: String, val stelle: String, val beschreibung: String, val bilder: List<String>,
    val punkt: androidx.compose.ui.geometry.Offset? = null,
    val genau: JsonObject? = null,
    val gemeldetVon: String = "",
)

/** Fahrzeug des Fahrers (profiles.vehicle_id -> vehicles), fuer Fahrerblatt und Fahrzeugseite. */
internal suspend fun fahrzeugVonFahrer(fahrerID: String): FahrzeugZeile? = runCatching {
    val daten = Backend.client.from("profiles").select(Columns.raw("vehicle_id, vehicles:vehicle_id(${FahrzeugZeile.SPALTEN})")) {
        filter { eq("id", fahrerID) }; limit(1)
    }.data
    Backend.json.decodeFromString<List<ProfilFahrzeug>>(daten).firstOrNull()?.vehicles
}.getOrNull()

@Serializable
private data class ProfilFahrzeug(val vehicle_id: String? = null, val vehicles: FahrzeugZeile? = null)

/**
 * Daten der Dispo-Fahrzeugseite: Ausstattung (trim) und Schadensbericht des Fahrzeugs,
 * wie FahrzeugDaten der Fahrer-App (ohne Standort und Telemetrie, die kommt aus DispoTelemetrie).
 */
internal class DispoFahrzeugDaten(private val fahrzeugID: String?) {
    var ausstattung by mutableStateOf("")
        private set
    var schaeden by mutableStateOf<List<DispoSchaden>>(emptyList())
        private set
    var fehler by mutableStateOf<String?>(null)

    suspend fun laden() {
        ausstattungLaden()
        schaedenLaden()
    }

    @Serializable private data class TrimZeile(val trim: String? = null)

    private suspend fun ausstattungLaden() {
        val id = fahrzeugID ?: run { ausstattung = ""; return }
        val z = runCatching {
            Backend.json.decodeFromString<List<TrimZeile>>(
                Backend.client.from("vehicles").select(Columns.raw("trim")) { filter { eq("id", id) }; limit(1) }.data
            )
        }.getOrNull() ?: return
        ausstattung = z.firstOrNull()?.trim.orEmpty()
    }

    @Serializable
    private data class SchadenZeile(
        val id: String,
        val report_date: String? = null,
        val part_name: String? = null,
        val description: String? = null,
        val image_url: String? = null,
        val image_urls: List<String>? = null,
        val stelle: JsonObject? = null,
        val gemeldet_von: String? = null,
    )

    suspend fun schaedenLaden() {
        val id = fahrzeugID ?: run { schaeden = emptyList(); return }
        val zeilen = runCatching {
            Backend.json.decodeFromString<List<SchadenZeile>>(
                Backend.client.from("vehicle_damages").select(Columns.ALL) {
                    filter { eq("vehicle_id", id) }
                    order("report_date", Order.DESCENDING)
                }.data
            )
        }.getOrNull() ?: return
        schaeden = zeilen.map { z ->
            val bilder = (if (!z.image_urls.isNullOrEmpty()) z.image_urls else listOfNotNull(z.image_url))
                .filter { it.isNotEmpty() && !it.startsWith("blob:") }
            DispoSchaden(z.id, datumKurz(z.report_date.orEmpty()), z.part_name.orEmpty(), z.description.orEmpty(), bilder,
                de.trisar.kern.FahrzeugSkizze.punkt(z.stelle), z.stelle, z.gemeldet_von?.trim().orEmpty())
        }
    }

    /**
     * Wie FahrzeugDaten.melden der Fahrer-App, aber von der Dispo: reported_by_driver false,
     * reported_by bleibt der Datenbank-Standard (angemeldetes Dispo-Konto).
     */
    suspend fun melden(stelle: String, beschreibung: String, fotos: List<Bitmap>, genau: JsonObject? = null): Boolean {
        val id = fahrzeugID ?: run { fehler = "Kein Fahrzeug zugeteilt."; return false }
        val heute = LocalDate.now().toString()
        val heuteKurz = datumKurz(heute)
        if (schaeden.any { it.datum == heuteKurz && it.stelle == stelle && it.beschreibung == beschreibung }) return true
        val bilder = fotos.take(3).map { FotoHilfe.datenURL(FotoHilfe.verkleinern(it, 900), 60) }
        fun zeile(mitStelle: Boolean) = buildJsonObject {
            put("vehicle_id", id); put("report_date", heute); put("part_name", stelle); put("description", beschreibung)
            put("image_url", bilder.firstOrNull()?.let { JsonPrimitive(it) } ?: JsonNull)
            put("image_urls", buildJsonArray { bilder.forEach { add(JsonPrimitive(it)) } })
            put("reported_by_driver", false)
            if (mitStelle && genau != null) put("stelle", genau)
        }
        return try {
            try {
                Backend.client.from("vehicle_damages").insert(zeile(true))
            } catch (e: Exception) {
                if (e is kotlinx.coroutines.CancellationException || genau == null) throw e
                Backend.client.from("vehicle_damages").insert(zeile(false))
            }
            schaedenLaden()
            true
        } catch (e: Exception) {
            if (e is kotlinx.coroutines.CancellationException) throw e
            fehler = "Schaden konnte nicht gemeldet werden: ${e.message}"
            false
        }
    }

    companion object {
        /** 2026-09-12 -> 12.09.26 */
        fun datumKurz(wert: String): String {
            val t = wert.take(10).split("-")
            if (t.size != 3) return wert
            return "${t[2]}.${t[1]}.${t[0].takeLast(2)}"
        }
    }
}

/** Bildhilfen aus ProfilDienst der Fahrer-App (Fotos laden, verkleinern, als data-URL). */
internal object FotoHilfe {
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
