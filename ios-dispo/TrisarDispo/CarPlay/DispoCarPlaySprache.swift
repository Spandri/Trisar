import CarPlay
import SwiftUI
import UIKit

/// Sprachassistent in Dispo-CarPlay (20.11.). Navigations-Apps duerfen in CarPlay aufnehmen, aber nur
/// mit Apples Sprach-Vorlage (CPVoiceControlTemplate). Ablauf wie die Apple Watch: Frage geht ueber
/// DispoUhrBruecke.kiFrage in denselben Verlauf wie der KI-Assistent am Handy, die Antwort wird
/// vorgelesen. Wartet ein Vorschlag (Fahrt, Dienst), fragt der Assistent nach: „ja“ fuehrt aus,
/// „nein“ verwirft (ab iOS 26.4 auch per Knopf), danach zurueck zur Karte. Sonst hoert er nach der
/// Antwort weiter zu und schliesst nach einer Pause ohne Worte von selbst.
@MainActor
final class DispoCarPlaySprache {
    private enum Zustand: String { case hoert, denkt, spricht, frage }

    private weak var steuerung: CPInterfaceController?
    private var vorlage: CPVoiceControlTemplate?
    private var frageTitel: String?
    private var erkennung: SprachErkennung?
    private let vorleser = SprachVorleser()
    private var offen: (id: String, buchung: KiBuchungsVorschlag?, dienst: DienstVorschlag?)?
    private var aktiv = false
    private var stille: Timer?
    /// Nach dem Schliessen (Karte wieder oben).
    var fertig: () -> Void = {}

    /// Ohne Worte so lange zuhoeren, dann schliessen.
    private static let stilleSekunden: TimeInterval = 10

    init(steuerung: CPInterfaceController) {
        self.steuerung = steuerung
    }

    var laeuft: Bool { aktiv }

    func starten() async {
        guard !aktiv else { return }
        aktiv = true
        vorlageZeigen(frage: nil)
        if let fehler = await Sprache.erlaubnisHolen() {
            Sprache.sitzungStarten()
            await sprechen(fehler)
            beenden()
            return
        }
        guard aktiv else { return }
        await Sprache.woerterLaden()
        Sprache.sitzungStarten()
        zuhoeren(frage: false)
    }

    func beenden() {
        guard aktiv else { return }
        aktiv = false
        stille?.invalidate()
        stille = nil
        erkennung?.stoppen()
        erkennung = nil
        vorleser.stoppen()
        Sprache.sitzungBeenden()
        offen = nil
        if let steuerung, steuerung.presentedTemplate === vorlage {
            steuerung.dismissTemplate(animated: true, completion: CarPlayFehler.melden)
        }
        vorlage = nil
        frageTitel = nil
        fertig()
    }

    // MARK: Ablauf

    private func zuhoeren(frage: Bool) {
        guard aktiv else { return }
        zeigen(frage ? .frage : .hoert)
        let e = SprachErkennung(frage: frage)
        e.onZwischen = { [weak self] _ in self?.stilleNeu() }
        e.onSatz = { [weak self] satz in
            guard let self else { return }
            self.stille?.invalidate()
            self.erkennung?.stoppen()
            self.erkennung = nil
            Task { await self.verarbeiten(satz) }
        }
        e.onFehler = { [weak self] text in
            guard let self else { return }
            self.erkennung?.stoppen()
            self.erkennung = nil
            Task {
                await self.sprechen(text)
                self.beenden()
            }
        }
        erkennung = e
        e.starten()
        stilleNeu()
    }

    private func stilleNeu() {
        stille?.invalidate()
        stille = Timer.scheduledTimer(withTimeInterval: Self.stilleSekunden, repeats: false) { [weak self] _ in
            MainActor.assumeIsolated { self?.beenden() }
        }
    }

    private func verarbeiten(_ satz: String) async {
        guard aktiv else { return }
        if let o = offen, Sprache.istJa(satz) {
            zeigen(.denkt)
            let text = await ausfuehren(o)
            offen = nil
            await sprechen(text)
            beenden()
            return
        }
        if let o = offen, Sprache.istNein(satz) {
            KiVerlaufSpeicher.aendern(o.id) { n in
                if n.dienstStatus == "offen" { n.dienstStatus = "verworfen" }
                if n.bookingStatus == "pending" { n.bookingStatus = "cancelled" }
            }
            offen = nil
            await sprechen("Okay, verworfen.")
            beenden()
            return
        }
        // Alles andere ist eine neue Frage (auch eine Antwort auf eine Rueckfrage des Servers).
        offen = nil
        zeigen(.denkt)
        let r = await DispoUhrBruecke.kiFrage(satz, uhrVerlauf: nil)
        guard aktiv else { return }
        var text = r["text"] as? String ?? "Das hat nicht geklappt."
        let id = r["nachricht"] as? String ?? ""
        let buchung = (r["buchung"] as? Data).flatMap { try? JSONDecoder().decode(KiBuchungsVorschlag.self, from: $0) }
        let dienst = (r["dienst"] as? Data).flatMap { try? JSONDecoder().decode(DienstVorschlag.self, from: $0) }
        if buchung != nil || dienst != nil {
            offen = (id, buchung, dienst)
            let titel = text.trimmingCharacters(in: .whitespacesAndNewlines)
            if text.range(of: #"\?\s*$"#, options: .regularExpression) == nil {
                text += dienst != nil ? " Soll ich das senden?" : " Soll ich das so machen?"
            }
            vorlageZeigen(frage: titel)
            await sprechen(text)
            zuhoeren(frage: true)
            return
        }
        await sprechen(text)
        zuhoeren(frage: text.range(of: #"\?\s*$"#, options: .regularExpression) != nil)
    }

    /// „ja“: Fahrt buchen oder Dienst senden, Ergebnis in den Verlauf.
    private func ausfuehren(_ o: (id: String, buchung: KiBuchungsVorschlag?, dienst: DienstVorschlag?)) async -> String {
        var texte: [String] = []
        if let d = o.dienst {
            if d.nurKnopf == true {
                texte.append("Hier ist jemand ausgenommen. Bitte am Handy prüfen und senden.")
            } else {
                do {
                    let anzahl = try await DienstSenden.senden(d)
                    KiVerlaufSpeicher.aendern(o.id) { $0.dienstStatus = "gesendet"; $0.dienstAnzahl = anzahl }
                    texte.append("Gesendet.")
                } catch {
                    let fehler = error.localizedDescription
                    KiVerlaufSpeicher.aendern(o.id) { $0.dienstStatus = "offen"; $0.dienstFehler = fehler }
                    texte.append("Das hat nicht geklappt. \(fehler)")
                }
            }
        }
        if let v = o.buchung {
            if !v.hatPflichtfelder {
                texte.append("Für diese Buchung fehlen noch Start, Ziel oder Zeit. Bitte am Handy ergänzen.")
            } else {
                do {
                    let fahrt = try await KiAssistentDienst.buchen(v)
                    KiVerlaufSpeicher.aendern(o.id) { $0.bookingStatus = "booked"; $0.bookingRideId = fahrt }
                    texte.append(v.fahrtId != nil ? "Änderung gespeichert." : "Fahrt wurde gebucht.")
                } catch {
                    texte.append("Buchung fehlgeschlagen. \(error.localizedDescription)")
                }
            }
        }
        return texte.isEmpty ? "Erledigt." : texte.joined(separator: " ")
    }

    private func sprechen(_ text: String) async {
        guard aktiv else { return }
        zeigen(.spricht)
        await vorleser.sprechen(text)
    }

    /// Knopf in der Rueckfrage (ab iOS 26.4).
    private func knopf(ja: Bool) {
        guard aktiv, offen != nil else { return }
        stille?.invalidate()
        erkennung?.stoppen()
        erkennung = nil
        Task { await verarbeiten(ja ? "ja" : "nein") }
    }

    // MARK: Vorlage

    private func zeigen(_ z: Zustand) {
        guard let vorlage, vorlage.activeStateIdentifier != z.rawValue else { return }
        vorlage.activateVoiceControlState(withIdentifier: z.rawValue)
    }

    /// Apples Sprach-Ansicht mit vier Zustaenden. Der Titel einer Rueckfrage steht fest im Zustand,
    /// deshalb fuer jede neue Rueckfrage eine neue Vorlage.
    private func vorlageZeigen(frage: String?) {
        guard let steuerung, vorlage == nil || frage != frageTitel else { return }
        frageTitel = frage
        let frageZustand = CPVoiceControlState(identifier: Zustand.frage.rawValue,
                                               titleVariants: [frage, "Ja oder nein?"].compactMap { $0 },
                                               image: DispoCarPlayKugel.spricht, repeats: true)
        if #available(iOS 26.4, *) {
            let ja = CPButton(image: UIImage(systemName: "checkmark")!) { [weak self] _ in self?.knopf(ja: true) }
            ja.title = "Ja"
            let nein = CPButton(image: UIImage(systemName: "xmark")!) { [weak self] _ in self?.knopf(ja: false) }
            nein.title = "Abbrechen"
            frageZustand.actionButtons = [ja, nein]
        }
        let neu = CPVoiceControlTemplate(voiceControlStates: [
            CPVoiceControlState(identifier: Zustand.hoert.rawValue, titleVariants: ["Hört zu …"], image: DispoCarPlayKugel.hoert, repeats: true),
            CPVoiceControlState(identifier: Zustand.denkt.rawValue, titleVariants: ["Denkt nach …"], image: DispoCarPlayKugel.denkt, repeats: true),
            CPVoiceControlState(identifier: Zustand.spricht.rawValue, titleVariants: ["Spricht …"], image: DispoCarPlayKugel.spricht, repeats: true),
            frageZustand,
        ])
        if #available(iOS 26.4, *) {
            neu.trailingNavigationBarButtons = [CPBarButton(title: "Schließen") { [weak self] _ in self?.beenden() }]
        }
        let alt = vorlage
        vorlage = neu
        if let alt, steuerung.presentedTemplate === alt {
            steuerung.dismissTemplate(animated: false) { _, _ in
                steuerung.presentTemplate(neu, animated: false, completion: CarPlayFehler.melden)
            }
        } else {
            steuerung.presentTemplate(neu, animated: true, completion: CarPlayFehler.melden)
        }
    }
}

/// Kugel des Sprachmodus als Bildfolge fuer CarPlay (Apple: hoechstens 150 x 150 pt, Zyklus 0,3 bis 5 s).
/// Gezeichnet mit derselben Ansicht wie am Handy (SprachKugelBild), bewegt mit denselben Zahlen wie
/// KugelBewegung in SprachModus.swift. Nur der Pegel ist nachgestellt, weil die Bilder vorab entstehen:
/// beim Zuhoeren eine sprechende Stimme, beim Vorlesen Wort-Stoesse. Die Folge wird am Ende auf den
/// Anfang zurueckgefuehrt, damit sie ohne Sprung wiederholt.
@MainActor
enum DispoCarPlayKugel {
    private enum Art { case hoert, denkt, spricht }

    /// Kugel 100 pt (Handy 200), Ringe beim Sprechen bis 150 pt wie die 1,5-fache Skala dort.
    private static let kugel: CGFloat = 100
    private static let flaeche: CGFloat = 150
    private static let bilder = 40
    /// 60 Schritte je Sekunde wie CADisplayLink am Handy.
    private static let schritte = 60.0

    static var hoert: UIImage { zwischen[.hoert] ?? erzeugen(.hoert) }
    static var denkt: UIImage { zwischen[.denkt] ?? erzeugen(.denkt) }
    static var spricht: UIImage { zwischen[.spricht] ?? erzeugen(.spricht) }

    private static var zwischen: [Art: UIImage] = [:]

    /// Nach dem Verbinden schon einmal erzeugen, damit der erste Knopfdruck nicht wartet.
    static func vorbereiten() async {
        for a in [Art.hoert, .denkt, .spricht] where zwischen[a] == nil {
            _ = erzeugen(a)
            await Task.yield()
        }
    }

    private struct Stand { var winkel = 22.66, dx = 0.0, dy = 0.0, mitte = 55.9, s = 1.0 }

    private static func erzeugen(_ art: Art) -> UIImage {
        let dauer: Double = art == .spricht ? 3.2 : (art == .denkt ? 4.5 : 4)
        let n = Int(dauer * schritte)
        let staende = verlauf(art, schritte: n)
        let maler = { (st: Stand, ring: Double) -> UIImage in
            let ansicht = ZStack {
                if art == .spricht {
                    ringe(ring)
                    ringe(ring - 0.8)
                }
                SprachKugelBild(groesse: kugel, winkel: st.winkel, dx: st.dx, dy: st.dy, mitte: st.mitte)
                    .scaleEffect(st.s)
            }
            .frame(width: flaeche, height: flaeche)
            let r = ImageRenderer(content: ansicht)
            r.scale = 2
            r.isOpaque = false
            return r.uiImage ?? UIImage()
        }
        let einzelne = (0..<bilder).map { i -> UIImage in
            let k = i * n / bilder
            return maler(staende[k], Double(k) / schritte)
        }
        let bild = UIImage.animatedImage(with: einzelne, duration: dauer) ?? einzelne[0]
        zwischen[art] = bild
        return bild
    }

    @ViewBuilder private static func ringe(_ e: Double) -> some View {
        let lauf = e < 0 ? e + 3.2 : e
        let p = SprachRinge.easeOut(lauf.truncatingRemainder(dividingBy: 1.6) / 1.6)
        Circle().strokeBorder(Color(hex: 0xE3F654), lineWidth: 2)
            .frame(width: kugel, height: kugel)
            .scaleEffect(1 + 0.5 * p)
            .opacity(0.6 * (1 - p))
    }

    /// Schritte wie KugelBewegung.schritt, mit nachgestelltem Pegel. Erst einschwingen, dann die
    /// Folge aufnehmen und den Rest zum Anfang hin ausgleichen (Winkel auf volle Umdrehungen).
    private static func verlauf(_ art: Art, schritte n: Int) -> [Stand] {
        var zufall = SystemRandomNumberGenerator()
        var st = Stand()
        var glatt = 0.0, dw = 0.0
        var zx = 0.0, zy = 0.0, zm = 55.9, zw = 1.0
        var stoss = 0.0
        var aufnahme: [Stand] = []
        let vorlauf = n
        for t in 1...(vorlauf + n) {
            let pegel: Double
            switch art {
            case .hoert:
                // Stimme: Silben (~4 je Sekunde) auf einem langsamen Satzbogen, periodisch ueber n.
                let p = Double(t) / Double(n) * 2 * .pi
                pegel = max(0, 0.35 + 0.25 * sin(p * 2) + 0.2 * sin(p * 16))
            case .spricht:
                if t % 14 == 0 { stoss = 0.55 + Double.random(in: 0..<0.35, using: &zufall) }
                stoss *= 0.9
                pegel = min(1, 0.15 + stoss)
            case .denkt:
                pegel = 0
            }
            glatt += (pegel - glatt) * 0.18
            var s = 1.0
            switch art {
            case .hoert:
                dw = glatt * 2.2
                s = 1 + glatt * 0.12
                st.dx = sin(Double(t) / 23) * glatt * 40
                st.dy = cos(Double(t) / 31) * glatt * 40
            case .spricht:
                dw *= 0.85
                s = 1 + glatt * 0.1
                st.dx *= 0.9
                st.dy *= 0.9
            case .denkt:
                if t % 45 == 0 {
                    zx = (Double.random(in: 0..<1, using: &zufall) - 0.5) * 140
                    zy = (Double.random(in: 0..<1, using: &zufall) - 0.5) * 140
                    zm = 40 + Double.random(in: 0..<1, using: &zufall) * 32
                    zw = (Bool.random(using: &zufall) ? -1 : 1) * (2 + Double.random(in: 0..<1, using: &zufall) * 5)
                }
                st.dx += (zx - st.dx) * 0.05
                st.dy += (zy - st.dy) * 0.05
                dw += (zw - dw) * 0.06
                s = 1 + sin(Double(t) / 11) * 0.05
            }
            st.mitte += ((art == .denkt ? zm : 55.9) - st.mitte) * (art == .denkt ? 0.04 : 0.03)
            st.winkel += dw
            st.s = s
            if t > vorlauf { aufnahme.append(st) }
        }
        // Am Ende wieder beim Anfang ankommen (ohne Sprung beim Wiederholen).
        guard let a = aufnahme.first, let z = aufnahme.last, aufnahme.count > 1 else { return aufnahme }
        let dreh = z.winkel - a.winkel
        let ziel = (dreh / 360).rounded() * 360
        let m = Double(aufnahme.count)
        return aufnahme.enumerated().map { i, s in
            let f = Double(i) / m
            var s = s
            s.winkel += (ziel - dreh) * f
            s.dx -= (z.dx - a.dx) * f
            s.dy -= (z.dy - a.dy) * f
            s.mitte -= (z.mitte - a.mitte) * f
            s.s -= (z.s - a.s) * f
            return s
        }
    }
}
