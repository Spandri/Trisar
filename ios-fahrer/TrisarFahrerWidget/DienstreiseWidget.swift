import ActivityKit
import SwiftUI
import WidgetKit

private let lime = Color(red: 0xE3 / 255, green: 0xF6 / 255, blue: 0x54 / 255)
private let grau = Color(red: 0x86 / 255, green: 0x87 / 255, blue: 0x87 / 255)
private let spaetFarbe = Color(red: 0xF0 / 255, green: 0x99 / 255, blue: 0x7B / 255)

private func grotesk(_ groesse: CGFloat, _ gewicht: Font.Weight = .regular) -> Font {
    .custom("Space Grotesk", size: groesse).weight(gewicht)
}

/// Zeile 2 mit Gleisaenderung in Orange (15.11.).
private func zeile2(_ s: DienstreiseAktivitaet.ContentState) -> Text {
    Text(s.zeile2).foregroundColor(grau) + Text(s.hinweis ?? "").foregroundColor(spaetFarbe)
        + Text(s.rest ?? "").foregroundColor(grau)
}

private func spaetText(_ s: DienstreiseAktivitaet.ContentState) -> String? {
    guard let m = s.spaet, m > 0 else { return nil }
    return "+\(m)"
}

/// Live-Aktivitaet "Dienstreise" im TRISAR-Look wie FahrtWidget: schwarz mit Lime-Leuchten, Logo,
/// grosse Zeit mit AB/AN, zwei Zeilen zum laufenden Abschnitt. Dynamic Island mit Symbol der Art.
struct DienstreiseWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: DienstreiseAktivitaet.self) { kontext in
            DienstreiseFlaeche(stand: kontext.state)
                .activityBackgroundTint(.black)
                .activitySystemActionForegroundColor(lime)
        } dynamicIsland: { kontext in
            let s = kontext.state
            let symbol = DienstreiseAktivitaet.symbol(s.art)
            return DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    HStack(alignment: .firstTextBaseline, spacing: 4) {
                        Text(s.marke).font(grotesk(12, .bold)).foregroundStyle(grau)
                        Text(s.zeit).font(grotesk(24, .bold)).foregroundStyle(lime)
                        if let sp = spaetText(s) {
                            Text(sp).font(grotesk(14, .bold)).foregroundStyle(spaetFarbe)
                        }
                    }
                    .lineLimit(1)
                    .padding(.leading, 4)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    HStack(spacing: 6) {
                        Image(systemName: symbol).foregroundStyle(lime)
                        Text(s.nummer).font(grotesk(16, .bold)).foregroundStyle(lime).lineLimit(1)
                    }
                    .padding(.trailing, 4)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(s.zeile1).font(grotesk(16, .medium)).foregroundStyle(.white).lineLimit(1)
                        HStack {
                            zeile2(s).font(grotesk(13)).lineLimit(1)
                            Spacer(minLength: 6)
                            Text(s.oben).font(grotesk(13)).foregroundStyle(lime).lineLimit(1)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 4)
                }
            } compactLeading: {
                HStack(spacing: 2) {
                    Text(s.zeit).font(grotesk(13, .bold)).foregroundStyle(lime)
                    if let sp = spaetText(s) {
                        Text(sp).font(grotesk(11, .bold)).foregroundStyle(spaetFarbe)
                    }
                }
                .lineLimit(1)
            } compactTrailing: {
                Image(systemName: symbol).foregroundStyle(lime)
            } minimal: {
                Image(systemName: symbol).foregroundStyle(lime)
            }
            .keylineTint(lime)
        }
        .supplementalActivityFamilies([.small])
    }
}

private struct DienstreiseFlaeche: View {
    let stand: DienstreiseAktivitaet.ContentState
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

    private var zeitBlock: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 4) {
                Text(stand.marke).font(grotesk(12, .bold)).foregroundStyle(grau)
                if let sp = spaetText(stand) {
                    Text("\(sp) min").font(grotesk(12, .bold)).foregroundStyle(spaetFarbe)
                }
            }
            Text(stand.zeit).font(grotesk(34, .bold)).foregroundStyle(lime)
        }
        .fixedSize()
    }

    /// CarPlay: Zeit, Zeile 1 und Zeile 2.
    private var klein: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(alignment: .firstTextBaseline, spacing: 4) {
                Text(stand.marke).font(grotesk(11, .bold)).foregroundStyle(grau)
                Text(stand.zeit).font(grotesk(26, .bold)).foregroundStyle(lime)
                if let sp = spaetText(stand) {
                    Text(sp).font(grotesk(13, .bold)).foregroundStyle(spaetFarbe)
                }
                Spacer(minLength: 4)
                Image("TrisarLogo").renderingMode(.template).resizable().scaledToFit()
                    .frame(width: 52, height: 11).foregroundStyle(lime)
            }
            Text(stand.zeile1).font(grotesk(15, .medium)).foregroundStyle(.white).lineLimit(1)
            zeile2(stand).font(grotesk(12)).lineLimit(1)
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
                Text(stand.oben).font(grotesk(14)).foregroundStyle(lime).lineLimit(1)
            }
            HStack(alignment: .center, spacing: 14) {
                zeitBlock
                VStack(alignment: .leading, spacing: 2) {
                    Text(stand.zeile1).font(grotesk(15, .medium)).foregroundStyle(.white).lineLimit(1)
                    zeile2(stand).font(grotesk(15, .medium)).lineLimit(1)
                }
            }
        }
        .padding(16)
    }
}
