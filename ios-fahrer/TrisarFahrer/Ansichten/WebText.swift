import SwiftUI
import UIKit

/// Mehrzeiliger Text mit fester Zeilenhoehe wie CSS `line-height` (z.B. `leading-[1.18]`,
/// `leading-[20px]`). SwiftUI kann die Zeilenhoehe nicht kleiner als die Schrift setzen,
/// darum ueber UILabel.
struct WebText: UIViewRepresentable {
    let text: String
    var groesse: CGFloat
    var gewicht: Font.Weight = .regular
    /// Zeilenhoehe in Punkt (CSS line-height).
    var zeilenHoehe: CGFloat
    var abstand: CGFloat = 0
    var farbe: UIColor = .white
    var ausrichtung: NSTextAlignment = .left

    func makeUIView(context: Context) -> UILabel {
        let label = UILabel()
        label.numberOfLines = 0
        label.lineBreakMode = .byWordWrapping
        label.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        return label
    }

    func updateUIView(_ label: UILabel, context: Context) {
        label.attributedText = attributiert
    }

    func sizeThatFits(_ proposal: ProposedViewSize, uiView: UILabel, context: Context) -> CGSize? {
        let breite = proposal.width ?? 10_000
        let rahmen = attributiert.boundingRect(with: CGSize(width: breite, height: .greatestFiniteMagnitude),
                                               options: [.usesLineFragmentOrigin], context: nil)
        return CGSize(width: proposal.width ?? ceil(rahmen.width), height: ceil(rahmen.height))
    }

    private var attributiert: NSAttributedString {
        let schrift = WebText.schrift(groesse, gewicht)
        let absatz = NSMutableParagraphStyle()
        absatz.minimumLineHeight = zeilenHoehe
        absatz.maximumLineHeight = zeilenHoehe
        absatz.alignment = ausrichtung
        absatz.lineBreakMode = .byWordWrapping
        // Text in der Zeile mittig setzen wie im Browser.
        let versatz = (zeilenHoehe - schrift.lineHeight) / 2
        return NSAttributedString(string: text, attributes: [
            .font: schrift,
            .foregroundColor: farbe,
            .kern: abstand,
            .paragraphStyle: absatz,
            .baselineOffset: versatz / 2,
        ])
    }

    /// Space Grotesk ist eine variable Schrift ohne eigene Namen je Gewicht
    /// (Basis "SpaceGrotesk-Light"), das Gewicht laeuft ueber die Achse wght.
    static func schrift(_ groesse: CGFloat, _ gewicht: Font.Weight) -> UIFont {
        let wert: Double
        switch gewicht {
        case .ultraLight, .thin, .light: wert = 300
        case .medium: wert = 500
        case .semibold: wert = 600
        case .bold, .heavy, .black: wert = 700
        default: wert = 400
        }
        guard let basis = UIFont(name: "SpaceGrotesk-Light", size: groesse) else { return .systemFont(ofSize: groesse) }
        let wght = 0x77676874 // 'wght'
        let beschreibung = basis.fontDescriptor.addingAttributes([
            UIFontDescriptor.AttributeName(rawValue: kCTFontVariationAttribute as String): [wght: wert],
        ])
        return UIFont(descriptor: beschreibung, size: groesse)
    }
}

extension Color {
    var ui: UIColor { UIColor(self) }
}
