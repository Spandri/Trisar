import Combine
import MapLibre
import ObjectiveC
import UIKit

/// Kartenstil (17.11., wie kartenStil.js im Web): Dunkel (Carto Dark Matter, Standard), Hell (Carto
/// Positron), Farbig (Carto Voyager), Satellit (Esri World Imagery mit Strassennamen). Umschalten im
/// Karten Filter, je Geraet gemerkt. Alle offenen Karten wechseln sofort (anbinden). Satellit braucht
/// den Esri-Schluessel (RPC karten_schluessel, nur Dispo), ohne ihn gibt es den Knopf nicht. Esri
/// erlaubt den Schluessel nur fuer *.trisar.de, deshalb schickt MapLibre diese Adresse als Referer mit.
/// Auf hellen Stilen bekommen die Zeichen einen weissen Rand (rand).
@MainActor
final class KartenStil: ObservableObject {
    enum Art: String, CaseIterable { case dunkel, hell, farbig, satellit }

    static let geteilt = KartenStil()
    static let standard: Art = .dunkel

    private static let schluessel = "trisar.karte.stil"
    private static let carto: [Art: String] = [
        .dunkel: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
        .hell: "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
        .farbig: "https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json",
    ]
    private static let esri = "https://basemapstyles-api.arcgis.com/arcgis/rest/services/styles/v2/styles/arcgis/imagery"

    @Published var art: Art {
        didSet { UserDefaults.standard.set(art.rawValue, forKey: Self.schluessel) }
    }
    @Published private(set) var esriSchluessel: String?
    /// Esri-Stil, korrigiert als Datei (esriStilAblegen). Erst damit gibt es den Satellit.
    @Published private(set) var satellitDatei: URL?
    private var holt = false

    private init() {
        art = Art(rawValue: UserDefaults.standard.string(forKey: Self.schluessel) ?? "") ?? Self.standard
        // Referer fuer alle Kartenanfragen, sonst lehnt Esri den Web-Schluessel ab. Carto stoert das nicht.
        let konfig = MLNNetworkConfiguration.sharedManager.sessionConfiguration ?? URLSessionConfiguration.default
        var kopf = konfig.httpAdditionalHeaders ?? [:]
        kopf["Referer"] = "https://dispo.trisar.de/"
        konfig.httpAdditionalHeaders = kopf
        MLNNetworkConfiguration.sharedManager.sessionConfiguration = konfig
        // Einmal den Kartenspeicher leeren: Er hielt Esris Antworten "Token Required" von vorher fest,
        // MapLibre fragte darum gar nicht neu nach (17.11.).
        let merker = "trisar.karte.esriSpeicherGeleert1"
        if !UserDefaults.standard.bool(forKey: merker) {
            MLNOfflineStorage.shared.clearAmbientCache { fehler in
                if fehler == nil { UserDefaults.standard.set(true, forKey: merker) }
            }
        }
    }

    var satellitMoeglich: Bool { satellitDatei != nil }
    /// Satellit ohne Schluessel faellt auf Dunkel zurueck.
    var wirksam: Art { art == .satellit && satellitDatei == nil ? Self.standard : art }
    var istHell: Bool { wirksam != .dunkel }

    var url: URL {
        if wirksam == .satellit, let datei = satellitDatei { return datei }
        return URL(string: Self.carto[wirksam] ?? Self.carto[.dunkel]!)!
    }

    func schluesselLaden() {
        guard esriSchluessel == nil, !holt else { return }
        holt = true
        Task {
            let wert: String? = try? await Backend.client.rpc("karten_schluessel").execute().value
            holt = false
            if let wert, !wert.isEmpty {
                esriSchluessel = wert
                satellitDatei = await Self.esriStilAblegen(schluessel: wert)
            }
        }
    }

    /// Esri (17.11.): Im Satelliten-Stil haben die Quellen eine Kachel-Liste (tiles, mit Schluessel) UND eine
    /// url auf den ArcGIS-Dienst. Mit url holt MapLibre dort ein Kachelverzeichnis, bekommt aber Esris eigenes
    /// Format ohne Kacheln und laedt nichts. Darum den Stil selbst holen, url entfernen, wo tiles da ist, und
    /// als Datei an MapLibre geben.
    private static func esriStilAblegen(schluessel: String) async -> URL? {
        guard var teile = URLComponents(string: esri) else { return nil }
        teile.queryItems = [URLQueryItem(name: "token", value: schluessel), URLQueryItem(name: "language", value: "de")]
        guard let adresse = teile.url else { return nil }
        var anfrage = URLRequest(url: adresse)
        anfrage.setValue("https://dispo.trisar.de/", forHTTPHeaderField: "Referer")
        guard let (daten, antwort) = try? await URLSession.shared.data(for: anfrage),
              (antwort as? HTTPURLResponse)?.statusCode == 200,
              var stil = (try? JSONSerialization.jsonObject(with: daten)) as? [String: Any],
              var quellen = stil["sources"] as? [String: Any] else { return nil }
        for (name, wert) in quellen {
            guard var q = wert as? [String: Any], let kacheln = q["tiles"] as? [Any], !kacheln.isEmpty else { continue }
            q.removeValue(forKey: "url")
            quellen[name] = q
        }
        stil["sources"] = quellen
        guard let neu = try? JSONSerialization.data(withJSONObject: stil),
              let ordner = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first else { return nil }
        let datei = ordner.appendingPathComponent("esri-satellit.json")
        guard (try? neu.write(to: datei, options: .atomic)) != nil else { return nil }
        return datei
    }

    // MARK: Karten anbinden

    private static var bindungKennung: UInt8 = 0

    /// Haengt die Karte an den Stil: neuer Stil laedt sofort, die Ansichten zeichnen ihre Linien in
    /// didFinishLoading neu. Die Bindung lebt so lange wie die Karte.
    func anbinden(_ karte: MLNMapView) {
        schluesselLaden()
        karte.backgroundColor = istHell ? UIColor(hex: 0xF2F2F2) : UIColor(hex: 0x0E0E0E)
        let bindung = Publishers.CombineLatest($art, $satellitDatei)
            .dropFirst()
            .receive(on: RunLoop.main)
            .sink { [weak karte] _, _ in
                MainActor.assumeIsolated {
                    guard let karte else { return }
                    let neu = KartenStil.geteilt.url
                    karte.backgroundColor = KartenStil.geteilt.istHell ? UIColor(hex: 0xF2F2F2) : UIColor(hex: 0x0E0E0E)
                    if karte.styleURL != neu { karte.styleURL = neu }
                    for a in karte.annotations ?? [] {
                        if let v = karte.view(for: a) { KartenStil.rand(v) }
                    }
                }
            }
        objc_setAssociatedObject(karte, &Self.bindungKennung, bindung, .OBJC_ASSOCIATION_RETAIN_NONATOMIC)
    }

    /// Weisser Rand um ein Zeichen auf hellen Karten, damit Lime und Gelb nicht im Grund verschwinden.
    static func rand(_ v: UIView) {
        let hell = MainActor.assumeIsolated { geteilt.istHell }
        v.layer.shadowColor = UIColor.white.cgColor
        v.layer.shadowOffset = .zero
        v.layer.shadowRadius = 1.5
        v.layer.shadowOpacity = hell ? 1 : 0
    }
}
