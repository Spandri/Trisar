import PhotosUI
import SwiftUI
import UIKit

/// Nachbau von SchadenMelden.jsx (Raster 402 x 864): Foto (bis 3), Stelle per Tipp auf die
/// Aufsicht des Wagens plus Bauteil, Notiz, Abschicken. Die Bildauswahl macht das System
/// (Kamera oder Mediathek), so wie im Web auf dem Handy.
struct SchadenMeldenAnsicht: View {
    /// Bildsatz des Fahrzeugs: mit Form drehbares Auto statt Aufsicht
    var satz: DrehSatz? = nil
    var schliessen: () -> Void
    /// Stelle ("VL – Felge"), Beschreibung, Fotos. Liefert true bei Erfolg.
    var melden: (String, String, [UIImage], SchadenStelle?) async -> Bool

    @State private var fotos: [UIImage] = []
    @State private var punkt: Punkt?
    @State private var bauteil: String?
    @State private var text = ""
    @State private var quelleWaehlen = false
    @State private var kameraOffen = false
    @State private var mediathekOffen = false
    @State private var auswahl: [PhotosPickerItem] = []
    @State private var sendet = false
    @FocusState private var fokus: Bool
    @State private var form: FahrzeugForm?
    @State private var marke: DrehStelle.Marke?

    private var mitDreh: Bool { satz != nil && form != nil }

    struct Punkt: Equatable { let x: CGFloat; let y: CGFloat; let zeile: String; let seite: String }

    // Aufsicht 120 x 240, angezeigt 150 hoch.
    private static let wagen = CGSize(width: 120, height: 240)
    private static let feldHoehe: CGFloat = 150

    private static let zonen: [String: String] = [
        "front-links": "VL", "front-mitte": "V", "front-rechts": "VR",
        "seite-links": "L", "seite-mitte": "Dach", "seite-rechts": "R",
        "heck-links": "HL", "heck-mitte": "H", "heck-rechts": "HR",
    ]
    private static let bauteile: [(String, String)] = [
        ("reifen", "Reifen"), ("felge", "Felge"), ("tuer", "Tür"), ("stossstange", "Stoßstange"),
        ("spiegel", "Spiegel"), ("scheibe", "Scheibe"), ("lack", "Lack"), ("innenraum", "Innenraum"),
    ]

    private var stelleName: String {
        let kuerzel = punkt.map { Self.zonen["\($0.zeile)-\($0.seite)"] ?? "" } ?? ""
        let teil = bauteil.flatMap { b in Self.bauteile.first { $0.0 == b }?.1 } ?? ""
        return [kuerzel, teil].filter { !$0.isEmpty }.joined(separator: " – ")
    }

    var body: some View {
        let bereit = punkt != nil && !sendet
        Leinwand(basisHoehe: 864) { _ in
            ZStack(alignment: .topLeading) {
                ZurueckKnopf(aktion: schliessen).platz(20, 60, 50, 50)

                WebText(text: "Schaden melden", groesse: 42, gewicht: .bold, zeilenHoehe: 42, abstand: -0.5, farbe: Farbe.lime.ui)
                    .platz(20, 122, 362, nil)

                // Foto (mit drehbarem Auto 30 flacher, dafuer Stelle groesser)
                block(oben: 186, hoehe: mitDreh ? 120 : 150) {
                    Button { quelleWaehlen = true } label: {
                        ZStack {
                            Color.white
                            if fotos.isEmpty {
                                HStack(spacing: 12) {
                                    KameraZeichen().frame(width: 34, height: 28)
                                    Text("Foto aufnehmen").grotesk(15, .bold, abstand: -0.5).foregroundStyle(Color(hex: 0x1D1C1C))
                                }
                            } else {
                                HStack(spacing: 2) {
                                    ForEach(Array(fotos.enumerated()), id: \.offset) { _, bild in
                                        Image(uiImage: bild).resizable().scaledToFill()
                                            .frame(maxWidth: .infinity, maxHeight: .infinity).clipped()
                                    }
                                }
                            }
                        }
                        .frame(width: 362, height: mitDreh ? 80 : 110)
                        .clipped()
                    }
                    .buttonStyle(.web)
                    .overlay(alignment: .bottomTrailing) {
                        if !fotos.isEmpty {
                            Text("Neu aufnehmen").grotesk(11, .bold, abstand: -0.5).foregroundStyle(.black)
                                .padding(.horizontal, 10).padding(.vertical, 4)
                                .background(Color(hex: 0xE3F654))
                                .padding(.trailing, 8).padding(.bottom, 8)
                                .allowsHitTesting(false)
                        }
                    }
                }

                // Stelle
                block(oben: mitDreh ? 318 : 348, hoehe: mitDreh ? 330 : 300) {
                    VStack(alignment: .leading, spacing: 0) {
                        HStack(alignment: .firstTextBaseline) {
                            Text("Stelle").grotesk(15, .bold, abstand: -0.5).foregroundStyle(Color(hex: 0xDDDCDC))
                            Spacer()
                            Text(stelleName.isEmpty ? (mitDreh ? "Auto drehen, auf die Stelle tippen" : "Auf dem Fahrzeug antippen") : stelleName)
                                .grotesk(14, .bold, abstand: -0.5).foregroundStyle(Color(hex: 0x1D1C1C))
                        }
                        Rectangle().fill(Color(hex: 0xDDDCDC)).frame(height: 1).padding(.top, 8)
                        if let satz, let form {
                            DrehStelle(satz: satz, form: form, marke: marke) { m in
                                marke = m
                                let a = form.aufsicht(m.p), b = form.bereich(m.p)
                                punkt = Punkt(x: a.x, y: a.y, zeile: b.zeile, seite: b.seite)
                            }
                            .padding(.top, 6)
                        } else {
                            wagenAufsicht
                                .frame(maxWidth: .infinity, alignment: .center)
                                .frame(height: Self.feldHoehe + 8, alignment: .bottom)
                        }
                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(spacing: 6) {
                                ForEach(Self.bauteile, id: \.0) { b in
                                    let an = bauteil == b.0
                                    Button { bauteil = an ? nil : b.0 } label: {
                                        Text(b.1).grotesk(12, .bold, abstand: -0.5).foregroundStyle(Color(hex: 0x1D1C1C))
                                            .padding(.horizontal, 10).frame(height: 30)
                                            .background(an ? Color(hex: 0xE3F654) : .white)
                                            .overlay(Rectangle().strokeBorder(an ? Color(hex: 0x1C1C1D) : Color(hex: 0xDDDCDC), lineWidth: 1))
                                    }
                                    .buttonStyle(.web)
                                }
                            }
                        }
                        // Weicher Auslauf rechts: zeigt, dass weitere Bauteile folgen.
                        .mask(LinearGradient(stops: [.init(color: .black, location: 0), .init(color: .black, location: 0.9),
                                                     .init(color: .clear, location: 1)], startPoint: .leading, endPoint: .trailing))
                        .padding(.top, mitDreh ? 10 : 16)
                    }
                    .padding(16)
                    .frame(width: 362, height: mitDreh ? 290 : 260, alignment: .topLeading)
                    .background(Color.white)
                }

                // Notiz
                block(oben: 660, hoehe: 92) {
                    TextField("", text: $text, prompt: Text(verbatim: "Schreiben...").foregroundStyle(Color(red: 129 / 255, green: 129 / 255, blue: 129 / 255, opacity: 0.5)), axis: .vertical)
                        .font(.grotesk(14)).tracking(0.25)
                        .foregroundStyle(Color.black.opacity(0.9))
                        .focused($fokus)
                        .lineLimit(2, reservesSpace: true)
                        .padding(14)
                        .frame(width: 362, height: 52, alignment: .topLeading)
                        .background(Color.white)
                        .contentShape(Rectangle())
                        .onTapGesture { fokus = true }
                }

                // Abschicken
                Button {
                    guard bereit else { return }
                    fokus = false
                    sendet = true
                    Task {
                        // Mit drehbarem Auto dazu Modell, Ansicht, Bildpunkt im Drehbild und Punkt am Auto (mm)
                        let genau = punkt.map { p -> SchadenStelle in
                            var s = SchadenStelle(x: Double(p.x), y: Double(p.y), bauteil: bauteil)
                            if mitDreh, let m = marke, let satz {
                                s.modell = satz.modell
                                s.ansicht = m.ansicht
                                s.bild = [(Double(m.bild.x) * 10).rounded() / 10, (Double(m.bild.y) * 10).rounded() / 10]
                                s.p = m.p.map { Int(($0 * 1000).rounded()) }
                            }
                            return s
                        }
                        _ = await melden(stelleName, text, fotos, genau)
                        sendet = false
                    }
                } label: {
                    HStack {
                        Text("Schaden melden").grotesk(16, .bold, abstand: -0.5)
                            .foregroundStyle(punkt != nil ? Color.black : Color(hex: 0x868786))
                        Spacer()
                        if sendet { ProgressView().tint(.black) }
                        else if punkt != nil { Image("PfeilDunkel").resizable().frame(width: 34, height: 20) }
                    }
                    .padding(.horizontal, 24)
                    .frame(width: 362, height: 56)
                    .background(punkt != nil ? Color(hex: 0xE3F754) : Color(hex: 0x3A3A3A))
                }
                .buttonStyle(.web)
                .disabled(!bereit)
                .platz(20, 764, 362, 56)
            }
        }
        .overlay { if !fokus { FussleisteUnten() } }
        .task(id: satz?.modell) {
            if let satz { form = await FormSpeicher.shared.form(satz) }
        }
        .confirmationDialog("Foto", isPresented: $quelleWaehlen) {
            if UIImagePickerController.isSourceTypeAvailable(.camera) {
                Button("Foto aufnehmen") { kameraOffen = true }
            }
            Button("Aus Mediathek wählen") { mediathekOffen = true }
            Button("Abbrechen", role: .cancel) {}
        }
        .fullScreenCover(isPresented: $kameraOffen) {
            Kamera { bild in
                if let bild { fotos = [bild] }
                kameraOffen = false
            }
            .ignoresSafeArea()
        }
        .photosPicker(isPresented: $mediathekOffen, selection: $auswahl, maxSelectionCount: 3, matching: .images)
        .onChange(of: auswahl) { _, neu in
            Task {
                var bilder: [UIImage] = []
                for eintrag in neu.prefix(3) {
                    if let daten = try? await eintrag.loadTransferable(type: Data.self), let bild = UIImage(data: daten) {
                        bilder.append(bild)
                    }
                }
                if !bilder.isEmpty { fotos = bilder }
                auswahl = []
            }
        }
    }

    /// Dunkler Kasten ueber die ganze Breite (Ecken 12), darin weiss mit 20 Rand.
    private func block<Inhalt: View>(oben: CGFloat, hoehe: CGFloat, @ViewBuilder _ inhalt: () -> Inhalt) -> some View {
        ZStack(alignment: .topLeading) {
            RoundedRectangle(cornerRadius: 12).fill(Color(hex: 0x1A1A1A))
            inhalt().padding(.leading, 20).padding(.top, 20)
        }
        .platz(0, oben, 402, hoehe)
    }

    // MARK: Aufsicht des Wagens (Front oben), Tipp setzt die Marke

    private var wagenAufsicht: some View {
        let s = Self.feldHoehe / Self.wagen.height
        let breite = Self.wagen.width * s
        return ZStack(alignment: .topLeading) {
            Canvas { k, _ in
                k.scaleBy(x: s, y: s)
                FahrzeugSkizze.zeichnen(k, punkt: punkt.map { CGPoint(x: $0.x, y: $0.y) })
            }
        }
        .frame(width: breite, height: Self.feldHoehe)
        .contentShape(Rectangle())
        .gesture(SpatialTapGesture().onEnded { wert in
            let x = wert.location.x / s, y = wert.location.y / s
            let zeile = y <= Self.wagen.height / 3 ? "front" : (y <= Self.wagen.height * 2 / 3 ? "seite" : "heck")
            let seite = x <= Self.wagen.width / 3 ? "links" : (x <= Self.wagen.width * 2 / 3 ? "mitte" : "rechts")
            punkt = Punkt(x: x, y: y, zeile: zeile, seite: seite)
        })
    }
}

/// Drehbares Auto zum Markieren, wie DrehStelle in SchadenMelden.jsx. Der Punkt sitzt auf der Karosserie
/// und dreht mit, solange die Stelle zu sehen ist. Ist sie verdeckt, blendet er aus, "Zur Markierung"
/// dreht zurueck. Wischen dreht, Tippen markiert, Pfeile drehen um 40 Grad.
struct DrehStelle: View {
    struct Marke: Equatable { let ansicht: Int; let bild: CGPoint; let p: [Double] }

    let satz: DrehSatz
    let form: FahrzeugForm
    let marke: Marke?
    let markieren: (Marke) -> Void

    @State private var bilder: [UIImage] = []
    @State private var pos: Double = 32
    @State private var ziehStart: Double?
    @State private var drehAufgabe: Task<Void, Never>?
    @State private var gestartet = false

    private var k: Int { let n = satz.bilder; return ((Int(pos.rounded()) % n) + n) % n }

    var body: some View {
        let sicht: CGPoint? = marke.flatMap { m in m.ansicht == k ? m.bild : form.sichtbar(m.p, k) }
        VStack(spacing: 6) {
            GeometryReader { geo in
                let r = drehBildRahmen(satz, geo.size)
                ZStack(alignment: .topLeading) {
                    if bilder.count == satz.bilder {
                        Image(uiImage: bilder[k]).resizable().frame(width: r.width, height: r.height).offset(x: r.minX, y: r.minY)
                    }
                    if let s = sicht {
                        SchadenMarke().position(x: r.minX + s.x / satz.breite * r.width, y: r.minY + s.y / satz.hoehe * r.height)
                    }
                }
                .frame(width: geo.size.width, height: geo.size.height, alignment: .topLeading)
                .contentShape(Rectangle())
                .gesture(
                    DragGesture(minimumDistance: 0)
                        .onChanged { g in
                            if ziehStart == nil {
                                guard abs(g.translation.width) > 6 else { return }
                                drehAufgabe?.cancel()
                                ziehStart = pos
                            }
                            if let start = ziehStart { pos = start + Double(g.translation.width) / 9 }
                        }
                        .onEnded { g in
                            if ziehStart != nil {
                                pos = pos.rounded()
                                ziehStart = nil
                                return
                            }
                            // Tippen: Strahl durch den Bildpunkt, erster Treffer auf dem Auto
                            let u = (g.location.x - r.minX) / r.width * satz.breite
                            let v = (g.location.y - r.minY) / r.height * satz.hoehe
                            let ansicht = k
                            if let p = form.treffen(ansicht, Double(u), Double(v)) {
                                markieren(Marke(ansicht: ansicht, bild: CGPoint(x: u, y: v), p: p))
                            }
                        }
                )
            }
            .frame(height: 140)
            .clipped()

            HStack(spacing: 0) {
                pfeil(links: true) { drehenNach(k - 4) }
                Spacer(minLength: 6)
                VStack(spacing: 1) {
                    Text(FahrzeugForm.ansichtName(k)).grotesk(12, .bold, abstand: -0.3).foregroundStyle(Color(hex: 0x1D1C1C))
                    if let m = marke, sicht == nil {
                        HStack(spacing: 6) {
                            Text("Von hier nicht zu sehen").grotesk(10).foregroundStyle(Color(hex: 0x9A9A9A))
                            Button { drehenNach(m.ansicht) } label: {
                                Text("Zur Markierung").grotesk(10, .bold).foregroundStyle(.black)
                                    .padding(.horizontal, 8).frame(height: 16).background(Color(hex: 0xE3F754))
                            }
                            .buttonStyle(.web)
                        }
                    } else {
                        Text(marke == nil ? "Wischen oder Pfeile zum Drehen"
                             : (marke?.ansicht == k ? "Erneut tippen verschiebt den Punkt" : "Punkt dreht mit"))
                            .grotesk(10).foregroundStyle(Color(hex: 0x9A9A9A))
                    }
                }
                .lineLimit(1)
                Spacer(minLength: 6)
                pfeil(links: false) { drehenNach(k + 4) }
            }
            .frame(height: 30)
        }
        .task(id: satz) {
            if !gestartet { pos = Double(marke?.ansicht ?? satz.start); gestartet = true }
            let s = satz
            let geladen = await withTaskGroup(of: (Int, UIImage?).self) { gruppe in
                for i in 0..<s.bilder { gruppe.addTask { (i, await s.bild(i)) } }
                var liste = [UIImage?](repeating: nil, count: s.bilder)
                for await (i, b) in gruppe { liste[i] = b }
                return liste.compactMap { $0 }
            }
            if !Task.isCancelled, geladen.count == s.bilder { bilder = geladen }
        }
        .onDisappear { drehAufgabe?.cancel() }
    }

    private func pfeil(links: Bool, aktion: @escaping () -> Void) -> some View {
        Button(action: aktion) {
            Image(systemName: links ? "chevron.left" : "chevron.right")
                .font(.system(size: 13, weight: .bold)).foregroundStyle(Color(hex: 0x1D1C1C))
                .frame(width: 40, height: 30)
                .overlay(Rectangle().strokeBorder(Color(hex: 0xDDDCDC), lineWidth: 1))
        }
        .buttonStyle(.web)
        .accessibilityLabel(links ? "Nach links drehen" : "Nach rechts drehen")
    }

    private func drehenNach(_ ziel: Int) {
        drehAufgabe?.cancel()
        let n = satz.bilder
        let von = pos
        var d = ((ziel - Int(von.rounded())) % n + n) % n
        if d > n / 2 { d -= n }
        let nach = von.rounded() + Double(d)
        let dauer = 0.22 + Double(abs(d)) * 0.03
        drehAufgabe = Task { @MainActor in
            let t0 = Date()
            while !Task.isCancelled {
                let q = min(Date().timeIntervalSince(t0) / dauer, 1)
                pos = von + (nach - von) * (1 - pow(1 - q, 3))
                if q >= 1 { break }
                try? await Task.sleep(nanoseconds: 16_000_000)
            }
        }
    }
}

/// Kamerazeichen aus dem Web (34 x 28, Linie 2,5).
private struct KameraZeichen: View {
    var body: some View {
        Canvas { k, g in
            let s = min(g.width / 34, g.height / 28)
            k.scaleBy(x: s, y: s)
            var p = Path()
            p.addLines([CGPoint(x: 2, y: 7), CGPoint(x: 10, y: 7), CGPoint(x: 13, y: 2), CGPoint(x: 21, y: 2),
                        CGPoint(x: 24, y: 7), CGPoint(x: 32, y: 7), CGPoint(x: 32, y: 26), CGPoint(x: 2, y: 26)])
            p.closeSubpath()
            k.stroke(p, with: .color(Color(hex: 0x1C1C1D)), lineWidth: 2.5)
            k.stroke(Path(ellipseIn: CGRect(x: 10.5, y: 9.5, width: 13, height: 13)), with: .color(Color(hex: 0x1C1C1D)), lineWidth: 2.5)
        }
    }
}

/// Systemkamera (Rueckkamera), ein Foto.
private struct Kamera: UIViewControllerRepresentable {
    let fertig: (UIImage?) -> Void

    func makeUIViewController(context: Context) -> UIImagePickerController {
        let p = UIImagePickerController()
        p.sourceType = .camera
        p.cameraDevice = .rear
        p.delegate = context.coordinator
        return p
    }

    func updateUIViewController(_ uiViewController: UIImagePickerController, context: Context) {}

    func makeCoordinator() -> Koordinator { Koordinator(fertig: fertig) }

    final class Koordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        let fertig: (UIImage?) -> Void
        init(fertig: @escaping (UIImage?) -> Void) { self.fertig = fertig }
        func imagePickerController(_ picker: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
            fertig(info[.originalImage] as? UIImage)
        }
        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) { fertig(nil) }
    }
}
