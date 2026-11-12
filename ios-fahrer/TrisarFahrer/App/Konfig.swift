import Foundation

/// Feste Werte der App. Gleiche Datenbank wie die Web-App (fahrer.trisar.de).
enum Konfig {
    /// Supabase hinter dem Tunnel, gleicher Weg wie die Web-App (`/supabase`).
    static let supabaseURL = URL(string: "https://fahrer.trisar.de/supabase")!
    /// Oeffentlicher Schluessel (publishable). Zugriff regeln die Zugriffsregeln in der Datenbank.
    static let supabaseKey = "sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH"

    /// Wie oft der Live-Standort geschrieben wird (wie Web-App: 5 s).
    static let liveIntervall: TimeInterval = 5
    /// Wie oft ein Punkt in den Verlauf geht (wie Web-App: 15 s).
    static let verlaufIntervall: TimeInterval = 15
    /// Ortungsart und aktive Fahrt neu laden.
    static let profilIntervall: TimeInterval = 60
    /// Steht das Handy still, kommen keine neuen Punkte (distanceFilter 10 m). Dann den letzten
    /// Standort spaetestens nach dieser Zeit mit aktueller Uhrzeit nochmal senden. Die Dispo-Karte
    /// faerbt das Signal ab 1 min orange und zeigt ab 5 min "kein Signal", "Fahrt ohne Start"
    /// nimmt Standorte bis 15 min. 30 s halten die Anzeige frisch.
    static let stillstandIntervall: TimeInterval = 30

    /// Kennung in `source`, damit man in der Datenbank sieht, woher der Punkt kommt.
    static let quelle = "ios_app"
}
