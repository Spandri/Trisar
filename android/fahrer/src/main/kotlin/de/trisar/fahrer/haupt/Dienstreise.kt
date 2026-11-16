package de.trisar.fahrer.haupt

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import de.trisar.kern.Backend
import de.trisar.kern.DienstreiseAbschnitt
import de.trisar.kern.DienstreiseZeile
import de.trisar.kern.Icon
import de.trisar.kern.grotesk
import de.trisar.kern.hex
import de.trisar.kern.mittig
import de.trisar.kern.platz
import de.trisar.kern.tippen
import io.github.jan.supabase.postgrest.from
import io.github.jan.supabase.postgrest.postgrest
import io.github.jan.supabase.postgrest.query.Columns
import io.github.jan.supabase.postgrest.query.filter.FilterOperator
import io.github.jan.supabase.realtime.PostgresAction
import io.github.jan.supabase.realtime.RealtimeChannel
import io.github.jan.supabase.realtime.channel
import io.github.jan.supabase.realtime.postgresChangeFlow
import io.github.jan.supabase.realtime.realtime
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.time.LocalDate
import java.time.ZoneId

/**
 * Dienstreise in der Fahrer-App (fahrer/src/shared/dienstreise.js, DienstreiseKarte.jsx).
 * Tabellen dienstreise, dienstreise_fahrer, Funktionen dienstreise_antworten und dienstreise_beenden.
 */
@Serializable
data class DienstreiseFahrerZeile(
    val dienstreise_id: String,
    val status: String = "pending",
    val beendet: String? = null,
)

/** Eigene Dienstreise: Zeile des Fahrers mit der Dienstreise dazu. */
data class FahrerDienstreise(
    val z: DienstreiseFahrerZeile,
    val r: DienstreiseZeile,
    /** Abschnitte (Umstiege), nach Reihenfolge. Leer bei einer einzigen Verbindung. */
    val abschnitte: List<DienstreiseAbschnitt> = emptyList(),
) {
    val id get() = r.id
    val offen get() = z.status == "pending"
    val angenommen get() = z.status == "accepted"

    /** Sichtbar bis der Fahrer beendet, sonst bis zum Ende des Folgetags (reiseSichtbar). */
    val sichtbar: Boolean get() {
        if (z.beendet != null) return false
        val tag = runCatching { LocalDate.parse(r.datum.take(10)) }.getOrNull() ?: return false
        val ende = tag.plusDays(1).atTime(23, 59).atZone(ZoneId.systemDefault()).toInstant()
        return ende.isAfter(java.time.Instant.now())
    }
}

/** Eigene Dienstreisen (angefragt oder angenommen, nicht beendet), live. */
object DienstreiseSpeicher {
    val liste = MutableStateFlow<List<FahrerDienstreise>>(emptyList())
    val fehler = MutableStateFlow<String?>(null)

    private val bereich = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private var fahrerID: String? = null
    private var kanal: RealtimeChannel? = null
    private val auftraege = mutableListOf<Job>()

    fun setzeFahrer(id: String?) {
        if (id == fahrerID) return
        fahrerID = id
        auftraege.forEach { it.cancel() }; auftraege.clear()
        kanal?.let { k -> bereich.launch { runCatching { Backend.client.realtime.removeChannel(k) } } }
        kanal = null
        liste.value = emptyList()
        if (id == null) return
        bereich.launch { laden() }
        val k = Backend.client.channel("fahrer-dienstreise-$id-${System.currentTimeMillis()}")
        val eigene = k.postgresChangeFlow<PostgresAction>(schema = "public") {
            table = "dienstreise_fahrer"; filter("driver_id", FilterOperator.EQ, id)
        }
        val reisen = k.postgresChangeFlow<PostgresAction>(schema = "public") { table = "dienstreise" }
        val teile = k.postgresChangeFlow<PostgresAction>(schema = "public") { table = "dienstreise_abschnitt" }
        kanal = k
        auftraege += bereich.launch { teile.collect { laden() } }
        auftraege += bereich.launch { eigene.collect { laden() } }
        auftraege += bereich.launch { reisen.collect { a -> if (a is PostgresAction.Update) laden() } }
        auftraege += bereich.launch { runCatching { k.subscribe() } }
    }

    suspend fun laden() {
        val id = fahrerID ?: return
        runCatching {
            val zeilen = Backend.client.from("dienstreise_fahrer").select(Columns.raw("dienstreise_id, status, beendet")) {
                filter { eq("driver_id", id); isIn("status", listOf("pending", "accepted")) }
            }.decodeList<DienstreiseFahrerZeile>()
            val ids = zeilen.map { it.dienstreise_id }
            val reisen = if (ids.isEmpty()) emptyList() else Backend.client.from("dienstreise").select(Columns.raw(DienstreiseZeile.SPALTEN)) {
                filter { isIn("id", ids) }
            }.decodeList<DienstreiseZeile>()
            // Abschnitte (Umstiege). Fehlt die Tabelle (alte Datenbank), bleibt es bei der einen Verbindung.
            val abschnitte = if (ids.isEmpty()) emptyList() else runCatching {
                Backend.client.from("dienstreise_abschnitt").select(Columns.raw("*")) {
                    filter { isIn("dienstreise_id", ids) }
                    order("reihenfolge", io.github.jan.supabase.postgrest.query.Order.ASCENDING)
                }.decodeList<DienstreiseAbschnitt>()
            }.getOrDefault(emptyList())
            val je = reisen.associateBy { it.id }
            zeilen.mapNotNull { z ->
                je[z.dienstreise_id]?.let { FahrerDienstreise(z, it, abschnitte.filter { a -> a.dienstreise_id == z.dienstreise_id }.sortedBy { a -> a.reihenfolge }) }
            }
                .filter { it.r.datum.isNotEmpty() && it.sichtbar }
                .sortedBy { it.r.datum + it.r.start_zeit }
        }.onSuccess { if (fahrerID == id) liste.value = it }
    }

    fun antworten(reise: FahrerDienstreise, annehmen: Boolean) {
        bereich.launch {
            runCatching {
                Backend.client.postgrest.rpc("dienstreise_antworten", buildJsonObject { put("p_dienstreise", reise.id); put("p_annehmen", annehmen) })
            }.onFailure { fehler.value = "Dienstreise konnte nicht gespeichert werden: ${it.message}" }
            laden()
        }
    }

    /** "Dienstreise beenden": true, wenn gespeichert. */
    suspend fun beenden(reise: FahrerDienstreise): Boolean {
        val ok = runCatching {
            Backend.client.postgrest.rpc("dienstreise_beenden", buildJsonObject { put("p_dienstreise", reise.id) })
        }.onFailure { fehler.value = "Konnte nicht gespeichert werden: ${it.message}" }.isSuccess
        laden()
        return ok
    }
}

// Masse aus DienstreiseKarte.jsx / dienstreise.js (REISE_KARTE 187, bei Anfrage 12 + 51 Knoepfe).
internal const val REISE_KARTE = 187f

/** Hoehe der Karte samt Knoepfen fuer das feste Raster der Fahrtenliste (reiseBlockHoehe). */
internal fun reiseBlockHoehe(r: FahrerDienstreise): Float = if (r.offen) REISE_KARTE + 12f + 51f else REISE_KARTE

private val DR_LIME = hex(0xE2F754)
private val DR_ETIKETT = hex(0xE3F754)

/**
 * Dienstreise in der Fahrtenliste (Entwurf 13.11.): sieht aus wie eine Fahrt. Lime-Etikett "Dienstreise"
 * mit Koffer, Kacheln Start (Zug/Flug) und Ziel, Startzeit gross, darunter Zug- bzw. Flugnummer.
 * Anfrage: Ablehnen/Annehmen darunter. Antippen oeffnet die Ansicht mit Karte (DienstreiseSeite).
 */
@Composable
internal fun DienstreiseKarte(reise: FahrerDienstreise, modifier: Modifier, oeffnen: () -> Unit) {
    val r = reise.r
    // Mit Umstiegen: Hauptzug (erster Fern-/Regionalzug oder Flug) und Zahl der Umstiege.
    val teile = reise.abschnitte
    val haupt = teile.firstOrNull { it.art == "zug" || it.art == "flug" } ?: teile.firstOrNull()
    val nummer = if (teile.size > 1) {
        val n = teile.size - 1
        listOfNotNull(haupt?.nummer?.ifBlank { null }, "$n ${if (n == 1) "Umstieg" else "Umstiege"}").joinToString(" · ")
    } else r.nummer
    val ersterIcon = teile.firstOrNull()?.let { DienstreiseAbschnitt.icon(it.art) } ?: r.startIcon
    Column(modifier.width(362.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Box(Modifier.size(362.dp, REISE_KARTE.dp).background(hex(0x1A1A1A)).border(2.dp, DR_ETIKETT).tippen(oeffnen)) {
            // Etikett oben mittig (top -2), mind. 90 breit, 29 hoch, Koffer daneben.
            Box(Modifier.platz(0f, -2f, 362f, 29f), contentAlignment = Alignment.TopCenter) {
                Row(
                    Modifier.height(29.dp).widthIn(min = 90.dp).background(DR_ETIKETT).padding(horizontal = 10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterHorizontally),
                ) {
                    Text("Dienstreise", style = grotesk(18f, 700, zeilenHoehe = 18f, abstand = -0.5f, farbe = Color.Black), maxLines = 1)
                    Icon("Rollkoffer_Trisar_Icons_01", Modifier.size(18.dp))
                }
            }
            Box(Modifier.platz(31f, 40f, 70f, 70f).background(hex(0x242525), RoundedCornerShape(12.dp)), contentAlignment = Alignment.Center) {
                Icon(ersterIcon, Modifier.size(30.dp))
            }
            Box(Modifier.platz(254f, 40f, 70f, 70f).background(hex(0x242525), RoundedCornerShape(12.dp)), contentAlignment = Alignment.Center) {
                Icon(r.zielIcon, Modifier.size(30.dp))
            }
            Text("START", style = grotesk(10f, 700, abstand = -0.5f, farbe = hex(0x868786)), textAlign = TextAlign.Center,
                modifier = Modifier.mittig(181f, 45f, 60f))
            Box(Modifier.mittig(181f, 60f, 100f, 30f), contentAlignment = Alignment.Center) {
                Text(r.zeit, style = grotesk(30f, 700, zeilenHoehe = 30f, abstand = -0.5f, farbe = DR_LIME), maxLines = 1, softWrap = false)
            }
            if (nummer.isNotEmpty()) {
                Text(nummer, style = grotesk(10f, abstand = -0.5f, farbe = hex(0xF4F5F4).copy(alpha = 0.5f)), textAlign = TextAlign.Center,
                    maxLines = 1, modifier = Modifier.mittig(181f, 93f, 90f))
            }
            // Orte: links 20, rechts 19, Spalten 1fr | 29 | 1fr mit 18 Abstand, ab 125.
            Row(Modifier.platz(20f, 125f, 362f - 20f - 19f), verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(18.dp)) {
                Text(r.start_name, style = grotesk(16f, 700, zeilenHoehe = 20f, abstand = -0.5f), textAlign = TextAlign.Start, modifier = Modifier.weight(1f))
                Icon("Arrow_Trisar_Icons_01_Lime", Modifier.size(29.dp, 20.dp).scale(1.15f))
                Text(r.ziel_name, style = grotesk(16f, 700, zeilenHoehe = 20f, abstand = -0.5f), textAlign = TextAlign.End, modifier = Modifier.weight(1f))
            }
        }
        if (reise.offen) {
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Box(Modifier.size(178.dp, 51.dp).border(2.dp, hex(0xFF6F63)).tippen { DienstreiseSpeicher.antworten(reise, false) }, contentAlignment = Alignment.Center) {
                    Text("Ablehnen", style = grotesk(24f, 700, zeilenHoehe = 24f, abstand = -0.5f, farbe = hex(0xFF6F63)))
                }
                Box(Modifier.size(178.dp, 51.dp).background(DR_ETIKETT).tippen { DienstreiseSpeicher.antworten(reise, true) }, contentAlignment = Alignment.Center) {
                    Text("Annehmen", style = grotesk(24f, 700, zeilenHoehe = 24f, abstand = -0.5f, farbe = Color.Black))
                }
            }
        }
    }
}
