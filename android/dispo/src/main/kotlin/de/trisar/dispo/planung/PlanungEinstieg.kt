package de.trisar.dispo.planung

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import de.trisar.dispo.DispoZiel
import de.trisar.dispo.Navileiste

/** Unterseiten, die die Planung selbst oeffnet (wie die Overlays in KiPlanerDemoView). */
private sealed interface PlanUnterseite {
    data class Einstellungen(val anzahl: Int) : PlanUnterseite
    data class Simulation(val eintrag: NebenSimEintrag) : PlanUnterseite
    data class Ereignisse(val tag: String) : PlanUnterseite
    data class Puffer(val tag: String, val option: String, val titel: String) : PlanUnterseite
}

/** Ablage, Planer-Tabellen und Risikodaten einmal einrichten (braucht den Context). */
@Composable
private fun PlanungEinrichten() {
    val ctx = LocalContext.current
    remember {
        PlanAblage.einrichten(ctx)
        EinsatzSpeicher.laden()
        EinsatzPlanerDienst.einrichten(ctx)
        NebenRisikoSpeicher.einrichten(ctx)
        true
    }
}

/**
 * Planung (PlanungAnsicht.swift, admin.trisar.de view 'kiPlaner'): Ablauf Uebersicht (mit fertigem Einsatz) oder
 * Kalender -> Bedarf -> Tagesplanung -> Uebersicht. Unten die Navigationsleiste; in der Tagesplanung zeigt das
 * Kartensymbol den geplanten Tag auf der Karte. Einstellungen und Fahrt-Simulation liegen ohne Animation darueber.
 * Ereignisse und Puffer sind im Web nur in der Demo erreichbar und werden live nie geoeffnet.
 */
@Composable
fun PlanungSeite(zeigen: (DispoZiel) -> Unit, @Suppress("UNUSED_PARAMETER") oeffneFahrt: (String) -> Unit) {
    PlanungEinrichten()
    val modell = remember { EinsatzPlanungModell() }
    DisposableEffect(Unit) {
        modell.starten()
        onDispose { modell.stoppen() }
    }
    var unterseite by remember { mutableStateOf<PlanUnterseite?>(null) }

    // Sind alle Tage uebernommen, geht es nach einem Moment in die Uebersicht.
    val uebersichtSchluessel = "${modell.ablauf}|${modell.tagAusUebersicht}|${modell.alleTageFertig}|${modell.laeuft}"
    LaunchedEffect(uebersichtSchluessel) { modell.vielleichtZurUebersicht() }
    LaunchedEffect(modell.ablauf) { if (modell.ablauf != EinsatzPlanungModell.Ablauf.TAG) modell.tagesKarte = false }

    BackHandler(enabled = unterseite != null || modell.tagesKarte) {
        if (unterseite != null) unterseite = null else modell.tagesKarte = false
    }

    Box(Modifier.fillMaxSize().background(Color.Black)) {
        when (modell.ablauf) {
            EinsatzPlanungModell.Ablauf.UEBERSICHT -> {
                val e = modell.einsatz
                if (e != null && e.tage.isNotEmpty()) {
                    key("uebersicht-${modell.uebersichtIndex}") {
                        EinsatzUebersichtAnsicht(
                            tage = e.tage,
                            vorschlaegeJeTag = e.tage.associateWith { modell.sichtbar(it) },
                            startIndex = modell.uebersichtIndex,
                            zurueck = { zeigen(DispoZiel.START) },
                            neuePlanung = { modell.ablauf = EinsatzPlanungModell.Ablauf.KALENDER },
                            tagOeffnen = { modell.einsatzTagOeffnen(it) },
                        )
                    }
                }
            }
            EinsatzPlanungModell.Ablauf.KALENDER -> EinsatzKalenderAnsicht(
                heuteIso = modell.heute,
                tageMitFahrten = modell.tageMitFahrten,
                anfang = modell.kalenderAuswahl,
                zurueck = {
                    if (modell.einsatz?.tage?.isNotEmpty() == true) modell.ablauf = EinsatzPlanungModell.Ablauf.UEBERSICHT
                    else zeigen(DispoZiel.START)
                },
                einstellungen = { unterseite = PlanUnterseite.Einstellungen(modell.alleFahrerAnzahl) },
                weiter = { modell.zeitraumPlanen(it) },
            )
            EinsatzPlanungModell.Ablauf.BEDARF -> if (modell.planTage.isNotEmpty()) EinsatzBedarfAnsicht(modell)
            EinsatzPlanungModell.Ablauf.TAG -> if (modell.planTage.isNotEmpty()) {
                EinsatzTagAnsicht(modell) { vorschlag, _, dauer ->
                    unterseite = PlanUnterseite.Simulation(NebenSimEintrag.aus(vorschlag, dauer))
                }
            }
        }
        val iso = modell.aktuellerTag
        if (modell.ablauf == EinsatzPlanungModell.Ablauf.TAG && modell.tagesKarte && iso != null) {
            key(iso) {
                EinsatzTagKarteAnsicht(iso, modell.sichtbar(iso), modell.fahrerListe, modell.tagesKarteSignal) { modell.tagesKarte = false }
            }
        }
        Navileiste(if (modell.tagesKarte) DispoZiel.KARTE else DispoZiel.PLANUNG) { ziel ->
            if (ziel == DispoZiel.KARTE && modell.ablauf == EinsatzPlanungModell.Ablauf.TAG) {
                // In der Tagesplanung zeigt das Kartensymbol den geplanten Tag.
                if (modell.tagesKarte) modell.tagesKarteSignal += 1 else modell.tagesKarte = true
            } else {
                zeigen(ziel)
            }
        }

        val schliessen = { unterseite = null }
        when (val u = unterseite) {
            is PlanUnterseite.Einstellungen -> PlanerEinstellungenSeite(u.anzahl, schliessen)
            is PlanUnterseite.Simulation -> key(u.eintrag) { FahrtSimulationAnsicht(u.eintrag, schliessen) }
            is PlanUnterseite.Ereignisse -> EreignisseAnsicht(u.tag, schliessen)
            is PlanUnterseite.Puffer -> PufferAnsicht(u.tag, u.option, u.titel, schliessen)
            null -> {}
        }
    }
}

/** KI-Assistent (KiAssistentAnsicht.swift, view 'kiAssistent').  */
@Composable
fun KiAssistentSeite(zeigen: (DispoZiel) -> Unit, oeffneFahrt: (String) -> Unit) {
    PlanungEinrichten()
    KiAssistentAnsicht(zeigen = zeigen, oeffneFahrt = oeffneFahrt)
}
