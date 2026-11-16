import CoreLocation
import Foundation
import Supabase

/// Dienstreise in der Fahrer-App (wie fahrer/src/shared/dienstreise.js).
/// Tabellen dienstreise, dienstreise_fahrer, Funktionen dienstreise_antworten und dienstreise_beenden.
/// Verbindung (Abfahrt, Gleis, Ankunft, Strecke) live ueber DienstreiseVerbindung.
@MainActor
final class DienstreiseSpeicher: ObservableObject {
    static let shared = DienstreiseSpeicher()

    struct Reise: Identifiable, Equatable {
        let id: UUID
        let datum: String
        let startZeit: String
        let startOrtID: UUID?
        let startName: String
        let startAdresse: String?
        let startLat: Double?
        let startLng: Double?
        let zielOrtID: UUID?
        let zielName: String
        let zielAdresse: String?
        let zielLat: Double?
        let zielLng: Double?
        let zugnummer: String?
        let flugnummer: String?
        let notiz: String?
        /// Stand beim Anlegen (Rueckfall, wenn die Live-Abfrage nicht klappt).
        let verbindung: DienstreiseVerbindung?
        let erstellt: String?
        let geaendert: String?
        var status: String
        let beendet: String?
        /// Abschnitte (Umstiege), nach Reihenfolge. Leer bei alten Dienstreisen.
        var abschnitte: [DienstreiseAbschnitt] = []
        let ticketPfad: String?
        let ticketName: String?
        let auftragsnummer: String?
        let reisender: String?

        var mehrere: Bool { abschnitte.count > 1 }
        /// Zeile unter der Startzeit: Nummer, bei Umstiegen "ICE 612 · 3 Umstiege" (Hauptzug = erster Zug/Flug).
        var nummerZeile: String {
            guard mehrere else { return nummer }
            let haupt = abschnitte.first { $0.art == "zug" || $0.art == "flug" } ?? abschnitte[0]
            let n = abschnitte.count - 1
            let text = "\(haupt.nummer) · \(n) \(n == 1 ? "Umstieg" : "Umstiege")"
            return text.hasPrefix(" · ") ? String(text.dropFirst(3)) : text
        }
        /// Erste Kachel: nach Art des ersten Abschnitts, sonst Zug/Flug.
        var ersterIcon: String { abschnitte.first.map { DienstreiseAbschnitt.icon($0.art) } ?? startIcon }

        var offen: Bool { status == "pending" }
        var art: String { DienstreiseVerbindung.art(zugnummer: zugnummer, flugnummer: flugnummer) }
        var flug: Bool { art == "flug" }
        var nummer: String { DienstreiseVerbindung.nummer(zugnummer: zugnummer, flugnummer: flugnummer) }

        var startPunkt: CLLocationCoordinate2D? { Self.punkt(startLat, startLng) }
        var zielPunkt: CLLocationCoordinate2D? { Self.punkt(zielLat, zielLng) }
        private static func punkt(_ lat: Double?, _ lng: Double?) -> CLLocationCoordinate2D? {
            guard let lat, let lng, lat.isFinite, lng.isFinite else { return nil }
            return CLLocationCoordinate2D(latitude: lat, longitude: lng)
        }

        /// Kachel Start: Zug bzw. Flug (startIcon).
        var startIcon: String { flug ? "Plain_Abflug_Trisar_Icons_01_grau" : "Bahnhof_Zug_Trisar_Icons_01_grau" }
        /// Kachel Ziel: eigener Ort mit Icon, sonst nach Name (zielIcon = treffpunktIcon).
        @MainActor func zielIcon(_ orte: OrteSpeicher = .geteilt) -> String {
            DienstTreffpunkt.icon(ortID: zielOrtID, name: zielName, adresse: zielAdresse ?? "", orte: orte)
        }

        /// Sichtbar bis der Fahrer beendet, sonst bis zum Ende des Folgetags.
        var sichtbar: Bool {
            if beendet != nil { return false }
            guard let ende = Stunden.zeitpunkt(datum, "23:59") else { return true }
            return ende.addingTimeInterval(86400) > Date()
        }
    }

    @Published private(set) var liste: [Reise] = []
    @Published var fehler: String?
    /// Eigene Fahrernummer (profiles.driver_number) fuer den Fahrer-Marker am Start der Detailkarte.
    @Published private(set) var fahrerNummer = ""

    private var fahrerID: UUID?
    private var kanal: RealtimeChannelV2?
    private var beobachter: [Task<Void, Never>] = []

    private struct FahrerZeile: Decodable {
        let dienstreise_id: UUID; let status: String?; let beendet: String?
    }
    private struct ReiseZeile: Decodable {
        let id: UUID; let datum: String?; let start_zeit: String?
        let start_ort_id: UUID?; let start_name: String?; let start_adresse: String?; let start_lat: Double?; let start_lng: Double?
        let ziel_ort_id: UUID?; let ziel_name: String?; let ziel_adresse: String?; let ziel_lat: Double?; let ziel_lng: Double?
        let zugnummer: String?; let flugnummer: String?; let notiz: String?
        let verbindung: DienstreiseVerbindung?
        let erstellt: String?; let geaendert: String?
        let ticket_pfad: String?; let ticket_name: String?; let auftragsnummer: String?; let reisender: String?

        enum CodingKeys: String, CodingKey {
            case id, datum, start_zeit, start_ort_id, start_name, start_adresse, start_lat, start_lng
            case ziel_ort_id, ziel_name, ziel_adresse, ziel_lat, ziel_lng, zugnummer, flugnummer, notiz
            case verbindung, erstellt, geaendert, ticket_pfad, ticket_name, auftragsnummer, reisender
        }

        /// Eine kaputte Verbindung (jsonb) soll die Reise nicht verschwinden lassen.
        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            id = try c.decode(UUID.self, forKey: .id)
            func s(_ k: CodingKeys) -> String? { (try? c.decodeIfPresent(String.self, forKey: k)) ?? nil }
            func d(_ k: CodingKeys) -> Double? { (try? c.decodeIfPresent(Double.self, forKey: k)) ?? nil }
            func u(_ k: CodingKeys) -> UUID? { (try? c.decodeIfPresent(UUID.self, forKey: k)) ?? nil }
            datum = s(.datum); start_zeit = s(.start_zeit)
            start_ort_id = u(.start_ort_id); start_name = s(.start_name); start_adresse = s(.start_adresse)
            start_lat = d(.start_lat); start_lng = d(.start_lng)
            ziel_ort_id = u(.ziel_ort_id); ziel_name = s(.ziel_name); ziel_adresse = s(.ziel_adresse)
            ziel_lat = d(.ziel_lat); ziel_lng = d(.ziel_lng)
            zugnummer = s(.zugnummer); flugnummer = s(.flugnummer); notiz = s(.notiz)
            verbindung = (try? c.decodeIfPresent(DienstreiseVerbindung.self, forKey: .verbindung)) ?? nil
            erstellt = s(.erstellt); geaendert = s(.geaendert)
            ticket_pfad = s(.ticket_pfad); ticket_name = s(.ticket_name); auftragsnummer = s(.auftragsnummer); reisender = s(.reisender)
        }
    }

    /// Nach Anmeldung bzw. Abmeldung aufrufen.
    func setzeFahrer(_ id: UUID?) async {
        guard id != fahrerID else { return }
        fahrerID = id
        beobachter.forEach { $0.cancel() }
        beobachter = []
        if let kanal { await Backend.client.removeChannel(kanal) }
        kanal = nil
        liste = []
        guard let id else { return }
        await laden()
        let k = Backend.client.channel("fahrer-dienstreise-\(id.uuidString)")
        let eigene = k.postgresChange(AnyAction.self, schema: "public", table: "dienstreise_fahrer",
                                      filter: .eq("driver_id", value: id.uuidString.lowercased()))
        let reisen = k.postgresChange(UpdateAction.self, schema: "public", table: "dienstreise")
        let abschnitte = k.postgresChange(AnyAction.self, schema: "public", table: "dienstreise_abschnitt")
        kanal = k
        beobachter = [
            Task { [weak self] in for await _ in eigene { await self?.laden() } },
            Task { [weak self] in for await _ in reisen { await self?.laden() } },
            Task { [weak self] in for await _ in abschnitte { await self?.laden() } },
        ]
        try? await k.subscribeWithError()
    }

    /// Eigene Dienstreisen (angefragt oder angenommen, nicht beendet).
    func laden() async {
        guard let id = fahrerID else { return }
        struct Nummer: Decodable { let driver_number: Int? }
        if let n: [Nummer] = try? await Backend.client.from("profiles").select("driver_number")
            .eq("id", value: id.uuidString.lowercased()).limit(1).execute().value {
            fahrerNummer = n.first?.driver_number.map(String.init) ?? ""
        }
        guard let f: [FahrerZeile] = try? await Backend.client.from("dienstreise_fahrer").select()
            .eq("driver_id", value: id.uuidString.lowercased()).in("status", values: ["pending", "accepted"])
            .execute().value else { liste = []; return }
        let ids = f.map { $0.dienstreise_id.uuidString.lowercased() }
        var je: [UUID: ReiseZeile] = [:]
        if !ids.isEmpty, let r: [ReiseZeile] = try? await Backend.client.from("dienstreise").select()
            .in("id", values: ids).execute().value {
            for x in r { je[x.id] = x }
        }
        // Abschnitte (Umstiege). Fehlt die Tabelle (alte Datenbank), bleibt es bei der einen Verbindung.
        var abs: [UUID: [DienstreiseAbschnitt]] = [:]
        if !ids.isEmpty, let a: [DienstreiseAbschnitt] = try? await Backend.client.from("dienstreise_abschnitt").select()
            .in("dienstreise_id", values: ids).order("reihenfolge").execute().value {
            for x in a { abs[x.dienstreise_id, default: []].append(x) }
        }
        liste = f.compactMap { x -> Reise? in
            guard let r = je[x.dienstreise_id], let datum = r.datum, !datum.isEmpty else { return nil }
            return Reise(id: x.dienstreise_id, datum: String(datum.prefix(10)), startZeit: DienstreiseVerbindung.hm(r.start_zeit),
                         startOrtID: r.start_ort_id, startName: r.start_name ?? "", startAdresse: r.start_adresse,
                         startLat: r.start_lat, startLng: r.start_lng,
                         zielOrtID: r.ziel_ort_id, zielName: r.ziel_name ?? "", zielAdresse: r.ziel_adresse,
                         zielLat: r.ziel_lat, zielLng: r.ziel_lng,
                         zugnummer: r.zugnummer, flugnummer: r.flugnummer, notiz: r.notiz, verbindung: r.verbindung,
                         erstellt: r.erstellt, geaendert: r.geaendert,
                         status: (x.status ?? "pending").lowercased(), beendet: x.beendet,
                         abschnitte: (abs[x.dienstreise_id] ?? []).sorted { $0.reihenfolge < $1.reihenfolge },
                         ticketPfad: r.ticket_pfad, ticketName: r.ticket_name,
                         auftragsnummer: r.auftragsnummer, reisender: r.reisender)
        }
        .filter(\.sichtbar)
        .sorted { "\($0.datum)\($0.startZeit)" < "\($1.datum)\($1.startZeit)" }
    }

    func antworten(_ r: Reise, annehmen: Bool) async {
        struct P: Encodable { let p_dienstreise: String; let p_annehmen: Bool }
        do {
            try await Backend.client.rpc("dienstreise_antworten", params: P(p_dienstreise: r.id.uuidString.lowercased(), p_annehmen: annehmen)).execute()
            fehler = nil
        } catch {
            fehler = "Dienstreise konnte nicht gespeichert werden: \(error.localizedDescription)"
        }
        await laden()
    }

    /// Knopf „Dienstreise beenden“. true, wenn gespeichert.
    func beenden(_ r: Reise) async -> Bool {
        struct P: Encodable { let p_dienstreise: String }
        do {
            try await Backend.client.rpc("dienstreise_beenden", params: P(p_dienstreise: r.id.uuidString.lowercased())).execute()
            fehler = nil
        } catch {
            fehler = "Konnte nicht gespeichert werden: \(error.localizedDescription)"
            return false
        }
        await laden()
        return true
    }

    /// Live-Stand der Verbindung (useVerbindung holt alle 2 Minuten neu).
    static func verbindungHolen(_ r: Reise) async -> DienstreiseVerbindung? {
        await DienstreiseVerbindung.holen(datum: r.datum, startZeit: r.startZeit, startName: r.startName, startLat: r.startLat, startLng: r.startLng,
                                          zielName: r.zielName, zielLat: r.zielLat, zielLng: r.zielLng,
                                          zugnummer: r.zugnummer, flugnummer: r.flugnummer)
    }

    /// Live-Stand eines Abschnitts (Zug mit genauem Ausstieg, Flug), nil bei Bus/U-Bahn oder ohne Nummer.
    static func verbindungHolen(_ a: DienstreiseAbschnitt, datum: String) async -> DienstreiseVerbindung? {
        await DienstreiseAbschnitt.holen(a, datum: datum)
    }

    /// Apple-Wallet-Pass vom Server bauen lassen (dispo-admin wallet_pass), Ergebnis: Link oder Meldung.
    static func walletLink(_ reiseID: UUID) async -> (url: URL?, meldung: String) {
        struct A: Decodable { let ok: Bool?; let url: String?; let meldung: String?; let error: String? }
        let standard = "Wallet-Pass konnte nicht erstellt werden."
        do {
            let a: A = try await Backend.client.functions.invoke("dispo-admin", options: FunctionInvokeOptions(
                body: ["aktion": "wallet_pass", "dienstreise_id": reiseID.uuidString.lowercased()]))
            guard a.ok == true, let u = a.url, let url = URL(string: u) else { return (nil, a.meldung ?? a.error ?? standard) }
            return (url, "")
        } catch {
            return (nil, standard)
        }
    }

    /// Eine offene Dienstreise zaehlt als sichtbar (Liste statt „Keine Fahrt“).
    var sichtbar: Bool { !liste.isEmpty }

    // Hoehe in der Fahrtenliste: Karte 187, bei Anfrage darunter Ablehnen/Annehmen (reiseBlockHoehe).
    static let karte: CGFloat = 187
    static func blockHoehe(_ r: Reise) -> CGFloat { r.offen ? karte + 12 + 51 : karte }
}
