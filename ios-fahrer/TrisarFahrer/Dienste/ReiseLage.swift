import CoreLocation
import Foundation
import MapLibre
import UIKit

/// Wo ist der Fahrer gerade auf seiner Dienstreise? (14.11.2026, gleich in fahrer/src/shared/reiseLage.js
/// und admin/src/shared/reiseLage.js). Geteilt mit der Dispo-App (ios-dispo/project.yml).
///
/// - Laufender Abschnitt nach Uhrzeit (Abfahrt/Ankunft live, sonst aus Ticket/Plan).
/// - Position: Handy-Standort des Fahrers, wenn hoechstens 3 Minuten alt und vom Handy (nicht vom OBD-Tracker,
///   das Auto steht waehrend der Reise woanders). Sonst errechnet: Anteil der Fahrzeit entlang der Linie
///   des Abschnitts. Beim Umstieg wartet er am Start des naechsten Abschnitts.
/// - Linie geteilt: gefahren (grau) bis zur Position, offen (blau) danach.
struct ReiseLage {
    /// Standort des Fahrers (lat/lng, Zeitpunkt, Quelle wie driver_live_locations.source).
    struct Standort: Equatable {
        var lat: Double
        var lng: Double
        var erfasst: Date?
        var quelle: String
    }

    let index: Int
    /// je Abschnitt "fertig", "jetzt" oder "offen"
    let status: [String]
    let vorStart: Bool
    let imUmstieg: Bool
    let vorbei: Bool
    let position: CLLocationCoordinate2D?
    /// "gps" oder "fahrplan"
    let quelle: String
    let art: String
    let aktuell: DienstreiseAbschnitt
    let gefahren: [CLLocationCoordinate2D]
    let offen: [CLLocationCoordinate2D]
    let gesamt: [CLLocationCoordinate2D]
    /// 15 min nach der letzten Ankunft (15.11.): kein GPS mehr am Zug, der Fahrer sitzt womoeglich schon im Auto.
    /// Dispo-Karten zeigen dann wieder den normalen Pin.
    let abgeschlossen: Bool

    private static let frisch: TimeInterval = 3 * 60
    private static let nachlauf: TimeInterval = 15 * 60

    /// Abstand im Quadrat, Laengengrad mit cos(Breite) gestaucht (wie abstand2 im Web).
    private static func abstand2(_ a: CLLocationCoordinate2D, _ b: CLLocationCoordinate2D) -> Double {
        let dx = (a.longitude - b.longitude) * cos(a.latitude * .pi / 180)
        let dy = a.latitude - b.latitude
        return dx * dx + dy * dy
    }

    /// Punkt auf einer Linie nach Anteil der Laenge (0..1).
    private static func punktBeiAnteil(_ linie: [CLLocationCoordinate2D], _ anteil: Double) -> CLLocationCoordinate2D? {
        guard let erster = linie.first else { return nil }
        if linie.count == 1 || anteil <= 0 { return erster }
        var laengen: [Double] = []
        var summe = 0.0
        for i in 1..<linie.count {
            let l = sqrt(abstand2(linie[i - 1], linie[i]))
            laengen.append(l)
            summe += l
        }
        var rest = min(anteil, 1) * summe
        for i in laengen.indices {
            if rest <= laengen[i] || i == laengen.count - 1 {
                let f = laengen[i] > 0 ? min(1, rest / laengen[i]) : 0
                let a = linie[i], b = linie[i + 1]
                return CLLocationCoordinate2D(latitude: a.latitude + (b.latitude - a.latitude) * f,
                                              longitude: a.longitude + (b.longitude - a.longitude) * f)
            }
            rest -= laengen[i]
        }
        return linie.last
    }

    /// Linie eines Abschnitts: Gleise (live), sonst Halte, sonst gespeicherte Linie vom Server
    /// (Bus entlang der Strassen, U-Bahn/Tram entlang der Gleise), sonst gerade von Start zu Ziel.
    static func abschnittLinie(_ a: DienstreiseAbschnitt, _ live: DienstreiseVerbindung?) -> [CLLocationCoordinate2D] {
        if let l = live?.liniePunkte, l.count >= 2 { return l }
        if let s = live?.strecke, s.count >= 2 { return s.map(\.punkt) }
        if let l = a.linie {
            let punkte = l.compactMap { p -> CLLocationCoordinate2D? in
                guard p.count >= 2, p[0].isFinite, p[1].isFinite else { return nil }
                return CLLocationCoordinate2D(latitude: p[1], longitude: p[0])
            }
            if punkte.count >= 2 { return punkte }
        }
        if let von = a.vonPunkt, let nach = a.nachPunkt { return [von, nach] }
        return []
    }

    static func berechnen(teile: [DienstreiseAbschnitt], liveJe: [UUID: DienstreiseVerbindung], datum: String,
                          standort: Standort?, jetzt: Date = Date()) -> ReiseLage? {
        guard !teile.isEmpty else { return nil }
        func zeit(_ tag: String, _ uhr: String?) -> Date? {
            let u = DienstreiseVerbindung.hm(uhr)
            return u.isEmpty ? nil : Stunden.zeitpunkt(tag, u)
        }
        func wert(_ t: String?) -> String? { (t ?? "").isEmpty ? nil : t }
        let zeiten: [(ab: Date?, an: Date?)] = teile.map { a in
            let live = liveJe[a.id]
            let tag = a.ab_datum ?? datum
            let ab = zeit(tag, wert(live?.abfahrt) ?? a.ab_zeit)
            var an = zeit(a.an_datum ?? tag, wert(live?.ankunft) ?? a.an_zeit)
            if let x = ab, let y = an, y < x { an = y.addingTimeInterval(86400) }
            return (ab, an)
        }

        // Laufender Abschnitt: erster, dessen Ankunft noch nicht vorbei ist.
        var index = zeiten.firstIndex { $0.an == nil || jetzt < $0.an! } ?? -1
        let vorbei = index < 0
        if vorbei { index = teile.count - 1 }
        let vorStart = !vorbei && index == 0 && zeiten[0].ab != nil && jetzt < zeiten[0].ab!
        let status: [String] = teile.indices.map { i in
            if vorbei || i < index { return "fertig" }
            if i == index && !vorStart && (zeiten[i].ab == nil || jetzt >= zeiten[i].ab!) { return "jetzt" }
            return "offen"
        }
        // Zwischen Ankunft und naechster Abfahrt: Umstieg (wartet am Start des Abschnitts `index`).
        let imUmstieg = !vorbei && !vorStart && status[index] == "offen"
        let abgeschlossen = vorbei && (zeiten.last?.an.map { jetzt > $0.addingTimeInterval(nachlauf) } ?? false)

        // Linien je Abschnitt und gesamt (mit Grenzen, um die Position einzuordnen).
        let linien = teile.map { abschnittLinie($0, liveJe[$0.id]) }
        var gesamt: [CLLocationCoordinate2D] = []
        var grenzen: [Int] = []
        for l in linien { grenzen.append(gesamt.count); gesamt += l }
        grenzen.append(gesamt.count)

        // Position: Handy (frisch), sonst errechnet.
        var handy = false
        if !abgeschlossen, let s = standort, s.lat.isFinite, s.lng.isFinite {
            let quelle = s.quelle.lowercased()
            let tracker = quelle.contains("teltonika") || quelle.contains("obd") || quelle.contains("tracker")
            let jung = s.erfasst.map { jetzt.timeIntervalSince($0) <= frisch } ?? true
            handy = !tracker && jung
        }
        var position: CLLocationCoordinate2D?
        let quelle: String
        if handy, let s = standort {
            position = CLLocationCoordinate2D(latitude: s.lat, longitude: s.lng)
            quelle = "gps"
        } else {
            quelle = "fahrplan"
            let l = linien[index]
            let z = zeiten[index]
            if vorbei { position = l.last }
            else if vorStart || imUmstieg { position = l.first }
            else {
                var anteil = 0.0
                if let ab = z.ab, let an = z.an, an > ab { anteil = jetzt.timeIntervalSince(ab) / an.timeIntervalSince(ab) }
                position = punktBeiAnteil(l, max(0, min(1, anteil)))
            }
        }

        // Grenze grau/blau: naechster Punkt der Gesamtlinie zur Position (im Bereich des laufenden Abschnitts).
        var teilung = 0
        if let p = position, !gesamt.isEmpty {
            let von = grenzen[index]
            let bis = max(von, grenzen[index + 1] - 1)
            var bester = Double.infinity
            if von <= bis {
                for i in von...bis where i < gesamt.count {
                    let d = abstand2(gesamt[i], p)
                    if d < bester { bester = d; teilung = i }
                }
            }
            if vorbei { teilung = gesamt.count - 1 }
        }
        let gefahren: [CLLocationCoordinate2D] = position.map { Array(gesamt.prefix(teilung + 1)) + [$0] } ?? []
        let offen: [CLLocationCoordinate2D] = position.map { [$0] + Array(gesamt.dropFirst(teilung + 1)) } ?? gesamt

        let aktuell = teile[index]
        return ReiseLage(index: index, status: status, vorStart: vorStart, imUmstieg: imUmstieg, vorbei: vorbei,
                         position: position, quelle: quelle, art: aktuell.art, aktuell: aktuell,
                         gefahren: gefahren, offen: offen, gesamt: gesamt, abgeschlossen: abgeschlossen)
    }

    /// Lime-Icon des Fahrzeugs auf der Karte.
    static func fahrzeugIcon(_ art: String) -> String {
        switch art {
        case "bus": return "Bus_Trisar_Icons_01_Lime"
        case "ubahn", "tram": return "U_Bahn_Trisar_Icons_01_Lime"
        case "flug": return "Plain_Abflug_Trisar_Icons_01_Lime"
        default: return "Bahnhof_Zug_Trisar_Icons_01_Lime"
        }
    }

    /// Umstieg auf der Karte: Start jedes weiteren Abschnitts mit Art und "U2 ab 06:56" (live, sonst Plan).
    struct UmstiegPunkt {
        let ort: CLLocationCoordinate2D
        let art: String
        let text: String
    }

    static func umstiegPunkte(_ teile: [DienstreiseAbschnitt], _ liveJe: [UUID: DienstreiseVerbindung]) -> [UmstiegPunkt] {
        teile.dropFirst().compactMap { a in
            guard let ort = a.vonPunkt else { return nil }
            let live = (liveJe[a.id]?.abfahrt).flatMap { $0.isEmpty ? nil : String($0.prefix(5)) }
            let ab = live ?? String(a.ab_zeit.prefix(5))
            let text = "\(a.nummer)\(ab.isEmpty ? "" : " ab \(ab)")".trimmingCharacters(in: .whitespaces)
            return UmstiegPunkt(ort: ort, art: a.art.isEmpty ? "zug" : a.art, text: text)
        }
    }

    /// Verspaetung in Minuten (live Ankunft gegen Plan), sonst nil.
    static func verspaetungMin(_ live: DienstreiseVerbindung?) -> Int? {
        guard let a = DienstreiseAbschnitt.minuten(live?.ankunft), let p = DienstreiseAbschnitt.minuten(live?.ankunft_plan) else { return nil }
        return (a - p + 1440) % 1440
    }
}

/// Marker „Fahrer sitzt im Fahrzeug“: schwarzer Kreis 48 mit Lime-Rand 2,5 und Fahrzeug, unten rechts der
/// Fahrer-Punkt 28 mit Nummer (Fahrer-App blau, Dispo in Statusfarbe mit schwarzem Rand), daneben eine Zeile Text.
final class FahrzeugMarkerAnsicht: MLNAnnotationView {
    init(art: String, nummer: String, text: String, punktFarbe: UIColor?) {
        super.init(reuseIdentifier: nil)
        frame = CGRect(x: 0, y: 0, width: 48, height: 48)
        clipsToBounds = false

        let kreis = UIView(frame: bounds)
        kreis.backgroundColor = .black
        kreis.layer.cornerRadius = 24
        kreis.layer.borderWidth = 2.5
        kreis.layer.borderColor = UIColor(hex: 0xE3F654).cgColor
        kreis.layer.shadowColor = UIColor.black.cgColor
        kreis.layer.shadowOpacity = 0.5
        kreis.layer.shadowRadius = 7
        kreis.layer.shadowOffset = CGSize(width: 0, height: 4)
        let bild = UIImageView(image: UIImage(named: ReiseLage.fahrzeugIcon(art)))
        bild.contentMode = .scaleAspectFit
        bild.frame = CGRect(x: 11, y: 11, width: 26, height: 26)
        kreis.addSubview(bild)
        addSubview(kreis)

        // right -12, bottom -8 bei 28 x 28
        let punktRahmen = CGRect(x: 48 + 12 - 28, y: 48 + 8 - 28, width: 28, height: 28)
        let punkt = UIView(frame: punktRahmen)
        if let punktFarbe {
            punkt.backgroundColor = punktFarbe
            punkt.layer.cornerRadius = 14
            punkt.layer.borderWidth = 2
            punkt.layer.borderColor = UIColor.black.cgColor
        } else {
            let blau = UIImageView(image: UIImage(named: "Fahrer_Standort_Trisar_01_blau"))
            blau.frame = punkt.bounds
            blau.contentMode = .scaleAspectFit
            punkt.addSubview(blau)
        }
        let zahl = UILabel(frame: punkt.bounds)
        zahl.text = nummer
        zahl.textAlignment = .center
        zahl.textColor = punktFarbe == nil ? .white : .black
        zahl.font = WebText.schrift(12, .bold)
        punkt.addSubview(zahl)
        addSubview(punkt)

        if !text.isEmpty {
            let schild = UILabel()
            schild.text = text
            schild.font = WebText.schrift(13, .bold)
            schild.textColor = UIColor(hex: 0xE3F654)
            schild.sizeToFit()
            let rahmen = UIView(frame: CGRect(x: 58, y: 10, width: schild.bounds.width + 16, height: schild.bounds.height + 8))
            rahmen.backgroundColor = UIColor(red: 26 / 255, green: 26 / 255, blue: 26 / 255, alpha: 0.92)
            rahmen.layer.cornerRadius = 6
            schild.frame.origin = CGPoint(x: 8, y: 4)
            rahmen.addSubview(schild)
            addSubview(rahmen)
        }
        layer.zPosition = 2500
        isUserInteractionEnabled = false
    }
    required init?(coder: NSCoder) { fatalError() }
}

/// Umstieg auf der Karte (14.11., wie umstiegMarkerElement im Web): schwarzer Kreis 30 mit weissem Rand 2,
/// darin das Lime-Icon des naechsten Abschnitts 17, daneben "U2 ab 06:56" weiss 12 fett. Gleich in Fahrer und Dispo.
final class UmstiegMarkerAnsicht: MLNAnnotationView {
    init(art: String, text: String) {
        super.init(reuseIdentifier: nil)
        frame = CGRect(x: 0, y: 0, width: 30, height: 30)
        clipsToBounds = false
        let kreis = UIView(frame: bounds)
        kreis.backgroundColor = .black
        kreis.layer.cornerRadius = 15
        kreis.layer.borderWidth = 2
        kreis.layer.borderColor = UIColor.white.cgColor
        let bild = UIImageView(image: UIImage(named: ReiseLage.fahrzeugIcon(art)))
        bild.contentMode = .scaleAspectFit
        bild.frame = CGRect(x: 6.5, y: 6.5, width: 17, height: 17)
        kreis.addSubview(bild)
        addSubview(kreis)
        if !text.isEmpty {
            let schild = UILabel()
            schild.text = text
            schild.font = WebText.schrift(12, .bold)
            schild.textColor = .white
            schild.sizeToFit()
            let rahmen = UIView(frame: CGRect(x: 36, y: 4, width: schild.bounds.width + 14, height: schild.bounds.height + 6))
            rahmen.backgroundColor = UIColor(red: 26 / 255, green: 26 / 255, blue: 26 / 255, alpha: 0.92)
            rahmen.layer.cornerRadius = 6
            schild.frame.origin = CGPoint(x: 7, y: 3)
            rahmen.addSubview(schild)
            addSubview(rahmen)
        }
        layer.zPosition = 300
        isUserInteractionEnabled = false
    }
    required init?(coder: NSCoder) { fatalError() }
}
