import CoreLocation
import MapLibre
import SwiftUI

/// Der geplante Tag auf der Karte (EinsatzTagKarte.jsx): oeffnet sich aus der Tagesplanung ueber
/// das Kartensymbol und spielt alle Fahrten im Zeitraffer ab. Jeder Fahrer faehrt seinen Plan:
/// Anfahrt zum Gast (gelb), Fahrt mit Gast (rot), danach frei (gruen). Oben Zeitleiste mit 1x/2x/4x.
/// Orte ueber Nominatim, Strecken ueber OSRM (Routen.swift, wie die Karte der Disposition).
struct EinsatzTagKarteAnsicht: View {
    let tagIso: String
    let vorschlaege: [EinsatzVorschlag]
    let fahrer: [DispoFahrer]
    let kameraSignal: Int
    let zurueck: () -> Void

    @StateObject private var m = EinsatzKartenModell()

    var body: some View {
        GeometryReader { geo in
            let breite = min(402, geo.size.width)
            ZStack(alignment: .top) {
                EinsatzKarteFlaeche(modell: m, takt: m.takt, einpassen: m.einpassenSignal)
                    .ignoresSafeArea()
                VStack(spacing: 0) {
                    kopf.frame(height: 50).padding(.top, 60)
                    zeitleiste.frame(height: 44).padding(.top, 32)
                    lage.padding(.top, 8)
                    Spacer(minLength: 0)
                }
                .padding(.horizontal, 20)
                .frame(width: breite)
            }
            .frame(width: geo.size.width, height: geo.size.height)
            .ignoresSafeArea()
        }
        .ignoresSafeArea()
        .background(Color.black)
        .task { await m.starten(vorschlaege: vorschlaege, fahrer: fahrer) }
        .onChange(of: kameraSignal) { _, _ in m.gewaehlt = nil; m.einpassenSignal += 1 }
        .onDisappear { m.anhalten() }
    }

    // MARK: Kopf

    private var kopf: some View {
        HStack(spacing: 0) {
            Button(action: zurueck) {
                Image("Backbutton_Karte").resizable().scaledToFit().frame(width: 50, height: 50)
                    .background(Circle().fill(.black)).clipShape(Circle())
            }
            .buttonStyle(.web).accessibilityLabel("Zurück")
            Spacer(minLength: 0)
            Text(EinsatzUhr.tagKurz(tagIso)).font(.grotesk(16, .bold)).tracking(0.5).foregroundStyle(EinsatzFarbe.lime)
                .lineLimit(1).fixedSize().padding(.horizontal, 18).frame(height: 50).background(Capsule().fill(.black))
        }
    }

    // MARK: Zeitleiste

    private var zeitleiste: some View {
        HStack(spacing: 0) {
            Button { m.abspielen() } label: {
                Group {
                    if m.laeuft {
                        HStack(spacing: 4) {
                            RoundedRectangle(cornerRadius: 1).frame(width: 3.5, height: 14)
                            RoundedRectangle(cornerRadius: 1).frame(width: 3.5, height: 14)
                        }
                    } else if m.fertig {
                        Image(systemName: "arrow.counterclockwise").font(.system(size: 15, weight: .bold))
                    } else {
                        Image(systemName: "play.fill").font(.system(size: 13)).padding(.leading, 2)
                    }
                }
                .foregroundStyle(EinsatzFarbe.lime)
                .frame(width: 32, height: 32).contentShape(Rectangle())
            }
            .buttonStyle(.web).disabled(m.plaene.isEmpty).opacity(m.plaene.isEmpty ? 0.3 : 1)
            .accessibilityLabel(m.laeuft ? "Anhalten" : "Abspielen")

            Text(EinsatzUhr.uhr(Int(m.minute))).font(.grotesk(16, .bold)).monospacedDigit().foregroundStyle(.white)
                .frame(width: 54, alignment: .leading)

            GeometryReader { g in
                let spanne = max(1, m.zeitraum.bis - m.zeitraum.von)
                let anteil = max(0, min(1, (m.minute - Double(m.zeitraum.von)) / Double(spanne)))
                ZStack(alignment: .leading) {
                    Capsule().fill(.white.opacity(0.2)).frame(height: 2)
                    ForEach(Array(m.fahrtStriche.enumerated()), id: \.offset) { _, x in
                        Rectangle().fill(.white.opacity(0.25)).frame(width: 1, height: 8).offset(x: x * g.size.width)
                    }
                    Capsule().fill(EinsatzFarbe.lime).frame(width: anteil * g.size.width, height: 2)
                    Circle().fill(EinsatzFarbe.lime).frame(width: 12, height: 12)
                        .overlay(Circle().strokeBorder(Color(hex: 0x202020), lineWidth: 1))
                        .background(Circle().fill(EinsatzFarbe.lime.opacity(0.18)).frame(width: 18, height: 18))
                        .offset(x: anteil * g.size.width - 6)
                }
                .frame(height: g.size.height)
                .contentShape(Rectangle())
                .gesture(DragGesture(minimumDistance: 0)
                    .onChanged { w in m.ziehen(anteil: Double(w.location.x / max(1, g.size.width))) }
                    .onEnded { _ in m.ziehenEnde() })
                .accessibilityLabel("Zeitleiste des Tages")
            }
            .padding(.horizontal, 8)

            Button { m.tempoWechseln() } label: {
                Text("\(m.tempo)x").font(.grotesk(16, .bold)).monospacedDigit().foregroundStyle(EinsatzFarbe.lime)
                    .frame(width: 40, height: 32).contentShape(Rectangle())
            }
            .buttonStyle(.web).accessibilityLabel("Tempo \(m.tempo)x")
        }
        .padding(.leading, 8).padding(.trailing, 6)
        .background(RoundedRectangle(cornerRadius: 12).fill(.black))
    }

    // MARK: Lage oder gewaehlter Fahrer

    private static let zustandFarbe: [String: Color] = ["aktiv": Color(hex: 0xFF6F63), "inaktiv": Color(hex: 0xE3F654), "frei": Color(hex: 0x59BE80)]

    @ViewBuilder private var lage: some View {
        if let a = m.anzeige {
            VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: 10) {
                    Circle().fill(Self.zustandFarbe[a.zustand] ?? .gray).frame(width: 12, height: 12)
                        .overlay(Circle().strokeBorder(Color(hex: 0x202020), lineWidth: 1))
                    (Text(a.nummer.map { "\($0) " } ?? "").font(.grotesk(16, .bold)) + Text(a.name).font(.grotesk(16)))
                        .foregroundStyle(.white).lineLimit(1)
                    Spacer(minLength: 0)
                    Text(EinsatzKartenModell.kmText(m.kmFahrer)).font(.grotesk(16, .bold)).monospacedDigit()
                        .foregroundStyle(EinsatzFarbe.lime).fixedSize()
                }
                Group {
                    if a.art == "frei" || a.etd == nil {
                        Text("frei")
                    } else {
                        let vor = a.art == "fahrt" ? "" : "\(a.art == "anfahrt" ? "Anfahrt" : "wartet") · "
                        let ort = a.art == "fahrt" ? " · \(a.ab) – \(a.ziel)" : " · \(a.ab)"
                        Text(vor) + Text("\(a.etd ?? "") Uhr").bold().foregroundColor(.white) + Text(ort)
                    }
                }
                .font(.grotesk(13)).foregroundStyle(.white.opacity(0.6)).lineSpacing(5).padding(.leading, 22)
            }
            .padding(.horizontal, 16).padding(.top, 14).padding(.bottom, 12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: 12).fill(.black))
        } else if m.orteFertig && !m.plaene.isEmpty {
            HStack(spacing: 14) {
                ForEach(["aktiv", "inaktiv", "frei"], id: \.self) { z in
                    HStack(spacing: 6) {
                        Circle().fill(Self.zustandFarbe[z] ?? .gray).frame(width: 12, height: 12)
                            .overlay(Circle().strokeBorder(Color(hex: 0x202020), lineWidth: 1))
                        Text("\(m.zaehler[z] ?? 0)").font(.grotesk(16, .bold)).monospacedDigit().foregroundStyle(.white)
                        Text(z).font(.grotesk(13)).foregroundStyle(.white.opacity(0.6))
                    }
                    .fixedSize()
                }
                Spacer(minLength: 0)
                Text(EinsatzKartenModell.kmText(m.kmAlle)).font(.grotesk(16, .bold)).monospacedDigit()
                    .foregroundStyle(EinsatzFarbe.lime).fixedSize()
            }
            .padding(.horizontal, 16).frame(height: 44)
            .background(RoundedRectangle(cornerRadius: 12).fill(.black))
        } else {
            Text(m.orteFertig ? "Keine Fahrten an diesem Tag" : "Fahrten werden geladen …")
                .font(.grotesk(13, .medium)).tracking(0.5).foregroundStyle(EinsatzFarbe.lime)
                .frame(maxWidth: .infinity).frame(height: 44)
                .background(RoundedRectangle(cornerRadius: 12).fill(.black))
        }
    }
}

// MARK: - Modell (Plaene, Uhr, Strecken)

@MainActor
final class EinsatzKartenModell: ObservableObject {
    struct Strecke {
        let pfad: [CLLocationCoordinate2D]
        let summen: [Double]
        var laenge: Double { summen.last ?? 0 }
        init(_ pfad: [CLLocationCoordinate2D]) {
            self.pfad = pfad
            var s: [Double] = [0]
            for i in 1..<max(1, pfad.count) { s.append(s[i - 1] + Self.meter(pfad[i - 1], pfad[i])) }
            summen = s
        }
        static func meter(_ a: CLLocationCoordinate2D, _ b: CLLocationCoordinate2D) -> Double {
            func rad(_ g: Double) -> Double { g * .pi / 180 }
            let dLat = rad(b.latitude - a.latitude), dLng = rad(b.longitude - a.longitude)
            let h = pow(sin(dLat / 2), 2) + cos(rad(a.latitude)) * cos(rad(b.latitude)) * pow(sin(dLng / 2), 2)
            return 2 * 6_371_000 * asin(sqrt(h))
        }
    }

    struct Weg { let strecke: Strecke; let minuten: Int }

    struct Abschnitt {
        let art: String          // anfahrt, warten, fahrt, frei
        let von: Double
        let bis: Double
        let a: CLLocationCoordinate2D
        let b: CLLocationCoordinate2D
        let fahrt: EinsatzFahrt?
        var gleich: Bool { a.latitude == b.latitude && a.longitude == b.longitude }
    }

    struct FahrerPlan {
        let id: String
        let name: String
        let nummer: Int?
        let abschnitte: [Abschnitt]
        let beginn: Double
        let ende: Double
        let fahrtBeginne: [Int]
    }

    struct Stand {
        let ort: CLLocationCoordinate2D
        let zustand: String
        let abschnitt: Abschnitt
    }

    struct Anzeige: Equatable {
        let nummer: Int?
        let name: String
        let zustand: String
        let art: String
        let etd: String?
        let ab: String
        let ziel: String
    }

    @Published private(set) var plaene: [FahrerPlan] = []
    @Published private(set) var orteFertig = false
    @Published private(set) var zeitraum = (von: 6 * 60, bis: 22 * 60)
    @Published var minute: Double = 0
    @Published private(set) var laeuft = false
    @Published private(set) var fertig = false
    @Published private(set) var tempo = 1
    @Published var gewaehlt: String? { didSet { takt += 1 } }
    @Published var einpassenSignal = 0
    @Published private(set) var takt = 0

    private(set) var orte: [String: CLLocationCoordinate2D] = [:]
    private var wege: [String: Weg] = [:]
    private var vorschlaege: [EinsatzVorschlag] = []
    private var nummern: [String: Int] = [:]
    private var uhr: Task<Void, Never>?
    private var strecken: [Task<Void, Never>] = []
    private var offen: Set<String> = []
    private var warteschlange: [(schluessel: String, a: CLLocationCoordinate2D, b: CLLocationCoordinate2D, von: Double)] = []
    private var gestartet = false
    private var liefVorZiehen: Bool?
    private var neueWege = 0
    private var buendel: Task<Void, Never>?

    static func kmText(_ km: Double) -> String { "\(einsatzZahl(km, 1)) km" }
    private static func schluessel(_ a: CLLocationCoordinate2D, _ b: CLLocationCoordinate2D) -> String {
        String(format: "%.5f,%.5f>%.5f,%.5f", a.latitude, a.longitude, b.latitude, b.longitude)
    }

    var fahrtStriche: [Double] {
        let spanne = Double(max(1, zeitraum.bis - zeitraum.von))
        return plaene.flatMap { $0.fahrtBeginne.map { Double($0 - zeitraum.von) / spanne } }.filter { $0 >= 0 && $0 <= 1 }
    }

    // MARK: Start

    func starten(vorschlaege: [EinsatzVorschlag], fahrer: [DispoFahrer]) async {
        self.vorschlaege = vorschlaege
        for f in fahrer { if let n = f.driverNumber { nummern[f.id] = n } }
        var adressen: [String] = []
        for v in vorschlaege {
            for r in v.rides {
                for a in [r.adresseAb, r.adresseZiel] where !a.trimmingCharacters(in: .whitespaces).isEmpty && !adressen.contains(a) {
                    adressen.append(a)
                }
            }
        }
        var gefunden: [String: CLLocationCoordinate2D] = [:]
        for a in adressen {
            if Task.isCancelled { return }
            if let p = await Routen.punkt(fuer: a) { gefunden[a] = p }
        }
        orte = gefunden
        orteFertig = true
        planeBauen()
        einpassenSignal += 1
        if !plaene.isEmpty && !gestartet {
            gestartet = true
            minute = Double(zeitraum.von)
            takt += 1
            try? await Task.sleep(for: .milliseconds(900))
            if !Task.isCancelled { laufen(true) }
        }
        streckenLaden()
    }

    func anhalten() {
        uhr?.cancel()
        strecken.forEach { $0.cancel() }
        buendel?.cancel()
    }

    // MARK: Plaene (planBauen)

    private func dauer(_ a: CLLocationCoordinate2D, _ b: CLLocationCoordinate2D) -> Double {
        if let w = wege[Self.schluessel(a, b)] { return Double(w.minuten) }
        return Double(max(4, Int(((Strecke.meter(a, b) * 1.35) / 1000 / 30 * 60).rounded())))
    }

    private func planeBauen() {
        plaene = vorschlaege.compactMap { v -> FahrerPlan? in
            let fahrten = v.rides.compactMap { r -> (EinsatzFahrt, Int, CLLocationCoordinate2D, CLLocationCoordinate2D)? in
                guard let etd = EinsatzUhr.minuten(r.etd),
                      let ab = orte[r.adresseAb] ?? orte[r.pickup], let ziel = orte[r.adresseZiel] ?? orte[r.dropoff] else { return nil }
                return (r, etd, ab, ziel)
            }.sorted { $0.1 < $1.1 }
            guard let erste = fahrten.first else { return nil }
            let beginn = Double(v.startMinutes)
            var abschnitte: [Abschnitt] = []
            var ort = erste.2
            var zeit = beginn
            for (f, etd, ab, ziel) in fahrten {
                if Strecke.meter(ort, ab) > 60 {
                    let d = dauer(ort, ab)
                    abschnitte.append(Abschnitt(art: "anfahrt", von: zeit, bis: zeit + d, a: ort, b: ab, fahrt: f))
                    zeit += d
                }
                let start = max(zeit, Double(etd))
                if start > zeit { abschnitte.append(Abschnitt(art: "warten", von: zeit, bis: start, a: ab, b: ab, fahrt: f)) }
                let fz = wege[Self.schluessel(ab, ziel)].map { Double($0.minuten) } ?? (f.durationMinutes.flatMap { $0 > 0 ? $0 : nil } ?? 25)
                abschnitte.append(Abschnitt(art: "fahrt", von: start, bis: start + fz, a: ab, b: ziel, fahrt: f))
                zeit = start + fz
                ort = ziel
            }
            let ende = max(Double(v.endMinutes), zeit)
            if ende > zeit { abschnitte.append(Abschnitt(art: "frei", von: zeit, bis: ende, a: ort, b: ort, fahrt: nil)) }
            return FahrerPlan(id: v.driverId.isEmpty ? v.id : v.driverId, name: v.name, nummer: nummern[v.driverId],
                              abschnitte: abschnitte, beginn: beginn, ende: ende, fahrtBeginne: fahrten.map(\.1))
        }
        if !plaene.isEmpty {
            let von = plaene.map(\.beginn).min() ?? 360, bis = plaene.map(\.ende).max() ?? 1320
            zeitraum = (Int((von / 30).rounded(.down)) * 30, Int((bis / 30).rounded(.up)) * 30)
        }
        takt += 1
    }

    // MARK: Stand je Minute (standBei, kmBis)

    func stand(_ p: FahrerPlan, _ minute: Double) -> Stand? {
        guard minute >= p.beginn, minute <= p.ende, let letzter = p.abschnitte.last else { return nil }
        let s = p.abschnitte.first { minute >= $0.von && minute <= $0.bis } ?? letzter
        let zustand = ["warten": "inaktiv", "anfahrt": "inaktiv", "fahrt": "aktiv", "frei": "frei"][s.art] ?? "frei"
        if s.gleich || s.art == "warten" || s.art == "frei" { return Stand(ort: s.a, zustand: zustand, abschnitt: s) }
        let strecke = wege[Self.schluessel(s.a, s.b)]?.strecke ?? Strecke([s.a, s.b])
        let anteil = (minute - s.von) / max(0.001, s.bis - s.von)
        return Stand(ort: punkt(strecke, anteil), zustand: zustand, abschnitt: s)
    }

    private func punkt(_ s: Strecke, _ anteil: Double) -> CLLocationCoordinate2D {
        guard s.pfad.count > 1, s.laenge > 0 else { return s.pfad.first ?? CLLocationCoordinate2D() }
        let ziel = max(0, min(1, anteil)) * s.laenge
        var i = 1
        while i < s.summen.count - 1 && s.summen[i] < ziel { i += 1 }
        let a = s.pfad[i - 1], b = s.pfad[i]
        let f = (ziel - s.summen[i - 1]) / max(1e-6, s.summen[i] - s.summen[i - 1])
        return CLLocationCoordinate2D(latitude: a.latitude + (b.latitude - a.latitude) * f, longitude: a.longitude + (b.longitude - a.longitude) * f)
    }

    func km(_ p: FahrerPlan, _ minute: Double) -> Double {
        guard minute > p.beginn else { return 0 }
        var meter = 0.0
        for s in p.abschnitte where (s.art == "fahrt" || s.art == "anfahrt") && !s.gleich && minute > s.von {
            let laenge = wege[Self.schluessel(s.a, s.b)]?.strecke.laenge ?? Strecke.meter(s.a, s.b) * 1.35
            meter += laenge * min(1, (minute - s.von) / max(0.001, s.bis - s.von))
        }
        return meter / 1000
    }

    var zaehler: [String: Int] {
        var z = ["aktiv": 0, "inaktiv": 0, "frei": 0]
        for p in plaene { if let s = stand(p, minute) { z[s.zustand, default: 0] += 1 } }
        return z
    }
    var kmAlle: Double { plaene.reduce(0) { $0 + km($1, minute) } }
    var kmFahrer: Double { plaene.first { $0.id == gewaehlt }.map { km($0, minute) } ?? 0 }

    var anzeige: Anzeige? {
        guard let id = gewaehlt, let p = plaene.first(where: { $0.id == id }), let s = stand(p, minute) else { return nil }
        let f = s.abschnitt.fahrt
        func kurz(_ t: String) -> String { t.split(separator: ",").first.map { $0.trimmingCharacters(in: .whitespaces) } ?? "" }
        return Anzeige(nummer: p.nummer, name: p.name, zustand: s.zustand, art: s.abschnitt.art, etd: f?.etd,
                       ab: kurz(f.map { $0.pickup.isEmpty ? $0.adresseAb : $0.pickup } ?? ""),
                       ziel: kurz(f.map { $0.dropoff.isEmpty ? $0.adresseZiel : $0.dropoff } ?? ""))
    }

    /// Strecke des gewaehlten Fahrers: blau mit Gast, gelb gestrichelt zum Gast.
    var auswahlStrecke: (art: String, pfad: [CLLocationCoordinate2D])? {
        guard let id = gewaehlt, let p = plaene.first(where: { $0.id == id }), let s = stand(p, minute),
              s.abschnitt.art == "fahrt" || s.abschnitt.art == "anfahrt", !s.abschnitt.gleich else { return nil }
        return (s.abschnitt.art, wege[Self.schluessel(s.abschnitt.a, s.abschnitt.b)]?.strecke.pfad ?? [s.abschnitt.a, s.abschnitt.b])
    }

    // MARK: Uhr

    private func laufen(_ an: Bool) {
        laeuft = an
        uhr?.cancel()
        guard an else { return }
        uhr = Task { [weak self] in
            var zuletzt = Date()
            while !Task.isCancelled {
                try? await Task.sleep(for: .milliseconds(33))
                guard let self, !Task.isCancelled else { return }
                let jetzt = Date()
                let dt = min(0.1, jetzt.timeIntervalSince(zuletzt))
                zuletzt = jetzt
                let naechste = self.minute + dt * 6 * Double(self.tempo)
                if naechste >= Double(self.zeitraum.bis) {
                    self.minute = Double(self.zeitraum.bis)
                    self.takt += 1
                    self.laeuft = false
                    self.fertig = true
                    return
                }
                self.minute = naechste
                self.takt += 1
            }
        }
    }

    func abspielen() {
        if fertig {
            minute = Double(zeitraum.von)
            fertig = false
            takt += 1
        }
        laufen(!laeuft)
    }

    func tempoWechseln() {
        let t = [1, 2, 4]
        tempo = t[((t.firstIndex(of: tempo) ?? 0) + 1) % t.count]
    }

    /// Zeitleiste ziehen: waehrend des Ziehens steht die Uhr.
    func ziehen(anteil: Double) {
        if liefVorZiehen == nil {
            liefVorZiehen = laeuft
            laufen(false)
            fertig = false
        }
        minute = Double(zeitraum.von) + max(0, min(1, anteil)) * Double(zeitraum.bis - zeitraum.von)
        takt += 1
    }

    func ziehenEnde() {
        if liefVorZiehen == true { laufen(true) }
        liefVorZiehen = nil
    }

    func waehlen(_ id: String?) { gewaehlt = (id == nil || gewaehlt == id) ? nil : id }

    // MARK: Strecken nachladen (zwei gleichzeitig, kurze Pause, was bald gefahren wird zuerst)

    private func streckenLaden() {
        var alle: [String: (String, CLLocationCoordinate2D, CLLocationCoordinate2D, Double)] = [:]
        for p in plaene {
            for s in p.abschnitte where (s.art == "anfahrt" || s.art == "fahrt") && !s.gleich {
                let k = Self.schluessel(s.a, s.b)
                if wege[k] == nil && !offen.contains(k) && alle[k] == nil { alle[k] = (k, s.a, s.b, s.von) }
            }
        }
        warteschlange = alle.values.map { (schluessel: $0.0, a: $0.1, b: $0.2, von: $0.3) }
        guard !warteschlange.isEmpty else { return }
        warteschlange.forEach { offen.insert($0.schluessel) }
        strecken = (0..<2).map { _ in
            Task { [weak self] in
                while let self, !Task.isCancelled, let e = self.naechste() {
                    let s = await Routen.strecke(von: e.a, bis: e.b)
                    self.offen.remove(e.schluessel)
                    if !s.notloesung && s.punkte.count >= 2 {
                        self.wege[e.schluessel] = Weg(strecke: Strecke(s.punkte), minuten: max(3, Int((Double(s.sekunden) / 60).rounded())))
                        self.neueWege += 1
                        self.melden()
                    }
                    try? await Task.sleep(for: .milliseconds(220))
                }
            }
        }
    }

    private func naechste() -> (schluessel: String, a: CLLocationCoordinate2D, b: CLLocationCoordinate2D, von: Double)? {
        guard !warteschlange.isEmpty else { return nil }
        let jetzt = minute
        func rang(_ von: Double) -> Double { von < jetzt - 20 ? 10_000 + von : abs(von - jetzt) }
        warteschlange.sort { rang($0.von) < rang($1.von) }
        return warteschlange.removeFirst()
    }

    /// Neue Strecken gebuendelt alle 700 ms in die Plaene uebernehmen.
    private func melden() {
        guard buendel == nil else { return }
        buendel = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(700))
            guard let self, !Task.isCancelled else { return }
            self.buendel = nil
            if self.neueWege > 0 { self.neueWege = 0; self.planeBauen() }
        }
    }
}

// MARK: - Karte

private struct EinsatzKarteFlaeche: UIViewRepresentable {
    let modell: EinsatzKartenModell
    let takt: Int
    let einpassen: Int

    func makeCoordinator() -> Koordinator { Koordinator(modell: modell) }

    func makeUIView(context: Context) -> MLNMapView {
        let karte = MLNMapView(frame: .zero, styleURL: DispoKarte.stil)
        karte.setCenter(CLLocationCoordinate2D(latitude: 48.137154, longitude: 11.576124), zoomLevel: 10, animated: false)
        karte.logoView.isHidden = true
        karte.attributionButton.alpha = 0.4
        karte.compassView.isHidden = true
        karte.allowsRotating = false
        karte.allowsTilting = false
        karte.delegate = context.coordinator
        context.coordinator.karte = karte
        let tipp = UITapGestureRecognizer(target: context.coordinator, action: #selector(Koordinator.getippt(_:)))
        karte.addGestureRecognizer(tipp)
        return karte
    }

    func updateUIView(_ karte: MLNMapView, context: Context) {
        context.coordinator.zeichnen()
        if context.coordinator.eingepasst != einpassen {
            context.coordinator.eingepasst = einpassen
            context.coordinator.einpassen()
        }
    }

    final class Koordinator: NSObject, MLNMapViewDelegate {
        let modell: EinsatzKartenModell
        weak var karte: MLNMapView?
        var eingepasst = 0
        private var stilDa = false
        private var punkte: [String: EinsatzFahrerPunkt] = [:]

        init(modell: EinsatzKartenModell) { self.modell = modell }

        func mapView(_ mapView: MLNMapView, didFinishLoading style: MLNStyle) {
            stilDa = true
            MainActor.assumeIsolated {
                zeichnen()
                einpassen()
            }
        }

        /// fitBounds ueber alle Orte; oben Knoepfe und Zeitleiste, unten die Navigation frei.
        @MainActor func einpassen() {
            guard let karte, let erster = modell.orte.values.first else { return }
            guard karte.bounds.width > 10 else {
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) { [weak self] in self?.einpassen() }
                return
            }
            var sw = erster, ne = erster
            for p in modell.orte.values {
                sw.latitude = min(sw.latitude, p.latitude); sw.longitude = min(sw.longitude, p.longitude)
                ne.latitude = max(ne.latitude, p.latitude); ne.longitude = max(ne.longitude, p.longitude)
            }
            karte.setVisibleCoordinateBounds(MLNCoordinateBounds(sw: sw, ne: ne),
                                             edgePadding: UIEdgeInsets(top: 250, left: 32, bottom: 200, right: 32), animated: true, completionHandler: nil)
        }

        @MainActor func zeichnen() {
            guard let karte, stilDa else { return }
            let minute = modell.minute
            let auswahl = modell.gewaehlt
            var gesehen = Set<String>()
            for p in modell.plaene {
                guard let s = modell.stand(p, minute) else { continue }
                gesehen.insert(p.id)
                let punkt: EinsatzFahrerPunkt
                if let vorhanden = punkte[p.id] {
                    punkt = vorhanden
                } else {
                    punkt = EinsatzFahrerPunkt(id: p.id, nummer: p.nummer.map(String.init) ?? "?")
                    punkte[p.id] = punkt
                }
                punkt.coordinate = s.ort
                punkt.zustand = s.zustand
                punkt.blass = auswahl != nil && auswahl != p.id
                punkt.oben = auswahl == p.id ? 2000 : (s.zustand == "aktiv" ? 1200 : 1000)
                if karte.annotations?.contains(where: { $0 === punkt }) != true { karte.addAnnotation(punkt) }
                (karte.view(for: punkt) as? EinsatzPinAnsicht)?.anwenden(punkt)
            }
            for (id, punkt) in punkte where !gesehen.contains(id) {
                karte.removeAnnotation(punkt)
                punkte[id] = nil
            }
            linie(modell.auswahlStrecke)
        }

        private func linie(_ strecke: (art: String, pfad: [CLLocationCoordinate2D])?) {
            guard let stil = karte?.style else { return }
            for (kennung, art) in [("ek-fahrt", "fahrt"), ("ek-anfahrt", "anfahrt")] {
                var form: MLNPolylineFeature?
                if let s = strecke, s.art == art, s.pfad.count >= 2 {
                    var k = s.pfad
                    form = MLNPolylineFeature(coordinates: &k, count: UInt(k.count))
                }
                if let quelle = stil.source(withIdentifier: kennung) as? MLNShapeSource {
                    quelle.shape = form
                    continue
                }
                let quelle = MLNShapeSource(identifier: kennung, shape: form, options: nil)
                stil.addSource(quelle)
                let ebene = MLNLineStyleLayer(identifier: kennung, source: quelle)
                ebene.lineColor = NSExpression(forConstantValue: art == "fahrt" ? UIColor(hex: 0x0059FF) : UIColor(hex: 0xE3F654))
                ebene.lineWidth = NSExpression(forConstantValue: art == "fahrt" ? 6 : 5)
                ebene.lineCap = NSExpression(forConstantValue: "round")
                ebene.lineJoin = NSExpression(forConstantValue: "round")
                if art == "anfahrt" { ebene.lineDashPattern = NSExpression(forConstantValue: [0.8, 1.6]) }
                stil.addLayer(ebene)
            }
        }

        func mapView(_ mapView: MLNMapView, viewFor annotation: MLNAnnotation) -> MLNAnnotationView? {
            guard let p = annotation as? EinsatzFahrerPunkt else { return nil }
            let v = EinsatzPinAnsicht()
            v.anwenden(p)
            return v
        }

        func mapView(_ mapView: MLNMapView, annotationCanShowCallout annotation: MLNAnnotation) -> Bool { false }

        /// Tipp auf einen Fahrer waehlt ihn (nochmal = abwaehlen), Tipp daneben hebt die Auswahl auf.
        @MainActor @objc func getippt(_ g: UITapGestureRecognizer) {
            guard let karte else { return }
            let stelle = g.location(in: karte)
            let treffer = punkte.values.filter { p in
                guard let v = karte.view(for: p), !v.isHidden else { return false }
                return v.frame.insetBy(dx: -4, dy: -4).contains(stelle)
            }
            .max { $0.oben < $1.oben }
            modell.waehlen(treffer?.id)
        }
    }
}

final class EinsatzFahrerPunkt: MLNPointAnnotation {
    let id: String
    let nummer: String
    var zustand = "frei"
    var blass = false
    var oben: CGFloat = 1000
    init(id: String, nummer: String) { self.id = id; self.nummer = nummer; super.init() }
    required init?(coder: NSCoder) { fatalError() }
}

/// Fahrer-Pin 35 x 41,14 nach Zustand (rot aktiv, gelb inaktiv, gruen frei) mit Nummer im Kopf.
private final class EinsatzPinAnsicht: MLNAnnotationView {
    private let bild = UIImageView()
    private let nummer = UILabel()
    private var name = ""

    init() {
        super.init(reuseIdentifier: nil)
        frame = CGRect(x: 0, y: 0, width: 35, height: 41.1367)
        bild.frame = bounds
        addSubview(bild)
        nummer.frame = CGRect(x: 0, y: 17.5 - 12, width: 35, height: 24)
        nummer.textAlignment = .center
        nummer.textColor = UIColor(hex: 0x1A1A1A)
        nummer.font = WebText.schrift(15, .bold)
        addSubview(nummer)
        centerOffset = CGVector(dx: 0, dy: -41.1367 / 2)
        isUserInteractionEnabled = false
    }
    required init?(coder: NSCoder) { fatalError() }

    func anwenden(_ p: EinsatzFahrerPunkt) {
        let neu = ["aktiv": "Fahrer_Pin_Trisar_01_rot", "inaktiv": "Fahrer_Pin_Trisar_01_gelb"][p.zustand] ?? "Fahrer_Pin_Trisar_01_gruen"
        if neu != name { name = neu; bild.image = UIImage(named: neu) }
        nummer.text = p.nummer
        alpha = p.blass ? 0.3 : 1
        layer.zPosition = p.oben
    }
}
