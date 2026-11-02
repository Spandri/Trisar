"""Gelernter Korridor: sagt vorab voraus, welche Kandidatenfahrten in guten
Plänen vorkommen, und verkleinert damit das Optimierungsmodell.

Eigenes, lokales Modell (logistische Regression, numpy), trainiert auf Plänen,
die die ENGINE selbst gerechnet hat. Keine externe KI. Im Betrieb kommen als
Trainingsdaten die freigegebenen Pläne und Korrekturen der Disposition hinzu.
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np

from daten import KLASSEN, fahrzeit_min
from instanz import Gruppe
from touren import Kandidaten, Tour

ARTEN = ["direkt", "sammel_direkt", "sammel_knoten", "letzte_km", "gepaeck"]
GEWICHTE = Path(__file__).parent / "korridor_gewichte.json"
VORAUSWAHL_ARTEN = ("sammel_direkt", "sammel_knoten")   # nur diese werden ausgedünnt


def merkmale(t: Tour, gd: dict[int, Gruppe]) -> list[float]:
    gs = [gd[g] for g in t.gruppen]
    personen = sum(g.personen for g in gs)
    direkt_min = sum(fahrzeit_min(g.start, g.ziel) for g in gs) / max(1, len(gs))
    dauer = t.ende_zeit - t.start_zeit
    if t.ankunft_gruppe:
        puffer = min(gd[g].spaetestens - an for g, an in t.ankunft_gruppe.items())
    else:
        puffer = min(g.spaetestens for g in gs) - t.ende_zeit
    ankunft_streuung = max(g.ankunft for g in gs) - min(g.ankunft for g in gs)
    return [
        *[1.0 if t.art == a else 0.0 for a in ARTEN],
        *[1.0 if t.klasse is kl else 0.0 for kl in KLASSEN],
        len(gs),
        personen / t.klasse.plaetze,
        t.km / 10,
        t.km / max(1, personen) / 10,
        dauer / 30,
        dauer / max(1.0, direkt_min),
        puffer / 30,
        ankunft_streuung / 10,
        float(t.knoten is not None and t.knoten.ubahn),
    ]


def _matrix(gruppen, k: Kandidaten, auswahl=VORAUSWAHL_ARTEN):
    gd = {g.id: g for g in gruppen}
    ts = [t for t in k.touren if t.art in auswahl]
    return ts, np.array([merkmale(t, gd) for t in ts], dtype=float)


def trainiere(daten: list[tuple[list[Gruppe], Kandidaten, set[int]]], epochen: int = 3000,
              lr: float = 0.1, l2: float = 1e-3) -> dict:
    """daten: (Gruppen, Kandidaten, gewählte Tour-IDs) aus gelösten Instanzen."""
    xs, ys = [], []
    for gruppen, k, gewaehlt in daten:
        ts, x = _matrix(gruppen, k)
        xs.append(x)
        ys.append(np.array([1.0 if t.id in gewaehlt else 0.0 for t in ts]))
    x, y = np.vstack(xs), np.concatenate(ys)
    mu, sd = x.mean(0), x.std(0) + 1e-9
    z = np.hstack([(x - mu) / sd, np.ones((len(x), 1))])
    pos = max(1.0, y.sum())
    gewicht = np.where(y == 1, len(y) / (2 * pos), len(y) / (2 * (len(y) - pos)))
    w = np.zeros(z.shape[1])
    for _ in range(epochen):
        p = 1 / (1 + np.exp(-z @ w))
        w -= lr * (z.T @ ((p - y) * gewicht) / len(y) + l2 * w)
    modell = {"mu": mu.tolist(), "sd": sd.tolist(), "w": w.tolist(),
              "positive": int(y.sum()), "beispiele": int(len(y))}
    GEWICHTE.write_text(json.dumps(modell))
    return modell


def lade() -> dict:
    return json.loads(GEWICHTE.read_text())


def bewerte(gruppen, k: Kandidaten, modell: dict | None = None) -> dict[int, float]:
    modell = modell or lade()
    ts, x = _matrix(gruppen, k)
    if not ts:
        return {}
    z = np.hstack([(x - np.array(modell["mu"])) / np.array(modell["sd"]), np.ones((len(x), 1))])
    p = 1 / (1 + np.exp(-z @ np.array(modell["w"])))
    return {t.id: float(pi) for t, pi in zip(ts, p)}


def duenne_aus(gruppen, k: Kandidaten, anteil: float = 0.25, modell: dict | None = None) -> Kandidaten:
    """Behält Direktfahrten immer (Rückfallebene), von den Sammelfahrten nur den
    Anteil mit höchster Wahrscheinlichkeit, mindestens 3 je Gruppe, dazu alle
    Anschlussfahrten und grünen Optionen der behaltenen Sammelfahrten."""
    p = bewerte(gruppen, k, modell)
    sammel = sorted(p, key=p.get, reverse=True)
    behalten = set(sammel[: max(1, int(len(sammel) * anteil))])
    tour = {t.id: t for t in k.touren}
    je_gruppe: dict[int, list[int]] = {}
    for tid in sammel:
        for g in tour[tid].gruppen:
            je_gruppe.setdefault(g, []).append(tid)
    for tids in je_gruppe.values():
        behalten.update(tids[:3])
    neu = Kandidaten()
    neu.touren = [t for t in k.touren
                  if t.art == "direkt" or t.id in behalten
                  or (t.zubringer is not None and t.zubringer in behalten)]
    neu.gruen = [o for o in k.gruen if o.zubringer is None or o.zubringer in behalten]
    return neu
