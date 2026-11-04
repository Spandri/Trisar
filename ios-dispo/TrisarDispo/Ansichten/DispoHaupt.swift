import SwiftUI

/// Seitenwechsel der Dispo-App wie setView in admin/src/App.jsx.
/// Jede Seite bekommt `zeigen(_:)` fuer Navigation und die feste Leiste unten.
struct DispoHaupt: View {
    @EnvironmentObject private var anmeldung: Anmeldung
    @State private var ziel: DispoZiel = .start

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            seite
                .id(ziel)
                .transition(.opacity)
        }
        .animation(.easeOut(duration: 0.15), value: ziel)
    }

    @ViewBuilder private var seite: some View {
        switch ziel {
        case .start:
            DispoStartseite(zeigen: zeigen)
        case .fahrer:
            FahrerBereichAnsicht(zeigen: zeigen)
        case .fahrzeuge:
            FahrzeugBereichAnsicht(zeigen: zeigen)
        case .kunden:
            KundenBereichAnsicht(zeigen: zeigen)
        case .profil:
            KoordinatorProfilAnsicht(zeigen: zeigen)
        case .fahrten:
            FahrtenAnsicht(zeigen: zeigen, oeffneFahrt: { _ in })
        case .karte:
            DispoKarteAnsicht(zeigen: zeigen)
        default:
            DispoPlatzhalter(titel: titel(ziel), zeigen: zeigen, aktiv: ziel)
        }
    }

    private func zeigen(_ neu: DispoZiel) { ziel = neu }

    private func titel(_ z: DispoZiel) -> String {
        switch z {
        case .start: return "Start"
        case .karte: return "Karte"
        case .fahrten: return "Fahrten"
        case .fahrzeuge: return "Fahrzeuge"
        case .fahrer: return "Fahrer"
        case .kunden: return "Kunden"
        case .planung: return "Planung"
        case .kiAssistent: return "KI-Assistent"
        case .fahrtNeu: return "Fahrt anlegen"
        case .profil: return "Profil"
        }
    }
}

/// Fuer Seiten, die noch nachgebaut werden.
struct DispoPlatzhalter: View {
    let titel: String
    let zeigen: (DispoZiel) -> Void
    let aktiv: DispoZiel
    var body: some View {
        ZStack(alignment: .topLeading) {
            DispoHintergrund().ignoresSafeArea()
            WebText(text: titel, groesse: 42, gewicht: .bold, zeilenHoehe: 42, abstand: -0.5, farbe: UIColor(hex: 0xE2F754))
                .fixedSize().padding(.leading, 20).padding(.top, 140)
            Navileiste(aktiv: aktiv, waehlen: zeigen)
        }
    }
}

/// Blauer Verlauf der Dispo: radial-gradient(ellipse 141.42% 102.21% at 0% 0%, #0048cf ...).
struct DispoHintergrund: View {
    var body: some View {
        CSSRadial(rx: 1.4142, ry: 1.0221, stopps: [
            (0x0048CF, 0), (0x00369B, 0.11415), (0x002468, 0.2283), (0x001B4E, 0.28537), (0x001234, 0.34244),
            (0x00091A, 0.39952), (0x00050D, 0.42805), (0x000000, 0.45659), (0x000000, 1),
        ])
    }
}

/// HomeScreen.jsx: Profil-Knopf, Logo, Begruessung, vier Knoepfe ab 442, Leiste unten.
/// Kennzahlen-Kacheln gibt es nur in der Demo, live nicht.
struct DispoStartseite: View {
    let zeigen: (DispoZiel) -> Void
    @EnvironmentObject private var anmeldung: Anmeldung

    var body: some View {
        ZStack(alignment: .topLeading) {
            DispoHintergrund().ignoresSafeArea()
            Leinwand(basisHoehe: 874, mitHintergrund: false) { _ in
                ZStack(alignment: .topLeading) {
                    ProfilKnopf { zeigen(.profil) }.platz(402 - 20 - 52, 60, 52, 52)
                    Image("trisar_logo").resizable().scaledToFit().platz(20, 115, 161, 24)
                    WebText(text: "Willkommen zurück \(anmeldung.profil?.firstName ?? "")", groesse: 34, gewicht: .medium,
                            zeilenHoehe: 34 * 1.276, abstand: -0.5)
                        .platz(20, 180, 362, nil)
                    VStack(spacing: 12) {
                        PlanungsKnopf { zeigen(.planung) }
                        StartKnopf(text: "Fahrer Liste") { zeigen(.fahrer) }
                        StartKnopf(text: "Kunden Liste") { zeigen(.kunden) }
                        StartKnopf(text: "Fahrzeugliste") { zeigen(.fahrzeuge) }
                    }
                    .platz(20, 442, 362, nil)
                }
            }
            Navileiste(aktiv: .start, waehlen: zeigen)
        }
    }
}

/// ActionButton: Lime, Text links 16 medium, schwarzer Pfeil rechts.
struct StartKnopf: View {
    let text: String
    let aktion: () -> Void
    var body: some View {
        Button(action: aktion) {
            HStack {
                Text(text).font(.grotesk(16, .medium)).tracking(0.5).foregroundStyle(.black)
                Spacer()
                Image("Arrow_Trisar_Icons_01").resizable().frame(width: 34, height: 20)
            }
            .padding(.horizontal, 16)
            .frame(width: 362, height: 56)
            .background(Color(hex: 0xE3F654))
        }
        .buttonStyle(.plain)
    }
}

/// PlanungsKnopf: schwarz mit Lime-Rand, langsam drehender Farbverlauf Blau -> Schwarz -> Lime.
struct PlanungsKnopf: View {
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
                    Text("Planung").font(.grotesk(16, .medium)).tracking(0.5).foregroundStyle(Color(hex: 0xE3F654))
                    Spacer()
                    Image("Planen_Sparkle_Lime").resizable().frame(width: 24, height: 24.14)
                }
                .padding(.leading, 22).padding(.trailing, 26)
            }
            .frame(width: 362, height: 56)
            .background(Color.black)
            .clipped()
            .overlay(Rectangle().strokeBorder(Color(hex: 0xE2F754), lineWidth: 2))
        }
        .buttonStyle(.plain)
        .onAppear {
            withAnimation(.linear(duration: 120).repeatForever(autoreverses: false)) { winkel = 382.66 }
        }
    }
}
