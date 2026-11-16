import Foundation
import Supabase

/// Fragt dispo-admin (aktion ki_frage), wie das Web. Das Modell laeuft auf dem Server-Weg im Tailnet.
enum KiAssistentDienst {
    /// Antwort wie das Rueckgabeobjekt im Web ({ answer, action }).
    struct Antwort {
        var text: String
        var buchungsVorschlag: KiBuchungsVorschlag?
        /// Dienststart/Dienstende fuer die markierten Fahrer, erst der Knopf schickt ab.
        var dienstVorschlag: DienstVorschlag?
        /// Weitere Karten (nur mit karten: true): zusaetzliche Fahrten und Standbys, jede einzeln bestaetigen.
        var karten: [KiKarte] = []
    }

    /// Letzte Fahrer und Fahrten des Gespraechs, fuer Rueckfragen.
    @MainActor private static var kontext: AnyJSON?

    /// cachedSnapshot/cachedSnapshotAt im Web. Live wird der Snapshot nie geladen, der Cache
    /// bleibt aber wie dort, damit die Realtime-Invalidierung dasselbe tut.
    @MainActor private static var snapshotZeit: Date?

    @MainActor static func cacheVerwerfen() {
        snapshotZeit = nil
    }

    private struct Eintrag: Encodable { let role: String; let text: String }
    private struct Anfrage: Encodable {
        let aktion = "ki_frage"
        let frage: String
        let verlauf: [Eintrag]
        let kontext: AnyJSON?
        let offenerVorschlag: KiBuchungsVorschlag?
        let letzteFahrtId: String?
        /// Auf der Karte markierte Fahrer: "schick die alle in Feierabend" meint sie.
        let markierteFahrer: [MarkierterFahrer]
        /// Diese Ansicht zeigt alle Vorschlaege als Karten (Standby eigene Karte, mehrere Auftraege einzeln).
        let karten: Bool?
        /// Umschalter Regeln/Frei (13.11.): "frei" laesst reine Fragen vom Modell beantworten.
        let modus: String
    }
    private struct MarkierterFahrer: Encodable { let id: String; let name: String }
    private struct ServerAntwort: Decodable {
        /// Unbekannte oder kaputte Teile einer Aktion lassen die Antwort nicht scheitern.
        struct Aktion: Decodable {
            let type: String?; let proposal: KiBuchungsVorschlag?; let vorschlag: DienstVorschlag?; let standby: KiStandbyVorschlag?
            let fahrer: KiAnlegenDaten?; let fahrzeug: KiAnlegenDaten?
            private enum CodingKeys: String, CodingKey { case type, proposal, vorschlag, standby, fahrer, fahrzeug }
            init(from decoder: Decoder) throws {
                let c = try decoder.container(keyedBy: CodingKeys.self)
                type = try? c.decodeIfPresent(String.self, forKey: .type)
                proposal = try? c.decodeIfPresent(KiBuchungsVorschlag.self, forKey: .proposal)
                vorschlag = try? c.decodeIfPresent(DienstVorschlag.self, forKey: .vorschlag)
                standby = try? c.decodeIfPresent(KiStandbyVorschlag.self, forKey: .standby)
                fahrer = try? c.decodeIfPresent(KiAnlegenDaten.self, forKey: .fahrer)
                fahrzeug = try? c.decodeIfPresent(KiAnlegenDaten.self, forKey: .fahrzeug)
            }
        }
        let answer: String?
        let action: Aktion?
        /// Neue Server mit karten: true liefern alle Vorschlaege als Liste, aeltere nur action.
        let aktionen: [Aktion]?
        let kontext: AnyJSON?
    }

    /// onCreateRide(payload, { aiBooked: true })
    static func buchen(_ v: KiBuchungsVorschlag) async throws -> String? {
        if let fahrtID = v.fahrtUUID {
            let g = try await FahrtSpeichern.laden(fahrtID)
            let neu = v.aenderung(auf: g)
            var w = neu.werte
            w.anonymeGaeste = w.anonymeGaeste.isEmpty ? "0" : w.anonymeGaeste
            let ergebnis = await FahrtSpeichern.aendern(FahrtEingabe(
                werte: w, fahrgaeste: FahrtText.gaesteTeilen(neu.fahrgaeste).joined(separator: "; "),
                fahrerNamen: neu.fahrerNamen.map(FahrtText.getrimmt).filter { !$0.isEmpty },
                zwischenstopps: g.zwischenstopps,
                flugZielFlughafen: "", flugAnkunftGeplant: "", notiz: neu.notiz,
                flugOhnePruefung: v.flugUnbestaetigt == true), geladen: g)
            if !ergebnis.ok { throw BuchungFehlgeschlagen(meldung: ergebnis.fehler ?? "Unbekannter Fehler") }
            return fahrtID.uuidString
        }
        var w = v.vorlage.werte
        w.anonymeGaeste = w.anonymeGaeste.isEmpty ? "0" : w.anonymeGaeste
        let ergebnis = await FahrtSpeichern.anlegen(FahrtEingabe(
            werte: w, fahrgaeste: FahrtText.gaesteTeilen(v.fahrgaeste).joined(separator: "; "), fahrerNamen: v.fahrerNamen,
            flugZielFlughafen: "", flugAnkunftGeplant: "", notiz: v.notes, aiBooked: true,
            flugOhnePruefung: v.flugUnbestaetigt == true))
        if !ergebnis.ok { throw BuchungFehlgeschlagen(meldung: ergebnis.fehler ?? "Unbekannter Fehler") }
        return ergebnis.id?.uuidString
    }

    /// standbyAnlegen aus der Standby-Karte (KiAssistentView.jsx handleKarteBuchen).
    /// Nil = es fehlt noch etwas (Ort ohne Koordinaten oder keine Fahrer), dann ins Formular.
    @MainActor static func standbyAnlegen(_ s: KiStandbyVorschlag) async throws -> UUID? {
        let fahrerIDs = s.fahrerIds.compactMap(UUID.init(uuidString:))
        guard !fahrerIDs.isEmpty else { return nil }
        let ortID = UUID(uuidString: s.ortId)
        var ort: DispoStandbySpeicher.OrtDaten
        if let lat = s.lat, let lng = s.lng {
            ort = .init(id: ortID, name: s.ortName, adresse: s.adresse.isEmpty ? nil : s.adresse, lat: lat, lng: lng,
                        radiusRein: s.radiusRein > 0 ? s.radiusRein : 150, radiusRaus: s.radiusRaus > 0 ? s.radiusRaus : 300)
        } else if let ortID {
            await OrteSpeicher.geteilt.ladenFallsNoetig()
            guard let o = OrteSpeicher.geteilt.ort(ortID) else { return nil }
            ort = .init(id: o.id, name: o.name, adresse: o.adresse, lat: o.lat, lng: o.lng,
                        radiusRein: max(150, o.radius_rein_m), radiusRaus: max(300, o.radius_raus_m))
        } else {
            return nil
        }
        switch await DispoStandbySpeicher.gemeinsam.anlegen(datum: s.datum, von: s.von, bis: s.bis, ort: ort,
                                                              notiz: FahrtText.getrimmt(s.notiz), fahrerIDs: fahrerIDs) {
        case let .success(id): return id
        case let .failure(e): throw e
        }
    }

    /// kiAnlegen: Karte "Neuer Fahrer" / "Neues Fahrzeug" bestaetigt, der Server prueft und legt an (anlegen.ts).
    struct AnlegenAntwort: Decodable {
        var ok = false
        var text = ""
        private enum CodingKeys: String, CodingKey { case ok, text }
        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            ok = ((try? c.decodeIfPresent(Bool.self, forKey: .ok)) ?? nil) ?? false
            text = ((try? c.decodeIfPresent(String.self, forKey: .text)) ?? nil) ?? ""
        }
    }
    private struct AnlegenAnfrage: Encodable {
        let aktion = "ki_anlegen"
        let art: String
        let daten: KiAnlegenDaten
    }
    static func anlegen(art: String, daten: KiAnlegenDaten) async throws -> AnlegenAntwort {
        try await Backend.client.functions.invoke("dispo-admin",
                                                  options: FunctionInvokeOptions(body: AnlegenAnfrage(art: art, daten: daten)))
    }

    private struct BuchungFehlgeschlagen: LocalizedError {
        let meldung: String
        var errorDescription: String? { meldung }
    }

    /// askDatabaseAssistant({ prompt, chatHistory })
    @MainActor static func fragen(_ prompt: String, verlauf: [(rolle: String, text: String)],
                                  offenerVorschlag: KiBuchungsVorschlag? = nil, letzteFahrtId: String? = nil,
                                  karten: Bool = false) async throws -> Antwort {
        let frage = prompt.trimmingCharacters(in: .whitespacesAndNewlines)
        if frage.isEmpty { return Antwort(text: "Bitte stelle eine Frage.") }
        let anfrage = Anfrage(frage: frage, verlauf: verlauf.map { Eintrag(role: $0.rolle, text: $0.text) }, kontext: kontext,
                              offenerVorschlag: offenerVorschlag, letzteFahrtId: letzteFahrtId,
                              markierteFahrer: FahrerMarkierung.geteilt.wirkt
                                ? FahrerMarkierung.geteilt.fahrer.map { MarkierterFahrer(id: $0.id, name: $0.name) } : [],
                              karten: karten ? true : nil, modus: KiModus.aktuell)
        let antwort: ServerAntwort = try await Backend.client.functions.invoke("dispo-admin", options: FunctionInvokeOptions(body: anfrage))
        if let neu = antwort.kontext { kontext = neu }
        let aktionen = antwort.aktionen ?? (antwort.action.map { [$0] } ?? [])
        let ersteBuchung = aktionen.firstIndex { $0.type == "booking_proposal" && $0.proposal != nil }
        let vorschlag = ersteBuchung.flatMap { aktionen[$0].proposal }
        let dienst = antwort.action?.type == "dienst_vorschlag" ? antwort.action?.vorschlag : nil
        // Weitere Karten: alle Fahrten ausser der ersten und alle Standbys.
        let ms = Int(Date().timeIntervalSince1970 * 1000)
        let weitere: [KiKarte] = aktionen.enumerated().compactMap { i, a in
            if a.type == "booking_proposal", i != ersteBuchung, let p = a.proposal {
                return KiKarte(id: "karte-\(ms)-\(i)", art: "fahrt", proposal: p)
            }
            if a.type == "standby_proposal", let s = a.standby {
                return KiKarte(id: "karte-\(ms)-\(i)", art: "standby", standby: s)
            }
            if a.type == "fahrer_proposal" {
                return KiKarte(id: "karte-\(ms)-\(i)", art: "fahrer", daten: a.fahrer ?? KiAnlegenDaten())
            }
            if a.type == "fahrzeug_proposal" {
                return KiKarte(id: "karte-\(ms)-\(i)", art: "fahrzeug", daten: a.fahrzeug ?? KiAnlegenDaten())
            }
            return nil
        }
        return Antwort(text: antwort.answer ?? "", buchungsVorschlag: vorschlag, dienstVorschlag: dienst, karten: weitere)
    }
}

/// Weitere Vorschlagskarte einer Antwort (Fahrt oder Standby), Status pending, saving, booked, cancelled.
struct KiKarte: Codable, Equatable, Identifiable {
    var id: String
    var art: String
    var proposal: KiBuchungsVorschlag?
    var standby: KiStandbyVorschlag?
    /// Neuer Fahrer oder neues Fahrzeug (art "fahrer"/"fahrzeug"), Felder wie vom Server.
    var daten: KiAnlegenDaten?
    var status = "pending"
    var rideId: String?
    /// Bearbeiten-Felder der Anlegen-Karte aufgeklappt.
    var offen: Bool?
}

/// Felder einer Anlegen-Karte (dispo-admin/anlegen.ts). Alles Text, unbekannte Typen tolerant.
/// Fahrer: vor, nach, benutzername, passwort, nummer, telefon, email. Fahrzeug: modell, ausstattung,
/// kennzeichen, sitze, farbe, kraftstoff, vin. Beide: fehler.
struct KiAnlegenDaten: Codable, Equatable {
    var werte: [String: String] = [:]

    init() {}

    subscript(_ feld: String) -> String {
        get { werte[feld] ?? "" }
        set { werte[feld] = newValue }
    }

    private struct Schluessel: CodingKey {
        var stringValue: String
        var intValue: Int? { nil }
        init(stringValue: String) { self.stringValue = stringValue }
        init?(intValue: Int) { nil }
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Schluessel.self)
        for k in c.allKeys {
            if let s = (try? c.decodeIfPresent(String.self, forKey: k)) ?? nil { werte[k.stringValue] = s }
            else if let i = (try? c.decodeIfPresent(Int.self, forKey: k)) ?? nil { werte[k.stringValue] = String(i) }
            else if let d = (try? c.decodeIfPresent(Double.self, forKey: k)) ?? nil { werte[k.stringValue] = String(d) }
        }
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: Schluessel.self)
        for (k, v) in werte { try c.encode(v, forKey: Schluessel(stringValue: k)) }
    }
}

/// Standby-Karte des Assistenten (dispo-admin/standbyKi.ts standbyKarte).
struct KiStandbyVorschlag: Codable, Equatable {
    var datum = ""
    var von = ""
    var bis = ""
    var ortName = ""
    /// Leer = kein eigener Ort.
    var ortId = ""
    var adresse = ""
    var lat: Double?
    var lng: Double?
    var radiusRein = 150
    var radiusRaus = 300
    var fahrerNamen: [String] = []
    var fahrerIds: [String] = []
    var notiz = ""
    /// Teilmenge von von, bis, zeiten, ort, fahrer.
    var fehlt: [String] = []

    private enum CodingKeys: String, CodingKey {
        case datum, von, bis, ortName, ortId, adresse, lat, lng, radiusRein, radiusRaus, fahrerNamen, fahrerIds, notiz, fehlt
    }

    init() {}

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        func text(_ k: CodingKeys) -> String { ((try? c.decodeIfPresent(String.self, forKey: k)) ?? nil) ?? "" }
        func zahl(_ k: CodingKeys) -> Double? {
            if let d = (try? c.decodeIfPresent(Double.self, forKey: k)) ?? nil { return d }
            return ((try? c.decodeIfPresent(String.self, forKey: k)) ?? nil).flatMap(Double.init)
        }
        func liste(_ k: CodingKeys) -> [String] { ((try? c.decodeIfPresent([String].self, forKey: k)) ?? nil) ?? [] }
        datum = text(.datum); von = text(.von); bis = text(.bis)
        ortName = text(.ortName); ortId = text(.ortId); adresse = text(.adresse)
        lat = zahl(.lat); lng = zahl(.lng)
        radiusRein = zahl(.radiusRein).map { Int($0) } ?? 150
        radiusRaus = zahl(.radiusRaus).map { Int($0) } ?? 300
        fahrerNamen = liste(.fahrerNamen); fahrerIds = liste(.fahrerIds)
        notiz = text(.notiz); fehlt = liste(.fehlt)
    }

    /// Ort, wie er im Standby-Formular im Feld steht.
    var ortText: String { !ortId.isEmpty ? ortName : (adresse.isEmpty ? ortName : adresse) }

    /// Fehlt-Liste als Text fuer die Karte.
    var fehltText: [String] {
        let namen = ["von": "Startzeit", "bis": "Endzeit", "zeiten": "Endzeit nach Start", "ort": "Ort", "fahrer": "Fahrer"]
        return fehlt.map { namen[$0] ?? $0 }
    }
}

/// Buchungs-Vorschau (toCreateRidePayload in KiAssistentView.jsx).
struct KiBuchungsVorschlag: Codable, Equatable {
    var datum = ""
    var startZeit = ""
    var start = ""
    var ziel = ""
    var fahrgaeste = ""
    var anonymeGaeste = "0"
    var fahrerNamen: [String] = []
    var konvoi = ""
    var flugnummer = ""
    var notes = ""
    /// Nur bei Aenderung einer bestehenden Fahrt: welche Fahrt und welche Felder.
    var fahrtId: String?
    var geaendert: [String]?
    /// Eigener Ort, vom Server erkannt (dispo-admin/ortSuche.ts): gespeichert wie bei Auswahl im Formular.
    /// Flug vom Server nicht bestaetigt (dispo-admin/flugKi.ts): buchen speichert trotzdem.
    var flugUnbestaetigt: Bool?
    var startOrtId: String?
    var startAdresse: String?
    var zielOrtId: String?
    var zielAdresse: String?

    /// Start/Ziel ins Formular: mit eigenem Ort Name im Feld, ID und Adresse dahinter.
    private func ortSetzen(_ w: inout FahrtFormularWerte) {
        w.start = start
        w.startOrtID = startOrtId.flatMap(UUID.init(uuidString:))
        w.startOrtAdresse = w.startOrtID != nil ? (startAdresse ?? "") : ""
        w.ziel = ziel
        w.zielOrtID = zielOrtId.flatMap(UUID.init(uuidString:))
        w.zielOrtAdresse = w.zielOrtID != nil ? (zielAdresse ?? "") : ""
    }

    var fahrtUUID: UUID? { fahrtId.flatMap(UUID.init(uuidString:)) }

    /// Nur die geaenderten Felder uebernehmen, alles andere bleibt wie an der Fahrt.
    func aenderung(auf g: GeladeneFahrt) -> FahrtVorlage {
        let felder = Set(geaendert ?? [])
        var w = g.werte
        if felder.contains("datum") { w.datum = datum }
        if felder.contains("startZeit") { w.startZeit = startZeit }
        var neu = w
        ortSetzen(&neu)
        if felder.contains("start") { w.start = neu.start; w.startOrtID = neu.startOrtID; w.startOrtAdresse = neu.startOrtAdresse }
        if felder.contains("ziel") { w.ziel = neu.ziel; w.zielOrtID = neu.zielOrtID; w.zielOrtAdresse = neu.zielOrtAdresse }
        return FahrtVorlage(werte: w, fahrerNamen: felder.contains("fahrerNamen") ? fahrerNamen : g.fahrerNamen,
                            fahrgaeste: felder.contains("fahrgaeste") ? fahrgaeste : g.fahrgaeste, notiz: g.notiz)
    }

    /// Startwerte fuer das Fahrtformular (toCreateRidePayload).
    var vorlage: FahrtVorlage {
        var w = FahrtFormularWerte()
        w.datum = datum
        w.startZeit = startZeit
        ortSetzen(&w)
        w.flugnummer = flugnummer
        w.konvoi = konvoi
        w.anonymeGaeste = anonymeGaeste == "0" ? "" : anonymeGaeste
        w.aktuellerStatus = "offen"
        return FahrtVorlage(werte: w, fahrerNamen: fahrerNamen, fahrgaeste: fahrgaeste, notiz: notes)
    }

    /// hasMinimumBookingData
    var hatPflichtfelder: Bool {
        !start.trimmingCharacters(in: .whitespaces).isEmpty
            && !ziel.trimmingCharacters(in: .whitespaces).isEmpty
            && !startZeit.trimmingCharacters(in: .whitespaces).isEmpty
    }
}

/// Realtime-Kanal aus KiAssistentView.jsx: jede Aenderung an den neun Tabellen verwirft den Cache.
@MainActor
final class KiAssistentLive {
    private var kanal: RealtimeChannelV2?
    private var beobachter: [Task<Void, Never>] = []

    private static let tabellen = ["jobs", "profiles", "vehicles", "guests", "job_guests", "job_notes",
                                   "convoy_assignments", "convoys", "driver_live_locations"]

    func starten() async {
        guard kanal == nil else { return }
        let k = Backend.client.channel("admin-ki-live-\(Int(Date().timeIntervalSince1970 * 1000))")
        let stroeme = Self.tabellen.map { k.postgresChange(AnyAction.self, schema: "public", table: $0) }
        kanal = k
        beobachter = stroeme.map { strom in
            Task { for await _ in strom { KiAssistentDienst.cacheVerwerfen() } }
        }
        try? await k.subscribeWithError()
    }

    func beenden() async {
        beobachter.forEach { $0.cancel() }
        beobachter = []
        if let kanal { await Backend.client.removeChannel(kanal) }
        kanal = nil
    }
}


/// Umschalter Regeln/Frei im KI-Assistenten (13.11.), wie shared/kiModus.js im Web. Pro Geraet gemerkt,
/// gilt auch fuer Fragen von der Apple Watch (laufen ueber diesen Dienst).
enum KiModus {
    static let schluessel = "trisar_ki_modus"
    /// Standard ist "frei" (Wunsch 13.11.), "regeln" nur wenn ausdruecklich gewaehlt.
    static var aktuell: String { UserDefaults.standard.string(forKey: schluessel) == "regeln" ? "regeln" : "frei" }
}
