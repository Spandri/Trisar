"""ÖPNV-Reisezeiten aus dem MVV-Soll-Fahrplan (GTFS, CC BY 4.0).

Quelle: Münchner Verkehrs- und Tarifverbund GmbH (MVV), GTFS-MVV-Gesamt,
Feed-Version 20261005, abgerufen 14.10.2026.

Berechnet mit dem Connection-Scan-Algorithmus die früheste Ankunft von einer
Station (Umsteigepunkt) zu einem Ziel, inklusive Fußweg zur nächsten Haltestelle.
Nur U-Bahn, S-Bahn/Zug und Tram (kein Bus) im Umkreis von 25 km um das Zentrum.
"""
from __future__ import annotations

import csv
import datetime as dt
import pickle
from bisect import bisect_left
from collections import defaultdict
from functools import lru_cache
from pathlib import Path

from daten import ZENTRUM, Ort, luftlinie_km

GTFS = Path(__file__).parent / "daten_extern" / "mvv_gtfs"
CACHE = Path(__file__).parent / "daten_extern" / "oepnv_verbindungen.pkl"
STICHTAG = dt.date(2026, 11, 17)      # Dienstag im Gültigkeitszeitraum des Feeds
RADIUS_KM = 25
FUSS_KMH = 4.5
FUSS_MAX_KM = 0.9
MIN_UMSTIEG_S = 120
VERKEHRSMITTEL = {"0": "Tram", "1": "U-Bahn", "2": "Zug/S-Bahn"}


def _zeit(s: str) -> int:
    h, m, sek = s.split(":")
    return int(h) * 3600 + int(m) * 60 + int(sek)


def _aktive_dienste() -> set[str]:
    tag = STICHTAG.strftime("%Y%m%d")
    wochentag = ["monday", "tuesday", "wednesday", "thursday", "friday",
                 "saturday", "sunday"][STICHTAG.weekday()]
    aktiv = set()
    for r in csv.DictReader(open(GTFS / "calendar.txt", encoding="utf-8-sig")):
        if r[wochentag] == "1" and r["start_date"] <= tag <= r["end_date"]:
            aktiv.add(r["service_id"])
    for r in csv.DictReader(open(GTFS / "calendar_dates.txt", encoding="utf-8-sig")):
        if r["date"] == tag:
            (aktiv.add if r["exception_type"] == "1" else aktiv.discard)(r["service_id"])
    return aktiv


def _baue():
    zentrum = Ort("Z", *ZENTRUM)
    stationen, eltern = {}, {}
    for r in csv.DictReader(open(GTFS / "stops.txt", encoding="utf-8-sig")):
        sid, parent = r["stop_id"], r["parent_station"] or r["stop_id"]
        eltern[sid] = parent
        if not r["parent_station"]:
            o = Ort(r["stop_name"], float(r["stop_lat"]), float(r["stop_lon"]))
            if luftlinie_km(o, zentrum) <= RADIUS_KM:
                stationen[sid] = o
    linien = {r["route_id"]: (r["route_short_name"], VERKEHRSMITTEL[r["route_type"]])
              for r in csv.DictReader(open(GTFS / "routes.txt", encoding="utf-8-sig"))
              if r["route_type"] in VERKEHRSMITTEL}
    dienste = _aktive_dienste()
    fahrten = {r["trip_id"]: r["route_id"]
               for r in csv.DictReader(open(GTFS / "trips.txt", encoding="utf-8-sig"))
               if r["route_id"] in linien and r["service_id"] in dienste}
    halte = defaultdict(list)
    with open(GTFS / "stop_times.txt", encoding="utf-8-sig") as f:
        for r in csv.DictReader(f):
            if r["trip_id"] in fahrten:
                st = eltern.get(r["stop_id"], r["stop_id"])
                if st in stationen:
                    halte[r["trip_id"]].append((int(r["stop_sequence"]), st,
                                                _zeit(r["arrival_time"]), _zeit(r["departure_time"])))
    verbindungen = []
    for trip, hs in halte.items():
        hs.sort()
        for (_, a, _, ab), (_, b, an, _) in zip(hs, hs[1:]):
            if a != b and an >= ab:
                verbindungen.append((ab, an, a, b, trip))
    verbindungen.sort()
    genutzt = {s for v in verbindungen for s in (v[2], v[3])}
    stationen = {s: o for s, o in stationen.items() if s in genutzt}
    linie_je_fahrt = {t: linien[fahrten[t]] for t in halte}
    return stationen, verbindungen, linie_je_fahrt


@lru_cache(maxsize=1)
def netz():
    if CACHE.exists():
        return pickle.loads(CACHE.read_bytes())
    daten = _baue()
    CACHE.write_bytes(pickle.dumps(daten))
    return daten


def stationen_mit(verkehrsmittel: str = "U-Bahn") -> list[tuple[str, Ort]]:
    stationen, verbindungen, linie = netz()
    ids = {v[2] for v in verbindungen if linie[v[4]][1] == verkehrsmittel}
    return [(s, stationen[s]) for s in sorted(ids)]


@lru_cache(maxsize=None)
def _profil(start: str, ab_s: int) -> dict[str, int]:
    """Früheste Ankunft (Sekunden) an allen Stationen, Start ab_s an Station start."""
    _, verbindungen, _ = netz()
    ankunft = {start: ab_s}
    in_fahrt = set()
    i = bisect_left(verbindungen, (ab_s,))
    ende = ab_s + 2 * 3600
    while i < len(verbindungen) and verbindungen[i][0] <= ende:
        ab, an, a, b, trip = verbindungen[i]
        i += 1
        if trip in in_fahrt or (a in ankunft and ankunft[a] + (0 if a == start else MIN_UMSTIEG_S) <= ab):
            in_fahrt.add(trip)
            if an < ankunft.get(b, 10**9):
                ankunft[b] = an
    return ankunft


@lru_cache(maxsize=None)
def _zielhalte(lat: float, lng: float) -> tuple[tuple[str, int], ...]:
    stationen, _, _ = netz()
    ziel = Ort("Z", lat, lng)
    nah = []
    for sid, o in stationen.items():
        km = luftlinie_km(o, ziel) * 1.3
        if km <= FUSS_MAX_KM:
            nah.append((sid, round(km / FUSS_KMH * 3600)))
    return tuple(nah)


def reisezeit_min(start_station: str, ziel: Ort, uhrzeit_min: int) -> int | None:
    """Minuten von Abfahrtswunsch bis Ankunft am Ziel (inkl. Warten und Fußweg)."""
    slot = (uhrzeit_min // 5) * 5 * 60          # 5-Minuten-Raster für den Cache
    ankunft = _profil(start_station, slot)
    beste = None
    for sid, fuss_s in _zielhalte(ziel.lat, ziel.lng):
        if sid in ankunft:
            t = ankunft[sid] + fuss_s
            beste = t if beste is None else min(beste, t)
    if beste is None:
        return None
    return round((beste - uhrzeit_min * 60) / 60)


def reisezeit_ab_ort_min(start: Ort, ziel: Ort, uhrzeit_min: int) -> int | None:
    """Wie reisezeit_min, aber ab beliebigem Ort: Fußweg zu Haltestellen in der Nähe."""
    beste = None
    for sid, fuss_s in _zielhalte(start.lat, start.lng):
        ab = uhrzeit_min + round(fuss_s / 60)
        t = reisezeit_min(sid, ziel, ab)
        if t is not None:
            gesamt = t + (ab - uhrzeit_min)
            beste = gesamt if beste is None else min(beste, gesamt)
    return beste
