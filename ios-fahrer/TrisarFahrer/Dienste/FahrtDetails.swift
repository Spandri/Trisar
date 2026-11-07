import CoreLocation
import Foundation
import Supabase

/// Alles, was die Fahrt-Ansicht ueber die Liste hinaus braucht (Gaeste, Notizen, Merkmale,
/// Fahrzeiten, eigener Standort). Gleiche Quellen wie loadData() in FahrerApp.jsx.
@MainActor
final class FahrtDetails: ObservableObject {
    struct Notiz: Identifiable, Equatable {
        let id = UUID()
        let zeit: String
        let datum: String
        let text: String
        let autor: String
    }

    @Published private(set) var gaeste: [String] = []
    @Published private(set) var notizen: [Notiz] = []
    @Published private(set) var merkmale: [String] = []   // accessibility, vip, child, luggage
    @Published private(set) var fahrzeitMin: Int = 0      // ext_route_duration(_in_traffic)
    @Published private(set) var restZielMin: Int?         // ext_driver_to_dropoff_* (frisch)
    /// Zeitpunkt der Messung von restZielMin. Die Restzeit gilt ab hier, nicht ab jetzt.
    @Published private(set) var restZielSync: Date?

    /// Ankunft aus der Live-Restzeit: Messzeitpunkt + Restzeit, nie vor jetzt.
    func liveAnkunft(_ jetzt: Date) -> Date? {
        guard let rest = restZielMin, let sync = restZielSync else { return nil }
        return max(sync.addingTimeInterval(Double(rest) * 60), jetzt)
    }
    /// Gespeicherte TomTom-Linien der Fahrt (Rueckfall, wenn die Live-Route von OSRM ausfaellt).
    @Published private(set) var tomtomFahrt: [CLLocationCoordinate2D] = []    // ext_route_polyline
    @Published private(set) var tomtomAnfahrt: [CLLocationCoordinate2D] = []  // ext_driver_to_pickup_polyline
    @Published private(set) var fahrerNummer: String = ""
    @Published private(set) var standortDB: CLLocationCoordinate2D?
    // Flug (ext_flight_payload, wie extractFlightLiveTracking/extractFlightSummary im Web)
    @Published private(set) var flugHerkunft = ""
    @Published private(set) var flugStatusCode = ""
    @Published private(set) var flugPosition: CLLocationCoordinate2D?
    @Published private(set) var flugKurs: Double = 0
    @Published private(set) var flugSpur: [CLLocationCoordinate2D] = []
    @Published var fehler: String?

    // Kolonne (kolonneDrivers in FahrerApp.jsx)
    struct KolonnenFahrer: Identifiable, Equatable {
        let id: UUID
        let name: String
        let telefon: String
        let kennzeichen: String
        let fahrzeug: String
        let bild: String
        let nummer: String
        let antwort: String
        let gaeste: [String]
        let standort: CLLocationCoordinate2D?

        static func == (a: KolonnenFahrer, b: KolonnenFahrer) -> Bool {
            a.id == b.id && a.antwort == b.antwort && a.standort?.latitude == b.standort?.latitude
                && a.standort?.longitude == b.standort?.longitude && a.name == b.name
        }
    }
    @Published private(set) var kolonnenName = ""
    @Published private(set) var kolonnenFahrer: [KolonnenFahrer] = []

    let fahrtID: UUID
    private let fahrerID: UUID

    init(fahrtID: UUID, fahrerID: UUID) {
        self.fahrtID = fahrtID
        self.fahrerID = fahrerID
    }

    private struct DetailZeile: Decodable {
        let passengers: [String]?
        let is_vip: Bool?
        let needs_child_seat: Bool?
        let needs_second_child_seat: Bool?
        let needs_accessibility: Bool?
        let needs_luggage: Bool?
        let ext_route_duration_mins: Int?
        let ext_route_duration_in_traffic_mins: Int?
        let ext_driver_to_dropoff_duration_mins: Int?
        let ext_driver_to_dropoff_duration_in_traffic_mins: Int?
        let ext_driver_to_dropoff_last_sync_at: String?
        let ext_route_polyline: String?
        let ext_driver_to_pickup_polyline: String?
        let flight_origin: String?
        let flug_text: String?
    }

    private struct NotizZeile: Decodable { let note_text: String?; let created_at: String?; let author_name: String? }
    private struct GastLink: Decodable { let guest_id: UUID? }
    private struct Gast: Decodable {
        let id: UUID
        let first_name: String?
        let last_name: String?
        let is_vip: Bool?
        let needs_child_seat: Bool?
        let needs_second_child_seat: Bool?
        let needs_accessibility: Bool?
        let needs_luggage: Bool?
    }
    private struct Live: Decodable { let lat: Double?; let lng: Double?; let source: String?; let captured_at: String? }
    private struct Nummer: Decodable { let driver_number: Int? }

    func laden() async {
        do {
            async let zeileAbfrage: [DetailZeile] = Backend.client.from("jobs")
                .select("passengers,is_vip,needs_child_seat,needs_accessibility,needs_luggage,ext_route_duration_mins,ext_route_duration_in_traffic_mins,ext_driver_to_dropoff_duration_mins,ext_driver_to_dropoff_duration_in_traffic_mins,ext_driver_to_dropoff_last_sync_at,ext_route_polyline,ext_driver_to_pickup_polyline,flight_origin,flug_text:ext_flight_payload::text")
                .eq("id", value: fahrtID).limit(1).execute().value
            async let notizAbfrage: [NotizZeile] = Backend.client.from("job_notes")
                .select("note_text,created_at,author_name").eq("job_id", value: fahrtID)
                .order("created_at", ascending: false).execute().value
            async let linkAbfrage: [GastLink] = Backend.client.from("job_guests")
                .select("guest_id").eq("job_id", value: fahrtID).execute().value
            async let liveAbfrage: [Live] = Backend.client.from("driver_live_locations")
                .select("lat,lng,source,captured_at").eq("driver_id", value: fahrerID).limit(5).execute().value
            async let nummerAbfrage: [Nummer] = Backend.client.from("profiles")
                .select("driver_number").eq("id", value: fahrerID).limit(1).execute().value

            let zeile = try await zeileAbfrage.first
            let notizZeilen = (try? await notizAbfrage) ?? []
            let links = (try? await linkAbfrage) ?? []
            let live = (try? await liveAbfrage) ?? []
            let nummer = (try? await nummerAbfrage)?.first?.driver_number

            var gastZeilen: [Gast] = []
            let gastIDs = links.compactMap(\.guest_id).map(\.uuidString)
            if !gastIDs.isEmpty {
                gastZeilen = (try? await Backend.client.from("guests")
                    .select("id,first_name,last_name,is_vip,needs_child_seat,needs_second_child_seat,needs_accessibility,needs_luggage")
                    .in("id", values: gastIDs).execute().value) ?? []
            }

            // Gaeste: verknuepfte Gaeste, sonst Namen aus passengers.
            let verknuepft = gastZeilen.map { [$0.first_name, $0.last_name].compactMap { $0 }.joined(separator: " ").trimmingCharacters(in: .whitespaces) }
                .filter { !$0.isEmpty }
            let namen = verknuepft.isEmpty ? (zeile?.passengers ?? []) : verknuepft
            var gesehen = Set<String>()
            gaeste = namen.map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty && gesehen.insert($0).inserted }

            // Merkmale in der Reihenfolge der Web-App: Rollstuhl, VIP, Kind, Gepaeck.
            let vip = (zeile?.is_vip ?? false) || gastZeilen.contains { $0.is_vip == true }
            let kind = (zeile?.needs_child_seat ?? false) || (zeile?.needs_second_child_seat ?? false)
                || gastZeilen.contains { $0.needs_child_seat == true || $0.needs_second_child_seat == true }
            let rollstuhl = (zeile?.needs_accessibility ?? false) || gastZeilen.contains { $0.needs_accessibility == true }
            let gepaeck = (zeile?.needs_luggage ?? false) || gastZeilen.contains { $0.needs_luggage == true }
            merkmale = [rollstuhl ? "accessibility" : nil, vip ? "vip" : nil, kind ? "child" : nil, gepaeck ? "luggage" : nil].compactMap { $0 }

            fahrzeitMin = zeile?.ext_route_duration_in_traffic_mins ?? zeile?.ext_route_duration_mins ?? 0
            tomtomFahrt = Self.polylineLesen(zeile?.ext_route_polyline)
            tomtomAnfahrt = Self.polylineLesen(zeile?.ext_driver_to_pickup_polyline)
            let rest = zeile?.ext_driver_to_dropoff_duration_in_traffic_mins ?? zeile?.ext_driver_to_dropoff_duration_mins
            if let rest, let sync = zeile?.ext_driver_to_dropoff_last_sync_at.flatMap(Datum.ausISO),
               Date().timeIntervalSince(sync) < 600 {
                restZielMin = rest
                restZielSync = sync
            } else {
                restZielMin = nil
                restZielSync = nil
            }

            notizen = notizZeilen.compactMap { n in
                let text = (n.note_text ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
                guard !text.isEmpty else { return nil }
                let datum = n.created_at.flatMap(Datum.ausISO)
                return Notiz(zeit: datum.map { Datum.uhrzeit($0) } ?? "",
                             datum: datum.map { Datum.datumKurz($0) } ?? "",
                             text: text,
                             autor: (n.author_name ?? "").trimmingCharacters(in: .whitespaces))
            }

            flugLesen(zeile?.flug_text, herkunft: zeile?.flight_origin)
            await kolonneLaden(passagiere: gaeste)
            fahrerNummer = nummer.map(String.init) ?? ""
            // Web nimmt fuer das Auto den OBD-Standort (Teltonika), wenn vorhanden.
            let obd = live.first { ($0.source ?? "").range(of: "teltonika|fmb|obd|telematik|telematics|tracker", options: [.regularExpression, .caseInsensitive]) != nil }
            if let p = obd ?? live.first, let lat = p.lat, let lng = p.lng {
                standortDB = CLLocationCoordinate2D(latitude: lat, longitude: lng)
            }
            fehler = nil
        } catch {
            fehler = error.localizedDescription
        }
    }

    private struct Zuordnung: Decodable {
        let driver_id: UUID
        let guest_ids: [UUID]?
        let guest_names: [String]?
        let response_status: String?
    }
    private struct Kollege: Decodable {
        let id: UUID; let first_name: String?; let last_name: String?; let phone: String?
        let avatar_url: String?; let vehicle_id: UUID?; let driver_number: Int?
    }
    private struct Wagen: Decodable { let id: UUID; let brand_model: String?; let license_plate: String? }
    private struct KollegenOrt: Decodable { let driver_id: UUID; let lat: Double?; let lng: Double? }
    private struct GastName: Decodable { let id: UUID; let first_name: String?; let last_name: String? }
    private struct KolonnenKopf: Decodable { let convoy_id: UUID? }
    private struct Kolonne: Decodable { let name: String? }

    /// Zuordnungen der Kolonne mit Namen, Fahrzeug, Telefon und Standort der Kollegen.
    /// Gaeste: die Gaeste aller Fahrer der Kolonne, dazu die Fahrgaeste der Fahrt.
    private func kolonneLaden(passagiere: [String]) async {
        guard let zuordnungen: [Zuordnung] = try? await Backend.client.from("convoy_assignments")
            .select("driver_id,guest_ids,guest_names,response_status").eq("job_id", value: fahrtID).execute().value,
            !zuordnungen.isEmpty else {
            kolonnenFahrer = []
            return
        }
        let ids = zuordnungen.map(\.driver_id.uuidString)
        async let kollegenAbfrage: [Kollege] = Backend.client.from("profiles")
            .select("id,first_name,last_name,phone,avatar_url,vehicle_id,driver_number").in("id", values: ids).execute().value
        async let orteAbfrage: [KollegenOrt] = Backend.client.from("driver_live_locations")
            .select("driver_id,lat,lng").in("driver_id", values: ids).execute().value
        async let kopfAbfrage: [KolonnenKopf] = Backend.client.from("jobs").select("convoy_id").eq("id", value: fahrtID).limit(1).execute().value
        let kollegen = (try? await kollegenAbfrage) ?? []
        let orte = (try? await orteAbfrage) ?? []
        if let convoy = (try? await kopfAbfrage)?.first?.convoy_id,
           let k: [Kolonne] = try? await Backend.client.from("convoys").select("name").eq("id", value: convoy).limit(1).execute().value {
            kolonnenName = (k.first?.name ?? "").trimmingCharacters(in: .whitespaces)
        }
        let wagenIDs = kollegen.compactMap(\.vehicle_id).map(\.uuidString)
        let wagen: [Wagen] = wagenIDs.isEmpty ? [] : ((try? await Backend.client.from("vehicles")
            .select("id,brand_model,license_plate").in("id", values: wagenIDs).execute().value) ?? [])
        let gastIDs = Array(Set(zuordnungen.flatMap { $0.guest_ids ?? [] })).map(\.uuidString)
        let gastZeilen: [GastName] = gastIDs.isEmpty ? [] : ((try? await Backend.client.from("guests")
            .select("id,first_name,last_name").in("id", values: gastIDs).execute().value) ?? [])
        func name(_ vor: String?, _ nach: String?) -> String {
            [vor, nach].compactMap { $0 }.joined(separator: " ").trimmingCharacters(in: .whitespaces)
        }
        let gastName = Dictionary(uniqueKeysWithValues: gastZeilen.map { ($0.id, name($0.first_name, $0.last_name)) })
        let profil = Dictionary(uniqueKeysWithValues: kollegen.map { ($0.id, $0) })
        let wagenNach = Dictionary(uniqueKeysWithValues: wagen.map { ($0.id, $0) })
        let ortNach = Dictionary(orte.compactMap { o -> (UUID, CLLocationCoordinate2D)? in
            guard let lat = o.lat, let lng = o.lng else { return nil }
            return (o.driver_id, CLLocationCoordinate2D(latitude: lat, longitude: lng))
        }, uniquingKeysWith: { a, _ in a })

        kolonnenFahrer = zuordnungen.map { z in
            let p = profil[z.driver_id]
            let w = p?.vehicle_id.flatMap { wagenNach[$0] }
            let gaeste = (z.guest_ids ?? []).compactMap { gastName[$0] }.filter { !$0.isEmpty } + (z.guest_names ?? []).filter { !$0.isEmpty }
            return KolonnenFahrer(
                id: z.driver_id,
                name: p.map { name($0.first_name, $0.last_name) } ?? "Fahrer",
                telefon: p?.phone ?? "",
                kennzeichen: w?.license_plate ?? "",
                fahrzeug: w?.brand_model ?? "",
                bild: p?.avatar_url ?? "",
                nummer: p?.driver_number.map(String.init) ?? "",
                antwort: z.response_status ?? "pending",
                gaeste: gaeste,
                standort: z.driver_id == fahrerID ? nil : ortNach[z.driver_id]
            )
        }
        // Gaesteliste wie im Web: alle Gaeste der Kolonne zuerst, dann die Fahrgaeste.
        var gesehen = Set<String>()
        gaeste = (kolonnenFahrer.flatMap(\.gaeste) + passagiere).filter { gesehen.insert($0).inserted }
    }

    /// hasKolonneColleagues: mindestens ein anderer Fahrer, der nicht abgelehnt hat.
    var hatKollegen: Bool {
        kolonnenFahrer.contains { $0.id != fahrerID && $0.antwort.lowercased() != "refused" }
    }

    /// Live-Position nur, wenn hoechstens 2 min alt (OPENSKY_MAX_LIVE_AGE_MS).
    private func flugLesen(_ text: String?, herkunft: String?) {
        let wurzel = text.flatMap { try? JSONSerialization.jsonObject(with: Data($0.utf8)) } as? [String: Any] ?? [:]
        let zusammenfassung = wurzel["summary"] as? [String: Any] ?? [:]
        let roh = ((((wurzel["raw"] as? [String: Any])?["FlightStatusResource"] as? [String: Any])?["Flights"] as? [String: Any])?["Flight"])
        let ersterFlug = (roh as? [[String: Any]])?.first ?? (roh as? [String: Any]) ?? [:]
        let code = (zusammenfassung["flight_status_code"] as? String)
            ?? ((ersterFlug["FlightStatus"] as? [String: Any])?["Code"] as? String) ?? ""
        flugStatusCode = code.trimmingCharacters(in: .whitespaces).uppercased()
        let abflug = (zusammenfassung["departure_airport"] as? String)
            ?? ((ersterFlug["Departure"] as? [String: Any])?["AirportCode"] as? String) ?? ""
        flugHerkunft = (herkunft?.isEmpty == false ? herkunft! : abflug).trimmingCharacters(in: .whitespaces)

        flugPosition = nil
        flugSpur = []
        guard let live = wurzel["live_tracking"] as? [String: Any] else { return }
        func zahl(_ w: Any?) -> Double? { (w as? Double) ?? (w as? Int).map(Double.init) ?? (w as? String).flatMap(Double.init) }
        if let erfasst = (live["captured_at"] as? String).flatMap(Datum.ausISO), Date().timeIntervalSince(erfasst) > 120 { return }
        if let lat = zahl(live["latitude"] ?? live["lat"]), let lng = zahl(live["longitude"] ?? live["lng"] ?? live["lon"]),
           abs(lat) <= 90, abs(lng) <= 180, abs(lat) + abs(lng) > 0.0002 {
            flugPosition = CLLocationCoordinate2D(latitude: lat, longitude: lng)
        }
        flugKurs = zahl(live["heading_deg"] ?? live["true_track_deg"]) ?? 0
        let punkte = (live["trail_points"] as? [Any] ?? []).compactMap { p -> CLLocationCoordinate2D? in
            if let a = p as? [Any], a.count >= 3, let lat = zahl(a[1]), let lng = zahl(a[2]) {
                return CLLocationCoordinate2D(latitude: lat, longitude: lng)
            }
            if let o = p as? [String: Any], let lat = zahl(o["latitude"] ?? o["lat"]), let lng = zahl(o["longitude"] ?? o["lng"] ?? o["lon"]) {
                return CLLocationCoordinate2D(latitude: lat, longitude: lng)
            }
            return nil
        }
        // normalizeFlightTrailPath: doppelte Punkte raus, hoechstens die letzten 90.
        var spur: [CLLocationCoordinate2D] = []
        for p in punkte where spur.last.map({ abs($0.latitude - p.latitude) >= 0.00001 || abs($0.longitude - p.longitude) >= 0.00001 }) ?? true {
            spur.append(p)
        }
        flugSpur = punkte.count > 1 ? Array(spur.suffix(90)) : []
    }

    // MARK: Aktionen (handleEndRideFromDetails / handleSendRideNoteFromDetails)

    func notizSenden(_ text: String, autor: String) async -> Bool {
        let t = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !t.isEmpty else { return false }
        struct Neu: Encodable { let job_id: UUID; let note_text: String; let author_name: String }
        do {
            try await Backend.client.from("job_notes").insert(Neu(job_id: fahrtID, note_text: t, author_name: autor)).execute()
            notizen.insert(Notiz(zeit: Datum.uhrzeit(Date()), datum: Datum.datumKurz(Date()), text: t, autor: autor), at: 0)
            return true
        } catch {
            fehler = "Notiz konnte nicht gespeichert werden: \(error.localizedDescription)"
            return false
        }
    }

    func beenden(notiz: String, autor: String) async -> Bool {
        struct Status: Encodable { let status: String }
        struct IDZeile: Decodable { let id: UUID }
        do {
            let eigene: [IDZeile] = try await Backend.client.from("jobs").update(Status(status: "done"))
                .eq("id", value: fahrtID).eq("driver_id", value: fahrerID).select("id").execute().value
            if eigene.isEmpty {
                // Kolonne: Fahrt gehoert nicht direkt dem Fahrer, Zuordnung pruefen.
                struct Zuordnung: Decodable { let response_status: String? }
                let z: [Zuordnung] = try await Backend.client.from("convoy_assignments").select("response_status")
                    .eq("job_id", value: fahrtID).eq("driver_id", value: fahrerID).limit(1).execute().value
                guard let erste = z.first, (erste.response_status ?? "").lowercased() != "refused" else {
                    throw TrisarFehler.text("Du bist dieser Fahrt nicht zugeordnet.")
                }
                let k: [IDZeile] = try await Backend.client.from("jobs").update(Status(status: "done"))
                    .eq("id", value: fahrtID).select("id").execute().value
                if k.isEmpty { throw TrisarFehler.text("Fahrt konnte nicht beendet werden.") }
            }
            if !notiz.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                _ = await notizSenden(notiz, autor: autor)
            }
            return true
        } catch {
            fehler = "Fahrt beenden fehlgeschlagen: \(error.localizedDescription)"
            return false
        }
    }
}

extension Datum {
    static func ausISO(_ text: String) -> Date? {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let d = f.date(from: text) { return d }
        f.formatOptions = [.withInternetDateTime]
        if let d = f.date(from: text) { return d }
        // Postgres: "2026-11-04 15:44:47.304+00"
        let p = DateFormatter()
        p.locale = Locale(identifier: "en_US_POSIX")
        for format in ["yyyy-MM-dd HH:mm:ss.SSSSSSx", "yyyy-MM-dd HH:mm:ss.SSSx", "yyyy-MM-dd HH:mm:ssx", "yyyy-MM-dd'T'HH:mm:ss.SSSSSSxxx"] {
            p.dateFormat = format
            if let d = p.date(from: text) { return d }
        }
        return nil
    }

    static func uhrzeit(_ d: Date) -> String {
        let f = DateFormatter(); f.locale = Locale(identifier: "de_DE"); f.dateFormat = "HH:mm"
        return f.string(from: d)
    }

    /// toLocaleDateString('de-DE'): 4.11.2026
    static func datumKurz(_ d: Date) -> String {
        let f = DateFormatter(); f.locale = Locale(identifier: "de_DE"); f.dateFormat = "d.M.yyyy"
        return f.string(from: d)
    }
}

extension FahrtDetails {
    /// Google-Polyline (Genauigkeit 1e5) in Punkte, wie decodeGooglePolyline im Web.
    static func polylineLesen(_ text: String?) -> [CLLocationCoordinate2D] {
        guard let text, !text.isEmpty else { return [] }
        let bytes = Array(text.utf8)
        var i = 0, lat = 0, lng = 0
        var punkte: [CLLocationCoordinate2D] = []
        func zahl() -> Int? {
            var ergebnis = 0, verschiebung = 0
            while i < bytes.count {
                let b = Int(bytes[i]) - 63
                i += 1
                ergebnis |= (b & 0x1f) << verschiebung
                verschiebung += 5
                if b < 0x20 { return (ergebnis & 1) != 0 ? ~(ergebnis >> 1) : (ergebnis >> 1) }
            }
            return nil
        }
        while i < bytes.count {
            guard let dLat = zahl(), let dLng = zahl() else { break }
            lat += dLat; lng += dLng
            punkte.append(CLLocationCoordinate2D(latitude: Double(lat) / 1e5, longitude: Double(lng) / 1e5))
        }
        return punkte
    }
}
