import Foundation
import Supabase

/// Werte des Formulars (formValues in FahrtAdd.jsx / FahrtBearbeitenView.jsx).
struct FahrtFormularWerte: Equatable {
    var datum = ""
    var startZeit = ""
    var start = ""
    var ziel = ""
    var flugnummer = ""
    var zugnummer = ""
    var konvoi = ""
    var anzahlKinder = ""
    var anonymeGaeste = ""
    var aktuellerStatus = ""
    var anzahlFahrzeuge = ""
    /// Gewaehlter eigener Ort: start/ziel zeigen dann den Ortsnamen, gespeichert wird die Ortsadresse.
    var startOrtID: UUID?
    var startOrtAdresse = ""
    var zielOrtID: UUID?
    var zielOrtAdresse = ""
}

/// Stand einer Fahrt beim Oeffnen des Editors (rideEditorData aus openRideEditorById).
struct GeladeneFahrt: Equatable {
    let id: UUID
    var werte: FahrtFormularWerte
    var fahrerNamen: [String]
    /// Gaeste mit ", " verbunden wie ride.fahrgaeste.
    var fahrgaeste: String
    var notiz: String
    var aiBooked: Bool
    /// jobs.pickup_ort_id / dropoff_ort_id gibt es in der Datenbank (Migration da).
    var mitOrtSpalten = false
}

/// payload an onCreateRide / onSave.
struct FahrtEingabe {
    var werte: FahrtFormularWerte
    /// Gaeste mit "; " verbunden.
    var fahrgaeste: String
    var fahrerNamen: [String]
    var flugZielFlughafen: String
    var flugAnkunftGeplant: String
    var notiz: String
}

/// Laden, Anlegen, Aendern und Loeschen einer Fahrt wie handleCreateRide, handleSaveRideEdit,
/// handleDeleteRide und loadRidesFromDb in admin/src/App.jsx.
/// Der Admin-Client im Web ist derselbe angemeldete Client, die Rueckfaelle darauf entfallen hier.
enum FahrtSpeichern {
    typealias Ergebnis = (ok: Bool, fehler: String?)

    private static let aiTag = "[AI_BOOKED]"
    private static let altAnonym = #"^anonymer?\s+fahrgast(?:\s+\d+)?$"#

    // MARK: Verzeichnisse

    struct FahrerEintrag: Decodable {
        let id: UUID
        let first_name: String?
        let last_name: String?
        let driver_number: AnyJSON?
        let role: String?
        var name: String { FahrtText.name(first_name, last_name) }
        var nummer: String {
            switch driver_number {
            case let .integer(i)?: return String(i)
            case let .double(d)?: return d == d.rounded() ? String(Int(d)) : String(d)
            case let .string(t)?: return FahrtText.getrimmt(t)
            default: return ""
            }
        }
    }

    struct GastEintrag: Decodable {
        let id: UUID
        let first_name: String?
        let last_name: String?
        let email: String?
        var name: String { FahrtText.name(first_name, last_name) }
    }

    private static let dispoRollen: Set<String> = ["dispo", "dispatcher", "admin", "koordinator", "coordinator"]

    /// fetchDriverProfilesForLookup / FahrerAutocomplete: nur Fahrer (Rolle entscheidet, nicht is_dispo).
    static func fahrerLaden() async -> [FahrerEintrag] {
        let zeilen: [FahrerEintrag] = (try? await Backend.client.from("profiles")
            .select("id, first_name, last_name, driver_number, role, is_dispo")
            .order("driver_number", ascending: true, nullsFirst: false)
            .execute().value) ?? []
        return zeilen.filter { !dispoRollen.contains(FahrtText.getrimmt($0.role ?? "").lowercased()) }
    }

    static func gaesteLaden() async -> [GastEintrag] {
        (try? await Backend.client.from("guests")
            .select("id, first_name, last_name, email")
            .order("first_name", ascending: true)
            .order("last_name", ascending: true)
            .execute().value) ?? []
    }

    /// buildDriverSuggestionOptions aus FahrerAutocomplete.jsx.
    static func fahrerVorschlaege(_ fahrer: [FahrerEintrag]) -> [String] {
        var gesehen = Set<String>()
        return fahrer.compactMap { f -> String? in
            let n = f.name, d = f.nummer
            let label = !n.isEmpty && !d.isEmpty ? "\(n) (\(d))" : (n.isEmpty ? d : n)
            return label.isEmpty ? nil : label
        }.filter { gesehen.insert($0).inserted }
    }

    static func gastVorschlaege(_ gaeste: [GastEintrag]) -> [String] {
        var gesehen = Set<String>()
        return gaeste.map(\.name).filter { !$0.isEmpty && gesehen.insert($0).inserted }
    }

    /// resolveDriverIdFromInput
    static func fahrerID(_ eingabe: String, _ fahrer: [FahrerEintrag]) -> UUID? {
        let e = FahrtText.ortNormal(eingabe)
        if e.isEmpty { return nil }
        let zahl = FahrtText.nummernTeil(eingabe)
        let liste = fahrer.map { (id: $0.id, name: FahrtText.ortNormal($0.name), nr: $0.nummer) }
        if let t = liste.first(where: { !$0.name.isEmpty && $0.name == e }) { return t.id }
        if !zahl.isEmpty, let t = liste.first(where: { !$0.nr.isEmpty && $0.nr == zahl }) { return t.id }
        if let t = liste.first(where: { !$0.name.isEmpty && (e.contains($0.name) || $0.name.contains(e)) }) { return t.id }
        if !zahl.isEmpty, let t = liste.first(where: { !$0.nr.isEmpty && $0.nr.contains(zahl) }) { return t.id }
        return nil
    }

    /// resolveGuestIdFromInput
    static func gastID(_ eingabe: String, _ gaeste: [GastEintrag]) -> UUID? {
        let e = FahrtText.ortNormal(eingabe)
        if e.isEmpty { return nil }
        let liste = gaeste.map { (id: $0.id, name: FahrtText.ortNormal($0.name), mail: FahrtText.ortNormal($0.email ?? "")) }
        if let t = liste.first(where: { !$0.name.isEmpty && $0.name == e }) { return t.id }
        if let t = liste.first(where: { !$0.mail.isEmpty && $0.mail == e }) { return t.id }
        if let t = liste.first(where: { !$0.name.isEmpty && (e.contains($0.name) || $0.name.contains(e)) }) { return t.id }
        if let t = liste.first(where: { !$0.mail.isEmpty && (e.contains($0.mail) || $0.mail.contains(e)) }) { return t.id }
        return nil
    }

    // MARK: Laden (Mapping aus loadRidesFromDb + openRideEditorById)

    private struct JobZeile: Decodable {
        let id: UUID
        let driver_id: UUID?
        let convoy_id: UUID?
        let pickup_name: String?
        let pickup_address: String?
        let dropoff_name: String?
        let dropoff_address: String?
        let ride_date: String?
        let etd: String?
        let original_etd: String?
        let status: String?
        let passengers: AnyJSON?
        let anonymous_guests: AnyJSON?
        let flight_number: String?
        let train_number: String?
        let train_planned_time: String?
        let train_predicted_time: String?
        let ext_flight_payload: AnyJSON?
        let ai_booked: Bool?
        let pickup_ort_id: UUID?
        let dropoff_ort_id: UUID?
    }
    private struct Zuordnung: Decodable { let driver_id: UUID?; let response_status: String? }
    private struct Profil: Decodable { let id: UUID; let first_name: String?; let last_name: String?; let driver_number: AnyJSON? }
    private struct GastLink: Decodable { let guest_id: UUID?; let is_main_contact: Bool? }
    private struct GastName: Decodable { let id: UUID; let first_name: String?; let last_name: String? }
    private struct Kolonne: Decodable { let id: UUID; let name: String? }
    private struct Notiz: Decodable { let note_text: String?; let author_name: String? }
    private struct ArchivZeile: Decodable { let job_id: UUID? }

    private static func nummerText(_ w: AnyJSON?) -> String {
        switch w {
        case let .integer(i)?: return String(i)
        case let .double(d)?: return d == d.rounded() ? String(Int(d)) : String(d)
        case let .string(t)?: return FahrtText.getrimmt(t)
        default: return ""
        }
    }

    /// Ortsangabe fuer den Editor: Adresse, sonst Name, sonst Kurzform (extractLocationLabel).
    private static func ortFuerEditor(name: String?, adresse: String?) -> String {
        let n = FahrtText.getrimmt(name ?? ""), a = FahrtText.getrimmt(adresse ?? "")
        if !a.isEmpty { return a }
        if !n.isEmpty { return n }
        return "-"
    }

    static func laden(_ id: UUID) async throws -> GeladeneFahrt {
        let c = Backend.client
        let spalten = "id, driver_id, convoy_id, pickup_name, pickup_address, dropoff_name, dropoff_address, ride_date, etd, original_etd, status, passengers, anonymous_guests, flight_number, train_number, train_planned_time, train_predicted_time, ext_flight_payload, ai_booked"
        // Erst mit den Spalten der eigenen Orte, fehlen sie (Migration noch nicht da), ohne.
        let job: JobZeile
        var mitOrtSpalten = true
        do {
            job = try await c.from("jobs").select(spalten + ", pickup_ort_id, dropoff_ort_id")
                .eq("id", value: id).single().execute().value
        } catch {
            mitOrtSpalten = false
            job = try await c.from("jobs").select(spalten).eq("id", value: id).single().execute().value
        }

        let archiv: [ArchivZeile] = (try? await c.from("jobs_archive").select("job_id").eq("job_id", value: id).execute().value) ?? []
        let zuordnungen: [Zuordnung] = (try? await c.from("convoy_assignments").select("driver_id, response_status")
            .eq("job_id", value: id).execute().value) ?? []
        let fahrerIDs = Array(Set(([job.driver_id] + zuordnungen.map(\.driver_id)).compactMap { $0 }))
        let profile: [Profil] = fahrerIDs.isEmpty ? [] : ((try? await c.from("profiles")
            .select("id, first_name, last_name, driver_number").in("id", values: fahrerIDs.map(\.uuidString)).execute().value) ?? [])
        let links: [GastLink] = (try? await c.from("job_guests").select("guest_id, is_main_contact").eq("job_id", value: id).execute().value) ?? []
        let gastIDs = Array(Set(links.compactMap(\.guest_id)))
        let gaeste: [GastName] = gastIDs.isEmpty ? [] : ((try? await c.from("guests")
            .select("id, first_name, last_name").in("id", values: gastIDs.map(\.uuidString)).execute().value) ?? [])
        var kolonnenName = ""
        if let k = job.convoy_id {
            let zeilen: [Kolonne] = (try? await c.from("convoys").select("id, name").eq("id", value: k).execute().value) ?? []
            kolonnenName = FahrtText.getrimmt(zeilen.first?.name ?? "")
        }
        let notizen: [Notiz] = (try? await c.from("job_notes").select("note_text, author_name")
            .eq("job_id", value: id).order("created_at", ascending: false).execute().value) ?? []

        // Fahrer: Hauptfahrer + Kolonnen-Zuordnungen, doppelte nach ID entfernt.
        let profilNach = Dictionary(uniqueKeysWithValues: profile.map { ($0.id, $0) })
        var namen: [String] = []
        var gesehen = Set<UUID>()
        for fid in [job.driver_id].compactMap({ $0 }) + zuordnungen.compactMap(\.driver_id) {
            guard let p = profilNach[fid], gesehen.insert(fid).inserted else { continue }
            let label = FahrtText.fahrerBeschriftung(name: FahrtText.name(p.first_name, p.last_name), nummer: nummerText(p.driver_number))
            if !label.isEmpty { namen.append(label) }
        }
        let hatKolonne = job.convoy_id != nil || namen.count > 1
        let fahrzeuge = hatKolonne ? String(max(1, namen.count)) : ""

        // Gaeste: passengers ist die Quelle, sobald es als Liste/Objekt vorliegt.
        let roh: [String]
        var istObjekt = false
        switch job.passengers {
        case let .array(a)?: roh = a.compactMap { $0.stringValue }.map(FahrtText.getrimmt).filter { !$0.isEmpty }; istObjekt = true
        case let .object(o)?: roh = o.values.compactMap { $0.stringValue }.map(FahrtText.getrimmt).filter { !$0.isEmpty }; istObjekt = true
        case let .string(t)?: roh = FahrtText.gaesteTeilen(t)
        default: roh = []
        }
        let istAltAnonym: (String) -> Bool = { $0.range(of: altAnonym, options: [.regularExpression, .caseInsensitive]) != nil }
        let altAnzahl = roh.filter(istAltAnonym).count
        let passagiere = roh.filter { !istAltAnonym($0) }
        let gastNach = Dictionary(uniqueKeysWithValues: gaeste.map { ($0.id, $0) })
        let gastNamen = links.sorted { ($0.is_main_contact == true ? 1 : 0) > ($1.is_main_contact == true ? 1 : 0) }
            .compactMap { $0.guest_id.flatMap { gastNach[$0] } }
            .map { FahrtText.name($0.first_name, $0.last_name) }.filter { !$0.isEmpty }
        let wirksam = istObjekt ? passagiere : (gastNamen.isEmpty ? passagiere : gastNamen)
        let anonym = max(Int(nummerText(job.anonymous_guests)) ?? 0, altAnzahl)

        // Startzeit wie die Fahrtenliste: Zugzeiten bevorzugt, heute verspaetete offene Fahrten auf jetzt.
        var etd = FahrtText.uhrzeit(job.etd, "")
        var original = FahrtText.uhrzeit(job.original_etd, "")
        let zug = FahrtText.getrimmt(job.train_number ?? "")
        let zugGeplant = FahrtText.uhrzeit(job.train_planned_time, "")
        let zugErwartet = FahrtText.uhrzeit(job.train_predicted_time, "")
        if !zug.isEmpty, let summary = job.ext_flight_payload?.objectValue?["summary"]?.objectValue {
            let geplant = FahrtText.uhrzeit(FahrtText.uhrAusISO(summary["scheduled_arrival_local"]?.stringValue), "")
            let erwartet = FahrtText.uhrzeit(FahrtText.uhrAusISO(summary["estimated_arrival_local"]?.stringValue), "")
            if !erwartet.isEmpty && zugErwartet.isEmpty { etd = erwartet }
            if !geplant.isEmpty && zugGeplant.isEmpty { original = geplant }
        }
        if !zug.isEmpty {
            if !zugErwartet.isEmpty { etd = zugErwartet }
            if !zugGeplant.isEmpty { original = zugGeplant }
        }
        let jobStatus = archiv.isEmpty ? FahrtText.getrimmt(job.status ?? "").lowercased() : "archived"
        let offenArtig: Set<String> = ["pending", "assigned", "offen", "new", "requested", "offered", "zugewiesen", "at_pickup", "beim_pickup", "beim pickup"]
        let tag = FahrtText.fahrtDatum(job.ride_date, FahrtText.heute())
        let jetzt = FahrtText.jetztUhr()
        let geplantUhr = original.isEmpty ? etd : original
        var wirksameUhr = etd.isEmpty ? original : etd
        if tag == FahrtText.heute(), offenArtig.contains(jobStatus),
           let g = FahrtText.minuten(geplantUhr), let n = FahrtText.minuten(jetzt), n > g {
            wirksameUhr = jetzt
        }
        let startZeit = wirksameUhr.isEmpty ? (original.isEmpty ? "--:--" : original) : wirksameUhr

        // Notizen: neueste ohne Autor = Dispo-Notiz, das KI-Kennzeichen wird herausgenommen.
        let neueste = notizen.first
        let dispo = notizen.first { FahrtText.getrimmt($0.author_name ?? "").isEmpty }
        let dispoText = FahrtText.getrimmt((dispo?.note_text ?? "").replacingOccurrences(of: aiTag, with: ""))
        let aiBooked = job.ai_booked == true || (neueste?.note_text ?? "").contains(aiTag) || (dispo?.note_text ?? "").contains(aiTag)

        // Mit eigenem Ort steht im Feld der Ortsname, die Adresse wird mitgefuehrt.
        let start = job.pickup_ort_id != nil && !FahrtText.getrimmt(job.pickup_name ?? "").isEmpty
            ? FahrtText.getrimmt(job.pickup_name ?? "") : ortFuerEditor(name: job.pickup_name, adresse: job.pickup_address)
        let ziel = job.dropoff_ort_id != nil && !FahrtText.getrimmt(job.dropoff_name ?? "").isEmpty
            ? FahrtText.getrimmt(job.dropoff_name ?? "") : ortFuerEditor(name: job.dropoff_name, adresse: job.dropoff_address)
        var werte = FahrtFormularWerte(
            datum: tag,
            startZeit: startZeit,
            start: start,
            ziel: ziel,
            flugnummer: FahrtText.getrimmt(job.flight_number ?? ""),
            zugnummer: zug,
            konvoi: kolonnenName.isEmpty ? (hatKolonne ? "Kolonne" : "") : kolonnenName,
            // openRideEditorById: String(ride.anzahlKinder || '0'), die Liste kennt keine Kinder.
            anzahlKinder: "0",
            anonymeGaeste: String(anonym),
            aktuellerStatus: FahrtText.editorStatus(jobStatus),
            anzahlFahrzeuge: fahrzeuge
        )
        if let o = job.pickup_ort_id {
            werte.startOrtID = o
            werte.startOrtAdresse = FahrtText.getrimmt(job.pickup_address ?? "")
        }
        if let o = job.dropoff_ort_id {
            werte.zielOrtID = o
            werte.zielOrtAdresse = FahrtText.getrimmt(job.dropoff_address ?? "")
        }
        return GeladeneFahrt(id: job.id, werte: werte, fahrerNamen: namen.isEmpty ? [""] : namen,
                             fahrgaeste: wirksam.joined(separator: ", "), notiz: dispoText, aiBooked: aiBooked,
                             mitOrtSpalten: mitOrtSpalten)
    }

    // MARK: Gemeinsame Vorbereitung (Pruefungen vor dem Schreiben)

    private struct Vorbereitet {
        var start: String
        var ziel: String
        /// Adresse fuer pickup_address / dropoff_address (bei eigenem Ort die Ortsadresse).
        var startAdresse: String
        var zielAdresse: String
        var startOrtID: UUID?
        var zielOrtID: UUID?
        var tag: String
        var startZeit: String
        var kolonne: String
        var fahrerNamen: [String]
        var gaeste: [String]
        var anonym: Int
        var flugNr: String
        var zugNr: String
        var flug: FahrtPruefung.ZumSpeichern
        var zug: FahrtPruefung.ZumSpeichern
        var zugZeiten: FahrtPruefung.ZugZeiten
        var zugLive: AnyJSON
    }

    private static func vorbereiten(_ e: FahrtEingabe) async -> Result<Vorbereitet, TrisarFehler> {
        let start = FahrtText.getrimmt(e.werte.start), ziel = FahrtText.getrimmt(e.werte.ziel)
        if start.isEmpty || ziel.isEmpty { return .failure(.text(FahrtText.tr("app.startZielFehlt"))) }
        let tag = FahrtText.fahrtDatum(e.werte.datum)
        if tag.isEmpty { return .failure(.text(FahrtText.tr("app.datumUngueltig"))) }
        var startZeit = FahrtText.uhrzeit(e.werte.startZeit, "")
        let flugNr = FahrtText.nummer(e.werte.flugnummer), zugNr = FahrtText.nummer(e.werte.zugnummer)
        if !flugNr.isEmpty && !zugNr.isEmpty { return .failure(.text(FahrtText.tr("app.nurFlugOderZug"))) }
        let hinweis = FahrtText.getrimmt(e.flugZielFlughafen)
        let flug = await FahrtPruefung.flugZumSpeichern(flugNr, datum: tag, hinweis: hinweis.isEmpty ? start : hinweis,
                                                         ankunftGeplant: e.flugAnkunftGeplant)
        if !flug.ok { return .failure(.text(flug.fehler ?? FahrtText.tr("app.flugValidierungFehler"))) }
        let zug = await FahrtPruefung.zugZumSpeichern(zugNr, datum: tag, hinweis: start)
        if !zug.ok { return .failure(.text(zug.fehler ?? FahrtText.tr("app.zugValidierungFehler"))) }
        let zeiten = zug.gueltig ? FahrtPruefung.zugZeiten(zug.daten, startZeit: startZeit)
            : FahrtPruefung.ZugZeiten(etd: startZeit, etdOriginal: startZeit)
        if !zeiten.etd.isEmpty { startZeit = zeiten.etd }
        let live = zug.gueltig ? FahrtPruefung.zugLiveDaten(zug.daten, abgerufen: Datum.iso(Date())) : .null
        let startOrt = e.werte.startOrtID != nil && !FahrtText.getrimmt(e.werte.startOrtAdresse).isEmpty
        let zielOrt = e.werte.zielOrtID != nil && !FahrtText.getrimmt(e.werte.zielOrtAdresse).isEmpty
        return .success(Vorbereitet(
            start: start, ziel: ziel,
            startAdresse: startOrt ? FahrtText.getrimmt(e.werte.startOrtAdresse) : start,
            zielAdresse: zielOrt ? FahrtText.getrimmt(e.werte.zielOrtAdresse) : ziel,
            startOrtID: startOrt ? e.werte.startOrtID : nil,
            zielOrtID: zielOrt ? e.werte.zielOrtID : nil,
            tag: tag, startZeit: startZeit,
            kolonne: FahrtText.getrimmt(e.werte.konvoi),
            fahrerNamen: FahrtText.fahrerNamenListe(e.fahrerNamen),
            gaeste: FahrtText.gaesteTeilen(e.fahrgaeste),
            anonym: max(0, Int(FahrtText.getrimmt(e.werte.anonymeGaeste.isEmpty ? "0" : e.werte.anonymeGaeste)) ?? 0),
            flugNr: flugNr, zugNr: zugNr, flug: flug, zug: zug, zugZeiten: zeiten, zugLive: live
        ))
    }

    private static func kolonnenID(_ name: String) async throws -> UUID? {
        if name.isEmpty { return nil }
        let zeilen: [Kolonne] = try await Backend.client.from("convoys").select("id, name")
            .ilike("name", pattern: name).limit(1).execute().value
        return zeilen.first?.id
    }

    private static func text(_ t: String) -> AnyJSON { t.isEmpty ? .null : .string(t) }
    private static func id(_ u: UUID?) -> AnyJSON { u.map { .string($0.uuidString.lowercased()) } ?? .null }

    /// Gemeinsame Spalten von insertPayload / updatePayload.
    private static func jobSpalten(_ v: Vorbereitet, status: String, kolonne: UUID?, fahrer: UUID?, aiBooked: Bool,
                                   mitOrtSpalten: Bool = false) -> [String: AnyJSON] {
        let jetzt = Datum.iso(Date())
        var zeile: [String: AnyJSON] = [
            "pickup_name": .string(v.start),
            "pickup_address": .string(v.startAdresse),
            "dropoff_name": .string(v.ziel),
            "dropoff_address": .string(v.zielAdresse),
            "ride_date": .string(v.tag),
            "etd": text(v.zug.gueltig ? v.zugZeiten.etd : v.startZeit),
            "original_etd": text(v.zug.gueltig ? v.zugZeiten.etdOriginal : v.startZeit),
            "status": .string(status),
            "convoy_id": id(kolonne),
            "driver_id": id(fahrer),
            "passengers": .array(v.gaeste.map(AnyJSON.string)),
            "flight_number": v.flug.gueltig ? .string(v.flugNr) : .null,
            "train_number": v.zug.gueltig ? .string(v.zugNr) : .null,
            "train_planned_time": v.zug.gueltig ? text(v.zugZeiten.geplant) : .null,
            "train_predicted_time": v.zug.gueltig ? text(v.zugZeiten.erwartet) : .null,
            "trip_type": .string(v.flug.gueltig ? "airport" : (v.zug.gueltig ? "train" : "normal")),
            "ext_flight_payload": v.zug.gueltig ? v.zugLive : .null,
            "ext_flight_last_sync_at": v.zug.gueltig ? .string(jetzt) : .null,
            "anonymous_guests": .integer(v.anonym),
            "ai_booked": .bool(aiBooked),
        ]
        // Ort-Spalten nur schreiben, wenn es sie sicher gibt (geladen) oder ein Ort gewaehlt ist.
        if mitOrtSpalten || v.startOrtID != nil || v.zielOrtID != nil {
            zeile["pickup_ort_id"] = id(v.startOrtID)
            zeile["dropoff_ort_id"] = id(v.zielOrtID)
        }
        return zeile
    }

    /// Gaeste mit Eintrag in guests als job_guests verknuepfen (erster = Hauptkontakt).
    private static func gaesteVerknuepfen(_ fahrtID: UUID, _ namen: [String]) async {
        let verzeichnis = await gaesteLaden()
        var gesehen = Set<UUID>()
        let zeilen: [[String: AnyJSON]] = namen.enumerated().compactMap { i, name in
            guard let g = gastID(name, verzeichnis), gesehen.insert(g).inserted else { return nil }
            return ["job_id": id(fahrtID), "guest_id": id(g), "is_main_contact": .bool(i == 0)]
        }
        if zeilen.isEmpty { return }
        _ = try? await Backend.client.from("job_guests").upsert(zeilen, onConflict: "job_id,guest_id").execute()
    }

    private struct NeueID: Decodable { let id: UUID }

    // MARK: Anlegen (handleCreateRide)

    static func anlegen(_ e: FahrtEingabe) async -> Ergebnis {
        let v: Vorbereitet
        switch await vorbereiten(e) {
        case let .failure(f): return (false, f.errorDescription)
        case let .success(w): v = w
        }
        do {
            let kolonne = try await kolonnenID(v.kolonne)
            let fahrer = v.fahrerNamen.isEmpty ? [] : await fahrerLaden()
            var fahrerIDs: [UUID] = []
            for n in v.fahrerNamen { if let f = fahrerID(n, fahrer), !fahrerIDs.contains(f) { fahrerIDs.append(f) } }
            let kolonnenSync = kolonne != nil || v.fahrerNamen.count > 1 || fahrerIDs.count > 1

            let zeile = jobSpalten(v, status: FahrtText.jobStatus(e.werte.aktuellerStatus), kolonne: kolonne,
                                   fahrer: fahrerIDs.first, aiBooked: false)
            let neu: NeueID = try await Backend.client.from("jobs").insert(zeile).select("id").single().execute().value

            await kolonneAbgleichen(neu.id, kolonnenSync ? fahrerIDs : [])
            if v.flug.gueltig { await FahrtPruefung.externerAbgleich(neu.id, grund: "create") }
            let notiz = FahrtText.getrimmt(e.notiz)
            if !notiz.isEmpty {
                _ = try? await Backend.client.from("job_notes")
                    .insert(["job_id": id(neu.id), "note_text": .string(notiz)] as [String: AnyJSON]).execute()
            }
            if !v.gaeste.isEmpty { await gaesteVerknuepfen(neu.id, v.gaeste) }
            return (true, nil)
        } catch {
            return (false, error.localizedDescription)
        }
    }

    // MARK: Aendern (handleSaveRideEdit)

    private struct BisherigerJob: Decodable {
        let driver_id: UUID?
        let status: String?
        let ride_date: String?
        let etd: String?
        let pickup_address: String?
        let dropoff_address: String?
    }

    static func aendern(_ e: FahrtEingabe, geladen: GeladeneFahrt) async -> Ergebnis {
        let fahrtID = geladen.id
        let v: Vorbereitet
        switch await vorbereiten(e) {
        case let .failure(f): return (false, f.errorDescription)
        case let .success(w): v = w
        }
        let c = Backend.client
        do {
            let kolonne = try await kolonnenID(v.kolonne)
            let fahrer = v.fahrerNamen.isEmpty ? [] : await fahrerLaden()
            var fahrerIDs: [UUID] = []
            for n in v.fahrerNamen { if let f = fahrerID(n, fahrer), !fahrerIDs.contains(f) { fahrerIDs.append(f) } }
            let offen = v.fahrerNamen.filter { fahrerID($0, fahrer) == nil }
            if !v.fahrerNamen.isEmpty && fahrerIDs.isEmpty {
                return (false, FahrtText.tr("app.fahrerNichtZugeordnet", ["names": v.fahrerNamen.joined(separator: ", ")]))
            }
            if !offen.isEmpty {
                return (false, FahrtText.tr("app.fahrerNichtAufgeloest", ["names": offen.joined(separator: ", ")]))
            }

            // Bisheriger Stand: entscheidet, ob der Fahrer neu bestaetigen muss.
            let bisher: BisherigerJob? = try? await c.from("jobs")
                .select("driver_id, status, ride_date, etd, pickup_address, dropoff_address")
                .eq("id", value: fahrtID).single().execute().value
            let fahrerNeu = fahrerIDs.first ?? bisher?.driver_id
            let gewuenscht = FahrtText.jobStatus(e.werte.aktuellerStatus)
            let endStatus = ["done", "completed", "cancelled", "canceled", "refused", "in_progress"].contains(gewuenscht)
            let gleicheUhr: (String?, String) -> Bool = { String(($0 ?? "").prefix(5)) == String($1.prefix(5)) }
            let fahrtGeaendert = bisher == nil
                || fahrerNeu != bisher?.driver_id
                || (bisher?.ride_date ?? "") != v.tag
                || !gleicheUhr(bisher?.etd, v.startZeit)
                || FahrtText.getrimmt(bisher?.pickup_address ?? "") != v.startAdresse
                || FahrtText.getrimmt(bisher?.dropoff_address ?? "") != v.zielAdresse
            let neuAnfragen = fahrerNeu != nil && !endStatus && fahrtGeaendert
            // Status nur schreiben, wenn die Dispo ihn im Editor geaendert hat. Sonst bleibt der
            // DB-Status (der Fahrer kann die Fahrt inzwischen beendet haben).
            let geladenStatus = FahrtText.jobStatus(geladen.werte.aktuellerStatus)
            let dispoGeaendert = gewuenscht != geladenStatus
            let bisherStatus = FahrtText.getrimmt(bisher?.status ?? "")
            let behalten = !bisherStatus.isEmpty && !dispoGeaendert && !fahrtGeaendert
            let naechster = neuAnfragen ? "pending" : (behalten ? (bisher?.status ?? gewuenscht) : gewuenscht)
            let kolonnenSync = kolonne != nil || v.fahrerNamen.count > 1 || fahrerIDs.count > 1
            let zuordnung = kolonnenSync ? fahrerIDs : (fahrerNeu.map { [$0] } ?? [])

            var zeile = jobSpalten(v, status: naechster, kolonne: kolonne, fahrer: fahrerNeu, aiBooked: geladen.aiBooked,
                                   mitOrtSpalten: geladen.mitOrtSpalten)
            if neuAnfragen {
                zeile["driver_response_status"] = "pending"
                zeile["driver_responded_at"] = .null
            }
            let geaendert: [NeueID] = try await c.from("jobs").update(zeile).eq("id", value: fahrtID)
                .select("id, passengers").execute().value
            if geaendert.isEmpty { throw TrisarFehler.text(FahrtText.tr("app.fahrtUpdateFehler")) }

            if v.flug.gueltig { await FahrtPruefung.externerAbgleich(fahrtID, grund: "manual_refresh") }
            await kolonneAbgleichen(fahrtID, zuordnung, statusZuruecksetzen: neuAnfragen, ersetzen: true)

            // Nur die Notizen der Disposition ersetzen, Fahrernotizen (mit author_name) bleiben.
            let notiz = [geladen.aiBooked ? aiTag : "", FahrtText.getrimmt(e.notiz)].filter { !$0.isEmpty }
                .joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
            try await c.from("job_notes").delete().eq("job_id", value: fahrtID).is("author_name", value: nil).execute()
            if !notiz.isEmpty {
                try await c.from("job_notes")
                    .insert(["job_id": id(fahrtID), "note_text": .string(notiz)] as [String: AnyJSON]).execute()
            }

            // Gast-Verknuepfungen neu setzen (auch wenn die Liste jetzt leer ist).
            _ = try? await c.from("job_guests").delete().eq("job_id", value: fahrtID).execute()
            await gaesteVerknuepfen(fahrtID, v.gaeste)
            return (true, nil)
        } catch {
            return (false, error.localizedDescription)
        }
    }

    // MARK: Loeschen (handleDeleteRide)

    static func loeschen(_ fahrtID: UUID) async -> Ergebnis {
        do {
            try await Backend.client.from("jobs").delete().eq("id", value: fahrtID).execute()
            return (true, nil)
        } catch {
            return (false, FahrtText.tr("app.fahrtStornierenFehler", ["error": error.localizedDescription]))
        }
    }

    // MARK: Kolonne (syncConvoyAssignmentsForJob)

    @discardableResult
    static func kolonneAbgleichen(_ fahrtID: UUID, _ fahrerIDs: [UUID], statusZuruecksetzen: Bool = false, ersetzen: Bool = false) async -> Bool {
        let c = Backend.client
        var ids: [UUID] = []
        for f in fahrerIDs where !ids.contains(f) { ids.append(f) }
        do {
            let bisher: [Zuordnung] = try await c.from("convoy_assignments").select("driver_id, response_status")
                .eq("job_id", value: fahrtID).execute().value
            var antwortNach: [UUID: String] = [:]
            for z in bisher {
                guard let d = z.driver_id, antwortNach[d] == nil else { continue }
                let s = FahrtText.getrimmt(z.response_status ?? "")
                antwortNach[d] = s.isEmpty ? "pending" : s
            }
            if ersetzen {
                try await c.from("convoy_assignments").delete().eq("job_id", value: fahrtID).execute()
            }
            if ids.isEmpty {
                try await c.from("convoy_assignments").delete().eq("job_id", value: fahrtID).execute()
                return true
            }
            let zeilen: [[String: AnyJSON]] = ids.map { d in
                ["job_id": id(fahrtID), "driver_id": id(d),
                 "response_status": .string(statusZuruecksetzen ? "pending" : (antwortNach[d] ?? "pending"))]
            }
            try await c.from("convoy_assignments").upsert(zeilen, onConflict: "job_id,driver_id").execute()
            let veraltet = bisher.compactMap(\.driver_id).filter { !ids.contains($0) }
            if !ersetzen && !veraltet.isEmpty {
                try await c.from("convoy_assignments").delete().eq("job_id", value: fahrtID)
                    .in("driver_id", values: veraltet.map(\.uuidString)).execute()
            }
            return true
        } catch {
            return false
        }
    }
}
