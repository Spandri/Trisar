import Foundation
import Supabase

/// Edge-Functions und Adresssuche wie in admin/src/App.jsx:
/// places-proxy (dann OpenStreetMap, dann feste Liste), flight-validate, train-validate, external-sync.
enum FahrtPruefung {

    // MARK: Aufruf

    struct AufrufFehler: Error {
        let text: String
        /// isTemporaryInvokeError: im Web liefert jeder Nicht-2xx-Status
        /// "Edge Function returned a non-2xx status code" und gilt damit als voruebergehend.
        let voruebergehend: Bool
        let status: Int?
    }

    static func aufrufen(_ name: String, _ body: [String: AnyJSON]) async -> Result<AnyJSON, AufrufFehler> {
        do {
            let antwort: AnyJSON = try await Backend.client.functions.invoke(name, options: FunctionInvokeOptions(body: body))
            return .success(antwort)
        } catch let FunctionsError.httpError(code, _) {
            return .failure(AufrufFehler(text: "Edge Function returned a non-2xx status code", voruebergehend: true, status: code))
        } catch {
            return .failure(AufrufFehler(text: error.localizedDescription, voruebergehend: false, status: nil))
        }
    }

    // MARK: Adressvorschlaege (handleFetchPlaceSuggestions)

    private static let festeOrte = [
        "Flughafen München (MUC), Nordallee, München-Flughafen, Deutschland",
        "Flughafen Hamburg (HAM), Flughafenstraße, Hamburg, Deutschland",
        "Flughafen Berlin Brandenburg (BER), Willy-Brandt-Platz, Schönefeld, Deutschland",
        "Flughafen Frankfurt am Main (FRA), Frankfurt am Main, Deutschland",
        "Flughafen Stuttgart (STR), Flughafenstraße, Stuttgart, Deutschland",
        "Flughafen Düsseldorf (DUS), Flughafenstraße, Düsseldorf, Deutschland",
        "Hauptbahnhof München, Bayerstraße, München, Deutschland",
        "Hauptbahnhof Hamburg, Hachmannplatz, Hamburg, Deutschland",
        "Hauptbahnhof Berlin, Europaplatz, Berlin, Deutschland",
        "Hotel Bayerischer Hof, Promenadeplatz 2-6, München, Deutschland",
    ]

    private static func eindeutig(_ liste: [String]) -> [String] {
        var gesehen = Set<String>()
        return liste.filter { gesehen.insert($0).inserted }
    }

    private static func festeVorschlaege(_ eingabe: String) -> [String] {
        let q = FahrtText.ortNormal(eingabe)
        if q.isEmpty { return [] }
        return Array(festeOrte.filter { FahrtText.ortNormal($0).contains(q) }.prefix(8))
    }

    /// Vor dem Speichern: Hinweis, wenn eine Adresse fehlt oder nicht zur Fahrt passt, sonst leer.
    static func adressWarnung(_ adressen: [String]) async -> String {
        let liste = adressen.map(FahrtText.getrimmt).filter { !$0.isEmpty }
        guard case let .success(daten) = await aufrufen("places-proxy", [
            "aktion": .string("adressen_pruefen"), "adressen": .array(liste.map(AnyJSON.string)),
        ]) else { return "" }
        let warnungen = daten.objectValue?["warnungen"]?.arrayValue ?? []
        return warnungen.compactMap { w -> String? in
            guard let o = w.objectValue, let adresse = o["adresse"]?.stringValue else { return nil }
            switch o["grund"]?.stringValue {
            case "nicht_gefunden": return FahrtText.tr("fahrt.adresseNichtGefunden", ["adresse": adresse])
            case "weit_weg":
                let km = o["km"]?.doubleValue.map { String(Int($0)) } ?? o["km"]?.intValue.map(String.init) ?? "?"
                return FahrtText.tr("fahrt.adresseWeitWeg", ["adresse": adresse, "km": km])
            default: return FahrtText.tr("fahrt.adresseOhneStadt", ["adresse": adresse])
            }
        }.joined(separator: "\n")
    }

    static func ortsVorschlaege(_ eingabe: String) async -> [String] {
        let text = FahrtText.getrimmt(eingabe)
        if text.isEmpty { return [] }
        if case let .success(daten) = await aufrufen("places-proxy", ["input": .string(text), "country": "de"]) {
            let treffer = (daten.objectValue?["predictions"]?.arrayValue ?? [])
                .compactMap { $0.objectValue?["description"]?.stringValue }
                .map(FahrtText.getrimmt).filter { !$0.isEmpty }
            let api = Array(eindeutig(treffer).prefix(8))
            if !api.isEmpty { return api }
        }
        let osm = await osmVorschlaege(text)
        if !osm.isEmpty { return osm }
        return festeVorschlaege(text)
    }

    /// fetchOsmPlaceSuggestions + formatOsmEntry: "Name, Strasse Nr, Ort".
    private static func osmVorschlaege(_ text: String) async -> [String] {
        var teile = URLComponents(string: "https://nominatim.openstreetmap.org/search")!
        teile.queryItems = [.init(name: "format", value: "jsonv2"), .init(name: "limit", value: "8"),
                            .init(name: "addressdetails", value: "1"), .init(name: "q", value: text)]
        var anfrage = URLRequest(url: teile.url!)
        anfrage.setValue("application/json", forHTTPHeaderField: "Accept")
        // Nominatim verlangt eine Kennung der App.
        anfrage.setValue("TRISAR-Dispo-iOS/0.1", forHTTPHeaderField: "User-Agent")
        guard let (daten, antwort) = try? await URLSession.shared.data(for: anfrage),
              (antwort as? HTTPURLResponse)?.statusCode == 200,
              let liste = try? JSONDecoder().decode([AnyJSON].self, from: daten) else { return [] }
        let namen = liste.compactMap { eintrag -> String? in
            guard let e = eintrag.objectValue else { return nil }
            let a = e["address"]?.objectValue ?? [:]
            func w(_ k: String) -> String { a[k]?.stringValue ?? "" }
            let strasse = [w("road"), w("pedestrian"), w("footway"), w("path"), w("square")].first { !$0.isEmpty } ?? ""
            let nr = w("house_number")
            let ort = [w("city"), w("town"), w("village"), w("municipality"), w("county")].first { !$0.isEmpty } ?? ""
            let strasseTeil = [strasse, nr].filter { !$0.isEmpty }.joined(separator: " ")
            let name = FahrtText.getrimmt(e["name"]?.stringValue ?? "")
            let nameIstAdresse = name.isEmpty || name == strasse || name == strasseTeil || name.first?.isNumber == true || name == ort
            let label = (nameIstAdresse ? [strasseTeil, ort] : [name, strasseTeil, ort]).filter { !$0.isEmpty }.joined(separator: ", ")
            let ergebnis = label.isEmpty ? FahrtText.getrimmt(e["display_name"]?.stringValue ?? "") : label
            return ergebnis.isEmpty ? nil : ergebnis
        }
        return Array(eindeutig(namen).prefix(8))
    }

    // MARK: Flug / Zug pruefen

    struct FlugKandidat: Equatable {
        let abflug: String
        let ankunft: String
        let ankunftGeplant: String
    }

    /// Ergebnis von validateFlightForDisplay / validateTrainForDisplay.
    struct Anzeige: Equatable {
        var status = "empty"
        var etaLabel = ""
        var gueltig = false
        var startOrt = ""
        var kandidaten: [FlugKandidat] = []
        static let leer = Anzeige()
    }

    /// Ergebnis von validateFlightForSave / validateTrainForSave.
    struct ZumSpeichern {
        var ok = true
        var gueltig = false
        var fehler: String?
        var daten: AnyJSON?
    }

    private static func flugAufruf(_ nummer: String, _ datum: String, _ hinweis: String, _ ankunft: String) async -> Result<AnyJSON, AufrufFehler> {
        let rohHinweis = FahrtText.getrimmt(hinweis).uppercased()
        var code = FahrtText.flughafenCode(hinweis)
        if code.isEmpty, rohHinweis.range(of: #"^[A-Z]{3}$"#, options: .regularExpression) != nil { code = rohHinweis }
        var body: [String: AnyJSON] = [
            "flight_number": .string(FahrtText.nummer(nummer)),
            "ride_date": .string(datum),
            "require_lufthansa_group": .bool(false),
        ]
        if !code.isEmpty { body["target_airport_iata"] = .string(code) }
        let geplant = FahrtText.getrimmt(ankunft)
        if !geplant.isEmpty { body["selected_arrival_scheduled"] = .string(geplant) }
        var ergebnis = await aufrufen("flight-validate", body)
        // shouldUseAdminFallbackForInvokeError: bei 5xx ein zweiter Versuch.
        if case let .failure(f) = ergebnis, (f.status ?? 0) >= 500 {
            ergebnis = await aufrufen("flight-validate", body)
        }
        return ergebnis
    }

    private static func zugAufruf(_ nummer: String, _ datum: String, _ hinweis: String) async -> Result<AnyJSON, AufrufFehler> {
        await aufrufen("train-validate", [
            "train_number": .string(FahrtText.nummer(nummer)),
            "ride_date": .string(datum),
            "target_station": .string(FahrtText.getrimmt(hinweis)),
        ])
    }

    private static func s(_ o: [String: AnyJSON]?, _ k: String) -> String {
        FahrtText.getrimmt(o?[k]?.stringValue ?? "")
    }

    static func flugAnzeige(_ nummer: String, datum: String, hinweis: String, ankunftGeplant: String) async -> Anzeige {
        let n = FahrtText.nummer(nummer)
        if n.isEmpty { return .leer }
        if !FahrtText.flugnummerGueltig(n) { return Anzeige(status: "invalid", etaLabel: "NaN") }
        let tag = FahrtText.fahrtDatum(datum)
        if tag.isEmpty { return Anzeige(status: "missing_date", etaLabel: "NaN") }
        switch await flugAufruf(n, tag, hinweis, ankunftGeplant) {
        case let .failure(f):
            return f.voruebergehend ? Anzeige(status: "unavailable", etaLabel: "Srv") : Anzeige(status: "error", etaLabel: "NaN")
        case let .success(daten):
            let d = daten.objectValue
            if s(d, "reason") == "multiple_matches" {
                let kandidaten = (d?["candidates"]?.arrayValue ?? []).map { k in
                    FlugKandidat(abflug: s(k.objectValue, "departure_airport"), ankunft: s(k.objectValue, "arrival_airport"),
                                 ankunftGeplant: s(k.objectValue, "scheduled_arrival_local"))
                }
                return Anzeige(status: "multi", etaLabel: "Multi", kandidaten: kandidaten)
            }
            if d?["valid"]?.boolValue != true {
                let ava = s(d, "provider") == "aviationstack" || !s(d, "fallback_reason").isEmpty
                return Anzeige(status: "invalid", etaLabel: ava ? "AVA" : "NaN")
            }
            let summary = d?["summary"]?.objectValue
            let eta = etaAusFlug(summary)
            let ort = ankunftsOrt(summary)
            if eta.isEmpty {
                return Anzeige(status: "unknown_eta", etaLabel: s(d, "provider") == "aviationstack" ? "AVA" : "NaN", gueltig: true, startOrt: ort)
            }
            return Anzeige(status: "ok", etaLabel: eta, gueltig: true, startOrt: ort)
        }
    }

    static func zugAnzeige(_ nummer: String, datum: String, hinweis: String) async -> Anzeige {
        let n = FahrtText.nummer(nummer)
        if n.isEmpty { return .leer }
        if !FahrtText.zugnummerGueltig(n) { return Anzeige(status: "invalid", etaLabel: "NaN") }
        let tag = FahrtText.fahrtDatum(datum)
        if tag.isEmpty { return Anzeige(status: "missing_date", etaLabel: "NaN") }
        switch await zugAufruf(n, tag, hinweis) {
        case .failure:
            return Anzeige(status: "error", etaLabel: "NaN")
        case let .success(daten):
            let d = daten.objectValue
            if s(d, "reason") == "multiple_matches" { return Anzeige(status: "multi", etaLabel: "Multi") }
            if d?["valid"]?.boolValue != true { return Anzeige(status: "invalid", etaLabel: "NaN") }
            let eta = s(d, "eta_label")
            let ort = s(d, "target_station")
            if eta.isEmpty { return Anzeige(status: "unknown_eta", etaLabel: "NaN", gueltig: true, startOrt: ort) }
            return Anzeige(status: "ok", etaLabel: eta, gueltig: true, startOrt: ort)
        }
    }

    static func flugZumSpeichern(_ nummer: String, datum: String, hinweis: String, ankunftGeplant: String) async -> ZumSpeichern {
        let n = FahrtText.nummer(nummer)
        if n.isEmpty { return ZumSpeichern() }
        if !FahrtText.flugnummerGueltig(n) { return ZumSpeichern(ok: false, fehler: FahrtText.tr("app.ungueltigeFlugnummer")) }
        let tag = FahrtText.fahrtDatum(datum)
        if tag.isEmpty { return ZumSpeichern(ok: false, fehler: FahrtText.tr("app.flugDatumFehlt")) }
        switch await flugAufruf(n, tag, hinweis, ankunftGeplant) {
        case let .failure(f):
            // Flugdienst gerade nicht erreichbar: Fahrt ohne Flugnummer speichern wie im Web.
            if f.voruebergehend { return ZumSpeichern() }
            return ZumSpeichern(ok: false, fehler: FahrtText.tr("app.flugpruefungFehlgeschlagen", ["error": f.text]))
        case let .success(daten):
            if daten.objectValue?["valid"]?.boolValue != true {
                let text = s(daten.objectValue, "message")
                return ZumSpeichern(ok: false, fehler: text.isEmpty ? FahrtText.tr("app.flugNichtValidierbar") : text)
            }
            return ZumSpeichern(gueltig: true, daten: daten)
        }
    }

    static func zugZumSpeichern(_ nummer: String, datum: String, hinweis: String) async -> ZumSpeichern {
        let n = FahrtText.nummer(nummer)
        if n.isEmpty { return ZumSpeichern() }
        if !FahrtText.zugnummerGueltig(n) { return ZumSpeichern(ok: false, fehler: FahrtText.tr("app.ungueltigeZugnummer")) }
        let tag = FahrtText.fahrtDatum(datum)
        if tag.isEmpty { return ZumSpeichern(ok: false, fehler: FahrtText.tr("app.zugDatumFehlt")) }
        switch await zugAufruf(n, tag, hinweis) {
        case let .failure(f):
            return ZumSpeichern(ok: false, fehler: FahrtText.tr("app.zugpruefungFehlgeschlagen", ["error": f.text]))
        case let .success(daten):
            let d = daten.objectValue
            if s(d, "reason") == "multiple_matches" { return ZumSpeichern(ok: false, fehler: FahrtText.tr("app.mehrereZuegeGefunden")) }
            if d?["valid"]?.boolValue != true {
                let text = s(d, "message")
                return ZumSpeichern(ok: false, fehler: text.isEmpty ? FahrtText.tr("app.zugNichtValidierbar") : text)
            }
            return ZumSpeichern(gueltig: true, daten: daten)
        }
    }

    /// extractEtaFromFlightSummary
    private static func etaAusFlug(_ summary: [String: AnyJSON]?) -> String {
        let roh = [s(summary, "estimated_arrival_local"), s(summary, "actual_arrival_local"), s(summary, "scheduled_arrival_local")]
            .first { !$0.isEmpty } ?? ""
        if roh.isEmpty { return "" }
        if let r = roh.range(of: #"T\d{2}:\d{2}"#, options: .regularExpression) {
            return String(roh[r].dropFirst())
        }
        if let r = roh.range(of: #"^\d{1,2}:\d{2}"#, options: .regularExpression) {
            return FahrtText.uhrzeit(String(roh[r]), "")
        }
        return ""
    }

    /// extractArrivalLocationFromFlightSummary
    private static func ankunftsOrt(_ summary: [String: AnyJSON]?) -> String {
        let flughafen = s(summary, "arrival_airport"), terminal = s(summary, "arrival_terminal")
        if flughafen.isEmpty && terminal.isEmpty { return "" }
        if !flughafen.isEmpty && !terminal.isEmpty { return "\(flughafen) Terminal \(terminal)" }
        return flughafen.isEmpty ? "Terminal \(terminal)" : flughafen
    }

    // MARK: Zugzeiten (resolveTrainEtdValues, buildTrainLivePayload)

    struct ZugZeiten { var geplant = ""; var erwartet = ""; var etd = ""; var etdOriginal = "" }

    static func zugZeiten(_ daten: AnyJSON?, startZeit: String) -> ZugZeiten {
        let d = daten?.objectValue
        let summary = d?["summary"]?.objectValue
        let etaLabel = s(d, "eta_label")
        let erwartet = FahrtText.uhrzeit(etaLabel.isEmpty ? FahrtText.uhrAusISO(s(summary, "predicted_arrival")) : etaLabel, "")
        let geplant = FahrtText.uhrzeit(FahrtText.uhrAusISO(s(summary, "planned_arrival")), "")
        let rueckfall = FahrtText.uhrzeit(startZeit, "")
        let etd = [erwartet, rueckfall, geplant].first { !$0.isEmpty } ?? ""
        let original = [geplant, rueckfall, etd].first { !$0.isEmpty } ?? ""
        return ZugZeiten(geplant: geplant, erwartet: erwartet, etd: etd, etdOriginal: original)
    }

    static func zugLiveDaten(_ daten: AnyJSON?, abgerufen: String) -> AnyJSON {
        let d = daten?.objectValue
        let summary = d?["summary"]?.objectValue
        let live = d?["live_tracking"]?.objectValue
        func liste(_ w: AnyJSON?) -> [AnyJSON]? {
            w?.arrayValue.map { $0.map { e -> String in
                if let t = e.stringValue { return t }
                if let i = e.intValue { return String(i) }
                if let z = e.doubleValue { return String(z) }
                return ""
            }.map(FahrtText.getrimmt).filter { !$0.isEmpty }.map(AnyJSON.string) }
        }
        let halte: [AnyJSON] = liste(summary?["route_stops"]) ?? liste(live?["route_stops"]) ?? []
        func textOderNull(_ t: String) -> AnyJSON { t.isEmpty ? .null : .string(t) }
        // Number(x): Zahl oder Zahl-als-Text, sonst null (NaN wird im JSON zu null).
        func zahl(_ w: AnyJSON?) -> AnyJSON {
            if let i = w?.intValue { return .double(Double(i)) }
            if let z = w?.doubleValue { return .double(z) }
            if let t = w?.stringValue, let z = Double(FahrtText.getrimmt(t)) { return .double(z) }
            return .null
        }
        let zugNr = s(summary, "train_number")
        let liveObjekt: AnyJSON
        if let live {
            let rufname = [s(live, "callsign"), s(summary, "line_name"), zugNr].first { !$0.isEmpty } ?? ""
            let zeit = s(live, "captured_at")
            liveObjekt = .object([
                "provider": "deutsche_bahn_api",
                "mode": "train",
                "callsign": textOderNull(rufname),
                "radar_hex": .null,
                "latitude": zahl(live["latitude"]),
                "longitude": zahl(live["longitude"]),
                "heading_deg": zahl(live["heading_deg"]),
                "captured_at": .string(zeit.isEmpty ? abgerufen : zeit),
                "on_ground": .bool(false),
                "trail_points": .array(live["trail_points"]?.arrayValue ?? []),
                "route_stops": .array(halte),
            ])
        } else {
            liveObjekt = .null
        }
        return .object([
            "provider": "deutsche_bahn_api",
            "fetched_at": .string(abgerufen),
            "summary": .object([
                "provider": "deutsche_bahn_api",
                "flight_iata": textOderNull(zugNr),
                "operating_carrier": "DB",
                "operating_flight_number": textOderNull(zugNr),
                "marketing_carrier": "DB",
                "marketing_flight_number": textOderNull(zugNr),
                "flight_status_code": .null,
                "flight_status_description": "Train live tracking",
                "departure_airport": .null,
                "departure_terminal": .null,
                "departure_gate": .null,
                "arrival_airport": textOderNull(s(summary, "target_station_name")),
                "arrival_terminal": .null,
                "arrival_gate": .null,
                "scheduled_departure_local": .null,
                "estimated_departure_local": .null,
                "actual_departure_local": .null,
                "scheduled_arrival_local": textOderNull(s(summary, "planned_arrival")),
                "estimated_arrival_local": textOderNull(s(summary, "predicted_arrival")),
                "actual_arrival_local": .null,
                "aircraft_code": .null,
                "aircraft_registration": .null,
                "aircraft_icao24": .null,
                "delay_minutes": .null,
                "route_stops": .array(halte),
            ]),
            "live_tracking": liveObjekt,
        ])
    }

    // MARK: external-sync (invokeExternalSyncForJob)

    @discardableResult
    static func externerAbgleich(_ fahrtID: UUID, grund: String) async -> Bool {
        if case .success = await aufrufen("external-sync", [
            "reason": .string(grund),
            "job_ids": .array([.string(fahrtID.uuidString.lowercased())]),
            "force_refresh": .bool(true),
        ]) { return true }
        return false
    }
}
