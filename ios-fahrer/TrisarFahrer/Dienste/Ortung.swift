import CoreLocation
import Foundation
import Supabase
import UIKit

/// Native Ortung. Laeuft auch im Hintergrund weiter (Google Maps vorne, Bildschirm aus),
/// solange der Fahrer die App nicht aus der App-Uebersicht wegwischt.
/// Schreibt direkt in `driver_live_locations` (alle 5 s) und `driver_location_history` (alle 15 s).
/// Bei Ortungsart 'obd' schreibt das Handy nichts, der Tracker im Auto liefert den Standort.
@MainActor
final class Ortung: NSObject, ObservableObject {
    enum Berechtigung: Equatable {
        case unbekannt, verweigert, nurBeimVerwenden, immer
    }

    @Published private(set) var berechtigung: Berechtigung = .unbekannt
    @Published private(set) var letztePosition: CLLocation?
    @Published private(set) var letzteSendung: Date?
    @Published private(set) var gesendet = 0
    @Published private(set) var wartend = 0
    @Published private(set) var letzterFehler: String?
    @Published private(set) var nutztOBD = false
    /// Erst nach dem Profil wissen wir, ob das Handy orten soll (sonst OBD).
    private var profilGeladen = false
    @Published private(set) var laeuft = false

    /// Fahrer kann die Ortung pausieren (z.B. Feierabend). Bleibt ueber App-Neustarts erhalten.
    @Published var eingeschaltet: Bool {
        didSet {
            UserDefaults.standard.set(eingeschaltet, forKey: Self.schalterSchluessel)
            aktualisieren()
        }
    }

    private static let schalterSchluessel = "ortungEingeschaltet"
    private let manager = CLLocationManager()
    private var fahrerID: UUID?
    private var aktiveFahrtID: UUID?
    private var letzteLiveSendung = Date.distantPast
    private var letzterVerlaufPunkt = Date.distantPast
    private var sendetGerade = false
    private var naechsteLivePosition: CLLocation?
    /// Verlaufspunkte, die noch nicht angekommen sind (Funkloch, Tiefgarage). Werden nachgeschickt.
    private var verlaufPuffer: [VerlaufZeile] = []
    private var profilTimer: Timer?

    override init() {
        eingeschaltet = UserDefaults.standard.object(forKey: Self.schalterSchluessel) as? Bool ?? true
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyBest
        manager.distanceFilter = 10
        manager.activityType = .automotiveNavigation
        manager.pausesLocationUpdatesAutomatically = false
        berechtigungUebernehmen(manager.authorizationStatus)
    }

    /// Nach Anmeldung bzw. Abmeldung aufrufen.
    func setzeFahrer(_ id: UUID?) {
        guard id != fahrerID else { return }
        fahrerID = id
        aktiveFahrtID = nil
        verlaufPuffer.removeAll()
        wartend = 0
        aktualisieren()
        Task { await profilUndFahrtLaden() }
    }

    func berechtigungAnfragen() {
        switch manager.authorizationStatus {
        case .notDetermined:
            manager.requestWhenInUseAuthorization()
        case .authorizedWhenInUse:
            // Zweiter Schritt: iOS fragt nach „Immer“. Klappt nur einmal, danach nur ueber Einstellungen.
            manager.requestAlwaysAuthorization()
        default:
            einstellungenOeffnen()
        }
    }

    func einstellungenOeffnen() {
        if let url = URL(string: UIApplication.openSettingsURLString) {
            UIApplication.shared.open(url)
        }
    }

    /// Beim Zurueckkommen in die App: Ortungsart und Fahrt sofort neu laden.
    func vordergrund() {
        Task { await profilUndFahrtLaden() }
        nachschicken()
    }

    // MARK: - Start/Stopp

    private func aktualisieren() {
        let soll = eingeschaltet && fahrerID != nil
            && (berechtigung == .immer || berechtigung == .nurBeimVerwenden)
        if soll && !laeuft {
            manager.allowsBackgroundLocationUpdates = true
            manager.showsBackgroundLocationIndicator = true
            manager.startUpdatingLocation()
            // Weckt die App nach Wegwischen oder Neustart bei groesserer Bewegung wieder auf (nur mit „Immer“).
            manager.startMonitoringSignificantLocationChanges()
            laeuft = true
            starteProfilTimer()
        } else if !soll && laeuft {
            manager.stopUpdatingLocation()
            manager.stopMonitoringSignificantLocationChanges()
            manager.allowsBackgroundLocationUpdates = false
            laeuft = false
            profilTimer?.invalidate()
            profilTimer = nil
        }
    }

    private func starteProfilTimer() {
        profilTimer?.invalidate()
        profilTimer = Timer.scheduledTimer(withTimeInterval: Konfig.profilIntervall, repeats: true) { [weak self] _ in
            Task { @MainActor in await self?.profilUndFahrtLaden() }
        }
    }

    private func berechtigungUebernehmen(_ status: CLAuthorizationStatus) {
        switch status {
        case .authorizedAlways: berechtigung = .immer
        case .authorizedWhenInUse: berechtigung = .nurBeimVerwenden
        case .denied, .restricted: berechtigung = .verweigert
        default: berechtigung = .unbekannt
        }
        aktualisieren()
        immerAnfragenFallsNoetig()
    }

    /// Zweiter Schritt direkt nach „Beim Verwenden“: iOS fragt nach „Immer erlauben“, damit der
    /// Standort auch im Hintergrund weiterlaeuft. iOS zeigt das nur einmal, danach nur ueber die
    /// Einstellungen. Bei OBD-Tracker braucht es das Handy nicht, dann wird nicht gefragt.
    private func immerAnfragenFallsNoetig() {
        let schluessel = "trisar_immer_gefragt"
        guard manager.authorizationStatus == .authorizedWhenInUse, fahrerID != nil, !nutztOBD,
              profilGeladen, !UserDefaults.standard.bool(forKey: schluessel) else { return }
        UserDefaults.standard.set(true, forKey: schluessel)
        manager.requestAlwaysAuthorization()
    }

    // MARK: - Profil und aktive Fahrt

    private func profilUndFahrtLaden() async {
        guard let id = fahrerID else { return }
        if let profile: [FahrerProfil] = try? await Backend.client
            .from("profiles")
            .select("id,first_name,last_name,tracking_mode")
            .eq("id", value: id)
            .limit(1)
            .execute()
            .value {
            nutztOBD = profile.first?.nutztOBD ?? false
            profilGeladen = true
            immerAnfragenFallsNoetig()
        }
        aktiveFahrtID = await Self.aktiveFahrt(fahrer: id)
    }

    /// Gleiche Wahl wie die Web-App: unterwegs vor beim Gast vor offen, dann frueheste Fahrt.
    private static func aktiveFahrt(fahrer: UUID) async -> UUID? {
        struct Fahrt: Decodable {
            let id: UUID
            let status: String?
            let rideDate: String?
            let etd: String?
            enum CodingKeys: String, CodingKey { case id, status, etd; case rideDate = "ride_date" }
        }
        let unterwegs: Set<String> = ["in_progress", "unterwegs", "started", "on_trip", "ongoing", "active"]
        let beimGast: Set<String> = ["at_pickup", "beim_pickup", "beim pickup"]
        let offen: Set<String> = ["pending", "assigned", "offen", "new", "requested", "offered", "zugewiesen"]
        let alle = Array(unterwegs.union(beimGast).union(offen))
        guard let fahrten: [Fahrt] = try? await Backend.client
            .from("jobs")
            .select("id,status,ride_date,etd")
            .eq("driver_id", value: fahrer)
            .in("status", values: alle)
            .execute()
            .value else { return nil }
        func rang(_ s: String?) -> Int {
            let s = (s ?? "").lowercased()
            if unterwegs.contains(s) { return 0 }
            if beimGast.contains(s) { return 1 }
            return 2
        }
        return fahrten.sorted {
            (rang($0.status), $0.rideDate ?? "", $0.etd ?? "") < (rang($1.status), $1.rideDate ?? "", $1.etd ?? "")
        }.first?.id
    }

    // MARK: - Senden

    private func neuePosition(_ ort: CLLocation) {
        letztePosition = ort
        guard fahrerID != nil, !nutztOBD else { return }
        // Grobe oder veraltete Punkte nicht senden (z.B. erster Punkt aus dem Funkzellen-Cache).
        guard ort.horizontalAccuracy >= 0, ort.horizontalAccuracy <= 100,
              abs(ort.timestamp.timeIntervalSinceNow) < 60 else { return }

        if ort.timestamp.timeIntervalSince(letzterVerlaufPunkt) >= Konfig.verlaufIntervall {
            letzterVerlaufPunkt = ort.timestamp
            verlaufPuffer.append(verlaufZeile(ort))
            if verlaufPuffer.count > 2000 { verlaufPuffer.removeFirst(verlaufPuffer.count - 2000) }
            wartend = verlaufPuffer.count
        }
        if Date().timeIntervalSince(letzteLiveSendung) >= Konfig.liveIntervall {
            naechsteLivePosition = ort
            nachschicken()
        }
    }

    private func nachschicken() {
        guard !sendetGerade, let fahrer = fahrerID, !nutztOBD else { return }
        let live = naechsteLivePosition
        let verlauf = Array(verlaufPuffer.prefix(200))
        guard live != nil || !verlauf.isEmpty else { return }
        sendetGerade = true
        naechsteLivePosition = nil

        // iOS etwas Zeit geben, die Anfrage auch im Hintergrund fertig zu machen.
        var hintergrund = UIBackgroundTaskIdentifier.invalid
        hintergrund = UIApplication.shared.beginBackgroundTask(withName: "standort") {
            UIApplication.shared.endBackgroundTask(hintergrund)
            hintergrund = .invalid
        }

        Task {
            var fehler: String?
            if let live {
                do {
                    try await Backend.client
                        .from("driver_live_locations")
                        .upsert(liveZeile(live, fahrer: fahrer), onConflict: "driver_id")
                        .execute()
                    letzteLiveSendung = Date()
                    letzteSendung = Date()
                    gesendet += 1
                } catch {
                    fehler = error.localizedDescription
                }
            }
            if !verlauf.isEmpty {
                do {
                    try await Backend.client.from("driver_location_history").insert(verlauf).execute()
                    verlaufPuffer.removeFirst(min(verlauf.count, verlaufPuffer.count))
                    wartend = verlaufPuffer.count
                } catch {
                    fehler = fehler ?? error.localizedDescription
                }
            }
            letzterFehler = fehler
            sendetGerade = false
            if hintergrund != .invalid { UIApplication.shared.endBackgroundTask(hintergrund) }
            // Was waehrend des Sendens dazukam, gleich hinterher.
            if fehler == nil, naechsteLivePosition != nil || verlaufPuffer.count > 0 && !verlauf.isEmpty {
                nachschicken()
            }
        }
    }

    private struct LiveZeile: Encodable {
        let driver_id: UUID
        let active_job_id: UUID?
        let lat: Double
        let lng: Double
        let accuracy_m: Double?
        let speed_mps: Double?
        let heading_deg: Double?
        let source: String
        let captured_at: String
    }

    private struct VerlaufZeile: Encodable {
        let driver_id: UUID
        let job_id: UUID?
        let lat: Double
        let lng: Double
        let accuracy_m: Double?
        let speed_mps: Double?
        let heading_deg: Double?
        let source: String
        let captured_at: String
    }

    private static let zeitFormat: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()

    private func liveZeile(_ ort: CLLocation, fahrer: UUID) -> LiveZeile {
        LiveZeile(
            driver_id: fahrer,
            active_job_id: aktiveFahrtID,
            lat: ort.coordinate.latitude,
            lng: ort.coordinate.longitude,
            accuracy_m: ort.horizontalAccuracy >= 0 ? ort.horizontalAccuracy : nil,
            speed_mps: ort.speed >= 0 ? ort.speed : nil,
            heading_deg: ort.course >= 0 ? ort.course : nil,
            source: Konfig.quelle,
            captured_at: Self.zeitFormat.string(from: ort.timestamp)
        )
    }

    private func verlaufZeile(_ ort: CLLocation) -> VerlaufZeile {
        VerlaufZeile(
            driver_id: fahrerID!,
            job_id: aktiveFahrtID,
            lat: ort.coordinate.latitude,
            lng: ort.coordinate.longitude,
            accuracy_m: ort.horizontalAccuracy >= 0 ? ort.horizontalAccuracy : nil,
            speed_mps: ort.speed >= 0 ? ort.speed : nil,
            heading_deg: ort.course >= 0 ? ort.course : nil,
            source: Konfig.quelle,
            captured_at: Self.zeitFormat.string(from: ort.timestamp)
        )
    }
}

extension Ortung: CLLocationManagerDelegate {
    nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        let status = manager.authorizationStatus
        Task { @MainActor in self.berechtigungUebernehmen(status) }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let ort = locations.last else { return }
        Task { @MainActor in self.neuePosition(ort) }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        let text = error.localizedDescription
        Task { @MainActor in self.letzterFehler = text }
    }
}
