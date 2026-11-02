"""Störung eines Tages neu rechnen, ohne den Tag neu zu planen.

Nimmt den von demo_lauf.py gesicherten Plan (ergebnisse/plan-tag<N>.pkl) und das Ereignis aus
demo_daten.STOERUNG_JE_TAG, rechnet Störung und Vergleich mit dem bisherigen Planer neu und schreibt
beides in die Engine-Ergebnisse (Werkzeug und Demo-App).

Aufruf: .venv/bin/python stoerung_neu.py 1 [--nur-zeigen]
"""
from __future__ import annotations

import json
import pickle
import shutil
import sys
from pathlib import Path

import daten
import demo_daten as dd
import stoerung

HIER = Path(__file__).resolve().parent
ZIEL = HIER / "ergebnisse" / "engine-ergebnisse.json"
APP = HIER.parents[1] / "admin-app-demo" / "src" / "demo" / "data" / "engine-ergebnisse.json"


def main():
    tag = int(sys.argv[1]) if len(sys.argv) > 1 else 1
    nur_zeigen = "--nur-zeigen" in sys.argv
    plan = pickle.loads((HIER / "ergebnisse" / f"plan-tag{tag}.pkl").read_bytes())
    daten.ereignisse_setzen(dd.EREIGNISSE_JE_TAG[tag])
    gs, _ = dd.gruppen_fuer_tag(tag)
    fahrzeuge_je = dd.flotte_setzen()
    pool = dd.fahrer()
    ereignis = dd.STOERUNG_JE_TAG[tag]
    st = stoerung.rechne(gs, plan["k"], plan["erg"], plan["antwort"], ereignis,
                         ereignis.profil[0][0] + 2, fahrzeuge_je, pool)
    print(f"Störung {st['meldung']}: ohne Neuplanung {st['ohne_neuplanung']['anzahl']} spät "
          f"({st['ohne_neuplanung']['minuten']} min), mit {st['mit_neuplanung']['anzahl']} "
          f"({st['mit_neuplanung']['minuten']} min), {st['mit_neuplanung']['fahrertausch']} Tausch, "
          f"{st['mit_neuplanung']['reservefahrzeuge']} Bereitschaft, {len(st['umfahrung_fto'])} über FTO")
    print("  ohne:", st["ohne_neuplanung"]["spaete_abholungen"])
    print("  mit: ", st["mit_neuplanung"]["spaete_abholungen"])
    for a in st["aenderungen"]:
        print("  ", a["abfahrt"], a["von"], a["alter_fahrer"], "->", a["neuer_fahrer"], "Bereitschaft" if a["reservefahrzeug"] else "")

    d = json.loads(ZIEL.read_text())
    eintrag = d["tage"][str(tag)]
    alt = stoerung.bisheriger_plan(tag)
    if alt:
        v = stoerung.fremdplan_testen(gs, alt, None, ereignis)
        print(f"bisheriger Planer: normal {len(v['normal_spaet'])} spät, mit Störung {len(v['stoerung_spaet'])} spät")
        if eintrag.get("bisheriger_planer"):
            eintrag["bisheriger_planer"]["stoerung_spaet"] = v["stoerung_spaet"]
            eintrag["bisheriger_planer"]["normal_spaet"] = v["normal_spaet"]
    if nur_zeigen:
        return
    eintrag["stoerung"] = st
    ZIEL.write_text(json.dumps(d, ensure_ascii=False, indent=1))
    shutil.copyfile(ZIEL, APP)
    print("geschrieben", ZIEL, "und", APP)


if __name__ == "__main__":
    main()
