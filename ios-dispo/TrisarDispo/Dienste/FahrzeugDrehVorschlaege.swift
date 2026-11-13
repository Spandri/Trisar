import SwiftUI
import UIKit

/// Modelle und Lacke, fuer die die Fahrer-App eine 360-Grad-Ansicht hat (Katalog fahrzeug-dreh.json vom
/// Server, DrehKatalog in FahrzeugDrehung.swift), wie admin/src/shared/fahrzeugDreh.js.
/// Beim Fahrzeug anlegen/bearbeiten als Vorschlaege fuer Marke & Modell und Farbe. Passen brand_model
/// und color, nimmt die Fahrer-App die Bilderreihe.
@MainActor
enum FahrzeugDrehVorschlaege {
    typealias Lack = DrehInfo.Lack
    typealias Modell = DrehInfo.Modell

    static var modelle: [Modell] { DrehKatalog.shared.info?.modelle ?? [] }

    static func glatt(_ s: String) -> String { DrehSatz.glatt(s) }

    /// Modell mit dem laengsten passenden Modellwort (gleiche Regel wie in der Fahrer-App).
    static func modell(zu markeModell: String) -> Modell? {
        DrehKatalog.shared.info?.modell(zu: markeModell)
    }

    /// Lack, zu dem die Farbe gehoert (gleiche Regel wie in der Fahrer-App).
    static func lack(markeModell: String, farbe: String) -> Lack? {
        guard let info = DrehKatalog.shared.info, let m = info.modell(zu: markeModell),
              let code = info.lack(m, farbe: farbe) else { return nil }
        return (m.lackliste ?? []).first { $0.code == code }
    }

    /// Jedes Wort der Eingabe kommt im Namen vor. Leere Eingabe: alle.
    static func modellVorschlaege(_ eingabe: String) -> [String] {
        let woerter = eingabe.split(whereSeparator: \.isWhitespace).map { glatt(String($0)) }.filter { !$0.isEmpty }
        let roh = eingabe.trimmingCharacters(in: .whitespaces)
        return modelle.compactMap(\.name).filter { name in woerter.allSatisfy { glatt(name).contains($0) } && name != roh }
    }

    /// Nur wenn das Modell bekannt ist, dann dessen Lacke.
    static func farbVorschlaege(markeModell: String, eingabe: String) -> [Lack] {
        guard let m = modell(zu: markeModell) else { return [] }
        let e = glatt(eingabe)
        let roh = eingabe.trimmingCharacters(in: .whitespaces)
        return (m.lackliste ?? []).filter { (e.isEmpty || glatt($0.name).contains(e)) && $0.name != roh }
    }

    /// Dateiname des Seitenbilds (Front nach rechts) auf dem Server, wenn Modell und Farbe passen.
    static func seitenName(markeModell: String, farbe: String) -> String? {
        guard let info = DrehKatalog.shared.info, let m = info.modell(zu: markeModell),
              let code = info.lack(m, farbe: farbe) else { return nil }
        return "\(m.id)-\(code)-seite.webp"
    }
}

/// Seitenbild des passenden Lacks fuer Fahrzeugliste und Fahrzeug bearbeiten, vom Server geladen
/// (Cache wie die Drehbilder). Ohne passenden Satz oder wenn das Bild nicht laedt: ersatz
/// (z. B. das hochgeladene Fahrzeugbild). Waehrend des Ladens leer.
struct FahrzeugSeitenBild<Ersatz: View>: View {
    let markeModell: String
    let farbe: String
    /// Grund hinter dem Seitenbild (Liste: weiss statt grauer Bildflaeche).
    var grund: Color? = nil
    @ViewBuilder var ersatz: () -> Ersatz

    @ObservedObject private var katalog = DrehKatalog.shared
    @State private var bild: UIImage?
    @State private var geladenFuer: String?
    @State private var fehlt = false

    var body: some View {
        let name = FahrzeugDrehVorschlaege.seitenName(markeModell: markeModell, farbe: farbe)
        Group {
            if let name {
                if let bild, geladenFuer == name {
                    ZStack {
                        if let grund { grund }
                        Image(uiImage: bild).resizable().scaledToFit()
                    }
                } else if fehlt && geladenFuer == name {
                    ersatz()
                } else {
                    Color.clear
                }
            } else {
                ersatz()
            }
        }
        .task(id: name) {
            guard let name else { return }
            if geladenFuer != name { bild = nil; fehlt = false }
            let b = await DrehBilder.shared.bild(name)
            guard !Task.isCancelled else { return }
            bild = b
            fehlt = b == nil
            geladenFuer = name
        }
    }
}
