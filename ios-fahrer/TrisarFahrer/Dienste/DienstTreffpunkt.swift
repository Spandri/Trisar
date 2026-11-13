import CoreLocation
import Foundation

/// Treffpunkt und Notiz beim Dienststart (Tabelle dienst_treffpunkt, Migration 20261113140000).
/// Die Dispo setzt sie beim Dienste planen, der Fahrer sieht den Ort in der Dienststart-Karte und
/// beim Antippen wie bei einer Fahrt auf der Karte, darunter die Notiz.
/// Gleich in shared/dienstTreffpunkt.js der Web-Apps.
struct DienstTreffpunkt: Decodable, Equatable {
    var dienstID: UUID?
    /// Eigener Ort der Dispo (Tabelle orte), liefert das Icon.
    var ortID: UUID?
    var name: String
    var adresse: String
    var lat: Double?
    var lng: Double?
    var notiz: String
    /// ISO-Zeitpunkt der letzten Aenderung (Zeit und Datum ueber der Notiz).
    var aktualisiert: String?

    private enum CodingKeys: String, CodingKey { case dienst_id, ort_id, name, adresse, lat, lng, notiz, aktualisiert }

    /// Zeile wie treffpunktAusZeile im Web: Namen und Adresse getrimmt, ohne Name gilt der Teil vor dem Komma.
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        dienstID = try? c.decodeIfPresent(UUID.self, forKey: .dienst_id)
        ortID = try? c.decodeIfPresent(UUID.self, forKey: .ort_id)
        let roh = { (k: CodingKeys) in ((try? c.decodeIfPresent(String.self, forKey: k)) ?? nil)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? "" }
        adresse = roh(.adresse)
        let n = roh(.name)
        name = n.isEmpty ? (adresse.split(separator: ",").first.map { $0.trimmingCharacters(in: .whitespaces) } ?? "") : n
        notiz = roh(.notiz)
        lat = (try? c.decodeIfPresent(Double.self, forKey: .lat)) ?? nil
        lng = (try? c.decodeIfPresent(Double.self, forKey: .lng)) ?? nil
        aktualisiert = (try? c.decodeIfPresent(String.self, forKey: .aktualisiert)) ?? nil
    }

    /// Weder Ort noch Notiz: wie nicht vorhanden.
    var leer: Bool { name.isEmpty && adresse.isEmpty && notiz.isEmpty }
    /// Ort gesetzt: Karte 102 hoch mit Icon-Kachel und Name (hatTreffpunktOrt).
    var hatOrt: Bool { !name.isEmpty }

    var punkt: CLLocationCoordinate2D? {
        guard let lat, let lng, lat.isFinite, lng.isFinite, !(lat == 0 && lng == 0) else { return nil }
        return CLLocationCoordinate2D(latitude: lat, longitude: lng)
    }

    /// Graues Icon wie bei Start und Ziel einer Fahrt: eigener Ort mit seinem Icon, sonst nach dem Namen.
    @MainActor func iconGrau(_ orte: OrteSpeicher = .geteilt) -> String {
        if let eigenes = orte.iconGrau(ortID) { return eigenes }
        let text = "\(name) \(adresse)".lowercased()
        if text.range(of: #"\b(hotel|hof|resort|hostel|inn|motel|suite|residence)\b"#, options: .regularExpression) != nil {
            return OrtSymbol.hotel.grau
        }
        if text.contains("muc") || text.contains("flughafen") || text.contains("airport") || text.contains("terminal") {
            return OrtSymbol.flughafen_landung.grau
        }
        if text.contains("messe") { return OrtSymbol.messe_halle.grau }
        return OrtSymbol.pin.grau
    }

    /// Zeit und Datum der letzten Aenderung fuer die Notiz ("15:30", "13.11.2026").
    var notizZeit: (zeit: String, datum: String) {
        guard let d = aktualisiert.flatMap(Datum.ausISO) else { return ("", "") }
        return (Datum.uhrzeit(d), Datum.datumKurz(d))
    }
}
