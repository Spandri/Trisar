import SwiftUI
import UIKit

/// Nachbau von FahrtenScreen01View.jsx: Fahrzeugkarte, Tageszeilen, Dienstanfragen, Auftragskarten.
/// Alle Masse aus dem Web-Code (Raster 402). Der Inhalt liegt dort in einem Block mit top 20.
struct FahrtenListeAnsicht: View {
    @EnvironmentObject private var speicher: FahrtenSpeicher
    var oeffneProfil: () -> Void
    var oeffneFahrzeug: () -> Void
    var oeffneFahrt: (Fahrt) -> Void

    @State private var ablehnenFahrt: Fahrt?
    @ObservedObject private var stunden = StundenSpeicher.shared
    @State private var stundenBearbeiten: Stunden.Eintrag?
    @State private var stundenAblehnen: Stunden.Eintrag?
    /// Neu zeichnen, wenn ein Fahrzeugbild nicht laedt (Karte/Block werden kuerzer).
    @ObservedObject private var bilder = FahrzeugBildSpeicher.shared

    // Konstanten aus FahrtenScreen01View.jsx
    private let versatz: CGFloat = 20            // <div className="absolute left-0 top-[20px]">
    /// Fahrzeugkarte top 118, Hoehe je nach vorhandenen Angaben (mit allem 268).
    private var fahrzeugUnterkante: CGFloat { 118 + FahrzeugKarte.hoehe(speicher.fahrzeug) }
    private let kartenAbstand: CGFloat = 12
    private let knopfAbstand: CGFloat = 12
    private let knopfHoehe: CGFloat = 51
    private let nachKnopf: CGFloat = 24
    private let tagOben: CGFloat = 44
    private let tagHoehe: CGFloat = 32
    private let tagUnten: CGFloat = 56
    private let dienstHoehe: CGFloat = 124
    private let dienstAbstand: CGFloat = 12
    private let dienstListe: CGFloat = 48

    var body: some View {
        let raster = rasterBerechnen()
        Leinwand(inhaltHoehe: raster.unterkante + versatz + nachKnopf + 64 + 40) { _ in
            ZStack(alignment: .topLeading) {
                Image("trisar_logo").resizable().scaledToFit()
                    .platz(20, versatz + 70, 162, 24)

                ProfilKnopf(aktion: oeffneProfil)
                    .platz(402 - 20 - 52, versatz + 40, 52, 52)

                Button(action: oeffneFahrzeug) {
                    FahrzeugKarte(fahrzeug: speicher.fahrzeug,
                                  titel: speicher.fahrzeug?.license_plate ?? "Kein Kennzeichen")
                }
                .buttonStyle(.web)
                .platz(20, versatz + 118, 362, FahrzeugKarte.hoehe(speicher.fahrzeug))

                ForEach(raster.zeilen, id: \.datum) { zeile in
                    Tageszeile(datum: zeile.datum).platz(20, versatz + zeile.oben, 362, tagHoehe)
                }

                ForEach(raster.dienste, id: \.anfrage.id) { eintrag in
                    DienstKarte(anfrage: eintrag.anfrage, beschaeftigt: speicher.dienstArbeitetID == eintrag.anfrage.id) { annehmen in
                        Task { await speicher.dienstAntworten(eintrag.anfrage, annehmen: annehmen) }
                    }
                    .platz(20, versatz + eintrag.oben, 362, nil)
                }

                // Stunden am Ende des Diensttages
                ForEach(raster.stunden, id: \.eintrag.id) { s in
                    StundenKarte(eintrag: s.eintrag, beschaeftigt: stunden.arbeitetID == s.eintrag.id,
                                 annehmen: { Task { await stunden.annehmen(s.eintrag) } },
                                 bearbeiten: { stundenBearbeiten = s.eintrag },
                                 ablehnen: { stundenAblehnen = s.eintrag })
                    .platz(20, versatz + s.oben, 362, nil)
                }

                ForEach(raster.fahrten, id: \.fahrt.id) { eintrag in
                    AuftragsKarte(
                        fahrt: eintrag.fahrt,
                        mitKnoepfen: eintrag.mitKnoepfen,
                        beschaeftigt: speicher.arbeitet,
                        ungelesen: eintrag.fahrt.kolonnenID.flatMap { speicher.ungelesen[$0] } ?? 0,
                        oeffnen: { oeffneFahrt(eintrag.fahrt) },
                        annehmen: { Task { _ = await speicher.antworten(eintrag.fahrt, annehmen: true) } },
                        ablehnen: { ablehnenFahrt = eintrag.fahrt }
                    )
                    .platz(0, versatz + eintrag.oben, 402, nil)
                }
            }
        }
        .overlay { FussleisteUnten() }
        .modifier(StundenAktionen(bearbeiten: $stundenBearbeiten, ablehnen: $stundenAblehnen))
        .overlay(alignment: .top) { fehlerHinweis }
        .webVollbild(item: $ablehnenFahrt) { fahrt in
            AblehnenBlatt(schliessen: { ablehnenFahrt = nil }) { notiz in
                ablehnenFahrt = nil
                Task { _ = await speicher.antworten(fahrt, annehmen: false, grund: notiz) }
            }
        }
    }

    @ViewBuilder private var fehlerHinweis: some View {
        if let fehler = speicher.fehler ?? stunden.fehler {
            Text(fehler)
                .font(.grotesk(13, .medium))
                .foregroundStyle(.black)
                .padding(12)
                .frame(maxWidth: .infinity)
                .background(Farbe.fehler)
                .onTapGesture { speicher.fehler = nil; stunden.fehler = nil }
                .padding(.top, 50)
        }
    }

    // MARK: Raster (buildListenLayout der Web-App)

    private struct Raster {
        var zeilen: [(datum: String, oben: CGFloat)] = []
        var dienste: [(anfrage: DienstAnfrage, oben: CGFloat)] = []
        var fahrten: [(fahrt: Fahrt, oben: CGFloat, mitKnoepfen: Bool)] = []
        var stunden: [(eintrag: Stunden.Eintrag, oben: CGFloat)] = []
        var unterkante: CGFloat = 0
    }

    private func rasterBerechnen() -> Raster {
        let fahrten = speicher.fahrten.sorted { a, b in
            if a.fahrtDatum != b.fahrtDatum { return a.fahrtDatum < b.fahrtDatum }
            let ma = minuten(a.etd), mb = minuten(b.etd)
            if ma != mb { return ma < mb }
            return a.id.uuidString < b.id.uuidString
        }
        var anfragenProTag: [String: [DienstAnfrage]] = [:]
        for anfrage in speicher.dienstAnfragen {
            let tag = String((anfrage.service_date ?? "").prefix(10))
            guard !tag.isEmpty else { continue }
            anfragenProTag[tag, default: []].append(anfrage)
        }
        var fahrtenProTag: [String: [Fahrt]] = [:]
        for fahrt in fahrten { fahrtenProTag[fahrt.fahrtDatum, default: []].append(fahrt) }
        var stundenProTag: [String: [Stunden.Eintrag]] = [:]
        for e in stunden.karten { stundenProTag[e.dienst.datum, default: []].append(e) }
        // Alle Tage in Reihenfolge: Dienste, Fahrten, am Ende des Tages die Stunden.
        let tage = Set(fahrtenProTag.keys).union(anfragenProTag.keys).union(stundenProTag.keys).sorted()
        var r = Raster()
        var cursor = fahrzeugUnterkante + tagUnten

        for (t, tag) in tage.enumerated() {
            if t > 0 { cursor += tagOben }
            r.zeilen.append((tag, cursor))
            cursor += tagHoehe + tagUnten
            let anfragen = anfragenProTag[tag] ?? []
            for (i, anfrage) in anfragen.enumerated() {
                r.dienste.append((anfrage, cursor))
                cursor += anfrage.angenommen ? dienstHoehe : dienstHoehe + knopfAbstand + knopfHoehe
                if i < anfragen.count - 1 { cursor += dienstAbstand }
            }
            if !anfragen.isEmpty { cursor += dienstListe }
            for fahrt in fahrtenProTag[tag] ?? [] {
                let mitKnoepfen = fahrt.wartetAufAntwort
                r.fahrten.append((fahrt, cursor, mitKnoepfen))
                let h = AuftragsKarte.hoehe(fahrt)
                cursor += mitKnoepfen ? h + knopfAbstand + knopfHoehe + nachKnopf : h + kartenAbstand
            }
            for e in stundenProTag[tag] ?? [] {
                if !(fahrtenProTag[tag] ?? []).isEmpty { cursor += kartenAbstand }
                r.stunden.append((e, cursor))
                cursor += StundenKarte.hoehe(e) + (StundenKarte.mitKnoepfen(e) ? nachKnopf : kartenAbstand)
            }
        }
        r.unterkante = cursor
        return r
    }

    private func minuten(_ zeit: String) -> Int {
        let teile = zeit.split(separator: ":").compactMap { Int($0) }
        guard teile.count >= 2 else { return Int.max }
        return teile[0] * 60 + teile[1]
    }
}

// MARK: - Bausteine

/// Linie — „Mittwoch 04.11.“ — Linie
private struct Tageszeile: View {
    let datum: String
    var body: some View {
        HStack(spacing: 0) {
            Rectangle().fill(Farbe.lime).frame(width: 44, height: 2)
            Spacer(minLength: 0)
            Text(Datum.trennzeile(datum))
                .grotesk(26, .bold, abstand: -0.5)
                .foregroundStyle(Farbe.lime)
                .lineLimit(1)
            Spacer(minLength: 0)
            Rectangle().fill(Farbe.lime).frame(width: 44, height: 2)
        }
    }
}

/// Dienstplan-Anfrage (Dienststart/Dienstende), darunter Ablehnen/Annehmen solange offen.
private struct DienstKarte: View {
    let anfrage: DienstAnfrage
    let beschaeftigt: Bool
    let antworten: (Bool) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            VStack(alignment: .leading, spacing: 20) {
                if let start = anfrage.service_start_time, !start.isEmpty {
                    Text("Dienststart \(String(start.prefix(5)))")
                        .grotesk(38, .bold).foregroundStyle(Color(hex: 0xE3F654))
                }
                if let ende = anfrage.service_end_time, !ende.isEmpty {
                    Text("Dienstende \(String(ende.prefix(5)))")
                        .grotesk(24, .bold).foregroundStyle(Color(hex: 0xFF6F63))
                }
            }
            .padding(.horizontal, 12)
            .padding(.top, 19)
            .frame(width: 362, height: 124, alignment: .topLeading)
            .background(Color(hex: 0x1A1A1A))
            .overlay(Rectangle().strokeBorder(anfrage.angenommen ? Farbe.lime : .clear, lineWidth: 2))

            if !anfrage.angenommen {
                AntwortKnoepfe(beschaeftigt: beschaeftigt, ablehnen: { antworten(false) }, annehmen: { antworten(true) })
            }
        }
    }
}

/// Ablehnen (roter Rand) und Annehmen (Lime), je 178 x 51, bei x 20 und 204.
private struct AntwortKnoepfe: View {
    let beschaeftigt: Bool
    let ablehnen: () -> Void
    let annehmen: () -> Void

    var body: some View {
        HStack(spacing: 6) {
            Button(action: ablehnen) {
                Text("Ablehnen").grotesk(24, .bold, abstand: -0.5)
                    .foregroundStyle(Color(hex: 0xFF6F63))
                    .frame(width: 178, height: 51)
                    .overlay(Rectangle().strokeBorder(Color(hex: 0xFF6F63), lineWidth: 2))
            }
            Button(action: annehmen) {
                Text("Annehmen").grotesk(24, .bold, abstand: -0.5)
                    .foregroundStyle(.black)
                    .frame(width: 178, height: 51)
                    .background(Farbe.lime)
            }
        }
        .buttonStyle(.web)
        .disabled(beschaeftigt)
        .opacity(beschaeftigt ? 0.6 : 1)
    }
}

/// Auftragskarte (RideCard). Wird ueber die volle Breite 402 gelegt, damit die Web-Masse
/// (Icons bei x 53 und 276, Mitte 201) direkt passen.
struct AuftragsKarte: View {
    let fahrt: Fahrt
    let mitKnoepfen: Bool
    let beschaeftigt: Bool
    var ungelesen = 0
    let oeffnen: () -> Void
    let annehmen: () -> Void
    let ablehnen: () -> Void
    /// Eigene Orte der Dispo: hat die Fahrt einen Ort, gilt dessen Icon.
    @ObservedObject private var orte = OrteSpeicher.geteilt

    /// Kartenhoehe: 187 reicht fuer zwei Zeilen Ortsname. Laengere Namen machen die Karte hoeher
    /// (Text beginnt bei 127, 20 je Zeile, 20 Rand unten), damit nichts ueber den Rand laeuft.
    @MainActor static func hoehe(_ fahrt: Fahrt) -> CGFloat {
        max(187, 147 + 20 * CGFloat(max(zeilen(fahrt.abholKurz), zeilen(fahrt.zielKurz))))
    }

    /// Zeilen eines Ortsnamens in der 129 breiten Spalte. Gemessen mit genau dem Text, der in der
    /// Karte steht (variable Schrift: UIKit-Messung traf das Fett nicht und zaehlte eine Zeile zu viel).
    @MainActor private static var zeilenSpeicher: [String: Int] = [:]
    @MainActor static func zeilen(_ text: String) -> Int {
        guard !text.isEmpty else { return 1 }
        if let z = zeilenSpeicher[text] { return z }
        func hoehe(_ t: String) -> CGFloat {
            UIHostingController(rootView: Text(t).grotesk(16, .bold, abstand: -0.5)
                .fixedSize(horizontal: false, vertical: true).frame(width: 129, alignment: .leading))
                .sizeThatFits(in: CGSize(width: 129, height: 10_000)).height
        }
        let eine = hoehe("Ag")
        let z = max(1, Int((hoehe(text) / max(eine, 1)).rounded()))
        zeilenSpeicher[text] = z
        return z
    }

    var body: some View {
        let iconMitte: CGFloat = 42 + 35
        let h = Self.hoehe(fahrt)
        let zeigeEtd = fahrt.istFlughafen || fahrt.istZug
        let zeigePlan = zeigeEtd && !(fahrt.planEtd ?? "").isEmpty

        ZStack(alignment: .topLeading) {
            Button(action: oeffnen) {
                Rectangle().fill(Color(hex: 0x1A1A1A))
                    .overlay(Rectangle().strokeBorder(fahrt.angenommen ? Farbe.lime : .clear, lineWidth: 2))
            }
            .buttonStyle(.web)
            .platz(20, 0, 362, h)

            // Tag oben mittig, mind. 90 breit, bei Kolonne mit Konvoi-Icon.
            HStack(spacing: 10) {
                Text(Datum.tagEtikett(fahrt.fahrtDatum))
                    .grotesk(18, .bold, abstand: -0.5).foregroundStyle(.black)
                if fahrt.kolonnenID != nil {
                    Image("Konvoi_Trisar_Icons_01").resizable().scaledToFit().frame(width: 23, height: 18)
                }
            }
            .padding(.horizontal, 10)
            .frame(minWidth: 90)
            .frame(height: 29)
            .background(Farbe.lime)
            .fixedSize()
            .frame(width: 402, alignment: .center)
            .allowsHitTesting(false)

            // Ungelesen im Kolonnen-Chat: roter Kreis 28 auf der oberen rechten Kartenecke.
            if ungelesen > 0 {
                Text(ungelesen > 9 ? "9+" : "\(ungelesen)").font(.grotesk(18, .bold)).foregroundStyle(Color(hex: 0x1A1A1A))
                    .frame(width: 28, height: 28).background(Circle().fill(Color(hex: 0xFF6E63)))
                    .allowsHitTesting(false)
                    .platz(354, 0, 28, 28)
                    .offset(y: -12)
            }

            OrtIcon(name: orte.iconGrau(fahrt.abholOrtID)
                ?? Self.icon(fahrt.abholName + " " + fahrt.abholAdresse + " " + fahrt.abholKurz, start: true))
                .platz(53, 42, 70, 70)
            OrtIcon(name: orte.iconGrau(fahrt.zielOrtID)
                ?? Self.icon(fahrt.zielName + " " + fahrt.zielAdresse + " " + fahrt.zielKurz, start: false))
                .platz(276, 42, 70, 70)

            if zeigeEtd {
                Text("ETD").grotesk(10, .bold, abstand: -0.5)
                    .foregroundStyle(Farbe.grauText)
                    .mittig(201, iconMitte - 30, 40)
            }
            Text(fahrt.etd).grotesk(30, .bold, abstand: -0.5)
                .foregroundStyle(Color(hex: 0xE2F754))
                .mittig(201, iconMitte - 15, 100, 30, .center)
            if zeigePlan, let plan = fahrt.planEtd {
                Text("Plan \(plan)").grotesk(10, abstand: -0.5)
                    .foregroundStyle(Color(hex: 0xF4F5F4).opacity(0.5))
                    .mittig(201, iconMitte + 18, 64)
            }

            // Orte: links 40, rechts 39, Spalten 1fr | 29 | 1fr mit 18 Abstand.
            HStack(alignment: .center, spacing: 18) {
                Text(fahrt.abholKurz)
                    .grotesk(16, .bold, abstand: -0.5).foregroundStyle(.white)
                    .multilineTextAlignment(.leading)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
                Image("Arrow_Trisar_Icons_01_Lime").resizable().scaledToFit()
                    .frame(width: 29, height: 20).scaleEffect(1.15)
                Text(fahrt.zielKurz)
                    .grotesk(16, .bold, abstand: -0.5).foregroundStyle(.white)
                    .multilineTextAlignment(.trailing)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .trailing)
            }
            .fixedSize(horizontal: false, vertical: true)
            .allowsHitTesting(false)
            .platz(40, 127, 402 - 40 - 39, nil)

            if mitKnoepfen {
                AntwortKnoepfe(beschaeftigt: beschaeftigt, ablehnen: ablehnen, annehmen: annehmen)
                    .platz(20, h + 12)
            }
        }
        .frame(width: 402, height: mitKnoepfen ? h + 12 + 51 : h, alignment: .topLeading)
    }

    /// pickRideIcon der Web-App.
    static func icon(_ text: String, start: Bool) -> String {
        let t = text.lowercased()
        if t.contains("muc") || t.contains("flughafen") || t.contains("airport") || t.contains("terminal") {
            return start ? "Plain_Landen_Trisar_Icons_01_grau" : "Plain_Abflug_Trisar_Icons_01_grau"
        }
        if t.range(of: #"\b(hotel|resort|hostel|inn|motel|guesthouse|suite|aparthotel|residence)\b"#, options: .regularExpression) != nil {
            return "House_Nav_Trisar_01_grau"
        }
        return "Pin_Nav_Trisar_Icons_01_grau"
    }
}

private struct OrtIcon: View {
    let name: String
    var body: some View {
        Image(name).resizable().scaledToFit().frame(width: 30, height: 30)
            .frame(width: 70, height: 70)
            .background(Color(hex: 0x242525))
            .clipShape(RoundedRectangle(cornerRadius: 12))
            .allowsHitTesting(false)
    }
}
