import ActivityKit
import Foundation

/// Daten der Live-Aktivitaet "Naechste Fahrt". Gehoert zur App und zur Widget-Erweiterung.
struct FahrtAktivitaet: ActivityAttributes {
    struct ContentState: Codable, Hashable {
        var zeit: String        // HH:mm
        var status: String      // "Unterwegs", "Beim Gast", "Angenommen"
        var von: String
        var nach: String
        var unterwegs: Bool     // true = Ziel ist als Naechstes dran, sonst die Abholung
    }

    var fahrtID: String
}
