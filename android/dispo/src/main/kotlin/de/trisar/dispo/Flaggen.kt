package de.trisar.dispo

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import de.trisar.kern.Backend
import de.trisar.kern.Icon
import de.trisar.kern.tippen
import io.github.jan.supabase.postgrest.from
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject

/**
 * Flaggen an Fahrern, wie admin/src/shared/flaggen.js (Figma Koordinator_Screen_Map 2832:12528):
 * drei Flaggen in Cyan, Violett und Koenigsblau. Die Dispo waehlt Fahrer aus (Karte oder Alle Fahrer)
 * und tippt eine Flagge an. Sie fuellt sich, sobald alle Ausgewaehlten sie tragen, erneut tippen nimmt sie weg.
 * Gespeichert in profiles.flagge (flagge1 bis flagge3), hoechstens eine Flagge je Fahrer.
 */
internal object Flaggen {
    data class Eintrag(val id: String, val name: String, val umriss: String, val voll: String)

    val alle = listOf(
        Eintrag("flagge1", "Flagge 1 (Cyan)", "Flagge_1", "Flagge_1_Voll"),
        Eintrag("flagge2", "Flagge 2 (Violett)", "Flagge_2", "Flagge_2_Voll"),
        Eintrag("flagge3", "Flagge 3 (Königsblau)", "Flagge_3", "Flagge_3_Voll"),
    )
    const val KREIS = "Flagge_Kreis"

    fun nachID(wert: String?): Eintrag? {
        val id = wert.orEmpty().trim().lowercase()
        return alle.firstOrNull { it.id == id }
    }

    fun id(wert: String?): String? = nachID(wert)?.id

    /** Gefuellt, wenn jeder Ausgewaehlte diese Flagge hat. */
    fun alleHaben(ids: List<String>, flaggeVon: (String) -> String?, flagge: String): Boolean =
        ids.isNotEmpty() && ids.all { flaggeVon(it) == flagge }

    /** Setzt (flagge = id) oder entfernt (null) die Flagge bei den Fahrern. Gibt eine Fehlermeldung oder null zurueck. */
    suspend fun setzen(ids: List<String>, flagge: String?): String? {
        val liste = ids.map { it.trim() }.filter { it.isNotEmpty() }.distinct()
        if (liste.isEmpty()) return "Kein Fahrer ausgewählt."
        return try {
            // null muss als null in die Datenbank, sonst bliebe die Flagge stehen.
            Backend.client.from("profiles").update(buildJsonObject {
                put("flagge", id(flagge)?.let { JsonPrimitive(it) } ?: JsonNull)
            }) { filter { isIn("id", liste) } }
            null
        } catch (e: kotlinx.coroutines.CancellationException) {
            throw e
        } catch (e: Exception) {
            e.message ?: "Speichern hat nicht geklappt."
        }
    }
}

/**
 * Drei Flaggen-Knoepfe (Filter_Map_Icon 35 x 35 mit Flagge 14 x 18). Umriss = noch nicht bei allen
 * Ausgewaehlten, gefuellt = alle tragen diese Flagge.
 */
@Composable
internal fun FlaggenKnoepfe(
    ids: List<String>,
    flaggeVon: (String) -> String?,
    wahl: (String?) -> Unit,
    modifier: Modifier = Modifier,
    waagerecht: Boolean = false,
    /** Filtermodus: nur diese Flaggen zeigen, gefuellt ist die aktive. */
    nur: List<String>? = null,
    aktiv: Set<String> = emptySet(),
    filtern: Boolean = false,
) {
    val knoepfe: @Composable () -> Unit = {
        for (f in Flaggen.alle.filter { nur == null || it.id in nur }) {
            val gefuellt = if (filtern) f.id in aktiv else Flaggen.alleHaben(ids, flaggeVon, f.id)
            Box(
                Modifier.size(35.dp).semantics { contentDescription = f.name }.tippen { wahl(if (filtern || !gefuellt) f.id else null) },
                contentAlignment = Alignment.Center,
            ) {
                Icon(Flaggen.KREIS, Modifier.size(35.dp))
                Icon(if (gefuellt) f.voll else f.umriss, Modifier.size(14.dp, 18.dp))
            }
        }
    }
    if (waagerecht) Row(modifier, horizontalArrangement = Arrangement.spacedBy(8.dp)) { knoepfe() }
    else Column(modifier, verticalArrangement = Arrangement.spacedBy(3.dp)) { knoepfe() }
}

/** Flagge mit duenner schwarzer Umrandung (schwarze Kopie knapp hinter der Flagge), fuer Lasche und Marker. */
@Composable
internal fun FlaggeMitRand(flagge: String, breite: Dp = 14.dp, hoehe: Dp = 18.dp, modifier: Modifier = Modifier) {
    val f = Flaggen.nachID(flagge) ?: return
    val rand = 0.8.dp
    Box(modifier.size(breite + rand * 2, hoehe + rand * 2)) {
        Icon(f.voll, Modifier.size(breite + rand * 2, hoehe + rand * 2), farbe = ColorFilter.tint(Color.Black))
        Icon(f.voll, Modifier.offset(rand, rand).size(breite, hoehe))
    }
}
