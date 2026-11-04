import SwiftUI

/// Nachbau von AnsprechpartnerView.jsx im Live-Betrieb: eine Kontaktkarte „TRISAR Disposition“
/// an der Stelle der Hotline (top 242), dunkler Bereich ab 221, Titel „Support“ bei 140.
struct SupportAnsicht: View {
    var zurueck: () -> Void
    @Environment(\.openURL) private var oeffnen

    private let karteOben: CGFloat = 242
    private let karteHoehe: CGFloat = 543
    private var gesamt: CGFloat { karteOben + karteHoehe + 30 + 40 + 1 }

    var body: some View {
        Leinwand(basisHoehe: gesamt, inhaltHoehe: gesamt, mitHintergrund: false) { rahmen in
            ZStack(alignment: .topLeading) {
                CSSRadial(rx: 1.4142, ry: 2.0732, stopps: [
                    (0x313701, 0), (0x191C00, 0.2283), (0x0C0E00, 0.3424), (0x000000, 0.45659), (0x000000, 1),
                ])
                .frame(width: 402, height: max(gesamt, rahmen))

                UnevenRoundedRectangle(topLeadingRadius: 12, topTrailingRadius: 12)
                    .fill(Color(hex: 0x1A1A1A))
                    .platz(0, 221, 402, max(gesamt, rahmen) - 221)

                ZurueckKnopf(aktion: zurueck).platz(20, 60, 50, 50)

                WebText(text: "Support", groesse: 42, gewicht: .bold, zeilenHoehe: 42, abstand: -0.5, farbe: UIColor(hex: 0xE2F754))
                    .fixedSize().platz(20, 140)

                KontaktKarte(
                    name: "TRISAR Disposition",
                    rolle: "Schichtplanung & Disposition",
                    beschreibung: "Verantwortlich für Schichten und Disposition: Einsatzzeiten, Schichttausch, Pausen und kurzfristige Ausfälle.",
                    zeiten: "",
                    email: "team@trisar.de",
                    telefon: nil
                ) { url in oeffnen(url) }
                .platz(20, karteOben, 362, karteHoehe)
            }
        }
        .overlay { FussleisteUnten() }
    }
}

/// ContactCard: weisse Karte 362 x 543, Foto-Feld mit Initialen, Name, Rolle, Zeiten, Mail,
/// Knopf „Get in touch“ (Telefon, ohne Nummer Mail).
private struct KontaktKarte: View {
    let name: String
    let rolle: String
    let beschreibung: String
    let zeiten: String
    let email: String
    let telefon: String?
    let oeffnen: (URL) -> Void

    var body: some View {
        let initialen = name.split(separator: " ").compactMap(\.first).map(String.init).joined()
        ZStack(alignment: .topLeading) {
            Color.white
            Text(initialen).grotesk(48, .bold).foregroundStyle(Color(hex: 0x6B7280))
                .frame(width: 338, height: 244).background(Color(hex: 0xD9D9D9))
                .platz(12, 12, 338, 244)
            Text(name).grotesk(30, .bold, abstand: 0.5).foregroundStyle(.black).platz(11, 279)
            (Text(rolle + "\n").foregroundColor(.black) + Text(beschreibung).foregroundColor(Color(hex: 0x9A9A9A)))
                .font(.grotesk(12, .bold)).tracking(0.5)
                .lineSpacing(16 - 12 * 1.276 > 0 ? 16 - 12 * 1.276 : 0)
                .fixedSize(horizontal: false, vertical: true)
                .platz(12, 317, 338, nil)
            if !zeiten.isEmpty {
                Text(zeiten).grotesk(18, .bold, abstand: 0.5).foregroundStyle(.black).platz(13, 386)
            }
            Text(email).grotesk(18, .bold, abstand: 0.5).foregroundStyle(.black).platz(12, 408)
            Button {
                if let t = telefon, let url = URL(string: "tel:\(t)") { oeffnen(url) }
                else if let url = URL(string: "mailto:\(email)") { oeffnen(url) }
            } label: {
                HStack(spacing: 10) {
                    Text("Get in touch").grotesk(24, .bold, abstand: -0.5).foregroundStyle(.black)
                    Image(systemName: telefon == nil ? "envelope.fill" : "phone.fill")
                        .font(.system(size: 20)).foregroundStyle(.black)
                        .frame(width: 35, height: 35)
                }
                .frame(width: 338, height: 56)
                .background(Color(hex: 0xE3F654))
            }
            .buttonStyle(.plain)
            .platz(12, 457, 338, 56)
        }
        .frame(width: 362, height: 543)
    }
}

/// CSS radial-gradient(rx% ry% at 0% 0%, ...) ueber die ganze Flaeche.
struct CSSRadial: View {
    let rx: CGFloat
    let ry: CGFloat
    let stopps: [(UInt32, CGFloat)]
    var body: some View {
        Canvas { k, g in
            k.fill(Path(CGRect(origin: .zero, size: g)), with: .color(.black))
            var e = k
            e.scaleBy(x: g.width * rx, y: g.height * ry)
            e.fill(Path(CGRect(x: -1, y: -1, width: 2, height: 2)),
                   with: .radialGradient(Gradient(stops: stopps.map { .init(color: Color(hex: $0.0), location: $0.1) }),
                                         center: .zero, startRadius: 0, endRadius: 1))
        }
    }
}
