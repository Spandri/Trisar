import PhotosUI
import Supabase
import SwiftUI

/// Fahrzeug-Bereich der Dispo: Liste (FahrzeugeView.jsx), Filter (FahrzeugFilterView.jsx),
/// Anlegen/Bearbeiten (FahrzeugErstellenView.jsx). Seitenwechsel wie setView in App.jsx.
struct FahrzeugBereichAnsicht: View {
    let zeigen: (DispoZiel) -> Void
    @State private var seite: Seite = .liste
    @ObservedObject private var filter = FahrzeugFilterAblage.geteilt

    enum Seite: Hashable { case liste, filter, erstellen, bearbeiten(StammFahrzeug) }

    var body: some View {
        Group {
            switch seite {
            case .liste:
                FahrzeugListeSeite(zeigen: zeigen, filter: filter,
                                   filterOeffnen: { seite = .filter },
                                   erstellen: { seite = .erstellen },
                                   bearbeiten: { seite = .bearbeiten($0) })
            case .filter:
                FahrzeugFilterSeite(filter: filter, zurueck: { seite = .liste })
            case .erstellen:
                FahrzeugFormularSeite(fahrzeug: nil, zurListe: { seite = .liste })
            case let .bearbeiten(f):
                FahrzeugFormularSeite(fahrzeug: f, zurListe: { seite = .liste })
            }
        }
        .id(seite)
    }
}

// MARK: - Liste

/// Fahrzeug, das nach einem Tipp auf eine Mitteilung direkt geoeffnet werden soll.
@MainActor enum FahrzeugSprung { static var id: String? }

struct FahrzeugListeSeite: View {
    let zeigen: (DispoZiel) -> Void
    @ObservedObject var filter: FahrzeugFilterAblage
    let filterOeffnen: () -> Void
    let erstellen: () -> Void
    let bearbeiten: (StammFahrzeug) -> Void
    @StateObject private var dienst = FahrzeugeDienst()
    @FocusState private var suchFokus: Bool

    var body: some View {
        let liste = filter.anwenden(dienst.fahrzeuge)
        ZStack(alignment: .topLeading) {
            Leinwand(basisHoehe: 874, inhaltHoehe: 354 + listenHoehe(liste.count) + 157, mitHintergrund: false) { rahmen in
                ZStack(alignment: .topLeading) {
                    DispoHintergrund().frame(width: 402, height: rahmen)
                    ZurueckKnopf { zeigen(.start) }.platz(20, 60, 50, 50)
                    Button(action: filterOeffnen) {
                        Image("karten-layer-button").resizable().frame(width: 50, height: 50)
                    }
                    .buttonStyle(.web)
                    .accessibilityLabel("Filter")
                    .platz(332, 60, 50, 50)

                    StammTitel(text: "Fahrzeuge").platz(20, 140)
                        .onChange(of: dienst.fahrzeuge.map(\.id), initial: true) { _, _ in
                            guard let ziel = FahrzeugSprung.id,
                                  let f = dienst.fahrzeuge.first(where: { $0.id == ziel }) else { return }
                            FahrzeugSprung.id = nil
                            bearbeiten(f)
                        }

                    StammZeilenKnopf(text: "Fahrzeug erstellen", icon: "vehicle-car-small", aktion: erstellen)
                        .platz(20, 206, 362, 56)

                    suchfeld.platz(20, 274, 362, 56)

                    VStack(alignment: .leading, spacing: 12) {
                        if dienst.laedt {
                            Text("Fahrzeuge werden geladen ...").font(.grotesk(16, .medium)).foregroundStyle(Color(hex: 0xE3F654))
                        }
                        if !dienst.laedt && !dienst.fehler.isEmpty {
                            WebText(text: "Fahrzeuge konnten nicht geladen werden: \(dienst.fehler)", groesse: 13, gewicht: .medium,
                                    zeilenHoehe: 13 * 1.4, farbe: UIColor(hex: 0xFF8E8E))
                                .padding(16)
                                .frame(width: 362, alignment: .leading)
                                .background(Color(hex: 0x171717))
        .overlay(Rectangle().strokeBorder(Color(hex: 0x3A3A3A), lineWidth: 1))
                        }
                        if !dienst.laedt && dienst.fehler.isEmpty && liste.isEmpty {
                            Text("Keine Fahrzeuge gefunden.").font(.grotesk(16, .medium)).foregroundStyle(Color(hex: 0xE3F654))
                        }
                        ForEach(liste) { f in
                            Button { bearbeiten(f) } label: { FahrzeugListenKarte(fahrzeug: f) }
                                .buttonStyle(.web)
                        }
                    }
                    .platz(20, 354, 362, nil)
                }
            }
            Navileiste(aktiv: .fahrzeuge, waehlen: zeigen)
        }
        .task {
            await dienst.laden()
            await dienst.beobachten()
        }
        .onDisappear { Task { await dienst.beenden() } }
    }

    /// Hoehe der Liste im Raster, damit die Leinwand weit genug scrollt.
    private func listenHoehe(_ anzahl: Int) -> CGFloat {
        var bloecke: [CGFloat] = []
        if dienst.laedt { bloecke.append(21) }
        if !dienst.laedt && !dienst.fehler.isEmpty { bloecke.append(90) }
        if !dienst.laedt && dienst.fehler.isEmpty && anzahl == 0 { bloecke.append(21) }
        bloecke += Array(repeating: 128, count: anzahl)
        return bloecke.reduce(0, +) + CGFloat(max(0, bloecke.count - 1)) * 12
    }

    private var suchfeld: some View {
        HStack(spacing: 0) {
            TextField("", text: $filter.suche, prompt: Text(verbatim: "Fahrzeug Suchen").foregroundStyle(Color(hex: 0xE3F654)))
                .font(.grotesk(16, .medium))
                .foregroundStyle(Color(hex: 0xE3F654))
                .tint(Color(hex: 0xE3F654))
                .autocorrectionDisabled()
                .textInputAutocapitalization(.never)
                .focused($suchFokus)
            if !filter.suche.trimmingCharacters(in: .whitespaces).isEmpty {
                Button { filter.suche = "" } label: {
                    Image("clear-field-green").resizable().frame(width: 20, height: 20).frame(width: 24, height: 24)
                }
                .buttonStyle(.web)
                .accessibilityLabel("Suche zurücksetzen")
            } else {
                Image("vehicle-search").resizable().frame(width: 24, height: 24)
            }
        }
        .padding(.horizontal, 16)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .overlay(Rectangle().strokeBorder(Color(hex: 0xE3F654), lineWidth: 2))
    }
}

/// VehicleCard aus FahrzeugeView.jsx: weiss 362 x 128, Bild links, Kennzeichen und Kacheln (36) rechts.
struct FahrzeugListenKarte: View {
    let fahrzeug: StammFahrzeug

    var body: some View {
        ZStack(alignment: .topLeading) {
            Color.white
            Color(hex: 0xECECEC).platz(6, 38, 150, 74)
            if !fahrzeug.imageUrl.isEmpty {
                StammBild(quelle: fahrzeug.imageUrl).platz(6, 38, 150, 74)
            }
            (Text("VIN  ").bold() + Text(fahrzeug.vinLabel).kerning(2))
                .font(.grotesk(12))
                .foregroundStyle(Color(red: 29 / 255, green: 28 / 255, blue: 29 / 255, opacity: 0.2))
                .lineLimit(1)
                .platz(0, 10, 362, nil, .top)
            WebText(text: fahrzeug.plate, groesse: 30, gewicht: .bold, zeilenHoehe: 32, abstand: -0.5, farbe: UIColor(hex: 0x1D1C1D))
                .fixedSize()
                .platz(170, 38)
            HStack(spacing: 6) {
                kachel(KraftstoffKachel(kraftstoff: fahrzeug.fuelType))
                kachel(FarbKachel(farbe: fahrzeug.color))
                kachel(EnergieKachel(kraftstoff: fahrzeug.fuelType, fuellstand: fahrzeug.fill, reichweite: fahrzeug.range))
                kachel(SitzKachel(sitze: fahrzeug.seatCount))
            }
            .platz(170, 76)
        }
        .frame(width: 362, height: 128)
        .clipped()
        .contentShape(Rectangle())
    }

    /// Die Kacheln sind fuer 52 gebaut, die Admin-Liste zeigt sie in 36 (BadgeFrame skaliert alles).
    private func kachel<K: View>(_ k: K) -> some View {
        k.scaleEffect(36 / 52).frame(width: 36, height: 36)
    }
}

// MARK: - Filter

struct FahrzeugFilterSeite: View {
    @ObservedObject var filter: FahrzeugFilterAblage
    let zurueck: () -> Void

    private static let sortierungen = [("plate", "Kennzeichen"), ("model", "Modell"), ("fill", "Füllstand"), ("seats", "Sitzplätze")]

    var body: some View {
        Leinwand(basisHoehe: 874, inhaltHoehe: 834 + 70, mitHintergrund: false) { rahmen in
            ZStack(alignment: .topLeading) {
                DispoHintergrund().frame(width: 402, height: max(rahmen, 904))
                ZurueckKnopf(aktion: zurueck).platz(20, 60, 50, 50)
                StammTitel(text: "Fahrzeug Filter").platz(20, 140)

                abschnitt("Karosserie", 206)
                knopf("Limosine", filter.limosine) { filter.limosine.toggle() }.platz(20, 230, 175, 40)
                knopf("SUV", filter.suv) { filter.suv.toggle() }.platz(207, 230, 175, 40)
                knopf("VAN", filter.van) { filter.van.toggle() }.platz(20, 282, 175, 40)
                knopf("Coupe", filter.coupe) { filter.coupe.toggle() }.platz(207, 282, 175, 40)

                abschnitt("Sortieren nach", 346)
                ForEach(Array(Self.sortierungen.enumerated()), id: \.offset) { i, s in
                    knopf(s.1, filter.sortierung == s.0) { filter.sortierung = s.0 }
                        .platz(i % 2 == 0 ? 20 : 207, 370 + CGFloat(i / 2) * 52, 175, 40)
                }
                knopf("A – Z", !filter.absteigend) { filter.absteigend = false }.platz(20, 486, 175, 40)
                knopf("Z – A", filter.absteigend) { filter.absteigend = true }.platz(207, 486, 175, 40)

                StammZeilenKnopf(text: "Filter speichern", icon: "Arrow_Trisar_Icons_01",
                                 iconGroesse: CGSize(width: 34, height: 20), innen: 12, aktion: zurueck)
                    .overlay(Rectangle().strokeBorder(Color(hex: 0xE3F654), lineWidth: 2))
                    .platz(20, 550, 362, 56)
                StammZeilenKnopf(text: "Filter Löschen", icon: "Arrow_Nav_Trisar_Icons_01",
                                 iconGroesse: CGSize(width: 34, height: 20), hintergrund: 0xFF6B6B, innen: 12) { filter.zuruecksetzen() }
                    .platz(20, 618, 362, 56)
            }
        }
        .overlay { FussleisteUnten() }
    }

    private func abschnitt(_ text: String, _ y: CGFloat) -> some View {
        Text(text).font(.grotesk(13, .medium)).tracking(0.5)
            .foregroundStyle(Color(hex: 0xE3F654).opacity(0.6))
            .frame(height: 16)
            .platz(20, y, 362, 16, .leading)
    }

    /// TwoColButton: 175 x 40, Lime-Rahmen, aktiv gefuellt.
    private func knopf(_ text: String, _ aktiv: Bool, _ aktion: @escaping () -> Void) -> some View {
        Button(action: aktion) {
            Text(text).font(.grotesk(16, .medium)).tracking(0.4)
                .foregroundStyle(aktiv ? Color(hex: 0x1D1C1D) : Color(hex: 0xE3F654))
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(aktiv ? Color(hex: 0xE3F654) : .clear)
                .overlay(Rectangle().strokeBorder(Color(hex: 0xE3F654), lineWidth: 2))
                .contentShape(Rectangle())
        }
        .buttonStyle(.web)
    }
}

// MARK: - Anlegen / Bearbeiten

struct FahrzeugFormularSeite: View {
    let fahrzeug: StammFahrzeug?
    let zurListe: () -> Void

    @State private var markeModell = ""
    @State private var variante = ""
    @State private var vin = ""
    @State private var kennzeichen = ""
    @State private var farbe = ""
    @State private var sitze = ""
    @State private var kraftstoff = ""
    @State private var bildURL = ""
    @State private var speichert = false
    @State private var rueckmeldung = ""
    @State private var bildWaehlen = false
    @State private var bildAuswahl: PhotosPickerItem?
    @FocusState private var fokus: Feld?
    /// Hoehe des Schadensberichts (nur beim Bearbeiten), die Seite waechst mit.
    @State private var schadenHoehe: CGFloat = 0

    private enum Feld: Hashable { case markeModell, variante, vin, kennzeichen, farbe, sitze }

    /// FUEL_TYPES: gespeichert wird genau dieser Text (steuert die EV-Erkennung der Planung).
    private static let kraftstoffe = ["E10", "Super 95", "Super Plus", "Diesel B7", "Diesel B10", "Elektro", "Plug-in-Hybrid"]

    private var bearbeiten: Bool { !(fahrzeug?.id ?? "").isEmpty }

    var body: some View {
        Leinwand(basisHoehe: 874, inhaltHoehe: bearbeiten ? max(913, 842 + schadenHoehe + 70) : 913, mitHintergrund: false) { rahmen in
            ZStack(alignment: .topLeading) {
                DispoHintergrund().frame(width: 402, height: max(rahmen, 913))
                ZurueckKnopf(aktion: zurListe).platz(20, 60, 50, 50)

                StammTitel(text: bearbeiten ? "Fahrzeug bearbeiten" : "Fahrzeug erstellen",
                           groesse: bearbeiten ? 36 : 42, abstand: -0.5, farbe: 0xE2F754)
                    .platz(20, 140)

                BoxFeld(platzhalter: "Marke & Modell", wert: $markeModell, fokus: $fokus, art: .markeModell, grossschreibung: .words)
                    .platz(20, 206, 178, 56)
                BoxFeld(platzhalter: "Modell Variante", wert: $variante, fokus: $fokus, art: .variante, grossschreibung: .words)
                    .platz(204, 206, 178, 56)
                BoxFeld(platzhalter: "VIN", wert: $vin, fokus: $fokus, art: .vin, grossschreibung: .characters)
                    .platz(20, 274, 362, 56)
                BoxFeld(platzhalter: "Kennzeichen", wert: $kennzeichen, fokus: $fokus, art: .kennzeichen, grossschreibung: .characters)
                    .platz(20, 342, 362, 56)
                BoxFeld(platzhalter: "Farbe", wert: $farbe, fokus: $fokus, art: .farbe)
                    .platz(20, 410, 362, 56)
                BoxFeld(platzhalter: "Beifahreranzahl", wert: $sitze, fokus: $fokus, art: .sitze, tastatur: .numberPad)
                    .platz(20, 478, 362, 56)
                    .onChange(of: sitze) { _, neu in
                        let nurZiffern = neu.filter(\.isNumber)
                        if nurZiffern != neu { sitze = nurZiffern }
                    }
                kraftstoffWahl.platz(20, 546, 362, 56)
                bildFeld.platz(20, 614, 362, 56)

                Button(action: speichern) {
                    Text(speichert ? "Speichern ..." : (bearbeiten ? "Fahrzeug speichern" : "Fahrzeug erstellen"))
                        .font(.grotesk(16, .medium)).tracking(0.5)
                        .foregroundStyle(Color(hex: 0x0E1008))
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .background(Color(hex: 0xDBEE4A))
                        .opacity(speichert ? 0.7 : 1)
                }
                .buttonStyle(.web)
                .disabled(speichert)
                .platz(20, 694, 362, 56)

                WebText(text: rueckmeldung.isEmpty
                        ? (bearbeiten ? "Fahrzeugdaten ändern und speichern." : "Fahrzeugdaten eintragen und speichern.")
                        : rueckmeldung,
                        groesse: 12, zeilenHoehe: 12 * 1.3, farbe: UIColor(hex: 0xC8D85D))
                    .padding(.horizontal, 12).padding(.vertical, 8)
                    .frame(width: 362, alignment: .topLeading)
                    .frame(minHeight: 56, alignment: .topLeading)
                    .overlay(Rectangle().strokeBorder(Color(hex: 0x7F8A2B), lineWidth: 1))
                    .platz(20, 762, 362, nil)

                if bearbeiten, let id = fahrzeug?.id {
                    SchadensBerichtDispo(fahrzeugID: id)
                        .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { schadenHoehe = $0 }
                        .platz(20, 842, 362, nil)
                }
            }
        }
        .overlay { FussleisteUnten() }
        .photosPicker(isPresented: $bildWaehlen, selection: $bildAuswahl, matching: .images)
        .onChange(of: bildAuswahl) { _, neu in Task { await bildUebernehmen(neu) } }
        .onAppear(perform: uebernehmen)
    }

    /// Select mit festen Kraftstoffen, ein abweichender gespeicherter Wert bleibt waehlbar.
    private var kraftstoffWahl: some View {
        Menu {
            ForEach(Self.kraftstoffe + (kraftstoff.isEmpty || Self.kraftstoffe.contains(kraftstoff) ? [] : [kraftstoff]), id: \.self) { k in
                Button(k) { kraftstoff = k }
            }
        } label: {
            ZStack(alignment: .leading) {
                Rectangle().strokeBorder(Color(hex: 0xE3F654), lineWidth: 2)
                Text(kraftstoff.isEmpty ? "Antrieb / Kraftstoff" : kraftstoff)
                    .font(.grotesk(16, .medium)).tracking(0.5)
                    .foregroundStyle(Color(hex: 0x8A9728))
                    .opacity(kraftstoff.isEmpty ? 0.9 : 1)
                    .padding(.leading, 16)
                Image("Arrow-kurz_Trisar_Icons_01_Lime").resizable().frame(width: 10, height: 13)
                    .rotationEffect(.degrees(90))
                    .frame(maxWidth: .infinity, alignment: .trailing)
                    .padding(.trailing, 12)
            }
            .contentShape(Rectangle())
        }
    }

    private var bildFeld: some View {
        ZStack(alignment: .leading) {
            Rectangle().strokeBorder(Color(hex: 0xE3F654), lineWidth: 2)
            Button { bildWaehlen = true } label: {
                Text(bildURL.isEmpty ? "Fahrzeugbild hochladen" : "Fahrzeugbild ändern")
                    .font(.grotesk(16, .medium)).tracking(0.5)
                    .foregroundStyle(Color(hex: 0x8A9728))
                    .lineLimit(1)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.web)
            .padding(.leading, 16).padding(.trailing, 48)
            if !bildURL.isEmpty {
                StammBild(quelle: bildURL).frame(width: 64, height: 40)
                    .frame(maxWidth: .infinity, alignment: .trailing)
                    .padding(.trailing, 44)
                    .allowsHitTesting(false)
            }
            Button {
                if bildURL.isEmpty { bildWaehlen = true } else { bildURL = "" }
            } label: {
                Group {
                    if bildURL.isEmpty {
                        Image("Arrow-kurz_Trisar_Icons_01_Lime").resizable().frame(width: 10, height: 13)
                    } else {
                        Text("×").font(.grotesk(16, .bold)).foregroundStyle(Color(hex: 0xF55757))
                    }
                }
                .frame(width: 34, height: 44).contentShape(Rectangle())
            }
            .buttonStyle(.web)
            .accessibilityLabel(bildURL.isEmpty ? "Fahrzeugbild hochladen" : "Fahrzeugbild entfernen")
            .frame(maxWidth: .infinity, alignment: .trailing)
        }
    }

    private func uebernehmen() {
        markeModell = fahrzeug?.brandModel ?? ""
        variante = fahrzeug?.trim ?? ""
        vin = fahrzeug?.vin ?? ""
        kennzeichen = fahrzeug?.licensePlate ?? ""
        farbe = fahrzeug?.color ?? ""
        sitze = fahrzeug?.seatCount.map(String.init) ?? ""
        kraftstoff = fahrzeug?.fuelType ?? ""
        bildURL = fahrzeug?.imageUrl ?? ""
        rueckmeldung = ""
    }

    private func leeren() {
        markeModell = ""; variante = ""; vin = ""; kennzeichen = ""; farbe = ""; sitze = ""; kraftstoff = ""; bildURL = ""
    }

    private func bildUebernehmen(_ auswahl: PhotosPickerItem?) async {
        guard let auswahl else { return }
        defer { bildAuswahl = nil }
        guard let daten = try? await auswahl.loadTransferable(type: Data.self),
              let url = FahrzeugeDienst.bildDataURL(daten) else {
            rueckmeldung = "Bild konnte nicht gelesen werden."
            return
        }
        bildURL = url
        rueckmeldung = ""
    }

    /// saveVehicle: Pflicht ist Marke & Modell, Sitze nur als ganze Zahl, leere Felder als null.
    private func speichern() {
        fokus = nil
        let marke = markeModell.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !marke.isEmpty else {
            rueckmeldung = "Bitte Marke & Modell angeben."
            return
        }
        let sitzText = sitze.trimmingCharacters(in: .whitespaces)
        let sitzZahl = Int(sitzText)
        if !sitzText.isEmpty && (sitzZahl == nil || sitzZahl! < 0) {
            rueckmeldung = "Beifahreranzahl muss eine positive ganze Zahl sein."
            return
        }
        func feld(_ s: String) -> AnyJSON {
            let t = s.trimmingCharacters(in: .whitespacesAndNewlines)
            return t.isEmpty ? .null : .string(t)
        }
        let inhalt: [String: AnyJSON] = [
            "brand_model": .string(marke),
            "trim": feld(variante),
            "vin": feld(vin),
            "license_plate": feld(kennzeichen),
            "color": feld(farbe),
            "seat_count": sitzZahl.map { .integer($0) } ?? .null,
            "fuel_type": feld(kraftstoff),
            "image_url": feld(bildURL),
        ]
        speichert = true
        rueckmeldung = ""
        let id = bearbeiten ? fahrzeug?.id : nil
        Task {
            do {
                _ = try await FahrzeugeDienst.speichern(inhalt, id: id)
                rueckmeldung = id != nil ? "Fahrzeug erfolgreich aktualisiert." : "Fahrzeug erfolgreich erstellt."
                if id != nil {
                    try? await Task.sleep(for: .milliseconds(200))
                    zurListe()
                } else {
                    leeren()
                }
            } catch {
                rueckmeldung = id != nil
                    ? "Fahrzeug konnte nicht aktualisiert werden: \(dbMeldung(error))"
                    : "Fahrzeug konnte nicht gespeichert werden: \(dbMeldung(error))"
            }
            speichert = false
        }
    }
}


// MARK: - Schadensbericht (nur lesen)

/// Gemeldete Schaeden eines Fahrzeugs wie in der Fahrer-App (VehicleView / FahrzeugAnsicht).
/// Fotos oeffnen sich gross im Browser.
struct SchadensBerichtDispo: View {
    let fahrzeugID: String
    @State private var schaeden: [Schaden] = []
    @State private var geladen = false
    @State private var namen: [String: String] = [:]

    private struct Person: Decodable { let id: String; let first_name: String?; let last_name: String? }

    struct Schaden: Decodable, Identifiable {
        let id: String
        let report_date: String?
        let part_name: String?
        let description: String?
        let image_url: String?
        let image_urls: [String]?
        let reported_by_driver: Bool?
        let reported_by: String?
        let stelle: SchadenStelle?
        /// blob:-Adressen stammen aus einem alten Fehler der Web-App, das Bild gibt es nicht.
        var bilder: [String] { (image_urls?.isEmpty == false ? image_urls! : [image_url].compactMap { $0 }).filter { !$0.isEmpty && !$0.hasPrefix("blob:") } }
        var datum: String {
            let t = (report_date ?? "").prefix(10).split(separator: "-")
            return t.count == 3 ? "\(t[2]).\(t[1]).\(t[0])" : ""
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(schaeden.isEmpty ? "Schadensbericht" : "Schadensbericht (\(schaeden.count))")
                .font(.grotesk(18, .bold)).tracking(-0.5).foregroundStyle(Color(hex: 0x1D1C1C))
                .padding(.bottom, 10)
            Rectangle().fill(Color(hex: 0xDDDCDC)).frame(height: 1).padding(.bottom, 10)
            if geladen && schaeden.isEmpty {
                Text("Keine Schäden gemeldet.").font(.grotesk(14)).foregroundStyle(Color(hex: 0x71717B))
            }
            ForEach(Array(schaeden.enumerated()), id: \.element.id) { i, s in
                VStack(alignment: .leading, spacing: 0) {
                    HStack(alignment: .firstTextBaseline) {
                        Text(s.datum).font(.grotesk(15, .bold)).tracking(-0.5).foregroundStyle(Color(hex: 0x1D1C1C))
                        Spacer()
                        if let name = s.reported_by.flatMap({ namen[$0] }), !name.isEmpty {
                            Text("gemeldet von \(name)").font(.grotesk(11)).foregroundStyle(Color(hex: 0x71717B))
                        } else if s.reported_by_driver == true {
                            Text("vom Fahrer gemeldet").font(.grotesk(11)).foregroundStyle(Color(hex: 0x71717B))
                        }
                    }
                    .padding(.bottom, 6)
                    HStack(alignment: .top, spacing: 14) {
                        VStack(alignment: .leading, spacing: 0) {
                            Text((s.part_name ?? "").uppercased()).font(.grotesk(11, .bold)).tracking(-0.5)
                                .foregroundStyle(Color(hex: 0x1D1C1C)).padding(.bottom, 4)
                            Text(s.description ?? "").font(.grotesk(14, .bold)).tracking(-0.5)
                                .foregroundStyle(Color(hex: 0x1D1C1C))
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        if let st = s.stelle {
                            VStack(spacing: 4) {
                                FahrzeugSkizze.Ansicht(punkt: st.punkt, hoehe: 110)
                                if st.geschaetzt == true {
                                    Text("ungefähre Stelle").font(.grotesk(9)).foregroundStyle(Color(hex: 0x71717B))
                                }
                            }
                        }
                    }
                    .padding(.bottom, 10)
                    if !s.bilder.isEmpty {
                        HStack(spacing: 4) {
                            ForEach(s.bilder, id: \.self) { url in
                                if let ziel = URL(string: url) {
                                    Link(destination: ziel) {
                                        AsyncImage(url: ziel) { bild in bild.resizable().scaledToFill() }
                                            placeholder: { Color(hex: 0xF4F4F4) }
                                            .frame(maxWidth: .infinity).frame(height: 96).clipped()
                                    }
                                }
                            }
                        }
                        .padding(.bottom, 10)
                    }
                    if i < schaeden.count - 1 {
                        Rectangle().fill(Color(hex: 0xDDDCDC)).frame(height: 1).padding(.bottom, 10)
                    }
                }
            }
        }
        .padding(24)
        .frame(width: 362, alignment: .topLeading)
        .background(Color.white)
        .task {
            schaeden = (try? await Backend.client.from("vehicle_damages")
                .select("*")
                .eq("vehicle_id", value: fahrzeugID)
                .order("report_date", ascending: false)
                .order("created_at", ascending: false)
                .execute().value) ?? []
            let ids = Array(Set(schaeden.compactMap(\.reported_by)))
            if !ids.isEmpty {
                let leute: [Person] = (try? await Backend.client.from("profiles").select("id,first_name,last_name")
                    .in("id", values: ids).execute().value) ?? []
                namen = Dictionary(uniqueKeysWithValues: leute.map { p in
                    (p.id, [p.first_name, p.last_name].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " "))
                })
            }
            geladen = true
        }
    }
}
