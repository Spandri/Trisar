import SwiftUI

/// Nachbau von FahrerListeView.jsx. Im Web eine feste Beispielliste ohne Datenbank,
/// erreichbar aus der Kunden Liste. Die drei Eintraege stehen dort genauso im Code.
struct FahrerListeAnsicht: View {
    let zeigen: (DispoZiel) -> Void

    private let eintraege = [("Horst Engel", "verfügbar"), ("Mara Stein", "auf Fahrt"), ("Daniel Koch", "Pause")]

    var body: some View {
        ZStack(alignment: .topLeading) {
            DispoHintergrund().ignoresSafeArea()
            Leinwand(basisHoehe: 874, mitHintergrund: false) { _ in
                ZStack(alignment: .topLeading) {
                    rahmenKnopf("Zurück") { zeigen(.start) }.platz(20, 60, nil, 40)
                    rahmenKnopf("Profil") { zeigen(.profil) }.platz(0, 60, 402 - 20, 40, .topTrailing)

                    Text("Fahrer Liste").grotesk(42, .bold, abstand: -0.5).foregroundStyle(Color(hex: 0xE3F654))
                        .fixedSize().frame(height: 42).platz(20, 130)

                    VStack(spacing: 8) {
                        ForEach(eintraege, id: \.0) { e in
                            VStack(alignment: .leading, spacing: 4) {
                                Text(e.0).font(.grotesk(18)).foregroundStyle(.white)
                                Text("Status: \(e.1)").font(.grotesk(14)).foregroundStyle(Color(hex: 0x898889))
                            }
                            .padding(16)
                            .frame(width: 362, alignment: .leading)
                            .background(Color(hex: 0x101010))
                            .overlay(Rectangle().strokeBorder(Color(hex: 0x2F2F2F), lineWidth: 1))
                        }
                    }
                    .platz(20, 200, 362, nil)

                    Button { zeigen(.kunden) } label: {
                        Text("Zur Kunden Liste").grotesk(16, .medium).foregroundStyle(Color(hex: 0x262626))
                            .frame(width: 362, height: 56).background(Color(hex: 0xE3F654))
                    }
                    .buttonStyle(.web)
                    .platz(20, 640, 362, 56)
                }
            }
            Navileiste(aktiv: .start, waehlen: zeigen)
        }
    }

    private func rahmenKnopf(_ text: String, aktion: @escaping () -> Void) -> some View {
        Button(action: aktion) {
            Text(text).font(.grotesk(14)).foregroundStyle(Color(hex: 0xE3F654))
                .padding(.horizontal, 16).frame(height: 40)
                .overlay(Rectangle().strokeBorder(Color(hex: 0x747474), lineWidth: 1))
        }
        .buttonStyle(.web)
        .fixedSize()
    }
}
