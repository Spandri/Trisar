import SwiftUI

/// „Fahrt erstellen“ (FahrtAdd.jsx, fahrtID nil) und „Fahrt bearbeiten“ (FahrtBearbeitenView.jsx).
/// Beim Bearbeiten wird die Fahrt erst geladen (im Web kommt sie fertig aus der Fahrtenliste).
struct FahrtFormularAnsicht: View {
    let fahrtID: UUID?
    let zurueck: () -> Void
    /// Navileiste beim Anlegen und Ziel nach dem Anlegen (setView('ankuenfte') = Fahrten).
    var zeigen: ((DispoZiel) -> Void)?

    @State private var geladen: GeladeneFahrt?
    @State private var ladeFehler: String?

    var body: some View {
        if let fahrtID {
            if let geladen {
                FahrtFormularInhalt(geladen: geladen, zurueck: zurueck, zeigen: zeigen)
            } else {
                ZStack(alignment: .topLeading) {
                    Leinwand(basisHoehe: 874, mitHintergrund: false) { rahmen in
                        ZStack(alignment: .topLeading) {
                            DispoHintergrund().frame(width: 402, height: rahmen)
                            ZurueckKnopf(aktion: zurueck).platz(20, 60, 50, 50)
                            if let ladeFehler {
                                WebText(text: ladeFehler, groesse: 16, gewicht: .medium, zeilenHoehe: 24, farbe: UIColor(hex: 0xF55757))
                                    .platz(20, 140, 362, nil)
                            } else {
                                ProgressView().tint(formularLime).platz(20, 140, 40, 40)
                            }
                        }
                    }
                    FussleisteUnten()
                }
                .task(id: fahrtID) {
                    do { geladen = try await FahrtSpeichern.laden(fahrtID) } catch { ladeFehler = error.localizedDescription }
                }
            }
        } else {
            FahrtFormularInhalt(geladen: nil, zurueck: zurueck, zeigen: zeigen)
        }
    }
}

private enum ZeilenArt { case adresse, text, zahl, auswahl, fahrer, gast }

private struct ZeilenDaten: Identifiable {
    let id: String
    let beschriftung: String
    let art: ZeilenArt
    var index = 0
}

/// Schluessel fuer die Flugpruefung (Abhaengigkeiten des useEffect im Web).
private struct FlugAnfrage: Equatable {
    let nummer: String, datum: String, start: String, flughafen: String, ankunft: String, uebernommen: String
}

private struct ZugAnfrage: Equatable {
    let nummer: String, datum: String, start: String, uebernommen: String
}

private struct FahrtFormularInhalt: View {
    let geladen: GeladeneFahrt?
    let zurueck: () -> Void
    let zeigen: ((DispoZiel) -> Void)?

    // Raster aus FahrtAdd.jsx: Titel 140, Felder ab 206, Reihen alle 68, Zeilenhoehe 56.
    private let reihenStart: CGFloat = 410
    private let schritt: CGFloat = 68
    private let zeilenHoehe: CGFloat = 56

    @State private var werte: FahrtFormularWerte
    @State private var notiz: String
    @State private var fahrerNamen: [String]
    @State private var gaesteNamen: [String]
    @State private var speichert = false

    @State private var vorschlaege: [String: [String]] = ["start": [], "ziel": []]
    @State private var aktivesAdressFeld: String?
    @State private var vorschlagLauf: Task<Void, Never>?
    @State private var vorschlagNr = 0

    @State private var flugEta = EtaMarke()
    @State private var flugPruefung = FahrtPruefung.Anzeige.leer
    @State private var flugUebernommen = ""
    @State private var flugKandidaten: [FahrtPruefung.FlugKandidat] = []
    @State private var kandidatenOffen = false
    @State private var flughafenWahl = ""
    @State private var ankunftWahl = ""
    @State private var zugEta = EtaMarke()
    @State private var zugPruefung = FahrtPruefung.Anzeige.leer
    @State private var zugUebernommen = ""

    @State private var fahrerListe: [String] = []
    @State private var gastListe: [String] = []
    @State private var listenLaden = true
    @State private var autoListeZu = false

    @State private var datumOffen = false
    @State private var zeitOffen = false
    @State private var meldung: String?
    @State private var stornoFrage = false
    @State private var tastatur: CGFloat = 0
    /// Sammel-Import (setView('importFahrten')), als Vollbild ueber dem Formular.
    @State private var importOffen = false
    @FocusState private var fokus: String?
    /// Hoehe des unsichtbaren Rollankers (siehe zumFeldRollen).
    @State private var rollAnker: CGFloat = 1
    // Risiko je Fahrt (nur an Tagen, die die Engine gerechnet hat, siehe NebenRisikoSpeicher).
    @ObservedObject private var risiko = NebenRisikoSpeicher.geteilt
    @State private var risikoHoehe: CGFloat = 0

    init(geladen: GeladeneFahrt?, zurueck: @escaping () -> Void, zeigen: ((DispoZiel) -> Void)?) {
        self.geladen = geladen
        self.zurueck = zurueck
        self.zeigen = zeigen
        _werte = State(initialValue: geladen?.werte ?? FahrtFormularWerte())
        _notiz = State(initialValue: geladen?.notiz ?? "")
        let fahrer = geladen?.fahrerNamen ?? []
        _fahrerNamen = State(initialValue: fahrer.isEmpty ? [""] : fahrer)
        _gaesteNamen = State(initialValue: FahrtText.gaesteTeilen(geladen?.fahrgaeste) + [""])
    }

    private var bearbeiten: Bool { geladen != nil }

    /// Datum der geladenen Fahrt (wie initialData.datum im Web, nicht der Formularwert).
    private var risikoDatum: String { FahrtText.fahrtDatum(geladen?.werte.datum) }

    /// Wie risikoFahrt(risikoDaten, risikoDatum, rideId) in FahrtBearbeitenView. Im Web nur in
    /// der Demo, hier nur wenn risiko-ergebnisse.json im Bundle liegt, live also nie.
    private var risikoFahrt: NebenRisikoFahrt? {
        guard let geladen, !risikoDatum.isEmpty else { return nil }
        return risiko.fahrt(risikoDatum, rideID: geladen.id.uuidString.lowercased())
    }
    private func t(_ k: String, _ w: [String: String] = [:]) -> String { FahrtText.tr(k, w) }

    // MARK: Abgeleitete Werte

    private var mitFahrzeugen: Bool { !FahrtText.getrimmt(werte.konvoi).isEmpty }
    private var fahrerAnzahl: Int { mitFahrzeugen ? max(1, Int(werte.anzahlFahrzeuge) ?? 1) : 1 }
    private var gefuellteGaeste: [String] { gaesteNamen.map(FahrtText.getrimmt).filter { !$0.isEmpty } }
    private var flugNr: String { FahrtText.nummer(werte.flugnummer) }
    private var zugNr: String { FahrtText.nummer(werte.zugnummer) }
    private var flugAngewandt: Bool { !flugUebernommen.isEmpty && flugNr == flugUebernommen }
    private var zugAngewandt: Bool { !zugUebernommen.isEmpty && zugNr == zugUebernommen }
    private var kannFlug: Bool { !flugNr.isEmpty && (flugPruefung.gueltig || ["ok", "unknown_eta"].contains(flugPruefung.status)) }
    private var kannZug: Bool { !zugNr.isEmpty && (zugPruefung.gueltig || ["ok", "unknown_eta"].contains(zugPruefung.status)) }

    private var zeilen: [ZeilenDaten] {
        var z: [ZeilenDaten] = [
            .init(id: "ziel", beschriftung: t("fahrt.ziel"), art: .adresse),
            .init(id: "flugnummer", beschriftung: t("fahrt.flugnummer"), art: .text),
            .init(id: "zugnummer", beschriftung: t("fahrt.zugnummer"), art: .text),
            .init(id: "konvoi", beschriftung: t("fahrt.konvoi"), art: .text),
        ]
        if mitFahrzeugen { z.append(.init(id: "anzahlFahrzeuge", beschriftung: t("fahrt.anzahlFahrzeuge"), art: .zahl)) }
        for i in 0..<fahrerAnzahl {
            z.append(.init(id: "fahrer-\(i)", beschriftung: mitFahrzeugen ? t("fahrt.fahrerNumbered", ["n": "\(i + 1)"]) : t("fahrt.fahrer"),
                           art: .fahrer, index: i))
        }
        for (i, name) in gaesteNamen.enumerated() {
            let titel = i == 0
                ? (FahrtText.getrimmt(name).isEmpty ? t("fahrt.fahrgaeste") : t("fahrt.gastNumbered", ["n": "1"]))
                : t("fahrt.gastNumbered", ["n": "\(i + 1)"])
            z.append(.init(id: "fahrgast-\(i)", beschriftung: titel, art: .gast, index: i))
        }
        z.append(.init(id: "anonymeGaeste", beschriftung: t("fahrt.anonymeGaeste"), art: .zahl))
        z.append(.init(id: "anzahlKinder", beschriftung: t("fahrt.anzahlKinder"), art: .zahl))
        z.append(.init(id: "aktuellerStatus", beschriftung: t("fahrt.aktuellerStatus"), art: .auswahl))
        return z
    }

    // MARK: Ansicht

    var body: some View {
        let reihen = zeilen
        let letzteReihe = reihenStart + CGFloat(reihen.count - 1) * schritt
        let risikoTop = letzteReihe + zeilenHoehe + 24
        let risikoDieserFahrt = risikoFahrt
        let notizTop = risikoTop + (risikoDieserFahrt != nil && risikoHoehe > 0 ? risikoHoehe + 24 : 0)
        let knopfTop = notizTop + 224 + 24
        let stornoTop = knopfTop + zeilenHoehe + 12
        let inhaltHoehe = bearbeiten ? stornoTop + zeilenHoehe + 30 + 40 : knopfTop + zeilenHoehe + 30
        // pb-[151px] beim Anlegen: Platz fuer die Navileiste.
        let rollHoehe = (bearbeiten ? inhaltHoehe : inhaltHoehe + 151) + (tastatur > 0 ? tastatur + 40 : 0)

        ZStack(alignment: .topLeading) {
            Leinwand(basisHoehe: 874, inhaltHoehe: rollHoehe, mitHintergrund: false) { _ in
                ScrollViewReader { rollen in
                    ZStack(alignment: .topLeading) {
                        DispoHintergrund().frame(width: 402, height: inhaltHoehe)
                        // Rollanker: beginnt oben bei 0, die Unterkante wird aufs Ziel gesetzt.
                        // scrollTo auf die Felder selbst misst wegen .platz (Abstand statt Versatz)
                        // ab Oberkante 0 und landet deshalb zu weit oben.
                        Color.clear.frame(width: 1, height: rollAnker).allowsHitTesting(false).id("rollAnker")
                        kopf
                        datumZeile.id("datum").platz(20, 206, 362, 56)
                        zeitZeile.id("startZeit").platz(20, 274, 362, 56)
                        startZeile.id("start").platz(20, 342, 362, 56)
                        ForEach(Array(reihen.enumerated()), id: \.element.id) { i, z in
                            zeileAnsicht(z).id(z.id).platz(20, reihenStart + CGFloat(i) * schritt, 362, 56)
                        }
                        if let risikoDieserFahrt {
                            RisikoAbschnitt(fahrt: risikoDieserFahrt,
                                            geplant: NebenRisiko.fahrerPasst(risikoDieserFahrt, geladen?.fahrerNamen ?? []),
                                            verlaeufe: risiko.tag(risikoDatum)?.verlaeufe ?? 500,
                                            hoehe: { risikoHoehe = $0 })
                                .platz(0, risikoTop, 402, nil)
                        }
                        notizBlock.platz(0, notizTop, 402, 224)
                        FormularSpeichernKnopf(text: speichert ? t("fahrt.saving") : t(bearbeiten ? "fahrt.submitEdit" : "fahrt.submitCreate"),
                                               gesperrt: speichert) { Task { await speichern() } }
                            .platz(20, knopfTop, 362, 56)
                        if bearbeiten {
                            stornoKnopf.platz(20, stornoTop, 362, 56)
                        }
                        listen(reihen)
                    }
                    .onChange(of: fokus) { alt, neu in
                        fokusGewechselt(alt, neu)
                        guard let neu else { return }
                        var tops: [String: CGFloat] = ["start": 342, "notiz": notizTop + 40]
                        for (i, z) in reihen.enumerated() { tops[z.id] = reihenStart + CGFloat(i) * schritt }
                        guard let feldTop = tops[neu] else { return }
                        DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) {
                            // Feld bei 35 % der sichtbaren Hoehe ueber der Tastatur.
                            let sichtbar = 874 - tastatur
                            rollAnker = max(1, feldTop + 874 - 0.35 * sichtbar)
                            DispatchQueue.main.async {
                                withAnimation(.easeOut(duration: 0.2)) { rollen.scrollTo("rollAnker", anchor: .bottom) }
                            }
                        }
                    }
                }
            }
            .scrollDismissesKeyboard(.interactively)
            if bearbeiten {
                FussleisteUnten()
            } else {
                Navileiste(aktiv: .fahrtNeu) { ziel in zeigen?(ziel) }
            }
        }
        .onAppear { fahrerZeilenAnpassen() }
        .onChange(of: fahrerAnzahl) { _, _ in fahrerZeilenAnpassen() }
        .onChange(of: gaesteNamen) { _, neu in
            // normalizeGuestRows: gefuellte Zeilen + eine leere. Der Text bleibt beim Tippen ungetrimmt.
            let gefuellt = neu.filter { !FahrtText.getrimmt($0).isEmpty } + [""]
            if gefuellt != neu { gaesteNamen = gefuellt }
        }
        .onChange(of: werte.flugnummer) { _, _ in
            flughafenWahl = ""
            ankunftWahl = ""
            kandidatenOffen = false
        }
        .task(id: FlugAnfrage(nummer: werte.flugnummer, datum: werte.datum, start: werte.start,
                              flughafen: flughafenWahl, ankunft: ankunftWahl, uebernommen: flugUebernommen)) {
            await flugPruefen()
        }
        .task(id: ZugAnfrage(nummer: werte.zugnummer, datum: werte.datum, start: werte.start, uebernommen: zugUebernommen)) {
            await zugPruefen()
        }
        .task {
            async let fahrer = FahrtSpeichern.fahrerLaden()
            async let gaeste = FahrtSpeichern.gaesteLaden()
            fahrerListe = FahrtSpeichern.fahrerVorschlaege(await fahrer)
            gastListe = FahrtSpeichern.gastVorschlaege(await gaeste)
            listenLaden = false
        }
        .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillShowNotification)) { n in
            tastatur = (n.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? CGRect)?.height ?? 0
        }
        .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillHideNotification)) { _ in tastatur = 0 }
        .alert(meldung ?? "", isPresented: Binding(get: { meldung != nil }, set: { if !$0 { meldung = nil } })) {
            Button("OK", role: .cancel) {}
        }
        .alert(t("fahrt.confirmCancelRide"), isPresented: $stornoFrage) {
            Button("Abbrechen", role: .cancel) {}
            Button("OK") { Task { await stornieren() } }
        }
        .fullScreenCover(isPresented: $importOffen) {
            ImportAnsicht(modus: .fahrten, zurueck: { importOffen = false }, zumZiel: {
                importOffen = false
                zeigen?(.fahrten)
            })
        }
    }

    // MARK: Kopf

    private var kopf: some View {
        ZStack(alignment: .topLeading) {
            ZurueckKnopf(aktion: zurueck).platz(20, 60, 50, 50)
            if !bearbeiten {
                // Sammel-Import aus Excel/CSV statt Einzelanlage (setView('importFahrten')).
                Button { importOffen = true } label: {
                    Image("import-fahrten").resizable().frame(width: 42, height: 40).contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Fahrten importieren")
                .platz(402 - 20 - 42, 65, 42, 40)
            }
            WebText(text: t(bearbeiten ? "fahrt.editTitle" : "fahrt.createTitle"), groesse: 42, gewicht: .bold,
                    zeilenHoehe: 42, farbe: UIColor(hex: 0xE3F654))
                .platz(20, 140, bearbeiten ? 400 : 320, nil)
        }
    }

    // MARK: Datum, Zeit, Start

    private var datumZeile: some View {
        FormularZeile(beschriftung: t("fahrt.datum"), wert: werte.datum, zuruecksetzen: { werte.datum = "" }) {
            Button {
                fokus = nil
                // Wie Safari: beim Oeffnen steht sofort der heutige Tag im Feld.
                if werte.datum.isEmpty { werte.datum = FahrtText.heute() }
                datumOffen = true
            } label: { ZeilenWert(text: datumText) }
            .buttonStyle(.plain)
            .popover(isPresented: $datumOffen) {
                DatePicker("", selection: datumBindung, displayedComponents: .date)
                    .datePickerStyle(.graphical).labelsHidden()
                    .environment(\.locale, Locale(identifier: "de_DE"))
                    .tint(Color(hex: 0x0A84FF))
                    .frame(width: 320).padding(8)
                    .presentationCompactAdaptation(.popover)
            }
        }
    }

    private var zeitZeile: some View {
        FormularZeile(beschriftung: t("fahrt.startZeit"), wert: werte.startZeit, zuruecksetzen: { werte.startZeit = "" }) {
            Button {
                fokus = nil
                if FahrtText.uhrzeit(werte.startZeit, "").isEmpty { werte.startZeit = FahrtText.jetztUhr() }
                zeitOffen = true
            } label: { ZeilenWert(text: FahrtText.uhrzeit(werte.startZeit, "")) }
            .buttonStyle(.plain)
            .popover(isPresented: $zeitOffen) {
                DatePicker("", selection: zeitBindung, displayedComponents: .hourAndMinute)
                    .datePickerStyle(.wheel).labelsHidden()
                    .environment(\.locale, Locale(identifier: "de_DE"))
                    .frame(width: 260).padding(8)
                    .presentationCompactAdaptation(.popover)
            }
        }
    }

    private var datumText: String {
        let tag = FahrtText.fahrtDatum(werte.datum)
        let teile = tag.split(separator: "-")
        return teile.count == 3 ? "\(teile[2]).\(teile[1]).\(teile[0])" : ""
    }

    private var datumBindung: Binding<Date> {
        Binding(get: {
            let tag = FahrtText.fahrtDatum(werte.datum)
            return tag.isEmpty ? Date() : Datum.ausTagWert(tag)
        }, set: { werte.datum = Datum.tagWert($0) })
    }

    private var zeitBindung: Binding<Date> {
        Binding(get: {
            guard let m = FahrtText.minuten(werte.startZeit) else { return Date() }
            return Calendar.current.date(bySettingHour: m / 60, minute: m % 60, second: 0, of: Date()) ?? Date()
        }, set: { neu in
            let k = Calendar.current.dateComponents([.hour, .minute], from: neu)
            werte.startZeit = String(format: "%02d:%02d", k.hour ?? 0, k.minute ?? 0)
        })
    }

    private var startZeile: some View {
        FormularZeile(beschriftung: t("fahrt.start"), wert: werte.start, zuruecksetzen: {
            werte.start = ""
            vorschlaege["start"] = []
        }) {
            ZeilenEingabe(text: Binding(get: { werte.start }, set: { adressEingabe($0, "start") }))
                .focused($fokus, equals: "start")
        }
    }

    // MARK: Reihen

    @ViewBuilder private func zeileAnsicht(_ z: ZeilenDaten) -> some View {
        if z.art == .auswahl {
            FormularZeile(beschriftung: z.beschriftung, wert: werte.aktuellerStatus, zuruecksetzen: { werte.aktuellerStatus = "" }) {
                statusMenue
            }
        } else {
            let bindung = bindung(z)
            FormularZeile(beschriftung: z.beschriftung, wert: bindung.wrappedValue,
                          eta: eta(z), etaAktion: etaAktion(z), rechts: rechts(z), rechtsAktion: rechtsAktion(z),
                          zuruecksetzen: { zuruecksetzen(z) }) {
                ZeilenEingabe(text: bindung, tastatur: z.art == .zahl ? .numberPad : .default,
                              platzhalter: listenLaden && z.art == .fahrer ? "Fahrer werden geladen..."
                                  : (listenLaden && z.art == .gast ? "Fahrgäste werden geladen..." : ""))
                    .focused($fokus, equals: z.id)
                    .disabled(listenLaden && (z.art == .fahrer || z.art == .gast))
            }
        }
    }

    private static let statusWerte = ["offen", "beendet", "stoniert", "unterwegs"]

    private func statusText(_ w: String) -> String {
        switch w {
        case "offen": return t("fahrt.statusOffen")
        case "beendet": return t("fahrt.statusBeendet")
        case "stoniert": return t("fahrt.statusStoniert")
        case "unterwegs": return t("fahrt.statusUnterwegs")
        default: return w
        }
    }

    private var statusMenue: some View {
        Menu {
            Button("–") { werte.aktuellerStatus = "" }
            ForEach(Self.statusWerte, id: \.self) { w in
                Button(statusText(w)) { werte.aktuellerStatus = w }
            }
        } label: {
            ZeilenWert(text: statusText(werte.aktuellerStatus))
        }
        .menuIndicator(.hidden)
        .buttonStyle(.plain)
    }

    private let pfade: [String: WritableKeyPath<FahrtFormularWerte, String>] = [
        "ziel": \.ziel, "flugnummer": \.flugnummer, "zugnummer": \.zugnummer, "konvoi": \.konvoi,
        "anzahlFahrzeuge": \.anzahlFahrzeuge, "anonymeGaeste": \.anonymeGaeste, "anzahlKinder": \.anzahlKinder,
    ]

    private func bindung(_ z: ZeilenDaten) -> Binding<String> {
        switch z.art {
        case .fahrer:
            return Binding(get: { z.index < fahrerNamen.count ? fahrerNamen[z.index] : "" }, set: { neu in
                autoListeZu = false
                if z.index < fahrerNamen.count { fahrerNamen[z.index] = neu }
            })
        case .gast:
            return Binding(get: { z.index < gaesteNamen.count ? gaesteNamen[z.index] : "" }, set: { neu in
                autoListeZu = false
                if z.index < gaesteNamen.count { gaesteNamen[z.index] = neu }
            })
        default:
            guard let pfad = pfade[z.id] else { return .constant("") }
            return Binding(get: { werte[keyPath: pfad] }, set: { neu in aendern(z, neu) })
        }
    }

    /// onChange der Reihen im Web.
    private func aendern(_ z: ZeilenDaten, _ roh: String) {
        let neu = z.art == .zahl ? roh.filter(\.isNumber) : roh
        switch z.id {
        case "ziel":
            adressEingabe(neu, "ziel")
        case "konvoi":
            if FahrtText.getrimmt(neu).isEmpty {
                werte.konvoi = ""
                werte.anzahlFahrzeuge = ""
            } else {
                werte.konvoi = neu
            }
        default:
            if z.id == "flugnummer" { flugUebernommen = "" }
            if z.id == "zugnummer" { zugUebernommen = "" }
            if let pfad = pfade[z.id] { werte[keyPath: pfad] = neu }
        }
    }

    private func zuruecksetzen(_ z: ZeilenDaten) {
        switch z.art {
        case .fahrer: if z.index < fahrerNamen.count { fahrerNamen[z.index] = "" }
        case .gast: if z.index < gaesteNamen.count { gaesteNamen[z.index] = "" }
        default:
            switch z.id {
            case "ziel":
                werte.ziel = ""
                vorschlaege["ziel"] = []
            case "konvoi":
                werte.konvoi = ""
                werte.anzahlFahrzeuge = ""
            default:
                if z.id == "flugnummer" { flugUebernommen = "" }
                if z.id == "zugnummer" { zugUebernommen = "" }
                if let pfad = pfade[z.id] { werte[keyPath: pfad] = "" }
            }
        }
    }

    private func eta(_ z: ZeilenDaten) -> EtaMarke? {
        if z.id == "flugnummer" && !flugNr.isEmpty { return flugEta }
        if z.id == "zugnummer" && !zugNr.isEmpty { return zugEta }
        return nil
    }

    private func etaAktion(_ z: ZeilenDaten) -> (() -> Void)? {
        guard z.id == "flugnummer", flugEta.text == "Multi", !flugKandidaten.isEmpty else { return nil }
        return { kandidatenOffen.toggle() }
    }

    private func rechts(_ z: ZeilenDaten) -> RechtsArt? {
        switch z.id {
        case "flugnummer": return flugAngewandt ? .kreuz : (kannFlug ? .haken : .pfeil)
        case "zugnummer": return zugAngewandt ? .kreuz : (kannZug ? .haken : .pfeil)
        default: return nil
        }
    }

    private func rechtsAktion(_ z: ZeilenDaten) -> (() -> Void)? {
        switch z.id {
        case "flugnummer": return { flugAnwenden() }
        case "zugnummer": return { zugAnwenden() }
        default: return nil
        }
    }

    private func fahrerZeilenAnpassen() {
        let n = fahrerAnzahl
        if fahrerNamen.count < n {
            fahrerNamen += Array(repeating: "", count: n - fahrerNamen.count)
        } else if fahrerNamen.count > n {
            fahrerNamen = Array(fahrerNamen.prefix(n))
        }
    }

    // MARK: Listen (Adressen, Fluege, Fahrer, Gaeste)

    @ViewBuilder private func listen(_ reihen: [ZeilenDaten]) -> some View {
        if aktivesAdressFeld == "start", let liste = vorschlaege["start"], !liste.isEmpty {
            VorschlagListe(eintraege: liste) { i in adresseWaehlen(liste[i], "start") }
                .platz(20, 342 + zeilenHoehe + 4, 362, nil)
        }
        if kandidatenOffen, !flugKandidaten.isEmpty, let i = reihen.firstIndex(where: { $0.id == "flugnummer" }) {
            VorschlagListe(eintraege: flugKandidaten.enumerated().map { n, k in kandidatText(k, n) }, kopf: kandidatenKopf,
                           maxHoehe: 220) { n in kandidatWaehlen(flugKandidaten[n]) }
                .platz(20, reihenStart + CGFloat(i) * schritt + zeilenHoehe + 4, 362, nil)
        }
        if aktivesAdressFeld == "ziel", let liste = vorschlaege["ziel"], !liste.isEmpty {
            VorschlagListe(eintraege: liste) { i in adresseWaehlen(liste[i], "ziel") }
                .platz(20, reihenStart + zeilenHoehe + 4, 362, nil)
        }
        if let fokus, !autoListeZu, let i = reihen.firstIndex(where: { $0.id == fokus }),
           reihen[i].art == .fahrer || reihen[i].art == .gast {
            let z = reihen[i]
            let treffer = autoTreffer(bindung(z).wrappedValue, z.art == .fahrer ? fahrerListe : gastListe)
            if !treffer.isEmpty {
                VorschlagListe(eintraege: treffer) { n in
                    autoListeZu = true
                    if z.art == .fahrer, z.index < fahrerNamen.count { fahrerNamen[z.index] = treffer[n] }
                    if z.art == .gast, z.index < gaesteNamen.count { gaesteNamen[z.index] = treffer[n] }
                }
                .platz(20, reihenStart + CGFloat(i) * schritt + zeilenHoehe + 4, 362, nil)
            }
        }
    }

    /// Vorschlaege wie das datalist im Web: enthaltene Treffer, nichts mehr wenn der Name vollstaendig dasteht.
    private func autoTreffer(_ wert: String, _ liste: [String]) -> [String] {
        let suche = FahrtText.vergleichbar(wert)
        if suche.isEmpty { return [] }
        let treffer = liste.filter { FahrtText.vergleichbar($0).contains(suche) }
        if treffer.contains(where: { FahrtText.vergleichbar($0) == suche }) { return [] }
        return treffer
    }

    private func fokusGewechselt(_ alt: String?, _ neu: String?) {
        if neu == "start" || neu == "ziel" { aktivesAdressFeld = neu }
        if let alt, alt == "start" || alt == "ziel", neu != alt {
            // onBlur mit 120 ms Verzoegerung wie im Web.
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.12) {
                if aktivesAdressFeld == alt { aktivesAdressFeld = nil }
            }
        }
        if neu != nil { autoListeZu = false }
    }

    /// fetchAddressPredictions: 250 ms warten, nur das juengste Ergebnis zaehlt.
    private func adressEingabe(_ text: String, _ feld: String) {
        if feld == "start" { werte.start = text } else { werte.ziel = text }
        vorschlagLauf?.cancel()
        let suche = FahrtText.getrimmt(text)
        if suche.isEmpty {
            vorschlaege[feld] = []
            if aktivesAdressFeld == feld { aktivesAdressFeld = nil }
            return
        }
        aktivesAdressFeld = feld
        vorschlagNr += 1
        let nr = vorschlagNr
        vorschlagLauf = Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(250))
            if Task.isCancelled { return }
            let treffer = await FahrtPruefung.ortsVorschlaege(suche)
            guard nr == vorschlagNr else { return }
            vorschlaege[feld] = treffer
        }
    }

    private func adresseWaehlen(_ wert: String, _ feld: String) {
        if feld == "start" { werte.start = wert } else { werte.ziel = wert }
        vorschlaege[feld] = []
        aktivesAdressFeld = nil
    }

    private var kandidatenKopf: String {
        let roh = FahrtText.getrimmt(werte.datum)
        let iso = FahrtText.fahrtDatum(roh).count == 10 && !roh.contains("T") ? FahrtText.fahrtDatum(roh) : ""
        let passt = !iso.isEmpty && flugKandidaten.contains { $0.ankunftGeplant.hasPrefix(iso) }
        return passt ? t("fahrt.multipleFlightsFound") : t("fahrt.noFlightDataForDate", ["date": roh.isEmpty ? t("fahrt.datum") : roh])
    }

    /// formatFlightCandidateLabel: "MUC → HAM · Ankunft 04.11. 14:30".
    private func kandidatText(_ k: FahrtPruefung.FlugKandidat, _ n: Int) -> String {
        let route = [k.abflug, k.ankunft].filter { !$0.isEmpty }.joined(separator: " → ")
        var tag = "", zeit = ""
        let s = k.ankunftGeplant
        if s.range(of: #"^\d{4}-\d{2}-\d{2}"#, options: .regularExpression) != nil {
            let teile = s.prefix(10).split(separator: "-")
            tag = "\(teile[2]).\(teile[1])."
        }
        if let r = s.range(of: #"T\d{2}:\d{2}"#, options: .regularExpression) { zeit = String(s[r].dropFirst()) }
        let ankunft = [tag, zeit].filter { !$0.isEmpty }.joined(separator: " ")
        let text = [route, ankunft.isEmpty ? "" : t("fahrt.arrivalLabel", ["time": ankunft])].filter { !$0.isEmpty }.joined(separator: " · ")
        return text.isEmpty ? t("fahrt.flightNumbered", ["n": "\(n + 1)"]) : text
    }

    private func kandidatWaehlen(_ k: FahrtPruefung.FlugKandidat) {
        let flughafen = FahrtText.getrimmt(k.ankunft).uppercased()
        let geplant = FahrtText.getrimmt(k.ankunftGeplant)
        if !flughafen.isEmpty { flughafenWahl = flughafen }
        if !geplant.isEmpty { ankunftWahl = geplant }
        flugEta = EtaMarke(text: "…", farbe: 0x808080)
        kandidatenOffen = false
    }

    // MARK: Flug / Zug

    /// gespeicherteZeitFuer: Zeit der Fahrt zeigen, solange die Nummer unveraendert ist (nur Bearbeiten).
    private func gespeicherteZeit(_ nummer: String, _ gespeichert: String?) -> String {
        let n = FahrtText.nummer(nummer)
        guard !n.isEmpty, n == FahrtText.nummer(gespeichert) else { return "" }
        return FahrtText.uhrzeit(geladen?.werte.startZeit, "")
    }

    private func flugPruefen() async {
        let wert = FahrtText.getrimmt(werte.flugnummer)
        if wert.isEmpty {
            flugEta = EtaMarke()
            flugPruefung = .leer
            flugUebernommen = ""
            flugKandidaten = []
            kandidatenOffen = false
            return
        }
        try? await Task.sleep(for: .milliseconds(350))
        if Task.isCancelled { return }
        let r = await FahrtPruefung.flugAnzeige(wert, datum: werte.datum, hinweis: flughafenWahl.isEmpty ? werte.start : flughafenWahl,
                                                ankunftGeplant: ankunftWahl)
        if Task.isCancelled { return }
        flugPruefung = r
        if r.status == "multi" {
            flugKandidaten = r.kandidaten
        } else {
            flugKandidaten = []
            kandidatenOffen = false
        }
        let eta = FahrtText.getrimmt(r.etaLabel)
        if r.status == "ok" && !eta.isEmpty {
            flugEta = EtaMarke(text: eta, farbe: 0x808080)
        } else if r.status == "multi" {
            flugEta = EtaMarke(text: "Multi", farbe: 0xF55757)
        } else if r.status == "unavailable" && !bearbeiten {
            flugEta = EtaMarke(text: eta.isEmpty ? "" : "Srv", farbe: 0xFFB84D)
        } else if r.status == "unavailable" && eta.isEmpty {
            flugEta = EtaMarke(text: gespeicherteZeit(wert, geladen?.werte.flugnummer), farbe: 0x808080)
        } else {
            flugEta = EtaMarke(text: eta.isEmpty ? "NaN" : eta, farbe: 0xF55757)
        }
        if !flugUebernommen.isEmpty && FahrtText.nummer(wert) != flugUebernommen { flugUebernommen = "" }
    }

    private func zugPruefen() async {
        let wert = FahrtText.getrimmt(werte.zugnummer)
        if wert.isEmpty {
            zugEta = EtaMarke()
            zugPruefung = .leer
            zugUebernommen = ""
            return
        }
        try? await Task.sleep(for: .milliseconds(350))
        if Task.isCancelled { return }
        let r = await FahrtPruefung.zugAnzeige(wert, datum: werte.datum, hinweis: werte.start)
        if Task.isCancelled { return }
        zugPruefung = r
        let eta = FahrtText.getrimmt(r.etaLabel)
        if r.status == "ok" && !eta.isEmpty {
            zugEta = EtaMarke(text: eta, farbe: 0x808080)
        } else if r.status == "unavailable" {
            zugEta = EtaMarke(text: bearbeiten ? gespeicherteZeit(wert, geladen?.werte.zugnummer) : "", farbe: 0x808080)
        } else if r.status == "multi" {
            zugEta = EtaMarke(text: "Multi", farbe: 0xF55757)
        } else {
            zugEta = EtaMarke(text: "NaN", farbe: 0xF55757)
        }
        if !zugUebernommen.isEmpty && FahrtText.nummer(wert) != zugUebernommen { zugUebernommen = "" }
    }

    /// handleFlightAction: Haken uebernimmt ETA und Ankunftsort, Kreuz leert die Flugnummer.
    private func flugAnwenden() {
        if flugAngewandt {
            flugUebernommen = ""
            werte.flugnummer = ""
            return
        }
        guard kannFlug else { return }
        let eta = FahrtText.getrimmt(flugPruefung.etaLabel)
        let ort = FahrtText.getrimmt(flugPruefung.startOrt)
        let zeit = !eta.isEmpty && eta != "NaN" ? eta : ""
        if zeit.isEmpty && ort.isEmpty {
            meldung = t("fahrt.flightMissingEta")
            return
        }
        if !zeit.isEmpty { werte.startZeit = zeit }
        if !ort.isEmpty { werte.start = ort }
        flugUebernommen = flugNr
    }

    private func zugAnwenden() {
        if zugAngewandt {
            zugUebernommen = ""
            werte.zugnummer = ""
            return
        }
        guard kannZug else { return }
        let eta = FahrtText.getrimmt(zugPruefung.etaLabel)
        let ort = FahrtText.getrimmt(zugPruefung.startOrt)
        let zeit = !eta.isEmpty && eta != "NaN" ? eta : ""
        if zeit.isEmpty && ort.isEmpty {
            meldung = t("fahrt.trainMissingEta")
            return
        }
        if !zeit.isEmpty { werte.startZeit = zeit }
        if !ort.isEmpty { werte.start = ort }
        zugUebernommen = zugNr
    }

    // MARK: Notizen und Knoepfe

    /// Notes Section: #1a1a1a, rounded 12, darin weisses Blatt mit 20 Rand.
    private var notizBlock: some View {
        ZStack(alignment: .topLeading) {
            RoundedRectangle(cornerRadius: 12).fill(Color(hex: 0x1A1A1A)).frame(width: 402, height: 224)
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Text(t("fahrt.notizen")).font(.grotesk(16, .bold)).tracking(0.5).foregroundStyle(Color(hex: 0x1D1C1D))
                    Spacer()
                    Image("Arrow-kurz_Trisar_Icons_01_Lime").resizable().frame(width: 10, height: 13)
                }
                TextField("", text: $notiz,
                          prompt: Text(t("fahrt.notesPlaceholder")).foregroundStyle(Color(hex: 0x818181, alpha: 0.25)),
                          axis: .vertical)
                    .font(.grotesk(14)).tracking(0.25)
                    .foregroundStyle(Color(hex: 0x818181, alpha: 0.5))
                    .tint(Color(hex: 0x818181))
                    .focused($fokus, equals: "notiz")
                    .frame(maxHeight: .infinity, alignment: .topLeading)
            }
            .padding(16)
            .frame(width: 362, height: 184, alignment: .topLeading)
            .background(Color.white)
            .clipped()
            .contentShape(Rectangle())
            .onTapGesture { fokus = "notiz" }
            .platz(20, 20, 362, 184)
        }
        .id("notiz")
    }

    private var stornoKnopf: some View {
        Button { stornoFrage = true } label: {
            Text(t("fahrt.cancelRide")).font(.grotesk(16, .medium)).tracking(0.4).foregroundStyle(Color(hex: 0xF55757))
                .frame(width: 362, height: 56)
                .background(Color(hex: 0x221313))
                .overlay(Rectangle().strokeBorder(Color(hex: 0xF55757), lineWidth: 2))
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    // MARK: Speichern

    private func speichern() async {
        if speichert { return }
        if bearbeiten { await aenderungSpeichern() } else { await anlegen() }
    }

    /// handleCreateRide aus FahrtAdd.jsx.
    private func anlegen() async {
        if FahrtText.getrimmt(werte.start).isEmpty || FahrtText.getrimmt(werte.ziel).isEmpty {
            meldung = t("fahrt.fillStartZiel")
            return
        }
        speichert = true
        var w = werte
        w.anonymeGaeste = w.anonymeGaeste.isEmpty ? "0" : w.anonymeGaeste
        let ergebnis = await FahrtSpeichern.anlegen(FahrtEingabe(
            werte: w, fahrgaeste: gefuellteGaeste.joined(separator: "; "), fahrerNamen: fahrerNamen,
            flugZielFlughafen: flughafenWahl, flugAnkunftGeplant: ankunftWahl, notiz: notiz))
        speichert = false
        if !ergebnis.ok {
            meldung = t("fahrt.saveError", ["error": ergebnis.fehler ?? t("fahrt.unknownError")])
            return
        }
        if let zeigen { zeigen(.fahrten) } else { zurueck() }
    }

    /// handleSave aus FahrtBearbeitenView.jsx.
    private func aenderungSpeichern() async {
        guard let geladen else { return }
        let mitKolonne = mitFahrzeugen
        let plaetze = mitKolonne ? max(1, Int(FahrtText.getrimmt(werte.anzahlFahrzeuge)) ?? 1) : 1
        var namen = Array(fahrerNamen.map(FahrtText.getrimmt).prefix(plaetze))
        while namen.count < plaetze { namen.append("") }
        var w = werte
        w.konvoi = mitKolonne ? FahrtText.getrimmt(werte.konvoi) : ""
        w.anzahlFahrzeuge = mitKolonne ? FahrtText.getrimmt(werte.anzahlFahrzeuge) : ""
        w.anonymeGaeste = w.anonymeGaeste.isEmpty ? "0" : w.anonymeGaeste
        speichert = true
        let ergebnis = await FahrtSpeichern.aendern(FahrtEingabe(
            werte: w, fahrgaeste: gefuellteGaeste.joined(separator: "; "), fahrerNamen: namen,
            flugZielFlughafen: flughafenWahl, flugAnkunftGeplant: ankunftWahl, notiz: notiz), geladen: geladen)
        speichert = false
        if !ergebnis.ok {
            meldung = t("fahrt.saveError", ["error": ergebnis.fehler ?? t("fahrt.unknownError")])
            return
        }
        zurueck()
    }

    /// handleCancelRide: nach Rueckfrage loeschen (handleDeleteRide).
    private func stornieren() async {
        guard let geladen else { return }
        let ergebnis = await FahrtSpeichern.loeschen(geladen.id)
        if !ergebnis.ok {
            meldung = ergebnis.fehler
            return
        }
        zurueck()
    }
}
