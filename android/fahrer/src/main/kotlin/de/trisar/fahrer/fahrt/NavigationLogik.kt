package de.trisar.fahrer.fahrt

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import de.trisar.kern.Backend
import de.trisar.kern.GeoPunkt
import de.trisar.kern.googlePolylineLesen
import io.github.jan.supabase.functions.functions
import io.ktor.client.statement.bodyAsText
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.util.Locale
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.roundToInt
import kotlin.math.sin
import kotlin.math.sqrt

// Eigene Navigation der Fahrer-App (16.11.): fuehrt genau entlang der Route der Dispo.
// Die Route kommt fertig vom Server (places-proxy, aktion navi_route), hier nur Fortschritt,
// Abseits-Erkennung und Ansagen.

/** Ein Abbiegehinweis: m = Meter ab Routenanfang, t = Sekunden Fahrzeit bis dorthin. */
internal data class NaviHinweis(val m: Double, val t: Double, val pfeil: String, val kurz: String, val text: String, val strasse: String)

/** Halt oder Routenpunkt auf der Route: ab = Stelle in der Folge der Ziele. */
internal data class NaviWegpunkt(val m: Double, val ab: Int, val art: String)

/** Standort mit Kurs. kurs nur, wenn das Auto faehrt (sonst zeigt das GPS irgendwohin). */
internal data class NaviFix(val ort: GeoPunkt, val kurs: Double?, val tempo: Double, val genauigkeit: Double, val zeit: Long)

/** Route der Dispo vom Abholort bis zum Ziel, kommt bei der Anfahrt mit (17.11.). */
internal data class NaviVorschau(val punkte: List<GeoPunkt>, val laenge: Double, val dauer: Double)

internal class NaviRoute(
    val punkte: List<GeoPunkt>,
    val laenge: Double,
    val dauer: Double,
    val hinweise: List<NaviHinweis>,
    val wegpunkte: List<NaviWegpunkt>,
    val vorschau: NaviVorschau? = null,
) {
    /**
     * Meter ab Routenanfang je Stuetzpunkt, auf laenge_m gestreckt (wie der Server die
     * Wegpunkte rechnet), damit m der Hinweise und die eigene Stelle im selben Mass sind.
     */
    val meter: DoubleArray = DoubleArray(punkte.size).also { m ->
        for (i in 1 until punkte.size) m[i] = m[i - 1] + NaviRechnen.meter(punkte[i - 1], punkte[i])
        val gesamt = m.lastOrNull() ?: 0.0
        if (gesamt > 0 && laenge > 0) { val f = laenge / gesamt; for (i in m.indices) m[i] *= f }
    }

    /** Stuetzstellen (m, t) fuer die Restzeit: Anfang, Hinweise, Ende. */
    private val zeiten: List<Pair<Double, Double>> =
        (listOf(0.0 to 0.0) + hinweise.map { it.m to it.t } + listOf(laenge to dauer))
            .filter { it.first in 0.0..laenge }.sortedBy { it.first }

    /** Fahrzeit bis zur Stelle s, zwischen den Hinweisen linear. */
    fun zeitBis(s: Double): Double {
        if (zeiten.size < 2 || laenge <= 0) return 0.0
        val i = zeiten.indexOfLast { it.first <= s }.coerceIn(0, zeiten.size - 2)
        val (m0, t0) = zeiten[i]
        val (m1, t1) = zeiten[i + 1]
        if (m1 - m0 < 1.0) return t1
        return t0 + (t1 - t0) * ((s - m0) / (m1 - m0)).coerceIn(0.0, 1.0)
    }

    /** Naechster Hinweis: erster mit m > s - 10, sonst die Ankunft. */
    fun naechster(s: Double): Int? {
        if (hinweise.isEmpty()) return null
        val i = hinweise.indexOfFirst { it.m > s - 10 }
        return if (i >= 0) i else hinweise.lastIndex
    }

    /** Rest der Linie ab der Stelle (Abschnitt i, Anteil t) fuer die Karte. */
    fun rest(abschnitt: Int, anteil: Double): List<GeoPunkt> {
        if (punkte.size < 2) return punkte
        val i = abschnitt.coerceIn(0, punkte.size - 2)
        val a = punkte[i]; val b = punkte[i + 1]
        val p = GeoPunkt(a.lat + (b.lat - a.lat) * anteil, a.lng + (b.lng - a.lng) * anteil)
        return listOf(p) + punkte.subList(i + 1, punkte.size)
    }

    /** Richtung der Linie an der Stelle (Grad, Norden = 0), wenn das GPS keinen Kurs hat. */
    fun richtung(abschnitt: Int): Double? {
        if (punkte.size < 2) return null
        var i = abschnitt.coerceIn(0, punkte.size - 2)
        // Sehr kurze Abschnitte ueberspringen, ihre Richtung springt.
        while (i < punkte.size - 2 && meter[i + 1] - meter[i] < 3.0) i++
        return NaviRechnen.kurs(punkte[i], punkte[i + 1])
    }
}

internal object NaviRechnen {
    fun meter(a: GeoPunkt, b: GeoPunkt): Double {
        val r = 6_371_000.0
        val dLat = Math.toRadians(b.lat - a.lat)
        val dLng = Math.toRadians(b.lng - a.lng)
        val h = sin(dLat / 2) * sin(dLat / 2) + cos(Math.toRadians(a.lat)) * cos(Math.toRadians(b.lat)) * sin(dLng / 2) * sin(dLng / 2)
        return 2 * r * atan2(sqrt(h), sqrt(1 - h))
    }

    fun kurs(a: GeoPunkt, b: GeoPunkt): Double {
        val y = sin(Math.toRadians(b.lng - a.lng)) * cos(Math.toRadians(b.lat))
        val x = cos(Math.toRadians(a.lat)) * sin(Math.toRadians(b.lat)) -
            sin(Math.toRadians(a.lat)) * cos(Math.toRadians(b.lat)) * cos(Math.toRadians(b.lng - a.lng))
        return (Math.toDegrees(atan2(y, x)) + 360.0) % 360.0
    }

    /** Stelle auf der Linie: s Meter ab Anfang, Abstand zur Linie, Abschnitt und Anteil darin. */
    data class Stelle(val s: Double, val abstand: Double, val abschnitt: Int, val anteil: Double)

    /**
     * Standort auf die Linie projizieren, aber nur im Fenster [vonM, bisM] um die letzte Stelle,
     * damit die Stelle bei Schleifen und Gegenrichtung nicht springt.
     */
    fun projizieren(route: NaviRoute, ort: GeoPunkt, vonM: Double, bisM: Double): Stelle? {
        val p = route.punkte
        val m = route.meter
        if (p.size < 2) return null
        val kx = 111_320.0 * cos(Math.toRadians(ort.lat))
        val ky = 110_540.0
        var beste: Stelle? = null
        for (i in 0 until p.size - 1) {
            if (m[i + 1] < vonM) continue
            if (m[i] > bisM) break
            val ax = (p[i].lng - ort.lng) * kx; val ay = (p[i].lat - ort.lat) * ky
            val bx = (p[i + 1].lng - ort.lng) * kx; val by = (p[i + 1].lat - ort.lat) * ky
            val dx = bx - ax; val dy = by - ay
            val l2 = dx * dx + dy * dy
            var t = if (l2 > 0) (-(ax * dx + ay * dy) / l2).coerceIn(0.0, 1.0) else 0.0
            // Fenstergrenzen auch innerhalb des Abschnitts einhalten.
            val lang = m[i + 1] - m[i]
            if (lang > 0) t = t.coerceIn(((vonM - m[i]) / lang).coerceIn(0.0, 1.0), ((bisM - m[i]) / lang).coerceIn(0.0, 1.0))
            val qx = ax + dx * t; val qy = ay + dy * t
            val d = sqrt(qx * qx + qy * qy)
            if (beste == null || d < beste.abstand) beste = Stelle(m[i] + lang * t, d, i, t)
        }
        return beste
    }

    /** „300 m“, „1,2 km“, unter 30 m „Jetzt“ (ab 1000 m in km mit Komma, 100–999 auf 50, 30–99 auf 10). */
    fun entfernung(meter: Double): String {
        if (meter < 30) return "Jetzt"
        if (meter < 100) return "${(meter / 10).roundToInt() * 10} m"
        val auf50 = (meter / 50).roundToInt() * 50
        if (meter < 1000 && auf50 < 1000) return "$auf50 m"
        return String.format(Locale.GERMANY, "%.1f km", meter / 1000.0)
    }

    /** Legende am Abholort: „38 km · 41 min“ (ab 10 km ganze km, sonst eine Nachkommastelle, min aufgerundet). */
    fun vorschauText(meter: Double, sekunden: Double): String {
        val km = meter / 1000.0
        val strecke = if (km >= 10) "${km.roundToInt()} km" else String.format(Locale.GERMANY, "%.1f km", km)
        return "$strecke · ${kotlin.math.ceil(sekunden / 60.0).toInt()} min"
    }

    /** Reststrecke im Fuss: „31,4 km“, unter einem Kilometer in Metern. */
    fun restStrecke(meter: Double): String =
        if (meter < 1000) "${max(0, (meter / 10).roundToInt() * 10)} m" else String.format(Locale.GERMANY, "%.1f km", meter / 1000.0)
}

internal object NaviDienst {
    private fun zahl(o: JsonObject, k: String) = (o[k] as? JsonPrimitive)?.content?.toDoubleOrNull()
    private fun text(o: JsonObject, k: String) = (o[k] as? JsonPrimitive)?.takeIf { it !is JsonNull }?.content.orEmpty()

    /** Antwort von navi_route lesen. Ohne ok oder ohne Linie: keine Route. */
    fun lesen(o: JsonObject): NaviRoute? {
        if ((o["ok"] as? JsonPrimitive)?.content != "true") return null
        val punkte = googlePolylineLesen(text(o, "polyline"))
        if (punkte.size < 2) return null
        val hinweise = (o["hinweise"] as? JsonArray).orEmpty().mapNotNull { e ->
            val h = e as? JsonObject ?: return@mapNotNull null
            val kurz = text(h, "kurz")
            NaviHinweis(zahl(h, "m") ?: return@mapNotNull null, zahl(h, "t") ?: 0.0, text(h, "pfeil").ifEmpty { "gerade" },
                kurz, text(h, "text").ifEmpty { kurz }, text(h, "strasse"))
        }.sortedBy { it.m }
        val wegpunkte = (o["wegpunkte"] as? JsonArray).orEmpty().mapNotNull { e ->
            val w = e as? JsonObject ?: return@mapNotNull null
            NaviWegpunkt(zahl(w, "m") ?: return@mapNotNull null, (zahl(w, "ab") ?: return@mapNotNull null).toInt(), text(w, "art"))
        }
        val laenge = zahl(o, "laenge_m")?.takeIf { it > 0 }
            ?: punkte.zipWithNext { a, b -> NaviRechnen.meter(a, b) }.sum()
        return NaviRoute(punkte, laenge, zahl(o, "dauer_s") ?: 0.0, hinweise, wegpunkte, vorschauLesen(o["vorschau"] as? JsonObject))
    }

    /** Feld vorschau (nur bei bis_abholung): Linie, Laenge, Dauer. Ohne Linie keine Vorschau. */
    private fun vorschauLesen(v: JsonObject?): NaviVorschau? {
        if (v == null) return null
        val punkte = googlePolylineLesen(text(v, "polyline"))
        if (punkte.size < 2) return null
        val laenge = zahl(v, "laenge_m")?.takeIf { it > 0 } ?: punkte.zipWithNext { a, b -> NaviRechnen.meter(a, b) }.sum()
        return NaviVorschau(punkte, laenge, zahl(v, "dauer_s") ?: 0.0)
    }

    /** Route vom Standort ueber die Ziele ab `ab` bzw. nur bis zum Abholort. null = hat nicht geklappt. */
    suspend fun laden(fahrtID: String, fix: NaviFix, ab: Int, bisAbholung: Boolean): NaviRoute? = try {
        val antwort = Backend.client.functions.invoke("places-proxy", buildJsonObject {
            put("aktion", "navi_route")
            put("job_id", fahrtID)
            put("lat", fix.ort.lat)
            put("lng", fix.ort.lng)
            if (fix.kurs != null) put("kurs", fix.kurs.roundToInt()) else put("kurs", JsonNull)
            put("ab", ab)
            put("bis_abholung", bisAbholung)
        }).bodyAsText()
        (runCatching { Backend.json.parseToJsonElement(antwort) }.getOrNull() as? JsonObject)?.let { lesen(it) }
    } catch (e: kotlinx.coroutines.CancellationException) {
        throw e
    } catch (e: Exception) {
        null
    }
}

/** Ansagen auf Deutsch ueber die Sprachsynthese des Geraets. */
internal class NaviStimme(ctx: Context) {
    private var bereit = false
    private var wartend: String? = null
    private var zaehler = 0
    var stumm = false
        set(wert) { field = wert; if (wert) { wartend = null; runCatching { tts.stop() } } }

    private lateinit var tts: TextToSpeech

    // Audio-Fokus nur waehrend einer Ansage: Musik wird leiser (Pflicht fuer Android Auto, 17.11.).
    private val audio = ctx.applicationContext.getSystemService(Context.AUDIO_SERVICE) as AudioManager
    private val attribute = AudioAttributes.Builder()
        .setUsage(AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE)
        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build()
    private val fokus = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
        .setAudioAttributes(attribute).build()
    @Volatile private var letzteID = ""

    private fun fokusAbgeben(id: String?) {
        // Eine abgeloeste alte Ansage gibt den Fokus nicht ab, die neue spricht noch.
        if (id == letzteID) runCatching { audio.abandonAudioFocusRequest(fokus) }
    }

    init {
        tts = TextToSpeech(ctx.applicationContext) { status ->
            if (status != TextToSpeech.SUCCESS) return@TextToSpeech
            runCatching {
                tts.setLanguage(Locale.GERMANY)
                // Als Navigationsansage: laeuft ueber die Lautstaerke fuer Fahrhinweise, auch ueber Bluetooth im Auto.
                tts.setAudioAttributes(attribute)
                tts.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
                    override fun onStart(utteranceId: String?) {}
                    override fun onDone(utteranceId: String?) = fokusAbgeben(utteranceId)
                    @Deprecated("Pflicht der Basisklasse")
                    override fun onError(utteranceId: String?) = fokusAbgeben(utteranceId)
                    override fun onError(utteranceId: String?, errorCode: Int) = fokusAbgeben(utteranceId)
                    override fun onStop(utteranceId: String?, interrupted: Boolean) = fokusAbgeben(utteranceId)
                })
            }
            bereit = true
            wartend?.let { sagen(it) }
            wartend = null
        }
    }

    fun sagen(text: String) {
        if (stumm || text.isBlank()) return
        // Vor dem Start der Sprachsynthese: nur die letzte Ansage merken.
        if (!bereit) { wartend = text; return }
        // Die neueste Ansage zaehlt, eine noch laufende alte wird abgeloest.
        val id = "navi-${zaehler++}"
        letzteID = id
        runCatching { audio.requestAudioFocus(fokus) }
        runCatching { tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, id) }
    }

    fun ende() {
        wartend = null
        letzteID = ""
        runCatching { tts.stop(); tts.shutdown() }
        runCatching { audio.abandonAudioFocusRequest(fokus) }
    }
}

/**
 * Zustand einer laufenden Navigation. Die Seite gibt Standorte und die Phase der Fahrt hinein,
 * heraus kommen Route, Stelle, Banner-Zustand. Laeuft nur, solange die Ansicht offen ist.
 */
internal class NaviLauf(
    private val fahrtID: String,
    unterwegs: Boolean,
    private val bereich: CoroutineScope,
    private val stimme: NaviStimme,
) {
    companion object {
        const val ABSEITS_METER = 50.0
        const val ABSEITS_FOLGE = 3
        const val NEU_FRUEHESTENS_MS = 8_000L
        const val ANKUNFT_METER = 30.0
    }

    var route by mutableStateOf<NaviRoute?>(null); private set
    var fix by mutableStateOf<NaviFix?>(null); private set
    /** Meter ab Routenanfang. */
    var stelle by mutableStateOf(0.0); private set
    var abschnitt by mutableStateOf(0); private set
    var anteil by mutableStateOf(0.0); private set
    /** Abstand des Standorts zur Linie in Metern. */
    var abstand by mutableStateOf(0.0); private set
    var abseits by mutableStateOf(false); private set
    var angekommen by mutableStateOf(false); private set
    /** Laden ist gescheitert und es gibt noch keine Route. */
    var fehler by mutableStateOf(false); private set
    /** true = Anfahrt zum Abholort, false = Route der Fahrt. */
    var bisAbholung by mutableStateOf(!unterwegs); private set
    /** Letzter bekannter Kurs (fuer die Kartendrehung, bleibt im Stand stehen). */
    var kartenKurs by mutableStateOf<Double?>(null); private set

    /** Gemerkter Stand: erste noch offene Stelle in der Folge der Ziele. */
    private var ab = 0
    private var abseitsFolge = 0
    private var letzteAnforderung = 0L
    private var ladeJob: Job? = null
    private var letzteFixZeit = 0L

    // Ansagen je Hinweis: hoechstens einmal fern (400 m) und einmal nah.
    private var hinweisNr = -1
    private var ersteEntfernung = 0.0
    private var fernGesagt = false
    private var nahGesagt = false

    /** Die Fahrt ist von der Anfahrt in „unterwegs“ gewechselt: jetzt die Route der Fahrt laden. */
    fun phase(unterwegs: Boolean) {
        if (!unterwegs || !bisAbholung) return
        bisAbholung = false
        ab = max(1, ab)
        route = null
        angekommen = false; abseits = false; abseitsFolge = 0; fehler = false
        ladeJob?.cancel(); ladeJob = null
        letzteAnforderung = 0L
        anfordern()
    }

    fun standort(neu: NaviFix) {
        fix = neu
        if (neu.kurs != null) kartenKurs = neu.kurs
        val r = route
        if (r == null) anfordern() else fortschritt(r, neu)
    }

    private fun anfordern() {
        if (ladeJob?.isActive == true) return
        ladeJob = bereich.launch {
            while (true) {
                // Frühestens alle 8 s neu anfordern (auch nach einem Fehler).
                val warten = NEU_FRUEHESTENS_MS - (System.currentTimeMillis() - letzteAnforderung)
                if (letzteAnforderung > 0 && warten > 0) delay(warten)
                // In der Wartezeit zurueck auf die Route gefunden: die alte Route gilt weiter.
                if (route != null && !abseits) return@launch
                val f = fix ?: return@launch
                letzteAnforderung = System.currentTimeMillis()
                val anfahrt = bisAbholung
                // Vor der Abholung nur die Anfahrt, mit Gast an Bord nie zurueck zum Abholort.
                val neu = NaviDienst.laden(fahrtID, f, if (anfahrt) 0 else max(1, ab), anfahrt)
                if (neu != null) { uebernehmen(neu); return@launch }
                if (route == null) fehler = true
                // Wieder auf der alten Route: nichts mehr zu holen.
                if (route != null && !abseits) return@launch
            }
        }
    }

    private fun uebernehmen(neu: NaviRoute) {
        route = neu
        stelle = 0.0; abschnitt = 0; anteil = 0.0; abstand = 0.0
        abseits = false; abseitsFolge = 0; fehler = false; angekommen = false
        hinweisNr = -1; fernGesagt = false; nahGesagt = false
        letzteFixZeit = 0L
        fix?.let { fortschritt(neu, it) }
    }

    private fun fortschritt(r: NaviRoute, f: NaviFix) {
        // Fenster ab der letzten Stelle: etwas zurueck, nach vorn so weit, wie seit dem letzten
        // Standort gefahren sein kann (mindestens 400 m).
        val seit = if (letzteFixZeit > 0) (f.zeit - letzteFixZeit).coerceIn(0L, 600_000L) / 1000.0 else 0.0
        letzteFixZeit = f.zeit
        val vor = 400.0 + seit * max(f.tempo, 15.0)
        val p = NaviRechnen.projizieren(r, f.ort, stelle - 20.0, stelle + vor) ?: return
        stelle = p.s; abschnitt = p.abschnitt; anteil = p.anteil; abstand = p.abstand
        if (f.kurs == null && kartenKurs == null) kartenKurs = r.richtung(p.abschnitt)

        // Wegpunkt erreicht: Stand merken, damit nach einer Neuberechnung niemand zurueckfaehrt.
        if (!bisAbholung) {
            for (w in r.wegpunkte) {
                if ((w.art == "punkt" || w.art == "stopp") && p.s >= w.m - 30.0) ab = max(ab, w.ab + 1)
            }
        }

        if (!angekommen && p.s >= r.laenge - ANKUNFT_METER) {
            angekommen = true
            abseits = false; abseitsFolge = 0
        }
        ansagen(r, p.s)
        if (angekommen) return

        // Abseits: mehr als 50 m neben der Linie bei 3 Standorten in Folge. Ungenaue Standorte zaehlen nicht.
        if (p.abstand > ABSEITS_METER) {
            if (f.genauigkeit <= 50.0) abseitsFolge++
        } else {
            abseitsFolge = 0
            abseits = false
        }
        if (abseitsFolge >= ABSEITS_FOLGE) {
            if (!abseits) {
                abseits = true
                stimme.sagen("Route wird neu berechnet")
            }
            anfordern()
        }
    }

    private fun ansagen(r: NaviRoute, s: Double) {
        val nr = r.naechster(s) ?: return
        val h = r.hinweise[nr]
        val weg = h.m - s
        if (nr != hinweisNr) {
            hinweisNr = nr
            ersteEntfernung = weg
            fernGesagt = false; nahGesagt = false
        }
        // Der Start selbst wird nicht angesagt.
        if (h.pfeil == "start") return
        if (h.pfeil == "ziel") {
            if (!nahGesagt && weg <= ANKUNFT_METER) { nahGesagt = true; stimme.sagen(h.text) }
            return
        }
        if (!nahGesagt && weg <= 50.0) {
            nahGesagt = true; fernGesagt = true
            stimme.sagen(h.text)
        } else if (!fernGesagt && weg <= 400.0 && ersteEntfernung > 500.0) {
            fernGesagt = true
            stimme.sagen("In 400 Metern " + h.text.replaceFirstChar { it.lowercase(Locale.GERMANY) })
        }
    }

    fun ende() {
        ladeJob?.cancel()
        stimme.ende()
    }
}
