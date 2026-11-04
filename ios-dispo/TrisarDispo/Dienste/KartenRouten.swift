import CoreLocation
import Foundation

/// Route des gewaehlten Fahrers wie im Routen-Effekt von GoogleMapSurface (KartenView.jsx),
/// Live-Zweig: Anfahrt (gelb gestrichelt) vom Fahrer zum Abholort nur bei offener Fahrt und
/// nicht aktivem Fahrer, Fahrt (blau) vom Abholort zum Ziel. Orte ueber Nominatim, Strecken
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
        return [f.id, r.id, r.status, r.vonSuche, r.nachSuche].joined(separator: "|")
    }

    @MainActor
    static func berechnen(fahrer: KartenFahrer, ursprung: CLLocationCoordinate2D?, alle: [KartenFahrer]) async -> KartenRoutenBild? {
        guard let ride = fahrer.fahrt else { return nil }
        var bild = KartenRoutenBild(schluessel: schluessel(fahrer))
        // Aktive Fahrer haben den Gast schon an Bord: fuer sie gibt es keine Anfahrt.
        let mitAnfahrt = KartenRegeln.istOffen(ride.status) && fahrer.zustand != .aktiv
        let abholort = await Routen.punkt(fuer: ride.vonSuche)
        let ziel = await Routen.punkt(fuer: ride.nachSuche)
        let anfahrtGeplant = mitAnfahrt && ursprung != nil && abholort != nil

        if mitAnfahrt, let von = ursprung, let bis = abholort {
            let s = await Routen.strecke(von: von, bis: bis)
            if s.punkte.count >= 2 {
                bild.anfahrt = s.punkte
                bild.anfahrtMinuten = Int((Double(s.sekunden) / 60).rounded(.up))
                bild.abholort = s.punkte.last
            }
        }
        if let von = abholort, let bis = ziel {
            let s = await Routen.strecke(von: von, bis: bis)
            if s.punkte.count >= 2 {
                bild.fahrt = s.punkte
                bild.fahrtMinuten = Int((Double(s.sekunden) / 60).rounded(.up))
                if !anfahrtGeplant { bild.abholort = s.punkte.first }
                bild.ziel = s.punkte.last
            }
        }
        bild.kolonne = ride.kolonnenFahrerIDs.compactMap { id in alle.first { $0.id == id }?.ort }
        return bild
    }
}
