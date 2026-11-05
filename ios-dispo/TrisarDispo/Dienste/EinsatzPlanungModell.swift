import Combine
import Foundation
import Supabase

/// Zustand und Ablauf der Einsatzplanung wie KiPlanerDemoView.jsx (Live-Zweig) mit den Daten,
/// die AlleFahrer.jsx dem Planer uebergibt (sichtbare Fahrer, Fahrten heute bis uebermorgen,
/// Fahrer- und Fahrtenkurven ueber 72 h).
@MainActor
final class EinsatzPlanungModell: ObservableObject {
    enum Ablauf { case uebersicht, kalender, bedarf, tag }

    static let horizontTage = 3
    static let tagesStunden = Array(6...23)       // DAY_HOURS: Bedarfsprofil 06–23 Uhr
    static let ruhezeitStandard = 11.0

    private let speicher = EinsatzSpeicher.geteilt
    let fahrerDienst = FahrerListeDienst()
    let heute = EinsatzUhr.heute()

    // Ablauf
    @Published var ablauf: Ablauf
    @Published var einsatz: EinsatzFertig?
    @Published var uebersichtIndex = 0
    @Published var tagAusUebersicht = false
    @Published var tagesKarte = false
    @Published var tagesKarteSignal = 0
    /// Per Hand angepasster Bedarf: [iso: [stunde: wert]]
    @Published var bedarfAnpassung: [String: [Int: Int]] = [:]
    @Published var kalenderAuswahl: EinsatzZeitraum?
    @Published var planTage: [String]
    @Published var planTagIndex = 0
    @Published var planungTag: String?
    @Published var laeuft = false
    @Published var abgelehnt: Set<String>
    @Published var uebernommen: Set<String>
    @Published var geplant: [String: EinsatzTagErgebnis]
    @Published var angenommen: [String: [EinsatzDienstZeile]]
    @Published var planLog = ""
    @Published var fehler = ""
    @Published var strategieKey = "standard"

    // Daten
    @Published private(set) var fahrerListe: [DispoFahrer] = []
    @Published private(set) var alleFahrerAnzahl = 0
    @Published private(set) var fahrten: [PlanerZeile] = []
    private var fahrzeuge: [PlanerZeile] = []
    private var laufNr = 0
    private var beobachter: AnyCancellable?
    private var jobsAbfrage: Task<Void, Never>?

    init() {
        let s = EinsatzSpeicher.geteilt
        einsatz = s.einsatz
        ablauf = (s.einsatz?.tage.isEmpty == false) ? .uebersicht : .kalender
        kalenderAuswahl = s.einsatz?.auswahl
        planTage = s.einsatz?.tage ?? []
        abgelehnt = s.abgelehnt
        uebernommen = s.uebernommen
        geplant = s.geplant
        angenommen = s.angenommen
    }

    // MARK: Laden

    func starten() async {
        beobachter = fahrerDienst.$fahrer.dropFirst().sink { [weak self] liste in
            Task { @MainActor in self?.fahrerUebernehmen(liste); self?.fahrtenNeuLaden() }
        }
        await fahrerDienst.starten()
        fahrerUebernehmen(fahrerDienst.fahrer)
        await fahrtenLaden()
        await fahrzeugeLaden()
    }

    func stoppen() async {
        beobachter = nil
        jobsAbfrage?.cancel()
        await fahrerDienst.stoppen()
    }

    /// visibleDrivers: Dispo-Rollen raus, nach Nachname und Vorname sortiert.
    private func fahrerUebernehmen(_ liste: [DispoFahrer]) {
        alleFahrerAnzahl = liste.count
        let dispo: Set<String> = ["dispo", "dispatcher", "admin", "koordinator", "coordinator", "pruefung"]
        let de = Locale(identifier: "de")
        func vergleich(_ a: String, _ b: String) -> ComparisonResult {
            a.compare(b, options: [.caseInsensitive, .diacriticInsensitive], range: nil, locale: de)
        }
        fahrerListe = liste.filter { !dispo.contains(($0.role ?? "").trimmingCharacters(in: .whitespaces).lowercased()) }
            .sorted {
                let n = vergleich($0.lastName, $1.lastName)
                return n != .orderedSame ? n == .orderedAscending : vergleich($0.firstName, $1.firstName) == .orderedAscending
            }
    }

    private func fahrtenNeuLaden() {
        jobsAbfrage?.cancel()
        jobsAbfrage = Task { await fahrtenLaden() }
    }

    /// Planungshorizont heute bis uebermorgen, gleiche Spalten wie AlleFahrer.jsx.
    private func fahrtenLaden() async {
        let ende = EinsatzUhr.plusTage(heute, Self.horizontTage - 1)
        if let zeilen: [PlanerZeile] = try? await Backend.client.from("jobs")
            .select("id, ride_date, etd, status, pickup_name, pickup_address, dropoff_name, dropoff_address, ext_route_duration_mins, ext_route_duration_in_traffic_mins")
            .gte("ride_date", value: heute).lte("ride_date", value: ende).execute().value {
            fahrten = zeilen
        } else {
            fahrten = []
        }
    }

    /// Fahrzeugpool fuer Stage 2 der Planung (Fahrzeugzuteilung im Backend).
    private func fahrzeugeLaden() async {
        if let zeilen: [PlanerZeile] = try? await Backend.client.from("vehicles").select("*").execute().value {
            fahrzeuge = zeilen
        }
    }

    // MARK: Kurven (72 h ab heute 00:00)

    var angebotAlle: [Int] { Planung.angebot(fahrerListe) }

    var gebuchtAlle: [Int] {
        var z = Array(repeating: 0, count: Self.horizontTage * 24)
        for r in fahrten {
            if Planung.ausgeschlossen.contains(r.text("status").lowercased()) { continue }
            guard let tag = Dienstzeit.tagAbstand(r.text("ride_date")), tag >= 0, tag < Self.horizontTage,
                  let m = r.text("etd").firstMatch(of: /^(\d{1,2}):(\d{2})/), let h = Int(m.1), (0...23).contains(h) else { continue }
            z[tag * 24 + h] += 1
        }
        return z
    }

    /// computeDemandCurve ueber den ganzen Horizont.
    var bedarfAlle: [Int] { Planung.bedarf(gebuchtAlle) }

    /// Bedarf inklusive der Anpassungen aus der Bedarfsuebersicht.
    var bedarfAngepasst: [Int] {
        var reihe = bedarfAlle
        for (iso, stunden) in bedarfAnpassung {
            let nr = EinsatzUhr.tagNr(iso, heute: heute)
            for (stunde, wert) in stunden {
                let i = nr * 24 + stunde
                if i >= 0 && i < reihe.count { reihe[i] = max(0, wert) }
            }
        }
        return reihe
    }

    /// Tage mit gebuchten Fahrten im Horizont: nur sie sind im Kalender waehlbar.
    var tageMitFahrten: Set<String> {
        Set(fahrten.filter { !Planung.ausgeschlossen.contains($0.text("status").lowercased()) }
            .map { $0.text("ride_date") }
            .filter { let i = EinsatzUhr.tagNr($0, heute: heute); return i >= 0 && i < Self.horizontTage })
    }

    // MARK: Ableitungen

    var aktuellerTag: String? {
        planTage.isEmpty ? nil : planTage[min(planTagIndex, planTage.count - 1)]
    }

    func sichtbar(_ iso: String) -> [EinsatzVorschlag] {
        (geplant[iso]?.suggestions ?? []).filter { !abgelehnt.contains($0.id) }
    }

    /// Je Tag des Zeitraums: true = alle nicht abgelehnten Vorschlaege uebernommen.
    var tagesStatus: [Bool] {
        planTage.map { iso in
            let offen = sichtbar(iso)
            return !offen.isEmpty && offen.allSatisfy { uebernommen.contains($0.id) }
        }
    }

    var alleTageFertig: Bool { !tagesStatus.isEmpty && tagesStatus.allSatisfy { $0 } }

    /// Gesperrt ist nur der Tag, der gerade gerechnet wird.
    func tagGesperrt(_ iso: String) -> Bool { laeuft && (planungTag == nil || planungTag == iso) }

    /// laeuft fuer die Tagesansicht: rechnet dieser Tag oder fehlt er noch.
    var tagLaeuft: Bool {
        guard let iso = aktuellerTag else { return false }
        return laeuft && (planungTag == nil || planungTag == iso || geplant[iso] == nil)
    }

    // MARK: Ablauf

    /// Kalender -> Bedarfsuebersicht des Zeitraums (nur Tage mit Fahrten).
    func zeitraumPlanen(_ auswahl: EinsatzZeitraum) {
        var tage: [String] = []
        let mitFahrten = tageMitFahrten
        var iso = auswahl.von
        while iso <= auswahl.bis {
            if mitFahrten.contains(iso) { tage.append(iso) }
            iso = EinsatzUhr.plusTage(iso, 1)
        }
        guard !tage.isEmpty else { return }
        kalenderAuswahl = auswahl
        planTage = tage
        planTagIndex = 0
        tagAusUebersicht = false
        ablauf = .bedarf
    }

    func bedarfAnpassen(_ iso: String, _ stunde: Int, _ wert: Int) {
        bedarfAnpassung[iso, default: [:]][stunde] = wert
    }

    /// Bedarfsuebersicht -> Tagesplanung: jetzt wird der Zeitraum geplant.
    func bedarfWeiter() {
        guard !planTage.isEmpty else { return }
        planTagIndex = 0
        ablauf = .tag
        let tage = planTage, fenster = kalenderAuswahl
        Task { await planen(tage: tage, zeitfenster: fenster) }
    }

    func tagWechseln(_ index: Int) { planTagIndex = index }

    /// Uebersicht -> Tagesplanung des gewaehlten Tages.
    func einsatzTagOeffnen(_ index: Int) {
        guard let e = einsatz, index < e.tage.count else { return }
        planTage = e.tage
        kalenderAuswahl = e.auswahl
        planTagIndex = index
        uebersichtIndex = index
        tagAusUebersicht = true
        ablauf = .tag
    }

    func tagZurueck() {
        if tagAusUebersicht {
            uebersichtIndex = min(planTagIndex, planTage.count - 1)
            ablauf = .uebersicht
        } else {
            ablauf = .bedarf
        }
    }

    /// Ist jeder Tag geplant, geht es nach einem Moment in die Uebersicht des Einsatzes.
    func vielleichtZurUebersicht() async {
        guard ablauf == .tag, !tagAusUebersicht, alleTageFertig, !laeuft else { return }
        try? await Task.sleep(for: .milliseconds(1200))
        guard ablauf == .tag, !tagAusUebersicht, alleTageFertig, !laeuft else { return }
        let fertig = EinsatzFertig(tage: planTage, auswahl: kalenderAuswahl)
        speicher.einsatz = fertig
        speicher.sichern()
        einsatz = fertig
        uebersichtIndex = 0
        ablauf = .uebersicht
    }

    /// Strategie in der Tagesplanung: nur diesen Tag mit dem Preset neu planen.
    func tagesStrategie(_ key: String) {
        guard !laeuft, let iso = aktuellerTag else { return }
        let preset = EinsatzStrategie.finden(key)
        strategieKey = key
        var regeln = PlanerRegeln.lesen()
        regeln.merge(preset.regeln) { _, neu in neu }
        PlanerRegeln.schreiben(regeln)
        let fenster = kalenderAuswahl
        Task { await planen(tage: [iso], zeitfenster: fenster, strategie: preset) }
    }

    // MARK: Planen

    private struct Ruhe { var frueh: Int?; var spaet: Int? }

    /// Ruhezeitfenster (§ 5 ArbZG) aus Vortag und Folgetag.
    private func ruhefenster(_ iso: String, _ schichten: [String: [(String, String, String)]], _ ruhe: Double) -> [String: Ruhe] {
        var fenster: [String: Ruhe] = [:]
        let r = Int(ruhe * 60)
        for (fahrer, _, ende) in schichten[EinsatzUhr.plusTage(iso, -1)] ?? [] {
            guard let e = EinsatzUhr.minuten(ende) else { continue }
            let kandidat = e - 1440 + r
            fenster[fahrer, default: Ruhe()].frueh = max(fenster[fahrer]?.frueh ?? kandidat, kandidat)
        }
        for (fahrer, start, _) in schichten[EinsatzUhr.plusTage(iso, 1)] ?? [] {
            guard let s = EinsatzUhr.minuten(start) else { continue }
            let kandidat = s + 1440 - r
            fenster[fahrer, default: Ruhe()].spaet = min(fenster[fahrer]?.spaet ?? kandidat, kandidat)
        }
        return fenster
    }

    /// Fahrerzeile wie visibleDriversWithState, plus Ruhezeitfenster.
    private func fahrerZeile(_ f: DispoFahrer, _ ruhe: Ruhe?) -> PlanerZeile {
        let zustand: String = {
            let n = (f.driverActivityState ?? "").trimmingCharacters(in: .whitespaces).lowercased()
            if ["aktiv", "active", "in_progress", "unterwegs"].contains(n) { return "aktiv" }
            if ["inaktiv", "inactive"].contains(n) { return "inaktiv" }
            return "frei"
        }()
        var z: PlanerZeile = [
            "id": .string(f.id), "name": .string(f.name), "firstName": .string(f.firstName), "lastName": .string(f.lastName),
            "email": .string(f.email), "vehicle": .string(f.vehicle), "role": f.role.map { .string($0) } ?? .null,
            "driverNumber": f.driverNumber.map { .integer($0) } ?? .null,
            "driverActivityState": f.driverActivityState.map { .string($0) } ?? .null,
            "serviceStartTime": .string(f.serviceStartTime), "serviceEndTime": .string(f.serviceEndTime),
            "serviceStartDate": .string(f.serviceStartDate), "planRequestStatus": .string(f.planRequestStatus),
            "activityState": .string(zustand), "isIncomplete": .bool(f.unfertig), "isInServiceNow": .bool(f.imDienst()),
        ]
        if let a = ruhe?.frueh { z["earliest_start_minute"] = .integer(a) }
        if let b = ruhe?.spaet { z["latest_end_minute"] = .integer(b) }
        return z
    }

    /// runPlanning: Tag fuer Tag, jeder geplante Tag geht als Ruhezeit-Randbedingung in den naechsten ein.
    func planen(tage: [String], zeitfenster: EinsatzZeitraum?, strategie: EinsatzStrategie? = nil) async {
        laufNr += 1
        let nr = laufNr
        laeuft = true
        planLog = ""
        fehler = ""
        let beginn = Date()
        let aktiv = strategie ?? EinsatzStrategie.finden(strategieKey)
        var regeln = PlanerRegeln.standard
        regeln.merge(PlanerRegeln.lesen()) { _, neu in neu }
        if let m = aktiv.regeln["mode"] { regeln["mode"] = m }
        if let s = strategie { regeln.merge(s.regeln) { _, neu in neu } }
        defer {
            if laufNr == nr { laeuft = false; planLog = ""; planungTag = nil }
        }

        if fahrzeuge.isEmpty { await fahrzeugeLaden() }
        var schichten: [String: [(String, String, String)]] = speicher.angenommen.mapValues { $0.map { ($0.driverId, $0.serviceStart, $0.serviceEnd) } }
        let ruhe = (regeln["restHours"]?.planZahl ?? 0) > 0 ? regeln["restHours"]!.planZahl! : Self.ruhezeitStandard

        for iso in tage {
            let fenster = ruhefenster(iso, schichten, ruhe)
            planungTag = iso
            let ergebnis = await tagPlanen(iso, fenster, regeln, aktiv, zeitfenster)
            if laufNr != nr { return }
            let kpis = ergebnis.roh["kpis"]?.objectValue
            let eintrag = EinsatzTagErgebnis(
                strategyKey: aktiv.key, suggestions: ergebnis.vorschlaege, source: ergebnis.roh["source"]?.planText ?? "",
                gap: kpis?["optimality_gap"]?.planZahl, solverStatus: kpis?["solver_status"]?.planText ?? "",
                unassignedCount: Int(kpis?["unassigned_ride_count"]?.planZahl ?? 0), rideCount: ergebnis.anzahl,
                tunnel: ergebnis.roh["tunnel"].flatMap { $0.isNil ? nil : $0 },
                fleetKpis: ergebnis.roh["fleet_kpis"].flatMap { $0.isNil ? nil : $0 },
                engine: ergebnis.roh["engine"].flatMap { $0.isNil ? nil : $0 })
            // Neu geplante Vorschlaege dieses Tages wieder sichtbar und offen.
            for v in ergebnis.vorschlaege { speicher.abgelehnt.remove(v.id); speicher.uebernommen.remove(v.id) }
            speicher.geplant[iso] = eintrag
            speicher.sichern()
            geplant[iso] = eintrag
            abgelehnt = speicher.abgelehnt
            uebernommen = speicher.uebernommen
            schichten[iso] = ergebnis.vorschlaege.map { ($0.driverId, $0.start, $0.end) }
        }
        let rest = 1.4 - Date().timeIntervalSince(beginn)
        if rest > 0 { try? await Task.sleep(for: .seconds(rest)) }
    }

    private func tagPlanen(_ iso: String, _ ruhe: [String: Ruhe], _ regeln: PlanerZeile, _ strategie: EinsatzStrategie,
                           _ zeitfenster: EinsatzZeitraum?) async -> (roh: PlanerZeile, vorschlaege: [EinsatzVorschlag], anzahl: Int) {
        func imFenster(_ r: PlanerZeile) -> Bool {
            let etd = EinsatzUhr.normal(r.text("etd"))
            guard let z = zeitfenster, !etd.isEmpty else { return true }
            if !z.startZeit.isEmpty && iso == z.von && etd < z.startZeit { return false }
            if !z.endZeit.isEmpty && iso == z.bis && etd > z.endZeit { return false }
            return true
        }
        let tagesFahrten = fahrten.filter {
            $0.text("ride_date") == iso && !Planung.ausgeschlossen.contains($0.text("status").lowercased()) && imFenster($0)
        }
        let index = max(0, min(Self.horizontTage - 1, EinsatzUhr.tagNr(iso, heute: heute)))
        let bedarf = bedarfAngepasst
        let tagesBedarf = Self.tagesStunden.map { bedarf[index * 24 + $0] }
        let pool = Int(regeln["driverPool"]?.planZahl ?? 101)
        let zeilen = fahrerListe.prefix(max(0, pool)).map { fahrerZeile($0, ruhe[$0.id]) }
        var einstellung: PlanerZeile = [:]
        for k in ["maxWorkHours", "minWorkHours", "bufferMinutes", "rideDurationMinutes", "qualityGapPercent", "mode", "travelModel"] {
            if let w = regeln[k] { einstellung[k] = w }
        }
        let tagText = EinsatzUhr.tagLang(iso)
        let roh = await EinsatzPlanerDienst.planen(
            drivers: Array(zeilen), rides: tagesFahrten, vehicles: fahrzeuge, serviceDate: iso, settings: einstellung,
            demandProfile: tagesBedarf
        ) { [weak self] text in
            if let m = text.firstMatch(of: /^Input: Fahrer=(\d+), Fahrten=(\d+)/) {
                self?.planLog = "\(tagText): \(m.1) Fahrer, \(m.2) Fahrten …"
            } else if text.range(of: "Heuristik|Plan erstellt|Vorschläge", options: [.regularExpression, .caseInsensitive]) != nil,
                      text.range(of: "Provider|unterstützt", options: [.regularExpression, .caseInsensitive]) == nil {
                self?.planLog = "\(tagText): Schichten werden gebildet …"
            }
        }
        let vorschlaege = EinsatzPlanerDienst.vorschlaege(roh, rides: tagesFahrten, strategie: strategie.key, tag: iso)
        let extra = bereitschaft(iso, vorschlaege, zeilen: Array(zeilen), regeln: regeln, strategie: strategie)
        return (roh, (vorschlaege + extra).sorted { $0.startMinutes < $1.startMinutes }, tagesFahrten.count)
    }

    /// bereitschaftFuerHandbedarf: wo der Bedarf per Hand erhoeht wurde und der Plan ihn nicht deckt,
    /// kommen Bereitschaftsdienste freier Fahrer dazu.
    private func bereitschaft(_ iso: String, _ vorschlaege: [EinsatzVorschlag], zeilen: [PlanerZeile],
                              regeln: PlanerZeile, strategie: EinsatzStrategie) -> [EinsatzVorschlag] {
        let nr = EinsatzUhr.tagNr(iso, heute: heute)
        let stunden = Array(6..<26)
        let angepasst = bedarfAngepasst, basis = bedarfAlle
        func wert(_ reihe: [Int], _ i: Int) -> Int { i >= 0 && i < reihe.count ? reihe[i] : 0 }
        func imDienst(_ minute: Int) -> Int { vorschlaege.filter { minute >= $0.startMinutes && minute < $0.endMinutes }.count }
        var offen = stunden.map { s -> Int in
            let i = nr * 24 + s
            guard wert(angepasst, i) > wert(basis, i) else { return 0 }
            return max(0, wert(angepasst, i) - imDienst(s * 60 + 30))
        }
        guard offen.contains(where: { $0 > 0 }) else { return [] }
        let minH = max(1, Int(regeln["minWorkHours"]?.planZahl ?? 3) == 0 ? 3 : Int(regeln["minWorkHours"]?.planZahl ?? 3))
        let maxH = max(minH, Int(regeln["maxWorkHours"]?.planZahl ?? 8) == 0 ? 8 : Int(regeln["maxWorkHours"]?.planZahl ?? 8))
        let belegt = Set(vorschlaege.map(\.driverId).filter { !$0.isEmpty })
        var frei = zeilen.filter { !$0.text("id").isEmpty && !belegt.contains($0.text("id")) }
        var dienste: [EinsatzVorschlag] = []
        var sicherung = 0
        while offen.contains(where: { $0 > 0 }) && sicherung < 200 {
            sicherung += 1
            guard let erste = offen.firstIndex(where: { $0 > 0 }) else { break }
            var letzte = erste
            while letzte + 1 < offen.count && offen[letzte + 1] > 0 && letzte - erste + 1 < maxH { letzte += 1 }
            while letzte - erste + 1 < minH && letzte + 1 < offen.count { letzte += 1 }
            var anfang = erste
            while letzte - anfang + 1 < minH && anfang > 0 { anfang -= 1 }
            let sMin = stunden[anfang] * 60, eMin = (stunden[letzte] + 1) * 60
            guard let fi = frei.firstIndex(where: { d in
                (d["earliest_start_minute"]?.planZahl).map { Int($0) <= sMin } ?? true
                    && (d["latest_end_minute"]?.planZahl).map { Int($0) >= eMin } ?? true
            }) else { break }
            let f = frei.remove(at: fi)
            for i in anfang...letzte { offen[i] = max(0, offen[i] - 1) }
            let start = EinsatzUhr.uhr(sMin), ende = EinsatzUhr.uhr(eMin)
            let h = Double(eMin - sMin) / 60
            dienste.append(EinsatzVorschlag(
                rides: [], chargeStops: [], standby: true,
                id: "\(iso)-\(strategie.key)-bereitschaft-\(f.text("id"))-\(start)", dayIso: iso, driverId: f.text("id"),
                name: f.text("name").isEmpty ? "Fahrer \(dienste.count + 1)" : f.text("name"),
                start: start, end: ende,
                hours: h == h.rounded() ? String(Int(h)) : String(format: "%.1f", h).replacingOccurrences(of: ".", with: ","),
                stops: ["Bereitschaft & Kurzfahrten im Stadtgebiet"], startMinutes: sMin, endMinutes: eMin,
                vehicleLabel: "", vehicleIsEv: false, vehicleId: "", shiftKm: nil, chargeStopCount: 0, rideIds: [],
                minRangeReserveKm: nil))
        }
        return dienste
    }

    // MARK: Annehmen, Ablehnen, Zuruecknehmen (schreibt wie onApplySuggestions in die Datenbank)

    private func zeile(_ v: EinsatzVorschlag) -> EinsatzDienstZeile {
        EinsatzDienstZeile(driverId: v.driverId, serviceStart: v.start, serviceEnd: v.end, rideIds: v.rideIds, vehicleId: v.vehicleId)
    }

    private func nachSchreiben() {
        // DRIVERS_RELOAD_EVENT: Fahrerliste neu laden.
        Task { await fahrerDienst.laden() }
    }

    /// accept unten: alle offenen Vorschlaege des Tages auf einmal uebernehmen.
    func tagAnnehmen(_ iso: String) async {
        guard !tagGesperrt(iso) else { return }
        let offen = (geplant[iso]?.suggestions ?? []).filter { !abgelehnt.contains($0.id) && !uebernommen.contains($0.id) && !$0.driverId.isEmpty }
        guard !offen.isEmpty else { return }
        let bisher = (angenommen[iso] ?? []).filter { z in !offen.contains { $0.driverId == z.driverId && $0.start == z.serviceStart } }
        let zeilen = bisher + offen.map(zeile)
        if let f = await EinsatzUebernahme.anwenden(tag: iso, zeilen: zeilen) {
            fehler = f.isEmpty ? "Schicht konnte nicht übernommen werden." : f
            return
        }
        speicher.angenommen[iso] = zeilen
        offen.forEach { speicher.uebernommen.insert($0.id) }
        speicher.sichern()
        angenommen[iso] = zeilen
        uebernommen = speicher.uebernommen
        fehler = ""
        nachSchreiben()
    }

    func zuruecknehmen(_ v: EinsatzVorschlag) async {
        let iso = v.dayIso
        guard !tagGesperrt(iso) else { return }
        let zeilen = (angenommen[iso] ?? []).filter { !($0.driverId == v.driverId && $0.serviceStart == v.start) }
        if let f = await EinsatzUebernahme.anwenden(tag: iso, zeilen: zeilen, leerErlaubt: true) {
            fehler = f.isEmpty ? "Schicht konnte nicht übernommen werden." : f
            return
        }
        speicher.angenommen[iso] = zeilen
        speicher.uebernommen.remove(v.id)
        speicher.sichern()
        angenommen[iso] = zeilen
        uebernommen = speicher.uebernommen
        fehler = ""
        nachSchreiben()
    }

    func ablehnen(_ id: String) {
        let iso = String(id.prefix(10))
        guard !tagGesperrt(iso.wholeMatch(of: /\d{4}-\d{2}-\d{2}/) != nil ? iso : (aktuellerTag ?? heute)) else { return }
        speicher.abgelehnt.insert(id)
        speicher.sichern()
        abgelehnt.insert(id)
    }

    /// accept: Schicht vergeben. Der Schreibweg ersetzt die Tagesplanung, darum gehen alle bisher
    /// angenommenen Schichten des Tages mit.
    func annehmen(_ v: EinsatzVorschlag) async {
        let iso = v.dayIso
        guard !tagGesperrt(iso) else { return }
        guard !v.driverId.isEmpty else { ablehnen(v.id); return }
        let zeilen = (angenommen[iso] ?? []).filter { $0.driverId != v.driverId || $0.serviceStart != v.start } + [zeile(v)]
        if let f = await EinsatzUebernahme.anwenden(tag: iso, zeilen: zeilen) {
            fehler = f.isEmpty ? "Schicht konnte nicht übernommen werden." : f
            return
        }
        speicher.angenommen[iso] = zeilen
        speicher.uebernommen.insert(v.id)
        speicher.sichern()
        angenommen[iso] = zeilen
        uebernommen = speicher.uebernommen
        fehler = ""
        nachSchreiben()
    }

    /// Planungsregeln fuer die Fahrt-Simulation (rideDurationMinutes).
    var fahrtDauerRegel: Int { Int(PlanerRegeln.lesen()["rideDurationMinutes"]?.planZahl ?? 80) }
}
