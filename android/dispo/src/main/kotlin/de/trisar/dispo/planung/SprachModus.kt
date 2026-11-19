package de.trisar.dispo.planung

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.RectangleShape
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.graphics.ColorMatrix
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import de.trisar.kern.Icon
import de.trisar.kern.grotesk
import de.trisar.kern.hex
import de.trisar.kern.tippen
import io.github.jan.supabase.postgrest.from
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import java.util.Locale
import kotlin.math.cos
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.sin
import kotlin.random.Random

// Voice-Modus des KI-Assistenten (Design abgenommen 13.11., Nachbau von SprachModus.jsx und sprache.js).
// Kugel mit dem Verlauf des Planungs-Knopfs. Zuhoeren: bewegt sich mit der Stimme.
// Denkt: dreht und wirbelt, mal mehr Blau, mal mehr Gelb. Spricht: Farben stehen,
// die Kugel atmet mit, Ringe laufen. Rueckfrage: weisse Karte, „ja“ oder „nein“.
// Erkennung ueber SpeechRecognizer (de-DE, offline bevorzugt), Vorlesen ueber TextToSpeech.
// Satzende wie ChatGPT (13.11.): endeWartezeit schaetzt, ob der Satz fertig klingt, Kugel antippen schickt sofort ab.

/**
 * Was nach einer Antwort auf ein „ja“ wartet. lokal = Vorschlaege im Chat, die die App selbst bestaetigt,
 * id = die Chat-Nachricht mit den Vorschlaegen (ihre Karten stehen im Voice-Modus wie im Chat).
 */
internal data class SprachOffen(
    val lokal: Boolean, val titel: String, val zeile: String? = null, val art: String? = null, val id: String? = null,
    /** Ja/Nein-Knoepfe nur bei einer Ja/Nein-Frage (19.11.), nicht bei „Um wie viel Uhr?“. */
    val jaNein: Boolean = true,
)

internal data class SprachAntwort(val text: String, val offen: SprachOffen? = null)

private val sprachLime = hex(0xE3F654)
private val sprachRot = hex(0xFF6F63)

// Hoehen der Balken aus der Aufnahme von „TRISAR“ (Screenshot vom User).
private val trisarBalkenKlein = listOf(0.3f, 0.38f, 0.97f, 1f, 0.82f, 0.5f, 0.68f, 0.44f, 0.16f)

/** Sprechen-Knopf: steht statt des Senden-Pfeils, solange das Eingabefeld leer ist. */
@Composable
internal fun SprechenKnopf(aktion: () -> Unit) {
    Row(
        Modifier.size(48.dp).background(Color.Black.copy(alpha = 0.4f), CircleShape).border(1.5.dp, sprachLime, CircleShape)
            .clip(CircleShape).tippen(aktion),
        horizontalArrangement = Arrangement.spacedBy(2.dp, Alignment.CenterHorizontally),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        trisarBalkenKlein.forEach { v ->
            Box(Modifier.width(2.dp).height(maxOf(2, (v * 24).roundToInt()).dp).background(sprachLime, CircleShape))
        }
    }
}

// --- Text fuers Vorlesen und kurze Antworten -------------------------------------

/** zumVorlesen in sprache.js: Antworttext so umbauen, dass er sich gut vorlesen laesst. */
internal fun zumVorlesen(text: String): String = text
    .replace(Regex("""https?://\S+"""), "")
    .replace(Regex("""[*_#`>]"""), "")
    .replace(Regex("""(?m)^\s*[-•]\s+"""), "")
    .replace(Regex("""(\d{1,2}):00\b"""), "$1 Uhr")
    .replace(Regex("""(\d{1,2}):(\d{2})\b"""), "$1 Uhr $2")
    .replace(Regex("""\s*[–—]\s*"""), " bis ")
    .replace(Regex("""[„“”"]"""), "")
    .replace(Regex("""\n+"""), ". ")
    .replace(Regex("""\.\s*\."""), ".")
    .replace(Regex("""\s+"""), " ")
    .trim()

private val jaMuster = Regex("""(?iU)^(ja|jap|jo|jawohl|genau|passt|ok|okay|klar|mach( das)?|bitte|senden|buchen|abschicken|richtig|stimmt)\b""")
private val neinMuster = Regex("""(?iU)^(nein|nee|ne|nö|nicht|stopp|abbrechen|lass( es)?|falsch)\b""")

internal fun istJa(t: String) = jaMuster.containsMatchIn(t.trim())
internal fun istNein(t: String) = neinMuster.containsMatchIn(t.trim())

// --- Satzende wie bei ChatGPT --------------------------------------------------
// Wie sprache.js: nicht nach einer festen Pause abschicken, sondern schaetzen, ob der Satz fertig
// klingt. Klingt er offen („und“, „äh“, „zum“ am Ende), wird lange gewartet. Die Wartezeit zaehlt
// ab dem letzten Wort UND dem letzten hoerbaren Ton.

private val offeneEnden = setOf(
    "und", "oder", "aber", "sondern", "dann", "also", "weil", "dass", "wenn", "ob", "damit", "bevor", "nachdem", "sowie",
    "äh", "ähm", "ehm", "hm", "hmm", "öh", "öhm", "mh", "quasi", "sozusagen",
    "der", "die", "das", "den", "dem", "des", "ein", "eine", "einen", "einem", "einer", "eines",
    "mein", "meine", "dein", "sein", "seine", "ihr", "ihre", "unser", "unsere",
    "zu", "zum", "zur", "von", "vom", "nach", "mit", "für", "bei", "beim", "an", "am", "auf", "in", "im", "ins",
    "um", "ab", "bis", "über", "unter", "vor", "hinter", "neben", "zwischen", "gegen", "ohne", "durch", "aus",
    "ich", "du", "er", "sie", "wir", "soll", "sollen", "kann", "muss", "will", "möchte", "bitte", "noch", "auch",
    "erstelle", "buche", "schick", "schicke", "sag", "sage", "schreib", "schreibe", "lösche", "setze", "verschiebe",
    "halb", "viertel", "uhr", "morgen", "heute", "übermorgen",
)
private val kurzFertig = Regex("""(?iU)^(ja|jap|jo|nein|nee|ne|nö|ok|okay|stopp|stop|danke|genau|passt|richtig|falsch|abbrechen)$""")
private val satzzeichenEnde = Regex("""[.,!?;:…"„“]+$""")
private val offenesZeichenEnde = Regex("""[,\-–…]$""")
private val schlusszeichenEnde = Regex("""[.!?]$""")

/** endeWartezeit in sprache.js: wie lange nach dem letzten Wort und Ton gewartet wird (ms). */
internal fun endeWartezeit(text: String, frage: Boolean = false): Long {
    val t = text.trim().lowercase(Locale.GERMAN)
    if (t.isEmpty()) return Long.MAX_VALUE
    val woerter = t.split(Regex("""\s+"""))
    val letztes = woerter.last().replace(satzzeichenEnde, "")
    if (frage && woerter.size <= 3 && (istJa(t) || istNein(t))) return 700
    if (woerter.size == 1 && kurzFertig.matches(letztes)) return 900
    if (offenesZeichenEnde.containsMatchIn(t) || letztes in offeneEnden) return 3500
    if (woerter.size <= 2) return 2500
    if (schlusszeichenEnde.containsMatchIn(t)) return 1300
    return 1800
}

// --- Zuhoeren ------------------------------------------------------------------

/**
 * erkennungStarten in sprache.js: hoert dauerhaft zu, meldet Zwischentext und den fertigen Satz, sobald er
 * fertig klingt (endeWartezeit, alle 100 ms geprueft). SpeechRecognizer endet nach kurzer Stille von selbst
 * und ruft onResults. Das schickt NICHT ab: der Text bleibt gesammelt, die Erkennung startet sofort neu und
 * haengt die naechsten Ergebnisse an. Abgeschickt wird nur ueber die Regel oder jetztSenden().
 * Pegel aus onRmsChanged (etwa -2..10 dB auf 0..1), ueber 0,12 zaehlt als hoerbarer Ton.
 */
internal class SprachErkennung(
    private val ctx: Context,
    private val onZwischen: (String) -> Unit,
    private val onSatz: (String) -> Unit,
    private val onFehler: (String) -> Unit,
    private val onPegel: (Float) -> Unit,
    private val frage: Boolean = false,
) {
    private val haupt = Handler(Looper.getMainLooper())
    private var rec: SpeechRecognizer? = null
    private var aktiv = false
    /** Fertige Teile aus frueheren Durchgaengen der Erkennung. */
    private var text = ""
    /** Zwischentext des laufenden Durchgangs. */
    private var zwischen = ""
    private var letztesWort = 0L
    private var letzteStimme = 0L
    private var unveraendertSeit = 0L
    private var offline = true
    private var fehlerFolge = 0
    private val neustart = Runnable { if (aktiv) { runCatching { rec?.cancel() }; hoeren() } }

    // Alle 100 ms pruefen, ob der Satz fertig ist.
    private val pruefer = object : Runnable {
        override fun run() {
            if (!aktiv) return
            val satz = ganz()
            if (satz.isNotEmpty()) {
                val jetzt = System.currentTimeMillis()
                val ruhe = jetzt - maxOf(letztesWort, letzteStimme)
                // Ton ohne neue Woerter (Rauschen, Musik) haelt den Satz hoechstens 6 s offen.
                val zuLange = jetzt - unveraendertSeit > 6000 && jetzt - letztesWort > 1500
                if (ruhe >= endeWartezeit(satz, frage) || zuLange) { abschliessen(); return }
            }
            haupt.postDelayed(this, 100)
        }
    }

    fun starten() {
        if (!SpeechRecognizer.isRecognitionAvailable(ctx)) { onFehler("nicht_unterstuetzt"); return }
        aktiv = true
        rec = runCatching { SpeechRecognizer.createSpeechRecognizer(ctx) }.getOrNull()?.also { it.setRecognitionListener(hoerer) }
        if (rec == null) { aktiv = false; onFehler("nicht_unterstuetzt"); return }
        haupt.postDelayed(pruefer, 100)
        hoeren()
    }

    /** Kugel antippen beim Zuhoeren: sofort abschicken, ohne zu warten. */
    fun jetztSenden() { abschliessen() }

    fun stoppen() {
        aktiv = false
        haupt.removeCallbacks(pruefer)
        haupt.removeCallbacks(neustart)
        runCatching { rec?.cancel() }
        runCatching { rec?.destroy() }
        rec = null
        text = ""
        zwischen = ""
    }

    private fun ganz(): String = "$text $zwischen".replace(Regex("""\s+"""), " ").trim()

    private fun hoeren() {
        if (!aktiv) return
        val absicht = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            putExtra(RecognizerIntent.EXTRA_LANGUAGE, "de-DE")
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_PREFERENCE, "de-DE")
            putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
            putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, offline)
            putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
            putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, ctx.packageName)
            // Nur ein Hinweis, viele Geraete ignorieren ihn. Das Satzende bestimmt der Pruefer.
            putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS, 4000L)
            putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS, 4000L)
            // Namen von Fahrern, Orten und Fahrgaesten bevorzugt erkennen (ab Android 13).
            if (android.os.Build.VERSION.SDK_INT >= 33 && SprachWoerter.liste.isNotEmpty()) {
                putStringArrayListExtra(RecognizerIntent.EXTRA_BIASING_STRINGS, ArrayList(SprachWoerter.liste))
            }
        }
        runCatching { rec?.startListening(absicht) }.onFailure { neuStarten(400) }
    }

    private fun neuStarten(ms: Long) {
        haupt.removeCallbacks(neustart)
        if (aktiv) haupt.postDelayed(neustart, ms)
    }

    /** Zwischentext des beendeten Durchgangs in den gesammelten Text uebernehmen. */
    private fun zwischenSichern() {
        if (zwischen.isNotBlank()) text = "$text $zwischen"
        zwischen = ""
    }

    private fun abschliessen() {
        val satz = ganz()
        text = ""
        zwischen = ""
        if (satz.isNotEmpty() && aktiv) {
            aktiv = false
            haupt.removeCallbacks(pruefer)
            haupt.removeCallbacks(neustart)
            runCatching { rec?.cancel() }
            onSatz(satz)
        }
    }

    private fun erstes(b: Bundle?): String = b?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull().orEmpty()

    private fun neuerText(vorher: String) {
        val nachher = ganz()
        letztesWort = System.currentTimeMillis()
        if (nachher != vorher) unveraendertSeit = letztesWort
        onZwischen(nachher)
    }

    private val hoerer = object : RecognitionListener {
        override fun onReadyForSpeech(params: Bundle?) {}
        override fun onBeginningOfSpeech() {}
        override fun onRmsChanged(rmsdB: Float) {
            if (!aktiv) return
            val pg = ((rmsdB + 2f) / 12f).coerceIn(0f, 1f)
            if (pg > 0.12f) letzteStimme = System.currentTimeMillis()
            onPegel(pg)
        }
        override fun onBufferReceived(buffer: ByteArray?) {}
        override fun onEndOfSpeech() { onPegel(0f) }
        override fun onEvent(eventType: Int, params: Bundle?) {}

        override fun onPartialResults(partialResults: Bundle?) {
            if (!aktiv) return
            val t = erstes(partialResults)
            if (t.isBlank()) return
            fehlerFolge = 0
            val vorher = ganz()
            zwischen = t
            neuerText(vorher)
        }

        override fun onResults(results: Bundle?) {
            if (!aktiv) return
            fehlerFolge = 0
            val t = erstes(results)
            val vorher = ganz()
            if (t.isNotBlank()) zwischen = t
            zwischenSichern()
            if (t.isNotBlank()) neuerText(vorher)
            // Nicht abschicken, sofort weiter zuhoeren und anhaengen.
            neuStarten(0)
        }

        override fun onError(error: Int) {
            if (!aktiv) return
            onPegel(0f)
            // Der Durchgang ist vorbei, sein Zwischentext bleibt im Satz.
            zwischenSichern()
            when (error) {
                SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> { onFehler("not-allowed"); stoppen() }
                SpeechRecognizer.ERROR_NO_MATCH, SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> neuStarten(50)
                SpeechRecognizer.ERROR_RECOGNIZER_BUSY -> neuStarten(400)
                SpeechRecognizer.ERROR_CLIENT -> neuStarten(300)
                // ERROR_LANGUAGE_NOT_SUPPORTED (12) / ERROR_LANGUAGE_UNAVAILABLE (13): ohne Offline-Wunsch nochmal.
                12, 13 -> if (offline) { offline = false; neuStarten(100) } else { onFehler("sprache"); stoppen() }
                else -> {
                    fehlerFolge += 1
                    if (fehlerFolge == 5) onFehler("netz")
                    neuStarten(800)
                }
            }
        }
    }
}

// --- Vorlesen ------------------------------------------------------------------

/** vorlesen in sprache.js: liest vor und meldet Pegel-Stoesse bei jedem Wort, dazwischen klingt er ab. */
internal class Vorleser(ctx: Context) {
    private val bereit = CompletableDeferred<Boolean>()
    private lateinit var tts: TextToSpeech
    @Volatile private var aktuelleId: String? = null
    @Volatile private var aktuellFertig: CompletableDeferred<Unit>? = null
    @Volatile private var stoss = 0f

    init {
        tts = TextToSpeech(ctx.applicationContext) { status ->
            if (status == TextToSpeech.SUCCESS) {
                runCatching {
                    tts.setLanguage(Locale.GERMANY)
                    // Beste deutsche Stimme, die ohne Netz auskommt.
                    tts.voices?.filter { it.locale.language == "de" && !it.isNetworkConnectionRequired }
                        ?.maxByOrNull { it.quality }?.let { tts.voice = it }
                    tts.setSpeechRate(1.05f)
                    tts.setOnUtteranceProgressListener(fortschritt)
                }
                bereit.complete(true)
            } else bereit.complete(false)
        }
    }

    private val fortschritt = object : UtteranceProgressListener() {
        override fun onStart(utteranceId: String?) {}
        override fun onRangeStart(utteranceId: String?, start: Int, end: Int, frame: Int) {
            if (utteranceId == aktuelleId) stoss = 0.55f + Random.nextFloat() * 0.35f
        }
        override fun onDone(utteranceId: String?) = ende(utteranceId)
        @Deprecated("Deprecated in Java")
        override fun onError(utteranceId: String?) = ende(utteranceId)
        override fun onError(utteranceId: String?, errorCode: Int) = ende(utteranceId)
        override fun onStop(utteranceId: String?, interrupted: Boolean) = ende(utteranceId)
    }

    private fun ende(id: String?) { if (id == aktuelleId) aktuellFertig?.complete(Unit) }

    /** Kehrt zurueck, wenn der Text fertig gelesen oder abgebrochen ist. */
    suspend fun vorlesen(text: String, onPegel: (Float) -> Unit) {
        val satz = zumVorlesen(text)
        if (satz.isEmpty()) return
        if (!bereit.await()) return
        val id = "stimme-${System.nanoTime()}"
        val fertig = CompletableDeferred<Unit>()
        aktuelleId = id
        aktuellFertig = fertig
        stoss = 0f
        val ergebnis = tts.speak(satz, TextToSpeech.QUEUE_FLUSH, null, id)
        if (ergebnis != TextToSpeech.SUCCESS) return
        coroutineScope {
            val puls = launch {
                while (isActive) {
                    stoss *= 0.9f
                    onPegel(min(1f, 0.15f + stoss))
                    delay(16)
                }
            }
            try {
                // Sicherheitsnetz, falls die Stimme kein Ende meldet.
                withTimeoutOrNull(maxOf(15_000L, satz.length * 200L)) { fertig.await() }
            } finally {
                puls.cancel()
                onPegel(0f)
            }
        }
    }

    fun stoppen() {
        runCatching { tts.stop() }
        aktuellFertig?.complete(Unit)
    }

    fun beenden() {
        stoppen()
        runCatching { tts.shutdown() }
    }
}

// --- Ablauf ----------------------------------------------------------------------

/** Rueckrufe in den Chat: alles laeuft durch denselben Weg wie getippte Nachrichten. */
internal class SprachRufe(
    val senden: suspend (String) -> SprachAntwort,
    val ja: suspend () -> SprachAntwort,
    val nein: suspend () -> SprachAntwort,
)

private val sprachStatus = mapOf(
    "hoeren" to "Ich höre zu",
    "denken" to "Einen Moment",
    "sprechen" to "Spricht, zum Unterbrechen Kugel antippen",
    "frage" to "Ich höre zu, sag „ja“ oder „nein“",
    "stumm" to "Mikro aus",
)
private const val hoerenMitText = "Ich höre zu, Kugel antippen schickt sofort ab"

/** Der ganze Ablauf lebt in einem Objekt, das beim Oeffnen einmal entsteht (wie ablaufRef im Web). */
private class SprachAblauf(private val ctx: Context, private val scope: CoroutineScope, private val rufe: () -> SprachRufe) {
    var modus by mutableStateOf("hoeren")
    var zeile by mutableStateOf("")
    var zeileHell by mutableStateOf(false)
    /** Was beim Zuhoeren gerade erkannt wird, wird beim Start des Zuhoerens geleert. */
    var gehoert by mutableStateOf("")
    var offen by mutableStateOf<SprachOffen?>(null)
    var fehler by mutableStateOf("")
    var stumm by mutableStateOf(false)
    @Volatile var pegel = 0f

    private var lebt = true
    private var ruhe = false
    private var erkennung: SprachErkennung? = null
    private val vorleser = Vorleser(ctx)
    private var vorlesenJob: Job? = null

    fun starten() {
        if (!SpeechRecognizer.isRecognitionAvailable(ctx)) {
            fehler = "Dieses Gerät kann keine Sprache erkennen."
            return
        }
        // Namen fuer die Erkennung im Hintergrund holen, das Zuhoeren startet sofort.
        scope.launch { SprachWoerter.laden() }
        zuhoeren("hoeren")
    }

    private fun zuhoerenStoppen() {
        erkennung?.stoppen()
        erkennung = null
        pegel = 0f
    }

    fun zuhoeren(naechster: String = "hoeren") {
        if (!lebt) return
        zuhoerenStoppen()
        if (ruhe) { modus = "stumm"; return }
        modus = naechster
        if (naechster == "hoeren") zeile = ""
        gehoert = ""
        val e = SprachErkennung(
            ctx,
            onZwischen = { txt ->
                gehoert = txt
                if (naechster == "hoeren") { zeile = txt; zeileHell = false }
            },
            onSatz = { s -> satzVerarbeiten(s) },
            onFehler = { f ->
                fehler = when (f) {
                    "not-allowed" -> "Spracherkennung ist nicht erlaubt."
                    "nicht_unterstuetzt" -> "Dieses Gerät kann keine Sprache erkennen."
                    "sprache" -> "Deutsche Spracherkennung ist auf diesem Gerät nicht verfügbar."
                    else -> "Spracherkennung gerade nicht erreichbar."
                }
            },
            onPegel = { pg -> pegel = pg },
            frage = naechster == "frage",
        )
        erkennung = e
        e.starten()
    }

    private fun satzVerarbeiten(satz: String) {
        zuhoerenStoppen()
        zeile = satz
        zeileHell = false
        modus = "denken"
        scope.launch {
            val wartet = offen
            val r = rufe()
            val antwort = try {
                when {
                    wartet?.lokal == true && istJa(satz) -> r.ja()
                    wartet?.lokal == true && istNein(satz) -> r.nein()
                    else -> r.senden(satz)
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                SprachAntwort("Das hat nicht geklappt. ${e.message ?: ""}".trim())
            }
            sprechen(antwort)
        }
    }

    private fun sprechen(antwort: SprachAntwort) {
        if (!lebt) return
        offen = antwort.offen
        zeile = antwort.text
        zeileHell = true
        modus = "sprechen"
        vorlesenJob?.cancel()
        var job: Job? = null
        job = scope.launch {
            vorleser.vorlesen(antwort.text) { pg -> pegel = pg }
            if (!lebt || vorlesenJob !== job) return@launch
            vorlesenJob = null
            zuhoeren(if (antwort.offen != null) "frage" else "hoeren")
        }
        vorlesenJob = job
    }

    /** Kugel antippen beim Zuhoeren: sofort abschicken, ohne zu warten. */
    fun jetztSenden() { erkennung?.jetztSenden() }

    fun unterbrechen() {
        val j = vorlesenJob ?: return
        vorlesenJob = null
        j.cancel()
        vorleser.stoppen()
        zuhoeren(if (offen != null) "frage" else "hoeren")
    }

    /** Ja/Nein-Knopf an der Rueckfrage (18.11.): wie gesprochenes "ja" bzw. "nein", auch mitten im Vorlesen. */
    fun knopf(ja: Boolean) {
        if (offen == null) return
        val j = vorlesenJob
        if (j != null) {
            vorlesenJob = null
            j.cancel()
            vorleser.stoppen()
        } else if (modus == "denken") return
        satzVerarbeiten(if (ja) "ja" else "nein")
    }

    /** Ein Vorschlag wurde per Knopf erledigt: Rueckfrage beenden, normal weiter zuhoeren. */
    fun offenLoesen() {
        if (offen?.lokal != true) return
        offen = null
        if (lebt && !ruhe && modus != "denken" && vorlesenJob == null) zuhoeren("hoeren")
    }

    fun stummSetzen(an: Boolean) {
        stumm = an
        ruhe = an
        if (an) {
            zuhoerenStoppen()
            if (modus == "hoeren" || modus == "frage") modus = "stumm"
        } else if (modus == "stumm") {
            // Nur aus der Ruhe heraus wieder zuhoeren, nicht mitten im Denken oder Sprechen.
            zuhoeren(if (offen != null) "frage" else "hoeren")
        }
    }

    fun beenden() {
        lebt = false
        zuhoerenStoppen()
        vorlesenJob?.cancel()
        vorlesenJob = null
        vorleser.beenden()
    }
}

// --- Ansicht ---------------------------------------------------------------------

/**
 * Voice-Modus: schwarz ueber dem ganzen Chat, die Navileiste ist solange aus.
 * vorschlag: die Karten der juengsten Antwort mit ihren Knoepfen, gerendert wie im Chat (vorschlagId = ihre Nachricht).
 * vorschlagOffen: wartet davon noch etwas auf Bestaetigung (Knopf oder „ja“)?
 */
@Composable
internal fun SprachModusAnsicht(
    rufe: SprachRufe,
    vorschlag: (@Composable () -> Unit)? = null,
    vorschlagId: String? = null,
    vorschlagOffen: Boolean = false,
    schliessen: () -> Unit,
) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    val aktuelleRufe by rememberUpdatedState(rufe)
    val ablauf = remember { SprachAblauf(ctx, scope) { aktuelleRufe } }
    val erlaubnis = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { ja ->
        if (ja) ablauf.starten() else ablauf.fehler = "Kein Zugriff aufs Mikrofon. Bitte in den App-Einstellungen erlauben."
    }
    LaunchedEffect(Unit) {
        if (ContextCompat.checkSelfPermission(ctx, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) ablauf.starten()
        else erlaubnis.launch(Manifest.permission.RECORD_AUDIO)
    }
    DisposableEffect(Unit) { onDispose { ablauf.beenden() } }
    BackHandler { schliessen() }

    val modus = ablauf.modus
    val fehler = ablauf.fehler
    val status = fehler.ifEmpty { if (modus == "hoeren" && ablauf.zeile.isNotEmpty()) hoerenMitText else sprachStatus[modus] ?: "" }
    val offen = ablauf.offen

    // Per Knopf bestaetigt oder verworfen: Ergebnis kurz stehen lassen, dann weiter wie normal.
    LaunchedEffect(vorschlagOffen, offen, vorschlagId) {
        if (vorschlagOffen || offen?.lokal != true || offen.id != vorschlagId) return@LaunchedEffect
        delay(2500)
        ablauf.offenLoesen()
    }
    val mitKarten = vorschlag != null && offen?.lokal == true && offen.id == vorschlagId
    val kugelGroesse by animateDpAsState(if (mitKarten) 120.dp else 200.dp, tween(300), label = "kugel")

    Box(Modifier.fillMaxSize().background(Color.Black).abschirmen()) {
        Column(Modifier.fillMaxSize(), horizontalAlignment = Alignment.CenterHorizontally) {
            Spacer(Modifier.height(72.dp))
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Icon("KI_Trisar_Icons_01_Lime", Modifier.size(14.dp, 13.dp), skalierung = ContentScale.FillBounds)
                Box(Modifier.height(16.dp), contentAlignment = Alignment.Center) { PText("KI Assistent", 10f, 700, sprachLime) }
            }
            Spacer(Modifier.height(14.dp))
            KiModusSchalter()
            Spacer(Modifier.height(18.dp))
            Box(Modifier.height(20.dp).fillMaxWidth().padding(horizontal = 24.dp), contentAlignment = Alignment.Center) {
                Text(
                    status, style = grotesk(13f, farbe = if (fehler.isNotEmpty()) sprachRot else hex(0xA0A0A0)),
                    textAlign = TextAlign.Center, maxLines = 1, overflow = TextOverflow.Ellipsis,
                )
            }
            Spacer(Modifier.height(if (mitKarten) 20.dp else 40.dp))
            Kugel(modus, { ablauf.pegel }, kugelGroesse) {
                when (ablauf.modus) {
                    "sprechen" -> ablauf.unterbrechen()
                    "hoeren", "frage" -> ablauf.jetztSenden()
                }
            }
            Spacer(Modifier.height(if (mitKarten) 12.dp else 36.dp))
            if (mitKarten && vorschlag != null) {
                // Was gerade gehoert wird, wie beim normalen Zuhoeren.
                Box(Modifier.fillMaxWidth().padding(horizontal = 24.dp).widthIn(max = 340.dp).heightIn(min = 24.dp), contentAlignment = Alignment.TopCenter) {
                    Text(
                        if (modus == "frage" || modus == "hoeren") ablauf.gehoert else "", style = grotesk(15f, 500, zeilenHoehe = 22f, farbe = hex(0xA0A0A0)),
                        textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth(),
                    )
                }
                // Die Vorschlaege wie im Chat: Buchen, Nicht buchen, Senden, Nein. Antippen oeffnet hier kein Formular.
                Spacer(Modifier.height(8.dp))
                Column(
                    Modifier.fillMaxWidth().weight(1f).verticalScroll(rememberScrollState()).padding(start = 20.dp, end = 20.dp, bottom = 130.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    // Darueber die Antwort selbst (fehlte vorher).
                    val t = offen?.titel.orEmpty()
                    if (t.isNotEmpty()) {
                        Column(Modifier.fillMaxWidth().widthIn(max = 362.dp).background(Color.White).padding(16.dp)) {
                            PAbsatz(t, 17f, 700, 22f, Color.Black)
                        }
                        Spacer(Modifier.height(12.dp))
                    }
                    vorschlag()
                }
            } else if (offen != null && (modus == "frage" || modus == "sprechen" || modus == "denken")) {
                // Bis knapp ueber Mikro und X, langer Text scrollt (18.11.).
                Column(
                    Modifier.fillMaxWidth().padding(horizontal = 20.dp).widthIn(max = 362.dp).weight(1f, fill = false)
                        .background(Color.White).verticalScroll(rememberScrollState()).padding(16.dp)
                ) {
                    PAbsatz(offen.titel, 20f, 700, 24f, Color.Black)
                    offen.zeile?.takeIf { it.isNotEmpty() }?.let {
                        PAbsatz(it, 12f, 500, 16f, Color.Black.copy(alpha = 0.8f), modifier = Modifier.padding(top = 4.dp))
                    }
                }
                // Ja/Nein wie Annehmen/Ablehnen (EinsatzTag): Nein rot umrandet, Ja lime. Nur bei Ja/Nein-Fragen (19.11.).
                if (offen.jaNein) {
                Spacer(Modifier.height(12.dp))
                Row(
                    Modifier.fillMaxWidth().padding(horizontal = 20.dp).widthIn(max = 362.dp).alpha(if (modus == "denken") 0.4f else 1f),
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    RahmenText(
                        "Nein", 24f, 700, EinsatzFarbe.rot,
                        Modifier.weight(1f).height(51.dp).border(2.dp, EinsatzFarbe.rot, RectangleShape).tippen { ablauf.knopf(false) },
                        abstand = -0.5f,
                    )
                    RahmenText(
                        "Ja", 24f, 700, Color.Black,
                        Modifier.weight(1f).height(51.dp).background(EinsatzFarbe.lime).tippen { ablauf.knopf(true) },
                        abstand = -0.5f,
                    )
                }
                }
                // Was gerade gehoert wird, wie beim normalen Zuhoeren.
                Spacer(Modifier.height(16.dp))
                Box(Modifier.fillMaxWidth().padding(horizontal = 24.dp).widthIn(max = 340.dp).heightIn(min = 24.dp), contentAlignment = Alignment.TopCenter) {
                    Text(
                        if (modus == "frage") ablauf.gehoert else "", style = grotesk(17f, 500, zeilenHoehe = 24f, farbe = hex(0xA0A0A0)),
                        textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth(),
                    )
                }
                Spacer(Modifier.height(116.dp))
            } else {
                // Lange Antworten scrollen statt abgeschnitten zu werden (18.11.).
                Box(
                    Modifier.fillMaxWidth().padding(horizontal = 24.dp).widthIn(max = 340.dp).heightIn(min = 72.dp)
                        .weight(1f, fill = false).verticalScroll(rememberScrollState()),
                    contentAlignment = Alignment.TopCenter,
                ) {
                    Text(
                        ablauf.zeile, style = grotesk(17f, 500, zeilenHoehe = 24f, farbe = if (ablauf.zeileHell) Color.White else hex(0xA0A0A0)),
                        textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth(),
                    )
                }
                Spacer(Modifier.height(116.dp))
            }
        }
        Row(
            Modifier.align(Alignment.BottomCenter).padding(bottom = 44.dp),
            horizontalArrangement = Arrangement.spacedBy(36.dp),
        ) {
            val aus = modus == "stumm"
            Box(
                Modifier.size(56.dp).background(hex(0x242525), CircleShape).border(1.dp, if (aus) sprachRot else hex(0x3A3A3A), CircleShape)
                    .clip(CircleShape).tippen { ablauf.stummSetzen(!ablauf.stumm) },
                contentAlignment = Alignment.Center,
            ) { SymbolMikro(aus, if (aus) sprachRot else Color.White) }
            Box(
                Modifier.size(56.dp).border(2.dp, sprachRot, CircleShape).clip(CircleShape).tippen(schliessen),
                contentAlignment = Alignment.Center,
            ) { SymbolSchliessen(sprachRot) }
        }
    }
}

/** Verlauf des Planungs-Knopfs: Blau bis m-24,5 %, Schwarz bei m %, hsl(66 44 % 58 %) bei m+64,5 %. */
private val sprachBlau = Color(0f, 89f / 255f, 1f, 0.78f)
private val sprachGelb = Color.hsl(66f, 0.44f, 0.58f)

private fun verlaufStopps(m: Float): Array<Pair<Float, Color>> {
    val a = ((m - 24.5f) / 100f).coerceIn(0f, 1f)
    val b = (m / 100f).coerceIn(a, 1f)
    val e = (m + 64.5f) / 100f
    return if (e <= 1f) arrayOf(0f to sprachBlau, a to sprachBlau, b to Color.Black, e to sprachGelb, 1f to sprachGelb)
    else arrayOf(0f to sprachBlau, a to sprachBlau, b to Color.Black, 1f to lerp(Color.Black, sprachGelb, ((1f - b) / (e - b)).coerceIn(0f, 1f)))
}

private val ringKurve = CubicBezierEasing(0f, 0f, 0.58f, 1f)

/** Kugel aus SprachModus.jsx: Bewegung je Zustand, gerechnet in festen 60-Hz-Schritten wie requestAnimationFrame. */
@Composable
private fun Kugel(modus: String, pegel: () -> Float, groesse: Dp = 200.dp, tippen: () -> Unit) {
    val ctx = LocalContext.current
    val modusAktuell by rememberUpdatedState(modus)
    val ruhig = remember {
        runCatching { Settings.Global.getFloat(ctx.contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) == 0f }.getOrDefault(false)
    }
    var winkel by remember { mutableFloatStateOf(22.66f) }
    var dx by remember { mutableFloatStateOf(0f) }
    var dy by remember { mutableFloatStateOf(0f) }
    var mitte by remember { mutableFloatStateOf(55.9f) }
    var skala by remember { mutableFloatStateOf(1f) }
    /** Zeit seit Beginn des Sprechens in ms, fuer die zwei Ringe. */
    var ringZeit by remember { mutableLongStateOf(0L) }

    LaunchedEffect(Unit) {
        var t = 0
        var glatt = 0f
        var dw = 0f; var zx = 0f; var zy = 0f; var zm = 55.9f; var zw = 1f
        var w = 22.66f; var x = 0f; var y = 0f; var mi = 55.9f; var s = 1f
        var letzte = 0L
        var rest = 0.0
        var sprichtSeit = -1L
        val schrittMs = 1000.0 / 60.0
        fun schritt() {
            val m = modusAktuell
            t += 1
            glatt += (pegel() - glatt) * 0.18f
            s = 1f
            when (m) {
                "hoeren", "frage" -> {
                    dw = glatt * 2.2f
                    s = 1f + glatt * 0.12f
                    x = sin(t / 23f) * glatt * 40f
                    y = cos(t / 31f) * glatt * 40f
                }
                "sprechen" -> {
                    dw *= 0.85f
                    s = 1f + glatt * 0.1f
                    x *= 0.9f
                    y *= 0.9f
                }
                "denken" -> {
                    if (t % 45 == 0) {
                        zx = (Random.nextFloat() - 0.5f) * 140f
                        zy = (Random.nextFloat() - 0.5f) * 140f
                        zm = 40f + Random.nextFloat() * 32f
                        zw = (if (Random.nextFloat() < 0.5f) -1f else 1f) * (2f + Random.nextFloat() * 5f)
                    }
                    x += (zx - x) * 0.05f
                    y += (zy - y) * 0.05f
                    dw += (zw - dw) * 0.06f
                    s = 1f + sin(t / 11f) * 0.05f
                }
                else -> {
                    dw *= 0.9f
                    x *= 0.95f
                    y *= 0.95f
                }
            }
            mi += ((if (m == "denken") zm else 55.9f) - mi) * (if (m == "denken") 0.04f else 0.03f)
            if (ruhig) { dw = 0f; x = 0f; y = 0f; s = 1f }
            w += dw
        }
        while (true) {
            withFrameNanos { jetzt ->
                if (letzte == 0L) schritt()
                else {
                    rest += (jetzt - letzte) / 1_000_000.0
                    var n = 0
                    while (rest >= schrittMs && n < 4) { schritt(); rest -= schrittMs; n++ }
                    if (rest >= schrittMs) rest = 0.0
                }
                letzte = jetzt
                if (modusAktuell == "sprechen") {
                    if (sprichtSeit < 0) sprichtSeit = jetzt
                    ringZeit = (jetzt - sprichtSeit) / 1_000_000L
                } else sprichtSeit = -1L
                winkel = w; dx = x; dy = y; mitte = mi; skala = s
            }
        }
    }

    val grau = remember {
        ColorFilter.colorMatrix(
            ColorMatrix().apply {
                setToSaturation(0f)
                timesAssign(ColorMatrix(floatArrayOf(0.6f, 0f, 0f, 0f, 0f, 0f, 0.6f, 0f, 0f, 0f, 0f, 0f, 0.6f, 0f, 0f, 0f, 0f, 0f, 1f, 0f)))
            },
        )
    }
    val stumm = modus == "stumm"
    val spricht = modus == "sprechen"

    Box(Modifier.size(groesse)) {
        if (spricht && !ruhig) {
            // Zwei Lime-Ringe laufen nach aussen (sprach-ring, 1,6 s, der zweite 0,8 s spaeter).
            Canvas(Modifier.fillMaxSize()) {
                val el = ringZeit
                fun ring(p: Float) {
                    val e = ringKurve.transform(p)
                    val sc = 1f + 0.5f * e
                    val a = 0.6f * (1f - e)
                    val strich = 2.dp.toPx() * sc
                    drawCircle(hex(0xE3F654).copy(alpha = a), radius = (size.minDimension / 2f - 1.dp.toPx()) * sc, style = Stroke(strich))
                }
                ring((el % 1600L) / 1600f)
                if (el >= 800L) ring(((el - 800L) % 1600L) / 1600f)
            }
        }
        Canvas(
            Modifier.fillMaxSize().graphicsLayer { scaleX = skala; scaleY = skala }.clip(CircleShape).tippen(tippen),
        ) {
            val c = Offset(size.width / 2f, size.height / 2f)
            val halb = 240.dp.toPx()
            val filter = if (stumm) grau else null
            translate(dx.dp.toPx(), dy.dp.toPx()) {
                rotate(winkel, c) {
                    drawRect(
                        Brush.horizontalGradient(*verlaufStopps(mitte), startX = c.x - halb, endX = c.x + halb),
                        topLeft = Offset(c.x - halb, c.y - halb), size = Size(halb * 2, halb * 2), colorFilter = filter,
                    )
                }
            }
            drawCircle(hex(0xE2F754), radius = size.minDimension / 2f - 1.dp.toPx(), style = Stroke(2.dp.toPx()), colorFilter = filter)
        }
    }
}

// --- Symbole (SVG aus SprachModus.jsx, viewBox 24) ----------------------------------

@Composable
private fun SymbolMikro(durchgestrichen: Boolean, farbe: Color) {
    Canvas(Modifier.size(24.dp)) {
        val s = size.width / 24f
        val strich = Stroke(1.8f * s, cap = StrokeCap.Round, join = StrokeJoin.Round)
        drawRoundRect(farbe, Offset(9 * s, 3 * s), Size(6 * s, 11 * s), androidx.compose.ui.geometry.CornerRadius(3 * s), style = strich)
        val p = Path().apply {
            arcTo(Rect(5 * s, 4 * s, 19 * s, 18 * s), 180f, -180f, true)
            moveTo(12 * s, 18 * s); lineTo(12 * s, 21 * s)
        }
        drawPath(p, farbe, style = strich)
        if (durchgestrichen) drawLine(farbe, Offset(4 * s, 4 * s), Offset(20 * s, 20 * s), 1.8f * s, StrokeCap.Round)
    }
}

@Composable
private fun SymbolSchliessen(farbe: Color) {
    Canvas(Modifier.size(24.dp)) {
        val s = size.width / 24f
        drawLine(farbe, Offset(6 * s, 6 * s), Offset(18 * s, 18 * s), 2 * s, StrokeCap.Round)
        drawLine(farbe, Offset(18 * s, 6 * s), Offset(6 * s, 18 * s), 2 * s, StrokeCap.Round)
    }
}


/**
 * Woerter, die die Erkennung bevorzugt verstehen soll: Fahrer, eigene Orte, Fahrgaeste
 * (wie Sprache.woerter in iOS). Hoechstens 100, Fahrer und Orte gehen vor.
 */
internal object SprachWoerter {
    @Volatile var liste: List<String> = emptyList()
        private set

    suspend fun laden() {
        fun t(o: kotlinx.serialization.json.JsonObject, k: String) =
            (o[k] as? kotlinx.serialization.json.JsonPrimitive)?.takeIf { it.isString }?.content.orEmpty().trim()
        val c = de.trisar.kern.Backend.client
        val fahrer = runCatching {
            c.from("profiles").select(io.github.jan.supabase.postgrest.query.Columns.raw("first_name, last_name, role"))
                .decodeList<kotlinx.serialization.json.JsonObject>()
        }.getOrNull().orEmpty()
        val orte = runCatching {
            c.from("orte").select(io.github.jan.supabase.postgrest.query.Columns.raw("name")).decodeList<kotlinx.serialization.json.JsonObject>()
        }.getOrNull().orEmpty()
        val gaeste = runCatching {
            c.from("guests").select(io.github.jan.supabase.postgrest.query.Columns.raw("first_name, last_name")) {
                order("created_at", io.github.jan.supabase.postgrest.query.Order.DESCENDING)
                limit(150)
            }.decodeList<kotlinx.serialization.json.JsonObject>()
        }.getOrNull().orEmpty()
        val neu = mutableListOf<String>()
        fun dazu(w: String) {
            val x = w.trim()
            if (x.length >= 2 && neu.none { it.equals(x, ignoreCase = true) }) neu += x
        }
        fahrer.filter { t(it, "role").lowercase() != "pruefung" }.forEach {
            dazu("${t(it, "first_name")} ${t(it, "last_name")}")
            dazu(t(it, "last_name"))
        }
        orte.forEach { dazu(t(it, "name")) }
        gaeste.forEach { dazu("${t(it, "first_name")} ${t(it, "last_name")}") }
        liste = neu.take(100)
    }
}
