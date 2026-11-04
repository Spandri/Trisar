import Supabase
import SwiftUI
import UniformTypeIdentifiers

/// ImportView.jsx: Fahrten (mode rides) oder Fahrgaeste (mode guests) aus beliebiger Tabelle.
/// Ablauf: Datei -> Erkennung -> Zuordnung pruefen -> Vorschau -> Import.
/// Im Web ein Fluss-Layout (px 20, pt 60) statt absolutem Raster, deshalb hier VStack in ScrollView.
struct ImportAnsicht: View {
    let modus: SpaltenErkennung.Modus
    /// backView: Fahrt erstellen bzw. Fahrgastliste.
    let zurueck: () -> Void
    /// zielView: Fahrtenliste bzw. Fahrgastliste.
    let zumZiel: () -> Void

    private enum Schritt { case datei, erkennung, zuordnung, fertig }

    @State private var schritt: Schritt = .datei
    @State private var dateiname = ""
    @State private var erkennung: SpaltenErkennung.Ergebnis?
    @State private var zuordnung: [Int: String] = [:]
    @State private var fehler = ""
    @State private var importiert = 0
    @State private var beschaeftigt = false
    @State private var waehlen = false

    private let lime = Color(hex: 0xE3F654)
    private let limeHalb = Color(hex: 0xE3F654).opacity(0.7)
    private let orange = Color(hex: 0xFFCD8A)

    private var felder: [SpaltenErkennung.Feld] { SpaltenErkennung.felder(modus) }
    private var fahrten: Bool { modus == .fahrten }

    private var ergebnis: (fertig: [SpaltenErkennung.Datensatz], unvollstaendig: [SpaltenErkennung.Unvollstaendig]) {
        guard let erkennung else { return ([], []) }
        return fahrten ? SpaltenErkennung.fahrtenBauen(erkennung.datenzeilen, zuordnung)
            : SpaltenErkennung.gaesteBauen(erkennung.datenzeilen, zuordnung)
    }

    var body: some View {
        ZStack(alignment: .bottom) {
            DispoHintergrund().ignoresSafeArea()
            ScrollView(.vertical, showsIndicators: false) {
                VStack(alignment: .leading, spacing: 0) {
                    ZurueckKnopf(aktion: zurueck).frame(width: 50, height: 50)
                    StammTitel(text: t(fahrten ? "sonstige.fahrtenImportTitle" : "sonstige.kundenImportTitle"))
                        .padding(.top, 30)
                    switch schritt {
                    case .datei: dateiSchritt
                    case .erkennung: erkennungSchritt
                    case .zuordnung: zuordnungSchritt
                    case .fertig: fertigSchritt
                    }
                    if !fehler.isEmpty {
                        WebText(text: fehler, groesse: 12, gewicht: .medium, zeilenHoehe: 16, farbe: UIColor(hex: 0xFFCD8A))
                            .padding(.horizontal, 12).padding(.vertical, 8)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(Color(hex: 0x171717))
                            .overlay(Rectangle().strokeBorder(orange.opacity(0.6), lineWidth: 2))
                            .padding(.top, 16)
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
        .fileImporter(isPresented: $waehlen, allowedContentTypes: Self.dateiTypen) { antwort in
            if case let .success(url) = antwort { auswerten(url) }
        }
    }

    /// accept=".xlsx,.xls,.csv,.tsv,.txt,text/csv"
    private static let dateiTypen: [UTType] = [.commaSeparatedText, .tabSeparatedText, .plainText, .text]
        + ["xlsx", "xls"].compactMap { UTType(filenameExtension: $0) }

    // MARK: 1. Datei

    private var dateiSchritt: some View {
        VStack(alignment: .leading, spacing: 0) {
            WebText(text: t("imp.hinweis"), groesse: 13, gewicht: .medium, zeilenHoehe: 18, farbe: UIColor(hex: 0xE3F654).withAlphaComponent(0.7))
                .padding(.top, 24)
            Button { waehlen = true } label: {
                HStack(spacing: 0) {
                    Text(t("sonstige.dateiAuswaehlen")).font(.grotesk(16, .medium)).tracking(0.4).foregroundStyle(Color(hex: 0x1D1C1D))
                    Spacer(minLength: 0)
                    Image("import-datei").resizable().frame(width: 42, height: 40)
                }
                .padding(.horizontal, 16)
                .frame(maxWidth: .infinity).frame(height: 56)
                .background(lime)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .padding(.top, 24)
        }
    }

    // MARK: 2. Erkennung

    private var erkennungSchritt: some View {
        VStack(spacing: 0) {
            ImportFunken(pulsieren: true).foregroundStyle(lime)
            Text(t("imp.erkennt")).font(.grotesk(18, .bold)).foregroundStyle(lime).padding(.top, 14)
            Text(dateiname).font(.grotesk(12, .medium)).foregroundStyle(.white.opacity(0.5)).padding(.top, 6)
        }
        .multilineTextAlignment(.center)
        .frame(maxWidth: .infinity)
        .padding(.top, 40)
    }

    // MARK: 3. Zuordnung und Vorschau

    @ViewBuilder private var zuordnungSchritt: some View {
        if let erkennung {
            let erg = ergebnis
            let zugeordnet = erkennung.spalten.filter { zuordnung[$0.index] != nil }.count
            VStack(alignment: .leading, spacing: 0) {
                HStack {
                    Text(dateiname).font(.grotesk(12, .medium)).foregroundStyle(.white.opacity(0.5)).lineLimit(1).padding(.trailing, 12)
                    Spacer(minLength: 0)
                    Button(action: neuStarten) {
                        Text(t("imp.andereDatei")).font(.grotesk(12, .medium)).underline().foregroundStyle(lime)
                    }
                    .buttonStyle(.plain)
                }
                .padding(.top, 20)

                HStack(spacing: 10) {
                    ImportFunken(pulsieren: false)
                    VStack(alignment: .leading, spacing: 4) {
                        Text(t("imp.zuordnung")).font(.grotesk(20, .bold)).frame(height: 20)
                        Text(t("imp.zugeordnetVon", ["n": "\(zugeordnet)", "gesamt": "\(erkennung.spalten.count)"]))
                            .font(.grotesk(12, .medium)).foregroundStyle(limeHalb)
                    }
                }
                .foregroundStyle(lime)
                .padding(.top, 20)

                VStack(spacing: 8) {
                    ForEach(erkennung.spalten) { spaltenKarte($0) }
                }
                .padding(.top, 14)

                Text(t("imp.vorschau")).font(.grotesk(20, .bold)).foregroundStyle(lime).padding(.top, 24)
                vorschauZeile(erg).padding(.top, 4)

                VStack(alignment: .leading, spacing: 6) {
                    ForEach(Array(erg.fertig.prefix(20).enumerated()), id: \.offset) { _, satz in
                        VStack(alignment: .leading, spacing: 0) {
                            Text(beschreibung(satz)).font(.grotesk(14, .medium)).foregroundStyle(lime).lineLimit(1)
                            let d = detail(satz)
                            if !d.isEmpty {
                                Text(d).font(.grotesk(11, .medium)).foregroundStyle(.white.opacity(0.5)).lineLimit(1)
                            }
                        }
                        .padding(.horizontal, 12).padding(.vertical, 8)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(Color(hex: 0x0F0F0F))
                        .overlay(Rectangle().strokeBorder(lime.opacity(0.4), lineWidth: 2))
                    }
                    if erg.fertig.count > 20 {
                        Text(t("sonstige.weitereDatensaetze", ["n": "\(erg.fertig.count - 20)"]))
                            .font(.grotesk(12, .medium)).foregroundStyle(.white.opacity(0.5))
                    }
                }
                .padding(.top, 10)

                Button { Task { await uebernehmen(erg.fertig) } } label: {
                    HStack(spacing: 0) {
                        Text(beschaeftigt ? t("sonstige.uebernehme")
                            : t(fahrten ? "imp.fahrtenImportieren" : "imp.gaesteImportieren", ["n": "\(erg.fertig.count)"]))
                            .font(.grotesk(16, .medium)).tracking(0.4).foregroundStyle(Color(hex: 0x1D1C1D))
                        Spacer(minLength: 0)
                        Image("Arrow_Trisar_Icons_01").resizable().frame(width: 34, height: 20)
                    }
                    .padding(.horizontal, 16)
                    .frame(maxWidth: .infinity).frame(height: 56)
                    .background(lime)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .disabled(beschaeftigt || erg.fertig.isEmpty)
                .opacity(beschaeftigt || erg.fertig.isEmpty ? 0.4 : 1)
                .padding(.top, 16)
            }
        }
    }

    private func vorschauZeile(_ erg: (fertig: [SpaltenErkennung.Datensatz], unvollstaendig: [SpaltenErkennung.Unvollstaendig])) -> some View {
        var gesehen = Set<String>()
        let fehlend = erg.unvollstaendig.flatMap(\.fehlt).filter { gesehen.insert($0).inserted }
        var zeile = Text(t("imp.bereit", ["n": "\(erg.fertig.count)"])).foregroundColor(limeHalb)
        if !erg.unvollstaendig.isEmpty {
            let felderText = fehlend.map { t("imp.feld.\($0 == "name" ? "vollname" : $0)") }.joined(separator: ", ")
            zeile = zeile + Text(" · " + t("imp.unvollstaendig", ["n": "\(erg.unvollstaendig.count)", "felder": felderText]))
                .foregroundColor(orange)
        }
        return zeile.font(.grotesk(12, .medium))
    }

    private func spaltenKarte(_ spalte: SpaltenErkennung.Spalte) -> some View {
        let feld = zuordnung[spalte.index] ?? ""
        let vorschlagGilt = !feld.isEmpty && feld == spalte.vorschlag
        let sicher = vorschlagGilt && spalte.sicherheit >= 0.8
        let pruefen = vorschlagGilt && !sicher
        return VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 8) {
                Text(spalte.titel).font(.grotesk(15, .bold)).foregroundStyle(feld.isEmpty ? .white.opacity(0.55) : lime).lineLimit(1)
                Spacer(minLength: 0)
                if sicher { abzeichen(t("imp.sicher"), lime) }
                if pruefen { abzeichen(t("imp.pruefen"), orange) }
            }
            Text(spalte.beispiele.prefix(3).joined(separator: " · "))
                .font(.grotesk(11, .medium)).foregroundStyle(.white.opacity(0.45)).lineLimit(1)
                .padding(.top, 3)
            Menu {
                Button(t("imp.nichtImportieren")) { zuordnen(spalte.index, "") }
                ForEach(felder, id: \.key) { f in
                    Button(t("imp.feld.\(f.key)")) { zuordnen(spalte.index, f.key) }
                }
            } label: {
                HStack(spacing: 0) {
                    Text(feld.isEmpty ? t("imp.nichtImportieren") : t("imp.feld.\(feld)"))
                        .font(.grotesk(14, .medium)).foregroundStyle(feld.isEmpty ? .white.opacity(0.6) : lime).lineLimit(1)
                    Spacer(minLength: 0)
                    Text("▾").font(.system(size: 12)).foregroundStyle(feld.isEmpty ? .white.opacity(0.5) : lime)
                }
                .padding(.leading, 12).padding(.trailing, 12)
                .frame(maxWidth: .infinity).frame(height: 38)
                .background(Color.black)
                .overlay(Rectangle().strokeBorder(feld.isEmpty ? .white.opacity(0.25) : lime, lineWidth: 1))
                .contentShape(Rectangle())
            }
            .padding(.top, 8)
            WebText(text: !feld.isEmpty && !vorschlagGilt ? t("imp.vonHandGeaendert") : grundText(spalte),
                    groesse: 10, gewicht: .medium, zeilenHoehe: 13, farbe: UIColor.white.withAlphaComponent(0.4))
                .padding(.top, 6)
        }
        .padding(.horizontal, 12).padding(.vertical, 10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(hex: 0x0F0F0F))
        .overlay(Rectangle().strokeBorder(feld.isEmpty ? .white.opacity(0.12) : lime.opacity(0.55), lineWidth: 2))
    }

    private func abzeichen(_ text: String, _ farbe: Color) -> some View {
        Text(text).font(.grotesk(10, .bold)).foregroundStyle(.black)
            .padding(.horizontal, 8).frame(height: 20).background(farbe)
    }

    private func grundText(_ s: SpaltenErkennung.Spalte) -> String {
        guard s.vorschlag != nil else { return t("imp.keinTreffer") }
        var teile: [String] = []
        if let k = s.grundKopf { teile.append(t("imp.grundKopf", ["titel": k])) }
        if let w = s.grundWerte { teile.append(t("imp.grundWerte", ["anteil": "\(s.grundAnteil)", "art": t("imp.art.\(w)")])) }
        return teile.joined(separator: " · ")
    }

    // MARK: 4. Fertig

    private var fertigSchritt: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(t(fahrten ? "imp.fahrtenImportiert" : "imp.gaesteImportiert", ["n": "\(importiert)"]))
                .font(.grotesk(18, .bold)).foregroundStyle(Color(hex: 0x8DFFAF))
                .padding(.top, 28)
            Button(action: zumZiel) {
                HStack(spacing: 0) {
                    Text(t(fahrten ? "imp.zuDenFahrten" : "imp.zuDenFahrgaesten"))
                        .font(.grotesk(16, .medium)).tracking(0.4).foregroundStyle(Color(hex: 0x1D1C1D))
                    Spacer(minLength: 0)
                    Image("Arrow_Trisar_Icons_01").resizable().frame(width: 34, height: 20)
                }
                .padding(.horizontal, 16)
                .frame(maxWidth: .infinity).frame(height: 56)
                .background(lime)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .padding(.top, 20)
            Button(action: neuStarten) {
                Text(t("imp.weitereDatei")).font(.grotesk(14, .medium)).foregroundStyle(lime)
                    .padding(.horizontal, 16)
                    .frame(maxWidth: .infinity, alignment: .leading).frame(height: 48)
                    .overlay(Rectangle().strokeBorder(lime, lineWidth: 2))
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .padding(.top, 10)
        }
    }

    // MARK: Ablauf

    private func auswerten(_ url: URL) {
        fehler = ""
        dateiname = url.lastPathComponent
        schritt = .erkennung
        let modus = modus
        Task {
            // Kleine Pause, damit die Erkennung als eigener Schritt sichtbar ist (ERKENNUNG_MS).
            async let pause: Void = (try? await Task.sleep(for: .milliseconds(1400))) ?? ()
            let gelesen: Result<SpaltenErkennung.Ergebnis, Error> = await Task.detached {
                let zugriff = url.startAccessingSecurityScopedResource()
                defer { if zugriff { url.stopAccessingSecurityScopedResource() } }
                do { return .success(SpaltenErkennung.erkennen(try TabellenLeser.lesen(url), modus)) } catch { return .failure(error) }
            }.value
            _ = await pause
            switch gelesen {
            case let .success(erg):
                guard !erg.spalten.isEmpty, !erg.datenzeilen.isEmpty else {
                    fehler = t("imp.leer")
                    schritt = .datei
                    return
                }
                erkennung = erg
                zuordnung = Dictionary(uniqueKeysWithValues: erg.spalten.compactMap { s in s.vorschlag.map { (s.index, $0) } })
                schritt = .zuordnung
            case let .failure(e):
                fehler = t("sonstige.dateiLesenFehler", ["message": e.localizedDescription])
                schritt = .datei
            }
        }
    }

    /// Ein Feld gehoert immer nur einer Spalte, wird es anderswo gewaehlt, verliert die alte Spalte die Zuordnung.
    private func zuordnen(_ spaltenIndex: Int, _ feld: String) {
        var neu = zuordnung
        let belegt = felder.first { $0.key == feld }?.belegt ?? []
        for (idx, f) in zuordnung {
            let kollidiert = f == feld || belegt.contains(f) || (felder.first { $0.key == f }?.belegt ?? []).contains(feld)
            if !feld.isEmpty && kollidiert && idx != spaltenIndex { neu.removeValue(forKey: idx) }
        }
        if feld.isEmpty { neu.removeValue(forKey: spaltenIndex) } else { neu[spaltenIndex] = feld }
        zuordnung = neu
    }

    private func uebernehmen(_ saetze: [SpaltenErkennung.Datensatz]) async {
        guard !saetze.isEmpty else { return }
        beschaeftigt = true
        fehler = ""
        defer { beschaeftigt = false }
        do {
            try await SpaltenErkennung.importieren(saetze, modus)
            importiert = saetze.count
            schritt = .fertig
        } catch {
            fehler = t("sonstige.importFehlgeschlagen", ["message": error.localizedDescription])
        }
    }

    private func neuStarten() {
        schritt = .datei
        erkennung = nil
        zuordnung = [:]
        dateiname = ""
        fehler = ""
    }

    // MARK: Vorschau-Texte (describe / detail)

    private func s(_ satz: SpaltenErkennung.Datensatz, _ k: String) -> String {
        if case let .string(v)? = satz[k] { return v }
        return ""
    }

    private func beschreibung(_ satz: SpaltenErkennung.Datensatz) -> String {
        if fahrten {
            let ab = s(satz, "pickup_name"), an = s(satz, "dropoff_name")
            return "\(s(satz, "etd").prefix(5)) \(ab.isEmpty ? "—" : ab) → \(an.isEmpty ? "—" : an)"
        }
        return "\(s(satz, "first_name")) \(s(satz, "last_name"))".trimmingCharacters(in: .whitespaces)
    }

    private func detail(_ satz: SpaltenErkennung.Datensatz) -> String {
        if fahrten {
            var gaeste: [String] = []
            if case let .array(a)? = satz["passengers"] { gaeste = a.compactMap { if case let .string(n) = $0 { return n }; return nil } }
            let flug = s(satz, "flight_number")
            return [s(satz, "ride_date"), flug.isEmpty ? s(satz, "train_number") : flug, gaeste.joined(separator: ", ")]
                .filter { !$0.isEmpty }.joined(separator: " · ")
        }
        return [s(satz, "company"), s(satz, "email"), s(satz, "phone")].filter { !$0.isEmpty }.joined(separator: " · ")
    }

    // MARK: Texte aus admin/src/i18n/de.js

    private func t(_ k: String, _ w: [String: String] = [:]) -> String {
        var s = Self.texte[k] ?? k
        for (a, b) in w { s = s.replacingOccurrences(of: "{\(a)}", with: b) }
        return s
    }

    private static let texte: [String: String] = [
        "sonstige.fahrtenImportTitle": "Fahrten Import",
        "sonstige.kundenImportTitle": "Kunden Import",
        "sonstige.dateiAuswaehlen": "Datei auswählen",
        "sonstige.dateiLesenFehler": "Datei konnte nicht gelesen werden: {message}",
        "sonstige.importFehlgeschlagen": "Import fehlgeschlagen: {message}",
        "sonstige.uebernehme": "Übernehme ...",
        "sonstige.weitereDatensaetze": "+ {n} weitere Datensätze",
        "imp.andereDatei": "Andere Datei",
        "imp.art.anzahl": "Personenzahlen",
        "imp.art.datum": "Datumsangaben",
        "imp.art.datumUhrzeit": "Datum mit Uhrzeit",
        "imp.art.email": "E-Mail-Adressen",
        "imp.art.flug": "Flugnummern",
        "imp.art.flughafenCode": "Flughafenkürzel",
        "imp.art.freitext": "Freitext",
        "imp.art.janein": "Ja/Nein",
        "imp.art.name": "Namen",
        "imp.art.ort": "Orte und Adressen",
        "imp.art.plz": "Postleitzahlen",
        "imp.art.telefon": "Telefonnummern",
        "imp.art.uhrzeit": "Uhrzeiten",
        "imp.art.zug": "Zugnummern",
        "imp.bereit": "{n} bereit",
        "imp.erkennt": "Spalten werden erkannt …",
        "imp.fahrtenImportieren": "{n} Fahrten importieren",
        "imp.fahrtenImportiert": "{n} Fahrten importiert.",
        "imp.feld.abholort": "Abholort",
        "imp.feld.anzahl": "Anzahl Personen",
        "imp.feld.datum": "Datum",
        "imp.feld.datumUhrzeit": "Datum & Uhrzeit",
        "imp.feld.email": "E-Mail",
        "imp.feld.firma": "Firma",
        "imp.feld.flugnummer": "Flug- / Zugnummer",
        "imp.feld.gaeste": "Fahrgäste",
        "imp.feld.gepaeck": "Gepäck",
        "imp.feld.herkunft": "Abflugort",
        "imp.feld.kindersitz": "Kindersitz",
        "imp.feld.nachname": "Nachname",
        "imp.feld.notiz": "Notiz",
        "imp.feld.plz": "PLZ",
        "imp.feld.rollstuhl": "Rollstuhl",
        "imp.feld.sprache": "Sprache",
        "imp.feld.stadt": "Stadt",
        "imp.feld.strasse": "Straße",
        "imp.feld.telefon": "Telefon",
        "imp.feld.uhrzeit": "Abholzeit",
        "imp.feld.vip": "VIP",
        "imp.feld.vollname": "Name",
        "imp.feld.vorname": "Vorname",
        "imp.feld.zielort": "Zielort",
        "imp.feld.zugnummer": "Zugnummer",
        "imp.gaesteImportieren": "{n} Fahrgäste importieren",
        "imp.gaesteImportiert": "{n} Fahrgäste importiert.",
        "imp.grundKopf": "Überschrift „{titel}“",
        "imp.grundWerte": "{anteil} % der Werte: {art}",
        "imp.hinweis": "Beliebige Tabelle aus Excel oder CSV — kein festes Spaltenschema. Die Spalten werden erkannt, du prüfst den Vorschlag und importierst.",
        "imp.keinTreffer": "Keine passende Bedeutung erkannt",
        "imp.leer": "In der Datei wurden keine Datenzeilen gefunden.",
        "imp.nichtImportieren": "Nicht importieren",
        "imp.pruefen": "prüfen",
        "imp.sicher": "sicher",
        "imp.unvollstaendig": "{n} unvollständig, fehlt: {felder}",
        "imp.vonHandGeaendert": "Von Hand zugeordnet",
        "imp.vorschau": "Vorschau",
        "imp.weitereDatei": "Weitere Datei importieren",
        "imp.zuDenFahrgaesten": "Zu den Fahrgästen",
        "imp.zuDenFahrten": "Zu den Fahrten",
        "imp.zugeordnetVon": "{n} von {gesamt} Spalten zugeordnet",
        "imp.zuordnung": "Zuordnung",
    ]
}

/// FunkenIcon aus ImportView.jsx (viewBox 29 x 29.14, Strich 2), mit animate-pulse waehrend der Erkennung.
private struct ImportFunken: View {
    let pulsieren: Bool
    @State private var halb = false

    var body: some View {
        ImportFunkenForm()
            .stroke(style: StrokeStyle(lineWidth: 2 * 22 / 29.14))
            .frame(width: 22, height: 22)
            .opacity(pulsieren && halb ? 0.5 : 1)
            .onAppear {
                guard pulsieren else { return }
                withAnimation(.easeInOut(duration: 1).repeatForever(autoreverses: true)) { halb = true }
            }
    }
}

private struct ImportFunkenForm: Shape {
    /// Jeder Bogen ist "M p0 S c2 p1": erster Kontrollpunkt = Startpunkt.
    private static let boegen: [(CGPoint, CGPoint, CGPoint)] = [
        (.init(x: 12.08, y: 29.07), .init(x: 11.27, y: 16.99), .init(x: 0, y: 16.99)),
        (.init(x: 12.08, y: 4.9), .init(x: 12.89, y: 16.99), .init(x: 24.17, y: 16.99)),
        (.init(x: 12.08, y: 4.9), .init(x: 11.27, y: 16.99), .init(x: 0, y: 16.99)),
        (.init(x: 12.08, y: 29.07), .init(x: 12.89, y: 16.99), .init(x: 24.17, y: 16.99)),
        (.init(x: 22.96, y: 12.15), .init(x: 22.55, y: 6.11), .init(x: 16.92, y: 6.11)),
        (.init(x: 22.96, y: 12.15), .init(x: 23.36, y: 6.11), .init(x: 29, y: 6.11)),
        (.init(x: 22.96, y: 0.07), .init(x: 22.55, y: 6.11), .init(x: 16.92, y: 6.11)),
        (.init(x: 22.96, y: 0.07), .init(x: 23.36, y: 6.11), .init(x: 29, y: 6.11)),
    ]

    func path(in rect: CGRect) -> Path {
        // viewBox 29 x 29.14 mittig in das Quadrat (preserveAspectRatio meet).
        let s = min(rect.width / 29, rect.height / 29.14)
        let dx = rect.minX + (rect.width - 29 * s) / 2, dy = rect.minY + (rect.height - 29.14 * s) / 2
        let p = { (q: CGPoint) in CGPoint(x: dx + q.x * s, y: dy + q.y * s) }
        var pfad = Path()
        for (a, c2, b) in Self.boegen {
            pfad.move(to: p(a))
            pfad.addCurve(to: p(b), control1: p(a), control2: p(c2))
        }
        return pfad
    }
}
