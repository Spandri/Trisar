import Foundation
import Supabase

/// Nachbau von admin/src/services/kiAssistant.js (askDatabaseAssistant, invalidateDatabaseAssistantCache).
/// Im Live-Zweig (DEMO_MODE aus) ist dort noch kein Modell angebunden: nach 900 ms kommt fuer jede
/// Nachricht nur der Hinweis. Der ganze Ollama-/RAG-Teil danach ist im Web unerreichbar und fehlt hier.
enum KiAssistentDienst {
    /// Antwort wie das Rueckgabeobjekt im Web ({ answer, action }).
    struct Antwort {
        var text: String
        var buchungsVorschlag: KiBuchungsVorschlag?
    }

    /// KI_DEMO_HINWEIS_VERZOEGERUNG_MS
    private static let hinweisVerzoegerung: Duration = .milliseconds(900)

    /// cachedSnapshot/cachedSnapshotAt im Web. Live wird der Snapshot nie geladen, der Cache
    /// bleibt aber wie dort, damit die Realtime-Invalidierung dasselbe tut.
    @MainActor private static var snapshotZeit: Date?

    @MainActor static func cacheVerwerfen() {
        snapshotZeit = nil
    }

    /// askDatabaseAssistant({ prompt, chatHistory }) – Live-Zweig.
    static func fragen(_ prompt: String, verlauf: [(rolle: String, text: String)]) async throws -> Antwort {
        let frage = prompt.trimmingCharacters(in: .whitespacesAndNewlines)
        if frage.isEmpty { return Antwort(text: "Bitte stelle eine Frage.") }
        try await Task.sleep(for: hinweisVerzoegerung)
        return Antwort(text: "Der Assistent ist im Testbetrieb noch nicht freigeschaltet.")
    }
}

/// Buchungs-Vorschau (toCreateRidePayload in KiAssistentView.jsx).
struct KiBuchungsVorschlag: Codable, Equatable {
    var datum = ""
    var startZeit = ""
    var start = ""
    var ziel = ""
    var fahrgaeste = ""
    var anonymeGaeste = "0"
    var fahrerNamen: [String] = []
    var konvoi = ""
    var flugnummer = ""
    var notes = ""

    /// hasMinimumBookingData
    var hatPflichtfelder: Bool {
        !start.trimmingCharacters(in: .whitespaces).isEmpty
            && !ziel.trimmingCharacters(in: .whitespaces).isEmpty
            && !startZeit.trimmingCharacters(in: .whitespaces).isEmpty
    }
}

/// Realtime-Kanal aus KiAssistentView.jsx: jede Aenderung an den neun Tabellen verwirft den Cache.
@MainActor
final class KiAssistentLive {
    private var kanal: RealtimeChannelV2?
    private var beobachter: [Task<Void, Never>] = []

    private static let tabellen = ["jobs", "profiles", "vehicles", "guests", "job_guests", "job_notes",
                                   "convoy_assignments", "convoys", "driver_live_locations"]

    func starten() async {
        guard kanal == nil else { return }
        let k = Backend.client.channel("admin-ki-live-\(Int(Date().timeIntervalSince1970 * 1000))")
        let stroeme = Self.tabellen.map { k.postgresChange(AnyAction.self, schema: "public", table: $0) }
        kanal = k
        beobachter = stroeme.map { strom in
            Task { for await _ in strom { KiAssistentDienst.cacheVerwerfen() } }
        }
        try? await k.subscribeWithError()
    }

    func beenden() async {
        beobachter.forEach { $0.cancel() }
        beobachter = []
        if let kanal { await Backend.client.removeChannel(kanal) }
        kanal = nil
    }
}
