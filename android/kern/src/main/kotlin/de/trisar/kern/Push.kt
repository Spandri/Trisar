package de.trisar.kern

import android.Manifest
import android.app.Activity
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.ActivityCompat
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.google.firebase.FirebaseApp
import com.google.firebase.FirebaseOptions
import com.google.firebase.messaging.FirebaseMessaging
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import io.github.jan.supabase.postgrest.from
import io.github.jan.supabase.postgrest.postgrest
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.tasks.await
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * Push-Mitteilungen wie Push.swift in iOS. Nach dem Anmelden: Erlaubnis (Android 13+) holen
 * und das Geraet in push_geraete eintragen, beim Abmelden austragen. Der Server
 * (push-dienst.js) schickt ueber FCM. Ein Tipp auf eine Mitteilung legt das Ziel in [ziel] ab.
 *
 * Firebase wird ohne google-services-Plugin eingerichtet: die Werte kommen aus BuildConfig
 * der App (beim Bauen aus push-schluessel/google-services.json gelesen). Fehlen sie, bleibt
 * Push einfach aus.
 */
object Push {
    const val KANAL = "trisar"
    private val bereich = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    /** Ziel aus der zuletzt angetippten Mitteilung ("ziel", "job_id", "kolonne_id", ...). */
    val ziel = MutableStateFlow<Map<String, String>?>(null)

    private var app = "fahrer"
    private var aktiv = false
    private var token: String? = null
    private var angemeldet = false

    fun einrichten(ctx: Context, app: String, appId: String, apiKey: String, projektId: String, senderId: String) {
        this.app = app
        if (appId.isBlank() || apiKey.isBlank() || projektId.isBlank()) return
        if (FirebaseApp.getApps(ctx).isEmpty()) {
            FirebaseApp.initializeApp(ctx, FirebaseOptions.Builder()
                .setApplicationId(appId).setApiKey(apiKey).setProjectId(projektId).setGcmSenderId(senderId).build())
        }
        aktiv = true
        val nm = ctx.getSystemService(NotificationManager::class.java)
        if (nm.getNotificationChannel(KANAL) == null) {
            nm.createNotificationChannel(NotificationChannel(KANAL, "TRISAR", NotificationManager.IMPORTANCE_HIGH).apply {
                description = "Fahrten, Änderungen, Chat und Erinnerungen"
            })
        }
    }

    /** Nach erfolgreicher Anmeldung: Erlaubnis anfragen und Token melden. */
    fun nachAnmeldung(aktivitaet: Activity) {
        angemeldet = true
        if (!aktiv) return
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(aktivitaet, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(aktivitaet, arrayOf(Manifest.permission.POST_NOTIFICATIONS), 4711)
        }
        bereich.launch {
            runCatching { FirebaseMessaging.getInstance().token.await() }.getOrNull()?.let { tokenNeu(it) }
        }
    }

    internal fun tokenNeu(neu: String) {
        token = neu
        if (angemeldet) bereich.launch { melden() }
    }

    private suspend fun melden() {
        val t = token ?: return
        runCatching {
            Backend.client.postgrest.rpc("push_geraet_melden", buildJsonObject {
                put("p_token", t); put("p_plattform", "android"); put("p_app", app)
            })
        }
    }

    /** Vor dem Abmelden: Geraet austragen, damit kein anderes Konto Mitteilungen bekommt. */
    suspend fun abmelden() {
        angemeldet = false
        val t = token ?: return
        runCatching { Backend.client.from("push_geraete").delete { filter { eq("token", t) } } }
    }

    /** Tipp auf eine Mitteilung: Extras des Intents ins Ziel uebernehmen. */
    fun ausIntent(intent: Intent?) {
        val extras = intent?.extras ?: return
        if (extras.getString("ziel") == null) return
        ziel.value = extras.keySet().mapNotNull { k -> extras.getString(k)?.let { k to it } }.toMap()
    }

    /** Mitteilung selbst zeigen (App im Vordergrund oder reine Daten-Nachricht). */
    internal fun zeigen(ctx: Context, titel: String, text: String, daten: Map<String, String>) {
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(ctx, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return
        val start = ctx.packageManager.getLaunchIntentForPackage(ctx.packageName)?.apply {
            addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
            daten.forEach { (k, v) -> putExtra(k, v) }
        } ?: return
        val tippen = PendingIntent.getActivity(ctx, (System.currentTimeMillis() % Int.MAX_VALUE).toInt(), start,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val mitteilung = NotificationCompat.Builder(ctx, KANAL)
            .setSmallIcon(ctx.applicationInfo.icon)
            .setContentTitle(titel)
            .setContentText(text)
            .setStyle(NotificationCompat.BigTextStyle().bigText(text))
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setContentIntent(tippen)
            .build()
        runCatching { NotificationManagerCompat.from(ctx).notify((System.nanoTime() % Int.MAX_VALUE).toInt(), mitteilung) }
    }
}

/** Empfaengt Token und Mitteilungen von FCM. Im Hintergrund zeigt Android sie selbst an. */
class PushEmpfaenger : FirebaseMessagingService() {
    override fun onNewToken(token: String) = Push.tokenNeu(token)

    override fun onMessageReceived(nachricht: RemoteMessage) {
        val daten = nachricht.data
        val titel = nachricht.notification?.title ?: daten["titel"] ?: return
        val text = nachricht.notification?.body ?: daten["text"] ?: ""
        Push.zeigen(this, titel, text, daten)
    }
}

/** Arten, die man abschalten kann (Schluessel wie in push_ausgang.art), wie PushArten in iOS. */
object PushArten {
    data class Gruppe(val id: String, val titel: String, val arten: List<String>)

    val fahrer = listOf(
        Gruppe("fahrten", "Neue, geänderte und stornierte Fahrten",
            listOf("fahrt_neu", "fahrt_geaendert", "fahrt_storniert", "fahrt_entzogen", "gaeste_geaendert", "fahrt_fahrzeug")),
        Gruppe("flug", "Flug und Zug (Verspätung, Landung)",
            listOf("flug_zeit", "flug_gelandet", "flug_annulliert", "flug_umgeleitet", "zug_zeit")),
        Gruppe("chat", "Kolonnen-Chat", listOf("chat")),
        Gruppe("notiz", "Notizen zur Fahrt", listOf("notiz")),
        Gruppe("dienst", "Dienstplan", listOf("dienst_neu", "dienst_geaendert", "dienst_zurueck")),
        Gruppe("fahrzeug", "Neues Fahrzeug", listOf("fahrzeug_neu")),
        Gruppe("erinnerung", "Erinnerungen vor Fahrt und Dienst",
            listOf("erinnerung_offen", "erinnerung_beginn", "erinnerung_dienst")),
    )

    val dispo = listOf(
        Gruppe("antworten", "Fahrer nimmt an oder lehnt ab", listOf("dispo_angenommen", "dispo_abgelehnt")),
        Gruppe("dienst", "Dienstplan bestätigt oder abgelehnt", listOf("dispo_dienst_angenommen", "dispo_dienst_abgelehnt")),
        Gruppe("chat", "Kolonnen-Chat", listOf("chat")),
        Gruppe("schaden", "Schadensmeldungen", listOf("dispo_schaden")),
    )
}

@Serializable
private data class PushEinstellungZeile(val user_id: String, val aus: List<String> = emptyList())

/** Abgeschaltete Arten in push_einstellungen.aus lesen und schreiben. */
object PushEinstellungen {
    suspend fun laden(nutzer: String): Set<String> = runCatching {
        Backend.client.from("push_einstellungen").select { filter { eq("user_id", nutzer) }; limit(1) }
            .decodeList<PushEinstellungZeile>().firstOrNull()?.aus?.toSet() ?: emptySet()
    }.getOrDefault(emptySet())

    suspend fun speichern(nutzer: String, aus: Set<String>) {
        runCatching {
            Backend.client.from("push_einstellungen").upsert(PushEinstellungZeile(nutzer, aus.sorted())) {
                onConflict = "user_id"
            }
        }
    }

    fun systemErlaubt(ctx: Context) = NotificationManagerCompat.from(ctx).areNotificationsEnabled()
}

