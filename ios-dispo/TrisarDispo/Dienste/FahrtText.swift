import Foundation

/// Text-Hilfen aus admin/src/App.jsx (normalizeLocation, normalizeClockValue, ...),
/// damit Formular und Speichern genau dieselben Werte erzeugen wie das Web.
enum FahrtText {
    static func getrimmt(_ s: String) -> String { s.trimmingCharacters(in: .whitespacesAndNewlines) }

    /// normalizeLocation: klein, ohne Akzente, ae/oe/ue -> a/o/u, nur a-z0-9 und Leerzeichen.
    static func ortNormal(_ wert: String) -> String {
        var s = wert.lowercased().decomposedStringWithCanonicalMapping
        s = String(String.UnicodeScalarView(s.unicodeScalars.filter { !(0x300...0x36F).contains($0.value) }))
        s = s.replacingOccurrences(of: "ß", with: "ss")
            .replacingOccurrences(of: "ae", with: "a")
            .replacingOccurrences(of: "oe", with: "o")
            .replacingOccurrences(of: "ue", with: "u")
            .replacingOccurrences(of: "[^a-z0-9]+", with: " ", options: .regularExpression)
            .replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
        return getrimmt(s)
    }

    /// vergleichbar aus FahrerAutocomplete/FahrgastAutocomplete (fuer die Vorschlagsliste).
    static func vergleichbar(_ wert: String) -> String {
        var s = getrimmt(wert).lowercased().decomposedStringWithCompatibilityMapping
        s = String(String.UnicodeScalarView(s.unicodeScalars.filter { !(0x300...0x36F).contains($0.value) }))
        return s.replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
    }

    private static func treffer(_ text: String, _ muster: String) -> [String]? {
        guard let re = try? NSRegularExpression(pattern: muster),
              let m = re.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)) else { return nil }
        return (0..<m.numberOfRanges).map { i in
            guard let r = Range(m.range(at: i), in: text) else { return "" }
            return String(text[r])
        }
    }

    /// normalizeClockValue: "H:MM..." -> "HH:MM", sonst Rueckfall.
    static func uhrzeit(_ wert: String?, _ rueckfall: String = "") -> String {
        let text = getrimmt(wert ?? "")
        guard let t = treffer(text, #"^(\d{1,2}):(\d{2})"#), let h = Int(t[1]), let m = Int(t[2]),
              (0...23).contains(h), (0...59).contains(m) else { return rueckfall }
        return String(format: "%02d:%02d", h, m)
    }

    /// normalizeRideDateValue: yyyy-MM-dd, dd.MM.yyyy oder ISO mit Zeit.
    static func fahrtDatum(_ wert: String?, _ rueckfall: String = "") -> String {
        let raw = getrimmt(wert ?? "")
        if raw.isEmpty { return rueckfall }
        if treffer(raw, #"^\d{4}-\d{2}-\d{2}$"#) != nil { return raw }
        if let t = treffer(raw, #"^(\d{2})\.(\d{2})\.(\d{4})$"#) { return "\(t[3])-\(t[2])-\(t[1])" }
        if treffer(raw, #"^\d{4}-\d{2}-\d{2}T"#) != nil { return String(raw.prefix(10)) }
        return rueckfall
    }

    /// extractClockFromIsoLike
    static func uhrAusISO(_ wert: String?) -> String {
        let text = getrimmt(wert ?? "")
        if text.isEmpty { return "" }
        if let t = treffer(text, #"T(\d{2}:\d{2})"#) { return t[1] }
        return uhrzeit(text, "")
    }

    /// mapJobStatusToEditorStatus
    static func editorStatus(_ jobStatus: String?) -> String {
        // Alle Schreibweisen, die jobs.status erlaubt (jobs_status_check), nicht nur die englischen Grundwerte.
        switch getrimmt(jobStatus ?? "").lowercased() {
        case "in_progress", "unterwegs", "started", "on_trip", "ongoing", "active": return "unterwegs"
        case "done", "completed", "arrived", "beendet": return "beendet"
        case "cancelled", "canceled", "refused", "storniert", "stoniert", "archived": return "stoniert"
        default: return "offen"
        }
    }

    /// mapEditorStatusToJobStatus
    static func jobStatus(_ editorStatus: String?) -> String {
        switch getrimmt(editorStatus ?? "").lowercased() {
        case "unterwegs": return "in_progress"
        case "beendet": return "done"
        case "stoniert": return "cancelled"
        default: return "pending"
        }
    }

    /// normalizeFlightNumberValue / normalizeTrainNumberValue
    static func nummer(_ wert: String?) -> String {
        getrimmt((wert ?? "").replacingOccurrences(of: "\\s+", with: "", options: .regularExpression).uppercased())
    }

    static func flugnummerGueltig(_ wert: String) -> Bool {
        treffer(nummer(wert), #"^[A-Z0-9]{2,3}\d{1,4}[A-Z]?$"#) != nil
    }

    static func zugnummerGueltig(_ wert: String) -> Bool {
        let n = nummer(wert)
        return (2...12).contains(n.count) && n.contains(where: \.isNumber)
    }

    /// splitGuestNames
    static func gaesteTeilen(_ wert: String?) -> [String] {
        (wert ?? "").components(separatedBy: CharacterSet(charactersIn: "\n,;"))
            .map(getrimmt).filter { !$0.isEmpty }
    }

    /// normalizeDriverNameList: getrimmt, ohne Leere, ohne Doppelte (Reihenfolge bleibt).
    static func fahrerNamenListe(_ werte: [String]) -> [String] {
        var gesehen = Set<String>()
        return werte.map(getrimmt).filter { !$0.isEmpty && gesehen.insert($0).inserted }
    }

    /// extractDriverNumberToken
    static func nummernTeil(_ wert: String) -> String {
        treffer(wert, #"\d+"#)?.first ?? ""
    }

    /// formatDriverNameWithNumber
    static func fahrerBeschriftung(name: String, nummer: String) -> String {
        let n = getrimmt(name), d = getrimmt(nummer)
        if !n.isEmpty && !d.isEmpty { return "\(n) (\(d))" }
        return n.isEmpty ? d : n
    }

    static func name(_ vor: String?, _ nach: String?) -> String {
        [vor, nach].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " ").trimmingCharacters(in: .whitespaces)
    }

    /// Heute als yyyy-MM-dd in lokaler Zeit (TODAY_ISO_DATE).
    static func heute() -> String { Datum.tagWert(Date()) }

    static func jetztUhr() -> String {
        let k = Calendar.current.dateComponents([.hour, .minute], from: Date())
        return String(format: "%02d:%02d", k.hour ?? 0, k.minute ?? 0)
    }

    static func minuten(_ uhr: String) -> Int? {
        guard let t = treffer(getrimmt(uhr), #"^(\d{1,2}):(\d{2})"#), let h = Int(t[1]), let m = Int(t[2]),
              (0...23).contains(h), (0...59).contains(m) else { return nil }
        return h * 60 + m
    }

    /// Flughafen-Code aus einer Ortsangabe (resolveAirportCodeFromLocation).
    private static let iataCodes: Set<String> = [
        "MUC", "FRA", "BER", "HAM", "DUS", "STR", "CGN", "LEJ", "NUE", "HAJ", "BRE", "DRS",
        "VIE", "ZRH", "GVA", "BRU", "LUX", "PRG", "WAW", "MAD", "BCN", "CDG", "AMS", "LHR",
    ]
    private static let flughafenWoerter: [(String, String)] = [
        ("muenchen", "MUC"), ("munchen", "MUC"), ("münchen", "MUC"), ("frankfurt", "FRA"),
        ("berlin brandenburg", "BER"), ("hamburg", "HAM"), ("duesseldorf", "DUS"), ("düsseldorf", "DUS"),
        ("stuttgart", "STR"), ("koeln", "CGN"), ("köln", "CGN"), ("vienna", "VIE"), ("wien", "VIE"),
        ("zurich", "ZRH"), ("zuerich", "ZRH"), ("zürich", "ZRH"), ("brussels", "BRU"), ("bruessel", "BRU"),
        ("brüssel", "BRU"), ("luxembourg", "LUX"),
    ]

    static func flughafenCode(_ wert: String) -> String {
        let raw = getrimmt(wert)
        if raw.isEmpty { return "" }
        let gross = raw.uppercased()
        if let t = treffer(gross, #"\(([A-Z]{3})\)"#), iataCodes.contains(t[1]) { return t[1] }
        if let re = try? NSRegularExpression(pattern: #"\b[A-Z]{3}\b"#) {
            for m in re.matches(in: gross, range: NSRange(gross.startIndex..., in: gross)) {
                if let r = Range(m.range, in: gross), iataCodes.contains(String(gross[r])) { return String(gross[r]) }
            }
        }
        let normal = ortNormal(raw)
        for (wort, code) in flughafenWoerter where normal.contains(wort) { return code }
        return ""
    }

    /// i18n-Texte aus admin/src/i18n/de.js.
    static let t: [String: String] = [
        "fahrt.aktuellerStatus": "aktueller Status",
        "fahrt.anonymeGaeste": "Anonyme Gäste",
        "fahrt.anzahlFahrzeuge": "Anzahl Fahrzeuge",
        "fahrt.anzahlKinder": "Anzahl Kinder",
        "fahrt.arrivalLabel": "Ankunft {time}",
        "fahrt.fahrerNumbered": "Fahrer #{n}",
        "fahrt.flightNumbered": "Flug {n}",
        "fahrt.gastNumbered": "Gast #{n}",
        "fahrt.noFlightDataForDate": "Keine Flugdaten zum {date} – letzte bekannte Flüge:",
        "fahrt.saveError": "Fahrt konnte nicht gespeichert werden: {error}",
        "fahrt.cancelRide": "Fahrt stornieren",
        "fahrt.confirmCancelRide": "Fahrt wirklich stornieren und löschen?",
        "fahrt.createTitle": "Fahrt erstellen",
        "fahrt.datum": "Datum",
        "fahrt.editTitle": "Fahrt bearbeiten",
        "fahrt.fahrer": "Fahrer",
        "fahrt.fahrgaeste": "Fahrgäste",
        "fahrt.fillStartZiel": "Bitte Start und Ziel ausfüllen.",
        "fahrt.flightMissingEta": "Für diesen Flug fehlen ETA und Ankunftsort.",
        "fahrt.flugnummer": "Flugnummer",
        "fahrt.konvoi": "Konvoi",
        "fahrt.multipleFlightsFound": "Mehrere Flüge gefunden – bitte auswählen",
        "fahrt.notesPlaceholder": "Schreiben...",
        "fahrt.notizen": "Notizen",
        "fahrt.saving": "Speichern ...",
        "fahrt.start": "Start",
        "fahrt.startZeit": "Start Zeit",
        "fahrt.statusBeendet": "beendet",
        "fahrt.statusOffen": "offen",
        "fahrt.statusStoniert": "storniert",
        "fahrt.statusUnterwegs": "unterwegs",
        "fahrt.submitCreate": "Fahrt speichern",
        "fahrt.submitEdit": "Bearbeitung speichern",
        "fahrt.trainMissingEta": "Für diesen Zug fehlen ETA und Ankunftsort.",
        "fahrt.unknownError": "Unbekannter Fehler",
        "fahrt.ziel": "Ziel",
        "fahrt.zugnummer": "Zugnummer",
        "app.datumUngueltig": "Bitte ein gültiges Datum eingeben.",
        "app.fahrerNichtAufgeloest": "Diese Fahrer konnten nicht aufgelöst werden: {names}.",
        "app.fahrerNichtZugeordnet": "Fahrer konnte nicht zugeordnet werden: {names}. Bitte Fahrer aus der Vorschlagsliste wählen.",
        "app.fahrtStornierenFehler": "Fahrt konnte nicht storniert werden: {error}",
        "app.fahrtUpdateFehler": "Fahrt konnte nicht aktualisiert werden (keine Schreibrechte oder Fahrt nicht gefunden).",
        "app.flugDatumFehlt": "Bitte ein gültiges Datum eingeben, damit der Flug geprüft werden kann.",
        "app.flugNichtValidierbar": "Flug nicht validierbar.",
        "app.flugValidierungFehler": "Flug konnte nicht validiert werden.",
        "app.flugpruefungFehlgeschlagen": "Flugprüfung fehlgeschlagen: {error}",
        "app.mehrereZuegeGefunden": "Mehrere passende Züge gefunden. Bitte Zugnummer präzisieren.",
        "app.nurFlugOderZug": "Bitte nur Flugnummer oder Zugnummer ausfüllen.",
        "app.startZielFehlt": "Bitte Start und Ziel ausfüllen.",
        "app.unbekannterFehler": "Unbekannter Fehler",
        "app.ungueltigeFahrtId": "Ungültige Fahrt-ID.",
        "app.ungueltigeFlugnummer": "Ungültige Flugnummer. Bitte z. B. LH1625 eingeben.",
        "app.ungueltigeZugnummer": "Ungültige Zugnummer. Bitte z. B. ICE515 oder RE1 eingeben.",
        "app.zugDatumFehlt": "Bitte ein gültiges Datum eingeben, damit der Zug geprüft werden kann.",
        "app.zugNichtValidierbar": "Zug nicht validierbar.",
        "app.zugValidierungFehler": "Zug konnte nicht validiert werden.",
        "app.zugpruefungFehlgeschlagen": "Zugprüfung fehlgeschlagen: {error}",
    ]

    static func tr(_ schluessel: String, _ werte: [String: String] = [:]) -> String {
        var s = t[schluessel] ?? schluessel
        for (k, v) in werte { s = s.replacingOccurrences(of: "{\(k)}", with: v) }
        return s
    }
}
