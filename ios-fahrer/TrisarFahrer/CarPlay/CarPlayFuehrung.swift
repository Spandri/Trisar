import CarPlay
import Combine
import CoreLocation
import MapKit
import SwiftUI
import UIKit

/// Eigene Fuehrung im Auto (17.11.), NUR bei Fahrten mit Route von der Dispo (wie am Handy).
/// Zeigt die eine Fuehrung der App (NaviFuehrung.geteilt) als CPNavigationSession: Manoever mit Pfeil,
/// Text und Entfernung, das naechste Manoever darunter, Ankunft, Rest und km im Feld der Vorlage.
/// Ueber die Session bekommen auch Tacho und Head-up-Display die Manoever.
/// Laeuft die Fuehrung schon am Handy, zeigt CarPlay sie automatisch mit.
/// Beendet das Auto die Navigation (eigene Navigation gestartet) oder der Fahrer mit „Ende“,
/// endet die Fuehrung sofort ganz (auch am Handy, damit keine Ansage weiterlaeuft).
@MainActor
final class CarPlayFuehrung {
    private let vorlage: CPMapTemplate
    private let karte: CarPlayKarte
    private let navi = NaviFuehrung.geteilt
    private var sitzung: CPNavigationSession?
    private var reise: CPTrip?
    private var fahrtID: UUID?
    private var abos: Set<AnyCancellable> = []

    /// Gerade gezeigtes Manoever und der Hinweis dazu.
    private var manoever: CPManeuver?
    private var hinweis: NaviHinweis?
    private var dann: NaviHinweis?
    private var pause: NaviFuehrung.Lage?
    private var letzteEntfernung = ""
    private var letzterRest: (minuten: Int, hundert: Int)?
    private var linieStand = -1
    private var routeStand = -1

    /// Fahrt, deren Fuehrung im Auto beendet wurde: nicht wieder vom Handy uebernehmen.
    private var nichtMitzeigen: UUID?

    /// Die Szene stellt danach Knoepfe und Vorschau um (true = Fuehrung laeuft).
    var geaendert: ((Bool) -> Void)?
    /// Am Ende der Route angekommen (Fahrt-ID): die Szene zeigt den naechsten Schritt der Fahrt.
    var angekommen: ((UUID) -> Void)?
    /// Name des Ziels fuer die Fahrt (Vorlage zeigt ihn in der Ankunft).
    var zielName: ((UUID) -> String?)?

    var laeuft: Bool { sitzung != nil }

    init(vorlage: CPMapTemplate, karte: CarPlayKarte) {
        self.vorlage = vorlage
        self.karte = karte
        // Eigene Runde auf dem Main-Thread: starten() aendert nutzer selbst wieder.
        navi.$nutzer
            .receive(on: DispatchQueue.main)
            .sink { [weak self] _ in self?.nutzerPruefen() }
            .store(in: &abos)
        navi.$anzeige
            .receive(on: DispatchQueue.main)
            .sink { [weak self] a in self?.anzeigen(a) }
            .store(in: &abos)
        navi.$karte
            .receive(on: DispatchQueue.main)
            .sink { [weak self] k in self?.kartenStand(k) }
            .store(in: &abos)
    }

    func trennen() {
        abos.removeAll()
        // CarPlay weg: die Fuehrung laeuft am Handy weiter, falls es sie zeigt.
        sitzung = nil
        navi.beenden(fuer: .carplay)
    }

    // MARK: Start und Ende

    /// Knopf „TRISAR-Navigation starten“ (nur mit Route von der Dispo und Gast an Bord).
    func starten(fahrtID: UUID, start: CLLocation?) {
        nichtMitzeigen = nil
        navi.starten(fahrtID: fahrtID, unterwegs: true, start: start, fuer: .carplay)
    }

    /// Knopf „Ende“: sofort ganz beenden.
    func beenden() {
        nichtMitzeigen = fahrtID
        sitzung?.cancelTrip()
        sitzungWeg()
        navi.beendenFuerAlle()
    }

    /// Das Auto hat die Navigation beendet (mapTemplateDidCancelNavigation), die Session ist schon zu.
    func vomAutoBeendet() {
        nichtMitzeigen = fahrtID
        sitzungWeg()
        navi.beendenFuerAlle()
    }

    /// Neuer Stand der Fuehrung: mitzeigen, starten oder beenden.
    private func nutzerPruefen() {
        let n = navi.nutzer
        if n.isEmpty {
            nichtMitzeigen = nil
            if sitzung != nil {
                sitzung?.cancelTrip()
                sitzungWeg()
            }
            return
        }
        guard let id = navi.fahrtID else { return }
        // Fuehrung fuer eine andere Fahrt als die gezeigte: alte Session zu.
        if sitzung != nil, fahrtID != id || !n.contains(.carplay) {
            sitzung?.cancelTrip()
            sitzungWeg()
        }
        guard sitzung == nil, nichtMitzeigen != id else { return }
        if !n.contains(.carplay) {
            // Laeuft am Handy: im Auto mitzeigen (starten() fuegt nur CarPlay hinzu).
            navi.starten(fahrtID: id, unterwegs: navi.unterwegs, start: nil, fuer: .carplay)
            return
        }
        sitzungStarten(id)
    }

    private func sitzungStarten(_ id: UUID) {
        fahrtID = id
        let wahl = CPRouteChoice(summaryVariants: ["Route von Dispo"],
                                 additionalInformationVariants: ["Vorgegeben von der Dispo"],
                                 selectionSummaryVariants: ["Route von Dispo"])
        let ziel = MKMapItem(placemark: MKPlacemark(coordinate: navi.karte.ende ?? KarteAnsicht.mitte))
        let name = zielName?(id) ?? "Ziel"
        ziel.name = name
        let neu = CPTrip(origin: MKMapItem.forCurrentLocation(), destination: ziel, routeChoices: [wahl])
        reise = neu
        vorlage.hideTripPreviews()
        let s = vorlage.startNavigationSession(for: neu)
        sitzung = s
        manoever = nil
        hinweis = nil
        dann = nil
        pause = nil
        letzteEntfernung = ""
        letzterRest = nil
        linieStand = -1
        routeStand = -1
        karte.fuehrungSetzen(true)
        geaendert?(true)
        kartenStand(navi.karte)
        anzeigen(navi.anzeige)
    }

    private func sitzungWeg() {
        let war = sitzung != nil
        sitzung = nil
        reise = nil
        manoever = nil
        hinweis = nil
        karte.fuehrungSetzen(false)
        karte.linieSetzen([])
        karte.zielSetzen(nil, abholort: false)
        if war { geaendert?(false) }
    }

    // MARK: Phase

    /// Gast steigt ein bzw. Status der Fahrt aendert sich (aus dem Stand der Szene).
    func phase(fahrtID id: UUID, unterwegs: Bool) {
        guard navi.fahrtID == id else { return }
        navi.phase(unterwegs: unterwegs)
    }

    // MARK: Karte

    private func kartenStand(_ k: NaviFuehrung.Karte) {
        guard sitzung != nil else { return }
        karte.fahrerSetzen(k.ort, kurs: k.kurs)
        if k.linieStand != linieStand {
            linieStand = k.linieStand
            karte.linieSetzen(k.linie, blass: k.blass)
        }
        if k.routeStand != routeStand {
            routeStand = k.routeStand
            karte.zielSetzen(k.ende, abholort: k.endeAbholort)
        }
    }

    // MARK: Manoever

    private func anzeigen(_ a: NaviFuehrung.Anzeige) {
        guard let sitzung, let id = fahrtID else { return }
        switch a.lage {
        case .warteStandort:
            pausieren(a.lage, .locating, "Warte auf Standort")
        case .laedt:
            pausieren(a.lage, .loading, "Route wird geladen")
        case .fehler:
            pausieren(a.lage, .loading, "Route konnte nicht geladen werden")
        case .abseits:
            pausieren(a.lage, .rerouting, "Abseits der Route · zurück zur Route von Dispo")
        case .angekommen:
            sitzung.finishTrip()
            nichtMitzeigen = id
            sitzungWeg()
            // Das Handy darf weiter zeigen (Ankunft steht dort), im Auto ist die Fuehrung fertig.
            navi.beenden(fuer: .carplay)
            angekommen?(id)
        case .fuehrt:
            fuehren(a, sitzung)
        }
    }

    private func pausieren(_ lage: NaviFuehrung.Lage, _ grund: CPNavigationSession.PauseReason, _ text: String) {
        guard pause != lage, let sitzung else { return }
        pause = lage
        manoever = nil
        hinweis = nil
        sitzung.pauseTrip(for: grund, description: text)
    }

    private func fuehren(_ a: NaviFuehrung.Anzeige, _ sitzung: CPNavigationSession) {
        let neuerHinweis = a.naechster != hinweis || a.dann != dann || pause != nil || manoever == nil
        if neuerHinweis {
            pause = nil
            hinweis = a.naechster
            dann = a.dann
            let erstes = Self.manoever(a.naechster, anfang: (a.entfernung, Self.sekunden(bis: a.entfernung, a)))
            var liste = [erstes]
            if let d = a.dann, let n = a.naechster {
                let weg = max(0, d.m - n.m)
                liste.append(Self.manoever(d, anfang: (weg, max(0, d.t - n.t))))
            }
            manoever = erstes
            letzteEntfernung = ""
            // Setzen der Manoever setzt eine pausierte Fuehrung fort.
            sitzung.upcomingManeuvers = liste
        }
        // Entfernung zum Manoever: nur wenn sich die Anzeige aendert (Apple: nicht bei jedem Fix).
        if let m = manoever {
            let text = NaviText.entfernung(a.entfernung)
            if text != letzteEntfernung {
                letzteEntfernung = text
                sitzung.updateEstimates(Self.schaetzung(meter: a.entfernung, sekunden: Self.sekunden(bis: a.entfernung, a)), for: m)
            }
        }
        // Ankunft, Rest und km fuer die ganze Fahrt: bei neuer Minute oder alle 100 m.
        if let reise, let rest = a.restSekunden, let meter = a.restMeter {
            let neu = (Int((rest / 60).rounded(.up)), Int(meter / 100))
            if letzterRest == nil || letzterRest! != neu {
                letzterRest = neu
                vorlage.updateEstimates(Self.schaetzung(meter: meter, sekunden: rest), for: reise)
            }
        }
    }

    /// Zeit bis zum Manoever, aus dem Schnitt der restlichen Fahrt.
    private static func sekunden(bis meter: Double, _ a: NaviFuehrung.Anzeige) -> TimeInterval {
        guard let rest = a.restSekunden, let gesamt = a.restMeter, gesamt > 0 else { return -1 }
        return max(0, rest * meter / gesamt)
    }

    private static func schaetzung(meter: Double, sekunden: TimeInterval) -> CPTravelEstimates {
        CPTravelEstimates(distanceRemaining: strecke(meter), timeRemaining: sekunden)
    }

    /// Ein Hinweis der Fuehrung als CPManeuver (Pfeil hell/dunkel, Text in Varianten, Art fuer Tacho/HUD).
    /// `anfang`: Meter und Sekunden vom vorigen Manoever (bzw. vom Standort) bis zu diesem.
    static func manoever(_ h: NaviHinweis?, anfang: (meter: Double, sekunden: TimeInterval)) -> CPManeuver {
        let m = CPManeuver()
        let pfeil = h?.pfeil ?? "gerade"
        m.symbolImage = CarPlayManoeverBild.bild(pfeil)
        // Laengster Text zuerst, CarPlay nimmt den laengsten, der passt.
        var texte = [h?.kurz ?? ""].filter { !$0.isEmpty }
        if let s = h?.strasse, !s.isEmpty, s.count < (texte.first?.count ?? .max) { texte.append(s) }
        m.instructionVariants = texte.isEmpty ? ["Der Route folgen"] : texte
        m.initialTravelEstimates = schaetzung(meter: anfang.meter, sekunden: anfang.sekunden)
        if #available(iOS 17.4, *) {
            m.maneuverType = art(pfeil)
            m.trafficSide = .right
            if let s = h?.strasse, !s.isEmpty { m.roadFollowingManeuverVariants = [s] }
        }
        return m
    }

    @available(iOS 17.4, *)
    private static func art(_ pfeil: String) -> CPManeuverType {
        switch pfeil {
        case "rechts": return .rightTurn
        case "links": return .leftTurn
        case "leicht_rechts": return .slightRightTurn
        case "leicht_links": return .slightLeftTurn
        case "scharf_rechts": return .sharpRightTurn
        case "scharf_links": return .sharpLeftTurn
        case "wenden": return .uTurn
        case "kreisel": return .enterRoundabout
        case "ziel": return .arriveAtDestination
        case "start": return .startRoute
        default: return .straightAhead
        }
    }
}

/// Pfeile der Manoever als Bild: dieselben Formen wie das Banner am Handy (NaviPfeilForm),
/// je eine Fassung fuer hellen und dunklen Hintergrund (verlangt Apple fuer symbolImage).
enum CarPlayManoeverBild {
    private static var vorrat: [String: UIImage] = [:]

    static func bild(_ pfeil: String) -> UIImage {
        if let b = vorrat[pfeil] { return b }
        let sammlung = UIImageAsset()
        sammlung.register(zeichnen(pfeil, farbe: .black), with: UITraitCollection(userInterfaceStyle: .light))
        sammlung.register(zeichnen(pfeil, farbe: .white), with: UITraitCollection(userInterfaceStyle: .dark))
        let b = sammlung.image(with: UITraitCollection(userInterfaceStyle: .dark))
        vorrat[pfeil] = b
        return b
    }

    private static func zeichnen(_ pfeil: String, farbe: UIColor) -> UIImage {
        let seite: CGFloat = 50
        return UIGraphicsImageRenderer(size: CGSize(width: seite, height: seite)).image { _ in
            let f = seite / 38
            farbe.setStroke()
            farbe.setFill()
            if pfeil == "ziel" {
                let ring = UIBezierPath(ovalIn: CGRect(x: 5 * f + 2.25 * f, y: 5 * f + 2.25 * f, width: 28 * f - 4.5 * f, height: 28 * f - 4.5 * f))
                ring.lineWidth = 4.5 * f
                ring.stroke()
                UIBezierPath(ovalIn: CGRect(x: 14 * f, y: 14 * f, width: 10 * f, height: 10 * f)).fill()
                return
            }
            let form = UIBezierPath(cgPath: NaviPfeilForm(art: pfeil).path(in: CGRect(x: 0, y: 0, width: seite, height: seite)).cgPath)
            form.lineWidth = 4.5 * f
            form.lineCapStyle = .square
            form.lineJoinStyle = .miter
            form.stroke()
        }
    }
}

/// Strecke fuer CarPlay: CarPlay zeigt die Einheit, die wir uebergeben (sonst stand "2.000 Meter", User 19.11.).
/// Gleiche Rundung wie die Handy-Navigation (NaviText.entfernung): unter 100 m auf 10 m, bis 999 m auf
/// 50 m, ab 1 km Kilometer mit einer Nachkommastelle.
func strecke(_ meter: Double) -> Measurement<UnitLength> {
    let m = max(0, meter)
    if m < 100 { return Measurement(value: (m / 10).rounded() * 10, unit: .meters) }
    let gerundet = (m / 50).rounded() * 50
    if gerundet < 1000 { return Measurement(value: gerundet, unit: .meters) }
    return Measurement(value: (m / 100).rounded() / 10, unit: .kilometers)
}
