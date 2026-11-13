import Supabase
import SwiftUI

/// Flaggen an Fahrern, wie admin/src/shared/flaggen.js (Figma Koordinator_Screen_Map 2832:12528):
/// drei Flaggen in Cyan, Pink und Koenigsblau. Die Dispo waehlt Fahrer aus (Karte oder Alle Fahrer)
/// und tippt eine Flagge an. Sie fuellt sich, sobald alle Ausgewaehlten sie tragen, erneut tippen nimmt sie weg.
/// Gespeichert in profiles.flagge (flagge1 bis flagge3), hoechstens eine Flagge je Fahrer.
enum Flaggen {
    struct Eintrag: Identifiable {
        let id: String
        let name: String
        let umriss: String   // Asset: nur Rand
        let voll: String     // Asset: gefuellt
    }

    static let alle: [Eintrag] = [
        Eintrag(id: "flagge1", name: "Flagge 1 (Cyan)", umriss: "Flagge_1", voll: "Flagge_1_Voll"),
        Eintrag(id: "flagge2", name: "Flagge 2 (Pink)", umriss: "Flagge_2", voll: "Flagge_2_Voll"),
        Eintrag(id: "flagge3", name: "Flagge 3 (Königsblau)", umriss: "Flagge_3", voll: "Flagge_3_Voll"),
    ]
    static let kreis = "Flagge_Kreis"

    static func nachID(_ wert: String?) -> Eintrag? {
        let id = (wert ?? "").trimmingCharacters(in: .whitespaces).lowercased()
        return alle.first { $0.id == id }
    }

    static func id(_ wert: String?) -> String? { nachID(wert)?.id }

    /// Gefuellt, wenn jeder Ausgewaehlte diese Flagge hat.
    static func alleHaben(_ ids: [String], _ flaggeVon: (String) -> String?, _ flagge: String) -> Bool {
        !ids.isEmpty && ids.allSatisfy { flaggeVon($0) == flagge }
    }

    /// Setzt (flagge = id) oder entfernt (nil) die Flagge bei den Fahrern. Gibt eine Fehlermeldung oder nil zurueck.
    static func setzen(ids: [String], flagge: String?) async -> String? {
        let liste = Array(Set(ids.map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }))
        guard !liste.isEmpty else { return "Kein Fahrer ausgewählt." }
        struct Aus: Encodable {
            let flagge: String?
            enum CodingKeys: String, CodingKey { case flagge }
            // nil muss als null in die Datenbank, sonst bliebe die Flagge stehen.
            func encode(to encoder: Encoder) throws {
                var c = encoder.container(keyedBy: CodingKeys.self)
                try c.encode(flagge, forKey: .flagge)
            }
        }
        do {
            try await Backend.client.from("profiles").update(Aus(flagge: id(flagge)), returning: .minimal)
                .in("id", values: liste).execute()
            return nil
        } catch {
            return dbMeldung(error)
        }
    }
}

/// Drei Flaggen-Knoepfe (Filter_Map_Icon 35 x 35 mit Flagge 14 x 18). Umriss = noch nicht bei allen
/// Ausgewaehlten, gefuellt = alle tragen diese Flagge.
struct FlaggenKnoepfe: View {
    let ids: [String]
    let flaggeVon: (String) -> String?
    let wahl: (String?) -> Void
    var waagerecht = false
    /// Filtermodus: nur diese Flaggen zeigen, `aktiv` = gewaehlte (gefuellt). Ohne `nur` ist es der Setzen-Modus.
    var nur: [String]? = nil
    var aktiv: Set<String> = []
    var filtern = false
    /// Kreisgroesse, die Flagge waechst mit (35 -> 14 x 18). Karte nimmt 44 zum leichteren Tippen.
    var groesse: CGFloat = 35

    var body: some View {
        if waagerecht {
            HStack(spacing: 8) { knoepfe }
        } else {
            VStack(spacing: groesse > 35 ? 6 : 3) { knoepfe }
        }
    }

    private var knoepfe: some View {
        ForEach(Flaggen.alle.filter { nur == nil || nur!.contains($0.id) }) { f in
            let gefuellt = filtern ? aktiv.contains(f.id) : Flaggen.alleHaben(ids, flaggeVon, f.id)
            Button { wahl(filtern || !gefuellt ? f.id : nil) } label: {
                ZStack {
                    Image(Flaggen.kreis).resizable().frame(width: groesse, height: groesse)
                    Image(gefuellt ? f.voll : f.umriss).resizable().frame(width: groesse * 14 / 35, height: groesse * 18 / 35)
                }
                .frame(width: groesse, height: groesse)
                .contentShape(Circle())
            }
            .buttonStyle(.web)
            .accessibilityLabel(f.name)
            .accessibilityAddTraits(gefuellt ? .isSelected : [])
        }
    }
}

/// Flagge mit duenner schwarzer Umrandung (schwarze Kopie knapp hinter der Flagge), fuer Lasche und Marker.
struct FlaggeMitRand: View {
    let flagge: String
    var breite: CGFloat = 14
    var hoehe: CGFloat = 18

    var body: some View {
        if let f = Flaggen.nachID(flagge) {
            ZStack {
                Image(f.voll).renderingMode(.template).resizable().foregroundStyle(.black)
                    .frame(width: breite + 1.6, height: hoehe + 1.6)
                Image(f.voll).resizable().frame(width: breite, height: hoehe)
            }
            .frame(width: breite + 1.6, height: hoehe + 1.6)
        }
    }
}
