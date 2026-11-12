import SwiftUI
import Supabase

/// "Dienste" in Fahrer bearbeiten (wie FahrerDienste.jsx): Dienste dieses Fahrers ab heute
/// fuer 14 Tage, antippen aendert (Blatt "Dienste planen" mit genau diesem Fahrer),
/// "Löschen" entfernt einen Dienst, "Dienst hinzufügen" plant einen neuen Tag.
/// Der DB-Trigger (20261111080000_ein_dienst_pro_tag) ersetzt beim Senden den alten Dienst des Tages.
struct FahrerDienstZeile: Decodable, Identifiable, Equatable {
    let id: String
    let service_date: String
    let service_start_time: String?
    let service_end_time: String?
    let status: String?

    var offen: Bool { Dienstzeit.anfrageStatus(status) != "accepted" }
    var zeitText: String {
        let s = Dienstzeit.normal(service_start_time), e = Dienstzeit.normal(service_end_time)
        return "\(s.isEmpty ? "--:--" : s) – \(e.isEmpty ? "--:--" : e)"
    }
    /// "Heute 11.11." / "Mi 12.11."
    var tagText: String {
        let d = Datum.ausTagWert(service_date)
        let tm = Dienstzeit.tagMonat(service_date)
        if Calendar.current.isDateInToday(d) { return "Heute \(tm)" }
        let w = DateFormatter(); w.locale = Locale(identifier: "de_DE"); w.dateFormat = "EE"
        return "\(w.string(from: d).replacingOccurrences(of: ".", with: "")) \(tm)"
    }
}

@MainActor
final class FahrerDiensteModell: ObservableObject {
    let fahrerID: String
    @Published var dienste: [FahrerDienstZeile] = []
    @Published var laedt = false
    @Published var meldung = ""

    init(fahrerID: String) { self.fahrerID = fahrerID }

    func laden() async {
        laedt = true
        defer { laedt = false }
        let heute = Dienstzeit.heute()
        do {
            let zeilen: [FahrerDienstZeile] = try await Backend.client.from("driver_service_requests")
                .select("id,service_date,service_start_time,service_end_time,status")
                .eq("driver_id", value: fahrerID)
                .gte("service_date", value: heute)
                .lte("service_date", value: Dienstzeit.plusTage(heute, 14))
                .order("service_date", ascending: true)
                .order("created_at", ascending: false)
                .execute().value
            // Ein Dienst pro Tag (der neueste), abgelehnte nicht.
            var gesehen = Set<String>()
            dienste = zeilen.filter { z in
                guard Dienstzeit.anfrageStatus(z.status) != "refused", !gesehen.contains(z.service_date) else { return false }
                gesehen.insert(z.service_date)
                return true
            }
        } catch {
            meldung = "Dienste nicht geladen: \(error.localizedDescription)"
        }
    }

    private struct PausenRoh: Decodable {
        struct P: Decodable { let von: String?; let bis: String? }
        let pausen: [P]?
    }

    /// Vorbelegung fuer das Blatt: Tag, Zeiten und feste Pausen des Dienstes.
    func vorgabe(_ z: FahrerDienstZeile) async -> DienstePlanenBlatt.DienstVorgabe {
        var pausen: [DienstePlanenBlatt.Pause] = []
        if let roh: [PausenRoh] = try? await Backend.client.from("dienst_pausen").select("pausen")
            .eq("dienst_id", value: z.id).execute().value {
            pausen = (roh.first?.pausen ?? []).compactMap { p in
                let v = Dienstzeit.normal(p.von), b = Dienstzeit.normal(p.bis)
                return v.isEmpty || b.isEmpty ? nil : DienstePlanenBlatt.Pause(von: v, bis: b)
            }
        }
        return .init(tag: z.service_date, start: Dienstzeit.normal(z.service_start_time),
                     ende: Dienstzeit.normal(z.service_end_time), pausen: pausen)
    }

    private struct ProfilTage: Decodable { let service_start_date: String?; let service_end_date: String? }
    private struct ProfilLeeren: Encodable {
        let start: Bool, ende: Bool
        enum K: String, CodingKey { case service_start_time, service_start_date, service_end_time, service_end_date }
        func encode(to encoder: Encoder) throws {
            var c = encoder.container(keyedBy: K.self)
            if start { try c.encodeNil(forKey: .service_start_time); try c.encodeNil(forKey: .service_start_date) }
            if ende { try c.encodeNil(forKey: .service_end_time); try c.encodeNil(forKey: .service_end_date) }
        }
    }

    func loeschen(_ z: FahrerDienstZeile) async {
        meldung = ""
        let c = Backend.client
        do {
            try await c.from("driver_service_requests").delete().eq("id", value: z.id).execute()
        } catch {
            meldung = "Löschen fehlgeschlagen: \(error.localizedDescription)"
            return
        }
        let heute = Dienstzeit.heute()
        if z.service_date == heute {
            // Heute geloescht: Dienstzeit im Profil fuer heute leeren.
            let p: [ProfilTage] = (try? await c.from("profiles").select("service_start_date,service_end_date")
                .eq("id", value: fahrerID).execute().value) ?? []
            let sd = p.first?.service_start_date ?? "", ed = p.first?.service_end_date ?? ""
            let leer = ProfilLeeren(start: sd.isEmpty || sd.hasPrefix(heute), ende: ed.isEmpty || ed.hasPrefix(heute))
            if leer.start || leer.ende {
                _ = try? await c.from("profiles").update(leer).eq("id", value: fahrerID).execute()
            }
        }
        meldung = "Dienst gelöscht."
        await laden()
    }
}

struct FahrerDiensteAbschnitt: View {
    @ObservedObject var m: FahrerDiensteModell
    let fahrerName: String
    @State private var blatt: BlattWahl?
    @State private var loeschZeile: FahrerDienstZeile?

    struct BlattWahl: Identifiable {
        let id = UUID()
        let vorgabe: DienstePlanenBlatt.DienstVorgabe
    }

    private let lime = Color(hex: 0xE3F654)
    private let schrift = Color(hex: 0x8A9728)

    static let kopf: CGFloat = 36
    static let zeile: CGFloat = 64
    /// Hoehe des Abschnitts, damit Fahrer bearbeiten alles darunter verschieben kann.
    static func hoehe(_ anzahl: Int) -> CGFloat { kopf + CGFloat(max(anzahl, 1)) * zeile + 56 + 12 }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text("Dienste").grotesk(20, .bold, abstand: -0.5).foregroundStyle(Color(hex: 0xE2F754))
                Spacer(minLength: 12)
                Text(m.meldung.isEmpty ? (m.laedt ? "Lädt …" : "nächste 14 Tage") : m.meldung)
                    .grotesk(12).foregroundStyle(Color(hex: 0xC8D85D)).lineLimit(1)
            }
            .frame(height: 28)
            .padding(.bottom, 8)

            if m.dienste.isEmpty {
                Text(m.laedt ? "Lädt …" : "Keine Dienste geplant").grotesk(16).foregroundStyle(schrift)
                    .padding(.horizontal, 16)
                    .frame(width: 362, height: 56, alignment: .leading)
                    .overlay(Rectangle().strokeBorder(Color(hex: 0x7F8A2B), lineWidth: 2))
                    .padding(.bottom, 8)
            } else {
                ForEach(m.dienste) { z in zeileAnsicht(z).padding(.bottom, 8) }
            }

            Button { blatt = BlattWahl(vorgabe: .init(tag: nil)) } label: {
                Text("Dienst hinzufügen").grotesk(16, .medium).foregroundStyle(lime)
                    .frame(width: 362, height: 48)
                    .overlay(Rectangle().strokeBorder(lime, lineWidth: 2))
                    .contentShape(Rectangle())
            }
            .buttonStyle(.web)
            .padding(.top, 2)
        }
        .frame(width: 362, alignment: .topLeading)
        .task { await m.laden() }
        .sheet(item: $blatt) { b in
            DienstePlanenBlatt(fahrerIDs: [m.fahrerID], vorgabe: b.vorgabe) {
                blatt = nil
                Task { await m.laden() }
            }
        }
        .alert("Dienst \(loeschZeile?.tagText ?? "") löschen?", isPresented: Binding(
            get: { loeschZeile != nil }, set: { if !$0 { loeschZeile = nil } })) {
            Button("Löschen", role: .destructive) {
                if let z = loeschZeile { Task { await m.loeschen(z) } }
                loeschZeile = nil
            }
            Button("Abbrechen", role: .cancel) { loeschZeile = nil }
        } message: {
            Text("Der Dienst von \(fahrerName.isEmpty ? "diesem Fahrer" : fahrerName) wird gelöscht.")
        }
    }

    private func zeileAnsicht(_ z: FahrerDienstZeile) -> some View {
        HStack(spacing: 0) {
            Button {
                Task {
                    let v = await m.vorgabe(z)
                    blatt = BlattWahl(vorgabe: v)
                }
            } label: {
                VStack(alignment: .leading, spacing: 0) {
                    (Text(z.tagText).foregroundColor(lime)
                     + Text("  " + (z.offen ? "offen" : "bestätigt"))
                        .font(.grotesk(15, .medium))
                        .foregroundColor(z.offen ? Color(hex: 0xFF9500) : Color(hex: 0x59BE80)))
                        .font(.grotesk(15, .bold)).lineLimit(1).frame(height: 20)
                    Text(z.zeitText).grotesk(15, .medium).monospacedDigit().foregroundStyle(schrift).frame(height: 20)
                }
                .padding(.leading, 16)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
                .contentShape(Rectangle())
            }
            .buttonStyle(.web)

            Button { loeschZeile = z } label: {
                Text("Löschen").grotesk(13, .medium).foregroundStyle(Color(hex: 0xFF3B30))
                    .padding(.horizontal, 12).frame(height: 36)
                    .overlay(Rectangle().strokeBorder(Color(hex: 0xFF3B30), lineWidth: 2))
                    .contentShape(Rectangle())
            }
            .buttonStyle(.web)
            .accessibilityLabel("Dienst \(z.tagText) löschen")
            .padding(.trailing, 8)
        }
        .frame(width: 362, height: 56)
        .overlay(Rectangle().strokeBorder(lime, lineWidth: 2))
    }
}
