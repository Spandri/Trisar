"""Radzeiten über TomTom (travelMode=bicycle) für alle Strecken, die die Rad-Angebote prüfen.

Ergebnis: daten_extern/radzeiten_tomtom.json, Schlüssel "lat,lng|lat,lng" (5 Nachkommastellen),
Wert {"min": Fahrzeit, "km": Strecke}. daten.rad_min und daten.rad_min_ab_ort lesen die Tabelle,
fehlt eine Strecke, bleibt die alte Schätzung (Luftlinie x 1,25, 16 km/h).

Aufruf: .venv/bin/python radzeiten_tomtom.py
Schlüssel aus admin-app-demo/.env.local (VITE_TOMTOM_API_KEY).
"""
from __future__ import annotations

import json
import time
import urllib.request
from pathlib import Path

import angebote
import daten
import demo_daten as dd
import szenarien

ENV = Path(__file__).resolve().parents[2] / "admin-app-demo" / ".env.local"
MAX_LUFTLINIE_KM = 5.0   # echte Strecke ist nie kürzer als die Luftlinie


def _schluessel() -> str:
    for zeile in ENV.read_text().splitlines():
        if zeile.startswith("VITE_TOMTOM_API_KEY="):
            return zeile.split("=", 1)[1].strip()
    raise SystemExit("VITE_TOMTOM_API_KEY fehlt in " + str(ENV))


def strecken() -> set[tuple[daten.Ort, daten.Ort]]:
    """Alle Radstrecken, die angebote.fuer_tag an den Demo-Tagen prüft."""
    paare = set()

    def ab_ort(s, z):
        if daten.radstation_nah(s) and daten.radstation_nah(z) and daten.luftlinie_km(s, z) <= MAX_LUFTLINIE_KM:
            paare.add((s, z))

    def ab_knoten(kn, z):
        if kn.rad and daten.radstation_nah(z) and daten.luftlinie_km(kn.ort, z) <= MAX_LUFTLINIE_KM:
            paare.add((kn.ort, z))

    echt = angebote.rad_min_ab_ort, angebote.rad_min, angebote.oepnv_min
    angebote.rad_min_ab_ort, angebote.rad_min = ab_ort, ab_knoten
    angebote.oepnv_min = lambda *a: None   # Fahrplan hier nicht nötig
    try:
        dd.flotte_setzen()
        for tag in dd.EREIGNISSE_JE_TAG:
            daten.ereignisse_setzen(dd.EREIGNISSE_JE_TAG[tag])
            gs, _ = dd.gruppen_fuer_tag(tag)
            angebote.fuer_tag(gs, szenarien.erzeuge(gs, 1, seed=1))
    finally:
        angebote.rad_min_ab_ort, angebote.rad_min, angebote.oepnv_min = echt
    return paare


def main():
    key = _schluessel()
    tabelle = json.loads(daten.RADZEITEN.read_text()) if daten.RADZEITEN.exists() else {}
    paare = sorted(strecken(), key=lambda p: (p[0].name, p[1].name))
    neu = [p for p in paare if daten.rad_schluessel(*p) not in tabelle]
    print(f"{len(paare)} Strecken, {len(neu)} neu abzufragen", flush=True)
    for i, (a, b) in enumerate(neu, 1):
        url = (f"https://api.tomtom.com/routing/1/calculateRoute/{a.lat},{a.lng}:{b.lat},{b.lng}/json"
               f"?key={key}&travelMode=bicycle&traffic=false&routeType=fastest")
        try:
            with urllib.request.urlopen(url, timeout=20) as r:
                s = json.load(r)["routes"][0]["summary"]
        except Exception as e:   # einzelne Strecke fehlt: alte Schätzung bleibt
            print(f"  Fehler {a.name} -> {b.name}: {e}", flush=True)
            continue
        tabelle[daten.rad_schluessel(a, b)] = {"min": round(s["travelTimeInSeconds"] / 60, 1),
                                                "km": round(s["lengthInMeters"] / 1000, 2),
                                                "von": a.name, "nach": b.name}
        if i % 25 == 0:
            print(f"  {i}/{len(neu)}", flush=True)
            daten.RADZEITEN.write_text(json.dumps(tabelle, ensure_ascii=False, indent=1))
        time.sleep(0.25)   # TomTom: höchstens 5 Anfragen je Sekunde
    daten.RADZEITEN.write_text(json.dumps(tabelle, ensure_ascii=False, indent=1))
    print("geschrieben", daten.RADZEITEN, len(tabelle), "Strecken")


if __name__ == "__main__":
    main()
