"""
Adapter between current Admin-App payloads and the CP-SAT driver schedule solver.

Focus:
- Convert existing `drivers` and `jobs/rides` rows into solver `Driver` / `Ride`.
- Infer Munich-centric zones from addresses:
  - Munich city -> inner zone
  - Munich nearby -> fixed +30 minutes
- Far addresses -> optional OpenStreetMap-based API lookup (from Munich to destination)
"""

from __future__ import annotations

from dataclasses import dataclass, replace as dataclass_replace
from datetime import date, datetime, time
import math
import os
from typing import Dict, List, Optional, Protocol, Sequence, Tuple
from urllib.parse import urlencode
from urllib.request import Request, urlopen
import json

from .driver_schedule_solver import Driver, Mode, Ride, ScheduleResult, ZoneMatrix, solve_schedule


class TravelTimeProvider(Protocol):
    """
    Returns travel duration in minutes from Munich base to a target address.
    """

    def minutes_from_munich(self, destination_address: str) -> Optional[int]:
        ...


class GoogleDistanceMatrixTravelTimeProvider:
    """
    Deprecated placeholder.

    This adapter now targets OpenStreetMap-based routing by default.
    Keep class name for backward compatibility if imported elsewhere.
    """

    def __init__(self, *args: object, **kwargs: object) -> None:
        raise RuntimeError(
            "GoogleDistanceMatrixTravelTimeProvider is deprecated. "
            "Use OpenStreetMapTravelTimeProvider instead."
        )


class OpenStreetMapTravelTimeProvider:
    """
    OSM-based travel time provider using:
    - Nominatim for geocoding
    - OSRM public API for driving duration

    Notes:
    - Public endpoints are rate-limited; use caching and respectful User-Agent.
    - For production scale, host your own Nominatim/OSRM or use a managed provider.
    """

    def __init__(
        self,
        origin_address: str = "München, Deutschland",
        timeout_seconds: float = 5.0,
        user_agent: str = "trisar-dispatch-planner/1.0",
        nominatim_base_url: Optional[str] = None,
        osrm_base_url: Optional[str] = None,
    ) -> None:
        resolved_nominatim = (
            nominatim_base_url
            or os.getenv("TRISAR_OSM_NOMINATIM_URL")
            or "https://nominatim.openstreetmap.org"
        )
        resolved_osrm = (
            osrm_base_url
            or os.getenv("TRISAR_OSM_OSRM_URL")
            or "https://router.project-osrm.org"
        )
        self.origin_address = origin_address
        self.timeout_seconds = timeout_seconds
        self.user_agent = user_agent
        self.nominatim_base_url = resolved_nominatim.rstrip("/")
        self.osrm_base_url = resolved_osrm.rstrip("/")
        self._geocode_cache: Dict[str, Tuple[float, float]] = {}
        self._duration_cache: Dict[str, int] = {}

    def _json_get(self, url: str) -> Optional[object]:
        try:
            req = Request(url, headers={"User-Agent": self.user_agent})
            with urlopen(req, timeout=self.timeout_seconds) as response:
                return json.loads(response.read().decode("utf-8"))
        except Exception:
            return None

    def _geocode(self, address: str) -> Optional[Tuple[float, float]]:
        key = str(address or "").strip().lower()
        if not key:
            return None
        if key in self._geocode_cache:
            return self._geocode_cache[key]

        params = {
            "q": address,
            "format": "jsonv2",
            "limit": 1,
            "addressdetails": 0,
            "countrycodes": "de",
        }
        url = f"{self.nominatim_base_url}/search?{urlencode(params)}"
        payload = self._json_get(url)
        if not isinstance(payload, list) or not payload:
            return None
        top = payload[0]
        if not isinstance(top, dict):
            return None
        try:
            lat = float(top.get("lat"))  # type: ignore[arg-type]
            lon = float(top.get("lon"))  # type: ignore[arg-type]
        except (TypeError, ValueError):
            return None
        value = (lat, lon)
        self._geocode_cache[key] = value
        return value

    def minutes_from_munich(self, destination_address: str) -> Optional[int]:
        destination = str(destination_address or "").strip()
        if not destination:
            return None

        cache_key = f"{self.origin_address}__{destination}".lower()
        if cache_key in self._duration_cache:
            return self._duration_cache[cache_key]

        origin_point = self._geocode(self.origin_address)
        destination_point = self._geocode(destination)
        if not origin_point or not destination_point:
            return None
        o_lat, o_lon = origin_point
        d_lat, d_lon = destination_point

        osrm_url = (
            f"{self.osrm_base_url}/route/v1/driving/"
            f"{o_lon:.6f},{o_lat:.6f};{d_lon:.6f},{d_lat:.6f}"
            "?overview=false&alternatives=false&steps=false"
        )
        payload = self._json_get(osrm_url)
        if not isinstance(payload, dict):
            return None
        routes = payload.get("routes")
        if not isinstance(routes, list) or not routes:
            return None
        first = routes[0]
        if not isinstance(first, dict):
            return None
        try:
            seconds = float(first.get("duration", 0))
        except (TypeError, ValueError):
            return None
        if seconds <= 0:
            return None

        minutes = max(1, int(round(seconds / 60.0)))
        self._duration_cache[cache_key] = minutes
        return minutes


@dataclass(frozen=True)
class AdapterOptions:
    default_ride_duration_minutes: int = 80
    default_driver_legal_max_hours: float = 10.0
    default_driver_availability_max_hours: float = 8.0
    default_driver_min_shift_hours: float = 3.0
    default_driver_start_zone: str = "MUENCHEN_INNEN"
    default_driver_end_zone: str = "MUENCHEN_INNEN"
    munich_inner_zone: str = "MUENCHEN_INNEN"
    munich_near_zone: str = "MUENCHEN_UMFELD_30"
    munich_near_minutes: int = 30
    far_zone_rounding_minutes: int = 15
    far_zone_fallback_minutes: int = 75
    include_done_rides: bool = False
    # Dispo-Puffer aus den Planungseinstellungen (Minuten vor jeder Fahrt)
    extra_buffer_minutes: int = 0


MUNICH_INNER_KEYWORDS = (
    "münchen",
    "muenchen",
    "munchen",
    "muc",
    "80331",
    "80333",
    "80335",
    "80336",
    "80337",
    "80339",
    "80636",
    "80801",
    "80939",
)

MUNICH_NEAR_KEYWORDS = (
    "garching",
    "unterfoehring",
    "unterföhring",
    "aschheim",
    "haar",
    "gruenwald",
    "grünwald",
    "pullach",
    "planegg",
    "ottobrunn",
    "oberschleissheim",
    "oberschleißheim",
    "neubiberg",
    "ismaning",
    "hallbergmoos",
    "freising",
    "erding",
    "dachau",
    "starnberg",
)

EXCLUDED_RIDE_STATUSES = {
    "done",
    "completed",
    "arrived",
    "archived",
    "cancelled",
    "canceled",
    "refused",
    "rejected",
}


def _normalize_text(value: object) -> str:
    return " ".join(str(value or "").strip().lower().split())


def _parse_iso_date(value: object) -> Optional[date]:
    text = str(value or "").strip()
    if not text:
        return None
    try:
        return datetime.fromisoformat(text[:10]).date()
    except ValueError:
        return None


def _parse_clock(value: object) -> Optional[time]:
    text = str(value or "").strip()
    if not text:
        return None
    if "T" in text:
        text = text.split("T", 1)[1]
    text = text[:5]
    try:
        hour, minute = text.split(":")
        h = int(hour)
        m = int(minute)
    except Exception:
        return None
    if h < 0 or h > 23 or m < 0 or m > 59:
        return None
    return time(hour=h, minute=m)


def _hours_between(start_t: time, end_t: time) -> float:
    start_m = start_t.hour * 60 + start_t.minute
    end_m = end_t.hour * 60 + end_t.minute
    if end_m >= start_m:
        return (end_m - start_m) / 60.0
    # overnight
    return ((1440 - start_m) + end_m) / 60.0


def _infer_poi_type(row: Dict[str, object]) -> str:
    source = " ".join(
        [
            str(row.get("start_poi_type") or ""),
            str(row.get("pickup_name") or ""),
            str(row.get("pickup_address") or ""),
        ]
    ).lower()
    if any(token in source for token in ("airport", "flughafen", "terminal", "muc")):
        return "Airport"
    if "hotel" in source:
        return "Hotel"
    return "Private"


def _bucket_far_minutes(minutes: int, rounding: int) -> int:
    rounded = int(math.ceil(max(1, minutes) / max(1, rounding)) * max(1, rounding))
    return max(rounding, rounded)


def _infer_zone_from_address(
    address: str,
    provider: Optional[TravelTimeProvider],
    options: AdapterOptions,
    warnings: List[str],
) -> Tuple[str, int]:
    text = _normalize_text(address)
    if not text:
        return (options.munich_near_zone, options.munich_near_minutes)

    # Flughafen VOR dem Innenstadt-Check: "Flughafen München" enthaelt
    # "münchen" und wuerde sonst faelschlich als Innenstadt (Anfahrt 0)
    # klassifiziert. Der Airport liegt ~40 Fahrminuten draussen.
    if any(key in text for key in ("flughafen", "airport", "terminal 1", "terminal 2")):
        return ("FLUGHAFEN_MUC", 40)

    if any(key in text for key in MUNICH_INNER_KEYWORDS):
        return (options.munich_inner_zone, 0)

    # If OSM provider is available, use real travel-time first for non-inner addresses.
    minutes = provider.minutes_from_munich(address) if provider else None
    if minutes is not None:
        if minutes <= options.munich_near_minutes:
            return (options.munich_near_zone, options.munich_near_minutes)
        bucket = _bucket_far_minutes(minutes, options.far_zone_rounding_minutes)
        return (f"REMOTE_{bucket}M", bucket)

    if any(key in text for key in MUNICH_NEAR_KEYWORDS):
        return (options.munich_near_zone, options.munich_near_minutes)

    if minutes is None:
        warnings.append(
            f"Keine API-Fahrzeit für '{address}' -> Fallback {options.far_zone_fallback_minutes}min."
        )
        minutes = options.far_zone_fallback_minutes

    bucket = _bucket_far_minutes(minutes, options.far_zone_rounding_minutes)
    return (f"REMOTE_{bucket}M", bucket)


def _to_float(row: Dict[str, object], key: str, default: float) -> float:
    value = row.get(key, default)
    try:
        return float(value)
    except (TypeError, ValueError):
        return float(default)


def _parse_window_minutes(value: object) -> Optional[int]:
    """Zeitfenster-Angabe in Minuten seit 00:00 des Planungstags.

    Akzeptiert Minuten als Zahl (auch > 1440 für den Folgetag) oder "HH:MM".
    """
    if value is None or value == "":
        return None
    if isinstance(value, (int, float)):
        return int(value)
    text = str(value).strip()
    if not text:
        return None
    if ":" in text:
        clock = _parse_clock(text)
        if clock is None:
            return None
        return clock.hour * 60 + clock.minute
    try:
        return int(float(text))
    except (TypeError, ValueError):
        return None


def adapt_drivers(
    raw_drivers: Sequence[Dict[str, object]],
    options: Optional[AdapterOptions] = None,
) -> List[Driver]:
    opts = options or AdapterOptions()
    adapted: List[Driver] = []
    for idx, row in enumerate(raw_drivers):
        driver_id = str(row.get("driver_id") or row.get("id") or "").strip()
        if not driver_id:
            driver_id = f"driver-{idx + 1}"

        availability = _to_float(row, "availability_max_hours", opts.default_driver_availability_max_hours)
        service_start = _parse_clock(row.get("service_start_time") or row.get("serviceStartTime"))
        service_end = _parse_clock(row.get("service_end_time") or row.get("serviceEndTime"))
        if service_start and service_end:
            availability = max(0.5, _hours_between(service_start, service_end))

        adapted.append(
            Driver(
                driver_id=driver_id,
                is_vip_qualified=bool(row.get("is_vip_qualified", True)),
                historical_worked_hours=_to_float(row, "historical_worked_hours", 0.0),
                availability_max_hours=availability,
                legal_max_hours=_to_float(row, "legal_max_hours", opts.default_driver_legal_max_hours),
                min_shift_hours=_to_float(row, "min_shift_hours", opts.default_driver_min_shift_hours),
                start_zone=str(row.get("start_zone") or opts.default_driver_start_zone),
                end_zone=str(row.get("end_zone") or opts.default_driver_end_zone),
                is_ev=bool(row.get("is_ev", False)),
                ev_range_km=_to_float(row, "ev_range_km", 0.0),
                earliest_start_minute=_parse_window_minutes(
                    row.get("earliest_start_minute", row.get("rest_until"))
                ),
                latest_end_minute=_parse_window_minutes(
                    row.get("latest_end_minute", row.get("must_end_by"))
                ),
            )
        )
    return adapted


def adapt_rides(
    raw_rides: Sequence[Dict[str, object]],
    service_day: date,
    zone_provider: Optional[TravelTimeProvider] = None,
    options: Optional[AdapterOptions] = None,
) -> Tuple[List[Ride], Dict[str, int], List[str]]:
    opts = options or AdapterOptions()
    warnings: List[str] = []
    zone_minutes: Dict[str, int] = {
        opts.munich_inner_zone: 0,
        opts.munich_near_zone: opts.munich_near_minutes,
    }
    rides: List[Ride] = []

    for idx, row in enumerate(raw_rides):
        status = _normalize_text(row.get("status"))
        if not opts.include_done_rides and status in EXCLUDED_RIDE_STATUSES:
            continue

        ride_date = _parse_iso_date(row.get("ride_date")) or service_day
        if ride_date != service_day:
            continue

        clock = _parse_clock(row.get("etd") or row.get("start_time"))
        if clock is None:
            warnings.append(f"Ride ohne gültige Startzeit übersprungen (id={row.get('id')}).")
            continue

        pickup_address = str(row.get("pickup_address") or row.get("start_address") or "").strip()
        dropoff_address = str(row.get("dropoff_address") or row.get("end_address") or "").strip()
        start_zone, start_minutes = _infer_zone_from_address(
            pickup_address,
            provider=zone_provider,
            options=opts,
            warnings=warnings,
        )
        end_zone, end_minutes = _infer_zone_from_address(
            dropoff_address,
            provider=zone_provider,
            options=opts,
            warnings=warnings,
        )
        zone_minutes[start_zone] = start_minutes
        zone_minutes[end_zone] = end_minutes

        duration = row.get("duration_minutes")
        if duration is None:
            duration = row.get("ext_route_duration_in_traffic_mins")
        if duration is None:
            duration = row.get("ext_route_duration_mins")
        try:
            duration_minutes = max(10, int(float(duration)))
        except (TypeError, ValueError):
            duration_minutes = max(10, int(opts.default_ride_duration_minutes))

        ride_id = str(row.get("ride_id") or row.get("id") or "").strip() or f"ride-{idx + 1}"
        start_dt = datetime.combine(ride_date, clock)
        poi_type = _infer_poi_type(row)

        rides.append(
            Ride(
                ride_id=ride_id,
                start_time=start_dt,
                duration_minutes=duration_minutes,
                start_poi_type=poi_type,  # type: ignore[arg-type]
                is_vip_ride=bool(row.get("is_vip_ride", False)),
                start_zone=start_zone,
                end_zone=end_zone,
                extra_buffer_minutes=int(opts.extra_buffer_minutes),
                # Klartext-Orte fuer die echte Distanztabelle.
                start_place=str(row.get("pickup_name") or row.get("pickup_address") or "").strip(),
                end_place=str(row.get("dropoff_name") or row.get("dropoff_address") or "").strip(),
            )
        )

    rides.sort(key=lambda r: r.start_time)
    return rides, zone_minutes, warnings


def build_zone_matrix_from_zone_minutes(zone_minutes: Dict[str, int]) -> ZoneMatrix:
    """
    Build a conservative transfer matrix from Munich-radial zone times.

    Rule:
    - same zone: 0
    - different zones: max(minutes_from_munich(zone_a), minutes_from_munich(zone_b), 30)
    """
    travel: Dict[Tuple[str, str], int] = {}
    zones = sorted(zone_minutes.keys())
    for a in zones:
        for b in zones:
            if a == b:
                travel[(a, b)] = 0
                continue
            ma = int(zone_minutes.get(a, 30))
            mb = int(zone_minutes.get(b, 30))
            travel[(a, b)] = max(30, ma, mb)
    return ZoneMatrix(travel_minutes=travel, default_between_distinct_zones=30)


def adapt_admin_payload_to_solver_inputs(
    raw_drivers: Sequence[Dict[str, object]],
    raw_rides: Sequence[Dict[str, object]],
    service_date_value: object,
    zone_provider: Optional[TravelTimeProvider] = None,
    options: Optional[AdapterOptions] = None,
    place_minutes: Optional[Dict[str, float]] = None,
    depot_place: Optional[str] = None,
) -> Tuple[List[Driver], List[Ride], ZoneMatrix, List[str]]:
    """
    Main adapter entrypoint.

    Returns:
      (drivers, rides, zone_matrix, warnings)
    """
    opts = options or AdapterOptions()
    service_day = _parse_iso_date(service_date_value)
    if service_day is None:
        service_day = datetime.utcnow().date()
    provider = zone_provider or OpenStreetMapTravelTimeProvider()

    drivers = adapt_drivers(raw_drivers, options=opts)
    rides, zone_minutes, warnings = adapt_rides(
        raw_rides,
        service_day=service_day,
        zone_provider=provider,
        options=opts,
    )
    if place_minutes:
        drivers, rides, zone_matrix = _with_place_travel_times(
            drivers, rides, zone_minutes, place_minutes, depot_place, provider, opts, warnings,
        )
    else:
        zone_matrix = build_zone_matrix_from_zone_minutes(zone_minutes)
    return drivers, rides, zone_matrix, warnings


def _with_place_travel_times(
    drivers: List[Driver],
    rides: List[Ride],
    zone_minutes: Dict[str, int],
    place_minutes: Dict[str, float],
    depot_place: Optional[str],
    provider: Optional[TravelTimeProvider],
    opts: AdapterOptions,
    warnings: List[str],
) -> Tuple[List[Driver], List[Ride], ZoneMatrix]:
    """
    Leerfahrten (Anfahrt, Umsetzen zwischen zwei Fahrten, Rueckweg) mit echten
    Fahrzeiten je Ortspaar statt der Zonenschaetzung.

    `place_minutes` ist die Routentabelle ("A|B" -> Minuten, z. B. TomTom-Matrix).
    Jeder Ort aus der Tabelle wird zu einer eigenen Zone; Fahrer starten und enden
    am `depot_place`. Paare ohne Tabelleneintrag (Orte, die die Tabelle nicht
    kennt) behalten die bisherige Zonenregel.
    """
    places = set()
    for key in place_minutes:
        if "|" in key:
            a, b = key.split("|", 1)
            places.add(a.strip())
            places.add(b.strip())

    # Radiale Minuten je Zone fuer die Rueckfallregel (Paare ohne Tabelle).
    radial: Dict[str, int] = dict(zone_minutes)

    def place_zone(place: str, fallback_zone: str) -> str:
        name = str(place or "").strip()
        if name and name in places:
            radial.setdefault(name, int(zone_minutes.get(fallback_zone, opts.munich_near_minutes)))
            return name
        return fallback_zone

    rides = [
        dataclass_replace(
            ride,
            start_zone=place_zone(ride.start_place, ride.start_zone),
            end_zone=place_zone(ride.end_place, ride.end_zone),
        )
        for ride in rides
    ]

    depot = str(depot_place or "").strip()
    if depot and depot in places:
        depot_zone, depot_minutes = _infer_zone_from_address(depot, provider=provider, options=opts, warnings=warnings)
        radial.setdefault(depot, int(depot_minutes))
        radial.setdefault(depot_zone, int(depot_minutes))
        drivers = [
            dataclass_replace(
                drv,
                start_zone=depot if drv.start_zone == opts.default_driver_start_zone else drv.start_zone,
                end_zone=depot if drv.end_zone == opts.default_driver_end_zone else drv.end_zone,
            )
            for drv in drivers
        ]
    elif depot:
        warnings.append(f"Startort '{depot}' fehlt in der Routentabelle -> Zonenschaetzung fuer die Anfahrt.")

    zones = sorted({r.start_zone for r in rides} | {r.end_zone for r in rides}
                   | {d.start_zone for d in drivers} | {d.end_zone for d in drivers} | set(radial))
    travel: Dict[Tuple[str, str], int] = {}
    for a in zones:
        for b in zones:
            if a == b:
                travel[(a, b)] = 0
                continue
            value = place_minutes.get(f"{a}|{b}")
            if value is None:
                value = place_minutes.get(f"{b}|{a}")
            if value is not None:
                travel[(a, b)] = max(0, int(round(float(value))))
            else:
                travel[(a, b)] = max(30, int(radial.get(a, 30)), int(radial.get(b, 30)))
    return drivers, rides, ZoneMatrix(travel_minutes=travel, default_between_distinct_zones=30)


def solve_schedule_from_admin_payload(
    raw_drivers: Sequence[Dict[str, object]],
    raw_rides: Sequence[Dict[str, object]],
    service_date_value: object,
    mode: Mode = "balanced",
    zone_provider: Optional[TravelTimeProvider] = None,
    options: Optional[AdapterOptions] = None,
) -> Tuple[ScheduleResult, List[str]]:
    """
    End-to-end helper:
      Admin payloads -> adapter -> solver result.
    """
    drivers, rides, zone_matrix, warnings = adapt_admin_payload_to_solver_inputs(
        raw_drivers=raw_drivers,
        raw_rides=raw_rides,
        service_date_value=service_date_value,
        zone_provider=zone_provider,
        options=options,
    )
    result = solve_schedule(rides=rides, drivers=drivers, zone_matrix=zone_matrix, mode=mode)
    return result, warnings
