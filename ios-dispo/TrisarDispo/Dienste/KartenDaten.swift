import CoreLocation
import Foundation
import Supabase
import SwiftUI

/// Zustand eines Fahrers auf der Karte (KartenView.jsx): Rot = aktiv, Gelb = inaktiv, Gruen = frei.
enum FahrerZustand: String, CaseIterable {
    case aktiv, inaktiv, frei

    var farbe: Color {
        switch self {
        case .aktiv: return Color(hex: 0xFF6F63)
        case .inaktiv: return Color(hex: 0xE3F654)
        case .frei: return Color(hex: 0x59BE80)
        }
    }

    var titel: String {
        switch self {
        case .aktiv: return "Aktiv"
        case .inaktiv: return "Inaktiv"
        case .frei: return "Frei"
        }
    }

    /// Fahrer_Pin_Trisar_01_*, bei Zuendung aus die Variante mit blassem Weiss.
    func pinBild(zuendungAus: Bool) -> String {
        let farbe = self == .aktiv ? "rot" : (self == .inaktiv ? "gelb" : "gruen")
        return "Fahrer_Pin_Trisar_01_\(farbe)" + (zuendungAus ? "_zuendung_aus" : "")
    }
}

/// Ort in der Fahrtinfo des Blatts (Typ, Icon, kurzer Name).
struct KartenOrt: Equatable {
    var typ: String
    var icon: String?
    var name: String
}

/// buildDriverRideInfo: Zeiten und Orte fuer das Blatt.
struct KartenFahrtInfo: Equatable {
    var dienststart = "--:--"
    var dienstende = "--:--"
    var abfahrt = "--:--"
    var ankunft = "--:--"
    var fahrMinuten = 0
    var unterwegs = false
    var von = KartenOrt(typ: "-", icon: nil, name: "Keine aktive Fahrt")
    var nach = KartenOrt(typ: "-", icon: nil, name: "-")
}

/// buildDriverActiveRide: was die Karte als Route zeichnet.
struct KartenFahrt: Equatable {
    var id: String
    var status: String
    var vonSuche: String
    var nachSuche: String
    /// Koordinaten, die die Fahrt schon mitbringt (Pin des eigenen Orts, sonst TomTom-Payload).
    /// Nur ohne sie wird die Adresse gesucht.
    var vonPunkt: CLLocationCoordinate2D? = nil
    var nachPunkt: CLLocationCoordinate2D? = nil
    var kolonnenFahrerIDs: [String] = []

    static func == (a: KartenFahrt, b: KartenFahrt) -> Bool {
        a.id == b.id && a.status == b.status && a.vonSuche == b.vonSuche && a.nachSuche == b.nachSuche
            && a.vonPunkt?.latitude == b.vonPunkt?.latitude && a.vonPunkt?.longitude == b.vonPunkt?.longitude
            && a.nachPunkt?.latitude == b.nachPunkt?.latitude && a.nachPunkt?.longitude == b.nachPunkt?.longitude
            && a.kolonnenFahrerIDs == b.kolonnenFahrerIDs
    }
}

struct KartenFahrer: Identifiable, Equatable {
    let id: String
    var name: String
    var bildURL: String
    var zuendungAus: Bool
    var nummer: String?
    var telefon: String
    var kennzeichen: String
    var fahrzeug: String
    var lat: Double
    var lng: Double
    var zustand: FahrerZustand
    var info: KartenFahrtInfo
    var fahrt: KartenFahrt?

    var ort: CLLocationCoordinate2D { CLLocationCoordinate2D(latitude: lat, longitude: lng) }
    var vorname: String { name.split(separator: " ").first.map(String.init) ?? "Fahrer" }
}

/// Filter der Karte (kartenFilter in App.jsx). Geteilt, damit er wie im Web beim
/// Wechsel zwischen Karte und Filter erhalten bleibt.
@MainActor
final class KartenFilter: ObservableObject {
    static let geteilt = KartenFilter()

    @Published var fahrerSuche = "" {
        didSet { if fahrerSuche.trimmingCharacters(in: .whitespaces).isEmpty { gewaehlteFahrerIDs = [] } }
    }
    @Published var gewaehlteFahrerIDs: [String] = []
    @Published var feierabendMinuten = ""
    @Published var limousine = false
    @Published var suv = false
    @Published var van = false
    @Published var coupe = false

    func zuruecksetzen() {
        fahrerSuche = ""; gewaehlteFahrerIDs = []; feierabendMinuten = ""
        limousine = false; suv = false; van = false; coupe = false
    }
}

/// Laedt Fahrer, Live-Standorte, Zuendung, Fahrten und Kolonnen wie loadDriversFromDb in
/// KartenView.jsx und haelt sie per Realtime (driver_live_locations, vehicle_telemetry_live,
/// jobs, convoy_assignments) und alle 15 s aktuell. Liest nur.
@MainActor
final class KartenDaten: ObservableObject {
    @Published private(set) var fahrer: [KartenFahrer] = []
    @Published private(set) var fehler = ""
    /// Inaktiv-Fenster in Stunden (Regler nach langem Druck auf "Inaktiv").
    var vorschauStunden: Double = 1

    /// Wie lastDriverMapCache: beim erneuten Oeffnen stehen die Fahrer sofort da.
    private static var zwischenspeicher: [KartenFahrer] = []
    /// Letzter Zuendungsstand je Fahrer, damit nur ein Wechsel neu laedt.
    private var zuendungStand: [String: Bool] = [:]
    private var laeuft = false
    /// Aenderung waehrend eines Ladens: danach noch einmal laden statt verwerfen.
    private var nochmal = false
    private var aktivBeobachter: NSObjectProtocol?
    private var kanal: RealtimeChannelV2?
    private var beobachter: [Task<Void, Never>] = []
    private var takt: Timer?

    init() { fahrer = Self.zwischenspeicher }

    func starten() async {
        await laden()
        let kanal = Backend.client.channel("ko-karten-live-refresh")
        let standorte = kanal.postgresChange(AnyAction.self, schema: "public", table: "driver_live_locations")
        let zuendung = kanal.postgresChange(AnyAction.self, schema: "public", table: "vehicle_telemetry_live")
        let fahrten = kanal.postgresChange(AnyAction.self, schema: "public", table: "jobs")
        let kolonnen = kanal.postgresChange(AnyAction.self, schema: "public", table: "convoy_assignments")
        self.kanal = kanal
        beobachter = [standorte, fahrten, kolonnen].map { strom in
            Task { [weak self] in for await _ in strom { await self?.laden() } }
        } + [Task { [weak self] in
            for await aenderung in zuendung { await self?.zuendungGeaendert(aenderung) }
        }]
        try? await kanal.subscribeWithError()
        takt = Timer.scheduledTimer(withTimeInterval: 15, repeats: true) { [weak self] _ in
            Task { @MainActor in await self?.laden() }
        }
        // Zurueck in die App: sofort frisch laden (Realtime war im Hintergrund weg).
        aktivBeobachter = NotificationCenter.default.addObserver(
            forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main
        ) { [weak self] _ in
            Task { @MainActor in await self?.laden() }
        }
    }

    func beenden() async {
        takt?.invalidate()
        takt = nil
        beobachter.forEach { $0.cancel() }
        beobachter = []
        if let kanal { await Backend.client.removeChannel(kanal) }
        kanal = nil
    }

    /// Nur bei Wechsel der Zuendung neu laden, nicht bei jedem Datensatz.
    private func zuendungGeaendert(_ aenderung: AnyAction) async {
        let satz: [String: AnyJSON]
        switch aenderung {
        case .insert(let a): satz = a.record
        case .update(let a): satz = a.record
        case .delete: return
        }
        guard case .string(let id)? = satz["driver_id"], !id.isEmpty else { return }
        var an: Bool?
        if case .bool(let b)? = satz["ignition"] { an = b }
        if zuendungStand[id] == an, zuendungStand.keys.contains(id) { return }
        zuendungStand[id] = an
        await laden()
    }

    // MARK: Laden

    private typealias Zeile = [String: Any]

    private func abfrage(_ tabelle: String, _ spalten: String) async throws -> [Zeile] {
        let daten = try await Backend.client.from(tabelle).select(spalten).execute().data
        return (try? JSONSerialization.jsonObject(with: daten)) as? [Zeile] ?? []
    }

    func laden() async {
        guard !laeuft else { nochmal = true; return }
        laeuft = true
        defer { laeuft = false }
        repeat {
            nochmal = false
            await einmalLaden()
        } while nochmal
    }

    private func einmalLaden() async {
        fehler = ""
        do {
            // Gleiche Rueckfall-Reihe wie im Web, falls eine Spalte fehlt.
            let basis = "id, first_name, last_name, phone, role, is_dispo, vehicle_id, driver_number, vehicles:vehicle_id(license_plate, brand_model, trim)"
            let mitBild = "\(basis), avatar_url"
            let kandidaten = [
                "\(mitBild), driver_activity_state, service_start_time, service_end_time",
                "\(mitBild), driver_activity_state",
                "\(mitBild), service_start_time, service_end_time",
                mitBild,
                "\(basis), driver_activity_state, service_start_time, service_end_time",
                "\(basis), driver_activity_state",
                "\(basis), service_start_time, service_end_time",
                basis,
            ]
            var profile: [Zeile]?
            var letzterFehler: Error?
            for k in kandidaten {
                do { profile = try await abfrage("profiles", k); break } catch { letzterFehler = error }
            }
            guard let profile else { throw letzterFehler ?? URLError(.badServerResponse) }

            let live = try await abfrage("driver_live_locations", "driver_id, lat, lng, captured_at, active_job_id")

            // Zuendung aus dem OBD-Tracker. Fehlt die Tabelle oder das Recht, bleibt alles wie bisher.
            let zuendung = (try? await abfrage("vehicle_telemetry_live", "driver_id, ignition, captured_at")) ?? []
            var zuendungJe: [String: Bool] = [:]
            for z in zuendung {
                let id = Self.text(z["driver_id"])
                guard !id.isEmpty else { continue }
                if let b = z["ignition"] as? Bool { zuendungJe[id] = b }
                zuendungStand[id] = z["ignition"] as? Bool
            }

            // Wie im Web (JOBS_SELECT_NO_ROUTE): mit Fahrzeit und Live-Restfahrzeit fuer die ETA.
            // Fehlen die ext_-Spalten, ohne sie.
            let jobsBasis = "id, driver_id, ride_date, etd, status, pickup_name, pickup_address, dropoff_name, dropoff_address"
            let jobsMitZeit = jobsBasis + ", ext_route_duration_mins, ext_route_duration_in_traffic_mins, "
                + "ext_driver_to_dropoff_duration_mins, ext_driver_to_dropoff_duration_in_traffic_mins, ext_driver_to_dropoff_last_sync_at"
            // Eigene Orte (pickup_ort_id / dropoff_ort_id) zuerst, ohne die Spalten wie bisher.
            let jobsMitOrt = jobsMitZeit + ", pickup_ort_id, dropoff_ort_id"
            // Dazu die Punkte aus den TomTom-Payloads, damit die Route nicht an der Adresssuche haengt.
            let jobsMitPunkten = jobsMitOrt + ", " + Routen.payloadSpalten
            var jobs: [Zeile] = []
            for spalten in [jobsMitPunkten, jobsMitOrt, jobsMitZeit, jobsBasis] {
                do {
                    let d = try await Backend.client.from("jobs").select(spalten)
                        .order("ride_date", ascending: true).order("etd", ascending: true).execute().data
                    jobs = (try? JSONSerialization.jsonObject(with: d)) as? [Zeile] ?? []
                    break
                } catch {
                    if spalten == jobsBasis { throw error }
                }
            }

            // Kolonnen in Stuecken zu 30 Fahrten (IN_QUERY_BATCH_SIZE). Fehlt die Tabelle: keine Kolonnen.
            let jobIDs = jobs.map { Self.text($0["id"]) }.filter { !$0.isEmpty }
            var kolonnenZeilen: [Zeile] = []
            var start = 0
            stuecke: while start < jobIDs.count {
                let stueck = Array(jobIDs[start..<min(start + 30, jobIDs.count)])
                start += 30
                do {
                    let d = try await Backend.client.from("convoy_assignments").select("job_id, driver_id, response_status")
                        .in("job_id", values: stueck).execute().data
                    kolonnenZeilen += (try? JSONSerialization.jsonObject(with: d)) as? [Zeile] ?? []
                } catch {
                    if "\(error)".range(of: "convoy_assignments|does not exist", options: [.regularExpression, .caseInsensitive]) != nil {
                        kolonnenZeilen = []
                        break stuecke
                    }
                    throw error
                }
            }

            let ergebnis = abbilden(profile: profile, live: live, zuendung: zuendungJe, jobs: jobs, kolonnen: kolonnenZeilen)
            if ergebnis.fahrer.isEmpty && ergebnis.sichtbareProfile > 0 {
                fehler = "Keine Live-Fahrerstandorte sichtbar. Bitte Anmeldung/Session und RLS-Policy fuer `driver_live_locations` pruefen."
            }
            if !ergebnis.fahrer.isEmpty {
                fahrer = ergebnis.fahrer
                Self.zwischenspeicher = ergebnis.fahrer
            }
        } catch {
            fehler = "Fahrer-Standorte konnten nicht geladen werden: \(error.localizedDescription)"
        }
    }

    // MARK: Abbilden (mapped in loadDriversFromDb)

    private func abbilden(profile: [Zeile], live: [Zeile], zuendung: [String: Bool], jobs: [Zeile],
                          kolonnen: [Zeile]) -> (fahrer: [KartenFahrer], sichtbareProfile: Int) {
        // Nur die Rolle entscheidet, das Dispo-Recht (is_dispo) macht niemanden zum Nicht-Fahrer.
        let sichtbar = profile.filter {
            !["dispo", "dispatcher", "admin", "koordinator", "coordinator", "pruefung"].contains(Self.text($0["role"]).lowercased())
        }
        var profilJe: [String: Zeile] = [:]
        for p in sichtbar { profilJe[Self.text(p["id"])] = p }
        // Ausgeblendete Konten (Dispo, Pruefkonto) auch ohne Profil nicht als Punkt zeigen.
        let versteckt = Set(profile.map { Self.text($0["id"]) }).subtracting(profilJe.keys)
        var jobJe: [String: Zeile] = [:]
        for j in jobs { jobJe[Self.text(j["id"])] = j }
        var jobsJeFahrer: [String: [Zeile]] = [:]
        func zuordnen(_ fahrer: String, _ job: Zeile) {
            guard !fahrer.isEmpty else { return }
            jobsJeFahrer[fahrer, default: []].append(job)
        }
        for j in jobs { zuordnen(Self.text(j["driver_id"]), j) }

        // Wer faehrt in welcher Kolonne mit? Abgelehnte Zuweisungen zaehlen nicht.
        var kolonneJeFahrt: [String: Set<String>] = [:]
        for k in kolonnen where KartenRegeln.status(k["response_status"] ?? "pending") != "refused" {
            let jobID = Self.text(k["job_id"]), fahrerID = Self.text(k["driver_id"])
            guard !jobID.isEmpty, !fahrerID.isEmpty else { continue }
            kolonneJeFahrt[jobID, default: []].insert(fahrerID)
        }
        for j in jobs {
            let jobID = Self.text(j["id"]), fahrerID = Self.text(j["driver_id"])
            if !jobID.isEmpty, !fahrerID.isEmpty, kolonneJeFahrt[jobID] != nil { kolonneJeFahrt[jobID]?.insert(fahrerID) }
        }
        for k in kolonnen where KartenRegeln.status(k["response_status"] ?? "pending") != "refused" {
            if let job = jobJe[Self.text(k["job_id"])] { zuordnen(Self.text(k["driver_id"]), job) }
        }

        let jetzt = Date()
        let fenster = max(0, vorschauStunden) * 3600
        // Graues Icon je eigenem Ort (id klein geschrieben wie in den Zeilen der Datenbank).
        var ortIcons: [String: String] = [:]
        // Pin je eigenem Ort: Start und Ziel der Route, ehe die Adresse gesucht wird.
        var ortPunkte: [String: CLLocationCoordinate2D] = [:]
        for o in OrteSpeicher.geteilt.orte {
            ortIcons[o.id.uuidString.lowercased()] = o.symbol.grau
            ortPunkte[o.id.uuidString.lowercased()] = o.punkt
        }

        let liste: [KartenFahrer] = live.compactMap { zeile in
            let id = Self.text(zeile["driver_id"])
            guard !id.isEmpty, !versteckt.contains(id),
                  let lat = Self.zahl(zeile["lat"]), let lng = Self.zahl(zeile["lng"]) else { return nil }
            let p = profilJe[id]
            let name = [Self.text(p?["first_name"]), Self.text(p?["last_name"])].filter { !$0.isEmpty }.joined(separator: " ")
            let fz = p?["vehicles"] as? Zeile
            let kennzeichen = Self.text(fz?["license_plate"])
            let fahrzeug = [Self.text(fz?["brand_model"]), Self.text(fz?["trim"])].filter { !$0.isEmpty }.joined(separator: " ")

            let seineJobs = jobsJeFahrer[id] ?? []
            let liveJobID = Self.text(zeile["active_job_id"])
            let liveJob = liveJobID.isEmpty ? nil : jobJe[liveJobID]
            let aktiverJob = seineJobs.first { KartenRegeln.istAktiv($0["status"]) }
                ?? (liveJob.flatMap { KartenRegeln.istAktiv($0["status"]) ? $0 : nil })
            let kommende = seineJobs
                .filter { !KartenRegeln.istErledigt($0["status"]) && !KartenRegeln.istAktiv($0["status"]) }
                .compactMap { j in KartenRegeln.zeitpunkt(j).map { (j, $0) } }
                .sorted { $0.1 < $1.1 }
            // Die frueheste offene Fahrt ist immer die naechste, auch wenn sie verspaetet ist.
            let naechster = kommende.first
            let imFenster = naechster.map { $0.1 <= jetzt.addingTimeInterval(fenster) } ?? false
            let zustand: FahrerZustand = aktiverJob != nil ? .aktiv : (imFenster ? .inaktiv : .frei)

            let info = KartenRegeln.fahrtInfo(aktiv: aktiverJob, naechster: naechster?.0, alle: seineJobs,
                                              dienstStart: Self.text(p?["service_start_time"]),
                                              dienstEnde: Self.text(p?["service_end_time"]), jetzt: jetzt,
                                              ortIcons: ortIcons)
            let routenJob = aktiverJob ?? naechster?.0
            var fahrt = routenJob.flatMap { KartenRegeln.fahrt($0, ortPunkte: ortPunkte) }
            if let f = fahrt, let kolonne = kolonneJeFahrt[f.id], kolonne.count > 1 {
                fahrt?.kolonnenFahrerIDs = Array(kolonne)
            }
            let nummerText = Self.text(p?["driver_number"])

            return KartenFahrer(
                id: id,
                name: name.isEmpty ? "Fahrer \(id.prefix(8))" : name,
                bildURL: Self.text(p?["avatar_url"]),
                zuendungAus: zuendung[id] == false,
                nummer: nummerText.isEmpty ? nil : nummerText,
                telefon: Self.text(p?["phone"]),
                kennzeichen: kennzeichen.isEmpty ? "-" : kennzeichen,
                fahrzeug: fahrzeug.isEmpty ? "Fahrzeug" : fahrzeug,
                lat: lat, lng: lng, zustand: zustand, info: info, fahrt: fahrt)
        }
        return (liste, sichtbar.count)
    }

    nonisolated static func text(_ w: Any?) -> String {
        switch w {
        case let s as String: return s.trimmingCharacters(in: .whitespacesAndNewlines)
        case let n as NSNumber: return n.stringValue
        default: return ""
        }
    }

    nonisolated static func zahl(_ w: Any?) -> Double? {
        if let n = w as? NSNumber { return n.doubleValue }
        if let s = w as? String { return Double(s) }
        return nil
    }
}

/// Die kleinen Regeln aus KartenView.jsx und etaBerechnung.js (Status, Zeiten, Orte).
enum KartenRegeln {
    private static let offen: Set<String> = ["pending", "assigned", "offen", "new", "requested", "offered", "zugewiesen"]
    private static let aktiv: Set<String> = ["at_pickup", "pickup", "beim_pickup", "beim pickup", "in_progress", "started",
                                             "unterwegs", "active", "ongoing", "on_trip"]
    private static let erledigt: Set<String> = ["done", "completed", "arrived", "cancelled", "canceled", "refused", "stoniert"]
    private static let unterwegsStatus: Set<String> = ["in_progress", "unterwegs", "started", "on_trip", "ongoing", "active"]

    static func status(_ w: Any?) -> String { KartenDaten.text(w).lowercased() }
    static func istOffen(_ w: Any?) -> Bool { offen.contains(status(w)) }
    static func istAktiv(_ w: Any?) -> Bool { aktiv.contains(status(w)) }
    static func istUnterwegs(_ w: Any?) -> Bool { unterwegsStatus.contains(status(w)) }
    static func istErledigt(_ w: Any?) -> Bool { erledigt.contains(status(w)) }

    /// toIsoDate: yyyy-MM-dd, ISO mit T oder dd.MM.yyyy.
    static func isoTag(_ w: Any?) -> String {
        let roh = KartenDaten.text(w)
        if roh.range(of: "^\\d{4}-\\d{2}-\\d{2}", options: .regularExpression) != nil { return String(roh.prefix(10)) }
        let t = roh.split(separator: ".")
        if t.count == 3, t[0].count == 2, t[1].count == 2, t[2].count == 4 { return "\(t[2])-\(t[1])-\(t[0])" }
        return ""
    }

    /// toClockTime: "H:MM" am Anfang, gueltige Uhrzeit.
    static func uhr(_ w: Any?) -> (Int, Int)? {
        let roh = KartenDaten.text(w)
        guard let r = roh.range(of: "^\\d{1,2}:\\d{2}", options: .regularExpression) else { return nil }
        let teile = roh[r].split(separator: ":")
        guard let h = Int(teile[0]), let m = Int(teile[1]), (0...23).contains(h), (0...59).contains(m) else { return nil }
        return (h, m)
    }

    static func uhrText(_ w: Any?, _ ersatz: String = "--:--") -> String {
        guard let (h, m) = uhr(w) else { return ersatz }
        return String(format: "%02d:%02d", h, m)
    }

    static func zeitpunkt(_ job: [String: Any]) -> Date? {
        let tag = isoTag(job["ride_date"])
        guard !tag.isEmpty, let (h, m) = uhr(job["etd"]) else { return nil }
        let t = tag.split(separator: "-").compactMap { Int($0) }
        guard t.count == 3 else { return nil }
        return Calendar.current.date(from: DateComponents(year: t[0], month: t[1], day: t[2], hour: h, minute: m))
    }

    private static func uhrzeit(_ d: Date) -> String {
        let k = Calendar.current.dateComponents([.hour, .minute], from: d)
        return String(format: "%02d:%02d", k.hour ?? 0, k.minute ?? 0)
    }

    /// addMinutesToClock: heute um die Uhrzeit plus Minuten.
    static func plusMinuten(_ uhrText: String, _ minuten: Int) -> String? {
        guard let (h, m) = uhr(uhrText) else { return nil }
        var d = Calendar.current.date(bySettingHour: h, minute: m, second: 0, of: Date()) ?? Date()
        d.addTimeInterval(Double(minuten) * 60)
        return uhrzeit(d)
    }

    /// zeitAmTag aus etaBerechnung.js: Uhrzeit am Fahrtag (sonst heute).
    private static func geplant(_ job: [String: Any], _ jetzt: Date) -> Date? {
        guard let (h, m) = uhr(uhrText(job["etd"], "")) else { return nil }
        let tagRoh = String(KartenDaten.text(job["ride_date"]).prefix(10))
        let tag = tagRoh.range(of: "^\\d{4}-\\d{2}-\\d{2}$", options: .regularExpression) != nil ? tagRoh : Datum.tagWert(jetzt)
        let t = tag.split(separator: "-").compactMap { Int($0) }
        guard t.count == 3 else { return nil }
        return Calendar.current.date(from: DateComponents(year: t[0], month: t[1], day: t[2], hour: h, minute: m))
    }

    /// berechneAbfahrt: noch nicht losgefahren und schon spaet dran -> jetzt.
    static func abfahrt(_ job: [String: Any], _ jetzt: Date) -> String? {
        guard let g = geplant(job, jetzt) else { return nil }
        if !unterwegsStatus.contains(status(job["status"])), g < jetzt, Calendar.current.isDate(g, inSameDayAs: jetzt) {
            return uhrzeit(jetzt)
        }
        return uhrzeit(g)
    }

    /// Live-Restfahrzeit (ext_driver_to_dropoff_*), nur unterwegs und hoechstens 10 Minuten alt.
    private static func liveRest(_ job: [String: Any], _ jetzt: Date) -> Int? {
        guard unterwegsStatus.contains(status(job["status"])) else { return nil }
        let verkehr = KartenDaten.zahl(job["ext_driver_to_dropoff_duration_in_traffic_mins"]) ?? 0
        let rest = verkehr != 0 ? verkehr : (KartenDaten.zahl(job["ext_driver_to_dropoff_duration_mins"]) ?? -1)
        guard rest >= 0, let sync = isoDatum(KartenDaten.text(job["ext_driver_to_dropoff_last_sync_at"])),
              jetzt.timeIntervalSince(sync) < 10 * 60 else { return nil }
        // Restzeit gilt ab der Messung. Abziehen, was seitdem vergangen ist, sonst wandert die ETA nach hinten.
        return max(0, Int((rest * 60 - jetzt.timeIntervalSince(sync)) / 60 + 0.5))
    }

    private static func isoDatum(_ s: String) -> Date? {
        guard !s.isEmpty else { return nil }
        let mitBruch = ISO8601DateFormatter()
        mitBruch.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let d = mitBruch.date(from: s) { return d }
        let ohne = ISO8601DateFormatter()
        return ohne.date(from: s)
    }

    /// Fahrdauer der Fahrt: mit Verkehr, sonst ohne (toPositiveMinutes).
    static func routenDauer(_ job: [String: Any]) -> Int {
        for k in ["ext_route_duration_in_traffic_mins", "ext_route_duration_mins"] {
            if let z = KartenDaten.zahl(job[k]), z > 0 { return Int(z.rounded()) }
        }
        return 0
    }

    /// restFahrzeit: Live-Rest, sonst Fahrdauer.
    static func restFahrzeit(_ job: [String: Any], _ jetzt: Date) -> Int {
        liveRest(job, jetzt) ?? routenDauer(job)
    }

    /// berechneEta aus etaBerechnung.js.
    static func ankunft(_ job: [String: Any], dauer: Int, _ jetzt: Date) -> String? {
        if let rest = liveRest(job, jetzt) { return uhrzeit(jetzt.addingTimeInterval(Double(rest) * 60)) }
        guard let g = geplant(job, jetzt) else { return nil }
        let start = g < jetzt && Calendar.current.isDate(g, inSameDayAs: jetzt) ? jetzt : g
        return uhrzeit(start.addingTimeInterval(Double(max(0, dauer)) * 60))
    }

    // MARK: Orte

    private static func kurz(_ text: String) -> String {
        let t = text.trimmingCharacters(in: .whitespaces)
        guard !t.isEmpty else { return "" }
        let erster = t.split(separator: ",", omittingEmptySubsequences: false).first.map { $0.trimmingCharacters(in: .whitespaces) } ?? ""
        return erster.isEmpty ? t : erster
    }

    /// extractLocationLabel
    static func ortName(_ name: String, _ adresse: String) -> String {
        let n = kurz(name)
        if !n.isEmpty { return n }
        let a = adresse.trimmingCharacters(in: .whitespaces)
        if a.isEmpty { return "-" }
        let k = kurz(a)
        return k.isEmpty ? a : k
    }

    /// buildLocationQuery
    static func suche(_ name: String, _ adresse: String) -> String {
        if !name.isEmpty, !adresse.isEmpty, name != adresse { return "\(name), \(adresse)" }
        return name.isEmpty ? adresse : name
    }

    /// ortsArt + ortsIcon: Flughafen, Hotel oder Adresse (graue Icons).
    static func ortsArt(_ name: String, _ adresse: String, start: Bool) -> (typ: String, icon: String) {
        let text = "\(name) \(adresse)".lowercased()
        func passt(_ muster: String) -> Bool { text.range(of: "\\b(\(muster))\\b", options: .regularExpression) != nil }
        if passt("flughafen|airport|terminal|muc|fra|ber|ham|dus|str|cgn") {
            return ("Flughafen", start ? "Plain_Landen_Trisar_Icons_01_grau" : "Plain_Abflug_Trisar_Icons_01_grau")
        }
        if passt("hotel|resort|hostel|inn|motel|guesthouse|suite|aparthotel|residence") { return ("Hotel", "House_Nav_Trisar_01_grau") }
        return ("Adresse", "Pin_Nav_Trisar_Icons_01_grau")
    }

    private static func abholung(_ j: [String: Any]) -> (String, String) {
        (KartenDaten.text(j["pickup_name"]), KartenDaten.text(j["pickup_address"]))
    }

    private static func ziel(_ j: [String: Any]) -> (String, String) {
        (KartenDaten.text(j["dropoff_name"]), KartenDaten.text(j["dropoff_address"]))
    }

    /// buildDriverRideInfo
    static func fahrtInfo(aktiv: [String: Any]?, naechster: [String: Any]?, alle: [[String: Any]],
                          dienstStart: String, dienstEnde: String, jetzt: Date,
                          ortIcons: [String: String] = [:]) -> KartenFahrtInfo {
        var info = KartenFahrtInfo()
        let sortiert = alle.compactMap { j in zeitpunkt(j).map { (j, $0) } }.sorted { $0.1 < $1.1 }
        let erster = sortiert.first?.0, letzter = sortiert.last?.0
        info.dienststart = uhrText(dienstStart.isEmpty ? erster?["etd"] : dienstStart as Any?)
        let endeBasis: Any? = !dienstEnde.isEmpty ? dienstEnde
            : (plusMinuten(uhrText(letzter?["etd"]), letzter.map(routenDauer) ?? 0) ?? letzter?["etd"])
        info.dienstende = uhrText(endeBasis)

        guard let job = aktiv ?? naechster else { return info }
        let geplanteAbfahrt = uhrText(job["etd"])
        info.abfahrt = abfahrt(job, jetzt) ?? geplanteAbfahrt
        info.ankunft = ankunft(job, dauer: routenDauer(job), jetzt) ?? "--:--"
        info.fahrMinuten = restFahrzeit(job, jetzt)
        info.unterwegs = unterwegsStatus.contains(status(job["status"]))
        let (vn, va) = abholung(job), (zn, za) = ziel(job)
        let s = ortsArt(vn, va, start: true), z = ortsArt(zn, za, start: false)
        // Hat die Fahrt einen eigenen Ort, gewinnt dessen Icon, sonst das Textmuster.
        let sIcon = ortIcons[KartenDaten.text(job["pickup_ort_id"]).lowercased()] ?? s.icon
        let zIcon = ortIcons[KartenDaten.text(job["dropoff_ort_id"]).lowercased()] ?? z.icon
        info.von = KartenOrt(typ: s.typ, icon: sIcon, name: ortName(vn, va))
        info.nach = KartenOrt(typ: z.typ, icon: zIcon, name: ortName(zn, za))
        return info
    }

    /// buildDriverActiveRide: ohne Abhol- oder Zieltext keine Route.
    static func fahrt(_ job: [String: Any], ortPunkte: [String: CLLocationCoordinate2D] = [:]) -> KartenFahrt? {
        let (vn, va) = abholung(job), (zn, za) = ziel(job)
        let von = suche(vn, va), nach = suche(zn, za)
        guard !von.isEmpty, !nach.isEmpty else { return nil }
        let id = KartenDaten.text(job["id"])
        // Wie trisar_evaluate_job_status: Pin des eigenen Orts, dann TomTom-Payloads.
        let payload = Routen.payloadPunkte(job)
        let vonOrt = ortPunkte[KartenDaten.text(job["pickup_ort_id"]).lowercased()]
        let nachOrt = ortPunkte[KartenDaten.text(job["dropoff_ort_id"]).lowercased()]
        return KartenFahrt(id: id, status: status(job["status"]), vonSuche: von, nachSuche: nach,
                           vonPunkt: vonOrt ?? payload.von, nachPunkt: nachOrt ?? payload.nach)
    }
}
