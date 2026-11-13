import CoreLocation
import SwiftUI

/// Dienststart mit Treffpunkt, angetippt in der Fahrtenliste (Nachbau von DienstStartDetail.jsx, 13.11.).
/// Aufbau wie eine Fahrt (SoloNormalAnsicht): oben die Karte mit der Route vom Standort zum Treffpunkt
/// (Flagge am Ziel), darunter das ziehbare Blatt mit Dienststart, Ort (antippen = Navigation) und der
/// Notiz der Dispo.
struct DienstStartAnsicht: View {
    let dienstID: UUID
    var zurueck: () -> Void

    @EnvironmentObject private var speicher: FahrtenSpeicher
    @EnvironmentObject private var ortung: Ortung
    @ObservedObject private var orte = OrteSpeicher.geteilt
    @Environment(\.openURL) private var oeffnen

    @State private var blattProzent: CGFloat = 50
    @State private var ziehBeginn: CGFloat?
    @State private var karte = KarteAnsicht.Inhalt()

    private static let lime = Color(hex: 0xE2F754)
    private static let grau = Color(hex: 0x868786)

    private var dienst: DienstAnfrage? { speicher.dienstAnfragen.first { $0.id == dienstID } }
    private var treffpunkt: DienstTreffpunkt? { dienst?.treffpunkt }

    var body: some View {
        GeometryReader { geo in
            let hoehe = geo.size.height
            let blattHoehe = hoehe * blattProzent / 100
            ZStack(alignment: .bottom) {
                if treffpunkt?.hatOrt == true {
                    KarteAnsicht(inhalt: karte, untenFrei: blattHoehe)
                        .ignoresSafeArea()
                } else {
                    Color(hex: 0x101112).ignoresSafeArea()
                }

                infoBlatt(hoehe: hoehe)
                    .frame(height: blattHoehe)
                    .animation(ziehBeginn == nil ? .timingCurve(0.22, 1, 0.36, 1, duration: 0.32) : nil, value: blattProzent)

                TrisarFussleiste()
            }
            .overlay(alignment: .topLeading) {
                DienstKarteZurueck(aktion: zurueck).padding(.leading, 20).padding(.top, 60)
            }
            .ignoresSafeArea()
        }
        .background(Color(hex: 0x0A0A0A))
        .task(id: routenSchluessel) { await routenBerechnen() }
        // Dienst weg (abgelehnt, ersetzt ohne Treffpunkt): zurueck zur Liste.
        .onChange(of: dienst == nil) { _, weg in if weg { zurueck() } }
    }

    // MARK: - Infoblatt

    @ViewBuilder
    private func infoBlatt(hoehe: CGFloat) -> some View {
        VStack(spacing: 0) {
            // Griff: 87 x 6 Lime, 18 Luft oben und unten.
            Rectangle().fill(Self.lime).frame(width: 87, height: 6)
                .padding(.vertical, 18)
                .frame(maxWidth: .infinity)
                .contentShape(Rectangle())
                .gesture(
                    DragGesture(minimumDistance: 2, coordinateSpace: .global)
                        .onChanged { wert in
                            if ziehBeginn == nil { ziehBeginn = blattProzent }
                            let neu = (ziehBeginn ?? 50) - wert.translation.height / hoehe * 100
                            blattProzent = min(max(neu, 25), 85)
                        }
                        .onEnded { _ in
                            ziehBeginn = nil
                            blattProzent = blattProzent > 70 ? 85 : (blattProzent < 40 ? 25 : 50)
                        }
                )

            ScrollView(.vertical, showsIndicators: false) {
                blattInhalt
                    .padding(.horizontal, 20)
                    .padding(.bottom, 24)
            }
            .scrollBounceBehavior(.basedOnSize)
        }
        .frame(maxWidth: .infinity)
        .background(Color(hex: 0x1A1A1A))
        .clipShape(UnevenRoundedRectangle(topLeadingRadius: 20, topTrailingRadius: 20))
        .shadow(color: .black.opacity(0.5), radius: 20, y: -10)
    }

    @ViewBuilder
    private var blattInhalt: some View {
        let zeit = String((dienst?.service_start_time ?? "").prefix(5))
        VStack(alignment: .leading, spacing: 0) {
            // Wie ETD einer Fahrt: Beschriftung klein grau, Zeit gross in Lime, rechts das Datum.
            HStack(alignment: .top, spacing: 8) {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Dienststart").grotesk(12, .bold, abstand: -0.3).foregroundStyle(Self.grau)
                    WebText(text: zeit.isEmpty ? "--:--" : zeit, groesse: 32, gewicht: .bold, zeilenHoehe: 32 * 0.88,
                            abstand: -1, farbe: UIColor(hex: 0xE2F754))
                        .fixedSize()
                }
                Spacer(minLength: 0)
                Text(Self.datumText(dienst?.service_date ?? "")).grotesk(12, .bold, abstand: -0.3)
                    .foregroundStyle(Self.grau)
                    .multilineTextAlignment(.trailing)
            }

            if let tp = treffpunkt, tp.hatOrt {
                let url = Self.navigationsURL(tp)
                HStack(alignment: .center, spacing: 16) {
                    Image(tp.iconGrau(orte)).resizable().scaledToFit().frame(width: 30, height: 30)
                        .frame(width: 64, height: 64)
                        .background(Color(hex: 0x242525))
                        .clipShape(RoundedRectangle(cornerRadius: 16))
                    VStack(alignment: .leading, spacing: 0) {
                        Text("Treffpunkt").grotesk(14, .bold, abstand: -0.5).foregroundStyle(Self.grau)
                        Button {
                            if let url { oeffnen(url) }
                        } label: {
                            Text(tp.name)
                                .font(.grotesk(18, .bold)).tracking(-0.5)
                                .foregroundStyle(.white)
                                .underline(url != nil, color: Self.lime)
                                .multilineTextAlignment(.leading)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        .buttonStyle(.web)
                        if !tp.adresse.isEmpty && tp.adresse != tp.name {
                            Text(tp.adresse).grotesk(14, .bold, abstand: -0.5).foregroundStyle(Self.grau)
                                .fixedSize(horizontal: false, vertical: true)
                                .padding(.top, 4)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .padding(.top, 44)
            }

            if let tp = treffpunkt, !tp.notiz.isEmpty {
                // Notiz wie bei einer Fahrt: Titel gross in Lime, Zeit und Datum grau, Text weiss.
                let z = tp.notizZeit
                WebText(text: "Notiz", groesse: 58, gewicht: .bold, zeilenHoehe: 52, abstand: -1, farbe: UIColor(hex: 0xE2F754))
                    .fixedSize()
                    .frame(height: 52, alignment: .topLeading)
                    .padding(.top, 40)
                VStack(alignment: .leading, spacing: 6) {
                    HStack(spacing: 0) {
                        Text(z.zeit)
                        if !z.datum.isEmpty { Text(z.datum).padding(.leading, 44) }
                        Spacer(minLength: 8)
                        Text("Dispo").multilineTextAlignment(.trailing)
                    }
                    .font(.grotesk(16, .bold)).tracking(-0.5)
                    .foregroundStyle(Self.grau)
                    .frame(height: 16)
                    WebText(text: tp.notiz, groesse: 18, gewicht: .bold, zeilenHoehe: 22, abstand: -0.5, farbe: UIColor(hex: 0xF4F5F4))
                }
                .padding(.top, 12)
            }

            // Platz ueber der Fussleiste.
            Spacer().frame(height: 60 + 40)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    // MARK: - Karte

    private var fahrerOrt: CLLocationCoordinate2D? { ortung.letztePosition?.coordinate }

    /// Neu rechnen, wenn sich Treffpunkt oder (grob) der Standort aendert.
    private var routenSchluessel: String {
        let f = fahrerOrt.map { "\(Int($0.latitude * 200)),\(Int($0.longitude * 200))" } ?? "-"
        let tp = treffpunkt
        return "\(tp?.name ?? "")|\(tp?.adresse ?? "")|\(tp?.lat ?? 0)|\(tp?.lng ?? 0)|\(f)"
    }

    /// Wie eine laufende Fahrt: blaue Route vom Standort zum Treffpunkt, Flagge am Ziel.
    private func routenBerechnen() async {
        guard let tp = treffpunkt, tp.hatOrt else { return }
        // Gespeicherte Koordinaten, sonst der Pin des eigenen Orts, erst dann die Adresse suchen.
        var ziel = tp.punkt ?? orte.ort(tp.ortID)?.punkt
        if ziel == nil { ziel = await Routen.punkt(fuer: tp.adresse.isEmpty ? tp.name : tp.adresse) }
        var neu = KarteAnsicht.Inhalt()
        neu.ziel = ziel
        neu.fahrer = fahrerOrt
        if let start = fahrerOrt, let ziel {
            let s = await Routen.strecke(von: start, bis: ziel)
            neu.fahrt = s.punkte
            neu.fahrtMinuten = s.minuten
        }
        karte = neu
    }

    // MARK: - Hilfen

    /// "Freitag, 13.11." wie toLocaleDateString(weekday long, day, month).
    static func datumText(_ iso: String) -> String {
        let tag = String(iso.prefix(10))
        guard tag.range(of: #"^\d{4}-\d{2}-\d{2}$"#, options: .regularExpression) != nil else { return "" }
        let f = DateFormatter(); f.locale = Locale(identifier: "de_DE"); f.dateFormat = "EEEE, dd.MM."
        return f.string(from: Datum.ausTagWert(tag))
    }

    /// Google-Maps-Navigation zum Treffpunkt. Bei eigenen Orten nur die Adresse
    /// (Maps kennt Namen wie "Mercedes Event Location" nicht), ohne Adresse die Koordinaten.
    static func navigationsURL(_ tp: DienstTreffpunkt) -> URL? {
        var ziel = Adresse.fuerNavigation(name: tp.ortID != nil && !tp.adresse.isEmpty ? "" : tp.name, adresse: tp.adresse)
        if tp.adresse.isEmpty, let p = tp.punkt { ziel = "\(p.latitude),\(p.longitude)" }
        guard !ziel.isEmpty else { return nil }
        var teile = URLComponents(string: "https://www.google.com/maps/dir/")!
        teile.queryItems = [.init(name: "api", value: "1"), .init(name: "travelmode", value: "driving"),
                            .init(name: "destination", value: ziel)]
        return teile.url
    }
}

/// Zurueck auf der Karte: schwarzer Kreis 50 mit Backbutton_Karte, Schatten (wie in der Fahrt-Ansicht).
private struct DienstKarteZurueck: View {
    let aktion: () -> Void
    var body: some View {
        Button(action: aktion) {
            Image("Backbutton_Karte").resizable().frame(width: 50, height: 50)
                .background(Circle().fill(.black))
                .clipShape(Circle())
                .shadow(color: .black.opacity(0.45), radius: 8, y: 4)
        }
        .buttonStyle(.web)
        .accessibilityLabel("Zurück")
        .zurueckPerWischen(aktion)
    }
}
