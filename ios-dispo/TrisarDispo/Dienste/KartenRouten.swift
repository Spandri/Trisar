import CoreLocation
import Foundation

/// Route des gewaehlten Fahrers wie im Routen-Effekt von GoogleMapSurface (KartenView.jsx),
/// Live-Zweig: Anfahrt (gelb gestrichelt) vom Fahrer zum Abholort nur bei offener Fahrt und
/// nicht aktivem Fahrer, Fahrt (blau) vom Abholort zum Ziel. Orte aus der Fahrt (eigener Ort,
/// TomTom-Payload), sonst ueber Nominatim, Strecken
/// ueber OSRM (Routen.swift, wie maplibreKarte.js).
struct KartenRoutenBild: Equatable {
    var schluessel = ""
    var anfahrt: [CLLocationCoordinate2D] = []
    var fahrt: [CLLocationCoordinate2D] = []
    var anfahrtMinuten: Int?
    var fahrtMinuten: Int?
    var abholort: CLLocationCoordinate2D?
    var ziel: CLLocationCoordinate2D?
    /// Kolonnenkollegen: ihre Standorte gehoeren mit ins Bild.
    var kolonne: [CLLocationCoordinate2D] = []

    static func == (a: KartenRoutenBild, b: KartenRoutenBild) -> Bool {
        a.schluessel == b.schluessel && a.anfahrt.count == b.anfahrt.count && a.fahrt.count == b.fahrt.count
            && a.anfahrtMinuten == b.anfahrtMinuten && a.fahrtMinuten == b.fahrtMinuten
            && a.abholort?.latitude == b.abholort?.latitude && a.ziel?.latitude == b.ziel?.latitude
            && a.kolonne.count == b.kolonne.count
    }

    /// Alles, was beim Einpassen ins Bild muss.
    var allePunkte: [CLLocationCoordinate2D] { anfahrt + fahrt + kolonne }
}

enum KartenRouten {
    /// routeFitKey: neu rechnen, wenn sich Fahrer, Fahrt, Status oder Orte aendern.
    static func schluessel(_ f: KartenFahrer?) -> String {
        guard let f, let r = f.fahrt else { return "" }
        func text(_ p: CLLocationCoordinate2D?) -> String { p.map { "\($0.latitude),\($0.longitude)" } ?? "-" }
        return [f.id, r.id, r.status, r.vonSuche, r.nachSuche, text(r.vonPunkt), text(r.nachPunkt)].joined(separator: "|")
    }

    @MainActor
    static func berechnen(fahrer: KartenFahrer, ursprung: CLLocationCoordinate2D?, alle: [KartenFahrer]) async -> KartenRoutenBild? {
        guard let ride = fahrer.fahrt else { return nil }
        var bild = KartenRoutenBild(schluessel: schluessel(fahrer))
        // Aktive Fahrer haben den Gast schon an Bord: fuer sie gibt es keine Anfahrt.
        let mitAnfahrt = KartenRegeln.istOffen(ride.status) && fahrer.zustand != .aktiv
        // Vorhandene Koordinaten (eigener Ort, TomTom-Payload) zuerst, erst dann die Adresssuche.
        var abholort = ride.vonPunkt
        if abholort == nil { abholort = await Routen.punkt(fuer: ride.vonSuche) }
        var ziel = ride.nachPunkt
        if ziel == nil { ziel = await Routen.punkt(fuer: ride.nachSuche) }
        let anfahrtGeplant = mitAnfahrt && ursprung != nil && abholort != nil

        if mitAnfahrt, let von = ursprung, let bis = abholort {
            let s = await Routen.strecke(von: von, bis: bis)
            if s.punkte.count >= 2 {
                bild.anfahrt = s.punkte
                bild.anfahrtMinuten = Int((Double(s.sekunden) / 60).rounded(.up))
                bild.abholort = s.punkte.last
            }
        }
        // Gast an Bord: blaue Linie ab dem Fahrer, nicht ab dem Abholort. Weicht er mehr als 200 m ab,
        // meldet die Karte das (abseits) und die Route wird ab seiner neuen Position neu gerechnet.
        // Mit Zwischenstopps bleibt die ganze Strecke, sonst liefe die Linie an den Stopps vorbei.
        let abFahrer = KartenRegeln.istUnterwegs(ride.status) && ursprung != nil && ride.stoppPunkte.isEmpty
        if let von = abFahrer ? ursprung : abholort, let bis = ziel {
            var punkte: [CLLocationCoordinate2D] = []
            var sekunden = 0
            var ab = von
            for naechster in ride.stoppPunkte + [bis] {
                let s = await Routen.strecke(von: ab, bis: naechster)
                punkte += s.punkte
                sekunden += Int(s.sekunden)
                ab = naechster
            }
            if punkte.count >= 2 {
                bild.fahrt = punkte
                bild.fahrtMinuten = Int((Double(sekunden) / 60).rounded(.up))
                if !anfahrtGeplant && !abFahrer { bild.abholort = punkte.first }
                bild.ziel = punkte.last
            }
        }
        bild.kolonne = ride.kolonnenFahrerIDs.compactMap { id in alle.first { $0.id == id }?.ort }
        return bild
    }
}
