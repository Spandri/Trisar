import SwiftUI

/// KartenFilterView.jsx: Fahrersuche, Karosserie, Feierabend, Punkte bei Fahrt, eigene Orte,
/// speichern und loeschen.
/// Wie im Web wirkt auf der Karte nur die Fahrersuche (mehrere Begriffe mit ';').
struct KartenFilterAnsicht: View {
    @ObservedObject var filter: KartenFilter
    let zurueck: () -> Void
    @StateObject private var stufen = TrackerStufenModell()
    @ObservedObject private var orte = OrteSpeicher.geteilt
    @State private var ortEditor: OrtEditorZiel?
    private static let lime = Color(hex: 0xE3F654)

    // Wie im Web: Abschnitt "Punkte bei Fahrt" unter Feierabend (Web top 462, hier +20),
    // die Knoepfe darunter rutschen mit.
    private var stufeTop: CGFloat { 482 }
    private var stufeZeilenTop: CGFloat { stufeTop + 32 + 40 + 12 }
    /// Bereich "Orte" unter "Punkte bei Fahrt" (ohne Tracker gleich unter Feierabend).
    private var orteTop: CGFloat {
        guard !stufen.tracker.isEmpty else { return 482 }
        return stufeZeilenTop + CGFloat(stufen.tracker.count + (stufen.fehler == nil ? 0 : 1)) * 24 + 20
    }
    private var speichernTop: CGFloat { orteTop + OrteAbschnitt.hoehe(anzahl: orte.orte.count) + 32 }
    private var inhaltHoehe: CGFloat { max(834, speichernTop - 20 + 68 + 56 + 120) + 70 }

    var body: some View {
        ZStack(alignment: .topLeading) {
            DispoHintergrund().ignoresSafeArea()
            Leinwand(basisHoehe: 874, inhaltHoehe: inhaltHoehe, mitHintergrund: false) { _ in
                ZStack(alignment: .topLeading) {
                    ZurueckKnopf(aktion: zurueck).platz(20, 60, 50, 50)
                    Text("Karten Filter").grotesk(42, .bold).foregroundStyle(Self.lime).frame(height: 42)
                        .platz(20, 140, nil, 42)

                    SuchZeile(text: $filter.fahrerSuche).platz(20, 206, 362, 56)

                    ZweierKnopf(text: "Limosine", an: $filter.limousine).platz(20, 286, 175, 40)
                    ZweierKnopf(text: "SUV", an: $filter.suv).platz(207, 286, 175, 40)
                    ZweierKnopf(text: "VAN", an: $filter.van).platz(20, 338, 175, 40)
                    ZweierKnopf(text: "Coupe", an: $filter.coupe).platz(207, 338, 175, 40)

                    FeierabendZeile(wert: $filter.feierabendMinuten).platz(20, 402, 362, 56)

                    if !stufen.tracker.isEmpty {
                        Text("Punkte bei Fahrt").grotesk(16, .medium, abstand: 0.5)
                            .foregroundStyle(Self.lime.opacity(0.6))
                            .platz(20, stufeTop, 362, 24)
                        ForEach(Array(TrackerStufenModell.stufen.enumerated()), id: \.offset) { i, stufe in
                            StufenKnopf(text: stufe, an: stufen.gemeinsameStufe == stufe) {
                                Task { await stufen.setzen(stufe) }
                            }
                            .platz(20 + CGFloat(i) * 124, stufeTop + 32, 114, 40)
                        }
                        ForEach(Array(stufen.tracker.enumerated()), id: \.element.imei) { i, t in
                            StufenStatusZeile(tracker: t).platz(20, stufeZeilenTop + CGFloat(i) * 24, 362, 24)
                        }
                        if let fehler = stufen.fehler {
                            Text("Speichern fehlgeschlagen: \(fehler)").grotesk(14, .medium)
                                .foregroundStyle(Color(hex: 0xFF6B6B)).lineLimit(1)
                                .platz(20, stufeZeilenTop + CGFloat(stufen.tracker.count) * 24, 362, 24)
                        }
                    }

                    OrteAbschnitt(orte: orte) { ortEditor = OrtEditorZiel(ort: $0) }
                        .platz(20, orteTop, 362, OrteAbschnitt.hoehe(anzahl: orte.orte.count))

                    Button(action: zurueck) {
                        HStack {
                            Text("Filter speichern").grotesk(16, .medium, abstand: 0.4).foregroundStyle(Color(hex: 0x1D1C1D))
                            Spacer()
                            Image("Arrow_Trisar_Icons_01").resizable().frame(width: 34, height: 20)
                        }
                        .padding(.horizontal, 12)
                        .frame(width: 362, height: 56)
                        .background(Self.lime)
                    }
                    .buttonStyle(.web)
                    .platz(20, speichernTop, 362, 56)

                    Button { filter.zuruecksetzen() } label: {
                        HStack {
                            Text("Filter Löschen").grotesk(16, .medium, abstand: 0.4).foregroundStyle(Color(hex: 0x1D1C1D))
                            Spacer()
                            Image("Arrow_Nav_Trisar_Icons_01").resizable().frame(width: 34, height: 20)
                        }
                        .padding(.horizontal, 12)
                        .frame(width: 362, height: 56)
                        .background(Color(hex: 0xFF6B6B))
                    }
                    .buttonStyle(.web)
                    .platz(20, speichernTop + 68, 362, 56)
                }
            }
            .scrollDismissesKeyboard(.interactively)
            FussleisteUnten()

            if let ziel = ortEditor {
                OrtBearbeitenAnsicht(ort: ziel.ort) { ortEditor = nil }
                    .id(ziel.id)
            }
        }
        .task { await stufen.laufen() }
        .task { await orte.laden() }
    }
}

/// Punkte bei Fahrt fuer alle OBD-Tracker (obd_tracker.stufe), wie useTrackerStufen im Web.
/// Das Gateway uebernimmt die Stufe beim naechsten Verbinden und quittiert sie (stufe_status).
@MainActor
final class TrackerStufenModell: ObservableObject {
    static let stufen = ["sparsam", "mittel", "fein"]

    struct Tracker: Decodable {
        let imei: String
        let nummer: Int
        var stufe: String
        var stufe_status: String?
        let stufe_quittung_am: String?
        var stufe_antwort: String?
    }

    @Published var tracker: [Tracker] = []
    @Published var fehler: String?

    var gemeinsameStufe: String? {
        guard let erste = tracker.first?.stufe, tracker.allSatisfy({ $0.stufe == erste }) else { return nil }
        return erste
    }

    /// Laedt alle 10 s neu, solange der Filter offen ist (Quittung kommt vom Gateway).
    func laufen() async {
        while !Task.isCancelled {
            await laden()
            try? await Task.sleep(nanoseconds: 10_000_000_000)
        }
    }

    func laden() async {
        // Tabelle oder Spalte fehlt (Migration noch nicht da): Abschnitt bleibt weg.
        guard let zeilen: [Tracker] = try? await Backend.client.from("obd_tracker")
            .select("imei, nummer, stufe, stufe_status, stufe_quittung_am, stufe_antwort")
            .order("nummer", ascending: true)
            .execute().value else { return }
        tracker = zeilen
    }

    func setzen(_ stufe: String) async {
        // Nur Tracker, die die Stufe noch nicht haben oder bei denen sie fehlschlug.
        let imeis = tracker.filter {
            $0.stufe != stufe || !["wartet", "gesendet", "uebernommen"].contains($0.stufe_status ?? "")
        }.map(\.imei)
        guard !imeis.isEmpty else { return }
        fehler = nil
        for i in tracker.indices where imeis.contains(tracker[i].imei) {
            tracker[i].stufe = stufe
            tracker[i].stufe_status = "wartet"
            tracker[i].stufe_antwort = nil
        }
        do {
            try await Backend.client.from("obd_tracker").update(["stufe": stufe]).in("imei", values: imeis).execute()
        } catch {
            fehler = error.localizedDescription
        }
        await laden()
    }
}

/// Dreier-Knopf wie TwoColButton, nur 114 breit.
private struct StufenKnopf: View {
    let text: String
    let an: Bool
    let aktion: () -> Void
    private static let lime = Color(hex: 0xE3F654)

    var body: some View {
        Button(action: aktion) {
            Text(text).grotesk(16, .medium, abstand: 0.4)
                .foregroundStyle(an ? Color(hex: 0x1D1C1D) : Self.lime)
                .frame(width: 114, height: 40)
                .background(an ? Self.lime : Color.clear)
                .overlay(Rectangle().strokeBorder(Self.lime, lineWidth: 2))
        }
        .buttonStyle(.web)
    }
}

/// "Nr. 2 · fein · übernommen 14:02" (TrackerStufeStatus im Web).
private struct StufenStatusZeile: View {
    let tracker: TrackerStufenModell.Tracker
    private static let lime = Color(hex: 0xE3F654)

    private var status: (String, Color) {
        switch tracker.stufe_status {
        case "wartet": return ("wartet auf Tracker", Self.lime.opacity(0.6))
        case "gesendet": return ("gesendet", Self.lime.opacity(0.6))
        case "uebernommen": return ("übernommen \(Self.uhrzeit(tracker.stufe_quittung_am))".trimmingCharacters(in: .whitespaces), Self.lime)
        case "fehler": return ("Fehler", Color(hex: 0xFF6B6B))
        default: return ("Stand unbekannt", Self.lime.opacity(0.6))
        }
    }

    var body: some View {
        let (text, farbe) = status
        (Text("Nr. \(tracker.nummer)").foregroundStyle(Self.lime).bold()
            + Text(" · \(tracker.stufe) · ").foregroundStyle(Self.lime.opacity(0.6))
            + Text(text).foregroundStyle(farbe))
            .font(.grotesk(14, .medium)).tracking(0.5)
            .lineLimit(1)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    }

    /// Heute nur Uhrzeit, sonst "07.11. 14:02".
    static func uhrzeit(_ iso: String?) -> String {
        guard let iso, !iso.isEmpty else { return "" }
        let mitBruch = ISO8601DateFormatter()
        mitBruch.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let d = mitBruch.date(from: iso) ?? ISO8601DateFormatter().date(from: iso) else { return "" }
        let f = DateFormatter()
        f.locale = Locale(identifier: "de_DE")
        f.dateFormat = Calendar.current.isDateInToday(d) ? "HH:mm" : "dd.MM. HH:mm"
        return f.string(from: d)
    }
}

/// SearchInputRow: links "Fahrer Suchen", beim Tippen "Fahrer" und das Feld, rechts Lupe oder Loeschen.
private struct SuchZeile: View {
    @Binding var text: String
    @FocusState private var fokus: Bool
    private static let lime = Color(hex: 0xE3F654)

    var body: some View {
        let hatWert = !text.trimmingCharacters(in: .whitespaces).isEmpty
        HStack(spacing: 12) {
            Text(fokus || hatWert ? "Fahrer" : "Fahrer Suchen").grotesk(16, .medium, abstand: 0.5)
                .foregroundStyle(Self.lime.opacity(0.6)).fixedSize()
            TextField("", text: $text)
                .font(.grotesk(16, .medium)).tracking(0.5)
                .foregroundStyle(Self.lime)
                .tint(Self.lime)
                .autocorrectionDisabled()
                .textInputAutocapitalization(.never)
                .focused($fokus)
            Group {
                if hatWert {
                    Button { text = ""; fokus = true } label: {
                        Image("clear-field-green").resizable().frame(width: 20, height: 20)
                    }
                    .buttonStyle(.web)
                    .accessibilityLabel("Fahrer zurücksetzen")
                } else {
                    Image("karten-filter-search").resizable().frame(width: 24, height: 24)
                }
            }
            .frame(width: 24, height: 24)
        }
        .padding(.horizontal, 12)
        .frame(width: 362, height: 56)
        .overlay(Rectangle().strokeBorder(Self.lime, lineWidth: 2))
        .contentShape(Rectangle())
        .onTapGesture { fokus = true }
    }
}

/// TwoColButton: Rahmen Lime, an = Lime gefuellt mit dunkler Schrift.
private struct ZweierKnopf: View {
    let text: String
    @Binding var an: Bool
    private static let lime = Color(hex: 0xE3F654)

    var body: some View {
        Button { an.toggle() } label: {
            Text(text).grotesk(16, .medium, abstand: 0.4)
                .foregroundStyle(an ? Color(hex: 0x1D1C1D) : Self.lime)
                .frame(width: 175, height: 40)
                .background(an ? Self.lime : Color.clear)
                .overlay(Rectangle().strokeBorder(Self.lime, lineWidth: 2))
        }
        .buttonStyle(.web)
    }
}

/// MinutePickerRow: "Feierabend in ... min", gewaehlt "Feierabend in 30 min", rechts Uhr oder Loeschen.
private struct FeierabendZeile: View {
    @Binding var wert: String
    private static let lime = Color(hex: 0xE3F654)
    private static let optionen = ["15 min", "30 min", "45 min", "60 min", "90 min", "120 min"]

    var body: some View {
        HStack(spacing: 0) {
            Menu {
                Button("---") { wert = "" }
                ForEach(Self.optionen, id: \.self) { o in Button(o) { wert = o } }
            } label: {
                Group {
                    if wert.isEmpty {
                        Text("Feierabend in ... min").foregroundStyle(Self.lime.opacity(0.6))
                    } else {
                        (Text("Feierabend in ").foregroundStyle(Self.lime.opacity(0.6)) + Text(wert).foregroundStyle(Self.lime))
                    }
                }
                .font(.grotesk(16, .medium)).tracking(0.5)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
                .contentShape(Rectangle())
            }
            .accessibilityLabel("Feierabend in Minuten")
            Group {
                if wert.isEmpty {
                    Image("clock-green").resizable().frame(width: 20, height: 20)
                } else {
                    Button { wert = "" } label: { Image("clear-field-green").resizable().frame(width: 20, height: 20) }
                        .buttonStyle(.web)
                        .accessibilityLabel("Feierabend zurücksetzen")
                }
            }
            .frame(width: 40, height: 40)
        }
        .padding(.horizontal, 12)
        .frame(width: 362, height: 56)
        .overlay(Rectangle().strokeBorder(Self.lime, lineWidth: 2))
    }
}
