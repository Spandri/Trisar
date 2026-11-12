package de.trisar.fahrer.haupt

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import de.trisar.kern.Backend
import de.trisar.kern.Icon
import de.trisar.kern.grotesk
import de.trisar.kern.hex
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
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId

/**
 * Standby am Event-Ort in der Fahrer-App (fahrer/src/shared/standby.js, StandbyKarte.jsx).
 * Tabellen standby, standby_fahrer, Funktionen standby_antworten und standby_melden.
 */
@Serializable
data class StandbyZeile(
    val standby_id: String,
    val status: String = "pending",
    val zustand: String? = null,
    val zustand_seit: String? = null,
    val von_eigen: String? = null,
    val bis_eigen: String? = null,
)

@Serializable
data class StandbyKopf(
    val id: String,
    val datum: String,
    val von: String,
    val bis: String,
    val ort_name: String = "",
    val adresse: String? = null,
)

/** Eigener Standby: Zeile des Fahrers mit dem Standby dazu. */
data class FahrerStandby(val z: StandbyZeile, val s: StandbyKopf) {
    val id get() = s.id
    val offen get() = z.status == "pending"
    val von get() = (z.von_eigen ?: s.von).take(5)
    val bis get() = (z.bis_eigen ?: s.bis).take(5)

    /** Ende fuer den Fahrer: eigene Zeiten nach abgelehnter Aenderung, Nacht ueber Mitternacht. */
    val ende: Instant get() {
        val tag = runCatching { LocalDate.parse(s.datum.take(10)) }.getOrElse { LocalDate.now() }
        val b = runCatching { LocalTime.parse(bis) }.getOrElse { LocalTime.MIDNIGHT }
        val v = runCatching { LocalTime.parse(von) }.getOrElse { LocalTime.MIDNIGHT }
        val d = if (!b.isAfter(v)) tag.plusDays(1) else tag
        return d.atTime(b).atZone(BERLIN).toInstant()
    }
    val beginn: Instant get() {
        val tag = runCatching { LocalDate.parse(s.datum.take(10)) }.getOrElse { LocalDate.now() }
        val v = runCatching { LocalTime.parse(von) }.getOrElse { LocalTime.MIDNIGHT }
        return tag.atTime(v).atZone(BERLIN).toInstant()
    }
    val vorbei get() = !ende.isAfter(Instant.now())

    companion object { val BERLIN: ZoneId = ZoneId.of("Europe/Berlin") }
}

/** Eigene Standbys (angefragt oder angenommen, Ende nicht laenger als 2 h vorbei), live. */
object StandbySpeicher {
    val liste = MutableStateFlow<List<FahrerStandby>>(emptyList())
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
        val k = Backend.client.channel("fahrer-standby-$id-${System.currentTimeMillis()}")
        val eigene = k.postgresChangeFlow<PostgresAction>(schema = "public") {
            table = "standby_fahrer"; filter("driver_id", FilterOperator.EQ, id)
        }
        val standbys = k.postgresChangeFlow<PostgresAction>(schema = "public") { table = "standby" }
        kanal = k
        auftraege += bereich.launch { eigene.collect { laden() } }
        auftraege += bereich.launch { standbys.collect { a -> if (a is PostgresAction.Update) laden() } }
        auftraege += bereich.launch { runCatching { k.subscribe() } }
    }

    suspend fun laden() {
        val id = fahrerID ?: return
        runCatching {
            val zeilen = Backend.client.from("standby_fahrer").select(Columns.raw("standby_id, status, zustand, zustand_seit, von_eigen, bis_eigen")) {
                filter { eq("driver_id", id); isIn("status", listOf("pending", "accepted")) }
            }.decodeList<StandbyZeile>()
            val ids = zeilen.map { it.standby_id }
            val koepfe = if (ids.isEmpty()) emptyList() else Backend.client.from("standby").select(Columns.raw("id, datum, von, bis, ort_name, adresse")) {
                filter { isIn("id", ids) }
            }.decodeList<StandbyKopf>()
            val je = koepfe.associateBy { it.id }
            val grenze = Instant.now().minusSeconds(2 * 3600)
            zeilen.mapNotNull { z -> je[z.standby_id]?.let { FahrerStandby(z, it) } }
                .filter { it.ende.isAfter(grenze) }
                .sortedBy { it.beginn }
        }.onSuccess { if (fahrerID == id) liste.value = it }
    }

    fun antworten(standby: FahrerStandby, annehmen: Boolean) {
        bereich.launch {
            runCatching {
                Backend.client.postgrest.rpc("standby_antworten", buildJsonObject { put("p_standby", standby.id); put("p_annehmen", annehmen) })
            }.onFailure { fehler.value = "Standby konnte nicht gespeichert werden: ${it.message}" }
            laden()
        }
    }

    /** gast_drin, abgesetzt, zurueck. Sofort anzeigen, die Datenbank bestaetigt per Realtime. */
    fun melden(standby: FahrerStandby, art: String) {
        val neu = mapOf("gast_drin" to "mit_gast", "abgesetzt" to "rueckweg", "zurueck" to "vor_ort")[art]
        liste.value = liste.value.map {
            if (it.id == standby.id) it.copy(z = it.z.copy(zustand = neu, zustand_seit = Instant.now().toString())) else it
        }
        bereich.launch {
            runCatching {
                Backend.client.postgrest.rpc("standby_melden", buildJsonObject { put("p_standby", standby.id); put("p_art", art) })
            }.onFailure { fehler.value = "Konnte nicht gespeichert werden: ${it.message}" }
            laden()
        }
    }
}

// Masse aus StandbyKarte.jsx / standby.js (STANDBY_KARTE 198, Zeile "mit Gast" 37).
internal const val STANDBY_KARTE = 198f
private const val STANDBY_ZUSTAND_ZEILE = 37f

/** Hoehe der Karte samt Knoepfen fuer das feste Raster der Fahrtenliste (standbyBlockHoehe). */
internal fun standbyBlockHoehe(s: FahrerStandby): Float = when {
    s.offen -> STANDBY_KARTE + 12f + 51f
    s.vorbei -> STANDBY_KARTE
    s.z.zustand == "mit_gast" -> STANDBY_KARTE + STANDBY_ZUSTAND_ZEILE + 12f + 56f
    s.z.zustand == "vor_ort" -> STANDBY_KARTE + 12f + 56f
    s.z.zustand == "rueckweg" -> STANDBY_KARTE + 12f + 51f
    else -> STANDBY_KARTE
}

private val SB_LIME = hex(0xE3F654)
private val SB_ROT = hex(0xFF6F63)
private val SB_ORANGE = hex(0xFFCD8A)
private val SB_GRAU = hex(0x868687)

private fun uhrVon(iso: String?): String = runCatching {
    Instant.parse(iso!!).atZone(FahrerStandby.BERLIN).toLocalTime().let { "%02d:%02d".format(it.hour, it.minute) }
}.getOrElse {
    // Postgres liefert "2026-11-12 18:03:00+00", nicht ISO mit T.
    runCatching { java.time.OffsetDateTime.parse(iso!!.replace(" ", "T")).atZoneSameInstant(FahrerStandby.BERLIN).toLocalTime().let { "%02d:%02d".format(it.hour, it.minute) } }.getOrDefault("")
}

/**
 * Standby-Karte (Entwurf 12.11.): Lime-Etikett "Standby", Ort, Zeitfenster. Zustaende: Anfrage
 * (Ablehnen/Annehmen), angenommen, vor Ort (Gast drin), mit Gast (Gast abgesetzt), Rueckweg
 * (Mit Gast | Bei Standby), vorbei (grauer Rand).
 */
@Composable
internal fun StandbyKarte(standby: FahrerStandby, modifier: Modifier) {
    val offen = standby.offen
    val vorbei = !offen && standby.vorbei
    val z = standby.z.zustand
    val rand = when {
        offen -> Color.Transparent
        vorbei -> SB_GRAU
        z == "mit_gast" -> SB_ORANGE
        else -> SB_LIME
    }

    @Composable
    fun grosserKnopf(text: String, farbe: Color, aktion: () -> Unit) {
        Row(
            Modifier.size(362.dp, 56.dp).background(farbe).tippen(aktion).padding(start = 18.dp, end = 16.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(text, style = grotesk(22f, 700, farbe = Color.Black))
            Spacer(Modifier.weight(1f))
            Icon("Arrow_Trisar_Icons_01", Modifier.size(34.dp, 19.dp))
        }
    }

    @Composable
    fun knopfPaar(links: String, rechts: String, linksAktion: () -> Unit, rechtsAktion: () -> Unit) {
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            Box(Modifier.size(178.dp, 51.dp).border(2.dp, SB_ROT).tippen(linksAktion), contentAlignment = Alignment.Center) {
                Text(links, style = grotesk(24f, 700, zeilenHoehe = 24f, abstand = -0.5f, farbe = SB_ROT))
            }
            Box(Modifier.size(178.dp, 51.dp).background(hex(0xE3F754)).tippen(rechtsAktion), contentAlignment = Alignment.Center) {
                Text(rechts, style = grotesk(24f, 700, zeilenHoehe = 24f, abstand = -0.5f, farbe = Color.Black))
            }
        }
    }

    Column(modifier.width(362.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Box(Modifier.width(362.dp).heightIn(min = STANDBY_KARTE.dp).background(hex(0x1A1A1A)).border(2.dp, rand)) {
            Column(Modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, top = 54.dp, bottom = 20.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                    Box(Modifier.size(64.dp).background(hex(0x242525), RoundedCornerShape(16.dp)), contentAlignment = Alignment.Center) {
                        Icon("Pin_Nav_Trisar_Icons_01_grau", Modifier.size(30.dp))
                    }
                    Column {
                        Text(standby.s.ort_name, style = grotesk(24f, 700, zeilenHoehe = 26f, farbe = Color.White), maxLines = 1, overflow = TextOverflow.Ellipsis)
                        val adresse = standby.s.adresse
                        if (!adresse.isNullOrBlank() && adresse != standby.s.ort_name) {
                            Text(adresse, style = grotesk(15f, 700, farbe = SB_GRAU), maxLines = 1, overflow = TextOverflow.Ellipsis)
                        }
                    }
                }
                Text("${standby.von} – ${standby.bis}", style = grotesk(38f, 700, zeilenHoehe = 38f, farbe = SB_LIME), modifier = Modifier.padding(top = 18.dp))
                if (!offen && !vorbei && z == "mit_gast") {
                    Text("Mit Gast unterwegs seit ${uhrVon(standby.z.zustand_seit)}", style = grotesk(18f, 700, farbe = SB_ORANGE),
                        modifier = Modifier.padding(top = 14.dp))
                }
            }
            Box(Modifier.align(Alignment.TopCenter).height(34.dp).background(SB_LIME).padding(horizontal = 16.dp), contentAlignment = Alignment.Center) {
                Text("Standby", style = grotesk(18f, 700, farbe = Color.Black))
            }
        }

        val sp = StandbySpeicher
        when {
            offen -> knopfPaar("Ablehnen", "Annehmen", { sp.antworten(standby, false) }, { sp.antworten(standby, true) })
            vorbei -> {}
            z == "vor_ort" -> grosserKnopf("Gast drin", SB_LIME) { sp.melden(standby, "gast_drin") }
            z == "mit_gast" -> grosserKnopf("Gast abgesetzt", SB_ORANGE) { sp.melden(standby, "abgesetzt") }
            z == "rueckweg" -> knopfPaar("Mit Gast", "Bei Standby", { sp.melden(standby, "gast_drin") }, { sp.melden(standby, "zurueck") })
        }
    }
}
