package de.trisar.fahrer.fahrt

import android.content.Context
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
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
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import de.trisar.kern.Backend
import de.trisar.kern.CssRadial
import de.trisar.kern.Farbe
import de.trisar.kern.FussleisteUnten
import de.trisar.kern.Icon
import de.trisar.kern.ZurueckKnopf
import de.trisar.kern.grotesk
import de.trisar.kern.hex
import de.trisar.kern.tippen
import io.github.jan.supabase.postgrest.from
import io.github.jan.supabase.postgrest.query.Columns
import io.github.jan.supabase.postgrest.query.Count
import io.github.jan.supabase.postgrest.query.Order
import io.github.jan.supabase.realtime.PostgresAction
import io.github.jan.supabase.realtime.RealtimeChannel
import io.github.jan.supabase.realtime.channel
import io.github.jan.supabase.realtime.postgresChangeFlow
import io.github.jan.supabase.realtime.realtime
import io.github.jan.supabase.postgrest.query.filter.FilterOperator
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.coroutines.flow.launchIn
import kotlinx.coroutines.flow.onEach
import kotlinx.serialization.Serializable
import java.time.Instant
import java.util.UUID

/**
 * Kolonnen-Chat wie Chat.swift (KolonnenChat.jsx): Nachrichten in `messages` mit target_type
 * 'group' und target_id = convoy_id, live ueber Realtime.
 */
internal class KolonnenChat(val chatID: String, private val fahrerID: String, private val ctx: Context) {
    data class Nachricht(val id: String, val ich: Boolean, val absender: String, val text: String, val zeit: String)

    var nachrichten by mutableStateOf<List<Nachricht>>(emptyList()); private set
    var geladen by mutableStateOf(false); private set

    private var kanal: RealtimeChannel? = null
    private var beobachter: Job? = null

    @Serializable private data class Zeile(val id: String, val sender_id: String? = null, val content: String? = null, val created_at: String? = null)
    @Serializable private data class Person(val id: String, val first_name: String? = null, val last_name: String? = null)
    @Serializable private data class Neu(val sender_id: String, val target_type: String, val target_id: String, val content: String)
    @Serializable private data class Gelesen(val user_id: String, val chat_type: String, val chat_id: String, val last_read_at: String)

    suspend fun starten(scope: CoroutineScope) {
        laden()
        val k = Backend.client.channel("kolonnen-chat-$chatID")
        val strom = k.postgresChangeFlow<PostgresAction>(schema = "public") {
            table = "messages"
            filter("target_id", FilterOperator.EQ, chatID)
        }
        kanal = k
        beobachter = strom.onEach { laden() }.launchIn(scope)
        runCatching { k.subscribe() }
    }

    suspend fun beenden() {
        beobachter?.cancel()
        kanal?.let { runCatching { Backend.client.realtime.removeChannel(it) } }
        kanal = null
    }

    suspend fun laden() {
        val zeilen = runCatching {
            Backend.client.from("messages").select(Columns.raw("id,sender_id,content,created_at")) {
                filter { eq("target_type", "group"); eq("target_id", chatID) }
                order("created_at", Order.ASCENDING)
            }.decodeList<Zeile>()
        }.getOrNull()
        if (zeilen == null) { geladen = true; return }
        val andere = zeilen.mapNotNull { it.sender_id }.filter { it != fahrerID }.distinct()
        val namen = mutableMapOf<String, String>()
        if (andere.isNotEmpty()) {
            runCatching {
                Backend.client.from("profiles").select(Columns.raw("id,first_name,last_name")) { filter { isIn("id", andere) } }.decodeList<Person>()
            }.getOrNull()?.forEach { p ->
                val n = listOfNotNull(p.first_name, p.last_name).joinToString(" ").trim()
                namen[p.id] = n.ifEmpty { "Kollege" }
            }
        }
        nachrichten = zeilen.map { z ->
            Nachricht(
                id = z.id, ich = z.sender_id == fahrerID,
                absender = z.sender_id?.let { namen[it] } ?: "Kollege",
                text = z.content ?: "",
                zeit = FahrtZeit.ausISO(z.created_at)?.let { FahrtZeit.uhrzeit(it) } ?: "",
            )
        }
        geladen = true
        gelesen(ctx, chatID, fahrerID)
    }

    suspend fun senden(text: String) {
        val t = text.trim()
        if (t.isEmpty()) return
        // Sofort zeigen, die Datenbank meldet die Nachricht danach ueber Realtime zurueck.
        nachrichten = nachrichten + Nachricht(UUID.randomUUID().toString(), true, "", t, FahrtZeit.uhrzeit(Instant.now()))
        runCatching { Backend.client.from("messages").insert(Neu(fahrerID, "group", chatID, t)) }
    }

    companion object {
        // Gelesen / Ungelesen (markChatRead, refreshUnreadChatState). Gleicher Schluessel wie iOS.
        private fun schluessel(fahrer: String, chat: String) = "trisar-gelesen-${fahrer.uppercase()}-group-${chat.uppercase()}"
        private fun prefs(ctx: Context) = ctx.applicationContext.getSharedPreferences("trisar-chat", Context.MODE_PRIVATE)

        suspend fun gelesen(ctx: Context, chatID: String, fahrerID: String) {
            val jetzt = FahrtZeit.iso()
            prefs(ctx).edit().putString(schluessel(fahrerID, chatID), jetzt).apply()
            runCatching {
                Backend.client.from("chat_reads").upsert(Gelesen(fahrerID, "group", chatID, jetzt)) { onConflict = "user_id,chat_type,chat_id" }
            }
        }

        /** Anzahl Nachrichten anderer seit dem letzten Lesen. */
        suspend fun ungelesen(ctx: Context, chatID: String, fahrerID: String): Int {
            val zuletzt = prefs(ctx).getString(schluessel(fahrerID, chatID), null)
            return runCatching {
                Backend.client.from("messages").select(Columns.raw("id")) {
                    head = true
                    count(Count.EXACT)
                    filter {
                        eq("target_type", "group"); eq("target_id", chatID); neq("sender_id", fahrerID)
                        if (zuletzt != null) gt("created_at", zuletzt)
                    }
                }.countOrNull()?.toInt() ?: 0
            }.getOrDefault(0)
        }
    }
}

/**
 * Nachbau von KolonnenChatAnsicht.swift (KolonnenChat.jsx, Raster 402 x 864): Zurueck 20/60,
 * Titel mittig auf Knopfhoehe, Verlauf ab 109, Eingabe 70 ueber dem unteren Rand (mit Tastatur 12).
 */
@Composable
internal fun KolonnenChatSeite(chatID: String, fahrerID: String, titel: String, zurueck: () -> Unit) {
    val ctx = LocalContext.current
    val chat = remember(chatID) { KolonnenChat(chatID, fahrerID, ctx) }
    val scope = rememberCoroutineScope()
    var text by remember { mutableStateOf("") }
    var fokus by remember { mutableStateOf(false) }
    val liste = rememberLazyListState()
    val feld = remember { FocusRequester() }

    BackHandler { zurueck() }
    LaunchedEffect(chat) { chat.starten(this) }
    DisposableEffect(chat) {
        onDispose { fahrtAufraeumen.launch { chat.beenden() } }
    }
    LaunchedEffect(chat.nachrichten.size, fokus) {
        if (chat.nachrichten.isNotEmpty()) liste.animateScrollToItem(chat.nachrichten.size - 1)
    }

    Box(Modifier.fillMaxSize().background(Color.Black)) {
        // radial-gradient(141.42% 102.21% at 0% 0%, #313701 0%, #000 46%)
        CssRadial(1.4142f, 1.0221f, listOf(0x313701L to 0f, 0x000000L to 0.46f, 0x000000L to 1f))

        Column(Modifier.fillMaxSize().imePadding()) {
            // Kopf: Zurueck links, Titel (10 fett Lime) mittig auf Knopfhoehe.
            Box(Modifier.padding(top = 60.dp).padding(horizontal = 20.dp).fillMaxWidth().height(50.dp), contentAlignment = Alignment.Center) {
                Text(titel, style = grotesk(10f, 700, farbe = hex(0xE3F654)))
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.CenterStart) { ZurueckKnopf { zurueck() } }
            }
            LazyColumn(
                Modifier.weight(1f).fillMaxWidth(),
                state = liste,
                verticalArrangement = Arrangement.spacedBy(16.dp),
                contentPadding = androidx.compose.foundation.layout.PaddingValues(start = 20.dp, end = 20.dp, top = 16.dp, bottom = 16.dp),
            ) {
                if (chat.geladen && chat.nachrichten.isEmpty()) {
                    item {
                        Text("Noch keine Nachrichten in dieser Kolonne.", style = grotesk(14f, 500, farbe = Farbe.grauText),
                            modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp))
                    }
                }
                items(chat.nachrichten, key = { it.id }) { ChatBlase(it) }
            }

            val leer = text.isBlank()
            Row(
                Modifier.padding(horizontal = 20.dp).padding(top = 16.dp, bottom = if (fokus) 12.dp else 70.dp).fillMaxWidth()
                    .background(Color.Black.copy(alpha = 0.6f)),
                verticalAlignment = Alignment.Bottom,
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Box(
                    Modifier.weight(1f).heightIn(min = 48.dp)
                        .background(hex(0x242425), RoundedCornerShape(20.dp))
                        .border(1.dp, hex(0x3F3F46), RoundedCornerShape(20.dp))
                        // Ganzer Kasten nimmt den Tipp an, nicht nur die Textzeile (wie das label im Web).
                        .tippen { feld.requestFocus() }
                        .padding(horizontal = 16.dp, vertical = 12.dp),
                    contentAlignment = Alignment.CenterStart,
                ) {
                    BasicTextField(
                        text, { text = it },
                        textStyle = grotesk(16f),
                        cursorBrush = SolidColor(Farbe.lime),
                        maxLines = 5,
                        modifier = Modifier.fillMaxWidth().focusRequester(feld).onFocusChanged { fokus = it.isFocused },
                        decorationBox = { inner ->
                            if (text.isEmpty()) Text("Nachricht schreiben...", style = grotesk(16f, farbe = Farbe.grauText))
                            inner()
                        },
                    )
                }
                Box(
                    Modifier.size(48.dp).alpha(if (leer) 0.5f else 1f)
                        .background(if (leer) hex(0xE3F654) else hex(0xE3F754), CircleShape)
                        .tippen {
                            if (!leer) {
                                val t = text
                                text = ""
                                scope.launch { chat.senden(t) }
                            }
                        },
                    contentAlignment = Alignment.Center,
                ) {
                    Icon("Arrow_Trisar_Icons_01", Modifier.size(22.dp, 19.dp).rotate(-45f), farbe = ColorFilter.tint(Color.Black))
                }
            }
        }

        if (!fokus) FussleisteUnten()
    }
}

/** Eine Nachricht: fremde links (grau, Name darueber), eigene rechts (Lime), Uhrzeit darunter. */
@Composable
private fun ChatBlase(n: KolonnenChat.Nachricht) {
    Column(
        Modifier.fillMaxWidth(),
        horizontalAlignment = if (n.ich) Alignment.End else Alignment.Start,
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        if (!n.ich) Text(n.absender, style = grotesk(12f, 500, farbe = Farbe.grauText), modifier = Modifier.padding(start = 16.dp))
        Box(
            Modifier.widthIn(max = 256.dp).heightIn(min = 52.dp)
                .background(if (n.ich) hex(0xE3F654) else hex(0x242425), RoundedCornerShape(12.dp))
                .padding(horizontal = 16.dp, vertical = 12.dp),
            contentAlignment = Alignment.CenterStart,
        ) { Text(n.text, style = grotesk(16f, farbe = if (n.ich) Color.Black else Color.White)) }
        Text(n.zeit, style = grotesk(12f, farbe = Farbe.grauText), textAlign = TextAlign.Start,
            modifier = Modifier.width(56.dp).padding(start = 16.dp))
    }
}
