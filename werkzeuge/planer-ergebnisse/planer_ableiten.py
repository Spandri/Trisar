"""Leitet die Planer-Antwort fuer einen Folgetag mit Ruhezeiten exakt ab.

Aufruf: planer_ableiten.py <anfrage_mit_ruhezeiten.json> <antwort_ohne_ruhezeiten.json> <ausgabe.json>

Mehrtaegig plant die Demo Tag fuer Tag: der Folgetag bekommt Ruhezeitfenster
(frueheste Startzeit) fuer Fahrer, die am Vortag spaet aufgehoert haben. Sonst
ist die Anfrage identisch mit dem Einzeltag.

Alle Fahrer mit gleichem Profil (Verfuegbarkeit, Zonen, VIP, Stunden, ...) sind
fuer den Planer austauschbar: Vertauscht man sie in einer Loesung, bleiben
Zulaessigkeit und Zielfunktionswert unveraendert. Findet sich eine Zuordnung
der Dienste des Einzeltags auf Fahrer, die die Ruhezeiten einhalten (geprueft
mit exakt der Zulaessigkeitsregel des Solvers je Fahrt), ist das Ergebnis eine
Loesung der Folgetag-Anfrage mit demselben Zielwert. Da die Ruhezeiten die
Aufgabe nur einschraenken, gilt auch die Guete-Schranke weiter.

Exit 0: abgeleitet (Ausgabe geschrieben). Exit 3: nicht ableitbar (Grund auf stdout).
"""
from __future__ import annotations

import json
import os
import sys

HIER = os.path.dirname(os.path.abspath(__file__))
PLANER = os.path.normpath(os.path.join(HIER, "..", "..", "..", "admin-app-lokal"))
sys.path.insert(0, PLANER)

from optimizer import admin_payload_adapter as apa  # noqa: E402
from optimizer.api_server import SPLIT_SUFFIX, PlannerRequest, _build_adapter_options  # noqa: E402
from optimizer.driver_schedule_solver import _minutes_from_day_start, _resolve_planning_day  # noqa: E402

# Gleiche Fahrzeittabelle wie beim Rechnen (planer_rechnen.py).
with open(os.path.join(HIER, "fahrzeiten_von_muenchen.json"), encoding="utf-8") as _datei:
    _TABELLE = json.load(_datei)
_ORIGINAL = apa.OpenStreetMapTravelTimeProvider.minutes_from_munich


def _aus_tabelle(self, adresse):
    schluessel = str(adresse or "").strip().lower()
    if schluessel in _TABELLE:
        return int(_TABELLE[schluessel])
    return _ORIGINAL(self, adresse)


apa.OpenStreetMapTravelTimeProvider.minutes_from_munich = _aus_tabelle


def nicht_ableitbar(grund: str) -> None:
    print(grund)
    sys.exit(3)


def main() -> None:
    anfrage_pfad, antwort_pfad, ausgabe_pfad = sys.argv[1:4]
    with open(anfrage_pfad, encoding="utf-8") as datei:
        anfrage = json.load(datei)
    with open(antwort_pfad, encoding="utf-8") as datei:
        antwort = json.load(datei)
    if antwort.get("source") != "cp_sat":
        nicht_ableitbar("Einzeltag-Antwort ist keine CP-SAT-Antwort")

    payload = PlannerRequest(**anfrage)
    optionen = _build_adapter_options(payload.settings)
    anbieter = apa.OpenStreetMapTravelTimeProvider(
        origin_address="München, Deutschland", timeout_seconds=6.0, user_agent="trisar-driver-planner/1.0"
    )
    fahrer, fahrten, zonen, _ = apa.adapt_admin_payload_to_solver_inputs(
        raw_drivers=payload.drivers,
        raw_rides=payload.rides,
        service_date_value=payload.serviceDate,
        zone_provider=anbieter,
        options=optionen,
        place_minutes=payload.travelMinutes or None, depot_place=payload.depot,
    )
    tag = _resolve_planning_day(fahrten, None)
    fahrt_nach_id = {f.ride_id: f for f in fahrten}
    fahrer_nach_id = {f.driver_id: f for f in fahrer}
    name_nach_id = {
        str(z.get("driver_id") or z.get("id") or "").strip(): str(z.get("name") or "").strip()
        for z in payload.drivers
        if isinstance(z, dict)
    }

    # Die Einzeltag-Antwort muss genau diese Fahrten verplanen.
    vorschlaege = antwort.get("suggestions") or []
    verplant = [rid for v in vorschlaege for rid in (v.get("assigned_ride_ids") or [])]
    bekannt = set(verplant) | set(antwort.get("unassigned_ride_ids") or [])
    if bekannt != set(fahrt_nach_id):
        nicht_ableitbar(f"Fahrten weichen ab ({len(bekannt)} in der Antwort, {len(fahrt_nach_id)} in der Anfrage)")

    def profil(f, mit_spaetblock: bool):
        # Was der Solver tatsaechlich auswertet: wirksame Hoechstdauer und
        # Fairness-Teilnahme statt Rohwerte (9 h Verfuegbarkeit bei 8 h
        # Tagesgrenze wirkt wie 8 h). Beim Spaetblock zaehlt zusaetzlich die
        # Kopie, die api_server.py anlegt.
        basis = (
            f.is_vip_qualified, f.historical_worked_hours, f.hard_max_hours, f.is_availability_limited,
            f.min_shift_hours, f.start_zone, f.end_zone, f.is_ev, f.ev_range_km,
        )
        if not mit_spaetblock:
            return basis
        kopie = max(0.5, f.availability_max_hours - 1e-6)
        return basis + (min(kopie, f.legal_max_hours), kopie + 1e-9 < f.legal_max_hours)

    def zulaessig(f, fahrt) -> bool:
        # Exakt die Regel aus driver_schedule_solver.solve_schedule.
        if fahrt.is_vip_ride and not f.is_vip_qualified:
            return False
        start = _minutes_from_day_start(tag, fahrt.start_time)
        ende = _minutes_from_day_start(tag, fahrt.end_time)
        if f.earliest_start_minute is not None:
            anfahrt = zonen.minutes(f.start_zone, fahrt.start_zone) + int(fahrt.pre_buffer_minutes)
            if start - anfahrt < int(f.earliest_start_minute):
                return False
        if f.latest_end_minute is not None:
            rueckweg = zonen.minutes(fahrt.end_zone, f.end_zone)
            if ende + rueckweg > int(f.latest_end_minute):
                return False
        return True

    # Bloecke je Fahrer: (split_block, Fahrt-IDs) in Antwortreihenfolge.
    bloecke: dict = {}
    for v in vorschlaege:
        fid = str(v.get("driver_id") or "")
        bloecke.setdefault(fid, []).append((v.get("split_block"), list(v.get("assigned_ride_ids") or [])))
    for fid in bloecke:
        if fid not in fahrer_nach_id:
            nicht_ableitbar(f"Fahrer {fid} fehlt in der Anfrage")

    def kopie_wie_haupt(fid: str) -> bool:
        # Wirkt der Spaetblock-Platz dieses Fahrers fuer den Solver genau wie ein
        # Hauptblock, darf der Spaetblock als eigener Dienst vergeben werden.
        f = fahrer_nach_id[fid]
        return profil(f, True)[-2:] == (f.hard_max_hours, f.is_availability_limited)

    def einheiten_bilden(trennen: set) -> list:
        # Einheit: (Schluessel, Ursprungsfahrer, Block, Fahrt-IDs, mit_spaetblock)
        einheiten = []
        for fid, liste in bloecke.items():
            if fid in trennen:
                for split_block, rids in liste:
                    art = "spaet" if split_block == "late" else "frueh"
                    einheiten.append((f"{fid}|{art}", fid, art, rids, False))
            else:
                alle = [rid for _, rids in liste for rid in rids]
                mit = any(split_block == "late" for split_block, _ in liste)
                einheiten.append((fid, fid, "alle", alle, mit))
        return einheiten

    def paaren(einheiten: list):
        kandidaten = {}
        for schluessel, fid, _, rids, mit in einheiten:
            eigenes = profil(fahrer_nach_id[fid], mit)
            liste = [fahrer_nach_id[fid]] + [f for f in fahrer if f.driver_id != fid and profil(f, mit) == eigenes]
            kandidaten[schluessel] = [f.driver_id for f in liste if all(zulaessig(f, fahrt_nach_id[r]) for r in rids)]
            if not kandidaten[schluessel]:
                return None, f"kein zulaessiger Fahrer fuer {schluessel}"
        belegt: dict = {}
        for schluessel, fid, _, _, _ in einheiten:
            if fid in kandidaten[schluessel] and fid not in belegt:
                belegt[fid] = schluessel

        def zuordnen(einheit: str, gesehen: set) -> bool:
            for kandidat in kandidaten[einheit]:
                if kandidat in gesehen:
                    continue
                gesehen.add(kandidat)
                if kandidat not in belegt or zuordnen(belegt[kandidat], gesehen):
                    belegt[kandidat] = einheit
                    return True
            return False

        sys.setrecursionlimit(10000)
        for schluessel, _, _, _, _ in einheiten:
            if schluessel in set(belegt.values()):
                continue
            if not zuordnen(schluessel, set()):
                return None, f"keine Paarung moeglich fuer {schluessel}"
        return {einheit: fahrer_id for fahrer_id, einheit in belegt.items()}, ""

    einheiten = einheiten_bilden(set())
    zuordnung, grund = paaren(einheiten)
    getrennt: set = set()
    if zuordnung is None:
        getrennt = {fid for fid, liste in bloecke.items() if len(liste) > 1 and kopie_wie_haupt(fid)}
        if getrennt:
            einheiten = einheiten_bilden(getrennt)
            zuordnung, grund2 = paaren(einheiten)
            grund = grund2 or grund
    if zuordnung is None:
        nicht_ableitbar(grund)

    def ziel_fuer(fid: str, split_block) -> tuple:
        # -> (neue Fahrer-ID, bleibt Spaetblock?)
        if fid in getrennt:
            art = "spaet" if split_block == "late" else "frueh"
            return zuordnung[f"{fid}|{art}"], False
        return zuordnung[fid], split_block == "late"

    ergebnis = json.loads(json.dumps(antwort))
    for v in ergebnis.get("suggestions") or []:
        neu, spaet = ziel_fuer(str(v.get("driver_id") or ""), v.get("split_block"))
        v["driver_id"] = neu
        v["driver_name"] = name_nach_id.get(neu, v.get("driver_name", ""))
        v["split_block"] = "late" if spaet else None
        # Hinweis "Geteilter Dienst" neu setzen (wie api_server.py).
        note = str(v.get("note") or "")
        for praefix in ("Geteilter Dienst · Spätblock — ", "Geteilter Dienst · Frühblock — "):
            if note.startswith(praefix):
                note = note[len(praefix):]
        if note in ("Geteilter Dienst · Spätblock", "Geteilter Dienst · Frühblock"):
            note = ""
        v["note"] = note
    anzahl: dict = {}
    for v in ergebnis.get("suggestions") or []:
        anzahl[v["driver_id"]] = anzahl.get(v["driver_id"], 0) + 1
    for v in ergebnis.get("suggestions") or []:
        if anzahl.get(v["driver_id"], 0) > 1:
            label = "Spätblock" if v["split_block"] == "late" else "Frühblock"
            praefix = f"Geteilter Dienst · {label}"
            v["note"] = f"{praefix} — {v['note']}" if v["note"] else praefix
    ergebnis["suggestions"].sort(key=lambda e: (str(e.get("service_start") or ""), str(e.get("driver_name") or "")))
    for plan in ergebnis.get("vehicle_plans") or []:
        roh = str(plan.get("driver_id") or "")
        spaet = roh.endswith(SPLIT_SUFFIX)
        basis = roh[: -len(SPLIT_SUFFIX)] if spaet else roh
        if basis in bloecke:
            neu, bleibt_spaet = ziel_fuer(basis, "late" if spaet else None)
            plan["driver_id"] = neu + (SPLIT_SUFFIX if bleibt_spaet else "")
    getauscht = sum(1 for schluessel, _, _, _, _ in einheiten if zuordnung[schluessel] != schluessel.split("|")[0])

    with open(ausgabe_pfad, "w", encoding="utf-8") as datei:
        json.dump(ergebnis, datei)
    ruhe = sum(1 for f in fahrer if f.earliest_start_minute is not None or f.latest_end_minute is not None)
    print(f"abgeleitet: {len(bloecke)} Fahrer mit Diensten, {ruhe} mit Ruhezeitfenster, {getauscht} Dienste umgesetzt, {len(getrennt)} geteilte Dienste getrennt")


if __name__ == "__main__":
    main()
