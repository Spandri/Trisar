import SwiftUI

@main
struct TrisarFahrerApp: App {
    @UIApplicationDelegateAdaptor(PushAppDelegate.self) private var pushDelegate
    @StateObject private var anmeldung = Anmeldung()
    @StateObject private var ortung = Ortung()
    @StateObject private var fahrten = FahrtenSpeicher()
    @Environment(\.scenePhase) private var phase

    init() {
        // Wie overscroll-none im Web: Seiten federn oben und unten nicht nach.
        UIScrollView.appearance().bounces = false
        // Wie im Web: Seiten und Vollbilder erscheinen sofort, ohne Hochfahren oder Einblenden.
        UIView.setAnimationsEnabled(false)
        Push.shared.einrichten(app: "fahrer")
    }

    var body: some Scene {
        WindowGroup {
            Group {
                #if DEBUG
                let args = ProcessInfo.processInfo.arguments
                #endif
                switch anmeldung.zustand {
                #if DEBUG
                // Nur Debug: Seiten mit Eingabefeld ohne Anmeldung pruefen (keine Ortung, kein Senden).
                case _ where args.contains("-schadenTest"):
                    SchadenMeldenAnsicht(schliessen: {}, melden: { _, _, _, _ in false })
                case _ where args.contains("-notizTest"):
                    NotizBlatt(titel: "Warum wollen Sie diese Fahrt stornieren?", titelFarbe: Farbe.lime,
                               knopf: "Fahrt stornieren", knopfFarbe: Farbe.lime, schliessen: {}, bestaetigen: { _ in })
                #endif
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
                if id != nil { Task { await Push.shared.nachAnmeldung() } }
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
