import PhotosUI
import SwiftUI
import UIKit

/// Nachbau von SchadenMelden.jsx (Raster 402 x 864): Foto (bis 3), Stelle per Tipp auf die
/// Aufsicht des Wagens plus Bauteil, Notiz, Abschicken. Die Bildauswahl macht das System
/// (Kamera oder Mediathek), so wie im Web auf dem Handy.
struct SchadenMeldenAnsicht: View {
    var schliessen: () -> Void
    /// Stelle ("VL – Felge"), Beschreibung, Fotos. Liefert true bei Erfolg.
    var melden: (String, String, [UIImage]) async -> Bool

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

                // Foto
                block(oben: 186, hoehe: 150) {
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
                        .frame(width: 362, height: 110)
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
                block(oben: 348, hoehe: 300) {
                    VStack(alignment: .leading, spacing: 0) {
                        HStack(alignment: .firstTextBaseline) {
                            Text("Stelle").grotesk(15, .bold, abstand: -0.5).foregroundStyle(Color(hex: 0xDDDCDC))
                            Spacer()
                            Text(stelleName.isEmpty ? "Auf dem Fahrzeug antippen" : stelleName)
                                .grotesk(14, .bold, abstand: -0.5).foregroundStyle(Color(hex: 0x1D1C1C))
                        }
                        Rectangle().fill(Color(hex: 0xDDDCDC)).frame(height: 1).padding(.top, 8)
                        wagenAufsicht
                            .frame(maxWidth: .infinity, alignment: .center)
                            .frame(height: Self.feldHoehe + 8, alignment: .bottom)
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
                        .padding(.top, 16)
                    }
                    .padding(16)
                    .frame(width: 362, height: 260, alignment: .topLeading)
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
                        _ = await melden(stelleName, text, fotos)
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
                let schwarz = Color(hex: 0x1C1C1D)
                for r in [CGRect(x: 5, y: 40, width: 13, height: 36), CGRect(x: 102, y: 40, width: 13, height: 36),
                          CGRect(x: 5, y: 164, width: 13, height: 36), CGRect(x: 102, y: 164, width: 13, height: 36),
                          CGRect(x: 6, y: 84, width: 14, height: 9), CGRect(x: 100, y: 84, width: 14, height: 9)] {
                    k.fill(Path(r), with: .color(schwarz))
                }
                let koerper = Path(roundedRect: CGRect(x: 16, y: 4, width: 88, height: 232), cornerRadius: 24)
                k.fill(koerper, with: .color(Color(hex: 0xF7F7F7)))
                k.stroke(koerper, with: .color(schwarz), lineWidth: 3)
                var vorne = Path(); vorne.addLines([CGPoint(x: 31, y: 100), CGPoint(x: 89, y: 100), CGPoint(x: 83, y: 72), CGPoint(x: 37, y: 72)]); vorne.closeSubpath()
                var hinten = Path(); hinten.addLines([CGPoint(x: 31, y: 148), CGPoint(x: 89, y: 148), CGPoint(x: 83, y: 178), CGPoint(x: 37, y: 178)]); hinten.closeSubpath()
                k.fill(vorne, with: .color(schwarz))
                k.fill(hinten, with: .color(schwarz))
                if let p = punkt {
                    // Marke bleibt ganz im Bild (Radius 17 + 2 Rand).
                    let x = min(Self.wagen.width - 19, max(19, p.x)), y = min(Self.wagen.height - 19, max(19, p.y))
                    let ring = Path(ellipseIn: CGRect(x: x - 17, y: y - 17, width: 34, height: 34))
                    k.fill(ring, with: .color(Color(hex: 0xE3F754)))
                    k.stroke(ring, with: .color(schwarz), lineWidth: 2.5)
                    k.fill(Path(ellipseIn: CGRect(x: x - 5, y: y - 5, width: 10, height: 10)), with: .color(schwarz))
                }
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
