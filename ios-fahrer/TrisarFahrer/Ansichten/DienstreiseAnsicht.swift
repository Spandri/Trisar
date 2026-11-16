import CoreLocation
import PassKit
import SafariServices
import SwiftUI

/// Dienstreise, angetippt in der Fahrtenliste (Nachbau von DienstreiseDetail.jsx, 13.11.).
/// Aufbau wie eine Fahrt (DienstStartAnsicht): oben die Karte mit der Strecke (Zug ueber die Halte,
/// Flug als Bogen), Startnadel und Zielflagge, Ausstieg -> Ziel blau. Darunter das ziehbare Blatt:
/// Abfahrt (Gleis/Gate) | Ankunft, Kacheln Start -> Ziel, grosse Zug- bzw. Flugnummer, Notiz der Dispo,
/// „Dienstreise beenden“. Zeiten live ueber die Bahn- bzw. Flugabfrage, alle 2 Minuten.
struct DienstreiseAnsicht: View {
    let reiseID: UUID
    var zurueck: () -> Void

    @ObservedObject private var speicher = DienstreiseSpeicher.shared
    @ObservedObject private var orte = OrteSpeicher.geteilt
    @Environment(\.openURL) private var oeffnen

    @State private var blattProzent: CGFloat = 50
    @State private var ziehBeginn: CGFloat?
    @State private var live: DienstreiseVerbindung?
    @State private var beendenFrage = false
    /// Live-Stand je Abschnitt (Umstiege), alle 2 Minuten neu.
    @State private var liveJe: [UUID: DienstreiseVerbindung] = [:]
    @State private var ticketSeite: WebSeite?
    @State private var walletPass: WalletPass?
    @State private var walletLaedt = false
    @State private var meldung: String?
    /// Alle 30 s neu einordnen (errechnete Position wandert mit der Uhr).
    @State private var jetzt = Date()
    /// Aufgeklappte Halte je Abschnitt (ohne Umstiege: die Reise-ID).
    @State private var halteOffen: Set<UUID> = []
    private let takt = Timer.publish(every: 30, on: .main, in: .common).autoconnect()
    @EnvironmentObject private var ortung: Ortung

    private static let lime = Color(hex: 0xE2F754)
    private static let grau = Color(hex: 0x868786)

    private var reise: DienstreiseSpeicher.Reise? { speicher.liste.first { $0.id == reiseID } }
    /// Live-Stand, sonst der Stand beim Anlegen.
    private var v: DienstreiseVerbindung? { live ?? reise?.verbindung }

    var body: some View {
        GeometryReader { geo in
            let hoehe = geo.size.height
            let blattHoehe = hoehe * blattProzent / 100
            ZStack(alignment: .bottom) {
                KarteAnsicht(inhalt: karte, untenFrei: blattHoehe)
                    .ignoresSafeArea()

                infoBlatt(hoehe: hoehe)
                    .frame(height: blattHoehe)
                    .animation(ziehBeginn == nil ? .timingCurve(0.22, 1, 0.36, 1, duration: 0.32) : nil, value: blattProzent)

                TrisarFussleiste()
            }
            .overlay(alignment: .topLeading) {
                ReiseKarteZurueck(aktion: zurueck).padding(.leading, 20).padding(.top, 60)
            }
            .ignoresSafeArea()
        }
        .background(Color(hex: 0x0A0A0A))
        .task(id: verbindungSchluessel) { await verbindungLaufen() }
        .task(id: abschnittSchluessel) { await abschnitteLaufen() }
        .onReceive(takt) { jetzt = $0 }
        // Ticket im Safari-Blatt, Wallet-Pass im Apple-Dialog.
        .sheet(item: $ticketSeite) { SafariBlatt(url: $0.url).ignoresSafeArea() }
        .sheet(item: $walletPass) { WalletBlatt(pass: $0.pass).ignoresSafeArea() }
        .alert("TRISAR", isPresented: Binding(get: { meldung != nil }, set: { if !$0 { meldung = nil } })) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(meldung ?? "")
        }
        // Reise weg (beendet, zurueckgezogen, abgelehnt): zurueck zur Liste.
        .onChange(of: reise == nil) { _, weg in if weg { zurueck() } }
        .alert("Dienstreise beenden?", isPresented: $beendenFrage) {
            Button("Abbrechen", role: .cancel) {}
            Button("Beenden", role: .destructive) {
                guard let r = reise else { return }
                Task { if await speicher.beenden(r) { zurueck() } }
            }
        }
        .alert("TRISAR", isPresented: Binding(get: { speicher.fehler != nil }, set: { if !$0 { speicher.fehler = nil } })) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(speicher.fehler ?? "")
        }
    }

    // MARK: - Verbindung (useVerbindung)

    private var verbindungSchluessel: String {
        guard let r = reise else { return "-" }
        return "\(r.id)|\(r.nummer)|\(r.datum)|\(r.startName)"
    }

    private func verbindungLaufen() async {
        guard let r = reise, !r.nummer.isEmpty else { return }
        while !Task.isCancelled {
            if let neu = await DienstreiseSpeicher.verbindungHolen(r), neu.fehler == nil, !Task.isCancelled { live = neu }
            try? await Task.sleep(for: .seconds(120))
        }
    }

    private var abschnittSchluessel: String {
        guard let r = reise, r.mehrere else { return "-" }
        return r.abschnitte.map { "\($0.id)|\($0.nummer)|\($0.ab_zeit)" }.joined(separator: ",")
    }

    /// useAbschnittVerbindungen: Zug/Flug-Abschnitte live, Bus/U-Bahn behalten die Ticketzeiten.
    private func abschnitteLaufen() async {
        guard let r = reise, r.mehrere else { return }
        while !Task.isCancelled {
            for a in r.abschnitte {
                if Task.isCancelled { return }
                if let neu = await DienstreiseSpeicher.verbindungHolen(a, datum: r.datum), neu.fehler == nil, !Task.isCancelled {
                    liveJe[a.id] = neu
                }
            }
            try? await Task.sleep(for: .seconds(120))
        }
    }

    // MARK: - Ticket und Wallet

    private func ticketOeffnen(_ r: DienstreiseSpeicher.Reise) {
        Task {
            if let url = await DienstreiseTicket.link(r.ticketPfad) { ticketSeite = WebSeite(url: url) }
            else { meldung = "Ticket konnte nicht geöffnet werden." }
        }
    }

    /// dispo-admin wallet_pass -> .pkpass laden -> Apple-Dialog „Zu Wallet hinzufügen“.
    private func zurWallet(_ r: DienstreiseSpeicher.Reise) {
        guard !walletLaedt else { return }
        walletLaedt = true
        Task {
            defer { walletLaedt = false }
            let w = await DienstreiseSpeicher.walletLink(r.id)
            guard let url = w.url else { meldung = w.meldung; return }
            guard let (daten, _) = try? await URLSession.shared.data(from: url), let pass = try? PKPass(data: daten) else {
                meldung = "Wallet-Pass konnte nicht erstellt werden."; return
            }
            walletPass = WalletPass(pass: pass)
        }
    }

    // MARK: - Karte

    /// Flug: Bogen zwischen zwei Punkten (wie die Flugbahn bei Fahrten).
    private static func bogen(_ a: CLLocationCoordinate2D, _ b: CLLocationCoordinate2D, schritte: Int = 48) -> [CLLocationCoordinate2D] {
        let dx = b.longitude - a.longitude, dy = b.latitude - a.latitude
        return (0...schritte).map { i in
            let t = Double(i) / Double(schritte)
            let hoehe = sin(Double.pi * t) * hypot(dx, dy) * 0.18
            return CLLocationCoordinate2D(latitude: a.latitude + dy * t + hoehe, longitude: a.longitude + dx * t)
        }
    }

    /// Strecke gestrichelt in Lime, letztes Stueck vom Ausstieg zum Ziel blau, Fahrer-Marker am Start, Zielflagge.
    /// Ohne Umstiege: die Reise als ein Abschnitt (Flug als Bogen, Zug ueber Gleise/Halte).
    private func lageTeile(_ r: DienstreiseSpeicher.Reise) -> (teile: [DienstreiseAbschnitt], live: [UUID: DienstreiseVerbindung]) {
        if r.mehrere { return (r.abschnitte, liveJe) }
        let haupt = DienstreiseAbschnitt(id: r.id, dienstreiseID: r.id, art: r.art, nummer: r.nummer,
                                         vonName: r.startName, vonLat: r.startLat, vonLng: r.startLng,
                                         abDatum: r.datum, abZeit: r.startZeit,
                                         nachName: r.zielName, nachLat: r.zielLat, nachLng: r.zielLng)
        var live = v ?? DienstreiseVerbindung()
        if r.flug, let a = r.startPunkt, let b = r.zielPunkt {
            live.linie = Self.bogen(a, b).map { [$0.longitude, $0.latitude] }
        }
        return ([haupt], [r.id: live])
    }

    /// Eigener Handy-Standort der App (Quelle App, mit Zeitpunkt).
    private var standort: ReiseLage.Standort? {
        guard let p = ortung.letztePosition else { return nil }
        return .init(lat: p.coordinate.latitude, lng: p.coordinate.longitude, erfasst: p.timestamp, quelle: "ios_app")
    }

    private var lage: ReiseLage? {
        guard let r = reise else { return nil }
        let t = lageTeile(r)
        return ReiseLage.berechnen(teile: t.teile, liveJe: t.live, datum: r.datum, standort: standort, jetzt: jetzt)
    }

    /// Text am Fahrzeug: laufend "ICE 612 · +3 min", vor Start/im Umstieg "ICE 612 ab 07:28".
    private func fahrzeugText(_ l: ReiseLage, _ live: [UUID: DienstreiseVerbindung]) -> String {
        let a = l.aktuell
        let lv = live[a.id]
        if l.vorStart || l.imUmstieg {
            let ab = (lv?.abfahrt).flatMap { $0.isEmpty ? nil : $0 } ?? a.ab_zeit
            return "\(a.nummer) ab \(ab)".trimmingCharacters(in: .whitespaces)
        }
        let spaet = ReiseLage.verspaetungMin(lv) ?? 0
        return "\(a.nummer)\(spaet > 0 ? " · +\(spaet) min" : "")".trimmingCharacters(in: .whitespaces)
    }

    /// Offene Strecke blau, gefahrenes Stueck grau, Umstiege als Marker mit Icon und Text, Zielflagge, das Fahrzeug mit
    /// dem Fahrer an der berechneten Position. Eingepasst wird nur auf die Strecke.
    private var karte: KarteAnsicht.Inhalt {
        var k = KarteAnsicht.Inhalt()
        guard let r = reise else { return k }
        let t = lageTeile(r)
        guard let l = ReiseLage.berechnen(teile: t.teile, liveJe: t.live, datum: r.datum, standort: standort, jetzt: jetzt) else { return k }
        k.fahrt = l.offen
        k.gefahren = l.gefahren
        k.umstiege = r.mehrere ? ReiseLage.umstiegPunkte(r.abschnitte, liveJe) : []
        k.ziel = r.zielPunkt
        k.fahrzeug = l.position
        k.fahrzeugArt = l.art
        k.fahrzeugText = fahrzeugText(l, t.live)
        k.fahrerNummer = speicher.fahrerNummer
        k.rahmen = l.gesamt + [r.zielPunkt, l.position].compactMap { $0 }
        return k
    }

    // MARK: - Infoblatt

    @ViewBuilder
    private func infoBlatt(hoehe: CGFloat) -> some View {
        VStack(spacing: 0) {
            // Griff: 87 x 6 Lime, 18 Luft oben und unten.
            Rectangle().fill(Self.lime).frame(width: 87, height: 6)
                .padding(.vertical, 18)
                .frame(maxWidth: .infinity)
                .contentShape(Rectangle())
                .gesture(
                    DragGesture(minimumDistance: 2, coordinateSpace: .global)
                        .onChanged { wert in
                            if ziehBeginn == nil { ziehBeginn = blattProzent }
                            let neu = (ziehBeginn ?? 50) - wert.translation.height / hoehe * 100
                            blattProzent = min(max(neu, 25), 85)
                        }
                        .onEnded { _ in
                            ziehBeginn = nil
                            blattProzent = blattProzent > 70 ? 85 : (blattProzent < 40 ? 25 : 50)
                        }
                )

            ScrollView(.vertical, showsIndicators: false) {
                if let r = reise {
                    blattInhalt(r)
                        .padding(.horizontal, 20)
                        .padding(.bottom, 24)
                }
            }
            .scrollBounceBehavior(.basedOnSize)
        }
        .frame(maxWidth: .infinity)
        .background(Color(hex: 0x1A1A1A))
        .clipShape(UnevenRoundedRectangle(topLeadingRadius: 20, topTrailingRadius: 20))
        .shadow(color: .black.opacity(0.5), radius: 20, y: -10)
    }

    @ViewBuilder
    private func blattInhalt(_ r: DienstreiseSpeicher.Reise) -> some View {
        let o = oben(r)
        let abfahrt = o.abfahrt
        let abfahrtSpaet = DienstreiseVerbindung.verspaetung(ist: abfahrt, plan: o.abfahrtPlan)
        let ankunft = o.ankunft
        let ankunftSpaet = DienstreiseVerbindung.verspaetung(ist: ankunft, plan: o.ankunftPlan)
        let gleis = o.gleis.isEmpty ? "" : (r.flug ? o.gleis : "Gleis \(o.gleis)")
        let ankunftOrt = o.ankunftOrt
        let nummer = (v?.nummer).flatMap { $0.isEmpty ? nil : $0 } ?? r.nummer

        VStack(alignment: .leading, spacing: 0) {
            // Wie ETD/ETA einer Fahrt: Beschriftung klein grau, Zeit gross in Lime, darunter Gleis bzw. Ankunftsort.
            HStack(alignment: .top, spacing: 8) {
                zeitSpalte(titel: r.flug ? "Abflug" : "Abfahrt", zeit: abfahrt, spaet: abfahrtSpaet, unter: o.unterStart, zusatz: gleis, rechts: false)
                Spacer(minLength: 0)
                zeitSpalte(titel: "Ankunft", zeit: ankunft, spaet: ankunftSpaet, zusatz: ankunftOrt, rechts: true)
            }

            HStack(alignment: .top, spacing: 12) {
                ortSpalte(icon: r.startIcon, titel: r.flug ? "Abflug" : "Bahnhof", name: r.startName,
                          url: Self.navigationsURL(ortID: r.startOrtID, name: r.startName, adresse: r.startAdresse, punkt: r.startPunkt),
                          rechts: false)
                Image("Arrow_Trisar_Icons_01_Lime").resizable().scaledToFit()
                    .frame(width: 46, height: 26)
                    .padding(.top, 19)
                ortSpalte(icon: r.zielIcon(orte), titel: "Ziel", name: r.zielName,
                          url: Self.navigationsURL(ortID: r.zielOrtID, name: r.zielName, adresse: r.zielAdresse, punkt: r.zielPunkt),
                          rechts: true)
            }
            .padding(.top, 40)

            if r.mehrere {
                verbindungListe(r).padding(.top, 40)
            } else if !nummer.isEmpty {
                VStack(alignment: .leading, spacing: 6) {
                    WebText(text: nummer, groesse: 58, gewicht: .bold, zeilenHoehe: 52, abstand: -1, farbe: .white)
                    if !ankunftOrt.isEmpty {
                        Text("Nach: \(ankunftOrt)").grotesk(18, .bold, abstand: -0.5).foregroundStyle(Self.grau)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    if !r.flug, let halte = v?.halte, !halte.isEmpty {
                        halteKachel(halte, id: r.id, status: lage?.status.first ?? "offen", abfahrt: abfahrt)
                    }
                }
                .padding(.top, 44)
            }

            if let notiz = r.notiz, !notiz.isEmpty {
                // Notiz wie bei einer Fahrt: Titel gross in Lime, Zeit und Datum grau, Text weiss.
                let z = Self.notizZeit(r)
                WebText(text: "Notiz", groesse: 58, gewicht: .bold, zeilenHoehe: 52, abstand: -1, farbe: UIColor(hex: 0xE2F754))
                    .fixedSize()
                    .frame(height: 52, alignment: .topLeading)
                    .padding(.top, 40)
                VStack(alignment: .leading, spacing: 6) {
                    HStack(spacing: 0) {
                        Text(z.zeit)
                        if !z.datum.isEmpty { Text(z.datum).padding(.leading, 44) }
                        Spacer(minLength: 8)
                        Text("Dispo").multilineTextAlignment(.trailing)
                    }
                    .font(.grotesk(16, .bold)).tracking(-0.5)
                    .foregroundStyle(Self.grau)
                    .frame(height: 16)
                    WebText(text: notiz, groesse: 18, gewicht: .bold, zeilenHoehe: 22, abstand: -0.5, farbe: UIColor(hex: 0xF4F5F4))
                }
                .padding(.top, 12)
            }

            if r.ticketPfad?.isEmpty == false {
                ticketZeile(r).padding(.top, 20)
                // Wallet nur, wenn das Geraet Paesse hinzufuegen kann.
                if PKAddPassesViewController.canAddPasses() {
                    WalletKnopf { zurWallet(r) }
                        .frame(height: 48)
                        .opacity(walletLaedt ? 0.6 : 1)
                        .allowsHitTesting(!walletLaedt)
                        .padding(.top, 12)
                }
            }

            if r.status == "accepted" {
                Button { beendenFrage = true } label: {
                    HStack(spacing: 0) {
                        Text("Dienstreise beenden").grotesk(18, .medium, abstand: 0.5).foregroundStyle(.black)
                        Spacer(minLength: 0)
                        Image("Arrow_Trisar_Icons_01").resizable().frame(width: 34, height: 19)
                    }
                    .padding(.leading, 18).padding(.trailing, 16)
                    .frame(maxWidth: .infinity)
                    .frame(height: 56)
                    .background(Color(hex: 0xFF6F63))
                    .contentShape(Rectangle())
                }
                .buttonStyle(.web)
                .padding(.top, 48)
            }

            // 60 wie im Web, dazu Platz ueber der Fussleiste.
            Spacer().frame(height: 60 + 40)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    // MARK: - Umstiege

    /// Oben: ganze Reise (Abfahrt des ersten, Ankunft des letzten Abschnitts), sonst die eine Verbindung.
    private func oben(_ r: DienstreiseSpeicher.Reise) -> (abfahrt: String, abfahrtPlan: String, ankunft: String, ankunftPlan: String,
                                                         gleis: String, ankunftOrt: String, unterStart: String) {
        func wert(_ t: String?) -> String? { (t ?? "").isEmpty ? nil : t }
        guard r.mehrere, let erster = r.abschnitte.first, let letzter = r.abschnitte.last else {
            return (wert(v?.abfahrt) ?? r.startZeit, v?.abfahrt_plan ?? "", wert(v?.ankunft) ?? "--:--", v?.ankunft_plan ?? "",
                    v?.gleis ?? "", v?.ankunft_ort ?? "", "")
        }
        let el = liveJe[erster.id], ll = liveJe[letzter.id]
        return (wert(el?.abfahrt) ?? erster.ab_zeit, el?.abfahrt_plan ?? "",
                wert(ll?.ankunft) ?? wert(letzter.an_zeit) ?? "--:--", ll?.ankunft_plan ?? "",
                wert(el?.gleis) ?? erster.gleis_ab,
                [letzter.nach_name, { let g = DienstreiseVerbindung.gleisStand(live: ll?.gleis_an, ticket: letzter.gleis_an,
                                                                                 fahrplan: ll?.gleis_an_plan).gleis
                                      return g.isEmpty ? "" : "Gl. \(g)" }()].filter { !$0.isEmpty }.joined(separator: " · "),
                erster.von_name)
    }

    /// „Verbindung“: je Abschnitt Icon-Kachel, Nummer, ab/an mit Gleis, dazwischen „Umstieg N min · Gleis 3 → 4“.
    private func verbindungListe(_ r: DienstreiseSpeicher.Reise) -> some View {
        let status = lage?.status
        return VStack(alignment: .leading, spacing: 0) {
            WebText(text: "Verbindung", groesse: 42, gewicht: .bold, zeilenHoehe: 40, abstand: -1, farbe: UIColor(hex: 0xE2F754))
                .fixedSize()
            ForEach(Array(r.abschnitte.enumerated()), id: \.element.id) { i, a in
                let live = liveJe[a.id]
                let ab = (live?.abfahrt).flatMap { $0.isEmpty ? nil : $0 } ?? a.ab_zeit
                let an = (live?.ankunft).flatMap { $0.isEmpty ? nil : $0 } ?? a.an_zeit
                let spaetAb = live?.abfahrtSpaet ?? 0
                let spaetAn = live?.ankunftSpaet ?? 0
                // Gleis live gegen Ticket/Fahrplan (15.11.): geaendert Orange, das alte durchgestrichen.
                let gleisAb = DienstreiseVerbindung.gleisStand(live: live?.gleis, ticket: a.gleis_ab, fahrplan: live?.gleis_plan)
                let gleisAn = DienstreiseVerbindung.gleisStand(live: live?.gleis_an, ticket: a.gleis_an, fahrplan: live?.gleis_an_plan)
                let zustand = i < (status ?? []).count ? status![i] : "offen"
                HStack(alignment: .top, spacing: 14) {
                    // Laufender Abschnitt hervorgehoben (JETZT), erledigte blass mit "gefahren".
                    Image(zustand == "jetzt" ? ReiseLage.fahrzeugIcon(a.art) : DienstreiseAbschnitt.icon(a.art))
                        .resizable().scaledToFit().frame(width: 26, height: 26)
                        .frame(width: 52, height: 52)
                        .background(RoundedRectangle(cornerRadius: 14).fill(zustand == "jetzt" ? Color.black : Color(hex: 0x242525)))
                        .overlay {
                            if zustand == "jetzt" { RoundedRectangle(cornerRadius: 14).strokeBorder(Self.lime, lineWidth: 2.5) }
                        }
                    VStack(alignment: .leading, spacing: 0) {
                        HStack(alignment: .center, spacing: 8) {
                            Text(a.nummer).grotesk(22, .bold, abstand: -0.5).foregroundStyle(.white)
                            Spacer(minLength: 0)
                            if zustand == "jetzt" {
                                Text("JETZT").grotesk(12, .bold).foregroundStyle(.black)
                                    .lineLimit(1).fixedSize()
                                    .padding(.horizontal, 8).padding(.vertical, 3)
                                    .background(Self.lime)
                            } else if zustand == "fertig" {
                                Text("✓ gefahren").grotesk(12, .bold).foregroundStyle(Self.grau).fixedSize()
                            }
                        }
                        haltZeile(zeit: ab, spaet: spaetAb, ort: a.von_name, gleis: gleisAb.gleis, gleisAlt: gleisAb.vorher).padding(.top, 6)
                        haltZeile(zeit: an, spaet: spaetAn, ort: a.nach_name, gleis: gleisAn.gleis, gleisAlt: gleisAn.vorher).padding(.top, 2)
                        // Zwischenhalte (nur Zug, wenn der Server sie liefert).
                        if a.art != "flug", let halte = live?.halte, !halte.isEmpty {
                            halteKachel(halte, id: a.id, status: zustand, abfahrt: ab)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .opacity(zustand == "fertig" ? 0.45 : 1)
                .padding(.top, 22)
                if i + 1 < r.abschnitte.count {
                    let n = r.abschnitte[i + 1]
                    let nAbRoh = (liveJe[n.id]?.abfahrt).flatMap { $0.isEmpty ? nil : $0 } ?? n.ab_zeit
                    let umstieg: Int? = {
                        guard let x = DienstreiseAbschnitt.minuten(nAbRoh), let y = DienstreiseAbschnitt.minuten(an) else { return nil }
                        return (x - y + 1440) % 1440
                    }()
                    let nl = liveJe[n.id]
                    let nGleis = DienstreiseVerbindung.gleisStand(live: nl?.gleis, ticket: n.gleis_ab, fahrplan: nl?.gleis_plan)
                    let vonGleis = gleisAn
                    HStack(spacing: 10) {
                        Rectangle().fill(Self.lime).frame(width: 20, height: 2)
                        // "Umstieg 44 min · Gleis 3 → 9", geaenderte Gleise Orange.
                        (Text("Umstieg\(umstieg.map { " \($0) min" } ?? "")").foregroundColor(Self.grau)
                         + (vonGleis.gleis.isEmpty || nGleis.gleis.isEmpty ? Text("")
                            : Text(" · Gleis ").foregroundColor(Self.grau)
                              + Text(vonGleis.gleis).foregroundColor(vonGleis.vorher.isEmpty ? Self.grau : ReiseFarben.orange)
                              + Text(" → ").foregroundColor(Self.grau)
                              + Text(nGleis.gleis).foregroundColor(nGleis.vorher.isEmpty ? Self.grau : ReiseFarben.orange)))
                            .grotesk(14, .bold)
                    }
                    .padding(.top, 18)
                    .padding(.leading, 66)
                }
            }
        }
    }

    /// Halte zum Ausklappen unter dem Zugabschnitt.
    private func halteKachel(_ halte: [DienstreiseVerbindung.Zwischenhalt], id: UUID, status: String, abfahrt: String) -> some View {
        HalteKachel(halte: halte, status: status, abfahrt: abfahrt, jetzt: jetzt,
                    offen: Binding(get: { halteOffen.contains(id) },
                                   set: { if $0 { halteOffen.insert(id) } else { halteOffen.remove(id) } }))
            .padding(.top, 12)
    }

    /// Zeit (verspaetet Orange mit Kachel „+5“, sonst Lime), Ort, rechts das Gleis.
    private func haltZeile(zeit: String, spaet: Int, ort: String, gleis: String, gleisAlt: String = "") -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            HStack(alignment: .center, spacing: 6) {
                Text(zeit).foregroundStyle(spaet > 0 ? ReiseFarben.orange : Self.lime).fixedSize()
                if spaet != 0 { VerspaetungKachel(minuten: spaet) }
                Text(ort).foregroundStyle(.white)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .font(.grotesk(18, .bold))
            Spacer(minLength: 0)
            // Gleisaenderung (15.11.): altes Gleis grau durchgestrichen, neues Orange.
            HStack(spacing: 4) {
                if !gleisAlt.isEmpty { Text(gleisAlt).strikethrough().foregroundStyle(Self.grau) }
                Text(gleis.isEmpty ? "" : "Gl. \(gleis)").foregroundStyle(gleisAlt.isEmpty ? Self.grau : ReiseFarben.orange)
            }
            .font(.grotesk(13, .bold)).fixedSize()
        }
    }

    /// „Ticket (PDF)“ mit Ticket-Icon, Auftrag · Reisender, Pfeil.
    private func ticketZeile(_ r: DienstreiseSpeicher.Reise) -> some View {
        let unter = [r.auftragsnummer.map { $0.isEmpty ? "" : "Auftrag \($0)" } ?? "", r.reisender ?? ""]
            .filter { !$0.isEmpty }.joined(separator: " · ")
        return Button { ticketOeffnen(r) } label: {
            HStack(spacing: 14) {
                Image("Ticket_Trisar_Icons_01_grau").resizable().scaledToFit().frame(width: 30, height: 30)
                VStack(alignment: .leading, spacing: 0) {
                    Text("Ticket (PDF)").grotesk(18, .bold).foregroundStyle(.white)
                    Text(unter.isEmpty ? (r.ticketName ?? "") : unter).grotesk(13, .bold).foregroundStyle(Self.grau).lineLimit(1)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                Image("Arrow-kurz_Trisar_Icons_01_Lime").resizable().frame(width: 10, height: 13)
            }
            .padding(.horizontal, 14).padding(.vertical, 12)
            .overlay(Rectangle().strokeBorder(Self.lime, lineWidth: 2))
            .contentShape(Rectangle())
        }
        .buttonStyle(.web)
    }

    /// Zeit gross, verspaetet Orange mit Kachel „+5“ rechts daneben, puenktlich Lime ohne Kachel.
    private func zeitSpalte(titel: String, zeit: String, spaet: Int, unter: String = "", zusatz: String, rechts: Bool) -> some View {
        VStack(alignment: rechts ? .trailing : .leading, spacing: 0) {
            Text(titel).grotesk(12, .bold, abstand: -0.3).foregroundStyle(Self.grau)
            HStack(alignment: .center, spacing: 8) {
                WebText(text: zeit, groesse: 32, gewicht: .bold, zeilenHoehe: 32 * 0.88, abstand: -1,
                        farbe: UIColor(hex: spaet > 0 ? 0xF0997B : 0xE2F754), ausrichtung: rechts ? .right : .left)
                    .fixedSize()
                if spaet != 0 { VerspaetungKachel(minuten: spaet) }
            }
            .padding(.top, 6)
            if !unter.isEmpty {
                Text(unter).grotesk(12, .bold).foregroundStyle(Self.grau)
                    .multilineTextAlignment(rechts ? .trailing : .leading)
                    .padding(.top, 4)
            }
            if !zusatz.isEmpty {
                Text(zusatz).grotesk(12, .bold).foregroundStyle(Self.grau)
                    .multilineTextAlignment(rechts ? .trailing : .leading)
                    .padding(.top, 4)
            }
        }
    }

    private func ortSpalte(icon: String, titel: String, name: String, url: URL?, rechts: Bool) -> some View {
        VStack(alignment: rechts ? .trailing : .leading, spacing: 0) {
            Image(icon).resizable().scaledToFit().frame(width: 30, height: 30)
                .frame(width: 64, height: 64)
                .background(Color(hex: 0x242525))
                .clipShape(RoundedRectangle(cornerRadius: 16))
            Text(titel).grotesk(14, .bold, abstand: -0.5).foregroundStyle(Self.grau)
                .padding(.top, 24)
            Button {
                if let url { oeffnen(url) }
            } label: {
                Text(name)
                    .font(.grotesk(18, .bold)).tracking(-0.5)
                    .foregroundStyle(.white)
                    .underline(url != nil, color: Self.lime)
                    .multilineTextAlignment(rechts ? .trailing : .leading)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .buttonStyle(.web)
            .disabled(url == nil)
        }
        .frame(maxWidth: .infinity, alignment: rechts ? .trailing : .leading)
    }

    // MARK: - Hilfen

    /// Zeit und Datum der letzten Aenderung fuer die Notiz.
    private static func notizZeit(_ r: DienstreiseSpeicher.Reise) -> (zeit: String, datum: String) {
        guard let d = (r.geaendert ?? r.erstellt).flatMap(Datum.ausISO) else { return ("", "") }
        return (Datum.uhrzeit(d), Datum.datumKurz(d))
    }

    /// Google-Maps-Navigation wie beim Treffpunkt: bei eigenen Orten nur die Adresse,
    /// ohne Adresse die Koordinaten.
    static func navigationsURL(ortID: UUID?, name: String, adresse: String?, punkt: CLLocationCoordinate2D?) -> URL? {
        let a = (adresse ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        var ziel = Adresse.fuerNavigation(name: ortID != nil && !a.isEmpty ? "" : name, adresse: a.isEmpty ? name : a)
        if a.isEmpty, let p = punkt { ziel = "\(p.latitude),\(p.longitude)" }
        guard !ziel.isEmpty else { return nil }
        var teile = URLComponents(string: "https://www.google.com/maps/dir/")!
        teile.queryItems = [.init(name: "api", value: "1"), .init(name: "travelmode", value: "driving"),
                            .init(name: "destination", value: ziel)]
        return teile.url
    }
}

/// Zurueck auf der Karte: schwarzer Kreis 50 mit Backbutton_Karte, Schatten (wie in der Fahrt-Ansicht).
private struct ReiseKarteZurueck: View {
    let aktion: () -> Void
    var body: some View {
        Button(action: aktion) {
            Image("Backbutton_Karte").resizable().frame(width: 50, height: 50)
                .background(Circle().fill(.black))
                .clipShape(Circle())
                .shadow(color: .black.opacity(0.45), radius: 8, y: 4)
        }
        .buttonStyle(.web)
        .accessibilityLabel("Zurück")
        .zurueckPerWischen(aktion)
    }
}

// MARK: - Ticket- und Wallet-Bausteine

private struct WebSeite: Identifiable { let url: URL; var id: String { url.absoluteString } }
private struct WalletPass: Identifiable { let pass: PKPass; var id: String { pass.serialNumber } }

/// Ticket (signierter Link) im Safari-Blatt, PDF zeigt Safari selbst an.
private struct SafariBlatt: UIViewControllerRepresentable {
    let url: URL
    func makeUIViewController(context: Context) -> SFSafariViewController { SFSafariViewController(url: url) }
    func updateUIViewController(_ vc: SFSafariViewController, context: Context) {}
}

/// Apple-Dialog „Zu Wallet hinzufügen“.
private struct WalletBlatt: UIViewControllerRepresentable {
    let pass: PKPass
    func makeUIViewController(context: Context) -> UIViewController {
        PKAddPassesViewController(pass: pass) ?? UIViewController()
    }
    func updateUIViewController(_ vc: UIViewController, context: Context) {}
}

/// Offizieller Apple-Knopf „Zu Apple Wallet hinzufügen“ (PKAddPassButton).
private struct WalletKnopf: UIViewRepresentable {
    let aktion: () -> Void
    func makeCoordinator() -> Ziel { Ziel(aktion: aktion) }
    func makeUIView(context: Context) -> PKAddPassButton {
        let k = PKAddPassButton(addPassButtonStyle: .black)
        k.addTarget(context.coordinator, action: #selector(Ziel.tippen), for: .touchUpInside)
        return k
    }
    func updateUIView(_ k: PKAddPassButton, context: Context) { context.coordinator.aktion = aktion }
    final class Ziel: NSObject {
        var aktion: () -> Void
        init(aktion: @escaping () -> Void) { self.aktion = aktion }
        @objc func tippen() { aktion() }
    }
}
