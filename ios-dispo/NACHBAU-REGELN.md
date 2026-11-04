# Nachbau-Regeln für die nativen TRISAR-Apps

Ziel: Die Web-Apps (`fahrer/` = fahrer.trisar.de, `admin/` = admin.trisar.de) werden **1:1 im Aussehen** als SwiftUI-Apps nachgebaut (`ios-fahrer/`, `ios-dispo/`). Gleiche Datenbank (Supabase hinter `https://fahrer.trisar.de/supabase`), gleiche Tabellen, gleiche Logik.

## Aufbau
- `ios-fahrer/TrisarFahrer/` – Fahrer-App. Geteilte Bausteine liegen hier und werden von `ios-dispo/project.yml` per Pfad eingebunden (Liste dort ergänzen, wenn ein weiterer gebraucht wird).
- `ios-dispo/TrisarDispo/` – Dispo-App. `Ansichten/DispoHaupt.swift` wechselt die Seiten (`DispoZiel`), `Ansichten/Navileiste.swift` ist die feste Leiste unten (`Navileiste(aktiv:waehlen:)`), `DispoHintergrund()` der blaue Verlauf.
- Projektdateien entstehen mit XcodeGen aus `project.yml` (die `.xcodeproj` nie von Hand ändern).

## Bauen
- Fahrer: `ios-fahrer/werkzeuge/bauen.sh`, Dispo: `ios-dispo/werkzeuge/bauen.sh`.
- In einer eigenen Arbeitskopie mit eigenem DerivedData bauen:
  `xattr -cr TrisarDispo ../ios-fahrer/TrisarFahrer && xcodegen generate --quiet && env -i HOME=$HOME USER=$USER PATH=/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin xcodebuild -project TrisarDispo.xcodeproj -scheme TrisarDispo -destination 'generic/platform=iOS Simulator' -derivedDataPath $HOME/Library/Developer/Xcode/DerivedData/<eigener-name> -quiet build`
  - `env -i` ist Pflicht (Conda setzt sonst falsche Linker), `xattr -cr` ist Pflicht (iCloud-Attribute brechen die Signatur).
  - Die Meldung „failed with exit code 0 but produced no further output“ ist harmlos.

## Layout wie im Web
- Die Web-Seiten sind absolut positioniert in einem Raster 402 x 874 (manche 393 oder 864). Maße direkt übernehmen:
  - `Leinwand(breite:basisHoehe:inhaltHoehe:mitHintergrund:beimZiehen:) { rahmenHoehe in ZStack(alignment: .topLeading) { ... } }` skaliert wie das Web und scrollt, wenn `inhaltHoehe` größer ist.
  - `.platz(x, y, w, h, ausrichtung)` = `left/top/width/height`. **Nie `.offset` zum Platzieren** (Tipp-Flächen verrutschen sonst).
  - `.mittig(mitteX, y, w, h)` für `left:50%; translateX(-50%)`.
- Text: `.grotesk(größe, gewicht, abstand:)` (Space Grotesk, `abstand` = tracking). Mehrzeiliger Text mit CSS-Zeilenhöhe (`leading-[..]`): `WebText(text:groesse:gewicht:zeilenHoehe:abstand:farbe:ausrichtung:)`.
- Farben: `Color(hex: 0xRRGGBB)`, fertige in `Farbe.*` (Stil.swift). Tailwind-Werte aus dem JSX übernehmen.
- Icons: `Image("<Dateiname ohne .svg>")` – alle SVGs aus `admin/public/icon` liegen im Asset-Katalog (`ios-dispo/werkzeuge/icons-uebernehmen.sh`).
- Fertige Bausteine: `ZurueckKnopf`, `ProfilKnopf`, `TrisarFussleiste`, `FussleisteUnten`, `LimeKnopfStil`, `FahrzeugKarte` + Kacheln, `KarteAnsicht` (MapLibre, CARTO Dark Matter), `CSSRadial` (CSS radial-gradient), `NotizBlatt`.
- Hintergründe: CSS-`radial-gradient(...)` → `CSSRadial(rx:ry:stopps:)`. Der SVG-Verlauf mit `matrix(40.2 87.4 ...)` → `TrisarHintergrund()`.

## Daten
- `Backend.client` (supabase-swift). Abfragen 1:1 wie im JSX (gleiche Tabellen, Spalten, Filter). Decodable-Structs mit Spaltennamen in snake_case.
- Angemeldeter Nutzer: `@EnvironmentObject Anmeldung` (`fahrerID` = User-ID, `profil`).
- Realtime: `Backend.client.channel(...)`, `postgresChange(AnyAction.self, schema: "public", table:, filter: .eq(...))`, `subscribeWithError()`.
- Datums-Hilfen: `Datum` (Fahrten.swift, FahrtDetails.swift), Adressen: `Adresse.kurz/fuerNavigation`.

## Grenzen
- Nichts in die Live-Datenbank schreiben außer beim echten Benutzen der App. Keine Testdaten anlegen.
- Keine Passwörter eingeben, nicht pushen, nicht deployen.
- Texte auf Deutsch aus `admin/src/i18n/de.js`. Kommentare im Code auf Deutsch, kurz, das Warum.
- Demo-only-Teile (`DEMO_MODE`) weglassen, es zählt der Live-Zweig.
