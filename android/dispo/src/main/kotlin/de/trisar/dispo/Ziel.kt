package de.trisar.dispo

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier

/** Ziele der Dispo-App (wie DispoZiel in iOS, Ansichtsnamen aus admin/src/App.jsx). */
enum class DispoZiel { START, KARTE, FAHRTEN, FAHRZEUGE, FAHRER, KUNDEN, PLANUNG, KI_ASSISTENT, FAHRT_NEU, PROFIL }

/**
 * Feste Leiste unten (Navibar + Fussleiste), wie Navileiste.swift.
 * SCHNITTSTELLE: Signatur nicht aendern. Umsetzung baut der Agent "dispo-a".
 */
@Composable
fun Navileiste(aktiv: DispoZiel, waehlen: (DispoZiel) -> Unit) {
    Box(Modifier.fillMaxSize())
}
