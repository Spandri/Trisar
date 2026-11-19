import Combine
import CoreLocation
import Foundation
import Supabase

/// Standort fuer die CarPlay-Karte: immer das Handy (dort ist der Fahrer wirklich, User 19.11.).
/// Ortung laeuft dafuer waehrend CarPlay verbunden ist (Ortung.carPlayVerbunden), gesendet wird nur im Dienst.
/// Nur wenn das Handy keinen frischen Ort hat und der Fahrer auf OBD steht: Ort des Trackers aus
/// driver_live_locations (Realtime, Rueckfall alle 15 s).
@MainActor
final class CarPlayStandort {
    @Published private(set) var ort: CLLocation?

    private var abos: Set<AnyCancellable> = []
    private var kanal: RealtimeChannelV2?
    private var beobachter: Task<Void, Never>?
    private var takt: Timer?
    private var trackerFahrer: UUID?

    init() {
        Geteilt.ortung.$letztePosition
            .combineLatest(Geteilt.ortung.$nutztOBD)
            .receive(on: RunLoop.main)
            .sink { [weak self] position, obd in
                guard let self else { return }
                if let position, abs(position.timestamp.timeIntervalSinceNow) < 120 {
                    trackerBeenden()
                    ort = position
                } else if obd {
                    trackerStarten(Geteilt.anmeldung.fahrerID)
                }
            }
            .store(in: &abos)
    }

    func beenden() {
        abos.removeAll()
        trackerBeenden()
    }

    // MARK: OBD-Tracker

    private func trackerStarten(_ fahrer: UUID?) {
        guard let fahrer else { return trackerBeenden() }
        guard trackerFahrer != fahrer else { return }
        trackerBeenden()
        trackerFahrer = fahrer
        ort = nil
        Task { await trackerLaden() }
        let kanal = Backend.client.channel("carplay-standort-\(fahrer.uuidString)")
        let strom = kanal.postgresChange(AnyAction.self, schema: "public", table: "driver_live_locations",
                                         filter: .eq("driver_id", value: fahrer.uuidString))
        self.kanal = kanal
        beobachter = Task { [weak self] in for await _ in strom { await self?.trackerLaden() } }
        Task { try? await kanal.subscribeWithError() }
        takt = Timer.scheduledTimer(withTimeInterval: 15, repeats: true) { [weak self] _ in
            Task { @MainActor in await self?.trackerLaden() }
        }
    }

    private func trackerBeenden() {
        takt?.invalidate()
        takt = nil
        beobachter?.cancel()
        beobachter = nil
        if let kanal { Task { await Backend.client.removeChannel(kanal) } }
        kanal = nil
        trackerFahrer = nil
    }

    private func trackerLaden() async {
        guard let fahrer = trackerFahrer else { return }
        struct Zeile: Decodable {
            let lat: Double?; let lng: Double?; let heading_deg: Double?; let speed_mps: Double?
            let accuracy_m: Double?; let source: String?; let captured_at: String?
        }
        guard let zeilen: [Zeile] = try? await Backend.client.from("driver_live_locations")
            .select("lat,lng,heading_deg,speed_mps,accuracy_m,source,captured_at")
            .eq("driver_id", value: fahrer).limit(5).execute().value,
              trackerFahrer == fahrer,
              let z = zeilen.first(where: { StandortChip.istObd($0.source ?? "") }),
              let lat = z.lat, let lng = z.lng
        else { return }
        ort = CLLocation(coordinate: CLLocationCoordinate2D(latitude: lat, longitude: lng),
                         altitude: 0, horizontalAccuracy: z.accuracy_m ?? 10, verticalAccuracy: -1,
                         course: z.heading_deg ?? -1, speed: z.speed_mps ?? -1,
                         timestamp: z.captured_at.flatMap(Datum.ausISO) ?? Date())
    }
}
