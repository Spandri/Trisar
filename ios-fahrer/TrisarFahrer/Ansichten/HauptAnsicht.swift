import SwiftUI

/// Bildschirmwahl nach dem Login, wie renderViewScreen('list') der Web-App:
/// keine Fahrten -> „Keine Fahrt“ (mit/ohne Fahrzeug), sonst Fahrtenliste.
struct HauptAnsicht: View {
    @EnvironmentObject private var anmeldung: Anmeldung
    @EnvironmentObject private var speicher: FahrtenSpeicher
    @State private var profilOffen = false
    @State private var offeneFahrt: Fahrt?
    @State private var supportOffen = false
    @State private var fahrzeugOffen = false

    var body: some View {
        Group {
            if !speicher.geladen {
                TrisarHintergrund()
            } else if speicher.fahrten.isEmpty {
                KeineFahrtAnsicht(
                    fahrzeug: speicher.fahrzeug,
                    oeffneProfil: { profilOffen = true },
                    oeffneFahrzeug: { fahrzeugOffen = true },
                    abmelden: { Task { await anmeldung.abmelden() } }
                )
            } else {
                FahrtenListeAnsicht(
                    oeffneProfil: { profilOffen = true },
                    oeffneFahrzeug: { fahrzeugOffen = true },
                    oeffneFahrt: { offeneFahrt = $0 }
                )
            }
        }
        .webVollbild(isPresented: $profilOffen) {
            ProfilFluss { profilOffen = false }
                .environmentObject(anmeldung)
        }
        .onReceive(NotificationCenter.default.publisher(for: .supportOeffnen)) { _ in
            if offeneFahrt == nil && !profilOffen && !fahrzeugOffen { supportOffen = true }
        }
        .webVollbild(isPresented: $supportOffen) { SupportAnsicht { supportOffen = false } }
        .webVollbild(isPresented: $fahrzeugOffen) {
            FahrzeugAnsicht { fahrzeugOffen = false }
                .environmentObject(anmeldung)
                .environmentObject(speicher)
        }
        .onReceive(Push.shared.$ziel.compactMap { $0 }) { ziel in
            Push.shared.ziel = nil
            switch ziel["ziel"] {
            case "fahrt":
                if let id = ziel["job_id"].flatMap(UUID.init(uuidString:)),
                   let fahrt = speicher.fahrten.first(where: { $0.id == id }) {
                    profilOffen = false; supportOffen = false; fahrzeugOffen = false
                    offeneFahrt = fahrt
                }
            case "chat":
                if let id = ziel["kolonne_id"].flatMap(UUID.init(uuidString:)),
                   let fahrt = speicher.fahrten.first(where: { $0.kolonnenID == id }) {
                    profilOffen = false; supportOffen = false; fahrzeugOffen = false
                    offeneFahrt = fahrt
                }
            case "fahrzeug":
                profilOffen = false; supportOffen = false; offeneFahrt = nil
                fahrzeugOffen = true
            default:
                profilOffen = false; supportOffen = false; fahrzeugOffen = false; offeneFahrt = nil
            }
        }
        .webVollbild(item: $offeneFahrt) { fahrt in
            if let fahrer = anmeldung.fahrerID {
                SoloNormalAnsicht(fahrtID: fahrt.id, fahrerID: fahrer) { offeneFahrt = nil }
                    .environmentObject(anmeldung)
            }
        }
    }
}


/// Profil mit Unterseiten (wie setView in der Web-App: profilFahrer -> verlauf / settingsFahrer / ansprechpartner).
private struct ProfilFluss: View {
    let schliessen: () -> Void
    @State private var seite: Seite = .profil
    private enum Seite { case profil, verlauf, einstellungen, support }

    var body: some View {
        ZStack {
            switch seite {
            case .profil:
                ProfilAnsicht(zurueck: schliessen,
                              oeffneAnsprechpartner: { seite = .support },
                              oeffneVerlauf: { seite = .verlauf },
                              oeffneEinstellungen: { seite = .einstellungen })
            case .verlauf:
                VerlaufAnsicht { seite = .profil }
            case .einstellungen:
                EinstellungenAnsicht { seite = .profil }
            case .support:
                SupportAnsicht { seite = .profil }
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: .supportOeffnen)) { _ in seite = .support }
    }
}
