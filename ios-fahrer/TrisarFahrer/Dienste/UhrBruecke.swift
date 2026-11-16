import Combine
import CoreLocation
import Foundation
import Supabase
import UIKit
import WatchConnectivity

/// Verbindung zur Apple-Watch-App (TrisarFahrerUhr). Schickt bei jeder Aenderung den Stand
/// (Fahrten mit Details, Dienstanfragen, Ortung, Stunden von heute) als applicationContext und
/// fuehrt Aktionen der Uhr aus (Annehmen/Ablehnen, Fahrtschritte, Stunden bestaetigen).
@MainActor
final class UhrBruecke: NSObject {
    static let shared = UhrBruecke()
    private var abos = Set<AnyCancellable>()
    private var letzterStand: UhrStand?
    /// Schluessel der naechsten Fahrt, fuer die die Komplikation zuletzt aktualisiert wurde.
    private var letzteKomplikation = ""

    /// Details je Fahrt (Gaeste, Telefon, Notiz, Flug), fuer die naechsten Fahrten nachgeladen.
    private struct Detail: Equatable {
        var gaeste: [String] = []
        var telefon: String?
        var notiz: String?
        var flugStatus: String?
        var flugAnkunft: String?
        var flugVerspaetung: Int?
    }
    private var details: [UUID: Detail] = [:]
    private var detailsGeladen = Date.distantPast
    private var detailIDs: [UUID] = []
    private var stundenGeladen = Date.distantPast
    private var takt: Timer?

    func starten() {
        guard WCSession.isSupported(), abos.isEmpty else { return }
        WCSession.default.delegate = self
        WCSession.default.activate()

        let fahrten = Geteilt.fahrten
        let ortung = Geteilt.ortung
        let anmeldung = Geteilt.anmeldung
        Publishers.CombineLatest4(fahrten.$fahrten, fahrten.$dienstAnfragen, ortung.$letzteSendung, anmeldung.$profil)
            .debounce(for: .seconds(1), scheduler: RunLoop.main)
            .sink { [weak self] _ in
                self?.senden()
                self?.nachladenFallsNoetig()
            }
            .store(in: &abos)
        ortung.$eingeschaltet
            .removeDuplicates()
            .sink { [weak self] _ in self?.senden() }
            .store(in: &abos)
        // Stehen oder fahren: nur bei Wechsel senden (Schritte auf der Uhr nur im Stand).
        ortung.$letztePosition
            .map { Self.steht($0) }
            .removeDuplicates()
            .debounce(for: .seconds(2), scheduler: RunLoop.main)
            .sink { [weak self] _ in self?.senden() }
            .store(in: &abos)
        StundenSpeicher.shared.$eintraege
            .dropFirst()
            .sink { [weak self] _ in DispatchQueue.main.async { self?.senden() } }
            .store(in: &abos)
        // Stunden und Fluege aendern sich auch ohne Datenbank-Ereignis (Dienstende, Landung).
        takt = Timer.scheduledTimer(withTimeInterval: 300, repeats: true) { _ in
            Task { @MainActor in UhrBruecke.shared.nachladenFallsNoetig(erzwingen: true) }
        }
    }

    // MARK: CarPlay
    /// CarPlay zeigt denselben Stand wie die Uhr (Fahrten mit Gast, Flug, Notiz, Dienste, Stunden).
    /// Solange CarPlay verbunden ist, wird nachgeladen und jede Aenderung gemeldet, auch ohne Uhr.
    let carPlayStand = PassthroughSubject<UhrStand, Never>()
    private var carPlayAktiv = false

    func carPlayVerbunden(_ an: Bool) {
        carPlayAktiv = an
        guard an else { return }
        starten()
        nachladenFallsNoetig(erzwingen: true)
        carPlayStand.send(standBauen())
    }

    func aktuellerStand() -> UhrStand { standBauen() }

    /// Aktionen aus CarPlay laufen ueber dieselben Wege wie die der Uhr (UhrAktion).
    func aktion(_ nachricht: [String: Any]) async -> Bool {
        let ok = await ausfuehren(nachricht)
        senden()
        return ok
    }

    private var uhrVerbunden: Bool {
        let s = WCSession.default
        return WCSession.isSupported() && s.activationState == .activated && s.isPaired && s.isWatchAppInstalled
    }

    /// Stunden von heute und Details der naechsten Fahrten holen (hoechstens alle 2 Minuten).
    private func nachladenFallsNoetig(erzwingen: Bool = false) {
        guard uhrVerbunden || carPlayAktiv, Geteilt.anmeldung.fahrerID != nil else { return }
        let jetzt = Date()
        if erzwingen || jetzt.timeIntervalSince(stundenGeladen) > 120 {
            stundenGeladen = jetzt
            Task { await StundenSpeicher.shared.laden() }
        }
        let ids = Self.detailFahrten(Geteilt.fahrten.fahrten).map(\.id)
        if erzwingen || ids != detailIDs || jetzt.timeIntervalSince(detailsGeladen) > 120 {
            detailIDs = ids
            detailsGeladen = jetzt
            Task {
                await detailsLaden(ids)
                senden()
            }
        }
    }

    /// Fahrten, deren Details die Uhr bekommt: die naechsten 6 ab gestern.
    private static func detailFahrten(_ fahrten: [Fahrt]) -> [Fahrt] {
        Array(fahrten.sorted { ($0.fahrtDatum, $0.etd) < ($1.fahrtDatum, $1.etd) }.prefix(6))
    }

    nonisolated static func steht(_ ort: CLLocation?) -> Bool? {
        guard let ort, abs(ort.timestamp.timeIntervalSinceNow) < 180 else { return nil }
        return ort.speed < 2   // speed < 0 = ungueltig, dann gilt Stillstand
    }

    // MARK: Details

    private struct FlugSumme: Decodable {
        let flight_status_code: String?
        let scheduled_arrival_local: String?
        let estimated_arrival_local: String?
        let actual_arrival_local: String?
    }
    private struct JobDetail: Decodable { let id: UUID; let passengers: [String]?; let flug: FlugSumme? }
    private struct NotizZeile: Decodable { let job_id: UUID; let note_text: String? }
    private struct GastLink: Decodable { let job_id: UUID; let guest_id: UUID? }
    private struct Gast: Decodable { let id: UUID; let first_name: String?; let last_name: String?; let phone: String? }

    private func detailsLaden(_ ids: [UUID]) async {
        guard !ids.isEmpty else { details = [:]; return }
        let werte = ids.map(\.uuidString)
        async let jobsAbfrage: [JobDetail] = Backend.client.from("jobs")
            .select("id,passengers,flug:ext_flight_payload->summary").in("id", values: werte).execute().value
        async let notizAbfrage: [NotizZeile] = Backend.client.from("job_notes")
            .select("job_id,note_text").in("job_id", values: werte).order("created_at", ascending: false).execute().value
        async let linkAbfrage: [GastLink] = Backend.client.from("job_guests")
            .select("job_id,guest_id").in("job_id", values: werte).execute().value
        let jobs = (try? await jobsAbfrage) ?? []
        let notizen = (try? await notizAbfrage) ?? []
        let links = (try? await linkAbfrage) ?? []
        let gastIDs = Array(Set(links.compactMap(\.guest_id))).map(\.uuidString)
        let gaeste: [Gast] = gastIDs.isEmpty ? [] : ((try? await Backend.client.from("guests")
            .select("id,first_name,last_name,phone").in("id", values: gastIDs).execute().value) ?? [])
        let gastNach = Dictionary(uniqueKeysWithValues: gaeste.map { ($0.id, $0) })

        var neu: [UUID: Detail] = [:]
        for id in ids {
            var d = Detail()
            let job = jobs.first { $0.id == id }
            let verknuepft = links.filter { $0.job_id == id }.compactMap { $0.guest_id.flatMap { gastNach[$0] } }
            let namen = verknuepft.map { [$0.first_name, $0.last_name].compactMap { $0 }.joined(separator: " ").trimmingCharacters(in: .whitespaces) }
                .filter { !$0.isEmpty }
            d.gaeste = GaesteAnzeige.teile(namen.isEmpty ? (job?.passengers ?? []) : namen, anonym: 0).namen
            d.telefon = verknuepft.compactMap { g -> String? in
                let t = (g.phone ?? "").trimmingCharacters(in: .whitespaces)
                // "+49" allein (leeres Feld im Web-Formular) ist keine Nummer.
                return t.filter(\.isNumber).count >= 5 ? t : nil
            }.first
            d.notiz = notizen.first { $0.job_id == id && !($0.note_text ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }?
                .note_text?.trimmingCharacters(in: .whitespacesAndNewlines)
            if let flug = job?.flug {
                d.flugStatus = Self.flugText(flug.flight_status_code)
                let plan = flug.scheduled_arrival_local
                let erwartet = flug.actual_arrival_local ?? flug.estimated_arrival_local ?? plan
                d.flugAnkunft = erwartet.flatMap(Self.uhrzeit)
                if let p = plan.flatMap(Self.lokal), let e = erwartet.flatMap(Self.lokal) {
                    d.flugVerspaetung = Int((e.timeIntervalSince(p) / 60).rounded())
                }
            }
            neu[id] = d
        }
        details = neu
    }

    private static func flugText(_ code: String?) -> String? {
        let c = (code ?? "").trimmingCharacters(in: .whitespaces).uppercased()
        guard !c.isEmpty else { return nil }
        let texte = ["CD": "Annulliert", "DP": "Gestartet", "LD": "Gelandet", "RT": "Umgeleitet", "NA": "Kein Status",
                     "NO": "Planmäßig", "FE": "Planmäßig", "DL": "Verspätet", "NI": "Neue Info"]
        return texte[c] ?? c
    }

    /// "2026-11-11T14:05" (lokale Flughafenzeit, ohne Zone) -> Datum zum Vergleichen.
    private static func lokal(_ text: String) -> Date? {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone(identifier: "UTC")
        f.dateFormat = "yyyy-MM-dd'T'HH:mm"
        return f.date(from: String(text.prefix(16)))
    }

    private static func uhrzeit(_ text: String) -> String? {
        guard text.count >= 16 else { return nil }
        let t = Array(text)
        return String(t[11..<16])
    }

    // MARK: Stand

    private func standBauen() -> UhrStand {
        let anmeldung = Geteilt.anmeldung
        let ortung = Geteilt.ortung
        let speicher = Geteilt.fahrten
        let name = [anmeldung.profil?.firstName, anmeldung.profil?.lastName].compactMap { $0 }.joined(separator: " ")
        let fahrten = speicher.fahrten
            .sorted { ($0.fahrtDatum, $0.etd) < ($1.fahrtDatum, $1.etd) }
            .prefix(20)
            .map { f in
                let d = details[f.id]
                return UhrFahrt(id: f.id.uuidString, tag: f.fahrtDatum, zeit: f.etd,
                                status: CarPlaySzene.statusText(f), von: f.abholKurz, nach: f.zielKurz,
                                flug: f.flug, offen: f.wartetAufAntwort,
                                laeuft: CarPlaySzene.unterwegs(f) || CarPlaySzene.beimGast(f), kolonne: f.istKolonne,
                                phase: CarPlaySzene.unterwegs(f) ? "unterwegs" : (CarPlaySzene.beimGast(f) ? "beimGast" : nil),
                                gaeste: d?.gaeste, gastTelefon: d?.telefon, notiz: d?.notiz,
                                flugStatus: d?.flugStatus, flugAnkunft: d?.flugAnkunft, flugVerspaetung: d?.flugVerspaetung)
            }
        let dienste = speicher.dienstAnfragen.prefix(10).map { d in
            UhrDienst(id: d.id.uuidString, tag: d.service_date ?? "",
                      start: d.service_start_time.map { String($0.prefix(5)) },
                      ende: d.service_end_time.map { String($0.prefix(5)) },
                      offen: !d.angenommen,
                      treffpunkt: d.treffpunkt.flatMap { $0.name.isEmpty ? nil : $0.name },
                      treffpunktNotiz: d.treffpunkt.flatMap { $0.notiz.isEmpty ? nil : $0.notiz },
                      treffpunktLat: d.treffpunkt?.punkt?.latitude,
                      treffpunktLng: d.treffpunkt?.punkt?.longitude)
        }
        let ort = ortung.letztePosition
        let steht = Self.steht(ort)
        let tempo = steht == nil ? nil : ort.map { Int((max(0, $0.speed) * 3.6 / 5).rounded()) * 5 }
        return UhrStand(angemeldet: anmeldung.profil != nil, name: name, fahrten: Array(fahrten),
                        dienste: Array(dienste), ortungAn: ortung.eingeschaltet,
                        letzteSendung: ortung.letzteSendung, stand: Date(),
                        steht: steht, tempoKmh: tempo, heute: stundenHeute())
    }

    /// Wie heuteEintrag in StundenAnsicht: Dienst von heute, der schon begonnen hat.
    private func heuteEintrag() -> Stunden.Eintrag? {
        StundenSpeicher.shared.eintraege.first { $0.dienst.datum == Stunden.heuteDatum && Stunden.heute($0) != nil }
    }

    private func stundenHeute() -> UhrStunden? {
        guard let e = heuteEintrag(), let s = Stunden.heute(e) else { return nil }
        let z = e.zettel
        return UhrStunden(dienstID: e.dienst.id.uuidString, start: s.start, ende: s.ende, fertig: s.fertig,
                          pausen: s.pausen.map { UhrStunden.Pause(von: $0.von, bis: $0.bis) },
                          // Laufend rechnet die Uhr selbst, sonst wuerde der Stand jede Minute neu gesendet.
                          arbeitsMin: s.fertig ? s.arbeitsMin : 0,
                          offen: s.fertig && Stunden.fahrerDran(z),
                          zettelStatus: s.fertig ? z?.status : nil)
    }

    private func senden() {
        if carPlayAktiv { carPlayStand.send(standBauen()) }
        let sitzung = WCSession.default
        guard uhrVerbunden else { return }
        var stand = standBauen()
        // Nur bei echter Aenderung senden (Zeitstempel zaehlt nicht).
        if var alt = letzterStand {
            alt.stand = stand.stand
            if alt == stand { return }
        }
        letzterStand = stand
        stand.stand = Date()
        try? sitzung.updateApplicationContext(stand.alsDaten())
        // Komplikation auf dem Zifferblatt: weckt die Uhr-App auch im Hintergrund (Budget ca. 50 am Tag),
        // deshalb nur, wenn sich die naechste Fahrt aendert.
        let naechste = stand.naechsteFahrt().map { "\($0.id)|\($0.tag)|\($0.zeit)|\($0.status)|\($0.von)" } ?? "-"
        if naechste != letzteKomplikation, sitzung.isComplicationEnabled {
            letzteKomplikation = naechste
            sitzung.transferCurrentComplicationUserInfo(stand.alsDaten())
        }
    }

    // MARK: Aktionen der Uhr

    private func ausfuehren(_ nachricht: [String: Any]) async -> Bool {
        let speicher = Geteilt.fahrten
        switch nachricht[UhrAktion.art] as? String {
        case UhrAktion.fahrt:
            guard let id = (nachricht["id"] as? String).flatMap(UUID.init(uuidString:)),
                  let fahrt = speicher.fahrten.first(where: { $0.id == id }),
                  let annehmen = nachricht["annehmen"] as? Bool else { return false }
            // CarPlay schickt "quelle": "carplay", die Uhr nichts.
            let grund = (nachricht["quelle"] as? String) == "carplay" ? "In CarPlay abgelehnt" : "Auf der Apple Watch abgelehnt"
            return await speicher.antworten(fahrt, annehmen: annehmen, grund: annehmen ? nil : grund)
        case UhrAktion.dienst:
            guard let id = (nachricht["id"] as? String).flatMap(UUID.init(uuidString:)),
                  let anfrage = speicher.dienstAnfragen.first(where: { $0.id == id }),
                  let annehmen = nachricht["annehmen"] as? Bool else { return false }
            return await speicher.dienstAntworten(anfrage, annehmen: annehmen)
        case UhrAktion.schritt:
            guard let id = (nachricht["id"] as? String).flatMap(UUID.init(uuidString:)),
                  let ziel = nachricht["ziel"] as? String else { return false }
            let ok = await schritt(id, ziel: ziel)
            await speicher.laden()
            return ok
        case UhrAktion.stundenBestaetigen:
            return await stundenBestaetigen(nachricht["id"] as? String)
        case UhrAktion.neuLaden:
            await speicher.laden()
            nachladenFallsNoetig(erzwingen: true)
            letzterStand = nil
            senden()
            return true
        default:
            return false
        }
    }

    /// Fahrtschritt wie in der App: "done" ueber FahrtDetails.beenden (wie CarPlay und die Fahrtansicht),
    /// "at_pickup"/"in_progress" wie transitionJobStatus der Web-App (Status setzen, RLS prueft den Fahrer).
    private func schritt(_ id: UUID, ziel: String) async -> Bool {
        guard let fahrer = Geteilt.anmeldung.fahrerID else { return false }
        if ziel == "done" {
            let autor = [Geteilt.anmeldung.profil?.firstName, Geteilt.anmeldung.profil?.lastName]
                .compactMap { $0 }.joined(separator: " ")
            return await FahrtDetails(fahrtID: id, fahrerID: fahrer).beenden(notiz: "", autor: autor)
        }
        guard ["at_pickup", "in_progress"].contains(ziel) else { return false }
        struct Status: Encodable { let status: String }
        struct IDZeile: Decodable { let id: UUID }
        let zeilen: [IDZeile] = (try? await Backend.client.from("jobs").update(Status(status: ziel))
            .eq("id", value: id).select("id").execute().value) ?? []
        return !zeilen.isEmpty
    }

    /// Bestaetigen wie in HeuteStundenKarte: Zeiten so wie gezeigt, nicht angepasst.
    private func stundenBestaetigen(_ dienstID: String?) async -> Bool {
        await StundenSpeicher.shared.laden()
        guard let e = heuteEintrag(), dienstID == nil || e.dienst.id.uuidString == dienstID,
              let s0 = Stunden.heute(e), s0.fertig else { return false }
        let beginn = s0.start
        var ende = s0.ende ?? s0.start
        if ende <= beginn { ende = ende.addingTimeInterval(86400) }   // Nachtdienst
        do {
            try await Stunden.heuteSpeichern(e, beginn: beginn, ende: ende,
                                             pausen: s0.pausen.map { ($0.von, $0.bis ?? s0.ende ?? $0.von) },
                                             angepasst: false, begruendung: nil)
            await StundenSpeicher.shared.laden()
            return true
        } catch {
            return false
        }
    }
}

extension UhrBruecke: WCSessionDelegate {
    nonisolated func session(_ session: WCSession, activationDidCompleteWith state: WCSessionActivationState, error: Error?) {
        Task { @MainActor in self.letzterStand = nil; self.senden(); self.nachladenFallsNoetig() }
    }

    nonisolated func sessionDidBecomeInactive(_ session: WCSession) {}

    nonisolated func sessionDidDeactivate(_ session: WCSession) {
        session.activate()
    }

    nonisolated func sessionWatchStateDidChange(_ session: WCSession) {
        Task { @MainActor in self.letzterStand = nil; self.letzteKomplikation = ""; self.senden(); self.nachladenFallsNoetig() }
    }

    nonisolated func session(_ session: WCSession, didReceiveMessage message: [String: Any],
                             replyHandler: @escaping ([String: Any]) -> Void) {
        let kopie = message.compactMapValues { $0 as? AnyHashable }
        Task { @MainActor in
            // Die Uhr weckt die App im Hintergrund: Zeit anfordern, sonst bricht die Anfrage ab.
            var hintergrund = UIBackgroundTaskIdentifier.invalid
            hintergrund = UIApplication.shared.beginBackgroundTask(withName: "uhr") {
                UIApplication.shared.endBackgroundTask(hintergrund)
                hintergrund = .invalid
            }
            let ok = await self.ausfuehren(kopie)
            replyHandler(["ok": ok])
            self.senden()
            if hintergrund != .invalid { UIApplication.shared.endBackgroundTask(hintergrund) }
        }
    }
}
