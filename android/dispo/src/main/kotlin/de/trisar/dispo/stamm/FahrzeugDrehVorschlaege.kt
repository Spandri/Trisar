package de.trisar.dispo.stamm

import android.content.Context
import androidx.compose.foundation.background
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import coil3.compose.AsyncImage
import de.trisar.kern.DrehBilder
import de.trisar.kern.DrehInfo

/**
 * Modelle und Lacke, fuer die es eine 360-Grad-Ansicht gibt, aus dem Katalog der Fahrer-App
 * (DrehInfo im kern: vom Server fahrer.trisar.de/fahrzeug-dreh, gemerkt, Rueckfall assets), wie
 * admin/src/shared/fahrzeugDreh.js. Beim Fahrzeug anlegen/bearbeiten als Vorschlaege fuer Marke & Modell
 * und Farbe. Passen brand_model und color, nimmt die Fahrer-App die Bilderreihe.
 * In Compose aufgerufen, rechnen alle Funktionen neu, sobald der Katalog vom Server da ist.
 */
internal object FahrzeugDrehVorschlaege {
    data class Lack(val code: String, val name: String, val hex: Long)
    class Modell(val id: String, val name: String, val modell: List<String>, val farben: List<Pair<String, String>>, val lackliste: List<Lack>)

    // umgewandelte Liste je Katalog-Stand
    @Volatile private var zuletzt: Pair<DrehInfo, List<Modell>>? = null

    fun modelle(ctx: Context): List<Modell> {
        val info = DrehInfo.laden(ctx) ?: return emptyList()
        zuletzt?.let { (von, liste) -> if (von === info) return liste }
        val liste = info.modelle.map { m ->
            Modell(
                id = m.id, name = m.name, modell = m.modell, farben = m.farben,
                lackliste = m.lackliste.map { Lack(it.code, it.name, it.hex.removePrefix("#").toLongOrNull(16) ?: 0L) },
            )
        }
        zuletzt = info to liste
        return liste
    }

    /** klein, Umlaute ausgeschrieben, nur Buchstaben und Ziffern: "V-Klasse 250 d" -> "vklasse250d" */
    fun glatt(s: String) = de.trisar.kern.DrehSatz.glatt(s)

    /** Modell mit dem laengsten passenden Modellwort (gleiche Regel wie in der Fahrer-App). */
    fun modell(ctx: Context, markeModell: String): Modell? {
        val treffer = DrehInfo.laden(ctx)?.modellZu(markeModell) ?: return null
        return modelle(ctx).firstOrNull { it.id == treffer.id }
    }

    /** Lack, zu dem die Farbe gehoert (gleiche Regel wie in der Fahrer-App). */
    fun lack(ctx: Context, markeModell: String, farbe: String): Lack? {
        val m = DrehInfo.laden(ctx)?.modellZu(markeModell) ?: return null
        val code = m.lackZu(farbe) ?: return null
        return modell(ctx, markeModell)?.lackliste?.firstOrNull { it.code == code }
    }

    /** Jedes Wort der Eingabe kommt im Namen vor. Leere Eingabe: alle. */
    fun modellVorschlaege(ctx: Context, eingabe: String): List<String> {
        val woerter = eingabe.split(Regex("\\s+")).map(::glatt).filter { it.isNotEmpty() }
        return modelle(ctx).map { it.name }.filter { name -> woerter.all { glatt(name).contains(it) } && name != eingabe.trim() }
    }

    /** Nur wenn das Modell bekannt ist, dann dessen Lacke. */
    fun farbVorschlaege(ctx: Context, markeModell: String, eingabe: String): List<Lack> {
        val m = modell(ctx, markeModell) ?: return emptyList()
        val e = glatt(eingabe)
        return m.lackliste.filter { (e.isEmpty() || glatt(it.name).contains(e)) && it.name != eingabe.trim() }
    }

    /** Adresse des Seitenbilds (Front nach rechts) zu Modell und Lack, null wenn es keins gibt. */
    fun seitenBildAdresse(ctx: Context, markeModell: String, farbe: String): String? {
        val m = DrehInfo.laden(ctx)?.modellZu(markeModell) ?: return null
        val code = m.lackZu(farbe) ?: return null
        return "${DrehInfo.SERVER}${m.id}-$code-seite.webp"
    }
}

/**
 * Seitenbild des passenden Lacks fuer Fahrzeugliste und Fahrzeug bearbeiten, vom Server mit Festplatten-Cache.
 * Gibt es keins oder laedt es nicht (z. B. ohne Netz), steht dort ersatz (hochgeladenes Bild) mit demselben Platz.
 */
@Composable
internal fun FahrzeugSeitenBild(
    markeModell: String,
    farbe: String,
    modifier: Modifier,
    hintergrund: Color = Color.Transparent,
    ersatz: @Composable () -> Unit = {},
) {
    val ctx = LocalContext.current
    val adresse = FahrzeugDrehVorschlaege.seitenBildAdresse(ctx, markeModell, farbe)
    var kaputt by remember(adresse) { mutableStateOf(false) }
    if (adresse == null || kaputt) {
        ersatz()
        return
    }
    AsyncImage(
        model = adresse,
        contentDescription = null,
        imageLoader = DrehBilder.lader(ctx),
        modifier = modifier.background(hintergrund),
        contentScale = ContentScale.Fit,
        onError = { kaputt = true },
    )
}
