import Supabase
import SwiftUI
import UIKit
import UserNotifications

/// Push-Mitteilungen (Fahrer- und Dispo-App). Nach dem Anmelden wird die Erlaubnis
/// abgefragt und das Geraet in push_geraete eingetragen, beim Abmelden ausgetragen.
/// Der Server (push-dienst.js) schickt ueber APNs. Ein Tipp auf eine Mitteilung legt
/// das Ziel in `ziel` ab, die Hauptansicht oeffnet dann Fahrt, Chat oder Fahrzeug.
@MainActor
final class Push: NSObject, ObservableObject, UNUserNotificationCenterDelegate {
    static let shared = Push()

    /// Ziel aus der zuletzt angetippten Mitteilung ("ziel", "job_id", "kolonne_id", ...).
    @Published var ziel: [String: String]?

    private var app = "fahrer"
    private var token: String?
    private var angemeldet = false

    func einrichten(app: String) {
        self.app = app
        UNUserNotificationCenter.current().delegate = self
    }

    /// Nach erfolgreicher Anmeldung: Erlaubnis holen und Geraet registrieren.
    func nachAnmeldung() async {
        angemeldet = true
        let center = UNUserNotificationCenter.current()
        let stand = await center.notificationSettings()
        if stand.authorizationStatus == .notDetermined {
            _ = try? await center.requestAuthorization(options: [.alert, .sound, .badge])
        }
        let neu = await center.notificationSettings()
        guard [.authorized, .provisional, .ephemeral].contains(neu.authorizationStatus) else { return }
        UIApplication.shared.registerForRemoteNotifications()
        if token != nil { await melden() }
    }

    func tokenErhalten(_ daten: Data) {
        token = daten.map { String(format: "%02x", $0) }.joined()
        if angemeldet { Task { await melden() } }
    }

    private func melden() async {
        guard let token else { return }
        struct Parameter: Encodable { let p_token: String; let p_plattform: String; let p_app: String }
        _ = try? await Backend.client.rpc("push_geraet_melden",
                                           params: Parameter(p_token: token, p_plattform: "ios", p_app: app)).execute()
    }

    /// Vor dem Abmelden: Geraet austragen, damit kein anderes Konto Mitteilungen bekommt.
    func abmelden() async {
        angemeldet = false
        guard let token else { return }
        _ = try? await Backend.client.from("push_geraete").delete().eq("token", value: token).execute()
    }

    // MARK: UNUserNotificationCenterDelegate

    /// Auch bei offener App als Banner zeigen.
    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification,
                                            withCompletionHandler fertig: @escaping (UNNotificationPresentationOptions) -> Void) {
        fertig([.banner, .list, .sound])
    }

    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive antwort: UNNotificationResponse,
                                            withCompletionHandler fertig: @escaping () -> Void) {
        var werte: [String: String] = [:]
        for (k, v) in antwort.notification.request.content.userInfo {
            if let k = k as? String, let v = v as? String { werte[k] = v }
        }
        Task { @MainActor in Push.shared.ziel = werte }
        fertig()
    }
}

/// Liefert das Geraete-Token an Push (SwiftUI hat dafuer keinen eigenen Weg).
final class PushAppDelegate: NSObject, UIApplicationDelegate {
    func application(_ application: UIApplication,
                     didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        Task { @MainActor in Push.shared.tokenErhalten(deviceToken) }
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        print("Push: Registrierung fehlgeschlagen: \(error.localizedDescription)")
    }
}

/// Arten, die man abschalten kann (Schluessel wie in push_ausgang.art).
enum PushArten {
    struct Gruppe: Identifiable { let id: String; let titel: String; let arten: [String] }

    static let fahrer: [Gruppe] = [
        Gruppe(id: "fahrten", titel: "Neue, geänderte und stornierte Fahrten",
               arten: ["fahrt_neu", "fahrt_geaendert", "fahrt_storniert", "fahrt_entzogen", "gaeste_geaendert", "fahrt_fahrzeug"]),
        Gruppe(id: "flug", titel: "Flug und Zug (Verspätung, Landung)",
               arten: ["flug_zeit", "flug_gelandet", "flug_annulliert", "flug_umgeleitet", "zug_zeit"]),
        Gruppe(id: "chat", titel: "Kolonnen-Chat", arten: ["chat"]),
        Gruppe(id: "notiz", titel: "Notizen zur Fahrt", arten: ["notiz"]),
        Gruppe(id: "dienst", titel: "Dienstplan", arten: ["dienst_neu", "dienst_geaendert", "dienst_zurueck"]),
        Gruppe(id: "fahrzeug", titel: "Neues Fahrzeug", arten: ["fahrzeug_neu"]),
        Gruppe(id: "erinnerung", titel: "Erinnerungen vor Fahrt und Dienst",
               arten: ["erinnerung_offen", "erinnerung_beginn", "erinnerung_dienst"]),
    ]

    static let dispo: [Gruppe] = [
        Gruppe(id: "antworten", titel: "Fahrer nimmt an oder lehnt ab",
               arten: ["dispo_angenommen", "dispo_abgelehnt"]),
        Gruppe(id: "dienst", titel: "Dienstplan bestätigt oder abgelehnt",
               arten: ["dispo_dienst_angenommen", "dispo_dienst_abgelehnt"]),
        Gruppe(id: "chat", titel: "Kolonnen-Chat", arten: ["chat"]),
        Gruppe(id: "schaden", titel: "Schadensmeldungen", arten: ["dispo_schaden"]),
    ]
}

/// Einstellungen der Mitteilungen in push_einstellungen.aus (abgeschaltete Arten).
@MainActor
final class PushEinstellungen: ObservableObject {
    @Published private(set) var aus: Set<String> = []
    @Published private(set) var systemErlaubt = true

    private struct Zeile: Codable { let user_id: UUID; let aus: [String] }

    func laden(nutzer: UUID) async {
        let stand = await UNUserNotificationCenter.current().notificationSettings()
        systemErlaubt = [.authorized, .provisional, .ephemeral].contains(stand.authorizationStatus)
        let zeilen: [Zeile] = (try? await Backend.client.from("push_einstellungen")
            .select("user_id,aus").eq("user_id", value: nutzer).limit(1).execute().value) ?? []
        aus = Set(zeilen.first?.aus ?? [])
    }

    func an(_ gruppe: PushArten.Gruppe) -> Bool { !gruppe.arten.allSatisfy { aus.contains($0) } }

    func setzen(_ gruppe: PushArten.Gruppe, an: Bool, nutzer: UUID) async {
        if an { aus.subtract(gruppe.arten) } else { aus.formUnion(gruppe.arten) }
        _ = try? await Backend.client.from("push_einstellungen")
            .upsert(Zeile(user_id: nutzer, aus: aus.sorted()), onConflict: "user_id").execute()
    }
}

/// Seite "Mitteilungen": je Gruppe ein Schalter, oben Hinweis, falls iOS sie verbietet.
struct MitteilungenAnsicht: View {
    let nutzer: UUID
    let gruppen: [PushArten.Gruppe]
    var zurueck: () -> Void
    @StateObject private var einstellungen = PushEinstellungen()

    var body: some View {
        Leinwand(basisHoehe: 873) { _ in
            ZStack(alignment: .topLeading) {
                ZurueckKnopf(aktion: zurueck).platz(20, 60, 50, 50)
                Text("Mitteilungen").font(.grotesk(42, .bold)).tracking(-0.5)
                    .foregroundStyle(Color(hex: 0xE3F654))
                    .platz(20, 140)

                VStack(alignment: .leading, spacing: 12) {
                    if !einstellungen.systemErlaubt {
                        Button {
                            if let url = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(url) }
                        } label: {
                            Text("Mitteilungen sind in den iPhone-Einstellungen aus. Hier tippen, um sie zu erlauben.")
                                .font(.grotesk(14, .medium)).foregroundStyle(.black)
                                .multilineTextAlignment(.leading)
                                .padding(16).frame(width: 362, alignment: .leading)
                                .background(Color(hex: 0xE3F654))
                        }
                        .buttonStyle(.web)
                    }
                    ForEach(gruppen) { gruppe in
                        Toggle(isOn: Binding(
                            get: { einstellungen.an(gruppe) },
                            set: { neu in Task { await einstellungen.setzen(gruppe, an: neu, nutzer: nutzer) } }
                        )) {
                            Text(gruppe.titel).font(.grotesk(16, .medium)).foregroundStyle(.white)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        .tint(Color(hex: 0xE3F654))
                        .padding(.horizontal, 16).frame(width: 362, height: 64)
                        .background(Color(hex: 0x1A1A1A))
                    }
                }
                .platz(20, 200, 362, nil)
            }
        }
        .overlay { FussleisteUnten() }
        .task { await einstellungen.laden(nutzer: nutzer) }
    }
}
