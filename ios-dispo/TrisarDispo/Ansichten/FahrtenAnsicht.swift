import SwiftUI
import UIKit

/// Seiten innerhalb von „Fahrten“ wie die Views ankuenfte/abfahrten/archivAnkuenfte/
/// archivAbfahrten/fahrtenFilter in admin/src/App.jsx.
enum FahrtenSeite: Hashable {
    case ankuenfte, abfahrten, archivAnkuenfte, archivAbfahrten, filter

    var istArchiv: Bool { self == .archivAnkuenfte || self == .archivAbfahrten }
    var istAbfahrten: Bool { self == .abfahrten || self == .archivAbfahrten }
}

/// Einstieg fuer DispoZiel.fahrten. Zeigt AnkuenfteView/AbfahrtenView (mit Archiv-Schalter)
/// und den Fahrten-Filter. `oeffneFahrt` bekommt die Job-ID, sobald es die Bearbeiten-Ansicht gibt.
struct FahrtenAnsicht: View {
    let zeigen: (DispoZiel) -> Void
    var oeffneFahrt: (UUID) -> Void = { _ in }

    @ObservedObject private var speicher = DispoFahrtenSpeicher.gemeinsam
    @State private var seite: FahrtenSeite = .ankuenfte
    /// Fuer „Zurueck“ im Filter (window.history.back im Web).
    @State private var vorFilter: FahrtenSeite = .ankuenfte

    var body: some View {
        ZStack {
            DispoHintergrund().ignoresSafeArea()
            if seite == .filter {
                FahrtenFilterAnsicht(filter: $speicher.filter) { seite = vorFilter }
            } else {
                FahrtenListeDispo(seite: seite, speicher: speicher, wechseln: wechseln, zeigen: zeigen, oeffneFahrt: oeffneFahrt)
                    // Suche wie im Web: bleibt beim Wechsel ins Archiv, neu bei Ankuenfte <-> Abfahrten.
                    .id(seite.istAbfahrten)
                Navileiste(aktiv: .fahrten) { ziel in
                    // onNavigateToFahrten fuehrt im Web immer zu den Ankuenften.
                    if ziel == .fahrten { seite = .ankuenfte } else { zeigen(ziel) }
                }
            }
        }
        .task { speicher.starten() }
        // Board nur in den Live-Listen, alle 60 s neu (useEffect auf view in App.jsx).
        .task(id: "\(seite)|\(speicher.standort)") {
            guard seite == .ankuenfte || seite == .abfahrten else { return }
            while !Task.isCancelled {
                await speicher.boardLaden(abfahrten: seite == .abfahrten)
                try? await Task.sleep(for: .seconds(60))
            }
        }
        .alert("Hinweis", isPresented: Binding(get: { speicher.meldung != nil }, set: { if !$0 { speicher.meldung = nil } })) {
            Button("OK", role: .cancel) { speicher.meldung = nil }
        } message: {
            Text(speicher.meldung ?? "")
        }
    }

    private func wechseln(_ neu: FahrtenSeite) {
        if neu == .filter { vorFilter = seite }
        seite = neu
    }
}

// MARK: - Liste (AnkuenfteView.jsx / AbfahrtenView.jsx)

private let lime = Color(hex: 0xE3F654)

struct FahrtenListeDispo: View {
    let seite: FahrtenSeite
    @ObservedObject var speicher: DispoFahrtenSpeicher
    let wechseln: (FahrtenSeite) -> Void
    let zeigen: (DispoZiel) -> Void
    let oeffneFahrt: (UUID) -> Void

    @State private var suche = ""

    private var archiv: Bool { seite.istArchiv }
    private var abfahrten: Bool { seite.istAbfahrten }
    private var mitStandort: Bool { !W.ortNormal(speicher.standort).isEmpty }

    var body: some View {
        let liste = sichtbareFahrten()
        FlussLeinwand {
            VStack(alignment: .leading, spacing: 0) {
                ZurueckKnopf { zurueck() }.frame(width: 50, height: 50)

                Text(archiv ? "Archiv" : (mitStandort ? "Meine Fahrten" : "Alle Fahrten"))
                    .font(.grotesk(42, .bold)).foregroundStyle(lime)
                    .cssZeile(42, 42)
                    .padding(.top, 30)

                standortFeld.padding(.top, 24)

                if mitStandort {
                    HStack(spacing: 12) {
                        RichtungsKnopf(text: "Ankünfte", aktiv: !abfahrten) {
                            if abfahrten { wechseln(archiv ? .archivAnkuenfte : .ankuenfte) }
                        }
                        RichtungsKnopf(text: "Abfahrten", aktiv: abfahrten) {
                            if !abfahrten { wechseln(archiv ? .archivAbfahrten : .abfahrten) }
                        }
                    }
                    .padding(.top, 12)
                }

                filterZeile.padding(.top, 12)
                suchFeld.padding(.top, 12)

                if !speicher.ladeFehler.isEmpty {
                    Text("Fahrten konnten nicht geladen werden: \(speicher.ladeFehler)")
                        .font(.grotesk(12, .medium)).foregroundStyle(Color(hex: 0xFF8E8E))
                        .cssZeile(12, 12 * 1.35)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(12)
                        .frame(width: 362, alignment: .leading)
                        .background(Color(hex: 0x171717))
                        .overlay(Rectangle().strokeBorder(Color(hex: 0x3A3A3A), lineWidth: 1))
                        .padding(.top, 16)
                }

                if mitStandort {
                    BoardKasten(board: speicher.board, abfahrten: abfahrten) {
                        Task { await speicher.boardLaden(abfahrten: abfahrten) }
                    }
                    .padding(.top, 16)
                }

                VStack(alignment: .leading, spacing: 12) {
                    ForEach(Array(liste.enumerated()), id: \.element.fahrt.id) { i, eintrag in
                        if !abfahrten, let tag = eintrag.neuerTag {
                            TagTrenner(datum: tag, erster: i == 0)
                        }
                        DispoFahrtKarte(
                            fahrt: eintrag.fahrt,
                            zeiten: eintrag.zeiten,
                            datumAlsStatus: !abfahrten && W.passt(eintrag.zeiten.status, #"^\d{2}\.\d{2}$"#),
                            wischen: !mitStandort && !archiv,
                            oeffnen: { if let id = UUID(uuidString: eintrag.fahrt.id) { oeffneFahrt(id) } },
                            erledigt: { Task { await speicher.erledigt(eintrag.fahrt) } },
                            archivieren: { Task { await speicher.archivieren(eintrag.fahrt, ansicht: "ankuenfte") } },
                            duplizieren: { Task { await speicher.duplizieren(eintrag.fahrt) } }
                        )
                    }
                    if liste.isEmpty {
                        Text(archiv ? "Keine archivierten Fahrten gefunden." : "Keine passenden Fahrten gefunden.")
                            .font(.grotesk(16, .medium)).foregroundStyle(lime)
                            .cssZeile(16, 24)
                            .frame(width: 362)
                            .padding(.vertical, 24)
                    }
                }
                .padding(.top, 24)
            }
            .frame(width: 362, alignment: .leading)
            .padding(.leading, 20)
            .padding(.top, 60)
            .padding(.bottom, 175)
        }
    }

    // onBack: Live-Liste -> Startseite, Archiv -> Live-Liste.
    private func zurueck() {
        switch seite {
        case .archivAnkuenfte: wechseln(.ankuenfte)
        case .archivAbfahrten: wechseln(.abfahrten)
        default: zeigen(.start)
        }
    }

    // MARK: Kopfbereich

    private var standortFeld: some View {
        HStack(spacing: 12) {
            Text("Mein Standort").font(.grotesk(16, .medium)).foregroundStyle(lime).opacity(0.7)
            TextField("", text: $speicher.standort,
                      prompt: Text("Ort eingeben").foregroundColor(lime.opacity(0.6)))
                .eingabeStil()
            if !speicher.standort.trimmingCharacters(in: .whitespaces).isEmpty {
                Button { speicher.standort = "" } label: {
                    Image("clear-x-green-24").resizable().frame(width: 24, height: 24)
                }
                .buttonStyle(.web)
                .accessibilityLabel("Standort löschen")
            }
        }
        .padding(.horizontal, 16)
        .frame(width: 362, height: 56)
        .overlay(Rectangle().strokeBorder(lime, lineWidth: 2))
    }

    private var filterZeile: some View {
        HStack(spacing: 12) {
            Button { wechseln(.filter) } label: {
                HStack {
                    Text("Filter").font(.grotesk(16, .medium)).tracking(0.4).foregroundStyle(.black)
                    Spacer(minLength: 0)
                    // _Icon_Schwarz/Filter.svg, eigener Name: kollidiert sonst mit _Icon_Planung/filter.svg.
                    Image("FilterSchwarz").resizable().scaledToFit().frame(width: 34, height: 21)
                }
                .padding(.horizontal, 16)
                .frame(width: mitStandort ? 362 - 12 - 36 : 260, height: 56)
                .background(lime)
                .contentShape(Rectangle())
            }
            .buttonStyle(.web)

            if !mitStandort {
                Button { wechseln(archivUmschalten) } label: {
                    Image("Archiv").resizable().renderingMode(archiv ? .template : .original).scaledToFit()
                        .foregroundStyle(.black)
                        .frame(width: 32, height: 32)
                        .frame(width: 90, height: 56)
                        .background(archiv ? lime : .black)
                        .overlay(Rectangle().strokeBorder(lime, lineWidth: 2))
                        .contentShape(Rectangle())
                }
                .buttonStyle(.web)
                .accessibilityLabel(archiv ? "Live anzeigen" : "Archiv anzeigen")
            } else {
                Button {
                    speicher.neuLaden()
                    Task { await speicher.boardLaden(abfahrten: abfahrten) }
                } label: {
                    Image("Arrow_Nav_Trisar_Icons_01").resizable().frame(width: 36, height: 36)
                }
                .buttonStyle(.web)
                .accessibilityLabel("Fahrten aktualisieren")
            }
        }
    }

    private var archivUmschalten: FahrtenSeite {
        switch seite {
        case .ankuenfte: return .archivAnkuenfte
        case .archivAnkuenfte: return .ankuenfte
        case .abfahrten: return .archivAbfahrten
        default: return .abfahrten
        }
    }

    private var suchFeld: some View {
        let hatSuche = !suche.trimmingCharacters(in: .whitespaces).isEmpty
        return HStack(spacing: 0) {
            TextField("", text: $suche, prompt: Text("Kunden/Fahrer Suchen").foregroundColor(lime.opacity(0.7)))
                .eingabeStil()
            Button { if hatSuche { suche = "" } } label: {
                Image(hatSuche ? "clear-x-green-24" : "vehicle-search").resizable().frame(width: 24, height: 24)
            }
            .buttonStyle(.web)
            .accessibilityLabel(hatSuche ? "Suche leeren" : "Suche")
        }
        .padding(.horizontal, 16)
        .frame(width: 362, height: 56)
        .overlay(Rectangle().strokeBorder(lime, lineWidth: 2))
    }

    // MARK: Filtern, Status, Sortieren (wie in den beiden Web-Ansichten)

    struct Eintrag {
        let fahrt: DispoFahrt
        let zeiten: FahrtZeiten
        let neuerTag: String?
    }

    /// getRideTargetTime
    private func zielZeit(_ f: DispoFahrt) -> String {
        let z = f.zeiten
        if abfahrten {
            return (f.verspaetet ? W.erste(z.neu, z.zeit, z.original) : W.erste(z.zeit, z.neu, z.original)) ?? ""
        }
        if f.aktuellerStatus == "unterwegs" {
            return W.erste(z.ankunftZeit, z.ankunftNeu, z.neu, z.zeit, z.original) ?? ""
        }
        if !mitStandort {
            return (f.verspaetet ? W.erste(z.neu, z.zeit, z.original, z.ankunftNeu, z.ankunftZeit)
                                 : W.erste(z.zeit, z.neu, z.original, z.ankunftZeit, z.ankunftNeu)) ?? ""
        }
        return (f.verspaetet ? W.erste(z.ankunftNeu, z.ankunftZeit, z.neu, z.zeit, z.original)
                             : W.erste(z.ankunftZeit, z.ankunftNeu, z.zeit, z.neu, z.original)) ?? ""
    }

    private func jetztMinuten() -> Int {
        let k = Calendar.current, d = Date()
        return k.component(.hour, from: d) * 60 + k.component(.minute, from: d)
    }

    /// buildMinutesLabel (nur Ankuenfte)
    private func minutenEtikett(_ f: DispoFahrt) -> String {
        switch f.aktuellerStatus {
        case "beendet": return "Beendet"
        case "stoniert": return "Storniert"
        case "unterwegs": return "Unterwegs"
        default: break
        }
        if f.verzugMinuten > 0 { return "+\(f.verzugMinuten) min" }
        guard let ziel = W.minuten(zielZeit(f), praefix: false) else { return "" }
        let tag = W.tagWert(String(f.datum.prefix(10)))
        let heute = Datum.tagWert(Date())
        func tagMonat() -> String {
            let t = tag.split(separator: "-")
            return t.count == 3 ? "\(t[2]).\(t[1])" : tag
        }
        if !tag.isEmpty && tag > heute { return tagMonat() }
        if !tag.isEmpty && tag < heute { return "Überfällig" }
        let diff = ziel - jetztMinuten()
        if diff < 0 { return "Überfällig" }
        if diff == 0 { return "Jetzt" }
        if diff >= 360 && !tag.isEmpty { return tagMonat() }
        if diff >= 60 { return "in \(diff / 60):\(String(format: "%02d", diff % 60)) h" }
        return "in \(diff) min."
    }

    /// displayTime der Ankuenfte (Abfahrten zeigen ride.time unveraendert).
    private func anzeigeZeiten(_ f: DispoFahrt) -> FahrtZeiten {
        var z = f.zeiten
        guard !abfahrten else { return z }
        let ziel = zielZeit(f)
        let abfahrt = !mitStandort && f.aktuellerStatus != "unterwegs"
        let alt = f.zeiten
        z.status = minutenEtikett(f)
        if f.verspaetet {
            z.original = (abfahrt ? W.erste(alt.original, alt.zeit, alt.neu, ziel) : W.erste(alt.ankunftOriginal, alt.original, ziel)) ?? "--:--"
            z.neu = (abfahrt ? W.erste(alt.neu, alt.zeit, alt.original, ziel) : W.erste(alt.ankunftNeu, alt.ankunftZeit, alt.neu, ziel)) ?? "--:--"
        } else {
            z.zeit = (abfahrt ? W.erste(alt.zeit, alt.neu, alt.original, ziel) : W.erste(alt.ankunftZeit, alt.ankunftNeu, alt.zeit, ziel)) ?? "--:--"
        }
        return z
    }

    private func sichtbareFahrten() -> [Eintrag] {
        // Vorauswahl aus App.jsx: Live/Archiv, bei Standort Ziel (Ankuenfte) bzw. Start (Abfahrten).
        let basis = speicher.fahrten.filter { f in
            guard f.archiviert == archiv else { return false }
            guard mitStandort else { return true }
            return W.ortPasst(abfahrten ? f.startOrt : f.zielOrt, speicher.standort)
        }
        let fi = speicher.filter
        let startSuche = fi.startSuche.trimmingCharacters(in: .whitespaces).lowercased()
        let zielSuche = fi.zielSuche.trimmingCharacters(in: .whitespaces).lowercased()
        let datum = fi.datum.trimmingCharacters(in: .whitespaces)
        let suchText = suche.trimmingCharacters(in: .whitespaces).lowercased()
        let heute = Datum.tagWert(Date())
        let jetzt = jetztMinuten()

        let gefiltert = basis.filter { f in
            let ohneFahrer = f.fahrer.lowercased() == "fahrer fehlt" || f.ohneFahrerVariante
            let teile = f.route.components(separatedBy: " - ")
            let start = (teile.first ?? "").trimmingCharacters(in: .whitespaces)
            let ziel = teile.dropFirst().joined(separator: " - ").trimmingCharacters(in: .whitespaces)
            if fi.ohneFahrer && !ohneFahrer { return false }
            if fi.bestaetigung && !f.bestaetigt { return false }
            if !startSuche.isEmpty && !start.lowercased().contains(startSuche) { return false }
            if !zielSuche.isEmpty && !ziel.lowercased().contains(zielSuche) { return false }
            if !datum.isEmpty && String(f.datum.prefix(10)) != datum { return false }
            if fi.konvoi && f.konvoi.isEmpty { return false }
            if fi.besonderheiten && !f.verspaetet { return false }
            if !archiv && !fi.vergangene {
                let tag = W.tagWert(String(f.datum.prefix(10)))
                if !tag.isEmpty && tag < heute { return false }
                if !(tag > heute && !tag.isEmpty), let ziel = W.minuten(zielZeit(f), praefix: false) {
                    let nichtGestartet = !["unterwegs", "beendet", "stoniert"].contains(f.aktuellerStatus)
                    if ziel < jetzt && !nichtGestartet { return false }
                }
            }
            guard !suchText.isEmpty else { return true }
            let eintraege = FahrtText.fahrerEintraege(f)
            let nummern = FahrtText.fahrerNummern(eintraege, f.fahrerNummer)
            let heuhaufen = "\(f.name) \(f.fahrer) \(eintraege.joined(separator: " ")) \(nummern.joined(separator: " ")) \(nummern.map { "#\($0)" }.joined(separator: " ")) \(start) \(ziel)".lowercased()
            return heuhaufen.contains(suchText)
        }

        func sortMinuten(_ f: DispoFahrt) -> Int {
            let z = f.zeiten
            let zeit = abfahrten ? (W.erste(z.neu, z.zeit, z.original) ?? "") : zielZeit(f)
            guard W.passt(zeit, #"^\d{1,2}:\d{2}$"#) else { return Int.max }
            let t = zeit.split(separator: ":").compactMap { Int($0) }
            return t[0] * 60 + t[1]
        }
        func sortTag(_ f: DispoFahrt) -> String {
            let t = W.tagWert(String(f.datum.prefix(10)))
            return t.isEmpty ? "9999-12-31" : t
        }
        let sortiert = gefiltert.enumerated().sorted { a, b in
            let ta = sortTag(a.element), tb = sortTag(b.element)
            if ta != tb { return ta < tb }
            let ma = sortMinuten(a.element), mb = sortMinuten(b.element)
            if ma != mb { return ma < mb }
            return a.offset < b.offset
        }.map(\.element)

        var vorher: String?
        return sortiert.map { f in
            let tag = W.tagWert(String(f.datum.prefix(10)))
            let neu = !tag.isEmpty && tag != vorher ? tag : nil
            vorher = tag
            return Eintrag(fahrt: f, zeiten: anzeigeZeiten(f), neuerTag: neu)
        }
    }
}

// MARK: - Fahrer-Texte (RideCard-Hilfen)

extension FahrtText {
    static let fahrerFehlt = "Fahrer fehlt"

    /// getRideDriverEntries
    static func fahrerEintraege(_ f: DispoFahrt) -> [String] {
        let liste = f.fahrerNamen.map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
        if !liste.isEmpty { return liste }
        return f.fahrer.components(separatedBy: ",").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
    }

    /// extractDriverNumbers
    static func fahrerNummern(_ eintraege: [String], _ ersatz: String?) -> [String] {
        var nummern: [String] = []
        func dazu(_ s: String) { if !s.isEmpty && !nummern.contains(s) { nummern.append(s) } }
        for e in eintraege {
            if let r = e.range(of: #"\(([^)]+)\)\s*$"#, options: .regularExpression) {
                dazu(String(e[r]).trimmingCharacters(in: .whitespaces).dropFirst().split(separator: ")").first.map { String($0).trimmingCharacters(in: .whitespaces) } ?? "")
            }
            let regex = try? NSRegularExpression(pattern: #"\d+"#)
            for t in regex?.matches(in: e, range: NSRange(e.startIndex..., in: e)) ?? [] {
                if let r = Range(t.range, in: e) { dazu(String(e[r])) }
            }
        }
        if let ersatz { dazu(ersatz.trimmingCharacters(in: .whitespaces)) }
        return nummern
    }

    /// shortenName: "Vorname Nachname" -> "V. Nachname"
    static func kurzName(_ name: String) -> String {
        let t = name.trimmingCharacters(in: .whitespaces)
        let teile = t.split(whereSeparator: \.isWhitespace)
        guard teile.count >= 2, let erster = teile.first?.first else { return name }
        return "\(String(erster).uppercased()). \(teile.dropFirst().joined(separator: " "))"
    }

    /// formatDriverEntry
    static func fahrerKurz(_ eintrag: String, _ ersatzNummer: String?) -> String {
        let roh = eintrag.trimmingCharacters(in: .whitespaces)
        if roh.isEmpty { return "" }
        if roh.lowercased() == fahrerFehlt.lowercased() { return fahrerFehlt }
        var nummer = ersatzNummer ?? ""
        var namensTeil = roh
        if let r = roh.range(of: #"\(([^)]+)\)\s*$"#, options: .regularExpression) {
            let klammer = String(roh[r]).trimmingCharacters(in: .whitespaces)
            nummer = String(klammer.dropFirst().prefix { $0 != ")" })
            namensTeil = String(roh[..<r.lowerBound]).trimmingCharacters(in: .whitespaces)
        }
        nummer = nummer.trimmingCharacters(in: .whitespaces)
        let kurz = kurzName(namensTeil)
        if !kurz.isEmpty && !nummer.isEmpty { return "\(kurz) (\(nummer))" }
        if !kurz.isEmpty { return kurz }
        if !nummer.isEmpty { return nummer }
        return roh
    }
}

// MARK: - Fahrtkarte (RideCard)

private enum Achse { case x, y }

struct DispoFahrtKarte: View {
    let fahrt: DispoFahrt
    let zeiten: FahrtZeiten
    /// Ankuenfte: Datum statt Minuten in Schwarz statt Gruen.
    let datumAlsStatus: Bool
    let wischen: Bool
    let oeffnen: () -> Void
    let erledigt: () -> Void
    let archivieren: () -> Void
    let duplizieren: () -> Void

    @State private var versatz: CGFloat = 0
    @State private var startVersatz: CGFloat = 0
    @State private var achse: Achse?

    private let breite: CGFloat = 362
    private let aktionBreite: CGFloat = 90

    private var rot: Bool { fahrt.ohneFahrerVariante }
    private var textFarbe: Color { rot ? .black : Color(hex: 0x18181B) }
    private var notizFarbe: Color { rot ? .black : Color(hex: 0x71717B) }
    private var strichFarbe: Color { rot ? Color(hex: 0x262626) : Color(hex: 0xFB2C36) }
    private var statusFarbe: Color { rot ? Color(hex: 0x262626) : (datumAlsStatus ? Color(hex: 0x18181B) : Color(hex: 0x59BE80)) }

    var body: some View {
        inhalt
            .frame(width: breite)
            // Wischen verschiebt die Karte ueber den Layout-Abstand, damit die Tipp-Flaeche mitwandert.
            .padding(.leading, wischen ? versatz : 0)
            .frame(width: breite, alignment: .leading)
            .background(alignment: .leading) { if wischen { aktionen } }
            .clipped()
            .simultaneousGesture(ziehen, including: wischen ? .all : .subviews)
            .animation(achse == nil ? .easeOut(duration: 0.18) : nil, value: versatz)
    }

    private var ziehen: some Gesture {
        DragGesture(minimumDistance: 8)
            .onChanged { w in
                if achse == nil {
                    achse = abs(w.translation.width) >= abs(w.translation.height) ? .x : .y
                    startVersatz = versatz
                }
                guard achse == .x else { return }
                versatz = max(-aktionBreite, min(aktionBreite, startVersatz + w.translation.width))
            }
            .onEnded { _ in
                if achse == .x {
                    achse = nil
                    versatz = versatz > 36 ? aktionBreite : (versatz < -36 ? -aktionBreite : 0)
                } else {
                    achse = nil
                }
            }
    }

    private var aktionen: some View {
        HStack(spacing: 0) {
            VStack(spacing: 0) {
                AktionsKnopf(icon: "Faecher_Done", text: "Fahrt abschliessen") { versatz = 0; erledigt() }
                AktionsKnopf(icon: "Faecher_Archievieren", text: "Fahrt archivieren") { versatz = 0; archivieren() }
            }
            .frame(width: aktionBreite).background(lime)
            Spacer(minLength: 0)
            VStack(spacing: 0) {
                // Im Web ohne Aktion, setzt nur die Karte zurueck.
                AktionsKnopf(icon: "Faecher_AddDriver", text: "Fahrer hinzufuegen") { versatz = 0 }
                AktionsKnopf(icon: "Faecher_Duplicat", text: "Fahrt duplizieren") { versatz = 0; duplizieren() }
            }
            .frame(width: aktionBreite).background(lime)
        }
    }

    // MARK: Karteninhalt

    private var inhalt: some View {
        HStack(alignment: .top, spacing: 16) {
            VStack(alignment: .leading, spacing: 5) {
                namensZeile
                Text(fahrt.route)
                    .font(.grotesk(12, .medium)).tracking(0.3).foregroundStyle(textFarbe).opacity(0.8)
                    .cssZeile(12, 16)
                    .fixedSize(horizontal: false, vertical: true)
                fahrerZeile
                notizBlock
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            rechteSpalte
        }
        .padding(18)
        .frame(width: breite, alignment: .topLeading)
        .frame(minHeight: 144, alignment: .top)
        .overlay(alignment: .topLeading) {
            if fahrt.kiGebucht {
                Image(rot ? "KI_Trisar_Icons_01_Lime" : "KI_Trisar_Icons_01_green").resizable()
                    .frame(width: 14, height: 13).padding(.leading, 8).padding(.top, 8)
            }
        }
        .overlay(alignment: .bottomTrailing) {
            Image("Arrow_Trisar_Icons_01").resizable().frame(width: 34, height: 21).scaleEffect(1.2)
                .padding(.trailing, 16).padding(.bottom, 18)
        }
        .background(rot ? Color(hex: 0xFB2C36) : .white)
        .contentShape(Rectangle())
        .onTapGesture {
            if wischen && versatz != 0 { versatz = 0 } else { oeffnen() }
        }
        .accessibilityLabel("Fahrt \(fahrt.name) öffnen")
    }

    private var namensZeile: some View {
        let kurz = fahrt.alleGaeste.isEmpty ? FahrtText.kurzName(fahrt.name)
            : fahrt.alleGaeste.map(FahrtText.kurzName).joined(separator: ", ")
        let groesse: CGFloat = kurz.count > 45 ? 18 : (kurz.count > 30 ? 20 : 24)
        var text = Text(kurz)
        if fahrt.anonymeGaeste > 0 {
            text = text + Text("  + \(fahrt.anonymeGaeste) ")
                + Text(Image(uiImage: PersonIcon.bild)).foregroundColor(textFarbe.opacity(0.6)).baselineOffset(-2)
        }
        return text
            .font(.grotesk(groesse, .bold)).foregroundStyle(textFarbe)
            .lineLimit(2)
            .cssZeile(groesse, groesse * 1.5)
            .fixedSize(horizontal: false, vertical: true)
    }

    private var fahrerZeile: some View {
        let eintraege = FahrtText.fahrerEintraege(fahrt)
        let fehlt = eintraege.isEmpty || eintraege.allSatisfy { $0.lowercased() == FahrtText.fahrerFehlt.lowercased() }
        var teile: [(String, Color)] = []
        if fehlt {
            teile = [(FahrtText.fahrerFehlt, textFarbe)]
        } else {
            for (i, e) in eintraege.enumerated() {
                let t = FahrtText.fahrerKurz(e, i == 0 ? fahrt.fahrerNummer : nil)
                guard !t.isEmpty else { continue }
                let antwort = W.antwort(i < fahrt.fahrerAntworten.count ? fahrt.fahrerAntworten[i] : "pending")
                let farbe = antwort == "refused" ? Color(hex: 0xF55757) : (antwort == "pending" ? Color(hex: 0xFF8A00) : Color(hex: 0x18181B))
                teile.append((t, farbe))
            }
            if teile.isEmpty { teile = [(FahrtText.fahrerFehlt, textFarbe)] }
        }
        let text = teile.enumerated().reduce(Text("")) { summe, paar in
            summe + Text((paar.offset > 0 ? ", " : "") + paar.element.0).foregroundColor(paar.element.1)
        }
        return text.font(.grotesk(16, .bold)).tracking(0.4)
            .cssZeile(16, 24)
            .fixedSize(horizontal: false, vertical: true)
    }

    @ViewBuilder private var notizBlock: some View {
        let zeilen = (fahrt.notizen.isEmpty ? [fahrt.notiz] : fahrt.notizen)
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }
        if !zeilen.isEmpty {
            VStack(alignment: .leading, spacing: 0) {
                ForEach(Array(zeilen.enumerated()), id: \.offset) { i, zeile in
                    Text(i == 0 ? "Notiz: \(zeile)" : zeile)
                        .font(.grotesk(12, .medium)).tracking(-0.3).foregroundStyle(notizFarbe)
                        .lineLimit(1).truncationMode(.tail)
                        .cssZeile(12, 20)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .overlay(alignment: .top) {
                            if i > 0 { Rectangle().fill(Color.black.opacity(0.1)).frame(height: 1) }
                        }
                }
            }
        }
    }

    private var rechteSpalte: some View {
        VStack(alignment: .trailing, spacing: 0) {
            if fahrt.verspaetet {
                Text(zeiten.original).font(.grotesk(16)).strikethrough().foregroundStyle(strichFarbe).cssZeile(16, 20)
                if !zeiten.status.isEmpty {
                    Text(zeiten.status).font(.grotesk(16, .bold)).foregroundStyle(statusFarbe).cssZeile(16, 20)
                }
                Text(zeiten.neu).font(.grotesk(16)).foregroundStyle(statusFarbe).cssZeile(16, 20)
            } else {
                if !zeiten.status.isEmpty {
                    Text(zeiten.status).font(.grotesk(16, .bold)).foregroundStyle(statusFarbe).cssZeile(16, 20)
                }
                Text(zeiten.zeit).font(.grotesk(16)).foregroundStyle(statusFarbe).cssZeile(16, 20)
            }
            if let zusatz {
                Text(zusatz).font(.grotesk(12, .medium)).foregroundStyle(textFarbe).opacity(0.6)
                    .cssZeile(12, 16).padding(.top, 4)
            }
        }
        .multilineTextAlignment(.trailing)
        .fixedSize()
    }

    /// Losfahr- bzw. Ankunftszeit klein unter der grossen Zeit.
    private var zusatz: String? {
        let gezeigt = (fahrt.verspaetet ? zeiten.neu : zeiten.zeit).trimmingCharacters(in: .whitespaces)
        let ankunft = (W.erste(zeiten.ankunftNeu, zeiten.ankunftZeit) ?? "").trimmingCharacters(in: .whitespaces)
        let abfahrt = fahrt.startZeit.trimmingCharacters(in: .whitespaces)
        func gueltig(_ z: String) -> Bool { W.passt(z, #"^\d{1,2}:\d{2}$"#) }
        if gueltig(ankunft) && ankunft != gezeigt { return "Ankunft \(ankunft)" }
        if gueltig(abfahrt) && abfahrt != gezeigt { return "Abfahrt \(abfahrt)" }
        return nil
    }
}

/// Person-Icon klein (16 x 18, contain) als Vorlage, damit es im Fliesstext die Textfarbe annimmt.
private enum PersonIcon {
    static let bild: UIImage = {
        let groesse = CGSize(width: 16, height: 18)
        guard let quelle = UIImage(named: "Person_Trisar_Icons_01") else { return UIImage() }
        let s = min(groesse.width / quelle.size.width, groesse.height / quelle.size.height)
        let ziel = CGSize(width: quelle.size.width * s, height: quelle.size.height * s)
        let bild = UIGraphicsImageRenderer(size: groesse).image { _ in
            quelle.draw(in: CGRect(x: (groesse.width - ziel.width) / 2, y: (groesse.height - ziel.height) / 2,
                                   width: ziel.width, height: ziel.height))
        }
        return bild.withRenderingMode(.alwaysTemplate)
    }()
}

private struct AktionsKnopf: View {
    let icon: String
    let text: String
    let aktion: () -> Void
    var body: some View {
        Button(action: aktion) {
            Image(icon).resizable().scaledToFit().frame(width: 36, height: 36)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .contentShape(Rectangle())
        }
        .buttonStyle(.web)
        .accessibilityLabel(text)
    }
}

/// Trennzeile zwischen den Tagen (nur Ankuenfte): Strich — „Mittwoch 04.11.“ — Strich.
private struct TagTrenner: View {
    let datum: String
    let erster: Bool
    var body: some View {
        HStack(spacing: 0) {
            Rectangle().fill(Color(hex: 0xE3F754)).frame(width: 44, height: 2)
            Spacer(minLength: 0)
            Text(Datum.trennzeile(datum))
                .font(.grotesk(26, .bold)).tracking(-0.5).foregroundStyle(Color(hex: 0xE3F754))
                .lineLimit(1).cssZeile(26, 39)
            Spacer(minLength: 0)
            Rectangle().fill(Color(hex: 0xE3F754)).frame(width: 44, height: 2)
        }
        .frame(width: 362)
        .padding(.top, erster ? 0 : 12)
        .padding(.bottom, 12)
    }
}

/// Ankuenfte/Abfahrten-Umschalter (w-44 h-14), nur mit Standort.
private struct RichtungsKnopf: View {
    let text: String
    let aktiv: Bool
    let aktion: () -> Void
    var body: some View {
        Button(action: aktion) {
            Text(text).font(.grotesk(16, .medium)).tracking(0.4)
                .foregroundStyle(aktiv ? .black : lime)
                .frame(width: 176, height: 56)
                .background(aktiv ? lime : .clear)
                .overlay(Rectangle().strokeBorder(lime, lineWidth: 2))
                .contentShape(Rectangle())
        }
        .buttonStyle(.web)
    }
}

/// Live-Board des Flughafens am Standort (nur mit Standort).
private struct BoardKasten: View {
    let board: FlughafenBoard
    let abfahrten: Bool
    let aktualisieren: () -> Void

    private let gruenGrau = Color(hex: 0x9EA57D)

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 12) {
                Text("\(abfahrten ? "Live-Board Abfahrten" : "Live-Board Ankünfte") \(board.code.isEmpty ? "" : "(\(board.code))")")
                    .font(.grotesk(12, .bold)).tracking(0.3).foregroundStyle(lime)
                Spacer(minLength: 0)
                Button(action: aktualisieren) {
                    Text("Aktualisieren").font(.grotesk(11, .medium)).underline().foregroundStyle(lime)
                }
                .buttonStyle(.web)
            }
            if let stand = standText {
                Text("Stand: \(stand)").font(.grotesk(11, .medium)).foregroundStyle(gruenGrau).padding(.top, 4)
            }
            if !board.fehler.isEmpty {
                Text(board.fehler).font(.grotesk(12, .medium)).foregroundStyle(Color(hex: 0xFF8E8E)).padding(.top, 8)
            } else if board.laedt {
                Text("Lade Live-Flugdaten...").font(.grotesk(12, .medium)).foregroundStyle(lime).opacity(0.8).padding(.top, 8)
            } else if board.eintraege.isEmpty {
                Text("Keine Board-Einträge gefunden.").font(.grotesk(12, .medium)).foregroundStyle(lime).opacity(0.8).padding(.top, 8)
            }
            if board.fehler.isEmpty && !board.eintraege.isEmpty {
                VStack(alignment: .leading, spacing: 4) {
                    ForEach(Array(board.eintraege.prefix(5).enumerated()), id: \.offset) { _, e in
                        HStack(alignment: .top, spacing: 12) {
                            VStack(alignment: .leading, spacing: 0) {
                                Text("\(wert(e, "flight_number", "---")) · \(wert(e, "route_label", "-"))").lineLimit(1)
                                Text(unterzeile(e)).foregroundStyle(gruenGrau).lineLimit(1)
                            }
                            Spacer(minLength: 0)
                            Text(wert(e, "time_label", "--:--"))
                        }
                        .font(.grotesk(12, .medium)).foregroundStyle(lime)
                    }
                }
                .padding(.top, 8)
            }
        }
        .padding(12)
        .frame(width: 362, alignment: .leading)
        .background(Color(hex: 0x101108))
        .overlay(Rectangle().strokeBorder(Color(hex: 0x4A4F22), lineWidth: 1))
    }

    private var standText: String? {
        guard !board.stand.isEmpty else { return nil }
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let datum = f.date(from: board.stand) ?? ISO8601DateFormatter().date(from: board.stand)
        guard let datum else { return nil }
        let a = DateFormatter(); a.locale = Locale(identifier: "de_DE"); a.dateFormat = "HH:mm"
        return a.string(from: datum)
    }

    private func wert(_ e: DBZeile, _ k: String, _ ersatz: String) -> String {
        let t = W.t(e[k]); return t.isEmpty ? ersatz : t
    }

    private func unterzeile(_ e: DBZeile) -> String {
        var s = W.t(e["status_description"])
        if s.isEmpty { s = W.t(e["status_code"]) }
        if s.isEmpty { s = "-" }
        let terminal = W.t(e["terminal"]), gate = W.t(e["gate"])
        if !terminal.isEmpty { s += " · T\(terminal)" }
        if !gate.isEmpty { s += " · G\(gate)" }
        return s
    }
}

// MARK: - Gemeinsame Bausteine

/// Fliessender Inhalt im 402er Raster: wie die Web-Listen (px-5 pt-[60px], Inhalt bestimmt die Hoehe),
/// skaliert wie `Leinwand`. Ohne eigenen Hintergrund, damit der feste Verlauf dahinter stehen bleibt.
struct FlussLeinwand<Inhalt: View>: View {
    @ViewBuilder let inhalt: () -> Inhalt
    @State private var hoehe: CGFloat = 874

    var body: some View {
        GeometryReader { geo in
            let s = min(geo.size.width / 402, 1)
            ScrollView(.vertical, showsIndicators: false) {
                inhalt()
                    .frame(width: 402, alignment: .topLeading)
                    .fixedSize(horizontal: false, vertical: true)
                    .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { hoehe = $0 }
                    .scaleEffect(s, anchor: .topLeading)
                    .frame(width: 402 * s, height: hoehe * s, alignment: .topLeading)
                    .frame(maxWidth: .infinity)
            }
            .scrollBounceBehavior(.basedOnSize)
            .scrollDismissesKeyboard(.interactively)
            .contentMargins(.vertical, 0, for: .scrollContent)
            .ignoresSafeArea()
        }
        .ignoresSafeArea()
    }
}

extension View {
    /// CSS line-height: Zeilenabstand und halber Rest oben/unten wie im Browser.
    func cssZeile(_ groesse: CGFloat, _ zeilenHoehe: CGFloat) -> some View {
        let natur = WebText.schrift(groesse, .regular).lineHeight
        let rest = zeilenHoehe - natur
        return lineSpacing(max(0, rest)).padding(.vertical, rest / 2)
    }

    /// Lime-Eingabe in den Listenfeldern (16 medium, ohne Rahmen).
    func eingabeStil() -> some View {
        textFieldStyle(.plain)
            .font(.grotesk(16, .medium))
            .foregroundStyle(lime)
            .tint(lime)
            .autocorrectionDisabled()
            .textInputAutocapitalization(.never)
    }
}
