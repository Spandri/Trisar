import Foundation

/// Modelle und Lacke, fuer die die Fahrer-App eine 360-Grad-Ansicht hat (FahrzeugDreh/fahrzeug-dreh.json,
/// erzeugt mit werkzeuge/fahrzeugbilder/dreh-einbauen.py), wie admin/src/shared/fahrzeugDreh.js.
/// Beim Fahrzeug anlegen/bearbeiten als Vorschlaege fuer Marke & Modell und Farbe. Passen brand_model
/// und color, nimmt die Fahrer-App die Bilderreihe.
enum FahrzeugDrehVorschlaege {
    struct Lack: Decodable, Hashable { let code: String; let name: String; let hex: String }
    struct Modell: Decodable {
        let name: String
        let modell: [String]
        let farben: [[String]]
        let lackliste: [Lack]
    }
    private struct Info: Decodable { let modelle: [Modell] }

    static let modelle: [Modell] = {
        guard let url = Bundle.main.url(forResource: "fahrzeug-dreh", withExtension: "json"),
              let daten = try? Data(contentsOf: url),
              let info = try? JSONDecoder().decode(Info.self, from: daten) else { return [] }
        return info.modelle
    }()

    /// klein, Umlaute ausgeschrieben, nur Buchstaben und Ziffern: "V-Klasse 250 d" -> "vklasse250d"
    static func glatt(_ s: String) -> String {
        let klein = s.lowercased()
            .replacingOccurrences(of: "ä", with: "ae").replacingOccurrences(of: "ö", with: "oe")
            .replacingOccurrences(of: "ü", with: "ue").replacingOccurrences(of: "ß", with: "ss")
        return String(klein.unicodeScalars.filter { ("a"..."z").contains($0) || ("0"..."9").contains($0) }.map(Character.init))
    }

    static func modell(zu markeModell: String) -> Modell? {
        let m = glatt(markeModell)
        guard !m.isEmpty else { return nil }
        return modelle.first { $0.modell.contains(where: { m.contains($0) }) }
    }

    /// Lack, zu dem die Farbe gehoert (gleiche Regel wie in der Fahrer-App).
    static func lack(markeModell: String, farbe: String) -> Lack? {
        guard let m = modell(zu: markeModell) else { return nil }
        let f = glatt(farbe)
        guard !f.isEmpty, let treffer = m.farben.first(where: { $0.count == 2 && f.contains($0[0]) }) else { return nil }
        return m.lackliste.first { $0.code == treffer[1] }
    }

    /// Jedes Wort der Eingabe kommt im Namen vor. Leere Eingabe: alle.
    static func modellVorschlaege(_ eingabe: String) -> [String] {
        let woerter = eingabe.split(whereSeparator: \.isWhitespace).map { glatt(String($0)) }.filter { !$0.isEmpty }
        let roh = eingabe.trimmingCharacters(in: .whitespaces)
        return modelle.map(\.name).filter { name in woerter.allSatisfy { glatt(name).contains($0) } && name != roh }
    }

    /// Nur wenn das Modell bekannt ist, dann dessen Lacke.
    static func farbVorschlaege(markeModell: String, eingabe: String) -> [Lack] {
        guard let m = modell(zu: markeModell) else { return [] }
        let e = glatt(eingabe)
        let roh = eingabe.trimmingCharacters(in: .whitespaces)
        return m.lackliste.filter { (e.isEmpty || glatt($0.name).contains(e)) && $0.name != roh }
    }
}
