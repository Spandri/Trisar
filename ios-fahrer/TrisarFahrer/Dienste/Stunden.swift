import Foundation
import Supabase

/// Stundenerfassung (wie fahrer/src/features/fahrer/views/Stunden.jsx): vergangene Dienste mit Fahrten
/// und Vorschlag aus stunden_verlauf(), Erfassung in der Tabelle stundenzettel.
enum Stunden {
    struct Vorschlag: Codable, Hashable {
        let beginn: String?; let ende: String?
        let pause_min: Int?; let arbeits_min: Int?
        let pausen: [PauseRoh]?; let fahrten: [FahrtRoh]?
        // Roh fuer das Zurueckschreiben als jsonb (vorschlag-Spalte).
        struct PauseRoh: Codable, Hashable { let von: String?; let bis: String?; let art: String? }
        struct FahrtRoh: Codable, Hashable {
            let id: UUID; let zeit: String?; let gaeste: String?; let von: String?; let nach: String?
            let start: String?; let ende: String?; let genau: Bool?
        }
    }
    struct Dienst: Decodable, Hashable { let id: UUID; let datum: String; let beginn: String?; let ende: String? }
    struct Zettel: Decodable, Hashable {
        let id: UUID; let status: String; let arbeits_min: Int; let pause_min: Int
        let beginn: String; let ende: String; let begruendung: String?; let dispo_notiz: String?
    }
    struct Eintrag: Decodable, Identifiable, Hashable {
        let dienst: Dienst; let vorschlag: Vorschlag?; let zettel: Zettel?; let vorbei: Bool
        var id: UUID { dienst.id }
        /// Offen: Dienst vorbei und noch nicht erfasst bzw. zurueckgegeben.
        var offen: Bool { vorbei && (zettel == nil || zettel?.status == "zurueckgewiesen") }
    }

    static func verlauf(tage: Int = 60) async -> [Eintrag] {
        (try? await Backend.client.rpc("stunden_verlauf", params: ["p_tage": tage]).execute().value) ?? []
    }

    struct Neu: Encodable {
        let driver_id: String; let dienst_id: String; let datum: String
        let beginn: String; let ende: String
        let pausen: [Vorschlag.PauseRoh]; let pause_min: Int; let arbeits_min: Int
        let vorschlag: Vorschlag?; let angepasst: Bool; let begruendung: String?
        let status = "eingereicht"; let eingereicht_am: String; let aktualisiert: String
    }

    /// Als Pause zaehlt nur eine Unterbrechung von mindestens 3 Stunden, kuerzere sind Arbeitszeit.
    static let pauseMindest = 180

    static func speichern(_ e: Eintrag, beginn: Date, ende: Date, pauseMin: Int, angepasst: Bool, begruendung: String?) async throws {
        guard let fahrer = try? await Backend.client.auth.session.user.id.uuidString.lowercased() else {
            throw TrisarFehler.text("Nicht angemeldet.")
        }
        let jetzt = iso.string(from: Date())
        // Halbe Stunden, immer zugunsten des Fahrers (aufrunden).
        // Als Pause zaehlt nur eine Unterbrechung von mindestens 3 Stunden.
        let dauer = Int(ende.timeIntervalSince(beginn) / 60)
        let pauseMin = pauseMin >= pauseMindest ? pauseMin : 0
        let arbeits = max(0, Int((Double(dauer - pauseMin) / 30).rounded(.up)) * 30)
        let zeile = Neu(driver_id: fahrer, dienst_id: e.dienst.id.uuidString.lowercased(), datum: e.dienst.datum,
                        beginn: iso.string(from: beginn), ende: iso.string(from: ende),
                        pausen: angepasst ? [] : (e.vorschlag?.pausen ?? []), pause_min: pauseMin, arbeits_min: arbeits,
                        vorschlag: e.vorschlag, angepasst: angepasst, begruendung: angepasst ? begruendung : nil,
                        eingereicht_am: jetzt, aktualisiert: jetzt)
        if let z = e.zettel {
            try await Backend.client.from("stundenzettel").update(zeile).eq("id", value: z.id.uuidString.lowercased()).execute()
        } else {
            try await Backend.client.from("stundenzettel").insert(zeile).execute()
        }
    }

    // MARK: Zeit

    static let iso: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime]; return f
    }()
    private static let isoBruch: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]; return f
    }()
    static func datum(_ s: String?) -> Date? {
        guard let s else { return nil }
        return isoBruch.date(from: s) ?? iso.date(from: s)
    }
    static let berlin = TimeZone(identifier: "Europe/Berlin")!
    static func uhr(_ s: String?) -> String { uhr(datum(s)) }
    static func uhr(_ d: Date?) -> String {
        guard let d else { return "--:--" }
        let f = DateFormatter(); f.timeZone = berlin; f.dateFormat = "HH:mm"
        return f.string(from: d)
    }
    static func hmm(_ min: Int?) -> String {
        let m = max(0, min ?? 0)
        return "\(m / 60):" + String(format: "%02d", m % 60)
    }
    /// "Samstag 07.11." bzw. kurz "Sa 07.11."
    static func tag(_ iso: String, kurz: Bool = false) -> String {
        let p = DateFormatter(); p.locale = Locale(identifier: "en_US_POSIX"); p.timeZone = berlin; p.dateFormat = "yyyy-MM-dd"
        guard let d = p.date(from: iso) else { return iso }
        let f = DateFormatter(); f.locale = Locale(identifier: "de_DE"); f.timeZone = berlin
        f.dateFormat = kurz ? "EE dd.MM." : "EEEE dd.MM."
        return f.string(from: d)
    }
    /// HH:MM am Tag des Dienstes (Europe/Berlin). Ein Ende vor dem Beginn liegt am Folgetag.
    static func zeitpunkt(_ datum: String, _ hhmm: String, nach: Date? = nil) -> Date? {
        let p = DateFormatter(); p.locale = Locale(identifier: "en_US_POSIX"); p.timeZone = berlin
        p.dateFormat = "yyyy-MM-dd HH:mm"
        let teile = hhmm.split(separator: ":")
        guard teile.count == 2, let h = Int(teile[0]), let m = Int(teile[1]), h < 24, m < 60,
              var d = p.date(from: "\(datum) \(String(format: "%02d:%02d", h, m))") else { return nil }
        if let nach, d <= nach { d = d.addingTimeInterval(86400) }
        return d
    }
}
