import CarPlay
import CoreLocation
import MapLibre
import UIKit

/// Grundansicht der CarPlay-Navigation (17.11.): NUR die Karte, wie Apple es fuer Navigations-Apps
/// verlangt. Keine eigenen Knoepfe, Felder oder Hinweise hier, alles Bedienbare kommt aus CPMapTemplate
/// (CarPlaySzene). Gleicher Kartenstil wie die Handy-Karte (CARTO Dark Matter, KarteAnsicht.stil),
/// Fahrer als Lime-Pfeil, Route blau #0059FF, Pin am Abholort bzw. Ziel.
/// Kamera: Folgen (Norden oben, in der Fuehrung Kurs oben mit Neigung), Uebersicht (Route ganz) oder
/// Frei (nach Verschieben). Die Karte bekommt keine Beruehrungen, Zoom und Verschieben kommen ueber
/// die Knoepfe und Gesten-Rueckmeldungen der Vorlage.
@MainActor
final class CarPlayKarte: UIViewController, MLNMapViewDelegate {
    enum Modus { case folgen, uebersicht, frei }

    private(set) var modus: Modus = .folgen
    private var karte: MLNMapView?
    private var stilGeladen = false

    private var fahrer: CLLocationCoordinate2D?
    private var kurs: Double = 0
    private var linie: [CLLocationCoordinate2D] = []
    private var linieBlass = false
    private var ziel: CLLocationCoordinate2D?
    private var zielAbholort = false
    /// In der Fuehrung: Kurs oben, Neigung, Fahrer im unteren Drittel.
    private var fuehrt = false
    private var zoom = 14.0
    private var fuehrungsZoom = 16.0

    private var marke: CarPlayFahrerMarke?
    private weak var markenAnsicht: CarPlayFahrerAnsicht?
    private var pin: MLNPointAnnotation?
    /// Vorschau einer Fahrt (ohne Fuehrung), wie die Fahrtkarte am Handy: Anfahrt zum Gast gestrichelt
    /// in Lime, Fahrt vom Gast zum Ziel in Blau, Pins am Abholort und am Ziel.
    private var vorschauAnfahrt: [CLLocationCoordinate2D] = []
    private var vorschauFahrt: [CLLocationCoordinate2D] = []
    private var vorschauAbhol: CLLocationCoordinate2D?
    private var abholPin: MLNPointAnnotation?
    private static let lime = UIColor(red: 0xE3 / 255, green: 0xF6 / 255, blue: 0x54 / 255, alpha: 1)
    /// Zoom-Geste am Autodisplay (ab iOS 26): Zoomstufe bei Beginn der Geste.
    private var zoomStart: Double?
    /// In dieser Geste kam schon ein brauchbarer `scale`, dann zaehlt nur der.
    private var zoomMitWert = false
    /// Ziehen: Mitte, zu der die Karte gerade gleitet, und Zeit der letzten Meldung.
    private var panZiel: CLLocationCoordinate2D?
    private var letzteMeldung: Date?

    private static let blau = UIColor(red: 0x00 / 255, green: 0x59 / 255, blue: 0xFF / 255, alpha: 1)

    override func loadView() {
        let karte = MLNMapView(frame: .zero, styleURL: KarteAnsicht.stil)
        karte.delegate = self
        karte.backgroundColor = UIColor(red: 0x10 / 255, green: 0x11 / 255, blue: 0x12 / 255, alpha: 1)
        karte.setCenter(KarteAnsicht.mitte, zoomLevel: 11, animated: false)
        // Grundansicht nur Karte: kein Logo, Kompass, Massstab oder Hinweis-Knopf.
        karte.logoView.isHidden = true
        karte.compassView.isHidden = true
        karte.attributionButton.isHidden = true
        karte.showsScale = false
        karte.automaticallyAdjustsContentInset = false
        karte.isUserInteractionEnabled = false
        self.karte = karte
        view = karte
    }

    override func viewSafeAreaInsetsDidChange() {
        super.viewSafeAreaInsetsDidChange()
        kameraSetzen(animiert: false)
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        kameraSetzen(animiert: false)
    }

    // MARK: Inhalt

    func fahrerSetzen(_ ort: CLLocationCoordinate2D?, kurs neu: Double?) {
        guard let ort else { return }
        let erster = fahrer == nil
        fahrer = ort
        if let neu { kurs = neu }
        markeSetzen()
        if modus == .folgen { kameraSetzen(animiert: !erster) }
    }

    func linieSetzen(_ punkte: [CLLocationCoordinate2D], blass: Bool = false) {
        linie = punkte
        linieBlass = blass
        linieZeichnen()
        if modus == .uebersicht { kameraSetzen(animiert: true) }
    }

    /// Vorschau setzen (leer = weg). Das Ziel kommt als Pin „ziel“, der Abholort als eigener Pin.
    func vorschauSetzen(anfahrt: [CLLocationCoordinate2D], fahrt: [CLLocationCoordinate2D],
                        abhol: CLLocationCoordinate2D?, ziel zielOrt: CLLocationCoordinate2D?) {
        vorschauAnfahrt = anfahrt
        vorschauFahrt = fahrt
        linie = []
        linieZeichnen()
        vorschauZeichnen()
        let gleich = { (a: CLLocationCoordinate2D?, b: CLLocationCoordinate2D?) in
            a?.latitude == b?.latitude && a?.longitude == b?.longitude
        }
        if !gleich(abhol, vorschauAbhol) {
            vorschauAbhol = abhol
            let alt = abholPin
            var neu: MLNPointAnnotation?
            if let abhol {
                let p = MLNPointAnnotation()
                p.coordinate = abhol
                p.title = "abholort"
                neu = p
            }
            abholPin = neu
            DispatchQueue.main.async { [weak karte] in
                if let alt { karte?.removeAnnotation(alt) }
                if let neu { karte?.addAnnotation(neu) }
            }
        }
        zielSetzen(zielOrt, abholort: false)
        if modus == .uebersicht { kameraSetzen(animiert: true) }
    }

    private func vorschauZeichnen() {
        guard stilGeladen, let stil = karte?.style else { return }
        func linie(_ kennung: String, _ punkte: [CLLocationCoordinate2D], farbe: UIColor, breite: Double, gestrichelt: Bool) {
            var form: MLNPolylineFeature?
            if punkte.count >= 2 {
                var koords = punkte
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
            ebene.lineCap = NSExpression(forConstantValue: gestrichelt ? "butt" : "round")
            ebene.lineJoin = NSExpression(forConstantValue: "round")
            if gestrichelt { ebene.lineDashPattern = NSExpression(forConstantValue: [0.8, 1.6]) }
            if let schrift = stil.layers.first(where: { $0 is MLNSymbolStyleLayer }) {
                stil.insertLayer(ebene, below: schrift)
            } else {
                stil.addLayer(ebene)
            }
        }
        linie("carplay-fahrt", vorschauFahrt, farbe: Self.blau, breite: 8, gestrichelt: false)
        linie("carplay-anfahrt", vorschauAnfahrt, farbe: Self.lime, breite: 6, gestrichelt: true)
    }

    func zielSetzen(_ ort: CLLocationCoordinate2D?, abholort: Bool) {
        let gleich = ort.map { a in ziel.map { $0.latitude == a.latitude && $0.longitude == a.longitude } ?? false } ?? (ziel == nil)
        guard !gleich || abholort != zielAbholort else { return }
        ziel = ort
        zielAbholort = abholort
        pinSetzen()
    }

    /// Fuehrung an: Kurs oben, Neigung. Aus: Norden oben.
    func fuehrungSetzen(_ an: Bool) {
        guard an != fuehrt else { return }
        fuehrt = an
        modus = .folgen
        kameraSetzen(animiert: true)
    }

    // MARK: Bedienung (aus den Knoepfen der Vorlage)

    func zoomen(_ schritt: Double) {
        guard let karte else { return }
        if modus == .folgen {
            if fuehrt { fuehrungsZoom = min(19, max(10, fuehrungsZoom + schritt)) } else { zoom = min(19, max(4, zoom + schritt)) }
            kameraSetzen(animiert: true)
        } else {
            karte.setZoomLevel(min(19, max(3, karte.zoomLevel + schritt)), animated: true)
            modus = .frei
        }
    }

    /// Knopf im Verschiebe-Modus: ein Drittel der Ansicht in die Richtung.
    func verschieben(_ richtung: CPMapTemplate.PanDirection) {
        guard let karte else { return }
        let b = karte.bounds
        var p = CGPoint(x: b.midX, y: b.midY)
        if richtung.contains(.left) { p.x -= b.width / 3 }
        if richtung.contains(.right) { p.x += b.width / 3 }
        if richtung.contains(.up) { p.y -= b.height / 3 }
        if richtung.contains(.down) { p.y += b.height / 3 }
        modus = .frei
        karte.setCenter(karte.convert(p, toCoordinateFrom: karte), animated: true)
    }

    func gesteBeginnt() {
        modus = .frei
        panZiel = nil
        letzteMeldung = Date()
    }

    /// CarPlay meldet in translation das Stueck seit der letzten Meldung (so lesen es auch
    /// maplibre-navigation-ios und Organic Maps). Die Karte gleitet in der Zeit bis zur naechsten
    /// Meldung um dieses Stueck, statt zu springen. Gerechnet wird ab dem letzten Ziel, nicht ab der
    /// gerade halb animierten Mitte, sonst ginge unterwegs Weg verloren.
    func gesteBewegt(_ translation: CGPoint) {
        guard let karte else { return }
        modus = .frei
        let jetzt = Date()
        let abstand = letzteMeldung.map { jetzt.timeIntervalSince($0) } ?? 0.05
        letzteMeldung = jetzt
        let basis = karte.convert(panZiel ?? karte.centerCoordinate, toPointTo: karte)
        let ziel = karte.convert(CGPoint(x: basis.x - translation.x, y: basis.y - translation.y), toCoordinateFrom: karte)
        panZiel = ziel
        kameraMitte(ziel, dauer: min(0.12, max(0.03, abstand)), timing: .linear)
    }

    /// Beim Loslassen mit Schwung auslaufen. Langsames Loslassen bleibt stehen.
    func gesteEndet(velocity: CGPoint) {
        defer { panZiel = nil; letzteMeldung = nil }
        guard let karte, hypot(velocity.x, velocity.y) > 150 else { return }
        let basis = karte.convert(panZiel ?? karte.centerCoordinate, toPointTo: karte)
        let nachlauf = 0.25
        let ziel = karte.convert(CGPoint(x: basis.x - velocity.x * nachlauf, y: basis.y - velocity.y * nachlauf),
                                 toCoordinateFrom: karte)
        kameraMitte(ziel, dauer: 0.6, timing: .easeOut)
    }

    private func kameraMitte(_ mitte: CLLocationCoordinate2D, dauer: TimeInterval, timing: CAMediaTimingFunctionName) {
        guard let karte, CLLocationCoordinate2DIsValid(mitte) else { return }
        let kamera = karte.camera
        kamera.centerCoordinate = mitte
        karte.setCamera(kamera, withDuration: dauer, animationTimingFunction: CAMediaTimingFunction(name: timing))
    }

    /// Zwei-Finger-Zoom (CarPlay ab iOS 26). Beim Folgen aendert sich nur die Folge-Zoomstufe,
    /// sonst wird um den Punkt zwischen den Fingern gezoomt.
    func zoomBeginnt() {
        guard let karte else { return }
        if modus == .uebersicht { modus = .frei }
        zoomStart = aktuellerZoom(karte)
        zoomMitWert = false
    }

    /// Autos melden den Zoom unterschiedlich:
    ///   `scale` aendert sich -> Faktor ab Beginn der Geste (1 = unveraendert).
    ///   `scale` bleibt 1      -> nur `velocity` taugt (so liest es auch A Better Route Planner).
    ///   scale 1 und velocity 1 -> Doppeltippen, eine Stufe hinein.
    func zoomBewegt(mitte: CGPoint, scale: CGFloat, velocity: CGFloat) {
        guard let karte else { return }
        if scale == 1 && velocity == 1 {
            if modus == .uebersicht { modus = .frei }
            zoomSetzen(aktuellerZoom(karte) + 1, um: mitte, animiert: true)
            zoomStart = nil
            return
        }
        if zoomStart == nil { zoomBeginnt() }
        guard let start = zoomStart else { return }
        if scale > 0, scale != 1 {
            zoomMitWert = true
            zoomSetzen(start + log2(Double(scale)), um: mitte, animiert: false)
        } else if !zoomMitWert, velocity != 0 {
            // Je Meldung hoechstens eine halbe Stufe, Auseinanderziehen (velocity > 0) zoomt hinein.
            let schritt = min(0.5, max(-0.5, log2(max(0.1, 1 + Double(velocity) * 0.1))))
            zoomSetzen(aktuellerZoom(karte) + schritt, um: mitte, animiert: false)
        }
    }

    private func aktuellerZoom(_ karte: MLNMapView) -> Double {
        modus == .folgen ? (fuehrt ? fuehrungsZoom : zoom) : karte.zoomLevel
    }

    private func zoomSetzen(_ ziel: Double, um mitte: CGPoint, animiert: Bool) {
        guard let karte else { return }
        if modus == .folgen {
            if fuehrt { fuehrungsZoom = min(19, max(10, ziel)) } else { zoom = min(19, max(4, ziel)) }
            kameraSetzen(animiert: animiert)
            return
        }
        let ort = karte.convert(mitte, toCoordinateFrom: karte)
        karte.setZoomLevel(min(19, max(3, ziel)), animated: false)
        // Ort unter den Fingern bleibt stehen.
        let jetzt = karte.convert(ort, toPointTo: karte)
        let p = CGPoint(x: karte.bounds.midX + (jetzt.x - mitte.x), y: karte.bounds.midY + (jetzt.y - mitte.y))
        karte.setCenter(karte.convert(p, toCoordinateFrom: karte), animated: false)
    }

    func zoomEndet() {
        zoomStart = nil
    }

    /// Ganze Route (bzw. Fahrer und Ziel), Norden oben.
    func uebersicht() {
        modus = .uebersicht
        kameraSetzen(animiert: true)
    }

    /// Zurueck zum Fahrer.
    func folgen() {
        modus = .folgen
        kameraSetzen(animiert: true)
    }

    // MARK: Kamera

    private var freiesFeld: UIEdgeInsets {
        let s = view.safeAreaInsets
        return UIEdgeInsets(top: s.top + 24, left: s.left + 24, bottom: s.bottom + 24, right: s.right + 24)
    }

    private func kameraSetzen(animiert: Bool) {
        guard let karte, karte.bounds.width > 10, karte.bounds.height > 10 else { return }
        switch modus {
        case .frei:
            return
        case .uebersicht:
            var punkte = linie + vorschauAnfahrt + vorschauFahrt
            if let fahrer { punkte.append(fahrer) }
            if let vorschauAbhol { punkte.append(vorschauAbhol) }
            if let ziel { punkte.append(ziel) }
            guard punkte.count >= 2 else { return folgenKamera(karte, animiert: animiert) }
            karte.setVisibleCoordinates(&punkte, count: UInt(punkte.count), edgePadding: freiesFeld, direction: 0,
                                        duration: animiert ? 0.6 : 0, animationTimingFunction: nil, completionHandler: nil)
            markeDrehen()
        case .folgen:
            folgenKamera(karte, animiert: animiert)
        }
    }

    private func folgenKamera(_ karte: MLNMapView, animiert: Bool) {
        guard let mitte = fahrer else { return }
        let feld = freiesFeld
        var rand = feld
        let neigung: CGFloat = fuehrt ? 45 : 0
        let z = fuehrt ? fuehrungsZoom : zoom
        if fuehrt {
            // Fahrer im unteren Drittel des freien Felds.
            let hoehe = karte.bounds.height - feld.top - feld.bottom
            rand.top += hoehe * 0.35
        }
        let kamera = MLNMapCamera(lookingAtCenter: mitte,
                                  altitude: MLNAltitudeForZoomLevel(z, neigung, mitte.latitude, karte.bounds.size),
                                  pitch: neigung, heading: fuehrt ? kurs : 0)
        karte.setCamera(kamera, withDuration: animiert ? 0.9 : 0, animationTimingFunction: CAMediaTimingFunction(name: .linear),
                        edgePadding: rand, completionHandler: nil)
        markeDrehen()
    }

    // MARK: Zeichnen

    private func linieZeichnen() {
        guard stilGeladen, let stil = karte?.style else { return }
        // Eine Linie ohne Punkte loest in MapLibre eine Ausnahme aus, darum erst ab zwei Punkten.
        var form: MLNPolylineFeature?
        if linie.count >= 2 {
            var koords = linie
            form = MLNPolylineFeature(coordinates: &koords, count: UInt(koords.count))
        }
        if let quelle = stil.source(withIdentifier: "carplay-route") as? MLNShapeSource {
            quelle.shape = form
        } else {
            let quelle = MLNShapeSource(identifier: "carplay-route", shape: form, options: nil)
            stil.addSource(quelle)
            let ebene = MLNLineStyleLayer(identifier: "carplay-route", source: quelle)
            ebene.lineColor = NSExpression(forConstantValue: Self.blau)
            ebene.lineWidth = NSExpression(forConstantValue: 9)
            ebene.lineCap = NSExpression(forConstantValue: "round")
            ebene.lineJoin = NSExpression(forConstantValue: "round")
            if let schrift = stil.layers.first(where: { $0 is MLNSymbolStyleLayer }) {
                stil.insertLayer(ebene, below: schrift)
            } else {
                stil.addLayer(ebene)
            }
        }
        if let ebene = stil.layer(withIdentifier: "carplay-route") as? MLNLineStyleLayer {
            ebene.lineOpacity = NSExpression(forConstantValue: linieBlass ? 0.35 : 1)
        }
    }

    private func pinSetzen() {
        let alt = pin
        var neu: MLNPointAnnotation?
        if let ziel {
            let p = MLNPointAnnotation()
            p.coordinate = ziel
            p.title = zielAbholort ? "abholort" : "ziel"
            neu = p
        }
        pin = neu
        // Nie mitten in einem Rueckruf der Karte tauschen (wie NaviKarte).
        DispatchQueue.main.async { [weak karte] in
            if let alt { karte?.removeAnnotation(alt) }
            if let neu { karte?.addAnnotation(neu) }
        }
    }

    private func markeSetzen() {
        guard let fahrer else { return }
        if let marke {
            marke.coordinate = fahrer
        } else {
            let neu = CarPlayFahrerMarke()
            neu.coordinate = fahrer
            marke = neu
            DispatchQueue.main.async { [weak karte] in karte?.addAnnotation(neu) }
        }
        markeDrehen()
    }

    /// Pfeil in Fahrtrichtung relativ zur Karte (bei Kurs oben zeigt er nach oben).
    private func markeDrehen() {
        guard let karte, let ansicht = markenAnsicht else { return }
        let winkel = (kurs - karte.direction) * .pi / 180
        let neigung = Double(karte.camera.pitch) * .pi / 180
        ansicht.drehen(CGFloat(atan2(sin(winkel), cos(winkel) * cos(neigung))))
    }

    // MARK: MLNMapViewDelegate

    nonisolated func mapView(_ mapView: MLNMapView, didFinishLoading style: MLNStyle) {
        MainActor.assumeIsolated {
            stilGeladen = true
            linieZeichnen()
            vorschauZeichnen()
        }
    }

    nonisolated func mapView(_ mapView: MLNMapView, regionIsChangingWith reason: MLNCameraChangeReason) {
        MainActor.assumeIsolated { markeDrehen() }
    }

    nonisolated func mapView(_ mapView: MLNMapView, viewFor annotation: MLNAnnotation) -> MLNAnnotationView? {
        MainActor.assumeIsolated {
            if annotation is CarPlayFahrerMarke {
                let ansicht = CarPlayFahrerAnsicht()
                markenAnsicht = ansicht
                markeDrehen()
                return ansicht
            }
            guard let art = annotation.title ?? nil else { return nil }
            return CarPlayPin(bild: art == "abholort" ? "Abholort_Pin_Trisar_01_rot" : "Ziel_Pin_Trisar_01")
        }
    }

    nonisolated func mapView(_ mapView: MLNMapView, annotationCanShowCallout annotation: MLNAnnotation) -> Bool { false }
}

/// Der Fahrer als Marker der Karte.
private final class CarPlayFahrerMarke: MLNPointAnnotation {}

/// Fahrer: Lime-Pfeil mit dunklem Rand (wie im Entwurf), dreht in Fahrtrichtung.
private final class CarPlayFahrerAnsicht: MLNAnnotationView {
    private let pfeil = UIView()

    init() {
        super.init(reuseIdentifier: nil)
        let seite: CGFloat = 44
        frame = CGRect(x: 0, y: 0, width: seite, height: seite)
        let umriss = UIBezierPath()
        umriss.move(to: CGPoint(x: 22, y: 4))
        umriss.addLine(to: CGPoint(x: 37, y: 38))
        umriss.addLine(to: CGPoint(x: 22, y: 30))
        umriss.addLine(to: CGPoint(x: 7, y: 38))
        umriss.close()
        let form = CAShapeLayer()
        form.path = umriss.cgPath
        form.fillColor = UIColor(red: 0xE2 / 255, green: 0xF7 / 255, blue: 0x54 / 255, alpha: 1).cgColor
        form.strokeColor = UIColor(red: 0x24 / 255, green: 0x25 / 255, blue: 0x25 / 255, alpha: 1).cgColor
        form.lineWidth = 2.5
        form.lineJoin = .round
        pfeil.frame = bounds
        pfeil.layer.addSublayer(form)
        addSubview(pfeil)
        layer.zPosition = 500
        scalesWithViewingDistance = false
        isEnabled = false
        isUserInteractionEnabled = false
    }
    required init?(coder: NSCoder) { fatalError() }

    func drehen(_ bogen: CGFloat) {
        pfeil.transform = CGAffineTransform(rotationAngle: bogen)
    }
}

/// Pin am Abholort bzw. Ziel, Spitze auf dem Ort (gleiche Bilder wie die Handy-Karte).
private final class CarPlayPin: MLNAnnotationView {
    init(bild: String) {
        super.init(reuseIdentifier: nil)
        let groesse = CGSize(width: 35, height: 41.1367)
        frame = CGRect(origin: .zero, size: groesse)
        let v = UIImageView(image: UIImage(named: bild))
        v.frame = bounds
        v.contentMode = .scaleAspectFit
        addSubview(v)
        centerOffset = CGVector(dx: 0, dy: -groesse.height / 2)
        isUserInteractionEnabled = false
    }
    required init?(coder: NSCoder) { fatalError() }
}
