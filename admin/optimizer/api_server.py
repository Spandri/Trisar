from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Literal, Optional

from fastapi import FastAPI
from pydantic import BaseModel, Field

from optimizer.admin_payload_adapter import (
    AdapterOptions,
    OpenStreetMapTravelTimeProvider,
    solve_schedule_from_admin_payload,
)


Mode = Literal["balanced", "cost", "fairness", "service_level"]


class PlannerSettings(BaseModel):
    maxWorkHours: Optional[float] = 10.0
    minWorkHours: Optional[float] = 4.0
    minPauseHours: Optional[float] = 3.0
    bufferMinutes: Optional[int] = 20
    rideDurationMinutes: Optional[int] = 80
    mode: Optional[str] = "balanced"


class PlannerRequest(BaseModel):
    drivers: List[Dict[str, Any]] = Field(default_factory=list)
    rides: List[Dict[str, Any]] = Field(default_factory=list)
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
    min_work = 4.0 if settings.minWorkHours is None else float(settings.minWorkHours)
    return AdapterOptions(
        default_ride_duration_minutes=max(20, int(settings.rideDurationMinutes or 80)),
        default_driver_availability_max_hours=max(1.0, max_work),
        default_driver_legal_max_hours=max(1.0, max_work),
        default_driver_min_shift_hours=max(0.0, min(min_work, max_work)),
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

    result, adapter_warnings = solve_schedule_from_admin_payload(
        raw_drivers=payload.drivers,
        raw_rides=payload.rides,
        service_date_value=payload.serviceDate,
        mode=mode,
        zone_provider=zone_provider,
        options=options,
    )
    result_dict = result.to_dict()
    assignments = list(result_dict.get("assignments") or [])

    suggestions: List[Dict[str, Any]] = []
    for assignment in assignments:
        ride_ids = list(assignment.get("ride_ids") or [])
        if len(ride_ids) == 0:
            continue
        suggestions.append(
            {
                "driver_id": str(assignment.get("driver_id") or "").strip(),
                "service_start": _to_hhmm(assignment.get("shift_start")),
                "service_end": _to_hhmm(assignment.get("shift_end")),
                "assigned_ride_ids": ride_ids,
                "assigned_rides_count": len(ride_ids),
                "note": str(assignment.get("note") or "").strip(),
            }
        )

    warnings = [*adapter_warnings, *(result_dict.get("warnings") or [])]
    return {
        "source": "cp_sat",
        "mode": mode,
        "suggestions": suggestions,
        "unassigned_ride_ids": result_dict.get("unassigned_ride_ids") or [],
        "warnings": warnings,
        "kpis": result_dict.get("kpis") or {},
    }
