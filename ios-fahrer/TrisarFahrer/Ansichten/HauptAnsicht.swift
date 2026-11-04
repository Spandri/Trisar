import SwiftUI

/// Bildschirmwahl nach dem Login, wie renderViewScreen('list') der Web-App:
/// keine Fahrten -> „Keine Fahrt“ (mit/ohne Fahrzeug), sonst Fahrtenliste.
struct HauptAnsicht: View {
    @EnvironmentObject private var anmeldung: Anmeldung
    @EnvironmentObject private var speicher: FahrtenSpeicher
    @State private var profilOffen = false
    @State private var offeneFahrt: Fahrt?

    var body: some View {
        Group {
            if !speicher.geladen {
                TrisarHintergrund()
            } else if speicher.fahrten.isEmpty {
                KeineFahrtAnsicht(
                    fahrzeug: speicher.fahrzeug,
                    oeffneProfil: { profilOffen = true },
                    oeffneFahrzeug: {},
                    abmelden: { Task { await anmeldung.abmelden() } }
                )
            } else {
                FahrtenListeAnsicht(
                    oeffneProfil: { profilOffen = true },
                    oeffneFahrzeug: {},
                    oeffneFahrt: { offeneFahrt = $0 }
                )
            }
        }
        // Profil kommt in einem spaeteren Schritt. Bis dahin: Ortungsstatus und Abmelden.
        .sheet(isPresented: $profilOffen) {
            OrtungAnsicht()
        }
        .fullScreenCover(item: $offeneFahrt) { fahrt in
            if let fahrer = anmeldung.fahrerID {
                SoloNormalAnsicht(fahrtID: fahrt.id, fahrerID: fahrer) { offeneFahrt = nil }
                    .environmentObject(anmeldung)
            }
        }
    }
}

