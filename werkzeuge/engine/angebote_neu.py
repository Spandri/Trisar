"""Nur die Rad-/ÖPNV-Angebote neu rechnen und in die Engine-Ergebnisse schreiben.
Die Planung selbst ändert sich dadurch nicht (Fahrzeug bleibt reserviert).
Aufruf: .venv/bin/python angebote_neu.py"""
import json
from pathlib import Path

import angebote
import daten
import demo_daten as dd
import szenarien

DATEIEN = [Path(__file__).parent / "ergebnisse" / "engine-ergebnisse.json",
           Path(__file__).resolve().parents[2] / "admin-app-demo" / "src" / "demo" / "data" / "engine-ergebnisse.json"]

dd.flotte_setzen()
neu = {}
for tag in dd.EREIGNISSE_JE_TAG:
    daten.ereignisse_setzen(dd.EREIGNISSE_JE_TAG[tag])
    gs, _ = dd.gruppen_fuer_tag(tag)
    neu[str(tag)] = angebote.fuer_tag(gs, szenarien.erzeuge(gs, 500, seed=11 + tag))   # wie demo_lauf
    print(dd.TAG_NAME[tag], len(neu[str(tag)]), "Angebote", flush=True)
for pfad in DATEIEN:
    alles = json.loads(pfad.read_text())
    for tag, a in neu.items():
        if tag in alles["tage"]:
            alles["tage"][tag]["angebote"] = a
    pfad.write_text(json.dumps(alles, ensure_ascii=False, indent=1))
    print("geschrieben", pfad)
