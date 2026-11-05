import SwiftUI

@main
struct TrisarFahrerApp: App {
    @StateObject private var anmeldung = Anmeldung()
    @StateObject private var ortung = Ortung()
    @StateObject private var fahrten = FahrtenSpeicher()
    @Environment(\.scenePhase) private var phase

    init() {
        // Wie overscroll-none im Web: Seiten federn oben und unten nicht nach.
        UIScrollView.appearance().bounces = false
        // Wie im Web: Seiten und Vollbilder erscheinen sofort, ohne Hochfahren oder Einblenden.
        UIView.setAnimationsEnabled(false)
    }

    var body: some Scene {
        WindowGroup {
            Group {
                switch anmeldung.zustand {
                case .pruefe:
                    TrisarHintergrund()
                case .abgemeldet:
                    LoginAnsicht()
                case .angemeldet:
                    HauptAnsicht()
                }
            }
            .environmentObject(anmeldung)
            .environmentObject(ortung)
            .environmentObject(fahrten)
            // Ganze App auf die Breite des iPhones skalieren (Raster 402 wie im Web).
            .webMassstab()
            .preferredColorScheme(.dark)
            .onChange(of: anmeldung.fahrerID, initial: true) { _, id in
                ortung.setzeFahrer(id)
                fahrten.setzeFahrer(id)
                if id != nil && ortung.berechtigung == .unbekannt {
                    ortung.berechtigungAnfragen()
                }
            }
            .onChange(of: phase) { _, neu in
                if neu == .active {
                    ortung.vordergrund()
                    Task { await fahrten.laden() }
                    Task { await anmeldung.profilLaden() }
                }
            }
        }
    }
}
