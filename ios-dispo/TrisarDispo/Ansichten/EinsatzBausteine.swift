import SwiftUI

// Gemeinsame Bausteine der Einsatzplanung: Hintergrund, Tagesdiagramm (EinsatzDiagramm.jsx)
// und Wallet-Karten (EinsatzWalletKarte.jsx).

enum EinsatzFarbe {
    static let lime = Color(hex: 0xE3F654)
    static let titel = Color(hex: 0xE2F754)
    static let trenner = Color(hex: 0xE3F754)
    static let gruen = Color(hex: 0x59BE80)
    static let rot = Color(hex: 0xFF6F63)
    static let blau = Color(hex: 0x0059FF)
}

/// Hintergrund von Kalender, Bedarf, Tagesplanung und Uebersicht: SVG 402 x 873 (gestreckt),
/// radialGradient r=10, matrix(43.25 96.3 -44.344 19.869 0 0): oben links Lime, unten rechts Blau.
struct EinsatzHintergrund: View {
    var body: some View {
        Canvas { k, g in
            let sx = g.width / 402, sy = g.height / 873
            k.fill(Path(CGRect(origin: .zero, size: g)), with: .color(.black))
            var v = k
            v.concatenate(CGAffineTransform(a: 43.25 * sx, b: 96.3 * sy, c: -44.344 * sx, d: 19.869 * sy, tx: 0, ty: 0))
            func c(_ r: Double, _ gr: Double, _ b: Double) -> Color { Color(red: r / 255, green: gr / 255, blue: b / 255) }
            v.fill(Path(CGRect(x: -200, y: -200, width: 400, height: 400)), with: .radialGradient(
                Gradient(stops: [
                    .init(color: c(49, 55, 1), location: 0), .init(color: c(25, 28, 0), location: 0.2283),
                    .init(color: c(12, 14, 0), location: 0.34244), .init(color: .black, location: 0.45659),
                    .init(color: .black, location: 0.6782), .init(color: c(0, 6, 16), location: 0.69832),
                    .init(color: c(0, 11, 32), location: 0.71843), .init(color: c(0, 22, 64), location: 0.75865),
                    .init(color: c(0, 33, 96), location: 0.79888), .init(color: c(0, 45, 128), location: 0.8391),
                    .init(color: c(0, 67, 191), location: 0.91955), .init(color: c(0, 89, 255), location: 1),
                ]), center: .zero, startRadius: 0, endRadius: 10))
        }
        .ignoresSafeArea()
    }
}

/// Text mittig auf einer y-Linie (CSS -translate-y-1/2), links ab x.
struct EinsatzZeile: View {
    let text: String
    var groesse: CGFloat = 12
    var gewicht: Font.Weight = .medium
    var abstand: CGFloat = 0.5
    var farbe: Color = EinsatzFarbe.lime
    var body: some View {
        Text(text).font(.grotesk(groesse, gewicht)).tracking(abstand).foregroundStyle(farbe).lineLimit(1).fixedSize()
    }
}

// MARK: - Tagesdiagramm

/// Legende, Raster mit vier Abschnitten, Fahrer als Balken, Bedarf (weiss, Punkte lime/rot),
/// gebuchte Fahrten (blau), 20 Stunden ab 06:00. `oben` = y-Mitte der Legende (Tagesplanung 194).
struct EinsatzDiagramm: View {
    var oben: CGFloat = 194
    let bedarf: [Int]
    let gebucht: [Int]
    let fahrer: [Int]
    var bedarfBasis: [Int]? = nil
    var ziehbar = false
    var beiBedarf: (Int, Int) -> Void = { _, _ in }

    @State private var ziehIndex: Int?
    @State private var festSchritt: Int?
    @State private var anzeigeMax: Double = 0

    private static let ueber: CGFloat = 220   // Platz nach oben, falls ein Punkt ueber das Raster gezogen wird

    private var schritt: Int {
        festSchritt ?? {
            let spitze = max((bedarf + gebucht + fahrer).max() ?? 0, 4)
            let roh = Double(max(1, spitze)) / 4
            return [1, 2, 5, 10, 20, 25, 50, 100].first { Double($0) >= roh } ?? Int((roh / 100).rounded(.up)) * 100
        }()
    }
    private var zielMax: Int { schritt * 4 }
    private func slotMitte(_ i: Int) -> CGFloat { 66 + CGFloat(i) * 16 + 6 }
    private func wertY(_ v: Double) -> CGFloat {
        let m = anzeigeMax > 0 ? anzeigeMax : Double(zielMax)
        return 440 - CGFloat(v / m) * 200
    }

    var body: some View {
        let versatz = oben - 194
        ZStack(alignment: .topLeading) {
            legende
            Canvas { k, _ in zeichnen(k) }
                .frame(width: 402, height: 470 + Self.ueber)
                .allowsHitTesting(false)
                .platz(0, versatz - Self.ueber)
            if ziehbar {
                Color.clear.contentShape(Rectangle())
                    .frame(width: 336, height: 470 + Self.ueber - 12)
                    .platz(58, versatz - Self.ueber)
                    .gesture(DragGesture(minimumDistance: 0, coordinateSpace: .named("einsatz-diagramm"))
                        .onChanged(ziehen).onEnded { _ in ziehIndex = nil; festSchritt = nil })
            }
        }
        .coordinateSpace(name: "einsatz-diagramm")
        .onAppear { if anzeigeMax == 0 { anzeigeMax = Double(zielMax) } }
        .task(id: zielMax) { await skalaGleiten(zu: Double(zielMax)) }
    }

    /// Angezeigte Skala gleitet zur Zielskala (380 ms, ease-out), statt zu springen.
    private func skalaGleiten(zu ziel: Double) async {
        let von = anzeigeMax == 0 ? ziel : anzeigeMax
        guard von != ziel else { anzeigeMax = ziel; return }
        let beginn = Date()
        while !Task.isCancelled {
            let f = min(1, Date().timeIntervalSince(beginn) / 0.38)
            anzeigeMax = von + (ziel - von) * (1 - pow(1 - f, 3))
            if f >= 1 { break }
            try? await Task.sleep(for: .milliseconds(16))
        }
    }

    private func ziehen(_ w: DragGesture.Value) {
        // Koordinaten im Raum des Diagramms; das SVG beginnt bei oben - 194.
        let svgY = w.location.y - (oben - 194)
        if ziehIndex == nil {
            let x = w.startLocation.x
            let i = Int(((x - 72) / 16).rounded())
            guard i >= 0, i < bedarf.count, abs(x - slotMitte(i)) <= 9 else { return }
            let oberkante = min(240, wertY(Double(bedarf[i]))) - 14
            guard w.startLocation.y - (oben - 194) >= oberkante else { return }
            festSchritt = schritt
            ziehIndex = i
        }
        guard let i = ziehIndex else { return }
        let skala = Double((festSchritt ?? schritt) * 4)
        let roh = Int(((440 - svgY) / 200 * skala).rounded())
        let wert = max(0, min(999, roh))
        if wert != bedarf[i] { beiBedarf(i, wert) }
    }

    private var legende: some View {
        ZStack(alignment: .topLeading) {
            EinsatzZeile(text: "Fahrer").frame(height: 16).platz(16, oben - 8)
            Rectangle().fill(EinsatzFarbe.gruen).platz(66, oben - 6, 12, 12)
            EinsatzZeile(text: "Bedarf Fahrer").frame(height: 16).platz(102, oben - 8)
            Circle().fill(EinsatzFarbe.lime).overlay(Circle().strokeBorder(.black, lineWidth: 1)).platz(195, oben - 6, 12, 12)
            Circle().fill(EinsatzFarbe.rot).overlay(Circle().strokeBorder(.black, lineWidth: 1)).platz(219, oben - 6, 12, 12)
            EinsatzZeile(text: "Gebuchte Fahrten").frame(height: 16).platz(253, oben - 8)
            Rectangle().fill(EinsatzFarbe.blau).platz(370, oben - 1, 9, 2)
        }
    }

    private func zeichnen(_ k: GraphicsContext) {
        let u = Self.ueber
        let lime = EinsatzFarbe.lime
        let m = zielMax
        for i in 0...4 {
            var p = Path()
            p.move(to: CGPoint(x: 20, y: 240 + CGFloat(i) * 50 + 0.5 + u))
            p.addLine(to: CGPoint(x: 382, y: 240 + CGFloat(i) * 50 + 0.5 + u))
            k.stroke(p, with: .color(lime), lineWidth: 1)
            k.draw(Text("\(m - i * schritt)").font(.grotesk(16, .medium)).tracking(0.5).foregroundColor(lime),
                   at: CGPoint(x: 20, y: 228 + CGFloat(i) * 50 + u), anchor: .leading)
        }
        let anzeige = anzeigeMax > 0 ? anzeigeMax : Double(m)
        for (i, v) in fahrer.enumerated() where v > 0 {
            let h = max(12, CGFloat(min(Double(v), anzeige) / anzeige) * 200 - 3)
            k.fill(Path(CGRect(x: 66 + CGFloat(i) * 16, y: 437 - h + u, width: 12, height: h)), with: .color(EinsatzFarbe.gruen))
        }
        if let basis = bedarfBasis {
            for (i, v) in bedarf.enumerated() where i < basis.count && v != basis[i] {
                var p = Path()
                p.move(to: CGPoint(x: slotMitte(i), y: wertY(Double(basis[i])) + u))
                p.addLine(to: CGPoint(x: slotMitte(i), y: wertY(Double(v)) + u))
                k.stroke(p, with: .color(lime.opacity(0.7)), style: StrokeStyle(lineWidth: 1.5, dash: [2, 3]))
            }
        }
        func linie(_ werte: [Int], _ dx: CGFloat, _ farbe: Color) {
            var p = Path()
            for (i, v) in werte.enumerated() {
                let pt = CGPoint(x: slotMitte(i) + dx, y: wertY(Double(v)) + u)
                if i == 0 { p.move(to: pt) } else { p.addLine(to: pt) }
            }
            k.stroke(p, with: .color(farbe), lineWidth: 2)
        }
        linie(bedarf, 0.5, .white)
        linie(gebucht, -0.5, EinsatzFarbe.blau)
        for (i, v) in bedarf.enumerated() {
            let diff = bedarfBasis.map { i < $0.count ? v - $0[i] : 0 } ?? 0
            let r: CGFloat = ziehIndex == i ? 6.5 : 4.5
            let mitte = CGPoint(x: slotMitte(i), y: wertY(Double(v)) + u)
            let kreis = Path(ellipseIn: CGRect(x: mitte.x - r, y: mitte.y - r, width: 2 * r, height: 2 * r))
            k.fill(kreis, with: .color(v > (i < fahrer.count ? fahrer[i] : 0) ? EinsatzFarbe.rot : lime))
            k.stroke(kreis, with: .color(diff != 0 ? .white : .black), lineWidth: diff != 0 ? 1.5 : 1)
            if diff != 0 {
                k.draw(Text(diff > 0 ? "+\(diff)" : "−\(abs(diff))").font(.grotesk(10, .bold)).foregroundColor(lime),
                       at: CGPoint(x: mitte.x, y: diff > 0 ? mitte.y - 11 : mitte.y + 19), anchor: .bottom)
            }
        }
        for t in 0...6 {
            let x = slotMitte(t * 3) - 0.5
            var p = Path()
            p.move(to: CGPoint(x: x, y: 439.5 + u))
            p.addLine(to: CGPoint(x: x, y: 446.5 + u))
            k.stroke(p, with: .color(lime), lineWidth: 2)
            k.draw(Text(String(format: "%02d:00", (6 + t * 3) % 24)).font(.grotesk(11, .medium)).tracking(0.5).foregroundColor(lime),
                   at: CGPoint(x: x, y: 455 + u), anchor: .center)
        }
    }
}

// MARK: - Wallet-Karten

private struct WalletZeilen: View {
    let zeilen: [(String, String, String, String)]
    let labelOben: CGFloat
    let farbe: Color
    var body: some View {
        ForEach(Array(zeilen.enumerated()), id: \.offset) { nr, z in
            let y = labelOben + CGFloat(nr) * 68
            beschriftung(z.0).platz(20, y - 12, nil, 24)
            Text(z.1).font(.grotesk(22, .medium)).tracking(0.5).foregroundStyle(farbe).lineLimit(1).fixedSize().platz(20, y + 12, nil, 24)
            Group {
                if z.2 == "CO2" {
                    (Text("CO") + Text("2 ").font(.grotesk(8.385, .medium)) + Text("Verbrauch"))
                        .font(.grotesk(13, .medium)).tracking(0.5).foregroundStyle(farbe).opacity(0.4).fixedSize()
                } else {
                    beschriftung(z.2)
                }
            }
            .frame(width: 322, height: 24, alignment: .trailing).platz(20, y - 12)
            Text(z.3).font(.grotesk(22, .medium)).tracking(0.5).foregroundStyle(farbe).lineLimit(1).fixedSize()
                .frame(width: 322, height: 24, alignment: .trailing).platz(20, y + 12)
        }
    }

    private func beschriftung(_ t: String) -> some View {
        Text(t).font(.grotesk(13, .medium)).tracking(0.5).foregroundStyle(farbe).opacity(0.4).lineLimit(1).fixedSize()
    }
}

/// Tageskarte (Figma 2571:12781): Lime, Kennzahlen eines Tages, 362 x 433.
struct TagesWalletKarte: View {
    static let hoehe: CGFloat = 433
    let titel: String
    let wallet: EinsatzWallet
    var body: some View {
        ZStack(alignment: .topLeading) {
            Image("wallet").resizable().frame(width: 362, height: 433)
            Image("wallet_logo").resizable().platz(117, 26, 128.081, 19)
            Image("wallet_strich").resizable().platz(29, 78, 70.5, 1)
            Image("wallet_strich").resizable().platz(260, 78, 70.5, 1)
            Text(titel).font(.grotesk(18, .bold)).tracking(0.5).foregroundStyle(.black).lineLimit(1).fixedSize().mittig(181, 67, 300, 24, .center)
            WalletZeilen(zeilen: [
                ("Startzeit", wallet.start, "Endzeit", wallet.ende),
                ("Anzahl der Fahrer", wallet.fahrer, "Anzahl der Kunden", wallet.kunden),
                ("Ø Kunden auf Fahrer", wallet.schnitt, "Anzahl der Fahrten", wallet.fahrten),
                ("Gefahrene Km", wallet.km, "CO2", wallet.co2),
            ], labelOben: 111, farbe: .black)
            Text("inkl. MwSt.").font(.grotesk(13, .medium)).tracking(0.5).foregroundStyle(.black).opacity(0.4).fixedSize().mittig(181, 360, 300, 24, .center)
            Text(wallet.preis).font(.grotesk(32, .bold)).tracking(0.5).foregroundStyle(.black).lineLimit(1).fixedSize().mittig(181, 385, 300, 24, .center)
            Image("wallet_strich").resizable().platz(33, 396, 70.5, 1)
            Image("wallet_strich").resizable().platz(260, 396, 70.5, 1)
        }
        .frame(width: 362, height: 433, alignment: .topLeading)
    }
}

/// Gesamtkarte (Figma 2596:12648): Lime-Rahmen auf dunklem Grund, 362 x 389.
struct GesamtWalletKarte: View {
    static let hoehe: CGFloat = 389
    let titel: String
    let wallet: EinsatzWallet
    var body: some View {
        let lime = EinsatzFarbe.lime
        ZStack(alignment: .topLeading) {
            Image("gesamt_rahmen").resizable().frame(width: 362, height: 389)
            Image("gesamt_logo").resizable().platz(117, 26, 128.081, 19)
            Image("gesamt_strich_kurz").resizable().platz(32, 78, 35.5, 1)
            Image("gesamt_strich_kurz").resizable().platz(295, 78, 35.5, 1)
            Text(titel).font(.grotesk(18, .bold)).tracking(0.5).foregroundStyle(lime).lineLimit(1).fixedSize().mittig(181, 67, 300, 24, .center)
            WalletZeilen(zeilen: [
                ("Anzahl der Fahrer", wallet.fahrer, "Anzahl der Kunden", wallet.kunden),
                ("Ø Kunden auf Fahrer", wallet.schnitt, "Anzahl der Fahrten", wallet.fahrten),
                ("Gefahrene Km", wallet.km, "CO2", wallet.co2),
            ], labelOben: 129, farbe: lime)
            Text("inkl. MwSt.").font(.grotesk(13, .medium)).tracking(0.5).foregroundStyle(lime).opacity(0.4).fixedSize().mittig(181, 310, 300, 24, .center)
            Text(wallet.preis).font(.grotesk(32, .bold)).tracking(0.5).foregroundStyle(lime).lineLimit(1).fixedSize().mittig(181, 335, 300, 24, .center)
            Image("gesamt_strich").resizable().platz(33, 346, 70.5, 1)
            Image("gesamt_strich").resizable().platz(260, 346, 70.5, 1)
        }
        .frame(width: 362, height: 389, alignment: .topLeading)
    }
}

/// Seitenpunkte: 7er Punkte im 17er Abstand, aktiver voll.
struct EinsatzPunkte: View {
    let anzahl: Int
    let aktiv: Int
    var body: some View {
        ZStack(alignment: .topLeading) {
            ForEach(0..<anzahl, id: \.self) { i in
                Circle().fill(EinsatzFarbe.lime).opacity(i == aktiv ? 1 : 0.25).platz(CGFloat(i) * 17, 0, 7, 7)
            }
        }
        .frame(width: CGFloat(max(1, anzahl) - 1) * 17 + 7, height: 7, alignment: .topLeading)
    }
}
