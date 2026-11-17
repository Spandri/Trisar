// Eigener Standort der Dispo (17.11.2026), Spiegel von admin/src/shared/eigenerStandort.js.
// Laufend vom Geraet geholt, solange jemand zuschaut ("Ankuenfte bei mir" mit Ort automatisch)
// und die App im Vordergrund ist. Bleibt im Geraet. Die Dispo-Karte zeigt den blauen Punkt
// ueber MapLibre selbst (showsUserLocation in DispoKarte.swift).
import CoreLocation
import Foundation
import UIKit

@MainActor
final class EigenerStandort: NSObject, ObservableObject {
    static let geteilt = EigenerStandort()

    /// Letzte Position, nil solange keine kam oder ohne Erlaubnis.
    @Published private(set) var position: CLLocation?

    private let manager = CLLocationManager()
    /// Wer gerade zuschaut (z. B. "ankunft"). Ohne Zuschauer laeuft nichts.
    private var zuschauer: Set<String> = []
    /// Einmal-Abfragen (standortHolen), je mit eigener Zeitgrenze.
    private var wartende: [UUID: CheckedContinuation<CLLocation?, Never>] = [:]
    private var vordergrund = true
    private var laeuft = false

    private override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyBest
        manager.distanceFilter = 10
        vordergrund = UIApplication.shared.applicationState != .background
        let mitte = NotificationCenter.default
        mitte.addObserver(forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.vordergrund = false; self?.pruefen() }
        }
        mitte.addObserver(forName: UIApplication.willEnterForegroundNotification, object: nil, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.vordergrund = true; self?.pruefen() }
        }
    }

    /// Ohne Begruendung im Info.plist fragt iOS gar nicht erst.
    private var moeglich: Bool {
        Bundle.main.object(forInfoDictionaryKey: "NSLocationWhenInUseUsageDescription") != nil
    }

    func abonnieren(_ wer: String) {
        zuschauer.insert(wer)
        pruefen()
    }

    func abbestellen(_ wer: String) {
        zuschauer.remove(wer)
        pruefen()
    }

    /// Einmal holen (wie navigator.geolocation.getCurrentPosition mit timeout 15 s, maximumAge 60 s).
    func einmal() async -> CLLocation? {
        guard moeglich else { return nil }
        if let p = position ?? manager.location, -p.timestamp.timeIntervalSinceNow < 60 { return p }
        let id = UUID()
        return await withCheckedContinuation { k in
            wartende[id] = k
            Task { [weak self] in
                try? await Task.sleep(for: .seconds(15))
                self?.antworten(id, nil)
            }
            pruefen()
        }
    }

    private func antworten(_ id: UUID, _ ort: CLLocation?) {
        guard let k = wartende.removeValue(forKey: id) else { return }
        k.resume(returning: ort)
        pruefen()
    }

    private func alleAntworten(_ ort: CLLocation?) {
        let liste = wartende
        wartende = [:]
        liste.values.forEach { $0.resume(returning: ort) }
    }

    /// Updates nur mit Zuschauer oder offener Abfrage und nur im Vordergrund.
    private func pruefen() {
        let soll = moeglich && vordergrund && (!zuschauer.isEmpty || !wartende.isEmpty)
        guard soll else {
            if laeuft { manager.stopUpdatingLocation(); laeuft = false }
            // Im Hintergrund kommt keine Position mehr: offene Abfragen beenden.
            if !wartende.isEmpty && !vordergrund { alleAntworten(nil) }
            return
        }
        switch manager.authorizationStatus {
        case .notDetermined:
            manager.requestWhenInUseAuthorization()
        case .authorizedWhenInUse, .authorizedAlways:
            if !laeuft { manager.startUpdatingLocation(); laeuft = true }
        default:
            // Ohne Erlaubnis bleibt der Punkt weg.
            if laeuft { manager.stopUpdatingLocation(); laeuft = false }
            alleAntworten(nil)
        }
    }

    fileprivate func neu(_ ort: CLLocation) {
        position = ort
        alleAntworten(ort)
        if zuschauer.isEmpty { pruefen() }
    }

    fileprivate func fehlgeschlagen(_ fehler: Error) {
        // Unbekannte Position ist voruebergehend, nur eine Absage beendet die Abfragen.
        if (fehler as? CLError)?.code == .denied {
            if laeuft { manager.stopUpdatingLocation(); laeuft = false }
            alleAntworten(nil)
        }
    }
}

extension EigenerStandort: CLLocationManagerDelegate {
    nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        Task { @MainActor in self.pruefen() }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let ort = locations.last else { return }
        Task { @MainActor in self.neu(ort) }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        Task { @MainActor in self.fehlgeschlagen(error) }
    }
}
