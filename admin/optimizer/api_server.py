from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Literal, Optional

from fastapi import FastAPI
from pydantic import BaseModel, Field

from optimizer.admin_payload_adapter import (
    AdapterOptions,
    OpenStreetMapTravelTimeProvider,
    adapt_admin_payload_to_solver_inputs,
)
from dataclasses import replace as dataclass_replace

from optimizer.driver_schedule_solver import SolverConfig, solve_schedule

# Suffix der Spaetblock-Kopie bei geteilten Diensten. Der Solver sieht zwei
# "Fahrer"; Pause- und Summen-Constraints verknuepfen die Bloecke, die Ausgabe
# fuehrt beide wieder unter der Basis-ID zusammen.
SPLIT_SUFFIX = "#B"

from optimizer.tunnel_guide import build_tunnel
from optimizer.vehicle_assignment import adapt_admin_vehicles, assign_vehicles


Mode = Literal["balanced", "cost", "fairness", "service_level"]


class PlannerSettings(BaseModel):
    maxWorkHours: Optional[float] = 10.0
    minWorkHours: Optional[float] = 3.0
    # Geteilte Dienste: ein Fahrer darf zwei Arbeitsbloecke am Tag haben
    # (z.B. 08-11 Uhr und ab 17 Uhr); dazwischen liegt eine unbezahlte Pause
    # von mindestens `minPauseHours`.
    splitShifts: Optional[bool] = True
    minPauseHours: Optional[float] = 3.0
    bufferMinutes: Optional[int] = 20
    rideDurationMinutes: Optional[int] = 80
    mode: Optional[str] = "balanced"
    # Abbruchkriterium ist die Lösungsgüte (max. Abstand zum Optimum in %),
    # nicht die Rechenzeit.
    qualityGapPercent: Optional[float] = 0.0
    # Leerfahrten: "osrm" (Standard, OSRM x Stundenfaktor) oder "osrm_raum"
    # (OSRM x Faktor je Gegend/Tag/Stunde). "zonen" = alte Zonenschaetzung.
    travelModel: Optional[str] = "osrm"


class PlannerRequest(BaseModel):
    drivers: List[Dict[str, Any]] = Field(default_factory=list)
    rides: List[Dict[str, Any]] = Field(default_factory=list)
    vehicles: List[Dict[str, Any]] = Field(default_factory=list)
    # Echte Streckenkilometer je Ortspaar ("A|B" -> km), einmalig ueber die
    # TomTom-Matrix berechnet. Ohne Tabelle bleibt es bei der Zonenschaetzung.
    distances: Dict[str, float] = Field(default_factory=dict)
    # Echte Fahrzeiten je Ortspaar ("A|B" -> Minuten, TomTom-Matrix) fuer die
    # Leerfahrten zwischen den Fahrten. Ohne Tabelle: Zonenschaetzung.
    travelMinutes: Dict[str, float] = Field(default_factory=dict)
    # Start- und Endort der Fahrer (Ort aus travelMinutes), z. B. die Zentrale.
    depot: Optional[str] = None
    serviceDate: str
    settings: PlannerSettings = Field(default_factory=PlannerSettings)
    demandProfile: List[int] = Field(default_factory=list)


def _normalize_mode(value: Optional[str]) -> Mode:
    raw = str(value or "").strip().lower()
    if raw in ("cost", "efficiency", "kosten", "kostenminimierung"):
        return "cost"
    if raw in ("fairness", "fahrerzufriedenheit", "zufriedenheit"):
        return "fairness"
    if raw in ("service", "service_level", "service-level", "servicelevel"):
        return "service_level"
    return "balanced"


def _to_hhmm(iso_text: Optional[str]) -> Optional[str]:
    text = str(iso_text or "").strip()
    if not text:
        return None
    try:
        dt = datetime.fromisoformat(text)
    except ValueError:
        return None
    return dt.strftime("%H:%M")


def _build_adapter_options(settings: PlannerSettings) -> AdapterOptions:
    max_work = 10.0 if settings.maxWorkHours is None else float(settings.maxWorkHours)
    min_work = 3.0 if settings.minWorkHours is None else float(settings.minWorkHours)
    return AdapterOptions(
        default_ride_duration_minutes=max(20, int(settings.rideDurationMinutes or 80)),
        default_driver_availability_max_hours=max(1.0, max_work),
        default_driver_legal_max_hours=max(1.0, max_work),
        default_driver_min_shift_hours=max(0.0, min(min_work, max_work)),
        extra_buffer_minutes=max(0, int(settings.bufferMinutes or 0)),
    )


app = FastAPI(title="Trisar Driver Planner", version="1.0.0")


@app.get("/health")
def health() -> Dict[str, str]:
    return {"status": "ok", "engine": "cp_sat"}


@app.post("/solve")
def solve(payload: PlannerRequest) -> Dict[str, Any]:
    mode = _normalize_mode(payload.settings.mode)
    options = _build_adapter_options(payload.settings)
    zone_provider = OpenStreetMapTravelTimeProvider(
        origin_address="München, Deutschland",
        timeout_seconds=6.0,
        user_agent="trisar-driver-planner/1.0",
    )

    drivers, rides, zone_matrix, adapter_warnings = adapt_admin_payload_to_solver_inputs(
        raw_drivers=payload.drivers,
        raw_rides=payload.rides,
        service_date_value=payload.serviceDate,
        zone_provider=zone_provider,
        options=options,
        place_minutes=payload.travelMinutes or None,
        depot_place=payload.depot,
        travel_model=payload.settings.travelModel,
    )
    # Geteilte Dienste: jede*r Fahrer*in bekommt eine Spaetblock-Kopie. Die
    # Kopie ist minimal verfuegbarkeitslimitiert markiert, damit sie aus den
    # Fairness-Termen faellt (sonst wuerde jeder kurze Spaetblock den
    # Stunden-Spread kuenstlich aufreissen).
    split_pairs: List[tuple] = []
    min_pause_minutes = max(0, int(round(60 * float(payload.settings.minPauseHours or 3.0))))
    if bool(payload.settings.splitShifts if payload.settings.splitShifts is not None else True):
        base_drivers = list(drivers)
        index_of = {drv.driver_id: idx for idx, drv in enumerate(base_drivers)}
        for drv in base_drivers:
            copy = dataclass_replace(
                drv,
                driver_id=f"{drv.driver_id}{SPLIT_SUFFIX}",
                availability_max_hours=max(0.5, drv.availability_max_hours - 1e-6),
                historical_worked_hours=0.0,
            )
            drivers.append(copy)
            split_pairs.append((index_of[drv.driver_id], len(drivers) - 1))

    # Adaptive Modellgröße: Chain-Arcs wachsen mit Fahrer x Fahrten^2. Große
    # Tage (Messetag: 300+ Fahrten) sprengen sonst den Container-Speicher.
    ride_count = len(rides)
    # Qualitätsziel: 0 % = bis beweisbar optimal, sonst zulässige Restlücke.
    gap_limit = max(0.0, min(50.0, float(payload.settings.qualityGapPercent or 0.0))) / 100.0
    # Zeitgrenzen sind nur Sicherheitsnetze gegen Endlosläufe; große Tage
    # bekommen zusätzlich ein kleineres Modell (Arc-Pruning, weniger Worker).
    # Arc-Pruning hält das Modell klein: Ketten mit sehr langen Leerzeiten
    # zwischen zwei Fahrten sind ohnehin unattraktiv, blähen aber das Modell
    # (Fahrer x Fahrten^2) massiv auf und bremsen die Konvergenz.
    # Seit die Fahrten mit ECHTEN Fahrzeiten geplant werden (statt pauschal
    # 80 min) sind sie deutlich kuerzer — zwischen zwei Auftraegen entstehen
    # dadurch groessere Luecken. Die Verkettungsgrenze muss entsprechend
    # weiter sein, sonst bleiben Abendfahrten unbesetzt.
    if ride_count > 150:
        chain_gap, workers = 120, 4
    elif ride_count > 60:
        chain_gap, workers = 200, 6
    else:
        chain_gap, workers = 360, 8

    # KI-Korridor ("Tunnel"): Ab ~100 Fahrten dominiert die Modellgröße
    # (Fahrer x Fahrten^2) die Rechenzeit so stark, dass das Vollmodell in
    # vertretbarer Zeit keine belastbare Güte mehr erreicht. Eine KI-Vorstufe
    # steckt dann den Suchraum ab; CP-SAT optimiert vollwertig innerhalb des
    # Korridors. Verfehlt er das Güteziel, wird der Korridor aufgeweitet und
    # erneut gelöst — die Güteschranke bleibt das Abbruchkriterium, die Zeit
    # bleibt reines Sicherheitsnetz.
    tunnel_rounds = [
        {"k_drivers": 12, "k_neighbors": 8, "ensemble_runs": 16, "safety_seconds": 600.0},
        {"k_drivers": 24, "k_neighbors": 14, "ensemble_runs": 24, "safety_seconds": 1200.0},
    ]
    use_tunnel = ride_count >= 100

    result = None
    tunnel_info: Optional[Dict[str, Any]] = None
    if use_tunnel:
        best = None  # (unassigned_count, objective, result, stats, round_no)
        for round_no, params in enumerate(tunnel_rounds, start=1):
            corridor, stats = build_tunnel(
                rides=rides,
                drivers=drivers,
                zone_matrix=zone_matrix,
                k_drivers=params["k_drivers"],
                k_neighbors=params["k_neighbors"],
                ensemble_runs=params["ensemble_runs"],
                max_chain_gap_minutes=chain_gap,
            )
            round_result = solve_schedule(
                rides=rides,
                drivers=drivers,
                zone_matrix=zone_matrix,
                mode=mode,
                config=SolverConfig(
                    mode=mode,
                    max_chain_gap_minutes=chain_gap,
                    num_search_workers=workers,
                    relative_gap_limit=gap_limit,
                    max_solver_time_seconds=params["safety_seconds"],
                    tunnel=corridor,
                    split_driver_pairs=tuple(split_pairs),
                    min_split_pause_minutes=min_pause_minutes,
                ),
            )
            kpis = round_result.kpis
            key = (kpis.unassigned_ride_count, kpis.objective_value)
            if best is None or key < (best[0], best[1]):
                best = (kpis.unassigned_ride_count, kpis.objective_value, round_result, stats, round_no)
            # Güteziel im Korridor erreicht -> keine Aufweitung nötig.
            achieved = kpis.optimality_gap
            if achieved is not None and float(achieved) <= max(gap_limit, 1e-9):
                break
        _, _, result, stats, round_no = best
        tunnel_info = {
            **stats.to_dict(),
            "rounds_used": round_no,
            "rounds_max": len(tunnel_rounds),
        }
    else:
        result = solve_schedule(
            rides=rides,
            drivers=drivers,
            zone_matrix=zone_matrix,
            mode=mode,
            config=SolverConfig(
                mode=mode,
                max_chain_gap_minutes=chain_gap,
                num_search_workers=workers,
                relative_gap_limit=gap_limit,
                # Reines Sicherheitsnetz gegen Endlosläufe — der eigentliche
                # Abbruch erfolgt über die Lösungsgüte.
                max_solver_time_seconds=1800.0,
                split_driver_pairs=tuple(split_pairs),
                min_split_pause_minutes=min_pause_minutes,
            ),
        )
    result_dict = result.to_dict()
    assignments = list(result_dict.get("assignments") or [])

    driver_name_by_id = {
        str(row.get("driver_id") or row.get("id") or "").strip(): str(row.get("name") or "").strip()
        for row in payload.drivers
        if isinstance(row, dict)
    }

    suggestions: List[Dict[str, Any]] = []
    for assignment in assignments:
        ride_ids = list(assignment.get("ride_ids") or [])
        if len(ride_ids) == 0:
            continue
        raw_driver_id = str(assignment.get("driver_id") or "").strip()
        is_late_block = raw_driver_id.endswith(SPLIT_SUFFIX)
        driver_id = raw_driver_id[: -len(SPLIT_SUFFIX)] if is_late_block else raw_driver_id
        suggestions.append(
            {
                "driver_id": driver_id,
                "driver_name": driver_name_by_id.get(driver_id, ""),
                "service_start": _to_hhmm(assignment.get("shift_start")),
                "service_end": _to_hhmm(assignment.get("shift_end")),
                "assigned_ride_ids": ride_ids,
                "assigned_rides_count": len(ride_ids),
                "note": str(assignment.get("note") or "").strip(),
                "split_block": "late" if is_late_block else None,
            }
        )

    # Geteilte Dienste kennzeichnen: taucht ein Fahrer mit zwei Bloecken auf,
    # bekommen beide Karten einen Hinweis (Frueh-/Spaetblock).
    block_count: Dict[str, int] = {}
    for entry in suggestions:
        block_count[entry["driver_id"]] = block_count.get(entry["driver_id"], 0) + 1
    for entry in suggestions:
        if block_count.get(entry["driver_id"], 0) > 1:
            label = "Spätblock" if entry["split_block"] == "late" else "Frühblock"
            prefix = f"Geteilter Dienst · {label}"
            entry["note"] = f"{prefix} — {entry['note']}" if entry["note"] else prefix
    suggestions.sort(key=lambda e: (str(e.get("service_start") or ""), str(e.get("driver_name") or "")))

    warnings = [*adapter_warnings, *(result_dict.get("warnings") or [])]

    # Stage 2: one vehicle per active shift (EV first, VIP rules), only if the
    # caller sent a vehicle pool.
    vehicle_plans: List[Dict[str, Any]] = []
    fleet_kpis: Optional[Dict[str, Any]] = None
    if payload.vehicles:
        vehicle_pool = adapt_admin_vehicles(payload.vehicles)
        driver_by_id = {d.driver_id: d for d in drivers}
        ride_by_id = {r.ride_id: r for r in rides}
        shifts = []
        for assignment in assignments:
            driver = driver_by_id.get(str(assignment.get("driver_id") or "").strip())
            chain = [
                ride_by_id[ride_id]
                for ride_id in (assignment.get("ride_ids") or [])
                if ride_id in ride_by_id
            ]
            if driver is not None and chain:
                shifts.append((driver, chain))
        # Nachschlag in der Distanztabelle (beide Richtungen zulassen).
        def place_km(a: str, b: str) -> Optional[float]:
            if not payload.distances:
                return None
            v = payload.distances.get(f"{a}|{b}")
            if v is None:
                v = payload.distances.get(f"{b}|{a}")
            return float(v) if v is not None else None

        plans, kpis, vehicle_warnings = assign_vehicles(
            shifts=shifts,
            vehicles=vehicle_pool,
            zone_matrix=zone_matrix,
            place_km=place_km,
            # Bedarfsgesteuertes Laden: nur so viel und so oft wie noetig.
            # Reserve: unterwegs und am Schichtende mindestens 100 km,
            # bei E-Fahrzeugen zusaetzlich nie unter 20 % der Reichweite.
            reserve_km=100.0,
            target_end_range_km=100.0,
            min_reserve_percent=20.0,
        )
        vehicle_plans = [plan.to_dict() for plan in plans]
        fleet_kpis = kpis.to_dict()
        warnings.extend(vehicle_warnings)

    return {
        "source": "cp_sat",
        "mode": mode,
        "tunnel": tunnel_info,
        "suggestions": suggestions,
        "unassigned_ride_ids": result_dict.get("unassigned_ride_ids") or [],
        "warnings": warnings,
        "kpis": result_dict.get("kpis") or {},
        "vehicle_plans": vehicle_plans,
        "fleet_kpis": fleet_kpis,
    }
