"""Rechnet kleine Anfragen (<= 60 Fahrten, Sekundenbruchteile) sofort, am Rechner vorbei.

Aufruf: planer_klein.py <ordner>  — jede <schluessel>.json darin wird wie in
planer_rechnen.py gerechnet und nach arbeit/cache geschrieben.
"""
import json
import os
import sys

import planer_rechnen as pr

ordner = sys.argv[1]
for name in sorted(os.listdir(ordner)):
    if not name.endswith(".json"):
        continue
    schluessel = name[:-5]
    pfad = os.path.join(ordner, name)
    with open(pfad, encoding="utf-8") as datei:
        fahrten = len(json.load(datei).get("rides") or [])
    if fahrten > 60:
        print("uebersprungen (gross):", schluessel[:10], fahrten)
        continue
    pr.QUEUE = ordner
    print(pr.rechne(schluessel))
