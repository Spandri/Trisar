// "Ankuenfte bei mir" (17.11.2026), Spiegel von admin/src/shared/ankunftMelden.js.
// Schalter im Fahrten Filter. Die Dispo bekommt Fahrzeuge zu ihrem Ort gemeldet (Push vom push-dienst),
// die Listen zeigen mit dem Schalter nur Fahrten zu diesem Ort: Ankuenfte = Ziel oder Abholung bei mir,
// Abfahrten = Abholung bei mir. Ort = einmal uebernommener Standort des Geraets oder ein Ort aus orte.
// Gespeichert auf dem Server (dispo_ankunft_melden, je Konto), Restzeiten rechnet der Server
// (rpc ankunft_bei_mir), gleich fuer Web, iOS und Android. Migration 20261117140000_ankunft_bei_mir.
// Stufe 2 (20261117160000): Ort automatisch (gespeicherter Ort, an dem ich bin, sonst mein Standort,
// laufend nachgefuehrt solange die App offen ist) und Melden "sobald unterwegs" (minuten = 0).
// Geladen wird gleich nach der Anmeldung (TrisarDispoApp), damit die Automatik auch ohne Filter laeuft.
import Combine
import CoreLocation
import Foundation
import Supabase
import SwiftUI

/// Eintrag einer Fahrt aus ankunft_bei_mir (job_id -> Restzeit), mit der Liste, aus der er kommt.
struct AnkunftEintrag: Equatable {
    var art: String          // "ziel" oder "abholung"
    var restMin: Int?
    var geschaetzt: Bool
    var angekommen: Bool

    /// Reihenfolge mit Schalter: erst unterwegs nach Restzeit, dann geplante, zuletzt angekommene.
    static func rang(_ e: AnkunftEintrag?) -> Int {
        guard let e else { return 3 }
        if e.angekommen { return 2 }
        return e.restMin == nil ? 1 : 0
    }

    /// Anzeige der Restzeit: "da", "5 min", "ca. 5 min" oder leer.
    var restText: String {
        if angekommen { return AnkunftTexte.da }
        guard let restMin else { return "" }
        return "\(geschaetzt ? "ca. " : "")\(max(1, restMin)) min"
    }
}

/// Ort zur Auswahl (Tabelle orte).
struct AnkunftOrt: Identifiable, Equatable {
    let id: String
    let name: String
    let lat: Double
    let lng: Double
}

/// Texte wie TEXTE.de im Web.
enum AnkunftTexte {
    static let schalter = "Ankünfte bei mir"
    static let ort = "Ort"
    static let melden = "Melden"
    static let vorAnkunft = "vor Ankunft"
    static let meinStandort = "Mein Standort"
    static let automatisch = "Automatisch"
    static let hier = "hier"
    static let sobaldUnterwegs = "sobald unterwegs"
    static let standortLaedt = "Standort wird geholt …"
    static let standortFehlt = "Standort nicht verfügbar. Bitte einen Ort wählen."
    /// Anzeige der Melden-Auswahl (minutenText im Web).
    static func minuten(_ m: Int) -> String { m == 0 ? sobaldUnterwegs : "\(m) min" }
    static let da = "da"
    static let fehler = "Speichern hat nicht geklappt."
    static let holtAb = "holt ab"
}

@MainActor
final class AnkunftMelden: ObservableObject {
    static let geteilt = AnkunftMelden()

    /// 0 = sobald unterwegs
    static let minutenAuswahl = [0, 1, 2, 3, 5, 10, 15, 20, 30, 45, 60]
    static let listeTakt: Duration = .seconds(30)
    /// Automatik schreibt den eigenen Standort erst nach so viel Bewegung neu (ohne Ort).
    static let nachfuehrenM: CLLocationDistance = 100

    /// Ort zum Speichern: gespeicherter Ort (id) oder eigener Standort (id nil, Name leer).
    typealias Ziel = (id: String?, name: String, lat: Double, lng: Double)

    // Zustand wie LEER im Web
    @Published private(set) var geladen = false
    /// Tabelle da (Migration eingespielt), sonst bleibt der Schalter verborgen.
    @Published private(set) var vorhanden = false
    @Published private(set) var an = false
    /// Ort selbst waehlen lassen (gespeicherter Ort, an dem ich bin, sonst mein Standort).
    @Published private(set) var automatisch = true
    @Published private(set) var ortId: String?
    @Published private(set) var ortName = ""
    @Published private(set) var lat: Double?
    @Published private(set) var lng: Double?
    @Published private(set) var umkreisM = 300
    @Published private(set) var minuten = 5
    @Published private(set) var beiAnkunft = true
    @Published private(set) var fehler = false

    /// job_id (klein) -> Eintrag, getrennt nach art.
    @Published private(set) var ziel: [String: AnkunftEintrag] = [:]
    @Published private(set) var abholung: [String: AnkunftEintrag] = [:]
    @Published private(set) var orte: [AnkunftOrt] = []

    private var laedt = false
    private var automatikAbo: AnyCancellable?

    private init() {}

    /// Standort des Geraets einmal holen (wie standortHolen im Web). nil = nicht verfuegbar.
    func standortHolen() async -> CLLocationCoordinate2D? {
        await EigenerStandort.geteilt.einmal()?.coordinate
    }

    /// Nach Abmelden: alles vergessen und die Automatik stoppen, damit das naechste Konto neu laedt.
    func zuruecksetzen() {
        automatikAbo = nil
        EigenerStandort.geteilt.abbestellen("ankunft")
        geladen = false
        vorhanden = false
        an = false
        automatisch = true
        ortId = nil
        ortName = ""
        lat = nil
        lng = nil
        umkreisM = 300
        minuten = 5
        beiAnkunft = true
        fehler = false
        ziel = [:]
        abholung = [:]
        orte = []
    }

    // MARK: Laden

    private struct Zeile: Decodable {
        var an: Bool?
        var automatisch: Bool?
        var ort_id: String?
        var ort_name: String?
        var lat: Double?
        var lng: Double?
        var umkreis_m: Int?
        var minuten: Int?
        var bei_ankunft: Bool?
    }

    private struct OrtZeile: Decodable {
        var id: String
        var name: String?
        var lat: Double?
        var lng: Double?
    }

    private struct ListenZeile: Decodable {
        var job_id: String
        var art: String?
        var rest_min: Int?
        var geschaetzt: Bool?
        var angekommen: Bool?
    }

    private func nutzerId() async -> String? {
        guard let sitzung = try? await Backend.client.auth.session else { return nil }
        return sitzung.user.id.uuidString.lowercased()
    }

    /// Einmal laden (wie ladeVersprechen im Web), danach nur noch Liste und Speichern.
    func laden() async {
        if geladen || laedt { return }
        laedt = true
        defer { laedt = false }
        guard let uid = await nutzerId() else { return }
        async let zeilen: [Zeile] = Backend.client.from("dispo_ankunft_melden").select()
            .eq("user_id", value: uid).limit(1).execute().value
        async let ortListe: [OrtZeile]? = try? Backend.client.from("orte").select("id, name, lat, lng")
            .order("name").execute().value
        let zeile: Result<[Zeile], Error>
        do { zeile = .success(try await zeilen) } catch { zeile = .failure(error) }
        orte = (await ortListe ?? []).compactMap { o in
            guard let lat = o.lat, let lng = o.lng, lat.isFinite, lng.isFinite else { return nil }
            return AnkunftOrt(id: o.id, name: o.name ?? "", lat: lat, lng: lng)
        }
        switch zeile {
        case .failure:
            // Migration fehlt noch: Schalter ausblenden statt Fehler zeigen.
            vorhanden = false
        case .success(let liste):
            vorhanden = true
            if let z = liste.first {
                an = z.an ?? false
                automatisch = z.automatisch ?? true
                ortId = z.ort_id
                ortName = z.ort_name ?? ""
                lat = z.lat
                lng = z.lng
                umkreisM = z.umkreis_m ?? 300
                // 0 heisst "sobald unterwegs", nur ein fehlender Wert wird zu 5.
                minuten = z.minuten ?? 5
                beiAnkunft = z.bei_ankunft ?? true
            }
        }
        geladen = true
        automatikPruefen()
        if an { await listeLaden() }
    }

    // MARK: Speichern

    /// Aenderung sofort uebernehmen und auf dem Server speichern (upsert je Konto).
    /// Klappt das nicht, gilt wieder der alte Stand und der Hinweis zeigt den Fehler.
    func setzen(an neuAn: Bool? = nil, automatisch neuAuto: Bool? = nil, ort: Ziel? = nil, minuten neuMin: Int? = nil) async {
        let vorher = (an, automatisch, ortId, ortName, lat, lng, minuten)
        if let neuAn { an = neuAn }
        if let neuAuto { automatisch = neuAuto }
        if let ort { ortId = ort.id; ortName = ort.name; lat = ort.lat; lng = ort.lng }
        if let neuMin { minuten = neuMin }
        fehler = false
        if !an { ziel = [:]; abholung = [:] }
        guard let uid = await nutzerId() else { return }
        func zahl(_ d: Double?) -> AnyJSON { d.map { .double($0) } ?? .null }
        let zeile: [String: AnyJSON] = [
            "user_id": .string(uid),
            "an": .bool(an),
            "automatisch": .bool(automatisch),
            "ort_id": ortId.map { .string($0) } ?? .null,
            "ort_name": ortName.isEmpty ? .null : .string(ortName),
            "lat": zahl(lat),
            "lng": zahl(lng),
            "umkreis_m": .integer(umkreisM),
            "minuten": .integer(minuten),
            "bei_ankunft": .bool(beiAnkunft),
        ]
        do {
            try await Backend.client.from("dispo_ankunft_melden").upsert(zeile, onConflict: "user_id").execute()
        } catch {
            (an, automatisch, ortId, ortName, lat, lng, minuten) = vorher
            fehler = true
            return
        }
        automatikPruefen()
        if an { await listeLaden() }
    }

    // MARK: Automatik

    /// Ort fuer Automatik: gespeicherter Ort im Umkreis (der naechste), sonst der eigene Standort.
    func automatikZiel(_ pos: CLLocationCoordinate2D) -> Ziel {
        let hier = CLLocation(latitude: pos.latitude, longitude: pos.longitude)
        var bester: (ort: AnkunftOrt, m: CLLocationDistance)?
        for o in orte {
            let m = hier.distance(from: CLLocation(latitude: o.lat, longitude: o.lng))
            if m <= CLLocationDistance(umkreisM), bester == nil || m < bester!.m { bester = (o, m) }
        }
        if let b = bester { return (b.ort.id, b.ort.name, b.ort.lat, b.ort.lng) }
        return (nil, "", pos.latitude, pos.longitude)
    }

    /// Solange Schalter an und Automatik gewaehlt: Standort verfolgen und Ort nachfuehren.
    private func automatikPruefen() {
        let soll = vorhanden && an && automatisch
        if soll && automatikAbo == nil {
            EigenerStandort.geteilt.abonnieren("ankunft")
            automatikAbo = EigenerStandort.geteilt.$position
                .compactMap { $0 }
                .removeDuplicates()
                .sink { [weak self] pos in self?.positionNeu(pos.coordinate) }
        }
        if !soll && automatikAbo != nil {
            automatikAbo = nil
            EigenerStandort.geteilt.abbestellen("ankunft")
        }
    }

    /// Neu speichern nur bei Ortswechsel oder mehr als 100 m Bewegung ohne Ort.
    private func positionNeu(_ pos: CLLocationCoordinate2D) {
        guard an, automatisch else { return }
        let ziel = automatikZiel(pos)
        let gleicherOrt = ziel.id != nil && ziel.id == ortId
        var kaumBewegt = false
        if ziel.id == nil, ortId == nil, let lat, let lng {
            kaumBewegt = CLLocation(latitude: ziel.lat, longitude: ziel.lng)
                .distance(from: CLLocation(latitude: lat, longitude: lng)) < Self.nachfuehrenM
        }
        if gleicherOrt || kaumBewegt { return }
        Task { await ortNachfuehren(ziel) }
    }

    /// Nur die Orts-Felder schreiben und nur, wenn auf dem Server Schalter und Automatik noch an sind.
    /// Sonst wuerde ein Geraet mit altem Stand eine Aenderung von einem anderen Geraet ueberschreiben (17.11.).
    private func ortNachfuehren(_ ziel: Ziel) async {
        guard let uid = await nutzerId() else { return }
        struct Treffer: Decodable { let user_id: String }
        let patch: [String: AnyJSON] = [
            "ort_id": ziel.id.map { .string($0) } ?? .null,
            "ort_name": ziel.name.isEmpty ? .null : .string(ziel.name),
            "lat": .double(ziel.lat),
            "lng": .double(ziel.lng),
        ]
        guard let treffer: [Treffer] = try? await Backend.client.from("dispo_ankunft_melden").update(patch)
            .eq("user_id", value: uid).eq("an", value: true).eq("automatisch", value: true)
            .select("user_id").execute().value else { return }
        if treffer.isEmpty {
            // Woanders aus- oder umgestellt: Stand neu vom Server holen.
            geladen = false
            await laden()
            return
        }
        ortId = ziel.id; ortName = ziel.name; lat = ziel.lat; lng = ziel.lng
        await listeLaden()
    }

    // MARK: Liste

    func listeLaden() async {
        guard an else { return }
        guard let daten: [ListenZeile] = try? await Backend.client.rpc("ankunft_bei_mir").execute().value else { return }
        var neuZiel: [String: AnkunftEintrag] = [:]
        var neuAbholung: [String: AnkunftEintrag] = [:]
        for z in daten {
            let art = z.art == "abholung" ? "abholung" : "ziel"
            let e = AnkunftEintrag(art: art, restMin: z.rest_min, geschaetzt: z.geschaetzt ?? false, angekommen: z.angekommen ?? false)
            if art == "abholung" { neuAbholung[z.job_id.lowercased()] = e } else { neuZiel[z.job_id.lowercased()] = e }
        }
        guard an else { return }
        ziel = neuZiel
        abholung = neuAbholung
    }

    /// Mit Schalter an und Ort gesetzt filtern die Listen auf "Nur zu mir".
    var nurZuMirMoeglich: Bool { vorhanden && an && lat != nil }

    /// Eintrag einer Fahrt. Ankuenfte zaehlen beide Listen, Abfahrten nur die Abholung.
    func eintrag(_ id: String, nurAbholung: Bool) -> AnkunftEintrag? {
        let schluessel = id.lowercased()
        if !nurAbholung, let e = ziel[schluessel] { return e }
        return abholung[schluessel]
    }
}

// MARK: - Plakette an der Fahrtkarte (AnkunftPlakette.jsx)

/// Restzeit an der Fahrtkarte: schwarze Plakette mit Lime-Text ("5 min", "ca. 5 min", "da").
/// Bei Abholung zusaetzlich klein "holt ab", damit klar ist, dass das Fahrzeug zum Abholen kommt.
struct AnkunftPlakette: View {
    let eintrag: AnkunftEintrag
    let textFarbe: Color

    var body: some View {
        let text = eintrag.restText
        if !text.isEmpty {
            VStack(alignment: .trailing, spacing: 2) {
                Text(text)
                    .font(.grotesk(13, .bold)).foregroundStyle(Color(hex: 0xE3F654))
                    .lineLimit(1).fixedSize()
                    .frame(height: 20)
                    .padding(.horizontal, 6).padding(.vertical, 1)
                    .background(Color.black)
                if eintrag.art == "abholung" {
                    Text(AnkunftTexte.holtAb)
                        .font(.grotesk(11, .medium)).foregroundStyle(textFarbe).opacity(0.6)
                        .frame(height: 16)
                }
            }
            .padding(.top, 4)
        }
    }
}
