package de.trisar.dispo

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import de.trisar.kern.Backend
import de.trisar.kern.Icon
import de.trisar.kern.grotesk
import de.trisar.kern.hex
import de.trisar.kern.tippen
import io.github.jan.supabase.postgrest.from
import io.github.jan.supabase.postgrest.query.Columns
import kotlinx.coroutines.delay
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/**
 * Mehrfachauswahl von Fahrern (Kaestchen oben rechts auf der Karte), wie admin/src/shared/fahrerMarkierung.js.
 * Einmal markiert, gilt die Auswahl in der ganzen Dispo:
 *   Karte          markierte Fahrer normal, alle anderen blass
 *   Alle Fahrer    dieselben Fahrer ausgewaehlt
 *   Fahrzeuge      die Fahrzeuge dieser Fahrer markiert
 *   Fahrten        nur Fahrten dieser Fahrer
 *   Fahrt anlegen  diese Fahrer schon eingetragen
 *   KI-Assistent   Vermerk ueber der Eingabe, Fragen beziehen sich auf sie
 * Der Stand gilt fuer die laufende App (sessionStorage im Web).
 */
internal object FahrerMarkierung {
    data class Eintrag(val id: String, val name: String = "", val vehicleId: String = "")

    var aktiv by mutableStateOf(false)
        private set
    var fahrer by mutableStateOf<List<Eintrag>>(emptyList())
        private set
    /** Kommt die Auswahl vom Flaggenfilter der Karte, stehen hier die Flaggen (flagge1 bis flagge3). */
    var flaggen by mutableStateOf<List<String>>(emptyList())
        private set

    private fun normal(e: Eintrag) = Eintrag(e.id.trim(), e.name.trim(), e.vehicleId.trim())

    private fun setzen(neuAktiv: Boolean, neu: List<Eintrag>, neueFlaggen: List<String> = emptyList()) {
        aktiv = neuAktiv
        flaggen = neueFlaggen
        fahrer = neu.map(::normal).filter { it.id.isNotEmpty() }.distinctBy { it.id }
    }

    val ids: List<String> get() = fahrer.map { it.id }

    /** Nur wenn der Modus an ist und jemand markiert ist, wirkt die Auswahl in den anderen Ansichten. */
    val wirkt: Boolean get() = aktiv && fahrer.isNotEmpty()

    fun modusSetzen(an: Boolean) = setzen(an, if (an) fahrer else emptyList())

    fun umschalten(e: Eintrag) {
        val id = e.id.trim()
        if (id.isEmpty()) return
        val drin = fahrer.any { it.id == id }
        setzen(true, if (drin) fahrer.filter { it.id != id } else fahrer + e)
    }

    /** Ganze Liste ersetzen (z. B. Auswahl in Alle Fahrer). Leere Liste laesst den Modus an. */
    fun ersetzen(neu: List<Eintrag>) = setzen(aktiv || neu.isNotEmpty(), neu)

    /** Namen und Fahrzeuge nachtragen, sobald eine Ansicht die Fahrerdaten kennt. */
    fun ergaenzen(liste: List<Eintrag>) {
        val nachID = liste.associateBy { it.id.trim() }
        var geaendert = false
        val neu = fahrer.map { f ->
            val n = nachID[f.id] ?: return@map f
            val name = n.name.trim().ifEmpty { f.name }
            val fz = n.vehicleId.trim().ifEmpty { f.vehicleId }
            if (name == f.name && fz == f.vehicleId) f else { geaendert = true; f.copy(name = name, vehicleId = fz) }
        }
        if (geaendert) setzen(aktiv, neu, flaggen)
    }

    /** Flaggen als Auswahl (Flaggenfilter auf der Karte): alle Fahrer mit diesen Flaggen gelten als markiert. */
    fun flaggenSetzen(ids: List<String>, liste: List<Eintrag>) {
        if (ids.isEmpty()) {
            if (flaggen.isNotEmpty()) setzen(false, emptyList())
            return
        }
        setzen(true, liste, ids)
    }

    fun leeren() = setzen(false, emptyList())

    /** Alle Profile mit diesen Flaggen (auch ohne Standort auf der Karte), null bei Fehler. */
    suspend fun mitFlaggenLaden(flaggen: List<String>): List<Eintrag>? {
        if (flaggen.isEmpty()) return emptyList()
        val zeilen = runCatching {
            Backend.client.from("profiles").select(Columns.raw("id, first_name, last_name, vehicle_id, flagge")) {
                filter { isIn("flagge", flaggen) }
            }.decodeList<JsonObject>()
        }.getOrNull() ?: return null
        fun t(o: JsonObject, k: String) = (o[k] as? JsonPrimitive)?.takeIf { it.isString || it.content != "null" }?.content.orEmpty()
        return zeilen.map { o ->
            Eintrag(t(o, "id"), listOf(t(o, "first_name"), t(o, "last_name")).filter { it.isNotBlank() }.joinToString(" ").trim(), t(o, "vehicle_id"))
        }.filter { it.id.isNotEmpty() }
    }

    /** Fahrzeuge der markierten Fahrer (profiles.vehicle_id), traegt sie auch in die Markierung ein. */
    suspend fun fahrzeugIDsLaden(): Set<String> {
        val ids = ids
        if (ids.isEmpty()) return emptySet()
        val zeilen = runCatching {
            Backend.client.from("profiles").select(Columns.raw("id, vehicle_id")) { filter { isIn("id", ids) } }.decodeList<JsonObject>()
        }.getOrNull() ?: return fahrer.map { it.vehicleId }.filter { it.isNotEmpty() }.toSet()
        fun t(o: JsonObject, k: String) = (o[k] as? JsonPrimitive)?.takeIf { it.isString || it.content != "null" }?.content.orEmpty()
        val neu = zeilen.map { Eintrag(t(it, "id"), "", t(it, "vehicle_id")) }
        ergaenzen(neu)
        return neu.map { it.vehicleId }.filter { it.isNotEmpty() }.toSet()
    }
}

/** Erklaertext der Mehrfachauswahl (i18n auswahl.erklaerung), "**...**" = fett. */
internal const val AUSWAHL_ERKLAERUNG = "**Mehrere Fahrer auswählen**\nTippe die Fahrer auf der Karte an, die du zusammen bearbeiten willst. Sie bleiben hell, alle anderen werden blass.\n\nDie Auswahl gilt dann überall: in **Alle Fahrer**, bei den **Fahrzeugen**, in den **Fahrten**, bei **Fahrt hinzufügen** und im **KI-Assistenten**.\n\nNochmal auf das **Kästchen** tippen hebt alles auf."

/**
 * Vermerk "3 Fahrer markiert  Name, Name" wie MarkierungsVermerk.jsx: dunkles Feld 44 hoch, Haken in Lime,
 * Namen gekuerzt, X hebt die Auswahl auf. Erscheint nur, wenn die Auswahl wirkt.
 */
@Composable
internal fun MarkierungsVermerk(modifier: Modifier = Modifier, text: String? = null) {
    val m = FahrerMarkierung
    if (!m.wirkt) return
    // Kommt die Auswahl von Flaggen, zeigt der Vermerk die Flaggen statt aller Namen.
    val namen = if (m.flaggen.isNotEmpty()) "" else m.fahrer.map { it.name }.filter { it.isNotEmpty() }.joinToString(", ")
    val form = RoundedCornerShape(12.dp)
    Row(
        modifier.height(44.dp).background(hex(0x242525), form).border(1.dp, hex(0x3A3A3A), form).padding(start = 12.dp, end = 6.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Icon("Auswahl_Haken_Lime", Modifier.size(16.dp, 18.dp))
        Text(
            buildAnnotatedString {
                withStyle(SpanStyle(fontWeight = FontWeight(700), color = Color.White)) { append(text ?: "${m.fahrer.size} Fahrer markiert") }
                if (namen.isNotEmpty()) append("  $namen")
            },
            style = grotesk(14f, 400, 18f, farbe = Color.White.copy(alpha = 0.8f)),
            maxLines = 1, softWrap = false, overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f),
        )
        for (id in m.flaggen) FlaggeMitRand(id)
        Box(Modifier.size(32.dp).tippen { m.modusSetzen(false) }, contentAlignment = Alignment.Center) {
            Text("×", style = grotesk(20f, 400, farbe = Color.White.copy(alpha = 0.7f)))
        }
    }
}

/**
 * Kurzer Erklaertext beim Einschalten der Mehrfachauswahl (AuswahlErklaerung.jsx): Karte dahinter
 * fast schwarz, Text mittig, fett und normal gemischt. Verschwindet nach 6 s oder beim Antippen.
 */
@Composable
internal fun AuswahlErklaerung(fertig: () -> Unit) {
    val fertigAktuell by rememberUpdatedState(fertig)
    LaunchedEffect(Unit) {
        delay(6000)
        fertigAktuell()
    }
    Box(
        Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.8f)).tippen { fertigAktuell() }
            .padding(start = 57.dp, end = 57.dp, bottom = 107.dp),
        contentAlignment = Alignment.Center,
    ) {
        val teile = AUSWAHL_ERKLAERUNG.split("**")
        Text(
            buildAnnotatedString {
                teile.forEachIndexed { i, t ->
                    if (i % 2 == 1) withStyle(SpanStyle(fontWeight = FontWeight(700), color = Color.White)) { append(t) } else append(t)
                }
            },
            style = grotesk(16f, 400, 24f, 0.5f, Color.White.copy(alpha = 0.85f)),
            textAlign = TextAlign.Center,
            modifier = Modifier.width(287.dp),
        )
    }
}
