import MapLibre
import SwiftUI
import UIKit

// Eigene Orte auf der Karte: Icon-Marker, Schild mit Name und Radien, zwei Kreise
// (innen Reinfahr-Radius gefuellt, aussen Rausfahr-Radius gestrichelt) und die kleine
// Karte im Ort-Editor mit ziehbarem Pin.

/// Punkt eines eigenen Orts auf der Karte.
final class OrtKartenPunkt: MLNPointAnnotation {
    var ort: EigenerOrt
    init(ort: EigenerOrt) {
        self.ort = ort
        super.init()
        coordinate = ort.punkt
    }
    required init?(coder: NSCoder) { fatalError() }
}

/// Schild ueber dem gewaehlten Ort.
final class OrtSchildPunkt: MLNPointAnnotation {
    let text: String
    let unter: String
    init(text: String, unter: String) { self.text = text; self.unter = unter; super.init() }
    required init?(coder: NSCoder) { fatalError() }
}

/// Icon-Marker wie die Ort-Kacheln im Blatt (#242525, abgerundet), 34 x 34 mittig auf dem Ort.
/// Gewaehlt: Lime-Rand und Lime-Icon.
final class OrtMarkerAnsicht: MLNAnnotationView {
    static let groesse: CGFloat = 34
    private let bild = UIImageView()

    init() {
        super.init(reuseIdentifier: nil)
        frame = CGRect(x: 0, y: 0, width: Self.groesse, height: Self.groesse)
        backgroundColor = UIColor(hex: 0x242525)
        layer.cornerRadius = 9
        layer.borderColor = UIColor(hex: 0xE3F654).cgColor
        layer.shadowColor = UIColor.black.cgColor
        layer.shadowOpacity = 0.45
        layer.shadowRadius = 5
        layer.shadowOffset = CGSize(width: 0, height: 3)
        bild.frame = bounds.insetBy(dx: 7, dy: 7)
        bild.contentMode = .scaleAspectFit
        addSubview(bild)
        isUserInteractionEnabled = false
    }
    required init?(coder: NSCoder) { fatalError() }

    func anwenden(_ symbol: OrtSymbol, aktiv: Bool) {
        bild.image = UIImage(named: aktiv ? symbol.lime : symbol.grau)
        layer.borderWidth = aktiv ? 2 : 0
        layer.zPosition = aktiv ? 330 : 150
    }
}

/// Schild mit Name (fett, Lime) und "rein 50 m / raus 120 m", Unterkante ueber dem Marker.
final class OrtSchildAnsicht: MLNAnnotationView {
    init(text: String, unter: String) {
        super.init(reuseIdentifier: nil)
        let oben = UILabel(), u = UILabel()
        oben.text = text
        oben.font = WebText.schrift(13, .heavy)
        oben.textColor = UIColor(hex: 0xE3F654)
        u.text = unter
        u.font = WebText.schrift(12, .medium)
        u.textColor = UIColor(white: 1, alpha: 0.75)
        oben.sizeToFit(); u.sizeToFit()
        let breite = min(260, max(oben.bounds.width, u.bounds.width)) + 24
        let hoehe = oben.bounds.height + u.bounds.height + 2 + 14
        frame = CGRect(x: 0, y: 0, width: breite, height: hoehe)
        backgroundColor = UIColor(hex: 0x17181B)
        layer.cornerRadius = 10
        layer.borderWidth = 1
        layer.borderColor = UIColor(hex: 0x4A4F22).cgColor
        layer.shadowColor = UIColor.black.cgColor
        layer.shadowOpacity = 0.35
        layer.shadowRadius = 9
        layer.shadowOffset = CGSize(width: 0, height: 6)
        oben.frame = CGRect(x: 12, y: 7, width: breite - 24, height: oben.bounds.height)
        oben.lineBreakMode = .byTruncatingTail
        u.frame = CGRect(x: 12, y: 7 + oben.bounds.height + 2, width: breite - 24, height: u.bounds.height)
        addSubview(oben); addSubview(u)
        centerOffset = CGVector(dx: 0, dy: -(OrtMarkerAnsicht.groesse / 2 + 8 + hoehe / 2))
        layer.zPosition = 340
        isUserInteractionEnabled = false
    }
    required init?(coder: NSCoder) { fatalError() }
}

/// Zwei Kreise um einen Ort als Kartenebenen (in Metern, passen also bei jedem Zoom).
enum OrtKreise {
    private static let lime = UIColor(hex: 0xE3F654)

    /// Ring aus 72 Punkten um die Mitte (geschlossen).
    static func ring(_ mitte: CLLocationCoordinate2D, meter: Double) -> [CLLocationCoordinate2D] {
        let schritte = 72
        let breite = meter / 110_540
        let laenge = meter / (111_320 * max(0.01, cos(mitte.latitude * .pi / 180)))
        return (0...schritte).map { i in
            let w = Double(i) / Double(schritte) * 2 * .pi
            return CLLocationCoordinate2D(latitude: mitte.latitude + breite * sin(w), longitude: mitte.longitude + laenge * cos(w))
        }
    }

    /// Setzt oder leert (mitte nil) die Kreise mit eigener Kennung.
    static func setzen(_ stil: MLNStyle, kennung: String, mitte: CLLocationCoordinate2D?, rein: Int, raus: Int) {
        var innen: MLNShape?, innenRand: MLNShape?, aussen: MLNShape?
        if let mitte, rein > 0 {
            var r = ring(mitte, meter: Double(rein))
            innen = MLNPolygonFeature(coordinates: &r, count: UInt(r.count))
            innenRand = MLNPolylineFeature(coordinates: &r, count: UInt(r.count))
        }
        if let mitte, raus > 0 {
            var r = ring(mitte, meter: Double(raus))
            aussen = MLNPolylineFeature(coordinates: &r, count: UInt(r.count))
        }
        quelle(stil, "\(kennung)-rein", innen) { q in
            let e = MLNFillStyleLayer(identifier: "\(kennung)-rein", source: q)
            e.fillColor = NSExpression(forConstantValue: lime)
            e.fillOpacity = NSExpression(forConstantValue: 0.18)
            return e
        }
        quelle(stil, "\(kennung)-rein-rand", innenRand) { q in
            let e = MLNLineStyleLayer(identifier: "\(kennung)-rein-rand", source: q)
            e.lineColor = NSExpression(forConstantValue: lime)
            e.lineWidth = NSExpression(forConstantValue: 1.5)
            e.lineOpacity = NSExpression(forConstantValue: 0.8)
            return e
        }
        quelle(stil, "\(kennung)-raus", aussen) { q in
            let e = MLNLineStyleLayer(identifier: "\(kennung)-raus", source: q)
            e.lineColor = NSExpression(forConstantValue: lime)
            e.lineWidth = NSExpression(forConstantValue: 2)
            e.lineDashPattern = NSExpression(forConstantValue: [2, 2])
            return e
        }
    }

    private static func quelle(_ stil: MLNStyle, _ kennung: String, _ form: MLNShape?,
                               ebene: (MLNShapeSource) -> MLNStyleLayer) {
        if let q = stil.source(withIdentifier: kennung) as? MLNShapeSource {
            q.shape = form
            return
        }
        let q = MLNShapeSource(identifier: kennung, shape: form, options: nil)
        stil.addSource(q)
        stil.addLayer(ebene(q))
    }

    /// Grenzen um den aeusseren Kreis (zum Einpassen).
    static func grenzen(_ mitte: CLLocationCoordinate2D, meter: Double) -> MLNCoordinateBounds {
        let breite = meter / 110_540
        let laenge = meter / (111_320 * max(0.01, cos(mitte.latitude * .pi / 180)))
        return MLNCoordinateBounds(sw: CLLocationCoordinate2D(latitude: mitte.latitude - breite, longitude: mitte.longitude - laenge),
                                   ne: CLLocationCoordinate2D(latitude: mitte.latitude + breite, longitude: mitte.longitude + laenge))
    }
}

/// Karte im Ort-Editor: Pin ziehen (oder auf die Karte tippen) setzt lat/lng, die Kreise
/// wandern live mit. Die Adresse bleibt die gesuchte.
struct OrtKarte: UIViewRepresentable {
    var punkt: CLLocationCoordinate2D?
    var rein: Int
    var raus: Int
    var symbol: OrtSymbol
    /// Erhoeht sich nach einer neuen Adresse: auf Pin und Kreise einpassen.
    var einpassenSignal: Int
    var verschoben: (CLLocationCoordinate2D) -> Void

    func makeCoordinator() -> Koordinator { Koordinator() }

    func makeUIView(context: Context) -> MLNMapView {
        let karte = MLNMapView(frame: .zero, styleURL: DispoKarte.stil)
        karte.delegate = context.coordinator
        karte.backgroundColor = UIColor(hex: 0x0E0E0E)
        karte.setCenter(punkt ?? CLLocationCoordinate2D(latitude: 48.137154, longitude: 11.576124),
                        zoomLevel: punkt == nil ? 11 : 16, animated: false)
        karte.logoView.isHidden = true
        karte.compassView.isHidden = true
        karte.showsScale = false
        karte.isRotateEnabled = false
        karte.isPitchEnabled = false
        karte.attributionButtonPosition = .bottomRight
        karte.attributionButton.tintColor = UIColor(white: 0.6, alpha: 0.8)
        let tipp = UITapGestureRecognizer(target: context.coordinator, action: #selector(Koordinator.getippt(_:)))
        for g in karte.gestureRecognizers ?? [] {
            if let t = g as? UITapGestureRecognizer, t.numberOfTapsRequired == 2 { tipp.require(toFail: t) }
        }
        karte.addGestureRecognizer(tipp)
        context.coordinator.karte = karte
        return karte
    }

    func updateUIView(_ karte: MLNMapView, context: Context) {
        context.coordinator.setzen(self)
    }

    final class Koordinator: NSObject, MLNMapViewDelegate {
        weak var karte: MLNMapView?
        private var stand: OrtKarte?
        private var stilGeladen = false
        private var pin: MLNPointAnnotation?
        private var pinAnsicht: OrtMarkerAnsicht?
        private var zieht = false
        private var einpassenSignal = -1
        private var aktuell: CLLocationCoordinate2D?

        func setzen(_ neu: OrtKarte) {
            stand = neu
            // Waehrend des Ziehens gilt der Finger, nicht der (noch alte) Wert von aussen.
            if !zieht { aktuell = neu.punkt }
            pinAbgleichen()
            pinAnsicht?.anwenden(neu.symbol, aktiv: true)
            kreiseZeichnen()
            if neu.einpassenSignal != einpassenSignal {
                einpassenSignal = neu.einpassenSignal
                einpassen()
            }
        }

        func mapView(_ mapView: MLNMapView, didFinishLoading style: MLNStyle) {
            stilGeladen = true
            kreiseZeichnen()
        }

        func mapView(_ mapView: MLNMapView, annotationCanShowCallout annotation: MLNAnnotation) -> Bool { false }

        func mapView(_ mapView: MLNMapView, didSelect annotation: MLNAnnotation) {
            mapView.deselectAnnotation(annotation, animated: false)
        }

        func mapView(_ mapView: MLNMapView, viewFor annotation: MLNAnnotation) -> MLNAnnotationView? {
            guard annotation === pin, let karte = mapView as MLNMapView? else { return nil }
            let v = OrtMarkerAnsicht()
            v.anwenden(stand?.symbol ?? .pin, aktiv: true)
            // Der Pin selbst nimmt den Finger an, die Karte verschiebt sich dann nicht.
            v.isUserInteractionEnabled = true
            let ziehen = UIPanGestureRecognizer(target: self, action: #selector(gezogen(_:)))
            v.addGestureRecognizer(ziehen)
            for g in karte.gestureRecognizers ?? [] where g is UIPanGestureRecognizer { g.require(toFail: ziehen) }
            pinAnsicht = v
            return v
        }

        private func pinAbgleichen() {
            guard let karte else { return }
            guard let ort = aktuell else {
                if let pin { karte.removeAnnotation(pin) }
                pin = nil
                pinAnsicht = nil
                return
            }
            if let pin {
                if pin.coordinate.latitude != ort.latitude || pin.coordinate.longitude != ort.longitude { pin.coordinate = ort }
            } else {
                let p = MLNPointAnnotation()
                p.coordinate = ort
                pin = p
                karte.addAnnotation(p)
            }
        }

        private func kreiseZeichnen() {
            guard stilGeladen, let stil = karte?.style, let stand else { return }
            OrtKreise.setzen(stil, kennung: "ort-edit", mitte: aktuell, rein: stand.rein, raus: stand.raus)
        }

        private func einpassen() {
            guard let karte, let mitte = aktuell else { return }
            guard karte.bounds.width > 10 else {
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) { [weak self] in self?.einpassen() }
                return
            }
            let meter = Double(max(stand?.raus ?? 100, 60))
            karte.setVisibleCoordinateBounds(OrtKreise.grenzen(mitte, meter: meter),
                                             edgePadding: UIEdgeInsets(top: 30, left: 30, bottom: 30, right: 30),
                                             animated: true, completionHandler: nil)
        }

        @objc func gezogen(_ g: UIPanGestureRecognizer) {
            guard let karte else { return }
            let ort = karte.convert(g.location(in: karte), toCoordinateFrom: karte)
            switch g.state {
            case .began:
                zieht = true
                bewegen(ort)
            case .changed:
                bewegen(ort)
            case .ended, .cancelled, .failed:
                bewegen(ort)
                zieht = false
                stand?.verschoben(ort)
            default:
                break
            }
        }

        @objc func getippt(_ g: UITapGestureRecognizer) {
            guard let karte, aktuell != nil else { return }
            let ort = karte.convert(g.location(in: karte), toCoordinateFrom: karte)
            bewegen(ort)
            stand?.verschoben(ort)
        }

        private func bewegen(_ ort: CLLocationCoordinate2D) {
            aktuell = ort
            pin?.coordinate = ort
            kreiseZeichnen()
        }
    }
}
