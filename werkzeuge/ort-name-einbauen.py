#!/usr/bin/env python3
"""Mein Standort (17.11.2026): Der Filter Ankuenfte/Abfahrten in admin/src/App.jsx vergleicht das Feld
"Mein Standort" bisher nur mit der Adresse der Fahrt (startLocation/zielLocation). Steht dort der Name
eines gespeicherten Orts (z. B. "MUC T2", Adresse "Flughafen Muenchen Terminal 2"), passt nichts.
Neu: Adresse ODER Name des gespeicherten Orts (startOrtName/zielOrtName).

Baut nur diese Aenderung in eine App.jsx ein, damit auf dem Server nicht die ganze lokale Datei (mit noch
nicht ausgerollten Aenderungen anderer Sitzungen) landet. Mehrfach ausfuehren schadet nicht.

  python3 werkzeuge/ort-name-einbauen.py <App.jsx> [weitere App.jsx]
"""
import sys

MARKE = '// Mein Standort (17.11.): Adresse oder Name des gespeicherten Orts'
HELFER = MARKE + '''
const passtStandort = (ride, seite, standort) => (
  matchesLocation(ride?.[`${seite}Location`] || '', standort)
  || matchesLocation(ride?.[`${seite}OrtName`] || '', standort)
);
'''

ERSETZEN = [
    ("activeRides.filter((ride) => matchesLocation(ride?.zielLocation || '', coordinatorLocation))",
     "activeRides.filter((ride) => passtStandort(ride, 'ziel', coordinatorLocation))"),
    ("activeRides.filter((ride) => matchesLocation(ride?.startLocation || '', coordinatorLocation))",
     "activeRides.filter((ride) => passtStandort(ride, 'start', coordinatorLocation))"),
    ("archivedRides.filter((ride) => matchesLocation(ride?.zielLocation || '', coordinatorLocation))",
     "archivedRides.filter((ride) => passtStandort(ride, 'ziel', coordinatorLocation))"),
    ("archivedRides.filter((ride) => matchesLocation(ride?.startLocation || '', coordinatorLocation))",
     "archivedRides.filter((ride) => passtStandort(ride, 'start', coordinatorLocation))"),
]
ANKER = 'const toCompactLocationLabel = (value) => {'


def einbauen(pfad):
    text = open(pfad, encoding='utf-8').read()
    if MARKE in text:
        print(f'   {pfad}: schon drin')
        return
    if text.count(ANKER) != 1:
        sys.exit(f'{pfad}: Anker fuer den Helfer nicht gefunden, nichts geaendert')
    for alt, _ in ERSETZEN:
        if text.count(alt) != 1:
            sys.exit(f'{pfad}: Stelle nicht eindeutig gefunden ({alt[:50]}...), nichts geaendert')
    text = text.replace(ANKER, HELFER + '\n' + ANKER)
    for alt, neu in ERSETZEN:
        text = text.replace(alt, neu)
    open(pfad, 'w', encoding='utf-8').write(text)
    print(f'   {pfad}: eingebaut')


if __name__ == '__main__':
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    for p in sys.argv[1:]:
        einbauen(p)
