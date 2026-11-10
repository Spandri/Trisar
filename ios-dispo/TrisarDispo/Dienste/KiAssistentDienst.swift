import Foundation
import Supabase

/// Fragt dispo-admin (aktion ki_frage), wie das Web. Das Modell laeuft auf dem Server-Weg im Tailnet.
enum KiAssistentDienst {
    /// Antwort wie das Rueckgabeobjekt im Web ({ answer, action }).
    struct Antwort {
        var text: String
        var buchungsVorschlag: KiBuchungsVorschlag?
    }

    /// Letzte Fahrer und Fahrten des Gespraechs, fuer Rueckfragen.
    @MainActor private static var kontext: AnyJSON?

    /// cachedSnapshot/cachedSnapshotAt im Web. Live wird der Snapshot nie geladen, der Cache
    /// bleibt aber wie dort, damit die Realtime-Invalidierung dasselbe tut.
    @MainActor private static var snapshotZeit: Date?

    @MainActor static func cacheVerwerfen() {
        snapshotZeit = nil
    }

    private struct Eintrag: Encodable { let role: String; let text: String }
    private struct Anfrage: Encodable {
        let aktion = "ki_frage"
        let frage: String
        let verlauf: [Eintrag]
        let kontext: AnyJSON?
    }
    private struct ServerAntwort: Decodable {
        struct Aktion: Decodable { let type: String?; let proposal: KiBuchungsVorschlag? }
        let answer: String?
        let action: Aktion?
        let kontext: AnyJSON?
    }

    /// onCreateRide(payload, { aiBooked: true })
    static func buchen(_ v: KiBuchungsVorschlag) async throws -> String? {
        var w = v.vorlage.werte
        w.anonymeGaeste = w.anonymeGaeste.isEmpty ? "0" : w.anonymeGaeste
        let ergebnis = await FahrtSpeichern.anlegen(FahrtEingabe(
            werte: w, fahrgaeste: FahrtText.gaesteTeilen(v.fahrgaeste).joined(separator: "; "), fahrerNamen: v.fahrerNamen,
            flugZielFlughafen: "", flugAnkunftGeplant: "", notiz: v.notes, aiBooked: true))
        if !ergebnis.ok { throw BuchungFehlgeschlagen(meldung: ergebnis.fehler ?? "Unbekannter Fehler") }
        return ergebnis.id?.uuidString
    }

    private struct BuchungFehlgeschlagen: LocalizedError {
        let meldung: String
        var errorDescription: String? { meldung }
    }

    /// askDatabaseAssistant({ prompt, chatHistory })
    @MainActor static func fragen(_ prompt: String, verlauf: [(rolle: String, text: String)]) async throws -> Antwort {
        let frage = prompt.trimmingCharacters(in: .whitespacesAndNewlines)
        if frage.isEmpty { return Antwort(text: "Bitte stelle eine Frage.") }
        let anfrage = Anfrage(frage: frage, verlauf: verlauf.map { Eintrag(role: $0.rolle, text: $0.text) }, kontext: kontext)
        let antwort: ServerAntwort = try await Backend.client.functions.invoke("dispo-admin", options: FunctionInvokeOptions(body: anfrage))
        if let neu = antwort.kontext { kontext = neu }
        let vorschlag = antwort.action?.type == "booking_proposal" ? antwort.action?.proposal : nil
        return Antwort(text: antwort.answer ?? "", buchungsVorschlag: vorschlag)
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

    /// Startwerte fuer das Fahrtformular (toCreateRidePayload).
    var vorlage: FahrtVorlage {
        var w = FahrtFormularWerte()
        w.datum = datum
        w.startZeit = startZeit
        w.start = start
        w.ziel = ziel
        w.flugnummer = flugnummer
        w.konvoi = konvoi
        w.anonymeGaeste = anonymeGaeste == "0" ? "" : anonymeGaeste
        w.aktuellerStatus = "offen"
        return FahrtVorlage(werte: w, fahrerNamen: fahrerNamen, fahrgaeste: fahrgaeste, notiz: notes)
    }

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
