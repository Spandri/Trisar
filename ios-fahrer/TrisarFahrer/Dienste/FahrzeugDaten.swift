import CoreLocation
import Foundation
import Supabase
import UIKit

/// Daten der Fahrzeug-Seite (VehicleView.jsx): Ausstattung (trim), letzter OBD-Standort,
/// Fahrzeugdaten aus dem Tracker (fahrzeugTelemetrie.js) und Schadensbericht.
@MainActor
final class FahrzeugDaten: ObservableObject {
    struct Schaden: Identifiable, Equatable {
        let id: UUID
        let datum: String        // 12.09.26
        let stelle: String
        let beschreibung: String
        let bilder: [String]
    }

    struct TelemetrieZeile: Identifiable, Equatable {
        let id: String
        let titel: String
        let wert: String
        let warnung: Bool
    }

    struct Ereignis: Identifiable, Equatable {
        let id: String
        let zeit: String
        let text: String
    }

    @Published private(set) var ausstattung = ""
    @Published private(set) var standort: CLLocationCoordinate2D?
    @Published private(set) var schaeden: [Schaden] = []
    @Published private(set) var telemetrie: [TelemetrieZeile] = []
    @Published private(set) var ereignisse: [Ereignis] = []
    @Published private(set) var telemetrieStand = ""
    @Published var fehler: String?

    private let fahrerID: UUID
    private var fahrzeugID: UUID?
    private var kanal: RealtimeChannelV2?
    private var beobachter: [Task<Void, Never>] = []
    private var takt: Timer?

    private static let standortSchluessel = "trisar_fahrzeug_letzter_standort"

    init(fahrerID: UUID) {
        self.fahrerID = fahrerID
        // Letzten bekannten Standort sofort zeigen, die Karte muss nicht auf die Datenbank warten.
        if let w = UserDefaults.standard.array(forKey: Self.standortSchluessel) as? [Double], w.count == 2 {
            standort = CLLocationCoordinate2D(latitude: w[0], longitude: w[1])
        }
    }

    func starten(fahrzeugID: UUID?) async {
        self.fahrzeugID = fahrzeugID
        await laden()
        // Wie im Web: Telemetrie per Realtime, Rueckfall alle 30 s.
        let kanal = Backend.client.channel("fahrzeug-telemetrie-\(fahrerID.uuidString)")
        let id = fahrerID.uuidString
        let stroeme = [
            kanal.postgresChange(AnyAction.self, schema: "public", table: "vehicle_telemetry_live", filter: .eq("driver_id", value: id)),
            kanal.postgresChange(AnyAction.self, schema: "public", table: "vehicle_telemetry_events", filter: .eq("driver_id", value: id)),
        ]
        self.kanal = kanal
        beobachter = stroeme.map { strom in
            Task { [weak self] in for await _ in strom { await self?.telemetrieLaden() } }
        }
        try? await kanal.subscribeWithError()
        takt = Timer.scheduledTimer(withTimeInterval: 30, repeats: true) { [weak self] _ in
            Task { @MainActor in await self?.telemetrieLaden() }
        }
    }

    func beenden() async {
        takt?.invalidate()
        beobachter.forEach { $0.cancel() }
        if let kanal { await Backend.client.removeChannel(kanal) }
        kanal = nil
    }

    func laden() async {
        async let a: Void = ausstattungLaden()
        async let b: Void = standortLaden()
        async let c: Void = schaedenLaden()
        async let d: Void = telemetrieLaden()
        _ = await (a, b, c, d)
    }

    // MARK: Ausstattung und Standort

    private func ausstattungLaden() async {
        struct Zeile: Decodable { let trim: String? }
        guard let id = fahrzeugID,
              let z: [Zeile] = try? await Backend.client.from("vehicles").select("trim").eq("id", value: id).limit(1).execute().value
        else { ausstattung = ""; return }
        ausstattung = z.first?.trim ?? ""
    }

    /// Web: letzter OBD-Standort des Fahrers (Quelle Teltonika/Tracker), ohne den keine Karte.
    private func standortLaden() async {
        struct Zeile: Decodable { let lat: Double?; let lng: Double?; let source: String? }
        guard let zeilen: [Zeile] = try? await Backend.client.from("driver_live_locations")
            .select("lat,lng,source").eq("driver_id", value: fahrerID).limit(5).execute().value else { return }
        // OBD-Standort bevorzugt, sonst der Handy-Standort: Bei Ortungsart "Handy-App"
        // ueberschreibt das Handy den Eintrag, dann gab es vorher gar keine Karte.
        let obd = zeilen.first {
            ($0.source ?? "").range(of: "teltonika|fmb\\d*|obd|telematik|telematics|tracker", options: [.regularExpression, .caseInsensitive]) != nil
        }
        if let z = obd ?? zeilen.first, let lat = z.lat, let lng = z.lng {
            let neu = CLLocationCoordinate2D(latitude: lat, longitude: lng)
            standort = neu
            UserDefaults.standard.set([lat, lng], forKey: Self.standortSchluessel)
        }
    }

    // MARK: Schaeden

    private struct SchadenZeile: Decodable {
        let id: UUID
        let report_date: String?
        let part_name: String?
        let description: String?
        let image_url: String?
        let image_urls: [String]?
    }

    func schaedenLaden() async {
        guard let id = fahrzeugID else { schaeden = []; return }
        guard let zeilen: [SchadenZeile] = try? await Backend.client.from("vehicle_damages")
            .select("id,report_date,part_name,description,image_url,image_urls")
            .eq("vehicle_id", value: id).order("report_date", ascending: false).execute().value else { return }
        schaeden = zeilen.map { z in
            let bilder = (z.image_urls?.isEmpty == false ? z.image_urls! : [z.image_url].compactMap { $0 })
                .filter { !$0.isEmpty && !$0.hasPrefix("blob:") }
            return Schaden(id: z.id, datum: Self.datumKurz(z.report_date ?? ""), stelle: z.part_name ?? "",
                           beschreibung: z.description ?? "", bilder: bilder)
        }
    }

    /// 2026-09-12 -> 12.09.26
    static func datumKurz(_ wert: String) -> String {
        let t = wert.prefix(10).split(separator: "-")
        guard t.count == 3 else { return wert }
        return "\(t[2]).\(t[1]).\(t[0].suffix(2))"
    }

    /// addVehicleDamage der Web-App. Fotos: Es gibt (noch) keinen Storage-Bucket, darum
    /// verkleinert als data-URL in image_urls (die Web-App zeigt sie so direkt an).
    func melden(stelle: String, beschreibung: String, fotos: [UIImage]) async -> Bool {
        guard let id = fahrzeugID else { fehler = "Kein Fahrzeug zugeteilt."; return false }
        let heute = Datum.tagWert(Date())
        let heuteKurz = Self.datumKurz(heute)
        // Gleiche Meldung nicht doppelt eintragen.
        if schaeden.contains(where: { $0.datum == heuteKurz && $0.stelle == stelle && $0.beschreibung == beschreibung }) { return true }
        let bilder = fotos.prefix(3).compactMap(Self.alsDatenURL)
        struct Neu: Encodable {
            let vehicle_id: UUID; let report_date: String; let part_name: String; let description: String
            let image_url: String?; let image_urls: [String]; let reported_by_driver: Bool
        }
        do {
            try await Backend.client.from("vehicle_damages").insert(Neu(
                vehicle_id: id, report_date: heute, part_name: stelle, description: beschreibung,
                image_url: bilder.first, image_urls: bilder, reported_by_driver: true)).execute()
            await schaedenLaden()
            return true
        } catch {
            fehler = "Schaden konnte nicht gemeldet werden: \(error.localizedDescription)"
            return false
        }
    }

    /// Lange Kante 900 pt, JPEG 0,6 -> grob 60-120 KB je Foto.
    static func alsDatenURL(_ bild: UIImage) -> String? {
        let maxKante: CGFloat = 900
        let s = min(1, maxKante / max(bild.size.width, bild.size.height))
        let groesse = CGSize(width: bild.size.width * s, height: bild.size.height * s)
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        let klein = UIGraphicsImageRenderer(size: groesse, format: format).image { _ in bild.draw(in: CGRect(origin: .zero, size: groesse)) }
        guard let daten = klein.jpegData(compressionQuality: 0.6) else { return nil }
        return "data:image/jpeg;base64," + daten.base64EncodedString()
    }

    // MARK: Telemetrie (telemetrieZeilen)

    private static let ereignisTexte: [String: String] = [
        "ignition_on": "Zündung an", "ignition_off": "Zündung aus", "trip_start": "Fahrt begonnen", "trip_end": "Fahrt beendet",
        "idling_start": "Leerlauf begonnen", "idling_end": "Leerlauf beendet", "unplugged": "Tracker abgesteckt",
        "plugged_in": "Tracker eingesteckt", "harsh_acceleration": "Starkes Beschleunigen", "harsh_braking": "Starkes Bremsen",
        "harsh_cornering": "Scharfe Kurve", "overspeeding": "Zu schnell", "crash": "Aufprall erkannt",
        "towing": "Abschleppen erkannt", "jamming": "Störsender erkannt", "alarm": "Alarm",
    ]

    func telemetrieLaden() async {
        let live = try? await Backend.client.from("vehicle_telemetry_live").select().eq("driver_id", value: fahrerID).limit(1).execute().data
        let zeile = (live.flatMap { try? JSONSerialization.jsonObject(with: $0) } as? [[String: Any]])?.first
        telemetrie = Self.zeilen(zeile)
        telemetrieStand = (zeile?["captured_at"] as? String).flatMap(Datum.ausISO).map(Datum.uhrzeit) ?? ""

        let ev = try? await Backend.client.from("vehicle_telemetry_events").select("id,event_type,value,captured_at")
            .eq("driver_id", value: fahrerID).order("captured_at", ascending: false).limit(3).execute().data
        let evZeilen = (ev.flatMap { try? JSONSerialization.jsonObject(with: $0) } as? [[String: Any]]) ?? []
        ereignisse = evZeilen.map { e in
            Ereignis(id: "\(e["id"] ?? UUID().uuidString)",
                     zeit: (e["captured_at"] as? String).flatMap(Datum.ausISO).map(Datum.uhrzeit) ?? "",
                     text: Self.ereignisTexte[e["event_type"] as? String ?? ""] ?? "Ereignis")
        }
    }

    private static func zahl(_ w: Any?) -> Double? {
        if let d = w as? Double { return d }
        if let i = w as? Int { return Double(i) }
        if let s = w as? String, !s.isEmpty { return Double(s) }
        return nil
    }

    private static func dezimal(_ d: Double) -> String {
        let f = NumberFormatter(); f.locale = Locale(identifier: "de_DE")
        f.minimumFractionDigits = 1; f.maximumFractionDigits = 1
        return f.string(from: NSNumber(value: d)) ?? "\(d)"
    }

    private static func ganz(_ d: Double) -> String {
        let f = NumberFormatter(); f.locale = Locale(identifier: "de_DE"); f.numberStyle = .decimal; f.maximumFractionDigits = 0
        return f.string(from: NSNumber(value: d.rounded())) ?? "\(Int(d))"
    }

    static func zeilen(_ live: [String: Any]?) -> [TelemetrieZeile] {
        guard let live else { return [] }
        var z: [TelemetrieZeile] = []
        if let an = live["ignition"] as? Bool { z.append(.init(id: "ignition", titel: "Zündung", wert: an ? "An" : "Aus", warnung: false)) }
        if let v = zahl(live["rpm"]) { z.append(.init(id: "rpm", titel: "Drehzahl", wert: "\(Int(v.rounded()))", warnung: false)) }
        if let v = zahl(live["obd_speed_kph"]) { z.append(.init(id: "speed", titel: "Tempo (OBD)", wert: "\(Int(v.rounded())) km/h", warnung: false)) }
        let tank = zahl(live["fuel_level_pct"])
        if let v = tank { z.append(.init(id: "fuel", titel: "Tank", wert: "\(Int(v.rounded())) %", warnung: v < 15)) }
        if tank == nil, let v = zahl(live["oem_fuel_l"]) { z.append(.init(id: "fuel", titel: "Tank", wert: "\(dezimal(v)) l", warnung: false)) }
        if let v = zahl(live["oem_remaining_distance_km"]) { z.append(.init(id: "range", titel: "Reichweite", wert: "\(ganz(v)) km", warnung: v < 50)) }
        if let v = zahl(live["coolant_c"]) { z.append(.init(id: "coolant", titel: "Kühlmittel", wert: "\(Int(v.rounded())) °C", warnung: v > 110)) }
        if let v = zahl(live["ext_voltage_v"]) { z.append(.init(id: "voltage", titel: "Bordspannung", wert: "\(dezimal(v)) V", warnung: v > 0 && v < 11.8)) }
        if let v = zahl(live["oem_mileage_km"]) ?? zahl(live["total_odometer_km"]) { z.append(.init(id: "odometer", titel: "Kilometerstand", wert: "\(ganz(v)) km", warnung: false)) }
        if let v = zahl(live["dtc_count"]) { z.append(.init(id: "dtc", titel: "Fehlercodes", wert: "\(Int(v))", warnung: v > 0)) }
        if let v = zahl(live["engine_load_pct"]) { z.append(.init(id: "load", titel: "Motorlast", wert: "\(Int(v.rounded())) %", warnung: false)) }
        if let v = zahl(live["gsm_signal"]) { z.append(.init(id: "gsm", titel: "Mobilfunk", wert: "\(Int(v))/5", warnung: false)) }
        return z
    }
}
