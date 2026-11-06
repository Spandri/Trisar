import SwiftUI

/// Aufsicht des Fahrzeugs (Front oben, 120 x 240) mit optionaler Marke, wie WagenAufsicht im Web.
/// Gleiche Zeichnung beim Melden (SchadenMeldenAnsicht) und im Schadensbericht (Fahrer + Dispo).
enum FahrzeugSkizze {
    static let groesse = CGSize(width: 120, height: 240)

    /// Zeichnet in Koordinaten 120 x 240 (vorher skalieren).
    static func zeichnen(_ k: GraphicsContext, punkt: CGPoint?) {
        let schwarz = Color(hex: 0x1C1C1D)
        for r in [CGRect(x: 5, y: 40, width: 13, height: 36), CGRect(x: 102, y: 40, width: 13, height: 36),
                  CGRect(x: 5, y: 164, width: 13, height: 36), CGRect(x: 102, y: 164, width: 13, height: 36),
                  CGRect(x: 6, y: 84, width: 14, height: 9), CGRect(x: 100, y: 84, width: 14, height: 9)] {
            k.fill(Path(r), with: .color(schwarz))
        }
        let koerper = Path(roundedRect: CGRect(x: 16, y: 4, width: 88, height: 232), cornerRadius: 24)
        k.fill(koerper, with: .color(Color(hex: 0xF7F7F7)))
        k.stroke(koerper, with: .color(schwarz), lineWidth: 3)
        var vorne = Path(); vorne.addLines([CGPoint(x: 31, y: 100), CGPoint(x: 89, y: 100), CGPoint(x: 83, y: 72), CGPoint(x: 37, y: 72)]); vorne.closeSubpath()
        var hinten = Path(); hinten.addLines([CGPoint(x: 31, y: 148), CGPoint(x: 89, y: 148), CGPoint(x: 83, y: 178), CGPoint(x: 37, y: 178)]); hinten.closeSubpath()
        k.fill(vorne, with: .color(schwarz))
        k.fill(hinten, with: .color(schwarz))
        if let p = punkt {
            // Marke bleibt ganz im Bild (Radius 17 + 2 Rand).
            let x = min(groesse.width - 19, max(19, p.x)), y = min(groesse.height - 19, max(19, p.y))
            let ring = Path(ellipseIn: CGRect(x: x - 17, y: y - 17, width: 34, height: 34))
            k.fill(ring, with: .color(Color(hex: 0xE3F754)))
            k.stroke(ring, with: .color(schwarz), lineWidth: 2.5)
            k.fill(Path(ellipseIn: CGRect(x: x - 5, y: y - 5, width: 10, height: 10)), with: .color(schwarz))
        }
    }

    /// Fertige Ansicht in gewuenschter Hoehe (Breite folgt dem Seitenverhaeltnis).
    struct Ansicht: View {
        let punkt: CGPoint?
        var hoehe: CGFloat = 120
        var body: some View {
            let s = hoehe / FahrzeugSkizze.groesse.height
            Canvas { k, _ in
                k.scaleBy(x: s, y: s)
                FahrzeugSkizze.zeichnen(k, punkt: punkt)
            }
            .frame(width: FahrzeugSkizze.groesse.width * s, height: hoehe)
        }
    }

    /// Punkt aus der gespeicherten Stelle (vehicle_damages.stelle).
    static func punkt(aus stelle: [String: Any]?) -> CGPoint? {
        guard let stelle, let x = (stelle["x"] as? NSNumber)?.doubleValue, let y = (stelle["y"] as? NSNumber)?.doubleValue else { return nil }
        return CGPoint(x: x, y: y)
    }
}

/// Genaue Stelle eines Schadens (vehicle_damages.stelle), Koordinaten der Aufsicht 120 x 240.
struct SchadenStelle: Codable, Equatable {
    let x: Double
    let y: Double
    var bauteil: String?
    var geschaetzt: Bool?
    var punkt: CGPoint { CGPoint(x: x, y: y) }
}
