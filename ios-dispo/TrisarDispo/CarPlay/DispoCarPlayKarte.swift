import CarPlay
import MapLibre
import SwiftUI
import UIKit

/// Grundansicht der Dispo in CarPlay (20.11., Kategorie Navigation): dieselbe Karte wie am Handy
/// (DispoKarte) mit allen Fahrern, Gruppen, eigenen Orten und Bereich, im gewaehlten Kartenstil.
/// Nur die Karte, Bedienung kommt aus CPMapTemplate (DispoCarPlaySzene). Antippen gibt es in CarPlay
/// nicht, Zoom und Verschieben ueber Knoepfe und Gesten der Vorlage.
@MainActor
final class DispoCarPlayKartenSteuerung: ObservableObject {
    /// Erhoeht = alle Fahrer einpassen (wie "Karte" in der Leiste am Handy).
    @Published var einpassen = 0
    let zugang = KartenZugang()
    /// Ziehen: Mitte, zu der die Karte gerade gleitet.
    private var panZiel: CLLocationCoordinate2D?

    func zoomen(_ schritt: Double) {
        guard let k = zugang.karte else { return }
        k.setZoomLevel(min(max(k.zoomLevel + schritt, 3), 18), animated: true)
    }

    /// Pfeile der Verschiebe-Ansicht: ein Viertel des Bildschirms.
    func verschieben(_ richtung: CPMapTemplate.PanDirection) {
        guard let k = zugang.karte else { return }
        var d = CGPoint.zero
        if richtung.contains(.left) { d.x -= k.bounds.width / 4 }
        if richtung.contains(.right) { d.x += k.bounds.width / 4 }
        if richtung.contains(.up) { d.y -= k.bounds.height / 4 }
        if richtung.contains(.down) { d.y += k.bounds.height / 4 }
        let mitte = CGPoint(x: k.bounds.midX + d.x, y: k.bounds.midY + d.y)
        k.setCenter(k.convert(mitte, toCoordinateFrom: k), animated: true)
    }

    func gesteBeginnt() { panZiel = zugang.karte?.centerCoordinate }

    /// `translation` ist das Stueck seit der letzten Meldung (wie in der Fahrer-Karte).
    func gesteBewegt(_ translation: CGPoint) {
        guard let k = zugang.karte else { return }
        let start = panZiel ?? k.centerCoordinate
        let punkt = k.convert(start, toPointTo: k)
        let neu = k.convert(CGPoint(x: punkt.x - translation.x, y: punkt.y - translation.y), toCoordinateFrom: k)
        panZiel = neu
        k.setCenter(neu, animated: false)
    }

    func gesteEndet() { panZiel = nil }
}

struct DispoCarPlayKarte: View {
    @ObservedObject var daten: KartenDaten
    @ObservedObject var steuerung: DispoCarPlayKartenSteuerung
    @ObservedObject private var orte = OrteSpeicher.geteilt
    @ObservedObject private var bereich = KartenBereich.geteilt

    var body: some View {
        GeometryReader { geo in
            DispoKarte(
                fahrer: daten.fahrer, gewaehlt: nil, route: nil,
                blattHoehe: 0, rasterHoehe: geo.size.height, massstab: 1,
                einpassenSignal: steuerung.einpassen,
                waehlen: { _ in }, leerTippen: {}, abseits: { _ in },
                orte: orte.orte, bereich: bereich.punkte, zugang: steuerung.zugang,
                // Oben die Knoepfe der Vorlage, rechts Zoom und Verschieben.
                einpassRand: UIEdgeInsets(top: 70, left: 30, bottom: 30, right: 80),
                kameraMerken: false
            )
            .frame(width: geo.size.width, height: geo.size.height)
        }
        .ignoresSafeArea()
        .task {
            await orte.ladenFallsNoetig()
            await bereich.laden()
        }
    }
}
