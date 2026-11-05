import SwiftUI

/// Farben und Schrift wie in der Web-App (Tailwind-Werte aus fahrer/src).
enum Farbe {
    static let lime = Color(hex: 0xE3F754)        // Text/Knopf-Lime der Web-App
    static let limeIcon = Color(hex: 0xE3F654)    // Lime der Icons und Fussleiste
    static let limeHover = Color(hex: 0xD4FF28)
    static let grauText = Color(hex: 0x868786)
    static let feld = Color(hex: 0x242525)
    static let feldRand = Color(hex: 0x3A3A3A)
    static let fehler = Color(hex: 0xF87171)      // Tailwind red-400
}

extension Color {
    init(hex: UInt32, alpha: Double = 1) {
        self.init(
            .sRGB,
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255,
            opacity: alpha
        )
    }
}

extension Font {
    /// Space Grotesk wie in der Web-App (variable Schrift, Gewicht ueber .weight).
    static func grotesk(_ groesse: CGFloat, _ gewicht: Font.Weight = .regular) -> Font {
        .custom("Space Grotesk", size: groesse).weight(gewicht)
    }
}

/// Hintergrund aller Bildschirme: dunkles Lime-Leuchten oben links, sonst schwarz.
/// Exakter Nachbau von `screenBg` der Web-App: SVG 402x874 (gestreckt), radialGradient r=10
/// mit gradientTransform matrix(40.2 87.4 -40.2 18.49 0 0).
struct TrisarHintergrund: View {
    var body: some View {
        Canvas { kontext, groesse in
            let sx = groesse.width / 402
            let sy = groesse.height / 874
            kontext.fill(Path(CGRect(origin: .zero, size: groesse)), with: .color(.black))
            var verlauf = kontext
            verlauf.concatenate(CGAffineTransform(a: 40.2 * sx, b: 87.4 * sy, c: -40.2 * sx, d: 18.49 * sy, tx: 0, ty: 0))
            verlauf.fill(
                Path(CGRect(x: -100, y: -100, width: 200, height: 200)),
                with: .radialGradient(
                    Gradient(stops: [
                        .init(color: Color(red: 49 / 255, green: 55 / 255, blue: 1 / 255), location: 0),
                        .init(color: Color(red: 25 / 255, green: 28 / 255, blue: 0), location: 0.2283),
                        .init(color: Color(red: 12 / 255, green: 14 / 255, blue: 0), location: 0.34244),
                        .init(color: .black, location: 0.45659),
                        .init(color: .black, location: 1),
                    ]),
                    center: .zero,
                    startRadius: 0,
                    endRadius: 10
                )
            )
        }
        .ignoresSafeArea()
    }
}

/// Fussleiste wie `TrisarFooter`: © impressum · Logo · support.
struct TrisarFussleiste: View {
    var body: some View {
        HStack(spacing: 0) {
            Text("© impressum")
                .font(.grotesk(10, .medium))
                .tracking(-0.5)
                .foregroundStyle(Farbe.limeIcon)
                .frame(width: 116)
            Spacer(minLength: 0)
            Image("TrisarLogo")
                .resizable()
                .scaledToFit()
                .frame(width: 73, height: 10.83)
            Spacer(minLength: 0)
            // Wie im Web (trisar:support-oeffnen): die gerade sichtbare Ansicht oeffnet den Support.
            Button {
                NotificationCenter.default.post(name: .supportOeffnen, object: nil)
            } label: {
                Text("support")
                    .font(.grotesk(10, .medium))
                    .tracking(-0.5)
                    .foregroundStyle(Farbe.limeIcon)
                    .frame(width: 116, height: 40)
            }
            .buttonStyle(.web)
        }
        .frame(height: 40)
        .frame(maxWidth: .infinity)
        .background(Color.black)
    }
}

/// Eingabefeld im Stil der Web-App (grauer Kasten, Icon links, Lime-Rand bei Fokus).
struct TrisarFeld<Rechts: View>: View {
    let titel: String
    let icon: String
    @ViewBuilder var feld: () -> AnyView
    var fokussiert: Bool
    @ViewBuilder var rechts: () -> Rechts

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(titel)
                .font(.grotesk(13, .semibold))
                .foregroundStyle(Farbe.lime)
                .padding(.leading, 4)
            HStack(spacing: 0) {
                Image(icon)
                    .resizable()
                    .frame(width: 20, height: 20)
                    .padding(.leading, 16)
                    .padding(.trailing, 12)
                feld()
                    .font(.grotesk(15))
                    .foregroundStyle(Farbe.grauText)
                    .tint(Farbe.lime)
                rechts()
                    .padding(.trailing, 16)
            }
            .frame(height: 58)
            .background(Farbe.feld)
            .overlay(Rectangle().stroke(fokussiert ? Farbe.lime : Farbe.feldRand, lineWidth: 1))
        }
    }
}

/// Lime-Knopf ueber die volle Breite (wie „Anmelden“).
struct LimeKnopfStil: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.grotesk(15, .regular))
            .foregroundStyle(.black)
            .frame(maxWidth: .infinity)
            .frame(height: 56)
            .background(configuration.isPressed ? Farbe.limeHover : Farbe.lime)
    }
}

extension Notification.Name {
    static let supportOeffnen = Notification.Name("trisar-support-oeffnen")
}


/// Knopf ohne Druck-Effekt (kein Abdunkeln, kein Federn), wie die Knoepfe im Web.
struct WebKnopfStil: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
    }
}

extension ButtonStyle where Self == WebKnopfStil {
    static var web: WebKnopfStil { WebKnopfStil() }
}
