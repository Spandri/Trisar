import SwiftUI

// Standby am Event-Ort in der Dispo, Nachbau von StandbyAdd.jsx, StandbyView.jsx, ArtUmschalter.jsx,
// StandbyKacheln.jsx und StandbyFahrten.jsx. Raster wie Fahrt hinzufuegen: Titel 140, Felder ab 206,
// Reihen alle 68, Zeilenhoehe 56.

private let reiheSchritt: CGFloat = 68
private let reiheHoehe: CGFloat = 56

/// „Fahrt | Standby“ oben mittig zwischen Zurueck und Import.
struct ArtUmschalter: View {
    let standby: Bool
    let fahrt: () -> Void
    let zumStandby: () -> Void
    var body: some View {
        HStack(spacing: 0) {
            knopf("Fahrt", an: !standby, fahrt)
            knopf("Standby", an: standby, zumStandby)
        }
        .overlay(Rectangle().strokeBorder(formularLime, lineWidth: 2))
        .fixedSize()
        // Mittig ueber die ganze Breite (left-1/2 -translate-x-1/2 im Web).
        .frame(width: 402)
    }
    private func knopf(_ text: String, an: Bool, _ aktion: @escaping () -> Void) -> some View {
        Button(action: aktion) {
            Text(text).font(.grotesk(15, .bold)).foregroundStyle(an ? .black : formularLime)
                .lineLimit(1).fixedSize()
                .padding(.horizontal, 16).frame(height: 36)
                .background(an ? formularLime : .clear)
        }
        .buttonStyle(.web)
    }
}

// MARK: - Gemeinsame Bausteine

/// Datum als Zeile mit Kalender (wie das Datumsfeld in Fahrt hinzufuegen).
private struct DatumZeile: View {
    @Binding var wert: String
    @State private var offen = false
    var body: some View {
        FormularZeile(beschriftung: "Datum", wert: wert, zuruecksetzen: { wert = "" }) {
            Button {
                if wert.isEmpty { wert = Stunden.heuteDatum }
                offen = true
            } label: { ZeilenWert(text: anzeige) }
            .buttonStyle(.web)
            .popover(isPresented: $offen) {
                DatePicker("", selection: Binding(get: { wert.isEmpty ? Date() : Datum.ausTagWert(wert) },
                                                  set: { wert = Datum.tagWert($0) }), displayedComponents: .date)
                    .datePickerStyle(.graphical).labelsHidden()
                    .environment(\.locale, Locale(identifier: "de_DE"))
                    .tint(Color(hex: 0x0A84FF))
                    .frame(width: 320).padding(8)
                    .presentationCompactAdaptation(.popover)
            }
        }
    }
    private var anzeige: String {
        let t = wert.split(separator: "-")
        return t.count == 3 ? "\(t[2]).\(t[1]).\(t[0])" : ""
    }
}

/// Uhrzeit als Zeile mit Drehrad.
private struct UhrZeile: View {
    let beschriftung: String
    @Binding var wert: String
    @State private var offen = false
    var body: some View {
        FormularZeile(beschriftung: beschriftung, wert: wert, zuruecksetzen: { wert = "" }) {
            Button {
                if wert.isEmpty { wert = FahrtText.jetztUhr() }
                offen = true
            } label: { ZeilenWert(text: wert) }
            .buttonStyle(.web)
            .popover(isPresented: $offen) {
                DatePicker("", selection: bindung, displayedComponents: .hourAndMinute)
                    .datePickerStyle(.wheel).labelsHidden()
                    .environment(\.locale, Locale(identifier: "de_DE"))
                    .frame(width: 260).padding(8)
                    .presentationCompactAdaptation(.popover)
            }
        }
    }
    private var bindung: Binding<Date> {
        Binding(get: {
            guard let m = FahrtText.minuten(wert) else { return Date() }
            return Calendar.current.date(bySettingHour: m / 60, minute: m % 60, second: 0, of: Date()) ?? Date()
        }, set: { neu in
            let k = Calendar.current.dateComponents([.hour, .minute], from: neu)
            wert = String(format: "%02d:%02d", k.hour ?? 0, k.minute ?? 0)
        })
    }
}

/// Notizen wie in Fahrt hinzufuegen: graue Flaeche, weisses Feld.
private struct NotizBlock: View {
    @Binding var text: String
    var fokus: FocusState<String?>.Binding
    var body: some View {
        ZStack(alignment: .topLeading) {
            RoundedRectangle(cornerRadius: 12).fill(Color(hex: 0x1A1A1A)).frame(width: 402, height: 224)
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Text(FahrtText.tr("fahrt.notizen")).font(.grotesk(16, .bold)).tracking(0.5).foregroundStyle(Color(hex: 0x1D1C1D))
                    Spacer()
                    Image("Arrow-kurz_Trisar_Icons_01_Lime").resizable().frame(width: 10, height: 13)
                }
                TextField("", text: $text,
                          prompt: Text(FahrtText.tr("fahrt.notesPlaceholder")).foregroundStyle(Color(hex: 0x818181, alpha: 0.25)),
                          axis: .vertical)
                    .font(.grotesk(14)).tracking(0.25)
                    .foregroundStyle(Color(hex: 0x818181, alpha: 0.5))
                    .tint(Color(hex: 0x818181))
                    .focused(fokus, equals: "notiz")
                    .frame(maxHeight: .infinity, alignment: .topLeading)
            }
            .padding(16)
            .frame(width: 362, height: 184, alignment: .topLeading)
            .background(Color.white)
            .clipped()
            .contentShape(Rectangle())
            .onTapGesture { fokus.wrappedValue = "notiz" }
            .platz(20, 20, 362, 184)
        }
    }
}

private func fahrerBeschriftung(_ i: Int, _ anzahl: Int) -> String {
    anzahl > 1 ? FahrtText.tr("fahrt.fahrerNumbered", ["n": "\(i + 1)"]) : FahrtText.tr("fahrt.fahrer")
}

/// Vorschlaege wie das datalist im Web.
private func fahrerTreffer(_ wert: String, _ liste: [String]) -> [String] {
    let suche = FahrtText.vergleichbar(wert)
    if suche.isEmpty { return [] }
    let treffer = liste.filter { FahrtText.vergleichbar($0).contains(suche) }
    if treffer.contains(where: { FahrtText.vergleichbar($0) == suche }) { return [] }
    return treffer
}

/// Leere Fahrerzeile immer am Ende.
private func fahrerZeilen(_ namen: [String]) -> [String] {
    namen.filter { !FahrtText.getrimmt($0).isEmpty } + [""]
}

// MARK: - Standby verschicken (StandbyAdd.jsx)

struct StandbyFormularAnsicht: View {
    let zurueck: () -> Void
    let zuFahrt: () -> Void
    let zeigen: (DispoZiel) -> Void

    @ObservedObject private var orte = OrteSpeicher.geteilt
    @State private var datum = Stunden.heuteDatum
    @State private var von = ""
    @State private var bis = ""
    @State private var ortText = ""
    @State private var ortID: UUID?
    @State private var ortTreffer: [EigenerOrt] = []
    @State private var vorschlaege: [String] = []
    @State private var ortOffen = false
    @State private var vorschlagLauf: Task<Void, Never>?
    @State private var notiz = ""
    @State private var fehler = ""
    @State private var sendet = false
    @State private var fahrerNamen: [String] = FahrerMarkierung.geteilt.wirkt ? fahrerZeilen(FahrerMarkierung.geteilt.namen) : [""]
    @State private var fahrer: [FahrtSpeichern.FahrerEintrag] = []
    @State private var fahrerListe: [String] = []
    @State private var autoZu = false
    @FocusState private var fokus: String?

    var body: some View {
        let fahrerOben: CGFloat = 478
        let notizOben = fahrerOben + CGFloat(fahrerNamen.count - 1) * reiheSchritt + reiheHoehe + 24
        let knopfOben = notizOben + 224 + 24
        let hoehe = knopfOben + reiheHoehe + (fehler.isEmpty ? 30 : 60)
        ZStack(alignment: .topLeading) {
            Leinwand(basisHoehe: 874, inhaltHoehe: hoehe + 151, mitHintergrund: false) { _ in
                ZStack(alignment: .topLeading) {
                    DispoHintergrund().frame(width: 402, height: hoehe + 151)
                    ZurueckKnopf(aktion: zurueck).platz(20, 60, 50, 50)
                    ArtUmschalter(standby: true, fahrt: zuFahrt, zumStandby: {}).platz(0, 67, 402, 36)
                    Text("Standby").font(.grotesk(42, .bold)).foregroundStyle(formularLime).platz(20, 140, 362, 42)

                    DatumZeile(wert: $datum).platz(20, 206, 362, 56)
                    UhrZeile(beschriftung: "Von", wert: $von).platz(20, 274, 362, 56)
                    UhrZeile(beschriftung: "Bis", wert: $bis).platz(20, 342, 362, 56)
                    FormularZeile(beschriftung: "Ort", wert: ortText, zuruecksetzen: {
                        ortText = ""; ortID = nil; vorschlaege = []; ortTreffer = []
                    }) {
                        ZeilenEingabe(text: Binding(get: { ortText }, set: { ortTippen($0) }))
                            .focused($fokus, equals: "ort")
                    }
                    .platz(20, 410, 362, 56)

                    ForEach(Array(fahrerNamen.enumerated()), id: \.offset) { i, _ in
                        FormularZeile(beschriftung: fahrerBeschriftung(i, fahrerNamen.count),
                                      wert: i < fahrerNamen.count ? fahrerNamen[i] : "",
                                      zuruecksetzen: { setzeFahrer(i, "") }) {
                            ZeilenEingabe(text: Binding(get: { i < fahrerNamen.count ? fahrerNamen[i] : "" },
                                                        set: { autoZu = false; setzeFahrer(i, $0) }),
                                          platzhalter: fahrerListe.isEmpty ? "Fahrer werden geladen..." : "")
                                .focused($fokus, equals: "fahrer-\(i)")
                        }
                        .platz(20, fahrerOben + CGFloat(i) * reiheSchritt, 362, 56)
                    }

                    NotizBlock(text: $notiz, fokus: $fokus).platz(0, notizOben, 402, 224)

                    FormularSpeichernKnopf(text: sendet ? "Wird gesendet …" : "Standby senden", gesperrt: sendet) {
                        Task { await senden() }
                    }
                    .platz(20, knopfOben, 362, 56)
                    if !fehler.isEmpty {
                        Text(fehler).font(.grotesk(13, .bold)).foregroundStyle(DispoStandbySpeicher.rot)
                            .platz(20, knopfOben + reiheHoehe + 10, 362, nil)
                    }

                    // Vorschlaege unter Ort bzw. dem Fahrerfeld
                    if ortOffen, fokus == "ort", !ortTreffer.isEmpty || !vorschlaege.isEmpty {
                        VorschlagListe(eintraege: ortTreffer.map(\.name) + vorschlaege,
                                       icons: ortTreffer.map { Optional($0.symbol.grau) }) { n in
                            if n < ortTreffer.count {
                                ortText = ortTreffer[n].name; ortID = ortTreffer[n].id
                            } else {
                                ortText = vorschlaege[n - ortTreffer.count]; ortID = nil
                            }
                            vorschlaege = []; ortTreffer = []; ortOffen = false
                        }
                        .platz(20, 410 + reiheHoehe + 4, 362, nil)
                    }
                    if let f = fokus, f.hasPrefix("fahrer-"), !autoZu, let i = Int(f.dropFirst(7)), i < fahrerNamen.count {
                        let treffer = fahrerTreffer(fahrerNamen[i], fahrerListe)
                        if !treffer.isEmpty {
                            VorschlagListe(eintraege: treffer) { n in
                                autoZu = true
                                setzeFahrer(i, treffer[n])
                            }
                            .platz(20, fahrerOben + CGFloat(i) * reiheSchritt + reiheHoehe + 4, 362, nil)
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
        .onChange(of: [datum, von, bis, ortText] + fahrerNamen) { _, _ in fehler = "" }
    }

    private func setzeFahrer(_ i: Int, _ wert: String) {
        var neu = fahrerNamen
        if i < neu.count { neu[i] = wert }
        // Waehrend des Tippens bleibt die Zeile stehen, leere Zeilen dazwischen fallen weg.
        let gefuellt = neu.enumerated().filter { !FahrtText.getrimmt($0.element).isEmpty || $0.offset == i }.map(\.element)
        fahrerNamen = gefuellt.last.map { FahrtText.getrimmt($0).isEmpty } == true ? gefuellt : gefuellt + [""]
    }

    private func ortTippen(_ text: String) {
        if text != ortText { ortID = nil }
        ortText = text
        vorschlagLauf?.cancel()
        let q = FahrtText.getrimmt(text)
        ortTreffer = orte.treffer(q)
        if q.isEmpty { vorschlaege = []; return }
        ortOffen = true
        vorschlagLauf = Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(250))
            if Task.isCancelled { return }
            let liste = await FahrtPruefung.ortsVorschlaege(q)
            if !Task.isCancelled { vorschlaege = liste }
        }
    }

    private func senden() async {
        fehler = ""
        let fehlt = [datum.isEmpty ? "Datum" : nil, von.isEmpty ? "Von" : nil, bis.isEmpty ? "Bis" : nil].compactMap { $0 }
        if !fehlt.isEmpty { fehler = "Bitte \(fehlt.joined(separator: ", ")) setzen."; return }
        if FahrtText.getrimmt(ortText).isEmpty { fehler = "Bitte einen Ort wählen."; return }
        let namen = fahrerNamen.map(FahrtText.getrimmt).filter { !$0.isEmpty }
        if namen.isEmpty { fehler = "Bitte mindestens einen Fahrer eintragen."; return }
        sendet = true
        defer { sendet = false }
        // Ort: eigener Ort mit Radius, sonst Adresse suchen (Radius 150 rein, 300 raus).
        var ort: DispoStandbySpeicher.OrtDaten
        if let id = ortID, let o = orte.orte.first(where: { $0.id == id }) {
            ort = .init(id: o.id, name: o.name, adresse: o.adresse, lat: o.lat, lng: o.lng,
                        radiusRein: max(150, o.radius_rein_m), radiusRaus: max(300, o.radius_raus_m))
        } else {
            guard let p = await Routen.punkt(fuer: ortText) else {
                fehler = "Adresse nicht gefunden. Bitte genauer eingeben oder einen eigenen Ort wählen."; return
            }
            let name = ortText.split(separator: ",").first.map { FahrtText.getrimmt(String($0)) } ?? ortText
            ort = .init(id: nil, name: name, adresse: ortText, lat: p.latitude, lng: p.longitude)
        }
        if fahrer.isEmpty { fahrer = await FahrtSpeichern.fahrerLaden() }
        var ids: [UUID] = []
        for n in namen {
            guard let id = FahrtSpeichern.fahrerID(n, fahrer) else { fehler = "Fahrer „\(n)“ nicht gefunden."; return }
            if !ids.contains(id) { ids.append(id) }
        }
        switch await DispoStandbySpeicher.gemeinsam.anlegen(datum: datum, von: von, bis: bis, ort: ort,
                                                              notiz: FahrtText.getrimmt(notiz), fahrerIDs: ids) {
        case let .success(id):
            DispoStandbySpeicher.gemeinsam.oeffnen = id
            zeigen(.fahrten)
        case let .failure(e):
            fehler = "Standby nicht gespeichert: \(e.localizedDescription)"
        }
    }
}

// MARK: - Standby bearbeiten (StandbyView.jsx, Stil wie Fahrt bearbeiten)

struct StandbyAnsicht: View {
    let standbyID: UUID
    let zurueck: () -> Void

    @ObservedObject private var speicher = DispoStandbySpeicher.gemeinsam
    @State private var datum: String?
    @State private var von: String?
    @State private var bis: String?
    @State private var notiz: String?
    @State private var neue: [String] = [""]
    @State private var meldung = ""
    @State private var speichert = false
    @State private var wegFrage: DispoStandbySpeicher.Fahrer?
    @State private var loeschFrage = false
    @State private var fahrer: [FahrtSpeichern.FahrerEintrag] = []
    @State private var fahrerListe: [String] = []
    @State private var autoZu = false
    @FocusState private var fokus: String?

    private var s: DispoStandbySpeicher.Standby? { speicher.liste?.first { $0.id == standbyID } }

    var body: some View {
        ZStack(alignment: .topLeading) {
            if let s {
                inhalt(s)
            } else {
                ZStack(alignment: .topLeading) {
                    DispoHintergrund().ignoresSafeArea()
                    Leinwand(basisHoehe: 874, mitHintergrund: false) { _ in
                        ZStack(alignment: .topLeading) {
                            ZurueckKnopf(aktion: zurueck).platz(20, 60, 50, 50)
                            Text(speicher.liste == nil ? "" : "Standby nicht mehr vorhanden.")
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
        .alert("\(wegFrage?.profil?.name ?? "Fahrer") aus dem Standby nehmen?", isPresented: Binding(get: { wegFrage != nil }, set: { if !$0 { wegFrage = nil } })) {
            Button("Abbrechen", role: .cancel) {}
            Button("Rausnehmen", role: .destructive) {
                guard let f = wegFrage else { return }
                Task {
                    let e = await speicher.fahrerWeg(standbyID, f.driverID)
                    meldung = e.isEmpty ? "\(f.profil?.name ?? "Fahrer") ist raus." : "Nicht gespeichert: \(e)"
                    await speicher.laden()
                }
            }
        }
        .alert("Standby \(s?.ortName ?? "") löschen? Alle Fahrer bekommen „Standby zurückgezogen“.", isPresented: $loeschFrage) {
            Button("Abbrechen", role: .cancel) {}
            Button("Löschen", role: .destructive) {
                Task {
                    let e = await speicher.loeschen(standbyID)
                    if e.isEmpty { zurueck() } else { meldung = "Nicht gelöscht: \(e)" }
                }
            }
        }
    }

    private func inhalt(_ s: DispoStandbySpeicher.Standby) -> some View {
        let alle = s.fahrer.count + neue.count
        let fahrerOben: CGFloat = 478
        let notizOben = fahrerOben + CGFloat(alle - 1) * reiheSchritt + reiheHoehe + 24
        let knopfOben = notizOben + 224 + 24
        let loeschOben = knopfOben + reiheHoehe + 16
        let hoehe = loeschOben + reiheHoehe + (meldung.isEmpty ? 40 : 70) + 80
        let w = (datum: datum ?? s.datum, von: von ?? s.von, bis: bis ?? s.bis, notiz: notiz ?? (s.notiz ?? ""))
        return Leinwand(basisHoehe: 874, inhaltHoehe: hoehe, mitHintergrund: false) { _ in
            ZStack(alignment: .topLeading) {
                DispoHintergrund().frame(width: 402, height: hoehe)
                ZurueckKnopf(aktion: zurueck).platz(20, 60, 50, 50)
                Text("Standby").font(.grotesk(42, .bold)).foregroundStyle(formularLime).platz(20, 140, 362, 42)

                DatumZeile(wert: Binding(get: { w.datum }, set: { datum = $0 })).platz(20, 206, 362, 56)
                UhrZeile(beschriftung: "Von", wert: Binding(get: { w.von }, set: { von = $0 })).platz(20, 274, 362, 56)
                UhrZeile(beschriftung: "Bis", wert: Binding(get: { w.bis }, set: { bis = $0 })).platz(20, 342, 362, 56)
                FormularZeile(beschriftung: "Ort", wert: s.ortName, rechts: .pfeil, zuruecksetzen: {}) {
                    ZeilenWert(text: s.ortName)
                }
                .platz(20, 410, 362, 56)

                ForEach(Array(s.fahrer.enumerated()), id: \.element.driverID) { i, f in
                    let z = DispoStandbySpeicher.zustand(f)
                    FormularZeile(beschriftung: fahrerBeschriftung(i, alle), wert: f.profil?.kurz ?? "Fahrer",
                                  eta: EtaMarke(text: z.text, farbe: Self.hex(z.farbe)),
                                  zuruecksetzen: { wegFrage = f }) {
                        ZeilenWert(text: f.profil?.kurz ?? "Fahrer")
                    }
                    .platz(20, fahrerOben + CGFloat(i) * reiheSchritt, 362, 56)
                }
                ForEach(Array(neue.enumerated()), id: \.offset) { j, _ in
                    let i = s.fahrer.count + j
                    FormularZeile(beschriftung: fahrerBeschriftung(i, alle), wert: j < neue.count ? neue[j] : "",
                                  zuruecksetzen: { neueSetzen(j, "") }) {
                        ZeilenEingabe(text: Binding(get: { j < neue.count ? neue[j] : "" }, set: { autoZu = false; neueSetzen(j, $0) }))
                            .focused($fokus, equals: "neu-\(j)")
                    }
                    .platz(20, fahrerOben + CGFloat(i) * reiheSchritt, 362, 56)
                }

                NotizBlock(text: Binding(get: { w.notiz }, set: { notiz = $0 }), fokus: $fokus).platz(0, notizOben, 402, 224)

                FormularSpeichernKnopf(text: speichert ? FahrtText.tr("fahrt.saving") : "Speichern", gesperrt: speichert) {
                    Task { await speichern(s, w) }
                }
                .platz(20, knopfOben, 362, 56)

                Button { loeschFrage = true } label: {
                    Text("Standby löschen").font(.grotesk(16, .medium)).tracking(0.4).foregroundStyle(Color(hex: 0xF55757))
                        .frame(width: 362, height: 56)
                        .background(Color(hex: 0x221313))
                        .overlay(Rectangle().strokeBorder(Color(hex: 0xF55757), lineWidth: 2))
                        .contentShape(Rectangle())
                }
                .buttonStyle(.web)
                .platz(20, loeschOben, 362, 56)

                if !meldung.isEmpty {
                    Text(meldung).font(.grotesk(13, .bold)).foregroundStyle(.white.opacity(0.7))
                        .platz(20, loeschOben + reiheHoehe + 12, 362, nil)
                }

                if let f = fokus, f.hasPrefix("neu-"), !autoZu, let j = Int(f.dropFirst(4)), j < neue.count {
                    let treffer = fahrerTreffer(neue[j], fahrerListe)
                    if !treffer.isEmpty {
                        VorschlagListe(eintraege: treffer) { n in
                            autoZu = true
                            neueSetzen(j, treffer[n])
                        }
                        .platz(20, fahrerOben + CGFloat(s.fahrer.count + j) * reiheSchritt + reiheHoehe + 4, 362, nil)
                    }
                }
            }
        }
        .scrollDismissesKeyboard(.interactively)
    }

    private static func hex(_ c: Color) -> UInt32 {
        switch c {
        case DispoStandbySpeicher.rot: return 0xFF6F63
        case DispoStandbySpeicher.orange: return 0xFFCD8A
        case DispoStandbySpeicher.grau: return 0x868687
        default: return 0xE3F654
        }
    }

    private func neueSetzen(_ j: Int, _ wert: String) {
        var n = neue
        if j < n.count { n[j] = wert }
        let gefuellt = n.enumerated().filter { !FahrtText.getrimmt($0.element).isEmpty || $0.offset == j }.map(\.element)
        neue = gefuellt.last.map { FahrtText.getrimmt($0).isEmpty } == true ? gefuellt : gefuellt + [""]
    }

    private func speichern(_ s: DispoStandbySpeicher.Standby, _ w: (datum: String, von: String, bis: String, notiz: String)) async {
        speichert = true
        meldung = ""
        defer { speichert = false }
        // Geaenderte Zeiten macht der Trigger zu Anfragen an die Fahrer.
        let neuDatum = w.datum != s.datum ? w.datum : nil
        let neuVon = w.von != s.von ? w.von : nil
        let neuBis = w.bis != s.bis ? w.bis : nil
        let neuNotiz: String?? = w.notiz != (s.notiz ?? "") ? .some(w.notiz.isEmpty ? nil : w.notiz) : nil
        let e = await speicher.aendern(s.id, datum: neuDatum, von: neuVon, bis: neuBis, notiz: neuNotiz)
        if !e.isEmpty { meldung = "Nicht gespeichert: \(e)"; return }
        let namen = neue.map(FahrtText.getrimmt).filter { !$0.isEmpty }
        if !namen.isEmpty {
            if fahrer.isEmpty { fahrer = await FahrtSpeichern.fahrerLaden() }
            var ids: [UUID] = []
            for n in namen {
                guard let id = FahrtSpeichern.fahrerID(n, fahrer) else { meldung = "Fahrer „\(n)“ nicht gefunden."; return }
                ids.append(id)
            }
            let f = await speicher.fahrerDazu(s.id, ids)
            if !f.isEmpty { meldung = "Fahrer nicht gespeichert: \(f)"; return }
        }
        datum = nil; von = nil; bis = nil; notiz = nil
        neue = [""]
        meldung = neuVon != nil || neuBis != nil || neuDatum != nil ? "Gespeichert, die Fahrer bestätigen die neuen Zeiten." : "Gespeichert."
        await speicher.laden()
    }
}

// MARK: - Kacheln und Standby-Fahrten in Alle Fahrten

/// Je Standby eine Kachel: Ort, Tag, von–bis, angenommen und wer vor Ort, mit Gast, auf Rueckweg.
struct StandbyKacheln: View {
    @ObservedObject var speicher: DispoStandbySpeicher
    let oeffnen: (UUID) -> Void
    var body: some View {
        let aktuell = speicher.aktuelle
        if !aktuell.isEmpty {
            VStack(spacing: 12) {
                ForEach(aktuell) { s in
                    let ja = s.fahrer.filter { $0.status == "accepted" }
                    let n = { (z: String) in ja.filter { $0.zustand == z }.count }
                    Button { oeffnen(s.id) } label: {
                        ZStack(alignment: .top) {
                            VStack(alignment: .leading, spacing: 0) {
                                Text(s.ortName).font(.grotesk(22, .bold)).foregroundStyle(.white).lineLimit(1)
                                Text("\(StandbyZeit.tagKurz(s.datum)) \(s.von) – \(s.bis)").font(.grotesk(30, .bold))
                                    .foregroundStyle(DispoStandbySpeicher.lime).lineLimit(1).minimumScaleFactor(0.7)
                                Text("\(ja.count)/\(s.fahrer.count) angenommen · \(n("vor_ort")) vor Ort · \(n("mit_gast")) mit Gast · \(n("rueckweg")) Rückweg")
                                    .font(.grotesk(13, .bold)).foregroundStyle(DispoStandbySpeicher.grau)
                                    .lineLimit(2).padding(.top, 6)
                            }
                            .padding(.horizontal, 16).padding(.top, 44).padding(.bottom, 14)
                            .frame(width: 362, alignment: .leading)
                            Text("Standby").font(.grotesk(16, .bold)).foregroundStyle(.black)
                                .padding(.horizontal, 16).frame(height: 30).background(DispoStandbySpeicher.lime)
                        }
                        .frame(width: 362)
                        .background(Color(hex: 0x1A1A1A))
                        .overlay(Rectangle().strokeBorder(DispoStandbySpeicher.lime, lineWidth: 2))
                    }
                    .buttonStyle(.web)
                }
            }
        }
    }
}

/// Faehrt ein Fahrer vom Event los: „Standby-Fahrt“ mit Abfahrtszeit, Unterwegs bzw. Rueckweg mit
/// Ankunft am Event, danach „Zurück“ mit Uhrzeit. Tipp oeffnet den Standby.
struct StandbyFahrtenListe: View {
    @ObservedObject var speicher: DispoStandbySpeicher
    let oeffnen: (UUID) -> Void
    var body: some View {
        let fahrten = speicher.fahrten.sorted { $0.start > $1.start }
        if !fahrten.isEmpty {
            VStack(spacing: 12) {
                ForEach(fahrten) { f in
                    let s = speicher.aktuelle.first { $0.id == f.standbyID }
                    let p = s?.fahrer.first { $0.driverID == f.driverID }?.profil
                    let status = statusText(f)
                    Button { oeffnen(f.standbyID) } label: {
                        HStack(alignment: .top, spacing: 12) {
                            VStack(alignment: .leading, spacing: 0) {
                                Text("Standby-Fahrt").font(.grotesk(22, .bold)).foregroundStyle(Color(hex: 0x1D1C1D))
                                Text("\(s?.ortName ?? "Event") – \(f.abgesetzt.map { "abgesetzt \(StandbyZeit.uhr($0))" } ?? "Ziel offen")")
                                    .font(.grotesk(13, .medium)).foregroundStyle(Color(hex: 0x1D1C1D).opacity(0.7)).padding(.top, 4)
                                Text(p?.kurz ?? "Fahrer").font(.grotesk(15, .bold)).foregroundStyle(Color(hex: 0x1D1C1D)).padding(.top, 10)
                            }
                            Spacer(minLength: 0)
                            VStack(alignment: .trailing, spacing: 0) {
                                Text(StandbyZeit.uhr(f.start)).font(.grotesk(30, .bold)).foregroundStyle(DispoStandbySpeicher.gruen)
                                Text(status.text).font(.grotesk(12, .bold)).foregroundStyle(status.farbe).padding(.top, 4)
                            }
                        }
                        .padding(.horizontal, 16).padding(.vertical, 12)
                        .frame(width: 362, alignment: .leading)
                        .background(Color.white)
                    }
                    .buttonStyle(.web)
                }
            }
        }
    }

    private func statusText(_ f: DispoStandbySpeicher.Fahrt) -> (text: String, farbe: Color) {
        switch f.status {
        case "unterwegs": return ("Unterwegs", DispoStandbySpeicher.orange)
        case "rueckweg":
            if let a = speicher.ankunft[f.id] { return ("Rückweg · an \(StandbyZeit.uhr(a))", DispoStandbySpeicher.gruen) }
            return ("Rückweg", DispoStandbySpeicher.gruen)
        default:
            return (f.zurueck.map { "Zurück \(StandbyZeit.uhr($0))" } ?? "Beendet", DispoStandbySpeicher.grau)
        }
    }
}
