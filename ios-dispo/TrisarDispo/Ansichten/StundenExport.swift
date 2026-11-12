import SwiftUI
import Supabase

/// Stunden als Excel (wie StundenExport.jsx): dispo-admin, Aktion stunden_export.
/// - ExportKnopf: Knopf oben rechts (Fahrer-Ansicht und Alle Fahrer).
/// - StundenExport.datei: holt die Datei und legt sie zum Teilen ab.
/// - StundenExportFenster: Zeitraum und Fahrer waehlen (alle oder einzelne).
enum StundenExport {
    static func isoTag(_ d: Date) -> String {
        let f = DateFormatter(); f.locale = Locale(identifier: "en_US_POSIX"); f.timeZone = Stunden.berlin; f.dateFormat = "yyyy-MM-dd"
        return f.string(from: d)
    }

    /// fahrer nil = alle Fahrer.
    static func datei(von: String, bis: String, fahrer: [String]?) async throws -> (url: URL, dienste: Int) {
        struct Koerper: Encodable { let aktion = "stunden_export"; let von: String; let bis: String; let fahrer: [String]? }
        struct Antwort: Decodable { let datei: String; let dateiname: String; let dienste: Int? }
        let a: Antwort = try await Backend.client.functions.invoke("dispo-admin", options: FunctionInvokeOptions(
            body: Koerper(von: von, bis: bis, fahrer: fahrer)))
        guard let daten = Data(base64Encoded: a.datei) else { throw TrisarFehler.text("leer") }
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(a.dateiname)
        try daten.write(to: url, options: .atomic)
        return (url, a.dienste ?? 0)
    }

    /// Alle Stunden eines Fahrers: ab 2020 bis heute.
    static func alleVon(_ fahrerID: String) async throws -> URL {
        try await datei(von: "2020-01-01", bis: isoTag(Date()), fahrer: [fahrerID]).url
    }
}

/// Datei fuers Teilen-Blatt (sheet(item:)).
struct TeilbareDatei: Identifiable { let url: URL; var id: String { url.path } }

/// Teilen-Blatt fuer eine Datei (Excel).
struct DateiTeilen: UIViewControllerRepresentable {
    let url: URL
    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: [url], applicationActivities: nil)
    }
    func updateUIViewController(_ vc: UIActivityViewController, context: Context) {}
}

/// Knopf oben rechts: Kreis wie der Zurueck-Knopf (50 pt, grauer Rand), darin das Export-Zeichen
/// aus Figma (1429-9895).
struct ExportKnopf: View {
    var busy = false
    let aktion: () -> Void
    var body: some View {
        Button(action: aktion) {
            ZStack {
                Circle().stroke(Color(hex: 0x747474), lineWidth: 1)
                Image("Import_Trisar_Icons_01_Lime").resizable().scaledToFit().frame(width: 24, height: 24)
            }
            .frame(width: 50, height: 50)
            .opacity(busy ? 0.5 : 1)
            .contentShape(Circle())
        }
        .buttonStyle(.web)
        .disabled(busy)
        .accessibilityLabel("Stunden exportieren")
    }
}

/// Fenster fuer Alle Fahrer: Zeitraum (Standard dieser Monat) und Fahrer (Standard alle).
struct StundenExportFenster: View {
    let schliessen: () -> Void

    private struct Profil: Decodable { let id: String; let first_name: String?; let last_name: String?; let role: String?; let is_dispo: Bool? }
    private struct Fahrer: Identifiable { let id: String; let name: String }

    @State private var von: Date
    @State private var bis: Date
    @State private var fahrer: [Fahrer] = []
    /// nil = alle Fahrer.
    @State private var auswahl: Set<String>?
    @State private var busy = false
    @State private var meldung = ""
    @State private var datei: TeilbareDatei?

    private let lime = Color(hex: 0xE3F654)

    init(schliessen: @escaping () -> Void) {
        self.schliessen = schliessen
        var k = Calendar(identifier: .gregorian); k.timeZone = Stunden.berlin
        let start = k.date(from: k.dateComponents([.year, .month], from: Date())) ?? Date()
        _von = State(initialValue: start)
        _bis = State(initialValue: k.date(byAdding: DateComponents(month: 1, day: -1), to: start) ?? Date())
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                HStack {
                    Text("Stunden exportieren").grotesk(26, .bold).foregroundStyle(lime)
                    Spacer()
                    Button(action: schliessen) { Text("×").grotesk(28, .regular).foregroundStyle(.white.opacity(0.6)) }
                        .buttonStyle(.web).accessibilityLabel("Schließen")
                }
                HStack(spacing: 8) {
                    datumFeld("Von", $von)
                    datumFeld("Bis", $bis)
                }
                .padding(.top, 16)
                FlussChips {
                    chip("Alle Fahrer", an: auswahl == nil, fett: true) { auswahl = nil }
                    ForEach(fahrer) { f in
                        chip(f.name, an: auswahl?.contains(f.id) == true, fett: false) { umschalten(f.id) }
                    }
                }
                .padding(.top, 16)
                Button { Task { await exportieren() } } label: {
                    HStack {
                        Text(busy ? "Excel wird erstellt …" : "Excel herunterladen").grotesk(16, .bold, abstand: -0.5).foregroundStyle(.black)
                        Spacer()
                        Image("Arrow_Trisar_Icons_01").resizable().scaledToFit().frame(width: 34, height: 20)
                    }
                    .padding(.horizontal, 24).frame(maxWidth: .infinity).frame(height: 56).background(lime)
                }
                .buttonStyle(.web).disabled(busy).padding(.top, 20)
                if !meldung.isEmpty {
                    Text(meldung).grotesk(13, .medium).foregroundStyle(.white.opacity(0.6)).padding(.top, 12)
                }
            }
            .padding(20)
        }
        .background(Color(hex: 0x0F0F0F).ignoresSafeArea())
        .presentationDetents([.large])
        .task { await fahrerLaden() }
        .sheet(item: $datei) { d in DateiTeilen(url: d.url).ignoresSafeArea() }
    }

    private func datumFeld(_ titel: String, _ wert: Binding<Date>) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(titel).grotesk(10, .medium).foregroundStyle(.white.opacity(0.5))
            DatePicker("", selection: wert, displayedComponents: .date)
                .labelsHidden().environment(\.timeZone, Stunden.berlin).environment(\.locale, Locale(identifier: "de_DE"))
                .colorScheme(.dark)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func chip(_ text: String, an: Bool, fett: Bool, aktion: @escaping () -> Void) -> some View {
        Button(action: aktion) {
            Text(text).grotesk(12, fett ? .bold : .medium).foregroundStyle(an ? .black : (fett ? lime : .white.opacity(0.75)))
                .padding(.horizontal, 12).frame(height: 30)
                .background(an ? lime : .clear)
                .overlay(Rectangle().strokeBorder(an ? .clear : (fett ? lime : .white.opacity(0.3)), lineWidth: 1))
        }
        .buttonStyle(.web)
    }

    private func umschalten(_ id: String) {
        var jetzt = auswahl ?? []
        if jetzt.contains(id) { jetzt.remove(id) } else { jetzt.insert(id) }
        auswahl = jetzt.isEmpty ? nil : jetzt
    }

    private func fahrerLaden() async {
        let keinFahrer: Set<String> = ["dispo", "dispatcher", "admin", "koordinator", "pruefung"]
        let zeilen: [Profil] = (try? await Backend.client.from("profiles").select("id, first_name, last_name, role, is_dispo")
            .order("first_name").execute().value) ?? []
        fahrer = zeilen.filter { $0.is_dispo != true && !keinFahrer.contains(($0.role ?? "").lowercased()) }
            .map { p in
                let n = "\(p.first_name ?? "") \(p.last_name ?? "")".trimmingCharacters(in: .whitespaces)
                return Fahrer(id: p.id, name: n.isEmpty ? "Fahrer" : n)
            }
    }

    private func exportieren() async {
        busy = true; meldung = ""
        do {
            let r = try await StundenExport.datei(von: StundenExport.isoTag(von), bis: StundenExport.isoTag(bis),
                                                  fahrer: auswahl.map { Array($0) })
            meldung = "\(r.dienste) Dienste exportiert."
            datei = TeilbareDatei(url: r.url)
        } catch {
            meldung = "Export fehlgeschlagen."
        }
        busy = false
    }
}

/// Chips nebeneinander mit Umbruch.
private struct FlussChips: Layout {
    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let breite = proposal.width ?? 362
        var x: CGFloat = 0, y: CGFloat = 0, zeile: CGFloat = 0
        for s in subviews {
            let g = s.sizeThatFits(.unspecified)
            if x > 0 && x + g.width > breite { x = 0; y += zeile + 6; zeile = 0 }
            x += g.width + 6; zeile = max(zeile, g.height)
        }
        return CGSize(width: breite, height: y + zeile)
    }
    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX, y = bounds.minY, zeile: CGFloat = 0
        for s in subviews {
            let g = s.sizeThatFits(.unspecified)
            if x > bounds.minX && x + g.width > bounds.maxX { x = bounds.minX; y += zeile + 6; zeile = 0 }
            s.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(g))
            x += g.width + 6; zeile = max(zeile, g.height)
        }
    }
}
