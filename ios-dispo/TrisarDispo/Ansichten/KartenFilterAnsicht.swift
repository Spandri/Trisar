import SwiftUI

/// KartenFilterView.jsx: Fahrersuche, Karosserie, Feierabend, speichern und loeschen.
/// Wie im Web wirkt auf der Karte nur die Fahrersuche (mehrere Begriffe mit ';').
struct KartenFilterAnsicht: View {
    @ObservedObject var filter: KartenFilter
    let zurueck: () -> Void
    private static let lime = Color(hex: 0xE3F654)

    var body: some View {
        ZStack(alignment: .topLeading) {
            DispoHintergrund().ignoresSafeArea()
            Leinwand(basisHoehe: 874, inhaltHoehe: 834 + 70, mitHintergrund: false) { _ in
                ZStack(alignment: .topLeading) {
                    ZurueckKnopf(aktion: zurueck).platz(20, 60, 50, 50)
                    Text("Karten Filter").grotesk(42, .bold).foregroundStyle(Self.lime).frame(height: 42)
                        .platz(20, 140, nil, 42)

                    SuchZeile(text: $filter.fahrerSuche).platz(20, 206, 362, 56)

                    ZweierKnopf(text: "Limosine", an: $filter.limousine).platz(20, 286, 175, 40)
                    ZweierKnopf(text: "SUV", an: $filter.suv).platz(207, 286, 175, 40)
                    ZweierKnopf(text: "VAN", an: $filter.van).platz(20, 338, 175, 40)
                    ZweierKnopf(text: "Coupe", an: $filter.coupe).platz(207, 338, 175, 40)

                    FeierabendZeile(wert: $filter.feierabendMinuten).platz(20, 402, 362, 56)

                    Button(action: zurueck) {
                        HStack {
                            Text("Filter speichern").grotesk(16, .medium, abstand: 0.4).foregroundStyle(Color(hex: 0x1D1C1D))
                            Spacer()
                            Image("Arrow_Trisar_Icons_01").resizable().frame(width: 34, height: 20)
                        }
                        .padding(.horizontal, 12)
                        .frame(width: 362, height: 56)
                        .background(Self.lime)
                    }
                    .buttonStyle(.web)
                    .platz(20, 482, 362, 56)

                    Button { filter.zuruecksetzen() } label: {
                        HStack {
                            Text("Filter Löschen").grotesk(16, .medium, abstand: 0.4).foregroundStyle(Color(hex: 0x1D1C1D))
                            Spacer()
                            Image("Arrow_Nav_Trisar_Icons_01").resizable().frame(width: 34, height: 20)
                        }
                        .padding(.horizontal, 12)
                        .frame(width: 362, height: 56)
                        .background(Color(hex: 0xFF6B6B))
                    }
                    .buttonStyle(.web)
                    .platz(20, 550, 362, 56)
                }
            }
            FussleisteUnten()
        }
    }
}

/// SearchInputRow: links "Fahrer Suchen", beim Tippen "Fahrer" und das Feld, rechts Lupe oder Loeschen.
private struct SuchZeile: View {
    @Binding var text: String
    @FocusState private var fokus: Bool
    private static let lime = Color(hex: 0xE3F654)

    var body: some View {
        let hatWert = !text.trimmingCharacters(in: .whitespaces).isEmpty
        HStack(spacing: 12) {
            Text(fokus || hatWert ? "Fahrer" : "Fahrer Suchen").grotesk(16, .medium, abstand: 0.5)
                .foregroundStyle(Self.lime.opacity(0.6)).fixedSize()
            TextField("", text: $text)
                .font(.grotesk(16, .medium)).tracking(0.5)
                .foregroundStyle(Self.lime)
                .tint(Self.lime)
                .autocorrectionDisabled()
                .textInputAutocapitalization(.never)
                .focused($fokus)
            Group {
                if hatWert {
                    Button { text = ""; fokus = true } label: {
                        Image("clear-field-green").resizable().frame(width: 20, height: 20)
                    }
                    .buttonStyle(.web)
                    .accessibilityLabel("Fahrer zurücksetzen")
                } else {
                    Image("karten-filter-search").resizable().frame(width: 24, height: 24)
                }
            }
            .frame(width: 24, height: 24)
        }
        .padding(.horizontal, 12)
        .frame(width: 362, height: 56)
        .overlay(Rectangle().strokeBorder(Self.lime, lineWidth: 2))
        .contentShape(Rectangle())
        .onTapGesture { fokus = true }
    }
}

/// TwoColButton: Rahmen Lime, an = Lime gefuellt mit dunkler Schrift.
private struct ZweierKnopf: View {
    let text: String
    @Binding var an: Bool
    private static let lime = Color(hex: 0xE3F654)

    var body: some View {
        Button { an.toggle() } label: {
            Text(text).grotesk(16, .medium, abstand: 0.4)
                .foregroundStyle(an ? Color(hex: 0x1D1C1D) : Self.lime)
                .frame(width: 175, height: 40)
                .background(an ? Self.lime : Color.clear)
                .overlay(Rectangle().strokeBorder(Self.lime, lineWidth: 2))
        }
        .buttonStyle(.web)
    }
}

/// MinutePickerRow: "Feierabend in ... min", gewaehlt "Feierabend in 30 min", rechts Uhr oder Loeschen.
private struct FeierabendZeile: View {
    @Binding var wert: String
    private static let lime = Color(hex: 0xE3F654)
    private static let optionen = ["15 min", "30 min", "45 min", "60 min", "90 min", "120 min"]

    var body: some View {
        HStack(spacing: 0) {
            Menu {
                Button("---") { wert = "" }
                ForEach(Self.optionen, id: \.self) { o in Button(o) { wert = o } }
            } label: {
                Group {
                    if wert.isEmpty {
                        Text("Feierabend in ... min").foregroundStyle(Self.lime.opacity(0.6))
                    } else {
                        (Text("Feierabend in ").foregroundStyle(Self.lime.opacity(0.6)) + Text(wert).foregroundStyle(Self.lime))
                    }
                }
                .font(.grotesk(16, .medium)).tracking(0.5)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
                .contentShape(Rectangle())
            }
            .accessibilityLabel("Feierabend in Minuten")
            Group {
                if wert.isEmpty {
                    Image("clock-green").resizable().frame(width: 20, height: 20)
                } else {
                    Button { wert = "" } label: { Image("clear-field-green").resizable().frame(width: 20, height: 20) }
                        .buttonStyle(.web)
                        .accessibilityLabel("Feierabend zurücksetzen")
                }
            }
            .frame(width: 40, height: 40)
        }
        .padding(.horizontal, 12)
        .frame(width: 362, height: 56)
        .overlay(Rectangle().strokeBorder(Self.lime, lineWidth: 2))
    }
}
