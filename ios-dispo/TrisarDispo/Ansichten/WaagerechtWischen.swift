import SwiftUI
import UIKit

/// Waagerechtes Wischen innerhalb einer Scrollliste. Eine SwiftUI-DragGesture blockiert ab
/// iOS 18 das senkrechte Scrollen, sobald man auf dem Element ansetzt. Ab iOS 18 deshalb ein
/// UIKit-Erkenner, der nur startet, wenn die Bewegung eher waagerecht ist; senkrecht scrollt
/// die Liste wie gewohnt. Unter iOS 17 bleibt die DragGesture (dort tritt das Problem nicht auf).
extension View {
    func waagerechtWischen(aktiv: Bool = true,
                           geaendert: @escaping (CGFloat) -> Void,
                           beendet: @escaping (CGFloat) -> Void) -> some View {
        modifier(WaagerechtWischen(aktiv: aktiv, geaendert: geaendert, beendet: beendet))
    }
}

private struct WaagerechtWischen: ViewModifier {
    let aktiv: Bool
    let geaendert: (CGFloat) -> Void
    let beendet: (CGFloat) -> Void

    func body(content: Content) -> some View {
        if #available(iOS 18.0, *) {
            content.gesture(WischErkenner(aktiv: aktiv, geaendert: geaendert, beendet: beendet))
        } else {
            content.simultaneousGesture(
                DragGesture(minimumDistance: 8)
                    .onChanged { w in
                        guard aktiv, abs(w.translation.width) >= abs(w.translation.height) else { return }
                        geaendert(w.translation.width)
                    }
                    .onEnded { w in if aktiv { beendet(w.translation.width) } },
                including: aktiv ? .all : .subviews)
        }
    }
}

@available(iOS 18.0, *)
private struct WischErkenner: UIGestureRecognizerRepresentable {
    let aktiv: Bool
    let geaendert: (CGFloat) -> Void
    let beendet: (CGFloat) -> Void

    func makeCoordinator(converter: CoordinateSpaceConverter) -> Koordinator { Koordinator() }

    func makeUIGestureRecognizer(context: Context) -> UIPanGestureRecognizer {
        let erkenner = UIPanGestureRecognizer()
        erkenner.delegate = context.coordinator
        erkenner.cancelsTouchesInView = false
        return erkenner
    }

    func updateUIGestureRecognizer(_ erkenner: UIPanGestureRecognizer, context: Context) {
        erkenner.isEnabled = aktiv
    }

    func handleUIGestureRecognizerAction(_ erkenner: UIPanGestureRecognizer, context: Context) {
        let x = erkenner.translation(in: erkenner.view).x
        switch erkenner.state {
        case .changed: geaendert(x)
        case .ended, .cancelled, .failed: beendet(x)
        default: break
        }
    }

    final class Koordinator: NSObject, UIGestureRecognizerDelegate {
        /// Nur bei eher waagerechter Bewegung starten, sonst gehoert sie der Scrollliste.
        func gestureRecognizerShouldBegin(_ g: UIGestureRecognizer) -> Bool {
            guard let pan = g as? UIPanGestureRecognizer else { return true }
            let v = pan.velocity(in: pan.view)
            return abs(v.x) > abs(v.y)
        }

        func gestureRecognizer(_ g: UIGestureRecognizer,
                               shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool { false }
    }
}
