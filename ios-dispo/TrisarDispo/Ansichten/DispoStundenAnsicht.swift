import Supabase
import SwiftUI
import UIKit

/// Stunden eines Fahrers in der Dispo (wie admin FahrerStunden.jsx): eingereichte Stunden pruefen,
/// Pausen der Dienste planen, Excel-Export mit frei waehlbarem Zeitraum und Fahrern.
struct DispoStundenAnsicht: View {
    let fahrer: DispoFahrer
    let schliessen: () -> Void

    @State private var verlauf: [Stunden.Eintrag]?
    @State private var dienste: [KommenderDienst] = []
    @State private var pausenJe: [String: [PausePlan]] = [:]
    @State private var fahrtenJe: [String: [TagFahrt]] = [:]
    @State private var alleFahrer: [(id: String, name: String)] = []
    @State private var exportDatei: URL?

    private let lime = Color(hex: 0xE3F654)
    private let orange = Color(hex: 0xFFCD8A)
    private let rot = Color(hex: 0xFF6F63)
    private let gruen = Color(hex: 0x8DFFAF)

    struct KommenderDienst: Decodable, Identifiable, Hashable {
        let id: String; let service_date: String; let service_start_time: String?; let service_end_time: String?; let status: String?
    }
    struct PausePlan: Codable, Hashable {
        var art: String; var von: String?; var bis: String?; var job_id: String?; var nach_min: Int?; var dauer_min: Int?
    }
    struct TagFahrt: Decodable, Hashable { let id: String; let ride_date: String; let etd: String?; let pickup_name: String? }

    private var zuPruefen: [Stunden.Eintrag] { (verlauf ?? []).filter { $0.zettel?.status == "eingereicht" } }
    private var geprueft: [Stunden.Eintrag] { (verlauf ?? []).filter { $0.zettel != nil && $0.zettel?.status != "eingereicht" } }
    private var nichtErfasst: [Stunden.Eintrag] { (verlauf ?? []).filter { $0.zettel == nil && $0.vorbei } }
    private var monatMin: Int {
        let monat = String(Self.isoTag(Date()).prefix(7))
        return (verlauf ?? []).filter { $0.zettel?.status == "bestaetigt" && $0.dienst.datum.hasPrefix(monat) }.reduce(0) { $0 + ($1.zettel?.arbeits_min ?? 0) }
    }

    var body: some View {
        ZStack(alignment: .bottom) {
            DispoHintergrund().ignoresSafeArea()
            ScrollView(.vertical, showsIndicators: false) {
                VStack(alignment: .leading, spacing: 0) {
                    ZurueckKnopf(aktion: schliessen).frame(width: 50, height: 50)
                    StammTitel(text: "Stunden").padding(.top, 30)
                    Text(fahrer.name).font(.grotesk(16, .medium)).foregroundStyle(.white.opacity(0.7)).padding(.top, 6)

                    HStack(spacing: 8) {
                        kachel("\(zuPruefen.count)", "zu prüfen", zuPruefen.isEmpty ? nil : orange)
                        kachel("\(nichtErfasst.count)", "nicht erfasst", nichtErfasst.isEmpty ? nil : rot)
                        kachel(Stunden.hmm(monatMin), "bestätigt (Monat)", nil, hell: true)
                    }
                    .padding(.top, 16)

                    if verlauf == nil { Text("Lädt …").font(.grotesk(14)).foregroundStyle(.white.opacity(0.5)).padding(.top, 24) }

                    if !zuPruefen.isEmpty {
                        ueberschrift("Zu prüfen", zuPruefen.count)
                        VStack(spacing: 10) { ForEach(zuPruefen) { ZettelKarte(eintrag: $0, neuLaden: laden) } }.padding(.top, 10)
                    }
                    if !nichtErfasst.isEmpty {
                        ueberschrift("Nicht erfasst", nichtErfasst.count)
                        VStack(spacing: 6) {
                            ForEach(nichtErfasst) { e in
                                HStack {
                                    Text(Stunden.tag(e.dienst.datum, kurz: true)).font(.grotesk(15, .bold)).foregroundStyle(.white)
                                    Spacer(minLength: 0)
                                    Text("Vorschlag \(Stunden.uhr(e.vorschlag?.beginn))–\(Stunden.uhr(e.vorschlag?.ende)) · \(Stunden.hmm(e.vorschlag?.arbeits_min)) h")
                                        .font(.grotesk(13, .medium)).foregroundStyle(.white.opacity(0.6))
                                }
                                .padding(.horizontal, 16).frame(height: 48)
                                .overlay(Rectangle().strokeBorder(rot.opacity(0.6), lineWidth: 1))
                            }
                        }
                        .padding(.top, 10)
                    }

                    ueberschrift("Dienste und Pausen", nil)
                    VStack(spacing: 10) {
                        if dienste.isEmpty {
                            Text("Keine kommenden Dienste.").font(.grotesk(14)).foregroundStyle(.white.opacity(0.5)).frame(maxWidth: .infinity, alignment: .leading)
                        }
                        ForEach(dienste) { d in
                            DienstPausenKarte(dienst: d, pausen: pausenJe[d.id] ?? [], fahrten: fahrtenJe[d.service_date] ?? []) { neu in
                                pausenJe[d.id] = neu
                                Task { await pausenSpeichern(d.id, neu) }
                            }
                        }
                    }
                    .padding(.top, 10)

                    if !geprueft.isEmpty {
                        ueberschrift("Geprüft", geprueft.count)
                        VStack(spacing: 10) { ForEach(geprueft) { ZettelKarte(eintrag: $0, neuLaden: laden) } }.padding(.top, 10)
                    }

                    ueberschrift("Excel", nil)
                    ExportKarte(fahrer: fahrer, alleFahrer: alleFahrer.isEmpty ? [(fahrer.id, fahrer.name)] : alleFahrer) { exportDatei = $0 }
                        .padding(.top, 10)
                }
                .padding(.horizontal, 20).padding(.top, 60).padding(.bottom, 90)
                .frame(maxWidth: 402, alignment: .leading)
                .frame(maxWidth: .infinity)
            }
            .contentMargins(.vertical, 0, for: .scrollContent)
            .scrollDismissesKeyboard(.interactively)
            .ignoresSafeArea()
            FussleisteUnten()
        }
        .zurueckPerWischen(schliessen)
        .task { await laden() }
        .sheet(item: Binding(get: { exportDatei.map(Teilbar.init) }, set: { if $0 == nil { exportDatei = nil } })) { t in
            DateiTeilen(url: t.url).ignoresSafeArea()
        }
    }

    private struct Teilbar: Identifiable { let url: URL; var id: String { url.path } }

    private func kachel(_ zahl: String, _ text: String, _ farbe: Color?, hell: Bool = false) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(zahl).font(.grotesk(24, .bold)).foregroundStyle(hell ? .black : (farbe ?? lime))
            Text(text).font(.grotesk(11, .medium)).foregroundStyle(hell ? .black.opacity(0.7) : .white.opacity(0.55)).lineLimit(1)
        }
        .padding(.horizontal, 12).frame(maxWidth: .infinity, alignment: .leading).frame(height: 64)
        .background(hell ? lime : Color(hex: 0x0F0F0F))
        .overlay(Rectangle().strokeBorder(hell ? .clear : (farbe ?? lime.opacity(0.35)), lineWidth: 1))
    }

    private func ueberschrift(_ text: String, _ zahl: Int?) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text(text).font(.grotesk(22, .bold)).foregroundStyle(lime)
            Spacer(minLength: 0)
            if let zahl { Text("\(zahl)").font(.grotesk(13, .medium)).foregroundStyle(.white.opacity(0.5)) }
        }
        .padding(.top, 28)
    }

    // MARK: Daten

    static func isoTag(_ d: Date) -> String {
        let f = DateFormatter(); f.locale = Locale(identifier: "en_US_POSIX"); f.timeZone = Stunden.berlin; f.dateFormat = "yyyy-MM-dd"
        return f.string(from: d)
    }

    private func laden() async {
        let c = Backend.client
        let heute = Self.isoTag(Date())
        verlauf = (try? await c.rpc("stunden_verlauf", params: StundenParameter(p_driver: fahrer.id, p_tage: 60)).execute().value) ?? []
        let kommende: [KommenderDienst] = (try? await c.from("driver_service_requests")
            .select("id, service_date, service_start_time, service_end_time, status")
            .eq("driver_id", value: fahrer.id).gte("service_date", value: heute).in("status", values: ["pending", "accepted"])
            .order("service_date").limit(30).execute().value) ?? []
        dienste = kommende
        if !kommende.isEmpty {
            struct Zeile: Decodable { let dienst_id: String; let pausen: [PausePlan] }
            let p: [Zeile] = (try? await c.from("dienst_pausen").select("dienst_id, pausen").in("dienst_id", values: kommende.map(\.id)).execute().value) ?? []
            pausenJe = Dictionary(uniqueKeysWithValues: p.map { ($0.dienst_id, $0.pausen) })
            let j: [TagFahrt] = (try? await c.from("jobs").select("id, ride_date, etd, pickup_name").eq("driver_id", value: fahrer.id)
                .in("ride_date", values: Array(Set(kommende.map(\.service_date)))).order("etd").execute().value) ?? []
            fahrtenJe = Dictionary(grouping: j, by: \.ride_date)
        }
        struct Profil: Decodable { let id: String; let first_name: String?; let last_name: String?; let role: String?; let is_dispo: Bool? }
        let profile: [Profil] = (try? await c.from("profiles").select("id, first_name, last_name, role, is_dispo").order("first_name").execute().value) ?? []
        alleFahrer = profile.filter { $0.is_dispo != true && !["dispo", "dispatcher", "admin", "koordinator", "pruefung"].contains(($0.role ?? "").lowercased()) }
            .map { (id: $0.id, name: "\($0.first_name ?? "") \($0.last_name ?? "")".trimmingCharacters(in: .whitespaces)) }
    }

    private struct StundenParameter: Encodable { let p_driver: String; let p_tage: Int }

    private func pausenSpeichern(_ dienstId: String, _ pausen: [PausePlan]) async {
        struct Zeile: Encodable { let dienst_id: String; let pausen: [PausePlan]; let aktualisiert: String }
        _ = try? await Backend.client.from("dienst_pausen")
            .upsert(Zeile(dienst_id: dienstId, pausen: pausen, aktualisiert: Stunden.iso.string(from: Date()))).execute()
    }
}

// MARK: Eingereichte Stunden

private struct ZettelKarte: View {
    let eintrag: Stunden.Eintrag
    let neuLaden: () async -> Void
    @State private var notiz = ""
    @State private var zurueck = false
    @State private var busy = false
    private let lime = Color(hex: 0xE3F654)
    private let orange = Color(hex: 0xFFCD8A)
    private let rot = Color(hex: 0xFF6F63)
    private let gruen = Color(hex: 0x8DFFAF)

    var body: some View {
        let z = eintrag.zettel!
        let v = eintrag.vorschlag
        let farbe = z.status == "bestaetigt" ? gruen : (z.status == "zurueckgewiesen" ? rot : orange)
        let angepasst = Stunden.uhr(z.beginn) != Stunden.uhr(v?.beginn) || Stunden.uhr(z.ende) != Stunden.uhr(v?.ende) || z.pause_min != (v?.pause_min ?? 0)
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(Stunden.tag(eintrag.dienst.datum, kurz: true)).font(.grotesk(18, .bold)).foregroundStyle(.white)
                Spacer(minLength: 0)
                Text("\(Stunden.hmm(z.arbeits_min)) h").font(.grotesk(24, .bold)).foregroundStyle(farbe)
            }
            HStack(spacing: 8) {
                wert("Beginn", Stunden.uhr(z.beginn), Stunden.uhr(z.beginn) != Stunden.uhr(v?.beginn))
                wert("Ende", Stunden.uhr(z.ende), Stunden.uhr(z.ende) != Stunden.uhr(v?.ende))
                wert("Pause", "\(z.pause_min) Min.", z.pause_min != (v?.pause_min ?? 0))
            }
            if angepasst {
                Text("Angepasst · Vorschlag \(Stunden.uhr(v?.beginn))–\(Stunden.uhr(v?.ende)), \(Stunden.hmm(v?.arbeits_min)) h")
                    .font(.grotesk(12, .medium)).foregroundStyle(orange)
                if let b = z.begruendung, !b.isEmpty { Text("„\(b)“").font(.grotesk(12, .medium)).foregroundStyle(.white.opacity(0.8)) }
            } else {
                Text("Wie vorgeschlagen · \(v?.fahrten?.count ?? 0) Fahrten").font(.grotesk(12, .medium)).foregroundStyle(.white.opacity(0.45))
            }
            if z.status == "eingereicht" {
                if zurueck {
                    TextField("", text: $notiz, prompt: Text("Hinweis an den Fahrer").foregroundStyle(.white.opacity(0.3)))
                        .font(.grotesk(14, .medium)).foregroundStyle(.white)
                        .padding(.horizontal, 10).frame(height: 40)
                        .overlay(Rectangle().strokeBorder(.white.opacity(0.3), lineWidth: 1))
                    HStack(spacing: 8) {
                        knopf("Zurückgeben", rot, hell: true, aus: busy || notiz.trimmingCharacters(in: .whitespaces).isEmpty) { Task { await setzen("zurueckgewiesen") } }
                        knopf("Abbrechen", lime) { zurueck = false }
                    }
                } else {
                    HStack(spacing: 8) {
                        knopf("Bestätigen", lime, hell: true, aus: busy) { Task { await setzen("bestaetigt") } }
                        knopf("Zurückgeben", rot) { zurueck = true }
                    }
                }
            } else {
                Text((z.status == "bestaetigt" ? "Bestätigt" : "Zurückgegeben") + ((z.dispo_notiz ?? "").isEmpty ? "" : " · \(z.dispo_notiz ?? "")"))
                    .font(.grotesk(12, .bold)).foregroundStyle(farbe)
            }
        }
        .padding(16)
        .background(Color(hex: 0x0F0F0F))
        .overlay(Rectangle().strokeBorder(farbe, lineWidth: 2))
    }

    private func wert(_ titel: String, _ text: String, _ anders: Bool) -> some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(titel).font(.grotesk(10)).foregroundStyle(.white.opacity(0.5))
            Text(text).font(.grotesk(16, .bold)).foregroundStyle(anders ? orange : .white)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func knopf(_ text: String, _ farbe: Color, hell: Bool = false, aus: Bool = false, _ aktion: @escaping () -> Void) -> some View {
        Button(action: aktion) {
            Text(text).font(.grotesk(14, .bold)).foregroundStyle(hell ? .black : farbe)
                .padding(.horizontal, 16).frame(height: 44)
                .background(hell ? farbe : .clear)
                .overlay(Rectangle().strokeBorder(farbe, lineWidth: hell ? 0 : 2))
        }
        .buttonStyle(.web).disabled(aus).opacity(aus ? 0.4 : 1)
    }

    private func setzen(_ status: String) async {
        busy = true
        struct Aenderung: Encodable { let status: String; let dispo_notiz: String?; let geprueft_von: String?; let geprueft_am: String; let aktualisiert: String }
        let ich = try? await Backend.client.auth.session.user.id.uuidString.lowercased()
        let jetzt = Stunden.iso.string(from: Date())
        let n = notiz.trimmingCharacters(in: .whitespaces)
        _ = try? await Backend.client.from("stundenzettel")
            .update(Aenderung(status: status, dispo_notiz: n.isEmpty ? nil : n, geprueft_von: ich, geprueft_am: jetzt, aktualisiert: jetzt))
            .eq("id", value: eintrag.zettel!.id.uuidString.lowercased()).execute()
        busy = false
        await neuLaden()
    }
}

// MARK: Pausen eines Dienstes

private struct DienstPausenKarte: View {
    let dienst: DispoStundenAnsicht.KommenderDienst
    let pausen: [DispoStundenAnsicht.PausePlan]
    let fahrten: [DispoStundenAnsicht.TagFahrt]
    let speichern: ([DispoStundenAnsicht.PausePlan]) -> Void

    @State private var neu: DispoStundenAnsicht.PausePlan?
    private let lime = Color(hex: 0xE3F654)
    private let dunkel = Color(hex: 0x18181B)

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(Stunden.tag(dienst.service_date, kurz: true)).font(.grotesk(18, .bold)).foregroundStyle(dunkel)
                Spacer(minLength: 0)
                Text("\(String((dienst.service_start_time ?? "").prefix(5)))–\(String((dienst.service_end_time ?? "").prefix(5)))")
                    .font(.grotesk(16, .bold)).foregroundStyle(dunkel)
            }
            Text("\(fahrten.count) Fahrten · \(dienst.status == "accepted" ? "angenommen" : "angefragt")").font(.grotesk(12, .medium)).foregroundStyle(Color(hex: 0x71717B))
            FlussPausen() {
                ForEach(Array(pausen.enumerated()), id: \.offset) { i, p in
                    HStack(spacing: 6) {
                        Text(text(p)).font(.grotesk(12, .medium)).foregroundStyle(lime).lineLimit(1)
                        Button { speichern(pausen.enumerated().filter { $0.offset != i }.map(\.element)) } label: {
                            Text("✕").font(.system(size: 12)).foregroundStyle(.white.opacity(0.6))
                        }
                        .buttonStyle(.web)
                    }
                    .padding(.horizontal, 8).frame(height: 28).background(dunkel)
                }
                if neu == nil {
                    Button { neu = .init(art: "fest", von: "", bis: "") } label: {
                        Text("+ Pause").font(.grotesk(12, .bold)).foregroundStyle(dunkel)
                            .padding(.horizontal, 8).frame(height: 28).overlay(Rectangle().strokeBorder(dunkel, lineWidth: 1))
                    }
                    .buttonStyle(.web)
                }
            }
            if let n = neu { formular(n) }
        }
        .padding(16)
        .background(Color.white)
    }

    private func text(_ p: DispoStundenAnsicht.PausePlan) -> String {
        if p.art == "fest" { return "Pause \(p.von ?? "")–\(p.bis ?? "")" }
        let f = fahrten.first { $0.id == p.job_id }
        let fahrt = f.map { "\(String(($0.etd ?? "").prefix(5))) \($0.pickup_name ?? "")" } ?? "Fahrt"
        return "Pause \(p.dauer_min ?? 0) Min. \((p.nach_min ?? 0) > 0 ? "\(p.nach_min ?? 0) Min. " : "")nach \(fahrt)"
    }

    @ViewBuilder private func formular(_ n: DispoStundenAnsicht.PausePlan) -> some View {
        let gueltig = n.art == "fest"
            ? Stunden.zeitpunkt(dienst.service_date, n.von ?? "") != nil && Stunden.zeitpunkt(dienst.service_date, n.bis ?? "") != nil
            : n.job_id != nil && (n.dauer_min ?? 0) > 0
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                ForEach([("fest", "Feste Zeit"), ("nach_fahrt", "Nach einer Fahrt")], id: \.0) { art, titel in
                    Button { neu?.art = art } label: {
                        Text(titel).font(.grotesk(12, .bold)).foregroundStyle(n.art == art ? .black : .white)
                            .padding(.horizontal, 12).frame(height: 32)
                            .background(n.art == art ? lime : .clear)
                            .overlay(Rectangle().strokeBorder(n.art == art ? lime : .white.opacity(0.3), lineWidth: 1))
                    }
                    .buttonStyle(.web)
                }
            }
            if n.art == "fest" {
                HStack(spacing: 8) {
                    eingabe("Von", Binding(get: { neu?.von ?? "" }, set: { neu?.von = $0 }), "12:00")
                    eingabe("Bis", Binding(get: { neu?.bis ?? "" }, set: { neu?.bis = $0 }), "12:30")
                }
            } else {
                Menu {
                    ForEach(fahrten, id: \.id) { f in
                        Button("\(String((f.etd ?? "").prefix(5))) \(f.pickup_name ?? "")") { neu?.job_id = f.id }
                    }
                } label: {
                    let f = fahrten.first { $0.id == n.job_id }
                    Text(f.map { "\(String(($0.etd ?? "").prefix(5))) \($0.pickup_name ?? "")" } ?? "Fahrt wählen ▾")
                        .font(.grotesk(14, .medium)).foregroundStyle(.white).lineLimit(1)
                        .padding(.horizontal, 10).frame(maxWidth: .infinity, alignment: .leading).frame(height: 38)
                        .overlay(Rectangle().strokeBorder(.white.opacity(0.3), lineWidth: 1))
                }
                HStack(spacing: 8) {
                    eingabe("Abstand (Min.)", Binding(get: { neu?.nach_min.map(String.init) ?? "" }, set: { neu?.nach_min = Int($0) }), "0", .numberPad)
                    eingabe("Dauer (Min.)", Binding(get: { neu?.dauer_min.map(String.init) ?? "" }, set: { neu?.dauer_min = Int($0) }), "30", .numberPad)
                }
            }
            HStack(spacing: 8) {
                Button {
                    guard var p = neu else { return }
                    if p.art == "fest" { p.job_id = nil; p.nach_min = nil; p.dauer_min = nil } else { p.von = nil; p.bis = nil }
                    speichern(pausen + [p]); neu = nil
                } label: {
                    Text("Pause speichern").font(.grotesk(14, .bold)).foregroundStyle(.black).padding(.horizontal, 16).frame(height: 40).background(lime)
                }
                .buttonStyle(.web).disabled(!gueltig).opacity(gueltig ? 1 : 0.4)
                Button { neu = nil } label: {
                    Text("Abbrechen").font(.grotesk(14, .bold)).foregroundStyle(lime).padding(.horizontal, 16).frame(height: 40)
                        .overlay(Rectangle().strokeBorder(lime, lineWidth: 2))
                }
                .buttonStyle(.web)
            }
        }
        .padding(12).background(dunkel)
    }

    private func eingabe(_ titel: String, _ text: Binding<String>, _ platzhalter: String, _ tastatur: UIKeyboardType = .numbersAndPunctuation) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(titel).font(.grotesk(10, .medium)).foregroundStyle(.white.opacity(0.5))
            TextField("", text: text, prompt: Text(platzhalter).foregroundStyle(.white.opacity(0.25)))
                .font(.grotesk(14, .medium)).foregroundStyle(.white).keyboardType(tastatur)
                .padding(.horizontal, 8).frame(height: 38).overlay(Rectangle().strokeBorder(.white.opacity(0.3), lineWidth: 1))
        }
        .frame(maxWidth: .infinity)
    }
}

// MARK: Excel

private struct ExportKarte: View {
    let fahrer: DispoFahrer
    let alleFahrer: [(id: String, name: String)]
    let fertig: (URL) -> Void
    @State private var von = ""
    @State private var bis = ""
    @State private var auswahl: Set<String> = []
    @State private var busy = false
    @State private var meldung = ""
    private let lime = Color(hex: 0xE3F654)

    var body: some View {
        let alle = auswahl.count == alleFahrer.count
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 8) {
                datum("Von", $von)
                datum("Bis", $bis)
            }
            FlussPausen() {
                Button { auswahl = alle ? [fahrer.id] : Set(alleFahrer.map(\.id)) } label: { chip("Alle Fahrer", alle) }.buttonStyle(.web)
                ForEach(alleFahrer, id: \.id) { f in
                    Button { if auswahl.contains(f.id) { auswahl.remove(f.id) } else { auswahl.insert(f.id) } } label: { chip(f.name, auswahl.contains(f.id)) }
                        .buttonStyle(.web)
                }
            }
            Button { Task { await exportieren(alle: alle) } } label: {
                Text(busy ? "Excel wird erstellt …" : "Excel exportieren").font(.grotesk(14, .bold)).foregroundStyle(.black)
                    .frame(maxWidth: .infinity).frame(height: 44).background(lime)
            }
            .buttonStyle(.web).disabled(busy || auswahl.isEmpty).opacity(busy || auswahl.isEmpty ? 0.4 : 1)
            if !meldung.isEmpty { Text(meldung).font(.grotesk(12)).foregroundStyle(.white.opacity(0.6)) }
        }
        .padding(16)
        .background(Color(hex: 0x0F0F0F))
        .overlay(Rectangle().strokeBorder(.white.opacity(0.15), lineWidth: 1))
        .onAppear {
            guard von.isEmpty else { return }
            let k = Calendar(identifier: .gregorian)
            let jetzt = Date()
            let start = k.date(from: k.dateComponents([.year, .month], from: jetzt)) ?? jetzt
            let ende = k.date(byAdding: DateComponents(month: 1, day: -1), to: start) ?? jetzt
            von = Self.de(start); bis = Self.de(ende)
            auswahl = [fahrer.id]
        }
    }

    private static func de(_ d: Date) -> String {
        let f = DateFormatter(); f.dateFormat = "dd.MM.yyyy"; f.timeZone = Stunden.berlin; return f.string(from: d)
    }
    private static func iso(_ de: String) -> String? {
        let t = de.split(separator: "."); guard t.count == 3, let tag = Int(t[0]), let monat = Int(t[1]), var jahr = Int(t[2]) else { return nil }
        if jahr < 100 { jahr += 2000 }
        return String(format: "%04d-%02d-%02d", jahr, monat, tag)
    }

    private func chip(_ text: String, _ an: Bool) -> some View {
        Text(text).font(.grotesk(12, an ? .bold : .medium)).foregroundStyle(an ? .black : .white.opacity(0.75)).lineLimit(1)
            .padding(.horizontal, 12).frame(height: 30)
            .background(an ? lime : .clear)
            .overlay(Rectangle().strokeBorder(an ? lime : .white.opacity(0.3), lineWidth: 1))
    }

    private func datum(_ titel: String, _ text: Binding<String>) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(titel).font(.grotesk(10, .medium)).foregroundStyle(.white.opacity(0.5))
            TextField("", text: text, prompt: Text("TT.MM.JJJJ").foregroundStyle(.white.opacity(0.25)))
                .font(.grotesk(14, .medium)).foregroundStyle(.white).keyboardType(.numbersAndPunctuation)
                .padding(.horizontal, 8).frame(height: 38).overlay(Rectangle().strokeBorder(.white.opacity(0.3), lineWidth: 1))
        }
        .frame(maxWidth: .infinity)
    }

    private func exportieren(alle: Bool) async {
        guard let v = Self.iso(von), let b = Self.iso(bis) else { meldung = "Datum als TT.MM.JJJJ eingeben."; return }
        busy = true; meldung = ""
        struct Koerper: Encodable { let aktion = "stunden_export"; let von: String; let bis: String; let fahrer: [String]? }
        struct Antwort: Decodable { let datei: String; let dateiname: String; let dienste: Int? }
        do {
            let a: Antwort = try await Backend.client.functions.invoke("dispo-admin", options: FunctionInvokeOptions(
                body: Koerper(von: v, bis: b, fahrer: alle ? nil : Array(auswahl))))
            guard let daten = Data(base64Encoded: a.datei) else { throw TrisarFehler.text("leer") }
            let url = FileManager.default.temporaryDirectory.appendingPathComponent(a.dateiname)
            try daten.write(to: url, options: .atomic)
            busy = false
            meldung = "\(a.dienste ?? 0) Dienste exportiert."
            fertig(url)
        } catch {
            busy = false
            meldung = "Export fehlgeschlagen."
        }
    }
}

/// Teilen-Blatt fuer eine Datei (Excel).
private struct DateiTeilen: UIViewControllerRepresentable {
    let url: URL
    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: [url], applicationActivities: nil)
    }
    func updateUIViewController(_ vc: UIActivityViewController, context: Context) {}
}

/// Chips nebeneinander mit Umbruch.
private struct FlussPausen: Layout {
    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let breite = proposal.width ?? .infinity
        var x: CGFloat = 0, y: CGFloat = 0, zeile: CGFloat = 0
        for s in subviews {
            let g = s.sizeThatFits(.unspecified)
            if x > 0 && x + g.width > breite { x = 0; y += zeile + 6; zeile = 0 }
            x += g.width + 6; zeile = max(zeile, g.height)
        }
        return CGSize(width: proposal.width ?? x, height: subviews.isEmpty ? 0 : y + zeile)
    }
    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX, y = bounds.minY, zeile: CGFloat = 0
        for s in subviews {
            let g = s.sizeThatFits(.unspecified)
            if x > bounds.minX && x + g.width > bounds.maxX { x = bounds.minX; y += zeile + 6; zeile = 0 }
            s.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(g))
            x += g.width + 6; zeile = max(zeile, g.height)
        }
    }
}
