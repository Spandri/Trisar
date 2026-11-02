"""Bisherigen Planer (admin-app-lokal/optimizer, KI-Korridor + CP-SAT) für einen Demo-Tag rechnen.

Aufruf (eigene Umgebung mit ortools und fastapi aus requirements.txt des Planers):
  python3 -m venv .venv && .venv/bin/pip install fastapi==0.115.12 ortools==9.14.6206
  .venv/bin/python rechnen.py anfrage_tag2.json ../ergebnisse/bisheriger-planer-tag2.json
Die Anfrage ist mitgeschnitten aus der Demo-Oberfläche, Einstellungen wie der bisherige
Vergleich (ausgewogen, 8 h, 3 h, 3 h Pause, 20 min Puffer, 80 min, Güte 5 %). Der Planer
selbst bleibt unverändert, nur die Fahrzeiten ab München kommen aus der festen Tabelle.
"""
import json, sys, time
from pathlib import Path
HIER = Path(__file__).resolve().parent
PLANER = HIER.parents[3] / '__TRI-26-001_flottenmanagement_webapp_ss/Programm/admin-app-lokal'
TABELLE = HIER.parents[1] / 'planer-ergebnisse/fahrzeiten_von_muenchen.json'
sys.path.insert(0, str(PLANER))
from optimizer import admin_payload_adapter, api_server
from optimizer.api_server import PlannerRequest, solve
tabelle = json.load(open(TABELLE, encoding='utf-8'))
original = admin_payload_adapter.OpenStreetMapTravelTimeProvider.minutes_from_munich
def aus_tabelle(self, ziel):
    k = str(ziel or '').strip().lower()
    return int(tabelle[k]) if k in tabelle else original(self, ziel)
admin_payload_adapter.OpenStreetMapTravelTimeProvider.minutes_from_munich = aus_tabelle
t0 = time.time()
antwort = solve(PlannerRequest(**json.load(open(sys.argv[1], encoding='utf-8'))))
json.dump(antwort, open(sys.argv[2], 'w', encoding='utf-8'), ensure_ascii=False)
k = antwort.get('kpis') or {}
print(f"fertig {round(time.time()-t0)} s, Dienste {len(antwort.get('suggestions') or [])}, offen {len(antwort.get('unassigned_ride_ids') or [])}, Güte {k.get('optimality_gap')}, Status {k.get('solver_status')}", flush=True)
