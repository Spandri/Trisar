import AppIntents
import Foundation

/// Siri und Kurzbefehle auf der Uhr: "Nächste Fahrt" liest den gespeicherten Stand vor,
/// "Fahrt annehmen" nimmt die naechste offene Fahrt an (ausgefuehrt vom iPhone).
struct NaechsteFahrtIntent: AppIntent {
    static var title: LocalizedStringResource = "Nächste Fahrt"
    static var description = IntentDescription("Sagt, wann und wo die nächste TRISAR-Fahrt beginnt.")

    @MainActor
    func perform() async throws -> some IntentResult & ProvidesDialog & ReturnsValue<String> {
        let stand = UhrVerbindung.shared.stand
        guard stand.angemeldet else {
            let text = "Öffne TRISAR auf dem iPhone und melde dich an."
            return .result(value: text, dialog: IntentDialog(stringLiteral: text))
        }
        guard let fahrt = stand.naechsteFahrt() else {
            let text = "Keine Fahrt geplant."
            return .result(value: text, dialog: IntentDialog(stringLiteral: text))
        }
        var text = UhrText.tag(fahrt.tag) + " um " + fahrt.zeit
        if let zeit = fahrt.zeitpunkt, Calendar.current.isDateInToday(zeit) {
            text += ", " + UhrStand.abstand(bis: zeit)
        }
        text += ". Abholung: \(fahrt.von). Ziel: \(fahrt.nach)."
        if fahrt.offen { text += " Die Fahrt ist noch nicht angenommen." }
        return .result(value: text, dialog: IntentDialog(stringLiteral: text))
    }
}

struct FahrtAnnehmenIntent: AppIntent {
    static var title: LocalizedStringResource = "Fahrt annehmen"
    static var description = IntentDescription("Nimmt die nächste offene TRISAR-Fahrt an.")

    @MainActor
    func perform() async throws -> some IntentResult & ProvidesDialog {
        let verbindung = UhrVerbindung.shared
        guard let fahrt = verbindung.stand.naechsteOffene() else {
            return .result(dialog: "Keine offene Fahrt.")
        }
        let ok = await verbindung.senden([UhrAktion.art: UhrAktion.fahrt, "id": fahrt.id, "annehmen": true])
        if ok {
            return .result(dialog: IntentDialog(stringLiteral: "Fahrt \(UhrText.tag(fahrt.tag)) um \(fahrt.zeit) angenommen."))
        }
        return .result(dialog: "Das iPhone ist nicht erreichbar. Bitte in der App annehmen.")
    }
}

struct TrisarUhrKurzbefehle: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(intent: NaechsteFahrtIntent(), phrases: [
            "Nächste Fahrt in \(.applicationName)",
            "Wann ist meine nächste Fahrt in \(.applicationName)",
            "\(.applicationName) nächste Fahrt",
        ], shortTitle: "Nächste Fahrt", systemImageName: "car.fill")
        AppShortcut(intent: FahrtAnnehmenIntent(), phrases: [
            "Fahrt annehmen in \(.applicationName)",
            "\(.applicationName) Fahrt annehmen",
        ], shortTitle: "Fahrt annehmen", systemImageName: "checkmark.circle.fill")
    }
}
