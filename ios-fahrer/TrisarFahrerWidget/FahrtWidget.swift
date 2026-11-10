import ActivityKit
import SwiftUI
import WidgetKit

private let lime = Color(red: 0xE3 / 255, green: 0xF6 / 255, blue: 0x54 / 255)
private let grau = Color(red: 0x86 / 255, green: 0x87 / 255, blue: 0x86 / 255)

private func grotesk(_ groesse: CGFloat, _ gewicht: Font.Weight = .regular) -> Font {
    .custom("Space Grotesk", size: groesse).weight(gewicht)
}

@main
struct TrisarFahrerWidgets: WidgetBundle {
    var body: some Widget { FahrtWidget() }
}

/// Live-Aktivitaet im TRISAR-Look: Sperrbildschirm und Dynamic Island auf dem iPhone,
/// Familie .small fuer CarPlay (und Apple Watch).
struct FahrtWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: FahrtAktivitaet.self) { kontext in
            FahrtFlaeche(stand: kontext.state)
                .activityBackgroundTint(.black)
                .activitySystemActionForegroundColor(lime)
        } dynamicIsland: { kontext in
            let s = kontext.state
            return DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Text(s.zeit).font(grotesk(24, .bold)).foregroundStyle(lime)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    Text(s.status).font(grotesk(14)).foregroundStyle(lime)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    Text(s.unterwegs ? s.nach : s.von).font(grotesk(16, .medium)).lineLimit(1)
                }
            } compactLeading: {
                Text(s.zeit).font(grotesk(13, .bold)).foregroundStyle(lime)
            } compactTrailing: {
                Image(systemName: s.unterwegs ? "flag.fill" : "mappin").foregroundStyle(lime)
            } minimal: {
                Image(systemName: s.unterwegs ? "flag.fill" : "mappin").foregroundStyle(lime)
            }
            .keylineTint(lime)
        }
        .supplementalActivityFamilies([.small])
    }
}

private struct FahrtFlaeche: View {
    let stand: FahrtAktivitaet.ContentState
    @Environment(\.activityFamily) private var familie

    var body: some View {
        Group {
            if familie == .small { klein } else { gross }
        }
        .background { hintergrund }
    }

    /// Dunkles Lime-Leuchten oben links wie auf allen Bildschirmen der App.
    private var hintergrund: some View {
        ZStack {
            Color.black
            RadialGradient(colors: [Color(red: 49 / 255, green: 55 / 255, blue: 1 / 255), .clear],
                           center: .topLeading, startRadius: 0, endRadius: 230)
        }
    }

    private var ziel: String { stand.unterwegs ? stand.nach : stand.von }

    /// CarPlay: nur Zeit, Status und der Ort, zu dem es als Naechstes geht.
    private var klein: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(alignment: .firstTextBaseline) {
                Text(stand.zeit).font(grotesk(26, .bold)).foregroundStyle(lime)
                Spacer(minLength: 4)
                Image("TrisarLogo").renderingMode(.template).resizable().scaledToFit()
                    .frame(width: 52, height: 11).foregroundStyle(lime)
            }
            Text(ziel).font(grotesk(15, .medium)).foregroundStyle(.white).lineLimit(1)
            Text(stand.status).font(grotesk(12)).foregroundStyle(grau).lineLimit(1)
        }
        .padding(10)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    }

    private var gross: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Image("TrisarLogo").renderingMode(.template).resizable().scaledToFit()
                    .frame(width: 78, height: 16).foregroundStyle(lime)
                Spacer()
                Text(stand.status).font(grotesk(14)).foregroundStyle(lime)
            }
            HStack(alignment: .center, spacing: 14) {
                Text(stand.zeit).font(grotesk(34, .bold)).foregroundStyle(lime)
                VStack(alignment: .leading, spacing: 2) {
                    Text(stand.von).font(grotesk(15, .medium)).foregroundStyle(stand.unterwegs ? grau : .white).lineLimit(1)
                    Text(stand.nach).font(grotesk(15, .medium)).foregroundStyle(stand.unterwegs ? .white : grau).lineLimit(1)
                }
            }
        }
        .padding(16)
    }
}
