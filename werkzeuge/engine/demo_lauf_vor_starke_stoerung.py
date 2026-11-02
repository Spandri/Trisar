"""Rechnet die Demo-Tage mit der TRISAR-Engine vor und schreibt die Ergebnisse für den KI-Planer.

Je Tag und Option: Fahrzeugketten (= Dienste), Fahrer, Fahrzeug, Ladestopps, Sammelfahrten,
Reserve je Abholung. Zwei Optionen wie im Antrag (1.2, Simulation 18.10.2026):
  standard = CO2 und Kosten gemeinsam, Verspätung als Abwägung über die Szenarien,
             Nachsteuern am Einsatztag (wie Variante S der Antrags-Simulation)
  sicher   = jeder Anschluss muss in 499 von 500 Verläufen halten (harte Regel),
             dafür mehr Fahrzeuge
Aufruf: .venv/bin/python demo_lauf.py [zeitlimit_s] [tage, z. B. 0,1,2]
"""
from __future__ import annotations

import json
import statistics
import sys
import time
from collections import defaultdict
from pathlib import Path

import angebote
import daten
import demo_daten as dd
import modell
import stoerung
import szenarien
import touren
from daten import BETRIEBSSITZ, fahrzeit_min, strassen_km

AUS = Path(__file__).parent / "ergebnisse"
OPTIONEN = {
    "standard": {"titel": "Standard", "co2_ct_kg": 300, "reserve_min": 0, "quantil": 0.998, "hart": False, "standard": True},
    "sicher": {"titel": "Sicher", "co2_ct_kg": 300, "reserve_min": 0, "quantil": 0.998, "hart": True},
}
CO2_VERBRENNER_KG_KM = 0.215   # Vergleichsbasis für "CO2 gespart" (Limousine Benzin)


def ketten(erg) -> list[list[tuple]]:
    """Fahrzeugketten als Liste von (tour_id, leer_km_davor)."""
    weiter = {b.von: b for b in erg["boegen"] if b.von is not None}
    out = []
    for b in erg["boegen"]:
        if b.von is None:
            kette, tid, km = [], b.nach, b.km
            while tid is not None:
                kette.append((tid, km))
                nb = weiter[tid]
                tid, km = nb.nach, nb.km
            out.append((kette, weiter[kette[-1][0]].km))
    return out


def vorlauf(t, gd) -> int:
    return daten.VORLAUF_PREMIUM_MIN if any(gd[g].premium for g in t.gruppen) else daten.VORLAUF_STANDARD_MIN


def abholung_testen(gs, k, chains, szen) -> dict:
    """Ist der Fahrer in jedem Testverlauf rechtzeitig am Abholort? Verspätungen pflanzen sich fort."""
    tour = {t.id: t for t in k.touren}
    spaet, n, max_spaet = 0, 0, 0.0
    for s in szen:
        z = szenarien.tourzeiten(gs, k, s)
        for kette, _ in chains:
            frei, vor = None, None
            for tid, _ in kette:
                t = tour[tid]
                bereit = z[tid][0]
                if frei is not None:
                    an = frei + fahrzeit_min(vor.ende, t.start, uhrzeit=vor.ende_zeit) * s.f(vor.ende, t.start)
                    zu_spaet = max(0.0, an - bereit)
                else:
                    zu_spaet = 0.0
                n += 1
                if zu_spaet > 0.5:
                    spaet += 1
                    max_spaet = max(max_spaet, zu_spaet)
                start = bereit + zu_spaet
                frei = start + (t.ende_zeit - t.start_zeit) * s.f(t.start, t.ende)
                vor = t
    return {"abholungen": n, "puenktlich_anteil": round(1 - spaet / n, 4) if n else 1.0,
            "max_verspaetung_min": round(max_spaet, 1)}


def rechne_option(tag, gs, k, typ, viele, test, opt, zeitlimit, start=None):
    daten.CO2_PREIS_CT_KG = opt["co2_ct_kg"]
    ok, reserve = szenarien.bogen_pruefer_quantil(gs, k, viele, opt["quantil"], opt["reserve_min"])
    modell.BOGEN_OK = ok if opt.get("hart") else None   # standard: Verspätung nur als erwartete Kosten
    t0 = time.time()
    erg = modell.loese(gs, k, zeitlimit_s=zeitlimit, szen=typ, threads=8,
                       start=(k, start) if start is not None else None)
    if not erg or "kennzahlen" not in erg:
        return None
    erg["sekunden"] = round(time.time() - t0)
    erg["ketten"] = ketten(erg)
    erg["test"] = abholung_testen(gs, k, erg["ketten"], test)
    erg["nachgesteuert"] = szenarien.bewerte_rollierend(gs, k, erg, test)   # wie Antrags-Simulation
    erg["reserve_fn"] = reserve
    return erg


def antwort_bauen(tag, gs, jobs, k, erg, opt_key, fahrer_pool, fahrzeuge_je, ruhe):
    """Ergebnis im Format des Demo-Planers (planerErgebnisse.js / mapPlannerSuggestions)."""
    gd = {g.id: g for g in gs}
    tour = {t.id: t for t in k.touren}
    datum = dd.TAGE[tag]
    reserve = erg["reserve_fn"]
    ketten_info = []
    for idx, (kette, km_zurueck) in enumerate(erg["ketten"]):
        ts = [tour[tid] for tid, _ in kette]
        erste, letzte = ts[0], ts[-1]
        anfahrt = fahrzeit_min(BETRIEBSSITZ, erste.start, uhrzeit=erste.start_zeit - 40)
        beginn = erste.start_zeit - vorlauf(erste, gd) - anfahrt
        ende = letzte.ende_zeit + fahrzeit_min(letzte.ende, BETRIEBSSITZ, uhrzeit=letzte.ende_zeit)
        km = sum(t.km for t in ts) + sum(km for _, km in kette) + km_zurueck
        ketten_info.append({"idx": idx, "touren": ts, "leer": [km for _, km in kette], "zurueck": km_zurueck,
                            "beginn": beginn, "ende": ende, "km": km, "klasse": erste.klasse})
    # Fahrzeuge: je Klasse, längste Kette bekommt das Fahrzeug mit der größten Reichweite
    frei = {kl: sorted(v, key=lambda f: -(f.get("range_km") or 0)) for kl, v in fahrzeuge_je.items()}
    for ki in sorted(ketten_info, key=lambda c: -c["km"]):
        ki["fahrzeug"] = frei[ki["klasse"].name].pop(0)
    # Fahrer: frühester Dienst zuerst, 11 h Ruhezeit nach dem Dienst des Vortags
    belegt = set()
    for ki in sorted(ketten_info, key=lambda c: c["beginn"]):
        for f in fahrer_pool:
            if f["id"] in belegt:
                continue
            if ruhe.get(f["id"], -10**6) + 11 * 60 > tag * 1440 + ki["beginn"]:
                continue
            ki["fahrer"] = f
            belegt.add(f["id"])
            break
    erg["zuordnung"] = {ki["idx"]: (ki.get("fahrer"), ki["fahrzeug"], ki["beginn"]) for ki in ketten_info}
    suggestions, plans, sammel, fahrten = [], [], [], {}
    co2 = ev_km = total_km = leer_min = 0.0
    for ki in sorted(ketten_info, key=lambda c: c["beginn"]):
        f, fz, kl = ki.get("fahrer"), ki["fahrzeug"], ki["klasse"]
        if f is None:
            continue
        ride_ids = [gd[g].job_id for t in ki["touren"] for g in t.gruppen]
        name = f"{f.get('first_name', '')} {f.get('last_name', '')}".strip()
        suggestions.append({
            "driver_id": f["id"], "driver_name": name,
            "service_start": dd.hhmm(ki["beginn"]), "service_end": dd.hhmm(ki["ende"]),
            "assigned_ride_ids": ride_ids, "assigned_rides_count": len(ride_ids),
            "note": f"TRISAR-Engine · {kl.name}", "split_block": None})
        lade_stopps, soc_min = [], None
        for i, t in enumerate(ki["touren"]):
            if i + 1 < len(ki["touren"]):
                u = ki["touren"][i + 1]
                km_lade = erg["lade"].get((t.id, u.id), 0)
                if km_lade:
                    leer = fahrzeit_min(t.ende, u.start, uhrzeit=t.ende_zeit)
                    a = t.ende_zeit + leer
                    e = a + km_lade / daten.LADE_KM_JE_MIN
                    lade_stopps.append({"start": f"{datum}T{dd.hhmm(a)}:00", "end": f"{datum}T{dd.hhmm(e)}:00",
                                        "km_gained": int(km_lade), "station_id": None,
                                        "station_name": "Schnelllader nahe " + u.start.name.split(",")[0]})
            if t.id in erg["soc"]:
                soc_min = erg["soc"][t.id] if soc_min is None else min(soc_min, erg["soc"][t.id])
        plans.append({"driver_id": f["id"], "vehicle_id": fz["id"],
                      "vehicle_label": f"{fz.get('brand_model', '')} {fz.get('trim') or ''} ({fz.get('license_plate', '')})".replace("  ", " "),
                      "is_ev": kl.elektrisch, "shift_km": round(ki["km"], 1), "charge_stops": lade_stopps,
                      "min_range_reserve_km": round(soc_min - ki["zurueck"], 1) if soc_min is not None else None,
                      "note": "Ladeplan der Engine" if lade_stopps else ""})
        total_km += ki["km"]
        co2 += ki["km"] * kl.co2_g_km / 1000
        if kl.elektrisch:
            ev_km += ki["km"]
        for i, t in enumerate(ki["touren"]):
            ids = [gd[g].job_id for g in t.gruppen]
            if len(ids) > 1:
                sammel.append({"ride_ids": ids, "driver_id": f["id"], "start": dd.hhmm(t.start_zeit)})
            luft = None
            if i > 0:
                vor = ki["touren"][i - 1]
                luft = round(reserve(vor.id, t.id, fahrzeit_min(vor.ende, t.start, uhrzeit=vor.ende_zeit)))
                leer_min += fahrzeit_min(vor.ende, t.start, uhrzeit=vor.ende_zeit)
            r = daten.route(t.start, t.ende, t.start_zeit)
            for rid in ids:
                fahrten[rid] = {"reserve_min": luft, "route": r, "sammel": len(ids) > 1,
                                "abfahrt": dd.hhmm(t.start_zeit), "ankunft": dd.hhmm(t.ende_zeit)}
    kz = erg["kennzahlen"]
    ziel, schranke = erg["zielwert_ct"], erg["schranke_ct"]
    gap = (ziel - schranke) / ziel if ziel else 0.0
    stunden = sum((ki["ende"] - ki["beginn"]) / 60 for ki in ketten_info if ki.get("fahrer"))
    reserven = [v["reserve_min"] for v in fahrten.values() if v["reserve_min"] is not None]
    return {
        "source": "cp_sat", "mode": opt_key,
        "suggestions": suggestions,
        "unassigned_ride_ids": [g.job_id for g in gs if g.job_id not in fahrten],
        "warnings": [],
        "kpis": {"total_planned_hours": round(stunden, 1), "active_driver_count": len(suggestions),
                 "unassigned_ride_count": sum(1 for g in gs if g.job_id not in fahrten),
                 "objective_value": round(ziel), "best_objective_bound": round(schranke),
                 "optimality_gap": round(gap, 4), "solver_status": erg["status"],
                 "solver_wall_time_seconds": erg["sekunden"], "total_deadhead_minutes": round(leer_min)},
        "vehicle_plans": plans,
        "fleet_kpis": {"ev_shift_count": sum(1 for p in plans if p["is_ev"]),
                       "combustion_shift_count": sum(1 for p in plans if not p["is_ev"]),
                       "unassigned_shift_count": 0, "total_km": round(total_km), "ev_km": round(ev_km),
                       "co2_kg": round(co2), "co2_saved_kg": round(ev_km * CO2_VERBRENNER_KG_KM - ev_km * 0.088)},
        "engine": {
            "option": opt_key, "titel": OPTIONEN[opt_key]["titel"], "standard": bool(OPTIONEN[opt_key].get("standard")),
            "kennzahlen": {"fahrzeuge": len(suggestions), "fahrer": len(suggestions), "km": round(total_km),
                           "leer_km": round(kz["km_leer"]), "co2_kg": round(co2), "kosten_eur": kz["kosten_eur"],
                           "e_anteil_km": round(ev_km / total_km, 2) if total_km else 0,
                           "sammelfahrten": len(sammel),
                           "puenktlich_abholung": erg["test"]["puenktlich_anteil"],
                           "puenktlich_gaeste": erg["nachgesteuert"]["anteil_gruppen_puenktlich"],
                           "puenktlich_abholung_nachgesteuert": erg["nachgesteuert"]["anteil_abholung_puenktlich"],
                           "verspaetung_min_tag": erg["nachgesteuert"]["verspaetungsminuten_mittel"],
                           "max_verspaetung_min": erg["test"]["max_verspaetung_min"],
                           "min_reserve_min": min(reserven) if reserven else None,
                           "mittlere_reserve_min": round(statistics.median(reserven)) if reserven else None,
                           "szenarien_planung": 20, "szenarien_test": 300},
            "sammel": sammel, "fahrten": fahrten,
            "ereignisse": [{"name": e.name, "art": e.art, "bekannt": e.bekannt,
                            "profil": [[a, b, x, y] for a, b, x, y in e.profil]} for e in daten.EREIGNISSE],
        },
    }, {ki["fahrer"]["id"]: tag * 1440 + ki["ende"] for ki in ketten_info if ki.get("fahrer")}


def vor_nachteile(antworten: dict) -> None:
    """Vorteile und Nachteile je Option im Vergleich zu den anderen Optionen des Tages."""
    kz = {k: a["engine"]["kennzahlen"] for k, a in antworten.items()}
    def best(feld, klein=True):
        werte = [v[feld] for v in kz.values() if v[feld] is not None]
        return min(werte) if klein else max(werte)
    for key, a in antworten.items():
        v, pro, contra = kz[key], [], []
        if v["co2_kg"] == best("co2_kg"):
            pro.append(f"wenigste Emissionen ({v['co2_kg']} kg CO₂)")
        else:
            contra.append(f"{v['co2_kg'] - best('co2_kg')} kg mehr CO₂")
        if v["kosten_eur"] == best("kosten_eur"):
            pro.append(f"niedrigste Betriebskosten ({v['kosten_eur']:,} €)".replace(",", "."))
        else:
            contra.append(f"{v['kosten_eur'] - best('kosten_eur'):,} € höhere Kosten".replace(",", "."))
        if v["fahrzeuge"] == best("fahrzeuge"):
            pro.append(f"wenigste Fahrzeuge und Fahrer ({v['fahrzeuge']})")
        else:
            contra.append(f"{v['fahrzeuge'] - best('fahrzeuge')} Fahrzeuge mehr")
        if v["min_reserve_min"] is not None and v["min_reserve_min"] == best("min_reserve_min", klein=False):
            pro.append(f"größte Reserve: mindestens {v['min_reserve_min']} min Luft vor jeder Folgeabholung im ungünstigen Szenario")
        if v["e_anteil_km"] == best("e_anteil_km", klein=False):
            pro.append(f"{round(v['e_anteil_km'] * 100)} % der km elektrisch")
        a["engine"]["vorteile"], a["engine"]["nachteile"] = pro, contra


def main():
    zeitlimit = float(sys.argv[1]) if len(sys.argv) > 1 else 120
    tage = [int(x) for x in sys.argv[2].split(",")] if len(sys.argv) > 2 else [0, 1, 2]
    nur = sys.argv[3].split(",") if len(sys.argv) > 3 else list(OPTIONEN)
    AUS.mkdir(exist_ok=True)
    fahrzeuge_je = dd.flotte_setzen()
    pool = dd.fahrer()
    ruhe: dict[str, int] = {}
    alles = {"planer": "trisar_engine", "erstellt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
             "hinweis": "Demo-Daten erfunden. Verkehrsereignisse sind Planungsannahmen.", "tage": {}}
    ziel = AUS / ("engine-ergebnisse.json" if len(sys.argv) <= 3 else "engine-ergebnisse-test.json")
    if ziel.exists() and len(sys.argv) <= 3:
        alles["tage"] = json.loads(ziel.read_text()).get("tage", {})   # nicht gerechnete Tage bleiben
    for tag in tage:
        daten.ereignisse_setzen(dd.EREIGNISSE_JE_TAG[tag])
        gs, jobs = dd.gruppen_fuer_tag(tag)
        k = touren.erzeuge(gs, mit_sammeln=True, mit_knoten=False)
        viele = szenarien.erzeuge(gs, 500, seed=11 + tag)
        typ = szenarien.verdichte(viele, 20)
        test = szenarien.erzeuge(gs, 300, seed=99 + tag)
        print(f"Tag {tag} ({dd.TAG_NAME[tag]}): {len(gs)} Fahrten, {len(k.touren)} Fahrtvarianten", flush=True)
        antworten, ruhe_neu, ergs = {}, {}, {}
        # Reihenfolge: Sicher zuerst (strengste Regel). Sein Plan ist für Standard zulässig
        # und dient als Startlösung, so ist Standard nie teurer als Sicher.
        for key in ("sicher", "standard"):
            opt = OPTIONEN[key]
            if key not in nur:
                continue
            start = ergs.get("sicher") if key != "sicher" else None
            erg = rechne_option(tag, gs, k, typ, viele, test, opt, zeitlimit, start)
            if erg is None:
                print(f"  {key}: unzulässig", flush=True)
                continue
            a, r = antwort_bauen(tag, gs, jobs, k, erg, key, pool, fahrzeuge_je, ruhe)
            antworten[key] = a
            ergs[key] = erg
            if opt.get("standard"):
                ruhe_neu = r
            e = a["engine"]["kennzahlen"]
            print(f"  {key}: {e['fahrzeuge']} Fz, {e['km']} km, {e['co2_kg']} kg CO2, {e['kosten_eur']} €, "
                  f"{e['sammelfahrten']} Sammelf., pünktlich {e['puenktlich_abholung']:.1%}, "
                  f"Abholung nachgesteuert {e['puenktlich_abholung_nachgesteuert']:.2%}, Gäste nachgesteuert {e['puenktlich_gaeste']:.1%} ({e['verspaetung_min_tag']} min), "
                  f"min Reserve {e['min_reserve_min']}, {erg['status']} {erg['sekunden']} s", flush=True)
        antworten = {key: antworten[key] for key in OPTIONEN if key in antworten}
        vor_nachteile(antworten)
        ruhe.update(ruhe_neu)
        eintrag = {"datum": dd.TAGE[tag], "name": dd.TAG_NAME[tag], "fahrten": len(gs),
                   "optionen": antworten, "angebote": angebote.fuer_tag(gs, viele)}
        alt = stoerung.bisheriger_plan(tag)
        if alt:
            v = stoerung.fremdplan_testen(gs, alt, test, dd.STOERUNG_JE_TAG.get(tag))
            if not v["passend"]:
                print("  bisheriger Planer: gespeicherter Plan passt nicht zu den Fahrten des Tages, kein Vergleich", flush=True)
            eintrag["bisheriger_planer"] = v
            print(f"  bisheriger Planer: {v['fahrer']} Dienste, {v['offen']} offen, pünktlich "
                  f"{v.get('puenktlich_abholung', 0):.1%}, Störung zu spät: {len(v.get('stoerung_spaet', {}))}", flush=True)
        if tag in dd.STOERUNG_JE_TAG and "standard" in ergs:
            st = stoerung.rechne(gs, k, ergs["standard"], antworten["standard"], dd.STOERUNG_JE_TAG[tag],
                                 dd.STOERUNG_JE_TAG[tag].profil[0][0] + 2, fahrzeuge_je, pool)
            eintrag["stoerung"] = st
            print(f"  Störung: ohne Neuplanung {st['ohne_neuplanung']['anzahl']} späte Abholungen "
                  f"({st['ohne_neuplanung']['minuten']} min), mit {st['mit_neuplanung']['anzahl']} "
                  f"({st['mit_neuplanung']['minuten']} min), {len(st['aenderungen'])} Änderungen, "
                  f"{len(st['umfahrung_fto'])} über FTO", flush=True)
        alles["tage"][str(tag)] = eintrag
        ziel.write_text(json.dumps(alles, ensure_ascii=False, indent=1))
    print("geschrieben", ziel)


if __name__ == "__main__":
    main()
