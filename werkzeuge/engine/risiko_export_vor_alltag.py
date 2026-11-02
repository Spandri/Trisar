"""Risiko je Fahrt für die Demo: wertet die fertigen Engine-Pläne über dieselben
500 Verläufe aus, mit denen demo_lauf.py geplant hat (gleiche Seeds).

Je Fahrt: Fahrzeit-Verteilung, mögliche Verspätung am Ziel, Ursachen, eingeplante
Luft bis zur nächsten Abholung desselben Fahrers. Je Tag: Luft im ungünstigen
Verlauf je Stunde und die Ereignisse, die die Engine eingerechnet hat.
Prüft sich selbst: die Luft im ungünstigen Verlauf muss mit reserve_min aus
engine-ergebnisse.json übereinstimmen, sonst bricht das Skript ab.

Aufruf: .venv/bin/python risiko_export.py
"""
from __future__ import annotations

import json
import statistics
from pathlib import Path

import daten
import demo_daten as dd
import szenarien
import touren
from daten import fahrzeit_min, ist_flughafen

DATA = dd.DATA
QUANTIL_JE_OPTION = {"standard": 0.998, "sicher": 0.998}   # wie demo_lauf.OPTIONEN
BISHER_PUFFER_MIN = 20     # bisheriger Planer: feste Fahrtdauer plus 20 min je Fahrt
SPAET_MIN = 5              # ab so viel Minuten zählt eine Ankunft/Fahrzeit als "später als geplant"


def hhmm(m: float) -> str:
    return dd.hhmm(int(round(m)))


def quant(werte, q):
    w = sorted(werte)
    return w[min(len(w) - 1, int(q * len(w)))]


def klasse(verzug_p90: float) -> str:
    """Wie spät kann die Fahrt am Ziel ankommen (9 von 10 Verläufen)?"""
    if verzug_p90 >= 20:
        return "hoch"
    if verzug_p90 > 10:
        return "mittel"
    return "niedrig"


def ankunftsart(g) -> str:
    if ist_flughafen(g.start):
        return "flug" if g.flug else "terminal"
    if g.start.name == daten.HBF.name:
        return "zug"
    return "gast"


def tour_finden(k, gruppen_ids: set, abfahrt: str, ankunft: str):
    for t in k.touren:
        if t.zubringer is None and set(t.gruppen) == gruppen_ids \
                and dd.hhmm(t.start_zeit) == abfahrt and dd.hhmm(t.ende_zeit) == ankunft:
            return t
    return None


def fahrt_risiko(g, t, szen, zeiten):
    """Verteilung je Fahrt über alle Verläufe."""
    dauer = [zeiten[i][t.id][1] - zeiten[i][t.id][0] for i in range(len(szen))]
    verzug = [zeiten[i][t.id][1] - t.ende_zeit for i in range(len(szen))]
    versp = [max(0, s.verspaetung[g.id]) for s in szen]
    stau_extra = [(t.ende_zeit - t.start_zeit) * (s.f(t.start, t.ende) - 1) for s in szen]
    n = len(szen)
    ursachen = []
    art = ankunftsart(g)
    anteil = sum(1 for v in versp if v > SPAET_MIN) / n
    if anteil >= 0.05:
        name = {"flug": f"Flug {g.flug} verspätet", "zug": "Zug verspätet",
                "terminal": "Gast später am Terminal", "gast": "Gast später bereit"}[art]
        ursachen.append({"name": name, "anteil": round(anteil, 2), "bis_min": round(quant(versp, 0.9))})
    anteil = sum(1 for v in stau_extra if v > SPAET_MIN) / n
    if anteil >= 0.05:
        ursachen.append({"name": "Mehr Verkehr als üblich", "anteil": round(anteil, 2),
                         "bis_min": round(quant(stau_extra, 0.9))})
    zusatz, route = daten.ereignis_zuschlag(t.start, t.ende, t.start_zeit)
    ereignis = None
    if zusatz:
        e = next(e for e in daten.EREIGNISSE if e.bekannt)
        ereignis = {"name": e.name.split(" (")[0], "min": round(zusatz), "route": route}
    p10, p50, p90 = (round(quant(dauer, q)) for q in (0.1, 0.5, 0.9))
    lo, hi = min(dauer), quant(dauer, 0.98)
    breite = max(1.0, (hi - lo) / 16)
    hist = [0] * 17
    for d in dauer:
        hist[min(16, int((min(d, hi) - lo) / breite))] += 1
    v90 = quant(verzug, 0.9)
    return {
        "klasse": klasse(v90),
        "verzug_p90": round(max(0, v90)),
        "fahrzeit": {"plan": t.ende_zeit - t.start_zeit, "p10": p10, "p50": p50, "p90": p90,
                     "von": round(lo), "bis": round(hi), "hist": hist},
        "ursachen": sorted(ursachen, key=lambda u: -u["anteil"]),
        "ereignis": ereignis,
    }


def option_auswerten(gs, k, szen, zeiten, antwort, q, gd_job):
    """Kette je Dienst aus den Vorschlägen, Luft bis zur nächsten Abholung."""
    eng = antwort["engine"]
    sammel = {frozenset(s["ride_ids"]) for s in eng["sammel"]}
    fahrten_plan = eng["fahrten"]
    _, luft_q = szenarien.bogen_pruefer_quantil(gs, k, szen, q, 0.0)
    tour_je_fahrt, je_fahrt, paare, fahrer = {}, {}, [], {}
    for sug in antwort["suggestions"]:
        ids = sug["assigned_ride_ids"]
        for r in ids:
            fahrer[r] = sug["driver_name"]
        bloecke, i = [], 0
        while i < len(ids):
            blk = next((s for s in sammel if ids[i] in s), frozenset([ids[i]]))
            bloecke.append([r for r in ids if r in blk])
            i += len(blk)
        kette = []
        for blk in bloecke:
            fp = fahrten_plan[blk[0]]
            t = tour_finden(k, {gd_job[r].id for r in blk}, fp["abfahrt"], fp["ankunft"])
            if t is None:
                raise SystemExit(f"Tour nicht gefunden: {blk} {fp}")
            kette.append((blk, t))
        for j, (blk, t) in enumerate(kette):
            for r in blk:
                tour_je_fahrt[r] = t
            if j + 1 < len(kette):
                nblk, u = kette[j + 1]
                leer = fahrzeit_min(t.ende, u.start, uhrzeit=t.ende_zeit)
                geplant = u.start_zeit - (t.ende_zeit + leer)
                ungunst = luft_q(t.id, u.id, leer)
                spaet = sum(1 for s, z in zip(szen, zeiten)
                            if z[t.id][1] + leer * s.f(t.ende, u.start) > z[u.id][0] + 0.5)
                for r in nblk:
                    erwartet_r = fahrten_plan[r]["reserve_min"]
                    if erwartet_r is None or abs(erwartet_r - round(ungunst)) > 0:
                        raise SystemExit(f"Selbstprüfung: {r} Engine {erwartet_r} min, nachgerechnet {round(ungunst)} min")
                # Puffer = Zeit, die die Engine zwischen dieser und der nächsten Fahrt über die
                # normale Fahrzeit hinaus freihält (vergleichbar mit pauschal 20 min bisher).
                # Verzug = so viel später ist das Fahrzeug im ungünstigen Verlauf am nächsten Abholort.
                info = {"puffer": round(geplant), "verzug_ungunst": round(geplant - ungunst),
                        "luft_geplant": round(geplant), "luft_ungunst": round(ungunst),
                        "folge_abfahrt": dd.hhmm(u.start_zeit), "folge_ziel": u.ende.name.split(",")[0],
                        "folge_puenktlich": len(szen) - spaet, "verlaeufe": len(szen)}
                for r in blk:
                    je_fahrt[r] = info
                paare.append((u.start_zeit, ungunst, geplant))
    return tour_je_fahrt, je_fahrt, paare, fahrer


def tagesverlauf(paare):
    """Luft im ungünstigen Verlauf je Stunde (Abholzeit der Folgefahrt), 06–24 Uhr."""
    stunden = []
    for h in range(6, 24):
        w = [u for (ab, u, _) in paare if h * 60 <= ab < (h + 1) * 60]
        stunden.append({"h": h, "anschluesse": len(w),
                        "luft_min": round(min(w)) if w else None,
                        "luft_p10": round(quant(w, 0.1)) if w else None})
    return stunden


def ereignis_liste(tag, gs):
    """Was die Engine für den Tag eingerechnet hat (nur echte Eingaben des Laufs)."""
    out = []
    for e in dd.EREIGNISSE_JE_TAG[tag]:
        betroffen = sum(1 for g in gs if daten.ereignis_zuschlag(g.start, g.ziel, g.ankunft)[0])
        fenster = [(a, b) for a, b, *_ in e.profil]
        out.append({"id": "heimspiel", "art": "ereignis", "titel": e.name.split(" (")[0],
                    "kurz": "Heimspiel", "zusatz": e.name.split(" (")[1].rstrip(")") if " (" in e.name else "",
                    "von": dd.hhmm(min(a for a, _ in fenster)), "bis": dd.hhmm(max(b for _, b in fenster)),
                    "zeit": " · ".join(f"{dd.hhmm(a)}–{dd.hhmm(b)}" for a, b in _zusammen(fenster)),
                    "wirkung": f"A9 Nord, Kreuz München-Nord · bis +{round(max(max(x, y) for *_, x, y in e.profil))} min",
                    "quelle": "Spielplan · Planungsannahme nach Polizei München, Mobilitätsreferat",
                    "fahrten": betroffen})
    flug = [g for g in gs if ist_flughafen(g.start) and g.flug]
    if flug:
        out.append({"id": "fluege", "art": "statistik", "titel": "Flugankünfte", "kurz": "Flugankünfte",
                    "von": dd.hhmm(min(g.ankunft for g in flug)), "bis": dd.hhmm(max(g.ankunft for g in flug)),
                    "zeit": f"{dd.hhmm(min(g.ankunft for g in flug))}–{dd.hhmm(max(g.ankunft for g in flug))}",
                    "wirkung": "Verspätung je Flug, etwa jede vierte Landung über 15 min",
                    "quelle": "Pünktlichkeit Eurocontrol 2025, Flughafen München",
                    "fahrten": len(flug)})
    zug = [g for g in gs if g.start.name == daten.HBF.name]
    if zug:
        out.append({"id": "zuege", "art": "statistik", "titel": "Bahnankünfte", "kurz": "Bahnankünfte",
                    "von": dd.hhmm(min(g.ankunft for g in zug)), "bis": dd.hhmm(max(g.ankunft for g in zug)),
                    "zeit": f"{dd.hhmm(min(g.ankunft for g in zug))}–{dd.hhmm(max(g.ankunft for g in zug))}",
                    "wirkung": "Verspätung je Zug, gut jeder dritte über 5 min",
                    "quelle": "Pünktlichkeit DB Fernverkehr 2025",
                    "fahrten": len(zug)})
    out.append({"id": "verkehr", "art": "statistik", "titel": "Verkehr je Stunde", "kurz": "Verkehr",
                "von": "06:00", "bis": "24:00", "zeit": "ganztägig",
                "wirkung": "typische Fahrzeit je Gebiet und Uhrzeit, dazu Schwankung je Verlauf",
                "quelle": "TomTom-Verkehrsmuster München, Werktag",
                "fahrten": len(gs)})
    return out


def _zusammen(fenster):
    """Aneinander anschließende Profilabschnitte zu Zeitfenstern zusammenfassen."""
    out = []
    for a, b in sorted(fenster):
        if out and a <= out[-1][1]:
            out[-1] = (out[-1][0], max(out[-1][1], b))
        else:
            out.append((a, b))
    return out


def main():
    quelle = json.loads((DATA / "engine-ergebnisse.json").read_text())
    alles = {"erstellt_aus": quelle["erstellt"], "bisher_puffer_min": BISHER_PUFFER_MIN,
             "hinweis": "Ausgewertet über dieselben 500 Verläufe wie die Planung. Verspätungs- und "
                        "Verkehrsannahmen sind Planungsannahmen, keine Messwerte.", "tage": {}}
    for tag in (0, 1, 2):
        daten.ereignisse_setzen(dd.EREIGNISSE_JE_TAG[tag])
        gs, _ = dd.gruppen_fuer_tag(tag)
        gd_job = {g.job_id: g for g in gs}
        k = touren.erzeuge(gs, mit_sammeln=True, mit_knoten=False)
        szen = szenarien.erzeuge(gs, 500, seed=11 + tag)
        zeiten = [szenarien.tourzeiten(gs, k, s) for s in szen]
        eintrag = quelle["tage"][str(tag)]
        tag_aus = {"datum": eintrag["datum"], "name": eintrag["name"], "verlaeufe": len(szen),
                   "ereignisse": ereignis_liste(tag, gs), "optionen": {}}
        for opt, antwort in eintrag["optionen"].items():
            tour_je_fahrt, luft, paare, fahrer = option_auswerten(gs, k, szen, zeiten, antwort,
                                                         QUANTIL_JE_OPTION[opt], gd_job)
            fahrten = {}
            for rid, t in tour_je_fahrt.items():
                f = fahrt_risiko(gd_job[rid], t, szen, zeiten)
                f["luft"] = luft.get(rid)
                f["fahrer"] = fahrer.get(rid)
                f["abfahrt"] = dd.hhmm(t.start_zeit)
                f["von"] = gd_job[rid].start.name.split(",")[0]
                f["nach"] = gd_job[rid].ziel.name.split(",")[0]
                fahrten[rid] = f
            puffer = [f["luft"]["puffer"] for f in fahrten.values() if f["luft"]]
            hoch = [rid for rid, f in fahrten.items() if f["klasse"] == "hoch"]
            verlauf = tagesverlauf(paare)
            mit = [s for s in verlauf if s["luft_p10"] is not None]
            knapp = min(mit, key=lambda s: (s["luft_p10"], -s["anschluesse"])) if mit else None
            tag_aus["optionen"][opt] = {
                "puffer_mittel": round(statistics.mean(puffer)) if puffer else None,
                "puffer_median": round(statistics.median(puffer)) if puffer else None,
                "puffer_min": min(puffer) if puffer else None,
                "puffer_max": max(puffer) if puffer else None,
                "anschluesse": len(puffer),
                "unter_bisher": sum(1 for p in puffer if p < BISHER_PUFFER_MIN),
                "ueber_bisher": sum(1 for p in puffer if p > BISHER_PUFFER_MIN),
                "hoch": sorted(hoch, key=lambda r: fahrten[r]["abfahrt"]),
                "anzahl": {kl: sum(1 for f in fahrten.values() if f["klasse"] == kl) for kl in ("niedrig", "mittel", "hoch")},
                "verlauf": verlauf,
                "knappste_stunde": knapp["h"] if knapp else None,
                "fahrten": fahrten,
            }
            o = tag_aus["optionen"][opt]
            print(f"Tag {tag} {opt}: {len(fahrten)} Fahrten, {o['anschluesse']} Anschlüsse, Puffer Ø {o['puffer_mittel']} "
                  f"(Median {o['puffer_median']}), Klassen {o['anzahl']}, knappste Stunde {o['knappste_stunde']}", flush=True)
        alles["tage"][str(tag)] = tag_aus
    ziel = DATA / "risiko-ergebnisse.json"
    ziel.write_text(json.dumps(alles, ensure_ascii=False, separators=(",", ":")))
    print("geschrieben", ziel, round(ziel.stat().st_size / 1024), "KB")


if __name__ == "__main__":
    main()
