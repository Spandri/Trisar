import MapLibre
import Supabase
import SwiftUI
import UIKit

// Route bearbeiten (15.11.): die Dispo legt die Route einer Fahrt ueber Routenpunkte fest.
// Vollbild-Karte ueber dem Fahrt-Formular. Karte antippen = Punkt einfuegen (dort, wo er den
// kleinsten Umweg macht), Punkt antippen = entfernen. Vorschau rechnet places-proxy (route_vorschau),
// einmal ohne Punkte (schnellste, grau gestrichelt) und einmal mit Punkten (Lime).
// Gleich wie im Web (admin/src/shared/routenPunkte.js) und in Android.

private let editorLime = UIColor(hex: 0xE3F654)

/// Antwort von places-proxy route_vorschau.
struct RoutenVorschau {
    var linie: [CLLocationCoordinate2D]
    var distanzMeter: Double?
    var dauerMinuten: Double?
    var dauerVerkehrMinuten: Double?
    /// Geocodet: Start, Stopps, Ziel (nil, wenn eine Adresse nicht gefunden wurde).
    var orte: [CLLocationCoordinate2D?]
    /// Freigabe-Paket des Servers (nur mit Punkten). Fuer die App undurchsichtig: nicht auswerten,
    /// nicht umbauen, beim Speichern 1:1 als jobs.route_fest weiterreichen.
    var fest: AnyJSON?

    /// Minuten mit Verkehr, sonst ohne.
    var minuten: Double? { dauerVerkehrMinuten ?? dauerMinuten }

    private static func zahl(_ w: AnyJSON?) -> Double? {
        switch w {
        case let .integer(i)?: return Double(i)
        case let .double(d)?: return d
        case let .string(t)?: return Double(t)
        default: return nil
        }
    }

    /// Vorschau vom Server, Fehler = nil (wie routeVorschau im Web).
    @MainActor static func laden(_ adressen: [String], _ punkte: [RoutenPunkt]) async -> RoutenVorschau? {
        guard case let .success(daten) = await FahrtPruefung.aufrufen("places-proxy", [
            "aktion": .string("route_vorschau"),
            "adressen": .array(adressen.map(AnyJSON.string)),
            "punkte": .array(punkte.map { p in
                .object(["lat": .double(p.lat), "lng": .double(p.lng), "nach": .integer(p.nach)])
            }),
        ]), case let .object(o) = daten, case .bool(true)? = o["ok"] else { return nil }
        var linie: [CLLocationCoordinate2D] = []
        if case let .string(text)? = o["polyline"] { linie = FahrtDetails.polylineLesen(text) }
        var orte: [CLLocationCoordinate2D?] = []
        if case let .array(liste)? = o["orte"] {
            orte = liste.map { w in
                guard case let .object(ort) = w, let lat = zahl(ort["lat"]), let lng = zahl(ort["lng"] ?? ort["lon"]) else { return nil }
                return CLLocationCoordinate2D(latitude: lat, longitude: lng)
            }
        }
        var fest: AnyJSON?
        if case .object? = o["fest"] { fest = o["fest"] }
        return RoutenVorschau(linie: linie, distanzMeter: zahl(o["distanz_m"]), dauerMinuten: zahl(o["dauer_min"]),
                              dauerVerkehrMinuten: zahl(o["dauer_verkehr_min"]), orte: orte, fest: fest)
    }
}

/// Einfuegen eines neuen Punkts wie punktEinfuegen im Web.
enum RoutenEinfuegen {
    private enum Art { case start, punkt(Int), stopp, ziel }
    private struct Wegpunkt { let art: Art; let ort: CLLocationCoordinate2D; let nach: Int }

    private static func meter(_ a: CLLocationCoordinate2D, _ b: CLLocationCoordinate2D) -> Double {
        let dLat = (b.latitude - a.latitude) * 111_320
        let dLng = (b.longitude - a.longitude) * 111_320 * cos((a.latitude + b.latitude) / 2 * .pi / 180)
        return hypot(dLat, dLng)
    }

    /// Alle Wegpunkte in Fahrtreihenfolge: Start, Punkte(0), Stopp 1, Punkte(1), ..., Ziel.
    /// orte = [Start, ...Stopps, Ziel], fehlende Orte fallen heraus.
    private static func folge(_ orte: [CLLocationCoordinate2D?], _ punkte: [RoutenPunkt]) -> [Wegpunkt] {
        guard orte.count >= 2 else { return [] }
        let stopps = Array(orte.dropFirst().dropLast())
        var liste: [Wegpunkt] = []
        if let s = orte.first ?? nil { liste.append(Wegpunkt(art: .start, ort: s, nach: 0)) }
        for abschnitt in 0...stopps.count {
            for (i, p) in punkte.enumerated() where min(p.nach, stopps.count) == abschnitt {
                liste.append(Wegpunkt(art: .punkt(i), ort: CLLocationCoordinate2D(latitude: p.lat, longitude: p.lng), nach: abschnitt))
            }
            if abschnitt < stopps.count, let o = stopps[abschnitt] {
                liste.append(Wegpunkt(art: .stopp, ort: o, nach: abschnitt + 1))
            }
        }
        if let z = orte.last ?? nil { liste.append(Wegpunkt(art: .ziel, ort: z, nach: stopps.count)) }
        return liste
    }

    /// Neuer Punkt x dort, wo er den kleinsten Umweg macht (Luftlinie): d(p,x) + d(x,q) - d(p,q).
    static func einfuegen(orte: [CLLocationCoordinate2D?], punkte: [RoutenPunkt], x: CLLocationCoordinate2D) -> [RoutenPunkt] {
        let f = folge(orte, punkte)
        var bester: (kosten: Double, i: Int)?
        if f.count >= 2 {
            for i in 0..<(f.count - 1) {
                let kosten = meter(f[i].ort, x) + meter(x, f[i + 1].ort) - meter(f[i].ort, f[i + 1].ort)
                if bester == nil || kosten < bester!.kosten { bester = (kosten, i) }
            }
        }
        guard let bester else { return punkte + [RoutenPunkt(lat: x.latitude, lng: x.longitude, nach: 0)] }
        let davor = f[bester.i]
        // Abschnitt: nach Stopp k ist es k, nach dem Start 0, nach einem Punkt dessen Abschnitt.
        let nach: Int
        if case .start = davor.art { nach = 0 } else { nach = davor.nach }
        let neu = RoutenPunkt(lat: x.latitude, lng: x.longitude, nach: nach)
        var liste = punkte
        if case let .punkt(index) = davor.art {
            liste.insert(neu, at: index + 1)
        } else {
            let erster = liste.firstIndex { $0.nach >= nach } ?? liste.count
            liste.insert(neu, at: erster)
        }
        return liste
    }
}

// MARK: - Ansicht

struct RoutenEditorAnsicht: View {
    /// Start, Zwischenstopps, Ziel (Adressen wie gespeichert).
    let adressen: [String]
    let abbrechen: () -> Void
    /// Punkte und das „fest“ der Vorschau, die beim Tipp auf „Übernehmen“ zu sehen war (ohne Punkte nil).
    let uebernehmen: ([RoutenPunkt], AnyJSON?) -> Void

    @State private var punkte: [RoutenPunkt]
    @State private var schnellste: RoutenVorschau?
    @State private var aktuell: RoutenVorschau?
    /// Punktliste, zu der „aktuell“ gerechnet wurde. Nur wenn sie den Punkten gleicht, gilt die Vorschau.
    @State private var aktuellFuer: [RoutenPunkt]?
    @State private var laedt = true
    @State private var fehler = false
    @State private var meldung: String?
    @State private var meldungNr = 0
    @State private var einpassen = 0
    @State private var aktuellEingepasst = false

    init(adressen: [String], punkte: [RoutenPunkt], abbrechen: @escaping () -> Void,
         uebernehmen: @escaping ([RoutenPunkt], AnyJSON?) -> Void) {
        self.adressen = adressen
        self.abbrechen = abbrechen
        self.uebernehmen = uebernehmen
        _punkte = State(initialValue: punkte)
    }

    private var stoppAnzahl: Int { max(0, adressen.count - 2) }
    private var maximum: Int { RoutenPunkt.maximum(stopps: stoppAnzahl) }
    /// Angezeigte Route: ohne Punkte die schnellste.
    private var angezeigt: RoutenVorschau? { punkte.isEmpty ? schnellste : aktuell }
    private var orte: [CLLocationCoordinate2D?] { angezeigt?.orte ?? schnellste?.orte ?? [] }
    /// „Übernehmen“ erst, wenn die Vorschau zu genau den aktuellen Punkten da ist. Ohne Punkte sofort.
    private var bereit: Bool { punkte.isEmpty || (aktuell != nil && aktuellFuer == punkte) }

    var body: some View {
        ZStack(alignment: .top) {
            Color(hex: 0x0E0E0E).ignoresSafeArea()
            RoutenKarte(schnell: punkte.isEmpty ? [] : (schnellste?.linie ?? []),
                        aktuell: angezeigt?.linie ?? [],
                        orte: orte,
                        punkte: punkte,
                        einpassenSignal: einpassen,
                        getippt: tippen,
                        punktGetippt: { i in if i < punkte.count { punkte.remove(at: i) } })
                .ignoresSafeArea()
            VStack(spacing: 0) {
                kopf.padding(.horizontal, 20).padding(.top, 12)
                Spacer(minLength: 0)
                if let meldung {
                    Text(meldung)
                        .font(.grotesk(13, .bold)).foregroundStyle(.black)
                        .padding(.horizontal, 14).padding(.vertical, 8)
                        .background(Capsule().fill(formularLime))
                        .padding(.bottom, 12)
                        .transition(.opacity)
                }
                fuss
            }
        }
        .task {
            let r = await RoutenVorschau.laden(adressen, [])
            schnellste = r
            if punkte.isEmpty {
                laedt = false
                fehler = r == nil
            }
            einpassen += 1
        }
        .task(id: punkte) {
            guard !punkte.isEmpty else {
                aktuell = nil
                aktuellFuer = nil
                laedt = schnellste == nil
                fehler = false
                return
            }
            laedt = true
            // Kurz entprellen, mehrere Tipps hintereinander rechnen einmal.
            try? await Task.sleep(for: .milliseconds(300))
            if Task.isCancelled { return }
            let gerechnet = punkte
            let r = await RoutenVorschau.laden(adressen, gerechnet)
            if Task.isCancelled { return }
            aktuell = r
            aktuellFuer = r == nil ? nil : gerechnet
            laedt = false
            fehler = r == nil
            if r != nil && !aktuellEingepasst {
                aktuellEingepasst = true
                einpassen += 1
            }
        }
    }

    // MARK: Kopf

    private var kopf: some View {
        HStack(alignment: .top, spacing: 10) {
            rundKnopf("arrow.left", beschriftung: "Abbrechen", aktion: abbrechen)
            Spacer(minLength: 0)
            VStack(spacing: 2) {
                (Text("Karte antippen = ") + Text("Routenpunkt").foregroundColor(formularLime).bold())
                Text("Punkt antippen = entfernen")
                Text("grau = schnellste Route").foregroundColor(Color(hex: 0x9A9A9A))
            }
            .font(.grotesk(12.5, .medium))
            .foregroundStyle(.white)
            .multilineTextAlignment(.center)
            .padding(.horizontal, 14).padding(.vertical, 9)
            .background(RoundedRectangle(cornerRadius: 14).fill(Color.black.opacity(0.85)))
            .padding(.top, 2)
            Spacer(minLength: 0)
            rundKnopf("arrow.counterclockwise", beschriftung: "Alle Routenpunkte entfernen") { punkte = [] }
        }
    }

    /// Runder Lime-Knopf 56 wie auf der Karte (schwarzer Rand 2).
    private func rundKnopf(_ symbol: String, beschriftung: String, aktion: @escaping () -> Void) -> some View {
        Button(action: aktion) {
            ZStack {
                Circle().fill(formularLime)
                Circle().strokeBorder(.black, lineWidth: 2)
                Image(systemName: symbol).font(.system(size: 22, weight: .bold)).foregroundStyle(.black)
            }
            .frame(width: 56, height: 56)
            .contentShape(Circle())
        }
        .buttonStyle(.web)
        .accessibilityLabel(beschriftung)
    }

    // MARK: Fuss

    private var kmText: String {
        guard let m = angezeigt?.distanzMeter else { return laedt ? "…" : "–" }
        return String(format: "%.1f", m / 1000).replacingOccurrences(of: ".", with: ",") + " km"
    }

    private var minutenText: String {
        guard let m = angezeigt?.minuten else { return laedt ? "…" : "–" }
        return "\(Int(m.rounded())) min"
    }

    /// Mehrzeit gegenueber der schnellsten Route (mit Verkehr).
    private var mehrText: String? {
        guard !punkte.isEmpty, let a = aktuell?.minuten, let s = schnellste?.minuten else { return nil }
        let d = Int(a.rounded()) - Int(s.rounded())
        return d >= 0 ? "(+\(d))" : "(\(d))"
    }

    private var punkteText: String {
        let n = punkte.count
        let frei = max(0, maximum - n)
        let anzahl = n == 0 ? "Keine Routenpunkte" : (n == 1 ? "1 Routenpunkt" : "\(n) Routenpunkte")
        return "\(anzahl) · noch \(frei) frei. Der Fahrer wird in der TRISAR-App entlang dieser Route geführt."
    }

    private var fuss: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(punkte.isEmpty ? "Schnellste" : "Angepasst")
                    .font(.grotesk(15, .medium)).foregroundStyle(.white)
                Text(kmText).font(.grotesk(20, .bold)).foregroundStyle(formularLime)
                Spacer(minLength: 0)
                Text(minutenText).font(.grotesk(20, .bold)).foregroundStyle(formularLime)
                if let mehrText {
                    Text(mehrText).font(.grotesk(13, .medium)).foregroundStyle(Color(hex: 0x9A9A9A))
                }
            }
            Text(fehler ? "Route konnte nicht berechnet werden. " + punkteText : punkteText)
                .font(.grotesk(12.5, .medium))
                .foregroundStyle(fehler ? Color(hex: 0xF55757) : Color(hex: 0x9A9A9A))
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, 8)
            HStack(spacing: 14) {
                Button { punkte = [] } label: {
                    Text("Zurücksetzen").font(.grotesk(16, .bold)).foregroundStyle(formularLime)
                        .frame(maxWidth: .infinity).frame(height: 52)
                        .overlay(Rectangle().strokeBorder(formularLime, lineWidth: 2))
                        .contentShape(Rectangle())
                }
                .buttonStyle(.web)
                Button {
                    guard bereit else { return }
                    // Genau das Paket der Vorschau, die gerade zu sehen ist. Ohne Punkte gibt es keins.
                    uebernehmen(punkte, punkte.isEmpty ? nil : aktuell?.fest)
                } label: {
                    Text("Übernehmen").font(.grotesk(16, .bold)).foregroundStyle(.black)
                        .frame(maxWidth: .infinity).frame(height: 52)
                        .background(formularLime)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.web)
                .disabled(!bereit)
                .opacity(bereit ? 1 : 0.4)
            }
            .padding(.top, 18)
        }
        .padding(.horizontal, 20)
        .padding(.top, 18)
        .padding(.bottom, 16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.black.ignoresSafeArea(edges: .bottom))
        .overlay(alignment: .top) { Rectangle().fill(formularLime).frame(height: 1.5) }
    }

    // MARK: Tippen

    private func tippen(_ ort: CLLocationCoordinate2D) {
        guard punkte.count < maximum else {
            zeigeMeldung("Höchstens \(maximum) Routenpunkte")
            return
        }
        punkte = RoutenEinfuegen.einfuegen(orte: orte, punkte: punkte, x: ort)
    }

    private func zeigeMeldung(_ text: String) {
        meldungNr += 1
        let nr = meldungNr
        withAnimation(.easeOut(duration: 0.15)) { meldung = text }
        DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
            guard nr == meldungNr else { return }
            withAnimation(.easeOut(duration: 0.2)) { meldung = nil }
        }
    }
}

// MARK: - Karte

/// Marker im Routen-Editor: A/B, Zwischenstopp mit Nummer, Routenpunkt.
final class RoutenMarker: MLNPointAnnotation {
    enum Art: Equatable { case start, ziel, stopp(Int), punkt(Int) }
    let art: Art
    init(art: Art, ort: CLLocationCoordinate2D) {
        self.art = art
        super.init()
        coordinate = ort
    }
    required init?(coder: NSCoder) { fatalError() }
}

/// A/B Lime-Kreis 32 mit schwarzem Buchstaben, Stopp weisser Kreis 26 mit schwarzer Nummer,
/// Routenpunkt schwarzer Kreis 22 mit Lime-Rand 4.
final class RoutenMarkerAnsicht: MLNAnnotationView {
    override func layoutSubviews() { super.layoutSubviews(); KartenStil.rand(self) }
    init(art: RoutenMarker.Art) {
        super.init(reuseIdentifier: nil)
        let groesse: CGFloat
        let text: String?
        switch art {
        case .start, .ziel:
            groesse = 32
            backgroundColor = editorLime
            text = art == .start ? "A" : "B"
            layer.borderWidth = 2
            layer.borderColor = UIColor.black.cgColor
            layer.zPosition = 300
        case let .stopp(n):
            groesse = 26
            backgroundColor = .white
            text = "\(n)"
            layer.borderWidth = 2
            layer.borderColor = UIColor.black.cgColor
            layer.zPosition = 250
        case .punkt:
            groesse = 22
            backgroundColor = .black
            text = nil
            layer.borderWidth = 4
            layer.borderColor = editorLime.cgColor
            layer.zPosition = 400
        }
        frame = CGRect(x: 0, y: 0, width: groesse, height: groesse)
        layer.cornerRadius = groesse / 2
        if let text {
            let l = UILabel(frame: bounds)
            l.text = text
            l.textAlignment = .center
            l.font = WebText.schrift(groesse > 30 ? 15 : 13, .bold)
            l.textColor = .black
            addSubview(l)
        }
        // Tipps gehen an die Karte (die prueft selbst, ob ein Routenpunkt getroffen wurde).
        isUserInteractionEnabled = false
    }
    required init?(coder: NSCoder) { fatalError() }
}

struct RoutenKarte: UIViewRepresentable {
    var schnell: [CLLocationCoordinate2D]
    var aktuell: [CLLocationCoordinate2D]
    var orte: [CLLocationCoordinate2D?]
    var punkte: [RoutenPunkt]
    var einpassenSignal: Int
    var getippt: (CLLocationCoordinate2D) -> Void
    var punktGetippt: (Int) -> Void

    func makeCoordinator() -> Koordinator { Koordinator() }

    func makeUIView(context: Context) -> MLNMapView {
        let karte = MLNMapView(frame: .zero, styleURL: KartenStil.geteilt.url)
        karte.delegate = context.coordinator
        karte.backgroundColor = UIColor(hex: 0x0E0E0E)
        karte.setCenter(CLLocationCoordinate2D(latitude: 48.137154, longitude: 11.576124), zoomLevel: 11, animated: false)
        karte.logoView.isHidden = true
        karte.compassView.isHidden = true
        karte.showsScale = false
        karte.isRotateEnabled = false
        karte.isPitchEnabled = false
        karte.attributionButtonPosition = .bottomRight
        karte.attributionButton.tintColor = UIColor(white: 0.6, alpha: 0.8)
        let tipp = UITapGestureRecognizer(target: context.coordinator, action: #selector(Koordinator.getippt(_:)))
        for g in karte.gestureRecognizers ?? [] {
            if let t = g as? UITapGestureRecognizer, t.numberOfTapsRequired == 2 { tipp.require(toFail: t) }
        }
        karte.addGestureRecognizer(tipp)
        context.coordinator.karte = karte
        // Kartenstil aus dem Karten Filter (Dunkel/Hell/Farbig/Satellit), wechselt live.
        KartenStil.geteilt.anbinden(karte)
        return karte
    }

    func updateUIView(_ karte: MLNMapView, context: Context) {
        context.coordinator.setzen(self)
    }

    final class Koordinator: NSObject, MLNMapViewDelegate {
        weak var karte: MLNMapView?
        private var stand: RoutenKarte?
        private var stilGeladen = false
        private var marker: [RoutenMarker] = []
        private var markerKennung = ""
        private var einpassenSignal = 0
        private var einpassenOffen = false

        func setzen(_ neu: RoutenKarte) {
            stand = neu
            linienZeichnen()
            markerAbgleichen()
            if neu.einpassenSignal != einpassenSignal {
                einpassenSignal = neu.einpassenSignal
                einpassenOffen = true
            }
            if einpassenOffen { einpassen() }
        }

        func mapView(_ mapView: MLNMapView, didFinishLoading style: MLNStyle) {
            stilGeladen = true
            linienZeichnen()
        }

        func mapView(_ mapView: MLNMapView, annotationCanShowCallout annotation: MLNAnnotation) -> Bool { false }

        func mapView(_ mapView: MLNMapView, didSelect annotation: MLNAnnotation) {
            mapView.deselectAnnotation(annotation, animated: false)
        }

        func mapView(_ mapView: MLNMapView, viewFor annotation: MLNAnnotation) -> MLNAnnotationView? {
            guard let m = annotation as? RoutenMarker else { return nil }
            return RoutenMarkerAnsicht(art: m.art)
        }

        // MARK: Linien

        private func linienZeichnen() {
            guard stilGeladen, let stil = karte?.style, let stand else { return }
            // Schnellste Route grau gestrichelt unter der aktuellen (Lime).
            linie(stil, "routen-editor-schnell", stand.schnell, farbe: UIColor(hex: 0x666666), breite: 5, gestrichelt: true)
            linie(stil, "routen-editor-aktuell", stand.aktuell, farbe: editorLime, breite: 7, gestrichelt: false)
        }

        private func linie(_ stil: MLNStyle, _ kennung: String, _ punkte: [CLLocationCoordinate2D],
                           farbe: UIColor, breite: CGFloat, gestrichelt: Bool) {
            var p = punkte
            let form: MLNShape? = p.count >= 2 ? MLNPolylineFeature(coordinates: &p, count: UInt(p.count)) : nil
            if let q = stil.source(withIdentifier: kennung) as? MLNShapeSource {
                q.shape = form
                return
            }
            let q = MLNShapeSource(identifier: kennung, shape: form, options: nil)
            stil.addSource(q)
            let e = MLNLineStyleLayer(identifier: kennung, source: q)
            e.lineColor = NSExpression(forConstantValue: farbe)
            e.lineWidth = NSExpression(forConstantValue: breite)
            if gestrichelt {
                e.lineDashPattern = NSExpression(forConstantValue: [1.2, 1.4])
            } else {
                e.lineCap = NSExpression(forConstantValue: "round")
            }
            e.lineJoin = NSExpression(forConstantValue: "round")
            stil.addLayer(e)
        }

        // MARK: Marker

        private func markerAbgleichen() {
            guard let karte, let stand else { return }
            var neu: [RoutenMarker] = []
            let orte = stand.orte
            if orte.count >= 2 {
                if let s = orte.first ?? nil { neu.append(RoutenMarker(art: .start, ort: s)) }
                for (i, o) in orte.dropFirst().dropLast().enumerated() {
                    if let o { neu.append(RoutenMarker(art: .stopp(i + 1), ort: o)) }
                }
                if let z = orte.last ?? nil { neu.append(RoutenMarker(art: .ziel, ort: z)) }
            }
            for (i, p) in stand.punkte.enumerated() {
                neu.append(RoutenMarker(art: .punkt(i), ort: CLLocationCoordinate2D(latitude: p.lat, longitude: p.lng)))
            }
            let kennung = neu.map { "\($0.art)@\($0.coordinate.latitude),\($0.coordinate.longitude)" }.joined(separator: "|")
            guard kennung != markerKennung else { return }
            markerKennung = kennung
            let alt = marker
            marker = neu
            // Nie mitten im Zeichnen der Karte aendern (MapLibre-Absturz Dispo Build 19), daher spaeter.
            DispatchQueue.main.async { [weak karte] in
                karte?.removeAnnotations(alt)
                karte?.addAnnotations(neu)
            }
        }

        // MARK: Einpassen

        private func einpassen() {
            guard let karte, let stand else { return }
            let alle = stand.aktuell + stand.schnell + stand.orte.compactMap { $0 }
                + stand.punkte.map { CLLocationCoordinate2D(latitude: $0.lat, longitude: $0.lng) }
            guard !alle.isEmpty else { return }
            guard karte.bounds.width > 10 else {
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) { [weak self] in
                    if self?.einpassenOffen == true { self?.einpassen() }
                }
                return
            }
            einpassenOffen = false
            let lats = alle.map(\.latitude), lngs = alle.map(\.longitude)
            var sw = CLLocationCoordinate2D(latitude: lats.min()!, longitude: lngs.min()!)
            var ne = CLLocationCoordinate2D(latitude: lats.max()!, longitude: lngs.max()!)
            // Ein einzelner Ort: etwas Umgebung zeigen.
            if ne.latitude - sw.latitude < 0.002 { sw.latitude -= 0.004; ne.latitude += 0.004 }
            if ne.longitude - sw.longitude < 0.002 { sw.longitude -= 0.006; ne.longitude += 0.006 }
            // Oben Knoepfe und Hinweis, unten das Feld mit Zahlen und Knoepfen.
            karte.setVisibleCoordinateBounds(MLNCoordinateBounds(sw: sw, ne: ne),
                                             edgePadding: UIEdgeInsets(top: 150, left: 40, bottom: 300, right: 40),
                                             animated: true, completionHandler: nil)
        }

        // MARK: Tippen

        @objc func getippt(_ g: UITapGestureRecognizer) {
            guard let karte, let stand else { return }
            let stelle = g.location(in: karte)
            // Getroffener Routenpunkt (naechster innerhalb 24 pt): entfernen.
            var treffer: (abstand: CGFloat, i: Int)?
            for (i, p) in stand.punkte.enumerated() {
                let s = karte.convert(CLLocationCoordinate2D(latitude: p.lat, longitude: p.lng), toPointTo: karte)
                let d = hypot(s.x - stelle.x, s.y - stelle.y)
                if d <= 24 && (treffer == nil || d < treffer!.abstand) { treffer = (d, i) }
            }
            if let treffer {
                stand.punktGetippt(treffer.i)
                return
            }
            stand.getippt(karte.convert(stelle, toCoordinateFrom: karte))
        }
    }
}
