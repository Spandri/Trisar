package de.trisar.dispo.stamm

import androidx.compose.runtime.Composable
import de.trisar.dispo.DispoZiel

// Einstiege der Stammdaten-Seiten fuer den Seitenwechsel der Dispo-App (wie DispoHaupt in iOS).

/** Alle Fahrer mit Planungsuebersicht, Anlegen und Bearbeiten (FahrerBereichAnsicht.swift). */
@Composable
fun FahrerBereich(zeigen: (DispoZiel) -> Unit) = FahrerBereichSeite(zeigen)

/** Fahrzeugliste, Filter, Anlegen und Bearbeiten (FahrzeugBereichAnsicht.swift). */
@Composable
fun FahrzeugBereich(zeigen: (DispoZiel) -> Unit) = FahrzeugBereichSeite(zeigen)

/**
 * Fahrgaeste mit Anlegen und Bearbeiten (KundenBereichAnsicht.swift).
 * `importieren` oeffnet den Kunden-Import (ImportAnsicht mit Modus Gaeste), den der Aufrufer zeigt.
 */
@Composable
fun KundenBereich(zeigen: (DispoZiel) -> Unit, importieren: () -> Unit = {}) = KundenBereichSeite(zeigen, importieren)

/** Profil der Disposition mit Ansprechpartner, Verlauf und Einstellungen (KoordinatorProfilAnsicht.swift). */
@Composable
fun KoordinatorProfil(zeigen: (DispoZiel) -> Unit) = KoordinatorProfilSeite(zeigen)

/** Feste Beispielliste aus FahrerListeView.jsx (FahrerListeAnsicht.swift), im Web ohne Einstieg. */
@Composable
fun FahrerListe(zeigen: (DispoZiel) -> Unit) = FahrerListeSeite(zeigen)
