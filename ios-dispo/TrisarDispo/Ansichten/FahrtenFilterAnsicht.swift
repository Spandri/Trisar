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
    // "Ankuenfte bei mir" (17.11.): Abschnitt unter "auch vergangene", 24 px Abstand davor.
    @ObservedObject private var ankunft = AnkunftMelden.geteilt
    private var ankunftOben: CGFloat { schalterStart + schritt * 5 + 12 }
    /// ankunftHoehe im Web: Schalter allein oder mit Ort und Melden.
    private var ankunftHoehe: CGFloat {
        guard ankunft.vorhanden else { return 0 }
        return 12 + (ankunft.an ? schritt * 3 : schritt)
    }
    private var knopfOben: CGFloat { feldStart + schritt * 8 + 12 + 12 + ankunftHoehe }  // BUTTON_TOP + ankunftHoehe
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

                    if ankunft.vorhanden {
                        AnkunftAbschnitt(ankunft: ankunft, oben: block + ankunftOben, schritt: schritt)
                    }

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
        .task { await ankunft.laden() }
    }
}

/// "Ankuenfte bei mir" (AnkunftAbschnitt in FahrtenFilter.jsx): Schalter, darunter Ort und Melden,
/// nur wenn eingeschaltet. Ort zuerst "Automatisch", sonst ein fester Ort. Wird sofort auf dem Server
/// gespeichert (AnkunftMelden), unabhaengig von "Filter speichern". Keine Hinweiszeile, ein Fehler
/// steht rot im Ort-Feld.
private struct AnkunftAbschnitt: View {
    @ObservedObject var ankunft: AnkunftMelden
    let oben: CGFloat
    let schritt: CGFloat

    @State private var hole = false
    @State private var ohneStandort = false

    var body: some View {
        ZStack(alignment: .topLeading) {
            FilterSchalter(titel: AnkunftTexte.schalter, an: Binding(get: { ankunft.an }, set: { _ in schalten() }))
                .platz(20, oben, 362, 56)
            if ankunft.an {
                AuswahlZeile(titel: AnkunftTexte.ort, wert: fehlerText ?? ortWert, nach: fehlerText == nil ? ortNach : nil,
                             fehler: fehlerText != nil, icon: "Pin_Nav_Trisar_Icons_01_Lime") {
                    Button(AnkunftTexte.automatisch) { Task { await automatikStarten(an: true) } }
                    ForEach(ankunft.orte) { o in
                        Button(o.name) { ortWaehlen(o) }
                    }
                }
                .platz(20, oben + schritt, 362, 56)

                AuswahlZeile(titel: AnkunftTexte.melden, wert: AnkunftTexte.minuten(ankunft.minuten),
                             nach: ankunft.minuten == 0 ? nil : AnkunftTexte.vorAnkunft, icon: "clock-green") {
                    Picker(AnkunftTexte.melden, selection: Binding(
                        get: { ankunft.minuten },
                        set: { m in Task { await ankunft.setzen(minuten: m) } }
                    )) {
                        ForEach(AnkunftMelden.minutenAuswahl, id: \.self) { m in
                            Text(AnkunftTexte.minuten(m)).tag(m)
                        }
                    }
                }
                .platz(20, oben + schritt * 2, 362, 56)
            }
        }
        // Kommt spaeter doch ein Standort, ist der Fehler erledigt.
        .onChange(of: ankunft.lat) { _, neu in if neu != nil { ohneStandort = false } }
    }

    private var fehlerText: String? {
        if ankunft.fehler { return AnkunftTexte.fehler }
        if ohneStandort { return AnkunftTexte.standortFehlt }
        return nil
    }

    private var ortWert: String {
        if hole { return AnkunftTexte.standortLaedt }
        if !ankunft.ortName.isEmpty { return ankunft.ortName }
        return ankunft.lat != nil ? AnkunftTexte.meinStandort : "–"
    }

    /// "Bayerischer Hof (hier)": Automatik hat einen gespeicherten Ort getroffen.
    private var ortNach: String? {
        !hole && ankunft.automatisch && ankunft.ortId != nil ? "(\(AnkunftTexte.hier))" : nil
    }

    private func automatikStarten(an: Bool) async {
        hole = true
        ohneStandort = false
        let pos = await ankunft.standortHolen()
        hole = false
        guard let pos else {
            ohneStandort = true
            await ankunft.setzen(an: an, automatisch: true)
            return
        }
        await ankunft.setzen(an: an, automatisch: true, ort: ankunft.automatikZiel(pos))
    }

    private func schalten() {
        Task {
            if ankunft.an { await ankunft.setzen(an: false); return }
            if ankunft.automatisch || ankunft.lat == nil || ankunft.lng == nil { await automatikStarten(an: true); return }
            await ankunft.setzen(an: true)
        }
    }

    private func ortWaehlen(_ ort: AnkunftOrt) {
        ohneStandort = false
        Task { await ankunft.setzen(automatisch: false, ort: (id: ort.id, name: ort.name, lat: ort.lat, lng: ort.lng)) }
    }
}

/// AuswahlZeile im Look der Eingabezeilen: Titel blass, Wert hell (Fehler rot), Icon rechts. Tippen oeffnet
/// die Auswahl als iOS-Menue (im Web liegt dafuer ein unsichtbares select darueber).
private struct AuswahlZeile<Optionen: View>: View {
    let titel: String
    let wert: String
    let nach: String?
    var fehler = false
    let icon: String
    @ViewBuilder let optionen: () -> Optionen
    private let lime = Color(hex: 0xE3F654)

    var body: some View {
        Menu {
            optionen()
        } label: {
            HStack(spacing: 0) {
                HStack(spacing: 16) {
                    Text(titel).foregroundStyle(lime).opacity(0.5).fixedSize()
                    (Text(wert).foregroundColor(fehler ? Color(hex: 0xFF6F63) : lime)
                     + Text(nach.map { " \($0)" } ?? "").foregroundColor(lime.opacity(0.6)))
                        .lineLimit(1).truncationMode(.tail)
                }
                .font(.grotesk(16, .medium)).tracking(0.5)
                .frame(maxWidth: .infinity, alignment: .leading)
                Image(icon).resizable().frame(width: 20, height: 20)
            }
            // border 2 + px-3
            .padding(.horizontal, 14)
            .frame(width: 362, height: 56)
            .overlay(Rectangle().strokeBorder(lime, lineWidth: 2))
            .contentShape(Rectangle())
        }
        .accessibilityLabel(titel)
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
