package de.trisar.fahrer.fahrt

import androidx.compose.runtime.Composable

/**
 * Einzelne Fahrt (Solo, Flughafen, Kolonne) mit Karte, Chat und Support, wie SoloNormalAnsicht.swift.
 * SCHNITTSTELLE: Signatur nicht aendern. Aufrufer ist die Fahrtenliste (Agent "fahrer-a"),
 * Umsetzung baut der Agent "fahrer-b". Laedt ihre Daten selbst ueber fahrtID.
 */
@Composable
fun FahrtSeite(fahrtID: String, fahrerID: String, zurueck: () -> Unit) {
}
