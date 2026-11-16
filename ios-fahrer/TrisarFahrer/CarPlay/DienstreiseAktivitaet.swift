import ActivityKit
import Foundation

/// Daten der Live-Aktivitaet "Dienstreise" (Sperrbildschirm, Dynamic Island). Gehoert zur App und zur
/// Widget-Erweiterung. Inhalt baut LiveDienstreise.swift aus Reise-Lage und Live-Stand je Abschnitt.
struct DienstreiseAktivitaet: ActivityAttributes {
    struct ContentState: Codable, Hashable {
        var marke: String       // "AB" oder "AN"
        var zeit: String        // HH:mm
        var spaet: Int?         // Verspaetung in Minuten, nil oder 0 = puenktlich
        var oben: String        // "Dienstreise", "Dienstreise · 2/4", "Umstieg 31 min"
        var zeile1: String      // "ICE 612 → Mannheim Hbf"
        var zeile2: String      // "Gleis 3 · dann ICE 71"
        var art: String         // bus, ubahn, tram, zug, sbahn, flug
        var nummer: String      // "ICE 612"
        var gleis: String       // "Gleis 3" (fuer die Dynamic Island), leer wenn unbekannt
        /// Gleisaenderung (15.11.): Zeile 2 = zeile2 (grau) + hinweis (Orange) + rest (grau),
        /// z. B. "Gleis 3 → " + "Gleis 9 statt 7". Optional, damit aeltere Staende lesbar bleiben.
        var hinweis: String?
        var rest: String?
    }

    var reiseID: String
}

extension DienstreiseAktivitaet {
    /// SF-Symbol je Art fuer die Dynamic Island.
    static func symbol(_ art: String) -> String {
        switch art {
        case "bus": return "bus"
        case "ubahn", "tram": return "tram.fill"
        case "flug": return "airplane"
        default: return "train.side.front.car"
        }
    }
}
