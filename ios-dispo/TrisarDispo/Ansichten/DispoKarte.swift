import MapLibre
import SwiftUI
import UIKit

/// Kartenflaeche der Dispo (GoogleMapSurface in KartenView.jsx) mit MapLibre und CARTO Dark
/// Matter wie im Web: Fahrer-Pins mit Nummer in der Zustandsfarbe (Zuendung aus = blasses Weiss),
/// Gruppen ab fuenf sich beruehrenden Pins, Fokus auf den gewaehlten Fahrer (die anderen blass),
/// Route mit schon gefahrenem Teil, Dauer-Schildern, Abholort und Ziel.
struct DispoKarte: UIViewRepresentable {
    var fahrer: [KartenFahrer]
    var gewaehlt: KartenFahrer?
    var route: KartenRoutenBild?
    /// Hoehe des Blatts im Web-Raster (0 ohne Auswahl), fuer die Polsterung beim Einpassen.
    var blattHoehe: CGFloat
    /// Sichtbare Hoehe im Web-Raster und Massstab Raster -> Punkt.
    var rasterHoehe: CGFloat
    var massstab: CGFloat
    /// Erhoeht sich beim Tipp auf "Karte" in der Leiste: alle Fahrer einpassen.
    var einpassenSignal: Int
    var waehlen: (String) -> Void
    var leerTippen: () -> Void
    /// Fahrer mehr als 200 m neben seiner Route: neu rechnen lassen.
    var abseits: (CLLocationCoordinate2D) -> Void

    static let stil = URL(string: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json")!
    private static let kameraSchluessel = "admin_karten_camera_v1"

    func makeCoordinator() -> Koordinator { Koordinator() }

    func makeUIView(context: Context) -> MLNMapView {
        let karte = MLNMapView(frame: .zero, styleURL: Self.stil)
        karte.delegate = context.coordinator
        karte.backgroundColor = UIColor(hex: 0x0E0E0E)
        // Letzter Ausschnitt (MAP_CAMERA_CACHE_KEY), sonst Muenchen bei Zoom 12.
        if let k = UserDefaults.standard.array(forKey: Self.kameraSchluessel) as? [Double], k.count == 3 {
            karte.setCenter(CLLocationCoordinate2D(latitude: k[0], longitude: k[1]), zoomLevel: k[2], animated: false)
        } else {
            karte.setCenter(CLLocationCoordinate2D(latitude: 48.137154, longitude: 11.576124), zoomLevel: 12, animated: false)
        }
        karte.logoView.isHidden = true
        karte.compassView.isHidden = true
        karte.showsScale = false
        karte.automaticallyAdjustsContentInset = false
        karte.attributionButtonPosition = .bottomRight
        karte.attributionButton.tintColor = UIColor(white: 0.6, alpha: 0.8)

        let tipp = UITapGestureRecognizer(target: context.coordinator, action: #selector(Koordinator.getippt(_:)))
        tipp.delegate = context.coordinator
        // Doppeltipp zoomt, ein einzelner Tipp waehlt.
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

    // MARK: - Koordinator

    final class Koordinator: NSObject, MLNMapViewDelegate, UIGestureRecognizerDelegate {
        weak var karte: MLNMapView?
        private var stand: DispoKarte?
        private var stilGeladen = false

        private var fahrerPunkte: [String: KartenFahrerPunkt] = [:]
        private var fahrerAnsichten: [String: KartenFahrerPin] = [:]
        private var imBild: Set<String> = []
        private var gruppen: [KartenGruppenPunkt] = []
        private var letzteListe: [KartenFahrer] = []
        private var letzteAuswahl: String?
        private var einpassenSignal = 0

        // Route: Teile (Anfahrt, Fahrt) je mit noch zu fahrender und schon gefahrener Linie.
        private struct Teil { let art: String; let pfad: [CLLocationCoordinate2D]; var schild: KartenRoutenPunkt? }
        private var teile: [Teil] = []
        private var fortschritt = (teil: 0, index: 0, gefunden: false)
        private var routenPunkte: [KartenRoutenPunkt] = []
        private var routenSchluessel = ""
        private var eingepasstFuer = ""
        private var letzteBlattHoehe: CGFloat = -1

        func setzen(_ neu: DispoKarte) {
            stand = neu
            if neu.einpassenSignal != einpassenSignal {
                einpassenSignal = neu.einpassenSignal
                eingepasstFuer = ""
                alleEinpassen()
            }
            let auswahl = neu.gewaehlt?.id
            if neu.fahrer != letzteListe || auswahl != letzteAuswahl {
                letzteListe = neu.fahrer
                letzteAuswahl = auswahl
                fahrerAbgleichen()
            }
            routeAbgleichen()
            fortschrittAktualisieren()
            if abs(neu.blattHoehe - letzteBlattHoehe) > 0.5 {
                letzteBlattHoehe = neu.blattHoehe
                if !routenSchluessel.isEmpty { routeEinpassen() }
            }
        }

        func mapView(_ mapView: MLNMapView, didFinishLoading style: MLNStyle) {
            stilGeladen = true
            routenSchluessel = ""
            routeAbgleichen()
            fortschrittAktualisieren()
        }

        func mapView(_ mapView: MLNMapView, regionDidChangeAnimated animated: Bool) {
            gruppenBilden()
            let m = mapView.centerCoordinate
            UserDefaults.standard.set([m.latitude, m.longitude, mapView.zoomLevel], forKey: DispoKarte.kameraSchluessel)
        }

        // MARK: Fahrer

        private var kolonne: Set<String> { Set(stand?.gewaehlt?.fahrt?.kolonnenFahrerIDs ?? []) }

        private func darstellung(_ f: KartenFahrer) -> (abgeblendet: Bool, hoehe: CGFloat) {
            let gewaehlt = stand?.gewaehlt?.id
            let istGewaehlt = gewaehlt == f.id
            let inKolonne = kolonne.contains(f.id)
            // Fokus: ist ein Fahrer gewaehlt, treten alle anderen zurueck (ausser seiner Kolonne).
            let blass = gewaehlt != nil && !istGewaehlt && !inKolonne
            return (blass, istGewaehlt ? 2000 : (blass ? 200 : (inKolonne ? 1500 : 1000)))
        }

        private func fahrerAbgleichen() {
            guard let karte else { return }
            let liste = letzteListe
            let ids = Set(liste.map(\.id))
            // Weggefallene Fahrer (z. B. im Filter ausgeblendet) entfernen.
            for (id, p) in fahrerPunkte where !ids.contains(id) {
                if imBild.contains(id) { karte.removeAnnotation(p) }
                imBild.remove(id)
                fahrerPunkte[id] = nil
                fahrerAnsichten[id] = nil
            }
            for f in liste {
                let p = fahrerPunkte[f.id] ?? KartenFahrerPunkt(id: f.id)
                if p.coordinate.latitude != f.lat || p.coordinate.longitude != f.lng { p.coordinate = f.ort }
                p.fahrer = f
                fahrerPunkte[f.id] = p
                if let v = fahrerAnsichten[f.id] {
                    let d = darstellung(f)
                    v.anwenden(f, abgeblendet: d.abgeblendet, hoehe: d.hoehe)
                }
            }
            gruppenBilden()
        }

        /// updateDriverClusters: Gruppen erst ab fuenf Fahrern, deren Pins (35 pt) sich beruehren.
        /// Der gewaehlte Fahrer und seine Kolonne bleiben immer einzeln.
        private func gruppenBilden() {
            guard let karte else { return }
            // Vor dem ersten Layout kennt die Karte keine Bildschirmpunkte: kurz danach nochmal.
            guard karte.bounds.width > 10 else {
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) { [weak self] in self?.gruppenBilden() }
                return
            }
            let s = stand?.massstab ?? 1
            let einzeln = kolonne.union([stand?.gewaehlt?.id].compactMap { $0 })
            let fokus = stand?.gewaehlt != nil
            let kandidaten = letzteListe.filter { !einzeln.contains($0.id) }
                .map { ($0, karte.convert($0.ort, toPointTo: karte)) }
            let radius = (35 + 1) * s
            var vergeben = Set<Int>()
            var neueGruppen: [KartenGruppenPunkt] = []
            for i in kandidaten.indices where !vergeben.contains(i) {
                var mitglieder = [i]
                for j in (i + 1)..<kandidaten.count where !vergeben.contains(j) {
                    let a = kandidaten[i].1, b = kandidaten[j].1
                    if hypot(a.x - b.x, a.y - b.y) <= radius { mitglieder.append(j) }
                }
                guard mitglieder.count >= 5 else { continue }
                mitglieder.forEach { vergeben.insert($0) }
                let orte = mitglieder.map { kandidaten[$0].0.ort }
                let g = KartenGruppenPunkt()
                g.coordinate = CLLocationCoordinate2D(latitude: orte.map(\.latitude).reduce(0, +) / Double(orte.count),
                                                      longitude: orte.map(\.longitude).reduce(0, +) / Double(orte.count))
                g.orte = orte
                g.anzahl = orte.count
                g.abgeblendet = fokus
                neueGruppen.append(g)
            }
            let inGruppe = Set(vergeben.map { kandidaten[$0].0.id })
            let soll = Set(letzteListe.map(\.id)).subtracting(inGruppe)
            let weg = imBild.subtracting(soll).compactMap { fahrerPunkte[$0] }
            let dazu = soll.subtracting(imBild).compactMap { fahrerPunkte[$0] }
            if !weg.isEmpty { karte.removeAnnotations(weg) }
            weg.forEach { fahrerAnsichten[$0.id] = nil }
            if !dazu.isEmpty { karte.addAnnotations(dazu) }
            imBild = soll
            if !gruppen.isEmpty { karte.removeAnnotations(gruppen) }
            gruppen = neueGruppen
            if !gruppen.isEmpty { karte.addAnnotations(gruppen) }
        }

        // MARK: Tippen

        func gestureRecognizer(_ g: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool { true }

        @objc func getippt(_ g: UITapGestureRecognizer) {
            guard let karte, let stand else { return }
            let punkt = g.location(in: karte)
            func trifft(_ v: MLNAnnotationView?) -> Bool {
                guard let v, v.superview != nil, !v.isHidden else { return false }
                return v.bounds.contains(karte.convert(punkt, to: v))
            }
            // Oben liegende zuerst (gewaehlter Fahrer, dann nach Hoehe).
            let treffer = imBild.compactMap { id in fahrerAnsichten[id].map { (id, $0) } }
                .sorted { $0.1.layer.zPosition > $1.1.layer.zPosition }
                .first { trifft($0.1) }
            if let (id, _) = treffer { stand.waehlen(id); return }
            if let g = gruppen.first(where: { trifft(karte.view(for: $0)) }) { gruppeOeffnen(g); return }
            stand.leerTippen()
        }

        func mapView(_ mapView: MLNMapView, didSelect annotation: MLNAnnotation) {
            mapView.deselectAnnotation(annotation, animated: false)
        }

        func mapView(_ mapView: MLNMapView, annotationCanShowCallout annotation: MLNAnnotation) -> Bool { false }

        /// Gruppe antippen: auf ihre Fahrer einpassen. Liegen sie fast aufeinander, aendert das
        /// kaum etwas, dann nach der Fahrt noch zwei Stufen hinein.
        private func gruppeOeffnen(_ g: KartenGruppenPunkt) {
            guard let karte else { return }
            let vorher = karte.zoomLevel
            einpassen(g.orte, oben: 200, rechts: 24, unten: 190, links: 24)
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) { [weak karte] in
                guard let karte, karte.zoomLevel <= vorher + 0.5 else { return }
                karte.setZoomLevel(min(20, vorher + 2), animated: true)
            }
        }

        // MARK: Einpassen (fitBounds, Polsterung im Web-Raster)

        private func einpassen(_ orte: [CLLocationCoordinate2D], oben: CGFloat, rechts: CGFloat, unten: CGFloat, links: CGFloat) {
            guard let karte, let erster = orte.first else { return }
            guard karte.bounds.width > 10, karte.bounds.height > 10 else {
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) { [weak self] in
                    self?.einpassen(orte, oben: oben, rechts: rechts, unten: unten, links: links)
                }
                return
            }
            let s = stand?.massstab ?? 1
            var sw = erster, ne = erster
            for p in orte {
                sw.latitude = min(sw.latitude, p.latitude); sw.longitude = min(sw.longitude, p.longitude)
                ne.latitude = max(ne.latitude, p.latitude); ne.longitude = max(ne.longitude, p.longitude)
            }
            let rand = UIEdgeInsets(top: oben * s, left: links * s, bottom: unten * s, right: rechts * s)
            karte.setVisibleCoordinateBounds(MLNCoordinateBounds(sw: sw, ne: ne), edgePadding: rand, animated: true, completionHandler: nil)
        }

        /// fitAllDriverMarkers: oben bleiben Zurueck, Filter und Statusleiste frei.
        private func alleEinpassen() {
            einpassen(letzteListe.map(\.ort), oben: 200, rechts: 24, unten: 190, links: 24)
        }

        /// fitRouteBounds: unten Leiste + Blatt, oben so viel, wie die Hoehe hergibt.
        private func routeEinpassen() {
            guard let stand, let route = stand.route, route.schluessel == routenSchluessel else { return }
            let orte = route.allePunkte
            guard !orte.isEmpty else { alleEinpassen(); return }
            let unten = 190 + stand.blattHoehe + 10
            let oben = max(88, min(210, stand.rasterHoehe - unten - 140))
            einpassen(orte, oben: oben, rechts: 40, unten: unten, links: 40)
        }

        // MARK: Route

        private func routeAbgleichen() {
            guard let karte, stilGeladen else { return }
            let route = stand?.route
            let schluessel = route?.schluessel ?? ""
            guard schluessel != routenSchluessel else { return }
            routenSchluessel = schluessel
            if !routenPunkte.isEmpty { karte.removeAnnotations(routenPunkte) }
            routenPunkte = []
            teile = []
            fortschritt = (0, 0, false)
            guard let route, !schluessel.isEmpty else {
                linienSetzen()
                eingepasstFuer = ""
                return
            }
            func punkt(_ ort: CLLocationCoordinate2D?, _ art: String, _ text: String = "") -> KartenRoutenPunkt? {
                guard let ort else { return nil }
                let p = KartenRoutenPunkt(art: art, text: text)
                p.coordinate = ort
                routenPunkte.append(p)
                return p
            }
            if route.anfahrt.count >= 2 {
                let schild = (route.anfahrtMinuten ?? 0) > 0
                    ? punkt(route.anfahrt[route.anfahrt.count / 2], "blase-gelb", Self.dauer(route.anfahrtMinuten ?? 0)) : nil
                teile.append(Teil(art: "anfahrt", pfad: route.anfahrt, schild: schild))
            }
            if route.fahrt.count >= 2 {
                let schild = (route.fahrtMinuten ?? 0) > 0
                    ? punkt(route.fahrt[route.fahrt.count / 2], "blase-blau", Self.dauer(route.fahrtMinuten ?? 0)) : nil
                teile.append(Teil(art: "fahrt", pfad: route.fahrt, schild: schild))
            }
            _ = punkt(route.abholort, "abholort")
            _ = punkt(route.ziel, "ziel")
            linienSetzen()
            karte.addAnnotations(routenPunkte)
            if eingepasstFuer != schluessel {
                eingepasstFuer = schluessel
                routeEinpassen()
            }
        }

        /// Linien je Teil: Rest und schon gefahrener Teil (Startzustand: alles Rest).
        private func linienSetzen(rest: [String: [CLLocationCoordinate2D]] = [:], gefahren: [String: [CLLocationCoordinate2D]] = [:]) {
            guard let stil = karte?.style else { return }
            let pfade = Dictionary(uniqueKeysWithValues: teile.map { ($0.art, $0.pfad) })
            // Blau unter Gelb (zIndex 300 / 301 im Web).
            linie(stil, "dk-fahrt", rest["fahrt"] ?? pfade["fahrt"] ?? [], UIColor(hex: 0x0059FF), 6, gestrichelt: false, deckung: 1)
            linie(stil, "dk-fahrt-gefahren", gefahren["fahrt"] ?? [], UIColor(hex: 0x0059FF), 5, gestrichelt: true, deckung: 0.8)
            linie(stil, "dk-anfahrt", rest["anfahrt"] ?? pfade["anfahrt"] ?? [], UIColor(hex: 0xE3F654), 5, gestrichelt: true, deckung: 1)
            linie(stil, "dk-anfahrt-gefahren", gefahren["anfahrt"] ?? [], UIColor(hex: 0xE3F654), 5, gestrichelt: true, deckung: 0.25)
        }

        /// routenFortschrittAktualisieren: Fahrer auf seine Route legen (nur vorwaerts), alles
        /// davor wird zur blassen Linie, das Schild wandert mit der Mitte des Rests.
        private func fortschrittAktualisieren() {
            guard stilGeladen, !teile.isEmpty, let fahrer = stand?.gewaehlt else { return }
            let hier = fahrer.ort
            func meter(_ a: CLLocationCoordinate2D, _ b: CLLocationCoordinate2D) -> Double {
                let dx = (b.longitude - a.longitude) * cos(a.latitude * .pi / 180) * 111_320
                let dy = (b.latitude - a.latitude) * 110_540
                return hypot(dx, dy)
            }
            func naechster(_ t: Teil, ab: Int, ganz: Bool = false) -> (index: Int, abstand: Double) {
                var index = -1, abstand = Double.infinity
                let bis = ganz ? t.pfad.count : min(t.pfad.count, ab + 150)
                if ab < bis {
                    for i in ab..<bis {
                        let d = meter(hier, t.pfad[i])
                        if d < abstand { abstand = d; index = i }
                    }
                }
                return (index, abstand)
            }
            guard fortschritt.teil < teile.count else { return }
            var rest: [String: [CLLocationCoordinate2D]] = [:], gefahren: [String: [CLLocationCoordinate2D]] = [:]
            for (i, t) in teile.enumerated() where i < fortschritt.teil { gefahren[t.art] = t.pfad; rest[t.art] = [] }
            var t = teile[fortschritt.teil]
            var treffer = naechster(t, ab: fortschritt.index, ganz: !fortschritt.gefunden)
            if treffer.abstand <= 60 { fortschritt.gefunden = true }
            if fortschritt.teil + 1 < teile.count, fortschritt.index >= t.pfad.count - 3 {
                let folge = teile[fortschritt.teil + 1]
                let weiter = naechster(folge, ab: 0)
                if weiter.abstand < 40 {
                    gefahren[t.art] = t.pfad; rest[t.art] = []
                    if let s = t.schild, let karte { karte.removeAnnotation(s) }
                    fortschritt.teil += 1
                    fortschritt.index = 0
                    t = folge
                    treffer = weiter
                }
            }
            // Mehr als 200 m neben der Linie: Route passt nicht mehr.
            // Ueber die Hauptschleife melden, nicht mitten im Neuzeichnen der Ansicht.
            if treffer.index < 0 || treffer.abstand > 200 {
                let melden = stand?.abseits
                DispatchQueue.main.async { melden?(hier) }
            }
            guard treffer.index >= 0, treffer.abstand <= 60 else {
                linienSetzen(rest: rest, gefahren: gefahren)
                return
            }
            fortschritt.index = max(fortschritt.index, treffer.index)
            gefahren[t.art] = Array(t.pfad[0...fortschritt.index]) + [hier]
            let r = [hier] + Array(t.pfad[(fortschritt.index + 1)...])
            rest[t.art] = r
            t.schild?.coordinate = r[r.count / 2]
            linienSetzen(rest: rest, gefahren: gefahren)
        }

        private func linie(_ stil: MLNStyle, _ kennung: String, _ pfad: [CLLocationCoordinate2D], _ farbe: UIColor,
                           _ breite: CGFloat, gestrichelt: Bool, deckung: Double) {
            // Eine Linie ohne Punkte loest in MapLibre eine Ausnahme aus: erst ab zwei Punkten eine Form.
            var form: MLNPolylineFeature?
            if pfad.count >= 2 {
                var k = pfad
                form = MLNPolylineFeature(coordinates: &k, count: UInt(k.count))
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
            ebene.lineOpacity = NSExpression(forConstantValue: deckung)
            ebene.lineCap = NSExpression(forConstantValue: "round")
            ebene.lineJoin = NSExpression(forConstantValue: "round")
            if gestrichelt { ebene.lineDashPattern = NSExpression(forConstantValue: [0.8, 1.6]) }
            stil.addLayer(ebene)
        }

        /// formatDuration: "12 min" oder "1:05 h".
        static func dauer(_ m: Int) -> String {
            if m <= 0 { return "0 min" }
            if m < 60 { return "\(m) min" }
            return "\(m / 60):\(String(format: "%02d", m % 60)) h"
        }

        // MARK: Ansichten

        func mapView(_ mapView: MLNMapView, viewFor annotation: MLNAnnotation) -> MLNAnnotationView? {
            if let p = annotation as? KartenFahrerPunkt, let f = p.fahrer {
                let v = KartenFahrerPin()
                let d = darstellung(f)
                v.anwenden(f, abgeblendet: d.abgeblendet, hoehe: d.hoehe)
                fahrerAnsichten[p.id] = v
                return v
            }
            if let g = annotation as? KartenGruppenPunkt {
                return GruppenAnsicht(anzahl: g.anzahl, abgeblendet: g.abgeblendet)
            }
            if let r = annotation as? KartenRoutenPunkt {
                switch r.art {
                case "abholort": return RoutenPin(bild: "Abholort_Pin_Trisar_01_rot")
                case "ziel": return RoutenPin(bild: "Ziel_Pin_Trisar_01")
                case "blase-blau": return DauerSchild(text: r.text, hinten: UIColor(hex: 0x0059FF), vorne: .white)
                case "blase-gelb": return DauerSchild(text: r.text, hinten: UIColor(hex: 0xE3F654), vorne: UIColor(hex: 0x111111))
                default: return nil
                }
            }
            return nil
        }
    }
}

// MARK: - Punkte

final class KartenFahrerPunkt: MLNPointAnnotation {
    let id: String
    var fahrer: KartenFahrer?
    init(id: String) { self.id = id; super.init() }
    required init?(coder: NSCoder) { fatalError() }
}

final class KartenGruppenPunkt: MLNPointAnnotation {
    var orte: [CLLocationCoordinate2D] = []
    var anzahl = 0
    var abgeblendet = false
}

final class KartenRoutenPunkt: MLNPointAnnotation {
    let art: String
    let text: String
    init(art: String, text: String) { self.art = art; self.text = text; super.init() }
    required init?(coder: NSCoder) { fatalError() }
}

// MARK: - Ansichten der Punkte

/// Blasses Zeichen wie abblendenAnwenden: darunter eine deckende Flaeche in der Kartenfarbe
/// (#0e0e0e) in Form des Zeichens, darueber Bild und Nummer gemeinsam mit 30 %.
private func abblenden(_ ansicht: UIView, unterlage: UIImageView, gruppe: UIView, bild: String, an: Bool) {
    unterlage.image = UIImage(named: bild)?.withRenderingMode(.alwaysTemplate)
    unterlage.tintColor = UIColor(hex: 0x0E0E0E)
    unterlage.isHidden = !an
    gruppe.alpha = an ? 0.3 : 1
}

/// Fahrer-Pin 35 x 41,14, Spitze auf dem Ort, Nummer (15 fett, #1A1A1A) mittig im Kopf (17,5 / 17,5).
final class KartenFahrerPin: MLNAnnotationView {
    private let unterlage = UIImageView()
    private let gruppe = UIView()
    private let bild = UIImageView()
    private let nummer = UILabel()
    private var bildName = ""

    init() {
        super.init(reuseIdentifier: nil)
        frame = CGRect(x: 0, y: 0, width: 35, height: 41.1367)
        for v in [unterlage, gruppe] { v.frame = bounds; addSubview(v) }
        bild.frame = bounds
        bild.contentMode = .scaleToFill
        unterlage.contentMode = .scaleToFill
        gruppe.addSubview(bild)
        nummer.frame = CGRect(x: 0, y: 17.5 - 12, width: 35, height: 24)
        nummer.textAlignment = .center
        nummer.textColor = UIColor(hex: 0x1A1A1A)
        nummer.font = WebText.schrift(15, .bold)
        gruppe.addSubview(nummer)
        centerOffset = CGVector(dx: 0, dy: -41.1367 / 2)
        isUserInteractionEnabled = false
    }
    required init?(coder: NSCoder) { fatalError() }

    func anwenden(_ f: KartenFahrer, abgeblendet: Bool, hoehe: CGFloat) {
        let name = f.zustand.pinBild(zuendungAus: f.zuendungAus)
        if name != bildName { bildName = name; bild.image = UIImage(named: name) }
        nummer.text = f.nummer ?? "?"
        abblenden(self, unterlage: unterlage, gruppe: gruppe, bild: name, an: abgeblendet)
        layer.zPosition = hoehe
    }
}

/// Gruppe nach Figma 2563-12242: weisser Kreis 35 pt mit der Anzahl in Fuenferschritten.
private final class GruppenAnsicht: MLNAnnotationView {
    init(anzahl: Int, abgeblendet: Bool) {
        super.init(reuseIdentifier: nil)
        frame = CGRect(x: 0, y: 0, width: 35, height: 35)
        let unterlage = UIImageView(frame: bounds), gruppe = UIView(frame: bounds)
        addSubview(unterlage); addSubview(gruppe)
        let bild = UIImageView(frame: bounds)
        bild.image = UIImage(named: "Gruppe_Kreis_Trisar_01")
        gruppe.addSubview(bild)
        let l = UILabel(frame: bounds)
        l.text = "\(anzahl / 5 * 5)"
        l.textAlignment = .center
        l.textColor = .black
        l.font = WebText.schrift(15, .bold)
        gruppe.addSubview(l)
        abblenden(self, unterlage: unterlage, gruppe: gruppe, bild: "Gruppe_Kreis_Trisar_01", an: abgeblendet)
        layer.zPosition = abgeblendet ? 210 : 1450
        isUserInteractionEnabled = false
    }
    required init?(coder: NSCoder) { fatalError() }
}

/// Abholort (rot, Gast) und Ziel (Schachbrett), 35 x 41,14, Spitze auf dem Ort.
private final class RoutenPin: MLNAnnotationView {
    init(bild: String) {
        super.init(reuseIdentifier: nil)
        frame = CGRect(x: 0, y: 0, width: 35, height: 41.1367)
        let v = UIImageView(image: UIImage(named: bild))
        v.frame = bounds
        addSubview(v)
        centerOffset = CGVector(dx: 0, dy: -41.1367 / 2)
        layer.zPosition = 320
        isUserInteractionEnabled = false
    }
    required init?(coder: NSCoder) { fatalError() }
}

/// Dauer-Schild (openDurationLabel): Pille 13 fett, 6/12 Innenabstand, Schatten, Unterkante auf dem Punkt.
private final class DauerSchild: MLNAnnotationView {
    init(text: String, hinten: UIColor, vorne: UIColor) {
        super.init(reuseIdentifier: nil)
        let l = UILabel()
        l.text = text
        l.font = WebText.schrift(13, .heavy)
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
