import Foundation
import Supabase

/// Ein gemeinsamer Supabase-Zugang fuer die ganze App.
/// Die Sitzung speichert supabase-swift selbst im Schluesselbund, sie ueberlebt also App-Neustarts.
enum Backend {
    static let client = SupabaseClient(
        supabaseURL: Konfig.supabaseURL,
        supabaseKey: Konfig.supabaseKey
    )
}

/// Ausschnitt aus `profiles`, den die App braucht.
struct FahrerProfil: Decodable, Equatable {
    let id: UUID
    let firstName: String?
    let lastName: String?
    let trackingMode: String?

    enum CodingKeys: String, CodingKey {
        case id
        case firstName = "first_name"
        case lastName = "last_name"
        case trackingMode = "tracking_mode"
    }

    var name: String {
        [firstName, lastName].compactMap { $0?.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }.joined(separator: " ")
    }

    /// 'obd' = Tracker im Auto sendet, Handy schreibt nichts in die Datenbank.
    var nutztOBD: Bool { trackingMode == "obd" }
}
