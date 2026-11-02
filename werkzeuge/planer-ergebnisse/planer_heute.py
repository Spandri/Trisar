"""Rechnet die Heute-Varianten (planer/heute/anfragen.jsonl) mit dem echten Planer.

Kleine Tage (4-5 Fahrten) — viele Prozesse parallel, je Anfrage Sekundenbruchteile.
Ergebnis: planer/heute/antworten.jsonl (gleiche Reihenfolge, Name + Antwort).
"""
import json
import os
import sys
import time
from concurrent.futures import ProcessPoolExecutor

HIER = os.path.dirname(os.path.abspath(__file__))
PLANER = os.path.normpath(os.path.join(HIER, "..", "..", "..", "admin-app-lokal"))
ARBEIT = os.environ.get("PLANER_ARBEIT") or os.path.join(HIER, "arbeit")


def _vorbereiten():
    sys.path.insert(0, PLANER)
    from optimizer import admin_payload_adapter as apa
    with open(os.path.join(HIER, "fahrzeiten_von_muenchen.json"), encoding="utf-8") as datei:
        tabelle = json.load(datei)
    original = apa.OpenStreetMapTravelTimeProvider.minutes_from_munich

    def aus_tabelle(self, adresse):
        schluessel = str(adresse or "").strip().lower()
        if schluessel in tabelle:
            return int(tabelle[schluessel])
        raise RuntimeError(f"Adresse nicht in Fahrzeittabelle: {adresse}")

    apa.OpenStreetMapTravelTimeProvider.minutes_from_munich = aus_tabelle


def rechne(zeile: str) -> str:
    from optimizer.api_server import PlannerRequest, solve
    eintrag = json.loads(zeile)
    antwort = solve(PlannerRequest(**eintrag["anfrage"]))
    return json.dumps({"name": eintrag["name"], "antwort": antwort})


def main():
    with open(os.path.join(ARBEIT, "heute", "anfragen.jsonl"), encoding="utf-8") as datei:
        zeilen = [z for z in datei if z.strip()]
    start = time.time()
    ziel = os.path.join(ARBEIT, "heute", "antworten.jsonl")
    with ProcessPoolExecutor(max_workers=int(os.environ.get("PARALLEL", "5")), initializer=_vorbereiten) as pool, open(ziel, "w", encoding="utf-8") as aus:
        for i, ergebnis in enumerate(pool.map(rechne, zeilen, chunksize=8), start=1):
            aus.write(ergebnis + "\n")
            if i % 144 == 0:
                print(f"{i}/{len(zeilen)} in {round(time.time() - start)} s", flush=True)
    print(f"fertig: {len(zeilen)} Antworten in {round(time.time() - start)} s")


if __name__ == "__main__":
    main()
