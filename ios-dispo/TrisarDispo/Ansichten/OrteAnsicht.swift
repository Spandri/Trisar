import CoreLocation
import SwiftUI

// Eigene Orte im Karten Filter: Standard-Radien, Liste der Orte, "Ort hinzufuegen" und der Editor.

/// Welcher Ort im Editor offen ist (nil = neuer Ort).
struct OrtEditorZiel: Identifiable {
    let id = UUID()
    let ort: EigenerOrt?
}

/// Bereich "Orte" im Karten Filter (unter "Punkte bei Fahrt").
struct OrteAbschnitt: View {
    @ObservedObject var orte: OrteSpeicher
    let bearbeiten: (EigenerOrt?) -> Void

    @State private var reinText = ""
    @State private var rausText = ""
    @State private var hinweis: String?
    @State private var gespeichert = false
    @FocusState private var fokus: Bool
    private static let lime = Color(hex: 0xE3F654)

    /// Hoehe im Raster: Titel, Standard-Felder, Hinweis, Liste (je 68) und "Ort hinzufuegen".
    static func hoehe(anzahl: Int) -> CGFloat { 24 + 8 + 56 + 8 + 20 + 16 + CGFloat(anzahl) * 68 + 56 }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("Orte").grotesk(16, .medium, abstand: 0.5)
                .foregroundStyle(Self.lime.opacity(0.6))
                .frame(height: 24)

            HStack(spacing: 12) {
                RadiusFeld(titel: "Rein", text: $reinText).focused($fokus)
                RadiusFeld(titel: "Raus", text: $rausText).focused($fokus)
            }
            .padding(.top, 8)

            Group {
                if let hinweis {
                    Text(hinweis).foregroundStyle(Color(hex: 0xFF6B6B))
                } else {
                    Text(gespeichert ? "Standard gespeichert" : "Standard für alle Adressen ohne eigenen Ort")
                        .foregroundStyle(Self.lime.opacity(0.6))
                }
            }
            .font(.grotesk(14, .medium)).tracking(0.5)
            .lineLimit(1).minimumScaleFactor(0.8)
            .frame(width: 362, height: 20, alignment: .leading)
            .padding(.top, 8)

            VStack(spacing: 12) {
                ForEach(orte.orte) { o in
                    Button { bearbeiten(o) } label: { OrtZeile(ort: o) }
                        .buttonStyle(.web)
                }
            }
            .padding(.top, 16)

            Button { bearbeiten(nil) } label: {
                HStack {
                    Text("Ort hinzufügen").grotesk(16, .medium, abstand: 0.4).foregroundStyle(Self.lime)
                    Spacer()
                    Text("+").grotesk(24, .medium).foregroundStyle(Self.lime)
                }
                .padding(.horizontal, 12)
                .frame(width: 362, height: 56)
                .overlay(Rectangle().strokeBorder(Self.lime, lineWidth: 2))
                .contentShape(Rectangle())
            }
            .buttonStyle(.web)
            .padding(.top, orte.orte.isEmpty ? 0 : 12)
        }
        .frame(width: 362, alignment: .topLeading)
        .onAppear { uebernehmen(orte.standard) }
        .onChange(of: orte.standard) { _, neu in if !fokus { uebernehmen(neu) } }
        .task(id: "\(reinText)|\(rausText)") { await standardSpeichern() }
    }

    private func uebernehmen(_ s: OrteStandard) {
        reinText = "\(s.radius_rein_m)"
        rausText = "\(s.radius_raus_m)"
    }

    /// Speichert kurz nach dem Tippen, aber nur gueltige und geaenderte Werte.
    private func standardSpeichern() async {
        let rein = Int(reinText), raus = Int(rausText)
        if rein == orte.standard.radius_rein_m && raus == orte.standard.radius_raus_m {
            hinweis = nil
            return
        }
        gespeichert = false
        try? await Task.sleep(for: .milliseconds(800))
        if Task.isCancelled { return }
        if let fehler = OrteSpeicher.radienPruefen(rein: rein, raus: raus) {
            hinweis = fehler
            return
        }
        hinweis = nil
        do {
            try await orte.standardSpeichern(rein: rein ?? 50, raus: raus ?? 100)
            gespeichert = true
        } catch {
            hinweis = error.localizedDescription
        }
    }
}

/// Zahlenfeld "Rein 50 m" im Stil der Filterzeilen (175 x 56, Lime-Rand).
private struct RadiusFeld: View {
    let titel: String
    @Binding var text: String
    private static let lime = Color(hex: 0xE3F654)

    var body: some View {
        HStack(spacing: 8) {
            Text(titel).grotesk(16, .medium, abstand: 0.5).foregroundStyle(Self.lime.opacity(0.6)).fixedSize()
            TextField("", text: Binding(get: { text }, set: { text = String($0.filter(\.isNumber).prefix(5)) }))
                .font(.grotesk(16, .medium)).tracking(0.5)
                .foregroundStyle(Self.lime)
                .tint(Self.lime)
                .keyboardType(.numberPad)
                .multilineTextAlignment(.trailing)
            Text("m").grotesk(16, .medium, abstand: 0.5).foregroundStyle(Self.lime.opacity(0.6))
        }
        .padding(.horizontal, 12)
        .frame(width: 175, height: 56)
        .overlay(Rectangle().strokeBorder(Self.lime, lineWidth: 2))
    }
}

/// Zeile der Ortsliste: Icon, Name, "rein 50 m / raus 120 m", Pfeil.
private struct OrtZeile: View {
    let ort: EigenerOrt
    private static let lime = Color(hex: 0xE3F654)

    var body: some View {
        HStack(spacing: 12) {
            Image(ort.symbol.grau).resizable().scaledToFit().frame(width: 24, height: 24)
            Text(ort.name).grotesk(16, .medium, abstand: 0.4).foregroundStyle(Self.lime).lineLimit(1)
            Spacer(minLength: 4)
            Text(ort.radienText).grotesk(13, .medium, abstand: 0.3).foregroundStyle(Self.lime.opacity(0.6))
                .lineLimit(1).fixedSize()
            Image("Arrow-kurz_Trisar_Icons_01_Lime").resizable().frame(width: 10, height: 13)
        }
        .padding(.horizontal, 12)
        .frame(width: 362, height: 56)
        .overlay(Rectangle().strokeBorder(Self.lime, lineWidth: 2))
        .contentShape(Rectangle())
    }
}

// MARK: - Editor

/// Ort anlegen oder bearbeiten: Name, Adresse (Adresssuche wie beim Fahrt erstellen), Pin auf
/// der Karte feinjustieren, beide Radien, Icon. Loeschen mit Rueckfrage.
struct OrtBearbeitenAnsicht: View {
    let ort: EigenerOrt?
    let zurueck: () -> Void

    @ObservedObject private var orte = OrteSpeicher.geteilt
    @State private var name: String
    @State private var adresse: String
    @State private var punkt: CLLocationCoordinate2D?
    @State private var reinText: String
    @State private var rausText: String
    @State private var symbol: OrtSymbol
    @State private var einpassen = 0

    @State private var vorschlaege: [String] = []
    @State private var vorschlagLauf: Task<Void, Never>?
    @State private var sucht = false
    @State private var speichert = false
    @State private var meldung: String?
    @State private var loeschFrage = false
    @FocusState private var fokus: String?

    private static let lime = Color(hex: 0xE3F654)
    private let kartenTop: CGFloat = 342
    private let kartenHoehe: CGFloat = 280

    init(ort: EigenerOrt?, zurueck: @escaping () -> Void) {
        self.ort = ort
        self.zurueck = zurueck
        let standard = OrteSpeicher.geteilt.standard
        _name = State(initialValue: ort?.name ?? "")
        _adresse = State(initialValue: ort?.adresse ?? "")
        _punkt = State(initialValue: ort?.punkt)
        _reinText = State(initialValue: "\(ort?.radius_rein_m ?? standard.radius_rein_m)")
        _rausText = State(initialValue: "\(ort?.radius_raus_m ?? standard.radius_raus_m)")
        _symbol = State(initialValue: ort?.symbol ?? .pin)
    }

    private var rein: Int? { Int(reinText) }
    private var raus: Int? { Int(rausText) }
    private var radienHinweis: String? { OrteSpeicher.radienPruefen(rein: rein, raus: raus) }

    var body: some View {
        let radienTop = kartenTop + kartenHoehe + 46
        let iconTop = radienTop + 68 + 56 + 36
        let speichernTop = iconTop + 32 + 52 + 32
        let loeschenTop = speichernTop + 68
        let inhaltHoehe = (ort == nil ? speichernTop : loeschenTop) + 56 + 30 + 40

        ZStack(alignment: .topLeading) {
            DispoHintergrund().ignoresSafeArea()
            Leinwand(basisHoehe: 874, inhaltHoehe: inhaltHoehe, mitHintergrund: false) { _ in
                ZStack(alignment: .topLeading) {
                    ZurueckKnopf(aktion: zurueck).platz(20, 60, 50, 50)
                    Text(ort == nil ? "Neuer Ort" : "Ort bearbeiten").grotesk(42, .bold).foregroundStyle(Self.lime)
                        .lineLimit(1).minimumScaleFactor(0.7)
                        .frame(height: 42)
                        .platz(20, 140, 362, 42)

                    FormularZeile(beschriftung: "Name", wert: name, zuruecksetzen: { name = "" }) {
                        ZeilenEingabe(text: $name).focused($fokus, equals: "name")
                    }
                    .platz(20, 206, 362, 56)

                    FormularZeile(beschriftung: "Adresse", wert: adresse, zuruecksetzen: {
                        adresse = ""
                        vorschlaege = []
                    }) {
                        ZeilenEingabe(text: Binding(get: { adresse }, set: adresseTippen))
                            .focused($fokus, equals: "adresse")
                    }
                    .platz(20, 274, 362, 56)

                    karte.platz(20, kartenTop, 362, kartenHoehe)
                    WebText(text: punkt == nil ? "Erst die Adresse suchen und wählen." : "Pin ziehen oder auf die Karte tippen, um ihn auf die Einfahrt zu setzen.",
                            groesse: 14, gewicht: .medium, zeilenHoehe: 18, abstand: 0.3,
                            farbe: UIColor(hex: 0xE3F654).withAlphaComponent(0.6))
                        .platz(20, kartenTop + kartenHoehe + 8, 362, 36)

                    FormularZeile(beschriftung: "Reinfahr-Radius", wert: reinText, zuruecksetzen: { reinText = "" }) {
                        zahlFeld($reinText, "rein")
                    }
                    .platz(20, radienTop, 362, 56)
                    FormularZeile(beschriftung: "Rausfahr-Radius", wert: rausText, zuruecksetzen: { rausText = "" }) {
                        zahlFeld($rausText, "raus")
                    }
                    .platz(20, radienTop + 68, 362, 56)
                    Text(radienHinweis ?? "Beim Gast ab dem Reinfahr-Radius, unterwegs außerhalb des Rausfahr-Radius.")
                        .font(.grotesk(13, .medium)).tracking(0.3)
                        .foregroundStyle(radienHinweis == nil ? Self.lime.opacity(0.6) : Color(hex: 0xFF6B6B))
                        .lineLimit(2).minimumScaleFactor(0.85)
                        .frame(width: 362, alignment: .topLeading)
                        .platz(20, radienTop + 68 + 56 + 6, 362, 34)

                    Text("Icon").grotesk(16, .medium, abstand: 0.5).foregroundStyle(Self.lime.opacity(0.6))
                        .platz(20, iconTop, 362, 24)
                    HStack(spacing: 10) {
                        ForEach(OrtSymbol.allCases) { s in
                            Button { symbol = s } label: {
                                Image(s == symbol ? s.lime : s.grau).resizable().scaledToFit().frame(width: 26, height: 26)
                                    .frame(width: 52, height: 52)
                                    .background(Color(hex: 0x242525))
                                    .overlay(Rectangle().strokeBorder(s == symbol ? Self.lime : Color.clear, lineWidth: 2))
                                    .contentShape(Rectangle())
                            }
                            .buttonStyle(.web)
                            .accessibilityLabel(s.titel)
                        }
                    }
                    .platz(20, iconTop + 32, 362, 52)

                    FormularSpeichernKnopf(text: speichert ? "Wird gespeichert..." : "Ort speichern", gesperrt: speichert || sucht) {
                        Task { await speichern() }
                    }
                    .platz(20, speichernTop, 362, 56)

                    if ort != nil {
                        Button { loeschFrage = true } label: {
                            Text("Ort löschen").font(.grotesk(16, .medium)).tracking(0.4).foregroundStyle(Color(hex: 0xF55757))
                                .frame(width: 362, height: 56)
                                .background(Color(hex: 0x221313))
                                .overlay(Rectangle().strokeBorder(Color(hex: 0xF55757), lineWidth: 2))
                                .contentShape(Rectangle())
                        }
                        .buttonStyle(.web)
                        .platz(20, loeschenTop, 362, 56)
                    }

                    if fokus == "adresse", !vorschlaege.isEmpty {
                        VorschlagListe(eintraege: vorschlaege) { i in Task { await adresseWaehlen(vorschlaege[i]) } }
                            .platz(20, 274 + 56 + 4, 362, nil)
                    }
                }
            }
            .scrollDismissesKeyboard(.interactively)
            FussleisteUnten()
        }
        .alert(meldung ?? "", isPresented: Binding(get: { meldung != nil }, set: { if !$0 { meldung = nil } })) {
            Button("OK", role: .cancel) {}
        }
        .alert("„\(ort?.name ?? "")“ löschen?", isPresented: $loeschFrage) {
            Button("Abbrechen", role: .cancel) {}
            Button("Löschen", role: .destructive) { Task { await loeschen() } }
        } message: {
            Text("Fahrten mit diesem Ort behalten Name und Adresse.")
        }
    }

    private var karte: some View {
        ZStack {
            OrtKarte(punkt: punkt, rein: rein ?? 0, raus: raus ?? 0, symbol: symbol, einpassenSignal: einpassen) { neu in
                punkt = neu
            }
            if sucht {
                ProgressView().tint(Self.lime)
            }
        }
        .frame(width: 362, height: kartenHoehe)
        .clipped()
        .overlay(Rectangle().strokeBorder(Self.lime, lineWidth: 2).allowsHitTesting(false))
    }

    private func zahlFeld(_ text: Binding<String>, _ kennung: String) -> some View {
        HStack(spacing: 6) {
            ZeilenEingabe(text: Binding(get: { text.wrappedValue }, set: { text.wrappedValue = String($0.filter(\.isNumber).prefix(5)) }),
                          tastatur: .numberPad)
                .focused($fokus, equals: kennung)
                .fixedSize()
            Text("m").font(.grotesk(16, .medium)).tracking(0.5).foregroundStyle(Self.lime.opacity(0.5))
        }
    }

    // MARK: Adresse

    /// Gleiche Adresssuche wie beim Fahrt erstellen (places-proxy, sonst OSM), 250 ms warten.
    private func adresseTippen(_ text: String) {
        adresse = text
        vorschlagLauf?.cancel()
        let suche = FahrtText.getrimmt(text)
        if suche.isEmpty {
            vorschlaege = []
            return
        }
        vorschlagLauf = Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(250))
            if Task.isCancelled { return }
            let treffer = await FahrtPruefung.ortsVorschlaege(suche)
            if Task.isCancelled { return }
            vorschlaege = treffer
        }
    }

    /// Adresse uebernehmen und den Pin dorthin setzen (danach feinjustieren).
    private func adresseWaehlen(_ wert: String) async {
        vorschlagLauf?.cancel()
        adresse = wert
        vorschlaege = []
        fokus = nil
        sucht = true
        let neu = await Routen.punkt(fuer: wert)
        sucht = false
        if let neu {
            punkt = neu
            einpassen += 1
        } else {
            meldung = "Adresse nicht gefunden. Bitte genauer suchen."
        }
    }

    // MARK: Speichern / Loeschen

    private func speichern() async {
        if speichert { return }
        fokus = nil
        if let hinweis = orte.pruefen(name: name, rein: rein, raus: raus, ohne: ort?.id) {
            meldung = hinweis
            return
        }
        let adr = FahrtText.getrimmt(adresse)
        if adr.isEmpty {
            meldung = "Bitte eine Adresse suchen und wählen."
            return
        }
        speichert = true
        defer { speichert = false }
        var ziel = punkt
        if ziel == nil { ziel = await Routen.punkt(fuer: adr) }
        guard let ziel, let rein, let raus else {
            meldung = "Adresse nicht gefunden. Bitte genauer suchen."
            return
        }
        let neu = EigenerOrt(id: ort?.id ?? UUID(), name: FahrtText.getrimmt(name), adresse: adr,
                             lat: ziel.latitude, lng: ziel.longitude,
                             radius_rein_m: rein, radius_raus_m: raus, icon: symbol.rawValue)
        do {
            try await orte.speichern(neu, neu: ort == nil)
            zurueck()
        } catch {
            meldung = error.localizedDescription
        }
    }

    private func loeschen() async {
        guard let ort else { return }
        do {
            try await orte.loeschen(ort.id)
            zurueck()
        } catch {
            meldung = error.localizedDescription
        }
    }
}
