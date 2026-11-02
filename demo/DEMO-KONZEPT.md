# TRISAR Demo-Vorschau — Konzept & Anforderungen

Stand: 18.08.2026 · Live: https://demo.trisar.de (parallel: https://trisar-demo.pages.dev)

## Zweck

Interaktive Produktvorschau für das EXIST-Gremium. Der Link steht in der Bewerbung;
das Gremium soll sich ohne Anleitung, Account oder Terminabsprache durch das Produkt
klicken können — jederzeit, auch Wochen nach Abgabe. Die Demo ersetzt keinen
Feldbetrieb und behauptet keinen: alle Daten sind simuliert und werden auf der
Startseite als solche ausgewiesen (wichtig für die EXIST-Ehrlichkeit, es gab keinen
Piloten).

## Grundprinzipien

1. **Immer erreichbar, ohne laufenden Rechner.** Statisches Hosting auf Cloudflare
   Pages — kein Server, der einschlafen oder ausfallen kann, keine laufenden Kosten.
   Das ursprüngliche Setup (alles auf dem MacBook) ist damit für die Vorführung
   abgelöst; der Quellcode bleibt ausschließlich lokal, online geht nur das
   gebaute Bundle.
2. **Kein Backend, echtes Verhalten.** Supabase ist durch einen In-Memory-Mock
   ersetzt, der die komplette Query-API nachbildet. Die Apps laufen unverändert
   gegen diesen Mock. Änderungen (Fahrt anlegen, Schicht vergeben, accept/refuse)
   funktionieren echt, leben aber nur im Browser-Tab — **Reload = Demo frisch
   zurückgesetzt**. Genau so gewollt: jeder Gremiumsbesuch startet im selben,
   sauberen Zustand.
3. **Die Demo veraltet nie.** Alle Datumswerte werden beim Laden automatisch so
   verschoben, dass der Demo-Basistag immer „heute" ist. Egal wann jemand klickt:
   - **Heute:** 34 Fahrten, davon Stefanos 4 eigene; die übrigen 30 sind
     anderen Fahrern zugewiesen (Flughafen, Termine, Abendessen; 2 abgelehnt,
     6 noch ohne Antwort). Zwischen 14:30 und 16:24 liegen nur Stefanos Fahrten
     (Dispo-Tutorial).
   - **Morgen — Stadttag:** 124 offene Fahrten (inkl. Schloss Elmau, Augsburg),
     alle ohne Fahrer.
   - **Übermorgen — Messetag Riem:** 170 offene Fahrten, alle ohne Fahrer:
     Morgenwelle 06:30–10:00 (26 Fahrten von Flughafen, Andaz Schwabinger Tor,
     Hotels und Hauptbahnhof zur Messe), tagsüber Messebetrieb, Abreise
     20:00–24:00 (44 Fahrten). So bemessen, dass der KI-Planer alle Fahrten
     besetzen kann.
   Vergangene Tage (Archiv, GPS-Historie) bleiben relativ dazu in der Vergangenheit.
4. **Ehrliche Kennzeichnung.** Landing-Seite und Viewer tragen den Hinweis
   „Demo-Vorschau · alle Daten simuliert". Personen, Firmen und Kontakte sind
   fiktiv; Telefonnummern und E-Mail-Adressen sind bewusst nicht vergeben
   (niemand kann versehentlich echte Nummern anrufen).

## Einstieg & Präsentation

- **Landing-Seite** im TRISAR-Stil (Space Grotesk, Lime `#e3f654`, eckige Kanten,
  App-Farbverlauf) mit zwei Karten: **Disposition (Admin)** und **Fahrer-App**.
- **iPhone-Rahmen am Desktop:** Öffnet man die Demo am PC, läuft die App in einem
  simulierten iPhone (402 × 874 pt Display, Dynamic Island), damit das Gremium den
  mobilen Eindruck sieht. Umschalter Disposition ↔ Fahrer-App in der Kopfleiste.
  Echte Mobilgeräte werden erkannt und bekommen die App direkt im Vollbild.
- Scrollbalken sind wie auf iOS unsichtbar, Icons/Assets liegen vollständig im
  Deployment (case-sensitiv geprüft — Cloudflare unterscheidet Groß-/Kleinschreibung,
  macOS nicht).

## Disposition (Admin-App)

- **Start:** Begrüßung, zwei Kennzahl-Kacheln „Seit Einsatzbeginn":
  CO₂-Emissionen und Einsatzkosten. Beide werden aus dem simulierten
  Fahrtenbestand hergeleitet; alle Annahmen (km je Fahrttyp, Leerfahrten-,
  Standby-Faktor, 195 g CO₂/km, 28 €/h Lohn, 0,45 €/km Fahrzeug) stehen
  dokumentiert in `admin-app-demo/src/demo/einsatzKennzahlen.js` und sind auf
  Nachfrage im Gespräch herleitbar.
- **Alle Fahrer:** Planungsübersicht als wischbares Chart über den 3-Tage-Horizont
  (Fahrer-Balken, Fahrten-Linie, Bedarfs-Linie — Datumszeile folgt dem sichtbaren
  Fenster). Filter: Suche, Status, sowie **Start…/Ende…** = Dienstbeginn ab /
  Dienstende bis Uhrzeit (Zeit-Picker: Chrome öffnet Dropdown, macOS-Safari
  bekommt ein tippbares Feld, iPhone das native Zeitrad).
- **Alle Fahrten:** komplette Fahrtenliste; offene Fahrten zeigen „Fahrer fehlt".
- **Karte:** Live-Flottenansicht (Google Maps) mit simulierten Fahrerpositionen.
- **KI-Assistent (Chat):** zeigt einen sauberen Demo-Hinweis — das Sprachmodell
  läuft nur in der Vollversion (lokales LLM, in einer statischen Demo nicht
  betreibbar).

## KI Planer (Kernstück der Demo)

Umsetzung nach Figma-Design (Trisar_App_01, Node 2094:12368).

- **Chart:** grüne Balken = eingeplante Fahrer, gelbe/rote Punkte = Fahrerbedarf,
  blaue Linie = gebuchte Fahrten. Y-Achse passt sich dem sichtbaren Fenster an.
  **Wischen** blättert stundenweise durch die 3 Tage; die Datumszeile unter dem
  Titel und der Planungstag folgen der Fenstermitte.
- **Bedarf** leitet sich ausschließlich aus der Fahrtenlast ab (geglättet) —
  unabhängig vom vorhandenen Personal. Dadurch gilt: **Rot = echte Unterdeckung**,
  und sie verschwindet sichtbar durch Planung + Vergabe.
- **Echte Planung:** Der Button „KI Einsatzplanung" ruft den unveränderten
  Planungscode der Vollversion auf (`kiDriverPlanner`-Heuristik: Fahrtdauern,
  Puffer, Pausenregeln, Min-/Max-Arbeitszeit, Bedarfsprofil, Bereitschaft).
  CP-SAT-Solver und Llama sind Serverstufen und in der statischen Demo bewusst
  nicht aktiv. Strategien mit echten Planer-Parametern:
  | Strategie | Fahrerpool | Schichtlänge | Puffer |
  |---|---|---|---|
  | Ausgewogen | 20 | max. 8 h | 20 min |
  | Effizient | 14 | max. 10 h | 15 min |
  | Konservativ | 26 | max. 6 h | 30 min |
- **Schichtvergabe ist der Demo-Flow:** Die Fahrer starten **ohne Schichten**
  (nur Stefano hat seine). Der Planer schlägt Schichten mit zugeordneten Fahrten
  vor (accept/refuse im Fahrer-App-Stil). **accept** vergibt die Schicht wirklich:
  sie erscheint in der Fahrerliste, in der Planungsübersicht und als wachsender
  Balken im Planer-Chart — tagesgenau (eine Dienstag-Schicht taucht nicht am
  Mittwoch auf). Vergaben überleben das Schließen des Planers; erst der Reload
  setzt alles zurück.
- **Vorführmoment:** Zum Messetag wischen (170 offene Fahrten, alles rot),
  „KI Einsatzplanung", Vorschläge akzeptieren — der Bedarf wird Stunde für Stunde
  grün gedeckt.

## Fahrer-App

- Automatisch angemeldet als Demo-Fahrer „Stefano Spandri" (kein Login nötig).
- Tagesplan mit Fahrzeug, Fahrtkarten „Heute"/„Morgen", accept/refuse bei neuen
  Fahrten, Fahrtdetails mit Karte, Flugnummer, Gästen.
- **Support-Seite:** Zentrale Hotline zuoberst (24/7 besetzt, Rufnummer bewusst
  Platzhalter — Anruf über „Get in touch"), darunter Samira Chengula
  (Kundenbetreuung, 9–17 Uhr) und Anna Schubert (Schichtplanung & Disposition,
  6–22 Uhr).

## Technischer Betrieb (Kurzreferenz)

- Quelle: `Programm/demo-vorschau/` (admin-app-demo, fahrer-app-demo, deploy/).
  Original-Apps bleiben unangetastet; `src/demo/demoClient.js` in beiden Apps
  synchron halten.
- Build: je App `VITE_KI_PROVIDER=heuristic VITE_GOOGLE_MAPS_API_KEY=<Key>`
  `node node_modules/vite/bin/vite.js build --base=/admin/` bzw. `--base=/fahrer/`,
  `dist` nach `deploy/admin` bzw. `deploy/fahrer` kopieren.
- Deploy: `npx wrangler pages deploy deploy --project-name=trisar-demo --branch=main`.
- Google-Maps-Key steckt im öffentlichen Bundle (bewusste Entscheidung).
  **Offen:** Referrer-Beschränkung auf `demo.trisar.de/*` und
  `trisar-demo.pages.dev/*` in der Google Cloud Console.
- Nach jedem Deploy: Browser-Cache beachten (Hard-Reload; Safari: Cmd+Option+R).

## Bewusste Grenzen

- Kein echtes Backend, keine Persistenz über den Tab hinaus (gewollt).
- Llama/CP-SAT nur in der Vollversion (bräuchten gehostete Dienste).
- KI-Chat-Assistent zeigt Demo-Hinweis statt Antworten.
- Schichten am Fahrerprofil tragen genau ein Datum — ein Fahrer kann im
  3-Tage-Horizont eine geplante Schicht „tragen" (Datenmodell der Vollversion).
