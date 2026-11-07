import SwiftUI
import UIKit

/// Nachbau von KiAssistentView.jsx (view 'kiAssistent'): Chat mit dem Assistenten, Verlauf in
/// UserDefaults unter demselben Schluessel wie localStorage im Web, Kopieren/Bearbeiten an den
/// Nachrichten, Buchungs-Vorschau und Neuplanungs-Link (beides kommt live derzeit nicht vor).
struct KiAssistentAnsicht: View {
    let zeigen: (DispoZiel) -> Void
    /// handleBack: im Web history.back(), sonst Startseite.
    var zurueck: (() -> Void)?
    /// Link "Neuplanung im Planer ansehen" mit dem Tag (ISO-Datum) der Stoerung.
    var oeffneNeuplanung: (String) -> Void = { _ in }
    /// onCreateRide(payload, { aiBooked: true }): liefert die ID der neuen Fahrt. Nil = nicht verbunden.
    var fahrtBuchen: ((KiBuchungsVorschlag) async throws -> String?)?
    /// onOpenRideEditorById
    var oeffneFahrt: (String) -> Void = { _ in }

    @State private var nachrichten: [KiNachricht] = KiVerlaufSpeicher.laden()
    @State private var eingabe = ""
    @State private var bearbeiteteID: String?
    @State private var kopierteID: String?
    @State private var sendet = false
    @FocusState private var fokussiert: Bool
    @State private var live = KiAssistentLive()

    /// DENKZEIT_MS: so lange denkt der Assistent mindestens nach.
    private static let denkzeit: TimeInterval = 3

    private var hatEingabe: Bool { !eingabe.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }

    var body: some View {
        ZStack(alignment: .top) {
            DispoHintergrund().ignoresSafeArea()

            VStack(spacing: 0) {
                // CHAT_TOP = 60 + 50 + 30
                Color.clear.frame(height: 140)
                verlauf
                Color.clear.frame(height: 12) // COMPOSER_GAP
                eingabeLeiste
                // Ohne Tastatur 175 ueber dem Rand, mit Tastatur 8 darueber.
                Color.clear.frame(height: fokussiert ? 8 : 175)
            }
            // Mit Tastatur unten den Rand beachten: WebMassstab gibt die Tastatur als Rand weiter,
            // wer ihn ignoriert, landet mit dem Eingabefeld hinter der Tastatur.
            .ignoresSafeArea(.container, edges: fokussiert ? .top : .all)

            kopf
                .frame(maxWidth: .infinity, alignment: .top)
                .ignoresSafeArea(.container)

            if !fokussiert {
                Navileiste(aktiv: .kiAssistent, waehlen: zeigen)
                    .ignoresSafeArea(.keyboard)
            }
        }
        .frame(maxWidth: 402)
        .frame(maxWidth: .infinity)
        .background(Color.black.ignoresSafeArea())
        .task { await live.starten() }
        .onDisappear { Task { await live.beenden() } }
        .onChange(of: nachrichten) { _, neu in KiVerlaufSpeicher.sichern(neu) }
    }

    // MARK: Kopf

    private var kopf: some View {
        ZStack {
            ZurueckKnopf { if let zurueck { zurueck() } else { zeigen(.start) } }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.leading, 20)
            KiMarke()
        }
        .frame(height: 50)
        .padding(.top, 60)
    }

    // MARK: Verlauf

    private var verlauf: some View {
        ScrollViewReader { proxy in
            ScrollView(.vertical, showsIndicators: false) {
                VStack(spacing: 12) {
                    let bearbeitetIndex = bearbeiteteID.flatMap { id in nachrichten.firstIndex { $0.id == id } }
                    ForEach(Array(nachrichten.enumerated()), id: \.element.id) { index, n in
                        zeile(n)
                            // Spaetere Nachrichten treten beim Bearbeiten zurueck.
                            .opacity(bearbeitetIndex.map { index > $0 } == true ? 0.35 : 1)
                            .saturation(bearbeitetIndex.map { index > $0 } == true ? 0.3 : 1)
                            .animation(.timingCurve(0.37, 0, 0.18, 1, duration: 0.42), value: bearbeiteteID)
                    }
                    Color.clear.frame(height: 1).id("ende")
                }
                .padding(.horizontal, 20)
            }
            .defaultScrollAnchor(.bottom)
            .scrollDismissesKeyboard(.interactively)
            .onChange(of: letzteSignatur) { _, _ in
                withAnimation { proxy.scrollTo("ende", anchor: .bottom) }
            }
            .onChange(of: fokussiert) { _, _ in
                DispatchQueue.main.async { proxy.scrollTo("ende", anchor: .bottom) }
            }
        }
    }

    private var letzteSignatur: String {
        guard let l = nachrichten.last else { return "" }
        return "\(nachrichten.count)|\(l.id)|\(l.pending == true)|\(l.text)|\(l.bookingStatus ?? "")"
    }

    @ViewBuilder private func zeile(_ n: KiNachricht) -> some View {
        if n.role == "user" {
            nutzerBlase(n).frame(maxWidth: .infinity, alignment: .trailing)
        } else if n.pending == true {
            KiDenktSymbol()
                .padding(4)
                .frame(width: 314, alignment: .leading)
                .frame(maxWidth: .infinity, alignment: .leading)
        } else {
            VStack(alignment: .leading, spacing: 0) {
                assistentBlase(n)
                if let tag = n.stoerungTag { neuplanungLink(tag) }
                if let vorschlag = n.bookingProposal { buchung(n, vorschlag) }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private func nutzerBlase(_ n: KiNachricht) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(n.text).font(.grotesk(16, .medium)).foregroundStyle(.black)
                .frame(maxWidth: .infinity, alignment: .leading)
                .textSelection(.enabled)
            HStack {
                Text(n.time).font(.grotesk(10)).foregroundStyle(.black.opacity(0.6)).frame(height: 16)
                Spacer()
                HStack(spacing: 6) {
                    symbolKnopf(aktiv: kopierteID == n.id, farbe: .black.opacity(0.9), titel: "Nachricht kopieren") {
                        kopieren(n)
                    } symbol: {
                        if kopierteID == n.id { KiSymbolHaken() } else { KiSymbolKopieren() }
                    }
                    symbolKnopf(aktiv: bearbeiteteID == n.id, farbe: .black.opacity(0.9), titel: "Nachricht bearbeiten") {
                        bearbeiteteID = n.id
                        eingabe = n.text
                        fokussiert = true
                    } symbol: {
                        KiSymbolStift(gefuellt: bearbeiteteID == n.id)
                    }
                }
            }
            .padding(.top, 12)
        }
        .padding(.horizontal, 12).padding(.top, 12).padding(.bottom, 8)
        .background(UnevenRoundedRectangle(topLeadingRadius: 16, bottomLeadingRadius: 16,
                                           bottomTrailingRadius: 6, topTrailingRadius: 16)
            .fill(Color(hex: 0xE3F654)))
        .frame(width: 314)
    }

    private func assistentBlase(_ n: KiNachricht) -> some View {
        let form = UnevenRoundedRectangle(topLeadingRadius: 16, bottomLeadingRadius: 6,
                                          bottomTrailingRadius: 16, topTrailingRadius: 16)
        return VStack(alignment: .leading, spacing: 0) {
            KiMarke().padding(.bottom, 12)
            Text(KiTelefonLinks.text(n.text)).font(.grotesk(16)).foregroundStyle(.white)
                .tint(Color(hex: 0xE3F654))
                .frame(maxWidth: .infinity, alignment: .leading)
                .textSelection(.enabled)
            HStack {
                Text(n.time).font(.grotesk(10)).foregroundStyle(.white.opacity(0.4)).frame(height: 16)
                Spacer()
                symbolKnopf(aktiv: kopierteID == n.id, farbe: .white.opacity(0.9), titel: "KI-Antwort kopieren") {
                    kopieren(n)
                } symbol: {
                    if kopierteID == n.id { KiSymbolHaken().foregroundStyle(Color(hex: 0xE3F654)) } else { KiSymbolKopieren() }
                }
            }
            .padding(.top, 12)
        }
        .padding(.horizontal, 12).padding(.top, 12).padding(.bottom, 8)
        .background(form.fill(Color(hex: 0x242525)))
        .overlay(form.strokeBorder(Color(hex: 0x3A3A3A), lineWidth: 1))
        .frame(width: 314)
    }

    private func symbolKnopf<S: View>(aktiv: Bool, farbe: Color, titel: String, aktion: @escaping () -> Void,
                                      @ViewBuilder symbol: () -> S) -> some View {
        Button(action: aktion) {
            symbol()
                .frame(width: 16, height: 16)
                .scaleEffect(aktiv ? 1.25 : 1)
                .animation(.spring(response: 0.28, dampingFraction: 0.55), value: aktiv)
                .frame(width: 28, height: 28)
                .contentShape(Rectangle())
        }
        .buttonStyle(.web)
        .foregroundStyle(farbe)
        .accessibilityLabel(titel)
    }

    /// Demo-Stoerung: Link in den Planer. Live entstehen solche Nachrichten derzeit nicht.
    private func neuplanungLink(_ tag: String) -> some View {
        Button { oeffneNeuplanung(tag) } label: {
            Text("Neuplanung im Planer ansehen").grotesk(20, .bold, abstand: -0.5).foregroundStyle(.black)
                .frame(maxWidth: .infinity).frame(height: 51).background(Color(hex: 0xE3F654))
        }
        .buttonStyle(.web)
        .frame(maxWidth: 362)
        .padding(.top, 12 + 8)
    }

    @ViewBuilder private func buchung(_ n: KiNachricht, _ v: KiBuchungsVorschlag) -> some View {
        VStack(spacing: 0) {
            KiBuchungsKarte(vorschlag: v)
            switch n.bookingStatus {
            case "pending":
                HStack(spacing: 12) {
                    Button { Task { await buchen(n.id, v) } } label: {
                        Text("buchen").grotesk(24, .bold, abstand: -0.5).foregroundStyle(.black)
                            .frame(maxWidth: .infinity).frame(height: 51).background(Color(hex: 0xE3F754))
                    }
                    .buttonStyle(.web)
                    Button { setzeStatus(n.id, "cancelled") } label: {
                        Text("nicht buchen").grotesk(24, .bold, abstand: -0.5).foregroundStyle(Color(hex: 0xFF6F63))
                            .frame(maxWidth: .infinity).frame(height: 51)
                            .overlay(Rectangle().strokeBorder(Color(hex: 0xFF6F63), lineWidth: 2))
                    }
                    .buttonStyle(.web)
                }
                .padding(.top, 12)
            case "saving":
                Text("Buchung wird gespeichert...").font(.grotesk(11, .medium)).foregroundStyle(Color(hex: 0xE3F654))
                    .padding(.top, 12)
            case "booked":
                VStack(alignment: .leading, spacing: 8) {
                    Text("Gebucht").font(.grotesk(11, .medium)).foregroundStyle(Color(hex: 0x59BE80))
                    Button {
                        let id = (n.bookingRideId ?? "").trimmingCharacters(in: .whitespaces)
                        if !id.isEmpty { oeffneFahrt(id) }
                    } label: {
                        Text("Fahrt bearbeiten").font(.grotesk(14, .bold)).foregroundStyle(.black)
                            .frame(maxWidth: .infinity).frame(height: 44).background(Color(hex: 0xE3F654))
                    }
                    .buttonStyle(.web)
                }
                .padding(.top, 12)
            case "cancelled":
                Text("Buchung verworfen").font(.grotesk(11, .medium)).foregroundStyle(.white.opacity(0.7))
                    .padding(.top, 12)
            default:
                EmptyView()
            }
        }
        .frame(maxWidth: 362)
        .frame(maxWidth: .infinity)
        .padding(.top, 12)
    }

    // MARK: Eingabe

    private var eingabeLeiste: some View {
        HStack(alignment: .bottom, spacing: 12) {
            TextField("", text: $eingabe,
                      prompt: Text("Nachricht schreiben...").foregroundColor(Color(hex: 0x868786)),
                      axis: .vertical)
                .font(.grotesk(16))
                .lineSpacing(3.6) // leading-6 bei 16 px
                .lineLimit(1...5)
                .foregroundStyle(.white)
                .tint(.white)
                .focused($fokussiert)
                .textInputAutocapitalization(.sentences)
                .autocorrectionDisabled(false)
                .padding(.vertical, 12) // EINGABE_INNEN
                .padding(.horizontal, 16)
                .frame(minHeight: 48)
                .background(RoundedRectangle(cornerRadius: 20).fill(Color(hex: 0x242425)))
                .overlay(RoundedRectangle(cornerRadius: 20).strokeBorder(Color(hex: 0x3F3F46), lineWidth: 1))
                .onChange(of: eingabe) { alt, neu in
                    // Enter schickt ab wie im Web (keydown Enter ohne Shift).
                    if neu.hasSuffix("\n") && neu.count == alt.count + 1 {
                        eingabe = String(neu.dropLast())
                        senden()
                    }
                }
            KiAktionen(bearbeitet: bearbeiteteID != nil, sendenAktiv: hatEingabe && !sendet,
                       abbrechen: { bearbeiteteID = nil; eingabe = "" },
                       senden: senden)
        }
        .frame(width: 362)
        .background(Color.black.opacity(0.6))
        .frame(maxWidth: .infinity)
    }

    // MARK: Ablauf (handleSend, handleCopyMessage, handleBookingConfirm)

    private func senden() {
        let text = eingabe.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, !sendet else { return }
        let jetzt = KiNachricht.uhrzeit()
        let ms = Int(Date().timeIntervalSince1970 * 1000)
        var quelle = nachrichten
        // Bearbeitet: die alte Frage und die direkt folgende Antwort fallen weg.
        if let eid = bearbeiteteID, let idx = quelle.firstIndex(where: { $0.id == eid }) {
            var weg: Set<String> = [eid]
            if idx + 1 < quelle.count, quelle[idx + 1].role == "assistant" { weg.insert(quelle[idx + 1].id) }
            quelle.removeAll { weg.contains($0.id) }
        }
        let verlauf = quelle.map { (rolle: $0.role, text: $0.text) }
        let wartendID = "msg-ai-pending-\(ms + 1)"
        nachrichten = quelle + [
            KiNachricht(id: "msg-user-\(ms)", role: "user", text: text, time: jetzt),
            KiNachricht(id: wartendID, role: "assistant", text: "", time: jetzt, pending: true),
        ]
        bearbeiteteID = nil
        eingabe = ""
        sendet = true

        Task {
            let beginn = Date()
            let ergebnis: Result<KiAssistentDienst.Antwort, Error>
            do { ergebnis = .success(try await KiAssistentDienst.fragen(text, verlauf: verlauf)) } catch { ergebnis = .failure(error) }
            let rest = Self.denkzeit - Date().timeIntervalSince(beginn)
            if rest > 0 { try? await Task.sleep(for: .seconds(rest)) }
            guard let i = nachrichten.firstIndex(where: { $0.id == wartendID }) else { sendet = false; return }
            switch ergebnis {
            case .success(let antwort):
                nachrichten[i].text = antwort.text.isEmpty ? "Ich konnte dazu keine Antwort erzeugen." : antwort.text
                nachrichten[i].bookingProposal = antwort.buchungsVorschlag
                nachrichten[i].bookingStatus = antwort.buchungsVorschlag == nil ? nil : "pending"
            case .failure(let fehler):
                let meldung = fehler.localizedDescription.isEmpty ? "Unbekannter KI-Fehler" : fehler.localizedDescription
                nachrichten[i].text = "Fehler: \(meldung)"
            }
            nachrichten[i].pending = nil
            nachrichten[i].time = KiNachricht.uhrzeit()
            sendet = false
        }
    }

    private func kopieren(_ n: KiNachricht) {
        let wert = n.text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !wert.isEmpty else { return }
        UIPasteboard.general.string = wert
        kopierteID = n.id
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) {
            if kopierteID == n.id { kopierteID = nil }
        }
    }

    private func setzeStatus(_ id: String, _ status: String) {
        if let i = nachrichten.firstIndex(where: { $0.id == id }) { nachrichten[i].bookingStatus = status }
    }

    private func hinweis(_ text: String, _ praefix: String) {
        nachrichten.append(KiNachricht(id: "\(praefix)-\(Int(Date().timeIntervalSince1970 * 1000))",
                                       role: "assistant", text: text, time: KiNachricht.uhrzeit()))
    }

    private func buchen(_ id: String, _ v: KiBuchungsVorschlag) async {
        guard v.hatPflichtfelder else {
            hinweis("Für diese Buchung fehlen noch Pflichtfelder (Start, Ziel oder Zeit).", "msg-ai-booking-error")
            return
        }
        setzeStatus(id, "saving")
        do {
            guard let fahrtBuchen else { throw KiBuchungsFehler("Buchungsfunktion ist nicht verbunden.") }
            let fahrtID = try await fahrtBuchen(v)
            if let i = nachrichten.firstIndex(where: { $0.id == id }) {
                nachrichten[i].bookingStatus = "booked"
                let t = (fahrtID ?? "").trimmingCharacters(in: .whitespaces)
                nachrichten[i].bookingRideId = t.isEmpty ? nil : t
            }
            hinweis("Fahrt wurde gebucht. In Alle Fahrten ist sie jetzt mit KI-Badge markiert.", "msg-ai-booked")
        } catch {
            setzeStatus(id, "pending")
            let meldung = error.localizedDescription.isEmpty ? "Unbekannter Fehler" : error.localizedDescription
            hinweis("Buchung fehlgeschlagen: \(meldung)", "msg-ai-booking-failed")
        }
    }
}

private struct KiBuchungsFehler: LocalizedError {
    let meldung: String
    init(_ m: String) { meldung = m }
    var errorDescription: String? { meldung }
}

// MARK: - Nachricht und Speicher

/// Eine Chat-Nachricht mit denselben Feldnamen wie im Web (JSON in localStorage).
struct KiNachricht: Codable, Equatable, Identifiable {
    var id: String
    var role: String
    var text: String
    var time: String
    var pending: Bool?
    var bookingProposal: KiBuchungsVorschlag?
    var bookingStatus: String?
    var bookingRideId: String?
    var stoerungTag: String?

    static func uhrzeit(_ d: Date = Date()) -> String {
        let f = DateFormatter()
        f.dateFormat = "HH:mm"
        return f.string(from: d)
    }
}

/// CHAT_STORAGE_KEY + restoreStoredMessages (ohne den Demo-Abgleich mit demoStore.jobs).
enum KiVerlaufSpeicher {
    private static let schluessel = "koordinator_ki_chat_messages_v2"
    private static let alteSchluessel = ["koordinator_ki_chat_messages_v1"]

    static var standard: [KiNachricht] {
        [KiNachricht(id: "init", role: "assistant",
                     text: "Hallo! Ich bin dein KI-Assistent. Wie kann ich dir heute helfen?", time: "17:13")]
    }

    static func laden() -> [KiNachricht] {
        let d = UserDefaults.standard
        alteSchluessel.forEach { d.removeObject(forKey: $0) }
        guard let daten = d.data(forKey: schluessel),
              let liste = try? JSONDecoder().decode([KiNachricht].self, from: daten), !liste.isEmpty
        else { return standard }
        let bereinigt = liste
            .filter { $0.pending != true && $0.text.range(of: "Online-Demo deaktiviert", options: .caseInsensitive) == nil }
            .map { n -> KiNachricht in
                var n = n
                if n.bookingStatus == "saving" { n.bookingStatus = "pending" }
                return n
            }
        if bereinigt.isEmpty || (bereinigt.count == 1 && bereinigt[0].id == "init") { return standard }
        return bereinigt
    }

    static func sichern(_ liste: [KiNachricht]) {
        if let daten = try? JSONEncoder().encode(liste) {
            UserDefaults.standard.set(daten, forKey: schluessel)
        }
    }
}

/// mitKlickbarenNummern: Telefonnummern werden zu tel:-Links (Lime, unterstrichen).
enum KiTelefonLinks {
    private static let muster = try! NSRegularExpression(pattern: #"(\+?\d[\d ()/-]{6,}\d)"#)

    static func text(_ roh: String) -> AttributedString {
        var ergebnis = AttributedString()
        let ns = roh as NSString
        var pos = 0
        for treffer in muster.matches(in: roh, range: NSRange(location: 0, length: ns.length)) {
            if treffer.range.location > pos {
                ergebnis += AttributedString(ns.substring(with: NSRange(location: pos, length: treffer.range.location - pos)))
            }
            let nummer = ns.substring(with: treffer.range)
            var teil = AttributedString(nummer)
            let ziffern = nummer.filter { $0.isNumber || $0 == "+" }
            if let url = URL(string: "tel:\(ziffern)") { teil.link = url }
            teil.foregroundColor = Color(hex: 0xE3F654)
            teil.underlineStyle = .single
            ergebnis += teil
            pos = treffer.range.location + treffer.range.length
        }
        if pos < ns.length { ergebnis += AttributedString(ns.substring(from: pos)) }
        return ergebnis
    }
}

// MARK: - Bausteine

/// KI-Symbol (14 x 13) + "KI-Assistent" in Lime, 10 px fett.
private struct KiMarke: View {
    var body: some View {
        HStack(spacing: 6) {
            Image("KI_Trisar_Icons_01_Lime").resizable().frame(width: 14, height: 13)
            Text("KI-Assistent").font(.grotesk(10, .bold)).foregroundStyle(Color(hex: 0xE3F654)).frame(height: 16)
        }
    }
}

/// Wartende Antwort: pulsierendes KI-Symbol (animate-pulse).
private struct KiDenktSymbol: View {
    @State private var hell = true
    var body: some View {
        Image("KI_Trisar_Icons_01_Lime").resizable().frame(width: 20, height: 19)
            .opacity(hell ? 1 : 0.5)
            .onAppear {
                withAnimation(.timingCurve(0.4, 0, 0.6, 1, duration: 1).repeatForever(autoreverses: true)) { hell = false }
            }
    }
}

/// BookingPreviewCard
private struct KiBuchungsKarte: View {
    let vorschlag: KiBuchungsVorschlag

    private var datum: String {
        let r = vorschlag.datum.trimmingCharacters(in: .whitespaces)
        guard r.range(of: #"^\d{4}-\d{2}-\d{2}$"#, options: .regularExpression) != nil else { return "--.--" }
        let z = Array(r)
        return "\(z[8])\(z[9]).\(z[5])\(z[6])"
    }

    var body: some View {
        // Gemeinsame Regel: nur anonyme Gaeste als "N Anonyme Gäste", sonst Namen plus "+ N".
        let gastTeile = GaesteAnzeige.teile(vorschlag.fahrgaeste.components(separatedBy: ","),
                                            anonym: Int(FahrtText.getrimmt(vorschlag.anonymeGaeste)) ?? 0)
        let gast = gastTeile.namen.isEmpty && gastTeile.anonym == 0 ? "Noch keine Gäste angegeben"
            : GaesteAnzeige.text(gastTeile.namen, anonym: gastTeile.anonym)
        let fahrer = vorschlag.fahrerNamen.isEmpty ? "Fahrer fehlt" : vorschlag.fahrerNamen.joined(separator: ", ")
        ZStack(alignment: .topLeading) {
            VStack(alignment: .leading, spacing: 5) {
                WebText(text: gast, groesse: 24, gewicht: .bold, zeilenHoehe: 26, farbe: .black)
                    .padding(.trailing, 86)
                WebText(text: "\(vorschlag.start) - \(vorschlag.ziel)", groesse: 12, gewicht: .medium, zeilenHoehe: 16,
                        farbe: UIColor.black.withAlphaComponent(0.8))
                WebText(text: fahrer, groesse: 16, gewicht: .bold, zeilenHoehe: 24, farbe: .black)
            }
            .padding(18)
            VStack(alignment: .trailing, spacing: 0) {
                Text(datum).font(.grotesk(16, .bold)).frame(height: 20)
                Text(vorschlag.startZeit.isEmpty ? "--:--" : vorschlag.startZeit).font(.grotesk(16)).frame(height: 20)
            }
            .foregroundStyle(.black)
            .padding(.top, 18).padding(.trailing, 16)
            .frame(maxWidth: .infinity, alignment: .trailing)
        }
        .frame(maxWidth: .infinity, minHeight: 144, alignment: .topLeading)
        .overlay(alignment: .bottomTrailing) {
            Image("Arrow_Trisar_Icons_01").resizable().frame(width: 34, height: 21).scaleEffect(1.2)
                .padding(.trailing, 16).padding(.bottom, 18)
        }
        .background(Color.white)
    }
}

/// Senden-Knopf und beim Bearbeiten der rote Abbrechen-Knopf links daneben (.ki-aktionen).
/// Der Goo-Tropfen aus dem Web ist hier ein weicher Breiten- und Skalierungs-Uebergang.
private struct KiAktionen: View {
    let bearbeitet: Bool
    let sendenAktiv: Bool
    let abbrechen: () -> Void
    let senden: () -> Void

    var body: some View {
        ZStack(alignment: .trailing) {
            Button(action: abbrechen) {
                Image("Abbrechen_Rund_Trisar_01").resizable().frame(width: 48, height: 48)
            }
            .buttonStyle(.web)
            .scaleEffect(bearbeitet ? 1 : 0.45)
            .opacity(bearbeitet ? 1 : 0)
            .offset(x: bearbeitet ? -60 : 0)
            .allowsHitTesting(bearbeitet)
            .accessibilityLabel("Abbrechen")

            Button(action: senden) {
                Image("Arrow_Trisar_Icons_01").resizable().frame(width: 20, height: 20)
                    .frame(width: 48, height: 48)
                    .background(Circle().fill(Color(hex: sendenAktiv ? 0xE3F754 : 0xE3F654)))
                    .opacity(sendenAktiv ? 1 : 0.5)
            }
            .buttonStyle(.web)
            .disabled(!sendenAktiv)
        }
        .frame(width: bearbeitet ? 108 : 48, height: 48, alignment: .trailing)
        .animation(.timingCurve(0.37, 0, 0.18, 1, duration: 0.86), value: bearbeitet)
    }
}

// MARK: - Symbole (SVG aus KiAssistentView.jsx, viewBox 24)

private struct KiSymbolKopieren: View {
    var body: some View {
        Canvas { k, g in
            let s = g.width / 24
            var p = Path()
            p.addRect(CGRect(x: 9 * s, y: 9 * s, width: 10 * s, height: 10 * s))
            p.move(to: CGPoint(x: 5 * s, y: 15 * s)); p.addLine(to: CGPoint(x: 5 * s, y: 5 * s))
            p.addLine(to: CGPoint(x: 15 * s, y: 5 * s))
            k.stroke(p, with: .foreground, lineWidth: 2 * s)
        }
    }
}

private struct KiSymbolHaken: View {
    var body: some View {
        Canvas { k, g in
            let s = g.width / 24
            var p = Path()
            p.move(to: CGPoint(x: 5 * s, y: 12.5 * s)); p.addLine(to: CGPoint(x: 9.5 * s, y: 17 * s))
            p.addLine(to: CGPoint(x: 19 * s, y: 7.5 * s))
            k.stroke(p, with: .foreground, style: StrokeStyle(lineWidth: 2.4 * s, lineCap: .square))
        }
    }
}

private struct KiSymbolStift: View {
    let gefuellt: Bool
    var body: some View {
        Canvas { k, g in
            let s = g.width / 24
            func pt(_ x: CGFloat, _ y: CGFloat) -> CGPoint { CGPoint(x: x * s, y: y * s) }
            var p = Path()
            p.move(to: pt(4, 20)); p.addLine(to: pt(8.2, 19)); p.addLine(to: pt(17.8, 9.4))
            p.addQuadCurve(to: pt(17.8, 7.2), control: pt(18.6, 8.3))
            p.addLine(to: pt(16.8, 6.2))
            p.addQuadCurve(to: pt(14.6, 6.2), control: pt(15.7, 5.4))
            p.addLine(to: pt(5, 15.8)); p.closeSubpath()
            if gefuellt {
                k.fill(p, with: .foreground)
                k.stroke(p, with: .foreground, style: StrokeStyle(lineWidth: 2 * s, lineJoin: .round))
            } else {
                k.stroke(p, with: .foreground, lineWidth: 2 * s)
                var q = Path()
                q.move(to: pt(13, 7)); q.addLine(to: pt(17, 11))
                k.stroke(q, with: .foreground, lineWidth: 2 * s)
            }
        }
    }
}
