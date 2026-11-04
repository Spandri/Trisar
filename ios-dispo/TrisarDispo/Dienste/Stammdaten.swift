import Foundation
import Supabase
import SwiftUI
import UIKit

// Stammdaten der Dispo (vehicles, guests, eigenes profiles-Profil), Abfragen 1:1 wie in admin/src.
// Zeilen kommen als [String: AnyJSON], weil das Web mit select('*') liest und Spalten
// je nach Datenbankstand fehlen koennen (z. B. note_text, is_vip).

typealias DBZeile = [String: AnyJSON]

extension Dictionary where Key == String, Value == AnyJSON {
    /// Wie `String(row?.x || '').trim()`.
    func text(_ k: String) -> String {
        switch self[k] {
        case let .string(s)?: return s.trimmingCharacters(in: .whitespacesAndNewlines)
        case let .integer(i)?: return String(i)
        case let .double(d)?: return d == d.rounded() ? String(Int(d)) : String(d)
        case let .bool(b)?: return b ? "true" : ""
        default: return ""
        }
    }

    /// Zahl oder nil (Number.parseFloat).
    func zahl(_ k: String) -> Double? {
        switch self[k] {
        case let .integer(i)?: return Double(i)
        case let .double(d)?: return d
        case let .string(s)?: return Double(s.trimmingCharacters(in: .whitespaces).replacingOccurrences(of: ",", with: "."))
        default: return nil
        }
    }

    /// Ganze Zahl oder nil (Number.parseInt).
    func ganz(_ k: String) -> Int? {
        switch self[k] {
        case let .integer(i)?: return i
        case let .double(d)?: return Int(d)
        case let .string(s)?:
            let ziffern = s.trimmingCharacters(in: .whitespaces).prefix { $0.isNumber || $0 == "-" }
            return Int(ziffern)
        default: return nil
        }
    }

    /// toBool aus FahrgastErstellenView: true, 1, '1', 'true'.
    func wahr(_ k: String) -> Bool {
        switch self[k] {
        case let .bool(b)?: return b
        case let .integer(i)?: return i == 1
        case let .double(d)?: return d == 1
        case let .string(s)?: return s == "1" || s == "true"
        default: return false
        }
    }
}

/// Lesbare Fehlermeldung wie `error.message` im Web.
func dbMeldung(_ error: Error) -> String {
    if let p = error as? PostgrestError { return p.message }
    return error.localizedDescription
}

// MARK: - Fahrzeuge

/// toVehicleCardRow aus FahrzeugeView.jsx.
struct StammFahrzeug: Identifiable, Hashable {
    let id: String
    let brandModel: String
    let trim: String
    let vin: String
    let licensePlate: String
    let color: String
    /// seat_count roh (fuer die Suche "5 sitze") und als Zahl.
    let seatCount: Int?
    let fill: Double?
    let range: Double?
    let fuelType: String
    let imageUrl: String

    init(_ z: DBZeile) {
        id = z.text("id")
        brandModel = z.text("brand_model")
        trim = z.text("trim")
        vin = z.text("vin")
        licensePlate = z.text("license_plate")
        color = z.text("color")
        seatCount = z.ganz("seat_count")
        fill = z.zahl("battery_fuel_percent")
        range = z.zahl("range_km")
        fuelType = z.text("fuel_type")
        imageUrl = z.text("image_url")
    }

    var plate: String { licensePlate.isEmpty ? "-" : licensePlate }
    var vinLabel: String { vin.isEmpty ? "-" : vin }

    /// resolveBodyType: Karosserie aus Modell/Variante (keine eigene Spalte).
    var karosserie: String {
        let t = "\(brandModel) \(trim)".lowercased()
        if t.range(of: #"\b(ix|x1|x2|x3|x5|x6|x7|xm)\b"#, options: .regularExpression) != nil || t.contains("ix3") { return "suv" }
        if t.contains("van") || t.contains("tourer") || t.contains("multivan") { return "van" }
        if t.contains("coup") { return "coupe" }
        return "limosine"
    }

    /// vehicleHaystack: alle Felder in einem Suchtext.
    var suchtext: String {
        [plate, vin, brandModel, trim, color, fuelType, seatCount.map { "\($0) sitze" } ?? "", karosserie]
            .joined(separator: " ").lowercased()
    }
}

/// Filter-Zustand wie DEFAULT_FAHRZEUG_FILTERS. Lebt im Web in App.jsx (bleibt beim Seitenwechsel),
/// hier darum ausserhalb der Ansicht.
@MainActor
final class FahrzeugFilterAblage: ObservableObject {
    static let geteilt = FahrzeugFilterAblage()
    @Published var suche = ""
    @Published var limosine = false
    @Published var suv = false
    @Published var van = false
    @Published var coupe = false
    @Published var sortierung = "plate"
    @Published var absteigend = false

    func zuruecksetzen() {
        suche = ""; limosine = false; suv = false; van = false; coupe = false
        sortierung = "plate"; absteigend = false
    }

    /// Filter und Sortierung aus FahrzeugeView.jsx.
    func anwenden(_ alle: [StammFahrzeug]) -> [StammFahrzeug] {
        // ";" trennt mehrere Suchbegriffe (ODER).
        let begriffe = suche.lowercased().split(separator: ";").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
        let formen = [limosine ? "limosine" : nil, suv ? "suv" : nil, van ? "van" : nil, coupe ? "coupe" : nil].compactMap { $0 }
        let gefiltert = alle.filter { v in
            if !begriffe.isEmpty {
                let heu = v.suchtext
                if !begriffe.contains(where: { heu.contains($0) }) { return false }
            }
            if !formen.isEmpty && !formen.contains(v.karosserie) { return false }
            return true
        }
        let faktor: Double = absteigend ? -1 : 1
        let deutsch = Locale(identifier: "de")
        return gefiltert.sorted { a, b in
            switch sortierung {
            case "seats": return Double((a.seatCount ?? 0) - (b.seatCount ?? 0)) * faktor < 0
            // Ohne Wert im Betrieb als niedrigster Stand (kein erfundener Fuellstand).
            case "fill": return ((a.fill ?? -1) - (b.fill ?? -1)) * faktor < 0
            default:
                let wa = sortierung == "model" ? "\(a.brandModel) \(a.trim)".trimmingCharacters(in: .whitespaces).lowercased() : a.plate.lowercased()
                let wb = sortierung == "model" ? "\(b.brandModel) \(b.trim)".trimmingCharacters(in: .whitespaces).lowercased() : b.plate.lowercased()
                let r = wa.compare(wb, locale: deutsch)
                return absteigend ? r == .orderedDescending : r == .orderedAscending
            }
        }
    }
}

/// Fahrzeugliste laden und live halten (vehicles, Realtime auf alle Aenderungen).
@MainActor
final class FahrzeugeDienst: ObservableObject {
    @Published private(set) var fahrzeuge: [StammFahrzeug] = []
    @Published private(set) var laedt = true
    @Published private(set) var fehler = ""
    private var kanal: RealtimeChannelV2?
    private var beobachter: Task<Void, Never>?

    func laden() async {
        laedt = true
        fehler = ""
        do {
            let zeilen: [DBZeile] = try await Backend.client.from("vehicles").select("*")
                .order("brand_model", ascending: true).execute().value
            fahrzeuge = zeilen.map(StammFahrzeug.init)
        } catch {
            fahrzeuge = []
            fehler = dbMeldung(error)
        }
        laedt = false
    }

    func beobachten() async {
        guard kanal == nil else { return }
        let k = Backend.client.channel("admin-vehicles-live-\(Int(Date().timeIntervalSince1970 * 1000))")
        let strom = k.postgresChange(AnyAction.self, schema: "public", table: "vehicles")
        kanal = k
        beobachter = Task { [weak self] in
            for await _ in strom { await self?.laden() }
        }
        try? await k.subscribeWithError()
    }

    func beenden() async {
        beobachter?.cancel()
        beobachter = nil
        if let kanal { await Backend.client.removeChannel(kanal) }
        kanal = nil
    }

    /// saveVehicle aus FahrzeugErstellenView.jsx: Update mit Rueckgabe der Zeile, sonst Insert.
    /// Den Admin-Schluessel-Rueckfall des Webs gibt es in der App nicht.
    static func speichern(_ inhalt: [String: AnyJSON], id: String?) async throws -> DBZeile? {
        if let id {
            let zeilen: [DBZeile] = try await Backend.client.from("vehicles").update(inhalt)
                .eq("id", value: id).select("*").execute().value
            guard let erste = zeilen.first else {
                throw StammFehler("Kein Fahrzeug aktualisiert (ID nicht gefunden oder keine Schreibrechte).")
            }
            return erste
        }
        let zeile: DBZeile = try await Backend.client.from("vehicles").insert(inhalt)
            .select("*").single().execute().value
        return zeile
    }

    /// prepareVehicleImageDataUrl: laengste Seite hoechstens 1000, sonst Originaldatei als Data-URL.
    static func bildDataURL(_ daten: Data) -> String? {
        guard let bild = UIImage(data: daten) else { return nil }
        let seite = max(bild.size.width, bild.size.height)
        let faktor = min(1, 1000 / max(seite, 1))
        if faktor >= 1, let mime = mimeTyp(daten) {
            return "data:\(mime);base64," + daten.base64EncodedString()
        }
        let ziel = CGSize(width: (bild.size.width * faktor).rounded(), height: (bild.size.height * faktor).rounded())
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        let klein = UIGraphicsImageRenderer(size: ziel, format: format).image { _ in bild.draw(in: CGRect(origin: .zero, size: ziel)) }
        guard let png = klein.pngData() else { return nil }
        return "data:image/png;base64," + png.base64EncodedString()
    }

    /// Nur Formate, die jeder Browser zeigt, bleiben unveraendert (HEIC wird neu als PNG geschrieben).
    private static func mimeTyp(_ d: Data) -> String? {
        let b = [UInt8](d.prefix(4))
        if b.starts(with: [0xFF, 0xD8]) { return "image/jpeg" }
        if b.starts(with: [0x89, 0x50, 0x4E, 0x47]) { return "image/png" }
        return nil
    }
}

struct StammFehler: LocalizedError {
    let text: String
    init(_ text: String) { self.text = text }
    var errorDescription: String? { text }
}

/// Bild aus Data-URL oder Internetadresse (Fahrzeugbilder liegen in beiden Formen vor).
struct StammBild: View {
    let quelle: String
    var body: some View {
        if let b = Self.ausDataURL(quelle) {
            Image(uiImage: b).resizable().scaledToFit()
        } else if let url = FahrzeugKarte.bildURL(quelle) {
            AsyncImage(url: url) { phase in
                if let bild = phase.image { bild.resizable().scaledToFit() } else { Color.clear }
            }
        }
    }

    static func ausDataURL(_ text: String) -> UIImage? {
        guard text.hasPrefix("data:"), let komma = text.firstIndex(of: ",") else { return nil }
        guard let daten = Data(base64Encoded: String(text[text.index(after: komma)...])) else { return nil }
        return UIImage(data: daten)
    }
}

// MARK: - Fahrgaeste

/// Zeile aus AlleKunden.jsx (guests).
struct StammFahrgast: Identifiable, Hashable {
    let id: String
    let firstName: String
    let lastName: String
    let name: String
    let email: String
    let phone: String
    let language: String
    let street: String
    let streetNumber: String
    let city: String
    let zip: String
    let notes: String

    init(_ z: DBZeile) {
        id = z.text("id")
        firstName = z.text("first_name")
        lastName = z.text("last_name")
        let n = [firstName, lastName].filter { !$0.isEmpty }.joined(separator: " ")
        name = n.isEmpty ? "Ohne Name" : n
        email = z.text("email")
        phone = z.text("phone")
        language = z.text("language")
        street = z.text("street")
        streetNumber = z.text("street_number")
        city = z.text("city")
        zip = z.text("zip")
        let notiz = z.text("notes")
        notes = notiz.isEmpty ? z.text("note_text") : notiz
    }
}

@MainActor
final class FahrgaesteDienst: ObservableObject {
    @Published private(set) var gaeste: [StammFahrgast] = []
    @Published private(set) var laedt = true
    @Published private(set) var fehler = ""
    private var kanal: RealtimeChannelV2?
    private var beobachter: Task<Void, Never>?

    func laden() async {
        laedt = true
        fehler = ""
        do {
            let zeilen: [DBZeile] = try await Backend.client.from("guests").select("*")
                .order("last_name", ascending: true).execute().value
            gaeste = zeilen.map(StammFahrgast.init)
        } catch {
            gaeste = []
            fehler = "Fahrgäste konnten nicht geladen werden: \(dbMeldung(error))"
        }
        laedt = false
    }

    func beobachten() async {
        guard kanal == nil else { return }
        let k = Backend.client.channel("admin-guests-live-\(Int(Date().timeIntervalSince1970 * 1000))")
        let strom = k.postgresChange(AnyAction.self, schema: "public", table: "guests")
        kanal = k
        beobachter = Task { [weak self] in
            for await _ in strom { await self?.laden() }
        }
        try? await k.subscribeWithError()
    }

    func beenden() async {
        beobachter?.cancel()
        beobachter = nil
        if let kanal { await Backend.client.removeChannel(kanal) }
        kanal = nil
    }

    /// Volle Zeile fuer das Bearbeiten (select * eq id maybeSingle).
    static func einzeln(_ id: String) async -> DBZeile? {
        let zeilen: [DBZeile]? = try? await Backend.client.from("guests").select("*").eq("id", value: id)
            .limit(1).execute().value
        return zeilen?.first
    }

    /// saveWithColumnFallback: fehlt eine Spalte in der Datenbank, wird sie weggelassen und neu versucht.
    /// Rueckgabe: Fehlermeldung oder nil.
    static func speichern(_ inhalt: [String: AnyJSON], id: String?) async -> String? {
        var rest = inhalt
        for _ in 0 ..< 20 {
            do {
                if let id {
                    try await Backend.client.from("guests").update(rest).eq("id", value: id).execute()
                } else {
                    try await Backend.client.from("guests").insert(rest).execute()
                }
                return nil
            } catch {
                let meldung = dbMeldung(error)
                if let spalte = fehlendeSpalte(meldung), rest[spalte] != nil {
                    rest.removeValue(forKey: spalte)
                    continue
                }
                return meldung
            }
        }
        return "Fahrgast konnte nicht gespeichert werden."
    }

    private static func fehlendeSpalte(_ meldung: String) -> String? {
        for muster in [#"Could not find the ['"]?([a-zA-Z0-9_]+)['"]? column"#, #"column ["']?([a-zA-Z0-9_]+)["']?"#] {
            guard let re = try? NSRegularExpression(pattern: muster, options: .caseInsensitive),
                  let m = re.firstMatch(in: meldung, range: NSRange(meldung.startIndex..., in: meldung)),
                  let r = Range(m.range(at: 1), in: meldung) else { continue }
            return String(meldung[r])
        }
        return nil
    }
}

// MARK: - Eigenes Profil der Disposition

/// profileData aus App.jsx (Live-Zweig): Grundwerte, lokal gemerkt, dann aus profiles ergaenzt.
struct KoordinatorProfil: Codable, Equatable {
    var firstName = ""
    var lastName = ""
    var email = ""
    var phone = "+49"
    var street = ""
    var streetNumber = ""
    var city = ""
    var zip = ""
    var language = "Deutsch"
    var avatarUrl = ""

    var name: String { [firstName, lastName].filter { !$0.isEmpty }.joined(separator: " ").trimmingCharacters(in: .whitespaces) }
}

@MainActor
final class KoordinatorProfilDienst: ObservableObject {
    /// Gleicher Schluessel wie das Web (dispo_profil_live_v1).
    private static let ablage = "dispo_profil_live_v1"
    @Published private(set) var profil: KoordinatorProfil

    /// Feld im Profil -> Spalte in profiles (PROFIL_SPALTEN).
    enum Feld: String {
        case firstName = "first_name", lastName = "last_name", email, phone, street, streetNumber = "street_number"
        case city, zip, language, avatarUrl = "avatar_url"
    }

    init() {
        if let d = UserDefaults.standard.data(forKey: Self.ablage), let p = try? JSONDecoder().decode(KoordinatorProfil.self, from: d) {
            profil = p
        } else {
            profil = KoordinatorProfil()
        }
    }

    private struct Zeile: Decodable {
        let first_name, last_name, email, phone, street, street_number, city, zip, language, avatar_url: String?
    }

    /// Live: Name und Kontaktdaten der angemeldeten Disposition aus profiles.
    func laden() async {
        guard let nutzer = Backend.client.auth.currentUser else { return }
        guard let zeilen: [Zeile] = try? await Backend.client.from("profiles")
            .select("first_name, last_name, email, phone, street, street_number, city, zip, language, avatar_url")
            .eq("id", value: nutzer.id).limit(1).execute().value, let d = zeilen.first else { return }
        var p = profil
        func nimm(_ wert: String?, _ alt: String) -> String { (wert ?? "").isEmpty ? alt : wert! }
        p.firstName = nimm(d.first_name, p.firstName)
        p.lastName = nimm(d.last_name, p.lastName)
        p.email = nimm(d.email, nimm(nutzer.email, p.email))
        p.phone = nimm(d.phone, p.phone)
        p.street = nimm(d.street, p.street)
        p.streetNumber = nimm(d.street_number, p.streetNumber)
        p.city = nimm(d.city, p.city)
        p.zip = nimm(d.zip, p.zip)
        p.language = nimm(d.language, p.language)
        p.avatarUrl = nimm(d.avatar_url, p.avatarUrl)
        setzen(p)
    }

    /// onSaveProfile + profilInDbSpeichern: lokal uebernehmen, dann die Spalten in profiles schreiben.
    func speichern(_ aenderung: [Feld: String]) async {
        var p = profil
        for (feld, wert) in aenderung {
            switch feld {
            case .firstName: p.firstName = wert
            case .lastName: p.lastName = wert
            case .email: p.email = wert
            case .phone: p.phone = wert
            case .street: p.street = wert
            case .streetNumber: p.streetNumber = wert
            case .city: p.city = wert
            case .zip: p.zip = wert
            case .language: p.language = wert
            case .avatarUrl: p.avatarUrl = wert
            }
        }
        setzen(p)
        guard !aenderung.isEmpty, let id = Backend.client.auth.currentUser?.id else { return }
        var zeile: [String: AnyJSON] = [:]
        for (feld, wert) in aenderung { zeile[feld.rawValue] = .string(wert) }
        do {
            try await Backend.client.from("profiles").update(zeile).eq("id", value: id).execute()
        } catch {
            print("Profil konnte nicht gespeichert werden:", dbMeldung(error))
        }
    }

    /// Beim Abmelden die gemerkten Daten verwerfen (Web: STARTPROFIL).
    func vergessen() {
        UserDefaults.standard.removeObject(forKey: Self.ablage)
        profil = KoordinatorProfil()
    }

    private func setzen(_ p: KoordinatorProfil) {
        profil = p
        if let d = try? JSONEncoder().encode(p) { UserDefaults.standard.set(d, forKey: Self.ablage) }
    }

    /// prepareAvatarDataUrl: laengste Seite 720, PNG bleibt PNG, sonst JPEG 0.84 (zu gross: 0.76).
    static func profilbildDataURL(_ daten: Data) -> String? {
        guard let bild = UIImage(data: daten) else { return nil }
        let seite = max(bild.size.width, bild.size.height)
        let faktor = min(1, 720 / max(seite, 1))
        let ziel = CGSize(width: max(1, (bild.size.width * faktor).rounded()), height: max(1, (bild.size.height * faktor).rounded()))
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        let klein = UIGraphicsImageRenderer(size: ziel, format: format).image { _ in bild.draw(in: CGRect(origin: .zero, size: ziel)) }
        let istPNG = [UInt8](daten.prefix(4)) == [0x89, 0x50, 0x4E, 0x47]
        let erste = istPNG ? klein.pngData().map { "data:image/png;base64," + $0.base64EncodedString() }
            : klein.jpegData(compressionQuality: 0.84).map { "data:image/jpeg;base64," + $0.base64EncodedString() }
        if let erste, erste.count <= 2_200_000 { return erste }
        return klein.jpegData(compressionQuality: 0.76).map { "data:image/jpeg;base64," + $0.base64EncodedString() }
    }
}
