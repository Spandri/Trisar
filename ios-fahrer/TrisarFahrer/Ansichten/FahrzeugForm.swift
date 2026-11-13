import SwiftUI
import UIKit

/// Unsichtbare Form eines Fahrzeugmodells fuer "Schaden melden", wie fahrzeugForm.js der Web-App
/// (werkzeuge/fahrzeugbilder/form-bauen.py). Aus den 36 Umrissen geschnittenes Volumen plus Kamera des
/// Drehtellers. Damit wird ein Tipp auf das Bild zu einem Punkt am Auto, und dieser Punkt laesst sich in
/// jeder Ansicht wiederfinden. Koordinaten in Metern (Massstab geschaetzt): x quer (+ = links), y hoch,
/// z (+ = vorne). Bildpunkte immer im Drehbild (satz.breite x satz.hoehe, 800 px breit).
final class FahrzeugForm {
    /// Ist die Stelle aus dieser Ansicht zu sehen? Der Strahl dorthin darf hoechstens so viel vorher auf das Auto treffen.
    private static let sichtToleranz = 0.11

    private let info: DrehInfo.FormInfo
    private let anfang: [Int32]
    private let anzahl: [UInt8]
    private let laeufe: [UInt16]
    private let nx: Int, ny: Int, nz: Int
    private let radius: Double

    /// nil, wenn die Daten nicht zur Beschreibung passen (z. B. HTML-Fehlerseite statt Datei)
    init?(info: DrehInfo.FormInfo, daten: Data) {
        guard info.n.count == 3, info.o.count == 3, info.grenzen.count == 6 else { return nil }
        self.info = info
        nx = info.n[0]; ny = info.n[1]; nz = info.n[2]
        let b = [UInt8](daten)
        var anfang = [Int32](repeating: 0, count: nx * ny)
        var anzahl = [UInt8](repeating: 0, count: nx * ny)
        var laeufe: [UInt16] = []
        laeufe.reserveCapacity(info.laeufe * 2)
        var i = 0
        for c in 0..<(nx * ny) {
            guard i < b.count else { return nil }
            let n = Int(b[i]); i += 1
            guard i + n * 4 <= b.count else { return nil }
            anfang[c] = Int32(laeufe.count); anzahl[c] = UInt8(n)
            for _ in 0..<n {
                laeufe.append(UInt16(b[i]) | UInt16(b[i + 1]) << 8)
                laeufe.append(UInt16(b[i + 2]) | UInt16(b[i + 3]) << 8)
                i += 4
            }
        }
        guard i == b.count else { return nil }
        self.anfang = anfang; self.anzahl = anzahl; self.laeufe = laeufe
        let g = info.grenzen
        radius = (pow(max(-g[0], g[1]), 2) + pow(max(-g[4], g[5]), 2) + pow(max(-g[2], g[3]), 2)).squareRoot() + 0.1
    }

    private func belegt(_ x: Double, _ y: Double, _ z: Double) -> Bool {
        let s = info.schritt
        let ix = Int(((x - info.o[0]) / s).rounded(.down)), iy = Int(((y - info.o[1]) / s).rounded(.down))
        let iz = Int(((z - info.o[2]) / s).rounded(.down))
        guard ix >= 0, iy >= 0, iz >= 0, ix < nx, iy < ny, iz < nz else { return false }
        let c = ix * ny + iy
        var a = Int(anfang[c])
        for _ in 0..<Int(anzahl[c]) {
            if iz >= Int(laeufe[a]) && iz < Int(laeufe[a + 1]) { return true }
            a += 2
        }
        return false
    }

    /// Punkt am Auto -> (u, v, Tiefe) im Drehbild der Ansicht k
    func abbilden(_ p: [Double], _ k: Int) -> (u: Double, v: Double, d: Double) {
        let c = info.kamera
        let th = Double(k) * 10 * .pi / 180, ph = c.phi * .pi / 180
        let x = p[0] * cos(th) + p[2] * sin(th)
        let z = -p[0] * sin(th) + p[2] * cos(th)
        let y = p[1] - c.h0
        let y2 = y * cos(ph) - z * sin(ph)
        let z2 = y * sin(ph) + z * cos(ph)
        let d = c.D - z2, f = c.s * c.D
        return (c.cx + f * x / d, c.cy - f * y2 / d, d)
    }

    /// Strahl durch Bildpunkt (u, v) der Ansicht k: erster belegter Wuerfel (Punkt, Tiefe) oder nil
    private func strahl(_ k: Int, _ u: Double, _ v: Double, bis: Double? = nil) -> ([Double], Double)? {
        let c = info.kamera
        let th = Double(k) * 10 * .pi / 180, ph = c.phi * .pi / 180, f = c.s * c.D
        let a = (u - c.cx) / f, bb = (c.cy - v) / f
        var t = max(0.1, c.D - radius)
        let ende = bis ?? (c.D + radius)
        while t <= ende {
            let xs = a * t, y2 = bb * t, z2 = c.D - t
            let y = y2 * cos(ph) + z2 * sin(ph)
            let z = -y2 * sin(ph) + z2 * cos(ph)
            let X = xs * cos(th) - z * sin(th), Z = xs * sin(th) + z * cos(th), Y = y + c.h0
            if belegt(X, Y, Z) { return ([X, Y, Z], t) }
            t += info.schritt / 2
        }
        return nil
    }

    /// Tipp auf (u, v) in Ansicht k -> Punkt am Auto oder nil (daneben getippt)
    func treffen(_ k: Int, _ u: Double, _ v: Double) -> [Double]? { strahl(k, u, v)?.0 }

    /// Bildpunkt, wenn die Stelle in Ansicht k zu sehen ist, sonst nil
    func sichtbar(_ p: [Double], _ k: Int) -> CGPoint? {
        let a = abbilden(p, k)
        guard let r = strahl(k, a.u, a.v, bis: a.d + 0.05), a.d - r.1 < Self.sichtToleranz else { return nil }
        return CGPoint(x: a.u, y: a.v)
    }

    /// Richtung der Flaeche bei P (nach aussen, grob): vom Schwerpunkt der belegten Nachbarn weg
    private func normale(_ p: [Double]) -> [Double] {
        let s = info.schritt
        var n = [0.0, 0.0, 0.0]
        for a in -3...3 { for b in -3...3 { for c in -3...3 where belegt(p[0] + Double(a) * s, p[1] + Double(b) * s, p[2] + Double(c) * s) {
            n[0] -= Double(a); n[1] -= Double(b); n[2] -= Double(c)
        } } }
        let l = max((n[0] * n[0] + n[1] * n[1] + n[2] * n[2]).squareRoot(), 1e-9)
        return n.map { $0 / l }
    }

    /// Bereich wie im bisherigen Bericht: zeile front/seite/heck, seite links/mitte/rechts
    func bereich(_ p: [Double]) -> (zeile: String, seite: String) {
        let g = info.grenzen
        let L = g[5] - g[4], W = g[1] - g[0], H = g[3] - g[2], mitte = (g[0] + g[1]) / 2
        let zeile = p[2] > g[5] - 0.22 * L ? "front" : (p[2] < g[4] + 0.2 * L ? "heck" : "seite")
        var seite = p[0] - mitte > 0.18 * W ? "links" : (p[0] - mitte < -0.18 * W ? "rechts" : "mitte")
        // Dach: Flaeche zeigt nach oben und liegt oben (Motorhaube und Heckklappe bleiben vorne/hinten)
        if zeile == "seite" && p[1] > g[2] + 0.6 * H && normale(p)[1] > 0.6 { seite = "mitte" }
        return (zeile, seite)
    }

    /// Lage auf der bisherigen Aufsicht (120 x 240, Front oben), damit alte Anzeigen weiter passen
    func aufsicht(_ p: [Double]) -> CGPoint {
        let g = info.grenzen
        let x = 16 + 88 * (g[1] - p[0]) / (g[1] - g[0])
        let y = 4 + 232 * (g[5] - p[2]) / (g[5] - g[4])
        return CGPoint(x: (x * 10).rounded() / 10, y: (y * 10).rounded() / 10)
    }

    /// Ansicht k (0 = von vorne, 9 = rechte Seite, 27 = linke Seite) -> Name
    static func ansichtName(_ k: Int) -> String {
        let w = ((k * 10) % 360 + 360) % 360
        let namen: [(Int, String)] = [(20, "Vorne"), (70, "Vorne rechts"), (110, "Seite rechts"), (160, "Hinten rechts"),
                                      (200, "Hinten"), (250, "Hinten links"), (290, "Seite links"), (340, "Vorne links"), (360, "Vorne")]
        return namen.first { w < $0.0 }?.1 ?? "Vorne"
    }
}

/// Formen vom Server (fahrer.trisar.de/fahrzeug-dreh/<modell>-form.bin), auf Platte und im Speicher gemerkt.
actor FormSpeicher {
    static let shared = FormSpeicher()
    private var fertig: [String: FahrzeugForm] = [:]

    func form(_ satz: DrehSatz) async -> FahrzeugForm? {
        guard let info = satz.form else { return nil }
        if let f = fertig[satz.modell] { return f }
        let name = "\(satz.modell)-form.bin"
        let ziel = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first?
            .appendingPathComponent("FahrzeugDreh", isDirectory: true).appendingPathComponent(name)
        // Platte zuerst, aber nur wenn die Datei zur aktuellen Beschreibung passt
        if let ziel, let daten = try? Data(contentsOf: ziel), let f = FahrzeugForm(info: info, daten: daten) {
            fertig[satz.modell] = f
            return f
        }
        var anfrage = URLRequest(url: DrehInfo.basis.appendingPathComponent(name))
        anfrage.timeoutInterval = 30
        guard let (daten, antwort) = try? await URLSession.shared.data(for: anfrage),
              (antwort as? HTTPURLResponse)?.statusCode == 200,
              let f = FahrzeugForm(info: info, daten: daten) else { return nil }
        if let ziel {
            try? FileManager.default.createDirectory(at: ziel.deletingLastPathComponent(), withIntermediateDirectories: true)
            try? daten.write(to: ziel, options: .atomic)
        }
        fertig[satz.modell] = f
        return f
    }
}

/// Markierung der Schadensstelle (roter Ring mit Punkt), wie im Web.
struct SchadenMarke: View {
    var gross = true
    var body: some View {
        let d: CGFloat = gross ? 30 : 18
        ZStack {
            Circle().fill(Color(red: 1, green: 45 / 255, blue: 45 / 255, opacity: 0.25))
            Circle().strokeBorder(Color(hex: 0xFF2D2D), lineWidth: gross ? 3 : 2)
            Circle().fill(Color(hex: 0xFF2D2D)).frame(width: 6, height: 6)
        }
        .frame(width: d, height: d)
        .allowsHitTesting(false)
    }
}

/// Wo das Drehbild (wie scaledToFit) in einer Flaeche liegt
func drehBildRahmen(_ satz: DrehSatz, _ g: CGSize) -> CGRect {
    let a = satz.breite / satz.hoehe
    let w = min(g.width, g.height * a), h = w / a
    return CGRect(x: (g.width - w) / 2, y: (g.height - h) / 2, width: w, height: h)
}

/// Kleines Bild fuer den Schadensbericht (Fahrer und Dispo): das Auto in der Ansicht, in der markiert
/// wurde, mit Punkt. Nur nutzen, wenn passt(stelle:satz:) gilt.
struct StelleAnsicht: View {
    let satz: DrehSatz
    let ansicht: Int
    let bild: CGPoint
    var breite: CGFloat = 150
    var hoehe: CGFloat = 70
    @State private var foto: UIImage?

    static func passt(_ stelle: SchadenStelle?, _ satz: DrehSatz?) -> Bool {
        guard let stelle, let satz, stelle.modell == satz.modell, stelle.ansicht != nil, (stelle.bild?.count ?? 0) == 2 else { return false }
        return true
    }

    var body: some View {
        let r = drehBildRahmen(satz, CGSize(width: breite, height: hoehe))
        ZStack(alignment: .topLeading) {
            if let foto {
                Image(uiImage: foto).resizable().frame(width: r.width, height: r.height).offset(x: r.minX, y: r.minY)
                SchadenMarke(gross: false)
                    .position(x: r.minX + bild.x / satz.breite * r.width, y: r.minY + bild.y / satz.hoehe * r.height)
            }
        }
        .frame(width: breite, height: hoehe, alignment: .topLeading)
        .task(id: "\(satz.modell)-\(satz.lack)-\(ansicht)") { foto = await satz.bild(ansicht) }
    }
}
