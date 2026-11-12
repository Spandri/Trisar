import Foundation

/// Fahrer-App: Annehmen/Ablehnen direkt aus der Mitteilung (Kategorie TRISAR_FAHRT_ANTWORT, auch von
/// der Apple Watch). Die App kann dafuer frisch im Hintergrund gestartet sein: erst auf die Anmeldung
/// warten, dann Fahrten laden und FahrtenSpeicher.antworten wie in der App aufrufen.
enum PushAntwort {
    @MainActor
    static func ausfuehren(jobID: String, annehmen: Bool) async -> Bool {
        guard let id = UUID(uuidString: jobID) else { return false }
        var versuche = 0
        while Geteilt.anmeldung.fahrerID == nil, versuche < 40 {
            try? await Task.sleep(for: .milliseconds(250))
            versuche += 1
        }
        guard let fahrer = Geteilt.anmeldung.fahrerID else { return false }
        let speicher = Geteilt.fahrten
        speicher.setzeFahrer(fahrer)
        if !speicher.fahrten.contains(where: { $0.id == id }) { await speicher.laden() }
        guard let fahrt = speicher.fahrten.first(where: { $0.id == id }) else { return false }
        // Schon beantwortet (z.B. in der App): nichts mehr tun.
        guard fahrt.wartetAufAntwort else { return true }
        return await speicher.antworten(fahrt, annehmen: annehmen,
                                        grund: annehmen ? nil : "In der Mitteilung abgelehnt")
    }
}
