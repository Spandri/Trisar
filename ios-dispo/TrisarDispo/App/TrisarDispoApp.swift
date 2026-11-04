import SwiftUI

@main
struct TrisarDispoApp: App {
    // Zugang nur fuer Dispo-Konten, wie AnmeldeTor.jsx (is_dispo oder Rolle dispo/admin/koordinator).
    @StateObject private var anmeldung = Anmeldung(
        zugang: { id in await DispoZugang.erlaubt(id) },
        zugangVerweigert: "Dieses Konto hat keinen Zugang zur Disposition."
    )

    init() {
        // Wie overscroll-none im Web: Seiten federn oben und unten nicht nach.
        UIScrollView.appearance().bounces = false
    }

    var body: some Scene {
        WindowGroup {
            Group {
                switch anmeldung.zustand {
                case .pruefe: Color.black.ignoresSafeArea()
                case .abgemeldet: LoginAnsicht()
                case .angemeldet: DispoHaupt()
                }
            }
            .environmentObject(anmeldung)
            .preferredColorScheme(.dark)
        }
    }
}

enum DispoZugang {
    private static let rollen: Set<String> = ["dispo", "dispatcher", "admin", "koordinator", "coordinator"]
    private struct Zeile: Decodable { let role: String?; let is_dispo: Bool? }

    static func erlaubt(_ id: UUID) async -> Bool {
        guard let z: [Zeile] = try? await Backend.client.from("profiles").select("role,is_dispo")
            .eq("id", value: id).limit(1).execute().value, let p = z.first else { return false }
        return p.is_dispo == true || rollen.contains((p.role ?? "").lowercased())
    }
}
