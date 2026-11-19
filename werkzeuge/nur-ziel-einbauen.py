#!/usr/bin/env python3
"""external-sync: Schalter nur_ziel (18.11.2026).

Die Datenbank (ziel_eta_anstossen) holt waehrend einer Fahrt "Unterwegs" alle 2 Minuten die
Live-Ankunft am Ziel. Dafuer reicht die Anfahrt vom Fahrer zum Ziel. Flug, Fahrt-Route und
Anfahrt zum Abholort bleiben aus (sonst unnoetige TomTom- und Flug-Anfragen).

Aufruf: nur-ziel-einbauen.py <pfad/zu/external-sync/index.ts>  (mehrfach aufrufbar)
"""
import sys

pfad = sys.argv[1]
text = open(pfad, encoding='utf-8').read()
if 'nurZiel' in text:
    print('nur_ziel schon drin')
    sys.exit(0)

ersetzungen = [
    (
        "    const nurFlug = body?.nur_flug === true;\n",
        "    const nurFlug = body?.nur_flug === true;\n"
        "    // nur_ziel (18.11.): Live-Ankunft am Ziel waehrend der Fahrt (ziel_eta_anstossen in der Datenbank).\n"
        "    // Nur Anfahrt Fahrer -> Ziel, kein Flug, keine Fahrt-Route, keine Anfahrt zum Abholort.\n"
        "    const nurZiel = body?.nur_ziel === true;\n",
        1,
    ),
    (
        "        if (parseFlightIata(normalizedJobFlightNumber)) {\n",
        "        if (!nurZiel && parseFlightIata(normalizedJobFlightNumber)) {\n",
        2,
    ),
    (
        "          !nurFlug &&\n          typeof job.pickup_address === 'string' &&\n",
        "          !nurFlug &&\n          !nurZiel &&\n          typeof job.pickup_address === 'string' &&\n",
        1,
    ),
    (
        "          if (typeof job.pickup_address === 'string' && job.pickup_address.trim()) {\n"
        "            const approachResult",
        "          if (!nurZiel && typeof job.pickup_address === 'string' && job.pickup_address.trim()) {\n"
        "            const approachResult",
        1,
    ),
]

for alt, neu, anzahl in ersetzungen:
    gefunden = text.count(alt)
    if gefunden != anzahl:
        sys.exit(f'Stelle {gefunden}x statt {anzahl}x gefunden: {alt[:70]!r}')
    text = text.replace(alt, neu)

open(pfad, 'w', encoding='utf-8').write(text)
print('nur_ziel eingebaut')
