package de.trisar.fahrer.haupt

import android.Manifest
import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.location.Location
import android.net.Uri
import android.os.Build
import android.os.IBinder
import android.os.Looper
import android.provider.Settings
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import com.google.android.gms.location.FusedLocationProviderClient
import com.google.android.gms.location.LocationCallback
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationResult
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import de.trisar.kern.Backend
import de.trisar.kern.FahrerProfil
import de.trisar.kern.Konfig
import io.github.jan.supabase.auth.auth
import io.github.jan.supabase.auth.status.SessionStatus
import io.github.jan.supabase.postgrest.from
import io.github.jan.supabase.postgrest.query.Columns
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import java.time.Instant

/**
 * Native Ortung wie Ortung.swift. Laeuft als Vordergrund-Dienst mit Benachrichtigung „TRISAR ortet“
 * weiter (Google Maps vorne, Bildschirm aus). Schreibt in `driver_live_locations` (alle 5 s) und
 * `driver_location_history` (alle 15 s), Quelle `android_app`.
 * Bei Ortungsart 'obd' schreibt das Handy nichts, der Tracker im Auto liefert den Standort.
 */
@SuppressLint("StaticFieldLeak")
object FahrerOrtung {
    enum class Berechtigung { UNBEKANNT, VERWEIGERT, NUR_BEIM_VERWENDEN, IMMER }

    val berechtigung = MutableStateFlow(Berechtigung.UNBEKANNT)
    val letzteSendung = MutableStateFlow<Instant?>(null)
    val gesendet = MutableStateFlow(0)
    val wartend = MutableStateFlow(0)
    val letzterFehler = MutableStateFlow<String?>(null)
    val nutztOBD = MutableStateFlow(false)
    /** Erst nach dem Profil wissen wir, ob das Handy orten soll (sonst OBD). */
    val profilGeladen = MutableStateFlow(false)
    val laeuft = MutableStateFlow(false)
    /** Fahrer kann die Ortung pausieren. Bleibt ueber App-Neustarts erhalten. */
    val eingeschaltet = MutableStateFlow(true)

    private const val SCHALTER = "ortungEingeschaltet"
    private const val VORNE_GEFRAGT = "trisar_vorne_gefragt"
    private const val IMMER_GEFRAGT = "trisar_immer_gefragt"

    private lateinit var app: Context
    private val bereich = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    var fahrerID: String? = null
        private set
    private var aktiveFahrtID: String? = null
    private var letzteLiveSendung = 0L
    private var letzterVerlaufPunkt = 0L
    private var sendetGerade = false
    private var naechsteLivePosition: Location? = null
    /** Verlaufspunkte, die noch nicht angekommen sind (Funkloch, Tiefgarage). Werden nachgeschickt. */
    private val verlaufPuffer = ArrayDeque<JsonObject>()
    private var profilTakt: Job? = null

    fun einrichten(ctx: Context) {
        if (::app.isInitialized) return
        app = ctx.applicationContext
        eingeschaltet.value = prefs().getBoolean(SCHALTER, true)
        berechtigungPruefen()
    }

    private fun prefs() = app.getSharedPreferences("trisar", Context.MODE_PRIVATE)

    fun setzeEingeschaltet(an: Boolean) {
        eingeschaltet.value = an
        prefs().edit().putBoolean(SCHALTER, an).apply()
        aktualisieren()
    }

    /** Nach Anmeldung bzw. Abmeldung aufrufen. */
    fun setzeFahrer(id: String?) {
        if (id == fahrerID) return
        fahrerID = id
        aktiveFahrtID = null
        verlaufPuffer.clear()
        wartend.value = 0
        profilGeladen.value = false
        aktualisieren()
        bereich.launch { profilUndFahrtLaden() }
    }

    /** Beim Zurueckkommen in die App: Berechtigung, Ortungsart und Fahrt sofort neu. */
    fun vordergrund() {
        berechtigungPruefen()
        bereich.launch { profilUndFahrtLaden() }
        nachschicken()
    }

    private fun erlaubt(p: String) = ContextCompat.checkSelfPermission(app, p) == PackageManager.PERMISSION_GRANTED

    fun berechtigungPruefen() {
        val vorne = erlaubt(Manifest.permission.ACCESS_FINE_LOCATION) || erlaubt(Manifest.permission.ACCESS_COARSE_LOCATION)
        val hinten = Build.VERSION.SDK_INT < 29 || erlaubt(Manifest.permission.ACCESS_BACKGROUND_LOCATION)
        berechtigung.value = when {
            vorne && hinten -> Berechtigung.IMMER
            vorne -> Berechtigung.NUR_BEIM_VERWENDEN
            prefs().getBoolean(VORNE_GEFRAGT, false) -> Berechtigung.VERWEIGERT
            else -> Berechtigung.UNBEKANNT
        }
        aktualisieren()
    }

    /** Erster Schritt („Beim Verwenden“): einmal fragen, danach ueber die Einstellungen. */
    fun vorneFragen(): Boolean {
        if (berechtigung.value != Berechtigung.UNBEKANNT) return false
        prefs().edit().putBoolean(VORNE_GEFRAGT, true).apply()
        return true
    }

    /**
     * Zweiter Schritt direkt nach „Beim Verwenden“: „Immer erlauben“, damit der Standort auch im
     * Hintergrund weiterlaeuft. Nur einmal automatisch, bei OBD-Tracker gar nicht.
     */
    fun immerFragen(): Boolean {
        if (Build.VERSION.SDK_INT < 29) return false
        if (berechtigung.value != Berechtigung.NUR_BEIM_VERWENDEN || fahrerID == null || nutztOBD.value || !profilGeladen.value) return false
        if (prefs().getBoolean(IMMER_GEFRAGT, false)) return false
        prefs().edit().putBoolean(IMMER_GEFRAGT, true).apply()
        return true
    }

    fun einstellungenOeffnen(ctx: Context) {
        ctx.startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", ctx.packageName, null))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }

    // Start/Stopp

    private fun aktualisieren() {
        if (!::app.isInitialized) return
        val darf = berechtigung.value == Berechtigung.IMMER || berechtigung.value == Berechtigung.NUR_BEIM_VERWENDEN
        // Bei OBD keine Dauerbenachrichtigung: das Handy sendet dann ohnehin nichts.
        val soll = eingeschaltet.value && fahrerID != null && darf && !nutztOBD.value
        val dienst = Intent(app, OrtungsDienst::class.java)
        if (soll && !laeuft.value) {
            runCatching { ContextCompat.startForegroundService(app, dienst) }
                .onSuccess { laeuft.value = true; profilTaktStarten() }
                .onFailure { letzterFehler.value = it.message }
        } else if (!soll && laeuft.value) {
            app.stopService(dienst)
            laeuft.value = false
            profilTakt?.cancel(); profilTakt = null
        }
    }

    /** Vom Dienst bei einem Neustart des Prozesses (START_STICKY): Fahrer aus der Sitzung holen. */
    internal fun dienstGestartet() {
        if (fahrerID != null) { laeuft.value = true; return }
        bereich.launch {
            val status = withTimeoutOrNull(15_000) {
                Backend.client.auth.sessionStatus.first { it is SessionStatus.Authenticated || it is SessionStatus.NotAuthenticated }
            }
            val id = (status as? SessionStatus.Authenticated)?.session?.user?.id
            laeuft.value = true
            if (id != null) setzeFahrer(id) else aktualisierenNachStopp()
        }
    }

    private fun aktualisierenNachStopp() {
        laeuft.value = true
        aktualisieren()
    }

    internal fun dienstBeendet() { laeuft.value = false }

    private fun profilTaktStarten() {
        profilTakt?.cancel()
        profilTakt = bereich.launch {
            while (isActive) { delay(Konfig.PROFIL_INTERVALL_MS); profilUndFahrtLaden() }
        }
    }

    // Profil und aktive Fahrt

    private suspend fun profilUndFahrtLaden() {
        val id = fahrerID ?: return
        runCatching {
            Backend.client.from("profiles").select(Columns.raw("id,first_name,last_name,tracking_mode")) {
                filter { eq("id", id) }; limit(1)
            }.liste<FahrerProfil>()
        }.onSuccess { p ->
            nutztOBD.value = p.firstOrNull()?.nutztOBD ?: false
            profilGeladen.value = true
            aktualisieren()
        }
        aktiveFahrtID = aktiveFahrt(id)
    }

    @Serializable private data class AktivZeile(val id: String, val status: String? = null, val ride_date: String? = null, val etd: String? = null)

    /** Gleiche Wahl wie die Web-App: unterwegs vor beim Gast vor offen, dann frueheste Fahrt. */
    private suspend fun aktiveFahrt(fahrer: String): String? {
        val unterwegs = setOf("in_progress", "unterwegs", "started", "on_trip", "ongoing", "active")
        val beimGast = setOf("at_pickup", "beim_pickup", "beim pickup")
        val offen = setOf("pending", "assigned", "offen", "new", "requested", "offered", "zugewiesen")
        val fahrten = runCatching {
            Backend.client.from("jobs").select(Columns.raw("id,status,ride_date,etd")) {
                filter { eq("driver_id", fahrer); isIn("status", (unterwegs + beimGast + offen).toList()) }
            }.liste<AktivZeile>()
        }.getOrNull() ?: return null
        fun rang(s: String?): Int {
            val t = s.orEmpty().lowercase()
            return if (t in unterwegs) 0 else if (t in beimGast) 1 else 2
        }
        return fahrten.sortedWith(compareBy<AktivZeile>({ rang(it.status) }, { it.ride_date.orEmpty() }, { it.etd.orEmpty() })).firstOrNull()?.id
    }

    // Senden

    internal fun neuePosition(ort: Location) {
        if (fahrerID == null || nutztOBD.value) return
        // Grobe oder veraltete Punkte nicht senden (z.B. erster Punkt aus dem Funkzellen-Cache).
        if (!ort.hasAccuracy() || ort.accuracy > 100) return
        if (kotlin.math.abs(System.currentTimeMillis() - ort.time) > 60_000) return

        if (ort.time - letzterVerlaufPunkt >= Konfig.VERLAUF_INTERVALL_MS) {
            letzterVerlaufPunkt = ort.time
            verlaufPuffer.addLast(zeile(ort, verlauf = true))
            while (verlaufPuffer.size > 2000) verlaufPuffer.removeFirst()
            wartend.value = verlaufPuffer.size
        }
        if (System.currentTimeMillis() - letzteLiveSendung >= Konfig.LIVE_INTERVALL_MS) {
            naechsteLivePosition = ort
            nachschicken()
        }
    }

    private fun nachschicken() {
        val fahrer = fahrerID ?: return
        if (sendetGerade || nutztOBD.value) return
        val live = naechsteLivePosition
        val verlauf = verlaufPuffer.take(200)
        if (live == null && verlauf.isEmpty()) return
        sendetGerade = true
        naechsteLivePosition = null
        bereich.launch {
            var fehler: String? = null
            if (live != null) {
                try {
                    Backend.client.from("driver_live_locations").upsert(zeile(live, verlauf = false, fahrer = fahrer)) { onConflict = "driver_id" }
                    letzteLiveSendung = System.currentTimeMillis()
                    letzteSendung.value = Instant.now()
                    gesendet.value += 1
                } catch (e: Exception) {
                    if (e is kotlinx.coroutines.CancellationException) throw e
                    fehler = e.message
                }
            }
            if (verlauf.isNotEmpty()) {
                try {
                    Backend.client.from("driver_location_history").insert(verlauf)
                    repeat(minOf(verlauf.size, verlaufPuffer.size)) { verlaufPuffer.removeFirst() }
                    wartend.value = verlaufPuffer.size
                } catch (e: Exception) {
                    if (e is kotlinx.coroutines.CancellationException) throw e
                    fehler = fehler ?: e.message
                }
            }
            letzterFehler.value = fehler
            sendetGerade = false
            // Was waehrend des Sendens dazukam, gleich hinterher.
            if (fehler == null && (naechsteLivePosition != null || (verlaufPuffer.isNotEmpty() && verlauf.isNotEmpty()))) nachschicken()
        }
    }

    private fun zeile(ort: Location, verlauf: Boolean, fahrer: String = fahrerID.orEmpty()): JsonObject = buildJsonObject {
        put("driver_id", JsonPrimitive(fahrer))
        put(if (verlauf) "job_id" else "active_job_id", aktiveFahrtID?.let { JsonPrimitive(it) } ?: JsonNull)
        put("lat", JsonPrimitive(ort.latitude))
        put("lng", JsonPrimitive(ort.longitude))
        put("accuracy_m", if (ort.hasAccuracy()) JsonPrimitive(ort.accuracy.toDouble()) else JsonNull)
        put("speed_mps", if (ort.hasSpeed()) JsonPrimitive(ort.speed.toDouble()) else JsonNull)
        put("heading_deg", if (ort.hasBearing()) JsonPrimitive(ort.bearing.toDouble()) else JsonNull)
        put("source", JsonPrimitive(Konfig.QUELLE))
        put("captured_at", JsonPrimitive(Instant.ofEpochMilli(ort.time).toString()))
    }
}

/** Vordergrund-Dienst mit FusedLocationProvider, damit Android die Ortung im Hintergrund nicht stoppt. */
class OrtungsDienst : Service() {
    private lateinit var client: FusedLocationProviderClient
    private val rueckruf = object : LocationCallback() {
        override fun onLocationResult(ergebnis: LocationResult) {
            ergebnis.lastLocation?.let { FahrerOrtung.neuePosition(it) }
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        FahrerOrtung.einrichten(this)
        client = LocationServices.getFusedLocationProviderClient(this)
    }

    @SuppressLint("MissingPermission")
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val vorne = ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED ||
            ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED
        try {
            ServiceCompat.startForeground(this, NUMMER, benachrichtigung(),
                if (Build.VERSION.SDK_INT >= 29) ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION else 0)
        } catch (e: Exception) {
            // Android 14 erlaubt den Standort-Dienst nur mit Berechtigung bzw. aus dem Vordergrund.
            stopSelf(); FahrerOrtung.dienstBeendet(); return START_NOT_STICKY
        }
        if (!vorne) { stopSelf(); FahrerOrtung.dienstBeendet(); return START_NOT_STICKY }
        val anfrage = LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, Konfig.LIVE_INTERVALL_MS)
            .setMinUpdateIntervalMillis(2_000)
            .setMinUpdateDistanceMeters(10f)
            .setWaitForAccurateLocation(false)
            .build()
        client.removeLocationUpdates(rueckruf)
        client.requestLocationUpdates(anfrage, rueckruf, Looper.getMainLooper())
        FahrerOrtung.dienstGestartet()
        return START_STICKY
    }

    override fun onDestroy() {
        client.removeLocationUpdates(rueckruf)
        FahrerOrtung.dienstBeendet()
        super.onDestroy()
    }

    private fun benachrichtigung(): Notification {
        val nm = getSystemService(NotificationManager::class.java)
        if (Build.VERSION.SDK_INT >= 26 && nm.getNotificationChannel(KANAL) == null) {
            nm.createNotificationChannel(NotificationChannel(KANAL, "Ortung", NotificationManager.IMPORTANCE_LOW).apply {
                description = "Standort für die Disposition"
                setShowBadge(false)
            })
        }
        val oeffnen = packageManager.getLaunchIntentForPackage(packageName)?.let {
            PendingIntent.getActivity(this, 0, it, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        }
        return NotificationCompat.Builder(this, KANAL)
            .setSmallIcon(android.R.drawable.ic_menu_mylocation)
            .setContentTitle("TRISAR ortet")
            .setContentText("Dein Standort wird an die Disposition gesendet.")
            .setOngoing(true)
            .setSilent(true)
            .setContentIntent(oeffnen)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .build()
    }

    companion object {
        private const val KANAL = "ortung"
        private const val NUMMER = 4711
    }
}
