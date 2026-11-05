import SwiftUI

/// Einsatzplanung Schritt 1: Zeitraum waehlen (EinsatzplanungKalender.jsx, Figma 2571:12506, 402 x 873).
/// Start- und Endzeit oben, Monatskalender (nur Tage mit Fahrten ab heute waehlbar), erster Tipp
/// Starttag, zweiter Endtag, Pfeil unten rechts startet die Planung.
struct EinsatzKalenderAnsicht: View {
    let heuteIso: String
    let tageMitFahrten: Set<String>
    let anfang: EinsatzZeitraum?
    let zurueck: () -> Void
    let einstellungen: () -> Void
    let weiter: (EinsatzZeitraum) -> Void

    @State private var von: String?
    @State private var bis: String?
    @State private var startZeit = ""
    @State private var endZeit = ""
    @State private var monat: (jahr: Int, monat: Int) = (2026, 1)
    @State private var zeitOffen: ZeitArt?

    private enum ZeitArt: String, Identifiable { case start, ende; var id: String { rawValue } }

    private static let spaltenX: [CGFloat] = [53, 103, 154, 204.5, 255, 305, 354.5]
    private static let kopfX: [CGFloat] = [51, 102.5, 154, 205.5, 254.5, 303, 352]
    private static let kreis: CGFloat = 35
    private let limeHalb = EinsatzFarbe.lime.opacity(0.5)

    private struct Band: Hashable { let zeile: Int; let links: CGFloat; let breite: CGFloat; let rundL: Bool; let rundR: Bool }
    private struct KTag: Hashable { let nr: Int; let iso: String; let spalte: Int; let zeile: Int }

    init(heuteIso: String, tageMitFahrten: Set<String>, anfang: EinsatzZeitraum?, zurueck: @escaping () -> Void,
         einstellungen: @escaping () -> Void, weiter: @escaping (EinsatzZeitraum) -> Void) {
        self.heuteIso = heuteIso
        self.tageMitFahrten = tageMitFahrten
        self.anfang = anfang
        self.zurueck = zurueck
        self.einstellungen = einstellungen
        self.weiter = weiter
        _von = State(initialValue: anfang?.von)
        _bis = State(initialValue: anfang?.bis)
        _startZeit = State(initialValue: anfang?.startZeit ?? "")
        _endZeit = State(initialValue: anfang?.endZeit ?? "")
        let quelle = (anfang?.von ?? heuteIso).split(separator: "-").compactMap { Int($0) }
        _monat = State(initialValue: (quelle.count == 3 ? quelle[0] : 2026, quelle.count == 3 ? quelle[1] - 1 : 0))
    }

    private var tage: [KTag] {
        var k = Calendar(identifier: .gregorian)
        k.timeZone = .current
        guard let erster = k.date(from: DateComponents(year: monat.jahr, month: monat.monat + 1, day: 1)),
              let anzahl = k.range(of: .day, in: .month, for: erster)?.count else { return [] }
        let wochentag = (k.component(.weekday, from: erster) + 5) % 7   // Montag = 0
        return (0..<anzahl).map { i in
            let index = wochentag + i
            return KTag(nr: i + 1, iso: String(format: "%04d-%02d-%02d", monat.jahr, monat.monat + 1, i + 1),
                        spalte: index % 7, zeile: index / 7)
        }
    }

    private var zeilenAbstand: CGFloat { ((tage.last?.zeile ?? 4) + 1) > 5 ? 46 : 54 }
    private func zeileY(_ z: Int) -> CGFloat { 402 + CGFloat(z) * zeilenAbstand }
    private func waehlbar(_ iso: String) -> Bool { iso >= heuteIso && tageMitFahrten.contains(iso) }
    private var ende: String? { bis ?? von }
    private func imBand(_ iso: String) -> Bool { guard let von, let bis else { return false }; return iso >= von && iso <= bis }

    private var vorMonatGesperrt: Bool {
        let h = heuteIso.split(separator: "-").compactMap { Int($0) }
        guard h.count == 3 else { return false }
        return monat.jahr < h[0] || (monat.jahr == h[0] && monat.monat <= h[1] - 1)
    }

    private var monatsName: String {
        let f = DateFormatter()
        f.locale = Locale(identifier: "de_DE")
        f.dateFormat = "LLLL"
        let d = Calendar.current.date(from: DateComponents(year: monat.jahr, month: monat.monat + 1, day: 15)) ?? Date()
        return f.string(from: d)
    }

    var body: some View {
        ZStack(alignment: .topLeading) {
            EinsatzHintergrund()
            Leinwand(basisHoehe: 873, mitHintergrund: false) { _ in
                ZStack(alignment: .topLeading) {
                    ZurueckKnopf(aktion: zurueck).platz(20, 60, 50, 50)
                    Button(action: einstellungen) {
                        Image("filter").resizable().frame(width: 50, height: 50)
                    }
                    .buttonStyle(.web).accessibilityLabel("Planungseinstellungen").platz(332, 60, 50, 50)

                    zeitfeld(links: 20, platzhalter: "Start Zeit", wert: startZeit) { zeitOffen = .start }
                    zeitfeld(links: 204, platzhalter: "End Zeit", wert: endZeit) { zeitOffen = .ende }

                    Button { monatWechseln(-1) } label: {
                        Image("kal_pfeil_links").resizable().frame(width: 26.136, height: 15.909).frame(width: 46, height: 36)
                    }
                    .buttonStyle(.web).disabled(vorMonatGesperrt).opacity(vorMonatGesperrt ? 0.5 : 1).platz(53, 261, 46, 36)
                    Text(monatsName).font(.grotesk(30, .bold)).tracking(-0.5).foregroundStyle(EinsatzFarbe.titel)
                        .fixedSize().frame(width: 362, height: 30).platz(20, 262)
                    Button { monatWechseln(1) } label: {
                        Image("kal_pfeil_links").resizable().frame(width: 26.136, height: 15.909).rotationEffect(.degrees(180))
                            .frame(width: 46, height: 36)
                    }
                    .buttonStyle(.web).platz(314, 261, 46, 36)

                    ForEach(0..<7, id: \.self) { i in
                        Text(["M", "D", "M", "D", "F", "S", "S"][i]).font(.grotesk(16, .medium)).tracking(0.5).foregroundStyle(limeHalb)
                            .fixedSize().mittig(Self.kopfX[i], 348 - 12, 30, 24, .center)
                    }

                    baender
                    ForEach(tage.filter { $0.iso == von || $0.iso == ende }, id: \.self) { t in
                        Circle().fill(Color(hex: 0x010100)).overlay(Circle().strokeBorder(EinsatzFarbe.lime, lineWidth: 1))
                            .allowsHitTesting(false)
                            .platz(Self.spaltenX[t.spalte] - Self.kreis / 2, zeileY(t.zeile) - Self.kreis / 2, Self.kreis, Self.kreis)
                    }
                    ForEach(tage, id: \.self) { t in
                        let aktiv = waehlbar(t.iso)
                        Button { tagTippen(t.iso) } label: {
                            Text("\(t.nr)").font(.grotesk(16, .medium)).tracking(0.5)
                                .foregroundStyle(aktiv ? EinsatzFarbe.lime : EinsatzFarbe.lime.opacity(0.25))
                                .frame(width: 44, height: 44).contentShape(Rectangle())
                        }
                        .buttonStyle(.web).disabled(!aktiv)
                        .platz(Self.spaltenX[t.spalte] - 22, zeileY(t.zeile) - 22, 44, 44)
                    }

                    Button {
                        von = nil; bis = nil; startZeit = ""; endZeit = ""
                    } label: {
                        Text("Zurücksetzen").font(.grotesk(14, .medium)).tracking(0.5).foregroundStyle(limeHalb).fixedSize()
                    }
                    .buttonStyle(.web).mittig(201, 689 - 12, 160, 24, .center)

                    Button {
                        guard let von else { return }
                        weiter(EinsatzZeitraum(von: von, bis: ende ?? von, startZeit: startZeit, endZeit: endZeit))
                    } label: {
                        Image("weiter_gross").resizable().frame(width: 45, height: 28).rotationEffect(.degrees(180))
                            .frame(width: 65, height: 48).contentShape(Rectangle())
                    }
                    .buttonStyle(.web).disabled(von == nil).opacity(von == nil ? 0.5 : 1)
                    .accessibilityLabel("Planung starten").platz(309, 665, 65, 48)
                }
            }
        }
        .sheet(item: $zeitOffen) { art in
            EinsatzZeitBlatt(wert: art == .start ? startZeit : endZeit) { neu in
                if art == .start { startZeit = neu } else { endZeit = neu }
            }
            .presentationDetents([.height(320)])
            .presentationBackground(Color(hex: 0x1C1C1D))
        }
    }

    private func zeitfeld(links: CGFloat, platzhalter: String, wert: String, oeffnen: @escaping () -> Void) -> some View {
        Button(action: oeffnen) {
            HStack(spacing: 0) {
                Text(wert.isEmpty ? platzhalter : "\(wert) Uhr").font(.grotesk(16, .medium)).tracking(0.5)
                    .foregroundStyle(wert.isEmpty ? limeHalb : EinsatzFarbe.lime).lineLimit(1)
                Spacer(minLength: 0)
                Image("Edit_Trisar_Icon_01_Lime").resizable().frame(width: 15, height: 15)
            }
            .padding(.horizontal, 16)
            .frame(width: 178, height: 56)
            .overlay(Rectangle().strokeBorder(EinsatzFarbe.lime, lineWidth: 2))
            .contentShape(Rectangle())
        }
        .buttonStyle(.web)
        .platz(links, 158, 178, 56)
    }

    /// Band je Wochenzeile (25 % Lime, Enden rund, wo das Band weiterlaeuft).
    private var baender: some View {
        var liste: [Band] = []
        if let von, let bis {
            var zeilen: [Int: (min: KTag, max: KTag)] = [:]
            for t in tage where imBand(t.iso) {
                var e = zeilen[t.zeile] ?? (t, t)
                if t.spalte < e.min.spalte { e.min = t }
                if t.spalte > e.max.spalte { e.max = t }
                zeilen[t.zeile] = e
            }
            for (z, e) in zeilen.sorted(by: { $0.key < $1.key }) {
                let beginnt = e.min.iso == von, endet = e.max.iso == bis
                let l = beginnt ? Self.spaltenX[e.min.spalte] : Self.spaltenX[e.min.spalte] - Self.kreis / 2
                let r = endet ? Self.spaltenX[e.max.spalte] : Self.spaltenX[e.max.spalte] + 20.5
                liste.append(Band(zeile: z, links: l, breite: max(0, r - l), rundL: !beginnt, rundR: !endet))
            }
        }
        return ZStack(alignment: .topLeading) {
            ForEach(liste, id: \.zeile) { b in
                UnevenRoundedRectangle(topLeadingRadius: b.rundL ? 50 : 0, bottomLeadingRadius: b.rundL ? 50 : 0,
                                       bottomTrailingRadius: b.rundR ? 50 : 0, topTrailingRadius: b.rundR ? 50 : 0)
                    .fill(EinsatzFarbe.lime).opacity(0.25)
                    .allowsHitTesting(false)
                    .platz(b.links, zeileY(b.zeile) - Self.kreis / 2, b.breite, Self.kreis)
            }
        }
    }

    private func tagTippen(_ iso: String) {
        guard waehlbar(iso) else { return }
        if von == nil || bis != nil || iso < (von ?? "") { von = iso; bis = nil; return }
        if iso == von { bis = nil; return }
        bis = iso
    }

    private func monatWechseln(_ delta: Int) {
        var m = monat.monat + delta, j = monat.jahr
        if m < 0 { m += 12; j -= 1 }
        if m > 11 { m -= 12; j += 1 }
        monat = (j, m)
    }
}

/// Zeitauswahl des Geraets (im Web `<input type="time">`), mit Zuruecksetzen und Fertig.
private struct EinsatzZeitBlatt: View {
    let wert: String
    let setzen: (String) -> Void
    @Environment(\.dismiss) private var schliessen
    @State private var zeit = Date()

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Button("Zurücksetzen") { setzen(""); schliessen() }
                Spacer()
                Button("Fertig") {
                    let k = Calendar.current.dateComponents([.hour, .minute], from: zeit)
                    setzen(String(format: "%02d:%02d", k.hour ?? 0, k.minute ?? 0))
                    schliessen()
                }
                .fontWeight(.bold)
            }
            .font(.grotesk(16, .medium))
            .foregroundStyle(EinsatzFarbe.lime)
            .padding(.horizontal, 20).padding(.top, 18)
            DatePicker("", selection: $zeit, displayedComponents: .hourAndMinute)
                .datePickerStyle(.wheel).labelsHidden()
                .environment(\.locale, Locale(identifier: "de_DE"))
                .colorScheme(.dark)
            Spacer(minLength: 0)
        }
        .onAppear {
            if let m = Dienstzeit.minuten(wert) {
                zeit = Calendar.current.date(bySettingHour: m / 60, minute: m % 60, second: 0, of: Date()) ?? Date()
            }
        }
    }
}
