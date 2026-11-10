import Foundation
import Supabase

/// NFC-Tag am Tracker: https://fahrer.trisar.de/nfc/<code> uebernimmt Tracker und Fahrzeug
/// fuer den angemeldeten Fahrer (trisar_nfc_uebernehmen). Ohne Anmeldung wartet der Code.
@MainActor
final class NfcTag: ObservableObject {
    @Published var meldung: String?
    private var offen: String?

    private struct Antwort: Decodable { let meldung: String? }

    func empfangen(_ url: URL) {
        guard url.pathComponents.count == 3, url.pathComponents[1] == "nfc" else { return }
        let code = url.pathComponents[2].lowercased()
        guard code.range(of: "^[a-f0-9]{18}$", options: .regularExpression) != nil else { return }
        offen = code
    }

    /// Tag am Tracker aus der App heraus lesen und einloesen.
    func scannen(_ anmeldung: Anmeldung) async {
        do {
            guard let link = try await NfcTagDienst.lesen() else { return }
            guard let url = URL(string: link), url.host == "fahrer.trisar.de" else {
                meldung = link.isEmpty ? "Auf diesem Tag steht nichts." : "Das ist kein TRISAR-Tag."
                return
            }
            empfangen(url)
            if offen == nil { meldung = "Das ist kein TRISAR-Tag."; return }
            await einloesen(anmeldung)
        } catch {
            meldung = error.localizedDescription
        }
    }

    func einloesen(_ anmeldung: Anmeldung) async {
        guard let code = offen, anmeldung.fahrerID != nil else { return }
        offen = nil
        do {
            let antwort: Antwort = try await Backend.client.rpc("trisar_nfc_uebernehmen", params: ["p_code": code]).execute().value
            meldung = antwort.meldung
            await anmeldung.profilLaden()
        } catch {
            meldung = "Das Fahrzeug konnte nicht verbunden werden. Bitte noch einmal antippen."
        }
    }
}
