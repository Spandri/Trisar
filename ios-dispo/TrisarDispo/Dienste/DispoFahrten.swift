import Foundation
import Supabase
import UIKit

/// Eine Datenbankzeile, wie sie Supabase liefert. Die Web-App liest Spalten lose
/// (`String(job.x || '')`), darum hier ebenso als Woerterbuch statt festem Struct:
/// fehlende oder anders typisierte Spalten brechen das Laden nicht.
typealias DBZeile = [String: AnyJSON]

/// Zeiten einer Fahrt wie `ride.time` in admin/src/App.jsx. Leer = im Web undefined.
struct FahrtZeiten: Equatable {
    var original = ""
    var status = ""
    var neu = ""
    var zeit = ""
    var ankunftOriginal = ""
    var ankunftNeu = ""
    var ankunftZeit = ""
}

/// Eine Fahrt fuer die Listen, Felder wie das Mapping in loadRidesFromDb.
struct DispoFahrt: Identifiable, Equatable {
    let id: String
    var name: String
    var alleGaeste: [String]
    var route: String
    var startOrt: String
    var zielOrt: String
    var startZeit: String
    var fahrerNamen: [String]
    var fahrerAntworten: [String]
    var anonymeGaeste: Int
    var aktuellerStatus: String
    var fahrerNummer: String?
    var fahrer: String
    var konvoi: String
    var notiz: String
    var notizen: [String]
    var kiGebucht: Bool
    var zeiten: FahrtZeiten
    var verzugMinuten: Int
    /// `status === 'delayed'`
    var verspaetet: Bool
    /// `variant === 'variant2'` (kein Fahrer)
    var ohneFahrerVariante: Bool
    var datum: String
    var bestaetigt: Bool
    var jobStatus: String

    var archiviert: Bool { ["archived", "cancelled"].contains(jobStatus) }
}

/// Filter der Fahrtenliste (fahrtenFilter in App.jsx).
struct FahrtenFilterWerte: Equatable {
    var startSuche = ""
    var zielSuche = ""
    var datum = ""
    var ohneFahrer = false
    var bestaetigung = false
    var konvoi = false
    var besonderheiten = false
    var vergangene = false
}

/// Flughafen-Board (airportBoardState in App.jsx).
struct FlughafenBoard: Equatable {
    var code = ""
    var laedt = false
    var fehler = ""
    var stand = ""
    var eintraege: [DBZeile] = []
}

/// Laedt und haelt die Fahrten der Disposition wie loadRidesFromDb + Realtime in App.jsx.
/// Ein gemeinsamer Speicher, damit Filter und Standort wie im Web erhalten bleiben,
/// wenn man die Fahrten-Seite verlaesst und wiederkommt.
@MainActor
final class DispoFahrtenSpeicher: ObservableObject {
    static let gemeinsam = DispoFahrtenSpeicher()

    @Published private(set) var fahrten: [DispoFahrt] = []
    @Published private(set) var ladeFehler = ""
    @Published var filter = FahrtenFilterWerte()
    @Published var standort = ""
    @Published private(set) var board = FlughafenBoard()
    /// Meldung wie demoAlert im Web (Fehler beim Abschliessen/Archivieren/Duplizieren).
    @Published var meldung: String?

    private var gestartet = false
    private var kanal: RealtimeChannelV2?
    private var beobachter: [Task<Void, Never>] = []
    private var abfrage: Task<Void, Never>?
    private var spaeter: Task<Void, Never>?
    private var laedt = false
    private var nochmal = false
    /// Lokal archivierte Fahrten, bis jobs_archive sie liefert (locallyArchivedJobIdsRef).
    private var lokalArchiviert = Set<String>()

    private init() {}

    // MARK: Start, Realtime, Abgleich

    /// Einmal starten: laden, Realtime auf jobs/convoy_assignments/job_guests/job_notes,
    /// alle 60 s und beim Zurueckkehren in die App abgleichen (wie im Web).
    func starten() {
        guard !gestartet else { return }
        gestartet = true
        neuLaden()
        Task { await realtimeVerbinden() }
        abfrage = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(60))
                guard !Task.isCancelled else { return }
                self?.neuLaden()
            }
        }
        NotificationCenter.default.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor in
                guard let self else { return }
                self.neuLaden()
                if self.kanal == nil { await self.realtimeVerbinden() }
            }
        }
    }

    /// triggerRidesRefresh: laeuft schon eine Abfrage, danach genau einmal nachladen.
    func neuLaden() {
        if laedt { nochmal = true; return }
        laedt = true
        Task {
            await laden()
            laedt = false
            if nochmal { nochmal = false; neuLaden() }
        }
    }

    /// scheduleRidesRefresh(delayMs)
    private func spaeterLaden(_ ms: Int) {
        spaeter?.cancel()
        spaeter = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(ms))
            guard !Task.isCancelled else { return }
            self?.neuLaden()
        }
    }

    private func realtimeVerbinden() async {
        beobachter.forEach { $0.cancel() }
        beobachter = []
        if let alt = kanal { await Backend.client.removeChannel(alt) }
        let neu = Backend.client.channel("koordinator-rides-live-\(Int(Date().timeIntervalSince1970 * 1000))")
        let stroeme = ["jobs", "convoy_assignments", "job_guests", "job_notes"].map {
            neu.postgresChange(AnyAction.self, schema: "public", table: $0)
        }
        kanal = neu
        beobachter = stroeme.map { strom in
            Task { [weak self] in
                for await _ in strom { self?.neuLaden() }
            }
        }
        do {
            try await neu.subscribeWithError()
            neuLaden()
        } catch {
            // Wie im Web: neu laden und nach kurzer Pause wieder verbinden.
            neuLaden()
            kanal = nil
            try? await Task.sleep(for: .seconds(5))
            await realtimeVerbinden()
        }
    }

    // MARK: Laden (loadRidesFromDb)

    private static let spaltenBasis = "id, driver_id, pickup_name, pickup_address, dropoff_name, dropoff_address, ride_date, etd, original_etd, status, convoy_id, passengers, anonymous_guests, created_at, ext_flight_payload, ext_flight_last_sync_at, train_planned_time, train_predicted_time, ext_route_duration_mins, ext_route_duration_in_traffic_mins"
    private static let spaltenVarianten = [
        "\(spaltenBasis), ai_booked, flight_number, train_number",
        "\(spaltenBasis), flight_number, train_number",
        "\(spaltenBasis), ai_booked, train_number",
        "\(spaltenBasis), train_number",
        "\(spaltenBasis), ai_booked, flight_number",
        "\(spaltenBasis), flight_number",
        "\(spaltenBasis), ai_booked",
        spaltenBasis,
    ]

    func laden() async {
        ladeFehler = ""
        do {
            var jobs: [DBZeile] = []
            var letzterFehler: Error?
            for spalten in Self.spaltenVarianten {
                do {
                    jobs = try await Backend.client.from("jobs").select(spalten)
                        .order("ride_date", ascending: true).order("etd", ascending: true)
                        .execute().value
                    letzterFehler = nil
                    break
                } catch {
                    letzterFehler = error
                    let text = Self.text(error)
                    let fehlendeSpalte = Self.passt(text, #"column .*flight_number|could not find the ['"]?flight_number['"]? column"#)
                        || Self.passt(text, #"column .*ai_booked|could not find the ['"]?ai_booked['"]? column"#)
                        || Self.passt(text, #"column .*train_planned_time|column .*train_predicted_time|could not find the ['"]?train_planned_time['"]? column|could not find the ['"]?train_predicted_time['"]? column"#)
                        || Self.passt(text, #"column .*ext_flight_payload|column .*ext_flight_last_sync_at|could not find the ['"]?ext_flight_payload['"]? column|could not find the ['"]?ext_flight_last_sync_at['"]? column"#)
                    if !fehlendeSpalte { break }
                }
            }
            if let letzterFehler { throw letzterFehler }

            let jobIDs = jobs.map { W.t($0["id"]) }.filter { !$0.isEmpty }
            let jobFahrerIDs = Array(Set(jobs.map { W.t($0["driver_id"]) }.filter { !$0.isEmpty }))
            let konvoiIDs = Array(Set(jobs.map { W.t($0["convoy_id"]) }.filter { !$0.isEmpty }))

            let zuordnungen = try await stapelweise(jobIDs, tolerieren: #"relation .*convoy_assignments|table .*convoy_assignments|does not exist"#) {
                try await Backend.client.from("convoy_assignments").select("job_id, driver_id, response_status").in("job_id", values: $0).execute().value
            }
            let fahrerIDs = Array(Set(jobFahrerIDs + zuordnungen.map { W.t($0["driver_id"]) }.filter { !$0.isEmpty }))
            let profile = try await stapelweise(fahrerIDs) {
                try await Backend.client.from("profiles").select("id, first_name, last_name, driver_number").in("id", values: $0).execute().value
            }
            let jobGaeste = try await stapelweise(jobIDs) {
                try await Backend.client.from("job_guests").select("job_id, guest_id, is_main_contact").in("job_id", values: $0).execute().value
            }
            let notizZeilen = try await stapelweise(jobIDs, tolerieren: #"relation .*job_notes|table .*job_notes|does not exist"#) {
                try await Backend.client.from("job_notes").select("job_id, note_text, created_at, author_name")
                    .in("job_id", values: $0).order("created_at", ascending: false).execute().value
            }
            // Archiv: Fehler (fehlende Tabelle, keine Rechte) zaehlen wie leer.
            let archivZeilen = (try? await stapelweise(jobIDs) {
                try await Backend.client.from("jobs_archive").select("job_id").in("job_id", values: $0).execute().value
            }) ?? []
            let archivIDs = lokalArchiviert.union(archivZeilen.map { W.t($0["job_id"]) }.filter { !$0.isEmpty })
            let gastIDs = Array(Set(jobGaeste.map { W.t($0["guest_id"]) }.filter { !$0.isEmpty }))
            let gaeste = try await stapelweise(gastIDs) {
                try await Backend.client.from("guests").select("id, first_name, last_name").in("id", values: $0).execute().value
            }
            let konvois = try await stapelweise(konvoiIDs) {
                try await Backend.client.from("convoys").select("id, name").in("id", values: $0).execute().value
            }

            fahrten = Self.abbilden(jobs: jobs, zuordnungen: zuordnungen, profile: profile, jobGaeste: jobGaeste,
                                    notizZeilen: notizZeilen, archivIDs: archivIDs, gaeste: gaeste, konvois: konvois)
        } catch {
            fahrten = []
            let text = Self.text(error)
            ladeFehler = text.isEmpty ? "Fahrten konnten nicht geladen werden." : text
        }
    }

    /// runInBatches: IN-Abfragen in Paketen zu 30 IDs.
    private func stapelweise(_ ids: [String], tolerieren muster: String? = nil,
                             _ abfrage: ([String]) async throws -> [DBZeile]) async throws -> [DBZeile] {
        guard !ids.isEmpty else { return [] }
        var alle: [DBZeile] = []
        for start in stride(from: 0, to: ids.count, by: 30) {
            do {
                alle += try await abfrage(Array(ids[start..<min(start + 30, ids.count)]))
            } catch {
                if let muster, Self.passt(Self.text(error), muster) { return [] }
                throw error
            }
        }
        return alle
    }

    // MARK: Abbilden (das grosse jobs.map in loadRidesFromDb)

    private static let offenAehnlich: Set<String> = ["pending", "assigned", "offen", "new", "requested", "offered", "zugewiesen", "at_pickup", "beim_pickup", "beim pickup"]
    private static let unterwegsAehnlich: Set<String> = ["in_progress", "unterwegs", "started", "on_trip", "ongoing", "active"]

    private struct FahrerEintrag {
        var id: String
        var name: String
        var nummer: String
        var antwort: String
        var etikett: String
    }

    private static func abbilden(jobs: [DBZeile], zuordnungen: [DBZeile], profile: [DBZeile], jobGaeste: [DBZeile],
                                 notizZeilen: [DBZeile], archivIDs: Set<String>, gaeste: [DBZeile], konvois: [DBZeile]) -> [DispoFahrt] {
        let profilNachID = Dictionary(profile.map { (W.t($0["id"]), $0) }, uniquingKeysWith: { a, _ in a })
        let gastNachID = Dictionary(gaeste.map { (W.t($0["id"]), $0) }, uniquingKeysWith: { a, _ in a })
        let konvoiName = Dictionary(konvois.map { (W.t($0["id"]), W.t($0["name"])) }, uniquingKeysWith: { a, _ in a })

        // Neueste Notiz je Fahrt (auch vom Fahrer) und alle Notizen fuer die Karte.
        var notizNachJob: [String: (text: String, ki: Bool)] = [:]
        var dispoNotizNachJob: [String: (text: String, ki: Bool)] = [:]
        var alleNotizen: [String: [String]] = [:]
        for zeile in notizZeilen {
            let job = W.t(zeile["job_id"])
            guard !job.isEmpty else { continue }
            let roh = W.t(zeile["note_text"])
            let meta = (text: roh.replacingOccurrences(of: "[AI_BOOKED]", with: "").trimmingCharacters(in: .whitespacesAndNewlines),
                        ki: roh.contains("[AI_BOOKED]"))
            if notizNachJob[job] == nil { notizNachJob[job] = meta }
            if !meta.text.isEmpty { alleNotizen[job, default: []].append(meta.text) }
            if W.t(zeile["author_name"]).isEmpty && dispoNotizNachJob[job] == nil { dispoNotizNachJob[job] = meta }
        }

        var zuordnungNachJob: [String: [(fahrer: String, antwort: String)]] = [:]
        for zeile in zuordnungen {
            let job = W.t(zeile["job_id"]), fahrer = W.t(zeile["driver_id"])
            guard !job.isEmpty, !fahrer.isEmpty else { continue }
            zuordnungNachJob[job, default: []].append((fahrer, W.antwort(W.t(zeile["response_status"]))))
        }

        var gastLinks: [String: [DBZeile]] = [:]
        for zeile in jobGaeste {
            let job = W.t(zeile["job_id"])
            guard !job.isEmpty else { continue }
            gastLinks[job, default: []].append(zeile)
        }

        let heute = Datum.tagWert(Date())
        let jetzt = Date()
        let kal = Calendar.current
        let jetztUhr = String(format: "%02d:%02d", kal.component(.hour, from: jetzt), kal.component(.minute, from: jetzt))

        return jobs.map { job in
            let jobID = W.t(job["id"])
            let fahrerID = W.t(job["driver_id"])
            let abholName = W.t(job["pickup_name"]), abholAdresse = W.t(job["pickup_address"])
            let zielName = W.t(job["dropoff_name"]), zielAdresse = W.t(job["dropoff_address"])
            let startEtikett = W.ortEtikett(abholName, abholAdresse)
            let zielEtikett = W.ortEtikett(zielName, zielAdresse)
            let startWert = !abholAdresse.isEmpty ? abholAdresse : (!abholName.isEmpty ? abholName : startEtikett)
            let zielWert = !zielAdresse.isEmpty ? zielAdresse : (!zielName.isEmpty ? zielName : zielEtikett)

            func eintrag(_ profil: DBZeile?, _ ersatzID: String, _ antwort: String) -> FahrerEintrag {
                let name = [W.t(profil?["first_name"]), W.t(profil?["last_name"])].filter { !$0.isEmpty }.joined(separator: " ")
                let nummer = W.t(profil?["driver_number"])
                let etikett = !name.isEmpty && !nummer.isEmpty ? "\(name) (\(nummer))" : (!name.isEmpty ? name : nummer)
                let id = W.t(profil?["id"])
                return FahrerEintrag(id: id.isEmpty ? ersatzID : id, name: name, nummer: nummer, antwort: W.antwort(antwort), etikett: etikett)
            }

            let zeilen = zuordnungNachJob[jobID] ?? []
            var antwortNachFahrer: [String: String] = [:]
            for z in zeilen {
                let vorher = antwortNachFahrer[z.fahrer]
                if vorher == nil || vorher == "pending" { antwortNachFahrer[z.fahrer] = z.antwort }
                else if vorher == "refused" && z.antwort == "accepted" { antwortNachFahrer[z.fahrer] = z.antwort }
            }
            let hauptAntwort = antwortNachFahrer[fahrerID] ?? W.antwort(W.t(job["status"]))
            let hauptProfil = fahrerID.isEmpty ? nil : profilNachID[fahrerID]
            let haupt = hauptProfil.map { eintrag($0, fahrerID, hauptAntwort) }
            var zugeordneteIDs: [String] = []
            for z in zeilen where !zugeordneteIDs.contains(z.fahrer) { zugeordneteIDs.append(z.fahrer) }
            let zugeordnete = zugeordneteIDs
                .map { eintrag(profilNachID[$0], $0, antwortNachFahrer[$0] ?? "pending") }
                .filter { !$0.etikett.isEmpty }

            // Doppelte Fahrer zusammenfuehren, Reihenfolge wie Map im Web.
            var zusammen: [FahrerEintrag] = []
            var index: [String: Int] = [:]
            for e in ([haupt].compactMap { $0 } + zugeordnete) {
                let schluessel = !e.id.isEmpty ? e.id : W.ortNormal(e.name)
                guard !schluessel.isEmpty else { continue }
                if let i = index[schluessel] {
                    let alt = zusammen[i]
                    let antwort = alt.antwort == "accepted" || e.antwort == "accepted" ? "accepted"
                        : (alt.antwort == "refused" || e.antwort == "refused" ? "refused" : "pending")
                    var neu = e
                    neu.etikett = !alt.etikett.isEmpty ? alt.etikett : e.etikett
                    neu.antwort = antwort
                    zusammen[i] = neu
                } else {
                    index[schluessel] = zusammen.count
                    zusammen.append(e)
                }
            }
            let etiketten = zusammen.map(\.etikett).filter { !$0.isEmpty }
            let antworten = zusammen.map(\.antwort)
            let hatFahrer = !etiketten.isEmpty
            let einzelNummer: String? = hatFahrer && zusammen.count == 1 && !zusammen[0].nummer.isEmpty ? zusammen[0].nummer : nil
            let hatKonvoi = !W.t(job["convoy_id"]).isEmpty || zusammen.count > 1

            // Gaeste: Hauptkontakt zuerst.
            let links = (gastLinks[jobID] ?? []).enumerated().sorted { a, b in
                let ha = a.element["is_main_contact"]?.boolValue == true, hb = b.element["is_main_contact"]?.boolValue == true
                return ha != hb ? ha : a.offset < b.offset
            }.map(\.element)
            let ersterGast = gastNachID[W.t(links.first?["guest_id"])]
            let gastNamen = links.compactMap { gastNachID[W.t($0["guest_id"])] }
                .map { [W.t($0["first_name"]), W.t($0["last_name"])].filter { !$0.isEmpty }.joined(separator: " ") }
                .filter { !$0.isEmpty }
            let gastName = [W.t(ersterGast?["first_name"]), W.t(ersterGast?["last_name"])].filter { !$0.isEmpty }.joined(separator: " ")
            let passagiereRoh = W.passagiere(job["passengers"])
            let altAnonym = passagiereRoh.filter { W.passt($0, #"^anonymer?\s+fahrgast(?:\s+\d+)?$"#, gross: false) }.count
            let passagiere = passagiereRoh.filter { !W.passt($0, #"^anonymer?\s+fahrgast(?:\s+\d+)?$"#, gross: false) }
            let anonym = max(max(0, W.ganzzahl(job["anonymous_guests"]) ?? 0), altAnonym)
            let hatPassagierObjekt: Bool = {
                switch job["passengers"] { case .array, .object: return true; default: return false }
            }()
            let wirksameGaeste = hatPassagierObjekt ? passagiere : (gastNamen.isEmpty ? passagiere : gastNamen)
            let hauptGast = !gastName.isEmpty ? gastName : (wirksameGaeste.first ?? "")

            var etd = W.uhr(W.t(job["etd"]))
            var originalEtd = W.uhr(W.t(job["original_etd"]))
            let rohStatus = W.t(job["status"]).lowercased()
            let jobStatus = archivIDs.contains(jobID) ? "archived" : rohStatus
            let zugnummer = W.t(job["train_number"])
            let zugGeplant = W.uhr(W.t(job["train_planned_time"]))
            let zugErwartet = W.uhr(W.t(job["train_predicted_time"]))
            if !zugnummer.isEmpty, let summary = job["ext_flight_payload"]?.objectValue?["summary"]?.objectValue {
                let geplant = W.uhr(W.uhrAusISO(W.t(summary["scheduled_arrival_local"])))
                let erwartet = W.uhr(W.uhrAusISO(W.t(summary["estimated_arrival_local"])))
                if !erwartet.isEmpty && zugErwartet.isEmpty { etd = erwartet }
                if !geplant.isEmpty && zugGeplant.isEmpty { originalEtd = geplant }
            }
            if !zugnummer.isEmpty {
                if !zugErwartet.isEmpty { etd = zugErwartet }
                if !zugGeplant.isEmpty { originalEtd = zugGeplant }
            }
            let unterwegs = unterwegsAehnlich.contains(jobStatus)
            let offen = offenAehnlich.contains(jobStatus)
            let datum = W.tagWert(W.t(job["ride_date"]), ersatz: heute)
            let geplantMin = W.minuten(!originalEtd.isEmpty ? originalEtd : etd)
            let jetztMin = W.minuten(jetztUhr)
            let verschieben = datum == heute && offen && geplantMin != nil && jetztMin != nil && jetztMin! > geplantMin!
            let verzug = verschieben ? max(0, jetztMin! - geplantMin!) : 0
            let wirksameEtd = verschieben ? jetztUhr : (!etd.isEmpty ? etd : originalEtd)
            let mitVerkehr = W.zahl(job["ext_route_duration_in_traffic_mins"]) ?? 0
            let ohneVerkehr = W.zahl(job["ext_route_duration_mins"]) ?? 0
            let dauer = mitVerkehr > 0 ? mitVerkehr : (ohneVerkehr > 0 ? ohneVerkehr : 0)
            let bezug = unterwegs ? jetztUhr : wirksameEtd
            let ankunftNeu = W.erste(W.plus(bezug, dauer), W.plus(wirksameEtd, dauer), W.plus(originalEtd, dauer),
                                     bezug, wirksameEtd, originalEtd) ?? "--:--"
            let ankunftOriginal = W.erste(W.plus(originalEtd, dauer), W.plus(wirksameEtd, dauer), originalEtd, wirksameEtd) ?? "--:--"
            let verspaetet = verzug > 0 || (!wirksameEtd.isEmpty && !originalEtd.isEmpty && wirksameEtd != originalEtd)
            let notiz = notizNachJob[jobID] ?? ("", false)
            let dispoNotiz = dispoNotizNachJob[jobID] ?? ("", false)
            let kiSpalte = job["ai_booked"]?.boolValue == true

            var zeiten = FahrtZeiten()
            if verspaetet {
                zeiten.original = W.erste(originalEtd, wirksameEtd) ?? "--:--"
                zeiten.neu = W.erste(wirksameEtd, originalEtd) ?? "--:--"
            } else {
                zeiten.zeit = W.erste(wirksameEtd) ?? "--:--"
            }
            zeiten.ankunftOriginal = ankunftOriginal
            zeiten.ankunftNeu = ankunftNeu
            zeiten.ankunftZeit = ankunftNeu

            return DispoFahrt(
                id: jobID,
                name: !hauptGast.isEmpty ? hauptGast : startEtikett,
                alleGaeste: wirksameGaeste,
                route: "\(startEtikett) - \(zielEtikett)",
                startOrt: startWert,
                zielOrt: zielWert,
                startZeit: W.erste(wirksameEtd, originalEtd) ?? "--:--",
                fahrerNamen: hatFahrer ? etiketten : [""],
                fahrerAntworten: hatFahrer ? antworten : [],
                anonymeGaeste: anonym,
                aktuellerStatus: W.editorStatus(jobStatus),
                fahrerNummer: einzelNummer,
                fahrer: hatFahrer ? etiketten.joined(separator: ", ") : "Fahrer fehlt",
                konvoi: konvoiName[W.t(job["convoy_id"])].flatMap { $0.isEmpty ? nil : $0 } ?? (hatKonvoi ? "Kolonne" : ""),
                notiz: notiz.text,
                notizen: Array((alleNotizen[jobID] ?? []).reversed()),
                kiGebucht: kiSpalte || notiz.ki || dispoNotiz.ki,
                zeiten: zeiten,
                verzugMinuten: verzug,
                verspaetet: verspaetet,
                ohneFahrerVariante: !hatFahrer,
                datum: datum,
                bestaetigt: antworten.contains("accepted"),
                jobStatus: jobStatus
            )
        }
    }

    // MARK: Aktionen beim Wischen (nur auf Knopfdruck, wie im Web)

    /// handleMarkRideDone: status = done.
    func erledigt(_ fahrt: DispoFahrt) async {
        do {
            let ergebnis: [DBZeile] = try await Backend.client.from("jobs").update(["status": AnyJSON.string("done")])
                .eq("id", value: fahrt.id).select("id").execute().value
            _ = ergebnis
            fahrten = fahrten.map { f in
                guard f.id == fahrt.id else { return f }
                var neu = f; neu.aktuellerStatus = "beendet"; neu.bestaetigt = true; return neu
            }
            spaeterLaden(1200)
        } catch {
            meldung = "Status konnte nicht auf abgeschlossen gesetzt werden: \(Self.textOderUnbekannt(error))"
        }
    }

    /// handleArchiveRide: status = cancelled, dazu Eintrag in jobs_archive.
    func archivieren(_ fahrt: DispoFahrt, ansicht: String) async {
        do {
            let ergebnis: [DBZeile] = try await Backend.client.from("jobs").update(["status": AnyJSON.string("cancelled")])
                .eq("id", value: fahrt.id).select("id").execute().value
            if ergebnis.isEmpty { throw TrisarFehler.text("Archivierung fehlgeschlagen: keine Zeile in jobs aktualisiert.") }
            let schnappschuss: DBZeile = [
                "rideId": .string(fahrt.id),
                "sourceView": .string(ansicht),
                "date": .string(fahrt.datum),
                "start": .string(fahrt.startOrt),
                "ziel": .string(fahrt.zielOrt),
                "driver": .string(fahrt.fahrer),
                "status": .string(!fahrt.jobStatus.isEmpty ? fahrt.jobStatus : fahrt.aktuellerStatus),
                "captured_at": .string(Datum.iso(Date())),
            ]
            let eintrag: DBZeile = ["job_id": .string(fahrt.id), "archived_by": .string("admin-app"), "snapshot": .object(schnappschuss)]
            // Fehlt die Archiv-Tabelle oder scheitert der Eintrag, bleibt die Fahrt trotzdem archiviert (Web: nur Warnung).
            _ = try? await Backend.client.from("jobs_archive").insert(eintrag).execute()
            lokalArchiviert.insert(fahrt.id)
            fahrten = fahrten.map { f in
                guard f.id == fahrt.id else { return f }
                var neu = f; neu.jobStatus = "cancelled"; neu.aktuellerStatus = "stoniert"; return neu
            }
            spaeterLaden(1200)
        } catch {
            meldung = "Fahrt konnte nicht archiviert werden: \(Self.textOderUnbekannt(error))"
        }
    }

    /// handleDuplicateRide: Fahrt mit Notizen, Gaesten und Kolonnen-Zuordnungen kopieren.
    func duplizieren(_ fahrt: DispoFahrt) async {
        do {
            var kopie: DBZeile = try await Backend.client.from("jobs").select("*").eq("id", value: fahrt.id)
                .single().execute().value
            kopie["id"] = nil
            kopie["created_at"] = nil
            kopie["updated_at"] = nil
            let neu: DBZeile = try await Backend.client.from("jobs").insert(kopie).select("id").single().execute().value
            let neueID = W.t(neu["id"])
            if neueID.isEmpty { throw TrisarFehler.text("Duplizierte Fahrt konnte nicht angelegt werden.") }

            let fehltNotizen = #"relation .*job_notes|table .*job_notes|does not exist"#
            do {
                let notizen: [DBZeile] = try await Backend.client.from("job_notes").select("note_text")
                    .eq("job_id", value: fahrt.id).order("created_at", ascending: true).execute().value
                let zeilen: [DBZeile] = notizen.map { W.t($0["note_text"]) }.filter { !$0.isEmpty }
                    .map { ["job_id": .string(neueID), "note_text": .string($0)] }
                if !zeilen.isEmpty {
                    do { try await Backend.client.from("job_notes").insert(zeilen).execute() }
                    catch { if !Self.passt(Self.text(error), fehltNotizen) { throw error } }
                }
            } catch {
                if !Self.passt(Self.text(error), fehltNotizen) { throw error }
            }

            let gaeste: [DBZeile] = try await Backend.client.from("job_guests").select("guest_id, is_main_contact")
                .eq("job_id", value: fahrt.id).execute().value
            let gastZeilen: [DBZeile] = gaeste.compactMap { z in
                guard let gast = z["guest_id"], !gast.isNil else { return nil }
                return ["job_id": .string(neueID), "guest_id": gast, "is_main_contact": .bool(z["is_main_contact"]?.boolValue == true)]
            }
            if !gastZeilen.isEmpty {
                try await Backend.client.from("job_guests").upsert(gastZeilen, onConflict: "job_id,guest_id").execute()
            }

            let fehltKolonne = #"relation .*convoy_assignments|table .*convoy_assignments|does not exist"#
            do {
                let zuordnungen: [DBZeile] = try await Backend.client.from("convoy_assignments").select("driver_id, response_status")
                    .eq("job_id", value: fahrt.id).execute().value
                let zeilen: [DBZeile] = zuordnungen.compactMap { z in
                    guard let fahrer = z["driver_id"], !fahrer.isNil else { return nil }
                    let antwort = W.t(z["response_status"])
                    return ["job_id": .string(neueID), "driver_id": fahrer, "response_status": .string(antwort.isEmpty ? "pending" : antwort)]
                }
                if !zeilen.isEmpty {
                    do { try await Backend.client.from("convoy_assignments").upsert(zeilen, onConflict: "job_id,driver_id").execute() }
                    catch { if !Self.passt(Self.text(error), fehltKolonne) { throw error } }
                }
            } catch {
                if !Self.passt(Self.text(error), fehltKolonne) { throw error }
            }

            // Sofort hinter dem Original zeigen, der Abgleich folgt.
            let lokal = DispoFahrt(id: neueID, name: fahrt.name, alleGaeste: fahrt.alleGaeste, route: fahrt.route, startOrt: fahrt.startOrt,
                               zielOrt: fahrt.zielOrt, startZeit: fahrt.startZeit, fahrerNamen: fahrt.fahrerNamen,
                               fahrerAntworten: fahrt.fahrerAntworten, anonymeGaeste: fahrt.anonymeGaeste,
                               aktuellerStatus: fahrt.aktuellerStatus, fahrerNummer: fahrt.fahrerNummer, fahrer: fahrt.fahrer,
                               konvoi: fahrt.konvoi, notiz: fahrt.notiz, notizen: fahrt.notizen, kiGebucht: fahrt.kiGebucht,
                               zeiten: fahrt.zeiten, verzugMinuten: fahrt.verzugMinuten, verspaetet: fahrt.verspaetet,
                               ohneFahrerVariante: fahrt.ohneFahrerVariante, datum: fahrt.datum, bestaetigt: fahrt.bestaetigt,
                               jobStatus: fahrt.jobStatus)
            if let i = fahrten.firstIndex(where: { $0.id == fahrt.id }) { fahrten.insert(lokal, at: i + 1) }
            else { fahrten.insert(lokal, at: 0) }
            spaeterLaden(1200)
        } catch {
            meldung = "Fahrt konnte nicht dupliziert werden: \(Self.textOderUnbekannt(error))"
        }
    }

    // MARK: Flughafen-Board (refreshAirportBoard)

    func boardLaden(abfahrten: Bool) async {
        let code = W.flughafenCode(standort)
        guard !W.ortNormal(standort).isEmpty, !code.isEmpty else {
            board = FlughafenBoard()
            return
        }
        board.code = code
        board.laedt = true
        board.fehler = ""
        let koerper: DBZeile = [
            "airport_code": .string(code),
            "mode": .string(abfahrten ? "departures" : "arrivals"),
            "date": .string(Datum.tagWert(Date())),
            "limit": .integer(8),
            "include_codeshare": .bool(false),
        ]
        do {
            let antwort: DBZeile = try await Backend.client.functions.invoke("airport-board", options: FunctionInvokeOptions(body: koerper))
            let stand = W.t(antwort["fetched_at"])
            board = FlughafenBoard(code: code, laedt: false, fehler: W.t(antwort["error"]),
                                   stand: stand.isEmpty ? Datum.iso(Date()) : stand,
                                   eintraege: (antwort["items"]?.arrayValue ?? []).compactMap(\.objectValue))
        } catch {
            board.laedt = false
            let text = Self.text(error)
            board.fehler = text.isEmpty ? "Flughafenboard konnte nicht geladen werden." : text
        }
    }

    // MARK: Hilfen

    static func text(_ error: Error) -> String {
        if let p = error as? PostgrestError { return p.message }
        return error.localizedDescription
    }

    private static func textOderUnbekannt(_ error: Error) -> String {
        let t = text(error)
        return t.isEmpty ? "Unbekannter Fehler" : t
    }

    static func passt(_ text: String, _ muster: String) -> Bool { W.passt(text, muster, gross: false) }
}

/// Kleine Nachbauten der Web-Hilfsfunktionen aus App.jsx und den Listenansichten.
enum W {
    /// `String(wert || '').trim()`
    static func t(_ wert: AnyJSON?) -> String {
        guard let wert else { return "" }
        let roh: String
        switch wert {
        case .string(let s): roh = s
        case .integer(let i): roh = i == 0 ? "" : String(i)
        case .double(let d): roh = d == 0 ? "" : (d == d.rounded() ? String(Int(d)) : String(d))
        case .bool(let b): roh = b ? "true" : ""
        default: roh = ""
        }
        return roh.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    static func zahl(_ wert: AnyJSON?) -> Double? {
        switch wert {
        case .integer(let i): return Double(i)
        case .double(let d): return d
        case .string(let s): return Double(s.trimmingCharacters(in: .whitespaces))
        default: return nil
        }
    }

    /// `Number.parseInt(String(wert), 10)`
    static func ganzzahl(_ wert: AnyJSON?) -> Int? {
        switch wert {
        case .integer(let i): return i
        case .double(let d): return Int(d)
        case .string(let s):
            let ziffern = s.trimmingCharacters(in: .whitespaces).prefix { $0.isNumber || $0 == "-" }
            return Int(ziffern)
        default: return nil
        }
    }

    static func passt(_ text: String, _ muster: String, gross: Bool = true) -> Bool {
        text.range(of: muster, options: gross ? [.regularExpression] : [.regularExpression, .caseInsensitive]) != nil
    }

    static func erste(_ werte: String...) -> String? { werte.first { !$0.isEmpty } }

    static func antwort(_ wert: String) -> String {
        let n = wert.trimmingCharacters(in: .whitespaces).lowercased()
        if n.isEmpty { return "pending" }
        if ["accepted", "assigned", "in_progress", "done", "arrived", "completed"].contains(n) { return "accepted" }
        if ["refused", "cancelled", "canceled", "declined", "rejected"].contains(n) { return "refused" }
        return "pending"
    }

    static func editorStatus(_ status: String) -> String {
        switch status {
        case "in_progress": return "unterwegs"
        case "done": return "beendet"
        case "cancelled", "refused", "archived": return "stoniert"
        default: return "offen"
        }
    }

    /// normalizeClockValue(wert, '')
    static func uhr(_ wert: String) -> String {
        guard let m = minuten(wert, praefix: true) else { return "" }
        return String(format: "%02d:%02d", m / 60, m % 60)
    }

    /// parseClockToMinutes; `praefix` = darf nach HH:MM weitergehen (z.B. Sekunden).
    static func minuten(_ wert: String, praefix: Bool = true) -> Int? {
        let s = wert.trimmingCharacters(in: .whitespaces)
        let muster = praefix ? #"^(\d{1,2}):(\d{2})"# : #"^(\d{1,2}):(\d{2})$"#
        guard let r = s.range(of: muster, options: .regularExpression) else { return nil }
        let teile = s[r].split(separator: ":").compactMap { Int($0) }
        guard teile.count == 2, (0...23).contains(teile[0]), (0...59).contains(teile[1]) else { return nil }
        return teile[0] * 60 + teile[1]
    }

    static func plus(_ uhr: String, _ dauer: Double) -> String {
        guard let basis = minuten(uhr), dauer > 0 else { return "" }
        let summe = ((basis + Int(dauer)) % 1440 + 1440) % 1440
        return String(format: "%02d:%02d", summe / 60, summe % 60)
    }

    static func uhrAusISO(_ wert: String) -> String {
        if let r = wert.range(of: #"T\d{2}:\d{2}"#, options: .regularExpression) { return String(wert[r].dropFirst()) }
        return uhr(wert)
    }

    /// normalizeRideDateValue
    static func tagWert(_ wert: String, ersatz: String = "") -> String {
        if wert.isEmpty { return ersatz }
        if passt(wert, #"^\d{4}-\d{2}-\d{2}$"#) { return wert }
        if passt(wert, #"^\d{2}\.\d{2}\.\d{4}$"#) {
            let t = wert.split(separator: ".")
            return "\(t[2])-\(t[1])-\(t[0])"
        }
        if passt(wert, #"^\d{4}-\d{2}-\d{2}T"#) { return String(wert.prefix(10)) }
        return ersatz
    }

    /// extractLocationLabel: Name bis zum ersten Komma, sonst Adresse, sonst '-'.
    static func ortEtikett(_ name: String, _ adresse: String) -> String {
        func kurz(_ s: String) -> String {
            let t = s.trimmingCharacters(in: .whitespaces)
            if t.isEmpty { return "" }
            let vorne = (t.split(separator: ",", omittingEmptySubsequences: false).first.map(String.init) ?? "").trimmingCharacters(in: .whitespaces)
            return vorne.isEmpty ? t : vorne
        }
        let n = kurz(name)
        if !n.isEmpty { return n }
        if adresse.isEmpty { return "-" }
        let a = kurz(adresse)
        return a.isEmpty ? adresse : a
    }

    /// normalizeLocation
    static func ortNormal(_ wert: String) -> String {
        var s = wert.lowercased().decomposedStringWithCanonicalMapping
        s = String(String.UnicodeScalarView(s.unicodeScalars.filter { !(0x300...0x36F).contains($0.value) }))
        s = s.replacingOccurrences(of: "ß", with: "ss")
            .replacingOccurrences(of: "ae", with: "a").replacingOccurrences(of: "oe", with: "o").replacingOccurrences(of: "ue", with: "u")
        s = s.replacingOccurrences(of: "[^a-z0-9]+", with: " ", options: .regularExpression)
        return s.replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression).trimmingCharacters(in: .whitespaces)
    }

    /// matchesLocation
    static func ortPasst(_ heuhaufen: String, _ nadel: String) -> Bool {
        let l = ortNormal(heuhaufen), r = ortNormal(nadel)
        guard !l.isEmpty, !r.isEmpty else { return false }
        return l.contains(r) || r.contains(l)
    }

    /// extractPassengerNames
    static func passagiere(_ wert: AnyJSON?) -> [String] {
        switch wert {
        case .array(let a): return a.map { t($0) }.filter { !$0.isEmpty }
        case .object(let o): return o.values.map { t($0) }.filter { !$0.isEmpty }
        case .string(let s):
            return s.components(separatedBy: CharacterSet(charactersIn: "\n,;"))
                .map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
        default: return []
        }
    }

    private static let bekannteCodes: Set<String> = ["MUC", "FRA", "BER", "HAM", "DUS", "STR", "CGN", "LEJ", "NUE", "HAJ", "BRE", "DRS",
                                                     "VIE", "ZRH", "GVA", "BRU", "LUX", "PRG", "WAW", "MAD", "BCN", "CDG", "AMS", "LHR"]
    private static let stichworte: [(String, String)] = [
        ("muenchen", "MUC"), ("munchen", "MUC"), ("münchen", "MUC"), ("frankfurt", "FRA"), ("berlin brandenburg", "BER"),
        ("hamburg", "HAM"), ("duesseldorf", "DUS"), ("düsseldorf", "DUS"), ("stuttgart", "STR"), ("koeln", "CGN"), ("köln", "CGN"),
        ("vienna", "VIE"), ("wien", "VIE"), ("zurich", "ZRH"), ("zuerich", "ZRH"), ("zürich", "ZRH"), ("brussels", "BRU"),
        ("bruessel", "BRU"), ("brüssel", "BRU"), ("luxembourg", "LUX"),
    ]

    /// resolveAirportCodeFromLocation
    static func flughafenCode(_ wert: String) -> String {
        let roh = wert.trimmingCharacters(in: .whitespaces)
        guard !roh.isEmpty else { return "" }
        let gross = roh.uppercased()
        if let r = gross.range(of: #"\(([A-Z]{3})\)"#, options: .regularExpression) {
            let code = String(gross[r].dropFirst().dropLast())
            if bekannteCodes.contains(code) { return code }
        }
        let regex = try? NSRegularExpression(pattern: #"\b[A-Z]{3}\b"#)
        for treffer in regex?.matches(in: gross, range: NSRange(gross.startIndex..., in: gross)) ?? [] {
            if let r = Range(treffer.range, in: gross), bekannteCodes.contains(String(gross[r])) { return String(gross[r]) }
        }
        let normal = ortNormal(roh)
        for (wort, code) in stichworte where normal.contains(wort) { return code }
        return ""
    }
}
