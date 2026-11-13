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
    /// Eigene Orte als Icon-Marker. Der gewaehlte zeigt Schild und beide Radien.
    var orte: [EigenerOrt] = []
    var gewaehlterOrt: UUID?
    var ortWaehlen: (UUID?) -> Void = { _ in }
    /// Mehrfachauswahl an: diese Fahrer normal, alle anderen blass, markierte nie in Gruppen. Nil = aus.
    var markiert: Set<String>? = nil
    /// Eigener Bereich der Dispo (13.11.): duenne Lime-Linie, "Karte" in der Leiste zoomt darauf.
    var bereich: [CLLocationCoordinate2D]? = nil
    /// Zugriff auf die Karte zum Umrechnen der gezeichneten Punkte.
    var zugang: KartenZugang? = nil

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
        zugang?.karte = karte
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
        private var letzteMarkierung: Set<String>?
        private var einpassenSignal = 0
        private var letzterBereich: [CLLocationCoordinate2D]?

        // Route: Teile (Anfahrt, Fahrt) je mit noch zu fahrender und schon gefahrener Linie.
        private struct Teil { let art: String; let pfad: [CLLocationCoordinate2D]; var schild: KartenRoutenPunkt? }
        private var teile: [Teil] = []
        private var fortschritt = (teil: 0, index: 0, gefunden: false)
        private var routenPunkte: [KartenRoutenPunkt] = []
        private var routenSchluessel = ""
        private var eingepasstFuer = ""
        private var letzteBlattHoehe: CGFloat = -1

        // Eigene Orte
        private var ortPunkte: [UUID: OrtKartenPunkt] = [:]
        private var ortAnsichten: [UUID: OrtMarkerAnsicht] = [:]
        private var ortSchild: OrtSchildPunkt?
        private var letzteOrte: [EigenerOrt] = []
        private var letzterOrt: UUID?

        func setzen(_ neu: DispoKarte) {
            stand = neu
            let bereichNeu = neu.bereich.map { $0.map { [$0.latitude, $0.longitude] } }
            if bereichNeu != letzterBereich.map({ $0.map { [$0.latitude, $0.longitude] } }) {
                letzterBereich = neu.bereich
                bereichZeichnen()
            }
            if neu.einpassenSignal != einpassenSignal {
                einpassenSignal = neu.einpassenSignal
                eingepasstFuer = ""
                alleEinpassen()
            }
            let auswahl = neu.gewaehlt?.id
            if neu.fahrer != letzteListe || auswahl != letzteAuswahl || neu.markiert != letzteMarkierung {
                letzteListe = neu.fahrer
                letzteAuswahl = auswahl
                letzteMarkierung = neu.markiert
                fahrerAbgleichen()
            }
            if neu.orte != letzteOrte || neu.gewaehlterOrt != letzterOrt {
                letzteOrte = neu.orte
                letzterOrt = neu.gewaehlterOrt
                orteAbgleichen()
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
            bereichZeichnen()
            fortschrittAktualisieren()
            kreiseZeichnen()
        }

        // MARK: Eigene Orte

        /// MapLibre bricht die App ab, wenn ein Punkt verschwindet, waehrend sie gerade die Pins zeichnet
        /// (TestFlight-Absturz Dispo Build 19, MLNMapView updateAnnotationViews). Darum Punkte nie direkt
        /// in einem Rueckruf aendern, sondern einen Moment spaeter auf der Hauptschleife, in fester Reihenfolge.
        private func spaeter(weg: [MLNAnnotation] = [], dazu: [MLNAnnotation] = []) {
            guard !weg.isEmpty || !dazu.isEmpty else { return }
            DispatchQueue.main.async { [weak self] in
                guard let karte = self?.karte else { return }
                if !weg.isEmpty { karte.removeAnnotations(weg) }
                if !dazu.isEmpty { karte.addAnnotations(dazu) }
            }
        }

        private func orteAbgleichen() {
            guard karte != nil else { return }
            let ids = Set(letzteOrte.map(\.id))
            let weg = ortPunkte.filter { !ids.contains($0.key) }
            spaeter(weg: Array(weg.values))
            for id in weg.keys { ortPunkte[id] = nil; ortAnsichten[id] = nil }
            var dazu: [OrtKartenPunkt] = []
            for o in letzteOrte {
                if let p = ortPunkte[o.id] {
                    p.ort = o
                    if p.coordinate.latitude != o.lat || p.coordinate.longitude != o.lng { p.coordinate = o.punkt }
                } else {
                    let p = OrtKartenPunkt(ort: o)
                    ortPunkte[o.id] = p
                    dazu.append(p)
                }
                ortAnsichten[o.id]?.anwenden(o.symbol, aktiv: o.id == letzterOrt)
            }
            spaeter(weg: [ortSchild].compactMap { $0 }, dazu: dazu)
            ortSchild = nil
            // Gewaehlter Ort: nur die Radien, kein Schild darueber (Figma 2826-12363).
            kreiseZeichnen()
        }

        /// Innen Reinfahr-Radius (gefuellt), aussen Rausfahr-Radius (gestrichelt), nur fuer den gewaehlten Ort.
        private var kreisAnimation: Timer?
        private var kreisOrt: UUID?

        /// Beim Waehlen faehrt der kleine Ring des Zeichens (17,5 pt) zum Rausfahr-Kreis aus, der gefuellte
        /// Kreis waechst vom Lime-Kreis (14,5 pt) zum Reinfahr-Kreis, in 0,5 s mit Abbremsen (Figma 2836-12484).
        private func kreiseZeichnen() {
            guard stilGeladen, let karte, let stil = karte.style else { return }
            let o = letzteOrte.first { $0.id == letzterOrt }
            // Abgewaehlt (nochmal getippt): Kreise fahren wieder auf das Zeichen ein und verschwinden.
            guard let o else {
                guard let alt = kreisOrt, let vorher = letzteOrte.first(where: { $0.id == alt }) else {
                    if kreisOrt == nil && kreisAnimation?.isValid == true { return }  // faehrt gerade ein
                    kreisAnimation?.invalidate()
                    kreisOrt = nil
                    OrtKreise.setzen(stil, kennung: "dk-ort", mitte: nil, rein: 0, raus: 0)
                    return
                }
                kreisOrt = nil
                kreiseAnimieren(stil, karte, vorher, einfahren: true)
                return
            }
            if kreisOrt == o.id && kreisAnimation?.isValid != true {
                OrtKreise.setzen(stil, kennung: "dk-ort", mitte: o.punkt, rein: o.radius_rein_m, raus: o.radius_raus_m)
                return
            }
            if kreisOrt == o.id { return }
            kreisOrt = o.id
            kreiseAnimieren(stil, karte, o, einfahren: false)
        }

        private func kreiseAnimieren(_ stil: MLNStyle, _ karte: MLNMapView, _ o: EigenerOrt, einfahren: Bool) {
            kreisAnimation?.invalidate()
            let meterJePunkt = karte.metersPerPoint(atLatitude: o.lat)
            let startRaus = 17.5 * meterJePunkt, startRein = 14.5 * meterJePunkt
            let zielRaus = Double(o.radius_raus_m), zielRein = Double(o.radius_rein_m)
            let beginn = Date()
            kreisAnimation = Timer.scheduledTimer(withTimeInterval: 1.0 / 60, repeats: true) { timer in
                let anteil = min(1, Date().timeIntervalSince(beginn) / 0.5)
                let weich = einfahren ? 1 - pow(anteil, 3) : 1 - pow(1 - anteil, 3)
                OrtKreise.setzen(stil, kennung: "dk-ort", mitte: o.punkt,
                                 rein: max(1, Int(startRein + (zielRein - startRein) * weich)),
                                 raus: max(2, Int(startRaus + (zielRaus - startRaus) * weich)))
                if anteil >= 1 {
                    timer.invalidate()
                    if einfahren { OrtKreise.setzen(stil, kennung: "dk-ort", mitte: nil, rein: 0, raus: 0) }
                }
            }
        }

        func mapView(_ mapView: MLNMapView, regionDidChangeAnimated animated: Bool) {
            gruppenPlanen()
            let m = mapView.centerCoordinate
            UserDefaults.standard.set([m.latitude, m.longitude, mapView.zoomLevel], forKey: DispoKarte.kameraSchluessel)
        }

        // MARK: Fahrer

        private var kolonne: Set<String> { Set(stand?.gewaehlt?.fahrt?.kolonnenFahrerIDs ?? []) }

        private func darstellung(_ f: KartenFahrer) -> (abgeblendet: Bool, hoehe: CGFloat) {
            let gewaehlt = stand?.gewaehlt?.id
            let istGewaehlt = gewaehlt == f.id
            let inKolonne = kolonne.contains(f.id)
            // Mehrfachauswahl: alle blass ausser den markierten (gleiche Blaesse wie beim Fokus).
            if let markiert = stand?.markiert {
                let blass = !markiert.contains(f.id) && !istGewaehlt
                return (blass, istGewaehlt ? 2000 : (blass ? 200 : 1500))
            }
            // Fokus: ist ein Fahrer gewaehlt, treten alle anderen zurueck (ausser seiner Kolonne).
            let blass = gewaehlt != nil && !istGewaehlt && !inKolonne
            return (blass, istGewaehlt ? 2000 : (blass ? 200 : (inKolonne ? 1500 : 1000)))
        }

        private func fahrerAbgleichen() {
            guard karte != nil else { return }
            let liste = letzteListe
            // Weggefallene Fahrer (z. B. im Filter ausgeblendet) nimmt gruppenBilden von der Karte.
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
            gruppenPlanen()
        }

        /// Gruppen und Fahrer-Pins gesammelt einmal je Durchlauf der Hauptschleife abgleichen,
        /// nie mitten in einem Rueckruf der Karte (siehe spaeter).
        private var gruppenGeplant = false
        private func gruppenPlanen() {
            guard !gruppenGeplant else { return }
            gruppenGeplant = true
            DispatchQueue.main.async { [weak self] in
                self?.gruppenGeplant = false
                self?.gruppenBilden()
            }
        }

        /// updateDriverClusters: Gruppen erst ab fuenf Fahrern, deren Pins (35 pt) sich beruehren.
        /// Der gewaehlte Fahrer und seine Kolonne bleiben immer einzeln.
        private func gruppenBilden() {
            guard let karte else { return }
            // Vor dem ersten Layout kennt die Karte keine Bildschirmpunkte: kurz danach nochmal.
            guard karte.bounds.width > 10 else {
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) { [weak self] in self?.gruppenPlanen() }
                return
            }
            let s = stand?.massstab ?? 1
            let einzeln = kolonne.union([stand?.gewaehlt?.id].compactMap { $0 }).union(stand?.markiert ?? [])
            let fokus = stand?.gewaehlt != nil || stand?.markiert != nil
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
            // Nicht mehr gelistete Fahrer ganz vergessen (sind oben schon von der Karte).
            let gelistet = Set(letzteListe.map(\.id))
            for id in Array(fahrerPunkte.keys) where !gelistet.contains(id) {
                fahrerPunkte[id] = nil
                fahrerAnsichten[id] = nil
            }
            // Gruppen nur tauschen, wenn sie sich wirklich geaendert haben.
            let gleich = gruppen.count == neueGruppen.count && zip(gruppen, neueGruppen).allSatisfy {
                $0.anzahl == $1.anzahl && $0.abgeblendet == $1.abgeblendet
                    && $0.coordinate.latitude == $1.coordinate.latitude && $0.coordinate.longitude == $1.coordinate.longitude
            }
            if gleich {
                for (alt, neu) in zip(gruppen, neueGruppen) { alt.orte = neu.orte }
                return
            }
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
            if let (id, _) = treffer {
                if stand.gewaehlterOrt != nil { stand.ortWaehlen(nil) }
                stand.waehlen(id)
                return
            }
            if let g = gruppen.first(where: { trifft(karte.view(for: $0)) }) { gruppeOeffnen(g); return }
            // Eigener Ort: Tipp zeigt die Kreise, erneuter Tipp blendet sie aus.
            if let (id, _) = ortAnsichten.sorted(by: { $0.value.layer.zPosition > $1.value.layer.zPosition })
                .first(where: { trifft($0.value) }) {
                stand.ortWaehlen(stand.gewaehlterOrt == id ? nil : id)
                return
            }
            if stand.gewaehlterOrt != nil { stand.ortWaehlen(nil) }
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

        private func einpassen(_ orte: [CLLocationCoordinate2D], oben: CGFloat, rechts: CGFloat, unten: CGFloat, links: CGFloat, maxZoom: Double? = nil) {
            guard let karte, let erster = orte.first else { return }
            guard karte.bounds.width > 10, karte.bounds.height > 10 else {
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) { [weak self] in
                    self?.einpassen(orte, oben: oben, rechts: rechts, unten: unten, links: links, maxZoom: maxZoom)
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
            let grenzen = MLNCoordinateBounds(sw: sw, ne: ne)
            guard let maxZoom else {
                karte.setVisibleCoordinateBounds(grenzen, edgePadding: rand, animated: true, completionHandler: nil)
                return
            }
            // Wie maxZoom bei fitBounds im Web: die Kamera nie naeher als die Grenze.
            let kamera = karte.cameraThatFitsCoordinateBounds(grenzen, edgePadding: rand)
            let mindestHoehe = MLNAltitudeForZoomLevel(maxZoom, kamera.pitch, kamera.centerCoordinate.latitude, karte.bounds.size)
            if kamera.altitude < mindestHoehe { kamera.altitude = mindestHoehe }
            karte.setCamera(kamera, animated: true)
        }

        /// fitAllDriverMarkers: oben bleiben Zurueck, Filter und Statusleiste frei.
        private func alleEinpassen() {
            if let b = letzterBereich, b.count >= 3 {
                einpassen(b, oben: 200, rechts: 24, unten: 190, links: 24)
                return
            }
            // Nicht naeher als ein Stadtviertel (Web: ALLE_FAHRER_MAX_ZOOM).
            einpassen(letzteListe.map(\.ort), oben: 200, rechts: 24, unten: 190, links: 24, maxZoom: 13.5)
        }

        /// Umriss des eigenen Bereichs: geschlossene Lime-Linie, 2 breit.
        private func bereichZeichnen() {
            guard stilGeladen, let stil = karte?.style else { return }
            var pfad = letzterBereich ?? []
            if pfad.count >= 3, let erster = pfad.first { pfad.append(erster) } else { pfad = [] }
            linie(stil, "trisar-bereich", pfad, UIColor(hex: 0xE3F654), 2, gestrichelt: false, deckung: 1)
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
            guard karte != nil, stilGeladen else { return }
            let route = stand?.route
            let schluessel = route?.schluessel ?? ""
            guard schluessel != routenSchluessel else { return }
            routenSchluessel = schluessel
            spaeter(weg: routenPunkte)
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
            spaeter(dazu: routenPunkte)
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
                    if let s = t.schild { spaeter(weg: [s]) }
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
            if let o = annotation as? OrtKartenPunkt {
                let v = OrtMarkerAnsicht()
                v.anwenden(o.ort.symbol, aktiv: o.ort.id == letzterOrt)
                ortAnsichten[o.ort.id] = v
                return v
            }
            if let s = annotation as? OrtSchildPunkt {
                return OrtSchildAnsicht(text: s.text, unter: s.unter)
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
    /// Kein Signal seit 5 Minuten (Figma 2823-12621): grauer Kreis 50 % auf dem dunklen Grund,
    /// roter Punkt unten rechts mit Signalbalken darin.
    private let grauKreis = UIImageView(image: UIImage(named: "Fahrer_Offline_Trisar_01"))
    private let keinSignal = UIImageView(image: UIImage(named: "Fahrer_Offline_Punkt_Trisar_01"))
    private let balken = UIImageView(image: UIImage(named: "Fahrer_Offline_Balken_Trisar_01"))
    private var bildName = ""
    /// Flagge im runden Kopf oben rechts, am Rand des Kreises abgeschnitten (Figma 2900:41598, 14 x 18).
    /// Eine schwarze Kopie knapp dahinter ergibt die duenne Umrandung. Bleibt beim Abblenden deckend.
    private let flaggenKlammer = UIView(frame: CGRect(x: 0, y: 0, width: 35, height: 35))
    private let flaggenRand = UIImageView()
    private let flaggenFuellung = UIImageView()
    private var flaggenName = ""

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
        grauKreis.frame = CGRect(x: 0, y: 0, width: 35, height: 35)
        grauKreis.alpha = 0.5
        keinSignal.frame = CGRect(x: 22, y: 21, width: 14, height: 14)
        balken.frame = CGRect(x: 25.3, y: 25, width: 8.15, height: 5.41667)
        // Reihenfolge wie in Figma: Grund, grauer Kreis, Punkt, Nummer, Balken. Punkt und Balken
        // liegen ausserhalb der Gruppe, damit sie beim Abblenden nicht blass werden.
        gruppe.addSubview(nummer)
        gruppe.insertSubview(grauKreis, belowSubview: nummer)
        addSubview(keinSignal)
        addSubview(balken)
        flaggenKlammer.layer.cornerRadius = 17.5
        flaggenKlammer.clipsToBounds = true
        flaggenKlammer.isUserInteractionEnabled = false
        flaggenRand.contentMode = .scaleToFill
        flaggenFuellung.contentMode = .scaleToFill
        flaggenRand.tintColor = .black
        // x 21, y -3.5, 12 x 15.4 wie am Web-Marker, Rand 0,8 pt rundum.
        flaggenFuellung.frame = CGRect(x: 21, y: -3.5, width: 12, height: 15.4)
        flaggenRand.frame = flaggenFuellung.frame.insetBy(dx: -0.8, dy: -0.8)
        flaggenKlammer.addSubview(flaggenRand)
        flaggenKlammer.addSubview(flaggenFuellung)
        flaggenKlammer.isHidden = true
        addSubview(flaggenKlammer)
        for v in [grauKreis, keinSignal, balken] { v.isHidden = true }
        centerOffset = CGVector(dx: 0, dy: -41.1367 / 2)
        isUserInteractionEnabled = false
    }
    required init?(coder: NSCoder) { fatalError() }

    func anwenden(_ f: KartenFahrer, abgeblendet: Bool, hoehe: CGFloat) {
        // Ohne Signal: grauer Kreis halb durchsichtig mit weisser Nummer, Mitte auf dem Ort.
        let name = f.offline ? "Fahrer_Offline_Grund_Trisar_01" : f.zustand.pinBild(zuendungAus: f.zuendungAus)
        if name != bildName { bildName = name; bild.image = UIImage(named: name) }
        let hoeheBild: CGFloat = f.offline ? 35 : 41.1367
        bild.frame = CGRect(x: 0, y: 0, width: 35, height: hoeheBild)
        unterlage.frame = bild.frame
        nummer.textColor = f.offline ? .white : UIColor(hex: 0x1A1A1A)
        grauKreis.isHidden = !f.offline
        // Stufen 1 bis 4: Punkt orange werdend mit 4 bis 1 Strichen am normalen Pin. Stufe 5: rot, 1 Strich.
        let stufe = f.signalStufe
        let mitPunkt = stufe >= 1
        keinSignal.isHidden = !mitPunkt
        balken.isHidden = !mitPunkt
        if mitPunkt {
            keinSignal.image = UIImage(named: stufe >= 5 ? "Fahrer_Offline_Punkt_Trisar_01" : "Fahrer_Signal_Punkt_\(stufe)_Trisar_01")
            balken.image = UIImage(named: stufe >= 5 ? "Fahrer_Offline_Balken_Trisar_01" : "Fahrer_Signal_Balken_\(5 - stufe)_Trisar_01")
        }
        // Flagge des Fahrers: im Kopf oben rechts.
        if let fl = Flaggen.nachID(f.flagge) {
            if flaggenName != fl.voll {
                flaggenName = fl.voll
                flaggenFuellung.image = UIImage(named: fl.voll)
                flaggenRand.image = UIImage(named: fl.voll)?.withRenderingMode(.alwaysTemplate)
            }
            flaggenKlammer.isHidden = false
        } else {
            flaggenName = ""
            flaggenKlammer.isHidden = true
        }
        // Pin: Spitze unten auf dem Ort. Ohne Signal: Mitte des Kreises (17,5) auf dem Ort.
        centerOffset = CGVector(dx: 0, dy: f.offline ? 41.1367 / 2 - 17.5 : -41.1367 / 2)
        nummer.text = f.nummer ?? "?"
        // Nummer immer ganz vorn in der Gruppe, sonst verdecken Grund und grauer Kreis sie.
        if nummer.superview !== gruppe { gruppe.addSubview(nummer) }
        nummer.frame = CGRect(x: 0, y: 17.5 - 12, width: 35, height: 24)
        nummer.isHidden = false
        gruppe.bringSubviewToFront(nummer)
        abblenden(self, unterlage: unterlage, gruppe: gruppe, bild: name, an: abgeblendet)
        layer.zPosition = hoehe
        bringSubviewToFront(flaggenKlammer)
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


/// Zugriff auf die MapLibre-Karte von aussen (Bereich zeichnen: Bildschirmpunkte in Koordinaten).
final class KartenZugang {
    weak var karte: MLNMapView?

    func koordinaten(_ punkte: [CGPoint]) -> [CLLocationCoordinate2D] {
        guard let karte else { return [] }
        return punkte.map { karte.convert($0, toCoordinateFrom: karte) }
    }
}

/// Eigener Kartenbereich der Dispo (13.11.), persoenlich in public.dispo_kartenbereich, wie kartenBereich.js im Web.
@MainActor
final class KartenBereich: ObservableObject {
    static let geteilt = KartenBereich()
    @Published private(set) var punkte: [CLLocationCoordinate2D]?
    private static let schluessel = "trisar_kartenbereich_v1"

    private struct Zeile: Codable { let punkte: [[Double]] }
    private struct Schreiben: Encodable { let user_id: String; let punkte: [[Double]]; let aktualisiert: String }

    private init() {
        if let w = UserDefaults.standard.array(forKey: Self.schluessel) as? [[Double]] { punkte = Self.aus(w) }
    }

    /// [[lng, lat]] wie im Web.
    private static func aus(_ w: [[Double]]) -> [CLLocationCoordinate2D]? {
        let k = w.filter { $0.count >= 2 }.map { CLLocationCoordinate2D(latitude: $0[1], longitude: $0[0]) }
        return k.count >= 3 ? k : nil
    }
    private static func roh(_ k: [CLLocationCoordinate2D]) -> [[Double]] {
        k.map { [($0.longitude * 1e6).rounded() / 1e6, ($0.latitude * 1e6).rounded() / 1e6] }
    }
    private func merken(_ k: [CLLocationCoordinate2D]?) {
        punkte = k
        if let k { UserDefaults.standard.set(Self.roh(k), forKey: Self.schluessel) } else { UserDefaults.standard.removeObject(forKey: Self.schluessel) }
    }

    func laden() async {
        guard let id = Backend.client.auth.currentUser?.id.uuidString.lowercased() else { return }
        guard let zeilen: [Zeile] = try? await Backend.client.from("dispo_kartenbereich").select("punkte")
            .eq("user_id", value: id).execute().value else { return }
        merken(zeilen.first.flatMap { Self.aus($0.punkte) })
    }

    /// Gibt eine Fehlermeldung zurueck oder nil.
    func speichern(_ k: [CLLocationCoordinate2D]) async -> String? {
        guard k.count >= 3 else { return "Bereich zu klein." }
        merken(k)
        guard let id = Backend.client.auth.currentUser?.id.uuidString.lowercased() else { return "Nicht angemeldet." }
        do {
            try await Backend.client.from("dispo_kartenbereich")
                .upsert(Schreiben(user_id: id, punkte: Self.roh(k), aktualisiert: ISO8601DateFormatter().string(from: Date())), onConflict: "user_id")
                .execute()
            return nil
        } catch { return error.localizedDescription }
    }

    func loeschen() async -> String? {
        merken(nil)
        guard let id = Backend.client.auth.currentUser?.id.uuidString.lowercased() else { return nil }
        do {
            try await Backend.client.from("dispo_kartenbereich").delete().eq("user_id", value: id).execute()
            return nil
        } catch { return error.localizedDescription }
    }

    /// Bildschirmpunkte ausduennen: naeher als `abstand` faellt weg, hoechstens `max` bleiben.
    static func ausduennen(_ pfad: [CGPoint], abstand: CGFloat = 6, max: Int = 240) -> [CGPoint] {
        var aus: [CGPoint] = []
        for p in pfad where aus.last.map({ hypot(p.x - $0.x, p.y - $0.y) >= abstand }) ?? true { aus.append(p) }
        guard aus.count > max else { return aus }
        let schritt = Double(aus.count) / Double(max)
        return (0..<max).map { aus[Int(Double($0) * schritt)] }
    }
}
