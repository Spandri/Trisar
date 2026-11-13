import Foundation

/// Stand, den die Dispo-App an die Apple Watch schickt (WatchConnectivity, applicationContext).
/// Gehoert zur App und zur Watch-App. Die Uhr meldet sich nicht selbst an.
struct DispoUhrFahrer: Codable, Identifiable, Hashable {
    var id: String
    var name: String
    var nummer: String?
    var zustand: String        // "aktiv", "inaktiv", "frei"
    var ohneSignal: Bool
    var signalStufe: Int       // 0 frisch ... 5 kein Signal
    var kennzeichen: String
    var fahrtVon: String?
    var fahrtNach: String?
    /// Standort fuer die Karte. Optional, damit ein alter gespeicherter Stand lesbar bleibt.
    var lat: Double? = nil
    var lng: Double? = nil
    /// Telefonnummer aus profiles.phone fuer „Anrufen“. Optional wie oben.
    var telefon: String? = nil
    /// Wie das Fahrer-Blatt der iPhone-Karte (KartenFahrtInfo). Alle optional wie oben.
    var fahrzeug: String? = nil
    var signalText: String? = nil
    var abfahrt: String? = nil
    var ankunft: String? = nil
    var fahrMinuten: Int? = nil
    var unterwegs: Bool? = nil
    var vonTyp: String? = nil
    var nachTyp: String? = nil
    var vonName: String? = nil
    var nachName: String? = nil
    var dienststart: String? = nil
    var dienstende: String? = nil
    /// Flagge der Dispo (flagge1 Cyan, flagge2 Pink, flagge3 Koenigsblau), nil = keine.
    var flagge: String? = nil

    /// Kann eine Fahrt uebernehmen: frei oder inaktiv (keine laufende Fahrt).
    var verfuegbar: Bool { zustand != "aktiv" }
}

struct DispoUhrFahrt: Codable, Identifiable, Hashable {
    var id: String
    var tag: String            // yyyy-MM-dd
    var zeit: String           // HH:mm
    var von: String
    var nach: String
    var fahrer: String         // Namen, leer = ohne Fahrer
    var gast: String
    var status: String
    var ohneFahrer: Bool
    var verspaetet: Bool
    /// Geplante Ankunft am Ziel (HH:mm). Optional, damit ein alter gespeicherter Stand lesbar bleibt.
    var ankunft: String? = nil
    /// "Unterwegs", "Beim Gast", "Offen", "Beendet"
    var statusText: String? = nil
}

struct DispoUhrStand: Codable, Equatable {
    var angemeldet: Bool
    var fahrer: [DispoUhrFahrer]
    var fahrten: [DispoUhrFahrt]
    var stand: Date

    static let leer = DispoUhrStand(angemeldet: false, fahrer: [], fahrten: [], stand: .distantPast)
    static let schluessel = "stand"

    func alsDaten() -> [String: Any] {
        guard let daten = try? JSONEncoder().encode(self) else { return [:] }
        return [Self.schluessel: daten]
    }

    static func aus(_ kontext: [String: Any]) -> DispoUhrStand? {
        guard let daten = kontext[schluessel] as? Data else { return nil }
        return try? JSONDecoder().decode(DispoUhrStand.self, from: daten)
    }
}

enum DispoUhrAktion {
    static let art = "aktion"
    static let neuLaden = "neuLaden"
    /// KI-Assistent: "frage" + "verlauf" (JSON [[rolle, text]]). Antwort: "text", optional
    /// "dienst" (Vorschlag als JSON-Daten, unveraendert zurueckschicken) und "knopf" (Beschriftung).
    /// Das iPhone legt Frage und Antwort im Verlauf des KI-Assistenten der App ab (derselbe Chat)
    /// und gibt die ID der Antwort als "nachricht" zurueck.
    static let kiFrage = "kiFrage"
    /// Dienst-Vorschlag senden: "dienst" (Daten aus kiFrage), optional "nachricht" (ID aus kiFrage),
    /// damit der Status auch im Verlauf am iPhone steht. Antwort: "ok", "anzahl" oder "fehler".
    static let dienstSenden = "dienstSenden"
    /// Vorschlag auf der Uhr mit „Nein“ verworfen: "nachricht" (ID aus kiFrage). Ohne Antwort.
    static let vorschlagVerwerfen = "vorschlagVerwerfen"
    /// Buchungs-Vorschlag des Assistenten buchen: "buchung" (Daten aus kiFrage), optional "nachricht". Antwort: "ok" oder "fehler".
    static let buchen = "buchen"
    /// Fahrt ohne Fahrer einem Fahrer zuweisen: "fahrt" (jobs.id) + "fahrer" (profiles.id).
    /// Das iPhone speichert wie der Fahrt-Editor (Fahrer bekommt „Neue Fahrt“). Antwort: "ok" oder "fehler".
    static let fahrerZuweisen = "fahrerZuweisen"
}

/// Zahlen fuer die Komplikation, ueber die App Group von der Uhr-App an die Widget-Erweiterung.
struct DispoUhrZahlen: Codable, Equatable {
    var ohneFahrer: Int
    var ohneSignal: Int
    var angemeldet: Bool
    var stand: Date

    static let gruppe = "group.de.trisar.dispo.uhr"
    static let schluessel = "zahlen"

    static func laden() -> DispoUhrZahlen? {
        guard let daten = UserDefaults(suiteName: gruppe)?.data(forKey: schluessel) else { return nil }
        return try? JSONDecoder().decode(DispoUhrZahlen.self, from: daten)
    }

    func speichern() {
        guard let daten = try? JSONEncoder().encode(self) else { return }
        UserDefaults(suiteName: Self.gruppe)?.set(daten, forKey: Self.schluessel)
    }
}

extension DispoUhrStand {
    static func heute() -> String {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        return f.string(from: Date())
    }

    /// Fahrten von heute ohne Fahrer (wie die Uebersicht).
    var ohneFahrerHeute: Int {
        let tag = Self.heute()
        return fahrten.filter { $0.ohneFahrer && $0.tag == tag }.count
    }

    var ohneSignal: Int { fahrer.filter(\.ohneSignal).count }

    var zahlen: DispoUhrZahlen {
        DispoUhrZahlen(ohneFahrer: angemeldet ? ohneFahrerHeute : 0, ohneSignal: angemeldet ? ohneSignal : 0,
                       angemeldet: angemeldet, stand: stand)
    }
}
