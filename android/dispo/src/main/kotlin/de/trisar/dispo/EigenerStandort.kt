package de.trisar.dispo

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.location.Location
import android.os.Handler
import android.os.Looper
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.google.android.gms.location.LocationCallback
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationResult
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import kotlin.math.asin
import kotlin.math.cos
import kotlin.math.pow
import kotlin.math.sin
import kotlin.math.sqrt

// Eigener Standort der Dispo (17.11.2026), Nachbau von admin/src/shared/eigenerStandort.js:
// solange die App im Vordergrund ist und jemand zuschaut (Dispo-Karte, "Ankuenfte bei mir" mit
// Ort automatisch), laufend vom Geraet geholt. Bleibt im Geraet. Ohne Erlaubnis kein Standort.

internal object EigenerStandort {
    /** Letzter Standort, bleibt auch nach dem Stoppen stehen. */
    var stand by mutableStateOf<Location?>(null); private set

    private class Hoerer(val fn: (Location) -> Unit)
    private val hoerer = mutableListOf<Hoerer>()
    private val haupt = Handler(Looper.getMainLooper())
    private var app: Context? = null
    private var vorne = false
    private var rueckruf: LocationCallback? = null

    fun erlaubt(ctx: Context) =
        ContextCompat.checkSelfPermission(ctx, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED ||
            ContextCompat.checkSelfPermission(ctx, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED

    /** Laufend Standorte bekommen. Ein schon bekannter kommt gleich danach. Gibt das Abmelden zurueck. */
    fun abonnieren(fn: (Location) -> Unit): () -> Unit {
        val h = Hoerer(fn)
        hoerer += h
        stand?.let { l -> haupt.post { if (h in hoerer) h.fn(l) } }
        pruefen()
        return {
            hoerer.remove(h)
            pruefen()
        }
    }

    /** App im Vordergrund oder nicht (EigenerStandortWache). */
    fun vordergrund(ctx: Context, an: Boolean) {
        app = ctx.applicationContext
        vorne = an
        pruefen()
    }

    /** Starten oder stoppen, je nach Vordergrund, Zuschauern und Erlaubnis. */
    fun pruefen() {
        val ctx = app ?: return
        val soll = vorne && hoerer.isNotEmpty() && erlaubt(ctx)
        if (soll && rueckruf == null) starten(ctx)
        if (!soll && rueckruf != null) stoppen(ctx)
    }

    @SuppressLint("MissingPermission")
    private fun starten(ctx: Context) {
        val dienst = LocationServices.getFusedLocationProviderClient(ctx)
        val r = object : LocationCallback() {
            override fun onLocationResult(ergebnis: LocationResult) {
                ergebnis.lastLocation?.let { neu(it) }
            }
        }
        rueckruf = r
        try {
            dienst.requestLocationUpdates(
                LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, 10_000).setMinUpdateIntervalMillis(5_000).build(),
                r, Looper.getMainLooper(),
            )
            // Wie maximumAge 15000 im Web: ein frischer bekannter Standort gilt sofort.
            dienst.lastLocation.addOnSuccessListener { l ->
                if (l != null && rueckruf === r && System.currentTimeMillis() - l.time <= 15_000 && (stand?.time ?: 0L) < l.time) neu(l)
            }
        } catch (e: SecurityException) {
            rueckruf = null
        }
    }

    private fun stoppen(ctx: Context) {
        val r = rueckruf ?: return
        rueckruf = null
        LocationServices.getFusedLocationProviderClient(ctx).removeLocationUpdates(r)
    }

    private fun neu(l: Location) {
        stand = l
        for (h in hoerer.toList()) h.fn(l)
    }
}

/** Luftlinie in Metern (abstandM in eigenerStandort.js). */
internal fun abstandM(lat1: Double, lng1: Double, lat2: Double, lng2: Double): Double {
    val r = 6_371_000.0
    fun rad(g: Double) = g * Math.PI / 180
    val dLat = rad(lat2 - lat1)
    val dLng = rad(lng2 - lng1)
    val h = sin(dLat / 2).pow(2) + cos(rad(lat1)) * cos(rad(lat2)) * sin(dLng / 2).pow(2)
    return 2 * r * asin(sqrt(h))
}

/** Meldet Vordergrund und Hintergrund der App an EigenerStandort. Einmal in der angemeldeten App. */
@Composable
internal fun EigenerStandortWache() {
    val ctx = LocalContext.current
    val lebenszyklus = LocalLifecycleOwner.current.lifecycle
    DisposableEffect(lebenszyklus) {
        val beobachter = LifecycleEventObserver { _, e ->
            when (e) {
                Lifecycle.Event.ON_START -> EigenerStandort.vordergrund(ctx, true)
                // Erlaubnis kann inzwischen erteilt sein (Abfrage oder Einstellungen).
                Lifecycle.Event.ON_RESUME -> EigenerStandort.pruefen()
                Lifecycle.Event.ON_STOP -> EigenerStandort.vordergrund(ctx, false)
                else -> {}
            }
        }
        lebenszyklus.addObserver(beobachter)
        onDispose {
            lebenszyklus.removeObserver(beobachter)
            EigenerStandort.vordergrund(ctx, false)
        }
    }
}
