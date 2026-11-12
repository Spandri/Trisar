import SwiftUI

// MARK: - Doppeltippen

extension View {
    /// Doppeltippen mit Daumen und Zeigefinger loest den Knopf aus (watchOS 11+, Series 9/Ultra 2).
    @ViewBuilder func doppelTippen() -> some View {
        if #available(watchOS 11.0, *) {
            self.handGestureShortcut(.primaryAction)
        } else {
            self
        }
    }
}

// MARK: - Fahrtschritte

/// Grosse Knoepfe fuer die laufende bzw. naechste Fahrt von heute: Bin da, Gast an Bord, Fahrt beendet.
/// Nur im Stand (letzte Position langsamer als 2 m/s), nicht waehrend der Fahrt.
struct SchrittKnoepfe: View {
    @EnvironmentObject private var verbindung: UhrVerbindung
    let fahrt: UhrFahrt
    @State private var beendenFragen = false

    /// (Text, Ziel-Status) oder nil, wenn fuer diese Fahrt gerade kein Schritt passt.
    private var schritt: (String, String)? {
        guard !fahrt.offen else { return nil }
        switch fahrt.phase {
        case "unterwegs": return ("Fahrt beendet", "done")
        case "beimGast": return ("Gast an Bord", "in_progress")
        default:
            // "Bin da" nur fuer die naechste Fahrt von heute.
            guard Calendar.current.isDateInToday(fahrt.zeitpunkt ?? .distantPast),
                  verbindung.stand.naechsteFahrt()?.id == fahrt.id else { return nil }
            return ("Bin da", "at_pickup")
        }
    }

    var body: some View {
        if let (text, ziel) = schritt {
            if verbindung.stand.steht == false {
                HStack(spacing: 6) {
                    Image(systemName: "car.fill").foregroundStyle(UhrFarbe.grau)
                    Text("Schritte im Stand" + (verbindung.stand.tempoKmh.map { " · \($0) km/h" } ?? ""))
                        .font(.grotesk(12, .medium))
                        .foregroundStyle(UhrFarbe.grau)
                }
            } else {
                Button {
                    if ziel == "done" { beendenFragen = true } else { verbindung.schritt(fahrt, ziel: ziel) }
                } label: {
                    Text(verbindung.arbeitetID == "schritt-\(fahrt.id)" ? "…" : text)
                        .font(.grotesk(18, .bold))
                        .foregroundStyle(.black)
                        .frame(maxWidth: .infinity, minHeight: 52)
                        .background(RoundedRectangle(cornerRadius: 12).fill(ziel == "done" ? UhrFarbe.gruen : UhrFarbe.lime))
                }
                .buttonStyle(.plain)
                .disabled(verbindung.arbeitetID != nil)
                .confirmationDialog("Fahrt \(fahrt.zeit) beenden?", isPresented: $beendenFragen, titleVisibility: .visible) {
                    Button("Beenden", role: .destructive) { verbindung.schritt(fahrt, ziel: "done") }
                    Button("Abbrechen", role: .cancel) {}
                }
            }
        }
    }
}

// MARK: - Fahrt im Detail

struct FahrtDetailSeite: View {
    @EnvironmentObject private var verbindung: UhrVerbindung
    @Environment(\.openURL) private var openURL
    let fahrtID: String

    private var fahrt: UhrFahrt? { verbindung.stand.fahrten.first { $0.id == fahrtID } }

    var body: some View {
        ScrollView {
            if let fahrt {
                VStack(alignment: .leading, spacing: 8) {
                    HStack(alignment: .firstTextBaseline) {
                        Text(fahrt.zeit)
                            .font(.grotesk(30, .bold))
                            .foregroundStyle(UhrFarbe.lime)
                            .monospacedDigit()
                        Spacer()
                        Text(UhrText.tag(fahrt.tag))
                            .font(.grotesk(12, .medium))
                            .foregroundStyle(.white.opacity(0.6))
                    }
                    StatusPunkt(status: fahrt.status)
                    Kachel {
                        VStack(alignment: .leading, spacing: 4) {
                            Ort(titel: "Von", text: fahrt.von)
                            Ort(titel: "Nach", text: fahrt.nach)
                        }
                    }
                    SchrittKnoepfe(fahrt: fahrt)
                    if fahrt.offen {
                        LimeKnopf(text: "Annehmen", arbeitet: verbindung.arbeitetID == fahrt.id) {
                            verbindung.fahrtAntworten(fahrt, annehmen: true)
                        }
                        .doppelTippen()
                        RotKnopf(text: "Ablehnen", arbeitet: verbindung.arbeitetID == fahrt.id) {
                            verbindung.fahrtAntworten(fahrt, annehmen: false)
                        }
                    }
                    if let gaeste = fahrt.gaeste, !gaeste.isEmpty {
                        Kachel {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(gaeste.count == 1 ? "Gast" : "Gäste")
                                    .font(.grotesk(11, .medium))
                                    .foregroundStyle(.white.opacity(0.5))
                                ForEach(gaeste, id: \.self) { name in
                                    Text(name)
                                        .font(.grotesk(14, .bold))
                                        .foregroundStyle(.white)
                                        .lineLimit(2)
                                }
                            }
                        }
                    }
                    if let telefon = fahrt.gastTelefon, let url = Self.telURL(telefon) {
                        Button {
                            openURL(url)
                        } label: {
                            HStack(spacing: 8) {
                                Image(systemName: "phone.fill")
                                Text("Gast anrufen")
                            }
                            .font(.grotesk(15, .bold))
                            .foregroundStyle(UhrFarbe.lime)
                            .frame(maxWidth: .infinity, minHeight: 40)
                            .overlay(RoundedRectangle(cornerRadius: 12).stroke(UhrFarbe.lime, lineWidth: 2))
                        }
                        .buttonStyle(.plain)
                    }
                    if Self.zeigeFlug(fahrt) {
                        Kachel(rand: (fahrt.flugVerspaetung ?? 0) > 10 ? UhrFarbe.orange : nil) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(fahrt.flug)
                                    .font(.grotesk(14, .bold))
                                    .foregroundStyle(UhrFarbe.lime)
                                if let status = fahrt.flugStatus {
                                    Text(status)
                                        .font(.grotesk(13, .bold))
                                        .foregroundStyle(.white)
                                }
                                if let ankunft = fahrt.flugAnkunft {
                                    Text("Landung \(ankunft)" + Self.verspaetung(fahrt.flugVerspaetung))
                                        .font(.grotesk(13, .medium))
                                        .foregroundStyle((fahrt.flugVerspaetung ?? 0) > 10 ? UhrFarbe.orange : .white.opacity(0.8))
                                }
                            }
                        }
                    }
                    if let notiz = fahrt.notiz, !notiz.isEmpty {
                        Kachel {
                            VStack(alignment: .leading, spacing: 2) {
                                Text("Notiz")
                                    .font(.grotesk(11, .medium))
                                    .foregroundStyle(.white.opacity(0.5))
                                Text(notiz)
                                    .font(.grotesk(13, .medium))
                                    .foregroundStyle(.white)
                            }
                        }
                    }
                }
                .padding(.horizontal, 4)
            } else {
                Text("Fahrt nicht mehr da")
                    .font(.grotesk(14, .bold))
                    .foregroundStyle(.white.opacity(0.7))
            }
        }
        .navigationTitle("Fahrt")
    }

    static func telURL(_ nummer: String) -> URL? {
        let rein = nummer.filter { $0.isNumber || $0 == "+" }
        guard rein.filter(\.isNumber).count >= 5 else { return nil }
        return URL(string: "tel:\(rein)")
    }

    private static func zeigeFlug(_ fahrt: UhrFahrt) -> Bool {
        let nummer = fahrt.flug.trimmingCharacters(in: .whitespaces)
        return (!nummer.isEmpty && nummer.uppercased() != "STADTFAHRT") || fahrt.flugStatus != nil || fahrt.flugAnkunft != nil
    }

    private static func verspaetung(_ min: Int?) -> String {
        guard let min, min != 0 else { return " · pünktlich" }
        return min > 0 ? " · +\(min) min" : " · \(min) min"
    }
}

// MARK: - Stunden von heute

/// Wie HeuteStundenKarte der iPhone-App: Start, Pausen, Ende und die Arbeitszeit, die hochlaeuft.
/// Nach Dienstende Bestaetigen (Zeiten so wie gezeigt). Aendern geht nur am iPhone.
struct StundenSeite: View {
    @EnvironmentObject private var verbindung: UhrVerbindung

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 8) {
                Text("Stunden heute")
                    .font(.grotesk(13, .bold))
                    .foregroundStyle(UhrFarbe.lime)
                if let heute = verbindung.stand.heute {
                    TimelineView(.periodic(from: .now, by: 15)) { kontext in
                        let min = heute.minuten(kontext.date)
                        let pause = heute.pauseLaeuft(kontext.date)
                        Kachel(rand: rand(heute)) {
                            VStack(alignment: .leading, spacing: 6) {
                                Text(String(format: "%02d:%02d", min / 60, min % 60))
                                    .font(.grotesk(36, .bold))
                                    .foregroundStyle(UhrFarbe.lime)
                                    .monospacedDigit()
                                    .contentTransition(.numericText())
                                Text(heute.fertig ? "Arbeitszeit" : (pause ? "Pause läuft" : "Läuft seit \(UhrText.uhr(heute.start))"))
                                    .font(.grotesk(12, .bold))
                                    .foregroundStyle(pause ? UhrFarbe.orange : .white.opacity(0.7))
                                HStack(spacing: 10) {
                                    ZeitWert(titel: "Start", wert: UhrText.uhr(heute.start))
                                    ZeitWert(titel: "Ende", wert: heute.ende.map(UhrText.uhr))
                                }
                            }
                        }
                    }
                    ForEach(heute.pausen, id: \.self) { p in
                        HStack {
                            Text("Pause")
                                .font(.grotesk(12, .bold))
                                .foregroundStyle(UhrFarbe.grau)
                            Spacer()
                            Text(UhrText.uhr(p.von) + " – " + (p.bis.map(UhrText.uhr) ?? "läuft"))
                                .font(.grotesk(12, .bold))
                                .foregroundStyle(.white)
                                .monospacedDigit()
                        }
                        .padding(.horizontal, 4)
                    }
                    if heute.offen {
                        if heute.zettelStatus == "zurueckgewiesen" {
                            Text("Von der Dispo zurückgegeben")
                                .font(.grotesk(12, .bold))
                                .foregroundStyle(UhrFarbe.rot)
                        }
                        LimeKnopf(text: "Bestätigen", arbeitet: verbindung.arbeitetID == "stunden") {
                            verbindung.stundenBestaetigen(heute)
                        }
                        Text("Ändern geht am iPhone.")
                            .font(.grotesk(11, .medium))
                            .foregroundStyle(.white.opacity(0.5))
                    } else if let status = statusText(heute.zettelStatus) {
                        Text(status)
                            .font(.grotesk(12, .bold))
                            .foregroundStyle(UhrFarbe.gruen)
                    } else if !heute.fertig {
                        Text("Pause zählt erst ab 3 Stunden. TRISAR erkennt sie aus deinen Fahrten.")
                            .font(.grotesk(11, .medium))
                            .foregroundStyle(.white.opacity(0.5))
                    }
                } else {
                    Kachel {
                        Text("Kein Dienst läuft")
                            .font(.grotesk(15, .bold))
                            .foregroundStyle(.white.opacity(0.7))
                    }
                }
            }
            .padding(.horizontal, 4)
        }
    }

    private func rand(_ h: UhrStunden) -> Color {
        if !h.fertig || h.zettelStatus == nil { return UhrFarbe.lime }
        return h.zettelStatus == "zurueckgewiesen" ? UhrFarbe.rot : UhrFarbe.gruen
    }

    private func statusText(_ status: String?) -> String? {
        switch status {
        case "eingereicht": return "Gesendet, Dispo prüft."
        case "bestaetigt": return "Von der Dispo bestätigt."
        default: return nil
        }
    }
}

extension UhrText {
    static func uhr(_ datum: Date) -> String {
        let f = DateFormatter()
        f.dateFormat = "HH:mm"
        return f.string(from: datum)
    }
}
