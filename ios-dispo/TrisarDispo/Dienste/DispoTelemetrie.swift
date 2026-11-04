import Foundation
import Supabase

/// useFahrzeugTelemetrie (shared/fahrzeugTelemetrie.js) fuer einen Fahrer: letzter Stand aus
/// vehicle_telemetry_live und die drei juengsten Ereignisse, per Realtime und alle 30 s neu.
/// Die Anzeigezeilen kommen aus FahrzeugDaten.zeilen (gleiche Regeln wie in der Fahrer-App).
@MainActor
final class DispoTelemetrie: ObservableObject {
    @Published private(set) var zeilen: [FahrzeugDaten.TelemetrieZeile] = []
    @Published private(set) var ereignisse: [FahrzeugDaten.Ereignis] = []
    @Published private(set) var stand = ""

    private let fahrerID: String
    private var kanal: RealtimeChannelV2?
    private var beobachter: [Task<Void, Never>] = []
    private var takt: Timer?

    init(fahrerID: String) { self.fahrerID = fahrerID }

    private static let ereignisTexte: [String: String] = [
        "ignition_on": "Zündung an", "ignition_off": "Zündung aus", "trip_start": "Fahrt begonnen", "trip_end": "Fahrt beendet",
        "idling_start": "Leerlauf begonnen", "idling_end": "Leerlauf beendet", "unplugged": "Tracker abgesteckt",
        "plugged_in": "Tracker eingesteckt", "harsh_acceleration": "Starkes Beschleunigen", "harsh_braking": "Starkes Bremsen",
        "harsh_cornering": "Scharfe Kurve", "overspeeding": "Zu schnell", "crash": "Aufprall erkannt",
        "towing": "Abschleppen erkannt", "jamming": "Störsender erkannt", "alarm": "Alarm",
    ]

    func starten() async {
        await laden()
        let kanal = Backend.client.channel("fahrzeug-telemetrie-\(fahrerID)")
        let stroeme = [
            kanal.postgresChange(AnyAction.self, schema: "public", table: "vehicle_telemetry_live", filter: .eq("driver_id", value: fahrerID)),
            kanal.postgresChange(AnyAction.self, schema: "public", table: "vehicle_telemetry_events", filter: .eq("driver_id", value: fahrerID)),
        ]
        self.kanal = kanal
        beobachter = stroeme.map { strom in
            Task { [weak self] in for await _ in strom { await self?.laden() } }
        }
        try? await kanal.subscribeWithError()
        takt = Timer.scheduledTimer(withTimeInterval: 30, repeats: true) { [weak self] _ in
            Task { @MainActor in await self?.laden() }
        }
    }

    func beenden() async {
        takt?.invalidate()
        beobachter.forEach { $0.cancel() }
        if let kanal { await Backend.client.removeChannel(kanal) }
        kanal = nil
    }

    func laden() async {
        let live = try? await Backend.client.from("vehicle_telemetry_live").select().eq("driver_id", value: fahrerID)
            .limit(1).execute().data
        let zeile = (live.flatMap { try? JSONSerialization.jsonObject(with: $0) } as? [[String: Any]])?.first
        zeilen = FahrzeugDaten.zeilen(zeile)
        stand = (zeile?["captured_at"] as? String).flatMap(Datum.ausISO).map(Datum.uhrzeit) ?? ""

        let ev = try? await Backend.client.from("vehicle_telemetry_events").select("id,event_type,value,captured_at")
            .eq("driver_id", value: fahrerID).order("captured_at", ascending: false).limit(3).execute().data
        let evZeilen = (ev.flatMap { try? JSONSerialization.jsonObject(with: $0) } as? [[String: Any]]) ?? []
        ereignisse = evZeilen.map { e in
            let art = e["event_type"] as? String ?? ""
            var text = Self.ereignisTexte[art] ?? "Ereignis"
            // Zu schnell: Tempo dahinter.
            if art == "overspeeding", let v = KartenDaten.zahl(e["value"]) { text += " (\(Int(v.rounded())) km/h)" }
            return FahrzeugDaten.Ereignis(id: "\(e["id"] ?? UUID().uuidString)",
                                          zeit: (e["captured_at"] as? String).flatMap(Datum.ausISO).map(Datum.uhrzeit) ?? "",
                                          text: text)
        }
    }
}
