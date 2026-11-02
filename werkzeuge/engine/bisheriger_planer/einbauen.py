"""Plan des bisherigen Planers gegen die Engine-Testverläufe prüfen und in die Ergebnisse schreiben.

Aufruf aus werkzeuge/engine: .venv/bin/python bisheriger_planer/einbauen.py 2
Liest ergebnisse/bisheriger-planer-tag<N>.json, prüft wie demo_lauf.py (300 Testverläufe,
Seed 99 + Tag) und setzt "bisheriger_planer" in beiden engine-ergebnisse.json.
"""
import json, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import daten, demo_daten as dd, stoerung, szenarien

tag = int(sys.argv[1])
dd.flotte_setzen()
daten.ereignisse_setzen(dd.EREIGNISSE_JE_TAG[tag])
gs, _ = dd.gruppen_fuer_tag(tag)
test = szenarien.erzeuge(gs, 300, seed=99 + tag)
v = stoerung.fremdplan_testen(gs, stoerung.bisheriger_plan(tag), test, dd.STOERUNG_JE_TAG.get(tag))
print(f"passend {v['passend']}, {v['fahrer']} Dienste, {v['offen']} offen, pünktlich {v.get('puenktlich_abholung', 0):.1%}, "
      f"km {v.get('km')}, Leer-km {v.get('leer_km')}")
for pfad in (Path(__file__).resolve().parents[1] / "ergebnisse" / "engine-ergebnisse.json", dd.DATA / "engine-ergebnisse.json"):
    alles = json.loads(pfad.read_text())
    alles["tage"][str(tag)]["bisheriger_planer"] = v
    pfad.write_text(json.dumps(alles, ensure_ascii=False, indent=1))
    print("geschrieben", pfad)
