import SwiftUI

/// Gemeinsamer Rahmen der Planer-Unterseiten (Ereignisse, Puffer, Neuplanung): schwarzer
/// Grund mit dem Lime/Blau-Verlauf (HINTERGRUND der JSX-Dateien), fliessender Inhalt in
/// 402 Breite mit px-20 pt-40 pb-160, Zurueck-Knopf, Titel 42 und Unterzeile, eigene
/// Fusszeile darueber.
struct NebenPlanerSeite<Inhalt: View>: View {
    let titel: String
    let unterzeile: String
    let zurueck: () -> Void
    @ViewBuilder let inhalt: () -> Inhalt

    var body: some View {
        ZStack(alignment: .topLeading) {
            NebenPlanerHintergrund().ignoresSafeArea()
            FlussLeinwand {
                VStack(alignment: .leading, spacing: 0) {
                    ZurueckKnopf(aktion: zurueck).frame(width: 50, height: 50)
                    StammTitel(text: titel).padding(.top, 50)
                    Text(unterzeile).font(.grotesk(14))
                        .foregroundStyle(Color(hex: 0xE3F654, alpha: 0.5))
                        .padding(.top, 8)
                    inhalt()
                }
                .padding(.horizontal, 20)
                .padding(.top, 40)
                .padding(.bottom, 160)
                .frame(width: 402, alignment: .topLeading)
            }
            FussleisteUnten()
        }
        .background(Color.black.ignoresSafeArea())
    }
}

/// SVG 402 x 873 gestreckt, radialGradient r=10 mit matrix(43.25 96.3 -44.344 19.869 0 0):
/// Lime-Leuchten oben links, blau zum Rand.
struct NebenPlanerHintergrund: View {
    var body: some View {
        Canvas { k, g in
            let sx = g.width / 402, sy = g.height / 873
            k.fill(Path(CGRect(origin: .zero, size: g)), with: .color(.black))
            var v = k
            v.concatenate(CGAffineTransform(a: 43.25 * sx, b: 96.3 * sy, c: -44.344 * sx, d: 19.869 * sy, tx: 0, ty: 0))
            let stopps: [(Double, Double, Double, Double)] = [
                (49, 55, 1, 0), (25, 28, 0, 0.2283), (12, 14, 0, 0.34244), (0, 0, 0, 0.45659), (0, 0, 0, 0.6782),
                (0, 6, 16, 0.69832), (0, 11, 32, 0.71843), (0, 22, 64, 0.75865), (0, 33, 96, 0.79888),
                (0, 45, 128, 0.8391), (0, 67, 191, 0.91955), (0, 89, 255, 1),
            ]
            // Ausserhalb von r=10 gilt die letzte Farbe (spreadMethod pad): grosse Flaeche fuellen.
            v.fill(Path(CGRect(x: -1000, y: -1000, width: 2000, height: 2000)), with: .radialGradient(
                Gradient(stops: stopps.map { .init(color: Color(red: $0.0 / 255, green: $0.1 / 255, blue: $0.2 / 255), location: $0.3) }),
                center: .zero, startRadius: 0, endRadius: 10))
        }
    }
}

/// Knopf "Planung"-Stil mit wanderndem Farbverlauf (planen-farbe), Text links, Sparkle rechts.
struct NebenPlanenKnopf: View {
    let text: String
    let aktion: () -> Void
    @State private var winkel: Double = 22.66

    var body: some View {
        Button(action: aktion) {
            ZStack {
                LinearGradient(stops: [
                    .init(color: Color(red: 0, green: 89 / 255, blue: 1, opacity: 0.78), location: 0),
                    .init(color: Color(red: 0, green: 89 / 255, blue: 1, opacity: 0.78), location: 0.314),
                    .init(color: .black, location: 0.56),
                    .init(color: Color(hue: 66 / 360, saturation: 0.44, brightness: 0.76), location: 1.2),
                ], startPoint: .leading, endPoint: .trailing)
                .frame(width: 420, height: 420)
                .rotationEffect(.degrees(winkel))
                HStack {
                    Text(text).font(.grotesk(16, .medium)).tracking(0.5).foregroundStyle(Color(hex: 0xE3F654))
                    Spacer()
                    Image("Planen_Sparkle_Lime").resizable().frame(width: 24, height: 24)
                }
                .padding(.leading, 22).padding(.trailing, 26)
            }
            .frame(maxWidth: .infinity).frame(height: 56)
            .background(Color.black)
            .clipped()
            .overlay(Rectangle().strokeBorder(Color(hex: 0xE2F754), lineWidth: 2))
            .contentShape(Rectangle())
        }
        .buttonStyle(.web)
        .onAppear {
            withAnimation(.linear(duration: 120).repeatForever(autoreverses: false)) { winkel = 382.66 }
        }
    }
}
