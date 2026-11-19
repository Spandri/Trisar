import SwiftUI

/// Fahrzeugseite der Dispo fuer den angetippten Fahrer: Kopie von FahrzeugAnsicht.swift der Fahrer-App
/// (Fahrzeugblock, Fahrzeugdaten (OBD), Schadensbericht mit "Schaden melden"), ohne Karte und ohne
/// "Tracker scannen". Schaeden gehen mit reported_by_driver false an das Fahrzeug des Fahrers.
struct DispoFahrzeugAnsicht: View {
    let fahrerID: UUID
    let fahrzeugID: UUID?
    var zurueck: () -> Void

    @StateObject private var daten: FahrzeugDaten
    @State private var fahrzeug: FahrzeugZeile?
    @State private var meldenOffen = false
    /// Neu zeichnen, wenn ein Fahrzeugbild nicht laedt (Block wird kuerzer).
    @ObservedObject private var bilder = FahrzeugBildSpeicher.shared
    /// Neu zeichnen, wenn der Fahrzeugkatalog (360-Grad-Bilder) vom Server nachlaedt.
    @ObservedObject private var katalog = DrehKatalog.shared
    @State private var unterHoehe: CGFloat = 0

    private let versatz: CGFloat = 20

    init(fahrerID: UUID, fahrzeugID: UUID?, zurueck: @escaping () -> Void) {
        self.fahrerID = fahrerID
        self.fahrzeugID = fahrzeugID
        self.zurueck = zurueck
        _daten = StateObject(wrappedValue: FahrzeugDaten(fahrerID: fahrerID, vonDispo: true))
    }

    var body: some View {
        let angaben = FahrzeugAngaben(fahrzeug, ausstattung: daten.ausstattung)
        let raster = angaben.blockRaster()
        let blockOben: CGFloat = 99
        let unterBlock = blockOben + raster.hoehe - 1
        let inhalt = max(1264, unterBlock + unterHoehe) + 40 + 70
        Leinwand(inhaltHoehe: inhalt, mitHintergrund: false) { rahmen in
            ZStack(alignment: .topLeading) {
                TrisarHintergrund().frame(width: 402, height: max(inhalt, rahmen))

                ZurueckKnopf(aktion: zurueck).platz(20, versatz + 40, 50, 50)

                fahrzeugBlock(angaben, raster)
                    .platz(24.5, versatz + blockOben, 353, raster.hoehe)

                VStack(spacing: 10) {
                    if !daten.telemetrie.isEmpty { telemetrieBlock(daten) }
                    schadensBericht
                }
                .frame(width: 353)
                .background(GeometryReader { g in
                    Color.clear.preference(key: DispoFahrzeugHoehe.self, value: g.size.height)
                })
                .platz(24.5, versatz + unterBlock, 353, nil)
            }
        }
        .onPreferenceChange(DispoFahrzeugHoehe.self) { unterHoehe = $0 }
        .overlay { FussleisteUnten() }
        .task {
            await fahrzeugLaden()
            await daten.starten(fahrzeugID: fahrzeugID)
        }
        .onDisappear { Task { await daten.beenden() } }
        .webVollbild(isPresented: $meldenOffen) {
            SchadenMeldenAnsicht(satz: FahrzeugAngaben(fahrzeug).dreh, schliessen: { meldenOffen = false }) { stelle, beschreibung, fotos, genau in
                let ok = await daten.melden(stelle: stelle, beschreibung: beschreibung, fotos: fotos, genau: genau)
                if ok { meldenOffen = false }
                return ok
            }
        }
    }

    private func fahrzeugLaden() async {
        guard let id = fahrzeugID else { fahrzeug = nil; return }
        let zeilen: [FahrzeugZeile]? = try? await Backend.client.from("vehicles")
            .select().eq("id", value: id).limit(1).execute().value
        fahrzeug = zeilen?.first
    }

    // MARK: Fahrzeugblock (353 breit, weiss, mit allen Angaben 332 hoch)

    private func fahrzeugBlock(_ a: FahrzeugAngaben, _ r: FahrzeugAngaben.BlockRaster) -> some View {
        let blass = Color(red: 28 / 255, green: 28 / 255, blue: 29 / 255, opacity: 0.15)
        return ZStack(alignment: .topLeading) {
            Color.white
            Text(!a.kennzeichen.isEmpty ? a.kennzeichen : (a.modell.isEmpty ? "Kein Fahrzeug" : a.modell))
                .grotesk(30, .bold, abstand: -0.5).foregroundStyle(Color(hex: 0x1C1C1D))
                .lineLimit(1).minimumScaleFactor(0.5)
                .platz(0, 15.29, 353, 36.68, .top)
            if let oben = r.bild, let dreh = a.dreh {
                FahrzeugDrehung(satz: dreh).platz(16, oben, 321, 122)
            } else if let oben = r.bild, let url = a.bild {
                FahrzeugBild(url: url).platz(51, oben, 250, 122)
            }
            if let oben = r.vin {
                (Text("VIN  ").bold() + Text(a.vin).kerning(2))
                    .font(.grotesk(13)).foregroundStyle(blass).lineLimit(1)
                    .platz(0, oben, 353, nil, .top)
            }
            if let oben = r.modell {
                Text(a.modell).grotesk(20, .bold, abstand: -0.5).foregroundStyle(Color(hex: 0x1C1C1D))
                    .lineLimit(1).minimumScaleFactor(0.6)
                    .platz(0, oben, 353, nil, .top)
            }
            if let oben = r.ausstattung {
                Text(a.ausstattung).font(.grotesk(13)).foregroundStyle(blass)
                    .platz(0, oben, 353, nil, .top)
            }
            if let oben = r.kacheln {
                FahrzeugKacheln(a: a).platz(0, oben, 353, 52, .top)
            }
        }
        .frame(width: 353, height: r.hoehe)
    }

    // MARK: Fahrzeugdaten (FahrzeugTelemetrie.jsx)

    private func telemetrieBlock(_ d: FahrzeugDaten) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("Fahrzeugdaten (OBD)").grotesk(20, .bold, abstand: -0.5).foregroundStyle(Color(hex: 0x1C1C1D))
            Rectangle().fill(Color(hex: 0xDDDCDC)).frame(height: 1).padding(.top, 12).padding(.bottom, 14)
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 10, alignment: .leading), count: 3),
                      alignment: .leading, spacing: 14) {
                ForEach(d.telemetrie) { z in
                    VStack(alignment: .leading, spacing: 5) {
                        Text(z.titel).font(.grotesk(11)).foregroundStyle(Color(red: 28 / 255, green: 28 / 255, blue: 29 / 255, opacity: 0.5))
                            .lineLimit(1)
                        Text(z.wert).font(.grotesk(18, .bold))
                            .foregroundStyle(z.warnung ? Color(hex: 0xD9381E) : Color(hex: 0x1C1C1D)).lineLimit(1)
                        if !z.unter.isEmpty {
                            Text(z.unter).font(.grotesk(11)).foregroundStyle(Color(red: 28 / 255, green: 28 / 255, blue: 29 / 255, opacity: 0.5))
                                .lineLimit(1)
                        }
                    }
                }
            }
            if !d.ereignisse.isEmpty {
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(d.ereignisse) { e in
                        Text("\(e.zeit) · \(e.text)").font(.grotesk(12)).lineLimit(1)
                            .frame(height: 18, alignment: .leading)
                    }
                }
                .foregroundStyle(Color(red: 28 / 255, green: 28 / 255, blue: 29 / 255, opacity: 0.6))
                .padding(.top, 14)
            }
            if !d.telemetrieStand.isEmpty {
                Text("Stand \(d.telemetrieStand)").font(.grotesk(11))
                    .foregroundStyle(Color(red: 28 / 255, green: 28 / 255, blue: 29 / 255, opacity: 0.35)).padding(.top, 10)
            }
        }
        .padding(29)
        .frame(width: 353, alignment: .leading)
        .background(Color.white)
    }

    // MARK: Schadensbericht

    private var schadensBericht: some View {
        let schaeden = daten.schaeden
        let satz = FahrzeugAngaben(fahrzeug).dreh
        return VStack(alignment: .leading, spacing: 0) {
            Text("Schadensbericht").grotesk(15, .bold, abstand: -0.5).foregroundStyle(Color(hex: 0xDDDCDC))
                .padding(.bottom, 10)
            Rectangle().fill(Color(hex: 0xDDDCDC)).frame(height: 1).padding(.bottom, 10)
            ForEach(Array(schaeden.enumerated()), id: \.element.id) { i, s in
                VStack(alignment: .leading, spacing: 0) {
                    Text(s.datum).grotesk(15, .bold, abstand: -0.5).foregroundStyle(Color(hex: 0xDDDCDC)).padding(.bottom, 10)
                    HStack(alignment: .top, spacing: 14) {
                        VStack(alignment: .leading, spacing: 0) {
                            Text(s.stelle).grotesk(10, .bold, abstand: -0.5).foregroundStyle(Color(hex: 0x1D1C1C)).padding(.bottom, 5)
                            Text(s.beschreibung).grotesk(14, .bold, abstand: -0.5).foregroundStyle(Color(hex: 0x1D1C1C))
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        if StelleAnsicht.passt(s.genau, satz), let satz, let g = s.genau, let k = g.ansicht, let b = g.bildPunkt {
                            StelleAnsicht(satz: satz, ansicht: k, bild: b)
                        } else if let p = s.punkt { FahrzeugSkizze.Ansicht(punkt: p, hoehe: 96) }
                    }
                    .padding(.bottom, 10)
                    if !s.bilder.isEmpty {
                        HStack(spacing: 4) {
                            ForEach(s.bilder, id: \.self) { url in
                                AsyncImage(url: URL(string: url)) { phase in
                                    if let b = phase.image { b.resizable().scaledToFill() } else { Color(hex: 0xF4F4F4) }
                                }
                                .frame(maxWidth: .infinity).frame(height: 96).clipped()
                            }
                        }
                        .padding(.bottom, 10)
                    }
                    if !s.gemeldetVon.isEmpty {
                        Text("gemeldet von \(s.gemeldetVon)").font(.grotesk(11))
                            .foregroundStyle(Color(red: 28 / 255, green: 28 / 255, blue: 29 / 255, opacity: 0.5))
                            .lineLimit(1).padding(.bottom, 10)
                    }
                    if i < schaeden.count - 1 {
                        Rectangle().fill(Color(hex: 0xDDDCDC)).frame(height: 1).padding(.bottom, 10)
                    }
                }
                .padding(.bottom, 10)
            }
            if fahrzeugID != nil {
                Button { meldenOffen = true } label: {
                    HStack {
                        Text("Schaden melden").grotesk(16, .bold, abstand: -0.5).foregroundStyle(.black)
                        Spacer()
                        Image("PfeilDunkel").resizable().frame(width: 34, height: 20)
                    }
                    .padding(.horizontal, 24)
                    .frame(maxWidth: .infinity).frame(height: 56)
                    .background(Color(hex: 0xE3F654))
                }
                .buttonStyle(.web)
                .padding(.top, 10)
            }
        }
        .padding(29)
        .frame(width: 353, alignment: .leading)
        .background(Color.white)
    }
}

private struct DispoFahrzeugHoehe: PreferenceKey {
    static var defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) { value = max(value, nextValue()) }
}

/// Kleines Fahrzeugbild im Fahrerblatt der Karte: dasselbe Bild wie auf der Startseite der
/// Fahrer-App (360-Grad-Satz stehend, sonst das Standbild). Laedt die vehicles-Zeile selbst.
struct DispoFahrzeugMiniBild: View {
    let fahrzeugID: String
    @State private var fahrzeug: FahrzeugZeile?
    @ObservedObject private var bilder = FahrzeugBildSpeicher.shared
    @ObservedObject private var katalog = DrehKatalog.shared

    var body: some View {
        let a = FahrzeugAngaben(fahrzeug)
        Group {
            if let dreh = a.dreh {
                FahrzeugDrehung(satz: dreh, stehend: true)
            } else if let url = a.bild {
                FahrzeugBild(url: url)
            } else {
                Color.clear
            }
        }
        .allowsHitTesting(false)
        .task(id: fahrzeugID) {
            guard let id = UUID(uuidString: fahrzeugID) else { fahrzeug = nil; return }
            let zeilen: [FahrzeugZeile]? = try? await Backend.client.from("vehicles")
                .select().eq("id", value: id).limit(1).execute().value
            fahrzeug = zeilen?.first
        }
    }
}
