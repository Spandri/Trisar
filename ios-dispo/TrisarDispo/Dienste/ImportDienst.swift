import Foundation
import Supabase

/// Excel-/CSV-Import ueber die Funktion dispo-admin (Aktionen import_*), wie importDienst.js der Web-Dispo.
/// Erkennung, Blattwahl, Llama, Dubletten und Adresspruefung laufen auf dem Server, hier nur Anzeige und Bearbeiten.
enum ImportDienst {
    struct Blatt: Decodable, Hashable { let index: Int; let name: String; let zeilen: Int }
    struct Vorlage: Decodable { let name: String? }
    struct Llama: Decodable { let genutzt: Bool; let erreichbar: Bool? }
    struct Kontext: Decodable { let datum: String?; let ziel: String? }
    struct Grund: Decodable {
        let kopf: String?; let werte: String?; let anteil: Int?; let vorlage: Bool?; let llama: Bool?
    }
    struct Spalte: Decodable, Identifiable {
        let index: Int; let titel: String; let ohneTitel: Bool?; let beispiele: [String]
        let vorschlag: String?; let sicherheit: Double; let grund: Grund?
        var id: Int { index }
    }
    struct Satz: Decodable {
        let zeilen: [Int]
        var daten: [String: AnyJSON]
        var fehlt: [String]
        var hinweise: [String]
        /// Nicht mit importieren (Dubletten starten abgewaehlt).
        var aus = false
        enum CodingKeys: String, CodingKey { case zeilen, daten, fehlt, hinweise }
    }
    struct Analyse: Decodable {
        let modus: String
        let dateiname: String
        let blaetter: [Blatt]
        let blatt: Int
        let signatur: String?
        let vorlage: Vorlage?
        let felder: [String]
        let spalten: [Spalte]
        let zuordnung: [String: String]
        let fehlendeZuordnung: [String]?
        let datensaetze: [Satz]
        let kontext: Kontext?
        let llama: Llama?
    }
    struct Adresse: Decodable { let gefunden: Bool; let name: String? }
    struct Import: Decodable, Identifiable {
        let id: String; let dateiname: String?; let anzahl: Int; let erstellt: String; let rueckgaengig: String?; let vorhanden: Int
    }
    struct Ausgefuehrt: Decodable { let import_id: String?; let anzahl: Int }
    struct Rueckgaengig: Decodable { let geloescht: Int; let behalten: Int }

    struct Fehler: LocalizedError {
        let code: String
        var errorDescription: String? { code }
    }

    private static func aufruf<T: Decodable, K: Encodable>(_ koerper: K) async throws -> T {
        do {
            return try await Backend.client.functions.invoke("dispo-admin", options: FunctionInvokeOptions(body: koerper))
        } catch {
            if case let FunctionsError.httpError(_, daten) = error,
               let json = try? JSONSerialization.jsonObject(with: daten) as? [String: Any],
               let e = json["error"] as? String, !e.isEmpty {
                throw Fehler(code: e)
            }
            throw Fehler(code: error.localizedDescription)
        }
    }

    static func analysieren(modus: String, datei: String, dateiname: String, blatt: Int? = nil,
                            zuordnung: [String: String]? = nil) async throws -> Analyse {
        struct K: Encodable {
            let aktion = "import_analysieren"
            let modus: String; let datei: String; let dateiname: String; let blatt: Int?; let zuordnung: [String: String]?
        }
        return try await aufruf(K(modus: modus, datei: datei, dateiname: dateiname, blatt: blatt, zuordnung: zuordnung))
    }

    static func adressen(_ liste: [String]) async throws -> [String: Adresse] {
        struct K: Encodable { let aktion = "import_adressen"; let adressen: [String]; let stadt = "München" }
        struct A: Decodable { let adressen: [String: Adresse] }
        let a: A = try await aufruf(K(adressen: liste))
        return a.adressen
    }

    static func ausfuehren(modus: String, datensaetze: [[String: AnyJSON]], dateiname: String,
                           signatur: String?, vorlage: [String: String]) async throws -> Ausgefuehrt {
        struct K: Encodable {
            let aktion = "import_ausfuehren"
            let modus: String; let datensaetze: [[String: AnyJSON]]; let dateiname: String
            let signatur: String?; let vorlage: [String: String]
        }
        return try await aufruf(K(modus: modus, datensaetze: datensaetze, dateiname: dateiname, signatur: signatur, vorlage: vorlage))
    }

    static func liste(modus: String) async throws -> [Import] {
        struct K: Encodable { let aktion = "import_liste"; let modus: String }
        struct A: Decodable { let importe: [Import] }
        let a: A = try await aufruf(K(modus: modus))
        return a.importe
    }

    static func rueckgaengig(_ id: String) async throws -> Rueckgaengig {
        struct K: Encodable { let aktion = "import_rueckgaengig"; let import_id: String }
        return try await aufruf(K(import_id: id))
    }

    // MARK: Pruefen nach Bearbeitung (wie fahrtPruefen / gastPruefen in importKern.js)

    static func text(_ w: AnyJSON?) -> String {
        switch w {
        case let .string(s)?: return s.trimmingCharacters(in: .whitespacesAndNewlines)
        case let .integer(i)?: return String(i)
        case let .double(d)?: return d == d.rounded() ? String(Int(d)) : String(d)
        default: return ""
        }
    }

    static func namen(_ w: AnyJSON?) -> [String] {
        if case let .array(a)? = w { return a.compactMap { if case let .string(s) = $0 { return s }; return nil } }
        return []
    }

    static func schluessel(_ s: String) -> String {
        s.lowercased()
            .replacingOccurrences(of: "[^a-z0-9äöüß]+", with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespaces)
    }

    private static func adresseVergleich(_ s: String) -> String {
        schluessel(s).replacingOccurrences(of: "\\b(str|strasse|straße)\\b", with: "str", options: .regularExpression)
    }

    static func pruefen(_ satz: inout Satz, gaeste: Bool) {
        let d = satz.daten
        if gaeste {
            satz.fehlt = text(d["first_name"]).isEmpty && text(d["last_name"]).isEmpty ? ["name"] : []
            var h = satz.hinweise.filter { ["doppelt", "llama"].contains($0) }
            let mail = text(d["email"])
            if !mail.isEmpty, mail.range(of: "^[^\\s@]+@[^\\s@]+\\.[a-z]{2,}$", options: [.regularExpression, .caseInsensitive]) == nil {
                h.append("emailUngueltig")
            }
            satz.hinweise = Array(NSOrderedSet(array: h)) as? [String] ?? h
            return
        }
        var fehlt: [String] = []
        if text(d["ride_date"]).isEmpty { fehlt.append("datum") }
        if text(d["etd"]).isEmpty { fehlt.append("uhrzeit") }
        if text(d["pickup_address"]).isEmpty { fehlt.append("abholort") }
        if text(d["dropoff_address"]).isEmpty { fehlt.append("zielort") }
        satz.fehlt = fehlt
        var h = satz.hinweise.filter { ["mehrereZeilen", "datumUebernommen", "datumAusDatei", "zielAusDatei", "llama", "doppelt", "adresseUnbekannt"].contains($0) }
        let heute = ISO8601DateFormatter.string(from: Date(), timeZone: .current, formatOptions: [.withFullDate])
        let datum = text(d["ride_date"])
        if !datum.isEmpty && datum < heute { h.append("vergangen") }
        if let n = Int(text(d["anzahl"])), n > 0, namen(d["passengers"]).count > n { h.append("mehrNamenAlsPersonen") }
        let ab = text(d["pickup_address"]), an = text(d["dropoff_address"])
        if !ab.isEmpty, !an.isEmpty, adresseVergleich(ab) == adresseVergleich(an) { h.append("gleicheAdresse") }
        var gesehen = Set<String>()
        satz.hinweise = h.filter { gesehen.insert($0).inserted }
    }

    static func kurzname(_ adresse: String) -> String {
        adresse.split(separator: ",", maxSplits: 1).first.map { String($0).trimmingCharacters(in: .whitespaces) } ?? adresse
    }
}
