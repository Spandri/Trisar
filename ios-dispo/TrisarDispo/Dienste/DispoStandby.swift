import CoreLocation
import Foundation
import Supabase
import SwiftUI

/// Standby am Event-Ort in der Dispo (wie admin/src/shared/standby.js): Laden mit Realtime,
/// Anlegen, Zeiten aendern, Fahrer dazu/weg, Loeschen, Standby-Fahrten aus den Ereignissen.
@MainActor
final class DispoStandbySpeicher: ObservableObject {
    static let gemeinsam = DispoStandbySpeicher()

    static let lime = Color(hex: 0xE3F654)
    static let rot = Color(hex: 0xFF6F63)
    static let orange = Color(hex: 0xFFCD8A)
    static let grau = Color(hex: 0x868687)
    static let gruen = Color(hex: 0x59BE80)

    struct Profil: Decodable, Equatable {
        let id: UUID; let first_name: String?; let last_name: String?; let driver_number: AnyJSON?
        var nummer: String? {
            switch driver_number {
            case let .integer(i)?: return String(i)
            case let .double(d)?: return String(Int(d))
            case let .string(t)?: return t.isEmpty ? nil : t
            default: return nil
            }
        }
        var name: String {
            let n = [first_name, last_name].compactMap { $0 }.joined(separator: " ").trimmingCharacters(in: .whitespaces)
            return n.isEmpty ? "Fahrer" : n
        }
        /// "S. Spandri (99)"
        var kurz: String {
            var n = ""
            if let f = first_name, !f.isEmpty, let l = last_name, !l.isEmpty { n = "\(f.prefix(1)). \(l)" }
            else { n = (first_name ?? "") + (last_name ?? "") }
            n = n.trimmingCharacters(in: .whitespaces)
            if n.isEmpty { n = "Fahrer" }
            return nummer.map { "\(n) (\($0))" } ?? n
        }
    }

    struct Fahrer: Identifiable, Equatable {
        let standbyID: UUID
        let driverID: UUID
        let status: String
        let hatVorher: Bool
        let zustand: String?
        let zustandSeit: Date?
        /// Ankunft zurueck am Event auf dem Rueckweg (Server, TomTom mit Verkehr).
        let rueckAnkunft: Date?
        let profil: Profil?
        var id: UUID { driverID }
    }

    struct Standby: Identifiable, Equatable {
        let id: UUID
        let datum: String
        let von: String
        let bis: String
        let ortName: String
        let adresse: String?
        let lat: Double
        let lng: Double
        let notiz: String?
        var fahrer: [Fahrer]
        /// Laeuft gerade oder kommt noch.
        var aktuell: Bool {
            guard let b = Stunden.zeitpunkt(datum, von), let e = Stunden.zeitpunkt(datum, bis, nach: b) else { return datum >= Stunden.heuteDatum }
            return e > Date() || datum >= Stunden.heuteDatum
        }
    }

    struct Ereignis: Decodable {
        let id: Int; let standby_id: UUID; let driver_id: UUID; let art: String; let zeit: String
        let lat: Double?; let lng: Double?
    }

    struct Fahrt: Identifiable, Equatable {
        let id: String
        let standbyID: UUID
        let driverID: UUID
        let start: Date
        var abgesetzt: Date?
        var zurueck: Date?
        var ende: Date?
        var status: String { zurueck != nil ? "zurueck" : ende != nil ? "beendet" : abgesetzt != nil ? "rueckweg" : "unterwegs" }
    }

    @Published private(set) var liste: [Standby]?
    @Published private(set) var fahrten: [Fahrt] = []
    @Published private(set) var ankunft: [String: Date] = [:]
    /// Nach dem Senden aus dem Formular: diesen Standby in der Fahrtenliste oeffnen.
    @Published var oeffnen: UUID?

    private var kanal: RealtimeChannelV2?
    private var beobachter: [Task<Void, Never>] = []

    var aktuelle: [Standby] { (liste ?? []).filter(\.aktuell) }

    private struct StandbyZeile: Decodable {
        let id: UUID; let datum: String; let von: String; let bis: String; let ort_name: String
        let adresse: String?; let lat: Double; let lng: Double; let notiz: String?
    }
    private struct FahrerZeile: Decodable {
        let standby_id: UUID; let driver_id: UUID; let status: String?; let vorher: AnyJSON?
        let zustand: String?; let zustand_seit: String?; let rueck_ankunft: String?
    }

    static func hm(_ s: String?) -> String { String((s ?? "").prefix(5)) }

    func starten() async {
        if kanal == nil {
            let k = Backend.client.channel("dispo-standby-ios")
            let a = k.postgresChange(AnyAction.self, schema: "public", table: "standby")
            let b = k.postgresChange(AnyAction.self, schema: "public", table: "standby_fahrer")
            let c = k.postgresChange(InsertAction.self, schema: "public", table: "standby_ereignis")
            kanal = k
            beobachter = [
                Task { [weak self] in for await _ in a { await self?.laden() } },
                Task { [weak self] in for await _ in b { await self?.laden() } },
                Task { [weak self] in for await _ in c { await self?.ereignisseLaden() } },
            ]
            try? await k.subscribeWithError()
        }
        await laden()
    }

    /// Standbys ab gestern (falls ueber Mitternacht) mit ihren Fahrern.
    func laden() async {
        let gestern = Datum.tagWert(Date().addingTimeInterval(-86400))
        guard let s: [StandbyZeile] = try? await Backend.client.from("standby").select()
            .gte("datum", value: gestern).order("datum").order("von").execute().value else { return }
        let ids = s.map { $0.id.uuidString.lowercased() }
        let f: [FahrerZeile] = ids.isEmpty ? [] : ((try? await Backend.client.from("standby_fahrer").select()
            .in("standby_id", values: ids).execute().value) ?? [])
        let fahrerIDs = Array(Set(f.map { $0.driver_id.uuidString.lowercased() }))
        let p: [Profil] = fahrerIDs.isEmpty ? [] : ((try? await Backend.client.from("profiles")
            .select("id, first_name, last_name, driver_number").in("id", values: fahrerIDs).execute().value) ?? [])
        let profilJe = Dictionary(p.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        liste = s.map { x in
            Standby(id: x.id, datum: String(x.datum.prefix(10)), von: Self.hm(x.von), bis: Self.hm(x.bis), ortName: x.ort_name,
                    adresse: x.adresse, lat: x.lat, lng: x.lng, notiz: x.notiz,
                    fahrer: f.filter { $0.standby_id == x.id }.map { y in
                        Fahrer(standbyID: y.standby_id, driverID: y.driver_id, status: (y.status ?? "pending").lowercased(),
                               hatVorher: { if case .some(.null) = y.vorher { return false }; return y.vorher != nil }(),
                               zustand: y.zustand, zustandSeit: StandbyZeit.datum(y.zustand_seit),
                               rueckAnkunft: StandbyZeit.datum(y.rueck_ankunft), profil: profilJe[y.driver_id])
                    }.sorted { ($0.profil?.name ?? "") < ($1.profil?.name ?? "") })
        }
        await ereignisseLaden()
    }

    /// Standby-Fahrten (wie fahrtenBilden): gast_drin = losgefahren, abgesetzt = Rueckweg, zurueck = wieder am Event.
    func ereignisseLaden() async {
        let ids = aktuelle.map { $0.id.uuidString.lowercased() }
        guard !ids.isEmpty, let e: [Ereignis] = try? await Backend.client.from("standby_ereignis").select()
            .in("standby_id", values: ids).order("zeit").execute().value else { fahrten = []; return }
        var liste: [Fahrt] = []
        var offen: [String: Int] = [:]
        for x in e.sorted(by: { (StandbyZeit.datum($0.zeit) ?? .distantPast) < (StandbyZeit.datum($1.zeit) ?? .distantPast) }) {
            guard let zeit = StandbyZeit.datum(x.zeit) else { continue }
            let k = "\(x.standby_id)|\(x.driver_id)"
            if x.art == "gast_drin" {
                if let i = offen[k] { liste[i].ende = zeit; offen[k] = nil }
                liste.append(Fahrt(id: "\(k)|\(x.id)", standbyID: x.standby_id, driverID: x.driver_id, start: zeit))
                offen[k] = liste.count - 1
            } else if x.art == "abgesetzt", let i = offen[k] {
                liste[i].abgesetzt = zeit
            } else if x.art == "zurueck", let i = offen[k] {
                liste[i].zurueck = zeit
                liste[i].ende = zeit
                offen[k] = nil
            }
        }
        fahrten = liste
        etaStarten()
    }

    /// Ankunft zurueck am Event: rechnet der Server mit TomTom (standby_fahrer.rueck_ankunft),
    /// kommt per Realtime mit laden().
    private func etaStarten() {
        var neu: [String: Date] = [:]
        for f in fahrten where f.status == "rueckweg" {
            if let a = aktuelle.first(where: { $0.id == f.standbyID })?.fahrer.first(where: { $0.driverID == f.driverID })?.rueckAnkunft {
                neu[f.id] = a
            }
        }
        ankunft = neu
    }

    // MARK: Schreiben

    struct OrtDaten {
        var id: UUID?
        var name: String
        var adresse: String?
        var lat: Double
        var lng: Double
        var radiusRein = 150
        var radiusRaus = 300
    }

    func anlegen(datum: String, von: String, bis: String, ort: OrtDaten, notiz: String, fahrerIDs: [UUID]) async -> Result<UUID, Error> {
        struct Neu: Encodable {
            let datum: String; let von: String; let bis: String; let ort_id: String?; let ort_name: String
            let adresse: String?; let lat: Double; let lng: Double; let radius_rein_m: Int; let radius_raus_m: Int; let notiz: String?
        }
        struct ID: Decodable { let id: UUID }
        struct F: Encodable { let standby_id: String; let driver_id: String }
        do {
            let neu: ID = try await Backend.client.from("standby").insert(Neu(
                datum: datum, von: von, bis: bis, ort_id: ort.id?.uuidString.lowercased(), ort_name: ort.name,
                adresse: ort.adresse, lat: ort.lat, lng: ort.lng, radius_rein_m: ort.radiusRein, radius_raus_m: ort.radiusRaus,
                notiz: notiz.isEmpty ? nil : notiz)).select("id").single().execute().value
            try await Backend.client.from("standby_fahrer").insert(fahrerIDs.map {
                F(standby_id: neu.id.uuidString.lowercased(), driver_id: $0.uuidString.lowercased())
            }).execute()
            await laden()
            return .success(neu.id)
        } catch {
            return .failure(error)
        }
    }

    func aendern(_ id: UUID, datum: String?, von: String?, bis: String?, notiz: String??) async -> String {
        var a: [String: AnyJSON] = [:]
        if let datum { a["datum"] = .string(datum) }
        if let von { a["von"] = .string(von) }
        if let bis { a["bis"] = .string(bis) }
        if let notiz { a["notiz"] = notiz.map { .string($0) } ?? .null }
        guard !a.isEmpty else { return "" }
        do {
            try await Backend.client.from("standby").update(a).eq("id", value: id.uuidString.lowercased()).execute()
            return ""
        } catch { return error.localizedDescription }
    }

    func fahrerDazu(_ id: UUID, _ fahrerIDs: [UUID]) async -> String {
        struct F: Encodable { let standby_id: String; let driver_id: String; let status = "pending" }
        do {
            try await Backend.client.from("standby_fahrer").upsert(
                fahrerIDs.map { F(standby_id: id.uuidString.lowercased(), driver_id: $0.uuidString.lowercased()) },
                onConflict: "standby_id,driver_id").execute()
            return ""
        } catch { return error.localizedDescription }
    }

    func fahrerWeg(_ id: UUID, _ driverID: UUID) async -> String {
        do {
            try await Backend.client.from("standby_fahrer").delete()
                .eq("standby_id", value: id.uuidString.lowercased()).eq("driver_id", value: driverID.uuidString.lowercased()).execute()
            return ""
        } catch { return error.localizedDescription }
    }

    /// Erst die Fahrer (jeder bekommt „Standby zurückgezogen“), dann den Standby.
    func loeschen(_ id: UUID) async -> String {
        _ = try? await Backend.client.from("standby_fahrer").delete().eq("standby_id", value: id.uuidString.lowercased()).execute()
        do {
            try await Backend.client.from("standby").delete().eq("id", value: id.uuidString.lowercased()).execute()
            await laden()
            return ""
        } catch { return error.localizedDescription }
    }

    // MARK: Anzeige

    /// Zustand eines Fahrers als Text und Farbe (zustandAnzeige).
    static func zustand(_ f: Fahrer) -> (text: String, farbe: Color) {
        if f.status == "pending" { return (f.hatVorher ? "Änderung angefragt" : "Angefragt", grau) }
        if f.status == "refused" { return ("Abgelehnt", rot) }
        let seit = f.zustandSeit.map { " seit \(StandbyZeit.uhr($0))" } ?? ""
        switch f.zustand {
        case "vor_ort": return ("Vor Ort\(seit)", lime)
        case "mit_gast": return ("Mit Gast\(seit)", orange)
        case "rueckweg": return ("Auf Rückweg\(seit)", lime)
        default: return ("Angenommen", lime)
        }
    }
}

/// Zeitangaben aus Postgres/ISO lesen und als HH:mm (Berlin) zeigen.
enum StandbyZeit {
    static func datum(_ s: String?) -> Date? {
        guard let s, !s.isEmpty else { return nil }
        let a = ISO8601DateFormatter(); a.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let d = a.date(from: s) { return d }
        if let d = ISO8601DateFormatter().date(from: s) { return d }
        let p = DateFormatter(); p.locale = Locale(identifier: "en_US_POSIX")
        for f in ["yyyy-MM-dd HH:mm:ss.SSSSSSXXXXX", "yyyy-MM-dd HH:mm:ss.SSSXXXXX", "yyyy-MM-dd HH:mm:ssXXXXX", "yyyy-MM-dd'T'HH:mm:ss.SSSSSSXXXXX"] {
            p.dateFormat = f
            if let d = p.date(from: s) { return d }
        }
        return nil
    }
    static func uhr(_ d: Date) -> String {
        let f = DateFormatter(); f.locale = Locale(identifier: "de_DE"); f.timeZone = Stunden.berlin; f.dateFormat = "HH:mm"
        return f.string(from: d)
    }
    /// "Heute" oder "Mi., 12.11."
    static func tagKurz(_ iso: String) -> String {
        if iso == Stunden.heuteDatum { return "Heute" }
        let p = DateFormatter(); p.locale = Locale(identifier: "en_US_POSIX"); p.dateFormat = "yyyy-MM-dd"
        guard let d = p.date(from: iso) else { return iso }
        let f = DateFormatter(); f.locale = Locale(identifier: "de_DE"); f.dateFormat = "EE, dd.MM."
        return f.string(from: d)
    }
}
