import CoreLocation
import MapLibre
import SwiftUI
import UIKit

/// Eigene Navigation (16.11.), Vollbild ueber dem Fahrtblatt. Nur bei Fahrten mit Route von Dispo.
/// Dunkle Karte, Banner mit dem naechsten Hinweis, Fuss mit Ankunft, Ton und Beenden.
/// Die Karte ist frei bedienbar: „Folgen“ (Start, Kurs oben) oder „Frei“ nach Verschieben oder Drehen,
/// rechts ueber dem Fuss die Knoepfe „Route anzeigen“ und (nur in „Frei“) „Zentrieren“.
/// Die Fuehrung selbst (Fortschritt, Abseits, Ansage) liegt in Dienste/NaviFuehrung.swift.
struct NavigationAnsicht: View {
    let fahrtID: UUID
    /// Letzter Standort der App, damit die Route nicht auf den ersten eigenen Fix wartet.
    let start: CLLocation?
    var schliessen: () -> Void

    @EnvironmentObject private var speicher: FahrtenSpeicher
    /// Dieselbe Fuehrung wie in CarPlay (eine Route, eine Ansage).
    @ObservedObject private var navi = NaviFuehrung.geteilt
    @State private var bildschirmVorher = false
    /// Modus der Karte, gemeldet von NaviKarte: Folgen (Kamera faehrt mit) oder Frei.
    @State private var folgt = true
    /// Zaehler fuer die Knoepfe, die Karte fuehrt bei jeder Erhoehung einmal aus.
    @State private var uebersichtSignal = 0
    @State private var zentrierenSignal = 0

    private static let lime = Color(hex: 0xE2F754)
    private static let orange = Color(hex: 0xFF9F43)
    private static let blau = Color(hex: 0x0059FF)
    private static let grau = Color(hex: 0x868687)
    /// Der Fahrer steht im unteren Drittel (Anteil der Hoehe von oben).
    private static let fahrerAnteil: CGFloat = 0.66
    private static let fussHoehe: CGFloat = 106

    private var fahrt: Fahrt? { speicher.fahrten.first { $0.id == fahrtID } }
    private var unterwegs: Bool {
        #if DEBUG
        if NaviFuehrung.testLauf { return ProcessInfo.processInfo.environment["NAVI_TEST_ANFAHRT"] == nil }
        #endif
        return NaviFuehrung.gastAnBord(fahrt?.status)
    }

    var body: some View {
        GeometryReader { geo in
            let rand = geo.safeAreaInsets
            let breite = geo.size.width + rand.leading + rand.trailing
            let hoehe = geo.size.height + rand.top + rand.bottom
            ZStack(alignment: .topLeading) {
                NaviKarte(stand: navi.karte, fahrerAnteil: Self.fahrerAnteil, fussHoehe: Self.fussHoehe,
                          uebersichtSignal: uebersichtSignal, vorschauGanz: vorschauAmAbholort,
                          zentrierenSignal: zentrierenSignal,
                          modus: { neu in DispatchQueue.main.async { folgt = neu } })
                VStack(alignment: .leading, spacing: 0) {
                    banner
                        .padding(.horizontal, 12)
                        .padding(.top, max(54, rand.top + 6))
                    if navi.anzeige.lage == .fuehrt, let dann = navi.anzeige.dann {
                        dannLasche(dann).padding(.leading, 12)
                    }
                    if let v = navi.karte.vorschau {
                        legende(v).padding(.leading, 12).padding(.top, 8)
                    }
                    Spacer(minLength: 0)
                    kartenKnoepfe
                    fuss
                }
            }
            .frame(width: breite, height: hoehe)
            .ignoresSafeArea()
        }
        .background(Color(hex: 0x0A0A0A).ignoresSafeArea())
        .onAppear {
            // Bildschirm bleibt an, solange die Navigation offen ist.
            bildschirmVorher = UIApplication.shared.isIdleTimerDisabled
            UIApplication.shared.isIdleTimerDisabled = true
            navi.starten(fahrtID: fahrtID, unterwegs: unterwegs, start: start)
            #if DEBUG
            // Nur Debug (-naviTest): "Route anzeigen" nach N Sekunden ausloesen, fuer Bilder ohne Tippen.
            if NaviFuehrung.testLauf, let nach = Double(ProcessInfo.processInfo.environment["NAVI_TEST_UEBERSICHT_NACH"] ?? "") {
                DispatchQueue.main.asyncAfter(deadline: .now() + nach) { uebersichtSignal += 1 }
            }
            #endif
        }
        .onDisappear {
            UIApplication.shared.isIdleTimerDisabled = bildschirmVorher
            navi.beenden()
        }
        // Gast steigt ein: von der Anfahrt auf die Route der Fahrt wechseln.
        .onChange(of: unterwegs) { _, neu in navi.phase(unterwegs: neu) }
        // Im Auto beendet (Ende in CarPlay oder das Auto startet seine eigene Navigation): hier auch zu.
        .onChange(of: navi.nutzer.contains(.handy)) { vorher, jetzt in if vorher && !jetzt { schliessen() } }
    }

    // MARK: - Banner

    @ViewBuilder
    private var banner: some View {
        let a = navi.anzeige
        switch a.lage {
        case .fuehrt:
            if let h = a.naechster {
                bannerFeld(pfeil: h.pfeil, farbe: Self.lime, rand: Self.lime,
                           gross: NaviText.entfernung(a.entfernung), grossGroesse: 32,
                           klein: h.kurz, kleinGroesse: 18)
            } else {
                bannerFeld(pfeil: "gerade", farbe: Self.lime, rand: Self.lime,
                           gross: nil, grossGroesse: 32, klein: "Der Route folgen", kleinGroesse: 18)
            }
        case .abseits:
            bannerFeld(pfeil: "wenden", farbe: Self.orange, rand: Self.orange,
                       gross: "Abseits der Route", grossGroesse: 22,
                       klein: "Zurück zur Route von Dispo", kleinGroesse: 15)
        case .angekommen:
            bannerFeld(pfeil: "ziel", farbe: Self.lime, rand: Self.lime,
                       gross: a.amAbholort ? "Abholort erreicht" : "Ziel erreicht", grossGroesse: 24,
                       klein: nil, kleinGroesse: 18)
        case .warteStandort:
            bannerFeld(pfeil: "gerade", farbe: Self.grau, rand: Self.lime,
                       gross: nil, grossGroesse: 32, klein: "Warte auf Standort", kleinGroesse: 18)
        case .laedt:
            bannerFeld(pfeil: "gerade", farbe: Self.grau, rand: Self.lime,
                       gross: nil, grossGroesse: 32, klein: "Route wird geladen", kleinGroesse: 18)
        case .fehler:
            bannerFeld(pfeil: "gerade", farbe: Self.grau, rand: Self.lime,
                       gross: nil, grossGroesse: 32, klein: "Route konnte nicht geladen werden", kleinGroesse: 18)
        }
    }

    /// Schwarzes Feld mit Rand 1,5: links Kachel 64 mit Pfeil, rechts grosse Zeile in Farbe und kleine in Weiss.
    private func bannerFeld(pfeil: String, farbe: Color, rand: Color, gross: String?, grossGroesse: CGFloat,
                            klein: String?, kleinGroesse: CGFloat) -> some View {
        HStack(spacing: 14) {
            NaviPfeilBild(art: pfeil, farbe: farbe)
                .frame(width: 64, height: 64)
                .background(RoundedRectangle(cornerRadius: 16).fill(Color(hex: 0x242525)))
            VStack(alignment: .leading, spacing: 4) {
                if let gross {
                    Text(gross).grotesk(grossGroesse, .bold, abstand: -1).foregroundStyle(farbe)
                        .lineLimit(1).minimumScaleFactor(0.7)
                }
                if let klein {
                    Text(klein).grotesk(kleinGroesse, .bold, abstand: -0.5).foregroundStyle(.white)
                        .lineLimit(2).minimumScaleFactor(0.8)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 16).padding(.vertical, 14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.black)
        .overlay(Rectangle().strokeBorder(rand, lineWidth: 1.5))
    }

    /// Am Abholort mit Route der Dispo: Karte zeigt die ganze Route bis zum Ziel, Fuss die ETA am Ziel.
    private var vorschauAmAbholort: Bool {
        navi.karte.vorschau != nil && navi.anzeige.lage == .angekommen && navi.anzeige.amAbholort
    }

    /// Legende unter dem Banner, nur mit Route der Dispo vor dem Einsteigen.
    private func legende(_ v: NaviVorschau) -> some View {
        HStack(spacing: 8) {
            if vorschauAmAbholort {
                legendenStrich(Self.lime)
                let minuten = Int((v.dauer / 60).rounded(.up))
                Text(v.dauer > 0 ? "Route Dispo · \(Self.km(v.laenge)) · \(minuten) min"
                                 : "Route Dispo · \(Self.km(v.laenge))").grotesk(13, .bold)
            } else {
                legendenStrich(Self.blau)
                Text("Anfahrt").grotesk(13, .bold)
                legendenStrich(Self.lime).padding(.leading, 8)
                Text("Route Dispo").grotesk(13, .bold)
            }
        }
        .foregroundStyle(Color(hex: 0xDDDDDD))
        .lineLimit(1)
        .padding(.horizontal, 12).padding(.vertical, 6)
        .background(Color.black)
        .overlay(Rectangle().strokeBorder(Color(hex: 0x4A4F22), lineWidth: 1.5))
    }

    /// "38 km" ab 10 km, darunter "4,2 km".
    private static func km(_ m: Double) -> String {
        m >= 10_000 ? "\(Int((m / 1000).rounded())) km" : NaviText.reststrecke(m)
    }

    private func legendenStrich(_ farbe: Color) -> some View {
        Capsule().fill(farbe).frame(width: 22, height: 5)
    }

    /// Kleine Lasche unter dem Banner fuer den uebernaechsten Hinweis.
    private func dannLasche(_ h: NaviHinweis) -> some View {
        HStack(spacing: 8) {
            Text("dann").grotesk(13, .bold)
            NaviPfeilBild(art: h.pfeil, farbe: Color(hex: 0xCCCCCC), groesse: 16)
            Text(h.strasse.isEmpty ? h.kurz : h.strasse).grotesk(13, .bold).lineLimit(1)
        }
        .foregroundStyle(Color(hex: 0xCCCCCC))
        .padding(.horizontal, 12).padding(.vertical, 6)
        .background(Color.black)
        .overlay(NaviLaschenRand().stroke(Color(hex: 0x4A4F22), lineWidth: 1.5))
        .frame(maxWidth: 300, alignment: .leading)
    }

    // MARK: - Knoepfe der Karte

    /// Rechts ueber dem Fuss (Abstand rechts 12, 12 ueber dem Fuss, 10 dazwischen), rund 50.
    /// „Route anzeigen“ steht immer da, „Zentrieren“ darueber nur in „Frei“ (Lime, damit er auffaellt).
    private var kartenKnoepfe: some View {
        VStack(spacing: 10) {
            if !folgt {
                Button { zentrierenSignal += 1 } label: {
                    NaviStandortPfeil().fill(Color.black)
                        .frame(width: 24, height: 24)
                        .frame(width: 50, height: 50)
                        .background(Circle().fill(Self.lime))
                        .contentShape(Circle())
                }
                .buttonStyle(.web)
                .accessibilityLabel("Zentrieren")
                .transition(.opacity)
            }
            Button { uebersichtSignal += 1 } label: {
                NaviUebersichtBild(farbe: Self.lime)
                    .frame(width: 26, height: 26)
                    .frame(width: 50, height: 50)
                    .background(Circle().fill(Color(hex: 0x242525)))
                    .contentShape(Circle())
            }
            .buttonStyle(.web)
            .accessibilityLabel("Route anzeigen")
        }
        .animation(.easeOut(duration: 0.15), value: folgt)
        .frame(maxWidth: .infinity, alignment: .trailing)
        .padding(.trailing, 12)
        .padding(.bottom, 12)
    }

    // MARK: - Fuss

    private var etaText: String {
        if vorschauAmAbholort, let v = navi.karte.vorschau, v.dauer > 0 {
            return Datum.uhrzeit(navi.jetzt.addingTimeInterval(v.dauer))
        }
        guard let rest = navi.anzeige.restSekunden else { return "--:--" }
        return Datum.uhrzeit(navi.jetzt.addingTimeInterval(rest))
    }

    private var restText: String {
        if vorschauAmAbholort { return "" }
        guard let sekunden = navi.anzeige.restSekunden, let meter = navi.anzeige.restMeter else { return "" }
        let minuten = Int((sekunden / 60).rounded(.up))
        return "\(KarteAnsicht.Koordinator.dauer(minuten)) · \(NaviText.reststrecke(meter))"
    }

    private var fuss: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text(vorschauAmAbholort ? "ETA Ziel" : "ETA").grotesk(12, .bold, abstand: -0.3).foregroundStyle(Self.grau)
                HStack(alignment: .firstTextBaseline, spacing: 10) {
                    Text(etaText).grotesk(32, .bold, abstand: -1).foregroundStyle(Self.lime)
                        .lineLimit(1).fixedSize()
                    Text(restText).grotesk(14, .bold).foregroundStyle(Color(hex: 0xF4F5F4).opacity(0.6))
                        .lineLimit(1).minimumScaleFactor(0.7)
                }
            }
            Spacer(minLength: 0)
            Button { navi.stumm.toggle() } label: {
                NaviTonBild(stumm: navi.stumm)
                    .stroke(Self.lime, style: StrokeStyle(lineWidth: 2.2, lineCap: .round, lineJoin: .round))
                    .frame(width: 26, height: 26)
                    .frame(width: 56, height: 56)
                    .background(Circle().fill(Color(hex: 0x242525)))
                    .contentShape(Circle())
            }
            .buttonStyle(.web)
            .accessibilityLabel(navi.stumm ? "Ansage einschalten" : "Ansage ausschalten")
            Button {
                navi.beenden()
                schliessen()
            } label: {
                NaviKreuz()
                    .stroke(Color.black, style: StrokeStyle(lineWidth: 3, lineCap: .butt))
                    .frame(width: 22, height: 22)
                    .frame(width: 56, height: 56)
                    .background(Circle().fill(Color(hex: 0xFF6F63)))
                    .overlay(Circle().strokeBorder(Color.black, lineWidth: 2))
                    .contentShape(Circle())
            }
            .buttonStyle(.web)
            .accessibilityLabel("Navigation beenden")
        }
        .padding(.top, 16).padding(.horizontal, 20).padding(.bottom, 30)
        .frame(maxWidth: .infinity)
        .background(Color.black)
        .overlay(alignment: .top) { Rectangle().fill(Self.lime).frame(height: 1.5) }
    }
}

// MARK: - Karte

/// Karte der Navigation: gleicher Stil wie die Fahrtkarte (CARTO Dark Matter), frei bedienbar wie in
/// Navi-Apps (verschieben, mit zwei Fingern zoomen, Doppeltipp, drehen). Zwei Modi:
/// Folgen = die Kamera faehrt mit, Kurs oben, Neigung 45 Grad, Fahrer im unteren Drittel. Zoomen
/// allein aendert nur die Zoomstufe, mit der sie weiter folgt.
/// Frei = der Nutzer hat verschoben oder gedreht (oder die Uebersicht gewaehlt), die Kamera bleibt stehen.
/// Der Fahrerpfeil ist ein Marker der Karte an seinem echten Ort und zeigt in Fahrtrichtung.
struct NaviKarte: UIViewRepresentable {
    var stand: NaviFuehrung.Karte
    var fahrerAnteil: CGFloat
    var fussHoehe: CGFloat
    /// Zaehler der Knoepfe „Route anzeigen“ und „Zentrieren“: jede Erhoehung loest einmal aus.
    var uebersichtSignal: Int
    /// Am Abholort: ganze Route der Dispo zeigen, Anfahrt ausblenden.
    var vorschauGanz = false
    var zentrierenSignal: Int
    /// Die Karte meldet ihren Modus (true = Folgen, false = Frei).
    var modus: (Bool) -> Void

    fileprivate static let folgeZoom = 16.5
    fileprivate static let folgeNeigung = 45.0
    /// Rand der Uebersicht: oben das Banner, unten der Fuss, rechts die Knoepfe.
    fileprivate static let uebersichtRand = UIEdgeInsets(top: 190, left: 50, bottom: 150, right: 70)

    func makeCoordinator() -> Koordinator { Koordinator() }

    func makeUIView(context: Context) -> MLNMapView {
        let karte = MLNMapView(frame: .zero, styleURL: KarteAnsicht.stil)
        karte.delegate = context.coordinator
        karte.backgroundColor = UIColor(red: 0x10 / 255, green: 0x11 / 255, blue: 0x12 / 255, alpha: 1)
        karte.setCenter(stand.ort ?? KarteAnsicht.mitte, zoomLevel: stand.ort == nil ? 12 : Self.folgeZoom, animated: false)
        karte.logoView.isHidden = true
        karte.compassView.isHidden = true
        karte.showsScale = false
        karte.automaticallyAdjustsContentInset = false
        // Verschieben, Zoomen (zwei Finger, Doppeltipp) und Drehen sind an. Neigen bleibt aus:
        // die Neigung gehoert zum Modus (Folgen 45 Grad, Uebersicht flach).
        karte.isScrollEnabled = true
        karte.isZoomEnabled = true
        karte.isRotateEnabled = true
        karte.isPitchEnabled = false
        // Unten rechts sitzen die Knoepfe, darum der Kartenhinweis links.
        karte.attributionButtonPosition = .bottomLeft
        karte.attributionButtonMargins = CGPoint(x: 8, y: fussHoehe + 8)
        karte.attributionButton.tintColor = UIColor(white: 0.6, alpha: 0.8)
        context.coordinator.karte = karte
        context.coordinator.anteil = fahrerAnteil
        context.coordinator.starten()
        return karte
    }

    func updateUIView(_ karte: MLNMapView, context: Context) {
        context.coordinator.setzen(self)
    }

    static func dismantleUIView(_ karte: MLNMapView, coordinator: Koordinator) {
        coordinator.beenden()
    }

    // MARK: Rechnen

    fileprivate static func meter(_ a: CLLocationCoordinate2D, _ b: CLLocationCoordinate2D) -> Double {
        let dLat = (b.latitude - a.latitude) * 111_320
        let dLng = (b.longitude - a.longitude) * 111_320 * cos((a.latitude + b.latitude) / 2 * .pi / 180)
        return hypot(dLat, dLng)
    }

    /// Kuerzester Weg von einem Kurs zum anderen in Grad (-180 bis 180).
    fileprivate static func drehung(_ von: Double, _ nach: Double) -> Double {
        var d = (nach - von).truncatingRemainder(dividingBy: 360)
        if d > 180 { d -= 360 } else if d < -180 { d += 360 }
        return d
    }

    /// Kurs zwischen zwei Kursen (t von 0 bis 1), ueber den kuerzeren Weg, 0 bis 360.
    fileprivate static func kurs(_ von: Double, _ nach: Double, _ t: Double) -> Double {
        var w = (von + drehung(von, nach) * t).truncatingRemainder(dividingBy: 360)
        if w < 0 { w += 360 }
        return w
    }

    fileprivate static func ort(_ von: CLLocationCoordinate2D, _ nach: CLLocationCoordinate2D, _ t: Double) -> CLLocationCoordinate2D {
        CLLocationCoordinate2D(latitude: von.latitude + (nach.latitude - von.latitude) * t,
                               longitude: von.longitude + (nach.longitude - von.longitude) * t)
    }

    final class Koordinator: NSObject, MLNMapViewDelegate {
        weak var karte: MLNMapView?
        var anteil: CGFloat = 0.66
        private var stand = NaviFuehrung.Karte()
        private var modus: ((Bool) -> Void)?
        private var stilGeladen = false
        private var linieGezeichnet = -1
        private var routeGezeichnet = -1
        private var ortGezeichnet = -1
        private var pin: MLNPointAnnotation?

        // Modus und Knoepfe.
        private var folgt = true
        /// Zoomstufe des Folgens: eine Zoom-Geste stellt sie um, „Zentrieren“ setzt sie zurueck.
        private var folgeZoom = NaviKarte.folgeZoom
        private var uebersichtSignal = 0
        private var zentrierenSignal = 0
        private var vorschauGanz = false
        private var vorschauGezeichnet = -1
        private var vorschauPin: MLNPointAnnotation?

        // Fahrer: der gezeigte Ort gleitet gleichmaessig von Standort zu Standort.
        private var marke: NaviFahrerMarke?
        private weak var markenAnsicht: NaviFahrerMarkenAnsicht?
        private var zeigOrt: CLLocationCoordinate2D?
        private var zeigKurs: Double = 0
        private var vonOrt = CLLocationCoordinate2D()
        private var vonKurs: Double = 0
        private var gleitAb: CFTimeInterval = 0
        private var gleitDauer: CFTimeInterval = 1
        private var gleitet = false
        private var letzterStandort: CFTimeInterval = 0

        // Kamera.
        private struct Uebergang {
            let ab: CFTimeInterval
            let dauer: CFTimeInterval
            let ort: CLLocationCoordinate2D
            let zoom: Double
            let kurs: Double
            let neigung: Double
        }
        /// Weiche Fahrt von der Stelle, an der die Karte gerade steht, zurueck zum Folgen.
        private var uebergang: Uebergang?
        /// Die Kamera ist noch einmal zu setzen (erster Standort, Karte noch ohne Groesse).
        private var kameraOffen = false
        private var taktgeber: CADisplayLink?
        private var taktZiel: NaviTakt?

        // Gesten des Nutzers.
        private static let nutzerGesten: MLNCameraChangeReason = [
            .gesturePan, .gesturePinch, .gestureRotate, .gestureZoomIn, .gestureZoomOut, .gestureOneFingerZoom, .gestureTilt,
        ]
        /// Eine Geste (oder ihr Ausgleiten) laeuft: solange setzt das Folgen die Kamera nicht.
        private var gesteAktiv = false
        private var gesteRichtung: CLLocationDirection = 0
        private var gesteZuletzt: CFTimeInterval = 0

        // MARK: Leben

        /// Taktgeber im Bildtakt: bewegt den Fahrerpfeil und im Folgen die Kamera.
        func starten() {
            guard taktgeber == nil else { return }
            let ziel = NaviTakt()
            ziel.koordinator = self
            let neu = CADisplayLink(target: ziel, selector: #selector(NaviTakt.takt))
            neu.add(to: .main, forMode: .common)
            taktZiel = ziel
            taktgeber = neu
        }

        func beenden() {
            taktgeber?.invalidate()
            taktgeber = nil
            taktZiel = nil
        }

        deinit { taktgeber?.invalidate() }

        func setzen(_ neu: NaviKarte) {
            stand = neu.stand
            modus = neu.modus
            abgleichen()
            if neu.zentrierenSignal != zentrierenSignal {
                zentrierenSignal = neu.zentrierenSignal
                zentrieren()
            }
            if neu.uebersichtSignal != uebersichtSignal {
                uebersichtSignal = neu.uebersichtSignal
                uebersicht()
            }
            // Am Abholort angekommen: einmal auf die ganze Route der Dispo einpassen, danach frei.
            if neu.vorschauGanz != vorschauGanz {
                vorschauGanz = neu.vorschauGanz
                linieZeichnen()
                if vorschauGanz { uebersicht() }
            }
        }

        func mapView(_ mapView: MLNMapView, didFinishLoading style: MLNStyle) {
            stilGeladen = true
            abgleichen()
        }

        private func abgleichen() {
            if stilGeladen, stand.linieStand != linieGezeichnet {
                linieGezeichnet = stand.linieStand
                linieZeichnen()
            }
            if stilGeladen, stand.routeStand != routeGezeichnet {
                routeGezeichnet = stand.routeStand
                endeSetzen()
                vorschauZeichnen()
                linieZeichnen()
            }
            if stand.ortStand != ortGezeichnet {
                ortGezeichnet = stand.ortStand
                ortUebernehmen()
            }
        }

        /// Route Lime, Breite 11, runde Enden. Unter den Strassennamen, damit die lesbar bleiben.
        private func linieZeichnen() {
            guard let stil = karte?.style else { return }
            // Eine Linie ohne Punkte loest in MapLibre eine Ausnahme aus, darum erst ab zwei Punkten.
            var form: MLNPolylineFeature?
            if stand.linie.count >= 2 {
                var koords = stand.linie
                form = MLNPolylineFeature(coordinates: &koords, count: UInt(koords.count))
            }
            if let quelle = stil.source(withIdentifier: "navi-route") as? MLNShapeSource {
                quelle.shape = form
            } else {
                let quelle = MLNShapeSource(identifier: "navi-route", shape: form, options: nil)
                stil.addSource(quelle)
                let ebene = MLNLineStyleLayer(identifier: "navi-route", source: quelle)
                ebene.lineWidth = NSExpression(forConstantValue: 11)
                ebene.lineCap = NSExpression(forConstantValue: "round")
                ebene.lineJoin = NSExpression(forConstantValue: "round")
                if let schrift = stil.layers.first(where: { $0 is MLNSymbolStyleLayer }) {
                    stil.insertLayer(ebene, below: schrift)
                } else {
                    stil.addLayer(ebene)
                }
            }
            if let ebene = stil.layer(withIdentifier: "navi-route") as? MLNLineStyleLayer {
                // Mit Route der Dispo als Vorschau ist die Anfahrt blau, sonst Lime wie immer.
                ebene.lineColor = NSExpression(forConstantValue: UIColor(hex: stand.vorschau != nil ? 0x0059FF : 0xE2F754))
                ebene.lineOpacity = NSExpression(forConstantValue: vorschauGanz ? 0 : (stand.blass ? 0.35 : 1))
            }
        }

        /// Route der Dispo vom Abholort bis zum Ziel (nur bei der Anfahrt): Lime, schmaler, unter der Anfahrt.
        private func vorschauZeichnen() {
            guard let stil = karte?.style else { return }
            var form: MLNPolylineFeature?
            if let v = stand.vorschau, v.punkte.count >= 2 {
                var koords = v.punkte
                form = MLNPolylineFeature(coordinates: &koords, count: UInt(koords.count))
            }
            if let quelle = stil.source(withIdentifier: "navi-vorschau") as? MLNShapeSource {
                quelle.shape = form
            } else if form != nil {
                let quelle = MLNShapeSource(identifier: "navi-vorschau", shape: form, options: nil)
                stil.addSource(quelle)
                let ebene = MLNLineStyleLayer(identifier: "navi-vorschau", source: quelle)
                ebene.lineColor = NSExpression(forConstantValue: UIColor(hex: 0xE2F754))
                ebene.lineWidth = NSExpression(forConstantValue: 8)
                ebene.lineCap = NSExpression(forConstantValue: "round")
                ebene.lineJoin = NSExpression(forConstantValue: "round")
                if let route = stil.layer(withIdentifier: "navi-route") {
                    stil.insertLayer(ebene, below: route)
                } else if let schrift = stil.layers.first(where: { $0 is MLNSymbolStyleLayer }) {
                    stil.insertLayer(ebene, below: schrift)
                } else {
                    stil.addLayer(ebene)
                }
            }
            // Ziel der Fahrt als Pin am Ende der Vorschau.
            let alt = vorschauPin
            var neu: MLNPointAnnotation?
            if let ende = stand.vorschau?.punkte.last {
                let p = MLNPointAnnotation()
                p.coordinate = ende
                p.title = "ziel"
                neu = p
            }
            vorschauPin = neu
            DispatchQueue.main.async { [weak karte] in
                if let alt { karte?.removeAnnotation(alt) }
                if let neu { karte?.addAnnotation(neu) }
            }
        }

        /// Pin am Ende der Route. Nie mitten in einem Rueckruf der Karte tauschen (siehe KarteAnsicht).
        private func endeSetzen() {
            let alt = pin
            var neu: MLNPointAnnotation?
            if let ende = stand.ende {
                let p = MLNPointAnnotation()
                p.coordinate = ende
                p.title = stand.endeAbholort ? "abholort" : "ziel"
                neu = p
            }
            pin = neu
            DispatchQueue.main.async { [weak karte] in
                if let alt { karte?.removeAnnotation(alt) }
                if let neu { karte?.addAnnotation(neu) }
            }
        }

        // MARK: Fahrer

        /// Neuer Standort: von der gerade gezeigten Stelle gleichmaessig dorthin gleiten (Standorte
        /// kommen etwa jede Sekunde). Der erste Standort und grosse Spruenge gelten sofort.
        private func ortUebernehmen() {
            guard let ort = stand.ort else { return }
            let jetzt = CACurrentMediaTime()
            if let alt = zeigOrt, NaviKarte.meter(alt, ort) < 400 {
                vonOrt = alt
                vonKurs = zeigKurs
                gleitDauer = min(1.1, max(0.25, jetzt - letzterStandort))
                gleitAb = jetzt
                gleitet = true
            } else {
                zeigOrt = ort
                zeigKurs = stand.kurs
                gleitet = false
                kameraOffen = true
                markeSetzen()
            }
            letzterStandort = jetzt
        }

        /// Der Pfeil haengt als Marker an seinem Ort auf der Karte.
        private func markeSetzen() {
            guard let ort = zeigOrt else { return }
            if let marke {
                marke.coordinate = ort
            } else {
                let neu = NaviFahrerMarke()
                neu.coordinate = ort
                marke = neu
                // Nie mitten in einem Rueckruf der Karte einsetzen (siehe endeSetzen).
                DispatchQueue.main.async { [weak karte] in karte?.addAnnotation(neu) }
            }
            markeDrehen()
        }

        /// Fahrtrichtung relativ zur Karte: bei Kurs oben zeigt der Pfeil nach oben, in der frei
        /// gedrehten Karte entsprechend. Die Neigung staucht die Karte nach hinten, das geht mit ein.
        private func markeDrehen() {
            guard let karte, let ansicht = markenAnsicht else { return }
            let winkel = (zeigKurs - karte.direction) * .pi / 180
            let neigung = Double(karte.camera.pitch) * .pi / 180
            ansicht.drehen(CGFloat(atan2(sin(winkel), cos(winkel) * cos(neigung))))
        }

        // MARK: Takt

        fileprivate func takt() {
            guard let karte, karte.bounds.width > 10, karte.bounds.height > 10 else { return }
            let jetzt = CACurrentMediaTime()
            var bewegt = false
            if gleitet, let ziel = stand.ort {
                let t = gleitDauer > 0 ? min(1, (jetzt - gleitAb) / gleitDauer) : 1
                zeigOrt = NaviKarte.ort(vonOrt, ziel, t)
                zeigKurs = NaviKarte.kurs(vonKurs, stand.kurs, t)
                if t >= 1 { gleitet = false }
                bewegt = true
                markeSetzen()
            }
            // Meldet die Karte das Ende einer Geste nicht, gilt sie nach kurzer Ruhe als beendet.
            if gesteAktiv, jetzt - gesteZuletzt > 0.5, !fingerAufKarte { gesteEnde() }
            guard folgt, !gesteAktiv, zeigOrt != nil else { return }
            if bewegt || kameraOffen || uebergang != nil { kameraFolgen(jetzt) }
        }

        /// Folgen: Kurs oben, Neigung 45 Grad, der Fahrer im unteren Drittel. Gesetzt wird im Bildtakt
        /// ohne eigene Kamerafahrt, damit Pfeil und Karte genau zusammen laufen.
        private func kameraFolgen(_ jetzt: CFTimeInterval) {
            guard let karte, let ziel = zeigOrt else { return }
            kameraOffen = false
            var mitte = ziel
            var zoom = folgeZoom
            var kurs = zeigKurs
            var neigung = NaviKarte.folgeNeigung
            if let u = uebergang {
                let roh = u.dauer > 0 ? min(1, max(0, (jetzt - u.ab) / u.dauer)) : 1
                let t = roh * roh * (3 - 2 * roh)
                mitte = NaviKarte.ort(u.ort, ziel, t)
                zoom = u.zoom + (folgeZoom - u.zoom) * t
                kurs = NaviKarte.kurs(u.kurs, zeigKurs, t)
                neigung = u.neigung + (NaviKarte.folgeNeigung - u.neigung) * t
                if roh >= 1 { uebergang = nil }
            }
            let hoehe = karte.bounds.height
            let y = hoehe * anteil
            // Die Mitte der Kamera liegt in der Mitte des freien Felds, also genau bei y.
            let rand = UIEdgeInsets(top: max(0, y - 60), left: 0, bottom: max(0, hoehe - y - 60), right: 0)
            let kamera = MLNMapCamera(lookingAtCenter: mitte,
                                      altitude: MLNAltitudeForZoomLevel(zoom, CGFloat(neigung), mitte.latitude, karte.bounds.size),
                                      pitch: CGFloat(neigung), heading: kurs)
            karte.setCamera(kamera, withDuration: 0, animationTimingFunction: nil, edgePadding: rand, completionHandler: nil)
            markeDrehen()
        }

        /// Von dort, wo die Karte gerade steht, weich zurueck zum Fahrer.
        private func uebergangStarten(dauer: CFTimeInterval) {
            uebergang = nil
            kameraOffen = true
            guard let karte, karte.bounds.width > 10, karte.bounds.height > 10 else { return }
            let anker = CGPoint(x: karte.bounds.width / 2, y: karte.bounds.height * anteil)
            let ort = karte.convert(anker, toCoordinateFrom: karte)
            guard CLLocationCoordinate2DIsValid(ort) else { return }
            uebergang = Uebergang(ab: CACurrentMediaTime(), dauer: dauer, ort: ort, zoom: karte.zoomLevel,
                                  kurs: karte.direction, neigung: Double(karte.camera.pitch))
        }

        // MARK: Modus

        private func modusSetzen(_ neu: Bool) {
            guard folgt != neu else { return }
            folgt = neu
            modus?(neu)
        }

        /// „Zentrieren“: zurueck zum Folgen (Kurs oben, Neigung, Zoom 16,5).
        private func zentrieren() {
            folgeZoom = NaviKarte.folgeZoom
            gesteAktiv = false
            modusSetzen(true)
            uebergangStarten(dauer: 0.7)
        }

        /// „Route anzeigen“: die ganze restliche Route vom Fahrer bis zum Ende, Norden oben, ohne Neigung.
        /// Wechselt in „Frei“. Die Kamera wird selbst gerechnet (Mercator, 512 Punkte je Kachel), damit
        /// Richtung und Neigung sicher auf 0 stehen.
        private func uebersicht() {
            guard let karte, karte.bounds.width > 10, karte.bounds.height > 10 else { return }
            var punkte = vorschauGanz ? [] : stand.linie
            punkte += stand.vorschau?.punkte ?? []
            if let ort = zeigOrt ?? stand.ort { punkte.append(ort) }
            guard punkte.count >= 2 else { return }
            uebergang = nil
            modusSetzen(false)
            func x(_ lng: Double) -> Double { (lng + 180) / 360 }
            func y(_ lat: Double) -> Double {
                let s = sin(min(85, max(-85, lat)) * .pi / 180)
                return 0.5 - log((1 + s) / (1 - s)) / (4 * .pi)
            }
            let xs = punkte.map { x($0.longitude) }, ys = punkte.map { y($0.latitude) }
            guard let x0 = xs.min(), let x1 = xs.max(), let y0 = ys.min(), let y1 = ys.max() else { return }
            let rand = NaviKarte.uebersichtRand
            let breite = Double(max(60, karte.bounds.width - rand.left - rand.right))
            let hoehe = Double(max(60, karte.bounds.height - rand.top - rand.bottom))
            // Nie naeher als Zoom 16 (kurzer Rest kurz vor dem Ziel).
            var zoom = 16.0
            if x1 > x0 { zoom = min(zoom, log2(breite / (512 * (x1 - x0)))) }
            if y1 > y0 { zoom = min(zoom, log2(hoehe / (512 * (y1 - y0)))) }
            zoom = max(2, zoom)
            // Die Route sitzt in der Mitte des freien Felds, die Bildmitte liegt um den halben
            // Unterschied der Raender daneben.
            let welt = 512 * pow(2, zoom)
            let mx = (x0 + x1) / 2 + Double(rand.right - rand.left) / 2 / welt
            let my = (y0 + y1) / 2 + Double(rand.bottom - rand.top) / 2 / welt
            let mitte = CLLocationCoordinate2D(latitude: atan(sinh(.pi * (1 - 2 * my))) * 180 / .pi,
                                               longitude: mx * 360 - 180)
            guard CLLocationCoordinate2DIsValid(mitte) else { return }
            let kamera = MLNMapCamera(lookingAtCenter: mitte,
                                      altitude: MLNAltitudeForZoomLevel(zoom, 0, mitte.latitude, karte.bounds.size),
                                      pitch: 0, heading: 0)
            karte.setCamera(kamera, withDuration: 0.7, animationTimingFunction: CAMediaTimingFunction(name: .easeInEaseOut),
                            edgePadding: .zero, completionHandler: nil)
        }

        // MARK: Gesten

        /// Liegt gerade ein Finger mit einer erkannten Geste auf der Karte.
        private var fingerAufKarte: Bool {
            (karte?.gestureRecognizers ?? []).contains { $0.state == .began || $0.state == .changed }
        }

        private func gesteLaeuft<G: UIGestureRecognizer>(_ art: G.Type, _ passt: (G) -> Bool = { _ in true }) -> Bool {
            (karte?.gestureRecognizers ?? []).contains { g in
                guard let g = g as? G, g.state == .began || g.state == .changed else { return false }
                return passt(g)
            }
        }

        /// Kamerabewegung mit Grund. Eigene Kamerabewegungen (Folgen, Uebersicht, Zentrieren) kommen als
        /// „programmatic“ ohne Gesten-Grund und ohne Finger auf der Karte, sie aendern den Modus nie.
        /// Verschieben = Schiebe-Geste laeuft. Drehen = Dreh-Geste laeuft UND die Karte hat sich wirklich
        /// gedreht (MapLibre meldet „rotate“ bei fast jedem Zwei-Finger-Zoom mit, auch ohne Drehung).
        private func geste(_ grund: MLNCameraChangeReason, beginn: Bool) {
            guard let karte, !grund.intersection(Self.nutzerGesten).isEmpty else { return }
            // Doppeltipp und Zwei-Finger-Tipp zoomen als kurze Fahrt, ohne dass ein Finger aufliegt.
            let tippZoom = beginn && !grund.contains(.programmatic)
                && !grund.intersection([.gestureZoomIn, .gestureZoomOut]).isEmpty
            guard gesteAktiv || tippZoom || fingerAufKarte else { return }
            gesteZuletzt = CACurrentMediaTime()
            if !gesteAktiv {
                gesteAktiv = true
                gesteRichtung = karte.direction
                uebergang = nil
            }
            guard folgt else { return }
            if grund.contains(.gesturePan), gesteLaeuft(UIPanGestureRecognizer.self, { $0.minimumNumberOfTouches < 2 }) {
                modusSetzen(false)
            } else if gesteLaeuft(UIRotationGestureRecognizer.self),
                      abs(NaviKarte.drehung(gesteRichtung, karte.direction)) > 2 {
                modusSetzen(false)
            }
        }

        /// Geste vorbei. Im Folgen gilt die neue Zoomstufe, die Karte faehrt zurueck zum Fahrer.
        private func gesteEnde() {
            gesteAktiv = false
            guard folgt, let karte else { return }
            folgeZoom = min(19.5, max(8, karte.zoomLevel))
            uebergangStarten(dauer: 0.3)
        }

        func mapView(_ mapView: MLNMapView, regionWillChangeWith reason: MLNCameraChangeReason, animated: Bool) {
            geste(reason, beginn: true)
        }

        func mapView(_ mapView: MLNMapView, regionIsChangingWith reason: MLNCameraChangeReason) {
            geste(reason, beginn: false)
            markeDrehen()
        }

        func mapView(_ mapView: MLNMapView, regionDidChangeWith reason: MLNCameraChangeReason, animated: Bool) {
            markeDrehen()
            if gesteAktiv, !fingerAufKarte { gesteEnde() }
        }

        // MARK: Marker

        func mapView(_ mapView: MLNMapView, viewFor annotation: MLNAnnotation) -> MLNAnnotationView? {
            if annotation is NaviFahrerMarke {
                let ansicht = NaviFahrerMarkenAnsicht()
                markenAnsicht = ansicht
                markeDrehen()
                return ansicht
            }
            guard let art = annotation.title ?? nil else { return nil }
            return NaviPin(bild: art == "abholort" ? "Abholort_Pin_Trisar_01_rot" : "Ziel_Pin_Trisar_01")
        }

        func mapView(_ mapView: MLNMapView, annotationCanShowCallout annotation: MLNAnnotation) -> Bool { false }
    }
}

/// Ziel des Taktgebers. Haelt den Koordinator nur schwach, damit der mit der Karte verschwinden kann.
private final class NaviTakt: NSObject {
    weak var koordinator: NaviKarte.Koordinator?
    @objc func takt() { koordinator?.takt() }
}

/// Pin am Ende der Route, Spitze auf dem Ort (wie die Pins der Fahrtkarte).
private final class NaviPin: MLNAnnotationView {
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

/// Der Fahrer als Marker der Karte (echter Ort, siehe Koordinator.markeSetzen).
private final class NaviFahrerMarke: MLNPointAnnotation {}

/// Fahrer: blauer Pfeil (#2F6BFF, weisser Rand) auf blassem blauen Kreis, 68 gross. Der Pfeil wird in
/// Fahrtrichtung relativ zur Karte gedreht, der Kreis bleibt.
private final class NaviFahrerMarkenAnsicht: MLNAnnotationView {
    private let pfeil = UIView()

    init() {
        super.init(reuseIdentifier: nil)
        let seite: CGFloat = 68
        frame = CGRect(x: 0, y: 0, width: seite, height: seite)
        let blau = UIColor(hex: 0x2F6BFF)
        let kreis = CAShapeLayer()
        kreis.path = UIBezierPath(ovalIn: bounds).cgPath
        kreis.fillColor = blau.withAlphaComponent(0.18).cgColor
        layer.addSublayer(kreis)
        let umriss = UIBezierPath()
        umriss.move(to: CGPoint(x: 34, y: 6))
        umriss.addLine(to: CGPoint(x: 54, y: 56))
        umriss.addLine(to: CGPoint(x: 34, y: 44))
        umriss.addLine(to: CGPoint(x: 14, y: 56))
        umriss.close()
        let form = CAShapeLayer()
        form.path = umriss.cgPath
        form.fillColor = blau.cgColor
        form.strokeColor = UIColor.white.cgColor
        form.lineWidth = 3
        form.lineJoin = .round
        pfeil.frame = bounds
        pfeil.layer.addSublayer(form)
        addSubview(pfeil)
        // Ueber den Pins, immer gleich gross (auch in der geneigten Karte), nicht antippbar.
        layer.zPosition = 500
        scalesWithViewingDistance = false
        isEnabled = false
        isUserInteractionEnabled = false
    }
    required init?(coder: NSCoder) { fatalError() }

    /// Winkel im Bogenmass, 0 = nach oben, im Uhrzeigersinn.
    func drehen(_ bogen: CGFloat) {
        pfeil.transform = CGAffineTransform(rotationAngle: bogen)
    }
}

// MARK: - Formen

/// „Route anzeigen“ im 26er Feld: geschwungene Linie mit Punkt an beiden Enden.
private struct NaviUebersichtBild: View {
    var farbe: Color

    var body: some View {
        ZStack {
            Linie().stroke(farbe, style: StrokeStyle(lineWidth: 2.2, lineCap: .round))
            Punkte().fill(farbe)
        }
    }

    private struct Linie: Shape {
        func path(in rect: CGRect) -> Path {
            var p = Path()
            p.move(to: CGPoint(x: 7, y: 20))
            p.addCurve(to: CGPoint(x: 19, y: 7), control1: CGPoint(x: 7, y: 13), control2: CGPoint(x: 19, y: 14))
            return p.applying(CGAffineTransform(scaleX: rect.width / 26, y: rect.height / 26))
                .offsetBy(dx: rect.minX, dy: rect.minY)
        }
    }

    private struct Punkte: Shape {
        func path(in rect: CGRect) -> Path {
            var p = Path()
            p.addEllipse(in: CGRect(x: 4.6, y: 18.6, width: 4.8, height: 4.8))
            p.addEllipse(in: CGRect(x: 16.6, y: 2.6, width: 4.8, height: 4.8))
            return p.applying(CGAffineTransform(scaleX: rect.width / 26, y: rect.height / 26))
                .offsetBy(dx: rect.minX, dy: rect.minY)
        }
    }
}

/// „Zentrieren“ im 24er Feld: Standortpfeil.
private struct NaviStandortPfeil: Shape {
    func path(in rect: CGRect) -> Path {
        var p = Path()
        p.move(to: CGPoint(x: 12, y: 2))
        p.addLine(to: CGPoint(x: 20, y: 21))
        p.addLine(to: CGPoint(x: 12, y: 16.5))
        p.addLine(to: CGPoint(x: 4, y: 21))
        p.closeSubpath()
        return p.applying(CGAffineTransform(scaleX: rect.width / 24, y: rect.height / 24))
            .offsetBy(dx: rect.minX, dy: rect.minY)
    }
}

/// Pfeil eines Hinweises im 38er Feld, Strich 4,5 mit eckigen Enden. Ziel = Punkt mit Ring.
struct NaviPfeilBild: View {
    let art: String
    var farbe: Color
    var groesse: CGFloat = 38

    var body: some View {
        let f = groesse / 38
        if art == "ziel" {
            ZStack {
                Circle().strokeBorder(farbe, lineWidth: 4.5 * f).frame(width: 28 * f, height: 28 * f)
                Circle().fill(farbe).frame(width: 10 * f, height: 10 * f)
            }
            .frame(width: groesse, height: groesse)
        } else {
            NaviPfeilForm(art: art)
                .stroke(farbe, style: StrokeStyle(lineWidth: 4.5 * f, lineCap: .square, lineJoin: .miter))
                .frame(width: groesse, height: groesse)
        }
    }
}

/// Die Formen fuer `pfeil` aus navi_route. Gezeichnet wird die rechte Fassung, links ist gespiegelt.
/// Unbekanntes zeichnet den Pfeil geradeaus.
struct NaviPfeilForm: Shape {
    let art: String

    func path(in rect: CGRect) -> Path {
        var p = Path()
        func zu(_ x: CGFloat, _ y: CGFloat) -> CGPoint { CGPoint(x: x, y: y) }
        switch art {
        case "rechts", "links":
            p.move(to: zu(10, 34)); p.addLine(to: zu(10, 18))
            p.addQuadCurve(to: zu(16, 12), control: zu(10, 12)); p.addLine(to: zu(30, 12))
            p.move(to: zu(22, 4)); p.addLine(to: zu(31, 12)); p.addLine(to: zu(22, 20))
        case "leicht_rechts", "leicht_links":
            p.move(to: zu(13, 34)); p.addLine(to: zu(13, 22)); p.addLine(to: zu(27, 8))
            p.move(to: zu(15, 8)); p.addLine(to: zu(27, 8)); p.addLine(to: zu(27, 20))
        case "scharf_rechts", "scharf_links":
            p.move(to: zu(11, 34)); p.addLine(to: zu(11, 9)); p.addLine(to: zu(27, 25))
            p.move(to: zu(27, 13)); p.addLine(to: zu(27, 25)); p.addLine(to: zu(15, 25))
        case "wenden":
            p.move(to: zu(26, 34)); p.addLine(to: zu(26, 16))
            p.addQuadCurve(to: zu(18, 8), control: zu(26, 8))
            p.addQuadCurve(to: zu(10, 16), control: zu(10, 8))
            p.addLine(to: zu(10, 26))
            p.move(to: zu(3, 19)); p.addLine(to: zu(10, 27)); p.addLine(to: zu(17, 19))
        case "kreisel":
            p.addEllipse(in: CGRect(x: 12, y: 13, width: 14, height: 14))
            p.move(to: zu(19, 35)); p.addLine(to: zu(19, 27))
            p.move(to: zu(19, 13)); p.addLine(to: zu(19, 5))
            p.move(to: zu(13, 10)); p.addLine(to: zu(19, 4)); p.addLine(to: zu(25, 10))
        default:
            p.move(to: zu(19, 34)); p.addLine(to: zu(19, 7))
            p.move(to: zu(9, 16)); p.addLine(to: zu(19, 6)); p.addLine(to: zu(29, 16))
        }
        var t = CGAffineTransform(scaleX: rect.width / 38, y: rect.height / 38)
        if art.hasSuffix("links") {
            t = CGAffineTransform(translationX: 38, y: 0).scaledBy(x: -1, y: 1).concatenating(t)
        }
        return p.applying(t).offsetBy(dx: rect.minX, dy: rect.minY)
    }
}

/// Rand der Lasche "dann": links, unten, rechts (oben schliesst das Banner an).
private struct NaviLaschenRand: Shape {
    func path(in rect: CGRect) -> Path {
        var p = Path()
        p.move(to: CGPoint(x: rect.minX, y: rect.minY))
        p.addLine(to: CGPoint(x: rect.minX, y: rect.maxY))
        p.addLine(to: CGPoint(x: rect.maxX, y: rect.maxY))
        p.addLine(to: CGPoint(x: rect.maxX, y: rect.minY))
        return p
    }
}

/// Lautsprecher im 26er Feld, bei stumm durchgestrichen statt mit Schallwellen.
private struct NaviTonBild: Shape {
    let stumm: Bool

    func path(in rect: CGRect) -> Path {
        var p = Path()
        p.move(to: CGPoint(x: 4, y: 10))
        p.addLine(to: CGPoint(x: 8, y: 10)); p.addLine(to: CGPoint(x: 14, y: 5)); p.addLine(to: CGPoint(x: 14, y: 21))
        p.addLine(to: CGPoint(x: 8, y: 16)); p.addLine(to: CGPoint(x: 4, y: 16))
        p.closeSubpath()
        if stumm {
            p.move(to: CGPoint(x: 3, y: 3)); p.addLine(to: CGPoint(x: 23, y: 23))
        } else {
            p.move(to: CGPoint(x: 18, y: 9)); p.addQuadCurve(to: CGPoint(x: 18, y: 17), control: CGPoint(x: 22, y: 13))
            p.move(to: CGPoint(x: 20.5, y: 6)); p.addQuadCurve(to: CGPoint(x: 20.5, y: 20), control: CGPoint(x: 27.5, y: 13))
        }
        return p.applying(CGAffineTransform(scaleX: rect.width / 26, y: rect.height / 26))
            .offsetBy(dx: rect.minX, dy: rect.minY)
    }
}

/// X des Beenden-Knopfs im 22er Feld.
private struct NaviKreuz: Shape {
    func path(in rect: CGRect) -> Path {
        var p = Path()
        p.move(to: CGPoint(x: 4, y: 4)); p.addLine(to: CGPoint(x: 18, y: 18))
        p.move(to: CGPoint(x: 18, y: 4)); p.addLine(to: CGPoint(x: 4, y: 18))
        return p.applying(CGAffineTransform(scaleX: rect.width / 22, y: rect.height / 22))
            .offsetBy(dx: rect.minX, dy: rect.minY)
    }
}
