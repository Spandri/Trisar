"""Adapter Demo -> Engine: Fahrten, Fahrer und Fahrzeuge aus admin-app-demo/src/demo/data.

Die Demo-Daten sind erfunden (Demo-Vorschau), Ergebnisse sind Planungsbeispiele.
"""
from __future__ import annotations

import dataclasses
import json
from pathlib import Path

import daten
from daten import Ereignis, demo_ort, fahrzeit_min
from instanz import Gruppe

DATA = Path(__file__).resolve().parents[2] / "admin/src/demo/data"
DEMO_BASE_DATE = "2026-08-16"
TAGE = {0: "2026-08-16", 1: "2026-08-17", 2: "2026-08-18"}
TAG_NAME = {0: "Basistag", 1: "Stadttag", 2: "Messetag"}
AUSGESCHLOSSEN = {"done", "cancelled", "canceled", "refused", "deleted"}

PUFFER_STANDARD_MIN = 20   # Standardgast darf durch Sammelfahrt so viel später ankommen
PUFFER_VIP_MIN = 5


def lade(name: str):
    return json.loads((DATA / name).read_text())


def minute(hhmm: str) -> int:
    h, m = hhmm.split(":")[:2]
    return int(h) * 60 + int(m)


def hhmm(minuten: float) -> str:
    m = int(round(minuten))
    return f"{(m // 60) % 24:02d}:{m % 60:02d}"


def personen(job) -> int:
    p = job.get("passengers")
    if isinstance(p, list):
        return max(1, len(p))
    return max(1, int(p or 1))


def gruppen_fuer_tag(tag: int) -> tuple[list[Gruppe], dict]:
    """Eine Gruppe je Fahrt des Tages. Liefert Gruppen und job_id -> Job."""
    jobs = [j for j in lade("jobs.json") if j["ride_date"] == TAGE[tag]
            and j.get("status") not in AUSGESCHLOSSEN and not j.get("convoy_id")]
    jobs.sort(key=lambda j: (j["etd"], j["id"]))
    gs, je = [], {}
    for i, j in enumerate(jobs):
        start, ziel = demo_ort(j["pickup_name"]), demo_ort(j["dropoff_name"])
        ab = minute(j["etd"])
        p = personen(j)
        gepaeck = p if j.get("needs_luggage") else 0
        vip = bool(j.get("is_vip"))
        direkt = fahrzeit_min(start, ziel, uhrzeit=ab)
        spaet = ab + direkt + (PUFFER_VIP_MIN if vip else PUFFER_STANDARD_MIN)
        erlaubt = frozenset() if vip else frozenset({"sammeln"})
        gs.append(Gruppe(i, p, gepaeck, ab, ziel, spaet, False, start, premium=vip, tag=tag,
                         art="", erlaubt=erlaubt, flug=j.get("flight_number") or "", job_id=j["id"]))
        je[j["id"]] = j
    return gs, je


def klasse_von(fz) -> str:
    m = (fz.get("brand_model", "") + " " + (fz.get("trim") or "")).strip()
    ft = fz.get("fuel_type", "")
    if "i7" in m:
        return daten.LIMO_E.name
    if ft == "Elektro":
        return daten.SUV_E.name
    if "740" in m:
        return daten.LIMO_D.name
    if ft == "Plug-in-Hybrid":
        return daten.SUV_P.name
    if "X7" in m:
        return daten.VAN_D.name
    return daten.SUV_D.name


def flotte_setzen() -> dict[str, list[dict]]:
    """Setzt die Anzahl je Fahrzeugklasse aus vehicles.json, liefert Fahrzeuge je Klasse."""
    je: dict[str, list[dict]] = {k.name: [] for k in daten.KLASSEN}
    for fz in lade("vehicles.json"):
        je[klasse_von(fz)].append(fz)
    for i, k in enumerate(daten.KLASSEN):
        fz = je[k.name]
        reichweite = k.reichweite_km
        if k.elektrisch and fz:
            # nutzbar: 90 % der Herstellerreichweite des schwächsten Fahrzeugs der Klasse [Annahme]
            reichweite = int(min(f.get("range_km") or 400 for f in fz) * 0.9)
        daten.KLASSEN[i] = dataclasses.replace(k, anzahl=len(fz), reichweite_km=reichweite)
    for name in ("LIMO_E", "LIMO_D", "SUV_E", "SUV_P", "SUV_D", "VAN_D"):
        alt = getattr(daten, name)
        setattr(daten, name, next(k for k in daten.KLASSEN if k.name == alt.name))
    return je


def fahrer() -> list[dict]:
    ps = [p for p in lade("profiles.json") if p.get("role") == "fahrer"]
    return sorted(ps, key=lambda p: (p.get("driver_number") or 0, p["id"]))


# ---------------------------------------------------------------------------
# Verkehrsereignisse der Demo (Planungsannahmen, Recherche 16.10.2026)
# Profil: (von_min, bis_min, Zuschlag stadteinwärts, Zuschlag stadtauswärts)
# ---------------------------------------------------------------------------
HEIMSPIEL = Ereignis(
    name="Heimspiel FC Bayern, Allianz Arena (Anstoß 20:30)",
    art="grossveranstaltung",
    profil=((18 * 60, 19 * 60, 3, 9), (19 * 60, 20 * 60 + 15, 4, 12),
            (22 * 60 + 15, 22 * 60 + 50, 8, 20), (22 * 60 + 50, 23 * 60 + 15, 5, 12),
            (23 * 60 + 15, 23 * 60 + 45, 2, 5)),
    schwabing_min=6, bekannt=True)

UNFALL_A9 = Ereignis(
    name="Unfall A9 Richtung München, Vollsperrung zwischen Kreuz Neufahrn und Garching-Nord (06:50)",
    art="unfall",
    # Demo-Annahme, bewusst stark: Vollsperrung 2 h, danach ein Streifen frei, Rückstau löst sich bis
    # 10:45 auf (Sperrdauer im Mittel 98 min laut Auswertung von 55.000 Sperrungen; Beispiele A9/A92
    # 30 min bis 3 h). Die Umleitung über die Flughafentangente Ost ist durch den gesamten umgeleiteten
    # Verkehr überlastet (+45 min). Bis 02.11.: 40 min Sperrung, FTO +15, siehe demo_daten_vor_starke_stoerung.py.
    profil=((6 * 60 + 50, 8 * 60 + 50, 60, 0), (8 * 60 + 50, 10 * 60, 30, 0), (10 * 60, 10 * 60 + 45, 10, 0)),
    bekannt=False, fto_zusatz=45)

# Messebeginn 09:00: Zufahrt zur Messe Riem (A94, Ausfahrt Messe, Willy-Brandt-Allee) staut sich
# morgens. Wirkt nur auf Fahrten in den Umkreis der Messe hinein. Planungsannahme, kein Messwert.
MESSE_VERKEHR = Ereignis(
    name="Messe-Verkehr, Messe München (Einlass 09:00)",
    art="messe",
    profil=((7 * 60 + 30, 8 * 60, 8, 0), (8 * 60, 9 * 60 + 30, 15, 0), (9 * 60 + 30, 10 * 60, 6, 0)),
    bekannt=True, gebiet_ort=demo_ort("Messe München, Am Messesee 2"), gebiet_km=3.5)

# Simulierter starker Verkehr in der Altstadt am Basistag (Demo-Annahme, z. B. Sperrung am
# Altstadtring). Wirkt auf Fahrten in den Umkreis von 2 km um den Odeonsplatz hinein.
INNENSTADT = Ereignis(
    name="Starker Verkehr Innenstadt (Demo-Annahme)",
    art="innenstadt",
    profil=((7 * 60, 11 * 60, 15, 0), (16 * 60 + 30, 19 * 60 + 30, 15, 0)),
    bekannt=True, gebiet_ort=daten.Ort("Altstadt, Odeonsplatz", 48.1426, 11.5774), gebiet_km=2.0)

EREIGNISSE_JE_TAG = {0: [INNENSTADT], 1: [], 2: [MESSE_VERKEHR, HEIMSPIEL]}
STOERUNG_JE_TAG = {1: UNFALL_A9}
