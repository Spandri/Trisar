"""
KI-Vorstufe der Einsatzplanung: baut den Suchkorridor ("Tunnel") für CP-SAT.

Das Vollmodell wächst mit Fahrer x Fahrten^2 (Messetag: >700.000 Verkettungs-
variablen) — daran scheitert nicht die Lösungsqualität, sondern die
Beweisbarkeit: CP-SAT findet in vertretbarer Zeit keine untere Schranke mehr.

Der Tunnel löst das, indem eine schnelle Vorstufe den Suchraum absteckt:

1. Ensemble diverser Planungsläufe (deterministischer Greedy + randomisierte
   Varianten): jede dort je vorkommende Fahrer-Fahrt-Zuordnung und jede
   Fahrt-zu-Fahrt-Verkettung ist ein Kandidat.
2. Nachbarschafts-Scoring als Grundabdeckung: je Fahrt die K naechstgelegenen
   Fahrer (kuerzeste Anfahrt) und die K besten Vor-/Nachfolgefahrten
   (kuerzeste Wartezeit) — damit auch Fahrten Kandidaten haben, die das
   Ensemble nie zuweist.

CP-SAT optimiert innerhalb des Korridors vollwertig (inkl. Guete-Kriterium).
Weil der Korridor die komplette Greedy-Loesung enthaelt, startet der Solver
mit ihr als Incumbent und kann nur besser werden. Erreicht er das Gueteziel
im engen Korridor nicht, weitet die Aufrufschicht den Korridor auf und loest
erneut (siehe api_server).

Die Vorstufe ist bewusst austauschbar: heute ein Heuristik-Ensemble, spaeter
ein gelerntes Modell, das aus historischen Plaenen bessere Kandidaten
vorhersagt — die Solver-Schnittstelle (TunnelCorridor) bleibt gleich.
"""

from __future__ import annotations

import random
from dataclasses import dataclass
from typing import Dict, List, Set, Tuple

from optimizer.driver_schedule_solver import (
    Driver,
    Ride,
    TunnelCorridor,
    ZoneMatrix,
    _greedy_schedule,
    _is_connection_feasible,
    _minutes_from_day_start,
    _resolve_planning_day,
)


@dataclass(frozen=True)
class TunnelStats:
    """Kennzahlen fuer Anzeige und Logging."""

    ride_count: int
    driver_count: int
    full_arc_pairs: int
    tunnel_arc_pairs: int
    avg_driver_candidates: float
    ensemble_runs: int

    def to_dict(self) -> Dict[str, object]:
        return {
            "ride_count": self.ride_count,
            "driver_count": self.driver_count,
            "full_arc_pairs": self.full_arc_pairs,
            "tunnel_arc_pairs": self.tunnel_arc_pairs,
            "avg_driver_candidates": round(self.avg_driver_candidates, 1),
            "ensemble_runs": self.ensemble_runs,
        }


def build_tunnel(
    rides: List[Ride],
    drivers: List[Driver],
    zone_matrix: ZoneMatrix,
    *,
    k_drivers: int = 12,
    k_neighbors: int = 8,
    ensemble_runs: int = 16,
    max_chain_gap_minutes: int = 240,
    seed: int = 20260822,
) -> Tuple[TunnelCorridor, TunnelStats]:
    """
    Baut den Suchkorridor. `k_drivers`/`k_neighbors` steuern die Breite
    (Aufweitung = groessere K), `ensemble_runs` die Diversitaet der Vorstufe.
    Deterministisch geseedet, damit gleiche Eingaben denselben Korridor
    ergeben (Reproduzierbarkeit der Demo).
    """
    planning_day = _resolve_planning_day(rides, None)
    rides_sorted = sorted(rides, key=lambda r: r.start_time)
    r_count = len(rides_sorted)

    ride_start_min = [_minutes_from_day_start(planning_day, r.start_time) for r in rides_sorted]
    ride_end_min = [_minutes_from_day_start(planning_day, r.end_time) for r in rides_sorted]
    ride_pre_buffer = [int(r.pre_buffer_minutes) for r in rides_sorted]

    driver_cands: Dict[str, Set[str]] = {r.ride_id: set() for r in rides_sorted}
    pair_cands: Set[Tuple[str, str]] = set()

    # --- Stufe 1: Loesungs-Ensemble.
    # Lauf 0 ist der deterministische Greedy — identisch mit dem Warm-Start im
    # Solver, damit dessen Hint garantiert vollstaendig im Korridor liegt.
    rng = random.Random(seed)
    for run in range(max(1, ensemble_runs)):
        run_rng = None if run == 0 else random.Random(rng.randrange(1 << 30))
        chains = _greedy_schedule(
            rides_sorted, drivers, zone_matrix,
            ride_start_min, ride_end_min, ride_pre_buffer,
            rng=run_rng,
        )
        for d, chain in chains.items():
            driver_id = drivers[d].driver_id
            for i in chain:
                driver_cands[rides_sorted[i].ride_id].add(driver_id)
            for pos in range(len(chain) - 1):
                pair_cands.add((rides_sorted[chain[pos]].ride_id, rides_sorted[chain[pos + 1]].ride_id))

    # --- Stufe 2: Nachbarschafts-Grundabdeckung.
    # K naechstgelegene Fahrer je Fahrt (VIP-Regel beachtet).
    for i, ride in enumerate(rides_sorted):
        scored = []
        for drv in drivers:
            if ride.is_vip_ride and not drv.is_vip_qualified:
                continue
            scored.append((zone_matrix.minutes(drv.start_zone, ride.start_zone), drv.driver_id))
        scored.sort()
        for _, driver_id in scored[:k_drivers]:
            driver_cands[ride.ride_id].add(driver_id)

    # K beste Nachfolger UND K beste Vorgaenger je Fahrt, damit keine Fahrt
    # ohne ein- oder ausgehende Verkettungskandidaten bleibt.
    successors: Dict[int, List[Tuple[int, int]]] = {i: [] for i in range(r_count)}
    predecessors: Dict[int, List[Tuple[int, int]]] = {i: [] for i in range(r_count)}
    for i in range(r_count):
        for j in range(r_count):
            if i == j:
                continue
            gap = ride_start_min[j] - ride_end_min[i]
            if gap < 0 or (max_chain_gap_minutes > 0 and gap > max_chain_gap_minutes):
                continue
            if not _is_connection_feasible(
                ride_end_min[i], rides_sorted[i].end_zone,
                ride_start_min[j], rides_sorted[j].start_zone,
                ride_pre_buffer[j], zone_matrix,
                ride_i_post_buffer_min=rides_sorted[i].post_buffer_minutes,
            ):
                continue
            transfer = zone_matrix.minutes(rides_sorted[i].end_zone, rides_sorted[j].start_zone)
            wait = (
                ride_start_min[j] - ride_end_min[i]
                - rides_sorted[i].post_buffer_minutes - transfer - ride_pre_buffer[j]
            )
            successors[i].append((wait, j))
            predecessors[j].append((wait, i))

    full_arc_pairs = sum(len(v) for v in successors.values())
    for i in range(r_count):
        successors[i].sort()
        predecessors[i].sort()
        for _, j in successors[i][:k_neighbors]:
            pair_cands.add((rides_sorted[i].ride_id, rides_sorted[j].ride_id))
        for _, j in predecessors[i][:k_neighbors]:
            pair_cands.add((rides_sorted[j].ride_id, rides_sorted[i].ride_id))

    corridor = TunnelCorridor(
        driver_ids_by_ride={rid: frozenset(cands) for rid, cands in driver_cands.items()},
        successor_pairs=frozenset(pair_cands),
    )
    stats = TunnelStats(
        ride_count=r_count,
        driver_count=len(drivers),
        full_arc_pairs=full_arc_pairs,
        tunnel_arc_pairs=len(pair_cands),
        avg_driver_candidates=(
            sum(len(v) for v in driver_cands.values()) / max(1, r_count)
        ),
        ensemble_runs=max(1, ensemble_runs),
    )
    return corridor, stats
