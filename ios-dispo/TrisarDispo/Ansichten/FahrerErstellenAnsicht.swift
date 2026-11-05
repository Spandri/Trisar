import SwiftUI

/// Nachbau von FahrerErstellenView.jsx (Raster 402 x 913, Inhalt 20 tiefer gesetzt).
/// `fahrer == nil` = anlegen (Einladung ueber dispo-admin), sonst bearbeiten.
/// Ortung: Handy-App oder OBD-Tracker mit IMEI (profiles.tracking_mode, imei_driver_map).
struct FahrerErstellenAnsicht: View {
    let zurueck: () -> Void
    @StateObject private var m: FahrerEditorModell
    @FocusState private var fokus: Feld?
    @State private var menue: Menue?

    enum Feld: Hashable { case vorname, nachname, email, vorwahl, telefon, strasse, hausnummer, ort, plz, nummer, imei }
    enum Menue { case sprache, fahrzeug, tracker }

    init(fahrer: DispoFahrer?, zurueck: @escaping () -> Void) {
        self.zurueck = zurueck
        _m = StateObject(wrappedValue: FahrerEditorModell(fahrer: fahrer))
    }

    private let o: CGFloat = 20                 // Container `top-[20px]`
    private let lime = Color(hex: 0xE3F654)
    private let schrift = Color(hex: 0x8A9728)

    var body: some View {
        // Platz fuer die Ortungs-Zeilen: Auswahl (68) plus bei OBD IMEI-Feld und Hinweiszeile (88).
        let ortungsHoehe: CGFloat = m.ortung == "obd" ? 156 : 68
        let warnung = !m.nummerWarnung.isEmpty

        Leinwand(basisHoehe: 913, inhaltHoehe: 913 + ortungsHoehe) { _ in
            ZStack(alignment: .topLeading) {
                ZurueckKnopf(aktion: zurueck).platz(20, 60, 50, 50)

                Text(m.bearbeiten ? "Fahrer bearbeiten" : "Fahrer erstellen").grotesk(42, .bold, abstand: -0.5)
                    .foregroundStyle(Color(hex: 0xE2F754))
                    .fixedSize().frame(height: 42)
                    .platz(20, o + 120)

                eingabe(.vorname, "Vorname", $m.vorname, x: 20, y: 186, w: 178)
                eingabe(.nachname, "Nachname", $m.nachname, x: 204, y: 186, w: 178)

                // E-Mail: Brief-Icon links, beim Bearbeiten nur lesbar.
                kasten(x: 20, y: 254, w: 362)
                Image("Mail_Trisar_Icons_01_Lime").resizable().frame(width: 10, height: 13).scaleEffect(1.2)
                    .platz(12, o + 254 + 21.5, 10, 13)
                feld(.email, "E-Mail", $m.email, x: 20 + 40, y: 254, w: 362 - 80)
                    .keyboardType(.emailAddress)
                    .textInputAutocapitalization(.never)
                    .disabled(m.bearbeiten)
                pfeil(.email, x: 20, y: 254, w: 362)

                kasten(x: 20, y: 322, w: 85)
                feld(.vorwahl, "+49", $m.landesvorwahl, x: 20 + 16, y: 322, w: 85 - 24)
                    .keyboardType(.phonePad)

                kasten(x: 111, y: 322, w: 271)
                Image("contact-phone").resizable().scaledToFit().frame(width: 12, height: 12)
                    .platz(111 + 12, o + 322 + 22, 12, 12)
                feld(.telefon, "Telefon", $m.telefon, x: 111 + 40, y: 322, w: 271 - 80)
                    .keyboardType(.phonePad)
                pfeil(.telefon, x: 111, y: 322, w: 271)

                eingabe(.strasse, "Straße", $m.strasse, x: 20, y: 390, w: 271, rechts: 48)
                eingabe(.hausnummer, "Nr.", $m.hausnummer, x: 297, y: 390, w: 85, rechts: 40)
                eingabe(.ort, "Ort", $m.ort, x: 20, y: 458, w: 362, rechts: 48)
                eingabe(.plz, "PLZ", $m.plz, x: 20, y: 526, w: 178, rechts: 48)

                auswahl(text: m.sprache.isEmpty ? "Sprache" : m.sprache, x: 204, y: 526, w: 178) { umschalten(.sprache) }
                auswahl(text: m.fahrzeugeLaden ? "Fahrzeuge laden ..." : m.fahrzeugEtikett, x: 20, y: 594, w: 271) { umschalten(.fahrzeug) }

                eingabe(.nummer, "Nr.", Binding(get: { m.nummer }, set: { m.nummerGeaendert($0) }), x: 297, y: 594, w: 85, rechts: 40)
                    .keyboardType(.numberPad)

                // Ortung: Handy-App oder OBD-Tracker.
                ortungsKnopf("app", "Handy-App", x: 20)
                ortungsKnopf("obd", "OBD-Tracker", x: 204)

                if m.ortung == "obd" {
                    kasten(x: 20, y: 730, w: 362)
                    feld(.imei, "IMEI des Trackers (15 Ziffern)",
                         Binding(get: { m.imei }, set: { m.imei = String($0.filter(\.isNumber).prefix(15)) }),
                         x: 20 + 16, y: 730, w: 362 - 16 - 56)
                        .keyboardType(.numberPad)
                    if !m.tracker.isEmpty {
                        Button { umschalten(.tracker) } label: {
                            Text("v").grotesk(32, .bold).foregroundStyle(lime)
                                .frame(width: 48, height: 56, alignment: .trailing).padding(.trailing, 16)
                                .contentShape(Rectangle())
                        }
                        .buttonStyle(.web)
                        .platz(20 + 362 - 64, o + 730, 64, 56)
                    }
                    if let t = m.trackerBeiAnderem {
                        WebText(text: "Tracker ist gerade bei \(t.besitzerName.isEmpty ? "?" : t.besitzerName) und wird dort abgeschaltet.",
                                groesse: 12, zeilenHoehe: 12 * 1.3, farbe: UIColor(Color(hex: 0xFF9500)))
                            .platz(20, o + 790, 362, nil)
                    }
                }

                if warnung {
                    WebText(text: m.nummerWarnung, groesse: 12, zeilenHoehe: 12 * 1.3, farbe: UIColor(Color(hex: 0xFF9500)))
                        .padding(.horizontal, 12).padding(.vertical, 4)
                        .background(Color(hex: 0x2D1E00))
                        .overlay(RoundedRectangle(cornerRadius: 4).strokeBorder(Color(hex: 0xFF9500), lineWidth: 1))
                        .platz(20, o + 662 + ortungsHoehe, 362, nil)
                }

                // Speichern: loest erst der Knopf aus (createDriver).
                Button {
                    fokus = nil
                    menue = nil
                    Task { await m.speichern() }
                } label: {
                    Text(m.speichert ? "Speichern ..." : (m.bearbeiten ? "Fahrer speichern" : "Fahrer erstellen"))
                        .grotesk(16, .medium, abstand: 0.5).foregroundStyle(Color(hex: 0x0E1008))
                        .frame(width: 362, height: 56)
                        .background(Color(hex: 0xDBEE4A))
                        .opacity(m.speichert ? 0.7 : 1)
                }
                .buttonStyle(.web)
                .disabled(m.speichert)
                .platz(20, o + (warnung ? 696 : 674) + ortungsHoehe, 362, 56)

                WebText(text: m.rueckmeldung.isEmpty
                        ? (m.bearbeiten ? "Fahrerdaten bearbeiten und speichern." : "Fahrzeug koppeln + Nr. setzen und dann Fahrer erstellen.")
                        : m.rueckmeldung,
                        groesse: 12, zeilenHoehe: 12 * 1.3, farbe: UIColor(Color(hex: 0xC8D85D)))
                    .padding(.horizontal, 12).padding(.vertical, 8)
                    .frame(width: 362, alignment: .topLeading)
                    .frame(minHeight: 56, alignment: .topLeading)
                    .overlay(Rectangle().strokeBorder(Color(hex: 0x7F8A2B), lineWidth: 1))
                    .platz(20, o + (warnung ? 764 : 742) + ortungsHoehe, 362, nil)

                // Aufgeklappte Listen zuletzt, damit sie ueber allem liegen.
                if menue == .sprache {
                    liste(x: 204, y: 526, w: 178, maxHoehe: 192, zeilen: FahrerEditorModell.sprachen.count) {
                        ForEach(FahrerEditorModell.sprachen, id: \.self) { s in
                            zeile(s) { m.sprache = s; menue = nil }
                        }
                    }
                }
                if menue == .fahrzeug {
                    liste(x: 20, y: 594, w: 271, maxHoehe: 208, zeilen: m.fahrzeuge.count + 1) {
                        zeile("Kein Fahrzeug") { m.fahrzeugID = ""; menue = nil }
                        ForEach(m.fahrzeuge) { f in
                            zeile(f.etikett.isEmpty ? "Ohne Kennzeichen" : f.etikett) { m.fahrzeugID = f.id; menue = nil }
                        }
                    }
                }
                if menue == .tracker && m.ortung == "obd" {
                    liste(x: 20, y: 730, w: 362, maxHoehe: 208, zeilen: m.tracker.count) {
                        ForEach(m.tracker) { t in
                            let notiz = t.is_active != true ? "frei" : (t.driver_id == m.ursprung?.id ? "dieser Fahrer" : t.besitzerName)
                            Button { m.imei = t.imei; menue = nil } label: {
                                (Text(t.imei).font(.grotesk(16)).foregroundColor(schrift)
                                 + (notiz.isEmpty ? Text("") : Text(" · \(notiz)").font(.grotesk(12)).foregroundColor(Color(hex: 0xC8D85D))))
                                    .lineLimit(1)
                                    .padding(.horizontal, 16)
                                    .frame(maxWidth: .infinity, minHeight: 40, maxHeight: 40, alignment: .leading)
                                    .contentShape(Rectangle())
                            }
                            .buttonStyle(.web)
                        }
                    }
                }
            }
        }
        .overlay { FussleisteUnten() }
        .task { await m.start() }
        // Wie onFocus am IMEI-Feld: Tracker-Liste zu.
        .onChange(of: fokus) { _, neu in if neu == .imei, menue == .tracker { menue = nil } }
    }

    // MARK: Bausteine

    /// Box: 56 hoch, 2er Lime-Rand.
    private func kasten(x: CGFloat, y: CGFloat, w: CGFloat) -> some View {
        Rectangle().strokeBorder(Color(hex: 0xE3F654), lineWidth: 2).platz(x, o + y, w, 56)
            .allowsHitTesting(false)
    }

    private func feld(_ f: Feld, _ platzhalter: String, _ text: Binding<String>, x: CGFloat, y: CGFloat, w: CGFloat) -> some View {
        TextField("", text: text, prompt: Text(platzhalter).foregroundColor(schrift.opacity(0.9)))
            .focused($fokus, equals: f)
            .font(.grotesk(16, .medium)).tracking(0.5)
            .foregroundStyle(schrift)
            .tint(lime)
            .autocorrectionDisabled()
            .platz(x, o + y, w, 56, .leading)
    }

    /// Kurzer Lime-Pfeil rechts im Feld, setzt den Fokus wie im Web.
    private func pfeil(_ f: Feld, x: CGFloat, y: CGFloat, w: CGFloat) -> some View {
        Button { menue = nil; fokus = f } label: {
            Image("Arrow-kurz_Trisar_Icons_01_Lime").resizable().frame(width: 10, height: 13)
                .padding(.trailing, 12)
                .frame(width: 34, height: 56, alignment: .trailing)
                .contentShape(Rectangle())
        }
        .buttonStyle(.web)
        .platz(x + w - 34, o + y, 34, 56)
    }

    /// Feld mit Rahmen und Pfeil (`left-4`, rechts je nach Feld `right-10/12/14`).
    private func eingabe(_ f: Feld, _ platzhalter: String, _ text: Binding<String>,
                         x: CGFloat, y: CGFloat, w: CGFloat, rechts: CGFloat = 56) -> some View {
        ZStack(alignment: .topLeading) {
            kasten(x: x, y: y, w: w)
            feld(f, platzhalter, text, x: x + 16, y: y, w: w - 16 - rechts)
            pfeil(f, x: x, y: y, w: w)
        }
    }

    /// Klappauswahl mit "v" rechts (Sprache, Fahrzeug).
    private func auswahl(text: String, x: CGFloat, y: CGFloat, w: CGFloat, aktion: @escaping () -> Void) -> some View {
        Button(action: aktion) {
            ZStack(alignment: .leading) {
                Text(text).grotesk(16, .medium, abstand: 0.5).foregroundStyle(schrift)
                    .lineLimit(1).fixedSize()
                    .padding(.leading, 16)
                Text("v").grotesk(32, .bold).foregroundStyle(lime)
                    .frame(maxWidth: .infinity, alignment: .trailing).padding(.trailing, 16)
            }
            .frame(width: w, height: 56)
            .clipped()
            .overlay(Rectangle().strokeBorder(lime, lineWidth: 2))
            .contentShape(Rectangle())
        }
        .buttonStyle(.web)
        .platz(x, o + y, w, 56)
    }

    private func ortungsKnopf(_ wert: String, _ text: String, x: CGFloat) -> some View {
        let an = m.ortung == wert
        return Button {
            m.ortung = wert
            if menue == .tracker { menue = nil }
        } label: {
            Text(text).grotesk(16, .medium, abstand: 0.5)
                .foregroundStyle(an ? Color(hex: 0x0E1008) : schrift)
                .padding(.leading, 16)
                .frame(width: 178, height: 56, alignment: .leading)
                .background(an ? lime : .clear)
                .overlay(Rectangle().strokeBorder(lime, lineWidth: 2))
                .contentShape(Rectangle())
        }
        .buttonStyle(.web)
        .platz(x, o + 662, 178, 56)
    }

    /// Aufgeklappte Liste 58 unter dem Feld: schwarz, Lime-Rand, scrollbar.
    private func liste<Inhalt: View>(x: CGFloat, y: CGFloat, w: CGFloat, maxHoehe: CGFloat, zeilen: Int,
                                     @ViewBuilder inhalt: () -> Inhalt) -> some View {
        // Zeile = py-2 + 24er Textzeile = 40, plus 2er Rand oben und unten.
        let hoehe = min(maxHoehe, CGFloat(zeilen) * 40 + 4)
        return
        ScrollView(.vertical, showsIndicators: false) {
            VStack(spacing: 0) { inhalt() }.padding(.vertical, 2)
        }
        .scrollBounceBehavior(.basedOnSize)
        .frame(width: w, height: hoehe)
        .background(Color.black)
        .overlay(Rectangle().strokeBorder(lime, lineWidth: 2))
        .platz(x, o + y + 58, w, nil)
    }

    private func zeile(_ text: String, aktion: @escaping () -> Void) -> some View {
        Button(action: aktion) {
            Text(text).grotesk(16).foregroundStyle(schrift)
                .lineLimit(1)
                .padding(.horizontal, 16)
                .frame(maxWidth: .infinity, minHeight: 40, maxHeight: 40, alignment: .leading)
                .contentShape(Rectangle())
        }
        .buttonStyle(.web)
    }

    private func umschalten(_ neu: Menue) {
        fokus = nil
        menue = menue == neu ? nil : neu
    }
}
