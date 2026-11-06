import SwiftUI

/// Was wir ueber das Fahrzeug wissen (fahrzeugAngaben.js der Web-App). Leere Felder
/// werden nicht gezeigt: kein "–", keine graue Bildflaeche.
struct FahrzeugAngaben: Equatable {
    var kennzeichen = ""
    var vin = ""
    var bild: URL?
    var modell = ""
    var ausstattung = ""
    var kraftstoff = ""
    var farbe = ""
    var sitze: Int?
    var fuellstand: Double?
    var reichweite: Double?

    @MainActor init(_ f: FahrzeugZeile?, ausstattung: String = "") {
        func t(_ v: String?) -> String { (v ?? "").trimmingCharacters(in: .whitespacesAndNewlines) }
        kennzeichen = t(f?.license_plate)
        vin = t(f?.vin)
        // Bild, das nicht geladen werden konnte, zaehlt wie kein Bild.
        bild = FahrzeugKarte.bildURL(f?.image_url).flatMap { FahrzeugBildSpeicher.shared.kaputt.contains($0) ? nil : $0 }
        modell = t(f?.brand_model)
        self.ausstattung = t(ausstattung)
        kraftstoff = t(f?.fuel_type)
        farbe = t(f?.color)
        sitze = (f?.seat_count ?? 0) > 0 ? f?.seat_count : nil
        fuellstand = f?.battery_fuel_percent
        reichweite = f?.range_km
        #if DEBUG
        // Testansicht "nur Kennzeichen + Standort": Start mit Argument -TRISAR_NUR_KENNZEICHEN.
        if Self.nurKennzeichenTest {
            vin = ""; bild = nil; modell = ""; self.ausstattung = ""; kraftstoff = ""; farbe = ""
            sitze = nil; fuellstand = nil; reichweite = nil
        }
        #endif
    }

    #if DEBUG
    static let nurKennzeichenTest = ProcessInfo.processInfo.arguments.contains("-TRISAR_NUR_KENNZEICHEN")
    #else
    static let nurKennzeichenTest = false
    #endif

    var energie: Bool { fuellstand != nil }
    var hatKacheln: Bool { !kraftstoff.isEmpty || !farbe.isEmpty || energie || sitze != nil }

    /// Startseiten-Karte (362 breit), kartenRaster der Web-App. Mit allem: 268 hoch.
    struct KartenRaster { var vin: CGFloat?; var bild: CGFloat?; var kacheln: CGFloat?; var hoehe: CGFloat }
    func kartenRaster(bildOben: CGFloat = 63) -> KartenRaster {
        var r = KartenRaster(hoehe: 0)
        var y: CGFloat = 52
        if !vin.isEmpty { r.vin = 51.97; y = 68 }
        if bild != nil { r.bild = bildOben; y = bildOben + 114.91 }
        if hatKacheln { r.kacheln = y + 17.65; r.hoehe = y + 17.65 + 52 + 20.35 } else { r.hoehe = y + 16 }
        return r
    }

    /// Fahrzeugblock der Fahrzeug-Seite (353 breit), blockRaster der Web-App. Mit allem: 332 hoch.
    struct BlockRaster { var vin: CGFloat?; var bild: CGFloat?; var modell: CGFloat?; var ausstattung: CGFloat?; var kacheln: CGFloat?; var hoehe: CGFloat }
    func blockRaster() -> BlockRaster {
        var r = BlockRaster(hoehe: 0)
        var y: CGFloat = 52
        if !vin.isEmpty { r.vin = 51.97; y = 68 }
        if bild != nil { r.bild = 75; y = 197 }
        if !modell.isEmpty { r.modell = y + 13; y = y + 33 }
        if !ausstattung.isEmpty { let o = modell.isEmpty ? y + 8 : y; r.ausstattung = o; y = o + 16 }
        if hatKacheln { r.kacheln = y + 24; r.hoehe = y + 24 + 52 + 10 } else { r.hoehe = y + 16 }
        return r
    }
}

/// Nur Kacheln mit Wert, mittig. Ohne jede Angabe leer.
struct FahrzeugKacheln: View {
    let a: FahrzeugAngaben
    var body: some View {
        HStack(spacing: 16) {
            if !a.kraftstoff.isEmpty { KraftstoffKachel(kraftstoff: a.kraftstoff) }
            if !a.farbe.isEmpty { FarbKachel(farbe: a.farbe) }
            if a.energie { EnergieKachel(kraftstoff: a.kraftstoff, fuellstand: a.fuellstand, reichweite: a.reichweite) }
            if let s = a.sitze { SitzKachel(sitze: s) }
        }
    }
}

/// Merkt sich Bilder, die nicht laden. Karten und Fahrzeugblock lassen den Bildplatz dann weg.
@MainActor
final class FahrzeugBildSpeicher: ObservableObject {
    static let shared = FahrzeugBildSpeicher()
    @Published private(set) var kaputt: Set<URL> = []
    func melden(_ url: URL) { if !kaputt.contains(url) { kaputt.insert(url) } }
}

/// Fahrzeugbild, das bei Ladefehler verschwindet statt grau zu bleiben.
struct FahrzeugBild: View {
    let url: URL
    var body: some View {
        AsyncImage(url: url) { phase in
            switch phase {
            case let .success(bild): bild.resizable().scaledToFit()
            case .failure: Color.clear.onAppear { FahrzeugBildSpeicher.shared.melden(url) }
            default: Color.clear
            }
        }
    }
}

/// Weisse Fahrzeugkarte (362 breit, mit allen Angaben 268 hoch) aus Fahrtenliste und „Keine Fahrt“.
/// Nachbau von FahrzeugKarte (shared/FahrzeugKarte.jsx).
struct FahrzeugKarte: View {
    let fahrzeug: FahrzeugZeile?
    /// Ueberschrift: Fahrtenliste zeigt das Kennzeichen, „Keine Fahrt“ das Modell.
    var titel: String
    /// Bild-Oberkante: Liste 63, „Keine Fahrt“ 55.57.
    var bildOben: CGFloat = 63
    @ObservedObject private var bilder = FahrzeugBildSpeicher.shared

    @MainActor static func hoehe(_ f: FahrzeugZeile?, bildOben: CGFloat = 63) -> CGFloat {
        FahrzeugAngaben(f).kartenRaster(bildOben: bildOben).hoehe
    }

    var body: some View {
        let a = FahrzeugAngaben(fahrzeug)
        let r = a.kartenRaster(bildOben: bildOben)
        ZStack(alignment: .topLeading) {
            Color.white

            Text(titel)
                .grotesk(30, .bold, abstand: -0.5)
                .foregroundStyle(Color(hex: 0x1C1C1D))
                .lineLimit(1)
                .minimumScaleFactor(0.5)
                .padding(.horizontal, 12)
                .platz(0, 15.29, 362, 36.68, .top)

            if let oben = r.bild, let url = a.bild {
                FahrzeugBild(url: url).platz(63.9, oben, 234.53, 114.91)
            }

            // Im Web mit z-10 ueber dem Bild.
            if let oben = r.vin {
                (Text("VIN  ").bold() + Text(a.vin).kerning(2))
                    .font(.grotesk(13))
                    .foregroundStyle(Color(red: 28 / 255, green: 28 / 255, blue: 29 / 255, opacity: 0.15))
                    .lineLimit(1)
                    .platz(0, oben, 362, nil, .top)
            }

            if let oben = r.kacheln {
                FahrzeugKacheln(a: a).platz(0, oben, 362, 52, .top)
            }
        }
        .frame(width: 362, height: r.hoehe)
    }

    /// Bilder liegen teils als Pfad der Web-App vor (/fahrzeuge/...).
    static func bildURL(_ wert: String?) -> URL? {
        guard let roh = wert?.trimmingCharacters(in: .whitespaces), !roh.isEmpty else { return nil }
        if roh.hasPrefix("http") { return URL(string: roh) }
        return URL(string: "https://fahrer.trisar.de" + (roh.hasPrefix("/") ? roh : "/" + roh))
    }
}

/// Chip an der Karte: woher der Standort kommt und wie alt er ist.
/// "Standort: OBD-Tracker  vor 3 Min." (StandortChip in shared/FahrzeugKarte.jsx).
struct StandortChip: View {
    let quelle: String
    let erfasst: Date?

    static func istObd(_ q: String) -> Bool {
        q.range(of: "teltonika|fmb\\d*|obd|telematik|telematics|tracker", options: [.regularExpression, .caseInsensitive]) != nil
    }

    static func alter(_ d: Date?, jetzt: Date = Date()) -> String {
        guard let d else { return "" }
        let min = max(0, Int(jetzt.timeIntervalSince(d) / 60))
        if min < 1 { return "gerade eben" }
        if min < 60 { return "vor \(min) Min." }
        let std = min / 60
        if std < 24 { return "vor \(std) Std." }
        let tage = std / 24
        return tage == 1 ? "vor 1 Tag" : "vor \(tage) Tagen"
    }

    var body: some View {
        TimelineView(.periodic(from: .now, by: 30)) { kontext in
            HStack(spacing: 7) {
                Circle().fill(Color(hex: 0xE3F654)).frame(width: 7, height: 7)
                Text(Self.istObd(quelle) ? "Standort: OBD-Tracker" : "Standort: Fahrer-App")
                    .font(.grotesk(12, .bold)).foregroundStyle(Color(hex: 0xE3F654))
                let alter = Self.alter(erfasst, jetzt: kontext.date)
                if !alter.isEmpty {
                    Text(alter).font(.grotesk(12, .medium)).foregroundStyle(.white.opacity(0.7))
                }
            }
            .lineLimit(1)
            .padding(.horizontal, 10)
            .frame(height: 28)
            .background(Color.black)
        }
    }
}

// MARK: - Kacheln (vehicleBadges.jsx, Basis 36, angezeigt in 52)

private struct KachelRahmen<Inhalt: View>: View {
    var groesse: CGFloat = 52
    @ViewBuilder let inhalt: () -> Inhalt
    var body: some View {
        ZStack {
            Image("card-outline-52").resizable()
            inhalt().scaleEffect(groesse / 36)
        }
        .frame(width: groesse, height: groesse)
    }
}

struct KraftstoffKachel: View {
    let kraftstoff: String?

    var body: some View {
        KachelRahmen {
            switch Self.aufloesen(kraftstoff) {
            case let .icon(name):
                Image(name).resizable().scaledToFit().frame(width: 23, height: 23)
            case let .text(label):
                ZStack {
                    RoundedRectangle(cornerRadius: 3.7).stroke(Color(hex: 0x12120D), lineWidth: 2.1)
                        .padding(1.05)
                    Text(label).font(.grotesk(9, .bold)).foregroundStyle(.black)
                }
                .frame(width: 23, height: 20)
            }
        }
    }

    enum Anzeige { case icon(String), text(String) }

    /// resolveFuelBadge der Web-App.
    static func aufloesen(_ wert: String?) -> Anzeige {
        let f = (wert ?? "").trimmingCharacters(in: .whitespaces).lowercased()
        if f.isEmpty || f == "e10" { return .icon("E10_Tank_Trisar_Icons_01") }
        if f.contains("elektr") || f == "ev" || f == "bev" || f.contains("hybrid") { return .icon("Blitz_Trisar_Icons_01") }
        if f.contains("b10") { return .text("B10") }
        if f.contains("diesel") || f.contains("b7") { return .text("B7") }
        if f.contains("plus") || f.contains("98") { return .icon("E98_Tank_Trisar_Icons_01") }
        if f.contains("95") || f.contains("super") || f.contains("e5") { return .icon("E95_Tank_Trisar_Icons_01") }
        return .text(String((wert ?? "").trimmingCharacters(in: .whitespaces).prefix(3)))
    }
}

struct FarbKachel: View {
    let farbe: String?
    var body: some View {
        KachelRahmen {
            Circle().fill(Self.farbe(farbe)).frame(width: 23, height: 23)
        }
    }

    /// resolveCarColor der Web-App.
    static func farbe(_ wert: String?) -> Color {
        guard let roh = wert?.trimmingCharacters(in: .whitespaces), !roh.isEmpty else { return Color(hex: 0x0D0D0D) }
        let v = roh.lowercased()
        let tabelle: [String: UInt32] = [
            "black": 0x0D0D0D, "schwarz": 0x0D0D0D, "white": 0xF3F4F6, "weiss": 0xF3F4F6,
            "silber": 0xC4C6C8, "silver": 0xC4C6C8, "grau": 0x8B8E93, "gray": 0x8B8E93, "grey": 0x8B8E93,
            "blau": 0x1D4ED8, "blue": 0x1D4ED8, "rot": 0xB91C1C, "red": 0xB91C1C, "gruen": 0x15803D, "green": 0x15803D,
        ]
        if let hex = tabelle[v] { return Color(hex: hex) }
        if roh.hasPrefix("#"), let zahl = UInt32(roh.dropFirst(), radix: 16), roh.count == 7 { return Color(hex: zahl) }
        if v.contains("weiß") || v.contains("weiss") { return Color(hex: 0xF3F4F6) }
        if v.contains("blau") || v.contains("blue") { return Color(hex: 0x1D4ED8) }
        if v.contains("rot") || v.contains("red") { return Color(hex: 0xB91C1C) }
        if v.contains("grün") || v.contains("gruen") || v.contains("green") { return Color(hex: 0x15803D) }
        if v.contains("bronze") { return Color(hex: 0x8A6D55) }
        if v.contains("grau") || v.contains("grey") || v.contains("gray") { return Color(hex: 0x8B8E93) }
        if v.contains("silber") || v.contains("silver") { return Color(hex: 0xC4C6C8) }
        return Color(hex: 0x0D0D0D)
    }
}

struct SitzKachel: View {
    let sitze: Int?
    var body: some View {
        KachelRahmen {
            Image(Self.icon(sitze)).resizable().scaledToFit().frame(width: 23, height: 23)
        }
    }

    static func icon(_ sitze: Int?) -> String {
        guard let s = sitze else { return "Person_Trisar_Icons_01" }
        return "\(min(8, max(3, s)))x_Person_Trisar_Icons_01"
    }
}

/// Energie-Kachel: Elektro = Batterie, Verbrenner = Zapfsaeule mit Fuellbalken.
/// Ohne Wert steht „–“ (kein erfundener Wert, wie im Live-Betrieb der Web-App).
struct EnergieKachel: View {
    let kraftstoff: String?
    let fuellstand: Double?
    let reichweite: Double?

    private var elektrisch: Bool {
        let f = (kraftstoff ?? "").lowercased()
        return f.contains("elektr") || f == "ev" || f == "bev"
    }

    var body: some View {
        let fill = fuellstand.map { Int(max(0, min(100, $0.rounded()))) }
        let maxReichweite = (reichweite ?? 0) > 0 ? reichweite! : (elektrisch ? 500 : 650)
        let km = fill.map { Int((Double($0) / 100 * maxReichweite).rounded()) }
        KachelRahmen {
            VStack(spacing: 3) {
                if elektrisch {
                    let icon = fill == nil ? "40xBatterie_Trisar_Icon_01_green"
                        : (fill! >= 60 ? "100xBatterie_Trisar_Icon_01_green"
                           : (fill! >= 25 ? "40xBatterie_Trisar_Icon_01_green" : "20xBatterie_Trisar_Icon_01_green"))
                    Image(icon).resizable().scaledToFit().frame(width: 13, height: 13).opacity(fill == nil ? 0.3 : 1)
                } else {
                    ZStack(alignment: .bottom) {
                        Rectangle().fill(Color(hex: 0x1A171B))
                            .frame(width: 4, height: 13 * 0.76 * Double(fill ?? 0) / 100)
                            .padding(.bottom, 13 * 0.12)
                        Image("Zapfsaeule_Trisar_Icons_01").resizable().frame(width: 8, height: 13)
                    }
                    .frame(width: 8, height: 13)
                }
                VStack(spacing: 0) {
                    Text(km.map { "\($0)km " } ?? "–")
                    Text(fill.map { "\($0)%" } ?? "–").foregroundStyle(Color(hex: 0x060606))
                }
                .font(.grotesk(5, .bold))
                .foregroundStyle(.black)
                .lineSpacing(0)
            }
        }
    }
}
