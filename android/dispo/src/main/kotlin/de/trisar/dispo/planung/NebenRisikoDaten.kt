package de.trisar.dispo.planung

import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.graphics.Color
import de.trisar.kern.hex
import kotlinx.serialization.Serializable
import kotlinx.serialization.Transient
import java.text.NumberFormat
import java.time.LocalDate
import java.time.LocalTime
import java.time.format.DateTimeFormatter
import java.time.temporal.ChronoUnit
import java.util.Locale
import kotlin.math.floor

// Risiko je Fahrt und Ereignisse eines Einsatztages (NebenRisikoDaten.swift, demo/risikoErgebnisse.js).
// Im Web gibt es die Werte nur in der Demo (vorab gerechnet, data/risiko-ergebnisse.json). Die App liest
// dieselbe Datei, wenn sie unter assets/planer liegt; live liegt sie nicht dort, dann zeigen die Seiten
// "keine Rechnung der Engine".

/** BISHER_PUFFER_MIN: pauschaler Puffer des bisherigen Planers. */
internal const val NEBEN_BISHER_PUFFER_MIN = 20

@Serializable internal data class NebenRisikoDatei(val tage: Map<String, NebenRisikoTag> = emptyMap())

@Serializable
internal data class NebenRisikoTag(
    val datum: String? = null, val name: String? = null, val verlaeufe: Int? = null,
    val ereignisse: List<NebenEreignis>? = null, val optionen: Map<String, NebenRisikoOption>? = null,
)

@Serializable
internal data class NebenRisikoOption(
    val puffer_mittel: Double? = null,
    val hoch: List<String> = emptyList(),
    val unter_bisher: Int? = null,
    val ueber_bisher: Int? = null,
    val verlauf: List<NebenStundenLuft> = emptyList(),
    val faecher: List<NebenFaecherStunde>? = null,
    val puenktlich_abholung: Double? = null,
    val knappste_stunde: Int? = null,
    val fahrten: Map<String, NebenRisikoFahrt> = emptyMap(),
)

@Serializable internal data class NebenStundenLuft(val h: Int, val luft_p10: Double? = null)

/** q: 19 Quantile 5 % … 95 %. */
@Serializable internal data class NebenFaecherStunde(val h: Int, val n: Int? = null, val p50: Double? = null, val spaet: Double? = null, val q: List<Double>? = null)

@Serializable
internal data class NebenRisikoFahrt(
    val fahrzeit: Fahrzeit? = null,
    val ursachen: List<Ursache>? = null,
    val ereignis: Ereignis? = null,
    val luft: Luft? = null,
    val fahrer: String? = null,
    val abfahrt: String? = null,
    val von: String? = null,
    val nach: String? = null,
    val klasse: String = "niedrig",
) {
    @Serializable data class Fahrzeit(val plan: Double? = null, val p10: Double? = null, val p50: Double, val p90: Double, val von: Double, val bis: Double, val hist: List<Double> = emptyList())
    @Serializable data class Ursache(val name: String, val anteil: Double, val bis_min: Double)
    @Serializable data class Ereignis(val name: String, val min: Double, val route: String? = null)
    @Serializable data class Luft(val puffer: Double, val folge_abfahrt: String? = null, val folge_puenktlich: Int? = null, val verlaeufe: Int? = null)
}

@Serializable internal data class NebenKachel(val name: String, val gross: String, val klein: String)

/** Ereignis eines Tages: automatisch gefunden (JSON) oder von der Disposition ergaenzt. */
@Serializable
internal data class NebenEreignis(
    val id: String,
    val art: String? = null,
    val titel: String,
    val kurz: String? = null,
    val zusatz: String? = null,
    val von: String? = null,
    val bis: String? = null,
    val zeit: String,
    val wirkung: String,
    val quelle: String,
    val fahrten: Int? = null,
    val kachel: NebenKachel? = null,
    /** Eingetippter Text bei eigenen Ereignissen. */
    val text: String? = null,
    /** "auto" oder "eigen" (quelleArt im Web). */
    @Transient val quelleArt: String = "auto",
    @Transient val angepasst: Boolean = false,
) {
    /** kachelWerte: Name, Zeitfenster gross, eine Zeile Wirkung. */
    val kachelWerte: NebenKachel
        get() {
            kachel?.let { return it }
            val gross = if (zeit == "ganztägig") "ganztags" else "${stunde(von)}–${stunde(bis, true)}"
            val plus = NebenRisiko.treffer("""\+(\d+)""", wirkung).firstOrNull() ?: "?"
            val n = fahrten ?: 0
            val klein = when (id) {
                "heimspiel" -> "A9 Nord · bis +$plus min"
                "messe" -> "Zufahrt Messe · bis +$plus min"
                "innenstadt" -> "Altstadt · bis +$plus min"
                "fluege" -> "$n Fahrten · Verspätung"
                "zuege" -> "$n ${if (n == 1) "Fahrt" else "Fahrten"} · Verspätung"
                "verkehr" -> "Muster je Stunde"
                else -> wirkung
            }
            return NebenKachel(kurz ?: titel, gross, klein)
        }

    private fun stunde(hhmm: String?, auf: Boolean = false): String {
        val teile = (hhmm ?: "").split(":").map { it.toIntOrNull() }
        val h = teile.firstOrNull() ?: return ""
        val m = if (teile.size > 1) teile[1] ?: 0 else 0
        val wert = if (auf && m > 0) h + 1 else h
        return zwei(if (wert % 24 == 0 && wert > 0) 24 else wert)
    }

    /** key im Web: id-zeit-wirkung, damit eine Karte nach dem Anpassen neu startet. */
    val schluessel: String get() = "$id-$zeit-$wirkung"
}

/** Aenderung eines automatischen Ereignisses (nur die gesetzten Felder zaehlen). */
internal data class NebenEreignisWerte(val von: String? = null, val bis: String? = null, val zeit: String? = null, val wirkung: String? = null)

/**
 * Daten laden und die Ereignis-Aenderungen der Disposition halten. Wie im Web nur im Speicher
 * (leben bis zum Beenden der App), nichts geht in die Datenbank.
 */
internal object NebenRisikoSpeicher {
    private data class TagAenderung(
        val entfernt: List<String> = emptyList(),
        val geaendert: Map<String, NebenEreignisWerte> = emptyMap(),
        val eigene: List<NebenEreignis> = emptyList(),
    )

    var daten: NebenRisikoDatei? = null
        private set
    private var aenderungen by mutableStateOf<Map<String, TagAenderung>>(emptyMap())
    private var geladen = false

    fun einrichten(ctx: Context) {
        if (geladen) return
        geladen = true
        daten = runCatching {
            val text = ctx.assets.open("planer/risiko-ergebnisse.json").bufferedReader().use { it.readText() }
            planJson.decodeFromString(NebenRisikoDatei.serializer(), text)
        }.getOrNull()
    }

    /** tagIndex: Tage ab heute (0 = heute), so liegen die Tage in der Datei. */
    fun tagIndex(iso: String): Int? {
        val tag = NebenRisiko.isoDatum(iso) ?: return null
        return ChronoUnit.DAYS.between(LocalDate.now(), tag).toInt()
    }

    fun tag(iso: String): NebenRisikoTag? = tagIndex(iso)?.let { daten?.tage?.get(it.toString()) }

    fun option(iso: String, option: String = "standard"): NebenRisikoOption? {
        val t = tag(iso)
        return t?.optionen?.get(option) ?: t?.optionen?.get("standard")
    }

    fun fahrt(iso: String, rideID: String, option: String = "standard") = option(iso, option)?.fahrten?.get(rideID)

    fun ereignisse(iso: String): List<NebenEreignis> {
        val auto = tag(iso)?.ereignisse ?: emptyList()
        val a = aenderungen[iso] ?: TagAenderung()
        val liste = auto.filter { it.id !in a.entfernt }.map { e ->
            val g = a.geaendert[e.id] ?: return@map e.copy(quelleArt = "auto")
            e.copy(
                von = g.von ?: e.von, bis = g.bis ?: e.bis, zeit = g.zeit ?: e.zeit, wirkung = g.wirkung ?: e.wirkung,
                angepasst = true, kachel = null, quelleArt = "auto",
            )
        }
        return liste + a.eigene.map { it.copy(quelleArt = "eigen") }
    }

    fun entfernte(iso: String): List<NebenEreignis> {
        val a = aenderungen[iso] ?: return emptyList()
        return (tag(iso)?.ereignisse ?: emptyList()).filter { it.id in a.entfernt }
    }

    private fun setzen(iso: String, a: TagAenderung) { aenderungen = aenderungen + (iso to a) }

    fun entfernen(iso: String, id: String) {
        val a = aenderungen[iso] ?: TagAenderung()
        setzen(iso, if (a.eigene.any { it.id == id }) a.copy(eigene = a.eigene.filter { it.id != id })
        else if (id !in a.entfernt) a.copy(entfernt = a.entfernt + id) else a)
    }

    fun wiederherstellen(iso: String, id: String) {
        val a = aenderungen[iso] ?: TagAenderung()
        setzen(iso, a.copy(entfernt = a.entfernt.filter { it != id }))
    }

    fun aendern(iso: String, id: String, w: NebenEreignisWerte) {
        val a = aenderungen[iso] ?: TagAenderung()
        val i = a.eigene.indexOfFirst { it.id == id }
        if (i >= 0) {
            val e = a.eigene[i]
            val neu = e.copy(von = w.von ?: e.von, bis = w.bis ?: e.bis, zeit = w.zeit ?: e.zeit, wirkung = w.wirkung ?: e.wirkung)
            setzen(iso, a.copy(eigene = a.eigene.toMutableList().also { it[i] = neu }))
        } else {
            val g = a.geaendert[id] ?: NebenEreignisWerte()
            val neu = NebenEreignisWerte(w.von ?: g.von, w.bis ?: g.bis, w.zeit ?: g.zeit, w.wirkung ?: g.wirkung)
            setzen(iso, a.copy(geaendert = a.geaendert + (id to neu)))
        }
    }

    fun hinzufuegen(iso: String, e: NebenEreignis) {
        val a = aenderungen[iso] ?: TagAenderung()
        setzen(iso, a.copy(eigene = a.eigene + e))
    }
}

internal object NebenRisiko {
    fun isoDatum(iso: String): LocalDate? = runCatching { LocalDate.parse(iso.take(10)) }.getOrNull()

    /** toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'short' }): "Mi., 4. Nov." */
    fun datumText(iso: String): String = isoDatum(iso)?.format(DateTimeFormatter.ofPattern("EEE, d. MMM", Locale.GERMAN)) ?: iso

    /** Erste Gruppe jedes Treffers. */
    fun treffer(muster: String, text: String, optionen: Set<RegexOption> = emptySet()): List<String> =
        Regex(muster, optionen).findAll(text).mapNotNull { it.groups[1]?.value }.toList()

    /** risikoGrund: spuerbares Ereignis vor der haeufigsten Ursache. */
    fun grund(f: NebenRisikoFahrt): String {
        val e = f.ereignis
        if (e != null && (e.min >= 5 || f.ursachen.isNullOrEmpty())) {
            return e.name.replace(", Allianz Arena", "") + if (e.route == "FTO") ", über FTO" else ""
        }
        return f.ursachen?.firstOrNull()?.name ?: "kaum Schwankung"
    }

    /** ereignisAusText: Freitext grob deuten, Uhrzeiten "14 bis 18", "14-18 Uhr", "14:30–18:00". */
    fun ereignisAusText(eingabe: String): NebenEreignis? {
        val t = eingabe.trim()
        if (t.isEmpty()) return null
        var von = ""
        var bis = ""
        Regex("""(\d{1,2})(?::(\d{2}))?\s*(?:Uhr)?\s*(?:bis|-|–)\s*(\d{1,2})(?::(\d{2}))?""", RegexOption.IGNORE_CASE).find(t)?.let { m ->
            fun zeit(h: String?, mm: String?) = zwei(h?.toIntOrNull() ?: 0) + ":" + (mm ?: "00")
            von = zeit(m.groups[1]?.value, m.groups[2]?.value)
            bis = zeit(m.groups[3]?.value, m.groups[4]?.value)
        }
        fun hat(muster: String) = Regex(muster, RegexOption.IGNORE_CASE).containsMatchIn(t)
        val art = when {
            hat("sperr") -> "Sperrung"
            hat("demo|kundgebung") -> "Demonstration"
            hat("baustelle") -> "Baustelle"
            hat("stau|unfall") -> "Verkehr"
            else -> "Ereignis"
        }
        val ort = treffer("""([A-ZÄÖÜ][\wäöüß-]*(?:straße|strasse|str\.|platz|ring|allee|weg|brücke|tunnel))""", t).firstOrNull()
            ?: treffer("""\b(A\s?\d{1,3})\b""", t).firstOrNull() ?: ""
        val jetzt = LocalTime.now()
        return NebenEreignis(
            id = "eigen-${System.currentTimeMillis()}", art = "eigen",
            titel = listOf(art, ort).filter { it.isNotEmpty() }.joinToString(" "), kurz = art,
            von = von, bis = bis, zeit = if (von.isEmpty()) "ganztägig" else "$von–$bis",
            wirkung = if (ort.isEmpty()) "Wirkung bei der nächsten Planung prüfen" else "$ort meiden",
            quelle = "Disposition, ${zwei(jetzt.hour)}:${zwei(jetzt.minute)}",
            kachel = NebenKachel(art, if (von.isEmpty()) "ganztags" else "${von.take(2)}–${bis.take(2)}", ort.ifEmpty { "von dir" }),
            text = t,
        )
    }
}

/** Farben (risikoFarben.js). */
internal object NebenRisikoFarbe {
    val lime = hex(0xE3F654)
    val gruen = hex(0x59BE80)
    val rot = hex(0xFF6F63)
    val dunkel = hex(0x1C1C1D)

    /** KLASSE_FARBE */
    fun klasse(k: String): Color = when (k) { "hoch" -> rot; "mittel" -> lime; else -> gruen }

    /** luftFarbe: Luft am schlechten Tag (1 von 10), bis 2 min knapp, ab 10 min sicher. */
    fun luft(v: Double?): Color = if (v == null) hex(0x3A3A3A) else if (v <= 2) rot else if (v < 10) lime else gruen

    /** zahl: gerundet mit deutscher Tausendertrennung, sonst "–". Math.round rundet .5 nach oben. */
    fun zahl(n: Double?): String {
        if (n == null || !n.isFinite()) return "–"
        val f = NumberFormat.getNumberInstance(Locale.GERMANY)
        f.maximumFractionDigits = 0
        return f.format(floor(n + 0.5))
    }

    fun minuten(hhmm: String?): Int? {
        val teile = (hhmm ?: "").split(":")
        val h = teile.firstOrNull()?.trim()?.toIntOrNull() ?: return null
        val m = if (teile.size > 1) teile[1].trim().toIntOrNull() ?: 0 else 0
        return h * 60 + m
    }

    /** fensterAus: "18:00–20:15 · 22:15–23:45" als Minutenpaare. */
    fun fenster(zeit: String): List<Pair<Int, Int>> = zeit.split("·").mapNotNull { teil ->
        val p = teil.trim().split(Regex("[–-]")).map { minuten(it) }
        if (p.size < 2) return@mapNotNull null
        val a = p[0] ?: return@mapNotNull null
        val b = p[1] ?: return@mapNotNull null
        a to b
    }
}
