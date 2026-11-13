import Foundation

/// Stand, den die iPhone-App an die Apple Watch schickt (WatchConnectivity, applicationContext).
/// Gehoert zur App und zur Watch-App. Die Uhr meldet sich nicht selbst an, sie zeigt, was das
/// iPhone weiss, und schickt Aktionen (Annehmen, Ablehnen) zurueck ans iPhone.
struct UhrFahrt: Codable, Identifiable, Hashable {
    var id: String
    var tag: String        // yyyy-MM-dd
    var zeit: String       // HH:mm
    var status: String     // "Unterwegs", "Beim Gast", "Angenommen", "Antwort offen"
    var von: String
    var nach: String
    var flug: String
    var offen: Bool        // Fahrer muss noch annehmen oder ablehnen
    var laeuft: Bool       // beim Gast oder unterwegs
    var kolonne: Bool
    // Ab Ausbau 11.11. (optional, damit alter gespeicherter Stand lesbar bleibt)
    var phase: String? = nil          // "beimGast", "unterwegs", sonst nil
    var gaeste: [String]? = nil
    var gastTelefon: String? = nil    // erste Nummer eines Gasts der Fahrt
    var notiz: String? = nil          // neueste Notiz zur Fahrt
    var flugStatus: String? = nil     // "Gelandet", "Gestartet", ...
    var flugAnkunft: String? = nil    // HH:mm erwartet (sonst geplant)
    var flugVerspaetung: Int? = nil   // Minuten gegenueber Plan, negativ = frueher

    /// Abholzeit als Datum (lokale Zeit).
    var zeitpunkt: Date? {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd HH:mm"
        return f.date(from: "\(tag) \(zeit)")
    }
}

/// Stundenerfassung von heute (wie Stunden.heute der iPhone-App). Laeuft der Dienst noch,
/// rechnet die Uhr die Arbeitszeit selbst hoch (gleiche Regel: Pause zaehlt erst ab 3 Stunden).
struct UhrStunden: Codable, Hashable {
    struct Pause: Codable, Hashable { var von: Date; var bis: Date? }
    var dienstID: String
    var start: Date
    var ende: Date?
    var fertig: Bool               // Dienstende erreicht, keine Fahrt mehr unterwegs
    var pausen: [Pause]
    var arbeitsMin: Int            // nur gueltig, wenn fertig (gerundet wie die App)
    var offen: Bool                // fertig und noch nicht bestaetigt (oder zurueckgegeben)
    var zettelStatus: String?      // eingereicht, bestaetigt, zurueckgewiesen

    static let pauseMindest = 180.0

    /// Minuten bis `jetzt` (laufend) bzw. gespeicherte Minuten, wenn fertig.
    func minuten(_ jetzt: Date = Date()) -> Int {
        if fertig { return arbeitsMin }
        let pause = pausen.reduce(0.0) { s, p in
            guard let pb = p.bis, pb.timeIntervalSince(p.von) >= Self.pauseMindest * 60 else { return s }
            return s + max(0, min(pb, jetzt).timeIntervalSince(p.von) / 60)
        }
        return max(0, Int(jetzt.timeIntervalSince(start) / 60 - pause))
    }

    /// Pause laeuft gerade (begonnen, Ende offen oder noch nicht erreicht).
    func pauseLaeuft(_ jetzt: Date = Date()) -> Bool {
        !fertig && pausen.contains { $0.von <= jetzt && ($0.bis == nil || $0.bis! > jetzt) }
    }
}

struct UhrDienst: Codable, Identifiable, Hashable {
    var id: String
    var tag: String        // yyyy-MM-dd
    var start: String?     // HH:mm
    var ende: String?
    var offen: Bool        // noch nicht angenommen
    // Ab 13.11. (optional, alter Stand bleibt lesbar): Treffpunkt beim Dienststart (dienst_treffpunkt).
    var treffpunkt: String? = nil       // Name des Orts
    var treffpunktNotiz: String? = nil  // Notiz der Dispo
    var treffpunktLat: Double? = nil    // Koordinaten fuer Karten auf der Uhr
    var treffpunktLng: Double? = nil
}

struct UhrStand: Codable, Equatable {
    var angemeldet: Bool
    var name: String
    var fahrten: [UhrFahrt]
    var dienste: [UhrDienst]
    var ortungAn: Bool
    var letzteSendung: Date?
    var stand: Date
    // Ab Ausbau 11.11. (optional)
    var steht: Bool? = nil         // letzte Position langsamer als 2 m/s, nil = unbekannt
    var tempoKmh: Int? = nil       // auf 5 km/h gerundet
    var heute: UhrStunden? = nil

    static let leer = UhrStand(angemeldet: false, name: "", fahrten: [], dienste: [], ortungAn: false, letzteSendung: nil, stand: .distantPast)

    static let schluessel = "stand"

    func alsDaten() -> [String: Any] {
        guard let daten = try? JSONEncoder().encode(self) else { return [:] }
        return [Self.schluessel: daten]
    }

    static func aus(_ kontext: [String: Any]) -> UhrStand? {
        guard let daten = kontext[schluessel] as? Data else { return nil }
        return try? JSONDecoder().decode(UhrStand.self, from: daten)
    }
}

extension UhrStand {
    /// Laufende Fahrt, sonst die naechste ab 30 min vor jetzt, sonst die erste.
    func naechsteFahrt(_ jetzt: Date = Date()) -> UhrFahrt? {
        if let laeuft = fahrten.first(where: { $0.laeuft }) { return laeuft }
        let grenze = jetzt.addingTimeInterval(-1800)
        return fahrten.first(where: { ($0.zeitpunkt ?? .distantFuture) >= grenze }) ?? fahrten.first
    }

    /// Naechste Fahrt, die noch angenommen werden muss.
    func naechsteOffene(_ jetzt: Date = Date()) -> UhrFahrt? {
        let grenze = jetzt.addingTimeInterval(-1800)
        return fahrten.first { $0.offen && ($0.zeitpunkt ?? .distantFuture) >= grenze } ?? fahrten.first { $0.offen }
    }

    /// "in 25 min", "in 2 h 5 min", "jetzt", "seit 10 min"
    static func abstand(bis ziel: Date, von jetzt: Date = Date()) -> String {
        let min = Int((ziel.timeIntervalSince(jetzt) / 60).rounded(.up))
        if min == 0 { return "jetzt" }
        if min < 0 { return -min < 60 ? "seit \(-min) min" : "seit \(-min / 60) h" }
        if min < 60 { return "in \(min) min" }
        let h = min / 60, rest = min % 60
        return rest == 0 ? "in \(h) h" : "in \(h) h \(rest) min"
    }
}

/// Gemeinsamer Speicher von Uhr-App und Komplikation (App Group). Die Kennung steht in der
/// Info.plist (TrisarUhrGruppe, aus TRISAR_UHR_GRUPPE), Standard group.de.trisar.fahrer.uhr.
enum UhrGruppe {
    static var id: String {
        (Bundle.main.object(forInfoDictionaryKey: "TrisarUhrGruppe") as? String).flatMap { $0.isEmpty ? nil : $0 }
            ?? "group.de.trisar.fahrer.uhr"
    }
    static let schluessel = "trisar_uhr_stand"
    static var speicher: UserDefaults { UserDefaults(suiteName: id) ?? .standard }

    static func lesen() -> UhrStand? {
        guard let daten = speicher.data(forKey: schluessel) ?? UserDefaults.standard.data(forKey: schluessel) else { return nil }
        return try? JSONDecoder().decode(UhrStand.self, from: daten)
    }

    static func schreiben(_ stand: UhrStand) {
        guard let daten = try? JSONEncoder().encode(stand) else { return }
        UserDefaults.standard.set(daten, forKey: schluessel)
        speicher.set(daten, forKey: schluessel)
    }
}

/// Nachrichten der Uhr ans iPhone.
enum UhrAktion {
    static let art = "aktion"
    static let fahrt = "fahrt"         // + id, annehmen
    static let dienst = "dienst"       // + id, annehmen
    static let neuLaden = "neuLaden"
    static let schritt = "schritt"     // + id, ziel (at_pickup, in_progress, done)
    static let stundenBestaetigen = "stundenBestaetigen"   // + id (Dienst)
}
