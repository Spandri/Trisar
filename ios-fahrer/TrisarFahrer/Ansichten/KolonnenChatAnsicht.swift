import SwiftUI

/// Nachbau von KolonnenChat.jsx (Raster 402 x 864): Zurueck 20/60, Titel mittig auf Knopfhoehe,
/// Verlauf ab 109, Eingabe 70 ueber dem unteren Rand (mit Tastatur 12 darueber).
struct KolonnenChatAnsicht: View {
    let titel: String
    var zurueck: () -> Void
    @StateObject private var chat: KolonnenChat
    @State private var text = ""
    @FocusState private var fokus: Bool

    init(chatID: UUID, fahrerID: UUID, titel: String, zurueck: @escaping () -> Void) {
        self.titel = titel
        self.zurueck = zurueck
        _chat = StateObject(wrappedValue: KolonnenChat(chatID: chatID, fahrerID: fahrerID))
    }

    var body: some View {
        ZStack(alignment: .top) {
            ChatHintergrund().ignoresSafeArea()

            VStack(spacing: 0) {
                // Kopf: Zurueck links, Titel (10 fett Lime) mittig auf Knopfhoehe.
                ZStack {
                    Text(titel).grotesk(10, .bold).foregroundStyle(Color(hex: 0xE3F654))
                    HStack { ZurueckKnopf(aktion: zurueck); Spacer() }
                }
                .frame(height: 50)
                .padding(.horizontal, 20)
                .padding(.top, 60)

                verlauf
                    .padding(.top, 109 - 110)

                eingabe
                    .padding(.horizontal, 20)
                    .padding(.top, 16)
                    .padding(.bottom, fokus ? 12 : 70)
            }
            .ignoresSafeArea(edges: .top)

            if !fokus { FussleisteUnten() }
        }
        .background(Color.black)
        .task { await chat.starten() }
        .onDisappear { Task { await chat.beenden() } }
    }

    private var verlauf: some View {
        ScrollViewReader { leser in
            ScrollView(showsIndicators: false) {
                VStack(spacing: 16) {
                    if chat.geladen && chat.nachrichten.isEmpty {
                        Text("Noch keine Nachrichten in dieser Kolonne.")
                            .font(.grotesk(14, .medium)).foregroundStyle(Farbe.grauText)
                            .padding(.horizontal, 16).padding(.vertical, 12)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    ForEach(chat.nachrichten) { n in
                        Blase(nachricht: n).id(n.id)
                    }
                }
                .padding(.horizontal, 20)
                .padding(.top, 16)
                .padding(.bottom, 16)
            }
            .scrollDismissesKeyboard(.interactively)
            .onChange(of: chat.nachrichten.count) { _, _ in
                if let letzte = chat.nachrichten.last { withAnimation { leser.scrollTo(letzte.id, anchor: .bottom) } }
            }
            .onChange(of: fokus) { _, _ in
                if let letzte = chat.nachrichten.last { withAnimation { leser.scrollTo(letzte.id, anchor: .bottom) } }
            }
        }
    }

    private var eingabe: some View {
        let leer = text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        return HStack(alignment: .bottom, spacing: 12) {
            TextField("", text: $text, prompt: Text(verbatim: "Nachricht schreiben...").foregroundStyle(Farbe.grauText), axis: .vertical)
                .font(.grotesk(16))
                .foregroundStyle(.white)
                .tint(Farbe.lime)
                .lineLimit(1...5)
                .focused($fokus)
                .padding(.horizontal, 16)
                .padding(.vertical, 12)
                .frame(minHeight: 48)
                .background(RoundedRectangle(cornerRadius: 20).fill(Color(hex: 0x242425)))
                .overlay(RoundedRectangle(cornerRadius: 20).stroke(Color(hex: 0x3F3F46), lineWidth: 1))
                // Ganzer Kasten nimmt den Tipp an, nicht nur die Textzeile (wie das label im Web).
                .contentShape(RoundedRectangle(cornerRadius: 20))
                .onTapGesture { fokus = true }
            Button {
                let t = text
                text = ""
                Task { await chat.senden(t) }
            } label: {
                Image("Arrow_Trisar_Icons_01").resizable().renderingMode(.template).scaledToFit()
                    .foregroundStyle(.black)
                    .frame(width: 22, height: 19)
                    .rotationEffect(.degrees(-45))
                    .frame(width: 48, height: 48)
                    .background(Circle().fill(Color(hex: leer ? 0xE3F654 : 0xE3F754)))
                    .opacity(leer ? 0.5 : 1)
            }
            .buttonStyle(.web)
            .disabled(leer)
        }
        .background(Color.black.opacity(0.6))
    }
}

/// Eine Nachricht: fremde links (grau, Name darueber), eigene rechts (Lime), Uhrzeit darunter.
private struct Blase: View {
    let nachricht: KolonnenChat.Nachricht
    var body: some View {
        VStack(alignment: nachricht.ich ? .trailing : .leading, spacing: 4) {
            if !nachricht.ich {
                Text(nachricht.absender).font(.grotesk(12, .medium)).foregroundStyle(Farbe.grauText)
                    .padding(.leading, 16)
            }
            Text(nachricht.text)
                .font(.grotesk(16))
                .foregroundStyle(nachricht.ich ? Color.black : Color.white)
                .padding(.horizontal, 16).padding(.vertical, 12)
                .frame(minHeight: 52)
                .background(RoundedRectangle(cornerRadius: 12).fill(nachricht.ich ? Color(hex: 0xE3F654) : Color(hex: 0x242425)))
                .frame(maxWidth: 256, alignment: nachricht.ich ? .trailing : .leading)
            Text(nachricht.zeit).font(.grotesk(12)).foregroundStyle(Farbe.grauText)
                .padding(.leading, 16)
                .frame(width: 56, alignment: .leading)
        }
        .frame(maxWidth: .infinity, alignment: nachricht.ich ? .trailing : .leading)
    }
}

/// radial-gradient(141.42% 102.21% at 0% 0%, #313701 0%, #000 46%)
private struct ChatHintergrund: View {
    var body: some View {
        Canvas { k, g in
            k.fill(Path(CGRect(origin: .zero, size: g)), with: .color(.black))
            var e = k
            e.scaleBy(x: g.width * 1.4142, y: g.height * 1.0221)
            e.fill(Path(CGRect(x: -1, y: -1, width: 2, height: 2)),
                   with: .radialGradient(Gradient(stops: [
                       .init(color: Color(hex: 0x313701), location: 0),
                       .init(color: .black, location: 0.46),
                       .init(color: .black, location: 1),
                   ]), center: .zero, startRadius: 0, endRadius: 1))
        }
    }
}
