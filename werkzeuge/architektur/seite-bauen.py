#!/usr/bin/env python3
"""Baut architektur.html aus seite-vorlage.html + modell.json (eine Datei, offline lesbar).

    python3 werkzeuge/architektur/seite-bauen.py
"""
import json
from pathlib import Path

HIER = Path(__file__).resolve().parent
WURZEL = HIER.parent.parent
modell = (HIER / "modell.json").read_text()
json.loads(modell)  # prüfen
vorlage = (HIER / "seite-vorlage.html").read_text()
# </script> im JSON entschärfen
sicher = modell.replace("</", "<\\/")
seite = vorlage.replace("/*MODELL*/null", sicher, 1).replace('/*BASIS*/""', json.dumps(str(WURZEL)), 1)
(HIER / "architektur.html").write_text(seite)
print(f"architektur.html geschrieben ({len(seite) // 1024} KB)")
