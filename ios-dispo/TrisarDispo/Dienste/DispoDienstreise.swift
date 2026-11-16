import Foundation
import Supabase
import SwiftUI

/// Dienstreise in der Dispo (wie admin/src/shared/dienstreise.js): Laden mit Realtime, Anlegen,
/// Fahrer dazu/weg, Loeschen. Verbindung (Zug/Flug) ueber DienstreiseVerbindung (geteilt mit der Fahrer-App).
@MainActor
final class DispoDienstreiseSpeicher: ObservableObject {
    static let gemeinsam = DispoDienstreiseSpeicher()

    static let lime = Color(hex: 0xE3F654)
    static let rot = Color(hex: 0xFF6F63)
    static let grau = Color(hex: 0x868687)

    struct Fahrer: Identifiable, Equatable {
        let driverID: UUID
        let status: String
        let beendet: String?
        let profil: DispoStandbySpeicher.Profil?
        var id: UUID { driverID }
    }

    struct Reise: Identifiable, Equatable {
        let id: UUID
        let datum: String
        let startZeit: String
        let startName: String
        let startLat: Double?
        let startLng: Double?
        let zielName: String
        let zielLat: Double?
        let zielLng: Double?
        let zugnummer: String?
        let flugnummer: String?
        let notiz: String?
        let verbindung: DienstreiseVerbindung?
        var fahrer: [Fahrer]
        var abschnitte: [DienstreiseAbschnitt] = []
        var ticketPfad: String?
        var ticketName: String?

        var nummer: String { DienstreiseVerbindung.nummer(zugnummer: zugnummer, flugnummer: flugnummer) }
        var flug: Bool { !(flugnummer ?? "").trimmingCharacters(in: .whitespaces).isEmpty }
        /// Kommt noch oder ist heute, oder ein Fahrer ist noch unterwegs (reiseAktuell).
        var aktuell: Bool {
            if datum >= Stunden.heuteDatum { return true }
            return fahrer.contains { $0.status == "accepted" && $0.beendet == nil }
        }
    }

    @Published private(set) var liste: [Reise]?
    /// Nach dem Senden aus dem Formular: diese Dienstreise in der Fahrtenliste oeffnen.
    @Published var oeffnen: UUID?

    private var kanal: RealtimeChannelV2?
    private var beobachter: [Task<Void, Never>] = []

    var aktuelle: [Reise] { (liste ?? []).filter(\.aktuell) }

    private struct ReiseZeile: Decodable {
        let id: UUID; let datum: String; let start_zeit: String?; let start_name: String?
        let start_lat: Double?; let start_lng: Double?
        let ziel_name: String?; let ziel_lat: Double?; let ziel_lng: Double?
        let zugnummer: String?; let flugnummer: String?; let notiz: String?
        let verbindung: DienstreiseVerbindung?
        let ticket_pfad: String?; let ticket_name: String?

        enum CodingKeys: String, CodingKey {
            case id, datum, start_zeit, start_name, start_lat, start_lng, ziel_name, ziel_lat, ziel_lng
            case zugnummer, flugnummer, notiz, verbindung, ticket_pfad, ticket_name
        }

        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            id = try c.decode(UUID.self, forKey: .id)
            datum = try c.decode(String.self, forKey: .datum)
            func s(_ k: CodingKeys) -> String? { (try? c.decodeIfPresent(String.self, forKey: k)) ?? nil }
            func d(_ k: CodingKeys) -> Double? { (try? c.decodeIfPresent(Double.self, forKey: k)) ?? nil }
            start_zeit = s(.start_zeit); start_name = s(.start_name); start_lat = d(.start_lat); start_lng = d(.start_lng)
            ziel_name = s(.ziel_name); ziel_lat = d(.ziel_lat); ziel_lng = d(.ziel_lng)
            zugnummer = s(.zugnummer); flugnummer = s(.flugnummer); notiz = s(.notiz)
            // Kaputte Verbindung (jsonb) soll die Reise nicht verschwinden lassen.
            verbindung = (try? c.decodeIfPresent(DienstreiseVerbindung.self, forKey: .verbindung)) ?? nil
            ticket_pfad = s(.ticket_pfad); ticket_name = s(.ticket_name)
        }
    }
    private struct FahrerZeile: Decodable {
        let dienstreise_id: UUID; let driver_id: UUID; let status: String?; let beendet: String?
    }

    func starten() async {
        if kanal == nil {
            let k = Backend.client.channel("dispo-dienstreise-ios")
            let a = k.postgresChange(AnyAction.self, schema: "public", table: "dienstreise")
            let b = k.postgresChange(AnyAction.self, schema: "public", table: "dienstreise_fahrer")
            let c = k.postgresChange(AnyAction.self, schema: "public", table: "dienstreise_abschnitt")
            kanal = k
            beobachter = [
                Task { [weak self] in for await _ in a { await self?.laden() } },
                Task { [weak self] in for await _ in b { await self?.laden() } },
                Task { [weak self] in for await _ in c { await self?.laden() } },
            ]
            try? await k.subscribeWithError()
        }
        await laden()
    }

    /// Dienstreisen ab gestern mit ihren Fahrern.
    func laden() async {
        let gestern = Datum.tagWert(Date().addingTimeInterval(-86400))
        guard let r: [ReiseZeile] = try? await Backend.client.from("dienstreise").select()
            .gte("datum", value: gestern).order("datum").order("start_zeit").execute().value else { return }
        let ids = r.map { $0.id.uuidString.lowercased() }
        let f: [FahrerZeile] = ids.isEmpty ? [] : ((try? await Backend.client.from("dienstreise_fahrer").select()
            .in("dienstreise_id", values: ids).execute().value) ?? [])
        // Abschnitte (Umstiege). Fehlt die Tabelle noch (alte Datenbank), bleibt es bei der einen Verbindung.
        let abs: [DienstreiseAbschnitt] = ids.isEmpty ? [] : ((try? await Backend.client.from("dienstreise_abschnitt").select()
            .in("dienstreise_id", values: ids).order("reihenfolge").execute().value) ?? [])
        let fahrerIDs = Array(Set(f.map { $0.driver_id.uuidString.lowercased() }))
        let p: [DispoStandbySpeicher.Profil] = fahrerIDs.isEmpty ? [] : ((try? await Backend.client.from("profiles")
            .select("id, first_name, last_name, driver_number").in("id", values: fahrerIDs).execute().value) ?? [])
        let profilJe = Dictionary(p.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        liste = r.map { x in
            Reise(id: x.id, datum: String(x.datum.prefix(10)), startZeit: DienstreiseVerbindung.hm(x.start_zeit),
                  startName: x.start_name ?? "", startLat: x.start_lat, startLng: x.start_lng,
                  zielName: x.ziel_name ?? "", zielLat: x.ziel_lat, zielLng: x.ziel_lng,
                  zugnummer: x.zugnummer, flugnummer: x.flugnummer, notiz: x.notiz, verbindung: x.verbindung,
                  fahrer: f.filter { $0.dienstreise_id == x.id }.map { y in
                      Fahrer(driverID: y.driver_id, status: (y.status ?? "pending").lowercased(), beendet: y.beendet,
                             profil: profilJe[y.driver_id])
                  }.sorted { ($0.profil?.name ?? "") < ($1.profil?.name ?? "") },
                  abschnitte: abs.filter { $0.dienstreise_id == x.id }.sorted { $0.reihenfolge < $1.reihenfolge },
                  ticketPfad: x.ticket_pfad, ticketName: x.ticket_name)
        }
    }

    // MARK: Schreiben

    struct OrtDaten {
        var id: UUID?
        var name: String
        var adresse: String?
        var lat: Double?
        var lng: Double?
    }

    static func verbindungHolen(_ r: Reise) async -> DienstreiseVerbindung? {
        await DienstreiseVerbindung.holen(datum: r.datum, startZeit: r.startZeit, startName: r.startName, startLat: r.startLat, startLng: r.startLng,
                                          zielName: r.zielName, zielLat: r.zielLat, zielLng: r.zielLng,
                                          zugnummer: r.zugnummer, flugnummer: r.flugnummer)
    }

    /// Abschnitt beim Anlegen (Formular): Felder wie in dienstreise_abschnitt.
    struct NeuerAbschnitt {
        var art: String
        var nummer: String
        var vonName: String
        var vonLat: Double?
        var vonLng: Double?
        var abDatum: String
        var abZeit: String
        var gleisAb: String
        var nachName: String
        var nachLat: Double?
        var nachLng: Double?
        var anDatum: String?
        var anZeit: String
        var gleisAn: String
        var hinweis: String
    }

    /// Ticket in der Ablage (Pfad "<dienstreise_id>/ticket.pdf").
    struct Ticket: Equatable {
        var pfad: String
        var name: String
    }

    func anlegen(id: UUID, datum: String, startZeit: String, start: OrtDaten, ziel: OrtDaten, zugnummer: String, flugnummer: String,
                 notiz: String, fahrerIDs: [UUID], abschnitte: [NeuerAbschnitt] = [], ticket: Ticket? = nil,
                 reisender: String = "", auftragsnummer: String = "") async -> Result<UUID, Error> {
        struct ID: Decodable { let id: UUID }
        struct F: Encodable { let dienstreise_id: String; let driver_id: String }
        func text(_ s: String?) -> AnyJSON { (s ?? "").isEmpty ? .null : .string(s!) }
        func zahl(_ d: Double?) -> AnyJSON { d.map { .double($0) } ?? .null }
        var reise: [String: AnyJSON] = [
            "id": .string(id.uuidString.lowercased()),
            "datum": .string(datum), "start_zeit": .string(startZeit),
            "start_ort_id": text(start.id?.uuidString.lowercased()), "start_name": .string(start.name),
            "start_adresse": text(start.adresse), "start_lat": zahl(start.lat), "start_lng": zahl(start.lng),
            "ziel_ort_id": text(ziel.id?.uuidString.lowercased()), "ziel_name": .string(ziel.name),
            "ziel_adresse": text(ziel.adresse), "ziel_lat": zahl(ziel.lat), "ziel_lng": zahl(ziel.lng),
            "zugnummer": text(zugnummer), "flugnummer": text(flugnummer), "notiz": text(notiz),
        ]
        if let ticket { reise["ticket_pfad"] = .string(ticket.pfad); reise["ticket_name"] = .string(ticket.name.isEmpty ? "Ticket.pdf" : ticket.name) }
        if !reisender.isEmpty { reise["reisender"] = .string(reisender) }
        if !auftragsnummer.isEmpty { reise["auftragsnummer"] = .string(auftragsnummer) }
        // Stand der Verbindung beim Anlegen merken (Rueckfall, falls die Abfrage spaeter nicht klappt).
        let v = await DienstreiseVerbindung.holen(datum: datum, startZeit: startZeit, startName: start.name, startLat: start.lat, startLng: start.lng,
                                                  zielName: ziel.name, zielLat: ziel.lat, zielLng: ziel.lng,
                                                  zugnummer: zugnummer, flugnummer: flugnummer)
        if let gut = v.flatMap({ $0.fehler == nil ? $0 : nil }), let json = try? AnyJSON(gut) {
            reise["verbindung"] = json
            reise["verbindung_stand"] = .string(ISO8601DateFormatter().string(from: Date()))
        } else {
            reise["verbindung"] = .null
            reise["verbindung_stand"] = .null
        }
        do {
            let neu: ID = try await Backend.client.from("dienstreise").insert(reise).select("id").single().execute().value
            // Abschnitte vor den Fahrern speichern: die Fahrer bekommen die Push erst, wenn alles da ist.
            if !abschnitte.isEmpty {
                let zeilen: [[String: AnyJSON]] = abschnitte.enumerated().map { i, x in [
                    "dienstreise_id": .string(neu.id.uuidString.lowercased()),
                    "reihenfolge": .integer(i),
                    "art": .string(x.art.isEmpty ? "zug" : x.art),
                    "nummer": text(x.nummer),
                    "von_name": .string(x.vonName), "von_lat": zahl(x.vonLat), "von_lng": zahl(x.vonLng),
                    "ab_datum": .string(x.abDatum.isEmpty ? datum : x.abDatum),
                    "ab_zeit": text(x.abZeit), "gleis_ab": text(x.gleisAb),
                    "nach_name": text(x.nachName), "nach_lat": zahl(x.nachLat), "nach_lng": zahl(x.nachLng),
                    "an_datum": text(x.anDatum), "an_zeit": text(x.anZeit), "gleis_an": text(x.gleisAn),
                    "hinweis": text(x.hinweis),
                ] }
                try await Backend.client.from("dienstreise_abschnitt").insert(zeilen).execute()
            }
            try await Backend.client.from("dienstreise_fahrer").insert(fahrerIDs.map {
                F(dienstreise_id: neu.id.uuidString.lowercased(), driver_id: $0.uuidString.lowercased())
            }).execute()
            await laden()
            return .success(neu.id)
        } catch {
            return .failure(error)
        }
    }

    // MARK: Ticket

    /// Vom Server gelesenes Ticket (dispo-admin ticket_lesen).
    struct GelesenesTicket: Decodable {
        struct Teil: Decodable {
            let art: String?; let nummer: String?; let von: String?; let nach: String?
            let ab_datum: String?; let ab: String?; let an_datum: String?; let an: String?
            let gleis_ab: String?; let gleis_an: String?; let hinweis: String?
        }
        let erkannt: Bool?; let name: String?; let auftragsnummer: String?; let klasse: String?; let tarif: String?
        let zugbindung: [String]?; let datum: String?; let abschnitte: [Teil]?; let meldung: String?
    }

    /// Ticket in die Ablage legen (Ordner = ID der Dienstreise) und vom Server lesen lassen.
    static func ticketHochladenUndLesen(_ reiseID: UUID, daten: Data, name: String, typ: String)
        async -> (ticket: Ticket?, gelesen: GelesenesTicket?, fehler: String) {
        let endung = name.lowercased().hasSuffix(".pdf") ? "pdf" : (typ.split(separator: "/").last.map(String.init) ?? "pdf")
        let pfad = "\(reiseID.uuidString.lowercased())/ticket.\(endung)"
        do {
            try await Backend.client.storage.from(DienstreiseTicket.bucket).upload(
                pfad, data: daten, options: FileOptions(contentType: typ.isEmpty ? "application/pdf" : typ, upsert: true))
        } catch {
            return (nil, nil, "Hochladen fehlgeschlagen: \(error.localizedDescription)")
        }
        let ticket = Ticket(pfad: pfad, name: name)
        do {
            let g: GelesenesTicket = try await Backend.client.functions.invoke("dispo-admin", options: FunctionInvokeOptions(
                body: ["aktion": "ticket_lesen", "pfad": pfad]))
            return g.erkannt == true ? (ticket, g, "") : (ticket, nil, g.meldung ?? "")
        } catch {
            return (ticket, nil, "Ticket gespeichert, aber nicht gelesen.")
        }
    }

    func aendern(_ id: UUID, datum: String?, startZeit: String?, notiz: String??) async -> String {
        var a: [String: AnyJSON] = [:]
        if let datum { a["datum"] = .string(datum) }
        if let startZeit { a["start_zeit"] = .string(startZeit) }
        if let notiz { a["notiz"] = notiz.map { .string($0) } ?? .null }
        guard !a.isEmpty else { return "" }
        do {
            try await Backend.client.from("dienstreise").update(a).eq("id", value: id.uuidString.lowercased()).execute()
            return ""
        } catch { return error.localizedDescription }
    }

    /// Neue Fahrer bekommen eine Anfrage, vorhandene bleiben wie sie sind (ignoreDuplicates).
    func fahrerDazu(_ id: UUID, _ fahrerIDs: [UUID]) async -> String {
        struct F: Encodable { let dienstreise_id: String; let driver_id: String }
        do {
            try await Backend.client.from("dienstreise_fahrer").upsert(
                fahrerIDs.map { F(dienstreise_id: id.uuidString.lowercased(), driver_id: $0.uuidString.lowercased()) },
                onConflict: "dienstreise_id,driver_id", ignoreDuplicates: true).execute()
            return ""
        } catch { return error.localizedDescription }
    }

    func fahrerWeg(_ id: UUID, _ driverID: UUID) async -> String {
        do {
            try await Backend.client.from("dienstreise_fahrer").delete()
                .eq("dienstreise_id", value: id.uuidString.lowercased()).eq("driver_id", value: driverID.uuidString.lowercased()).execute()
            return ""
        } catch { return error.localizedDescription }
    }

    /// Erst die Fahrer (jeder bekommt „Dienstreise zurückgezogen“), dann die Reise.
    func loeschen(_ id: UUID) async -> String {
        _ = try? await Backend.client.from("dienstreise_fahrer").delete().eq("dienstreise_id", value: id.uuidString.lowercased()).execute()
        do {
            try await Backend.client.from("dienstreise").delete().eq("id", value: id.uuidString.lowercased()).execute()
            await laden()
            return ""
        } catch { return error.localizedDescription }
    }

    /// Laeuft die Dienstreise dieses Fahrers gerade (reiseLaeuft)? Angenommen, nicht beendet, ab 30 min vor
    /// Start bis 2 h nach der letzten Ankunft, ohne Abschnitte bis 18 h nach Start.
    static func laeuft(_ r: Reise, _ f: Fahrer, jetzt: Date = Date()) -> Bool {
        guard f.status == "accepted", f.beendet == nil, let start = Stunden.zeitpunkt(r.datum, r.startZeit) else { return false }
        if jetzt < start.addingTimeInterval(-30 * 60) { return false }
        var ende: Date?
        if let l = r.abschnitte.last, !l.an_zeit.isEmpty {
            ende = Stunden.zeitpunkt(l.an_datum ?? l.ab_datum ?? r.datum, l.an_zeit)
            if let e = ende, e < start { ende = e.addingTimeInterval(86400) }
        }
        let bis = ende.map { $0.addingTimeInterval(2 * 3600) } ?? start.addingTimeInterval(18 * 3600)
        return jetzt < bis
    }

    /// Ohne Abschnitte: die Reise als ein Abschnitt.
    static func teile(_ r: Reise) -> [DienstreiseAbschnitt] {
        if !r.abschnitte.isEmpty { return r.abschnitte }
        return [DienstreiseAbschnitt(id: r.id, dienstreiseID: r.id, art: r.flug ? "flug" : "zug", nummer: r.nummer,
                                     vonName: r.startName, vonLat: r.startLat, vonLng: r.startLng,
                                     abDatum: r.datum, abZeit: r.startZeit,
                                     nachName: r.zielName, nachLat: r.zielLat, nachLng: r.zielLng)]
    }

    // MARK: Anzeige

    /// Zustand eines Fahrers als Text und Farbe (reiseZustand).
    static func zustand(_ f: Fahrer) -> (text: String, farbe: UInt32) {
        if f.status == "pending" { return ("Angefragt", 0x868687) }
        if f.status == "refused" { return ("Abgelehnt", 0xFF6F63) }
        if f.beendet != nil { return ("Beendet", 0x868687) }
        return ("Angenommen", 0xE3F654)
    }
}

/// Live-Stand je Abschnitt der laufenden Dienstreisen (useAbschnittVerbindungen), alle 2 Minuten neu.
/// Bus/U-Bahn ohne Abfrage, Reisen ohne Abschnitte ohne Live-Stand (wie im Web).
@MainActor
final class DispoReiseLive: ObservableObject {
    static let gemeinsam = DispoReiseLive()
    @Published private(set) var je: [UUID: DienstreiseVerbindung] = [:]

    func laufen(_ reisen: [DispoDienstreiseSpeicher.Reise]) async {
        while !Task.isCancelled {
            for r in reisen {
                for a in r.abschnitte {
                    if Task.isCancelled { return }
                    if let v = await DienstreiseAbschnitt.holen(a, datum: r.datum), v.fehler == nil { je[a.id] = v }
                }
            }
            try? await Task.sleep(for: .seconds(120))
        }
    }
}
