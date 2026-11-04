import PhotosUI
import SwiftUI

/// Profil der Disposition: Profil (ProfilKoordinatorView.jsx), Ansprechpartner (AnsprechpartnerView.jsx,
/// Live-Zweig) und Einstellungen (SettingsViewKo.jsx).
struct KoordinatorProfilAnsicht: View {
    let zeigen: (DispoZiel) -> Void
    @State private var seite: Seite = .profil
    @StateObject private var dienst = KoordinatorProfilDienst()

    enum Seite: Hashable { case profil, ansprechpartner, einstellungen }

    var body: some View {
        Group {
            switch seite {
            case .profil:
                KoordinatorProfilSeite(name: dienst.profil.name, zurueck: { zeigen(.start) },
                                       ansprechpartner: { seite = .ansprechpartner },
                                       einstellungen: { seite = .einstellungen })
            case .ansprechpartner:
                AnsprechpartnerSeite(zurueck: { seite = .profil })
            case .einstellungen:
                KoordinatorEinstellungenSeite(dienst: dienst, zurueck: { seite = .profil })
            }
        }
        .id(seite)
        .transition(.opacity)
        .animation(.easeOut(duration: 0.15), value: seite)
        .task { await dienst.laden() }
    }
}

// MARK: - Profil

struct KoordinatorProfilSeite: View {
    let name: String
    let zurueck: () -> Void
    let ansprechpartner: () -> Void
    let einstellungen: () -> Void

    var body: some View {
        Leinwand(basisHoehe: 875, mitHintergrund: false) { rahmen in
            ZStack(alignment: .topLeading) {
                DispoHintergrund().frame(width: 402, height: rahmen)
                ZurueckKnopf(aktion: zurueck).platz(20, 60, 50, 50)

                // Der Name haengt mit der Unterkante ueber dem Datum und waechst bei Umbruch nach oben.
                WebText(text: name, groesse: 48, gewicht: .bold, zeilenHoehe: 48, abstand: -0.5, farbe: UIColor(hex: 0xE2F754))
                    .frame(width: 362)
                    .allowsHitTesting(false)
                    .platz(20, 0, 362, 292, .bottomLeading)
                // Im Web fest eingetragen, auch live.
                Text("Seit 20.01.25").font(.grotesk(16, .medium)).tracking(0.5)
                    .foregroundStyle(Color(hex: 0xE3F654)).opacity(0.5)
                    .frame(height: 24).fixedSize()
                    .platz(21, 293)

                // Kennzahl-Kacheln: im Web feste Werte, auch im Live-Zweig.
                kachel(20, 329, "5234", "km", blitz: CGPoint(x: 169, y: 341))
                kachel(204, 329, "634", "Liter", blitz: CGPoint(x: 353, y: 341))
                kachel(20, 450, "56", "Fahrten", blitz: CGPoint(x: 168, y: 460.71))
                kachel(204, 450, "51", "Stunden", blitz: CGPoint(x: 353, y: 462))

                zeile("Ansprechpartner", aktion: ansprechpartner).platz(21, 589, 360, 56)
                // Verlauf ist eine eigene Seite (VerlaufView), in der App noch nicht nachgebaut.
                zeile("Verlauf", aktion: {}).platz(21, 657, 360, 56)

                Button(action: einstellungen) {
                    Text("Einstellungen").font(.grotesk(16, .medium)).tracking(0.5)
                        .foregroundStyle(Color(hex: 0xE3F654))
                        .frame(width: 360, height: 56)
                        .overlay(Rectangle().strokeBorder(Color(hex: 0xE3F654), lineWidth: 2))
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .opacity(0.5)
                .platz(21, 737, 360, 56)
            }
        }
        .overlay { FussleisteUnten() }
    }

    private func kachel(_ x: CGFloat, _ y: CGFloat, _ wert: String, _ einheit: String, blitz: CGPoint) -> some View {
        ZStack(alignment: .topLeading) {
            Rectangle().strokeBorder(Color(hex: 0xE3F654), lineWidth: 2).platz(x, y, 178, 115)
            HStack(alignment: .bottom, spacing: 8) {
                Text(wert).font(.grotesk(36, .medium)).tracking(0.5).frame(height: 36)
                Text(einheit).font(.grotesk(16, .medium)).tracking(0.5).frame(height: 16).opacity(0.5).padding(.bottom, 2)
            }
            .foregroundStyle(Color(hex: 0xE3F654))
            .fixedSize()
            .platz(x + 20, y + 71)
            Image("Blitz_Trisar_Icons_01_Lime").resizable().scaledToFit().opacity(0.5).platz(blitz.x, blitz.y, 16, 20)
        }
    }

    private func zeile(_ text: String, aktion: @escaping () -> Void) -> some View {
        Button(action: aktion) {
            HStack(spacing: 0) {
                Text(text).font(.grotesk(16, .medium)).tracking(0.5).foregroundStyle(Color(hex: 0x262626))
                Spacer(minLength: 0)
                Image("Arrow_Trisar_Icons_01").resizable().scaledToFit().frame(width: 34, height: 19.92)
            }
            .padding(.leading, 16).padding(.trailing, 12)
            .frame(width: 360, height: 56)
            .background(Color(hex: 0xE3F654))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Ansprechpartner

/// Live-Zweig: nur die Karte „TRISAR Team“ mit E-Mail, keine Beispielpersonen und keine Hotline.
struct AnsprechpartnerSeite: View {
    let zurueck: () -> Void
    @Environment(\.openURL) private var oeffnen

    private let name = "TRISAR Team"
    private let email = "team@trisar.de"

    var body: some View {
        Leinwand(basisHoehe: 874, inhaltHoehe: 838, mitHintergrund: false) { rahmen in
            ZStack(alignment: .topLeading) {
                DispoHintergrund().frame(width: 402, height: rahmen)
                UnevenRoundedRectangle(topLeadingRadius: 12, topTrailingRadius: 12)
                    .fill(Color(hex: 0x1A1A1A))
                    .platz(0, 206, 402, max(838, rahmen) - 206)
                ZurueckKnopf(aktion: zurueck).platz(20, 60, 50, 50)
                StammTitel(text: "Support", abstand: -0.5, farbe: 0xE2F754).platz(20, 140)
                karte.platz(20, 230, 362, 543)
            }
        }
        .overlay { FussleisteUnten() }
    }

    /// ContactCard: Foto-Feld mit Initialen, Name, E-Mail, Knopf „Get in touch“ (ohne Telefon per Mail).
    private var karte: some View {
        ZStack(alignment: .topLeading) {
            Color.white
            Text(name.split(separator: " ").compactMap { $0.first.map(String.init) }.joined())
                .font(.grotesk(48, .bold)).foregroundStyle(Color(hex: 0x6B7280))
                .frame(width: 338, height: 244)
                .background(Color(hex: 0xD9D9D9))
                .platz(12, 12, 338, 244)
            Text(name).font(.grotesk(30, .bold)).tracking(0.5).foregroundStyle(.black)
                .frame(height: 30).fixedSize()
                .platz(11, 279)
            Text(email).font(.grotesk(18, .bold)).tracking(0.5).foregroundStyle(.black)
                .frame(height: 24).fixedSize()
                .platz(12, 408)
            Button {
                if let url = URL(string: "mailto:\(email)") { oeffnen(url) }
            } label: {
                Text("Get in touch").font(.grotesk(24, .bold)).tracking(-0.5).foregroundStyle(.black)
                    .frame(width: 338, height: 56)
                    .background(Color(hex: 0xE3F654))
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .platz(12, 457, 338, 56)
        }
        .frame(width: 362, height: 543)
    }
}

// MARK: - Einstellungen

struct KoordinatorEinstellungenSeite: View {
    @ObservedObject var dienst: KoordinatorProfilDienst
    let zurueck: () -> Void
    @EnvironmentObject private var anmeldung: Anmeldung

    @State private var vorname = ""
    @State private var nachname = ""
    @State private var email = ""
    @State private var vorwahl = "+49"
    @State private var telefon = ""
    @State private var strasse = ""
    @State private var hausnummer = ""
    @State private var ort = ""
    @State private var plz = ""
    @State private var sprache = "Deutsch"
    @State private var bildURL = ""
    @State private var spracheOffen = false
    @State private var bildMenueOffen = false
    @State private var bildVorschau = false
    @State private var bildWaehlen = false
    @State private var bildAuswahl: PhotosPickerItem?
    @State private var bildFehler = ""
    @FocusState private var fokus: Feld?

    private enum Feld: Hashable { case vorname, nachname, email, vorwahl, telefon, strasse, hausnummer, ort, plz }
    private static let sprachen = ["Deutsch", "English", "Français", "Italiano", "Español", "Türkçe"]

    var body: some View {
        Leinwand(basisHoehe: 873, mitHintergrund: false) { rahmen in
            ZStack(alignment: .topLeading) {
                DispoHintergrund().frame(width: 402, height: rahmen)
                ZurueckKnopf(aktion: zurueck).platz(20, 60, 50, 50)
                StammTitel(text: "Einstellungen", abstand: -0.5, farbe: 0xE2F754).platz(20, 140)

                BoxFeld(platzhalter: "Vorname", wert: $vorname, fokus: $fokus, art: .vorname, rechts: 56, grossschreibung: .words)
                    .platz(20, 206, 178, 56)
                BoxFeld(platzhalter: "Nachname", wert: $nachname, fokus: $fokus, art: .nachname, rechts: 56, grossschreibung: .words)
                    .platz(204, 206, 178, 56)
                BoxFeld(platzhalter: "E-Mail", wert: $email, fokus: $fokus, art: .email, links: 40, rechts: 40,
                        tastatur: .emailAddress, grossschreibung: .never)
                    .overlay(alignment: .leading) {
                        Image("Mail_Trisar_Icons_01_Lime").resizable().frame(width: 10, height: 13).scaleEffect(1.2)
                            .padding(.leading, 12).allowsHitTesting(false)
                    }
                    .platz(20, 274, 362, 56)
                BoxFeld(platzhalter: "+49", wert: $vorwahl, fokus: $fokus, art: .vorwahl, rechts: 8, pfeil: false, tastatur: .phonePad)
                    .platz(20, 342, 85, 56)
                BoxFeld(platzhalter: "Telefon", wert: $telefon, fokus: $fokus, art: .telefon, links: 40, rechts: 40, tastatur: .phonePad)
                    .overlay(alignment: .leading) {
                        Image("contact-phone").resizable().scaledToFit().frame(width: 12, height: 12)
                            .padding(.leading, 12).allowsHitTesting(false)
                    }
                    .platz(111, 342, 271, 56)
                BoxFeld(platzhalter: "Straße", wert: $strasse, fokus: $fokus, art: .strasse, grossschreibung: .words)
                    .platz(20, 410, 271, 56)
                BoxFeld(platzhalter: "Nr.", wert: $hausnummer, fokus: $fokus, art: .hausnummer, rechts: 40)
                    .platz(297, 410, 85, 56)
                BoxFeld(platzhalter: "Ort", wert: $ort, fokus: $fokus, art: .ort, grossschreibung: .words)
                    .platz(20, 478, 362, 56)
                BoxFeld(platzhalter: "PLZ", wert: $plz, fokus: $fokus, art: .plz, tastatur: .numberPad)
                    .platz(20, 546, 178, 56)

                Button { spracheOffen.toggle() } label: {
                    ZStack(alignment: .leading) {
                        Rectangle().strokeBorder(Color(hex: 0xE3F654), lineWidth: 2)
                        Text(sprache.isEmpty ? "Sprache" : sprache).font(.grotesk(16, .medium)).tracking(0.5)
                            .foregroundStyle(Color(hex: 0x8A9728)).lineLimit(1).padding(.leading, 16)
                        Image("Arrow-kurz_Trisar_Icons_01_Lime").resizable().frame(width: 10, height: 13)
                            .rotationEffect(.degrees(90))
                            .frame(maxWidth: .infinity, alignment: .trailing).padding(.trailing, 12)
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .platz(204, 546, 178, 56)

                Button(action: abmelden) {
                    Text("Abmelden").font(.grotesk(16, .medium)).tracking(0.5)
                        .foregroundStyle(Color(hex: 0x7F8A2B))
                        .frame(width: 362, height: 56)
                        .overlay(Rectangle().strokeBorder(Color(hex: 0x7F8A2B), lineWidth: 1))
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .platz(20, 626, 362, 56)

                // Im Web nur Beschriftung ohne Funktion.
                Text("Account löschen").font(.grotesk(12, .medium)).tracking(0.5)
                    .foregroundStyle(Color(hex: 0xE3F654)).opacity(0.35)
                    .frame(width: 362, height: 24)
                    .platz(20, 694, 362, 24)

                if spracheOffen { sprachListe.platz(204, 604, 178, nil) }
                profilbildKnopf.platz(402 - 20 - 228, 60, 228, nil, .topTrailing)
            }
        }
        .overlay { FussleisteUnten() }
        .overlay { if bildVorschau { vorschau } }
        .overlay(alignment: .bottom) {
            if !bildFehler.isEmpty {
                Text(bildFehler).font(.grotesk(12, .medium)).foregroundStyle(Color(hex: 0xFF8E8E))
                    .padding(.horizontal, 16).padding(.vertical, 8)
                    .background(Color(hex: 0x220F0F))
                    .overlay(Rectangle().stroke(Color(hex: 0xF55757), lineWidth: 1))
                    .padding(.bottom, 64)
                    .task(id: bildFehler) {
                        try? await Task.sleep(for: .seconds(3.2))
                        bildFehler = ""
                    }
            }
        }
        .photosPicker(isPresented: $bildWaehlen, selection: $bildAuswahl, matching: .images)
        .onChange(of: bildAuswahl) { _, neu in Task { await bildUebernehmen(neu) } }
        // Jedes Feld speichert beim Verlassen (onBlur im Web).
        .onChange(of: fokus) { alt, _ in if let alt { Task { await speichern(alt) } } }
        .onAppear { uebernehmen(dienst.profil) }
        .onChange(of: dienst.profil) { _, neu in if fokus == nil { uebernehmen(neu) } }
    }

    private var sprachListe: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                ForEach(Self.sprachen, id: \.self) { s in
                    Button {
                        sprache = s
                        spracheOffen = false
                        Task { await dienst.speichern([.language: s]) }
                    } label: {
                        Text(s).font(.grotesk(16)).foregroundStyle(Color(hex: 0x8A9728))
                            .padding(.horizontal, 16).padding(.vertical, 8)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
            }
        }
        .frame(width: 178, height: 192)
        .background(Color.black)
        .overlay(Rectangle().strokeBorder(Color(hex: 0xE3F654), lineWidth: 2))
    }

    // MARK: Profilbild

    private var initialen: String {
        let i = "\(vorname.trimmingCharacters(in: .whitespaces).prefix(1))\(nachname.trimmingCharacters(in: .whitespaces).prefix(1))"
            .uppercased().filter { ("A" ... "Z").contains($0) || $0.isNumber }
        return i.isEmpty ? "P" : String(i.prefix(2))
    }

    @ViewBuilder private var profilbild: some View {
        if let b = StammBild.ausDataURL(bildURL) {
            Image(uiImage: b).resizable().scaledToFill()
        } else if let url = FahrzeugKarte.bildURL(bildURL) {
            AsyncImage(url: url) { $0.image?.resizable().scaledToFill() }
        } else {
            Text(initialen).font(.grotesk(18, .bold)).tracking(0.45).foregroundStyle(Color(hex: 0xE3F654))
        }
    }

    private var profilbildKnopf: some View {
        VStack(alignment: .trailing, spacing: 8) {
            Button { bildMenueOffen.toggle() } label: {
                profilbild
                    .frame(width: 56, height: 56)
                    .background(Color.black)
                    .clipShape(Circle())
                    .overlay(Circle().strokeBorder(Color(hex: 0xE3F654), lineWidth: 2))
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Profilbild Optionen")

            if bildMenueOffen {
                VStack(spacing: 0) {
                    menuePunkt("Profilbild anzeigen", farbe: 0xE3F654, linie: true) {
                        bildMenueOffen = false
                        if bildURL.isEmpty { bildFehler = "Kein Profilbild vorhanden." } else { bildVorschau = true }
                    }
                    menuePunkt("Neues Profilbild hochladen", farbe: 0xE3F654, linie: true) {
                        bildMenueOffen = false
                        bildWaehlen = true
                    }
                    menuePunkt("Profilbild entfernen", farbe: 0xF55757, linie: false) {
                        bildURL = ""
                        bildVorschau = false
                        bildMenueOffen = false
                        bildFehler = ""
                        Task { await dienst.speichern([.avatarUrl: ""]) }
                    }
                }
                .frame(width: 228)
                .background(Color.black)
                .overlay(Rectangle().strokeBorder(Color(hex: 0xE3F654), lineWidth: 2))
            }
        }
    }

    private func menuePunkt(_ text: String, farbe: UInt32, linie: Bool, aktion: @escaping () -> Void) -> some View {
        Button(action: aktion) {
            Text(text).font(.grotesk(14, .medium)).foregroundStyle(Color(hex: farbe))
                .padding(.horizontal, 16)
                .frame(maxWidth: .infinity, minHeight: 48, alignment: .leading)
                .overlay(alignment: .bottom) { if linie { Rectangle().fill(Color(hex: 0x5D6620)).frame(height: 1) } }
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private var vorschau: some View {
        ZStack {
            Color.black.opacity(0.85).ignoresSafeArea()
            VStack(alignment: .leading, spacing: 16) {
                Text("Profilbild").font(.grotesk(18, .bold)).foregroundStyle(Color(hex: 0xE3F654))
                Group {
                    if bildURL.isEmpty {
                        Text("Kein Bild").font(.grotesk(14)).foregroundStyle(Color(hex: 0x798321))
                    } else {
                        profilbild
                    }
                }
                .frame(width: 324, height: 324)
                .background(Color(hex: 0x101108))
                .clipped()
                .overlay(Rectangle().stroke(Color(hex: 0x5D6620), lineWidth: 1))
                Button { bildVorschau = false } label: {
                    Text("Schließen").font(.grotesk(16, .medium)).foregroundStyle(Color(hex: 0x0E1008))
                        .frame(maxWidth: .infinity).frame(height: 48).background(Color(hex: 0xE3F654))
                }
                .buttonStyle(.plain)
            }
            .padding(16)
            .frame(width: 360)
            .background(Color.black)
            .overlay(Rectangle().strokeBorder(Color(hex: 0xE3F654), lineWidth: 2))
        }
    }

    // MARK: Laden / Speichern

    /// Werte aus profileData in die Felder (Telefon getrennt in Vorwahl und Nummer).
    private func uebernehmen(_ p: KoordinatorProfil) {
        vorname = p.firstName
        nachname = p.lastName
        email = p.email
        let tel = p.phone.trimmingCharacters(in: .whitespaces)
        if tel.isEmpty {
            vorwahl = "+49"; telefon = ""
        } else if let r = tel.range(of: #"^\+\d{1,4}"#, options: .regularExpression) {
            vorwahl = String(tel[r]); telefon = tel[r.upperBound...].trimmingCharacters(in: .whitespaces)
        } else {
            vorwahl = "+49"; telefon = tel
        }
        strasse = p.street
        hausnummer = p.streetNumber
        ort = p.city
        plz = p.zip
        sprache = p.language.isEmpty ? "Deutsch" : p.language
        bildURL = p.avatarUrl
    }

    private func speichern(_ feld: Feld) async {
        let t = { (s: String) in s.trimmingCharacters(in: .whitespaces) }
        switch feld {
        case .vorname:
            await dienst.speichern([.firstName: t(vorname)])
            await anmeldung.profilLaden()
        case .nachname:
            await dienst.speichern([.lastName: t(nachname)])
            await anmeldung.profilLaden()
        case .email: await dienst.speichern([.email: t(email)])
        case .vorwahl, .telefon:
            await dienst.speichern([.phone: "\(t(vorwahl.isEmpty ? "+49" : vorwahl)) \(t(telefon))".trimmingCharacters(in: .whitespaces)])
        case .strasse: await dienst.speichern([.street: t(strasse)])
        case .hausnummer: await dienst.speichern([.streetNumber: t(hausnummer)])
        case .ort: await dienst.speichern([.city: t(ort)])
        case .plz: await dienst.speichern([.zip: t(plz)])
        }
    }

    private func bildUebernehmen(_ auswahl: PhotosPickerItem?) async {
        guard let auswahl else { return }
        defer { bildAuswahl = nil }
        guard let daten = try? await auswahl.loadTransferable(type: Data.self) else {
            bildFehler = "Bitte eine Bilddatei auswählen."
            return
        }
        guard let url = KoordinatorProfilDienst.profilbildDataURL(daten) else {
            bildFehler = "Profilbild konnte nicht geladen werden."
            return
        }
        bildURL = url
        bildMenueOffen = false
        bildFehler = ""
        await dienst.speichern([.avatarUrl: url])
    }

    private func abmelden() {
        fokus = nil
        Task {
            await anmeldung.abmelden()
            dienst.vergessen()
        }
    }
}
