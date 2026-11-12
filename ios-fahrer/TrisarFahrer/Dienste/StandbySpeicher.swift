import Foundation
import Supabase

/// Standby am Event-Ort in der Fahrer-App (wie fahrer/src/shared/standby.js).
/// Tabellen standby, standby_fahrer, Funktionen standby_antworten und standby_melden.
@MainActor
final class StandbySpeicher: ObservableObject {
    static let shared = StandbySpeicher()

    struct Standby: Identifiable, Equatable {
        let id: UUID
        let datum: String
        let von: String
        let bis: String
        let vonEigen: String?
        let bisEigen: String?
        let ortName: String
        let adresse: String?
        var status: String
        var zustand: String?
        var zustandSeit: Date?

        var offen: Bool { status == "pending" }
        var anzeigeVon: String { vonEigen ?? von }
        var anzeigeBis: String { bisEigen ?? bis }
        var beginn: Date? { Stunden.zeitpunkt(datum, anzeigeVon) }
        /// Ende (eigene Zeiten nach abgelehnter Aenderung, Nacht ueber Mitternacht).
        var ende: Date? {
            guard let b = Stunden.zeitpunkt(datum, anzeigeVon) else { return Stunden.zeitpunkt(datum, anzeigeBis) }
            return Stunden.zeitpunkt(datum, anzeigeBis, nach: b)
        }
        var vorbei: Bool { (ende ?? .distantFuture) <= Date() }
    }

    @Published private(set) var liste: [Standby] = []
    @Published var fehler: String?

    private var fahrerID: UUID?
    private var kanal: RealtimeChannelV2?
    private var beobachter: [Task<Void, Never>] = []

    private struct FahrerZeile: Decodable {
        let standby_id: UUID; let status: String?; let zustand: String?; let zustand_seit: String?
        let von_eigen: String?; let bis_eigen: String?
    }
    private struct StandbyZeile: Decodable {
        let id: UUID; let datum: String?; let von: String?; let bis: String?; let ort_name: String?; let adresse: String?
    }

    private static func hm(_ s: String?) -> String? {
        guard let s, !s.isEmpty else { return nil }
        return String(s.prefix(5))
    }

    static func datum(_ s: String?) -> Date? {
        guard let s else { return nil }
        let a = ISO8601DateFormatter(); a.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let d = a.date(from: s) { return d }
        let b = ISO8601DateFormatter()
        if let d = b.date(from: s) { return d }
        // Postgres "2026-11-12 18:00:00.123+00"
        let p = DateFormatter(); p.locale = Locale(identifier: "en_US_POSIX")
        for f in ["yyyy-MM-dd HH:mm:ss.SSSSSSXXXXX", "yyyy-MM-dd HH:mm:ss.SSSXXXXX", "yyyy-MM-dd HH:mm:ssXXXXX", "yyyy-MM-dd'T'HH:mm:ss.SSSSSSXXXXX"] {
            p.dateFormat = f
            if let d = p.date(from: s) { return d }
        }
        return nil
    }

    /// Nach Anmeldung bzw. Abmeldung aufrufen.
    func setzeFahrer(_ id: UUID?) async {
        guard id != fahrerID else { return }
        fahrerID = id
        beobachter.forEach { $0.cancel() }
        beobachter = []
        if let kanal { await Backend.client.removeChannel(kanal) }
        kanal = nil
        liste = []
        guard let id else { return }
        await laden()
        let k = Backend.client.channel("fahrer-standby-\(id.uuidString)")
        let eigene = k.postgresChange(AnyAction.self, schema: "public", table: "standby_fahrer",
                                      filter: .eq("driver_id", value: id.uuidString.lowercased()))
        let standbys = k.postgresChange(UpdateAction.self, schema: "public", table: "standby")
        kanal = k
        beobachter = [
            Task { [weak self] in for await _ in eigene { await self?.laden() } },
            Task { [weak self] in for await _ in standbys { await self?.laden() } },
        ]
        try? await k.subscribeWithError()
    }

    /// Eigene Standbys (angefragt oder angenommen, Ende nicht laenger als 2 h vorbei).
    func laden() async {
        guard let id = fahrerID else { return }
        guard let f: [FahrerZeile] = try? await Backend.client.from("standby_fahrer").select()
            .eq("driver_id", value: id.uuidString.lowercased()).in("status", values: ["pending", "accepted"])
            .execute().value else { return }
        let ids = f.map { $0.standby_id.uuidString.lowercased() }
        var je: [UUID: StandbyZeile] = [:]
        if !ids.isEmpty, let s: [StandbyZeile] = try? await Backend.client.from("standby").select()
            .in("id", values: ids).execute().value {
            for x in s { je[x.id] = x }
        }
        let grenze = Date().addingTimeInterval(-2 * 3600)
        liste = f.compactMap { x -> Standby? in
            guard let s = je[x.standby_id], let datum = s.datum else { return nil }
            return Standby(id: x.standby_id, datum: String(datum.prefix(10)),
                           von: Self.hm(s.von) ?? "", bis: Self.hm(s.bis) ?? "",
                           vonEigen: Self.hm(x.von_eigen), bisEigen: Self.hm(x.bis_eigen),
                           ortName: s.ort_name ?? "Standby", adresse: s.adresse,
                           status: (x.status ?? "pending").lowercased(), zustand: x.zustand,
                           zustandSeit: Self.datum(x.zustand_seit))
        }
        .filter { ($0.ende ?? .distantFuture) > grenze }
        .sorted { ($0.beginn ?? .distantPast) < ($1.beginn ?? .distantPast) }
    }

    func antworten(_ s: Standby, annehmen: Bool) async {
        struct P: Encodable { let p_standby: String; let p_annehmen: Bool }
        do {
            try await Backend.client.rpc("standby_antworten", params: P(p_standby: s.id.uuidString.lowercased(), p_annehmen: annehmen)).execute()
            fehler = nil
        } catch {
            fehler = "Standby konnte nicht gespeichert werden: \(error.localizedDescription)"
        }
        await laden()
    }

    /// art: gast_drin, abgesetzt, zurueck. Sofort anzeigen, die Datenbank bestaetigt per Realtime.
    func melden(_ s: Standby, art: String) async {
        let neu = ["gast_drin": "mit_gast", "abgesetzt": "rueckweg", "zurueck": "vor_ort"][art]
        if let i = liste.firstIndex(where: { $0.id == s.id }) {
            liste[i].zustand = neu
            liste[i].zustandSeit = Date()
        }
        struct P: Encodable { let p_standby: String; let p_art: String }
        do {
            try await Backend.client.rpc("standby_melden", params: P(p_standby: s.id.uuidString.lowercased(), p_art: art)).execute()
            fehler = nil
        } catch {
            fehler = "Konnte nicht gespeichert werden: \(error.localizedDescription)"
        }
        await laden()
    }

    /// Sichtbar in der Liste (statt „Keine Fahrt“): offen oder noch nicht vorbei.
    var sichtbar: Bool { liste.contains { $0.offen || !$0.vorbei } }

    // Hoehen wie standbyBlockHoehe in standby.js
    static let karte: CGFloat = 198
    static let zustandZeile: CGFloat = 37
    static func blockHoehe(_ s: Standby) -> CGFloat {
        if s.offen { return karte + 12 + 51 }
        if s.vorbei { return karte }
        switch s.zustand {
        case "mit_gast": return karte + zustandZeile + 12 + 56
        case "vor_ort": return karte + 12 + 56
        case "rueckweg": return karte + 12 + 51
        default: return karte
        }
    }
}
