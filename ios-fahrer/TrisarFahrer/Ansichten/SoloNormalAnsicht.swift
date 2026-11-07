import CoreLocation
import SwiftUI

/// Nachbau von SoloNormal.jsx und SoloFlughafen.jsx (Fahrt mit Flug- oder Zugnummer).
/// Karte bildschirmhoch, darueber das ziehbare Infoblatt
/// (25 / 50 / 85 % der Hoehe) mit ETD/ETA, Orten, Gaesten, Notizen und vier Knoepfen.
struct SoloNormalAnsicht: View {
    let fahrtID: UUID
    var zurueck: () -> Void

    @EnvironmentObject private var speicher: FahrtenSpeicher
    @EnvironmentObject private var anmeldung: Anmeldung
    @EnvironmentObject private var ortung: Ortung
    @StateObject private var details: FahrtDetails
    /// Eigene Orte der Dispo: Icon und Pin des Orts, wenn die Fahrt einen hat.
    @ObservedObject private var orte = OrteSpeicher.geteilt

    @State private var blattProzent: CGFloat = 50
    @State private var ziehBeginn: CGFloat?
    @State private var karte = KarteAnsicht.Inhalt()
    @State private var anfahrtVoll: [CLLocationCoordinate2D] = []
    @State private var letzteNeuberechnung = Date.distantPast
    @State private var fahrtMinutenLive: Int?
    @State private var offenesBlatt: Blatt?
    @State private var beschaeftigt = false
    @State private var jetzt = Date()
    @State private var gewaehlterKollege: FahrtDetails.KolonnenFahrer?
    @State private var chatOffen = false
    @State private var supportOffen = false

    private enum Blatt: String, Identifiable {
        case beenden, stornieren, notiz, schild
        var id: String { rawValue }
    }

    init(fahrtID: UUID, fahrerID: UUID, zurueck: @escaping () -> Void) {
        self.fahrtID = fahrtID
        self.zurueck = zurueck
        _details = StateObject(wrappedValue: FahrtDetails(fahrtID: fahrtID, fahrerID: fahrerID))
    }

    private var fahrt: Fahrt? { speicher.fahrten.first { $0.id == fahrtID } }

    /// Kolonnen-Ansicht nur mit Kollegen in der Kolonne (hasKolonneColleagues).
    private var istKolonne: Bool { (fahrt?.istKolonne ?? false) && details.hatKollegen }

    /// "Kolonne Name" bzw. "Kolonne" (Name ohne vorangestelltes "Kolonne").
    private var kolonnenTitel: String {
        let n = details.kolonnenName
            .replacingOccurrences(of: #"^\s*kolonn?e?\s*"#, with: "", options: [.regularExpression, .caseInsensitive])
            .replacingOccurrences(of: #"^[:\-–]\s*"#, with: "", options: .regularExpression)
            .trimmingCharacters(in: .whitespaces)
        return n.isEmpty ? "Kolonne" : "Kolonne \(n)"
    }

    /// kolonnenNameKurz: Gattungswort (Kolonne, Konvoi, Convoy ...) vorne weg, sonst "Kolonne".
    private var kolonnenKurz: String {
        let n = details.kolonnenName.replacingOccurrences(of: #"^\s*(kolonn?e?|konvoi|konvoy|convoy|convoi|convoglio)\b\s*[:\-–]?\s*"#,
                                                          with: "", options: [.regularExpression, .caseInsensitive])
            .trimmingCharacters(in: .whitespaces)
        return n.isEmpty ? "Kolonne" : n
    }

    /// Fahrerzeilen (convoyDriverRows): eindeutig nach Name, sonst „Keine Fahrer“.
    private var kolonnenZeilen: [(id: UUID?, name: String)] {
        var gesehen = Set<String>()
        let zeilen = details.kolonnenFahrer.filter { gesehen.insert($0.name.lowercased()).inserted }.map { (Optional($0.id), $0.name) }
        return zeilen.isEmpty ? [(nil, "Keine Fahrer")] : zeilen
    }

    /// Wie hasFlightNumber im Web: Flug- oder Zugnummer vorhanden -> Flughafen-Ansicht.
    private var istFlug: Bool {
        let n = (fahrt?.flug ?? "").trimmingCharacters(in: .whitespaces).uppercased()
        return !n.isEmpty && n != "STADTFAHRT"
    }

    var body: some View {
        GeometryReader { geo in
            let hoehe = geo.size.height
            let blattHoehe = hoehe * blattProzent / 100
            ZStack(alignment: .bottom) {
                KarteAnsicht(inhalt: karte, untenFrei: blattHoehe)
                    .ignoresSafeArea()

                if let fahrt {
                    infoBlatt(fahrt, breite: geo.size.width, hoehe: hoehe)
                        .frame(height: blattHoehe)
                        .animation(ziehBeginn == nil ? .timingCurve(0.22, 1, 0.36, 1, duration: 0.32) : nil, value: blattProzent)
                }

                TrisarFussleiste()
            }
            .overlay(alignment: .topLeading) {
                KarteZurueck(aktion: zurueck).padding(.leading, 20).padding(.top, 60)
            }
            .overlay(alignment: .top) {
                if let fehler = details.fehler ?? speicher.fehler {
                    Text(fehler).font(.grotesk(13, .medium)).foregroundStyle(.black)
                        .padding(12).frame(maxWidth: .infinity).background(Farbe.fehler)
                        .onTapGesture { details.fehler = nil; speicher.fehler = nil }
                        .padding(.top, 120)
                }
            }
            .ignoresSafeArea()
        }
        .background(Color(hex: 0x0A0A0A))
        .task { await details.laden() }
        .task(id: routenSchluessel) { await routenBerechnen() }
        .onChange(of: ortung.letztePosition?.coordinate.latitude) { _, _ in anfahrtKuerzen() }
        .onReceive(Timer.publish(every: 30, on: .main, in: .common).autoconnect()) { zeit in
            jetzt = zeit
            // Flugposition kommt ueber external-sync in die Fahrt, darum regelmaessig nachladen.
            if istFlug { Task { await details.laden() } }
        }
        .onChange(of: details.flugPosition?.latitude) { _, _ in flugAufKarte() }
        .onChange(of: details.flugSpur.count) { _, _ in flugAufKarte() }
        .onChange(of: details.kolonnenFahrer) { _, _ in karte.kollegen = kollegenAufKarte }
        .onChange(of: fahrt == nil) { _, weg in if weg { zurueck() } }
        .overlay {
            if let k = gewaehlterKollege {
                KollegenKarte(fahrer: k) { gewaehlterKollege = nil }
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: .supportOeffnen)) { _ in
            if offenesBlatt == nil && !chatOffen { supportOffen = true }
        }
        .webVollbild(isPresented: $supportOffen) { SupportAnsicht { supportOffen = false } }
        .webVollbild(isPresented: $chatOffen, onDismiss: { Task { await speicher.ungelesenAktualisieren() } }) {
            if let k = fahrt?.kolonnenID, let fahrer = anmeldung.fahrerID {
                KolonnenChatAnsicht(chatID: k, fahrerID: fahrer, titel: kolonnenKurz) { chatOffen = false }
            }
        }
        .webVollbild(item: $offenesBlatt) { blatt in
            blattAnsicht(blatt)
        }
    }

    // MARK: - Infoblatt

    @ViewBuilder
    private func infoBlatt(_ fahrt: Fahrt, breite: CGFloat, hoehe: CGFloat) -> some View {
        VStack(spacing: 0) {
            // Griff: 87 x 6 Lime, 18 Luft oben und unten.
            Rectangle().fill(Color(hex: 0xE2F754)).frame(width: 87, height: 6)
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
                blattInhalt(fahrt, breite: breite)
                    .padding(.bottom, 24)
            }
            .scrollBounceBehavior(.basedOnSize)
        }
        .frame(maxWidth: .infinity)
        .background(Color(hex: 0x1A1A1A))
        .clipShape(UnevenRoundedRectangle(topLeadingRadius: 20, topTrailingRadius: 20))
        .shadow(color: .black.opacity(0.5), radius: 20, y: -10)
    }

    /// Web-Koordinate -> Blatt: Inhalt ist um 111 (Kolonne: 24) nach oben geschoben.
    private func y(_ webOben: CGFloat) -> CGFloat { webOben - (istKolonne ? 24 : 111) }

    /// Inhalt im Raster des Webs, dort um 111 nach oben geschoben (ETD steht bei 111).
    @ViewBuilder
    private func blattInhalt(_ fahrt: Fahrt, breite: CGFloat) -> some View {
        let innen = breite - 40
        let merkmale = details.merkmale
        // Gemeinsame Regel: Namen je Zeile, anonyme Gaeste als eigene Zeile, sonst "Keine Gäste".
        let gaeste = GaesteAnzeige.zeilen(details.gaeste, anonym: details.anonym)
        // Flughafen: Gaeste immer bei 482 (Platz fuer Flugnummer), sonst je nach Merkmalen.
        let gaesteOben: CGFloat = y(istFlug || !merkmale.isEmpty ? 563 - 81 : 289 + 64 + 42)
        let ersteGastZeile = gaesteOben + 50
        let gaesteUnten = ersteGastZeile + CGFloat(gaeste.count - 1) * 57 + 51
        let nav = Self.navigationsURL(fahrt)

        ZStack(alignment: .topLeading) {
            // ETD / ETA
            Text("ETD").grotesk(12, .bold, abstand: -0.3).foregroundStyle(Color(hex: 0x868687)).platz(20, y(111))
            Text("ETA").grotesk(12, .bold, abstand: -0.3).foregroundStyle(Color(hex: 0x868687))
                .platz(0, y(111), breite - 20, nil, .trailing)
            WebText(text: fahrt.etd, groesse: 32, gewicht: .bold, zeilenHoehe: 32 * 0.88, abstand: -1, farbe: UIColor(hex: 0xE2F754))
                .fixedSize().platz(20, y(129))
            WebText(text: istFlug ? etaFlug(fahrt) : eta(fahrt), groesse: 32, gewicht: .bold, zeilenHoehe: 32 * 0.88, abstand: -1, farbe: UIColor(hex: 0xE2F754), ausrichtung: .right)
                .frame(width: innen).platz(20, y(129))
            Text(fahrDauerText(fahrt)).grotesk(12, .bold, abstand: -0.5)
                .foregroundStyle(Color(hex: 0xF4F5F4).opacity(0.5))
                .platz(0, y(156), breite - 20, nil, .trailing)

            if istFlug {
                // Planzeit durchgestrichen, darunter die Flugphase (nur bei bekanntem Statuscode).
                Text("Plan: \((fahrt.planEtd ?? "").isEmpty ? "--:--" : fahrt.planEtd!)")
                    .grotesk(12, .bold, abstand: -0.5).strikethrough()
                    .foregroundStyle(Color(hex: 0xF4F5F4).opacity(0.5))
                    .platz(20, y(156))
                if let phase = Self.flugPhase(details.flugStatusCode, flughafen: fahrt.istFlughafen) {
                    Text(phase).grotesk(12, .bold, abstand: -0.5)
                        .foregroundStyle(Color(hex: 0xF4F5F4).opacity(0.7))
                        .platz(20, y(174))
                }
            }

            // Orte: Icons, Pfeil, Bezeichnung und Name (Name fuehrt zu Google Maps).
            OrtKachel(name: orte.iconGrau(fahrt.abholOrtID)
                ?? Self.icon(fahrt.abholName + " " + fahrt.abholAdresse + " " + fahrt.abholKurz, start: true))
                .platz(20, y(211), 64, 64)
            Image("Arrow_Trisar_Icons_01_Lime").resizable().scaledToFit()
                .frame(width: 59, height: 38)
                .platz((breite - 59) / 2, y(231), 59, 38)
            OrtKachel(name: orte.iconGrau(fahrt.zielOrtID)
                ?? Self.icon(fahrt.zielName + " " + fahrt.zielAdresse + " " + fahrt.zielKurz, start: false))
                .platz(breite - 20 - 64, y(211), 64, 64)

            HStack(alignment: .top, spacing: 18) {
                OrtText(art: Self.ortArt(fahrt.abholName, fahrt.abholAdresse), name: fahrt.abholKurz, url: nav, rechts: false)
                OrtText(art: Self.ortArt(fahrt.zielName, fahrt.zielAdresse), name: fahrt.zielKurz, url: nav, rechts: true)
            }
            .platz(20, y(289), innen, nil)

            if !merkmale.isEmpty {
                HStack(spacing: 8) {
                    ForEach(merkmale, id: \.self) { m in
                        Image(Self.merkmalIcon(m)).resizable().scaledToFit().frame(width: 58, height: 58)
                    }
                }
                .platz(20, y(386), istFlug ? innen : nil, nil, istFlug ? .trailing : .leading)
            }

            if istFlug {
                WebText(text: fahrt.flug.trimmingCharacters(in: .whitespaces), groesse: 42, gewicht: .bold,
                        zeilenHoehe: 42 * 0.88, abstand: -1, farbe: UIColor(hex: 0xF4F5F4))
                    .fixedSize().platz(20, y(386))
                if !details.flugHerkunft.isEmpty {
                    WebText(text: "Aus: \(details.flugHerkunft)", groesse: 16, gewicht: .bold, zeilenHoehe: 16, abstand: -0.5,
                            farbe: UIColor(hex: 0xF4F5F4).withAlphaComponent(0.5))
                        .fixedSize().platz(20, y(424))
                }
            }

            WebText(text: "Gäste", groesse: 32, gewicht: .bold, zeilenHoehe: 32, abstand: -1, farbe: UIColor(hex: 0xE2F754))
                .fixedSize().platz(20, gaesteOben)
            ForEach(Array(gaeste.enumerated()), id: \.offset) { i, name in
                Button {
                    if !details.gaeste.isEmpty { offenesBlatt = .schild }
                } label: {
                    Text(name).grotesk(18, .bold, abstand: -0.5).foregroundStyle(Color(hex: 0xE2F754))
                        .padding(.horizontal, 12)
                        .frame(width: innen, height: 51, alignment: .leading)
                        .background(Color(hex: 0x242425))
                }
                .buttonStyle(.web)
                .platz(20, ersteGastZeile + CGFloat(i) * 57, innen, 51)
            }

            if istKolonne {
                // Chat-Balken der Kolonne, im Web nicht mitverschoben (top 18).
                Button { chatOffen = true } label: {
                    HStack {
                        Text(kolonnenTitel).grotesk(18, .bold, abstand: -0.5).foregroundStyle(Color(hex: 0x262626))
                        Spacer()
                        Image("Chat_Konnvoi_Trisar_Icons_01").resizable().scaledToFit().frame(width: 24, height: 24)
                    }
                    .padding(.horizontal, 12)
                    .frame(width: innen, height: 45)
                    .background(Color(hex: 0xE2F754))
                    // Ungelesene: roter Kreis 28 mittig auf der oberen rechten Ecke.
                    .overlay(alignment: .topTrailing) {
                        if let k = fahrt.kolonnenID, let n = speicher.ungelesen[k], n > 0 {
                            Text(n > 9 ? "9+" : "\(n)").font(.grotesk(14, .bold)).foregroundStyle(.black)
                                .frame(width: 28, height: 28).background(Circle().fill(Color(hex: 0xFF6E63)))
                                .offset(x: 14, y: -14)
                        }
                    }
                }
                .buttonStyle(.web)
                .platz(20, 18, innen, 45)

                let fahrerOben = gaesteUnten + 30
                WebText(text: "Fahrer", groesse: 32, gewicht: .bold, zeilenHoehe: 32, abstand: -1, farbe: UIColor(hex: 0xE2F754))
                    .fixedSize().platz(20, fahrerOben)
                ForEach(Array(kolonnenZeilen.enumerated()), id: \.offset) { i, f in
                    Button {
                        if f.id != nil { gewaehlterKollege = details.kolonnenFahrer.first { $0.id == f.id } }
                    } label: {
                        Text(f.name).grotesk(18, .bold, abstand: -0.5).foregroundStyle(Color(hex: 0x242425))
                            .padding(.horizontal, 12)
                            .frame(width: innen, height: 51, alignment: .leading)
                            .background(Color(hex: 0xE2F754))
                            .opacity(f.id == nil ? 0.7 : 1)
                    }
                    .buttonStyle(.web)
                    .platz(20, fahrerOben + 50 + CGFloat(i) * 57, innen, 51)
                }
                unterteil(fahrt, innen: innen)
                    .platz(20, fahrerOben + 50 + CGFloat(kolonnenZeilen.count - 1) * 57 + 51 + 60, innen, nil)
            } else {
                unterteil(fahrt, innen: innen)
                    .platz(20, gaesteUnten + 30, innen, nil)
            }
        }
        .frame(width: breite, alignment: .topLeading)
    }

    /// Notizen und Knoepfe. Im Web per gemessener Hoehe gestapelt, hier als Spalte.
    @ViewBuilder
    private func unterteil(_ fahrt: Fahrt, innen: CGFloat) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            if !details.notizen.isEmpty {
                WebText(text: "Notiz", groesse: 58, gewicht: .bold, zeilenHoehe: 52, abstand: -1, farbe: UIColor(hex: 0xE2F754))
                    .fixedSize()
                    .frame(height: 52, alignment: .topLeading)
                Spacer().frame(height: 64 - 52)
                VStack(alignment: .leading, spacing: 24) {
                    ForEach(details.notizen) { notiz in
                        VStack(alignment: .leading, spacing: 6) {
                            HStack(spacing: 0) {
                                Text(notiz.zeit)
                                if !notiz.datum.isEmpty { Text(notiz.datum).padding(.leading, 44) }
                                Spacer(minLength: 8)
                                if !notiz.autor.isEmpty { Text(notiz.autor).multilineTextAlignment(.trailing) }
                            }
                            .font(.grotesk(16, .bold)).tracking(-0.5)
                            .foregroundStyle(Color(hex: 0x868786))
                            .frame(height: 16)
                            WebText(text: notiz.text, groesse: 18, gewicht: .bold, zeilenHoehe: 18, abstand: -0.5, farbe: UIColor(hex: 0xF4F5F4))
                        }
                    }
                }
                Spacer().frame(height: 54)
            }
            VStack(spacing: 24) {
                AktionsKnopf(text: "Fahrt beenden", farbe: Color(hex: 0xFF6F63)) { offenesBlatt = .beenden }
                AktionsKnopf(text: "Stornieren", farbe: Color(hex: 0xE2F754)) { offenesBlatt = .stornieren }
                AktionsKnopf(text: "Notiz zur Fahrt", farbe: Color(hex: 0xE2F754)) { offenesBlatt = .notiz }
                Button { supportOffen = true } label: {
                    Text("Support").font(.grotesk(16, .medium)).tracking(0.5)
                        .foregroundStyle(Color(hex: 0xE2F754).opacity(0.5))
                        .frame(maxWidth: .infinity).frame(height: 56)
                        .overlay(Rectangle().strokeBorder(Color(hex: 0xE2F754), lineWidth: 2))
                }
                .buttonStyle(.web)
            }
            // Unter dem letzten Knopf: Fussleiste 40 + 30 Luft (minus pb-6, das unten dazukommt).
            Spacer().frame(height: 40 + 30 - 24)
        }
        .frame(width: innen, alignment: .leading)
    }

    // MARK: - Blaetter

    @ViewBuilder
    private func blattAnsicht(_ blatt: Blatt) -> some View {
        let autor = anmeldung.profil?.name ?? ""
        switch blatt {
        case .beenden:
            NotizBlatt(titel: "Warum wollen sie diese Fahrt beenden?", titelFarbe: Color(hex: 0xFF6F63),
                       knopf: "Fahrt beenden", knopfFarbe: Color(hex: 0xFF6F63),
                       schliessen: { offenesBlatt = nil }, bestaetigen: { notiz in
                           Task {
                               beschaeftigt = true
                               let ok = await details.beenden(notiz: notiz, autor: autor)
                               beschaeftigt = false
                               if ok { offenesBlatt = nil; await speicher.laden(); zurueck() }
                           }
                       }, beschaeftigt: beschaeftigt)
        case .stornieren:
            NotizBlatt(titel: "Warum wollen Sie diese Fahrt stornieren?", titelFarbe: Farbe.lime,
                       knopf: "Stornieren beenden", knopfFarbe: Farbe.lime,
                       schliessen: { offenesBlatt = nil }, bestaetigen: { notiz in
                           guard let fahrt else { return }
                           Task {
                               beschaeftigt = true
                               let ok = await speicher.antworten(fahrt, annehmen: false, grund: notiz)
                               beschaeftigt = false
                               if ok { offenesBlatt = nil; zurueck() }
                           }
                       }, beschaeftigt: beschaeftigt)
        case .notiz:
            NotizBlatt(titel: "Wichtige Infos zu dieser Fahrt!", titelFarbe: Farbe.lime,
                       knopf: "Notiz abschicken", knopfFarbe: Farbe.lime,
                       schliessen: { offenesBlatt = nil }, bestaetigen: { notiz in
                           Task {
                               beschaeftigt = true
                               let ok = await details.notizSenden(notiz, autor: autor)
                               beschaeftigt = false
                               if ok { offenesBlatt = nil }
                           }
                       }, beschaeftigt: beschaeftigt)
        case .schild:
            Abholschild(namen: details.gaeste) { offenesBlatt = nil }
        }
    }

    // MARK: - Karte und Routen

    private var fahrerOrt: CLLocationCoordinate2D? {
        if let p = ortung.letztePosition, abs(p.timestamp.timeIntervalSinceNow) < 120 { return p.coordinate }
        return details.standortDB
    }

    private var unterwegs: Bool {
        ["at_pickup", "beim_pickup", "beim pickup", "in_progress", "started", "unterwegs", "active", "ongoing",
         "on_trip", "done", "completed", "arrived"].contains((fahrt?.status ?? "").lowercased())
    }

    /// Neu rechnen, wenn sich Fahrt, Status oder (grob) der Standort aendert.
    private var routenSchluessel: String {
        let f = fahrerOrt.map { "\(Int($0.latitude * 200)),\(Int($0.longitude * 200))" } ?? "-"
        return "\(fahrt?.abholAdresse ?? "")|\(fahrt?.zielAdresse ?? "")|\(unterwegs)|\(details.fahrerNummer)|\(f)|\(details.tomtomFahrt.count)|\(details.tomtomAnfahrt.count)"
    }

    private func routenBerechnen() async {
        guard let fahrt else { return }
        let abholText = fahrt.abholAdresse.isEmpty ? fahrt.abholName : fahrt.abholAdresse
        let zielText = fahrt.zielAdresse.isEmpty ? fahrt.zielName : fahrt.zielAdresse
        async let abholAbfrage = Routen.punkt(fuer: abholText)
        async let zielAbfrage = Routen.punkt(fuer: zielText)
        // Eigener Ort: sein Pin (auf die Einfahrt gesetzt) statt der gesuchten Adresse.
        let abholGesucht = await abholAbfrage, zielGesucht = await zielAbfrage
        let abhol = orte.ort(fahrt.abholOrtID)?.punkt ?? abholGesucht
        let ziel = orte.ort(fahrt.zielOrtID)?.punkt ?? zielGesucht
        let fahrer = fahrerOrt
        var neu = KarteAnsicht.Inhalt()
        neu.ziel = ziel
        neu.fahrer = fahrer
        neu.fahrerNummer = details.fahrerNummer

        // Blaue Fahrt: bei Gast an Bord ab Fahrer, sonst ab Abholort.
        let fahrtStart = (unterwegs ? fahrer : nil) ?? abhol
        if let start = fahrtStart, let ziel {
            let s = await Routen.strecke(von: start, bis: ziel)
            // OSRM ausgefallen: gespeicherte TomTom-Linie zeigen (Fahrzeit kommt dann aus details.fahrzeitMin).
            neu.fahrt = s.punkte.count >= 2 ? s.punkte : details.tomtomFahrt
            neu.fahrtMinuten = s.minuten
            fahrtMinutenLive = s.minuten
        }
        if !unterwegs { neu.abholort = abhol }
        // Gelbe Anfahrt vom Fahrer zum Abholort, solange der Gast noch nicht eingestiegen ist.
        if !unterwegs, let fahrer, let abhol {
            let s = await Routen.strecke(von: fahrer, bis: abhol)
            let anfahrt = s.punkte.count >= 2 ? s.punkte : details.tomtomAnfahrt
            anfahrtVoll = anfahrt
            neu.anfahrt = anfahrt
            neu.anfahrtMinuten = s.minuten
        } else {
            anfahrtVoll = []
        }
        letzteNeuberechnung = Date()
        neu.flugzeug = istFlug ? details.flugPosition : nil
        neu.flugKurs = details.flugKurs
        neu.flugSpur = istFlug ? details.flugSpur : []
        neu.kollegen = kollegenAufKarte
        karte = neu
    }

    /// Kollegen nur im Zeitfenster ab 30 min vor Fahrtbeginn und solange die Fahrt laeuft.
    private var kollegenAufKarte: [KarteAnsicht.Kollege] {
        guard istKolonne, let fahrt else { return [] }
        let ende: Set<String> = ["done", "completed", "arrived", "beendet", "cancelled", "canceled", "refused", "storniert"]
        if ende.contains(fahrt.status.lowercased()) { return [] }
        let t = fahrt.etd.split(separator: ":").compactMap { Int($0) }
        guard t.count == 2 else { return [] }
        var k = Calendar.current.dateComponents([.year, .month, .day], from: Datum.ausTagWert(fahrt.fahrtDatum))
        k.hour = t[0]; k.minute = t[1]
        guard let beginn = Calendar.current.date(from: k), jetzt >= beginn.addingTimeInterval(-30 * 60) else { return [] }
        return details.kolonnenFahrer.compactMap { f in
            guard let ort = f.standort else { return nil }
            let kuerzel = f.name.split(separator: " ").compactMap(\.first).prefix(2).map(String.init).joined().uppercased()
            return KarteAnsicht.Kollege(ort: ort, beschriftung: f.nummer.isEmpty ? kuerzel : f.nummer, nummer: !f.nummer.isEmpty)
        }
    }

    private func flugAufKarte() {
        guard istFlug else { return }
        karte.flugzeug = details.flugPosition
        karte.flugKurs = details.flugKurs
        karte.flugSpur = details.flugSpur
    }

    /// Gefahrenen Teil der Anfahrt abschneiden; mehr als 200 m daneben -> neu rechnen (hoechstens alle 15 s).
    private func anfahrtKuerzen() {
        guard let fahrer = fahrerOrt else { return }
        karte.fahrer = fahrer
        guard !anfahrtVoll.isEmpty else { return }
        let ergebnis = Routen.abFahrer(anfahrtVoll, fahrer: fahrer)
        if ergebnis.abseits {
            if Date().timeIntervalSince(letzteNeuberechnung) > 15 { Task { await routenBerechnen() } }
        } else if let pfad = ergebnis.pfad, pfad.count >= 2 {
            karte.anfahrt = pfad
        }
    }

    // MARK: - Zeiten (etaBerechnung.js)

    private var fahrzeitMin: Int {
        if let live = fahrtMinutenLive, live > 0 { return live }
        return details.fahrzeitMin
    }

    private func eta(_ fahrt: Fahrt) -> String {
        if ["in_progress", "unterwegs", "started", "on_trip", "ongoing", "active"].contains(fahrt.status.lowercased()),
           let ankunft = details.liveAnkunft(jetzt) {
            return Datum.uhrzeit(ankunft)
        }
        let teile = fahrt.etd.split(separator: ":").compactMap { Int($0) }
        guard teile.count == 2 else { return "--:--" }
        var k = Calendar.current.dateComponents([.year, .month, .day], from: Datum.ausTagWert(fahrt.fahrtDatum))
        k.hour = teile[0]; k.minute = teile[1]
        guard let geplant = Calendar.current.date(from: k) else { return "--:--" }
        let start = geplant < jetzt && Calendar.current.isDate(geplant, inSameDayAs: jetzt) ? jetzt : geplant
        return Datum.uhrzeit(start.addingTimeInterval(Double(fahrzeitMin) * 60))
    }

    /// SoloFlughafen: ETA = ETD + Fahrzeit (addMinutesToTime).
    private func etaFlug(_ fahrt: Fahrt) -> String {
        let teile = fahrt.etd.split(separator: ":").compactMap { Int($0) }
        guard teile.count == 2 else { return "--:--" }
        let summe = teile[0] * 60 + teile[1] + fahrzeitMin
        return String(format: "%02d:%02d", (summe / 60) % 24, summe % 60)
    }

    /// getPlanOrFlightPhaseLabel: Flugphase nur bei Flughafenfahrt mit Statuscode.
    static func flugPhase(_ code: String, flughafen: Bool) -> String? {
        guard flughafen, !code.isEmpty else { return nil }
        let texte = ["CD": "cancelled", "DP": "departed", "LD": "landed", "RT": "rerouted", "NA": "no status"]
        return texte[code] ?? code
    }

    private func fahrDauerText(_ fahrt: Fahrt) -> String {
        fahrzeitMin > 0 ? "-\(KarteAnsicht.Koordinator.dauer(fahrzeitMin)) Fahrt" : "- min Fahrt"
    }

    // MARK: - Hilfen

    static func ortArt(_ name: String, _ adresse: String) -> String {
        let t = (name + " " + adresse).lowercased()
        if t.range(of: #"\b(flughafen|airport|terminal|muc|fra|ber|ham|dus|str|cgn)\b"#, options: .regularExpression) != nil { return "Flughafen" }
        if t.range(of: #"\b(hotel|resort|hostel|inn|motel|guesthouse|suite|aparthotel|residence)\b"#, options: .regularExpression) != nil { return "Hotel" }
        return "Adresse"
    }

    static func icon(_ text: String, start: Bool) -> String {
        let t = text.lowercased()
        if t.contains("muc") || t.contains("flughafen") || t.contains("airport") || t.contains("terminal") {
            return start ? "Plain_Landen_Trisar_Icons_01_grau" : "Plain_Abflug_Trisar_Icons_01_grau"
        }
        if t.range(of: #"\b(hotel|resort|hostel|inn|motel|guesthouse|suite|aparthotel|residence)\b"#, options: .regularExpression) != nil {
            return "House_Nav_Trisar_01_grau"
        }
        return "Pin_Nav_Trisar_Icons_01_grau"
    }

    static func merkmalIcon(_ m: String) -> String {
        switch m {
        case "vip": return "Stern_Trisar_Icon_01_Lime"
        case "child": return "Kind_Trisar_Icons_01_Lime"
        case "luggage": return "Gepäck_viel_Trisar_Icons_01_Lime"
        default: return "Rollstuhl_Trisar_Icons_01_Lime"
        }
    }

    /// getRouteNavigationUrl: Abholort als Zwischenziel, Ziel als Endpunkt.
    static func navigationsURL(_ fahrt: Fahrt) -> URL? {
        // Bei eigenen Orten nur die Adresse: Maps kennt Namen wie "Mercedes Event Location" nicht.
        let abhol = Adresse.fuerNavigation(name: fahrt.abholOrtID != nil && !fahrt.abholAdresse.isEmpty ? "" : fahrt.abholName,
                                           adresse: fahrt.abholAdresse)
        let ziel = Adresse.fuerNavigation(name: fahrt.zielOrtID != nil && !fahrt.zielAdresse.isEmpty ? "" : fahrt.zielName,
                                          adresse: fahrt.zielAdresse)
        guard !abhol.isEmpty || !ziel.isEmpty else { return nil }
        var teile = URLComponents(string: "https://www.google.com/maps/dir/")!
        var q: [URLQueryItem] = [.init(name: "api", value: "1"), .init(name: "travelmode", value: "driving")]
        if !abhol.isEmpty && !ziel.isEmpty {
            q.append(.init(name: "waypoints", value: abhol))
            q.append(.init(name: "destination", value: ziel))
        } else {
            q.append(.init(name: "destination", value: ziel.isEmpty ? abhol : ziel))
        }
        teile.queryItems = q
        return teile.url
    }
}

extension Adresse {
    /// adresseNormal: Hausnummer hinter die Strasse.
    static func normal(_ text: String) -> String {
        let teile = text.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
        if teile.count > 1, teile[0].range(of: #"^\d+\s?[a-zA-Z]?(\s*[-/]\s*\d+\s?[a-zA-Z]?)?$"#, options: .regularExpression) != nil {
            return (["\(teile[1]) \(teile[0])"] + teile.dropFirst(2)).joined(separator: ", ")
        }
        return teile.joined(separator: ", ")
    }

    /// adresseFuerNavigation der Web-App.
    static func fuerNavigation(name: String, adresse: String) -> String {
        let n = name.trimmingCharacters(in: .whitespaces)
        let a = normal(adresse)
        if n.isEmpty { return a }
        if a.isEmpty { return normal(n) }
        if a.lowercased().contains(n.lowercased()) || a.lowercased() == normal(n).lowercased() { return a }
        return "\(n), \(a)"
    }
}

// MARK: - Bausteine

private struct OrtKachel: View {
    let name: String
    var body: some View {
        Image(name).resizable().scaledToFit().frame(width: 30, height: 30)
            .frame(width: 64, height: 64)
            .background(Color(hex: 0x242525))
            .clipShape(RoundedRectangle(cornerRadius: 16))
    }
}

private struct OrtText: View {
    let art: String
    let name: String
    let url: URL?
    let rechts: Bool
    @Environment(\.openURL) private var oeffnen

    var body: some View {
        VStack(alignment: rechts ? .trailing : .leading, spacing: 0) {
            Text(art).grotesk(14, .bold, abstand: -0.5).foregroundStyle(Farbe.grauText)
            Button {
                if let url { oeffnen(url) }
            } label: {
                Text(name)
                    .font(.grotesk(18, .bold)).tracking(-0.5)
                    .foregroundStyle(.white)
                    .underline(url != nil, color: Color(hex: 0xE2F754))
                    .multilineTextAlignment(rechts ? .trailing : .leading)
                    .lineSpacing(18 * 1.15 - 18 * 1.276 > 0 ? 18 * 1.15 - 18 * 1.276 : 0)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .buttonStyle(.web)
        }
        .frame(maxWidth: .infinity, alignment: rechts ? .trailing : .leading)
    }
}

/// Knopf im Blatt: farbig, Text links (16 medium, neutral-800), dunkler Pfeil rechts.
private struct AktionsKnopf: View {
    let text: String
    let farbe: Color
    let aktion: () -> Void
    var body: some View {
        Button(action: aktion) {
            HStack {
                Text(text).font(.grotesk(16, .medium)).tracking(0.5).foregroundStyle(Color(hex: 0x262626))
                Spacer()
                Image("PfeilDunkel").resizable().frame(width: 34, height: 20)
            }
            .padding(.leading, 16).padding(.trailing, 12)
            .frame(maxWidth: .infinity).frame(height: 56)
            .background(farbe)
        }
        .buttonStyle(.web)
    }
}

/// Zurueck auf der Karte: schwarzer Kreis 50 mit Backbutton_Karte, Schatten.
private struct KarteZurueck: View {
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

/// Abholschild.jsx: Gaestenamen gross, quer gedreht, Tipp dreht um 180 Grad.
struct Abholschild: View {
    let namen: [String]
    let schliessen: () -> Void
    @State private var umgedreht = false

    var body: some View {
        GeometryReader { geo in
            let lang = max(geo.size.width, geo.size.height), kurz = min(geo.size.width, geo.size.height)
            let laengster = CGFloat(max(1, namen.map(\.count).max() ?? 1))
            let zeilen = CGFloat(max(1, namen.count))
            let groesse = min(lang * 1.5 / laengster, kurz * 0.72 / zeilen, 160)
            ZStack {
                Color.black
                VStack(spacing: groesse * 0.15) {
                    ForEach(Array(namen.enumerated()), id: \.offset) { _, name in
                        Text(name).font(.grotesk(groesse, .bold)).tracking(-0.04 * groesse)
                            .foregroundStyle(Color(hex: 0xE2F754))
                            .lineLimit(1).minimumScaleFactor(0.3)
                            .padding(.horizontal, groesse * 0.3)
                    }
                }
                .frame(width: lang, height: kurz)
                .rotationEffect(.degrees((geo.size.width > geo.size.height ? 0 : -90) + (umgedreht ? 180 : 0)))
            }
            .frame(width: geo.size.width, height: geo.size.height)
            .contentShape(Rectangle())
            .onTapGesture { umgedreht.toggle() }
            .overlay(alignment: .topTrailing) {
                Button(action: schliessen) {
                    Text("×").font(.system(size: 30)).foregroundStyle(Color(hex: 0xE2F754))
                        .frame(width: 50, height: 50)
                        .overlay(Circle().stroke(Color(hex: 0x747474), lineWidth: 1))
                }
                .padding(.trailing, 16).padding(.top, 60)
            }
        }
        .ignoresSafeArea()
    }
}

/// ConvoyDriverPopup: Profilbild, Name, Kennzeichen, Fahrzeug, „Name anrufen“.
struct KollegenKarte: View {
    let fahrer: FahrtDetails.KolonnenFahrer
    let schliessen: () -> Void
    @Environment(\.openURL) private var oeffnen

    var body: some View {
        let vorname = fahrer.name.split(separator: " ").first.map(String.init) ?? "Fahrer"
        let telefon = fahrer.telefon.replacingOccurrences(of: #"[\s()\-]"#, with: "", options: .regularExpression)
        ZStack {
            Color.black.opacity(0.95).ignoresSafeArea().onTapGesture(perform: schliessen)
            VStack(alignment: .leading, spacing: 0) {
                Button(action: schliessen) {
                    Image("Arrow_Trisar_Icons_01_Lime").resizable().scaledToFit()
                        .frame(width: 29, height: 18).rotationEffect(.degrees(180))
                        .frame(width: 54, height: 54)
                        .background(Circle().fill(Color.black.opacity(0.85)))
                        .overlay(Circle().stroke(Color(hex: 0xE3F654), lineWidth: 2))
                }
                .buttonStyle(.web)
                .zurueckPerWischen(schliessen)
                .padding(.bottom, 18)

                VStack(spacing: 0) {
                    Group {
                        if let url = FahrzeugKarte.bildURL(fahrer.bild) {
                            AsyncImage(url: url) { phase in
                                if let bild = phase.image { bild.resizable().scaledToFill() } else { personBild }
                            }
                        } else { personBild }
                    }
                    .frame(width: 138, height: 138)
                    .background(Color(hex: 0x1F2023))
                    .clipped()
                    Text(fahrer.name).grotesk(30, .bold).foregroundStyle(Color(hex: 0xE3F654))
                        .multilineTextAlignment(.center).padding(.top, 18)
                    Text(fahrer.kennzeichen.isEmpty ? "-" : fahrer.kennzeichen).grotesk(30, .bold)
                        .foregroundStyle(Color(hex: 0xD6D6D6)).padding(.top, 18)
                    Text(fahrer.fahrzeug.isEmpty ? "-" : fahrer.fahrzeug).grotesk(20)
                        .foregroundStyle(Color(hex: 0xD6D6D6))
                }
                .padding(.vertical, 18)
                .frame(maxWidth: .infinity)
                .background(Color.black)
                .overlay(Rectangle().strokeBorder(Color(hex: 0xE3F654), lineWidth: 2))

                Button {
                    if !telefon.isEmpty, let url = URL(string: "tel:\(telefon)") { oeffnen(url) }
                } label: {
                    ZStack {
                        Text("\(vorname) anrufen").font(.grotesk(16, .medium))
                            .foregroundStyle(telefon.isEmpty ? Color(hex: 0x5F6130) : Color(hex: 0x1D1C1D))
                        HStack {
                            Spacer()
                            Image("contact-phone").resizable().frame(width: 22, height: 22)
                        }
                        .padding(.trailing, 14)
                    }
                    .frame(maxWidth: .infinity).frame(height: 48)
                    .background(Color(hex: 0xE3F654))
                }
                .buttonStyle(.web)
                .disabled(telefon.isEmpty)
                .padding(.top, 18)
            }
            .frame(maxWidth: 362)
            .padding(.horizontal, 20)
        }
    }

    private var personBild: some View {
        Image("Person_Trisar_Icons_01").resizable().scaledToFit().frame(width: 82, height: 82).opacity(0.75)
    }
}
