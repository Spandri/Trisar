import CarPlay
import Combine
import UIKit

/// CarPlay-Oberflaeche der Dispo-App (Kategorie Driving Task, nur Apple-Vorlagen), wie die
/// Fahrer-CarPlay (ios-fahrer/TrisarFahrer/CarPlay/CarPlaySzene.swift). Drei Reiter:
///   Achtung – was jetzt Handeln braucht: Fahrt ohne Fahrer in der naechsten Stunde, Fahrer zu spaet,
///             Fahrer im Dienst ohne Signal, Fahrt angefragt und noch nicht angenommen.
///   Fahrer  – Standbys mit Zaehlung, darunter die Fahrer im Dienst mit Zustand und naechster Fahrt.
///             Tipp: Fahrzeug, aktuelle und naechste Fahrt, Ankunft, Navigation zum Fahrer.
///   Fahrten – die naechsten Fahrten von heute. Tipp: Abholung, Ziel, Gast, Fahrer, Status,
///             Navigation zur Abholung.
/// Kommt eine neue Warnung dazu, zeigt CarPlay sie sofort als Hinweis.
/// Daten aus denselben Speichern wie Handy und Apple Watch (DispoUhrBruecke.karte,
/// DispoFahrtenSpeicher.gemeinsam, DispoStandbySpeicher.gemeinsam) mit deren Realtime.
/// Laeuft auf dem Geraet erst, wenn de.trisar.dispo die Freigabe carplay-driving-task hat,
/// im Simulator ueber TrisarDispo-Simulator.entitlements.
@MainActor
final class DispoCarPlaySzene: UIResponder, CPTemplateApplicationSceneDelegate {
    private var steuerung: CPInterfaceController?
    private var szene: CPTemplateApplicationScene?
    private var reiter: CPTabBarTemplate?
    private let achtungListe = CPListTemplate(title: "Achtung", sections: [])
    private let fahrerListe = CPListTemplate(title: "Fahrer", sections: [])
    private let fahrtenListe = CPListTemplate(title: "Fahrten", sections: [])
    private var abos: Set<AnyCancellable> = []
    private var takt: Timer?
    private var stand = DispoCarPlayStand.leer
    /// Warnungen, die beim Verbinden schon da waren oder fuer die der Hinweis schon kam.
    private var bekannt: Set<String> = []
    private var ersterStand = true

    func templateApplicationScene(_ templateApplicationScene: CPTemplateApplicationScene,
                                  didConnect interfaceController: CPInterfaceController) {
        steuerung = interfaceController
        szene = templateApplicationScene
        achtungListe.tabImage = UIImage(systemName: "exclamationmark.triangle")
        achtungListe.emptyViewTitleVariants = ["Alles im Plan"]
        achtungListe.emptyViewSubtitleVariants = ["Neue Warnungen erscheinen hier von selbst."]
        fahrerListe.tabImage = UIImage(systemName: "person.2")
        fahrerListe.emptyViewTitleVariants = ["Kein Fahrer im Dienst"]
        fahrtenListe.tabImage = UIImage(systemName: "car")
        fahrtenListe.emptyViewTitleVariants = ["Keine Fahrten mehr heute"]
        let reiter = CPTabBarTemplate(templates: [achtungListe, fahrerListe, fahrtenListe])
        self.reiter = reiter
        interfaceController.setRootTemplate(reiter, animated: false, completion: nil)

        #if DEBUG
        if Self.beispielLauf {
            stand = Self.beispielStand
            fuellen()
            beispielDurchlauf()
            return
        }
        #endif

        let bruecke = DispoUhrBruecke.shared
        bruecke.carPlayVerbunden(true)
        Publishers.CombineLatest3(bruecke.karte.$fahrer, DispoFahrtenSpeicher.gemeinsam.$fahrten,
                                  DispoStandbySpeicher.gemeinsam.$liste)
            .debounce(for: .seconds(1), scheduler: RunLoop.main)
            .sink { [weak self] _ in self?.neuerStand() }
            .store(in: &abos)
        // Anmeldung pruefen (CarPlay kann die App starten, ohne dass das Handy-Fenster aufgeht),
        // dann jede Minute neu bewerten (Fahrt in der naechsten Stunde, Signal).
        Task { await anmeldungPruefen() }
        takt = Timer.scheduledTimer(withTimeInterval: 60, repeats: true) { [weak self] _ in
            Task { @MainActor in
                await self?.anmeldungPruefen()
                self?.neuerStand()
            }
        }
        fuellen()
    }

    func templateApplicationScene(_ templateApplicationScene: CPTemplateApplicationScene,
                                  didDisconnectInterfaceController interfaceController: CPInterfaceController) {
        DispoUhrBruecke.shared.carPlayVerbunden(false)
        abos.removeAll()
        takt?.invalidate()
        takt = nil
        steuerung = nil
        szene = nil
        reiter = nil
    }

    /// Ohne Handy-Fenster meldet niemand die Anmeldung an die Bruecke, deshalb selbst nachsehen.
    private func anmeldungPruefen() async {
        let bruecke = DispoUhrBruecke.shared
        if let sitzung = try? await Backend.client.auth.session, !sitzung.isExpired {
            if !bruecke.angemeldet, await DispoZugang.erlaubt(sitzung) {
                bruecke.setzeAngemeldet(true)
                bruecke.carPlayVerbunden(true)
                DispoFahrtenSpeicher.gemeinsam.starten()
            }
            if DispoStandbySpeicher.gemeinsam.liste == nil { await DispoStandbySpeicher.gemeinsam.starten() }
        }
        neuerStand()
    }

    private func neuerStand() {
        stand = DispoCarPlayStand.bauen()
        fuellen()
        neuesMelden()
    }

    // MARK: Listen

    private func fuellen() {
        guard stand.angemeldet else {
            let hinweis = [CPListSection(items: [CPListItem(text: "Bitte in TRISAR Dispo auf dem iPhone anmelden.", detailText: nil)])]
            achtungListe.updateSections(hinweis)
            fahrerListe.updateSections(hinweis)
            fahrtenListe.updateSections(hinweis)
            return
        }
        achtungFuellen()
        fahrerFuellen()
        fahrtenFuellen()
    }

    private func achtungFuellen() {
        let zeilen = stand.warnungen.prefix(CPListTemplate.maximumItemCount).map { w -> CPListItem in
            let z = CPListItem(text: w.titel, detailText: w.detail, image: DispoCarPlayBild.zeichen(w.art.symbol))
            if w.fahrtID != nil || w.fahrerID != nil {
                z.accessoryType = .disclosureIndicator
                z.handler = { [weak self] _, fertig in
                    if let f = w.fahrtID { self?.fahrtZeigen(f) } else if let f = w.fahrerID { self?.fahrerZeigen(f) }
                    fertig()
                }
            }
            return z
        }
        achtungListe.updateSections(zeilen.isEmpty ? [] : [CPListSection(items: Array(zeilen), header: "Jetzt", headerSubtitle: nil,
                                                                          headerImage: DispoCarPlayBild.logo, headerButton: nil, sectionIndexTitle: nil)])
        // Zahl der Warnungen am Reiter.
        achtungListe.tabTitle = stand.warnungen.isEmpty ? "Achtung" : "Achtung \(stand.warnungen.count)"
        reiter?.updateTemplates([achtungListe, fahrerListe, fahrtenListe])
    }

    private func fahrerFuellen() {
        var abschnitte: [CPListSection] = []
        var platz = CPListTemplate.maximumItemCount
        if !stand.standbys.isEmpty {
            let zeilen = stand.standbys.prefix(4).map { s in
                CPListItem(text: "Standby \(s.ort)", detailText: s.zaehlung, image: DispoCarPlayBild.zeichen("mappin.and.ellipse"))
            }
            platz -= zeilen.count
            abschnitte.append(CPListSection(items: Array(zeilen), header: "Standby", sectionIndexTitle: nil))
        }
        let fahrer = stand.fahrer.prefix(max(0, platz)).map { f -> CPListItem in
            let z = CPListItem(text: f.name, detailText: f.zeile, image: DispoCarPlayBild.punkt(f.farbe))
            z.accessoryType = .disclosureIndicator
            z.handler = { [weak self] _, fertig in self?.fahrerZeigen(f.id); fertig() }
            return z
        }
        if !fahrer.isEmpty {
            abschnitte.append(CPListSection(items: Array(fahrer), header: "Im Dienst", sectionIndexTitle: nil))
        }
        fahrerListe.updateSections(abschnitte)
    }

    private func fahrtenFuellen() {
        let zeilen = stand.fahrten.prefix(CPListTemplate.maximumItemCount).map { f -> CPListItem in
            let wer = f.fahrer.isEmpty ? "ohne Fahrer" : f.fahrer
            let z = CPListItem(text: f.von, detailText: "\(f.status) · \(wer) · nach \(f.nach)",
                               image: DispoCarPlayBild.zeit(f.zeit, gefuellt: !f.fahrer.isEmpty))
            z.accessoryType = .disclosureIndicator
            z.handler = { [weak self] _, fertig in self?.fahrtZeigen(f.id); fertig() }
            return z
        }
        fahrtenListe.updateSections(zeilen.isEmpty ? [] : [CPListSection(items: Array(zeilen), header: "Heute", headerSubtitle: nil,
                                                                          headerImage: DispoCarPlayBild.logo, headerButton: nil, sectionIndexTitle: nil)])
    }

    // MARK: Einzelansichten

    private func zeigen(_ vorlage: CPTemplate) {
        guard let steuerung else { return }
        // Liegt schon eine Ansicht oben, ersetzen statt stapeln.
        if steuerung.templates.count > 1 {
            steuerung.popToRootTemplate(animated: false) { _, _ in steuerung.pushTemplate(vorlage, animated: true, completion: nil) }
        } else {
            steuerung.pushTemplate(vorlage, animated: true, completion: nil)
        }
    }

    private func fahrerZeigen(_ id: String) {
        guard let f = stand.fahrer.first(where: { $0.id == id }) ?? stand.alleFahrer.first(where: { $0.id == id }) else { return }
        var punkte = [CPInformationItem(title: "Zustand", detail: f.status)]
        if !f.fahrzeug.isEmpty { punkte.append(CPInformationItem(title: "Fahrzeug", detail: f.fahrzeug)) }
        if let a = f.aktuell { punkte.append(CPInformationItem(title: "Aktuelle Fahrt", detail: a)) }
        if let n = f.naechste { punkte.append(CPInformationItem(title: "Nächste Fahrt", detail: n)) }
        if let a = f.ankunft { punkte.append(CPInformationItem(title: "Ankunft", detail: a)) }
        if let d = f.dienst { punkte.append(CPInformationItem(title: "Dienst", detail: d)) }
        punkte.append(CPInformationItem(title: "Signal", detail: f.signal))
        var knoepfe: [CPTextButton] = []
        if f.lat != 0 || f.lng != 0 {
            knoepfe.append(CPTextButton(title: "Navigation zum Fahrer", textStyle: .confirm) { [weak self] _ in
                self?.navigieren("\(f.lat),\(f.lng)")
            })
        }
        zeigen(CPInformationTemplate(title: f.name, layout: .leading, items: punkte, actions: knoepfe))
    }

    private func fahrtZeigen(_ id: String) {
        guard let f = stand.fahrten.first(where: { $0.id == id }) ?? stand.alleFahrten.first(where: { $0.id == id }) else { return }
        var punkte = [
            CPInformationItem(title: "Abholung", detail: f.von),
            CPInformationItem(title: "Ziel", detail: f.nach),
        ]
        if !f.gast.isEmpty { punkte.append(CPInformationItem(title: "Gast", detail: f.gast)) }
        punkte.append(CPInformationItem(title: "Fahrer", detail: f.fahrer.isEmpty ? "Ohne Fahrer" : f.fahrer))
        punkte.append(CPInformationItem(title: "Status", detail: f.status + (f.verspaetet ? " · verspätet" : "")))
        if let a = f.ankunft { punkte.append(CPInformationItem(title: "Ankunft", detail: a)) }
        let knoepfe = [CPTextButton(title: "Navigation zur Abholung", textStyle: .confirm) { [weak self] _ in self?.navigieren(f.von) }]
        zeigen(CPInformationTemplate(title: "\(f.zeit) · \(f.status)", layout: .leading, items: punkte, actions: knoepfe))
    }

    /// Apple Karten mit Ziel (Adresse oder "lat,lng").
    private func navigieren(_ ziel: String) {
        guard !ziel.isEmpty else { return }
        var teile = URLComponents(string: "maps://")!
        teile.queryItems = [.init(name: "daddr", value: ziel), .init(name: "dirflg", value: "d")]
        guard let url = teile.url else { return }
        szene?.open(url, options: nil, completionHandler: nil)
    }

    // MARK: Neue Warnung

    private func neuesMelden() {
        defer { bekannt.formUnion(stand.warnungen.map(\.id)) }
        // Der erste geladene Stand steht schon in der Liste, dafuer kein Hinweis.
        if ersterStand {
            if stand.angemeldet && !DispoFahrtenSpeicher.gemeinsam.fahrten.isEmpty { ersterStand = false }
            return
        }
        guard let neu = stand.warnungen.first(where: { !bekannt.contains($0.id) }) else { return }
        hinweis(neu)
    }

    private func hinweis(_ w: DispoCarPlayWarnung) {
        guard let steuerung, steuerung.presentedTemplate == nil else { return }
        var aktionen: [CPAlertAction] = []
        if w.fahrtID != nil || w.fahrerID != nil {
            aktionen.append(CPAlertAction(title: "Ansehen", style: .default) { [weak self] _ in
                self?.steuerung?.dismissTemplate(animated: true, completion: nil)
                if let f = w.fahrtID { self?.fahrtZeigen(f) } else if let f = w.fahrerID { self?.fahrerZeigen(f) }
            })
        }
        aktionen.append(CPAlertAction(title: "OK", style: .cancel) { [weak self] _ in
            self?.steuerung?.dismissTemplate(animated: true, completion: nil)
        })
        steuerung.presentTemplate(CPAlertTemplate(titleVariants: ["\(w.titel): \(w.detail)", w.titel], actions: aktionen),
                                  animated: true, completion: nil)
    }

    // MARK: Beispiel (nur Debug, Startargument -carplayBeispiel)

    #if DEBUG
    static let beispielLauf = ProcessInfo.processInfo.arguments.contains("-carplayBeispiel")

    static let beispielStand: DispoCarPlayStand = {
        let fahrer = [
            DispoCarPlayFahrer(id: "f1", name: "Stefano Spandri", status: "Mit Gast", farbe: .aktiv, zeile: "Mit Gast · an 17:55 · M-TR 101",
                               fahrzeug: "Mercedes V-Klasse · M-TR 101", aktuell: "17:24 Diedorf nach Kongress am Park", naechste: "19:05 Flughafen T2",
                               ankunft: "17:55", dienst: "08:00–18:00", signal: "Letztes Signal 17:31", lat: 48.36, lng: 10.89),
            DispoCarPlayFahrer(id: "f2", name: "Finn Weber", status: "Zur Abholung", farbe: .aktiv, zeile: "Zur Abholung · 18:10 · M-TR 102",
                               fahrzeug: "Mercedes E-Klasse · M-TR 102", aktuell: "18:10 Maximilianstr. nach Kongress", naechste: nil,
                               ankunft: "18:35", dienst: "12:00–22:00", signal: "Letztes Signal 17:30", lat: 48.37, lng: 10.90),
            DispoCarPlayFahrer(id: "f3", name: "Gregor Lang", status: "Standby vor Ort", farbe: .inaktiv, zeile: "Standby vor Ort · nächste 20:30",
                               fahrzeug: "Mercedes V-Klasse · M-TR 103", aktuell: nil, naechste: "20:30 Hotel Maximilian's",
                               ankunft: nil, dienst: "14:00–23:00", signal: "Letztes Signal 17:31", lat: 48.35, lng: 10.88),
            DispoCarPlayFahrer(id: "f4", name: "Marvin Koch", status: "Ohne Fahrt", farbe: .inaktiv, zeile: "Ohne Signal seit 17:02",
                               fahrzeug: "BMW 5er · M-TR 104", aktuell: nil, naechste: nil,
                               ankunft: nil, dienst: "10:00–19:00", signal: "Letztes Signal 17:02", lat: 0, lng: 0),
        ]
        let fahrten = [
            DispoCarPlayFahrt(id: "j1", zeit: "18:10", von: "Maximilianstr. 40, Augsburg", nach: "Kongress am Park", fahrer: "Finn Weber",
                              gast: "Familie Brandt", status: "Offen", verspaetet: false, ankunft: "18:35"),
            DispoCarPlayFahrt(id: "j2", zeit: "18:30", von: "Hauptbahnhof Augsburg", nach: "Hotel Maximilian's", fahrer: "",
                              gast: "Dr. Anna Weber", status: "Offen", verspaetet: false, ankunft: "18:45"),
            DispoCarPlayFahrt(id: "j3", zeit: "19:05", von: "Flughafen München, Terminal 2", nach: "Kongress am Park", fahrer: "Stefano Spandri",
                              gast: "LH 2471 · Herr Kaiser", status: "Offen", verspaetet: true, ankunft: "20:10"),
            DispoCarPlayFahrt(id: "j4", zeit: "20:30", von: "Hotel Maximilian's", nach: "Flughafen München, Terminal 1", fahrer: "Gregor Lang",
                              gast: "Frau Ilic", status: "Offen", verspaetet: false, ankunft: "21:30"),
        ]
        let warnungen = [
            DispoCarPlayWarnung(id: "w1", art: .ohneFahrer, titel: "Ohne Fahrer 18:30", detail: "Hauptbahnhof Augsburg nach Hotel Maximilian's", fahrtID: "j2", fahrerID: nil),
            DispoCarPlayWarnung(id: "w2", art: .zuSpaet, titel: "Zu spät 19:05", detail: "Stefano Spandri zum Flughafen München", fahrtID: "j3", fahrerID: nil),
            DispoCarPlayWarnung(id: "w3", art: .ohneSignal, titel: "Ohne Signal", detail: "Marvin Koch seit 17:02", fahrtID: nil, fahrerID: "f4"),
            DispoCarPlayWarnung(id: "w4", art: .antwortOffen, titel: "Antwort offen 20:30", detail: "Gregor Lang hat noch nicht angenommen", fahrtID: "j4", fahrerID: nil),
        ]
        return DispoCarPlayStand(angemeldet: true, warnungen: warnungen, fahrer: fahrer, alleFahrer: fahrer, fahrten: fahrten, alleFahrten: fahrten,
                                 standbys: [DispoCarPlayStandby(ort: "Kongress am Park", zaehlung: "2 vor Ort · 1 mit Gast · 1 Rückweg")])
    }()

    /// Zeigt nacheinander die Reiter, eine Fahrt, einen Fahrer und den Hinweis auf eine neue Warnung.
    private func beispielDurchlauf() {
        Task {
            while steuerung != nil {
                try? await Task.sleep(for: .seconds(6))
                reiter?.select(fahrerListe)
                try? await Task.sleep(for: .seconds(6))
                fahrerZeigen("f1")
                try? await Task.sleep(for: .seconds(6))
                steuerung?.popToRootTemplate(animated: false, completion: nil)
                reiter?.select(fahrtenListe)
                try? await Task.sleep(for: .seconds(6))
                fahrtZeigen("j3")
                try? await Task.sleep(for: .seconds(6))
                steuerung?.popToRootTemplate(animated: false, completion: nil)
                reiter?.select(achtungListe)
                hinweis(Self.beispielStand.warnungen[0])
                try? await Task.sleep(for: .seconds(6))
                steuerung?.dismissTemplate(animated: false, completion: nil)
            }
        }
    }
    #endif
}

// MARK: Stand fuer CarPlay

enum DispoCarPlayWarnArt {
    case ohneFahrer, zuSpaet, ohneSignal, antwortOffen
    var symbol: String {
        switch self {
        case .ohneFahrer: return "person.crop.circle.badge.questionmark"
        case .zuSpaet: return "clock.badge.exclamationmark"
        case .ohneSignal: return "antenna.radiowaves.left.and.right.slash"
        case .antwortOffen: return "hourglass"
        }
    }
}

struct DispoCarPlayWarnung {
    let id: String
    let art: DispoCarPlayWarnArt
    let titel: String
    let detail: String
    let fahrtID: String?
    let fahrerID: String?
}

struct DispoCarPlayFahrer {
    let id: String
    let name: String
    let status: String
    let farbe: FahrerZustand
    let zeile: String
    let fahrzeug: String
    let aktuell: String?
    let naechste: String?
    let ankunft: String?
    let dienst: String?
    let signal: String
    let lat: Double
    let lng: Double
}

struct DispoCarPlayFahrt {
    let id: String
    let zeit: String
    let von: String
    let nach: String
    let fahrer: String
    let gast: String
    let status: String
    let verspaetet: Bool
    let ankunft: String?
}

struct DispoCarPlayStandby {
    let ort: String
    let zaehlung: String
}

struct DispoCarPlayStand {
    var angemeldet: Bool
    var warnungen: [DispoCarPlayWarnung]
    /// Fahrer im Dienst (aktiv vor inaktiv).
    var fahrer: [DispoCarPlayFahrer]
    /// Alle Fahrer, damit eine Warnung auch einen Fahrer ausserhalb der Liste oeffnen kann.
    var alleFahrer: [DispoCarPlayFahrer]
    /// Die naechsten Fahrten von heute.
    var fahrten: [DispoCarPlayFahrt]
    var alleFahrten: [DispoCarPlayFahrt]
    var standbys: [DispoCarPlayStandby]

    static let leer = DispoCarPlayStand(angemeldet: false, warnungen: [], fahrer: [], alleFahrer: [], fahrten: [], alleFahrten: [], standbys: [])

    private static func minuten(_ hhmm: String) -> Int? {
        let t = hhmm.prefix(5).split(separator: ":").compactMap { Int($0) }
        return t.count == 2 ? t[0] * 60 + t[1] : nil
    }

    private static func zeit(_ wert: String) -> String? {
        let z = String(wert.prefix(5))
        return z.isEmpty || z == "--:--" ? nil : z
    }

    private static func beendet(_ jobStatus: String) -> Bool {
        ["done", "completed", "arrived", "beendet", "archived", "cancelled", "canceled", "storniert"].contains(jobStatus.lowercased())
    }

    private static func statusText(_ jobStatus: String) -> String {
        switch jobStatus.lowercased() {
        case "in_progress", "unterwegs", "started", "on_trip", "ongoing", "active": return "Unterwegs"
        case "at_pickup", "pickup", "beim_pickup", "beim pickup": return "Beim Gast"
        case "done", "completed", "arrived", "beendet": return "Beendet"
        default: return "Offen"
        }
    }

    /// Aus den Speichern von Handy und Apple Watch.
    @MainActor static func bauen() -> DispoCarPlayStand {
        let bruecke = DispoUhrBruecke.shared
        guard bruecke.angemeldet else { return .leer }
        let heute = Stunden.heuteDatum
        let jetzt = Calendar.current.dateComponents([.hour, .minute], from: Date())
        let jetztMin = (jetzt.hour ?? 0) * 60 + (jetzt.minute ?? 0)

        // Fahrten von heute, offen, nach Zeit.
        let heuteFahrten = DispoFahrtenSpeicher.gemeinsam.fahrten
            .filter { !$0.archiviert && $0.datum == heute && !beendet($0.jobStatus) }
            .sorted { $0.startZeit < $1.startZeit }
        func fahrt(_ f: DispoFahrt) -> DispoCarPlayFahrt {
            let z = f.zeiten
            let ankunft = (f.verspaetet ? [z.ankunftNeu, z.ankunftZeit, z.ankunftOriginal] : [z.ankunftZeit, z.ankunftNeu, z.ankunftOriginal])
                .compactMap(zeit).first
            return DispoCarPlayFahrt(id: f.id, zeit: String(f.startZeit.prefix(5)), von: f.startOrt, nach: f.zielOrt,
                                     fahrer: f.ohneFahrerVariante ? "" : f.fahrer, gast: f.name, status: statusText(f.jobStatus),
                                     verspaetet: f.zuSpaet, ankunft: ankunft)
        }
        let alleFahrten = heuteFahrten.map(fahrt)
        // Naechste: laufende und alles ab einer halben Stunde vor jetzt.
        let naechste = heuteFahrten.filter { f in
            let laeuft = ["Unterwegs", "Beim Gast"].contains(statusText(f.jobStatus))
            return laeuft || (minuten(f.startZeit) ?? 0) >= jetztMin - 30
        }.map(fahrt)

        // Standby-Zustaende je Fahrer (laufende Standbys, angenommen).
        let standbys = (DispoStandbySpeicher.gemeinsam.liste ?? []).filter(\.aktuell)
        var standbyZustand: [String: String] = [:]
        for s in standbys {
            for f in s.fahrer where f.status == "accepted" {
                let text: String? = switch f.zustand {
                case "vor_ort": "Standby vor Ort"
                case "mit_gast": "Standby mit Gast"
                case "rueckweg": "Standby Rückweg" + (f.rueckAnkunft.map { " · an " + uhr($0) } ?? "")
                default: nil
                }
                if let text { standbyZustand[f.driverID.uuidString.lowercased()] = text }
            }
        }
        let standbyZeilen = standbys.map { s -> DispoCarPlayStandby in
            let zaehlen = { (z: String) in s.fahrer.filter { $0.status == "accepted" && $0.zustand == z }.count }
            var teile: [String] = []
            if zaehlen("vor_ort") > 0 { teile.append("\(zaehlen("vor_ort")) vor Ort") }
            if zaehlen("mit_gast") > 0 { teile.append("\(zaehlen("mit_gast")) mit Gast") }
            if zaehlen("rueckweg") > 0 { teile.append("\(zaehlen("rueckweg")) Rückweg") }
            let angefragt = s.fahrer.filter { $0.status == "pending" }.count
            if angefragt > 0 { teile.append("\(angefragt) angefragt") }
            return DispoCarPlayStandby(ort: s.ortName, zaehlung: "\(s.von)–\(s.bis)" + (teile.isEmpty ? "" : " · " + teile.joined(separator: " · ")))
        }

        // Fahrer: aktiv (laufende Fahrt) vor inaktiv (im Dienst ohne Fahrt), frei = nicht im Dienst.
        func fahrer(_ k: KartenFahrer) -> DispoCarPlayFahrer {
            let laufend = k.fahrt.map { statusText($0.status) }
            var status: String
            switch k.zustand {
            case .aktiv: status = laufend == "Unterwegs" ? "Mit Gast" : (laufend == "Beim Gast" ? "Beim Gast" : "Zur Abholung")
            case .inaktiv: status = "Ohne Fahrt"
            case .frei: status = "Nicht im Dienst"
            }
            if let sb = standbyZustand[k.id.lowercased()] { status = sb }
            let ankunft = zeit(k.info.ankunft)
            let strecke = k.info.hatFahrt ? "\(k.info.von.name) nach \(k.info.nach.name)" : nil
            let abfahrt = zeit(k.info.abfahrt)
            let aktuell = k.zustand == .aktiv ? strecke.map { (abfahrt.map { $0 + " " } ?? "") + $0 } : nil
            // Naechste Fahrt aus der Fahrtenliste (nach der laufenden).
            let meine = heuteFahrten.filter { $0.fahrerIds.map { $0.lowercased() }.contains(k.id.lowercased()) || $0.fahrer.contains(k.name) }
            let kommende = meine.first { (minuten($0.startZeit) ?? 0) > jetztMin && statusText($0.jobStatus) == "Offen" && $0.id != k.fahrt?.id }
            let naechste = kommende.map { "\(String($0.startZeit.prefix(5))) \($0.startOrt)" } ?? (k.zustand != .aktiv ? strecke.map { (abfahrt.map { $0 + " " } ?? "") + $0 } : nil)
            var zeile = status
            if k.offline && k.zustand != .frei { zeile = "Ohne Signal · " + k.signalText.replacingOccurrences(of: "Letztes Signal ", with: "seit ") }
            else if let a = ankunft, k.zustand == .aktiv { zeile += " · an \(a)" }
            else if let n = kommende { zeile += " · nächste \(String(n.startZeit.prefix(5)))" }
            if !k.kennzeichen.isEmpty { zeile += " · \(k.kennzeichen)" }
            let dienst = [zeit(k.info.dienststart), zeit(k.info.dienstende)].compactMap { $0 }.joined(separator: "–")
            return DispoCarPlayFahrer(id: k.id, name: k.name, status: status, farbe: k.zustand, zeile: zeile,
                                      fahrzeug: [k.fahrzeug, k.kennzeichen].filter { !$0.isEmpty }.joined(separator: " · "),
                                      aktuell: aktuell, naechste: naechste, ankunft: k.zustand == .aktiv ? ankunft : nil,
                                      dienst: dienst.isEmpty ? nil : dienst, signal: k.signalText, lat: k.lat, lng: k.lng)
        }
        let karte = bruecke.karte.fahrer
        let imDienst = karte.filter { $0.zustand != .frei }
            .sorted { ($0.zustand == .aktiv ? 0 : 1, $0.name) < ($1.zustand == .aktiv ? 0 : 1, $1.name) }
            .map(fahrer)

        // Warnungen (wie push_dispo_warnungen und die Hinweise der App).
        var warnungen: [DispoCarPlayWarnung] = []
        for f in heuteFahrten where f.ohneFahrerVariante {
            guard let m = minuten(f.startZeit), m >= jetztMin - 30, m <= jetztMin + 60 else { continue }
            warnungen.append(DispoCarPlayWarnung(id: "ohne-\(f.id)", art: .ohneFahrer, titel: "Ohne Fahrer \(String(f.startZeit.prefix(5)))",
                                                 detail: "\(f.startOrt) nach \(f.zielOrt)", fahrtID: f.id, fahrerID: nil))
        }
        // Start Zeitraum: zu spaet erst nach dem Ende des Zeitraums (zuSpaet statt verspaetet).
        for f in heuteFahrten where f.zuSpaet && !f.ohneFahrerVariante {
            warnungen.append(DispoCarPlayWarnung(id: "spaet-\(f.id)", art: .zuSpaet, titel: "Zu spät \(String(f.startZeit.prefix(5)))",
                                                 detail: "\(f.fahrer) zu \(f.startOrt)", fahrtID: f.id, fahrerID: nil))
        }
        for k in karte where k.offline && k.zustand != .frei {
            warnungen.append(DispoCarPlayWarnung(id: "signal-\(k.id)", art: .ohneSignal, titel: "Ohne Signal",
                                                 detail: "\(k.name) · " + k.signalText.replacingOccurrences(of: "Letztes Signal ", with: "seit "),
                                                 fahrtID: nil, fahrerID: k.id))
        }
        for f in heuteFahrten where !f.ohneFahrerVariante && !f.bestaetigt && statusText(f.jobStatus) == "Offen" {
            guard let m = minuten(f.startZeit), m >= jetztMin - 30, m <= jetztMin + 180 else { continue }
            warnungen.append(DispoCarPlayWarnung(id: "antwort-\(f.id)", art: .antwortOffen, titel: "Antwort offen \(String(f.startZeit.prefix(5)))",
                                                 detail: "\(f.fahrer) hat noch nicht angenommen", fahrtID: f.id, fahrerID: nil))
        }

        return DispoCarPlayStand(angemeldet: true, warnungen: warnungen, fahrer: imDienst, alleFahrer: karte.map(fahrer),
                                 fahrten: naechste, alleFahrten: alleFahrten, standbys: standbyZeilen)
    }

    private static func uhr(_ d: Date) -> String {
        let f = DateFormatter()
        f.dateFormat = "HH:mm"
        return f.string(from: d)
    }
}

/// Bilder im TRISAR-Look (wie CarPlayBild der Fahrer-App): CarPlay legt Farben und Schrift der
/// Vorlagen fest, zeigt eigene Bilder aber unveraendert.
enum DispoCarPlayBild {
    static let lime = UIColor(red: 0xE3 / 255, green: 0xF6 / 255, blue: 0x54 / 255, alpha: 1)
    static let rot = UIColor(red: 0xFF / 255, green: 0x6F / 255, blue: 0x63 / 255, alpha: 1)
    static let gruen = UIColor(red: 0x59 / 255, green: 0xBE / 255, blue: 0x80 / 255, alpha: 1)
    static let dunkel = UIColor(red: 0x1D / 255, green: 0x1C / 255, blue: 0x1D / 255, alpha: 1)

    /// TRISAR-Schriftzug in Lime fuer den Listenkopf.
    static var logo: UIImage? {
        guard let vorlage = UIImage(named: "TrisarLogo")?.withRenderingMode(.alwaysTemplate) else { return nil }
        let hoehe: CGFloat = 16
        let groesse = CGSize(width: hoehe * vorlage.size.width / max(vorlage.size.height, 1), height: hoehe)
        return UIGraphicsImageRenderer(size: groesse).image { _ in
            lime.set()
            vorlage.draw(in: CGRect(origin: .zero, size: groesse))
        }.withRenderingMode(.alwaysOriginal)
    }

    static func zeichen(_ name: String) -> UIImage? {
        UIImage(systemName: name, withConfiguration: UIImage.SymbolConfiguration(weight: .semibold))
    }

    /// Farbiger Punkt wie die Fahrer-Pins der Karte: Rot aktiv, Lime im Dienst ohne Fahrt, Gruen frei.
    static func punkt(_ zustand: FahrerZustand) -> UIImage {
        let farbe = zustand == .aktiv ? rot : (zustand == .inaktiv ? lime : gruen)
        let groesse = CPListItem.maximumImageSize
        return UIGraphicsImageRenderer(size: groesse).image { _ in
            let d = groesse.height * 0.42
            farbe.setFill()
            UIBezierPath(ovalIn: CGRect(x: (groesse.width - d) / 2, y: (groesse.height - d) / 2, width: d, height: d)).fill()
        }.withRenderingMode(.alwaysOriginal)
    }

    /// Abholzeit als Lime-Plakette: gefuellt = mit Fahrer, nur Rand = ohne Fahrer.
    static func zeit(_ text: String, gefuellt: Bool) -> UIImage {
        let groesse = CPListItem.maximumImageSize
        let schrift = UIFont(name: "SpaceGrotesk-Bold", size: groesse.height * 0.3)
            ?? UIFont(name: "Space Grotesk", size: groesse.height * 0.3)
            ?? .systemFont(ofSize: groesse.height * 0.3, weight: .bold)
        return UIGraphicsImageRenderer(size: groesse).image { _ in
            let flaeche = CGRect(origin: .zero, size: groesse).insetBy(dx: 1.5, dy: 1.5)
            let form = UIBezierPath(roundedRect: flaeche, cornerRadius: groesse.height * 0.24)
            if gefuellt {
                lime.setFill()
                form.fill()
            } else {
                dunkel.setFill()
                form.fill()
                lime.setStroke()
                form.lineWidth = 2
                form.stroke()
            }
            let attribute: [NSAttributedString.Key: Any] = [.font: schrift, .foregroundColor: gefuellt ? dunkel : lime]
            let mass = (text as NSString).size(withAttributes: attribute)
            (text as NSString).draw(at: CGPoint(x: (groesse.width - mass.width) / 2, y: (groesse.height - mass.height) / 2),
                                    withAttributes: attribute)
        }
    }
}
