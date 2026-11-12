import Foundation
import Supabase
import UIKit

/// Anmeldestatus des Fahrers. Gleiches Konto wie in der Web-App (Benutzername oder E-Mail + Passwort).
@MainActor
final class Anmeldung: ObservableObject {
    enum Zustand: Equatable {
        case pruefe
        case abgemeldet
        case angemeldet(UUID)
    }

    @Published private(set) var zustand: Zustand = .pruefe
    @Published private(set) var profil: FahrerProfil?
    @Published var fehler: String?
    @Published private(set) var arbeitet = false

    private var beobachter: Task<Void, Never>?
    /// Wache: Dispo aendert Passwort oder loescht Konto -> sofort abmelden (konto_abmelden).
    private var wache: [Task<Void, Never>] = []
    private var wacheKanal: RealtimeChannelV2?
    private var wacheFuer: UUID?
    /// Optional: Zugang nur fuer bestimmte Konten (Dispo-App: Rolle dispo/admin/koordinator).
    private let zugang: ((Session) async -> Bool)?
    private let zugangVerweigert: String

    init(zugang: ((Session) async -> Bool)? = nil, zugangVerweigert: String = "") {
        self.zugang = zugang
        self.zugangVerweigert = zugangVerweigert
        beobachter = Task { [weak self] in
            for await (_, sitzung) in Backend.client.auth.authStateChanges {
                guard let self else { return }
                if let sitzung, !sitzung.isExpired {
                    if let zugang = self.zugang, !(await zugang(sitzung)) {
                        try? await Backend.client.auth.signOut(scope: .local)
                        self.fehler = self.zugangVerweigert
                        self.zustand = .abgemeldet
                        continue
                    }
                    self.zustand = .angemeldet(sitzung.user.id)
                    await self.wacheStarten(sitzung.user.id)
                    await self.profilLaden()
                } else if sitzung == nil {
                    self.zustand = .abgemeldet
                    self.profil = nil
                    await self.wacheStoppen()
                }
            }
        }
    }

    deinit { beobachter?.cancel(); wache.forEach { $0.cancel() } }

    // MARK: Zwangsabmeldung

    private func wacheStarten(_ id: UUID) async {
        guard wacheFuer != id else { return }
        await wacheStoppen()
        wacheFuer = id
        let kanal = Backend.client.channel("konto-abmelden-\(id.uuidString)")
        let strom = kanal.postgresChange(AnyAction.self, schema: "public", table: "konto_abmelden",
                                         filter: .eq("user_id", value: id.uuidString.lowercased()))
        wacheKanal = kanal
        wache = [
            Task { [weak self] in
                for await aktion in strom {
                    var grund = "passwort"
                    switch aktion {
                    case let .insert(a): grund = a.record["grund"]?.stringValue ?? grund
                    case let .update(a): grund = a.record["grund"]?.stringValue ?? grund
                    default: continue
                    }
                    await self?.zwangsAbmelden(grund)
                }
            },
            // App wieder vorne: Sitzung beim Server pruefen (Signal kann verpasst worden sein).
            Task { [weak self] in
                for await _ in NotificationCenter.default.notifications(named: UIApplication.willEnterForegroundNotification) {
                    await self?.sitzungPruefen()
                }
            },
        ]
        try? await kanal.subscribeWithError()
        await sitzungPruefen()
    }

    private func wacheStoppen() async {
        wache.forEach { $0.cancel() }
        wache = []
        wacheFuer = nil
        if let k = wacheKanal { await Backend.client.removeChannel(k) }
        wacheKanal = nil
    }

    /// Sitzung beendet (Passwort geaendert) oder Konto weg: abmelden. Netzfehler zaehlen nicht.
    private func sitzungPruefen() async {
        guard fahrerID != nil else { return }
        do {
            _ = try await Backend.client.auth.user()
        } catch let AuthError.api(_, code, _, antwort) {
            if code == .userNotFound { await zwangsAbmelden("geloescht") }
            else if code == .sessionNotFound || [401, 403].contains(antwort.statusCode) { await zwangsAbmelden("passwort") }
        } catch AuthError.sessionMissing {
            await zwangsAbmelden("passwort")
        } catch {}
    }

    private func zwangsAbmelden(_ grund: String) async {
        guard fahrerID != nil else { return }
        // Erst Text und Abmelden, zuletzt die Wache beenden (laeuft evtl. gerade in ihr).
        fehler = grund == "geloescht" ? "Dein Konto wurde gelöscht." : "Dein Passwort wurde geändert. Bitte neu anmelden."
        zustand = .abgemeldet
        profil = nil
        try? await Backend.client.auth.signOut(scope: .local)
        await wacheStoppen()
    }

    var fahrerID: UUID? {
        if case let .angemeldet(id) = zustand { return id }
        return nil
    }

    /// Anmeldung mit Benutzername oder E-Mail. Mit '@' direkt bei Supabase,
    /// sonst ueber die Funktion `anmelden`, die den Benutzernamen auf dem Server aufloest.
    func anmelden(kennung: String, passwort: String) async {
        let eingabe = kennung.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !eingabe.isEmpty, !passwort.isEmpty else {
            fehler = "Bitte Benutzername oder E-Mail und Passwort eingeben."
            return
        }
        arbeitet = true
        fehler = nil
        defer { arbeitet = false }
        do {
            if eingabe.contains("@") {
                try await Backend.client.auth.signIn(email: eingabe, password: passwort)
            } else {
                try await mitBenutzername(eingabe, passwort)
            }
        } catch {
            fehler = Self.lesbar(error)
        }
    }

    private enum AnmeldeFehler: Error, CustomStringConvertible {
        case falsch
        case server(String)
        var description: String {
            switch self {
            case .falsch: return "invalid_credentials"
            case let .server(text): return text
            }
        }
    }

    /// POST an /functions/v1/anmelden, danach Sitzung aus den Tokens setzen.
    private func mitBenutzername(_ name: String, _ passwort: String) async throws {
        struct Antwort: Decodable {
            let access_token: String?
            let refresh_token: String?
            let error: String?
        }
        var anfrage = URLRequest(url: Konfig.supabaseURL.appendingPathComponent("functions/v1/anmelden"))
        anfrage.httpMethod = "POST"
        anfrage.setValue("application/json", forHTTPHeaderField: "Content-Type")
        anfrage.setValue(Konfig.supabaseKey, forHTTPHeaderField: "apikey")
        anfrage.setValue("Bearer \(Konfig.supabaseKey)", forHTTPHeaderField: "Authorization")
        anfrage.httpBody = try JSONSerialization.data(withJSONObject: ["kennung": name, "passwort": passwort])
        let (daten, rueck) = try await URLSession.shared.data(for: anfrage)
        let status = (rueck as? HTTPURLResponse)?.statusCode ?? 0
        let antwort = try? JSONDecoder().decode(Antwort.self, from: daten)
        if antwort?.error == "invalid_credentials" { throw AnmeldeFehler.falsch }
        guard status == 200, let zugang = antwort?.access_token, let erneuern = antwort?.refresh_token else {
            throw AnmeldeFehler.server(antwort?.error ?? "Status \(status)")
        }
        try await Backend.client.auth.setSession(accessToken: zugang, refreshToken: erneuern)
    }

    func abmelden() async {
        // Erst das Geraet fuer Mitteilungen austragen, solange die Sitzung noch gilt.
        await Push.shared.abmelden()
        // Nur dieses Geraet abmelden, sonst fliegt auch die Dispo-Sitzung desselben Kontos raus.
        try? await Backend.client.auth.signOut(scope: .local)
        zustand = .abgemeldet
        profil = nil
    }

    func profilLaden() async {
        guard let id = fahrerID else { return }
        do {
            let zeilen: [FahrerProfil] = try await Backend.client
                .from("profiles")
                .select("id,first_name,last_name,tracking_mode")
                .eq("id", value: id)
                .limit(1)
                .execute()
                .value
            profil = zeilen.first
        } catch {
            // Profil ist nur Anzeige und Ortungsart. Ohne Profil bleibt die Ortung auf Handy.
        }
    }

    private static func lesbar(_ error: Error) -> String {
        let text = String(describing: error).lowercased()
        if text.contains("invalid login") || text.contains("invalid_credentials") {
            return "Benutzername, E-Mail oder Passwort stimmt nicht."
        }
        if text.contains("offline") || text.contains("network") || text.contains("timed out") {
            return "Keine Verbindung. Bitte Internet prüfen."
        }
        return "Anmeldung fehlgeschlagen: \(error.localizedDescription)"
    }
}
