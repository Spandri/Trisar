import SwiftUI
import UIKit

/// Voice-Modus des KI-Assistenten (Design abgenommen 13.11.), Nachbau von SprachModus.jsx.
/// Kugel mit dem Verlauf des Planungs-Knopfs. Zuhoeren: bewegt sich mit der Stimme.
/// Denkt: dreht und wirbelt, mal mehr Blau, mal mehr Gelb. Spricht: Farben stehen,
/// die Kugel atmet mit, Ringe laufen. Rueckfrage: weisse Karte, „ja“ oder „nein“.

/// Was nach einer Antwort auf ein „ja“ wartet. lokal = Karte im Chat, die die App selbst bestaetigt.
struct SprachOffen: Equatable {
    var lokal: Bool
    var titel: String
    var zeile: String = ""
    /// Bei lokal: ID der Chat-Nachricht, deren Karten bestaetigt werden.
    var id: String?
    /// Ja/Nein-Knoepfe nur bei einer Ja/Nein-Frage (19.11.), nicht bei „Um wie viel Uhr?“.
    var jaNein: Bool = true
}

struct SprachAntwort {
    var text: String
    var offen: SprachOffen?
}

// MARK: - Sprechen-Knopf

/// Ersetzt den Senden-Pfeil, solange das Eingabefeld leer ist.
struct SprechenKnopf: View {
    let aktion: () -> Void
    /// Hoehen der Balken aus der Aufnahme von „TRISAR“.
    private static let balken: [CGFloat] = [0.3, 0.38, 0.97, 1, 0.82, 0.5, 0.68, 0.44, 0.16]

    var body: some View {
        Button(action: aktion) {
            HStack(spacing: 2) {
                ForEach(Array(Self.balken.enumerated()), id: \.offset) { _, v in
                    Capsule().fill(Color(hex: 0xE3F654))
                        .frame(width: 2, height: max(2, (v * 24).rounded()))
                }
            }
            .frame(width: 48, height: 48)
            .background(Circle().fill(Color.black.opacity(0.4)))
            .overlay(Circle().strokeBorder(Color(hex: 0xE3F654), lineWidth: 1.5))
            .contentShape(Circle())
        }
        .buttonStyle(.web)
        .accessibilityLabel("Sprechen")
    }
}

// MARK: - Ablauf

/// Der ganze Ablauf (Zuhoeren, Denken, Sprechen) lebt in einem Objekt, das beim Oeffnen einmal entsteht.
@MainActor final class SprachAblauf: ObservableObject {
    enum Zustand { case hoeren, denken, sprechen, frage, stumm }

    @Published var modus: Zustand = .hoeren
    @Published var zeile = ""
    /// Live-Mitschrift beim Zuhoeren, leer bei jedem Zuhoer-Start. Zeigt in der Rueckfrage-Karte, was gehoert wurde.
    @Published var gehoert = ""
    @Published var zeileHell = false
    @Published var offen: SprachOffen?
    @Published var fehler = ""
    @Published var stumm = false
    /// 0..1 fuer die Kugel, Mikrofon beim Zuhoeren, Wortstoesse beim Vorlesen.
    var pegel = 0.0

    var senden: (String) async -> SprachAntwort = { _ in SprachAntwort(text: "") }
    var ja: () async -> SprachAntwort = { SprachAntwort(text: "") }
    var nein: () async -> SprachAntwort = { SprachAntwort(text: "") }

    private var lebt = false
    private var ruhe = false
    private var erkennung: SprachErkennung?
    private let vorleser = SprachVorleser()
    /// Nummer des laufenden Vorlesens, nil = es wird nicht vorgelesen.
    private var vorlesen: Int?
    private var vorleseZaehler = 0

    func starten() async {
        guard !lebt else { return }
        lebt = true
        vorleser.onPegel = { [weak self] p in self?.pegel = p }
        if let f = await Sprache.erlaubnisHolen() {
            fehler = f
            return
        }
        guard lebt else { return }
        // Namen fuer die Erkennung im Hintergrund holen, das Zuhoeren startet sofort.
        Task { await Sprache.woerterLaden() }
        Sprache.sitzungStarten()
        zuhoeren(.hoeren)
    }

    func beenden() {
        lebt = false
        zuhoerenStoppen()
        vorlesen = nil
        vorleser.stoppen()
        Sprache.sitzungBeenden()
    }

    /// Kugel antippen: beim Sprechen unterbrechen, beim Zuhoeren sofort abschicken.
    func kugelTippen() {
        switch modus {
        case .sprechen: unterbrechen()
        case .hoeren, .frage: erkennung?.jetztSenden()
        default: break
        }
    }

    /// Ja/Nein-Knopf an der Rueckfrage (18.11.): wirkt wie gesprochenes "ja" bzw. "nein", auch mitten im Vorlesen.
    func knopf(ja: Bool) {
        guard offen != nil, modus != .denken else { return }
        if vorlesen != nil {
            vorlesen = nil
            vorleser.stoppen()
        }
        Task { await satzVerarbeiten(ja ? "ja" : "nein") }
    }

    /// Kugel antippen, waehrend gesprochen wird: abbrechen und wieder zuhoeren.
    func unterbrechen() {
        guard vorlesen != nil else { return }
        vorlesen = nil
        vorleser.stoppen()
        zuhoeren(offen != nil ? .frage : .hoeren)
    }

    func stummSetzen(_ an: Bool) {
        stumm = an
        ruhe = an
        if an {
            zuhoerenStoppen()
            if modus == .hoeren || modus == .frage { modus = .stumm }
        } else {
            zuhoeren(offen != nil ? .frage : .hoeren)
        }
    }

    private func zuhoerenStoppen() {
        erkennung?.stoppen()
        erkennung = nil
        pegel = 0
    }

    private func zuhoeren(_ naechster: Zustand) {
        guard lebt else { return }
        zuhoerenStoppen()
        if ruhe { modus = .stumm; return }
        modus = naechster
        if naechster == .hoeren { zeile = "" }
        gehoert = ""
        let e = SprachErkennung(frage: naechster == .frage)
        e.onPegel = { [weak self] p in self?.pegel = p }
        e.onZwischen = { [weak self] t in
            guard let self else { return }
            self.gehoert = t
            if naechster == .hoeren {
                self.zeile = t
                self.zeileHell = false
            }
        }
        e.onSatz = { [weak self] s in
            Task { await self?.satzVerarbeiten(s) }
        }
        e.onFehler = { [weak self] f in self?.fehler = f }
        erkennung = e
        e.starten()
    }

    private func satzVerarbeiten(_ satz: String) async {
        guard lebt else { return }
        zuhoerenStoppen()
        zeile = satz
        zeileHell = false
        modus = .denken
        let wartet = offen
        let antwort: SprachAntwort
        if wartet?.lokal == true && Sprache.istJa(satz) {
            antwort = await ja()
        } else if wartet?.lokal == true && Sprache.istNein(satz) {
            antwort = await nein()
        } else {
            antwort = await senden(satz)
        }
        await sprechen(antwort)
    }

    private func sprechen(_ antwort: SprachAntwort) async {
        guard lebt else { return }
        offen = antwort.offen
        zeile = antwort.text
        zeileHell = true
        modus = .sprechen
        vorleseZaehler += 1
        let meine = vorleseZaehler
        vorlesen = meine
        await vorleser.sprechen(antwort.text)
        guard lebt, vorlesen == meine else { return }
        vorlesen = nil
        zuhoeren(offen != nil ? .frage : .hoeren)
    }

    /// offenLoesen: ein Vorschlag wurde per Knopf erledigt. Rueckfrage beenden, normal weiter zuhoeren.
    func offenLoesen() {
        guard offen?.lokal == true else { return }
        offen = nil
        if lebt, !ruhe, vorlesen == nil, modus != .denken { zuhoeren(.hoeren) }
    }
}

// MARK: - Ansicht

struct SprachModusAnsicht: View {
    let senden: (String) async -> SprachAntwort
    let ja: () async -> SprachAntwort
    let nein: () async -> SprachAntwort
    let schliessen: () -> Void
    /// Die Karten der juengsten Antwort mit ihren Knoepfen, gerendert wie im Chat.
    var vorschlag: AnyView?
    var vorschlagId: String?
    /// Wartet davon noch etwas auf Bestaetigung (Knopf oder „ja“)?
    var vorschlagOffen = false

    @StateObject private var ablauf = SprachAblauf()

    private var mitKarten: Bool {
        vorschlag != nil && ablauf.offen?.lokal == true && ablauf.offen?.id != nil && ablauf.offen?.id == vorschlagId
    }

    /// Per Knopf bestaetigt oder verworfen: Ergebnis 2,5 s stehen lassen, dann weiter wie normal.
    private var loesenSchluessel: String {
        let wartet = !vorschlagOffen && ablauf.offen?.lokal == true && ablauf.offen?.id != nil && ablauf.offen?.id == vorschlagId
        return wartet ? "loesen|\(vorschlagId ?? "")" : ""
    }

    private var status: String {
        if !ablauf.fehler.isEmpty { return ablauf.fehler }
        switch ablauf.modus {
        case .hoeren: return ablauf.zeile.isEmpty ? "Ich höre zu" : "Ich höre zu, Kugel antippen schickt sofort ab"
        case .denken: return "Einen Moment"
        case .sprechen: return "Spricht, zum Unterbrechen Kugel antippen"
        case .frage: return "Ich höre zu, sag „ja“ oder „nein“"
        case .stumm: return "Mikro aus"
        }
    }

    var body: some View {
        GeometryReader { g in
            let breite = g.size.width
            ZStack(alignment: .top) {
                Color.black
                VStack(spacing: 0) {
                    HStack(spacing: 8) {
                        Image("KI_Trisar_Icons_01_Lime").resizable().frame(width: 14, height: 13)
                        Text("KI Assistent").font(.grotesk(10, .bold)).foregroundStyle(Color(hex: 0xE3F654))
                            .frame(height: 16)
                    }
                    .padding(.top, 72)
                    KiModusSchalter().padding(.top, 14)
                    Text(status)
                        .font(.grotesk(13))
                        .foregroundStyle(Color(hex: ablauf.fehler.isEmpty ? 0xA0A0A0 : 0xFF6F63))
                        .multilineTextAlignment(.center)
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)
                        .padding(.horizontal, 24)
                        .frame(height: 20)
                        .padding(.top, 18)
                    SprachKugel(ablauf: ablauf, groesse: mitKarten ? 120 : 200)
                        .padding(.top, mitKarten ? 20 : 40)
                        .animation(.easeInOut(duration: 0.3), value: mitKarten)
                    if mitKarten, let vorschlag {
                        // Was gerade gehoert wird, wie beim normalen Zuhoeren.
                        Text(ablauf.modus == .frage || ablauf.modus == .hoeren ? ablauf.gehoert : "")
                            .font(.grotesk(15, .medium))
                            .lineSpacing(4)
                            .multilineTextAlignment(.center)
                            .foregroundStyle(Color(hex: 0xA0A0A0))
                            .frame(width: min(breite - 48, 340))
                            .frame(minHeight: 24, alignment: .top)
                            .padding(.top, 12)
                        // Die Vorschlaege wie im Chat: Buchen, Nicht buchen, Senden, Nein. Darueber die Antwort.
                        ScrollView(.vertical, showsIndicators: false) {
                            VStack(spacing: 0) {
                                if let t = ablauf.offen?.titel, !t.isEmpty {
                                    Text(t).font(.grotesk(17, .bold)).foregroundStyle(.black)
                                        .fixedSize(horizontal: false, vertical: true)
                                        .padding(16)
                                        .frame(maxWidth: 362, alignment: .leading)
                                        .background(Color.white)
                                        .padding(.bottom, 12)
                                }
                                vorschlag
                            }
                                .frame(maxWidth: .infinity)
                                .padding(.horizontal, 20)
                                .padding(.bottom, 130)
                        }
                        .padding(.top, 8)
                    } else {
                        // Bis knapp ueber Mikro und X, langer Text scrollt (18.11.).
                        unten(breite)
                            .padding(.top, 36)
                            .padding(.bottom, 116)
                            .frame(maxHeight: .infinity, alignment: .top)
                    }
                }
                .frame(maxWidth: .infinity)

                knoepfe
                    .frame(maxHeight: .infinity, alignment: .bottom)
                    .padding(.bottom, 44)
            }
        }
        .ignoresSafeArea()
        .foregroundStyle(.white)
        .task {
            ablauf.senden = senden
            ablauf.ja = ja
            ablauf.nein = nein
            await ablauf.starten()
        }
        .onDisappear { ablauf.beenden() }
        .task(id: loesenSchluessel) {
            guard !loesenSchluessel.isEmpty else { return }
            try? await Task.sleep(for: .seconds(2.5))
            guard !Task.isCancelled else { return }
            ablauf.offenLoesen()
        }
    }

    @ViewBuilder private func unten(_ breite: CGFloat) -> some View {
        if let o = ablauf.offen, [.frage, .sprechen, .denken].contains(ablauf.modus) {
          let kartenBreite = min(breite - 40, 362)
          VStack(spacing: 0) {
            let inhalt = VStack(alignment: .leading, spacing: 0) {
                Text(o.titel).font(.grotesk(20, .bold)).lineSpacing(0)
                    .fixedSize(horizontal: false, vertical: true)
                if !o.zeile.isEmpty {
                    Text(o.zeile).font(.grotesk(12, .medium)).opacity(0.8)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.top, 4)
                }
            }
            .foregroundStyle(.black)
            .padding(16)
            .frame(width: kartenBreite, alignment: .leading)
            // Kurzer Text: Karte so hoch wie der Text. Langer Text: Karte fuellt den Platz und scrollt.
            ViewThatFits(in: .vertical) {
                inhalt
                ScrollView(.vertical) { inhalt }
            }
            .frame(width: kartenBreite)
            .background(Color.white)
            // Ja/Nein wie Annehmen/Ablehnen (EinsatzTagAnsicht): Nein rot umrandet, Ja lime. Nur bei Ja/Nein-Fragen.
            if ablauf.offen?.jaNein != false {
            HStack(spacing: 6) {
                Button { ablauf.knopf(ja: false) } label: {
                    Text("Nein").font(.grotesk(24, .bold)).tracking(-0.5).foregroundStyle(EinsatzFarbe.rot)
                        .frame(maxWidth: .infinity).frame(height: 51)
                        .overlay(Rectangle().strokeBorder(EinsatzFarbe.rot, lineWidth: 2)).contentShape(Rectangle())
                }
                .buttonStyle(.web)
                Button { ablauf.knopf(ja: true) } label: {
                    Text("Ja").font(.grotesk(24, .bold)).tracking(-0.5).foregroundStyle(.black)
                        .frame(maxWidth: .infinity).frame(height: 51).background(EinsatzFarbe.lime)
                }
                .buttonStyle(.web)
            }
            .frame(width: kartenBreite)
            .padding(.top, 12)
            .opacity(ablauf.modus == .denken ? 0.4 : 1)
            }
            // Was gerade gehoert wird, wie beim normalen Zuhoeren.
            Text(ablauf.modus == .frage ? ablauf.gehoert : "")
                .font(.grotesk(17, .medium))
                .lineSpacing(4)
                .multilineTextAlignment(.center)
                .foregroundStyle(Color(hex: 0xA0A0A0))
                .frame(width: min(breite - 48, 340))
                .frame(minHeight: 24, alignment: .top)
                .padding(.top, 16)
          }
        } else {
            // Lange Antworten scrollen statt abgeschnitten zu werden (18.11.).
            ScrollView(.vertical) {
                Text(ablauf.zeile)
                    .font(.grotesk(17, .medium))
                    .lineSpacing(4)
                    .multilineTextAlignment(.center)
                    .foregroundStyle(Color(hex: ablauf.zeileHell ? 0xFFFFFF : 0xA0A0A0))
                    .textSelection(.enabled)
                    .frame(width: min(breite - 48, 340))
            }
            .scrollBounceBehavior(.basedOnSize)
            .frame(width: min(breite - 48, 340))
            .frame(minHeight: 72, alignment: .top)
        }
    }

    private var knoepfe: some View {
        HStack(spacing: 36) {
            Button { ablauf.stummSetzen(!ablauf.stumm) } label: {
                SprachSymbolMikro(aus: ablauf.modus == .stumm)
                    .frame(width: 24, height: 24)
                    .foregroundStyle(ablauf.modus == .stumm ? Color(hex: 0xFF6F63) : .white)
                    .frame(width: 56, height: 56)
                    .background(Circle().fill(Color(hex: 0x242525)))
                    .overlay(Circle().strokeBorder(Color(hex: ablauf.modus == .stumm ? 0xFF6F63 : 0x3A3A3A), lineWidth: 1))
                    .contentShape(Circle())
            }
            .buttonStyle(.web)
            .accessibilityLabel(ablauf.stumm ? "Mikro an" : "Mikro aus")

            Button(action: schliessen) {
                SprachSymbolKreuz()
                    .frame(width: 24, height: 24)
                    .foregroundStyle(Color(hex: 0xFF6F63))
                    .frame(width: 56, height: 56)
                    .overlay(Circle().strokeBorder(Color(hex: 0xFF6F63), lineWidth: 2))
                    .contentShape(Circle())
            }
            .buttonStyle(.web)
            .accessibilityLabel("Beenden")
        }
        .frame(maxWidth: .infinity)
    }
}

// MARK: - Kugel

/// Bewegung der Kugel je Bild (requestAnimationFrame im Web), Zahlen 1:1 aus SprachModus.jsx.
@MainActor private final class KugelBewegung: ObservableObject {
    @Published private(set) var winkel = 22.66
    @Published private(set) var dx = 0.0
    @Published private(set) var dy = 0.0
    @Published private(set) var mitte = 55.9
    @Published private(set) var s = 1.0

    weak var ablauf: SprachAblauf?
    var ruhig = false

    private var t = 0
    private var glatt = 0.0
    private var dw = 0.0
    private var zx = 0.0, zy = 0.0, zm = 55.9, zw = 1.0
    private var takt: CADisplayLink?

    func starten() {
        guard takt == nil else { return }
        let l = CADisplayLink(target: self, selector: #selector(schritt))
        l.preferredFrameRateRange = CAFrameRateRange(minimum: 30, maximum: 60, preferred: 60)
        l.add(to: .main, forMode: .common)
        takt = l
    }

    func stoppen() {
        takt?.invalidate()
        takt = nil
    }

    @objc private func schritt() {
        let m = ablauf?.modus ?? .hoeren
        var dx = self.dx, dy = self.dy
        t += 1
        glatt += ((ablauf?.pegel ?? 0) - glatt) * 0.18
        var s = 1.0
        switch m {
        case .hoeren, .frage:
            dw = glatt * 2.2
            s = 1 + glatt * 0.12
            dx = sin(Double(t) / 23) * glatt * 40
            dy = cos(Double(t) / 31) * glatt * 40
        case .sprechen:
            dw *= 0.85
            s = 1 + glatt * 0.1
            dx *= 0.9
            dy *= 0.9
        case .denken:
            if t % 45 == 0 {
                zx = (Double.random(in: 0..<1) - 0.5) * 140
                zy = (Double.random(in: 0..<1) - 0.5) * 140
                zm = 40 + Double.random(in: 0..<1) * 32
                zw = (Bool.random() ? -1 : 1) * (2 + Double.random(in: 0..<1) * 5)
            }
            dx += (zx - dx) * 0.05
            dy += (zy - dy) * 0.05
            dw += (zw - dw) * 0.06
            s = 1 + sin(Double(t) / 11) * 0.05
        case .stumm:
            dw *= 0.9
            dx *= 0.95
            dy *= 0.95
        }
        let neueMitte = mitte + ((m == .denken ? zm : 55.9) - mitte) * (m == .denken ? 0.04 : 0.03)
        if ruhig { dw = 0; dx = 0; dy = 0; s = 1 }
        winkel += dw
        self.dx = dx
        self.dy = dy
        mitte = neueMitte
        self.s = s
    }
}

private struct SprachKugel: View {
    @ObservedObject var ablauf: SprachAblauf
    /// 200 normal, 120 wenn Vorschlagskarten darunter stehen.
    var groesse: CGFloat = 200
    @StateObject private var bewegung = KugelBewegung()
    @Environment(\.accessibilityReduceMotion) private var ruhig

    var body: some View {
        let stumm = ablauf.modus == .stumm
        ZStack {
            if ablauf.modus == .sprechen && !ruhig {
                SprachRinge()
            }
            Button { ablauf.kugelTippen() } label: {
                ZStack {
                    Color.black
                    LinearGradient(stops: Self.verlauf(bewegung.mitte), startPoint: .leading, endPoint: .trailing)
                        .frame(width: 480, height: 480)
                        .rotationEffect(.degrees(bewegung.winkel))
                        .offset(x: bewegung.dx, y: bewegung.dy)
                }
                .frame(width: groesse, height: groesse)
                .clipShape(Circle())
                .overlay(Circle().strokeBorder(Color(hex: 0xE2F754), lineWidth: 2))
                .grayscale(stumm ? 1 : 0)
                .colorMultiply(stumm ? Color(white: 0.6) : .white)
                .contentShape(Circle())
            }
            .buttonStyle(.plain)
            .scaleEffect(bewegung.s)
            .accessibilityLabel(ablauf.modus == .sprechen ? "Unterbrechen" : "Kugel")
        }
        .frame(width: groesse, height: groesse)
        .onAppear {
            bewegung.ablauf = ablauf
            bewegung.ruhig = ruhig
            bewegung.starten()
        }
        .onChange(of: ruhig) { _, neu in bewegung.ruhig = neu }
        .onDisappear { bewegung.stoppen() }
    }

    /// verlaufBei(m): Blau bis (m-24.5) %, Schwarz bei m %, Lime bei (m+64.5) %.
    /// Liegt der Lime-Punkt hinter 100 %, wird die Farbe bei 100 % ausgerechnet.
    static func verlauf(_ m: Double) -> [Gradient.Stop] {
        let blau = Color(red: 0, green: 89 / 255, blue: 1, opacity: 0.78)
        // hsl(66 44% 58%)
        let lime = (r: 0.7278, g: 0.7648, b: 0.3952)
        let a = max(0, (m - 24.5) / 100), b = m / 100, c = (m + 64.5) / 100
        var stops: [Gradient.Stop] = [
            .init(color: blau, location: 0),
            .init(color: blau, location: a),
            .init(color: .black, location: b),
        ]
        if c <= 1 {
            stops.append(.init(color: Color(red: lime.r, green: lime.g, blue: lime.b), location: c))
            stops.append(.init(color: Color(red: lime.r, green: lime.g, blue: lime.b), location: 1))
        } else {
            let f = (1 - b) / (c - b)
            stops.append(.init(color: Color(red: lime.r * f, green: lime.g * f, blue: lime.b * f), location: 1))
        }
        return stops
    }
}

/// .sprach-ring: zwei Lime-Ringe, Skala 1 bis 1.5, Deckkraft 0.6 bis 0, 1.6 s ease-out, der zweite 0.8 s spaeter.
private struct SprachRinge: View {
    @State private var beginn = Date()

    var body: some View {
        TimelineView(.animation) { ctx in
            let e = ctx.date.timeIntervalSince(beginn)
            ZStack {
                ring(e)
                ring(e - 0.8)
            }
        }
        .allowsHitTesting(false)
    }

    @ViewBuilder private func ring(_ e: Double) -> some View {
        if e >= 0 {
            let p = Self.easeOut(e.truncatingRemainder(dividingBy: 1.6) / 1.6)
            Circle().strokeBorder(Color(hex: 0xE3F654), lineWidth: 2)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .scaleEffect(1 + 0.5 * p)
                .opacity(0.6 * (1 - p))
        }
    }

    /// CSS ease-out = cubic-bezier(0, 0, 0.58, 1).
    static func easeOut(_ x: Double) -> Double {
        let x1 = 0.0, x2 = 0.58, y1 = 0.0, y2 = 1.0
        func bez(_ t: Double, _ a: Double, _ b: Double) -> Double {
            3 * (1 - t) * (1 - t) * t * a + 3 * (1 - t) * t * t * b + t * t * t
        }
        var t = x
        for _ in 0..<8 {
            let fx = bez(t, x1, x2) - x
            let d = 3 * (1 - t) * (1 - t) * x1 + 6 * (1 - t) * t * (x2 - x1) + 3 * t * t * (1 - x2)
            if abs(d) < 1e-6 { break }
            t = min(1, max(0, t - fx / d))
        }
        return bez(t, y1, y2)
    }
}

// MARK: - Symbole (SVG aus SprachModus.jsx, viewBox 24)

private struct SprachSymbolMikro: View {
    let aus: Bool
    var body: some View {
        Canvas { k, g in
            let s = g.width / 24
            func pt(_ x: CGFloat, _ y: CGFloat) -> CGPoint { CGPoint(x: x * s, y: y * s) }
            var p = Path(roundedRect: CGRect(x: 9 * s, y: 3 * s, width: 6 * s, height: 11 * s), cornerRadius: 3 * s)
            p.move(to: pt(5, 11))
            p.addArc(center: pt(12, 11), radius: 7 * s, startAngle: .degrees(180), endAngle: .degrees(0), clockwise: true)
            p.move(to: pt(12, 18)); p.addLine(to: pt(12, 21))
            if aus { p.move(to: pt(4, 4)); p.addLine(to: pt(20, 20)) }
            k.stroke(p, with: .foreground, style: StrokeStyle(lineWidth: 1.8 * s, lineCap: .round, lineJoin: .round))
        }
    }
}

private struct SprachSymbolKreuz: View {
    var body: some View {
        Canvas { k, g in
            let s = g.width / 24
            var p = Path()
            p.move(to: CGPoint(x: 6 * s, y: 6 * s)); p.addLine(to: CGPoint(x: 18 * s, y: 18 * s))
            p.move(to: CGPoint(x: 18 * s, y: 6 * s)); p.addLine(to: CGPoint(x: 6 * s, y: 18 * s))
            k.stroke(p, with: .foreground, style: StrokeStyle(lineWidth: 2 * s, lineCap: .round))
        }
    }
}
