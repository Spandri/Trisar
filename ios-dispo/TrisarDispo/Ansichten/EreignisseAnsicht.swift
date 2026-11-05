import SwiftUI

/// Ereignisse eines Einsatztages (EreignisseView.jsx): was die Engine automatisch eingerechnet
/// hat (mit Quelle) und was die Disposition ergaenzt, anpasst oder entfernt. Eigene Aenderungen
/// rechnet die App nicht neu, das sagt die Seite auch.
struct EreignisseAnsicht: View {
    let tagIso: String
    let zurueck: () -> Void
    @ObservedObject private var speicher = NebenRisikoSpeicher.geteilt

    init(tagIso: String, zurueck: @escaping () -> Void) {
        self.tagIso = tagIso
        self.zurueck = zurueck
    }

    var body: some View {
        let liste = speicher.ereignisse(tagIso)
        let entfernt = speicher.entfernte(tagIso)
        let auto = liste.filter { $0.quelleArt == "auto" }.count
        let eigene = liste.count - auto
        let lime = NebenRisikoFarbe.lime

        NebenPlanerSeite(titel: "Ereignisse",
                         unterzeile: "\(NebenRisiko.datumText(tagIso)) · \(auto) automatisch gefunden\(eigene > 0 ? " · \(eigene) von dir" : "")",
                         zurueck: zurueck) {
            VStack(alignment: .leading, spacing: 12) {
                ForEach(liste, id: \.schluessel) { e in
                    EreignisKarte(e: e, iso: tagIso)
                }
                if liste.isEmpty {
                    Text("Für diesen Tag sind keine Ereignisse eingetragen.").font(.grotesk(14)).foregroundStyle(lime)
                }
            }
            .padding(.top, 22)
            if !entfernt.isEmpty {
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(entfernt) { e in
                        HStack(spacing: 0) {
                            Text("Entfernt: \(e.titel) · ")
                            Button { speicher.wiederherstellen(tagIso, e.id) } label: { Text("wiederherstellen").underline() }
                                .buttonStyle(.web)
                        }
                        .frame(height: 18)
                    }
                }
                .font(.grotesk(12))
                .foregroundStyle(Color(hex: 0xE3F654, alpha: 0.7))
                .padding(.top, 14)
            }
            EreignisErgaenzen(iso: tagIso).padding(.top, 18)
            WebText(text: "Eintippen, was passiert und wann. Die Demo zeigt den Plan der Engine ohne eigene Änderungen.",
                    groesse: 11, zeilenHoehe: 15, farbe: UIColor(hex: 0xE3F654).withAlphaComponent(0.5), ausrichtung: .center)
                .frame(width: 362)
                .padding(.top, 10)
        }
    }
}

private extension NebenEreignis {
    /// key im Web: id-zeit-wirkung, damit eine Karte nach dem Anpassen neu startet.
    var schluessel: String { "\(id)-\(zeit)-\(wirkung)" }
}

// MARK: - Karte

private struct EreignisKarte: View {
    let e: NebenEreignis
    let iso: String
    @State private var bearbeiten = false
    @State private var von: Date
    @State private var bis: Date
    @State private var vonGesetzt: Bool
    @State private var bisGesetzt: Bool
    @State private var zusatz: String

    private typealias RF = NebenRisikoFarbe

    init(e: NebenEreignis, iso: String) {
        self.e = e
        self.iso = iso
        _von = State(initialValue: Self.datum(e.von))
        _bis = State(initialValue: Self.datum(e.bis))
        _vonGesetzt = State(initialValue: !(e.von ?? "").isEmpty)
        _bisGesetzt = State(initialValue: !(e.bis ?? "").isEmpty)
        _zusatz = State(initialValue: Self.plusMin(e.wirkung).map(String.init) ?? "")
    }

    private static func plusMin(_ wirkung: String) -> Int? {
        NebenRisiko.treffer(#"\+(\d+)\s*min"#, in: wirkung).first.flatMap { Int($0) }
    }

    private static func datum(_ hhmm: String?) -> Date {
        let m = NebenRisikoFarbe.minuten(hhmm) ?? 0
        return Calendar.current.date(bySettingHour: (m / 60) % 24, minute: m % 60, second: 0, of: Date()) ?? Date()
    }

    private static func uhr(_ d: Date) -> String {
        let k = Calendar.current.dateComponents([.hour, .minute], from: d)
        return String(format: "%02d:%02d", k.hour ?? 0, k.minute ?? 0)
    }

    private var eigen: Bool { e.quelleArt == "eigen" }

    private func speichern() {
        var werte = NebenEreignisWerte()
        let v = vonGesetzt ? Self.uhr(von) : "", b = bisGesetzt ? Self.uhr(bis) : ""
        // Zeit nur ersetzen, wenn sie geaendert wurde (sonst blieben zwei Fenster nicht erhalten).
        if !v.isEmpty, !b.isEmpty, v != (e.von ?? "") || b != (e.bis ?? "") {
            werte.von = v
            werte.bis = b
            werte.zeit = "\(v)–\(b)"
        }
        if let alt = Self.plusMin(e.wirkung), let neu = Int(zusatz.trimmingCharacters(in: .whitespaces)), neu != alt {
            werte.wirkung = e.wirkung.replacingOccurrences(of: #"\+\d+\s*min"#, with: "+\(neu) min", options: .regularExpression)
        }
        if werte != NebenEreignisWerte() { NebenRisikoSpeicher.geteilt.aendern(iso, e.id, werte) }
        bearbeiten = false
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text(eigen ? "von dir" : e.angepasst ? "automatisch · angepasst" : "automatisch")
                    .font(.grotesk(11, .bold))
                    .padding(.horizontal, 6).padding(.vertical, 2)
                    .background(eigen ? RF.lime : Color(hex: 0xE9E9E9))
                Spacer()
                if let n = e.fahrten {
                    Text("\(n) \(n == 1 ? "Fahrt" : "Fahrten")").font(.grotesk(12, .bold))
                }
            }
            Text(e.titel).font(.grotesk(18, .bold)).tracking(-0.3).padding(.top, 8)
            if let z = e.zusatz, !z.isEmpty { Text(z).font(.grotesk(12)).opacity(0.6) }
            Grid(alignment: .topLeading, horizontalSpacing: 8, verticalSpacing: 3) {
                zeile("Zeit", e.zeit)
                zeile("Wirkung", e.wirkung)
                zeile("Quelle", e.quelle)
            }
            .font(.grotesk(12))
            .padding(.top, 8)

            if bearbeiten { formular.padding(.top, 10) }

            HStack(spacing: 8) {
                if bearbeiten {
                    knopf("Speichern", art: .voll, aktion: speichern)
                    knopf("Abbrechen", art: .grau) { bearbeiten = false }
                } else {
                    knopf("Anpassen", art: .rand) { bearbeiten = true }
                    knopf("Entfernen", art: .rot) { NebenRisikoSpeicher.geteilt.entfernen(iso, e.id) }
                }
            }
            .padding(.top, 12)
        }
        .foregroundStyle(RF.dunkel)
        .padding(.horizontal, 16).padding(.vertical, 14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(hex: 0xFEFFFE))
        .overlay(Rectangle().strokeBorder(bearbeiten ? RF.lime : .clear, lineWidth: 2))
    }

    private func zeile(_ label: String, _ wert: String) -> some View {
        GridRow {
            Text(label).opacity(0.55).frame(width: 64, alignment: .leading)
            Text(wert).fontWeight(.medium).fixedSize(horizontal: false, vertical: true)
        }
    }

    private var formular: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("Wird angepasst").font(.grotesk(11)).opacity(0.6).padding(.bottom, 6)
            HStack(spacing: 8) {
                Text("Zeit").opacity(0.55).frame(width: 40, alignment: .leading)
                zeitFeld($von, gesetzt: $vonGesetzt)
                Text("–").opacity(0.4)
                zeitFeld($bis, gesetzt: $bisGesetzt)
                Spacer(minLength: 0)
            }
            .frame(height: 32)
            if Self.plusMin(e.wirkung) != nil {
                HStack(spacing: 8) {
                    Text("bis +").opacity(0.55).frame(width: 40, alignment: .leading)
                    TextField("", text: $zusatz)
                        .keyboardType(.numberPad)
                        .padding(.horizontal, 6)
                        .frame(width: 64, height: 28)
                        .background(Color.white)
                        .overlay(Rectangle().stroke(Color(hex: 0xD9D9D9), lineWidth: 1))
                        .onChange(of: zusatz) { _, neu in
                            // min 0, max 120 wie das Zahlenfeld im Web
                            let ziffern = neu.filter(\.isNumber)
                            if ziffern != neu { zusatz = ziffern }
                            if let n = Int(ziffern), n > 120 { zusatz = "120" }
                        }
                    Text("min")
                    Spacer(minLength: 0)
                }
                .frame(height: 32)
            }
        }
        .font(.grotesk(13))
        .padding(.horizontal, 12).padding(.vertical, 10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(hex: 0xF3F3F3))
    }

    private func zeitFeld(_ wert: Binding<Date>, gesetzt: Binding<Bool>) -> some View {
        DatePicker("", selection: Binding(get: { wert.wrappedValue }, set: { wert.wrappedValue = $0; gesetzt.wrappedValue = true }),
                   displayedComponents: .hourAndMinute)
            .labelsHidden()
            .environment(\.locale, Locale(identifier: "de_DE"))
            .environment(\.colorScheme, .light)
            .scaleEffect(0.85)
            .frame(height: 28)
    }

    private enum KnopfArt { case rand, rot, voll, grau }

    private func knopf(_ text: String, art: KnopfArt, aktion: @escaping () -> Void) -> some View {
        let (rand, farbe, grund): (Color, Color, Color) = {
            switch art {
            case .rand: return (RF.dunkel, RF.dunkel, .clear)
            case .rot: return (RF.rot, RF.rot, .clear)
            case .voll: return (RF.lime, .black, RF.lime)
            case .grau: return (Color(hex: 0xC9C9C9), Color(hex: 0x888888), .clear)
            }
        }()
        return Button(action: aktion) {
            Text(text).font(.grotesk(13, .medium)).foregroundStyle(farbe)
                .frame(maxWidth: .infinity).frame(height: 36)
                .background(grund)
                .overlay(Rectangle().strokeBorder(rand, lineWidth: 2))
                .contentShape(Rectangle())
        }
        .buttonStyle(.web)
    }
}

// MARK: - Ergaenzen

private struct EreignisErgaenzen: View {
    let iso: String
    @State private var offen = false
    @State private var text = ""
    @State private var entwurf: NebenEreignis?
    @State private var fehler = ""
    @FocusState private var fokus: Bool

    private typealias RF = NebenRisikoFarbe

    private func senden() {
        guard let e = NebenRisiko.ereignisAusText(text) else {
            fehler = "Beschreibe kurz, was passiert und wann."
            return
        }
        fehler = ""
        entwurf = e
    }

    var body: some View {
        if !offen {
            NebenPlanenKnopf(text: "Ereignis ergänzen") {
                offen = true
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) { fokus = true }
            }
        } else {
            VStack(alignment: .leading, spacing: 12) {
                HStack(spacing: 8) {
                    Image("Planen_Sparkle_Lime").resizable().scaledToFit().frame(width: 14)
                    Text("Ereignis ergänzen").font(.grotesk(10, .bold)).foregroundStyle(RF.lime)
                }
                .frame(maxWidth: .infinity)
                if let entwurf {
                    WebText(text: entwurf.text ?? "", groesse: 16, gewicht: .medium, zeilenHoehe: 20, farbe: .black)
                        .padding(.horizontal, 12).padding(.top, 12).padding(.bottom, 8)
                        .frame(width: 314, alignment: .leading)
                        .background(UnevenRoundedRectangle(topLeadingRadius: 16, bottomLeadingRadius: 16,
                                                           bottomTrailingRadius: 6, topTrailingRadius: 16).fill(RF.lime))
                        .frame(maxWidth: .infinity, alignment: .trailing)
                    antwort(entwurf)
                } else {
                    HStack(spacing: 10) {
                        TextField("", text: $text, prompt: Text("Ludwigstraße 14 bis 18 Uhr gesperrt").foregroundStyle(Color(hex: 0x8F9A3A)))
                            .font(.grotesk(16)).foregroundStyle(.white).tint(RF.lime)
                            .focused($fokus)
                            .submitLabel(.send)
                            .onSubmit(senden)
                            .onChange(of: text) { _, _ in fehler = "" }
                        Button(action: senden) {
                            Image("weiter_gross").resizable().frame(width: 34, height: 21).rotationEffect(.degrees(180))
                        }
                        .buttonStyle(.web)
                        .accessibilityLabel("Senden")
                    }
                    .padding(.leading, 18).padding(.trailing, 12)
                    .frame(height: 56)
                    .overlay(Rectangle().strokeBorder(RF.lime, lineWidth: 2))
                }
                if !fehler.isEmpty { Text(fehler).font(.grotesk(13)).foregroundStyle(RF.rot) }
            }
        }
    }

    private func antwort(_ e: NebenEreignis) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            VStack(alignment: .leading, spacing: 4) {
                Text(e.kachelWerte.name).font(.grotesk(13))
                Text(e.kachelWerte.gross).font(.grotesk(32, .bold)).tracking(-0.5).frame(height: 36)
                Text(e.titel).font(.grotesk(12))
            }
            .foregroundStyle(RF.dunkel)
            .padding(.horizontal, 14).padding(.vertical, 12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color(hex: 0xFEFFFE))
            Text("Die Demo rechnet eigene Ereignisse nicht neu. In der App fließen sie in die nächste Planung ein.")
                .font(.grotesk(12)).opacity(0.7).padding(.top, 10)
            HStack(spacing: 8) {
                Button {
                    NebenRisikoSpeicher.geteilt.hinzufuegen(iso, e)
                    entwurf = nil
                    text = ""
                    offen = false
                } label: {
                    Text("Übernehmen").font(.grotesk(13, .bold)).foregroundStyle(.black)
                        .frame(maxWidth: .infinity).frame(height: 36).background(RF.lime)
                }
                .buttonStyle(.web)
                Button { entwurf = nil } label: {
                    Text("Verwerfen").font(.grotesk(13, .medium)).foregroundStyle(.white)
                        .frame(maxWidth: .infinity).frame(height: 36)
                        .overlay(Rectangle().strokeBorder(Color(hex: 0x5A5A5A), lineWidth: 1))
                        .contentShape(Rectangle())
                }
                .buttonStyle(.web)
            }
            .padding(.top, 10)
        }
        .foregroundStyle(.white)
        .padding(12)
        .frame(width: 314, alignment: .leading)
        .background(UnevenRoundedRectangle(topLeadingRadius: 16, bottomLeadingRadius: 6,
                                           bottomTrailingRadius: 16, topTrailingRadius: 16).fill(Color(hex: 0x242525)))
        .overlay(UnevenRoundedRectangle(topLeadingRadius: 16, bottomLeadingRadius: 6,
                                        bottomTrailingRadius: 16, topTrailingRadius: 16).strokeBorder(Color(hex: 0x3A3A3A), lineWidth: 1))
    }
}
