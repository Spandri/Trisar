import SwiftUI
import UIKit

/// Hauptansicht nach der Planung: alle Tage des Einsatzes (EinsatzplanungUebersicht.jsx,
/// Figma 2571:12781 und 2596:12648). Karten wischen (kippen raeumlich weg, rasten mit Feder ein),
/// als letzte Karte der ganze Einsatz, Tipp auf eine Tageskarte oeffnet den Tag, jede Karte
/// laesst sich als Bild teilen, "Neue Planung" fuehrt in den Kalender.
struct EinsatzUebersichtAnsicht: View {
    let tage: [String]
    let vorschlaegeJeTag: [String: [EinsatzVorschlag]]
    let startIndex: Int
    let zurueck: () -> Void
    let neuePlanung: () -> Void
    let tagOeffnen: (Int) -> Void

    @State private var lage: Double
    @State private var zugStart: Double?
    @State private var waagerecht: Bool?
    @State private var teilBild: EinsatzTeilBild?

    private static let tagesKarteOben: CGFloat = 127
    private static let gesamtKarteOben: CGFloat = 159
    private static let wischOben: CGFloat = 100

    init(tage: [String], vorschlaegeJeTag: [String: [EinsatzVorschlag]], startIndex: Int,
         zurueck: @escaping () -> Void, neuePlanung: @escaping () -> Void, tagOeffnen: @escaping (Int) -> Void) {
        self.tage = tage
        self.vorschlaegeJeTag = vorschlaegeJeTag
        self.startIndex = startIndex
        self.zurueck = zurueck
        self.neuePlanung = neuePlanung
        self.tagOeffnen = tagOeffnen
        _lage = State(initialValue: Double(max(0, min(startIndex, tage.count))))
    }

    private var letzte: Int { tage.count }
    private var aktiv: Int { max(0, min(letzte, Int(lage.rounded()))) }
    private var tagesTitel: [String] { tage.map { EinsatzUhr.tagKurz($0) } }
    private var gesamtTitel: String {
        guard let a = tage.first, let b = tage.last else { return "" }
        let von = EinsatzUhr.format(a, "d. MMM"), bis = EinsatzUhr.format(b, "d. MMM")
        return tage.count > 1 ? "\(von) – \(bis)" : von
    }
    private var tagesWallets: [EinsatzWallet] { tage.map { EinsatzWallet.werte(vorschlaegeJeTag[$0] ?? []) } }
    private var gesamtWallet: EinsatzWallet { EinsatzWallet.werte(tage.flatMap { vorschlaegeJeTag[$0] ?? [] }) }

    var body: some View {
        let gesamtAktiv = aktiv == letzte
        ZStack(alignment: .topLeading) {
            EinsatzHintergrund()
            Leinwand(basisHoehe: 873, mitHintergrund: false) { _ in
                ZStack(alignment: .topLeading) {
                    karussell.platz(0, Self.wischOben, 402, 500)

                    ZurueckKnopf(aktion: zurueck).platz(20, 40, 50, 50)
                    Button(action: teilen) {
                        ZStack(alignment: .topLeading) {
                            Image("teilen_pfeil").resizable().platz(18, 12, 13, 17)
                            Image("teilen_schale").resizable().platz(15, 23, 19, 14)
                        }
                        .frame(width: 50, height: 50, alignment: .topLeading).contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(gesamtAktiv ? "Einsatz als Bild teilen" : "Planung für \(aktiv < tagesTitel.count ? tagesTitel[aktiv] : "") als Bild teilen")
                    .platz(324, 40, 50, 50)

                    punkte.mittig(201, gesamtAktiv ? 568 : 580, CGFloat(letzte) * 17 + 7, 7)
                        .animation(.timingCurve(0.22, 1, 0.36, 1, duration: 0.42), value: gesamtAktiv)

                    Button(action: neuePlanung) {
                        Text("Neue Planung").font(.grotesk(24, .bold)).tracking(-0.5).foregroundStyle(EinsatzFarbe.lime).fixedSize()
                            .frame(width: 178, height: 51)
                            .overlay(Rectangle().strokeBorder(EinsatzFarbe.lime, lineWidth: 2)).contentShape(Rectangle())
                    }
                    .buttonStyle(.plain).platz(112, 629, 178, 51)
                }
            }
        }
        .sheet(item: $teilBild) { b in EinsatzTeilen(bild: b.bild).ignoresSafeArea() }
    }

    // MARK: Karussell

    private var karussell: some View {
        ZStack(alignment: .topLeading) {
            Color.clear
            ForEach(0...letzte, id: \.self) { i in
                let d = Double(i) - lage
                let ad = min(abs(d), 1.4)
                Group {
                    if i < letzte {
                        Button { tagOeffnen(i) } label: {
                            TagesWalletKarte(titel: tagesTitel[i], wallet: tagesWallets[i]).contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("Planung für \(tagesTitel[i]) öffnen")
                    } else {
                        GesamtWalletKarte(titel: gesamtTitel, wallet: gesamtWallet)
                    }
                }
                .scaleEffect(1 - ad * 0.16 - ad * 0.03)
                .rotation3DEffect(.degrees(-(d == 0 ? 0 : (d > 0 ? 1 : -1)) * ad * 38), axis: (x: 0, y: 1, z: 0), perspective: 0.6)
                .offset(x: d * 402)
                .opacity(abs(d) > 1.35 ? 0 : max(0, 1 - ad * 0.45))
                .zIndex(100 - abs(d) * 10)
                .platz(20, (i < letzte ? Self.tagesKarteOben : Self.gesamtKarteOben) - Self.wischOben, 362,
                       i < letzte ? TagesWalletKarte.hoehe : GesamtWalletKarte.hoehe)
            }
        }
        .frame(width: 402, height: 500, alignment: .topLeading)
        .contentShape(Rectangle())
        .simultaneousGesture(
            DragGesture(minimumDistance: 6)
                .onChanged { w in
                    if waagerecht == nil { waagerecht = abs(w.translation.width) >= abs(w.translation.height) }
                    guard waagerecht == true else { return }
                    let start = zugStart ?? lage
                    zugStart = start
                    var pos = start - Double(w.translation.width) / 402
                    // Am Anfang und Ende gibt die Bahn nur widerwillig nach.
                    if pos < 0 { pos = -(1 - 1 / (1 - pos * 0.9)) * 0.35 }
                    if pos > Double(letzte) { pos = Double(letzte) + (1 - 1 / (1 + (pos - Double(letzte)) * 0.9)) * 0.35 }
                    lage = pos
                }
                .onEnded { w in
                    defer { zugStart = nil; waagerecht = nil }
                    guard waagerecht == true, let start = zugStart else { return }
                    let tempo = -Double(w.velocity.width) / 402
                    var ziel = Int((lage + tempo * 0.18).rounded())
                    let s = Int(start.rounded())
                    ziel = max(s - 1, min(s + 1, ziel))
                    zuKarte(ziel)
                }
        )
    }

    private func zuKarte(_ i: Int) {
        withAnimation(.interpolatingSpring(stiffness: 240, damping: 2 * sqrt(240) * 0.78)) {
            lage = Double(max(0, min(letzte, i)))
        }
    }

    private var punkte: some View {
        ZStack(alignment: .topLeading) {
            ForEach(0...letzte, id: \.self) { i in
                Button { zuKarte(i) } label: {
                    Circle().fill(EinsatzFarbe.lime).opacity(i == aktiv ? 1 : 0.25).scaleEffect(i == aktiv ? 1.15 : 1)
                        .frame(width: 7, height: 7).frame(width: 17, height: 23).contentShape(Rectangle())
                        .animation(.easeInOut(duration: 0.26), value: aktiv)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(i == letzte ? "Gesamter Einsatz" : "Tag \(i + 1)")
                .platz(CGFloat(i) * 17 - 5, -8, 17, 23)
            }
        }
        .frame(width: CGFloat(letzte) * 17 + 7, height: 7, alignment: .topLeading)
    }

    // MARK: Teilen

    /// Bildschirm mit Hintergrund und Karte an ihrer Stelle, ohne Knoepfe, Punkte und Leiste.
    @MainActor private func teilen() {
        let i = aktiv
        let gesamt = i == letzte
        let inhalt = ZStack(alignment: .topLeading) {
            EinsatzHintergrund()
            Group {
                if gesamt {
                    GesamtWalletKarte(titel: gesamtTitel, wallet: gesamtWallet).platz(20, Self.gesamtKarteOben)
                } else {
                    TagesWalletKarte(titel: tagesTitel[i], wallet: tagesWallets[i]).platz(20, Self.tagesKarteOben)
                }
            }
        }
        .frame(width: 402, height: 873, alignment: .topLeading)
        .environment(\.colorScheme, .dark)
        let r = ImageRenderer(content: inhalt)
        r.scale = 3
        if let bild = r.uiImage { teilBild = EinsatzTeilBild(bild: bild) }
    }
}

struct EinsatzTeilBild: Identifiable {
    let id = UUID()
    let bild: UIImage
}

/// Teilen-Dialog des Systems (navigator.share im Web).
private struct EinsatzTeilen: UIViewControllerRepresentable {
    let bild: UIImage
    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: [bild], applicationActivities: nil)
    }
    func updateUIViewController(_ vc: UIActivityViewController, context: Context) {}
}
