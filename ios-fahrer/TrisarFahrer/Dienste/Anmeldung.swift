import Foundation
import Supabase

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
    /// Optional: Zugang nur fuer bestimmte Konten (Dispo-App: Rolle dispo/admin/koordinator).
    private let zugang: ((UUID) async -> Bool)?
    private let zugangVerweigert: String

    init(zugang: ((UUID) async -> Bool)? = nil, zugangVerweigert: String = "") {
        self.zugang = zugang
        self.zugangVerweigert = zugangVerweigert
        beobachter = Task { [weak self] in
            for await (_, sitzung) in Backend.client.auth.authStateChanges {
                guard let self else { return }
                if let sitzung, !sitzung.isExpired {
                    if let zugang = self.zugang, !(await zugang(sitzung.user.id)) {
                        try? await Backend.client.auth.signOut(scope: .local)
                        self.fehler = self.zugangVerweigert
                        self.zustand = .abgemeldet
                        continue
                    }
                    self.zustand = .angemeldet(sitzung.user.id)
                    await self.profilLaden()
                } else if sitzung == nil {
                    self.zustand = .abgemeldet
                    self.profil = nil
                }
            }
        }
    }

    deinit { beobachter?.cancel() }

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
