import SwiftUI

/// VerlaufView.jsx, Live-Zweig: Schichtverlauf gibt es im Betrieb noch nicht,
/// die Seite ist nur bildschirmhoch (812) und zeigt „Noch keine Einträge.“.
struct VerlaufAnsicht: View {
    let zurueck: () -> Void

    var body: some View {
        Leinwand(basisHoehe: 812, mitHintergrund: false) { rahmen in
            ZStack(alignment: .topLeading) {
                DispoHintergrund().frame(width: 402, height: rahmen)
                ZurueckKnopf(aktion: zurueck).platz(20, 60, 50, 50)
                // bg-zinc-900, oben rund (rounded-t-xl), 1046 hoch
                UnevenRoundedRectangle(topLeadingRadius: 12, topTrailingRadius: 12)
                    .fill(Color(hex: 0x18181B))
                    .platz(0, 206, 402, rahmen - 206)
                StammTitel(text: "Verlauf", abstand: -0.5).platz(20, 140)
                WebText(text: "Noch keine Einträge.", groesse: 18, gewicht: .bold, zeilenHoehe: 24, abstand: 0.5,
                        farbe: UIColor.white.withAlphaComponent(0.6))
                    .platz(20, 230, 362, nil)
            }
        }
        .overlay { FussleisteUnten() }
    }
}
