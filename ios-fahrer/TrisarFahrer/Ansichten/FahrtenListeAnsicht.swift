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
    private let dienstAbstand: CGFloat = 12
    private let dienstListe: CGFloat = 48
    /// Angenommener Dienst (12.11.): wie im Verlauf je eine Zeile Dienststart (vor den Fahrten) und
    /// Dienstende (danach). Ist die Uhrzeit vorbei, verschwindet die Zeile (steht dann im Verlauf).
    private let dienstZeile: CGFloat = 48
    @State private var jetzt = Date()
    private let takt = Timer.publish(every: 30, on: .main, in: .common).autoconnect()

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

                ForEach(raster.dienste, id: \.schluessel) { eintrag in
                    if eintrag.art == "start" {
                        VerlaufRahmenZeile(text: "Dienststart \(String((eintrag.anfrage.service_start_time ?? "").prefix(5)))", farbe: Color(hex: 0xE3F654))
                            .platz(20, versatz + eintrag.oben, 362, dienstZeile)
                    } else if eintrag.art == "ende" {
                        VerlaufRahmenZeile(text: "Dienstende \(String((eintrag.anfrage.service_end_time ?? "").prefix(5)))", farbe: Color(hex: 0xFF6F63))
                            .platz(20, versatz + eintrag.oben, 362, dienstZeile)
                    } else if let z = eintrag.zeile {
                        // Pausenstart/-ende des angenommenen Dienstes, nach Uhrzeit zwischen den Fahrten.
                        VerlaufRahmenZeile(text: z.text, farbe: z.farbe)
                            .platz(20, versatz + eintrag.oben, 362, dienstZeile)
                    } else {
                    DienstKarte(anfrage: eintrag.anfrage, beschaeftigt: speicher.dienstArbeitetID == eintrag.anfrage.id) { annehmen in
                        Task { await speicher.dienstAntworten(eintrag.anfrage, annehmen: annehmen) }
                    }
                    .platz(20, versatz + eintrag.oben, 362, nil)
                    }
                }

                // Stunden am Ende des Diensttages
                ForEach(raster.stunden, id: \.eintrag.id) { s in
                    // Stundenerfassung wie im Verlauf (Figma 2823-12431), Bearbeiten als Vollbild.
                    HeuteStundenKarte(eintrag: s.eintrag, nachher: { Task { await stunden.laden() } }, vollbild: true)
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
        .onReceive(takt) { jetzt = $0 }
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
        var dienste: [(anfrage: DienstAnfrage, oben: CGFloat, art: String, schluessel: String, zeile: AnfrageZeile?)] = []
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
            // Angenommen und Dienstende vorbei: nur noch im Verlauf.
            if anfrage.angenommen && !zeigeStart(anfrage) && !zeigeEnde(anfrage) && offenePausen(anfrage).isEmpty { continue }
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
            let alle = anfragenProTag[tag] ?? []
            let anfragen = alle.filter { !$0.angenommen }
            for (i, anfrage) in anfragen.enumerated() {
                r.dienste.append((anfrage, cursor, "karte", anfrage.id.uuidString, nil))
                cursor += AnfrageZeile.kartenHoehe(AnfrageZeile.zeilen(anfrage)) + knopfAbstand + knopfHoehe
                if i < anfragen.count - 1 { cursor += dienstAbstand }
            }
            if !anfragen.isEmpty { cursor += dienstListe }
            for anfrage in alle where anfrage.angenommen && zeigeStart(anfrage) {
                r.dienste.append((anfrage, cursor, "start", anfrage.id.uuidString + "-start", nil))
                cursor += dienstZeile + kartenAbstand
            }
            // Pausen des angenommenen Dienstes warten, bis ihre Uhrzeit zwischen den Fahrten dran ist.
            var pausenWarte = alle.filter(\.angenommen)
                .flatMap { a in offenePausen(a).map { (a, $0) } }
                .sorted { $0.1.m < $1.1.m }
            func pausenBis(_ m: Double) {
                while let erste = pausenWarte.first, erste.1.m <= m {
                    pausenWarte.removeFirst()
                    r.dienste.append((erste.0, cursor, "pause", erste.0.id.uuidString + erste.1.schluessel, erste.1))
                    cursor += dienstZeile + kartenAbstand
                }
            }
            for fahrt in fahrtenProTag[tag] ?? [] {
                let fm = minuten(fahrt.etd)
                if fm != Int.max { pausenBis(Double(fm)) }
                let mitKnoepfen = fahrt.wartetAufAntwort
                r.fahrten.append((fahrt, cursor, mitKnoepfen))
                let h = AuftragsKarte.hoehe(fahrt)
                cursor += mitKnoepfen ? h + knopfAbstand + knopfHoehe + nachKnopf : h + kartenAbstand
            }
            pausenBis(.infinity)
            for anfrage in alle where anfrage.angenommen && zeigeEnde(anfrage) {
                r.dienste.append((anfrage, cursor, "ende", anfrage.id.uuidString + "-ende", nil))
                cursor += dienstZeile + kartenAbstand
            }
            for e in stundenProTag[tag] ?? [] {
                if !(fahrtenProTag[tag] ?? []).isEmpty { cursor += kartenAbstand }
                r.stunden.append((e, cursor))
                cursor += HeuteStundenKarte.hoehe(e) + kartenAbstand
            }
        }
        r.unterkante = cursor
        return r
    }

    private func dienstZeiten(_ a: DienstAnfrage) -> (start: Date?, ende: Date?) {
        let tag = String((a.service_date ?? "").prefix(10))
        let start = Stunden.zeitpunkt(tag, String((a.service_start_time ?? "").prefix(5)))
        let ende = Stunden.zeitpunkt(tag, String((a.service_end_time ?? "").prefix(5)), nach: start) // Nachtdienst
        return (start, ende)
    }
    private func zeigeStart(_ a: DienstAnfrage) -> Bool {
        guard !(a.service_start_time ?? "").isEmpty else { return false }
        return (dienstZeiten(a).start ?? .distantFuture) > jetzt
    }
    private func zeigeEnde(_ a: DienstAnfrage) -> Bool {
        guard !(a.service_end_time ?? "").isEmpty else { return false }
        return (dienstZeiten(a).ende ?? .distantFuture) > jetzt
    }

    /// Pausen-Zeilen eines angenommenen Dienstes, deren Uhrzeit noch nicht vorbei ist.
    private func offenePausen(_ a: DienstAnfrage) -> [AnfrageZeile] {
        let tag = String((a.service_date ?? "").prefix(10))
        return AnfrageZeile.pausenZeilen(a).filter { z in
            guard let t = Stunden.zeitpunkt(tag, z.zeit) else { return true }
            return t.addingTimeInterval(z.m >= 1440 ? 86_400 : 0) > jetzt
        }
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

/// Dienstplan-Anfrage: Dienststart (Lime), Pausen (Grau), Dienstende (Rot), einzeln oder zusammen.
/// Erste Zeile gross, weitere kleiner. Darunter Ablehnen/Annehmen solange offen.
private struct DienstKarte: View {
    let anfrage: DienstAnfrage
    let beschaeftigt: Bool
    let antworten: (Bool) -> Void

    var body: some View {
        let zeilen = AnfrageZeile.zeilen(anfrage)
        VStack(alignment: .leading, spacing: 12) {
            VStack(alignment: .leading, spacing: 20) {
                ForEach(Array(zeilen.enumerated()), id: \.offset) { i, z in
                    Text(z.text).grotesk(z.groesse(erste: i == 0), .bold).foregroundStyle(z.farbe)
                        .lineLimit(1).fixedSize()
                }
            }
            .padding(.horizontal, 12)
            .padding(.top, 19)
            .frame(width: 362, height: AnfrageZeile.kartenHoehe(zeilen), alignment: .topLeading)
            .background(Color(hex: 0x1A1A1A))
            .overlay(Rectangle().strokeBorder(anfrage.angenommen ? Farbe.lime : .clear, lineWidth: 2))

            if !anfrage.angenommen {
                AntwortKnoepfe(beschaeftigt: beschaeftigt, ablehnen: { antworten(false) }, annehmen: { antworten(true) })
            }
        }
    }
}

/// Eine Zeile der Dienstanfrage (wie shared/dienstAnfrage.js der Web-App).
/// Ganz neuer Dienst: alles. Geaenderter Dienst (vorher gesetzt): nur was sich geaendert hat, Pausen der
/// Reihe nach verglichen, weggefallene als "Pause 18:00–19:00 entfällt".
struct AnfrageZeile {
    enum Art { case start, ende, pauseStart, pauseEnde, pauseWeg }
    let art: Art
    let zeit: String
    var bis: String = ""
    /// Minuten ab Tagesbeginn (nach Mitternacht + 1440), fuer die Reihenfolge zwischen den Fahrten.
    var m: Double = 0
    var schluessel: String = ""

    var text: String {
        switch art {
        case .start: "Dienststart \(zeit)"
        case .ende: "Dienstende \(zeit)"
        case .pauseStart: "Pausenstart \(zeit)"
        case .pauseEnde: "Pausenende \(zeit)"
        case .pauseWeg: "Pause \(zeit)–\(bis) entfällt"
        }
    }
    var farbe: Color {
        switch art {
        case .start: Color(hex: 0xE3F654)
        case .ende: Color(hex: 0xFF6F63)
        default: Color(hex: 0x868687)
        }
    }
    /// Erste Zeile gross (Dienst 38, Pause 33, Pause entfaellt 26), weitere 24.
    func groesse(erste: Bool) -> CGFloat {
        guard erste else { return 24 }
        switch art {
        case .start, .ende: return 38
        case .pauseWeg: return 26
        default: return 33
        }
    }

    /// 2 Rand + 19 Luft + Zeilen (je 20 Abstand dazwischen) + 19 Luft + 2 Rand.
    static func kartenHoehe(_ zeilen: [AnfrageZeile]) -> CGFloat {
        guard !zeilen.isEmpty else { return 124 }
        return 42 + zeilen.enumerated().reduce(0) { n, e in n + e.element.groesse(erste: e.offset == 0) + (e.offset > 0 ? 20 : 0) }
    }

    private static func hm(_ s: String?) -> String { String((s ?? "").prefix(5)) }
    private static func minuten(_ s: String) -> Int? {
        let t = s.split(separator: ":").compactMap { Int($0) }
        return t.count >= 2 ? t[0] * 60 + t[1] : nil
    }
    private static func pausen(_ p: [Stunden.DienstPause]?) -> [(von: String, bis: String)] {
        (p ?? []).map { (hm($0.von), hm($0.bis)) }.filter { !$0.von.isEmpty && !$0.bis.isEmpty }
    }
    private static func sortierWert(_ zeit: String, _ beginn: Int?) -> Double {
        guard let m = minuten(zeit) else { return .infinity }
        if let b = beginn, m < b { return Double(m + 1440) }
        return Double(m)
    }

    static func zeilen(_ a: DienstAnfrage) -> [AnfrageZeile] {
        let start = hm(a.service_start_time), ende = hm(a.service_end_time)
        let jetzt = pausen(a.pausen)
        func ganz() -> [AnfrageZeile] {
            (start.isEmpty ? [] : [AnfrageZeile(art: .start, zeit: start)])
            + jetzt.flatMap { [AnfrageZeile(art: .pauseStart, zeit: $0.von), AnfrageZeile(art: .pauseEnde, zeit: $0.bis)] }
            + (ende.isEmpty ? [] : [AnfrageZeile(art: .ende, zeit: ende)])
        }
        var z: [AnfrageZeile]
        if let v = a.vorher {
            let alt = pausen(v.pausen)
            z = []
            if !start.isEmpty && start != hm(v.start) { z.append(AnfrageZeile(art: .start, zeit: start)) }
            for (i, p) in jetzt.enumerated() {
                let o = i < alt.count ? alt[i] : nil
                if o == nil || o!.von != p.von { z.append(AnfrageZeile(art: .pauseStart, zeit: p.von)) }
                if o == nil || o!.bis != p.bis { z.append(AnfrageZeile(art: .pauseEnde, zeit: p.bis)) }
            }
            for o in alt.dropFirst(jetzt.count) { z.append(AnfrageZeile(art: .pauseWeg, zeit: o.von, bis: o.bis)) }
            if !ende.isEmpty && ende != hm(v.ende) { z.append(AnfrageZeile(art: .ende, zeit: ende)) }
            if z.isEmpty { z = ganz() }
        } else {
            z = ganz()
        }
        let beginn = minuten(start.isEmpty ? hm(a.vorher?.start) : start)
        func rang(_ x: AnfrageZeile) -> Int {
            switch x.art { case .start: 0; case .pauseStart, .pauseWeg: 1; case .pauseEnde: 2; case .ende: 3 }
        }
        // Dienststart zuerst, Dienstende zuletzt, Pausen dazwischen nach Uhrzeit.
        func wert(_ x: AnfrageZeile) -> Double {
            switch x.art { case .start: -.infinity; case .ende: .infinity; default: sortierWert(x.zeit, beginn) }
        }
        return z.sorted { x, y in wert(x) != wert(y) ? wert(x) < wert(y) : rang(x) < rang(y) }
    }

    /// Angenommener Dienst: Pausenstart/-ende mit Minuten fuer die Reihenfolge zwischen den Fahrten.
    static func pausenZeilen(_ a: DienstAnfrage) -> [AnfrageZeile] {
        let beginn = minuten(hm(a.service_start_time))
        return pausen(a.pausen).enumerated().flatMap { i, p in
            [AnfrageZeile(art: .pauseStart, zeit: p.von, m: sortierWert(p.von, beginn), schluessel: "-ps\(i)"),
             AnfrageZeile(art: .pauseEnde, zeit: p.bis, m: sortierWert(p.bis, beginn) + 0.5, schluessel: "-pe\(i)")]
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
