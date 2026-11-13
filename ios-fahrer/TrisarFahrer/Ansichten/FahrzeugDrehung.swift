import SwiftUI
import UIKit

/// 360-Grad-Ansicht des Fahrzeugs aus 36 Einzelbildern (FahrzeugDreh/, erzeugt mit
/// werkzeuge/fahrzeugbilder/dreh-einbauen.py), wie FahrzeugDrehung.jsx der Web-App.
/// Beim Oeffnen dreht sich das Auto einmal und bleibt schraeg vorne links stehen (Bild 32, eng
/// zugeschnitten wie das Standbild). Von Hand gedreht bleibt es dort, wo der Fahrer loslaesst.
/// Mit stehend: nur Bild 32 wie das Standbild (Startseiten-Karte), ohne Drehen und Wischen.

/// Inhalt von fahrzeug-dreh.json
struct DrehInfo: Decodable {
    struct Modell: Decodable {
        let id: String
        let modell: [String]
        let farben: [[String]]
        let lacke: [String]
    }
    let bilder: Int
    let start: Int
    let breite: CGFloat
    let hoehe: CGFloat
    let endbox: [CGFloat]
    let modelle: [Modell]

    static let geladen: DrehInfo? = {
        guard let url = Bundle.main.url(forResource: "fahrzeug-dreh", withExtension: "json"),
              let daten = try? Data(contentsOf: url) else { return nil }
        return try? JSONDecoder().decode(DrehInfo.self, from: daten)
    }()
}

/// Passender Bildsatz zu brand_model und color (Freitext).
struct DrehSatz: Equatable {
    let modell: String
    let lack: String

    /// klein, Umlaute ausgeschrieben, nur Buchstaben und Ziffern: "V-Klasse 250 d" -> "vklasse250d"
    static func glatt(_ s: String) -> String {
        let klein = s.lowercased()
            .replacingOccurrences(of: "ä", with: "ae").replacingOccurrences(of: "ö", with: "oe")
            .replacingOccurrences(of: "ü", with: "ue").replacingOccurrences(of: "ß", with: "ss")
        return String(klein.unicodeScalars.filter { ("a"..."z").contains($0) || ("0"..."9").contains($0) }.map(Character.init))
    }

    static func finden(modell: String, farbe: String) -> DrehSatz? {
        guard let info = DrehInfo.geladen else { return nil }
        let m = glatt(modell), f = glatt(farbe)
        guard !m.isEmpty, !f.isEmpty else { return nil }
        for satz in info.modelle where satz.modell.contains(where: { m.contains($0) }) {
            if let treffer = satz.farben.first(where: { $0.count == 2 && f.contains($0[0]) }),
               satz.lacke.contains(treffer[1]) {
                let gefunden = DrehSatz(modell: satz.id, lack: treffer[1])
                // Bilder liegen nur in der Fahrer-App, die Dispo hat nur die Liste.
                guard Bundle.main.url(forResource: gefunden.name(info.start), withExtension: "webp") != nil else { return nil }
                return gefunden
            }
        }
        return nil
    }

    func name(_ i: Int) -> String { "\(modell)-\(lack)-\(String(format: "%02d", i))" }

    func bild(_ i: Int) -> UIImage? {
        guard let url = Bundle.main.url(forResource: name(i), withExtension: "webp") else { return nil }
        return UIImage(contentsOfFile: url.path)
    }
}

struct FahrzeugDrehung: View {
    let satz: DrehSatz
    var stehend = false
    private let info = DrehInfo.geladen

    @State private var bilder: [UIImage] = []
    @State private var pos: Double = 32
    @State private var ziehStart: Double?
    @State private var drehAufgabe: Task<Void, Never>?

    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .topLeading) {
                if let info, !bilder.isEmpty {
                    let n = bilder.count
                    let f = ((Int(pos.rounded()) % n) + n) % n
                    let t = lage(info, geo.size)
                    Image(uiImage: bilder[f])
                        .resizable()
                        .frame(width: info.breite, height: info.hoehe)
                        .scaleEffect(t.s, anchor: .topLeading)
                        .offset(x: t.x, y: t.y)
                }
            }
            .frame(width: geo.size.width, height: geo.size.height, alignment: .topLeading)
            .clipped()
            .contentShape(Rectangle())
        }
        // Gleichzeitig mit dem Scrollen der Seite: nur waagerechtes Wischen dreht.
        .simultaneousGesture(
            DragGesture(minimumDistance: 6)
                .onChanged { g in
                    if stehend { return }
                    if ziehStart == nil {
                        guard abs(g.translation.width) > abs(g.translation.height) else { return }
                        drehAufgabe?.cancel()
                        ziehStart = pos
                    }
                    if let start = ziehStart { pos = start + Double(g.translation.width) / 9 }
                }
                .onEnded { _ in
                    // von Hand gedreht: bleibt stehen, wo der Fahrer loslaesst
                    if ziehStart != nil { pos = pos.rounded() }
                    ziehStart = nil
                }
        )
        .task(id: satz) { await laden() }
        .onDisappear { drehAufgabe?.cancel() }
        .allowsHitTesting(!stehend)
        .accessibilityLabel(stehend ? "Fahrzeug" : "Fahrzeug, zum Drehen wischen")
        // stehend (Startseiten-Karte): Tippen geht an die Karte
    }

    /// Endstellung: Bild 32 fuellt die Flaeche. Beim Drehen herauszoomen, damit Seite und Heck ganz zu sehen sind.
    private func lage(_ info: DrehInfo, _ g: CGSize) -> (s: CGFloat, x: CGFloat, y: CGFloat) {
        let b = info.endbox
        let bw = b[2] - b[0], bh = b[3] - b[1]
        let sE = min(g.width / bw, g.height / bh)
        let xE = (g.width - bw * sE) / 2 - b[0] * sE
        let yE = (g.height - bh * sE) / 2 - b[1] * sE
        let sA = min(g.width / info.breite, g.height / info.hoehe)
        let xA = (g.width - info.breite * sA) / 2
        let yA = (g.height - info.hoehe * sA) / 2
        let n = Double(info.bilder)
        let d = (((pos - Double(info.start)).truncatingRemainder(dividingBy: n)) + n).truncatingRemainder(dividingBy: n)
        var w = CGFloat(min(min(d, n - d) / 4, 1))
        w = w * w * (3 - 2 * w)
        return (sE + (sA - sE) * w, xE + (xA - xE) * w, yE + (yA - yE) * w)
    }

    private func laden() async {
        guard let info else { return }
        pos = Double(info.start)
        let s = satz
        if stehend {
            // nur das Standbild, keine Drehung
            if let b = s.bild(info.start)?.preparingForDisplay() {
                bilder = Array(repeating: b, count: info.bilder)
            }
            return
        }
        let geladen = await Task.detached(priority: .userInitiated) {
            (0..<info.bilder).compactMap { s.bild($0)?.preparingForDisplay() }
        }.value
        guard geladen.count == info.bilder else { return }
        bilder = geladen
        drehen()
    }

    /// einmal ganz herum und in der Endstellung aufhoeren
    private func drehen() {
        guard let info else { return }
        drehAufgabe?.cancel()
        let n = info.bilder
        let von = pos
        let r = Int(von.rounded())
        let nach = Double(r + (((info.start - r) % n) + n) % n + n)
        drehAufgabe = Task { @MainActor in
            let t0 = Date()
            let dauer = 1.7
            while !Task.isCancelled {
                let q = min(Date().timeIntervalSince(t0) / dauer, 1)
                let e = 1 - pow(1 - q, 3)
                pos = von + (nach - von) * e
                if q >= 1 { break }
                try? await Task.sleep(nanoseconds: 16_000_000)
            }
        }
    }
}
