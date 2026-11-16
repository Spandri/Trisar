import SwiftUI

/// Bildschirmwahl nach dem Login, wie renderViewScreen('list') der Web-App:
/// keine Fahrten -> „Keine Fahrt“ (mit/ohne Fahrzeug), sonst Fahrtenliste.
struct HauptAnsicht: View {
    @EnvironmentObject private var anmeldung: Anmeldung
    @EnvironmentObject private var speicher: FahrtenSpeicher
    @State private var profilOffen = false
    @State private var offeneFahrt: Fahrt?
    /// Angetippter Dienststart mit Treffpunkt (Karte, Ort und Notiz wie bei einer Fahrt).
    @State private var offenerDienst: DienstAnfrage?
    /// Angetippte Dienstreise (Karte mit Strecke, Abfahrt, Ankunft).
    @State private var offeneReise: DienstreiseSpeicher.Reise?
    @State private var supportOffen = false
    @State private var fahrzeugOffen = false
    @ObservedObject private var stunden = StundenSpeicher.shared
    @ObservedObject private var standby = StandbySpeicher.shared
    @ObservedObject private var dienstreise = DienstreiseSpeicher.shared

    /// Offene Dienstanfrage oder angenommener Dienst ab heute: Liste statt "Keine Fahrt"
    /// (sonst sah der Fahrer nach der Push nichts, wenn er an dem Tag keine Fahrten hat, 12.11.).
    private var dienstSichtbar: Bool {
        // Eine offene Dienstreise zaehlt als sichtbar, damit nicht "Keine Fahrt" kommt.
        dienstreise.sichtbar || standby.sichtbar || speicher.dienstAnfragen.contains { a in
            guard a.angenommen else { return true }
            // Angenommen: bis Dienstende (Nachtdienst: Folgetag).
            let tag = String((a.service_date ?? "").prefix(10))
            let start = Stunden.zeitpunkt(tag, String((a.service_start_time ?? "").prefix(5)))
            guard let ende = Stunden.zeitpunkt(tag, String((a.service_end_time ?? "").prefix(5)), nach: start) else { return tag >= Stunden.heuteDatum }
            return ende > Date()
        }
    }

    var body: some View {
        Group {
            if !speicher.geladen {
                TrisarHintergrund()
            } else if speicher.fahrten.isEmpty && stunden.karten.isEmpty && !dienstSichtbar {
                KeineFahrtAnsicht(
                    fahrzeug: speicher.fahrzeug,
                    oeffneProfil: { profilOffen = true },
                    oeffneFahrzeug: { fahrzeugOffen = true },
                    abmelden: { Task { await anmeldung.abmelden() } }
                )
            } else {
                FahrtenListeAnsicht(
                    oeffneProfil: { profilOffen = true },
                    oeffneFahrzeug: { fahrzeugOffen = true },
                    oeffneFahrt: { offeneFahrt = $0 },
                    oeffneDienst: { offenerDienst = $0 },
                    oeffneReise: { offeneReise = $0 }
                )
            }
        }
        // Stundenkarten: beim Start, nach jeder Aenderung an Fahrten und wenn die App wieder vorne ist.
        .task { await stunden.laden() }
        .onChange(of: speicher.fahrten.map(\.status)) { _, _ in Task { await stunden.laden() } }
        .onReceive(NotificationCenter.default.publisher(for: UIApplication.willEnterForegroundNotification)) { _ in
            Task { await stunden.laden() }
            Task { await standby.laden() }
            Task { await dienstreise.laden() }
        }
        .webVollbild(isPresented: $profilOffen) {
            ProfilFluss { profilOffen = false }
                .environmentObject(anmeldung)
        }
        .onReceive(NotificationCenter.default.publisher(for: .supportOeffnen)) { _ in
            if offeneFahrt == nil && !profilOffen && !fahrzeugOffen { supportOffen = true }
        }
        .webVollbild(isPresented: $supportOffen) { SupportAnsicht { supportOffen = false } }
        .webVollbild(isPresented: $fahrzeugOffen) {
            FahrzeugAnsicht { fahrzeugOffen = false }
                .environmentObject(anmeldung)
                .environmentObject(speicher)
        }
        .onReceive(Push.shared.$ziel.compactMap { $0 }) { _ in pushZielOeffnen() }
        // Kalter Start: Ziel erst einloesen, wenn die Fahrten da sind.
        .onChange(of: speicher.fahrten.map(\.id)) { _, _ in pushZielOeffnen() }
        .webVollbild(item: $offenerDienst) { dienst in
            DienstStartAnsicht(dienstID: dienst.id) { offenerDienst = nil }
                .environmentObject(speicher)
        }
        .webVollbild(item: $offeneReise) { reise in
            DienstreiseAnsicht(reiseID: reise.id) { offeneReise = nil }
        }
        .webVollbild(item: $offeneFahrt) { fahrt in
            if let fahrer = anmeldung.fahrerID {
                SoloNormalAnsicht(fahrtID: fahrt.id, fahrerID: fahrer) { offeneFahrt = nil }
                    .environmentObject(anmeldung)
            }
        }
    }

    /// Tipp auf eine Mitteilung: Fahrt, Chat (Fahrt der Kolonne) oder Fahrzeug oeffnen.
    private func pushZielOeffnen() {
        guard let ziel = Push.shared.ziel else { return }
        let fahrtID: UUID?
        switch ziel["ziel"] {
        case "fahrt":
            fahrtID = ziel["job_id"].flatMap(UUID.init(uuidString:))
        case "chat":
            let kolonne = ziel["kolonne_id"].flatMap(UUID.init(uuidString:))
            fahrtID = speicher.fahrten.first(where: { $0.kolonnenID != nil && $0.kolonnenID == kolonne })?.id
            if fahrtID == nil && speicher.fahrten.isEmpty { return }
        case "fahrzeug":
            Push.shared.ziel = nil
            profilOffen = false; supportOffen = false; offeneFahrt = nil
            fahrzeugOffen = true
            return
        default:
            Push.shared.ziel = nil
            profilOffen = false; supportOffen = false; fahrzeugOffen = false; offeneFahrt = nil
            return
        }
        guard let id = fahrtID else { Push.shared.ziel = nil; return }
        // Fahrten noch nicht geladen: spaeter nochmal (onChange oben).
        guard let fahrt = speicher.fahrten.first(where: { $0.id == id }) else {
            if speicher.fahrten.isEmpty { return }
            Push.shared.ziel = nil
            return
        }
        Push.shared.ziel = nil
        profilOffen = false; supportOffen = false; fahrzeugOffen = false
        offeneFahrt = fahrt
    }
}


/// Profil mit Unterseiten (wie setView in der Web-App: profilFahrer -> verlauf / settingsFahrer / ansprechpartner).
private struct ProfilFluss: View {
    let schliessen: () -> Void
    @State private var seite: Seite = .profil
    private enum Seite { case profil, verlauf, einstellungen, support }

    var body: some View {
        ZStack {
            switch seite {
            case .profil:
                ProfilAnsicht(zurueck: schliessen,
                              oeffneAnsprechpartner: { seite = .support },
                              oeffneVerlauf: { seite = .verlauf },
                              oeffneEinstellungen: { seite = .einstellungen })
            case .verlauf:
                VerlaufAnsicht { seite = .profil }
            case .einstellungen:
                EinstellungenAnsicht { seite = .profil }
            case .support:
                SupportAnsicht { seite = .profil }
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: .supportOeffnen)) { _ in seite = .support }
    }
}
