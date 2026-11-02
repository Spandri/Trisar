"""Störung am Einsatztag: Der Plan läuft, dann kommt eine Verkehrsmeldung (z. B. Unfall A9).

Verglichen werden zwei Verläufe mit denselben tatsächlichen Fahrzeiten:
- ohne Neuplanung: jede Fahrt bleibt bei ihrem Fahrer, das Navi umfährt den Unfall, wo es lohnt
- mit Neuplanung: ab der Meldung verteilt die Engine alle noch nicht begonnenen Fahrten neu
  (Fahrer tauschen, freie Fahrzeuge vom Betriebssitz), Reisewege bleiben wie vereinbart.
Die Störung war vorab nicht bekannt (Ereignis.bekannt = False), der Plan wurde ohne sie gerechnet.
"""
from __future__ import annotations

import daten
import demo_daten as dd
from daten import BETRIEBSSITZ, fahrzeit_min, strassen_km


def _dauer(t, beginn: float) -> float:
    """Tatsächliche Dauer: geplante Dauer plus Änderung der Fahrzeit auf der Strecke."""
    plan = fahrzeit_min(t.start, t.ende, uhrzeit=t.start_zeit)
    ist = fahrzeit_min(t.start, t.ende, uhrzeit=int(beginn))
    return (t.ende_zeit - t.start_zeit) + (ist - plan)


def _fahre(t, fz_frei: float, fz_ort, erster: bool):
    """Start und Ende einer Fahrt mit tatsächlichen Fahrzeiten."""
    if erster:
        an = t.start_zeit   # Anfahrt vom Betriebssitz vor der Meldung, pünktlich
    else:
        an = fz_frei + fahrzeit_min(fz_ort, t.start, uhrzeit=int(fz_frei))
    start = max(t.start_zeit, an)
    return start, start + _dauer(t, start), an


def rechne(gs, k, erg, antwort, ereignis, meldung_min: int, fahrzeuge_je, pool) -> dict:
    gd = {g.id: g for g in gs}
    tour = {t.id: t for t in k.touren}
    ketten = [[tour[tid] for tid, _ in kette] for kette, _ in erg["ketten"]]
    zuordnung = erg["zuordnung"]
    _plan_dauer = {t.id: fahrzeit_min(t.start, t.ende, uhrzeit=t.start_zeit) for kette in ketten for t in kette}
    daten.ereignisse_setzen([*daten.EREIGNISSE, ereignis])

    def ids(t):
        return [gd[g].job_id for g in t.gruppen]

    # 1) ohne Neuplanung
    spaet_ohne = {}
    for kette in ketten:
        frei, ort = None, None
        for i, t in enumerate(kette):
            start, ende, _ = _fahre(t, frei, ort, i == 0)
            if start - t.start_zeit > 0.5:
                for rid in ids(t):
                    spaet_ohne[rid] = round(start - t.start_zeit)
            frei, ort = ende, t.ende

    # 2) mit Neuplanung ab der Meldung
    fahrzeuge = []   # Zustand je Fahrzeug: frei ab, Ort, Fahrer, Kapazität, Dienstbeginn
    fest, offen = [], []
    for idx, kette in enumerate(ketten):
        fahrer, fz, beginn = zuordnung[idx]
        f = {"fahrer": fahrer, "fahrzeug": fz, "klasse": kette[0].klasse, "frei": None, "ort": BETRIEBSSITZ,
             "beginn": beginn, "reserve": False, "fahrten": []}
        for i, t in enumerate(kette):
            if t.start_zeit - daten.VORLAUF_STANDARD_MIN < meldung_min:
                start, ende, _ = _fahre(t, f["frei"], f["ort"], i == 0)
                f["frei"], f["ort"] = ende, t.ende
                f["fahrten"].append((t, start, ende, False))
            else:
                offen.append((t, idx))
        fahrzeuge.append(f)
    plan_fz = {t.id: idx for t, idx in offen}
    belegt_fz = {f["fahrzeug"]["id"] for f in fahrzeuge}
    belegt_fahrer = {f["fahrer"]["id"] for f in fahrzeuge if f["fahrer"]}
    reserve_fz = [(kl, fz) for kl, liste in fahrzeuge_je.items() for fz in liste if fz["id"] not in belegt_fz]
    reserve_fahrer = [p for p in pool if p["id"] not in belegt_fahrer]
    klassen = {kl.name: kl for kl in daten.KLASSEN}
    spaet_mit, aenderungen = {}, []
    for t, idx in sorted(offen, key=lambda x: x[0].start_zeit):
        bedarf_p = sum(gd[g].personen for g in t.gruppen)
        bedarf_g = sum(gd[g].gepaeck for g in t.gruppen)
        bester = None
        for j, f in enumerate(fahrzeuge):
            kl = f["klasse"]
            if kl.plaetze < bedarf_p or kl.gepaeck < bedarf_g:
                continue
            erster = f["frei"] is None
            an = (t.start_zeit if erster else f["frei"] + fahrzeit_min(f["ort"], t.start, uhrzeit=int(f["frei"])))
            ende_dienst = an + (t.ende_zeit - t.start_zeit) + fahrzeit_min(t.ende, BETRIEBSSITZ)
            if not erster and ende_dienst - f["beginn"] > daten.MAX_DIENST_MIN + 30:
                continue
            spaet = max(0.0, an - t.start_zeit)
            leer = 0 if erster else strassen_km(f["ort"], t.start)
            wert = (spaet > 0.5, spaet, j != plan_fz[t.id], leer)
            if bester is None or wert < bester[0]:
                bester = (wert, j)
        if bester is None or bester[0][0]:
            # niemand pünktlich: freies Fahrzeug mit Bereitschaftsfahrer vom Betriebssitz
            for n, (kl_name, fz) in enumerate(reserve_fz):
                kl = klassen[kl_name]
                anfahrt = fahrzeit_min(BETRIEBSSITZ, t.start, uhrzeit=meldung_min)
                if kl.plaetze >= bedarf_p and kl.gepaeck >= bedarf_g and reserve_fahrer \
                        and meldung_min + 10 + anfahrt <= t.start_zeit:
                    reserve_fz.pop(n)
                    fahrzeuge.append({"fahrer": reserve_fahrer.pop(0), "fahrzeug": fz, "klasse": kl, "frei": None,
                                      "ort": BETRIEBSSITZ, "beginn": t.start_zeit - anfahrt - 10, "reserve": True,
                                      "fahrten": []})
                    bester = ((False, 0, True, 0), len(fahrzeuge) - 1)
                    break
        if bester is None:
            bester = ((True, 0, False, 0), plan_fz[t.id])
        j = bester[1]
        f = fahrzeuge[j]
        start, ende, an = _fahre(t, f["frei"], f["ort"], f["frei"] is None)
        f["frei"], f["ort"] = ende, t.ende
        neu = j != plan_fz[t.id]
        f["fahrten"].append((t, start, ende, neu))
        if start - t.start_zeit > 0.5:
            for rid in ids(t):
                spaet_mit[rid] = round(start - t.start_zeit)
        if neu:
            alt = fahrzeuge[plan_fz[t.id]]["fahrer"]
            aenderungen.append({"ride_ids": ids(t), "abfahrt": dd.hhmm(t.start_zeit),
                                "von": f"{t.start.name.split(',')[0]} → {t.ende.name.split(',')[0]}",
                                "alter_fahrer": f"{alt['first_name']} {alt['last_name']}" if alt else None,
                                "neuer_fahrer": f"{f['fahrer']['first_name']} {f['fahrer']['last_name']}",
                                "reservefahrzeug": f["reserve"]})
    # Ankünfte, die sich durch den Stau verschieben (Gast und Ziel werden informiert)
    spaetere_ankunft = {}
    for kette in ketten:
        for t in kette:
            if t.start_zeit + 120 < meldung_min - 60:
                continue
            plus = fahrzeit_min(t.start, t.ende, uhrzeit=t.start_zeit) - _plan_dauer.get(t.id, fahrzeit_min(t.start, t.ende, uhrzeit=t.start_zeit))
            if plus >= 5:
                for rid in ids(t):
                    spaetere_ankunft[rid] = round(plus)
    umfahrung = sorted({rid for kette in ketten for t in kette
                        if t.start_zeit >= meldung_min and daten.route(t.start, t.ende, t.start_zeit) == "FTO"
                        for rid in ids(t)})
    # neue Dienste im Format des Planers (für "Übernehmen")
    suggestions, plans = [], []
    alt_plan = {p["driver_id"]: p for p in antwort["vehicle_plans"]}
    for f in fahrzeuge:
        if not f["fahrten"] or not f["fahrer"]:
            continue
        erste, letzte = f["fahrten"][0], f["fahrten"][-1]
        beginn = f["beginn"] if f["reserve"] else min(f["beginn"], erste[1] - 40)
        ende = letzte[2] + fahrzeit_min(letzte[0].ende, BETRIEBSSITZ)
        rides = [rid for (t, *_ ) in f["fahrten"] for rid in ids(t)]
        name = f"{f['fahrer']['first_name']} {f['fahrer']['last_name']}"
        suggestions.append({"driver_id": f["fahrer"]["id"], "driver_name": name,
                            "service_start": dd.hhmm(beginn), "service_end": dd.hhmm(ende),
                            "assigned_ride_ids": rides, "assigned_rides_count": len(rides),
                            "note": "Neuplanung nach Unfallmeldung" + (" · Bereitschaft" if f["reserve"] else ""),
                            "split_block": None})
        p = dict(alt_plan.get(f["fahrer"]["id"]) or {"driver_id": f["fahrer"]["id"], "vehicle_id": f["fahrzeug"]["id"],
                 "vehicle_label": f"{f['fahrzeug'].get('brand_model', '')} {f['fahrzeug'].get('trim') or ''} ({f['fahrzeug'].get('license_plate', '')})",
                 "is_ev": f["klasse"].elektrisch, "shift_km": None, "charge_stops": [], "min_range_reserve_km": None,
                 "note": "Bereitschaftsfahrzeug"})
        plans.append(p)
    neu_antwort = {**antwort, "suggestions": suggestions, "vehicle_plans": plans,
                   "kpis": {**antwort["kpis"], "active_driver_count": len(suggestions)}}
    daten.ereignisse_setzen([e for e in daten.EREIGNISSE if e is not ereignis])
    return {
        "ereignis": {"name": ereignis.name, "art": ereignis.art,
                     "profil": [[a, b, x, y] for a, b, x, y in ereignis.profil]},
        "meldung": dd.hhmm(meldung_min),
        "ohne_neuplanung": {"spaete_abholungen": spaet_ohne, "anzahl": len(spaet_ohne),
                            "minuten": sum(spaet_ohne.values())},
        "mit_neuplanung": {"spaete_abholungen": spaet_mit, "anzahl": len(spaet_mit),
                           "minuten": sum(spaet_mit.values()),
                           "fahrertausch": sum(1 for a in aenderungen if not a["reservefahrzeug"]),
                           "reservefahrzeuge": sum(1 for f in fahrzeuge if f["reserve"])},
        "aenderungen": aenderungen, "umfahrung_fto": umfahrung,
        "spaetere_ankunft": spaetere_ankunft,
        "antwort": neu_antwort,
    }


def bisheriger_plan(tag: int):
    """Vorab gerechneter Plan des bisherigen Demo-Planers (CP-SAT, fester Puffer 20 min nach
    Flughafenabholungen, Strategie 'ausgewogen'), falls für den Tag vorhanden."""
    import json
    from pathlib import Path
    # Neu gerechneter Plan (gleicher Planer, aktuelle Fahrten) hat Vorrang, siehe README in ergebnisse/.
    eigen = Path(__file__).resolve().parent / "ergebnisse" / f"bisheriger-planer-tag{tag}.json"
    if eigen.exists():
        return json.loads(eigen.read_text())
    try:
        d = json.loads((dd.DATA / "planer-ergebnisse.json").read_text())
    except OSError:
        return None
    for e in d.get("eintraege", []):
        if e.get("tag") == tag and e.get("einstellungen", "").startswith('["balanced"') and "neueFahrten" not in e:
            return e["antwort"]
    return None


def fremdplan_testen(gs, antwort, szenarien_liste=None, ereignis=None) -> dict:
    """Pünktlichkeit der Abholungen eines fremden Plans (Fahrer -> Fahrten) im Verkehrsmodell der Engine.
    Mit szenarien_liste: Anteil pünktlicher Abholungen über die Verläufe. Mit ereignis: späte
    Abholungen am Einsatztag mit dieser Störung (typischer Verkehr sonst)."""
    gj = {g.job_id: g for g in gs}
    ketten = []
    for s in antwort.get("suggestions", []):
        rides = sorted((gj[r] for r in s.get("assigned_ride_ids", []) if r in gj), key=lambda g: g.ankunft)
        if rides:
            ketten.append(rides)

    def lauf(verz, faktor):
        spaet, n = {}, 0
        for kette in ketten:
            frei, ort = None, None
            for g in kette:
                bereit = g.ankunft + max(0, verz(g))
                if frei is None:
                    an = g.ankunft
                else:
                    an = frei + fahrzeit_min(ort, g.start, uhrzeit=int(frei)) * faktor(ort, g.start)
                n += 1
                if an - bereit > 0.5:
                    spaet[g.job_id] = round(an - bereit)
                start = max(an, bereit)
                frei = start + fahrzeit_min(g.start, g.ziel, uhrzeit=int(start)) * faktor(g.start, g.ziel)
                ort = g.ziel
        return spaet, n

    out = {"fahrer": len(antwort.get("suggestions", [])),
           "offen": len(antwort.get("unassigned_ride_ids", []))}
    # km wie bei der Engine: Depot -> erste Fahrt -> ... -> letzte Fahrt -> Depot, Straßen-km.
    # Der bisherige Planer bündelt nicht, jede Fahrt fährt ihre Strecke einzeln.
    gast = leer = 0.0
    for kette in ketten:
        leer += strassen_km(BETRIEBSSITZ, kette[0].start) + strassen_km(kette[-1].ziel, BETRIEBSSITZ)
        leer += sum(strassen_km(a.ziel, b.start) for a, b in zip(kette, kette[1:]))
        gast += sum(strassen_km(g.start, g.ziel) for g in kette)
    out["km"] = round(gast + leer)
    out["leer_km"] = round(leer)
    out["fahrten_geplant"] = sum(len(kette) for kette in ketten)
    # Passt der gespeicherte Plan zu den heutigen Fahrten? Sonst ist er für eine ältere Fassung des Tages gerechnet.
    alle_ids = [r for s in antwort.get("suggestions", []) for r in s.get("assigned_ride_ids", [])] + list(antwort.get("unassigned_ride_ids", []))
    out["passend"] = set(alle_ids) == set(gj)
    if szenarien_liste:
        anteil = []
        for s in szenarien_liste:
            spaet, n = lauf(lambda g: s.verspaetung.get(g.id, 0), s.f)
            anteil.append(1 - len(spaet) / n if n else 1)
        out["puenktlich_abholung"] = round(sum(anteil) / len(anteil), 4)
    if ereignis is not None:
        daten.ereignisse_setzen([*daten.EREIGNISSE, ereignis])
        spaet, _ = lauf(lambda g: 0, lambda a, b: 1.0)
        daten.ereignisse_setzen([e for e in daten.EREIGNISSE if e is not ereignis])
        out["stoerung_spaet"] = spaet
    return out
