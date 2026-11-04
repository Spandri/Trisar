import Supabase
import SwiftUI

/// Kunden-Bereich der Dispo: Fahrgastliste (AlleKunden.jsx) und Anlegen/Bearbeiten
/// (FahrgastErstellenView.jsx). KundenListeView.jsx ist im Web nur eine Beispielseite
/// mit festen Daten ohne Einstieg, die live genutzte Liste ist AlleKunden.
struct KundenBereichAnsicht: View {
    let zeigen: (DispoZiel) -> Void
    @State private var seite: Seite = .liste

    enum Seite: Hashable { case liste, erstellen, bearbeiten(StammFahrgast), importieren }

    var body: some View {
        Group {
            switch seite {
            case .liste:
                KundenListeSeite(zeigen: zeigen, erstellen: { seite = .erstellen }, bearbeiten: { seite = .bearbeiten($0) },
                                 importieren: { seite = .importieren })
            case .erstellen:
                FahrgastFormularSeite(gast: nil, zurueck: { seite = .liste })
            case let .bearbeiten(g):
                FahrgastFormularSeite(gast: g, zurueck: { seite = .liste })
            case .importieren:
                // ImportView mode guests: zurueck und "Zu den Fahrgästen" fuehren beide in die Liste.
                ImportAnsicht(modus: .gaeste, zurueck: { seite = .liste }, zumZiel: { seite = .liste })
            }
        }
        .id(seite)
        .transition(.opacity)
        .animation(.easeOut(duration: 0.15), value: seite)
    }
}

// MARK: - Liste

struct KundenListeSeite: View {
    let zeigen: (DispoZiel) -> Void
    let erstellen: () -> Void
    let bearbeiten: (StammFahrgast) -> Void
    let importieren: () -> Void
    @StateObject private var dienst = FahrgaesteDienst()
    @State private var suche = ""

    private var gefiltert: [StammFahrgast] {
        let q = suche.trimmingCharacters(in: .whitespaces).lowercased()
        guard !q.isEmpty else { return dienst.gaeste }
        return dienst.gaeste.filter { [$0.name, $0.email, $0.phone].contains { $0.lowercased().contains(q) } }
    }

    var body: some View {
        let liste = gefiltert
        let listeHoehe = listenHoehe(liste.count)
        ZStack(alignment: .topLeading) {
            Leinwand(basisHoehe: 874, inhaltHoehe: 446 + listeHoehe + 24 + 157, mitHintergrund: false) { rahmen in
                ZStack(alignment: .topLeading) {
                    DispoHintergrund().frame(width: 402, height: rahmen)
                    ZurueckKnopf { zeigen(.start) }.platz(20, 60, 50, 50)
                    StammTitel(text: "Fahrgäste").platz(20, 140)

                    Button(action: importieren) {
                        HStack(spacing: 0) {
                            Text("Kunden importieren").font(.grotesk(16, .medium)).tracking(0.5).foregroundStyle(Color(hex: 0xE3F654))
                            Spacer(minLength: 0)
                            Image("Import_Trisar_Icons_01_Lime").resizable().frame(width: 24, height: 24)
                        }
                        .padding(.horizontal, 16)
                        .frame(width: 362, height: 56)
                        .overlay(Rectangle().strokeBorder(Color(hex: 0xE3F654), lineWidth: 2))
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .platz(20, 206, 362, 56)

                    HStack(spacing: 0) {
                        TextField("", text: $suche, prompt: Text(verbatim: "Kunden Suchen").foregroundStyle(Color(hex: 0xE3F654).opacity(0.9)))
                            .font(.grotesk(16, .medium)).tracking(0.5)
                            .foregroundStyle(Color(hex: 0xE3F654))
                            .tint(Color(hex: 0xE3F654))
                            .autocorrectionDisabled()
                            .textInputAutocapitalization(.never)
                        Image("karten-filter-search").resizable().frame(width: 24, height: 24)
                    }
                    .padding(.horizontal, 16)
                    .frame(width: 362, height: 56)
                    .overlay(Rectangle().strokeBorder(Color(hex: 0xE3F654), lineWidth: 2))
                    .platz(20, 274, 362, 56)

                    Button(action: erstellen) {
                        HStack(spacing: 0) {
                            HStack(spacing: 10) {
                                Image("Person_Trisar_Icons_01").resizable().frame(width: 16, height: 19)
                                Text("Fahrgast erstellen").font(.grotesk(16, .medium)).tracking(0.5).foregroundStyle(Color(hex: 0x1D1C1D))
                            }
                            Spacer(minLength: 0)
                            Image("alle-kunden-add-cross").resizable().frame(width: 20, height: 20)
                        }
                        .padding(.horizontal, 18)
                        .frame(width: 362, height: 56)
                        .background(Color(hex: 0xE3F654))
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .platz(20, 342, 362, 56)

                    // Dunkle Flaeche mit runden oberen Ecken ueber die volle Breite.
                    UnevenRoundedRectangle(topLeadingRadius: 16, topTrailingRadius: 16)
                        .fill(Color(hex: 0x17181B))
                        .platz(0, 422, 402, 24 + listeHoehe + 24)

                    VStack(alignment: .leading, spacing: 12) {
                        if dienst.laedt {
                            Text("Fahrgäste werden geladen ...").font(.grotesk(16, .medium)).foregroundStyle(Color(hex: 0xE3F654))
                        }
                        if !dienst.laedt && !dienst.fehler.isEmpty {
                            WebText(text: dienst.fehler, groesse: 13, gewicht: .medium, zeilenHoehe: 13 * 1.4, farbe: UIColor(hex: 0xFF8E8E))
                                .padding(16)
                                .frame(width: 362, alignment: .leading)
                                .background(Color(hex: 0x171717))
                                .overlay(Rectangle().strokeBorder(Color(hex: 0x3A3A3A), lineWidth: 1))
                        }
                        if !dienst.laedt && dienst.fehler.isEmpty && liste.isEmpty {
                            Text("Keine Fahrgäste gefunden.").font(.grotesk(16, .medium)).foregroundStyle(Color(hex: 0xE3F654))
                        }
                        ForEach(liste) { g in
                            Button { bearbeiten(g) } label: { FahrgastKarte(gast: g) }.buttonStyle(.plain)
                        }
                    }
                    .platz(20, 446, 362, nil)
                }
            }
            // Im Web activeTab="home": die Kundenliste hat keinen eigenen Reiter.
            Navileiste(aktiv: .start, waehlen: zeigen)
        }
        .task {
            await dienst.laden()
            await dienst.beobachten()
        }
        .onDisappear { Task { await dienst.beenden() } }
    }

    private func listenHoehe(_ anzahl: Int) -> CGFloat {
        var bloecke: [CGFloat] = []
        if dienst.laedt { bloecke.append(21) }
        if !dienst.laedt && !dienst.fehler.isEmpty { bloecke.append(90) }
        if !dienst.laedt && dienst.fehler.isEmpty && anzahl == 0 { bloecke.append(21) }
        bloecke += Array(repeating: 96, count: anzahl)
        return bloecke.reduce(0, +) + CGFloat(max(0, bloecke.count - 1)) * 12
    }
}

/// CustomerCard aus AlleKunden.jsx: weiss 362 x 96, drei Zeilen links, Stift rechts.
struct FahrgastKarte: View {
    let gast: StammFahrgast
    var body: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 5) {
                Text("Fahrgast").font(.grotesk(12, .medium)).tracking(0.3)
                    .foregroundStyle(Color(hex: 0x18181B).opacity(0.8)).frame(height: 16)
                Text(gast.name).font(.grotesk(16, .bold)).tracking(0.4)
                    .foregroundStyle(Color(hex: 0x18181B)).lineLimit(1).truncationMode(.tail).frame(height: 24)
                Text(gast.email.isEmpty ? (gast.phone.isEmpty ? "-" : gast.phone) : gast.email)
                    .font(.grotesk(14, .medium)).tracking(-0.35)
                    .foregroundStyle(Color(hex: 0x71717A)).lineLimit(1).truncationMode(.tail).frame(height: 20)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            Image("Edit_Trisar_Icon_01").resizable().frame(width: 15, height: 15)
        }
        .padding(.leading, 16).padding(.trailing, 18).padding(.vertical, 10)
        .frame(width: 362, height: 96)
        .background(Color.white)
        .contentShape(Rectangle())
    }
}

// MARK: - Anlegen / Bearbeiten

struct FahrgastFormularSeite: View {
    let gast: StammFahrgast?
    let zurueck: () -> Void

    @State private var vorname = ""
    @State private var nachname = ""
    @State private var telefon = ""
    @State private var email = ""
    @State private var vorwahl = "+49"
    @State private var strasse = ""
    @State private var hausnummer = ""
    @State private var ort = ""
    @State private var plz = ""
    @State private var sprache = "Deutsch"
    @State private var notiz = ""
    @State private var vip = false
    @State private var barrierefrei = false
    @State private var kindersitz = false
    @State private var gepaeck = false
    @State private var spracheOffen = false
    @State private var speichert = false
    @State private var rueckmeldung = ""

    /// GUEST_LANGUAGES: gespeichert wird der deutsche Klarname.
    private static let sprachen = ["Deutsch", "Englisch", "Spanisch", "Franzoesisch", "Italienisch", "Portugiesisch", "Niederlaendisch", "Polnisch"]

    private var bearbeiten: Bool { !(gast?.id ?? "").isEmpty }

    var body: some View {
        let feedbackHoehe: CGFloat = rueckmeldung.isEmpty ? 0 : 12 + 24 + 16 * CGFloat(rueckmeldung.split(separator: "\n").count)
        Leinwand(basisHoehe: 874, inhaltHoehe: 1010 + feedbackHoehe + 40 + 32, mitHintergrund: false) { rahmen in
            ZStack(alignment: .topLeading) {
                DispoHintergrund().frame(width: 402, height: rahmen)
                ZurueckKnopf(aktion: zurueck).platz(20, 60, 50, 50)
                StammTitel(text: bearbeiten ? "Fahrgast bearbeiten" : "Fahrgast erstellen", abstand: -0.5).platz(20, 140)

                eingabe("Vorname", $vorname).platz(20, 206, 177, 56)
                eingabe("Nachname", $nachname).platz(205, 206, 177, 56)
                eingabe("E-Mail", $email, rechts: 48, tastatur: .emailAddress)
                    .overlay(alignment: .trailing) {
                        Image("lucide-mail").resizable().frame(width: 20, height: 20)
                            .foregroundStyle(Color(hex: 0xE3F654)).padding(.trailing, 16).allowsHitTesting(false)
                    }
                    .platz(20, 274, 362, 56)
                eingabe("+49", $vorwahl, tastatur: .phonePad).platz(20, 342, 90, 56)
                eingabe("Telefon", $telefon, tastatur: .phonePad).platz(118, 342, 264, 56)
                eingabe("Strasse", $strasse).platz(20, 410, 268, 56)
                eingabe("Nr.", $hausnummer).platz(296, 410, 86, 56)
                eingabe("Ort", $ort).platz(20, 478, 362, 56)
                eingabe("PLZ", $plz, tastatur: .numberPad).platz(20, 546, 177, 56)

                Button { spracheOffen.toggle() } label: {
                    HStack {
                        Text(sprache).font(.grotesk(16, .medium)).foregroundStyle(Color(hex: 0xE3F654))
                        Spacer(minLength: 0)
                        Image("lucide-chevron-down").resizable().frame(width: 22, height: 22).foregroundStyle(Color(hex: 0xE3F654))
                    }
                    .padding(.horizontal, 16)
                    .frame(width: 177, height: 56)
                    .overlay(Rectangle().strokeBorder(Color(hex: 0xE3F654), lineWidth: 2))
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .platz(205, 546, 177, 56)

                let schalter: [(String, Binding<Bool>)] = [("lucide-star", $vip), ("lucide-accessibility", $barrierefrei),
                                                            ("lucide-baby", $kindersitz), ("lucide-baggage-claim", $gepaeck)]
                ForEach(0 ..< 4, id: \.self) { i in
                    let an = schalter[i].1.wrappedValue
                    Button { schalter[i].1.wrappedValue.toggle() } label: {
                        Image(schalter[i].0).resizable().frame(width: 22, height: 22)
                            .foregroundStyle(Color(hex: an ? 0xE3F654 : 0x7F8A2B))
                            .frame(width: 84.5, height: 48)
                            .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(Color(hex: an ? 0xE3F654 : 0x7F8A2B), lineWidth: 2))
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .platz(20 + CGFloat(i) * (84.5 + 8), 614, 84.5, 48)
                }

                notizBlock.platz(20, 692, 362, 224)

                Button(action: speichern) {
                    HStack {
                        Text(speichert ? "Speichern ..." : (bearbeiten ? "Fahrgast speichern" : "Fahrgast erstellen"))
                            .font(.grotesk(18, .bold)).foregroundStyle(.black)
                        Spacer(minLength: 0)
                        Image("Arrow_Nav_Trisar_Icons_01").resizable().frame(width: 34, height: 20)
                    }
                    .padding(.horizontal, 20)
                    .frame(width: 362, height: 64)
                    .background(Color(hex: 0xE3F654))
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .disabled(speichert)
                .platz(20, 946, 362, 64)

                if !rueckmeldung.isEmpty {
                    Text(rueckmeldung).font(.grotesk(12)).foregroundStyle(Color(hex: 0xE3F654))
                        .padding(12)
                        .frame(width: 362, alignment: .leading)
                        .background(RoundedRectangle(cornerRadius: 12).fill(Color(hex: 0x17181C)))
                        .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Color(hex: 0x2A2A2D), lineWidth: 1))
                        .platz(20, 1022, 362, nil)
                }

                // Sprachliste liegt ueber den Schaltern (z-20 im Web).
                if spracheOffen {
                    VStack(spacing: 0) {
                        ForEach(Self.sprachen, id: \.self) { s in
                            Button {
                                sprache = s
                                spracheOffen = false
                            } label: {
                                Text(s).font(.grotesk(14, .bold)).foregroundStyle(Color(hex: 0xE3F654))
                                    .padding(.horizontal, 12).padding(.vertical, 8)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                    .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .background(Color(hex: 0x161618))
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                    .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(Color(hex: 0xE3F654), lineWidth: 1))
                    .platz(205, 606, 177, nil)
                }
            }
        }
        .overlay { FussleisteUnten() }
        .task { await laden() }
    }

    private func eingabe(_ platzhalter: String, _ wert: Binding<String>, rechts: CGFloat = 16,
                         tastatur: UIKeyboardType = .default) -> some View {
        TextField("", text: wert, prompt: Text(verbatim: platzhalter).foregroundStyle(Color(hex: 0xE3F654).opacity(0.6)))
            .font(.grotesk(16, .medium))
            .foregroundStyle(Color(hex: 0xE3F654))
            .tint(Color(hex: 0xE3F654))
            .keyboardType(tastatur)
            .textInputAutocapitalization(tastatur == .emailAddress ? .never : .words)
            .autocorrectionDisabled()
            .padding(.leading, 16).padding(.trailing, rechts)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .overlay(Rectangle().strokeBorder(Color(hex: 0xE3F654), lineWidth: 2))
    }

    /// Notizen: dunkle Karte, darin weisses Blatt mit Ueberschrift und Textfeld.
    private var notizBlock: some View {
        ZStack(alignment: .topLeading) {
            RoundedRectangle(cornerRadius: 12).fill(Color(hex: 0x1A1A1A))
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Text("Notizen").font(.grotesk(16, .bold)).tracking(0.5).foregroundStyle(Color(hex: 0x1D1C1D))
                    Spacer(minLength: 0)
                    Image("Arrow-kurz_Trisar_Icons_01_Lime").resizable().frame(width: 10, height: 13)
                }
                ZStack(alignment: .topLeading) {
                    if notiz.isEmpty {
                        Text("Schreiben...").font(.grotesk(14)).tracking(0.25)
                            .foregroundStyle(Color(red: 129 / 255, green: 129 / 255, blue: 129 / 255, opacity: 0.5))
                            .padding(.top, 1)
                            .allowsHitTesting(false)
                    }
                    TextEditor(text: $notiz)
                        .font(.grotesk(14)).tracking(0.25)
                        .foregroundStyle(Color(red: 129 / 255, green: 129 / 255, blue: 129 / 255, opacity: 0.5))
                        .scrollContentBackground(.hidden)
                        .background(Color.clear)
                        .contentMargins(.all, 0, for: .scrollContent)
                        .textEditorStyle(.plain)
                }
            }
            .padding(16)
            .background(Color.white)
            .platz(20, 20, 322, 184)
        }
    }

    /// hydrate: erst Werte aus der Liste, dann die volle Zeile aus guests.
    private func laden() async {
        rueckmeldung = ""
        guard bearbeiten, let g = gast else { return }
        vorname = g.firstName
        nachname = g.lastName
        telefon = g.phone
        email = g.email
        strasse = g.street
        hausnummer = g.streetNumber
        ort = g.city
        plz = g.zip
        sprache = g.language.isEmpty ? "Deutsch" : g.language
        notiz = g.notes
        guard let d = await FahrgaesteDienst.einzeln(g.id) else { return }
        // normalizePhone: "+49 170 ..." -> Vorwahl und Rest.
        let tel = d.text("phone")
        if tel.isEmpty {
            vorwahl = "+49"; telefon = ""
        } else if let r = tel.range(of: #"^\+\d{1,4}"#, options: .regularExpression) {
            vorwahl = String(tel[r]); telefon = tel[r.upperBound...].trimmingCharacters(in: .whitespaces)
        } else {
            vorwahl = "+49"; telefon = tel
        }
        vorname = d.text("first_name")
        nachname = d.text("last_name")
        email = d.text("email")
        strasse = d.text("street")
        hausnummer = d.text("street_number")
        ort = d.text("city")
        plz = d.text("zip")
        let spr = d.text("language")
        sprache = spr.isEmpty ? "Deutsch" : spr
        let n = d.text("notes")
        notiz = n.isEmpty ? d.text("note_text") : n
        vip = d.wahr("is_vip") || d.wahr("vip_status")
        barrierefrei = d.wahr("needs_accessibility")
        kindersitz = d.wahr("needs_child_seat")
        gepaeck = d.wahr("needs_luggage")
    }

    private func leeren() {
        vorname = ""; nachname = ""; telefon = ""; email = ""
        vorwahl = "+49"; strasse = ""; hausnummer = ""; ort = ""; plz = ""; sprache = "Deutsch"; notiz = ""
        vip = false; barrierefrei = false; kindersitz = false; gepaeck = false
    }

    /// createGuest: Pflicht Vor- und Nachname, Telefon = Vorwahl + Nummer, Notiz in notes und note_text.
    private func speichern() {
        let vn = vorname.trimmingCharacters(in: .whitespacesAndNewlines)
        let nn = nachname.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !vn.isEmpty, !nn.isEmpty else {
            rueckmeldung = "Bitte Vorname und Nachname angeben."
            return
        }
        func feld(_ s: String) -> AnyJSON {
            let t = s.trimmingCharacters(in: .whitespacesAndNewlines)
            return t.isEmpty ? .null : .string(t)
        }
        let tel = "\(vorwahl) \(telefon)".trimmingCharacters(in: .whitespaces)
        let inhalt: [String: AnyJSON] = [
            "first_name": .string(vn),
            "last_name": .string(nn),
            "phone": tel.isEmpty ? .null : .string(tel),
            "email": feld(email),
            "street": feld(strasse),
            "street_number": feld(hausnummer),
            "city": feld(ort),
            "zip": feld(plz),
            "language": .string(sprache.isEmpty ? "Deutsch" : sprache),
            "notes": feld(notiz),
            "note_text": feld(notiz),
            "is_vip": .bool(vip),
            "vip_status": .bool(vip),
            "needs_accessibility": .bool(barrierefrei),
            "needs_child_seat": .bool(kindersitz),
            "needs_luggage": .bool(gepaeck),
        ]
        speichert = true
        rueckmeldung = ""
        let id = bearbeiten ? gast?.id : nil
        Task {
            if let fehler = await FahrgaesteDienst.speichern(inhalt, id: id) {
                rueckmeldung = "Fahrgast konnte nicht gespeichert werden: \(fehler)"
            } else {
                rueckmeldung = id != nil ? "Fahrgast gespeichert." : "Fahrgast angelegt."
                if id == nil { leeren() }
            }
            speichert = false
        }
    }
}
