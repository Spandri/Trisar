import SwiftUI
import Supabase

/// Fahrer-Ansicht der Dispo (wie FahrerAnsichtView.jsx): Ablauf wie der Verlauf der Fahrer-App. Unter jedem
/// Datum zuerst die Stundenerfassung (auch bestaetigte), dann je Dienst Dienststart, Fahrten mit Pausenstart
/// und Pausenende dazwischen, Dienstende. Oben rechts Export: alle Stunden des Fahrers als Excel.
/// Darunter die Dienste.
struct FahrerAnsichtDispo: View {
    let fahrer: DispoFahrer
    let zurueck: () -> Void
    let bearbeiten: () -> Void
    let oeffneFahrt: (UUID) -> Void
    /// Fahrzeug antippen: „Fahrzeug bearbeiten“ dieses Fahrzeugs (onOpenVehicle im Web, 12.11.).
    let oeffneFahrzeug: ((String) -> Void)?

    @ObservedObject private var speicher = DispoFahrtenSpeicher.gemeinsam
    @StateObject private var dienste: FahrerDiensteModell
    @State private var eintraege: [Stunden.Eintrag]?
    @State private var kommende: [AblaufDienst] = []
    /// Treffpunkt und Notiz je Dienst-ID (klein geschrieben), wie useTreffpunkte im Web.
    @State private var treffpunkte: [String: DienstTreffpunkt] = [:]
    /// Eigene Orte liefern das Icon des Treffpunkts.
    @ObservedObject private var orte = OrteSpeicher.geteilt
    @State private var exportLaeuft = false
    @State private var exportDatei: TeilbareDatei?
    @State private var exportFehler = false

    init(fahrer: DispoFahrer, zurueck: @escaping () -> Void, bearbeiten: @escaping () -> Void, oeffneFahrt: @escaping (UUID) -> Void,
         oeffneFahrzeug: ((String) -> Void)? = nil) {
        self.fahrer = fahrer
        self.oeffneFahrzeug = oeffneFahrzeug
        self.zurueck = zurueck
        self.bearbeiten = bearbeiten
        self.oeffneFahrt = oeffneFahrt
        _dienste = StateObject(wrappedValue: FahrerDiensteModell(fahrerID: fahrer.id))
    }

    private let lime = Color(hex: 0xE3F654)
    private let rot = Color(hex: 0xFF6F63)
    private let grau = Color(hex: 0x868687)

    /// Ein Dienst im Ablauf. eintrag nur bis heute (stunden_verlauf), danach geplant.
    struct AblaufDienst: Identifiable {
        let id: String; let datum: String; let beginn: String; let ende: String
        let pausen: [Stunden.DienstPause]; var eintrag: Stunden.Eintrag? = nil
    }

    /// Ein Tag im Ablauf: Dienste (mit ihren Fahrten) und lose Fahrten nach Uhrzeit.
    private struct AblaufTag: Identifiable {
        let datum: String; var eintraege: [Teil]
        var id: String { datum }
        enum Teil: Identifiable {
            case dienst(AblaufDienst, [DispoFahrt]), fahrt(DispoFahrt)
            var id: String { switch self { case .dienst(let d, _): "d\(d.id)"; case .fahrt(let f): "f\(f.id)" } }
        }
    }

    private static func minuten(_ hm: String) -> Int? {
        let t = hm.split(separator: ":")
        guard t.count >= 2, let h = Int(t[0]), let m = Int(t[1].prefix(2)) else { return nil }
        return h * 60 + m
    }

    /// Hat der Dienst eine Stundenkarte? Vorbei, oder heute und laeuft schon.
    private static func hatKarte(_ e: Stunden.Eintrag) -> Bool {
        e.vorbei || (e.dienst.datum == Stunden.heuteDatum && e.vorschlag?.beginn != nil)
    }

    private var ablaufDienste: [AblaufDienst] {
        (eintraege ?? []).map { e in
            AblaufDienst(id: e.dienst.id.uuidString.lowercased(), datum: e.dienst.datum, beginn: e.dienst.beginn ?? "",
                         ende: e.dienst.ende ?? "", pausen: e.dienst.pausen ?? [], eintrag: e)
        } + kommende
    }

    /// Ablauf ab gestern. Aeltere Tage nur, solange dort Stunden noch nicht bestaetigt sind.
    private var tage: [AblaufTag] {
        let ab = StundenExport.isoTag(Date().addingTimeInterval(-86400))
        let alle = ablaufDienste
        let offen: (AblaufDienst) -> Bool = { d in
            guard let e = d.eintrag else { return false }
            return Self.hatKarte(e) && e.zettel?.status != "bestaetigt"
        }
        let zeigen: (String) -> Bool = { tag in tag.isEmpty || tag >= ab || alle.contains { $0.datum == tag && offen($0) } }
        var gesehen = Set<String>()
        let fahrten = speicher.fahrten.filter { f in
            guard f.fahrerIds.contains(fahrer.id), !f.archiviert, !gesehen.contains(f.id) else { return false }
            gesehen.insert(f.id)
            return zeigen(String(f.datum.prefix(10)))
        }
        // Dienstfenster in Minuten, ueber Mitternacht hinaus verlaengert.
        var rahmen: [(d: AblaufDienst, von: Int?, bis: Int?, fahrten: [DispoFahrt])] = alle.filter { zeigen($0.datum) }.map { d in
            let von = Self.minuten(d.beginn)
            var bis = Self.minuten(d.ende)
            if let v = von, let b = bis, b <= v { bis = b + 1440 }
            return (d, von, bis, [])
        }
        var lose: [(String, Int, DispoFahrt)] = []
        for f in fahrten {
            let tag = String(f.datum.prefix(10))
            let m = Self.minuten(f.startZeit) ?? Int.max
            if let i = rahmen.firstIndex(where: { $0.d.datum == tag && $0.von != nil && $0.bis != nil && m >= $0.von! && m <= $0.bis! }) {
                rahmen[i].fahrten.append(f)
            } else {
                lose.append((tag, m, f))
            }
        }
        var nachTag: [String: [(Int, AblaufTag.Teil)]] = [:]
        for r in rahmen {
            nachTag[r.d.datum, default: []].append((r.von ?? Int.max, .dienst(r.d, r.fahrten.sorted { (Self.minuten($0.startZeit) ?? 0) < (Self.minuten($1.startZeit) ?? 0) })))
        }
        for (tag, m, f) in lose { nachTag[tag.isEmpty ? "9999-99-99" : tag, default: []].append((m, .fahrt(f))) }
        return nachTag.keys.sorted().map { tag in
            AblaufTag(datum: tag, eintraege: nachTag[tag]!.sorted { $0.0 < $1.0 }.map(\.1))
        }
    }

    private var fahrtenAnzahl: Int {
        tage.reduce(0) { n, t in n + t.eintraege.reduce(0) { k, e in
            switch e { case .fahrt: k + 1; case .dienst(_, let f): k + f.count }
        } }
    }

    var body: some View {
        ZStack {
            DispoHintergrund().ignoresSafeArea()
            FlussLeinwand {
                VStack(alignment: .leading, spacing: 0) {
                    HStack {
                        ZurueckKnopf(aktion: zurueck).frame(width: 50, height: 50)
                        Spacer()
                        ExportKnopf(busy: exportLaeuft) { Task { await exportieren() } }
                    }
                    Text(fahrer.name.isEmpty ? "Fahrer" : fahrer.name).grotesk(42, .bold, abstand: -0.5).foregroundStyle(lime)
                        .fixedSize(horizontal: false, vertical: true).padding(.top, 30)
                    if !fahrer.vehicleId.isEmpty, let oeffneFahrzeug {
                        // Fahrzeug unterstrichen in Lime, Rest der Zeile wie sonst.
                        Button { oeffneFahrzeug(fahrer.vehicleId) } label: {
                            HStack(spacing: 0) {
                                Text(fahrer.vehicle.isEmpty ? "Fahrzeug" : fahrer.vehicle)
                                    .grotesk(16, .medium).foregroundStyle(lime)
                                    .padding(.bottom, 4)
                                    .overlay(alignment: .bottom) { Rectangle().fill(lime).frame(height: 1) }
                                if let rest = dienstText {
                                    Text(" · \(rest)").grotesk(16, .medium).foregroundStyle(.white.opacity(0.7))
                                }
                            }
                            .multilineTextAlignment(.leading)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.web)
                        .padding(.top, 6)
                    } else {
                        Text(kopfZeile).grotesk(16, .medium).foregroundStyle(.white.opacity(0.7)).padding(.top, 6)
                    }

                    abschnitt("Ablauf", zahl: fahrtenAnzahl == 0 ? nil : fahrtenAnzahl)
                    VStack(alignment: .leading, spacing: 12) {
                        ForEach(Array(tage.enumerated()), id: \.element.id) { i, t in
                            if t.datum != "9999-99-99" { tagZeile(t.datum, erster: i == 0) }
                            // Stundenerfassung immer als erstes unter dem Datum.
                            ForEach(t.eintraege) { e in
                                if case .dienst(let d, _) = e, let st = d.eintrag, Self.hatKarte(st) {
                                    DispoStundenKarte(eintrag: st, fahrerID: fahrer.id, ohneTitel: true) { Task { await stundenLaden() } }
                                        .padding(.bottom, 6)
                                }
                            }
                            ForEach(t.eintraege) { e in
                                switch e {
                                case .fahrt(let f): fahrtKarte(f)
                                case .dienst(let d, let f): dienstBlock(d, fahrten: f)
                                }
                            }
                        }
                        if tage.isEmpty {
                            Text("Keine Fahrten und Dienste ab gestern.").grotesk(16, .medium).foregroundStyle(lime.opacity(0.7))
                        }
                    }
                    .padding(.top, 14)

                    FahrerDiensteAbschnitt(m: dienste, fahrerName: fahrer.name)
                        .frame(width: 362, alignment: .topLeading)
                        .padding(.top, 32)
                }
                .frame(width: 362, alignment: .leading)
                .padding(.leading, 20)
                .padding(.top, 60)
                .padding(.bottom, 120)
            }
        }
        .overlay { FussleisteUnten() }
        .task { speicher.starten() }
        .task { await stundenLaden() }
        .task { await dienste.laden() }
        .task { await kommendeLaden() }
        .task(id: treffpunktSchluessel) { await treffpunkteLaden() }
        .sheet(item: $exportDatei) { d in DateiTeilen(url: d.url).ignoresSafeArea() }
        .alert("Export fehlgeschlagen.", isPresented: $exportFehler) { Button("OK", role: .cancel) {} }
    }

    private var kopfZeile: String {
        ([fahrer.vehicle.isEmpty ? "Kein Fahrzeug" : fahrer.vehicle] + [dienstText].compactMap { $0 }).joined(separator: " · ")
    }

    private var dienstText: String? {
        guard !fahrer.serviceStartTime.isEmpty || !fahrer.serviceEndTime.isEmpty else { return nil }
        return "Dienst \(fahrer.serviceStartTime.isEmpty ? "?" : fahrer.serviceStartTime)–\(fahrer.serviceEndTime.isEmpty ? "?" : fahrer.serviceEndTime)"
    }

    private func abschnitt(_ titel: String, zahl: Int?) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text(titel).grotesk(26, .bold, abstand: -0.5).foregroundStyle(lime)
            Spacer()
            if let zahl { Text("\(zahl)").grotesk(13, .medium).foregroundStyle(.white.opacity(0.5)) }
        }
        .frame(width: 362)
        .padding(.top, 32)
    }

    private func tagZeile(_ tag: String, erster: Bool) -> some View {
        HStack(spacing: 0) {
            Rectangle().fill(lime).frame(width: 44, height: 2)
            Spacer(minLength: 0)
            Text(Datum.trennzeile(tag)).grotesk(26, .bold, abstand: -0.5).foregroundStyle(lime).lineLimit(1)
            Spacer(minLength: 0)
            Rectangle().fill(lime).frame(width: 44, height: 2)
        }
        .frame(width: 362)
        .padding(.top, erster ? 0 : 12)
        .padding(.bottom, 12)
    }

    private func fahrtKarte(_ f: DispoFahrt) -> some View {
        DispoFahrtKarte(fahrt: f, zeiten: f.zeiten, datumAlsStatus: false, wischen: false,
                        oeffnen: { if let id = UUID(uuidString: f.id) { oeffneFahrt(id) } },
                        erledigt: {}, archivieren: {}, duplizieren: {})
    }

    /// Zeile wie im Verlauf der Fahrer-App: Rahmen und Text in einer Farbe.
    private func statusZeile(_ text: String, _ farbe: Color) -> some View {
        Text(text).grotesk(24, .bold, abstand: 0.5).foregroundStyle(farbe)
            .padding(.horizontal, 16).frame(width: 362, height: 48, alignment: .leading)
            .overlay(Rectangle().strokeBorder(farbe, lineWidth: 1))
    }

    private enum DienstZeile: Identifiable {
        case fahrt(DispoFahrt), pause(String, String)
        var id: String { switch self { case .fahrt(let f): "f\(f.id)"; case .pause(let k, _): k } }
    }

    /// Ein Dienst: Dienststart, Fahrten und Pausen nach Uhrzeit, Dienstende.
    @ViewBuilder private func dienstBlock(_ d: AblaufDienst, fahrten: [DispoFahrt]) -> some View {
        let start = Self.minuten(d.beginn)
        var zeilen: [(Double, DienstZeile)] = fahrten.map { (Double(Self.minuten($0.startZeit) ?? 0), .fahrt($0)) }
        let _ = d.pausen.enumerated().forEach { i, p in
            let von = p.von.flatMap(Self.minuten)
            var bis = p.bis.flatMap(Self.minuten)
            if let v = von, let b = bis, b < v { bis = b + 1440 }
            var mv = Double(von ?? -1), mb = Double(bis ?? von ?? -1) + 0.5
            if let s = start, mv < Double(s) { mv += 1440; mb += 1440 }
            zeilen.append((mv, .pause("ps\(i)", "Pausenstart \(String((p.von ?? "").prefix(5)))")))
            zeilen.append((mb, .pause("pe\(i)", "Pausenende \(String((p.bis ?? "").prefix(5)))")))
        }
        let sortiert = zeilen.sorted { $0.0 < $1.0 }.map(\.1)
        VStack(alignment: .leading, spacing: 12) {
            if let tp = treffpunkte[d.id], !tp.leer {
                dienstStartMitOrt(d.beginn.isEmpty ? "--:--" : String(d.beginn.prefix(5)), tp)
            } else {
                statusZeile("Dienststart \(d.beginn.isEmpty ? "--:--" : String(d.beginn.prefix(5)))", lime)
            }
            ForEach(sortiert) { z in
                switch z {
                case .fahrt(let f): fahrtKarte(f)
                case .pause(_, let text): statusZeile(text, grau)
                }
            }
            statusZeile("Dienstende \(d.ende.isEmpty ? "--:--" : String(d.ende.prefix(5)))", rot)
        }
    }

    /// Dienststart mit Treffpunkt (DienstStartMitOrt im Web): Lime-Rahmen, darunter Ort-Kachel mit Name
    /// (und Adresse, wenn anders), darunter die Notiz in Grau.
    private func dienstStartMitOrt(_ zeit: String, _ tp: DienstTreffpunkt) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("Dienststart \(zeit)").grotesk(24, .bold, abstand: 0.5).foregroundStyle(lime)
            if tp.hatOrt {
                HStack(spacing: 20) {
                    RoundedRectangle(cornerRadius: 12).fill(Color(hex: 0x242525)).frame(width: 44, height: 44)
                        .overlay(Image(tp.iconGrau(orte)).resizable().scaledToFit().frame(width: 24, height: 24))
                    VStack(alignment: .leading, spacing: 0) {
                        Text(tp.name).grotesk(18, .bold, abstand: -0.5).foregroundStyle(.white).lineLimit(1)
                        if !tp.adresse.isEmpty && tp.adresse != tp.name {
                            Text(tp.adresse).grotesk(13, .medium).foregroundStyle(.white.opacity(0.5)).lineLimit(1)
                        }
                    }
                }
                .padding(.top, 8).padding(.leading, -4)
            }
            if !tp.notiz.isEmpty {
                Text(tp.notiz).grotesk(15, .bold, abstand: -0.3).foregroundStyle(grau)
                    .fixedSize(horizontal: false, vertical: true).padding(.top, 10)
            }
        }
        .padding(.horizontal, 16).padding(.top, 14).padding(.bottom, 12)
        .frame(width: 362, alignment: .leading)
        .overlay(Rectangle().strokeBorder(lime, lineWidth: 1))
    }

    private var treffpunktSchluessel: String { ablaufDienste.map(\.id).sorted().joined(separator: ",") }

    /// Treffpunkte der gezeigten Dienste in einer Abfrage. Fehlt die Tabelle, bleibt es leer.
    private func treffpunkteLaden() async {
        let ids = ablaufDienste.map(\.id).filter { !$0.isEmpty }
        guard !ids.isEmpty else { treffpunkte = [:]; return }
        await orte.ladenFallsNoetig()
        let zeilen: [DienstTreffpunkt] = (try? await Backend.client.from("dienst_treffpunkt")
            .select("dienst_id, ort_id, name, adresse, notiz").in("dienst_id", values: ids).execute().value) ?? []
        treffpunkte = Dictionary(zeilen.compactMap { t in t.dienstID.map { ($0.uuidString.lowercased(), t) } },
                                 uniquingKeysWith: { a, _ in a })
    }

    private func exportieren() async {
        exportLaeuft = true
        do { exportDatei = TeilbareDatei(url: try await StundenExport.alleVon(fahrer.id)) } catch { exportFehler = true }
        exportLaeuft = false
    }

    /// Kommende Dienste (ab morgen) mit ihren geplanten Pausen. Bis heute kommen sie aus stunden_verlauf.
    private func kommendeLaden() async {
        struct Zeile: Decodable { let id: String; let service_date: String; let service_start_time: String?; let service_end_time: String?; let status: String? }
        struct PausenZeile: Decodable { let dienst_id: String; let pausen: [Stunden.DienstPause]? }
        let heute = StundenExport.isoTag(Date())
        let zeilen: [Zeile] = (try? await Backend.client.from("driver_service_requests")
            .select("id, service_date, service_start_time, service_end_time, status")
            .eq("driver_id", value: fahrer.id).gt("service_date", value: heute).order("service_date").limit(30)
            .execute().value) ?? []
        let liste = zeilen.filter { ["accepted", "assigned", "approved"].contains(($0.status ?? "").lowercased()) }
        let ids = liste.map(\.id)
        let pausen: [PausenZeile] = ids.isEmpty ? [] : ((try? await Backend.client.from("dienst_pausen").select("dienst_id, pausen")
            .in("dienst_id", values: ids).execute().value) ?? [])
        let je = Dictionary(pausen.map { ($0.dienst_id.lowercased(), $0.pausen ?? []) }, uniquingKeysWith: { a, _ in a })
        kommende = liste.map { z in
            AblaufDienst(id: z.id.lowercased(), datum: z.service_date, beginn: String((z.service_start_time ?? "").prefix(5)),
                         ende: String((z.service_end_time ?? "").prefix(5)), pausen: je[z.id.lowercased()] ?? [])
        }
    }

    private struct Parameter: Encodable { let p_driver: String; let p_tage: Int }
    private func stundenLaden() async {
        eintraege = (try? await Backend.client.rpc("stunden_verlauf", params: Parameter(p_driver: fahrer.id, p_tage: 14)).execute().value) ?? []
    }
}

// MARK: - Stundenkarte (wie FahrerStundenKarten.jsx bzw. HeuteStunden der Fahrer-App)

private struct DispoStundenKarte: View {
    let eintrag: Stunden.Eintrag
    let fahrerID: String
    /// Im Ablauf steht der Tag schon als Trenner darueber.
    var ohneTitel = false
    let nachher: () -> Void

    private struct Werte { var start: Date; var ende: Date; var pausen: [(von: Date, bis: Date)] }
    @State private var werte: Werte?
    @State private var notiz = ""
    @State private var busy = false
    @State private var fehler: String?
    @State private var loeschFrage = false

    private let lime = Color(hex: 0xE3F654)
    private let rot = Color(hex: 0xFF6F63)
    private let orange = Color(hex: 0xFFCD8A)
    private let gruen = Color(hex: 0x59BE80)
    private let flaeche = Color(hex: 0x1A1A1A)

    private var z: Stunden.Zettel? { eintrag.zettel }
    private var v: Stunden.Vorschlag? { eintrag.vorschlag }
    private var laeuftNoch: Bool {
        !eintrag.vorbei || (v?.fahrten ?? []).contains { Stunden.laeuftStatus.contains(($0.status ?? "").lowercased()) }
    }

    /// Gezeigter Stand: Zettel, sonst Vorschlag (laufender Dienst bis jetzt).
    private var stand: (start: Date, ende: Date?, pausen: [(Date, Date?)], arbeits: Int)? {
        if let z, let b = Stunden.datum(z.beginn), let e = Stunden.datum(z.ende), e > b {
            let p = (z.pausen ?? []).compactMap { p -> (Date, Date?)? in Stunden.datum(p.von).map { ($0, Stunden.datum(p.bis)) } }
            return (b, e, p, z.arbeits_min)
        }
        guard let b = Stunden.datum(v?.beginn_genau ?? v?.beginn) else { return nil }
        let ende = laeuftNoch ? nil : Stunden.datum(v?.ende_genau ?? v?.ende)
        let bis = ende ?? max(Date(), b)
        let p = (v?.pausen ?? []).compactMap { p -> (Date, Date?)? in
            guard let von = Stunden.datum(p.von), von <= bis else { return nil }
            return (von, Stunden.datum(p.bis))
        }
        let genau = max(0, bis.timeIntervalSince(b) / 60 - Stunden.pausenMin(p, bis: bis))
        return (b, ende, p, ende != nil ? Stunden.halbeAuf(genau) : Int(genau))
    }

    var body: some View {
        if let s = stand { karte(s) }
    }

    @ViewBuilder private func karte(_ s: (start: Date, ende: Date?, pausen: [(Date, Date?)], arbeits: Int)) -> some View {
        let arbeits: Int = {
            guard let w = werte else { return s.arbeits }
            let p = w.pausen.map { ($0.von, Optional($0.bis)) }
            return Stunden.halbeAuf(w.ende.timeIntervalSince(w.start) / 60 - Stunden.pausenMin(p, bis: w.ende))
        }()
        let rand: Color = werte != nil || z == nil ? lime
            : z?.status == "bestaetigt" ? gruen : z?.status == "eingereicht" ? lime : z?.status == "zurueckgewiesen" ? rot : orange
        VStack(alignment: .leading, spacing: 0) {
            if !ohneTitel {
                Text(Stunden.tag(eintrag.dienst.datum)).grotesk(14, .bold).foregroundStyle(.white.opacity(0.7)).padding(.bottom, 8)
            }
            VStack(spacing: 0) {
                Text("Stundenerfassung").grotesk(18, .bold, abstand: -0.5).foregroundStyle(lime).frame(height: 23).padding(.top, 11)
                FlussZeile(abstand: 5) {
                    if let w = werte {
                        kasten("Start", oben: zeitFeld(w.start) { werte?.start = $0 }, aktiv: true)
                        ForEach(w.pausen.indices, id: \.self) { i in
                            kasten("Pause", oben: zeitFeld(w.pausen[i].von) { werte?.pausen[i].von = $0 },
                                   unten: zeitFeld(w.pausen[i].bis) { werte?.pausen[i].bis = $0 }, grau: true, aktiv: true) {
                                werte?.pausen.remove(at: i)
                            }
                        }
                        Button(action: pauseHinzufuegen) {
                            VStack(spacing: 8) {
                                Text("+").grotesk(30, .bold).foregroundStyle(lime)
                                    .frame(width: 78, height: 78)
                                    .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(lime, style: StrokeStyle(lineWidth: 2, dash: [5, 4])))
                                Text("Pause").grotesk(16, .bold, abstand: -0.5).foregroundStyle(lime)
                            }
                        }
                        .buttonStyle(.web)
                        kasten("Ende", oben: zeitFeld(w.ende) { werte?.ende = $0 }, aktiv: true)
                    } else {
                        kasten("Start", oben: text(Stunden.uhr(s.start), gross: true))
                        ForEach(Array(s.pausen.enumerated()), id: \.offset) { _, p in
                            kasten("Pause", oben: text(Stunden.uhr(p.0)), unten: p.1.map { text(Stunden.uhr($0)) }, grau: true)
                        }
                        if let e = s.ende { kasten("Ende", oben: text(Stunden.uhr(e), gross: true)) }
                    }
                }
                .padding(.horizontal, 10).padding(.top, 21)
                Text(String(format: "%02d:%02d", arbeits / 60, arbeits % 60)).grotesk(35, .bold, abstand: -0.5)
                    .foregroundStyle(Color(hex: 0xE2F754)).monospacedDigit().frame(height: 45).padding(.top, 9)
            }
            .padding(.bottom, 12)
            .frame(width: 362)
            .frame(minHeight: 220, alignment: .top)
            .background(flaeche)
            .overlay(Rectangle().strokeBorder(rand, lineWidth: 2))

            // Standby am Event-Ort an diesem Tag (FahrerStundenKarten.jsx).
            ForEach(Array((eintrag.standby ?? []).enumerated()), id: \.offset) { _, sb in
                Text("Standby \(sb.ort ?? "") \(sb.von ?? "")–\(sb.bis ?? "")").grotesk(14, .bold)
                    .foregroundStyle(Color(hex: 0x868687)).lineLimit(1).padding(.top, 6)
            }

            if werte == nil {
                let st = statusText
                Text(st.0).grotesk(14, .bold).foregroundStyle(st.1).padding(.top, 10)
                if let b = z?.begruendung, !b.isEmpty, z?.status == "eingereicht" {
                    Text("Fahrer: „\(b)“").grotesk(14, .medium).foregroundStyle(.white.opacity(0.7)).padding(.top, 2)
                }
                if let n = z?.dispo_notiz, !n.isEmpty, z?.status != "eingereicht" {
                    Text("Dispo: „\(n)“").grotesk(14, .medium).foregroundStyle(.white.opacity(0.7)).padding(.top, 2)
                }
                if (!laeuftNoch || z != nil) && z?.status != "bestaetigt" {
                    HStack(spacing: 10) {
                        knopf("Bearbeiten", farbe: rot) {
                            let ende = s.ende ?? Date()
                            werte = Werte(start: s.start, ende: ende, pausen: s.pausen.map { ($0.0, $0.1 ?? ende) })
                            notiz = ""; fehler = nil
                        }
                        if z?.status == "eingereicht" { knopf("Bestätigen", farbe: gruen) { Task { await bestaetigen() } } }
                    }
                    .padding(.top, 10)
                }
                // Bestaetigt: wie Ablehnen und Annehmen ein Knopfpaar, Loeschen und Bearbeiten.
                if z?.status == "bestaetigt" {
                    HStack(spacing: 10) {
                        knopf("Löschen", farbe: rot) { loeschFrage = true }
                        knopf("Bearbeiten", farbe: lime) {
                            let ende = s.ende ?? Date()
                            werte = Werte(start: s.start, ende: ende, pausen: s.pausen.map { ($0.0, $0.1 ?? ende) })
                            notiz = ""; fehler = nil
                        }
                    }
                    .padding(.top, 10)
                }
                if z != nil && z?.status != "bestaetigt" {
                    Button { loeschFrage = true } label: {
                        Text("Erfasste Stunden löschen").grotesk(14, .bold).foregroundStyle(rot)
                            .frame(width: 362, height: 40)
                            .overlay(Rectangle().strokeBorder(rot.opacity(0.6), lineWidth: 1))
                    }
                    .buttonStyle(.web).disabled(busy).padding(.top, 10)
                }
            } else {
                Text("Zeiten antippen zum Ändern, × entfernt eine Pause, + fügt eine hinzu. Pausen unter 3 Stunden zählen als Arbeitszeit. Der Fahrer muss die Änderung bestätigen.")
                    .grotesk(13, .medium).foregroundStyle(.white.opacity(0.5)).fixedSize(horizontal: false, vertical: true).padding(.top, 8)
                TextField("", text: $notiz, prompt: Text("Notiz an den Fahrer (optional)").foregroundStyle(Color.gray), axis: .vertical)
                    .font(.grotesk(14)).foregroundStyle(.black).lineLimit(3, reservesSpace: true)
                    .padding(12).frame(width: 362).background(Color.white).padding(.top, 12)
                // Reihenfolge Beginn < Pausenanfang < Pausenende < Ende (Stunden.reihenfolgeFehler).
                let reihe = werte.flatMap { w in Stunden.reihenfolgeFehler(start: w.start, ende: w.ende, pausen: w.pausen.map { (von: $0.von, bis: $0.bis) }) }
                if let reihe {
                    Text(reihe).grotesk(14, .medium).foregroundStyle(rot)
                        .frame(width: 362, alignment: .leading).padding(.top, 10)
                }
                Button { Task { await senden() } } label: {
                    HStack {
                        Text("An Fahrer senden").grotesk(16, .bold, abstand: -0.5).foregroundStyle(.black)
                        Spacer()
                        Image("Arrow_Trisar_Icons_01").resizable().scaledToFit().frame(width: 34, height: 20)
                    }
                    .padding(.horizontal, 24).frame(width: 362, height: 56).background(lime)
                }
                .buttonStyle(.web).disabled(busy || reihe != nil).opacity(reihe != nil ? 0.5 : 1).padding(.top, 12)
                Button { werte = nil; fehler = nil } label: {
                    Text("Abbrechen").grotesk(14, .bold).foregroundStyle(.white.opacity(0.6))
                }
                .frame(width: 362).padding(.top, 12)
            }
            if let fehler { Text(fehler).grotesk(14, .medium).foregroundStyle(rot).padding(.top, 10) }
        }
        .frame(width: 362, alignment: .leading)
        .alert("Erfasste Stunden vom \(Stunden.tag(eintrag.dienst.datum)) löschen?", isPresented: $loeschFrage) {
            Button("Löschen", role: .destructive) { Task { await loeschen() } }
            Button("Abbrechen", role: .cancel) {}
        } message: { Text("Der Fahrer kann danach neu erfassen.") }
    }

    private var statusText: (String, Color) {
        switch z?.status {
        case "eingereicht": return ("Fahrer hat bestätigt, bitte prüfen.", lime)
        case "dispo_geaendert": return ("Geändert, wartet auf den Fahrer.", orange)
        case "bestaetigt": return ("Bestätigt.", Color(hex: 0x8DFFAF))
        case "zurueckgewiesen": return ("Zurückgegeben, wartet auf den Fahrer.", rot)
        default: return laeuftNoch ? ("Dienst läuft.", .white.opacity(0.6)) : ("Fahrer hat noch nicht erfasst.", orange)
        }
    }

    // MARK: Bausteine

    private func text(_ t: String, gross: Bool = false) -> AnyView {
        AnyView(Text(t).grotesk(gross ? 22 : 17, .bold, abstand: -0.5).foregroundStyle(gross ? Color(hex: 0xE2F754) : Color(hex: 0x5F5F5F)))
    }

    /// Tipp auf eine Zeit oeffnet ein Drehrad (Stunden, Minuten in 15-Minuten-Schritten).
    private func zeitFeld(_ wert: Date, setzen: @escaping (Date) -> Void) -> AnyView {
        AnyView(ZeitRadFeld(wert: wert, setzen: setzen))
    }

    private func kasten(_ titel: String, oben: AnyView, unten: AnyView? = nil, grau: Bool = false, aktiv: Bool = false,
                        entfernen: (() -> Void)? = nil) -> some View {
        VStack(spacing: 8) {
            VStack(spacing: 4) { oben; if let unten { unten } }
                .frame(width: 78, height: 78)
                .background(RoundedRectangle(cornerRadius: 12).fill(Color(hex: 0x242525)))
                .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(aktiv ? lime : .clear, lineWidth: 2))
                .overlay(alignment: .topTrailing) {
                    if let entfernen {
                        Button(action: entfernen) {
                            Text("×").grotesk(16, .bold).foregroundStyle(.black).frame(width: 24, height: 24).background(Circle().fill(rot))
                        }
                        .buttonStyle(.web).offset(x: 8, y: -8)
                    }
                }
            Text(titel).grotesk(16, .bold, abstand: -0.5).foregroundStyle(grau ? Color(hex: 0x5F5F5F) : .white)
        }
    }

    private func knopf(_ titel: String, farbe: Color, aktion: @escaping () -> Void) -> some View {
        Button(action: aktion) {
            HStack {
                Text(titel).grotesk(16, .regular, abstand: 0.5).foregroundStyle(.black)
                Spacer()
                Image("Arrow_Trisar_Icons_01").resizable().scaledToFit().frame(width: 34, height: 19)
            }
            .padding(.leading, 16).padding(.trailing, 10).frame(height: 56).frame(maxWidth: .infinity).background(farbe)
        }
        .buttonStyle(.web).disabled(busy)
    }

    /// Neue Pause 3 Stunden: an die letzte anschliessend, sonst Mitte des Dienstes.
    private func pauseHinzufuegen() {
        guard let w = werte else { return }
        let ab = w.pausen.last?.bis ?? w.start.addingTimeInterval(max(0, w.ende.timeIntervalSince(w.start) / 2 - 90 * 60))
        let von = Date(timeIntervalSince1970: (ab.timeIntervalSince1970 / 1800).rounded() * 1800)
        werte?.pausen.append((von, von.addingTimeInterval(180 * 60)))
    }

    // MARK: Speichern

    private static let isoAus: ISO8601DateFormatter = { let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime]; return f }()
    private func iso(_ d: Date) -> String { Self.isoAus.string(from: d) }

    private struct Aenderung: Encodable {
        let beginn: String; let ende: String; let pausen: [Stunden.Vorschlag.PauseRoh]
        let pause_min: Int; let arbeits_min: Int; let dispo_notiz: String?
        let status = "dispo_geaendert"; let aktualisiert: String
    }
    private struct Neu: Encodable {
        let driver_id: String; let dienst_id: String; let datum: String
        let beginn: String; let ende: String; let pausen: [Stunden.Vorschlag.PauseRoh]
        let pause_min: Int; let arbeits_min: Int; let dispo_notiz: String?
        let vorschlag: Stunden.Vorschlag?; let status = "dispo_geaendert"; let eingereicht_am: String; let aktualisiert: String
    }

    /// Dispo bearbeitet: Zeiten speichern, der Fahrer muss zustimmen (Stand dispo_geaendert).
    private func senden() async {
        guard let w = werte else { return }
        if let f = Stunden.reihenfolgeFehler(start: w.start, ende: w.ende, pausen: w.pausen.map { (von: $0.von, bis: $0.bis) }) {
            fehler = f; return
        }
        // Enden vor dem Beginn liegen am Folgetag (Nachtdienst).
        let ende = w.ende <= w.start ? w.ende.addingTimeInterval(86400) : w.ende
        let pausen = w.pausen.map { p -> (Date, Date) in
            let von = p.von < w.start ? p.von.addingTimeInterval(86400) : p.von
            return (von, p.bis <= von ? p.bis.addingTimeInterval(86400) : p.bis)
        }
        let pauseMin = Int(Stunden.pausenMin(pausen.map { ($0.0, Optional($0.1)) }, bis: ende).rounded())
        let arbeits = Stunden.halbeAuf(ende.timeIntervalSince(w.start) / 60 - Double(pauseMin))
        let roh = pausen.map { Stunden.Vorschlag.PauseRoh(von: iso($0.0), bis: iso($0.1), art: nil) }
        let n = notiz.trimmingCharacters(in: .whitespacesAndNewlines)
        let jetzt = iso(Date())
        busy = true; fehler = nil
        do {
            if let z {
                try await Backend.client.from("stundenzettel").update(
                    Aenderung(beginn: iso(w.start), ende: iso(ende), pausen: roh, pause_min: pauseMin, arbeits_min: arbeits,
                              dispo_notiz: n.isEmpty ? nil : n, aktualisiert: jetzt)
                ).eq("id", value: z.id.uuidString).execute()
            } else {
                try await Backend.client.from("stundenzettel").insert(
                    Neu(driver_id: fahrerID, dienst_id: eintrag.dienst.id.uuidString, datum: eintrag.dienst.datum,
                        beginn: iso(w.start), ende: iso(ende), pausen: roh, pause_min: pauseMin, arbeits_min: arbeits,
                        dispo_notiz: n.isEmpty ? nil : n, vorschlag: v, eingereicht_am: jetzt, aktualisiert: jetzt)
                ).execute()
            }
            werte = nil
            nachher()
        } catch {
            fehler = "Speichern fehlgeschlagen: \(error.localizedDescription)"
        }
        busy = false
    }

    private func bestaetigen() async {
        guard let z else { return }
        struct Pruefung: Encodable { let status = "bestaetigt"; let geprueft_von: String?; let geprueft_am: String; let aktualisiert: String }
        busy = true; fehler = nil
        let wer = try? await Backend.client.auth.session.user.id.uuidString
        let jetzt = iso(Date())
        do {
            try await Backend.client.from("stundenzettel").update(Pruefung(geprueft_von: wer, geprueft_am: jetzt, aktualisiert: jetzt))
                .eq("id", value: z.id.uuidString).execute()
            nachher()
        } catch { fehler = "Speichern fehlgeschlagen: \(error.localizedDescription)" }
        busy = false
    }

    private func loeschen() async {
        guard let z else { return }
        busy = true; fehler = nil
        do {
            try await Backend.client.from("stundenzettel").delete().eq("id", value: z.id.uuidString).execute()
            nachher()
        } catch { fehler = "Löschen fehlgeschlagen: \(error.localizedDescription)" }
        busy = false
    }
}

/// Kaesten nebeneinander, bei zu vielen Pausen in die naechste Zeile (mittig).
private struct FlussZeile: Layout {
    var abstand: CGFloat
    init(abstand: CGFloat) { self.abstand = abstand }
    private func zeilen(_ breite: CGFloat, _ teile: Subviews) -> [[(Int, CGSize)]] {
        var z: [[(Int, CGSize)]] = [[]]; var x: CGFloat = 0
        for (i, t) in teile.enumerated() {
            let g = t.sizeThatFits(.unspecified)
            if x > 0 && x + g.width > breite { z.append([]); x = 0 }
            z[z.count - 1].append((i, g)); x += g.width + abstand
        }
        return z
    }
    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let b = proposal.width ?? 342
        let z = zeilen(b, subviews)
        let h = z.reduce(0) { $0 + ($1.map(\.1.height).max() ?? 0) } + CGFloat(max(0, z.count - 1)) * 12
        return CGSize(width: b, height: h)
    }
    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var y = bounds.minY
        for zeile in zeilen(bounds.width, subviews) {
            let w = zeile.reduce(0) { $0 + $1.1.width } + CGFloat(max(0, zeile.count - 1)) * abstand
            var x = bounds.minX + (bounds.width - w) / 2
            for (i, g) in zeile {
                subviews[i].place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(g))
                x += g.width + abstand
            }
            y += (zeile.map(\.1.height).max() ?? 0) + 12
        }
    }
}

/// Zeit im Bearbeiten-Modus: Tipp oeffnet unten ein Drehrad wie bei Apple, Minuten in 15er-Schritten.
private struct ZeitRadFeld: View {
    let wert: Date
    let setzen: (Date) -> Void
    @State private var offen = false

    var body: some View {
        Button { offen = true } label: {
            Text(Stunden.uhr(wert)).grotesk(17, .bold, abstand: -0.5).foregroundStyle(.white).frame(width: 74, height: 32)
        }
        .buttonStyle(.web)
        .accessibilityLabel("Zeit ändern")
        .sheet(isPresented: $offen) {
            VStack(spacing: 0) {
                HStack {
                    Spacer()
                    Button("Fertig") { offen = false }.font(.grotesk(17, .bold)).foregroundStyle(Color(hex: 0xE3F654))
                }
                .padding(.horizontal, 20).frame(height: 48)
                ZeitRad(wert: wert, setzen: setzen).frame(height: 216)
                Spacer(minLength: 0)
            }
            .background(Color(hex: 0x1C1C1E).ignoresSafeArea())
            .presentationDetents([.height(300)])
        }
    }
}

/// UIDatePicker als Drehrad: nur Uhrzeit, 15-Minuten-Schritte, Berliner Zeit (auch in Dienste planen).
struct ZeitRad: UIViewRepresentable {
    let wert: Date
    let setzen: (Date) -> Void

    func makeCoordinator() -> Koordinator { Koordinator(setzen: setzen) }

    func makeUIView(context: Context) -> UIDatePicker {
        let p = UIDatePicker()
        p.datePickerMode = .time
        p.preferredDatePickerStyle = .wheels
        p.minuteInterval = 15
        p.timeZone = Stunden.berlin
        p.locale = Locale(identifier: "de_DE")
        p.overrideUserInterfaceStyle = .dark
        // Auf die naechste Viertelstunde, damit das Rad einrastet.
        let viertel = (wert.timeIntervalSince1970 / 900).rounded() * 900
        p.date = Date(timeIntervalSince1970: viertel)
        p.addTarget(context.coordinator, action: #selector(Koordinator.geaendert(_:)), for: .valueChanged)
        return p
    }

    func updateUIView(_ p: UIDatePicker, context: Context) { context.coordinator.setzen = setzen }

    final class Koordinator: NSObject {
        var setzen: (Date) -> Void
        init(setzen: @escaping (Date) -> Void) { self.setzen = setzen }
        @objc func geaendert(_ p: UIDatePicker) { setzen(p.date) }
    }
}
