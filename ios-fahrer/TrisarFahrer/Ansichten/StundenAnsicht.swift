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
    /// Dazu der laufende Dienst von heute (Figma 2823-12431).
    var karten: [Stunden.Eintrag] {
        eintraege.filter { ($0.vorbei && $0.zettel?.status != "bestaetigt")
            || (!$0.vorbei && $0.dienst.datum == Stunden.heuteDatum && Stunden.heute($0) != nil) }
    }

    func laden() async { eintraege = await Stunden.verlauf(tage: 14) }

    func annehmen(_ e: Stunden.Eintrag) async {
        if let z = e.zettel, z.status == "dispo_geaendert" {
            await ausfuehren(e) { try await Stunden.dispoAenderungAnnehmen(z) }
            return
        }
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
        case "dispo_geaendert": return orange
        default: return .clear
        }
    }
    private var etikett: (String, Color)? {
        switch z?.status {
        case "eingereicht": return ("Eingereicht", lime)
        case "zurueckgewiesen": return ("Zurückgegeben", rot)
        case "dispo_geaendert": return ("Von Dispo geändert", orange)
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

/// Weisse Fahrtkarte wie EntryCard im Demo-Verlauf (Verlauf.jsx): Datum und Uhrzeit, darunter die Gaeste.
struct VerlaufFahrtKarte: View {
    let fahrt: Verlauf.Fahrt
    private var namen: [String] { GaesteAnzeige.zeilen(fahrt.gaeste ?? [], anonym: fahrt.anonym ?? 0) }
    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(Verlauf.kartenZeile(fahrt)).grotesk(14, .medium, abstand: 0.35)
                .foregroundStyle(Color(hex: 0x18181B).opacity(0.8)).lineLimit(1)
            VStack(alignment: .leading, spacing: 0) {
                ForEach(Array(namen.enumerated()), id: \.offset) { _, name in
                    Text(name).grotesk(24, .bold, abstand: 0.6).foregroundStyle(Color(hex: 0x18181B))
                        .lineLimit(1).frame(minHeight: namen.count > 1 ? 28 : 24, alignment: .leading)
                }
            }
        }
        .padding(.horizontal, 16).padding(.vertical, namen.count > 2 ? 18 : 10)
        .frame(width: 362, height: namen.count > 2 ? nil : (namen.count > 1 ? 112 : 96), alignment: .leading)
        .background(Color.white)
    }
}

/// Rahmenzeile Dienststart (Lime) bzw. Dienstende (Rot) wie StatusRow im Demo-Verlauf.
struct VerlaufRahmenZeile: View {
    let text: String
    let farbe: Color
    var body: some View {
        Text(text).grotesk(24, .bold, abstand: 0.6).foregroundStyle(farbe).lineLimit(1)
            .padding(.horizontal, 16)
            .frame(width: 362, height: 48, alignment: .leading)
            .overlay(Rectangle().strokeBorder(farbe, lineWidth: 1))
    }
}

/// Heute (Figma 2837-12573, wie HeuteStunden in Stunden.jsx): Karte 362 x 220 mit Start, begonnenen
/// Pausen und nach dem Dienst Ende, immer mittig. Darunter die Arbeitszeit, die jede Minute hochrollt.
/// Fertig (Dienstende, keine Fahrt mehr unterwegs, Figma 2838-12842): Bearbeiten und Bestaetigen.
/// Bearbeiten macht die Zeiten antippbar, dazu Notiz wie beim Stornieren und „Anfrage senden“.
/// Rand Lime bis bestaetigt bzw. gesendet, dann gruen, von der Dispo zurueckgegeben rot.
struct HeuteStundenKarte: View {
    let eintrag: Stunden.Eintrag
    var nachher: () -> Void = {}
    /// Fahrtenliste (festes Raster): Bearbeiten oeffnet sich als Vollbild statt unter der Karte.
    var vollbild = false
    /// Im Vollbild gleich im Bearbeiten-Modus starten, schliessen beendet das Vollbild.
    var startetBearbeitet = false
    var schliessen: (() -> Void)? = nil

    /// Hoehe im Raster der Fahrtenliste: Karte 220, Statuszeile 10 + 20, Knoepfe 10 + 56.
    static func hoehe(_ e: Stunden.Eintrag) -> CGFloat {
        guard let s = Stunden.heute(e) else { return 0 }
        let z = e.zettel
        let offen = s.fertig && Stunden.fahrerDran(z)
        return 220 + (s.fertig && z != nil ? 30 : 0) + (offen ? 66 : 0) + CGFloat((e.standby ?? []).count) * 26
    }

    @State private var zeigeVollbild = false

    private struct Werte { var start: Date; var ende: Date; var pausen: [(von: Date, bis: Date)] }
    @State private var werte: Werte?
    @State private var notiz = ""
    @State private var busy = false
    @State private var fehler: String?
    @FocusState private var fokus: Bool

    private let gruen = Color(hex: 0x59BE80)
    private let rotKnopf = Color(hex: 0xFF6F63)
    private let zahl = Color(hex: 0xE2F754)

    var body: some View {
        TimelineView(.periodic(from: .now, by: 1)) { kontext in
            if let s0 = Stunden.heute(eintrag, jetzt: kontext.date) {
                inhalt(s0)
            }
        }
        .onAppear {
            if startetBearbeitet, werte == nil, let s0 = Stunden.heute(eintrag) {
                werte = Werte(start: s0.start, ende: s0.ende ?? s0.start, pausen: s0.pausen.map { ($0.von, $0.bis ?? s0.ende ?? $0.von) })
            }
        }
        .fullScreenCover(isPresented: $zeigeVollbild) {
            ZStack(alignment: .topLeading) {
                ProfilHintergrund().ignoresSafeArea()
                ScrollView(.vertical, showsIndicators: false) {
                    VStack(alignment: .leading, spacing: 24) {
                        Text("Stunden bearbeiten").font(.grotesk(42, .bold)).tracking(-0.5).foregroundStyle(lime)
                        HeuteStundenKarte(eintrag: eintrag, nachher: { zeigeVollbild = false; nachher() },
                                          startetBearbeitet: true, schliessen: { zeigeVollbild = false })
                    }
                    .padding(.horizontal, 20).padding(.top, 70).padding(.bottom, 120)
                    .frame(maxWidth: 402, alignment: .leading)
                    .frame(maxWidth: .infinity)
                }
            }
        }
    }

    @ViewBuilder private func inhalt(_ s0: Stunden.Heute) -> some View {
        let z = eintrag.zettel
        let offen = s0.fertig && Stunden.fahrerDran(z)
        let arbeits: Int = {
            guard let w = werte else { return s0.arbeitsMin }
            let p = w.pausen.map { ($0.von, Optional($0.bis)) }
            return Stunden.halbeAuf(w.ende.timeIntervalSince(w.start) / 60 - Stunden.pausenMin(p, bis: w.ende))
        }()
        let zeit = String(format: "%02d:%02d", arbeits / 60, arbeits % 60)
        let rand: Color = (!s0.fertig || werte != nil || z == nil) ? lime : (z?.status == "zurueckgewiesen" ? rot : z?.status == "dispo_geaendert" ? orange : gruen)
        VStack(alignment: .leading, spacing: 0) {
            VStack(spacing: 0) {
                Text("Stundenerfassung").grotesk(18, .bold, abstand: -0.5).foregroundStyle(lime)
                    .frame(height: 23).padding(.top, 11)
                HStack(alignment: .top, spacing: 5) {
                    if let w = werte {
                        kasten("Start", oben: zeitFeld(w.start, gross: true) { werte?.start = $0 }, aktiv: true)
                        ForEach(w.pausen.indices, id: \.self) { i in
                            kasten("Pause", oben: zeitFeld(w.pausen[i].von) { werte?.pausen[i].von = $0 },
                                   unten: zeitFeld(w.pausen[i].bis) { werte?.pausen[i].bis = $0 }, grau: true, aktiv: true)
                        }
                        kasten("Ende", oben: zeitFeld(w.ende, gross: true) { werte?.ende = $0 }, aktiv: true)
                    } else {
                        kasten("Start", oben: text(Stunden.uhr(s0.start), gross: true))
                        ForEach(s0.pausen, id: \.self) { p in
                            kasten("Pause", oben: text(Stunden.uhr(p.von)), unten: p.laeuft ? nil : text(Stunden.uhr(p.bis)), grau: true)
                        }
                        if let ende = s0.ende { kasten("Ende", oben: text(Stunden.uhr(ende), gross: true)) }
                    }
                }
                .padding(.top, 13)
                Text(zeit).grotesk(35, .bold, abstand: -0.5).foregroundStyle(zahl)
                    .monospacedDigit()
                    .contentTransition(.numericText())
                    .animation(.easeOut(duration: 0.45), value: zeit)
                    .frame(height: 45).padding(.top, 9)
                Spacer(minLength: 0)
            }
            .frame(width: 362, height: 220)
            .background(flaeche)
            .overlay(Rectangle().strokeBorder(rand, lineWidth: 2))

            // Standby am Event-Ort: je Standby eine Zeile (Stunden.jsx).
            ForEach(Array((eintrag.standby ?? []).enumerated()), id: \.offset) { _, sb in
                Text("Standby \(sb.ort ?? "") \(sb.von ?? "")–\(sb.bis ?? "")").grotesk(14, .bold)
                    .foregroundStyle(Color(hex: 0x868687)).lineLimit(1).frame(height: 20).padding(.top, 6)
            }

            if s0.fertig, let z, werte == nil, let st = statusText(z) {
                Text(st.0).grotesk(14, .bold).foregroundStyle(st.1).lineLimit(1).frame(height: 20).padding(.top, 10)
            }

            if offen && werte == nil {
                HStack(spacing: 10) {
                    knopf("Bearbeiten", farbe: rotKnopf) {
                        if vollbild { zeigeVollbild = true; return }
                        werte = Werte(start: s0.start, ende: s0.ende ?? s0.start,
                                      pausen: s0.pausen.map { ($0.von, $0.bis ?? s0.ende ?? $0.von) })
                        notiz = ""; fehler = nil
                    }
                    knopf("Bestätigen", farbe: gruen) {
                        if let z, z.status == "dispo_geaendert" { zustimmen(z); return }
                        senden(beginn: s0.start, ende: s0.ende ?? s0.start,
                               pausen: s0.pausen.map { ($0.von, $0.bis ?? s0.ende ?? $0.von) }, angepasst: false)
                    }
                }
                .padding(.top, 10)
            }

            if let w = werte {
                Text("Zeiten antippen zum Ändern. Pause erst ab 3 Stunden, kürzere Pausen sind Arbeitszeit.")
                    .grotesk(13, .medium).foregroundStyle(.white.opacity(0.5)).padding(.top, 8)
                // Notiz wie beim Stornieren (NotizBlatt): dunkle Flaeche ueber die volle Breite, weisses Feld 362.
                VStack(alignment: .leading, spacing: 8) {
                    HStack {
                        Text("Notizen").grotesk(16, .bold, abstand: 0.5).foregroundStyle(Color(hex: 0x1D1C1D))
                        Spacer()
                        Image("Stift").resizable().frame(width: 20, height: 20)
                    }
                    TextField("", text: $notiz, prompt: Text(verbatim: "Schreiben...").foregroundStyle(Color(red: 129 / 255, green: 129 / 255, blue: 129 / 255, opacity: 0.5)), axis: .vertical)
                        .font(.grotesk(14)).tracking(0.25)
                        .foregroundStyle(Color(hex: 0x1D1C1D))
                        .focused($fokus)
                        .lineLimit(6, reservesSpace: true)
                    Spacer(minLength: 0)
                }
                .padding(16)
                .frame(width: 362, height: 184, alignment: .topLeading)
                .background(Color.white)
                .onTapGesture { fokus = true }
                .padding(20)
                .frame(width: 402, height: 224)
                .background(RoundedRectangle(cornerRadius: 12).fill(Color(hex: 0x1A1A1A)))
                .padding(.leading, -20)
                .padding(.top, 16)

                Button {
                    fokus = false
                    let n = notiz.trimmingCharacters(in: .whitespacesAndNewlines)
                    guard !n.isEmpty else { fehler = "Bitte kurz schreiben, warum die Zeiten abweichen."; return }
                    senden(beginn: w.start, ende: w.ende, pausen: w.pausen.map { ($0.von, $0.bis) }, angepasst: true, begruendung: n)
                } label: {
                    HStack {
                        Text("Anfrage senden").grotesk(16, .bold, abstand: -0.5).foregroundStyle(.black)
                        Spacer()
                        if busy { ProgressView().tint(.black) } else { Image("PfeilDunkel").resizable().frame(width: 34, height: 20) }
                    }
                    .padding(.horizontal, 24)
                    .frame(width: 362, height: 56)
                    .background(lime)
                }
                .buttonStyle(.web)
                .disabled(busy)
                .padding(.top, 20)

                Button { werte = nil; fehler = nil; schliessen?() } label: {
                    Text("Abbrechen").grotesk(14, .bold).foregroundStyle(.white.opacity(0.6))
                }
                .frame(width: 362).padding(.top, 12)
            }
            if let fehler { Text(fehler).grotesk(14, .medium).foregroundStyle(rot).padding(.top, 10) }
        }
        .frame(width: 362, alignment: .leading)
    }

    private func statusText(_ z: Stunden.Zettel) -> (String, Color)? {
        switch z.status {
        case "eingereicht": return ("Anfrage gesendet, Dispo prüft.", lime)
        case "bestaetigt": return ("Von der Dispo bestätigt.", Color(hex: 0x8DFFAF))
        case "zurueckgewiesen": return ("Von der Dispo zurückgegeben" + ((z.dispo_notiz ?? "").isEmpty ? "" : ": \(z.dispo_notiz!)"), rot)
        case "dispo_geaendert": return ("Dispo hat geändert, bitte bestätigen." + ((z.dispo_notiz ?? "").isEmpty ? "" : " \(z.dispo_notiz!)"), orange)
        default: return nil
        }
    }

    /// Aenderung der Dispo annehmen (Stand dispo_geaendert): fertig, keine neue Einreichung.
    private func zustimmen(_ z: Stunden.Zettel) {
        busy = true; fehler = nil
        Task {
            do {
                try await Stunden.dispoAenderungAnnehmen(z)
                await StundenSpeicher.shared.laden()
                nachher()
            } catch {
                fehler = "Speichern fehlgeschlagen: \(error.localizedDescription)"
            }
            busy = false
        }
    }

    private func senden(beginn: Date, ende: Date, pausen: [(Date, Date)], angepasst: Bool, begruendung: String? = nil) {
        // Ende vor Beginn liegt am Folgetag (Nachtdienst).
        let ende = ende <= beginn ? ende.addingTimeInterval(86400) : ende
        busy = true; fehler = nil
        Task {
            do {
                try await Stunden.heuteSpeichern(eintrag, beginn: beginn, ende: ende, pausen: pausen, angepasst: angepasst, begruendung: begruendung)
                werte = nil
                await StundenSpeicher.shared.laden()
                nachher()
            } catch {
                fehler = "Speichern fehlgeschlagen: \(error.localizedDescription)"
            }
            busy = false
        }
    }

    private func text(_ t: String, gross: Bool = false) -> AnyView {
        AnyView(Text(t).grotesk(gross ? 22 : 17, .bold, abstand: -0.5))
    }

    /// Zeit im Kasten, antippen oeffnet die Uhrzeit-Auswahl (unsichtbarer DatePicker darueber).
    private func zeitFeld(_ wert: Date, gross: Bool = false, setzen: @escaping (Date) -> Void) -> AnyView {
        AnyView(
            Text(Stunden.uhr(wert)).grotesk(gross ? 22 : 17, .bold, abstand: -0.5)
                .overlay {
                    DatePicker("", selection: Binding(get: { wert }, set: setzen), displayedComponents: .hourAndMinute)
                        .labelsHidden()
                        .environment(\.timeZone, Stunden.berlin)
                        .blendMode(.destinationOver)
                        .opacity(0.02)
                        .scaleEffect(1.2)
                }
        )
    }

    private func kasten(_ titel: String, oben: AnyView, unten: AnyView? = nil, grau: Bool = false, aktiv: Bool = false) -> some View {
        let grauFarbe = Color(hex: 0x5F5F5F)
        let farbe: Color = grau ? (aktiv ? .white : grauFarbe) : zahl
        return VStack(spacing: 8) {
            VStack(spacing: 4.5) {
                oben.foregroundStyle(farbe)
                if let unten { unten.foregroundStyle(farbe) }
            }
            .frame(width: 78, height: 78)
            .background(RoundedRectangle(cornerRadius: 12).fill(Color(hex: 0x242525)))
            .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(aktiv ? lime : .clear, lineWidth: 2))
            Text(titel).grotesk(16, .bold, abstand: -0.5).foregroundStyle(grau ? grauFarbe : .white).frame(height: 20)
        }
    }

    private func knopf(_ titel: String, farbe: Color, aktion: @escaping () -> Void) -> some View {
        Button(action: aktion) {
            HStack {
                Text(titel).grotesk(16, .regular, abstand: 0.5).foregroundStyle(.black)
                Spacer()
                if busy { ProgressView().tint(.black) } else { Image("PfeilDunkel").resizable().frame(width: 34, height: 19) }
            }
            .padding(.leading, 16).padding(.trailing, 10)
            .frame(width: 176, height: 56)
            .background(farbe)
        }
        .buttonStyle(.web)
        .disabled(busy)
    }
}

/// Verlauf (Profil -> Verlauf, wie Verlauf.jsx): erledigte Fahrten nach Tagen, neueste zuerst.
/// Dienste aus der Stundenerfassung stehen als Rahmen (Dienststart, Fahrten, Dienstende) mit Stundenkarte darin.
struct VerlaufAnsicht: View {
    var zurueck: () -> Void
    @State private var tage: [Verlauf.Tag]?
    @State private var dienste: [Stunden.Eintrag] = []
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
                    if let tage {
                        if tage.isEmpty {
                            Text("Noch keine erledigten Fahrten.").font(.grotesk(16, .medium))
                                .foregroundStyle(.white.opacity(0.7)).padding(.top, 24)
                        }
                        VStack(alignment: .leading, spacing: 44) {
                            ForEach(tage) { tag in
                                VStack(alignment: .leading, spacing: 24) {
                                    StundenTageszeile(datum: tag.datum)
                                    if tag.datum == Stunden.heuteDatum, let e = heuteEintrag {
                                        HeuteStundenKarte(eintrag: e) { Task { await neu() } }
                                    }
                                    VStack(alignment: .leading, spacing: 6) {
                                        ForEach(tag.eintraege) { eintrag in
                                            switch eintrag {
                                            case .fahrt(let f): VerlaufFahrtKarte(fahrt: f)
                                            case .dienst(let e, let fahrten): dienst(e, fahrten)
                                            }
                                        }
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
        // Solange heute ein Dienst ansteht oder laeuft jede Minute neu laden (Start, Pausen, Ende kommen dazu).
        .task(id: heuteOffen) {
            while heuteOffen && !Task.isCancelled {
                try? await Task.sleep(for: .seconds(60))
                if !Task.isCancelled { await neu() }
            }
        }
        .zurueckPerWischen(zurueck)
        .modifier(StundenAktionen(bearbeiten: $bearbeiten, ablehnen: $ablehnen) { Task { await neu() } })
    }

    @ViewBuilder private func dienst(_ e: Stunden.Eintrag, _ fahrten: [Verlauf.Fahrt]) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            VerlaufRahmenZeile(text: "Dienststart \(e.dienst.beginn ?? "--:--")", farbe: lime).padding(.bottom, 9)
            ForEach(fahrten) { VerlaufFahrtKarte(fahrt: $0) }
            if e.vorbei {
                VerlaufRahmenZeile(text: "Dienstende \(e.dienst.ende ?? "--:--")", farbe: rot).padding(.top, 9)
                // Stundenerfassung im neuen Look (Figma 2823-12622) an jedem vergangenen Dienst.
                if e.id != heuteEintrag?.id {
                    HeuteStundenKarte(eintrag: e) { Task { await neu() } }.padding(.top, 18)
                }
            } else {
                Text("Dienst läuft noch").grotesk(16, .medium).foregroundStyle(.white.opacity(0.5)).padding(.top, 9)
            }
        }
    }

    /// Letzter Dienst von heute, der schon begonnen hat.
    private var heuteEintrag: Stunden.Eintrag? {
        dienste.first { $0.dienst.datum == Stunden.heuteDatum && Stunden.heute($0) != nil }
    }
    private var heuteOffen: Bool { dienste.contains { $0.dienst.datum == Stunden.heuteDatum && !$0.vorbei } }

    private func neu() async {
        async let fahrten = Verlauf.fahrten()
        async let d = Stunden.verlauf()
        let alle = await d
        dienste = alle
        tage = Verlauf.tage(await fahrten, alle)
    }
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
    private static let pausen = [0] + Array(stride(from: 180, through: 600, by: 30))

    private var arbeitsMin: Int {
        var dauer = ende - beginn
        if dauer <= 0 { dauer += 24 * 60 }
        return max(0, dauer - (pause >= Stunden.pauseMindest ? pause : 0))
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
                    Text("Pause erst ab 3 Stunden, kürzere Pausen sind Arbeitszeit.").grotesk(13, .medium).foregroundStyle(.white.opacity(0.5)).padding(.top, 8)

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

    /// Uhrzeit (Europe/Berlin) als Minuten ab Mitternacht in halben Stunden, zugunsten des Fahrers
    /// (Beginn ab-, Ende aufgerundet).
    private func minuten(_ d: Date?, auf: Bool = false) -> Int? {
        guard let d else { return nil }
        let teile = Stunden.uhr(d).split(separator: ":").compactMap { Int($0) }
        guard teile.count == 2 else { return nil }
        return Int((Double(teile[0] * 60 + teile[1]) / 30).rounded(auf ? .up : .down)) * 30 % (24 * 60)
    }

    private func vorbelegen() {
        let z = eintrag.zettel, v = eintrag.vorschlag, tag = eintrag.dienst.datum
        beginn = minuten(Stunden.datum(z?.beginn ?? v?.beginn)) ?? minuten(eintrag.dienst.beginn.flatMap { Stunden.zeitpunkt(tag, $0) }) ?? 8 * 60
        ende = minuten(Stunden.datum(z?.ende ?? v?.ende), auf: true) ?? minuten(eintrag.dienst.ende.flatMap { Stunden.zeitpunkt(tag, $0) }, auf: true) ?? 16 * 60
        let p = Int((Double(z?.pause_min ?? v?.pause_min ?? 0) / 30).rounded(.down)) * 30
        pause = p >= Stunden.pauseMindest ? p : 0
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
