import SwiftUI
import Supabase

@main
struct TrisarDispoApp: App {
    @UIApplicationDelegateAdaptor(PushAppDelegate.self) private var pushDelegate
    // Zugang nur fuer Dispo-Konten, wie AnmeldeTor.jsx (is_dispo oder Rolle dispo/admin/koordinator).
    @StateObject private var anmeldung = Anmeldung(
        zugang: { sitzung in await DispoZugang.erlaubt(sitzung) },
        zugangVerweigert: "Dieses Konto hat keinen Zugang zur Disposition."
    )

    init() {
        // Wie overscroll-none im Web: Seiten federn oben und unten nicht nach.
        UIScrollView.appearance().bounces = false
        // Wie im Web: Seiten und Vollbilder erscheinen sofort, ohne Hochfahren oder Einblenden.
        UIView.setAnimationsEnabled(false)
        Push.shared.einrichten(app: "dispo")
    }

    var body: some Scene {
        WindowGroup {
            Group {
                #if DEBUG
                if ProcessInfo.processInfo.arguments.contains("-naviTest") {
                    NaviTestAnsicht()
                } else if ProcessInfo.processInfo.arguments.contains("-fahrerTest") {
                    FahrerKartenTest()
                } else if ProcessInfo.processInfo.arguments.contains("-kiTest") {
                    // Verlauf des KI-Assistenten ohne Anmeldung ansehen (Fragen von der Apple Watch).
                    KiAssistentAnsicht(zeigen: { _ in })
                        .onAppear { DispoUhrBruecke.shared.einrichten() }
                } else {
                    hauptInhalt
                }
                #else
                hauptInhalt
                #endif
            }
            .environmentObject(anmeldung)
            .onChange(of: anmeldung.fahrerID, initial: true) { _, id in
                if id != nil { Task { await Push.shared.nachAnmeldung() } }
                // Apple Watch (TrisarDispoUhr): Uebersicht nur fuer angemeldete Dispo-Konten.
                DispoUhrBruecke.shared.einrichten()
                DispoUhrBruecke.shared.setzeAngemeldet(id != nil)
            }
            // Ganze App auf die Breite des iPhones skalieren (Raster 402 wie im Web).
            .webMassstab()
            .preferredColorScheme(.dark)
        }
    }

    @ViewBuilder private var hauptInhalt: some View {
                switch anmeldung.zustand {
                case .pruefe: Color.black.ignoresSafeArea()
                case .abgemeldet: LoginAnsicht(hintergrund: DispoHintergrund())
                case .angemeldet: DispoHaupt()
                }
    }
}

#if DEBUG
/// Nur zum Pruefen der Navigationsleiste ohne Anmeldung: Start mit Argument -naviTest.
struct NaviTestAnsicht: View {
    @State private var ziel: DispoZiel = .start
    var body: some View {
        DispoPlatzhalter(titel: "\(ziel)", zeigen: { ziel = $0 }, aktiv: ziel)
            .id(ziel)
    }
}

/// Nur zum Pruefen von Scrollen und Wischen der Fahrerkarten ohne Anmeldung: Start mit -fahrerTest.
struct FahrerKartenTest: View {
    @State private var markiert: Set<String> = []
    private let fahrer: [DispoFahrer] = (1...40).map { i in
        DispoFahrer(id: "t\(i)", name: "Testfahrer Nummer \(i)", firstName: "Test", lastName: "\(i)", email: "", vehicle: "M-T \(100 + i)",
                    role: nil, driverNumber: i, driverActivityState: nil, serviceStartTime: i % 3 == 0 ? "" : "08:00",
                    serviceEndTime: "17:00", serviceStartDate: "", planRequestStatus: "accepted")
    }
    var body: some View {
        Leinwand(inhaltHoehe: CGFloat(fahrer.count) * 96 + 120) { _ in
            ForEach(Array(fahrer.enumerated()), id: \.element.id) { i, f in
                FahrerKarte(fahrer: f, imDienst: i % 2 == 0, markiert: markiert.contains(f.id),
                            antippen: {}, markieren: { if markiert.contains(f.id) { markiert.remove(f.id) } else { markiert.insert(f.id) } },
                            bearbeiten: {})
                    .platz(20, 60 + CGFloat(i) * 96, 362, 84)
            }
        }
    }
}
#endif

enum DispoZugang {
    private static let rollen: Set<String> = ["dispo", "dispatcher", "admin", "koordinator", "coordinator"]
    private struct Zeile: Decodable { let role: String?; let is_dispo: Bool? }

    /// Fragt die Rolle direkt per REST mit dem Token dieser Sitzung ab. Waehrend authStateChanges
    /// ist die Sitzung im Client evtl. noch nicht abgelegt, dann liefe die Abfrage ohne Konto,
    /// RLS gaebe nichts zurueck und ein Dispo-Konto wuerde faelschlich abgewiesen.
    static func erlaubt(_ sitzung: Session) async -> Bool {
        for versuch in 0..<3 {
            if let ja = await einmal(sitzung) { return ja }
            try? await Task.sleep(nanoseconds: UInt64(versuch + 1) * 700_000_000)
        }
        return false
    }

    private static func einmal(_ sitzung: Session) async -> Bool? {
        var teile = URLComponents(url: Konfig.supabaseURL.appendingPathComponent("rest/v1/profiles"), resolvingAgainstBaseURL: false)!
        teile.queryItems = [
            URLQueryItem(name: "select", value: "role,is_dispo"),
            URLQueryItem(name: "id", value: "eq.\(sitzung.user.id.uuidString.lowercased())"),
            URLQueryItem(name: "limit", value: "1"),
        ]
        var anfrage = URLRequest(url: teile.url!)
        anfrage.setValue(Konfig.supabaseKey, forHTTPHeaderField: "apikey")
        anfrage.setValue("Bearer \(sitzung.accessToken)", forHTTPHeaderField: "Authorization")
        guard let (daten, rueck) = try? await URLSession.shared.data(for: anfrage),
              (rueck as? HTTPURLResponse)?.statusCode == 200,
              let zeilen = try? JSONDecoder().decode([Zeile].self, from: daten) else { return nil }
        guard let p = zeilen.first else { return false }
        return p.is_dispo == true || rollen.contains((p.role ?? "").lowercased())
    }
}
