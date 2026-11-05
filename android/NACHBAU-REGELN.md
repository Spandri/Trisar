# Nachbau-Regeln für die Android-Apps

Ziel: Fahrer-App (`fahrer/`, Paket `de.trisar.fahrer`) und Dispo-App (`dispo/`, `de.trisar.dispo`) als native Android-Apps, **genau wie die iOS-Apps und die Web-Apps aussehen und funktionieren**. Gleiche Datenbank, gleiche Tabellen, gleiche Logik.

## Vorlagen (in dieser Reihenfolge)
1. **iOS-Swift-Code** ist die Hauptvorlage, dort ist alles schon nachgebaut und geprüft: `ios-fahrer/TrisarFahrer/` und `ios-dispo/TrisarDispo/` (Ansichten = Seiten, Dienste = Datenlogik). Maße, Texte, Abfragen 1:1 übernehmen.
2. Web-Code zum Gegenprüfen: `fahrer/src`, `admin/src` (immer aus der Haupt-Arbeitskopie lesen, dort liegen neuere nicht committete Änderungen: `/Users/stefanospandri/Documents/Projekte/Trisar/__TRI-26-001_flottenmanagement_webapp_ss/Programm/trisar/`).

## Aufbau
- `kern/` (Paket `de.trisar.kern`): gemeinsam für beide Apps. Schon da: `Konfig`, `Backend.client` (supabase-kt 3), `WebMassstab`, `Modifier.platz/mittig`, `Farbe`, `hex()`, `grotesk()`, `TrisarHintergrund`, `DispoHintergrund`, `CssRadial`, `Icon(name)`, `Modifier.tippen`, `TrisarFussleiste`, `FussleisteUnten`, `ZurueckKnopf`, `ProfilKnopf`, `LimeKnopf`, `Anmeldung`, `LoginSeite`.
- Teile, die beide Apps brauchen (Karte, Fahrzeugkarte, Datums-Hilfen, Routen), kommen in `kern/`. Alles andere in die jeweilige App.

## Maßstab und Layout (wichtig)
- `WebMassstab` setzt 1 dp = Bildschirmbreite / 402. **Alle Web-/iOS-Maße gelten direkt in dp und sp**, z. B. `Modifier.platz(20f, 140f, 362f, 56f)` = left 20, top 140, width 362, height 56.
- Absolut positionieren wie im Web: `Box { Kind(Modifier.platz(x, y, w, h)) }`. In Compose ist `offset` auch für das Antippen richtig.
- Text: `Text("…", style = grotesk(groesse, gewicht, zeilenHoehe, abstand, farbe))`.
- Ränder: `statusBarsPadding()`, `navigationBarsPadding()`, `imePadding()` wo iOS Safe-Area/Tastatur berücksichtigt. Fußzeile immer `FussleisteUnten()` (fest unten).
- **Keine Animationen beim Antippen** (Wunsch des Users): `Modifier.tippen {}` statt `clickable` (kein Ripple), Seitenwechsel sofort, keine `AnimatedVisibility`/`animate*`, außer wo iOS sie auch hat (Fahrtblatt ziehen, Ladeanzeigen, Planung).
- Kein Nachfedern beim Scrollen: `LocalOverscrollConfiguration provides null` ist im Kern-Gerüst vorgesehen, Listen ohne Overscroll-Effekt.
- Icons: `Icon("<Dateiname ohne .svg>")` – alle SVGs aus `fahrer/public/icon` und `admin/public/icon` liegen flach in `kern/src/main/assets/icon`, Logos/Pfeile in `assets/bild`.

## Daten
- `Backend.client.from("tabelle").select(Columns.raw("…")) { filter { eq("spalte", wert) } }.decodeList<Zeile>()` mit `@Serializable data class` und Spaltennamen in snake_case.
- Realtime: `Backend.client.channel("…")`, `postgresChangeFlow<PostgresAction>(schema = "public") { table = "…"; filter(...) }`, `subscribe()`.
- Angemeldeter Nutzer: `Anmeldung.fahrerID`, `Anmeldung.profil`.

## Bauen und prüfen
- Aus `android/`: `export JAVA_HOME=/Library/Java/JavaVirtualMachines/temurin-21.jdk/Contents/Home ANDROID_HOME=/opt/homebrew/share/android-commandlinetools` und
  `./gradlew :fahrer:assembleDebug :dispo:assembleDebug --console=plain -q -Dorg.gradle.jvmargs=-Xmx1536m -Pkotlin.compiler.execution.strategy=in-process`
- In einer neuen Arbeitskopie zuerst `echo "sdk.dir=$ANDROID_HOME" > local.properties`.
- Den Emulator nicht starten (teilt sich der Hauptagent), nur bauen.

## Grenzen
- Nichts in die Live-Datenbank schreiben außer beim echten Benutzen. Keine Testdaten, keine Passwörter, nicht pushen, nicht deployen.
- Texte auf Deutsch wie in iOS/Web. Kommentare im Code auf Deutsch, kurz, das Warum.
