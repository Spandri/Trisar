import SwiftUI

/// Ziele der Dispo-App (Ansichtsnamen wie in admin/src/App.jsx).
enum DispoZiel: Hashable {
    case start, karte, fahrten, fahrzeuge, fahrer, kunden, planung, kiAssistent, fahrtNeu, profil
}

/// NaviFooterKomponente + Navibar.jsx: Leiste 362 x 78 bei left 20, 39 ueber dem unteren Rand,
/// darueber 32 pt weicher Uebergang nach Schwarz. Masse aus den Prozent-Angaben umgerechnet.
struct Navileiste: View {
    let aktiv: DispoZiel
    let waehlen: (DispoZiel) -> Void
    @AppStorage("admin_nav_quick_selected_v1") private var schnellFahrten = "fahrten"
    @AppStorage("admin_nav_ki_selected_v1") private var schnellKi = "planung"
    /// Welches Schnellwahl-Feld gerade aufgeklappt ist (0 Fahrten, 1 Planung/KI). Hoechstens eins.
    @State private var offenesFeld: Int?

    private func offenBindung(_ feld: Int) -> Binding<Bool> {
        Binding(get: { offenesFeld == feld },
                set: { offen in
                    withAnimation(Navileiste.feder) {
                        if offen { offenesFeld = feld } else if offenesFeld == feld { offenesFeld = nil }
                    }
                })
    }

    /// Eine Feder fuer alles in der Leiste: schnell, leicht nachfedernd.
    static let feder = Animation.spring(response: 0.22, dampingFraction: 0.8)

    var body: some View {
        VStack(spacing: 0) {
            Spacer(minLength: 0)
            ZStack(alignment: .topLeading) {
                LinearGradient(stops: [.init(color: .clear, location: 0), .init(color: .black, location: 32 / 131)],
                               startPoint: .top, endPoint: .bottom)
                leiste.platz(20, 32, 362, 78)
            }
            .frame(width: 402, height: 131)
            .frame(maxWidth: .infinity)
            // Web: Leiste bottom 39px, Footer 40px hoch -> Leiste sitzt direkt auf dem Footer.
            .padding(.bottom, -1)
            TrisarFussleiste()
        }
        // Wie der pointerdown-Hoerer im Web: ein Tipp irgendwo daneben klappt das Menue zu.
        .background {
            if offenesFeld != nil {
                Color.white.opacity(0.001)
                    .contentShape(Rectangle())
                    .onTapGesture { withAnimation(Navileiste.feder) { offenesFeld = nil } }
            }
        }
        .ignoresSafeArea()
    }

    private var leiste: some View {
        ZStack(alignment: .topLeading) {
            RoundedRectangle(cornerRadius: 39).fill(Color(hex: 0x1E1E1E)).platz(0, 1, 281, 76)
            RoundedRectangle(cornerRadius: 39).fill(Color(hex: 0x111217))
                .overlay(RoundedRectangle(cornerRadius: 39).stroke(Color(hex: 0x3B3F47), lineWidth: 1))
                .platz(284, 1, 78, 76)
            ForEach([7.0, 76, 144, 212], id: \.self) { x in
                Capsule().fill(Color(hex: 0x1E1E1E)).opacity(0.1).platz(x, 8, x == 144 ? 62 : 62, 62)
            }
            // Blauer Kreis unter dem Plus.
            Circle().fill(RadialGradient(stops: [
                .init(color: Color(hex: 0x0048CF), location: 0), .init(color: Color(hex: 0x00369B), location: 0.17),
                .init(color: Color(hex: 0x002468), location: 0.34), .init(color: Color(hex: 0x00091A), location: 0.6),
                .init(color: .black, location: 0.68), .init(color: .black, location: 1),
            ], center: UnitPoint(x: 0.17, y: 0.17), startRadius: 0, endRadius: 100))
            .platz(288, 4, 70, 70)
            ForEach([72.0, 140, 210], id: \.self) { x in
                Image("nav-divider").resizable().platz(x, 22, 1, 34)
            }

            NaviKnopf(icon: aktiv == .start ? "House_Nav_Trisar_01_Lime" : "House_Nav_Trisar_01_grau",
                      groesse: CGSize(width: 24, height: 24), aktiv: aktiv == .start) { waehlen(.start) }
                .platz(7, 8, 65, 64)
            NaviKnopf(icon: aktiv == .karte ? "Pin_Nav_Trisar_Icons_01_Lime" : "Pin_Nav_Trisar_Icons_01_grau",
                      groesse: CGSize(width: 23, height: 23), aktiv: aktiv == .karte) { waehlen(.karte) }
                .platz(76, 8, 64, 64)
            SchnellwahlKnopf(
                optionen: [
                    .init(ziel: .fahrzeuge, grau: "Vehicle_Nav_Trisar_01_grau", lime: "Vehicle_Nav_Trisar_01_Lime", groesse: CGSize(width: 24, height: 24)),
                    .init(ziel: .fahrten, grau: "Arrow_Nav_Trisar_Icons_01_grau", lime: "Arrow_Nav_Trisar_Icons_01_Lime", groesse: CGSize(width: 24, height: 23)),
                    .init(ziel: .fahrer, grau: "Person_Trisar_Icons_01_grau", lime: "Person_Trisar_Icons_01_Lime", groesse: CGSize(width: 23, height: 23)),
                ],
                breite: 68, aktiv: aktiv, gewaehlt: $schnellFahrten,
                offen: offenBindung(0), waehlen: waehlen
            )
            .platz(144, 8, 68, 64)
            SchnellwahlKnopf(
                optionen: [
                    .init(ziel: .planung, grau: "KI_Trisar_Icons_01_grau", lime: "KI_Trisar_Icons_01_Lime", groesse: CGSize(width: 23, height: 23)),
                    .init(ziel: .kiAssistent, grau: "KI_Assistent_Trisar_Icons_01_grau", lime: "KI_Assistent_Trisar_Icons_01_Lime", groesse: CGSize(width: 35, height: 23)),
                ],
                breite: 64, aktiv: aktiv, gewaehlt: $schnellKi,
                offen: offenBindung(1), waehlen: waehlen
            )
            .platz(212, 8, 64, 64)
            Button { waehlen(.fahrtNeu) } label: {
                ZStack {
                    Circle().stroke(.white, lineWidth: 1.7).frame(width: 18, height: 18)
                    Path { p in p.move(to: CGPoint(x: 12, y: 8)); p.addLine(to: CGPoint(x: 12, y: 16))
                        p.move(to: CGPoint(x: 8, y: 12)); p.addLine(to: CGPoint(x: 16, y: 12)) }
                        .stroke(.white, style: StrokeStyle(lineWidth: 1.9, lineCap: .round))
                        .frame(width: 24, height: 24)
                }
                .scaleEffect(aktiv == .fahrtNeu ? 1.25 : 1)
                .frame(width: 70, height: 70)
                .contentShape(Rectangle())
            }
            .buttonStyle(.web)
            .platz(288, 4, 70, 70)
        }
        .frame(width: 362, height: 78)
    }
}

private struct NaviKnopf: View {
    let icon: String
    let groesse: CGSize
    let aktiv: Bool
    let aktion: () -> Void
    var body: some View {
        Button(action: aktion) {
            Image(icon).resizable().scaledToFit().frame(width: groesse.width, height: groesse.height)
                .scaleEffect(aktiv ? 1.1 : 0.9)
                .animation(.easeOut(duration: 0.3), value: aktiv)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .contentShape(Rectangle())
        }
        .buttonStyle(.web)
    }
}

/// Eine Moeglichkeit eines Schnellwahl-Felds.
struct SchnellwahlOption {
    let ziel: DispoZiel
    let grau: String
    let lime: String
    let groesse: CGSize
}

/// SchnellwahlKnopf aus Navibar.jsx, eine einzige Geste wie im Web:
/// - Antippen oeffnet die vorne liegende Wahl.
/// - 450 ms halten klappt die uebrigen darueber auf. Mit dem Finger nach oben
///   ziehen, die Moeglichkeit unter dem Finger waechst, loslassen waehlt sie.
/// - Loslassen ohne Moeglichkeit: Menue bleibt offen, Antippen waehlt, Tipp aufs
///   Feld oder daneben schliesst.
/// Hochziehen oeffnet das Menue sofort, Loslassen wechselt sofort die Seite.
struct SchnellwahlKnopf: View {
    let optionen: [SchnellwahlOption]
    let breite: CGFloat
    let aktiv: DispoZiel
    @Binding var gewaehlt: String
    @Binding var offen: Bool
    let waehlen: (DispoZiel) -> Void

    private static let haltenMs: UInt64 = 450
    private static let hoehe: CGFloat = 64
    private static let zeile: CGFloat = 69
    private static let menueBreite: CGFloat = 80
    /// Abstand Menue-Unterkante zur Feld-Oberkante: Feld top 8, Menue top -hoehe-2 in der Leiste.
    private static let menueLuft: CGFloat = 10

    @State private var gedrueckt = false
    @State private var langGedrueckt = false
    @State private var haltenTask: Task<Void, Never>?
    @State private var schwebt: DispoZiel?
    /// Gerade gewaehlt, Seite wechselt gleich: schon lime zeigen.
    @State private var kommt: DispoZiel?

    private func schluessel(_ z: DispoZiel) -> String { "\(z)" }

    private var vorneZiel: DispoZiel {
        if let k = kommt { return k }
        if optionen.contains(where: { $0.ziel == aktiv }) { return aktiv }
        return optionen.first { schluessel($0.ziel) == gewaehlt }?.ziel ?? optionen[0].ziel
    }
    private var weitere: [SchnellwahlOption] { optionen.filter { $0.ziel != vorneZiel } }
    private var menueHoehe: CGFloat { CGFloat(weitere.count) * Self.zeile + 6 }

    var body: some View {
        feld
            .frame(width: breite, height: Self.hoehe)
            .contentShape(Rectangle())
            .gesture(geste)
            // Menue per Layout ueber dem Feld (nicht per .offset), damit die Tipp-Flaechen stimmen.
            .overlay(alignment: .bottom) {
                if offen {
                    menue
                        .frame(width: Self.menueBreite, height: menueHoehe)
                        .padding(.bottom, Self.hoehe + Self.menueLuft)
                        .transition(.scale(scale: 0.4, anchor: .bottom).combined(with: .opacity))
                }
            }
            .onAppear {
                if optionen.contains(where: { $0.ziel == aktiv }) { gewaehlt = schluessel(aktiv) }
            }
            .onDisappear { haltenTask?.cancel() }
    }

    // MARK: Feld

    private var feld: some View {
        let vorne = vorneZiel
        let klein = weitere
        return ZStack(alignment: .topLeading) {
            ForEach(optionen, id: \.ziel) { o in
                let istVorne = o.ziel == vorne
                let eckIndex = klein.firstIndex { $0.ziel == o.ziel } ?? 0
                Image(istVorne && (o.ziel == aktiv || o.ziel == kommt) ? o.lime : o.grau)
                    .resizable().scaledToFit()
                    .frame(width: o.groesse.width, height: o.groesse.height)
                    .scaleEffect(istVorne ? (gedrueckt && !offen ? 0.96 : 1.1) : 0.58)
                    .opacity(istVorne ? 1 : 0.6)
                    .position(istVorne ? CGPoint(x: breite / 2, y: Self.hoehe / 2) : eckPunkt(o, rechts: eckIndex == 1))
                    .zIndex(istVorne ? 1 : 0)
            }
        }
        .frame(width: breite, height: Self.hoehe)
        .animation(Navileiste.feder, value: vorne)
        .animation(.easeOut(duration: 0.15), value: gedrueckt)
    }

    /// Kleine Zeichen: top 7, links bzw. rechts 7 (Mitte des ungeschrumpften Bildes).
    private func eckPunkt(_ o: SchnellwahlOption, rechts: Bool) -> CGPoint {
        CGPoint(x: rechts ? breite - 7 - o.groesse.width / 2 : 7 + o.groesse.width / 2,
                y: 7 + o.groesse.height / 2)
    }

    // MARK: Menue

    private var menue: some View {
        ZStack(alignment: .top) {
            RoundedRectangle(cornerRadius: 39).fill(Color(hex: 0x1E1E1E))
            ForEach(Array(weitere.enumerated()), id: \.element.ziel) { i, o in
                Circle().fill(Color(hex: 0x1C1917)).opacity(0.1)
                    .frame(width: 64, height: 64)
                    .padding(.top, 5 + CGFloat(i) * Self.zeile)
                if i > 0 {
                    Rectangle().fill(Color(hex: 0x54545A)).opacity(0.5)
                        .frame(width: 32, height: 1)
                        .padding(.top, 72 + CGFloat(i - 1) * Self.zeile)
                }
                Image(o.grau).resizable().scaledToFit()
                    .frame(width: o.groesse.width, height: o.groesse.height)
                    .opacity(0.6)
                    .scaleEffect(schwebt == o.ziel ? 1.3 : 1)
                    .animation(.spring(response: 0.22, dampingFraction: 0.6), value: schwebt)
                    .frame(width: 64, height: 64)
                    .contentShape(Rectangle())
                    .onTapGesture { auswaehlen(o.ziel) }
                    .padding(.top, 5 + CGFloat(i) * Self.zeile)
            }
        }
    }

    /// Moeglichkeit unter dem Finger, in Feld-Koordinaten. Grosszuegig: ganze Zeile, etwas breiter.
    private func optionAn(_ p: CGPoint) -> DispoZiel? {
        guard offen else { return nil }
        let oben = -Self.menueLuft - menueHoehe
        guard abs(p.x - breite / 2) <= Self.menueBreite / 2 + 12, p.y >= oben - 12, p.y < -Self.menueLuft + 4 else { return nil }
        let i = Int((p.y - oben) / Self.zeile)
        let liste = weitere
        return liste.indices.contains(i) ? liste[i].ziel : liste.last?.ziel
    }

    // MARK: Geste

    private var geste: some Gesture {
        DragGesture(minimumDistance: 0, coordinateSpace: .local)
            .onChanged { wert in
                if !gedrueckt {
                    gedrueckt = true
                    langGedrueckt = false
                    haltenStarten()
                }
                // Finger geht nach oben: Menue sofort auf, nicht erst nach dem Halten.
                if !offen && wert.translation.height < -8 {
                    haltenTask?.cancel()
                    menueOeffnen()
                }
                if offen {
                    let neu = optionAn(wert.location)
                    if neu != schwebt {
                        schwebt = neu
                        if neu != nil { UISelectionFeedbackGenerator().selectionChanged() }
                    }
                }
            }
            .onEnded { wert in
                haltenTask?.cancel()
                gedrueckt = false
                if offen {
                    if let ziel = optionAn(wert.location) {
                        auswaehlen(ziel)
                        return
                    }
                    schwebt = nil
                    if langGedrueckt {
                        // Nach dem Loslassen bleibt das Menue offen, Antippen geht weiter.
                        langGedrueckt = false
                        return
                    }
                    offen = false
                    return
                }
                if langGedrueckt {
                    langGedrueckt = false
                    return
                }
                UIImpactFeedbackGenerator(style: .soft).impactOccurred()
                waehlen(vorneZiel)
            }
    }

    private func haltenStarten() {
        haltenTask?.cancel()
        haltenTask = Task { @MainActor in
            try? await Task.sleep(nanoseconds: Self.haltenMs * 1_000_000)
            guard !Task.isCancelled, gedrueckt, !offen else { return }
            menueOeffnen()
        }
    }

    private func menueOeffnen() {
        langGedrueckt = true
        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
        offen = true
    }

    private func auswaehlen(_ ziel: DispoZiel) {
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
        schwebt = nil
        langGedrueckt = false
        withAnimation(Navileiste.feder) {
            kommt = ziel
            gewaehlt = schluessel(ziel)
        }
        offen = false
        // Sofort wechseln, ohne Pause.
        waehlen(ziel)
        kommt = nil
    }
}
