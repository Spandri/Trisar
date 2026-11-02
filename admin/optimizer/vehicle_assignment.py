"""
Vehicle assignment stage (MVP, day-ahead batch planning).

Runs AFTER the driver schedule solver: each active driver shift gets exactly
one vehicle for the whole day. Two-stage decomposition keeps both problems
small and explainable; a combined driver x vehicle x ride model is a later
optimization step.

Rules implemented:
- Vehicle class: a shift containing at least one VIP ride requires a
  VIP-class vehicle. Standard shifts prefer standard vehicles so VIP cars
  stay available.
- EV feasibility: the shift's driving distance is simulated leg by leg
  (deadhead to first pickup, rides, transfers between rides, deadhead home).
  Idle gaps of at least `min_charge_gap_minutes` recharge the battery at
  `charge_km_per_hour`. An EV is eligible only if the simulated range never
  drops below `reserve_km`.
- Preference order per shift: feasible EV first (CO2), then combustion.
  Longest shifts are assigned first so scarce long-range vehicles go where
  they are needed.

Distances are estimated from zone transfer minutes via `km_per_minute`
until real OSRM distances are wired in (hook: `leg_km_override`).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Callable, Dict, List, Literal, Optional, Tuple

from .driver_schedule_solver import Driver, Ride, ZoneMatrix

VehicleClass = Literal["VIP", "Standard"]


@dataclass(frozen=True)
class Vehicle:
    vehicle_id: str
    label: str
    vehicle_class: VehicleClass
    is_ev: bool
    range_km: float = 0.0            # usable range with full battery
    start_range_km: float = 0.0      # available range at shift start
    charge_km_per_hour: float = 200.0


@dataclass
class ChargeStop:
    start: datetime
    end: datetime
    km_gained: float

    def to_dict(self) -> Dict[str, object]:
        return {
            "start": self.start.isoformat(),
            "end": self.end.isoformat(),
            "km_gained": round(self.km_gained, 1),
        }


@dataclass
class VehiclePlan:
    driver_id: str
    vehicle_id: Optional[str]
    vehicle_label: str
    is_ev: bool
    shift_km: float
    charge_stops: List[ChargeStop] = field(default_factory=list)
    min_range_reserve_km: Optional[float] = None
    note: str = ""

    def to_dict(self) -> Dict[str, object]:
        return {
            "driver_id": self.driver_id,
            "vehicle_id": self.vehicle_id,
            "vehicle_label": self.vehicle_label,
            "is_ev": self.is_ev,
            "shift_km": round(self.shift_km, 1),
            "charge_stops": [c.to_dict() for c in self.charge_stops],
            "min_range_reserve_km": (
                round(self.min_range_reserve_km, 1)
                if self.min_range_reserve_km is not None else None
            ),
            "note": self.note,
        }


@dataclass
class FleetKpis:
    ev_shift_count: int
    combustion_shift_count: int
    unassigned_shift_count: int
    total_km: float
    ev_km: float
    co2_saved_kg: float  # EV km vs. combustion baseline

    def to_dict(self) -> Dict[str, object]:
        return {
            "ev_shift_count": self.ev_shift_count,
            "combustion_shift_count": self.combustion_shift_count,
            "unassigned_shift_count": self.unassigned_shift_count,
            "total_km": round(self.total_km, 1),
            "ev_km": round(self.ev_km, 1),
            "co2_saved_kg": round(self.co2_saved_kg, 1),
        }


@dataclass(frozen=True)
class ShiftLeg:
    """One driving or idle segment of a shift, in chain order."""
    kind: Literal["drive", "idle"]
    start: datetime
    end: datetime
    km: float


def build_shift_legs(
    driver: Driver,
    chain: List[Ride],
    zone_matrix: ZoneMatrix,
    km_per_minute: float = 0.75,
    leg_km_override: Optional[Callable[[str, str], Optional[float]]] = None,
) -> List[ShiftLeg]:
    """Expand an ordered ride chain into drive/idle legs incl. deadheads."""

    def zone_km(a: str, b: str) -> float:
        if leg_km_override is not None:
            v = leg_km_override(a, b)
            if v is not None:
                return v
        return zone_matrix.minutes(a, b) * km_per_minute

    legs: List[ShiftLeg] = []
    if not chain:
        return legs

    first = chain[0]
    pre_min = zone_matrix.minutes(driver.start_zone, first.start_zone) + first.pre_buffer_minutes
    legs.append(ShiftLeg(
        "drive",
        first.start_time - timedelta(minutes=pre_min),
        first.start_time,
        zone_km(driver.start_zone, first.start_zone),
    ))
    for idx, ride in enumerate(chain):
        legs.append(ShiftLeg(
            "drive", ride.start_time, ride.end_time,
            zone_km(ride.start_zone, ride.end_zone),
        ))
        if idx + 1 < len(chain):
            nxt = chain[idx + 1]
            transfer_min = zone_matrix.minutes(ride.end_zone, nxt.start_zone)
            transfer_end = ride.end_time + timedelta(minutes=transfer_min)
            legs.append(ShiftLeg(
                "drive", ride.end_time, transfer_end,
                zone_km(ride.end_zone, nxt.start_zone),
            ))
            idle_until = nxt.start_time - timedelta(minutes=nxt.pre_buffer_minutes)
            if idle_until > transfer_end:
                legs.append(ShiftLeg("idle", transfer_end, idle_until, 0.0))
    last = chain[-1]
    post_min = zone_matrix.minutes(last.end_zone, driver.end_zone)
    legs.append(ShiftLeg(
        "drive", last.end_time,
        last.end_time + timedelta(minutes=post_min),
        zone_km(last.end_zone, driver.end_zone),
    ))
    return legs


def simulate_ev(
    legs: List[ShiftLeg],
    vehicle: Vehicle,
    min_charge_gap_minutes: int = 40,
    reserve_km: float = 30.0,
) -> Optional[Tuple[List[ChargeStop], float]]:
    """
    Simulate battery range along the legs. Charges in idle gaps that are at
    least `min_charge_gap_minutes` long. Returns (charge_stops, minimum
    remaining range above reserve) or None if the vehicle runs below the
    reserve at any point.
    """
    rng = vehicle.start_range_km
    stops: List[ChargeStop] = []
    min_headroom = rng - reserve_km
    for leg in legs:
        if leg.kind == "drive":
            rng -= leg.km
            min_headroom = min(min_headroom, rng - reserve_km)
            if rng < reserve_km:
                return None
        else:
            gap_min = (leg.end - leg.start).total_seconds() / 60.0
            if gap_min >= min_charge_gap_minutes:
                gained = min(
                    vehicle.range_km - rng,
                    vehicle.charge_km_per_hour * gap_min / 60.0,
                )
                if gained > 1.0:
                    rng += gained
                    stops.append(ChargeStop(leg.start, leg.end, gained))
    return stops, min_headroom


def assign_vehicles(
    shifts: List[Tuple[Driver, List[Ride]]],
    vehicles: List[Vehicle],
    zone_matrix: ZoneMatrix,
    km_per_minute: float = 0.75,
    min_charge_gap_minutes: int = 40,
    reserve_km: float = 30.0,
    co2_kg_per_km: float = 0.15,
    leg_km_override: Optional[Callable[[str, str], Optional[float]]] = None,
) -> Tuple[List[VehiclePlan], FleetKpis, List[str]]:
    """
    Assign one vehicle per active shift. Longest shifts first; per shift the
    preference is: feasible EV, then combustion; VIP shifts strictly require
    VIP-class vehicles, standard shifts use standard vehicles before VIP.
    """
    plans: List[VehiclePlan] = []
    warnings: List[str] = []
    available = {v.vehicle_id: v for v in vehicles}

    enriched = []
    for driver, chain in shifts:
        if not chain:
            continue
        legs = build_shift_legs(driver, chain, zone_matrix, km_per_minute, leg_km_override)
        km = sum(l.km for l in legs)
        needs_vip = any(r.is_vip_ride for r in chain)
        enriched.append((driver, chain, legs, km, needs_vip))
    enriched.sort(key=lambda t: -t[3])

    total_km = ev_km = 0.0
    ev_count = ice_count = unassigned = 0

    for driver, chain, legs, km, needs_vip in enriched:
        total_km += km
        candidates = [
            v for v in available.values()
            if (v.vehicle_class == "VIP") == needs_vip or (not needs_vip and v.vehicle_class == "VIP")
        ]
        # Standard shifts: standard vehicles first, VIP cars only as fallback.
        candidates.sort(key=lambda v: (v.vehicle_class == "VIP") if not needs_vip else False)

        chosen: Optional[Vehicle] = None
        chosen_stops: List[ChargeStop] = []
        chosen_headroom: Optional[float] = None

        for v in [c for c in candidates if c.is_ev]:
            sim = simulate_ev(legs, v, min_charge_gap_minutes, reserve_km)
            if sim is not None:
                chosen, (chosen_stops, chosen_headroom) = v, sim
                break
        if chosen is None:
            for v in candidates:
                if not v.is_ev:
                    chosen = v
                    break

        if chosen is None:
            unassigned += 1
            warnings.append(
                f"Fahrer {driver.driver_id}: kein passendes Fahrzeug verfuegbar "
                f"({'VIP' if needs_vip else 'Standard'}, {km:.0f} km)."
            )
            plans.append(VehiclePlan(
                driver_id=driver.driver_id, vehicle_id=None,
                vehicle_label="KEIN FAHRZEUG", is_ev=False, shift_km=km,
                note="Manuell klaeren: Fahrzeugpool erschoepft.",
            ))
            continue

        del available[chosen.vehicle_id]
        if chosen.is_ev:
            ev_count += 1
            ev_km += km
        else:
            ice_count += 1
        plans.append(VehiclePlan(
            driver_id=driver.driver_id,
            vehicle_id=chosen.vehicle_id,
            vehicle_label=chosen.label,
            is_ev=chosen.is_ev,
            shift_km=km,
            charge_stops=chosen_stops,
            min_range_reserve_km=chosen_headroom,
            note=(
                f"{len(chosen_stops)} Ladestopp(s) eingeplant." if chosen_stops
                else ("EV ohne Ladestopp machbar." if chosen.is_ev else "")
            ),
        ))

    kpis = FleetKpis(
        ev_shift_count=ev_count,
        combustion_shift_count=ice_count,
        unassigned_shift_count=unassigned,
        total_km=total_km,
        ev_km=ev_km,
        co2_saved_kg=ev_km * co2_kg_per_km,
    )
    return plans, kpis, warnings
