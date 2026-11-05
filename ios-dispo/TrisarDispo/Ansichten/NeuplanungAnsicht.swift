import SwiftUI

/// Neuplanung am Einsatztag (NeuplanungView.jsx): Der Tag ist vorab geplant und angenommen,
/// dann kommt eine Stoerung. Die Seite zeigt nur die Aenderungen der Neuplanung, die
/// Disposition uebernimmt oder lehnt sie ab (Closures, das Speichern macht der Planer).

/// `tag.stoerung` aus der Engine-Antwort (engine-ergebnisse.json, stoerung_neu.py).
struct NebenStoerung: Decodable, Equatable {
    struct Ereignis: Decodable, Equatable { let name: String }
    struct Ohne: Decodable, Equatable {
        let spaete_abholungen: [String: Double]?
        let anzahl: Int?
    }
    struct Mit: Decodable, Equatable { let anzahl: Int? }
    struct Aenderung: Decodable, Equatable {
        let ride_ids: [String]
        let abfahrt: String
        let von: String
        let alter_fahrer: String?
        let neuer_fahrer: String
        let reservefahrzeug: Bool?
    }
    let ereignis: Ereignis
    let meldung: String?
    let ohne_neuplanung: Ohne
    let mit_neuplanung: Mit
    let aenderungen: [Aenderung]
    let spaetere_ankunft: [String: Double]?
}

/// `tag.bisheriger_planer` (nur wenn `passend` nicht false ist, sonst nil uebergeben).
struct NebenBisherPlaner: Decodable, Equatable {
    let passend: Bool?
    let stoerung_spaet: [String: Double]?
    let normal_spaet: [String: Double]?
}

/// Was die Karte zu einer Fahrt braucht (im Web aus demoStore.jobs).
struct NebenNeuplanungFahrt: Equatable {
    /// Fahrgastnamen, leer = Anzahl zeigen.
    var namen: [String] = []
    var anzahl: Int = 1
    /// pickup_name, sonst pickup_address.
    var abholung = ""
    /// dropoff_name, sonst dropoff_address.
    var ziel = ""
}

struct NeuplanungAnsicht: View {
    let tagIso: String
    let stoerung: NebenStoerung?
    var bisher: NebenBisherPlaner?
    /// nil, "uebernommen" oder "abgelehnt".
    var status: String?
    var fehler: String?
    var laeuft = false
    /// Fahrten nach Ride-ID fuer Gaeste und Orte.
    var fahrten: [String: NebenNeuplanungFahrt] = [:]
    let uebernehmen: () -> Void
    let ablehnen: () -> Void
    let zurueck: () -> Void

    private typealias RF = NebenRisikoFarbe

    init(tagIso: String, stoerung: NebenStoerung?, bisher: NebenBisherPlaner? = nil, status: String? = nil,
         fehler: String? = nil, laeuft: Bool = false, fahrten: [String: NebenNeuplanungFahrt] = [:],
         uebernehmen: @escaping () -> Void, ablehnen: @escaping () -> Void, zurueck: @escaping () -> Void) {
        self.tagIso = tagIso
        self.stoerung = stoerung
        self.bisher = bisher
        self.status = status
        self.fehler = fehler
        self.laeuft = laeuft
        self.fahrten = fahrten
        self.uebernehmen = uebernehmen
        self.ablehnen = ablehnen
        self.zurueck = zurueck
    }

    private static func ort(_ name: String) -> String {
        String(name.split(separator: ",", omittingEmptySubsequences: false).first ?? "")
    }

    private static func gaeste(_ f: NebenNeuplanungFahrt?) -> String {
        if let f, !f.namen.isEmpty { return f.namen.joined(separator: ", ") }
        let n = max(1, f?.anzahl ?? 1)
        return n == 1 ? "1 Gast" : "\(n) Gäste"
    }

    var body: some View {
        NebenPlanerSeite(titel: "Neuplanung",
                         unterzeile: "\(NebenRisiko.datumText(tagIso)) · Meldung \(stoerung?.meldung ?? "") Uhr",
                         zurueck: zurueck) {
            if let st = stoerung {
                inhalt(st)
            } else {
                Text("Für diesen Tag liegt keine Störung vor.").font(.grotesk(14))
                    .foregroundStyle(RF.lime).padding(.top, 24)
            }
        }
    }

    @ViewBuilder
    private func inhalt(_ st: NebenStoerung) -> some View {
        let spaet = st.ohne_neuplanung.spaete_abholungen ?? [:]
        // Erst die Fahrten, die ohne Eingriff zu spaet waeren, dann die Folgetausche.
        let aenderungen = st.aenderungen.enumerated().sorted { a, b in
            let sa = a.element.ride_ids.contains { spaet[$0] != nil } ? 0 : 1
            let sb = b.element.ride_ids.contains { spaet[$0] != nil } ? 0 : 1
            if sa != sb { return sa < sb }
            if a.element.abfahrt != b.element.abfahrt { return a.element.abfahrt < b.element.abfahrt }
            return a.offset < b.offset
        }.map(\.element)
        let stau = (st.spaetere_ankunft ?? [:]).count
        let ohneAnzahl = st.ohne_neuplanung.anzahl ?? 0

        VStack(alignment: .leading, spacing: 0) {
            Text(String(st.ereignis.name.components(separatedBy: " (").first ?? ""))
                .font(.grotesk(13, .bold)).foregroundStyle(RF.rot)
            HStack(alignment: .top, spacing: 6) {
                vergleich("Bisheriger Planer",
                          bisher?.stoerung_spaet.map(\.count),
                          bisher?.normal_spaet.map { "ohne Unfall \($0.count)" } ?? "nicht gerechnet")
                vergleich("TRISAR ohne Eingriff", ohneAnzahl,
                          ohneAnzahl > 0 ? "bis \(RF.zahl(spaet.values.max())) min" : "Reserve hält")
                vergleich("nach Neuplanung", st.mit_neuplanung.anzahl ?? 0, "\(st.aenderungen.count) Fahrten neu")
            }
            .fixedSize(horizontal: false, vertical: true)
            .padding(.top, 10)
            if stau > 0 {
                Text("\(stau) Gäste stehen selbst im Stau. Sie und das Ziel werden automatisch informiert.")
                    .font(.grotesk(12)).cssZeile(12, 17).opacity(0.7).padding(.top, 8)
            }
        }
        .foregroundStyle(.white)
        .padding(.horizontal, 14).padding(.vertical, 12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .overlay(Rectangle().strokeBorder(RF.rot, lineWidth: 1))
        .padding(.top, 24)

        Text("Vorgeschlagene Änderungen (\(aenderungen.count))").font(.grotesk(13, .bold))
            .foregroundStyle(RF.lime).padding(.top, 24)

        VStack(spacing: 10) {
            ForEach(aenderungen, id: \.ride_ids) { a in
                karte(a, spaet: spaet)
            }
        }
        .padding(.top, 10)

        if let fehler, !fehler.isEmpty {
            Text(fehler).font(.grotesk(12)).foregroundStyle(RF.rot).padding(.top, 12)
        }

        if let status {
            let uebernommen = status == "uebernommen"
            Text(uebernommen ? "Übernommen, Fahrer informiert" : "Abgelehnt")
                .font(.grotesk(22, .bold)).tracking(-0.5)
                .foregroundStyle(uebernommen ? Color.black : RF.rot)
                .frame(maxWidth: .infinity).frame(height: 51)
                .background(uebernommen ? RF.lime : Color.clear)
                .overlay(Rectangle().strokeBorder(uebernommen ? Color.clear : RF.rot, lineWidth: 2))
                .padding(.top, 20)
        } else {
            HStack(spacing: 6) {
                Button(action: ablehnen) {
                    Text("Ablehnen").font(.grotesk(24, .bold)).tracking(-0.5).foregroundStyle(RF.rot)
                        .frame(maxWidth: .infinity).frame(height: 51)
                        .overlay(Rectangle().strokeBorder(RF.rot, lineWidth: 2))
                        .contentShape(Rectangle())
                }
                .buttonStyle(.web)
                .disabled(laeuft)
                Button(action: uebernehmen) {
                    Text("Übernehmen").font(.grotesk(24, .bold)).tracking(-0.5).foregroundStyle(.black)
                        .frame(maxWidth: .infinity).frame(height: 51)
                        .background(RF.lime)
                        .opacity(laeuft ? 0.5 : 1)
                }
                .buttonStyle(.web)
                .disabled(laeuft)
            }
            .padding(.top, 20)
        }
    }

    private func vergleich(_ titel: String, _ n: Int?, _ unter: String) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            WebText(text: titel, groesse: 10, zeilenHoehe: 13, farbe: UIColor.white.withAlphaComponent(0.7))
            Text(n.map { "\($0) zu spät" } ?? "–").font(.grotesk(15, .bold))
                .foregroundStyle((n ?? 0) > 0 ? RF.rot : RF.gruen)
            WebText(text: unter, groesse: 10, zeilenHoehe: 13, farbe: UIColor.white.withAlphaComponent(0.7))
            Spacer(minLength: 0)
        }
        .padding(8)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(Color(hex: 0x2A2A2B))
    }

    private func karte(_ a: NebenStoerung.Aenderung, spaet: [String: Double]) -> some View {
        let fahrt = a.ride_ids.first.flatMap { fahrten[$0] }
        let min = a.ride_ids.compactMap { spaet[$0] }.first
        let teile = a.von.components(separatedBy: " → ")
        let ab = Self.ort(fahrt?.abholung ?? "")
        let zu = Self.ort(fahrt?.ziel ?? "")
        return VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .top, spacing: 10) {
                WebText(text: Self.gaeste(fahrt), groesse: 20, gewicht: .bold, zeilenHoehe: 24, farbe: UIColor(hex: 0x1C1C1D))
                Spacer(minLength: 0)
                Text(a.abfahrt).font(.grotesk(15, .bold))
            }
            WebText(text: "\(ab.isEmpty ? (teile.first ?? "") : ab) → \(zu.isEmpty ? (teile.count > 1 ? teile[1] : "") : zu)",
                    groesse: 12, zeilenHoehe: 16, farbe: UIColor(hex: 0x1C1C1D).withAlphaComponent(0.8))
                .padding(.top, 4)
            (Text(a.alter_fahrer ?? "–").strikethrough().foregroundColor(Color(hex: 0x1C1C1D, alpha: 0.5))
                + Text("  →  \(a.neuer_fahrer)").bold()
                + Text(a.reservefahrzeug == true ? " · Bereitschaft" : "").bold())
                .font(.grotesk(14)).cssZeile(14, 18)
                .padding(.top, 8)
            Group {
                if let min {
                    Text("wäre \(RF.zahl(min)) min zu spät").bold().foregroundColor(RF.rot) + Text(", jetzt pünktlich")
                } else {
                    Text("Folge des Tauschs, bleibt pünktlich").foregroundColor(Color(hex: 0x1C1C1D, alpha: 0.7))
                }
            }
            .font(.grotesk(12)).cssZeile(12, 16)
            .padding(.top, 6)
        }
        .foregroundStyle(Color(hex: 0x1C1C1D))
        .padding(.horizontal, 18).padding(.vertical, 14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(hex: 0xFEFFFE))
        .overlay(Rectangle().strokeBorder(RF.lime, lineWidth: 4))
    }
}
