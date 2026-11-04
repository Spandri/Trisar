import CoreLocation
import SwiftUI

/// Vorlaeufiger Startbildschirm nach dem Login (Schritt 1): zeigt, ob die Ortung laeuft.
/// Wird in Schritt 2 durch die Fahrtenliste im Look der Web-App ersetzt.
struct OrtungAnsicht: View {
    @EnvironmentObject private var anmeldung: Anmeldung
    @EnvironmentObject private var ortung: Ortung

    var body: some View {
        ZStack(alignment: .bottom) {
            TrisarHintergrund()
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    Image("TrisarLogo")
                        .resizable()
                        .scaledToFit()
                        .frame(width: 161.79, height: 24)
                        .padding(.top, 58)

                    Text(anmeldung.profil?.name.isEmpty == false ? anmeldung.profil!.name : "Fahrer")
                        .font(.grotesk(42, .bold))
                        .tracking(-0.5)
                        .foregroundStyle(Farbe.lime)
                        .lineLimit(2)
                        .minimumScaleFactor(0.6)

                    statusKasten

                    if ortung.berechtigung != .immer && !ortung.nutztOBD {
                        Button(ortung.berechtigung == .unbekannt ? "Standort erlauben" : "„Immer“ erlauben") {
                            ortung.berechtigungAnfragen()
                        }
                        .buttonStyle(LimeKnopfStil())
                    }

                    Toggle(isOn: $ortung.eingeschaltet) {
                        Text("Ortung eingeschaltet")
                            .font(.grotesk(15, .medium))
                            .foregroundStyle(Farbe.lime)
                    }
                    .tint(Farbe.lime)
                    .padding(16)
                    .background(Farbe.feld)
                    .overlay(Rectangle().stroke(Farbe.feldRand, lineWidth: 1))

                    Button("Abmelden") {
                        Task { await anmeldung.abmelden() }
                    }
                    .font(.grotesk(13))
                    .foregroundStyle(Farbe.grauText)
                    .frame(maxWidth: .infinity)
                    .padding(.bottom, 70)
                }
                .padding(.horizontal, 20)
            }
            TrisarFussleiste()
        }
    }

    private var statusKasten: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 10) {
                Circle().fill(statusFarbe).frame(width: 12, height: 12)
                Text(statusText)
                    .font(.grotesk(17, .bold))
                    .foregroundStyle(Farbe.lime)
            }
            zeile("Berechtigung", berechtigungText)
            zeile("Letzte Übertragung", letzteSendungText)
            zeile("Gesendet", "\(ortung.gesendet)")
            if ortung.wartend > 0 { zeile("Wartet auf Netz", "\(ortung.wartend) Punkte") }
            if let pos = ortung.letztePosition {
                zeile("Genauigkeit", "± \(Int(pos.horizontalAccuracy.rounded())) m")
            }
            if let fehler = ortung.letzterFehler {
                Text(fehler)
                    .font(.grotesk(12))
                    .foregroundStyle(Farbe.fehler)
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Farbe.feld)
        .overlay(Rectangle().stroke(Farbe.lime, lineWidth: 2))
    }

    private func zeile(_ titel: String, _ wert: String) -> some View {
        HStack {
            Text(titel).foregroundStyle(Farbe.grauText)
            Spacer()
            Text(wert).foregroundStyle(Farbe.lime)
        }
        .font(.grotesk(14, .medium))
    }

    private var statusText: String {
        if ortung.nutztOBD { return "Ortung über OBD-Tracker" }
        if !ortung.eingeschaltet { return "Ortung pausiert" }
        switch ortung.berechtigung {
        case .verweigert: return "Standort nicht erlaubt"
        case .unbekannt: return "Standort noch nicht erlaubt"
        default: return ortung.laeuft ? "Ortung aktiv" : "Ortung startet …"
        }
    }

    private var statusFarbe: Color {
        if ortung.nutztOBD { return Farbe.lime }
        if !ortung.eingeschaltet || ortung.berechtigung == .verweigert || ortung.berechtigung == .unbekannt {
            return Farbe.fehler
        }
        if ortung.berechtigung == .nurBeimVerwenden { return .orange }
        return ortung.letzterFehler == nil ? .green : .orange
    }

    private var berechtigungText: String {
        switch ortung.berechtigung {
        case .immer: return "Immer"
        case .nurBeimVerwenden: return "Nur beim Verwenden"
        case .verweigert: return "Verweigert"
        case .unbekannt: return "Nicht gefragt"
        }
    }

    private var letzteSendungText: String {
        if ortung.nutztOBD { return "kommt vom Tracker" }
        guard let zeit = ortung.letzteSendung else { return "noch keine" }
        return zeit.formatted(date: .omitted, time: .standard)
    }
}
