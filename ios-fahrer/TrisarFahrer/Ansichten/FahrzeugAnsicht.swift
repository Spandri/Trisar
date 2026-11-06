import MapLibre
import SwiftUI

/// Nachbau von VehicleView.jsx (Raster 402 x 1264, Inhalt in einem Block bei top 20):
/// Zurueck, Karte mit Standort (Quelle + Alter als Chip), Fahrzeugblock, Fahrzeugdaten (OBD), Schadensbericht.
struct FahrzeugAnsicht: View {
    var zurueck: () -> Void
    @EnvironmentObject private var anmeldung: Anmeldung

    var body: some View {
        if let fahrer = anmeldung.fahrerID {
            FahrzeugInhalt(fahrerID: fahrer, zurueck: zurueck)
        } else {
            TrisarHintergrund()
        }
    }
}

private struct FahrzeugInhalt: View {
    var zurueck: () -> Void

    @EnvironmentObject private var speicher: FahrtenSpeicher
    @StateObject private var daten: FahrzeugDaten
    @State private var meldenOffen = false
    /// Neu zeichnen, wenn ein Fahrzeugbild nicht laedt (Karte/Block werden kuerzer).
    @ObservedObject private var bilder = FahrzeugBildSpeicher.shared

    init(fahrerID: UUID, zurueck: @escaping () -> Void) {
        self.zurueck = zurueck
        _daten = StateObject(wrappedValue: FahrzeugDaten(fahrerID: fahrerID))
    }
    @State private var unterHoehe: CGFloat = 0

    private let versatz: CGFloat = 20

    var body: some View {
        let fahrzeug = speicher.fahrzeug
        let angaben = FahrzeugAngaben(fahrzeug, ausstattung: daten.ausstattung)
        let raster = angaben.blockRaster()
        // Ohne Standort rueckt der Fahrzeugblock an die Stelle der Karte, darunter folgt
        // alles seiner Hoehe (die je nach vorhandenen Angaben schrumpft).
        let blockOben: CGFloat = daten.standort == nil ? 99 : 440
        let unterBlock = blockOben + raster.hoehe - 1
        // Web: max(1264, Unterkante Bericht) + 40 Seitenversatz + 70 Platz fuer die Fussleiste.
        let inhalt = max(1264, unterBlock + unterHoehe) + 40 + 70
        Leinwand(inhaltHoehe: inhalt, mitHintergrund: false) { rahmen in
            ZStack(alignment: .topLeading) {
                TrisarHintergrund().frame(width: 402, height: max(inhalt, rahmen))

                ZurueckKnopf(aktion: zurueck).platz(20, versatz + 40, 50, 50)

                if let ort = daten.standort {
                    ZStack(alignment: .bottomLeading) {
                        StandortKarte(ort: ort)
                        if !daten.standortQuelle.isEmpty {
                            StandortChip(quelle: daten.standortQuelle, erfasst: daten.standortZeit)
                                .padding(10)
                                .allowsHitTesting(false)
                        }
                    }
                    .platz(24.5, versatz + 99, 353, 324)
                }

                fahrzeugBlock(angaben, raster)
                    .platz(24.5, versatz + blockOben, 353, raster.hoehe)

                VStack(spacing: 10) {
                    if !daten.telemetrie.isEmpty && !FahrzeugAngaben.nurKennzeichenTest { telemetrieBlock(daten) }
                    schadensBericht
                }
                .frame(width: 353)
                .background(GeometryReader { g in
                    Color.clear.preference(key: HoeheSchluessel.self, value: g.size.height)
                })
                .platz(24.5, versatz + unterBlock, 353, nil)
            }
        }
        .onPreferenceChange(HoeheSchluessel.self) { unterHoehe = $0 }
        .overlay { FussleisteUnten() }
        .task { await daten.starten(fahrzeugID: speicher.fahrzeug?.id) }
        .onDisappear { Task { await daten.beenden() } }
        .webVollbild(isPresented: $meldenOffen) {
            SchadenMeldenAnsicht(schliessen: { meldenOffen = false }) { stelle, beschreibung, fotos, genau in
                let ok = await daten.melden(stelle: stelle, beschreibung: beschreibung, fotos: fotos, genau: genau)
                if ok { meldenOffen = false }
                return ok
            }
        }
    }

    // MARK: Fahrzeugblock (353 breit, weiss, mit allen Angaben 332 hoch)

    private func fahrzeugBlock(_ a: FahrzeugAngaben, _ r: FahrzeugAngaben.BlockRaster) -> some View {
        let blass = Color(red: 28 / 255, green: 28 / 255, blue: 29 / 255, opacity: 0.15)
        return ZStack(alignment: .topLeading) {
            Color.white
            Text(a.kennzeichen.isEmpty ? "Kein Fahrzeug" : a.kennzeichen)
                .grotesk(30, .bold, abstand: -0.5).foregroundStyle(Color(hex: 0x1C1C1D))
                .lineLimit(1).minimumScaleFactor(0.5)
                .platz(0, 15.29, 353, 36.68, .top)
            if let oben = r.bild, let url = a.bild {
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
                        if let p = s.punkt { FahrzeugSkizze.Ansicht(punkt: p, hoehe: 96) }
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
                    if i < schaeden.count - 1 {
                        Rectangle().fill(Color(hex: 0xDDDCDC)).frame(height: 1).padding(.bottom, 10)
                    }
                }
                .padding(.bottom, 10)
            }
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
        .padding(29)
        .frame(width: 353, alignment: .leading)
        .background(Color.white)
    }
}

private struct HoeheSchluessel: PreferenceKey {
    static var defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) { value = max(value, nextValue()) }
}

/// Karte (Start Zoom 15) mit dem Standortpunkt, zoom- und verschiebbar.
struct StandortKarte: UIViewRepresentable {
    let ort: CLLocationCoordinate2D

    func makeUIView(context: Context) -> MLNMapView {
        let karte = MLNMapView(frame: .zero, styleURL: KarteAnsicht.stil)
        karte.delegate = context.coordinator
        karte.logoView.isHidden = true
        karte.compassView.isHidden = true
        karte.showsScale = false
        karte.attributionButtonPosition = .bottomRight
        // Zoomen (Finger auseinander/zusammen, Doppeltippen) und Verschieben erlaubt,
        // Drehen und Kippen nicht.
        karte.isScrollEnabled = true
        karte.isZoomEnabled = true
        karte.isRotateEnabled = false
        karte.isPitchEnabled = false
        karte.backgroundColor = UIColor(red: 0x10 / 255, green: 0x11 / 255, blue: 0x12 / 255, alpha: 1)
        karte.setCenter(ort, zoomLevel: 15, animated: false)
        let p = MLNPointAnnotation()
        p.coordinate = ort
        karte.addAnnotation(p)
        context.coordinator.punkt = p
        return karte
    }

    func updateUIView(_ karte: MLNMapView, context: Context) {
        // Nur bei echter Bewegung (> 5 m) neu zentrieren. Vorher lief das bei jeder
        // Aktualisierung der Seite (Fahrzeugdaten alle paar Sekunden) und bremste die Karte.
        guard let alt = context.coordinator.punkt?.coordinate else { return }
        let weg = CLLocation(latitude: alt.latitude, longitude: alt.longitude)
            .distance(from: CLLocation(latitude: ort.latitude, longitude: ort.longitude))
        guard weg > 5 else { return }
        context.coordinator.punkt?.coordinate = ort
        karte.setCenter(ort, animated: false)
    }

    func makeCoordinator() -> Koordinator { Koordinator() }

    final class Koordinator: NSObject, MLNMapViewDelegate {
        var punkt: MLNPointAnnotation?
        func mapView(_ mapView: MLNMapView, viewFor annotation: MLNAnnotation) -> MLNAnnotationView? {
            let v = MLNAnnotationView(reuseIdentifier: nil)
            v.frame = CGRect(x: 0, y: 0, width: 30, height: 30)
            let bild = UIImageView(image: UIImage(named: "user-location-dot"))
            bild.frame = v.bounds
            v.addSubview(bild)
            return v
        }
        func mapView(_ mapView: MLNMapView, annotationCanShowCallout annotation: MLNAnnotation) -> Bool { false }
    }
}
