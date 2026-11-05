import PhotosUI
import SwiftUI

/// Nachbau von SettingsFahrer.jsx (Raster 402 x 873). Jedes Feld speichert beim Verlassen,
/// Sprache sofort, Profilbild beim Auswaehlen. Abmelden nur auf diesem Geraet.
struct EinstellungenAnsicht: View {
    var zurueck: () -> Void
    @EnvironmentObject private var anmeldung: Anmeldung
    @StateObject private var dienst = ProfilDienst()

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
    @State private var bildAuswahl: PhotosPickerItem?
    @State private var bildWaehlen = false
    @State private var bildFehler: String?
    @State private var mitteilungenOffen = false
    @FocusState private var fokus: Feld?

    private enum Feld: Hashable { case vorname, nachname, email, vorwahl, telefon, strasse, hausnummer, ort, plz }
    private static let sprachen = ["Deutsch", "English", "Français", "Italiano", "Español", "Türkçe"]

    var body: some View {
        Leinwand(basisHoehe: 873) { _ in
            ZStack(alignment: .topLeading) {
                ZurueckKnopf(aktion: zurueck).platz(20, 60, 50, 50)

                Text("Einstellungen").font(.grotesk(42, .bold)).tracking(-0.5)
                    .foregroundStyle(Color(hex: 0xE2F754)).frame(height: 42).fixedSize()
                    .platz(20, 140)

                feld(.vorname, "Vorname", $vorname).platz(20, 190, 178, 56)
                feld(.nachname, "Nachname", $nachname).platz(204, 190, 178, 56)
                feld(.email, "E-Mail", $email, links: 40, rechts: 40, icon: "Mail_Trisar_Icons_01_Lime", iconGroesse: CGSize(width: 12, height: 15.6))
                    .platz(21, 254, 360, 56)
                feld(.vorwahl, "+49", $vorwahl, rechts: 8, bearbeiten: false).platz(20, 322, 85, 56)
                feld(.telefon, "Telefon", $telefon, links: 40, rechts: 40, icon: "contact-phone", iconGroesse: CGSize(width: 12, height: 12))
                    .platz(111, 322, 270, 56)
                feld(.strasse, "Straße", $strasse, rechts: 48).platz(20, 390, 270, 56)
                feld(.hausnummer, "Nr.", $hausnummer, rechts: 40).platz(296, 390, 85, 56)
                feld(.ort, "Ort", $ort, rechts: 48).platz(20, 458, 361, 56)
                feld(.plz, "PLZ", $plz, rechts: 48).platz(20, 526, 178, 56)

                Button(action: abmelden) {
                    Text("Abmelden").font(.grotesk(16, .medium)).tracking(0.5)
                        .foregroundStyle(Color(hex: 0x7F8A2B))
                        .frame(width: 362, height: 56)
                        .overlay(Rectangle().strokeBorder(Color(hex: 0x7F8A2B), lineWidth: 1))
                }
                .buttonStyle(.web)
                .platz(20, 675, 362, 56)

                // Im Web nur Beschriftung ohne Funktion.
                Text("Account löschen").font(.grotesk(12, .medium)).tracking(0.5)
                    .foregroundStyle(Color(hex: 0xE3F654).opacity(0.35))
                    .frame(width: 362, height: 24)
                    .platz(20, 750)

                Button { mitteilungenOffen = true } label: {
                    Text("Mitteilungen").font(.grotesk(16, .medium)).tracking(0.5)
                        .foregroundStyle(Color(hex: 0xE3F654))
                        .frame(width: 362, height: 56)
                        .overlay(Rectangle().strokeBorder(Color(hex: 0xE3F654), lineWidth: 1))
                }
                .buttonStyle(.web)
                .platz(20, 607, 362, 56)

                sprachFeld.platz(204, 526, 177, nil)
                profilbildKnopf.platz(402 - 20 - 228, 60, 228, nil, .topTrailing)
            }
        }
        .overlay { FussleisteUnten() }
        .overlay { if bildVorschau { vorschau } }
        .overlay {
            if mitteilungenOffen, let nutzer = anmeldung.fahrerID {
                MitteilungenAnsicht(nutzer: nutzer, gruppen: PushArten.fahrer) { mitteilungenOffen = false }
            }
        }
        .overlay(alignment: .bottom) {
            if let f = bildFehler ?? dienst.fehler {
                Text(f).font(.grotesk(12, .medium)).foregroundStyle(Color(hex: 0xFF8E8E))
                    .padding(.horizontal, 16).padding(.vertical, 8)
                    .background(Color(hex: 0x220F0F))
                    .overlay(Rectangle().stroke(Color(hex: 0xF55757), lineWidth: 1))
                    .padding(.bottom, 64)
                    .task { try? await Task.sleep(for: .seconds(3.2)); bildFehler = nil; dienst.fehler = nil }
            }
        }
        .photosPicker(isPresented: $bildWaehlen, selection: $bildAuswahl, matching: .images)
        .onChange(of: bildAuswahl) { _, neu in Task { await bildUebernehmen(neu) } }
        .onChange(of: fokus) { alt, _ in if let alt { Task { await speichern(alt) } } }
        .task { await laden() }
    }

    // MARK: Felder

    private func feld(_ art: Feld, _ platzhalter: String, _ wert: Binding<String>, links: CGFloat = 16, rechts: CGFloat = 56,
                      icon: String? = nil, iconGroesse: CGSize = .zero, bearbeiten: Bool = true) -> some View {
        ZStack(alignment: .leading) {
            Rectangle().strokeBorder(Color(hex: 0xE3F654), lineWidth: 2)
            if let icon {
                Image(icon).resizable().scaledToFit().frame(width: iconGroesse.width, height: iconGroesse.height)
                    .padding(.leading, 12)
            }
            TextField("", text: wert, prompt: Text(verbatim: platzhalter).foregroundStyle(Color(hex: 0x8A9728).opacity(0.9)))
                .font(.grotesk(16, .medium)).tracking(0.5)
                .foregroundStyle(Color(hex: 0x8A9728))
                .tint(Farbe.lime)
                .textInputAutocapitalization(art == .email ? .never : .words)
                .keyboardType(art == .email ? .emailAddress : (art == .telefon || art == .vorwahl || art == .plz ? .phonePad : .default))
                .autocorrectionDisabled()
                .focused($fokus, equals: art)
                .padding(.leading, links).padding(.trailing, rechts)
            if bearbeiten {
                HStack {
                    Spacer()
                    Button { fokus = art } label: {
                        Image("Arrow-kurz_Trisar_Icons_01_Lime").resizable().frame(width: 10, height: 13)
                            .frame(width: 30, height: 40)
                    }
                    .buttonStyle(.web)
                    .padding(.trailing, 2)
                }
            }
        }
    }

    private var sprachFeld: some View {
        VStack(spacing: 2) {
            Button { spracheOffen.toggle() } label: {
                HStack {
                    Text(sprache).font(.grotesk(16, .medium)).tracking(0.5).foregroundStyle(Color(hex: 0x8A9728))
                    Spacer()
                    Image("Arrow-kurz_Trisar_Icons_01_Lime").resizable().frame(width: 10, height: 13).rotationEffect(.degrees(90))
                }
                .padding(.leading, 16).padding(.trailing, 12)
                .frame(width: 177, height: 56)
                .overlay(Rectangle().strokeBorder(Color(hex: 0xE3F654), lineWidth: 2))
                .contentShape(Rectangle())
            }
            .buttonStyle(.web)
            if spracheOffen {
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(Self.sprachen, id: \.self) { s in
                        Button {
                            sprache = s
                            spracheOffen = false
                            Task { await speichernSpalte("language", s) }
                        } label: {
                            Text(s).font(.grotesk(16)).foregroundStyle(Color(hex: 0x8A9728))
                                .padding(.horizontal, 16).padding(.vertical, 8)
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }
                        .buttonStyle(.web)
                    }
                }
                .frame(width: 177)
                .background(Color.black)
                .overlay(Rectangle().strokeBorder(Color(hex: 0xE3F654), lineWidth: 2))
            }
        }
    }

    // MARK: Profilbild

    private var initialen: String {
        let i = "\(vorname.trimmingCharacters(in: .whitespaces).prefix(1))\(nachname.trimmingCharacters(in: .whitespaces).prefix(1))"
            .uppercased().filter { $0.isLetter || $0.isNumber }
        return i.isEmpty ? "P" : String(i.prefix(2))
    }

    @ViewBuilder private var profilbild: some View {
        if let b = ProfilDienst.bildAusDataURL(bildURL) {
            Image(uiImage: b).resizable().scaledToFill()
        } else if let url = FahrzeugKarte.bildURL(bildURL) {
            AsyncImage(url: url) { $0.image?.resizable().scaledToFill() }
        } else {
            Text(initialen).font(.grotesk(16, .bold)).tracking(0.5).foregroundStyle(Color(hex: 0xE3F654))
        }
    }

    private var profilbildKnopf: some View {
        VStack(alignment: .trailing, spacing: 6) {
            Button { bildMenueOffen.toggle() } label: {
                profilbild
                    .frame(width: 50, height: 50)
                    .background(Color.black)
                    .clipShape(Circle())
                    .overlay(Circle().stroke(Color(hex: 0x8B8B8D), lineWidth: 1))
            }
            .buttonStyle(.web)
            .accessibilityLabel("Profilbild Optionen")

            if bildMenueOffen {
                VStack(spacing: 0) {
                    menuePunkt("Profilbild anzeigen", farbe: Color(hex: 0xE3F654), linie: true) {
                        bildMenueOffen = false
                        if bildURL.isEmpty { bildFehler = "Kein Profilbild vorhanden." } else { bildVorschau = true }
                    }
                    menuePunkt("Neues Profilbild hochladen", farbe: Color(hex: 0xE3F654), linie: true) {
                        bildMenueOffen = false
                        bildWaehlen = true
                    }
                    menuePunkt("Profilbild entfernen", farbe: Color(hex: 0xF55757), linie: false) {
                        bildMenueOffen = false
                        bildURL = ""
                        Task { await speichernSpalte("avatar_url", "") }
                    }
                }
                .frame(width: 228)
                .background(Color.black)
                .overlay(Rectangle().strokeBorder(Color(hex: 0xE3F654), lineWidth: 2))
            }
        }
    }

    private func menuePunkt(_ text: String, farbe: Color, linie: Bool, aktion: @escaping () -> Void) -> some View {
        Button(action: aktion) {
            Text(text).font(.grotesk(14, .medium)).foregroundStyle(farbe)
                .padding(.horizontal, 16)
                .frame(maxWidth: .infinity, minHeight: 48, alignment: .leading)
                .overlay(alignment: .bottom) { if linie { Rectangle().fill(Color(hex: 0x5D6620)).frame(height: 1) } }
                .contentShape(Rectangle())
        }
        .buttonStyle(.web)
    }

    private var vorschau: some View {
        ZStack {
            Color.black.opacity(0.85).ignoresSafeArea()
            VStack(alignment: .leading, spacing: 16) {
                Text("Profilbild").font(.grotesk(18, .bold)).foregroundStyle(Color(hex: 0xE3F654))
                profilbild
                    .frame(width: 324, height: 324)
                    .background(Color(hex: 0x101108))
                    .clipped()
                    .overlay(Rectangle().stroke(Color(hex: 0x5D6620), lineWidth: 1))
                Button { bildVorschau = false } label: {
                    Text("Schließen").font(.grotesk(16, .medium)).foregroundStyle(Color(hex: 0x0E1008))
                        .frame(maxWidth: .infinity).frame(height: 48).background(Color(hex: 0xE3F654))
                }
                .buttonStyle(.web)
            }
            .padding(16)
            .frame(width: 360)
            .background(Color.black)
            .overlay(Rectangle().strokeBorder(Color(hex: 0xE3F654), lineWidth: 2))
        }
    }

    // MARK: Laden / Speichern

    private func laden() async {
        guard let id = anmeldung.fahrerID else { return }
        await dienst.laden(fahrerID: id)
        let d = dienst.daten
        vorname = d.first_name ?? ""
        nachname = d.last_name ?? ""
        email = dienst.email
        // normalizePhone: "+49 170 ..." -> Vorwahl und Rest
        let tel = (d.phone ?? "").trimmingCharacters(in: .whitespaces)
        if let r = tel.range(of: #"^\+\d{1,4}"#, options: .regularExpression) {
            vorwahl = String(tel[r])
            telefon = tel[r.upperBound...].trimmingCharacters(in: .whitespaces)
        } else {
            vorwahl = "+49"
            telefon = tel
        }
        strasse = d.street ?? ""
        hausnummer = d.street_number ?? ""
        ort = d.city ?? ""
        plz = d.zip ?? ""
        sprache = (d.language ?? "").isEmpty ? "Deutsch" : d.language!
        bildURL = d.avatar_url ?? ""
    }

    private func speichernSpalte(_ spalte: String, _ wert: String) async {
        guard let id = anmeldung.fahrerID else { return }
        await dienst.speichern(spalte, wert, fahrerID: id)
        if spalte == "first_name" || spalte == "last_name" { await anmeldung.profilLaden() }
    }

    private func speichern(_ feld: Feld) async {
        switch feld {
        case .vorname: await speichernSpalte("first_name", vorname)
        case .nachname: await speichernSpalte("last_name", nachname)
        case .email: await dienst.emailSpeichern(email)
        case .vorwahl, .telefon:
            await speichernSpalte("phone", "\((vorwahl.isEmpty ? "+49" : vorwahl).trimmingCharacters(in: .whitespaces)) \(telefon.trimmingCharacters(in: .whitespaces))")
        case .strasse: await speichernSpalte("street", strasse)
        case .hausnummer: await speichernSpalte("street_number", hausnummer)
        case .ort: await speichernSpalte("city", ort)
        case .plz: await speichernSpalte("zip", plz)
        }
    }

    private func bildUebernehmen(_ auswahl: PhotosPickerItem?) async {
        guard let auswahl else { return }
        guard let daten = try? await auswahl.loadTransferable(type: Data.self), let bild = UIImage(data: daten),
              let url = ProfilDienst.profilbildDataURL(bild) else {
            bildFehler = "Bitte eine Bilddatei auswählen."
            return
        }
        bildURL = url
        await speichernSpalte("avatar_url", url)
        bildAuswahl = nil
    }

    private func abmelden() {
        fokus = nil
        Task { await anmeldung.abmelden() }
    }
}
