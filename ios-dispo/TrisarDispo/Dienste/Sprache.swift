import AVFoundation
import Foundation
import Speech

/// Sprache fuer den Voice-Modus im KI-Assistenten (13.11.), Nachbau von admin/src/shared/sprache.js.
/// Erkennung mit SFSpeechRecognizer (de-DE, wenn moeglich auf dem Geraet), Vorlesen mit AVSpeechSynthesizer.
/// Der Pegel fuer die Kugel kommt beim Zuhoeren aus dem Mikrofon (RMS), beim Vorlesen aus den Wortgrenzen.
enum Sprache {
    /// Kurze Antworten auf eine Rueckfrage erkennen (istJa / istNein).
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

    // MARK: Satzende wie bei ChatGPT
    // ChatGPT schickt nicht nach einer festen Pause ab, sondern schaetzt, ob der Satz fertig
    // klingt („semantic VAD“). Klingt er offen („und“, „äh“, „zum“ am Ende), wird lange
    // gewartet. Die Wartezeit zaehlt ab dem letzten Wort UND dem letzten hoerbaren Ton.
    static let offeneEnden: Set<String> = [
        "und", "oder", "aber", "sondern", "dann", "also", "weil", "dass", "wenn", "ob", "damit", "bevor", "nachdem", "sowie",
        "äh", "ähm", "ehm", "hm", "hmm", "öh", "öhm", "mh", "quasi", "sozusagen",
        "der", "die", "das", "den", "dem", "des", "ein", "eine", "einen", "einem", "einer", "eines",
        "mein", "meine", "dein", "sein", "seine", "ihr", "ihre", "unser", "unsere",
        "zu", "zum", "zur", "von", "vom", "nach", "mit", "für", "bei", "beim", "an", "am", "auf", "in", "im", "ins",
        "um", "ab", "bis", "über", "unter", "vor", "hinter", "neben", "zwischen", "gegen", "ohne", "durch", "aus",
        "ich", "du", "er", "sie", "wir", "soll", "sollen", "kann", "muss", "will", "möchte", "bitte", "noch", "auch",
        "erstelle", "buche", "schick", "schicke", "sag", "sage", "schreib", "schreibe", "lösche", "setze", "verschiebe",
        "halb", "viertel", "uhr", "morgen", "heute", "übermorgen",
    ]
    private static let kurzFertig = #"^(ja|jap|jo|nein|nee|ne|nö|ok|okay|stopp|stop|danke|genau|passt|richtig|falsch|abbrechen)$"#

    /// endeWartezeit: wie lange (ms) nach dem letzten Wort und Ton gewartet wird, bevor der Satz abgeschickt wird.
    static func endeWartezeit(_ text: String, frage: Bool = false) -> Double {
        let t = text.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if t.isEmpty { return .infinity }
        let woerter = t.split(whereSeparator: { $0.isWhitespace }).map(String.init)
        let letztes = (woerter.last ?? "")
            .replacingOccurrences(of: #"[.,!?;:…"„“]+$"#, with: "", options: .regularExpression)
        if frage && woerter.count <= 3 && (istJa(t) || istNein(t)) { return 700 }
        if woerter.count == 1 && passt(letztes, kurzFertig) { return 900 }
        if t.range(of: #"[,\-–…]$"#, options: .regularExpression) != nil || offeneEnden.contains(letztes) { return 3500 }
        if woerter.count <= 2 { return 2500 }
        if t.range(of: #"[.!?]$"#, options: .regularExpression) != nil { return 1300 }
        return 1800
    }

    /// zumVorlesen: Antworttext so umbauen, dass er sich gut vorlesen laesst.
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

    /// Mikrofon und Spracherkennung erlauben lassen. Nil = alles erlaubt, sonst die Meldung.
    static func erlaubnisHolen() async -> String? {
        let erkennung: SFSpeechRecognizerAuthorizationStatus = await withCheckedContinuation { fertig in
            SFSpeechRecognizer.requestAuthorization { fertig.resume(returning: $0) }
        }
        guard erkennung == .authorized else {
            return "Spracherkennung ist nicht erlaubt. Bitte in den Einstellungen erlauben."
        }
        let mikro = await AVAudioApplication.requestRecordPermission()
        guard mikro else { return "Kein Zugriff aufs Mikrofon. Bitte in den Einstellungen erlauben." }
        guard SFSpeechRecognizer(locale: Locale(identifier: "de-DE"))?.isAvailable == true else {
            return "Spracherkennung ist gerade nicht verfügbar."
        }
        return nil
    }

    // MARK: Namen fuer die Erkennung
    /// Woerter, die die Erkennung bevorzugt verstehen soll (contextualStrings): Fahrer, eigene Orte,
    /// Fahrgaeste. Apple empfiehlt hoechstens rund 100 Eintraege, Fahrer und Orte gehen vor.
    private(set) static var woerter: [String] = []

    /// Einmal beim Oeffnen des Sprachmodus laden. Fehler sind egal, dann ohne Liste.
    static func woerterLaden() async {
        struct Person: Decodable { let first_name: String?; let last_name: String?; let role: String? }
        struct Ort: Decodable { let name: String? }
        let c = Backend.client
        async let fahrer: [Person]? = try? c.from("profiles").select("first_name, last_name, role").execute().value
        async let orte: [Ort]? = try? c.from("orte").select("name").execute().value
        async let gaeste: [Person]? = try? c.from("guests").select("first_name, last_name")
            .order("created_at", ascending: false).limit(150).execute().value
        var liste: [String] = []
        func dazu(_ w: String?) {
            let t = (w ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            if t.count >= 2, !liste.contains(where: { $0.caseInsensitiveCompare(t) == .orderedSame }) { liste.append(t) }
        }
        for p in (await fahrer ?? []) where (p.role ?? "").lowercased() != "pruefung" {
            dazu([p.first_name, p.last_name].compactMap { $0 }.joined(separator: " "))
            dazu(p.last_name)
        }
        for o in (await orte ?? []) { dazu(o.name) }
        for g in (await gaeste ?? []) {
            dazu([g.first_name, g.last_name].compactMap { $0 }.joined(separator: " "))
        }
        woerter = Array(liste.prefix(100))
    }

    /// Audio-Sitzung fuer Zuhoeren und Vorlesen (Lautsprecher, Echo-Unterdrueckung am Eingang).
    static func sitzungStarten() {
        let s = AVAudioSession.sharedInstance()
        try? s.setCategory(.playAndRecord, mode: .default, options: [.defaultToSpeaker, .allowBluetoothA2DP, .duckOthers])
        try? s.setActive(true)
    }

    static func sitzungBeenden() {
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }
}

// MARK: - Zuhoeren

/// Haelt die laufende Erkennungsanfrage fuer den Audio-Thread (der Mikrofon-Tap haengt Puffer an).
private final class AnfrageKasten: @unchecked Sendable {
    private let schloss = NSLock()
    private var wert: SFSpeechAudioBufferRecognitionRequest?
    var anfrage: SFSpeechAudioBufferRecognitionRequest? {
        get { schloss.lock(); defer { schloss.unlock() }; return wert }
        set { schloss.lock(); wert = newValue; schloss.unlock() }
    }
}

/// erkennungStarten + pegelStarten: hoert dauerhaft zu, meldet Zwischentext und den fertigen Satz,
/// sobald er fertig klingt (Sprache.endeWartezeit, gemessen ab letztem Wort und letztem Ton).
/// Pegel 0..1 aus demselben Mikrofon.
@MainActor final class SprachErkennung {
    var onZwischen: (String) -> Void = { _ in }
    var onSatz: (String) -> Void = { _ in }
    var onFehler: (String) -> Void = { _ in }
    var onPegel: (Double) -> Void = { _ in }

    /// Zuhoeren auf eine Rueckfrage: kurzes „ja“/„nein“ geht schneller raus.
    private let frage: Bool
    private let erkenner = SFSpeechRecognizer(locale: Locale(identifier: "de-DE"))
    private let motor = AVAudioEngine()
    private let kasten = AnfrageKasten()
    private var aufgabe: SFSpeechRecognitionTask?
    private var pruefer: Timer?
    /// Fertiger Text aus frueheren Runden (Apple beendet eine Runde nach Pausen oder ~1 min).
    private var text = ""
    /// Zwischentext der laufenden Runde.
    private var zwischen = ""
    /// Zeitpunkte in ms (Systemlaufzeit): letztes neues Zwischenergebnis, letzte Textaenderung, letzter hoerbarer Ton.
    private var letztesWort = 0.0
    private var unveraendertSeit = 0.0
    private var letzteStimme = 0.0
    private var aktiv = false
    /// Jede Erkennungsrunde bekommt eine Nummer, damit Rueckmeldungen alter Runden nichts mehr ausloesen.
    private var runde = 0
    /// Runden hintereinander, die mit Fehler und ohne ein Wort endeten. Statt endlos still neu zu
    /// starten (wirkte wie „taub“), nach wenigen Versuchen den Grund anzeigen.
    private var leereFehler = 0
    /// Ob in der laufenden Runde schon Text kam.
    private var rundeHatText = false

    init(frage: Bool = false) { self.frage = frage }

    private static func jetzt() -> Double { ProcessInfo.processInfo.systemUptime * 1000 }

    func starten() {
        guard let erkenner, erkenner.isAvailable else { onFehler("Spracherkennung ist gerade nicht verfügbar."); return }
        aktiv = true
        // Ohne Echo-Unterdrueckung (Voice Processing): Damit lieferte das Mikrofon auf dem iPhone 12
        // keine oder nur stockende Puffer, die Erkennung blieb taub (gemessen 13.11.). Gebraucht wird
        // sie nicht, beim Vorlesen hoert die App ohnehin nicht zu.
        let eingang = motor.inputNode
        _ = motor.mainMixerNode
        let format = eingang.outputFormat(forBus: 0)
        guard format.sampleRate > 0, format.channelCount > 0 else {
            aktiv = false
            onFehler("Kein Mikrofon gefunden.")
            return
        }
        eingang.removeTap(onBus: 0)
        eingang.installTap(onBus: 0, bufferSize: 1024, format: format,
                           block: Self.tapBlock(kasten, pegel: { @Sendable [weak self] p in
                               Task { @MainActor in self?.pegelMelden(p) }
                           }))
        motor.prepare()
        do {
            try motor.start()
        } catch {
            eingang.removeTap(onBus: 0)
            aktiv = false
            onFehler("Mikrofon lässt sich nicht starten.")
            return
        }
        text = ""
        zwischen = ""
        letzteStimme = 0
        leereFehler = 0
        // Alle 100 ms pruefen, ob der Satz fertig ist.
        let t = Timer(timeInterval: 0.1, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated { self?.pruefen() }
        }
        RunLoop.main.add(t, forMode: .common)
        pruefer = t
        neueRunde()
    }

    func stoppen() {
        aktiv = false
        pruefer?.invalidate()
        pruefer = nil
        runde += 1
        aufgabe?.cancel()
        aufgabe = nil
        kasten.anfrage?.endAudio()
        kasten.anfrage = nil
        if motor.isRunning { motor.stop() }
        motor.inputNode.removeTap(onBus: 0)
        text = ""
        zwischen = ""
        onPegel(0)
    }

    /// Kugel antippen beim Zuhoeren: sofort abschicken, ohne zu warten.
    func jetztSenden() { abschliessen() }

    /// Laeuft auf dem Audio-Thread, darf deshalb nichts vom Main Actor anfassen.
    private nonisolated static func tapBlock(_ kasten: AnfrageKasten,
                                             pegel: @escaping @Sendable (Double) -> Void) -> AVAudioNodeTapBlock {
        { puffer, _ in
            kasten.anfrage?.append(puffer)
            pegel(min(1, max(0, (Self.rms(puffer) - 0.01) * 7)))
        }
    }

    private func pegelMelden(_ p: Double) {
        guard aktiv else { return }
        if p > 0.12 { letzteStimme = Self.jetzt() }
        onPegel(p)
    }

    private func ganz() -> String {
        "\(text) \(zwischen)".replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespaces)
    }

    private func pruefen() {
        guard aktiv else { return }
        let satz = ganz()
        guard !satz.isEmpty else { return }
        let t = Self.jetzt()
        let ruhe = t - max(letztesWort, letzteStimme)
        // Ton ohne neue Woerter (Rauschen, Musik) haelt den Satz hoechstens 6 s offen.
        let zuLange = t - unveraendertSeit > 6000 && t - letztesWort > 1500
        if ruhe >= Sprache.endeWartezeit(satz, frage: frage) || zuLange { abschliessen() }
    }

    /// Neue Erkennungsrunde mit laufendem Mikrofon. Der bisherige Text bleibt, die Runde haengt an.
    private func neueRunde() {
        guard aktiv, let erkenner else { return }
        aufgabe?.cancel()
        kasten.anfrage?.endAudio()
        runde += 1
        let meine = runde
        let a = SFSpeechAudioBufferRecognitionRequest()
        a.shouldReportPartialResults = true
        a.taskHint = .dictation
        // Namen von Fahrern, Orten und Fahrgaesten bevorzugt erkennen.
        a.contextualStrings = Sprache.woerter
        if erkenner.supportsOnDeviceRecognition { a.requiresOnDeviceRecognition = true }
        kasten.anfrage = a
        zwischen = ""
        rundeHatText = false
        aufgabe = erkenner.recognitionTask(with: a) { @Sendable [weak self] ergebnis, fehler in
            let neu = ergebnis?.bestTranscription.formattedString
            let ende = fehler != nil || ergebnis?.isFinal == true
            let f = fehler as NSError?
            let code = f?.code
            let bereich = f?.domain
            Task { @MainActor in self?.ergebnis(neu, ende: ende, runde: meine, fehlerCode: code, fehlerBereich: bereich) }
        }
    }

    private func ergebnis(_ neu: String?, ende: Bool, runde meine: Int, fehlerCode: Int? = nil, fehlerBereich: String? = nil) {
        guard aktiv, runde == meine else { return }
        if let neu, !neu.isEmpty {
            rundeHatText = true
            leereFehler = 0
            let vorher = ganz()
            zwischen = neu
            let nachher = ganz()
            letztesWort = Self.jetzt()
            if nachher != vorher { unveraendertSeit = letztesWort }
            onZwischen(nachher)
        }
        if ende, let code = fehlerCode, !rundeHatText {
            leereFehler += 1
            // 1110 = keine Sprache erkannt: normal bei Stille, einfach weiter zuhoeren.
            if code == 1110 { leereFehler = 0 }
            if leereFehler >= 3 {
                let meldung = Self.fehlerText(code, bereich: fehlerBereich)
                stoppen()
                onFehler(meldung)
                return
            }
        }
        if ende {
            // Apple hat die Runde beendet (Pause, Zeitlimit). Nicht abschicken, das entscheidet
            // allein die Satzende-Regel. Text behalten und mit einer neuen Runde weiter zuhoeren.
            text = ganz()
            zwischen = ""
            neueRunde()
        }
    }

    private func abschliessen() {
        let satz = ganz()
        guard aktiv, !satz.isEmpty else { return }
        stoppen()
        onSatz(satz)
    }

    /// Fehler der Spracherkennung in Worten (Codes aus kAFAssistantErrorDomain / kLSRErrorDomain).
    private static func fehlerText(_ code: Int, bereich: String?) -> String {
        switch code {
        case 201, 1700:
            return "Die Diktierfunktion ist aus. Bitte unter Einstellungen › Allgemein › Tastatur die Diktierfunktion einschalten."
        case 1101, 1107:
            return "Die Spracherkennung ist gerade nicht erreichbar. Bitte Internet prüfen und nochmal versuchen."
        case 203, 301:
            return "Die Spracherkennung wurde unterbrochen. Bitte nochmal versuchen."
        default:
            return "Die Spracherkennung meldet einen Fehler (\(bereich ?? "?") \(code)). Bitte nochmal versuchen."
        }
    }

    /// RMS des Puffers. Der Pegel fuer die Kugel wird daraus wie im Web auf 0..1 gestreckt.
    private nonisolated static func rms(_ puffer: AVAudioPCMBuffer) -> Double {
        guard let kanal = puffer.floatChannelData?[0] else { return 0 }
        let n = Int(puffer.frameLength)
        guard n > 0 else { return 0 }
        var summe: Float = 0
        for i in 0..<n { summe += kanal[i] * kanal[i] }
        return Double(sqrt(summe / Float(n)))
    }
}

// MARK: - Vorlesen

/// vorlesen: liest vor und meldet bei jedem Wort einen Pegel-Stoss, dazwischen klingt er ab.
@MainActor final class SprachVorleser: NSObject, AVSpeechSynthesizerDelegate {
    var onPegel: (Double) -> Void = { _ in }

    private let synth = AVSpeechSynthesizer()
    private var fertig: CheckedContinuation<Void, Never>?
    /// Was gerade gelesen wird. Rueckmeldungen zu einem frueheren Satz beenden nichts mehr.
    private var aktuell: ObjectIdentifier?
    /// Haelt den Satz fest, damit seine Kennung nicht frei wird und neu vergeben werden kann.
    private var gelesen: AVSpeechUtterance?
    private var takt: Timer?
    private var stoss = 0.0

    override init() {
        super.init()
        synth.delegate = self
    }

    /// Beste deutsche Stimme: Premium vor Erweitert vor Standard.
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
        let satz = Sprache.zumVorlesen(text)
        guard !satz.isEmpty else { return }
        let u = AVSpeechUtterance(string: satz)
        u.voice = Self.stimme
        u.rate = min(AVSpeechUtteranceMaximumSpeechRate, AVSpeechUtteranceDefaultSpeechRate * 1.05)
        stoss = 0
        takt = Timer.scheduledTimer(withTimeInterval: 1.0 / 60, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated {
                guard let self else { return }
                self.stoss *= 0.9
                self.onPegel(min(1, 0.15 + self.stoss))
            }
        }
        aktuell = ObjectIdentifier(u)
        gelesen = u
        await withCheckedContinuation { (c: CheckedContinuation<Void, Never>) in
            fertig = c
            synth.speak(u)
        }
    }

    func stoppen() {
        if synth.isSpeaking || synth.isPaused { synth.stopSpeaking(at: .immediate) }
        ende()
    }

    private func ende() {
        aktuell = nil
        gelesen = nil
        takt?.invalidate()
        takt = nil
        onPegel(0)
        let c = fertig
        fertig = nil
        c?.resume()
    }

    private func wort() { stoss = 0.55 + Double.random(in: 0..<0.35) }

    private func vorbei(_ id: ObjectIdentifier) {
        if aktuell == id { ende() }
    }

    nonisolated func speechSynthesizer(_ s: AVSpeechSynthesizer, willSpeakRangeOfSpeechString r: NSRange,
                                       utterance: AVSpeechUtterance) {
        Task { @MainActor in self.wort() }
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
