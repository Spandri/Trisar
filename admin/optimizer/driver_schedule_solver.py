"""
Driver schedule optimizer (24h batch planning) using Google OR-Tools CP-SAT.

This module models chauffeur shuttle planning with:
- hard constraints (time conflicts, VIP eligibility, max/min shift hours),
- soft constraints (idle-time compression, fairness balancing, service slack),
- explicit unassigned handling through high penalties (dummy-driver equivalent).

Important assumptions (made explicit for implementation clarity):
1) Fairness is modeled as pairwise absolute differences of total hours
   (historical + planned), which is a linear approximation of variance.
2) EV range is currently a hook only. Without distance/charging events, no hard EV
   charging constraints are enforced.
3) Work-time accounting is shift span (first ride start -> last ride end) plus
   deadhead from driver start-zone to first ride and deadhead from last ride
   back to driver end-zone.
"""

from __future__ import annotations

import hashlib
import random

from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta
from typing import Dict, Iterable, List, Literal, Optional, Tuple

try:
    from ortools.sat.python import cp_model
except ImportError as exc:  # pragma: no cover - import-time guidance
    raise ImportError(
        "Google OR-Tools is required. Install with: pip install ortools"
    ) from exc


PoiType = Literal["Airport", "Hotel", "Private"]
Mode = Literal["balanced", "cost", "fairness", "service_level"]

POI_BUFFER_MINUTES: Dict[PoiType, int] = {
    # Flughafenabholung: Ankunft zur Landung genuegt, den Terminalweg deckt
    # der einstellbare Extra-Puffer. Das eigentliche Risiko (Gast kommt durch
    # Gepaeck/Passkontrolle SPAETER raus) liegt HINTER der Abholung und wird
    # ueber AIRPORT_POST_DELAY_MINUTES vor der Folgefahrt eingeplant.
    "Airport": 0,
    "Hotel": 15,
    "Private": 5,
}

# Verspaetungsreserve nach einer Flughafenabholung: die Folgefahrt darf erst
# so spaet beginnen, dass ein verspaetet eintreffender Gast die Kette nicht
# sprengt. Wirkt nur auf die Verkettung, nicht auf Fahrt- oder Schichtdauer.
AIRPORT_POST_DELAY_MINUTES = 20


@dataclass(frozen=True)
class Driver:
    driver_id: str
    is_vip_qualified: bool
    historical_worked_hours: float
    availability_max_hours: float
    legal_max_hours: float
    min_shift_hours: float
    start_zone: str
    end_zone: str
    is_ev: bool = False
    ev_range_km: float = 0.0
    # Ruhezeitfenster über Tagesgrenzen hinweg: frühester Schichtbeginn bzw.
    # spätestes Schichtende in Minuten seit 00:00 des Planungstags. Ergibt sich
    # aus der Schicht des Vortags (+ Ruhezeit) und der Schicht des Folgetags
    # (− Ruhezeit). None = keine Einschränkung.
    earliest_start_minute: Optional[int] = None
    latest_end_minute: Optional[int] = None

    @property
    def hard_max_hours(self) -> float:
        return min(self.availability_max_hours, self.legal_max_hours)

    @property
    def is_availability_limited(self) -> bool:
        # As requested: drivers limited by personal availability can be excluded
        # from fairness penalty terms.
        return self.availability_max_hours + 1e-9 < self.legal_max_hours


@dataclass(frozen=True)
class Ride:
    ride_id: str
    start_time: datetime
    duration_minutes: int
    start_poi_type: PoiType
    is_vip_ride: bool
    start_zone: str
    end_zone: str
    # Globaler Zuschlag aus den Planungseinstellungen (Dispo-Puffer), der auf
    # den POI-Puffer addiert wird.
    extra_buffer_minutes: int = 0
    # Klartext-Orte fuer die echte Distanztabelle (Zonen sind zu grob, um
    # Kilometer realistisch zu schaetzen).
    start_place: str = ""
    end_place: str = ""
    # Adressen fuer die Geokodierung der Leerfahrten (verkehr.py).
    start_address: str = ""
    end_address: str = ""

    @property
    def end_time(self) -> datetime:
        return self.start_time + timedelta(minutes=self.duration_minutes)

    @property
    def pre_buffer_minutes(self) -> int:
        base = POI_BUFFER_MINUTES.get(self.start_poi_type, POI_BUFFER_MINUTES["Private"])
        return base + max(0, int(self.extra_buffer_minutes))

    @property
    def post_buffer_minutes(self) -> int:
        # Reserve fuer verspaetete Gaeste nach einer Flughafenabholung.
        return AIRPORT_POST_DELAY_MINUTES if self.start_poi_type == "Airport" else 0


@dataclass(frozen=True)
class ZoneMatrix:
    """
    Stores zone-to-zone transfer (setup/travel) minutes.
    """

    travel_minutes: Dict[Tuple[str, str], int]
    default_between_distinct_zones: int = 30

    def minutes(self, from_zone: str, to_zone: str) -> int:
        if from_zone == to_zone:
            return 0
        direct = self.travel_minutes.get((from_zone, to_zone))
        if direct is not None:
            return max(0, int(direct))
        reverse = self.travel_minutes.get((to_zone, from_zone))
        if reverse is not None:
            return max(0, int(reverse))
        return max(0, int(self.default_between_distinct_zones))


@dataclass(frozen=True)
class SolverWeights:
    # Hardly ever changed per run, but useful for offline tuning.
    unassigned_ride: int = 1_000_000
    active_driver: int = 8_000
    idle_minute: int = 20
    fairness_pair_abs_minute: int = 10
    service_slack_minute_reward: int = 0
    # Empty/deadhead driving minutes (driver start -> first pickup, transfers
    # between chained rides, last dropoff -> driver end zone). Weighted higher
    # than idle: an empty-driving minute costs fuel/wear on top of paid time.
    deadhead_minute: int = 30


MODE_WEIGHTS: Dict[Mode, SolverWeights] = {
    "balanced": SolverWeights(
        unassigned_ride=1_000_000,
        active_driver=8_000,
        idle_minute=20,
        # Ausgewogen heisst: alle arbeiten etwa gleich lang. Die Spreizung der
        # Arbeitszeiten wiegt deshalb spuerbar, ist aber keine harte Grenze.
        fairness_pair_abs_minute=40,
        service_slack_minute_reward=0,
        deadhead_minute=30,
    ),
    "cost": SolverWeights(
        unassigned_ride=1_000_000,
        active_driver=20_000,
        idle_minute=50,
        fairness_pair_abs_minute=2,
        service_slack_minute_reward=0,
        deadhead_minute=60,
    ),
    "fairness": SolverWeights(
        unassigned_ride=1_000_000,
        active_driver=1_000,
        idle_minute=8,
        fairness_pair_abs_minute=80,
        service_slack_minute_reward=0,
        deadhead_minute=15,
    ),
    "service_level": SolverWeights(
        unassigned_ride=1_000_000,
        active_driver=5_000,
        idle_minute=2,
        fairness_pair_abs_minute=5,
        service_slack_minute_reward=15,
        deadhead_minute=20,
    ),
}


@dataclass(frozen=True)
class TunnelCorridor:
    """
    Suchkorridor ("Tunnel") einer KI-Vorstufe: je Fahrt die plausiblen Fahrer,
    je Fahrtpaar die plausiblen Verkettungen. Der Solver erzeugt Variablen nur
    innerhalb des Korridors und optimiert dort vollwertig — der Korridor macht
    das Modell klein, nicht die Lösung schlechter (er enthält per Konstruktion
    die komplette Startlösung des Ensembles, das Ergebnis kann also nie hinter
    diese zurückfallen).

    Alles auf ID-Basis (nicht Index), damit die Sortierreihenfolge der Fahrten
    im Solver keine Rolle spielt.
    """

    driver_ids_by_ride: Dict[str, frozenset] = field(default_factory=dict)
    successor_pairs: frozenset = frozenset()

    def allows_assignment(self, driver_id: str, ride_id: str) -> bool:
        candidates = self.driver_ids_by_ride.get(ride_id)
        # Fahrt ohne Kandidatenliste bleibt uneingeschränkt (defensiv).
        return candidates is None or driver_id in candidates

    def allows_pair(self, ride_id_a: str, ride_id_b: str) -> bool:
        return (ride_id_a, ride_id_b) in self.successor_pairs


@dataclass(frozen=True)
class SolverConfig:
    mode: Mode = "balanced"
    weights_override: Optional[SolverWeights] = None
    # Abbruch nach Lösungsgüte, nicht nach Zeit: der Solver stoppt, sobald die
    # gefundene Lösung nachweislich höchstens `relative_gap_limit` vom Optimum
    # entfernt ist (0.0 = bis beweisbar optimal).
    relative_gap_limit: float = 0.0
    # Reines Sicherheitsnetz gegen Endlosläufe — kein Qualitätsregler.
    max_solver_time_seconds: float = 300.0
    num_search_workers: int = 8
    planning_day: Optional[date] = None
    # If True, return inactive drivers as well (with empty rides).
    include_inactive_drivers_in_output: bool = False
    # Arc pruning: skip chain arcs (i -> j) whose idle gap between ride i end
    # and ride j start exceeds this many minutes. Such arcs are practically
    # never chosen (idle penalty) but dominate model size, which grows with
    # drivers x rides^2. Set to 0 or negative to disable pruning.
    max_chain_gap_minutes: int = 240
    # Warm start: seed CP-SAT with a greedy feasible schedule via AddHint.
    use_warm_start_hint: bool = True
    # KI-Korridor: beschränkt Zuweisungs- und Verkettungsvariablen auf die von
    # der Vorstufe als plausibel markierten Kandidaten. None = Vollmodell.
    tunnel: Optional[TunnelCorridor] = None
    # Geteilte Dienste: Index-Paare (a, b) in der Fahrerliste, die zwei
    # Arbeitsblöcke DESSELBEN Fahrers darstellen (a = Frühblock, b = Spätblock).
    # Zwischen den Blöcken liegt eine unbezahlte Pause von mindestens
    # `min_split_pause_minutes`; die Summe beider Blöcke respektiert das
    # Tagesmaximum des Fahrers.
    split_driver_pairs: Tuple[Tuple[int, int], ...] = ()
    min_split_pause_minutes: int = 180
    # Bereitschaft als lineare Untergrenzen statt Max-Gleichung (bessere Schranke).
    standby_linear: bool = True
    # Gleichwertige Fahrer in fester, je Tag wechselnder Reihenfolge einsetzen
    # (Symmetriebruch, nur ohne KI-Korridor).
    symmetry_breaking: bool = True
    # Fairness: "spanne" = laengster minus kuerzester Dienst (global, schwer zu
    # beweisen); "ziel" = Abweichung jedes Fahrers von einer Zielarbeitszeit,
    # die die Vorstufe aus einem schnellen Vorplan und den Vorstunden ableitet.
    fairness_mode: str = "spanne"
    # Stellschrauben der Zielvorgabe: Hoehe (Anteil am Vorplan-Mittel) und
    # Gewichte (Teiler des Fairness-Gewichts) fuer Abweichung und Spanne.
    fairness_target_scale: float = 1.0
    fairness_dev_div: int = 4
    fairness_spread_div: int = 4

    @property
    def weights(self) -> SolverWeights:
        return self.weights_override or MODE_WEIGHTS[self.mode]


@dataclass
class DriverAssignment:
    driver_id: str
    ride_ids: List[str]
    shift_start: Optional[datetime]
    shift_end: Optional[datetime]
    planned_hours: float
    idle_minutes: int
    note: str = ""
    deadhead_minutes: int = 0

    def to_dict(self) -> Dict[str, object]:
        return {
            "driver_id": self.driver_id,
            "ride_ids": self.ride_ids,
            "shift_start": self.shift_start.isoformat() if self.shift_start else None,
            "shift_end": self.shift_end.isoformat() if self.shift_end else None,
            "planned_hours": round(self.planned_hours, 2),
            "idle_minutes": int(self.idle_minutes),
            "deadhead_minutes": int(self.deadhead_minutes),
            "note": self.note,
        }


@dataclass
class PlanKpis:
    total_planned_hours: float
    active_driver_count: int
    unassigned_ride_count: int
    fairness_score_hours_abs_avg: float
    objective_value: float
    # Solution quality reporting: proven lower bound and relative gap.
    # gap = (objective - bound) / objective; 0.0 means proven optimal.
    best_objective_bound: float = 0.0
    optimality_gap: Optional[float] = None
    solver_status: str = ""
    solver_wall_time_seconds: float = 0.0
    total_deadhead_minutes: int = 0

    def to_dict(self) -> Dict[str, object]:
        return {
            "total_planned_hours": round(self.total_planned_hours, 2),
            "active_driver_count": int(self.active_driver_count),
            "unassigned_ride_count": int(self.unassigned_ride_count),
            "fairness_score_hours_abs_avg": round(self.fairness_score_hours_abs_avg, 4),
            "objective_value": float(self.objective_value),
            "best_objective_bound": float(self.best_objective_bound),
            "optimality_gap": round(self.optimality_gap, 4) if self.optimality_gap is not None else None,
            "solver_status": self.solver_status,
            "solver_wall_time_seconds": round(self.solver_wall_time_seconds, 2),
            "total_deadhead_minutes": int(self.total_deadhead_minutes),
        }


@dataclass
class ScheduleResult:
    assignments: List[DriverAssignment]
    unassigned_ride_ids: List[str]
    warnings: List[str]
    kpis: PlanKpis

    def to_dict(self) -> Dict[str, object]:
        return {
            "assignments": [a.to_dict() for a in self.assignments],
            "unassigned_ride_ids": self.unassigned_ride_ids,
            "warnings": self.warnings,
            "kpis": self.kpis.to_dict(),
        }


def _resolve_planning_day(rides: Iterable[Ride], explicit_day: Optional[date]) -> date:
    if explicit_day is not None:
        return explicit_day
    starts = sorted([r.start_time for r in rides])
    if starts:
        return starts[0].date()
    return datetime.utcnow().date()


def _minutes_from_day_start(day: date, dt: datetime) -> int:
    day_start = datetime.combine(day, time.min, tzinfo=dt.tzinfo)
    delta = dt - day_start
    return int(delta.total_seconds() // 60)


def _is_connection_feasible(
    ride_i_end_min: int,
    ride_i_end_zone: str,
    ride_j_start_min: int,
    ride_j_start_zone: str,
    ride_j_pre_buffer_min: int,
    zone_matrix: ZoneMatrix,
    ride_i_post_buffer_min: int = 0,
) -> bool:
    transfer = zone_matrix.minutes(ride_i_end_zone, ride_j_start_zone)
    required = ride_i_end_min + ride_i_post_buffer_min + transfer + ride_j_pre_buffer_min
    return required <= ride_j_start_min


def _safe_int_minutes(hours: float) -> int:
    return max(0, int(round(hours * 60)))


def _greedy_schedule(
    rides_sorted: List[Ride],
    drivers: List[Driver],
    zone_matrix: ZoneMatrix,
    ride_start_min: List[int],
    ride_end_min: List[int],
    ride_pre_buffer: List[int],
    rng: Optional[random.Random] = None,
) -> Dict[int, List[int]]:
    """
    Fast feasible schedule for warm starting: rides in start-time order, each
    assigned to the eligible driver with the smallest waiting time. Respects
    the same hard rules as the CP model (VIP eligibility, connection
    feasibility, hard max shift span incl. deadheads).
    With `rng`, picks among the top-3 candidates instead of strictly the best —
    the tunnel guide uses this to generate a diverse solution ensemble.
    Returns {driver_index: [ride_indices in chain order]}.
    """
    chains: Dict[int, List[int]] = {d: [] for d in range(len(drivers))}
    for i in range(len(rides_sorted)):
        ride = rides_sorted[i]
        candidates: List[Tuple[int, int]] = []  # (wait_minutes, driver_index)
        for d, drv in enumerate(drivers):
            if ride.is_vip_ride and not drv.is_vip_qualified:
                continue
            chain = chains[d]
            if chain:
                last = chain[-1]
                if not _is_connection_feasible(
                    ride_end_min[last], rides_sorted[last].end_zone,
                    ride_start_min[i], ride.start_zone,
                    ride_pre_buffer[i], zone_matrix,
                    ride_i_post_buffer_min=rides_sorted[last].post_buffer_minutes,
                ):
                    continue
                transfer = zone_matrix.minutes(rides_sorted[last].end_zone, ride.start_zone)
                wait = (
                    ride_start_min[i] - ride_end_min[last]
                    - rides_sorted[last].post_buffer_minutes - transfer - ride_pre_buffer[i]
                )
                first = chain[0]
                span = (
                    ride_end_min[i] - ride_start_min[first]
                    + zone_matrix.minutes(drv.start_zone, rides_sorted[first].start_zone)
                    + ride_pre_buffer[first]
                    + zone_matrix.minutes(ride.end_zone, drv.end_zone)
                )
            else:
                wait = zone_matrix.minutes(drv.start_zone, ride.start_zone)
                span = (
                    ride_end_min[i] - ride_start_min[i]
                    + zone_matrix.minutes(drv.start_zone, ride.start_zone)
                    + ride_pre_buffer[i]
                    + zone_matrix.minutes(ride.end_zone, drv.end_zone)
                )
            if span > _safe_int_minutes(drv.hard_max_hours):
                continue
            candidates.append((wait, d))
        if candidates:
            candidates.sort()
            if rng is not None and len(candidates) > 1:
                pick = rng.choice(candidates[:3])
            else:
                pick = candidates[0]
            chains[pick[1]].append(i)
    return chains


def solve_schedule(
    rides: List[Ride],
    drivers: List[Driver],
    zone_matrix: ZoneMatrix,
    mode: Mode = "balanced",
    config: Optional[SolverConfig] = None,
) -> ScheduleResult:
    """
    Build and solve the schedule optimization model.

    Parameters
    ----------
    rides:
      Ride list for the planning batch.
    drivers:
      Driver list (each with fixed vehicle capabilities/properties).
    zone_matrix:
      Zone transfer/setup time matrix in minutes.
    mode:
      "cost", "fairness", "service_level", or "balanced".
    config:
      Optional solver/runtime config.
    """

    cfg = config or SolverConfig(mode=mode)
    if cfg.mode != mode:
        # Keep mode explicit if passed twice with different values.
        cfg = SolverConfig(
            mode=mode,
            weights_override=cfg.weights_override,
            max_solver_time_seconds=cfg.max_solver_time_seconds,
            relative_gap_limit=cfg.relative_gap_limit,
            num_search_workers=cfg.num_search_workers,
            planning_day=cfg.planning_day,
            include_inactive_drivers_in_output=cfg.include_inactive_drivers_in_output,
            max_chain_gap_minutes=cfg.max_chain_gap_minutes,
            use_warm_start_hint=cfg.use_warm_start_hint,
            tunnel=cfg.tunnel,
            split_driver_pairs=cfg.split_driver_pairs,
            min_split_pause_minutes=cfg.min_split_pause_minutes,
            standby_linear=cfg.standby_linear,
            symmetry_breaking=cfg.symmetry_breaking,
            fairness_mode=cfg.fairness_mode,
            fairness_target_scale=cfg.fairness_target_scale,
            fairness_dev_div=cfg.fairness_dev_div,
            fairness_spread_div=cfg.fairness_spread_div,
        )
    weights = cfg.weights

    planning_day = _resolve_planning_day(rides, cfg.planning_day)
    rides_sorted = sorted(rides, key=lambda r: r.start_time)
    d_count = len(drivers)
    r_count = len(rides_sorted)

    if d_count == 0:
        # No real drivers -> everything unassigned, no solver needed.
        return ScheduleResult(
            assignments=[],
            unassigned_ride_ids=[r.ride_id for r in rides_sorted],
            warnings=["No drivers available; all rides marked unassigned."],
            kpis=PlanKpis(
                total_planned_hours=0.0,
                active_driver_count=0,
                unassigned_ride_count=r_count,
                fairness_score_hours_abs_avg=0.0,
                objective_value=float(r_count * weights.unassigned_ride),
            ),
        )

    ride_start_min = [_minutes_from_day_start(planning_day, r.start_time) for r in rides_sorted]
    ride_end_min = [_minutes_from_day_start(planning_day, r.end_time) for r in rides_sorted]
    ride_pre_buffer = [int(r.pre_buffer_minutes) for r in rides_sorted]

    horizon = max(1, max(ride_end_min, default=0) + 300)
    model = cp_model.CpModel()

    # Decision variables:
    # - x[d,i]: driver d serves ride i.
    # - u[i]: ride i unassigned (dummy-driver equivalent with huge penalty).
    # - use[d]: driver d is active.
    # - y_source[d,i]: ride i is first ride in driver d's route.
    # - y_sink[d,i]: ride i is last ride in driver d's route.
    # - y_arc[d,i,j]: ride i followed by ride j for driver d.
    x: Dict[Tuple[int, int], cp_model.IntVar] = {}
    u: Dict[int, cp_model.IntVar] = {}
    use: Dict[int, cp_model.IntVar] = {}
    y_source: Dict[Tuple[int, int], cp_model.IntVar] = {}
    y_sink: Dict[Tuple[int, int], cp_model.IntVar] = {}
    y_arc: Dict[Tuple[int, int, int], cp_model.IntVar] = {}

    for i in range(r_count):
        u[i] = model.NewBoolVar(f"u_{i}")

    for d, drv in enumerate(drivers):
        use[d] = model.NewBoolVar(f"use_{d}")
        for i, ride in enumerate(rides_sorted):
            eligible = not (ride.is_vip_ride and not drv.is_vip_qualified)

            # Ruhezeit über Tagesgrenzen: Eine Fahrt kommt für den Fahrer nur
            # infrage, wenn Anfahrt und Rückweg vollständig in sein Fenster
            # passen. Wer gestern bis spät gefahren ist, startet heute später.
            if eligible and drv.earliest_start_minute is not None:
                approach = zone_matrix.minutes(drv.start_zone, ride.start_zone) + ride_pre_buffer[i]
                if ride_start_min[i] - approach < int(drv.earliest_start_minute):
                    eligible = False
            if eligible and drv.latest_end_minute is not None:
                return_leg = zone_matrix.minutes(ride.end_zone, drv.end_zone)
                if ride_end_min[i] + return_leg > int(drv.latest_end_minute):
                    eligible = False

            # KI-Korridor: Fahrer außerhalb der Kandidatenliste dieser Fahrt
            # kommen nicht ins Modell (Fahrt kann weiterhin unassigned bleiben,
            # das Modell wird dadurch nie unlösbar).
            if eligible and cfg.tunnel is not None:
                if not cfg.tunnel.allows_assignment(drv.driver_id, ride.ride_id):
                    eligible = False

            x[(d, i)] = model.NewBoolVar(f"x_{d}_{i}")
            if not eligible:
                model.Add(x[(d, i)] == 0)
                continue

            y_source[(d, i)] = model.NewBoolVar(f"ys_{d}_{i}")
            y_sink[(d, i)] = model.NewBoolVar(f"yt_{d}_{i}")

        for i, ri in enumerate(rides_sorted):
            if (d, i) not in y_source:
                continue
            for j, rj in enumerate(rides_sorted):
                if i == j:
                    continue
                if (d, j) not in y_source:
                    continue
                if (
                    cfg.max_chain_gap_minutes > 0
                    and ride_start_min[j] - ride_end_min[i] > cfg.max_chain_gap_minutes
                ):
                    continue
                if cfg.tunnel is not None and not cfg.tunnel.allows_pair(ri.ride_id, rj.ride_id):
                    continue
                if _is_connection_feasible(
                    ride_i_end_min=ride_end_min[i],
                    ride_i_end_zone=ri.end_zone,
                    ride_j_start_min=ride_start_min[j],
                    ride_j_start_zone=rj.start_zone,
                    ride_j_pre_buffer_min=ride_pre_buffer[j],
                    zone_matrix=zone_matrix,
                    ride_i_post_buffer_min=ri.post_buffer_minutes,
                ):
                    y_arc[(d, i, j)] = model.NewBoolVar(f"ya_{d}_{i}_{j}")

    # Every ride must either be assigned to exactly one real driver or be unassigned.
    for i in range(r_count):
        model.Add(sum(x[(d, i)] for d in range(d_count)) + u[i] == 1)

    planned_minutes: Dict[int, cp_model.IntVar] = {}
    # Bezahlte Dienstzeit: gefahrene Zeit, mindestens aber der Mindestdienst —
    # die Luecke ist Bereitschaft (der Fahrer steht bereit, faehrt aber nicht).
    paid_minutes: Dict[int, cp_model.IntVar] = {}
    standby_expr_terms: List[cp_model.LinearExpr] = []
    first_start_by_driver: Dict[int, cp_model.LinearExpr] = {}
    last_end_by_driver: Dict[int, cp_model.LinearExpr] = {}
    idle_minutes_expr_terms: List[cp_model.LinearExpr] = []
    service_slack_expr_terms: List[cp_model.LinearExpr] = []
    deadhead_expr_terms: List[cp_model.LinearExpr] = []

    for d, drv in enumerate(drivers):
        # Flow constraints per ride node.
        for i in range(r_count):
            if (d, i) not in y_source:
                continue

            incoming_terms = [y_source[(d, i)]]
            outgoing_terms = [y_sink[(d, i)]]
            for j in range(r_count):
                if (d, j, i) in y_arc:
                    incoming_terms.append(y_arc[(d, j, i)])
                if (d, i, j) in y_arc:
                    outgoing_terms.append(y_arc[(d, i, j)])

            model.Add(sum(incoming_terms) == x[(d, i)])
            model.Add(sum(outgoing_terms) == x[(d, i)])

        # Activate driver iff exactly one route starts/ends.
        src_terms = [y_source[(d, i)] for i in range(r_count) if (d, i) in y_source]
        sink_terms = [y_sink[(d, i)] for i in range(r_count) if (d, i) in y_sink]
        if src_terms:
            model.Add(sum(src_terms) == use[d])
            model.Add(sum(sink_terms) == use[d])
        else:
            model.Add(use[d] == 0)

        # Planned work minutes:
        # shift_span = last_ride_end - first_ride_start
        # plus deadhead to first ride and from last ride back to end-zone.
        first_start_expr = sum(
            y_source[(d, i)] * ride_start_min[i] for i in range(r_count) if (d, i) in y_source
        )
        last_end_expr = sum(
            y_sink[(d, i)] * ride_end_min[i] for i in range(r_count) if (d, i) in y_sink
        )
        first_start_by_driver[d] = first_start_expr
        last_end_by_driver[d] = last_end_expr
        shift_span = model.NewIntVar(0, horizon, f"shift_span_{d}")
        model.Add(shift_span == last_end_expr - first_start_expr)

        pre_deadhead_expr = sum(
            y_source[(d, i)]
            * (zone_matrix.minutes(drv.start_zone, rides_sorted[i].start_zone) + ride_pre_buffer[i])
            for i in range(r_count)
            if (d, i) in y_source
        )
        post_deadhead_expr = sum(
            y_sink[(d, i)] * zone_matrix.minutes(rides_sorted[i].end_zone, drv.end_zone)
            for i in range(r_count)
            if (d, i) in y_sink
        )

        planned = model.NewIntVar(0, horizon * 2, f"planned_{d}")
        model.Add(planned == shift_span + pre_deadhead_expr + post_deadhead_expr)
        planned_minutes[d] = planned

        # Deadhead (empty driving) minutes for the objective: pure drive time
        # without waiting buffers -- start-zone approach, inter-ride transfers,
        # and return to end zone.
        deadhead_expr_terms.append(sum(
            y_source[(d, i)] * zone_matrix.minutes(drv.start_zone, rides_sorted[i].start_zone)
            for i in range(r_count) if (d, i) in y_source
        ))
        deadhead_expr_terms.append(post_deadhead_expr)
        for i in range(r_count):
            for j in range(r_count):
                key = (d, i, j)
                if key not in y_arc:
                    continue
                transfer = zone_matrix.minutes(rides_sorted[i].end_zone, rides_sorted[j].start_zone)
                if transfer > 0:
                    deadhead_expr_terms.append(y_arc[key] * transfer)

        max_allowed = _safe_int_minutes(drv.hard_max_hours)
        min_if_used = _safe_int_minutes(drv.min_shift_hours)
        model.Add(planned <= max_allowed)
        # Mindestdienst darf mit Bereitschaft aufgefuellt werden: ein kurzer
        # Einsatz ist zulaessig, bezahlt wird aber mindestens der Mindestdienst.
        # Bereitschaft als eigene, nie negative Groesse: sie fuellt den
        # Mindestdienst auf. So bleiben alle Kosten im Ziel positiv — sonst
        # rutscht die untere Schranke des Solvers weit ins Minus und die
        # Guete laesst sich nicht mehr beweisen.
        standby = model.NewIntVar(0, max(0, min_if_used), f"standby_{d}")
        model.Add(standby >= min_if_used * use[d] - planned)
        paid = model.NewIntVar(0, horizon * 2 + min_if_used, f"paid_{d}")
        model.Add(paid == planned + standby)
        model.Add(paid <= max(max_allowed, min_if_used))
        paid_minutes[d] = paid
        standby_expr_terms.append(standby)

        # Idle/slack between rides:
        # idle(i,j) = start_j - end_i - transfer(i->j) - pre_buffer(j), for selected arcs.
        for i in range(r_count):
            for j in range(r_count):
                key = (d, i, j)
                if key not in y_arc:
                    continue
                transfer = zone_matrix.minutes(rides_sorted[i].end_zone, rides_sorted[j].start_zone)
                idle_ij = (
                    ride_start_min[j] - ride_end_min[i]
                    - rides_sorted[i].post_buffer_minutes - transfer - ride_pre_buffer[j]
                )
                idle_ij = max(0, int(idle_ij))
                if idle_ij > 0:
                    idle_minutes_expr_terms.append(y_arc[key] * idle_ij)
                    service_slack_expr_terms.append(y_arc[key] * idle_ij)

    # Geteilte Dienste: Block b desselben Fahrers beginnt fruehestens
    # `min_split_pause_minutes` nach dem Ende von Block a; beide Bloecke
    # zusammen respektieren das Tagesmaximum. Block b nur, wenn Block a
    # ueberhaupt stattfindet (bricht Symmetrie und haelt die Suche klein).
    for (a, b) in cfg.split_driver_pairs:
        if a not in planned_minutes or b not in planned_minutes:
            continue
        model.AddImplication(use[b], use[a])
        model.Add(
            first_start_by_driver[b]
            >= last_end_by_driver[a] + int(cfg.min_split_pause_minutes)
        ).OnlyEnforceIf([use[a], use[b]])
        pair_max = _safe_int_minutes(drivers[a].hard_max_hours)
        model.Add(paid_minutes[a] + paid_minutes[b] <= pair_max)

    # Fairness (soft): minimize the SPREAD (max - min) of total minutes
    # (historical + planned) across active, fairness-eligible drivers.
    # Linear in driver count (the previous pairwise |a-b| formulation grew
    # quadratically and needed big-M gating per pair). Inactive drivers are
    # excluded from both bounds via conditional constraints.
    fairness_driver_indices = [i for i, d in enumerate(drivers) if not d.is_availability_limited]
    # Beides zaehlt: bezahlte Arbeitszeit (inkl. Bereitschaft) und gefahrene Zeit.
    fairness_spread: Optional[cp_model.LinearExpr] = None
    fairness_ziel_terms: List[cp_model.LinearExpr] = []
    fairness_ueber_terms: List[cp_model.LinearExpr] = []
    fairness_ziel_info: Dict[str, float] = {}
    if cfg.fairness_mode in ("ziel", "ziel2", "hybrid") and len(fairness_driver_indices) > 1:
        # Vorstufe: schneller Vorplan (Greedy) -> typische Dienstlaenge der
        # eingesetzten Fahrer. Wer schon mehr Vorstunden hat, bekommt ein
        # entsprechend niedrigeres Ziel.
        vorplan = _greedy_schedule(rides_sorted, drivers, zone_matrix, ride_start_min, ride_end_min, ride_pre_buffer)
        bezahlt_werte, gefahren_werte = [], []
        fair_set = set(fairness_driver_indices)
        for d, chain in vorplan.items():
            if not chain or d not in fair_set:
                continue
            drv = drivers[d]
            first, last = chain[0], chain[-1]
            gefahren = (
                ride_end_min[last] - ride_start_min[first]
                + zone_matrix.minutes(drv.start_zone, rides_sorted[first].start_zone)
                + ride_pre_buffer[first]
                + zone_matrix.minutes(rides_sorted[last].end_zone, drv.end_zone)
            )
            gefahren_werte.append(gefahren)
            bezahlt_werte.append(max(gefahren, _safe_int_minutes(drv.min_shift_hours)))
        if bezahlt_werte:
            skala = max(0.1, float(cfg.fairness_target_scale))
            ziel_bezahlt = int(round(sum(bezahlt_werte) / len(bezahlt_werte) * skala))
            ziel_gefahren = int(round(sum(gefahren_werte) / len(gefahren_werte) * skala))
            hist_mittel = sum(_safe_int_minutes(drivers[d].historical_worked_hours) for d in fairness_driver_indices) / len(fairness_driver_indices)
            for d in fairness_driver_indices:
                korrektur = _safe_int_minutes(drivers[d].historical_worked_hours) - hist_mittel
                for art, quelle, ziel in (("bezahlt", paid_minutes, ziel_bezahlt), ("gefahren", planned_minutes, ziel_gefahren)):
                    z = max(0, int(round(ziel - korrektur)))
                    if cfg.fairness_mode in ("ziel2", "hybrid"):
                        # Ueber dem Ziel (mehr Arbeit als die anderen) wiegt doppelt.
                        ueber = model.NewIntVar(0, 200_000, f"fair_ueber_{art}_{d}")
                        unter = model.NewIntVar(0, 200_000, f"fair_unter_{art}_{d}")
                        model.Add(ueber >= quelle[d] - z * use[d])
                        model.Add(unter >= z * use[d] - quelle[d])
                        fairness_ueber_terms.append(ueber)
                        fairness_ziel_terms.append(unter)
                    else:
                        abw = model.NewIntVar(0, 200_000, f"fair_abw_{art}_{d}")
                        model.Add(abw >= quelle[d] - z * use[d])
                        model.Add(abw >= z * use[d] - quelle[d])
                        fairness_ziel_terms.append(abw)
            fairness_ziel_info = {"ziel_bezahlt_min": ziel_bezahlt, "ziel_gefahren_min": ziel_gefahren}
    if cfg.fairness_mode in ("spanne", "hybrid") and len(fairness_driver_indices) > 1:
        total_bound = 200_000
        spreads = []
        for art, quelle in (("bezahlt", paid_minutes), ("gefahren", planned_minutes)):
            fair_max = model.NewIntVar(0, total_bound, f"fair_max_{art}")
            fair_min = model.NewIntVar(0, total_bound, f"fair_min_{art}")
            for d in fairness_driver_indices:
                hist = _safe_int_minutes(drivers[d].historical_worked_hours)
                total_d = model.NewIntVar(0, total_bound, f"fair_total_{art}_{d}")
                model.Add(total_d == quelle[d] + hist)
                model.Add(fair_max >= total_d).OnlyEnforceIf(use[d])
                model.Add(fair_min <= total_d).OnlyEnforceIf(use[d])
            spread = model.NewIntVar(0, total_bound, f"fair_spread_{art}")
            model.Add(spread >= fair_max - fair_min)
            spreads.append(spread)
        fairness_spread = spreads

    # Symmetriebruch: gleichwertige Fahrer (gleiches Profil, gleiche Fenster,
    # gleiche Vorstunden) nur in fester Reihenfolge einsetzen. Die Reihenfolge
    # wechselt je Planungstag, damit nicht immer dieselben Fahrer zuerst dran sind.
    if cfg.symmetry_breaking and cfg.tunnel is None:
        spaet_von = {b for (_, b) in cfg.split_driver_pairs}
        gruppen: Dict[Tuple, List[int]] = {}
        for d, drv in enumerate(drivers):
            if d in spaet_von:
                continue
            profil = (
                drv.is_vip_qualified, drv.historical_worked_hours, drv.availability_max_hours, drv.legal_max_hours,
                drv.min_shift_hours, drv.start_zone, drv.end_zone, drv.is_ev, drv.ev_range_km,
                drv.earliest_start_minute, drv.latest_end_minute,
            )
            gruppen.setdefault(profil, []).append(d)
        tag_text = planning_day.isoformat()
        for mitglieder in gruppen.values():
            if len(mitglieder) < 2:
                continue
            mitglieder.sort(key=lambda d: hashlib.sha1(f"{tag_text}|{drivers[d].driver_id}".encode()).hexdigest())
            for a, b in zip(mitglieder, mitglieder[1:]):
                model.Add(use[a] >= use[b])

    total_unassigned = sum(u[i] for i in range(r_count))
    total_active = sum(use[d] for d in range(d_count))
    # Bereitschaft kostet wie Leerlauf: bezahlte Zeit ohne Fahrt.
    total_idle = sum(idle_minutes_expr_terms + standby_expr_terms) if (idle_minutes_expr_terms or standby_expr_terms) else 0
    total_service_slack = sum(service_slack_expr_terms) if service_slack_expr_terms else 0
    fair_w = int(weights.fairness_pair_abs_minute)
    total_fairness_weighted = 0
    if fairness_ueber_terms:
        # Ueber dem Ziel doppelt so teuer wie darunter.
        w = max(1, fair_w // max(1, cfg.fairness_dev_div))
        total_fairness_weighted += 2 * w * sum(fairness_ueber_terms) + w * sum(fairness_ziel_terms)
    elif fairness_ziel_terms:
        total_fairness_weighted += max(1, fair_w // 8) * sum(fairness_ziel_terms)
    if fairness_spread is not None and cfg.fairness_spread_div > 0:
        w_s = max(1, fair_w // cfg.fairness_spread_div) if cfg.fairness_mode == "hybrid" else fair_w
        total_fairness_weighted += (w_s // 2) * fairness_spread[0] + (w_s - w_s // 2) * fairness_spread[1]
    total_deadhead = sum(deadhead_expr_terms) if deadhead_expr_terms else 0

    # Minimize weighted objective. Service slack is a reward (subtracted).
    objective = (
        weights.unassigned_ride * total_unassigned
        + weights.active_driver * total_active
        + weights.idle_minute * total_idle
        + total_fairness_weighted
        # Unnoetige Bereitschaft minimal teurer als jeder Fairness-Gewinn.
        + (sum(standby_expr_terms) if standby_expr_terms else 0)
        + weights.deadhead_minute * total_deadhead
        - weights.service_slack_minute_reward * total_service_slack
    )
    model.Minimize(objective)

    # Warm start: hint the solver with a greedy feasible schedule so search
    # starts from a good incumbent instead of from scratch. Hints are
    # advisory; CP-SAT repairs or discards them if inconsistent.
    if cfg.use_warm_start_hint:
        greedy_chains = _greedy_schedule(
            rides_sorted, drivers, zone_matrix,
            ride_start_min, ride_end_min, ride_pre_buffer,
        )
        # Kurze Ketten sind zulaessig: der Mindestdienst wird mit Bereitschaft
        # aufgefuellt, der Greedy-Hint bleibt deshalb vollstaendig.
        assigned_ride_to_driver: Dict[int, int] = {}
        for d, chain in greedy_chains.items():
            for i in chain:
                assigned_ride_to_driver[i] = d
        for i in range(r_count):
            model.AddHint(u[i], 0 if i in assigned_ride_to_driver else 1)
        for d in range(d_count):
            model.AddHint(use[d], 1 if greedy_chains.get(d) else 0)
            for i in range(r_count):
                model.AddHint(x[(d, i)], 1 if assigned_ride_to_driver.get(i) == d else 0)

        # Auch die Kettenstruktur mitgeben: ohne Start-, End- und Verbindungs-
        # kanten ist der Hinweis unvollständig und CP-SAT verwirft ihn meist,
        # statt von der fertigen Startlösung aus weiterzusuchen.
        for d, chain in greedy_chains.items():
            if not chain:
                continue
            first, last = chain[0], chain[-1]
            if (d, first) in y_source:
                model.AddHint(y_source[(d, first)], 1)
            if (d, last) in y_sink:
                model.AddHint(y_sink[(d, last)], 1)
            for position in range(len(chain) - 1):
                key = (d, chain[position], chain[position + 1])
                if key in y_arc:
                    model.AddHint(y_arc[key], 1)
            # Übrige Start-/Endkanten dieses Fahrers ausschließen, damit der
            # Hinweis in sich widerspruchsfrei bleibt.
            for i in chain:
                if i != first and (d, i) in y_source:
                    model.AddHint(y_source[(d, i)], 0)
                if i != last and (d, i) in y_sink:
                    model.AddHint(y_sink[(d, i)], 0)

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = float(cfg.max_solver_time_seconds)
    if float(cfg.relative_gap_limit) > 0:
        solver.parameters.relative_gap_limit = float(cfg.relative_gap_limit)
    solver.parameters.num_search_workers = int(cfg.num_search_workers)

    status = solver.Solve(model)
    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        # Should be rare with unassigned slack, but return a safe fallback.
        return ScheduleResult(
            assignments=[],
            unassigned_ride_ids=[r.ride_id for r in rides_sorted],
            warnings=["Solver found no feasible solution; all rides marked unassigned."],
            kpis=PlanKpis(
                total_planned_hours=0.0,
                active_driver_count=0,
                unassigned_ride_count=r_count,
                fairness_score_hours_abs_avg=0.0,
                objective_value=float("inf"),
            ),
        )

    # Reconstruct per-driver ordered ride chain from route arc selections.
    assignments: List[DriverAssignment] = []
    active_driver_count = 0
    total_planned_hours = 0.0

    for d, drv in enumerate(drivers):
        first_candidates = [i for i in range(r_count) if (d, i) in y_source and solver.Value(y_source[(d, i)]) == 1]
        active = len(first_candidates) == 1
        if active:
            active_driver_count += 1
        if not active and not cfg.include_inactive_drivers_in_output:
            continue

        ordered_idx: List[int] = []
        idle_minutes = 0
        deadhead_minutes = 0
        shift_start_dt: Optional[datetime] = None
        shift_end_dt: Optional[datetime] = None
        planned_hours = solver.Value(paid_minutes[d]) / 60.0 if d in paid_minutes else 0.0
        standby_minutes = (solver.Value(paid_minutes[d]) - solver.Value(planned_minutes[d])) if d in paid_minutes else 0
        total_planned_hours += planned_hours

        if active:
            current = first_candidates[0]
            ordered_idx.append(current)
            while True:
                next_nodes = [
                    j
                    for j in range(r_count)
                    if (d, current, j) in y_arc and solver.Value(y_arc[(d, current, j)]) == 1
                ]
                if not next_nodes:
                    break
                nxt = next_nodes[0]
                transfer = zone_matrix.minutes(rides_sorted[current].end_zone, rides_sorted[nxt].start_zone)
                idle = ride_start_min[nxt] - ride_end_min[current] - transfer - ride_pre_buffer[nxt]
                idle_minutes += max(0, int(idle))
                deadhead_minutes += transfer
                ordered_idx.append(nxt)
                current = nxt

            first_i = ordered_idx[0]
            last_i = ordered_idx[-1]

            start_transfer = zone_matrix.minutes(drv.start_zone, rides_sorted[first_i].start_zone)
            shift_start_min = ride_start_min[first_i] - ride_pre_buffer[first_i] - start_transfer
            shift_start_min = max(0, shift_start_min)
            end_transfer = zone_matrix.minutes(rides_sorted[last_i].end_zone, drv.end_zone)
            shift_end_min = ride_end_min[last_i] + end_transfer + max(0, standby_minutes)
            deadhead_minutes += start_transfer + end_transfer

            day_start = datetime.combine(planning_day, time.min, tzinfo=rides_sorted[first_i].start_time.tzinfo)
            shift_start_dt = day_start + timedelta(minutes=shift_start_min)
            shift_end_dt = day_start + timedelta(minutes=shift_end_min)

        note = (
            ("Active shift with compactness/fairness objective applied."
             + (f" Inkl. {standby_minutes} min Bereitschaft (Mindestdienst)." if standby_minutes > 0 else ""))
            if active
            else "Driver not used in this plan."
        )
        assignments.append(
            DriverAssignment(
                driver_id=drv.driver_id,
                ride_ids=[rides_sorted[i].ride_id for i in ordered_idx],
                shift_start=shift_start_dt,
                shift_end=shift_end_dt,
                planned_hours=planned_hours,
                idle_minutes=idle_minutes,
                note=note,
                deadhead_minutes=deadhead_minutes,
            )
        )

    unassigned_ride_ids = [rides_sorted[i].ride_id for i in range(r_count) if solver.Value(u[i]) == 1]

    # Fairness KPI: average pairwise absolute total-hours differences among active, fairness-eligible drivers.
    fairness_active = [
        d
        for d in fairness_driver_indices
        if solver.Value(use[d]) == 1
    ]
    pair_diffs_hours: List[float] = []
    for a_idx in range(len(fairness_active)):
        for b_idx in range(a_idx + 1, len(fairness_active)):
            da = fairness_active[a_idx]
            db = fairness_active[b_idx]
            total_a_min = solver.Value(planned_minutes[da]) + _safe_int_minutes(drivers[da].historical_worked_hours)
            total_b_min = solver.Value(planned_minutes[db]) + _safe_int_minutes(drivers[db].historical_worked_hours)
            pair_diffs_hours.append(abs(total_a_min - total_b_min) / 60.0)

    fairness_score = sum(pair_diffs_hours) / len(pair_diffs_hours) if pair_diffs_hours else 0.0
    warnings: List[str] = []
    if unassigned_ride_ids:
        warnings.append(
            f"{len(unassigned_ride_ids)} ride(s) unassigned -> review manually in dispatcher dashboard."
        )

    objective_value = float(solver.ObjectiveValue())
    best_bound = float(solver.BestObjectiveBound())
    gap = (objective_value - best_bound) / objective_value if objective_value > 0 else 0.0

    return ScheduleResult(
        assignments=assignments,
        unassigned_ride_ids=unassigned_ride_ids,
        warnings=warnings,
        kpis=PlanKpis(
            total_planned_hours=total_planned_hours,
            active_driver_count=active_driver_count,
            unassigned_ride_count=len(unassigned_ride_ids),
            fairness_score_hours_abs_avg=fairness_score,
            objective_value=objective_value,
            best_objective_bound=best_bound,
            optimality_gap=max(0.0, gap),
            solver_status="OPTIMAL" if status == cp_model.OPTIMAL else "FEASIBLE",
            solver_wall_time_seconds=float(solver.WallTime()),
            total_deadhead_minutes=sum(a.deadhead_minutes for a in assignments),
        ),
    )


if __name__ == "__main__":
    # Small example setup for local smoke testing (requires ortools installed).
    day = date(2026, 5, 6)
    drivers_demo = [
        Driver(
            driver_id="D1",
            is_vip_qualified=True,
            historical_worked_hours=18.0,
            availability_max_hours=8.0,
            legal_max_hours=10.0,
            min_shift_hours=3.0,
            start_zone="MUC_IN",
            end_zone="MUC_IN",
            is_ev=False,
        ),
        Driver(
            driver_id="D2",
            is_vip_qualified=False,
            historical_worked_hours=12.0,
            availability_max_hours=9.0,
            legal_max_hours=10.0,
            min_shift_hours=3.0,
            start_zone="MUC_OUT",
            end_zone="MUC_OUT",
            is_ev=True,
            ev_range_km=240,
        ),
    ]
    rides_demo = [
        Ride(
            ride_id="R1",
            start_time=datetime(2026, 5, 6, 8, 0),
            duration_minutes=70,
            start_poi_type="Airport",
            is_vip_ride=True,
            start_zone="MUC_IN",
            end_zone="MUC_OUT",
        ),
        Ride(
            ride_id="R2",
            start_time=datetime(2026, 5, 6, 10, 30),
            duration_minutes=60,
            start_poi_type="Hotel",
            is_vip_ride=False,
            start_zone="MUC_OUT",
            end_zone="MUC_IN",
        ),
        Ride(
            ride_id="R3",
            start_time=datetime(2026, 5, 6, 12, 15),
            duration_minutes=50,
            start_poi_type="Private",
            is_vip_ride=False,
            start_zone="MUC_IN",
            end_zone="MUC_IN",
        ),
    ]
    zm = ZoneMatrix(
        travel_minutes={
            ("MUC_IN", "MUC_OUT"): 30,
            ("MUC_OUT", "MUC_IN"): 30,
        }
    )

    result = solve_schedule(rides_demo, drivers_demo, zm, mode="balanced")
    print(result.to_dict())
