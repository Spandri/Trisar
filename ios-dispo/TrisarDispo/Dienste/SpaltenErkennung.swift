import Foundation
import Supabase

/// Spalten einer beliebigen Tabelle erkennen und auf Fahrten bzw. Fahrgaeste abbilden,
/// 1:1 nach admin/src/services/spaltenErkennung.js (gleiche Muster, Gewichte, Schwellen).
enum SpaltenErkennung {
    enum Modus { case fahrten, gaeste }

    struct Feld {
        let key: String
        let kopf: [String]
        let werte: [String]
        var belegt: [String] = []
    }

    struct Spalte: Identifiable {
        let index: Int
        let titel: String
        let ohneTitel: Bool
        let beispiele: [String]
        var vorschlag: String?
        var sicherheit: Double = 0
        var grundKopf: String?
        var grundWerte: String?
        var grundAnteil = 0
        var id: Int { index }
    }

    struct Ergebnis {
        let spalten: [Spalte]
        let datenzeilen: [[String]]
    }

    struct Unvollstaendig { let zeile: Int; let fehlt: [String] }
    typealias Datensatz = [String: AnyJSON]

    // MARK: Regex-Hilfen (JS-Syntax ueber NSRegularExpression)

    private static var cache: [String: NSRegularExpression] = [:]
    /// Erkennung laeuft im Hintergrund, Datensaetze bauen auf dem Hauptthread: Cache absichern.
    private static let sperre = NSLock()
    private static func rx(_ m: String, _ i: Bool) -> NSRegularExpression {
        let k = (i ? "i:" : "c:") + m
        sperre.lock()
        defer { sperre.unlock() }
        if let r = cache[k] { return r }
        let r = try! NSRegularExpression(pattern: m, options: i ? [.caseInsensitive] : [])
        cache[k] = r
        return r
    }

    static func passt(_ s: String, _ m: String, i: Bool = false) -> Bool {
        rx(m, i).firstMatch(in: s, range: NSRange(s.startIndex..., in: s)) != nil
    }

    /// Gruppen des ersten Treffers ("" fuer nicht getroffene Gruppen), nil ohne Treffer.
    static func treffer(_ s: String, _ m: String, i: Bool = false) -> [String]? {
        guard let t = rx(m, i).firstMatch(in: s, range: NSRange(s.startIndex..., in: s)) else { return nil }
        return (0 ..< t.numberOfRanges).map { n in Range(t.range(at: n), in: s).map { String(s[$0]) } ?? "" }
    }

    /// JS `replace` ohne g: nur der erste Treffer.
    static func ersetzeErsten(_ s: String, _ m: String, _ durch: String, i: Bool = false) -> String {
        guard let t = rx(m, i).firstMatch(in: s, range: NSRange(s.startIndex..., in: s)) else { return s }
        let ersatz = rx(m, i).replacementString(for: t, in: s, offset: 0, template: durch)
        return (s as NSString).replacingCharacters(in: t.range, with: ersatz)
    }

    static func text(_ s: String?) -> String { (s ?? "").trimmingCharacters(in: .whitespacesAndNewlines) }

    private static func schluessel(_ s: String) -> String {
        let k = text(s).lowercased()
        return rx("[^a-z0-9äöüß]+", false).stringByReplacingMatches(in: k, range: NSRange(k.startIndex..., in: k), withTemplate: " ")
            .trimmingCharacters(in: .whitespaces)
    }

    // MARK: Werte erkennen

    private static let monate: [String: Int] = [
        "jan": 1, "januar": 1, "january": 1, "feb": 2, "februar": 2, "february": 2, "mär": 3, "mar": 3, "märz": 3, "maerz": 3, "march": 3,
        "apr": 4, "april": 4, "mai": 5, "may": 5, "jun": 6, "juni": 6, "june": 6, "jul": 7, "juli": 7, "july": 7, "aug": 8, "august": 8,
        "sep": 9, "sept": 9, "september": 9, "okt": 10, "oct": 10, "oktober": 10, "october": 10, "nov": 11, "november": 11,
        "dez": 12, "dec": 12, "dezember": 12, "december": 12,
    ]

    private static func p2(_ s: String) -> String { s.count < 2 ? String(repeating: "0", count: 2 - s.count) + s : s }
    private static func p2(_ n: Int) -> String { p2(String(n)) }
    private static func jahr4(_ j: String) -> String { j.count == 2 ? "20\(j)" : j }

    static func datumLesen(_ wert: String) -> String {
        let t = text(wert)
        if t.isEmpty { return "" }
        if let m = treffer(t, #"(\d{4})-(\d{1,2})-(\d{1,2})"#) { return "\(m[1])-\(p2(m[2]))-\(p2(m[3]))" }
        if let m = treffer(t, #"(\d{1,2})\.(\d{1,2})\.(\d{2,4})"#) { return "\(jahr4(m[3]))-\(p2(m[2]))-\(p2(m[1]))" }
        // 16/08/2026 (europaeisch), bei Werten ueber 12 im zweiten Feld amerikanisch
        if let m = treffer(t, #"(\d{1,2})/(\d{1,2})/(\d{2,4})"#) {
            let a = Int(m[1]) ?? 0, b = Int(m[2]) ?? 0
            let (tag, monat) = b > 12 ? (b, a) : (a, b)
            return "\(jahr4(m[3]))-\(p2(monat))-\(p2(tag))"
        }
        if let m = treffer(t.lowercased(), #"(\d{1,2})\.?\s+([a-zäöü]{3,9})\.?\s+(\d{2,4})"#), let mo = monate[m[2]] {
            return "\(jahr4(m[3]))-\(p2(mo))-\(p2(m[1]))"
        }
        return ""
    }

    static func uhrzeitLesen(_ wert: String) -> String {
        let t = text(wert)
        guard let m = treffer(t, #"(?:^|[^\d.])(\d{1,2})[:.h](\d{2})(?:\s*(am|pm))?(?!\d)"#, i: true)
            ?? treffer(t, #"^(\d{1,2})[:.](\d{2})"#) else { return "" }
        var std = Int(m[1]) ?? 0
        let min = Int(m[2]) ?? 0
        let halb = m.count > 3 ? m[3].lowercased() : ""
        if halb == "pm" && std < 12 { std += 12 }
        if halb == "am" && std == 12 { std = 0 }
        if std > 23 || min > 59 { return "" }
        return "\(p2(std)):\(p2(min))"
    }

    private static let datumTeil = #"\d{1,2}\.\d{1,2}\.\d{2,4}|\d{4}-\d{1,2}-\d{1,2}"#

    static func muster(_ art: String, _ t: String) -> Bool {
        switch art {
        case "datum":
            let rest = ersetzeErsten(t, #"^\S+\s*"#, "").trimmingCharacters(in: .whitespacesAndNewlines)
            return !datumLesen(t).isEmpty && !passt(rest.isEmpty ? "x" : rest, #"\d{1,2}[:.]\d{2}\s*(uhr|am|pm)?$"#, i: true)
        case "uhrzeit": return passt(t, #"^\s*\d{1,2}[:.h]\d{2}(\s*(uhr|am|pm))?\s*$"#, i: true)
        case "datumUhrzeit": return !datumLesen(t).isEmpty && !uhrzeitLesen(ersetzeErsten(t, datumTeil, "")).isEmpty
        case "flug":
            return passt(text(t.uppercased()), #"^[A-Z][A-Z0-9]\s?\d{2,4}[A-Z]?$"#) && !passt(t, #"^(ICE|IC|EC|RJ|TGV|RE|RB)\s?\d"#, i: true)
        case "zug": return passt(text(t), #"^(ICE|IC|EC|RJ|RJX|TGV|RE|RB|NJ|FLX)\s?\d{1,5}$"#, i: true)
        case "flughafenCode": return passt(text(t), #"\(([A-Z]{3})\)|^[A-Z]{3}$"#)
        case "ort":
            return passt(t, #"(stra(ß|ss)e|str\.|platz|weg|allee|ring|gasse|damm|ufer|road|street|avenue|hotel|flughafen|airport|terminal|bahnhof|hbf|messe|zentrum|center)"#, i: true)
                || passt(t, #"\b\d{5}\b"#) || passt(t, #"\b[A-ZÄÖÜ][a-zäöüß]+\s\d{1,4}[a-z]?\b"#)
        case "name":
            let ohne = text(ersetzeErsten(t, #"^(herr|frau|mr|mrs|ms|dr)\.?\s+"#, "", i: true))
            return passt(ohne, #"^([A-ZÄÖÜ][a-zäöüß'-]+\.?\s){1,3}[A-ZÄÖÜ][a-zäöüß'-]+(\s*[,;&/]\s*([A-ZÄÖÜ][a-zäöüß'-]+\.?\s){1,3}[A-ZÄÖÜ][a-zäöüß'-]+)*$"#)
        case "anzahl":
            guard passt(text(t), #"^\d{1,2}$"#), let n = Int(text(t)) else { return false }
            return n >= 1 && n <= 30
        case "janein": return passt(text(t), #"^(ja|nein|yes|no|x|true|false|1|0|y|n|✓|✔)$"#, i: true)
        case "email": return passt(text(t), #"^[^\s@]+@[^\s@]+\.[a-z]{2,}$"#, i: true)
        case "telefon": return passt(text(t), #"^\+?[\d\s()/-]{7,}$"#) && t.filter(\.isASCII).filter(\.isNumber).count >= 7
        case "plz": return passt(text(t), #"^\d{4,5}$"#)
        case "freitext": return text(t).split(whereSeparator: \.isWhitespace).count >= 4
        default: return false
        }
    }

    private static func anteil(_ werte: [String], _ art: String) -> Double {
        werte.isEmpty ? 0 : Double(werte.filter { muster(art, $0) }.count) / Double(werte.count)
    }

    // MARK: Zielfelder

    static let fahrtFelder: [Feld] = [
        Feld(key: "datumUhrzeit", kopf: ["datum uhrzeit", "datum zeit", "termin", "date time", "datetime", "zeitpunkt", "pickup datetime", "abholung am"], werte: ["datumUhrzeit"], belegt: ["datum", "uhrzeit"]),
        Feld(key: "datum", kopf: ["datum", "date", "tag", "day", "service date", "fahrtdatum", "transferdatum", "ankunftstag", "arrival date"], werte: ["datum"]),
        Feld(key: "uhrzeit", kopf: ["uhrzeit", "zeit", "time", "abholzeit", "pick up time", "pickup time", "etd", "abfahrt", "um", "start time"], werte: ["uhrzeit"]),
        Feld(key: "abholort", kopf: ["abholort", "abholung", "abholadresse", "von", "start", "startadresse", "pick up location", "pickup location", "pick up", "pickup", "from address", "origin address", "treffpunkt"], werte: ["ort"]),
        Feld(key: "zielort", kopf: ["zielort", "ziel", "zieladresse", "nach", "bis", "drop off", "dropoff", "drop off location", "destination", "to address", "hotel"], werte: ["ort"]),
        Feld(key: "flugnummer", kopf: ["flug", "flugnummer", "flight", "flight no", "flight number", "flightnumber", "arrival flight", "zug flug", "flug zug"], werte: ["flug", "zug"]),
        Feld(key: "zugnummer", kopf: ["zug", "zugnummer", "train", "train number"], werte: ["zug"]),
        Feld(key: "herkunft", kopf: ["herkunft", "abflugort", "aus", "arriving from", "from", "origin", "kommt aus", "abflughafen"], werte: ["flughafenCode"]),
        Feld(key: "gaeste", kopf: ["gast", "gäste", "gaeste", "fahrgast", "fahrgäste", "passagier", "passagiere", "guest", "guest name", "guests", "passenger", "passengers", "name", "kunde", "reisender"], werte: ["name"]),
        Feld(key: "anzahl", kopf: ["anzahl", "anz", "personen", "pax", "persons", "people", "teilnehmer", "number of guests"], werte: ["anzahl"]),
        Feld(key: "vip", kopf: ["vip"], werte: ["janein"]),
        Feld(key: "kindersitz", kopf: ["kindersitz", "child seat", "kindersitze", "baby seat"], werte: ["janein"]),
        Feld(key: "rollstuhl", kopf: ["rollstuhl", "barrierefrei", "wheelchair", "rollstuhlgerecht", "accessibility"], werte: ["janein"]),
        Feld(key: "gepaeck", kopf: ["gepäck", "gepaeck", "koffer", "luggage", "baggage", "sondergepäck"], werte: ["janein", "anzahl"]),
        Feld(key: "notiz", kopf: ["notiz", "notizen", "bemerkung", "bemerkungen", "hinweis", "hinweise", "kommentar", "note", "notes", "remarks", "comment", "comments", "info"], werte: ["freitext"]),
    ]

    static let gastFelder: [Feld] = [
        Feld(key: "vorname", kopf: ["vorname", "first name", "firstname", "given name"], werte: ["name"]),
        Feld(key: "nachname", kopf: ["nachname", "familienname", "last name", "lastname", "surname"], werte: ["name"]),
        Feld(key: "vollname", kopf: ["name", "gast", "kunde", "guest", "guest name", "full name", "fahrgast"], werte: ["name"], belegt: ["vorname", "nachname"]),
        Feld(key: "email", kopf: ["email", "e mail", "mail", "e mail adresse"], werte: ["email"]),
        Feld(key: "telefon", kopf: ["telefon", "tel", "phone", "mobil", "handy", "mobile"], werte: ["telefon"]),
        Feld(key: "firma", kopf: ["firma", "unternehmen", "company", "organisation", "organization"], werte: []),
        Feld(key: "strasse", kopf: ["straße", "strasse", "str", "street", "adresse", "address"], werte: ["ort"]),
        Feld(key: "plz", kopf: ["plz", "postleitzahl", "zip", "postcode", "postal code"], werte: ["plz"]),
        Feld(key: "stadt", kopf: ["stadt", "ort", "city", "town"], werte: []),
        Feld(key: "sprache", kopf: ["sprache", "language", "lang"], werte: []),
        Feld(key: "vip", kopf: ["vip"], werte: ["janein"]),
        Feld(key: "notiz", kopf: ["notiz", "bemerkung", "hinweis", "note", "notes", "remarks"], werte: ["freitext"]),
    ]

    static func felder(_ m: Modus) -> [Feld] { m == .gaeste ? gastFelder : fahrtFelder }

    // MARK: Kopfzeile finden

    private static func siehtAusWieDaten(_ t: String) -> Bool {
        muster("uhrzeit", t) || !datumLesen(t).isEmpty || passt(t, #"^\d+([.,]\d+)?$"#) || muster("flug", t)
    }

    private static func kopfzeileFinden(_ zeilen: [[String]]) -> Int {
        let gefuellt = { (z: [String]) in z.filter { !text($0).isEmpty }.count }
        let maxBreite = zeilen.prefix(15).map(gefuellt).max() ?? 0
        var i = 0
        while i < min(zeilen.count - 1, 12) {
            defer { i += 1 }
            let z = zeilen[i]
            let n = gefuellt(z)
            if n < 2 || Double(n) < Double(maxBreite) * 0.6 { continue }
            let zellen = z.map { text($0) }.filter { !$0.isEmpty }
            let datenhaft = zellen.filter(siehtAusWieDaten).count
            let kurz = zellen.filter { $0.count <= 40 }.count
            if datenhaft == 0 && kurz == zellen.count { return i }
            // Erste Zeile sieht bereits wie Daten aus: es gibt keine Kopfzeile.
            if Double(datenhaft) / Double(zellen.count) > 0.3 { return -1 }
        }
        return -1
    }

    // MARK: Erkennung

    private static func kopfTreffer(_ titel: String, _ feld: Feld) -> (wert: Double, wort: String?) {
        let k = schluessel(titel)
        if k.isEmpty { return (0, nil) }
        var bester: (wert: Double, wort: String?) = (0, nil)
        for wort in feld.kopf {
            if k == wort { bester = (1, wort) }
            else if bester.wert < 0.8 && " \(k) ".contains(" \(wort) ") { bester = (0.8, wort) }
            else if bester.wert < 0.55 && wort.count >= 4 && k.contains(wort) { bester = (0.55, wort) }
        }
        return bester
    }

    private static func werteTreffer(_ beispiele: [String], _ feld: Feld) -> (wert: Double, art: String?) {
        var bester: (wert: Double, art: String?) = (0, nil)
        for art in feld.werte {
            let a = anteil(beispiele, art)
            if a > bester.wert { bester = (a, art) }
        }
        return bester
    }

    static func erkennen(_ rohzeilen: [[String]], _ modus: Modus) -> Ergebnis {
        let zeilen = rohzeilen.filter { $0.contains { !text($0).isEmpty } }
        guard !zeilen.isEmpty else { return Ergebnis(spalten: [], datenzeilen: []) }

        let kopf = kopfzeileFinden(zeilen)
        let breite = zeilen.map(\.count).max() ?? 0
        let wert = { (z: [String], i: Int) in i < z.count ? text(z[i]) : "" }
        let titel = (0 ..< breite).map { kopf >= 0 ? wert(zeilen[kopf], $0) : "" }
        let datenzeilen = zeilen.dropFirst(kopf + 1).filter { $0.filter { !text($0).isEmpty }.count >= 2 }

        var spalten: [Spalte] = titel.enumerated().map { index, t in
            let beispiele = Array(datenzeilen.map { wert($0, index) }.filter { !$0.isEmpty }.prefix(30))
            return Spalte(index: index, titel: t.isEmpty ? "Spalte \(index + 1)" : t, ohneTitel: t.isEmpty, beispiele: beispiele)
        }.filter { !$0.beispiele.isEmpty }

        let felder = felder(modus)
        struct Kandidat { let spalte: Int; let feld: Feld; let punkte: Double; let kopf: Double; let werte: (wert: Double, art: String?); let rang: Int }
        var kandidaten: [Kandidat] = []
        for spalte in spalten {
            for (rang, feld) in felder.enumerated() {
                let k = kopfTreffer(spalte.ohneTitel ? "" : spalte.titel, feld)
                let w = werteTreffer(spalte.beispiele, feld)
                // Ueberschrift wiegt schwerer, Werte bestaetigen oder tragen allein.
                var punkte = k.wert * 0.62 + w.wert * 0.5
                if k.wert == 0 && feld.werte.isEmpty { punkte = 0 }
                // Widerspruch: Ueberschrift passt, Werte sehen nach etwas anderem aus.
                if k.wert > 0 && !feld.werte.isEmpty && w.wert < 0.2 { punkte *= 0.75 }
                if punkte < 0.34 { continue }
                kandidaten.append(Kandidat(spalte: spalte.index, feld: feld, punkte: min(1, punkte), kopf: k.wert, werte: w, rang: rang))
            }
        }

        // Beste Paare zuerst vergeben, jede Spalte und jedes Feld nur einmal.
        kandidaten.sort { a, b in
            if a.punkte != b.punkte { return a.punkte > b.punkte }
            if a.spalte != b.spalte { return a.spalte < b.spalte }
            return a.rang < b.rang
        }
        var vergebenSpalte: [Int: Kandidat] = [:]
        var vergebenFeld = Set<String>()
        for c in kandidaten {
            if vergebenSpalte[c.spalte] != nil { continue }
            let blockiert = [c.feld.key] + c.feld.belegt
            if blockiert.contains(where: vergebenFeld.contains) { continue }
            // Datum+Uhrzeit in einer Spalte schliesst die Einzelfelder aus und umgekehrt.
            if felder.contains(where: { $0.belegt.contains(c.feld.key) && vergebenFeld.contains($0.key) }) { continue }
            vergebenSpalte[c.spalte] = c
            blockiert.forEach { vergebenFeld.insert($0) }
        }

        for i in spalten.indices {
            guard let c = vergebenSpalte[spalten[i].index] else { continue }
            spalten[i].vorschlag = c.feld.key
            spalten[i].sicherheit = (c.punkte * 100).rounded() / 100
            spalten[i].grundKopf = c.kopf >= 0.55 ? spalten[i].titel : nil
            spalten[i].grundWerte = c.werte.wert >= 0.5 ? c.werte.art : nil
            spalten[i].grundAnteil = Int((c.werte.wert * 100).rounded())
        }
        return Ergebnis(spalten: spalten, datenzeilen: Array(datenzeilen))
    }

    // MARK: Datensaetze bauen

    private static func ja(_ w: String) -> Bool { passt(text(w), #"^(ja|yes|x|true|1|y|✓|✔)$"#, i: true) }
    private static func kurzname(_ a: String) -> String {
        let erster = text(a).components(separatedBy: ",").first ?? ""
        return erster.isEmpty ? text(a) : erster
    }
    private static let flughafen = #"(flughafen|airport|terminal|\([A-Z]{3}\)|\bMUC\b|\bFRA\b|\bBER\b)"#

    /// JS parseInt: fuehrende Ziffern nach optionalem Vorzeichen.
    private static func parseInt(_ s: String) -> Int? {
        guard let m = treffer(s, #"^\s*([+-]?\d+)"#) else { return nil }
        return Int(m[1])
    }

    private static func leser(_ zuordnung: [Int: String]) -> ([String], String) -> String {
        { zeile, feld in
            guard let i = zuordnung.first(where: { $0.value == feld })?.key, i < zeile.count else { return "" }
            return text(zeile[i])
        }
    }

    private static func json(_ s: String) -> AnyJSON { s.isEmpty ? .null : .string(s) }

    /// fahrtenBauen: Datensaetze fuer jobs, die Notiz steckt als "note" darin (kommt nach job_notes).
    static func fahrtenBauen(_ datenzeilen: [[String]], _ zuordnung: [Int: String]) -> (fertig: [Datensatz], unvollstaendig: [Unvollstaendig]) {
        let wert = leser(zuordnung)
        var fertig: [Datensatz] = []
        var unvollstaendig: [Unvollstaendig] = []
        for (nr, zeile) in datenzeilen.enumerated() {
            let kombi = wert(zeile, "datumUhrzeit")
            let d1 = datumLesen(kombi)
            let datum = d1.isEmpty ? datumLesen(wert(zeile, "datum")) : d1
            let u1 = kombi.isEmpty ? "" : uhrzeitLesen(ersetzeErsten(kombi, datumTeil, ""))
            let uhrzeit = u1.isEmpty ? uhrzeitLesen(wert(zeile, "uhrzeit")) : u1
            let abholort = wert(zeile, "abholort")
            let zielort = wert(zeile, "zielort")
            let flugOderZug = wert(zeile, "flugnummer")
            let istZug = muster("zug", flugOderZug)
            let zugSpalte = wert(zeile, "zugnummer")
            let zug = zugSpalte.isEmpty ? (istZug ? flugOderZug : "") : zugSpalte
            let flug = istZug ? "" : ersetzeErsten(flugOderZug.uppercased(), #"^([A-Z0-9]{2})\s?(\d)"#, "$1 $2")
            let gaesteText = wert(zeile, "gaeste")
            let gaeste = gaesteText.isEmpty ? [] : rx(#"\s*[,;&/]\s*|\s+und\s+|\s+and\s+"#, true)
                .stringByReplacingMatches(in: gaesteText, range: NSRange(gaesteText.startIndex..., in: gaesteText), withTemplate: "\u{1F}")
                .components(separatedBy: "\u{1F}").filter { !$0.isEmpty }
            let anzahl = parseInt(wert(zeile, "anzahl"))
            let gepaeck = wert(zeile, "gepaeck")

            var fehlt: [String] = []
            if datum.isEmpty { fehlt.append("datum") }
            if uhrzeit.isEmpty { fehlt.append("uhrzeit") }
            if abholort.isEmpty { fehlt.append("abholort") }
            if zielort.isEmpty { fehlt.append("zielort") }

            let istFlughafen = !flug.isEmpty || passt(abholort, flughafen, i: true) || passt(zielort, flughafen, i: true)
            let satz: Datensatz = [
                "ride_date": json(datum),
                "etd": uhrzeit.isEmpty ? .null : .string("\(uhrzeit):00"),
                "original_etd": uhrzeit.isEmpty ? .null : .string("\(uhrzeit):00"),
                "pickup_name": json(kurzname(abholort)),
                "pickup_address": json(abholort),
                "dropoff_name": json(kurzname(zielort)),
                "dropoff_address": json(zielort),
                "flight_number": json(flug),
                "flight_origin": json(wert(zeile, "herkunft")),
                "train_number": json(zug),
                "passengers": .array(gaeste.map(AnyJSON.string)),
                // jobs kennt keine Gesamtzahl: wer ueber die Namen hinaus mitfaehrt, zaehlt als anonymer Gast.
                "anonymous_guests": .integer(anzahl.map { max(0, $0 - gaeste.count) } ?? 0),
                "trip_type": .string(istFlughafen ? "airport" : "normal"),
                "is_vip": .bool(ja(wert(zeile, "vip"))),
                "needs_child_seat": .bool(ja(wert(zeile, "kindersitz"))),
                "needs_accessibility": .bool(ja(wert(zeile, "rollstuhl"))),
                "needs_luggage": .bool(ja(gepaeck) || (parseInt(gepaeck) ?? 0) > 0),
                "note": json(wert(zeile, "notiz")),
                "status": .string("pending"),
                "driver_response_status": .string("pending"),
            ]
            if fehlt.isEmpty { fertig.append(satz) } else { unvollstaendig.append(Unvollstaendig(zeile: nr + 1, fehlt: fehlt)) }
        }
        return (fertig, unvollstaendig)
    }

    static func gaesteBauen(_ datenzeilen: [[String]], _ zuordnung: [Int: String]) -> (fertig: [Datensatz], unvollstaendig: [Unvollstaendig]) {
        let wert = leser(zuordnung)
        var fertig: [Datensatz] = []
        var unvollstaendig: [Unvollstaendig] = []
        for (nr, zeile) in datenzeilen.enumerated() {
            var vorname = wert(zeile, "vorname")
            var nachname = wert(zeile, "nachname")
            let voll = ersetzeErsten(wert(zeile, "vollname"), #"^(herr|frau|mr|mrs|ms|dr)\.?\s+"#, "", i: true)
            if !voll.isEmpty && vorname.isEmpty && nachname.isEmpty {
                let teile = voll.contains(",")
                    ? Array(voll.components(separatedBy: ",").map { $0.trimmingCharacters(in: .whitespaces) }.reversed())
                    : voll.components(separatedBy: .whitespaces).filter { !$0.isEmpty }
                nachname = teile.count > 1 ? teile[teile.count - 1] : (teile.first ?? "")
                vorname = teile.count > 1 ? teile.dropLast().joined(separator: " ") : ""
            }
            let vip = ja(wert(zeile, "vip"))
            let sprache = wert(zeile, "sprache")
            let satz: Datensatz = [
                "first_name": .string(vorname),
                "last_name": .string(nachname),
                "email": json(wert(zeile, "email")),
                "phone": json(wert(zeile, "telefon")),
                "company": json(wert(zeile, "firma")),
                "street": json(wert(zeile, "strasse")),
                "zip": json(wert(zeile, "plz")),
                "city": json(wert(zeile, "stadt")),
                "language": .string(sprache.isEmpty ? "Deutsch" : sprache),
                "notes": json(wert(zeile, "notiz")),
                "is_vip": .bool(vip),
                "vip_status": .bool(vip),
            ]
            if vorname.isEmpty && nachname.isEmpty { unvollstaendig.append(Unvollstaendig(zeile: nr + 1, fehlt: ["name"])) }
            else { fertig.append(satz) }
        }
        return (fertig, unvollstaendig)
    }

    // MARK: Import in die Datenbank

    private struct NeueID: Decodable { let id: UUID }

    /// handleApply: Fahrten nach jobs (Notizen danach in job_notes), Fahrgaeste nach guests.
    static func importieren(_ saetze: [Datensatz], _ modus: Modus) async throws {
        let c = Backend.client
        if modus == .fahrten {
            let zeilen = saetze.map { s -> Datensatz in var z = s; z.removeValue(forKey: "note"); return z }
            let neu: [NeueID] = try await c.from("jobs").insert(zeilen).select("id").execute().value
            let notizen: [[String: AnyJSON]] = saetze.enumerated().compactMap { i, s in
                guard i < neu.count, case let .string(n)? = s["note"] else { return nil }
                let t = n.trimmingCharacters(in: .whitespacesAndNewlines)
                return t.isEmpty ? nil : ["job_id": .string(neu[i].id.uuidString.lowercased()), "note_text": .string(t)]
            }
            if !notizen.isEmpty { try await c.from("job_notes").insert(notizen).execute() }
        } else {
            try await c.from("guests").insert(saetze).execute()
        }
    }
}
