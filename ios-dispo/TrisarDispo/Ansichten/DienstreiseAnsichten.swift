import SwiftUI
import UniformTypeIdentifiers

// Dienstreise in der Dispo, Nachbau von DienstreiseAdd.jsx, DienstreiseView.jsx und DienstreiseKacheln.jsx.
// Raster wie Standby: Titel 140, Felder ab 206, Reihen alle 68, Zeilenhoehe 56.

private let reiseSchritt: CGFloat = 68
private let reiseZeile: CGFloat = 56

/// Ergebnis der Pruefung als Marke rechts in der Zeile (Zug- bzw. Flugnummer).
private func pruefMarke(laeuft: Bool, _ v: DienstreiseVerbindung?) -> EtaMarke? {
    if laeuft { return EtaMarke(text: "prüfe …", farbe: 0x868687) }
    guard let v else { return nil }
    if v.fehler != nil { return EtaMarke(text: "nicht gefunden", farbe: 0xFF6F63) }
    let gleis = v.gleis.isEmpty ? "" : " · \(v.art == "zug" ? "Gl. " : "")\(v.gleis)"
    return EtaMarke(text: "ab \(v.abfahrt)\(gleis)", farbe: 0xE3F654)
}

// MARK: - Dienstreise verschicken (DienstreiseAdd.jsx, 14.11.)

/// Abschnitt im Formular: Start Zeit, Start, Zug / Flug, dazu was das Ticket ueber Ankunft und Gleise weiss.
private struct FormAbschnitt: Identifiable, Equatable {
    struct TicketTeil: Equatable {
        var an = ""; var nach = ""; var anDatum: String?; var gleisAb = ""; var gleisAn = ""; var hinweis = ""
    }
    let key = UUID()
    var zeit = ""
    var startText = ""
    var startID: UUID?
    var nummer = ""
    var uebernommen = ""
    var ticket: TicketTeil?
    var id: UUID { key }
}

/// Stand der Pruefung eines Abschnitts.
private struct PruefStand: Equatable {
    var laeuft = false
    /// Bus/U-Bahn/Tram: keine Live-Abfrage.
    var ohne = false
    var v: DienstreiseVerbindung?
}

private func kurzOrt(_ text: String) -> String {
    FahrtText.getrimmt(String(text.split(separator: ",", omittingEmptySubsequences: false).first ?? ""))
}

/// Datum, dann je Abschnitt Start Zeit, Start, „Zug / Flug“ (Pruefung, Haken uebernimmt die Abfahrt),
/// dazwischen „Umstieg in … · N min“, „+ Umstieg hinzufügen“, Ziel, Fahrer, Ticket, Notiz, „Dienstreise senden“.
/// Upload-Symbol oben rechts: Ticket hochladen, der Server liest es und fuellt das Formular.
struct DienstreiseFormularAnsicht: View {
    let zurueck: () -> Void
    let zuFahrt: () -> Void
    let zumStandby: () -> Void
    let zeigen: (DispoZiel) -> Void

    private let kopfHoehe: CGFloat = 36

    @ObservedObject private var orte = OrteSpeicher.geteilt
    /// ID schon jetzt: das Ticket liegt im Ordner der Dienstreise, auch bevor sie gesendet ist.
    @State private var reiseID = UUID()
    @State private var datum = Stunden.heuteDatum
    @State private var abschnitte: [FormAbschnitt] = [FormAbschnitt()]
    @State private var zielText = ""
    @State private var zielID: UUID?
    @State private var pruefungen: [UUID: PruefStand] = [:]
    @State private var pruefNr: [UUID: Int] = [:]
    @State private var geprueft: [UUID: String] = [:]
    @State private var ortTreffer: [EigenerOrt] = []
    @State private var vorschlaege: [String] = []
    @State private var vorschlagLauf: Task<Void, Never>?
    @State private var notiz = ""
    @State private var ticket: DispoDienstreiseSpeicher.Ticket?
    @State private var reisender = ""
    @State private var auftragsnummer = ""
    @State private var hinweis = ""
    @State private var laedt = false
    @State private var dateiWahl = false
    @State private var fehler = ""
    @State private var sendet = false
    @State private var fahrerNamen: [String] = FahrerMarkierung.geteilt.wirkt ? fahrerZeilen(FahrerMarkierung.geteilt.namen) : [""]
    @State private var fahrer: [FahrtSpeichern.FahrerEintrag] = []
    @State private var fahrerListe: [String] = []
    @State private var autoZu = false
    @FocusState private var fokus: String?

    // Raster: Datum, je Abschnitt (Kopf „Umstieg“, Start Zeit, Start, Zug / Flug), „+ Umstieg“, Ziel, Fahrer, Ticket, Notiz.
    private struct Block { let i: Int; let kopf: CGFloat?; let zeit: CGFloat; let start: CGFloat; let nummer: CGFloat }
    private struct Raster {
        var bloecke: [Block] = []
        var plus: CGFloat = 0, ziel: CGFloat = 0, fahrer: CGFloat = 0, ticket: CGFloat?, notiz: CGFloat = 0, knopf: CGFloat = 0, hoehe: CGFloat = 0
    }
    private var raster: Raster {
        var r = Raster()
        var y: CGFloat = 206 + reiseSchritt
        for i in abschnitte.indices {
            var kopf: CGFloat?
            if i > 0 { kopf = y; y += kopfHoehe }
            let z = y; y += reiseSchritt
            let s = y; y += reiseSchritt
            let n = y; y += reiseSchritt
            r.bloecke.append(Block(i: i, kopf: kopf, zeit: z, start: s, nummer: n))
        }
        r.plus = y; y += reiseSchritt
        r.ziel = y; y += reiseSchritt
        r.fahrer = y; y += CGFloat(fahrerNamen.count) * reiseSchritt
        if ticket != nil { r.ticket = y; y += reiseSchritt }
        r.notiz = y - reiseSchritt + reiseZeile + 24
        r.knopf = r.notiz + 224 + 24
        r.hoehe = r.knopf + reiseZeile + (fehler.isEmpty ? 30 : 60)
        return r
    }

    var body: some View {
        let r = raster
        ZStack(alignment: .topLeading) {
            Leinwand(basisHoehe: 874, inhaltHoehe: r.hoehe + 151, mitHintergrund: false) { _ in
                ZStack(alignment: .topLeading) {
                    DispoHintergrund().frame(width: 402, height: r.hoehe + 151)
                    ZurueckKnopf(aktion: zurueck).platz(20, 60, 50, 50)
                    ArtUmschalter(art: .dienstreise, fahrt: zuFahrt, zumStandby: zumStandby, zurDienstreise: {})
                        .platz(0, 67, 402, 36)
                    // Ticket hochladen: gleiches Symbol wie der Import in Fahrt hinzufuegen.
                    Button { dateiWahl = true } label: {
                        Image("import-fahrten").resizable().frame(width: 42, height: 40).contentShape(Rectangle())
                    }
                    .buttonStyle(.web)
                    .disabled(laedt)
                    .opacity(laedt ? 0.5 : 1)
                    .accessibilityLabel("Ticket hochladen")
                    .platz(402 - 20 - 42, 65, 42, 40)

                    Text("Dienstreise").font(.grotesk(42, .bold)).foregroundStyle(formularLime).platz(20, 140, 362, 42)
                    if !hinweis.isEmpty {
                        Text(hinweis).font(.grotesk(12, .bold)).foregroundStyle(formularLime).lineLimit(1)
                            .platz(20, 184, 362, nil)
                    }

                    DatumZeile(wert: $datum).platz(20, 206, 362, 56)

                    ForEach(r.bloecke, id: \.i) { b in
                        if b.i < abschnitte.count { abschnittBlock(b) }
                    }

                    Button {
                        // Neuer Abschnitt beginnt dort, wo der letzte laut Ticket ankommt. Aenderbar.
                        var neu = FormAbschnitt()
                        neu.startText = abschnitte.last?.ticket?.nach ?? ""
                        abschnitte.append(neu)
                    } label: {
                        Text("+ Umstieg hinzufügen").font(.grotesk(16, .bold)).foregroundStyle(formularLime)
                            .frame(width: 362, height: 56)
                            .overlay(Rectangle().strokeBorder(formularLime, style: StrokeStyle(lineWidth: 2, dash: [6, 4])))
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.web)
                    .platz(20, r.plus, 362, 56)

                    FormularZeile(beschriftung: "Ziel", wert: zielText, zuruecksetzen: {
                        zielText = ""; zielID = nil; vorschlaege = []; ortTreffer = []
                    }) {
                        ZeilenEingabe(text: Binding(get: { zielText }, set: { t in
                            if t != zielText { zielID = nil }
                            zielText = t
                            ortTippen(t)
                        }))
                        .focused($fokus, equals: "ziel")
                    }
                    .platz(20, r.ziel, 362, 56)

                    ForEach(Array(fahrerNamen.enumerated()), id: \.offset) { i, _ in
                        FormularZeile(beschriftung: fahrerBeschriftung(i, fahrerNamen.count),
                                      wert: i < fahrerNamen.count ? fahrerNamen[i] : "",
                                      zuruecksetzen: { setzeFahrer(i, "") }) {
                            ZeilenEingabe(text: Binding(get: { i < fahrerNamen.count ? fahrerNamen[i] : "" },
                                                        set: { autoZu = false; setzeFahrer(i, $0) }),
                                          platzhalter: fahrerListe.isEmpty ? "Fahrer werden geladen..." : "")
                                .focused($fokus, equals: "fahrer-\(i)")
                        }
                        .platz(20, r.fahrer + CGFloat(i) * reiseSchritt, 362, 56)
                    }

                    if let t = ticket, let oben = r.ticket {
                        FormularZeile(beschriftung: "Ticket", wert: t.name, rechts: .kreuz, rechtsAktion: { ticket = nil },
                                      zuruecksetzen: { ticket = nil }) {
                            ZeilenWert(text: t.name)
                        }
                        .platz(20, oben, 362, 56)
                    }

                    NotizBlock(text: $notiz, fokus: $fokus).platz(0, r.notiz, 402, 224)

                    FormularSpeichernKnopf(text: sendet ? "Wird gesendet …" : "Dienstreise senden", gesperrt: sendet || laedt) {
                        Task { await senden() }
                    }
                    .platz(20, r.knopf, 362, 56)
                    if !fehler.isEmpty {
                        Text(fehler).font(.grotesk(13, .bold)).foregroundStyle(DispoDienstreiseSpeicher.rot)
                            .platz(20, r.knopf + reiseZeile + 10, 362, nil)
                    }

                    // Ortsvorschlaege unter dem offenen Feld (eigene Orte zuerst, dann Adressen).
                    if let f = fokus, f == "ziel" || f.hasPrefix("start-"), !ortTreffer.isEmpty || !vorschlaege.isEmpty,
                       let oben = ortOben(f, r) {
                        VorschlagListe(eintraege: ortTreffer.map(\.name) + vorschlaege,
                                       icons: ortTreffer.map { Optional($0.symbol.grau) }) { n in
                            let eigener = n < ortTreffer.count ? ortTreffer[n] : nil
                            let text = eigener?.name ?? vorschlaege[n - ortTreffer.count]
                            if f == "ziel" { zielText = text; zielID = eigener?.id }
                            else if let i = index(f) { abschnitte[i].startText = text; abschnitte[i].startID = eigener?.id }
                            vorschlaege = []; ortTreffer = []
                            fokus = nil
                        }
                        .platz(20, oben + reiseZeile + 4, 362, nil)
                    }
                    if let f = fokus, f.hasPrefix("fahrer-"), !autoZu, let i = Int(f.dropFirst(7)), i < fahrerNamen.count {
                        let treffer = fahrerTreffer(fahrerNamen[i], fahrerListe)
                        if !treffer.isEmpty {
                            VorschlagListe(eintraege: treffer) { n in
                                autoZu = true
                                setzeFahrer(i, treffer[n])
                            }
                            .platz(20, r.fahrer + CGFloat(i) * reiseSchritt + reiseZeile + 4, 362, nil)
                        }
                    }
                }
            }
            .scrollDismissesKeyboard(.interactively)
            Navileiste(aktiv: .fahrtNeu) { zeigen($0) }
        }
        .task { await orte.laden() }
        .task {
            fahrer = await FahrtSpeichern.fahrerLaden()
            fahrerListe = FahrtSpeichern.fahrerVorschlaege(fahrer)
        }
        // Automatisch pruefen, 800 ms nachdem Nummer, Start oder Datum eines Abschnitts geaendert wurden.
        .task(id: signatur) {
            try? await Task.sleep(for: .milliseconds(800))
            if Task.isCancelled { return }
            for (i, a) in abschnitte.enumerated() {
                let s = "\(FahrtText.getrimmt(a.nummer))|\(FahrtText.getrimmt(a.startText))|\(a.startID?.uuidString ?? "")|\(datum)|\(i + 1 < abschnitte.count ? abschnitte[i + 1].startText : "")"
                if geprueft[a.key] == s { continue }
                geprueft[a.key] = s
                if !FahrtText.getrimmt(a.nummer).isEmpty && !FahrtText.getrimmt(a.startText).isEmpty {
                    Task { await pruefen(a.key) }
                }
            }
        }
        .fileImporter(isPresented: $dateiWahl, allowedContentTypes: [.pdf, .jpeg, .png]) { antwort in
            if case let .success(url) = antwort { Task { await ticketGewaehlt(url) } }
        }
        .onChange(of: fokus) { alt, neu in
            if alt != neu { vorschlaege = []; ortTreffer = [] }
        }
        .onChange(of: abschnitte) { _, _ in fehler = "" }
        .onChange(of: [datum, zielText] + fahrerNamen) { _, _ in fehler = "" }
    }

    private var signatur: String {
        abschnitte.map { "\($0.key)|\(FahrtText.getrimmt($0.nummer))|\(FahrtText.getrimmt($0.startText))|\($0.startID?.uuidString ?? "")" }
            .joined(separator: "§") + "#\(datum)"
    }

    private func index(_ feld: String) -> Int? {
        guard feld.hasPrefix("start-"), let key = UUID(uuidString: String(feld.dropFirst(6))) else { return nil }
        return abschnitte.firstIndex { $0.key == key }
    }

    private func ortOben(_ feld: String, _ r: Raster) -> CGFloat? {
        if feld == "ziel" { return r.ziel }
        guard let i = index(feld), i < r.bloecke.count else { return nil }
        return r.bloecke[i].start
    }

    @ViewBuilder
    private func abschnittBlock(_ b: Block) -> some View {
        let a = abschnitte[b.i]
        let key = a.key
        if let kopf = b.kopf {
            let umstieg = umstiegMinuten(abschnitte[b.i - 1], a)
            HStack(spacing: 12) {
                HStack(spacing: 10) {
                    Rectangle().fill(formularLime).frame(width: 24, height: 2)
                    Text("Umstieg\(FahrtText.getrimmt(a.startText).isEmpty ? "" : " in \(kurzOrt(a.startText))")")
                        .font(.grotesk(16, .bold)).foregroundStyle(formularLime).lineLimit(1)
                }
                Spacer(minLength: 0)
                if let umstieg {
                    Text("\(umstieg) min").font(.grotesk(14, .bold)).foregroundStyle(Color(hex: 0x868687))
                }
                Button { abschnitte.removeAll { $0.key == key } } label: {
                    Text("✕").font(.grotesk(16, .bold)).foregroundStyle(Color(hex: 0xF55757))
                }
                .buttonStyle(.web)
                .accessibilityLabel("Umstieg entfernen")
            }
            .platz(20, kopf + 6, 362, 24)
        }
        UhrZeile(beschriftung: "Start Zeit", wert: bindung(key, \.zeit)).platz(20, b.zeit, 362, 56)
        FormularZeile(beschriftung: "Start", wert: a.startText, zuruecksetzen: {
            setze(key) { $0.startText = ""; $0.startID = nil }; vorschlaege = []; ortTreffer = []
        }) {
            ZeilenEingabe(text: Binding(get: { abschnitte.first { $0.key == key }?.startText ?? "" }, set: { t in
                setze(key) { x in
                    if t != x.startText { x.startID = nil }
                    x.startText = t
                }
                ortTippen(t)
            }))
            .focused($fokus, equals: "start-\(key.uuidString)")
        }
        .platz(20, b.start, 362, 56)
        let p = pruefungen[key]
        let aktion = nummerAktion(a)
        FormularZeile(beschriftung: "Zug / Flug", wert: a.nummer,
                      eta: FahrtText.getrimmt(a.nummer).isEmpty || p?.ohne == true ? nil : pruefMarke(laeuft: p?.laeuft ?? false, p?.v),
                      rechts: aktion?.art, rechtsAktion: aktion?.tippen,
                      zuruecksetzen: { setze(key) { $0.nummer = ""; $0.uebernommen = "" }; pruefungen[key] = nil }) {
            ZeilenEingabe(text: Binding(get: { abschnitte.first { $0.key == key }?.nummer ?? "" }, set: { t in
                setze(key) { $0.nummer = t }
                pruefungen[key] = nil
            }))
        }
        .platz(20, b.nummer, 362, 56)
    }

    private func bindung(_ key: UUID, _ pfad: WritableKeyPath<FormAbschnitt, String>) -> Binding<String> {
        Binding(get: { abschnitte.first { $0.key == key }?[keyPath: pfad] ?? "" },
                set: { w in setze(key) { $0[keyPath: pfad] = w } })
    }

    private func setze(_ key: UUID, _ aendern: (inout FormAbschnitt) -> Void) {
        guard let i = abschnitte.firstIndex(where: { $0.key == key }) else { return }
        aendern(&abschnitte[i])
    }

    /// Knopf rechts wie bei Flug/Zug in Fahrt hinzufuegen: Pfeil = pruefen, Haken = Abfahrt uebernehmen, × = zuruecksetzen.
    private func nummerAktion(_ a: FormAbschnitt) -> (art: RechtsArt, tippen: () -> Void)? {
        let p = pruefungen[a.key]
        let nummer = FahrtText.getrimmt(a.nummer)
        if nummer.isEmpty || p?.ohne == true { return nil }
        let ist = !a.uebernommen.isEmpty && a.uebernommen == nummer
        let abfahrt = p?.v.flatMap { $0.fehler == nil ? $0.abfahrt : nil } ?? ""
        let kann = p?.laeuft == false && !abfahrt.isEmpty
        let key = a.key
        if ist { return (.kreuz, { setze(key) { $0.uebernommen = ""; $0.nummer = "" }; pruefungen[key] = nil }) }
        if kann { return (.haken, { setze(key) { $0.zeit = abfahrt; $0.uebernommen = nummer } }) }
        return (.pfeil, { Task { await pruefen(key) } })
    }

    /// Ankunft eines Abschnitts: live, sonst aus dem Ticket.
    private func ankunft(_ a: FormAbschnitt) -> String {
        if let an = pruefungen[a.key]?.v?.ankunft, !an.isEmpty, pruefungen[a.key]?.v?.fehler == nil { return an }
        return a.ticket?.an ?? ""
    }

    private func umstiegMinuten(_ vorher: FormAbschnitt, _ a: FormAbschnitt) -> Int? {
        guard let an = DienstreiseAbschnitt.minuten(ankunft(vorher)), let ab = DienstreiseAbschnitt.minuten(a.zeit) else { return nil }
        return (ab - an + 1440) % 1440
    }

    private func ortTippen(_ text: String) {
        vorschlagLauf?.cancel()
        let q = FahrtText.getrimmt(text)
        ortTreffer = orte.treffer(q)
        if q.isEmpty { vorschlaege = []; return }
        vorschlagLauf = Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(250))
            if Task.isCancelled { return }
            let liste = await FahrtPruefung.ortsVorschlaege(q)
            if !Task.isCancelled { vorschlaege = liste }
        }
    }

    private func setzeFahrer(_ i: Int, _ wert: String) {
        var neu = fahrerNamen
        if i < neu.count { neu[i] = wert }
        let gefuellt = neu.enumerated().filter { !FahrtText.getrimmt($0.element).isEmpty || $0.offset == i }.map(\.element)
        fahrerNamen = gefuellt.last.map { FahrtText.getrimmt($0).isEmpty } == true ? gefuellt : gefuellt + [""]
    }

    /// Ort aufloesen: eigener Ort, sonst Adresse suchen. bahnhof (19.11.): Halt vom Ticket oder Start eines Zug-/Bus-
    /// Abschnitts. Dann erst der Bahnhof bei der Bahn ("München-Trudering" ist der Bahnhof, nicht der Stadtteil),
    /// sonst "Bahnhof …" in der Adresssuche.
    private func ortAufloesen(_ text: String, _ id: UUID?, bahnhof: Bool = false) async -> DispoDienstreiseSpeicher.OrtDaten? {
        if let id, let o = orte.orte.first(where: { $0.id == id }) {
            return .init(id: o.id, name: o.name, adresse: o.adresse, lat: o.lat, lng: o.lng)
        }
        if FahrtText.getrimmt(text).isEmpty { return nil }
        if bahnhof {
            if case let .success(daten) = await FahrtPruefung.aufrufen("train-validate", ["halt_orten": .array([.string(FahrtText.getrimmt(text))])]),
               let h = daten.objectValue?["halte"]?.arrayValue?.first?.objectValue,
               let lat = h["lat"]?.doubleValue, let lng = h["lng"]?.doubleValue {
                let name = FahrtText.getrimmt(h["name"]?.stringValue ?? text)
                return .init(id: nil, name: name, adresse: name, lat: lat, lng: lng)
            }
            if text.range(of: #"bahnhof|hbf|\bbf\b"#, options: [.regularExpression, .caseInsensitive]) == nil,
               let p = await Routen.punkt(fuer: "Bahnhof \(text)") {
                return .init(id: nil, name: kurzOrt(text), adresse: text, lat: p.latitude, lng: p.longitude)
            }
        }
        guard let p = await Routen.punkt(fuer: text) else { return nil }
        return .init(id: nil, name: kurzOrt(text), adresse: text, lat: p.latitude, lng: p.longitude)
    }

    /// Halt eines Zug-, S-Bahn-, U-Bahn-, Tram- oder Busabschnitts ist ein Bahnhof bzw. eine Haltestelle (19.11.).
    private func istHalt(_ art: String) -> Bool { ["zug", "sbahn", "ubahn", "tram", "bus"].contains(art) }
    /// Ziel kommt vom Ticket (Ausstieg des letzten Abschnitts): dann ist es ein Bahnhof.
    private var zielIstHalt: Bool {
        guard let nach = abschnitte.last?.ticket?.nach, !nach.isEmpty else { return false }
        return FahrtText.getrimmt(nach) == FahrtText.getrimmt(zielText)
    }

    /// Verbindung eines Abschnitts pruefen. Ausstieg: Start des naechsten Abschnitts (Umstieg), sonst Ticket, sonst Ziel.
    private func pruefen(_ key: UUID) async {
        guard let index = abschnitte.firstIndex(where: { $0.key == key }) else { return }
        let a = abschnitte[index]
        let nummer = FahrtText.getrimmt(a.nummer)
        let art = DienstreiseAbschnitt.art(nummer)
        if nummer.isEmpty || FahrtText.getrimmt(a.startText).isEmpty || datum.isEmpty { pruefungen[key] = nil; return }
        if !DienstreiseAbschnitt.mitLive(art) { pruefungen[key] = PruefStand(ohne: true); return }
        let nr = (pruefNr[key] ?? 0) + 1
        pruefNr[key] = nr
        pruefungen[key] = PruefStand(laeuft: true)
        let naechster = index + 1 < abschnitte.count ? abschnitte[index + 1] : nil
        let startDaten = a.startID != nil ? await ortAufloesen(a.startText, a.startID, bahnhof: istHalt(art)) : nil
        let zielDaten = naechster == nil && !FahrtText.getrimmt(zielText).isEmpty ? await ortAufloesen(zielText, zielID, bahnhof: zielIstHalt) : nil
        let bahnhof = naechster.map { kurzOrt($0.startText) } ?? (a.ticket?.nach).map(kurzOrt) ?? ""
        let v = await DienstreiseVerbindung.holen(
            datum: datum, startZeit: a.zeit, startName: startDaten?.name ?? kurzOrt(a.startText),
            startLat: startDaten?.lat, startLng: startDaten?.lng,
            zielName: zielDaten?.name ?? zielText, zielLat: zielDaten?.lat, zielLng: zielDaten?.lng,
            zielBahnhof: bahnhof,
            zugnummer: art == "flug" ? "" : nummer, flugnummer: art == "flug" ? nummer : "")
        if pruefNr[key] == nr { pruefungen[key] = PruefStand(v: v) }
    }

    // MARK: Ticket

    private func ticketGewaehlt(_ url: URL) async {
        let zugriff = url.startAccessingSecurityScopedResource()
        defer { if zugriff { url.stopAccessingSecurityScopedResource() } }
        guard let daten = try? Data(contentsOf: url) else { fehler = "Datei konnte nicht gelesen werden."; return }
        let name = url.lastPathComponent
        let ext = url.pathExtension.lowercased()
        let typ = ext == "pdf" ? "application/pdf" : (ext == "png" ? "image/png" : "image/jpeg")
        laedt = true
        hinweis = "Ticket wird gelesen …"
        defer { laedt = false }
        let r = await DispoDienstreiseSpeicher.ticketHochladenUndLesen(reiseID, daten: daten, name: name, typ: typ)
        guard let t = r.ticket else { hinweis = ""; fehler = r.fehler; return }
        ticket = t
        guard let g = r.gelesen else {
            hinweis = r.fehler.isEmpty ? "Ticket gespeichert. Bitte die Felder von Hand ausfüllen." : r.fehler
            return
        }
        if let d = g.datum, !d.isEmpty { datum = String(d.prefix(10)) }
        let teile = g.abschnitte ?? []
        let neu = teile.map { x -> FormAbschnitt in
            var a = FormAbschnitt()
            a.zeit = DienstreiseVerbindung.hm(x.ab)
            a.startText = x.von ?? ""
            a.nummer = x.nummer ?? ""
            a.ticket = .init(an: DienstreiseVerbindung.hm(x.an), nach: x.nach ?? "", anDatum: x.an_datum,
                             gleisAb: x.gleis_ab ?? "", gleisAn: x.gleis_an ?? "", hinweis: x.hinweis ?? "")
            return a
        }
        if !neu.isEmpty { abschnitte = neu; pruefungen = [:]; geprueft = [:] }
        if let nach = teile.last?.nach, !nach.isEmpty { zielText = nach; zielID = nil }
        reisender = g.name ?? ""
        auftragsnummer = g.auftragsnummer ?? ""
        let reservierung = teile.compactMap(\.hinweis).filter { !$0.isEmpty }.joined(separator: ", ")
        notiz = [
            (g.auftragsnummer ?? "").isEmpty ? "" : "Auftrag \(g.auftragsnummer!)",
            [g.tarif ?? "", g.klasse ?? ""].filter { !$0.isEmpty }.joined(separator: ", "),
            (g.zugbindung ?? []).isEmpty ? "" : "Zugbindung \((g.zugbindung ?? []).joined(separator: " und "))",
            reservierung,
            "Ausweis mitnehmen.",
        ].filter { !$0.isEmpty }.joined(separator: ". ").replacingOccurrences(of: "..", with: ".")
        // Reisender aus dem Ticket als Fahrer, wenn er in der Fahrerliste steht.
        var gefunden = false
        if let n = g.name, !n.isEmpty {
            if fahrer.isEmpty { fahrer = await FahrtSpeichern.fahrerLaden() }
            if let id = FahrtSpeichern.fahrerID(n, fahrer), let p = fahrer.first(where: { $0.id == id }) {
                gefunden = true
                let anzeige = FahrtText.getrimmt("\(p.first_name ?? "") \(p.last_name ?? "")") + (p.nummer.isEmpty ? "" : " (\(p.nummer))")
                var liste = [anzeige]
                for x in fahrerNamen where !FahrtText.getrimmt(x).isEmpty && !liste.contains(x) { liste.append(x) }
                fahrerNamen = liste + [""]
            }
        }
        hinweis = gefunden || (g.name ?? "").isEmpty
            ? "Aus dem Ticket ausgefüllt. Bitte prüfen und dann senden."
            : "Aus dem Ticket ausgefüllt. \(g.name ?? "") steht nicht in der Fahrerliste, bitte Fahrer eintragen."
    }

    // MARK: Senden

    private func senden() async {
        fehler = ""
        if datum.isEmpty { fehler = "Bitte ein Datum setzen."; return }
        let liste = abschnitte
        if liste.contains(where: { $0.zeit.isEmpty }) { fehler = "Bitte bei jedem Abschnitt die Start Zeit setzen."; return }
        if liste.contains(where: { FahrtText.getrimmt($0.startText).isEmpty }) { fehler = "Bitte bei jedem Abschnitt einen Start wählen."; return }
        if FahrtText.getrimmt(zielText).isEmpty { fehler = "Bitte ein Ziel wählen."; return }
        let namen = fahrerNamen.map(FahrtText.getrimmt).filter { !$0.isEmpty }
        if namen.isEmpty { fehler = "Bitte mindestens einen Fahrer eintragen."; return }
        sendet = true
        defer { sendet = false }
        var starts: [DispoDienstreiseSpeicher.OrtDaten] = []
        for a in liste {
            guard let o = await ortAufloesen(a.startText, a.startID, bahnhof: istHalt(DienstreiseAbschnitt.art(FahrtText.getrimmt(a.nummer)))) else {
                fehler = "„\(a.startText)“ nicht gefunden. Bitte genauer eingeben oder einen eigenen Ort wählen."; return
            }
            starts.append(o)
        }
        guard let ziel = await ortAufloesen(zielText, zielID, bahnhof: zielIstHalt) else {
            fehler = "Ziel nicht gefunden. Bitte genauer eingeben oder einen eigenen Ort wählen."; return
        }
        if fahrer.isEmpty { fahrer = await FahrtSpeichern.fahrerLaden() }
        var ids: [UUID] = []
        for n in namen {
            guard let id = FahrtSpeichern.fahrerID(n, fahrer) else { fehler = "Fahrer „\(n)“ nicht gefunden."; return }
            if !ids.contains(id) { ids.append(id) }
        }
        let teile = liste.enumerated().map { i, a -> DispoDienstreiseSpeicher.NeuerAbschnitt in
            let p = pruefungen[a.key]?.v
            let nach = i + 1 < liste.count ? starts[i + 1] : ziel
            let gleisLive = p.flatMap { $0.fehler == nil ? $0.gleis : nil } ?? ""
            return .init(art: DienstreiseAbschnitt.art(a.nummer), nummer: FahrtText.getrimmt(a.nummer),
                         vonName: starts[i].name, vonLat: starts[i].lat, vonLng: starts[i].lng,
                         abDatum: datum, abZeit: a.zeit,
                         gleisAb: gleisLive.isEmpty ? (a.ticket?.gleisAb ?? "") : gleisLive,
                         nachName: (a.ticket?.nach).map { $0.isEmpty ? nach.name : kurzOrt($0) } ?? nach.name,
                         nachLat: nach.lat, nachLng: nach.lng,
                         anDatum: a.ticket?.anDatum, anZeit: ankunft(a),
                         gleisAn: a.ticket?.gleisAn ?? "", hinweis: a.ticket?.hinweis ?? "")
        }
        let erster = teile[0]
        switch await DispoDienstreiseSpeicher.gemeinsam.anlegen(
            id: reiseID, datum: datum, startZeit: erster.abZeit, start: starts[0], ziel: ziel,
            zugnummer: erster.art == "flug" ? "" : erster.nummer, flugnummer: erster.art == "flug" ? erster.nummer : "",
            notiz: FahrtText.getrimmt(notiz), fahrerIDs: ids, abschnitte: teile, ticket: ticket,
            reisender: reisender, auftragsnummer: auftragsnummer) {
        case let .success(id):
            DispoDienstreiseSpeicher.gemeinsam.oeffnen = id
            zeigen(.fahrten)
        case let .failure(e):
            fehler = e.localizedDescription.isEmpty ? "Dienstreise nicht gespeichert." : e.localizedDescription
        }
    }
}

// MARK: - Dienstreise ansehen und bearbeiten (DienstreiseView.jsx)

/// Felder, Fahrer mit Zustand (Angefragt/Angenommen/Abgelehnt/Beendet), × nimmt raus, neue Fahrer,
/// Notiz, Speichern, „Dienstreise löschen“. Geaenderte Zeit bestaetigen die Fahrer neu (Trigger).
struct DienstreiseDispoAnsicht: View {
    let reiseID: UUID
    let zurueck: () -> Void

    @ObservedObject private var speicher = DispoDienstreiseSpeicher.gemeinsam
    @State private var datum: String?
    @State private var zeit: String?
    @State private var notiz: String?
    @State private var neue: [String] = [""]
    @State private var meldung = ""
    @State private var speichert = false
    @State private var live: DienstreiseVerbindung?
    @State private var wegFrage: DispoDienstreiseSpeicher.Fahrer?
    @State private var loeschFrage = false
    @State private var fahrer: [FahrtSpeichern.FahrerEintrag] = []
    @State private var fahrerListe: [String] = []
    @State private var autoZu = false
    /// Live-Stand je Abschnitt (Umstiege), alle 2 Minuten neu.
    @State private var liveJe: [UUID: DienstreiseVerbindung] = [:]
    /// Aufgeklappte Halte je Abschnitt (ohne Umstiege: die Reise-ID).
    @State private var halteOffen: Set<UUID> = []
    @State private var jetzt = Date()
    private let takt = Timer.publish(every: 30, on: .main, in: .common).autoconnect()
    @FocusState private var fokus: String?
    @Environment(\.openURL) private var oeffnenURL

    private var r: DispoDienstreiseSpeicher.Reise? { speicher.liste?.first { $0.id == reiseID } }

    var body: some View {
        ZStack(alignment: .topLeading) {
            if let r {
                inhalt(r)
            } else {
                ZStack(alignment: .topLeading) {
                    DispoHintergrund().ignoresSafeArea()
                    Leinwand(basisHoehe: 874, mitHintergrund: false) { _ in
                        ZStack(alignment: .topLeading) {
                            ZurueckKnopf(aktion: zurueck).platz(20, 60, 50, 50)
                            Text(speicher.liste == nil ? "" : "Dienstreise nicht mehr vorhanden.")
                                .font(.grotesk(18, .bold)).foregroundStyle(formularLime).platz(20, 140, 362, nil)
                        }
                    }
                }
            }
            FussleisteUnten()
        }
        .task { await speicher.starten() }
        .task {
            fahrer = await FahrtSpeichern.fahrerLaden()
            fahrerListe = FahrtSpeichern.fahrerVorschlaege(fahrer)
        }
        // Verbindung live holen (Abfahrt, Gleis, Ankunft), sonst Stand beim Anlegen.
        .task(id: "\(r?.id.uuidString ?? "")|\(r?.nummer ?? "")|\(r?.datum ?? "")|\(r?.startName ?? "")") {
            guard let r, !r.nummer.isEmpty else { return }
            live = await DispoDienstreiseSpeicher.verbindungHolen(r)
        }
        // Mit Umstiegen: Zug/Flug-Abschnitte live (Zeiten, Verspaetung, Halte), Bus/U-Bahn behalten die Ticketzeiten.
        .task(id: r.map { x in x.abschnitte.count > 1 ? x.abschnitte.map { "\($0.id)|\($0.nummer)|\($0.ab_zeit)" }.joined(separator: ",") : "-" } ?? "-") {
            guard let r, r.abschnitte.count > 1 else { return }
            while !Task.isCancelled {
                for a in r.abschnitte {
                    if Task.isCancelled { return }
                    if let v = await DienstreiseAbschnitt.holen(a, datum: r.datum), v.fehler == nil, !Task.isCancelled { liveJe[a.id] = v }
                }
                try? await Task.sleep(for: .seconds(120))
            }
        }
        .onReceive(takt) { jetzt = $0 }
        .alert("\(wegFrage?.profil?.name ?? "Fahrer") aus der Dienstreise nehmen?", isPresented: Binding(get: { wegFrage != nil }, set: { if !$0 { wegFrage = nil } })) {
            Button("Abbrechen", role: .cancel) {}
            Button("Rausnehmen", role: .destructive) {
                guard let f = wegFrage else { return }
                Task {
                    let e = await speicher.fahrerWeg(reiseID, f.driverID)
                    meldung = e.isEmpty ? "\(f.profil?.name ?? "Fahrer") ist raus." : "Nicht gespeichert: \(e)"
                    await speicher.laden()
                }
            }
        }
        .alert("Dienstreise \(r?.startName ?? "") → \(r?.zielName ?? "") löschen? Alle Fahrer bekommen „Dienstreise zurückgezogen“.", isPresented: $loeschFrage) {
            Button("Abbrechen", role: .cancel) {}
            Button("Löschen", role: .destructive) {
                Task {
                    let e = await speicher.loeschen(reiseID)
                    if e.isEmpty { zurueck() } else { meldung = "Nicht gelöscht: \(e)" }
                }
            }
        }
    }

    private func verbindungMarke(_ r: DispoDienstreiseSpeicher.Reise) -> EtaMarke? {
        if r.nummer.isEmpty { return nil }
        if live?.fehler != nil && r.verbindung == nil { return EtaMarke(text: "nicht gefunden", farbe: 0xFF6F63) }
        guard let v = verbindung(r) else { return EtaMarke(text: "prüfe …", farbe: 0x868687) }
        // Verspaetet: Orange statt Lime.
        let spaet = max(v.abfahrtSpaet, v.ankunftSpaet)
        return EtaMarke(text: "ab \(v.abfahrt)\(v.ankunft.isEmpty ? "" : " · an \(v.ankunft)")", farbe: spaet > 0 ? 0xF0997B : 0xE3F654)
    }

    /// Live-Stand der Reise ohne Umstiege, sonst Stand beim Anlegen.
    private func verbindung(_ r: DispoDienstreiseSpeicher.Reise) -> DienstreiseVerbindung? {
        live.flatMap { $0.fehler == nil ? $0 : nil } ?? r.verbindung
    }

    /// Halte eines Abschnitts (nur Zug), leer = keine Halte-Kachel.
    private func halte(_ a: DienstreiseAbschnitt) -> [DienstreiseVerbindung.Zwischenhalt] {
        a.art == "flug" ? [] : (liveJe[a.id]?.halte ?? [])
    }

    /// Platz fuer die Halte-Kachel unter einer Zeile (12 Abstand + Kachel), 0 ohne Halte.
    private func halteExtra(_ id: UUID, _ halte: [DienstreiseVerbindung.Zwischenhalt]) -> CGFloat {
        halte.isEmpty ? 0 : 12 + HalteKachel.hoehe(anzahl: halte.count, offen: halteOffen.contains(id))
    }

    private func halteKachel(_ id: UUID, _ halte: [DienstreiseVerbindung.Zwischenhalt], status: String, abfahrt: String) -> some View {
        HalteKachel(halte: halte, status: status, abfahrt: abfahrt, jetzt: jetzt,
                    offen: Binding(get: { halteOffen.contains(id) },
                                   set: { if $0 { halteOffen.insert(id) } else { halteOffen.remove(id) } }))
    }

    /// Abschnittszeile: Abfahrt (verspaetet Orange mit Kachel „+5“, sonst Lime), dann Start → Ziel.
    private func abschnittWert(_ zeit: String, spaet: Int, _ text: String) -> some View {
        HStack(spacing: 6) {
            Text(zeit).foregroundStyle(spaet > 0 ? ReiseFarben.orange : formularLime).fixedSize()
            if spaet != 0 { VerspaetungKachel(minuten: spaet) }
            Text(text).foregroundStyle(formularLime).lineLimit(1)
        }
        .font(.grotesk(16, .medium)).tracking(0.5)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .contentShape(Rectangle())
    }

    private func inhalt(_ r: DispoDienstreiseSpeicher.Reise) -> some View {
        let alle = r.fahrer.count + neue.count
        // Mit Umstiegen: je Abschnitt eine Zeile (Nummer | Zeit Start → Ziel), sonst Start, Ziel, Nummer wie bisher.
        let teile = r.abschnitte.count > 1 ? r.abschnitte : nil
        // Je Abschnitt Zeile plus ggf. Halte-Kachel darunter (aufgeklappt hoeher).
        var abschnittOben: [CGFloat] = []
        var y: CGFloat = 342
        for a in teile ?? [] {
            abschnittOben.append(y)
            y += reiseSchritt + halteExtra(a.id, halte(a))
        }
        let einzelHalte = teile == nil && !r.flug ? (verbindung(r)?.halte ?? []) : []
        let lage = ReiseLage.berechnen(teile: DispoDienstreiseSpeicher.teile(r), liveJe: teile != nil ? liveJe : [r.id: verbindung(r) ?? DienstreiseVerbindung()],
                                       datum: r.datum, standort: nil, jetzt: jetzt)
        let zielOben: CGFloat = teile != nil ? y : 410
        let ticketOben: CGFloat = teile != nil ? zielOben + reiseSchritt : 206 + 5 * reiseSchritt + halteExtra(r.id, einzelHalte)
        let mitTicket = !(r.ticketPfad ?? "").isEmpty
        let fahrerOben: CGFloat = ticketOben + (mitTicket ? reiseSchritt : 0)
        let notizOben = fahrerOben + CGFloat(alle - 1) * reiseSchritt + reiseZeile + 24
        let knopfOben = notizOben + 224 + 24
        let loeschOben = knopfOben + reiseZeile + 16
        let hoehe = loeschOben + reiseZeile + (meldung.isEmpty ? 40 : 70) + 80
        let w = (datum: datum ?? r.datum, zeit: zeit ?? r.startZeit, notiz: notiz ?? (r.notiz ?? ""))
        return Leinwand(basisHoehe: 874, inhaltHoehe: hoehe, mitHintergrund: false) { _ in
            ZStack(alignment: .topLeading) {
                DispoHintergrund().frame(width: 402, height: hoehe)
                ZurueckKnopf(aktion: zurueck).platz(20, 60, 50, 50)
                Text("Dienstreise").font(.grotesk(42, .bold)).foregroundStyle(formularLime).platz(20, 140, 362, 42)

                DatumZeile(wert: Binding(get: { w.datum }, set: { datum = $0 })).platz(20, 206, 362, 56)
                UhrZeile(beschriftung: "Start Zeit", wert: Binding(get: { w.zeit }, set: { zeit = $0 })).platz(20, 274, 362, 56)
                if let teile {
                    ForEach(Array(teile.enumerated()), id: \.element.id) { i, a in
                        let lv = liveJe[a.id]
                        let ab = (lv?.abfahrt).flatMap { $0.isEmpty ? nil : $0 } ?? a.ab_zeit
                        let gleis = (lv?.gleis).flatMap { $0.isEmpty ? nil : $0 } ?? a.gleis_ab
                        let text = "\(a.von_name) → \(a.nach_name)"
                        let oben = i < abschnittOben.count ? abschnittOben[i] : 342
                        FormularZeile(beschriftung: a.nummer.isEmpty ? "Abschnitt \(i + 1)" : a.nummer, wert: "\(ab) \(text)",
                                      eta: gleis.isEmpty ? nil : EtaMarke(text: "Gl. \(gleis)", farbe: 0x868687),
                                      rechts: .pfeil, zuruecksetzen: {}) {
                            abschnittWert(ab, spaet: lv?.abfahrtSpaet ?? 0, text)
                        }
                        .platz(20, oben, 362, 56)
                        let h = halte(a)
                        if !h.isEmpty {
                            halteKachel(a.id, h, status: (lage.map { i < $0.status.count ? $0.status[i] : "offen" } ?? "offen"), abfahrt: ab)
                                .platz(20, oben + reiseSchritt, 362, HalteKachel.hoehe(anzahl: h.count, offen: halteOffen.contains(a.id)))
                        }
                    }
                    nurLesen("Ziel", r.zielName).platz(20, zielOben, 362, 56)
                } else {
                    nurLesen("Start", r.startName).platz(20, 342, 362, 56)
                    nurLesen("Ziel", r.zielName).platz(20, 410, 362, 56)
                    nurLesen(r.flug ? "Flugnummer" : "Zugnummer", r.nummer.isEmpty ? "–" : r.nummer, eta: verbindungMarke(r))
                        .platz(20, 478, 362, 56)
                    if !einzelHalte.isEmpty {
                        let ab = (verbindung(r)?.abfahrt).flatMap { $0.isEmpty ? nil : $0 } ?? r.startZeit
                        halteKachel(r.id, einzelHalte, status: lage?.status.first ?? "offen", abfahrt: ab)
                            .platz(20, 478 + reiseSchritt, 362, HalteKachel.hoehe(anzahl: einzelHalte.count, offen: halteOffen.contains(r.id)))
                    }
                }
                if mitTicket {
                    let name = (r.ticketName ?? "").isEmpty ? "Ticket.pdf" : r.ticketName!
                    FormularZeile(beschriftung: "Ticket", wert: name, rechts: .pfeil, rechtsAktion: { ticketOeffnen(r) },
                                  zuruecksetzen: {}) {
                        ZeilenWert(text: name)
                    }
                    .platz(20, ticketOben, 362, 56)
                }

                ForEach(Array(r.fahrer.enumerated()), id: \.element.driverID) { i, f in
                    let z = DispoDienstreiseSpeicher.zustand(f)
                    FormularZeile(beschriftung: fahrerBeschriftung(i, alle), wert: f.profil?.kurz ?? "Fahrer",
                                  eta: EtaMarke(text: z.text, farbe: z.farbe),
                                  zuruecksetzen: { wegFrage = f }) {
                        ZeilenWert(text: f.profil?.kurz ?? "Fahrer")
                    }
                    .platz(20, fahrerOben + CGFloat(i) * reiseSchritt, 362, 56)
                }
                ForEach(Array(neue.enumerated()), id: \.offset) { j, _ in
                    let i = r.fahrer.count + j
                    FormularZeile(beschriftung: fahrerBeschriftung(i, alle), wert: j < neue.count ? neue[j] : "",
                                  zuruecksetzen: { neueSetzen(j, "") }) {
                        ZeilenEingabe(text: Binding(get: { j < neue.count ? neue[j] : "" }, set: { autoZu = false; neueSetzen(j, $0) }))
                            .focused($fokus, equals: "neu-\(j)")
                    }
                    .platz(20, fahrerOben + CGFloat(i) * reiseSchritt, 362, 56)
                }

                NotizBlock(text: Binding(get: { w.notiz }, set: { notiz = $0 }), fokus: $fokus).platz(0, notizOben, 402, 224)

                FormularSpeichernKnopf(text: speichert ? FahrtText.tr("fahrt.saving") : "Speichern", gesperrt: speichert) {
                    Task { await speichern(r, w) }
                }
                .platz(20, knopfOben, 362, 56)

                Button { loeschFrage = true } label: {
                    Text("Dienstreise löschen").font(.grotesk(16, .medium)).tracking(0.4).foregroundStyle(Color(hex: 0xF55757))
                        .frame(width: 362, height: 56)
                        .background(Color(hex: 0x221313))
                        .overlay(Rectangle().strokeBorder(Color(hex: 0xF55757), lineWidth: 2))
                        .contentShape(Rectangle())
                }
                .buttonStyle(.web)
                .platz(20, loeschOben, 362, 56)

                if !meldung.isEmpty {
                    Text(meldung).font(.grotesk(13, .bold)).foregroundStyle(.white.opacity(0.7))
                        .platz(20, loeschOben + reiseZeile + 12, 362, nil)
                }

                if let f = fokus, f.hasPrefix("neu-"), !autoZu, let j = Int(f.dropFirst(4)), j < neue.count {
                    let treffer = fahrerTreffer(neue[j], fahrerListe)
                    if !treffer.isEmpty {
                        VorschlagListe(eintraege: treffer) { n in
                            autoZu = true
                            neueSetzen(j, treffer[n])
                        }
                        .platz(20, fahrerOben + CGFloat(r.fahrer.count + j) * reiseSchritt + reiseZeile + 4, 362, nil)
                    }
                }
            }
        }
        .scrollDismissesKeyboard(.interactively)
    }

    /// Ticket ansehen (signierter Link, gilt 1 Stunde).
    private func ticketOeffnen(_ r: DispoDienstreiseSpeicher.Reise) {
        Task {
            if let url = await DienstreiseTicket.link(r.ticketPfad) { oeffnenURL(url) }
            else { meldung = "Ticket konnte nicht geöffnet werden." }
        }
    }

    /// Nur lesen: Pfeil rechts statt Leeren (rightAction pfeil im Web).
    private func nurLesen(_ beschriftung: String, _ wert: String, eta: EtaMarke? = nil) -> some View {
        FormularZeile(beschriftung: beschriftung, wert: wert, eta: eta, rechts: .pfeil, zuruecksetzen: {}) {
            ZeilenWert(text: wert)
        }
    }

    private func neueSetzen(_ j: Int, _ wert: String) {
        var n = neue
        if j < n.count { n[j] = wert }
        let gefuellt = n.enumerated().filter { !FahrtText.getrimmt($0.element).isEmpty || $0.offset == j }.map(\.element)
        neue = gefuellt.last.map { FahrtText.getrimmt($0).isEmpty } == true ? gefuellt : gefuellt + [""]
    }

    private func speichern(_ r: DispoDienstreiseSpeicher.Reise, _ w: (datum: String, zeit: String, notiz: String)) async {
        speichert = true
        meldung = ""
        defer { speichert = false }
        let neuDatum = w.datum != r.datum ? w.datum : nil
        let neuZeit = w.zeit != r.startZeit ? w.zeit : nil
        let neuNotiz: String?? = w.notiz != (r.notiz ?? "") ? .some(w.notiz.isEmpty ? nil : w.notiz) : nil
        let e = await speicher.aendern(r.id, datum: neuDatum, startZeit: neuZeit, notiz: neuNotiz)
        if !e.isEmpty { meldung = "Nicht gespeichert: \(e)"; return }
        let namen = neue.map(FahrtText.getrimmt).filter { !$0.isEmpty }
        if !namen.isEmpty {
            if fahrer.isEmpty { fahrer = await FahrtSpeichern.fahrerLaden() }
            var ids: [UUID] = []
            for n in namen {
                guard let id = FahrtSpeichern.fahrerID(n, fahrer) else { meldung = "Fahrer „\(n)“ nicht gefunden."; return }
                ids.append(id)
            }
            let f = await speicher.fahrerDazu(r.id, ids)
            if !f.isEmpty { meldung = "Fahrer nicht gespeichert: \(f)"; return }
        }
        datum = nil; zeit = nil; notiz = nil
        neue = [""]
        meldung = neuDatum != nil || neuZeit != nil ? "Gespeichert, die Fahrer bestätigen die neue Zeit." : "Gespeichert."
        await speicher.laden()
    }
}

// MARK: - Kacheln in Alle Fahrten (DienstreiseKacheln.jsx)

/// Je Dienstreise eine Kachel: Start → Ziel, Tag und Startzeit, Zug/Flug, wie viele Fahrer angenommen haben.
struct DienstreiseKacheln: View {
    @ObservedObject var speicher: DispoDienstreiseSpeicher
    let oeffnen: (UUID) -> Void
    var body: some View {
        let aktuell = speicher.aktuelle
        if !aktuell.isEmpty {
            VStack(spacing: 12) {
                ForEach(aktuell) { r in
                    let ja = r.fahrer.filter { $0.status == "accepted" }.count
                    let nein = r.fahrer.filter { $0.status == "refused" }.count
                    Button { oeffnen(r.id) } label: {
                        ZStack(alignment: .top) {
                            VStack(alignment: .leading, spacing: 0) {
                                Text("\(r.startName) → \(r.zielName)").font(.grotesk(22, .bold)).foregroundStyle(.white)
                                    .multilineTextAlignment(.leading)
                                    .fixedSize(horizontal: false, vertical: true)
                                Text("\(StandbyZeit.tagKurz(r.datum)) \(r.startZeit)").font(.grotesk(30, .bold))
                                    .foregroundStyle(DispoDienstreiseSpeicher.lime).lineLimit(1).minimumScaleFactor(0.7)
                                    .frame(height: 34)
                                Text("\(r.nummer.isEmpty ? "" : "\(r.nummer) · ")\(ja)/\(r.fahrer.count) angenommen\(nein > 0 ? " · \(nein) abgelehnt" : "")")
                                    .font(.grotesk(13, .bold)).foregroundStyle(DispoDienstreiseSpeicher.grau)
                                    .lineLimit(2).padding(.top, 6)
                            }
                            .padding(.horizontal, 16).padding(.top, 44).padding(.bottom, 14)
                            .frame(width: 362, alignment: .leading)
                            HStack(spacing: 8) {
                                Text("Dienstreise").font(.grotesk(16, .bold)).foregroundStyle(.black)
                                Image("Rollkoffer_Trisar_Icons_01").resizable().scaledToFit().frame(width: 16, height: 16)
                            }
                            .padding(.horizontal, 16).frame(height: 30).background(DispoDienstreiseSpeicher.lime)
                        }
                        .frame(width: 362)
                        .background(Color(hex: 0x1A1A1A))
                        .overlay(Rectangle().strokeBorder(DispoDienstreiseSpeicher.lime, lineWidth: 2))
                    }
                    .buttonStyle(.web)
                }
            }
        }
    }
}
