import CoreLocation
import MapLibre
import SwiftUI
import UIKit

/// Fahrt-Simulation (FahrtSimulationView.jsx): Tagesansicht eines Planer-Vorschlags. Spielt die
/// geplante Route des Fahrers im Zeitraffer auf der echten Karte ab.
/// Abweichung vom Web: Orte und Strecken kommen wie ueberall in der App ueber Nominatim und OSRM
/// (Routen.swift) statt ueber TomTom, einen TomTom-Schluessel hat die App nicht.

// MARK: - Eingabe (entry)

/// Eine Fahrt des Vorschlags (entry.rides).
struct NebenSimFahrt: Equatable {
    var etd: String
    var pickup: String
    var dropoff: String
    /// Echte Fahrzeit inkl. Stauprognose, nil = Annahme aus den Planungsregeln.
    var durationMinutes: Double?

    init(etd: String, pickup: String, dropoff: String, durationMinutes: Double? = nil) {
        self.etd = etd
        self.pickup = pickup
        self.dropoff = dropoff
        self.durationMinutes = durationMinutes
    }
}

/// Ladestopp aus dem Fahrzeugplan (entry.chargeStops, Zeiten als ISO-Text).
struct NebenSimLadestopp: Equatable {
    var start: String
    var end: String
    var stationName = ""
    var kmGained: Double = 0
}

/// Vorschlag eines Fahrers fuer einen Tag (entry im Web).
struct NebenSimEintrag: Equatable {
    var dayIso: String
    var driverId: String
    var name: String
    /// Dienst "HH:MM".
    var start: String
    var end: String
    var rides: [NebenSimFahrt]
    var chargeStops: [NebenSimLadestopp] = []
    /// settings.rideDurationMinutes als Rueckfall.
    var rideDurationMinutes: Double?
    var vehicleId = ""
    var vehicleIsEv = false
    var vehicleLabel = ""
    var shiftKm: Int?
}

// MARK: - Ansicht

struct FahrtSimulationAnsicht: View {
    let entry: NebenSimEintrag
    let zurueck: () -> Void

    init(entry: NebenSimEintrag, zurueck: @escaping () -> Void) {
        self.entry = entry
        self.zurueck = zurueck
        _simMin = State(initialValue: Double(Self.uhrZuMin(entry.start) ?? 360))
    }

    private static let lime = Color(hex: 0xE3F754)
    private static let tempi = [1.0, 2.0, 4.0]

    @State private var telefon = ""
    @State private var fahrerNummer = ""
    // Startet pausiert, erst Play (oder der Selbststart) laesst die Uhr laufen.
    @State private var spielt = false
    @State private var gestartet = false
    @State private var fertig = false
    @State private var tempo = 2.0
    @State private var simMin: Double
    @State private var route: SimRoute?
    @State private var routeStatus = "laedt"
    @State private var routeNr = 0
    @State private var modell: SimEvModell?
    @State private var akkuStart: Double = 100
    @State private var tempC: Double?
    @State private var ziehtVorher: Bool?

    // MARK: Plan

    private struct PlanFahrtSim { let nr: Int; let etd: String; let von: String; let nach: String; let startMin: Double; let endMin: Double }
    private struct PlanLaden { let startMin: Double; let endMin: Double; let station: String; let kmGained: Double }

    static func uhrZuMin(_ text: String?) -> Int? {
        let t = (text ?? "").trimmingCharacters(in: .whitespaces)
        guard let m = t.range(of: #"^\d{1,2}:\d{2}"#, options: .regularExpression) else { return nil }
        let teile = t[m].split(separator: ":").compactMap { Int($0) }
        return teile.count == 2 ? teile[0] * 60 + teile[1] : nil
    }

    static func minZuUhr(_ min: Double) -> String {
        let m = Swift.max(0, Int(min.rounded()))
        return String(format: "%02d:%02d", (m / 60) % 24, m % 60)
    }

    private var fahrten: [PlanFahrtSim] {
        entry.rides.enumerated().compactMap { i, r -> PlanFahrtSim? in
            guard let s = Self.uhrZuMin(r.etd) else { return nil }
            let dauer = (r.durationMinutes ?? 0) > 0 ? r.durationMinutes! : ((entry.rideDurationMinutes ?? 0) > 0 ? entry.rideDurationMinutes! : 80)
            return PlanFahrtSim(nr: i + 1, etd: r.etd, von: r.pickup, nach: r.dropoff, startMin: Double(s), endMin: Double(s) + dauer)
        }
        .sorted { $0.startMin < $1.startMin }
    }

    private var laden: [PlanLaden] {
        entry.chargeStops.compactMap { c in
            guard let a = Self.ortsMinuten(c.start), let b = Self.ortsMinuten(c.end), b > a else { return nil }
            return PlanLaden(startMin: a, endMin: b, station: c.stationName.trimmingCharacters(in: .whitespaces), kmGained: c.kmGained)
        }
    }

    /// new Date(text).getHours()*60 + getMinutes() in Ortszeit.
    private static func ortsMinuten(_ text: String) -> Double? {
        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        var d = iso.date(from: text)
        if d == nil { iso.formatOptions = [.withInternetDateTime]; d = iso.date(from: text) }
        if d == nil {
            let f = DateFormatter()
            f.locale = Locale(identifier: "en_US_POSIX")
            f.dateFormat = "yyyy-MM-dd'T'HH:mm:ss"
            d = f.date(from: String(text.prefix(19)))
        }
        guard let d else { return nil }
        let k = Calendar.current.dateComponents([.hour, .minute], from: d)
        return Double((k.hour ?? 0) * 60 + (k.minute ?? 0))
    }

    /// Leerfahrtminuten = Luecken zwischen den Fahrten, Ladezeit zaehlt nicht.
    private var leerMinutenPlan: Double {
        let r = fahrten
        var leer = 0.0
        if r.count > 1 { for i in 1..<r.count { leer += Swift.max(0, r[i].startMin - r[i - 1].endMin) } }
        for c in laden { leer = Swift.max(0, leer - (c.endMin - c.startMin)) }
        return leer
    }

    private var dienstStart: Double { Double(Self.uhrZuMin(entry.start) ?? 360) }
    private var dienstEnde: Double { Double(Self.uhrZuMin(entry.end) ?? Int(dienstStart) + 480) }
    private var simStart: Double { route?.legs.first?.vonMin ?? dienstStart }
    private var simEnde: Double {
        if let route, let e = route.endeMin { return Swift.max(e, simStart + 30) }
        return dienstEnde
    }

    // MARK: Zustand zur Simulationszeit

    private func aktiverAbschnitt(_ legs: [SimAbschnitt]) -> Int {
        if let i = legs.firstIndex(where: { simMin >= $0.vonMin && simMin <= $0.bisMin }) { return i }
        if let i = legs.firstIndex(where: { simMin < $0.vonMin }) { return i }
        return legs.count - 1
    }

    /// Rot mit Gast, gelb auf Leerfahrt, gruen beim Laden.
    private var zustand: String {
        if laden.contains(where: { simMin >= $0.startMin && simMin <= $0.endMin }) { return "laden" }
        guard let route else { return "leer" }
        return route.legs.first(where: { simMin >= $0.vonMin && simMin <= $0.bisMin })?.gast == true ? "gast" : "leer"
    }

    private var punkt: CLLocationCoordinate2D? {
        guard let route, !route.legs.isEmpty else { return nil }
        let leg = route.legs[aktiverAbschnitt(route.legs)]
        let p = Swift.max(0, Swift.min(1, (simMin - leg.vonMin) / Swift.max(1, leg.bisMin - leg.vonMin)))
        return Self.punktAufLinie(leg.pts, p)
    }

    private enum Aktiv { case gast(PlanFahrtSim, Double, Double), laden(PlanLaden), leer }

    private var aktiv: Aktiv {
        if let l = laden.first(where: { simMin >= $0.startMin && simMin <= $0.endMin }) { return .laden(l) }
        let r = fahrten
        if let route {
            // Abschnitte wechseln: gerade = Gastfahrt k, ungerade = Leerfahrt danach.
            if let i = route.legs.firstIndex(where: { simMin >= $0.vonMin && simMin <= $0.bisMin }), route.legs[i].gast,
               i / 2 < route.fahrtIndex.count, route.fahrtIndex[i / 2] < r.count {
                return .gast(r[route.fahrtIndex[i / 2]], route.legs[i].vonMin, route.legs[i].bisMin)
            }
            return .leer
        }
        if let f = r.first(where: { simMin >= $0.startMin && simMin <= $0.endMin }) { return .gast(f, f.startMin, f.endMin) }
        return .leer
    }

    /// Kamera: vor dem Start und nach dem Ende der ganze Tag (-1), sonst die aktuelle Fahrt.
    private var kameraZiel: Int? {
        guard let route, !route.legs.isEmpty else { return nil }
        if !gestartet || fertig { return -1 }
        return aktiverAbschnitt(route.legs) / 2
    }

    /// Ladestand beim Start jeder Fahrt aus den echten Streckenkilometern.
    private var ladestaende: [Int: Int]? {
        guard entry.vehicleIsEv, let route, let modell else { return nil }
        var werte: [Int: Int] = [:]
        var prozent = akkuStart
        for (i, leg) in route.legs.enumerated() {
            if leg.gast { werte[i / 2] = Int(Swift.max(0, Swift.min(100, prozent)).rounded()) }
            prozent -= modell.prozentVerbraucht(tempC, leg.km, leg.bisMin - leg.vonMin)
            for c in laden where c.endMin > leg.vonMin && c.endMin <= leg.bisMin {
                let zuwachs = c.kmGained > 0 ? modell.prozentVerbraucht(tempC, c.kmGained, c.kmGained) : 40
                prozent = Swift.min(100, prozent + zuwachs)
            }
        }
        return werte
    }

    private func ladeFarbe(_ p: Int) -> Color { Color(hex: p >= 40 ? 0x2E8B45 : p >= 20 ? 0xC07A10 : 0xC0392B) }

    private func kmText(_ km: Double) -> String {
        let f = NumberFormatter()
        f.locale = Locale(identifier: "de_DE")
        f.numberStyle = .decimal
        f.minimumFractionDigits = 1
        f.maximumFractionDigits = 1
        return "\(f.string(from: NSNumber(value: km)) ?? "0,0") km"
    }

    /// Adresse wie auf den Vorschlagskarten: "Strasse Nr, PLZ".
    private static func kurzeAdresse(_ text: String) -> String {
        let teile = text.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
        if let i = teile.firstIndex(where: { $0.range(of: #"^\d{5}\b"#, options: .regularExpression) != nil }), i > 0 {
            return "\(teile[i - 1]), \(teile[i].prefix(5))"
        }
        return teile.first ?? ""
    }

    // MARK: Ansicht

    var body: some View {
        GeometryReader { geo in
            let s = Swift.min(geo.size.width / 402, geo.size.height / 874, 1)
            let rasterHoehe = geo.size.height / Swift.max(s, 0.01)
            ZStack(alignment: .topLeading) {
                NebenSimKarte(route: route, routeNr: routeNr, punkt: punkt, zustand: zustand,
                              nummer: fahrerNummer, kameraZiel: kameraZiel, massstab: s)
                    .ignoresSafeArea()
                ZStack(alignment: .topLeading) {
                    bedienung(rasterHoehe: rasterHoehe)
                }
                .frame(width: 402, height: rasterHoehe, alignment: .topLeading)
                .scaleEffect(s, anchor: .topLeading)
                .frame(width: 402 * s, height: geo.size.height, alignment: .topLeading)
                .frame(maxWidth: .infinity)
                FussleisteUnten()
            }
        }
        .ignoresSafeArea()
        .background(Color.black.ignoresSafeArea())
        .task(id: entry.driverId) { await profilLaden() }
        .task(id: entry.vehicleId) { await fahrzeugLaden() }
        .task(id: entry.dayIso) { tempC = await SimEvModell.tagesTemperatur(entry.dayIso) }
        .task(id: entry) { await routeLaden() }
        .task(id: spielt) { await uhrLaufen() }
    }

    @ViewBuilder
    private func bedienung(rasterHoehe: CGFloat) -> some View {
        Button(action: zurueck) {
            Image("Backbutton_Karte").resizable().scaledToFit()
                .frame(width: 50, height: 50).background(Color.black).clipShape(Circle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Zurück")
        .platz(20, 60, 50, 50)

        Text(NebenRisiko.datumText(entry.dayIso)).font(.grotesk(16, .bold)).tracking(0.5).foregroundStyle(Self.lime)
            .lineLimit(1).fixedSize()
            .padding(.horizontal, 18).frame(height: 50)
            .background(Capsule().fill(Color.black))
            .frame(width: 362, alignment: .trailing)
            .platz(20, 60, 362, 50)

        zeitleiste.mittig(201, 142, 362, 44)

        statusKarte.mittig(201, 194, 362)

        fahrerKarte
            .frame(width: 362)
            .frame(width: 402, height: rasterHoehe - 60, alignment: .bottom)
    }

    // MARK: Zeitleiste

    private var zeitleiste: some View {
        let spanne = Swift.max(1, simEnde - simStart)
        let anteil = { (m: Double) -> CGFloat in CGFloat(Swift.max(0, Swift.min(1, (m - simStart) / spanne))) }
        let bereit = route != nil
        return HStack(spacing: 0) {
            Button {
                if fertig {
                    // Nach dem Durchlauf startet Play die Simulation neu.
                    simMin = simStart
                    fertig = false
                }
                gestartet = true
                spielt.toggle()
            } label: {
                Group {
                    if spielt {
                        HStack(spacing: 4) {
                            RoundedRectangle(cornerRadius: 1).fill(Self.lime).frame(width: 3.4, height: 14)
                            RoundedRectangle(cornerRadius: 1).fill(Self.lime).frame(width: 3.4, height: 14)
                        }
                    } else if fertig {
                        Image(systemName: "arrow.counterclockwise").font(.system(size: 14, weight: .bold)).foregroundStyle(Self.lime)
                    } else {
                        Image(systemName: "play.fill").font(.system(size: 13)).foregroundStyle(Self.lime).padding(.leading, 2)
                    }
                }
                .frame(width: 32, height: 32).contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(!bereit)
            .opacity(bereit ? 1 : 0.3)
            .accessibilityLabel(spielt ? "Pause" : "Abspielen")

            Text(Self.minZuUhr(simMin)).font(.grotesk(16, .bold)).monospacedDigit().foregroundStyle(.white)
                .frame(width: 54, alignment: .leading)

            GeometryReader { g in
                let b = g.size.width
                ZStack(alignment: .leading) {
                    Capsule().fill(Color.white.opacity(0.2)).frame(height: 2)
                    ForEach(Array(fahrten.enumerated()), id: \.offset) { _, f in
                        Rectangle().fill(Color.white.opacity(0.25)).frame(width: 1, height: 8)
                            .position(x: anteil(f.startMin) * b, y: g.size.height / 2)
                    }
                    Capsule().fill(Self.lime).frame(width: b * anteil(simMin), height: 2)
                    Circle().fill(Self.lime).frame(width: 12, height: 12)
                        .overlay(Circle().stroke(Color(hex: 0x202020), lineWidth: 1))
                        .background(Circle().fill(Color(hex: 0xE3F654, alpha: 0.18)).frame(width: 18, height: 18))
                        .position(x: anteil(simMin) * b, y: g.size.height / 2)
                }
                .frame(width: b, height: g.size.height)
                .contentShape(Rectangle())
                .gesture(DragGesture(minimumDistance: 0)
                    .onChanged { z in
                        guard b > 0 else { return }
                        if ziehtVorher == nil {
                            ziehtVorher = spielt
                            spielt = false
                            gestartet = true
                            fertig = false
                        }
                        let a = Swift.max(0, Swift.min(1, z.location.x / b))
                        simMin = simStart + Double(a) * (simEnde - simStart)
                    }
                    .onEnded { _ in
                        if ziehtVorher == true { spielt = true }
                        ziehtVorher = nil
                    })
            }
            .padding(.horizontal, 8)
            .accessibilityLabel("Simulationszeit ziehen")

            Button {
                let i = Self.tempi.firstIndex(of: tempo) ?? 0
                tempo = Self.tempi[(i + 1) % Self.tempi.count]
            } label: {
                Text("\(Int(tempo))x").font(.grotesk(16, .bold)).monospacedDigit().foregroundStyle(Self.lime)
                    .frame(width: 40, height: 32).contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Tempo \(Int(tempo))x")
        }
        .padding(.leading, 8).padding(.trailing, 6)
        .frame(width: 362, height: 44)
        .background(RoundedRectangle(cornerRadius: 12).fill(Color.black))
    }

    // MARK: Karten oben und unten

    @ViewBuilder
    private var statusKarte: some View {
        if let route {
            let r = fahrten
            let naechste = r.first { $0.startMin >= simMin }
            let a = aktiv
            let kmBisher = route.legs.reduce(0.0) { summe, l in
                if simMin >= l.bisMin { return summe + l.km }
                if simMin <= l.vonMin { return summe }
                return summe + l.km * ((simMin - l.vonMin) / Swift.max(1, l.bisMin - l.vonMin))
            }
            let aktivIndex: Int? = { if case .gast(let f, _, _) = a { return r.firstIndex { $0.nr == f.nr } }; return nil }()
            let akku = !fertig ? aktivIndex.flatMap { ladestaende?[$0] } : nil
            let farbe: Color = zustand == "gast" ? Color(hex: 0xFF6F63) : zustand == "laden" ? Color(hex: 0x59BE80) : Color(hex: 0xE3F654)
            VStack(alignment: .leading, spacing: 0) {
                HStack(spacing: 10) {
                    Circle().fill(farbe).frame(width: 12, height: 12)
                        .overlay(Circle().stroke(Color(hex: 0x202020), lineWidth: 1))
                        .animation(.easeInOut(duration: 0.3), value: zustand)
                    Group {
                        if fertig {
                            Text("Simulation beendet")
                        } else if case .gast(let f, let von, let bis) = a {
                            Text("#\(f.nr) \(Self.minZuUhr(von)) – \(Self.minZuUhr(bis))")
                        } else if case .laden = a {
                            Text(entry.vehicleIsEv ? "Ladestopp" : "Tankstopp")
                        } else if let n = naechste {
                            Text("Anfahrt #\(n.nr)")
                        } else {
                            Text("frei")
                        }
                    }
                    .font(.grotesk(16, .bold)).foregroundStyle(.white).lineLimit(1)
                    if let akku {
                        Text("\(akku) %").font(.grotesk(13, .bold)).monospacedDigit().foregroundStyle(ladeFarbe(akku))
                    }
                    Spacer(minLength: 0)
                    Text(kmText(kmBisher)).font(.grotesk(16, .bold)).monospacedDigit().foregroundStyle(Self.lime).fixedSize()
                }
                Group {
                    if fertig {
                        Text("\(r.count) Fahrten · \(Int(leerGesamt.rounded())) min Leerfahrt")
                    } else if case .gast(let f, _, _) = a {
                        Text("\(Self.kurzeAdresse(f.von).nilWennLeer ?? f.von) – \(Self.kurzeAdresse(f.nach).nilWennLeer ?? f.nach)")
                    } else if case .laden(let l) = a {
                        Text(l.station)
                    } else if let n = naechste {
                        Text("\(n.etd) Uhr").bold().foregroundColor(.white)
                            + Text(" · \(Self.kurzeAdresse(n.von).nilWennLeer ?? n.von)")
                    } else {
                        Text("Bereitschaft / Leerfahrt")
                    }
                }
                .font(.grotesk(13)).foregroundStyle(.white.opacity(0.6)).lineLimit(1)
                .frame(height: 18)
                .padding(.top, 8).padding(.leading, 22)
            }
            .padding(.horizontal, 16).padding(.top, 14).padding(.bottom, 12)
            .frame(width: 362, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: 12).fill(Color.black))
        } else {
            Text(routeStatus == "keine-fahrten" ? "Keine Fahrten in diesem Vorschlag — nichts zu simulieren."
                 : routeStatus == "fehler" ? "Route konnte nicht geladen werden." : "Echte Route wird geladen …")
                .font(.grotesk(13, .medium)).tracking(0.5).foregroundStyle(Self.lime).multilineTextAlignment(.center)
                .padding(.horizontal, 16).padding(.vertical, 12)
                .frame(width: 362).frame(minHeight: 44)
                .background(RoundedRectangle(cornerRadius: 12).fill(Color.black))
        }
    }

    private var leerGesamt: Double {
        guard let route else { return leerMinutenPlan }
        return route.legs.filter { !$0.gast }.reduce(0) { $0 + ($1.bisMin - $1.vonMin) }
    }

    private var fahrerKarte: some View {
        let kmGesamt: Int? = route.map { Int($0.legs.reduce(0) { $0 + $1.km }.rounded()) } ?? entry.shiftKm
        let weiss = Color.white.opacity(0.6)
        return VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 10) {
                (Text(fahrerNummer.isEmpty ? "" : "\(fahrerNummer) ").foregroundColor(Self.lime) + Text(entry.name))
                    .font(.grotesk(20, .bold)).foregroundStyle(.white).lineLimit(1)
                Spacer(minLength: 0)
                if !telefon.isEmpty, let url = URL(string: "tel:\(telefon.replacingOccurrences(of: #"[\s()-]"#, with: "", options: .regularExpression))") {
                    Link(destination: url) {
                        Text(telefon).font(.grotesk(14, .bold)).monospacedDigit().foregroundStyle(Self.lime)
                    }
                    .fixedSize()
                }
            }
            .frame(minHeight: 22)
            (Text("Dienst ") + Text("\(entry.start) – \(entry.end)").bold().foregroundColor(.white)
                + Text(entry.vehicleLabel.isEmpty ? "" : " · \(entry.vehicleLabel)"))
                .font(.grotesk(13)).foregroundStyle(weiss).lineLimit(1)
                .frame(height: 18).padding(.top, 8)
            kennzahlen(kmGesamt)
                .font(.grotesk(13)).monospacedDigit().foregroundStyle(weiss).lineLimit(1)
                .frame(height: 18).padding(.top, 2)
        }
        .padding(.horizontal, 16).padding(.top, 14).padding(.bottom, 13)
        .frame(width: 362, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 12).fill(Color.black))
    }

    /// "N Fahrten · km km · M min Leerfahrt · n× laden", Zahlen fett und weiss.
    private func kennzahlen(_ km: Int?) -> Text {
        func fett(_ s: String) -> Text { Text(s).bold().foregroundColor(.white) }
        var t = fett("\(fahrten.count)") + Text(" Fahrten · ")
        if let km { t = t + fett("\(km)") + Text(" km · ") }
        t = t + fett("\(Int(leerGesamt.rounded()))") + Text(" min Leerfahrt · ")
        return t + fett("\(laden.count)×") + Text(" \(entry.vehicleIsEv ? "laden" : "tanken")")
    }

    // MARK: Laden

    private func profilLaden() async {
        struct Zeile: Decodable {
            let phone: String?
            let driver_number: Int?
        }
        guard !entry.driverId.isEmpty else { return }
        let zeilen: [Zeile] = (try? await Backend.client.from("profiles").select("phone, driver_number")
            .eq("id", value: entry.driverId).limit(1).execute().value) ?? []
        telefon = (zeilen.first?.phone ?? "").trimmingCharacters(in: .whitespaces)
        fahrerNummer = zeilen.first?.driver_number.map(String.init) ?? ""
    }

    /// Fahrzeug fuer den Ladestand, nur bei E-Fahrzeugen.
    private func fahrzeugLaden() async {
        struct Zeile: Decodable {
            let brand_model: String?
            let trim: String?
            let battery_fuel_percent: Double?
            enum CodingKeys: String, CodingKey { case brand_model, trim, battery_fuel_percent }
            init(from decoder: Decoder) throws {
                let c = try decoder.container(keyedBy: CodingKeys.self)
                brand_model = try? c.decodeIfPresent(String.self, forKey: .brand_model)
                trim = try? c.decodeIfPresent(String.self, forKey: .trim)
                battery_fuel_percent = (try? c.decodeIfPresent(Double.self, forKey: .battery_fuel_percent))
                    ?? (try? c.decodeIfPresent(String.self, forKey: .battery_fuel_percent)).flatMap { $0.flatMap(Double.init) }
            }
        }
        guard entry.vehicleIsEv, !entry.vehicleId.isEmpty else { modell = nil; return }
        let zeilen: [Zeile] = (try? await Backend.client.from("vehicles").select("brand_model, trim, battery_fuel_percent")
            .eq("id", value: entry.vehicleId).limit(1).execute().value) ?? []
        guard let z = zeilen.first else { modell = nil; return }
        modell = SimEvModell.finden(z.brand_model, z.trim)
        akkuStart = z.battery_fuel_percent ?? 100
    }

    /// Orte aufloesen, Strecken rechnen, Zeitleiste streng nacheinander aus den echten Fahrzeiten.
    @MainActor
    private func routeLaden() async {
        let plan = fahrten
        route = nil
        guard !plan.isEmpty else { routeStatus = "keine-fahrten"; return }
        routeStatus = "laedt"
        // Nur Fahrten, deren beide Orte aufloesbar sind, kommen auf die Karte.
        var karte: [(index: Int, fahrt: PlanFahrtSim, von: CLLocationCoordinate2D, nach: CLLocationCoordinate2D)] = []
        for (i, f) in plan.enumerated() {
            let von = await Routen.punkt(fuer: f.von)
            let nach = await Routen.punkt(fuer: f.nach)
            if Task.isCancelled { return }
            if let von, let nach { karte.append((i, f, von, nach)) }
        }
        guard let erste = karte.first else { routeStatus = "fehler"; return }
        let punkte = karte.flatMap { [$0.von, $0.nach] }
        var legs: [SimAbschnitt] = []
        var cursor = erste.fahrt.startMin
        for i in 0..<(punkte.count - 1) {
            let s = await Routen.strecke(von: punkte[i], bis: punkte[i + 1])
            if Task.isCancelled { return }
            let k = i / 2
            let gast = i % 2 == 0
            if gast { cursor = Swift.max(cursor, karte[k].fahrt.startMin) }
            let von = cursor
            let bis = von + Double(s.sekunden) / 60
            legs.append(SimAbschnitt(gast: gast, vonMin: von, bisMin: bis, pts: s.punkte, km: Double(s.meter) / 1000))
            // Nach der Leerfahrt ggf. bis zur geplanten Abholzeit warten.
            cursor = !gast && k + 1 < karte.count ? Swift.max(bis, karte[k + 1].fahrt.startMin) : bis
        }
        let neu = SimRoute(legs: legs,
                           stationen: karte.map { ($0.von, $0.fahrt.nr) },
                           allePunkte: legs.flatMap(\.pts),
                           endeMin: legs.last?.bisMin,
                           fahrtIndex: karte.map(\.index))
        route = neu
        routeNr += 1
        routeStatus = "ok"
        // Uhr an den Anfang der echten Route, kurz danach laeuft sie von selbst los.
        simMin = legs.first?.vonMin ?? simMin
        gestartet = false
        fertig = false
        spielt = false
        try? await Task.sleep(for: .milliseconds(900))
        if Task.isCancelled { return }
        gestartet = true
        spielt = true
    }

    /// 1x = 6 Sim-Minuten pro Sekunde.
    @MainActor
    private func uhrLaufen() async {
        guard spielt else { return }
        var zuletzt = Date()
        while spielt, !Task.isCancelled {
            try? await Task.sleep(for: .milliseconds(33))
            let jetzt = Date()
            let dt = Swift.min(0.5, jetzt.timeIntervalSince(zuletzt))
            zuletzt = jetzt
            let naechste = simMin + dt * 6 * tempo
            if naechste >= simEnde {
                // Ende der Route: stehenbleiben, nicht neu starten.
                simMin = simEnde
                spielt = false
                fertig = true
                return
            }
            simMin = naechste
        }
    }

    /// Position auf einer Linie bei Anteil p (0…1), laengenproportional.
    static func punktAufLinie(_ pts: [CLLocationCoordinate2D], _ p: Double) -> CLLocationCoordinate2D? {
        guard let erster = pts.first else { return nil }
        if pts.count == 1 { return erster }
        var d: [Double] = [0]
        for i in 1..<pts.count {
            d.append(d[i - 1] + hypot(pts[i].longitude - pts[i - 1].longitude, pts[i].latitude - pts[i - 1].latitude))
        }
        guard let gesamt = d.last, gesamt > 0 else { return erster }
        let ziel = Swift.max(0, Swift.min(1, p)) * gesamt
        for i in 1..<pts.count where d[i] >= ziel {
            let f = (ziel - d[i - 1]) / Swift.max(1e-9, d[i] - d[i - 1])
            return CLLocationCoordinate2D(latitude: pts[i - 1].latitude + (pts[i].latitude - pts[i - 1].latitude) * f,
                                          longitude: pts[i - 1].longitude + (pts[i].longitude - pts[i - 1].longitude) * f)
        }
        return pts.last
    }
}

private extension String {
    var nilWennLeer: String? { isEmpty ? nil : self }
}

// MARK: - Route

private struct SimAbschnitt {
    let gast: Bool
    let vonMin: Double
    let bisMin: Double
    let pts: [CLLocationCoordinate2D]
    let km: Double
}

private struct SimRoute {
    let legs: [SimAbschnitt]
    let stationen: [(CLLocationCoordinate2D, Int)]
    let allePunkte: [CLLocationCoordinate2D]
    let endeMin: Double?
    /// Index in der sortierten Fahrtenliste je Kartenfahrt (Fahrten ohne Ort fehlen auf der Karte).
    let fahrtIndex: [Int]
}

// MARK: - Verbrauch (services/evConsumption.js)

/// Realer Verbrauch nach ev-database.org: Cold = -10 °C mit Heizung, Mild = +23 °C,
/// Highway bei 110 km/h. Dazwischen linear, ausserhalb auf den Randwert begrenzt.
private struct SimEvModell {
    let muster: String
    let nutzbarKwh: Double
    let stadtKalt: Double, stadtMild: Double, autobahnKalt: Double, autobahnMild: Double

    static let modelle = [
        SimEvModell(muster: #"ix\s*m70"#, nutzbarKwh: 108.9, stadtKalt: 220, stadtMild: 153, autobahnKalt: 303, autobahnMild: 237),
        SimEvModell(muster: #"i7\s*m70"#, nutzbarKwh: 101.7, stadtKalt: 214, stadtMild: 148, autobahnKalt: 286, autobahnMild: 224),
        SimEvModell(muster: #"ix3"#, nutzbarKwh: 82.6, stadtKalt: 172, stadtMild: 114, autobahnKalt: 229, autobahnMild: 178),
    ]

    static func finden(_ modell: String?, _ ausstattung: String?) -> SimEvModell? {
        let text = "\(modell ?? "") \(ausstattung ?? "")".trimmingCharacters(in: .whitespaces)
        return modelle.first { text.range(of: $0.muster, options: [.regularExpression, .caseInsensitive]) != nil }
    }

    private static func mix(_ kalt: Double, _ mild: Double, _ anteil: Double) -> Double {
        kalt + (mild - kalt) * Swift.max(0, Swift.min(1, anteil))
    }

    func prozentVerbraucht(_ celsius: Double?, _ km: Double, _ minuten: Double) -> Double {
        guard km > 0 else { return 0 }
        let warm = celsius.map { Swift.max(0, Swift.min(1, ($0 + 10) / 33)) } ?? 1
        // Bis 50 km/h Stadt, ab 90 km/h Autobahn, dazwischen gemischt.
        let autobahn = minuten > 0 ? Swift.max(0, Swift.min(1, (km / (minuten / 60) - 50) / 40)) : 0
        let wh = Self.mix(Self.mix(stadtKalt, stadtMild, warm), Self.mix(autobahnKalt, autobahnMild, warm), autobahn)
        return (wh * km) / 1000 / nutzbarKwh * 100
    }

    /// Tagesmitteltemperatur Muenchen ueber Open-Meteo (ohne Schluessel).
    static func tagesTemperatur(_ dayIso: String) async -> Double? {
        let tag = String(dayIso.prefix(10))
        guard tag.range(of: #"^\d{4}-\d{2}-\d{2}$"#, options: .regularExpression) != nil,
              let url = URL(string: "https://api.open-meteo.com/v1/forecast?latitude=48.137&longitude=11.575&daily=temperature_2m_max,temperature_2m_min&timezone=auto&start_date=\(tag)&end_date=\(tag)")
        else { return nil }
        struct Antwort: Decodable {
            struct Taeglich: Decodable { let temperature_2m_max: [Double?]?; let temperature_2m_min: [Double?]? }
            let daily: Taeglich?
        }
        guard let (daten, antwort) = try? await URLSession.shared.data(from: url),
              (antwort as? HTTPURLResponse)?.statusCode == 200,
              let a = try? JSONDecoder().decode(Antwort.self, from: daten),
              let max = a.daily?.temperature_2m_max?.first ?? nil, let min = a.daily?.temperature_2m_min?.first ?? nil
        else { return nil }
        return (max + min) / 2
    }
}

// MARK: - Karte

private final class SimStationPunkt: MLNPointAnnotation {
    let text: String
    init(text: String) { self.text = text; super.init() }
    required init?(coder: NSCoder) { fatalError() }
}

private final class SimFahrerPunkt: MLNPointAnnotation {}

/// Gruener Pin mit Fahrtnummer(n), 35 x 41,14, Spitze auf dem Ort.
private final class SimStationPin: MLNAnnotationView {
    init(text: String, z: CGFloat) {
        super.init(reuseIdentifier: nil)
        frame = CGRect(x: 0, y: 0, width: 35, height: 41.1367)
        let bild = UIImageView(image: UIImage(named: "Fahrer_Pin_Trisar_01_gruen"))
        bild.frame = bounds
        addSubview(bild)
        let l = UILabel(frame: CGRect(x: 0, y: 17.5 - 12, width: 35, height: 24))
        l.text = text
        l.textAlignment = .center
        l.textColor = UIColor(hex: 0x1A1A1A)
        l.font = WebText.schrift(text.count > 3 ? 11 : 15, .bold)
        l.adjustsFontSizeToFitWidth = true
        addSubview(l)
        centerOffset = CGVector(dx: 0, dy: -41.1367 / 2)
        layer.zPosition = z
        isUserInteractionEnabled = false
    }
    required init?(coder: NSCoder) { fatalError() }
}

/// Fahrer als Punkt mit Nummer: rot mit Gast, gruen beim Laden, gelb (Kopf des gelben Pins) leer.
private final class SimFahrerAnsicht: MLNAnnotationView {
    private let bild = UIImageView()
    private let nummer = UILabel()
    private var zustand = ""

    init() {
        super.init(reuseIdentifier: nil)
        frame = CGRect(x: 0, y: 0, width: 35, height: 35)
        clipsToBounds = true
        bild.contentMode = .scaleToFill
        addSubview(bild)
        nummer.frame = bounds
        nummer.textAlignment = .center
        nummer.textColor = UIColor(hex: 0x1A1A1A)
        nummer.font = WebText.schrift(15, .bold)
        addSubview(nummer)
        layer.zPosition = 400
        isUserInteractionEnabled = false
    }
    required init?(coder: NSCoder) { fatalError() }

    func anwenden(zustand neu: String, nummer text: String) {
        nummer.text = text.isEmpty ? "•" : text
        guard neu != zustand else { return }
        zustand = neu
        switch neu {
        case "gast":
            bild.image = UIImage(named: "Fahrer_Punkt_Trisar_01_rot")
            bild.frame = bounds
        case "laden":
            bild.image = UIImage(named: "Fahrer_Punkt_Trisar_01_gruen")
            bild.frame = bounds
        default:
            // Fuer Gelb gibt es keinen eigenen Punkt: Kreis des gelben Pins, Spitze abgeschnitten.
            bild.image = UIImage(named: "Fahrer_Pin_Trisar_01_gelb")
            bild.frame = CGRect(x: 0, y: 0, width: 35, height: 41.1367)
        }
    }
}

private struct NebenSimKarte: UIViewRepresentable {
    let route: SimRoute?
    let routeNr: Int
    let punkt: CLLocationCoordinate2D?
    let zustand: String
    let nummer: String
    /// -1 = ganzer Tag, sonst Fahrt k (Abschnitte 2k und 2k+1).
    let kameraZiel: Int?
    let massstab: CGFloat

    func makeCoordinator() -> Koordinator { Koordinator() }

    func makeUIView(context: Context) -> MLNMapView {
        let karte = MLNMapView(frame: .zero, styleURL: DispoKarte.stil)
        karte.delegate = context.coordinator
        karte.backgroundColor = UIColor(hex: 0x0E0E0E)
        karte.setCenter(CLLocationCoordinate2D(latitude: 48.137154, longitude: 11.576124), zoomLevel: 11, animated: false)
        karte.logoView.isHidden = true
        karte.compassView.isHidden = true
        karte.showsScale = false
        karte.automaticallyAdjustsContentInset = false
        karte.attributionButtonPosition = .bottomRight
        karte.attributionButton.tintColor = UIColor(white: 0.6, alpha: 0.8)
        context.coordinator.karte = karte
        return karte
    }

    func updateUIView(_ karte: MLNMapView, context: Context) {
        context.coordinator.setzen(self)
    }

    final class Koordinator: NSObject, MLNMapViewDelegate {
        weak var karte: MLNMapView?
        private var stand: NebenSimKarte?
        private var stilGeladen = false
        private var gezeichnet = -1
        private var kameraSchluessel = ""
        private var stationen: [SimStationPunkt] = []
        private var fahrer: SimFahrerPunkt?
        private weak var fahrerAnsicht: SimFahrerAnsicht?

        func setzen(_ neu: NebenSimKarte) {
            stand = neu
            guard stilGeladen, let karte else { return }
            if neu.routeNr != gezeichnet { routeZeichnen(karte, neu) }
            fahrerSetzen(karte, neu)
            kameraSetzen(neu)
        }

        func mapView(_ mapView: MLNMapView, didFinishLoading style: MLNStyle) {
            stilGeladen = true
            if let stand { setzen(stand) }
        }

        private func routeZeichnen(_ karte: MLNMapView, _ s: NebenSimKarte) {
            guard let stil = karte.style else { return }
            gezeichnet = s.routeNr
            let legs = s.route?.legs ?? []
            linie(stil, "sim-leer", legs.filter { !$0.gast }.map(\.pts), UIColor(hex: 0xE3F654), 5, gestrichelt: true, deckung: 1)
            linie(stil, "sim-gast", legs.filter(\.gast).map(\.pts), UIColor(hex: 0x0059FF), 6, gestrichelt: false, deckung: 0.9)

            karte.removeAnnotations(stationen)
            stationen = []
            // Mehrere Abholungen naeher als 40 m teilen sich einen Pin ("1/3").
            var orte: [(ort: CLLocationCoordinate2D, nummern: [Int])] = []
            for (ort, nr) in s.route?.stationen ?? [] {
                if let i = orte.firstIndex(where: { Self.abstandM($0.ort, ort) <= 40 }) {
                    orte[i].nummern.append(nr)
                } else {
                    orte.append((ort, [nr]))
                }
            }
            stationen = orte.map { o in
                let p = SimStationPunkt(text: o.nummern.map(String.init).joined(separator: "/"))
                p.coordinate = o.ort
                return p
            }
            karte.addAnnotations(stationen)
        }

        private static func abstandM(_ a: CLLocationCoordinate2D, _ b: CLLocationCoordinate2D) -> Double {
            hypot((b.latitude - a.latitude) * 110_574, (b.longitude - a.longitude) * 111_320 * cos(a.latitude * .pi / 180))
        }

        private func fahrerSetzen(_ karte: MLNMapView, _ s: NebenSimKarte) {
            guard let ort = s.punkt else {
                if let fahrer { karte.removeAnnotation(fahrer); self.fahrer = nil }
                return
            }
            if let fahrer {
                fahrer.coordinate = ort
            } else {
                let p = SimFahrerPunkt()
                p.coordinate = ort
                fahrer = p
                karte.addAnnotation(p)
            }
            fahrerAnsicht?.anwenden(zustand: s.zustand, nummer: s.nummer)
        }

        private func kameraSetzen(_ s: NebenSimKarte) {
            guard let route = s.route, let ziel = s.kameraZiel else { return }
            let schluessel = "\(s.routeNr)-\(ziel)"
            guard schluessel != kameraSchluessel else { return }
            let punkte = ziel < 0 ? route.allePunkte
                : (ziel * 2 < route.legs.count ? route.legs[ziel * 2].pts : [])
                + (ziel * 2 + 1 < route.legs.count ? route.legs[ziel * 2 + 1].pts : [])
            guard !punkte.isEmpty else { return }
            if einpassen(punkte, s.massstab) { kameraSchluessel = schluessel }
        }

        /// Rand wie auf der Tageskarte: oben Knoepfe und Leisten, unten die Fahrerleiste.
        @discardableResult
        private func einpassen(_ orte: [CLLocationCoordinate2D], _ massstab: CGFloat) -> Bool {
            guard let karte, let erster = orte.first else { return false }
            guard karte.bounds.width > 10, karte.bounds.height > 10 else {
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) { [weak self] in
                    guard let self, let stand = self.stand else { return }
                    self.kameraSetzen(stand)
                }
                return false
            }
            var sw = erster, ne = erster
            for p in orte {
                sw.latitude = min(sw.latitude, p.latitude); sw.longitude = min(sw.longitude, p.longitude)
                ne.latitude = max(ne.latitude, p.latitude); ne.longitude = max(ne.longitude, p.longitude)
            }
            let rand = UIEdgeInsets(top: 262 * massstab, left: 32 * massstab, bottom: 190 * massstab, right: 32 * massstab)
            let kamera = karte.cameraThatFitsCoordinateBounds(MLNCoordinateBounds(sw: sw, ne: ne), edgePadding: rand)
            // Laenger und ruhiger als die Standardfahrt der Karte.
            karte.setCamera(kamera, withDuration: 1.4, animationTimingFunction: CAMediaTimingFunction(name: .easeInEaseOut))
            return true
        }

        private func linie(_ stil: MLNStyle, _ kennung: String, _ pfade: [[CLLocationCoordinate2D]], _ farbe: UIColor,
                           _ breite: CGFloat, gestrichelt: Bool, deckung: Double) {
            // Linien ohne zwei Punkte loesen in MapLibre eine Ausnahme aus.
            let formen: [MLNPolylineFeature] = pfade.filter { $0.count >= 2 }.map { pfad in
                var k = pfad
                return MLNPolylineFeature(coordinates: &k, count: UInt(k.count))
            }
            let form = MLNShapeCollectionFeature(shapes: formen)
            if let quelle = stil.source(withIdentifier: kennung) as? MLNShapeSource {
                quelle.shape = form
                return
            }
            let quelle = MLNShapeSource(identifier: kennung, shape: form, options: nil)
            stil.addSource(quelle)
            let ebene = MLNLineStyleLayer(identifier: kennung, source: quelle)
            ebene.lineColor = NSExpression(forConstantValue: farbe)
            ebene.lineWidth = NSExpression(forConstantValue: breite)
            ebene.lineOpacity = NSExpression(forConstantValue: deckung)
            ebene.lineCap = NSExpression(forConstantValue: gestrichelt ? "butt" : "round")
            ebene.lineJoin = NSExpression(forConstantValue: "round")
            if gestrichelt { ebene.lineDashPattern = NSExpression(forConstantValue: [1.6, 0.8]) }
            stil.addLayer(ebene)
        }

        func mapView(_ mapView: MLNMapView, viewFor annotation: MLNAnnotation) -> MLNAnnotationView? {
            if let p = annotation as? SimStationPunkt {
                let i = stationen.firstIndex { $0 === p } ?? 0
                return SimStationPin(text: p.text, z: CGFloat(320 + stationen.count - i))
            }
            if annotation is SimFahrerPunkt {
                let v = SimFahrerAnsicht()
                if let stand { v.anwenden(zustand: stand.zustand, nummer: stand.nummer) }
                fahrerAnsicht = v
                return v
            }
            return nil
        }

        func mapView(_ mapView: MLNMapView, annotationCanShowCallout annotation: MLNAnnotation) -> Bool { false }
    }
}
