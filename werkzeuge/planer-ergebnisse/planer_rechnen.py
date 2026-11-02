"""Rechnet Planer-Anfragen aus der Warteschlange mit dem echten CP-SAT-Planer.

Liest arbeit/queue/<schluessel>.json, ruft die Solve-Funktion des echten
Planer-Servers (admin-app-lokal/optimizer/api_server.py) direkt auf und legt
die Antwort als arbeit/cache/<schluessel>.json ab. Laeuft dauerhaft und nimmt
neue Anfragen auf, sobald sie erscheinen. Bis zu PARALLEL Anfragen gleichzeitig,
aber nie mehr CP-SAT-Worker als Kerne (KERNE) — der Planer waehlt die Worker-Zahl
nach Fahrtenzahl (>150: 4, >60: 6, sonst 8), Ueberbuchung wuerde die zeitlich
begrenzten Laeufe verschlechtern.
"""
from __future__ import annotations

import json
import os
import sys
import time
import traceback
from concurrent.futures import ProcessPoolExecutor

HIER = os.path.dirname(os.path.abspath(__file__))
# Arbeitsdaten (Warteschlange, Zwischenspeicher, Szenarien) — nicht im Repo.
ARBEIT = os.environ.get("PLANER_ARBEIT") or os.path.join(HIER, "arbeit")
QUEUE = os.path.join(ARBEIT, "queue")
CACHE = os.path.join(ARBEIT, "cache")
LOG = os.path.join(ARBEIT, "rechnen.log")
PLANER = os.path.normpath(os.path.join(HIER, "..", "..", "..", "admin-app-lokal"))
PARALLEL = int(os.environ.get("PARALLEL", "2"))
KERNE = int(os.environ.get("KERNE", str(os.cpu_count() or 8)))

_gewichte: dict = {}


def gewicht(schluessel: str) -> int:
    """CP-SAT-Worker, die der Planer fuer diese Anfrage nutzt (wie api_server.py)."""
    if schluessel not in _gewichte:
        with open(os.path.join(QUEUE, f"{schluessel}.json"), encoding="utf-8") as datei:
            fahrten = len(json.load(datei).get("rides") or [])
        _gewichte[schluessel] = 4 if fahrten > 150 else 6 if fahrten > 60 else 8
    return _gewichte[schluessel]


def log(text: str) -> None:
    zeile = f"{time.strftime('%H:%M:%S')} {text}"
    print(zeile, flush=True)
    with open(LOG, "a", encoding="utf-8") as datei:
        datei.write(zeile + "\n")


def rechne(schluessel: str) -> str:
    sys.path.insert(0, PLANER)
    from optimizer import admin_payload_adapter  # noqa: E402
    from optimizer.api_server import PlannerRequest, solve  # noqa: E402

    # Fahrzeiten ab Muenchen aus der einmal gerechneten Tabelle (gleiche
    # OSRM-Rechnung wie der Planer, mit den festen Koordinaten der Demo) —
    # sonst geht jede Adresse an Nominatim, das unter Last nicht antwortet.
    tabelle_pfad = os.path.join(HIER, "fahrzeiten_von_muenchen.json")
    with open(tabelle_pfad, encoding="utf-8") as datei:
        tabelle = json.load(datei)
    original = admin_payload_adapter.OpenStreetMapTravelTimeProvider.minutes_from_munich

    def aus_tabelle(self, destination_address):
        schluessel = str(destination_address or "").strip().lower()
        if schluessel in tabelle:
            return int(tabelle[schluessel])
        return original(self, destination_address)

    if not getattr(admin_payload_adapter.OpenStreetMapTravelTimeProvider, "_tabelle_aktiv", False):
        admin_payload_adapter.OpenStreetMapTravelTimeProvider.minutes_from_munich = aus_tabelle
        admin_payload_adapter.OpenStreetMapTravelTimeProvider._tabelle_aktiv = True

    pfad = os.path.join(QUEUE, f"{schluessel}.json")
    with open(pfad, encoding="utf-8") as datei:
        anfrage = json.load(datei)
    start = time.time()
    antwort = solve(PlannerRequest(**anfrage))
    dauer = round(time.time() - start)
    ziel = os.path.join(CACHE, f"{schluessel}.json")
    with open(ziel + ".tmp", "w", encoding="utf-8") as datei:
        json.dump(antwort, datei)
    os.replace(ziel + ".tmp", ziel)
    os.remove(pfad)
    kpis = antwort.get("kpis") or {}
    return (
        f"fertig {schluessel[:10]} Tag {anfrage.get('serviceDate')} {anfrage.get('settings', {}).get('mode')} "
        f"Fahrten {len(anfrage.get('rides') or [])}: {dauer} s, Vorschlaege {len(antwort.get('suggestions') or [])}, "
        f"offen {len(antwort.get('unassigned_ride_ids') or [])}, Guete {kpis.get('optimality_gap')}, Status {kpis.get('solver_status')}"
    )


def main() -> None:
    os.makedirs(QUEUE, exist_ok=True)
    os.makedirs(CACHE, exist_ok=True)
    laufend: dict = {}
    log(f"Rechner bereit, parallel {PARALLEL}, Kerne {KERNE}")
    with ProcessPoolExecutor(max_workers=PARALLEL) as pool:
        while True:
            for schluessel, zukunft in list(laufend.items()):
                if zukunft.done():
                    del laufend[schluessel]
                    try:
                        log(zukunft.result())
                    except Exception:  # noqa: BLE001
                        log(f"FEHLER {schluessel[:10]}: {traceback.format_exc(limit=3)}")
            wartend = sorted(
                (n[:-5] for n in os.listdir(QUEUE) if n.endswith(".json")),
                key=lambda s: os.path.getmtime(os.path.join(QUEUE, f"{s}.json")),
            )
            for schluessel in wartend:
                if len(laufend) >= PARALLEL:
                    break
                if schluessel in laufend or os.path.exists(os.path.join(CACHE, f"{schluessel}.json")):
                    continue
                belegt = sum(gewicht(s) for s in laufend)
                # Passt die Anfrage nicht mehr ins Kernbudget, eine spaetere
                # (kleinere) vorziehen; allein darf jede Anfrage laufen.
                if laufend and belegt + gewicht(schluessel) > KERNE:
                    continue
                log(f"starte {schluessel[:10]} ({gewicht(schluessel)} Worker, belegt {belegt + gewicht(schluessel)}/{KERNE})")
                laufend[schluessel] = pool.submit(rechne, schluessel)
            time.sleep(2)


if __name__ == "__main__":
    main()
