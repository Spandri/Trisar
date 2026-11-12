import SwiftUI

/// Standby-Karte in der Fahrtenliste (wie StandbyKarte.jsx): Lime-Etikett „Standby“, Ort, Zeitfenster.
/// Zustaende: Anfrage (Ablehnen/Annehmen), angenommen, vor Ort (Gast drin), mit Gast (Gast abgesetzt),
/// Rueckweg (Mit Gast | Bei Standby), vorbei (grauer Rand).
struct StandbyKarte: View {
    let standby: StandbySpeicher.Standby
    let antworten: (Bool) -> Void
    let melden: (String) -> Void

    private let lime = Color(hex: 0xE3F654)
    private let rot = Color(hex: 0xFF6F63)
    private let orange = Color(hex: 0xFFCD8A)
    private let grau = Color(hex: 0x868687)

    private var vorbei: Bool { !standby.offen && standby.vorbei }
    private var z: String? { standby.zustand }
    private var rand: Color {
        if standby.offen { return .clear }
        if vorbei { return grau }
        return z == "mit_gast" ? orange : lime
    }

    private static func uhr(_ d: Date?) -> String {
        guard let d else { return "" }
        let f = DateFormatter(); f.locale = Locale(identifier: "de_DE"); f.timeZone = Stunden.berlin; f.dateFormat = "HH:mm"
        return f.string(from: d)
    }

    var body: some View {
        VStack(spacing: 12) {
            ZStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 0) {
                    HStack(spacing: 14) {
                        Image("Pin_Nav_Trisar_Icons_01_grau").resizable().scaledToFit().frame(width: 30, height: 30)
                            .frame(width: 64, height: 64)
                            .background(RoundedRectangle(cornerRadius: 16).fill(Color(hex: 0x242525)))
                        VStack(alignment: .leading, spacing: 0) {
                            Text(standby.ortName).grotesk(24, .bold).foregroundStyle(.white).lineLimit(1)
                            if let a = standby.adresse, !a.isEmpty, a != standby.ortName {
                                Text(a).grotesk(15, .bold).foregroundStyle(grau).lineLimit(1)
                            }
                        }
                    }
                    Text("\(standby.anzeigeVon) – \(standby.anzeigeBis)").grotesk(38, .bold).foregroundStyle(lime)
                        .lineLimit(1).minimumScaleFactor(0.7)
                        .padding(.top, 18)
                    if !vorbei && z == "mit_gast" {
                        Text("Mit Gast unterwegs seit \(Self.uhr(standby.zustandSeit))").grotesk(18, .bold).foregroundStyle(orange)
                            .padding(.top, 14)
                    }
                }
                .padding(.top, 54).padding(.horizontal, 16).padding(.bottom, 20)
                .frame(width: 362, alignment: .leading)
                .frame(minHeight: StandbySpeicher.karte, alignment: .top)

                Text("Standby").grotesk(18, .bold).foregroundStyle(.black)
                    .padding(.horizontal, 16).frame(height: 34).background(lime)
            }
            .frame(width: 362)
            .background(Color(hex: 0x1A1A1A))
            .overlay(Rectangle().strokeBorder(rand, lineWidth: 2))

            if standby.offen {
                knopfPaar(links: "Ablehnen", rechts: "Annehmen", { antworten(false) }, { antworten(true) })
            } else if !vorbei && z == "vor_ort" {
                grosserKnopf("Gast drin", farbe: lime) { melden("gast_drin") }
            } else if !vorbei && z == "mit_gast" {
                grosserKnopf("Gast abgesetzt", farbe: orange) { melden("abgesetzt") }
            } else if !vorbei && z == "rueckweg" {
                knopfPaar(links: "Mit Gast", rechts: "Bei Standby", { melden("gast_drin") }, { melden("zurueck") })
            }
        }
        .frame(width: 362, alignment: .top)
    }

    private func grosserKnopf(_ text: String, farbe: Color, _ aktion: @escaping () -> Void) -> some View {
        Button(action: aktion) {
            HStack(spacing: 0) {
                Text(text).grotesk(22, .bold).foregroundStyle(.black)
                Spacer(minLength: 0)
                Image("Arrow_Trisar_Icons_01").resizable().frame(width: 34, height: 19)
            }
            .padding(.leading, 18).padding(.trailing, 16)
            .frame(width: 362, height: 56)
            .background(farbe)
        }
        .buttonStyle(.web)
    }

    private func knopfPaar(links: String, rechts: String, _ l: @escaping () -> Void, _ r: @escaping () -> Void) -> some View {
        HStack(spacing: 6) {
            Button(action: l) {
                Text(links).grotesk(24, .bold, abstand: -0.5).foregroundStyle(rot)
                    .frame(width: 178, height: 51)
                    .overlay(Rectangle().strokeBorder(rot, lineWidth: 2))
            }
            Button(action: r) {
                Text(rechts).grotesk(24, .bold, abstand: -0.5).foregroundStyle(.black)
                    .frame(width: 178, height: 51)
                    .background(Color(hex: 0xE3F754))
            }
        }
        .buttonStyle(.web)
    }
}
