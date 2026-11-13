import Combine
import Foundation
import UIKit
import WatchConnectivity

/// Verbindung zur Apple-Watch-App der Dispo (TrisarDispoUhr). Laedt Fahrer und Fahrten nur,
/// wenn eine Uhr mit der App gekoppelt ist, und schickt bei jeder Aenderung den Stand.
@MainActor
final class DispoUhrBruecke: NSObject {
    static let shared = DispoUhrBruecke()
    /// Auch fuer CarPlay (DispoCarPlaySzene): dieselben Daten, nichts doppelt laden.
    let karte = KartenDaten()
    private var abos = Set<AnyCancellable>()
    private(set) var angemeldet = false
    /// CarPlay verbunden: Daten laufen auch ohne gekoppelte Uhr.
    private var carPlay = false

    func carPlayVerbunden(_ an: Bool) {
        carPlay = an
        datenStarten()
    }
    private var datenLaufen = false
    private var letzterStand: DispoUhrStand?

    func einrichten() {
        guard WCSession.isSupported(), WCSession.default.delegate == nil else { return }
        WCSession.default.delegate = self
        WCSession.default.activate()
    }

    /// Nach An- bzw. Abmeldung aufrufen.
    func setzeAngemeldet(_ an: Bool) {
        angemeldet = an
        letzterStand = nil
        datenStarten()
        senden()
    }

    private var uhrDa: Bool {
        let s = WCSession.default
        return WCSession.isSupported() && s.activationState == .activated && s.isPaired && s.isWatchAppInstalled
    }

    private func datenStarten() {
        guard angemeldet, uhrDa || carPlay, !datenLaufen else { return }
        datenLaufen = true
        let fahrten = DispoFahrtenSpeicher.gemeinsam
        fahrten.starten()
        Task { await karte.starten() }
        Publishers.CombineLatest(karte.$fahrer, fahrten.$fahrten)
            .debounce(for: .seconds(1), scheduler: RunLoop.main)
            .sink { [weak self] _ in self?.senden() }
            .store(in: &abos)
    }

    private func standBauen() -> DispoUhrStand {
        guard angemeldet else { return .leer }
        let fahrer = karte.fahrer
            .sorted { ($0.zustand.rawValue, $0.name) < ($1.zustand.rawValue, $1.name) }
            .prefix(60)
            .map { f in
                DispoUhrFahrer(id: f.id, name: f.name, nummer: f.nummer, zustand: f.zustand.rawValue,
                               ohneSignal: f.offline, signalStufe: f.signalStufe, kennzeichen: f.kennzeichen,
                               fahrtVon: f.fahrt?.vonSuche, fahrtNach: f.fahrt?.nachSuche,
                               lat: f.lat, lng: f.lng, telefon: f.telefon.isEmpty ? nil : f.telefon,
                               fahrzeug: f.fahrzeug.isEmpty ? nil : f.fahrzeug, signalText: f.signalText,
                               abfahrt: f.info.abfahrt, ankunft: f.info.ankunft, fahrMinuten: f.info.fahrMinuten,
                               unterwegs: f.info.unterwegs, vonTyp: f.info.von.typ, nachTyp: f.info.nach.typ,
                               vonName: f.info.von.name, nachName: f.info.nach.name,
                               dienststart: f.info.dienststart, dienstende: f.info.dienstende,
                               flagge: f.flagge)
            }
        let heute = Self.tagWert(Date())
        let fahrten = DispoFahrtenSpeicher.gemeinsam.fahrten
            .filter { !$0.archiviert && $0.datum >= heute }
            .sorted { ($0.datum, $0.startZeit) < ($1.datum, $1.startZeit) }
            .prefix(40)
            .map { f in
                DispoUhrFahrt(id: f.id, tag: f.datum, zeit: f.startZeit, von: f.startOrt, nach: f.zielOrt,
                              fahrer: f.ohneFahrerVariante ? "" : f.fahrer, gast: f.name,
                              status: f.aktuellerStatus, ohneFahrer: f.ohneFahrerVariante, verspaetet: f.zuSpaet,
                              ankunft: Self.ankunft(f), statusText: Self.statusText(f.jobStatus))
            }
        return DispoUhrStand(angemeldet: true, fahrer: Array(fahrer), fahrten: Array(fahrten), stand: Date())
    }

    /// Ankunft am Ziel wie die Fahrtenliste (bei Verspaetung die neue Zeit).
    private static func ankunft(_ f: DispoFahrt) -> String? {
        let z = f.zeiten
        let kandidaten = f.verspaetet ? [z.ankunftNeu, z.ankunftZeit, z.ankunftOriginal] : [z.ankunftZeit, z.ankunftNeu, z.ankunftOriginal]
        return kandidaten.first { !$0.isEmpty && $0 != "--:--" }
    }

    /// Status fuer die Uhr, mit "Beim Gast" (editorStatus kennt nur offen/unterwegs/beendet).
    private static func statusText(_ jobStatus: String) -> String {
        switch jobStatus.lowercased() {
        case "in_progress", "unterwegs", "started", "on_trip", "ongoing", "active": return "Unterwegs"
        case "at_pickup", "pickup", "beim_pickup", "beim pickup": return "Beim Gast"
        case "done", "completed", "arrived", "beendet": return "Beendet"
        default: return "Offen"
        }
    }

    /// Fahrer von der Uhr zuweisen: wie im Fahrt-Editor speichern (FahrtSpeichern.aendern), damit
    /// Status, Kolonne und Push an den Fahrer („Neue Fahrt“) genauso laufen wie in der App.
    static func fahrerZuweisen(fahrt: String?, fahrer: String?) async -> FahrtSpeichern.Ergebnis {
        guard let fahrt, let fahrtUUID = UUID(uuidString: fahrt), let fahrer, let fahrerUUID = UUID(uuidString: fahrer) else {
            return (false, "Fahrt oder Fahrer fehlt")
        }
        let verzeichnis = await FahrtSpeichern.fahrerLaden()
        guard let eintrag = verzeichnis.first(where: { $0.id == fahrerUUID }) else { return (false, "Fahrer nicht gefunden") }
        let geladen: GeladeneFahrt
        do { geladen = try await FahrtSpeichern.laden(fahrtUUID) } catch { return (false, error.localizedDescription) }
        // Name wie im Editor ("Name (Nummer)"). Mehrdeutige Namen ueber die Nummer aufloesen.
        let gleicherName = verzeichnis.filter { FahrtText.ortNormal($0.name) == FahrtText.ortNormal(eintrag.name) }.count > 1
        let label = FahrtSpeichern.fahrerVorschlaege([eintrag]).first ?? eintrag.name
        let eingabe = gleicherName && !eintrag.nummer.isEmpty ? eintrag.nummer : label
        guard FahrtSpeichern.fahrerID(eingabe, verzeichnis) == fahrerUUID else { return (false, "Fahrer nicht eindeutig") }
        // Freie Plaetze der Fahrt fuellen, vorhandene Fahrer bleiben.
        var namen = geladen.fahrerNamen.map(FahrtText.getrimmt).filter { !$0.isEmpty }
        namen.append(eingabe)
        var w = geladen.werte
        w.anonymeGaeste = w.anonymeGaeste.isEmpty ? "0" : w.anonymeGaeste
        return await FahrtSpeichern.aendern(FahrtEingabe(
            werte: w, fahrgaeste: FahrtText.gaesteTeilen(geladen.fahrgaeste).joined(separator: "; "),
            fahrerNamen: namen, zwischenstopps: geladen.zwischenstopps,
            flugZielFlughafen: "", flugAnkunftGeplant: "", notiz: geladen.notiz), geladen: geladen)
    }

    /// Frage von der Uhr: laeuft wie im KI-Assistenten der App ueber denselben Verlauf.
    /// Frage und Antwort landen in KiVerlaufSpeicher, die offene Ansicht zeigt sie sofort.
    private static func kiFrage(_ frage: String, uhrVerlauf: Data?) async -> [String: Any] {
        let gespeichert = KiVerlaufSpeicher.laden()
        // Verlauf der App ist der gemeinsame Chat. Nur wenn er leer ist, zaehlt der Verlauf der Uhr.
        var verlauf = gespeichert.filter { $0.pending != true && $0.id != "init" }.map { (rolle: $0.role, text: $0.text) }
        if verlauf.isEmpty {
            verlauf = (uhrVerlauf.flatMap { try? JSONDecoder().decode([[String]].self, from: $0) } ?? [])
                .compactMap { $0.count == 2 ? (rolle: $0[0], text: $0[1]) : nil }
        }
        let offen = gespeichert.last { $0.bookingStatus == "pending" }?.bookingProposal
        let letzteFahrtID = gespeichert.last { $0.bookingRideId != nil }?.bookingRideId
        let ms = Int(Date().timeIntervalSince1970 * 1000)
        KiVerlaufSpeicher.anhaengen(KiNachricht(id: "msg-user-uhr-\(ms)", role: "user", text: frage, time: KiNachricht.uhrzeit()))
        var antwort = KiNachricht(id: "msg-ai-uhr-\(ms + 1)", role: "assistant", text: "", time: "")
        var rueck: [String: Any] = [:]
        do {
            // Bricht die Verbindung beim Aufwachen ab, einmal neu versuchen.
            let a: KiAssistentDienst.Antwort
            do {
                a = try await KiAssistentDienst.fragen(frage, verlauf: verlauf, offenerVorschlag: offen, letzteFahrtId: letzteFahrtID)
            } catch let fehler as URLError where [.networkConnectionLost, .notConnectedToInternet, .timedOut].contains(fehler.code) {
                a = try await KiAssistentDienst.fragen(frage, verlauf: verlauf, offenerVorschlag: offen, letzteFahrtId: letzteFahrtID)
            }
            antwort.text = a.text.isEmpty ? "Keine Antwort." : a.text
            antwort.bookingProposal = a.buchungsVorschlag
            antwort.bookingStatus = a.buchungsVorschlag == nil ? nil : "pending"
            antwort.dienstVorschlag = a.dienstVorschlag
            antwort.dienstStatus = a.dienstVorschlag == nil ? nil : "offen"
            if let d = a.dienstVorschlag, let daten = try? JSONEncoder().encode(d) {
                rueck["dienst"] = daten
                rueck["knopf"] = d.knopfText
            }
            if let b = a.buchungsVorschlag, let daten = try? JSONEncoder().encode(b) {
                rueck["buchung"] = daten
                rueck["knopf"] = b.fahrtUUID == nil ? "Buchen" : "Ändern"
            }
        } catch {
            antwort.text = "Der Assistent konnte gerade nicht antworten: \(error.localizedDescription)"
        }
        antwort.time = KiNachricht.uhrzeit()
        // Ein neuer Buchungsvorschlag loest den alten ab (wie in der Ansicht).
        if antwort.bookingProposal != nil {
            KiVerlaufSpeicher.alleAendern { if $0.bookingStatus == "pending" { $0.bookingStatus = "cancelled" } }
        }
        KiVerlaufSpeicher.anhaengen(antwort)
        rueck["text"] = antwort.text
        rueck["nachricht"] = antwort.id
        return rueck
    }

    private static func tagWert(_ datum: Date) -> String {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        return f.string(from: datum)
    }

    private func senden() {
        guard uhrDa else { return }
        var stand = standBauen()
        if var alt = letzterStand {
            alt.stand = stand.stand
            if alt == stand { return }
        }
        letzterStand = stand
        stand.stand = Date()
        try? WCSession.default.updateApplicationContext(stand.alsDaten())
    }
}

extension DispoUhrBruecke: WCSessionDelegate {
    nonisolated func session(_ session: WCSession, activationDidCompleteWith state: WCSessionActivationState, error: Error?) {
        Task { @MainActor in self.letzterStand = nil; self.datenStarten(); self.senden() }
    }

    nonisolated func sessionDidBecomeInactive(_ session: WCSession) {}

    nonisolated func sessionDidDeactivate(_ session: WCSession) {
        session.activate()
    }

    nonisolated func sessionWatchStateDidChange(_ session: WCSession) {
        Task { @MainActor in self.letzterStand = nil; self.datenStarten(); self.senden() }
    }

    nonisolated func session(_ session: WCSession, didReceiveMessage message: [String: Any],
                             replyHandler: @escaping ([String: Any]) -> Void) {
        let art = message[DispoUhrAktion.art] as? String
        let frage = message["frage"] as? String ?? ""
        let verlaufDaten = message["verlauf"] as? Data
        let dienstDaten = message["dienst"] as? Data
        let buchungDaten = message["buchung"] as? Data
        let fahrtID = message["fahrt"] as? String
        let fahrerID = message["fahrer"] as? String
        let nachrichtID = message["nachricht"] as? String
        Task { @MainActor in
            // Die Uhr weckt die App im Hintergrund. Ohne Hintergrundzeit friert iOS sie ein,
            // waehrend sie auf den Server wartet ("The network connection was lost").
            var hintergrund = UIBackgroundTaskIdentifier.invalid
            hintergrund = UIApplication.shared.beginBackgroundTask(withName: "uhr") {
                UIApplication.shared.endBackgroundTask(hintergrund)
                hintergrund = .invalid
            }
            defer { if hintergrund != .invalid { UIApplication.shared.endBackgroundTask(hintergrund) } }
            if art == DispoUhrAktion.fahrerZuweisen {
                let ergebnis = await Self.fahrerZuweisen(fahrt: fahrtID, fahrer: fahrerID)
                if ergebnis.ok {
                    DispoFahrtenSpeicher.gemeinsam.neuLaden()
                    await self.karte.laden()
                    self.letzterStand = nil
                    self.senden()
                }
                replyHandler(ergebnis.ok ? ["ok": true] : ["ok": false, "fehler": ergebnis.fehler ?? "Zuweisen fehlgeschlagen"])
                return
            }
            if art == DispoUhrAktion.buchen {
                guard let daten = buchungDaten, let v = try? JSONDecoder().decode(KiBuchungsVorschlag.self, from: daten) else {
                    replyHandler(["ok": false, "fehler": "Vorschlag nicht lesbar"])
                    return
                }
                do {
                    let fahrt = try await KiAssistentDienst.buchen(v)
                    KiVerlaufSpeicher.aendern(nachrichtID) { $0.bookingStatus = "booked"; $0.bookingRideId = fahrt }
                    replyHandler(["ok": true, "anzahl": 1])
                } catch {
                    replyHandler(["ok": false, "fehler": error.localizedDescription])
                }
                return
            }
            if art == DispoUhrAktion.kiFrage {
                replyHandler(await Self.kiFrage(frage, uhrVerlauf: verlaufDaten))
                return
            }
            if art == DispoUhrAktion.vorschlagVerwerfen {
                KiVerlaufSpeicher.aendern(nachrichtID) { n in
                    if n.dienstStatus == "offen" { n.dienstStatus = "verworfen" }
                    if n.bookingStatus == "pending" { n.bookingStatus = "cancelled" }
                }
                replyHandler(["ok": true])
                return
            }
            if art == DispoUhrAktion.dienstSenden {
                guard let daten = dienstDaten, let v = try? JSONDecoder().decode(DienstVorschlag.self, from: daten) else {
                    replyHandler(["ok": false, "fehler": "Vorschlag nicht lesbar"])
                    return
                }
                do {
                    let anzahl = try await DienstSenden.senden(v)
                    KiVerlaufSpeicher.aendern(nachrichtID) { $0.dienstStatus = "gesendet"; $0.dienstAnzahl = anzahl }
                    replyHandler(["ok": true, "anzahl": anzahl])
                } catch {
                    let text = error.localizedDescription
                    KiVerlaufSpeicher.aendern(nachrichtID) { $0.dienstStatus = "offen"; $0.dienstFehler = text }
                    replyHandler(["ok": false, "fehler": text])
                }
                return
            }
            if art == DispoUhrAktion.neuLaden {
                DispoFahrtenSpeicher.gemeinsam.neuLaden()
                await self.karte.laden()
                self.letzterStand = nil
                self.senden()
                replyHandler(["ok": true])
            } else {
                replyHandler(["ok": false])
            }
        }
    }
}
