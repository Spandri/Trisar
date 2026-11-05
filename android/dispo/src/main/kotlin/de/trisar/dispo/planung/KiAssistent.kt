package de.trisar.dispo.planung

import android.content.Intent
import android.net.Uri
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.ClickableText
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.scale
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.RectangleShape
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Fill
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import de.trisar.dispo.DispoZiel
import de.trisar.dispo.Navileiste
import de.trisar.kern.Backend
import de.trisar.kern.DispoHintergrund
import de.trisar.kern.Icon
import de.trisar.kern.ZurueckKnopf
import de.trisar.kern.grotesk
import de.trisar.kern.hex
import de.trisar.kern.tippen
import io.github.jan.supabase.realtime.PostgresAction
import io.github.jan.supabase.realtime.RealtimeChannel
import io.github.jan.supabase.realtime.channel
import io.github.jan.supabase.realtime.postgresChangeFlow
import io.github.jan.supabase.realtime.realtime
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import java.time.LocalTime

// KI-Assistent (KiAssistentAnsicht.swift, KiAssistentDienst.swift, KiAssistentView.jsx): Chat mit dem Assistenten,
// Verlauf unter demselben Schluessel wie localStorage im Web, Kopieren/Bearbeiten an den Nachrichten,
// Buchungs-Vorschau und Neuplanungs-Link (beides kommt live derzeit nicht vor).

/**
 * Nachbau von askDatabaseAssistant (Live-Zweig): dort ist noch kein Modell angebunden. Nach 900 ms kommt fuer
 * jede Nachricht nur der Hinweis. Der Ollama-/RAG-Teil danach ist im Web unerreichbar und fehlt hier.
 */
internal object KiAssistentDienst {
    class Antwort(val text: String, val buchungsVorschlag: KiBuchungsVorschlag? = null)

    /** cachedSnapshotAt im Web. Live wird der Snapshot nie geladen, der Cache bleibt aber wie dort. */
    private var snapshotZeit: Long? = null

    fun cacheVerwerfen() { snapshotZeit = null }

    suspend fun fragen(prompt: String, @Suppress("UNUSED_PARAMETER") verlauf: List<Pair<String, String>>): Antwort {
        if (prompt.trim().isEmpty()) return Antwort("Bitte stelle eine Frage.")
        delay(900)
        return Antwort("Der Assistent ist im Testbetrieb noch nicht freigeschaltet.")
    }
}

/** Buchungs-Vorschau (toCreateRidePayload in KiAssistentView.jsx). */
@Serializable
internal data class KiBuchungsVorschlag(
    val datum: String = "", val startZeit: String = "", val start: String = "", val ziel: String = "",
    val fahrgaeste: String = "", val anonymeGaeste: String = "0", val fahrerNamen: List<String> = emptyList(),
    val konvoi: String = "", val flugnummer: String = "", val notes: String = "",
) {
    /** hasMinimumBookingData */
    val hatPflichtfelder: Boolean get() = start.isNotBlank() && ziel.isNotBlank() && startZeit.isNotBlank()
}

/** Eine Chat-Nachricht mit denselben Feldnamen wie im Web (JSON in localStorage). */
@Serializable
internal data class KiNachricht(
    val id: String,
    val role: String,
    val text: String,
    val time: String,
    val pending: Boolean? = null,
    val bookingProposal: KiBuchungsVorschlag? = null,
    val bookingStatus: String? = null,
    val bookingRideId: String? = null,
    val stoerungTag: String? = null,
) {
    companion object {
        fun uhrzeit(): String = LocalTime.now().let { zwei(it.hour) + ":" + zwei(it.minute) }
    }
}

/** CHAT_STORAGE_KEY + restoreStoredMessages (ohne den Demo-Abgleich mit demoStore.jobs). */
internal object KiVerlaufSpeicher {
    private const val SCHLUESSEL = "koordinator_ki_chat_messages_v2"
    private val alteSchluessel = listOf("koordinator_ki_chat_messages_v1")
    private val serializer = ListSerializer(KiNachricht.serializer())

    val standard get() = listOf(KiNachricht("init", "assistant", "Hallo! Ich bin dein KI-Assistent. Wie kann ich dir heute helfen?", "17:13"))

    fun laden(): List<KiNachricht> {
        alteSchluessel.forEach { PlanAblage.entfernen(it) }
        val liste = PlanAblage.text(SCHLUESSEL)?.let { runCatching { planJson.decodeFromString(serializer, it) }.getOrNull() }
        if (liste.isNullOrEmpty()) return standard
        val bereinigt = liste.filter { it.pending != true && !it.text.contains("Online-Demo deaktiviert", ignoreCase = true) }
            .map { if (it.bookingStatus == "saving") it.copy(bookingStatus = "pending") else it }
        if (bereinigt.isEmpty() || (bereinigt.size == 1 && bereinigt[0].id == "init")) return standard
        return bereinigt
    }

    fun sichern(liste: List<KiNachricht>) = PlanAblage.setzen(SCHLUESSEL, planJson.encodeToString(serializer, liste))
}

/** Realtime-Kanal aus KiAssistentView.jsx: jede Aenderung an den neun Tabellen verwirft den Cache. */
internal class KiAssistentLive {
    private var kanal: RealtimeChannel? = null
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val tabellen = listOf("jobs", "profiles", "vehicles", "guests", "job_guests", "job_notes", "convoy_assignments", "convoys", "driver_live_locations")

    fun starten() {
        if (kanal != null) return
        val k = Backend.client.channel("admin-ki-live-${System.currentTimeMillis()}")
        kanal = k
        val stroeme = tabellen.map { t -> k.postgresChangeFlow<PostgresAction>(schema = "public") { table = t } }
        stroeme.forEach { s -> scope.launch { s.collect { KiAssistentDienst.cacheVerwerfen() } } }
        scope.launch { runCatching { k.subscribe() } }
    }

    fun beenden() {
        scope.cancel()
        val k = kanal ?: return
        kanal = null
        planLauf.launch { runCatching { Backend.client.realtime.removeChannel(k) } }
    }
}

private val kiLime = hex(0xE3F654)

/** mitKlickbarenNummern: Telefonnummern werden zu tel:-Links (Lime, unterstrichen). */
private fun mitTelefonLinks(roh: String): AnnotatedString = buildAnnotatedString {
    var pos = 0
    for (t in Regex("""(\+?\d[\d ()/-]{6,}\d)""").findAll(roh)) {
        if (t.range.first > pos) append(roh.substring(pos, t.range.first))
        val ziffern = t.value.filter { it.isDigit() || it == '+' }
        pushStringAnnotation("tel", ziffern)
        withStyle(SpanStyle(color = kiLime, textDecoration = TextDecoration.Underline)) { append(t.value) }
        pop()
        pos = t.range.last + 1
    }
    if (pos < roh.length) append(roh.substring(pos))
}

/** Nachbau von KiAssistentView.jsx (view 'kiAssistent'). */
@Composable
internal fun KiAssistentAnsicht(
    zeigen: (DispoZiel) -> Unit,
    oeffneFahrt: (String) -> Unit,
    zurueck: (() -> Unit)? = null,
    oeffneNeuplanung: (String) -> Unit = {},
    /** onCreateRide(payload, { aiBooked: true }): liefert die ID der neuen Fahrt. null = nicht verbunden (wie iOS). */
    fahrtBuchen: (suspend (KiBuchungsVorschlag) -> String?)? = null,
) {
    var nachrichten by remember { mutableStateOf(KiVerlaufSpeicher.laden()) }
    var eingabe by remember { mutableStateOf("") }
    var bearbeiteteID by remember { mutableStateOf<String?>(null) }
    var kopierteID by remember { mutableStateOf<String?>(null) }
    var sendet by remember { mutableStateOf(false) }
    var fokussiert by remember { mutableStateOf(false) }
    val fokus = remember { FocusRequester() }
    val fokusVerwalter = LocalFocusManager.current
    val ablage = LocalClipboardManager.current
    val scope = rememberCoroutineScope()
    val live = remember { KiAssistentLive() }
    val liste = rememberLazyListState()
    val ctx = LocalContext.current

    DisposableEffect(Unit) {
        live.starten()
        onDispose { live.beenden() }
    }
    LaunchedEffect(nachrichten) { KiVerlaufSpeicher.sichern(nachrichten) }
    val letzte = nachrichten.lastOrNull()
    val signatur = letzte?.let { "${nachrichten.size}|${it.id}|${it.pending == true}|${it.text}|${it.bookingStatus ?: ""}" } ?: ""
    LaunchedEffect(signatur, fokussiert) { if (nachrichten.isNotEmpty()) liste.animateScrollToItem(nachrichten.size) }

    fun aendern(id: String, f: (KiNachricht) -> KiNachricht) { nachrichten = nachrichten.map { if (it.id == id) f(it) else it } }
    fun hinweis(text: String, praefix: String) {
        nachrichten = nachrichten + KiNachricht("$praefix-${System.currentTimeMillis()}", "assistant", text, KiNachricht.uhrzeit())
    }

    fun senden() {
        val text = eingabe.trim()
        if (text.isEmpty() || sendet) return
        val jetzt = KiNachricht.uhrzeit()
        val ms = System.currentTimeMillis()
        var quelle = nachrichten
        // Bearbeitet: die alte Frage und die direkt folgende Antwort fallen weg.
        val eid = bearbeiteteID
        val idx = eid?.let { i -> quelle.indexOfFirst { it.id == i } } ?: -1
        if (eid != null && idx >= 0) {
            val weg = mutableSetOf(eid)
            if (idx + 1 < quelle.size && quelle[idx + 1].role == "assistant") weg += quelle[idx + 1].id
            quelle = quelle.filter { it.id !in weg }
        }
        val verlauf = quelle.map { it.role to it.text }
        val wartendID = "msg-ai-pending-${ms + 1}"
        nachrichten = quelle + listOf(
            KiNachricht("msg-user-$ms", "user", text, jetzt),
            KiNachricht(wartendID, "assistant", "", jetzt, pending = true),
        )
        bearbeiteteID = null
        eingabe = ""
        sendet = true
        scope.launch {
            val beginn = System.currentTimeMillis()
            val ergebnis = runCatching { KiAssistentDienst.fragen(text, verlauf) }
            // DENKZEIT_MS: so lange denkt der Assistent mindestens nach.
            val rest = 3000 - (System.currentTimeMillis() - beginn)
            if (rest > 0) delay(rest)
            if (nachrichten.none { it.id == wartendID }) { sendet = false; return@launch }
            aendern(wartendID) { n ->
                ergebnis.fold(
                    onSuccess = { a ->
                        n.copy(
                            text = a.text.ifEmpty { "Ich konnte dazu keine Antwort erzeugen." },
                            bookingProposal = a.buchungsVorschlag, bookingStatus = if (a.buchungsVorschlag == null) null else "pending",
                        )
                    },
                    onFailure = { f -> n.copy(text = "Fehler: ${f.message?.ifEmpty { null } ?: "Unbekannter KI-Fehler"}") },
                ).copy(pending = null, time = KiNachricht.uhrzeit())
            }
            sendet = false
        }
    }

    fun kopieren(n: KiNachricht) {
        val wert = n.text.trim()
        if (wert.isEmpty()) return
        ablage.setText(AnnotatedString(wert))
        kopierteID = n.id
        scope.launch { delay(1200); if (kopierteID == n.id) kopierteID = null }
    }

    fun buchen(id: String, v: KiBuchungsVorschlag) {
        if (!v.hatPflichtfelder) {
            hinweis("Für diese Buchung fehlen noch Pflichtfelder (Start, Ziel oder Zeit).", "msg-ai-booking-error")
            return
        }
        aendern(id) { it.copy(bookingStatus = "saving") }
        scope.launch {
            try {
                val buchen = fahrtBuchen ?: throw IllegalStateException("Buchungsfunktion ist nicht verbunden.")
                val fahrtID = buchen(v)
                aendern(id) { it.copy(bookingStatus = "booked", bookingRideId = fahrtID?.trim()?.ifEmpty { null }) }
                hinweis("Fahrt wurde gebucht. In Alle Fahrten ist sie jetzt mit KI-Badge markiert.", "msg-ai-booked")
            } catch (e: Exception) {
                if (e is kotlinx.coroutines.CancellationException) throw e
                aendern(id) { it.copy(bookingStatus = "pending") }
                hinweis("Buchung fehlgeschlagen: ${e.message?.ifEmpty { null } ?: "Unbekannter Fehler"}", "msg-ai-booking-failed")
            }
        }
    }

    Box(Modifier.fillMaxSize().background(Color.Black)) {
        DispoHintergrund()
        BoxWithConstraints(Modifier.fillMaxSize()) {
            val breite = minOf(402f, maxWidth.value)
            Box(Modifier.width(breite.dp).fillMaxSize().align(Alignment.TopCenter)) {
                Column(Modifier.fillMaxSize().imePadding()) {
                    // CHAT_TOP = 60 + 50 + 30
                    Spacer(Modifier.height(140.dp))
                    val bearbeitetIndex = bearbeiteteID?.let { i -> nachrichten.indexOfFirst { it.id == i } }?.takeIf { it >= 0 }
                    LazyColumn(
                        Modifier.weight(1f).fillMaxWidth(), state = liste,
                        verticalArrangement = Arrangement.spacedBy(12.dp),
                        contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 20.dp),
                    ) {
                        itemsIndexed(nachrichten, key = { _, n -> n.id }) { index, n ->
                            // Spaetere Nachrichten treten beim Bearbeiten zurueck.
                            val zurueckgetreten = bearbeitetIndex != null && index > bearbeitetIndex
                            val deckung by animateFloatAsState(if (zurueckgetreten) 0.35f else 1f, tween(420, easing = CubicBezierEasing(0.37f, 0f, 0.18f, 1f)), label = "zurueck")
                            Box(Modifier.fillMaxWidth().alpha(deckung)) {
                                when {
                                    n.role == "user" -> Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.CenterEnd) {
                                        NutzerBlase(n, kopierteID == n.id, bearbeiteteID == n.id, { kopieren(n) }) {
                                            bearbeiteteID = n.id
                                            eingabe = n.text
                                            runCatching { fokus.requestFocus() }
                                        }
                                    }
                                    n.pending == true -> Box(Modifier.padding(4.dp)) { KiDenktSymbol() }
                                    else -> Column {
                                        AssistentBlase(n, kopierteID == n.id, { kopieren(n) }) { nummer ->
                                            runCatching { ctx.startActivity(Intent(Intent.ACTION_DIAL, Uri.parse("tel:$nummer"))) }
                                        }
                                        n.stoerungTag?.let { tag ->
                                            // Demo-Stoerung: Link in den Planer. Live entstehen solche Nachrichten derzeit nicht.
                                            Box(
                                                Modifier.padding(top = 20.dp).fillMaxWidth().height(51.dp).background(kiLime).tippen { oeffneNeuplanung(tag) },
                                                contentAlignment = Alignment.Center,
                                            ) { PText("Neuplanung im Planer ansehen", 20f, 700, Color.Black, -0.5f) }
                                        }
                                        n.bookingProposal?.let { v -> Buchung(n, v, { buchen(n.id, v) }, { aendern(n.id) { it.copy(bookingStatus = "cancelled") } }, oeffneFahrt) }
                                    }
                                }
                            }
                        }
                        item { Spacer(Modifier.height(1.dp)) }
                    }
                    Spacer(Modifier.height(12.dp)) // COMPOSER_GAP
                    Row(
                        Modifier.width(362.dp).align(Alignment.CenterHorizontally).background(Color.Black.copy(alpha = 0.6f)),
                        verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        Box(
                            Modifier.weight(1f).heightIn(min = 48.dp).background(hex(0x242425), RoundedCornerShape(20.dp))
                                .border(1.dp, hex(0x3F3F46), RoundedCornerShape(20.dp)).padding(horizontal = 16.dp, vertical = 12.dp),
                            contentAlignment = Alignment.CenterStart,
                        ) {
                            if (eingabe.isEmpty()) PText("Nachricht schreiben...", 16f, 400, hex(0x868786))
                            BasicTextField(
                                eingabe,
                                { neu ->
                                    // Enter schickt ab wie im Web (keydown Enter ohne Shift).
                                    if (neu.endsWith("\n") && neu.length == eingabe.length + 1) { eingabe = neu.dropLast(1); senden() } else eingabe = neu
                                },
                                textStyle = grotesk(16f, zeilenHoehe = 24f, farbe = Color.White),
                                cursorBrush = SolidColor(Color.White),
                                maxLines = 5,
                                keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences, imeAction = ImeAction.Send),
                                keyboardActions = KeyboardActions(onSend = { senden() }),
                                modifier = Modifier.fillMaxWidth().focusRequester(fokus).onFocusChanged { fokussiert = it.isFocused },
                            )
                        }
                        KiAktionen(
                            bearbeitet = bearbeiteteID != null, sendenAktiv = eingabe.isNotBlank() && !sendet,
                            abbrechen = { bearbeiteteID = null; eingabe = "" }, senden = { senden() },
                        )
                    }
                    // Ohne Tastatur 175 ueber dem Rand, mit Tastatur 8 darueber.
                    Spacer(Modifier.height(if (fokussiert) 8.dp else 175.dp))
                }
                // Kopf
                Box(Modifier.padding(top = 60.dp).fillMaxWidth().height(50.dp)) {
                    ZurueckKnopf(Modifier.padding(start = 20.dp)) {
                        fokusVerwalter.clearFocus()
                        if (zurueck != null) zurueck() else zeigen(DispoZiel.START)
                    }
                    Box(Modifier.align(Alignment.Center)) { KiMarke() }
                }
            }
        }
        if (!fokussiert) Navileiste(DispoZiel.KI_ASSISTENT, zeigen)
    }
}

/** KI-Symbol (14 x 13) + "KI-Assistent" in Lime, 10 px fett. */
@Composable
private fun KiMarke() {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        Icon("KI_Trisar_Icons_01_Lime", Modifier.size(14.dp, 13.dp), skalierung = ContentScale.FillBounds)
        Box(Modifier.height(16.dp), contentAlignment = Alignment.Center) { PText("KI-Assistent", 10f, 700, kiLime) }
    }
}

/** Wartende Antwort: pulsierendes KI-Symbol (animate-pulse). */
@Composable
private fun KiDenktSymbol() {
    val t = rememberInfiniteTransition(label = "denkt")
    val hell by t.animateFloat(1f, 0.5f, infiniteRepeatable(tween(1000, easing = CubicBezierEasing(0.4f, 0f, 0.6f, 1f)), RepeatMode.Reverse), label = "puls")
    Icon("KI_Trisar_Icons_01_Lime", Modifier.size(20.dp, 19.dp).alpha(hell), skalierung = ContentScale.FillBounds)
}

@Composable
private fun SymbolKnopf(aktiv: Boolean, farbe: Color, aktion: () -> Unit, symbol: @Composable (Color) -> Unit) {
    val groesse by animateFloatAsState(if (aktiv) 1.25f else 1f, spring(dampingRatio = 0.55f, stiffness = 500f), label = "symbol")
    Box(Modifier.size(28.dp).tippen(aktion), contentAlignment = Alignment.Center) {
        Box(Modifier.size(16.dp).scale(groesse)) { symbol(farbe) }
    }
}

@Composable
private fun NutzerBlase(n: KiNachricht, kopiert: Boolean, bearbeitet: Boolean, kopieren: () -> Unit, bearbeiten: () -> Unit) {
    val form = RoundedCornerShape(topStart = 16.dp, topEnd = 16.dp, bottomEnd = 6.dp, bottomStart = 16.dp)
    Column(Modifier.width(314.dp).background(kiLime, form).padding(start = 12.dp, end = 12.dp, top = 12.dp, bottom = 8.dp)) {
        SelectionContainer { Text(n.text, style = grotesk(16f, 500, farbe = Color.Black), modifier = Modifier.fillMaxWidth()) }
        Row(Modifier.padding(top = 12.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.height(16.dp), contentAlignment = Alignment.Center) { PText(n.time, 10f, 400, Color.Black.copy(alpha = 0.6f)) }
            Spacer(Modifier.weight(1f))
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                SymbolKnopf(kopiert, Color.Black.copy(alpha = 0.9f), kopieren) { if (kopiert) SymbolHaken(it) else SymbolKopieren(it) }
                SymbolKnopf(bearbeitet, Color.Black.copy(alpha = 0.9f), bearbeiten) { SymbolStift(bearbeitet, it) }
            }
        }
    }
}

@Composable
private fun AssistentBlase(n: KiNachricht, kopiert: Boolean, kopieren: () -> Unit, anrufen: (String) -> Unit) {
    val form = RoundedCornerShape(topStart = 16.dp, topEnd = 16.dp, bottomEnd = 16.dp, bottomStart = 6.dp)
    Column(Modifier.width(314.dp).background(hex(0x242525), form).border(1.dp, hex(0x3A3A3A), form).padding(start = 12.dp, end = 12.dp, top = 12.dp, bottom = 8.dp)) {
        Box(Modifier.padding(bottom = 12.dp)) { KiMarke() }
        val text = mitTelefonLinks(n.text)
        SelectionContainer {
            @Suppress("DEPRECATION")
            ClickableText(text, style = grotesk(16f, farbe = Color.White), modifier = Modifier.fillMaxWidth()) { pos ->
                text.getStringAnnotations("tel", pos, pos).firstOrNull()?.let { anrufen(it.item) }
            }
        }
        Row(Modifier.padding(top = 12.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.height(16.dp), contentAlignment = Alignment.Center) { PText(n.time, 10f, 400, Color.White.copy(alpha = 0.4f)) }
            Spacer(Modifier.weight(1f))
            SymbolKnopf(kopiert, Color.White.copy(alpha = 0.9f), kopieren) { if (kopiert) SymbolHaken(kiLime) else SymbolKopieren(it) }
        }
    }
}

@Composable
private fun Buchung(n: KiNachricht, v: KiBuchungsVorschlag, buchen: () -> Unit, verwerfen: () -> Unit, oeffneFahrt: (String) -> Unit) {
    Column(Modifier.padding(top = 12.dp).width(362.dp)) {
        KiBuchungsKarte(v)
        when (n.bookingStatus) {
            "pending" -> Row(Modifier.padding(top = 12.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Box(Modifier.weight(1f).height(51.dp).background(hex(0xE3F754)).tippen(buchen), contentAlignment = Alignment.Center) {
                    PText("buchen", 24f, 700, Color.Black, -0.5f)
                }
                Box(Modifier.weight(1f).height(51.dp).border(2.dp, hex(0xFF6F63), RectangleShape).tippen(verwerfen), contentAlignment = Alignment.Center) {
                    PText("nicht buchen", 24f, 700, hex(0xFF6F63), -0.5f)
                }
            }
            "saving" -> PText("Buchung wird gespeichert...", 11f, 500, kiLime, modifier = Modifier.padding(top = 12.dp))
            "booked" -> Column(Modifier.padding(top = 12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                PText("Gebucht", 11f, 500, hex(0x59BE80))
                Box(
                    Modifier.fillMaxWidth().height(44.dp).background(kiLime).tippen {
                        val id = (n.bookingRideId ?: "").trim()
                        if (id.isNotEmpty()) oeffneFahrt(id)
                    },
                    contentAlignment = Alignment.Center,
                ) { PText("Fahrt bearbeiten", 14f, 700, Color.Black) }
            }
            "cancelled" -> PText("Buchung verworfen", 11f, 500, Color.White.copy(alpha = 0.7f), modifier = Modifier.padding(top = 12.dp))
            else -> {}
        }
    }
}

/** BookingPreviewCard */
@Composable
private fun KiBuchungsKarte(v: KiBuchungsVorschlag) {
    val r = v.datum.trim()
    val datum = if (Regex("""^\d{4}-\d{2}-\d{2}$""").matches(r)) "${r.substring(8, 10)}.${r.substring(5, 7)}" else "--.--"
    val gast = v.fahrgaeste.ifEmpty { "Noch keine Gäste angegeben" }
    val fahrer = if (v.fahrerNamen.isEmpty()) "Fahrer fehlt" else v.fahrerNamen.joinToString(", ")
    Box(Modifier.fillMaxWidth().heightIn(min = 144.dp).background(Color.White)) {
        Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
            PAbsatz(gast, 24f, 700, 26f, Color.Black, modifier = Modifier.padding(end = 86.dp))
            PAbsatz("${v.start} - ${v.ziel}", 12f, 500, 16f, Color.Black.copy(alpha = 0.8f))
            PAbsatz(fahrer, 16f, 700, 24f, Color.Black)
        }
        Column(Modifier.align(Alignment.TopEnd).padding(top = 18.dp, end = 16.dp), horizontalAlignment = Alignment.End) {
            Box(Modifier.height(20.dp), contentAlignment = Alignment.Center) { PText(datum, 16f, 700, Color.Black) }
            Box(Modifier.height(20.dp), contentAlignment = Alignment.Center) { PText(v.startZeit.ifEmpty { "--:--" }, 16f, 400, Color.Black) }
        }
        Icon("Arrow_Trisar_Icons_01", Modifier.align(Alignment.BottomEnd).padding(end = 16.dp, bottom = 18.dp).size(34.dp, 21.dp).scale(1.2f), skalierung = ContentScale.FillBounds)
    }
}

/** Senden-Knopf und beim Bearbeiten der rote Abbrechen-Knopf links daneben (.ki-aktionen). */
@Composable
private fun KiAktionen(bearbeitet: Boolean, sendenAktiv: Boolean, abbrechen: () -> Unit, senden: () -> Unit) {
    val weich = tween<Float>(860, easing = CubicBezierEasing(0.37f, 0f, 0.18f, 1f))
    val breite by animateFloatAsState(if (bearbeitet) 108f else 48f, weich, label = "breite")
    val anteil by animateFloatAsState(if (bearbeitet) 1f else 0f, weich, label = "abbrechen")
    Box(Modifier.size(breite.dp, 48.dp), contentAlignment = Alignment.CenterEnd) {
        Box(
            Modifier.offset(x = (-60f * anteil).dp).size(48.dp).scale(0.45f + 0.55f * anteil).alpha(anteil)
                .then(if (bearbeitet) Modifier.tippen(abbrechen) else Modifier)
        ) { Icon("Abbrechen_Rund_Trisar_01", Modifier.size(48.dp), skalierung = ContentScale.FillBounds) }
        Box(
            Modifier.size(48.dp).alpha(if (sendenAktiv) 1f else 0.5f).background(hex(if (sendenAktiv) 0xE3F754 else 0xE3F654), CircleShape)
                .tippen { if (sendenAktiv) senden() },
            contentAlignment = Alignment.Center,
        ) { Icon("Arrow_Trisar_Icons_01", Modifier.size(20.dp), skalierung = ContentScale.FillBounds) }
    }
}

// MARK: - Symbole (SVG aus KiAssistentView.jsx, viewBox 24)

@Composable
private fun SymbolKopieren(farbe: Color) {
    Canvas(Modifier.size(16.dp)) {
        val s = size.width / 24f
        drawRect(farbe, Offset(9 * s, 9 * s), androidx.compose.ui.geometry.Size(10 * s, 10 * s), style = Stroke(2 * s))
        val p = Path().apply { moveTo(5 * s, 15 * s); lineTo(5 * s, 5 * s); lineTo(15 * s, 5 * s) }
        drawPath(p, farbe, style = Stroke(2 * s))
    }
}

@Composable
private fun SymbolHaken(farbe: Color) {
    Canvas(Modifier.size(16.dp)) {
        val s = size.width / 24f
        val p = Path().apply { moveTo(5 * s, 12.5f * s); lineTo(9.5f * s, 17 * s); lineTo(19 * s, 7.5f * s) }
        drawPath(p, farbe, style = Stroke(2.4f * s, cap = StrokeCap.Square))
    }
}

@Composable
private fun SymbolStift(gefuellt: Boolean, farbe: Color) {
    Canvas(Modifier.size(16.dp)) {
        val s = size.width / 24f
        val p = Path().apply {
            moveTo(4 * s, 20 * s); lineTo(8.2f * s, 19 * s); lineTo(17.8f * s, 9.4f * s)
            quadraticTo(18.6f * s, 8.3f * s, 17.8f * s, 7.2f * s)
            lineTo(16.8f * s, 6.2f * s)
            quadraticTo(15.7f * s, 5.4f * s, 14.6f * s, 6.2f * s)
            lineTo(5 * s, 15.8f * s); close()
        }
        if (gefuellt) {
            drawPath(p, farbe, style = Fill)
            drawPath(p, farbe, style = Stroke(2 * s, join = StrokeJoin.Round))
        } else {
            drawPath(p, farbe, style = Stroke(2 * s))
            drawLine(farbe, Offset(13 * s, 7 * s), Offset(17 * s, 11 * s), 2 * s)
        }
    }
}
