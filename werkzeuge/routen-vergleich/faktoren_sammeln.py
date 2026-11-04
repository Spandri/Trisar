#!/usr/bin/env python3
"""Verkehrsfaktoren je Raumtyp, Tagestyp und Stunde fuer die Engine (Variante 3).

Faktor = TomTom-Fahrzeit mit typischem Verkehr / freie OSRM-Fahrzeit, Median ueber die
Lernstrecken aus vergleich.py. Tagestypen: mo-do, fr, sa, so. Stunden 5 bis 23.
Ergebnis: admin/optimizer/verkehr_faktoren.json. Zwischenspeicher: cache.json (ohne Schluessel).
Etwa 2.300 TomTom-Abfragen beim ersten Lauf, danach aus dem Zwischenspeicher.
"""
import datetime as dt, json, statistics, sys, time
from pathlib import Path

HIER = Path(__file__).resolve().parent
sys.argv = [sys.argv[0]]
import importlib.util
spec = importlib.util.spec_from_file_location("vg", HIER / "vergleich_basis.py")
vg = importlib.util.module_from_spec(spec); spec.loader.exec_module(vg)

# Naechste Woche, damit TomTom typischen Verkehr nimmt.
TAGE = {"mo-do": "2026-11-10", "fr": "2026-11-13", "sa": "2026-11-14", "so": "2026-11-15"}
STUNDEN = list(range(5, 24))

werte = {}
gesamt = len(vg.LERN) * len(TAGE) * len(STUNDEN)
n = 0
for i, j in vg.LERN:
    a, b = vg.ORTE[i], vg.ORTE[j]
    ga, gb = vg.geocode(a), vg.geocode(b)
    frei = vg.osrm_min(ga, gb)[0]
    raum = vg.raumtyp(a, b)
    for tag, datum in TAGE.items():
        for h in STUNDEN:
            n += 1
            depart = f"{datum}T{h:02d}:00:00+01:00"
            try:
                tt = vg.tomtom_min(ga, gb, depart)[0]
            except Exception as e:
                print("Fehler", a, b, depart, e); continue
            werte.setdefault(raum, {}).setdefault(tag, {}).setdefault(str(h), []).append(tt / max(frei, 0.5))
            if n % 100 == 0: print(f"{n}/{gesamt}", flush=True)

faktoren = {raum: {tag: {h: round(statistics.median(v), 3) for h, v in sorted(stunden.items(), key=lambda x: int(x[0]))}
                   for tag, stunden in tage.items()} for raum, tage in werte.items()}
ziel = vg.REPO / "admin/optimizer/verkehr_faktoren.json"
ziel.write_text(json.dumps({
    "quelle": "TomTom calculateRoute mit departAt (typischer Verkehr) / eigener OSRM, Median je Raumtyp",
    "erstellt": dt.date.today().isoformat(),
    "strecken": len(vg.LERN),
    "faktoren": faktoren,
}, ensure_ascii=False, indent=1))
print("geschrieben:", ziel)
