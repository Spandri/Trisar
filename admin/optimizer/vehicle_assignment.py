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

# Admin-App `vehicles` rows carry no explicit class/EV flags, so both are
# inferred: EV from fuel_type, VIP from brand/trim keywords.
EV_FUEL_KEYWORDS = ("elektr", "electric", "bev")
VIP_MODEL_KEYWORDS = (
    "vip", "s-klasse", "s klasse", "s-class", "maybach", "eqs",
    "7er", "bmw 7", "i7", "740", "x7", "a8", "bentley", "rolls", "phantom", "flying spur",
)
DEFAULT_EV_RANGE_KM = 400.0
# Verbrenner ohne hinterlegte Reichweite: konservativer Standardwert.
DEFAULT_ICE_RANGE_KM = 700.0
# Ladeleistung EV (km/h) bzw. Tankgeschwindigkeit Verbrenner: 10 Minuten
# genuegen fuer eine volle Tankfuellung.
DEFAULT_EV_CHARGE_KM_PER_HOUR = 200.0
ICE_REFUEL_KM_PER_HOUR = 4200.0


def adapt_admin_vehicles(
    raw_vehicles: Optional[List[Dict[str, object]]],
    default_ev_range_km: float = DEFAULT_EV_RANGE_KM,
) -> List["Vehicle"]:
    """Map Admin-App `vehicles` table rows onto solver `Vehicle` objects."""
    vehicles: List[Vehicle] = []
    for idx, row in enumerate(raw_vehicles or []):
        if not isinstance(row, dict):
            continue
        vehicle_id = str(row.get("id") or row.get("vehicle_id") or "").strip() or f"vehicle-{idx + 1}"
        brand = str(row.get("brand_model") or "").strip()
        trim = str(row.get("trim") or "").strip()
        plate = str(row.get("license_plate") or "").strip()
        label = " ".join(part for part in (brand, trim) if part) or "Fahrzeug"
        if plate:
            label = f"{label} ({plate})"

        fuel = str(row.get("fuel_type") or "").strip().lower()
        is_ev = fuel in ("ev", "bev") or any(key in fuel for key in EV_FUEL_KEYWORDS)

        classify_text = f"{brand} {trim}".lower()
        vehicle_class: VehicleClass = (
            "VIP" if any(key in classify_text for key in VIP_MODEL_KEYWORDS) else "Standard"
        )

        try:
            range_km = float(row.get("range_km") or row.get("ev_range_km") or 0.0)
        except (TypeError, ValueError):
            range_km = 0.0
        if is_ev and range_km <= 0:
            range_km = default_ev_range_km

        # Verbrenner: `range_km` ist die Reichweite mit vollem Tank. Fehlt sie,
        # mit einem konservativen Standardwert arbeiten, damit auch Verbrenner
        # eine Tankplanung bekommen.
        if not is_ev and range_km <= 0:
            range_km = DEFAULT_ICE_RANGE_KM

        # Tatsaechlicher Lade- bzw. Tankstand zu Schichtbeginn: bisher wurde
        # jedes Fahrzeug als voll eingeplant, obwohl `battery_fuel_percent`
        # in den Fahrzeugdaten steht (bei Verbrennern der Tankfuellstand).
        try:
            start_percent = float(row.get("battery_fuel_percent"))
        except (TypeError, ValueError):
            start_percent = 100.0
        start_percent = max(0.0, min(100.0, start_percent))
        start_range_km = range_km * (start_percent / 100.0)

        vehicles.append(Vehicle(
            vehicle_id=vehicle_id,
            label=label,
            vehicle_class=vehicle_class,
            is_ev=is_ev,
            range_km=range_km,
            start_range_km=start_range_km,
            # Tanken geht ungleich schneller als Laden: eine volle Tankfuellung
            # in wenigen Minuten statt in Stunden.
            charge_km_per_hour=DEFAULT_EV_CHARGE_KM_PER_HOUR if is_ev else ICE_REFUEL_KM_PER_HOUR,
        ))
    return vehicles


@dataclass(frozen=True)
class Vehicle:
    vehicle_id: str
    label: str
    vehicle_class: VehicleClass
    is_ev: bool
    range_km: float = 0.0            # usable range with full battery
    start_range_km: float = 0.0      # available range at shift start
    charge_km_per_hour: float = 200.0


@dataclass(frozen=True)
class ChargingStation:
    """Oeffentliche Ladesaeule aus dem BNetzA-Register, einer Zone zugeordnet.

    detour_minutes: Hin- und Rueckweg vom Zonenzentrum inkl. Rangieren —
    diese Zeit geht vom Standzeitfenster ab, bevor geladen werden kann.
    """
    station_id: str
    name: str
    zone: str
    power_kw: float
    detour_minutes: int

    @property
    def charge_km_per_hour(self) -> float:
        # ~4.5 km Reichweite je kWh (Oberklasse-EV); Fahrzeugseite kappt separat.
        return self.power_kw * 4.5


@dataclass
class ChargeStop:
    start: datetime
    end: datetime
    km_gained: float
    station_id: Optional[str] = None
    station_name: Optional[str] = None

    def to_dict(self) -> Dict[str, object]:
        return {
            "start": self.start.isoformat(),
            "end": self.end.isoformat(),
            "km_gained": round(self.km_gained, 1),
            "station_id": self.station_id,
            "station_name": self.station_name,
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
    zone: Optional[str] = None  # set for idle legs: where the driver waits


def build_shift_legs(
    driver: Driver,
    chain: List[Ride],
    zone_matrix: ZoneMatrix,
    km_per_minute: float = 0.75,
    leg_km_override: Optional[Callable[[str, str], Optional[float]]] = None,
    place_km: Optional[Callable[[str, str], Optional[float]]] = None,
) -> List[ShiftLeg]:
    """Expand an ordered ride chain into drive/idle legs incl. deadheads."""

    def zone_km(a: str, b: str) -> float:
        if leg_km_override is not None:
            v = leg_km_override(a, b)
            if v is not None:
                return v
        return zone_matrix.minutes(a, b) * km_per_minute

    def strecke(place_a: str, place_b: str, zone_a: str, zone_b: str) -> float:
        """Echte Streckenkilometer, wenn die Distanztabelle das Ortspaar
        kennt — sonst die grobe Zonenschaetzung."""
        if place_km is not None and place_a and place_b:
            v = place_km(place_a, place_b)
            if v is not None:
                return v
        return zone_km(zone_a, zone_b)

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
            strecke(ride.start_place, ride.end_place, ride.start_zone, ride.end_zone),
        ))
        if idx + 1 < len(chain):
            nxt = chain[idx + 1]
            transfer_min = zone_matrix.minutes(ride.end_zone, nxt.start_zone)
            transfer_end = ride.end_time + timedelta(minutes=transfer_min)
            legs.append(ShiftLeg(
                "drive", ride.end_time, transfer_end,
                strecke(ride.end_place, nxt.start_place, ride.end_zone, nxt.start_zone),
            ))
            idle_until = nxt.start_time - timedelta(minutes=nxt.pre_buffer_minutes)
            if idle_until > transfer_end:
                legs.append(ShiftLeg("idle", transfer_end, idle_until, 0.0,
                                     zone=nxt.start_zone))
    last = chain[-1]
    post_min = zone_matrix.minutes(last.end_zone, driver.end_zone)
    legs.append(ShiftLeg(
        "drive", last.end_time,
        last.end_time + timedelta(minutes=post_min),
        zone_km(last.end_zone, driver.end_zone),
    ))
    return legs


def _charge_windows(
    legs: List[ShiftLeg],
    vehicle: Vehicle,
    stations_by_zone: Optional[Dict[str, List[ChargingStation]]],
    min_charge_gap_minutes: int,
    min_usable_charge_minutes: int,
    detour_speed_km_per_min: float,
) -> Dict[int, Tuple[Optional[ChargingStation], float, float, float]]:
    """Best charging option per idle leg index:
    {leg_idx: (station|None, usable_minutes, rate_km_per_h, detour_km)}."""
    windows: Dict[int, Tuple[Optional[ChargingStation], float, float, float]] = {}
    for idx, leg in enumerate(legs):
        if leg.kind != "idle":
            continue
        gap_min = (leg.end - leg.start).total_seconds() / 60.0
        if stations_by_zone is None:
            if gap_min >= min_charge_gap_minutes:
                windows[idx] = (None, gap_min, vehicle.charge_km_per_hour, 0.0)
            continue
        best = None
        for st in stations_by_zone.get(leg.zone or "", []):
            usable = gap_min - st.detour_minutes
            if usable < min_usable_charge_minutes:
                continue
            rate = min(vehicle.charge_km_per_hour, st.charge_km_per_hour)
            detour_km = st.detour_minutes * detour_speed_km_per_min
            potential = rate * usable / 60.0 - detour_km
            if potential > 1.0 and (best is None or potential > best[0]):
                best = (potential, st, usable, rate, detour_km)
        if best is not None:
            _, st, usable, rate, detour_km = best
            windows[idx] = (st, usable, rate, detour_km)
    return windows


def simulate_ev(
    legs: List[ShiftLeg],
    vehicle: Vehicle,
    min_charge_gap_minutes: int = 40,
    reserve_km: float = 100.0,
    stations_by_zone: Optional[Dict[str, List[ChargingStation]]] = None,
    min_usable_charge_minutes: int = 15,
    detour_speed_km_per_min: float = 0.5,
    target_end_range_km: Optional[float] = None,
) -> Optional[Tuple[List[ChargeStop], float]]:
    """
    Simulate battery range along the legs.

    Charging opportunities: without `stations_by_zone` any idle gap of at
    least `min_charge_gap_minutes`; with stations only registered chargers in
    the idle leg's zone (detour deducted from window and battery, rate is
    min(vehicle, station)).

    Charging POLICY:
    - target_end_range_km=None (opportunistic, legacy): charge in every
      qualifying window as much as possible.
    - target_end_range_km set (demand-driven): charge ONLY as much as needed
      so the range never drops below `reserve_km` en route and ends the shift
      at or above the target. Windows are filled lazily (cheapest first =
      biggest potential), each stop only as long as required.

    Returns (charge_stops, minimum remaining range above reserve) or None if
    the shift is infeasible for this vehicle even with maximal charging.
    """
    windows = _charge_windows(legs, vehicle, stations_by_zone,
                              min_charge_gap_minutes, min_usable_charge_minutes,
                              detour_speed_km_per_min)

    def run(charge_km: Dict[int, float]):
        """Simulate with given charge amounts; returns (ok, min_headroom,
        end_range, first_leg_index_where_reserve_is_violated_or_None)."""
        rng = vehicle.start_range_km
        min_head = rng - reserve_km
        for idx, leg in enumerate(legs):
            if leg.kind == "drive":
                rng -= leg.km
                min_head = min(min_head, rng - reserve_km)
                if rng < reserve_km:
                    return False, min_head, rng, idx
            elif idx in charge_km and charge_km[idx] > 0:
                _, _, _, detour_km = windows[idx]
                rng = min(vehicle.range_km, rng - detour_km + charge_km[idx])
        return True, min_head, rng, None

    charges: Dict[int, float] = {}
    if target_end_range_km is None:
        # Opportunistic: fill every window to the possible maximum.
        rng = vehicle.start_range_km
        for idx, leg in enumerate(legs):
            if leg.kind == "drive":
                rng -= leg.km
                if rng < reserve_km:
                    return None
            elif idx in windows:
                st, usable, rate, detour_km = windows[idx]
                if rng - detour_km < reserve_km:
                    continue
                gained = min(vehicle.range_km - (rng - detour_km),
                             rate * usable / 60.0)
                if gained - detour_km > 1.0:
                    charges[idx] = gained
                    rng = rng - detour_km + gained
        ok, min_head, _, _ = run(charges)
        if not ok:
            return None
    else:
        # Demand-driven: start without charging, add stops only when needed.
        for _ in range(len(windows) + 2):
            ok, min_head, end_rng, violation_idx = run(charges)
            defizit = 0.0
            grenze = violation_idx if not ok else len(legs)
            if ok and end_rng < target_end_range_km:
                defizit = target_end_range_km - end_rng
            elif not ok:
                defizit = reserve_km  # mindestens aus dem Tief heraus
            if ok and defizit <= 0:
                break
            # bestes noch freies Fenster VOR der Engstelle
            kandidaten = [
                (idx, windows[idx]) for idx in windows
                if idx < grenze and charges.get(idx, 0.0) <= 0.0
            ]
            if not kandidaten:
                if not ok:
                    return None  # Schicht auch mit Laden nicht machbar
                break  # Ziel verfehlt, aber Reserve haelt: akzeptieren
            def potential(k):
                st, usable, rate, detour_km = k[1]
                return rate * usable / 60.0 - detour_km
            idx, (st, usable, rate, detour_km) = max(kandidaten, key=potential)
            noetig = defizit + detour_km + 5.0  # kleine Marge
            charges[idx] = min(rate * usable / 60.0, noetig,
                               vehicle.range_km - reserve_km)
        else:
            ok, min_head, _, _ = run(charges)
            if not ok:
                return None

    stops: List[ChargeStop] = []
    for idx, gained in sorted(charges.items()):
        if gained <= 0:
            continue
        st, usable, rate, detour_km = windows[idx]
        leg = legs[idx]
        lade_min = gained / rate * 60.0
        detour_min = st.detour_minutes if st is not None else 0
        ende = leg.start + timedelta(minutes=min(
            (leg.end - leg.start).total_seconds() / 60.0,
            detour_min + lade_min))
        stops.append(ChargeStop(
            leg.start, ende, gained,
            station_id=st.station_id if st else None,
            station_name=st.name if st else None,
        ))
    return stops, min_head


def assign_vehicles(
    shifts: List[Tuple[Driver, List[Ride]]],
    vehicles: List[Vehicle],
    zone_matrix: ZoneMatrix,
    km_per_minute: float = 0.75,
    min_charge_gap_minutes: int = 40,
    reserve_km: float = 100.0,
    co2_kg_per_km: float = 0.15,
    leg_km_override: Optional[Callable[[str, str], Optional[float]]] = None,
    place_km: Optional[Callable[[str, str], Optional[float]]] = None,
    stations_by_zone: Optional[Dict[str, List[ChargingStation]]] = None,
    target_end_range_km: Optional[float] = None,
    min_reserve_percent: float = 20.0,
    # Tanken braucht deutlich weniger Standzeit als Laden.
    ice_refuel_gap_minutes: int = 12,
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
        legs = build_shift_legs(driver, chain, zone_matrix, km_per_minute, leg_km_override, place_km)
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
            # Reserve nicht nur absolut, sondern auch als Anteil der Reichweite:
            # 30 km sind bei 600 km Reichweite nur 5 % — ein Wagen durfte damit
            # bis fast leer fahren, ohne dass ein Ladestopp entstand.
            fahrzeug_reserve = max(reserve_km, v.range_km * (min_reserve_percent / 100.0))
            sim = simulate_ev(legs, v, min_charge_gap_minutes, fahrzeug_reserve,
                              stations_by_zone=stations_by_zone,
                              target_end_range_km=target_end_range_km)
            if sim is not None:
                chosen, (chosen_stops, chosen_headroom) = v, sim
                break
        if chosen is None:
            # Verbrenner ebenso pruefen: Tankreichweite reicht nicht unbegrenzt,
            # unter der Reserve wird ein Tankstopp in eine Standzeit gelegt.
            # `simulate_ev` rechnet generisch mit Reichweite und Nachfuellen —
            # fuer Verbrenner mit Tankwerten statt Ladewerten.
            for v in [c for c in candidates if not c.is_ev]:
                fahrzeug_reserve = max(reserve_km, v.range_km * (min_reserve_percent / 100.0))
                sim = simulate_ev(legs, v, ice_refuel_gap_minutes, fahrzeug_reserve,
                                  stations_by_zone=None,
                                  min_usable_charge_minutes=ice_refuel_gap_minutes,
                                  target_end_range_km=target_end_range_km)
                if sim is not None:
                    chosen, (chosen_stops, chosen_headroom) = v, sim
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
                (f"{len(chosen_stops)} Ladestopp(s) eingeplant." if chosen.is_ev
                 else f"{len(chosen_stops)} Tankstopp(s) eingeplant.") if chosen_stops
                else ("EV ohne Ladestopp machbar." if chosen.is_ev
                      else "Tankfuellung reicht fuer die Schicht.")
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
