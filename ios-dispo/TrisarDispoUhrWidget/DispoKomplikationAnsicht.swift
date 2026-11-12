import SwiftUI
import WidgetKit

/// Komplikation der Dispo-Uhr: „N ohne Fahrer · N ohne Signal“.
/// Gehoert zur Widget-Erweiterung und (nur fuer die Vorschau mit -uhrZeige komplikation) zur Uhr-App.
struct DispoKomplikationAnsicht: View {
    let zahlen: DispoUhrZahlen?
    var familie: WidgetFamily

    private var ohneFahrer: Int { zahlen?.ohneFahrer ?? 0 }
    private var ohneSignal: Int { zahlen?.ohneSignal ?? 0 }
    private var bereit: Bool { zahlen?.angemeldet == true }
    private func zahl(_ n: Int) -> String { bereit ? "\(n)" : "–" }

    var body: some View {
        switch familie {
        case .accessoryInline:
            Text(bereit ? "\(ohneFahrer) ohne Fahrer · \(ohneSignal) ohne Signal" : "TRISAR Dispo")
        case .accessoryCircular:
            ZStack {
                AccessoryWidgetBackground()
                VStack(spacing: 0) {
                    Text(zahl(ohneFahrer))
                        .font(.grotesk(17, .bold))
                        .foregroundStyle(ohneFahrer > 0 ? UhrFarbe.rot : .white)
                        .widgetAccentable()
                    Rectangle().fill(.white.opacity(0.35)).frame(width: 22, height: 1)
                    Text(zahl(ohneSignal))
                        .font(.grotesk(15, .bold))
                        .foregroundStyle(ohneSignal > 0 ? UhrFarbe.grau : .white)
                }
                .monospacedDigit()
            }
        case .accessoryCorner:
            Text(zahl(ohneFahrer))
                .font(.grotesk(20, .bold))
                .foregroundStyle(ohneFahrer > 0 ? UhrFarbe.rot : .white)
                .widgetAccentable()
                .widgetLabel { Text(bereit ? "\(ohneSignal) ohne Signal" : "Dispo") }
        default:
            VStack(alignment: .leading, spacing: 1) {
                Text("TRISAR Dispo")
                    .font(.grotesk(12, .bold))
                    .foregroundStyle(UhrFarbe.lime)
                    .widgetAccentable()
                zeile(zahl(ohneFahrer), "ohne Fahrer", farbe: ohneFahrer > 0 ? UhrFarbe.rot : .white)
                zeile(zahl(ohneSignal), "ohne Signal", farbe: ohneSignal > 0 ? UhrFarbe.grau : .white)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private func zeile(_ zahl: String, _ text: String, farbe: Color) -> some View {
        HStack(spacing: 5) {
            Text(zahl)
                .font(.grotesk(17, .bold))
                .foregroundStyle(farbe)
                .monospacedDigit()
            Text(text)
                .font(.grotesk(14, .medium))
                .foregroundStyle(.white)
        }
    }
}
