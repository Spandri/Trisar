import ActivityKit
import Combine
import Foundation

/// Haelt die Live-Aktivitaet "Dienstreise" aktuell (DienstreiseAktivitaet, Layout in TrisarFahrerWidget/DienstreiseWidget.swift).
/// - Laeuft ab 30 min vor Start einer angenommenen, nicht beendeten Dienstreise bis 15 min nach Ankunft des
///   letzten Abschnitts bzw. bis "Dienstreise beenden".
/// - Inhalt nach ReiseLage: vor Start / Bus und U-Bahn, im Zug, im Umstieg.
/// - Live-Stand je Abschnitt (Zug, S-Bahn, Flug) holt der Beobachter hier selbst alle 2 min, solange die Reise laeuft,
///   auch ohne geoeffnete Detailansicht. Alle 30 s wird neu eingeordnet.
/// - Nur eine Aktivitaet gleichzeitig. Bis zur letzten Ankunft hat die Reise Vorrang vor einer nur angenommenen
///   Fahrt (15.11.), eine Fahrt beim Gast oder unterwegs geht immer vor (LiveFahrt.hatFahrt).
/// Starten erlaubt iOS nur bei offener App, Aktualisieren geht auch im Hintergrund.
@MainActor
final class LiveDienstreise {
    static let shared = LiveDienstreise()

    private var abo: AnyCancellable?
    private var takt: AnyCancellable?
    /// Live-Stand je Abschnitt (bei Reisen ohne Abschnitte unter der Reise-ID).
    private var liveJe: [UUID: DienstreiseVerbindung] = [:]
    private var holer: Task<Void, Never>?
    private var holerSchluessel = ""
    /// true, solange eine Reise im Zeitfenster laeuft und die letzte Ankunft noch nicht vorbei ist. LiveFahrt
    /// waehlt dann keine nur angenommene Fahrt.
    private(set) var reiseUnterwegs = false

    private static let vorlauf: TimeInterval = 30 * 60
    private static let nachlauf: TimeInterval = 15 * 60

    func beobachten(_ speicher: DienstreiseSpeicher = .shared) {
        guard abo == nil else { return }
        abo = speicher.$liste
            .receive(on: RunLoop.main)
            .sink { [weak self] _ in self?.abgleichen() }
        takt = Timer.publish(every: 30, on: .main, in: .common).autoconnect()
            .sink { [weak self] _ in self?.abgleichen() }
    }

    /// Beim Wechsel in den Vordergrund: Starten geht nur dann.
    func imVordergrund() { abgleichen() }

    private var reisen: [DienstreiseSpeicher.Reise] {
        #if DEBUG
        if Self.beispielLauf { return [Self.beispielReise] }
        #endif
        return DienstreiseSpeicher.shared.liste
    }

    func abgleichen() {
        let vorhanden = Activity<DienstreiseAktivitaet>.activities
        let jetzt = Date()
        let gewaehlt = auswaehlen(reisen, jetzt: jetzt)
        if let r = gewaehlt { holenStarten(r) } else { holenStoppen() }
        // Vor der letzten Ankunft verdraengt die Reise eine nur angenommene Fahrt: LiveFahrt neu waehlen lassen.
        let unterwegs = gewaehlt.map { r in
            ReiseLage.berechnen(teile: Self.teile(r), liveJe: Self.live(r, liveJe), datum: r.datum,
                                standort: nil, jetzt: jetzt).map { !$0.vorbei } ?? false
        } ?? false
        if unterwegs != reiseUnterwegs {
            reiseUnterwegs = unterwegs
            LiveFahrt.shared.imVordergrund()
        }
        // Fahrt beim Gast oder unterwegs hat Vorrang, sonst die laufende Dienstreise im Zeitfenster.
        guard !LiveFahrt.shared.hatFahrt, let r = gewaehlt,
              let stand = Self.stand(r, liveJe: liveJe, jetzt: jetzt) else {
            for a in vorhanden { Task { await a.end(nil, dismissalPolicy: .immediate) } }
            return
        }
        let id = r.id.uuidString
        let inhalt = ActivityContent(state: stand, staleDate: nil)
        for a in vorhanden where a.attributes.reiseID != id {
            Task { await a.end(nil, dismissalPolicy: .immediate) }
        }
        if let a = vorhanden.first(where: { $0.attributes.reiseID == id }) {
            if a.content.state != stand { Task { await a.update(inhalt) } }
        } else {
            guard ActivityAuthorizationInfo().areActivitiesEnabled else {
                NSLog("Live-Aktivitaet Dienstreise: in den Einstellungen abgeschaltet")
                return
            }
            do {
                _ = try Activity.request(attributes: DienstreiseAktivitaet(reiseID: id), content: inhalt)
            } catch {
                // Im Hintergrund nicht erlaubt: beim naechsten Oeffnen der App startet sie.
                NSLog("Live-Aktivitaet Dienstreise: %@", error.localizedDescription)
            }
        }
    }

    // MARK: - Auswahl

    /// Abschnitte der Reise, eine Reise ohne Abschnitte als ein Abschnitt (wie DienstreiseAnsicht.lageTeile).
    private static func teile(_ r: DienstreiseSpeicher.Reise) -> [DienstreiseAbschnitt] {
        if !r.abschnitte.isEmpty { return r.abschnitte }
        return [DienstreiseAbschnitt(id: r.id, dienstreiseID: r.id, art: r.art, nummer: r.nummer,
                                     vonName: r.startName, vonLat: r.startLat, vonLng: r.startLng,
                                     abDatum: r.datum, abZeit: r.startZeit,
                                     nachName: r.zielName, nachLat: r.zielLat, nachLng: r.zielLng,
                                     anZeit: DienstreiseVerbindung.hm(r.verbindung?.ankunft))]
    }

    /// Live-Stand je Abschnitt, bei der einen Verbindung sonst der Stand beim Anlegen.
    private static func live(_ r: DienstreiseSpeicher.Reise, _ liveJe: [UUID: DienstreiseVerbindung]) -> [UUID: DienstreiseVerbindung] {
        if !r.abschnitte.isEmpty { return liveJe }
        guard let v = liveJe[r.id] ?? r.verbindung else { return [:] }
        return [r.id: v]
    }

    private static func wert(_ t: String?) -> String? { (t ?? "").isEmpty ? nil : t }

    /// Start (erste Abfahrt) und Ende (letzte Ankunft) der Reise.
    private static func zeitraum(_ r: DienstreiseSpeicher.Reise, _ liveJe: [UUID: DienstreiseVerbindung]) -> (start: Date?, ende: Date?) {
        let t = teile(r), lv = live(r, liveJe)
        guard let erster = t.first, let letzter = t.last else { return (nil, nil) }
        let abErst = wert(lv[erster.id]?.abfahrt) ?? wert(erster.ab_zeit) ?? r.startZeit
        let start = Stunden.zeitpunkt(erster.ab_datum ?? r.datum, DienstreiseVerbindung.hm(abErst))
        let tagLetzt = letzter.ab_datum ?? r.datum
        let abLetzt = Stunden.zeitpunkt(tagLetzt, DienstreiseVerbindung.hm(wert(lv[letzter.id]?.abfahrt) ?? letzter.ab_zeit))
        var ende: Date?
        if let an = wert(lv[letzter.id]?.ankunft) ?? wert(letzter.an_zeit) {
            ende = Stunden.zeitpunkt(letzter.an_datum ?? tagLetzt, DienstreiseVerbindung.hm(an))
            if let e = ende, let ab = abLetzt, e < ab { ende = e.addingTimeInterval(86400) }
        }
        return (start, ende)
    }

    private func auswaehlen(_ liste: [DienstreiseSpeicher.Reise], jetzt: Date) -> DienstreiseSpeicher.Reise? {
        liste.first { r in
            guard r.status == "accepted", r.beendet == nil else { return false }
            let z = Self.zeitraum(r, liveJe)
            guard let start = z.start, jetzt >= start.addingTimeInterval(-Self.vorlauf) else { return false }
            // Ohne bekannte Ankunft: bis die Reise aus der Liste faellt (beendet bzw. Ende Folgetag).
            if let ende = z.ende { return jetzt <= ende.addingTimeInterval(Self.nachlauf) }
            return true
        }
    }

    // MARK: - Inhalt

    private static func kurz(_ name: String) -> String {
        name.split(separator: ",").first.map { String($0).trimmingCharacters(in: .whitespaces) } ?? name
    }

    /// "ICE 612 → Mannheim Hbf", ohne Nummer nur das Ziel.
    private static func linie(_ a: DienstreiseAbschnitt) -> String {
        let n = a.nummer.trimmingCharacters(in: .whitespaces)
        return n.isEmpty ? "→ \(kurz(a.nach_name))" : "\(n) → \(kurz(a.nach_name))"
    }

    private static func differenz(_ ist: String?, _ plan: String?) -> Int? {
        guard let a = DienstreiseAbschnitt.minuten(ist), let p = DienstreiseAbschnitt.minuten(plan) else { return nil }
        let d = (a - p + 1440) % 1440
        // Fruehere Zeit (z. B. 1435 Minuten) nicht als Verspaetung zaehlen.
        return d > 0 && d < 720 ? d : nil
    }

    static func stand(_ r: DienstreiseSpeicher.Reise, liveJe roh: [UUID: DienstreiseVerbindung],
                      jetzt: Date) -> DienstreiseAktivitaet.ContentState? {
        let t = teile(r), lv = live(r, roh)
        guard let l = ReiseLage.berechnen(teile: t, liveJe: lv, datum: r.datum, standort: nil, jetzt: jetzt) else { return nil }
        let i = l.index
        let a = t[i], v = lv[a.id]
        let n = t.count
        let ab = wert(v?.abfahrt) ?? a.ab_zeit
        let an = wert(v?.ankunft) ?? a.an_zeit
        // Gleis live gegen Ticket/Fahrplan (15.11.): geaendert als Orange-Hinweis "Gleis 9 statt 7".
        let abStand = DienstreiseVerbindung.gleisStand(live: v?.gleis, ticket: a.gleis_ab, fahrplan: v?.gleis_plan)
        let anStand = DienstreiseVerbindung.gleisStand(live: v?.gleis_an, ticket: a.gleis_an, fahrplan: v?.gleis_an_plan)
        let gleisAb = abStand.gleis
        func statt(_ g: (gleis: String, vorher: String)) -> String { "Gleis \(g.gleis) statt \(g.vorher)" }
        let nummer = a.nummer.trimmingCharacters(in: .whitespaces)

        // Umstieg: warten auf Abschnitt i (Abfahrt des naechsten), vorher ausgestiegen aus i-1.
        if l.imUmstieg {
            let vorher = i > 0 ? t[i - 1] : nil
            var minuten = 0
            if let d = Stunden.zeitpunkt(a.ab_datum ?? r.datum, DienstreiseVerbindung.hm(ab)) {
                minuten = max(0, Int((d.timeIntervalSince(jetzt) / 60).rounded(.up)))
            }
            let vl = vorher.flatMap { lv[$0.id] }
            let vonGleis = vorher.map { DienstreiseVerbindung.gleisStand(live: vl?.gleis_an, ticket: $0.gleis_an, fahrplan: vl?.gleis_an_plan).gleis } ?? ""
            // "Gleis 3 → " + "Gleis 9 statt 7" (Orange), ohne Aenderung "Gleis 3 → Gleis 9".
            let von = vonGleis.isEmpty ? "" : "Gleis \(vonGleis)"
            let geaendert = !abStand.vorher.isEmpty
            let nach = gleisAb.isEmpty ? "" : (geaendert ? statt(abStand) : "Gleis \(gleisAb)")
            let vorn = von.isEmpty || nach.isEmpty ? von : "\(von) → "
            return .init(marke: "AB", zeit: ab, spaet: differenz(v?.abfahrt, v?.abfahrt_plan),
                         oben: "Umstieg \(minuten) min", zeile1: linie(a),
                         zeile2: geaendert ? vorn : vorn + nach,
                         art: a.art, nummer: nummer, gleis: gleisAb.isEmpty ? "" : "Gleis \(gleisAb)",
                         hinweis: geaendert ? nach : nil)
        }

        let laeuft = l.status[i] == "jetzt" || l.vorbei
        let mitLive = DienstreiseAbschnitt.mitLive(a.art) && v != nil
        let teil = n > 1 ? "Dienstreise · \(i + 1)/\(n)" : "Dienstreise"

        // Unterwegs im Zug (bzw. Flug, S-Bahn) mit Live-Stand, auch kurz nach Ankunft.
        if laeuft && mitLive {
            let gleisAn = anStand.gleis
            let anGeaendert = !anStand.vorher.isEmpty
            var zweite: [String] = []
            if !gleisAn.isEmpty && !anGeaendert { zweite.append("Gleis \(gleisAn)") }
            if i + 1 < n {
                let naechste = t[i + 1].nummer.trimmingCharacters(in: .whitespaces)
                zweite.append(naechste.isEmpty ? "dann \(kurz(t[i + 1].nach_name))" : "dann \(naechste)")
            } else if l.vorbei {
                zweite.append("Angekommen")
            }
            // Geaendertes Ankunftsgleis vorn in Orange: "Gleis 3 statt 1" + " · dann ICE 71".
            let rest = zweite.joined(separator: " · ")
            return .init(marke: "AN", zeit: an, spaet: differenz(v?.ankunft, v?.ankunft_plan),
                         oben: teil, zeile1: linie(a), zeile2: anGeaendert ? "" : rest,
                         art: a.art, nummer: nummer, gleis: gleisAn.isEmpty ? "" : "Gleis \(gleisAn)",
                         hinweis: anGeaendert ? statt(anStand) : nil,
                         rest: anGeaendert && !rest.isEmpty ? " · \(rest)" : nil)
        }

        // Vor Start, Bus/U-Bahn/Tram oder ohne Live: "Bus 192 · Ottilienstraße", "→ Trudering 06:52".
        let erste = [nummer, kurz(a.von_name)].filter { !$0.isEmpty }.joined(separator: " · ")
        let zweite = "→ \(kurz(a.nach_name))\(an.isEmpty ? "" : " \(an)")"
        if laeuft {
            return .init(marke: "AN", zeit: an.isEmpty ? ab : an, spaet: differenz(v?.ankunft, v?.ankunft_plan),
                         oben: l.vorStart ? "Dienstreise" : teil, zeile1: erste, zeile2: zweite,
                         art: a.art, nummer: nummer, gleis: a.gleis_an.isEmpty ? "" : "Gleis \(a.gleis_an)")
        }
        // Vor der Abfahrt: geaendertes Abfahrtsgleis als " · Gleis 9 statt 7" in Orange.
        return .init(marke: "AB", zeit: ab, spaet: differenz(v?.abfahrt, v?.abfahrt_plan),
                     oben: "Dienstreise", zeile1: erste, zeile2: zweite,
                     art: a.art, nummer: nummer, gleis: gleisAb.isEmpty ? "" : "Gleis \(gleisAb)",
                     hinweis: abStand.vorher.isEmpty ? nil : " · \(statt(abStand))")
    }

    // MARK: - Live-Stand (alle 2 min, solange die Reise laeuft)

    private func holenStarten(_ r: DienstreiseSpeicher.Reise) {
        #if DEBUG
        if Self.beispielLauf { return }
        #endif
        let schluessel = "\(r.id)|" + Self.teile(r).map { "\($0.id)|\($0.nummer)|\($0.ab_zeit)" }.joined(separator: ",")
        guard schluessel != holerSchluessel else { return }
        holer?.cancel()
        holerSchluessel = schluessel
        liveJe = [:]
        holer = Task { [weak self] in
            while !Task.isCancelled {
                if r.abschnitte.isEmpty {
                    if !r.nummer.isEmpty, let neu = await DienstreiseSpeicher.verbindungHolen(r), neu.fehler == nil, !Task.isCancelled {
                        self?.liveJe[r.id] = neu
                    }
                } else {
                    for a in r.abschnitte {
                        if Task.isCancelled { return }
                        if let neu = await DienstreiseSpeicher.verbindungHolen(a, datum: r.datum), neu.fehler == nil, !Task.isCancelled {
                            self?.liveJe[a.id] = neu
                        }
                    }
                }
                if Task.isCancelled { return }
                self?.abgleichen()
                try? await Task.sleep(for: .seconds(120))
            }
        }
    }

    private func holenStoppen() {
        #if DEBUG
        if Self.beispielLauf { return }
        #endif
        holer?.cancel()
        holer = nil
        holerSchluessel = ""
        liveJe = [:]
    }

    // MARK: - Beispiel (nur Debug, Startargument -dienstreiseBeispiel)

    #if DEBUG
    static let beispielLauf = ProcessInfo.processInfo.arguments.contains("-dienstreiseBeispiel")

    /// Bus 192 06:45 Ottilienstraße → Trudering, U2 → München Hbf, ICE 612 07:28 → Mannheim Hbf 10:26 Gl. 3,
    /// ICE 71 11:00 Gl. 7 → Offenburg 11:58. Zeiten so verschoben, dass gerade ICE 612 laeuft (jetzt = 08:28).
    static let beispielReise: DienstreiseSpeicher.Reise = {
        let basis = Date()
        let berlin = TimeZone(identifier: "Europe/Berlin") ?? .current
        func zeit(_ hhmm: String) -> (tag: String, uhr: String) {
            let m = DienstreiseAbschnitt.minuten(hhmm) ?? 0
            let d = basis.addingTimeInterval(TimeInterval((m - (8 * 60 + 28)) * 60))
            let f = DateFormatter(); f.locale = Locale(identifier: "en_US_POSIX"); f.timeZone = berlin
            f.dateFormat = "yyyy-MM-dd"
            let tag = f.string(from: d)
            f.dateFormat = "HH:mm"
            return (tag, f.string(from: d))
        }
        let reiseID = UUID()
        func abschnitt(_ art: String, _ nummer: String, _ von: String, _ ab: String, _ nach: String, _ an: String,
                       gleisAb: String = "", gleisAn: String = "") -> DienstreiseAbschnitt {
            let a = zeit(ab), b = zeit(an)
            return DienstreiseAbschnitt(id: UUID(), dienstreiseID: reiseID, art: art, nummer: nummer,
                                        vonName: von, vonLat: nil, vonLng: nil, abDatum: a.tag, abZeit: a.uhr,
                                        nachName: nach, nachLat: nil, nachLng: nil, anDatum: b.tag, anZeit: b.uhr,
                                        gleisAb: gleisAb, gleisAn: gleisAn)
        }
        let teile = [
            abschnitt("bus", "Bus 192", "Ottilienstraße", "06:45", "Trudering", "06:52"),
            abschnitt("ubahn", "U2", "Trudering", "07:00", "München Hbf", "07:15"),
            abschnitt("zug", "ICE 612", "München Hbf", "07:28", "Mannheim Hbf", "10:26", gleisAb: "12", gleisAn: "3"),
            abschnitt("zug", "ICE 71", "Mannheim Hbf", "11:00", "Offenburg", "11:58", gleisAb: "7"),
        ]
        let start = zeit("06:45")
        return DienstreiseSpeicher.Reise(
            id: reiseID, datum: start.tag, startZeit: start.uhr, startOrtID: nil, startName: "Ottilienstraße",
            startAdresse: nil, startLat: nil, startLng: nil, zielOrtID: nil, zielName: "Offenburg", zielAdresse: nil,
            zielLat: nil, zielLng: nil, zugnummer: "ICE 612", flugnummer: nil, notiz: nil, verbindung: nil,
            erstellt: nil, geaendert: nil, status: "accepted", beendet: nil, abschnitte: teile,
            ticketPfad: nil, ticketName: nil, auftragsnummer: nil, reisender: nil)
    }()

    /// Live-Stand im Beispiel: ICE 612 kommt 3 min spaeter an.
    private static let beispielLive: [UUID: DienstreiseVerbindung] = {
        let t = beispielReise.abschnitte
        var ice = DienstreiseVerbindung(art: "zug", nummer: "ICE 612")
        ice.abfahrt = t[2].ab_zeit; ice.abfahrt_plan = t[2].ab_zeit; ice.gleis = "12"
        ice.ankunft_plan = t[2].an_zeit
        if let m = DienstreiseAbschnitt.minuten(t[2].an_zeit) {
            ice.ankunft = String(format: "%02d:%02d", ((m + 3) / 60) % 24, (m + 3) % 60)
        }
        var ice71 = DienstreiseVerbindung(art: "zug", nummer: "ICE 71")
        ice71.abfahrt = t[3].ab_zeit; ice71.abfahrt_plan = t[3].ab_zeit; ice71.gleis = "7"
        ice71.ankunft = t[3].an_zeit; ice71.ankunft_plan = t[3].an_zeit
        return [t[2].id: ice, t[3].id: ice71]
    }()
    #endif

    private init() {
        #if DEBUG
        if Self.beispielLauf { liveJe = Self.beispielLive }
        #endif
    }
}
