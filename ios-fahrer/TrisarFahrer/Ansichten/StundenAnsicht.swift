import SwiftUI

/// Stundenerfassung im Fahrer (wie Stunden.jsx): eine Karte am Ende jedes Diensttages, gebaut wie die
/// Dienstkarte (dunkle Flaeche, grosse Zeiten), darin die Fahrten des Dienstes. Darunter Ablehnen,
/// Bearbeiten, Annehmen wie bei Diensten und Fahrten. Zeiten immer auf halbe Stunden gerundet.

private let lime = Farbe.lime
private let rot = Color(hex: 0xFF6F63)
private let orange = Color(hex: 0xFFCD8A)
private let flaeche = Color(hex: 0x1A1A1A)

/// Offene und eingereichte Stunden der letzten zwei Wochen fuer die Fahrtenliste.
@MainActor
final class StundenSpeicher: ObservableObject {
    static let shared = StundenSpeicher()
    @Published private(set) var eintraege: [Stunden.Eintrag] = []
    @Published private(set) var arbeitetID: UUID?
    @Published var fehler: String?

    /// Karten fuer die Startseite: Dienst vorbei, noch nicht bestaetigt.
    var karten: [Stunden.Eintrag] { eintraege.filter { $0.vorbei && $0.zettel?.status != "bestaetigt" } }

    func laden() async { eintraege = await Stunden.verlauf(tage: 14) }

    func annehmen(_ e: Stunden.Eintrag) async {
        guard let v = e.vorschlag, let b = Stunden.datum(v.beginn), let en = Stunden.datum(v.ende) else {
            fehler = "Kein Vorschlag, bitte bearbeiten."; return
        }
        await ausfuehren(e) { try await Stunden.speichern(e, beginn: b, ende: en, pauseMin: v.pause_min ?? 0, angepasst: false, begruendung: nil) }
    }

    func ablehnen(_ e: Stunden.Eintrag, grund: String) async {
        let b = Stunden.datum(e.vorschlag?.beginn) ?? Stunden.zeitpunkt(e.dienst.datum, e.dienst.beginn ?? "00:00") ?? Date()
        await ausfuehren(e) {
            try await Stunden.speichern(e, beginn: b, ende: b, pauseMin: 0, angepasst: true,
                                        begruendung: "Abgelehnt: " + grund.trimmingCharacters(in: .whitespacesAndNewlines))
        }
    }

    private func ausfuehren(_ e: Stunden.Eintrag, _ arbeit: () async throws -> Void) async {
        arbeitetID = e.id
        do { try await arbeit(); fehler = nil } catch { fehler = "Speichern fehlgeschlagen: \(error.localizedDescription)" }
        await laden()
        arbeitetID = nil
    }
}

/// Linie — „Mittwoch 04.11.“ — Linie (wie in der Fahrtenliste).
struct StundenTageszeile: View {
    let datum: String
    var body: some View {
        HStack(spacing: 0) {
            Rectangle().fill(lime).frame(width: 44, height: 2)
            Spacer(minLength: 0)
            Text(Datum.trennzeile(datum)).grotesk(26, .bold, abstand: -0.5).foregroundStyle(lime).lineLimit(1)
            Spacer(minLength: 0)
            Rectangle().fill(lime).frame(width: 44, height: 2)
        }
        .frame(height: 32)
    }
}

/// Die Stundenkarte. Breite 362, Hoehe aus hoehe(_:) (fuer das Raster der Fahrtenliste).
struct StundenKarte: View {
    let eintrag: Stunden.Eintrag
    var beschaeftigt = false
    let annehmen: () -> Void
    let bearbeiten: () -> Void
    let ablehnen: () -> Void

    static let kopf: CGFloat = 124
    static let zeile: CGFloat = 46
    static let zeilenAbstand: CGFloat = 8

    /// Knoepfe solange offen oder von der Dispo zurueckgegeben.
    static func mitKnoepfen(_ e: Stunden.Eintrag) -> Bool { e.offen }
    private static func notiz(_ e: Stunden.Eintrag) -> String? {
        guard let z = e.zettel else { return nil }
        if z.status == "zurueckgewiesen", let n = z.dispo_notiz, !n.isEmpty { return "Dispo: " + n }
        if let b = z.begruendung, !b.isEmpty { return b }
        return nil
    }

    /// Hoehe der dunklen Karte (ohne Knoepfe).
    static func kartenHoehe(_ e: Stunden.Eintrag) -> CGFloat {
        let n = CGFloat(e.vorschlag?.fahrten?.count ?? 0)
        var h = kopf
        if n > 0 { h += 1 + 14 + n * zeile + (n - 1) * zeilenAbstand + 16 }
        if notiz(e) != nil { h += 30 }
        return h
    }
    static func hoehe(_ e: Stunden.Eintrag) -> CGFloat {
        kartenHoehe(e) + (mitKnoepfen(e) ? 12 + 51 : 0)
    }

    private var z: Stunden.Zettel? { eintrag.zettel }
    private var v: Stunden.Vorschlag? { eintrag.vorschlag }
    private var arbeitsMin: Int { z.map { $0.arbeits_min } ?? v?.arbeits_min ?? 0 }
    private var beginn: String { Stunden.uhr(z?.beginn ?? v?.beginn) }
    private var ende: String { Stunden.uhr(z?.ende ?? v?.ende) }
    private var pauseMin: Int { z?.pause_min ?? v?.pause_min ?? 0 }
    private var randFarbe: Color {
        switch z?.status {
        case "eingereicht": return lime
        case "zurueckgewiesen": return rot
        default: return .clear
        }
    }
    private var etikett: (String, Color)? {
        switch z?.status {
        case "eingereicht": return ("Eingereicht", lime)
        case "zurueckgewiesen": return ("Zurückgegeben", rot)
        case "bestaetigt": return ("Bestätigt", Color(hex: 0x8DFFAF))
        default: return nil
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            VStack(alignment: .leading, spacing: 0) {
                // Kopf wie die Dienstkarte: grosse Zeile Lime, darunter Zeiten
                VStack(alignment: .leading, spacing: 20) {
                    HStack(alignment: .firstTextBaseline) {
                        Text("Stunden \(Stunden.hmm(arbeitsMin))").grotesk(38, .bold).foregroundStyle(Color(hex: 0xE3F654))
                            .lineLimit(1).minimumScaleFactor(0.7)
                        Spacer(minLength: 0)
                        if let (text, farbe) = etikett {
                            Text(text).grotesk(13, .bold).foregroundStyle(farbe)
                        }
                    }
                    Text("\(beginn) – \(ende)" + (pauseMin > 0 ? " · Pause \(Stunden.hmm(pauseMin))" : ""))
                        .grotesk(24, .bold).foregroundStyle(.white).lineLimit(1).minimumScaleFactor(0.7)
                }
                .padding(.horizontal, 12).padding(.top, 19)
                .frame(height: Self.kopf, alignment: .topLeading)

                if let fahrten = v?.fahrten, !fahrten.isEmpty {
                    Rectangle().fill(.white.opacity(0.1)).frame(height: 1).padding(.horizontal, 12)
                    VStack(alignment: .leading, spacing: Self.zeilenAbstand) {
                        ForEach(fahrten, id: \.id) { f in fahrtZeile(f) }
                    }
                    .padding(.horizontal, 12).padding(.top, 14).padding(.bottom, 16)
                }
                if let n = Self.notiz(eintrag) {
                    Text(n).grotesk(13, .medium).foregroundStyle(z?.status == "zurueckgewiesen" ? rot : orange)
                        .lineLimit(1).frame(height: 18).padding(.horizontal, 12).padding(.bottom, 12)
                }
            }
            .frame(width: 362, height: Self.kartenHoehe(eintrag), alignment: .topLeading)
            .background(flaeche)
            .overlay(Rectangle().strokeBorder(randFarbe, lineWidth: 2))

            if Self.mitKnoepfen(eintrag) {
                StundenKnoepfe(beschaeftigt: beschaeftigt, ablehnen: ablehnen, bearbeiten: bearbeiten, annehmen: annehmen)
            }
        }
        .frame(width: 362, alignment: .topLeading)
    }

    /// Eine Fahrt: Planzeit gross in Lime, Strecke, darunter gefahrene Zeit und Gaeste.
    private func fahrtZeile(_ f: Stunden.Vorschlag.FahrtRoh) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Text(f.zeit ?? Stunden.uhr(f.start)).grotesk(18, .bold).foregroundStyle(lime).frame(width: 52, alignment: .leading)
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 8) {
                    Text(f.von ?? "").grotesk(16, .bold, abstand: -0.5).foregroundStyle(.white).lineLimit(1)
                    Image("Arrow_Trisar_Icons_01_Lime").resizable().scaledToFit().frame(width: 18, height: 12)
                    Text(f.nach ?? "").grotesk(16, .bold, abstand: -0.5).foregroundStyle(.white).lineLimit(1)
                }
                Text(["\(Stunden.uhr(f.start)) – \(Stunden.uhr(f.ende))" + (f.genau == false ? " geplant" : " gefahren"),
                      f.gaeste ?? ""].filter { !$0.isEmpty }.joined(separator: " · "))
                    .grotesk(12, .medium).foregroundStyle(.white.opacity(0.5)).lineLimit(1)
            }
        }
        .frame(height: Self.zeile, alignment: .topLeading)
    }
}

/// Ablehnen (roter Rand), Bearbeiten (Lime-Rand), Annehmen (Lime), zusammen 362 breit, 51 hoch.
struct StundenKnoepfe: View {
    let beschaeftigt: Bool
    let ablehnen: () -> Void
    let bearbeiten: () -> Void
    let annehmen: () -> Void
    private let breite: CGFloat = (362 - 12) / 3

    var body: some View {
        HStack(spacing: 6) {
            Button(action: ablehnen) {
                Text("Ablehnen").grotesk(20, .bold, abstand: -0.5).foregroundStyle(rot)
                    .frame(width: breite, height: 51).overlay(Rectangle().strokeBorder(rot, lineWidth: 2))
            }
            Button(action: bearbeiten) {
                Text("Bearbeiten").grotesk(20, .bold, abstand: -0.5).foregroundStyle(lime)
                    .frame(width: breite, height: 51).overlay(Rectangle().strokeBorder(lime, lineWidth: 2))
            }
            Button(action: annehmen) {
                Text("Annehmen").grotesk(20, .bold, abstand: -0.5).foregroundStyle(.black)
                    .frame(width: breite, height: 51).background(lime)
            }
        }
        .buttonStyle(.web)
        .disabled(beschaeftigt)
        .opacity(beschaeftigt ? 0.6 : 1)
    }
}

/// Bearbeiten und Ablehnen als Vollbild, an einer Stelle fuer Fahrtenliste und Verlauf.
struct StundenAktionen: ViewModifier {
    @Binding var bearbeiten: Stunden.Eintrag?
    @Binding var ablehnen: Stunden.Eintrag?
    var fertig: () -> Void = {}

    func body(content: Content) -> some View {
        content
            .webVollbild(item: $bearbeiten) { e in
                StundenBearbeitenAnsicht(eintrag: e, schliessen: { bearbeiten = nil }) {
                    bearbeiten = nil
                    Task { await StundenSpeicher.shared.laden(); fertig() }
                }
            }
            .webVollbild(item: $ablehnen) { e in
                NotizBlatt(titel: "Warum stimmen die Stunden nicht?", titelFarbe: rot,
                           knopf: "Ablehnen senden", knopfFarbe: rot,
                           schliessen: { ablehnen = nil }) { notiz in
                    ablehnen = nil
                    Task { await StundenSpeicher.shared.ablehnen(e, grund: notiz.isEmpty ? "ohne Angabe" : notiz); fertig() }
                }
            }
    }
}

/// Verlauf (Profil -> Verlauf): jeder vergangene Dienst als Stundenkarte unter seinem Tag.
struct VerlaufAnsicht: View {
    var zurueck: () -> Void
    @State private var eintraege: [Stunden.Eintrag]?
    @State private var bearbeiten: Stunden.Eintrag?
    @State private var ablehnen: Stunden.Eintrag?
    @ObservedObject private var speicher = StundenSpeicher.shared

    var body: some View {
        ZStack(alignment: .bottom) {
            ProfilHintergrund().ignoresSafeArea()
            ScrollView(.vertical, showsIndicators: false) {
                VStack(alignment: .leading, spacing: 0) {
                    ZurueckKnopf(aktion: zurueck).frame(width: 50, height: 50)
                    Text("Verlauf").font(.grotesk(42, .bold)).tracking(-0.5).foregroundStyle(lime).padding(.top, 30)
                    if let eintraege {
                        if eintraege.isEmpty {
                            Text("Noch keine abgeschlossenen Dienste.").font(.grotesk(16, .medium))
                                .foregroundStyle(.white.opacity(0.7)).padding(.top, 24)
                        }
                        VStack(alignment: .leading, spacing: 44) {
                            ForEach(eintraege) { e in
                                VStack(alignment: .leading, spacing: 24) {
                                    StundenTageszeile(datum: e.dienst.datum)
                                    if e.vorbei {
                                        StundenKarte(eintrag: e, beschaeftigt: speicher.arbeitetID == e.id,
                                                     annehmen: { Task { await speicher.annehmen(e); await neu() } },
                                                     bearbeiten: { bearbeiten = e }, ablehnen: { ablehnen = e })
                                    } else {
                                        Text("Dienst läuft noch").grotesk(16, .medium).foregroundStyle(.white.opacity(0.5))
                                    }
                                }
                            }
                        }
                        .padding(.top, 32)
                    }
                }
                .padding(.horizontal, 20).padding(.top, 60).padding(.bottom, 90)
                .frame(maxWidth: 402, alignment: .leading)
                .frame(maxWidth: .infinity)
            }
            .contentMargins(.vertical, 0, for: .scrollContent)
            .ignoresSafeArea()
            FussleisteUnten()
        }
        .task { await neu() }
        .zurueckPerWischen(zurueck)
        .modifier(StundenAktionen(bearbeiten: $bearbeiten, ablehnen: $ablehnen) { Task { await neu() } })
    }

    private func neu() async { eintraege = await Stunden.verlauf() }
}

/// Bearbeiten: Beginn, Ende und Pause in halben Stunden, dazu eine Notiz, warum es abweicht.
struct StundenBearbeitenAnsicht: View {
    let eintrag: Stunden.Eintrag
    let schliessen: () -> Void
    let fertig: () -> Void

    @State private var beginn = 0      // Minuten ab Mitternacht, Schritt 30
    @State private var ende = 0
    @State private var pause = 0
    @State private var begruendung = ""
    @State private var fehler = ""
    @State private var busy = false
    @FocusState private var fokus: Bool

    private static let halbe = Array(stride(from: 0, to: 24 * 60, by: 30))
    private static let pausen = Array(stride(from: 0, through: 180, by: 30))

    private var arbeitsMin: Int {
        var dauer = ende - beginn
        if dauer <= 0 { dauer += 24 * 60 }
        return max(0, dauer - pause)
    }

    var body: some View {
        ZStack(alignment: .bottom) {
            ProfilHintergrund().ignoresSafeArea()
            ScrollView(.vertical, showsIndicators: false) {
                VStack(alignment: .leading, spacing: 0) {
                    ZurueckKnopf(aktion: schliessen).frame(width: 50, height: 50)
                    Text("Stunden bearbeiten").font(.grotesk(42, .bold)).tracking(-0.5).foregroundStyle(lime)
                        .fixedSize(horizontal: false, vertical: true).padding(.top, 30)
                    Text(Datum.trennzeile(eintrag.dienst.datum)).grotesk(20, .bold).foregroundStyle(.white.opacity(0.7)).padding(.top, 8)

                    VStack(alignment: .leading, spacing: 20) {
                        Text("Stunden \(Stunden.hmm(arbeitsMin))").grotesk(38, .bold).foregroundStyle(Color(hex: 0xE3F654))
                        Text("Vorschlag \(Stunden.uhr(eintrag.vorschlag?.beginn)) – \(Stunden.uhr(eintrag.vorschlag?.ende)) · \(Stunden.hmm(eintrag.vorschlag?.arbeits_min))")
                            .grotesk(16, .bold).foregroundStyle(.white.opacity(0.5))
                    }
                    .padding(.horizontal, 12).padding(.top, 19)
                    .frame(width: 362, height: 124, alignment: .topLeading)
                    .background(flaeche)
                    .padding(.top, 28)

                    HStack(spacing: 6) {
                        rad("Beginn", $beginn, Self.halbe) { Stunden.hmm($0) }
                        rad("Ende", $ende, Self.halbe) { Stunden.hmm($0) }
                        rad("Pause", $pause, Self.pausen) { "\(Stunden.hmm($0)) h" }
                    }
                    .padding(.top, 12)

                    VStack(alignment: .leading, spacing: 8) {
                        Text("Warum weicht es ab?").grotesk(16, .bold, abstand: 0.5).foregroundStyle(Color(hex: 0x1D1C1D))
                        TextField("", text: $begruendung, prompt: Text(verbatim: "Schreiben...").foregroundStyle(Color(red: 129 / 255, green: 129 / 255, blue: 129 / 255, opacity: 0.5)), axis: .vertical)
                            .font(.grotesk(14)).foregroundStyle(Color(hex: 0x1D1C1D))
                            .focused($fokus)
                            .lineLimit(4, reservesSpace: true)
                    }
                    .padding(16)
                    .frame(width: 362, alignment: .topLeading)
                    .background(Color.white)
                    .padding(.top, 12)

                    if !fehler.isEmpty { Text(fehler).grotesk(14, .medium).foregroundStyle(rot).padding(.top, 12) }
                }
                .padding(.horizontal, 20).padding(.top, 60).padding(.bottom, 200)
                .frame(maxWidth: 402, alignment: .leading)
                .frame(maxWidth: .infinity)
            }
            .contentMargins(.vertical, 0, for: .scrollContent)
            .scrollDismissesKeyboard(.interactively)
            .ignoresSafeArea()

            Button { Task { await speichern() } } label: {
                HStack {
                    Text("Bearbeitung senden").grotesk(16, .bold, abstand: -0.5).foregroundStyle(.black)
                    Spacer()
                    if busy { ProgressView().tint(.black) } else { Image("PfeilDunkel").resizable().frame(width: 34, height: 20) }
                }
                .padding(.horizontal, 24).frame(width: 362, height: 56).background(lime)
            }
            .buttonStyle(.web)
            .disabled(busy)
            .padding(.top, 24).padding(.bottom, 70)
            .frame(maxWidth: .infinity)
            .background(LinearGradient(stops: [.init(color: .black.opacity(0), location: 0), .init(color: .black, location: 0.35)], startPoint: .top, endPoint: .bottom))
            .ignoresSafeArea()
            if !fokus { FussleisteUnten() }
        }
        .zurueckPerWischen(schliessen)
        .onAppear(perform: vorbelegen)
    }

    /// Dunkle Kachel mit Zeitrad (wie die Zeitwahl in Android), Werte in halben Stunden.
    private func rad(_ titel: String, _ wert: Binding<Int>, _ werte: [Int], _ text: @escaping (Int) -> String) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(titel).grotesk(13, .bold).foregroundStyle(.white.opacity(0.5)).padding(.leading, 12).padding(.top, 12)
            Picker(titel, selection: wert) {
                ForEach(werte, id: \.self) { m in Text(text(m)).grotesk(22, .bold).foregroundStyle(.white).tag(m) }
            }
            .pickerStyle(.wheel)
            .frame(height: 120)
            .clipped()
        }
        .frame(width: (362 - 12) / 3)
        .background(flaeche)
    }

    /// Uhrzeit (Europe/Berlin) als Minuten ab Mitternacht, auf halbe Stunden gerundet.
    private func minuten(_ d: Date?) -> Int? {
        guard let d else { return nil }
        let teile = Stunden.uhr(d).split(separator: ":").compactMap { Int($0) }
        guard teile.count == 2 else { return nil }
        return Int((Double(teile[0] * 60 + teile[1]) / 30).rounded()) * 30 % (24 * 60)
    }

    private func vorbelegen() {
        let z = eintrag.zettel, v = eintrag.vorschlag, tag = eintrag.dienst.datum
        beginn = minuten(Stunden.datum(z?.beginn ?? v?.beginn)) ?? minuten(eintrag.dienst.beginn.flatMap { Stunden.zeitpunkt(tag, $0) }) ?? 8 * 60
        ende = minuten(Stunden.datum(z?.ende ?? v?.ende)) ?? minuten(eintrag.dienst.ende.flatMap { Stunden.zeitpunkt(tag, $0) }) ?? 16 * 60
        pause = Int((Double(z?.pause_min ?? v?.pause_min ?? 0) / 30).rounded()) * 30
        begruendung = (z?.begruendung ?? "").replacingOccurrences(of: "Abgelehnt: ", with: "")
    }

    private func speichern() async {
        let grund = begruendung.trimmingCharacters(in: .whitespacesAndNewlines)
        if grund.isEmpty { fehler = "Bitte kurz schreiben, warum die Zeiten abweichen."; return }
        func hhmm(_ m: Int) -> String { String(format: "%02d:%02d", m / 60, m % 60) }
        guard let b = Stunden.zeitpunkt(eintrag.dienst.datum, hhmm(beginn)),
              let e = Stunden.zeitpunkt(eintrag.dienst.datum, hhmm(ende), nach: b) else { fehler = "Beginn und Ende wählen."; return }
        busy = true; fehler = ""
        do {
            try await Stunden.speichern(eintrag, beginn: b, ende: e, pauseMin: pause, angepasst: true, begruendung: grund)
            busy = false
            fertig()
        } catch {
            busy = false
            fehler = "Speichern fehlgeschlagen: \(error.localizedDescription)"
        }
    }
}
