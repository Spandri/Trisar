import SwiftUI
import UIKit

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
    /// Tastaturhoehe in Bildschirmpunkten. Die Leinwand ignoriert alle Raender, also auch die
    /// Tastatur: unten so viel Platz anhaengen, dass jedes Feld darueber gescrollt werden kann.
    @State private var tastatur: CGFloat = 0

    var body: some View {
        GeometryReader { geo in
            // Wie im Web (w-[min(402px,100vw)]): nur nach der Breite skalieren. Nach der Hoehe
            // wuerde die Flaeche auf kleineren iPhones schmaler als der Bildschirm (schwarzer Rand).
            let s = min(geo.size.width / breite, 1)
            let rahmen = max(basisHoehe, geo.size.height / max(s, 0.01))
            let hoehe = max(rahmen, inhaltHoehe) + tastatur / max(s, 0.01)
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
            .scrollDisabled(hoehe <= rahmen && tastatur == 0 && beimZiehen == nil)
            .scrollBounceBehavior(.basedOnSize)
            .refreshable { await beimZiehen?() }
            // Das Web-Raster beginnt an der Bildschirmkante. Ohne diese Zeilen schiebt die
            // ScrollView den Inhalt um die Statusleiste (59 pt), und Tipps landen daneben.
            .contentMargins(.vertical, 0, for: .scrollContent)
            .ignoresSafeArea()
            .scrollDismissesKeyboard(.interactively)
            .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillChangeFrameNotification)) { n in
                guard let r = n.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? CGRect else { return }
                tastatur = max(0, UIScreen.main.bounds.maxY - r.minY)
            }
            .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillHideNotification)) { _ in tastatur = 0 }
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
        knopf.zurueckPerWischen(aktion)
    }

    private var knopf: some View {
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
        .background(TastaturSchliesser())
    }
}

/// Wie im Browser: ein Tipp ausserhalb eines Eingabefelds schliesst die Tastatur.
/// Haengt einmal je Fenster einen Tipp-Erkenner an, der andere Tipps nicht schluckt.
private struct TastaturSchliesser: UIViewRepresentable {
    func makeUIView(context: Context) -> Anker { Anker() }
    func updateUIView(_ uiView: Anker, context: Context) {}

    final class Anker: UIView, UIGestureRecognizerDelegate {
        private static let kennung = "trisar.tastaturSchliessen"

        override func didMoveToWindow() {
            super.didMoveToWindow()
            TastaturSicht.einrichten()
            if let fenster = window { RandWischen.einrichten(fenster) }
            guard let fenster = window,
                  !(fenster.gestureRecognizers ?? []).contains(where: { $0.name == Self.kennung }) else { return }
            let tipp = UITapGestureRecognizer(target: self, action: #selector(getippt))
            tipp.name = Self.kennung
            tipp.cancelsTouchesInView = false
            tipp.delegate = self
            fenster.addGestureRecognizer(tipp)
        }

        /// Welches Feld vor dem Tipp aktiv war. Nur wenn der Tipp daran nichts geaendert hat
        /// (kein anderes Feld bekam den Fokus), wird die Tastatur geschlossen. Sonst wuerde ein
        /// Tipp auf den Rand eines Suchfelds es oeffnen und sofort wieder schliessen.
        private weak var vorher: UIView?

        @objc private func getippt(_ erkenner: UITapGestureRecognizer) {
            guard let fenster = erkenner.view, let war = vorher else { return }
            DispatchQueue.main.async {
                if let jetzt = TastaturSicht.ersterAntworter(in: fenster), jetzt === war {
                    fenster.endEditing(true)
                }
            }
        }

        func gestureRecognizer(_ g: UIGestureRecognizer, shouldReceive touch: UITouch) -> Bool {
            // Tipps in ein Eingabefeld (oder dessen Inneres) lassen die Tastatur offen.
            var v = touch.view
            while let aktuell = v {
                if aktuell is UITextField || aktuell is UITextView { return false }
                v = aktuell.superview
            }
            vorher = g.view.flatMap { TastaturSicht.ersterAntworter(in: $0) }
            return vorher != nil
        }

        func gestureRecognizer(_ g: UIGestureRecognizer,
                               shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool { true }
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

/// Schiebt das aktive Eingabefeld ueber die Tastatur, wenn es dahinter laege. Die Seiten
/// ignorieren die Tastatur (festes Web-Raster), darum macht iOS das nicht von selbst.
/// Sucht die naechste UIScrollView ueber dem Feld und scrollt sie um die Ueberdeckung.
enum TastaturSicht {
    private static var eingerichtet = false

    static func einrichten() {
        guard !eingerichtet else { return }
        eingerichtet = true
        NotificationCenter.default.addObserver(forName: UIResponder.keyboardDidShowNotification, object: nil, queue: .main) { n in
            guard let r = n.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? CGRect else { return }
            MainActor.assumeIsolated { sichtbarMachen(tastaturOben: r.minY) }
        }
    }

    @MainActor private static func sichtbarMachen(tastaturOben: CGFloat) {
        let fenster = UIApplication.shared.connectedScenes
            .compactMap { ($0 as? UIWindowScene)?.keyWindow }.first
        guard let fenster, let feld = ersterAntworter(in: fenster) else { return }
        let feldRahmen = feld.convert(feld.bounds, to: nil)
        let ueber = feldRahmen.maxY + 16 - tastaturOben
        guard ueber > 0 else { return }
        var v = feld.superview
        while let aktuell = v, !(aktuell is UIScrollView) { v = aktuell.superview }
        guard let rolle = v as? UIScrollView else { return }
        let maxY = max(0, rolle.contentSize.height - rolle.bounds.height + rolle.adjustedContentInset.bottom)
        let ziel = min(rolle.contentOffset.y + ueber, maxY)
        rolle.setContentOffset(CGPoint(x: rolle.contentOffset.x, y: ziel), animated: true)
    }

    static func ersterAntworter(in v: UIView) -> UIView? {
        if v.isFirstResponder { return v }
        for u in v.subviews { if let f = ersterAntworter(in: u) { return f } }
        return nil
    }
}

// MARK: - Vom linken Rand wischen = Zurueck

/// Wie in anderen iPhone-Apps: vom linken Bildschirmrand nach rechts wischen macht dasselbe
/// wie der Zurueck-Knopf. Jeder sichtbare Zurueck-Knopf meldet sich hier an, das Wischen
/// loest den zuletzt erschienenen aus (die oberste Seite). Ohne Zurueck-Knopf passiert nichts.
@MainActor enum RandWischen {
    private static var stapel: [(id: UUID, aktion: () -> Void)] = []
    private static let kennung = "trisar.randWischen"

    static func anmelden(_ id: UUID, _ aktion: @escaping () -> Void) {
        stapel.removeAll { $0.id == id }
        stapel.append((id, aktion))
    }

    static func abmelden(_ id: UUID) { stapel.removeAll { $0.id == id } }

    static func einrichten(_ fenster: UIWindow) {
        guard !(fenster.gestureRecognizers ?? []).contains(where: { $0.name == kennung }) else { return }
        let rand = UIScreenEdgePanGestureRecognizer(target: Ziel.shared, action: #selector(Ziel.gewischt))
        rand.edges = .left
        rand.name = kennung
        rand.delegate = Ziel.shared
        fenster.addGestureRecognizer(rand)
    }

    fileprivate static func ausloesen() {
        guard let oben = stapel.last else { return }
        UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
        oben.aktion()
    }

    final class Ziel: NSObject, UIGestureRecognizerDelegate {
        static let shared = Ziel()

        @objc func gewischt(_ g: UIScreenEdgePanGestureRecognizer) {
            guard g.state == .ended, let v = g.view else { return }
            let weg = g.translation(in: v).x, tempo = g.velocity(in: v).x
            // Weit genug oder schnell genug nach rechts, wie beim System-Zurueck.
            if weg > 70 || (weg > 25 && tempo > 400) {
                MainActor.assumeIsolated { RandWischen.ausloesen() }
            }
        }

        func gestureRecognizerShouldBegin(_ g: UIGestureRecognizer) -> Bool {
            MainActor.assumeIsolated { !RandWischen.stapel.isEmpty }
        }

        func gestureRecognizer(_ g: UIGestureRecognizer,
                               shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool { true }
    }
}

private struct ZurueckPerWischen: ViewModifier {
    let aktion: () -> Void
    @State private var id = UUID()
    func body(content: Content) -> some View {
        content
            .onAppear { RandWischen.anmelden(id, aktion) }
            .onDisappear { RandWischen.abmelden(id) }
    }
}

extension View {
    /// Diesen Zurueck-Knopf auch per Wischen vom linken Rand ausloesen.
    func zurueckPerWischen(_ aktion: @escaping () -> Void) -> some View {
        modifier(ZurueckPerWischen(aktion: aktion))
    }
}
