import SwiftUI

/// Einsatzplanung: ein Tag des Zeitraums (EinsatzplanungTag.jsx, Figma 2588:12036).
/// Punkte oben, Diagramm des Tages, Optionen Standard/Sicher, Vorschlaege (offen gross mit Fahrten,
/// uebernommen kompakt), Wallet-Karte, accept fuer den ganzen Tag, Pfeile zum Blaettern.
/// Der Engine-Block (Kennzahlen, Vorhersage, Puffer, Rad/U-Bahn) zeigt im Betrieb nichts
/// (nur vorab gerechnete Demo-Daten), darum steht hier nichts zwischen Optionen und Karten.
struct EinsatzTagAnsicht: View {
    @ObservedObject var modell: EinsatzPlanungModell
    /// Tipp auf eine Karte: Fahrt-Simulation (Vorschlag, Position ab 1, rideDurationMinutes).
    var oeffneSimulation: (EinsatzVorschlag, Int, Int) -> Void = { _, _, _ in }
    var oeffneEreignisse: (String) -> Void = { _ in }
    var oeffnePuffer: (String, String, String) -> Void = { _, _, _ in }

    private static let kartenOben: CGFloat = 574
    private static let knopfHoehe: CGFloat = 51
    private static let maxZeilen = 5
    private static let reiterX: [CGFloat] = [120, 282]
    private static let reiterY: CGFloat = 502.5

    private struct Karte: Identifiable {
        let v: EinsatzVorschlag
        let position: Int
        let erledigt: Bool
        let top: CGFloat
        let hoehe: CGFloat
        let knopfTop: CGFloat
        var id: String { v.id }
    }

    var body: some View {
        let tage = modell.planTage
        let index = min(modell.planTagIndex, max(0, tage.count - 1))
        let tagIso = tage.isEmpty ? modell.heute : tage[index]
        let eintrag = modell.geplant[tagIso]
        let vorschlaege = (eintrag?.suggestions ?? []).filter { !modell.abgelehnt.contains($0.id) }
        let offene = vorschlaege.filter { !modell.uebernommen.contains($0.id) }
        let erledigte = vorschlaege.filter { modell.uebernommen.contains($0.id) }
        let karten = layout(offene + erledigte)
        let kartenEnde = karten.last.map { $0.knopfTop + Self.knopfHoehe } ?? Self.kartenOben + 60
        let walletTop = kartenEnde + 160
        let hoehe = walletTop + 769
        let laeuft = modell.tagLaeuft
        let strategieKey = eintrag?.strategyKey ?? modell.strategieKey
        let tagFertig = !vorschlaege.isEmpty && offene.isEmpty
        let titel = EinsatzUhr.tagKurz(tagIso)
        let d = diagramm(tagIso, vorschlaege)

        ZStack(alignment: .topLeading) {
            EinsatzHintergrund()
            Leinwand(basisHoehe: 873, inhaltHoehe: hoehe, mitHintergrund: false) { _ in
                ZStack(alignment: .topLeading) {
                    ZurueckKnopf { modell.tagZurueck() }.platz(20, 60, 50, 50)
                    EinsatzPunkte(anzahl: tage.count, aktiv: index).mittig(201, 81, CGFloat(max(1, tage.count) - 1) * 17 + 7, 7)
                    Text(titel).font(.grotesk(24, .bold)).tracking(0.5).foregroundStyle(EinsatzFarbe.lime).lineLimit(1).fixedSize()
                        .mittig(201, 122, 380, 24, .center)

                    EinsatzDiagramm(oben: 194, bedarf: d.bedarf, gebucht: d.gebucht, fahrer: d.fahrer)

                    ForEach(Array(EinsatzStrategie.alle.enumerated()), id: \.element.key) { i, s in
                        let aktiv = s.key == strategieKey
                        Button { modell.tagesStrategie(s.key) } label: {
                            ZStack(alignment: .topLeading) {
                                Text(s.titel).font(.grotesk(16, .medium)).tracking(0.5).foregroundStyle(EinsatzFarbe.lime)
                                    .opacity(aktiv ? 1 : 0.5).fixedSize().frame(width: 124, height: 40)
                                if aktiv {
                                    Rectangle().fill(EinsatzFarbe.lime).platz(3.5, 8.5, 2, 23)
                                    Rectangle().fill(EinsatzFarbe.lime).platz(118.5, 8.5, 2, 23)
                                }
                            }
                            .frame(width: 124, height: 40, alignment: .topLeading).contentShape(Rectangle())
                        }
                        .buttonStyle(.web).disabled(laeuft)
                        .mittig(Self.reiterX[i], Self.reiterY - 20, 124, 40)
                    }

                    if !modell.fehler.isEmpty {
                        Text(modell.fehler).font(.grotesk(12, .medium)).tracking(0.5).foregroundStyle(EinsatzFarbe.rot)
                            .frame(width: 362, alignment: .leading).fixedSize(horizontal: false, vertical: true)
                            .platz(20, Self.kartenOben - 34, 362)
                    }
                    if laeuft {
                        Text(modell.planLog.isEmpty ? "Plane Einsatz…" : modell.planLog)
                            .font(.grotesk(12, .medium)).tracking(0.5).foregroundStyle(EinsatzFarbe.lime)
                            .lineLimit(1).truncationMode(.tail)
                            .frame(width: 362, height: 16).platz(20, Self.kartenOben - 38)
                    }
                    if !laeuft && karten.isEmpty {
                        Text("Für diesen Tag gibt es keine Vorschläge.").font(.grotesk(16, .medium)).tracking(0.5)
                            .foregroundStyle(EinsatzFarbe.lime).opacity(0.6).multilineTextAlignment(.center)
                            .frame(width: 362).platz(20, Self.kartenOben + 20, 362)
                    }

                    ForEach(karten) { k in
                        karte(k).opacity(laeuft ? 0.3 : 1).allowsHitTesting(!laeuft)
                            .animation(.easeInOut(duration: 0.3), value: laeuft)
                    }

                    TagesWalletKarte(titel: titel, wallet: EinsatzWallet.werte(vorschlaege)).platz(20, walletTop, 362, 433)

                    Text(EinsatzStrategie.finden(strategieKey).titel).font(.grotesk(26, .medium)).tracking(0.5)
                        .foregroundStyle(EinsatzFarbe.lime).fixedSize().mittig(201, walletTop + 461, 300, 24, .center)

                    pfeil(vor: false, aktiv: index > 0) { modell.tagWechseln(index - 1) }.platz(10, walletTop + 509, 65, 48)
                    tagKnopf(tagIso: tagIso, fertig: tagFertig, offen: offene.count, laeuft: laeuft).platz(112, walletTop + 507, 178, 51)
                    pfeil(vor: true, aktiv: index < tage.count - 1) { modell.tagWechseln(index + 1) }.platz(327, walletTop + 509, 65, 48)

                    statusPunkte(modell.tagesStatus).mittig(201, walletTop + 579.5, CGFloat(max(1, tage.count) - 1) * 22 + 12, 12)
                }
            }
            .id(index)   // Beim Blaettern oben beginnen.
        }
    }

    // MARK: Diagramm des Tages

    private func diagramm(_ iso: String, _ vorschlaege: [EinsatzVorschlag]) -> (bedarf: [Int], gebucht: [Int], fahrer: [Int]) {
        let stunden = Array(6..<26)
        let basis = EinsatzUhr.tagNr(iso, heute: modell.heute) * 24
        func wert(_ r: [Int], _ h: Int) -> Int { basis + h >= 0 && basis + h < r.count ? max(0, r[basis + h]) : 0 }
        // Mit Plan: hoechstens gleichzeitig belegte Fahrzeuge je Stunde; ohne Plan die Schaetzung.
        let belegt: [[(Int, Int)]] = vorschlaege.map { v in
            v.rides.compactMap { r in EinsatzUhr.minuten(r.etd).map { ($0, $0 + Int(r.durationMinutes ?? 0)) } }
        }
        let bedarfAlle = modell.bedarfAngepasst
        let bedarf: [Int] = vorschlaege.isEmpty ? stunden.map { wert(bedarfAlle, $0) } : stunden.map { h in
            var spitze = 0
            for m in stride(from: h * 60, to: (h + 1) * 60, by: 5) {
                spitze = max(spitze, belegt.filter { fz in fz.contains { $0.0 <= m && $0.1 > m } }.count)
            }
            return spitze
        }
        let gebuchtAlle = modell.gebuchtAlle
        let angebot = modell.angebotAlle
        let fahrer: [Int] = vorschlaege.isEmpty ? stunden.map { wert(angebot, $0) } : stunden.map { h in
            vorschlaege.filter { $0.startMinutes < (h + 1) * 60 && max($0.endMinutes, $0.startMinutes) > h * 60 }.count
        }
        return (bedarf, stunden.map { wert(gebuchtAlle, $0) }, fahrer)
    }

    // MARK: Karten

    private func layout(_ reihe: [EinsatzVorschlag]) -> [Karte] {
        var y = Self.kartenOben
        return reihe.enumerated().map { position, v in
            if modell.uebernommen.contains(v.id) {
                let k = Karte(v: v, position: position, erledigt: true, top: y, hoehe: 117, knopfTop: y + 117 + 16)
                y += 117 + 16 + Self.knopfHoehe + 17
                return k
            }
            let zeilen = v.rides.count > Self.maxZeilen ? Self.maxZeilen + 1 : max(1, v.rides.count)
            let h = 171 + CGFloat(zeilen - 1) * 40
            let k = Karte(v: v, position: position, erledigt: false, top: y, hoehe: h, knopfTop: y + h + 17)
            y += h + 17 + Self.knopfHoehe + 8
            return k
        }
    }

    @ViewBuilder private func karte(_ k: Karte) -> some View {
        let v = k.v
        let dunkel = Color(hex: 0x1D1C1D).opacity(0.8)
        ZStack(alignment: .topLeading) {
            Button {
                oeffneSimulation(v, k.position + 1, modell.fahrtDauerRegel)
            } label: {
                ZStack(alignment: .topLeading) {
                    Color(hex: 0xFEFFFE)
                    Text("#\(k.position + 1) \(v.name)").font(.grotesk(30, .bold)).tracking(-0.5).foregroundStyle(Color(hex: 0x1C1C1D))
                        .lineLimit(1).truncationMode(.tail).frame(width: 262, alignment: .leading).platz(18, 18, 262, 38)
                    VStack(alignment: .trailing, spacing: 0) {
                        Text(v.start).frame(height: 20)
                        Text("– \(v.end)").frame(height: 20)
                    }
                    .font(.grotesk(15, .bold)).foregroundStyle(.black).fixedSize()
                    .frame(width: 343, height: 40, alignment: .trailing).platz(0, 24)
                    Text("\(v.hours)h").font(.grotesk(15, .bold)).foregroundStyle(EinsatzFarbe.gruen).fixedSize()
                        .frame(width: 343, height: 20, alignment: .trailing).platz(0, 67)

                    if !k.erledigt {
                        let sichtbar = Array(v.rides.prefix(Self.maxZeilen))
                        if sichtbar.isEmpty {
                            Text("Bereitschaft & Kurzfahrten im Stadtgebiet").font(.grotesk(12)).tracking(0.5).foregroundStyle(dunkel)
                                .frame(width: 285, height: 32, alignment: .leading).platz(18, 87 - 16)
                        } else {
                            ForEach(Array(sichtbar.enumerated()), id: \.offset) { i, f in
                                fahrtzeile(f).frame(width: 285, height: 40, alignment: .leading).platz(18, 87 + CGFloat(i) * 40 - 20)
                            }
                        }
                        if v.rides.count > Self.maxZeilen {
                            Text("+ \(v.rides.count - Self.maxZeilen) weitere Fahrten").font(.grotesk(12, .bold)).tracking(0.5)
                                .foregroundStyle(dunkel).frame(width: 285, height: 16, alignment: .leading)
                                .platz(18, 87 + CGFloat(Self.maxZeilen) * 40 - 8)
                        }
                        Rectangle().fill(Color(hex: 0x7E817F)).platz(17.5, k.hoehe - 52, 324, 1)
                    }

                    let unten = k.hoehe - (k.erledigt ? 18 : 27)
                    Text(v.vehicleLabel.isEmpty ? "Fahrzeug offen" : "\(v.vehicleIsEv ? "EV – " : "")\(v.vehicleLabel)")
                        .font(.grotesk(12, .bold)).foregroundStyle(.black).opacity(0.5).lineLimit(1).truncationMode(.tail)
                        .frame(width: 226, height: 16, alignment: .leading).platz(18, unten - 8)
                    Text(v.shiftKm.map { "\($0) km" } ?? "").font(.grotesk(12, .bold)).foregroundStyle(.black).opacity(0.5)
                        .fixedSize().frame(width: 344, height: 16, alignment: .trailing).platz(0, unten - 8)
                }
                .frame(width: 362, height: k.hoehe, alignment: .topLeading)
                .clipped()
                .contentShape(Rectangle())
            }
            .buttonStyle(.web)
            .platz(20, k.top, 362, k.hoehe)

            if k.erledigt {
                Button { Task { await modell.zuruecknehmen(v) } } label: {
                    Image("x_knopf").resizable().frame(width: 54, height: 50.29)
                }
                .buttonStyle(.web).accessibilityLabel("Übernahme für \(v.name) zurücknehmen").platz(20, k.knopfTop, 54, 50.29)
                HStack(spacing: 10) {
                    Text("Übernommen").font(.grotesk(24, .bold)).tracking(-0.5).foregroundStyle(.black).fixedSize()
                    Image("haken").resizable().frame(width: 24.66, height: 29.04)
                }
                .frame(width: 300, height: 51).background(EinsatzFarbe.lime).platz(82, k.knopfTop, 300, 51)
            } else {
                Button { modell.ablehnen(v.id) } label: {
                    Text("Ablehnen").font(.grotesk(24, .bold)).tracking(-0.5).foregroundStyle(EinsatzFarbe.rot).fixedSize()
                        .frame(width: 178, height: 51)
                        .overlay(Rectangle().strokeBorder(EinsatzFarbe.rot, lineWidth: 2)).contentShape(Rectangle())
                }
                .buttonStyle(.web).platz(20, k.knopfTop, 178, 51)
                Button { Task { await modell.annehmen(v) } } label: {
                    Text("Annehmen").font(.grotesk(24, .bold)).tracking(-0.5).foregroundStyle(.black).fixedSize()
                        .frame(width: 178, height: 51).background(EinsatzFarbe.lime)
                }
                .buttonStyle(.web).platz(204, k.knopfTop, 178, 51)
            }
        }
    }

    /// Adresse wie in Figma: "Strasse Nr, PLZ" (ohne Ort).
    private func kurzeAdresse(_ text: String) -> String {
        let teile = text.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
        if let i = teile.firstIndex(where: { $0.firstMatch(of: /^\d{5}\b/) != nil }), i > 0 {
            return "\(teile[i - 1]), \(teile[i].prefix(5))"
        }
        return teile.first ?? ""
    }

    private func fahrtzeile(_ f: EinsatzFahrt) -> some View {
        let ab = kurzeAdresse(f.adresseAb).planOderNil ?? f.pickup
        let ziel = kurzeAdresse(f.adresseZiel).planOderNil ?? f.dropoff
        let blau = Color(hex: 0x2D6CFF)
        var t = Text("\(f.etd) ").font(.grotesk(12, .bold)).tracking(0.5)
            + Text("– ").font(.grotesk(12)).tracking(0.5)
            + Text("\(ab) – \(ziel)").font(.grotesk(12)).tracking(1)
            + Text(" – ").font(.grotesk(12)).tracking(0.5)
            + Text(f.ankunft).font(.grotesk(12, .bold)).tracking(0.5)
        if f.sammel { t = t + Text(" · Sammelfahrt").font(.grotesk(12, .bold)).foregroundColor(blau) }
        if f.route == "FTO" { t = t + Text(" · über Flughafentangente Ost").font(.grotesk(12, .bold)).foregroundColor(blau) }
        return t.foregroundStyle(Color(hex: 0x1D1C1D).opacity(0.8)).lineLimit(2).lineSpacing(0.7)
    }

    // MARK: Fuss

    private func pfeil(vor: Bool, aktiv: Bool, aktion: @escaping () -> Void) -> some View {
        Button { if aktiv { aktion() } } label: {
            Image(aktiv ? "weiter_gross" : "zurueck_gross").resizable().frame(width: 45, height: 28)
                .rotationEffect(.degrees(vor ? 180 : 0))
                .frame(width: 65, height: 48).contentShape(Rectangle())
        }
        .buttonStyle(.web).disabled(!aktiv)
        .accessibilityLabel(vor ? "Nächster Tag" : "Vorheriger Tag")
    }

    /// accept fuellt sich von links, sobald der Tag uebernommen ist.
    private func tagKnopf(tagIso: String, fertig: Bool, offen: Int, laeuft: Bool) -> some View {
        let gesperrt = laeuft || (!fertig && offen == 0)
        return Button {
            if !fertig && !laeuft && offen > 0 { Task { await modell.tagAnnehmen(tagIso) } }
        } label: {
            ZStack(alignment: .leading) {
                Rectangle().fill(EinsatzFarbe.lime).frame(width: fertig ? 178 : 0)
                    .animation(.timingCurve(0.65, 0, 0.35, 1, duration: 0.56), value: fertig)
                Text("accept").font(.grotesk(24, .bold)).tracking(-0.5).foregroundStyle(fertig ? .black : EinsatzFarbe.lime)
                    .animation(.easeInOut(duration: 0.26).delay(0.22), value: fertig)
                    .fixedSize().frame(width: 178, height: 51)
            }
            .frame(width: 178, height: 51, alignment: .leading)
            .clipped()
            .overlay(Rectangle().strokeBorder(EinsatzFarbe.lime, lineWidth: 2))
            .contentShape(Rectangle())
        }
        .buttonStyle(.web).disabled(gesperrt).opacity(gesperrt ? 0.5 : 1)
    }

    /// Status der Tage: 12er Punkte im 22er Abstand, gruen = bestaetigt, grau = offen, weisser Rand.
    private func statusPunkte(_ status: [Bool]) -> some View {
        ZStack(alignment: .topLeading) {
            ForEach(Array(status.enumerated()), id: \.offset) { i, ok in
                Circle().fill(ok ? EinsatzFarbe.gruen : Color(hex: 0x888989))
                    .overlay(Circle().strokeBorder(.white, lineWidth: 1))
                    .animation(.easeInOut(duration: 0.4), value: ok)
                    .platz(CGFloat(i) * 22, 0, 12, 12)
            }
        }
        .frame(width: CGFloat(max(1, status.count) - 1) * 22 + 12, height: 12, alignment: .topLeading)
        .allowsHitTesting(false)
    }
}
