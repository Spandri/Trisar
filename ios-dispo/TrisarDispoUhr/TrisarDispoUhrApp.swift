import MapKit
import SwiftUI
import WatchConnectivity
import WatchKit
import WidgetKit

/// Apple-Watch-App der TRISAR Dispo. Seiten zum Durchwischen:
/// Uebersicht (Fahrer je Zustand, Fahrten ohne Fahrer), Fahrten, Karte, Fahrer, KI-Assistent.
/// Fahrer antippen (Liste oder Karte): Infos wie auf der iPhone-Karte, Anrufen. Fahrt ohne Fahrer: Fahrer zuweisen (speichert das iPhone).
/// Komplikation: TrisarDispoUhrWidget, Zahlen ueber die App Group (DispoUhrZahlen).
/// Daten kommen vom iPhone (DispoUhrBruecke), die Uhr meldet sich nicht selbst an.
@main
struct TrisarDispoUhrApp: App {
    @StateObject private var verbindung = DispoUhrVerbindung()

    var body: some Scene {
        WindowGroup {
            DispoUhrHaupt()
                .environmentObject(verbindung)
        }
    }
}

@MainActor
final class DispoUhrVerbindung: NSObject, ObservableObject {
    @Published private(set) var stand: DispoUhrStand
    @Published private(set) var laedt = false
    @Published var meldung: String?
    /// KI-Assistent: Verlauf auf der Uhr, Fragen laufen ueber das iPhone (ki_frage).
    @Published private(set) var kiNachrichten: [KiNachricht] = []
    @Published private(set) var kiDenkt = false
    /// Fragen, deren Antwort noch nicht da ist (IDs, siehe kiFragen).
    private var wartendeFragen: Set<String> = []
    /// Offenes Blatt (Fahrer anrufen, Fahrer zuweisen).
    @Published var blatt: DispoUhrBlatt?
    /// Voice-Modus offen. Liegt hier statt in der KI-Seite: die Seite wird bei neuem Stand vom iPhone
    /// neu aufgebaut, dann ging der Zustand verloren, das Blatt schloss sich und das Vorlesen brach ab (13.11.).
    @Published var sprachModus: Bool = ProcessInfo.processInfo.arguments.contains("-uhrSprache")
    /// Zuweisungen von der Uhr je Fahrt (jobs.id).
    @Published private(set) var zuweisung: [String: ZuweisStatus] = [:]
    /// Flaggenfilter fuer Karte und Fahrerliste (leer = alle Fahrer).
    @Published var flaggenFilter: Set<String> = []

    func passtZuFlaggen(_ f: DispoUhrFahrer) -> Bool {
        flaggenFilter.isEmpty || flaggenFilter.contains(f.flagge ?? "")
    }
    private static let speicherSchluessel = "trisar_dispo_uhr_stand"
    /// Simulator (-uhrBeispiel -uhrVerbinden): Stand vom iPhone nicht uebernehmen.
    private var nurBeispiel = false

    enum ZuweisStatus: Equatable { case sendet(String), fertig(String), fehler(String) }

    override init() {
        if let daten = UserDefaults.standard.data(forKey: Self.speicherSchluessel),
           let alt = try? JSONDecoder().decode(DispoUhrStand.self, from: daten) {
            stand = alt
        } else {
            stand = .leer
        }
        super.init()
        #if DEBUG
        // Simulator ohne gekoppeltes iPhone: Start mit Argument -uhrBeispiel zeigt Beispieldaten.
        // Dazu -uhrZeige anrufen | zuweisen | komplikation oeffnet gleich das passende Blatt.
        if ProcessInfo.processInfo.arguments.contains("-uhrBeispiel") {
            stand = Self.beispiel
            kiNachrichten = Self.kiBeispiel
            zahlenSchreiben(stand)
            blatt = Self.beispielBlatt(stand)
            // Dazu -uhrVerbinden: Beispieldaten bleiben, Fragen gehen aber wirklich ans iPhone.
            guard ProcessInfo.processInfo.arguments.contains("-uhrVerbinden") else { return }
            nurBeispiel = true
            kiNachrichten = []
            WCSession.default.delegate = self
            WCSession.default.activate()
            return
        }
        #endif
        zahlenSchreiben(stand)
        if WCSession.isSupported() {
            WCSession.default.delegate = self
            WCSession.default.activate()
        }
    }

    fileprivate func uebernehmen(_ neu: DispoUhrStand) {
        if nurBeispiel { return }
        let alt = stand
        stand = neu
        if let daten = try? JSONEncoder().encode(neu) {
            UserDefaults.standard.set(daten, forKey: Self.speicherSchluessel)
        }
        // Mehr Fahrten ohne Fahrer oder mehr Fahrer ohne Signal: am Handgelenk tippen.
        if alt.angemeldet, neu.angemeldet,
           neu.ohneFahrerHeute > alt.ohneFahrerHeute || neu.ohneSignal > alt.ohneSignal {
            WKInterfaceDevice.current().play(.notification)
        }
        // Zugewiesene Fahrten mit Fahrer brauchen keinen Status mehr.
        for (id, status) in zuweisung {
            if case .sendet = status { continue }
            if neu.fahrten.first(where: { $0.id == id })?.ohneFahrer != true { zuweisung[id] = nil }
        }
        zahlenSchreiben(neu)
    }

    /// Zahlen fuer die Komplikation ablegen und sie nur bei Aenderung neu laden.
    private func zahlenSchreiben(_ s: DispoUhrStand) {
        var neu = s.zahlen
        if var alt = DispoUhrZahlen.laden() {
            alt.stand = neu.stand
            if alt == neu { return }
        }
        neu.stand = Date()
        neu.speichern()
        WidgetCenter.shared.reloadAllTimelines()
    }

    /// Fahrt ohne Fahrer zuweisen. Das iPhone speichert wie der Fahrt-Editor und schickt den neuen Stand.
    func zuweisen(_ fahrt: DispoUhrFahrt, _ fahrer: DispoUhrFahrer) {
        blatt = nil
        #if DEBUG
        if ProcessInfo.processInfo.arguments.contains("-uhrBeispiel") {
            zuweisung[fahrt.id] = .fertig(fahrer.name)
            return
        }
        #endif
        guard WCSession.default.isReachable else {
            meldung = "iPhone nicht erreichbar. TRISAR Dispo auf dem iPhone öffnen."
            return
        }
        zuweisung[fahrt.id] = .sendet(fahrer.name)
        WCSession.default.sendMessage([DispoUhrAktion.art: DispoUhrAktion.fahrerZuweisen, "fahrt": fahrt.id, "fahrer": fahrer.id],
                                      replyHandler: { antwort in
            let ok = antwort["ok"] as? Bool ?? false
            let fehler = antwort["fehler"] as? String ?? "Zuweisen fehlgeschlagen"
            Task { @MainActor in self.zuweisung[fahrt.id] = ok ? .fertig(fahrer.name) : .fehler(fehler) }
        }, errorHandler: { fehler in
            let text = fehler.localizedDescription
            Task { @MainActor in self.zuweisung[fahrt.id] = .fehler(text) }
        })
    }

    func kiFragen(_ text: String) {
        let frage = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !frage.isEmpty, !kiDenkt else { return }
        guard WCSession.default.isReachable else {
            meldung = "iPhone nicht erreichbar. TRISAR Dispo auf dem iPhone öffnen."
            return
        }
        let verlauf = kiNachrichten.suffix(8).map { [$0.vonMir ? "user" : "assistant", $0.text] }
        kiNachrichten.append(KiNachricht(vonMir: true, text: frage))
        kiDenkt = true
        let daten = (try? JSONEncoder().encode(verlauf)) ?? Data()
        // Jede Frage bekommt eine ID. Die Antwort kommt direkt (replyHandler) oder, wenn die Uhr beim Warten
        // eingeschlafen ist, ueber transferUserInfo (kiAntwortErhalten). Die erste gewinnt.
        let id = UUID().uuidString
        wartendeFragen.insert(id)
        WCSession.default.sendMessage([DispoUhrAktion.art: DispoUhrAktion.kiFrage, "frage": frage, "verlauf": daten, "frageID": id],
                                      replyHandler: { antwort in
            Task { @MainActor in self.kiAntwortUebernehmen(antwort, id: id) }
        }, errorHandler: { fehler in
            let text = fehler.localizedDescription
            Task { @MainActor in
                // Die ID bleibt wartend: kommt die Antwort spaeter ueber transferUserInfo, wird sie noch angezeigt.
                guard self.wartendeFragen.contains(id) else { return }
                self.kiDenkt = false
                self.kiNachrichten.append(KiNachricht(vonMir: false, text: "Keine Verbindung zum iPhone: \(text)"))
            }
        })
    }

    /// Antwort des iPhones uebernehmen, nur einmal je Frage (direkt oder ueber den Abgleich).
    func kiAntwortUebernehmen(_ antwort: [String: Any], id: String) {
        guard wartendeFragen.remove(id) != nil else { return }
        let text = antwort["text"] as? String ?? "Keine Antwort."
        let buchung = antwort["buchung"] as? Data
        let dienst = antwort["dienst"] as? Data ?? buchung
        let knopf = antwort["knopf"] as? String
        let telefonID = antwort["nachricht"] as? String
        kiDenkt = false
        kiNachrichten.append(KiNachricht(vonMir: false, text: text, dienst: dienst, knopf: knopf,
                                         buchung: buchung != nil, telefonID: telefonID))
    }

    func dienstSenden(_ nachricht: KiNachricht) {
        guard let dienst = nachricht.dienst, let i = kiNachrichten.firstIndex(where: { $0.id == nachricht.id }) else { return }
        kiNachrichten[i].status = .sendet
        var botschaft: [String: Any] = kiNachrichten[i].buchung
            ? [DispoUhrAktion.art: DispoUhrAktion.buchen, "buchung": dienst]
            : [DispoUhrAktion.art: DispoUhrAktion.dienstSenden, "dienst": dienst]
        if let id = kiNachrichten[i].telefonID { botschaft["nachricht"] = id }
        WCSession.default.sendMessage(botschaft, replyHandler: { antwort in
            let ok = antwort["ok"] as? Bool ?? false
            let anzahl = antwort["anzahl"] as? Int ?? 0
            let fehler = antwort["fehler"] as? String
            Task { @MainActor in self.dienstErgebnis(nachricht.id, ok: ok, anzahl: anzahl, fehler: fehler) }
        }, errorHandler: { fehler in
            let text = fehler.localizedDescription
            Task { @MainActor in self.dienstErgebnis(nachricht.id, ok: false, anzahl: 0, fehler: text) }
        })
    }

    func dienstVerwerfen(_ nachricht: KiNachricht) {
        guard let i = kiNachrichten.firstIndex(where: { $0.id == nachricht.id }) else { return }
        kiNachrichten[i].status = .verworfen
        // Auch im Verlauf am iPhone als „Nicht gesendet“ markieren.
        if let id = nachricht.telefonID, WCSession.default.isReachable {
            WCSession.default.sendMessage([DispoUhrAktion.art: DispoUhrAktion.vorschlagVerwerfen, "nachricht": id],
                                          replyHandler: { _ in }, errorHandler: { _ in })
        }
    }

    private func dienstErgebnis(_ id: UUID, ok: Bool, anzahl: Int, fehler: String?) {
        guard let i = kiNachrichten.firstIndex(where: { $0.id == id }) else { return }
        if ok && kiNachrichten[i].buchung {
            kiNachrichten[i].status = .gesendet(kiNachrichten[i].knopf == "Ändern" ? "Fahrt geändert." : "Fahrt gebucht.")
        } else if ok {
            let was = (kiNachrichten[i].knopf ?? "Dienst senden").replacingOccurrences(of: " senden", with: "")
            kiNachrichten[i].status = .gesendet("\(was) an \(anzahl) Fahrer gesendet.")
        } else {
            kiNachrichten[i].status = .fehler(fehler ?? "Senden fehlgeschlagen")
        }
    }

    func neuLaden() {
        guard WCSession.default.isReachable else {
            meldung = "iPhone nicht erreichbar. TRISAR Dispo auf dem iPhone öffnen."
            return
        }
        laedt = true
        WCSession.default.sendMessage([DispoUhrAktion.art: DispoUhrAktion.neuLaden], replyHandler: { _ in
            Task { @MainActor in self.laedt = false }
        }, errorHandler: { fehler in
            let text = fehler.localizedDescription
            Task { @MainActor in
                self.laedt = false
                self.meldung = text
            }
        })
    }
}

extension DispoUhrVerbindung: WCSessionDelegate {
    nonisolated func session(_ session: WCSession, activationDidCompleteWith state: WCSessionActivationState, error: Error?) {
        if let neu = DispoUhrStand.aus(session.receivedApplicationContext) {
            Task { @MainActor in self.uebernehmen(neu) }
        }
    }

    nonisolated func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String: Any]) {
        if let neu = DispoUhrStand.aus(applicationContext) {
            Task { @MainActor in self.uebernehmen(neu) }
        }
    }

    /// KI-Antwort auf zweitem Weg (transferUserInfo), kommt auch nach dem Aufwachen an.
    nonisolated func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any]) {
        guard userInfo["kiAntwort"] as? Bool == true, let id = userInfo["frageID"] as? String else { return }
        let antwort = userInfo
        Task { @MainActor in self.kiAntwortUebernehmen(antwort, id: id) }
    }
}

#if DEBUG
extension DispoUhrVerbindung {
    static var kiBeispiel: [KiNachricht] {
        [KiNachricht(vonMir: true, text: "Schick Stefano in Feierabend"),
         KiNachricht(vonMir: false, text: "Stefano Spandri hat heute schon Dienst (ab 08:00, angenommen). 04:00 als Dienstende? Ich ändere dann den vorhandenen Dienst.",
                     dienst: Data(), knopf: "Dienstende senden")]
    }

    /// -uhrZeige anrufen | zuweisen | komplikation
    static func beispielBlatt(_ stand: DispoUhrStand) -> DispoUhrBlatt? {
        let args = ProcessInfo.processInfo.arguments
        guard let i = args.firstIndex(of: "-uhrZeige"), i + 1 < args.count else { return nil }
        switch args[i + 1] {
        case "anrufen": return stand.fahrer.first { $0.telefon != nil }.map { .fahrer($0) }
        case "zuweisen": return stand.fahrten.first { $0.ohneFahrer }.map { .zuweisen($0) }
        case "komplikation": return .komplikation
        default: return nil
        }
    }

    static var beispiel: DispoUhrStand {
        let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"
        let heute = f.string(from: Date())
        let fahrer: [DispoUhrFahrer] = [
            DispoUhrFahrer(id: "a", name: "Stefano Spandri", nummer: "7", zustand: "aktiv", ohneSignal: false, signalStufe: 0, kennzeichen: "M-TR 7", fahrtVon: "Bayerischer Hof", fahrtNach: "Flughafen T2", lat: 48.14, lng: 11.578, telefon: "+49 151 23456789",
                            fahrzeug: "Mercedes V-Klasse", signalText: "Letztes Signal 14:52", abfahrt: "14:30", ankunft: "15:10",
                            fahrMinuten: 18, unterwegs: true, vonTyp: "Hotel", nachTyp: "Flughafen", vonName: "Bayerischer Hof",
                            nachName: "Flughafen T2", dienststart: "08:00", dienstende: "18:00"),
            DispoUhrFahrer(id: "b", name: "Anna Berg", nummer: "12", zustand: "aktiv", ohneSignal: false, signalStufe: 1, kennzeichen: "M-TR 12", fahrtVon: "Messe", fahrtNach: "Hauptbahnhof", lat: 48.133, lng: 11.693, telefon: "+49 160 9876543",
                            fahrzeug: "BMW 7er", signalText: "Letztes Signal 14:51", abfahrt: "14:40", ankunft: "15:05",
                            fahrMinuten: 12, unterwegs: true, vonTyp: "Messe", nachTyp: "Bahnhof", vonName: "Messe München",
                            nachName: "Hauptbahnhof", dienststart: "10:00", dienstende: "20:00"),
            DispoUhrFahrer(id: "c", name: "Julius Klein", nummer: "3", zustand: "inaktiv", ohneSignal: false, signalStufe: 0, kennzeichen: "M-TR 3", fahrtVon: nil, fahrtNach: nil, lat: 48.158, lng: 11.56, telefon: "+49 171 5550123", flagge: "flagge1"),
            DispoUhrFahrer(id: "d", name: "Ralph Moser", nummer: "9", zustand: "frei", ohneSignal: true, signalStufe: 5, kennzeichen: "M-TR 9", fahrtVon: nil, fahrtNach: nil, lat: 48.11, lng: 11.6),
            DispoUhrFahrer(id: "e", name: "Conrad Weiß", nummer: "4", zustand: "frei", ohneSignal: false, signalStufe: 0, kennzeichen: "M-TR 4", fahrtVon: nil, fahrtNach: nil, lat: 48.172, lng: 11.62, telefon: "+49 176 4440987", flagge: "flagge2"),
        ]
        let fahrten: [DispoUhrFahrt] = [
            DispoUhrFahrt(id: "1", tag: heute, zeit: "14:30", von: "Bayerischer Hof", nach: "Flughafen T2", fahrer: "Stefano Spandri", gast: "K. Vogel", status: "beim Gast", ohneFahrer: false, verspaetet: false, ankunft: "15:10", statusText: "Beim Gast"),
            DispoUhrFahrt(id: "2", tag: heute, zeit: "16:00", von: "Messe München", nach: "Mandarin Oriental", fahrer: "", gast: "Dr. Huber", status: "offen", ohneFahrer: true, verspaetet: false, ankunft: "16:40", statusText: "Offen"),
            DispoUhrFahrt(id: "4", tag: heute, zeit: "17:15", von: "Hauptbahnhof", nach: "Hotel Vier Jahreszeiten", fahrer: "", gast: "S. Roth", status: "offen", ohneFahrer: true, verspaetet: false, ankunft: "17:40", statusText: "Offen"),
            DispoUhrFahrt(id: "3", tag: heute, zeit: "18:45", von: "Flughafen T1", nach: "Rosewood", fahrer: "Anna Berg", gast: "M. Lee", status: "offen", ohneFahrer: false, verspaetet: true, ankunft: "19:25", statusText: "Unterwegs"),
        ]
        return DispoUhrStand(angemeldet: true, fahrer: fahrer, fahrten: fahrten, stand: Date())
    }
}
#endif

struct KiNachricht: Identifiable {
    enum Status: Equatable { case offen, sendet, gesendet(String), fehler(String), verworfen }
    let id = UUID()
    let vonMir: Bool
    let text: String
    var dienst: Data? = nil
    var knopf: String? = nil
    var buchung = false
    /// ID derselben Nachricht im Verlauf des KI-Assistenten am iPhone.
    var telefonID: String? = nil
    var status: Status = .offen
}

/// Blaetter ueber den Seiten.
enum DispoUhrBlatt: Identifiable {
    case fahrer(DispoUhrFahrer)
    case zuweisen(DispoUhrFahrt)
    case komplikation

    var id: String {
        switch self {
        case .fahrer(let f): return "fahrer-\(f.id)"
        case .zuweisen(let f): return "zuweisen-\(f.id)"
        case .komplikation: return "komplikation"
        }
    }
}

// MARK: - Ansichten

enum DispoZustand {
    static func farbe(_ zustand: String) -> Color {
        switch zustand {
        case "aktiv": return UhrFarbe.rot
        case "inaktiv": return UhrFarbe.lime
        default: return UhrFarbe.gruen
        }
    }

    static func name(_ zustand: String) -> String {
        switch zustand {
        case "aktiv": return "Aktiv"
        case "inaktiv": return "Inaktiv"
        default: return "Frei"
        }
    }
}

struct DispoUhrHaupt: View {
    @EnvironmentObject private var verbindung: DispoUhrVerbindung
    /// Simulator: -uhrSeite uebersicht | fahrten | karte | fahrer | ki oeffnet gleich die Seite.
    @State private var seite: String = {
        let args = ProcessInfo.processInfo.arguments
        guard let i = args.firstIndex(of: "-uhrSeite"), i + 1 < args.count else { return "uebersicht" }
        return args[i + 1]
    }()

    var body: some View {
        Group {
            if !verbindung.stand.angemeldet {
                VStack(spacing: 10) {
                    Image("TrisarLogo").resizable().scaledToFit().frame(width: 90)
                    Text("Öffne TRISAR Dispo auf dem iPhone und melde dich an.")
                        .font(.grotesk(14, .medium))
                        .foregroundStyle(.white.opacity(0.85))
                        .multilineTextAlignment(.center)
                }
                .padding()
            } else {
                TabView(selection: $seite) {
                    UebersichtSeite().tag("uebersicht")
                    DispoFahrtenSeite().tag("fahrten")
                    KartenSeite().tag("karte")
                    FahrerSeite().tag("fahrer")
                    KiSeite().tag("ki")
                }
                .tabViewStyle(.verticalPage)
                // Voice-Modus oberhalb der Seiten, damit ein Neuaufbau der KI-Seite ihn nicht schliesst.
                .sheet(isPresented: $verbindung.sprachModus) {
                    UhrSprachModus(vorschau: KiSeite.sprachVorschau)
                        .environmentObject(verbindung)
                }
            }
        }
        .background(UhrHintergrund(art: .dispo))
        .sheet(item: $verbindung.blatt) { blatt in
            Group {
                switch blatt {
                case .fahrer(let f): FahrerBlatt(fahrer: f)
                case .zuweisen(let f): ZuweisenBlatt(fahrt: f)
                case .komplikation: KomplikationVorschau()
                }
            }
            .environmentObject(verbindung)
        }
        .alert("TRISAR", isPresented: Binding(get: { verbindung.meldung != nil }, set: { if !$0 { verbindung.meldung = nil } })) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(verbindung.meldung ?? "")
        }
    }
}

struct UebersichtSeite: View {
    @EnvironmentObject private var verbindung: DispoUhrVerbindung

    private func anzahl(_ zustand: String) -> Int {
        verbindung.stand.fahrer.filter { $0.zustand == zustand }.count
    }

    private var heuteOhneFahrer: Int { verbindung.stand.ohneFahrerHeute }

    static func heute() -> String {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        return f.string(from: Date())
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 8) {
                Text("Übersicht")
                    .font(.grotesk(13, .bold))
                    .foregroundStyle(UhrFarbe.lime)
                HStack(spacing: 6) {
                    ForEach(["aktiv", "inaktiv", "frei"], id: \.self) { z in
                        VStack(spacing: 2) {
                            Text("\(anzahl(z))")
                                .font(.grotesk(26, .bold))
                                .foregroundStyle(DispoZustand.farbe(z))
                                .monospacedDigit()
                            Text(DispoZustand.name(z))
                                .font(.grotesk(11, .bold))
                                .foregroundStyle(.white.opacity(0.8))
                        }
                        .frame(maxWidth: .infinity, minHeight: 58)
                        .background(RoundedRectangle(cornerRadius: 12).fill(UhrFarbe.kachel))
                    }
                }
                let ohneSignal = verbindung.stand.fahrer.filter(\.ohneSignal).count
                Kachel(rand: heuteOhneFahrer > 0 ? UhrFarbe.rot : nil) {
                    VStack(alignment: .leading, spacing: 4) {
                        HStack {
                            Text("Ohne Fahrer heute")
                                .font(.grotesk(13, .medium))
                                .foregroundStyle(.white)
                            Spacer()
                            Text("\(heuteOhneFahrer)")
                                .font(.grotesk(18, .bold))
                                .foregroundStyle(heuteOhneFahrer > 0 ? UhrFarbe.rot : UhrFarbe.gruen)
                        }
                        HStack {
                            Text("Kein Signal")
                                .font(.grotesk(13, .medium))
                                .foregroundStyle(.white)
                            Spacer()
                            Text("\(ohneSignal)")
                                .font(.grotesk(18, .bold))
                                .foregroundStyle(ohneSignal > 0 ? UhrFarbe.grau : UhrFarbe.gruen)
                        }
                    }
                }
                Button {
                    verbindung.neuLaden()
                } label: {
                    Text(verbindung.laedt ? "Lädt …" : "Neu laden")
                        .font(.grotesk(13, .bold))
                        .foregroundStyle(UhrFarbe.lime)
                        .frame(maxWidth: .infinity, minHeight: 32)
                }
                .buttonStyle(.plain)
                Text("Stand \(verbindung.stand.stand.formatted(date: .omitted, time: .shortened))")
                    .font(.grotesk(10, .medium))
                    .foregroundStyle(.white.opacity(0.4))
                    .frame(maxWidth: .infinity)
            }
            .padding(.horizontal, 4)
        }
    }
}

struct FahrerSeite: View {
    @EnvironmentObject private var verbindung: DispoUhrVerbindung

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 4) {
                    Text("Fahrer")
                        .font(.grotesk(13, .bold))
                        .foregroundStyle(UhrFarbe.lime)
                    Spacer(minLength: 0)
                    UhrFlaggenFilter()
                }
                let liste = verbindung.stand.fahrer.filter(verbindung.passtZuFlaggen)
                if liste.isEmpty {
                    Kachel { Text("Keine Fahrer").font(.grotesk(15, .bold)).foregroundStyle(.white.opacity(0.7)) }
                }
                ForEach(liste) { f in
                    Button { verbindung.blatt = .fahrer(f) } label: {
                    Kachel {
                        VStack(alignment: .leading, spacing: 2) {
                            HStack(spacing: 6) {
                                Circle()
                                    .fill(f.ohneSignal ? UhrFarbe.grau : DispoZustand.farbe(f.zustand))
                                    .frame(width: 10, height: 10)
                                Text(f.nummer.map { "\($0)  \(f.name)" } ?? f.name)
                                    .font(.grotesk(14, .bold))
                                    .foregroundStyle(.white)
                                    .lineLimit(1)
                                Spacer(minLength: 0)
                                if let fl = f.flagge { UhrFlagge(flagge: fl, breite: 9, hoehe: 11.5) }
                                if f.telefon != nil {
                                    Image(systemName: "phone.fill")
                                        .font(.system(size: 11))
                                        .foregroundStyle(UhrFarbe.lime)
                                }
                            }
                            Text(f.ohneSignal ? "Kein Signal" : DispoZustand.name(f.zustand))
                                .font(.grotesk(11, .bold))
                                .foregroundStyle(f.ohneSignal ? UhrFarbe.grau : DispoZustand.farbe(f.zustand))
                            if let von = f.fahrtVon, let nach = f.fahrtNach, !von.isEmpty || !nach.isEmpty {
                                Text("\(von) → \(nach)")
                                    .font(.grotesk(11, .medium))
                                    .foregroundStyle(.white.opacity(0.7))
                                    .lineLimit(2)
                            }
                        }
                    }
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 4)
        }
    }
}

struct DispoFahrtenSeite: View {
    @EnvironmentObject private var verbindung: DispoUhrVerbindung

    static func statusFarbe(_ status: String) -> Color {
        switch status {
        case "Unterwegs": return UhrFarbe.gruen
        case "Beim Gast": return UhrFarbe.lime
        default: return .white.opacity(0.6)
        }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 6) {
                Text("Fahrten")
                    .font(.grotesk(13, .bold))
                    .foregroundStyle(UhrFarbe.lime)
                if verbindung.stand.fahrten.isEmpty {
                    Kachel { Text("Keine Fahrten").font(.grotesk(15, .bold)).foregroundStyle(.white.opacity(0.7)) }
                }
                ForEach(verbindung.stand.fahrten) { f in
                    Kachel(rand: f.ohneFahrer ? UhrFarbe.rot : (f.verspaetet ? UhrFarbe.orange : nil)) {
                        VStack(alignment: .leading, spacing: 2) {
                            HStack {
                                Text(f.zeit)
                                    .font(.grotesk(18, .bold))
                                    .foregroundStyle(UhrFarbe.lime)
                                    .monospacedDigit()
                                Spacer()
                                Text(UhrText.tag(f.tag))
                                    .font(.grotesk(11, .medium))
                                    .foregroundStyle(.white.opacity(0.5))
                            }
                            Text("\(f.von) → \(f.nach)")
                                .font(.grotesk(13, .medium))
                                .foregroundStyle(.white)
                                .lineLimit(2)
                            if let status = f.statusText, status != "Offen" {
                                HStack(spacing: 5) {
                                    Circle().fill(Self.statusFarbe(status)).frame(width: 7, height: 7)
                                    Text(status)
                                        .font(.grotesk(12, .bold))
                                        .foregroundStyle(Self.statusFarbe(status))
                                }
                            }
                            if let ankunft = f.ankunft {
                                Text("Ankunft \(ankunft)")
                                    .font(.grotesk(12, .bold))
                                    .foregroundStyle(f.verspaetet ? UhrFarbe.orange : .white.opacity(0.85))
                                    .monospacedDigit()
                            }
                            Text(f.ohneFahrer ? "Fahrer fehlt" : f.fahrer)
                                .font(.grotesk(11, .bold))
                                .foregroundStyle(f.ohneFahrer ? UhrFarbe.rot : .white.opacity(0.7))
                                .lineLimit(1)
                            if f.ohneFahrer { ZuweisenZeile(fahrt: f) }
                        }
                    }
                }
            }
            .padding(.horizontal, 4)
        }
    }
}

/// KI-Assistent auf der Uhr: Frage diktieren oder tippen, Antwort vom Server ueber das iPhone.
/// Dienst-Vorschlaege (Feierabend, Dienststart, Pause) lassen sich hier senden, Buchungen nur am iPhone.
/// Kleine Kugel oben rechts oeffnet den Voice-Modus (UhrSprachModus.swift).
struct KiSeite: View {
    @EnvironmentObject private var verbindung: DispoUhrVerbindung
    @State private var eingabe = ""
    /// Voice-Modus (UhrSprachModus). Simulator: -uhrSprache bereit | denkt | spricht oeffnet ihn gleich.
    static var sprachVorschau: String? {
        #if DEBUG
        let args = ProcessInfo.processInfo.arguments
        if let i = args.firstIndex(of: "-uhrSprache"), i + 1 < args.count { return args[i + 1] }
        #endif
        return nil
    }

    var body: some View {
        ScrollViewReader { leser in
            ScrollView {
                VStack(alignment: .leading, spacing: 6) {
                    HStack(spacing: 4) {
                        Image(systemName: "sparkles").font(.system(size: 11)).foregroundStyle(UhrFarbe.lime)
                        Text("KI-Assistent")
                            .font(.grotesk(13, .bold))
                            .foregroundStyle(UhrFarbe.lime)
                        Spacer(minLength: 0)
                        UhrSprachEinstieg { verbindung.sprachModus = true }
                    }
                    if verbindung.kiNachrichten.isEmpty {
                        Text("Frag z. B. „Schick Stefano in Feierabend“ oder „Welche Fahrten haben noch keinen Fahrer?“")
                            .font(.grotesk(12, .medium))
                            .foregroundStyle(.white.opacity(0.6))
                    }
                    ForEach(verbindung.kiNachrichten) { n in
                        if n.vonMir {
                            Text(n.text)
                                .font(.grotesk(13, .medium))
                                .foregroundStyle(.black)
                                .padding(8)
                                .frame(maxWidth: .infinity, alignment: .trailing)
                                .background(RoundedRectangle(cornerRadius: 12).fill(UhrFarbe.lime))
                        } else {
                            VStack(alignment: .leading, spacing: 6) {
                                Text(n.text)
                                    .font(.grotesk(13))
                                    .foregroundStyle(.white)
                                if n.dienst != nil {
                                    switch n.status {
                                    case .offen:
                                        Button { verbindung.dienstSenden(n) } label: {
                                            Text(n.knopf ?? "Dienst senden")
                                                .font(.grotesk(14, .bold))
                                                .foregroundStyle(Color(red: 32 / 255, green: 32 / 255, blue: 32 / 255))
                                                .frame(maxWidth: .infinity, minHeight: 34)
                                                .background(RoundedRectangle(cornerRadius: 12).fill(n.buchung ? UhrFarbe.lime : UhrFarbe.gruen))
                                        }
                                        .buttonStyle(.plain)
                                        RotKnopf(text: "Nein") { verbindung.dienstVerwerfen(n) }
                                    case .sendet:
                                        Text("Wird gesendet …").font(.grotesk(11, .bold)).foregroundStyle(UhrFarbe.lime)
                                    case .gesendet(let text):
                                        Text(text).font(.grotesk(11, .bold)).foregroundStyle(UhrFarbe.gruen)
                                    case .fehler(let text):
                                        Text(text).font(.grotesk(11, .bold)).foregroundStyle(UhrFarbe.rot)
                                        Button { verbindung.dienstSenden(n) } label: {
                                            Text("Nochmal").font(.grotesk(12, .bold)).foregroundStyle(UhrFarbe.lime)
                                        }
                                        .buttonStyle(.plain)
                                    case .verworfen:
                                        Text("Nicht gesendet.").font(.grotesk(11, .bold)).foregroundStyle(.white.opacity(0.6))
                                    }
                                }
                            }
                            .padding(8)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(RoundedRectangle(cornerRadius: 12).fill(UhrFarbe.kachel))
                            .overlay(RoundedRectangle(cornerRadius: 12).stroke(UhrFarbe.rand, lineWidth: 1))
                        }
                    }
                    if verbindung.kiDenkt {
                        Image(systemName: "sparkles")
                            .foregroundStyle(UhrFarbe.lime)
                            .symbolEffect(.pulse)
                    }
                    // Eingabe: Antippen oeffnet Diktat, Kritzeln oder Tastatur der Uhr.
                    TextField("Frage …", text: $eingabe)
                        .font(.grotesk(14, .medium))
                        .foregroundStyle(.white)
                        .submitLabel(.send)
                        .onSubmit {
                            verbindung.kiFragen(eingabe)
                            eingabe = ""
                        }
                        .disabled(verbindung.kiDenkt)
                        .id("eingabe")
                }
                .padding(.horizontal, 4)
            }
            .onChange(of: verbindung.kiNachrichten.count) { _, _ in
                withAnimation { leser.scrollTo("eingabe", anchor: .bottom) }
            }
        }
    }
}

/// Karte wie in der Dispo: Fahrer als farbige Punkte mit Nummer (Aktiv rot, Inaktiv Lime,
/// Frei gruen, ohne Signal grau). Ausschnitt passt sich an alle Fahrer an.
/// Punkt antippen oeffnet das Fahrer-Blatt wie auf der iPhone-Karte. Zoomen mit + und −
/// oder Doppeltipp (Pinch gibt es auf der Uhr nicht), die Krone blaettert weiter die Seiten.
struct KartenSeite: View {
    @EnvironmentObject private var verbindung: DispoUhrVerbindung
    @State private var kamera: MapCameraPosition = .automatic
    @State private var ausschnitt: MKCoordinateRegion?

    private var mitOrt: [DispoUhrFahrer] {
        verbindung.stand.fahrer.filter { $0.lat != nil && $0.lng != nil && verbindung.passtZuFlaggen($0) }
    }

    var body: some View {
        ZStack(alignment: .topLeading) {
            if mitOrt.isEmpty {
                VStack(spacing: 6) {
                    Text("Karte")
                        .font(.grotesk(13, .bold))
                        .foregroundStyle(UhrFarbe.lime)
                    Text("Noch keine Standorte")
                        .font(.grotesk(13, .medium))
                        .foregroundStyle(.white.opacity(0.6))
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                Map(position: $kamera, interactionModes: [.pan]) {
                    ForEach(mitOrt) { f in
                        Annotation(f.name, coordinate: CLLocationCoordinate2D(latitude: f.lat!, longitude: f.lng!), anchor: .center) {
                            Text(f.nummer ?? String(f.name.prefix(1)))
                                .font(.grotesk(11, .bold))
                                .foregroundStyle(.black)
                                .frame(minWidth: 22, minHeight: 22)
                                .background(Circle().fill(f.ohneSignal ? UhrFarbe.grau : DispoZustand.farbe(f.zustand)))
                                .overlay(Circle().stroke(.black, lineWidth: 1.5))
                                // Flagge wie am iPhone-Marker: oben rechts aufgesteckt.
                                .overlay(alignment: .topTrailing) {
                                    if let fl = f.flagge { UhrFlagge(flagge: fl, breite: 8, hoehe: 10.3).offset(x: 4, y: -4) }
                                }
                                // Groessere Trefferflaeche fuer den Finger.
                                .padding(6)
                                .contentShape(Circle())
                                .onTapGesture { verbindung.blatt = .fahrer(f) }
                                .accessibilityAddTraits(.isButton)
                                .accessibilityLabel(f.name)
                        }
                        .annotationTitles(.hidden)
                    }
                }
                .mapStyle(.standard(emphasis: .muted, pointsOfInterest: .excludingAll))
                .onMapCameraChange(frequency: .onEnd) { ausschnitt = $0.region }
                .onTapGesture(count: 2) { zoomen(0.5) }
                .ignoresSafeArea()
                Text("Karte")
                    .font(.grotesk(13, .bold))
                    .foregroundStyle(UhrFarbe.lime)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 3)
                    .background(Capsule().fill(.black.opacity(0.7)))
                    .padding(.leading, 4)
                VStack(spacing: 6) {
                    UhrFlaggenFilter(senkrecht: true)
                    zoomKnopf("plus") { zoomen(0.5) }
                    zoomKnopf("minus") { zoomen(2) }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .trailing)
                .padding(.trailing, 2)
            }
        }
    }

    private func zoomKnopf(_ symbol: String, aktion: @escaping () -> Void) -> some View {
        Button(action: aktion) {
            Image(systemName: symbol)
                .font(.system(size: 14, weight: .bold))
                .foregroundStyle(UhrFarbe.lime)
                .frame(width: 30, height: 30)
                .background(Circle().fill(.black.opacity(0.75)))
                .overlay(Circle().stroke(UhrFarbe.rand, lineWidth: 1))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(symbol == "plus" ? "Hineinzoomen" : "Herauszoomen")
    }

    /// Faktor < 1 zoomt hinein, > 1 heraus. Mitte bleibt, Grenzen wie in Karten.
    private func zoomen(_ faktor: Double) {
        guard let r = ausschnitt ?? startAusschnitt else { return }
        let lat = min(max(r.span.latitudeDelta * faktor, 0.002), 60)
        let lng = min(max(r.span.longitudeDelta * faktor, 0.002), 60)
        let neu = MKCoordinateRegion(center: r.center, span: MKCoordinateSpan(latitudeDelta: lat, longitudeDelta: lng))
        withAnimation(.easeInOut(duration: 0.25)) { kamera = .region(neu) }
        ausschnitt = neu
    }

    /// Bevor die Karte ihren Ausschnitt meldet: Rahmen um alle Fahrer.
    private var startAusschnitt: MKCoordinateRegion? {
        let lats = mitOrt.compactMap(\.lat), lngs = mitOrt.compactMap(\.lng)
        guard let a = lats.min(), let b = lats.max(), let c = lngs.min(), let d = lngs.max() else { return nil }
        return MKCoordinateRegion(center: CLLocationCoordinate2D(latitude: (a + b) / 2, longitude: (c + d) / 2),
                                  span: MKCoordinateSpan(latitudeDelta: max(b - a, 0.01) * 1.4, longitudeDelta: max(d - c, 0.01) * 1.4))
    }
}

// MARK: - Fahrer anrufen, Fahrer zuweisen, Komplikation

/// Status der Zuweisung oder Knopf „Fahrer zuweisen“ in der Fahrtkachel.
struct ZuweisenZeile: View {
    @EnvironmentObject private var verbindung: DispoUhrVerbindung
    let fahrt: DispoUhrFahrt

    var body: some View {
        switch verbindung.zuweisung[fahrt.id] {
        case .sendet(let name)?:
            Text("\(name) wird zugewiesen …")
                .font(.grotesk(11, .bold))
                .foregroundStyle(UhrFarbe.lime)
        case .fertig(let name)?:
            Text("\(name) zugewiesen")
                .font(.grotesk(11, .bold))
                .foregroundStyle(UhrFarbe.gruen)
        case .fehler(let text)?:
            Text(text)
                .font(.grotesk(11, .bold))
                .foregroundStyle(UhrFarbe.rot)
            LimeKnopf(text: "Nochmal") { verbindung.blatt = .zuweisen(fahrt) }
        case nil:
            LimeKnopf(text: "Fahrer zuweisen") { verbindung.blatt = .zuweisen(fahrt) }
                .padding(.top, 4)
        }
    }
}

/// Fahrer antippen (Liste oder Karte): aufgebaut wie das Fahrer-Blatt der iPhone-Karte.
/// Kennzeichen, Name mit Telefon, letztes Signal, naechste Fahrt (ETD/ETA, von/nach), Dienstzeiten.
struct FahrerBlatt: View {
    @Environment(\.openURL) private var openURL
    let fahrer: DispoUhrFahrer

    private static let dunkel = Color(red: 29 / 255, green: 28 / 255, blue: 29 / 255) // #1D1C1D

    private var telURL: URL? {
        guard let t = fahrer.telefon else { return nil }
        let nummer = t.filter { $0.isNumber || $0 == "+" }
        return nummer.isEmpty ? nil : URL(string: "tel:\(nummer)")
    }

    private var zustandFarbe: Color { fahrer.ohneSignal ? UhrFarbe.grau : DispoZustand.farbe(fahrer.zustand) }

    /// Orte der naechsten Fahrt, sonst die alten Felder (aelterer Stand vom iPhone).
    private var von: String? { (fahrer.vonName ?? fahrer.fahrtVon).flatMap { $0.isEmpty || $0 == "-" ? nil : $0 } }
    private var nach: String? { (fahrer.nachName ?? fahrer.fahrtNach).flatMap { $0.isEmpty || $0 == "-" ? nil : $0 } }
    private var hatFahrt: Bool { von != nil && von != "Keine aktive Fahrt" }

    private var fahrText: String? {
        if let m = fahrer.fahrMinuten, m > 0 { return "\(m) min Fahrt" }
        if fahrer.unterwegs == true, let a = fahrer.ankunft, a != "--:--" { return "<1 min Fahrt" }
        return nil
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: 6) {
                    Circle().fill(zustandFarbe).frame(width: 10, height: 10)
                    Text(fahrer.ohneSignal ? "Kein Signal" : DispoZustand.name(fahrer.zustand))
                        .font(.grotesk(12, .bold))
                        .foregroundStyle(zustandFarbe)
                    Spacer(minLength: 0)
                    if let fl = fahrer.flagge { UhrFlagge(flagge: fl, breite: 9, hoehe: 11.5) }
                    if let n = fahrer.nummer {
                        Text("Nr. \(n)").font(.grotesk(11, .bold)).foregroundStyle(.white.opacity(0.6))
                    }
                }
                if fahrer.kennzeichen != "-" && !fahrer.kennzeichen.isEmpty {
                    VStack(spacing: 1) {
                        Text(fahrer.kennzeichen)
                            .font(.grotesk(16, .bold))
                            .foregroundStyle(Self.dunkel)
                        if let fz = fahrer.fahrzeug {
                            Text(fz).font(.grotesk(11, .bold)).foregroundStyle(Self.dunkel.opacity(0.4))
                        }
                    }
                    .lineLimit(1)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 5)
                    .background(Color.white)
                }
                Button { if let telURL { openURL(telURL) } } label: {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(fahrer.name)
                            .font(.grotesk(16, .bold))
                            .foregroundStyle(Self.dunkel)
                            .lineLimit(2)
                        if let t = fahrer.telefon {
                            Label(t, systemImage: "phone.fill")
                                .font(.grotesk(11, .bold))
                                .foregroundStyle(Self.dunkel)
                                .lineLimit(1)
                                .minimumScaleFactor(0.7)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 6)
                    .background(UhrFarbe.lime)
                }
                .buttonStyle(.plain)
                .disabled(telURL == nil)
                if let sig = fahrer.signalText {
                    Text(sig)
                        .font(.grotesk(12, .bold))
                        .foregroundStyle(fahrer.signalStufe > 0 ? UhrFarbe.orange : UhrFarbe.grau)
                }

                Text("Nächste Fahrt")
                    .font(.grotesk(14, .bold))
                    .foregroundStyle(UhrFarbe.lime)
                    .padding(.top, 2)
                if hatFahrt {
                    zeitPaar(("ETD", fahrer.abfahrt), ("ETA", fahrer.ankunft), unten: fahrText)
                    HStack(alignment: .top, spacing: 6) {
                        ortText(fahrer.vonTyp, von ?? "-", rechts: false)
                        Image(systemName: "arrow.right")
                            .font(.system(size: 11, weight: .bold))
                            .foregroundStyle(UhrFarbe.lime)
                            .padding(.top, 14)
                        ortText(fahrer.nachTyp, nach ?? "-", rechts: true)
                    }
                } else {
                    Text("Keine aktive Fahrt")
                        .font(.grotesk(12, .medium))
                        .foregroundStyle(.white.opacity(0.6))
                }
                if fahrer.dienststart != nil || fahrer.dienstende != nil {
                    zeitPaar(("Dienststart", fahrer.dienststart), ("Dienstende", fahrer.dienstende), unten: nil)
                        .padding(.top, 4)
                }
                if let url = telURL {
                    Button { openURL(url) } label: {
                        Label("Anrufen", systemImage: "phone.fill")
                            .font(.grotesk(15, .bold))
                            .foregroundStyle(.black)
                            .frame(maxWidth: .infinity, minHeight: 36)
                            .background(RoundedRectangle(cornerRadius: 12).fill(UhrFarbe.lime))
                    }
                    .buttonStyle(.plain)
                    .padding(.top, 4)
                } else {
                    Text("Keine Telefonnummer hinterlegt.")
                        .font(.grotesk(12, .medium))
                        .foregroundStyle(.white.opacity(0.6))
                }
            }
            .padding(.horizontal, 4)
        }
        .defaultScrollAnchor(.top)
        .background(UhrHintergrund(art: .dispo))
    }

    private func zeitPaar(_ links: (String, String?), _ rechts: (String, String?), unten: String?) -> some View {
        HStack(alignment: .top) {
            VStack(alignment: .leading, spacing: 1) {
                Text(links.0).font(.grotesk(10, .bold)).foregroundStyle(UhrFarbe.grau)
                Text(links.1 ?? "--:--").font(.grotesk(20, .bold)).foregroundStyle(UhrFarbe.lime).monospacedDigit()
            }
            Spacer(minLength: 4)
            VStack(alignment: .trailing, spacing: 1) {
                Text(rechts.0).font(.grotesk(10, .bold)).foregroundStyle(UhrFarbe.grau)
                Text(rechts.1 ?? "--:--").font(.grotesk(20, .bold)).foregroundStyle(UhrFarbe.lime).monospacedDigit()
                if let unten {
                    Text(unten).font(.grotesk(10, .bold)).foregroundStyle(.white.opacity(0.5))
                }
            }
        }
    }

    private func ortText(_ typ: String?, _ name: String, rechts: Bool) -> some View {
        VStack(alignment: rechts ? .trailing : .leading, spacing: 1) {
            if let typ, typ != "-" {
                Text(typ).font(.grotesk(10, .bold)).foregroundStyle(UhrFarbe.grau)
            }
            Text(name)
                .font(.grotesk(12, .bold))
                .foregroundStyle(.white)
                .multilineTextAlignment(rechts ? .trailing : .leading)
                .lineLimit(3)
        }
        .frame(maxWidth: .infinity, alignment: rechts ? .trailing : .leading)
    }
}

/// Fahrer fuer eine Fahrt ohne Fahrer waehlen: freie zuerst, dann inaktive, ohne Signal zuletzt.
struct ZuweisenBlatt: View {
    @EnvironmentObject private var verbindung: DispoUhrVerbindung
    let fahrt: DispoUhrFahrt

    private var auswahl: [DispoUhrFahrer] {
        verbindung.stand.fahrer
            .filter(\.verfuegbar)
            .sorted { a, b in
                let ra = (a.ohneSignal ? 2 : 0) + (a.zustand == "frei" ? 0 : 1)
                let rb = (b.ohneSignal ? 2 : 0) + (b.zustand == "frei" ? 0 : 1)
                return (ra, a.name) < (rb, b.name)
            }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 6) {
                Text("Fahrer zuweisen")
                    .font(.grotesk(13, .bold))
                    .foregroundStyle(UhrFarbe.lime)
                Text("\(fahrt.zeit)  \(fahrt.von) → \(fahrt.nach)")
                    .font(.grotesk(12, .medium))
                    .foregroundStyle(.white.opacity(0.8))
                    .lineLimit(2)
                if auswahl.isEmpty {
                    Kachel { Text("Kein freier Fahrer").font(.grotesk(14, .bold)).foregroundStyle(.white.opacity(0.7)) }
                }
                ForEach(auswahl) { f in
                    Button { verbindung.zuweisen(fahrt, f) } label: {
                        Kachel {
                            HStack(spacing: 6) {
                                Circle()
                                    .fill(f.ohneSignal ? UhrFarbe.grau : DispoZustand.farbe(f.zustand))
                                    .frame(width: 10, height: 10)
                                VStack(alignment: .leading, spacing: 1) {
                                    Text(f.nummer.map { "\($0)  \(f.name)" } ?? f.name)
                                        .font(.grotesk(14, .bold))
                                        .foregroundStyle(.white)
                                        .lineLimit(1)
                                    Text(f.ohneSignal ? "Kein Signal" : DispoZustand.name(f.zustand))
                                        .font(.grotesk(11, .bold))
                                        .foregroundStyle(f.ohneSignal ? UhrFarbe.grau : DispoZustand.farbe(f.zustand))
                                }
                            }
                        }
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 4)
        }
        .defaultScrollAnchor(.top)
        .background(UhrHintergrund(art: .dispo))
    }
}

/// Nur zum Ansehen im Simulator (-uhrZeige komplikation): die Komplikation in allen Groessen.
struct KomplikationVorschau: View {
    @EnvironmentObject private var verbindung: DispoUhrVerbindung

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 10) {
                Text("Komplikation")
                    .font(.grotesk(13, .bold))
                    .foregroundStyle(UhrFarbe.lime)
                DispoKomplikationAnsicht(zahlen: verbindung.stand.zahlen, familie: .accessoryRectangular)
                    .padding(8)
                    .background(RoundedRectangle(cornerRadius: 12).fill(UhrFarbe.kachel))
                HStack(spacing: 10) {
                    DispoKomplikationAnsicht(zahlen: verbindung.stand.zahlen, familie: .accessoryCircular)
                        .frame(width: 50, height: 50)
                        .clipShape(Circle())
                    Spacer()
                }
                DispoKomplikationAnsicht(zahlen: verbindung.stand.zahlen, familie: .accessoryInline)
                    .font(.grotesk(12, .medium))
                    .foregroundStyle(.white)
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
            }
            .padding(.horizontal, 4)
        }
        .defaultScrollAnchor(.top)
        .background(UhrHintergrund(art: .dispo))
    }
}


// MARK: - Flaggen (wie Karte und Alle Fahrer am iPhone)

/// Flagge mit duenner schwarzer Umrandung (schwarze Kopie knapp dahinter).
struct UhrFlagge: View {
    let flagge: String
    var breite: CGFloat = 10
    var hoehe: CGFloat = 13

    private var bild: String? {
        switch flagge {
        case "flagge1": return "Flagge_1_Voll"
        case "flagge2": return "Flagge_2_Voll"
        case "flagge3": return "Flagge_3_Voll"
        default: return nil
        }
    }

    var body: some View {
        if let bild {
            ZStack {
                Image(bild).renderingMode(.template).resizable().foregroundStyle(.black)
                    .frame(width: breite + 1.6, height: hoehe + 1.6)
                Image(bild).resizable().frame(width: breite, height: hoehe)
            }
            .frame(width: breite + 1.6, height: hoehe + 1.6)
        }
    }
}

/// Benutzte Flaggen als Filter (mehrere gleichzeitig), wie rechts unter der Statusleiste der iPhone-Karte.
/// Gilt fuer Karte und Fahrerliste der Uhr.
struct UhrFlaggenFilter: View {
    @EnvironmentObject private var verbindung: DispoUhrVerbindung
    var senkrecht = false

    var body: some View {
        let benutzt = ["flagge1", "flagge2", "flagge3"].filter { id in verbindung.stand.fahrer.contains { $0.flagge == id } }
        if !benutzt.isEmpty {
            let knoepfe = ForEach(benutzt, id: \.self) { id in
                let an = verbindung.flaggenFilter.contains(id)
                Button {
                    if an { verbindung.flaggenFilter.remove(id) } else { verbindung.flaggenFilter.insert(id) }
                } label: {
                    UhrFlagge(flagge: id, breite: 10, hoehe: 13)
                        .opacity(an || verbindung.flaggenFilter.isEmpty ? 1 : 0.45)
                        .frame(width: 26, height: 26)
                        .background(Circle().fill(an ? UhrFarbe.lime : .black.opacity(0.7)))
                        .overlay(Circle().stroke(.black, lineWidth: 1))
                }
                .buttonStyle(.plain)
                .accessibilityLabel(id == "flagge1" ? "Flagge Cyan" : id == "flagge2" ? "Flagge Pink" : "Flagge Königsblau")
                .accessibilityAddTraits(an ? .isSelected : [])
            }
            if senkrecht { VStack(spacing: 4) { knoepfe } } else { HStack(spacing: 4) { knoepfe } }
        }
    }
}
