import SwiftUI

/// Dienstreise in der Fahrtenliste (wie DienstreiseKarte.jsx): sieht aus wie eine Fahrt. Lime-Etikett
/// „Dienstreise“ mit Koffer, Kacheln Start (Zug/Flug) und Ziel, Startzeit gross, darunter Zug- bzw.
/// Flugnummer. Anfrage: Ablehnen/Annehmen darunter. Antippen oeffnet die Ansicht mit Karte.
struct DienstreiseKarte: View {
    let reise: DienstreiseSpeicher.Reise
    let antworten: (Bool) -> Void
    let oeffnen: () -> Void

    @ObservedObject private var orte = OrteSpeicher.geteilt

    private let lime = Color(hex: 0xE2F754)
    private let rand = Color(hex: 0xE3F754)
    private let rot = Color(hex: 0xFF6F63)

    // Im Web liegen die Kinder im Innenfeld (innerhalb des 2-px-Rands), hier in Aussenkoordinaten.
    private let r: CGFloat = 2
    private let mitte: CGFloat = 181

    var body: some View {
        VStack(spacing: 12) {
            Button(action: oeffnen) { karte }
                .buttonStyle(.web)

            if reise.offen {
                HStack(spacing: 6) {
                    Button { antworten(false) } label: {
                        Text("Ablehnen").grotesk(24, .bold, abstand: -0.5).foregroundStyle(rot)
                            .frame(width: 178, height: 51)
                            .overlay(Rectangle().strokeBorder(rot, lineWidth: 2))
                            .contentShape(Rectangle())
                    }
                    Button { antworten(true) } label: {
                        Text("Annehmen").grotesk(24, .bold, abstand: -0.5).foregroundStyle(.black)
                            .frame(width: 178, height: 51)
                            .background(rand)
                    }
                }
                .buttonStyle(.web)
            }
        }
        .frame(width: 362, alignment: .top)
    }

    private var karte: some View {
        ZStack(alignment: .topLeading) {
            Color(hex: 0x1A1A1A)

            kachel(reise.ersterIcon).platz(r + 31, r + 40, 70, 70)
            kachel(reise.zielIcon(orte)).platz(r + 254, r + 40, 70, 70)

            Text("START").grotesk(10, .bold, abstand: -0.5).foregroundStyle(Color(hex: 0x868786))
                .multilineTextAlignment(.center)
                .mittig(mitte, r + 45, 60)

            // Zeit mittig auf Hoehe 75 (translate -50%).
            Text(reise.startZeit).grotesk(30, .bold, abstand: -0.5).foregroundStyle(lime)
                .lineLimit(1).fixedSize()
                .mittig(mitte, r + 75 - 20, 100, 40, .center)

            if !reise.nummerZeile.isEmpty {
                Text(reise.nummerZeile).grotesk(10, .regular, abstand: -0.5).foregroundStyle(Color(hex: 0xF4F5F4).opacity(0.5))
                    .fixedSize(horizontal: false, vertical: true)
                    .multilineTextAlignment(.center)
                    .mittig(mitte, r + 93, 90)
            }

            HStack(alignment: .center, spacing: 18) {
                Text(reise.startName).grotesk(16, .bold, abstand: -0.5).foregroundStyle(.white)
                    .lineSpacing(0)
                    .multilineTextAlignment(.leading)
                    .frame(maxWidth: .infinity, alignment: .leading)
                Image("Arrow_Trisar_Icons_01_Lime").resizable().scaledToFit()
                    .frame(width: 29, height: 20).scaleEffect(1.15)
                Text(reise.zielName).grotesk(16, .bold, abstand: -0.5).foregroundStyle(.white)
                    .multilineTextAlignment(.trailing)
                    .frame(maxWidth: .infinity, alignment: .trailing)
            }
            .platz(r + 20, r + 125, 358 - 20 - 19, nil)

            // Etikett oben mittig (top -2 im Innenfeld = Aussenkante).
            HStack(spacing: 8) {
                Text("Dienstreise").grotesk(18, .bold, abstand: -0.5).foregroundStyle(.black)
                Image("Rollkoffer_Trisar_Icons_01").resizable().scaledToFit().frame(width: 18, height: 18)
            }
            .padding(.horizontal, 10)
            .frame(minWidth: 90, minHeight: 29, maxHeight: 29)
            .background(rand)
            .frame(width: 362, alignment: .top)
        }
        .frame(width: 362, height: DienstreiseSpeicher.karte)
        .overlay(Rectangle().strokeBorder(rand, lineWidth: 2))
        .contentShape(Rectangle())
    }

    private func kachel(_ icon: String) -> some View {
        Image(icon).resizable().scaledToFit().frame(width: 30, height: 30)
            .frame(width: 70, height: 70)
            .background(RoundedRectangle(cornerRadius: 12).fill(Color(hex: 0x242525)))
    }
}
