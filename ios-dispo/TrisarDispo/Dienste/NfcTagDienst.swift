import CoreNFC
import Foundation

/// NFC-Tags der OBD-Tracker aus der Dispo beschreiben und auslesen.
final class NfcTagDienst: NSObject, NFCNDEFReaderSessionDelegate {
    struct Fehler: LocalizedError {
        let text: String
        var errorDescription: String? { text }
    }

    private var sitzung: NFCNDEFReaderSession?
    private var schreibeURL: URL?
    private var fertig: CheckedContinuation<String?, Error>?
    /// Haelt die laufende Sitzung am Leben.
    private static var aktuell: NfcTagDienst?

    static var verfuegbar: Bool { NFCNDEFReaderSession.readingAvailable }

    /// Link auf den Tag schreiben. Liefert nil, wenn abgebrochen wurde, sonst den Link.
    static func schreiben(_ url: URL) async throws -> String? { try await starten(url) }

    /// Link vom Tag lesen. Liefert nil, wenn abgebrochen wurde. Leerer Text: Tag ohne Link.
    static func lesen() async throws -> String? { try await starten(nil) }

    @MainActor private static func starten(_ url: URL?) async throws -> String? {
        guard verfuegbar else { throw Fehler(text: "Dieses Gerät kann kein NFC.") }
        return try await withCheckedThrowingContinuation { fortsetzung in
            let dienst = NfcTagDienst()
            dienst.schreibeURL = url
            dienst.fertig = fortsetzung
            aktuell = dienst
            let sitzung = NFCNDEFReaderSession(delegate: dienst, queue: nil, invalidateAfterFirstRead: false)
            sitzung.alertMessage = url == nil ? "Tag ans iPhone halten zum Auslesen." : "Tag ans iPhone halten zum Beschreiben."
            dienst.sitzung = sitzung
            sitzung.begin()
        }
    }

    private func abschliessen(_ ergebnis: Result<String?, Error>) {
        guard let fortsetzung = fertig else { return }
        fertig = nil
        fortsetzung.resume(with: ergebnis)
        Self.aktuell = nil
    }

    private func abbrechen(_ session: NFCNDEFReaderSession, _ text: String) {
        session.invalidate(errorMessage: text)
        abschliessen(.failure(Fehler(text: text)))
    }

    func readerSession(_ session: NFCNDEFReaderSession, didDetectNDEFs messages: [NFCNDEFMessage]) {}

    func readerSessionDidBecomeActive(_ session: NFCNDEFReaderSession) {}

    func readerSession(_ session: NFCNDEFReaderSession, didInvalidateWithError error: Error) {
        if let nfc = error as? NFCReaderError,
           nfc.code == .readerSessionInvalidationErrorUserCanceled || nfc.code == .readerSessionInvalidationErrorFirstNDEFTagRead {
            abschliessen(.success(nil))
        } else {
            abschliessen(.failure(error))
        }
    }

    func readerSession(_ session: NFCNDEFReaderSession, didDetect tags: [NFCNDEFTag]) {
        guard let tag = tags.first else { return }
        session.connect(to: tag) { [self] fehler in
            if fehler != nil { abbrechen(session, "Verbindung zum Tag fehlgeschlagen."); return }
            tag.queryNDEFStatus { [self] status, _, fehler in
                if fehler != nil || status == .notSupported { abbrechen(session, "Dieser Tag wird nicht unterstützt."); return }
                if let url = schreibeURL { schreibe(url, tag, status, session) } else { lies(tag, session) }
            }
        }
    }

    private func schreibe(_ url: URL, _ tag: NFCNDEFTag, _ status: NFCNDEFStatus, _ session: NFCNDEFReaderSession) {
        guard status == .readWrite else { abbrechen(session, "Dieser Tag ist schreibgeschützt."); return }
        guard let eintrag = NFCNDEFPayload.wellKnownTypeURIPayload(url: url) else { abbrechen(session, "Link ungültig."); return }
        tag.writeNDEF(NFCNDEFMessage(records: [eintrag])) { [self] fehler in
            if fehler != nil { abbrechen(session, "Schreiben fehlgeschlagen. Tag ruhig halten und noch einmal versuchen."); return }
            session.alertMessage = "Tag beschrieben."
            session.invalidate()
            abschliessen(.success(url.absoluteString))
        }
    }

    private func lies(_ tag: NFCNDEFTag, _ session: NFCNDEFReaderSession) {
        tag.readNDEF { [self] nachricht, _ in
            session.alertMessage = "Tag gelesen."
            session.invalidate()
            let link = nachricht?.records.compactMap { $0.wellKnownTypeURIPayload()?.absoluteString }.first
            abschliessen(.success(link ?? ""))
        }
    }
}
