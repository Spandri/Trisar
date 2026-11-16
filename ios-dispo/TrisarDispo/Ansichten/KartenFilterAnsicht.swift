import SwiftUI

/// KartenFilterView.jsx: Fahrersuche, Karosserie, Feierabend, Punkte bei Fahrt, eigene Orte,
/// speichern und loeschen.
/// Wie im Web wirkt auf der Karte nur die Fahrersuche (mehrere Begriffe mit ';').
struct KartenFilterAnsicht: View {
    @ObservedObject var filter: KartenFilter
    let zurueck: () -> Void
    @StateObject private var stufen = TrackerStufenModell()
    @StateObject private var dienststart = DienststartVorlaufModell()
    @ObservedObject private var orte = OrteSpeicher.geteilt
    @ObservedObject private var ohneSignal = OhneSignalEinstellung.geteilt
    /// Gerade lange ohne Signal (fuer die Zeile unter dem Schalter), von der Karte mitgegeben.
    var langeOhneSignal: [KartenFahrer] = []
    @State private var ortEditor: OrtEditorZiel?
    private static let lime = Color(hex: 0xE3F654)

    // Wie im Web: Abschnitt "Punkte bei Fahrt" unter Feierabend (Web top 462, hier +20),
    // die Knoepfe darunter rutschen mit.
    /// Abschnitt "Ohne Signal ausblenden nach" unter Feierabend (Web 462 + 20), feste Hoehe 180.
    /// Abschnitt "Dienststart automatisch" direkt unter Feierabend (Web 462 + 20), feste Hoehe 132.
    private var dienststartTop: CGFloat { 482 }
    private var ohneSignalTop: CGFloat { dienststart.verfuegbar ? dienststartTop + 132 : dienststartTop }
    private var stufeTop: CGFloat { ohneSignalTop + 136 }
    private var stufeZeilenTop: CGFloat { stufeTop + 32 + 40 + 12 }
    /// Bereich "Orte" unter "Punkte bei Fahrt" (ohne Tracker gleich unter Feierabend).
    private var orteTop: CGFloat {
        guard !stufen.tracker.isEmpty else { return stufeTop }
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

                    if dienststart.verfuegbar {
                        Text("Dienststart automatisch").grotesk(16, .medium, abstand: 0.5)
                            .foregroundStyle(Self.lime.opacity(0.6))
                            .platz(20, dienststartTop, 362, 24)
                        DienststartZeile(minuten: dienststart.minuten) { neu in
                            Task { await dienststart.setzen(neu) }
                        }
                        .platz(20, dienststartTop + 32, 362, 56)
                        Text(dienststart.fehler.map { "Speichern fehlgeschlagen: \($0)" }
                             ?? "Gilt für alle Fahrer. Der Fahrer bestätigt den Dienst wie gewohnt.")
                            .grotesk(12, .medium, abstand: 0.3)
                            .foregroundStyle(dienststart.fehler == nil ? Self.lime.opacity(0.5) : Color(hex: 0xFF6B6B))
                            .lineLimit(2)
                            .platz(20, dienststartTop + 96, 362, 32)
                    }

                    Text("Ohne Signal ausblenden nach").grotesk(16, .medium, abstand: 0.5)
                        .foregroundStyle(Self.lime.opacity(0.6))
                        .platz(20, ohneSignalTop, 362, 24)
                    OhneSignalStunden(einstellung: ohneSignal).platz(20, ohneSignalTop + 32, 236, 56)
                    AusblendenKnopf(an: !ohneSignal.zeigen) { ohneSignal.zeigen.toggle() }
                        .platz(264, ohneSignalTop + 32, 118, 56)
                    if !langeOhneSignal.isEmpty {
                        let liste = langeOhneSignal.prefix(4).map(OhneSignalEinstellung.seit).joined(separator: " · ")
                            + (langeOhneSignal.count > 4 ? " …" : "")
                        Text(ohneSignal.zeigen
                             ? "\(langeOhneSignal.count) länger ohne Signal, mit letztem Standort sichtbar"
                             : "\(langeOhneSignal.count) länger ohne Signal: \(liste)").grotesk(14, .medium, abstand: 0.3)
                            .foregroundStyle(Self.lime.opacity(0.6)).lineLimit(1)
                            .platz(20, ohneSignalTop + 96, 362, 24)
                    }

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
        .task { await dienststart.laden() }
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

/// Dienststart automatisch vor der ersten Fahrt (15.11.), wie useDienststartVorlauf im Web.
/// dispo_einstellungen 'dienststart_vorlauf_min', fehlt = aus. Der DB-Trigger trg_jobs_dienststart
/// schickt damit beim Zuteilen einer Fahrt den Dienststart (Migration 20261115140000).
@MainActor
final class DienststartVorlaufModell: ObservableObject {
    static let schluessel = "dienststart_vorlauf_min"
    static let optionen = [15, 30, 45, 60, 90, 120]

    @Published var minuten: Int?
    /// false, wenn die Tabelle fehlt (Migration noch nicht da): Abschnitt bleibt weg.
    @Published var verfuegbar = false
    @Published var fehler: String?

    private struct Zeile: Codable {
        let schluessel: String
        let wert: Double?

        /// wert immer mitschicken, auch null (Aus), sonst bliebe beim Upsert der alte Wert stehen.
        func encode(to encoder: Encoder) throws {
            var c = encoder.container(keyedBy: CodingKeys.self)
            try c.encode(schluessel, forKey: .schluessel)
            try c.encode(wert, forKey: .wert)
        }
    }

    func laden() async {
        do {
            let zeilen: [Zeile] = try await Backend.client.from("dispo_einstellungen")
                .select("schluessel, wert").eq("schluessel", value: Self.schluessel)
                .execute().value
            if let w = zeilen.first?.wert, w > 0 { minuten = Int(w) } else { minuten = nil }
            verfuegbar = true
        } catch {
            verfuegbar = false
        }
    }

    func setzen(_ neu: Int?) async {
        let alt = minuten
        minuten = neu
        fehler = nil
        do {
            // Aus = wert null (Zeile bleibt), Standard 60 min setzt die Migration.
            try await Backend.client.from("dispo_einstellungen")
                .upsert([Zeile(schluessel: Self.schluessel, wert: neu.map(Double.init))], onConflict: "schluessel", returning: .minimal)
                .execute()
        } catch {
            minuten = alt
            fehler = error.localizedDescription
        }
    }
}

/// Wie FeierabendZeile: "Dienststart 30 min vor 1. Fahrt", aus "Dienststart automatisch aus".
private struct DienststartZeile: View {
    let minuten: Int?
    let setzen: (Int?) -> Void
    private static let lime = Color(hex: 0xE3F654)

    var body: some View {
        HStack(spacing: 0) {
            Menu {
                Button("Aus") { setzen(nil) }
                ForEach(DienststartVorlaufModell.optionen, id: \.self) { o in Button("\(o) min") { setzen(o) } }
            } label: {
                Group {
                    if let minuten {
                        (Text("Dienststart ").foregroundStyle(Self.lime.opacity(0.6))
                         + Text("\(minuten) min").foregroundStyle(Self.lime)
                         + Text(" vor 1. Fahrt").foregroundStyle(Self.lime.opacity(0.6)))
                    } else {
                        Text("Dienststart automatisch aus").foregroundStyle(Self.lime.opacity(0.6))
                    }
                }
                .font(.grotesk(16, .medium)).tracking(0.5)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
                .contentShape(Rectangle())
            }
            .accessibilityLabel("Dienststart automatisch")
            Group {
                if minuten == nil {
                    Image("clock-green").resizable().frame(width: 20, height: 20)
                } else {
                    Button { setzen(nil) } label: { Image("clear-field-green").resizable().frame(width: 20, height: 20) }
                        .buttonStyle(.web)
                        .accessibilityLabel("Dienststart automatisch ausschalten")
                }
            }
            .frame(width: 40, height: 40)
        }
        .padding(.horizontal, 12)
        .frame(width: 362, height: 56)
        .overlay(Rectangle().strokeBorder(Self.lime, lineWidth: 2))
    }
}

/// Stunden-Feld fuer die Schwelle "ohne Signal": "nach 0,5 h", ganzes Kaestchen tippbar,
/// Zahlentastatur mit Komma. Gueltige Eingaben gelten sofort.
private struct OhneSignalStunden: View {
    @ObservedObject var einstellung: OhneSignalEinstellung
    @State private var entwurf = ""
    @FocusState private var fokus: Bool
    private static let lime = Color(hex: 0xE3F654)

    var body: some View {
        HStack(spacing: 0) {
            Text("nach ").grotesk(16, .medium, abstand: 0.5).foregroundStyle(Self.lime.opacity(0.6)).fixedSize()
            TextField("", text: $entwurf)
                .font(.grotesk(16, .medium)).tracking(0.5)
                .foregroundStyle(Self.lime)
                .tint(Self.lime)
                .keyboardType(.decimalPad)
                .focused($fokus)
                // Breite folgt der Zahl, damit "h" direkt dahinter steht.
                .frame(width: CGFloat(max(2, entwurf.count)) * 10 + 6)
                .onChange(of: entwurf) { _, neu in
                    let sauber = String(neu.filter { "0123456789,.".contains($0) }.prefix(5))
                    if sauber != neu { entwurf = sauber; return }
                    if fokus, let m = OhneSignalEinstellung.stundenLesen(sauber) { einstellung.minuten = m }
                }
            Text(" h").grotesk(16, .medium, abstand: 0.5).foregroundStyle(Self.lime.opacity(0.6))
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 12)
        .frame(width: 236, height: 56)
        .background(fokus ? Self.lime.opacity(0.08) : Color.clear)
        .overlay(Rectangle().strokeBorder(Self.lime, lineWidth: 2))
        .opacity(einstellung.zeigen ? 0.4 : 1)
        .contentShape(Rectangle())
        .onTapGesture { fokus = true }
        .onAppear { entwurf = OhneSignalEinstellung.stundenText(einstellung.minuten) }
        .onChange(of: fokus) { _, an in if !an { entwurf = OhneSignalEinstellung.stundenText(einstellung.minuten) } }
        .onChange(of: einstellung.minuten) { _, m in if !fokus { entwurf = OhneSignalEinstellung.stundenText(m) } }
        .toolbar {
            ToolbarItemGroup(placement: .keyboard) {
                Spacer()
                Button("Fertig") { fokus = false }
            }
        }
        .accessibilityLabel("Ohne Signal ausblenden nach Stunden")
    }
}

/// Knopf neben dem Stunden-Feld: an = "Ausblenden" (Lime gefuellt, Auge zu), aus = "Alle zeigen".
private struct AusblendenKnopf: View {
    let an: Bool
    let aktion: () -> Void
    private static let lime = Color(hex: 0xE3F654)

    var body: some View {
        Button(action: aktion) {
            HStack(spacing: 6) {
                Image(systemName: an ? "eye.slash" : "eye").font(.system(size: 16, weight: .medium))
                Text(an ? "Ausblenden" : "Alle zeigen").grotesk(14, .medium, abstand: 0.3)
            }
            .foregroundStyle(an ? Color(hex: 0x1D1C1D) : Self.lime)
            .frame(width: 118, height: 56)
            .background(an ? Self.lime : Color.clear)
            .overlay(Rectangle().strokeBorder(Self.lime, lineWidth: 2))
        }
        .buttonStyle(.web)
        .accessibilityAddTraits(an ? .isSelected : [])
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
