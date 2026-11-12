import SwiftUI

/// TRISAR-Look auf der Uhr: schwarz, Lime, Space Grotesk, Kacheln #242525 mit Radius 12.
/// Gleiche Werte wie Stil.swift der iPhone-App und die Web-App.
enum UhrFarbe {
    static let lime = Color(red: 227 / 255, green: 246 / 255, blue: 84 / 255)     // #E3F654
    static let gruen = Color(red: 89 / 255, green: 190 / 255, blue: 128 / 255)    // #59BE80
    static let rot = Color(red: 255 / 255, green: 111 / 255, blue: 99 / 255)      // #FF6F63
    static let orange = Color(red: 255 / 255, green: 184 / 255, blue: 77 / 255)   // #FFB84D
    static let kachel = Color(red: 36 / 255, green: 37 / 255, blue: 37 / 255)     // #242525
    static let rand = Color(red: 58 / 255, green: 58 / 255, blue: 58 / 255)       // #3A3A3A
    static let grau = Color(red: 134 / 255, green: 135 / 255, blue: 134 / 255)    // #868786
}

extension Font {
    static func grotesk(_ groesse: CGFloat, _ gewicht: Font.Weight = .regular) -> Font {
        .custom("Space Grotesk", size: groesse).weight(gewicht)
    }
}

/// Hintergrund wie in den Apps: Leuchten oben links, sonst schwarz.
/// Fahrer: dunkles Lime. Dispo: Blau wie die Web-Dispo (#0048CF ueber #002468 zu Schwarz).
struct UhrHintergrund: View {
    enum Art { case fahrer, dispo }
    var art: Art = .fahrer

    private var farben: [Color] {
        switch art {
        case .fahrer:
            return [Color(red: 49 / 255, green: 55 / 255, blue: 1 / 255), .black]
        case .dispo:
            return [Color(red: 0, green: 72 / 255, blue: 207 / 255),
                    Color(red: 0, green: 36 / 255, blue: 104 / 255),
                    .black]
        }
    }

    var body: some View {
        ZStack {
            Color.black
            RadialGradient(colors: farben, center: .topLeading, startRadius: 0, endRadius: art == .dispo ? 190 : 160)
        }
        .ignoresSafeArea()
    }
}

/// Kachel #242525, Radius 12, optional mit Rand in einer Farbe.
struct Kachel<Inhalt: View>: View {
    var rand: Color? = nil
    @ViewBuilder var inhalt: Inhalt

    var body: some View {
        inhalt
            .padding(10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: 12).fill(UhrFarbe.kachel))
            .overlay(RoundedRectangle(cornerRadius: 12).stroke(rand ?? .clear, lineWidth: 2))
    }
}

/// Knoepfe wie in den Apps: voll Lime (Annehmen) und rot umrandet (Ablehnen).
struct LimeKnopf: View {
    let text: String
    var arbeitet = false
    let aktion: () -> Void

    var body: some View {
        Button(action: aktion) {
            Text(arbeitet ? "…" : text)
                .font(.grotesk(15, .bold))
                .foregroundStyle(.black)
                .frame(maxWidth: .infinity, minHeight: 36)
                .background(RoundedRectangle(cornerRadius: 12).fill(UhrFarbe.lime))
        }
        .buttonStyle(.plain)
        .disabled(arbeitet)
    }
}

struct RotKnopf: View {
    let text: String
    var arbeitet = false
    let aktion: () -> Void

    var body: some View {
        Button(action: aktion) {
            Text(text)
                .font(.grotesk(15, .bold))
                .foregroundStyle(UhrFarbe.rot)
                .frame(maxWidth: .infinity, minHeight: 36)
                .overlay(RoundedRectangle(cornerRadius: 12).stroke(UhrFarbe.rot, lineWidth: 2))
        }
        .buttonStyle(.plain)
        .disabled(arbeitet)
    }
}

enum UhrText {
    /// "Heute", "Morgen", sonst "Mi 13.11."
    static func tag(_ iso: String) -> String {
        let f = DateFormatter()
        f.locale = Locale(identifier: "de_DE")
        f.dateFormat = "yyyy-MM-dd"
        guard let datum = f.date(from: iso) else { return iso }
        let kalender = Calendar.current
        if kalender.isDateInToday(datum) { return "Heute" }
        if kalender.isDateInTomorrow(datum) { return "Morgen" }
        f.dateFormat = "EE dd.MM."
        return f.string(from: datum)
    }

    static func statusFarbe(_ status: String) -> Color {
        switch status {
        case "Unterwegs": return UhrFarbe.gruen
        case "Beim Gast": return UhrFarbe.lime
        case "Antwort offen": return UhrFarbe.orange
        default: return .white.opacity(0.6)
        }
    }

    /// "vor 20 s", "vor 3 min", "vor 2 h"
    static func vor(_ datum: Date?) -> String {
        guard let datum else { return "noch nie" }
        let s = Int(Date().timeIntervalSince(datum))
        if s < 60 { return "vor \(max(0, s)) s" }
        if s < 3600 { return "vor \(s / 60) min" }
        return "vor \(s / 3600) h"
    }
}
