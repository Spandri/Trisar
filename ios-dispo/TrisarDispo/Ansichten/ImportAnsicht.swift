import Supabase
import SwiftUI
import UniformTypeIdentifiers

/// ImportView.jsx: Fahrten (mode rides) oder Fahrgaeste (mode guests) aus beliebiger Tabelle.
/// Ablauf: Datei -> Erkennung (Server, dispo-admin) -> Zuordnung und Vorschau pruefen, jede Zeile aenderbar -> Import.
/// Jeder Import ist ein Stapel und laesst sich rueckgaengig machen.
struct ImportAnsicht: View {
    let modus: SpaltenErkennung.Modus
    /// backView: Fahrt erstellen bzw. Fahrgastliste.
    let zurueck: () -> Void
    /// zielView: Fahrtenliste bzw. Fahrgastliste.
    let zumZiel: () -> Void

    private enum Schritt { case datei, erkennung, zuordnung, fertig }

    @State private var schritt: Schritt = .datei
    @State private var quelle: (datei: String, name: String)?
    @State private var analyse: ImportDienst.Analyse?
    @State private var saetze: [ImportDienst.Satz] = []
    @State private var offen: Int?
    @State private var adressen: [String: ImportDienst.Adresse]?
    @State private var neuBerechnen = false
    @State private var fehler = ""
    @State private var ergebnis: ImportDienst.Ausgefuehrt?
    @State private var rueckgaengigText = ""
    @State private var importe: [ImportDienst.Import] = []
    @State private var beschaeftigt = false
    @State private var waehlen = false

    private let lime = Color(hex: 0xE3F654)
    private let limeHalb = Color(hex: 0xE3F654).opacity(0.7)
    private let orange = Color(hex: 0xFFCD8A)
    private let rot = Color(hex: 0xFF8A8A)
    private static let warnungen: Set<String> = ["doppelt", "vergangen", "adresseUnbekannt", "mehrNamenAlsPersonen", "gleicheAdresse", "emailUngueltig"]

    private var fahrten: Bool { modus == .fahrten }
    private var modusText: String { fahrten ? "rides" : "guests" }

    /// Saetze mit Adresshinweis (nur Anzeige).
    private var mitAdressen: [ImportDienst.Satz] {
        guard fahrten, let adressen else { return saetze }
        return saetze.map { s in
            var neu = s
            let unbekannt = ["pickup_address", "dropoff_address"].contains { k in
                let a = ImportDienst.text(s.daten[k]); return !a.isEmpty && adressen[a]?.gefunden == false
            }
            neu.hinweise.removeAll { $0 == "adresseUnbekannt" }
            if unbekannt { neu.hinweise.append("adresseUnbekannt") }
            return neu
        }
    }

    var body: some View {
        ZStack(alignment: .bottom) {
            DispoHintergrund().ignoresSafeArea()
            ScrollView(.vertical, showsIndicators: false) {
                VStack(alignment: .leading, spacing: 0) {
                    ZurueckKnopf(aktion: zurueck).frame(width: 50, height: 50)
                    StammTitel(text: t(fahrten ? "sonstige.fahrtenImportTitle" : "sonstige.kundenImportTitle"))
                        .padding(.top, 30)
                    switch schritt {
                    case .datei: dateiSchritt
                    case .erkennung: erkennungSchritt
                    case .zuordnung: zuordnungSchritt
                    case .fertig: fertigSchritt
                    }
                    if !fehler.isEmpty {
                        WebText(text: fehler, groesse: 12, gewicht: .medium, zeilenHoehe: 16, farbe: UIColor(hex: 0xFFCD8A))
                            .padding(.horizontal, 12).padding(.vertical, 8)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(Color(hex: 0x171717))
                            .overlay(Rectangle().strokeBorder(orange.opacity(0.6), lineWidth: 2))
                            .padding(.top, 16)
                    }
                }
                .padding(.horizontal, 20).padding(.top, 60).padding(.bottom, 90)
                .frame(maxWidth: 402, alignment: .leading)
                .frame(maxWidth: .infinity)
            }
            .contentMargins(.vertical, 0, for: .scrollContent)
            .scrollDismissesKeyboard(.interactively)
            .ignoresSafeArea()
            FussleisteUnten()
        }
        .fileImporter(isPresented: $waehlen, allowedContentTypes: Self.dateiTypen) { antwort in
            if case let .success(url) = antwort { dateiGewaehlt(url) }
        }
        .task { await listeLaden() }
    }

    private static let dateiTypen: [UTType] = [.commaSeparatedText, .tabSeparatedText, .plainText, .text, .spreadsheet]
        + ["xlsx", "xls", "xlsm", "ods"].compactMap { UTType(filenameExtension: $0) }

    // MARK: 1. Datei

    private var dateiSchritt: some View {
        VStack(alignment: .leading, spacing: 0) {
            WebText(text: t("imp.hinweis"), groesse: 13, gewicht: .medium, zeilenHoehe: 18, farbe: UIColor(hex: 0xE3F654).withAlphaComponent(0.7))
                .padding(.top, 24)
            Button { waehlen = true } label: {
                HStack(spacing: 0) {
                    Text(t("sonstige.dateiAuswaehlen")).font(.grotesk(16, .medium)).tracking(0.4).foregroundStyle(Color(hex: 0x1D1C1D))
                    Spacer(minLength: 0)
                    Image("import-datei").resizable().frame(width: 42, height: 40)
                }
                .padding(.horizontal, 16)
                .frame(maxWidth: .infinity).frame(height: 56)
                .background(lime)
                .contentShape(Rectangle())
            }
            .buttonStyle(.web)
            .padding(.top, 24)

            if !importe.isEmpty {
                Text(t("imp.letzteImporte")).font(.grotesk(13, .medium)).foregroundStyle(limeHalb).padding(.top, 28)
                VStack(spacing: 6) {
                    ForEach(importe) { imp in
                        HStack(spacing: 8) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(imp.dateiname ?? "—").font(.grotesk(13, .medium)).foregroundStyle(.white).lineLimit(1)
                                Text("\(Self.zeitpunkt(imp.erstellt)) · " + (imp.rueckgaengig != nil ? t("imp.wurdeRueckgaengig")
                                    : t("imp.nochDa", ["n": "\(imp.vorhanden)", "gesamt": "\(imp.anzahl)"])))
                                    .font(.grotesk(11, .medium)).foregroundStyle(.white.opacity(0.45)).lineLimit(1)
                            }
                            Spacer(minLength: 0)
                            if imp.rueckgaengig == nil && imp.vorhanden > 0 {
                                Button { Task { await rueckgaengig(imp.id) } } label: {
                                    Text(t("imp.rueckgaengigKurz")).font(.grotesk(12, .medium)).underline().foregroundStyle(orange)
                                }
                                .buttonStyle(.web).disabled(beschaeftigt)
                            }
                        }
                        .padding(.horizontal, 12).padding(.vertical, 8)
                        .background(Color(hex: 0x0F0F0F))
                        .overlay(Rectangle().strokeBorder(.white.opacity(0.12), lineWidth: 2))
                    }
                }
                .padding(.top, 10)
                if !rueckgaengigText.isEmpty {
                    Text(rueckgaengigText).font(.grotesk(12, .medium)).foregroundStyle(Color(hex: 0x8DFFAF)).padding(.top, 8)
                }
            }
        }
    }

    // MARK: 2. Erkennung

    private var erkennungSchritt: some View {
        VStack(spacing: 0) {
            ImportFunken(pulsieren: true).foregroundStyle(lime)
            Text(t("imp.erkennt")).font(.grotesk(18, .bold)).foregroundStyle(lime).padding(.top, 14)
            Text(quelle?.name ?? "").font(.grotesk(12, .medium)).foregroundStyle(.white.opacity(0.5)).padding(.top, 6)
        }
        .multilineTextAlignment(.center)
        .frame(maxWidth: .infinity)
        .padding(.top, 40)
    }

    // MARK: 3. Zuordnung und Vorschau

    @ViewBuilder private var zuordnungSchritt: some View {
        if let analyse {
            let liste = mitAdressen
            let bereit = liste.filter { !$0.aus && $0.fehlt.isEmpty }
            let unvollstaendig = liste.filter { !$0.aus && !$0.fehlt.isEmpty }
            let zugeordnet = analyse.spalten.filter { analyse.zuordnung["\($0.index)"] != nil }.count
            VStack(alignment: .leading, spacing: 0) {
                HStack {
                    Text(analyse.dateiname).font(.grotesk(12, .medium)).foregroundStyle(.white.opacity(0.5)).lineLimit(1).padding(.trailing, 12)
                    Spacer(minLength: 0)
                    Button(action: neuStarten) {
                        Text(t("imp.andereDatei")).font(.grotesk(12, .medium)).underline().foregroundStyle(lime)
                    }
                    .buttonStyle(.web)
                }
                .padding(.top, 20)

                if analyse.blaetter.count > 1 {
                    Text(t("imp.blatt")).font(.grotesk(11, .medium)).foregroundStyle(.white.opacity(0.5)).padding(.top, 14)
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 6) {
                            ForEach(analyse.blaetter, id: \.self) { b in
                                let aktiv = b.index == analyse.blatt
                                Button { if !aktiv { neuAuswerten(blatt: b.index, zuordnung: nil) } } label: {
                                    Text(b.name).font(.grotesk(12, .medium))
                                        .foregroundStyle(aktiv ? .black : .white.opacity(0.7))
                                        .padding(.horizontal, 12).frame(height: 30)
                                        .background(aktiv ? lime : .clear)
                                        .overlay(Rectangle().strokeBorder(aktiv ? lime : .white.opacity(0.3), lineWidth: 1))
                                }
                                .buttonStyle(.web)
                            }
                        }
                    }
                    .padding(.top, 6)
                }
                if analyse.vorlage != nil {
                    hinweisBalken(t("imp.vorlageGenutzt", ["name": analyse.vorlage?.name ?? ""]), Color(hex: 0x8DFFAF))
                }
                if analyse.llama?.genutzt == true {
                    hinweisBalken(t("imp.llamaGenutzt"), orange)
                }

                HStack(spacing: 10) {
                    ImportFunken(pulsieren: false)
                    VStack(alignment: .leading, spacing: 4) {
                        Text(t("imp.zuordnung")).font(.grotesk(20, .bold)).frame(height: 20)
                        Text(t("imp.zugeordnetVon", ["n": "\(zugeordnet)", "gesamt": "\(analyse.spalten.count)"]))
                            .font(.grotesk(12, .medium)).foregroundStyle(limeHalb)
                    }
                }
                .foregroundStyle(lime)
                .padding(.top, 20)

                if let fehlt = analyse.fehlendeZuordnung, !fehlt.isEmpty {
                    WebText(text: t("imp.pflichtFehlt", ["felder": fehlt.map(feldText).joined(separator: ", ")]),
                            groesse: 12, gewicht: .medium, zeilenHoehe: 16, farbe: UIColor(hex: 0xFFCD8A))
                        .padding(.top, 10)
                }

                VStack(spacing: 8) {
                    ForEach(analyse.spalten) { spaltenKarte($0, analyse) }
                }
                .padding(.top, 14)

                Text(t("imp.vorschau")).font(.grotesk(20, .bold)).foregroundStyle(lime).padding(.top, 24)
                (Text(t("imp.bereit", ["n": "\(bereit.count)"])).foregroundColor(limeHalb)
                    + Text(unvollstaendig.isEmpty ? "" : " · " + t("imp.unvollstaendigKurz", ["n": "\(unvollstaendig.count)"])).foregroundColor(rot))
                    .font(.grotesk(12, .medium)).padding(.top, 4)
                if fahrten {
                    Text(adressStand).font(.grotesk(11, .medium)).foregroundStyle(.white.opacity(0.45)).padding(.top, 2)
                }

                VStack(alignment: .leading, spacing: 6) {
                    ForEach(Array(liste.enumerated()), id: \.offset) { i, satz in zeilenKarte(i, satz) }
                }
                .padding(.top, 10)

                Button { Task { await importieren(bereit) } } label: {
                    HStack(spacing: 0) {
                        Text(beschaeftigt ? t("sonstige.uebernehme")
                            : t(fahrten ? "imp.fahrtenImportieren" : "imp.gaesteImportieren", ["n": "\(bereit.count)"]))
                            .font(.grotesk(16, .medium)).tracking(0.4).foregroundStyle(Color(hex: 0x1D1C1D))
                        Spacer(minLength: 0)
                        Image("Arrow_Trisar_Icons_01").resizable().frame(width: 34, height: 20)
                    }
                    .padding(.horizontal, 16)
                    .frame(maxWidth: .infinity).frame(height: 56)
                    .background(lime)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.web)
                .disabled(beschaeftigt || bereit.isEmpty)
                .opacity(beschaeftigt || bereit.isEmpty ? 0.4 : 1)
                .padding(.top, 16)
                if !unvollstaendig.isEmpty {
                    WebText(text: t("imp.unvollstaendigHinweis"), groesse: 11, gewicht: .medium, zeilenHoehe: 15,
                            farbe: UIColor.white.withAlphaComponent(0.45))
                        .padding(.top, 6)
                }
            }
            .opacity(neuBerechnen ? 0.5 : 1)
            .allowsHitTesting(!neuBerechnen)
        }
    }

    private var adressStand: String {
        guard let adressen else { return t("imp.adressenPruefen") }
        return t("imp.adressenOk", ["n": "\(adressen.values.filter(\.gefunden).count)", "gesamt": "\(adressen.count)"])
    }

    private func hinweisBalken(_ text: String, _ farbe: Color) -> some View {
        HStack(spacing: 10) {
            Rectangle().fill(farbe).frame(width: 2)
            WebText(text: text, groesse: 12, gewicht: .medium, zeilenHoehe: 16, farbe: UIColor(farbe))
        }
        .fixedSize(horizontal: false, vertical: true)
        .padding(.top, 14)
    }

    private func spaltenKarte(_ spalte: ImportDienst.Spalte, _ analyse: ImportDienst.Analyse) -> some View {
        let feld = analyse.zuordnung["\(spalte.index)"] ?? ""
        let sicher = !feld.isEmpty && (spalte.sicherheit >= 0.8 || spalte.grund?.vorlage == true)
        let pruefen = !feld.isEmpty && !sicher
        return VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 8) {
                Text(spalte.titel).font(.grotesk(15, .bold)).foregroundStyle(feld.isEmpty ? .white.opacity(0.55) : lime).lineLimit(1)
                Spacer(minLength: 0)
                if sicher { abzeichen(t("imp.sicher"), lime) }
                if pruefen { abzeichen(t("imp.pruefen"), orange) }
            }
            Text(spalte.beispiele.prefix(3).joined(separator: " · "))
                .font(.grotesk(11, .medium)).foregroundStyle(.white.opacity(0.45)).lineLimit(1)
                .padding(.top, 3)
            Menu {
                Button(t("imp.nichtImportieren")) { zuordnen(spalte.index, "") }
                ForEach(analyse.felder, id: \.self) { f in
                    Button(t("imp.feld.\(f)")) { zuordnen(spalte.index, f) }
                }
            } label: {
                HStack(spacing: 0) {
                    Text(feld.isEmpty ? t("imp.nichtImportieren") : t("imp.feld.\(feld)"))
                        .font(.grotesk(14, .medium)).foregroundStyle(feld.isEmpty ? .white.opacity(0.6) : lime).lineLimit(1)
                    Spacer(minLength: 0)
                    Text("▾").font(.system(size: 12)).foregroundStyle(feld.isEmpty ? .white.opacity(0.5) : lime)
                }
                .padding(.horizontal, 12)
                .frame(maxWidth: .infinity).frame(height: 38)
                .background(Color.black)
                .overlay(Rectangle().strokeBorder(feld.isEmpty ? .white.opacity(0.25) : lime, lineWidth: 1))
                .contentShape(Rectangle())
            }
            .padding(.top, 8)
            WebText(text: grundText(spalte, feld), groesse: 10, gewicht: .medium, zeilenHoehe: 13, farbe: UIColor.white.withAlphaComponent(0.4))
                .padding(.top, 6)
        }
        .padding(.horizontal, 12).padding(.vertical, 10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(hex: 0x0F0F0F))
        .overlay(Rectangle().strokeBorder(feld.isEmpty ? .white.opacity(0.12) : lime.opacity(0.55), lineWidth: 2))
    }

    private func abzeichen(_ text: String, _ farbe: Color) -> some View {
        Text(text).font(.grotesk(10, .bold)).foregroundStyle(.black)
            .padding(.horizontal, 8).frame(height: 20).background(farbe)
    }

    private func grundText(_ s: ImportDienst.Spalte, _ feld: String) -> String {
        guard !feld.isEmpty else { return t("imp.keinTreffer") }
        if s.grund?.vorlage == true { return t("imp.grundVorlage") }
        if s.grund?.llama == true { return t("imp.grundLlama") }
        var teile: [String] = []
        if let k = s.grund?.kopf { teile.append(t("imp.grundKopf", ["titel": k])) }
        if let w = s.grund?.werte { teile.append(t("imp.grundWerte", ["anteil": "\(s.grund?.anteil ?? 0)", "art": t("imp.art.\(w)")])) }
        return teile.isEmpty ? t("imp.vonHandGeaendert") : teile.joined(separator: " · ")
    }

    // MARK: Vorschau-Zeilen

    private func zeilenKarte(_ i: Int, _ satz: ImportDienst.Satz) -> some View {
        let warnt = satz.hinweise.contains { Self.warnungen.contains($0) }
        let rand: Color = satz.aus ? .white.opacity(0.1) : !satz.fehlt.isEmpty ? rot : warnt ? orange : lime.opacity(0.4)
        let istOffen = offen == i
        return VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .top, spacing: 10) {
                Button { saetze[i].aus.toggle() } label: {
                    Image(systemName: satz.aus ? "square" : "checkmark.square.fill")
                        .font(.system(size: 18)).foregroundStyle(satz.aus ? .white.opacity(0.4) : lime)
                }
                .buttonStyle(.web)
                .accessibilityLabel(t("imp.mitImportieren"))
                Button { offen = istOffen ? nil : i } label: {
                    VStack(alignment: .leading, spacing: 1) {
                        Text(titel(satz)).font(.grotesk(14, .medium)).foregroundStyle(lime).lineLimit(1)
                        let d = detail(satz)
                        if !d.isEmpty { Text(d).font(.grotesk(11, .medium)).foregroundStyle(.white.opacity(0.5)).lineLimit(1) }
                        if !satz.fehlt.isEmpty {
                            Text(t("imp.fehltFeld", ["felder": satz.fehlt.map(feldText).joined(separator: ", ")]))
                                .font(.grotesk(11, .medium)).foregroundStyle(rot)
                        }
                        if !satz.hinweise.isEmpty {
                            Text(satz.hinweise.map { hinweisText($0, satz) }.joined(separator: " · "))
                                .font(.grotesk(11, .medium)).foregroundStyle(warnt ? orange : .white.opacity(0.45))
                                .multilineTextAlignment(.leading)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.web)
                Text(istOffen ? "▴" : "✎").font(.system(size: 11)).foregroundStyle(.white.opacity(0.4))
            }
            .padding(.horizontal, 12).padding(.vertical, 8)
            if istOffen { editor(i).padding(.horizontal, 12).padding(.bottom, 12) }
        }
        .background(Color(hex: 0x0F0F0F))
        .overlay(Rectangle().strokeBorder(rand, lineWidth: 2))
        .opacity(satz.aus ? 0.5 : 1)
    }

    @ViewBuilder private func editor(_ i: Int) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Rectangle().fill(.white.opacity(0.1)).frame(height: 1)
            if fahrten {
                HStack(spacing: 8) {
                    eingabe(feldText("datum"), wert(i, "ride_date"), platzhalter: "2027-01-31") { v in
                        let iso = Self.datumIso(v); aendern(i, ["ride_date": iso.isEmpty ? .null : .string(iso)])
                    }
                    eingabe(feldText("uhrzeit"), String(wert(i, "etd").prefix(5)), platzhalter: "14:30") { v in
                        let z = Self.uhrzeit(v)
                        aendern(i, ["etd": z.isEmpty ? .null : .string("\(z):00"), "original_etd": z.isEmpty ? .null : .string("\(z):00")])
                    }
                }
                eingabe(feldText("abholort"), wert(i, "pickup_address")) { v in
                    aendern(i, ["pickup_address": .string(v), "pickup_name": .string(ImportDienst.kurzname(v))])
                }
                eingabe(feldText("zielort"), wert(i, "dropoff_address")) { v in
                    aendern(i, ["dropoff_address": .string(v), "dropoff_name": .string(ImportDienst.kurzname(v))])
                }
                HStack(spacing: 8) {
                    eingabe(feldText("flugnummer"), wert(i, "flight_number").isEmpty ? wert(i, "train_number") : wert(i, "flight_number")) { v in
                        let zug = v.range(of: "^(ICE|IC|EC|RJ|RE|RB)\\s?\\d", options: [.regularExpression, .caseInsensitive]) != nil
                        aendern(i, zug ? ["train_number": .string(v), "flight_number": .null] : ["flight_number": .string(v), "train_number": .null])
                    }
                    eingabe(feldText("anzahl"), wert(i, "anzahl"), tastatur: .numberPad) { v in
                        aendern(i, ["anzahl": Int(v).map { .integer($0) } ?? .null])
                    }
                }
                eingabe(feldText("gaeste"), ImportDienst.namen(saetze[i].daten["passengers"]).joined(separator: ", ")) { v in
                    let namen = v.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
                    aendern(i, ["passengers": .array(namen.map { .string($0) })])
                }
                eingabe(feldText("notiz"), wert(i, "note")) { v in aendern(i, ["note": .string(v)]) }
                if let adressen {
                    ForEach(["pickup_address", "dropoff_address"], id: \.self) { k in
                        let a = wert(i, k)
                        if let treffer = adressen[a], treffer.gefunden, let name = treffer.name {
                            Text("\(a) → \(name)").font(.grotesk(10, .medium)).foregroundStyle(.white.opacity(0.4))
                        }
                    }
                }
            } else {
                HStack(spacing: 8) {
                    eingabe(feldText("vorname"), wert(i, "first_name")) { v in aendern(i, ["first_name": .string(v)]) }
                    eingabe(feldText("nachname"), wert(i, "last_name")) { v in aendern(i, ["last_name": .string(v)]) }
                }
                eingabe(feldText("email"), wert(i, "email"), tastatur: .emailAddress) { v in aendern(i, ["email": v.isEmpty ? .null : .string(v)]) }
                HStack(spacing: 8) {
                    eingabe(feldText("telefon"), wert(i, "phone"), tastatur: .phonePad) { v in aendern(i, ["phone": v.isEmpty ? .null : .string(v)]) }
                    eingabe(feldText("firma"), wert(i, "company")) { v in aendern(i, ["company": v.isEmpty ? .null : .string(v)]) }
                }
            }
        }
    }

    private func eingabe(_ label: String, _ wert: String, platzhalter: String = "", tastatur: UIKeyboardType = .default,
                         aendern: @escaping (String) -> Void) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(label).font(.grotesk(10, .medium)).foregroundStyle(.white.opacity(0.5))
            TextField("", text: Binding(get: { wert }, set: aendern),
                      prompt: Text(platzhalter).foregroundStyle(.white.opacity(0.25)))
                .font(.grotesk(13, .medium)).foregroundStyle(.white)
                .keyboardType(tastatur)
                .autocorrectionDisabled()
                .textInputAutocapitalization(.never)
                .padding(.horizontal, 8).frame(height: 34)
                .background(Color.black)
                .overlay(Rectangle().strokeBorder(.white.opacity(0.25), lineWidth: 1))
        }
        .frame(maxWidth: .infinity)
    }

    private func wert(_ i: Int, _ k: String) -> String { ImportDienst.text(saetze[i].daten[k]) }

    private func aendern(_ i: Int, _ werte: [String: AnyJSON]) {
        guard saetze.indices.contains(i) else { return }
        for (k, v) in werte { saetze[i].daten[k] = v }
        ImportDienst.pruefen(&saetze[i], gaeste: !fahrten)
    }

    private func titel(_ s: ImportDienst.Satz) -> String {
        let d = s.daten
        if fahrten {
            let ab = ImportDienst.text(d["pickup_name"]).isEmpty ? ImportDienst.text(d["pickup_address"]) : ImportDienst.text(d["pickup_name"])
            let an = ImportDienst.text(d["dropoff_name"]).isEmpty ? ImportDienst.text(d["dropoff_address"]) : ImportDienst.text(d["dropoff_name"])
            let zeit = ImportDienst.text(d["etd"]).prefix(5)
            return "\(zeit.isEmpty ? "--:--" : String(zeit)) \(ab.isEmpty ? "—" : ab) → \(an.isEmpty ? "—" : an)"
        }
        let n = "\(ImportDienst.text(d["first_name"])) \(ImportDienst.text(d["last_name"]))".trimmingCharacters(in: .whitespaces)
        return n.isEmpty ? "—" : n
    }

    private func detail(_ s: ImportDienst.Satz) -> String {
        let d = s.daten
        if fahrten {
            let datum = ImportDienst.text(d["ride_date"])
            let kurz = datum.count == 10 ? "\(datum.suffix(2)).\(datum.dropFirst(5).prefix(2)).\(datum.dropFirst(2).prefix(2))" : datum
            let flug = ImportDienst.text(d["flight_number"]).isEmpty ? ImportDienst.text(d["train_number"]) : ImportDienst.text(d["flight_number"])
            let anzahl = ImportDienst.text(d["anzahl"])
            return [kurz, flug, ImportDienst.namen(d["passengers"]).joined(separator: ", "), anzahl.isEmpty ? "" : "\(anzahl) P."]
                .filter { !$0.isEmpty }.joined(separator: " · ")
        }
        return ["company", "email", "phone"].map { ImportDienst.text(d[$0]) }.filter { !$0.isEmpty }.joined(separator: " · ")
    }

    private func hinweisText(_ h: String, _ s: ImportDienst.Satz) -> String {
        h == "mehrereZeilen" ? t("imp.h.mehrereZeilen", ["n": "\(s.zeilen.count)"]) : t("imp.h.\(h)")
    }

    private func feldText(_ f: String) -> String { t("imp.feld.\(f == "name" ? "vollname" : f)") }

    // MARK: 4. Fertig

    private var fertigSchritt: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(t(fahrten ? "imp.fahrtenImportiert" : "imp.gaesteImportiert", ["n": "\(ergebnis?.anzahl ?? 0)"]))
                .font(.grotesk(18, .bold)).foregroundStyle(Color(hex: 0x8DFFAF))
                .padding(.top, 28)
            Button(action: zumZiel) {
                HStack(spacing: 0) {
                    Text(t(fahrten ? "imp.zuDenFahrten" : "imp.zuDenFahrgaesten"))
                        .font(.grotesk(16, .medium)).tracking(0.4).foregroundStyle(Color(hex: 0x1D1C1D))
                    Spacer(minLength: 0)
                    Image("Arrow_Trisar_Icons_01").resizable().frame(width: 34, height: 20)
                }
                .padding(.horizontal, 16)
                .frame(maxWidth: .infinity).frame(height: 56)
                .background(lime)
                .contentShape(Rectangle())
            }
            .buttonStyle(.web)
            .padding(.top, 20)
            randKnopf(t("imp.weitereDatei"), lime, aktion: neuStarten)
            if let id = ergebnis?.import_id, rueckgaengigText.isEmpty {
                randKnopf(t("imp.rueckgaengig"), orange) { Task { await rueckgaengig(id) } }
                    .disabled(beschaeftigt)
            }
            if !rueckgaengigText.isEmpty {
                Text(rueckgaengigText).font(.grotesk(13, .medium)).foregroundStyle(Color(hex: 0x8DFFAF)).padding(.top, 10)
            }
            // Weitere Blaetter derselben Datei (schon importierte Fahrten kommen als Dublette abgewaehlt).
            if let analyse, analyse.blaetter.count > 1, quelle != nil {
                ForEach(analyse.blaetter.filter { $0.index != analyse.blatt }, id: \.self) { b in
                    randKnopf(t("imp.blattImportieren", ["name": b.name]), lime) {
                        ergebnis = nil
                        rueckgaengigText = ""
                        schritt = .erkennung
                        neuAuswerten(blatt: b.index, zuordnung: nil, erster: true)
                    }
                }
            }
        }
    }

    private func randKnopf(_ text: String, _ farbe: Color, aktion: @escaping () -> Void) -> some View {
        Button(action: aktion) {
            Text(text).font(.grotesk(14, .medium)).foregroundStyle(farbe)
                .padding(.horizontal, 16)
                .frame(maxWidth: .infinity, alignment: .leading).frame(height: 48)
                .overlay(Rectangle().strokeBorder(farbe, lineWidth: 2))
                .contentShape(Rectangle())
        }
        .buttonStyle(.web)
        .padding(.top, 10)
    }

    // MARK: Ablauf

    private func dateiGewaehlt(_ url: URL) {
        fehler = ""
        let zugriff = url.startAccessingSecurityScopedResource()
        defer { if zugriff { url.stopAccessingSecurityScopedResource() } }
        guard let daten = try? Data(contentsOf: url) else {
            fehler = t("imp.fehler.datei_unlesbar"); return
        }
        guard daten.count <= 8 * 1024 * 1024 else { fehler = t("imp.fehler.datei_zu_gross"); return }
        quelle = (daten.base64EncodedString(), url.lastPathComponent)
        schritt = .erkennung
        neuAuswerten(blatt: nil, zuordnung: nil, erster: true)
    }

    private func neuAuswerten(blatt: Int?, zuordnung: [String: String]?, erster: Bool = false) {
        guard let quelle else { return }
        fehler = ""
        if !erster { neuBerechnen = true }
        let modus = modusText
        Task {
            async let pause: Void = erster ? ((try? await Task.sleep(for: .milliseconds(900))) ?? ()) : ()
            do {
                let a = try await ImportDienst.analysieren(modus: modus, datei: quelle.datei, dateiname: quelle.name,
                                                           blatt: blatt, zuordnung: zuordnung)
                _ = await pause
                analyse = a
                saetze = a.datensaetze.map { var s = $0; s.aus = s.hinweise.contains("doppelt"); return s }
                offen = nil
                adressen = nil
                schritt = .zuordnung
                neuBerechnen = false
                if fahrten { await adressenPruefen(a) }
            } catch {
                _ = await pause
                fehler = fehlerText(error)
                neuBerechnen = false
                if erster { schritt = .datei }
            }
        }
    }

    private func adressenPruefen(_ a: ImportDienst.Analyse) async {
        var gesehen = Set<String>()
        let liste = a.datensaetze.flatMap { [ImportDienst.text($0.daten["pickup_address"]), ImportDienst.text($0.daten["dropoff_address"])] }
            .filter { !$0.isEmpty && gesehen.insert($0).inserted }
        let ergebnis = (try? await ImportDienst.adressen(liste)) ?? [:]
        if analyse?.signatur == a.signatur && analyse?.blatt == a.blatt { adressen = ergebnis }
    }

    /// Ein Feld gehoert immer nur einer Spalte, wird es anderswo gewaehlt, verliert die alte Spalte die Zuordnung.
    private func zuordnen(_ spaltenIndex: Int, _ feld: String) {
        guard let analyse else { return }
        let belegtVon: [String: [String]] = ["datumUhrzeit": ["datum", "uhrzeit"], "vollname": ["vorname", "nachname"]]
        let belegt = belegtVon[feld] ?? []
        var neu = analyse.zuordnung
        for (idx, f) in analyse.zuordnung {
            let kollidiert = f == feld || belegt.contains(f) || (belegtVon[f] ?? []).contains(feld)
            if !feld.isEmpty && kollidiert && idx != "\(spaltenIndex)" { neu.removeValue(forKey: idx) }
        }
        if feld.isEmpty { neu.removeValue(forKey: "\(spaltenIndex)") } else { neu["\(spaltenIndex)"] = feld }
        neuAuswerten(blatt: analyse.blatt, zuordnung: neu)
    }

    private func importieren(_ bereit: [ImportDienst.Satz]) async {
        guard let analyse, !bereit.isEmpty else { return }
        beschaeftigt = true
        fehler = ""
        defer { beschaeftigt = false }
        var vorlage: [String: String] = [:]
        for s in analyse.spalten where s.ohneTitel != true {
            if let f = analyse.zuordnung["\(s.index)"] { vorlage[ImportDienst.schluessel(s.titel)] = f }
        }
        do {
            ergebnis = try await ImportDienst.ausfuehren(modus: modusText, datensaetze: bereit.map(\.daten),
                                                         dateiname: analyse.dateiname, signatur: analyse.signatur, vorlage: vorlage)
            rueckgaengigText = ""
            schritt = .fertig
            await listeLaden()
        } catch {
            fehler = t("sonstige.importFehlgeschlagen", ["message": fehlerText(error)])
        }
    }

    private func rueckgaengig(_ id: String) async {
        beschaeftigt = true
        defer { beschaeftigt = false }
        do {
            let r = try await ImportDienst.rueckgaengig(id)
            rueckgaengigText = t("imp.rueckgaengigFertig", ["n": "\(r.geloescht)"])
                + (r.behalten > 0 ? " " + t("imp.rueckgaengigBehalten", ["n": "\(r.behalten)"]) : "")
            await listeLaden()
        } catch {
            fehler = fehlerText(error)
        }
    }

    private func listeLaden() async {
        importe = (try? await ImportDienst.liste(modus: modusText)) ?? []
    }

    private func neuStarten() {
        schritt = .datei
        analyse = nil
        saetze = []
        quelle = nil
        fehler = ""
        ergebnis = nil
        rueckgaengigText = ""
        adressen = nil
    }

    private func fehlerText(_ e: Error) -> String {
        let code = (e as? ImportDienst.Fehler)?.code ?? e.localizedDescription
        if ["datei_zu_gross", "datei_unlesbar", "datei_leer", "nichts_zu_importieren"].contains(code) { return t("imp.fehler.\(code)") }
        if code == "not_signed_in" { return "Sitzung abgelaufen. Bitte einmal abmelden und neu anmelden." }
        if code == "not_dispo" { return "Keine Berechtigung für den Import." }
        return t("sonstige.dateiLesenFehler", ["message": code])
    }

    // MARK: Eingaben lesen

    /// "31.01.2027", "31.1.27" oder "2027-01-31" -> "2027-01-31".
    static func datumIso(_ v: String) -> String {
        let t = v.trimmingCharacters(in: .whitespaces)
        if t.range(of: "^\\d{4}-\\d{2}-\\d{2}$", options: .regularExpression) != nil { return t }
        let teile = t.split(whereSeparator: { $0 == "." || $0 == "/" }).map(String.init)
        guard teile.count == 3, let tag = Int(teile[0]), let monat = Int(teile[1]), var jahr = Int(teile[2]),
              (1...31).contains(tag), (1...12).contains(monat) else { return "" }
        if jahr < 100 { jahr += 2000 }
        return String(format: "%04d-%02d-%02d", jahr, monat, tag)
    }

    /// "14:30", "14.30", "1430" -> "14:30".
    static func uhrzeit(_ v: String) -> String {
        let ziffern = v.filter(\.isNumber)
        guard ziffern.count >= 3, ziffern.count <= 4, let n = Int(ziffern) else { return "" }
        let std = n / 100, min = n % 100
        guard std < 24, min < 60 else { return "" }
        return String(format: "%02d:%02d", std, min)
    }

    static func zeitpunkt(_ iso: String) -> String {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let d = f.date(from: iso) ?? ISO8601DateFormatter().date(from: iso)
        guard let d else { return "" }
        return d.formatted(.dateTime.day(.twoDigits).month(.twoDigits).year(.twoDigits).hour().minute())
    }

    // MARK: Texte aus admin/src/i18n/de.js

    private func t(_ k: String, _ w: [String: String] = [:]) -> String {
        var s = Self.texte[k] ?? k
        for (a, b) in w { s = s.replacingOccurrences(of: "{\(a)}", with: b) }
        return s
    }

    private static let texte: [String: String] = [
        "sonstige.fahrtenImportTitle": "Fahrten Import",
        "sonstige.kundenImportTitle": "Kunden Import",
        "sonstige.dateiAuswaehlen": "Datei auswählen",
        "sonstige.dateiLesenFehler": "Datei konnte nicht gelesen werden: {message}",
        "sonstige.importFehlgeschlagen": "Import fehlgeschlagen: {message}",
        "sonstige.uebernehme": "Übernehme ...",
        "imp.andereDatei": "Andere Datei",
        "imp.art.anzahl": "Personenzahlen",
        "imp.art.datum": "Datumsangaben",
        "imp.art.datumUhrzeit": "Datum mit Uhrzeit",
        "imp.art.email": "E-Mail-Adressen",
        "imp.art.flug": "Flugnummern",
        "imp.art.flughafenCode": "Flughafenkürzel",
        "imp.art.freitext": "Freitext",
        "imp.art.janein": "Ja/Nein",
        "imp.art.name": "Namen",
        "imp.art.ort": "Orte und Adressen",
        "imp.art.plz": "Postleitzahlen",
        "imp.art.telefon": "Telefonnummern",
        "imp.art.uhrzeit": "Uhrzeiten",
        "imp.art.zug": "Zugnummern",
        "imp.bereit": "{n} bereit",
        "imp.erkennt": "Spalten werden erkannt …",
        "imp.fahrtenImportieren": "{n} Fahrten importieren",
        "imp.fahrtenImportiert": "{n} Fahrten importiert.",
        "imp.feld.abholort": "Abholort",
        "imp.feld.anzahl": "Anzahl Personen",
        "imp.feld.datum": "Datum",
        "imp.feld.datumUhrzeit": "Datum & Uhrzeit",
        "imp.feld.email": "E-Mail",
        "imp.feld.firma": "Firma",
        "imp.feld.flugnummer": "Flug- / Zugnummer",
        "imp.feld.gaeste": "Fahrgäste",
        "imp.feld.gepaeck": "Gepäck",
        "imp.feld.herkunft": "Abflugort",
        "imp.feld.kindersitz": "Kindersitz",
        "imp.feld.nachname": "Nachname",
        "imp.feld.notiz": "Notiz",
        "imp.feld.plz": "PLZ",
        "imp.feld.rollstuhl": "Rollstuhl",
        "imp.feld.sprache": "Sprache",
        "imp.feld.stadt": "Stadt",
        "imp.feld.strasse": "Straße",
        "imp.feld.telefon": "Telefon",
        "imp.feld.uhrzeit": "Abholzeit",
        "imp.feld.vip": "VIP",
        "imp.feld.vollname": "Name",
        "imp.feld.vorname": "Vorname",
        "imp.feld.zielort": "Zielort",
        "imp.feld.zugnummer": "Zugnummer",
        "imp.gaesteImportieren": "{n} Fahrgäste importieren",
        "imp.gaesteImportiert": "{n} Fahrgäste importiert.",
        "imp.grundKopf": "Überschrift „{titel}“",
        "imp.grundWerte": "{anteil} % der Werte: {art}",
        "imp.grundVorlage": "Wie beim letzten Import dieser Tabelle",
        "imp.grundLlama": "Von Llama vorgeschlagen, durch die Werte bestätigt",
        "imp.hinweis": "Beliebige Tabelle aus Excel (.xlsx, .xls) oder CSV, auch mit mehreren Blättern. Die Spalten werden erkannt, du prüfst den Vorschlag, ergänzt fehlende Angaben und importierst. Jeder Import lässt sich rückgängig machen.",
        "imp.keinTreffer": "Keine passende Bedeutung erkannt",
        "imp.nichtImportieren": "Nicht importieren",
        "imp.pruefen": "prüfen",
        "imp.sicher": "sicher",
        "imp.vonHandGeaendert": "Von Hand zugeordnet",
        "imp.vorschau": "Vorschau",
        "imp.weitereDatei": "Weitere Datei importieren",
        "imp.zuDenFahrgaesten": "Zu den Fahrgästen",
        "imp.zuDenFahrten": "Zu den Fahrten",
        "imp.zugeordnetVon": "{n} von {gesamt} Spalten zugeordnet",
        "imp.zuordnung": "Zuordnung",
        "imp.blatt": "Tabellenblatt",
        "imp.vorlageGenutzt": "Zuordnung wie beim letzten Import dieser Tabelle ({name}).",
        "imp.llamaGenutzt": "Llama hat Spalten zugeordnet, die die Regeln nicht sicher erkannt haben. Bitte die markierten Spalten prüfen.",
        "imp.pflichtFehlt": "Keiner Spalte zugeordnet: {felder}. Spalte zuordnen oder in den Zeilen ergänzen.",
        "imp.unvollstaendigKurz": "{n} unvollständig",
        "imp.unvollstaendigHinweis": "Rot markierte Zeilen fehlen Angaben. Zeile antippen und ergänzen, sonst werden sie nicht importiert.",
        "imp.fehltFeld": "Fehlt: {felder}",
        "imp.mitImportieren": "Mit importieren",
        "imp.adressenPruefen": "Adressen werden geprüft …",
        "imp.adressenOk": "{n} von {gesamt} Adressen auf der Karte gefunden",
        "imp.h.doppelt": "schon im System, darum abgewählt",
        "imp.h.vergangen": "Datum liegt in der Vergangenheit",
        "imp.h.mehrereZeilen": "aus {n} Zeilen zusammengefasst",
        "imp.h.datumUebernommen": "Datum aus der Zeile darüber",
        "imp.h.adresseUnbekannt": "Adresse nicht auf der Karte gefunden",
        "imp.h.mehrNamenAlsPersonen": "mehr Namen als Personen",
        "imp.h.gleicheAdresse": "Abholort und Ziel sind gleich",
        "imp.h.emailUngueltig": "E-Mail-Adresse ungültig",
        "imp.h.llama": "von Llama gelesen",
        "imp.h.datumAusDatei": "Datum aus dem Kopf der Datei",
        "imp.h.zielAusDatei": "Ziel aus dem Kopf der Datei",
        "imp.blattImportieren": "Blatt „{name}“ importieren",
        "imp.letzteImporte": "Letzte Importe",
        "imp.nochDa": "{n} von {gesamt} noch da",
        "imp.wurdeRueckgaengig": "rückgängig gemacht",
        "imp.rueckgaengig": "Import rückgängig machen",
        "imp.rueckgaengigKurz": "Rückgängig",
        "imp.rueckgaengigFertig": "{n} wieder entfernt.",
        "imp.rueckgaengigBehalten": "{n} schon begonnen oder gefahren, die bleiben.",
        "imp.fehler.datei_zu_gross": "Die Datei ist größer als 8 MB.",
        "imp.fehler.datei_unlesbar": "Die Datei lässt sich nicht lesen. Bitte als .xlsx oder .csv speichern und erneut versuchen.",
        "imp.fehler.datei_leer": "In der Datei wurden keine Datenzeilen gefunden.",
        "imp.fehler.nichts_zu_importieren": "Keine vollständige Zeile zum Importieren.",
    ]
}

/// FunkenIcon aus ImportView.jsx (viewBox 29 x 29.14, Strich 2), mit animate-pulse waehrend der Erkennung.
private struct ImportFunken: View {
    let pulsieren: Bool
    @State private var halb = false

    var body: some View {
        ImportFunkenForm()
            .stroke(style: StrokeStyle(lineWidth: 2 * 22 / 29.14))
            .frame(width: 22, height: 22)
            .opacity(pulsieren && halb ? 0.5 : 1)
            .onAppear {
                guard pulsieren else { return }
                withAnimation(.easeInOut(duration: 1).repeatForever(autoreverses: true)) { halb = true }
            }
    }
}

private struct ImportFunkenForm: Shape {
    /// Jeder Bogen ist "M p0 S c2 p1": erster Kontrollpunkt = Startpunkt.
    private static let boegen: [(CGPoint, CGPoint, CGPoint)] = [
        (.init(x: 12.08, y: 29.07), .init(x: 11.27, y: 16.99), .init(x: 0, y: 16.99)),
        (.init(x: 12.08, y: 4.9), .init(x: 12.89, y: 16.99), .init(x: 24.17, y: 16.99)),
        (.init(x: 12.08, y: 4.9), .init(x: 11.27, y: 16.99), .init(x: 0, y: 16.99)),
        (.init(x: 12.08, y: 29.07), .init(x: 12.89, y: 16.99), .init(x: 24.17, y: 16.99)),
        (.init(x: 22.96, y: 12.15), .init(x: 22.55, y: 6.11), .init(x: 16.92, y: 6.11)),
        (.init(x: 22.96, y: 12.15), .init(x: 23.36, y: 6.11), .init(x: 29, y: 6.11)),
        (.init(x: 22.96, y: 0.07), .init(x: 22.55, y: 6.11), .init(x: 16.92, y: 6.11)),
        (.init(x: 22.96, y: 0.07), .init(x: 23.36, y: 6.11), .init(x: 29, y: 6.11)),
    ]

    func path(in rect: CGRect) -> Path {
        // viewBox 29 x 29.14 mittig in das Quadrat (preserveAspectRatio meet).
        let s = min(rect.width / 29, rect.height / 29.14)
        let dx = rect.minX + (rect.width - 29 * s) / 2, dy = rect.minY + (rect.height - 29.14 * s) / 2
        let p = { (q: CGPoint) in CGPoint(x: dx + q.x * s, y: dy + q.y * s) }
        var pfad = Path()
        for (a, c2, b) in Self.boegen {
            pfad.move(to: p(a))
            pfad.addCurve(to: p(b), control1: p(a), control2: p(c2))
        }
        return pfad
    }
}
