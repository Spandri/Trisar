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
        .fullScreenCover(isPresented: $profilOffen) {
            ProfilFluss { profilOffen = false }
                .environmentObject(anmeldung)
        }
        .onReceive(NotificationCenter.default.publisher(for: .supportOeffnen)) { _ in
            if offeneFahrt == nil && !profilOffen && !fahrzeugOffen { supportOffen = true }
        }
        .fullScreenCover(isPresented: $supportOffen) { SupportAnsicht { supportOffen = false } }
        .fullScreenCover(isPresented: $fahrzeugOffen) {
            FahrzeugAnsicht { fahrzeugOffen = false }
                .environmentObject(anmeldung)
                .environmentObject(speicher)
        }
        .fullScreenCover(item: $offeneFahrt) { fahrt in
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
