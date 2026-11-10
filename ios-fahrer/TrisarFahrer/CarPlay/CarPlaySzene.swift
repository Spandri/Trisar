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
/// Ebene 1: Liste der Fahrten. Ebene 2: Fahrt mit Navigation, Annehmen/Ablehnen, Beenden.
/// Tiefer geht es nicht, Driving-Task-Apps duerfen nur wenige Ebenen stapeln.
/// Laeuft auf dem Geraet erst mit der Apple-Freigabe com.apple.developer.carplay-driving-task,
/// im Simulator ueber TrisarFahrer-Simulator.entitlements.
@MainActor
final class CarPlaySzene: UIResponder, CPTemplateApplicationSceneDelegate {
    private var steuerung: CPInterfaceController?
    private var szene: CPTemplateApplicationScene?
    private var liste: CPListTemplate?
    private var abos: Set<AnyCancellable> = []
    /// Fahrten, die beim Verbinden schon da waren oder fuer die der Hinweis schon kam.
    private var bekannt: Set<UUID> = []
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
        Geteilt.fahrten.$fahrten
            .receive(on: RunLoop.main)
            .sink { [weak self] _ in
                self?.listeFuellen()
                self?.neueFahrtMelden()
            }
            .store(in: &abos)
        Task { await Geteilt.fahrten.laden() }
        #if DEBUG
        if Self.beispielLauf { beispielDurchlauf() }
        #endif
    }

    func templateApplicationScene(_ templateApplicationScene: CPTemplateApplicationScene,
                                  didDisconnectInterfaceController interfaceController: CPInterfaceController) {
        abos.removeAll()
        steuerung = nil
        szene = nil
        liste = nil
    }

    // MARK: Liste

    private var sortiert: [Fahrt] {
        #if DEBUG
        if Self.beispielLauf { return Self.beispiele }
        #endif
        return Geteilt.fahrten.fahrten.sorted { ($0.fahrtDatum, $0.etd) < ($1.fahrtDatum, $1.etd) }
    }

    private func listeFuellen() {
        guard let liste else { return }
        guard Geteilt.anmeldung.fahrerID != nil else {
            let hinweis = CPListItem(text: "Bitte am iPhone anmelden",
                                     detailText: "TRISAR auf dem iPhone öffnen und anmelden.")
            liste.updateSections([CPListSection(items: [hinweis])])
            return
        }
        let fahrten = Array(sortiert.prefix(CPListTemplate.maximumItemCount))
        var abschnitte: [CPListSection] = []
        for (nummer, tag) in Self.eindeutig(fahrten.map(\.fahrtDatum)).enumerated() {
            let zeilen = fahrten.filter { $0.fahrtDatum == tag }.map(zeile)
            // Ueber dem ersten Tag das Lime-Zeichen: Header-Bilder zeigt CarPlay in Originalfarbe.
            abschnitte.append(CPListSection(items: zeilen, header: Datum.tagEtikett(tag), headerSubtitle: nil,
                                            headerImage: nummer == 0 ? CarPlayBild.logo : nil, headerButton: nil, sectionIndexTitle: nil))
        }
        liste.updateSections(abschnitte)
    }

    private func zeile(_ fahrt: Fahrt) -> CPListItem {
        let zeile = CPListItem(text: fahrt.abholKurz,
                               detailText: "\(Self.statusText(fahrt)) · nach \(fahrt.zielKurz)",
                               image: CarPlayBild.zeit(fahrt.etd, gefuellt: !fahrt.wartetAufAntwort))
        zeile.accessoryType = .disclosureIndicator
        zeile.handler = { [weak self] _, fertig in
            self?.fahrtZeigen(fahrt)
            fertig()
        }
        return zeile
    }

    // MARK: Fahrt

    private func fahrtZeigen(_ fahrt: Fahrt) {
        guard let steuerung, let fahrer = Geteilt.anmeldung.fahrerID else { return }
        Task {
            let details = FahrtDetails(fahrtID: fahrt.id, fahrerID: fahrer)
            await details.laden()
            var punkte = [
                CPInformationItem(title: "Abholung", detail: Adresse.fuerNavigation(name: fahrt.abholName, adresse: fahrt.abholAdresse)),
                CPInformationItem(title: "Ziel", detail: Adresse.fuerNavigation(name: fahrt.zielName, adresse: fahrt.zielAdresse)),
                CPInformationItem(title: "Gäste", detail: GaesteAnzeige.text(details.gaeste, anonym: details.anonym)),
            ]
            if let notiz = details.notizen.first { punkte.append(CPInformationItem(title: "Notiz", detail: notiz.text)) }

            let vorlage = CPInformationTemplate(title: "\(fahrt.etd) · \(Self.statusText(fahrt))", layout: .leading,
                                                items: punkte, actions: knoepfe(fahrt, details))
            // Ebene 2 ist die tiefste. Liegt schon eine Fahrt oben, ersetzen statt stapeln.
            if steuerung.templates.count > 1 {
                steuerung.popToRootTemplate(animated: false) { _, _ in
                    steuerung.pushTemplate(vorlage, animated: true, completion: nil)
                }
            } else {
                steuerung.pushTemplate(vorlage, animated: true, completion: nil)
            }
        }
    }

    private func knoepfe(_ fahrt: Fahrt, _ details: FahrtDetails) -> [CPTextButton] {
        if fahrt.wartetAufAntwort {
            return [
                CPTextButton(title: "Annehmen", textStyle: .confirm) { [weak self] _ in self?.antworten(fahrt, annehmen: true) },
                CPTextButton(title: "Ablehnen", textStyle: .cancel) { [weak self] _ in self?.antworten(fahrt, annehmen: false) },
            ]
        }
        var knoepfe = [
            CPTextButton(title: "Navigation", textStyle: .confirm) { [weak self] _ in
                self?.navigieren(fahrt)
            },
        ]
        if Self.laeuft(fahrt) {
            knoepfe.append(CPTextButton(title: "Fahrt beenden", textStyle: .normal) { [weak self] _ in
                self?.beendenFragen(fahrt, details)
            })
        }
        return knoepfe
    }

    /// Uebergibt an Apple Karten, das in CarPlay immer vorhanden ist. Apple Karten nimmt nur ein Ziel:
    /// unterwegs das Fahrtziel, sonst den Abholort.
    private func navigieren(_ fahrt: Fahrt) {
        let zumZiel = Self.unterwegs(fahrt)
        let adresse = zumZiel
            ? Adresse.fuerNavigation(name: fahrt.zielOrtID != nil && !fahrt.zielAdresse.isEmpty ? "" : fahrt.zielName, adresse: fahrt.zielAdresse)
            : Adresse.fuerNavigation(name: fahrt.abholOrtID != nil && !fahrt.abholAdresse.isEmpty ? "" : fahrt.abholName, adresse: fahrt.abholAdresse)
        var teile = URLComponents(string: "maps://")!
        teile.queryItems = [.init(name: "daddr", value: adresse), .init(name: "dirflg", value: "d")]
        guard !adresse.isEmpty, let url = teile.url else { return }
        szene?.open(url, options: nil, completionHandler: nil)
    }

    private func antworten(_ fahrt: Fahrt, annehmen: Bool) {
        Task {
            _ = await Geteilt.fahrten.antworten(fahrt, annehmen: annehmen)
            steuerung?.popToRootTemplate(animated: true, completion: nil)
        }
    }

    private func beendenFragen(_ fahrt: Fahrt, _ details: FahrtDetails) {
        let frage = CPAlertTemplate(titleVariants: ["Fahrt \(fahrt.etd) beenden?"], actions: [
            CPAlertAction(title: "Beenden", style: .destructive) { [weak self] _ in
                self?.steuerung?.dismissTemplate(animated: true, completion: nil)
                Task {
                    let autor = [Geteilt.anmeldung.profil?.firstName, Geteilt.anmeldung.profil?.lastName]
                        .compactMap { $0 }.joined(separator: " ")
                    if await details.beenden(notiz: "", autor: autor) {
                        await Geteilt.fahrten.laden()
                        self?.steuerung?.popToRootTemplate(animated: true, completion: nil)
                    }
                }
            },
            CPAlertAction(title: "Abbrechen", style: .cancel) { [weak self] _ in
                self?.steuerung?.dismissTemplate(animated: true, completion: nil)
            },
        ])
        steuerung?.presentTemplate(frage, animated: true, completion: nil)
    }

    // MARK: Neue Fahrt

    /// Kommt waehrend der Fahrt eine neue Fahrt dazu, die noch eine Antwort braucht, einmal fragen.
    private func neueFahrtMelden() {
        let offen = sortiert.filter(\.wartetAufAntwort)
        defer { bekannt.formUnion(Geteilt.fahrten.fahrten.map(\.id)) }
        // Der erste Stand nach dem Verbinden steht schon in der Liste, dafuer kein Hinweis.
        if ersterStand {
            if Geteilt.fahrten.geladen { ersterStand = false }
            return
        }
        guard let neu = offen.first(where: { !bekannt.contains($0.id) }) else { return }
        hinweisZeigen(neu)
    }

    private func hinweisZeigen(_ neu: Fahrt) {
        guard let steuerung, steuerung.presentedTemplate == nil else { return }
        let hinweis = CPAlertTemplate(
            titleVariants: ["Neue Fahrt um \(neu.etd): \(neu.abholKurz) nach \(neu.zielKurz)", "Neue Fahrt um \(neu.etd)"],
            actions: [
                CPAlertAction(title: "Annehmen", style: .default) { [weak self] _ in
                    self?.steuerung?.dismissTemplate(animated: true, completion: nil)
                    Task { _ = await Geteilt.fahrten.antworten(neu, annehmen: true) }
                },
                // Nur zwei Knoepfe: bei drei kuerzt CarPlay "Annehmen". Ablehnen geht in der Fahrt-Ansicht,
                // so lehnt auch niemand waehrend der Fahrt aus Versehen ab.
                CPAlertAction(title: "Später", style: .cancel) { [weak self] _ in
                    self?.steuerung?.dismissTemplate(animated: true, completion: nil)
                },
            ])
        steuerung.presentTemplate(hinweis, animated: true, completion: nil)
    }

    #if DEBUG
    // Nur Debug, Startargument -carplayBeispiel: Beispielfahrten, die Ansichten wechseln von selbst.
    static let beispielLauf = ProcessInfo.processInfo.arguments.contains("-carplayBeispiel")

    static let beispiele: [Fahrt] = {
        let heute = Datum.tagWert(Date())
        func fahrt(_ etd: String, _ status: String, _ von: String, _ nach: String) -> Fahrt {
            Fahrt(id: UUID(), status: status, tripType: "normal", abholName: von, abholAdresse: von, zielName: nach, zielAdresse: nach,
                  zugNummer: nil, flug: "", fahrtDatum: heute, etd: etd, planEtd: etd, kolonnenID: nil, istKolonne: false, meineAntwort: "")
        }
        return [
            fahrt("17:24", "in_progress", "Beethovenstr. 22, Diedorf", "Gögginger Str. 10, Augsburg"),
            fahrt("18:10", "assigned", "Maximilianstr. 40, Augsburg", "Gögginger Str. 10, Augsburg"),
            fahrt("19:05", "pending", "Flughafen München, Terminal 2", "Gögginger Str. 10, Augsburg"),
        ]
    }()

    private func beispielDurchlauf() {
        Task {
            while steuerung != nil {
                try? await Task.sleep(for: .seconds(6))
                fahrtZeigen(Self.beispiele[0])
                try? await Task.sleep(for: .seconds(6))
                fahrtZeigen(Self.beispiele[2])
                try? await Task.sleep(for: .seconds(6))
                steuerung?.popToRootTemplate(animated: false, completion: nil)
                hinweisZeigen(Self.beispiele[2])
                try? await Task.sleep(for: .seconds(6))
                steuerung?.dismissTemplate(animated: false, completion: nil)
            }
        }
    }
    #endif

    // MARK: Hilfen

    private static func eindeutig(_ werte: [String]) -> [String] {
        var gesehen = Set<String>()
        return werte.filter { gesehen.insert($0).inserted }
    }

    static func unterwegs(_ fahrt: Fahrt) -> Bool {
        ["in_progress", "unterwegs", "started", "on_trip", "ongoing", "active"].contains(fahrt.status.lowercased())
    }

    static func beimGast(_ fahrt: Fahrt) -> Bool {
        ["at_pickup", "pickup", "beim_pickup", "beim pickup"].contains(fahrt.status.lowercased())
    }

    private static func laeuft(_ fahrt: Fahrt) -> Bool { unterwegs(fahrt) || beimGast(fahrt) }

    static func statusText(_ fahrt: Fahrt) -> String {
        if unterwegs(fahrt) { return "Unterwegs" }
        if beimGast(fahrt) { return "Beim Gast" }
        if fahrt.wartetAufAntwort { return "Antwort offen" }
        return "Angenommen"
    }
}

/// Bilder im TRISAR-Look fuer die Apple-Vorlagen. Farben und Schrift der Vorlagen legt CarPlay fest,
/// eigene Bilder zeigt es aber unveraendert: die Abholzeit steht deshalb als Lime-Plakette
/// in Space Grotesk vor jeder Zeile.
enum CarPlayBild {
    private static let lime = UIColor(red: 0xE3 / 255, green: 0xF6 / 255, blue: 0x54 / 255, alpha: 1)
    private static let dunkel = UIColor(red: 0x1D / 255, green: 0x1C / 255, blue: 0x1D / 255, alpha: 1)

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
