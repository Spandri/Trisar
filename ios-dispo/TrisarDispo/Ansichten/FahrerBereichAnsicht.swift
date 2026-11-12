import SwiftUI

/// Fahrer-Bereich der Dispo: Liste (AlleFahrer.jsx), von dort Anlegen/Bearbeiten
/// (FahrerErstellenView.jsx). Wie openDriverCreate/openDriverEditor in App.jsx.
struct FahrerBereichAnsicht: View {
    let zeigen: (DispoZiel) -> Void
    /// Fahrt aus dem Ablauf der Fahrer-Ansicht oeffnen (Editor liegt in DispoHaupt).
    var oeffneFahrt: (UUID) -> Void = { _ in }
    @StateObject private var liste = FahrerListeDienst()
    @State private var seite: Seite = .liste
    /// Markierte Fahrer bleiben ueber Anlegen/Bearbeiten erhalten (sessionStorage im Web).
    /// Auf der Karte markierte Fahrer sind hier schon ausgewaehlt (Mehrfachauswahl).
    @State private var markiert: [String] = FahrerMarkierung.geteilt.wirkt ? FahrerMarkierung.geteilt.ids : []

    enum Seite: Equatable {
        case liste, erstellen, bearbeiten(DispoFahrer), ansicht(DispoFahrer)
    }

    var body: some View {
        // Liste bleibt immer aufgebaut (nur ausgeblendet), damit sie beim Zurueckkommen an derselben
        // Stelle steht statt wieder oben (12.11.). Die anderen Seiten liegen darueber.
        ZStack {
            AlleFahrerAnsicht(liste: liste, markiert: $markiert, zeigen: zeigen,
                              erstellen: { seite = .erstellen },
                              bearbeiten: { seite = .bearbeiten($0) },
                              oeffnen: { seite = .ansicht($0) })
                .opacity(seite == .liste ? 1 : 0)
                .allowsHitTesting(seite == .liste)
                .accessibilityHidden(seite != .liste)
            switch seite {
            case .liste:
                EmptyView()
            case .erstellen:
                FahrerErstellenAnsicht(fahrer: nil, oeffneFahrzeug: fahrzeugOeffnen) { zurueckZurListe() }
                    .id("neu")
            case let .ansicht(f):
                // Tipp auf einen Fahrer: Stunden, Ablauf, Dienste (wie FahrerAnsichtView.jsx).
                FahrerAnsichtDispo(fahrer: f, zurueck: { zurueckZurListe() }, bearbeiten: { seite = .bearbeiten(f) }, oeffneFahrt: oeffneFahrt,
                                   oeffneFahrzeug: fahrzeugOeffnen)
                    .id("ansicht-\(f.id)")
            case let .bearbeiten(f):
                FahrerErstellenAnsicht(fahrer: f, oeffneFahrzeug: fahrzeugOeffnen) { zurueckZurListe() }
                    .id(f.id)
            }
        }
        .task { await liste.starten() }
        // Sprung aus „Fahrzeug bearbeiten“: diesen Fahrer direkt in der Fahrer-Ansicht oeffnen.
        .onChange(of: liste.fahrer.map(\.id) + [liste.laedt ? "laedt" : ""], initial: true) { _, _ in
            guard let ziel = FahrerSprung.id else { return }
            guard let f = liste.fahrer.first(where: { $0.id.lowercased() == ziel.lowercased() }) else {
                // Fertig geladen und nicht dabei: Sprung verwerfen, sonst greift er beim naechsten Mal.
                if !liste.laedt { FahrerSprung.id = nil }
                return
            }
            FahrerSprung.id = nil
            seite = .ansicht(f)
        }
        .onDisappear { Task { await liste.stoppen() } }
        // Ist die Mehrfachauswahl der Karte an, gilt eine Aenderung hier auch dort
        // (und damit fuer Fahrzeuge, Fahrten, Fahrt anlegen und KI-Assistent).
        .onChange(of: markiert) { _, ids in
            let m = FahrerMarkierung.geteilt
            guard m.aktiv else { return }
            m.ersetzen(ids.map { id in
                let alt = m.fahrer.first { $0.id == id }
                let name = liste.fahrer.first { $0.id == id }?.name ?? ""
                return FahrerMarkierung.Eintrag(id: id, name: name.isEmpty ? (alt?.name ?? "") : name, vehicleId: alt?.vehicleId ?? "")
            })
        }
    }

    /// Fahrzeug-Bereich mit genau diesem Fahrzeug in „Fahrzeug bearbeiten“ (wie eine Push mit vehicle_id).
    private func fahrzeugOeffnen(_ id: String) {
        guard !id.isEmpty else { return }
        FahrzeugSprung.id = id
        zeigen(.fahrzeuge)
    }

    private func zurueckZurListe() {
        seite = .liste
        Task { await liste.laden() }
    }
}

/// Fahrer, der beim naechsten Oeffnen des Fahrer-Bereichs direkt in der Fahrer-Ansicht erscheinen soll
/// (Sprung aus „Fahrzeug bearbeiten“, wie FahrzeugSprung fuer Fahrzeuge).
@MainActor enum FahrerSprung { static var id: String? }

// MARK: - Alle Fahrer

/// Nachbau von AlleFahrer.jsx (Raster 402, LAYOUT_GRID). Der KI-Planer-Knopf fuehrt zur Planung,
/// Mit markierten Fahrern: "Dienste planen" schickt Dienststart, Dienstende und Pausen (wie DienstePlanenBlatt.jsx).
struct AlleFahrerAnsicht: View {
    @ObservedObject var liste: FahrerListeDienst
    @Binding var markiert: [String]
    @State private var flaggenFehler = ""
    let zeigen: (DispoZiel) -> Void
    let erstellen: () -> Void
    let bearbeiten: (DispoFahrer) -> Void
    var oeffnen: ((DispoFahrer) -> Void)? = nil

    @State private var suche = ""
    @FocusState private var sucheFokus: Bool
    @State private var statusFilter = "alle"
    @State private var startZeit = ""
    @State private var startDatum = Dienstzeit.heute()
    @State private var endZeit = ""
    @State private var endDatum = Dienstzeit.heute()
    @State private var chartStart = Planung.chartStart
    @State private var zeitWahl: ZeitWahl?
    @State private var planenOffen = false
    /// Stunden aller oder ausgewaehlter Fahrer als Excel (Knopf oben rechts).
    @State private var exportOffen = false

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
                    HStack { Spacer(); ExportKnopf { exportOffen = true } }.platz(20, 60, 362, 50)

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
                // Flaggen: eine Reihe ueber der Leiste, setzen die Flagge bei allen Markierten.
                VStack(alignment: .trailing, spacing: 6) {
                    Spacer()
                    if !flaggenFehler.isEmpty {
                        Text(flaggenFehler).grotesk(12, .medium).foregroundStyle(Color(hex: 0xFF8E8E))
                            .padding(.horizontal, 12).padding(.vertical, 8)
                            .frame(maxWidth: 362, alignment: .leading)
                            .background(Color(hex: 0x171717))
                    }
                    FlaggenKnoepfe(ids: markiert,
                                   flaggeVon: { id in liste.fahrer.first { $0.id == id }?.flagge },
                                   wahl: flaggeWaehlen,
                                   waagerecht: true)
                        .padding(.trailing, 36)
                }
                .padding(.bottom, 226)
                .frame(maxWidth: .infinity, alignment: .trailing)
                .ignoresSafeArea()

                // Markierung loeschen: right 24, bottom 160.
                VStack {
                    Spacer()
                    HStack {
                        Spacer()
                        Button { planenOffen = true } label: {
                            Text("Dienste planen").grotesk(16, .medium, abstand: 0.4).foregroundStyle(Color(hex: 0xE3F654))
                                .padding(.horizontal, 20).frame(height: 54)
                                .background(Color.black)
                                .overlay(Rectangle().strokeBorder(Color(hex: 0xE3F654), lineWidth: 2))
                        }
                        .buttonStyle(.web)
                        Button { markiert = [] } label: {
                            // Rot mit dem TRISAR-Schliessen-Icon, Rand schwarz wie der Auswahlknopf der Karte.
                            Image("Schliessen_Trisar_Icons_01").resizable().frame(width: 22, height: 22)
                                .frame(width: 54, height: 54)
                                .background(Circle().fill(Color(hex: 0xFF6F63)))
                                .overlay(Circle().strokeBorder(.black, lineWidth: 2))
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
        .sheet(isPresented: $exportOffen) { StundenExportFenster { exportOffen = false } }
        .sheet(isPresented: $planenOffen) {
            DienstePlanenBlatt(fahrerIDs: markiert) { planenOffen = false; Task { await liste.laden() } }
                .presentationDetents([.large])
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
        // Wie im Web ist die ganze Box das Eingabefeld, auch das Wort davor.
        .contentShape(Rectangle())
        .onTapGesture { sucheFokus = true }
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
                        if !markiert.isEmpty { umschalten(f.id) } else { (oeffnen ?? bearbeiten)(f) }
                    },
                    markieren: { umschalten(f.id) },
                    bearbeiten: { bearbeiten(f) }
                )
                .platz(20, kartenOben + CGFloat(i) * kartenSchritt, 362, 84)
            }
        }
    }

    // MARK: Logik (wie AlleFahrer.jsx)

    /// Flagge bei allen Markierten setzen (nil = entfernen), danach die Liste neu laden.
    private func flaggeWaehlen(_ flagge: String?) {
        let ids = markiert
        guard !ids.isEmpty else { return }
        flaggenFehler = ""
        Task {
            if let fehler = await Flaggen.setzen(ids: ids, flagge: flagge) {
                flaggenFehler = fehler
            } else {
                await liste.laden()
            }
        }
    }

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
                .waagerechtWischen(geaendert: { dx in
                    if zugStart == nil { zugStart = anfang }
                    let schritt = plotBreite / CGFloat(fenster)
                    let neu = max(0, min(maxStart, (zugStart ?? anfang) + Int((-dx / schritt).rounded())))
                    if neu != anfang { start = neu }
                }, beendet: { _ in zugStart = nil })
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

    private let aktionsBreite: CGFloat = 90, oeffnen: CGFloat = 36, ausloesen: CGFloat = 124, maxVersatz: CGFloat = 160

    var body: some View {
        let links = max(0, versatz), rechts = max(0, -versatz)
        ZStack(alignment: .topLeading) {
            aktion(icon: "Faecher_Done", iconX: links / 2 - 17,
                   text: markiert ? "\(fahrer.name) demarkieren" : "\(fahrer.name) markieren") { schliessen(); markieren() }
                .platz(0, 0, maxVersatz, 84)
            aktion(icon: "Edit_Trisar_Icon_01", iconX: maxVersatz - rechts / 2 - 17, text: "Fahrer bearbeiten") { schliessen(); bearbeiten() }
                .platz(362 - maxVersatz, 0, maxVersatz, 84)

            // Verschieben per .offset (nur Grafik, kein neues Layout je Bildpunkt). Die Tipp-Flaeche
            // wandert mit, weil offset auch das Antippen verschiebt.
            karte
                .offset(x: versatz)
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

            // Flagge: haengt oben links buendig an der Kante der Karte, wie eine Lasche.
            if let flagge = fahrer.flagge {
                FlaggeMitRand(flagge: flagge).platz(5.2, -0.8, 15.6, 19.6)
            }
        }
        .frame(width: 362, height: 84)
        .overlay(Rectangle().strokeBorder(markiert ? Color(hex: 0xE3F654) : .clear, lineWidth: 2))
        .contentShape(Rectangle())
        .onTapGesture {
            if versatz != 0 { schliessen(); return }
            antippen()
        }
        // UIKit-Geste wie bei den Fahrtenkarten: startet nur bei waagerechter Bewegung, sonst scrollt
        // die Liste ungestoert (die SwiftUI-DragGesture lief gleichzeitig mit dem Scrollen und bremste es).
        .waagerechtWischen(geaendert: { dx in
            if zugStart == nil { zugStart = versatz }
            versatz = max(-maxVersatz, min(maxVersatz, (zugStart ?? 0) + dx))
        }, beendet: { _ in
            zugStart = nil
            if versatz >= ausloesen { schliessen(); markieren() }
            else if versatz <= -ausloesen { schliessen(); bearbeiten() }
            else if versatz > oeffnen { withAnimation(.snappy(duration: 0.22)) { versatz = aktionsBreite } }
            else if versatz < -oeffnen { withAnimation(.snappy(duration: 0.22)) { versatz = -aktionsBreite } }
            else { schliessen() }
        })
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
        withAnimation(.snappy(duration: 0.22)) { versatz = 0 }
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


// MARK: - Dienste planen

/// "Dienste planen" fuer die markierten Fahrer (DienstePlanenBlatt.jsx, Senden wie applyBulkPlanning in AlleFahrer.jsx).
/// Gestaltung wie die Stundenerfassung der Fahrer-App (Figma 2838:12842): dunkle Karte mit gruenem Rand,
/// vier Kacheln Start | Pause | Pause | Ende, darunter die Dauer gross in Lime, unten Rot (Abbrechen) und Gruen (Senden).
/// Dienststart und Dienstende sind unabhaengig: was leer bleibt, wird nicht gesendet.
/// Eine Kachel antippen oeffnet das Drehrad wie in der Stundenerfassung (15-Minuten-Schritte).
/// Legt je Fahrer eine Dienstanfrage an (driver_service_requests, pending) und speichert die Pausen in dienst_pausen.
struct DienstePlanenBlatt: View {
    let fahrerIDs: [String]
    /// Fahrer bearbeiten: Tag, Zeiten und Pausen eines vorhandenen Dienstes vorbelegen
    /// (tag nil = neuer Dienst, Tag im Kalender waehlen).
    var vorgabe: DienstVorgabe? = nil
    let fertig: () -> Void

    private static let lime = Color(hex: 0xE3F654)
    private static let gruen = Color(hex: 0x59BE80)
    private static let rot = Color(hex: 0xFF6F63)
    private static let kachelFarbe = Color(hex: 0x242525)
    private static let grau = Color(hex: 0x5F5F5F)
    private static let schritt = 15
    private static let vorlagen: [(name: String, start: String, ende: String)] = [
        ("Früh", "06:00", "14:00"), ("Tag", "08:00", "16:00"), ("Spät", "14:00", "22:00"), ("Nacht", "22:00", "06:00"),
    ]

    struct Pause: Equatable { var von: String; var bis: String }
    struct DienstVorgabe { var tag: String?; var start = ""; var ende = ""; var pausen: [Pause] = [] }
    /// Welche Zeit gerade im Drehrad eingestellt wird.
    enum Feld: Equatable { case start, ende, pause(Int, bis: Bool) }

    /// Gewaehlte Tage (Kalender wie bei Fahrt anlegen), sortiert, mindestens einer.
    @State private var tage: [String] = [Dienstzeit.heute()]
    @State private var kalenderOffen = false
    @State private var start = ""
    @State private var ende = ""
    @State private var pausen: [Pause] = []
    @State private var feld: Feld?
    /// Drehrad fuer das gewaehlte Feld offen.
    @State private var radOffen = false
    @State private var speichert = false
    @State private var fehler: String?
    /// Vorhandener Dienst bei genau einem Fahrer und einem Tag (vorausgefuellt, gesendet wird nur Geaendertes).
    @State private var bestand: Bestand?
    @State private var hatteBestand = false

    struct Bestand {
        var id: String
        var start: String
        var ende: String
        var pausen: [Pause]
        var angenommen: Bool
        var vorher: (start: String, ende: String, pausen: [Pause])?
    }
    enum Zustand { case neu, bestaetigt, angefragt }

    private var schluessel: String {
        fahrerIDs.count == 1 && tage.count == 1 ? "\(fahrerIDs[0])|\(tage[0])" : ""
    }

    private struct DienstZeile: Decodable { let id: String; let service_start_time: String?; let service_end_time: String?; let status: String? }
    private struct PauseJSON: Decodable { let von: String?; let bis: String? }
    private struct PausenJSON: Decodable { let pausen: [PauseJSON]? }
    private struct VorherJSON: Decodable { let start: String?; let ende: String?; let pausen: [PauseJSON]? }
    private struct AenderungJSON: Decodable { let vorher: VorherJSON? }

    private static func hm(_ x: String?) -> String { String((x ?? "").prefix(5)) }
    private static func pausenAus(_ l: [PauseJSON]?) -> [Pause] {
        (l ?? []).map { Pause(von: hm($0.von), bis: hm($0.bis)) }.filter { !$0.von.isEmpty && !$0.bis.isEmpty }
    }

    /// Letzte nicht abgelehnte Dienstzeile des Tages mit Pausen und gemerktem angenommenem Stand.
    private static func bestandLaden(fahrer: String, tag: String) async -> Bestand? {
        let c = Backend.client
        let zeilen: [DienstZeile] = (try? await c.from("driver_service_requests")
            .select("id, service_start_time, service_end_time, status")
            .eq("driver_id", value: fahrer).eq("service_date", value: tag)
            .order("created_at", ascending: false).limit(5).execute().value) ?? []
        guard let d = zeilen.first(where: { ($0.status ?? "").lowercased() != "refused" }) else { return nil }
        let p: [PausenJSON] = (try? await c.from("dienst_pausen").select("pausen").eq("dienst_id", value: d.id).execute().value) ?? []
        let a: [AenderungJSON] = (try? await c.from("dienst_aenderung").select("vorher").eq("dienst_id", value: d.id).execute().value) ?? []
        let v = a.first?.vorher
        return Bestand(
            id: d.id, start: hm(d.service_start_time), ende: hm(d.service_end_time),
            pausen: pausenAus(p.first?.pausen),
            angenommen: (d.status ?? "").lowercased() == "accepted",
            vorher: v.map { (hm($0.start), hm($0.ende), pausenAus($0.pausen)) })
    }

    private static func gleichePausen(_ a: [Pause], _ b: [Pause]) -> Bool {
        a.filter { !$0.von.isEmpty && !$0.bis.isEmpty } == b.filter { !$0.von.isEmpty && !$0.bis.isEmpty }
    }

    /// Zustand eines vorausgefuellten Feldes wie im Web (feldZustand).
    private func zustand(_ welches: String) -> Zustand? {
        guard let b = bestand else { return nil }
        let gleich: Bool, leer: Bool, wieVorher: Bool
        switch welches {
        case "start": gleich = start == b.start; leer = start.isEmpty; wieVorher = b.vorher?.start == start
        case "ende": gleich = ende == b.ende; leer = ende.isEmpty; wieVorher = b.vorher?.ende == ende
        default:
            gleich = Self.gleichePausen(pausen, b.pausen); leer = pausen.isEmpty
            wieVorher = b.vorher.map { Self.gleichePausen($0.pausen, pausen) } ?? false
        }
        if !gleich { return .neu }
        if leer { return nil }
        if b.angenommen { return .bestaetigt }
        if b.vorher != nil { return wieVorher ? .bestaetigt : .angefragt }
        return .angefragt
    }

    private var unveraendert: Bool {
        bestand != nil && zustand("start") != .neu && zustand("ende") != .neu && zustand("pausen") != .neu
    }

    private func zustandZeile(_ z: Zustand?) -> some View {
        let (text, farbe): (String, Color) = {
            switch z {
            case .neu: return ("Neu", Self.lime)
            case .bestaetigt: return ("Bestätigt", Self.gruen)
            case .angefragt: return ("Angefragt", Color(hex: 0xFFCD8A))
            case nil: return ("", .clear)
            }
        }()
        return Text(text).grotesk(11, .bold).foregroundStyle(farbe).frame(height: 13)
    }

    /// × bei vorausgefuellten Feldern: zurueck auf den gesendeten Stand, Gesendetes selbst bleibt.
    private func zurueck(istStart: Bool) -> (() -> Void)? {
        let gesendet = istStart ? (bestand?.start ?? "") : (bestand?.ende ?? "")
        if gesendet.isEmpty { return { if istStart { start = "" } else { ende = "" }; feld = nil } }
        guard zustand(istStart ? "start" : "ende") == .neu else { return nil }
        return { if istStart { start = gesendet } else { ende = gesendet }; feld = nil }
    }

    private static func isoText(_ d: Date) -> String {
        let p = DateFormatter(); p.locale = Locale(identifier: "en_US_POSIX"); p.dateFormat = "yyyy-MM-dd"
        return p.string(from: d)
    }

    /// "Heute 11.11.", "Morgen 12.11.", sonst "Mi 13.11." (tagText im Web).
    private static func tagText(_ iso: String) -> String {
        let p = DateFormatter(); p.locale = Locale(identifier: "en_US_POSIX"); p.dateFormat = "yyyy-MM-dd"
        guard let d = p.date(from: iso) else { return iso }
        let f = DateFormatter(); f.locale = Locale(identifier: "de_DE"); f.dateFormat = "dd.MM."
        let datum = f.string(from: d)
        let kal = Calendar.current
        if kal.isDateInToday(d) { return "Heute \(datum)" }
        if kal.isDateInTomorrow(d) { return "Morgen \(datum)" }
        let w = DateFormatter(); w.locale = Locale(identifier: "de_DE"); w.dateFormat = "EE"
        return "\(w.string(from: d).replacingOccurrences(of: ".", with: "")) \(datum)"
    }

    /// Kalender: gewaehlter Tag kommt dazu (ohne Doppelte, sortiert).
    private var kalenderBindung: Binding<Date> {
        Binding(get: { Date() }, set: { neu in
            let iso = Self.isoText(neu)
            if !tage.contains(iso) { tage = (tage + [iso]).sorted() }
            kalenderOffen = false
        })
    }

    // MARK: Zeitrechnung

    private static func minuten(_ hhmm: String) -> Int? {
        let t = hhmm.split(separator: ":").compactMap { Int($0) }
        return t.count == 2 ? t[0] * 60 + t[1] : nil
    }

    private static func uhr(_ min: Int) -> String {
        let x = ((min % 1440) + 1440) % 1440
        return String(format: "%02d:%02d", x / 60, x % 60)
    }

    /// Spanne ueber Mitternacht gerechnet (Nachtdienst 22–06 = 8 h).
    private static func spanne(_ von: String, _ bis: String) -> Int {
        guard let a = minuten(von), let b = minuten(bis) else { return 0 }
        let d = ((b - a) + 1440) % 1440
        return d == 0 ? 1440 : d
    }

    /// Netto-Dienstzeit als HH:MM wie in der Stundenerfassung (Pausen abgezogen).
    private var nettoText: String {
        let pause = pausen.reduce(0) { $0 + Self.spanne($1.von, $1.bis) }
        let netto = max(0, Self.spanne(start, ende) - pause)
        return String(format: "%02d:%02d", netto / 60, netto % 60)
    }

    private var feldWert: String {
        switch feld {
        case .start: return start
        case .ende: return ende
        case let .pause(i, bis): return pausen.indices.contains(i) ? (bis ? pausen[i].bis : pausen[i].von) : ""
        case nil: return ""
        }
    }

    private var feldName: String {
        switch feld {
        case .start: return "Dienststart"
        case .ende: return "Dienstende"
        case let .pause(i, bis): return "Pause \(i + 1) \(bis ? "bis" : "von")"
        case nil: return ""
        }
    }

    private func feldSetzen(_ wert: String) {
        switch feld {
        case .start: start = wert
        case .ende: ende = wert
        case let .pause(i, bis):
            guard pausen.indices.contains(i) else { return }
            if bis { pausen[i].bis = wert } else { pausen[i].von = wert }
        case nil: break
        }
    }

    /// "HH:MM" als Zeitpunkt heute (Berlin) fuer das Drehrad und zurueck.
    private var feldDatum: Date {
        guard let m = Self.minuten(feldWert) else { return Date() }
        var k = Calendar(identifier: .gregorian); k.timeZone = Stunden.berlin
        let tag = k.startOfDay(for: Date())
        return tag.addingTimeInterval(Double(m) * 60)
    }

    /// Feld weglassen: Start oder Ende wird nicht gesendet, eine Pause faellt weg.
    private func feldEntfernen() {
        switch feld {
        case .start: start = ""
        case .ende: ende = ""
        case let .pause(i, _): if pausen.indices.contains(i) { pausen.remove(at: i) }
        case nil: break
        }
        feld = nil
    }

    /// Leere Kachel: sinnvolle Zeit vorschlagen (Ende 8 h nach Start, sonst 16:00) und auswaehlen.
    private func zeitTippen(istStart: Bool) {
        if istStart && start.isEmpty {
            start = Self.minuten(ende).map { Self.uhr($0 - 8 * 60) } ?? "08:00"
        } else if !istStart && ende.isEmpty {
            ende = Self.minuten(start).map { Self.uhr($0 + 8 * 60) } ?? "16:00"
        }
        feld = istStart ? .start : .ende
        radOffen = true
    }

    /// Neue Pause in der Mitte des Dienstes, 30 Minuten.
    private func pauseNeu(_ index: Int) {
        let mitte: Double
        if let a = Self.minuten(start), !ende.isEmpty { mitte = Double(a) + Double(Self.spanne(start, ende)) / 2 } else { mitte = 12 * 60 }
        let von = Int((mitte / Double(Self.schritt)).rounded()) * Self.schritt + index * 60
        pausen.append(Pause(von: Self.uhr(von), bis: Self.uhr(von + 30)))
        feld = .pause(pausen.count - 1, bis: false)
        radOffen = true
    }

    // MARK: Ansicht

    var body: some View {
        let lime = Self.lime
        // Senden geht auch nur mit einer Pause (Dienst des Tages bleibt, der Fahrer bestaetigt nur die Pause).
        let nurPause = start.isEmpty && ende.isEmpty && !pausen.isEmpty
        let nichtsGesetzt = start.isEmpty && ende.isEmpty && !nurPause
        ScrollView(.vertical, showsIndicators: false) {
            VStack(spacing: 0) {
                VStack(spacing: 0) {
                    Text("Dienste planen").grotesk(18, .bold, abstand: -0.5).foregroundStyle(lime)
                    Text(fahrerIDs.isEmpty ? "Noch keine Fahrer ausgewählt" : "\(fahrerIDs.count) Fahrer ausgewählt")
                        .grotesk(12, .medium).foregroundStyle(.white.opacity(0.6))
                        .padding(.top, 2)

                    // Tage: Kalender wie bei Fahrt anlegen, beliebig viele Tage. Antippen entfernt einen Tag.
                    TagUmbruch(abstand: 8) {
                        ForEach(tage, id: \.self) { iso in
                            Button { if tage.count > 1 { tage.removeAll { $0 == iso } } } label: {
                                HStack(spacing: 8) {
                                    Text(Self.tagText(iso)).grotesk(15, .bold).foregroundStyle(lime).lineLimit(1)
                                    if tage.count > 1 {
                                        Text("×").grotesk(18).foregroundStyle(.white.opacity(0.6))
                                    }
                                }
                                .padding(.leading, 12).padding(.trailing, 10)
                                .frame(height: 48)
                                .background(kachelGrund(aktiv: true))
                            }
                            .buttonStyle(.web)
                            .accessibilityLabel(tage.count > 1 ? "\(Self.tagText(iso)) entfernen" : Self.tagText(iso))
                        }
                        Button { kalenderOffen.toggle() } label: {
                            Text(kalenderOffen ? "Kalender zu" : "+ Tag").grotesk(15, .bold).foregroundStyle(kalenderOffen ? Self.lime : .white)
                                .padding(.horizontal, 14)
                                .frame(height: 48)
                                .background(kachelGrund(aktiv: false))
                        }
                        .buttonStyle(.web)
                        .accessibilityLabel("Tag im Kalender wählen")
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.top, 12)

                    // Monatskalender: auch Vergangenheit, Tage mit Dienst der ausgewaehlten Fahrer mit Punkt.
                    if kalenderOffen {
                        DienstKalender(gewaehlt: tage, fahrerIDs: fahrerIDs) { iso in
                            if tage.contains(iso) { if tage.count > 1 { tage.removeAll { $0 == iso } } }
                            else { tage = (tage + [iso]).sorted() }
                        }
                        .padding(.top, 10)
                    }

                    // Start | Pause | Pause | Ende
                    HStack(alignment: .top, spacing: 6) {
                        spalte("Start", an: !start.isEmpty, zustand: zustand("start")) { zeitKachel(start, aktiv: feld == .start, entfernen: zurueck(istStart: true)) { zeitTippen(istStart: true) } }
                        ForEach(0..<2, id: \.self) { i in
                            spalte("Pause", an: false, zustand: pausen.indices.contains(i) ? zustand("pausen") : nil) {
                                if pausen.indices.contains(i) || i == pausen.count {
                                    pausenKachel(i)
                                } else {
                                    RoundedRectangle(cornerRadius: 12).fill(Self.kachelFarbe).opacity(0.5).frame(height: 69)
                                }
                            }
                        }
                        spalte("Ende", an: !ende.isEmpty, zustand: zustand("ende")) { zeitKachel(ende, aktiv: feld == .ende, entfernen: zurueck(istStart: false)) { zeitTippen(istStart: false) } }
                    }
                    .padding(.top, 14)

                    // Dauer gross, wie die Arbeitszeit in der Stundenerfassung
                    VStack(spacing: 0) {
                        if !start.isEmpty && !ende.isEmpty {
                            Text(nettoText).grotesk(35, .bold, abstand: -0.5).foregroundStyle(lime).monospacedDigit()
                                .frame(height: 44)
                            if let a = Self.minuten(start), let b = Self.minuten(ende), b <= a {
                                Text("endet am Folgetag").grotesk(12, .medium).foregroundStyle(.white.opacity(0.6))
                            }
                        } else {
                            Text(nichtsGesetzt ? "Start oder Ende antippen" : nurPause ? "Nur Pause" : (start.isEmpty ? "Nur Dienstende" : "Nur Dienststart"))
                                .grotesk(18, .bold, abstand: -0.5)
                                .foregroundStyle(nichtsGesetzt ? Self.grau : lime)
                                .frame(height: 44)
                        }
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.top, 10)
                }
                .padding(.horizontal, 17).padding(.top, 14).padding(.bottom, 16)
                .background(Color(hex: 0x1A1A1A))
                .overlay(Rectangle().strokeBorder(Self.gruen, lineWidth: 2))

                // Vorlagen
                HStack(spacing: 6) {
                    ForEach(Self.vorlagen, id: \.name) { v in
                        let aktiv = start == v.start && ende == v.ende
                        Button { start = v.start; ende = v.ende; feld = .start } label: {
                            VStack(spacing: 0) {
                                Text(v.name).grotesk(14, .bold).frame(height: 17)
                                Text("\(v.start.prefix(2))–\(v.ende.prefix(2))").grotesk(11).monospacedDigit().opacity(0.7).frame(height: 14)
                            }
                            .foregroundStyle(aktiv ? lime : .white)
                            .frame(maxWidth: .infinity).frame(height: 48)
                            .background(kachelGrund(aktiv: aktiv))
                        }
                        .buttonStyle(.web)
                    }
                }
                .padding(.top, 10)

                if unveraendert {
                    Text("Schon gesendet. Zeit antippen zum Ändern.").grotesk(13, .medium).foregroundStyle(.white.opacity(0.6))
                        .frame(maxWidth: .infinity).padding(.top, 8)
                }

                if let fehler {
                    Text(fehler).grotesk(13, .medium).foregroundStyle(Color(hex: 0xFF8E8E))
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.top, 8)
                }

                HStack(spacing: 9) {
                    Button(action: fertig) { knopfInhalt("Abbrechen", farbe: Self.rot) }
                        .buttonStyle(.web)
                    Button { Task { await senden() } } label: {
                        knopfInhalt(speichert ? "Speichern ..." : "Senden (\(fahrerIDs.count))", farbe: Self.gruen)
                    }
                    .buttonStyle(.web)
                    .disabled(speichert || nichtsGesetzt || unveraendert || fahrerIDs.isEmpty)
                    .opacity(speichert || nichtsGesetzt || unveraendert || fahrerIDs.isEmpty ? 0.5 : 1)
                }
                .padding(.top, 12)
            }
            .padding(.horizontal, 20).padding(.top, 20).padding(.bottom, 22)
        }
        .background(Color.black.ignoresSafeArea())
        // Drehrad wie in der Stundenerfassung: Stunden und Minuten in 15-Minuten-Schritten.
        .sheet(isPresented: $radOffen) {
            VStack(spacing: 0) {
                HStack {
                    Text(feldName).grotesk(15, .bold).foregroundStyle(.white.opacity(0.6))
                    Spacer()
                    Button("Fertig") { radOffen = false }.font(.grotesk(17, .bold)).foregroundStyle(Self.lime)
                }
                .padding(.horizontal, 20).frame(height: 48)
                ZeitRad(wert: feldDatum, setzen: { feldSetzen(Stunden.uhr($0)) }).frame(height: 216)
                Spacer(minLength: 0)
            }
            .background(Color(hex: 0x1C1C1E).ignoresSafeArea())
            .presentationDetents([.height(300)])
        }
        .onAppear {
            guard let v = vorgabe else { return }
            tage = v.tag.map { [$0] } ?? []
            start = v.start
            ende = v.ende
            pausen = v.pausen
            feld = v.start.isEmpty ? nil : .start
        }
        // Genau ein Fahrer und ein Tag: vorhandenen Dienst laden und die Kacheln damit fuellen.
        .task(id: schluessel) {
            var b: Bestand?
            if !schluessel.isEmpty, let tag = tage.first, let f = fahrerIDs.first {
                b = await Self.bestandLaden(fahrer: f, tag: tag)
            }
            guard !Task.isCancelled else { return }
            bestand = b
            if let b {
                start = b.start; ende = b.ende; pausen = b.pausen
            } else if hatteBestand {
                start = ""; ende = ""; pausen = []
            }
            hatteBestand = b != nil
            feld = nil
        }
    }

    private var feldIstPause: Bool {
        if case .pause = feld { return true }
        return false
    }

    private func kachelGrund(aktiv: Bool) -> some View {
        RoundedRectangle(cornerRadius: 12).fill(Self.kachelFarbe)
            .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(aktiv ? Self.lime : .clear, lineWidth: 2))
    }

    private func spalte<K: View>(_ titel: String, an: Bool, zustand: Zustand? = nil, @ViewBuilder kachel: () -> K) -> some View {
        VStack(spacing: 6) {
            kachel()
            VStack(spacing: 0) {
                Text(titel).grotesk(16, .bold, abstand: -0.5).foregroundStyle(an ? .white : Self.grau)
                if bestand != nil { zustandZeile(zustand) }
            }
        }
        .frame(maxWidth: .infinity)
    }

    /// Kleines rotes × oben rechts wie in der Stundenerfassung: setzt die Kachel zurueck.
    private func entfernenKnopf(_ titel: String, _ aktion: @escaping () -> Void) -> some View {
        Button(action: aktion) {
            Text("×").grotesk(16, .bold).foregroundStyle(.black).frame(width: 24, height: 24).background(Circle().fill(Self.rot))
        }
        .buttonStyle(.web).offset(x: 8, y: -8).accessibilityLabel(titel)
    }

    /// Kachel fuer Start oder Ende: eine Zeit gross in Lime, leer grau. Gesetzt mit × zum Zuruecksetzen.
    private func zeitKachel(_ wert: String, aktiv: Bool, entfernen: (() -> Void)?, tippen: @escaping () -> Void) -> some View {
        Button(action: tippen) {
            Text(wert.isEmpty ? "--:--" : wert).grotesk(22, .bold, abstand: -0.5).monospacedDigit()
                .lineLimit(1).minimumScaleFactor(0.7)
                .foregroundStyle(wert.isEmpty ? Self.grau : Self.lime)
                .frame(maxWidth: .infinity).frame(height: 69)
                .background(kachelGrund(aktiv: aktiv))
        }
        .buttonStyle(.web)
        .overlay(alignment: .topTrailing) { if !wert.isEmpty, let entfernen { entfernenKnopf("Zeit zurücksetzen", entfernen) } }
    }

    /// Kachel fuer eine Pause: von oben, bis unten, grau. Leer ein Plus.
    @ViewBuilder private func pausenKachel(_ i: Int) -> some View {
        if pausen.indices.contains(i) {
            let p = pausen[i]
            let aktiv: Bool = { if case let .pause(j, _) = feld { return j == i }; return false }()
            VStack(spacing: 0) {
                ForEach([false, true], id: \.self) { bis in
                    Button { feld = .pause(i, bis: bis); radOffen = true } label: {
                        Text(bis ? p.bis : p.von).grotesk(17, .bold, abstand: -0.5).monospacedDigit()
                            .lineLimit(1).minimumScaleFactor(0.7)
                            .foregroundStyle(feld == .pause(i, bis: bis) ? Self.lime : Self.grau)
                            .frame(maxWidth: .infinity).frame(height: 22)
                    }
                    .buttonStyle(.web)
                }
            }
            .frame(maxWidth: .infinity).frame(height: 69)
            .background(kachelGrund(aktiv: aktiv))
            .overlay(alignment: .topTrailing) {
                entfernenKnopf("Pause entfernen") { if pausen.indices.contains(i) { pausen.remove(at: i) }; feld = nil }
            }
        } else {
            // Wie in der Stundenerfassung: gestrichelter Rahmen mit Plus.
            Button { pauseNeu(i) } label: {
                Text("+").grotesk(28, .bold).foregroundStyle(Self.lime)
                    .frame(maxWidth: .infinity).frame(height: 69)
                    .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Self.lime, style: StrokeStyle(lineWidth: 2, dash: [5, 4])))
            }
            .buttonStyle(.web)
            .accessibilityLabel("Pause hinzufügen")
        }
    }

    /// Text links, Pfeil rechts (Pfeil_Knopf_Figma zeigt nach links, daher gedreht).
    private func knopfInhalt(_ text: String, farbe: Color) -> some View {
        HStack(spacing: 0) {
            Text(text).grotesk(16, .medium, abstand: 0.5).foregroundStyle(Color(hex: 0x202020)).lineLimit(1)
            Spacer(minLength: 4)
            Image("Pfeil_Knopf_Figma").resizable().frame(width: 34, height: 19).rotationEffect(.degrees(180))
        }
        .padding(.horizontal, 16)
        .frame(maxWidth: .infinity).frame(height: 56)
        .background(farbe)
    }

    // MARK: Senden (applyBulkPlanning)

    /// Nicht gesetzte Zeiten gehen als null mit, damit nur das Gesetzte gilt.
    private struct Anfrage: Encodable {
        let driver_id: String
        let service_date: String
        let start: String?
        let ende: String?
        let requested_by = "dispo-ios"

        enum CodingKeys: String, CodingKey { case driver_id, service_date, service_start_time, service_end_time, status, requested_by }

        func encode(to encoder: Encoder) throws {
            var c = encoder.container(keyedBy: CodingKeys.self)
            try c.encode(driver_id, forKey: .driver_id)
            try c.encode(service_date, forKey: .service_date)
            if let start { try c.encode(start, forKey: .service_start_time) } else { try c.encodeNil(forKey: .service_start_time) }
            if let ende { try c.encode(ende, forKey: .service_end_time) } else { try c.encodeNil(forKey: .service_end_time) }
            try c.encode("pending", forKey: .status)
            try c.encode(requested_by, forKey: .requested_by)
        }
    }
    private struct NeueID: Decodable { let id: String }
    private struct PausePlan: Encodable { let art = "fest"; let von: String; let bis: String }
    private struct PausenZeile: Encodable { let dienst_id: String; let pausen: [PausePlan]; let aktualisiert: String }

    private func senden() async {
        guard !fahrerIDs.isEmpty else { fehler = "Bitte mindestens einen Fahrer auswählen."; return }
        guard !start.isEmpty || !ende.isEmpty || !pausen.isEmpty else { return }
        speichert = true; fehler = nil
        defer { speichert = false }
        let c = Backend.client
        // Vorausgefuellter Dienst: nur Geaendertes senden (fehlende Zeiten uebernimmt der DB-Trigger).
        let b = fahrerIDs.count == 1 && tage.count == 1 ? bestand : nil
        let s = start.isEmpty || start == b?.start ? nil : start
        let e = ende.isEmpty || ende == b?.ende ? nil : ende
        let pausenGeaendert = b.map { !Self.gleichePausen(pausen, $0.pausen) } ?? true
        let pausenWeg = b != nil && pausenGeaendert && pausen.isEmpty && !(b?.pausen.isEmpty ?? true)
        if b != nil && s == nil && e == nil && !pausenGeaendert { fehler = "Keine Änderung zum Senden."; return }
        if let b, pausenWeg, s == nil, e == nil {
            // Nur alle Pausen entfernt: direkt am Dienst loeschen, der Fahrer bestaetigt das.
            do { try await c.from("dienst_pausen").delete().eq("dienst_id", value: b.id).execute() }
            catch { fehler = "Pausen nicht entfernt: \(error.localizedDescription)"; return }
            fertig()
            return
        }
        // Eine Anfrage je Fahrer und gewaehltem Tag, das Profil bekommt den fruehesten Tag.
        let gewaehlt = Array(Set(tage)).sorted()
        guard !gewaehlt.isEmpty else { fehler = "Bitte einen Tag im Kalender wählen."; return }
        let tag = gewaehlt.first ?? Dienstzeit.heute()
        do {
            let neu: [NeueID] = try await c.from("driver_service_requests")
                .insert(gewaehlt.flatMap { t in fahrerIDs.map { Anfrage(driver_id: $0, service_date: t, start: s, ende: e) } })
                .select("id").execute().value
            // Feste Pausen je Dienst (dienst_pausen), fliessen in die Stundenerfassung des Fahrers.
            let plan = pausenGeaendert ? pausen.filter { $0.von != $0.bis }.map { PausePlan(von: $0.von, bis: $0.bis) } : []
            if !plan.isEmpty && !neu.isEmpty {
                let jetzt = ISO8601DateFormatter().string(from: Date())
                do {
                    try await c.from("dienst_pausen").upsert(neu.map { PausenZeile(dienst_id: $0.id, pausen: plan, aktualisiert: jetzt) }).execute()
                } catch {
                    fehler = "Dienste gesendet, Pausen nicht gespeichert: \(error.localizedDescription)"
                    return
                }
            } else if plan.isEmpty, pausenWeg || (b == nil && vorgabe?.pausen.isEmpty == false), !neu.isEmpty {
                // Alle Pausen entfernt: der DB-Trigger hat die alten zur neuen Zeile gelegt, also weg damit.
                _ = try? await c.from("dienst_pausen").delete().in("dienst_id", values: neu.map(\.id)).execute()
            }
        } catch {
            fehler = "Senden fehlgeschlagen: \(error.localizedDescription)"
            return
        }
        // Im Profil nur das gesetzte Feld, fehlen die Datumsspalten, ohne sie.
        var mitDatum: [String: String] = [:], ohneDatum: [String: String] = [:]
        if let s { mitDatum["service_start_time"] = s; mitDatum["service_start_date"] = tag; ohneDatum["service_start_time"] = s }
        if let e { mitDatum["service_end_time"] = e; mitDatum["service_end_date"] = tag; ohneDatum["service_end_time"] = e }
        // Nur Pause: am Profil aendert sich nichts.
        if !mitDatum.isEmpty { do {
            try await c.from("profiles").update(mitDatum).in("id", values: fahrerIDs).execute()
        } catch {
            do {
                try await c.from("profiles").update(ohneDatum).in("id", values: fahrerIDs).execute()
            } catch {
                fehler = "Dienste gesendet, Profil nicht aktualisiert: \(error.localizedDescription)"
                return
            }
        } }
        fertig()
    }
}

/// Reihen mit Umbruch (flex-wrap) fuer die Tages-Chips in "Dienste planen".
private struct TagUmbruch: Layout {
    var abstand: CGFloat = 8

    private func reihen(_ breite: CGFloat, _ teile: Subviews) -> [(x: CGFloat, y: CGFloat)] {
        var orte: [(x: CGFloat, y: CGFloat)] = []
        var x: CGFloat = 0, y: CGFloat = 0, zeile: CGFloat = 0
        for t in teile {
            let g = t.sizeThatFits(.unspecified)
            if x > 0 && x + g.width > breite { x = 0; y += zeile + abstand; zeile = 0 }
            orte.append((x, y))
            x += g.width + abstand
            zeile = max(zeile, g.height)
        }
        return orte
    }

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let breite = proposal.width ?? .infinity
        let orte = reihen(breite, subviews)
        var hoehe: CGFloat = 0, rechts: CGFloat = 0
        for (o, t) in zip(orte, subviews) {
            let g = t.sizeThatFits(.unspecified)
            hoehe = max(hoehe, o.y + g.height)
            rechts = max(rechts, o.x + g.width)
        }
        return CGSize(width: proposal.width ?? rechts, height: hoehe)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        for (o, t) in zip(reihen(bounds.width, subviews), subviews) {
            t.place(at: CGPoint(x: bounds.minX + o.x, y: bounds.minY + o.y), proposal: .unspecified)
        }
    }
}

/// Monatskalender fuer "Dienste planen" (wie DienstKalender im Web): auch Tage in der Vergangenheit.
/// Tage, an denen die ausgewaehlten Fahrer schon einen Dienst haben, tragen einen Lime-Punkt.
private struct DienstKalender: View {
    let gewaehlt: [String]
    let fahrerIDs: [String]
    let umschalten: (String) -> Void
    @State private var monat: Date = {
        var k = Calendar(identifier: .gregorian); k.timeZone = Stunden.berlin
        return k.date(from: k.dateComponents([.year, .month], from: Date())) ?? Date()
    }()
    @State private var belegt = Set<String>()
    private let lime = Color(hex: 0xE3F654)

    private var kal: Calendar { var k = Calendar(identifier: .gregorian); k.timeZone = Stunden.berlin; k.firstWeekday = 2; return k }
    private func iso(_ d: Date) -> String { StundenExport.isoTag(d) }

    var body: some View {
        let tage = kal.range(of: .day, in: .month, for: monat)?.count ?? 30
        let leer = (kal.component(.weekday, from: monat) + 5) % 7
        let felder: [Int?] = Array(repeating: nil, count: leer) + (1...tage).map { Optional($0) }
        let heute = iso(Date())
        VStack(spacing: 4) {
            HStack {
                Button { monat = kal.date(byAdding: .month, value: -1, to: monat) ?? monat } label: { Text("‹").grotesk(20, .bold).foregroundStyle(lime).frame(width: 36, height: 32) }
                Spacer()
                Text(monatText).grotesk(15, .bold).foregroundStyle(.white)
                Spacer()
                Button { monat = kal.date(byAdding: .month, value: 1, to: monat) ?? monat } label: { Text("›").grotesk(20, .bold).foregroundStyle(lime).frame(width: 36, height: 32) }
            }
            .buttonStyle(.web)
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 0), count: 7), spacing: 2) {
                ForEach(["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"], id: \.self) { Text($0).grotesk(11, .bold).foregroundStyle(.white.opacity(0.5)) }
                ForEach(Array(felder.enumerated()), id: \.offset) { _, tag in
                    if let tag, let d = kal.date(byAdding: .day, value: tag - 1, to: monat) {
                        let i = iso(d)
                        let an = gewaehlt.contains(i)
                        Button { umschalten(i) } label: {
                            ZStack(alignment: .bottom) {
                                Text("\(tag)").grotesk(14, .bold).monospacedDigit()
                                    .foregroundStyle(an ? .black : (i < heute ? Color(hex: 0x5F5F5F) : .white))
                                    .frame(maxWidth: .infinity).frame(height: 36)
                                if belegt.contains(i) { Circle().fill(an ? .black : lime).frame(width: 5, height: 5).padding(.bottom, 3) }
                            }
                            .background(RoundedRectangle(cornerRadius: 8).fill(an ? lime : .clear))
                            .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(i == heute && !an ? lime : .clear, lineWidth: 1))
                        }
                        .buttonStyle(.web)
                    } else {
                        Color.clear.frame(height: 36)
                    }
                }
            }
            HStack(spacing: 6) {
                Circle().fill(lime).frame(width: 5, height: 5)
                Text("schon ein Dienst eingetragen").grotesk(11, .medium).foregroundStyle(.white.opacity(0.5))
                Spacer()
            }
            .padding(.top, 2)
        }
        .padding(10)
        .background(RoundedRectangle(cornerRadius: 12).fill(Color(hex: 0x242525)))
        .task(id: "\(iso(monat))|\(fahrerIDs.joined(separator: ","))") { await belegtLaden() }
    }

    private var monatText: String {
        let f = DateFormatter(); f.locale = Locale(identifier: "de_DE"); f.timeZone = Stunden.berlin; f.dateFormat = "LLLL yyyy"
        return f.string(from: monat)
    }

    private func belegtLaden() async {
        struct Zeile: Decodable { let service_date: String; let status: String? }
        guard !fahrerIDs.isEmpty, let ende = kal.date(byAdding: DateComponents(month: 1, day: -1), to: monat) else { belegt = []; return }
        let zeilen: [Zeile] = (try? await Backend.client.from("driver_service_requests").select("service_date, status")
            .in("driver_id", values: fahrerIDs).gte("service_date", value: iso(monat)).lte("service_date", value: iso(ende))
            .execute().value) ?? []
        belegt = Set(zeilen.filter { ($0.status ?? "").lowercased() != "refused" }.map(\.service_date))
    }
}
