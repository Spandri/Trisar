#!/usr/bin/env python3
"""Baut den MUC-Flugabruf (17.11.2026) in eine fremde external-sync/index.ts ein.

Auf dem MacBook 2018 laeuft ein aelterer Stand von external-sync (ohne route_fest). Der lokale Stand darf dort noch
nicht hin. Dieses Skript uebertraegt nur die MUC-Aenderung: Import, Anbieter-Typ, Anbieter beim Lesen des Payloads
und den Block "Flughafen Muenchen zuerst" vor Lufthansa. Der Block wird aus der lokalen Datei gelesen, damit es nur
eine Quelle gibt.

  python3 werkzeuge/muc-flug-einbauen.py <lokale external-sync/index.ts> <zu aendernde Datei>

Laeuft die Datei schon mit MUC, passiert nichts.
"""
import sys

lokal_pfad, ziel_pfad = sys.argv[1], sys.argv[2]
lokal = open(lokal_pfad, encoding='utf-8').read()
ziel = open(ziel_pfad, encoding='utf-8').read()

if "from '../_shared/muc-flughafen.ts'" in ziel:
    print('   external-sync hat MUC schon')
    sys.exit(0)

ANFANG = "            // Flughafen Muenchen zuerst (kostenlos, auch Codeshare)"
ENDE = "            if (useLufthansaProvider && !flightResolved) {"
a = lokal.index(ANFANG)
e = lokal.index(ENDE, a) + len(ENDE)
block = lokal[a:e]

ersetzungen = [
    ("import { recordUsageWithCost } from '../_shared/usage-tracking.ts';\n",
     "import { recordUsageWithCost } from '../_shared/usage-tracking.ts';\n"
     "import { MUC_ANBIETER, MUC_PLAN_ANBIETER, mucAnkunft } from '../_shared/muc-flughafen.ts';\n"),
    ("type FlightProviderName = 'lufthansa_open_api' | 'aviationstack';",
     "type FlightProviderName = 'lufthansa_open_api' | 'aviationstack' | 'muc_flughafen' | 'muc_flugplan';"),
    ("    provider: summary.provider === 'aviationstack' ? 'aviationstack' : 'lufthansa_open_api',\n",
     "    provider: summary.provider === 'aviationstack' || summary.provider === MUC_ANBIETER || summary.provider === MUC_PLAN_ANBIETER\n"
     "      ? summary.provider as FlightProviderName\n"
     "      : 'lufthansa_open_api',\n"),
    ("            flightStatus = 'miss';\n            let flightResolved = false;\n\n            if (useLufthansaProvider) {",
     "            flightStatus = 'miss';\n            let flightResolved = false;\n\n" + block),
]
for alt, neu in ersetzungen:
    if ziel.count(alt) != 1:
        sys.exit(f'FEHLER: Stelle nicht genau einmal gefunden: {alt[:70]!r}')
    ziel = ziel.replace(alt, neu)

open(ziel_pfad, 'w', encoding='utf-8').write(ziel)
print('   external-sync: MUC eingebaut')
