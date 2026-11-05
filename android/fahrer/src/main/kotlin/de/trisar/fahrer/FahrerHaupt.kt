package de.trisar.fahrer

import android.Manifest
import android.os.Build
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import kotlinx.coroutines.launch
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.viewmodel.compose.viewModel
import de.trisar.fahrer.fahrt.FahrtSeite
import de.trisar.fahrer.fahrt.SupportSeite
import de.trisar.fahrer.haupt.EinstellungenSeite
import de.trisar.fahrer.haupt.FahrerOrtung
import de.trisar.fahrer.haupt.FahrtenListeSeite
import de.trisar.fahrer.haupt.FahrtenSpeicher
import de.trisar.fahrer.haupt.FahrzeugSeite
import de.trisar.fahrer.haupt.KeineFahrtSeite
import de.trisar.fahrer.haupt.ProfilSeite
import de.trisar.fahrer.haupt.VerlaufSeite
import de.trisar.fahrer.haupt.Vollbild
import de.trisar.kern.Anmeldung
import de.trisar.kern.SupportSignal
import de.trisar.kern.TrisarHintergrund

/** Vollbild-Seiten ueber der Hauptansicht (wie webVollbild in iOS, ohne Animation). */
private sealed interface Seite {
    data object Profil : Seite
    data object Fahrzeug : Seite
    data object Support : Seite
    data class Fahrt(val id: String) : Seite
}

/** Unterseiten des Profils (wie setView in der Web-App: profilFahrer -> verlauf / settingsFahrer / ansprechpartner). */
private enum class ProfilUnterseite { PROFIL, VERLAUF, EINSTELLUNGEN, SUPPORT }

/**
 * Bildschirmwahl nach dem Login wie HauptAnsicht.swift (renderViewScreen('list') der Web-App):
 * keine Fahrten -> „Keine Fahrt“ (mit/ohne Fahrzeug), sonst Fahrtenliste. Startet auch die Ortung
 * und fragt die Standort-Berechtigung (erst „Beim Verwenden“, danach automatisch „Immer“).
 */
@Composable
fun FahrerHaupt(anmeldung: Anmeldung, fahrerID: String) {
    val ctx = LocalContext.current
    val bereich = rememberCoroutineScope()
    val speicher: FahrtenSpeicher = viewModel()
    val geladen by speicher.geladen.collectAsState()
    val fahrten by speicher.fahrten.collectAsState()
    val fahrzeug by speicher.fahrzeug.collectAsState()
    var seite by remember { mutableStateOf<Seite?>(null) }
    var profilSeite by remember { mutableStateOf(ProfilUnterseite.PROFIL) }

    // Ortung und Berechtigungen
    val berechtigung by FahrerOrtung.berechtigung.collectAsState()
    val profilGeladen by FahrerOrtung.profilGeladen.collectAsState()
    val nutztOBD by FahrerOrtung.nutztOBD.collectAsState()
    val hintenFragen = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { FahrerOrtung.berechtigungPruefen() }
    val vorneFragen = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { FahrerOrtung.berechtigungPruefen() }

    LaunchedEffect(fahrerID) {
        FahrerOrtung.einrichten(ctx)
        FahrerOrtung.setzeFahrer(fahrerID)
        speicher.setzeFahrer(fahrerID)
        if (FahrerOrtung.vorneFragen()) {
            val liste = mutableListOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION)
            // Ohne Benachrichtigungs-Erlaubnis sieht der Fahrer „TRISAR ortet“ nicht (Android 13+).
            if (Build.VERSION.SDK_INT >= 33) liste += Manifest.permission.POST_NOTIFICATIONS
            vorneFragen.launch(liste.toTypedArray())
        }
    }
    // Zweiter Schritt direkt nach „Beim Verwenden“, sobald klar ist, dass das Handy ortet (kein OBD).
    LaunchedEffect(berechtigung, profilGeladen, nutztOBD) {
        if (FahrerOrtung.immerFragen() && Build.VERSION.SDK_INT >= 29) {
            hintenFragen.launch(Manifest.permission.ACCESS_BACKGROUND_LOCATION)
        }
    }

    // Beim Zurueckkommen in die App: Fahrten, Profil und Ortung neu (wie scenePhase .active).
    val lebenszyklus = LocalLifecycleOwner.current.lifecycle
    DisposableEffect(lebenszyklus) {
        var erstes = true
        val beobachter = LifecycleEventObserver { _, e ->
            if (e == Lifecycle.Event.ON_RESUME) {
                if (erstes) { erstes = false; return@LifecycleEventObserver }
                FahrerOrtung.vordergrund()
                speicher.neuLaden()
                bereich.launch { anmeldung.profilLaden() }
            }
        }
        lebenszyklus.addObserver(beobachter)
        onDispose { lebenszyklus.removeObserver(beobachter) }
    }
    // Abmelden: Ortung und Speicher loslassen.
    DisposableEffect(fahrerID) {
        onDispose {
            FahrerOrtung.setzeFahrer(null)
            speicher.setzeFahrer(null)
        }
    }

    // Support aus der Fussleiste: die gerade sichtbare Seite oeffnet ihn. Eine offene Fahrt setzt ihren eigenen Empfaenger.
    val aktuell = seite
    if (aktuell !is Seite.Fahrt) {
        SideEffect {
            SupportSignal.empfaenger = {
                when (seite) {
                    null -> seite = Seite.Support
                    Seite.Profil -> profilSeite = ProfilUnterseite.SUPPORT
                    else -> {}
                }
            }
        }
    }

    BackHandler(enabled = aktuell != null) {
        if (aktuell == Seite.Profil && profilSeite != ProfilUnterseite.PROFIL) profilSeite = ProfilUnterseite.PROFIL
        else seite = null
    }

    Box(Modifier.fillMaxSize()) {
        when {
            !geladen -> TrisarHintergrund()
            fahrten.isEmpty() -> KeineFahrtSeite(
                fahrzeug = fahrzeug,
                oeffneProfil = { profilSeite = ProfilUnterseite.PROFIL; seite = Seite.Profil },
                oeffneFahrzeug = { seite = Seite.Fahrzeug },
                abmelden = { anmeldung.abmelden() },
            )
            else -> FahrtenListeSeite(
                speicher = speicher,
                oeffneProfil = { profilSeite = ProfilUnterseite.PROFIL; seite = Seite.Profil },
                oeffneFahrzeug = { seite = Seite.Fahrzeug },
                oeffneFahrt = { seite = Seite.Fahrt(it.id) },
            )
        }

        when (aktuell) {
            null -> {}
            Seite.Profil -> Vollbild {
                when (profilSeite) {
                    ProfilUnterseite.PROFIL -> ProfilSeite(
                        anmeldung = anmeldung,
                        zurueck = { seite = null },
                        oeffneAnsprechpartner = { profilSeite = ProfilUnterseite.SUPPORT },
                        oeffneVerlauf = { profilSeite = ProfilUnterseite.VERLAUF },
                        oeffneEinstellungen = { profilSeite = ProfilUnterseite.EINSTELLUNGEN },
                    )
                    ProfilUnterseite.VERLAUF -> VerlaufSeite { profilSeite = ProfilUnterseite.PROFIL }
                    ProfilUnterseite.EINSTELLUNGEN -> EinstellungenSeite(anmeldung, fahrerID) { profilSeite = ProfilUnterseite.PROFIL }
                    ProfilUnterseite.SUPPORT -> SupportSeite { profilSeite = ProfilUnterseite.PROFIL }
                }
            }
            Seite.Fahrzeug -> Vollbild { FahrzeugSeite(fahrerID, fahrzeug) { seite = null } }
            Seite.Support -> Vollbild { SupportSeite { seite = null } }
            is Seite.Fahrt -> Vollbild {
                FahrtSeite(aktuell.id, fahrerID) {
                    seite = null
                    // Nach der Fahrt (beendet, abgelehnt) die Liste gleich neu.
                    speicher.neuLaden()
                }
            }
        }
    }
}
