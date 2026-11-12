import Foundation
import Supabase
import SwiftUI

/// Mehrfachauswahl von Fahrern (Kaestchen oben rechts auf der Karte), wie shared/fahrerMarkierung.js.
/// Einmal markiert, gilt die Auswahl in der ganzen Dispo:
///   Karte          markierte Fahrer normal, alle anderen blass
///   Alle Fahrer    dieselben Fahrer ausgewaehlt
///   Fahrzeuge      die Fahrzeuge dieser Fahrer markiert
///   Fahrten        nur Fahrten dieser Fahrer
///   Fahrt anlegen  diese Fahrer schon eingetragen
///   KI-Assistent   Vermerk ueber der Eingabe, Fragen beziehen sich auf sie
/// Der Stand gilt fuer die Sitzung (sessionStorage im Web), hier solange die App laeuft.
final class FahrerMarkierung: ObservableObject {
    static let geteilt = FahrerMarkierung()

    struct Eintrag: Equatable, Identifiable {
        var id: String
        var name: String
        var vehicleId: String

        init(id: String, name: String = "", vehicleId: String = "") {
            self.id = id.trimmingCharacters(in: .whitespaces)
            self.name = name.trimmingCharacters(in: .whitespaces)
            self.vehicleId = vehicleId.trimmingCharacters(in: .whitespaces)
        }
    }

    @Published private(set) var aktiv = false
    @Published private(set) var fahrer: [Eintrag] = []
    /// Kommt die Auswahl vom Flaggenfilter der Karte, stehen hier die Flaggen (flagge1 bis flagge3).
    @Published private(set) var flaggen: [String] = []

    /// Nur wenn der Modus an ist und jemand markiert ist, wirkt die Auswahl in den anderen Ansichten.
    var wirkt: Bool { aktiv && !fahrer.isEmpty }
    var ids: [String] { fahrer.map(\.id) }
    var namen: [String] { fahrer.map(\.name).filter { !$0.isEmpty } }

    private func setzen(aktiv: Bool, fahrer: [Eintrag], flaggen: [String] = []) {
        var gesehen = Set<String>()
        let liste = fahrer.filter { !$0.id.isEmpty && gesehen.insert($0.id).inserted }
        if self.aktiv != aktiv { self.aktiv = aktiv }
        if self.fahrer != liste { self.fahrer = liste }
        if self.flaggen != flaggen { self.flaggen = flaggen }
    }

    /// Modus aus leert die Auswahl.
    func modusSetzen(_ an: Bool) { setzen(aktiv: an, fahrer: an ? fahrer : []) }

    func umschalten(_ eintrag: Eintrag) {
        guard !eintrag.id.isEmpty else { return }
        let drin = fahrer.contains { $0.id == eintrag.id }
        setzen(aktiv: true, fahrer: drin ? fahrer.filter { $0.id != eintrag.id } : fahrer + [eintrag])
    }

    /// Ganze Liste ersetzen (z. B. Auswahl in Alle Fahrer). Leere Liste laesst den Modus an.
    func ersetzen(_ liste: [Eintrag]) { setzen(aktiv: aktiv || !liste.isEmpty, fahrer: liste) }

    /// Namen und Fahrzeuge nachtragen, sobald eine Ansicht die Fahrerdaten kennt.
    func ergaenzen(_ liste: [Eintrag]) {
        guard !fahrer.isEmpty else { return }
        let nachID = Dictionary(liste.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        let neu = fahrer.map { f -> Eintrag in
            guard let n = nachID[f.id] else { return f }
            return Eintrag(id: f.id, name: n.name.isEmpty ? f.name : n.name, vehicleId: n.vehicleId.isEmpty ? f.vehicleId : n.vehicleId)
        }
        if neu != fahrer { setzen(aktiv: aktiv, fahrer: neu, flaggen: flaggen) }
    }

    /// Flaggen als Auswahl (Flaggenfilter auf der Karte): alle Fahrer mit diesen Flaggen gelten als markiert,
    /// angezeigt werden die Flaggen statt der Namen. Leere Liste hebt sie auf.
    func flaggenSetzen(_ ids: [String], fahrer liste: [Eintrag]) {
        if ids.isEmpty {
            if !flaggen.isEmpty { setzen(aktiv: false, fahrer: []) }
            return
        }
        setzen(aktiv: true, fahrer: liste, flaggen: ids)
    }

    func leeren() { setzen(aktiv: false, fahrer: []) }

    /// Fehlt zu einem markierten Fahrer das Fahrzeug (profiles.vehicle_id), aus der Datenbank nachtragen.
    @MainActor func fahrzeugeNachladen() async {
        let offen = fahrer.filter { $0.vehicleId.isEmpty }.map(\.id)
        guard !offen.isEmpty else { return }
        struct Zeile: Decodable { let id: String; let vehicle_id: String? }
        guard let zeilen: [Zeile] = try? await Backend.client.from("profiles").select("id, vehicle_id")
            .in("id", values: offen).execute().value else { return }
        ergaenzen(zeilen.map { Eintrag(id: $0.id, vehicleId: $0.vehicle_id ?? "") })
    }
}

// MARK: - Dienst senden (Vorschlag des KI-Assistenten bestaetigt)

/// action.vorschlag bei type 'dienst_vorschlag' (dispo-admin/dienst.ts). Fahrer kommen aus der Markierung
/// oder aus Namen im Text. art 'start' | 'ende' | 'dienst', start/ende/pausen optional.
struct DienstVorschlag: Codable, Equatable {
    struct Fahrer: Codable, Equatable { var id: String; var name: String? }
    struct Pause: Codable, Equatable { var von: String; var bis: String }
    var art: String
    var zeit: String?
    var datum: String?
    var start: String?
    var ende: String?
    var pausen: [Pause]?
    var fahrer: [Fahrer]

    /// Ohne start/ende im Vorschlag gilt die Zeit je nach Art (aeltere Server-Antworten).
    var startWert: String? { start ?? (art == "start" ? zeit : nil) }
    var endeWert: String? { ende ?? (art == "ende" ? zeit : nil) }

    /// dienstKnopfText in KiAssistentView.jsx.
    var knopfText: String {
        let s = startWert, e = endeWert, p = pausen ?? []
        if e != nil && s == nil && p.isEmpty { return "Dienstende senden" }
        if s != nil && e == nil && p.isEmpty { return "Dienststart senden" }
        if s == nil && e == nil && !p.isEmpty { return "Pause senden" }
        return "Dienst senden"
    }
}

enum DienstSenden {
    private struct Anfrage: Encodable {
        let art: String
        let zeit: String?
        let datum: String?
        let start: String?
        let ende: String?
        let pausen: [DienstVorschlag.Pause]
        let fahrerIds: [String]

        enum CodingKeys: String, CodingKey { case aktion, art, zeit, datum, start, ende, pausen, fahrerIds }

        // null statt fehlender Schluessel, wie der Body im Web.
        func encode(to encoder: Encoder) throws {
            var c = encoder.container(keyedBy: CodingKeys.self)
            try c.encode("dienst_senden", forKey: .aktion)
            try c.encode(art, forKey: .art)
            try c.encode(zeit, forKey: .zeit)
            try c.encode(datum, forKey: .datum)
            try c.encode(start, forKey: .start)
            try c.encode(ende, forKey: .ende)
            try c.encode(pausen, forKey: .pausen)
            try c.encode(fahrerIds, forKey: .fahrerIds)
        }
    }
    private struct Antwort: Decodable { let ok: Bool?; let anzahl: Int?; let error: String? }
    private struct Fehler: LocalizedError {
        let meldung: String
        var errorDescription: String? { meldung }
    }

    /// dienstSenden in services/kiAssistant.js. Liefert die Zahl der Fahrer.
    /// Der Server kann mit HTTP 200 und { ok: false, error } ablehnen (z. B. Pause ohne Dienst an dem Tag).
    static func senden(_ v: DienstVorschlag) async throws -> Int {
        let anfrage = Anfrage(art: v.art, zeit: v.zeit, datum: v.datum, start: v.startWert, ende: v.endeWert,
                              pausen: v.pausen ?? [], fahrerIds: v.fahrer.map(\.id))
        let antwort: Antwort = try await Backend.client.functions.invoke("dispo-admin", options: FunctionInvokeOptions(body: anfrage))
        guard antwort.ok == true else { throw Fehler(meldung: antwort.error ?? "Senden fehlgeschlagen") }
        return antwort.anzahl ?? v.fahrer.count
    }
}

// MARK: - Vermerk "3 Fahrer markiert" (MarkierungsVermerk.jsx)

/// Wie das Zitat ueber der Eingabe in Claude: dunkles Feld, Haken in Lime, Namen gekuerzt,
/// X hebt die Auswahl auf. Erscheint nur, wenn die Auswahl wirkt.
struct MarkierungsVermerk: View {
    @ObservedObject private var markierung = FahrerMarkierung.geteilt

    var body: some View {
        if markierung.wirkt {
            // Kommt die Auswahl von Flaggen, zeigt der Vermerk die Flaggen statt aller Namen.
            let namen = markierung.flaggen.isEmpty ? markierung.namen.joined(separator: ", ") : ""
            HStack(spacing: 10) {
                Image("Auswahl_Haken_Lime").resizable().frame(width: 16, height: 18)
                (Text("\(markierung.fahrer.count) Fahrer markiert").font(.grotesk(14, .bold)).foregroundColor(.white)
                 + Text(namen.isEmpty ? "" : "  \(namen)").font(.grotesk(14)).foregroundColor(.white.opacity(0.8)))
                    .lineLimit(1)
                    .truncationMode(.tail)
                    .frame(maxWidth: .infinity, alignment: .leading)
                ForEach(markierung.flaggen, id: \.self) { id in FlaggeMitRand(flagge: id) }
                Button { markierung.modusSetzen(false) } label: {
                    Text("×").font(.grotesk(20)).foregroundStyle(.white.opacity(0.7))
                        .frame(width: 32, height: 32)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.web)
                .accessibilityLabel("Auswahl aufheben")
            }
            .padding(.leading, 12).padding(.trailing, 6)
            .frame(height: 44)
            .background(RoundedRectangle(cornerRadius: 12).fill(Color(hex: 0x242525)))
            .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Color(hex: 0x3A3A3A), lineWidth: 1))
        }
    }
}

// MARK: - Erklaertext beim Einschalten (AuswahlErklaerung.jsx)

/// Karte dahinter fast schwarz, Text mittig, fett und normal gemischt (Figma 2832:12528).
/// Verschwindet nach 6 s oder beim Antippen.
struct AuswahlErklaerung: View {
    let fertig: () -> Void

    static let text = "**Mehrere Fahrer auswählen**\nTippe die Fahrer auf der Karte an, die du zusammen bearbeiten willst. Sie bleiben hell, alle anderen werden blass.\n\nDie Auswahl gilt dann überall: in **Alle Fahrer**, bei den **Fahrzeugen**, in den **Fahrten**, bei **Fahrt hinzufügen** und im **KI-Assistenten**.\n\nNochmal auf das **Kästchen** tippen hebt alles auf."

    /// "**fett**" als fetter weisser Text, der Rest normal in Weiss 85 %.
    static func mitFett(_ roh: String) -> Text {
        roh.components(separatedBy: "**").enumerated().reduce(Text("")) { summe, teil in
            teil.offset % 2 == 1
                ? summe + Text(teil.element).font(.grotesk(16, .bold)).foregroundColor(.white)
                : summe + Text(teil.element).font(.grotesk(16)).foregroundColor(.white.opacity(0.85))
        }
    }

    var body: some View {
        Button(action: fertig) {
            ZStack {
                Color.black.opacity(0.8)
                Self.mitFett(Self.text)
                    .tracking(0.5)
                    .lineSpacing(3.6) // Zeilenhoehe 24 bei 16 px
                    .multilineTextAlignment(.center)
                    .frame(width: 287)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.bottom, 107)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .task {
            try? await Task.sleep(for: .seconds(6))
            if !Task.isCancelled { fertig() }
        }
    }
}
