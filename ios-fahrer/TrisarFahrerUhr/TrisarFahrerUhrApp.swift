import SwiftUI
import MapKit

/// Apple-Watch-App der TRISAR Fahrer-App. Drei Seiten zum Durchwischen:
/// Naechste Fahrt (mit Annehmen/Ablehnen), alle Fahrten, Dienst und Ortung.
@main
struct TrisarFahrerUhrApp: App {
    @StateObject private var verbindung = UhrVerbindung.shared

    var body: some Scene {
        WindowGroup {
            UhrHaupt()
                .environmentObject(verbindung)
        }
    }
}

struct UhrHaupt: View {
    @EnvironmentObject private var verbindung: UhrVerbindung
    @State private var seite = UhrHaupt.startSeite

    /// Debug: -uhrSeite 0...3 oeffnet gleich eine Seite (Bildschirmfotos im Simulator).
    private static var startSeite: Int {
        #if DEBUG
        let args = ProcessInfo.processInfo.arguments
        if let i = args.firstIndex(of: "-uhrSeite"), i + 1 < args.count, let n = Int(args[i + 1]) { return n }
        #endif
        return 0
    }

    var body: some View {
        Group {
            if !verbindung.stand.angemeldet {
                OhneAnmeldung()
            } else {
                NavigationStack {
                    TabView(selection: $seite) {
                        NaechsteFahrtSeite().tag(0)
                        FahrtenSeite().tag(1)
                        StundenSeite().tag(2)
                        DienstSeite().tag(3)
                    }
                    .tabViewStyle(.verticalPage)
                    .navigationDestination(for: UhrFahrt.self) { fahrt in
                        FahrtDetailSeite(fahrtID: fahrt.id)
                    }
                }
            }
        }
        .background(UhrHintergrund())
        .alert("TRISAR", isPresented: Binding(get: { verbindung.meldung != nil }, set: { if !$0 { verbindung.meldung = nil } })) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(verbindung.meldung ?? "")
        }
    }
}

struct OhneAnmeldung: View {
    var body: some View {
        VStack(spacing: 10) {
            Image("TrisarLogo")
                .resizable()
                .scaledToFit()
                .frame(width: 90)
            Text("Öffne TRISAR auf dem iPhone und melde dich an.")
                .font(.grotesk(14, .medium))
                .foregroundStyle(.white.opacity(0.85))
                .multilineTextAlignment(.center)
        }
        .padding()
    }
}

// MARK: - Naechste Fahrt

struct NaechsteFahrtSeite: View {
    @EnvironmentObject private var verbindung: UhrVerbindung

    /// Laufende Fahrt, sonst die naechste ab 30 min vor jetzt, sonst die erste.
    private var fahrt: UhrFahrt? { verbindung.stand.naechsteFahrt() }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 8) {
                Text("Nächste Fahrt")
                    .font(.grotesk(13, .bold))
                    .foregroundStyle(UhrFarbe.lime)
                if let fahrt {
                    HStack(alignment: .firstTextBaseline) {
                        Text(fahrt.zeit)
                            .font(.grotesk(34, .bold))
                            .foregroundStyle(UhrFarbe.lime)
                            .monospacedDigit()
                        Spacer()
                        Text(UhrText.tag(fahrt.tag))
                            .font(.grotesk(12, .medium))
                            .foregroundStyle(.white.opacity(0.6))
                    }
                    StatusPunkt(status: fahrt.status)
                    NavigationLink(value: fahrt) {
                        Kachel {
                            VStack(alignment: .leading, spacing: 4) {
                                Ort(titel: "Von", text: fahrt.von)
                                Ort(titel: "Nach", text: fahrt.nach)
                                if !fahrt.flug.isEmpty {
                                    Text(fahrt.flug)
                                        .font(.grotesk(12, .bold))
                                        .foregroundStyle(UhrFarbe.lime)
                                }
                            }
                        }
                    }
                    .buttonStyle(.plain)
                    SchrittKnoepfe(fahrt: fahrt)
                    if fahrt.offen {
                        LimeKnopf(text: "Annehmen", arbeitet: verbindung.arbeitetID == fahrt.id) {
                            verbindung.fahrtAntworten(fahrt, annehmen: true)
                        }
                        .doppelTippen()
                        RotKnopf(text: "Ablehnen", arbeitet: verbindung.arbeitetID == fahrt.id) {
                            verbindung.fahrtAntworten(fahrt, annehmen: false)
                        }
                    }
                } else {
                    Kachel {
                        Text("Keine Fahrt geplant")
                            .font(.grotesk(15, .bold))
                            .foregroundStyle(.white.opacity(0.7))
                    }
                }
            }
            .padding(.horizontal, 4)
        }
    }
}

struct StatusPunkt: View {
    let status: String
    var body: some View {
        HStack(spacing: 6) {
            Circle().fill(UhrText.statusFarbe(status)).frame(width: 8, height: 8)
            Text(status)
                .font(.grotesk(13, .bold))
                .foregroundStyle(UhrText.statusFarbe(status))
        }
    }
}

struct Ort: View {
    let titel: String
    let text: String
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(titel)
                .font(.grotesk(11, .medium))
                .foregroundStyle(.white.opacity(0.5))
            Text(text.isEmpty ? "–" : text)
                .font(.grotesk(15, .bold))
                .foregroundStyle(.white)
                .lineLimit(2)
        }
    }
}

// MARK: - Fahrten

struct FahrtenSeite: View {
    @EnvironmentObject private var verbindung: UhrVerbindung

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 6) {
                Text("Fahrten")
                    .font(.grotesk(13, .bold))
                    .foregroundStyle(UhrFarbe.lime)
                if verbindung.stand.fahrten.isEmpty {
                    Kachel {
                        Text("Keine Fahrten")
                            .font(.grotesk(15, .bold))
                            .foregroundStyle(.white.opacity(0.7))
                    }
                }
                ForEach(verbindung.stand.fahrten) { fahrt in
                    NavigationLink(value: fahrt) {
                    Kachel(rand: fahrt.laeuft ? UhrFarbe.gruen : (fahrt.offen ? UhrFarbe.orange : nil)) {
                        VStack(alignment: .leading, spacing: 2) {
                            HStack {
                                Text(fahrt.zeit)
                                    .font(.grotesk(18, .bold))
                                    .foregroundStyle(UhrFarbe.lime)
                                    .monospacedDigit()
                                Spacer()
                                Text(UhrText.tag(fahrt.tag))
                                    .font(.grotesk(11, .medium))
                                    .foregroundStyle(.white.opacity(0.5))
                            }
                            Text("\(fahrt.von) → \(fahrt.nach)")
                                .font(.grotesk(13, .medium))
                                .foregroundStyle(.white)
                                .lineLimit(2)
                            Text(fahrt.status)
                                .font(.grotesk(11, .bold))
                                .foregroundStyle(UhrText.statusFarbe(fahrt.status))
                        }
                    }
                    }
                    .buttonStyle(.plain)
                }
                Button {
                    verbindung.neuLaden()
                } label: {
                    Text(verbindung.arbeitetID == "laden" ? "Lädt …" : "Neu laden")
                        .font(.grotesk(13, .bold))
                        .foregroundStyle(UhrFarbe.lime)
                        .frame(maxWidth: .infinity, minHeight: 32)
                }
                .buttonStyle(.plain)
            }
            .padding(.horizontal, 4)
        }
    }
}

// MARK: - Dienst und Ortung

struct DienstSeite: View {
    @EnvironmentObject private var verbindung: UhrVerbindung

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 8) {
                Text("Dienst")
                    .font(.grotesk(13, .bold))
                    .foregroundStyle(UhrFarbe.lime)
                TimelineView(.periodic(from: .now, by: 10)) { _ in
                    let frisch = verbindung.stand.ortungAn
                        && (verbindung.stand.letzteSendung.map { Date().timeIntervalSince($0) < 300 } ?? false)
                    Kachel(rand: frisch ? UhrFarbe.gruen : UhrFarbe.rot) {
                        VStack(alignment: .leading, spacing: 2) {
                            HStack(spacing: 6) {
                                Circle().fill(frisch ? UhrFarbe.gruen : UhrFarbe.rot).frame(width: 8, height: 8)
                                Text(verbindung.stand.ortungAn ? "Standort an" : "Ortung aus")
                                    .font(.grotesk(14, .bold))
                                    .foregroundStyle(.white)
                            }
                            Text("Gesendet \(UhrText.vor(verbindung.stand.letzteSendung))")
                                .font(.grotesk(11, .medium))
                                .foregroundStyle(.white.opacity(0.6))
                        }
                    }
                }
                if verbindung.stand.dienste.isEmpty {
                    Text("Keine Dienstanfragen")
                        .font(.grotesk(13, .medium))
                        .foregroundStyle(.white.opacity(0.6))
                }
                ForEach(verbindung.stand.dienste) { dienst in
                    Kachel(rand: dienst.offen ? UhrFarbe.orange : nil) {
                        VStack(alignment: .leading, spacing: 6) {
                            Text(UhrText.tag(dienst.tag))
                                .font(.grotesk(11, .medium))
                                .foregroundStyle(.white.opacity(0.6))
                            HStack(spacing: 10) {
                                ZeitWert(titel: "Start", wert: dienst.start)
                                ZeitWert(titel: "Ende", wert: dienst.ende)
                            }
                            // Treffpunkt beim Dienststart, darunter die Notiz gekuerzt.
                            if let ort = dienst.treffpunkt {
                                // Antippen oeffnet Karten auf der Uhr mit dem Treffpunkt (wie Navigation in der App).
                                Button { treffpunktOeffnen(dienst) } label: {
                                    Label(ort, systemImage: "mappin.and.ellipse")
                                        .font(.grotesk(13, .bold))
                                        .foregroundStyle(.white)
                                        .lineLimit(2)
                                        .frame(maxWidth: .infinity, alignment: .leading)
                                }
                                .buttonStyle(.plain)
                            }
                            if let notiz = dienst.treffpunktNotiz {
                                Text(notiz)
                                    .font(.grotesk(11, .medium))
                                    .foregroundStyle(UhrFarbe.grau)
                                    .lineLimit(3)
                            }
                            if dienst.offen {
                                LimeKnopf(text: "Annehmen", arbeitet: verbindung.arbeitetID == dienst.id) {
                                    verbindung.dienstAntworten(dienst, annehmen: true)
                                }
                                RotKnopf(text: "Ablehnen", arbeitet: verbindung.arbeitetID == dienst.id) {
                                    verbindung.dienstAntworten(dienst, annehmen: false)
                                }
                            } else {
                                Text("Angenommen")
                                    .font(.grotesk(11, .bold))
                                    .foregroundStyle(UhrFarbe.gruen)
                            }
                        }
                    }
                }
            }
            .padding(.horizontal, 4)
        }
    }
}

struct ZeitWert: View {
    let titel: String
    let wert: String?
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(wert ?? "--:--")
                .font(.grotesk(20, .bold))
                .foregroundStyle(wert == nil ? UhrFarbe.grau : UhrFarbe.lime)
                .monospacedDigit()
            Text(titel)
                .font(.grotesk(11, .bold))
                .foregroundStyle(wert == nil ? UhrFarbe.grau : .white)
        }
    }
}

/// Treffpunkt beim Dienststart in Karten auf der Uhr oeffnen (Koordinaten aus dem iPhone-Stand).
@MainActor func treffpunktOeffnen(_ d: UhrDienst) {
    guard let lat = d.treffpunktLat, let lng = d.treffpunktLng else { return }
    let ziel = MKMapItem(placemark: MKPlacemark(coordinate: CLLocationCoordinate2D(latitude: lat, longitude: lng)))
    ziel.name = d.treffpunkt
    ziel.openInMaps(launchOptions: [MKLaunchOptionsDirectionsModeKey: MKLaunchOptionsDirectionsModeDriving])
}
