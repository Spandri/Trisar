// Glocke je Fahrt (17.11.2026), Spiegel von admin/src/shared/fahrtGlocke.js.
// Die Dispo wischt eine Fahrt auf und tippt die Glocke. Dann bekommt sie zu dieser Fahrt Meldungen
// (beim Gast, mit Gast unterwegs, 5 min vor Ankunft, angekommen). Die Karte zeigt oben rechts eine
// kleine Glocke. Nochmal tippen nimmt sie wieder weg.
// Tabelle fahrt_glocke je Konto, Meldungen schickt der push-dienst (push_fahrt_glocke, Art
// dispo_fahrt_glocke mit ziel "fahrt" und job_id, DispoHaupt oeffnet die Fahrt).
// Migration 20261117180000_fahrt_glocke.
import Foundation
import Supabase
import SwiftUI

@MainActor
final class FahrtGlocke: ObservableObject {
    static let geteilt = FahrtGlocke()

    /// job_ids (klein) mit Glocke an.
    @Published private(set) var glocken: Set<String> = []

    private var geladen = false
    private var laedt = false

    private init() {}

    private struct Zeile: Decodable { var job_id: String }

    private func nutzerId() async -> String? {
        guard let sitzung = try? await Backend.client.auth.session else { return nil }
        return sitzung.user.id.uuidString.lowercased()
    }

    /// Glocke dieser Fahrt an?
    func an(_ jobId: String) -> Bool { glocken.contains(jobId.lowercased()) }

    /// Einmal laden (wie ladeVersprechen im Web). Fehlt die Tabelle noch, bleibt alles aus.
    func laden() async {
        if geladen || laedt { return }
        laedt = true
        defer { laedt = false }
        guard let uid = await nutzerId() else { return }
        guard let zeilen: [Zeile] = try? await Backend.client.from("fahrt_glocke").select("job_id")
            .eq("user_id", value: uid).execute().value else { return }
        glocken = Set(zeilen.map { $0.job_id.lowercased() })
        geladen = true
    }

    /// Glocke an oder aus. Sofort sichtbar, bei Fehler zurueck.
    func umschalten(_ jobId: String) async {
        let id = jobId.lowercased()
        guard !id.isEmpty, let uid = await nutzerId() else { return }
        let war = glocken.contains(id)
        if war { glocken.remove(id) } else { glocken.insert(id) }
        do {
            if war {
                try await Backend.client.from("fahrt_glocke").delete()
                    .eq("user_id", value: uid).eq("job_id", value: id).execute()
            } else {
                let zeile: [String: AnyJSON] = ["user_id": .string(uid), "job_id": .string(id)]
                try await Backend.client.from("fahrt_glocke").insert(zeile).execute()
            }
        } catch {
            if war { glocken.insert(id) } else { glocken.remove(id) }
        }
    }

    /// Nach Abmelden vergessen, damit das naechste Konto neu laedt.
    func zuruecksetzen() {
        glocken = []
        geladen = false
    }
}
