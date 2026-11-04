import SwiftUI

/// Weisse Fahrzeugkarte (362 x 268) aus Fahrtenliste und „Keine Fahrt“.
/// Nachbau von VehicleBlock (FahrtenScreen01View.jsx) und KeineFahrtTrisar.jsx.
struct FahrzeugKarte: View {
    let fahrzeug: FahrzeugZeile?
    /// Ueberschrift: Fahrtenliste zeigt das Kennzeichen, „Keine Fahrt“ das Modell.
    var titel: String
    /// Bild-Oberkante: Liste 63, „Keine Fahrt“ 55.57.
    var bildOben: CGFloat = 63

    var body: some View {
        ZStack(alignment: .topLeading) {
            Color.white

            Text(titel)
                .grotesk(30, .bold, abstand: -0.5)
                .foregroundStyle(Color(hex: 0x1C1C1D))
                .lineLimit(1)
                .minimumScaleFactor(0.5)
                .platz(0, 15.29, 362, 36.68, .top)

            Group {
                if let url = FahrzeugKarte.bildURL(fahrzeug?.image_url) {
                    AsyncImage(url: url) { phase in
                        if let bild = phase.image {
                            bild.resizable().scaledToFit()
                        } else {
                            Color(hex: 0xECECEC)
                        }
                    }
                } else {
                    Color(hex: 0xECECEC)
                }
            }
            .platz(63.9, bildOben, 234.53, 114.91)

            // Im Web mit z-10 ueber dem Bild.
            (Text("VIN  ").bold() + Text(fahrzeug?.vin ?? "").kerning(2))
                .font(.grotesk(13))
                .foregroundStyle(Color(red: 28 / 255, green: 28 / 255, blue: 29 / 255, opacity: 0.15))
                .lineLimit(1)
                .platz(0, 51.97, 362, nil, .top)

            HStack(spacing: 16) {
                KraftstoffKachel(kraftstoff: fahrzeug?.fuel_type)
                FarbKachel(farbe: fahrzeug?.color)
                EnergieKachel(kraftstoff: fahrzeug?.fuel_type, fuellstand: fahrzeug?.battery_fuel_percent, reichweite: fahrzeug?.range_km)
                SitzKachel(sitze: fahrzeug?.seat_count)
            }
            .platz(53, 195.65)
        }
        .frame(width: 362, height: 268)
    }

    /// Bilder liegen teils als Pfad der Web-App vor (/fahrzeuge/...).
    static func bildURL(_ wert: String?) -> URL? {
        guard let roh = wert?.trimmingCharacters(in: .whitespaces), !roh.isEmpty else { return nil }
        if roh.hasPrefix("http") { return URL(string: roh) }
        return URL(string: "https://fahrer.trisar.de" + (roh.hasPrefix("/") ? roh : "/" + roh))
    }
}

// MARK: - Kacheln (vehicleBadges.jsx, Basis 36, angezeigt in 52)

private struct KachelRahmen<Inhalt: View>: View {
    var groesse: CGFloat = 52
    @ViewBuilder let inhalt: () -> Inhalt
    var body: some View {
        ZStack {
            Image("card-outline-52").resizable()
            inhalt().scaleEffect(groesse / 36)
        }
        .frame(width: groesse, height: groesse)
    }
}

struct KraftstoffKachel: View {
    let kraftstoff: String?

    var body: some View {
        KachelRahmen {
            switch Self.aufloesen(kraftstoff) {
            case let .icon(name):
                Image(name).resizable().scaledToFit().frame(width: 23, height: 23)
            case let .text(label):
                ZStack {
                    RoundedRectangle(cornerRadius: 3.7).stroke(Color(hex: 0x12120D), lineWidth: 2.1)
                        .padding(1.05)
                    Text(label).font(.grotesk(9, .bold)).foregroundStyle(.black)
                }
                .frame(width: 23, height: 20)
            }
        }
    }

    enum Anzeige { case icon(String), text(String) }

    /// resolveFuelBadge der Web-App.
    static func aufloesen(_ wert: String?) -> Anzeige {
        let f = (wert ?? "").trimmingCharacters(in: .whitespaces).lowercased()
        if f.isEmpty || f == "e10" { return .icon("E10_Tank_Trisar_Icons_01") }
        if f.contains("elektr") || f == "ev" || f == "bev" || f.contains("hybrid") { return .icon("Blitz_Trisar_Icons_01") }
        if f.contains("b10") { return .text("B10") }
        if f.contains("diesel") || f.contains("b7") { return .text("B7") }
        if f.contains("plus") || f.contains("98") { return .icon("E98_Tank_Trisar_Icons_01") }
        if f.contains("95") || f.contains("super") || f.contains("e5") { return .icon("E95_Tank_Trisar_Icons_01") }
        return .text(String((wert ?? "").trimmingCharacters(in: .whitespaces).prefix(3)))
    }
}

struct FarbKachel: View {
    let farbe: String?
    var body: some View {
        KachelRahmen {
            Circle().fill(Self.farbe(farbe)).frame(width: 23, height: 23)
        }
    }

    /// resolveCarColor der Web-App.
    static func farbe(_ wert: String?) -> Color {
        guard let roh = wert?.trimmingCharacters(in: .whitespaces), !roh.isEmpty else { return Color(hex: 0x0D0D0D) }
        let v = roh.lowercased()
        let tabelle: [String: UInt32] = [
            "black": 0x0D0D0D, "schwarz": 0x0D0D0D, "white": 0xF3F4F6, "weiss": 0xF3F4F6,
            "silber": 0xC4C6C8, "silver": 0xC4C6C8, "grau": 0x8B8E93, "gray": 0x8B8E93, "grey": 0x8B8E93,
            "blau": 0x1D4ED8, "blue": 0x1D4ED8, "rot": 0xB91C1C, "red": 0xB91C1C, "gruen": 0x15803D, "green": 0x15803D,
        ]
        if let hex = tabelle[v] { return Color(hex: hex) }
        if roh.hasPrefix("#"), let zahl = UInt32(roh.dropFirst(), radix: 16), roh.count == 7 { return Color(hex: zahl) }
        if v.contains("weiß") || v.contains("weiss") { return Color(hex: 0xF3F4F6) }
        if v.contains("blau") || v.contains("blue") { return Color(hex: 0x1D4ED8) }
        if v.contains("rot") || v.contains("red") { return Color(hex: 0xB91C1C) }
        if v.contains("grün") || v.contains("gruen") || v.contains("green") { return Color(hex: 0x15803D) }
        if v.contains("bronze") { return Color(hex: 0x8A6D55) }
        if v.contains("grau") || v.contains("grey") || v.contains("gray") { return Color(hex: 0x8B8E93) }
        if v.contains("silber") || v.contains("silver") { return Color(hex: 0xC4C6C8) }
        return Color(hex: 0x0D0D0D)
    }
}

struct SitzKachel: View {
    let sitze: Int?
    var body: some View {
        KachelRahmen {
            Image(Self.icon(sitze)).resizable().scaledToFit().frame(width: 23, height: 23)
        }
    }

    static func icon(_ sitze: Int?) -> String {
        guard let s = sitze else { return "Person_Trisar_Icons_01" }
        return "\(min(8, max(3, s)))x_Person_Trisar_Icons_01"
    }
}

/// Energie-Kachel: Elektro = Batterie, Verbrenner = Zapfsaeule mit Fuellbalken.
/// Ohne Wert steht „–“ (kein erfundener Wert, wie im Live-Betrieb der Web-App).
struct EnergieKachel: View {
    let kraftstoff: String?
    let fuellstand: Double?
    let reichweite: Double?

    private var elektrisch: Bool {
        let f = (kraftstoff ?? "").lowercased()
        return f.contains("elektr") || f == "ev" || f == "bev"
    }

    var body: some View {
        let fill = fuellstand.map { Int(max(0, min(100, $0.rounded()))) }
        let maxReichweite = (reichweite ?? 0) > 0 ? reichweite! : (elektrisch ? 500 : 650)
        let km = fill.map { Int((Double($0) / 100 * maxReichweite).rounded()) }
        KachelRahmen {
            VStack(spacing: 3) {
                if elektrisch {
                    let icon = fill == nil ? "40xBatterie_Trisar_Icon_01_green"
                        : (fill! >= 60 ? "100xBatterie_Trisar_Icon_01_green"
                           : (fill! >= 25 ? "40xBatterie_Trisar_Icon_01_green" : "20xBatterie_Trisar_Icon_01_green"))
                    Image(icon).resizable().scaledToFit().frame(width: 13, height: 13).opacity(fill == nil ? 0.3 : 1)
                } else {
                    ZStack(alignment: .bottom) {
                        Rectangle().fill(Color(hex: 0x1A171B))
                            .frame(width: 4, height: 13 * 0.76 * Double(fill ?? 0) / 100)
                            .padding(.bottom, 13 * 0.12)
                        Image("Zapfsaeule_Trisar_Icons_01").resizable().frame(width: 8, height: 13)
                    }
                    .frame(width: 8, height: 13)
                }
                VStack(spacing: 0) {
                    Text(km.map { "\($0)km " } ?? "–")
                    Text(fill.map { "\($0)%" } ?? "–").foregroundStyle(Color(hex: 0x060606))
                }
                .font(.grotesk(5, .bold))
                .foregroundStyle(.black)
                .lineSpacing(0)
            }
        }
    }
}
