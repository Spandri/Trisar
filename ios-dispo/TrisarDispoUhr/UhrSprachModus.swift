import AVFoundation
import SwiftUI
import WatchKit

/// Voice-Modus des KI-Assistenten auf der Uhr (Design abgenommen 13.11.), angelehnt an SprachModus.swift am iPhone.
/// Bereit: Kugel im Verlauf des Planungs-Knopfs, „Tippen zum Sprechen“. Antippen oeffnet das Diktat
/// der Uhr (watchOS hat keinen SFSpeechRecognizer, das Diktat ist Apples Eingabe). Der diktierte Text
/// geht automatisch ueber kiFragen raus (derselbe Verlauf wie im Chat).
/// Denkt: Kugel dreht und wirbelt blau/gelb. Spricht: Antwort wird vorgelesen, Kugel atmet mit Lime-Ringen.
/// Wartet ein Vorschlag (Dienst senden, Buchen), bestaetigt ein diktiertes „ja“ ihn, „nein“ verwirft ihn.

// MARK: - Sprache (Teile aus TrisarDispo/Dienste/Sprache.swift, die Uhr kompiliert die iPhone-Dateien nicht)

enum UhrSprache {
    /// Kurze Antworten auf eine Rueckfrage erkennen (wie Sprache.istJa / istNein am iPhone).
    static func istJa(_ t: String) -> Bool {
        passt(t, #"^(ja|jap|jo|jawohl|genau|passt|ok|okay|klar|mach( das)?|bitte|senden|buchen|abschicken|richtig|stimmt)\b"#)
    }

    static func istNein(_ t: String) -> Bool {
        passt(t, #"^(nein|nee|ne|nö|nicht|stopp|abbrechen|lass( es)?|falsch)\b"#)
    }

    private static func passt(_ t: String, _ muster: String) -> Bool {
        let s = t.trimmingCharacters(in: .whitespacesAndNewlines)
        return s.range(of: muster, options: [.regularExpression, .caseInsensitive]) != nil
    }

    /// zumVorlesen: Antworttext so umbauen, dass er sich gut vorlesen laesst (wie am iPhone).
    static func zumVorlesen(_ text: String) -> String {
        var s = text
        let schritte: [(String, String)] = [
            (#"https?://\S+"#, ""),
            (#"[*_#`>]"#, ""),
            (#"(?m)^\s*[-•]\s+"#, ""),
            (#"(\d{1,2}):00\b"#, "$1 Uhr"),
            (#"(\d{1,2}):(\d{2})\b"#, "$1 Uhr $2"),
            (#"\s*[–—]\s*"#, " bis "),
            (#"[„“”"]"#, ""),
            (#"\n+"#, ". "),
            (#"\.\s*\."#, "."),
            (#"\s+"#, " "),
        ]
        for (muster, ersatz) in schritte {
            s = s.replacingOccurrences(of: muster, with: ersatz, options: .regularExpression)
        }
        return s.trimmingCharacters(in: .whitespacesAndNewlines)
    }
}

// MARK: - Vorlesen

/// Liest mit der besten deutschen Stimme vor (Premium vor Erweitert vor Standard).
/// Ton ueber den Lautsprecher der Uhr oder verbundene AirPods (Kategorie playback, Sprachansage).
@MainActor final class UhrVorleser: NSObject, AVSpeechSynthesizerDelegate {
    private let synth = AVSpeechSynthesizer()
    private var fertig: CheckedContinuation<Void, Never>?
    /// Was gerade gelesen wird. Rueckmeldungen zu einem frueheren Satz beenden nichts mehr.
    private var aktuell: ObjectIdentifier?
    private var gelesen: AVSpeechUtterance?

    override init() {
        super.init()
        synth.delegate = self
    }

    private static let stimme: AVSpeechSynthesisVoice? = {
        let alle = AVSpeechSynthesisVoice.speechVoices().filter { $0.language.lowercased().hasPrefix("de") }
        return alle.first { $0.quality == .premium && $0.language == "de-DE" }
            ?? alle.first { $0.quality == .premium }
            ?? alle.first { $0.quality == .enhanced && $0.language == "de-DE" }
            ?? alle.first { $0.quality == .enhanced }
            ?? AVSpeechSynthesisVoice(language: "de-DE")
            ?? alle.first
    }()

    /// Kehrt zurueck, wenn fertig vorgelesen oder abgebrochen ist.
    func sprechen(_ text: String) async {
        stoppen()
        let satz = UhrSprache.zumVorlesen(text)
        guard !satz.isEmpty else { return }
        let s = AVAudioSession.sharedInstance()
        try? s.setCategory(.playback, mode: .voicePrompt, options: [.duckOthers])
        try? s.setActive(true)
        let u = AVSpeechUtterance(string: satz)
        u.voice = Self.stimme
        u.rate = min(AVSpeechUtteranceMaximumSpeechRate, AVSpeechUtteranceDefaultSpeechRate * 1.05)
        aktuell = ObjectIdentifier(u)
        gelesen = u
        await withCheckedContinuation { (c: CheckedContinuation<Void, Never>) in
            fertig = c
            synth.speak(u)
        }
        try? s.setActive(false, options: .notifyOthersOnDeactivation)
    }

    func stoppen() {
        if synth.isSpeaking || synth.isPaused { synth.stopSpeaking(at: .immediate) }
        ende()
    }

    private func ende() {
        aktuell = nil
        gelesen = nil
        let c = fertig
        fertig = nil
        c?.resume()
    }

    private func vorbei(_ id: ObjectIdentifier) {
        if aktuell == id { ende() }
    }

    nonisolated func speechSynthesizer(_ s: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        let id = ObjectIdentifier(utterance)
        Task { @MainActor in self.vorbei(id) }
    }

    nonisolated func speechSynthesizer(_ s: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {
        let id = ObjectIdentifier(utterance)
        Task { @MainActor in self.vorbei(id) }
    }
}

// MARK: - Ablauf

@MainActor final class UhrSprachAblauf: ObservableObject {
    enum Zustand { case bereit, denkt, spricht }

    @Published var zustand: Zustand = .bereit
    /// Antwort, die gerade vorgelesen wird.
    @Published var zeile = ""
    /// Fehler (z. B. iPhone nicht erreichbar), rot unter der Kugel.
    @Published var fehler = ""

    private let vorleser = UhrVorleser()
    private var aufgabe: Task<Void, Never>?
    /// Nur Vorschau im Simulator: nichts senden und nichts vorlesen.
    var vorschau = false

    /// Juengste Antwort mit Vorschlag, der noch auf „ja“ oder „nein“ wartet.
    static func offenerVorschlag(_ v: DispoUhrVerbindung) -> KiNachricht? {
        guard let n = v.kiNachrichten.last(where: { !$0.vonMir }), n.dienst != nil, n.status == .offen else { return nil }
        return n
    }

    /// Diktierter Text kommt an: ja/nein auf einen offenen Vorschlag, sonst als Frage an den Assistenten.
    func diktiert(_ text: String, _ v: DispoUhrVerbindung) {
        let t = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !t.isEmpty, zustand == .bereit, !vorschau else { return }
        fehler = ""
        aufgabe?.cancel()
        aufgabe = Task { await ablauf(t, v) }
    }

    private func ablauf(_ t: String, _ v: DispoUhrVerbindung) async {
        if let n = Self.offenerVorschlag(v), UhrSprache.istJa(t) {
            zustand = .denkt
            v.dienstSenden(n)
            // Warten, bis das iPhone geantwortet hat (hoechstens 30 s).
            var antwort = "Wird gesendet."
            warten: for _ in 0..<150 {
                guard !Task.isCancelled else { return }
                switch v.kiNachrichten.first(where: { $0.id == n.id })?.status {
                case .gesendet(let s)?: antwort = s; break warten
                case .fehler(let s)?: antwort = s; break warten
                case .verworfen?, nil: break warten
                case .sendet?, .offen?: try? await Task.sleep(for: .milliseconds(200))
                }
            }
            await sprechen(antwort)
            return
        }
        if let n = Self.offenerVorschlag(v), UhrSprache.istNein(t) {
            v.dienstVerwerfen(n)
            await sprechen("Okay, verworfen.")
            return
        }
        let vorher = v.kiNachrichten.count
        v.kiFragen(t)
        guard v.kiDenkt else {
            // Nicht gesendet (iPhone nicht erreichbar): Meldung hier zeigen statt im Alert dahinter.
            fehler = v.meldung ?? "iPhone nicht erreichbar."
            v.meldung = nil
            return
        }
        zustand = .denkt
        while v.kiDenkt {
            try? await Task.sleep(for: .milliseconds(200))
            guard !Task.isCancelled else { return }
        }
        guard let antwort = v.kiNachrichten.dropFirst(vorher).last(where: { !$0.vonMir }) else {
            zustand = .bereit
            return
        }
        await sprechen(antwort.text)
    }

    private func sprechen(_ text: String) async {
        guard !Task.isCancelled else { return }
        zeile = text
        zustand = .spricht
        WKInterfaceDevice.current().play(.click)
        await vorleser.sprechen(text)
        guard !Task.isCancelled else { return }
        zustand = .bereit
    }

    /// Rotes X beim Sprechen: Vorlesen stoppen, zurueck auf Bereit.
    func stoppen() {
        vorleser.stoppen()
        if vorschau { zustand = .bereit }
    }

    /// Schliessen oder Abbrechen beim Denken. Die Antwort landet trotzdem im Chat.
    func beenden() {
        aufgabe?.cancel()
        aufgabe = nil
        vorleser.stoppen()
        zustand = .bereit
    }
}

// MARK: - Ansicht

struct UhrSprachModus: View {
    @EnvironmentObject private var verbindung: DispoUhrVerbindung
    @Environment(\.dismiss) private var dismiss
    @StateObject private var ablauf = UhrSprachAblauf()
    /// Nur Simulator-Vorschau (-uhrSprache bereit | denkt | spricht).
    var vorschau: String?

    private static let grau = Color(red: 160 / 255, green: 160 / 255, blue: 160 / 255) // #A0A0A0

    var body: some View {
        GeometryReader { g in
            // Beim Sprechen etwas kleiner, damit die Antwort darunter Platz hat.
            let kugel = min(g.size.width * 0.52, g.size.height * (ablauf.zustand == .spricht ? 0.36 : 0.48))
            VStack(spacing: 0) {
                Text("KI Assistent")
                    .font(.grotesk(12, .bold))
                    .foregroundStyle(UhrFarbe.lime)
                    .frame(height: 16)
                Spacer(minLength: 4)
                kugelKnopf(kugel)
                Spacer(minLength: 6)
                unten
                    .frame(maxWidth: .infinity)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .animation(.easeInOut(duration: 0.3), value: ablauf.zustand)
        }
        .ignoresSafeArea(.container, edges: .bottom)
        .background(Color.black.ignoresSafeArea())
        .onAppear {
            #if DEBUG
            if let vorschau {
                ablauf.vorschau = true
                switch vorschau {
                case "denkt": ablauf.zustand = .denkt
                case "spricht":
                    ablauf.zeile = verbindung.kiNachrichten.last(where: { !$0.vonMir })?.text ?? ""
                    ablauf.zustand = .spricht
                default: break
                }
            }
            #endif
        }
        .onDisappear {
            ablauf.beenden()
            UhrWachHalten.geteilt.stoppen()
        }
        .task { UhrWachHalten.geteilt.starten() }
    }

    @ViewBuilder private func kugelKnopf(_ groesse: CGFloat) -> some View {
        let kugel = UhrSprachKugel(zustand: ablauf.zustand, groesse: groesse)
        switch ablauf.zustand {
        case .bereit:
            // Antippen oeffnet die Texteingabe der Uhr mit Diktat.
            TextFieldLink(prompt: Text("Frage …")) {
                kugel
            } onSubmit: { text in
                ablauf.diktiert(text, verbindung)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Tippen zum Sprechen")
        case .spricht:
            Button { ablauf.stoppen() } label: { kugel }
                .buttonStyle(.plain)
                .accessibilityLabel("Vorlesen stoppen")
        case .denkt:
            kugel
        }
    }

    @ViewBuilder private var unten: some View {
        switch ablauf.zustand {
        case .bereit:
            VStack(spacing: 2) {
                if !ablauf.fehler.isEmpty {
                    Text(ablauf.fehler)
                        .font(.grotesk(11, .medium))
                        .foregroundStyle(UhrFarbe.rot)
                        .lineLimit(2)
                        .minimumScaleFactor(0.8)
                }
                Text("Tippen zum Sprechen")
                    .font(.grotesk(13, .medium))
                    .foregroundStyle(Self.grau)
                if UhrSprachAblauf.offenerVorschlag(verbindung) != nil {
                    Text("Sag „ja“ oder „nein“")
                        .font(.grotesk(11, .bold))
                        .foregroundStyle(UhrFarbe.lime)
                }
            }
            .multilineTextAlignment(.center)
            .padding(.bottom, 6)
        case .denkt:
            VStack(spacing: 4) {
                Text("Denkt …")
                    .font(.grotesk(13, .medium))
                    .foregroundStyle(Self.grau)
                kreuz {
                    ablauf.beenden()
                    dismiss()
                }
            }
            .padding(.bottom, 8)
        case .spricht:
            VStack(spacing: 4) {
                // Ganze Antwort, scrollbar (Krone oder Finger), statt nach 3 Zeilen abgeschnitten.
                ScrollView {
                    Text(ablauf.zeile)
                        .font(.grotesk(11, .medium))
                        .foregroundStyle(.white)
                        .multilineTextAlignment(.center)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.horizontal, 6)
                }
                .frame(maxHeight: 64)
                kreuz { ablauf.stoppen() }
            }
            .padding(.bottom, 8)
        }
    }

    /// Rotes X wie am iPhone: Kreis #FF6F63 als Umriss.
    private func kreuz(_ aktion: @escaping () -> Void) -> some View {
        Button(action: aktion) {
            Image(systemName: "xmark")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(UhrFarbe.rot)
                .frame(width: 34, height: 34)
                .overlay(Circle().strokeBorder(UhrFarbe.rot, lineWidth: 2))
                .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(ablauf.zustand == .denkt ? "Abbrechen" : "Stoppen")
    }
}

// MARK: - Kugel

/// Bewegung der Kugel, Zahlen wie in SprachModus.swift am iPhone, Takt 30 Bilder/s.
/// Denkt: dreht und wirbelt, mal mehr Blau, mal mehr Gelb. Spricht: Farben stehen, die Kugel atmet.
@MainActor private final class UhrKugelBewegung: ObservableObject {
    @Published private(set) var winkel = 22.66
    @Published private(set) var dx = 0.0
    @Published private(set) var dy = 0.0
    @Published private(set) var mitte = 55.9
    @Published private(set) var s = 1.0

    var zustand: UhrSprachAblauf.Zustand = .bereit
    var ruhig = false

    private var t = 0
    private var dw = 0.0
    private var zx = 0.0, zy = 0.0, zm = 55.9, zw = 1.0
    private var takt: Timer?

    func starten() {
        guard takt == nil else { return }
        let l = Timer(timeInterval: 1.0 / 30, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated { self?.schritt() }
        }
        RunLoop.main.add(l, forMode: .common)
        takt = l
    }

    func stoppen() {
        takt?.invalidate()
        takt = nil
    }

    private func schritt() {
        // Ein Takt hier entspricht zwei Bildern am iPhone (60 Bilder/s).
        t += 2
        var dx = self.dx, dy = self.dy
        var s = 1.0
        switch zustand {
        case .denkt:
            if t % 44 == 0 {
                zx = (Double.random(in: 0..<1) - 0.5) * 140
                zy = (Double.random(in: 0..<1) - 0.5) * 140
                zm = 40 + Double.random(in: 0..<1) * 32
                zw = (Bool.random() ? -1 : 1) * (2 + Double.random(in: 0..<1) * 5)
            }
            dx += (zx - dx) * 0.1
            dy += (zy - dy) * 0.1
            dw += (zw - dw) * 0.12
            s = 1 + sin(Double(t) / 11) * 0.05
        case .spricht:
            // Farben drehen nicht, die Kugel atmet (1,6 s wie die Ringe).
            dw *= 0.7
            dx *= 0.8
            dy *= 0.8
            s = 1 + 0.045 * (0.5 - 0.5 * cos(Double(t) / 60 * 2 * .pi / 1.6))
        case .bereit:
            dw *= 0.8
            dx *= 0.9
            dy *= 0.9
        }
        let neueMitte = mitte + ((zustand == .denkt ? zm : 55.9) - mitte) * (zustand == .denkt ? 0.08 : 0.06)
        if ruhig { dw = 0; dx = 0; dy = 0; s = 1 }
        // Beim Denken doppelt drehen (Takt halb so schnell wie am iPhone).
        winkel += dw * 2
        self.dx = dx
        self.dy = dy
        mitte = neueMitte
        self.s = s
    }
}

private struct UhrSprachKugel: View {
    let zustand: UhrSprachAblauf.Zustand
    var groesse: CGFloat
    @StateObject private var bewegung = UhrKugelBewegung()
    @Environment(\.accessibilityReduceMotion) private var ruhig

    var body: some View {
        // Groessen am iPhone fuer 200 pt, hier umgerechnet.
        let k = groesse / 200
        ZStack {
            if zustand == .spricht && !ruhig {
                UhrSprachRinge()
            }
            ZStack {
                Color.black
                LinearGradient(stops: Self.verlauf(bewegung.mitte), startPoint: .leading, endPoint: .trailing)
                    .frame(width: 480 * k, height: 480 * k)
                    .rotationEffect(.degrees(bewegung.winkel))
                    .offset(x: bewegung.dx * k, y: bewegung.dy * k)
            }
            .frame(width: groesse, height: groesse)
            .clipShape(Circle())
            .overlay(Circle().strokeBorder(UhrFarbe.lime, lineWidth: 2))
            .contentShape(Circle())
            .scaleEffect(bewegung.s)
        }
        .frame(width: groesse, height: groesse)
        .onAppear {
            bewegung.zustand = zustand
            bewegung.ruhig = ruhig
            bewegung.starten()
        }
        .onChange(of: zustand) { _, neu in bewegung.zustand = neu }
        .onChange(of: ruhig) { _, neu in bewegung.ruhig = neu }
        .onDisappear { bewegung.stoppen() }
    }

    /// Verlauf des Planungs-Knopfs: Blau #0047FF bis (m-24.5) %, Schwarz bei m %, Lime #E3F654 bei (m+64.5) %.
    /// Liegt der Lime-Punkt hinter 100 %, wird die Farbe bei 100 % ausgerechnet.
    static func verlauf(_ m: Double) -> [Gradient.Stop] {
        let blau = Color(red: 0, green: 71 / 255, blue: 1)
        let lime = (r: 227.0 / 255, g: 246.0 / 255, b: 84.0 / 255)
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

/// Zwei weiche Lime-Ringe beim Sprechen: Skala 1 bis 1.35, Deckkraft 0.5 bis 0, 1.6 s, der zweite 0.8 s spaeter.
private struct UhrSprachRinge: View {
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
            let x = e.truncatingRemainder(dividingBy: 1.6) / 1.6
            let p = 1 - (1 - x) * (1 - x)
            Circle().strokeBorder(UhrFarbe.lime, lineWidth: 1.5)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .scaleEffect(1 + 0.35 * p)
                .opacity(0.5 * (1 - p))
        }
    }
}

/// Kleine Kugel als Einstieg oben im KI-Assistenten der Uhr.
struct UhrSprachEinstieg: View {
    let aktion: () -> Void

    var body: some View {
        Button(action: aktion) {
            ZStack {
                Color.black
                LinearGradient(stops: UhrSprachKugel.verlauf(55.9), startPoint: .leading, endPoint: .trailing)
                    .frame(width: 62, height: 62)
                    .rotationEffect(.degrees(22.66))
            }
            .frame(width: 26, height: 26)
            .clipShape(Circle())
            .overlay(Circle().strokeBorder(UhrFarbe.lime, lineWidth: 1.5))
            .frame(width: 34, height: 30)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Voice-Modus")
    }
}


/// TEST (13.11.): haelt die App im Sprachmodus aktiv, auch wenn der Bildschirm ausgeht (wie Fitness-Apps).
/// WKExtendedRuntimeSession vom Typ self-care (Info.plist WKBackgroundModes), hoechstens 10 min je Sitzung,
/// laeuft nur, solange der Sprachmodus offen ist.
@MainActor final class UhrWachHalten: NSObject, WKExtendedRuntimeSessionDelegate {
    static let geteilt = UhrWachHalten()
    private var sitzung: WKExtendedRuntimeSession?

    func starten() {
        guard sitzung == nil || sitzung?.state == .invalid else { return }
        let s = WKExtendedRuntimeSession()
        s.delegate = self
        sitzung = s
        s.start()
    }

    func stoppen() {
        if let s = sitzung, s.state == .running || s.state == .scheduled { s.invalidate() }
        sitzung = nil
    }

    nonisolated func extendedRuntimeSessionDidStart(_ extendedRuntimeSession: WKExtendedRuntimeSession) {}
    nonisolated func extendedRuntimeSessionWillExpire(_ extendedRuntimeSession: WKExtendedRuntimeSession) {}
    nonisolated func extendedRuntimeSession(_ extendedRuntimeSession: WKExtendedRuntimeSession,
                                            didInvalidateWith reason: WKExtendedRuntimeSessionInvalidationReason, error: Error?) {
        Task { @MainActor in if self.sitzung === extendedRuntimeSession { self.sitzung = nil } }
    }
}
