import Foundation
import WatchConnectivity
import WatchKit
import WidgetKit

/// Seite der Uhr: empfaengt den Stand vom iPhone, schickt Aktionen zurueck.
/// Ein Objekt fuer App, Siri-Kurzbefehle und Komplikation (shared).
@MainActor
final class UhrVerbindung: NSObject, ObservableObject {
    static let shared = UhrVerbindung()

    @Published private(set) var stand: UhrStand
    @Published private(set) var arbeitetID: String?
    @Published var meldung: String?

    override init() {
        // Letzten Stand sofort zeigen, auch ohne iPhone in Reichweite.
        stand = UhrGruppe.lesen() ?? .leer
        super.init()
        #if DEBUG
        // Simulator ohne gekoppeltes iPhone: Start mit Argument -uhrBeispiel zeigt Beispieldaten.
        if ProcessInfo.processInfo.arguments.contains("-uhrBeispiel") {
            stand = Self.beispiel
            UhrGruppe.schreiben(stand)
            WidgetCenter.shared.reloadAllTimelines()
            return
        }
        #endif
        aktivieren()
    }

    func aktivieren() {
        guard WCSession.isSupported() else { return }
        let sitzung = WCSession.default
        if sitzung.delegate == nil { sitzung.delegate = self }
        if sitzung.activationState != .activated { sitzung.activate() }
    }

    var iPhoneErreichbar: Bool { WCSession.isSupported() && WCSession.default.isReachable }

    private func uebernehmen(_ neu: UhrStand) {
        // Neue offene Fahrt: kurz am Handgelenk tippen.
        let alteOffene = Set(stand.fahrten.filter(\.offen).map(\.id))
        let neueOffene = Set(neu.fahrten.filter(\.offen).map(\.id))
        if stand.angemeldet, !neueOffene.subtracting(alteOffene).isEmpty {
            WKInterfaceDevice.current().play(.notification)
        }
        stand = neu
        UhrGruppe.schreiben(neu)
        WidgetCenter.shared.reloadAllTimelines()
    }

    func fahrtAntworten(_ fahrt: UhrFahrt, annehmen: Bool) {
        schicken([UhrAktion.art: UhrAktion.fahrt, "id": fahrt.id, "annehmen": annehmen], id: fahrt.id)
    }

    func dienstAntworten(_ dienst: UhrDienst, annehmen: Bool) {
        schicken([UhrAktion.art: UhrAktion.dienst, "id": dienst.id, "annehmen": annehmen], id: dienst.id)
    }

    /// Fahrtschritt: "at_pickup" (Bin da), "in_progress" (Gast an Bord), "done" (Fahrt beendet).
    func schritt(_ fahrt: UhrFahrt, ziel: String) {
        schicken([UhrAktion.art: UhrAktion.schritt, "id": fahrt.id, "ziel": ziel], id: "schritt-\(fahrt.id)")
    }

    func stundenBestaetigen(_ heute: UhrStunden) {
        schicken([UhrAktion.art: UhrAktion.stundenBestaetigen, "id": heute.dienstID], id: "stunden")
    }

    func neuLaden() {
        schicken([UhrAktion.art: UhrAktion.neuLaden], id: "laden")
    }

    private func schicken(_ nachricht: [String: Any], id: String) {
        guard WCSession.default.isReachable else {
            meldung = "iPhone nicht erreichbar. TRISAR auf dem iPhone öffnen."
            return
        }
        arbeitetID = id
        WCSession.default.sendMessage(nachricht, replyHandler: { antwort in
            let ok = antwort["ok"] as? Bool ?? false
            Task { @MainActor in
                self.arbeitetID = nil
                if ok {
                    WKInterfaceDevice.current().play(.success)
                } else {
                    self.meldung = "Hat nicht geklappt. Bitte am iPhone versuchen."
                }
            }
        }, errorHandler: { fehler in
            let text = fehler.localizedDescription
            Task { @MainActor in
                self.arbeitetID = nil
                self.meldung = text
            }
        })
    }

    /// Fuer Siri/Kurzbefehle: Nachricht schicken und auf die Antwort warten.
    func senden(_ nachricht: [String: Any]) async -> Bool {
        aktivieren()
        // Frisch gestartet: kurz auf die Verbindung warten.
        for _ in 0..<20 where !WCSession.default.isReachable {
            try? await Task.sleep(for: .milliseconds(150))
        }
        guard WCSession.default.isReachable else { return false }
        return await withCheckedContinuation { fortsetzung in
            WCSession.default.sendMessage(nachricht, replyHandler: { antwort in
                fortsetzung.resume(returning: antwort["ok"] as? Bool ?? false)
            }, errorHandler: { _ in
                fortsetzung.resume(returning: false)
            })
        }
    }
}

extension UhrVerbindung: WCSessionDelegate {
    nonisolated func session(_ session: WCSession, activationDidCompleteWith state: WCSessionActivationState, error: Error?) {
        let kontext = session.receivedApplicationContext
        if let neu = UhrStand.aus(kontext) {
            Task { @MainActor in self.uebernehmen(neu) }
        }
    }

    nonisolated func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String: Any]) {
        if let neu = UhrStand.aus(applicationContext) {
            Task { @MainActor in self.uebernehmen(neu) }
        }
    }

    /// transferCurrentComplicationUserInfo vom iPhone: frischer Stand fuer die Komplikation.
    nonisolated func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any]) {
        if let neu = UhrStand.aus(userInfo) {
            Task { @MainActor in self.uebernehmen(neu) }
        }
    }

    nonisolated func sessionReachabilityDidChange(_ session: WCSession) {
        Task { @MainActor in self.objectWillChange.send() }
    }
}

#if DEBUG
extension UhrVerbindung {
    static var beispiel: UhrStand {
        let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"
        let heute = f.string(from: Date())
        let morgen = f.string(from: Date().addingTimeInterval(86400))
        let z = DateFormatter(); z.dateFormat = "HH:mm"
        let bald = z.string(from: Date().addingTimeInterval(25 * 60))
        let spaeter = z.string(from: Date().addingTimeInterval(3 * 3600))
        let jetzt = Date()
        // -uhrFertig: Dienst vorbei, Stunden zum Bestaetigen.
        let fertig = ProcessInfo.processInfo.arguments.contains("-uhrFertig")
        return UhrStand(angemeldet: true, name: "Stefano Spandri", fahrten: [
            UhrFahrt(id: "1", tag: heute, zeit: bald, status: "Beim Gast", von: "Hotel Bayerischer Hof", nach: "Flughafen München T2", flug: "LH 2034", offen: false, laeuft: true, kolonne: false,
                     phase: "beimGast", gaeste: ["Dr. Anna Berger", "Max Berger"], gastTelefon: "+49 170 1234567",
                     notiz: "Gast wartet in der Lobby, zwei große Koffer.", flugStatus: "Gelandet", flugAnkunft: "14:05", flugVerspaetung: 20),
            UhrFahrt(id: "2", tag: heute, zeit: spaeter, status: "Antwort offen", von: "Messe München", nach: "Mandarin Oriental", flug: "", offen: true, laeuft: false, kolonne: false,
                     gaeste: ["Herr Kowalski"], notiz: "Halle B6, Eingang Ost."),
            UhrFahrt(id: "3", tag: morgen, zeit: "08:00", status: "Angenommen", von: "Hauptbahnhof", nach: "BMW Welt", flug: "", offen: false, laeuft: false, kolonne: true),
        ], dienste: [
            UhrDienst(id: "d1", tag: morgen, start: "07:00", ende: "15:30", offen: true),
        ], ortungAn: true, letzteSendung: Date().addingTimeInterval(-20), stand: Date(),
        steht: true, tempoKmh: 0,
        heute: fertig
            ? UhrStunden(dienstID: "d0", start: jetzt.addingTimeInterval(-9 * 3600), ende: jetzt.addingTimeInterval(-600), fertig: true,
                         pausen: [], arbeitsMin: 510, offen: true, zettelStatus: nil)
            : UhrStunden(dienstID: "d0", start: jetzt.addingTimeInterval(-5 * 3600 - 17 * 60), ende: nil, fertig: false,
                         pausen: [UhrStunden.Pause(von: jetzt.addingTimeInterval(-40 * 60), bis: nil)],
                         arbeitsMin: 0, offen: false, zettelStatus: nil))
    }
}
#endif
