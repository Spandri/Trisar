import CoreLocation
import Foundation
import Supabase

/// Icon eines eigenen Orts (Spalte orte.icon) mit den Grafiken aus admin/public/icon.
enum OrtSymbol: String, CaseIterable, Identifiable {
    case pin, haus, flughafen_abflug, flughafen_landung, fahrzeug, stern

    var id: String { rawValue }

    /// Grau fuer Listen und Fahrten.
    var grau: String {
        switch self {
        case .pin: return "Pin_Nav_Trisar_Icons_01_grau"
        case .haus: return "House_Nav_Trisar_01_grau"
        case .flughafen_abflug: return "Plain_Abflug_Trisar_Icons_01_grau"
        case .flughafen_landung: return "Plain_Landen_Trisar_Icons_01_grau"
        case .fahrzeug: return "Vehicle_Nav_Trisar_01_grau"
        case .stern: return "Stern_Trisar_Icon_01_grau"
        }
    }

    /// Lime fuer aktiv oder ausgewaehlt.
    var lime: String {
        switch self {
        case .pin: return "Pin_Nav_Trisar_Icons_01_Lime"
        case .haus: return "House_Nav_Trisar_01_Lime"
        case .flughafen_abflug: return "Plain_Abflug_Trisar_Icons_01_Lime"
        case .flughafen_landung: return "Plain_Landen_Trisar_Icons_01_Lime"
        case .fahrzeug: return "Vehicle_Nav_Trisar_01_Lime"
        case .stern: return "Stern_Trisar_Icon_01_Lime"
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

    // MARK: Schreiben (nur Dispo)

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
