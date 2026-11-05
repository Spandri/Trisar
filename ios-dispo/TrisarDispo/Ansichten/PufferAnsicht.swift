import SwiftUI

/// Detailseite zum Dash "Puffer je Fahrt" (PufferView.jsx): wie viel Luft die Engine je Fahrt
/// freihaelt, wie knapp es ueber den Tag wird und welche Fahrten das hoechste Risiko tragen.
struct PufferAnsicht: View {
    let tagIso: String
    var option = "standard"
    var optionTitel = "Standard"
    let zurueck: () -> Void

    @ObservedObject private var speicher = NebenRisikoSpeicher.geteilt
    @State private var alle = false
    @State private var stunde: Int?

    private typealias RF = NebenRisikoFarbe

    init(tagIso: String, option: String = "standard", optionTitel: String = "Standard", zurueck: @escaping () -> Void) {
        self.tagIso = tagIso
        self.option = option
        self.optionTitel = optionTitel
        self.zurueck = zurueck
    }

    /// Nicht auf 100 aufrunden, solange noch einzelne Abholungen zu spaet sind.
    private static func prozent(_ x: Double) -> String {
        if x >= 1 { return "100" }
        let f = NumberFormatter()
        f.locale = Locale(identifier: "de_DE")
        f.numberStyle = .decimal
        f.maximumFractionDigits = 2
        return f.string(from: NSNumber(value: (x * 10000).rounded(.down) / 100)) ?? ""
    }

    var body: some View {
        let o = speicher.option(tagIso, option)
        NebenPlanerSeite(titel: "Puffer je Fahrt", unterzeile: "\(NebenRisiko.datumText(tagIso)) · \(optionTitel)", zurueck: zurueck) {
            if let o {
                inhalt(o)
            } else {
                Text("Für diesen Tag liegt keine Rechnung der Engine vor.").font(.grotesk(14))
                    .foregroundStyle(RF.lime).padding(.top, 24)
            }
        }
    }

    @ViewBuilder
    private func inhalt(_ o: NebenRisikoOption) -> some View {
        let ereignisse = speicher.ereignisse(tagIso)
        let verlaeufe = speicher.tag(tagIso)?.verlaeufe ?? 500
        let gesamt = o.fahrten.count
        let hoch = o.hoch.compactMap { id in o.fahrten[id].map { (id: id, f: $0) } }
        let gewaehlt = (o.faecher ?? []).first { $0.h == stunde && ($0.n ?? 0) > 0 }

        HStack(spacing: 12) {
            kachel("Puffer Ø", "\(RF.zahl(o.puffer_mittel)) min", "bisher mind. \(nebenBisherPufferMin) min, plus Wartezeit", RF.lime)
            kachel("Hohes Risiko", "\(o.hoch.count)", "von \(gesamt) Fahrten", o.hoch.isEmpty ? RF.lime : RF.rot)
        }
        .fixedSize(horizontal: false, vertical: true)
        .padding(.top, 24)

        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .firstTextBaseline) {
                Text("Wie knapp wird es?").font(.grotesk(16, .bold))
                Spacer()
                Text("\(verlaeufe) Verläufe des Tages").font(.grotesk(11)).opacity(0.75)
            }
            LuftFaecher(faecher: o.faecher ?? [], gewaehlt: stunde) { stunde = $0 }.padding(.top, 10)
            HStack(spacing: 12) {
                HStack(spacing: 4) { Rectangle().fill(.white).frame(width: 14, height: 2); Text("Median") }
                HStack(spacing: 4) {
                    LinearGradient(stops: [
                        .init(color: RF.lime.opacity(0.08), location: 0),
                        .init(color: RF.lime.opacity(0.75), location: 0.5),
                        .init(color: RF.lime.opacity(0.08), location: 1),
                    ], startPoint: .leading, endPoint: .trailing).frame(width: 34, height: 9)
                    Text("90-%-Bereich")
                }
                HStack(spacing: 4) { Rectangle().fill(RF.rot.opacity(0.7)).frame(width: 14, height: 9); Text("zu spät") }
            }
            .font(.grotesk(11))
            .padding(.top, 6)
            Group {
                if let g = gewaehlt {
                    Text("\(g.h)–\(g.h + 1) Uhr").bold()
                        + Text(" · \(RF.zahl(g.p50)) min Luft · \((g.spaet ?? 0) >= 0.01 ? "\(Int(((g.spaet ?? 0) * 100).rounded())) % zu spät" : "pünktlich")")
                } else {
                    Text("Tippe auf eine Stunde.")
                }
            }
            .font(.grotesk(12)).cssZeile(12, 16)
            .foregroundStyle(.white.opacity(0.85))
            .padding(.top, 8)
            if let knapp = o.knappste_stunde {
                Group {
                    if let p = o.puenktlich_abholung {
                        Text("Am knappsten ") + Text("\(knapp)–\(knapp + 1) Uhr").bold() + Text(".")
                            + Text(" Mit Nachsteuern ") + Text("\(Self.prozent(p)) %").bold() + Text(" pünktlich abgeholt.")
                    } else {
                        Text("Am knappsten ") + Text("\(knapp)–\(knapp + 1) Uhr").bold() + Text(".")
                    }
                }
                .font(.grotesk(13)).foregroundStyle(.white)
                .padding(.top, 8)
            }
        }
        .modifier(LimeRahmen())
        .padding(.top, 12)

        VStack(alignment: .leading, spacing: 0) {
            PufferStreuung(fahrten: o.fahrten, ereignisse: ereignisse)
            HStack(spacing: 12) {
                Text("●").foregroundStyle(RF.gruen) + Text(" niedrig")
                Text("● mittel")
                Text("●").foregroundStyle(RF.rot) + Text(" hoch")
                Text("- - bisher mind. \(nebenBisherPufferMin) min").foregroundStyle(.white)
            }
            .font(.grotesk(11))
            .padding(.top, 6)
            Text("Jeder Punkt ist ein Anschluss. \(o.unter_bisher ?? 0) haben weniger als \(nebenBisherPufferMin) min, \(o.ueber_bisher ?? 0) mehr.")
                .font(.grotesk(13)).foregroundStyle(.white)
                .padding(.top, 8)
        }
        .modifier(LimeRahmen())
        .padding(.top, 12)

        if !hoch.isEmpty {
            VStack(alignment: .leading, spacing: 0) {
                Text("Hohes Risiko").font(.grotesk(16, .bold))
                ForEach(alle ? hoch : Array(hoch.prefix(3)), id: \.id) { z in
                    HStack(alignment: .top, spacing: 10) {
                        VStack(alignment: .leading, spacing: 0) {
                            (Text(z.f.abfahrt ?? "").bold() + Text(" \(z.f.von ?? "") – \(z.f.nach ?? "")"))
                                .font(.grotesk(13)).cssZeile(13, 17)
                            Text(NebenRisiko.grund(z.f) + (z.f.luft.map { " · Puffer \(RF.zahl($0.puffer)) min" } ?? " · letzte Fahrt im Dienst"))
                                .font(.grotesk(11)).opacity(0.6)
                        }
                        Spacer(minLength: 0)
                        Text("hoch").font(.grotesk(11, .bold))
                            .padding(.horizontal, 6).padding(.vertical, 2)
                            .background(RF.rot)
                    }
                    .padding(.vertical, 9)
                    .overlay(alignment: .top) { Color(hex: 0xD9D9D9).frame(height: 1) }
                    .padding(.top, 8)
                }
                if hoch.count > 3 {
                    Button { alle.toggle() } label: {
                        Text(alle ? "Weniger anzeigen" : "Alle \(hoch.count) ansehen").font(.grotesk(13)).underline()
                            .padding(.vertical, 8)
                    }
                    .buttonStyle(.web)
                }
            }
            .foregroundStyle(RF.dunkel)
            .padding(.horizontal, 18).padding(.top, 16).padding(.bottom, 8)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color(hex: 0xFEFFFE))
            .padding(.top, 12)
        }

        WebText(text: "\(verlaeufe) Verläufe des Tages. Puffer = Zeit, die die Engine zwischen zwei Fahrten über die normale Fahrzeit hinaus freihält. Flug- und Zugverspätung nach Pünktlichkeitsstatistik 2025, Spieltagsfaktoren angenommen. Keine Messwerte.",
                groesse: 10, zeilenHoehe: 14, farbe: UIColor(hex: 0xE3F654).withAlphaComponent(0.6))
            .frame(width: 362)
            .padding(.top, 10)
    }

    private func kachel(_ label: String, _ wert: String, _ unter: String, _ farbe: Color) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label).font(.grotesk(13))
            Text(wert).font(.grotesk(32, .bold)).tracking(-0.5).frame(height: 36)
            WebText(text: unter, groesse: 12, zeilenHoehe: 15, farbe: UIColor(farbe))
            Spacer(minLength: 0)
        }
        .foregroundStyle(farbe)
        .padding(.horizontal, 16).padding(.vertical, 14)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .overlay(Rectangle().strokeBorder(farbe, lineWidth: 2))
    }
}

/// 2er Lime-Rahmen mit 16/14 Innenabstand, Text in Lime.
private struct LimeRahmen: ViewModifier {
    func body(content: Content) -> some View {
        content
            .foregroundStyle(NebenRisikoFarbe.lime)
            .padding(.horizontal, 16).padding(.vertical, 14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .overlay(Rectangle().strokeBorder(NebenRisikoFarbe.lime, lineWidth: 2))
    }
}
