import SwiftUI

/// Planungsregeln (KiPlanerSettingsView.jsx, Figma 2407:11491): je Regel ein Schieber mit
/// Minus/Plus, darunter Bezeichnung samt Wert und ein Erklaertext. Texte aus de.js (planer.*).
struct PlanerEinstellungenAnsicht: View {
    /// Anzahl verfuegbarer Fahrer, begrenzt den Fahrerpool-Regler (0 = feste Grenze 101).
    var fahrerAnzahl = 0
    let einstellungen: PlanerEinstellungen
    let aendern: (PlanerEinstellungen) -> Void
    let zurueck: () -> Void

    init(fahrerAnzahl: Int = 0, einstellungen: PlanerEinstellungen,
         aendern: @escaping (PlanerEinstellungen) -> Void, zurueck: @escaping () -> Void) {
        self.fahrerAnzahl = fahrerAnzahl
        self.einstellungen = einstellungen
        self.aendern = aendern
        self.zurueck = zurueck
    }

    private struct Regel {
        let pfad: WritableKeyPath<PlanerEinstellungen, Double>
        let min: Double, max: Double, schritt: Double
        var maxAusBestand = false
        let label: String, hinweis: String
        let format: (Double) -> String
    }

    private static func stunden(_ v: Double) -> String { "\(zahlText(v).replacingOccurrences(of: ".", with: ",")) h" }
    /// String(v) wie in JS: 8 statt 8.0.
    private static func zahlText(_ v: Double) -> String { v == v.rounded() ? String(Int(v)) : String(v) }

    private static let regeln: [Regel] = [
        Regel(pfad: \.maxWorkHours, min: 3, max: 10, schritt: 0.5, label: "Max. Schichtlänge",
              hinweis: "§ 3 ArbZG: 8 h Regelarbeitszeit, bis 10 h zulässig bei Ausgleich.", format: stunden),
        Regel(pfad: \.minWorkHours, min: 3, max: 10, schritt: 0.5, label: "Min. Schichtlänge",
              hinweis: "Mindestlänge je Arbeitsblock. Geteilte Dienste sind erlaubt: zwei Blöcke pro Tag mit mindestens 3 h unbezahlter Pause dazwischen.",
              format: stunden),
        Regel(pfad: \.bufferMinutes, min: 0, max: 60, schritt: 5, label: "Puffer vor Fahrt",
              hinweis: "Vorlauf vor der Abholung, zusätzlich zum Puffer aus dem Abholtyp.", format: { "\(zahlText($0)) min" }),
        Regel(pfad: \.minPauseHours, min: 3, max: 8, schritt: 0.5, label: "Pause bei geteiltem Dienst",
              hinweis: "Mindestpause zwischen den beiden Blöcken eines geteilten Dienstes.", format: stunden),
        Regel(pfad: \.restHours, min: 11, max: 16, schritt: 0.5, label: "Min. Ruhezeit zwischen Tagen",
              hinweis: "§ 5 ArbZG: mindestens 11 h zwischen Dienstende und nächstem Dienstbeginn.", format: stunden),
        // Obergrenze ist der tatsaechliche Fahrerbestand (fahrerAnzahl).
        Regel(pfad: \.driverPool, min: 1, max: 101, schritt: 1, maxAusBestand: true, label: "Fahrerpool",
              hinweis: "Wie viele Fahrer höchstens eingeplant werden.", format: zahlText),
        Regel(pfad: \.qualityGapPercent, min: 0, max: 20, schritt: 1, label: "Lösungsgüte",
              hinweis: "Abbruch nach Güte statt nach Zeit: der Solver rechnet, bis die Lösung nachweislich höchstens so weit vom Optimum entfernt ist. „Optimal“ kann an vollen Tagen mehrere Minuten dauern.",
              format: { $0 == 0 ? "Optimal" : "≤ \(zahlText($0)) %" }),
    ]

    /// Min- und Max-Schichtlaenge sind gekoppelt: schiebt man die Mindestlaenge ueber das
    /// Maximum, wandert das Maximum mit (beide duerfen gleich sein).
    private func setzen(_ pfad: WritableKeyPath<PlanerEinstellungen, Double>, _ wert: Double) {
        var neu = einstellungen
        neu[keyPath: pfad] = wert
        if pfad == \.minWorkHours, wert > neu.maxWorkHours { neu.maxWorkHours = wert }
        if pfad == \.maxWorkHours, wert < neu.minWorkHours { neu.minWorkHours = wert }
        aendern(neu)
    }

    var body: some View {
        let lime = Color(hex: 0xE3F654)
        ZStack(alignment: .topLeading) {
            DispoHintergrund().ignoresSafeArea()
            FlussLeinwand {
                VStack(alignment: .leading, spacing: 0) {
                    ZurueckKnopf(aktion: zurueck).frame(width: 50, height: 50)
                    StammTitel(text: "Planung", abstand: -0.5).padding(.top, 30)
                    VStack(spacing: 42) {
                        ForEach(Array(Self.regeln.enumerated()), id: \.offset) { _, r in
                            let max = r.maxAusBestand && fahrerAnzahl > 0 ? Swift.max(r.min, Double(fahrerAnzahl)) : r.max
                            let wert = Swift.min(max, einstellungen[keyPath: r.pfad])
                            VStack(spacing: 0) {
                                NebenRegler(wert: wert, min: r.min, max: max, schritt: r.schritt) { setzen(r.pfad, $0) }
                                    .accessibilityLabel(r.label)
                                WebText(text: "\(r.label) \(r.format(wert))", groesse: 20, gewicht: .bold, zeilenHoehe: 26,
                                        abstand: -0.3, farbe: UIColor(lime), ausrichtung: .center)
                                    .padding(.top, 12)
                                WebText(text: r.hinweis, groesse: 11, gewicht: .medium, zeilenHoehe: 15,
                                        farbe: UIColor.white.withAlphaComponent(0.45), ausrichtung: .center)
                                    .padding(.top, 6)
                            }
                        }
                    }
                    .padding(.top, 24)
                    verkehrWahl.padding(.top, 42)
                    knopf("Einstellungen übernehmen", voll: true, aktion: zurueck).padding(.top, 40)
                    knopf("Auf Standard zurücksetzen", voll: false) { aendern(.standard) }.padding(.top, 10)
                }
                .padding(.horizontal, 20)
                .padding(.top, 60)
                .padding(.bottom, 90)
                .frame(width: 402, alignment: .topLeading)
            }
            FussleisteUnten()
        }
        .background(Color.black.ignoresSafeArea())
    }

    /// Verkehrsmodell der Leerfahrten (travelModel), wie im Web zwei Felder nebeneinander.
    private var verkehrWahl: some View {
        let lime = Color(hex: 0xE3F654)
        return VStack(spacing: 0) {
            WebText(text: "Verkehr bei Leerfahrten", groesse: 20, gewicht: .bold, zeilenHoehe: 26,
                    abstand: -0.3, farbe: UIColor(lime), ausrichtung: .center)
            HStack(spacing: 10) {
                ForEach([("osrm", "Standard"), ("osrm_raum", "Nach Gegend")], id: \.0) { wert, text in
                    let aktiv = einstellungen.travelModel == wert
                    Button {
                        var neu = einstellungen
                        neu.travelModel = wert
                        aendern(neu)
                    } label: {
                        Text(text).font(.grotesk(16, .medium)).tracking(0.4)
                            .foregroundStyle(aktiv ? Color(hex: 0x1D1C1D) : lime)
                            .frame(maxWidth: .infinity).frame(height: 52)
                            .background(aktiv ? lime : Color.clear)
                            .overlay(Rectangle().strokeBorder(lime, lineWidth: 2))
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityAddTraits(aktiv ? .isSelected : [])
                }
            }
            .padding(.top, 12)
            WebText(text: "Standard: echte Straßenzeit mal Tageszeit-Faktor für ganz München. Nach Gegend: Faktor je Innenstadt, Stadt, Umland, Flughafen, Wochentag und Stunde, genauer (im Test 2,7 statt 4,6 min Abweichung).",
                    groesse: 11, gewicht: .medium, zeilenHoehe: 15,
                    farbe: UIColor.white.withAlphaComponent(0.45), ausrichtung: .center)
                .padding(.top, 6)
        }
    }

    private func knopf(_ text: String, voll: Bool, aktion: @escaping () -> Void) -> some View {
        Button(action: aktion) {
            Text(text).font(.grotesk(16, .medium)).tracking(0.4)
                .foregroundStyle(voll ? Color(hex: 0x1D1C1D) : Color(hex: 0xE3F654))
                .padding(.horizontal, 16)
                .frame(maxWidth: .infinity, alignment: .leading).frame(height: 52)
                .background(voll ? Color(hex: 0xE3F654) : Color.clear)
                .overlay(Rectangle().strokeBorder(Color(hex: 0xE3F654), lineWidth: 2))
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

/// Wie im Web (AlleFahrer.jsx): Einstellungen aus UserDefaults lesen und bei jeder Aenderung
/// sofort speichern. Fuer Aufrufer, die den Zustand nicht selbst halten.
struct PlanerEinstellungenSeite: View {
    var fahrerAnzahl = 0
    let zurueck: () -> Void
    @State private var einstellungen = PlanerEinstellungen.laden()

    var body: some View {
        PlanerEinstellungenAnsicht(fahrerAnzahl: fahrerAnzahl, einstellungen: einstellungen,
                                   aendern: { neu in einstellungen = neu; neu.speichern() }, zurueck: zurueck)
    }
}

/// Schieber: Minus, Schiene mit Knopf, Plus. Der Wert folgt dem Ziehen sofort.
private struct NebenRegler: View {
    let wert: Double
    let min: Double
    let max: Double
    let schritt: Double
    let aendern: (Double) -> Void

    private let lime = Color(hex: 0xE3F654)

    private func sauber(_ v: Double) -> Double { (v * 100).rounded() / 100 }

    var body: some View {
        let anteil = Swift.max(0, Swift.min(1, (wert - min) / Swift.max(max - min, 0.0001)))
        HStack(spacing: 14) {
            Button { aendern(sauber(Swift.max(min, wert - schritt))) } label: {
                Rectangle().fill(lime).frame(width: 23, height: 3).frame(width: 23, height: 23).contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("−")

            GeometryReader { geo in
                let b = geo.size.width
                ZStack(alignment: .leading) {
                    Rectangle().fill(Color(hex: 0x3F4436)).frame(height: 2)
                    Rectangle().fill(lime).frame(width: b * anteil, height: 2)
                    Circle().fill(lime).frame(width: 27, height: 27).position(x: b * anteil, y: 13.5)
                }
                .frame(width: b, height: 27)
                .contentShape(Rectangle())
                .gesture(DragGesture(minimumDistance: 0).onChanged { g in
                    guard b > 0 else { return }
                    let p = Swift.max(0, Swift.min(1, g.location.x / b))
                    let v = sauber(Swift.max(min, Swift.min(max, ((min + p * (max - min)) / schritt).rounded() * schritt)))
                    if v != wert { aendern(v) }
                })
            }
            .frame(height: 27)

            Button { aendern(sauber(Swift.min(max, wert + schritt))) } label: {
                ZStack {
                    Rectangle().fill(lime).frame(width: 23, height: 3)
                    Rectangle().fill(lime).frame(width: 3, height: 23)
                }
                .frame(width: 23, height: 23).contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("+")
        }
    }
}
