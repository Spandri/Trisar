import SwiftUI

/// Stundenerfassung im Fahrer (wie Stunden.jsx): Verlauf mit Diensten und Fahrten, Erfassen mit Vorschlag,
/// Hinweis auf der Startseite. Im Fluss gesetzt (ScrollView), nicht im festen Raster.

private let lime = Farbe.lime
private let rot = Color(hex: 0xFF6F63)
private let orange = Color(hex: 0xFFCD8A)
private let gruen = Color(hex: 0x8DFFAF)

/// Verlauf (Profil -> Verlauf): vergangene Dienste der letzten 60 Tage.
struct VerlaufAnsicht: View {
    var zurueck: () -> Void
    @State private var eintraege: [Stunden.Eintrag]?
    @State private var offen: Stunden.Eintrag?

    var body: some View {
        ZStack(alignment: .bottom) {
            ProfilHintergrund().ignoresSafeArea()
            ScrollView(.vertical, showsIndicators: false) {
                VStack(alignment: .leading, spacing: 0) {
                    ZurueckKnopf(aktion: zurueck).frame(width: 50, height: 50)
                    Text("Verlauf").font(.grotesk(42, .bold)).tracking(-0.5).foregroundStyle(lime).padding(.top, 30)
                    if let eintraege {
                        if eintraege.isEmpty {
                            Text("Noch keine abgeschlossenen Dienste.").font(.grotesk(16, .medium))
                                .foregroundStyle(.white.opacity(0.7)).padding(.top, 24)
                        }
                        VStack(spacing: 28) {
                            ForEach(eintraege) { e in dienstBlock(e) }
                        }
                        .padding(.top, 24)
                    }
                }
                .padding(.horizontal, 20).padding(.top, 60).padding(.bottom, 90)
                .frame(maxWidth: 402, alignment: .leading)
                .frame(maxWidth: .infinity)
            }
            .contentMargins(.vertical, 0, for: .scrollContent)
            .ignoresSafeArea()
            FussleisteUnten()
        }
        .task { eintraege = await Stunden.verlauf() }
        .zurueckPerWischen(zurueck)
        .webVollbild(item: $offen) { e in
            StundenErfassenAnsicht(eintrag: e, schliessen: { offen = nil }) {
                offen = nil
                Task { eintraege = await Stunden.verlauf() }
            }
        }
    }

    private func dienstBlock(_ e: Stunden.Eintrag) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 0) {
                Rectangle().fill(lime).frame(width: 44, height: 2)
                Spacer(minLength: 0)
                Text(Stunden.tag(e.dienst.datum)).font(.grotesk(24, .bold)).foregroundStyle(lime).lineLimit(1)
                Spacer(minLength: 0)
                Rectangle().fill(lime).frame(width: 44, height: 2)
            }
            statusZeile("Dienstbeginn \(e.dienst.beginn ?? "")", lime)
            ForEach(e.vorschlag?.fahrten ?? [], id: \.id) { f in
                VStack(alignment: .leading, spacing: 2) {
                    Text("\(Stunden.uhr(f.start)) – \(Stunden.uhr(f.ende))").font(.grotesk(13, .medium)).foregroundStyle(Color(hex: 0x18181B).opacity(0.7))
                    Text((f.gaeste ?? "").isEmpty ? "\(f.von ?? "") → \(f.nach ?? "")" : f.gaeste ?? "")
                        .font(.grotesk(20, .bold)).foregroundStyle(Color(hex: 0x18181B))
                    if !(f.gaeste ?? "").isEmpty {
                        Text("\(f.von ?? "") → \(f.nach ?? "")").font(.grotesk(12, .medium)).foregroundStyle(Color(hex: 0x18181B).opacity(0.7))
                    }
                }
                .padding(.horizontal, 16).padding(.vertical, 12)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Color.white)
            }
            statusZeile("Dienstende \(e.dienst.ende ?? "")", rot)
            stundenStatus(e)
        }
    }

    private func statusZeile(_ text: String, _ farbe: Color) -> some View {
        Text(text).font(.grotesk(22, .bold)).foregroundStyle(farbe)
            .padding(.horizontal, 16).frame(maxWidth: .infinity, alignment: .leading).frame(height: 48)
            .overlay(Rectangle().strokeBorder(farbe, lineWidth: 1))
    }

    @ViewBuilder private func stundenStatus(_ e: Stunden.Eintrag) -> some View {
        if let z = e.zettel {
            let farbe = z.status == "bestaetigt" ? gruen : (z.status == "zurueckgewiesen" ? rot : orange)
            let text = z.status == "bestaetigt" ? "Bestätigt" : (z.status == "zurueckgewiesen" ? "Zurückgegeben" : "Eingereicht")
            VStack(alignment: .leading, spacing: 6) {
                Button { if z.status != "bestaetigt" { offen = e } } label: {
                    HStack {
                        Text(text).font(.grotesk(16, .bold))
                        Spacer(minLength: 0)
                        Text("\(Stunden.hmm(z.arbeits_min)) h").font(.grotesk(20, .bold))
                    }
                    .foregroundStyle(farbe)
                    .padding(.horizontal, 16).frame(height: 56)
                    .overlay(Rectangle().strokeBorder(farbe, lineWidth: 2))
                    .contentShape(Rectangle())
                }
                .buttonStyle(.web)
                if z.status == "zurueckgewiesen" {
                    if let n = z.dispo_notiz, !n.isEmpty { Text(n).font(.grotesk(13, .medium)).foregroundStyle(rot) }
                    Button { offen = e } label: { Text("Neu erfassen").font(.grotesk(13, .medium)).underline().foregroundStyle(lime) }
                        .buttonStyle(.web)
                }
            }
        } else if !e.vorbei {
            Text("Dienst läuft noch").font(.grotesk(13, .medium)).foregroundStyle(.white.opacity(0.45))
        } else {
            Button { offen = e } label: {
                HStack {
                    Text("Stunden erfassen").font(.grotesk(16, .medium))
                    Spacer(minLength: 0)
                    Text("\(Stunden.hmm(e.vorschlag?.arbeits_min)) h").font(.grotesk(16, .bold))
                }
                .foregroundStyle(Color(hex: 0x1D1C1D))
                .padding(.horizontal, 16).frame(height: 56).background(lime)
                .contentShape(Rectangle())
            }
            .buttonStyle(.web)
        }
    }
}

/// Erfassen: Vorschlag bestaetigen oder anpassen (dann mit Begruendung).
struct StundenErfassenAnsicht: View {
    let eintrag: Stunden.Eintrag
    let schliessen: () -> Void
    let fertig: () -> Void

    @State private var anpassen = false
    @State private var beginn = ""
    @State private var ende = ""
    @State private var pause = ""
    @State private var begruendung = ""
    @State private var fehler = ""
    @State private var busy = false

    private var v: Stunden.Vorschlag? { eintrag.vorschlag }
    private var beginnZeit: Date? { anpassen ? Stunden.zeitpunkt(eintrag.dienst.datum, beginn) : Stunden.datum(v?.beginn) }
    private var endeZeit: Date? { anpassen ? Stunden.zeitpunkt(eintrag.dienst.datum, ende, nach: beginnZeit) : Stunden.datum(v?.ende) }
    private var pauseMin: Int { anpassen ? max(0, Int(pause) ?? 0) : (v?.pause_min ?? 0) }
    private var arbeitsMin: Int {
        guard let b = beginnZeit, let e = endeZeit else { return 0 }
        return max(0, Int(e.timeIntervalSince(b) / 60) - pauseMin)
    }
    private var geaendert: Bool {
        anpassen && (Stunden.uhr(beginnZeit) != Stunden.uhr(v?.beginn) || Stunden.uhr(endeZeit) != Stunden.uhr(v?.ende) || pauseMin != (v?.pause_min ?? 0))
    }

    var body: some View {
        ZStack(alignment: .bottom) {
            ProfilHintergrund().ignoresSafeArea()
            ScrollView(.vertical, showsIndicators: false) {
                VStack(alignment: .leading, spacing: 0) {
                    ZurueckKnopf(aktion: schliessen).frame(width: 50, height: 50)
                    Text("Stunden erfassen").font(.grotesk(42, .bold)).tracking(-0.5).foregroundStyle(lime)
                        .fixedSize(horizontal: false, vertical: true).padding(.top, 30)
                    Text(Stunden.tag(eintrag.dienst.datum)).font(.grotesk(18, .bold)).foregroundStyle(.white.opacity(0.8)).padding(.top, 10)

                    VStack(alignment: .leading, spacing: 0) {
                        Text("\(Stunden.hmm(arbeitsMin)) h").font(.grotesk(44, .bold)).foregroundStyle(.black)
                        Text(anpassen ? "Arbeitszeit" : "Arbeitszeit · Vorschlag").font(.grotesk(12, .medium)).foregroundStyle(.black.opacity(0.7))
                    }
                    .padding(.horizontal, 16).frame(maxWidth: .infinity, alignment: .leading).frame(height: 96)
                    .background(lime).padding(.top, 20)

                    if anpassen {
                        HStack(spacing: 10) {
                            feld("Beginn", $beginn, "14:30", .numbersAndPunctuation)
                            feld("Ende", $ende, "22:00", .numbersAndPunctuation)
                        }
                        .padding(.top, 16)
                        feld("Pause (Min.)", $pause, "30", .numberPad).padding(.top, 12)
                        VStack(alignment: .leading, spacing: 4) {
                            Text("Warum weicht es ab?").font(.grotesk(11, .medium)).foregroundStyle(geaendert ? orange : .white.opacity(0.5))
                            TextField("", text: $begruendung, axis: .vertical)
                                .lineLimit(3...6)
                                .font(.grotesk(15, .medium)).foregroundStyle(.white)
                                .padding(10)
                                .overlay(Rectangle().strokeBorder(geaendert ? orange : .white.opacity(0.3), lineWidth: 1))
                        }
                        .padding(.top, 12)
                    } else {
                        zeile("Beginn", Stunden.uhr(v?.beginn)).padding(.top, 16)
                        zeile("Ende", Stunden.uhr(v?.ende))
                        zeile("Pause", "\(v?.pause_min ?? 0) Min.")
                        ForEach(Array((v?.pausen ?? []).enumerated()), id: \.offset) { _, p in
                            Text("\(Stunden.uhr(p.von)) – \(Stunden.uhr(p.bis))").font(.grotesk(12, .medium)).foregroundStyle(.white.opacity(0.45)).padding(.top, 4)
                        }
                    }

                    if let fahrten = v?.fahrten, !fahrten.isEmpty {
                        Text("Fahrten · \(fahrten.count)").font(.grotesk(13, .bold)).foregroundStyle(lime).padding(.top, 22)
                        VStack(spacing: 6) {
                            ForEach(fahrten, id: \.id) { f in
                                VStack(alignment: .leading, spacing: 2) {
                                    Text("\(Stunden.uhr(f.start)) – \(Stunden.uhr(f.ende))\(f.genau == false ? " · geplant" : "")")
                                        .font(.grotesk(12, .medium)).foregroundStyle(Color(hex: 0x18181B).opacity(0.7))
                                    Text((f.gaeste ?? "").isEmpty ? "\(f.von ?? "") → \(f.nach ?? "")" : f.gaeste ?? "")
                                        .font(.grotesk(16, .bold)).foregroundStyle(Color(hex: 0x18181B)).lineLimit(1)
                                }
                                .padding(.horizontal, 16).padding(.vertical, 10)
                                .frame(maxWidth: .infinity, alignment: .leading).background(Color.white)
                            }
                        }
                        .padding(.top, 8)
                    }
                    if !fehler.isEmpty { Text(fehler).font(.grotesk(13, .medium)).foregroundStyle(orange).padding(.top, 14) }
                }
                .padding(.horizontal, 20).padding(.top, 60).padding(.bottom, 190)
                .frame(maxWidth: 402, alignment: .leading)
                .frame(maxWidth: .infinity)
            }
            .contentMargins(.vertical, 0, for: .scrollContent)
            .scrollDismissesKeyboard(.interactively)
            .ignoresSafeArea()

            VStack(spacing: 8) {
                Button { Task { await speichern() } } label: {
                    HStack {
                        Text(anpassen ? "Einreichen" : "Stimmt so, bestätigen").font(.grotesk(16, .medium)).foregroundStyle(Color(hex: 0x1D1C1D))
                        Spacer(minLength: 0)
                        Image("Arrow_Trisar_Icons_01").resizable().frame(width: 34, height: 20)
                    }
                    .padding(.horizontal, 16).frame(height: 56).background(lime).contentShape(Rectangle())
                }
                .buttonStyle(.web)
                .disabled(busy || arbeitsMin == 0)
                .opacity(busy || arbeitsMin == 0 ? 0.4 : 1)
                if !anpassen {
                    Button {
                        beginn = Stunden.uhr(eintrag.zettel?.beginn ?? v?.beginn)
                        ende = Stunden.uhr(eintrag.zettel?.ende ?? v?.ende)
                        pause = "\(eintrag.zettel?.pause_min ?? v?.pause_min ?? 0)"
                        begruendung = eintrag.zettel?.begruendung ?? ""
                        anpassen = true
                    } label: {
                        Text("Anpassen").font(.grotesk(15, .medium)).foregroundStyle(lime)
                            .padding(.horizontal, 16).frame(maxWidth: .infinity, alignment: .leading).frame(height: 48)
                            .overlay(Rectangle().strokeBorder(lime, lineWidth: 2)).contentShape(Rectangle())
                    }
                    .buttonStyle(.web)
                }
            }
            .padding(.horizontal, 20).padding(.top, 20).padding(.bottom, 16)
            .frame(maxWidth: 402)
            .background(LinearGradient(stops: [.init(color: .black.opacity(0), location: 0), .init(color: .black, location: 0.3)], startPoint: .top, endPoint: .bottom))
        }
        .zurueckPerWischen(schliessen)
    }

    private func zeile(_ titel: String, _ wert: String) -> some View {
        HStack {
            Text(titel).font(.grotesk(14, .medium)).foregroundStyle(.white.opacity(0.6))
            Spacer(minLength: 0)
            Text(wert).font(.grotesk(20, .bold)).foregroundStyle(.white)
        }
        .frame(height: 44)
        .overlay(alignment: .bottom) { Rectangle().fill(.white.opacity(0.1)).frame(height: 1) }
    }

    private func feld(_ titel: String, _ text: Binding<String>, _ platzhalter: String, _ tastatur: UIKeyboardType) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(titel).font(.grotesk(11, .medium)).foregroundStyle(.white.opacity(0.5))
            TextField("", text: text, prompt: Text(platzhalter).foregroundStyle(.white.opacity(0.25)))
                .font(.grotesk(18, .bold)).foregroundStyle(.white).keyboardType(tastatur)
                .padding(.horizontal, 12).frame(height: 44)
                .overlay(Rectangle().strokeBorder(.white.opacity(0.3), lineWidth: 1))
        }
        .frame(maxWidth: .infinity)
    }

    private func speichern() async {
        if geaendert && begruendung.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            fehler = "Bitte kurz begründen, warum die Zeiten abweichen."; return
        }
        guard let b = beginnZeit, let e = endeZeit else { fehler = "Beginn und Ende als HH:MM eingeben."; return }
        busy = true; fehler = ""
        do {
            try await Stunden.speichern(eintrag, beginn: b, ende: e, pauseMin: pauseMin, angepasst: geaendert,
                                        begruendung: begruendung.trimmingCharacters(in: .whitespacesAndNewlines))
            busy = false
            fertig()
        } catch {
            busy = false
            fehler = "Speichern fehlgeschlagen: \(error.localizedDescription)"
        }
    }
}

/// Hinweis auf der Startseite: offene Stunden der letzten zwei Wochen, oeffnet direkt das Erfassen.
struct StundenHinweis: View {
    @State private var offen: [Stunden.Eintrag] = []
    @State private var gewaehlt: Stunden.Eintrag?

    var body: some View {
        Group {
            if let aeltester = offen.last {
                Button { gewaehlt = aeltester } label: {
                    HStack {
                        Text("Stunden erfassen: " + offen.prefix(3).map { Stunden.tag($0.dienst.datum, kurz: true) }.joined(separator: ", "))
                            .font(.grotesk(16, .medium)).foregroundStyle(Color(hex: 0x1D1C1D)).lineLimit(1)
                        Spacer(minLength: 0)
                        Image("Arrow_Trisar_Icons_01").resizable().frame(width: 34, height: 20)
                    }
                    .padding(.horizontal, 16).frame(height: 56).background(lime).contentShape(Rectangle())
                }
                .buttonStyle(.web)
            }
        }
        .task { await laden() }
        .webVollbild(item: $gewaehlt) { e in
            StundenErfassenAnsicht(eintrag: e, schliessen: { gewaehlt = nil }) {
                gewaehlt = nil
                Task { await laden() }
            }
        }
    }

    private func laden() async {
        offen = await Stunden.verlauf(tage: 14).filter(\.offen)
    }
}
