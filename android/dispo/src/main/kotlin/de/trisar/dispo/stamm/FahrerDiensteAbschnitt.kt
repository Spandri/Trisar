package de.trisar.dispo.stamm

import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import de.trisar.dispo.fahrten.Rueckfrage
import de.trisar.kern.Backend
import de.trisar.kern.grotesk
import de.trisar.kern.hex
import de.trisar.kern.tippen
import io.github.jan.supabase.postgrest.from
import io.github.jan.supabase.postgrest.query.Columns
import io.github.jan.supabase.postgrest.query.Order
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.util.Locale

/*
 * "Dienste" in Fahrer bearbeiten (wie FahrerDienste.jsx und FahrerDiensteAbschnitt.swift):
 * Dienste dieses Fahrers ab heute fuer 14 Tage. Antippen aendert (Blatt "Dienste planen" mit genau diesem Fahrer),
 * "Löschen" entfernt einen Dienst, "Dienst hinzufügen" plant einen neuen Tag.
 * Der DB-Trigger (20261111080000_ein_dienst_pro_tag) ersetzt beim Senden den alten Dienst des Tages.
 */

internal data class FahrerDienstZeile(val id: String, val datum: String, val start: String, val ende: String, val status: String) {
    val offen get() = Dienstzeit.anfrageStatus(status) != "accepted"
    val zeitText get() = "${start.ifEmpty { "--:--" }} – ${ende.ifEmpty { "--:--" }}"
    /** "Heute 11.11." / "Mi 12.11." */
    val tagText: String get() {
        val d = runCatching { LocalDate.parse(datum) }.getOrNull() ?: return datum
        val tm = d.format(DateTimeFormatter.ofPattern("dd.MM."))
        if (d == LocalDate.now()) return "Heute $tm"
        return "${d.format(DateTimeFormatter.ofPattern("EE", Locale.GERMAN)).removeSuffix(".")} $tm"
    }
}

private fun feldText(o: JsonObject, k: String): String = (o[k] as? JsonPrimitive)?.takeIf { it !is JsonNull }?.content ?: ""

/** Zustand des Abschnitts. Das Blatt und die Rueckfrage liegen ausserhalb der Leinwand (FahrerDiensteUeberlagerung). */
internal class FahrerDiensteZustand(val fahrerID: String) {
    var dienste by mutableStateOf<List<FahrerDienstZeile>>(emptyList())
    var laedt by mutableStateOf(false)
    var meldung by mutableStateOf("")
    var blatt by mutableStateOf<DienstVorgabe?>(null)
    var loeschZeile by mutableStateOf<FahrerDienstZeile?>(null)

    suspend fun laden() {
        if (fahrerID.isEmpty()) return
        laedt = true
        val heute = Dienstzeit.heute()
        try {
            val zeilen = Backend.client.from("driver_service_requests")
                .select(Columns.raw("id, service_date, service_start_time, service_end_time, status, created_at")) {
                    filter { eq("driver_id", fahrerID); gte("service_date", heute); lte("service_date", Dienstzeit.plusTage(heute, 14)) }
                    order("service_date", Order.ASCENDING)
                    order("created_at", Order.DESCENDING)
                }.decodeList<JsonObject>()
            // Ein Dienst pro Tag (der neueste), abgelehnte nicht.
            val gesehen = mutableSetOf<String>()
            dienste = zeilen.map {
                FahrerDienstZeile(feldText(it, "id"), feldText(it, "service_date"), Dienstzeit.normal(feldText(it, "service_start_time")),
                    Dienstzeit.normal(feldText(it, "service_end_time")), feldText(it, "status"))
            }.filter { Dienstzeit.anfrageStatus(it.status) != "refused" && gesehen.add(it.datum) }
        } catch (x: kotlinx.coroutines.CancellationException) { throw x } catch (x: Exception) {
            meldung = "Dienste nicht geladen: ${x.message}"
        } finally {
            laedt = false
        }
    }

    /** Blatt mit Tag, Zeiten und festen Pausen des Dienstes oeffnen. */
    suspend fun bearbeiten(z: FahrerDienstZeile) {
        val pausen = runCatching {
            Backend.client.from("dienst_pausen").select { filter { eq("dienst_id", z.id) } }.decodeList<JsonObject>()
        }.getOrElse { if (it is kotlinx.coroutines.CancellationException) throw it; emptyList() }
            .firstOrNull()?.let { (it["pausen"] as? JsonArray).orEmpty() }.orEmpty()
            .mapNotNull { it as? JsonObject }
            .map { Dienstzeit.normal(feldText(it, "von")) to Dienstzeit.normal(feldText(it, "bis")) }
            .filter { it.first.isNotEmpty() && it.second.isNotEmpty() }
        meldung = ""
        blatt = DienstVorgabe(z.datum, z.start, z.ende, pausen)
    }

    suspend fun loeschen(z: FahrerDienstZeile) {
        meldung = ""
        val c = Backend.client
        try {
            c.from("driver_service_requests").delete { filter { eq("id", z.id) } }
        } catch (x: kotlinx.coroutines.CancellationException) { throw x } catch (x: Exception) {
            meldung = "Löschen fehlgeschlagen: ${x.message}"
            return
        }
        val heute = Dienstzeit.heute()
        if (z.datum == heute) {
            // Heute geloescht: Dienstzeit im Profil fuer heute leeren.
            val p = runCatching {
                c.from("profiles").select(Columns.raw("service_start_date, service_end_date")) { filter { eq("id", fahrerID) } }
                    .decodeList<JsonObject>().firstOrNull()
            }.getOrNull()
            val sd = p?.let { feldText(it, "service_start_date") }.orEmpty()
            val ed = p?.let { feldText(it, "service_end_date") }.orEmpty()
            val startLeeren = sd.isEmpty() || sd.startsWith(heute)
            val endeLeeren = ed.isEmpty() || ed.startsWith(heute)
            if (startLeeren || endeLeeren) {
                runCatching {
                    c.from("profiles").update(buildJsonObject {
                        if (startLeeren) { put("service_start_time", JsonNull); put("service_start_date", JsonNull) }
                        if (endeLeeren) { put("service_end_time", JsonNull); put("service_end_date", JsonNull) }
                    }) { filter { eq("id", fahrerID) } }
                }
            }
        }
        meldung = "Dienst gelöscht."
        laden()
    }

    companion object {
        const val KOPF = 36f
        const val ZEILE = 64f
        /** Hoehe des Abschnitts, damit Fahrer bearbeiten alles darunter verschieben kann. */
        fun hoehe(anzahl: Int) = KOPF + maxOf(anzahl, 1) * ZEILE + 56f + 12f
    }
}

/** Liste und "Dienst hinzufügen" in der Leinwand. */
@Composable
internal fun FahrerDiensteAbschnitt(z: FahrerDiensteZustand, modifier: Modifier) {
    val scope = rememberCoroutineScope()
    val schrift = hex(0x8A9728)
    LaunchedEffect(z.fahrerID) { z.laden() }
    Column(modifier) {
        Row(Modifier.fillMaxWidth().height(28.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("Dienste", style = grotesk(20f, 700, abstand = -0.5f, farbe = hex(0xE2F754)), modifier = Modifier.weight(1f))
            Text(z.meldung.ifEmpty { if (z.laedt) "Lädt …" else "nächste 14 Tage" }, style = grotesk(12f, farbe = hex(0xC8D85D)), maxLines = 1)
        }
        Box(Modifier.height(8.dp))
        if (z.dienste.isEmpty()) {
            Box(Modifier.fillMaxWidth().height(56.dp).border(2.dp, hex(0x7F8A2B)).padding(horizontal = 16.dp), contentAlignment = Alignment.CenterStart) {
                Text(if (z.laedt) "Lädt …" else "Keine Dienste geplant", style = grotesk(16f, farbe = schrift))
            }
            Box(Modifier.height(8.dp))
        } else {
            for (d in z.dienste) {
                Row(Modifier.fillMaxWidth().height(56.dp).border(2.dp, LIME), verticalAlignment = Alignment.CenterVertically) {
                    Column(
                        Modifier.weight(1f).fillMaxHeight().tippen { scope.launch { z.bearbeiten(d) } }.padding(start = 16.dp),
                        verticalArrangement = Arrangement.Center,
                    ) {
                        Text(buildAnnotatedString {
                            append(d.tagText)
                            withStyle(SpanStyle(fontWeight = FontWeight.Medium, color = if (d.offen) hex(0xFF9500) else hex(0x59BE80))) {
                                append(if (d.offen) "  offen" else "  bestätigt")
                            }
                        }, style = grotesk(15f, 700, 20f, farbe = LIME), maxLines = 1)
                        Text(d.zeitText, style = grotesk(15f, 500, 20f, farbe = schrift), maxLines = 1)
                    }
                    Box(
                        Modifier.padding(end = 8.dp).height(36.dp).border(2.dp, hex(0xFF3B30)).tippen { z.loeschZeile = d }.padding(horizontal = 12.dp),
                        contentAlignment = Alignment.Center,
                    ) {
                        Text("Löschen", style = grotesk(13f, 500, farbe = hex(0xFF3B30)))
                    }
                }
                Box(Modifier.height(8.dp))
            }
        }
        Box(
            Modifier.padding(top = 2.dp).fillMaxWidth().height(48.dp).border(2.dp, LIME).tippen { z.meldung = ""; z.blatt = DienstVorgabe(null) },
            contentAlignment = Alignment.Center,
        ) {
            Text("Dienst hinzufügen", style = grotesk(16f, 500, farbe = LIME))
        }
    }
}

/** Blatt "Dienste planen" und Loesch-Rueckfrage ueber dem ganzen Bildschirm. */
@Composable
internal fun FahrerDiensteUeberlagerung(z: FahrerDiensteZustand, fahrerName: String) {
    val scope = rememberCoroutineScope()
    z.blatt?.let { v ->
        DienstePlanenBlatt(listOf(z.fahrerID), v) {
            z.blatt = null
            scope.launch { z.laden() }
        }
    }
    z.loeschZeile?.let { d ->
        Rueckfrage(
            "Dienst ${d.tagText} von ${fahrerName.ifEmpty { "diesem Fahrer" }} löschen?",
            ok = { z.loeschZeile = null; scope.launch { z.loeschen(d) } },
            abbrechen = { z.loeschZeile = null },
        )
    }
}
