import ActivityKit
import Combine
import Foundation

/// Haelt die Live-Aktivitaet "Naechste Fahrt" aktuell: laufende Fahrt, sonst die naechste
/// angenommene Fahrt in den kommenden zwei Stunden. Sonst keine Aktivitaet.
/// Starten erlaubt iOS nur bei offener App. Aktualisieren geht auch im Hintergrund.
@MainActor
final class LiveFahrt {
    static let shared = LiveFahrt()
    private var abo: AnyCancellable?

    func beobachten(_ speicher: FahrtenSpeicher) {
        guard abo == nil else { return }
        abo = speicher.$fahrten
            .receive(on: RunLoop.main)
            .sink { [weak self] fahrten in
                var liste = fahrten
                #if DEBUG
                if CarPlaySzene.beispielLauf { liste = CarPlaySzene.beispiele }
                #endif
                self?.abgleichen(liste)
            }
    }

    /// Beim Wechsel in den Vordergrund: Starten geht nur dann, der erste Versuch beim App-Start ist zu frueh.
    func imVordergrund() {
        var liste = Geteilt.fahrten.fahrten
        #if DEBUG
        if CarPlaySzene.beispielLauf { liste = CarPlaySzene.beispiele }
        #endif
        abgleichen(liste)
    }

    private func abgleichen(_ fahrten: [Fahrt]) {
        let vorhanden = Activity<FahrtAktivitaet>.activities
        guard let fahrt = Self.auswaehlen(fahrten) else {
            for a in vorhanden { Task { await a.end(nil, dismissalPolicy: .immediate) } }
            return
        }
        let stand = FahrtAktivitaet.ContentState(zeit: fahrt.etd, status: CarPlaySzene.statusText(fahrt),
                                                 von: fahrt.abholKurz, nach: fahrt.zielKurz,
                                                 unterwegs: CarPlaySzene.unterwegs(fahrt))
        let inhalt = ActivityContent(state: stand, staleDate: nil)
        for a in vorhanden where a.attributes.fahrtID != fahrt.id.uuidString {
            Task { await a.end(nil, dismissalPolicy: .immediate) }
        }
        if let a = vorhanden.first(where: { $0.attributes.fahrtID == fahrt.id.uuidString }) {
            if a.content.state != stand { Task { await a.update(inhalt) } }
        } else {
            guard ActivityAuthorizationInfo().areActivitiesEnabled else {
                NSLog("Live-Aktivitaet: in den Einstellungen abgeschaltet")
                return
            }
            do {
                _ = try Activity.request(attributes: FahrtAktivitaet(fahrtID: fahrt.id.uuidString), content: inhalt)
            } catch {
                // Im Hintergrund nicht erlaubt: beim naechsten Oeffnen der App startet sie.
                NSLog("Live-Aktivitaet: %@", error.localizedDescription)
            }
        }
    }

    private static func auswaehlen(_ fahrten: [Fahrt]) -> Fahrt? {
        let sortiert = fahrten.sorted { ($0.fahrtDatum, $0.etd) < ($1.fahrtDatum, $1.etd) }
        if let aktiv = sortiert.first(where: { CarPlaySzene.unterwegs($0) || CarPlaySzene.beimGast($0) }) { return aktiv }
        let jetzt = Date()
        return sortiert.first { f in
            guard !f.wartetAufAntwort, let plan = planzeit(f) else { return false }
            return plan > jetzt.addingTimeInterval(-1800) && plan < jetzt.addingTimeInterval(7200)
        }
    }

    private static func planzeit(_ f: Fahrt) -> Date? {
        let teile = f.etd.split(separator: ":").compactMap { Int($0) }
        guard teile.count >= 2 else { return nil }
        return Calendar.current.date(bySettingHour: teile[0], minute: teile[1], second: 0, of: Datum.ausTagWert(f.fahrtDatum))
    }
}
