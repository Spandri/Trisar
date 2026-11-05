import SwiftUI

/// Nachbau von FahrtenFilter.jsx. Alles absolut im 402er Raster, der Block beginnt bei top 40.
/// Die Werte gelten sofort (wie onChangeFilters im Web), „Filter speichern“ geht nur zurueck.
struct FahrtenFilterAnsicht: View {
    @Binding var filter: FahrtenFilterWerte
    let zurueck: () -> Void

    private let lime = Color(hex: 0xE3F654)
    // Konstanten aus FahrtenFilter.jsx
    private let block: CGFloat = 40                 // CONTENT_OFFSET_TOP / top-10
    private let feldStart: CGFloat = 166            // FIELD_START_TOP
    private let schritt: CGFloat = 68               // ROW_STEP
    private var schalterStart: CGFloat { feldStart + schritt * 3 + 12 }          // TOGGLE_START_TOP
    private var knopfOben: CGFloat { feldStart + schritt * 8 + 12 + 12 }         // BUTTON_TOP
    private var inhaltHoehe: CGFloat { block + knopfOben + 56 + 30 + 40 }

    var body: some View {
        ZStack(alignment: .topLeading) {
            DispoHintergrund().ignoresSafeArea()
            FlussLeinwand {
                ZStack(alignment: .topLeading) {
                    ZurueckKnopf(aktion: zurueck).platz(20, block + 20, 50, 50)

                    Text("Fahrten Filter")
                        .font(.grotesk(42, .bold)).foregroundStyle(lime)
                        .cssZeile(42, 42)
                        .fixedSize()
                        .platz(20, block + 100)

                    FilterEingabe(titel: "Start", text: $filter.startSuche).platz(20, block + feldStart, 362, 56)
                    FilterEingabe(titel: "Ziel", text: $filter.zielSuche).platz(20, block + feldStart + schritt, 362, 56)
                    FilterDatum(titel: "Datum", wert: $filter.datum).platz(20, block + feldStart + schritt * 2, 362, 56)

                    FilterSchalter(titel: "ohne Fahrer*in", an: $filter.ohneFahrer).platz(20, block + schalterStart, 362, 56)
                    FilterSchalter(titel: "Fahrbestätigung", an: $filter.bestaetigung).platz(20, block + schalterStart + schritt, 362, 56)
                    FilterSchalter(titel: "Konvoi", an: $filter.konvoi).platz(20, block + schalterStart + schritt * 2, 362, 56)
                    FilterSchalter(titel: "mit Besonderheiten", an: $filter.besonderheiten).platz(20, block + schalterStart + schritt * 3, 362, 56)
                    FilterSchalter(titel: "auch vergangene", an: $filter.vergangene).platz(20, block + schalterStart + schritt * 4, 362, 56)

                    Button(action: zurueck) {
                        HStack(spacing: 4) {
                            Text("Filter speichern").font(.grotesk(16, .medium)).tracking(0.4)
                                .foregroundStyle(Color(hex: 0x262626))
                                .padding(.leading, 16)
                            Spacer(minLength: 0)
                            Image("Arrow_Trisar_Icons_01").resizable().frame(width: 34, height: 20).padding(.trailing, 16)
                        }
                        .frame(width: 362, height: 56)
                        .background(lime)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.web)
                    .platz(20, block + knopfOben, 362, 56)
                }
                .frame(width: 402, height: inhaltHoehe, alignment: .topLeading)
            }
            FussleisteUnten()
        }
    }
}

/// InputRow: Lime-Rahmen, Titel halbtransparent, Eingabe, rechts Loeschen oder kurzer Pfeil.
private struct FilterRahmen<Inhalt: View>: View {
    let titel: String
    let hatWert: Bool
    let leeren: () -> Void
    @ViewBuilder let inhalt: () -> Inhalt
    private let lime = Color(hex: 0xE3F654)

    var body: some View {
        ZStack(alignment: .trailing) {
            HStack(spacing: 16) {
                Text(titel).font(.grotesk(16, .medium)).tracking(0.5).foregroundStyle(lime).opacity(0.5)
                    .fixedSize()
                inhalt()
            }
            // border 2 + p-1 + px-3, rechts pr-10 fuer das Icon
            .padding(.leading, 18).padding(.trailing, 2 + 4 + 40)
            .frame(width: 362, height: 56, alignment: .leading)
            if hatWert {
                Button(action: leeren) {
                    Image("clear-field-green").resizable().frame(width: 20, height: 20)
                        .frame(width: 32, height: 40).contentShape(Rectangle())
                }
                .buttonStyle(.web)
                .padding(.trailing, 2 + 4 + 12 - 6)
                .accessibilityLabel("\(titel) zurücksetzen")
            } else {
                Image("Arrow-kurz_Trisar_Icons_01_Lime").resizable().frame(width: 10, height: 13)
                    .padding(.trailing, 2 + 4 + 12)
                    .allowsHitTesting(false)
            }
        }
        .frame(width: 362, height: 56)
        .overlay(Rectangle().strokeBorder(lime, lineWidth: 2))
    }
}

private struct FilterEingabe: View {
    let titel: String
    @Binding var text: String
    var body: some View {
        FilterRahmen(titel: titel, hatWert: !text.trimmingCharacters(in: .whitespaces).isEmpty, leeren: { text = "" }) {
            TextField("", text: $text).eingabeStil()
        }
    }
}

/// `<input type="date">`: zeigt TT.MM.JJJJ wie der Browser, Tippen oeffnet die Datumsauswahl.
private struct FilterDatum: View {
    let titel: String
    @Binding var wert: String
    private let lime = Color(hex: 0xE3F654)

    var body: some View {
        FilterRahmen(titel: titel, hatWert: !wert.isEmpty, leeren: { wert = "" }) {
            ZStack(alignment: .leading) {
                Text(anzeige).font(.grotesk(16, .medium)).tracking(0.5).foregroundStyle(lime)
                    .opacity(wert.isEmpty ? 0.5 : 1)
                // Unsichtbare Auswahl ueber dem Text, damit ein Tipp sie oeffnet.
                DatePicker("", selection: Binding(
                    get: { wert.isEmpty ? Date() : Datum.ausTagWert(wert) },
                    set: { wert = Datum.tagWert($0) }
                ), displayedComponents: .date)
                .labelsHidden()
                .environment(\.locale, Locale(identifier: "de_DE"))
                .opacity(0.02)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private var anzeige: String {
        let t = wert.split(separator: "-")
        return t.count == 3 ? "\(t[2]).\(t[1]).\(t[0])" : "TT.MM.JJJJ"
    }
}

/// ToggleRow: aktiv = Lime-Flaeche mit dunkler Schrift, sonst Lime-Rahmen.
private struct FilterSchalter: View {
    let titel: String
    @Binding var an: Bool
    private let lime = Color(hex: 0xE3F654)
    var body: some View {
        Button { an.toggle() } label: {
            Text(titel).font(.grotesk(16, .medium)).tracking(0.4)
                .foregroundStyle(an ? Color(hex: 0x262626) : lime)
                .frame(width: 362, height: 56)
                .background(an ? lime : .clear)
                .overlay(Rectangle().strokeBorder(lime, lineWidth: 2))
                .contentShape(Rectangle())
        }
        .buttonStyle(.web)
    }
}
