import Supabase
import SwiftUI

/// Nachbau von `fahrer/src/features/auth/LoginView.jsx`.
/// Masse der Web-App (Basisbreite 402): Logo oben 103, Formular ab 212, Pfeil ab 586.
struct LoginAnsicht: View {
    @EnvironmentObject private var anmeldung: Anmeldung
    @State private var email = ""
    @State private var passwort = ""
    @State private var passwortSichtbar = false
    @State private var hinweis: String?
    @FocusState private var fokus: Feld?

    private enum Feld { case email, passwort }

    var body: some View {
        ZStack(alignment: .bottom) {
            TrisarHintergrund()
                .onTapGesture { fokus = nil }

            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    logos
                        .padding(.top, 103 - 59) // 103 in der Web-App ab Bildschirmkante, abzgl. Statusleiste
                    formular
                        .padding(.top, 212 - 103 - 53)
                    Image("PfeilRechtsLime")
                        .resizable()
                        .scaledToFit()
                        .frame(maxWidth: .infinity)
                        .padding(.top, 51)
                        .padding(.bottom, 60)
                }
                .padding(.horizontal, 20)
            }
            .scrollDismissesKeyboard(.interactively)
            .scrollBounceBehavior(.basedOnSize)

            // Waehrend der Eingabe ausblenden, sonst sitzt sie ueber der Tastatur und verdeckt den Knopf.
            if fokus == nil {
                TrisarFussleiste()
            }
        }
    }

    private var logos: some View {
        // Web-App: trisar bei x 0, „x“ bei 195, Kundenlogo 249–362. Rechte Gruppe buendig rechts,
        // damit es auch auf schmaleren iPhones (393 pt) passt.
        HStack(alignment: .top, spacing: 0) {
            Image("TrisarLogo")
                .resizable()
                .scaledToFit()
                .frame(width: 161.79, height: 24)
                .padding(.top, 14)
            Spacer(minLength: 8)
            Image("PartnerX")
                .resizable()
                .scaledToFit()
                .frame(width: 20, height: 20)
                .padding(.top, 17)
            Spacer().frame(width: 34)
            Image("PartnerLogo")
                .resizable()
                .scaledToFit()
                .frame(width: 113, height: 53)
        }
        .frame(height: 53)
    }

    private var formular: some View {
        VStack(spacing: 24) {
            TrisarFeld(
                titel: "E-Mail",
                icon: "Brief",
                feld: {
                    AnyView(
                        TextField("", text: $email, prompt: Text(verbatim: "deine@email.de").foregroundStyle(Farbe.grauText))
                            .textContentType(.username)
                            .keyboardType(.emailAddress)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                            .submitLabel(.next)
                            .focused($fokus, equals: .email)
                            .onSubmit { fokus = .passwort }
                    )
                },
                fokussiert: fokus == .email,
                rechts: { EmptyView() }
            )

            TrisarFeld(
                titel: "Passwort",
                icon: "Schloss",
                feld: {
                    AnyView(
                        Group {
                            if passwortSichtbar {
                                TextField("", text: $passwort, prompt: Text(verbatim: "••••••••").foregroundStyle(Farbe.grauText))
                            } else {
                                SecureField("", text: $passwort, prompt: Text(verbatim: "••••••••").foregroundStyle(Farbe.grauText))
                            }
                        }
                        .textContentType(.password)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .submitLabel(.go)
                        .focused($fokus, equals: .passwort)
                        .onSubmit { Task { await anmelden() } }
                    )
                },
                fokussiert: fokus == .passwort,
                rechts: {
                    Button {
                        passwortSichtbar.toggle()
                    } label: {
                        Image(passwortSichtbar ? "AugeZu" : "AugeOffen")
                            .resizable()
                            .scaledToFit()
                            .frame(width: 20, height: 20)
                    }
                    .accessibilityLabel(passwortSichtbar ? "Passwort ausblenden" : "Passwort anzeigen")
                }
            )

            Button("Passwort vergessen?") {
                Task { await passwortVergessen() }
            }
            .font(.grotesk(13))
            .foregroundStyle(Farbe.grauText)
            .frame(maxWidth: .infinity)

            Button {
                Task { await anmelden() }
            } label: {
                if anmeldung.arbeitet {
                    ProgressView().tint(.black)
                } else {
                    Text("Anmelden")
                }
            }
            .buttonStyle(LimeKnopfStil())
            .disabled(anmeldung.arbeitet)

            if let text = anmeldung.fehler ?? hinweis {
                Text(text)
                    .font(.grotesk(13, .medium))
                    .foregroundStyle(anmeldung.fehler != nil ? Farbe.fehler : Farbe.lime)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: .infinity)
            }
        }
    }

    private func anmelden() async {
        fokus = nil
        hinweis = nil
        await anmeldung.anmelden(email: email, passwort: passwort)
        if anmeldung.fehler == nil { passwort = "" }
    }

    private func passwortVergessen() async {
        let mail = email.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !mail.isEmpty else {
            anmeldung.fehler = "Bitte zuerst deine E-Mail eintragen."
            return
        }
        anmeldung.fehler = nil
        // Link fuehrt in die Web-App, dort wird das neue Passwort gesetzt (gleiches Konto).
        try? await Backend.client.auth.resetPasswordForEmail(mail, redirectTo: URL(string: "https://fahrer.trisar.de"))
        hinweis = "Wenn die E-Mail bekannt ist, kommt gleich ein Link zum Zurücksetzen."
    }
}
