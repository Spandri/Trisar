import SwiftUI

/// Lime der Formulare (GREEN in FahrtAdd.jsx).
let formularLime = Color(hex: 0xE3F654)

/// ETA-Marke rechts in der Zeile (etaIndicator).
struct EtaMarke: Equatable {
    var text = ""
    /// text-[#808080] grau, #f55757 rot, #ffb84d orange
    var farbe: UInt32 = 0x808080
}

/// Knopf rechts in der Zeile (rightAction): Haken, Kreuz oder Pfeil.
enum RechtsArt { case haken, kreuz, pfeil }

/// FormRow aus FahrtAdd.jsx: 362 x 56, 2 px Lime-Rand, Beschriftung halb deckend,
/// Eingabe dahinter, rechts ETA-Marke und Leeren-Knopf bzw. Pfeil.
struct FormularZeile<Feld: View>: View {
    let beschriftung: String
    let wert: String
    var eta: EtaMarke?
    var etaAktion: (() -> Void)?
    var rechts: RechtsArt?
    var rechtsAktion: (() -> Void)?
    let zuruecksetzen: () -> Void
    @ViewBuilder let feld: () -> Feld

    private var gefuellt: Bool { !FahrtText.getrimmt(wert).isEmpty }
    private var hatEta: Bool { !(eta?.text ?? "").isEmpty }

    var body: some View {
        ZStack(alignment: .leading) {
            Rectangle().strokeBorder(formularLime, lineWidth: 2)
            // p-1 + px-3 links, pr-10 bzw. pr-16 rechts, gap-4 zwischen Beschriftung und Eingabe.
            HStack(spacing: 16) {
                Text(beschriftung)
                    .font(.grotesk(16, .medium)).tracking(0.5)
                    .foregroundStyle(formularLime.opacity(0.5))
                    .lineLimit(1).fixedSize()
                feld().frame(maxWidth: .infinity, alignment: .leading)
            }
            .padding(.leading, 18)
            .padding(.trailing, 6 + (hatEta ? 64 : 40))
            HStack(spacing: 8) {
                if let eta, hatEta {
                    if let etaAktion {
                        Button(action: etaAktion) {
                            Text(eta.text).font(.grotesk(12, .bold)).underline().foregroundStyle(Color(hex: eta.farbe))
                        }
                        .buttonStyle(.web)
                    } else {
                        Text(eta.text).font(.grotesk(12, .bold)).foregroundStyle(Color(hex: eta.farbe))
                    }
                }
                if let rechts {
                    Button { rechtsAktion?() } label: {
                        Group {
                            switch rechts {
                            case .haken: Text("✓").font(.system(size: 16, weight: .bold)).foregroundStyle(Color(hex: 0x59BE80))
                            case .kreuz: Text("✕").font(.system(size: 16, weight: .bold)).foregroundStyle(Color(hex: 0xF55757))
                            case .pfeil: Image("Arrow-kurz_Trisar_Icons_01_Lime").resizable().frame(width: 10, height: 13)
                            }
                        }
                        // Pfeil buendig rechts wie in den Zeilen ohne Knopf, Haken/Kreuz mittig.
                        .frame(width: 20, height: 20, alignment: rechts == .pfeil ? .trailing : .center)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.web)
                } else if gefuellt {
                    Button(action: zuruecksetzen) {
                        Image("clear-field-green").resizable().frame(width: 20, height: 20).contentShape(Rectangle())
                    }
                    .buttonStyle(.web)
                    .accessibilityLabel("\(beschriftung) zurücksetzen")
                } else {
                    Image("Arrow-kurz_Trisar_Icons_01_Lime").resizable().frame(width: 10, height: 13)
                        .allowsHitTesting(false)
                }
            }
            .frame(maxWidth: .infinity, alignment: .trailing)
            .padding(.trailing, 14)
        }
        .frame(width: 362, height: 56)
        .clipped()
    }
}

/// Eingabe in der Zeile: Space Grotesk 16 medium, Lime.
struct ZeilenEingabe: View {
    @Binding var text: String
    var tastatur: UIKeyboardType = .default
    /// Nur waehrend Fahrer/Gaeste laden („Fahrer werden geladen...“), sonst leer wie im Web.
    var platzhalter = ""
    var body: some View {
        TextField("", text: $text, prompt: Text(platzhalter).foregroundStyle(formularLime.opacity(0.5)))
            .font(.grotesk(16, .medium)).tracking(0.5)
            .foregroundStyle(formularLime)
            .tint(formularLime)
            .keyboardType(tastatur)
            .autocorrectionDisabled()
            .textInputAutocapitalization(tastatur == .numberPad ? .never : .sentences)
            .lineLimit(1)
    }
}

/// Wert-Anzeige fuer Datum/Uhrzeit/Auswahl (wie das native Feld im Browser).
struct ZeilenWert: View {
    let text: String
    var body: some View {
        Text(text).font(.grotesk(16, .medium)).tracking(0.5).foregroundStyle(formularLime).lineLimit(1)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
            .contentShape(Rectangle())
    }
}

/// Vorschlagsliste unter einer Zeile: max. 180 hoch, rounded-2xl, Rand #4a4f22, Grund #151607.
struct VorschlagListe: View {
    let eintraege: [String]
    var kopf: String?
    var maxHoehe: CGFloat = 180
    /// Icon je Eintrag (eigene Orte stehen mit ihrem Icon oben), nil = ohne Icon.
    var icons: [String?] = []
    let waehlen: (Int) -> Void
    /// Gemessene Hoehe des Inhalts: Liste so hoch wie der Inhalt, hoechstens maxHoehe (max-h + overflow-y-auto).
    @State private var hoehe: CGFloat = 0

    var body: some View {
        ScrollView(.vertical, showsIndicators: true) {
            inhalt.background(GeometryReader { g in
                Color.clear
                    .onAppear { hoehe = g.size.height }
                    .onChange(of: g.size.height) { _, neu in hoehe = neu }
            })
        }
        .scrollBounceBehavior(.basedOnSize)
        .frame(width: 362, height: min(hoehe, maxHoehe))
        .background(Color(hex: 0x151607))
        .clipShape(RoundedRectangle(cornerRadius: 16))
        .overlay(RoundedRectangle(cornerRadius: 16).strokeBorder(Color(hex: 0x4A4F22), lineWidth: 1))
    }

    private var inhalt: some View {
        VStack(spacing: 0) {
            if let kopf {
                Text(kopf.uppercased())
                    .font(.grotesk(11, .bold)).tracking(0.275)
                    .foregroundStyle(formularLime).opacity(0.6)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 12).padding(.top, 12).padding(.bottom, 4)
            }
            ForEach(Array(eintraege.enumerated()), id: \.offset) { i, eintrag in
                Button { waehlen(i) } label: {
                    HStack(spacing: 10) {
                        if i < icons.count, let icon = icons[i] {
                            Image(icon).resizable().scaledToFit().frame(width: 20, height: 20)
                        }
                        Text(eintrag)
                            .font(.grotesk(13, .medium))
                            .foregroundStyle(formularLime)
                            .multilineTextAlignment(.leading)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .padding(12)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.web)
                if i < eintraege.count - 1 {
                    Rectangle().fill(Color(hex: 0x2A2D15)).frame(height: 1)
                }
            }
        }
    }
}

/// Lime-Knopf „Fahrt speichern“: Text links (p-1 + px-3), schwarzer Pfeil rechts (mr-4).
struct FormularSpeichernKnopf: View {
    let text: String
    let gesperrt: Bool
    let aktion: () -> Void
    var body: some View {
        Button(action: aktion) {
            HStack(spacing: 0) {
                Text(text).font(.grotesk(16, .medium)).tracking(0.4).foregroundStyle(Color(hex: 0x262626))
                Spacer(minLength: 0)
                Image("Arrow_Trisar_Icons_01").resizable().frame(width: 34, height: 20)
            }
            .padding(.leading, 18).padding(.trailing, 18)
            .frame(width: 362, height: 56)
            .background(formularLime)
            .overlay(Rectangle().strokeBorder(formularLime, lineWidth: 2))
            .contentShape(Rectangle())
        }
        .buttonStyle(.web)
        .disabled(gesperrt)
        .opacity(gesperrt ? 0.7 : 1)
    }
}
