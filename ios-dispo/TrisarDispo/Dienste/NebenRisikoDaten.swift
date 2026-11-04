import Foundation
import SwiftUI

/// Risiko je Fahrt und Ereignisse eines Einsatztages (demo/risikoErgebnisse.js).
/// Im Web gibt es die Werte nur in der Demo (vorab gerechnet, data/risiko-ergebnisse.json).
/// Die App liest dieselbe Datei, wenn sie im Bundle liegt; live liegt sie nicht dort,
/// dann zeigen die Seiten "keine Rechnung der Engine" und Fahrt bearbeiten nichts.

/// BISHER_PUFFER_MIN: pauschaler Puffer des bisherigen Planers.
let nebenBisherPufferMin = 20

// MARK: - Datei

struct NebenRisikoDatei: Decodable {
    let tage: [String: NebenRisikoTag]
}

struct NebenRisikoTag: Decodable {
    let datum: String?
    let name: String?
    let verlaeufe: Int?
    let ereignisse: [NebenEreignis]?
    let optionen: [String: NebenRisikoOption]?
}

struct NebenRisikoOption: Decodable {
    let puffer_mittel: Double?
    let hoch: [String]
    let unter_bisher: Int?
    let ueber_bisher: Int?
    let verlauf: [NebenStundenLuft]
    let faecher: [NebenFaecherStunde]?
    let puenktlich_abholung: Double?
    let knappste_stunde: Int?
    let fahrten: [String: NebenRisikoFahrt]
}

struct NebenStundenLuft: Decodable, Equatable {
    let h: Int
    let luft_p10: Double?
}

struct NebenFaecherStunde: Decodable, Equatable {
    let h: Int
    let n: Int?
    let p50: Double?
    let spaet: Double?
    /// 19 Quantile 5 % … 95 %.
    let q: [Double]?
}

/// Eine Fahrt aus der Risikorechnung (Wert in `fahrten` je Ride-ID).
struct NebenRisikoFahrt: Decodable, Equatable {
    struct Fahrzeit: Decodable, Equatable {
        let plan: Double?
        let p10: Double?
        let p50: Double
        let p90: Double
        let von: Double
        let bis: Double
        let hist: [Double]
    }
    struct Ursache: Decodable, Equatable {
        let name: String
        let anteil: Double
        let bis_min: Double
    }
    struct Ereignis: Decodable, Equatable {
        let name: String
        let min: Double
        let route: String?
    }
    struct Luft: Decodable, Equatable {
        let puffer: Double
        let folge_abfahrt: String?
        let folge_puenktlich: Int?
        let verlaeufe: Int?
    }
    let fahrzeit: Fahrzeit?
    let ursachen: [Ursache]?
    let ereignis: Ereignis?
    let luft: Luft?
    let fahrer: String?
    let abfahrt: String?
    let von: String?
    let nach: String?
    let klasse: String
}

struct NebenKachel: Decodable, Equatable {
    var name: String
    var gross: String
    var klein: String
}

/// Ereignis eines Tages: automatisch gefunden (JSON) oder von der Disposition ergaenzt.
struct NebenEreignis: Decodable, Equatable, Identifiable {
    var id: String
    var art: String?
    var titel: String
    var kurz: String?
    var zusatz: String?
    var von: String?
    var bis: String?
    var zeit: String
    var wirkung: String
    var quelle: String
    var fahrten: Int?
    var kachel: NebenKachel?
    /// Eingetippter Text bei eigenen Ereignissen.
    var text: String?
    /// "auto" oder "eigen" (quelleArt im Web).
    var quelleArt = "auto"
    var angepasst = false

    enum CodingKeys: String, CodingKey {
        case id, art, titel, kurz, zusatz, von, bis, zeit, wirkung, quelle, fahrten, kachel, text
    }

    /// kachelWerte: Name, Zeitfenster gross, eine Zeile Wirkung.
    var kachelWerte: NebenKachel {
        if let kachel { return kachel }
        let gross = zeit == "ganztägig" ? "ganztags" : "\(Self.stunde(von))–\(Self.stunde(bis, auf: true))"
        let plus = NebenRisiko.treffer(#"\+(\d+)"#, in: wirkung).first ?? "?"
        let n = fahrten ?? 0
        let klein: String
        switch id {
        case "heimspiel": klein = "A9 Nord · bis +\(plus) min"
        case "messe": klein = "Zufahrt Messe · bis +\(plus) min"
        case "innenstadt": klein = "Altstadt · bis +\(plus) min"
        case "fluege": klein = "\(n) Fahrten · Verspätung"
        case "zuege": klein = "\(n) \(n == 1 ? "Fahrt" : "Fahrten") · Verspätung"
        case "verkehr": klein = "Muster je Stunde"
        default: klein = wirkung
        }
        return NebenKachel(name: kurz ?? titel, gross: gross, klein: klein)
    }

    private static func stunde(_ hhmm: String?, auf: Bool = false) -> String {
        let teile = (hhmm ?? "").split(separator: ":").map { Int($0) }
        guard let h = teile.first ?? nil else { return "" }
        let m = teile.count > 1 ? (teile[1] ?? 0) : 0
        let wert = auf && m > 0 ? h + 1 : h
        let anzeige = wert % 24 == 0 && wert > 0 ? 24 : wert
        return String(format: "%02d", anzeige)
    }
}

/// Aenderung eines automatischen Ereignisses (nur die gesetzten Felder zaehlen).
struct NebenEreignisWerte: Equatable {
    var von: String?
    var bis: String?
    var zeit: String?
    var wirkung: String?
}

// MARK: - Speicher

/// Daten laden und die Ereignis-Aenderungen der Disposition halten. Wie im Web nur im
/// Speicher (leben bis zum Beenden der App), nichts geht in die Datenbank.
@MainActor
final class NebenRisikoSpeicher: ObservableObject {
    static let geteilt = NebenRisikoSpeicher()

    private struct TagAenderung {
        var entfernt: [String] = []
        var geaendert: [String: NebenEreignisWerte] = [:]
        var eigene: [NebenEreignis] = []
    }

    @Published private(set) var daten: NebenRisikoDatei?
    @Published private var aenderungen: [String: TagAenderung] = [:]

    private init() {
        if let url = Bundle.main.url(forResource: "risiko-ergebnisse", withExtension: "json"),
           let roh = try? Data(contentsOf: url) {
            daten = try? JSONDecoder().decode(NebenRisikoDatei.self, from: roh)
        }
    }

    /// tagIndex: Tage ab heute (0 = heute), so liegen die Tage in der Datei.
    static func tagIndex(_ iso: String) -> Int? {
        guard let tag = NebenRisiko.isoDatum(iso) else { return nil }
        let k = Calendar.current
        return k.dateComponents([.day], from: k.startOfDay(for: Date()), to: k.startOfDay(for: tag)).day
    }

    func tag(_ iso: String) -> NebenRisikoTag? {
        guard let i = Self.tagIndex(iso) else { return nil }
        return daten?.tage[String(i)]
    }

    func option(_ iso: String, _ option: String = "standard") -> NebenRisikoOption? {
        let t = tag(iso)
        return t?.optionen?[option] ?? t?.optionen?["standard"]
    }

    func fahrt(_ iso: String, rideID: String, option: String = "standard") -> NebenRisikoFahrt? {
        self.option(iso, option)?.fahrten[rideID]
    }

    // MARK: Ereignisse

    func ereignisse(_ iso: String) -> [NebenEreignis] {
        let auto = tag(iso)?.ereignisse ?? []
        let a = aenderungen[iso] ?? TagAenderung()
        let liste = auto.filter { !a.entfernt.contains($0.id) }.map { e -> NebenEreignis in
            var neu = e
            neu.quelleArt = "auto"
            if let g = a.geaendert[e.id] {
                if let v = g.von { neu.von = v }
                if let v = g.bis { neu.bis = v }
                if let v = g.zeit { neu.zeit = v }
                if let v = g.wirkung { neu.wirkung = v }
                neu.angepasst = true
                neu.kachel = nil
            }
            return neu
        }
        return liste + a.eigene.map { var e = $0; e.quelleArt = "eigen"; return e }
    }

    func entfernte(_ iso: String) -> [NebenEreignis] {
        guard let a = aenderungen[iso] else { return [] }
        return (tag(iso)?.ereignisse ?? []).filter { a.entfernt.contains($0.id) }
    }

    func entfernen(_ iso: String, _ id: String) {
        var a = aenderungen[iso] ?? TagAenderung()
        if a.eigene.contains(where: { $0.id == id }) {
            a.eigene.removeAll { $0.id == id }
        } else if !a.entfernt.contains(id) {
            a.entfernt.append(id)
        }
        aenderungen[iso] = a
    }

    func wiederherstellen(_ iso: String, _ id: String) {
        var a = aenderungen[iso] ?? TagAenderung()
        a.entfernt.removeAll { $0 == id }
        aenderungen[iso] = a
    }

    func aendern(_ iso: String, _ id: String, _ werte: NebenEreignisWerte) {
        var a = aenderungen[iso] ?? TagAenderung()
        if let i = a.eigene.firstIndex(where: { $0.id == id }) {
            if let v = werte.von { a.eigene[i].von = v }
            if let v = werte.bis { a.eigene[i].bis = v }
            if let v = werte.zeit { a.eigene[i].zeit = v }
            if let v = werte.wirkung { a.eigene[i].wirkung = v }
        } else {
            var g = a.geaendert[id] ?? NebenEreignisWerte()
            if let v = werte.von { g.von = v }
            if let v = werte.bis { g.bis = v }
            if let v = werte.zeit { g.zeit = v }
            if let v = werte.wirkung { g.wirkung = v }
            a.geaendert[id] = g
        }
        aenderungen[iso] = a
    }

    func hinzufuegen(_ iso: String, _ e: NebenEreignis) {
        var a = aenderungen[iso] ?? TagAenderung()
        a.eigene.append(e)
        aenderungen[iso] = a
    }
}

// MARK: - Helfer

enum NebenRisiko {
    static func isoDatum(_ iso: String) -> Date? {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = .current
        f.dateFormat = "yyyy-MM-dd"
        return f.date(from: String(iso.prefix(10)))
    }

    /// toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'short' }): "Mi., 4. Nov."
    static func datumText(_ iso: String) -> String {
        guard let d = isoDatum(iso) else { return iso }
        let f = DateFormatter()
        f.locale = Locale(identifier: "de_DE")
        f.dateFormat = "EEE, d. MMM"
        return f.string(from: d)
    }

    /// Erste Gruppe jedes Treffers.
    static func treffer(_ muster: String, in text: String, optionen: NSRegularExpression.Options = []) -> [String] {
        guard let re = try? NSRegularExpression(pattern: muster, options: optionen) else { return [] }
        let ns = text as NSString
        return re.matches(in: text, range: NSRange(location: 0, length: ns.length)).compactMap { m in
            guard m.numberOfRanges > 1, m.range(at: 1).location != NSNotFound else { return nil }
            return ns.substring(with: m.range(at: 1))
        }
    }

    /// risikoGrund: spuerbares Ereignis vor der haeufigsten Ursache.
    static func grund(_ f: NebenRisikoFahrt) -> String {
        if let e = f.ereignis, e.min >= 5 || (f.ursachen ?? []).isEmpty {
            return e.name.replacingOccurrences(of: ", Allianz Arena", with: "") + (e.route == "FTO" ? ", über FTO" : "")
        }
        return f.ursachen?.first?.name ?? "kaum Schwankung"
    }

    /// fahrerPasst: Puffer gilt nur fuer den Plan der Engine. Vergleich ueber den Nachnamen.
    static func fahrerPasst(_ f: NebenRisikoFahrt?, _ eintraege: [String]) -> Bool {
        func nachname(_ name: String?) -> String {
            let ohne = (name ?? "").replacingOccurrences(of: #"\(.*\)"#, with: "", options: .regularExpression)
            return ohne.trimmingCharacters(in: .whitespaces).split(whereSeparator: { $0.isWhitespace }).last.map { $0.lowercased() } ?? ""
        }
        let soll = nachname(f?.fahrer)
        return !soll.isEmpty && eintraege.contains { nachname($0) == soll }
    }

    /// ereignisAusText: Freitext grob deuten, Uhrzeiten "14 bis 18", "14-18 Uhr", "14:30–18:00".
    static func ereignisAusText(_ eingabe: String) -> NebenEreignis? {
        let t = eingabe.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !t.isEmpty else { return nil }
        let ns = t as NSString
        var von = "", bis = ""
        if let re = try? NSRegularExpression(pattern: #"(\d{1,2})(?::(\d{2}))?\s*(?:Uhr)?\s*(?:bis|-|–)\s*(\d{1,2})(?::(\d{2}))?"#, options: .caseInsensitive),
           let m = re.firstMatch(in: t, range: NSRange(location: 0, length: ns.length)) {
            func gruppe(_ i: Int) -> String? { m.range(at: i).location == NSNotFound ? nil : ns.substring(with: m.range(at: i)) }
            func zeit(_ h: String?, _ mm: String?) -> String { String(format: "%02d", Int(h ?? "0") ?? 0) + ":" + (mm ?? "00") }
            von = zeit(gruppe(1), gruppe(2))
            bis = zeit(gruppe(3), gruppe(4))
        }
        func hat(_ muster: String) -> Bool { t.range(of: muster, options: [.regularExpression, .caseInsensitive]) != nil }
        let art = hat("sperr") ? "Sperrung" : hat("demo|kundgebung") ? "Demonstration"
            : hat("baustelle") ? "Baustelle" : hat("stau|unfall") ? "Verkehr" : "Ereignis"
        let ort = treffer(#"([A-ZÄÖÜ][\wäöüß-]*(?:straße|strasse|str\.|platz|ring|allee|weg|brücke|tunnel))"#, in: t).first
            ?? treffer(#"\b(A\s?\d{1,3})\b"#, in: t).first ?? ""
        let uhr = DateFormatter()
        uhr.locale = Locale(identifier: "de_DE")
        uhr.dateFormat = "HH:mm"
        return NebenEreignis(
            id: "eigen-\(Int(Date().timeIntervalSince1970 * 1000))",
            art: "eigen",
            titel: [art, ort].filter { !$0.isEmpty }.joined(separator: " "),
            kurz: art,
            von: von,
            bis: bis,
            zeit: von.isEmpty ? "ganztägig" : "\(von)–\(bis)",
            wirkung: ort.isEmpty ? "Wirkung bei der nächsten Planung prüfen" : "\(ort) meiden",
            quelle: "Disposition, \(uhr.string(from: Date()))",
            fahrten: nil,
            kachel: NebenKachel(name: art, gross: von.isEmpty ? "ganztags" : "\(von.prefix(2))–\(bis.prefix(2))",
                                klein: ort.isEmpty ? "von dir" : ort),
            text: t
        )
    }
}

// MARK: - Farben (risikoFarben.js)

enum NebenRisikoFarbe {
    static let lime = Color(hex: 0xE3F654)
    static let gruen = Color(hex: 0x59BE80)
    static let rot = Color(hex: 0xFF6F63)
    static let dunkel = Color(hex: 0x1C1C1D)

    /// KLASSE_FARBE
    static func klasse(_ k: String) -> Color {
        switch k {
        case "hoch": return rot
        case "mittel": return lime
        default: return gruen
        }
    }

    /// luftFarbe: Luft am schlechten Tag (1 von 10), bis 2 min knapp, ab 10 min sicher.
    static func luft(_ v: Double?) -> Color {
        guard let v else { return Color(hex: 0x3A3A3A) }
        return v <= 2 ? rot : v < 10 ? lime : gruen
    }

    /// zahl: gerundet mit deutscher Tausendertrennung, sonst "–".
    static func zahl(_ n: Double?) -> String {
        guard let n, n.isFinite else { return "–" }
        let f = NumberFormatter()
        f.locale = Locale(identifier: "de_DE")
        f.numberStyle = .decimal
        f.maximumFractionDigits = 0
        // Math.round rundet .5 nach oben (auch bei negativen Werten).
        return f.string(from: NSNumber(value: (n + 0.5).rounded(.down))) ?? "–"
    }

    static func minuten(_ hhmm: String?) -> Int? {
        let teile = (hhmm ?? "").split(separator: ":", omittingEmptySubsequences: false)
        guard let h = teile.first.flatMap({ Int($0.trimmingCharacters(in: .whitespaces)) }) else { return nil }
        let m = teile.count > 1 ? Int(teile[1].trimmingCharacters(in: .whitespaces)) ?? 0 : 0
        return h * 60 + m
    }

    /// fensterAus: "18:00–20:15 · 22:15–23:45" als Minutenpaare.
    static func fenster(_ zeit: String) -> [(Int, Int)] {
        zeit.components(separatedBy: "·").compactMap { teil in
            let p = teil.trimmingCharacters(in: .whitespaces).components(separatedBy: CharacterSet(charactersIn: "–-")).map(minuten)
            guard p.count >= 2, let a = p[0], let b = p[1] else { return nil }
            return (a, b)
        }
    }
}
