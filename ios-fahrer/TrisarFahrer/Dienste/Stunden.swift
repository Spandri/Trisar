import Foundation
import Supabase

/// Stundenerfassung (wie fahrer/src/features/fahrer/views/Stunden.jsx): vergangene Dienste mit Fahrten
/// und Vorschlag aus stunden_verlauf(), Erfassung in der Tabelle stundenzettel.
enum Stunden {
    struct Vorschlag: Codable, Hashable {
        let beginn: String?; let ende: String?
        let pause_min: Int?; let arbeits_min: Int?
        let pausen: [PauseRoh]?; let fahrten: [FahrtRoh]?
        // Ungerundet, fuer die laufende Anzeige von heute.
        var beginn_genau: String? = nil; var ende_genau: String? = nil
        // Roh fuer das Zurueckschreiben als jsonb (vorschlag-Spalte).
        struct PauseRoh: Codable, Hashable { let von: String?; let bis: String?; let art: String? }
        struct FahrtRoh: Codable, Hashable {
            let id: UUID; let zeit: String?; let gaeste: String?; let von: String?; let nach: String?
            let start: String?; let ende: String?; let genau: Bool?
            var status: String? = nil
        }
    }
    struct Dienst: Decodable, Hashable {
        let id: UUID; let datum: String; let beginn: String?; let ende: String?
        /// Geplante Pausen des Dienstes (dienst_pausen, HH:MM), fuer den Ablauf der Dispo.
        var pausen: [DienstPause]? = nil
    }
    struct DienstPause: Decodable, Hashable { let von: String?; let bis: String? }
    struct Zettel: Decodable, Hashable {
        let id: UUID; let status: String; let arbeits_min: Int; let pause_min: Int
        let beginn: String; let ende: String; let begruendung: String?; let dispo_notiz: String?
        var pausen: [Vorschlag.PauseRoh]? = nil
    }
    struct Eintrag: Decodable, Identifiable, Hashable {
        let dienst: Dienst; let vorschlag: Vorschlag?; let zettel: Zettel?; let vorbei: Bool
        var id: UUID { dienst.id }
        /// Offen: Dienst vorbei und noch nicht erfasst, zurueckgegeben oder von der Dispo geaendert.
        var offen: Bool { vorbei && Stunden.fahrerDran(zettel) }
    }

    /// Heute (wie heuteStand in Stunden.jsx): Start, begonnene Pausen, Ende erst wenn fertig und die
    /// Arbeitszeit bis jetzt. Geplante Pausen ab 3 Stunden halten die Zeit an, kuerzere sind Arbeitszeit.
    /// Fertig: Dienstende erreicht und keine Fahrt mehr unterwegs. Danach zeigt die Karte, was eingereicht
    /// wird bzw. wurde (Zettel), Arbeitszeit auf halbe Stunden auf.
    struct Heute {
        struct Pause: Hashable { let von: Date; let bis: Date?; let laeuft: Bool }
        let start: Date; let ende: Date?; let fertig: Bool; let pausen: [Pause]; let arbeitsMin: Int
    }
    static let laeuftStatus: Set<String> = ["at_pickup", "pickup", "beim_pickup", "in_progress", "unterwegs", "started", "on_trip", "ongoing", "active"]
    static func pausenMin(_ pausen: [(Date, Date?)], bis: Date) -> Double {
        pausen.reduce(0) { s, p in
            guard let pb = p.1, pb.timeIntervalSince(p.0) >= Double(pauseMindest) * 60 else { return s }
            return s + max(0, min(pb, bis).timeIntervalSince(p.0) / 60)
        }
    }
    /// Fahrer ist dran: nicht erfasst, zurueckgegeben (alt) oder von der Dispo geaendert (12.11.).
    static func fahrerDran(_ z: Zettel?) -> Bool { z == nil || z?.status == "zurueckgewiesen" || z?.status == "dispo_geaendert" }
    /// Aenderung der Dispo annehmen: Stunden sind dann fertig (stunden_fahrer_zustimmen).
    static func dispoAenderungAnnehmen(_ z: Zettel) async throws {
        try await Backend.client.rpc("stunden_fahrer_zustimmen", params: ["p_zettel": z.id.uuidString]).execute()
    }
    static func halbeAuf(_ min: Double) -> Int { Int((max(0, min) / 30).rounded(.up)) * 30 }
    static func heute(_ e: Eintrag, jetzt: Date = Date()) -> Heute? {
        let v = e.vorschlag
        let fertig = e.vorbei && !(v?.fahrten ?? []).contains { laeuftStatus.contains(($0.status ?? "").lowercased()) }
        let z = e.zettel
        let zettelGilt = fertig && z != nil && (datum(z?.ende) ?? .distantPast) > (datum(z?.beginn) ?? .distantFuture)
        let qBeginn = zettelGilt ? z?.beginn : (v?.beginn_genau ?? v?.beginn)
        let qEnde = zettelGilt ? z?.ende : (v?.ende_genau ?? v?.ende)
        let qPausen = zettelGilt ? (z?.pausen ?? []) : (v?.pausen ?? [])
        guard let start = datum(qBeginn), start <= jetzt else { return nil }
        let ende = fertig ? datum(qEnde) : nil
        let bis = ende ?? jetzt
        let pausen = qPausen.compactMap { p -> (Date, Date?)? in
            guard let von = datum(p.von), von <= bis else { return nil }
            return (von, datum(p.bis))
        }.sorted { $0.0 < $1.0 }
        let genau = max(0, bis.timeIntervalSince(start) / 60 - pausenMin(pausen, bis: bis))
        let arbeits = !fertig ? Int(genau) : (zettelGilt ? (z?.arbeits_min ?? 0) : halbeAuf(genau))
        return Heute(start: start, ende: ende, fertig: fertig,
                     pausen: pausen.map { Heute.Pause(von: $0.0, bis: $0.1, laeuft: $0.1 == nil || $0.1! > bis) },
                     arbeitsMin: arbeits)
    }

    private struct HeuteZeile: Encodable {
        let driver_id: String; let dienst_id: String; let datum: String
        let beginn: String; let ende: String
        let pausen: [Vorschlag.PauseRoh]; let pause_min: Int; let arbeits_min: Int
        let vorschlag: Vorschlag?; let angepasst: Bool; let begruendung: String?
        let status = "eingereicht"; let eingereicht_am: String; let aktualisiert: String
    }
    /// Speichert die Zeiten von heute (Bestaetigen so wie gezeigt, Bearbeiten mit Notiz), wie heuteSpeichern im Web.
    static func heuteSpeichern(_ e: Eintrag, beginn: Date, ende: Date, pausen: [(Date, Date)], angepasst: Bool, begruendung: String?) async throws {
        guard let fahrer = try? await Backend.client.auth.session.user.id.uuidString.lowercased() else {
            throw TrisarFehler.text("Nicht angemeldet.")
        }
        let jetzt = iso.string(from: Date())
        let pause = Int(pausenMin(pausen.map { ($0.0, Optional($0.1)) }, bis: ende).rounded())
        let arbeits = halbeAuf(ende.timeIntervalSince(beginn) / 60 - Double(pause))
        let zeile = HeuteZeile(driver_id: fahrer, dienst_id: e.dienst.id.uuidString.lowercased(), datum: e.dienst.datum,
                               beginn: iso.string(from: beginn), ende: iso.string(from: ende),
                               pausen: pausen.map { Vorschlag.PauseRoh(von: iso.string(from: $0.0), bis: iso.string(from: $0.1), art: nil) },
                               pause_min: pause, arbeits_min: arbeits, vorschlag: e.vorschlag, angepasst: angepasst,
                               begruendung: angepasst ? begruendung : nil, eingereicht_am: jetzt, aktualisiert: jetzt)
        if let z = e.zettel {
            try await Backend.client.from("stundenzettel").update(zeile).eq("id", value: z.id.uuidString.lowercased()).execute()
        } else {
            try await Backend.client.from("stundenzettel").insert(zeile).execute()
        }
    }
    static var heuteDatum: String {
        let f = DateFormatter(); f.locale = Locale(identifier: "en_US_POSIX"); f.timeZone = berlin; f.dateFormat = "yyyy-MM-dd"
        return f.string(from: Date())
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

/// Verlauf (Profil -> Verlauf, wie Verlauf.jsx): erledigte Fahrten der letzten Tage aus verlauf_fahrten(),
/// Dienste aus stunden_verlauf() als Rahmen darum.
enum Verlauf {
    struct Fahrt: Decodable, Identifiable, Hashable {
        let id: UUID
        let datum: String
        let abfahrt: String?
        let ankunft: String?
        let gaeste: [String]?
        let anonym: Int?
    }

    /// Rueckfall, solange verlauf_fahrten() fehlt: eigene Fahrten ueber die Fahrer-RLS, Ankunft = Abfahrt + Fahrzeit.
    private struct JobRoh: Decodable {
        let id: UUID; let ride_date: String?; let etd: String?; let original_etd: String?
        let ext_route_duration_mins: Int?; let passengers: [String]?; let anonymous_guests: Int?
    }

    static let erledigt = ["done", "completed", "arrived", "beendet"]

    static func fahrten(tage: Int = 60) async -> [Fahrt] {
        if let liste: [Fahrt] = try? await Backend.client.rpc("verlauf_fahrten", params: ["p_tage": tage]).execute().value {
            return liste
        }
        guard let uid = try? await Backend.client.auth.session.user.id.uuidString.lowercased() else { return [] }
        let p = DateFormatter(); p.locale = Locale(identifier: "en_US_POSIX"); p.timeZone = Stunden.berlin; p.dateFormat = "yyyy-MM-dd"
        let ab = p.string(from: Date().addingTimeInterval(-Double(tage) * 86400))
        let jobs: [JobRoh] = (try? await Backend.client.from("jobs")
            .select("id, ride_date, etd, original_etd, ext_route_duration_mins, passengers, anonymous_guests")
            .eq("driver_id", value: uid).in("status", values: erledigt).gte("ride_date", value: ab)
            .execute().value) ?? []
        return jobs.compactMap { j in
            guard let datum = j.ride_date else { return nil }
            let etd = String((j.etd ?? j.original_etd ?? "").prefix(5))
            let start = Stunden.zeitpunkt(datum, etd)
            let ende = start.flatMap { s in (j.ext_route_duration_mins ?? 0) > 0 ? s.addingTimeInterval(Double(j.ext_route_duration_mins!) * 60) : nil }
            return Fahrt(id: j.id, datum: datum, abfahrt: start.map { Stunden.iso.string(from: $0) },
                         ankunft: ende.map { Stunden.iso.string(from: $0) }, gaeste: j.passengers, anonym: j.anonymous_guests)
        }
    }

    /// Ein Eintrag im Tag: ein Dienst mit seinen Fahrten oder eine lose Fahrt.
    enum Eintrag: Identifiable {
        case dienst(Stunden.Eintrag, [Fahrt])
        case fahrt(Fahrt)
        var id: UUID {
            switch self {
            case .dienst(let e, _): return e.id
            case .fahrt(let f): return f.id
            }
        }
    }
    struct Tag: Identifiable { let datum: String; let eintraege: [Eintrag]; var id: String { datum } }

    /// Tage neueste zuerst. Im Tag chronologisch. Eine Fahrt gehoert zum Dienst, wenn der Stundenvorschlag
    /// sie nennt oder sie im Dienstfenster startet.
    static func tage(_ fahrten: [Fahrt], _ dienste: [Stunden.Eintrag]) -> [Tag] {
        struct Rahmen { let e: Stunden.Eintrag; let start: Date?; let ende: Date?; let ids: Set<UUID>; var fahrten: [Fahrt] = [] }
        var rahmen = dienste.map { e -> Rahmen in
            let b = Stunden.zeitpunkt(e.dienst.datum, e.dienst.beginn ?? "")
            let en = Stunden.zeitpunkt(e.dienst.datum, e.dienst.ende ?? "", nach: b)
            return Rahmen(e: e, start: b, ende: en, ids: Set((e.vorschlag?.fahrten ?? []).map(\.id)))
        }
        var lose: [Fahrt] = []
        for f in fahrten {
            let t = Stunden.datum(f.abfahrt)
            if let i = rahmen.firstIndex(where: { $0.ids.contains(f.id) })
                ?? rahmen.firstIndex(where: { r in
                    guard let t, let s = r.start, let en = r.ende else { return false }
                    return t >= s && t <= en
                }) {
                rahmen[i].fahrten.append(f)
            } else {
                lose.append(f)
            }
        }
        let zeit: (Date?) -> TimeInterval = { $0?.timeIntervalSince1970 ?? 0 }
        var nachTag: [String: [(TimeInterval, Eintrag)]] = [:]
        for r in rahmen {
            let sortiert = r.fahrten.sorted { zeit(Stunden.datum($0.abfahrt)) < zeit(Stunden.datum($1.abfahrt)) }
            nachTag[r.e.dienst.datum, default: []].append((zeit(r.start), .dienst(r.e, sortiert)))
        }
        for f in lose { nachTag[f.datum, default: []].append((zeit(Stunden.datum(f.abfahrt)), .fahrt(f))) }
        return nachTag.keys.sorted(by: >).map { d in
            Tag(datum: d, eintraege: (nachTag[d] ?? []).sorted { $0.0 < $1.0 }.map(\.1))
        }
    }

    /// "07.11.2026 20:06 - 20:28" wie die Demo-Karten im Web (dort fallen die Leerzeichen zu einem zusammen).
    static func kartenZeile(_ f: Fahrt) -> String {
        let teile = f.datum.split(separator: "-")
        let datum = teile.count == 3 ? "\(teile[2]).\(teile[1]).\(teile[0])" : f.datum
        let zeit = Stunden.uhr(f.abfahrt) + (f.ankunft != nil ? " - " + Stunden.uhr(f.ankunft) : "")
        return "\(datum) \(zeit)"
    }
}
