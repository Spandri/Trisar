"""Autozeiten ohne Verkehr über TomTom für die Strecken Start -> Umsteigepunkt der Angebote.

Für Ortspaare mit Umsteigepunkten gibt es keine OSRM-Werte in der Demo-Tabelle, dort stand
bisher eine grobe Schätzung (bis 10 min daneben). Ergebnis: daten_extern/autozeiten_tomtom.json,
Schlüssel wie bei den Radzeiten, Wert {"min": Fahrzeit ohne Verkehr, "km": Strecke}. Den Verkehr
je Stunde rechnet daten.fahrzeit_min wie überall mit den TomTom-Faktoren dazu.

Aufruf: .venv/bin/python autozeiten_tomtom.py
"""
from __future__ import annotations

import json
import time
import urllib.request

import daten
import demo_daten as dd
from daten import strassen_km
from radzeiten_tomtom import _schluessel


def strecken() -> set[tuple[daten.Ort, daten.Ort]]:
    """Start -> Umsteigepunkt für alle Fahrten, die angebote.fuer_tag prüft (grobe Vorauswahl)."""
    paare = set()
    dd.flotte_setzen()
    for tag in dd.EREIGNISSE_JE_TAG:
        gs, _ = dd.gruppen_fuer_tag(tag)
        for g in gs:
            if g.premium or g.personen > 2:
                continue
            km = strassen_km(g.start, g.ziel)
            for kn in daten.KNOTEN:
                if daten.luftlinie_km(g.start, kn.ort) < 2 or daten.luftlinie_km(kn.ort, g.ziel) < 0.8:
                    continue
                kb = strassen_km(g.start, kn.ort)
                if kb + strassen_km(kn.ort, g.ziel) > 1.2 * km or km - kb < 3:
                    continue
                paare.add((g.start, kn.ort))
    return paare


def main():
    key = _schluessel()
    tabelle = json.loads(daten.AUTOZEITEN.read_text()) if daten.AUTOZEITEN.exists() else {}
    paare = sorted(strecken(), key=lambda p: (p[0].name, p[1].name))
    neu = [p for p in paare if daten.rad_schluessel(*p) not in tabelle]
    print(f"{len(paare)} Strecken, {len(neu)} neu abzufragen", flush=True)
    for i, (a, b) in enumerate(neu, 1):
        url = (f"https://api.tomtom.com/routing/1/calculateRoute/{a.lat},{a.lng}:{b.lat},{b.lng}/json"
               f"?key={key}&travelMode=car&traffic=false&routeType=fastest")
        try:
            with urllib.request.urlopen(url, timeout=20) as r:
                s = json.load(r)["routes"][0]["summary"]
        except Exception as e:   # einzelne Strecke fehlt: Schätzung bleibt
            print(f"  Fehler {a.name} -> {b.name}: {e}", flush=True)
            continue
        tabelle[daten.rad_schluessel(a, b)] = {"min": round(s["travelTimeInSeconds"] / 60, 1),
                                                "km": round(s["lengthInMeters"] / 1000, 2),
                                                "von": a.name, "nach": b.name}
        if i % 100 == 0:
            print(f"  {i}/{len(neu)}", flush=True)
            daten.AUTOZEITEN.write_text(json.dumps(tabelle, ensure_ascii=False, indent=1))
        time.sleep(0.22)   # TomTom: höchstens 5 Anfragen je Sekunde
    daten.AUTOZEITEN.write_text(json.dumps(tabelle, ensure_ascii=False, indent=1))
    print("geschrieben", daten.AUTOZEITEN, len(tabelle), "Strecken")


if __name__ == "__main__":
    main()
