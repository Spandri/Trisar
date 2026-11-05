import SwiftUI

/// Gemeinsame Bausteine der Stammdaten-Seiten (Fahrzeuge, Fahrgaeste, Profil).

/// Seitentitel: 42 fett, Lime, CSS leading-[42px].
struct StammTitel: View {
    let text: String
    var groesse: CGFloat = 42
    var abstand: CGFloat = 0
    var farbe: UInt32 = 0xE3F654
    var body: some View {
        WebText(text: text, groesse: groesse, gewicht: .bold, zeilenHoehe: groesse, abstand: abstand, farbe: UIColor(hex: farbe))
            .fixedSize()
    }
}

/// `Box` aus FahrzeugErstellenView/SettingsViewKo: 2er Lime-Rahmen, Eingabe in #8a9728,
/// rechts der kurze Pfeil, der das Feld fokussiert.
struct BoxFeld<Fokus: Hashable>: View {
    let platzhalter: String
    @Binding var wert: String
    let fokus: FocusState<Fokus?>.Binding
    let art: Fokus
    var links: CGFloat = 16
    var rechts: CGFloat = 48
    var pfeil = true
    var tastatur: UIKeyboardType = .default
    var grossschreibung: TextInputAutocapitalization = .sentences

    var body: some View {
        ZStack(alignment: .leading) {
            Rectangle().strokeBorder(Color(hex: 0xE3F654), lineWidth: 2)
            TextField("", text: $wert, prompt: Text(verbatim: platzhalter).foregroundStyle(Color(hex: 0x8A9728).opacity(0.9)))
                .font(.grotesk(16, .medium)).tracking(0.5)
                .foregroundStyle(Color(hex: 0x8A9728))
                .tint(Color(hex: 0xE3F654))
                .keyboardType(tastatur)
                .textInputAutocapitalization(grossschreibung)
                .autocorrectionDisabled()
                .focused(fokus, equals: art)
                .padding(.leading, links).padding(.trailing, rechts)
            if pfeil {
                Button { fokus.wrappedValue = art } label: {
                    Image("Arrow-kurz_Trisar_Icons_01_Lime").resizable().frame(width: 10, height: 13)
                        .frame(width: 34, height: 44).contentShape(Rectangle())
                }
                .buttonStyle(.web)
                .frame(maxWidth: .infinity, alignment: .trailing)
            }
        }
    }
}

/// Voller Lime-Knopf mit Text links und Icon rechts (Fahrzeug erstellen, Filter speichern, ...).
struct StammZeilenKnopf: View {
    let text: String
    let icon: String
    var iconGroesse = CGSize(width: 24, height: 24)
    var hintergrund: UInt32 = 0xE3F654
    var textFarbe: UInt32 = 0x1D1C1D
    var innen: CGFloat = 16
    var abstand: CGFloat = 0.4
    let aktion: () -> Void

    var body: some View {
        Button(action: aktion) {
            HStack(spacing: 0) {
                Text(text).font(.grotesk(16, .medium)).tracking(abstand).foregroundStyle(Color(hex: textFarbe))
                Spacer(minLength: 0)
                Image(icon).resizable().scaledToFit().frame(width: iconGroesse.width, height: iconGroesse.height)
            }
            .padding(.horizontal, innen)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Color(hex: hintergrund))
            .contentShape(Rectangle())
        }
        .buttonStyle(.web)
    }
}
