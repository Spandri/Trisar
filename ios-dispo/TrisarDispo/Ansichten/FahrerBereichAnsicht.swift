import SwiftUI

/// Fahrer-Bereich der Dispo: Liste (AlleFahrer.jsx), von dort Anlegen/Bearbeiten
/// (FahrerErstellenView.jsx). Wie openDriverCreate/openDriverEditor in App.jsx.
struct FahrerBereichAnsicht: View {
    let zeigen: (DispoZiel) -> Void
    @StateObject private var liste = FahrerListeDienst()
    @State private var seite: Seite = .liste
    /// Markierte Fahrer bleiben ueber Anlegen/Bearbeiten erhalten (sessionStorage im Web).
    @State private var markiert: [String] = []

    enum Seite: Equatable {
        case liste, erstellen, bearbeiten(DispoFahrer)
    }

    var body: some View {
        Group {
            switch seite {
            case .liste:
                AlleFahrerAnsicht(liste: liste, markiert: $markiert, zeigen: zeigen,
                                  erstellen: { seite = .erstellen },
                                  bearbeiten: { seite = .bearbeiten($0) })
            case .erstellen:
                FahrerErstellenAnsicht(fahrer: nil) { zurueckZurListe() }
                    .id("neu")
            case let .bearbeiten(f):
                FahrerErstellenAnsicht(fahrer: f) { zurueckZurListe() }
                    .id(f.id)
            }
        }
        .task { await liste.starten() }
        .onDisappear { Task { await liste.stoppen() } }
    }

    private func zurueckZurListe() {
        seite = .liste
        Task { await liste.laden() }
    }
}

// MARK: - Alle Fahrer

/// Nachbau von AlleFahrer.jsx (Raster 402, LAYOUT_GRID). Der KI-Planer-Knopf fuehrt zur Planung,
/// "Dienste planen" ist im Web ausgeschaltet (DIENSTE_VON_HAND = false) und fehlt darum hier.
struct AlleFahrerAnsicht: View {
    @ObservedObject var liste: FahrerListeDienst
    @Binding var markiert: [String]
    let zeigen: (DispoZiel) -> Void
    let erstellen: () -> Void
    let bearbeiten: (DispoFahrer) -> Void

    @State private var suche = ""
    @FocusState private var sucheFokus: Bool
    @State private var statusFilter = "alle"
    @State private var startZeit = ""
    @State private var startDatum = Dienstzeit.heute()
    @State private var endZeit = ""
    @State private var endDatum = Dienstzeit.heute()
    @State private var chartStart = Planung.chartStart
    @State private var zeitWahl: ZeitWahl?

    private let kartenOben: CGFloat = 698
    private let kartenSchritt: CGFloat = 96

    var body: some View {
        let jetzt = Date()
        let gefiltert = gefilterteFahrer(jetzt: jetzt)
        let angebot = Planung.angebot(sichtbareFahrer)
        let fahrten = Planung.fahrten(liste.fahrten)
        let bedarf = Planung.bedarf(fahrten)
        let inhalt = max(1364, kartenOben + CGFloat(max(gefiltert.count, 1)) * kartenSchritt + 220)

        ZStack(alignment: .topLeading) {
            CSSRadial(rx: 1.4142, ry: 1.0221, stopps: [(0x0048CF, 0), (0x000000, 0.46), (0x000000, 1)])
                .ignoresSafeArea()
            Leinwand(basisHoehe: 874, inhaltHoehe: inhalt, mitHintergrund: false) { _ in
                ZStack(alignment: .topLeading) {
                    ZurueckKnopf { zeigen(.start) }.platz(20, 60, 50, 50)

                    Text("Alle Fahrer").grotesk(42, .bold)
                        .foregroundStyle(Color(hex: 0xE3F654))
                        .fixedSize()
                        .frame(height: 42)
                        .platz(20, 140)

                    PlanungsUebersicht(angebot: angebot, fahrten: fahrten, bedarf: bedarf, start: $chartStart) {
                        zeigen(.planung)
                    }
                    .platz(20, 206, 362, 198)

                    suchFeld.platz(20, 428, 362, 56)

                    Button(action: erstellen) {
                        HStack(spacing: 0) {
                            Text("Fahrer erstellen").grotesk(16, .medium, abstand: 0.4).foregroundStyle(Color(hex: 0x262626))
                            Spacer(minLength: 0)
                            Image("Arrow_Trisar_Icons_01").resizable().frame(width: 34, height: 21)
                        }
                        .padding(.horizontal, 12)
                        .frame(width: 362, height: 56)
                        .background(Color(hex: 0xE3F654))
                    }
                    .buttonStyle(.web)
                    .platz(20, 496, 362, 56)

                    ForEach(Array(Self.chips.enumerated()), id: \.offset) { i, chip in
                        StatusChipKnopf(text: chip.0, farbe: chip.2, gewaehlt: statusFilter == chip.1) {
                            statusFilter = statusFilter == chip.1 ? "alle" : chip.1
                        }
                        .platz(20 + CGFloat(i) * 125, 564, 112, 42)
                    }

                    ZeitFilterFeld(zeit: $startZeit, datum: $startDatum, platzhalter: "Start...") { zeitWahl = ZeitWahl(feld: .start, art: $0) }
                        .platz(20, 618, 175, 56)
                    ZeitFilterFeld(zeit: $endZeit, datum: $endDatum, platzhalter: "Ende...") { zeitWahl = ZeitWahl(feld: .ende, art: $0) }
                        .platz(207, 618, 175, 56)

                    karten(gefiltert, jetzt: jetzt)
                }
            }

            if !markiert.isEmpty {
                // Markierung loeschen: right 24, bottom 160.
                VStack {
                    Spacer()
                    HStack {
                        Spacer()
                        Button { markiert = [] } label: {
                            Text("X").grotesk(26, .bold).foregroundStyle(Color(hex: 0x1D1C1D))
                                .frame(width: 54, height: 54)
                                .background(Circle().fill(Color(hex: 0xE3F654)))
                        }
                        .buttonStyle(.web)
                        .accessibilityLabel("Markierung löschen")
                    }
                    .padding(.trailing, 24)
                }
                .padding(.bottom, 160)
                .ignoresSafeArea()
            }

            // Mit offener Tastatur blendet das Web die Leiste aus.
            if !sucheFokus {
                Navileiste(aktiv: .fahrer, waehlen: zeigen)
            }
        }
        .sheet(item: $zeitWahl) { w in
            ZeitWahlBlatt(wahl: w, wert: w.feld == .start
                          ? (w.art == .zeit ? startZeit : startDatum)
                          : (w.art == .zeit ? endZeit : endDatum)) { neu in uebernehmen(w, neu) }
        }
    }

    // MARK: Teile

    private static let chips: [(String, String, UInt32)] = [
        ("Im Dienst", "im_dienst", 0xFFFFFF), ("Frei", "frei", 0x59BE80), ("Unfertig", "unfertig", 0xFF6F63),
    ]

    private var suchFeld: some View {
        let aktiv = sucheFokus || !suche.trimmingCharacters(in: .whitespaces).isEmpty
        return HStack(spacing: 0) {
            Text(aktiv ? "Fahrer" : "Fahrer Suchen").grotesk(16, .medium, abstand: 0.4)
                .foregroundStyle(Color(hex: 0xFDE047).opacity(0.6))
                .fixedSize()
            TextField("", text: $suche)
                .focused($sucheFokus)
                .font(.grotesk(16, .medium)).tracking(0.4)
                .foregroundStyle(Color(hex: 0xFDE047).opacity(0.85))
                .tint(Color(hex: 0xFDE047))
                .autocorrectionDisabled()
                .textInputAutocapitalization(.never)
                .padding(.leading, 12).padding(.trailing, 36)
                .frame(maxHeight: .infinity)
        }
        .padding(.horizontal, 12)
        .frame(width: 362, height: 56)
        .overlay(alignment: .trailing) {
            Group {
                if !suche.trimmingCharacters(in: .whitespaces).isEmpty {
                    Button { suche = "" } label: {
                        Image("clear-field-green").resizable().frame(width: 20, height: 20).frame(width: 24, height: 24)
                    }
                    .buttonStyle(.web)
                    .accessibilityLabel("Fahrer-Suche zurücksetzen")
                } else {
                    Image("alle-fahrer-search").resizable().frame(width: 24, height: 24).allowsHitTesting(false)
                }
            }
            .padding(.trailing, 12)
        }
        .overlay(Rectangle().strokeBorder(Color(hex: 0xFDE047), lineWidth: 2))
        .clipped()
    }

    @ViewBuilder private func karten(_ gefiltert: [DispoFahrer], jetzt: Date) -> some View {
        if liste.laedt {
            Text("Fahrer werden geladen ...").grotesk(16, .medium).foregroundStyle(Color(hex: 0xE3F654))
                .platz(20, kartenOben, 362, nil)
        } else if !liste.fehler.isEmpty {
            WebText(text: liste.fehler, groesse: 13, gewicht: .medium, zeilenHoehe: 13 * 1.4, farbe: UIColor(Color(hex: 0xFF8E8E)))
                .padding(16)
                .background(Color(hex: 0x171717))
                .overlay(Rectangle().strokeBorder(Color(hex: 0x3A3A3A), lineWidth: 1))
                .platz(20, kartenOben, 362, nil)
        } else if gefiltert.isEmpty {
            Text("Keine Fahrer für diesen Filter gefunden.").grotesk(16, .medium).foregroundStyle(Color(hex: 0xE3F654))
                .padding(.horizontal, 12)
                .frame(width: 362, height: 84, alignment: .leading)
                .background(Color(hex: 0x0E0E0E))
                .overlay(Rectangle().strokeBorder(Color(hex: 0x2A2A2A), lineWidth: 1))
                .platz(20, kartenOben, 362, 84)
        } else {
            ForEach(Array(gefiltert.enumerated()), id: \.element.id) { i, f in
                FahrerKarte(
                    fahrer: f, imDienst: f.imDienst(jetzt: jetzt), markiert: markiert.contains(f.id),
                    antippen: {
                        if !markiert.isEmpty { umschalten(f.id) } else { bearbeiten(f) }
                    },
                    markieren: { umschalten(f.id) },
                    bearbeiten: { bearbeiten(f) }
                )
                .platz(20, kartenOben + CGFloat(i) * kartenSchritt, 362, 84)
            }
        }
    }

    // MARK: Logik (wie AlleFahrer.jsx)

    private func umschalten(_ id: String) {
        guard !id.isEmpty else { return }
        if let i = markiert.firstIndex(of: id) { markiert.remove(at: i) } else { markiert.append(id) }
    }

    /// Ohne Dispo-Rollen, sortiert nach Nachname, Vorname.
    private var sichtbareFahrer: [DispoFahrer] {
        liste.fahrer
            .filter { !["dispo", "dispatcher", "admin", "koordinator", "coordinator", "pruefung"].contains(($0.role ?? "").trimmingCharacters(in: .whitespaces).lowercased()) }
            .sorted {
                let n = $0.lastName.compare($1.lastName, options: [.caseInsensitive, .diacriticInsensitive], locale: Locale(identifier: "de"))
                if n != .orderedSame { return n == .orderedAscending }
                return $0.firstName.compare($1.firstName, options: [.caseInsensitive, .diacriticInsensitive], locale: Locale(identifier: "de")) == .orderedAscending
            }
    }

    private func gefilterteFahrer(jetzt: Date) -> [DispoFahrer] {
        let basis = sichtbareFahrer
        // Suche: mehrere Begriffe mit ';', reine Zahl mit ';' = genaue Fahrernummer.
        let teile = suche.components(separatedBy: ";")
        let endetMitStrich = suche.replacingOccurrences(of: "\\s+$", with: "", options: .regularExpression).hasSuffix(";")
        let begriffe: [(String, Bool)] = teile.enumerated().compactMap { i, roh in
            let t = roh.trimmingCharacters(in: .whitespaces).lowercased()
            guard !t.isEmpty else { return nil }
            let abgeschlossen = i < teile.count - 1 || endetMitStrich
            return (t, t.allSatisfy(\.isNumber) && abgeschlossen)
        }
        func wert(_ f: DispoFahrer, _ b: (String, Bool)) -> Int {
            let name = f.name.lowercased(), fz = f.vehicle.lowercased(), nr = f.driverNumber.map(String.init) ?? ""
            let t = b.0
            if b.1 { return nr == t ? 1000 : -1 }
            if name == t { return 920 }
            if name.hasPrefix(t) { return 860 }
            if nr == t { return 820 }
            if nr.hasPrefix(t) { return 780 }
            if name.contains(t) { return 730 }
            if nr.contains(t) { return 700 }
            if fz.hasPrefix(t) { return 640 }
            if fz.contains(t) { return 600 }
            return -1
        }
        let nachSuche: [DispoFahrer] = begriffe.isEmpty ? basis : basis.enumerated().compactMap { i, f -> (DispoFahrer, Int, Int)? in
            let w = begriffe.map { wert(f, $0) }.filter { $0 >= 0 }
            guard let beste = w.max() else { return nil }
            return (f, i, beste + (w.count - 1) * 10)
        }
        .sorted { $0.2 != $1.2 ? $0.2 > $1.2 : $0.1 < $1.1 }
        .map(\.0)

        let nachStatus = nachSuche.filter { f in
            switch statusFilter {
            case "im_dienst": return f.imDienst(jetzt: jetzt)
            case "frei": return !f.imDienst(jetzt: jetzt) && !f.unfertig
            case "unfertig": return f.unfertig
            default: return true
            }
        }

        // Absolutes Zeitfenster aus Datum + Uhrzeit (Minuten seit heute 00:00), auch ueber Mitternacht.
        guard !startZeit.isEmpty || !endZeit.isEmpty else { return nachStatus }
        return nachStatus.filter { f in
            guard let s = Dienstzeit.minuten(f.serviceStartTime), let e = Dienstzeit.minuten(f.serviceEndTime) else { return false }
            let startTag = Dienstzeit.tagAbstand(startDatum) ?? 0
            let endTag = Dienstzeit.tagAbstand(endDatum) ?? startTag
            let schichtStart = startTag * 1440 + s
            let schichtEnde = schichtStart + (e >= s ? e - s : 1440 - s + e)
            if let fs = Dienstzeit.minuten(startZeit), schichtStart < startTag * 1440 + fs { return false }
            if let fe = Dienstzeit.minuten(endZeit), schichtEnde > endTag * 1440 + fe { return false }
            return true
        }
    }

    private func uebernehmen(_ w: ZeitWahl, _ neu: String) {
        switch (w.feld, w.art) {
        case (.start, .zeit):
            startZeit = neu
            if !neu.isEmpty && startDatum.isEmpty { startDatum = Dienstzeit.heute() }
        case (.start, .datum): startDatum = neu
        case (.ende, .zeit):
            endZeit = neu
            if !neu.isEmpty && endDatum.isEmpty { endDatum = Dienstzeit.heute() }
        case (.ende, .datum): endDatum = neu
        }
    }
}

// MARK: - Planungsuebersicht (PlanningOverviewChart)

/// 362 x 198: Balken Fahrer, Linie Fahrten, gestrichelt Bedarf. 18-Stunden-Fenster aus 72 h,
/// stundenweise per Wischen verschiebbar.
struct PlanungsUebersicht: View {
    let angebot: [Int]
    let fahrten: [Int]
    let bedarf: [Int]
    @Binding var start: Int
    let kiPlaner: () -> Void
    @State private var zugStart: Int?

    private let breite: CGFloat = 362, hoehe: CGFloat = 198
    private let links: CGFloat = 36, oben: CGFloat = 52, unten: CGFloat = 34
    private var plotBreite: CGFloat { breite - links }
    private var plotHoehe: CGFloat { hoehe - oben - unten }
    private var fenster: Int { Planung.fensterLaenge }
    private var maxStart: Int { max(0, angebot.count - fenster) }
    private var anfang: Int { max(0, min(maxStart, start)) }

    var body: some View {
        let stunden = (0..<fenster).map { anfang + $0 }
        let a = stunden.map { $0 < angebot.count ? angebot[$0] : 0 }
        let f = stunden.map { $0 < fahrten.count ? fahrten[$0] : 0 }
        let b = stunden.map { $0 < bedarf.count ? bedarf[$0] : 0 }
        let maxWert = max(1, (a + f + b).max() ?? 0)

        ZStack(alignment: .topLeading) {
            Text("Planungsübersicht").grotesk(16, .semibold, abstand: 0.2).foregroundStyle(.white)
                .fixedSize().platz(0, 10)
            Text(datumsZeile(stunden)).grotesk(11, .medium, abstand: 0.2).foregroundStyle(.white.opacity(0.7))
                .fixedSize().platz(0, 30)

            Canvas { k, _ in zeichnen(k, stunden: stunden, a: a, f: f, b: b, maxWert: maxWert) }
                .frame(width: breite, height: hoehe)
                .allowsHitTesting(false)

            // Wischflaeche ueber dem Plot.
            Color.clear.contentShape(Rectangle())
                .simultaneousGesture(DragGesture(minimumDistance: 8)
                    .onChanged { w in
                        if zugStart == nil { zugStart = anfang }
                        let schritt = plotBreite / CGFloat(fenster)
                        let neu = max(0, min(maxStart, (zugStart ?? anfang) + Int((-w.translation.width / schritt).rounded())))
                        if neu != anfang { start = neu }
                    }
                    .onEnded { _ in zugStart = nil })
                .platz(links, oben, plotBreite, plotHoehe + unten)

            HStack(spacing: 10) {
                Button(action: kiPlaner) {
                    Image("KI_Trisar_Icons_01_Lime").resizable().scaledToFit().frame(width: 13, height: 13)
                        .frame(width: 28, height: 26)
                }
                .buttonStyle(.web)
                .accessibilityLabel("KI Planer öffnen")
                legende("Fahrer", farbe: 0x45A8B6) {
                    RoundedRectangle(cornerRadius: 2).fill(Color(hex: 0x45A8B6)).frame(width: 10, height: 10)
                }
                legende("Fahrten", farbe: 0x59BE80) {
                    Rectangle().fill(Color(hex: 0x59BE80)).frame(width: 12, height: 2)
                }
                legende("Bedarf", farbe: 0xE3F654) {
                    Path { p in p.move(to: CGPoint(x: 0, y: 1)); p.addLine(to: CGPoint(x: 12, y: 1)) }
                        .stroke(Color(hex: 0xE3F654), style: StrokeStyle(lineWidth: 2, dash: [2, 2]))
                        .frame(width: 12, height: 2)
                }
            }
            .platz(0, 10, breite, 26, .trailing)
        }
        .frame(width: breite, height: hoehe, alignment: .topLeading)
    }

    private func legende<Zeichen: View>(_ text: String, farbe: UInt32, @ViewBuilder zeichen: () -> Zeichen) -> some View {
        HStack(spacing: 4) {
            zeichen()
            Text(text).grotesk(11, .medium).foregroundStyle(Color(hex: farbe))
        }
        .fixedSize()
    }

    /// "Mi., 04.11. – Do., 05.11. · zum Blättern wischen"
    private func datumsZeile(_ stunden: [Int]) -> String {
        let df = DateFormatter()
        df.locale = Locale(identifier: "de_DE")
        df.dateFormat = "EEE, dd.MM."
        func tag(_ h: Int) -> String { df.string(from: Date().addingTimeInterval(Double(h / 24) * 86400)) }
        let a = tag(stunden.first ?? 0), e = tag(stunden.last ?? 0)
        return a == e ? "\(a) · zum Blättern wischen" : "\(a) – \(e) · zum Blättern wischen"
    }

    private func zeichnen(_ k: GraphicsContext, stunden: [Int], a: [Int], f: [Int], b: [Int], maxWert: Int) {
        let schritt = plotBreite / CGFloat(fenster)
        let balken = max(8, schritt * 0.82)
        let grund = oben + plotHoehe
        func y(_ v: Int) -> CGFloat { oben + (plotHoehe - CGFloat(max(0, v)) / CGFloat(maxWert) * plotHoehe) }
        func mitte(_ i: Int) -> CGFloat { links + CGFloat(i) * schritt + schritt / 2 }

        var achsen = Path()
        achsen.move(to: CGPoint(x: links, y: oben)); achsen.addLine(to: CGPoint(x: links, y: grund))
        achsen.addLine(to: CGPoint(x: breite, y: grund))
        k.stroke(achsen, with: .color(Color(hex: 0x6A6A6A)), lineWidth: 1)

        for wert in [maxWert, max(0, Int((Double(maxWert) / 2).rounded())), 0] {
            let yy = y(wert)
            var strich = Path()
            strich.move(to: CGPoint(x: links - 4, y: yy)); strich.addLine(to: CGPoint(x: links, y: yy))
            k.stroke(strich, with: .color(Color(hex: 0x9A9A9A)), lineWidth: 1)
            k.draw(Text("\(wert)").font(.grotesk(11, .semibold)).foregroundColor(Color(hex: 0xB7B7B7)),
                   at: CGPoint(x: links - 8, y: yy), anchor: .trailing)
        }

        for i in 0..<fenster {
            let v = max(0, a[i])
            let yy = y(v)
            let h = max(0, grund - yy)
            guard h > 0 else { continue }
            let rect = CGRect(x: links + CGFloat(i) * schritt + (schritt - balken) / 2, y: yy, width: balken, height: h)
            k.fill(Path(roundedRect: rect, cornerRadius: min(3, h / 2)), with: .color(Color(hex: 0x45A8B6).opacity(0.95)))
        }

        var linie = Path(), bedarfLinie = Path()
        for i in 0..<fenster {
            let p1 = CGPoint(x: mitte(i), y: y(f[i])), p2 = CGPoint(x: mitte(i), y: y(b[i]))
            if i == 0 { linie.move(to: p1); bedarfLinie.move(to: p2) } else { linie.addLine(to: p1); bedarfLinie.addLine(to: p2) }
        }
        k.stroke(linie, with: .color(Color(hex: 0x59BE80)), style: StrokeStyle(lineWidth: 3, lineCap: .round, lineJoin: .round))
        k.stroke(bedarfLinie, with: .color(Color(hex: 0xE3F654)),
                 style: StrokeStyle(lineWidth: 2, lineCap: .round, lineJoin: .round, dash: [6, 4]))

        for (i, abs) in stunden.enumerated() where abs % 3 == 0 {
            let stunde = abs % 24
            let mitternacht = stunde == 0
            let text = mitternacht
                ? Dienstzeit.tagMonat(Dienstzeit.plusTage(Dienstzeit.heute(), abs / 24))
                : String(format: "%02d Uhr", stunde)
            k.draw(Text(text).font(.grotesk(11, .semibold)).foregroundColor(Color(hex: mitternacht ? 0xE3F654 : 0xB7B7B7)),
                   at: CGPoint(x: mitte(i), y: hoehe - 12), anchor: .center)
        }
    }
}

// MARK: - Karte, Chip, Zeitfeld

/// DriverCard: 362 x 84, nach rechts wischen markiert, nach links wischen bearbeitet.
struct FahrerKarte: View {
    let fahrer: DispoFahrer
    let imDienst: Bool
    let markiert: Bool
    let antippen: () -> Void
    let markieren: () -> Void
    let bearbeiten: () -> Void

    @State private var versatz: CGFloat = 0
    @State private var zugStart: CGFloat?
    @State private var waagrecht: Bool?

    private let aktionsBreite: CGFloat = 90, oeffnen: CGFloat = 36, ausloesen: CGFloat = 124, maxVersatz: CGFloat = 160

    var body: some View {
        let links = max(0, versatz), rechts = max(0, -versatz)
        ZStack(alignment: .topLeading) {
            aktion(icon: "Faecher_Done", iconX: links / 2 - 17,
                   text: markiert ? "\(fahrer.name) demarkieren" : "\(fahrer.name) markieren") { schliessen(); markieren() }
                .platz(0, 0, maxVersatz, 84)
            aktion(icon: "Edit_Trisar_Icon_01", iconX: maxVersatz - rechts / 2 - 17, text: "Fahrer bearbeiten") { schliessen(); bearbeiten() }
                .platz(362 - maxVersatz, 0, maxVersatz, 84)

            // Verschieben ueber Abstand statt .offset, damit die Tipp-Flaeche mitwandert.
            karte
                .padding(.leading, links).padding(.trailing, rechts)
                .frame(width: 362, height: 84, alignment: versatz >= 0 ? .leading : .trailing)
        }
        .frame(width: 362, height: 84)
        .clipped()
    }

    private var karte: some View {
        let hinten: UInt32 = fahrer.unfertig ? 0xFF6F63 : (imDienst ? 0xFFFFFF : 0x59BE80)
        let zeitFarbe = Color(hex: Dienstzeit.anfrageFarbe(fahrer.planRequestStatus))
        let fahrzeug = fahrer.vehicle.trimmingCharacters(in: .whitespaces)
        return ZStack(alignment: .topLeading) {
            Color(hex: hinten)
            VStack(alignment: .leading, spacing: 0) {
                Text(fahrer.name).font(.grotesk(30, .bold))
                    .foregroundStyle(Color(hex: 0x18181B))
                    .lineLimit(1).minimumScaleFactor(8 / 30)
                    .frame(width: 250, alignment: .leading)
                Text(fahrzeug.isEmpty ? "Kein Fahrzeug zugewiesen" : fahrzeug)
                    .grotesk(14, .medium, abstand: 0.35)
                    .foregroundStyle(Color(hex: 0x18181B).opacity(0.8))
                    .lineLimit(1).truncationMode(.tail)
                    .frame(width: 250, height: 16, alignment: .leading)
            }
            .platz(18, 12, 250, 60, .leading)

            Text("#\(fahrer.driverNumber.map(String.init) ?? "-")").grotesk(18, .medium, abstand: -0.45)
                .foregroundStyle(Color(hex: 0x171717))
                .fixedSize().frame(height: 20)
                .platz(0, 12, 362 - 18, 20, .topTrailing)

            VStack(alignment: .trailing, spacing: 2) {
                Text(fahrer.serviceStartTime.isEmpty ? "--:--" : fahrer.serviceStartTime)
                    .grotesk(15, .semibold, abstand: 0.2).frame(height: 15)
                Text("- \(fahrer.serviceEndTime.isEmpty ? "--:--" : fahrer.serviceEndTime)")
                    .grotesk(15, .semibold, abstand: 0.2).frame(height: 15)
            }
            .foregroundStyle(zeitFarbe)
            .fixedSize()
            .platz(0, 84 - 10 - 32, 362 - 14, 32, .topTrailing)
        }
        .frame(width: 362, height: 84)
        .overlay(Rectangle().strokeBorder(markiert ? Color(hex: 0xE3F654) : .clear, lineWidth: 2))
        .contentShape(Rectangle())
        .onTapGesture {
            if versatz != 0 { schliessen(); return }
            antippen()
        }
        .simultaneousGesture(
            DragGesture(minimumDistance: 14)
                .onChanged { w in
                    if waagrecht == nil {
                        waagrecht = abs(w.translation.width) >= abs(w.translation.height)
                        zugStart = versatz
                    }
                    guard waagrecht == true else { return }
                    versatz = max(-maxVersatz, min(maxVersatz, (zugStart ?? 0) + w.translation.width))
                }
                .onEnded { _ in
                    defer { waagrecht = nil; zugStart = nil }
                    guard waagrecht == true else { return }
                    if versatz >= ausloesen { schliessen(); markieren() }
                    else if versatz <= -ausloesen { schliessen(); bearbeiten() }
                    else if versatz > oeffnen { withAnimation(.easeOut(duration: 0.22)) { versatz = aktionsBreite } }
                    else if versatz < -oeffnen { withAnimation(.easeOut(duration: 0.22)) { versatz = -aktionsBreite } }
                    else { schliessen() }
                }
        )
    }

    private func aktion(icon: String, iconX: CGFloat, text: String, tun: @escaping () -> Void) -> some View {
        Button(action: tun) {
            ZStack(alignment: .topLeading) {
                Color(hex: 0xE3F654)
                Image(icon).resizable().scaledToFit().frame(width: 34, height: 34).platz(iconX, 25, 34, 34)
            }
            .frame(width: maxVersatz, height: 84, alignment: .topLeading)
            .clipped()
        }
        .buttonStyle(.web)
        .accessibilityLabel(text)
    }

    private func schliessen() {
        withAnimation(.easeOut(duration: 0.22)) { versatz = 0 }
    }
}

/// StatusChip: 112 x 42, Rand in Chip-Farbe, gewaehlt gefuellt.
struct StatusChipKnopf: View {
    let text: String
    let farbe: UInt32
    let gewaehlt: Bool
    let aktion: () -> Void
    var body: some View {
        Button(action: aktion) {
            Text(text).grotesk(16, .medium, abstand: 0.4)
                .foregroundStyle(gewaehlt ? Color(hex: 0x171717) : Color(hex: farbe))
                .frame(width: 112, height: 42)
                .background(gewaehlt ? Color(hex: farbe) : .clear)
                .overlay(Rectangle().strokeBorder(Color(hex: farbe), lineWidth: 2))
        }
        .buttonStyle(.web)
    }
}

struct ZeitWahl: Identifiable {
    enum Feld { case start, ende }
    enum Art { case zeit, datum }
    let feld: Feld
    let art: Art
    var id: String { "\(feld)-\(art)" }
}

/// TimeField: Uhrzeit + Datum (tt.mm.) in einem 56er-Kasten, X setzt beides zurueck.
struct ZeitFilterFeld: View {
    @Binding var zeit: String
    @Binding var datum: String
    let platzhalter: String
    let waehlen: (ZeitWahl.Art) -> Void

    private let gelb = Color(hex: 0xFDE047)

    var body: some View {
        let belegt = !zeit.isEmpty || !datum.isEmpty
        ZStack(alignment: .topLeading) {
            if !belegt {
                Button { waehlen(.zeit) } label: {
                    HStack(spacing: 8) {
                        Text(platzhalter).grotesk(16, .medium, abstand: 0.4).foregroundStyle(gelb)
                        Spacer(minLength: 0)
                        Image("Uhr_Trisar_Icon_01_Lime").resizable().frame(width: 20, height: 20)
                    }
                    .padding(.horizontal, 12)
                    .frame(width: 175, height: 56)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.web)
            } else {
                HStack(spacing: 0) {
                    Text(zeit.isEmpty ? "--:--" : zeit).grotesk(18, .semibold, abstand: 0.45).foregroundStyle(gelb)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    Text(datum.isEmpty ? "tt.mm." : Dienstzeit.tagMonat(datum)).grotesk(12, .medium, abstand: 0.3)
                        .foregroundStyle(gelb.opacity(0.85))
                        .frame(width: 44, alignment: .trailing)
                        .padding(.leading, 6)
                        .frame(height: 12)
                        .overlay(alignment: .leading) { Rectangle().fill(gelb.opacity(0.4)).frame(width: 1) }
                }
                .padding(.leading, 12).padding(.trailing, 12 + 40)
                .frame(width: 175, height: 56)
                .allowsHitTesting(false)

                // Tipp-Flaechen wie die unsichtbaren input-Felder im Web.
                Color.clear.contentShape(Rectangle()).onTapGesture { waehlen(.zeit) }.platz(0, 0, 73, 56)
                Color.clear.contentShape(Rectangle()).onTapGesture { waehlen(.datum) }.platz(75, 0, 50, 56)

                Button { zeit = ""; datum = "" } label: {
                    Text("X").grotesk(38, .bold).foregroundStyle(Color(hex: 0xE3F654)).frame(width: 36, height: 36)
                }
                .buttonStyle(.web)
                .accessibilityLabel("\(platzhalter) zurücksetzen")
                .platz(175 - 4 - 36, 10, 36, 36)
            }
        }
        .frame(width: 175, height: 56)
        .overlay(Rectangle().strokeBorder(gelb, lineWidth: 2))
        .clipped()
    }
}

/// Ersatz fuer den nativen Zeit-/Datums-Picker des Browsers.
struct ZeitWahlBlatt: View {
    let wahl: ZeitWahl
    let wert: String
    let fertig: (String) -> Void
    @Environment(\.dismiss) private var schliessen
    @State private var auswahl = Date()

    var body: some View {
        VStack(spacing: 12) {
            HStack {
                Button("Abbrechen") { schliessen() }
                Spacer()
                Button("Fertig") {
                    if wahl.art == .zeit {
                        let k = Calendar.current.dateComponents([.hour, .minute], from: auswahl)
                        fertig(String(format: "%02d:%02d", k.hour ?? 0, k.minute ?? 0))
                    } else {
                        fertig(Datum.tagWert(auswahl))
                    }
                    schliessen()
                }
                .fontWeight(.semibold)
            }
            .font(.grotesk(16, .medium))
            .tint(Color(hex: 0xE3F654))
            .padding(.horizontal, 20).padding(.top, 16)
            if wahl.art == .zeit {
                DatePicker("", selection: $auswahl, displayedComponents: .hourAndMinute)
                    .datePickerStyle(.wheel).labelsHidden()
            } else {
                DatePicker("", selection: $auswahl, displayedComponents: .date)
                    .datePickerStyle(.graphical).labelsHidden().tint(Color(hex: 0xE3F654))
                    .padding(.horizontal, 12)
            }
            Spacer(minLength: 0)
        }
        .environment(\.locale, Locale(identifier: "de_DE"))
        .presentationDetents([wahl.art == .zeit ? .height(300) : .height(460)])
        .presentationBackground(Color(hex: 0x111217))
        .preferredColorScheme(.dark)
        .onAppear {
            if wahl.art == .zeit, let m = Dienstzeit.minuten(wert) {
                auswahl = Calendar.current.date(bySettingHour: m / 60, minute: m % 60, second: 0, of: Date()) ?? Date()
            } else if wahl.art == .datum, !wert.isEmpty {
                auswahl = Datum.ausTagWert(wert)
            }
        }
    }
}
