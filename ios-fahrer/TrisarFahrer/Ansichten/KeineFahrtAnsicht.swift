import SwiftUI

/// Nachbau von KeineFahrtTrisar.jsx (mit Fahrzeug) und KeinAuto.jsx (ohne Fahrzeug).
/// Beide Web-Bildschirme sind im Raster 393 x 874 gebaut.
struct KeineFahrtAnsicht: View {
    let fahrzeug: FahrzeugZeile?
    var oeffneProfil: () -> Void
    var oeffneFahrzeug: () -> Void
    var abmelden: () -> Void
    @ObservedObject private var bilder = FahrzeugBildSpeicher.shared

    var body: some View {
        Leinwand(breite: 393) { _ in
            ZStack(alignment: .topLeading) {
                Image("trisar_logo").resizable().scaledToFit()
                    .platz(20, 116, 161.79, 24)

                ProfilKnopf(aktion: oeffneProfil)
                    .platz(393 - 20 - 52, 86, 52, 52)

                WebText(text: fahrzeug == nil
                        ? "Hey aktuell gibt es keine Fahrt und kein Auto für dich!"
                        : "Hey aktuell gibt es keine Fahrt für dich!",
                        groesse: 34, gewicht: .medium, zeilenHoehe: 34 * 1.18, abstand: -0.5)
                    .platz(20, 194, 362, nil)

                // Offene Stunden nach einem Dienst
                StundenHinweis().platz(20, 370, 362, 56)

                if let fahrzeug {
                    Button(action: oeffneFahrzeug) {
                        FahrzeugKarte(fahrzeug: fahrzeug,
                                      titel: [fahrzeug.brand_model, fahrzeug.license_plate]
                                          .compactMap { $0?.trimmingCharacters(in: .whitespaces) }
                                          .first { !$0.isEmpty } ?? "",
                                      bildOben: 55.57)
                    }
                    .buttonStyle(.web)
                    .platz(20, 462, 362, FahrzeugKarte.hoehe(fahrzeug, bildOben: 55.57))
                } else {
                    Text("Komm später nochmal")
                        .grotesk(34, .medium, abstand: -0.5)
                        .foregroundStyle(.white)
                        .platz(20, 432, 362, 40, .leading)

                    Image("Arrow_Trisar_Icons_01").resizable().scaledToFit()
                        .platz(20, 496, 362, 234)
                }

                Button(action: abmelden) {
                    Text("Abmelden")
                        .grotesk(16, .medium, abstand: 0.5)
                        .foregroundStyle(Color(hex: 0x7F8A2B))
                        .frame(width: 362, height: 56)
                        .overlay(Rectangle().strokeBorder(Color(hex: 0x7F8A2B), lineWidth: 1))
                }
                .buttonStyle(.web)
                .platz(20, 754, 362, 56)
            }
        }
        // Fest am unteren Rand wie auf allen anderen Seiten, damit sie auf keinem iPhone abgeschnitten wird.
        .overlay { FussleisteUnten() }
    }
}

/// Nachbau von CancelRideSheet.jsx: „Warum wollen Sie diese Fahrt stornieren?“ mit Notiz.
struct AblehnenBlatt: View {
    var schliessen: () -> Void
    var bestaetigen: (String) -> Void
    var body: some View {
        NotizBlatt(titel: "Warum wollen Sie diese Fahrt stornieren?", titelFarbe: Farbe.lime,
                   knopf: "Stornieren beenden", knopfFarbe: Farbe.lime,
                   schliessen: schliessen, bestaetigen: bestaetigen)
    }
}

/// Gemeinsames Layout von CancelRideSheet, FahrtBeenden und NotizSend (Raster 402 x 864):
/// Zurueck bei 20/60, Titel bei 140 (42 fett, Zeile 48), Notizfeld bei 460, Knopf bei 742.
struct NotizBlatt: View {
    let titel: String
    let titelFarbe: Color
    let knopf: String
    let knopfFarbe: Color
    var schliessen: () -> Void
    var bestaetigen: (String) -> Void
    var beschaeftigt = false
    @State private var notiz = ""
    @FocusState private var fokus: Bool

    var body: some View {
        Leinwand(basisHoehe: 864) { _ in
            ZStack(alignment: .topLeading) {
                ZurueckKnopf(aktion: schliessen).platz(20, 60, 50, 50)

                WebText(text: titel, groesse: 42, gewicht: .bold, zeilenHoehe: 48, abstand: -0.5, farbe: titelFarbe.ui)
                    .platz(20, 140, 362, nil)

                ZStack(alignment: .topLeading) {
                    RoundedRectangle(cornerRadius: 12).fill(Color(hex: 0x1A1A1A))
                    VStack(alignment: .leading, spacing: 8) {
                        HStack {
                            Text("Notizen").grotesk(16, .bold, abstand: 0.5).foregroundStyle(Color(hex: 0x1D1C1D))
                            Spacer()
                            Image("Stift").resizable().frame(width: 20, height: 20)
                        }
                        TextField("", text: $notiz, prompt: Text(verbatim: "Schreiben...").foregroundStyle(Color(red: 129 / 255, green: 129 / 255, blue: 129 / 255, opacity: 0.5)), axis: .vertical)
                            .font(.grotesk(14))
                            .tracking(0.25)
                            .foregroundStyle(Color(hex: 0x1D1C1D))
                            .focused($fokus)
                            .lineLimit(6, reservesSpace: true)
                        Spacer(minLength: 0)
                    }
                    .padding(16)
                    .frame(width: 362, height: 184, alignment: .topLeading)
                    .background(Color.white)
                    .padding(.leading, 20).padding(.top, 20)
                    .onTapGesture { fokus = true }
                }
                .platz(0, 460, 402, 224)

                Button {
                    fokus = false
                    bestaetigen(notiz)
                } label: {
                    HStack {
                        Text(knopf).grotesk(16, .bold, abstand: -0.5).foregroundStyle(.black)
                        Spacer()
                        if beschaeftigt { ProgressView().tint(.black) } else {
                            Image("PfeilDunkel").resizable().frame(width: 34, height: 20)
                        }
                    }
                    .padding(.horizontal, 24)
                    .frame(width: 362, height: 56)
                    .background(knopfFarbe)
                }
                .buttonStyle(.web)
                .disabled(beschaeftigt)
                .platz(20, 742, 362, 56)
            }
        }
        .overlay { if !fokus { FussleisteUnten() } }
        .onTapGesture { fokus = false }
    }
}
