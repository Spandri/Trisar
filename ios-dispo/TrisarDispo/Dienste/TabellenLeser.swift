import Compression
import Foundation

/// Liest eine Tabelle (CSV/TSV/TXT oder XLSX) in Zeilen aus Texten, wie tabelleLesen in
/// admin/src/services/spaltenErkennung.js. Das Web nutzt dafuer SheetJS, hier eigener kleiner Leser:
/// CSV mit erkanntem Trennzeichen, XLSX als ZIP mit erstem Blatt. Altes .xls (Binaerformat) geht nicht.
enum TabellenLeser {
    enum Fehler: LocalizedError {
        case format(String)
        var errorDescription: String? { if case let .format(s) = self { return s }; return nil }
    }

    static func lesen(_ url: URL) throws -> [[String]] {
        let name = url.lastPathComponent.lowercased()
        let daten = try Data(contentsOf: url)
        if name.hasSuffix(".xlsx") || name.hasSuffix(".xlsm") || daten.starts(with: [0x50, 0x4B, 0x03, 0x04]) {
            return try XLSX.zeilen(daten)
        }
        if name.hasSuffix(".xls") { throw Fehler.format("Altes Excel-Format (.xls) wird nicht unterstützt. Bitte als .xlsx oder .csv speichern.") }
        let inhalt = String(data: daten, encoding: .utf8) ?? String(data: daten, encoding: .windowsCP1252) ?? ""
        return ausText(inhalt)
    }

    // MARK: CSV

    /// tabelleAusText: BOM weg, Trennzeichen aus den ersten sechs Zeilen, Werte unveraendert.
    static func ausText(_ roh: String) -> [[String]] {
        let inhalt = roh.hasPrefix("\u{FEFF}") ? String(roh.dropFirst()) : roh
        let sep = trennzeichen(inhalt)
        var zeilen: [[String]] = []
        var zeile: [String] = []
        var feld = ""
        var inAnf = false
        var zeichen = Array(inhalt)
        if zeichen.last != "\n" { zeichen.append("\n") }
        var i = 0
        while i < zeichen.count {
            let c = zeichen[i]
            if inAnf {
                if c == "\"" {
                    if i + 1 < zeichen.count, zeichen[i + 1] == "\"" { feld.append("\""); i += 1 } else { inAnf = false }
                } else { feld.append(c) }
            } else if c == "\"" && feld.isEmpty {
                inAnf = true
            } else if c == sep {
                zeile.append(feld); feld = ""
            } else if c == "\n" || c == "\r\n" || c == "\r" {
                zeile.append(feld); feld = ""
                // blankrows: false wie im Web
                if zeile.contains(where: { !$0.trimmingCharacters(in: .whitespaces).isEmpty }) { zeilen.append(zeile) }
                zeile = []
            } else {
                feld.append(c)
            }
            i += 1
        }
        return zeilen
    }

    private static func trennzeichen(_ inhalt: String) -> Character {
        let zeilen = inhalt.components(separatedBy: .newlines).filter { !$0.trimmingCharacters(in: .whitespaces).isEmpty }.prefix(6)
        var bestes: (Character, Int) = (";", 0)
        for sep in [";", ",", "\t", "|"] as [Character] {
            let n = zeilen.reduce(0) { $0 + $1.filter { $0 == sep }.count }
            if n > bestes.1 { bestes = (sep, n) }
        }
        return bestes.1 > 0 ? bestes.0 : ";"
    }

    // MARK: XLSX

    private enum XLSX {
        static func zeilen(_ daten: Data) throws -> [[String]] {
            let zip = try ZipArchiv(daten)
            let teilen = zip.datei("xl/sharedStrings.xml").map(GeteilteTexte.lesen) ?? []
            let stile = zip.datei("xl/styles.xml").map(Stile.lesen) ?? Stile()
            guard let blatt = zip.datei(erstesBlatt(zip)) ?? zip.datei("xl/worksheets/sheet1.xml") else {
                throw Fehler.format("Kein Tabellenblatt gefunden.")
            }
            return BlattLeser.lesen(blatt, texte: teilen, stile: stile)
        }

        /// Pfad des ersten Blatts aus workbook.xml + Beziehungen.
        private static func erstesBlatt(_ zip: ZipArchiv) -> String {
            guard let mappe = zip.datei("xl/workbook.xml"), let rels = zip.datei("xl/_rels/workbook.xml.rels") else { return "" }
            let blaetter = XMLElemente.sammeln(mappe, name: "sheet")
            guard let rid = blaetter.first?.first(where: { $0.key.hasSuffix("id") && $0.key != "sheetId" })?.value else { return "" }
            let ziel = XMLElemente.sammeln(rels, name: "Relationship").first { $0["Id"] == rid }?["Target"] ?? ""
            if ziel.hasPrefix("/") { return String(ziel.dropFirst()) }
            return "xl/" + ziel
        }
    }
}

// MARK: - ZIP

/// Minimaler ZIP-Leser: Zentralverzeichnis, Methode 0 (gespeichert) und 8 (Deflate).
private struct ZipArchiv {
    private let daten: Data
    private var eintraege: [String: (methode: UInt16, gepackt: Int, entpackt: Int, versatz: Int)] = [:]

    init(_ d: Data) throws {
        daten = Data(d)
        func u16(_ o: Int) -> Int { Int(daten[o]) | Int(daten[o + 1]) << 8 }
        func u32(_ o: Int) -> Int { u16(o) | u16(o + 2) << 16 }
        // Ende des Zentralverzeichnisses rueckwaerts suchen.
        var ende = -1
        var o = daten.count - 22
        while o >= max(0, daten.count - 22 - 65535) {
            if u32(o) == 0x0605_4B50 { ende = o; break }
            o -= 1
        }
        guard ende >= 0 else { throw TabellenLeser.Fehler.format("Datei ist keine gültige Excel-Datei.") }
        let anzahl = u16(ende + 10)
        var p = u32(ende + 16)
        for _ in 0 ..< anzahl {
            guard p + 46 <= daten.count, u32(p) == 0x0201_4B50 else { break }
            let methode = UInt16(u16(p + 10))
            let gepackt = u32(p + 20), entpackt = u32(p + 24)
            let nLaenge = u16(p + 28), extra = u16(p + 30), kommentar = u16(p + 32)
            let versatz = u32(p + 42)
            let name = String(decoding: daten[(p + 46) ..< (p + 46 + nLaenge)], as: UTF8.self)
            eintraege[name] = (methode, gepackt, entpackt, versatz)
            p += 46 + nLaenge + extra + kommentar
        }
    }

    func datei(_ name: String) -> Data? {
        guard let e = eintraege[name], e.versatz + 30 <= daten.count else { return nil }
        let o = e.versatz
        let nLaenge = Int(daten[o + 26]) | Int(daten[o + 27]) << 8
        let extra = Int(daten[o + 28]) | Int(daten[o + 29]) << 8
        let start = o + 30 + nLaenge + extra
        guard start + e.gepackt <= daten.count else { return nil }
        let roh = daten[start ..< (start + e.gepackt)]
        if e.methode == 0 { return Data(roh) }
        guard e.methode == 8, e.entpackt > 0 else { return nil }
        var ziel = Data(count: e.entpackt)
        let n = ziel.withUnsafeMutableBytes { z in
            roh.withUnsafeBytes { q in
                compression_decode_buffer(z.bindMemory(to: UInt8.self).baseAddress!, e.entpackt,
                                          q.bindMemory(to: UInt8.self).baseAddress!, e.gepackt, nil, COMPRESSION_ZLIB)
            }
        }
        return n == e.entpackt ? ziel : nil
    }
}

// MARK: - XML

/// Sammelt die Attribute aller Elemente mit einem Namen.
private final class XMLElemente: NSObject, XMLParserDelegate {
    private let name: String
    private var treffer: [[String: String]] = []
    private init(_ n: String) { name = n }

    static func sammeln(_ d: Data, name: String) -> [[String: String]] {
        let s = XMLElemente(name)
        let p = XMLParser(data: d)
        p.delegate = s
        p.parse()
        return s.treffer
    }

    func parser(_ parser: XMLParser, didStartElement e: String, namespaceURI: String?, qualifiedName: String?, attributes: [String: String]) {
        if lokal(e) == name { treffer.append(attributes.reduce(into: [:]) { $0[lokal($1.key)] = $1.value }) }
    }
}

private func lokal(_ n: String) -> String { n.split(separator: ":").last.map(String.init) ?? n }

/// sharedStrings.xml: jedes <si> ein Text, Runs (<r><t>) aneinandergehaengt, Lautschrift (<rPh>) ignoriert.
private final class GeteilteTexte: NSObject, XMLParserDelegate {
    private var liste: [String] = []
    private var aktuell = ""
    private var inT = false
    private var inPh = false

    static func lesen(_ d: Data) -> [String] {
        let s = GeteilteTexte()
        let p = XMLParser(data: d)
        p.delegate = s
        p.parse()
        return s.liste
    }

    func parser(_ parser: XMLParser, didStartElement e: String, namespaceURI: String?, qualifiedName: String?, attributes: [String: String]) {
        switch lokal(e) {
        case "si": aktuell = ""
        case "t": inT = true
        case "rPh": inPh = true
        default: break
        }
    }

    func parser(_ parser: XMLParser, didEndElement e: String, namespaceURI: String?, qualifiedName: String?) {
        switch lokal(e) {
        case "si": liste.append(aktuell)
        case "t": inT = false
        case "rPh": inPh = false
        default: break
        }
    }

    func parser(_ parser: XMLParser, foundCharacters s: String) { if inT && !inPh { aktuell += s } }
}

/// styles.xml: welche Stil-Nummer ein Datum/eine Uhrzeit ist.
private struct Stile {
    /// Index in cellXfs -> (hatDatum, hatZeit)
    var art: [Int: (datum: Bool, zeit: Bool)] = [:]

    static func lesen(_ d: Data) -> Stile {
        let s = StilParser()
        let p = XMLParser(data: d)
        p.delegate = s
        p.parse()
        var stile = Stile()
        for (i, id) in s.xfs.enumerated() {
            if let a = eingebaut(id) { stile.art[i] = a; continue }
            if let code = s.formate[id], let a = ausCode(code) { stile.art[i] = a }
        }
        return stile
    }

    private static func eingebaut(_ id: Int) -> (datum: Bool, zeit: Bool)? {
        switch id {
        case 14 ... 17, 27 ... 31, 34 ... 36, 50 ... 58: return (true, false)
        case 18 ... 21, 32, 33, 45 ... 47: return (false, true)
        case 22: return (true, true)
        default: return nil
        }
    }

    /// Eigenes Format: Text in Anfuehrungszeichen und [..] weg, dann nach y/d bzw. h/s suchen.
    private static func ausCode(_ code: String) -> (datum: Bool, zeit: Bool)? {
        let rein = code.replacingOccurrences(of: #""[^"]*"|\[[^\]]*\]|\\."#, with: "", options: .regularExpression).lowercased()
        let datum = rein.contains("y") || rein.contains("d")
        let zeit = rein.contains("h") || rein.contains("s")
        return datum || zeit ? (datum, zeit) : nil
    }

    private final class StilParser: NSObject, XMLParserDelegate {
        var formate: [Int: String] = [:]
        var xfs: [Int] = []
        private var inCellXfs = false
        func parser(_ parser: XMLParser, didStartElement e: String, namespaceURI: String?, qualifiedName: String?, attributes a: [String: String]) {
            switch lokal(e) {
            case "numFmt": if let id = a["numFmtId"].flatMap(Int.init) { formate[id] = a["formatCode"] ?? "" }
            case "cellXfs": inCellXfs = true
            case "xf": if inCellXfs { xfs.append(a["numFmtId"].flatMap(Int.init) ?? 0) }
            default: break
            }
        }
        func parser(_ parser: XMLParser, didEndElement e: String, namespaceURI: String?, qualifiedName: String?) {
            if lokal(e) == "cellXfs" { inCellXfs = false }
        }
    }
}

/// Blatt lesen: Zellen nach Zeile/Spalte, Texte aufgeloest, Datumszahlen als Text
/// (yyyy-MM-dd, HH:mm), damit die Erkennung sie wie im Web als Datum/Uhrzeit liest.
private final class BlattLeser: NSObject, XMLParserDelegate {
    private let texte: [String]
    private let stile: Stile
    private var zellen: [Int: [Int: String]] = [:]
    private var zeile = 0
    private var spalte = 0
    private var typ = ""
    private var stil = 0
    private var wert = ""
    private var inWert = false

    private init(_ t: [String], _ s: Stile) { texte = t; stile = s }

    static func lesen(_ d: Data, texte: [String], stile: Stile) -> [[String]] {
        let s = BlattLeser(texte, stile)
        let p = XMLParser(data: d)
        p.delegate = s
        p.parse()
        guard let maxZeile = s.zellen.keys.max() else { return [] }
        var aus: [[String]] = []
        for z in 0 ... maxZeile {
            guard let reihe = s.zellen[z], let breite = reihe.keys.max() else { continue }
            let werte = (0 ... breite).map { reihe[$0] ?? "" }
            if werte.contains(where: { !$0.trimmingCharacters(in: .whitespaces).isEmpty }) { aus.append(werte) }
        }
        return aus
    }

    func parser(_ parser: XMLParser, didStartElement e: String, namespaceURI: String?, qualifiedName: String?, attributes a: [String: String]) {
        switch lokal(e) {
        case "row":
            if let r = a["r"].flatMap(Int.init) { zeile = r - 1 } else { zeile += 1 }
            spalte = -1
        case "c":
            if let r = a["r"] { spalte = Self.spaltenIndex(r) } else { spalte += 1 }
            typ = a["t"] ?? "n"
            stil = a["s"].flatMap(Int.init) ?? 0
            wert = ""
        case "v", "t": inWert = true
        default: break
        }
    }

    func parser(_ parser: XMLParser, didEndElement e: String, namespaceURI: String?, qualifiedName: String?) {
        switch lokal(e) {
        case "v", "t": inWert = false
        case "c":
            let text: String
            switch typ {
            case "s": text = Int(wert).flatMap { $0 < texte.count ? texte[$0] : nil } ?? ""
            case "b": text = wert == "1" ? "TRUE" : "FALSE"
            case "str", "inlineStr", "e": text = wert
            default: text = zahl(wert)
            }
            if !text.isEmpty { zellen[zeile, default: [:]][spalte] = text }
        default: break
        }
    }

    func parser(_ parser: XMLParser, foundCharacters s: String) { if inWert { wert += s } }

    private func zahl(_ roh: String) -> String {
        guard let d = Double(roh) else { return roh }
        if let a = stile.art[stil] {
            // Excel-Seriennummer: Tage seit 30.12.1899.
            let sek = (d * 86400).rounded()
            let datum = Date(timeIntervalSince1970: sek - 2_209_161_600)
            var kal = Calendar(identifier: .gregorian)
            kal.timeZone = TimeZone(identifier: "UTC")!
            let k = kal.dateComponents([.year, .month, .day, .hour, .minute], from: datum)
            let p2 = { (n: Int?) in String(format: "%02d", n ?? 0) }
            let tag = "\(k.year ?? 1900)-\(p2(k.month))-\(p2(k.day))"
            let uhr = "\(p2(k.hour)):\(p2(k.minute))"
            if a.datum && a.zeit { return "\(tag) \(uhr)" }
            return a.datum ? tag : uhr
        }
        if d == d.rounded(), abs(d) < 1e15 { return String(Int64(d)) }
        return String(d)
    }

    private static func spaltenIndex(_ ref: String) -> Int {
        var n = 0
        for c in ref.uppercased() {
            guard let a = c.asciiValue, a >= 65, a <= 90 else { break }
            n = n * 26 + Int(a - 64)
        }
        return n - 1
    }
}
