import Foundation
import Supabase

// Logik der Einsatzplanung, 1:1 aus admin/src/components/views/KiPlanerDemoView.jsx (Live-Zweig),
// services/kiDriverPlanner.js (CP-SAT-Anfrage + Heuristik als Rueckfall), einsatzWallet.js und
// applyAiPlannerSuggestions aus AlleFahrer.jsx. Zeilen bleiben [String: AnyJSON], weil das Web
// die Fahrten, Fahrer und Fahrzeuge unveraendert an den Planer-Server schickt.

typealias PlanerZeile = [String: AnyJSON]

// MARK: - Uhrzeit und Datum

enum EinsatzUhr {
    /// normalizeClock: erste "h:mm" im Text, Stunde zweistellig.
    static func normal(_ wert: String?) -> String {
        guard let m = (wert ?? "").firstMatch(of: /(\d{1,2}):(\d{2})/), let h = Int(m.1) else { return "" }
        return String(format: "%02d:", h) + String(m.2)
    }

    static func minuten(_ wert: String?) -> Int? {
        let n = normal(wert)
        guard !n.isEmpty else { return nil }
        let t = n.split(separator: ":").compactMap { Int($0) }
        return t.count == 2 ? t[0] * 60 + t[1] : nil
    }

    /// pad2(floor(min/60) % 24):pad2(min % 60)
    static func uhr(_ minute: Int) -> String {
        let m = max(0, minute)
        return String(format: "%02d:%02d", (m / 60) % 24, m % 60)
    }

    static func heute() -> String { Datum.tagWert(Date()) }

    /// Mittag des Tages, wie `new Date(`${iso}T12:00:00`)`.
    static func mittag(_ iso: String) -> Date {
        Calendar.current.date(bySettingHour: 12, minute: 0, second: 0, of: Datum.ausTagWert(iso)) ?? Datum.ausTagWert(iso)
    }

    static func plusTage(_ iso: String, _ tage: Int) -> String {
        Datum.tagWert(Calendar.current.date(byAdding: .day, value: tage, to: mittag(iso)) ?? mittag(iso))
    }

    /// Tage von `heute` bis `iso` (gerundet wie im Web).
    static func tagNr(_ iso: String, heute: String = heute()) -> Int {
        Int((mittag(iso).timeIntervalSince(mittag(heute)) / 86_400).rounded())
    }

    /// Intl.DateTimeFormat('de-DE', ...) nachgebaut.
    static func format(_ iso: String, _ muster: String) -> String {
        let f = DateFormatter()
        f.locale = Locale(identifier: "de_DE")
        f.dateFormat = muster
        return f.string(from: mittag(iso))
    }

    /// { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' } -> "Mi., 04.11.2026"
    static func tagLang(_ iso: String) -> String { format(iso, "EEE, dd.MM.yyyy") }
    /// { weekday: 'short', day: 'numeric', month: 'short' } -> "Mi., 4. Nov."
    static func tagKurz(_ iso: String) -> String { format(iso, "EEE, d. MMM") }
}

/// Zahl mit deutscher Schreibweise wie Intl.NumberFormat('de-DE').
func einsatzZahl(_ wert: Double, _ stellen: Int = 0) -> String {
    let f = NumberFormatter()
    f.locale = Locale(identifier: "de_DE")
    f.numberStyle = .decimal
    f.minimumFractionDigits = stellen
    f.maximumFractionDigits = stellen
    return f.string(from: NSNumber(value: wert)) ?? String(wert)
}

extension AnyJSON {
    /// Number(x) wie im Web (Zahl, Zahl als Text, sonst nil).
    var planZahl: Double? {
        switch self {
        case let .integer(i): return Double(i)
        case let .double(d): return d
        case let .string(s): return Double(s.trimmingCharacters(in: .whitespaces))
        case let .bool(b): return b ? 1 : 0
        default: return nil
        }
    }

    /// String(x || '').trim()
    var planText: String {
        switch self {
        case let .string(s): return s.trimmingCharacters(in: .whitespacesAndNewlines)
        case let .integer(i): return String(i)
        case let .double(d): return d == d.rounded() ? String(Int(d)) : String(d)
        case let .bool(b): return b ? "true" : ""
        default: return ""
        }
    }
}

// MARK: - Planungsregeln und Optionen

/// Planungsregeln wie DEFAULT_PLANNER_SETTINGS (KiPlanerSettingsView.jsx). Gespeichert wie im Web
/// unter `trisar_planner_settings_v1`, als JSON-Text in UserDefaults; unbekannte Felder kommen
/// aus den Voreinstellungen dazu.
enum PlanerRegeln {
    static let schluessel = "trisar_planner_settings_v1"
    static let standard: PlanerZeile = [
        "mode": "balanced", "maxWorkHours": 8, "minWorkHours": 3, "bufferMinutes": 20,
        "rideDurationMinutes": 80, "driverPool": 101, "minPauseHours": 3, "restHours": 11,
        "qualityGapPercent": 5,
    ]

    static func lesen() -> PlanerZeile {
        var werte = standard
        if let text = UserDefaults.standard.string(forKey: schluessel), let daten = text.data(using: .utf8),
           let gespeichert = try? JSONDecoder().decode(PlanerZeile.self, from: daten) {
            werte.merge(gespeichert) { _, neu in neu }
        }
        return werte
    }

    static func schreiben(_ werte: PlanerZeile) {
        guard let daten = try? JSONEncoder().encode(werte), let text = String(data: daten, encoding: .utf8) else { return }
        UserDefaults.standard.set(text, forKey: schluessel)
    }
}

/// STRATEGIES: Optionen der TRISAR-Engine. Sie setzen das Ziel des Solvers (mode) und Regeln.
struct EinsatzStrategie: Equatable {
    let key: String
    let titel: String
    let regeln: PlanerZeile

    static let alle: [EinsatzStrategie] = [
        EinsatzStrategie(key: "standard", titel: "Standard",
                         regeln: ["mode": "standard", "maxWorkHours": 10, "minWorkHours": 3, "minPauseHours": 3, "bufferMinutes": 0]),
        EinsatzStrategie(key: "sicher", titel: "Sicher",
                         regeln: ["mode": "sicher", "maxWorkHours": 10, "minWorkHours": 3, "minPauseHours": 3, "bufferMinutes": 0]),
    ]

    static func finden(_ key: String) -> EinsatzStrategie { alle.first { $0.key == key } ?? alle[0] }
}

// MARK: - Datenmodell der Vorschlaege

struct EinsatzFahrt: Codable, Hashable {
    var etd: String
    var pickup: String
    var dropoff: String
    var adresseAb: String
    var adresseZiel: String
    var ankunft: String
    var passengers: Double
    var km: Double
    var durationMinutes: Double?
    var id: String
    var sammel: Bool
    var route: String?
    var reserveMin: Double?
}

/// Ein Dienst-Vorschlag wie in mapPlannerSuggestions.
struct EinsatzVorschlag: Codable, Hashable, Identifiable {
    var rides: [EinsatzFahrt]
    var chargeStops: [AnyJSON]
    var standby: Bool = false
    var id: String
    var dayIso: String
    var driverId: String
    var name: String
    var start: String
    var end: String
    var hours: String
    var stops: [String]
    var startMinutes: Int
    var endMinutes: Int
    var vehicleLabel: String
    var vehicleIsEv: Bool
    var vehicleId: String
    var shiftKm: Int?
    var chargeStopCount: Int
    var rideIds: [String]
    var minRangeReserveKm: Int?
}

/// Ergebnis eines Planungstags (plannedByDay[iso]).
struct EinsatzTagErgebnis: Codable, Equatable {
    var strategyKey: String
    var suggestions: [EinsatzVorschlag]
    var source: String
    var gap: Double?
    var solverStatus: String
    var unassignedCount: Int
    var rideCount: Int
    var tunnel: AnyJSON?
    var fleetKpis: AnyJSON?
    var engine: AnyJSON?
    var neueFahrten: [String] = []
}

/// Vergebene Schicht, wie die Zeilen an onApplySuggestions.
struct EinsatzDienstZeile: Codable, Equatable {
    var driverId: String
    var serviceStart: String
    var serviceEnd: String
    var rideIds: [String]
    var vehicleId: String
}

/// Zeitraum aus dem Kalender.
struct EinsatzZeitraum: Codable, Equatable {
    var von: String
    var bis: String
    var startZeit: String
    var endZeit: String
}

/// Fertig geplanter Einsatz (einsatzCache).
struct EinsatzFertig: Codable, Equatable {
    var tage: [String]
    var auswahl: EinsatzZeitraum?
}

// MARK: - Speicher ueber das Schliessen hinaus (sessionStorage trisar_planer_cache_v1)

/// Die Web-Caches leben im Modul und zusaetzlich im sessionStorage, damit ein teurer Solver-Lauf
/// das Schliessen und Neuladen uebersteht. Hier: im Speicher der App plus UserDefaults, mit dem
/// heutigen Datum als Schluessel wie im Web.
@MainActor
final class EinsatzSpeicher {
    static let geteilt = EinsatzSpeicher()
    private static let schluessel = "trisar_planer_cache_v1"

    var geplant: [String: EinsatzTagErgebnis] = [:]
    var angenommen: [String: [EinsatzDienstZeile]] = [:]
    var abgelehnt: Set<String> = []
    var uebernommen: Set<String> = []
    var einsatz: EinsatzFertig?

    private struct Ablage: Codable {
        var today: String
        var planned: [String: EinsatzTagErgebnis]
        var accepted: [String: [EinsatzDienstZeile]]
        var dismissed: [String]
        var acceptedIds: [String]
        var einsatz: EinsatzFertig?
    }

    private init() {
        guard let daten = UserDefaults.standard.data(forKey: Self.schluessel),
              let a = try? JSONDecoder().decode(Ablage.self, from: daten), a.today == EinsatzUhr.heute() else { return }
        geplant = a.planned
        angenommen = a.accepted
        abgelehnt = Set(a.dismissed)
        uebernommen = Set(a.acceptedIds)
        einsatz = a.einsatz
    }

    func sichern() {
        let a = Ablage(today: EinsatzUhr.heute(), planned: geplant, accepted: angenommen,
                       dismissed: Array(abgelehnt), acceptedIds: Array(uebernommen), einsatz: einsatz)
        if let daten = try? JSONEncoder().encode(a) { UserDefaults.standard.set(daten, forKey: Self.schluessel) }
    }
}

// MARK: - Planer (services/kiDriverPlanner.js, Live: CP-SAT-Server, sonst Heuristik)

@MainActor
enum EinsatzPlanerDienst {
    /// Im Web relativ `/planner` auf admin.trisar.de (Vite-Proxy auf den Planner-Container, Port 8790).
    static let endpunkt = URL(string: "https://admin.trisar.de/planner/solve")!
    /// Start- und Endort der Fahrer fuer die Leerfahrten (Ort aus der TomTom-Tabelle).
    static let zentrale = "München Hauptbahnhof, Bayerstraße 10a"
    static let standardFahrtDauer = 80
    static let bedarfStartStunde = 6

    /// demo/data/distances.json (km, minuten je Ortspaar) und traffic_factors.json, mitgeliefert.
    private static let distanzen: PlanerZeile = {
        guard let url = Bundle.main.url(forResource: "planer_distanzen", withExtension: "json"),
              let daten = try? Data(contentsOf: url),
              let wert = try? JSONDecoder().decode(PlanerZeile.self, from: daten) else { return [:] }
        return wert
    }()

    private static let stundenFaktor: [String: Double] = {
        guard let url = Bundle.main.url(forResource: "planer_verkehr", withExtension: "json"),
              let daten = try? Data(contentsOf: url),
              let wert = try? JSONDecoder().decode([String: [String: Double]].self, from: daten) else { return [:] }
        return wert["stundenFaktor"] ?? [:]
    }()

    /// Ortskoordinaten aus der Tabelle (fuer die Tageskarte als erste Quelle).
    static var bekannteOrte: [String: (Double, Double)] {
        var orte: [String: (Double, Double)] = [:]
        for (name, wert) in distanzen["coords"]?.objectValue ?? [:] {
            if let a = wert.arrayValue, a.count == 2, let lat = a[0].planZahl, let lng = a[1].planZahl { orte[name] = (lat, lng) }
        }
        return orte
    }

    /// echteFahrzeit: gemessene Basiszeit des Ortspaars mal Verkehrsfaktor der Abfahrtsstunde.
    private static func echteFahrzeit(_ ride: PlanerZeile) -> Int? {
        let von = ride.text("pickup_name").isEmpty ? ride.text("pickup_address") : ride.text("pickup_name")
        let nach = ride.text("dropoff_name").isEmpty ? ride.text("dropoff_address") : ride.text("dropoff_name")
        guard !von.isEmpty, !nach.isEmpty else { return nil }
        let tabelle = distanzen["minuten"]?.objectValue ?? [:]
        guard let basis = (tabelle["\(von)|\(nach)"] ?? tabelle["\(nach)|\(von)"])?.planZahl else { return nil }
        let stunde = Int(ride.text("etd").prefix(2)) ?? -1
        let faktor = stundenFaktor[String(stunde)] ?? 1
        return max(5, Int((basis * faktor).rounded()))
    }

    private static func mitEchtenFahrzeiten(_ rides: [PlanerZeile]) -> [PlanerZeile] {
        rides.map { r in
            guard let m = echteFahrzeit(r) else { return r }
            var neu = r
            neu["duration_minutes"] = .integer(m)
            return neu
        }
    }

    // MARK: Heuristik

    private struct NormFahrt { let id: String; let etd: String; let etdMinutes: Int; let startMinutes: Int; let endMinutes: Int; let synthetic: Bool }

    /// normalizeClockValue aus kiDriverPlanner.js (mit Bereichspruefung).
    private static func uhrStreng(_ wert: String) -> Int? {
        let n = Dienstzeit.normal(wert.trimmingCharacters(in: .whitespaces))
        if !n.isEmpty { return Dienstzeit.minuten(n) }
        guard let m = wert.firstMatch(of: /(\d{1,2}):(\d{2})/), let h = Int(m.1), let mi = Int(m.2),
              (0...23).contains(h), (0...59).contains(mi) else { return nil }
        return h * 60 + mi
    }

    private static func uhrText(_ minuten: Int) -> String {
        let m = max(0, min(1439, minuten))
        return String(format: "%02d:%02d", m / 60, m % 60)
    }

    private static func fahrtenNormal(_ rides: [PlanerZeile], puffer: Int, dauer: Int) -> [NormFahrt] {
        rides.compactMap { r -> NormFahrt? in
            guard let etd = uhrStreng(r.text("etd")) else { return nil }
            if Planung.ausgeschlossen.contains(r.text("status").lowercased()) { return nil }
            return NormFahrt(id: r.text("id"), etd: uhrText(etd), etdMinutes: etd, startMinutes: max(0, etd - puffer),
                             endMinutes: min(1439, etd + dauer + puffer), synthetic: false)
        }
        .sorted { $0.startMinutes < $1.startMinutes }
    }

    private static func synthetisch(_ fahrten: [NormFahrt], bedarf: [Int], puffer: Int, dauer: Int,
                                    jeStunde: Int = .max, gesamt: Int = .max) -> [NormFahrt] {
        guard !bedarf.isEmpty else { return [] }
        var vorhanden = Array(repeating: 0, count: bedarf.count)
        for f in fahrten {
            let i = f.etdMinutes / 60 - bedarfStartStunde
            if i >= 0 && i < vorhanden.count { vorhanden[i] += 1 }
        }
        var aus: [NormFahrt] = []
        for (i, ziel) in bedarf.enumerated() {
            if aus.count >= gesamt { break }
            let fehlt = max(0, ziel - vorhanden[i])
            let n = min(fehlt, max(0, jeStunde))
            guard n > 0 else { continue }
            let stunde = bedarfStartStunde + i
            let etd = stunde * 60
            for k in 0..<n {
                if aus.count >= gesamt { break }
                aus.append(NormFahrt(id: "synthetic-\(stunde)-\(k + 1)", etd: String(format: "%02d:00", stunde), etdMinutes: etd,
                                     startMinutes: max(0, etd - puffer), endMinutes: min(1439, etd + dauer + puffer), synthetic: true))
            }
        }
        return aus
    }

    /// expandWindowToMinDuration
    private static func aufMindestdauer(_ s: Int, _ e: Int, _ minDauer: Int, _ maxDauer: Int) -> (Int, Int) {
        let minD = max(0, minDauer), maxD = max(minD, maxDauer)
        var start = s, ende = e
        var dauer = max(0, ende - start)
        if dauer > maxD { ende = start + maxD; dauer = maxD }
        if dauer >= minD { return (start, ende) }
        var fehlt = minD - dauer
        let vor = fehlt / 2
        start = max(0, start - vor)
        ende = min(1439, ende + (fehlt - vor))
        dauer = max(0, ende - start)
        if dauer < minD {
            fehlt = minD - dauer
            if start == 0 { ende = min(1439, ende + fehlt) } else if ende == 1439 { start = max(0, start - fehlt) }
        }
        dauer = max(0, ende - start)
        if dauer > maxD {
            ende = start + maxD
            if ende > 1439 { let ueber = ende - 1439; ende = 1439; start = max(0, start - ueber) }
        }
        return (start, ende)
    }

    private struct HFahrer { let id: String; let name: String; let order: Int }

    /// buildDemandBasedSuggestions
    private static func nachBedarf(_ fahrer: [HFahrer], bedarf: [Int], maxM: Int, minM: Int, pauseM: Int) -> PlanerZeile? {
        guard bedarf.reduce(0, +) > 0, !fahrer.isEmpty else { return nil }
        struct Stand { var first: Int?; var last: Int?; var block: Int?; var arbeit = 0; var slots = 0; var idx = Set<Int>() }
        var stand = Dictionary(uniqueKeysWithValues: fahrer.map { ($0.id, Stand()) })
        var offen = 0
        for (slot, noetig) in bedarf.enumerated() where noetig > 0 {
            let a = (bedarfStartStunde + slot) * 60, b = min(1439, a + 60)
            for _ in 0..<noetig {
                var bester: String?, punkte = Double.infinity
                for f in fahrer {
                    guard let s = stand[f.id], !s.idx.contains(slot) else { continue }
                    let luecke = s.last.map { a - $0 }
                    if let l = luecke, l < 0 { continue }
                    let verlaengert = luecke.map { $0 < pauseM } ?? false
                    let blockStart = verlaengert ? (s.block ?? s.first ?? a) : a
                    if b - blockStart > maxM { continue }
                    let p = Double(s.arbeit * 10) + Double(luecke ?? 0) * 0.2 + Double(f.order)
                    if p < punkte { punkte = p; bester = f.id }
                }
                guard let id = bester, var s = stand[id] else { offen += 1; continue }
                let luecke = s.last.map { a - $0 }
                let verlaengert = luecke.map { $0 < pauseM } ?? false
                s.idx.insert(slot); s.slots += 1; s.arbeit += b - a
                if s.first == nil || a < s.first! { s.first = a }
                if s.last == nil || b > s.last! { s.last = b }
                if s.block == nil || !verlaengert { s.block = a }
                stand[id] = s
            }
        }
        let vorschlaege: [AnyJSON] = fahrer.compactMap { f in
            guard let s = stand[f.id], let a = s.first, let b = s.last else { return nil }
            let (x, y) = aufMindestdauer(a, b, minM, maxM)
            return .object(["driver_id": .string(f.id), "driver_name": .string(f.name), "service_start": .string(uhrText(x)),
                            "service_end": .string(uhrText(y)), "assigned_ride_ids": .array([]), "assigned_rides_count": .integer(s.slots)])
        }
        return ["source": "heuristic", "suggestions": .array(vorschlaege), "unassigned_ride_ids": .array([]),
                "warnings": .array(offen > 0 ? [.string("\(offen) Bedarfsslot(s) konnten nicht abgedeckt werden.")] : [])]
    }

    /// buildHeuristicSuggestions
    private static func heuristik(drivers: [PlanerZeile], rides: [PlanerZeile], bedarf: [Int], maxM: Int, minM: Int,
                                  pauseM: Int, puffer: Int, dauer: Int) -> PlanerZeile {
        let fahrer = drivers.enumerated().map { i, d in
            HFahrer(id: d.text("id"), name: d.text("name").isEmpty ? "Fahrer #\(i + 1)" : d.text("name"), order: i)
        }.filter { !$0.id.isEmpty }
        let normal = fahrtenNormal(rides, puffer: puffer, dauer: dauer)
        let alle = (normal + synthetisch(normal, bedarf: bedarf, puffer: puffer, dauer: dauer)).sorted { $0.startMinutes < $1.startMinutes }
        if alle.isEmpty, let b = nachBedarf(fahrer, bedarf: bedarf, maxM: maxM, minM: minM, pauseM: pauseM) { return b }

        struct Stand { var rides: [NormFahrt] = []; var first: Int?; var last: Int?; var block: Int? }
        var stand = Dictionary(uniqueKeysWithValues: fahrer.map { ($0.id, Stand()) })
        var offen: [String] = []
        for r in alle {
            var bester: String?, punkte = Double.infinity
            for f in fahrer {
                guard let s = stand[f.id] else { continue }
                if s.rides.isEmpty {
                    let p = Double(5000 + f.order * 20)
                    if p < punkte { punkte = p; bester = f.id }
                    continue
                }
                let ns = min(s.first ?? r.startMinutes, r.startMinutes)
                let ne = max(s.last ?? r.endMinutes, r.endMinutes)
                if ne - ns > maxM { continue }
                let luecke = r.startMinutes - (s.last ?? r.startMinutes)
                if luecke < 0 { continue }
                let lang = luecke >= pauseM ? luecke - pauseM : 0
                let bisher = max(0, (s.last ?? r.endMinutes) - (s.first ?? r.startMinutes))
                let p = Double(max(0, (ne - ns) - bisher) * 10) + Double(lang) * 1.2 + Double(f.order) * 0.5
                if p < punkte { punkte = p; bester = f.id }
            }
            guard let id = bester, var s = stand[id] else {
                if !r.id.isEmpty && !r.synthetic { offen.append(r.id) }
                continue
            }
            let luecke = s.last.map { r.startMinutes - $0 }
            let verlaengert = luecke.map { $0 < pauseM } ?? false
            s.rides.append(r)
            if s.first == nil || r.startMinutes < s.first! { s.first = r.startMinutes }
            if s.last == nil || r.endMinutes > s.last! { s.last = r.endMinutes }
            if s.block == nil || !verlaengert { s.block = r.startMinutes }
            stand[id] = s
        }
        let vorschlaege: [AnyJSON] = fahrer.compactMap { f in
            guard let s = stand[f.id], let a = s.first, let b = s.last else { return nil }
            let (x, y) = aufMindestdauer(a, b, minM, maxM)
            let echte = s.rides.map(\.id).filter { !$0.isEmpty && !$0.hasPrefix("synthetic-") }
            return .object(["driver_id": .string(f.id), "driver_name": .string(f.name), "service_start": .string(uhrText(x)),
                            "service_end": .string(uhrText(y)), "assigned_ride_ids": .array(echte.map { .string($0) }),
                            "assigned_rides_count": .integer(s.rides.count)])
        }
        let einzeln = Array(Set(offen))
        return ["source": "heuristic", "suggestions": .array(vorschlaege), "unassigned_ride_ids": .array(einzeln.map { .string($0) }),
                "warnings": .array(einzeln.isEmpty ? [] : [.string("\(offen.count) Fahrt(en) konnten nicht konfliktfrei zugewiesen werden.")])]
    }

    // MARK: Anfrage

    private static func regel(_ s: PlanerZeile, _ k: String, _ standard: Double) -> Double {
        guard let w = s[k], !w.isNil else { return standard }
        return w.planZahl ?? 0
    }

    /// planDriverShiftsWithOllama mit KI_PROVIDER 'cp_sat': erst der Planer-Server, bei Fehler die Heuristik.
    static func planen(drivers: [PlanerZeile], rides: [PlanerZeile], vehicles: [PlanerZeile], serviceDate: String,
                       settings: PlanerZeile, demandProfile: [Int], fortschritt: (String) -> Void) async -> PlanerZeile {
        let bedarf = demandProfile.map { max(0, $0) }
        fortschritt("Input: Fahrer=\(drivers.count), Fahrten=\(rides.count), BedarfSumme=\(bedarf.reduce(0, +)).")
        let maxH = max(1, regel(settings, "maxWorkHours", 10) == 0 ? 10 : regel(settings, "maxWorkHours", 10))
        var minH = max(0, regel(settings, "minWorkHours", 4))
        let pauseH = max(0, regel(settings, "minPauseHours", 3))
        let puffer = max(0, Int(regel(settings, "bufferMinutes", 20)))
        let dauerRoh = Int(regel(settings, "rideDurationMinutes", Double(standardFahrtDauer)))
        let dauer = max(20, dauerRoh == 0 ? standardFahrtDauer : dauerRoh)
        let modus = settings["mode"]?.planText.isEmpty == false ? settings["mode"]!.planText : "balanced"
        let guete = max(0, regel(settings, "qualityGapPercent", 0))
        minH = min(maxH, minH)
        let normiert: PlanerZeile = [
            "maxWorkHours": .double(maxH), "minWorkHours": .double(minH), "minPauseHours": .double(pauseH),
            "bufferMinutes": .integer(puffer), "rideDurationMinutes": .integer(dauer), "mode": .string(modus),
            "qualityGapPercent": .double(guete),
        ]
        let rueckfall = heuristik(drivers: drivers, rides: rides, bedarf: bedarf, maxM: Int(maxH * 60), minM: Int(minH * 60),
                                  pauseM: Int(pauseH * 60), puffer: puffer, dauer: dauer)

        do {
            // Ohne echte Fahrten: Bedarfsfahrten (hoechstens 3 je Stunde, 54 insgesamt).
            let synth = synthetisch(fahrtenNormal(rides, puffer: puffer, dauer: dauer), bedarf: bedarf, puffer: puffer,
                                    dauer: dauer, jeStunde: 3, gesamt: 54)
                .map { f -> PlanerZeile in ["id": .string(f.id), "ride_date": .string(serviceDate), "etd": .string(f.etd), "status": "open"] }
            let fuerSolver = rides.isEmpty ? synth : rides
            if rides.isEmpty && !synth.isEmpty {
                fortschritt("Keine echten Fahrten. Erzeuge \(synth.count) Demand-Fahrten (CP-SAT-Cap aktiv).")
            }
            fortschritt("Solver-Modus: CP-SAT aktiv.")
            fortschritt("Starte CP-SAT Optimierer ...")
            let koerper: PlanerZeile = [
                "drivers": .array(drivers.map { .object($0) }),
                "rides": .array(mitEchtenFahrzeiten(fuerSolver).map { .object($0) }),
                "vehicles": .array(vehicles.map { .object($0) }),
                "distances": distanzen["km"] ?? .object([:]),
                "travelMinutes": distanzen["minuten"] ?? .object([:]),
                "depot": .string(zentrale),
                "serviceDate": .string(serviceDate),
                "settings": .object(normiert),
                "demandProfile": .array(bedarf.map { .integer($0) }),
            ]
            var anfrage = URLRequest(url: endpunkt)
            anfrage.httpMethod = "POST"
            anfrage.setValue("application/json", forHTTPHeaderField: "Content-Type")
            // Gerechnet wird bis zur Guetevorgabe, nicht auf Zeit: grosszuegig warten.
            anfrage.timeoutInterval = 900
            anfrage.httpBody = try JSONEncoder().encode(koerper)
            fortschritt("Endpoint: \(endpunkt.absoluteString)")
            fortschritt("Sende Anfrage an CP-SAT Planner ...")
            let (daten, antwort) = try await URLSession.shared.data(for: anfrage)
            let status = (antwort as? HTTPURLResponse)?.statusCode ?? 0
            let art = ((antwort as? HTTPURLResponse)?.value(forHTTPHeaderField: "Content-Type") ?? "").lowercased()
            let inhalt = try? JSONDecoder().decode(AnyJSON.self, from: daten)
            guard (200..<300).contains(status) else {
                throw PlanerFehler(text: inhalt?.objectValue?["error"]?.planText.planOderNil ?? "CP-SAT Planner API Fehler (\(status))")
            }
            guard let roh = inhalt?.objectValue else {
                let text = String(data: daten, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
                if art.contains("text/html") || text.lowercased().hasPrefix("<!doctype html>") || text.lowercased().hasPrefix("<html") {
                    throw PlanerFehler(text: "Planner Endpoint liefert HTML statt JSON (Proxy/URL prüfen).")
                }
                throw PlanerFehler(text: "Planner Endpoint liefert kein JSON.")
            }
            let vorschlaege = roh["suggestions"]?.arrayValue ?? []
            let plaene = roh["vehicle_plans"]?.arrayValue ?? []
            let quelle = roh["source"]?.planText.planOderNil ?? "cp_sat"
            fortschritt("Solver-Quelle bestätigt: \(quelle).")
            fortschritt("CP-SAT Plan erstellt (Vorschläge: \(vorschlaege.count)).")
            if !plaene.isEmpty {
                let ev = plaene.filter { $0.objectValue?["is_ev"]?.boolValue == true }.count
                fortschritt("Fahrzeugplanung: \(plaene.count) Schichten mit Fahrzeug, davon \(ev) EV.")
            }
            return [
                "source": .string(quelle), "suggestions": .array(vorschlaege),
                "warnings": roh["warnings"] ?? .array([]), "unassigned_ride_ids": roh["unassigned_ride_ids"] ?? .array([]),
                "kpis": roh["kpis"] ?? .null, "vehicle_plans": .array(plaene), "fleet_kpis": roh["fleet_kpis"] ?? .null,
                "tunnel": roh["tunnel"] ?? .null, "engine": roh["engine"] ?? .null,
            ]
        } catch {
            let meldung = (error as? PlanerFehler)?.text ?? error.localizedDescription
            fortschritt("CP-SAT fehlgeschlagen: \(meldung)")
            fortschritt("Solver-Quelle gewechselt: heuristic (Fallback, BedarfSumme=\(bedarf.reduce(0, +))).")
            var r = rueckfall
            r["source"] = "heuristic"
            return r
        }
    }

    struct PlanerFehler: Error { let text: String }

    // MARK: Ergebnis -> Karten (mapPlannerSuggestions)

    static func vorschlaege(_ ergebnis: PlanerZeile, rides: [PlanerZeile], strategie: String, tag: String) -> [EinsatzVorschlag] {
        let nachID = Dictionary(rides.map { ($0.text("id"), $0) }, uniquingKeysWith: { a, _ in a })
        var plaene: [String: PlanerZeile] = [:]
        for p in ergebnis["vehicle_plans"]?.arrayValue ?? [] {
            if let o = p.objectValue, !o.text("driver_id").isEmpty { plaene[o.text("driver_id")] = o }
        }
        let eintraege = (ergebnis["suggestions"]?.arrayValue ?? []).compactMap(\.objectValue)
            .filter { !$0.text("service_start").isEmpty && !$0.text("service_end").isEmpty }
        var bloecke: [String: Int] = [:]
        for e in eintraege where !e.text("driver_id").isEmpty { bloecke[e.text("driver_id"), default: 0] += 1 }
        let engineFahrten = ergebnis["engine"]?.objectValue?["fahrten"]?.objectValue ?? [:]

        let liste = eintraege.enumerated().map { index, e -> EinsatzVorschlag in
            let start = EinsatzUhr.normal(e.text("service_start"))
            let end = EinsatzUhr.normal(e.text("service_end"))
            let sMin = EinsatzUhr.minuten(start) ?? 0
            let eRoh = EinsatzUhr.minuten(end) ?? sMin
            let eMin = eRoh < sMin ? eRoh + 1440 : eRoh
            let stundenRoh = max(0, Double(eMin - sMin) / 60)
            let stunden = (stundenRoh * 2).rounded() / 2
            let zugeteilt: [EinsatzFahrt] = (e["assigned_ride_ids"]?.arrayValue ?? []).compactMap { nachID[$0.planText] }.map { r in
                let ef = engineFahrten[r.text("id")]?.objectValue
                let etd = EinsatzUhr.normal(r.text("etd"))
                let dauer = r.zahl("ext_route_duration_in_traffic_mins").flatMap { $0 == 0 ? nil : $0 }
                    ?? r.zahl("ext_route_duration_mins").flatMap { $0 == 0 ? nil : $0 }
                let anzeige = Int((dauer ?? (r.text("trip_type") == "airport" ? 55 : 25)).rounded())
                let etdMin = EinsatzUhr.minuten(etd)
                let meter = r.zahl("ext_route_distance_m") ?? 0
                let pax = r.zahl("passengers") ?? 0
                return EinsatzFahrt(
                    etd: etd,
                    pickup: r.text("pickup_name").isEmpty ? r.text("pickup_address") : r.text("pickup_name"),
                    dropoff: r.text("dropoff_name").isEmpty ? r.text("dropoff_address") : r.text("dropoff_name"),
                    adresseAb: r.text("pickup_address").isEmpty ? r.text("pickup_name") : r.text("pickup_address"),
                    adresseZiel: r.text("dropoff_address").isEmpty ? r.text("dropoff_name") : r.text("dropoff_address"),
                    ankunft: etdMin.map { EinsatzUhr.normal(EinsatzUhr.uhr($0 + anzeige)) } ?? "",
                    passengers: pax == 0 ? 1 : pax,
                    km: meter > 0 ? meter / 1000 : (r.text("trip_type") == "airport" ? 40 : 12),
                    durationMinutes: dauer,
                    id: r.text("id"),
                    sammel: ef?["sammel"]?.boolValue ?? false,
                    route: ef?["route"]?.planText.planOderNil,
                    reserveMin: ef?["reserve_min"]?.planZahl)
            }
            .filter { !$0.etd.isEmpty && !$0.pickup.isEmpty && !$0.dropoff.isEmpty }
            .sorted { $0.etd < $1.etd }

            var stops = zugeteilt.prefix(3).map { "\($0.etd) \($0.pickup) - \($0.dropoff)" }
            if zugeteilt.count > 3 { stops.append("+ \(zugeteilt.count - 3) weitere Fahrten") }
            let fahrerID = e.text("driver_id")
            if e.text("split_block") == "late" {
                stops.insert("Geteilter Dienst · Spätblock", at: 0)
            } else if !fahrerID.isEmpty && (bloecke[fahrerID] ?? 0) > 1 {
                stops.insert("Geteilter Dienst · Frühblock", at: 0)
            }
            let plan = plaene[e.text("split_block") == "late" ? "\(fahrerID)#B" : fahrerID]
            let ladestopps = plan?["charge_stops"]?.arrayValue ?? []
            return EinsatzVorschlag(
                rides: zugeteilt,
                chargeStops: ladestopps,
                id: "\(tag)-\(strategie)-\(fahrerID.isEmpty ? String(index) : fahrerID)-\(start)",
                dayIso: tag,
                driverId: fahrerID,
                name: e.text("driver_name").isEmpty ? "Fahrer \(index + 1)" : e.text("driver_name"),
                start: start, end: end,
                hours: stunden == stunden.rounded() ? String(Int(stunden)) : String(format: "%.1f", stunden).replacingOccurrences(of: ".", with: ","),
                stops: stops, startMinutes: sMin, endMinutes: eMin,
                vehicleLabel: plan?.text("vehicle_label") ?? "",
                vehicleIsEv: plan?["is_ev"]?.boolValue ?? (plan?.wahr("is_ev") ?? false),
                vehicleId: plan?.text("vehicle_id") ?? "",
                shiftKm: plan?.zahl("shift_km").map { Int($0.rounded()) },
                chargeStopCount: ladestopps.count,
                rideIds: (e["assigned_ride_ids"]?.arrayValue ?? []).map(\.planText),
                minRangeReserveKm: plan?.zahl("min_range_reserve_km").map { Int($0.rounded()) })
        }
        return liste.sorted { $0.startMinutes < $1.startMinutes }
    }
}

extension String {
    /// Leerer Text wird nil (fuer `a || b` aus dem Web).
    var planOderNil: String? { isEmpty ? nil : self }
}

// MARK: - Wallet (einsatzWallet.js)

struct EinsatzWallet: Equatable {
    var start = "–", ende = "–", fahrer = "0", kunden = "0", schnitt = "0", fahrten = "0", km = "0", co2 = "0kg", preis = "0€"

    static func werte(_ vorschlaege: [EinsatzVorschlag]) -> EinsatzWallet {
        guard !vorschlaege.isEmpty else { return EinsatzWallet() }
        var ids = Set<String>(), kunden = 0.0, fahrten = 0, km = 0.0, co2 = 0.0, stunden = 0.0
        var startMin: Int?, endeMin: Int?
        for v in vorschlaege {
            ids.insert(v.driverId.isEmpty ? v.id : v.driverId)
            fahrten += v.rides.count
            kunden += v.rides.reduce(0) { $0 + ($1.passengers == 0 ? 1 : $1.passengers) }
            let kmSchicht = v.shiftKm.map(Double.init) ?? v.rides.reduce(0) { $0 + $1.km } * 1.3
            km += kmSchicht
            co2 += kmSchicht * (v.vehicleIsEv ? 0.075 : 0.195)
            stunden += max(0, Double(v.endMinutes - v.startMinutes) / 60)
            startMin = min(startMin ?? v.startMinutes, v.startMinutes)
            endeMin = max(endeMin ?? v.endMinutes, v.endMinutes)
        }
        let preis = (stunden * 28 + km * 0.45) * 1.19
        func uhr(_ m: Int) -> String { String(format: "%02d:%02d", (m / 60) % 24, m % 60) }
        return EinsatzWallet(
            start: "\(uhr(startMin ?? 0)) Uhr", ende: "\(uhr(endeMin ?? 0)) Uhr",
            fahrer: einsatzZahl(Double(ids.count)), kunden: einsatzZahl(kunden),
            schnitt: einsatzZahl(ids.isEmpty ? 0 : kunden / Double(ids.count), 1),
            fahrten: einsatzZahl(Double(fahrten)), km: einsatzZahl(km.rounded()),
            co2: "\(einsatzZahl(co2.rounded()))kg", preis: "\(einsatzZahl((preis / 10).rounded() * 10))€")
    }
}

// MARK: - Schichten vergeben (applyAiPlannerSuggestions aus AlleFahrer.jsx)

enum EinsatzUebernahme {
    private static let schemaSQL = """
    -- Falls noch nicht vorhanden:
    ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'fahrer';
    ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS vehicle_id UUID REFERENCES public.vehicles(id) ON DELETE SET NULL;
    ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS driver_number BIGINT;
    ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS driver_activity_state TEXT DEFAULT 'frei';
    ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS service_start_time TIME;
    ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS service_end_time TIME;
    ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS service_start_date DATE;
    ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS service_end_date DATE;
    ALTER TABLE public.vehicles ADD COLUMN IF NOT EXISTS license_plate TEXT;
    CREATE TABLE IF NOT EXISTS public.driver_service_requests (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      driver_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
      service_date DATE NOT NULL,
      service_start_time TIME,
      service_end_time TIME,
      status TEXT NOT NULL DEFAULT 'pending',
      requested_by TEXT,
      refusal_reason TEXT,
      responded_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    """

    private static let kennung = "admin-app-ai-planner"

    /// Ersetzt die Planung des Tages: alte Planer-Anfragen weg, neue Anfragen, Profile, Fahrten.
    /// Rueckgabe: nil = ok, sonst die Fehlermeldung.
    static func anwenden(tag: String, zeilen: [EinsatzDienstZeile], leerErlaubt: Bool = false) async -> String? {
        let ziel = zeilen.map { z in
            EinsatzDienstZeile(driverId: z.driverId.trimmingCharacters(in: .whitespaces),
                               serviceStart: Dienstzeit.normal(z.serviceStart), serviceEnd: Dienstzeit.normal(z.serviceEnd),
                               rideIds: z.rideIds.map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty },
                               vehicleId: z.vehicleId.trimmingCharacters(in: .whitespaces))
        }.filter { !$0.driverId.isEmpty && !$0.serviceStart.isEmpty && !$0.serviceEnd.isEmpty }
        if ziel.isEmpty && !leerErlaubt { return "Keine gültigen Vorschläge ausgewählt." }
        guard tag.wholeMatch(of: /\d{4}-\d{2}-\d{2}/) != nil else { return "Bitte ein gültiges Datum wählen." }

        struct FahrerID: Decodable { let driver_id: String? }
        struct JobID: Decodable { let id: String? }
        let db = Backend.client
        let jetzt = AnyJSON.string(ISO8601DateFormatter().string(from: Date()))
        do {
            let fahrerIDs = Array(NSOrderedSet(array: ziel.map(\.driverId)).compactMap { $0 as? String })
            let frueher: [FahrerID] = (try? await db.from("driver_service_requests").select("driver_id")
                .eq("service_date", value: tag).eq("requested_by", value: kennung).execute().value) ?? []
            let frueherIDs = Array(Set(frueher.compactMap { $0.driver_id?.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }))

            do {
                try await db.from("driver_service_requests").delete()
                    .eq("service_date", value: tag).eq("requested_by", value: kennung).execute()
            } catch {
                do {
                    try await db.from("driver_service_requests").update(["status": AnyJSON.string("cancelled"), "updated_at": jetzt])
                        .eq("service_date", value: tag).eq("requested_by", value: kennung).execute()
                } catch {
                    return dbMeldung(error).planOderNil ?? "Vorherige KI-Planung konnte nicht überschrieben werden."
                }
            }

            if !fahrerIDs.isEmpty {
                do {
                    try await db.from("driver_service_requests").delete()
                        .eq("service_date", value: tag).in("driver_id", values: fahrerIDs).execute()
                } catch {
                    do {
                        try await db.from("driver_service_requests").update(["status": AnyJSON.string("cancelled"), "updated_at": jetzt])
                            .eq("service_date", value: tag).in("driver_id", values: fahrerIDs).execute()
                    } catch {
                        return dbMeldung(error).planOderNil ?? "Vorherige Planung konnte nicht überschrieben werden."
                    }
                }
            }

            let anfragen: [PlanerZeile] = ziel.map {
                ["driver_id": .string($0.driverId), "service_date": .string(tag), "service_start_time": .string($0.serviceStart),
                 "service_end_time": .string($0.serviceEnd), "status": "pending", "requested_by": .string(kennung)]
            }
            if !anfragen.isEmpty {
                do {
                    try await db.from("driver_service_requests").insert(anfragen).execute()
                } catch {
                    let m = dbMeldung(error)
                    if m.range(of: "service_start_time|service_end_time|service_date|driver_service_requests", options: [.regularExpression, .caseInsensitive]) != nil {
                        return "DB-Schema unvollständig. Bitte ausführen:\n\(schemaSQL)"
                    }
                    return m.planOderNil ?? "Dienstplan-Anfragen konnten nicht gespeichert werden."
                }
            }

            for z in ziel {
                do {
                    try await db.from("profiles").update([
                        "service_start_time": AnyJSON.string(z.serviceStart), "service_end_time": .string(z.serviceEnd),
                        "service_start_date": .string(tag), "service_end_date": .string(tag),
                    ]).eq("id", value: z.driverId).execute()
                } catch {
                    do {
                        try await db.from("profiles").update([
                            "service_start_time": AnyJSON.string(z.serviceStart), "service_end_time": .string(z.serviceEnd),
                        ]).eq("id", value: z.driverId).execute()
                    } catch {
                        return dbMeldung(error).planOderNil ?? "Fahrerprofil konnte nicht aktualisiert werden."
                    }
                }
            }

            let veraltet = frueherIDs.filter { !fahrerIDs.contains($0) }
            if !veraltet.isEmpty {
                do {
                    try await db.from("profiles").update([
                        "service_start_time": AnyJSON.null, "service_end_time": .null, "service_start_date": .null, "service_end_date": .null,
                    ]).in("id", values: veraltet).execute()
                } catch {
                    do {
                        try await db.from("profiles").update(["service_start_time": AnyJSON.null, "service_end_time": .null])
                            .in("id", values: veraltet).execute()
                    } catch {
                        return dbMeldung(error).planOderNil ?? "Vorherige Fahrerzeiten konnten nicht zurückgesetzt werden."
                    }
                }
            }

            // Fahrten an Fahrer und Fahrzeug vergeben; fruehere Vergaben des Planers, die nicht
            // mehr im Plan stehen, wieder oeffnen.
            let geplant = Set(ziel.flatMap(\.rideIds))
            let alt: [JobID] = (try? await db.from("jobs").select("id").eq("ride_date", value: tag)
                .eq("assigned_by", value: "trisar-engine").execute().value) ?? []
            let oeffnen = alt.compactMap(\.id).filter { !$0.isEmpty && !geplant.contains($0) }
            if !oeffnen.isEmpty {
                _ = try? await db.from("jobs").update([
                    "driver_id": AnyJSON.null, "vehicle_id": .null, "status": "pending", "assigned_by": .null,
                ]).in("id", values: oeffnen).execute()
            }
            for z in ziel where !z.rideIds.isEmpty {
                var vergabe: PlanerZeile = ["driver_id": .string(z.driverId), "status": "assigned", "assigned_by": "trisar-engine"]
                if !z.vehicleId.isEmpty { vergabe["vehicle_id"] = .string(z.vehicleId) }
                do {
                    try await db.from("jobs").update(vergabe).in("id", values: z.rideIds).execute()
                } catch {
                    return dbMeldung(error).planOderNil ?? "KI-Plan konnte nicht gespeichert werden."
                }
            }
            return nil
        }
    }
}
