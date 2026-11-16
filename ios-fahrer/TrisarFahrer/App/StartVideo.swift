import SwiftUI
import UIKit
import AVFoundation

/// Startvideo 1:1 wie BootSplashGate in main.jsx (Web): startvideo.mp4 (= loadScreen.mp4),
/// bildfuellend, stumm, danach direkt die App. Nur beim Kaltstart (neuer Prozess), nicht beim
/// Zurueckholen aus dem Hintergrund. Geteilt von Fahrer- und Dispo-App (ios-dispo/project.yml).
///
/// Nahtlos: LaunchScreen.storyboard und das Bild unter dem Video sind das erste Bild des Videos,
/// der Spieler wird schon in init() der App geladen. AVPlayerLayer zeichnet ausserhalb des
/// Hauptthreads, das Video laeuft also auch dann fluessig, wenn die App beim Start noch rechnet.
enum StartVideo {
    /// Einmal je Prozess: nach dem ersten Ablauf (oder Abbruch) bleibt es aus.
    static var gezeigt = false
    static let hoechstens: TimeInterval = 8

    /// Nur nach echtem Schliessen (im App-Umschalter weggewischt), nicht wenn iOS die App im
    /// Hintergrund selbst beendet hat. Unterscheidung ueber die Fenster-Sitzung: Wegwischen verwirft
    /// sie (neue ID beim naechsten Start), nach einem System-Ende kommt dieselbe Sitzung wieder.
    static let sollZeigen: Bool = {
        guard !gezeigt else { return false }
        let szene = UIApplication.shared.connectedScenes.first { $0.session.role == .windowApplication }
        guard let id = szene?.session.persistentIdentifier else { return true }
        let schluessel = "startvideo_sitzung_v1"
        let vorher = UserDefaults.standard.string(forKey: schluessel)
        UserDefaults.standard.set(id, forKey: schluessel)
        if vorher == id {
            gezeigt = true
            freigeben()
            return false
        }
        return true
    }()
    private(set) static var spieler: AVPlayer?

    /// So frueh wie moeglich aufrufen (init der App): Datei oeffnen und puffern, noch ohne Abspielen.
    static func vorbereiten() {
        guard !gezeigt, spieler == nil,
              let url = Bundle.main.url(forResource: "startvideo", withExtension: "mp4") else { return }
        let eintrag = AVPlayerItem(asset: AVURLAsset(url: url))
        eintrag.preferredForwardBufferDuration = 5
        let s = AVPlayer(playerItem: eintrag)
        // Stumm und ohne eigene Audio-Sitzung: laufende Musik oder Navigation wird nicht unterbrochen.
        s.isMuted = true
        // Warten statt Bilder ueberspringen: sonst laeuft die Uhr des Videos schon, bevor es zeichnet, und
        // der Pfeil (0,5 bis 3,2 s) ist vorbei, wenn das erste Bild kommt (14.11.).
        s.automaticallyWaitsToMinimizeStalling = true
        s.preventsDisplaySleepDuringVideoPlayback = false
        spieler = s
    }

    static func freigeben() {
        spieler?.pause()
        spieler = nil
    }
}

/// Legt das Startvideo ueber den Inhalt, solange es laeuft.
struct StartVideoTor: ViewModifier {
    @State private var sichtbar = StartVideo.sollZeigen

    func body(content: Content) -> some View {
        content.overlay {
            if sichtbar {
                ZStack {
                    // Erstes Bild des Videos (wie LaunchScreen.storyboard), bis das Video zeichnet.
                    // overlay statt eigener Ebene: scaledToFill darf die Flaeche nicht verbreitern.
                    Color.black.overlay { Image("Startbild").resizable().scaledToFill() }.clipped()
                    StartVideoAnsicht { fertig() }
                }
                .ignoresSafeArea()
                .task {
                    // Notbremse, falls das Video nie zeichnet. Laeuft es, endet es selbst nach 4 s.
                    try? await Task.sleep(nanoseconds: UInt64(StartVideo.hoechstens * 1_000_000_000))
                    fertig()
                }
            }
        }
    }

    private func fertig() {
        guard sichtbar else { return }
        StartVideo.gezeigt = true
        sichtbar = false
        StartVideo.freigeben()
    }
}

extension View {
    func startVideo() -> some View { modifier(StartVideoTor()) }
}

private struct StartVideoAnsicht: UIViewRepresentable {
    let fertig: () -> Void

    func makeUIView(context: Context) -> SpielerFlaeche {
        let flaeche = SpielerFlaeche()
        flaeche.backgroundColor = .clear
        StartVideo.vorbereiten()
        guard let spieler = StartVideo.spieler else {
            DispatchQueue.main.async { fertig() }
            return flaeche
        }
        flaeche.spielerEbene.videoGravity = .resizeAspectFill
        flaeche.spielerEbene.player = spieler
        context.coordinator.ende = NotificationCenter.default.addObserver(
            forName: .AVPlayerItemDidPlayToEndTime, object: spieler.currentItem, queue: .main
        ) { _ in fertig() }
        context.coordinator.fehler = NotificationCenter.default.addObserver(
            forName: .AVPlayerItemFailedToPlayToEndTime, object: spieler.currentItem, queue: .main
        ) { _ in fertig() }
        // Sofort abspielen. Sobald die Ebene das erste Bild wirklich zeigt, einmal an den Anfang springen:
        // sonst ist der Pfeil (0,5 bis 3,2 s) schon vorbei, wenn die App beim Start lange rechnet (14.11.).
        spieler.play()
        let vonVorn = { spieler.seek(to: .zero, toleranceBefore: .zero, toleranceAfter: .zero) }
        if !flaeche.spielerEbene.isReadyForDisplay {
            context.coordinator.bereit = flaeche.spielerEbene.observe(\.isReadyForDisplay, options: [.new]) { ebene, _ in
                guard ebene.isReadyForDisplay else { return }
                DispatchQueue.main.async {
                    context.coordinator.bereit?.invalidate()
                    context.coordinator.bereit = nil
                    vonVorn()
                }
            }
        }
        return flaeche
    }

    func updateUIView(_ uiView: SpielerFlaeche, context: Context) {}

    static func dismantleUIView(_ uiView: SpielerFlaeche, coordinator: Beobachter) {
        uiView.spielerEbene.player = nil
        coordinator.bereit?.invalidate()
        if let e = coordinator.ende { NotificationCenter.default.removeObserver(e) }
        if let f = coordinator.fehler { NotificationCenter.default.removeObserver(f) }
    }

    func makeCoordinator() -> Beobachter { Beobachter() }

    final class Beobachter {
        var ende: NSObjectProtocol?
        var fehler: NSObjectProtocol?
        var bereit: NSKeyValueObservation?
    }

    final class SpielerFlaeche: UIView {
        override class var layerClass: AnyClass { AVPlayerLayer.self }
        var spielerEbene: AVPlayerLayer { layer as! AVPlayerLayer }
    }
}
