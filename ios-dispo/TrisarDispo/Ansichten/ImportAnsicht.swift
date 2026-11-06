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
    @State private var spaltenOffen = false

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
                .padding(.horizontal, 20).padding(.top, 60).padding(.bottom, schritt == .zuordnung ? 170 : 90)
                .frame(maxWidth: 402, alignment: .leading)
                .frame(maxWidth: .infinity)
            }
            .contentMargins(.vertical, 0, for: .scrollContent)
            .scrollDismissesKeyboard(.interactively)
            .ignoresSafeArea()
            FussleisteUnten()
            if schritt == .zuordnung && analyse != nil { importLeiste.padding(.bottom, 40) }
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

    // MARK: 3. Pruefen: Zahlen, Chips, Spalten (zugeklappt), Fahrten pro Tag als Karten

    private var bereitListe: [ImportDienst.Satz] { mitAdressen.filter { !$0.aus && $0.fehlt.isEmpty } }

    private func personen(_ s: ImportDienst.Satz) -> Int {
        max(ImportDienst.namen(s.daten["passengers"]).count, Int(ImportDienst.text(s.daten["anzahl"])) ?? 0)
    }

    /// Nach Tag gruppiert, innerhalb nach Uhrzeit. Ohne Datum zuerst.
    private var gruppen: [(tag: String, eintraege: [(index: Int, satz: ImportDienst.Satz)])] {
        let liste = mitAdressen.enumerated().map { (index: $0.offset, satz: $0.element) }
        guard fahrten else { return [(tag: "alle", eintraege: liste)] }
        let nachTag = Dictionary(grouping: liste) { ImportDienst.text($0.satz.daten["ride_date"]) }
        return nachTag.keys.sorted { a, b in a.isEmpty ? true : (b.isEmpty ? false : a < b) }.map { tag in
            (tag: tag, eintraege: (nachTag[tag] ?? []).sorted { ImportDienst.text($0.satz.daten["etd"]) < ImportDienst.text($1.satz.daten["etd"]) })
        }
    }

    @ViewBuilder private var zuordnungSchritt: some View {
        if let analyse {
            let liste = mitAdressen
            let bereit = bereitListe
            let unvollstaendig = liste.filter { !$0.aus && !$0.fehlt.isEmpty }.count
            let pruefen = bereit.filter { $0.hinweise.contains { Self.warnungen.contains($0) } }.count
            let aus = liste.filter(\.aus).count
            let tage = gruppen.filter { !$0.tag.isEmpty && $0.tag != "alle" }.count
            let gaeste = bereit.reduce(0) { $0 + personen($1) }
            VStack(alignment: .leading, spacing: 0) {
                HStack {
                    Text(analyse.dateiname).font(.grotesk(12, .medium)).foregroundStyle(.white.opacity(0.5)).lineLimit(1).padding(.trailing, 12)
                    Spacer(minLength: 0)
                    Button(action: neuStarten) {
                        Text(t("imp.andereDatei")).font(.grotesk(12, .medium)).underline().foregroundStyle(lime)
                    }
                    .buttonStyle(.web)
                }
                .padding(.top, 16)

                if analyse.blaetter.count > 1 {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 6) {
                            ForEach(analyse.blaetter, id: \.self) { b in
                                let aktiv = b.index == analyse.blatt
                                Button { if !aktiv { neuAuswerten(blatt: b.index, zuordnung: nil) } } label: {
                                    Text(b.name + ((b.fahrten ?? 0) > 0 && !aktiv ? " · \(b.fahrten ?? 0)" : ""))
                                        .font(.grotesk(12, .medium)).lineLimit(1)
                                        .foregroundStyle(aktiv ? .black : .white.opacity(0.7))
                                        .padding(.horizontal, 12).frame(height: 30)
                                        .background(aktiv ? lime : .clear)
                                        .overlay(Rectangle().strokeBorder(aktiv ? lime : .white.opacity(0.3), lineWidth: 1))
                                }
                                .buttonStyle(.web)
                            }
                        }
                        .padding(.horizontal, 20)
                    }
                    .padding(.horizontal, -20)
                    .padding(.top, 12)
                }

                // Ueberblick in Zahlen
                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 3), spacing: 8) {
                    kachel(bereit.count, t(fahrten ? "imp.k.fahrten" : "imp.k.gaeste"), hell: true)
                    if fahrten {
                        kachel(tage, t(tage == 1 ? "imp.k.tag" : "imp.k.tage"))
                        kachel(gaeste, t("imp.k.gaeste"))
                    }
                    if unvollstaendig > 0 { kachel(unvollstaendig, t("imp.k.fehlt"), farbe: rot) }
                    if pruefen > 0 { kachel(pruefen, t("imp.k.pruefen"), farbe: orange) }
                    if aus > 0 { kachel(aus, t("imp.k.aus"), farbe: .white.opacity(0.35)) }
                }
                .padding(.top, 16)

                // Herkunft als kurze Chips
                FlussZeilen(abstand: 6).callAsFunction {
                    if let d = analyse.kontext?.datum, d.count == 10 {
                        chip(t("imp.c.datum", ["datum": "\(d.suffix(2)).\(d.dropFirst(5).prefix(2)).\(d.prefix(4))"]), lime)
                    }
                    if let z = analyse.kontext?.ziel { chip(t("imp.c.ziel", ["ziel": ImportDienst.kurzname(z)]), lime) }
                    if analyse.vorlage != nil { chip(t("imp.c.vorlage"), Color(hex: 0x8DFFAF)) }
                    if analyse.llama?.genutzt == true { chip(t("imp.c.llama"), orange) }
                    if fahrten {
                        chip(adressen.map { a in t("imp.c.adressen", ["n": "\(a.values.filter(\.gefunden).count)", "gesamt": "\(a.count)"]) }
                             ?? t("imp.c.adressenLaeuft"), .white.opacity(0.6))
                    }
                }
                .padding(.top, 10)

                spaltenKopf(analyse)
                if spaltenOffen || !(analyse.fehlendeZuordnung ?? []).isEmpty {
                    VStack(spacing: 6) { ForEach(analyse.spalten) { spaltenZeile($0, analyse) } }.padding(.top, 8)
                }

                // Fahrten nach Tagen
                VStack(spacing: 12) {
                    ForEach(Array(gruppen.enumerated()), id: \.offset) { gi, g in
                        if fahrten { tagKopf(g.tag, erster: gi == 0, saetze: g.eintraege.map(\.satz)) }
                        ForEach(g.eintraege, id: \.index) { e in karte(e.index, e.satz) }
                    }
                }
                .padding(.top, 22)
            }
            .opacity(neuBerechnen ? 0.5 : 1)
            .allowsHitTesting(!neuBerechnen)
        }
    }

    /// Fester Importknopf ueber der Fusszeile.
    private var importLeiste: some View {
        let bereit = bereitListe
        return Button { Task { await importieren(bereit) } } label: {
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
        .disabled(beschaeftigt || bereit.isEmpty || neuBerechnen)
        .opacity(beschaeftigt || bereit.isEmpty ? 0.4 : 1)
        .padding(.horizontal, 20).padding(.top, 18).padding(.bottom, 10)
        .frame(maxWidth: 402)
        .frame(maxWidth: .infinity)
        .background(LinearGradient(colors: [.black.opacity(0), .black.opacity(0.95), .black], startPoint: .top, endPoint: .bottom))
    }

    private func kachel(_ zahl: Int, _ text: String, hell: Bool = false, farbe: Color? = nil) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text("\(zahl)").font(.grotesk(26, .bold)).foregroundStyle(hell ? .black : (farbe ?? lime))
            Text(text).font(.grotesk(11, .medium)).foregroundStyle(hell ? .black.opacity(0.7) : .white.opacity(0.55)).lineLimit(1)
        }
        .padding(.horizontal, 12)
        .frame(maxWidth: .infinity, alignment: .leading).frame(height: 64)
        .background(hell ? lime : Color(hex: 0x0F0F0F))
        .overlay(Rectangle().strokeBorder(hell ? .clear : (farbe ?? lime.opacity(0.35)), lineWidth: 1))
    }

    private func chip(_ text: String, _ farbe: Color) -> some View {
        Text(text).font(.grotesk(11, .medium)).foregroundStyle(farbe).lineLimit(1)
            .padding(.horizontal, 8).frame(height: 24)
            .overlay(Rectangle().strokeBorder(farbe, lineWidth: 1))
    }

    private func spaltenKopf(_ analyse: ImportDienst.Analyse) -> some View {
        let fehlt = analyse.fehlendeZuordnung ?? []
        let zugeordnet = analyse.spalten.filter { analyse.zuordnung["\($0.index)"] != nil }.count
        let offen = spaltenOffen || !fehlt.isEmpty
        return Button { spaltenOffen.toggle() } label: {
            HStack(spacing: 10) {
                ImportFunken(pulsieren: false)
                Text(t("imp.spalten")).font(.grotesk(15, .bold))
                Spacer(minLength: 0)
                Text((fehlt.isEmpty ? t("imp.erkanntVon", ["n": "\(zugeordnet)", "gesamt": "\(analyse.spalten.count)"])
                      : t("imp.fehltKurz", ["felder": fehlt.map(feldText).joined(separator: ", ")])) + (offen ? " ▴" : " ▾"))
                    .font(.grotesk(12, .medium)).foregroundStyle(fehlt.isEmpty ? lime.opacity(0.75) : orange).lineLimit(1)
            }
            .foregroundStyle(lime)
            .padding(.horizontal, 16).frame(height: 48)
            .background(Color.black.opacity(0.4))
            .overlay(Rectangle().strokeBorder(fehlt.isEmpty ? lime.opacity(0.45) : orange, lineWidth: 2))
            .contentShape(Rectangle())
        }
        .buttonStyle(.web)
        .padding(.top, 14)
    }

    private func spaltenZeile(_ spalte: ImportDienst.Spalte, _ analyse: ImportDienst.Analyse) -> some View {
        let feld = analyse.zuordnung["\(spalte.index)"] ?? ""
        let sicher = !feld.isEmpty && (spalte.sicherheit >= 0.8 || spalte.grund?.vorlage == true)
        return HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 1) {
                Text(spalte.titel).font(.grotesk(14, .bold)).foregroundStyle(feld.isEmpty ? .white.opacity(0.55) : lime).lineLimit(1)
                Text(spalte.beispiele.prefix(2).joined(separator: " · ")).font(.grotesk(11, .medium)).foregroundStyle(.white.opacity(0.4)).lineLimit(1)
            }
            Spacer(minLength: 0)
            Menu {
                Section(grundText(spalte, feld)) {
                    Button(t("imp.nichtImportieren")) { zuordnen(spalte.index, "") }
                    ForEach(analyse.felder, id: \.self) { f in Button(t("imp.feld.\(f)")) { zuordnen(spalte.index, f) } }
                }
            } label: {
                HStack(spacing: 0) {
                    Text(feld.isEmpty ? t("imp.nichtImportieren") : t("imp.feld.\(feld)"))
                        .font(.grotesk(13, .medium)).foregroundStyle(feld.isEmpty ? .white.opacity(0.55) : lime).lineLimit(1)
                    Spacer(minLength: 0)
                    Text("▾").font(.system(size: 11)).foregroundStyle(feld.isEmpty ? .white.opacity(0.5) : lime)
                }
                .padding(.horizontal, 8).frame(width: 150, height: 34)
                .background(Color.black)
                .overlay(Rectangle().strokeBorder(feld.isEmpty ? .white.opacity(0.25) : lime, lineWidth: 1))
            }
        }
        .padding(.horizontal, 12).padding(.vertical, 8)
        .background(Color(hex: 0x0F0F0F))
        .overlay(Rectangle().strokeBorder(feld.isEmpty ? .white.opacity(0.12) : (sicher ? lime.opacity(0.45) : orange), lineWidth: 1))
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

    /// Trennzeile wie in „Alle Fahrten“, darunter die Zahl der Fahrten und Gaeste des Tages.
    private func tagKopf(_ tag: String, erster: Bool, saetze: [ImportDienst.Satz]) -> some View {
        let aktiv = saetze.filter { !$0.aus }
        let farbe = tag.isEmpty ? rot : lime
        let gaeste = aktiv.reduce(0) { $0 + personen($1) }
        return VStack(spacing: 2) {
            HStack(spacing: 0) {
                Rectangle().fill(farbe).frame(width: 44, height: 2)
                Spacer(minLength: 0)
                Text(tag.isEmpty ? t("imp.ohneDatum") : Datum.trennzeile(tag))
                    .font(.grotesk(26, .bold)).tracking(-0.5).foregroundStyle(farbe).lineLimit(1)
                Spacer(minLength: 0)
                Rectangle().fill(farbe).frame(width: 44, height: 2)
            }
            Text(t(aktiv.count == 1 ? "imp.tagEine" : "imp.tagViele", ["n": "\(aktiv.count)"])
                 + (gaeste > 0 ? " · " + t("imp.tagGaeste", ["n": "\(gaeste)"]) : ""))
                .font(.grotesk(12, .medium)).foregroundStyle(lime.opacity(0.7))
        }
        .padding(.top, erster ? 0 : 12)
    }

    // MARK: Fahrt-Karte wie in „Alle Fahrten“

    private func karte(_ i: Int, _ s: ImportDienst.Satz) -> some View {
        let d = s.daten
        let istRot = !s.fehlt.isEmpty
        let text = istRot ? Color.black : Color(hex: 0x18181B)
        let warnungen = s.hinweise.filter { Self.warnungen.contains($0) }
        let infos = s.hinweise.filter { !Self.warnungen.contains($0) }
        let namenListe = ImportDienst.namen(d["passengers"])
        let namen = fahrten ? (namenListe.isEmpty ? t("imp.ohneName") : namenListe.joined(separator: ", "))
            : { let n = "\(wert(i, "first_name")) \(wert(i, "last_name"))".trimmingCharacters(in: .whitespaces); return n.isEmpty ? t("imp.ohneName") : n }()
        let groesse: CGFloat = namen.count > 45 ? 18 : (namen.count > 30 ? 20 : 24)
        let teile = wert(i, "note").components(separatedBy: " · ").filter { !$0.isEmpty }
        let firma = teile.first { $0.hasPrefix("Firma: ") }.map { String($0.dropFirst(7)) } ?? ""
        let notiz = teile.filter { !$0.hasPrefix("Firma: ") }.joined(separator: " · ")
        let route = fahrten
            ? "\(wert(i, "pickup_name").isEmpty ? wert(i, "pickup_address") : wert(i, "pickup_name")) → \(wert(i, "dropoff_name").isEmpty ? wert(i, "dropoff_address") : wert(i, "dropoff_name"))"
            : ["company", "email", "phone"].map { wert(i, $0) }.filter { !$0.isEmpty }.joined(separator: " · ")
        let flug = wert(i, "flight_number").isEmpty ? wert(i, "train_number") : wert(i, "flight_number")
        let extra = fahrten ? [flug, wert(i, "anzahl").isEmpty ? "" : t("imp.personen", ["n": wert(i, "anzahl")]),
                               d["needs_child_seat"] == .bool(true) ? feldText("kindersitz") : "", d["is_vip"] == .bool(true) ? "VIP" : ""]
            .filter { !$0.isEmpty }.joined(separator: " · ") : ""
        return VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .top, spacing: 16) {
                VStack(alignment: .leading, spacing: 5) {
                    Text(namen).font(.grotesk(groesse, .bold)).foregroundStyle(text).lineLimit(2)
                        .fixedSize(horizontal: false, vertical: true)
                    if !route.isEmpty { Text(route).font(.grotesk(12, .medium)).tracking(0.3).foregroundStyle(text).opacity(0.8) }
                    if !firma.isEmpty { Text(firma).font(.grotesk(13, .bold)).foregroundStyle(text).lineLimit(1) }
                    if !extra.isEmpty { Text(extra).font(.grotesk(13, .bold)).foregroundStyle(text) }
                    if istRot {
                        Text(t("imp.fehltFeld", ["felder": s.fehlt.map(feldText).joined(separator: ", ")]))
                            .font(.grotesk(12, .bold)).foregroundStyle(.black)
                    }
                    if !warnungen.isEmpty {
                        Text(warnungen.map { hinweisText($0, s) }.joined(separator: " · "))
                            .font(.grotesk(12, .bold)).foregroundStyle(istRot ? .black : Color(hex: 0xFF8A00))
                    }
                    if !infos.isEmpty {
                        Text(infos.map { hinweisText($0, s) }.joined(separator: " · "))
                            .font(.grotesk(11, .medium)).foregroundStyle(istRot ? Color(hex: 0x262626) : Color(hex: 0x71717B))
                    }
                    if !notiz.isEmpty {
                        Text(t("imp.notiz", ["text": notiz])).font(.grotesk(12, .medium))
                            .foregroundStyle(istRot ? .black : Color(hex: 0x71717B)).lineLimit(1).padding(.trailing, 36)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                if fahrten {
                    Text(String(wert(i, "etd").prefix(5)).isEmpty ? "--:--" : String(wert(i, "etd").prefix(5)))
                        .font(.grotesk(22, .bold)).foregroundStyle(text)
                }
            }
            .padding(18)
            .frame(minHeight: 120, alignment: .top)
            .contentShape(Rectangle())
            .onTapGesture { offen = offen == i ? nil : i }
            if offen == i { editor(i).padding(.horizontal, 18).padding(.bottom, 56) }
        }
        .background(istRot ? Color(hex: 0xFB2C36) : .white)
        .overlay(alignment: .bottomTrailing) {
            Button { saetze[i].aus.toggle() } label: {
                ZStack {
                    Rectangle().fill(s.aus ? Color.clear : Color(hex: 0x18181B))
                    Rectangle().strokeBorder(Color(hex: 0x18181B), lineWidth: 2)
                    if !s.aus { Text("✓").font(.system(size: 16, weight: .bold)).foregroundStyle(lime) }
                }
                .frame(width: 30, height: 30)
            }
            .buttonStyle(.web)
            .accessibilityLabel(t("imp.mitImportieren"))
            .padding(14)
        }
        .opacity(s.aus ? 0.45 : 1)
    }

    @ViewBuilder private func editor(_ i: Int) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Rectangle().fill(Color.black.opacity(0.1)).frame(height: 1)
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
                            Text("\(a) → \(name)").font(.grotesk(10, .medium)).foregroundStyle(Color(hex: 0x71717B))
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
            Text(label).font(.grotesk(10, .medium)).foregroundStyle(Color(hex: 0x71717B))
            TextField("", text: Binding(get: { wert }, set: aendern),
                      prompt: Text(platzhalter).foregroundStyle(Color(hex: 0xA1A1AA)))
                .font(.grotesk(13, .medium)).foregroundStyle(Color(hex: 0x18181B))
                .keyboardType(tastatur)
                .autocorrectionDisabled()
                .textInputAutocapitalization(.never)
                .padding(.horizontal, 8).frame(height: 34)
                .background(Color.white)
                .overlay(Rectangle().strokeBorder(Color(hex: 0xD4D4D8), lineWidth: 1))
        }
        .frame(maxWidth: .infinity)
    }

    private func wert(_ i: Int, _ k: String) -> String { ImportDienst.text(saetze[i].daten[k]) }

    private func aendern(_ i: Int, _ werte: [String: AnyJSON]) {
        guard saetze.indices.contains(i) else { return }
        for (k, v) in werte { saetze[i].daten[k] = v }
        ImportDienst.pruefen(&saetze[i], gaeste: !fahrten)
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
                ForEach(analyse.blaetter.filter { $0.index != analyse.blatt && ($0.fahrten ?? 1) > 0 }, id: \.self) { b in
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
        let f2 = DateFormatter()
        f2.locale = Locale(identifier: "de_DE")
        f2.dateFormat = "dd.MM.yy, HH:mm"
        return f2.string(from: d)
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
        "imp.hinweis": "Excel oder CSV. Spalten, Tage und Adressen werden automatisch erkannt.",
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
        "imp.k.fahrten": "Fahrten",
        "imp.k.gaeste": "Gäste",
        "imp.k.tag": "Tag",
        "imp.k.tage": "Tage",
        "imp.k.fehlt": "unvollständig",
        "imp.k.pruefen": "prüfen",
        "imp.k.aus": "abgewählt",
        "imp.c.datum": "Datum {datum} aus Datei",
        "imp.c.ziel": "Ziel {ziel}",
        "imp.c.vorlage": "Vorlage erkannt",
        "imp.c.llama": "Llama hat geholfen",
        "imp.c.adressen": "{n}/{gesamt} Adressen gefunden",
        "imp.c.adressenLaeuft": "Adressen werden geprüft …",
        "imp.spalten": "Spalten",
        "imp.fehltKurz": "fehlt: {felder}",
        "imp.erkanntVon": "{n} von {gesamt} erkannt",
        "imp.ohneDatum": "Ohne Datum",
        "imp.tagEine": "1 Fahrt",
        "imp.tagViele": "{n} Fahrten",
        "imp.tagGaeste": "{n} Gäste",
        "imp.ohneName": "Ohne Namen",
        "imp.personen": "{n} P.",
        "imp.notiz": "Notiz: {text}",
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
        "imp.kontextDatum": "Datum {datum} aus dem Kopf der Datei.",
        "imp.kontextZiel": "Ziel aus der Datei: {ziel}.",
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

/// Kurze Chips nebeneinander, mit Umbruch wenn die Zeile voll ist.
private struct FlussZeilen: Layout {
    var abstand: CGFloat = 6

    init(abstand: CGFloat = 6) { self.abstand = abstand }

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let breite = proposal.width ?? .infinity
        var x: CGFloat = 0, y: CGFloat = 0, zeile: CGFloat = 0, maxX: CGFloat = 0
        for s in subviews {
            let g = s.sizeThatFits(.unspecified)
            if x > 0 && x + g.width > breite { x = 0; y += zeile + abstand; zeile = 0 }
            x += g.width + abstand
            zeile = max(zeile, g.height)
            maxX = max(maxX, x - abstand)
        }
        return CGSize(width: proposal.width ?? maxX, height: subviews.isEmpty ? 0 : y + zeile)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX, y = bounds.minY, zeile: CGFloat = 0
        for s in subviews {
            let g = s.sizeThatFits(.unspecified)
            if x > bounds.minX && x + g.width > bounds.maxX { x = bounds.minX; y += zeile + abstand; zeile = 0 }
            s.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(g))
            x += g.width + abstand
            zeile = max(zeile, g.height)
        }
    }
}
