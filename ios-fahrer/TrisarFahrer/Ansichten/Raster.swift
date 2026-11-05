import SwiftUI

/// Die Web-App ist in einem festen Raster gebaut (402 x 874, absolute Positionen, skaliert
/// auf die Bildschirmbreite). Damit die native App gleich aussieht, nutzen die Bildschirme
/// dasselbe Raster: Masse aus dem Web-Code direkt uebernehmen.
struct Leinwand<Inhalt: View>: View {
    var breite: CGFloat = 402
    var basisHoehe: CGFloat = 874
    /// Hoehe des Inhalts im Raster. Groesser als der Bildschirm = scrollbar.
    var inhaltHoehe: CGFloat = 0
    var mitHintergrund = true
    var beimZiehen: (() async -> Void)?
    @ViewBuilder let inhalt: (_ rahmenHoehe: CGFloat) -> Inhalt

    var body: some View {
        GeometryReader { geo in
            // Wie im Web (w-[min(402px,100vw)]): nur nach der Breite skalieren. Nach der Hoehe
            // wuerde die Flaeche auf kleineren iPhones schmaler als der Bildschirm (schwarzer Rand).
            let s = min(geo.size.width / breite, 1)
            let rahmen = max(basisHoehe, geo.size.height / max(s, 0.01))
            let hoehe = max(rahmen, inhaltHoehe)
            let feld = ZStack(alignment: .topLeading) {
                inhalt(rahmen)
            }
            .frame(width: breite, height: hoehe, alignment: .topLeading)
            .scaleEffect(s, anchor: .topLeading)
            .frame(width: breite * s, height: hoehe * s, alignment: .topLeading)
            .frame(maxWidth: .infinity)

            ScrollView(.vertical, showsIndicators: false) {
                feld
            }
            .scrollDisabled(hoehe <= rahmen && beimZiehen == nil)
            .scrollBounceBehavior(.basedOnSize)
            .refreshable { await beimZiehen?() }
            // Das Web-Raster beginnt an der Bildschirmkante. Ohne diese Zeilen schiebt die
            // ScrollView den Inhalt um die Statusleiste (59 pt), und Tipps landen daneben.
            .contentMargins(.vertical, 0, for: .scrollContent)
            .ignoresSafeArea()
            // Hintergrund ueber den ganzen Bildschirm, nicht nur ueber die 402/393er Flaeche,
            // sonst bleibt bei anderer Breite ein schwarzer Streifen am Rand.
            // Ohne eigenen Hintergrund durchsichtig, damit ein Verlauf dahinter sichtbar bleibt (Dispo).
            .background {
                if mitHintergrund { TrisarHintergrund() } else { Color.clear }
            }
        }
        .ignoresSafeArea()
    }
}

extension View {
    /// Absolut platzieren wie `position: absolute; left: x; top: y; width: w; height: h`.
    func platz(_ x: CGFloat, _ y: CGFloat, _ w: CGFloat? = nil, _ h: CGFloat? = nil,
               _ ausrichtung: Alignment = .topLeading) -> some View {
        // Ueber Layout-Abstand statt .offset: so liegt die Tipp-Flaeche genau unter der Zeichnung.
        frame(width: w, height: h, alignment: ausrichtung)
            .padding(.leading, x)
            .padding(.top, y)
    }

    /// Wie `left: 50%; transform: translateX(-50%)` bei Mitte x.
    func mittig(_ mitteX: CGFloat, _ y: CGFloat, _ w: CGFloat, _ h: CGFloat? = nil,
                _ ausrichtung: Alignment = .top) -> some View {
        frame(width: w, height: h, alignment: ausrichtung)
            .padding(.leading, mitteX - w / 2)
            .padding(.top, y)
    }
}

/// Fussleiste unten am Bildschirm, wie `fixed bottom-0 h-10` in der Web-App.
struct FussleisteUnten: View {
    var body: some View {
        VStack(spacing: 0) {
            Spacer(minLength: 0)
            TrisarFussleiste()
        }
        .ignoresSafeArea()
    }
}

/// Runder Knopf oben rechts (Profil), wie in der Fahrtenliste.
struct ProfilKnopf: View {
    let aktion: () -> Void
    var body: some View {
        Button(action: aktion) {
            ZStack {
                Circle().stroke(Color(hex: 0x8F8F90), lineWidth: 1)
                Image("Person_Trisar_Icons_01_grau")
                    .resizable().scaledToFit()
                    .frame(width: 24, height: 24)
                    .opacity(0.9)
            }
            .frame(width: 52, height: 52)
            .contentShape(Circle())
        }
        .buttonStyle(.web)
        .accessibilityLabel("Profil")
    }
}

/// Zurueck-Knopf oben links (ZurueckKnopf.jsx): 50er Kreis, grauer Rand, gedrehter Pfeil.
struct ZurueckKnopf: View {
    let aktion: () -> Void
    var body: some View {
        Button(action: aktion) {
            ZStack(alignment: .topLeading) {
                Circle().stroke(Color(hex: 0x747474), lineWidth: 1).frame(width: 50, height: 50)
                Image("Arrow_Trisar_Icons_01_grau")
                    .resizable().scaledToFit()
                    .frame(width: 26.14, height: 15.91)
                    .rotationEffect(.degrees(180))
                    .scaleEffect(1.2)
                    .padding(.leading, 12.5).padding(.top, 17.05)
            }
            .frame(width: 50, height: 50, alignment: .topLeading)
            .contentShape(Circle())
        }
        .buttonStyle(.web)
        .accessibilityLabel("Zurück")
    }
}

/// Schrift mit Zeilenhoehe wie `leading-none`/`leading-[20px]`: Text ohne Extra-Abstand.
extension Text {
    func grotesk(_ groesse: CGFloat, _ gewicht: Font.Weight = .regular, abstand: CGFloat = 0) -> some View {
        font(.grotesk(groesse, gewicht)).tracking(abstand)
    }
}

// MARK: - Massstab fuer das ganze iPhone

/// Die Seiten sind wie im Web fuer 402 Punkte Breite gebaut. Hier wird die ganze Ansicht
/// (Inhalt, Leisten, Knoepfe) einmal auf die Breite des jeweiligen iPhones vergroessert oder
/// verkleinert, damit jedes Modell gleich aussieht. Die Hoehe ergibt sich daraus: kurze iPhones
/// scrollen etwas mehr, lange haben unten mehr Platz.
struct WebMassstab: ViewModifier {
    static let breite: CGFloat = 402

    func body(content: Content) -> some View {
        GeometryReader { geo in
            // Ganzer Bildschirm = sichtbarer Bereich + Raender (Statusleiste, Home-Balken, Tastatur).
            let r = geo.safeAreaInsets
            let w = geo.size.width + r.leading + r.trailing
            let h = geo.size.height + r.top + r.bottom
            let s = w > 0 ? w / Self.breite : 1
            content
                // Raender im 402er Raster weitergeben, damit Seiten wie bisher unter der
                // Statusleiste beginnen und der Tastatur ausweichen.
                .safeAreaPadding(EdgeInsets(top: r.top / s, leading: r.leading / s,
                                            bottom: r.bottom / s, trailing: r.trailing / s))
                .frame(width: Self.breite, height: h / s)
                .scaleEffect(s, anchor: .topLeading)
                .frame(width: w, height: h, alignment: .topLeading)
                .offset(x: -r.leading, y: -r.top)
        }
    }
}

extension View {
    /// Ganze Ansicht auf die iPhone-Breite skalieren (siehe WebMassstab).
    func webMassstab() -> some View { modifier(WebMassstab()) }

    /// Vollbild-Seite mit demselben Massstab (ein fullScreenCover erbt ihn nicht).
    func webVollbild<C: View>(isPresented: Binding<Bool>, onDismiss: (() -> Void)? = nil,
                              @ViewBuilder content: @escaping () -> C) -> some View {
        fullScreenCover(isPresented: isPresented, onDismiss: onDismiss) { content().webMassstab() }
    }

    func webVollbild<I: Identifiable, C: View>(item: Binding<I?>, onDismiss: (() -> Void)? = nil,
                                              @ViewBuilder content: @escaping (I) -> C) -> some View {
        fullScreenCover(item: item, onDismiss: onDismiss) { content($0).webMassstab() }
    }
}
