import CarPlay
import Combine
import SwiftUI
import UIKit

/// CarPlay-Oberflaeche der Dispo-App. Seit 20.11. Kategorie Navigation (carplay-maps) wie die
/// Fahrer-CarPlay: Startseite ist die Dispo-Karte mit allen Fahrern (DispoCarPlayKarte), oben drei
/// Knoepfe, die die Listen oeffnen:
///   Achtung – was jetzt Handeln braucht: Fahrt ohne Fahrer in der naechsten Stunde, Fahrer zu spaet,
///             Fahrer im Dienst ohne Signal, Fahrt angefragt und noch nicht angenommen.
///   Fahrer  – Standbys mit Zaehlung, darunter die Fahrer im Dienst mit Zustand und naechster Fahrt.
///             Tipp: Fahrzeug, aktuelle und naechste Fahrt, Ankunft, Navigation zum Fahrer.
///             Tipp auf einen Standby: Ort, Zeiten, Fahrer, Navigation zum Standby.
///   Fahrten – die offenen Fahrten von heute. Tipp: Abholung, Ziel, Gast, Fahrer, Status,
///             Navigation zur Abholung.
/// Kommt eine neue Warnung dazu, zeigt CarPlay sie sofort als Hinweis (mehrere nacheinander).
/// Daten aus denselben Speichern wie Handy und Apple Watch (DispoUhrBruecke.karte,
/// DispoFahrtenSpeicher.gemeinsam, DispoStandbySpeicher.gemeinsam) mit deren Realtime.
/// Rechts auf der Karte Zoom, Verschieben und "Alle Fahrer". Navigation zum Fahrer usw. weiter
/// ueber Apple Karten.
@MainActor
final class DispoCarPlaySzene: UIResponder, CPTemplateApplicationSceneDelegate, CPMapTemplateDelegate {
    private var steuerung: CPInterfaceController?
    private var szene: CPTemplateApplicationScene?
    private var fenster: CPWindow?
    private var kartenVorlage: CPMapTemplate?
    private let kartenSteuerung = DispoCarPlayKartenSteuerung()
    private var achtungKnopf: CPBarButton?
    /// Sprachassistent (20.11.), Knopf mit den TRISAR-Balken auf der Karte.
    private var sprache: DispoCarPlaySprache?
    private let achtungListe = CPListTemplate(title: "Achtung", sections: [])
    private let fahrerListe = CPListTemplate(title: "Fahrer", sections: [])
    private let fahrtenListe = CPListTemplate(title: "Fahrten", sections: [])
    private var abos: Set<AnyCancellable> = []
    private var takt: Timer?
    private var stand = DispoCarPlayStand.leer
    /// Warnungen, die beim Verbinden schon da waren oder fuer die der Hinweis schon kam.
    private var bekannt: Set<String> = []
    /// Neue Warnungen, deren Hinweis noch kommt (einer nach dem anderen).
    private var offeneHinweise: [DispoCarPlayWarnung] = []
    private var ersterStand = true
    /// Erster angemeldeter Stand, solange die Fahrten noch laden (dann kein Hinweis-Schwall).
    private var angemeldetSeit: Date?
    /// Konto mit gueltiger Sitzung, aber ohne Dispo-Rolle: nicht jede Minute neu fragen.
    private var ohneZugangFuer: UUID?
    private var prueftGerade = false
    /// Inhalt der Listen beim letzten Fuellen, damit nur bei echter Aenderung neu gesetzt wird.
    private var schluesselAchtung: [String]?
    private var schluesselFahrer: [String]?
    private var schluesselFahrten: [String]?
    /// Offene Einzelansicht, wird bei neuem Stand nachgefuehrt.
    private var offen: OffeneAnsicht?

    private enum Ansicht: Equatable {
        case fahrt(String), fahrer(String), standby(String)
    }

    private struct OffeneAnsicht {
        let ansicht: Ansicht
        let vorlage: CPInformationTemplate
        var schluessel: String
        /// Erst nach dem push auf dem Stapel, vorher nicht als "weg" werten.
        var gezeigt = false
    }

    private struct Inhalt {
        let titel: String
        let punkte: [(String, String)]
        let knoepfe: [(String, () -> Void)]
        var schluessel: String {
            ([titel] + punkte.map { "\($0.0)=\($0.1)" } + knoepfe.map(\.0)).joined(separator: "|")
        }
    }

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
        achtungListe.emptyViewTitleVariants = ["Alles im Plan"]
        achtungListe.emptyViewSubtitleVariants = ["Neue Warnungen erscheinen hier von selbst."]
        fahrerListe.emptyViewTitleVariants = ["Kein Fahrer im Dienst"]
        fahrtenListe.emptyViewTitleVariants = ["Keine Fahrten mehr heute"]

        // Grundansicht: die Dispo-Karte wie am Handy.
        let ansicht = UIHostingController(rootView: DispoCarPlayKarte(daten: DispoUhrBruecke.shared.karte, steuerung: kartenSteuerung))
        ansicht.view.backgroundColor = .black
        window.rootViewController = ansicht
        // Nach dem ersten Laden alle Fahrer einpassen (sonst letzter Ausschnitt vom Handy).
        DispatchQueue.main.asyncAfter(deadline: .now() + 2) { [weak self] in self?.kartenSteuerung.einpassen += 1 }

        let vorlage = CPMapTemplate()
        vorlage.mapDelegate = self
        kartenVorlage = vorlage
        let s = DispoCarPlaySprache(steuerung: interfaceController)
        // Waehrend der Assistent offen war, aufgelaufene Warnungen danach zeigen.
        s.fertig = { [weak self] in
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) { self?.naechsterHinweis() }
        }
        sprache = s
        // Kugel-Bildfolgen nach dem Start vorab erzeugen (dauert einen Moment).
        Task { try? await Task.sleep(for: .seconds(3)); await DispoCarPlayKugel.vorbereiten() }
        knoepfeSetzen()
        interfaceController.setRootTemplate(vorlage, animated: false, completion: CarPlayFehler.melden)

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
            Task { @MainActor in await self?.anmeldungPruefen() }
        }
        fuellen()
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
        DispoUhrBruecke.shared.carPlayVerbunden(false)
        abos.removeAll()
        takt?.invalidate()
        takt = nil
        steuerung = nil
        szene = nil
        sprache?.beenden()
        sprache = nil
        fenster?.rootViewController = nil
        fenster = nil
        kartenVorlage = nil
        achtungKnopf = nil
        offen = nil
        offeneHinweise = []
        schluesselAchtung = nil
        schluesselFahrer = nil
        schluesselFahrten = nil
    }

    /// Ohne Handy-Fenster meldet niemand die Anmeldung an die Bruecke, deshalb selbst nachsehen.
    private func anmeldungPruefen() async {
        guard !prueftGerade else { return }
        prueftGerade = true
        defer { prueftGerade = false }
        let bruecke = DispoUhrBruecke.shared
        if let sitzung = try? await Backend.client.auth.session, !sitzung.isExpired {
            if bruecke.angemeldet {
                ohneZugangFuer = nil
            } else if ohneZugangFuer != sitzung.user.id {
                // nil = Server nicht erreicht, in einer Minute wieder versuchen.
                switch await DispoZugang.ergebnis(sitzung) {
                case true?:
                    ohneZugangFuer = nil
                    if !bruecke.angemeldet {
                        bruecke.setzeAngemeldet(true)
                        DispoFahrtenSpeicher.gemeinsam.starten()
                    }
                case false?:
                    ohneZugangFuer = sitzung.user.id
                case nil:
                    break
                }
            }
            // Waehrend der Pruefung getrennt: nichts mehr anzeigen (carPlayVerbunden bleibt aus).
            guard steuerung != nil else { return }
            if bruecke.angemeldet, DispoStandbySpeicher.gemeinsam.liste == nil { await DispoStandbySpeicher.gemeinsam.starten() }
        } else {
            ohneZugangFuer = nil
        }
        guard steuerung != nil else { return }
        neuerStand()
    }

    private func neuerStand() {
        let warAngemeldet = stand.angemeldet
        stand = DispoCarPlayStand.bauen()
        if warAngemeldet && !stand.angemeldet { abgemeldetAufraeumen() }
        fuellen()
        offeneAnsichtNachfuehren()
        neuesMelden()
    }

    /// Abmeldung: Zahl am Reiter weg, Einzelansicht und Hinweis schliessen, Hinweise vergessen.
    private func abgemeldetAufraeumen() {
        offeneHinweise = []
        ersterStand = true
        angemeldetSeit = nil
        offen = nil
        reiterTitelSetzen("Achtung")
        guard let steuerung else { return }
        if steuerung.presentedTemplate != nil {
            steuerung.dismissTemplate(animated: false, completion: CarPlayFehler.melden)
        }
        if steuerung.templates.count > 1 {
            steuerung.popToRootTemplate(animated: false, completion: CarPlayFehler.melden)
        }
    }

    // MARK: Listen

    private func fuellen() {
        guard stand.angemeldet else {
            let text = ohneZugangFuer != nil ? "Dieses Konto hat keinen Zugang zur Disposition."
                                             : "Bitte in TRISAR Dispo auf dem iPhone anmelden."
            let schluessel = ["hinweis|" + text]
            // Je Vorlage eigene Abschnitte und Zeilen, CarPlay teilt sie nicht zwischen Listen.
            func hinweis() -> [CPListSection] { [CPListSection(items: [CPListItem(text: text, detailText: nil)])] }
            if schluesselAchtung != schluessel { schluesselAchtung = schluessel; achtungListe.updateSections(hinweis()) }
            if schluesselFahrer != schluessel { schluesselFahrer = schluessel; fahrerListe.updateSections(hinweis()) }
            if schluesselFahrten != schluessel { schluesselFahrten = schluessel; fahrtenListe.updateSections(hinweis()) }
            reiterTitelSetzen("Achtung")
            return
        }
        achtungFuellen()
        fahrerFuellen()
        fahrtenFuellen()
    }

    /// Titel am Knopf Achtung (mit Zahl der Warnungen), nur bei Aenderung.
    private func reiterTitelSetzen(_ titel: String) {
        guard let k = achtungKnopf, k.title != titel else { return }
        k.title = titel
    }

    // MARK: Karte

    /// Oben links Achtung und Fahrer, rechts Fahrten. Rechts auf der Karte Sprechen, Zoom, alle Fahrer
    /// (hoechstens vier Kartenknoepfe, Verschieben geht per Wischen).
    private func knoepfeSetzen() {
        guard let vorlage = kartenVorlage else { return }
        let achtung = CPBarButton(title: stand.warnungen.isEmpty || !stand.angemeldet ? "Achtung" : "Achtung \(stand.warnungen.count)") { [weak self] _ in
            self?.listeZeigen(self?.achtungListe)
        }
        achtungKnopf = achtung
        vorlage.leadingNavigationBarButtons = [
            achtung,
            CPBarButton(title: "Fahrer") { [weak self] _ in self?.listeZeigen(self?.fahrerListe) },
        ]
        vorlage.trailingNavigationBarButtons = [
            CPBarButton(title: "Fahrten") { [weak self] _ in self?.listeZeigen(self?.fahrtenListe) },
        ]
        let rein = CPMapButton { [weak self] _ in self?.kartenSteuerung.zoomen(1) }
        rein.image = DispoCarPlayBild.kartenKnopf("plus")
        let raus = CPMapButton { [weak self] _ in self?.kartenSteuerung.zoomen(-1) }
        raus.image = DispoCarPlayBild.kartenKnopf("minus")
        let sprechen = CPMapButton { [weak self] _ in
            // Liegt ein Hinweis offen, erst den beantworten.
            guard let self, let s = self.sprache, !s.laeuft, self.steuerung?.presentedTemplate == nil else { return }
            // Offene Liste oder Ansicht schliessen, der Assistent liegt ueber der Karte.
            if let st = self.steuerung, st.templates.count > 1 { st.popToRootTemplate(animated: false, completion: CarPlayFehler.melden) }
            self.offen = nil
            Task { await s.starten() }
        }
        sprechen.image = DispoCarPlayBild.balken
        let alle = CPMapButton { [weak self] _ in self?.kartenSteuerung.einpassen += 1 }
        alle.image = DispoCarPlayBild.kartenKnopf("person.2.fill")
        vorlage.mapButtons = [sprechen, rein, raus, alle]
        vorlage.automaticallyHidesNavigationBar = false
    }

    /// Liste ueber der Karte oeffnen (vorher offene Liste oder Einzelansicht schliessen).
    private func listeZeigen(_ liste: CPListTemplate?) {
        guard let liste, let steuerung else { return }
        offen = nil
        if steuerung.templates.count > 1 {
            steuerung.popToRootTemplate(animated: false) { _, _ in steuerung.pushTemplate(liste, animated: true, completion: CarPlayFehler.melden) }
        } else {
            steuerung.pushTemplate(liste, animated: true, completion: CarPlayFehler.melden)
        }
    }

    func mapTemplateDidShowPanningInterface(_ mapTemplate: CPMapTemplate) {}
    func mapTemplateDidDismissPanningInterface(_ mapTemplate: CPMapTemplate) {}

    func mapTemplate(_ mapTemplate: CPMapTemplate, panWith direction: CPMapTemplate.PanDirection) {
        kartenSteuerung.verschieben(direction)
    }

    func mapTemplateDidBeginPanGesture(_ mapTemplate: CPMapTemplate) {
        kartenSteuerung.gesteBeginnt()
    }

    func mapTemplate(_ mapTemplate: CPMapTemplate, didUpdatePanGestureWithTranslation translation: CGPoint, velocity: CGPoint) {
        kartenSteuerung.gesteBewegt(translation)
    }

    func mapTemplate(_ mapTemplate: CPMapTemplate, didEndPanGestureWithVelocity velocity: CGPoint) {
        kartenSteuerung.gesteEndet()
    }

    private func achtungFuellen() {
        let warnungen = stand.warnungen.prefix(CPListTemplate.maximumItemCount)
        let schluessel = warnungen.map { "\($0.id)|\($0.titel)|\($0.detail)" }
        if schluessel != schluesselAchtung {
            schluesselAchtung = schluessel
            let zeilen = warnungen.map { w -> CPListItem in
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
        }
        // Zahl der Warnungen am Reiter.
        reiterTitelSetzen(stand.warnungen.isEmpty ? "Achtung" : "Achtung \(stand.warnungen.count)")
    }

    private func fahrerFuellen() {
        let standbys = Array(stand.standbys.prefix(4))
        let fahrer = Array(stand.fahrer.prefix(max(0, CPListTemplate.maximumItemCount - standbys.count)))
        let schluessel = standbys.map { "s|\($0.id)|\($0.ort)|\($0.zaehlung)" }
            + fahrer.map { "f|\($0.id)|\($0.name)|\($0.zeile)|\($0.farbe)" }
        guard schluessel != schluesselFahrer else { return }
        schluesselFahrer = schluessel
        var abschnitte: [CPListSection] = []
        if !standbys.isEmpty {
            let zeilen = standbys.map { s -> CPListItem in
                let z = CPListItem(text: "Standby \(s.ort)", detailText: s.zaehlung, image: DispoCarPlayBild.zeichen("mappin.and.ellipse"))
                z.accessoryType = .disclosureIndicator
                z.handler = { [weak self] _, fertig in self?.ansichtZeigen(.standby(s.id)); fertig() }
                return z
            }
            abschnitte.append(CPListSection(items: zeilen, header: "Standby", sectionIndexTitle: nil))
        }
        let zeilen = fahrer.map { f -> CPListItem in
            let z = CPListItem(text: f.name, detailText: f.zeile, image: DispoCarPlayBild.punkt(f.farbe))
            z.accessoryType = .disclosureIndicator
            z.handler = { [weak self] _, fertig in self?.fahrerZeigen(f.id); fertig() }
            return z
        }
        if !zeilen.isEmpty {
            abschnitte.append(CPListSection(items: zeilen, header: "Im Dienst", sectionIndexTitle: nil))
        }
        fahrerListe.updateSections(abschnitte)
    }

    private func fahrtenFuellen() {
        let fahrten = stand.fahrten.prefix(CPListTemplate.maximumItemCount)
        let schluessel = fahrten.map { "\($0.id)|\($0.zeit)|\($0.von)|\($0.nach)|\($0.status)|\($0.fahrer)" }
        guard schluessel != schluesselFahrten else { return }
        schluesselFahrten = schluessel
        let zeilen = fahrten.map { f -> CPListItem in
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

    private func zeigen(_ vorlage: CPTemplate, dann: @escaping () -> Void) {
        guard let steuerung else { return }
        let fertig: (Bool, Error?) -> Void = { ok, fehler in
            CarPlayFehler.melden(ok, fehler)
            if ok { Task { @MainActor in dann() } }
        }
        // Liegt schon eine Einzelansicht oben, ersetzen statt stapeln. Eine Liste bleibt darunter.
        if steuerung.topTemplate is CPInformationTemplate {
            steuerung.popTemplate(animated: false) { _, _ in steuerung.pushTemplate(vorlage, animated: true, completion: fertig) }
        } else {
            steuerung.pushTemplate(vorlage, animated: true, completion: fertig)
        }
    }

    private func fahrerZeigen(_ id: String) { ansichtZeigen(.fahrer(id)) }
    private func fahrtZeigen(_ id: String) { ansichtZeigen(.fahrt(id)) }

    private func ansichtZeigen(_ ansicht: Ansicht) {
        guard let inhalt = inhalt(ansicht) else { return }
        let vorlage = CPInformationTemplate(title: inhalt.titel, layout: .leading, items: punkte(inhalt), actions: knoepfe(inhalt))
        offen = OffeneAnsicht(ansicht: ansicht, vorlage: vorlage, schluessel: inhalt.schluessel)
        zeigen(vorlage) { [weak self] in
            if self?.offen?.vorlage === vorlage { self?.offen?.gezeigt = true }
        }
    }

    /// Neuer Stand: offene Ansicht mit frischen Werten fuellen (title/items/actions sind seit
    /// iOS 14 aenderbar). Ist die Fahrt oder der Fahrer weg, zurueck zur Liste.
    private func offeneAnsichtNachfuehren() {
        guard let o = offen, o.gezeigt, let steuerung else { return }
        guard steuerung.templates.contains(where: { $0 === o.vorlage }) else {
            offen = nil
            return
        }
        guard let neu = inhalt(o.ansicht) else {
            offen = nil
            steuerung.popToRootTemplate(animated: true, completion: CarPlayFehler.melden)
            return
        }
        guard neu.schluessel != o.schluessel else { return }
        o.vorlage.title = neu.titel
        o.vorlage.items = punkte(neu)
        o.vorlage.actions = knoepfe(neu)
        offen?.schluessel = neu.schluessel
    }

    private func punkte(_ inhalt: Inhalt) -> [CPInformationItem] {
        inhalt.punkte.map { CPInformationItem(title: $0.0, detail: $0.1) }
    }

    private func knoepfe(_ inhalt: Inhalt) -> [CPTextButton] {
        inhalt.knoepfe.map { titel, aktion in CPTextButton(title: titel, textStyle: .confirm) { _ in aktion() } }
    }

    private func inhalt(_ ansicht: Ansicht) -> Inhalt? {
        switch ansicht {
        case .fahrer(let id): return fahrerInhalt(id)
        case .fahrt(let id): return fahrtInhalt(id)
        case .standby(let id): return standbyInhalt(id)
        }
    }

    private func fahrerSuchen(_ id: String) -> DispoCarPlayFahrer? {
        stand.fahrer.first(where: { $0.id == id }) ?? stand.alleFahrer.first(where: { $0.id == id })
    }

    private func fahrtSuchen(_ id: String) -> DispoCarPlayFahrt? {
        stand.fahrten.first(where: { $0.id == id }) ?? stand.alleFahrten.first(where: { $0.id == id })
    }

    private func fahrerInhalt(_ id: String) -> Inhalt? {
        guard let f = fahrerSuchen(id) else { return nil }
        var punkte = [("Zustand", f.status)]
        if !f.fahrzeug.isEmpty { punkte.append(("Fahrzeug", f.fahrzeug)) }
        if let a = f.aktuell { punkte.append(("Aktuelle Fahrt", a)) }
        if let n = f.naechste { punkte.append(("Nächste Fahrt", n)) }
        if let a = f.ankunft { punkte.append(("Ankunft", a)) }
        if let d = f.dienst { punkte.append(("Dienst", d)) }
        punkte.append(("Signal", f.signal))
        var knoepfe: [(String, () -> Void)] = []
        if f.lat != 0 || f.lng != 0 {
            // Koordinaten erst beim Tippen holen, der Fahrer faehrt weiter.
            knoepfe.append(("Navigation zum Fahrer", { [weak self] in
                guard let self, let jetzt = self.fahrerSuchen(id), jetzt.lat != 0 || jetzt.lng != 0 else { return }
                self.navigieren("\(jetzt.lat),\(jetzt.lng)")
            }))
        }
        return Inhalt(titel: f.name, punkte: punkte, knoepfe: knoepfe)
    }

    private func fahrtInhalt(_ id: String) -> Inhalt? {
        guard let f = fahrtSuchen(id) else { return nil }
        var punkte = [("Abholung", f.von), ("Ziel", f.nach)]
        if !f.gast.isEmpty { punkte.append(("Gast", f.gast)) }
        punkte.append(("Fahrer", f.fahrer.isEmpty ? "Ohne Fahrer" : f.fahrer))
        punkte.append(("Status", f.status + (f.verspaetet ? " · verspätet" : "")))
        if let n = f.neueZeit { punkte.append(("Neue Zeit", n)) }
        if let a = f.ankunft { punkte.append(("Ankunft", a)) }
        var knoepfe: [(String, () -> Void)] = []
        if !f.von.isEmpty {
            knoepfe.append(("Navigation zur Abholung", { [weak self] in
                guard let self, let jetzt = self.fahrtSuchen(id) else { return }
                self.navigieren(jetzt.von)
            }))
        }
        return Inhalt(titel: "\(f.zeit) · \(f.status)", punkte: punkte, knoepfe: knoepfe)
    }

    private func standbyInhalt(_ id: String) -> Inhalt? {
        guard let s = stand.standbys.first(where: { $0.id == id }) else { return nil }
        var punkte = [("Ort", s.ort), ("Zeit", s.zeit)]
        if !s.adresse.isEmpty { punkte.append(("Adresse", s.adresse)) }
        for (i, f) in s.fahrer.enumerated() { punkte.append((i == 0 ? "Fahrer" : "", f)) }
        if s.fahrer.isEmpty { punkte.append(("Fahrer", "Noch keiner")) }
        var knoepfe: [(String, () -> Void)] = []
        if s.lat != 0 || s.lng != 0 || !s.adresse.isEmpty {
            knoepfe.append(("Navigation zum Standby", { [weak self] in
                guard let self, let jetzt = self.stand.standbys.first(where: { $0.id == id }) else { return }
                self.navigieren(jetzt.lat != 0 || jetzt.lng != 0 ? "\(jetzt.lat),\(jetzt.lng)" : jetzt.adresse)
            }))
        }
        return Inhalt(titel: "Standby \(s.ort)", punkte: punkte, knoepfe: knoepfe)
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
        guard stand.angemeldet else { return }
        let aktuell = Set(stand.warnungen.map(\.id))
        // Der erste geladene Stand steht schon in der Liste, dafuer kein Hinweis. Er endet mit dem
        // ersten angemeldeten Stand, sobald Fahrten da sind oder spaetestens nach 20 s (Tag ohne Fahrten).
        if ersterStand {
            let seit = angemeldetSeit ?? Date()
            angemeldetSeit = seit
            bekannt.formUnion(aktuell)
            if !DispoFahrtenSpeicher.gemeinsam.fahrten.isEmpty || Date().timeIntervalSince(seit) > 20 { ersterStand = false }
            return
        }
        // Erledigte Warnungen nicht mehr melden, neue hinten anstellen.
        offeneHinweise.removeAll { !aktuell.contains($0.id) }
        for w in stand.warnungen where !bekannt.contains(w.id) && !offeneHinweise.contains(where: { $0.id == w.id }) {
            offeneHinweise.append(w)
        }
        naechsterHinweis()
    }

    /// Zeigt den naechsten wartenden Hinweis, wenn gerade keiner offen ist. Als bekannt gilt nur,
    /// was wirklich gezeigt wurde.
    private func naechsterHinweis() {
        guard let steuerung, steuerung.presentedTemplate == nil, !offeneHinweise.isEmpty else { return }
        let w = offeneHinweise.removeFirst()
        bekannt.insert(w.id)
        hinweis(w)
    }

    private func hinweis(_ w: DispoCarPlayWarnung) {
        guard let steuerung, steuerung.presentedTemplate == nil else { return }
        var aktionen: [CPAlertAction] = []
        if w.fahrtID != nil || w.fahrerID != nil {
            aktionen.append(CPAlertAction(title: "Ansehen", style: .default) { [weak self] _ in
                // Erst nach dem Schliessen die Ansicht zeigen, sonst schlaegt der push fehl.
                self?.hinweisSchliessen {
                    if let f = w.fahrtID { self?.fahrtZeigen(f) } else if let f = w.fahrerID { self?.fahrerZeigen(f) }
                }
            })
        }
        aktionen.append(CPAlertAction(title: "OK", style: .cancel) { [weak self] _ in
            self?.hinweisSchliessen(dann: nil)
        })
        steuerung.presentTemplate(CPAlertTemplate(titleVariants: ["\(w.titel): \(w.detail)", w.titel], actions: aktionen),
                                  animated: true, completion: CarPlayFehler.melden)
    }

    /// Hinweis schliessen, danach (im completion) weitermachen und den naechsten wartenden zeigen.
    private func hinweisSchliessen(dann: (() -> Void)?) {
        guard let steuerung else { return }
        steuerung.dismissTemplate(animated: true) { [weak self] ok, fehler in
            CarPlayFehler.melden(ok, fehler)
            Task { @MainActor in
                dann?()
                self?.naechsterHinweis()
            }
        }
    }

    // MARK: Beispiel (nur Debug, Startargument -carplayBeispiel)

    #if DEBUG
    static let beispielLauf = ProcessInfo.processInfo.arguments.contains("-carplayBeispiel")

    static let beispielStand: DispoCarPlayStand = {
        let fahrer = [
            DispoCarPlayFahrer(id: "f1", name: "Stefano Spandri", status: "Unterwegs", farbe: .aktiv, zeile: "Unterwegs · an 17:55 · M-TR 101",
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
                              gast: "LH 2471 · Herr Kaiser", status: "Offen", verspaetet: true, ankunft: "20:10", neueZeit: "19:20"),
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
                                 standbys: [DispoCarPlayStandby(id: "s1", ort: "Kongress am Park", zaehlung: "17:00–23:00 · 2 vor Ort · 1 mit Gast · 1 Rückweg",
                                                                zeit: "17:00–23:00", adresse: "Gögginger Str. 10, Augsburg", lat: 48.357, lng: 10.886,
                                                                fahrer: ["Gregor Lang · vor Ort", "Stefano Spandri · mit Gast"])])
    }()

    /// Zeigt nacheinander die Listen, eine Fahrt, einen Fahrer und den Hinweis auf eine neue Warnung.
    private func beispielDurchlauf() {
        Task {
            while steuerung != nil {
                try? await Task.sleep(for: .seconds(6))
                listeZeigen(fahrerListe)
                try? await Task.sleep(for: .seconds(6))
                fahrerZeigen("f1")
                try? await Task.sleep(for: .seconds(6))
                listeZeigen(fahrtenListe)
                try? await Task.sleep(for: .seconds(6))
                fahrtZeigen("j3")
                try? await Task.sleep(for: .seconds(6))
                steuerung?.popToRootTemplate(animated: false, completion: CarPlayFehler.melden)
                hinweis(Self.beispielStand.warnungen[0])
                try? await Task.sleep(for: .seconds(6))
                steuerung?.dismissTemplate(animated: false, completion: CarPlayFehler.melden)
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
    /// Geplante Abholzeit (bei Verspaetung die urspruengliche, nicht "jetzt").
    let zeit: String
    let von: String
    let nach: String
    let fahrer: String
    let gast: String
    let status: String
    let verspaetet: Bool
    let ankunft: String?
    /// Neue Abholzeit bei geaenderter Zeit (Zug/Flug), nicht bei bloss ueberfaelligen Fahrten.
    var neueZeit: String? = nil
}

struct DispoCarPlayStandby {
    let id: String
    let ort: String
    let zaehlung: String
    let zeit: String
    let adresse: String
    let lat: Double
    let lng: Double
    /// "Name · Zustand" je Fahrer.
    let fahrer: [String]
}

struct DispoCarPlayStand {
    var angemeldet: Bool
    var warnungen: [DispoCarPlayWarnung]
    /// Fahrer im Dienst (aktiv vor inaktiv).
    var fahrer: [DispoCarPlayFahrer]
    /// Alle Fahrer, damit eine Warnung auch einen Fahrer ausserhalb der Liste oeffnen kann.
    var alleFahrer: [DispoCarPlayFahrer]
    /// Die offenen Fahrten von heute.
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

    /// Geplante Abholzeit: bei Verspaetung die urspruengliche (startZeit ist bei ueberfaelligen
    /// Fahrten "jetzt", wirksameEtd in DispoFahrten).
    private static func geplant(_ f: DispoFahrt) -> String {
        if f.verspaetet, let o = zeit(f.zeiten.original) { return o }
        return String(f.startZeit.prefix(5))
    }

    /// Storniert wie EDITOR_STORNIERT_STATUS im Web (20.11.: refused stand sonst bis Mitternacht als Offen).
    private static func beendet(_ jobStatus: String) -> Bool {
        ["done", "completed", "arrived", "beendet", "archived", "cancelled", "canceled", "refused", "storniert", "stoniert"].contains(jobStatus.lowercased())
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

        // Fahrten von heute, nicht beendet, nach geplanter Zeit.
        let heuteFahrten = DispoFahrtenSpeicher.gemeinsam.fahrten
            .filter { !$0.archiviert && $0.datum == heute && !beendet($0.jobStatus) }
            .sorted { (geplant($0), $0.startZeit) < (geplant($1), $1.startZeit) }
        func fahrt(_ f: DispoFahrt) -> DispoCarPlayFahrt {
            let z = f.zeiten
            let ankunft = (f.verspaetet ? [z.ankunftNeu, z.ankunftZeit, z.ankunftOriginal] : [z.ankunftZeit, z.ankunftNeu, z.ankunftOriginal])
                .compactMap(zeit).first
            let plan = geplant(f)
            let neu = f.verspaetet && f.verzugMinuten == 0 ? zeit(z.neu).flatMap { $0 == plan ? nil : $0 } : nil
            return DispoCarPlayFahrt(id: f.id, zeit: plan, von: f.startOrt, nach: f.zielOrt,
                                     fahrer: f.ohneFahrerVariante ? "" : f.fahrer, gast: f.name, status: statusText(f.jobStatus),
                                     verspaetet: f.zuSpaet, ankunft: ankunft, neueZeit: neu)
        }
        // Alle nicht beendeten Fahrten von heute, auch ueberfaellige offene (kein Zeitfenster).
        let alleFahrten = heuteFahrten.map(fahrt)

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
            let zeitraum = "\(s.von)–\(s.bis)"
            let fahrerZeilen = s.fahrer.filter { ["accepted", "pending"].contains($0.status) }.map { f -> String in
                let name = f.profil?.name ?? "Fahrer"
                if f.status == "pending" { return "\(name) · angefragt" }
                switch f.zustand {
                case "vor_ort": return "\(name) · vor Ort"
                case "mit_gast": return "\(name) · mit Gast"
                case "rueckweg": return "\(name) · Rückweg" + (f.rueckAnkunft.map { ", an " + uhr($0) } ?? "")
                default: return "\(name) · zugesagt"
                }
            }
            return DispoCarPlayStandby(id: s.id.uuidString, ort: s.ortName,
                                       zaehlung: zeitraum + (teile.isEmpty ? "" : " · " + teile.joined(separator: " · ")),
                                       zeit: zeitraum, adresse: s.adresse ?? "", lat: s.lat, lng: s.lng, fahrer: fahrerZeilen)
        }

        // Fahrer: aktiv (laufende Fahrt) vor inaktiv (im Dienst ohne Fahrt), frei = nicht im Dienst.
        func fahrer(_ k: KartenFahrer) -> DispoCarPlayFahrer {
            let laufend = k.fahrt.map { statusText($0.status) }
            var status: String
            switch k.zustand {
            case .aktiv: status = laufend == "Unterwegs" ? "Unterwegs" : (laufend == "Beim Gast" ? "Beim Gast" : "Zur Abholung")
            case .inaktiv: status = "Ohne Fahrt"
            case .frei: status = "Nicht im Dienst"
            }
            if let sb = standbyZustand[k.id.lowercased()] { status = sb }
            let ankunft = zeit(k.info.ankunft)
            let strecke = k.info.hatFahrt ? "\(k.info.von.name) nach \(k.info.nach.name)" : nil
            let abfahrt = zeit(k.info.abfahrt)
            let aktuell = k.zustand == .aktiv ? strecke.map { (abfahrt.map { $0 + " " } ?? "") + $0 } : nil
            // Naechste Fahrt aus der Fahrtenliste (nach der laufenden). Zuordnung ueber die Fahrer-IDs,
            // nur ohne IDs ueber den genauen Namen (kein Teilstring, "Jan" ist nicht "Jana").
            let id = k.id.lowercased()
            let meine = heuteFahrten.filter { f in
                f.fahrerIds.isEmpty ? f.fahrerNamen.contains(k.name) : f.fahrerIds.contains { $0.lowercased() == id }
            }
            let kommende = meine.first { (minuten(geplant($0)) ?? 0) > jetztMin && statusText($0.jobStatus) == "Offen" && $0.id != k.fahrt?.id }
            let naechste = kommende.map { "\(geplant($0)) \($0.startOrt)" } ?? (k.zustand != .aktiv ? strecke.map { (abfahrt.map { $0 + " " } ?? "") + $0 } : nil)
            var zeile = status
            if k.offline && k.zustand != .frei { zeile = "Ohne Signal · " + k.signalText.replacingOccurrences(of: "Letztes Signal ", with: "seit ") }
            else if let a = ankunft, k.zustand == .aktiv { zeile += " · an \(a)" }
            else if let n = kommende { zeile += " · nächste \(geplant(n))" }
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

        // Warnungen (wie push_dispo_warnungen und die Hinweise der App). Je Art nach Dringlichkeit.
        // Das Zeitfenster gilt fuer die wirksame Startzeit (bei ueberfaelligen Fahrten "jetzt"),
        // angezeigt wird die geplante Zeit.
        var warnungen: [DispoCarPlayWarnung] = []
        for f in heuteFahrten where f.ohneFahrerVariante {
            guard let m = minuten(f.startZeit), m >= jetztMin - 30, m <= jetztMin + 60 else { continue }
            warnungen.append(DispoCarPlayWarnung(id: "ohne-\(f.id)", art: .ohneFahrer, titel: "Ohne Fahrer \(geplant(f))",
                                                 detail: "\(f.startOrt) nach \(f.zielOrt)", fahrtID: f.id, fahrerID: nil))
        }
        // Start Zeitraum: zu spaet erst nach dem Ende des Zeitraums (zuSpaet statt verspaetet).
        // Nur in der naechsten Stunde (eine Zugverspaetung am Abend ist jetzt noch kein Handeln),
        // am laengsten ueberfaellige zuerst, dann nach geplanter Zeit.
        let spaet = heuteFahrten.filter { f in
            guard f.zuSpaet, !f.ohneFahrerVariante, let m = minuten(f.startZeit) else { return false }
            return m >= jetztMin - 30 && m <= jetztMin + 60
        }.sorted { ($0.verzugMinuten, geplant($1)) > ($1.verzugMinuten, geplant($0)) }
        for f in spaet {
            let verzug = f.verzugMinuten > 0 ? " · \(f.verzugMinuten) min" : ""
            warnungen.append(DispoCarPlayWarnung(id: "spaet-\(f.id)", art: .zuSpaet, titel: "Zu spät \(geplant(f))\(verzug)",
                                                 detail: "\(f.fahrer) zu \(f.startOrt)", fahrtID: f.id, fahrerID: nil))
        }
        for k in karte where k.offline && k.zustand != .frei {
            warnungen.append(DispoCarPlayWarnung(id: "signal-\(k.id)", art: .ohneSignal, titel: "Ohne Signal",
                                                 detail: "\(k.name) · " + k.signalText.replacingOccurrences(of: "Letztes Signal ", with: "seit "),
                                                 fahrtID: nil, fahrerID: k.id))
        }
        for f in heuteFahrten where !f.ohneFahrerVariante && !f.bestaetigt && statusText(f.jobStatus) == "Offen" {
            guard let m = minuten(f.startZeit), m >= jetztMin - 30, m <= jetztMin + 180 else { continue }
            warnungen.append(DispoCarPlayWarnung(id: "antwort-\(f.id)", art: .antwortOffen, titel: "Antwort offen \(geplant(f))",
                                                 detail: "\(f.fahrer) hat noch nicht angenommen", fahrtID: f.id, fahrerID: nil))
        }

        return DispoCarPlayStand(angemeldet: true, warnungen: warnungen, fahrer: imDienst, alleFahrer: karte.map(fahrer),
                                 fahrten: alleFahrten, alleFahrten: alleFahrten, standbys: standbyZeilen)
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

    /// TRISAR-Schriftzug in Lime fuer den Listenkopf. Einmal gezeichnet, nicht bei jedem Fuellen.
    static let logo: UIImage? = {
        guard let vorlage = UIImage(named: "TrisarLogo")?.withRenderingMode(.alwaysTemplate) else { return nil }
        let hoehe: CGFloat = 16
        let groesse = CGSize(width: hoehe * vorlage.size.width / max(vorlage.size.height, 1), height: hoehe)
        return UIGraphicsImageRenderer(size: groesse).image { _ in
            lime.set()
            vorlage.draw(in: CGRect(origin: .zero, size: groesse))
        }.withRenderingMode(.alwaysOriginal)
    }()

    static func zeichen(_ name: String) -> UIImage? {
        UIImage(systemName: name, withConfiguration: UIImage.SymbolConfiguration(weight: .semibold))
    }

    /// Farbe wie die Fahrer-Pins der Karte: Rot aktiv, Lime im Dienst ohne Fahrt, Gruen frei.
    static func farbe(_ zustand: FahrerZustand) -> UIColor {
        zustand == .aktiv ? rot : (zustand == .inaktiv ? lime : gruen)
    }

    /// TRISAR-Balken in Lime (Sprechen-Knopf am Handy, Hoehen aus der Aufnahme „TRISAR“).
    static let balken: UIImage = {
        let hoehen: [CGFloat] = [0.3, 0.38, 0.97, 1, 0.82, 0.5, 0.68, 0.44, 0.16]
        let groesse = CGSize(width: 26, height: 22)
        let breite: CGFloat = 2, abstand: CGFloat = 1
        let gesamt = CGFloat(hoehen.count) * breite + CGFloat(hoehen.count - 1) * abstand
        return UIGraphicsImageRenderer(size: groesse).image { _ in
            lime.setFill()
            for (i, h) in hoehen.enumerated() {
                let hh = max(3, h * groesse.height)
                let x = (groesse.width - gesamt) / 2 + CGFloat(i) * (breite + abstand)
                UIBezierPath(roundedRect: CGRect(x: x, y: (groesse.height - hh) / 2, width: breite, height: hh), cornerRadius: 1).fill()
            }
        }.withRenderingMode(.alwaysOriginal)
    }()

    static func kartenKnopf(_ name: String) -> UIImage? {
        UIImage(systemName: name, withConfiguration: UIImage.SymbolConfiguration(pointSize: 18, weight: .semibold))
    }

    /// Farbiger Punkt wie die Fahrer-Pins der Karte: Rot aktiv, Lime im Dienst ohne Fahrt, Gruen frei.
    static func punkt(_ zustand: FahrerZustand) -> UIImage {
        let farbe = farbe(zustand)
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

/// CarPlay wirft eine Ausnahme (App-Absturz), wenn ein Vorlagen-Wechsel fehlschlaegt und kein
/// completion-Block gesetzt ist. Absturz 13.11. (Fahrer Build 44). Fehler nur loggen.
enum CarPlayFehler {
    static let melden: (Bool, Error?) -> Void = { _, fehler in
        if let fehler { print("CarPlay:", fehler.localizedDescription) }
    }
}
