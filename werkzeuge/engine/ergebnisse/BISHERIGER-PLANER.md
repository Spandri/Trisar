# Bisheriger Planer als Vergleich

`bisheriger-planer-tag<N>.json` ist die Antwort des bisherigen Planers
(`admin-app-lokal/optimizer`, KI-Korridor plus CP-SAT) für den Demo-Tag N mit den
heutigen Fahrten. `stoerung.bisheriger_plan()` nimmt diese Datei vor dem
gespeicherten Plan aus `planer-ergebnisse.json`.

Messetag (Tag 2), neu gerechnet am 02.11.2026 nach den vier neuen Fahrten Grünwald/Starnberg →
Messe (174 Fahrten, 101 Fahrer, 101 Fahrzeuge). Die Anfrage ist aus der Demo-Oberfläche
mitgeschnitten und liegt in `../bisheriger_planer/anfrage_tag2.json`. Einstellungen wie der
bisherige Vergleich: Strategie „ausgewogen“, höchstens 8 h, mindestens 3 h, 3 h Pause,
20 min Puffer, 80 min Fahrtdauer, Güte 5 %.

Rechenzeit: die Sicherheitsgrenzen des Planers (Korridor-Runden 600 s und 1200 s). Die Güte 5 %
erreicht der Planer an diesem Tag nie: Die Strafe von 1 Mio. je offener Fahrt drückt die untere
Schranke des Solvers auf rund −131 Mio., sie steht nach 6 s fest und bewegt sich nicht mehr. Ein
Lauf ohne Zeitgrenze wurde nach über 9 h ohne fertige Runde abgebrochen. Der ausgegebene Wert
`optimality_gap` ist ein Anteil (249 = 24.900 %), kein Prozentwert.

## Neu rechnen

Wenn sich die Fahrten des Tages ändern (ob ein Plan passt, steht in
`bisheriger_planer.passend` der Engine-Ergebnisse):

1. Anfrage neu mitschneiden (Demo-Oberfläche, Messetag planen, POST an `/solve` abfangen) und
   die Einstellungen wie oben setzen.
2. In `../bisheriger_planer`: `.venv/bin/python rechnen.py anfrage_tag2.json ../ergebnisse/bisheriger-planer-tag2.json`
   (Umgebung siehe Kopf von `rechnen.py`).
3. In `werkzeuge/engine`: `.venv/bin/python bisheriger_planer/einbauen.py 2`
