package de.trisar.dispo.stamm

import android.content.Context
import android.graphics.BitmapFactory
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import org.json.JSONArray
import org.json.JSONObject

/**
 * Modelle und Lacke, fuer die die Fahrer-App eine 360-Grad-Ansicht hat (assets/fahrzeug-dreh/fahrzeug-dreh.json,
 * erzeugt mit werkzeuge/fahrzeugbilder/dreh-einbauen.py), wie admin/src/shared/fahrzeugDreh.js.
 * Beim Fahrzeug anlegen/bearbeiten als Vorschlaege fuer Marke & Modell und Farbe. Passen brand_model
 * und color, nimmt die Fahrer-App die Bilderreihe.
 */
internal object FahrzeugDrehVorschlaege {
    data class Lack(val code: String, val name: String, val hex: Long)
    class Modell(val id: String, val name: String, val modell: List<String>, val farben: List<Pair<String, String>>, val lackliste: List<Lack>)

    @Volatile private var modelle: List<Modell>? = null

    fun modelle(ctx: Context): List<Modell> {
        modelle?.let { return it }
        val geladen = runCatching {
            val j = JSONObject(ctx.assets.open("fahrzeug-dreh/fahrzeug-dreh.json").bufferedReader().use { it.readText() })
            fun liste(a: JSONArray) = List(a.length()) { a.getString(it) }
            val m = j.getJSONArray("modelle")
            List(m.length()) { i ->
                val o = m.getJSONObject(i)
                val f = o.getJSONArray("farben")
                val l = o.getJSONArray("lackliste")
                Modell(
                    id = o.getString("id"),
                    name = o.getString("name"),
                    modell = liste(o.getJSONArray("modell")),
                    farben = List(f.length()) { k -> f.getJSONArray(k).let { it.getString(0) to it.getString(1) } },
                    lackliste = List(l.length()) { k ->
                        l.getJSONObject(k).let { Lack(it.getString("code"), it.getString("name"), it.getString("hex").removePrefix("#").toLong(16)) }
                    },
                )
            }
        }.getOrDefault(emptyList())
        modelle = geladen
        return geladen
    }

    /** klein, Umlaute ausgeschrieben, nur Buchstaben und Ziffern: "V-Klasse 250 d" -> "vklasse250d" */
    fun glatt(s: String) = s.lowercase()
        .replace("ä", "ae").replace("ö", "oe").replace("ü", "ue").replace("ß", "ss")
        .filter { it in 'a'..'z' || it in '0'..'9' }

    fun modell(ctx: Context, markeModell: String): Modell? {
        val m = glatt(markeModell)
        if (m.isEmpty()) return null
        return modelle(ctx).firstOrNull { x -> x.modell.any { m.contains(it) } }
    }

    /** Lack, zu dem die Farbe gehoert (gleiche Regel wie in der Fahrer-App). */
    fun lack(ctx: Context, markeModell: String, farbe: String): Lack? {
        val m = modell(ctx, markeModell) ?: return null
        val f = glatt(farbe)
        if (f.isEmpty()) return null
        val treffer = m.farben.firstOrNull { f.contains(it.first) } ?: return null
        return m.lackliste.firstOrNull { it.code == treffer.second }
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

    /** Seitenbild (Front nach rechts) des passenden Lacks fuer Fahrzeugliste und Fahrzeug bearbeiten. */
    private val seiten = mutableMapOf<String, ImageBitmap?>()
    fun seitenBild(ctx: Context, markeModell: String, farbe: String): ImageBitmap? {
        val m = modell(ctx, markeModell) ?: return null
        val l = lack(ctx, markeModell, farbe) ?: return null
        val datei = "fahrzeug-dreh/${m.id}-${l.code}-seite.webp"
        return seiten.getOrPut(datei) {
            runCatching { ctx.assets.open(datei).use { BitmapFactory.decodeStream(it)?.asImageBitmap() } }.getOrNull()
        }
    }
}
