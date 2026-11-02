# Echte Planer-Ergebnisse für die Demo

Die Demo (demo.trisar.de) läuft ohne Planer-Server. Damit der KI-Planer trotzdem
zeigt, was die echte Planung liefert, sind die in der Oberfläche wählbaren Fälle
vorab mit dem echten Planer gerechnet: `admin-app-lokal/optimizer`, KI-Korridor
plus CP-SAT, genau wie `/solve`. Gerechnet wird mit genau den Anfragen, die die
Oberfläche schickt.

- 3 Strategien × Starttag (heute, morgen, Messetag) × Zeitraum (1–3 Tage)
- einmal mit frischen Demo-Daten, einmal nach dem Dispo-Tutorial (es legt zwei
  Fahrten an: heute 18:45 zum Flughafen, morgen 10:30 per KI-Assistent)

Ergebnis: `admin-app-demo/src/demo/data/planer-ergebnisse.json` (morgen und
Messetag, dazu exakte Zeitgrenzen je Fahrt und Fahrerprofile) und
`planer-ergebnisse-heute.json` (heute). Die Demo lädt beide erst, wenn geplant
wird. „Heute“ gibt es für jede 5-Minuten-Lage der Beispiel-Kolonne, weil
`demoClient.js` die Kolonnenfahrt beim Laden auf „jetzt + 20 min“ legt.
Suche zur Laufzeit: `admin-app-demo/src/demo/planerErgebnisse.js` mit dem
Fingerabdruck aus `planerSchluessel.js`:

- **genau**: Der Planer bekäme dieselbe Aufgabe. Fahrer, Ruhezeiten, Fahrten
  und Fahrzeuge sind gleich; in der Demo angelegte Fahrten werden über ihren
  Inhalt erkannt.
- **angepasst**: Nur Tag und Einstellungen sind gleich. Der nächstliegende Plan
  wird auf die aktuelle Lage gebracht, neue Fahrten bleiben offen.
- Ohne Treffer (z. B. eigene Planungsregeln) fällt die Demo auf die Heuristik
  zurück.

## Wann neu rechnen

Wenn sich eines davon ändert:
- Demo-Daten (`jobs.json`, `profiles.json`, `vehicles.json`, `distances.json`)
- der Planer
- die Strategie-Voreinstellungen oder der Fahrerpool
- das Dispo-Tutorial, sofern es Fahrten anlegt

`node planer-pruefen.js …` zeigt, ob noch alles „genau“ trifft.

## Ablauf

Voraussetzungen:
- Python mit den Paketen aus `admin-app-lokal/optimizer/requirements.txt`
- `npm i playwright-core` in diesem Ordner
- Google Chrome

Arbeitsdaten (Warteschlange, Zwischenspeicher, Szenarien) liegen in `arbeit/`,
nicht im Repo; der Ort ist mit `PLANER_ARBEIT` änderbar.

1. **Demo bauen und lokal ausliefern:**
   `../../deploy.sh --build`, dann `python3 -m http.server 5311 --bind 127.0.0.1 --directory ../../deploy`.
   Beim Erfassen blendet `planer-lauf.js` die schon eingebauten Ergebnisse aus.
2. **Rechner starten** (läuft dauerhaft):
   `caffeinate -dims env PLANER_PYTHON=… python planer_rechnen.py`.
   Er nimmt Anfragen aus `arbeit/queue`, höchstens so viele CP-SAT-Worker wie Kerne.
3. **Erfassen, erst die Einzeltage:**
   `WARTESCHLANGE=1 node planer-lauf.js ausgewogen:0:1 ausgewogen:1:1 ausgewogen:2:1 …`
   Nach dem Tutorial dasselbe mit `--nach-tutorial`.
   Fehlende Tage landen in der Warteschlange. Wenn der Rechner fertig ist, den
   Aufruf wiederholen, dann mit allen Zeiträumen (`:0:2`, `:0:3`, `:1:2`).
   Kleine Anfragen (Tage mit wenigen Fahrten) rechnet `planer_klein.py <ordner>` sofort.
4. **Heute für alle Kolonnen-Uhrzeiten:** `node planer-heute-anfragen.js`, dann
   `python planer_heute.py` (1.728 kleine Rechnungen, ca. 1 min).
5. **Grenzen und Profile** für die Laufzeit-Anpassung: `node planer-fenster-anfragen.js`,
   dann `python planer_fenster.py`.
6. **Einbauen:** `node planer-einbauen.js` schreibt beide Ergebnis-Dateien.
7. **Prüfen und deployen:** Demo neu bauen, dann `node planer-pruefen.js ausgewogen:0:1 ausgewogen:2:1 …`.
   Einzeltage müssen „genau“ treffen; mehrtägige Planungen ab heute dürfen
   „angepasst“ sein. Andere Uhrzeiten testen mit `--uhr=08:07`, den Zustand
   nach dem Tutorial mit `--nach-tutorial`. Dann `./deploy.sh --build`.

## Gut zu wissen

- **Rechenzeit:** Heute unter 1 s. Morgen (128 Fahrten) 2–30 min. Messetag
  (323 Fahrten) etwa 30 min je Strategie: Die Güte wird dort nicht erreicht, also
  laufen beide Korridor-Runden bis zum Zeitlimit (600 s + 1200 s).
- **Mehrtägige Planungen** werden nicht neu gerechnet. Ein Folgetag unterscheidet
  sich vom Einzeltag nur durch Ruhezeitfenster. `planer_ableiten.py` tauscht
  Fahrer mit Konflikt gegen für den Solver gleichwertige, freie Fahrer. Die
  Zulässigkeit prüft es je Fahrt mit der Regel des Solvers. Zielwert und
  Güte-Schranke bleiben damit gültig. Geht das nicht, landet der Tag in der
  Warteschlange.
- **Fahrzeiten ab München** kommen aus `fahrzeiten_von_muenchen.json`. Die Tabelle
  ist dieselbe Nominatim/OSRM-Rechnung wie im Planer, einmal gerechnet mit den
  Koordinaten der Demo, weil Nominatim unter Last nicht antwortet (dann setzt der
  Planer pauschal 75 min an). Neu bauen mit `fahrzeiten_bauen.py`. Neue Adressen
  aus dem Tutorial ergänzen, sonst fragt der Rechner Nominatim direkt.
- **Rechnerlast verfälscht die Güte.** CP-SAT arbeitet mit Zeitlimit; laufen
  mehrere große Rechnungen und Browser parallel, wird das Ergebnis schlechter.
  Beispiel morgen „ausgewogen“: unter Last 12,5 % Restlücke, allein 4,9 %
  (OPTIMAL). Schwere Tage deshalb möglichst allein rechnen.
- **Offene Fahrten am Messetag** entstehen aus den Planungsregeln, nicht aus
  Fahrermangel. Der Mindestdienst (3 h) muss aus Fahrten bestehen, und zwischen
  zwei Fahrten sind höchstens 2 h erlaubt. Die 22-Uhr-Abreisewelle (101 Starts)
  lässt sich damit nur teilweise besetzen.
