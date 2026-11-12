import SwiftUI
import WidgetKit

/// Widget-Erweiterung der Dispo-Uhr. Die Uhr-App legt die Zahlen in der App Group ab
/// (DispoUhrZahlen) und laedt die Komplikation bei jeder Aenderung neu.
struct DispoEintrag: TimelineEntry {
    let date: Date
    let zahlen: DispoUhrZahlen?
}

struct DispoQuelle: TimelineProvider {
    static let beispiel = DispoUhrZahlen(ohneFahrer: 2, ohneSignal: 1, angemeldet: true, stand: Date())

    func placeholder(in context: Context) -> DispoEintrag {
        DispoEintrag(date: Date(), zahlen: Self.beispiel)
    }

    func getSnapshot(in context: Context, completion: @escaping (DispoEintrag) -> Void) {
        completion(DispoEintrag(date: Date(), zahlen: context.isPreview ? Self.beispiel : (DispoUhrZahlen.laden() ?? Self.beispiel)))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<DispoEintrag>) -> Void) {
        let eintrag = DispoEintrag(date: Date(), zahlen: DispoUhrZahlen.laden())
        // Neue Zahlen schiebt die Uhr-App per reloadAllTimelines, sonst alle 15 min nachsehen.
        completion(Timeline(entries: [eintrag], policy: .after(Date().addingTimeInterval(15 * 60))))
    }
}

struct DispoKomplikationEintrag: View {
    @Environment(\.widgetFamily) private var familie
    let eintrag: DispoEintrag

    var body: some View {
        DispoKomplikationAnsicht(zahlen: eintrag.zahlen, familie: familie)
            .containerBackground(for: .widget) { Color.black }
    }
}

@main
struct DispoKomplikation: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "DispoLage", provider: DispoQuelle()) { eintrag in
            DispoKomplikationEintrag(eintrag: eintrag)
        }
        .configurationDisplayName("Dispo-Lage")
        .description("Fahrten ohne Fahrer und Fahrer ohne Signal")
        .supportedFamilies([.accessoryRectangular, .accessoryCircular, .accessoryInline, .accessoryCorner])
    }
}
