import AVFoundation
import CoreLocation
import Foundation
import Supabase

/// Eigene Navigation der Fahrer-App (16.11.): nur bei Fahrten mit Route von Dispo (routen_punkte).
/// Google Maps laesst sich per Link keine Route vorgeben, deshalb fuehrt die App selbst.
/// Die Route kommt von places-proxy (aktion navi_route), hier liegen Fortschritt, Abseits-Erkennung,
/// Ansage und Neuberechnung. Die Ansicht dazu ist Ansichten/NavigationAnsicht.swift.

// MARK: - Daten der Route

/// Abbiegehinweis. m = Meter ab Anfang der Route, t = Sekunden Fahrzeit bis dorthin.
struct NaviHinweis: Equatable {
    let m: Double
    let t: Double
    /// start, gerade, rechts, links, leicht_rechts, leicht_links, scharf_rechts, scharf_links, wenden, kreisel, ziel
    let pfeil: String
    /// Text fuer das Banner.
    let kurz: String
    /// Ganzer Satz fuer die Ansage.
    let text: String
    let strasse: String
}

/// Halt oder Routenpunkt auf der Route. ab = Stelle in der Folge der Ziele (0 = Abholung).
struct NaviWegpunkt: Equatable {
    let m: Double
    let ab: Int
    /// abholung, punkt, stopp, ziel
    let art: String
}

/// Route der Dispo vom Abholort bis zum Ziel, schon vor dem Einsteigen sichtbar.
struct NaviVorschau: Equatable {
    let punkte: [CLLocationCoordinate2D]
    let laenge: Double
    let dauer: Double

    static func == (a: NaviVorschau, b: NaviVorschau) -> Bool {
        a.laenge == b.laenge && a.dauer == b.dauer && a.punkte.count == b.punkte.count
    }
}

struct NaviRoute {
    let punkte: [CLLocationCoordinate2D]
    /// Meter ab Routenanfang je Stuetzpunkt, auf die Laenge des Servers gestreckt
    /// (die Hinweise zaehlen in dessen Metern).
    let strecke: [Double]
    let laenge: Double
    let dauer: Double
    let hinweise: [NaviHinweis]
    let wegpunkte: [NaviWegpunkt]
    let anzahlZiele: Int
    /// Nur die Anfahrt zum Abholort.
    let bisAbholung: Bool
    /// Bei der Anfahrt: Route der Dispo vom Abholort bis zum Ziel, nur zum Ansehen (17.11.).
    var vorschau: NaviVorschau?
    /// (Meter, Sekunden) aufsteigend, fuer die Restzeit.
    private let zeitStuetzen: [(m: Double, t: Double)]

    init?(punkte: [CLLocationCoordinate2D], laenge: Double?, dauer: Double?, hinweise: [NaviHinweis],
          wegpunkte: [NaviWegpunkt], anzahlZiele: Int, bisAbholung: Bool) {
        guard punkte.count >= 2 else { return nil }
        var roh: [Double] = [0]
        for i in 1..<punkte.count { roh.append(roh[i - 1] + NaviRoute.meter(punkte[i - 1], punkte[i])) }
        let gesamt = roh[roh.count - 1]
        guard gesamt > 0 else { return nil }
        let lang = (laenge ?? 0) > 0 ? laenge! : gesamt
        let faktor = lang / gesamt
        self.punkte = punkte
        self.strecke = roh.map { $0 * faktor }
        self.laenge = lang
        self.dauer = max(0, dauer ?? 0)
        self.hinweise = hinweise.sorted { $0.m < $1.m }
        self.wegpunkte = wegpunkte
        self.anzahlZiele = anzahlZiele
        self.bisAbholung = bisAbholung
        var stuetzen: [(m: Double, t: Double)] = [(0, 0)]
        for h in self.hinweise where h.m > stuetzen[stuetzen.count - 1].m && h.m < lang
            && h.t >= stuetzen[stuetzen.count - 1].t && h.t <= self.dauer {
            stuetzen.append((h.m, h.t))
        }
        stuetzen.append((lang, self.dauer))
        zeitStuetzen = stuetzen
    }

    /// Gleiche Rechnung wie meterZwischen auf dem Server.
    static func meter(_ a: CLLocationCoordinate2D, _ b: CLLocationCoordinate2D) -> Double {
        let dLat = (b.latitude - a.latitude) * 111_320
        let dLng = (b.longitude - a.longitude) * 111_320 * cos((a.latitude + b.latitude) / 2 * .pi / 180)
        return (dLat * dLat + dLng * dLng).squareRoot()
    }

    /// Richtung von a nach b in Grad (0 = Norden, im Uhrzeigersinn).
    static func richtung(_ a: CLLocationCoordinate2D, _ b: CLLocationCoordinate2D) -> Double {
        let dLat = b.latitude - a.latitude
        let dLng = (b.longitude - a.longitude) * cos((a.latitude + b.latitude) / 2 * .pi / 180)
        let grad = atan2(dLng, dLat) * 180 / .pi
        return grad < 0 ? grad + 360 : grad
    }

    struct Treffer {
        /// Meter ab Routenanfang.
        let s: Double
        /// Abstand zur Linie in Metern.
        let abstand: Double
        /// Abschnitt der Linie (zwischen punkte[index] und punkte[index + 1]).
        let index: Int
        let punkt: CLLocationCoordinate2D
        /// Richtung der Linie an dieser Stelle.
        let kurs: Double
    }

    /// Standort auf die Linie setzen. Gesucht wird nur zwischen von und bis (Meter ab Routenanfang),
    /// damit Schleifen und Hin-und-zurueck-Stuecke nicht springen.
    func projizieren(_ ort: CLLocationCoordinate2D, von: Double, bis: Double) -> Treffer? {
        let kosinus = cos(ort.latitude * .pi / 180)
        func eben(_ p: CLLocationCoordinate2D) -> (x: Double, y: Double) {
            ((p.longitude - ort.longitude) * 111_320 * kosinus, (p.latitude - ort.latitude) * 111_320)
        }
        var bester: Treffer?
        for i in 0..<(punkte.count - 1) {
            if strecke[i + 1] < von { continue }
            if strecke[i] > bis { break }
            let a = eben(punkte[i]), b = eben(punkte[i + 1])
            let dx = b.x - a.x, dy = b.y - a.y
            let quadrat = dx * dx + dy * dy
            let anteil = quadrat > 0 ? min(1, max(0, -(a.x * dx + a.y * dy) / quadrat)) : 0
            let px = a.x + anteil * dx, py = a.y + anteil * dy
            let abstand = (px * px + py * py).squareRoot()
            if let bisher = bester, abstand >= bisher.abstand { continue }
            let p = CLLocationCoordinate2D(
                latitude: punkte[i].latitude + anteil * (punkte[i + 1].latitude - punkte[i].latitude),
                longitude: punkte[i].longitude + anteil * (punkte[i + 1].longitude - punkte[i].longitude))
            bester = Treffer(s: strecke[i] + anteil * (strecke[i + 1] - strecke[i]), abstand: abstand, index: i,
                             punkt: p, kurs: NaviRoute.richtung(punkte[i], punkte[i + 1]))
        }
        return bester
    }

    /// Rest der Linie ab einem Treffer (der gefahrene Teil faellt weg).
    func rest(ab treffer: Treffer) -> [CLLocationCoordinate2D] {
        [treffer.punkt] + punkte[(treffer.index + 1)...]
    }

    /// Fahrzeit vom Routenanfang bis s, zwischen den Hinweisen gleichmaessig verteilt.
    func zeit(beiS s: Double) -> Double {
        let wo = min(max(0, s), laenge)
        for i in 1..<zeitStuetzen.count where wo <= zeitStuetzen[i].m {
            let a = zeitStuetzen[i - 1], b = zeitStuetzen[i]
            let spanne = b.m - a.m
            return spanne > 0 ? a.t + (b.t - a.t) * (wo - a.m) / spanne : b.t
        }
        return dauer
    }
}

// MARK: - Texte

enum NaviText {
    /// Entfernung zum naechsten Hinweis: ab 1000 m in km mit einer Nachkommastelle,
    /// 100 bis 999 auf 50 m, 30 bis 99 auf 10 m, darunter "Jetzt".
    static func entfernung(_ m: Double) -> String {
        if m < 30 { return "Jetzt" }
        if m < 100 { return "\(Int((m / 10).rounded()) * 10) m" }
        if m < 1000 {
            let gerundet = Int((m / 50).rounded()) * 50
            if gerundet < 1000 { return "\(gerundet) m" }
        }
        return kilometer(m)
    }

    static func kilometer(_ m: Double) -> String {
        String(format: "%.1f km", m / 1000).replacingOccurrences(of: ".", with: ",")
    }

    /// Reststrecke im Fuss: "31,4 km" bzw. "850 m".
    static func reststrecke(_ m: Double) -> String {
        let gerundet = Int((max(0, m) / 10).rounded()) * 10
        return gerundet >= 1000 ? kilometer(m) : "\(gerundet) m"
    }

    /// "Biegen Sie rechts ab" -> "biegen Sie rechts ab" (hinter "In 400 Metern").
    static func kleinerAnfang(_ text: String) -> String {
        guard let erster = text.first else { return text }
        return erster.lowercased() + text.dropFirst()
    }
}

// MARK: - Fuehrung

@MainActor
final class NaviFuehrung: NSObject, ObservableObject {
    enum Lage: Equatable {
        case warteStandort, laedt, fehler, fuehrt, abseits, angekommen
    }

    /// Wer die Fuehrung gerade zeigt (17.11.). Handy und CarPlay teilen sich EINE Fuehrung (eine Route,
    /// eine Ansage). Sie endet erst, wenn keiner sie mehr zeigt, oder sofort mit beendenFuerAlle().
    enum Nutzer: Hashable { case handy, carplay }

    /// Die eine Fuehrung der App fuer Handy (NavigationAnsicht) und CarPlay (CarPlaySzene).
    static let geteilt = NaviFuehrung()

    /// Alles, was Banner und Fuss zeigen.
    struct Anzeige: Equatable {
        var lage: Lage = .warteStandort
        var naechster: NaviHinweis?
        /// Meter bis zum naechsten Hinweis.
        var entfernung: Double = 0
        /// Uebernaechster Hinweis, nur wenn er weniger als 300 m nach dem naechsten kommt.
        var dann: NaviHinweis?
        var restSekunden: Double?
        var restMeter: Double?
        /// Ankunft am Abholort (sonst am Ziel).
        var amAbholort = false
    }

    /// Alles, was die Karte zeichnet. Die Zaehler sagen der Karte, was sich geaendert hat.
    struct Karte {
        var ort: CLLocationCoordinate2D?
        var kurs: Double = 0
        var ortStand = 0
        var linie: [CLLocationCoordinate2D] = []
        var linieStand = 0
        /// Abseits: alte Route blass, bis die neue da ist.
        var blass = false
        /// Ende der Route (Abholort oder Ziel) als Pin.
        var ende: CLLocationCoordinate2D?
        var endeAbholort = false
        var routeStand = 0
        /// Route der Dispo bis zum Ziel, nur bei der Anfahrt (sonst nil).
        var vorschau: NaviVorschau?
    }

    @Published private(set) var anzeige = Anzeige()
    @Published private(set) var karte = Karte()
    /// Laeuft im Sekundentakt mit, damit die Ankunftszeit auch im Stand weiterzaehlt.
    @Published private(set) var jetzt = Date()
    @Published var stumm: Bool {
        didSet {
            UserDefaults.standard.set(stumm, forKey: Self.stummSchluessel)
            if stumm { sprecher.stopSpeaking(at: .immediate) }
        }
    }

    private static let stummSchluessel = "trisar-navi-stumm"
    private static let standSchluessel = "trisar-navi-stand"
    /// Abstand zur Linie, ab dem ein Standort als abseits zaehlt, und wie viele in Folge es braucht.
    private static let abseitsMeter = 50.0
    private static let abseitsAnzahl = 3
    /// Fruehestens alle 8 s eine neue Route anfordern (auch nach einem Fehler).
    private static let anfrageAbstand: TimeInterval = 8

    private let manager = CLLocationManager()
    private let sprecher = AVSpeechSynthesizer()
    private var offeneAnsagen = 0
    private var taktgeber: Timer?
    private var tonVorher: (AVAudioSession.Category, AVAudioSession.Mode, AVAudioSession.CategoryOptions)?

    private var aktiv = false
    /// Fahrt der laufenden Fuehrung (nil = keine).
    private(set) var fahrtID: UUID?
    /// Leer = keine Fuehrung. CarPlay beobachtet das, um eine Fuehrung vom Handy mitzuzeigen.
    @Published private(set) var nutzer: Set<Nutzer> = []
    private(set) var unterwegs = false
    /// Gemerkter Stand: erste noch offene Stelle der Folge (0 = Abholung).
    private var stand = 0
    private var route: NaviRoute?
    private var letzterOrt: CLLocation?
    private var letztesS = 0.0
    private var letzterFix = Date.distantPast
    private var abseitsZaehler = 0
    private var neuNoetig = true
    private var laedtGerade = false
    private var letzteAnfrage = Date.distantPast
    private var anfrageNummer = 0
    /// Je Hinweis (Stelle in route.hinweise): schon angesagt bzw. war schon einmal weiter als 500 m weg.
    private var angesagtVorab: Set<Int> = []
    private var angesagtJetzt: Set<Int> = []
    private var warWeit: Set<Int> = []
    private var neuAngesagt = false

    override init() {
        stumm = UserDefaults.standard.bool(forKey: Self.stummSchluessel)
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyBestForNavigation
        manager.distanceFilter = kCLDistanceFilterNone
        manager.activityType = .automotiveNavigation
        manager.pausesLocationUpdatesAutomatically = false
        sprecher.delegate = self
    }

    /// Gast an Bord ("unterwegs"): dann gilt die Route der Fahrt, davor nur die Anfahrt zum Abholort.
    static func gastAnBord(_ status: String?) -> Bool {
        ["in_progress", "unterwegs", "started", "on_trip", "ongoing", "active"].contains((status ?? "").lowercased())
    }

    // MARK: Start und Ende

    /// start: letzter bekannter Standort der App, damit die Route nicht auf den ersten eigenen Fix wartet.
    /// Laeuft die Fuehrung fuer diese Fahrt schon (z. B. in CarPlay), zeigt `fuer` sie nur mit.
    /// Laeuft sie fuer eine andere Fahrt, endet die alte und die neue beginnt.
    func starten(fahrtID: UUID, unterwegs: Bool, start: CLLocation?, fuer: Nutzer = .handy) {
        if aktiv {
            if self.fahrtID == fahrtID {
                nutzer.insert(fuer)
                return
            }
            beendenFuerAlle()
        }
        aktiv = true
        nutzer = [fuer]
        self.fahrtID = fahrtID
        self.unterwegs = unterwegs
        stand = Self.gemerkterStand(fahrtID)
        // Eine Instanz fuer alle Fahrten: Reste der letzten Fuehrung weg.
        route = nil
        letzterOrt = nil
        letztesS = 0
        letzterFix = .distantPast
        abseitsZaehler = 0
        laedtGerade = false
        letzteAnfrage = .distantPast
        angesagtVorab = []
        angesagtJetzt = []
        warWeit = []
        neuAngesagt = false
        anzeige = Anzeige()
        karte = Karte()
        neuNoetig = true
        if manager.authorizationStatus == .notDetermined { manager.requestWhenInUseAuthorization() }
        manager.startUpdatingLocation()
        // Eigener Taktgeber statt Timer in der Ansicht: die wird bei jedem Standort neu gebaut.
        taktgeber?.invalidate()
        taktgeber = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] uhr in
            guard let self else { uhr.invalidate(); return }
            Task { @MainActor in self.takt() }
        }
        if let start, start.horizontalAccuracy >= 0, abs(start.timestamp.timeIntervalSinceNow) < 20 {
            letzterOrt = start
            karte.ort = start.coordinate
            if start.course >= 0 { karte.kurs = start.course }
            karte.ortStand += 1
            anfordern()
        }
    }

    /// `fuer` zeigt die Fuehrung nicht mehr. Erst wenn keiner sie mehr zeigt, endet sie.
    func beenden(fuer: Nutzer = .handy) {
        nutzer.remove(fuer)
        guard nutzer.isEmpty else { return }
        beendenFuerAlle()
    }

    /// Sofort ganz beenden (z. B. das Auto startet seine eigene Navigation oder Ende in CarPlay).
    func beendenFuerAlle() {
        if !nutzer.isEmpty { nutzer = [] }
        guard aktiv else { return }
        aktiv = false
        fahrtID = nil
        anfrageNummer += 1
        taktgeber?.invalidate()
        taktgeber = nil
        manager.stopUpdatingLocation()
        sprecher.stopSpeaking(at: .immediate)
        offeneAnsagen = 0
        tonFreigeben()
    }

    /// Wechsel der Phase (Gast steigt ein): sofort die passende Route laden.
    func phase(unterwegs neu: Bool) {
        guard aktiv, neu != unterwegs else { return }
        unterwegs = neu
        neuNoetig = true
        // Eine laufende Anfrage der alten Phase gilt nicht mehr.
        anfrageNummer += 1
        laedtGerade = false
        letzteAnfrage = .distantPast
        anfordern()
    }

    /// Jede Sekunde: Uhr fuer die Ankunftszeit, offene Neuberechnung (Abseits, Fehler) nach der Wartezeit anstossen.
    private func takt() {
        guard aktiv else { return }
        jetzt = Date()
        anfordern()
    }

    // MARK: Route laden

    private struct Anfrage: Encodable {
        let aktion = "navi_route"
        let job_id: String
        let lat: Double
        let lng: Double
        let kurs: Double?
        let ab: Int
        let bis_abholung: Bool
    }

    private struct Antwort: Decodable {
        struct Hinweis: Decodable {
            let m: Double?
            let t: Double?
            let pfeil: String?
            let kurz: String?
            let text: String?
            let strasse: String?
        }
        struct Wegpunkt: Decodable {
            let m: Double?
            let ab: Int?
            let art: String?
        }
        let ok: Bool?
        let fehler: String?
        let polyline: String?
        let laenge_m: Double?
        let dauer_s: Double?
        let hinweise: [Hinweis]?
        let wegpunkte: [Wegpunkt]?
        let anzahl_ziele: Int?
        let vorschau: Vorschau?
        struct Vorschau: Decodable {
            let polyline: String?
            let laenge_m: Double?
            let dauer_s: Double?
        }
    }

    private func anfordern() {
        guard aktiv, neuNoetig, !laedtGerade, let fahrtID, let ort = letzterOrt,
              Date().timeIntervalSince(letzteAnfrage) >= Self.anfrageAbstand else { return }
        laedtGerade = true
        letzteAnfrage = Date()
        anfrageNummer += 1
        let nummer = anfrageNummer
        let bisAbholung = !unterwegs
        let anfrage = Anfrage(
            job_id: fahrtID.uuidString.lowercased(),
            lat: ort.coordinate.latitude,
            lng: ort.coordinate.longitude,
            // Kurs nur in Fahrt: im Stand ist er zufaellig und schickt die Route in die falsche Richtung.
            kurs: ort.course >= 0 && ort.speed >= 1 ? ort.course : nil,
            ab: bisAbholung ? 0 : max(1, stand),
            bis_abholung: bisAbholung)
        if route == nil { anzeige.lage = .laedt }
        Task {
            let neu = await Self.laden(anfrage)
            guard aktiv, nummer == anfrageNummer else { return }
            laedtGerade = false
            if let neu {
                uebernehmen(neu)
            } else if route == nil {
                anzeige.lage = .fehler
            }
            // Mit alter Route bleibt die Anzeige stehen, takt() versucht es nach der Wartezeit erneut.
        }
    }

    #if DEBUG
    /// Nur Debug (-naviTest): Route aus der Umgebung NAVI_TEST_JSON statt vom Server, fuer Bilder im
    /// Simulator ohne Anmeldung. Der zweite Abruf (nach "Abseits") laesst auf sich warten.
    static let testLauf = ProcessInfo.processInfo.arguments.contains("-naviTest")
    private static var testAbrufe = 0
    private static func testAntwort() async -> Antwort? {
        testAbrufe += 1
        if testAbrufe > 1 { try? await Task.sleep(nanoseconds: 60_000_000_000) }
        guard let text = ProcessInfo.processInfo.environment["NAVI_TEST_JSON"], let daten = text.data(using: .utf8) else { return nil }
        return try? JSONDecoder().decode(Antwort.self, from: daten)
    }
    #endif

    private static func laden(_ anfrage: Anfrage) async -> NaviRoute? {
        var antwort: Antwort?
        #if DEBUG
        if testLauf { antwort = await testAntwort() }
        #endif
        if antwort == nil {
            antwort = try? await Backend.client.functions.invoke("places-proxy", options: FunctionInvokeOptions(body: anfrage))
        }
        guard let a = antwort, a.ok == true else { return nil }
        let hinweise = (a.hinweise ?? []).map {
            NaviHinweis(m: $0.m ?? 0, t: $0.t ?? 0, pfeil: $0.pfeil ?? "gerade", kurz: $0.kurz ?? "",
                        text: $0.text ?? $0.kurz ?? "", strasse: $0.strasse ?? "")
        }
        let wegpunkte = (a.wegpunkte ?? []).compactMap { w -> NaviWegpunkt? in
            guard let m = w.m, let ab = w.ab else { return nil }
            return NaviWegpunkt(m: m, ab: ab, art: w.art ?? "")
        }
        var route = NaviRoute(punkte: FahrtDetails.polylineLesen(a.polyline), laenge: a.laenge_m, dauer: a.dauer_s,
                              hinweise: hinweise, wegpunkte: wegpunkte, anzahlZiele: a.anzahl_ziele ?? 0,
                              bisAbholung: anfrage.bis_abholung)
        if anfrage.bis_abholung, let v = a.vorschau {
            let punkte = FahrtDetails.polylineLesen(v.polyline)
            if punkte.count >= 2 { route?.vorschau = NaviVorschau(punkte: punkte, laenge: v.laenge_m ?? 0, dauer: v.dauer_s ?? 0) }
        }
        return route
    }

    private func uebernehmen(_ neu: NaviRoute) {
        route = neu
        neuNoetig = false
        letztesS = 0
        letzterFix = Date()
        abseitsZaehler = 0
        angesagtVorab = []
        angesagtJetzt = []
        warWeit = []
        neuAngesagt = false
        anzeige = Anzeige(lage: .fuehrt)
        karte.linie = neu.punkte
        karte.linieStand += 1
        karte.blass = false
        karte.ende = neu.punkte.last
        karte.endeAbholort = neu.bisAbholung || neu.wegpunkte.last?.art == "abholung"
        karte.vorschau = neu.vorschau
        karte.routeStand += 1
        if let ort = letzterOrt { fortschritt(ort) } else { anzeigeRechnen(neu, s: 0) }
    }

    // MARK: Fortschritt

    private func neuerStandort(_ ort: CLLocation) {
        guard aktiv, ort.horizontalAccuracy >= 0, abs(ort.timestamp.timeIntervalSinceNow) < 15 else { return }
        letzterOrt = ort
        if route == nil {
            karte.ort = ort.coordinate
            if ort.course >= 0, ort.speed >= 2 { karte.kurs = ort.course }
            karte.ortStand += 1
            if anzeige.lage == .warteStandort { anzeige.lage = .laedt }
            anfordern()
            return
        }
        fortschritt(ort)
    }

    private func fortschritt(_ ort: CLLocation) {
        guard let route else { return }
        let pause = min(60, max(0, ort.timestamp.timeIntervalSince(letzterFix)))
        letzterFix = ort.timestamp
        let tempo = ort.speed >= 0 ? ort.speed : 15
        // Erst nah an der letzten Stelle suchen, nur ohne Treffer dort im groesseren Fenster.
        var treffer = route.projizieren(ort.coordinate, von: letztesS - 30, bis: letztesS + 80 + tempo * pause * 2)
        if treffer == nil || treffer!.abstand > Self.abseitsMeter {
            treffer = route.projizieren(ort.coordinate, von: letztesS - 50, bis: letztesS + 400 + 40 * pause) ?? treffer
        }
        guard let treffer else { return }
        let aufRoute = treffer.abstand <= Self.abseitsMeter

        // Karte: nah an der Linie sitzt der Pfeil auf der Linie, sonst am echten Standort.
        karte.ort = treffer.abstand <= 30 ? treffer.punkt : ort.coordinate
        if ort.course >= 0, ort.speed >= 2 {
            karte.kurs = ort.course
        } else if aufRoute, anzeige.lage != .angekommen {
            karte.kurs = treffer.kurs
        }
        karte.ortStand += 1

        // Am Ende der Route bleibt die Ankunft stehen (der Fahrer rangiert, sucht den Gast).
        if anzeige.lage == .angekommen { return }

        if !aufRoute {
            // Sehr ungenaue Standorte (Tunnel, Tiefgarage) zaehlen nicht als abseits.
            guard ort.horizontalAccuracy <= 100 else { return }
            abseitsZaehler += 1
            if abseitsZaehler >= Self.abseitsAnzahl {
                if anzeige.lage != .abseits {
                    anzeige.lage = .abseits
                    anzeige.dann = nil
                    karte.blass = true
                    karte.linieStand += 1
                }
                if !neuAngesagt {
                    neuAngesagt = true
                    sprechen("Route wird neu berechnet")
                }
                neuNoetig = true
                anfordern()
            }
            return
        }

        abseitsZaehler = 0
        if anzeige.lage == .abseits {
            // Von selbst zurueck auf der Route: weiter wie vorher, keine neue Route noetig.
            neuNoetig = false
            neuAngesagt = false
            karte.blass = false
        }
        letztesS = treffer.s
        karte.linie = route.rest(ab: treffer)
        karte.linieStand += 1

        // Wegpunkt erreicht: Stand merken, damit eine Neuberechnung nicht dorthin zurueckfuehrt.
        for w in route.wegpunkte where (w.art == "punkt" || w.art == "stopp") && treffer.s >= w.m - 30 {
            standSetzen(max(stand, w.ab + 1), ziele: route.anzahlZiele)
        }
        anzeigeRechnen(route, s: treffer.s)
        ansagen(route, s: treffer.s)
    }

    private func anzeigeRechnen(_ route: NaviRoute, s: Double) {
        var neu = Anzeige(lage: .fuehrt)
        neu.amAbholort = route.bisAbholung || route.wegpunkte.last?.art == "abholung"
        neu.restMeter = max(0, route.laenge - s)
        neu.restSekunden = max(0, route.dauer - route.zeit(beiS: s))
        if let i = naechsteStelle(route, s: s) {
            let h = route.hinweise[i]
            neu.naechster = h
            neu.entfernung = max(0, h.m - s)
            if i + 1 < route.hinweise.count, route.hinweise[i + 1].m - h.m < 300 { neu.dann = route.hinweise[i + 1] }
        }
        if s >= route.laenge - 30 {
            neu.lage = .angekommen
            neu.dann = nil
        }
        if neu != anzeige { anzeige = neu }
    }

    /// Naechster Hinweis = erster mit m > s - 10, hinter dem letzten bleibt der letzte (Ankunft).
    private func naechsteStelle(_ route: NaviRoute, s: Double) -> Int? {
        if route.hinweise.isEmpty { return nil }
        return route.hinweise.firstIndex { $0.m > s - 10 } ?? route.hinweise.count - 1
    }

    // MARK: Gemerkter Stand je Fahrt

    private static func gemerkterStand(_ fahrt: UUID) -> Int {
        let gemerkt = UserDefaults.standard.dictionary(forKey: standSchluessel)
        guard gemerkt?["fahrt"] as? String == fahrt.uuidString else { return 0 }
        return max(0, gemerkt?["ab"] as? Int ?? 0)
    }

    private func standSetzen(_ neu: Int, ziele: Int) {
        // Das Ziel (letzte Stelle) bleibt immer offen.
        let wert = ziele > 0 ? min(neu, ziele - 1) : neu
        guard wert != stand, let fahrtID else { return }
        stand = wert
        UserDefaults.standard.set(["fahrt": fahrtID.uuidString, "ab": wert], forKey: Self.standSchluessel)
    }

    // MARK: Ansage

    /// Je Hinweis hoechstens zweimal: bei 400 m (nur wenn er vorher weiter als 500 m weg war)
    /// und bei 50 m. Ankunft und Halte einmal bei 30 m. "start" wird nicht angesagt.
    private func ansagen(_ route: NaviRoute, s: Double) {
        guard let i = naechsteStelle(route, s: s) else { return }
        for k in i..<route.hinweise.count where route.hinweise[k].m - s > 500 { warWeit.insert(k) }
        let h = route.hinweise[i]
        let weg = h.m - s
        if h.pfeil == "start" { return }
        if h.pfeil == "ziel" {
            if weg <= 30, angesagtJetzt.insert(i).inserted { sprechen(h.text) }
            return
        }
        if weg <= 50 {
            if angesagtJetzt.insert(i).inserted {
                angesagtVorab.insert(i)
                sprechen(h.text)
            }
        } else if weg <= 400, warWeit.contains(i), angesagtVorab.insert(i).inserted {
            sprechen("In 400 Metern " + NaviText.kleinerAnfang(h.text))
        }
    }

    private func sprechen(_ text: String) {
        guard aktiv, !stumm, !text.isEmpty else { return }
        let sitzung = AVAudioSession.sharedInstance()
        if tonVorher == nil { tonVorher = (sitzung.category, sitzung.mode, sitzung.categoryOptions) }
        // Ansage auch bei Stummschalter, Musik und Radio werden solange leiser, Podcasts halten kurz an.
        // Genau so verlangt es Apple fuer CarPlay-Navigation (gilt am Handy genauso). Aktiv nur waehrend
        // gesprochen wird, ansageFertig gibt den Ton wieder frei.
        try? sitzung.setCategory(.playback, mode: .voicePrompt, options: [.interruptSpokenAudioAndMixWithOthers, .duckOthers])
        try? sitzung.setActive(true)
        let ansage = AVSpeechUtterance(string: text)
        ansage.voice = AVSpeechSynthesisVoice(language: "de-DE")
        offeneAnsagen += 1
        sprecher.speak(ansage)
    }

    private func ansageFertig() {
        offeneAnsagen = max(0, offeneAnsagen - 1)
        // Zwischen den Ansagen die Musik wieder laut, die Tonart der App bleibt bis zum Ende der Navigation.
        if offeneAnsagen == 0 {
            try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        }
    }

    private func tonFreigeben() {
        let sitzung = AVAudioSession.sharedInstance()
        try? sitzung.setActive(false, options: .notifyOthersOnDeactivation)
        if let (art, modus, optionen) = tonVorher {
            try? sitzung.setCategory(art, mode: modus, options: optionen)
            tonVorher = nil
        }
    }
}

extension NaviFuehrung: CLLocationManagerDelegate {
    nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        let status = manager.authorizationStatus
        Task { @MainActor in
            if self.aktiv, status == .authorizedAlways || status == .authorizedWhenInUse {
                self.manager.startUpdatingLocation()
            }
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let ort = locations.last else { return }
        Task { @MainActor in self.neuerStandort(ort) }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {}
}

extension NaviFuehrung: AVSpeechSynthesizerDelegate {
    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        Task { @MainActor in self.ansageFertig() }
    }

    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {
        Task { @MainActor in self.ansageFertig() }
    }
}
