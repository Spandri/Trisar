import SwiftUI
import WidgetKit

/// Komplikation der TRISAR-Uhr: naechste Fahrt mit Uhrzeit, Abstand und Abholort.
/// Daten: letzter UhrStand aus der App Group (schreibt die Uhr-App bei jedem neuen Stand).

private let lime = Color(red: 227 / 255, green: 246 / 255, blue: 84 / 255)
private let orange = Color(red: 255 / 255, green: 184 / 255, blue: 77 / 255)

private func grotesk(_ groesse: CGFloat, _ gewicht: Font.Weight = .regular) -> Font {
    .custom("Space Grotesk", size: groesse).weight(gewicht)
}

struct KomplikationEintrag: TimelineEntry {
    let date: Date
    let angemeldet: Bool
    let fahrt: UhrFahrt?
}

struct KomplikationQuelle: TimelineProvider {
    func placeholder(in context: Context) -> KomplikationEintrag {
        KomplikationEintrag(date: Date(), angemeldet: true,
                            fahrt: UhrFahrt(id: "0", tag: "", zeit: "14:30", status: "Angenommen", von: "Hotel Bayerischer Hof",
                                            nach: "Flughafen", flug: "", offen: false, laeuft: false, kolonne: false))
    }

    func getSnapshot(in context: Context, completion: @escaping (KomplikationEintrag) -> Void) {
        let stand = UhrGruppe.lesen()
        if context.isPreview && stand == nil { completion(placeholder(in: context)); return }
        completion(eintrag(stand, Date()))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<KomplikationEintrag>) -> Void) {
        let stand = UhrGruppe.lesen()
        let jetzt = Date()
        let start = Calendar.current.date(bySetting: .second, value: 0, of: jetzt) ?? jetzt
        // Jede Minute fuer eine Stunde ("in 25 min"), danach neu.
        let eintraege = (0..<60).map { i in eintrag(stand, start.addingTimeInterval(Double(i) * 60)) }
        completion(Timeline(entries: eintraege, policy: .after(start.addingTimeInterval(3600))))
    }

    private func eintrag(_ stand: UhrStand?, _ zeit: Date) -> KomplikationEintrag {
        KomplikationEintrag(date: zeit, angemeldet: stand?.angemeldet ?? false, fahrt: stand?.naechsteFahrt(zeit))
    }
}

struct KomplikationAnsicht: View {
    @Environment(\.widgetFamily) private var familie
    let eintrag: KomplikationEintrag

    private var abstand: String? {
        guard let f = eintrag.fahrt, let z = f.zeitpunkt else { return nil }
        if f.phase == "unterwegs" { return "unterwegs" }
        if f.phase == "beimGast" { return "beim Gast" }
        guard z.timeIntervalSince(eintrag.date) < 24 * 3600 else { return nil }
        return UhrStand.abstand(bis: z, von: eintrag.date)
    }

    var body: some View {
        switch familie {
        case .accessoryCircular: rund
        case .accessoryInline: zeile
        case .accessoryCorner: ecke
        default: rechteck
        }
    }

    private var rechteck: some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(eintrag.fahrt?.offen == true ? "Fahrt annehmen" : "Nächste Fahrt")
                .font(grotesk(13, .bold))
                .foregroundStyle(eintrag.fahrt?.offen == true ? orange : lime)
                .widgetAccentable()
            if let f = eintrag.fahrt {
                Text(f.zeit + (abstand.map { " · \($0)" } ?? ""))
                    .font(grotesk(17, .bold))
                    .monospacedDigit()
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
                Text(f.von)
                    .font(grotesk(13, .medium))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            } else {
                Text(eintrag.angemeldet ? "Keine Fahrt" : "Nicht angemeldet")
                    .font(grotesk(16, .bold))
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var rund: some View {
        ZStack {
            AccessoryWidgetBackground()
            VStack(spacing: 0) {
                Image(systemName: "car.fill")
                    .font(.system(size: 10))
                    .foregroundStyle(lime)
                    .widgetAccentable()
                Text(eintrag.fahrt?.zeit ?? "--:--")
                    .font(grotesk(14, .bold))
                    .monospacedDigit()
                    .minimumScaleFactor(0.6)
            }
        }
    }

    @ViewBuilder private var zeile: some View {
        if let f = eintrag.fahrt {
            Text("Fahrt \(f.zeit)" + (abstand.map { " · \($0)" } ?? ""))
        } else {
            Text("Keine Fahrt")
        }
    }

    private var ecke: some View {
        Image(systemName: "car.fill")
            .foregroundStyle(lime)
            .widgetLabel(eintrag.fahrt.map { "\($0.zeit) \(abstand ?? "")" } ?? "Keine Fahrt")
    }
}

@main
struct TrisarUhrKomplikation: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "TrisarNaechsteFahrt", provider: KomplikationQuelle()) { eintrag in
            KomplikationAnsicht(eintrag: eintrag)
                .containerBackground(for: .widget) { Color.black }
        }
        .configurationDisplayName("Nächste Fahrt")
        .description("Uhrzeit, Abstand und Abholort der nächsten TRISAR-Fahrt.")
        .supportedFamilies([.accessoryRectangular, .accessoryCircular, .accessoryInline, .accessoryCorner])
    }
}
