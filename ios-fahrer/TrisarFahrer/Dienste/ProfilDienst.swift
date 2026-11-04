import Foundation
import Supabase
import UIKit

/// Eigenes Profil lesen und Felder einzeln speichern, wie handleSaveDriverProfile in FahrerApp.jsx.
@MainActor
final class ProfilDienst: ObservableObject {
    struct Daten: Decodable {
        var first_name: String?
        var last_name: String?
        var phone: String?
        var street: String?
        var street_number: String?
        var city: String?
        var zip: String?
        var language: String?
        var avatar_url: String?
    }

    @Published private(set) var daten = Daten()
    @Published private(set) var email = ""
    @Published var fehler: String?

    func laden(fahrerID: UUID) async {
        email = Backend.client.auth.currentUser?.email ?? ""
        if let zeilen: [Daten] = try? await Backend.client.from("profiles")
            .select("first_name,last_name,phone,street,street_number,city,zip,language,avatar_url")
            .eq("id", value: fahrerID).limit(1).execute().value, let erste = zeilen.first {
            daten = erste
        }
    }

    /// Ein Feld in profiles schreiben (leerer Text = null). Spaltennamen wie im Web.
    func speichern(_ spalte: String, _ wert: String?, fahrerID: UUID) async {
        let w = wert?.trimmingCharacters(in: .whitespacesAndNewlines)
        let inhalt: [String: AnyJSON] = [spalte: (w?.isEmpty ?? true) ? .null : .string(w!)]
        do {
            try await Backend.client.from("profiles").update(inhalt).eq("id", value: fahrerID).execute()
            fehler = nil
        } catch {
            fehler = "Profil konnte nicht gespeichert werden."
        }
    }

    /// E-Mail liegt in Supabase Auth, nicht in profiles (wie im Web).
    func emailSpeichern(_ neu: String) async {
        let n = neu.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !n.isEmpty, n != email else { return }
        _ = try? await Backend.client.auth.update(user: UserAttributes(email: n))
    }

    /// prepareAvatarDataUrl: laengste Seite 720, JPEG 0.84 (bzw. 0.76 wenn zu gross) als Data-URL.
    static func profilbildDataURL(_ bild: UIImage) -> String? {
        let seite = max(bild.size.width, bild.size.height)
        let faktor = min(1, 720 / max(seite, 1))
        let ziel = CGSize(width: max(1, (bild.size.width * faktor).rounded()), height: max(1, (bild.size.height * faktor).rounded()))
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        let klein = UIGraphicsImageRenderer(size: ziel, format: format).image { _ in bild.draw(in: CGRect(origin: .zero, size: ziel)) }
        guard let d1 = klein.jpegData(compressionQuality: 0.84) else { return nil }
        let url1 = "data:image/jpeg;base64," + d1.base64EncodedString()
        if url1.count <= 2_200_000 { return url1 }
        guard let d2 = klein.jpegData(compressionQuality: 0.76) else { return nil }
        return "data:image/jpeg;base64," + d2.base64EncodedString()
    }

    /// Profilbild aus Data-URL oder Internetadresse.
    static func bildAusDataURL(_ text: String?) -> UIImage? {
        guard let t = text, t.hasPrefix("data:"), let komma = t.firstIndex(of: ",") else { return nil }
        guard let daten = Data(base64Encoded: String(t[t.index(after: komma)...])) else { return nil }
        return UIImage(data: daten)
    }
}
