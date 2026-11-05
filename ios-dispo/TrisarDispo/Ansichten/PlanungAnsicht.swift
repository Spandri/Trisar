import SwiftUI

/// Planung auf admin.trisar.de (view 'kiPlaner'): AlleFahrer mit planerDirekt oeffnet sofort den
/// Planer (KiPlanerDemoView.jsx, Live-Zweig). Ablauf: Uebersicht (mit fertigem Einsatz) oder
/// Kalender -> Bedarf -> Tagesplanung -> Uebersicht. Unten die Navigationsleiste; in der
/// Tagesplanung zeigt das Kartensymbol den geplanten Tag auf der Karte.
///
/// Seiten, die ein anderer Teil baut, oeffnet der Aufrufer ueber die Closures:
/// - oeffneEinstellungen(gesamtzahlFahrer): KiPlanerSettingsView (Filter-Knopf im Kalender).
///   Regeln liegen als JSON-Text unter `PlanerRegeln.schluessel` ("trisar_planner_settings_v1").
/// - oeffneSimulation(vorschlag, position ab 1, rideDurationMinutes): FahrtSimulationView.
/// - oeffneEreignisse(tagIso) / oeffnePuffer(tagIso, option, optionTitel): im Web nur in der Demo
///   erreichbar (EngineBlock und Bedarf zeigen live nichts), hier darum nie ausgeloest.
struct PlanungAnsicht: View {
    let zeigen: (DispoZiel) -> Void
    var oeffneEinstellungen: (Int) -> Void = { _ in }
    var oeffneSimulation: (EinsatzVorschlag, Int, Int) -> Void = { _, _, _ in }
    var oeffneEreignisse: (String) -> Void = { _ in }
    var oeffnePuffer: (String, String, String) -> Void = { _, _, _ in }

    @StateObject private var modell = EinsatzPlanungModell()

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            seite
            if modell.ablauf == .tag && modell.tagesKarte, let iso = modell.aktuellerTag {
                EinsatzTagKarteAnsicht(tagIso: iso, vorschlaege: modell.sichtbar(iso), fahrer: modell.fahrerListe,
                                       kameraSignal: modell.tagesKarteSignal) { modell.tagesKarte = false }
                    .id(iso)
            }
            Navileiste(aktiv: modell.tagesKarte ? .karte : .planung) { ziel in
                if ziel == .karte && modell.ablauf == .tag {
                    // In der Tagesplanung zeigt das Kartensymbol den geplanten Tag.
                    if modell.tagesKarte { modell.tagesKarteSignal += 1 } else { modell.tagesKarte = true }
                } else {
                    zeigen(ziel)
                }
            }
        }
        .task { await modell.starten() }
        .onDisappear { Task { await modell.stoppen() } }
        .onChange(of: modell.ablauf) { _, neu in if neu != .tag { modell.tagesKarte = false } }
        .task(id: uebersichtSchluessel) { await modell.vielleichtZurUebersicht() }
    }

    /// Ausloeser fuer den Wechsel in die Uebersicht, sobald alle Tage uebernommen sind.
    private var uebersichtSchluessel: String {
        "\(modell.ablauf)|\(modell.tagAusUebersicht)|\(modell.alleTageFertig)|\(modell.laeuft)"
    }

    @ViewBuilder private var seite: some View {
        switch modell.ablauf {
        case .uebersicht:
            if let e = modell.einsatz, !e.tage.isEmpty {
                EinsatzUebersichtAnsicht(
                    tage: e.tage,
                    vorschlaegeJeTag: Dictionary(uniqueKeysWithValues: e.tage.map { ($0, modell.sichtbar($0)) }),
                    startIndex: modell.uebersichtIndex,
                    zurueck: { zeigen(.start) },
                    neuePlanung: { modell.ablauf = .kalender },
                    tagOeffnen: { modell.einsatzTagOeffnen($0) })
                .id("uebersicht-\(modell.uebersichtIndex)")
            }
        case .kalender:
            EinsatzKalenderAnsicht(
                heuteIso: modell.heute,
                tageMitFahrten: modell.tageMitFahrten,
                anfang: modell.kalenderAuswahl,
                zurueck: {
                    if modell.einsatz?.tage.isEmpty == false { modell.ablauf = .uebersicht } else { zeigen(.start) }
                },
                einstellungen: { oeffneEinstellungen(modell.alleFahrerAnzahl) },
                weiter: { modell.zeitraumPlanen($0) })
        case .bedarf:
            if !modell.planTage.isEmpty {
                EinsatzBedarfAnsicht(modell: modell, oeffneEreignisse: oeffneEreignisse)
            }
        case .tag:
            if !modell.planTage.isEmpty {
                EinsatzTagAnsicht(modell: modell, oeffneSimulation: oeffneSimulation,
                                  oeffneEreignisse: oeffneEreignisse, oeffnePuffer: oeffnePuffer)
            }
        }
    }
}
