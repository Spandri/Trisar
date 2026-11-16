import CoreLocation
import SwiftUI

/// Live-Karte der Dispo (KartenView.jsx, Live-Zweig): Fahrer mit Zustand und Zuendung, Schnellfilter
/// Aktiv/Inaktiv/Frei (lang auf Inaktiv = Inaktiv-Fenster), Fahrerblatt mit naechster Fahrt,
/// Fahrerprofil mit Fahrzeugdaten und der Karten-Filter (KartenFilterView.jsx).
struct DispoKarteAnsicht: View {
    let zeigen: (DispoZiel) -> Void

    @StateObject private var daten = KartenDaten()
    @State private var flaggenFehler = ""
    /// Auswahlmodus der Karte: beginnt bei jedem Oeffnen aus, auch wenn noch Fahrer markiert sind.
    @State private var kartenAuswahl = false
    /// Flagge als Filter (nur Fahrer mit dieser Flagge), ausserhalb der Auswahl.
    @State private var flaggenFilter: Set<String> = Set(FahrerMarkierung.geteilt.flaggen)
    /// Zaehler der Profil-Abfrage zum Flaggenfilter, damit nur die letzte Antwort zaehlt.
    @State private var flaggenAbfrage = 0
    @ObservedObject private var filter = KartenFilter.geteilt
    @ObservedObject private var ohneSignal = OhneSignalEinstellung.geteilt
    @State private var gewaehltID: String?
    @State private var schnellFilter: [FahrerZustand] = FahrerZustand.allCases
    @State private var blatt: CGFloat = Self.blattMin
    @State private var ziehtBlatt = false
    @State private var zeigeFenster = false
    @State private var fensterStunden: Double = 1
    @State private var route: KartenRoutenBild?
    @State private var fahrtMinuten: (id: String, minuten: Int?)?
    @State private var einpassen = 0
    @State private var filterOffen = false
    @State private var profilOffen = false
    @State private var abseitsZaehler = 0
    @State private var letzteNeuberechnung = Date.distantPast
    @ObservedObject private var orte = OrteSpeicher.geteilt
    @State private var gewaehlterOrt: UUID?
    /// Mehrfachauswahl (Kaestchen oben rechts) und ihr Erklaertext beim Einschalten.
    @ObservedObject private var markierung = FahrerMarkierung.geteilt
    @State private var erklaerungSichtbar = false
    /// Eigener Bereich (13.11.): mit dem Finger frei zeichnen, "Karte" zoomt dann darauf.
    @ObservedObject private var bereich = KartenBereich.geteilt
    /// Fahrer auf Dienstreise (14.11.): statt des Pins das Fahrzeug auf der Strecke.
    @ObservedObject private var dienstreisen = DispoDienstreiseSpeicher.gemeinsam
    @ObservedObject private var reiseLive = DispoReiseLive.gemeinsam
    @State private var reiseUhr = Date()
    private let reiseTakt = Timer.publish(every: 30, on: .main, in: .common).autoconnect()
    @State private var kartenZugang = KartenZugang()
    @State private var bereichZeichnen = false
    @State private var zugPfad: [CGPoint] = []
    @State private var zugLaeuft = false
    @State private var bereichFehler = ""

    // Masse im Web-Raster (NAV_BLOCK_OFFSET_PX, SHEET_MAX_TOP_GAP_PX, SHEET_PEEK_PX).
    static let blattUnten: CGFloat = 120
    /// Oberkante der Navileiste ueber dem unteren Rand: 79 (Abstand + Fussleiste) + 131 - 32.
    static let leisteOben: CGFloat = 178
    static let blattMin: CGFloat = max(34, (leisteOben - blattUnten) + 34)
    /// Blatt gerade so weit offen, dass der Name zu sehen ist (Telefon bleibt verdeckt):
    /// Rest-Griff 8 + Abstand im Namensblock 18 + Name 30, minus 2 gegen den Telefon-Streifen.
    static let blattName: CGFloat = blattMin + 8 + 18 + 30 - 2

    // MARK: Filterkette wie im Web

    private var suchBegriffe: [String] {
        filter.fahrerSuche.split(separator: ";").map { $0.trimmingCharacters(in: .whitespaces).lowercased() }.filter { !$0.isEmpty }
    }

    private var passendeFahrer: [KartenFahrer] {
        let ids = Set(filter.gewaehlteFahrerIDs)
        let auswahl = ids.isEmpty ? daten.fahrer : daten.fahrer.filter { ids.contains($0.id) }
        let begriffe = suchBegriffe
        guard !begriffe.isEmpty else { return auswahl }
        return auswahl.filter { f in
            let nummer = f.nummer ?? ""
            let heu = [f.name, f.kennzeichen, f.telefon, f.fahrzeug, nummer, nummer.isEmpty ? "" : "#\(nummer)"]
                .filter { !$0.isEmpty }.joined(separator: " ").lowercased()
            return begriffe.contains { heu.contains($0) }
        }
    }

    /// Lange ohne Signal (Schwelle im Karten-Filter), ausser gezielt ausgewaehlt oder "trotzdem zeigen".
    private var langeOhneSignal: [KartenFahrer] {
        passendeFahrer.filter { ohneSignal.zuLange($0, jetzt: reiseUhr) }
    }

    private var ohneSignalAusblenden: Bool {
        !ohneSignal.zeigen && filter.gewaehlteFahrerIDs.isEmpty && !langeOhneSignal.isEmpty
    }

    private var sichtbareFahrer: [KartenFahrer] {
        guard ohneSignalAusblenden else { return passendeFahrer }
        let weg = Set(langeOhneSignal.map(\.id))
        return passendeFahrer.filter { !weg.contains($0.id) }
    }

    private var gefiltert: [KartenFahrer] {
        sichtbareFahrer.filter { schnellFilter.contains($0.zustand) }
            .filter { kartenAuswahl || flaggenFilter.isEmpty || flaggenFilter.contains($0.flagge ?? "") }
    }

    /// Flaggen, die mindestens ein Fahrer traegt.
    private var benutzteFlaggen: [String] {
        Flaggen.alle.map(\.id).filter { id in daten.fahrer.contains { $0.flagge == id } }
    }

    private var gewaehlt: KartenFahrer? { gefiltert.first { $0.id == gewaehltID } }

    // MARK: Dienstreisen auf der Karte (DienstreiseKartenSchicht.jsx)

    private var laufendeReisen: [(reise: DispoDienstreiseSpeicher.Reise, fahrer: DispoDienstreiseSpeicher.Fahrer)] {
        (dienstreisen.liste ?? []).flatMap { r -> [(reise: DispoDienstreiseSpeicher.Reise, fahrer: DispoDienstreiseSpeicher.Fahrer)] in
            // 15 min nach der letzten Ankunft (15.11.): Reise raus, der normale Pin kommt zurueck.
            let abgeschlossen = ReiseLage.berechnen(teile: DispoDienstreiseSpeicher.teile(r), liveJe: reiseLive.je,
                                                    datum: r.datum, standort: nil, jetzt: reiseUhr)?.abgeschlossen ?? false
            if abgeschlossen { return [] }
            return r.fahrer.filter { DispoDienstreiseSpeicher.laeuft(r, $0, jetzt: reiseUhr) }.map { (r, $0) }
        }
    }

    private var reiseFahrerIDs: Set<String> { Set(laufendeReisen.map { $0.fahrer.driverID.uuidString.lowercased() }) }

    /// Normale Pins ohne die Fahrer, die gerade auf Dienstreise sind (auch die Reise vor dem Start im Blatt).
    private var kartenPins: [KartenFahrer] {
        var ids = reiseFahrerIDs
        if let v = vorschauReise.first { ids.insert(v.driverID.lowercased()) }
        return ids.isEmpty ? gefiltert : gefiltert.filter { !ids.contains($0.id.lowercased()) }
    }

    /// Eine Dienstreise auf der Karte: Strecke offen/gefahren, Fahrzeug am errechneten oder GPS-Ort mit Nummer in
    /// Statusfarbe, Umstieg-Marker und Zielflagge. Text vor Start und im Umstieg "Bus 192 ab 06:45",
    /// sonst "ICE 612 → Mannheim 10:29 +3".
    private func reiseEintrag(_ reise: DispoDienstreiseSpeicher.Reise, fahrerID id: String, nummer: String, key: String) -> ReiseKartenEintrag? {
        let d = daten.fahrer.first { $0.id.lowercased() == id }
        // Live-Standort nur vom Handy (ios_app/android_app), sonst errechnet.
        let quelle = (d?.standortQuelle ?? "").lowercased()
        let standort = d.flatMap { f -> ReiseLage.Standort? in
            quelle == "ios_app" || quelle == "android_app"
                ? .init(lat: f.lat, lng: f.lng, erfasst: f.letztesSignal, quelle: quelle) : nil
        }
        let teile = DispoDienstreiseSpeicher.teile(reise)
        guard let lage = ReiseLage.berechnen(teile: teile, liveJe: reiseLive.je,
                                             datum: reise.datum, standort: standort, jetzt: reiseUhr) else { return nil }
        let a = lage.aktuell
        let live = reiseLive.je[a.id]
        let text: String
        if lage.vorStart || lage.imUmstieg {
            let ab = (live?.abfahrt).flatMap { $0.isEmpty ? nil : String($0.prefix(5)) } ?? a.ab_zeit
            text = "\(a.nummer)\(ab.isEmpty ? "" : " ab \(ab)")".trimmingCharacters(in: .whitespaces)
        } else {
            let an = (live?.ankunft).flatMap { $0.isEmpty ? nil : $0 } ?? a.an_zeit
            let spaet = ReiseLage.verspaetungMin(live) ?? 0
            let ziel = Self.kurzOrt(a.nach_name)
            text = "\(a.nummer) → \(ziel)\(an.isEmpty ? "" : " \(an)")\(spaet > 0 ? " +\(spaet)" : "")"
                .trimmingCharacters(in: .whitespaces)
        }
        let farbe: UInt32 = switch d?.zustand {
        case .aktiv?: 0xFF6F63
        case .inaktiv?: 0xE3F654
        default: 0x59BE80
        }
        // Strecke, Umstiege und Zielflagge nur beim gewaehlten Fahrer (mitLinie im Web), sonst nur das Fahrzeug.
        let mitLinie = gewaehltID?.lowercased() == id
        let zielOrt = reise.zielLat.flatMap { lat in reise.zielLng.map { CLLocationCoordinate2D(latitude: lat, longitude: $0) } }
            ?? teile.last?.nachPunkt
        return ReiseKartenEintrag(key: key, driverID: d?.id ?? id,
                                  offen: mitLinie ? lage.offen : [], gefahren: mitLinie ? lage.gefahren : [],
                                  position: lage.position,
                                  art: lage.art, nummer: nummer, text: text, farbe: farbe,
                                  umstiege: mitLinie && teile.count > 1 ? ReiseLage.umstiegPunkte(teile, reiseLive.je) : [],
                                  ziel: mitLinie ? zielOrt : nil)
    }

    private var reiseEintraege: [ReiseKartenEintrag] {
        laufendeReisen.compactMap { x in
            let id = x.fahrer.driverID.uuidString.lowercased()
            return reiseEintrag(x.reise, fahrerID: id, nummer: x.fahrer.profil?.nummer ?? "", key: "\(x.reise.id.uuidString)-\(id)")
        }
    }

    /// Vor dem Start (14.11., KartenView "Vor dem Start"): zeigt das Blatt eine Dienstreise, die noch nicht laeuft,
    /// dann genau wie eine laufende Reise (Fahrzeug mit Nummer und Text), der normale Pin dieses Fahrers ist aus.
    private var vorschauReise: [ReiseKartenEintrag] {
        guard let f = gewaehlt, !reiseFahrerIDs.contains(f.id.lowercased()), let r = blattReise(f) else { return [] }
        let id = f.id.lowercased()
        let nummer = r.fahrer.first { $0.driverID.uuidString.lowercased() == id }?.profil?.nummer ?? ""
        return reiseEintrag(r, fahrerID: id, nummer: nummer, key: "vorschau-\(r.id.uuidString)-\(id)").map { [$0] } ?? []
    }

    /// Reisen, fuer die reiseLive den Live-Stand je Abschnitt holt (alle 2 min): laufende und die Reise vor dem
    /// Start im Fahrerblatt (wie useAbschnittVerbindungen mit nurLinie im Web), damit Zuege schon auf den Gleisen liegen.
    private var liveReisen: [DispoDienstreiseSpeicher.Reise] {
        var liste = laufendeReisen.map(\.reise)
        if let f = gewaehlt, !reiseFahrerIDs.contains(f.id.lowercased()), let r = blattReise(f),
           !liste.contains(where: { $0.id == r.id }) {
            liste.append(r)
        }
        var gesehen = Set<UUID>()
        return liste.filter { gesehen.insert($0.id).inserted }
    }

    /// Dienstreise fuers Fahrerblatt (14.11., wie blattFahrer im Web): laeuft schon (ab 30 min vor Start bis
    /// zur Ankunft) oder kommt heute vor der naechsten Fahrt. Sonst nil, dann die normale naechste Fahrt.
    private func blattReise(_ f: KartenFahrer) -> DispoDienstreiseSpeicher.Reise? {
        let id = f.id.lowercased()
        let tag = Datum.tagWert(reiseUhr)
        let info = f.info
        let fahrtStart: Date? = info.hatFahrt && info.abfahrt.range(of: #"^\d{1,2}:\d{2}"#, options: .regularExpression) != nil
            ? Stunden.zeitpunkt(tag, String(info.abfahrt.prefix(5))) : nil
        let passend = (dienstreisen.liste ?? []).compactMap { r -> (reise: DispoDienstreiseSpeicher.Reise, start: Date)? in
            guard r.fahrer.contains(where: { $0.driverID.uuidString.lowercased() == id && $0.status == "accepted" && $0.beendet == nil }),
                  let start = Stunden.zeitpunkt(r.datum, r.startZeit), let ende = Self.reiseEnde(r, start: start),
                  reiseUhr < ende else { return nil }
            if reiseUhr >= start.addingTimeInterval(-30 * 60) { return (r, start) } // laeuft (oder gleich)
            if r.datum != tag || info.unterwegs { return nil }
            if let fs = fahrtStart, start > fs { return nil }
            return (r, start)
        }
        return passend.min { $0.start < $1.start }?.reise
    }

    /// Ankunft des letzten Abschnitts (reiseEnde), ohne Ankunft Start + 18 h.
    private static func reiseEnde(_ r: DispoDienstreiseSpeicher.Reise, start: Date) -> Date? {
        let teile = DispoDienstreiseSpeicher.teile(r)
        guard let l = teile.last, !l.an_zeit.isEmpty,
              var ende = Stunden.zeitpunkt(l.an_datum ?? l.ab_datum ?? r.datum, l.an_zeit) else {
            return start.addingTimeInterval(18 * 3600)
        }
        if ende < start { ende = ende.addingTimeInterval(86400) }
        return ende
    }

    /// Ziel ohne Adresse und ohne "Hbf".
    static func kurzOrt(_ t: String) -> String {
        let erster = String(t.split(separator: ",", omittingEmptySubsequences: false).first ?? "")
        return erster.replacingOccurrences(of: #"\s*Hbf$"#, with: "", options: [.regularExpression, .caseInsensitive])
            .trimmingCharacters(in: .whitespaces)
    }

    private var zaehler: [FahrerZustand: Int] {
        Dictionary(grouping: sichtbareFahrer.filter { kartenAuswahl || flaggenFilter.isEmpty || flaggenFilter.contains($0.flagge ?? "") }, by: \.zustand).mapValues(\.count)
    }

    /// selectedDriverForSheet: fehlt die Ankunft, aus Abfahrt + Fahrdauer der Route.
    private var blattFahrer: KartenFahrer? {
        guard var f = gewaehlt else { return nil }
        if f.info.ankunft == "--:--", let m = fahrtMinuten, m.id == f.id, let min = m.minuten,
           let eta = KartenRegeln.plusMinuten(f.info.abfahrt, min) {
            f.info.ankunft = eta
        }
        // Unterwegs ohne Fahrzeit aus der Datenbank: Restfahrzeit der Kartenroute statt "<1 min".
        if f.info.unterwegs, f.info.fahrMinuten <= 0, let m = fahrtMinuten, m.id == f.id, let min = m.minuten, min > 0 {
            let k = Calendar.current.dateComponents([.hour, .minute], from: Date().addingTimeInterval(Double(min) * 60))
            f.info.ankunft = String(format: "%02d:%02d", k.hour ?? 0, k.minute ?? 0)
            f.info.fahrMinuten = min
        }
        return f
    }

    var body: some View {
        GeometryReader { geo in
            let s = min(geo.size.width / 402, 1)
            let rasterHoehe = geo.size.height / max(s, 0.01)
            let blattMax = max(Self.blattMin, rasterHoehe - Self.blattUnten - 54)
            ZStack(alignment: .topLeading) {
                DispoKarte(
                    fahrer: kartenPins, gewaehlt: gewaehlt,
                    // Zeigt das Blatt eine Dienstreise, keine Anfahrt-Route zur spaeteren Fahrt.
                    route: gewaehlt.flatMap(blattReise) == nil ? route : nil,
                    blattHoehe: gewaehlt == nil ? 0 : min(max(blatt, Self.blattMin), blattMax),
                    rasterHoehe: rasterHoehe, massstab: s, einpassenSignal: einpassen,
                    waehlen: fahrerTippen, leerTippen: auswahlAufheben, abseits: abseitsGemeldet,
                    orte: orte.orte, gewaehlterOrt: gewaehlterOrt, ortWaehlen: { gewaehlterOrt = $0 },
                    markiert: kartenAuswahl && markierung.aktiv ? Set(markierung.ids) : nil,
                    bereich: bereich.punkte, zugang: kartenZugang,
                    reisen: reiseEintraege + vorschauReise
                )
                .frame(width: geo.size.width, height: geo.size.height)

                if bereichZeichnen { zeichenFlaeche.frame(width: geo.size.width, height: geo.size.height) }

                oberflaeche(rasterHoehe: rasterHoehe, blattMax: blattMax)
                    .frame(width: 402, height: rasterHoehe, alignment: .topLeading)
                    .scaleEffect(s, anchor: .topLeading)
                    .frame(width: 402 * s, height: geo.size.height, alignment: .topLeading)
                    .frame(maxWidth: .infinity)

                if profilOffen, let f = blattFahrer {
                    FahrerProfilFenster(fahrer: f) { profilOffen = false }
                        .frame(width: 402, height: rasterHoehe)
                        .scaleEffect(s, anchor: .topLeading)
                        .frame(width: 402 * s, height: geo.size.height, alignment: .topLeading)
                        .frame(maxWidth: .infinity)
                        .background(Color.black.opacity(0.95))
                }

                Navileiste(aktiv: .karte) { ziel in
                    if ziel == .karte { kartenTipp() } else { zeigen(ziel) }
                }

                if filterOffen {
                    KartenFilterAnsicht(filter: filter, zurueck: { filterOffen = false }, langeOhneSignal: langeOhneSignal)
                }
            }
            .frame(width: geo.size.width, height: geo.size.height)
        }
        .ignoresSafeArea()
        .background(Color(hex: 0x0E0E0E).ignoresSafeArea())
        .task { await daten.starten() }
        .task { await orte.beobachten() }
        .task { await bereich.laden() }
        .task { await dienstreisen.starten() }
        .task(id: liveReisen.map { "\($0.id)" }.joined(separator: ",")) {
            await reiseLive.laufen(liveReisen)
        }
        .onReceive(reiseTakt) { reiseUhr = $0 }
        .onDisappear {
            Task { await daten.beenden() }
            Task { await orte.beenden() }
        }
        .task(id: routenAufgabe) { await routeBerechnen() }
        .onChange(of: gefiltert.map(\.id)) { _, ids in
            if let id = gewaehltID, !ids.contains(id) { gewaehltID = nil }
        }
        .onChange(of: gewaehltID) { _, _ in profilOffen = false }
        // Flaggenfilter gilt in der ganzen Dispo wie eine Markierung (Flagge statt Namen), waehrend der manuellen Auswahl ruht das.
        .onChange(of: flaggenFilter, initial: true) { _, _ in flaggenAlsMarkierung() }
        .onChange(of: daten.fahrer) { _, _ in flaggenAlsMarkierung() }
        .onChange(of: kartenAuswahl) { _, _ in flaggenAlsMarkierung() }
        .onChange(of: benutzteFlaggen) { _, liste in
            flaggenFilter = flaggenFilter.intersection(liste)
        }
        // Namen und Fahrzeuge der markierten Fahrer aktuell halten (fuer Fahrt anlegen, Fahrzeuge, KI).
        .onChange(of: daten.fahrer, initial: true) { _, liste in
            markierung.ergaenzen(liste.map { FahrerMarkierung.Eintrag(id: $0.id, name: $0.name, vehicleId: $0.vehicleId) })
        }
    }

    // MARK: Oberflaeche ueber der Karte (Web-Raster 402 breit)

    @ViewBuilder
    private func oberflaeche(rasterHoehe: CGFloat, blattMax: CGFloat) -> some View {
        ZStack(alignment: .topLeading) {
            if !daten.fehler.isEmpty {
                WebText(text: daten.fehler, groesse: 12, gewicht: .medium, zeilenHoehe: 12 * 1.35, farbe: UIColor(hex: 0xFF8E8E))
                    .padding(12)
                    .frame(width: 362, alignment: .leading)
                    .background(Color(hex: 0x171717))
                    .overlay(Rectangle().stroke(Color(hex: 0x3A3A3A), lineWidth: 1))
                    .platz(20, 196, 362, nil)
            }

            // Zurueck: schwarzer Kreis als Unterlage, sonst schimmert am Rand die Karte durch.
            Button { zeigen(.start) } label: {
                Image("Backbutton_Karte").resizable().scaledToFit()
                    .frame(width: 50, height: 50)
                    .background(Circle().fill(.black))
                    .clipShape(Circle())
            }
            .buttonStyle(.web)
            .accessibilityLabel("Zurück")
            .zurueckPerWischen { zeigen(.start) }
            .platz(20, 60, 50, 50)
            .zIndex(31)

            Button { filterOffen = true } label: {
                Image("karten-layer-button").resizable().frame(width: 50, height: 50)
            }
            .buttonStyle(.web)
            .accessibilityLabel("Filter")
            .platz(402 - 20 - 50, 60, 50, 50)
            .zIndex(31)

            auswahlKnopf
                .platz(402 - 80 - 50, 60, 50, 50)
                .zIndex(31)

            bereichKnopf
                .platz(402 - 140 - 50, 60, 50, 50)
                .zIndex(33)

            if bereichZeichnen {
                bereichLeiste
                    .platz(20, rasterHoehe - 154 - 56, 362, 56)
                    .zIndex(33)
            }
            if !bereichFehler.isEmpty {
                WebText(text: bereichFehler, groesse: 12, gewicht: .medium, zeilenHoehe: 12 * 1.35, farbe: UIColor(hex: 0xFF8E8E))
                    .padding(.horizontal, 12).padding(.vertical, 8)
                    .frame(width: 362, alignment: .leading)
                    .background(Color(hex: 0x171717))
                    .overlay(Rectangle().stroke(Color(hex: 0xFF8E8E), lineWidth: 1))
                    .onTapGesture { bereichFehler = "" }
                    .platz(20, 120, 362, nil)
                    .zIndex(34)
            }

            if erklaerungSichtbar {
                AuswahlErklaerung { erklaerungSichtbar = false }
                    .platz(0, 0, 402, rasterHoehe)
                    .zIndex(30)
            }

            // Im Auswahlmodus ohne Statusleiste, wie im Figma (2832:12528): dort stehen die Flaggen.
            if !kartenAuswahl {
                SchnellFilterLeiste(zaehler: zaehler, gewaehlt: schnellFilter, umschalten: schnellFilterUmschalten) {
                    zeigeFenster.toggle()
                }
                .mittig(201, 142, 362, 44)
            }

            // Hinweis unter der Statusleiste: so viele lange ohne Signal ausgeblendet, Tippen oeffnet den Filter.
            if !kartenAuswahl && ohneSignalAusblenden {
                Button { filterOffen = true } label: {
                    Text("\(langeOhneSignal.count) ohne Signal ausgeblendet ›").grotesk(12, .medium, abstand: 0.3)
                        .foregroundStyle(Color(hex: 0xE3F654))
                        .padding(.horizontal, 10)
                        .frame(height: 30)
                        .background(Color.black)
                        .overlay(Rectangle().strokeBorder(Color(hex: 0xE3F654).opacity(0.5), lineWidth: 1))
                        .fixedSize()
                }
                .buttonStyle(.web)
                .platz(20, 196, nil, 30)
                .zIndex(31)
            }

            // Flaggen (Figma 2832:12528): unter den Knoepfen, nur im Auswahlmodus.
            if kartenAuswahl {
                FlaggenKnoepfe(ids: markierung.ids,
                               flaggeVon: { id in daten.fahrer.first { $0.id == id }?.flagge },
                               wahl: flaggeWaehlen, groesse: 44)
                    .platz(402 - 24 - 44, 134, 44, 144)
                    .zIndex(31)
            } else if !benutzteFlaggen.isEmpty {
                // Ausserhalb der Auswahl bleiben die benutzten Flaggen rechts unter der Statusleiste und filtern die Karte.
                FlaggenKnoepfe(ids: [], flaggeVon: { _ in nil }, wahl: { id in if let id { if flaggenFilter.contains(id) { flaggenFilter.remove(id) } else { flaggenFilter.insert(id) } } },
                               nur: benutzteFlaggen, aktiv: flaggenFilter, filtern: true, groesse: 44)
                    .platz(402 - 24 - 44, 196, 44, CGFloat(benutzteFlaggen.count) * 50 - 6)
                    .zIndex(31)
            }
            if !flaggenFehler.isEmpty {
                WebText(text: flaggenFehler, groesse: 12, gewicht: .medium, zeilenHoehe: 12 * 1.35, farbe: UIColor(hex: 0xFF8E8E))
                    .padding(.horizontal, 12).padding(.vertical, 8)
                    .frame(width: 362, alignment: .leading)
                    .background(Color(hex: 0x171717))
                    .overlay(Rectangle().stroke(Color(hex: 0xFF8E8E), lineWidth: 1))
                    .platz(20, 120, 362, nil)
                    .zIndex(32)
            }

            if zeigeFenster {
                InaktivFenster(stunden: $fensterStunden) { zeigeFenster = false }
                    .mittig(201, 190, 362, nil)
                    .onChange(of: fensterStunden) { _, neu in
                        daten.vorschauStunden = neu
                        Task { await daten.laden() }
                    }
            }

            if let f = blattFahrer {
                let hoehe = min(max(blatt, Self.blattMin), blattMax)
                FahrerBlatt(fahrer: f, reise: blattReise(f), liveJe: reiseLive.je, jetzt: reiseUhr,
                            hoehe: $blatt, zieht: $ziehtBlatt, minimum: Self.blattMin, maximum: blattMax) {
                    profilOffen = true
                }
                .frame(width: 402, height: hoehe)
                .platz(0, rasterHoehe - Self.blattUnten - hoehe, 402, hoehe)
                .animation(ziehtBlatt ? nil : .easeOut(duration: 0.3), value: blatt)
            }
        }
    }

    /// Mehrfachauswahl (Figma Koordinator_Screen_Map): Lime-Kreis, leeres Kaestchen = aus, mit Haken = an,
    /// unten rechts die Zahl der Markierten.
    // MARK: Eigener Bereich

    /// Pinsel-Kreis: Lime ohne Bereich, rot beim Zeichnen und solange ein Bereich gespeichert ist.
    private var bereichKnopf: some View {
        Button {
            if bereichZeichnen { bereichSchliessen() } else { bereichZeichnen = true }
        } label: {
            ZStack {
                Circle().fill(Color(hex: bereichZeichnen || bereich.punkte != nil ? 0xFF6F63 : 0xE3F654))
                Circle().strokeBorder(.black, lineWidth: 2)
                Image("Bereich_Kreis_Trisar_Icons_01").resizable().frame(width: 34, height: 34)
            }
            .frame(width: 50, height: 50)
        }
        .buttonStyle(.web)
        .accessibilityLabel("Bereich zeichnen")
    }

    private var zugGross: Bool {
        guard zugPfad.count >= 3 else { return false }
        let xs = zugPfad.map(\.x), ys = zugPfad.map(\.y)
        return (xs.max()! - xs.min()!) > 30 && (ys.max()! - ys.min()!) > 30
    }

    /// Flaeche ueber der Karte: Finger zieht die Linie, beim Loslassen schliesst sie sich.
    private var zeichenFlaeche: some View {
        ZStack {
            Color.black.opacity(0.001)
            if zugPfad.count >= 2 {
                let form = Path { p in
                    p.addLines(zugPfad)
                    if !zugLaeuft { p.closeSubpath() }
                }
                if !zugLaeuft { form.fill(Color(hex: 0xE3F654).opacity(0.10)) }
                form.stroke(Color(hex: 0xE3F654), style: StrokeStyle(lineWidth: 2, lineCap: .round, lineJoin: .round))
            }
        }
        .contentShape(Rectangle())
        .gesture(
            DragGesture(minimumDistance: 0, coordinateSpace: .local)
                .onChanged { w in
                    if !zugLaeuft { zugLaeuft = true; zugPfad = [w.location] } else { zugPfad.append(w.location) }
                }
                .onEnded { _ in zugLaeuft = false }
        )
    }

    /// Unten: rotes X (loescht den Bereich, ohne Bereich nur schliessen) und Lime-Haken (speichern).
    private var bereichLeiste: some View {
        HStack(spacing: 0) {
            Button { if bereich.punkte != nil { bereichLoeschen() } else { bereichSchliessen() } } label: {
                ZStack {
                    Circle().fill(Color(hex: 0xFF6F63))
                    Circle().strokeBorder(.black, lineWidth: 2)
                    Image("Schliessen_Trisar_Icons_01").resizable().frame(width: 22, height: 22)
                }
                .frame(width: 56, height: 56)
            }
            .buttonStyle(.web)
            .accessibilityLabel(bereich.punkte != nil ? "Bereich löschen" : "Abbrechen")
            Spacer(minLength: 0)
            Button { if zugGross { bereichSpeichern() } else { bereichSchliessen() } } label: {
                ZStack {
                    Circle().fill(Color(hex: 0xE3F654))
                    Circle().strokeBorder(.black, lineWidth: 2)
                    Image("Auswahl_Haken").resizable().frame(width: 22, height: 25).padding(.bottom, 3)
                }
                .frame(width: 56, height: 56)
                .opacity(!zugGross && bereich.punkte == nil ? 0.4 : 1)
            }
            .buttonStyle(.web)
            .disabled(!zugGross && bereich.punkte == nil)
            .accessibilityLabel("Bereich speichern")
        }
    }

    private func bereichSchliessen() {
        bereichZeichnen = false
        zugPfad = []
        zugLaeuft = false
    }

    private func bereichSpeichern() {
        let k = kartenZugang.koordinaten(KartenBereich.ausduennen(zugPfad))
        bereichSchliessen()
        Task {
            let fehler = await bereich.speichern(k)
            bereichFehler = fehler.map { "Bereich nicht gespeichert: \($0)" } ?? ""
            einpassen += 1
        }
    }

    private func bereichLoeschen() {
        bereichSchliessen()
        Task {
            let fehler = await bereich.loeschen()
            bereichFehler = fehler.map { "Bereich nicht gelöscht: \($0)" } ?? ""
        }
    }

    private var auswahlKnopf: some View {
        Button(action: auswahlUmschalten) {
            ZStack {
                Circle().fill(Color(hex: 0xE3F654))
                Circle().strokeBorder(.black, lineWidth: 2)
                if kartenAuswahl {
                    Image("Auswahl_Haken").resizable().frame(width: 20, height: 23).padding(.bottom, 3)
                } else {
                    Image("Auswahl_Leer").resizable().frame(width: 20, height: 20)
                }
            }
            .frame(width: 50, height: 50)
            .overlay(alignment: .bottomTrailing) {
                if kartenAuswahl && markierung.aktiv && !markierung.fahrer.isEmpty {
                    Text("\(markierung.fahrer.count)").font(.grotesk(11, .bold)).foregroundStyle(Color(hex: 0xE3F654))
                        .padding(.horizontal, 5)
                        .frame(minWidth: 20, minHeight: 20)
                        .background(Capsule().fill(.black))
                        .offset(x: 4, y: 4)
                }
            }
        }
        .buttonStyle(.web)
        .accessibilityLabel(kartenAuswahl ? "Mehrfachauswahl ausschalten" : "Mehrfachauswahl einschalten")
    }

    private func flaggenAlsMarkierung() {
        // Jede neue Lage macht eine noch laufende Profil-Abfrage ungueltig (auch Filter leer oder Auswahl an).
        flaggenAbfrage += 1
        guard !kartenAuswahl else { return }
        let ids = Flaggen.alle.map(\.id).filter { flaggenFilter.contains($0) }
        let mit = daten.fahrer.filter { ids.contains($0.flagge ?? "") }
            .map { FahrerMarkierung.Eintrag(id: $0.id, name: $0.name, vehicleId: $0.vehicleId) }
        markierung.flaggenSetzen(ids, fahrer: mit)
        guard !ids.isEmpty else { return }
        // Alle Fahrer mit diesen Flaggen, nicht nur die mit Standort auf der Karte (14.11., wie KartenView.jsx).
        let nummer = flaggenAbfrage
        Task { @MainActor in
            struct Zeile: Decodable { let id: String; let first_name: String?; let last_name: String?; let vehicle_id: String? }
            guard let zeilen: [Zeile] = try? await Backend.client.from("profiles")
                .select("id, first_name, last_name, vehicle_id, flagge")
                .in("flagge", values: ids).execute().value else { return }
            // Inzwischen anderer Filter oder Auswahlmodus an: Ergebnis verwerfen.
            guard nummer == flaggenAbfrage, !kartenAuswahl else { return }
            var liste = mit
            var gesehen = Set(mit.map(\.id))
            for z in zeilen where gesehen.insert(z.id).inserted {
                let name = [z.first_name, z.last_name].compactMap { $0?.trimmingCharacters(in: .whitespaces) }
                    .filter { !$0.isEmpty }.joined(separator: " ")
                liste.append(FahrerMarkierung.Eintrag(id: z.id, name: name, vehicleId: z.vehicle_id ?? ""))
            }
            markierung.flaggenSetzen(ids, fahrer: liste)
        }
    }

    /// Flagge bei allen markierten Fahrern setzen (nil = entfernen), danach die Karte neu laden.
    private func flaggeWaehlen(_ flagge: String?) {
        let ids = markierung.ids
        guard !ids.isEmpty else { return }
        flaggenFehler = ""
        Task {
            if let fehler = await Flaggen.setzen(ids: ids, flagge: flagge) {
                flaggenFehler = fehler
            } else {
                await daten.laden()
            }
        }
    }

    // MARK: Aktionen

    /// Einschalten zeigt den Erklaertext und schliesst ein offenes Fahrerblatt, Ausschalten leert die Auswahl.
    private func auswahlUmschalten() {
        let an = !kartenAuswahl
        kartenAuswahl = an
        markierung.modusSetzen(an)
        erklaerungSichtbar = an
        if an { auswahlAufheben() }
    }

    /// Zweiter Tipp auf denselben Fahrer hebt den Fokus wieder auf.
    /// Bei der Mehrfachauswahl markiert ein Tipp den Fahrer statt sein Blatt zu oeffnen.
    private func fahrerTippen(_ id: String) {
        if kartenAuswahl {
            let f = daten.fahrer.first { $0.id == id }
            markierung.umschalten(FahrerMarkierung.Eintrag(id: id, name: f?.name ?? "", vehicleId: f?.vehicleId ?? ""))
            return
        }
        gewaehltID = gewaehltID == id ? nil : id
        fahrtMinuten = nil
        blatt = Self.blattName
    }

    private func auswahlAufheben() {
        gewaehltID = nil
        fahrtMinuten = nil
        blatt = Self.blattMin
    }

    /// Tipp auf "Karte" in der Leiste: Auswahl weg, alle Fahrer einpassen.
    private func kartenTipp() {
        auswahlAufheben()
        einpassen += 1
    }

    /// Sind alle Zustaende an, zeigt ein Tipp nur diesen. Nie leer: dann wieder alle.
    private func schnellFilterUmschalten(_ z: FahrerZustand) {
        var neu = Set(schnellFilter)
        if neu.count == FahrerZustand.allCases.count {
            neu = [z]
        } else if neu.contains(z) {
            neu.remove(z)
        } else {
            neu.insert(z)
        }
        let liste = FahrerZustand.allCases.filter { neu.contains($0) }
        schnellFilter = liste.isEmpty ? FahrerZustand.allCases : liste
        blatt = Self.blattMin
    }

    // MARK: Route

    private var routenAufgabe: String { KartenRouten.schluessel(gewaehlt) + "#\(abseitsZaehler)" }

    private func routeBerechnen() async {
        route = nil
        guard let f = gewaehlt, f.fahrt != nil else { return }
        let bild = await KartenRouten.berechnen(fahrer: f, ursprung: f.ort, alle: daten.fahrer)
        guard !Task.isCancelled else { return }
        route = bild
        fahrtMinuten = (f.id, bild?.fahrtMinuten)
    }

    /// Mehr als 200 m neben der Route: neu rechnen, hoechstens alle 15 s.
    private func abseitsGemeldet(_ ort: CLLocationCoordinate2D) {
        guard Date().timeIntervalSince(letzteNeuberechnung) > 15 else { return }
        letzteNeuberechnung = Date()
        abseitsZaehler += 1
    }
}

// MARK: - Schnellfilter (DriverQuickFilterBar)

private struct SchnellFilterLeiste: View {
    let zaehler: [FahrerZustand: Int]
    let gewaehlt: [FahrerZustand]
    let umschalten: (FahrerZustand) -> Void
    let fensterUmschalten: () -> Void

    var body: some View {
        HStack(spacing: 0) {
            eintrag(.aktiv)
            Spacer(minLength: 0)
            eintrag(.inaktiv)
            Spacer(minLength: 0)
            eintrag(.frei)
        }
        .padding(.horizontal, 16)
        .frame(width: 362, height: 44)
        .background(RoundedRectangle(cornerRadius: 12).fill(.black))
    }

    @ViewBuilder private func eintrag(_ z: FahrerZustand) -> some View {
        let inhalt = HStack(spacing: 6) {
            Circle().fill(z.farbe).overlay(Circle().stroke(Color(hex: 0x202020), lineWidth: 1)).frame(width: 12, height: 12)
            (Text("\(z.titel) ").font(.grotesk(16, .bold)) + Text("(\(zaehler[z] ?? 0))").font(.grotesk(16)))
                .foregroundStyle(.white)
        }
        .opacity(gewaehlt.contains(z) ? 1 : 0.2)
        .frame(height: 44)
        .contentShape(Rectangle())
        if z == .inaktiv {
            // Lang druecken (450 ms) oeffnet das Inaktiv-Fenster statt umzuschalten.
            inhalt
                .onTapGesture { umschalten(z) }
                .onLongPressGesture(minimumDuration: 0.45) { fensterUmschalten() }
        } else {
            inhalt.onTapGesture { umschalten(z) }
        }
    }
}

/// Regler fuer das Inaktiv-Fenster (0 bis 8 h in halben Stunden).
private struct InaktivFenster: View {
    @Binding var stunden: Double
    let schliessen: () -> Void

    private var etikett: String {
        let r = (stunden * 10).rounded() / 10
        if r == r.rounded() { return "\(Int(r))h" }
        return String(format: "%.1fh", r).replacingOccurrences(of: ".", with: ",")
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text("Inaktiv-Fenster")
                Spacer()
                Text(etikett)
            }
            .font(.grotesk(13, .medium))
            .foregroundStyle(Color(hex: 0xE3F654))
            .padding(.trailing, 30)
            Slider(value: $stunden, in: 0...8, step: 0.5)
                .tint(Color(hex: 0xE3F654))
                .padding(.top, 8)
                .accessibilityLabel("Inaktiv-Fenster in Stunden")
            HStack {
                Text("0h")
                Spacer()
                Text("8h")
            }
            .font(.grotesk(11, .medium))
            .foregroundStyle(Color(hex: 0x8A8A8D))
            .padding(.top, 4)
        }
        .padding(12)
        .frame(width: 362)
        .background(RoundedRectangle(cornerRadius: 12).fill(Color.black.opacity(0.9)))
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(Color(hex: 0x2C2C2C), lineWidth: 1))
        .overlay(alignment: .topTrailing) {
            Button(action: schliessen) {
                Text("×").font(.grotesk(20, .bold)).foregroundStyle(Color(hex: 0xE3F654)).frame(width: 28, height: 28)
            }
            .buttonStyle(.web)
            .accessibilityLabel("Inaktiv-Slider schließen")
            .padding(.top, 2).padding(.trailing, 2)
        }
    }
}

// MARK: - Fahrerblatt (ActiveRideSheet)

private struct FahrerBlatt: View {
    let fahrer: KartenFahrer
    /// Dienstreise statt der naechsten Fahrt (blattReise), dazu Live-Stand je Abschnitt.
    var reise: DispoDienstreiseSpeicher.Reise? = nil
    var liveJe: [UUID: DienstreiseVerbindung] = [:]
    var jetzt = Date()
    @Binding var hoehe: CGFloat
    @Binding var zieht: Bool
    let minimum: CGFloat
    let maximum: CGFloat
    let profilOeffnen: () -> Void
    @State private var startHoehe: CGFloat = 0
    @State private var bewegt = false

    /// Rast, an der der Name (oberster Block) ganz zu sehen ist.
    private var nameRast: CGFloat { min(max(DispoKarteAnsicht.blattName, minimum), maximum) }

    private static let lime = Color(hex: 0xE3F654)
    private static let grau = Color(hex: 0x868687)

    var body: some View {
        VStack(spacing: 0) {
            griff
            ScrollView(.vertical, showsIndicators: false) {
                inhalt.padding(.horizontal, 20).padding(.bottom, 30)
            }
            .scrollBounceBehavior(.basedOnSize)
        }
        .frame(width: 402)
        .background(UnevenRoundedRectangle(topLeadingRadius: 12, topTrailingRadius: 12).fill(Color(hex: 0x17181B))
            .shadow(color: .black.opacity(0.5), radius: 20, y: -10))
    }

    private var griff: some View {
        Rectangle().fill(Self.lime).frame(width: 87, height: 6)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 18)
            .contentShape(Rectangle())
            .gesture(DragGesture(minimumDistance: 0, coordinateSpace: .global)
                .onChanged { g in
                    if !zieht { zieht = true; startHoehe = hoehe; bewegt = false }
                    if abs(g.translation.height) > 3 { bewegt = true }
                    hoehe = max(minimum, min(maximum, startHoehe - g.translation.height))
                }
                .onEnded { _ in
                    zieht = false
                    if !bewegt {
                        // Tipp auf den Griff: zu -> ganz auf, ganz auf -> zu.
                        if hoehe <= minimum + 1 { hoehe = maximum } else if hoehe >= maximum - 1 { hoehe = minimum }
                        return
                    }
                    if hoehe >= nameRast { hoehe = min(hoehe, maximum); return }
                    hoehe = abs(hoehe - minimum) <= abs(hoehe - nameRast) ? minimum : nameRast
                })
            .accessibilityLabel("Panel ziehen")
    }

    private var inhalt: some View {
        let info = fahrer.info
        return VStack(alignment: .leading, spacing: 0) {
            VStack(alignment: .leading, spacing: 5) {
                Button(action: profilOeffnen) {
                    Text(fahrer.name).grotesk(30, .bold, abstand: -0.8).foregroundStyle(Color(hex: 0x1D1C1D))
                        .lineLimit(1).truncationMode(.tail).frame(height: 30)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                .buttonStyle(.web)
                Button { anrufen(fahrer.telefon) } label: {
                    Text(fahrer.telefon).grotesk(16, .bold, abstand: 0.4).foregroundStyle(Color(hex: 0x1D1C1D)).frame(height: 24)
                }
                .buttonStyle(.web)
            }
            .padding(.horizontal, 18)
            .frame(width: 362, height: 96, alignment: .leading)
            .background(Self.lime)
            .clipped()

            VStack(spacing: 4) {
                Text(fahrer.kennzeichen).grotesk(30, .bold, abstand: -0.8).foregroundStyle(Color(hex: 0x1D1C1D)).frame(height: 30)
                Text(fahrer.fahrzeug).grotesk(16, .bold, abstand: -0.5).foregroundStyle(Color(hex: 0x1D1C1D).opacity(0.35)).frame(height: 16)
            }
            .lineLimit(1)
            .padding(.vertical, 10)
            .frame(width: 362)
            .background(Color.white)
            .padding(.top, 12)

            // Uhrzeit des letzten Signals, rot sobald seit 5 Minuten nichts mehr kam.
            Text(fahrer.signalText).grotesk(16, .bold, abstand: -0.3)
                .foregroundStyle(Color(hex: UInt32(fahrer.signalFarbe)))
                .frame(maxWidth: .infinity, alignment: .leading).frame(height: 18)
                .padding(.top, 12)

            HStack(spacing: 8) {
                Text(reise != nil ? "Dienstreise" : "Nächste Fahrt").grotesk(22, .bold, abstand: -1).foregroundStyle(Self.lime)
                if reise != nil {
                    Image("Rollkoffer_Trisar_Icons_01_Lime").resizable().scaledToFit().frame(width: 20, height: 20)
                }
            }
            .frame(height: 21)
            .padding(.top, 6)

            if let reise {
                reiseBlock(reise)
            } else if info.hatFahrt {
                zeitPaar(links: ("ETD", info.abfahrt), rechts: ("ETA", info.ankunft), unterRechts: fahrText(info))
                    .padding(.top, 12)

                HStack(spacing: 16) {
                    ortKachel(info.von.icon)
                    Image("Arrow_Trisar_Icons_01_Lime").resizable().scaledToFit().frame(width: 59, height: 38).frame(maxWidth: .infinity)
                    ortKachel(info.nach.icon)
                }
                .frame(width: 362)
                .padding(.top, 24)

                HStack(alignment: .top, spacing: 24) {
                    ortText(info.von, rechts: false)
                    ortText(info.nach, rechts: true)
                }
                .padding(.top, 12)
            } else {
                keineFahrt.padding(.top, 12)
            }

            zeitPaar(links: ("Dienststart", info.dienststart), rechts: ("Dienstende", info.dienstende), unterRechts: nil)
                .padding(.top, 24)
                .padding(.bottom, 30)
        }
    }

    // MARK: Dienstreise (DienstreiseBlatt im Web)

    private func reiseBlock(_ r: DispoDienstreiseSpeicher.Reise) -> some View {
        let teile = DispoDienstreiseSpeicher.teile(r)
        let erster = teile.first, letzter = teile.last
        func wert(_ t: String?) -> String? { (t ?? "").isEmpty ? nil : t }
        let start = wert(erster.flatMap { liveJe[$0.id]?.abfahrt }) ?? wert(erster?.ab_zeit) ?? wert(r.startZeit) ?? "--:--"
        let ankunft = wert(letzter.flatMap { liveJe[$0.id]?.ankunft }) ?? wert(letzter?.an_zeit) ?? "--:--"
        let haupt = teile.first { ["zug", "sbahn", "flug"].contains($0.art) } ?? erster
        let nummer = wert(haupt?.nummer) ?? wert(r.zugnummer) ?? wert(r.flugnummer)
        let umstiege = teile.count - 1
        let unter = [nummer, umstiege > 0 ? (umstiege == 1 ? "1 Umstieg" : "\(umstiege) Umstiege") : nil]
            .compactMap { $0 }.joined(separator: " · ")
        let lage = ReiseLage.berechnen(teile: teile, liveJe: liveJe, datum: r.datum, standort: nil, jetzt: jetzt)
        let ziel = Self.kurz(r.zielName.isEmpty ? (letzter?.nach_name ?? "") : r.zielName)
        return VStack(alignment: .leading, spacing: 0) {
            // Verspaetet: Zeit Orange mit Kachel „+5“, puenktlich Lime.
            zeitPaar(links: ("START", start), rechts: ("ANKUNFT", ankunft), unterRechts: unter.isEmpty ? nil : unter,
                     spaetLinks: erster.flatMap { liveJe[$0.id]?.abfahrtSpaet } ?? 0,
                     spaetRechts: letzter.flatMap { liveJe[$0.id]?.ankunftSpaet } ?? 0)
                .padding(.top, 12)

            HStack(spacing: 16) {
                ortKachel(DienstreiseAbschnitt.icon(erster?.art ?? (r.flug ? "flug" : "zug")))
                Image("Arrow_Trisar_Icons_01_Lime").resizable().scaledToFit().frame(width: 59, height: 38).frame(maxWidth: .infinity)
                ortKachel("Pin_Nav_Trisar_Icons_01_grau")
            }
            .frame(width: 362)
            .padding(.top, 24)

            HStack(alignment: .top, spacing: 24) {
                reiseOrt(Self.kurz(r.startName), rechts: false)
                reiseOrt(ziel, rechts: true)
            }
            .frame(width: 362)
            .padding(.top, 12)

            if let lage, let zeile = reiseZeile(lage, teile) {
                (Text(zeile.marke).foregroundColor(Self.lime)
                 + Text("  \(zeile.text)").foregroundColor(.white)
                 + Text(zeile.spaet > 0 ? " +\(zeile.spaet)" : "").foregroundColor(Color(hex: 0xF0997B)))
                    .grotesk(14, .bold, abstand: -0.3)
                    .lineLimit(1).truncationMode(.tail)
                    .padding(.vertical, 10).padding(.horizontal, 12)
                    .frame(width: 362, alignment: .leading)
                    .background(RoundedRectangle(cornerRadius: 12).fill(Color(hex: 0x242525)))
                    .padding(.top, 14)
            }
        }
    }

    /// JETZT (Abschnitt laeuft) oder UMSTIEG, vor dem Start und nach der Ankunft keine Zeile.
    private func reiseZeile(_ lage: ReiseLage, _ teile: [DienstreiseAbschnitt]) -> (marke: String, text: String, spaet: Int)? {
        guard !lage.vorStart, !lage.vorbei, teile.indices.contains(lage.index) else { return nil }
        let a = teile[lage.index]
        let live = liveJe[a.id]
        func wert(_ t: String?) -> String? { (t ?? "").isEmpty ? nil : t }
        if lage.imUmstieg {
            let ab = wert(live?.abfahrt) ?? a.ab_zeit
            return ("UMSTIEG", "→ \(a.nummer) ab \(ab)".replacingOccurrences(of: "  ", with: " ").trimmingCharacters(in: .whitespaces), 0)
        }
        guard lage.status.indices.contains(lage.index), lage.status[lage.index] == "jetzt" else { return nil }
        let an = wert(live?.ankunft) ?? a.an_zeit
        let text = "\(a.nummer) → \(Self.kurz(a.nach_name))\(an.isEmpty ? "" : " \(an)")".trimmingCharacters(in: .whitespaces)
        return ("JETZT", text, ReiseLage.verspaetungMin(live) ?? 0)
    }

    private func reiseOrt(_ name: String, rechts: Bool) -> some View {
        WebText(text: name.isEmpty ? "-" : name, groesse: 18, gewicht: .bold, zeilenHoehe: 18 * 1.05, abstand: -0.5,
                ausrichtung: rechts ? .right : .left)
            .frame(maxWidth: .infinity, alignment: rechts ? .trailing : .leading)
    }

    /// Ort ohne Adresse und ohne "Hbf" (reiseKurz).
    private static func kurz(_ t: String) -> String { DispoKarteAnsicht.kurzOrt(t) }

    /// Ohne laufende oder naechste Fahrt: Hinweis statt leerer Zeiten und Orte.
    private var keineFahrt: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Keine Fahrt geplant").grotesk(22, .bold, abstand: -0.8).foregroundStyle(Color(hex: 0xF4F5F4))
            Text("Gerade steht keine weitere Fahrt für diesen Fahrer an.").grotesk(14, .bold, abstand: -0.3)
                .foregroundStyle(Self.grau).fixedSize(horizontal: false, vertical: true)
        }
        .padding(18)
        .frame(width: 362, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 16).fill(Color(hex: 0x242525)))
    }

    private func fahrText(_ info: KartenFahrtInfo) -> String {
        if info.fahrMinuten > 0 { return "-\(info.fahrMinuten) min Fahrt" }
        if info.unterwegs && info.ankunft != "--:--" { return "-<1 min Fahrt" }
        return "- min Fahrt"
    }

    private func zeitPaar(links: (String, String), rechts: (String, String), unterRechts: String?,
                          spaetLinks: Int = 0, spaetRechts: Int = 0) -> some View {
        HStack(alignment: .top, spacing: 24) {
            VStack(alignment: .leading, spacing: 8) {
                Text(links.0).grotesk(12, .bold, abstand: -0.3).foregroundStyle(Self.grau).frame(height: 12)
                HStack(spacing: 8) {
                    Text(links.1).grotesk(42, .bold, abstand: -1).foregroundStyle(spaetLinks > 0 ? ReiseFarben.orange : Self.lime)
                        .lineLimit(1).fixedSize()
                    if spaetLinks != 0 { VerspaetungKachel(minuten: spaetLinks) }
                }
                .frame(height: 38)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            VStack(alignment: .trailing, spacing: 0) {
                Text(rechts.0).grotesk(12, .bold, abstand: -0.3).foregroundStyle(Self.grau).frame(height: 12)
                HStack(spacing: 8) {
                    Text(rechts.1).grotesk(42, .bold, abstand: -1).foregroundStyle(spaetRechts > 0 ? ReiseFarben.orange : Self.lime)
                        .lineLimit(1).fixedSize()
                    if spaetRechts != 0 { VerspaetungKachel(minuten: spaetRechts) }
                }
                .frame(height: 38).padding(.top, 8)
                if let unterRechts {
                    Text(unterRechts).grotesk(12, .bold, abstand: -0.5).foregroundStyle(Color(hex: 0xF4F5F4)).opacity(0.5)
                        .padding(.top, 6)
                }
            }
            .frame(maxWidth: .infinity, alignment: .trailing)
        }
        .frame(width: 362)
    }

    private func ortKachel(_ icon: String?) -> some View {
        ZStack {
            RoundedRectangle(cornerRadius: 16).fill(Color(hex: 0x242525))
            if let icon { Image(icon).resizable().scaledToFit().frame(width: 30, height: 30) }
        }
        .frame(width: 64, height: 64)
    }

    private func ortText(_ ort: KartenOrt, rechts: Bool) -> some View {
        VStack(alignment: rechts ? .trailing : .leading, spacing: 4) {
            Text(ort.typ).grotesk(12, .bold, abstand: -0.4).foregroundStyle(Self.grau)
            WebText(text: ort.name, groesse: 18, gewicht: .bold, zeilenHoehe: 18 * 1.05, abstand: -0.5,
                    ausrichtung: rechts ? .right : .left)
        }
        .frame(maxWidth: .infinity, alignment: rechts ? .trailing : .leading)
    }
}

/// tel:-Link wie im Web (Leerzeichen, Klammern und Striche raus).
private func anrufen(_ telefon: String) {
    let nummer = telefon.replacingOccurrences(of: "[\\s()-]", with: "", options: .regularExpression)
    guard !nummer.isEmpty, let url = URL(string: "tel:\(nummer)") else { return }
    UIApplication.shared.open(url)
}

// MARK: - Fahrerprofil (DriverProfilePopup)

private struct FahrerProfilFenster: View {
    let fahrer: KartenFahrer
    let schliessen: () -> Void
    private static let lime = Color(hex: 0xE3F654)

    var body: some View {
        ZStack {
            Color.black.opacity(0.001).onTapGesture(perform: schliessen)
            VStack(alignment: .leading, spacing: 0) {
                Button(action: schliessen) {
                    Image("Arrow_Trisar_Icons_01_Lime").resizable().scaledToFit().frame(width: 29, height: 18)
                        .rotationEffect(.degrees(180))
                        .frame(width: 54, height: 54)
                        .background(Circle().fill(Color.black.opacity(0.85)))
                        .overlay(Circle().strokeBorder(Self.lime, lineWidth: 2))
                }
                .buttonStyle(.web)
                .accessibilityLabel("Zurück")
                .zurueckPerWischen(schliessen)
                .padding(.bottom, 18)

                VStack(spacing: 0) {
                    bild
                    Text(fahrer.name).grotesk(30, .bold).foregroundStyle(Self.lime).multilineTextAlignment(.center)
                        .padding(.top, 18)
                    Text(fahrer.kennzeichen).grotesk(30, .bold).foregroundStyle(Color(hex: 0xD6D6D6)).padding(.top, 18)
                    Text(fahrer.fahrzeug).grotesk(20).foregroundStyle(Color(hex: 0xD6D6D6)).frame(minHeight: 22)
                    TelemetrieBlock(fahrerID: fahrer.id)
                }
                .padding(.vertical, 18)
                .frame(width: 362)
                .background(Color.black)
                .overlay(Rectangle().strokeBorder(Self.lime, lineWidth: 2))

                let hatTelefon = !fahrer.telefon.trimmingCharacters(in: .whitespaces).isEmpty
                Button { anrufen(fahrer.telefon) } label: {
                    ZStack {
                        Text("\(fahrer.vorname) anrufen").grotesk(16, .medium)
                            .foregroundStyle(Color(hex: hatTelefon ? 0x1D1C1D : 0x5F6130))
                        Image("contact-phone").resizable().frame(width: 22, height: 22)
                            .frame(maxWidth: .infinity, alignment: .trailing).padding(.trailing, 14)
                    }
                    .frame(width: 362, height: 48)
                    .background(Self.lime)
                }
                .buttonStyle(.web)
                .disabled(!hatTelefon)
                .padding(.top, 18)
            }
            .frame(width: 362)
        }
    }

    @ViewBuilder private var bild: some View {
        ZStack {
            Color(hex: 0x1F2023)
            if let url = URL(string: fahrer.bildURL), url.scheme?.hasPrefix("http") == true {
                AsyncImage(url: url) { b in b.resizable().scaledToFill() } placeholder: { ersatzBild }
            } else {
                ersatzBild
            }
        }
        .frame(width: 138, height: 138)
        .clipped()
    }

    private var ersatzBild: some View {
        Image("Person_Trisar_Icons_01").resizable().scaledToFit().frame(width: 82, height: 82).opacity(0.75)
    }
}

/// FahrzeugTelemetrie.jsx: Fahrzeugdaten aus dem OBD-Tracker, dunkle Variante.
private struct TelemetrieBlock: View {
    @StateObject private var t: DispoTelemetrie

    init(fahrerID: String) { _t = StateObject(wrappedValue: DispoTelemetrie(fahrerID: fahrerID)) }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Rectangle().fill(Color(hex: 0x3A3B2A)).frame(height: 1)
            Text("FAHRZEUGDATEN (OBD)").grotesk(13, .bold, abstand: 0.5).foregroundStyle(Color(hex: 0xE3F654))
                .padding(.top, 14)
            if t.zeilen.isEmpty {
                Text("Noch keine Fahrzeugdaten vom Tracker.").grotesk(14).foregroundStyle(Color(hex: 0x8D8D8D)).padding(.top, 10)
            } else {
                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 10, alignment: .leading), count: 3),
                          alignment: .leading, spacing: 12) {
                    ForEach(t.zeilen) { z in
                        VStack(alignment: .leading, spacing: 4) {
                            Text(z.titel).grotesk(11).foregroundStyle(Color(hex: 0x8D8D8D))
                            Text(z.wert).grotesk(18, .bold).foregroundStyle(Color(hex: z.warnung ? 0xFF6B57 : 0xD6D6D6))
                        }
                        .lineLimit(1)
                    }
                }
                .padding(.top, 10)
            }
            if !t.ereignisse.isEmpty {
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(t.ereignisse) { e in
                        Text("\(e.zeit) · \(e.text)").grotesk(11).foregroundStyle(Color(hex: 0x8D8D8D)).lineLimit(1)
                            .frame(height: 15.4, alignment: .leading)
                    }
                }
                .padding(.top, 12)
            }
            if !t.stand.isEmpty {
                Text("Stand \(t.stand)").grotesk(11).foregroundStyle(Color(hex: 0x5F6130)).padding(.top, 10)
            }
        }
        .padding(.horizontal, 18)
        .padding(.top, 18)
        .task { await t.starten() }
        .onDisappear { Task { await t.beenden() } }
    }
}
