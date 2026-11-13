import SwiftUI
import UIKit

/// 360-Grad-Ansicht des Fahrzeugs aus 36 Einzelbildern vom Server (fahrer.trisar.de/fahrzeug-dreh/,
/// erzeugt mit werkzeuge/fahrzeugbilder), wie FahrzeugDrehung.jsx der Web-App.
/// Beim Oeffnen dreht sich das Auto einmal und bleibt schraeg vorne links stehen (Bild 32, eng
/// zugeschnitten wie das Standbild). Von Hand gedreht bleibt es dort, wo der Fahrer loslaesst.
/// Mit stehend: nur Bild 32 wie das Standbild (Startseiten-Karte), ohne Drehen und Wischen.

/// Inhalt von fahrzeug-dreh.json. breite/hoehe/endbox oben sind die alten gemeinsamen Werte,
/// neuere Listen haben sie je Modell.
struct DrehInfo: Decodable, Equatable {
    struct Lack: Decodable, Hashable { let code: String; let name: String; let hex: String }
    struct Modell: Decodable, Equatable {
        let id: String
        var marke: String?
        var name: String?
        let modell: [String]
        let farben: [[String]]
        let lacke: [String]
        var lackliste: [Lack]?
        var breite: CGFloat?
        var hoehe: CGFloat?
        var endbox: [CGFloat]?
    }
    let bilder: Int
    let start: Int
    var seite: Int?
    var breite: CGFloat?
    var hoehe: CGFloat?
    var endbox: [CGFloat]?
    let modelle: [Modell]

    /// Ablage auf dem Server: Liste, Bilder <modell>-<lack>-NN.webp und <modell>-<lack>-seite.webp.
    static let basis = URL(string: "https://fahrer.trisar.de/fahrzeug-dreh/")!

    /// Modell mit dem laengsten Modellwort, das in brand_model steckt ("sklasselang" vor "sklasse").
    func modell(zu markeModell: String) -> Modell? {
        let m = DrehSatz.glatt(markeModell)
        guard !m.isEmpty else { return nil }
        var bestes: Modell?
        var laenge = 0
        for kandidat in modelle {
            for w in kandidat.modell where w.count > laenge && m.contains(w) {
                bestes = kandidat
                laenge = w.count
            }
        }
        return bestes
    }

    /// Lack-Code zur Farbe (Freitext): erstes Farbwort der Liste (nach Laenge sortiert), das vorkommt
    /// und zu dem es Bilder gibt.
    func lack(_ modell: Modell, farbe: String) -> String? {
        let f = DrehSatz.glatt(farbe)
        guard !f.isEmpty,
              let treffer = modell.farben.first(where: { $0.count == 2 && f.contains($0[0]) }),
              modell.lacke.contains(treffer[1]) else { return nil }
        return treffer[1]
    }
}

/// Fahrzeugkatalog (fahrzeug-dreh.json). Beim Start sofort der zuletzt geladene Stand aus Caches,
/// sonst die mitgelieferte Liste. Danach einmal vom Server holen, bei Aenderung neu zeichnen.
@MainActor
final class DrehKatalog: ObservableObject {
    static let shared = DrehKatalog()
    @Published private(set) var info: DrehInfo?

    private let ablage: URL? = {
        guard let caches = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first else { return nil }
        let ordner = caches.appendingPathComponent("FahrzeugDreh", isDirectory: true)
        try? FileManager.default.createDirectory(at: ordner, withIntermediateDirectories: true)
        return ordner.appendingPathComponent("fahrzeug-dreh.json")
    }()
    private var laedt = false

    private init() {
        if let ablage, let daten = try? Data(contentsOf: ablage), let i = try? JSONDecoder().decode(DrehInfo.self, from: daten) {
            info = i
        } else if let url = Bundle.main.url(forResource: "fahrzeug-dreh", withExtension: "json"),
                  let daten = try? Data(contentsOf: url) {
            info = try? JSONDecoder().decode(DrehInfo.self, from: daten)
        }
        aktualisieren()
    }

    /// Liste vom Server holen. Kaputte Antwort (z. B. HTML-Fehlerseite) laesst den alten Stand stehen.
    func aktualisieren() {
        guard !laedt else { return }
        laedt = true
        Task {
            defer { laedt = false }
            var anfrage = URLRequest(url: DrehInfo.basis.appendingPathComponent("fahrzeug-dreh.json"))
            anfrage.cachePolicy = .reloadIgnoringLocalCacheData
            anfrage.timeoutInterval = 20
            guard let (daten, antwort) = try? await URLSession.shared.data(for: anfrage),
                  (antwort as? HTTPURLResponse)?.statusCode == 200,
                  let neu = try? JSONDecoder().decode(DrehInfo.self, from: daten) else { return }
            if let ablage { try? daten.write(to: ablage, options: .atomic) }
            if neu != info { info = neu }
        }
    }
}

/// Bilder vom Server mit Platten-Cache (Caches/FahrzeugDreh) und Speicher-Cache.
/// Gleiche Datei wird nur einmal gleichzeitig geladen.
actor DrehBilder {
    static let shared = DrehBilder()

    private let ordner: URL? = {
        guard let caches = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first else { return nil }
        let o = caches.appendingPathComponent("FahrzeugDreh", isDirectory: true)
        try? FileManager.default.createDirectory(at: o, withIntermediateDirectories: true)
        return o
    }()
    /// fertig dekodierte Bilder, ca. zwei Saetze
    private let speicher: NSCache<NSString, UIImage> = {
        let c = NSCache<NSString, UIImage>()
        c.totalCostLimit = 80 * 1024 * 1024
        return c
    }()
    private var laufend: [String: Task<UIImage?, Never>] = [:]

    /// Dateiname auf dem Server, z. B. "s-klasse-obsidianschwarz-metallic-32.webp"
    func bild(_ name: String) async -> UIImage? {
        if let b = speicher.object(forKey: name as NSString) { return b }
        if let t = laufend[name] { return await t.value }
        let ziel = ordner?.appendingPathComponent(name)
        let t = Task.detached(priority: .userInitiated) { () -> UIImage? in
            if let ziel, let daten = try? Data(contentsOf: ziel), let b = UIImage(data: daten) {
                return b.preparingForDisplay() ?? b
            }
            var anfrage = URLRequest(url: DrehInfo.basis.appendingPathComponent(name))
            anfrage.timeoutInterval = 30
            // Fehlende Datei liefert der Server als HTML-Seite mit 200: nur echte Bilder behalten.
            guard let (daten, antwort) = try? await URLSession.shared.data(for: anfrage),
                  (antwort as? HTTPURLResponse)?.statusCode == 200,
                  let b = UIImage(data: daten) else { return nil }
            if let ziel { try? daten.write(to: ziel, options: .atomic) }
            return b.preparingForDisplay() ?? b
        }
        laufend[name] = t
        let b = await t.value
        laufend[name] = nil
        if let b { speicher.setObject(b, forKey: name as NSString, cost: Int(b.size.width * b.size.height * b.scale * b.scale * 4)) }
        return b
    }
}

/// Passender Bildsatz zu brand_model und color (Freitext), mit Bildgroesse und Endstellung des Modells.
struct DrehSatz: Equatable {
    let modell: String
    let lack: String
    let bilder: Int
    let start: Int
    let breite: CGFloat
    let hoehe: CGFloat
    let endbox: [CGFloat]

    /// klein, Umlaute ausgeschrieben, nur Buchstaben und Ziffern: "V-Klasse 250 d" -> "vklasse250d"
    static func glatt(_ s: String) -> String {
        let klein = s.lowercased()
            .replacingOccurrences(of: "ä", with: "ae").replacingOccurrences(of: "ö", with: "oe")
            .replacingOccurrences(of: "ü", with: "ue").replacingOccurrences(of: "ß", with: "ss")
        return String(klein.unicodeScalars.filter { ("a"..."z").contains($0) || ("0"..."9").contains($0) }.map(Character.init))
    }

    @MainActor static func finden(modell: String, farbe: String) -> DrehSatz? {
        guard let info = DrehKatalog.shared.info,
              let m = info.modell(zu: modell),
              let lack = info.lack(m, farbe: farbe) else { return nil }
        // Bildgroesse und Endstellung je Modell (aeltere Liste: gemeinsame Werte)
        guard let breite = m.breite ?? info.breite, let hoehe = m.hoehe ?? info.hoehe,
              let endbox = m.endbox ?? info.endbox, endbox.count == 4, info.bilder > 0 else { return nil }
        return DrehSatz(modell: m.id, lack: lack, bilder: info.bilder, start: info.start,
                        breite: breite, hoehe: hoehe, endbox: endbox)
    }

    func name(_ i: Int) -> String { "\(modell)-\(lack)-\(String(format: "%02d", i)).webp" }

    func bild(_ i: Int) async -> UIImage? { await DrehBilder.shared.bild(name(i)) }
}

struct FahrzeugDrehung: View {
    let satz: DrehSatz
    var stehend = false

    @State private var bilder: [UIImage] = []
    @State private var pos: Double = 32
    @State private var ziehStart: Double?
    @State private var drehAufgabe: Task<Void, Never>?

    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .topLeading) {
                if !bilder.isEmpty {
                    let n = bilder.count
                    let f = ((Int(pos.rounded()) % n) + n) % n
                    let t = lage(geo.size)
                    Image(uiImage: bilder[f])
                        .resizable()
                        .frame(width: satz.breite, height: satz.hoehe)
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
    private func lage(_ g: CGSize) -> (s: CGFloat, x: CGFloat, y: CGFloat) {
        let b = satz.endbox
        let bw = b[2] - b[0], bh = b[3] - b[1]
        let sE = min(g.width / bw, g.height / bh)
        let xE = (g.width - bw * sE) / 2 - b[0] * sE
        let yE = (g.height - bh * sE) / 2 - b[1] * sE
        let sA = min(g.width / satz.breite, g.height / satz.hoehe)
        let xA = (g.width - satz.breite * sA) / 2
        let yA = (g.height - satz.hoehe * sA) / 2
        let n = Double(satz.bilder)
        let d = (((pos - Double(satz.start)).truncatingRemainder(dividingBy: n)) + n).truncatingRemainder(dividingBy: n)
        var w = CGFloat(min(min(d, n - d) / 4, 1))
        w = w * w * (3 - 2 * w)
        return (sE + (sA - sE) * w, xE + (xA - xE) * w, yE + (yA - yE) * w)
    }

    private func laden() async {
        let s = satz
        drehAufgabe?.cancel()
        pos = Double(s.start)
        if stehend {
            // nur das Standbild, keine Drehung
            if let b = await s.bild(s.start), !Task.isCancelled {
                bilder = Array(repeating: b, count: s.bilder)
            }
            return
        }
        // alle Ansichten parallel vorladen (aus dem Cache sofort), erst dann einmal drehen
        let geladen = await withTaskGroup(of: (Int, UIImage?).self) { gruppe in
            for i in 0..<s.bilder { gruppe.addTask { (i, await s.bild(i)) } }
            var liste = [UIImage?](repeating: nil, count: s.bilder)
            for await (i, b) in gruppe { liste[i] = b }
            return liste.compactMap { $0 }
        }
        guard !Task.isCancelled, geladen.count == s.bilder else { return }
        bilder = geladen
        drehen()
    }

    /// einmal ganz herum und in der Endstellung aufhoeren
    private func drehen() {
        drehAufgabe?.cancel()
        let n = satz.bilder
        let start = satz.start
        let von = pos
        let r = Int(von.rounded())
        let nach = Double(r + (((start - r) % n) + n) % n + n)
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
