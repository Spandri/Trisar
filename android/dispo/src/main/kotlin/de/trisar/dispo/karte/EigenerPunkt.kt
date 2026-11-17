package de.trisar.dispo.karte

import android.annotation.SuppressLint
import android.content.Context
import android.location.Location
import org.maplibre.android.location.LocationComponentActivationOptions
import org.maplibre.android.location.modes.CameraMode
import org.maplibre.android.location.modes.RenderMode
import org.maplibre.android.maps.MapLibreMap

// Blauer Standortpunkt der Dispo auf der Karte (17.11.2026, wie admin/src/shared/karte/eigenerPunkt.js):
// MapLibres LocationComponent im Standard-Stil, ohne eigene Ortung (Standorte kommen von EigenerStandort),
// ohne Beschriftung und ohne Kamera-Nachfuehren. Ohne Erlaubnis kommt kein Standort, dann kein Punkt.
internal class EigenerPunkt {
    private var letzte: Location? = null

    /** Neuer Standort von EigenerStandort. */
    fun setzen(karte: MapLibreMap?, ctx: Context?, ort: Location) {
        letzte = ort
        zeigen(karte, ctx)
    }

    /** Nach dem Laden des Stils (nachStil) und bei jedem neuen Standort. Ein Stilwechsel behaelt den Punkt. */
    @SuppressLint("MissingPermission")
    fun zeigen(karte: MapLibreMap?, ctx: Context?) {
        val ort = letzte ?: return
        val m = karte ?: return
        val c = ctx ?: return
        val stil = m.style ?: return
        val lc = m.locationComponent
        try {
            if (!lc.isLocationComponentActivated) {
                if (!stil.isFullyLoaded) return
                lc.activateLocationComponent(
                    LocationComponentActivationOptions.builder(c, stil).useDefaultLocationEngine(false).build(),
                )
                lc.cameraMode = CameraMode.NONE
                lc.renderMode = RenderMode.NORMAL
            }
            if (!lc.isLocationComponentEnabled) lc.isLocationComponentEnabled = true
            lc.forceLocationUpdate(ort)
        } catch (e: Exception) {
            // Karte gerade abgebaut oder Stil im Wechsel: beim naechsten Standort wieder versuchen.
        }
    }
}
