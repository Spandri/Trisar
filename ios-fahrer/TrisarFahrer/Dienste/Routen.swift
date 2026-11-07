import CoreLocation
import Foundation

/// Adressen und Strecken wie in der Web-App (shared/karte/maplibreKarte.js):
/// Adresse -> Koordinate ueber Nominatim, Strecke ueber den oeffentlichen OSRM-Dienst.
/// Beides wird auf dem Geraet gemerkt, damit nicht jede Ansicht neu anfragt.
enum Routen {
    struct Strecke: Equatable {
        let punkte: [CLLocationCoordinate2D]
        let sekunden: Int
        let meter: Int
        /// Routendienst nicht erreichbar: Luftlinie mit Schaetzung (wie notErgebnis im Web).
        var notloesung = false

        var minuten: Int { Int((Double(sekunden) / 60).rounded(.up)) }

        static func == (a: Strecke, b: Strecke) -> Bool {
            a.sekunden == b.sekunden && a.meter == b.meter && a.punkte.count == b.punkte.count
        }
    }

    private static let osrm = "https://router.project-osrm.org/route/v1/driving/"
    private static let ortSchluessel = "trisar-orte"
    private static let streckenSchluessel = "trisar-routen-v1"
    private static var orteImSpeicher: [String: [Double]] = UserDefaults.standard.dictionary(forKey: ortSchluessel) as? [String: [Double]] ?? [:]
    private static var laufend: [String: Task<CLLocationCoordinate2D?, Never>] = [:]
    /// Erfolglose Suchen nur kurz und nur im Speicher merken, damit nicht jede Ansicht
    /// Nominatim erneut fragt, ein spaeterer Versuch aber wieder durchgeht.
    private static var fehltreffer: [String: Date] = [:]
    private static let fehltrefferDauer: TimeInterval = 10 * 60

    // MARK: Koordinate aus den Daten der Fahrt

    /// Punkt aus einem TomTom-Payload ({"lat": .., "lon": ..}, auch "lng") oder einem eigenen Ort.
    /// Zahlen duerfen als Zahl oder Text kommen. 0/0 gilt als leer.
    static func koordinate(_ wert: Any?) -> CLLocationCoordinate2D? {
        guard let d = wert as? [String: Any] else { return nil }
        func zahl(_ v: Any?) -> Double? {
            if let n = v as? NSNumber { return n.doubleValue }
            if let t = v as? String { return Double(t.trimmingCharacters(in: .whitespaces)) }
            return nil
        }
        guard let lat = zahl(d["lat"]), let lng = zahl(d["lng"]) ?? zahl(d["lon"]),
              lat.isFinite, lng.isFinite, !(lat == 0 && lng == 0),
              abs(lat) <= 90, abs(lng) <= 180 else { return nil }
        return CLLocationCoordinate2D(latitude: lat, longitude: lng)
    }

    /// Spaltenauswahl fuer die Punkte aus den TomTom-Payloads (wie JOBS_SELECT_PUNKTE im Web).
    static let payloadSpalten = "route_von:ext_route_payload->von, route_nach:ext_route_payload->nach, "
        + "anfahrt_nach:ext_driver_to_pickup_payload->nach, zielfahrt_nach:ext_driver_to_dropoff_payload->nach"

    /// Abholort und Ziel aus einer Fahrtzeile in der Reihenfolge von trisar_evaluate_job_status:
    /// TomTom-Payload der Fahrt (von/nach), dann die Anfahrts-Payloads. Der Pin des eigenen
    /// Orts kommt beim Aufrufer davor.
    static func payloadPunkte(_ zeile: [String: Any]) -> (von: CLLocationCoordinate2D?, nach: CLLocationCoordinate2D?) {
        (koordinate(zeile["route_von"]) ?? koordinate(zeile["anfahrt_nach"]),
         koordinate(zeile["route_nach"]) ?? koordinate(zeile["zielfahrt_nach"]))
    }

    /// Ein Payload-Punkt als Decodable fuer typisierte Zeilen.
    struct PayloadPunkt: Decodable, Equatable {
        let lat: Double?
        let lon: Double?
        let lng: Double?

        var punkt: CLLocationCoordinate2D? {
            guard let lat, let lng = lng ?? lon else { return nil }
            return Routen.koordinate(["lat": lat, "lng": lng])
        }
    }

    // MARK: Adresse -> Punkt

    @MainActor
    static func punkt(fuer text: String) async -> CLLocationCoordinate2D? {
        let schluessel = text.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            .replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
        guard !schluessel.isEmpty else { return nil }
        if let gemerkt = orteImSpeicher[schluessel], gemerkt.count == 2 {
            return CLLocationCoordinate2D(latitude: gemerkt[0], longitude: gemerkt[1])
        }
        if let seit = fehltreffer[schluessel], Date().timeIntervalSince(seit) < fehltrefferDauer { return nil }
        if let lauf = laufend[schluessel] { return await lauf.value }
        let lauf = Task<CLLocationCoordinate2D?, Never> {
            if let p = await nominatim(text) { return p }
            // Steht ein Ortsname vorne ("Kongress am Park, Goegginger Str. 10, 86159 Augsburg"),
            // findet die Freitextsuche oft nichts. Dann ohne das erste Stueck.
            let stuecke = text.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
            guard stuecke.count >= 2 else { return nil }
            return await nominatim(stuecke.dropFirst().joined(separator: ", "))
        }
        laufend[schluessel] = lauf
        let ergebnis = await lauf.value
        laufend[schluessel] = nil
        if let ergebnis {
            fehltreffer[schluessel] = nil
            orteImSpeicher[schluessel] = [ergebnis.latitude, ergebnis.longitude]
            UserDefaults.standard.set(orteImSpeicher, forKey: ortSchluessel)
        } else {
            fehltreffer[schluessel] = Date()
        }
        return ergebnis
    }

    private static func nominatim(_ text: String) async -> CLLocationCoordinate2D? {
        var teile = URLComponents(string: "https://nominatim.openstreetmap.org/search")!
        teile.queryItems = [.init(name: "format", value: "json"), .init(name: "limit", value: "1"), .init(name: "q", value: text)]
        var anfrage = URLRequest(url: teile.url!)
        anfrage.setValue("application/json", forHTTPHeaderField: "Accept")
        // Nominatim verlangt eine Kennung der App.
        anfrage.setValue("TRISAR-Fahrer-iOS/0.1", forHTTPHeaderField: "User-Agent")
        struct Treffer: Decodable { let lat: String; let lon: String }
        guard let (daten, _) = try? await URLSession.shared.data(for: anfrage),
              let erster = (try? JSONDecoder().decode([Treffer].self, from: daten))?.first,
              let lat = Double(erster.lat), let lng = Double(erster.lon) else { return nil }
        return CLLocationCoordinate2D(latitude: lat, longitude: lng)
    }

    // MARK: Strecke

    @MainActor
    static func strecke(von: CLLocationCoordinate2D, bis: CLLocationCoordinate2D) async -> Strecke {
        let punkte = "\(von.longitude),\(von.latitude);\(bis.longitude),\(bis.latitude)"
        let adresse = "\(osrm)\(punkte)?overview=full&geometries=geojson&alternatives=false&steps=false"
        var gemerkt = UserDefaults.standard.dictionary(forKey: streckenSchluessel) as? [String: [String: Any]] ?? [:]
        if let eintrag = gemerkt[adresse], let k = eintrag["k"] as? [[Double]], k.count >= 2 {
            return Strecke(punkte: k.map { CLLocationCoordinate2D(latitude: $0[1], longitude: $0[0]) },
                           sekunden: eintrag["s"] as? Int ?? 0, meter: eintrag["m"] as? Int ?? 0)
        }
        struct Antwort: Decodable {
            struct Route: Decodable {
                struct Geometrie: Decodable { let coordinates: [[Double]] }
                let geometry: Geometrie
                let duration: Double
                let distance: Double
            }
            let routes: [Route]
        }
        if let url = URL(string: adresse),
           let (daten, antwort) = try? await URLSession.shared.data(from: url),
           (antwort as? HTTPURLResponse)?.statusCode == 200,
           let route = (try? JSONDecoder().decode(Antwort.self, from: daten))?.routes.first,
           route.geometry.coordinates.count >= 2 {
            let sekunden = Int(route.duration.rounded()), meter = Int(route.distance.rounded())
            gemerkt[adresse] = ["k": route.geometry.coordinates, "s": sekunden, "m": meter]
            if gemerkt.count > 250 { gemerkt.removeValue(forKey: gemerkt.keys.first!) }
            UserDefaults.standard.set(gemerkt, forKey: streckenSchluessel)
            return Strecke(punkte: route.geometry.coordinates.map { CLLocationCoordinate2D(latitude: $0[1], longitude: $0[0]) },
                           sekunden: sekunden, meter: meter)
        }
        // Luftlinie, 45 km/h Schnitt (80 s je km) wie im Web.
        let meter = CLLocation(latitude: von.latitude, longitude: von.longitude)
            .distance(from: CLLocation(latitude: bis.latitude, longitude: bis.longitude))
        return Strecke(punkte: [von, bis], sekunden: Int((meter / 1000) * 80), meter: Int(meter), notloesung: true)
    }

    /// Anfahrt ab Fahrer kuerzen (anfahrtAbFahrer): naechster Punkt auf dem Pfad, Rest ab dort.
    /// Mehr als 200 m daneben = abseits, dann neu rechnen.
    static func abFahrer(_ pfad: [CLLocationCoordinate2D], fahrer: CLLocationCoordinate2D,
                         toleranz: Double = 200) -> (abseits: Bool, pfad: [CLLocationCoordinate2D]?) {
        guard !pfad.isEmpty else { return (false, nil) }
        let ort = CLLocation(latitude: fahrer.latitude, longitude: fahrer.longitude)
        var bester = 0, besterAbstand = Double.infinity
        for (i, p) in pfad.enumerated() {
            let d = ort.distance(from: CLLocation(latitude: p.latitude, longitude: p.longitude))
            if d < besterAbstand { besterAbstand = d; bester = i }
        }
        if besterAbstand > toleranz { return (true, nil) }
        return (false, [fahrer] + pfad.dropFirst(bester + 1))
    }
}
