import SwiftUI

/// Ziele der Dispo-App (Ansichtsnamen wie in admin/src/App.jsx).
enum DispoZiel: Hashable {
    case start, karte, fahrten, fahrzeuge, fahrer, kunden, planung, kiAssistent, fahrtNeu, profil
}

/// NaviFooterKomponente + Navibar.jsx: Leiste 362 x 78 bei left 20, 39 ueber dem unteren Rand,
/// darueber 32 pt weicher Uebergang nach Schwarz. Masse aus den Prozent-Angaben umgerechnet.
struct Navileiste: View {
    let aktiv: DispoZiel
    let waehlen: (DispoZiel) -> Void
    @AppStorage("admin_nav_quick_selected_v1") private var schnellFahrten = "fahrten"
    @AppStorage("admin_nav_ki_selected_v1") private var schnellKi = "planung"

    var body: some View {
        VStack(spacing: 0) {
            Spacer(minLength: 0)
            ZStack(alignment: .topLeading) {
                LinearGradient(stops: [.init(color: .clear, location: 0), .init(color: .black, location: 32 / 131)],
                               startPoint: .top, endPoint: .bottom)
                leiste.platz(20, 32, 362, 78)
            }
            .frame(width: 402, height: 131)
            .frame(maxWidth: .infinity)
            // Web: Leiste bottom 39px, Footer 40px hoch -> Leiste sitzt direkt auf dem Footer.
            .padding(.bottom, -1)
            TrisarFussleiste()
        }
        .ignoresSafeArea()
    }

    private var leiste: some View {
        ZStack(alignment: .topLeading) {
            RoundedRectangle(cornerRadius: 39).fill(Color(hex: 0x1E1E1E)).platz(0, 1, 281, 76)
            RoundedRectangle(cornerRadius: 39).fill(Color(hex: 0x111217))
                .overlay(RoundedRectangle(cornerRadius: 39).stroke(Color(hex: 0x3B3F47), lineWidth: 1))
                .platz(284, 1, 78, 76)
            ForEach([7.0, 76, 144, 212], id: \.self) { x in
                Capsule().fill(Color(hex: 0x1E1E1E)).opacity(0.1).platz(x, 8, x == 144 ? 62 : 62, 62)
            }
            // Blauer Kreis unter dem Plus.
            Circle().fill(RadialGradient(stops: [
                .init(color: Color(hex: 0x0048CF), location: 0), .init(color: Color(hex: 0x00369B), location: 0.17),
                .init(color: Color(hex: 0x002468), location: 0.34), .init(color: Color(hex: 0x00091A), location: 0.6),
                .init(color: .black, location: 0.68), .init(color: .black, location: 1),
            ], center: UnitPoint(x: 0.17, y: 0.17), startRadius: 0, endRadius: 100))
            .platz(288, 4, 70, 70)
            ForEach([72.0, 140, 210], id: \.self) { x in
                Image("nav-divider").resizable().platz(x, 22, 1, 34)
            }

            NaviKnopf(icon: aktiv == .start ? "House_Nav_Trisar_01_Lime" : "House_Nav_Trisar_01_grau",
                      groesse: CGSize(width: 24, height: 24), aktiv: aktiv == .start) { waehlen(.start) }
                .platz(7, 8, 65, 64)
            NaviKnopf(icon: aktiv == .karte ? "Pin_Nav_Trisar_Icons_01_Lime" : "Pin_Nav_Trisar_Icons_01_grau",
                      groesse: CGSize(width: 23, height: 23), aktiv: aktiv == .karte) { waehlen(.karte) }
                .platz(76, 8, 64, 64)
            SchnellwahlKnopf(
                optionen: [
                    (.fahrzeuge, aktiv == .fahrzeuge ? "Vehicle_Nav_Trisar_01_Lime" : "Vehicle_Nav_Trisar_01_grau", CGSize(width: 24, height: 24)),
                    (.fahrten, aktiv == .fahrten ? "Arrow_Nav_Trisar_Icons_01_Lime" : "Arrow_Nav_Trisar_Icons_01_grau", CGSize(width: 24, height: 23)),
                    (.fahrer, aktiv == .fahrer ? "Person_Trisar_Icons_01_Lime" : "Person_Trisar_Icons_01_grau", CGSize(width: 23, height: 23)),
                ],
                aktiv: aktiv, gewaehlt: $schnellFahrten, waehlen: waehlen
            )
            .platz(144, 8, 68, 64)
            SchnellwahlKnopf(
                optionen: [
                    (.planung, aktiv == .planung ? "KI_Trisar_Icons_01_Lime" : "KI_Trisar_Icons_01_grau", CGSize(width: 23, height: 23)),
                    (.kiAssistent, aktiv == .kiAssistent ? "KI_Assistent_Trisar_Icons_01_Lime" : "KI_Assistent_Trisar_Icons_01_grau", CGSize(width: 35, height: 23)),
                ],
                aktiv: aktiv, gewaehlt: $schnellKi, waehlen: waehlen
            )
            .platz(212, 8, 64, 64)
            Button { waehlen(.fahrtNeu) } label: {
                ZStack {
                    Circle().stroke(.white, lineWidth: 1.7).frame(width: 18, height: 18)
                    Path { p in p.move(to: CGPoint(x: 12, y: 8)); p.addLine(to: CGPoint(x: 12, y: 16))
                        p.move(to: CGPoint(x: 8, y: 12)); p.addLine(to: CGPoint(x: 16, y: 12)) }
                        .stroke(.white, style: StrokeStyle(lineWidth: 1.9, lineCap: .round))
                        .frame(width: 24, height: 24)
                }
                .scaleEffect(aktiv == .fahrtNeu ? 1.25 : 1)
                .frame(width: 70, height: 70)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .platz(288, 4, 70, 70)
        }
        .frame(width: 362, height: 78)
    }
}

private struct NaviKnopf: View {
    let icon: String
    let groesse: CGSize
    let aktiv: Bool
    let aktion: () -> Void
    var body: some View {
        Button(action: aktion) {
            Image(icon).resizable().scaledToFit().frame(width: groesse.width, height: groesse.height)
                .scaleEffect(aktiv ? 1.1 : 0.9)
                .animation(.easeOut(duration: 0.3), value: aktiv)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

/// SchnellwahlKnopf: vorne das gewaehlte Ziel gross, die anderen klein in den Ecken.
/// Lang druecken oeffnet das Menue darueber (450 ms wie im Web).
private struct SchnellwahlKnopf: View {
    let optionen: [(DispoZiel, String, CGSize)]
    let aktiv: DispoZiel
    @Binding var gewaehlt: String
    let waehlen: (DispoZiel) -> Void
    @State private var menue = false

    private func schluessel(_ z: DispoZiel) -> String { "\(z)" }

    var body: some View {
        let vorneZiel = optionen.first { $0.0 == aktiv }?.0
            ?? optionen.first { schluessel($0.0) == gewaehlt }?.0 ?? optionen[0].0
        let vorne = optionen.first { $0.0 == vorneZiel }!
        let weitere = optionen.filter { $0.0 != vorneZiel }
        ZStack(alignment: .top) {
            ForEach(Array(weitere.enumerated()), id: \.offset) { i, o in
                Image(o.1).resizable().scaledToFit().frame(width: o.2.width, height: o.2.height)
                    .scaleEffect(0.58).opacity(0.6)
                    .frame(maxWidth: .infinity, alignment: i == 1 ? .trailing : .leading)
                    .padding(.horizontal, 7 - o.2.width * 0.21)
                    .padding(.top, 7 - o.2.height * 0.21)
            }
            Image(vorne.1).resizable().scaledToFit().frame(width: vorne.2.width, height: vorne.2.height)
                .scaleEffect(1.1)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .contentShape(Rectangle())
        .onTapGesture {
            if menue { menue = false } else { waehlen(vorne.0) }
        }
        .onLongPressGesture(minimumDuration: 0.45) {
            UIImpactFeedbackGenerator(style: .light).impactOccurred()
            menue = true
        }
        .overlay(alignment: .top) {
            if menue {
                VStack(spacing: 5) {
                    ForEach(Array(weitere.enumerated()), id: \.offset) { _, o in
                        Button {
                            gewaehlt = schluessel(o.0)
                            menue = false
                            waehlen(o.0)
                        } label: {
                            Image(o.1).resizable().scaledToFit().frame(width: o.2.width, height: o.2.height).opacity(0.6)
                                .frame(width: 64, height: 64)
                                .background(Circle().fill(Color(hex: 0x1C1917)).opacity(0.1))
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.vertical, 3)
                .frame(width: 80)
                .background(RoundedRectangle(cornerRadius: 39).fill(Color(hex: 0x1E1E1E)))
                .offset(y: -CGFloat(weitere.count) * 69 - 8 - 2)
            }
        }
    }
}
