import Foundation
import Supabase

// MARK: - Datenzeilen (wie in der Datenbank)

/// Zeile aus `jobs`. Nur Felder, die die App braucht. Spaltennamen wie in der Datenbank.
struct FahrtZeile: Decodable {
    let id: UUID
    let status: String?
    let trip_type: String?
    let pickup_name: String?
    let pickup_address: String?
    let dropoff_name: String?
    let dropoff_address: String?
    let train_number: String?
    let flight_number: String?
    let ride_date: String?
    let pickup_date: String?
    let service_date: String?
    let created_at: String?
    let etd: String?
    let original_etd: String?
    let convoy_id: UUID?
    let driver_id: UUID?
    /// Eigene Orte der Dispo (fehlen die Spalten noch, bleiben sie leer).
    let pickup_ort_id: UUID?
    let dropoff_ort_id: UUID?
    let zwischenstopps: [String]?
}

struct FahrzeugZeile: Decodable, Equatable {
    let id: UUID
    let license_plate: String?
    let brand_model: String?
    let vin: String?
    let image_url: String?
    let fuel_type: String?
    let color: String?
    let seat_count: Int?
    let battery_fuel_percent: Double?
    let range_km: Double?
}

struct DienstAnfrage: Decodable, Identifiable, Equatable {
    let id: UUID
    let service_date: String?
    let service_start_time: String?
    let service_end_time: String?
    let status: String?

    var angenommen: Bool { (status ?? "").lowercased() == "accepted" }
}

// MARK: - Fahrt fuer die Anzeige

/// Aufbereitete Fahrt, entspricht dem Job-Objekt der Web-App (FahrerApp.jsx).
struct Fahrt: Identifiable, Equatable {
    let id: UUID
    var status: String
    let tripType: String?
    let abholName: String
    let abholAdresse: String
    let zielName: String
    let zielAdresse: String
    let zugNummer: String?
    let flug: String
    let fahrtDatum: String      // yyyy-MM-dd
    let etd: String             // HH:mm
    let planEtd: String?
    let kolonnenID: UUID?
    let istKolonne: Bool
    var meineAntwort: String    // convoy_assignments.response_status
    /// Gewaehlter eigener Ort (jobs.pickup_ort_id / dropoff_ort_id): dessen Icon statt Textmuster.
    var abholOrtID: UUID? = nil
    var zielOrtID: UUID? = nil
    var zwischenstopps: [String] = []

    /// Kurzname fuer die Karte (wie toShortFormattedAddress + kurzAdresse).
    var abholKurz: String { Adresse.kurz(name: abholName, adresse: abholAdresse) }
    var zielKurz: String { Adresse.kurz(name: zielName, adresse: zielAdresse) }

    var istFlughafen: Bool { tripType == "airport" }
    var istZug: Bool {
        if tripType == "train" { return true }
        if let zug = zugNummer, !zug.trimmingCharacters(in: .whitespaces).isEmpty { return true }
        return flug.trimmingCharacters(in: .whitespaces).uppercased()
            .range(of: #"^([A-Z]{1,4}\s*)?\d{2,5}$"#, options: .regularExpression) != nil
    }

    /// Fahrer muss noch annehmen oder ablehnen (canRespond der Web-App).
    var wartetAufAntwort: Bool {
        if istKolonne {
            return ["pending", "new", "offered", "requested"].contains(meineAntwort.lowercased())
        }
        return ["pending", "new", "offered", "requested", "assigned_pending"].contains(status.lowercased())
    }

    /// Angenommen = Lime-Rand um die Karte.
    var angenommen: Bool {
        istKolonne ? meineAntwort.lowercased() == "accepted" : status.lowercased() == "assigned"
    }
}

enum Adresse {
    private static let hausnummer = #"^\d+\s?[a-zA-Z]?(\s*[-/]\s*\d+\s?[a-zA-Z]?)?$"#

    /// Wie kurzAdresse() der Web-App: "153, Thalkirchner Straße, ..." -> "Thalkirchner Straße 153".
    static func kurzAdresse(_ text: String) -> String {
        let roh = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !roh.isEmpty else { return "" }
        let teile = roh.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
        guard let erster = teile.first else { return roh }
        if erster.range(of: hausnummer, options: .regularExpression) != nil, teile.count > 1 {
            return "\(teile[1]) \(erster)"
        }
        return erster
    }

    static func kurz(name: String, adresse: String) -> String {
        let n = name.trimmingCharacters(in: .whitespacesAndNewlines)
        if !n.isEmpty { return kurzAdresse(n).isEmpty ? n : kurzAdresse(n) }
        let a = adresse.trimmingCharacters(in: .whitespacesAndNewlines)
        if a.isEmpty { return "Unbekannt" }
        return kurzAdresse(a).isEmpty ? a : kurzAdresse(a)
    }
}

// MARK: - Speicher

/// Laedt Fahrten, Fahrzeug und Dienstanfragen des Fahrers, haelt sie per Realtime aktuell.
/// Gleiche Abfragen wie loadData() in FahrerApp.jsx.
@MainActor
final class FahrtenSpeicher: ObservableObject {
    @Published private(set) var fahrten: [Fahrt] = []
    @Published private(set) var fahrzeug: FahrzeugZeile?
    @Published private(set) var dienstAnfragen: [DienstAnfrage] = []
    @Published private(set) var geladen = false
    @Published private(set) var arbeitet = false
    @Published var fehler: String?
    /// Ungelesene Nachrichten je Kolonnen-Chat (convoy_id).
    @Published private(set) var ungelesen: [UUID: Int] = [:]

    private var fahrerID: UUID?
    private var kanal: RealtimeChannelV2?
    private var beobachter: [Task<Void, Never>] = []
    private var nachladen: Task<Void, Never>?

    private static let versteckt: Set<String> = [
        "done", "completed", "arrived", "beendet", "cancelled", "canceled", "refused", "storniert", "stoniert",
    ]

    func setzeFahrer(_ id: UUID?) {
        guard id != fahrerID else { return }
        fahrerID = id
        fahrten = []
        fahrzeug = nil
        dienstAnfragen = []
        geladen = false
        Task { await abmeldenRealtime() }
        guard id != nil else { return }
        Task {
            await laden()
            await realtimeStarten()
        }
    }

    func laden() async {
        guard let fahrer = fahrerID else { return }
        do {
            async let profilAbfrage: [ProfilFahrzeug] = Backend.client.from("profiles")
                .select("vehicle_id").eq("id", value: fahrer).limit(1).execute().value
            async let direktAbfrage: [FahrtZeile] = Backend.client.from("jobs")
                .select().eq("driver_id", value: fahrer)
                .neq("status", value: "cancelled").neq("status", value: "refused")
                .order("created_at", ascending: false).execute().value
            async let kolonnenAbfrage: [KolonnenLink] = Backend.client.from("convoy_assignments")
                .select("job_id,response_status").eq("driver_id", value: fahrer).execute().value
            async let dienstAbfrage: [DienstAnfrage] = Backend.client.from("driver_service_requests")
                .select("id,service_date,service_start_time,service_end_time,status")
                .eq("driver_id", value: fahrer).in("status", values: ["pending", "accepted"])
                .order("created_at", ascending: false).execute().value

            let profil = try await profilAbfrage
            let direkt = try await direktAbfrage
            let links = (try? await kolonnenAbfrage) ?? []
            let dienste = (try? await dienstAbfrage) ?? []

            let kolonnenIDs = Array(Set(links.filter { ($0.response_status ?? "pending") != "refused" }.compactMap(\.job_id)))
            var kolonnenFahrten: [FahrtZeile] = []
            if !kolonnenIDs.isEmpty {
                kolonnenFahrten = try await Backend.client.from("jobs").select()
                    .in("id", values: kolonnenIDs.map(\.uuidString))
                    .neq("status", value: "cancelled").execute().value
            }

            var proID: [UUID: FahrtZeile] = [:]
            (direkt + kolonnenFahrten).forEach { proID[$0.id] = $0 }
            let gestern = Datum.tagWert(Date().addingTimeInterval(-86_400))
            let sichtbar = proID.values.filter { zeile in
                !Self.versteckt.contains((zeile.status ?? "").lowercased())
                    && Self.fahrtDatum(zeile) >= gestern
            }

            // Kolonnen-Zuordnungen je Fahrt (fuer isKolonne und die eigene Antwort).
            let ids = sichtbar.map(\.id.uuidString)
            var zuordnungen: [KolonnenZuordnung] = []
            if !ids.isEmpty {
                zuordnungen = (try? await Backend.client.from("convoy_assignments")
                    .select("job_id,driver_id,response_status").in("job_id", values: ids).execute().value) ?? []
            }
            let zuordnungJeFahrt = Dictionary(grouping: zuordnungen, by: { $0.job_id })

            fahrten = sichtbar.compactMap { zeile -> Fahrt? in
                let eigene = zuordnungJeFahrt[zeile.id]?.first { $0.driver_id == fahrer }
                let istKolonne = zeile.convoy_id != nil || !(zuordnungJeFahrt[zeile.id]?.isEmpty ?? true)
                if istKolonne, eigene?.response_status == "refused" { return nil }
                return Fahrt(
                    id: zeile.id,
                    status: zeile.status ?? "",
                    tripType: zeile.trip_type,
                    abholName: zeile.pickup_name ?? "",
                    abholAdresse: zeile.pickup_address ?? "",
                    zielName: zeile.dropoff_name ?? "",
                    zielAdresse: zeile.dropoff_address ?? "",
                    zugNummer: zeile.train_number,
                    flug: zeile.flight_number ?? zeile.train_number ?? "STADTFAHRT",
                    fahrtDatum: Self.fahrtDatum(zeile),
                    etd: String((zeile.etd ?? "12:00").prefix(5)),
                    planEtd: zeile.original_etd.map { String($0.prefix(5)) },
                    kolonnenID: zeile.convoy_id,
                    istKolonne: istKolonne,
                    meineAntwort: eigene?.response_status ?? "pending",
                    abholOrtID: zeile.pickup_ort_id,
                    zielOrtID: zeile.dropoff_ort_id,
                    zwischenstopps: zeile.zwischenstopps ?? []
                )
            }
            // Orte einmal laden, neu nur wenn eine Fahrt einen unbekannten Ort nennt.
            let orte = OrteSpeicher.geteilt
            await orte.ladenFallsNoetig()
            if fahrten.contains(where: { f in [f.abholOrtID, f.zielOrtID].contains { $0 != nil && orte.ort($0) == nil } }) {
                await orte.laden()
            }
            dienstAnfragen = dienste

            if let fahrzeugID = profil.first?.vehicle_id {
                let zeilen: [FahrzeugZeile] = try await Backend.client.from("vehicles")
                    .select().eq("id", value: fahrzeugID).limit(1).execute().value
                fahrzeug = zeilen.first
            } else {
                fahrzeug = nil
            }
            fehler = nil
        } catch {
            fehler = error.localizedDescription
        }
        geladen = true
        await ungelesenAktualisieren()
    }

    func ungelesenAktualisieren() async {
        guard let fahrer = fahrerID else { return }
        var neu: [UUID: Int] = [:]
        for kolonne in Set(fahrten.compactMap(\.kolonnenID)) {
            neu[kolonne] = await KolonnenChat.ungelesen(chatID: kolonne, fahrerID: fahrer)
        }
        ungelesen = neu
    }

    // MARK: Annehmen / Ablehnen (handleJobAction der Web-App)

    func antworten(_ fahrt: Fahrt, annehmen: Bool, grund: String? = nil) async -> Bool {
        guard let fahrer = fahrerID else { return false }
        let vorher = fahrten
        // Sofort in der Liste zeigen, bei Fehler zuruecksetzen.
        if annehmen {
            fahrten = fahrten.map { f in
                var neu = f
                if f.id == fahrt.id {
                    if f.istKolonne { neu.meineAntwort = "accepted" } else { neu.status = "assigned" }
                }
                return neu
            }
        } else {
            fahrten.removeAll { $0.id == fahrt.id }
        }
        arbeitet = true
        defer { arbeitet = false }
        let jetzt = Datum.iso(Date())
        let ablehnGrund = annehmen ? nil : ((grund?.trimmingCharacters(in: .whitespacesAndNewlines)).flatMap { $0.isEmpty ? nil : $0 } ?? "Fahrer hat die Fahrt abgelehnt.")
        do {
            if fahrt.istKolonne {
                struct Antwort: Encodable {
                    let job_id: UUID; let driver_id: UUID; let response_status: String
                    let responded_at: String; let refusal_reason: String?
                }
                try await Backend.client.from("convoy_assignments")
                    .upsert(Antwort(job_id: fahrt.id, driver_id: fahrer, response_status: annehmen ? "accepted" : "refused",
                                    responded_at: jetzt, refusal_reason: ablehnGrund),
                            onConflict: "job_id,driver_id")
                    .execute()
            } else {
                struct Antwort: Encodable {
                    let status: String; let refused_by_driver_id: UUID?; let refusal_reason: String?
                    let driver_response_status: String; let driver_responded_at: String
                }
                let ergebnis: [IDZeile] = try await Backend.client.from("jobs")
                    .update(Antwort(status: annehmen ? "assigned" : "refused",
                                    refused_by_driver_id: annehmen ? nil : fahrer,
                                    refusal_reason: ablehnGrund,
                                    driver_response_status: annehmen ? "accepted" : "refused",
                                    driver_responded_at: jetzt))
                    .eq("id", value: fahrt.id).eq("driver_id", value: fahrer)
                    .select("id").execute().value
                if ergebnis.isEmpty { throw TrisarFehler.text("Status konnte nicht gespeichert werden (keine Berechtigung).") }
            }
            if annehmen {
                // Route und Anfahrt berechnen lassen, wie die Web-App nach dem Annehmen.
                struct Sync: Encodable { let reason: String; let job_ids: [UUID]; let requested_by: UUID }
                try? await Backend.client.functions.invoke(
                    "external-sync",
                    options: FunctionInvokeOptions(body: Sync(reason: "live_view", job_ids: [fahrt.id], requested_by: fahrer))
                )
            }
            return true
        } catch {
            fahrten = vorher
            fehler = "Aktion konnte nicht gespeichert werden: \(error.localizedDescription)"
            return false
        }
    }

    // MARK: Dienstanfrage (handleServiceRequestAction der Web-App)

    @Published private(set) var dienstArbeitetID: UUID?

    func dienstAntworten(_ anfrage: DienstAnfrage, annehmen: Bool) async {
        guard let fahrer = fahrerID else { return }
        dienstArbeitetID = anfrage.id
        defer { dienstArbeitetID = nil }
        do {
            struct Antwort: Encodable { let status: String; let responded_at: String; let refusal_reason: String? }
            try await Backend.client.from("driver_service_requests")
                .update(Antwort(status: annehmen ? "accepted" : "refused", responded_at: Datum.iso(Date()),
                                refusal_reason: annehmen ? nil : "Fahrer hat den Dienstplan abgelehnt."))
                .eq("id", value: anfrage.id).eq("driver_id", value: fahrer).execute()
            if annehmen {
                struct Dienst: Encodable {
                    let service_start_time: String?; let service_end_time: String?
                    let service_start_date: String?; let service_end_date: String?
                }
                try await Backend.client.from("profiles")
                    .update(Dienst(service_start_time: anfrage.service_start_time, service_end_time: anfrage.service_end_time,
                                   service_start_date: anfrage.service_date, service_end_date: anfrage.service_date))
                    .eq("id", value: fahrer).execute()
            }
            dienstAnfragen = dienstAnfragen.compactMap { eintrag in
                guard eintrag.id == anfrage.id else { return eintrag }
                return annehmen ? DienstAnfrage(id: eintrag.id, service_date: eintrag.service_date,
                                                service_start_time: eintrag.service_start_time,
                                                service_end_time: eintrag.service_end_time, status: "accepted") : nil
            }
        } catch {
            fehler = "Dienstplan-Anfrage konnte nicht gespeichert werden: \(error.localizedDescription)"
        }
    }

    // MARK: Realtime

    private func realtimeStarten() async {
        guard let fahrer = fahrerID else { return }
        let kanal = Backend.client.channel("fahrer-app-\(fahrer.uuidString)")
        let id = fahrer.uuidString
        let stroeme = [
            kanal.postgresChange(AnyAction.self, schema: "public", table: "jobs", filter: .eq("driver_id", value: id)),
            kanal.postgresChange(AnyAction.self, schema: "public", table: "convoy_assignments", filter: .eq("driver_id", value: id)),
            kanal.postgresChange(AnyAction.self, schema: "public", table: "driver_service_requests", filter: .eq("driver_id", value: id)),
            kanal.postgresChange(AnyAction.self, schema: "public", table: "profiles", filter: .eq("id", value: id)),
        ]
        // Neue Chat-Nachrichten: nur Zaehler neu, die Fahrten bleiben.
        let nachrichten = kanal.postgresChange(AnyAction.self, schema: "public", table: "messages")
        self.kanal = kanal
        beobachter = stroeme.map { strom in
            Task { [weak self] in
                for await _ in strom { self?.spaeterLaden() }
            }
        } + [Task { [weak self] in
            for await _ in nachrichten { await self?.ungelesenAktualisieren() }
        }]
        try? await kanal.subscribeWithError()
    }

    private func abmeldenRealtime() async {
        beobachter.forEach { $0.cancel() }
        beobachter = []
        if let kanal { await Backend.client.removeChannel(kanal) }
        kanal = nil
    }

    /// Mehrere Aenderungen kurz hintereinander nur einmal laden.
    private func spaeterLaden() {
        nachladen?.cancel()
        nachladen = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(400))
            guard !Task.isCancelled else { return }
            await self?.laden()
        }
    }

    private static func fahrtDatum(_ zeile: FahrtZeile) -> String {
        for kandidat in [zeile.ride_date, zeile.pickup_date, zeile.service_date] {
            if let wert = kandidat, wert.range(of: #"^\d{4}-\d{2}-\d{2}$"#, options: .regularExpression) != nil { return wert }
        }
        if let erstellt = zeile.created_at, erstellt.count >= 10 {
            let tag = String(erstellt.prefix(10))
            if tag.range(of: #"^\d{4}-\d{2}-\d{2}$"#, options: .regularExpression) != nil { return tag }
        }
        return Datum.tagWert(Date())
    }
}

private struct ProfilFahrzeug: Decodable { let vehicle_id: UUID? }
private struct KolonnenLink: Decodable { let job_id: UUID?; let response_status: String? }
private struct KolonnenZuordnung: Decodable { let job_id: UUID; let driver_id: UUID?; let response_status: String? }
private struct IDZeile: Decodable { let id: UUID }

enum TrisarFehler: LocalizedError {
    case text(String)
    var errorDescription: String? { if case let .text(t) = self { return t }; return nil }
}

/// Datumshilfen wie in der Web-App (lokale Zeit, yyyy-MM-dd).
enum Datum {
    static func tagWert(_ datum: Date) -> String {
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .gregorian)
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd"
        return f.string(from: datum)
    }

    static func ausTagWert(_ wert: String) -> Date {
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .gregorian)
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd"
        return f.date(from: wert) ?? Calendar.current.startOfDay(for: Date())
    }

    static func iso(_ datum: Date) -> String {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f.string(from: datum)
    }

    /// "Heute", "Morgen", "Gestern" oder "dd.MM." (formatRideDayLabel).
    static func tagEtikett(_ wert: String) -> String {
        let ziel = Calendar.current.startOfDay(for: ausTagWert(wert))
        let heute = Calendar.current.startOfDay(for: Date())
        let tage = Calendar.current.dateComponents([.day], from: heute, to: ziel).day ?? 0
        switch tage {
        case 0: return "Heute"
        case 1: return "Morgen"
        case -1: return "Gestern"
        default:
            let f = DateFormatter(); f.locale = Locale(identifier: "de_DE"); f.dateFormat = "dd.MM."
            return f.string(from: ziel)
        }
    }

    /// "Mittwoch 04.11." (formatDividerLabel).
    static func trennzeile(_ wert: String) -> String {
        let datum = ausTagWert(wert)
        let f = DateFormatter(); f.locale = Locale(identifier: "de_DE")
        f.dateFormat = "EEEE dd.MM."
        return f.string(from: datum)
    }
}
