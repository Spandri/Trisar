package de.trisar.fahrer.fahrt

import android.Manifest
import android.annotation.SuppressLint
import android.content.pm.PackageManager
import android.os.Looper
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.State
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalContext
import androidx.core.content.ContextCompat
import com.google.android.gms.location.LocationCallback
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationResult
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import de.trisar.kern.GeoPunkt

/** Eigener Standort mit Zeitpunkt (ms), wie ortung.letztePosition in iOS. */
internal data class FahrtPosition(val ort: GeoPunkt, val zeit: Long)

/**
 * Standort nur zum Anzeigen, solange die Fahrt offen ist (schreibt nichts in die Datenbank,
 * das macht die Ortung der App). Ohne Erlaubnis bleibt er leer, dann gilt der Standort aus der Datenbank.
 */
@SuppressLint("MissingPermission")
@Composable
internal fun rememberFahrtStandort(): State<FahrtPosition?> {
    val ctx = LocalContext.current
    val zustand = remember { mutableStateOf<FahrtPosition?>(null) }
    DisposableEffect(ctx) {
        val erlaubt = ContextCompat.checkSelfPermission(ctx, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED ||
            ContextCompat.checkSelfPermission(ctx, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED
        if (!erlaubt) return@DisposableEffect onDispose { }
        val dienst = LocationServices.getFusedLocationProviderClient(ctx)
        val rueckruf = object : LocationCallback() {
            override fun onLocationResult(r: LocationResult) {
                val l = r.lastLocation ?: return
                zustand.value = FahrtPosition(GeoPunkt(l.latitude, l.longitude), l.time)
            }
        }
        runCatching {
            dienst.lastLocation.addOnSuccessListener { l ->
                if (l != null && zustand.value == null) zustand.value = FahrtPosition(GeoPunkt(l.latitude, l.longitude), l.time)
            }
            dienst.requestLocationUpdates(
                LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, 5_000L).setMinUpdateDistanceMeters(10f).build(),
                rueckruf, Looper.getMainLooper(),
            )
        }
        onDispose { dienst.removeLocationUpdates(rueckruf) }
    }
    return zustand
}
