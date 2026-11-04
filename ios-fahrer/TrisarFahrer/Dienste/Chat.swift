import Foundation
import Supabase

/// Kolonnen-Chat wie KolonnenChat.jsx: Nachrichten in `messages` mit target_type 'group'
/// und target_id = convoy_id, live ueber Realtime.
@MainActor
final class KolonnenChat: ObservableObject {
    struct Nachricht: Identifiable, Equatable {
        let id: UUID
        let ich: Bool
        let absender: String
        let text: String
        let zeit: String
    }

    @Published private(set) var nachrichten: [Nachricht] = []
    @Published private(set) var geladen = false

    let chatID: UUID
    private let fahrerID: UUID
    private var kanal: RealtimeChannelV2?
    private var beobachter: Task<Void, Never>?

    init(chatID: UUID, fahrerID: UUID) {
        self.chatID = chatID
        self.fahrerID = fahrerID
    }

    private struct Zeile: Decodable { let id: UUID; let sender_id: UUID?; let content: String?; let created_at: String? }
    private struct Person: Decodable { let id: UUID; let first_name: String?; let last_name: String? }

    func starten() async {
        await laden()
        let kanal = Backend.client.channel("kolonnen-chat-\(chatID.uuidString)")
        let strom = kanal.postgresChange(AnyAction.self, schema: "public", table: "messages",
                                         filter: .eq("target_id", value: chatID.uuidString))
        self.kanal = kanal
        beobachter = Task { [weak self] in
            for await _ in strom { await self?.laden() }
        }
        try? await kanal.subscribeWithError()
    }

    func beenden() async {
        beobachter?.cancel()
        if let kanal { await Backend.client.removeChannel(kanal) }
        kanal = nil
    }

    func laden() async {
        guard let zeilen: [Zeile] = try? await Backend.client.from("messages")
            .select("id,sender_id,content,created_at")
            .eq("target_type", value: "group").eq("target_id", value: chatID)
            .order("created_at", ascending: true).execute().value else { geladen = true; return }
        let andere = Array(Set(zeilen.compactMap(\.sender_id).filter { $0 != fahrerID })).map(\.uuidString)
        var namen: [UUID: String] = [:]
        if !andere.isEmpty, let personen: [Person] = try? await Backend.client.from("profiles")
            .select("id,first_name,last_name").in("id", values: andere).execute().value {
            for p in personen {
                let n = [p.first_name, p.last_name].compactMap { $0 }.joined(separator: " ").trimmingCharacters(in: .whitespaces)
                namen[p.id] = n.isEmpty ? "Kollege" : n
            }
        }
        nachrichten = zeilen.map { z in
            Nachricht(id: z.id, ich: z.sender_id == fahrerID,
                      absender: z.sender_id.flatMap { namen[$0] } ?? "Kollege",
                      text: z.content ?? "",
                      zeit: z.created_at.flatMap(Datum.ausISO).map(Datum.uhrzeit) ?? "")
        }
        geladen = true
        await KolonnenChat.gelesen(chatID: chatID, fahrerID: fahrerID)
    }

    func senden(_ text: String) async {
        let t = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !t.isEmpty else { return }
        // Sofort zeigen, die Datenbank meldet die Nachricht danach ueber Realtime zurueck.
        nachrichten.append(Nachricht(id: UUID(), ich: true, absender: "", text: t, zeit: Datum.uhrzeit(Date())))
        struct Neu: Encodable { let sender_id: UUID; let target_type: String; let target_id: UUID; let content: String }
        try? await Backend.client.from("messages")
            .insert(Neu(sender_id: fahrerID, target_type: "group", target_id: chatID, content: t)).execute()
    }

    // MARK: Gelesen / Ungelesen (markChatRead, refreshUnreadChatState)

    private static func schluessel(_ fahrer: UUID, _ chat: UUID) -> String { "trisar-gelesen-\(fahrer.uuidString)-group-\(chat.uuidString)" }

    static func gelesen(chatID: UUID, fahrerID: UUID) async {
        let jetzt = Datum.iso(Date())
        UserDefaults.standard.set(jetzt, forKey: schluessel(fahrerID, chatID))
        struct Gelesen: Encodable { let user_id: UUID; let chat_type: String; let chat_id: UUID; let last_read_at: String }
        try? await Backend.client.from("chat_reads")
            .upsert(Gelesen(user_id: fahrerID, chat_type: "group", chat_id: chatID, last_read_at: jetzt),
                    onConflict: "user_id,chat_type,chat_id").execute()
    }

    /// Anzahl Nachrichten anderer seit dem letzten Lesen.
    static func ungelesen(chatID: UUID, fahrerID: UUID) async -> Int {
        var abfrage = Backend.client.from("messages").select("id", head: true, count: .exact)
            .eq("target_type", value: "group").eq("target_id", value: chatID).neq("sender_id", value: fahrerID)
        if let zuletzt = UserDefaults.standard.string(forKey: schluessel(fahrerID, chatID)) {
            abfrage = abfrage.gt("created_at", value: zuletzt)
        }
        return (try? await abfrage.execute().count) ?? 0
    }
}
