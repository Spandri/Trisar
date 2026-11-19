import CarPlay
import Combine
import CoreLocation
import MapKit
import UIKit

/// Speicher, die Handy-Oberflaeche und CarPlay gemeinsam nutzen. CarPlay kann die App starten,
/// ohne dass das Handy-Fenster je aufgeht, deshalb haengen sie nicht an der SwiftUI-Szene.
@MainActor
enum Geteilt {
    static let anmeldung = Anmeldung()
    static let ortung = Ortung()
    static let fahrten = FahrtenSpeicher()
}

/// CarPlay-Oberflaeche der Fahrer-App, seit 17.11. Kategorie Navigation (vorher Driving Task).
///   Karte   – Start und Wurzel (Pflicht von Apple): CarPlayKarte als Grundansicht, darueber CPMapTemplate.
///             Oben „Fahrten“, „Dienst“, „Karte bewegen“, rechts Zoom +/−, Verschieben, Zentrieren.
///             Links die naechste Fahrt als Vorschau-Feld der Vorlage (showTripPreviews): Zielname, Zeit,
///             Gast, Flug, Anfahrt Dauer/km, Ankunft. Knopf darin:
///               ohne Route von der Dispo (oder Gast noch nicht an Bord) -> „In Google Maps öffnen“ (wie bisher),
///               mit Route von der Dispo und Gast an Bord -> „TRISAR-Navigation starten“ (CarPlayFuehrung).
///   Liste   – „Fahrten“: alle kommenden Fahrten untereinander nach Tag, vorne die Abholzeit als Lime-Plakette.
///   Dienst  – „Dienst“: Arbeitszeit, Stunden bestaetigen, Dienststart mit Treffpunkt, Dienstanfragen.
///   Fahrt   – Tipp auf eine Fahrt: Abholung, Ziel, Gaeste, Flug, Notiz. Knoepfe:
///             offen -> Annehmen / Ablehnen, sonst der Schritt der dran ist und Navigation
///             (Apple Karten, Google Maps, Gast anrufen).
///   Hinweis – kommt eine neue Fahrt oder Dienstanfrage dazu, fragt CarPlay sofort: Annehmen / Spaeter.
/// Daten und Aktionen laufen ueber UhrBruecke, also genau wie auf der Apple Watch.
/// Farben und Schrift legt CarPlay fest, der TRISAR-Look steckt in den Bildern (Lime-Zeitplakette,
/// TRISAR-Schriftzug) und in der Karte. Laeuft auf dem Geraet erst mit der Apple-Freigabe
/// com.apple.developer.carplay-maps, im Simulator ueber TrisarFahrer-Simulator.entitlements.
@MainActor
final class CarPlaySzene: UIResponder, CPTemplateApplicationSceneDelegate, CPMapTemplateDelegate {
    private var steuerung: CPInterfaceController?
    private var szene: CPTemplateApplicationScene?
    private var fenster: CPWindow?
    /// Grundansicht (nur Karte) und die Vorlage darueber.
    private var karte: CarPlayKarte?
    private var kartenVorlage: CPMapTemplate?
    private var fuehrung: CarPlayFuehrung?
    /// Eigener Standort nach Einstellung der Dispo (OBD-Tracker oder Handy-GPS).
    private var standort: CarPlayStandort?
    /// Karte wird gerade verschoben. Selbst gemerkt aus den Meldungen der Vorlage, denn
    /// `isPanningInterfaceVisible` fragt das Auto und wartet, haengt also die App, wenn CarPlay ausfaellt.
    private var verschiebtKarte = false
    /// „Fahrten“ und „Dienst“, eine Ebene hinter der Karte.
    private var liste: CPListTemplate?
    private var dienstListe: CPListTemplate?
    /// Vorschau der naechsten Fahrt links auf der Karte.
    private var vorschauSchluessel = ""
    private var vorschauReise: CPTrip?
    /// Im Vorschau-Feld gewaehlte Fahrt (Blaettern), die Karte zeigt deren Anfahrt.
    private var gewaehlt: String?
    /// Zuletzt gesetzte Knoepfe der Kartenvorlage, nur bei Aenderung neu setzen (sonst flackern sie).
    private var knopfSchluessel = ""
    /// Anfahrt je Adresse (Apple-Routing): Dauer, Strecke, Linie, Ort. Wird nach 5 Minuten neu gerechnet.
    private var anfahrten: [String: Anfahrt] = [:]
    private var anfahrtLaeuft: Set<String> = []
    /// Route vom Gast zum Ziel je Fahrt (jobs.ext_route_polyline, vom Server beim Anlegen gerechnet).
    private var fahrtLinien: [String: [CLLocationCoordinate2D]] = [:]
    private var fahrtLinienLaeuft: Set<String> = []
    /// Fahrzeit vom Gast zum Ziel in Minuten (wie FahrtDetails.fahrzeitMin), fuer die ETA im Feld.
    private var fahrzeiten: [String: Int?] = [:]
    /// Knopftext im Vorschau-Feld (gilt fuer alle Fahrten, wird beim Blaettern angepasst).
    private var startText = ""
    private var abos: Set<AnyCancellable> = []
    private var takt: Timer?
    private var stand: UhrStand = .leer
    /// Fahrten und Dienstanfragen, fuer die kein Hinweis (mehr) kommt: Hinweis schon gezeigt, nicht offen
    /// oder beim Verbinden schon da. Offene, die hier fehlen, warten auf ihren Hinweis.
    private var bekannt: Set<String> = []
    private var ersterStand = true
    /// Hinweis, der gerade zu sehen ist (ID der Fahrt oder Dienstanfrage und die Vorlage dazu).
    private var hinweisID: String?
    private var hinweisVorlage: CPAlertTemplate?
    /// Geoeffnete Fahrt (Ebene 2), wird bei jedem neuen Stand aufgefrischt.
    private var fahrtVorlage: CPInformationTemplate?
    private var fahrtAngezeigt: UhrFahrt?
    private var fahrtSteht: Bool?
    /// Laeuft gerade eine Aktion (Annehmen, Schritt, ...): keine weiteren Fragen und Aktionen.
    private var arbeitet = false

    /// Navigations-Apps bekommen das Fenster fuer die Karte mit.
    func templateApplicationScene(_ templateApplicationScene: CPTemplateApplicationScene,
                                  didConnect interfaceController: CPInterfaceController, to window: CPWindow) {
        verbinden(templateApplicationScene, interfaceController, window)
    }

    func templateApplicationScene(_ templateApplicationScene: CPTemplateApplicationScene,
                                  didConnect interfaceController: CPInterfaceController) {
        verbinden(templateApplicationScene, interfaceController, templateApplicationScene.carWindow)
    }

    private func verbinden(_ templateApplicationScene: CPTemplateApplicationScene,
                           _ interfaceController: CPInterfaceController, _ window: CPWindow) {
        // Beide Rueckrufe koennen kommen: nur einmal aufbauen.
        guard steuerung == nil else { return }
        steuerung = interfaceController
        szene = templateApplicationScene
        fenster = window
        interfaceController.prefersDarkUserInterfaceStyle = true

        // Grundansicht: nur die Karte.
        let k = CarPlayKarte()
        window.rootViewController = k
        karte = k

        let vorlage = CPMapTemplate()
        vorlage.mapDelegate = self
        vorlage.guidanceBackgroundColor = CarPlayBild.flaeche
        vorlage.tripEstimateStyle = .dark
        kartenVorlage = vorlage
        let f = CarPlayFuehrung(vorlage: vorlage, karte: k)
        f.geaendert = { [weak self] _ in
            self?.knoepfeSetzen()
            self?.vorschauSchluessel = ""
            self?.vorschauZeigen()
        }
        f.angekommen = { [weak self] id in self?.angekommen(id) }
        f.zielName = { [weak self] id in self?.zielName(id) }
        fuehrung = f
        knoepfeSetzen()

        let fahrtenListe = CPListTemplate(title: "Fahrten", sections: [])
        fahrtenListe.emptyViewTitleVariants = ["Keine Fahrten"]
        fahrtenListe.emptyViewSubtitleVariants = ["Neue Fahrten erscheinen hier von selbst."]
        liste = fahrtenListe
        let dienst = CPListTemplate(title: "Dienst", sections: [])
        dienst.emptyViewTitleVariants = ["Kein Dienst"]
        dienst.emptyViewSubtitleVariants = ["Arbeitszeit und Dienstanfragen erscheinen hier."]
        dienstListe = dienst
        interfaceController.setRootTemplate(vorlage, animated: false, completion: CarPlayFehler.melden)

        Geteilt.anmeldung.$zustand
            .receive(on: RunLoop.main)
            .sink { [weak self] _ in
                // Auch ohne offenes Handy-Fenster Fahrten laden und Standort senden.
                let id = Geteilt.anmeldung.fahrerID
                Geteilt.fahrten.setzeFahrer(id)
                Geteilt.ortung.setzeFahrer(id)
                self?.listeFuellen()
                self?.vorschauZeigen()
            }
            .store(in: &abos)
        // Fahrer auf der Karte (in der Fuehrung kommt der Ort aus NaviFuehrung).
        let s = CarPlayStandort()
        standort = s
        s.$ort
            .receive(on: RunLoop.main)
            .sink { [weak self] p in
                guard let self, let p, fuehrung?.laeuft != true else { return }
                karte?.fahrerSetzen(p.coordinate, kurs: p.course >= 0 ? p.course : nil)
            }
            .store(in: &abos)
        UhrBruecke.shared.carPlayStand
            .receive(on: RunLoop.main)
            .sink { [weak self] neu in
                guard let self, !Self.beispielAktiv else { return }
                // Jede Standort-Sendung schickt einen neuen Stand. Nur neu zeichnen, wenn sich fuer CarPlay etwas aendert.
                guard Self.relevant(neu) != Self.relevant(stand) else {
                    if ersterStand, Geteilt.fahrten.geladen { ersterStand = false }
                    return
                }
                stand = neu
                listeFuellen()
                fahrtAuffrischen()
                phaseMelden()
                vorschauZeigen()
                knoepfeSetzen()
                neuesMelden()
            }
            .store(in: &abos)
        // Countdown, laufende Arbeitszeit und Anfahrt jede Minute neu.
        takt = Timer.scheduledTimer(withTimeInterval: 60, repeats: true) { [weak self] _ in
            Task { @MainActor in
                self?.listeFuellen()
                self?.vorschauZeigen()
            }
        }

        #if DEBUG
        if Self.beispielLauf {
            stand = Self.beispielStand
            beispielDurchlauf()
        }
        #endif
        UhrBruecke.shared.carPlayVerbunden(true)
        Geteilt.ortung.carPlayVerbunden(true)
        Task { await Geteilt.fahrten.laden() }
        listeFuellen()
        vorschauZeigen()
    }

    func templateApplicationScene(_ templateApplicationScene: CPTemplateApplicationScene,
                                  didDisconnect interfaceController: CPInterfaceController, from window: CPWindow) {
        trennen()
    }

    func templateApplicationScene(_ templateApplicationScene: CPTemplateApplicationScene,
                                  didDisconnectInterfaceController interfaceController: CPInterfaceController) {
        trennen()
    }

    private func trennen() {
        guard steuerung != nil else { return }
        UhrBruecke.shared.carPlayVerbunden(false)
        Geteilt.ortung.carPlayVerbunden(false)
        abos.removeAll()
        takt?.invalidate()
        takt = nil
        fuehrung?.trennen()
        fuehrung = nil
        standort?.beenden()
        standort = nil
        fenster?.rootViewController = nil
        fenster = nil
        karte = nil
        kartenVorlage = nil
        verschiebtKarte = false
        vorschauReise = nil
        vorschauSchluessel = ""
        gewaehlt = nil
        knopfSchluessel = ""
        steuerung = nil
        szene = nil
        liste = nil
        dienstListe = nil
        hinweisID = nil
        hinweisVorlage = nil
        fahrtVorlage = nil
        fahrtAngezeigt = nil
    }

    private var angemeldet: Bool { Self.beispielAktiv || Geteilt.anmeldung.fahrerID != nil }

    /// Stand ohne Felder, die sich bei jeder Standort-Sendung aendern (Zeitstempel, Tempo).
    private static func relevant(_ s: UhrStand) -> UhrStand {
        var kopie = s
        kopie.stand = .distantPast
        kopie.letzteSendung = nil
        kopie.tempoKmh = nil
        return kopie
    }

    // MARK: Liste

    /// Fuellt „Fahrten“ und „Dienst“ (zwei Listen hinter der Karte).
    private func listeFuellen() {
        guard let liste, let dienstListe else { return }
        guard angemeldet else {
            let bitte = [CPListSection(items: [CPListItem(text: "Bitte am iPhone anmelden",
                                                          detailText: "TRISAR auf dem iPhone öffnen und anmelden.")])]
            liste.updateSections(bitte)
            dienstListe.updateSections(bitte)
            return
        }
        let grenze = CPListTemplate.maximumItemCount

        // Offene Dienstanfragen duerfen nie wegfallen, der Rest des Diensts bekommt den uebrigen Platz.
        var sonstige: [CPListItem] = []
        if let h = stand.heute {
            let min = h.minuten()
            var detail = "seit " + Self.uhrzeit(h.start) + (h.pauseLaeuft() ? " · Pause läuft" : "")
            if h.fertig { detail = Self.zettelText(h.zettelStatus) ?? "Dienst beendet" }
            let z = CPListItem(text: "Arbeitszeit \(min / 60) h \(min % 60) min", detailText: detail, image: CarPlayBild.zeichen("clock"))
            if h.offen {
                z.accessoryType = .disclosureIndicator
                z.handler = { [weak self] _, fertig in self?.stundenFragen(h); fertig() }
            }
            sonstige.append(z)
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
            sonstige.append(z)
        }
        var anfragen: [CPListItem] = []
        for d in stand.dienste where d.offen {
            let zeit = [d.start, d.ende].compactMap { $0 }.joined(separator: "–")
            let z = CPListItem(text: "Dienstanfrage " + Datum.tagEtikett(d.tag), detailText: zeit.isEmpty ? "Antwort offen" : "\(zeit) · Antwort offen",
                               image: CarPlayBild.zeichen("calendar.badge.clock"))
            z.accessoryType = .disclosureIndicator
            z.handler = { [weak self] _, fertig in self?.dienstFragen(d); fertig() }
            anfragen.append(z)
        }
        let anfrageZeilen = Array(anfragen.prefix(grenze))
        let dienst = Array(sonstige.prefix(max(0, grenze - anfrageZeilen.count))) + anfrageZeilen

        dienstListe.updateSections(dienst.isEmpty ? [] : [CPListSection(items: dienst)])

        // Fahrten untereinander, nach Tag getrennt, nur so viele wie Zeilen und Abschnitte erlaubt sind.
        let platz = grenze
        let abschnittPlatz = Int(CPListTemplate.maximumSectionCount)
        let kandidaten = Array(stand.fahrten.prefix(platz))
        let tage = Array(Self.eindeutig(kandidaten.map(\.tag)).prefix(abschnittPlatz))
        var abschnitte: [CPListSection] = []
        for (nummer, tag) in tage.enumerated() {
            let zeilen = kandidaten.filter { $0.tag == tag }.map(fahrtZeile)
            // Ueber dem ersten Tag das Lime-Zeichen: Header-Bilder zeigt CarPlay in Originalfarbe.
            abschnitte.append(CPListSection(items: zeilen, header: Datum.tagEtikett(tag), headerSubtitle: nil,
                                            headerImage: nummer == 0 ? CarPlayBild.logo : nil, headerButton: nil, sectionIndexTitle: nil))
        }
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

    private func fahrtTitel(_ f: UhrFahrt) -> String { "\(f.zeit) · \(f.status)" }

    private func fahrtZeigen(_ id: String) {
        guard let steuerung, !arbeitet, let f = stand.fahrten.first(where: { $0.id == id }) else { return }
        let vorlage = CPInformationTemplate(title: fahrtTitel(f), layout: .leading,
                                            items: infos(f), actions: knoepfe(f))
        let steht = stand.steht
        let schieben = { [weak self] in
            self?.steuerung?.pushTemplate(vorlage, animated: true) { [weak self] ok, fehler in
                CarPlayFehler.melden(ok, fehler)
                // Merken, damit die Fahrt bei neuem Stand aufgefrischt wird.
                guard ok, let self else { return }
                fahrtVorlage = vorlage
                fahrtAngezeigt = f
                fahrtSteht = steht
            }
        }
        // Karte -> Liste -> Fahrt. Liegt schon eine Fahrt oben, ersetzen statt stapeln.
        if steuerung.topTemplate is CPInformationTemplate {
            fahrtVorlage = nil
            fahrtAngezeigt = nil
            steuerung.popTemplate(animated: false) { ok, fehler in
                CarPlayFehler.melden(ok, fehler)
                schieben()
            }
        } else {
            schieben()
        }
    }

    /// Ist genau diese Fahrt gerade oben zu sehen?
    private func zeigtFahrt(_ id: String) -> Bool {
        guard let steuerung, let vorlage = fahrtVorlage else { return false }
        return steuerung.topTemplate === vorlage && fahrtAngezeigt?.id == id
    }

    /// Offene Fahrt mit dem neuen Stand auffrischen (Titel, Zeilen, Knoepfe). Ist sie weg, zurueck zur Liste.
    private func fahrtAuffrischen() {
        guard let steuerung, let vorlage = fahrtVorlage, let alt = fahrtAngezeigt else { return }
        // Mit "Zurueck" verlassen: nichts mehr aufzufrischen.
        guard steuerung.templates.contains(where: { $0 === vorlage }) else {
            fahrtVorlage = nil
            fahrtAngezeigt = nil
            return
        }
        guard let f = stand.fahrten.first(where: { $0.id == alt.id }) else {
            // Waehrend einer Aktion (ablehnen, beenden) fuehrt ausfuehren selbst zurueck.
            guard !arbeitet else { return }
            fahrtVorlage = nil
            fahrtAngezeigt = nil
            zurueckZurListe { [weak self] in self?.meldung("Fahrt \(alt.zeit) ist nicht mehr zugeteilt.") }
            return
        }
        guard f != alt || stand.steht != fahrtSteht else { return }
        vorlage.title = fahrtTitel(f)
        vorlage.items = infos(f)
        vorlage.actions = knoepfe(f)
        fahrtAngezeigt = f
        fahrtSteht = stand.steht
    }

    /// Hoechstens 10 Zeilen (CarPlay-Grenze).
    private func infos(_ f: UhrFahrt) -> [CPInformationItem] {
        var punkte = [CPInformationItem(title: "Abholung", detail: navigationsAdresse(f, zumZiel: false))]
        let stopps = fahrt(f.id)?.zwischenstopps ?? []
        if !stopps.isEmpty { punkte.append(CPInformationItem(title: "Stopps", detail: stopps.joined(separator: " · "))) }
        punkte.append(CPInformationItem(title: "Ziel", detail: navigationsAdresse(f, zumZiel: true)))
        if let g = f.gaeste, !g.isEmpty { punkte.append(CPInformationItem(title: "Gäste", detail: g.joined(separator: ", "))) }
        if let nummer = Self.flugNummer(f) {
            let landung = f.flugAnkunft.map { " · Landung \($0)" + Self.verspaetung(f.flugVerspaetung) } ?? ""
            punkte.append(CPInformationItem(title: "Flug", detail: nummer + (f.flugStatus.map { " · \($0)" } ?? "") + landung))
        }
        if let n = f.notiz { punkte.append(CPInformationItem(title: "Notiz", detail: n)) }
        if f.kolonne { punkte.append(CPInformationItem(title: "Kolonne", detail: "Fahrt mit mehreren Fahrern")) }
        return Array(punkte.prefix(10))
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
        knoepfe.append(CPTextButton(title: "Navigation starten", textStyle: .normal) { [weak self] _ in self?.navigationWaehlen(f) })
        if let tel = f.gastTelefon, knoepfe.count < 3 {
            knoepfe.append(CPTextButton(title: "Gast anrufen", textStyle: .normal) { [weak self] _ in self?.anrufen(tel) })
        }
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

    /// Unterwegs geht es zum Fahrtziel, sonst zum Abholort.
    /// Ab „beim Gast“ geht es zum Fahrtziel, vorher zum Abholort.
    static func zumZiel(_ f: UhrFahrt) -> Bool { f.phase == "beimGast" || f.phase == "unterwegs" }

    private func navigationsZiel(_ f: UhrFahrt) -> (titel: String, adresse: String) {
        let zumZiel = Self.zumZiel(f)
        return (zumZiel ? "zum Ziel" : "zur Abholung", navigationsAdresse(f, zumZiel: zumZiel))
    }

    /// Apple Karten oder Google Maps (und Gast anrufen) als Auswahl, damit der Fahrt-Bildschirm nur drei Knoepfe braucht.
    private func navigationWaehlen(_ f: UhrFahrt) { navigationStarten(f) }

    /// Vorgegebene TRISAR-Route: direkt die eigene Fuehrung. Sonst Google Maps oder Apple Karten:
    /// ist nur eine installiert, direkt diese, sind beide da, fragen.
    private func navigationStarten(_ f: UhrFahrt) {
        if eigeneNavigation(f) { return eigeneFuehrungStarten(f) }
        // Braucht comgooglemaps und maps in LSApplicationQueriesSchemes (project.yml).
        let google = UIApplication.shared.canOpenURL(URL(string: "comgooglemaps://")!)
        let apple = UIApplication.shared.canOpenURL(URL(string: "maps://")!)
        guard google && apple else { return navigieren(f, google: google) }
        guard let steuerung, steuerung.presentedTemplate == nil else { return }
        let aktionen = [
            CPAlertAction(title: "Google Maps", style: .default) { [weak self] _ in
                self?.schliessen { self?.navigieren(f, google: true) }
            },
            CPAlertAction(title: "Apple Karten", style: .default) { [weak self] _ in
                self?.schliessen { self?.navigieren(f, google: false) }
            },
            CPAlertAction(title: "Abbrechen", style: .cancel) { [weak self] _ in self?.schliessen() },
        ]
        steuerung.presentTemplate(CPActionSheetTemplate(title: "Navigation \(navigationsZiel(f).titel)", message: nil, actions: aktionen),
                                  animated: true, completion: CarPlayFehler.melden)
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
                self?.schliessen { self?.navigieren(zu: ziel, google: false) }
            },
            CPAlertAction(title: "Google Maps", style: .default) { [weak self] _ in
                self?.schliessen { self?.navigieren(zu: ziel, google: true) }
            },
            CPAlertAction(title: "Abbrechen", style: .cancel) { [weak self] _ in self?.schliessen() },
        ]
        steuerung.presentTemplate(CPActionSheetTemplate(title: "Navigation zum Treffpunkt", message: d.treffpunkt, actions: aktionen),
                                  animated: true, completion: CarPlayFehler.melden)
    }

    /// Navigation zur Fahrt mit Name und Adresse (wie am Handy).
    ///   Noch nicht beim Gast – Google: Abholort als Zwischenziel, dann Stopps, dann Ziel. Apple: Abholort.
    ///   Beim Gast / mit Gast  – nur noch zum Ziel (Google mit den Stopps dazwischen).
    /// Google ueber comgooglemaps:// mit mehreren Zielen in daddr („A to:B“). Getestet 19.11. im Auto:
    /// der Universal Link und comgooglemapsurl:// oeffnen Google Maps aus CarPlay ohne Route.
    private func navigieren(_ f: UhrFahrt, google: Bool) {
        guard google else {
            // Apple Karten mit Zwischenziel: maps:// kennt nur ein Ziel, openMaps mit Standort, Abholort und Ziel
            // nimmt den Abholort als Zwischenziel (im Auto getestet 19.11., Apple dokumentiert nur die ersten zwei Punkte).
            if !Self.zumZiel(f), let linie = fahrtLinien[f.id], let abhol = linie.first, let ziel = linie.last,
               let szene, let fahrt = fahrt(f.id) {
                let a = MKMapItem(placemark: MKPlacemark(coordinate: abhol))
                a.name = fahrt.abholName.isEmpty ? f.von : fahrt.abholName
                let z = MKMapItem(placemark: MKPlacemark(coordinate: ziel))
                z.name = fahrt.zielName.isEmpty ? f.nach : fahrt.zielName
                MKMapItem.openMaps(with: [MKMapItem.forCurrentLocation(), a, z],
                                   launchOptions: [MKLaunchOptionsDirectionsModeKey: MKLaunchOptionsDirectionsModeDriving],
                                   from: szene) { [weak self] ok in
                    if !ok { Task { @MainActor in self?.navigieren(zu: self?.navigationsZiel(f).adresse ?? "", google: false) } }
                }
                return
            }
            return navigieren(zu: navigationsZiel(f).adresse, google: false)
        }
        guard let fahrt = fahrt(f.id) else { return navigieren(zu: navigationsZiel(f).adresse, google: true) }
        let abhol = Adresse.fuerNavigation(name: fahrt.abholOrtID != nil && !fahrt.abholAdresse.isEmpty ? "" : fahrt.abholName,
                                           adresse: fahrt.abholAdresse)
        let ziel = Adresse.fuerNavigation(name: fahrt.zielOrtID != nil && !fahrt.zielAdresse.isEmpty ? "" : fahrt.zielName,
                                          adresse: fahrt.zielAdresse)
        let stopps = RoutenPunkt.zwischenziele(stopps: fahrt.zwischenstopps, punkte: fahrt.routenPunkte)
        let folge = (Self.zumZiel(f) ? [] : [abhol]) + stopps + [ziel]
        navigieren(zu: folge.filter { !$0.isEmpty }.prefix(RoutenPunkt.googleZwischenziele + 1).joined(separator: " to:"), google: true)
    }

    private func navigieren(zu adresse: String, google: Bool) {
        guard !adresse.isEmpty, let szene else { return }
        let url = google
            ? Self.url("comgooglemaps://", [("daddr", adresse), ("directionsmode", "driving")])
            : Self.url("maps://", [("daddr", adresse), ("dirflg", "d")])
        guard let url else { return }
        szene.open(url, options: nil) { [weak self] ok in
            if !ok { Task { @MainActor in self?.meldung("\(google ? "Google Maps" : "Apple Karten") konnte nicht geöffnet werden.") } }
        }
    }

    /// Nur diese Zeichen bleiben in Query-Werten stehen, alles andere (& + = ? # , | Umlaute) wird kodiert.
    private static let erlaubt = CharacterSet(charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~")

    private static func url(_ basis: String, _ werte: [(String, String)]) -> URL? {
        guard var teile = URLComponents(string: basis) else { return nil }
        teile.percentEncodedQueryItems = werte.map { URLQueryItem(name: $0.0, value: $0.1.addingPercentEncoding(withAllowedCharacters: erlaubt)) }
        return teile.url
    }

    private func anrufen(_ nummer: String) {
        let ziffern = nummer.filter { $0.isNumber || $0 == "+" }
        guard let url = URL(string: "tel:\(ziffern)") else { return }
        szene?.open(url, options: nil, completionHandler: nil)
    }

    // MARK: Karte (Wurzel)

    /// Knoepfe der Kartenvorlage je nach Zustand. Oben hoechstens zwei je Seite, rechts hoechstens vier Kartenknoepfe.
    ///   Grundzustand – „Fahrten“, „Dienst“ | „Details“, naechster Schritt (sonst „Karte bewegen“),
    ///                  Kartenknoepfe + − Verschieben Zentrieren.
    ///   Verschieben  – „Fertig“ (Pflicht, CarPlay hat dafuer keinen eigenen Knopf).
    ///   Fuehrung     – „Ton“, „Übersicht“ | naechster Schritt, „Ende“.
    /// Der Schritt (Gast an Bord, Fahrt beendet) gehoert zur laufenden Fahrt und kommt nur im Stand.
    private func knoepfeSetzen() {
        guard let vorlage = kartenVorlage else { return }
        let laufend = stand.fahrten.first(where: \.laeuft)
        let schritt = laufend.flatMap { f in stand.steht != false ? Self.schritt(f).map { (f, $0) } : nil }
        let details = detailFahrt
        let schluessel = ["\(verschiebtKarte)", "\(fuehrung?.laeuft == true)", "\(NaviFuehrung.geteilt.stumm)",
                          "\(karte?.modus == .uebersicht)", schritt.map { "\($0.0.id)\($0.1.titel)" } ?? "", details?.id ?? ""]
            .joined(separator: "|")
        guard schluessel != knopfSchluessel else { return }
        knopfSchluessel = schluessel
        let schrittKnopf = schritt.map { f, s in
            CPBarButton(title: s.titel) { [weak self] _ in self?.schrittFragen(f, s) }
        }
        let zoomRein = CPMapButton { [weak self] _ in self?.karte?.zoomen(1) }
        zoomRein.image = CarPlayBild.kartenKnopf("plus")
        let zoomRaus = CPMapButton { [weak self] _ in self?.karte?.zoomen(-1) }
        zoomRaus.image = CarPlayBild.kartenKnopf("minus")
        let bewegen = CPMapButton { [weak self] _ in self?.kartenVorlage?.showPanningInterface(animated: true) }
        bewegen.image = CarPlayBild.kartenKnopf("arrow.up.and.down.and.arrow.left.and.right")
        let zentrieren = CPMapButton { [weak self] _ in
            self?.karte?.folgen()
            if self?.fuehrung?.laeuft == true { self?.knoepfeSetzen() }
        }
        zentrieren.image = CarPlayBild.kartenKnopf("location.north.fill")

        if verschiebtKarte {
            vorlage.leadingNavigationBarButtons = []
            vorlage.trailingNavigationBarButtons = [CPBarButton(title: "Fertig") { [weak self] _ in
                self?.kartenVorlage?.dismissPanningInterface(animated: true)
            }]
            vorlage.mapButtons = [zoomRein, zoomRaus]
            return
        }
        if fuehrung?.laeuft == true {
            let stumm = NaviFuehrung.geteilt.stumm
            vorlage.leadingNavigationBarButtons = [
                CPBarButton(title: stumm ? "Ton an" : "Ton aus") { [weak self] _ in
                    NaviFuehrung.geteilt.stumm.toggle()
                    self?.knoepfeSetzen()
                },
                CPBarButton(title: karte?.modus == .uebersicht ? "Folgen" : "Übersicht") { [weak self] _ in
                    guard let self, let karte else { return }
                    if karte.modus == .uebersicht { karte.folgen() } else { karte.uebersicht() }
                    knoepfeSetzen()
                },
            ]
            vorlage.trailingNavigationBarButtons = [schrittKnopf].compactMap { $0 }
                + [CPBarButton(title: "Ende") { [weak self] _ in self?.fuehrung?.beenden() }]
            vorlage.mapButtons = [zoomRein, zoomRaus, bewegen, zentrieren]
            return
        }
        vorlage.leadingNavigationBarButtons = [
            CPBarButton(title: "Fahrten") { [weak self] _ in self?.listeZeigen(self?.liste) },
            CPBarButton(title: "Dienst") { [weak self] _ in self?.listeZeigen(self?.dienstListe) },
        ]
        // Ohne Schritt bleibt „Karte bewegen“ oben, mit Schritt nur der runde Knopf an der Karte.
        let rechts = schrittKnopf ?? CPBarButton(title: "Karte bewegen") { [weak self] _ in
            self?.kartenVorlage?.showPanningInterface(animated: true)
        }
        vorlage.trailingNavigationBarButtons = (details.map { f in
            [CPBarButton(title: "Details") { [weak self] _ in self?.fahrtZeigen(f.id) }]
        } ?? []) + [rechts]
        vorlage.mapButtons = [zoomRein, zoomRaus, bewegen, zentrieren]
    }

    /// Fahrt fuer „Details“: die im Vorschau-Feld gewaehlte, sonst die erste der Vorschau.
    private var detailFahrt: UhrFahrt? {
        let liste = vorschauFahrten
        return liste.first { $0.id == gewaehlt } ?? liste.first
    }

    /// „Fahrten“ bzw. „Dienst“ eine Ebene hinter der Karte zeigen.
    private func listeZeigen(_ vorlage: CPListTemplate?) {
        guard let steuerung, let vorlage, !arbeitet else { return }
        listeFuellen()
        let schieben = { [weak self] in
            self?.steuerung?.pushTemplate(vorlage, animated: true, completion: CarPlayFehler.melden)
        }
        if steuerung.templates.count > 1 {
            fahrtVorlage = nil
            fahrtAngezeigt = nil
            steuerung.popToRootTemplate(animated: false) { ok, fehler in
                CarPlayFehler.melden(ok, fehler)
                schieben()
            }
        } else {
            schieben()
        }
    }

    // MARK: Naechste Fahrt (Vorschau links)

    struct Anfahrt {
        let stand: Date
        let sekunden: TimeInterval
        let meter: Double
        let linie: [CLLocationCoordinate2D]
        let ort: CLLocationCoordinate2D
        /// Wo das Handy beim Rechnen war. Weiter als 300 m weg: neu rechnen.
        let start: CLLocation?
    }

    /// Die laufende Fahrt, sonst die naechste angenommene.
    private var naechsteFahrt: UhrFahrt? {
        stand.fahrten.first(where: \.laeuft) ?? stand.fahrten.first { !$0.offen }
    }

    /// Fahrten im Vorschau-Feld, hoechstens fuenf. Der Knopf hat nur einen Text fuer alle Fahrten, und ein
    /// Neuaufbau beim Blaettern laesst CarPlay die Auswahl hin und her springen (Protokoll 19.11.). Darum:
    ///   Laufende Fahrt     – laufende zuerst, dann angenommene („Navigation starten“). Offene kommen als Hinweis.
    ///   Offene Anfragen    – nur die offenen („Annehmen“).
    ///   Sonst              – angenommene („Navigation starten“).
    private var vorschauFahrten: [UhrFahrt] {
        let laufend = stand.fahrten.filter(\.laeuft)
        let angenommen = stand.fahrten.filter { !$0.laeuft && !$0.offen }
        let offen = stand.fahrten.filter { !$0.laeuft && $0.offen }
        if !laufend.isEmpty { return Array((laufend + angenommen).prefix(5)) }
        if !offen.isEmpty { return Array(offen.prefix(5)) }
        return Array(angenommen.prefix(5))
    }

    /// Eigene Fuehrung nur mit Route von der Dispo und Gast an Bord, sonst Google Maps wie bisher.
    private func eigeneNavigation(_ f: UhrFahrt) -> Bool {
        guard f.phase == "unterwegs", let fahrt = fahrt(f.id) else { return false }
        return !fahrt.routenPunkte.isEmpty
    }

    private func zielName(_ id: UUID) -> String? {
        #if DEBUG
        if NaviFuehrung.testLauf { return "Testfahrt" }
        #endif
        guard let f = stand.fahrten.first(where: { $0.id == id.uuidString }) else { return nil }
        return f.phase == "unterwegs" ? f.nach : f.von
    }

    /// Vorschau-Feld der Vorlage: alle kommenden Fahrten zum Blaettern (wie die Fahrtkarten der Fahrer-App):
    /// Abfahrt beim Gast gross im Titel, Abholort bzw. Ziel, Gast, Flug, Status, Anfahrt. Die Karte zeigt die
    /// gewaehlte Fahrt. Nur neu zeigen, wenn sich etwas aendert (sonst flackert das Feld bei jeder Standort-Sendung).
    private func vorschauZeigen() {
        guard let vorlage = kartenVorlage, let karte, let fuehrung, !verschiebtKarte else { return }
        guard !fuehrung.laeuft else {
            // In der Fuehrung zeichnet CarPlayFuehrung, die Vorschau kommt weg.
            karte.vorschauSetzen(anfahrt: [], fahrt: [], abhol: nil, ziel: nil)
            return
        }
        let liste = angemeldet ? vorschauFahrten : []
        guard !liste.isEmpty else {
            if vorschauReise != nil {
                vorlage.hideTripPreviews()
                vorschauReise = nil
                vorschauReisen = []
                vorschauSchluessel = ""
                gewaehlt = nil
                karte.vorschauSetzen(anfahrt: [], fahrt: [], abhol: nil, ziel: nil)
                karte.folgen()
                knoepfeSetzen()
            }
            return
        }
        if !liste.contains(where: { $0.id == gewaehlt }) { gewaehlt = liste.first?.id }
        fahrtLinienLaden(liste.map(\.id))
        // Anfahrt je Fahrt neu rechnen: keine da, aelter als 5 Minuten oder das Handy ist ueber 300 m weiter.
        for f in liste {
            let a = navigationsZiel(f).adresse
            if let alt = anfahrten[a], Date().timeIntervalSince(alt.stand) <= 300, !weggefahren(seit: alt) { continue }
            anfahrtRechnen(a)
        }
        // Feld nur neu aufbauen, wenn sich der Text aendert. Neue Anfahrt oder Fahrtroute aendern nur
        // Dauer/km und die Karte (sonst springt das Feld am Anfang ein paar Mal, Test 19.11.).
        let schluessel = liste.map { f in
            [f.id, f.zeit, f.status, f.phase ?? "", "\(f.offen)", "\(eigeneNavigation(f))", navigationsZiel(f).adresse,
             f.gaeste?.first ?? "", f.flug, f.flugStatus ?? "", f.flugAnkunft ?? "",
             f.laeuft ? "" : anfahrtText(f)].joined(separator: "|")
        }.joined(separator: "#")
        guard schluessel != vorschauSchluessel else {
            schaetzungenSetzen(liste)
            if let f = liste.first(where: { $0.id == gewaehlt }) { karteZeigen(f) }
            return
        }
        vorschauSchluessel = schluessel

        let reisen = liste.map(reise)
        let auswahl = reisen.first { ($0.userInfo as? String) == gewaehlt } ?? reisen.first
        vorschauReise = auswahl
        vorschauReisen = reisen
        let gewaehlteFahrt = liste.first { $0.id == gewaehlt }
        startText = liste.allSatisfy(\.offen) ? "Annehmen" : "Navigation starten"
        vorlage.showTripPreviews(reisen, selectedTrip: auswahl, textConfiguration: Self.textKonfig(startText))
        geschaetzt = [:]
        schaetzungenSetzen(liste)
        if let f = gewaehlteFahrt { karteZeigen(f) }
        knoepfeSetzen()
    }

    /// Fahrt fuer das Vorschau-Feld. Ab iOS 26.4 mit CPNavigationWaypoint: Name = Titel, Adresse (Zeilen mit
    /// Zeilenumbruch) = graue Zeile. Vorher MKMapItem, dann wiederholt CarPlay grau nur den Namen.
    private static func reiseBauen(punkt: CLLocationCoordinate2D, titel: String, adresse: [String], wahl: CPRouteChoice) -> CPTrip {
        if #available(iOS 26.4, *) {
            let mitte = CPLocationCoordinate3D(latitude: punkt.latitude, longitude: punkt.longitude, altitude: 0)
            let text = adresse.joined(separator: "\n")
            let ziel: CPNavigationWaypoint
            if #available(iOS 27.0, *) {
                ziel = CPNavigationWaypoint(centerPoint: mitte, locationThreshold: nil, nameVariants: [titel],
                                            addressVariants: text.isEmpty ? [] : [text], entryPoints: [], timeZone: nil)
            } else {
                ziel = CPNavigationWaypoint(centerPoint: mitte, locationThreshold: nil, name: titel,
                                            address: text.isEmpty ? nil : text, entryPoints: [], timeZone: nil)
            }
            let start = CPNavigationWaypoint(mapItem: MKMapItem.forCurrentLocation(), locationThreshold: nil, entryPoints: [])
            return CPTrip(originWaypoint: start, destinationWaypoint: ziel, routeChoices: [wahl])
        }
        let zielOrt = MKMapItem(placemark: MKPlacemark(coordinate: punkt))
        zielOrt.name = titel
        return CPTrip(origin: MKMapItem.forCurrentLocation(), destination: zielOrt, routeChoices: [wahl])
    }

    /// Flug- oder Zugnummer. Fahrten ohne beides tragen in der App den Platzhalter „STADTFAHRT“, der gehoert
    /// nicht ins Autodisplay.
    static func flugNummer(_ f: UhrFahrt) -> String? {
        let n = f.flug.trimmingCharacters(in: .whitespaces)
        return n.isEmpty || n.uppercased() == "STADTFAHRT" ? nil : n
    }

    /// Laenge einer Linie in Metern.
    static func laenge(_ punkte: [CLLocationCoordinate2D]) -> Double {
        zip(punkte, punkte.dropFirst()).reduce(0) { summe, paar in
            summe + CLLocation(latitude: paar.0.latitude, longitude: paar.0.longitude)
                .distance(from: CLLocation(latitude: paar.1.latitude, longitude: paar.1.longitude))
        }
    }

    /// „Anfahrt 25 min · 12 km“ fuer den Text, leer ohne Route.
    private func anfahrtText(_ f: UhrFahrt) -> String {
        guard let a = anfahrten[navigationsZiel(f).adresse], a.sekunden >= 0 else { return "" }
        return "Anfahrt \(Int((a.sekunden / 60).rounded(.up))) min · \(NaviText.reststrecke(a.meter))"
    }

    /// Zuletzt gemeldete Dauer je Fahrt im Feld, damit nur Aenderungen an CarPlay gehen.
    private var geschaetzt: [String: TimeInterval] = [:]

    /// Dauer und km der Anfahrt in die Eintraege des Feldes, ohne es neu aufzubauen.
    private func schaetzungenSetzen(_ liste: [UhrFahrt]) {
        guard let vorlage = kartenVorlage else { return }
        for r in vorschauReisen {
            guard let id = r.userInfo as? String, let f = liste.first(where: { $0.id == id }),
                  let a = anfahrten[navigationsZiel(f).adresse], a.sekunden >= 0 else { continue }
            // Laufend: Route vom Handy zum Ziel. Sonst wie die ETA der Fahrtkarte am Handy
            // (SoloNormalAnsicht.eta): geplante Abfahrt (ueberfaellig: jetzt) plus Fahrzeit vom Gast zum Ziel.
            // CarPlay schreibt „Ankunft“ = jetzt + Dauer, darum die Dauer bis zu dieser ETA.
            var sekunden = a.sekunden
            var meter = a.meter
            if !f.laeuft {
                guard let geplant = f.zeitpunkt, let fahrzeit = fahrzeiten[id] ?? nil, fahrzeit > 0 else { continue }
                let eta = max(geplant, Date()).addingTimeInterval(Double(fahrzeit) * 60)
                sekunden = max(0, eta.timeIntervalSinceNow)
                meter += Self.laenge(fahrtLinien[id] ?? [])
            }
            let minute = (sekunden / 60).rounded()
            guard geschaetzt[id] != minute else { continue }
            geschaetzt[id] = minute
            vorlage.updateEstimates(CPTravelEstimates(distanceRemaining: strecke(meter), timeRemaining: sekunden), for: r)
        }
    }

    /// Alle Fahrten im Feld, damit der Knopftext beim Blaettern ohne Neuaufbau getauscht werden kann.
    private var vorschauReisen: [CPTrip] = []

    private static func textKonfig(_ start: String) -> CPTripPreviewTextConfiguration {
        CPTripPreviewTextConfiguration(startButtonTitle: start, additionalRoutesButtonTitle: nil, overviewButtonTitle: nil)
    }

    private func weggefahren(seit a: Anfahrt) -> Bool {
        guard let jetzt = standort?.ort, let damals = a.start else { return a.start == nil && standort?.ort != nil }
        return jetzt.distance(from: damals) > 300
    }

    /// Eine Fahrt als Eintrag im Vorschau-Feld.
    ///   Titel     – geplante Abfahrt beim Gast und Abholort (gross). Ab „beim Gast“ das Ziel.
    ///   Zeile 1   – Zeit, Gast, Flug (laengste Fassung zuerst, CarPlay kuerzt selbst).
    ///   Zeile 2   – Status und wohin: „Neu · noch offen“, „Beim Gast“, „Mit Gast“, sonst „→ Ziel“.
    private func reise(_ f: UhrFahrt) -> CPTrip {
        let zumZiel = Self.zumZiel(f)
        let anfahrt = anfahrten[navigationsZiel(f).adresse]
        let punkt = anfahrt?.ort ?? standort?.ort?.coordinate ?? KarteAnsicht.mitte
        // Titel gross: vor dem Gast die Abholzeit, ab „beim Gast“ das Ziel. Grau darunter steht die Adresse des
        // Ziels (CPNavigationWaypoint.address, ab iOS 26.4): vor dem Gast Abholort, Strasse, Ort, sonst Strasse, Ort.
        let fahrtDaten = fahrt(f.id)
        let ortName = zumZiel ? (fahrtDaten?.zielName ?? f.nach) : (fahrtDaten?.abholName ?? f.von)
        let ortAdresse = zumZiel ? (fahrtDaten?.zielAdresse ?? "") : (fahrtDaten?.abholAdresse ?? "")
        // Teile der Adresse ohne den Namen (steht schon im Titel bzw. davor) und ohne „Deutschland“.
        let teile = Adresse.normal(ortAdresse).split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { t in !t.isEmpty && t.lowercased() != ortName.lowercased() && !["deutschland", "germany"].contains(t.lowercased()) }
        let adressZeilen = (zumZiel || ortName.isEmpty ? [] : [ortName]) + teile
        let titel = zumZiel ? f.nach : f.zeit
        let gast = f.gaeste?.first
        let flug = Self.flugNummer(f).map { $0 + (f.flugAnkunft.map { " · \(f.flugStatus == "Gelandet" ? "gelandet" : "Landung") \($0)" } ?? "") }
        let lang = ([f.zeit, gast, flug].compactMap { $0 }).joined(separator: " · ")
        let mittel = ([f.zeit, gast].compactMap { $0 }).joined(separator: " · ")
        let wohin: String
        switch true {
        // CarPlay wiederholt den Titel grau darunter (eigene Zeile nicht abschaltbar). Darum steht der Abholort
        // hier in der Zeile, oben nur die Zeit; ab „beim Gast“ oben das Ziel und hier nur der Stand.
        case f.offen: wohin = "Neu · \(f.von) → \(f.nach)"
        case f.phase == "beimGast": wohin = "Beim Gast"
        case zumZiel: wohin = eigeneNavigation(f) ? "Unterwegs · Route von Dispo" : "Unterwegs"
        default: wohin = "\(f.von) → \(f.nach)"
        }
        // CarPlay zeigt die Zusammenfassung (Zeit, Gast, Flug) nicht, nur diese Zeile: Gast und Flug mit hinein.
        let anfahrtZeile = f.laeuft ? nil : Optional(anfahrtText(f)).flatMap { $0.isEmpty ? nil : $0 }
        let zeile = ([wohin, gast, flug, anfahrtZeile].compactMap { $0 }).joined(separator: " · ")
        let kurz = ([wohin, gast, anfahrtZeile].compactMap { $0 }).joined(separator: " · ")
        let wahl = CPRouteChoice(summaryVariants: Self.eindeutig([lang, mittel, f.zeit]),
                                 additionalInformationVariants: Self.eindeutig([zeile, kurz, wohin]),
                                 selectionSummaryVariants: [f.zeit])
        let r = Self.reiseBauen(punkt: punkt, titel: titel, adresse: adressZeilen, wahl: wahl)
        r.userInfo = f.id
        return r
    }

    /// Karte rechts wie die Fahrtkarte am Handy: vor dem Gast die Anfahrt (Lime, gestrichelt) und die Fahrt
    /// vom Gast zum Ziel (Blau), Pins am Abholort und am Ziel. Ab „beim Gast“ die Route vom Handy zum Ziel.
    private func karteZeigen(_ f: UhrFahrt) {
        guard let karte else { return }
        let fahrtLinie = fahrtLinien[f.id] ?? []
        let anfahrt = anfahrten[navigationsZiel(f).adresse]
        let zumZiel = Self.zumZiel(f)
        if zumZiel {
            // Beim Gast oder mit Gast: Route von meinem Standort zum Ziel (wie Fahrer- und Dispo-Karte).
            let ziel = anfahrt?.ort ?? fahrtLinie.last
            karte.vorschauSetzen(anfahrt: [], fahrt: anfahrt?.linie ?? [], abhol: nil, ziel: ziel)
        } else {
            let abhol = fahrtLinie.first ?? anfahrt?.ort
            karte.vorschauSetzen(anfahrt: anfahrt?.linie ?? [], fahrt: fahrtLinie, abhol: abhol, ziel: fahrtLinie.last)
        }
        // Hat der Fahrer die Karte verschoben, bleibt sie dort (zurueck mit Zentrieren).
        if karte.modus != .frei { karte.uebersicht() }
    }

    /// Fahrtroute (Gast -> Ziel) der Fahrten im Feld einmal vom Server holen.
    private func fahrtLinienLaden(_ ids: [String]) {
        let fehlen = ids.filter { fahrtLinien[$0] == nil && !fahrtLinienLaeuft.contains($0) }
        guard !fehlen.isEmpty else { return }
        fahrtLinienLaeuft.formUnion(fehlen)
        struct Zeile: Decodable {
            let id: String
            let ext_route_polyline: String?
            let ext_route_duration_mins: Int?
            let ext_route_duration_in_traffic_mins: Int?
        }
        Task { [weak self] in
            let zeilen: [Zeile] = (try? await Backend.client.from("jobs")
                .select("id,ext_route_polyline,ext_route_duration_mins,ext_route_duration_in_traffic_mins")
                .in("id", values: fehlen).execute().value) ?? []
            guard let self else { return }
            fahrtLinienLaeuft.subtract(fehlen)
            for z in zeilen {
                fahrtLinien[z.id.lowercased()] = FahrtDetails.polylineLesen(z.ext_route_polyline)
                fahrzeiten[z.id.lowercased()] = z.ext_route_duration_in_traffic_mins ?? z.ext_route_duration_mins
            }
            for id in fehlen where fahrtLinien[id.lowercased()] == nil { fahrtLinien[id.lowercased()] = [] }
            // Die IDs im Stand sind gross geschrieben (uuidString), die Datenbank liefert klein.
            for id in fehlen {
                fahrtLinien[id] = fahrtLinien[id.lowercased()]
                fahrzeiten[id] = fahrzeiten[id.lowercased()] ?? nil
                // Keine Route vom Server: selbst rechnen (Apple-Routing Abholort -> Ziel).
                if fahrtLinien[id]?.isEmpty != false { await fahrtSelbstRechnen(id) }
            }
            vorschauZeigen()
        }
    }

    /// Route vom Gast zum Ziel ueber Apple-Routing, wenn der Server keine hat (Fahrten ohne ext_route_polyline).
    private func fahrtSelbstRechnen(_ id: String) async {
        guard let fahrt = fahrt(id) else { return }
        func ort(_ name: String, _ adresse: String) async -> CLLocationCoordinate2D? {
            let text = Adresse.fuerNavigation(name: name, adresse: adresse)
            if let p = Self.koordinaten(text) { return p }
            return try? await CLGeocoder().geocodeAddressString(text).first?.location?.coordinate
        }
        guard let von = await ort(fahrt.abholOrtID != nil && !fahrt.abholAdresse.isEmpty ? "" : fahrt.abholName, fahrt.abholAdresse),
              let nach = await ort(fahrt.zielOrtID != nil && !fahrt.zielAdresse.isEmpty ? "" : fahrt.zielName, fahrt.zielAdresse)
        else { return }
        let anfrage = MKDirections.Request()
        anfrage.source = MKMapItem(placemark: MKPlacemark(coordinate: von))
        anfrage.destination = MKMapItem(placemark: MKPlacemark(coordinate: nach))
        anfrage.transportType = .automobile
        guard let r = try? await MKDirections(request: anfrage).calculate().routes.first else {
            fahrtLinien[id] = [von, nach]
            return
        }
        var linie = [CLLocationCoordinate2D](repeating: kCLLocationCoordinate2DInvalid, count: r.polyline.pointCount)
        r.polyline.getCoordinates(&linie, range: NSRange(location: 0, length: r.polyline.pointCount))
        fahrtLinien[id] = linie
        if (fahrzeiten[id] ?? nil) == nil { fahrzeiten[id] = Int((r.expectedTravelTime / 60).rounded(.up)) }
    }

    /// Anfahrt vom Handy zur Adresse ueber Apple-Routing (Dauer, km, Linie fuer die Karte).
    private func anfahrtRechnen(_ adresse: String) {
        guard !adresse.isEmpty, !anfahrtLaeuft.contains(adresse) else { return }
        anfahrtLaeuft.insert(adresse)
        let start = standort?.ort
        Task { [weak self] in
            defer { self?.anfahrtLaeuft.remove(adresse) }
            let ort: CLLocationCoordinate2D?
            if let p = Self.koordinaten(adresse) {
                ort = p
            } else {
                ort = try? await CLGeocoder().geocodeAddressString(adresse).first?.location?.coordinate
            }
            guard let ort else { return }
            let anfrage = MKDirections.Request()
            anfrage.source = start.map { MKMapItem(placemark: MKPlacemark(coordinate: $0.coordinate)) } ?? MKMapItem.forCurrentLocation()
            anfrage.destination = MKMapItem(placemark: MKPlacemark(coordinate: ort))
            anfrage.transportType = .automobile
            let route = try? await MKDirections(request: anfrage).calculate().routes.first
            guard let self else { return }
            var linie: [CLLocationCoordinate2D] = []
            if let r = route {
                linie = [CLLocationCoordinate2D](repeating: kCLLocationCoordinate2DInvalid, count: r.polyline.pointCount)
                r.polyline.getCoordinates(&linie, range: NSRange(location: 0, length: r.polyline.pointCount))
            }
            anfahrten[adresse] = Anfahrt(stand: Date(), sekunden: route?.expectedTravelTime ?? -1,
                                         meter: route?.distance ?? -1, linie: linie, ort: ort, start: start)
            vorschauZeigen()
        }
    }

    /// "48.1,11.5" direkt als Ort.
    private static func koordinaten(_ text: String) -> CLLocationCoordinate2D? {
        let teile = text.split(separator: ",").map { Double($0.trimmingCharacters(in: .whitespaces)) }
        guard teile.count == 2, let lat = teile[0], let lng = teile[1], abs(lat) <= 90, abs(lng) <= 180 else { return nil }
        return CLLocationCoordinate2D(latitude: lat, longitude: lng)
    }

    private func eigeneFuehrungStarten(_ f: UhrFahrt) {
        guard let id = UUID(uuidString: f.id) else { return }
        zurueckZurKarte { [weak self] in
            self?.fuehrung?.starten(fahrtID: id, start: self?.standort?.ort)
        }
    }

    /// Ende der Route erreicht: naechster Schritt der Fahrt (Gast ist da, Fahrt beenden, Gast anrufen).
    private func angekommen(_ id: UUID) {
        guard stand.fahrten.contains(where: { $0.id == id.uuidString }) else { return }
        fahrtZeigen(id.uuidString)
    }

    /// Gast steigt ein: die laufende Fuehrung bekommt die neue Phase (wie onChange in NavigationAnsicht).
    private func phaseMelden() {
        guard let id = NaviFuehrung.geteilt.fahrtID,
              let f = stand.fahrten.first(where: { $0.id == id.uuidString }) else { return }
        fuehrung?.phase(fahrtID: id, unterwegs: f.phase == "unterwegs")
    }

    // MARK: CPMapTemplateDelegate

    /// Andere Fahrt im Vorschau-Feld: Karte und „Details“ folgen.
    func mapTemplate(_ mapTemplate: CPMapTemplate, selectedPreviewFor trip: CPTrip, using routeChoice: CPRouteChoice) {
        guard let id = trip.userInfo as? String, let f = stand.fahrten.first(where: { $0.id == id }) else { return }
        gewaehlt = id
        vorschauReise = trip
        karteZeigen(f)
        knoepfeSetzen()

    }

    /// Knopf im Vorschau-Feld: offene Fahrt annehmen, sonst „Navigation starten“.
    func mapTemplate(_ mapTemplate: CPMapTemplate, startedTrip trip: CPTrip, using routeChoice: CPRouteChoice) {
        guard let id = trip.userInfo as? String, let f = stand.fahrten.first(where: { $0.id == id }) else { return }
        if f.offen {
            antworten(f, annehmen: true)
        } else {
            navigationStarten(f)
        }
    }

    /// Das Auto startet seine eigene Navigation: unsere sofort beenden (Apple-Pflicht).
    func mapTemplateDidCancelNavigation(_ mapTemplate: CPMapTemplate) {
        fuehrung?.vomAutoBeendet()
    }

    func mapTemplateDidShowPanningInterface(_ mapTemplate: CPMapTemplate) {
        verschiebtKarte = true
        knoepfeSetzen()
    }

    func mapTemplateDidDismissPanningInterface(_ mapTemplate: CPMapTemplate) {
        verschiebtKarte = false
        knoepfeSetzen()
        vorschauZeigen()
    }

    func mapTemplate(_ mapTemplate: CPMapTemplate, panWith direction: CPMapTemplate.PanDirection) {
        karte?.verschieben(direction)
    }

    func mapTemplateDidBeginPanGesture(_ mapTemplate: CPMapTemplate) {
        karte?.gesteBeginnt()
    }

    func mapTemplate(_ mapTemplate: CPMapTemplate, didUpdatePanGestureWithTranslation translation: CGPoint, velocity: CGPoint) {
        karte?.gesteBewegt(translation)
    }

    func mapTemplate(_ mapTemplate: CPMapTemplate, didEndPanGestureWithVelocity velocity: CGPoint) {
        karte?.gesteEndet(velocity: velocity)
    }

    /// Zwei-Finger-Zoom, liefert CarPlay erst ab iOS 26. Darunter bleiben + und −.
    @available(iOS 26.0, *)
    func mapTemplateDidBeginZoomGesture(_ mapTemplate: CPMapTemplate) {
        karte?.zoomBeginnt()
    }

    @available(iOS 26.0, *)
    func mapTemplate(_ mapTemplate: CPMapTemplate, didUpdateZoomGestureWithCenter center: CGPoint, scale: CGFloat, velocity: CGFloat) {
        karte?.zoomBewegt(mitte: center, scale: scale, velocity: velocity)
    }

    @available(iOS 26.0, *)
    func mapTemplate(_ mapTemplate: CPMapTemplate, didEndZoomGestureWithVelocity velocity: CGFloat) {
        karte?.zoomEndet()
    }

    /// Laeuft eine andere App im Vordergrund, kommen die Manoever als Mitteilung.
    func mapTemplate(_ mapTemplate: CPMapTemplate, shouldShowNotificationFor maneuver: CPManeuver) -> Bool { true }

    func mapTemplate(_ mapTemplate: CPMapTemplate, shouldUpdateNotificationFor maneuver: CPManeuver,
                     with travelEstimates: CPTravelEstimates) -> Bool { true }

    // MARK: Aktionen (gleiche Wege wie die Uhr)

    /// `fahrtID`: Fahrt, fuer die die Aktion ist. Nur wenn genau die noch offen ist, geht es zurueck zur Liste.
    private func ausfuehren(_ nachricht: [String: Any], fahrtID: String? = nil) {
        guard !arbeitet else { return }
        arbeitet = true
        Task { [weak self] in
            #if DEBUG
            let ok = Self.beispielLauf ? true : await UhrBruecke.shared.aktion(nachricht)
            #else
            let ok = await UhrBruecke.shared.aktion(nachricht)
            #endif
            guard let self else { return }
            arbeitet = false
            // Meldung erst, wenn das Zurueck fertig ist (sonst schlaegt sie fehl).
            let danach = { [weak self] in
                guard let self else { return }
                if ok { neuesMelden() } else { meldung("Hat nicht geklappt. Bitte am iPhone prüfen.") }
            }
            if let fahrtID, zeigtFahrt(fahrtID) {
                zurueckZurListe(dann: danach)
            } else {
                fahrtAuffrischen()
                danach()
            }
        }
    }

    /// Nur zurueck, wenn eine Fahrt oben ist (dann zur Liste bzw. zur Karte darunter). `dann` nach dem Zurueck.
    private func zurueckZurListe(dann: (() -> Void)? = nil) {
        guard let steuerung, steuerung.topTemplate is CPInformationTemplate else { dann?(); return }
        fahrtVorlage = nil
        fahrtAngezeigt = nil
        steuerung.popTemplate(animated: true) { ok, fehler in
            CarPlayFehler.melden(ok, fehler)
            dann?()
        }
    }

    /// Alles hinter der Karte schliessen (Fuehrung startet, Ankunft). `dann` danach.
    private func zurueckZurKarte(dann: (() -> Void)? = nil) {
        guard let steuerung, steuerung.templates.count > 1 else { dann?(); return }
        fahrtVorlage = nil
        fahrtAngezeigt = nil
        steuerung.popToRootTemplate(animated: true) { ok, fehler in
            CarPlayFehler.melden(ok, fehler)
            dann?()
        }
    }

    private func antworten(_ f: UhrFahrt, annehmen: Bool) {
        ausfuehren([UhrAktion.art: UhrAktion.fahrt, "id": f.id, "annehmen": annehmen, "quelle": "carplay"], fahrtID: f.id)
    }

    private func ablehnenFragen(_ f: UhrFahrt) {
        frage("Fahrt \(f.zeit) ablehnen?", ja: "Ablehnen", stil: .destructive) { [weak self] in self?.antworten(f, annehmen: false) }
    }

    private func schrittFragen(_ f: UhrFahrt, _ schritt: (titel: String, ziel: String, symbol: String)) {
        frage("\(schritt.titel)?", ja: schritt.titel, stil: schritt.ziel == "done" ? .destructive : .default) { [weak self] in
            self?.ausfuehren([UhrAktion.art: UhrAktion.schritt, "id": f.id, "ziel": schritt.ziel], fahrtID: f.id)
        }
    }

    private func dienstNachricht(_ d: UhrDienst, annehmen: Bool) -> [String: Any] {
        [UhrAktion.art: UhrAktion.dienst, "id": d.id, "annehmen": annehmen, "quelle": "carplay"]
    }

    /// Dienstanfrage aus der Liste: Annehmen, Ablehnen (mit eigener Rueckfrage) oder Abbrechen.
    private func dienstFragen(_ d: UhrDienst) {
        guard let steuerung, steuerung.presentedTemplate == nil, !arbeitet else { return }
        let zeit = [d.start, d.ende].compactMap { $0 }.joined(separator: "–")
        let titel = "Dienst \(Datum.tagEtikett(d.tag)) \(zeit)".trimmingCharacters(in: .whitespaces)
        let aktionen = [
            CPAlertAction(title: "Annehmen", style: .default) { [weak self] _ in
                self?.schliessen { [weak self] in
                    guard let self else { return }
                    ausfuehren(dienstNachricht(d, annehmen: true))
                }
            },
            CPAlertAction(title: "Ablehnen", style: .destructive) { [weak self] _ in
                self?.schliessen { [weak self] in
                    self?.frage("\(titel) ablehnen?", ja: "Ablehnen", stil: .destructive) { [weak self] in
                        guard let self else { return }
                        ausfuehren(dienstNachricht(d, annehmen: false))
                    }
                }
            },
            CPAlertAction(title: "Abbrechen", style: .cancel) { [weak self] _ in self?.schliessen() },
        ]
        steuerung.presentTemplate(CPActionSheetTemplate(title: titel, message: "Antwort offen", actions: aktionen),
                                  animated: true, completion: CarPlayFehler.melden)
    }

    private func stundenFragen(_ h: UhrStunden) {
        frage("Stunden von heute bestätigen?", ja: "Bestätigen", stil: .default) { [weak self] in
            self?.ausfuehren([UhrAktion.art: UhrAktion.stundenBestaetigen, "id": h.dienstID])
        }
    }

    private func frage(_ titel: String, ja: String, stil: CPAlertAction.Style, _ aktion: @escaping () -> Void) {
        guard !arbeitet else { return }
        alarm([titel], [
            CPAlertAction(title: ja, style: stil) { [weak self] _ in self?.schliessen(dann: aktion) },
            CPAlertAction(title: "Abbrechen", style: .cancel) { [weak self] _ in self?.schliessen() },
        ])
    }

    private func meldung(_ text: String) {
        alarm([text], [CPAlertAction(title: "OK", style: .cancel) { [weak self] _ in self?.schliessen() }])
    }

    /// Hinweis, Frage oder Meldung zeigen, hoechstens mit CPAlertTemplate.maximumActionCount Knoepfen.
    /// `fertig` bekommt, ob die Vorlage wirklich zu sehen ist.
    @discardableResult
    private func alarm(_ titel: [String], _ aktionen: [CPAlertAction], fertig: ((Bool) -> Void)? = nil) -> CPAlertTemplate? {
        guard let steuerung, steuerung.presentedTemplate == nil else { return nil }
        let vorlage = CPAlertTemplate(titleVariants: titel, actions: Array(aktionen.prefix(Int(CPAlertTemplate.maximumActionCount))))
        steuerung.presentTemplate(vorlage, animated: true) { ok, fehler in
            CarPlayFehler.melden(ok, fehler)
            fertig?(ok)
        }
        return vorlage
    }

    /// Gezeigte Vorlage (Hinweis, Frage, Auswahl) schliessen. Danach `dann` und der naechste wartende Hinweis.
    private func schliessen(dann: (() -> Void)? = nil) {
        guard let steuerung, let oben = steuerung.presentedTemplate else { dann?(); return }
        if oben === hinweisVorlage {
            hinweisID = nil
            hinweisVorlage = nil
        }
        steuerung.dismissTemplate(animated: true) { [weak self] ok, fehler in
            CarPlayFehler.melden(ok, fehler)
            guard let dann else { self?.neuesMelden(); return }
            dann()
            // Zeigt `dann` selbst etwas (Frage, Meldung), bleibt der Hinweis wartend, bis das zu ist.
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { self?.neuesMelden() }
        }
    }

    // MARK: Neue Fahrt, neue Dienstanfrage

    /// Kommt eine neue Fahrt oder Dienstanfrage dazu, die noch eine Antwort braucht, sofort fragen.
    /// Ist gerade etwas anderes zu sehen, wartet der Hinweis und kommt, sobald es geschlossen ist.
    private func neuesMelden() {
        let offen = Set(stand.fahrten.filter(\.offen).map(\.id) + stand.dienste.filter(\.offen).map(\.id))
        // Gezeigter Hinweis gilt nicht mehr (woanders beantwortet oder weg): schliessen.
        if let id = hinweisID, !offen.contains(id), let steuerung, let vorlage = hinweisVorlage,
           steuerung.presentedTemplate === vorlage {
            schliessen()
            return
        }
        // Nicht offene brauchen nie einen Hinweis.
        bekannt.formUnion(stand.fahrten.filter { !$0.offen }.map(\.id))
        bekannt.formUnion(stand.dienste.filter { !$0.offen }.map(\.id))
        // Der erste Stand nach dem Verbinden steht schon in der Liste, dafuer kein Hinweis.
        if ersterStand {
            bekannt.formUnion(offen)
            if Geteilt.fahrten.geladen { ersterStand = false }
            return
        }
        guard hinweisID == nil, !arbeitet, let steuerung, steuerung.presentedTemplate == nil else { return }
        if let neu = stand.fahrten.first(where: { $0.offen && !bekannt.contains($0.id) }) {
            hinweisFahrt(neu)
        } else if let neu = stand.dienste.first(where: { $0.offen && !bekannt.contains($0.id) }) {
            hinweisDienst(neu)
        }
    }

    private func hinweisFahrt(_ neu: UhrFahrt) {
        // Nicht heute: Tag mit nennen ("Neue Fahrt morgen um 18:10").
        let tag = neu.tag == Datum.tagWert(Date()) ? "" : " " + Datum.tagEtikett(neu.tag).lowercased()
        hinweisZeigen(neu.id, titel: ["Neue Fahrt\(tag) um \(neu.zeit): \(neu.von) nach \(neu.nach)", "Neue Fahrt\(tag) um \(neu.zeit)"],
                      annehmen: [UhrAktion.art: UhrAktion.fahrt, "id": neu.id, "annehmen": true, "quelle": "carplay"], fahrtID: neu.id)
    }

    private func hinweisDienst(_ neu: UhrDienst) {
        let zeit = [neu.start, neu.ende].compactMap { $0 }.joined(separator: "–")
        hinweisZeigen(neu.id, titel: ["Neuer Dienst \(Datum.tagEtikett(neu.tag)) \(zeit)".trimmingCharacters(in: .whitespaces), "Neuer Dienst"],
                      annehmen: dienstNachricht(neu, annehmen: true), fahrtID: nil)
    }

    /// Nur zwei Knoepfe: bei drei kuerzt CarPlay "Annehmen". Ablehnen geht in der Fahrt-Ansicht bzw. ueber
    /// die Dienstanfrage in der Liste, so lehnt auch niemand waehrend der Fahrt aus Versehen ab.
    /// Als bekannt gilt der Hinweis erst, wenn er wirklich zu sehen war.
    private func hinweisZeigen(_ id: String, titel: [String], annehmen: [String: Any], fahrtID: String?) {
        hinweisID = id
        let vorlage = alarm(titel, [
            CPAlertAction(title: "Annehmen", style: .default) { [weak self] _ in
                self?.schliessen { self?.ausfuehren(annehmen, fahrtID: fahrtID) }
            },
            CPAlertAction(title: "Später", style: .cancel) { [weak self] _ in self?.schliessen() },
        ]) { [weak self] ok in
            guard let self else { return }
            if ok {
                bekannt.insert(id)
            } else if hinweisID == id {
                hinweisID = nil
                hinweisVorlage = nil
            }
        }
        if let vorlage { hinweisVorlage = vorlage } else { hinweisID = nil }
    }

    // MARK: Hilfen

    /// Naechster Schritt wie SchrittKnoepfe der Uhr.
    static func schritt(_ f: UhrFahrt) -> (titel: String, ziel: String, symbol: String)? {
        switch f.phase {
        case "unterwegs": return ("Fahrt beendet", "done", "flag.checkered")
        case "beimGast": return ("Gast an Bord", "in_progress", "person.badge.plus")
        // Angenommen, noch nicht beim Gast: Ankunft am Abholort von Hand melden (at_pickup, wie in der App).
        default: return f.offen ? nil : ("Beim Gast", "at_pickup", "mappin.and.ellipse")
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
        Task { [weak self] in
            var schritt = 0
            while self?.steuerung != nil {
                try? await Task.sleep(for: .seconds(7))
                self?.beispielSchritt(schritt % 5)
                schritt += 1
            }
        }
    }

    private func beispielSchritt(_ nummer: Int) {
        let f = stand.fahrten
        switch nummer {
        case 0:
            if f.indices.contains(0) { fahrtZeigen(f[0].id) }
        case 1:
            if f.indices.contains(0) { navigationWaehlen(f[0]) }
        case 2:
            schliessen { [weak self] in
                guard let self, f.indices.contains(2) else { return }
                fahrtZeigen(f[2].id)
            }
        case 3:
            zurueckZurListe { [weak self] in
                guard let self, f.indices.contains(4) else { return }
                hinweisFahrt(f[4])
            }
        default:
            schliessen()
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
    /// TRISAR-Flaeche #242525, Hintergrund der Abbiegehinweise in der Fuehrung.
    static let flaeche = UIColor(red: 0x24 / 255, green: 0x25 / 255, blue: 0x25 / 255, alpha: 1)

    /// Symbol fuer einen Kartenknopf (CarPlay zeichnet den runden Knopf selbst).
    static func kartenKnopf(_ name: String) -> UIImage? {
        UIImage(systemName: name, withConfiguration: UIImage.SymbolConfiguration(pointSize: 18, weight: .semibold))
    }

    /// TRISAR-Schriftzug in Lime fuer den Listenkopf. Einmal gezeichnet, nicht bei jedem Neuaufbau der Liste.
    static let logo: UIImage? = {
        guard let vorlage = UIImage(named: "TrisarLogo")?.withRenderingMode(.alwaysTemplate) else { return nil }
        let hoehe: CGFloat = 16
        let groesse = CGSize(width: hoehe * vorlage.size.width / max(vorlage.size.height, 1), height: hoehe)
        return UIGraphicsImageRenderer(size: groesse).image { _ in
            lime.set()
            vorlage.draw(in: CGRect(origin: .zero, size: groesse))
        }.withRenderingMode(.alwaysOriginal)
    }()

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

/// CarPlay wirft eine Ausnahme (App-Absturz), wenn ein Vorlagen-Wechsel fehlschlaegt und kein
/// completion-Block gesetzt ist (z. B. Hinweis zeigen, waehrend schon einer offen ist, oder zurueck
/// am Anfang). Absturz 13.11. Build 44. Darum ueberall diesen Block mitgeben: Fehler nur loggen.
enum CarPlayFehler {
    static let melden: (Bool, Error?) -> Void = { _, fehler in
        if let fehler { print("CarPlay:", fehler.localizedDescription) }
    }
}
