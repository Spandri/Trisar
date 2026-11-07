import Foundation

/// Eine Regel fuer alle Stellen, an denen Gaeste einer Fahrt angezeigt werden
/// (wie admin/src/shared/gaesteAnzeige.js).
/// Nur anonyme Gaeste: "1 Anonymer Gast" bzw. "N Anonyme Gäste".
/// Namen und anonyme: Namen wie bisher, die anonymen kommen als "+ N" dazu.
/// Weder noch: "Keine Gäste". Der Startort ist nie ein Gastname.
enum GaesteAnzeige {
    /// Alte Eintraege wie "Anonymer Fahrgast 2" in passengers zaehlen als anonym.
    static let altAnonym = #"^anonymer?\s+fahrgast(?:\s+\d+)?$"#
    static let keine = "Keine Gäste"

    private static func istAltAnonym(_ name: String) -> Bool {
        name.range(of: altAnonym, options: [.regularExpression, .caseInsensitive]) != nil
    }

    /// Namen bereinigen und alte Anonym-Eintraege in die Anzahl uebernehmen.
    static func teile(_ namen: [String], anonym: Int) -> (namen: [String], anonym: Int) {
        let roh = namen.map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }
        var gesehen = Set<String>()
        let echte = roh.filter { !istAltAnonym($0) && gesehen.insert($0).inserted }
        return (echte, max(max(0, anonym), roh.filter(istAltAnonym).count))
    }

    static func anonymText(_ anzahl: Int) -> String {
        anzahl == 1 ? "1 Anonymer Gast" : "\(anzahl) Anonyme Gäste"
    }

    /// Ganzer Text in einer Zeile, z. B. fuer Titel.
    static func text(_ namen: [String], anonym: Int, keine: String = keine) -> String {
        let g = teile(namen, anonym: anonym)
        if !g.namen.isEmpty && g.anonym > 0 { return g.namen.joined(separator: ", ") + " + \(g.anonym)" }
        if !g.namen.isEmpty { return g.namen.joined(separator: ", ") }
        if g.anonym > 0 { return anonymText(g.anonym) }
        return keine
    }

    /// Zeilen fuer Gaestelisten: jeder Name eine Zeile, die anonymen als eigene Zeile.
    static func zeilen(_ namen: [String], anonym: Int, keine: String = keine) -> [String] {
        let g = teile(namen, anonym: anonym)
        var z = g.namen
        if g.anonym > 0 { z.append(g.namen.isEmpty ? anonymText(g.anonym) : "+ " + anonymText(g.anonym)) }
        return z.isEmpty ? [keine] : z
    }
}
