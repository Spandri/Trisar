import CarPlay
import Combine
import UIKit

/// Speicher, die Handy-Oberflaeche und CarPlay gemeinsam nutzen. CarPlay kann die App starten,
/// ohne dass das Handy-Fenster je aufgeht, deshalb haengen sie nicht an der SwiftUI-Szene.
@MainActor
enum Geteilt {
    static let anmeldung = Anmeldung()
    static let ortung = Ortung()
    static let fahrten = FahrtenSpeicher()
}

/// CarPlay-Oberflaeche der Fahrer-App (Kategorie Driving Task, nur Apple-Vorlagen).
/// Wie die Fahrtenliste der Fahrer-App:
///   Liste   – alle kommenden Fahrten untereinander nach Tag, vorne die Abholzeit als Lime-Plakette.
///             Unten der Dienst (Arbeitszeit, Stunden bestaetigen, Dienstanfragen).
///   Fahrt   – Tipp auf eine Fahrt: Abholung, Ziel, Gaeste, Flug, Notiz. Knoepfe:
///             offen -> Annehmen / Ablehnen, sonst der Schritt der dran ist und Navigation
///             (Apple Karten, Google Maps, Gast anrufen).
///   Hinweis – kommt eine neue Fahrt oder Dienstanfrage dazu, fragt CarPlay sofort: Annehmen / Spaeter.
/// Daten und Aktionen laufen ueber UhrBruecke, also genau wie auf der Apple Watch.
/// Farben und Schrift legt CarPlay fest, der TRISAR-Look steckt in den Bildern (Lime-Zeitplakette,
/// TRISAR-Schriftzug). Laeuft auf dem Geraet erst mit der Apple-Freigabe
/// com.apple.developer.carplay-driving-task, im Simulator ueber TrisarFahrer-Simulator.entitlements.
@MainActor
final class CarPlaySzene: UIResponder, CPTemplateApplicationSceneDelegate {
    private var steuerung: CPInterfaceController?
    private var szene: CPTemplateApplicationScene?
    private var liste: CPListTemplate?
    private var abos: Set<AnyCancellable> = []
    private var takt: Timer?
    private var stand: UhrStand = .leer
    /// Fahrten und Dienstanfragen, die beim Verbinden schon da waren oder fuer die der Hinweis schon kam.
    private var bekannt: Set<String> = []
    private var ersterStand = true

    func templateApplicationScene(_ templateApplicationScene: CPTemplateApplicationScene,
                                  didConnect interfaceController: CPInterfaceController) {
        steuerung = interfaceController
        szene = templateApplicationScene
        let vorlage = CPListTemplate(title: "TRISAR", sections: [])
        vorlage.emptyViewTitleVariants = ["Keine Fahrten"]
        vorlage.emptyViewSubtitleVariants = ["Neue Fahrten erscheinen hier von selbst."]
        liste = vorlage
        interfaceController.setRootTemplate(vorlage, animated: false, completion: nil)

        Geteilt.anmeldung.$zustand
            .receive(on: RunLoop.main)
            .sink { [weak self] _ in
                // Auch ohne offenes Handy-Fenster Fahrten laden und Standort senden.
                let id = Geteilt.anmeldung.fahrerID
                Geteilt.fahrten.setzeFahrer(id)
                Geteilt.ortung.setzeFahrer(id)
                self?.listeFuellen()
            }
            .store(in: &abos)
        UhrBruecke.shared.carPlayStand
            .receive(on: RunLoop.main)
            .sink { [weak self] neu in
                guard let self, !Self.beispielAktiv else { return }
                stand = neu
                listeFuellen()
                neuesMelden()
            }
            .store(in: &abos)
        // Countdown und laufende Arbeitszeit jede Minute neu.
        takt = Timer.scheduledTimer(withTimeInterval: 60, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.listeFuellen() }
        }

        #if DEBUG
        if Self.beispielLauf {
            stand = Self.beispielStand
            beispielDurchlauf()
        }
        #endif
        UhrBruecke.shared.carPlayVerbunden(true)
        Task { await Geteilt.fahrten.laden() }
        listeFuellen()
    }

    func templateApplicationScene(_ templateApplicationScene: CPTemplateApplicationScene,
                                  didDisconnectInterfaceController interfaceController: CPInterfaceController) {
        UhrBruecke.shared.carPlayVerbunden(false)
        abos.removeAll()
        takt?.invalidate()
        takt = nil
        steuerung = nil
        szene = nil
        liste = nil
    }

    private var angemeldet: Bool { Self.beispielAktiv || Geteilt.anmeldung.fahrerID != nil }

    // MARK: Liste

    private func listeFuellen() {
        guard let liste else { return }
        guard angemeldet else {
            liste.updateSections([CPListSection(items: [CPListItem(text: "Bitte am iPhone anmelden",
                                                                   detailText: "TRISAR auf dem iPhone öffnen und anmelden.")])])
            return
        }
        var abschnitte: [CPListSection] = []

        // Fahrten untereinander, nach Tag getrennt.
        let fahrten = Array(stand.fahrten.prefix(CPListTemplate.maximumItemCount - 4))
        for (nummer, tag) in Self.eindeutig(fahrten.map(\.tag)).enumerated() {
            let zeilen = fahrten.filter { $0.tag == tag }.map(fahrtZeile)
            // Ueber dem ersten Tag das Lime-Zeichen: Header-Bilder zeigt CarPlay in Originalfarbe.
            abschnitte.append(CPListSection(items: zeilen, header: Datum.tagEtikett(tag), headerSubtitle: nil,
                                            headerImage: nummer == 0 ? CarPlayBild.logo : nil, headerButton: nil, sectionIndexTitle: nil))
        }

        // Dienst: nur wenn es etwas zu zeigen gibt.
        var dienst: [CPListItem] = []
        if let h = stand.heute {
            let min = h.minuten()
            var detail = "seit " + Self.uhrzeit(h.start) + (h.pauseLaeuft() ? " · Pause läuft" : "")
            if h.fertig { detail = Self.zettelText(h.zettelStatus) ?? "Dienst beendet" }
            let z = CPListItem(text: "Arbeitszeit \(min / 60) h \(min % 60) min", detailText: detail, image: CarPlayBild.zeichen("clock"))
            if h.offen {
                z.accessoryType = .disclosureIndicator
                z.handler = { [weak self] _, fertig in self?.stundenFragen(h); fertig() }
            }
            dienst.append(z)
        }
        // Angenommener Dienst mit Treffpunkt (heute oder spaeter): "Dienststart 07:00 – Bayerischer Hof".
        // Antippen fuehrt wie bei einer Fahrt zur Navigation dorthin.
        let heute = Datum.tagWert(Date())
        for d in stand.dienste.filter({ !$0.offen && $0.treffpunkt != nil && $0.tag >= heute }).prefix(2) {
            let z = CPListItem(text: "Dienststart \(d.start ?? "--:--") – \(d.treffpunkt ?? "")",
                               detailText: ([Datum.tagEtikett(d.tag)] + [d.treffpunktNotiz].compactMap { $0 }).joined(separator: " · "),
                               image: CarPlayBild.zeichen("mappin.and.ellipse"))
            z.accessoryType = .disclosureIndicator
            z.handler = { [weak self] _, fertig in self?.treffpunktNavigation(d); fertig() }
            dienst.append(z)
        }
        for d in stand.dienste where d.offen {
            let zeit = [d.start, d.ende].compactMap { $0 }.joined(separator: "–")
            let z = CPListItem(text: "Dienstanfrage " + Datum.tagEtikett(d.tag), detailText: zeit.isEmpty ? "Antwort offen" : "\(zeit) · Antwort offen",
                               image: CarPlayBild.zeichen("calendar.badge.clock"))
            z.accessoryType = .disclosureIndicator
            z.handler = { [weak self] _, fertig in self?.dienstFragen(d); fertig() }
            dienst.append(z)
        }
        if !dienst.isEmpty { abschnitte.append(CPListSection(items: dienst, header: "Dienst", sectionIndexTitle: nil)) }

        liste.updateSections(abschnitte)
    }

    private func fahrtZeile(_ f: UhrFahrt) -> CPListItem {
        let wann = !f.laeuft && !f.offen ? (f.zeitpunkt.map { " · " + UhrStand.abstand(bis: $0) } ?? "") : ""
        let z = CPListItem(text: f.von, detailText: "\(f.status)\(wann) · nach \(f.nach)",
                           image: CarPlayBild.zeit(f.zeit, gefuellt: !f.offen))
        z.accessoryType = .disclosureIndicator
        z.handler = { [weak self] _, fertig in self?.fahrtZeigen(f.id); fertig() }
        return z
    }

    // MARK: Fahrt

    private func fahrtZeigen(_ id: String) {
        guard let steuerung, let f = stand.fahrten.first(where: { $0.id == id }) else { return }
        let vorlage = CPInformationTemplate(title: "\(f.zeit) · \(f.status)", layout: .leading,
                                            items: infos(f), actions: knoepfe(f))
        // Ebene 2 ist die tiefste. Liegt schon eine Fahrt oben, ersetzen statt stapeln.
        if steuerung.templates.count > 1 {
            steuerung.popToRootTemplate(animated: false) { _, _ in
                steuerung.pushTemplate(vorlage, animated: true, completion: nil)
            }
        } else {
            steuerung.pushTemplate(vorlage, animated: true, completion: nil)
        }
    }

    private func infos(_ f: UhrFahrt) -> [CPInformationItem] {
        var punkte = [
            CPInformationItem(title: "Abholung", detail: navigationsAdresse(f, zumZiel: false)),
            CPInformationItem(title: "Ziel", detail: navigationsAdresse(f, zumZiel: true)),
        ]
        if let g = f.gaeste, !g.isEmpty { punkte.append(CPInformationItem(title: "Gäste", detail: g.joined(separator: ", "))) }
        if !f.flug.isEmpty {
            let landung = f.flugAnkunft.map { " · Landung \($0)" + Self.verspaetung(f.flugVerspaetung) } ?? ""
            punkte.append(CPInformationItem(title: "Flug", detail: f.flug + (f.flugStatus.map { " · \($0)" } ?? "") + landung))
        }
        if let n = f.notiz { punkte.append(CPInformationItem(title: "Notiz", detail: n)) }
        if f.kolonne { punkte.append(CPInformationItem(title: "Kolonne", detail: "Fahrt mit mehreren Fahrern")) }
        return punkte
    }

    /// Hoechstens drei Knoepfe (CarPlay-Grenze).
    /// Offen: Annehmen / Ablehnen. Sonst der Schritt, der dran ist (nur im Stand), und Navigation.
    private func knoepfe(_ f: UhrFahrt) -> [CPTextButton] {
        if f.offen {
            return [
                CPTextButton(title: "Annehmen", textStyle: .confirm) { [weak self] _ in self?.antworten(f, annehmen: true) },
                CPTextButton(title: "Ablehnen", textStyle: .cancel) { [weak self] _ in self?.ablehnenFragen(f) },
            ]
        }
        var knoepfe: [CPTextButton] = []
        if let schritt = Self.schritt(f), stand.steht != false {
            knoepfe.append(CPTextButton(title: schritt.titel, textStyle: .confirm) { [weak self] _ in self?.schrittFragen(f, schritt) })
        }
        knoepfe.append(CPTextButton(title: "Navigation", textStyle: .normal) { [weak self] _ in self?.navigationWaehlen(f) })
        return knoepfe
    }

    // MARK: Navigation

    private func fahrt(_ id: String) -> Fahrt? {
        #if DEBUG
        if Self.beispielLauf { return Self.beispielFahrten.first { $0.id.uuidString == id } }
        #endif
        return Geteilt.fahrten.fahrten.first { $0.id.uuidString == id }
    }

    private func navigationsAdresse(_ f: UhrFahrt, zumZiel: Bool) -> String {
        guard let fahrt = fahrt(f.id) else { return zumZiel ? f.nach : f.von }
        return zumZiel
            ? Adresse.fuerNavigation(name: fahrt.zielOrtID != nil && !fahrt.zielAdresse.isEmpty ? "" : fahrt.zielName, adresse: fahrt.zielAdresse)
            : Adresse.fuerNavigation(name: fahrt.abholOrtID != nil && !fahrt.abholAdresse.isEmpty ? "" : fahrt.abholName, adresse: fahrt.abholAdresse)
    }

    /// Unterwegs geht es zum Fahrtziel, sonst zum Abholort (Karten-Apps nehmen nur ein Ziel).
    private func navigationsZiel(_ f: UhrFahrt) -> (titel: String, adresse: String) {
        let zumZiel = f.phase == "unterwegs"
        return (zumZiel ? "zum Ziel" : "zur Abholung", navigationsAdresse(f, zumZiel: zumZiel))
    }

    /// Apple Karten oder Google Maps (und Gast anrufen) als Auswahl, damit der Fahrt-Bildschirm nur drei Knoepfe braucht.
    private func navigationWaehlen(_ f: UhrFahrt) {
        guard let steuerung, steuerung.presentedTemplate == nil else { return }
        var aktionen = [
            CPAlertAction(title: "Apple Karten", style: .default) { [weak self] _ in
                self?.steuerung?.dismissTemplate(animated: true, completion: nil)
                self?.navigieren(f, google: false)
            },
            CPAlertAction(title: "Google Maps", style: .default) { [weak self] _ in
                self?.steuerung?.dismissTemplate(animated: true, completion: nil)
                self?.navigieren(f, google: true)
            },
        ]
        if let tel = f.gastTelefon {
            aktionen.append(CPAlertAction(title: "Gast anrufen", style: .default) { [weak self] _ in
                self?.steuerung?.dismissTemplate(animated: true, completion: nil)
                self?.anrufen(tel)
            })
        }
        aktionen.append(CPAlertAction(title: "Abbrechen", style: .cancel) { [weak self] _ in
            self?.steuerung?.dismissTemplate(animated: true, completion: nil)
        })
        steuerung.presentTemplate(CPActionSheetTemplate(title: "Navigation \(navigationsZiel(f).titel)", message: nil, actions: aktionen),
                                  animated: true, completion: nil)
    }

    /// Ziel fuer den Treffpunkt: Koordinaten, sonst Adresse oder Name (aus dem Dienst im FahrtenSpeicher).
    private func treffpunktZiel(_ d: UhrDienst) -> String {
        let tp = Geteilt.fahrten.dienstAnfragen.first { $0.id.uuidString == d.id }?.treffpunkt
        if let p = tp?.punkt { return "\(p.latitude),\(p.longitude)" }
        if let a = tp?.adresse, !a.isEmpty { return a }
        return d.treffpunkt ?? ""
    }

    /// Apple Karten oder Google Maps zum Treffpunkt beim Dienststart.
    private func treffpunktNavigation(_ d: UhrDienst) {
        guard let steuerung, steuerung.presentedTemplate == nil else { return }
        let ziel = treffpunktZiel(d)
        guard !ziel.isEmpty else { return }
        let aktionen = [
            CPAlertAction(title: "Apple Karten", style: .default) { [weak self] _ in
                self?.steuerung?.dismissTemplate(animated: true, completion: nil)
                self?.navigieren(zu: ziel, google: false)
            },
            CPAlertAction(title: "Google Maps", style: .default) { [weak self] _ in
                self?.steuerung?.dismissTemplate(animated: true, completion: nil)
                self?.navigieren(zu: ziel, google: true)
            },
            CPAlertAction(title: "Abbrechen", style: .cancel) { [weak self] _ in
                self?.steuerung?.dismissTemplate(animated: true, completion: nil)
            },
        ]
        steuerung.presentTemplate(CPActionSheetTemplate(title: "Navigation zum Treffpunkt", message: d.treffpunkt, actions: aktionen),
                                  animated: true, completion: nil)
    }

    private func navigieren(_ f: UhrFahrt, google: Bool) {
        navigieren(zu: navigationsZiel(f).adresse, google: google)
    }

    private func navigieren(zu adresse: String, google: Bool) {
        guard !adresse.isEmpty else { return }
        var teile = URLComponents(string: google ? "comgooglemaps://" : "maps://")!
        teile.queryItems = google
            ? [.init(name: "daddr", value: adresse), .init(name: "directionsmode", value: "driving")]
            : [.init(name: "daddr", value: adresse), .init(name: "dirflg", value: "d")]
        guard let url = teile.url else { return }
        szene?.open(url, options: nil) { [weak self] ok in
            guard !ok, google else { return }
            Task { @MainActor in self?.meldung("Google Maps ist auf dem iPhone nicht installiert.") }
        }
    }

    private func anrufen(_ nummer: String) {
        let ziffern = nummer.filter { $0.isNumber || $0 == "+" }
        guard let url = URL(string: "tel:\(ziffern)") else { return }
        szene?.open(url, options: nil, completionHandler: nil)
    }

    // MARK: Aktionen (gleiche Wege wie die Uhr)

    private func ausfuehren(_ nachricht: [String: Any]) {
        Task {
            #if DEBUG
            if Self.beispielLauf { steuerung?.popToRootTemplate(animated: true, completion: nil); return }
            #endif
            let ok = await UhrBruecke.shared.aktion(nachricht)
            steuerung?.popToRootTemplate(animated: true, completion: nil)
            if !ok { meldung("Hat nicht geklappt. Bitte am iPhone prüfen.") }
        }
    }

    private func antworten(_ f: UhrFahrt, annehmen: Bool) {
        ausfuehren([UhrAktion.art: UhrAktion.fahrt, "id": f.id, "annehmen": annehmen])
    }

    private func ablehnenFragen(_ f: UhrFahrt) {
        frage("Fahrt \(f.zeit) ablehnen?", ja: "Ablehnen", stil: .destructive) { [weak self] in self?.antworten(f, annehmen: false) }
    }

    private func schrittFragen(_ f: UhrFahrt, _ schritt: (titel: String, ziel: String, symbol: String)) {
        frage("\(schritt.titel)?", ja: schritt.titel, stil: schritt.ziel == "done" ? .destructive : .default) { [weak self] in
            self?.ausfuehren([UhrAktion.art: UhrAktion.schritt, "id": f.id, "ziel": schritt.ziel])
        }
    }

    private func dienstFragen(_ d: UhrDienst) {
        guard let steuerung, steuerung.presentedTemplate == nil else { return }
        let zeit = [d.start, d.ende].compactMap { $0 }.joined(separator: "–")
        let frage = CPAlertTemplate(titleVariants: ["Dienst \(Datum.tagEtikett(d.tag)) \(zeit)", "Neuer Dienst"], actions: [
            CPAlertAction(title: "Annehmen", style: .default) { [weak self] _ in
                self?.steuerung?.dismissTemplate(animated: true, completion: nil)
                self?.ausfuehren([UhrAktion.art: UhrAktion.dienst, "id": d.id, "annehmen": true])
            },
            CPAlertAction(title: "Ablehnen", style: .destructive) { [weak self] _ in
                self?.steuerung?.dismissTemplate(animated: true, completion: nil)
                self?.ausfuehren([UhrAktion.art: UhrAktion.dienst, "id": d.id, "annehmen": false])
            },
            CPAlertAction(title: "Später", style: .cancel) { [weak self] _ in
                self?.steuerung?.dismissTemplate(animated: true, completion: nil)
            },
        ])
        steuerung.presentTemplate(frage, animated: true, completion: nil)
    }

    private func stundenFragen(_ h: UhrStunden) {
        frage("Stunden von heute bestätigen?", ja: "Bestätigen", stil: .default) { [weak self] in
            self?.ausfuehren([UhrAktion.art: UhrAktion.stundenBestaetigen, "id": h.dienstID])
        }
    }

    private func frage(_ titel: String, ja: String, stil: CPAlertAction.Style, _ aktion: @escaping () -> Void) {
        guard let steuerung, steuerung.presentedTemplate == nil else { return }
        let vorlage = CPAlertTemplate(titleVariants: [titel], actions: [
            CPAlertAction(title: ja, style: stil) { [weak self] _ in
                self?.steuerung?.dismissTemplate(animated: true, completion: nil)
                aktion()
            },
            CPAlertAction(title: "Abbrechen", style: .cancel) { [weak self] _ in
                self?.steuerung?.dismissTemplate(animated: true, completion: nil)
            },
        ])
        steuerung.presentTemplate(vorlage, animated: true, completion: nil)
    }

    private func meldung(_ text: String) {
        guard let steuerung, steuerung.presentedTemplate == nil else { return }
        steuerung.presentTemplate(CPAlertTemplate(titleVariants: [text], actions: [
            CPAlertAction(title: "OK", style: .cancel) { [weak self] _ in self?.steuerung?.dismissTemplate(animated: true, completion: nil) },
        ]), animated: true, completion: nil)
    }

    // MARK: Neue Fahrt, neue Dienstanfrage

    /// Kommt eine neue Fahrt oder Dienstanfrage dazu, die noch eine Antwort braucht, sofort fragen.
    private func neuesMelden() {
        let offeneFahrten = stand.fahrten.filter(\.offen)
        let offeneDienste = stand.dienste.filter(\.offen)
        defer {
            bekannt.formUnion(stand.fahrten.map(\.id))
            bekannt.formUnion(stand.dienste.map(\.id))
        }
        // Der erste Stand nach dem Verbinden steht schon in der Liste, dafuer kein Hinweis.
        if ersterStand {
            if Geteilt.fahrten.geladen { ersterStand = false }
            return
        }
        if let neu = offeneFahrten.first(where: { !bekannt.contains($0.id) }) { hinweisFahrt(neu); return }
        if let neu = offeneDienste.first(where: { !bekannt.contains($0.id) }) { dienstFragen(neu) }
    }

    private func hinweisFahrt(_ neu: UhrFahrt) {
        guard let steuerung, steuerung.presentedTemplate == nil else { return }
        let hinweis = CPAlertTemplate(
            titleVariants: ["Neue Fahrt um \(neu.zeit): \(neu.von) nach \(neu.nach)", "Neue Fahrt um \(neu.zeit)"],
            actions: [
                CPAlertAction(title: "Annehmen", style: .default) { [weak self] _ in
                    self?.steuerung?.dismissTemplate(animated: true, completion: nil)
                    self?.ausfuehren([UhrAktion.art: UhrAktion.fahrt, "id": neu.id, "annehmen": true])
                },
                // Nur zwei Knoepfe: bei drei kuerzt CarPlay "Annehmen". Ablehnen geht in der Fahrt-Ansicht,
                // so lehnt auch niemand waehrend der Fahrt aus Versehen ab.
                CPAlertAction(title: "Später", style: .cancel) { [weak self] _ in
                    self?.steuerung?.dismissTemplate(animated: true, completion: nil)
                },
            ])
        steuerung.presentTemplate(hinweis, animated: true, completion: nil)
    }

    // MARK: Hilfen

    /// Naechster Schritt wie SchrittKnoepfe der Uhr.
    static func schritt(_ f: UhrFahrt) -> (titel: String, ziel: String, symbol: String)? {
        switch f.phase {
        case "unterwegs": return ("Fahrt beendet", "done", "flag.checkered")
        case "beimGast": return ("Gast an Bord", "in_progress", "person.badge.plus")
        default: return nil
        }
    }

    private static func eindeutig(_ werte: [String]) -> [String] {
        var gesehen = Set<String>()
        return werte.filter { gesehen.insert($0).inserted }
    }

    private static func verspaetung(_ min: Int?) -> String {
        guard let min, min != 0 else { return "" }
        return min > 0 ? " (+\(min) min)" : " (\(min) min)"
    }

    private static func uhrzeit(_ d: Date) -> String {
        let f = DateFormatter()
        f.dateFormat = "HH:mm"
        return f.string(from: d)
    }

    private static func zettelText(_ status: String?) -> String? {
        switch status {
        case "eingereicht": return "Gesendet, Dispo prüft."
        case "bestaetigt": return "Von der Dispo bestätigt."
        case "zurueckgewiesen": return "Von der Dispo zurückgegeben"
        default: return nil
        }
    }

    nonisolated static func unterwegs(_ fahrt: Fahrt) -> Bool {
        ["in_progress", "unterwegs", "started", "on_trip", "ongoing", "active"].contains(fahrt.status.lowercased())
    }

    nonisolated static func beimGast(_ fahrt: Fahrt) -> Bool {
        ["at_pickup", "pickup", "beim_pickup", "beim pickup"].contains(fahrt.status.lowercased())
    }

    nonisolated static func statusText(_ fahrt: Fahrt) -> String {
        if unterwegs(fahrt) { return "Unterwegs" }
        if beimGast(fahrt) { return "Beim Gast" }
        if fahrt.wartetAufAntwort { return "Antwort offen" }
        return "Angenommen"
    }

    // MARK: Beispiel (nur Debug, Startargument -carplayBeispiel)

    static var beispielAktiv: Bool {
        #if DEBUG
        return beispielLauf
        #else
        return false
        #endif
    }

    #if DEBUG
    static let beispielLauf = ProcessInfo.processInfo.arguments.contains("-carplayBeispiel")

    static let beispielFahrten: [Fahrt] = {
        let heute = Datum.tagWert(Date())
        func fahrt(_ etd: String, _ status: String, _ von: String, _ nach: String, flug: String = "") -> Fahrt {
            Fahrt(id: UUID(), status: status, tripType: flug.isEmpty ? "normal" : "airport", abholName: von, abholAdresse: von,
                  zielName: nach, zielAdresse: nach, zugNummer: nil, flug: flug, fahrtDatum: heute, etd: etd, planEtd: etd,
                  kolonnenID: nil, istKolonne: false, meineAntwort: "")
        }
        return [
            fahrt("17:24", "at_pickup", "Beethovenstr. 22, Diedorf", "Gögginger Str. 10, Augsburg"),
            fahrt("18:10", "assigned", "Maximilianstr. 40, Augsburg", "Gögginger Str. 10, Augsburg"),
            fahrt("19:05", "pending", "Flughafen München, Terminal 2", "Gögginger Str. 10, Augsburg", flug: "LH 2471"),
            fahrt("20:30", "assigned", "Hotel Maximilian's, Augsburg", "Flughafen München, Terminal 1"),
            fahrt("22:45", "pending", "Kongress am Park, Augsburg", "Hotel Maximilian's, Augsburg"),
        ]
    }()

    /// Fuer die Live-Aktivitaet im Beispiellauf (LiveFahrt.swift).
    static var beispiele: [Fahrt] { beispielFahrten }

    static let beispielStand: UhrStand = {
        let f = beispielFahrten
        let heute = f[0].fahrtDatum
        func uhr(_ x: Fahrt, phase: String?, offen: Bool) -> UhrFahrt {
            UhrFahrt(id: x.id.uuidString, tag: heute, zeit: x.etd, status: statusText(x), von: x.abholKurz, nach: x.zielKurz,
                     flug: x.flug, offen: offen, laeuft: phase != nil, kolonne: false, phase: phase)
        }
        var a = uhr(f[0], phase: "beimGast", offen: false)
        a.gaeste = ["Dr. Anna Weber"]
        a.gastTelefon = "+49 170 1234567"
        a.notiz = "Gast wartet an der Rezeption."
        var c = uhr(f[2], phase: nil, offen: true)
        c.flugStatus = "Gestartet"
        c.flugAnkunft = "18:50"
        c.flugVerspaetung = 12
        c.gaeste = ["Familie Brandt (3)"]
        let jetzt = Date()
        return UhrStand(angemeldet: true, name: "Beispiel Fahrer",
                        fahrten: [a, uhr(f[1], phase: nil, offen: false), c, uhr(f[3], phase: nil, offen: false), uhr(f[4], phase: nil, offen: true)],
                        dienste: [UhrDienst(id: UUID().uuidString, tag: heute, start: "06:00", ende: "14:00", offen: true),
                                  UhrDienst(id: UUID().uuidString, tag: heute, start: "07:00", ende: "15:00", offen: false,
                                            treffpunkt: "Bayerischer Hof", treffpunktNotiz: "Am Haupteingang warten.")],
                        ortungAn: true, letzteSendung: jetzt.addingTimeInterval(-40), stand: jetzt, steht: true, tempoKmh: 0,
                        heute: UhrStunden(dienstID: UUID().uuidString, start: jetzt.addingTimeInterval(-5 * 3600 - 720), ende: nil,
                                          fertig: false, pausen: [], arbeitsMin: 0, offen: false, zettelStatus: nil))
    }()

    /// Zeigt nacheinander die Liste, eine Fahrt, die Navigation und den Hinweis auf eine neue Fahrt.
    private func beispielDurchlauf() {
        Task {
            while steuerung != nil {
                try? await Task.sleep(for: .seconds(7))
                fahrtZeigen(stand.fahrten[0].id)
                try? await Task.sleep(for: .seconds(7))
                navigationWaehlen(stand.fahrten[0])
                try? await Task.sleep(for: .seconds(6))
                steuerung?.dismissTemplate(animated: false, completion: nil)
                fahrtZeigen(stand.fahrten[2].id)
                try? await Task.sleep(for: .seconds(7))
                steuerung?.popToRootTemplate(animated: false, completion: nil)
                hinweisFahrt(stand.fahrten[4])
                try? await Task.sleep(for: .seconds(7))
                steuerung?.dismissTemplate(animated: false, completion: nil)
            }
        }
    }
    #endif
}

/// Bilder im TRISAR-Look fuer die Apple-Vorlagen. Farben und Schrift der Vorlagen legt CarPlay fest,
/// eigene Bilder zeigt es aber unveraendert: die Abholzeit steht deshalb als Lime-Plakette
/// in Space Grotesk vor jeder Zeile.
enum CarPlayBild {
    static let lime = UIColor(red: 0xE3 / 255, green: 0xF6 / 255, blue: 0x54 / 255, alpha: 1)
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

    /// Schlichtes Symbol fuer Zeilen, CarPlay faerbt es selbst (hell auf dunkel).
    static func zeichen(_ name: String) -> UIImage? {
        UIImage(systemName: name, withConfiguration: UIImage.SymbolConfiguration(weight: .semibold))
    }

    /// Gefuellt = angenommen, nur Rand = Antwort noch offen (wie der Lime-Rand der Karten in der App).
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
