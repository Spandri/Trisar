import CoreLocation
import Foundation
import Supabase
import SwiftUI

/// Verbindung einer Dienstreise (Zug oder Flug), gleich in fahrer/src/shared/dienstreise.js und
/// admin/src/shared/dienstreise.js (verbindungHolen). Zug ueber train-validate (Abfahrt am Start,
/// Ausstieg nahe am Ziel, Strecke), Flug ueber flight-validate.
/// Die Felder heissen wie im JSON, das die Dispo beim Anlegen in dienstreise.verbindung speichert (Rueckfall).
/// Geteilt mit der Dispo-App (ios-dispo/project.yml).
struct DienstreiseVerbindung: Codable, Equatable {
    struct Halt: Codable, Equatable {
        var name: String
        var lat: Double
        var lng: Double
        var punkt: CLLocationCoordinate2D { CLLocationCoordinate2D(latitude: lat, longitude: lng) }
    }

    /// Zwischenhalt eines Zugs (train-validate mit mit_halten, ohne Start und Ziel), Zeiten HH:MM.
    struct Zwischenhalt: Codable, Equatable {
        var name = ""
        var an_plan = ""
        var an = ""
        var ab_plan = ""
        var ab = ""
        var gleis = ""

        /// Eine Zeit je Halt: ab, sonst an (Ist, sonst Plan).
        var zeit: String {
            let ist = ab.isEmpty ? an : ab
            if !ist.isEmpty { return ist }
            return ab_plan.isEmpty ? an_plan : ab_plan
        }

        /// Verspaetung an diesem Halt in Minuten (0 = puenktlich).
        var spaet: Int {
            ab.isEmpty ? DienstreiseVerbindung.verspaetung(ist: an, plan: an_plan) : DienstreiseVerbindung.verspaetung(ist: ab, plan: ab_plan)
        }
    }

    var art = "zug"
    var nummer = ""
    var abfahrt_plan = ""
    var abfahrt = ""
    var gleis = ""
    /// Nur live (15.11.): Abfahrtsgleis laut Fahrplan, Ankunftsgleis live und laut Fahrplan. Weicht das Live-Gleis
    /// ab, zeigen die Ansichten die Aenderung (gleisGeaendert).
    var gleis_plan = ""
    var gleis_an = ""
    var gleis_an_plan = ""
    var ankunft_plan = ""
    var ankunft = ""
    var ankunft_ort = ""
    var strecke: [Halt] = []
    /// Zug: Verlauf entlang der Gleise als [[lng, lat], ...] (strecke_linie von train-validate).
    var linie: [[Double]] = []
    /// Zug: Zwischenhalte (nur live mit mit_halten, fehlt = keine Halte-Kachel).
    var halte: [Zwischenhalt] = []
    /// Nur live: Zug bzw. Flug nicht gefunden (wird nie gespeichert).
    var fehler: String?

    private enum CodingKeys: String, CodingKey {
        case art, nummer, abfahrt_plan, abfahrt, gleis, ankunft_plan, ankunft, ankunft_ort, strecke, linie, halte
    }

    /// Gleisverlauf als Kartenpunkte (nur gueltige Paare).
    var liniePunkte: [CLLocationCoordinate2D] {
        linie.compactMap { p in p.count >= 2 ? CLLocationCoordinate2D(latitude: p[1], longitude: p[0]) : nil }
    }

    init(art: String, nummer: String, fehler: String? = nil) {
        self.art = art
        self.nummer = nummer
        self.fehler = fehler
    }

    init() {}

    /// Gespeicherter Stand: fehlende Felder sind leer (jsonb kann alles enthalten).
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        func s(_ k: CodingKeys) -> String { ((try? c.decodeIfPresent(String.self, forKey: k)) ?? nil) ?? "" }
        art = s(.art).isEmpty ? "zug" : s(.art)
        nummer = s(.nummer)
        abfahrt_plan = s(.abfahrt_plan)
        abfahrt = s(.abfahrt)
        gleis = s(.gleis)
        ankunft_plan = s(.ankunft_plan)
        ankunft = s(.ankunft)
        ankunft_ort = s(.ankunft_ort)
        strecke = ((try? c.decodeIfPresent([AnyJSON].self, forKey: .strecke)) ?? nil)?.compactMap(Self.halt) ?? []
        linie = Self.linie(((try? c.decodeIfPresent(AnyJSON.self, forKey: .linie)) ?? nil))
        halte = Self.halte(((try? c.decodeIfPresent(AnyJSON.self, forKey: .halte)) ?? nil))
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(art, forKey: .art)
        try c.encode(nummer, forKey: .nummer)
        try c.encode(abfahrt_plan, forKey: .abfahrt_plan)
        try c.encode(abfahrt, forKey: .abfahrt)
        try c.encode(gleis, forKey: .gleis)
        try c.encode(ankunft_plan, forKey: .ankunft_plan)
        try c.encode(ankunft, forKey: .ankunft)
        try c.encode(ankunft_ort, forKey: .ankunft_ort)
        try c.encode(strecke, forKey: .strecke)
        try c.encode(linie, forKey: .linie)
        if !halte.isEmpty { try c.encode(halte, forKey: .halte) }
    }

    // MARK: Hilfen wie in dienstreise.js

    static func hm(_ wert: String?) -> String { String((wert ?? "").prefix(5)) }

    /// Verspaetung Ist minus Plan in Minuten, ueber Mitternacht (23:58 -> 00:03 = +5). Frueher oder unbekannt = 0.
    static func verspaetung(ist: String?, plan: String?) -> Int {
        guard let i = DienstreiseAbschnitt.minuten(ist), let p = DienstreiseAbschnitt.minuten(plan) else { return 0 }
        let d = (i - p + 1440) % 1440
        // Negativ = zu frueh (14.11.: gruene Kachel "-2").
        return d > 720 ? d - 1440 : d
    }

    /// Verspaetung der Abfahrt bzw. Ankunft in Minuten (0 = puenktlich).
    var abfahrtSpaet: Int { Self.verspaetung(ist: abfahrt, plan: abfahrt_plan) }
    var ankunftSpaet: Int { Self.verspaetung(ist: ankunft, plan: ankunft_plan) }

    /// Gleis live gegen Plan (Ticket bzw. Abschnitt, sonst Fahrplan): (aktuell, vorher), vorher leer = unveraendert.
    static func gleisStand(live: String?, ticket: String, fahrplan: String?) -> (gleis: String, vorher: String) {
        let l = (live ?? "").trimmingCharacters(in: .whitespaces)
        let plan = ticket.isEmpty ? (fahrplan ?? "") : ticket
        if l.isEmpty { return (ticket, "") }
        return (l, !plan.isEmpty && plan != l ? plan : "")
    }

    /// 'flug', wenn eine Flugnummer da ist, sonst 'zug'.
    static func art(zugnummer: String?, flugnummer: String?) -> String {
        (flugnummer ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "zug" : "flug"
    }

    static func nummer(zugnummer: String?, flugnummer: String?) -> String {
        let z = (zugnummer ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        return z.isEmpty ? (flugnummer ?? "").trimmingCharacters(in: .whitespacesAndNewlines) : z
    }

    private static func zahl(_ j: AnyJSON?) -> Double? {
        switch j {
        case let .double(d)?: return d
        case let .integer(i)?: return Double(i)
        case let .string(t)?: return Double(t)
        default: return nil
        }
    }

    /// [[lng, lat], ...] aus beliebigem JSON, kaputte Punkte fallen weg.
    private static func linie(_ j: AnyJSON?) -> [[Double]] {
        (j?.arrayValue ?? []).compactMap { p in
            guard let a = p.arrayValue, a.count >= 2, let lng = zahl(a[0]), let lat = zahl(a[1]) else { return nil }
            return [lng, lat]
        }
    }

    /// halte aus train-validate bzw. gespeichertem JSON, Halte ohne Namen fallen weg.
    private static func halte(_ j: AnyJSON?) -> [Zwischenhalt] {
        (j?.arrayValue ?? []).compactMap { h in
            guard let o = h.objectValue else { return nil }
            let name = text(o, "name").trimmingCharacters(in: .whitespacesAndNewlines)
            if name.isEmpty { return nil }
            return Zwischenhalt(name: name, an_plan: hm(text(o, "an_plan")), an: hm(text(o, "an")),
                                ab_plan: hm(text(o, "ab_plan")), ab: hm(text(o, "ab")), gleis: text(o, "gleis"))
        }
    }

    private static func halt(_ j: AnyJSON) -> Halt? {
        guard let o = j.objectValue, let lat = zahl(o["lat"]), let lng = zahl(o["lng"]) else { return nil }
        return Halt(name: o["name"]?.stringValue ?? "", lat: lat, lng: lng)
    }

    private static func text(_ o: [String: AnyJSON]?, _ k: String) -> String {
        guard let v = o?[k] else { return "" }
        switch v {
        case let .string(t): return t
        case let .integer(i): return String(i)
        case let .double(d): return String(d)
        default: return ""
        }
    }

    // MARK: Abfrage (verbindungHolen)

    /// Fehlermeldung aus der Antwort, sonst die des Aufrufs, sonst der feste Text.
    private static func aufrufen(_ name: String, _ body: [String: AnyJSON]) async -> (daten: [String: AnyJSON]?, fehler: String?) {
        do {
            let antwort: AnyJSON = try await Backend.client.functions.invoke(name, options: FunctionInvokeOptions(body: body))
            return (antwort.objectValue, nil)
        } catch {
            return (nil, error.localizedDescription)
        }
    }

    /// startZeit: Startzeit der Dienstreise, train-validate sucht die Abfahrt erst ab dieser Stunde.
    static func holen(datum: String, startZeit: String? = nil, startName: String, startLat: Double?, startLng: Double?,
                      zielName: String, zielLat: Double?, zielLng: Double?,
                      zielBahnhof: String? = nil,
                      zugnummer: String?, flugnummer: String?) async -> DienstreiseVerbindung? {
        let nr = nummer(zugnummer: zugnummer, flugnummer: flugnummer)
        if nr.isEmpty { return nil }
        if art(zugnummer: zugnummer, flugnummer: flugnummer) == "zug" {
            var body: [String: AnyJSON] = [
                "train_number": .string(nr),
                "ride_date": .string(datum),
                "start_station": .string(startName),
                "mit_halten": .bool(true),
            ]
            let zeit = hm(startZeit)
            if !zeit.isEmpty { body["start_zeit"] = .string(zeit) }
            // Abschnitt mit bekanntem Ausstieg (Ticket, Umstieg): genau dort, sonst Halt am naechsten zum Ziel.
            let bahnhof = (zielBahnhof ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            if !bahnhof.isEmpty {
                body["target_station"] = .string(bahnhof)
            } else if let zielLat, let zielLng {
                body["target_lat"] = .double(zielLat)
                body["target_lng"] = .double(zielLng)
            }
            let a = await aufrufen("train-validate", body)
            guard let d = a.daten, d["valid"]?.boolValue == true else {
                let m = text(a.daten, "message")
                return DienstreiseVerbindung(art: "zug", nummer: nr, fehler: m.isEmpty ? (a.fehler ?? "Zug nicht gefunden.") : m)
            }
            let s = d["summary"]?.objectValue
            var v = DienstreiseVerbindung(art: "zug", nummer: text(s, "line_name").isEmpty ? nr : text(s, "line_name"))
            v.abfahrt_plan = hm(String(text(s, "planned_departure").dropFirst(11)))
            let etd = text(d, "etd_label")
            v.abfahrt = etd.isEmpty ? hm(String(text(s, "predicted_departure").dropFirst(11))) : etd
            v.gleis = text(d, "departure_platform")
            v.gleis_plan = text(s, "departure_platform_planned")
            v.gleis_an = text(s, "arrival_platform")
            v.gleis_an_plan = text(s, "arrival_platform_planned")
            v.ankunft_plan = hm(String(text(s, "planned_arrival").dropFirst(11)))
            v.ankunft = text(d, "eta_label")
            let ort = text(s, "target_station_name")
            v.ankunft_ort = ort.isEmpty ? text(d, "target_station") : ort
            v.strecke = (d["strecke"]?.arrayValue ?? []).compactMap(halt)
            v.linie = linie(d["strecke_linie"])
            v.halte = halte(d["halte"])
            return v
        }
        let a = await aufrufen("flight-validate", [
            "flight_number": .string(nr),
            "ride_date": .string(datum),
            "require_lufthansa_group": .bool(false),
        ])
        guard let d = a.daten, d["valid"]?.boolValue == true else {
            let m = text(a.daten, "message")
            return DienstreiseVerbindung(art: "flug", nummer: nr, fehler: m.isEmpty ? (a.fehler ?? "Flug nicht gefunden.") : m)
        }
        let s = d["summary"]?.objectValue
        // "2026-11-13 15:35" bzw. "2026-11-13T15:35:00" -> "15:35"
        func uhr(_ k: String) -> String {
            let t = text(s, k).replacingOccurrences(of: " ", with: "T")
            let teile = t.split(separator: "T", omittingEmptySubsequences: false)
            return teile.count > 1 ? hm(String(teile[1])) : ""
        }
        func erstes(_ ks: String...) -> String { ks.map(uhr).first { !$0.isEmpty } ?? "" }
        var v = DienstreiseVerbindung(art: "flug", nummer: text(s, "flight_iata").isEmpty ? nr : text(s, "flight_iata"))
        v.abfahrt_plan = uhr("scheduled_departure_local")
        v.abfahrt = erstes("actual_departure_local", "estimated_departure_local", "scheduled_departure_local")
        let terminal = text(s, "departure_terminal"), gate = text(s, "departure_gate")
        v.gleis = [terminal.isEmpty ? "" : "Terminal \(terminal)", gate.isEmpty ? "" : "Gate \(gate)"]
            .filter { !$0.isEmpty }.joined(separator: " · ")
        v.ankunft_plan = uhr("scheduled_arrival_local")
        v.ankunft = erstes("actual_arrival_local", "estimated_arrival_local", "scheduled_arrival_local")
        v.ankunft_ort = text(s, "arrival_airport")
        // Flug: Bogen vom Start zum Ziel der Dienstreise (wie die Flugbahn bei Fahrten).
        if let startLat, let startLng, let zielLat, let zielLng {
            v.strecke = [Halt(name: startName, lat: startLat, lng: startLng), Halt(name: zielName, lat: zielLat, lng: zielLng)]
        }
        return v
    }
}

// MARK: - Abschnitte (Umstiege) und Ticket, gleich in beiden Apps

/// Ein Abschnitt der Dienstreise (Tabelle dienstreise_abschnitt): Bus, U-Bahn, Zug, Flug ...
struct DienstreiseAbschnitt: Decodable, Identifiable, Equatable {
    let id: UUID
    let dienstreise_id: UUID
    let reihenfolge: Int
    let art: String
    let nummer: String
    let von_name: String
    let von_lat: Double?
    let von_lng: Double?
    let ab_datum: String?
    let ab_zeit: String
    let gleis_ab: String
    let nach_name: String
    let nach_lat: Double?
    let nach_lng: Double?
    let an_datum: String?
    let an_zeit: String
    let gleis_an: String
    let hinweis: String
    /// Linie vom Server (Spalte linie, [[lng, lat], ...]): Bus entlang der Strassen, U-Bahn/Tram entlang der Gleise.
    let linie: [[Double]]?

    private enum K: String, CodingKey {
        case id, dienstreise_id, reihenfolge, art, nummer, von_name, von_lat, von_lng, ab_datum, ab_zeit, gleis_ab
        case nach_name, nach_lat, nach_lng, an_datum, an_zeit, gleis_an, hinweis, linie
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        func s(_ k: K) -> String { ((try? c.decodeIfPresent(String.self, forKey: k)) ?? nil) ?? "" }
        func d(_ k: K) -> Double? { (try? c.decodeIfPresent(Double.self, forKey: k)) ?? nil }
        id = try c.decode(UUID.self, forKey: .id)
        dienstreise_id = try c.decode(UUID.self, forKey: .dienstreise_id)
        reihenfolge = ((try? c.decodeIfPresent(Int.self, forKey: .reihenfolge)) ?? nil) ?? 0
        art = s(.art).isEmpty ? "zug" : s(.art)
        nummer = s(.nummer); von_name = s(.von_name); von_lat = d(.von_lat); von_lng = d(.von_lng)
        ab_datum = s(.ab_datum).isEmpty ? nil : String(s(.ab_datum).prefix(10))
        ab_zeit = DienstreiseVerbindung.hm(s(.ab_zeit)); gleis_ab = s(.gleis_ab)
        nach_name = s(.nach_name); nach_lat = d(.nach_lat); nach_lng = d(.nach_lng)
        an_datum = s(.an_datum).isEmpty ? nil : String(s(.an_datum).prefix(10))
        an_zeit = DienstreiseVerbindung.hm(s(.an_zeit)); gleis_an = s(.gleis_an); hinweis = s(.hinweis)
        // Fehlende Spalte, null oder kaputter Wert: einfach keine Linie.
        linie = ((try? c.decodeIfPresent([[Double]].self, forKey: .linie)) ?? nil)
    }

    /// Reise ohne Abschnitte als ein Abschnitt (fuer ReiseLage).
    init(id: UUID, dienstreiseID: UUID, art: String, nummer: String, vonName: String, vonLat: Double?, vonLng: Double?,
         abDatum: String?, abZeit: String, nachName: String, nachLat: Double?, nachLng: Double?,
         anDatum: String? = nil, anZeit: String = "", gleisAb: String = "", gleisAn: String = "", hinweis: String = "") {
        self.id = id; dienstreise_id = dienstreiseID; reihenfolge = 0; self.art = art; self.nummer = nummer
        von_name = vonName; von_lat = vonLat; von_lng = vonLng; ab_datum = abDatum; ab_zeit = abZeit; gleis_ab = gleisAb
        nach_name = nachName; nach_lat = nachLat; nach_lng = nachLng; an_datum = anDatum; an_zeit = anZeit
        gleis_an = gleisAn; self.hinweis = hinweis; linie = nil
    }

    /// Live-Stand eines Abschnitts (Zug mit genauem Ausstieg, Flug), nil bei Bus/U-Bahn oder ohne Nummer.
    static func holen(_ a: DienstreiseAbschnitt, datum: String) async -> DienstreiseVerbindung? {
        guard mitLive(a.art), !a.nummer.trimmingCharacters(in: .whitespaces).isEmpty else { return nil }
        let flug = a.art == "flug"
        return await DienstreiseVerbindung.holen(datum: a.ab_datum ?? datum, startZeit: a.ab_zeit, startName: a.von_name,
                                                 startLat: a.von_lat, startLng: a.von_lng,
                                                 zielName: a.nach_name, zielLat: a.nach_lat, zielLng: a.nach_lng,
                                                 zielBahnhof: a.nach_name,
                                                 zugnummer: flug ? "" : a.nummer, flugnummer: flug ? a.nummer : "")
    }

    var vonPunkt: CLLocationCoordinate2D? {
        guard let von_lat, let von_lng else { return nil }
        return CLLocationCoordinate2D(latitude: von_lat, longitude: von_lng)
    }
    var nachPunkt: CLLocationCoordinate2D? {
        guard let nach_lat, let nach_lng else { return nil }
        return CLLocationCoordinate2D(latitude: nach_lat, longitude: nach_lng)
    }

    /// Kachel-Icon je Art (abschnittIcon).
    static func icon(_ art: String) -> String {
        switch art {
        case "bus": return "Bus_Trisar_Icons_01_grau"
        case "ubahn", "tram": return "U_Bahn_Trisar_Icons_01_grau"
        case "flug": return "Plain_Abflug_Trisar_Icons_01_grau"
        default: return "Bahnhof_Zug_Trisar_Icons_01_grau"
        }
    }

    /// Nur Zug, S-Bahn und Flug werden live abgefragt, Bus/U-Bahn/Tram behalten die Zeiten aus dem Ticket.
    static func mitLive(_ art: String) -> Bool { art == "zug" || art == "sbahn" || art == "flug" }

    /// Art aus der Nummer (abschnittArt): Bus/U-Bahn/Tram ohne Live-Abfrage, Flug = zwei Zeichen + Ziffern.
    static func art(_ nummer: String) -> String {
        let n = nummer.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        func passt(_ muster: String) -> Bool { n.range(of: muster, options: .regularExpression) != nil }
        if n.isEmpty { return "zug" }
        if passt(#"^BUS\b"#) { return "bus" }
        if passt(#"^U\s?\d|^U-?BAHN"#) { return "ubahn" }
        if passt(#"^(STR|TRAM)\b"#) { return "tram" }
        if passt(#"^S\s?\d"#) { return "sbahn" }
        if passt(#"^(ICE|IC|EC|ECE|RJX?|NJ|EN|TGV|FLX|WB|RE|RB|IRE|MEX|ALX|BRB|ARV|ERB|AG)\s?\d"#) { return "zug" }
        if passt(#"^[A-Z0-9]{2}\s?\d{1,4}[A-Z]?$"#) { return "flug" }
        return "zug"
    }

    /// Minuten seit Mitternacht aus "HH:MM".
    static func minuten(_ hhmm: String?) -> Int? {
        let t = (hhmm ?? "").split(separator: ":")
        guard t.count >= 2, let h = Int(t[0]), let m = Int(t[1].prefix(2)) else { return nil }
        return h * 60 + m
    }
}

enum DienstreiseTicket {
    static let bucket = "dienstreise-tickets"

    /// Ticket zum Ansehen (Link gilt 1 Stunde).
    static func link(_ pfad: String?) async -> URL? {
        guard let pfad, !pfad.isEmpty else { return nil }
        return try? await Backend.client.storage.from(bucket).createSignedURL(path: pfad, expiresIn: 3600)
    }
}

// MARK: - Verspaetung und Halte im Zugabschnitt, gleich in beiden Apps (abgenommen 14.11.)

enum ReiseFarben {
    static let lime = Color(hex: 0xE3F654)
    static let orange = Color(hex: 0xF0997B)
    static let grau = Color(hex: 0x868687)
    static let offen = Color(hex: 0x5C5C5C)
    static let kachel = Color(hex: 0x242525)
    static let gefahrenGrund = Color(hex: 0x3A3A3A)

    /// Zeitfarbe: verspaetet Orange, sonst Lime.
    static func zeit(_ spaet: Int) -> Color { spaet > 0 ? orange : lime }
}

/// Kleine Kachel „+5“ rechts neben einer verspaeteten Zeit (gefahren grau).
struct VerspaetungKachel: View {
    let minuten: Int
    var gefahren = false
    var groesse: CGFloat = 13

    var body: some View {
        // Spaet orange "+5", zu frueh gruen "-2" (14.11.).
        Text(minuten < 0 ? "\u{2212}\(-minuten)" : "+\(minuten)")
            .font(.grotesk(groesse, .bold))
            .foregroundStyle(gefahren ? ReiseFarben.grau : Color.black)
            .lineLimit(1)
            .padding(.vertical, 2).padding(.horizontal, 8)
            .background(RoundedRectangle(cornerRadius: 8).fill(gefahren ? ReiseFarben.gefahrenGrund
                : (minuten < 0 ? Color(red: 0x59 / 255, green: 0xBE / 255, blue: 0x80 / 255) : ReiseFarben.orange)))
            .fixedSize()
    }
}

/// Halte eines Zugabschnitts zum Ausklappen (wie ZugHalte.jsx): zu nur die Kachel „chevron.down 5 Halte“, offen
/// der Strahl mit Punkt je Halt, Name und einer Zeit (ab, sonst an), darunter die Kachel „chevron.up Halte“.
/// Gefahren = Ist-Zeit vorbei (gerechnet ab der Abfahrt des Abschnitts, ueber Mitternacht), erster offener Halt ist
/// der aktuelle (nur waehrend der Abschnitt laeuft). Feste Hoehen, damit die Dispo (festes Raster) mitrechnen kann.
struct HalteKachel: View {
    let halte: [DienstreiseVerbindung.Zwischenhalt]
    /// Abschnitt: "fertig", "jetzt" oder "offen" (ReiseLage.status).
    let status: String
    /// Ist-Abfahrt des Abschnitts (HH:MM), Bezug fuer Fahrten ueber Mitternacht.
    let abfahrt: String
    var jetzt = Date()
    @Binding var offen: Bool

    static let zeileHoehe: CGFloat = 40
    static let knopfHoehe: CGFloat = 40
    static let luft: CGFloat = 12

    /// Hoehe ohne Abstand oben.
    static func hoehe(anzahl: Int, offen: Bool) -> CGFloat {
        offen ? CGFloat(anzahl) * zeileHoehe + luft + knopfHoehe : knopfHoehe
    }

    private var gefahren: [Bool] {
        let k = Calendar(identifier: .gregorian).dateComponents(in: TimeZone(identifier: "Europe/Berlin") ?? .current, from: jetzt)
        let jetztMin = Double((k.hour ?? 0) * 60 + (k.minute ?? 0)) + Double(k.second ?? 0) / 60
        let erste = halte.first.map { $0.ab.isEmpty ? $0.an : $0.ab }
        let basis = Double(DienstreiseAbschnitt.minuten(abfahrt) ?? DienstreiseAbschnitt.minuten(erste) ?? 0)
        func seit(_ m: Double) -> Double { (m - basis + 1440).truncatingRemainder(dividingBy: 1440) }
        return halte.map { h in
            if status == "fertig" { return true }
            if status != "jetzt" { return false }
            guard let m = DienstreiseAbschnitt.minuten(h.ab.isEmpty ? h.an : h.ab) else { return false }
            return seit(Double(m)) < seit(jetztMin)
        }
    }

    var body: some View {
        let g = gefahren
        let aktuell = status == "jetzt" ? g.firstIndex(of: false) : nil
        VStack(spacing: 0) {
            if offen {
                VStack(spacing: 0) {
                    ForEach(Array(halte.enumerated()), id: \.offset) { i, h in
                        zeile(h, i: i, gefahren: g, aktuell: aktuell == i)
                    }
                }
                knopf("Halte", oben: true).padding(.top, Self.luft)
            } else {
                knopf("\(halte.count) Halte", oben: false)
            }
        }
    }

    private func knopf(_ text: String, oben: Bool) -> some View {
        Button { offen.toggle() } label: {
            HStack(spacing: 8) {
                Image(systemName: oben ? "chevron.up" : "chevron.down").font(.system(size: 15, weight: .heavy))
                Text(text).font(.grotesk(16, .bold)).tracking(-0.3)
            }
            .foregroundStyle(ReiseFarben.lime)
            .padding(.horizontal, 14)
            .frame(maxWidth: .infinity, minHeight: Self.knopfHoehe, maxHeight: Self.knopfHoehe, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: 10).fill(ReiseFarben.kachel))
            .contentShape(Rectangle())
        }
        .buttonStyle(.web)
    }

    private func zeile(_ h: DienstreiseVerbindung.Zwischenhalt, i: Int, gefahren g: [Bool], aktuell: Bool) -> some View {
        let weg = g[i]
        let zeit = h.ab.isEmpty ? h.an : h.ab
        let spaet = h.spaet
        // Strahl: Stueck vor dem Halt gefahren, wenn der vorige Halt gefahren ist (erster: Abschnitt laeuft).
        let vorher = i == 0 ? status != "offen" : g[i - 1]
        return HStack(spacing: 12) {
            ZStack {
                VStack(spacing: 0) {
                    Rectangle().fill(vorher ? ReiseFarben.lime : ReiseFarben.offen).frame(width: 3)
                    Rectangle().fill(weg ? ReiseFarben.lime : ReiseFarben.offen).frame(width: 3)
                }
                if aktuell {
                    Circle().fill(Color(hex: 0x1A1A1A)).frame(width: 20, height: 20)
                        .overlay(Circle().strokeBorder(ReiseFarben.lime, lineWidth: 3))
                } else {
                    Circle().fill(weg ? ReiseFarben.lime : ReiseFarben.offen).frame(width: 12, height: 12)
                }
            }
            .frame(width: 20, height: Self.zeileHoehe)
            Text(h.name).font(.grotesk(16, .bold)).tracking(-0.3).foregroundStyle(weg ? ReiseFarben.grau : Color.white)
                .lineLimit(1).truncationMode(.tail)
                .frame(maxWidth: .infinity, alignment: .leading)
            if !zeit.isEmpty {
                HStack(spacing: 6) {
                    Text(zeit).font(.grotesk(16, .bold))
                        .foregroundStyle(weg ? ReiseFarben.grau : ReiseFarben.zeit(spaet))
                    if spaet != 0 { VerspaetungKachel(minuten: spaet, gefahren: weg) }
                }
                .lineLimit(1).fixedSize()
            }
        }
        .frame(height: Self.zeileHoehe)
    }
}
