"""
Leerfahrten der Engine mit echten Strassenzeiten (eigener OSRM) statt Zonen.

Zwei Verkehrsmodelle (Planer-Einstellung `travelModel`):
  - "osrm"      (Standard): freie OSRM-Fahrzeit x Stundenfaktor fuer ganz Muenchen
  - "osrm_raum": freie OSRM-Fahrzeit x Faktor je Raumtyp, Tagestyp und Stunde
                 (verkehr_faktoren.json, aus TomTom-Mustern gemessen,
                 werkzeuge/routen-vergleich/faktoren_sammeln.py)

Messung 05.11.2026 (werkzeuge/routen-vergleich/ERGEBNIS.md, 90 Faelle gegen TomTom):
Zonen 15,6 min daneben, osrm 4,6 min, osrm_raum 2,7 min.
"""
from __future__ import annotations

import json
import math
from datetime import date
from pathlib import Path
from typing import Dict, List, Optional, Sequence, Tuple
from urllib.request import Request, urlopen

# Gleicher Stundenfaktor wie admin/src/demo/data/traffic_factors.json.
STUNDEN_FAKTOR: Dict[int, float] = {
    5: 0.895, 6: 0.921, 7: 0.998, 8: 1.072, 9: 1.039, 10: 0.996, 11: 1.0, 12: 1.002, 13: 1.0,
    14: 1.022, 15: 1.048, 16: 1.133, 17: 1.182, 18: 1.088, 19: 0.994, 20: 0.932, 21: 0.909,
    22: 0.881, 23: 0.881,
}

ZENTRUM = (48.1374, 11.5755)
FLUGHAFEN = (48.3537, 11.7861)

_FAKTOREN_PFAD = Path(__file__).resolve().parent / "verkehr_faktoren.json"
_faktoren_cache: Optional[Dict[str, Dict[str, Dict[str, float]]]] = None


def _raum_faktoren() -> Dict[str, Dict[str, Dict[str, float]]]:
    global _faktoren_cache
    if _faktoren_cache is None:
        try:
            _faktoren_cache = json.loads(_FAKTOREN_PFAD.read_text()).get("faktoren", {})
        except Exception:
            _faktoren_cache = {}
    return _faktoren_cache


def raum_faktoren_vorhanden() -> bool:
    return bool(_raum_faktoren())


def km(a: Tuple[float, float], b: Tuple[float, float]) -> float:
    r = 6371.0
    p1, p2 = math.radians(a[0]), math.radians(b[0])
    d = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(b[1] - a[1]) / 2) ** 2
    return 2 * r * math.asin(math.sqrt(d))


def raumtyp(a: Tuple[float, float], b: Tuple[float, float]) -> str:
    """Wie in der Messung: Flughafen, Innenstadt (< 4 km), Stadt (< 10 km), sonst Umland."""
    if km(a, FLUGHAFEN) < 3 or km(b, FLUGHAFEN) < 3:
        return "flughafen"
    ka, kb = km(ZENTRUM, a), km(ZENTRUM, b)
    if ka < 4 and kb < 4:
        return "innenstadt"
    if ka < 10 and kb < 10:
        return "stadt"
    return "umland"


def tagestyp(tag: date) -> str:
    wd = tag.weekday()
    return "fr" if wd == 4 else "sa" if wd == 5 else "so" if wd == 6 else "mo-do"


def faktor(modell: str, stunde: int, tag: date, a: Tuple[float, float], b: Tuple[float, float]) -> float:
    h = max(5, min(23, int(stunde)))
    if modell == "osrm_raum":
        tabelle = _raum_faktoren()
        wert = tabelle.get(raumtyp(a, b), {}).get(tagestyp(tag), {}).get(str(h))
        if wert:
            return float(wert)
    return STUNDEN_FAKTOR.get(h, 1.0)


def osrm_tabelle(osrm_url: str, punkte: Sequence[Tuple[float, float]], timeout: float = 15.0,
                 stueck: int = 80) -> Optional[List[List[Optional[float]]]]:
    """Freie Fahrzeiten in Minuten zwischen allen Punkten (OSRM /table), in Stuecken
    wegen max-table-size. None, wenn OSRM nicht erreichbar ist."""
    n = len(punkte)
    if n == 0:
        return []
    matrix: List[List[Optional[float]]] = [[None] * n for _ in range(n)]
    for qs in range(0, n, stueck):
        for zs in range(0, n, stueck):
            quellen = list(range(qs, min(n, qs + stueck)))
            ziele = list(range(zs, min(n, zs + stueck)))
            idx = sorted(set(quellen) | set(ziele))
            pos = {g: k for k, g in enumerate(idx)}
            coords = ";".join(f"{punkte[g][1]:.6f},{punkte[g][0]:.6f}" for g in idx)
            url = (f"{osrm_url.rstrip('/')}/table/v1/driving/{coords}"
                   f"?sources={';'.join(str(pos[g]) for g in quellen)}"
                   f"&destinations={';'.join(str(pos[g]) for g in ziele)}&annotations=duration")
            try:
                with urlopen(Request(url, headers={"User-Agent": "trisar-planner/1.0"}), timeout=timeout) as r:
                    daten = json.loads(r.read().decode("utf-8"))
            except Exception:
                return None
            if daten.get("code") != "Ok":
                return None
            for qi, q in enumerate(quellen):
                for zi, z in enumerate(ziele):
                    sek = daten["durations"][qi][zi]
                    matrix[q][z] = None if sek is None else sek / 60.0
    return matrix
