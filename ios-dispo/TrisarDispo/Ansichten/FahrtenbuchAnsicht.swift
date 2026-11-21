import SwiftUI
import Supabase

/// Fahrtenbuch auf der Fahrzeugseite der Dispo (wie Fahrtenbuch.jsx der Web-Dispo).
/// - FahrtenbuchBlock: heller Block zwischen Fahrzeugdaten und Schadensbericht (Kilometerstand, heute,
///   Monat, letzte drei Eintraege). Steht immer da, auch ohne Eintraege. Tipp oeffnet die Seite.
/// - FahrtenbuchSeite: alle Eintraege im Zeitraum, nach Tagen, mit Export (Excel, PDF, CSV).
/// Daten: Datenbank-Funktion fahrtenbuch_lesen (haengt an der Fahrgestellnummer, nicht am Kennzeichen).
/// Export: dispo-admin, Aktion fahrtenbuch_export.
struct Fahrtenbuch: Decodable {
    struct Zeile: Decodable, Identifiable {
        let id: Int
        let tag: String
        let art: String
        let beginn: String?
        let ende: String?
        let km_start: Double?
        let km_ende: Double?
        let km: Double?
        let genau: Bool?
        let von: String?
        let nach: String?
        let fahrer: String?
    }

    let vin: String?
    let kennzeichen: String?
    /// Beginn des gelieferten Zeitraums. Ohne Angabe der Tag des ersten Eintrags, sonst heute.
    let von: String?
    let km_stand: Double?
    let km_heute: Double?
    let km_monat: Double?
    let km_gesamt: Double?
    let km_gast: Double?
    let km_leer: Double?
    let anzahl: Int?
    let zeilen: [Zeile]

    static func lesen(_ fahrzeug: UUID, von: String? = nil, bis: String? = nil) async -> Fahrtenbuch? {
        #if DEBUG
        if ProcessInfo.processInfo.arguments.contains("-fahrtenbuchTest") { return beispiel }
        #endif
        struct Parameter: Encodable { let p_vehicle: UUID; let p_von: String?; let p_bis: String? }
        return try? await Backend.client.rpc("fahrtenbuch_lesen", params: Parameter(p_vehicle: fahrzeug, p_von: von, p_bis: bis))
            .execute().value
    }

    /// Datei fuer das Teilen-Blatt. format: xlsx, pdf oder csv.
    static func exportieren(_ fahrzeug: UUID, von: String, bis: String, format: String) async throws -> URL {
        struct Koerper: Encodable { let aktion = "fahrtenbuch_export"; let vehicle_id: String; let von: String; let bis: String; let format: String }
        struct Antwort: Decodable { let datei: String; let dateiname: String }
        let a: Antwort = try await Backend.client.functions.invoke("dispo-admin", options: FunctionInvokeOptions(
            body: Koerper(vehicle_id: fahrzeug.uuidString.lowercased(), von: von, bis: bis, format: format)))
        guard let daten = Data(base64Encoded: a.datei) else { throw TrisarFehler.text("leer") }
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(a.dateiname)
        try daten.write(to: url, options: .atomic)
        return url
    }

    #if DEBUG
    /// Beispieldaten fuer den Start mit -fahrtenbuchTest (ohne Anmeldung, ohne Datenbank).
    static var beispiel: Fahrtenbuch? {
        let json = """
        {"vin":"WBA21EN0309582583","kennzeichen":"M-X7247","von":"2026-11-16","km_stand":48212,"km_heute":83.4,"km_monat":1284.4,
         "km_gesamt":1284.4,"km_gast":842.1,"km_leer":442.3,"anzahl":5,"zeilen":[
         {"id":5,"tag":"2026-11-17","art":"leer","beginn":"2026-11-17T21:12:00+00:00","ende":"2026-11-17T21:40:00+00:00","km_start":48203,"km_ende":48212,"km":9.3,"genau":true,"von":"Bayerischer Hof","nach":"Depot","fahrer":null},
         {"id":4,"tag":"2026-11-17","art":"gast","beginn":"2026-11-17T20:13:00+00:00","ende":"2026-11-17T21:12:00+00:00","km_start":48165,"km_ende":48203,"km":38.1,"genau":true,"von":"MUC T2","nach":"Hotel Bayerischer Hof, Promenadeplatz","fahrer":"Joris Müller"},
         {"id":3,"tag":"2026-11-17","art":"leer","beginn":"2026-11-17T18:20:00+00:00","ende":"2026-11-17T19:02:00+00:00","km_start":48129,"km_ende":48165,"km":36.0,"genau":true,"von":"Depot","nach":"MUC T2","fahrer":"Joris Müller"},
         {"id":2,"tag":"2026-11-17","art":"gast","beginn":"2026-11-17T13:05:00+00:00","ende":"2026-11-17T13:31:00+00:00","km_start":null,"km_ende":null,"km":15.0,"genau":false,"von":"Hbf","nach":"Allianz Arena","fahrer":"Emily Hiller"},
         {"id":1,"tag":"2026-11-16","art":"gast","beginn":"2026-11-16T17:40:00.123+00:00","ende":"2026-11-16T18:22:00+00:00","km_start":48044,"km_ende":48082,"km":37.6,"genau":true,"von":"Messe Ost","nach":"MUC T1","fahrer":"Joris Müller"}]}
        """
        return try? JSONDecoder().decode(Fahrtenbuch.self, from: Data(json.utf8))
    }
    #endif

    // MARK: Texte

    private static let de = Locale(identifier: "de_DE")

    static func ganz(_ wert: Double?) -> String {
        guard let wert else { return "–" }
        return wert.rounded().formatted(.number.locale(de).precision(.fractionLength(0)))
    }

    static func kmText(_ wert: Double?, genau: Bool) -> String {
        guard let wert else { return "" }
        return genau
            ? "\(wert.formatted(.number.locale(de).precision(.fractionLength(1)))) km"
            : "ca. \(ganz(wert)) km"
    }

    static func uhr(_ iso: String?) -> String {
        guard let iso else { return "" }
        let lesen = ISO8601DateFormatter()
        lesen.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        var datum = lesen.date(from: iso)
        if datum == nil { lesen.formatOptions = [.withInternetDateTime]; datum = lesen.date(from: iso) }
        guard let datum else { return "" }
        let f = DateFormatter(); f.locale = de; f.timeZone = Stunden.berlin; f.dateFormat = "HH:mm"
        return f.string(from: datum)
    }

    /// "2026-11-17" -> "Di. 17.11."
    static func tagText(_ iso: String) -> String {
        let lesen = DateFormatter(); lesen.locale = Locale(identifier: "en_US_POSIX"); lesen.timeZone = Stunden.berlin; lesen.dateFormat = "yyyy-MM-dd"
        guard let datum = lesen.date(from: iso) else { return iso }
        let f = DateFormatter(); f.locale = de; f.timeZone = Stunden.berlin; f.dateFormat = "EEE dd.MM."
        return f.string(from: datum)
    }
}

private let fbDunkel = Color(hex: 0x1C1C1D)
private let fbBlass = Color(red: 28 / 255, green: 28 / 255, blue: 29 / 255, opacity: 0.5)
private let fbLinie = Color(hex: 0xDDDCDC)
private let fbLime = Color(hex: 0xE3F654)

/// Eine Zeile: Uhrzeit links, Strecke in der Mitte, km rechts. Auf der Seite mit Ende und Kilometerstand.
private struct FahrtenbuchZeile: View {
    let z: Fahrtenbuch.Zeile
    var voll = false

    var body: some View {
        let stand: String? = voll && z.km_start != nil && z.km_ende != nil
            ? "\(Fahrtenbuch.ganz(z.km_start)) → \(Fahrtenbuch.ganz(z.km_ende))" : nil
        let unter = [z.fahrer, stand].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · ")
        VStack(spacing: 0) {
            Rectangle().fill(fbLinie).frame(height: 1)
            HStack(alignment: .top, spacing: 10) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(Fahrtenbuch.uhr(z.beginn))
                    if voll { Text(Fahrtenbuch.uhr(z.ende)) }
                }
                .font(.grotesk(12)).foregroundStyle(fbBlass)
                .frame(width: 38, alignment: .leading)
                VStack(alignment: .leading, spacing: 3) {
                    Text(z.art == "gast" ? "Gast" : "Leer").grotesk(10, .bold, abstand: -0.3).foregroundStyle(fbDunkel)
                        .padding(.horizontal, 6).frame(height: 16)
                        .background(z.art == "gast" ? fbLime : Color(hex: 0xECECEC))
                    Text([z.von, z.nach].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " → "))
                        .font(.grotesk(13, .bold)).foregroundStyle(fbDunkel).lineLimit(1)
                    if !unter.isEmpty {
                        Text(unter).font(.grotesk(11)).foregroundStyle(fbBlass).lineLimit(1)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                Text(Fahrtenbuch.kmText(z.km, genau: z.genau != false))
                    .font(.grotesk(13, .bold)).foregroundStyle(fbDunkel).lineLimit(1).fixedSize()
            }
            .padding(.vertical, 9)
        }
    }
}

private struct FahrtenbuchWert: View {
    let titel: String
    let wert: String
    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(titel).font(.grotesk(11)).foregroundStyle(fbBlass).lineLimit(1)
            Text(wert).font(.grotesk(18, .bold)).foregroundStyle(fbDunkel).lineLimit(1).minimumScaleFactor(0.7)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// Die Daten laedt die Fahrzeugseite (eine leere Ansicht wuerde ihr .task nie starten).
struct FahrtenbuchBlock: View {
    let daten: Fahrtenbuch
    let oeffnen: () -> Void

    var body: some View {
        Button(action: oeffnen) { block(daten) }.buttonStyle(.web)
    }

    private func block(_ d: Fahrtenbuch) -> some View {
        let monat: String = {
            let f = DateFormatter(); f.locale = Locale(identifier: "de_DE"); f.timeZone = Stunden.berlin; f.dateFormat = "LLLL"
            return f.string(from: Date())
        }()
        return VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text("Fahrtenbuch").grotesk(20, .bold, abstand: -0.5).foregroundStyle(fbDunkel)
                Spacer()
                Image("Arrow_Trisar_Icons_01").resizable().scaledToFit().frame(width: 26, height: 15)
            }
            Rectangle().fill(fbLinie).frame(height: 1).padding(.top, 12).padding(.bottom, 14)
            HStack(alignment: .top, spacing: 10) {
                FahrtenbuchWert(titel: "Kilometerstand", wert: Fahrtenbuch.ganz(d.km_stand))
                FahrtenbuchWert(titel: "Heute", wert: "\(Fahrtenbuch.ganz(d.km_heute)) km")
                FahrtenbuchWert(titel: monat, wert: "\(Fahrtenbuch.ganz(d.km_monat)) km")
            }
            .padding(.bottom, 14)
            ForEach(d.zeilen.prefix(3)) { FahrtenbuchZeile(z: $0) }
        }
        .padding(29)
        .frame(width: 353, alignment: .leading)
        .background(Color.white)
    }
}

struct FahrtenbuchSeite: View {
    let fahrzeugID: UUID
    let schliessen: () -> Void

    private struct Tag: Identifiable { let id: String; var zeilen: [Fahrtenbuch.Zeile]; var km: Double }

    /// Standard: vom ersten Eintrag bis heute. Den ersten Tag liefert die Datenbank (Anfrage ohne von).
    @State private var von = Date()
    @State private var vonGesetzt = false
    @State private var bis = Date()
    @State private var daten: Fahrtenbuch?
    @State private var busy = ""
    @State private var fehler = false
    @State private var datei: TeilbareDatei?
    @State private var inhaltHoehe: CGFloat = 0

    private let versatz: CGFloat = 20

    init(fahrzeugID: UUID, schliessen: @escaping () -> Void) {
        self.fahrzeugID = fahrzeugID
        self.schliessen = schliessen
    }

    private var gueltig: Bool { StundenExport.isoTag(von) <= StundenExport.isoTag(bis) }

    /// Zeilen nach Tagen, neuester Tag oben.
    private var tage: [Tag] {
        var liste: [Tag] = []
        for z in daten?.zeilen ?? [] {
            if let i = liste.indices.last, liste[i].id == z.tag {
                liste[i].zeilen.append(z); liste[i].km += z.km ?? 0
            } else {
                liste.append(Tag(id: z.tag, zeilen: [z], km: z.km ?? 0))
            }
        }
        return liste
    }

    var body: some View {
        let oben: CGFloat = 130
        let inhalt = oben + inhaltHoehe + 40 + 70
        Leinwand(inhaltHoehe: inhalt, mitHintergrund: false) { rahmen in
            ZStack(alignment: .topLeading) {
                Color.black.frame(width: 402, height: max(inhalt, rahmen))

                ZurueckKnopf(aktion: schliessen).platz(20, versatz + 40, 50, 50)
                VStack(alignment: .leading, spacing: 6) {
                    Text("Fahrtenbuch").grotesk(26, .bold, abstand: -0.5).foregroundStyle(fbLime)
                    Text([daten?.kennzeichen, daten?.vin].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · "))
                        .font(.grotesk(13)).foregroundStyle(.white.opacity(0.6)).lineLimit(1)
                }
                .platz(86, versatz + 42, 292, nil)

                VStack(alignment: .leading, spacing: 0) {
                    HStack(spacing: 8) {
                        datumFeld("Von", $von)
                        datumFeld("Bis", $bis)
                    }
                    HStack(spacing: 8) {
                        exportKnopf("Excel", "xlsx")
                        exportKnopf("PDF", "pdf")
                        exportKnopf("CSV", "csv")
                    }
                    .padding(.top, 10)
                    if fehler {
                        Text("Export fehlgeschlagen.").font(.grotesk(13)).foregroundStyle(Color(hex: 0xFF6B57)).padding(.top, 8)
                    }
                    HStack(alignment: .top, spacing: 10) {
                        FahrtenbuchWert(titel: "Gesamt", wert: "\(Fahrtenbuch.ganz(daten?.km_gesamt)) km")
                        FahrtenbuchWert(titel: "Gast", wert: "\(Fahrtenbuch.ganz(daten?.km_gast)) km")
                        FahrtenbuchWert(titel: "Leer", wert: "\(Fahrtenbuch.ganz(daten?.km_leer)) km")
                    }
                    .padding(20).background(Color.white).padding(.top, 14)

                    ForEach(tage) { tag in
                        VStack(alignment: .leading, spacing: 0) {
                            HStack(alignment: .firstTextBaseline) {
                                Text(Fahrtenbuch.tagText(tag.id)).grotesk(15, .bold, abstand: -0.5).foregroundStyle(fbDunkel)
                                Spacer()
                                Text("\(Fahrtenbuch.ganz(tag.km)) km").font(.grotesk(13, .bold)).foregroundStyle(fbBlass)
                            }
                            .padding(.bottom, 10)
                            ForEach(tag.zeilen) { FahrtenbuchZeile(z: $0, voll: true) }
                        }
                        .padding(.horizontal, 20).padding(.top, 16).padding(.bottom, 8)
                        .background(Color.white).padding(.top, 10)
                    }
                    if daten != nil && tage.isEmpty {
                        Text("Keine Einträge im Zeitraum").font(.grotesk(14, .bold)).foregroundStyle(fbBlass)
                            .padding(20).frame(maxWidth: .infinity, alignment: .leading)
                            .background(Color.white).padding(.top, 10)
                    }
                }
                .frame(width: 353, alignment: .leading)
                .background(GeometryReader { g in
                    Color.clear.preference(key: FahrtenbuchHoehe.self, value: g.size.height)
                })
                .platz(24.5, versatz + oben, 353, nil)
            }
        }
        .onPreferenceChange(FahrtenbuchHoehe.self) { inhaltHoehe = $0 }
        .overlay { FussleisteUnten() }
        .task(id: "\(vonGesetzt)|\(StundenExport.isoTag(von))|\(StundenExport.isoTag(bis))") {
            guard vonGesetzt else {
                let erste = await Fahrtenbuch.lesen(fahrzeugID, von: nil, bis: StundenExport.isoTag(bis))
                daten = erste
                let lesen = DateFormatter(); lesen.locale = Locale(identifier: "en_US_POSIX"); lesen.timeZone = Stunden.berlin; lesen.dateFormat = "yyyy-MM-dd"
                if let tag = erste?.von.flatMap({ lesen.date(from: String($0.prefix(10))) }) { von = tag }
                vonGesetzt = true
                return
            }
            guard gueltig else { return }
            daten = await Fahrtenbuch.lesen(fahrzeugID, von: StundenExport.isoTag(von), bis: StundenExport.isoTag(bis))
        }
        .sheet(item: $datei) { d in DateiTeilen(url: d.url).ignoresSafeArea() }
    }

    private func datumFeld(_ titel: String, _ wert: Binding<Date>) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(titel).grotesk(10, .medium).foregroundStyle(.white.opacity(0.5))
            DatePicker("", selection: wert, displayedComponents: .date)
                .labelsHidden().environment(\.timeZone, Stunden.berlin).environment(\.locale, Locale(identifier: "de_DE"))
                .colorScheme(.dark)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func exportKnopf(_ titel: String, _ format: String) -> some View {
        Button { Task { await exportieren(format) } } label: {
            Text(titel).font(.grotesk(13, .bold)).foregroundStyle(fbLime)
                .frame(maxWidth: .infinity).frame(height: 38)
                .overlay(Rectangle().strokeBorder(fbLime, lineWidth: 1))
                .opacity(busy == format || !gueltig ? 0.5 : 1)
                .contentShape(Rectangle())
        }
        .buttonStyle(.web)
        .disabled(!busy.isEmpty || !gueltig)
    }

    private func exportieren(_ format: String) async {
        busy = format; fehler = false
        do {
            let url = try await Fahrtenbuch.exportieren(fahrzeugID, von: StundenExport.isoTag(von), bis: StundenExport.isoTag(bis), format: format)
            datei = TeilbareDatei(url: url)
        } catch {
            fehler = true
        }
        busy = ""
    }
}

private struct FahrtenbuchHoehe: PreferenceKey {
    static var defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) { value = max(value, nextValue()) }
}

#if DEBUG
/// Nur zum Ansehen ohne Anmeldung: Start mit -fahrtenbuchTest (Block), dazu -seite fuer die volle Seite.
struct FahrtenbuchTest: View {
    @State private var offen = ProcessInfo.processInfo.arguments.contains("-seite")
    private let id = UUID()
    var body: some View {
        Leinwand(inhaltHoehe: 874, mitHintergrund: false) { rahmen in
            ZStack(alignment: .topLeading) {
                Color.black.frame(width: 402, height: rahmen)
                if let d = Fahrtenbuch.beispiel { FahrtenbuchBlock(daten: d) { offen = true }.platz(24.5, 80, 353, nil) }
            }
        }
        .webVollbild(isPresented: $offen) { FahrtenbuchSeite(fahrzeugID: id) { offen = false } }
    }
}
#endif
