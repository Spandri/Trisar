import Foundation
import Supabase

/// Anmeldestatus des Fahrers. Gleiches Konto wie in der Web-App (E-Mail + Passwort).
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

    init() {
        beobachter = Task { [weak self] in
            for await (_, sitzung) in Backend.client.auth.authStateChanges {
                guard let self else { return }
                if let sitzung, !sitzung.isExpired {
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

    func anmelden(email: String, passwort: String) async {
        let mail = email.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !mail.isEmpty, !passwort.isEmpty else {
            fehler = "Bitte E-Mail und Passwort eingeben."
            return
        }
        arbeitet = true
        fehler = nil
        defer { arbeitet = false }
        do {
            try await Backend.client.auth.signIn(email: mail, password: passwort)
        } catch {
            fehler = Self.lesbar(error)
        }
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
            return "E-Mail oder Passwort stimmt nicht."
        }
        if text.contains("offline") || text.contains("network") || text.contains("timed out") {
            return "Keine Verbindung. Bitte Internet prüfen."
        }
        return "Anmeldung fehlgeschlagen: \(error.localizedDescription)"
    }
}
