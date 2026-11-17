#!/usr/bin/env python3
"""Live-Board entfernt (17.11.2026, Wunsch User): Die Listen zeigen den Kasten nicht mehr. In
admin/src/App.jsx wird die Tafel deshalb auch nicht mehr geladen (bisher alle 60 s und bei Aktualisieren).

Baut nur diese Aenderung in eine App.jsx ein, damit auf dem Server nicht die ganze lokale Datei (mit noch
nicht ausgerollten Aenderungen anderer Sitzungen) landet. Mehrfach ausfuehren schadet nicht.

  python3 werkzeuge/tafel-weg-einbauen.py <App.jsx> [weitere App.jsx]
"""
import sys

MARKE = '// Live-Board entfernt (17.11.): nichts mehr laden'
ERSETZEN = [
    ("  const refreshAirportBoard = useCallback(async (mode = 'arrivals') => {\n",
     "  const refreshAirportBoard = useCallback(async (mode = 'arrivals') => {\n    " + MARKE + "\n    if (mode) return;\n"),
    ("    if (view !== 'ankuenfte' && view !== 'abfahrten') return undefined;\n    const mode = view === 'abfahrten' ? 'departures' : 'arrivals';\n",
     "    // Live-Board entfernt (17.11.): kein Nachladen mehr alle 60 s\n    if (view) return undefined;\n    const mode = view === 'abfahrten' ? 'departures' : 'arrivals';\n"),
]


def einbauen(pfad):
    text = open(pfad, encoding='utf-8').read()
    if MARKE in text:
        print(f'   {pfad}: schon drin')
        return
    for alt, _ in ERSETZEN:
        if text.count(alt) != 1:
            sys.exit(f'{pfad}: Stelle nicht eindeutig gefunden ({alt.strip()[:50]}...), nichts geaendert')
    for alt, neu in ERSETZEN:
        text = text.replace(alt, neu)
    open(pfad, 'w', encoding='utf-8').write(text)
    print(f'   {pfad}: eingebaut')


if __name__ == '__main__':
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    for p in sys.argv[1:]:
        einbauen(p)
