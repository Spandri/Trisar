import MapLibre
import SwiftUI
import UIKit

/// Karte der Fahrt-Ansicht, Nachbau von GoogleMapComponent in SoloNormal.jsx.
/// Gleiche Bibliothek (MapLibre), gleicher Stil (CARTO Dark Matter), gleiche Linien und Pins.
struct KarteAnsicht: UIViewRepresentable {
    /// Kollege der Kolonne: Lime-Pin, Fahrernummer (15 fett) oder Kuerzel (13 fett).
    struct Kollege {
        let ort: CLLocationCoordinate2D
        let beschriftung: String
        let nummer: Bool
    }

    struct Inhalt: Equatable {
        var anfahrt: [CLLocationCoordinate2D] = []      // gelb gestrichelt
        var fahrt: [CLLocationCoordinate2D] = []        // blau
        var abholort: CLLocationCoordinate2D?           // roter Pin mit Gast
        var ziel: CLLocationCoordinate2D?               // Ziel-Pin
        var fahrer: CLLocationCoordinate2D?             // blauer Punkt mit Fahrernummer
        var fahrerNummer = ""
        var anfahrtMinuten: Int?
        var fahrtMinuten: Int?
        var flugzeug: CLLocationCoordinate2D?          // Live-Position des Flugs
        var flugKurs: Double = 0
        var flugSpur: [CLLocationCoordinate2D] = []    // Lime, 3 pt
        var kollegen: [Kollege] = []

        static func == (a: Inhalt, b: Inhalt) -> Bool {
            a.anfahrt.count == b.anfahrt.count && a.fahrt.count == b.fahrt.count
                && a.anfahrt.first?.latitude == b.anfahrt.first?.latitude
                && a.anfahrt.first?.longitude == b.anfahrt.first?.longitude
                && a.fahrt.first?.latitude == b.fahrt.first?.latitude
                && a.abholort?.latitude == b.abholort?.latitude && a.ziel?.latitude == b.ziel?.latitude
                && a.fahrer?.latitude == b.fahrer?.latitude && a.fahrer?.longitude == b.fahrer?.longitude
                && a.fahrerNummer == b.fahrerNummer && a.anfahrtMinuten == b.anfahrtMinuten && a.fahrtMinuten == b.fahrtMinuten
                && a.flugzeug?.latitude == b.flugzeug?.latitude && a.flugzeug?.longitude == b.flugzeug?.longitude
                && a.flugKurs == b.flugKurs && a.flugSpur.count == b.flugSpur.count
                && a.kollegen.map(\.beschriftung) == b.kollegen.map(\.beschriftung)
                && a.kollegen.map(\.ort.latitude) == b.kollegen.map(\.ort.latitude)
        }
    }

    var inhalt: Inhalt
    /// Untere Polsterung in Punkt (Blatt), damit die Route im freien Teil liegt.
    var untenFrei: CGFloat

    static let stil = URL(string: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json")!
    static let mitte = CLLocationCoordinate2D(latitude: 48.1215, longitude: 11.6644)

    func makeCoordinator() -> Koordinator { Koordinator() }

    func makeUIView(context: Context) -> MLNMapView {
        let karte = MLNMapView(frame: .zero, styleURL: Self.stil)
        karte.delegate = context.coordinator
        karte.backgroundColor = UIColor(red: 0x10 / 255, green: 0x11 / 255, blue: 0x12 / 255, alpha: 1)
        karte.setCenter(Self.mitte, zoomLevel: 12, animated: false)
        karte.logoView.isHidden = true
        karte.compassView.isHidden = true
        karte.showsScale = false
        karte.automaticallyAdjustsContentInset = false
        // Wie im Web (attributionControl compact): unten rechts, dort liegt das Infoblatt darueber.
        karte.attributionButtonPosition = .bottomRight
        karte.attributionButton.tintColor = UIColor(white: 0.6, alpha: 0.8)
        context.coordinator.karte = karte
        return karte
    }

    func updateUIView(_ karte: MLNMapView, context: Context) {
        context.coordinator.setzen(inhalt, untenFrei: untenFrei)
    }

    final class Koordinator: NSObject, MLNMapViewDelegate {
        weak var karte: MLNMapView?
        private var inhalt = Inhalt()
        private var untenFrei: CGFloat = 0
        private var stilGeladen = false
        private var zuletztEingepasst: (Int, Int, CGFloat)?
        private var punkte: [MLNPointAnnotation] = []

        func setzen(_ neu: Inhalt, untenFrei: CGFloat) {
            let anders = neu != inhalt
            inhalt = neu
            let freiAnders = abs(untenFrei - self.untenFrei) > 1
            self.untenFrei = untenFrei
            guard stilGeladen else { return }
            if anders { zeichnen() }
            if anders || freiAnders { einpassen() }
        }

        func mapView(_ mapView: MLNMapView, didFinishLoading style: MLNStyle) {
            stilGeladen = true
            zeichnen()
            einpassen()
        }

        // MARK: Linien und Pins

        private func zeichnen() {
            guard let karte, let stil = karte.style else { return }
            linie(stil, kennung: "fahrt", pfad: inhalt.fahrt, farbe: UIColor(hex: 0x0059FF), breite: 6, gestrichelt: false)
            linie(stil, kennung: "anfahrt", pfad: inhalt.anfahrt, farbe: UIColor(hex: 0xE3F654), breite: 5, gestrichelt: true)
            linie(stil, kennung: "flugspur", pfad: inhalt.flugSpur, farbe: UIColor(hex: 0xE3F654).withAlphaComponent(0.95), breite: 3, gestrichelt: false)

            if !punkte.isEmpty { karte.removeAnnotations(punkte) }
            punkte = []
            func pin(_ ort: CLLocationCoordinate2D?, _ art: String, _ text: String? = nil) {
                guard let ort else { return }
                let p = MLNPointAnnotation()
                p.coordinate = ort
                p.title = art
                p.subtitle = text
                punkte.append(p)
            }
            pin(inhalt.ziel, "ziel")
            pin(inhalt.abholort, "abholort")
            if let m = inhalt.fahrtMinuten, inhalt.fahrt.count >= 2 { pin(mitte(inhalt.fahrt), "blase-blau", Self.dauer(m)) }
            if let m = inhalt.anfahrtMinuten, m > 0, inhalt.anfahrt.count >= 2 { pin(mitte(inhalt.anfahrt), "blase-gelb", Self.dauer(m)) }
            for k in inhalt.kollegen { pin(k.ort, k.nummer ? "kollege-nr" : "kollege-kz", k.beschriftung) }
            pin(inhalt.flugzeug, "flugzeug", String(inhalt.flugKurs))
            pin(inhalt.fahrer, "fahrer", inhalt.fahrerNummer)
            karte.addAnnotations(punkte)
            DispatchQueue.main.async { [weak self] in self?.blasenEntzerren() }
        }

        func mapView(_ mapView: MLNMapView, regionDidChangeAnimated animated: Bool) {
            blasenEntzerren()
        }

        func mapViewRegionIsChanging(_ mapView: MLNMapView) {
            blasenEntzerren()
        }

        // Die Ansichten der Blasen entstehen erst hier, vorher gibt es nichts zu verschieben.
        func mapView(_ mapView: MLNMapView, didAdd annotationViews: [MLNAnnotationView]) {
            blasenEntzerren()
        }

        /// entzerreDauerLabels: Liegen Anfahrt- und Fahrt-Blase uebereinander, wird die untere
        /// so weit nach oben geschoben, dass 8 pt Luft bleiben.
        private func blasenEntzerren() {
            guard let karte else { return }
            let luft: CGFloat = 8
            var blasen: [(punkt: CGPoint, ansicht: MLNAnnotationView)] = punkte
                .filter { ($0.title ?? "").hasPrefix("blase") }
                .compactMap { a in
                    guard let v = karte.view(for: a) else { return nil }
                    return (karte.convert(a.coordinate, toPointTo: karte), v)
                }
            blasen.sort { $0.punkt.y < $1.punkt.y }
            var verschoben: [CGFloat] = []
            for (i, b) in blasen.enumerated() {
                var dy: CGFloat = 0
                let h = b.ansicht.bounds.height, w = b.ansicht.bounds.width
                for j in 0..<i {
                    let oben = blasen[j], obenDy = verschoben[j]
                    let obenUnten = oben.punkt.y - obenDy, obenOben = obenUnten - oben.ansicht.bounds.height
                    let meinUnten = b.punkt.y - dy, meinOben = meinUnten - h
                    let waagerecht = abs(b.punkt.x - oben.punkt.x) < (w + oben.ansicht.bounds.width) / 2 + luft
                    let senkrecht = meinOben < obenUnten + luft && meinUnten > obenOben - luft
                    if waagerecht && senkrecht { dy = b.punkt.y - (obenOben - luft) }
                }
                verschoben.append(dy)
                b.ansicht.centerOffset = CGVector(dx: 0, dy: -h / 2 - dy)
            }
        }

        private func linie(_ stil: MLNStyle, kennung: String, pfad: [CLLocationCoordinate2D], farbe: UIColor, breite: CGFloat, gestrichelt: Bool) {
            // Eine Linie ohne Punkte loest in MapLibre eine Ausnahme aus, darum erst ab zwei Punkten.
            var form: MLNPolylineFeature?
            if pfad.count >= 2 {
                var koords = pfad
                form = MLNPolylineFeature(coordinates: &koords, count: UInt(koords.count))
            }
            if let quelle = stil.source(withIdentifier: kennung) as? MLNShapeSource {
                quelle.shape = form
                return
            }
            let quelle = MLNShapeSource(identifier: kennung, shape: form, options: nil)
            stil.addSource(quelle)
            let ebene = MLNLineStyleLayer(identifier: kennung, source: quelle)
            ebene.lineColor = NSExpression(forConstantValue: farbe)
            ebene.lineWidth = NSExpression(forConstantValue: breite)
            ebene.lineCap = NSExpression(forConstantValue: "round")
            ebene.lineJoin = NSExpression(forConstantValue: "round")
            if gestrichelt { ebene.lineDashPattern = NSExpression(forConstantValue: [0.8, 1.6]) }
            stil.addLayer(ebene)
        }

        private func mitte(_ pfad: [CLLocationCoordinate2D]) -> CLLocationCoordinate2D { pfad[pfad.count / 2] }

        /// formatDuration der Web-App: "12 min" oder "1:05 h".
        static func dauer(_ m: Int) -> String {
            if m <= 0 { return "0 min" }
            if m < 60 { return "\(m) min" }
            return "\(m / 60):\(String(format: "%02d", m % 60)) h"
        }

        // MARK: Ausschnitt (fitBounds mit Polsterung wie getFitPadding)

        private func einpassen() {
            guard let karte else { return }
            // Vor dem ersten Layout hat die Karte keine Groesse, dann spaeter nochmal.
            guard karte.bounds.width > 10, karte.bounds.height > 10 else {
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) { [weak self] in self?.einpassen() }
                return
            }
            let alle = inhalt.fahrt + inhalt.anfahrt + [inhalt.abholort, inhalt.ziel, inhalt.flugzeug].compactMap { $0 }
                + inhalt.kollegen.map(\.ort)
            guard alle.count >= 2 else {
                if let f = inhalt.fahrer ?? alle.first { karte.setCenter(f, zoomLevel: 13, animated: false) }
                return
            }
            let schluessel = (alle.count, Int((alle[0].latitude) * 1e5), untenFrei + karte.bounds.height)
            if let z = zuletztEingepasst, z == schluessel { return }
            zuletztEingepasst = schluessel
            var sw = alle[0], ne = alle[0]
            for p in alle {
                sw.latitude = min(sw.latitude, p.latitude); sw.longitude = min(sw.longitude, p.longitude)
                ne.latitude = max(ne.latitude, p.latitude); ne.longitude = max(ne.longitude, p.longitude)
            }
            // Kollegen-Pins ragen nach oben ueber ihren Ort, dafuer oben 42 mehr Platz.
            let rand = UIEdgeInsets(top: 44 + (inhalt.kollegen.isEmpty ? 0 : 42), left: 28, bottom: max(170, untenFrei + 12), right: 28)
            karte.setVisibleCoordinateBounds(MLNCoordinateBounds(sw: sw, ne: ne), edgePadding: rand, animated: true, completionHandler: nil)
        }

        // MARK: Aussehen der Punkte

        func mapView(_ mapView: MLNMapView, viewFor annotation: MLNAnnotation) -> MLNAnnotationView? {
            guard let art = annotation.title ?? nil else { return nil }
            let text = (annotation.subtitle ?? nil) ?? ""
            switch art {
            case "abholort": return PinAnsicht(bild: "Abholort_Pin_Trisar_01_rot", groesse: CGSize(width: 35, height: 41.1367), ankerUnten: true)
            case "ziel": return PinAnsicht(bild: "Ziel_Pin_Trisar_01", groesse: CGSize(width: 35, height: 41.1367), ankerUnten: true)
            case "fahrer": return FahrerPunkt(nummer: text)
            case "flugzeug": return Flugzeug(kurs: Double(text) ?? 0)
            case "kollege-nr": return KollegenPin(text: text, groesse: 15)
            case "kollege-kz": return KollegenPin(text: text, groesse: 13)
            case "blase-blau": return Zeitblase(text: text, hinten: UIColor(hex: 0x0059FF), vorne: .white)
            case "blase-gelb": return Zeitblase(text: text, hinten: UIColor(hex: 0xE3F654), vorne: UIColor(hex: 0x111111))
            default: return nil
            }
        }

        func mapView(_ mapView: MLNMapView, annotationCanShowCallout annotation: MLNAnnotation) -> Bool { false }
    }
}

// MARK: - Punkt-Ansichten

private final class PinAnsicht: MLNAnnotationView {
    init(bild: String, groesse: CGSize, ankerUnten: Bool) {
        super.init(reuseIdentifier: nil)
        frame = CGRect(origin: .zero, size: groesse)
        let v = UIImageView(image: UIImage(named: bild))
        v.frame = bounds
        v.contentMode = .scaleAspectFit
        addSubview(v)
        // Spitze des Pins auf dem Ort (anchor 17.5 / 41.1367 im Web).
        if ankerUnten { centerOffset = CGVector(dx: 0, dy: -groesse.height / 2) }
        isUserInteractionEnabled = false
    }
    required init?(coder: NSCoder) { fatalError() }
}

/// Blauer Standortpunkt (35 x 35) mit Fahrernummer, weiss 20 fett.
private final class FahrerPunkt: MLNAnnotationView {
    init(nummer: String) {
        super.init(reuseIdentifier: nil)
        frame = CGRect(x: 0, y: 0, width: 35, height: 35)
        let v = UIImageView(image: UIImage(named: "Fahrer_Standort_Trisar_01_blau"))
        v.frame = bounds
        addSubview(v)
        let l = UILabel(frame: bounds)
        l.text = nummer
        l.textAlignment = .center
        l.textColor = .white
        l.font = WebText.schrift(20, .bold)
        addSubview(l)
        layer.zPosition = 1000
        isUserInteractionEnabled = false
    }
    required init?(coder: NSCoder) { fatalError() }
}

/// Kollege: Kollege_Pin_Trisar_01_lime 35 x 41, Spitze auf dem Ort, Text im Kopf (Mitte bei 17,5).
private final class KollegenPin: MLNAnnotationView {
    init(text: String, groesse: CGFloat) {
        super.init(reuseIdentifier: nil)
        frame = CGRect(x: 0, y: 0, width: 35, height: 41.1367)
        let v = UIImageView(image: UIImage(named: "Kollege_Pin_Trisar_01_lime"))
        v.frame = bounds
        v.contentMode = .scaleAspectFit
        addSubview(v)
        let l = UILabel(frame: CGRect(x: 0, y: 17.5 - 12, width: 35, height: 24))
        l.text = text
        l.textAlignment = .center
        l.textColor = UIColor(hex: 0x1A1A1A)
        l.font = WebText.schrift(groesse, .bold)
        addSubview(l)
        centerOffset = CGVector(dx: 0, dy: -41.1367 / 2)
        layer.zPosition = 305
        isUserInteractionEnabled = false
    }
    required init?(coder: NSCoder) { fatalError() }
}

/// Flugzeug 46 x 46, nach Kurs gedreht, leichter Schatten (createFlightOverlay).
private final class Flugzeug: MLNAnnotationView {
    init(kurs: Double) {
        super.init(reuseIdentifier: nil)
        frame = CGRect(x: 0, y: 0, width: 46, height: 46)
        let v = UIImageView(image: UIImage(named: "Flugzeug_Karte_Trisar_01_lime"))
        v.frame = bounds
        v.contentMode = .scaleAspectFit
        v.transform = CGAffineTransform(rotationAngle: CGFloat(kurs) * .pi / 180)
        v.layer.shadowColor = UIColor.black.cgColor
        v.layer.shadowOpacity = 0.45
        v.layer.shadowRadius = 3
        v.layer.shadowOffset = CGSize(width: 0, height: 1)
        addSubview(v)
        layer.zPosition = 330
        isUserInteractionEnabled = false
    }
    required init?(coder: NSCoder) { fatalError() }
}

/// Zeitblase auf der Routenmitte: Pille, 13 pt fett, Schatten, sitzt mit der Unterkante auf dem Punkt.
private final class Zeitblase: MLNAnnotationView {
    init(text: String, hinten: UIColor, vorne: UIColor) {
        super.init(reuseIdentifier: nil)
        let l = UILabel()
        l.text = text
        l.font = WebText.schrift(13, .bold)
        l.textColor = vorne
        l.sizeToFit()
        let breite = l.bounds.width + 24, hoehe = l.bounds.height + 12
        frame = CGRect(x: 0, y: 0, width: breite, height: hoehe)
        backgroundColor = hinten
        layer.cornerRadius = hoehe / 2
        layer.shadowColor = UIColor.black.cgColor
        layer.shadowOpacity = 0.35
        layer.shadowRadius = 9
        layer.shadowOffset = CGSize(width: 0, height: 6)
        l.center = CGPoint(x: breite / 2, y: hoehe / 2)
        addSubview(l)
        centerOffset = CGVector(dx: 0, dy: -hoehe / 2)
        layer.zPosition = 360
        isUserInteractionEnabled = false
    }
    required init?(coder: NSCoder) { fatalError() }
}

extension UIColor {
    convenience init(hex: UInt32) {
        self.init(red: CGFloat((hex >> 16) & 0xFF) / 255, green: CGFloat((hex >> 8) & 0xFF) / 255,
                  blue: CGFloat(hex & 0xFF) / 255, alpha: 1)
    }
}
