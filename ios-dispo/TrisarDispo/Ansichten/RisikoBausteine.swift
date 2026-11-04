import SwiftUI

/// Bausteine fuer "Risiko je Fahrt" (RisikoBausteine.jsx): Ereignis-Kacheln, Dash,
/// Sicherheitsband, Faecher, Streudiagramm und Fahrzeit-Verteilung. Die SVGs des Webs
/// sind als Canvas nachgezeichnet, Masse in Web-Pixeln.

private typealias RF = NebenRisikoFarbe

/// SVG-Text: y ist die Grundlinie. Canvas setzt nach Anker, darum grob 3,5 pt (Schrift 10) hoch.
private func svgText(_ k: GraphicsContext, _ text: String, x: CGFloat, y: CGFloat, farbe: Color,
                     groesse: CGFloat = 10, anker: UnitPoint = .leading, deckung: Double = 1) {
    let t = Text(text).font(.grotesk(groesse)).foregroundColor(farbe.opacity(deckung))
    k.draw(t, at: CGPoint(x: x, y: y - groesse * 0.35), anchor: anker)
}

// MARK: - Ereignis-Kacheln

struct EreignisKacheln: View {
    let ereignisse: [NebenEreignis]
    var klein = false
    var oeffnen: ((NebenEreignis) -> Void)?

    var body: some View {
        if !ereignisse.isEmpty {
            let breite: CGFloat = klein ? 130 : 150
            let hoehe: CGFloat = klein ? 98 : 132
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 12) {
                    ForEach(ereignisse) { e in
                        let eigen = e.quelleArt == "eigen"
                        let k = e.kachelWerte
                        let farbe = eigen ? RF.dunkel : RF.lime
                        Button { oeffnen?(e) } label: {
                            VStack(alignment: .leading, spacing: 0) {
                                Text(k.name + (eigen ? " · von dir" : ""))
                                    .font(.grotesk(klein ? 11 : 13)).lineLimit(2)
                                Spacer(minLength: 0)
                                Text(k.gross)
                                    .font(.grotesk((klein ? 24 : 32) * (k.gross.count > 6 ? 0.75 : 1), .bold))
                                    .tracking(-0.5).lineLimit(1).fixedSize()
                                Spacer(minLength: 0)
                                Text(k.klein).font(.grotesk(klein ? 11 : 12)).lineLimit(2)
                            }
                            .foregroundStyle(farbe)
                            .padding(.vertical, klein ? 10 : 14).padding(.horizontal, klein ? 12 : 16)
                            .frame(width: breite, height: hoehe, alignment: .topLeading)
                            .background(eigen ? Color(hex: 0xFEFFFE) : Color.clear)
                            .overlay(Rectangle().strokeBorder(eigen ? Color(hex: 0xFEFFFE) : RF.lime, lineWidth: 2))
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
    }
}

// MARK: - Sicherheitsband: ein Feld je Stunde

struct SicherheitsBand: View {
    let verlauf: [NebenStundenLuft]
    var breite: CGFloat = 326

    var body: some View {
        Canvas { k, _ in
            let n = max(1, verlauf.count)
            let b = breite / CGFloat(n)
            for (i, s) in verlauf.enumerated() {
                k.fill(Path(CGRect(x: CGFloat(i) * b + 1, y: 0, width: b - 2, height: 16)), with: .color(RF.luft(s.luft_p10)))
            }
            for h in [6, 10, 14, 18, 22] {
                svgText(k, String(format: "%02d", h), x: CGFloat(h - 6) * b + b / 2, y: 31, farbe: RF.lime, anker: .center)
            }
        }
        .frame(width: breite, height: 34)
        .accessibilityHidden(true)
    }
}

// MARK: - Dash im Planer

struct PufferDash: View {
    let option: NebenRisikoOption
    let ereignisAnzahl: Int
    let oeffnen: () -> Void

    var body: some View {
        let knapp = option.knappste_stunde
        let knappFarbe = RF.luft(option.verlauf.first { $0.h == knapp }?.luft_p10)
        Button(action: oeffnen) {
            VStack(alignment: .leading, spacing: 0) {
                HStack {
                    Text("Puffer je Fahrt").font(.grotesk(16, .bold))
                    Spacer()
                    Image("Arrow_Trisar_Icons_01_Lime").resizable().scaledToFit().frame(width: 28)
                }
                HStack(alignment: .top, spacing: 0) {
                    zelle(RF.zahl(option.puffer_mittel), "Ø min\nbisher mind. \(nebenBisherPufferMin)", RF.lime)
                    zelle(RF.zahl(Double(option.hoch.count)), "Fahrten\nhohes Risiko", option.hoch.isEmpty ? RF.lime : RF.rot)
                    zelle(RF.zahl(Double(ereignisAnzahl)), "Ereignisse\neingerechnet", RF.lime)
                }
                .padding(.top, 12)
                HStack(alignment: .firstTextBaseline) {
                    Text("Sicherheit über den Tag").font(.grotesk(12, .medium))
                    Spacer()
                    if let knapp {
                        Text("knappste Zeit \(knapp)–\(knapp + 1) Uhr").font(.grotesk(11)).foregroundStyle(knappFarbe)
                    }
                }
                .padding(.top, 14)
                SicherheitsBand(verlauf: option.verlauf).padding(.top, 6)
            }
            .foregroundStyle(RF.lime)
            .padding(.horizontal, 16).padding(.vertical, 14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .overlay(Rectangle().strokeBorder(RF.lime, lineWidth: 2))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private func zelle(_ wert: String, _ unter: String, _ farbe: Color) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(wert).font(.grotesk(28, .bold)).tracking(-0.5).foregroundStyle(farbe).frame(height: 32)
            WebText(text: unter, groesse: 12, zeilenHoehe: 15, farbe: UIColor(RF.lime.opacity(0.75)))
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - Faecher: Luft je Stunde ueber alle Verlaeufe

/// Je Verlauf zaehlt der knappste Anschluss der Stunde. Neun leicht deckende Baender
/// (5–95 %, 10–90 % … 45–55 %) ergeben den Farbverlauf, Linie = Median.
struct LuftFaecher: View {
    let faecher: [NebenFaecherStunde]
    var gewaehlt: Int?
    var waehlen: ((Int) -> Void)?
    var breite: CGFloat = 326
    var hoehe: CGFloat = 170

    private var f: [NebenFaecherStunde] { faecher.filter { ($0.n ?? 0) > 0 && $0.q?.count == 19 } }

    var body: some View {
        let f = self.f
        if !f.isEmpty {
            let x0: CGFloat = 28, x1 = breite - 4, y0 = hoehe - 22, ym: CGFloat = 8
            let werte = f.flatMap { [$0.q![0], $0.q![18]] }
            let max = Swift.max(20, (Swift.max(werte.max() ?? 0, 0) / 10).rounded(.up) * 10)
            let min = Swift.max(-30, Swift.min(0, (Swift.min(werte.min() ?? 0, 0) / 10).rounded(.down) * 10))
            let X = { (h: Int) -> CGFloat in x0 + CGFloat(h - 6) / 17 * (x1 - x0) }
            let Y = { (v: Double) -> CGFloat in y0 - CGFloat((Swift.max(v, min) - min) / (max - min)) * (y0 - ym) }
            Canvas { k, _ in
                // Zusammenhaengende Stunden als Stuecke.
                var stuecke: [[NebenFaecherStunde]] = []
                for (i, p) in f.enumerated() {
                    if i > 0, p.h == f[i - 1].h + 1 { stuecke[stuecke.count - 1].append(p) } else { stuecke.append([p]) }
                }
                func schichten(_ kontext: GraphicsContext, _ farbe: Color) {
                    for lo in 0...8 {
                        let hi = 18 - lo
                        for seg in stuecke {
                            if seg.count == 1, let q = seg[0].q {
                                let r = CGRect(x: X(seg[0].h) - 3, y: Y(q[hi]), width: 6, height: Y(q[lo]) - Y(q[hi]))
                                kontext.fill(Path(r), with: .color(farbe))
                            } else {
                                var p = Path()
                                let oben = seg.map { CGPoint(x: X($0.h), y: Y($0.q![hi])) }
                                let unten = seg.reversed().map { CGPoint(x: X($0.h), y: Y($0.q![lo])) }
                                p.addLines(oben + unten)
                                p.closeSubpath()
                                kontext.fill(p, with: .color(farbe))
                            }
                        }
                    }
                }
                let achse: [Double] = min < 0 ? [min] + (-min / (max - min) > 0.15 ? [0] : []) + [max] : [0, max / 2, max]
                for v in achse { svgText(k, RF.zahl(v), x: 0, y: Y(v) + 4, farbe: RF.lime) }
                for h in [6, 10, 14, 18, 22] {
                    svgText(k, String(format: "%02d", h), x: X(h), y: hoehe - 6, farbe: RF.lime, anker: .center)
                }
                var null = Path()
                null.move(to: CGPoint(x: x0, y: Y(0)))
                null.addLine(to: CGPoint(x: x1, y: Y(0)))
                k.stroke(null, with: .color(.white.opacity(0.35)), style: StrokeStyle(lineWidth: 1, dash: [3, 3]))
                var ueber = k
                ueber.clip(to: Path(CGRect(x: 0, y: 0, width: breite, height: Y(0))))
                schichten(ueber, Color(red: 227 / 255, green: 246 / 255, blue: 84 / 255, opacity: 0.12))
                if min < 0 {
                    var unter = k
                    unter.clip(to: Path(CGRect(x: x0, y: Y(0), width: x1 - x0, height: y0 - Y(0) + 1)))
                    schichten(unter, Color(red: 1, green: 111 / 255, blue: 99 / 255, opacity: 0.2))
                }
                for seg in stuecke {
                    var linie = Path()
                    linie.addLines(seg.map { CGPoint(x: X($0.h), y: Y($0.p50 ?? 0)) })
                    k.stroke(linie, with: .color(.white), lineWidth: 1.8)
                }
                if let g = gewaehlt {
                    var l = Path()
                    l.move(to: CGPoint(x: X(g), y: ym))
                    l.addLine(to: CGPoint(x: X(g), y: y0))
                    k.stroke(l, with: .color(.white.opacity(0.4)), lineWidth: 1)
                }
                for p in f {
                    let r: CGFloat = gewaehlt == p.h ? 5 : 2.6
                    let m = CGPoint(x: X(p.h), y: Y(p.p50 ?? 0))
                    k.fill(Path(ellipseIn: CGRect(x: m.x - r, y: m.y - r, width: 2 * r, height: 2 * r)), with: .color(.white))
                }
            }
            .frame(width: breite, height: hoehe)
            .contentShape(Rectangle())
            .onTapGesture { ort in
                // Tippflaeche 18 breit je Stunde wie im SVG.
                guard ort.y >= ym, ort.y <= y0, let p = f.first(where: { abs(X($0.h) - ort.x) <= 9 }) else { return }
                waehlen?(p.h)
            }
        }
    }
}

// MARK: - Streudiagramm: Puffer je Fahrt ueber den Tag

struct PufferStreuung: View {
    let fahrten: [String: NebenRisikoFahrt]
    var ereignisse: [NebenEreignis] = []
    var breite: CGFloat = 326
    var hoehe: CGFloat = 190

    var body: some View {
        Canvas { k, _ in
            let x0: CGFloat = 26, x1 = breite - 4, y0 = hoehe - 24, ym: CGFloat = 6
            // Feste Reihenfolge, damit die Punkte nicht bei jedem Zeichnen anders liegen.
            let punkte = fahrten.keys.sorted().compactMap { id -> (m: Int, p: Double, k: String)? in
                guard let f = fahrten[id], let luft = f.luft, let m = RF.minuten(f.abfahrt) else { return nil }
                return (m, luft.puffer, f.klasse)
            }
            let max = Swift.max(40, (Swift.max(punkte.map(\.p).max() ?? 0, 0) / 10).rounded(.up) * 10)
            let X = { (m: Double) -> CGFloat in x0 + CGFloat((Swift.min(Swift.max(m, 360), 1440) - 360) / 1080) * (x1 - x0) }
            let Y = { (v: Double) -> CGFloat in y0 - CGFloat(Swift.max(0, v) / max) * (y0 - ym) }
            // Nur Ereignisse, die die Engine eingerechnet hat, Name nur am ersten Zeitfenster.
            for e in ereignisse where e.art == "ereignis" && e.quelleArt == "auto" {
                for (i, (a, b)) in RF.fenster(e.zeit).enumerated() {
                    let r = CGRect(x: X(Double(a)), y: ym, width: Swift.max(2, X(Double(b)) - X(Double(a))), height: y0 - ym)
                    k.fill(Path(r), with: .color(Color(red: 1, green: 111 / 255, blue: 99 / 255, opacity: 0.12)))
                    if i == 0 { svgText(k, e.kachelWerte.name, x: X(Double(a)) + 3, y: ym + 11, farbe: RF.rot) }
                }
            }
            for v in [0, max / 2, max] {
                var l = Path()
                l.move(to: CGPoint(x: x0, y: Y(v)))
                l.addLine(to: CGPoint(x: x1, y: Y(v)))
                k.stroke(l, with: .color(Color(red: 227 / 255, green: 246 / 255, blue: 84 / 255, opacity: 0.18)), lineWidth: 1)
                svgText(k, RF.zahl(v), x: 0, y: Y(v) + 4, farbe: RF.lime)
            }
            svgText(k, "min", x: x0 + 4, y: Y(max) + 12, farbe: RF.lime)
            for h in [6, 10, 14, 18, 22] {
                svgText(k, String(format: "%02d", h), x: X(Double(h * 60)), y: hoehe - 6, farbe: RF.lime, anker: .center)
            }
            var bisher = Path()
            bisher.move(to: CGPoint(x: x0, y: Y(Double(nebenBisherPufferMin))))
            bisher.addLine(to: CGPoint(x: x1, y: Y(Double(nebenBisherPufferMin))))
            k.stroke(bisher, with: .color(.white), style: StrokeStyle(lineWidth: 1.2, dash: [5, 4]))
            for p in punkte {
                let m = CGPoint(x: X(Double(p.m)), y: Y(p.p))
                k.fill(Path(ellipseIn: CGRect(x: m.x - 3.4, y: m.y - 3.4, width: 6.8, height: 6.8)), with: .color(RF.klasse(p.k)))
            }
        }
        .frame(width: breite, height: hoehe)
        .accessibilityHidden(true)
    }
}

// MARK: - Fahrzeit-Verteilung einer Fahrt

struct FahrzeitVerteilung: View {
    let fahrzeit: NebenRisikoFahrt.Fahrzeit
    var breite: CGFloat = 326

    var body: some View {
        let hist = fahrzeit.hist
        if !hist.isEmpty {
            Canvas { k, _ in
                let n = CGFloat(hist.count)
                let bw = breite / n
                let max = Swift.max(hist.max() ?? 1, 1)
                let schritt = (fahrzeit.bis - fahrzeit.von) / Double(hist.count)
                for (i, v) in hist.enumerated() {
                    let mitte = fahrzeit.von + (Double(i) + 0.5) * schritt
                    let farbe = mitte <= fahrzeit.p50 + 2 ? RF.gruen : mitte <= fahrzeit.p90 ? RF.lime : RF.rot
                    let h = CGFloat(v / max) * 48
                    k.fill(Path(CGRect(x: CGFloat(i) * bw + 1, y: 52 - h, width: bw - 2, height: h)), with: .color(farbe))
                }
                let xMed = CGFloat((fahrzeit.p50 - fahrzeit.von) / Swift.max(1, fahrzeit.bis - fahrzeit.von)) * breite
                var l = Path()
                l.move(to: CGPoint(x: xMed, y: 0))
                l.addLine(to: CGPoint(x: xMed, y: 52))
                k.stroke(l, with: .color(RF.dunkel), lineWidth: 1.5)
                svgText(k, "\(RF.zahl(fahrzeit.von)) min", x: 0, y: 66, farbe: RF.dunkel, deckung: 0.6)
                svgText(k, "\(RF.zahl(fahrzeit.bis)) min", x: breite, y: 66, farbe: RF.dunkel, anker: .trailing, deckung: 0.6)
            }
            .frame(width: breite, height: 70)
            .accessibilityHidden(true)
        }
    }
}

// MARK: - RisikoAbschnitt (Fahrt bearbeiten)

/// "Was dieser Fahrt passieren kann": Fahrzeit ueber alle Verlaeufe, Ursachen und was die
/// Engine dafuer eingeplant hat. Die Hoehe meldet der Abschnitt ueber `hoehe`, damit Notizen
/// und Knoepfe darunter anschliessen. Breite 402 wie im Formular (left 0, right 0).
struct RisikoAbschnitt: View {
    let fahrt: NebenRisikoFahrt
    var geplant = false
    var verlaeufe = 500
    var hoehe: ((CGFloat) -> Void)?

    private struct Zeile: Identifiable {
        var id: String { name }
        let name: String, unter: String, rechts: String, bis: String
    }

    private static func haeufigkeit(_ anteil: Double) -> String {
        let n = Int((anteil * 10).rounded())
        return n >= 1 ? "\(n) von 10" : "selten"
    }

    private var zeilen: [Zeile] {
        var z: [Zeile] = []
        if let e = fahrt.ereignis {
            z.append(Zeile(name: "\(e.name.replacingOccurrences(of: ", Allianz Arena", with: "")) eingeplant",
                           unter: e.route == "FTO" ? "Route über Flughafentangente Ost · Planungsannahme" : "Planungsannahme",
                           rechts: "vorhergesagt", bis: "+\(RF.zahl(e.min)) min"))
        }
        for u in fahrt.ursachen ?? [] {
            z.append(Zeile(name: u.name, unter: "", rechts: Self.haeufigkeit(u.anteil), bis: "bis +\(RF.zahl(u.bis_min)) min"))
        }
        return z
    }

    var body: some View {
        let trenner = Color(hex: 0xD9D9D9)
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .center, spacing: 10) {
                Text("Was dieser Fahrt passieren kann").font(.grotesk(16, .bold)).tracking(0.5)
                Spacer(minLength: 0)
                Text(fahrt.klasse).font(.grotesk(11, .bold))
                    .padding(.horizontal, 6).padding(.vertical, 2)
                    .background(RF.klasse(fahrt.klasse))
            }
            Text("Fahrzeit in \(verlaeufe) Verläufen").font(.grotesk(11)).opacity(0.6).padding(.top, 12)
            if let fz = fahrt.fahrzeit {
                FahrzeitVerteilung(fahrzeit: fz, breite: 330).padding(.top, 4)
                (Text("Normal ") + Text("\(RF.zahl(fz.p50)) min").bold()
                    + Text(", in 9 von 10 Verläufen höchstens ") + Text("\(RF.zahl(fz.p90)) min").bold() + Text("."))
                    .font(.grotesk(13)).cssZeile(13, 18).padding(.top, 6)
            }
            VStack(alignment: .leading, spacing: 0) {
                if zeilen.isEmpty {
                    Text("In den Verläufen kaum Schwankung.").font(.grotesk(13))
                        .padding(.vertical, 9).frame(maxWidth: .infinity, alignment: .leading)
                        .overlay(alignment: .top) { trenner.frame(height: 1) }
                } else {
                    ForEach(zeilen) { z in
                        HStack(alignment: .top, spacing: 10) {
                            VStack(alignment: .leading, spacing: 0) {
                                Text(z.name).font(.grotesk(13)).cssZeile(13, 17)
                                if !z.unter.isEmpty { Text(z.unter).font(.grotesk(11)).opacity(0.6) }
                            }
                            Spacer(minLength: 0)
                            VStack(alignment: .trailing, spacing: 0) {
                                Text(z.rechts).font(.grotesk(13, .bold)).cssZeile(13, 17)
                                Text(z.bis).font(.grotesk(11)).opacity(0.6)
                            }
                            .fixedSize()
                        }
                        .padding(.vertical, 9)
                        .overlay(alignment: .top) { trenner.frame(height: 1) }
                    }
                }
            }
            .padding(.top, 10)
            if geplant {
                VStack(alignment: .leading, spacing: 0) {
                    if let luft = fahrt.luft {
                        HStack { Text("Eingeplanter Puffer"); Spacer(); Text("\(RF.zahl(luft.puffer)) min").bold() }.frame(height: 22)
                        HStack { Text("Bisher pauschal"); Spacer(); Text("\(nebenBisherPufferMin) min") }.frame(height: 22).opacity(0.5)
                        let alle = luft.folge_puenktlich == luft.verlaeufe
                        HStack(alignment: .top, spacing: 10) {
                            Text("Folgefahrt \(luft.folge_abfahrt ?? "")").fixedSize()
                            Spacer(minLength: 0)
                            Text(alle ? "in allen Verläufen pünktlich"
                                      : "in \(luft.folge_puenktlich ?? 0) von \(luft.verlaeufe ?? 0) pünktlich")
                                .bold().multilineTextAlignment(.trailing)
                                .foregroundStyle(alle ? RF.gruen : RF.dunkel)
                        }
                        .frame(minHeight: 22)
                    } else {
                        HStack { Text("Puffer"); Spacer(); Text("letzte Fahrt im Dienst").opacity(0.6) }.frame(height: 22)
                    }
                }
                .font(.grotesk(13))
                .padding(.top, 10)
                .overlay(alignment: .top) { trenner.frame(height: 1) }
            } else {
                Text("Den Puffer legt die Engine fest, wenn die Fahrt nach ihrem Plan eingeteilt ist.")
                    .font(.grotesk(12)).cssZeile(12, 16).opacity(0.6)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.top, 10)
                    .overlay(alignment: .top) { trenner.frame(height: 1) }
            }
            Text("Planungsannahmen, keine Messwerte.").font(.grotesk(10)).opacity(0.5).padding(.top, 10)
        }
        .foregroundStyle(RF.dunkel)
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.white)
        .padding(20)
        .background(RoundedRectangle(cornerRadius: 12).fill(Color(hex: 0x1A1A1A)))
        .fixedSize(horizontal: false, vertical: true)
        .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { hoehe?($0) }
    }
}
