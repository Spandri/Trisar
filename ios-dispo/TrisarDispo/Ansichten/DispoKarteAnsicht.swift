import CoreLocation
import SwiftUI

/// Live-Karte der Dispo (KartenView.jsx, Live-Zweig): Fahrer mit Zustand und Zuendung, Schnellfilter
/// Aktiv/Inaktiv/Frei (lang auf Inaktiv = Inaktiv-Fenster), Fahrerblatt mit naechster Fahrt,
/// Fahrerprofil mit Fahrzeugdaten und der Karten-Filter (KartenFilterView.jsx).
struct DispoKarteAnsicht: View {
    let zeigen: (DispoZiel) -> Void

    @StateObject private var daten = KartenDaten()
    @ObservedObject private var filter = KartenFilter.geteilt
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

    // Masse im Web-Raster (NAV_BLOCK_OFFSET_PX, SHEET_MAX_TOP_GAP_PX, SHEET_PEEK_PX).
    static let blattUnten: CGFloat = 120
    /// Oberkante der Navileiste ueber dem unteren Rand: 79 (Abstand + Fussleiste) + 131 - 32.
    static let leisteOben: CGFloat = 178
    static let blattMin: CGFloat = max(34, (leisteOben - blattUnten) + 34)

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

    private var gefiltert: [KartenFahrer] { passendeFahrer.filter { schnellFilter.contains($0.zustand) } }

    private var gewaehlt: KartenFahrer? { gefiltert.first { $0.id == gewaehltID } }

    private var zaehler: [FahrerZustand: Int] {
        Dictionary(grouping: passendeFahrer, by: \.zustand).mapValues(\.count)
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
                    fahrer: gefiltert, gewaehlt: gewaehlt, route: route,
                    blattHoehe: gewaehlt == nil ? 0 : min(max(blatt, Self.blattMin), blattMax),
                    rasterHoehe: rasterHoehe, massstab: s, einpassenSignal: einpassen,
                    waehlen: fahrerTippen, leerTippen: auswahlAufheben, abseits: abseitsGemeldet
                )
                .frame(width: geo.size.width, height: geo.size.height)

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
                        .transition(.opacity)
                }

                Navileiste(aktiv: .karte) { ziel in
                    if ziel == .karte { kartenTipp() } else { zeigen(ziel) }
                }

                if filterOffen {
                    KartenFilterAnsicht(filter: filter, zurueck: { filterOffen = false })
                        .transition(.opacity)
                }
            }
            .frame(width: geo.size.width, height: geo.size.height)
        }
        .ignoresSafeArea()
        .background(Color(hex: 0x0E0E0E).ignoresSafeArea())
        .animation(.easeOut(duration: 0.15), value: filterOffen)
        .animation(.easeOut(duration: 0.15), value: profilOffen)
        .task { await daten.starten() }
        .onDisappear { Task { await daten.beenden() } }
        .task(id: routenAufgabe) { await routeBerechnen() }
        .onChange(of: gefiltert.map(\.id)) { _, ids in
            if let id = gewaehltID, !ids.contains(id) { gewaehltID = nil }
        }
        .onChange(of: gewaehltID) { _, _ in profilOffen = false }
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
            .buttonStyle(.plain)
            .accessibilityLabel("Zurück")
            .platz(20, 60, 50, 50)

            Button { filterOffen = true } label: {
                Image("karten-layer-button").resizable().frame(width: 50, height: 50)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Filter")
            .platz(402 - 20 - 50, 60, 50, 50)

            SchnellFilterLeiste(zaehler: zaehler, gewaehlt: schnellFilter, umschalten: schnellFilterUmschalten) {
                zeigeFenster.toggle()
            }
            .mittig(201, 142, 362, 44)

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
                FahrerBlatt(fahrer: f, hoehe: $blatt, zieht: $ziehtBlatt, minimum: Self.blattMin, maximum: blattMax) {
                    profilOffen = true
                }
                .frame(width: 402, height: hoehe)
                .platz(0, rasterHoehe - Self.blattUnten - hoehe, 402, hoehe)
                .animation(ziehtBlatt ? nil : .easeOut(duration: 0.3), value: blatt)
            }
        }
    }

    // MARK: Aktionen

    /// Zweiter Tipp auf denselben Fahrer hebt den Fokus wieder auf.
    private func fahrerTippen(_ id: String) {
        gewaehltID = gewaehltID == id ? nil : id
        fahrtMinuten = nil
        blatt = Self.blattMin
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
            .buttonStyle(.plain)
            .accessibilityLabel("Inaktiv-Slider schließen")
            .padding(.top, 2).padding(.trailing, 2)
        }
    }
}

// MARK: - Fahrerblatt (ActiveRideSheet)

private struct FahrerBlatt: View {
    let fahrer: KartenFahrer
    @Binding var hoehe: CGFloat
    @Binding var zieht: Bool
    let minimum: CGFloat
    let maximum: CGFloat
    let profilOeffnen: () -> Void
    @State private var startHoehe: CGFloat = 0
    @State private var bewegt = false

    /// Unterkante des Namensblocks: Griff 42 + Markieren 56 + 12 + Kennzeichen 70 + 12 + Name 96.
    private var nameRast: CGFloat { min(max(288, minimum), maximum) }

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
            // Markieren ist im Web noch ohne Funktion.
            HStack(spacing: 10) {
                Text("Markieren").grotesk(32, .bold, abstand: -0.5).foregroundStyle(Self.lime)
                Image("Stern_Trisar_Icon_01_schwarz").resizable().frame(width: 17, height: 18)
            }
            .frame(width: 362, height: 56)
            .overlay(Rectangle().strokeBorder(Self.lime, lineWidth: 2))

            VStack(spacing: 4) {
                Text(fahrer.kennzeichen).grotesk(30, .bold, abstand: -0.8).foregroundStyle(Color(hex: 0x1D1C1D)).frame(height: 30)
                Text(fahrer.fahrzeug).grotesk(16, .bold, abstand: -0.5).foregroundStyle(Color(hex: 0x1D1C1D).opacity(0.35)).frame(height: 16)
            }
            .lineLimit(1)
            .padding(.vertical, 10)
            .frame(width: 362)
            .background(Color.white)
            .padding(.top, 12)

            VStack(alignment: .leading, spacing: 5) {
                Button(action: profilOeffnen) {
                    Text(fahrer.name).grotesk(30, .bold, abstand: -0.8).foregroundStyle(Color(hex: 0x1D1C1D))
                        .lineLimit(1).truncationMode(.tail).frame(height: 30)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                .buttonStyle(.plain)
                Button { anrufen(fahrer.telefon) } label: {
                    Text(fahrer.telefon).grotesk(16, .bold, abstand: 0.4).foregroundStyle(Color(hex: 0x1D1C1D)).frame(height: 24)
                }
                .buttonStyle(.plain)
            }
            .padding(.horizontal, 18)
            .frame(width: 362, height: 96, alignment: .leading)
            .background(Self.lime)
            .clipped()
            .padding(.top, 12)

            Text("Nächste Fahrt").grotesk(22, .bold, abstand: -1).foregroundStyle(Self.lime).frame(height: 21)
                .padding(.top, 36)

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

            zeitPaar(links: ("Dienststart", info.dienststart), rechts: ("Dienstende", info.dienstende), unterRechts: nil)
                .padding(.top, 24)
                .padding(.bottom, 30)
        }
    }

    private func fahrText(_ info: KartenFahrtInfo) -> String {
        if info.fahrMinuten > 0 { return "-\(info.fahrMinuten) min Fahrt" }
        if info.unterwegs && info.ankunft != "--:--" { return "-<1 min Fahrt" }
        return "- min Fahrt"
    }

    private func zeitPaar(links: (String, String), rechts: (String, String), unterRechts: String?) -> some View {
        HStack(alignment: .top, spacing: 24) {
            VStack(alignment: .leading, spacing: 8) {
                Text(links.0).grotesk(12, .bold, abstand: -0.3).foregroundStyle(Self.grau).frame(height: 12)
                Text(links.1).grotesk(42, .bold, abstand: -1).foregroundStyle(Self.lime).frame(height: 38)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            VStack(alignment: .trailing, spacing: 0) {
                Text(rechts.0).grotesk(12, .bold, abstand: -0.3).foregroundStyle(Self.grau).frame(height: 12)
                Text(rechts.1).grotesk(42, .bold, abstand: -1).foregroundStyle(Self.lime).frame(height: 38).padding(.top, 8)
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
                .buttonStyle(.plain)
                .accessibilityLabel("Zurück")
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
                .buttonStyle(.plain)
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
