import SwiftUI

/// radial-gradient(141.42% 102.21% at 0% 0%, #313701 0%, #000 46%) wie in Profil und Verlauf.
struct ProfilHintergrund: View {
    var body: some View {
        Canvas { k, g in
            k.fill(Path(CGRect(origin: .zero, size: g)), with: .color(.black))
            var e = k
            e.scaleBy(x: g.width * 1.4142, y: g.height * 1.0221)
            e.fill(Path(CGRect(x: -1, y: -1, width: 2, height: 2)),
                   with: .radialGradient(Gradient(stops: [
                       .init(color: Color(hex: 0x313701), location: 0),
                       .init(color: .black, location: 0.46),
                       .init(color: .black, location: 1),
                   ]), center: .zero, startRadius: 0, endRadius: 1))
        }
    }
}

/// Nachbau von ProfilFahrerView.jsx (Raster 402 x 875). Kennzahlen sind im Live-Betrieb „–“.
struct ProfilAnsicht: View {
    var zurueck: () -> Void
    var oeffneAnsprechpartner: () -> Void
    var oeffneVerlauf: () -> Void
    var oeffneEinstellungen: () -> Void
    @EnvironmentObject private var anmeldung: Anmeldung

    var body: some View {
        Leinwand(basisHoehe: 875, mitHintergrund: false) { rahmen in
            ZStack(alignment: .topLeading) {
                ProfilHintergrund().frame(width: 402, height: rahmen)

                ZurueckKnopf(aktion: zurueck).platz(20, 60, 50, 50)

                Text(anmeldung.profil?.name ?? "")
                    .font(.grotesk(48, .bold)).tracking(-0.5)
                    .foregroundStyle(Color(hex: 0xE2F754))
                    .lineLimit(1).fixedSize()
                    .platz(20, 272 - 28)

                ForEach(Array(Self.kacheln.enumerated()), id: \.offset) { _, k in
                    Rectangle().strokeBorder(Color(hex: 0xE3F654), lineWidth: 2).platz(k.x, k.y, 178, 115)
                    HStack(alignment: .lastTextBaseline, spacing: 8) {
                        Text("–").font(.grotesk(36, .medium)).tracking(0.5)
                        Text(k.einheit).font(.grotesk(16, .medium)).tracking(0.5).opacity(0.5).padding(.bottom, 2)
                    }
                    .foregroundStyle(Color(hex: 0xE3F654))
                    .fixedSize()
                    .platz(k.x + 20, k.y + 71)
                    Image("Blitz_Trisar_Icons_01_Lime").resizable().scaledToFit()
                        .frame(width: 16, height: 20).opacity(0.5)
                        .platz(k.blitzX, k.blitzY, 16, 20)
                }

                ProfilZeile(text: "Ansprechpartner", aktion: oeffneAnsprechpartner).platz(21, 589, 360, 56)
                ProfilZeile(text: "Verlauf", aktion: oeffneVerlauf).platz(21, 657, 360, 56)

                Button(action: oeffneEinstellungen) {
                    Text("Einstellungen").font(.grotesk(16, .medium)).tracking(0.5)
                        .foregroundStyle(Color(hex: 0xE3F654))
                        .frame(width: 360, height: 56)
                        .overlay(Rectangle().strokeBorder(Color(hex: 0xE3F654), lineWidth: 2))
                        .opacity(0.5)
                }
                .buttonStyle(.plain)
                .platz(21, 737, 360, 56)
            }
        }
        .overlay { FussleisteUnten() }
    }

    private struct Kachel { let x: CGFloat; let y: CGFloat; let einheit: String; let blitzX: CGFloat; let blitzY: CGFloat }
    private static let kacheln = [
        Kachel(x: 20, y: 329, einheit: "km", blitzX: 169, blitzY: 341),
        Kachel(x: 204, y: 329, einheit: "Liter", blitzX: 353, blitzY: 341),
        Kachel(x: 20, y: 450, einheit: "Fahrten", blitzX: 168, blitzY: 460.71),
        Kachel(x: 204, y: 450, einheit: "Stunden", blitzX: 353, blitzY: 462),
    ]
}

/// Lime-Zeile mit Text links (16 medium, #262626) und schwarzem Pfeil rechts.
private struct ProfilZeile: View {
    let text: String
    let aktion: () -> Void
    var body: some View {
        Button(action: aktion) {
            HStack {
                Text(text).font(.grotesk(16, .medium)).tracking(0.5).foregroundStyle(Color(hex: 0x262626))
                Spacer()
                Image("Arrow_Trisar_Icons_01").resizable().scaledToFit().frame(width: 34, height: 19.92)
            }
            .padding(.leading, 16).padding(.trailing, 12)
            .frame(width: 360, height: 56)
            .background(Color(hex: 0xE3F654))
        }
        .buttonStyle(.plain)
    }
}

/// Nachbau von Verlauf.jsx. Live gibt es noch keinen Dienst-Verlauf, dann steht der Hinweis da
/// (die Demo-Dienste der Web-App werden nicht nachgebaut).
struct VerlaufAnsicht: View {
    var zurueck: () -> Void

    var body: some View {
        Leinwand(basisHoehe: 874, inhaltHoehe: 1481 + 43, mitHintergrund: false) { _ in
            ZStack(alignment: .topLeading) {
                ProfilHintergrund().frame(width: 402, height: 1524)
                UnevenRoundedRectangle(topLeadingRadius: 12, topTrailingRadius: 12)
                    .fill(Color(hex: 0x18181B))
                    .platz(0, 218, 402, 1046)

                ZurueckKnopf(aktion: zurueck).platz(20, 60, 50, 50)

                Text("Verlauf").font(.grotesk(42, .bold)).tracking(-0.5)
                    .foregroundStyle(Color(hex: 0xE3F654))
                    .frame(height: 42).fixedSize()
                    .platz(20, 140)

                WebText(text: "Noch keine abgeschlossenen Dienste.", groesse: 16, gewicht: .medium, zeilenHoehe: 24,
                        abstand: 0.5, farbe: UIColor.white.withAlphaComponent(0.7))
                    .platz(20, 242, 362, nil)
            }
        }
        .overlay { FussleisteUnten() }
    }
}
