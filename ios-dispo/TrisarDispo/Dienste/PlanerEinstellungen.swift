import Foundation

/// Planungsregeln fuer den Planer (DEFAULT_PLANNER_SETTINGS in KiPlanerSettingsView.jsx).
/// Die Werte gehen unveraendert an den CP-SAT-Solver. Grenzen nach Arbeitszeitgesetz:
/// Regelarbeitszeit 8 h, bis 10 h zulaessig (§ 3 ArbZG), Ruhezeit mind. 11 h (§ 5 ArbZG).
/// Gespeichert wie im Web (AlleFahrer.jsx): JSON unter `trisar_planner_settings_v1`,
/// hier in UserDefaults. Eine Datenbank nutzt das Web dafuer nicht.
struct PlanerEinstellungen: Codable, Equatable {
    var mode = "balanced"
    var maxWorkHours: Double = 8
    var minWorkHours: Double = 3
    var bufferMinutes: Double = 20
    /// Nur Rueckfall, falls eine Fahrt keine echte Fahrzeit hat.
    var rideDurationMinutes: Double = 80
    /// Alle Fahrer des Bestands.
    var driverPool: Double = 101
    /// Mindestpause zwischen den beiden Bloecken eines geteilten Dienstes.
    var minPauseHours: Double = 3
    /// Ruhezeit zwischen zwei Einsatztagen (§ 5 ArbZG).
    var restHours: Double = 11
    /// Abbruch nach Loesungsguete (max. Abstand zum Optimum in %), 0 = bis beweisbar optimal.
    var qualityGapPercent: Double = 5

    static let standard = PlanerEinstellungen()
    static let speicherSchluessel = "trisar_planner_settings_v1"

    init() {}

    /// Wie `{ ...DEFAULT_PLANNER_SETTINGS, ...gespeichert }`: fehlende Felder bleiben Standard.
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let s = PlanerEinstellungen()
        func zahl(_ k: CodingKeys, _ standard: Double) -> Double {
            if let d = try? c.decodeIfPresent(Double.self, forKey: k) { return d }
            if let t = try? c.decodeIfPresent(String.self, forKey: k), let d = Double(t) { return d }
            return standard
        }
        mode = (try? c.decodeIfPresent(String.self, forKey: .mode)) ?? s.mode
        maxWorkHours = zahl(.maxWorkHours, s.maxWorkHours)
        minWorkHours = zahl(.minWorkHours, s.minWorkHours)
        bufferMinutes = zahl(.bufferMinutes, s.bufferMinutes)
        rideDurationMinutes = zahl(.rideDurationMinutes, s.rideDurationMinutes)
        driverPool = zahl(.driverPool, s.driverPool)
        minPauseHours = zahl(.minPauseHours, s.minPauseHours)
        restHours = zahl(.restHours, s.restHours)
        qualityGapPercent = zahl(.qualityGapPercent, s.qualityGapPercent)
    }

    static func laden() -> PlanerEinstellungen {
        guard let roh = UserDefaults.standard.string(forKey: speicherSchluessel)?.data(using: .utf8),
              let wert = try? JSONDecoder().decode(PlanerEinstellungen.self, from: roh) else { return .standard }
        return wert
    }

    func speichern() {
        guard let daten = try? JSONEncoder().encode(self), let text = String(data: daten, encoding: .utf8) else { return }
        UserDefaults.standard.set(text, forKey: Self.speicherSchluessel)
    }
}
