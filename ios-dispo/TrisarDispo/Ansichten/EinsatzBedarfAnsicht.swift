import SwiftUI

/// Einsatzplanung Schritt 2: Bedarf pruefen und per Hand anpassen (EinsatzplanungBedarf.jsx).
/// Die Diagramme aller gewaehlten Tage stehen untereinander, getrennt durch die Datumszeile;
/// der Bedarf laesst sich je Stunde ziehen. Erst der Pfeil unten plant.
/// Ereignisse unter den Diagrammen gibt es nur in der Demo (vorab gerechnete Daten), live nie.
struct EinsatzBedarfAnsicht: View {
    @ObservedObject var modell: EinsatzPlanungModell
    var oeffneEreignisse: (String) -> Void = { _ in }

    private static let stunden = Array(6..<26)
    private static let ersterTrenner: CGFloat = 118
    private static let block: CGFloat = 76 + 261 + 106

    private func top(_ i: Int) -> CGFloat { Self.ersterTrenner + CGFloat(i) * Self.block }

    /// Datumszeile wie in der Fahrer-App: "Mittwoch 04.11."
    private func trennerText(_ iso: String) -> String { EinsatzUhr.format(iso, "EEEE dd.MM.") }

    var body: some View {
        let tage = modell.planTage
        let letzteUhrzeit = top(max(0, tage.count - 1)) + 76 + 261
        let hinweisY = letzteUhrzeit + 56
        let fussY = hinweisY + 48
        let hoehe = fussY + 14 + 180
        let angepasst = modell.bedarfAnpassung.values.contains { !$0.isEmpty }
        let angebot = modell.angebotAlle, gebucht = modell.gebuchtAlle, basis = modell.bedarfAlle

        ZStack(alignment: .topLeading) {
            EinsatzHintergrund()
            Leinwand(basisHoehe: 873, inhaltHoehe: hoehe, mitHintergrund: false) { _ in
                ZStack(alignment: .topLeading) {
                    ZurueckKnopf { modell.ablauf = .kalender }.platz(20, 40, 50, 50)

                    ForEach(Array(tage.enumerated()), id: \.element) { position, iso in
                        let y = top(position)
                        let start = EinsatzUhr.tagNr(iso, heute: modell.heute) * 24
                        let wert: ([Int], Int) -> Int = { reihe, h in start + h >= 0 && start + h < reihe.count ? max(0, reihe[start + h]) : 0 }
                        let bedarfBasis = Self.stunden.map { wert(basis, $0) }
                        let eigene = modell.bedarfAnpassung[iso] ?? [:]
                        let bedarf = Self.stunden.enumerated().map { i, h in eigene[h].map { max(0, $0) } ?? bedarfBasis[i] }

                        HStack(spacing: 0) {
                            Rectangle().fill(EinsatzFarbe.trenner).frame(width: 44, height: 2)
                            Spacer(minLength: 0)
                            Text(trennerText(iso)).font(.grotesk(26, .bold)).tracking(-0.5).foregroundStyle(EinsatzFarbe.trenner)
                                .lineLimit(1).fixedSize()
                            Spacer(minLength: 0)
                            Rectangle().fill(EinsatzFarbe.trenner).frame(width: 44, height: 2)
                        }
                        .allowsHitTesting(false)
                        .platz(20, y, 362, 32)

                        EinsatzDiagramm(oben: y + 76, bedarf: bedarf, gebucht: Self.stunden.map { wert(gebucht, $0) },
                                        fahrer: Self.stunden.map { wert(angebot, $0) }, bedarfBasis: bedarfBasis, ziehbar: true) { i, w in
                            modell.bedarfAnpassen(iso, Self.stunden[i], w)
                        }
                    }

                    WebText(text: "Bedarf per Hand anpassen: Punkte im Diagramm nach oben oder unten ziehen.", groesse: 12,
                            gewicht: .medium, zeilenHoehe: 16, abstand: 0.5, farbe: UIColor(EinsatzFarbe.lime.opacity(0.5)), ausrichtung: .center)
                        .frame(width: 362, height: 40, alignment: .center)
                        .platz(20, hinweisY - 20, 362, 40)

                    Button { modell.bedarfAnpassung = [:] } label: {
                        Text("Zurücksetzen").font(.grotesk(14, .medium)).tracking(0.5).foregroundStyle(EinsatzFarbe.lime.opacity(0.5)).fixedSize()
                    }
                    .buttonStyle(.plain).disabled(!angepasst).opacity(angepasst ? 1 : 0.4)
                    .mittig(201, fussY - 12, 160, 24, .center)

                    Button { modell.bedarfWeiter() } label: {
                        Image("weiter_gross").resizable().frame(width: 45, height: 28).rotationEffect(.degrees(180))
                            .frame(width: 65, height: 48).contentShape(Rectangle())
                    }
                    .buttonStyle(.plain).accessibilityLabel("Planung starten").platz(309, fussY - 24, 65, 48)
                }
            }
        }
    }
}
