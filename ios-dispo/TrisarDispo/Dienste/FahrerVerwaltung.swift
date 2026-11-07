import Foundation
import Supabase

// Daten und Logik des Fahrer-Bereichs, 1:1 aus admin/src/components/views/AlleFahrer.jsx
// und FahrerErstellenView.jsx. Gleiche Tabellen, Spalten, Filter und Fehlertexte.

/// Ein Fahrer wie `mapRowsToDrivers` in AlleFahrer.jsx.
struct DispoFahrer: Identifiable, Equatable, Hashable {
    let id: String
    let name: String
    let firstName: String
    let lastName: String
    let email: String
    let vehicle: String
    let role: String?
    let driverNumber: Int?
    let driverActivityState: String?
    var serviceStartTime: String
    var serviceEndTime: String
    let serviceStartDate: String
    var planRequestStatus: String

    /// isDriverIncomplete: ohne Fahrzeug, Nummer oder vollstaendige Dienstzeit.
    var unfertig: Bool {
        vehicle.trimmingCharacters(in: .whitespaces).isEmpty || driverNumber == nil
            || Dienstzeit.normal(serviceStartTime).isEmpty || Dienstzeit.normal(serviceEndTime).isEmpty
    }

    /// isDriverInServiceNow: jetzt innerhalb der Dienstzeit (auch ueber Mitternacht).
    func imDienst(jetzt: Date = Date()) -> Bool {
        guard let s = Dienstzeit.minuten(serviceStartTime), let e = Dienstzeit.minuten(serviceEndTime) else { return false }
        let k = Calendar.current.dateComponents([.hour, .minute], from: jetzt)
        let n = (k.hour ?? 0) * 60 + (k.minute ?? 0)
        return Dienstzeit.segmente(s, e).contains { n >= $0.0 && n <= $0.1 }
    }
}

/// Fahrt im Planungshorizont (nur die Spalten, die die Uebersicht braucht).
struct PlanFahrt: Decodable {
    let ride_date: String?
    let etd: String?
    let status: String?
}

/// Uhrzeit- und Datumshilfen aus AlleFahrer.jsx (normalizeClockValue, buildDailySegments ...).
enum Dienstzeit {
    static func normal(_ wert: String?) -> String {
        let roh = (wert ?? "").trimmingCharacters(in: .whitespaces)
        guard let m = roh.firstMatch(of: /^(\d{1,2}):(\d{2})/), let h = Int(m.1), let mi = Int(m.2),
              (0...23).contains(h), (0...59).contains(mi) else { return "" }
        return String(format: "%02d:%02d", h, mi)
    }

    static func minuten(_ wert: String?) -> Int? {
        let n = normal(wert)
        guard !n.isEmpty else { return nil }
        let teile = n.split(separator: ":").compactMap { Int($0) }
        return teile[0] * 60 + teile[1]
    }

    static func segmente(_ s: Int, _ e: Int) -> [(Int, Int)] {
        e >= s ? [(s, e)] : [(s, 1439), (0, e)]
    }

    static func heute() -> String { Datum.tagWert(Date()) }

    static func plusTage(_ iso: String, _ tage: Int) -> String {
        guard iso.wholeMatch(of: /\d{4}-\d{2}-\d{2}/) != nil else { return iso }
        let d = Calendar.current.date(byAdding: .day, value: tage, to: Datum.ausTagWert(iso)) ?? Date()
        return Datum.tagWert(d)
    }

    /// Tagesabstand zu heute (0 = heute, 1 = morgen ...).
    static func tagAbstand(_ iso: String?) -> Int? {
        guard let iso, iso.trimmingCharacters(in: .whitespaces).wholeMatch(of: /\d{4}-\d{2}-\d{2}/) != nil else { return nil }
        let ziel = Calendar.current.startOfDay(for: Datum.ausTagWert(iso.trimmingCharacters(in: .whitespaces)))
        let heute = Calendar.current.startOfDay(for: Date())
        return Calendar.current.dateComponents([.day], from: heute, to: ziel).day
    }

    /// formatDayMonthDisplay: "dd.MM."
    static func tagMonat(_ iso: String) -> String {
        guard let m = iso.trimmingCharacters(in: .whitespaces).wholeMatch(of: /(\d{4})-(\d{2})-(\d{2})/) else { return "" }
        return "\(m.3).\(m.2)."
    }

    /// normalizePlanRequestStatus
    static func anfrageStatus(_ wert: String?) -> String {
        let n = (wert ?? "").trimmingCharacters(in: .whitespaces).lowercased()
        if ["cancelled", "canceled", "reset"].contains(n) { return "cancelled" }
        if ["accepted", "assigned", "approved"].contains(n) { return "accepted" }
        if ["refused", "rejected", "declined"].contains(n) { return "refused" }
        if ["pending", "new", "requested", "offered"].contains(n) { return "pending" }
        return ""
    }

    /// getPlanRequestStatusColor
    static func anfrageFarbe(_ wert: String) -> UInt32 {
        switch anfrageStatus(wert) {
        case "refused": return 0xF55757
        case "pending": return 0xFF8A00
        default: return 0x1D1C1D
        }
    }
}

/// Planungshorizont der wischbaren Zeitachse: heute + 2 Folgetage.
enum Planung {
    static let tage = 3
    static let stunden = tage * 24
    static let chartStart = 6
    static let chartEnde = 23
    static var fensterLaenge: Int { chartEnde - chartStart + 1 }
    static let ausgeschlossen: Set<String> = ["done", "completed", "arrived", "archived", "cancelled", "canceled", "refused", "rejected"]

    /// Fahrer je Stunde (72 h). Schicht mit Datum zaehlt nur an ihrem Tag.
    static func angebot(_ fahrer: [DispoFahrer]) -> [Int] {
        var z = Array(repeating: 0, count: stunden)
        let heute = Dienstzeit.heute()
        for f in fahrer {
            guard let s = Dienstzeit.minuten(f.serviceStartTime), let e = Dienstzeit.minuten(f.serviceEndTime) else { continue }
            let seg = Dienstzeit.segmente(s, e)
            let datum = f.serviceStartDate.trimmingCharacters(in: .whitespaces)
            for tag in 0..<tage {
                if !datum.isEmpty && datum != Dienstzeit.plusTage(heute, tag) { continue }
                for h in 0..<24 {
                    let a = h * 60, b = min(1439, a + 59)
                    if seg.contains(where: { max($0.0, a) <= min($0.1, b) }) { z[tag * 24 + h] += 1 }
                }
            }
        }
        return z
    }

    /// Geplante Fahrten je Stunde (72 h).
    static func fahrten(_ liste: [PlanFahrt]) -> [Int] {
        var z = Array(repeating: 0, count: stunden)
        for f in liste {
            let st = (f.status ?? "").trimmingCharacters(in: .whitespaces).lowercased()
            if ausgeschlossen.contains(st) { continue }
            guard let tag = Dienstzeit.tagAbstand(f.ride_date), tag >= 0, tag < tage,
                  let m = (f.etd ?? "").trimmingCharacters(in: .whitespaces).firstMatch(of: /^(\d{1,2}):(\d{2})/),
                  let h = Int(m.1), (0...23).contains(h) else { continue }
            z[tag * 24 + h] += 1
        }
        return z
    }

    /// computeDemandCurve (demo/planungsKurven.js): geglaettete gebuchte Fahrten, leere Stunden 0.
    static func bedarf(_ gebucht: [Int]) -> [Int] {
        let n = max(gebucht.count, fensterLaenge)
        let b = (0..<n).map { $0 < gebucht.count ? max(0, gebucht[$0]) : 0 }
        return (0..<n).map { i in
            let vor = i > 0 ? b[i - 1] : 0
            let nach = i + 1 < n ? b[i + 1] : 0
            if b[i] == 0 { return 0 }
            return max(b[i], Int((Double(vor + 2 * b[i] + nach) / 4).rounded()))
        }
    }
}

/// Fehlermeldung wie `error.message` im Web.
func dbMeldung(_ error: Error) -> String {
    (error as? PostgrestError)?.message ?? error.localizedDescription
}

private let fehlendesSchemaSQL = """
-- Falls noch nicht vorhanden:
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'fahrer';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS vehicle_id UUID REFERENCES public.vehicles(id) ON DELETE SET NULL;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS driver_number BIGINT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS driver_activity_state TEXT DEFAULT 'frei';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS service_start_time TIME;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS service_end_time TIME;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS service_start_date DATE;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS service_end_date DATE;
ALTER TABLE public.vehicles ADD COLUMN IF NOT EXISTS license_plate TEXT;
CREATE TABLE IF NOT EXISTS public.driver_service_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  service_date DATE NOT NULL,
  service_start_time TIME,
  service_end_time TIME,
  status TEXT NOT NULL DEFAULT 'pending',
  requested_by TEXT,
  refusal_reason TEXT,
  responded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
"""

// MARK: - Fahrerliste (AlleFahrer.jsx: loadDrivers + Realtime)

@MainActor
final class FahrerListeDienst: ObservableObject {
    @Published private(set) var fahrer: [DispoFahrer] = []
    @Published private(set) var fahrten: [PlanFahrt] = []
    @Published private(set) var laedt = true
    @Published private(set) var fehler = ""

    private var geladen = false
    private var bevorzugteAuswahl = ""
    private var kanal: RealtimeChannelV2?
    private var beobachter: [Task<Void, Never>] = []
    private var abfrage: Task<Void, Never>?

    private struct Zeile: Decodable {
        struct Fahrzeug: Decodable { let license_plate: String? }
        let id: String?
        let first_name: String?
        let last_name: String?
        let email: String?
        let role: String?
        let driver_number: Int?
        let driver_activity_state: String?
        let service_start_time: String?
        let service_end_time: String?
        let service_start_date: String?
        let vehicles: Fahrzeug?
    }

    private struct Anfrage: Decodable {
        let driver_id: String?
        let status: String?
    }

    // Gleiche Rueckfall-Reihe wie im Web, falls Spalten fehlen.
    private static let auswahlListe = [
        "id, first_name, last_name, email, created_at, vehicle_id, role, is_dispo, driver_number, driver_activity_state, service_start_time, service_end_time, vehicles:vehicle_id(license_plate)",
        "id, first_name, last_name, created_at, vehicle_id, role, is_dispo, driver_number, driver_activity_state, service_start_time, service_end_time, vehicles:vehicle_id(license_plate)",
        "id, first_name, last_name, email, created_at, vehicle_id, role, is_dispo, driver_number, vehicles:vehicle_id(license_plate)",
        "id, first_name, last_name, created_at, vehicle_id, role, is_dispo, driver_number, vehicles:vehicle_id(license_plate)",
    ]

    func laden() async {
        if !geladen { laedt = true }
        fehler = ""
        let reihe = bevorzugteAuswahl.isEmpty ? Self.auswahlListe
            : [bevorzugteAuswahl] + Self.auswahlListe.filter { $0 != bevorzugteAuswahl }
        var zeilen: [Zeile]?
        var letzterFehler: Error?
        for auswahl in reihe {
            do {
                zeilen = try await Backend.client.from("profiles").select(auswahl)
                    .order("last_name", ascending: true, nullsFirst: false)
                    .order("first_name", ascending: true, nullsFirst: false)
                    .execute().value
                bevorzugteAuswahl = auswahl
                break
            } catch {
                letzterFehler = error
            }
        }

        guard let zeilen else {
            let meldung = letzterFehler.map(dbMeldung) ?? ""
            if !geladen { fahrer = [] }
            if meldung.range(of: "no suitable key|wrong key type|jwt|invalid api key|unauthorized", options: [.regularExpression, .caseInsensitive]) != nil {
                fehler = "Supabase-Key ist ungültig oder falscher Typ. Nutze den anon public key (nicht service_role) in admin-app-lokal/.env.local als VITE_SUPABASE_ANON_KEY."
            } else if meldung.range(of: "vehicle_id|license_plate|driver_number|driver_activity_state|service_start_time|service_end_time|relation .*vehicles|column .*is_dispo|column .*role", options: [.regularExpression, .caseInsensitive]) != nil {
                fehler = "DB-Schema unvollständig. Bitte ausführen:\n\(fehlendesSchemaSQL)"
            } else {
                fehler = meldung.isEmpty ? "Fahrer konnten nicht geladen werden." : meldung
            }
            laedt = false
            return
        }

        var liste = zeilen.map { z -> DispoFahrer in
            let vor = (z.first_name ?? "").trimmingCharacters(in: .whitespaces)
            let nach = (z.last_name ?? "").trimmingCharacters(in: .whitespaces)
            let name = [z.first_name, z.last_name].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " ")
                .trimmingCharacters(in: .whitespaces)
            let id = (z.id ?? "").trimmingCharacters(in: .whitespaces)
            return DispoFahrer(
                id: id.isEmpty ? "-" : id,
                name: name.isEmpty ? "Ohne Name" : name,
                firstName: vor, lastName: nach,
                email: (z.email ?? "").trimmingCharacters(in: .whitespaces),
                vehicle: z.vehicles?.license_plate ?? "",
                role: z.role,
                driverNumber: z.driver_number,
                driverActivityState: z.driver_activity_state,
                serviceStartTime: Dienstzeit.normal(z.service_start_time),
                serviceEndTime: Dienstzeit.normal(z.service_end_time),
                serviceStartDate: (z.service_start_date ?? "").trimmingCharacters(in: .whitespaces),
                planRequestStatus: ""
            )
        }

        // Neueste Dienstanfrage je Fahrer liefert nur die Farbe der Zeiten.
        let ids = liste.map(\.id).filter { $0 != "-" }
        if !ids.isEmpty {
            do {
                let anfragen: [Anfrage] = try await Backend.client.from("driver_service_requests")
                    .select("driver_id,status,service_start_time,service_end_time,created_at")
                    .in("driver_id", values: ids)
                    .order("created_at", ascending: false)
                    .execute().value
                var neueste: [String: String] = [:]
                for a in anfragen {
                    let d = (a.driver_id ?? "").trimmingCharacters(in: .whitespaces)
                    if d.isEmpty || neueste[d] != nil { continue }
                    neueste[d] = Dienstzeit.anfrageStatus(a.status)
                }
                for i in liste.indices { liste[i].planRequestStatus = neueste[liste[i].id] ?? "" }
            } catch {
                print("driver_service_requests konnte nicht gelesen werden (AlleFahrer/Admin):", error)
            }
        }
        fahrer = liste

        // Planungshorizont: heute bis uebermorgen. Im Betrieb gilt der echte Zeitraum, auch leer.
        let heute = Dienstzeit.heute()
        let ende = Dienstzeit.plusTage(heute, Planung.tage - 1)
        fahrten = (try? await Backend.client.from("jobs")
            .select("id, ride_date, etd, status, pickup_name, pickup_address, dropoff_name, dropoff_address, ext_route_duration_mins, ext_route_duration_in_traffic_mins")
            .gte("ride_date", value: heute)
            .lte("ride_date", value: ende)
            .execute().value) ?? []

        geladen = true
        laedt = false
    }

    /// Realtime auf profiles, vehicles, jobs, driver_service_requests plus Abfrage jede Minute.
    func starten() async {
        guard kanal == nil else { return }
        await laden()
        let k = Backend.client.channel("admin-drivers-live-\(Int(Date().timeIntervalSince1970 * 1000))")
        let stroeme = ["profiles", "vehicles", "jobs", "driver_service_requests"].map {
            k.postgresChange(AnyAction.self, schema: "public", table: $0)
        }
        kanal = k
        beobachter = stroeme.map { strom in
            Task { [weak self] in
                for await _ in strom { await self?.laden() }
            }
        }
        try? await k.subscribeWithError()
        abfrage = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(60))
                if Task.isCancelled { break }
                await self?.laden()
            }
        }
    }

    func stoppen() async {
        beobachter.forEach { $0.cancel() }
        beobachter = []
        abfrage?.cancel()
        abfrage = nil
        if let kanal { await Backend.client.removeChannel(kanal) }
        kanal = nil
    }
}

// MARK: - Fahrer anlegen / bearbeiten (FahrerErstellenView.jsx)

struct DispoFahrzeug: Decodable, Identifiable {
    let id: String
    let brand_model: String?
    let license_plate: String?

    /// "Marke Modell (Kennzeichen)" wie im Web.
    var etikett: String {
        let m = (brand_model ?? "").trimmingCharacters(in: .whitespaces)
        let p = (license_plate ?? "").trimmingCharacters(in: .whitespaces)
        if !m.isEmpty && !p.isEmpty { return "\(m) (\(p))" }
        return m.isEmpty ? p : m
    }
}

struct TrackerEintrag: Decodable, Identifiable {
    struct Besitzer: Decodable { let first_name: String?; let last_name: String? }
    let imei: String
    let driver_id: String?
    let is_active: Bool?
    let driver: Besitzer?
    /// Nummer auf dem Geraet (obd_tracker), nil wenn keine vergeben.
    var nummer: Int?
    var id: String { imei }
    var besitzerName: String {
        [driver?.first_name, driver?.last_name].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " ")
            .trimmingCharacters(in: .whitespaces)
    }
}

@MainActor
final class FahrerEditorModell: ObservableObject {
    static let sprachen = ["Deutsch", "English", "Français", "Italiano", "Español", "Türkçe"]
    /// Wie NAME_MUSTER in dispo-admin: 3 bis 32 Zeichen aus a-z, 0-9, Punkt, Unterstrich, Bindestrich.
    static func nameGueltig(_ name: String) -> Bool {
        name.wholeMatch(of: /[a-z0-9._-]{3,32}/) != nil
    }
    /// Konten ohne echte E-Mail haben auf dem Server diese Platzhalter-Adresse. Nie anzeigen.
    static func istPlatzhalter(_ mail: String) -> Bool {
        mail.lowercased().hasSuffix("@konto.trisar.de")
    }

    let ursprung: DispoFahrer?
    var bearbeiten: Bool { ursprung != nil }

    @Published var vorname = ""
    @Published var nachname = ""
    @Published var email = ""
    /// Benutzername fuer die Anmeldung (profiles.username), immer klein geschrieben.
    @Published var benutzername = ""
    /// Beim Anlegen Pflicht, beim Bearbeiten nur, wenn ein neues Passwort gesetzt werden soll.
    @Published var passwort = ""
    @Published var landesvorwahl = "+49"
    @Published var telefon = ""
    @Published var strasse = ""
    @Published var hausnummer = ""
    @Published var ort = ""
    @Published var plz = ""
    @Published var sprache = "Deutsch"
    @Published var fahrzeugID = ""
    @Published var nummer = ""
    @Published var nummerWarnung = ""
    /// 'app' = Handy-Standort aus der Fahrer-App, 'obd' = Tracker (IMEI) im Auto.
    @Published var ortung = "app"
    @Published var imei = ""
    @Published private(set) var fahrzeuge: [DispoFahrzeug] = []
    @Published private(set) var fahrzeugeLaden = false
    @Published private(set) var tracker: [TrackerEintrag] = []
    @Published private(set) var speichert = false
    @Published var rueckmeldung = ""

    private var urspruenglicheEmail = ""
    private var urspruenglicherName = ""
    private var nummerPruefung: Task<Void, Never>?

    init(fahrer: DispoFahrer?) { ursprung = fahrer }

    var fahrzeugEtikett: String {
        guard let f = fahrzeuge.first(where: { $0.id == fahrzeugID }) else { return "Fahrzeug koppeln" }
        let e = f.etikett
        return e.isEmpty ? "Fahrzeug" : e
    }

    /// Tracker, der gerade bei jemand anderem aktiv ist (Hinweis unter dem IMEI-Feld).
    var trackerBeiAnderem: TrackerEintrag? {
        guard ortung == "obd" else { return nil }
        return tracker.first { $0.imei == imei && $0.is_active == true && $0.driver_id != ursprung?.id }
    }

    func start() async {
        async let a: Void = fahrzeugeHolen()
        async let b: Void = trackerHolen()
        async let c: Void = fahrerHolen()
        _ = await (a, b, c)
    }

    private func fahrzeugeHolen() async {
        fahrzeugeLaden = true
        do {
            var liste: [DispoFahrzeug]
            do {
                liste = try await Backend.client.from("vehicles").select("*").order("brand_model", ascending: true).execute().value
            } catch where dbMeldung(error).range(of: "brand_model", options: .caseInsensitive) != nil {
                liste = try await Backend.client.from("vehicles").select("*").order("created_at", ascending: false).execute().value
            }
            fahrzeuge = liste
        } catch {
            fahrzeuge = []
            rueckmeldung = "Fahrzeuge konnten nicht geladen werden: \(dbMeldung(error))"
        }
        fahrzeugeLaden = false
    }

    /// Bekannte Tracker: alle mit Nummer (obd_tracker) plus alle, die schon einmal einem Fahrer zugeordnet waren.
    private func trackerHolen() async {
        struct Nummer: Decodable { let imei: String; let nummer: Int }
        // Tabelle fehlt: Liste bleibt leer, IMEI kann von Hand eingetragen werden.
        let zuordnungen: [TrackerEintrag] = (try? await Backend.client.from("imei_driver_map")
            .select("imei, driver_id, is_active, driver:driver_id(first_name, last_name)")
            .execute().value) ?? []
        let nummern: [Nummer] = (try? await Backend.client.from("obd_tracker")
            .select("imei, nummer").execute().value) ?? []
        var nachImei: [String: TrackerEintrag] = [:]
        for z in zuordnungen { nachImei[z.imei] = z }
        for n in nummern {
            var e = nachImei[n.imei] ?? TrackerEintrag(imei: n.imei, driver_id: nil, is_active: false, driver: nil)
            e.nummer = n.nummer
            nachImei[n.imei] = e
        }
        tracker = nachImei.values.sorted {
            ($0.nummer ?? Int.max, $0.imei) < ($1.nummer ?? Int.max, $1.imei)
        }
    }

    /// Nummer des gerade eingetragenen Trackers (fuer die Anzeige im Feld).
    var trackerNummer: Int? { tracker.first { $0.imei == imei }?.nummer }

    private struct Profil: Decodable {
        let first_name: String?
        let last_name: String?
        let email: String?
        let phone: String?
        let street: String?
        let street_number: String?
        let city: String?
        let zip: String?
        let language: String?
        let vehicle_id: String?
        let driver_number: Int?
        let tracking_mode: String?
        let username: String?

        enum CodingKeys: String, CodingKey {
            case first_name, last_name, email, phone, street, street_number, city, zip, language, vehicle_id, driver_number, tracking_mode, username
        }

        // Text- oder Zahlspalten (PLZ, Hausnummer ...) wie String(...) im Web lesen.
        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            func text(_ k: CodingKeys) -> String? {
                if let s = try? c.decodeIfPresent(String.self, forKey: k) { return s }
                if let i = try? c.decodeIfPresent(Int.self, forKey: k) { return String(i) }
                return nil
            }
            first_name = text(.first_name)
            last_name = text(.last_name)
            email = text(.email)
            phone = text(.phone)
            street = text(.street)
            street_number = text(.street_number)
            city = text(.city)
            zip = text(.zip)
            language = text(.language)
            vehicle_id = text(.vehicle_id)
            driver_number = (try? c.decodeIfPresent(Int.self, forKey: .driver_number)) ?? text(.driver_number).flatMap { Int($0) }
            tracking_mode = text(.tracking_mode)
            username = text(.username)
        }
    }

    private func fahrerHolen() async {
        guard let f = ursprung else { return }
        rueckmeldung = ""
        vorname = f.firstName
        nachname = f.lastName
        nummer = f.driverNumber.map(String.init) ?? ""
        email = Self.istPlatzhalter(f.email) ? "" : f.email
        urspruenglicheEmail = email.lowercased()
        do {
            let daten: Profil?
            do {
                daten = try await Backend.client.from("profiles")
                    .select("*, auth_user:auth.users!profiles_id_fkey(email)")
                    .eq("id", value: f.id).maybeSingle().execute().value
            } catch {
                daten = try await Backend.client.from("profiles").select("*")
                    .eq("id", value: f.id).maybeSingle().execute().value
            }
            guard let d = daten else { return }
            let tel = Self.telefonTeilen(d.phone ?? "")
            vorname = (d.first_name ?? f.firstName).trimmingCharacters(in: .whitespaces)
            nachname = (d.last_name ?? f.lastName).trimmingCharacters(in: .whitespaces)
            let mail = (d.email ?? f.email).trimmingCharacters(in: .whitespaces)
            if !mail.isEmpty && !Self.istPlatzhalter(mail) {
                email = mail
                urspruenglicheEmail = mail.lowercased()
            }
            landesvorwahl = tel.0
            telefon = tel.1
            strasse = (d.street ?? "").trimmingCharacters(in: .whitespaces)
            hausnummer = (d.street_number ?? "").trimmingCharacters(in: .whitespaces)
            ort = (d.city ?? "").trimmingCharacters(in: .whitespaces)
            plz = (d.zip ?? "").trimmingCharacters(in: .whitespaces)
            let s = (d.language ?? "Deutsch").trimmingCharacters(in: .whitespaces)
            sprache = s.isEmpty ? "Deutsch" : s
            fahrzeugID = (d.vehicle_id ?? "").trimmingCharacters(in: .whitespaces)
            nummer = d.driver_number.map(String.init) ?? (f.driverNumber.map(String.init) ?? "")
            ortung = d.tracking_mode == "obd" ? "obd" : "app"
            benutzername = (d.username ?? "").trimmingCharacters(in: .whitespaces).lowercased()
            urspruenglicherName = benutzername

            struct Imei: Decodable { let imei: String? }
            let aktiv: Imei? = try await Backend.client.from("imei_driver_map").select("imei")
                .eq("driver_id", value: f.id).eq("is_active", value: true)
                .maybeSingle().execute().value
            imei = (aktiv?.imei ?? "").trimmingCharacters(in: .whitespaces)
        } catch {
            rueckmeldung = "Fahrerdaten konnten nicht geladen werden: \(dbMeldung(error))"
        }
    }

    /// normalizePhone: "+49 1234" -> ("+49", "1234").
    static func telefonTeilen(_ wert: String) -> (String, String) {
        let v = wert.trimmingCharacters(in: .whitespaces)
        if v.isEmpty { return ("+49", "") }
        if let m = v.wholeMatch(of: /(\+\d{1,4})\s*(.*)/) { return (String(m.1), String(m.2)) }
        return ("+49", v)
    }

    /// Fahrernummer nur aus Ziffern, Doppel-Pruefung nach 500 ms (nur beim Anlegen).
    func nummerGeaendert(_ wert: String) {
        let ziffern = wert.filter(\.isNumber)
        if ziffern != nummer { nummer = ziffern }
        nummerPruefung?.cancel()
        nummerPruefung = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(500))
            guard !Task.isCancelled else { return }
            await self?.nummerPruefen(ziffern)
        }
    }

    private func nummerPruefen(_ wert: String) async {
        guard !wert.isEmpty, !bearbeiten, let n = Int(wert), n > 0 else { nummerWarnung = ""; return }
        struct Treffer: Decodable { let first_name: String?; let last_name: String? }
        do {
            let t: Treffer? = try await Backend.client.from("profiles")
                .select("id, first_name, last_name, driver_number")
                .eq("driver_number", value: n).maybeSingle().execute().value
            if let t {
                let name = [t.first_name, t.last_name].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " ")
                nummerWarnung = "⚠️ Nummer \(n) bereits vergeben an: \(name)"
            } else {
                nummerWarnung = ""
            }
        } catch {
            nummerWarnung = ""
        }
    }

    private func formularLeeren() {
        vorname = ""; nachname = ""; email = ""
        benutzername = ""; passwort = ""; urspruenglicherName = ""
        landesvorwahl = "+49"; telefon = ""
        strasse = ""; hausnummer = ""; ort = ""; plz = ""
        sprache = "Deutsch"; fahrzeugID = ""; nummer = ""
        urspruenglicheEmail = ""
        ortung = "app"; imei = ""
    }

    /// Fahrer endgueltig loeschen (dispo-admin, aktion konto_loeschen). true = geloescht.
    /// Offene Fahrten werden frei, Standorte/Stunden/Tracker-Zuordnung fallen mit.
    func loeschen() async -> Bool {
        guard let id = ursprung?.id, !speichert else { return false }
        struct Koerper: Encodable { let aktion = "konto_loeschen"; let user_id: String }
        speichert = true
        defer { speichert = false }
        do {
            _ = try await dispoAdmin(Koerper(user_id: id), fehlschlag: "Löschen fehlgeschlagen")
            return true
        } catch {
            rueckmeldung = error.localizedDescription
            return false
        }
    }

    /// createDriver aus FahrerErstellenView.jsx. Wird nur durch den Knopf ausgeloest.
    func speichern() async {
        if vorname.trimmingCharacters(in: .whitespaces).isEmpty || nachname.trimmingCharacters(in: .whitespaces).isEmpty {
            rueckmeldung = "Bitte Vorname und Nachname angeben."; return
        }
        let name = benutzername.trimmingCharacters(in: .whitespaces).lowercased()
        let mail = email.trimmingCharacters(in: .whitespaces).lowercased()
        if name.isEmpty && mail.isEmpty {
            rueckmeldung = "Bitte Benutzername oder E-Mail angeben."; return
        }
        if !name.isEmpty && !Self.nameGueltig(name) {
            rueckmeldung = "Benutzername ungültig. Erlaubt sind 3 bis 32 Zeichen aus a-z, 0-9, Punkt, Unterstrich und Bindestrich."; return
        }
        if !mail.isEmpty && mail.wholeMatch(of: /[^\s@]+@[^\s@]+\.[^\s@]+/) == nil {
            rueckmeldung = "Bitte eine gültige E-Mail-Adresse eingeben (z. B. name@firma.de)."; return
        }
        if !bearbeiten && passwort.isEmpty {
            rueckmeldung = "Bitte ein Passwort angeben (mindestens 8 Zeichen)."; return
        }
        if !passwort.isEmpty && passwort.count < 8 {
            rueckmeldung = "Passwort zu kurz. Mindestens 8 Zeichen."; return
        }
        if nummer.trimmingCharacters(in: .whitespaces).isEmpty {
            rueckmeldung = "Bitte eine Fahrernummer in \"Nr.\" angeben."; return
        }
        guard let fahrerNummer = Int(nummer), fahrerNummer > 0 else {
            rueckmeldung = "Fahrernummer muss eine positive ganze Zahl sein."; return
        }
        let imeiZiffern = imei.filter(\.isNumber)
        if ortung == "obd" && imeiZiffern.count != 15 {
            rueckmeldung = "Bitte die 15-stellige IMEI des Trackers eintragen."; return
        }

        speichert = true
        rueckmeldung = ""
        defer { speichert = false }

        let mailFuerProfil: AnyJSON = !mail.isEmpty ? .string(mail)
            : (bearbeiten && !urspruenglicheEmail.isEmpty ? .string(urspruenglicheEmail) : .null)
        func oderNull(_ s: String) -> AnyJSON {
            let t = s.trimmingCharacters(in: .whitespaces)
            return t.isEmpty ? .null : .string(t)
        }
        var profil: [String: AnyJSON] = [
            "first_name": .string(vorname.trimmingCharacters(in: .whitespaces)),
            "last_name": .string(nachname.trimmingCharacters(in: .whitespaces)),
            "email": mailFuerProfil,
            "username": name.isEmpty ? .null : .string(name),
            "phone": .string("\(landesvorwahl.trimmingCharacters(in: .whitespaces)) \(telefon.trimmingCharacters(in: .whitespaces))"
                .trimmingCharacters(in: .whitespaces)),
            "street": oderNull(strasse),
            "street_number": oderNull(hausnummer),
            "city": oderNull(ort),
            "zip": oderNull(plz),
            "language": .string(sprache.isEmpty ? "Deutsch" : sprache),
            "vehicle_id": fahrzeugID.isEmpty ? .null : .string(fahrzeugID),
            "driver_number": .integer(fahrerNummer),
            "tracking_mode": .string(ortung),
        ]
        // Rolle nur beim Anlegen setzen. Beim Bearbeiten bleibt sie, sonst verliert ein Dispo-Konto seine Rechte.
        if !bearbeiten {
            profil["role"] = .string("fahrer")
            profil["is_dispo"] = .bool(false)
        }

        do {
            if let f = ursprung {
                let ziel = f.id.trimmingCharacters(in: .whitespaces)
                guard !ziel.isEmpty else { throw TrisarFehler.text("Fahrer-ID fehlt.") }
                // Zugang zuerst ueber dispo-admin, dort wird der Benutzername auf Doppel geprueft.
                let mailGeaendert = !mail.isEmpty && mail != urspruenglicheEmail
                if name != urspruenglicherName || mailGeaendert || !passwort.isEmpty {
                    try await kontoAendern(ziel, name: name, mail: mail)
                }
                // Im Web erst Admin-, dann oeffentlicher Client. Live sind beide derselbe angemeldete Client.
                if let fehler = await profilAktualisieren(ziel, profil) {
                    throw TrisarFehler.text("Speichern fehlgeschlagen. Admin: \(fehler) | Public: \(fehler)")
                }
                do { try await trackerSpeichern(ziel, imeiZiffern) } catch {
                    throw TrisarFehler.text("Tracker-Zuordnung nicht gespeichert: \(dbMeldung(error))")
                }
                rueckmeldung = "Fahrer gespeichert."
                if !mail.isEmpty { urspruenglicheEmail = mail }
                urspruenglicherName = name
                passwort = ""
                return
            }

            // Konto mit Passwort ueber die Funktion dispo-admin, der Admin-Schluessel bleibt auf dem Server.
            let nutzerID = try await kontoAnlegen(name: name, mail: mail)
            var zeile = profil
            zeile["id"] = .string(nutzerID)
            if let fehler = await profilEinfuegen(zeile) { throw TrisarFehler.text(fehler) }
            do { try await trackerSpeichern(nutzerID, imeiZiffern) } catch {
                throw TrisarFehler.text("Tracker-Zuordnung nicht gespeichert: \(dbMeldung(error))")
            }
            formularLeeren()
            rueckmeldung = "Konto angelegt. Anmeldung mit Benutzername oder E-Mail und dem Passwort."
        } catch {
            rueckmeldung = "Fahrer konnte nicht gespeichert werden: \(dbMeldung(error))"
        }
    }

    private static func fehltEmailSpalte(_ meldung: String) -> Bool {
        meldung.range(of: "column .*email|could not find the ['\"]?email['\"]? column",
                      options: [.regularExpression, .caseInsensitive]) != nil
    }

    /// updateProfile: bei fehlender email-Spalte einmal ohne email.
    private func profilAktualisieren(_ id: String, _ profil: [String: AnyJSON]) async -> String? {
        struct IDZeile: Decodable { let id: String? }
        var inhalt = profil
        for _ in 0..<2 {
            do {
                let z: IDZeile? = try await Backend.client.from("profiles").update(inhalt).eq("id", value: id)
                    .select("id, first_name, last_name, phone, street, street_number, city, zip, language, vehicle_id, driver_number")
                    .maybeSingle().execute().value
                if (z?.id ?? "").isEmpty {
                    return "Kein Profil aktualisiert (keine Schreibrechte oder Fahrer nicht gefunden)."
                }
                return nil
            } catch {
                let m = dbMeldung(error)
                if Self.fehltEmailSpalte(m) && inhalt["email"] != nil {
                    inhalt.removeValue(forKey: "email")
                    continue
                }
                return m
            }
        }
        return nil
    }

    /// upsertProfile: bei fehlender email-Spalte einmal ohne email.
    private func profilEinfuegen(_ zeile: [String: AnyJSON]) async -> String? {
        var inhalt = zeile
        for _ in 0..<2 {
            do {
                try await Backend.client.from("profiles").upsert([inhalt], returning: .minimal).execute()
                return nil
            } catch {
                let m = dbMeldung(error)
                if Self.fehltEmailSpalte(m) && inhalt["email"] != nil {
                    inhalt.removeValue(forKey: "email")
                    continue
                }
                return m
            }
        }
        return nil
    }

    /// Tracker-Zuordnung passend zur Ortung. Bei 'app' wird jeder Tracker des Fahrers abgeschaltet,
    /// sonst schreiben Handy und Tracker abwechselnd den Standort. Bei 'obd' bekommt der Fahrer
    /// genau diese IMEI. War sie bei jemand anderem, wandert sie mit.
    private func trackerSpeichern(_ fahrerID: String, _ imeiZiffern: String) async throws {
        struct Aus: Encodable { let is_active: Bool }
        struct An: Encodable { let imei: String; let driver_id: String; let is_active: Bool }
        try await Backend.client.from("imei_driver_map").update(Aus(is_active: false), returning: .minimal)
            .eq("driver_id", value: fahrerID)
            .neq("imei", value: ortung == "obd" ? imeiZiffern : "")
            .execute()
        guard ortung == "obd" else { return }
        try await Backend.client.from("imei_driver_map")
            .upsert([An(imei: imeiZiffern, driver_id: fahrerID, is_active: true)], onConflict: "imei", returning: .minimal)
            .execute()
    }

    /// dispo-admin, aktion konto_anlegen. Liefert die neue user_id.
    private func kontoAnlegen(name: String, mail: String) async throws -> String {
        struct Koerper: Encodable {
            let aktion = "konto_anlegen"
            let benutzername: String
            let email: String
            let passwort: String
            let first_name: String
            let last_name: String
        }
        let id = try await dispoAdmin(Koerper(
            benutzername: name, email: mail, passwort: passwort,
            first_name: vorname.trimmingCharacters(in: .whitespaces),
            last_name: nachname.trimmingCharacters(in: .whitespaces)),
            fehlschlag: "Konto konnte nicht angelegt werden")
        guard let id, !id.isEmpty else {
            throw TrisarFehler.text("Auth-User wurde nicht erstellt (keine user.id erhalten).")
        }
        return id
    }

    /// dispo-admin, aktion konto_aendern. Passwort nur, wenn eins eingetragen ist.
    private func kontoAendern(_ id: String, name: String, mail: String) async throws {
        struct Koerper: Encodable {
            let aktion = "konto_aendern"
            let user_id: String
            let benutzername: String
            let email: String
            let passwort: String?
        }
        _ = try await dispoAdmin(Koerper(
            user_id: id, benutzername: name, email: mail,
            passwort: passwort.isEmpty ? nil : passwort),
            fehlschlag: "Zugangsdaten konnten nicht geändert werden")
    }

    /// Aufruf von dispo-admin mit lesbaren Fehlern. Liefert user_id aus der Antwort.
    private struct AdminAntwort: Decodable { let user_id: String? }

    private func dispoAdmin<Koerper: Encodable>(_ koerper: Koerper, fehlschlag: String) async throws -> String? {
        do {
            let antwort: AdminAntwort = try await Backend.client.functions.invoke(
                "dispo-admin", options: FunctionInvokeOptions(body: koerper))
            return antwort.user_id
        } catch {
            var text = error.localizedDescription
            if case let FunctionsError.httpError(_, daten) = error,
               let json = try? JSONSerialization.jsonObject(with: daten) as? [String: Any],
               let e = json["error"] as? String, !e.isEmpty {
                text = e
            }
            throw TrisarFehler.text(Self.adminFehler(text) ?? "\(fehlschlag): \(text)")
        }
    }

    /// Fehlercodes von dispo-admin auf Deutsch.
    private static func adminFehler(_ code: String) -> String? {
        switch code {
        case "username_taken": return "Benutzername ist schon vergeben."
        case "username_invalid":
            return "Benutzername ungültig. Erlaubt sind 3 bis 32 Zeichen aus a-z, 0-9, Punkt, Unterstrich und Bindestrich."
        case "email_taken": return "Diese E-Mail gehört schon zu einem anderen Konto."
        case "email_invalid": return "Bitte eine gültige E-Mail-Adresse eingeben (z. B. name@firma.de)."
        case "password_too_short": return "Passwort zu kurz. Mindestens 8 Zeichen."
        case "password_missing": return "Bitte ein Passwort angeben (mindestens 8 Zeichen)."
        case "login_missing": return "Benutzername oder E-Mail fehlt."
        case "ride_running": return "Löschen nicht möglich: Der Fahrer hat gerade eine laufende Fahrt."
        case "not_a_driver": return "Dispo- und Admin-Konten lassen sich hier nicht löschen."
        case "not_dispo": return "Keine Berechtigung für die Fahrerverwaltung."
        case "not_signed_in":
            // Sitzung ist serverseitig weg, Token im Geraet noch da.
            return "Sitzung abgelaufen. Bitte einmal abmelden und neu anmelden, dann erneut speichern."
        default:
            if code.range(of: "invalid format|unable to validate email address", options: [.regularExpression, .caseInsensitive]) != nil {
                return "Bitte eine gültige E-Mail-Adresse eingeben (z. B. name@firma.de)."
            }
            return nil
        }
    }
}
