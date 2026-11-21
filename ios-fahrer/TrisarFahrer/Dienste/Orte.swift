import CoreLocation
import Foundation
import Supabase

/// Icon eines eigenen Orts (Spalte orte.icon): die sechs alten und die neuen aus werkzeuge/icons-neu.
/// grau fuer Listen und Fahrten, lime fuer gewaehlt, schwarz auf dem Lime-Kreis der Karte (Figma 2826-12363).
enum OrtSymbol: String, CaseIterable, Identifiable {
    case pin, haus, flughafen_abflug, flughafen_landung, fahrzeug, stern
    case hotel, hotel_fassade, bett, flughafen_tower, flughafen_tower_t1, flughafen_tower_t2, flughafen_tower_t3, flughafen_tower_t4, bahnhof_zug, hauptbahnhof, hauptbahnhof_gebaeude, u_bahn, bus, taxi, auto, shuttle_van, messe_halle, restaurant, bar, kaffee, buero, zuhause, krankenhaus, parkplatz, tankstelle, einkaufen, berge, hafen_schiff, flughafen_terminal, bahnhof_gebaeude, kongress, stadion, museum_bank, rathaus, kirche, burg_schloss, universitaet, fabrik, lager, garage_werkstatt, stadt_hochhaeuser, hochhaus, hochhaus_glas, parkhaus, ladestation, geschaeft, apotheke, sicherheit_polizei, botschaft, festzelt, fernsehturm, bruecke, fitness, kino, biergarten, uhr, kalender, tag_sonne, nacht_mond, regen_schirm, ziel_flagge, route, navigation, lenkrad_fahrer, schluessel, fahrrad, rollkoffer, ticket, vip_krone, musik_band, mikrofon_kongress, international, kreditkarte, dokument, glocke, schloss, info, warnung, check, schliessen, plus

    var id: String { rawValue }

    /// Dateiname und Beschriftung der neuen Icons.
    private static let neu: [OrtSymbol: (datei: String, titel: String)] = [
        .hotel: ("Hotel_Trisar_Icons_01", "Hotel"),
        .hotel_fassade: ("Hotel_Fassade_Trisar_Icons_01", "Hotel Fassade"),
        .bett: ("Bett_Trisar_Icons_01", "Bett"),
        .flughafen_tower: ("Flughafen_Tower_Trisar_Icons_01", "Flughafen Tower"),
        .flughafen_tower_t1: ("Flughafen_Tower_T1_Trisar_Icons_01", "Flughafen Tower T1"),
        .flughafen_tower_t2: ("Flughafen_Tower_T2_Trisar_Icons_01", "Flughafen Tower T2"),
        .flughafen_tower_t3: ("Flughafen_Tower_T3_Trisar_Icons_01", "Flughafen Tower T3"),
        .flughafen_tower_t4: ("Flughafen_Tower_T4_Trisar_Icons_01", "Flughafen Tower T4"),
        .bahnhof_zug: ("Bahnhof_Zug_Trisar_Icons_01", "Bahnhof Zug"),
        .hauptbahnhof: ("Hauptbahnhof_Trisar_Icons_01", "Hauptbahnhof"),
        .hauptbahnhof_gebaeude: ("Hauptbahnhof_Gebaeude_Trisar_Icons_01", "Hauptbahnhof Gebäude"),
        .u_bahn: ("U_Bahn_Trisar_Icons_01", "U-Bahn"),
        .bus: ("Bus_Trisar_Icons_01", "Bus"),
        .taxi: ("Taxi_Trisar_Icons_01", "Taxi"),
        .auto: ("Auto_Trisar_Icons_01", "Auto"),
        .shuttle_van: ("Shuttle_Van_Trisar_Icons_01", "Shuttle Van"),
        .messe_halle: ("Messe_Halle_Trisar_Icons_01", "Messe Halle"),
        .restaurant: ("Restaurant_Trisar_Icons_01", "Restaurant"),
        .bar: ("Bar_Trisar_Icons_01", "Bar"),
        .kaffee: ("Kaffee_Trisar_Icons_01", "Kaffee"),
        .buero: ("Buero_Trisar_Icons_01", "Büro"),
        .zuhause: ("Zuhause_Trisar_Icons_01", "Zuhause"),
        .krankenhaus: ("Krankenhaus_Trisar_Icons_01", "Krankenhaus"),
        .parkplatz: ("Parkplatz_Trisar_Icons_01", "Parkplatz"),
        .tankstelle: ("Tankstelle_Trisar_Icons_01", "Tankstelle"),
        .einkaufen: ("Einkaufen_Trisar_Icons_01", "Einkaufen"),
        .berge: ("Berge_Trisar_Icons_01", "Berge"),
        .hafen_schiff: ("Hafen_Schiff_Trisar_Icons_01", "Hafen Schiff"),
        .flughafen_terminal: ("Flughafen_Terminal_Trisar_Icons_01", "Flughafen Terminal"),
        .bahnhof_gebaeude: ("Bahnhof_Gebaeude_Trisar_Icons_01", "Bahnhof Gebäude"),
        .kongress: ("Kongress_Trisar_Icons_01", "Kongress"),
        .stadion: ("Stadion_Trisar_Icons_01", "Stadion"),
        .museum_bank: ("Museum_Bank_Trisar_Icons_01", "Museum Bank"),
        .rathaus: ("Rathaus_Trisar_Icons_01", "Rathaus"),
        .kirche: ("Kirche_Trisar_Icons_01", "Kirche"),
        .burg_schloss: ("Burg_Schloss_Trisar_Icons_01", "Burg Schloss"),
        .universitaet: ("Universitaet_Trisar_Icons_01", "Universität"),
        .fabrik: ("Fabrik_Trisar_Icons_01", "Fabrik"),
        .lager: ("Lager_Trisar_Icons_01", "Lager"),
        .garage_werkstatt: ("Garage_Werkstatt_Trisar_Icons_01", "Garage Werkstatt"),
        .stadt_hochhaeuser: ("Stadt_Hochhaeuser_Trisar_Icons_01", "Stadt Hochhäuser"),
        .hochhaus: ("Hochhaus_Trisar_Icons_01", "Hochhaus"),
        .hochhaus_glas: ("Hochhaus_Glas_Trisar_Icons_01", "Hochhaus Glas"),
        .parkhaus: ("Parkhaus_Trisar_Icons_01", "Parkhaus"),
        .ladestation: ("Ladestation_Trisar_Icons_01", "Ladestation"),
        .geschaeft: ("Geschaeft_Trisar_Icons_01", "Geschäft"),
        .apotheke: ("Apotheke_Trisar_Icons_01", "Apotheke"),
        .sicherheit_polizei: ("Sicherheit_Polizei_Trisar_Icons_01", "Sicherheit Polizei"),
        .botschaft: ("Botschaft_Trisar_Icons_01", "Botschaft"),
        .festzelt: ("Festzelt_Trisar_Icons_01", "Festzelt"),
        .fernsehturm: ("Fernsehturm_Trisar_Icons_01", "Fernsehturm"),
        .bruecke: ("Bruecke_Trisar_Icons_01", "Brücke"),
        .fitness: ("Fitness_Trisar_Icons_01", "Fitness"),
        .kino: ("Kino_Trisar_Icons_01", "Kino"),
        .biergarten: ("Biergarten_Trisar_Icons_01", "Biergarten"),
        .uhr: ("Uhr_Trisar_Icons_01", "Uhr"),
        .kalender: ("Kalender_Trisar_Icons_01", "Kalender"),
        .tag_sonne: ("Tag_Sonne_Trisar_Icons_01", "Tag Sonne"),
        .nacht_mond: ("Nacht_Mond_Trisar_Icons_01", "Nacht Mond"),
        .regen_schirm: ("Regen_Schirm_Trisar_Icons_01", "Regen Schirm"),
        .ziel_flagge: ("Ziel_Flagge_Trisar_Icons_01", "Ziel Flagge"),
        .route: ("Route_Trisar_Icons_01", "Route"),
        .navigation: ("Navigation_Trisar_Icons_01", "Navigation"),
        .lenkrad_fahrer: ("Lenkrad_Fahrer_Trisar_Icons_01", "Lenkrad Fahrer"),
        .schluessel: ("Schluessel_Trisar_Icons_01", "Schlüssel"),
        .fahrrad: ("Fahrrad_Trisar_Icons_01", "Fahrrad"),
        .rollkoffer: ("Rollkoffer_Trisar_Icons_01", "Rollkoffer"),
        .ticket: ("Ticket_Trisar_Icons_01", "Ticket"),
        .vip_krone: ("Vip_Krone_Trisar_Icons_01", "VIP Krone"),
        .musik_band: ("Musik_Band_Trisar_Icons_01", "Musik Band"),
        .mikrofon_kongress: ("Mikrofon_Kongress_Trisar_Icons_01", "Mikrofon Kongress"),
        .international: ("International_Trisar_Icons_01", "International"),
        .kreditkarte: ("Kreditkarte_Trisar_Icons_01", "Kreditkarte"),
        .dokument: ("Dokument_Trisar_Icons_01", "Dokument"),
        .glocke: ("Glocke_Trisar_Icons_01", "Glocke"),
        .schloss: ("Schloss_Trisar_Icons_01", "Schloss"),
        .info: ("Info_Trisar_Icons_01", "Info"),
        .warnung: ("Warnung_Trisar_Icons_01", "Warnung"),
        .check: ("Check_Trisar_Icons_01", "Check"),
        .schliessen: ("Schliessen_Trisar_Icons_01", "Schließen"),
        .plus: ("Plus_Trisar_Icons_01", "Plus"),
    ]

    var grau: String {
        switch self {
        case .pin: return "Pin_Nav_Trisar_Icons_01_grau"
        case .haus: return "House_Nav_Trisar_01_grau"
        case .flughafen_abflug: return "Plain_Abflug_Trisar_Icons_01_grau"
        case .flughafen_landung: return "Plain_Landen_Trisar_Icons_01_grau"
        case .fahrzeug: return "Vehicle_Nav_Trisar_01_grau"
        case .stern: return "Stern_Trisar_Icon_01_grau"
        default: return (Self.neu[self]?.datei ?? "Pin_Nav_Trisar_Icons_01") + "_grau"
        }
    }

    var lime: String {
        switch self {
        case .pin: return "Pin_Nav_Trisar_Icons_01_Lime"
        case .haus: return "House_Nav_Trisar_01_Lime"
        case .flughafen_abflug: return "Plain_Abflug_Trisar_Icons_01_Lime"
        case .flughafen_landung: return "Plain_Landen_Trisar_Icons_01_Lime"
        case .fahrzeug: return "Vehicle_Nav_Trisar_01_Lime"
        case .stern: return "Stern_Trisar_Icon_01_Lime"
        default: return (Self.neu[self]?.datei ?? "Pin_Nav_Trisar_Icons_01") + "_Lime"
        }
    }

    var schwarz: String {
        switch self {
        case .pin: return "Pin_Nav_Trisar_Icons_01"
        case .haus: return "House_Nav_Trisar_01"
        case .flughafen_abflug: return "Plain_Abflug_Trisar_Icons_01"
        case .flughafen_landung: return "Plain_Landen_Trisar_Icons_01"
        case .fahrzeug: return "vehicle-car-small"
        case .stern: return "Stern_Trisar_Icon_01_schwarz"
        default: return Self.neu[self]?.datei ?? "Pin_Nav_Trisar_Icons_01"
        }
    }

    var titel: String {
        switch self {
        case .pin: return "Pin"
        case .haus: return "Haus"
        case .flughafen_abflug: return "Abflug"
        case .flughafen_landung: return "Landung"
        case .fahrzeug: return "Fahrzeug"
        case .stern: return "Stern"
        default: return Self.neu[self]?.titel ?? rawValue
        }
    }

    init(schluessel: String?) { self = OrtSymbol(rawValue: schluessel ?? "") ?? .pin }
}

/// Zeile aus public.orte (Migration 20261107090000_orte_radien.sql).
struct EigenerOrt: Codable, Identifiable, Equatable {
    var id: UUID
    var name: String
    var adresse: String
    var lat: Double
    var lng: Double
    var radius_rein_m: Int
    var radius_raus_m: Int
    var icon: String

    var symbol: OrtSymbol { OrtSymbol(schluessel: icon) }
    var punkt: CLLocationCoordinate2D { CLLocationCoordinate2D(latitude: lat, longitude: lng) }
    /// "rein 50 m / raus 120 m"
    var radienText: String { "rein \(radius_rein_m) m / raus \(radius_raus_m) m" }
}

/// Standard-Radien fuer alle Adressen ohne eigenen Ort (public.orte_standard, eine Zeile).
struct OrteStandard: Codable, Equatable {
    var radius_rein_m: Int
    var radius_raus_m: Int
}

/// Eigene Orte der Dispo. Lesen duerfen alle Angemeldeten, schreiben nur die Dispo (RLS).
/// Die Statusregel mit den Radien rechnet die Datenbank, die Apps zeigen nur an.
@MainActor
final class OrteSpeicher: ObservableObject {
    static let geteilt = OrteSpeicher()

    @Published private(set) var orte: [EigenerOrt] = []
    @Published private(set) var standard = OrteStandard(radius_rein_m: 50, radius_raus_m: 100)
    /// Tabelle da und gelesen (fehlt die Migration, bleibt alles wie bisher).
    @Published private(set) var geladen = false

    private var laeuft = false
    private var kanal: RealtimeChannelV2?
    private var beobachter: [Task<Void, Never>] = []
    private var zuschauer = 0

    // Grenzen wie die Pruefungen in der Datenbank.
    static let reinBereich = 10...5000
    static let rausBereich = 11...10000

    func ort(_ id: UUID?) -> EigenerOrt? {
        guard let id else { return nil }
        return orte.first { $0.id == id }
    }

    /// Graues Icon des Orts, nil ohne Ort (dann gilt das Textmuster).
    func iconGrau(_ id: UUID?) -> String? { ort(id)?.symbol.grau }

    func ladenFallsNoetig() async {
        if !geladen { await laden() }
    }

    func laden() async {
        guard !laeuft else { return }
        laeuft = true
        defer { laeuft = false }
        do {
            let zeilen: [EigenerOrt] = try await Backend.client.from("orte")
                .select("id, name, adresse, lat, lng, radius_rein_m, radius_raus_m, icon")
                .order("name", ascending: true).execute().value
            orte = zeilen
            geladen = true
        } catch {
            // Tabelle fehlt oder kein Netz: bisherige Liste behalten.
        }
        if let s: [OrteStandard] = try? await Backend.client.from("orte_standard")
            .select("radius_rein_m, radius_raus_m").limit(1).execute().value, let erster = s.first {
            standard = erster
        }
    }

    /// Realtime auf orte und orte_standard, solange eine Ansicht der Dispo zuschaut.
    func beobachten() async {
        zuschauer += 1
        await laden()
        guard kanal == nil else { return }
        let kanal = Backend.client.channel("orte-live")
        let orteStrom = kanal.postgresChange(AnyAction.self, schema: "public", table: "orte")
        let standardStrom = kanal.postgresChange(AnyAction.self, schema: "public", table: "orte_standard")
        self.kanal = kanal
        beobachter = [orteStrom, standardStrom].map { strom in
            Task { [weak self] in for await _ in strom { await self?.laden() } }
        }
        try? await kanal.subscribeWithError()
    }

    func beenden() async {
        zuschauer = max(0, zuschauer - 1)
        guard zuschauer == 0 else { return }
        beobachter.forEach { $0.cancel() }
        beobachter = []
        if let kanal { await Backend.client.removeChannel(kanal) }
        kanal = nil
    }

    // MARK: Vorschlaege beim Fahrt erstellen

    /// Erst Orte, deren Name mit dem Getippten beginnt, dann Wort-Anfang im Namen.
    /// Ohne Gross/klein, schon ab einem Buchstaben.
    func treffer(_ eingabe: String) -> [EigenerOrt] {
        let suche = eingabe.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !suche.isEmpty else { return [] }
        var vorne: [EigenerOrt] = [], wort: [EigenerOrt] = []
        for o in orte {
            let name = o.name.lowercased()
            if name.hasPrefix(suche) {
                vorne.append(o)
            } else if name.split(whereSeparator: { $0 == " " || $0 == "-" || $0 == "/" || $0 == "," })
                        .contains(where: { $0.hasPrefix(suche) }) {
                wort.append(o)
            }
        }
        return vorne + wort
    }

    // MARK: Schreiben (nur Dispo, ios-dispo nutzt diese Datei mit)

    private struct Kennung: Decodable { let id: UUID }

    enum Fehler: LocalizedError {
        case text(String)
        var errorDescription: String? { if case let .text(t) = self { return t }; return nil }
    }

    /// Prueft wie die Datenbank und liefert einen kurzen Hinweis, nil wenn alles passt.
    func pruefen(name: String, rein: Int?, raus: Int?, ohne id: UUID? = nil) -> String? {
        let n = name.trimmingCharacters(in: .whitespacesAndNewlines)
        if n.isEmpty { return "Bitte einen Namen eingeben." }
        if orte.contains(where: { $0.id != id && $0.name.trimmingCharacters(in: .whitespaces).lowercased() == n.lowercased() }) {
            return "Diesen Namen gibt es schon."
        }
        return Self.radienPruefen(rein: rein, raus: raus)
    }

    static func radienPruefen(rein: Int?, raus: Int?) -> String? {
        guard let rein, reinBereich.contains(rein) else { return "Reinfahr-Radius 10 bis 5000 m." }
        guard let raus, rausBereich.contains(raus) else { return "Rausfahr-Radius 11 bis 10000 m." }
        if raus <= rein { return "Der Rausfahr-Radius muss größer sein als der Reinfahr-Radius." }
        return nil
    }

    func speichern(_ ort: EigenerOrt, neu: Bool) async throws {
        let zeile: [String: AnyJSON] = [
            "name": .string(ort.name.trimmingCharacters(in: .whitespacesAndNewlines)),
            "adresse": .string(ort.adresse.trimmingCharacters(in: .whitespacesAndNewlines)),
            "lat": .double(ort.lat),
            "lng": .double(ort.lng),
            "radius_rein_m": .integer(ort.radius_rein_m),
            "radius_raus_m": .integer(ort.radius_raus_m),
            "icon": .string(ort.symbol.rawValue),
        ]
        do {
            if neu {
                try await Backend.client.from("orte").insert(zeile).execute()
            } else {
                let geaendert: [Kennung] = try await Backend.client.from("orte").update(zeile)
                    .eq("id", value: ort.id).select("id").execute().value
                // RLS ohne Treffer meldet keinen Fehler, nur eine leere Antwort.
                if geaendert.isEmpty { throw Fehler.text("Nur die Disposition darf Orte ändern.") }
            }
        } catch let f as Fehler {
            throw f
        } catch {
            throw Self.lesbar(error)
        }
        await laden()
    }

    func loeschen(_ id: UUID) async throws {
        do {
            try await Backend.client.from("orte").delete().eq("id", value: id).execute()
        } catch {
            throw Self.lesbar(error)
        }
        orte.removeAll { $0.id == id }
        await laden()
    }

    func standardSpeichern(rein: Int, raus: Int) async throws {
        do {
            let geaendert: [OrteStandard] = try await Backend.client.from("orte_standard")
                .update(["radius_rein_m": AnyJSON.integer(rein), "radius_raus_m": AnyJSON.integer(raus)])
                .eq("id", value: "true").select("radius_rein_m, radius_raus_m").execute().value
            if geaendert.isEmpty { throw Fehler.text("Nur die Disposition darf Orte ändern.") }
        } catch let f as Fehler {
            throw f
        } catch {
            throw Self.lesbar(error)
        }
        standard = OrteStandard(radius_rein_m: rein, radius_raus_m: raus)
    }

    /// Datenbankfehler in kurze Hinweise uebersetzen.
    private static func lesbar(_ error: Error) -> Error {
        let text = "\(error)"
        if text.contains("orte_name_eindeutig") || text.contains("23505") { return Fehler.text("Diesen Namen gibt es schon.") }
        if text.contains("raus_groesser_rein") { return Fehler.text("Der Rausfahr-Radius muss größer sein als der Reinfahr-Radius.") }
        if text.contains("42501") || text.lowercased().contains("row-level security") {
            return Fehler.text("Nur die Disposition darf Orte ändern.")
        }
        return error
    }
}
