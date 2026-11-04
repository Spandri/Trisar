import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders, jsonResponse } from '../_shared/cors.ts';
import { providerConfig } from '../_shared/provider-config.ts';
import { recordUsageWithCost } from '../_shared/usage-tracking.ts';
import { TOMTOM_PROVIDER, tomtomRoute, tomtomSchluessel } from '../_shared/tomtom-routing.ts';

type SyncReason = 'create' | 'manual_refresh' | 'live_view';

// Route Fahrer -> Abholung/Ziel hoechstens so oft je Fahrt neu rechnen.
const DRIVER_ROUTE_MIN_INTERVAL_MS = 45_000;
type FlightProviderName = 'lufthansa_open_api' | 'aviationstack';

type FlightSummary = {
  provider: FlightProviderName;
  flight_iata: string;
  operating_carrier: string | null;
  operating_flight_number: string | null;
  marketing_carrier: string | null;
  marketing_flight_number: string | null;
  flight_status_code: string | null;
  flight_status_description: string | null;
  departure_airport: string | null;
  departure_terminal: string | null;
  departure_gate: string | null;
  arrival_airport: string | null;
  arrival_terminal: string | null;
  arrival_gate: string | null;
  scheduled_departure_local: string | null;
  estimated_departure_local: string | null;
  actual_departure_local: string | null;
  scheduled_arrival_local: string | null;
  estimated_arrival_local: string | null;
  actual_arrival_local: string | null;
  aircraft_code: string | null;
  aircraft_registration: string | null;
  aircraft_icao24: string | null;
  delay_minutes: number | null;
};

type HexDbRoute = {
  departureIata: string | null;
  arrivalIata: string | null;
  departureIcao: string | null;
  arrivalIcao: string | null;
};

type HexDbAircraft = {
  registration: string | null;
  operatorFlagCode: string | null;
};

type AirportGeo = {
  iata: string | null;
  icao: string | null;
  lat: number;
  lng: number;
};

type OpenSkyState = {
  icao24: string;
  callsign: string | null;
  longitude: number;
  latitude: number;
  onGround: boolean;
  velocityMs: number | null;
  trueTrackDeg: number | null;
  verticalRateMs: number | null;
  baroAltitudeM: number | null;
  geoAltitudeM: number | null;
  lastContactEpoch: number | null;
  timePositionEpoch: number | null;
};

type OpenSkyTrackPoint = {
  timeEpoch: number | null;
  latitude: number;
  longitude: number;
  headingDeg: number | null;
  onGround: boolean | null;
};

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SETTINGS_KEYS = ['flight_cache_ttl_minutes', 'route_cache_ttl_minutes', 'manual_refresh_cooldown_seconds'] as const;
const DEFAULT_LUFTHANSA_GROUP_OPERATING_CARRIERS = ['LH', 'VL', 'EW', 'E2', 'LX', 'OS', 'SN', 'EN', '4Y'];
const OPENSKY_MIN_REFRESH_SECONDS_IN_FLIGHT = 60;
const OPENSKY_RATE_LIMIT_BACKOFF_SECONDS = 180;
const OPENSKY_MAX_TRACK_POINTS = 200;
const OPENSKY_TRACK_REFRESH_SECONDS = 300;
const OPENSKY_ROUTE_LOOKUP_LIMIT = 20;
const OPENSKY_REGISTRATION_LOOKUP_LIMIT = 20;
const OPENSKY_ENABLE_PREFIX_ROUTE_FALLBACK = false;
const OPENSKY_ENABLE_GLOBAL_STATES_FALLBACK = false;
const LIVE_VIEW_STALE_LOCK_SECONDS = 90;
const MANUAL_REFRESH_STALE_LOCK_SECONDS = 300;
const CREATE_STALE_LOCK_SECONDS = 600;
const FLIGHT_LIVE_MAX_BBOX_SPAN_DEG = 25;
const FLIGHT_LIVE_ROUTE_CORRIDOR_KM = 120;
const FLIGHT_LIVE_AIRPORT_RADIUS_KM = 80;
const FLIGHT_LIVE_HEADING_MAX_DELTA_DEG = 80;
const FLIGHT_LIVE_HEADING_RELAX_AIRPORT_RADIUS_KM = 45;
const IATA_TO_ICAO_CALLSIGN_PREFIX: Record<string, string[]> = {
  LH: ['DLH'],
  VL: ['DLH', 'LHX'],
  LX: ['SWR'],
  OS: ['AUA'],
  SN: ['BEL'],
  EW: ['EWG'],
  EN: ['DLA'],
  '4Y': ['OCN'],
};
let lufthansaTokenCache: { accessToken: string; expiresAtMs: number } | null = null;
let openSkyTokenCache: { accessToken: string; expiresAtMs: number } | null = null;
const hexDbAircraftCache = new Map<string, { value: HexDbAircraft | null; expiresAtMs: number }>();

const asNumber = (value: unknown, fallback: number) => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
};

const toFiniteNumber = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
};

const toEpochSeconds = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 1_000_000_000_000 ? Math.floor(value / 1000) : Math.floor(value);
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed > 1_000_000_000_000 ? Math.floor(parsed / 1000) : Math.floor(parsed);
    }
    const dateValue = Date.parse(value);
    if (Number.isFinite(dateValue)) return Math.floor(dateValue / 1000);
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) return Math.floor(value.getTime() / 1000);
  return null;
};

const readHeader = (headers: Headers, candidates: string[]) => {
  for (const name of candidates) {
    const value = headers.get(name);
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
};

const parseHeaderNumber = (value: string | null) => {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const extractOpenSkyRateLimitFromHeaders = (headers: Headers) => {
  const remainingRaw = readHeader(headers, [
    'x-rate-limit-remaining',
    'x-ratelimit-remaining',
  ]);
  const limitRaw = readHeader(headers, [
    'x-rate-limit-limit',
    'x-ratelimit-limit',
  ]);
  const retryAfterRaw = readHeader(headers, [
    'x-rate-limit-retry-after-seconds',
    'x-rate-limit-retry-after',
    'retry-after',
  ]);
  const resetRaw = readHeader(headers, [
    'x-rate-limit-reset',
    'x-ratelimit-reset',
  ]);

  return {
    remaining: parseHeaderNumber(remainingRaw),
    limit: parseHeaderNumber(limitRaw),
    retryAfterSeconds: parseHeaderNumber(retryAfterRaw),
    resetEpochSeconds: parseHeaderNumber(resetRaw),
  };
};

const getOpenSkyRefreshIntervalSeconds = (
  summary: FlightSummary | null,
  liveTracking: Record<string, unknown> | null,
) => {
  const statusCode = toNullableString(summary?.flight_status_code)?.toUpperCase() || null;
  const arrivedByStatus = new Set(['LD', 'LN', 'AR', 'ARR', 'LAN', 'LND']);
  const departedByStatus = new Set(['DP', 'DEP', 'DEPARTED', 'ENR', 'AIR', 'IN_FLIGHT', 'ACTIVE']);
  const actualArrivalMs = parseIsoMs(summary?.actual_arrival_local);
  if (Number.isFinite(actualArrivalMs) || Boolean(statusCode && arrivedByStatus.has(statusCode))) {
    return null;
  }

  const actualDepartureMs = parseIsoMs(summary?.actual_departure_local);
  const isInFlightByLiveState = liveTracking?.on_ground === false;
  const isDeparted = Boolean(
    Number.isFinite(actualDepartureMs)
      || (statusCode && departedByStatus.has(statusCode))
      || isInFlightByLiveState,
  );
  if (!isDeparted) return null; // Before departure: never call OpenSky.
  return OPENSKY_MIN_REFRESH_SECONDS_IN_FLIGHT; // After departure: every minute.
};

const getRefreshLockTtlSeconds = (reason: SyncReason) => {
  if (reason === 'live_view') return LIVE_VIEW_STALE_LOCK_SECONDS;
  if (reason === 'manual_refresh') return MANUAL_REFRESH_STALE_LOCK_SECONDS;
  return CREATE_STALE_LOCK_SECONDS;
};

const normalizeIataCode = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(normalized)) return null;
  return normalized;
};

const normalizeIcaoCode = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toUpperCase();
  if (!/^[A-Z]{4}$/.test(normalized)) return null;
  return normalized;
};

const normalizeIcao24 = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  if (!/^[a-f0-9]{6}$/.test(normalized)) return null;
  return normalized;
};

const normalizeAircraftRegistration = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!normalized || normalized.length < 3) return null;
  return normalized;
};

const normalizeCallsign = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toUpperCase().replace(/\s+/g, '');
  if (!normalized) return null;
  if (!/^[A-Z0-9]{3,8}$/.test(normalized)) return null;
  return normalized;
};

const normalizeCallsignPrefix = (value: unknown): string | null => {
  const normalized = normalizeCallsign(value);
  if (!normalized) return null;
  const match = normalized.match(/^[A-Z0-9]{3}/);
  return match?.[0] || null;
};

const toRecord = (value: unknown): Record<string, unknown> | null => {
  if (!value) return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    try {
      const parsed = JSON.parse(trimmed);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
    } catch {
      return null;
    }
  }
  if (typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  return null;
};

const ensureEnv = (name: string) => {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
};

const base64UrlDecode = (value: string) => {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  return atob(padded);
};

const parseJwtPayload = (token: string): Record<string, unknown> | null => {
  try {
    const parts = token.split('.');
    if (parts.length < 2) return null;
    return JSON.parse(base64UrlDecode(parts[1]));
  } catch {
    return null;
  }
};

const getBearerToken = (authHeader: string | null) => {
  if (!authHeader) return null;
  const [scheme, token] = authHeader.split(' ');
  if (!scheme || !token || scheme.toLowerCase() !== 'bearer') return null;
  return token;
};

const parseIsoToHHMM = (value: unknown): string | null => {
  if (!value || typeof value !== 'string') return null;
  const match = value.match(/T(\d{2}:\d{2})/);
  if (match?.[1]) return match[1];
  const directMatch = value.match(/^(\d{2}:\d{2})/);
  return directMatch?.[1] || null;
};

const normalizeCarrierCode = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toUpperCase();
  if (!normalized) return null;
  if (!/^[A-Z0-9]{2,3}$/.test(normalized)) return null;
  return normalized;
};

const toNullableString = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized ? normalized : null;
};

const pickFirstString = (...values: unknown[]): string | null => {
  for (const value of values) {
    const normalized = toNullableString(value);
    if (normalized) return normalized;
  }
  return null;
};

const toIsoDateTime = (value: unknown): string | null => {
  const normalized = toNullableString(value);
  if (!normalized) return null;
  const parsed = Date.parse(normalized);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed).toISOString();
};

const toDelayMinutes = (
  scheduledAtIso: string | null,
  estimatedAtIso: string | null,
  actualAtIso: string | null,
) => {
  const scheduledMs = scheduledAtIso ? Date.parse(scheduledAtIso) : NaN;
  const compareMs = actualAtIso ? Date.parse(actualAtIso) : estimatedAtIso ? Date.parse(estimatedAtIso) : NaN;
  if (!Number.isFinite(scheduledMs) || !Number.isFinite(compareMs)) return null;
  return Math.round((compareMs - scheduledMs) / 60000);
};

const shiftIsoDateByDays = (isoDate: string, deltaDays: number) => {
  const parsed = Date.parse(`${isoDate}T00:00:00Z`);
  if (!Number.isFinite(parsed)) return isoDate;
  const shifted = new Date(parsed + (deltaDays * 24 * 60 * 60 * 1000));
  return shifted.toISOString().slice(0, 10);
};

const parseIsoMs = (value: unknown) => {
  if (typeof value !== 'string' || !value.trim()) return NaN;
  return Date.parse(value);
};

const deriveFlightCacheTtlMinutes = (summary: FlightSummary | null, fallbackMinutes: number, now = new Date()) => {
  const fallback = Math.max(5, Math.round(fallbackMinutes || 15));
  if (!summary) return fallback;

  const statusCode = toNullableString(summary.flight_status_code)?.toUpperCase() || null;
  const arrivedByStatus = new Set(['LD', 'LN', 'AR', 'ARR', 'LAN', 'LND']);
  const inFlightByStatus = new Set(['DP', 'ENR', 'AIR', 'IN_FLIGHT']);

  const actualDepartureMs = parseIsoMs(summary.actual_departure_local);
  const actualArrivalMs = parseIsoMs(summary.actual_arrival_local);
  const departureMs = Number.isFinite(actualDepartureMs)
    ? actualDepartureMs
    : parseIsoMs(summary.estimated_departure_local) || parseIsoMs(summary.scheduled_departure_local);

  const nowMs = now.getTime();
  const minutesToDeparture = Number.isFinite(departureMs) ? (departureMs - nowMs) / 60000 : null;
  const hasArrived = Number.isFinite(actualArrivalMs) || Boolean(statusCode && arrivedByStatus.has(statusCode));
  const inFlight = !hasArrived && (
    Boolean(statusCode && inFlightByStatus.has(statusCode))
    || (Number.isFinite(actualDepartureMs) && !Number.isFinite(actualArrivalMs))
  );

  if (hasArrived) return 24 * 60;
  if (inFlight) return 1;

  if (minutesToDeparture !== null) {
    if (minutesToDeparture > 300) return 180;
    if (minutesToDeparture > 60) return 30;
    if (minutesToDeparture >= 0) return 5;
  }

  return fallback;
};

const pickLufthansaDateTime = (
  flightInfo: Record<string, unknown>,
  scope: 'Arrival' | 'Departure',
  kind: 'Scheduled' | 'Estimated' | 'Actual',
) => pickFirstString(
  readPath(flightInfo, [scope, `${kind}TimeLocal`, 'DateTime']),
  readPath(flightInfo, [scope, `${kind}TimeUTC`, 'DateTime']),
  readPath(flightInfo, [scope, `${kind}TimeUtc`, 'DateTime']),
  readPath(flightInfo, [scope, `${kind}Time`, 'DateTime']),
  readPath(flightInfo, [scope, `${kind}TimeLocal`]),
  readPath(flightInfo, [scope, `${kind}TimeUTC`]),
  readPath(flightInfo, [scope, `${kind}TimeUtc`]),
  readPath(flightInfo, [scope, `${kind}Time`]),
);

const normalizeFlightNumberPart = (value: unknown) => {
  const normalized = toNullableString(value);
  if (!normalized) return null;
  const withoutLeadingZeros = normalized.replace(/^0+/, '');
  return withoutLeadingZeros || '0';
};

const buildFlightIata = (carrier: unknown, number: unknown, fallback: string) => {
  const normalizedCarrier = normalizeCarrierCode(carrier);
  const normalizedNumber = normalizeFlightNumberPart(number);
  if (normalizedCarrier && normalizedNumber) return `${normalizedCarrier}${normalizedNumber}`;
  return fallback;
};

const buildFlightPayload = (
  provider: FlightProviderName,
  rawPayload: unknown,
  summary: FlightSummary | null,
  fetchedAtIso: string,
) => ({
  provider,
  fetched_at: fetchedAtIso,
  summary,
  raw: rawPayload,
});

const parseAllowedOperatingCarriers = () => {
  const raw = Deno.env.get('LUFTHANSA_GROUP_OPERATING_CARRIERS');
  if (!raw || !raw.trim()) {
    return new Set(DEFAULT_LUFTHANSA_GROUP_OPERATING_CARRIERS);
  }
  const values = raw
    .split(',')
    .map((value) => normalizeCarrierCode(value))
    .filter((value): value is string => Boolean(value));
  return new Set([...DEFAULT_LUFTHANSA_GROUP_OPERATING_CARRIERS, ...values]);
};

const readPath = (obj: Record<string, unknown>, path: string[]) => {
  let current: unknown = obj;
  for (const segment of path) {
    if (!current || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
};

const extractOperatingCarrier = (item: Record<string, unknown>) => {
  const directPaths = [
    ['OperatingCarrier'],
    ['operating', 'carrierCode'],
    ['operating', 'iata'],
    ['operating', 'airline_iata'],
    ['operating_carrier'],
    ['operatingCarrier'],
    ['flight', 'operating', 'iata'],
    ['flight', 'operating', 'carrierCode'],
    ['codeshared', 'airline_iata'],
    ['flight', 'codeshared', 'airline_iata'],
  ];

  for (const path of directPaths) {
    const value = readPath(item, path);
    if (typeof value === 'string') {
      const normalized = normalizeCarrierCode(value);
      if (normalized) return normalized;
      continue;
    }

    if (value && typeof value === 'object') {
      const nested = value as Record<string, unknown>;
      const nestedCarrier = [
        nested.AirlineID,
        nested.airlineID,
        nested.CarrierCode,
        nested.carrierCode,
        nested.IATA,
        nested.iata,
        nested.code,
      ];
      for (const candidate of nestedCarrier) {
        const normalized = normalizeCarrierCode(candidate);
        if (normalized) return normalized;
      }
    }
  }

  return null;
};

const readStringPath = (item: Record<string, unknown>, path: string[]) => {
  const value = readPath(item, path);
  if (typeof value !== 'string') return '';
  return value;
};

const isLufthansaGroupOperatedFlight = (
  item: Record<string, unknown>,
  allowedOperatingCarriers: Set<string>,
) => {
  const operatingCarrier = extractOperatingCarrier(item);
  if (!operatingCarrier) return false;
  return allowedOperatingCarriers.has(operatingCarrier);
};

const toPgTime = (value: string | null) => {
  if (!value) return null;
  if (/^\d{2}:\d{2}:\d{2}$/.test(value)) return value;
  if (/^\d{2}:\d{2}$/.test(value)) return `${value}:00`;
  return null;
};

const pickBestFlightInfo = (
  items: Record<string, unknown>[],
  flightIata: string,
  rideDate: string,
  allowedOperatingCarriers: Set<string>,
) => {
  if (!Array.isArray(items) || items.length === 0) return null;
  const targetIata = flightIata.toUpperCase();
  const parsedTarget = parseFlightIata(targetIata);
  const eligible = items.filter((item) => {
    if (isLufthansaGroupOperatedFlight(item, allowedOperatingCarriers)) return true;
    const operatingCarrier = extractOperatingCarrier(item);
    const marketingCarrier = normalizeCarrierCode(readPath(item, ['airline', 'iata']));
    const flightStatus = readStringPath(item, ['flight_status']).trim().toUpperCase();
    const itemFlightIata = readStringPath(item, ['flight', 'iata']).toUpperCase();
    const marketingCarrierAllowed = Boolean(marketingCarrier && allowedOperatingCarriers.has(marketingCarrier));
    const isActiveOrEnroute = ['ACTIVE', 'ENR', 'AIR', 'IN_FLIGHT', 'DEPARTED', 'DEP', 'DP'].includes(flightStatus);
    const matchesTargetIata = itemFlightIata === targetIata;
    const matchesTargetCarrier = Boolean(
      parsedTarget?.airline &&
      (marketingCarrier === parsedTarget.airline || operatingCarrier === parsedTarget.airline),
    );
    // Aviationstack sometimes omits operating carrier for valid live flights.
    if (!operatingCarrier && marketingCarrierAllowed && (matchesTargetIata || matchesTargetCarrier) && isActiveOrEnroute) {
      return true;
    }
    return false;
  });
  if (eligible.length === 0) return null;

  const byCodeAndDate = eligible.find((item) =>
    readStringPath(item, ['flight', 'iata']).toUpperCase() === targetIata &&
    readStringPath(item, ['flight_date']).slice(0, 10) === rideDate
  );
  if (byCodeAndDate) return byCodeAndDate;
  const byCodeOnly = eligible.find((item) =>
    readStringPath(item, ['flight', 'iata']).toUpperCase() === targetIata
  );
  return byCodeOnly || eligible[0];
};

const parseFlightIata = (flightIata: string) => {
  const parsed = flightIata.toUpperCase().match(/^([A-Z0-9]{2,3})(\d{1,4}[A-Z]?)$/);
  if (!parsed?.[1] || !parsed?.[2]) return null;
  return { airline: parsed[1], flightNumber: parsed[2].replace(/^0+/, '') };
};

const normalizeFlightNumber = (value: unknown) => {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, '').toUpperCase().trim();
};

const resolveSummaryReferenceDate = (summary: FlightSummary | null) => {
  const candidates = [
    summary?.actual_arrival_local,
    summary?.estimated_arrival_local,
    summary?.scheduled_arrival_local,
  ];
  for (const candidate of candidates) {
    const isoValue = toIsoDateTime(candidate);
    if (isoValue) return isoValue.slice(0, 10);
  }
  return null;
};

const extractAviationstackStateIcao24 = (flightInfo: Record<string, unknown>) => normalizeIcao24(
  pickFirstString(
    readPath(flightInfo, ['aircraft', 'icao24']),
    readPath(flightInfo, ['aircraft', 'icao_24']),
    readPath(flightInfo, ['aircraft', 'hex']),
  ),
);

const resolveIcao24FromAviationstack = async (
  flightIata: string,
  summary: FlightSummary | null,
): Promise<string | null> => {
  const apiKey = `${Deno.env.get(providerConfig.aviationstack.envKey) || ''}`.trim();
  if (!apiKey) return null;

  const parsedFlight = parseFlightIata(flightIata);
  const queries: Array<Record<string, string>> = [{ flight_iata: flightIata }];
  if (parsedFlight?.airline && parsedFlight?.flightNumber) {
    queries.push({ airline_iata: parsedFlight.airline, flight_number: parsedFlight.flightNumber });
  }

  const summaryDate = resolveSummaryReferenceDate(summary);

  for (const query of queries) {
    const flightUrl = new URL(providerConfig.aviationstack.url);
    flightUrl.searchParams.set('access_key', apiKey);
    Object.entries(query).forEach(([key, value]) => flightUrl.searchParams.set(key, value));

    const response = await fetch(flightUrl.toString());
    if (!response.ok) continue;
    const payload = await response.json().catch(() => ({}));
    const items = toRecordArray(readPath(payload as Record<string, unknown>, ['data']));
    if (!items.length) continue;

    const normalizedFlightIata = normalizeFlightNumber(flightIata);
    const scored = items
      .map((item) => {
        const icao24 = extractAviationstackStateIcao24(item);
        if (!icao24) return null;
        const itemFlightIata = normalizeFlightNumber(readStringPath(item, ['flight', 'iata']));
        const itemFlightDate = readStringPath(item, ['flight_date']).slice(0, 10);
        const score =
          (itemFlightIata && itemFlightIata === normalizedFlightIata ? 100 : 0)
          + (summaryDate && itemFlightDate === summaryDate ? 80 : 0)
          + (itemFlightDate ? 10 : 0);
        return { icao24, score };
      })
      .filter((entry): entry is { icao24: string; score: number } => Boolean(entry));

    scored.sort((left, right) => right.score - left.score);
    if (scored[0]?.icao24) return scored[0].icao24;
  }

  return null;
};

const extractFlightSummaryFromPayload = (payload: unknown): FlightSummary | null => {
  const root = toRecord(payload);
  if (!root) return null;
  const summaryNode = readPath(root, ['summary']);
  if (!summaryNode || typeof summaryNode !== 'object' || Array.isArray(summaryNode)) return null;
  const summary = summaryNode as Record<string, unknown>;
  const flightIata = toNullableString(summary.flight_iata) || '';
  if (!flightIata) return null;
  return {
    provider: summary.provider === 'aviationstack' ? 'aviationstack' : 'lufthansa_open_api',
    flight_iata: flightIata,
    operating_carrier: toNullableString(summary.operating_carrier),
    operating_flight_number: toNullableString(summary.operating_flight_number),
    marketing_carrier: toNullableString(summary.marketing_carrier),
    marketing_flight_number: toNullableString(summary.marketing_flight_number),
    flight_status_code: toNullableString(summary.flight_status_code),
    flight_status_description: toNullableString(summary.flight_status_description),
    departure_airport: toNullableString(summary.departure_airport),
    departure_terminal: toNullableString(summary.departure_terminal),
    departure_gate: toNullableString(summary.departure_gate),
    arrival_airport: toNullableString(summary.arrival_airport),
    arrival_terminal: toNullableString(summary.arrival_terminal),
    arrival_gate: toNullableString(summary.arrival_gate),
    scheduled_departure_local: toNullableString(summary.scheduled_departure_local),
    estimated_departure_local: toNullableString(summary.estimated_departure_local),
    actual_departure_local: toNullableString(summary.actual_departure_local),
    scheduled_arrival_local: toNullableString(summary.scheduled_arrival_local),
    estimated_arrival_local: toNullableString(summary.estimated_arrival_local),
    actual_arrival_local: toNullableString(summary.actual_arrival_local),
    aircraft_code: toNullableString(summary.aircraft_code),
    aircraft_registration: toNullableString(summary.aircraft_registration),
    aircraft_icao24: normalizeIcao24(summary.aircraft_icao24),
    delay_minutes: toFiniteNumber(summary.delay_minutes),
  };
};

const extractLiveTrackingFromPayload = (payload: unknown) => {
  const root = toRecord(payload);
  if (!root) return null;
  const liveTrackingNode = readPath(root, ['live_tracking']);
  if (!liveTrackingNode || typeof liveTrackingNode !== 'object' || Array.isArray(liveTrackingNode)) return null;
  return liveTrackingNode as Record<string, unknown>;
};

const buildOpenSkyCallsignCandidates = (flightIata: string, summary: FlightSummary | null) => {
  const candidates = new Set<string>();
  const addCandidate = (value: unknown) => {
    const normalized = normalizeCallsign(value);
    if (normalized) candidates.add(normalized);
  };
  const addNumberCandidates = (prefix: string, numberValue: string | null) => {
    const normalizedPrefix = normalizeCallsignPrefix(prefix);
    if (!normalizedPrefix) return;
    const normalizedNumber = normalizeFlightNumberPart(numberValue);
    if (!normalizedNumber) return;
    addCandidate(`${normalizedPrefix}${normalizedNumber}`);
    const match = normalizedNumber.match(/^(\d+)([A-Z]?)$/);
    if (match?.[1]) {
      addCandidate(`${normalizedPrefix}${match[1].padStart(4, '0')}${match[2] || ''}`);
    }
  };
  const resolveIcaoPrefixes = (carrier: string | null) => {
    if (!carrier) return [] as string[];
    const normalizedCarrier = carrier.trim().toUpperCase();
    if (!normalizedCarrier) return [] as string[];
    const mapped = IATA_TO_ICAO_CALLSIGN_PREFIX[normalizedCarrier] || [];
    if (normalizedCarrier.length === 3) return Array.from(new Set([normalizedCarrier, ...mapped]));
    return Array.from(new Set(mapped));
  };

  addCandidate(flightIata);
  const parsed = parseFlightIata(flightIata);
  if (parsed) {
    addCandidate(`${parsed.airline}${parsed.flightNumber}`);
    const numberMatch = parsed.flightNumber.match(/^(\d+)([A-Z]?)$/);
    if (numberMatch?.[1]) {
      const withLeadingZeros = `${parsed.airline}${numberMatch[1].padStart(4, '0')}${numberMatch[2] || ''}`;
      addCandidate(withLeadingZeros);
    }
    resolveIcaoPrefixes(parsed.airline).forEach((prefix) => addNumberCandidates(prefix, parsed.flightNumber));
  }

  addCandidate(
    summary?.operating_carrier && summary?.operating_flight_number
      ? `${summary.operating_carrier}${summary.operating_flight_number}`
      : null,
  );
  addCandidate(
    summary?.marketing_carrier && summary?.marketing_flight_number
      ? `${summary.marketing_carrier}${summary.marketing_flight_number}`
      : null,
  );
  resolveIcaoPrefixes(summary?.operating_carrier || null)
    .forEach((prefix) => addNumberCandidates(prefix, summary?.operating_flight_number || null));
  resolveIcaoPrefixes(summary?.marketing_carrier || null)
    .forEach((prefix) => addNumberCandidates(prefix, summary?.marketing_flight_number || null));

  const sorted = Array.from(candidates);
  sorted.sort((left, right) => left.length - right.length);
  return sorted;
};

const buildOpenSkyCallsignPrefixCandidates = (flightIata: string, summary: FlightSummary | null) => {
  const prefixes = new Set<string>();
  const addPrefix = (value: unknown) => {
    const normalized = normalizeCallsignPrefix(value);
    if (normalized) prefixes.add(normalized);
  };
  const addCarrierPrefixes = (carrier: string | null) => {
    if (!carrier) return;
    const normalized = carrier.trim().toUpperCase();
    if (!normalized) return;
    if (normalized.length === 3) addPrefix(normalized);
    (IATA_TO_ICAO_CALLSIGN_PREFIX[normalized] || []).forEach((prefix) => addPrefix(prefix));
  };

  const parsed = parseFlightIata(flightIata);
  addCarrierPrefixes(parsed?.airline || null);
  addCarrierPrefixes(summary?.operating_carrier || null);
  addCarrierPrefixes(summary?.marketing_carrier || null);

  return Array.from(prefixes);
};

const haversineDistanceKm = (
  leftLat: number,
  leftLng: number,
  rightLat: number,
  rightLng: number,
) => {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const earthRadiusKm = 6371;
  const dLat = toRad(rightLat - leftLat);
  const dLng = toRad(rightLng - leftLng);
  const lat1 = toRad(leftLat);
  const lat2 = toRad(rightLat);
  const a = (Math.sin(dLat / 2) ** 2) + (Math.cos(lat1) * Math.cos(lat2) * (Math.sin(dLng / 2) ** 2));
  return 2 * earthRadiusKm * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

const computeOpenSkySecondaryEta = (
  state: OpenSkyState,
  arrivalAirport: AirportGeo | null,
  now: Date,
) => {
  if (!arrivalAirport) return null;
  if (state.onGround) return null;

  const speedMs = toFiniteNumber(state.velocityMs);
  if (speedMs === null || speedMs < 55) return null;

  const distanceKm = haversineDistanceKm(
    state.latitude,
    state.longitude,
    arrivalAirport.lat,
    arrivalAirport.lng,
  );
  if (!Number.isFinite(distanceKm) || distanceKm <= 0.3 || distanceKm > 2000) return null;

  const etaSecondsRaw = (distanceKm * 1000) / speedMs;
  if (!Number.isFinite(etaSecondsRaw) || etaSecondsRaw <= 0 || etaSecondsRaw > 6 * 3600) return null;

  const etaSeconds = Math.round(etaSecondsRaw);
  const etaMinutes = Math.max(1, Math.round(etaSeconds / 60));
  const etaIso = new Date(now.getTime() + (etaSeconds * 1000)).toISOString();

  return {
    etaIso,
    etaSeconds,
    etaMinutes,
    distanceKm: Number(distanceKm.toFixed(2)),
    speedMs: Number(speedMs.toFixed(2)),
    speedKmh: Number((speedMs * 3.6).toFixed(1)),
  };
};

const calculateBearingDeg = (
  fromLat: number,
  fromLng: number,
  toLat: number,
  toLng: number,
) => {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const toDeg = (value: number) => (value * 180) / Math.PI;
  const lat1 = toRad(fromLat);
  const lat2 = toRad(toLat);
  const dLng = toRad(toLng - fromLng);
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = (Math.cos(lat1) * Math.sin(lat2)) - (Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng));
  const raw = toDeg(Math.atan2(y, x));
  return ((raw % 360) + 360) % 360;
};

const bearingDeltaDeg = (leftDeg: number | null, rightDeg: number | null) => {
  if (!Number.isFinite(leftDeg) || !Number.isFinite(rightDeg)) return null;
  const left = Number(leftDeg);
  const right = Number(rightDeg);
  const delta = Math.abs(left - right) % 360;
  return delta > 180 ? 360 - delta : delta;
};

const distanceToRouteSegmentKm = (
  pointLat: number,
  pointLng: number,
  fromAirport: AirportGeo,
  toAirport: AirportGeo,
) => {
  const refLatRad = ((fromAirport.lat + toAirport.lat) / 2) * (Math.PI / 180);
  const kmPerLat = 111.32;
  const kmPerLng = 111.32 * Math.cos(refLatRad);

  const ax = fromAirport.lng * kmPerLng;
  const ay = fromAirport.lat * kmPerLat;
  const bx = toAirport.lng * kmPerLng;
  const by = toAirport.lat * kmPerLat;
  const px = pointLng * kmPerLng;
  const py = pointLat * kmPerLat;

  const abx = bx - ax;
  const aby = by - ay;
  const apx = px - ax;
  const apy = py - ay;
  const abLenSq = (abx * abx) + (aby * aby);
  if (abLenSq <= 0) {
    return Math.hypot(px - ax, py - ay);
  }

  const t = Math.max(0, Math.min(1, ((apx * abx) + (apy * aby)) / abLenSq));
  const closestX = ax + (abx * t);
  const closestY = ay + (aby * t);
  return Math.hypot(px - closestX, py - closestY);
};

const parseHexDbRoute = (value: unknown): HexDbRoute | null => {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toUpperCase();
  if (!normalized) return null;
  const segments = normalized.split(/[-/>\s]+/g).filter(Boolean);
  if (segments.length < 2) return null;
  const first = segments[0];
  const last = segments[segments.length - 1];
  const departureIata = normalizeIataCode(first);
  const arrivalIata = normalizeIataCode(last);
  const departureIcao = normalizeIcaoCode(first);
  const arrivalIcao = normalizeIcaoCode(last);
  if (!departureIata && !departureIcao) return null;
  if (!arrivalIata && !arrivalIcao) return null;
  return {
    departureIata,
    arrivalIata,
    departureIcao,
    arrivalIcao,
  };
};

const extractHexDbRoutePayload = (payload: unknown): HexDbRoute | null => {
  if (!payload) return null;
  if (typeof payload === 'string') return parseHexDbRoute(payload);
  if (Array.isArray(payload)) {
    for (const entry of payload) {
      const route = extractHexDbRoutePayload(entry);
      if (route) return route;
    }
    return null;
  }
  if (typeof payload !== 'object') return null;
  const source = payload as Record<string, unknown>;
  const candidates = [source.route, source.Route, source.data, source.result, source.results];
  for (const candidate of candidates) {
    const route = extractHexDbRoutePayload(candidate);
    if (route) return route;
  }
  return null;
};

const extractHexDbAircraftPayload = (payload: unknown): HexDbAircraft | null => {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const source = payload as Record<string, unknown>;
  return {
    registration: toNullableString(
      source.Registration
      ?? source.registration
      ?? source.Reg
      ?? source.reg,
    ),
    operatorFlagCode: normalizeCallsignPrefix(
      source.OperatorFlagCode
      ?? source.operatorFlagCode
      ?? source.Operator
      ?? source.operator,
    ),
  };
};

const parseAirportGeoFromPayload = (payload: unknown): AirportGeo | null => {
  if (!payload) return null;
  if (Array.isArray(payload)) {
    for (const item of payload) {
      const parsed = parseAirportGeoFromPayload(item);
      if (parsed) return parsed;
    }
    return null;
  }
  if (typeof payload !== 'object') return null;
  const source = payload as Record<string, unknown>;
  const lat = toFiniteNumber(
    source.lat ?? source.latitude ?? source.lat_deg ?? source.geo_lat ?? source.y ?? source.coordinates_lat,
  );
  const lng = toFiniteNumber(
    source.lng ?? source.lon ?? source.long ?? source.longitude ?? source.lon_deg ?? source.geo_lon ?? source.x ??
      source.coordinates_lon,
  );
  if (lat === null || lng === null) {
    const nested = [source.airport, source.data, source.result, source.results];
    for (const candidate of nested) {
      const parsed = parseAirportGeoFromPayload(candidate);
      if (parsed) return parsed;
    }
    return null;
  }
  return {
    iata: normalizeIataCode(source.iata ?? source.IATA ?? source.iata_code ?? source.iataCode),
    icao: normalizeIcaoCode(source.icao ?? source.ICAO ?? source.icao_code ?? source.icaoCode),
    lat,
    lng,
  };
};

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const buildFlightBbox = (fromAirport: AirportGeo | null, toAirport: AirportGeo | null) => {
  const airports = [fromAirport, toAirport].filter((value): value is AirportGeo => Boolean(value));
  if (!airports.length) return null;
  const lats = airports.map((airport) => airport.lat);
  const lngs = airports.map((airport) => airport.lng);
  let lamin = Math.min(...lats) - 2.5;
  let lamax = Math.max(...lats) + 2.5;
  let lomin = Math.min(...lngs) - 4;
  let lomax = Math.max(...lngs) + 4;

  const latSpan = lamax - lamin;
  if (latSpan > FLIGHT_LIVE_MAX_BBOX_SPAN_DEG) {
    const latMid = (lamax + lamin) / 2;
    lamin = latMid - (FLIGHT_LIVE_MAX_BBOX_SPAN_DEG / 2);
    lamax = latMid + (FLIGHT_LIVE_MAX_BBOX_SPAN_DEG / 2);
  }

  const lonSpan = lomax - lomin;
  if (lonSpan > FLIGHT_LIVE_MAX_BBOX_SPAN_DEG) {
    const lonMid = (lomax + lomin) / 2;
    lomin = lonMid - (FLIGHT_LIVE_MAX_BBOX_SPAN_DEG / 2);
    lomax = lonMid + (FLIGHT_LIVE_MAX_BBOX_SPAN_DEG / 2);
  }

  return {
    lamin: clamp(lamin, -90, 90),
    lamax: clamp(lamax, -90, 90),
    lomin: clamp(lomin, -180, 180),
    lomax: clamp(lomax, -180, 180),
  };
};

const getOpenSkyAccessToken = async (): Promise<string | null> => {
  const clientId = `${Deno.env.get(providerConfig.openSky.clientIdEnvKey) || ''}`.trim();
  const clientSecret = `${Deno.env.get(providerConfig.openSky.clientSecretEnvKey) || ''}`.trim();
  if (!clientId || !clientSecret) return null;

  if (openSkyTokenCache && Date.now() < openSkyTokenCache.expiresAtMs - 30_000) {
    return openSkyTokenCache.accessToken;
  }

  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
  });

  const response = await fetch(providerConfig.openSky.tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: body.toString(),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`opensky_token_http_${response.status}`);
  }
  const accessToken = typeof payload?.access_token === 'string' ? payload.access_token.trim() : '';
  const expiresIn = asNumber(payload?.expires_in, 1800);
  if (!accessToken) throw new Error('opensky_token_missing');

  openSkyTokenCache = {
    accessToken,
    expiresAtMs: Date.now() + Math.max(120, expiresIn) * 1000,
  };
  return accessToken;
};

const fetchHexDbRouteForCallsign = async (callsign: string): Promise<HexDbRoute | null> => {
  const normalizedCallsign = normalizeCallsign(callsign);
  if (!normalizedCallsign) return null;
  const routeUrl = `${providerConfig.hexdb.apiBaseUrl}/route/iata/${encodeURIComponent(normalizedCallsign)}`;
  const response = await fetch(routeUrl, {
    headers: {
      Accept: 'application/json',
    },
  });
  if (!response.ok) return null;
  const payload = await response.json().catch(() => null);
  return extractHexDbRoutePayload(payload);
};

const fetchHexDbAircraftByHex = async (icao24: string): Promise<HexDbAircraft | null> => {
  const normalizedHex = normalizeIcao24(icao24);
  if (!normalizedHex) return null;

  const cached = hexDbAircraftCache.get(normalizedHex);
  if (cached && Date.now() < cached.expiresAtMs) {
    return cached.value;
  }

  const aircraftUrl = `${providerConfig.hexdb.apiBaseUrl}/aircraft/${encodeURIComponent(normalizedHex)}`;
  const response = await fetch(aircraftUrl, {
    headers: {
      Accept: 'application/json',
    },
  });
  if (!response.ok) {
    hexDbAircraftCache.set(normalizedHex, { value: null, expiresAtMs: Date.now() + (2 * 60 * 1000) });
    return null;
  }

  const payload = await response.json().catch(() => null);
  const aircraft = extractHexDbAircraftPayload(payload);
  hexDbAircraftCache.set(normalizedHex, { value: aircraft, expiresAtMs: Date.now() + (10 * 60 * 1000) });
  return aircraft;
};

const fetchHexDbAirportByIata = async (iataCode: string): Promise<AirportGeo | null> => {
  const normalizedIata = normalizeIataCode(iataCode);
  if (!normalizedIata) return null;
  const airportUrl = `${providerConfig.hexdb.apiBaseUrl}/airport/iata/${encodeURIComponent(normalizedIata)}`;
  const response = await fetch(airportUrl, {
    headers: {
      Accept: 'application/json',
    },
  });
  if (!response.ok) return null;
  const payload = await response.json().catch(() => null);
  return parseAirportGeoFromPayload(payload);
};

const parseOpenSkyStates = (payload: unknown): OpenSkyState[] => {
  const statesNode = payload && typeof payload === 'object' && !Array.isArray(payload)
    ? (payload as Record<string, unknown>).states
    : null;
  if (!Array.isArray(statesNode)) return [];

  const normalizedStates: OpenSkyState[] = [];
  for (const raw of statesNode) {
    if (Array.isArray(raw)) {
      const icao24 = normalizeIcao24(raw[0]);
      const longitude = toFiniteNumber(raw[5]);
      const latitude = toFiniteNumber(raw[6]);
      if (!icao24 || longitude === null || latitude === null) continue;
      normalizedStates.push({
        icao24,
        callsign: toNullableString(raw[1]),
        longitude,
        latitude,
        onGround: Boolean(raw[8]),
        velocityMs: toFiniteNumber(raw[9]),
        trueTrackDeg: toFiniteNumber(raw[10]),
        verticalRateMs: toFiniteNumber(raw[11]),
        baroAltitudeM: toFiniteNumber(raw[7]),
        geoAltitudeM: toFiniteNumber(raw[13]),
        lastContactEpoch: toEpochSeconds(raw[4]),
        timePositionEpoch: toEpochSeconds(raw[3]),
      });
      continue;
    }
    if (raw && typeof raw === 'object') {
      const stateObj = raw as Record<string, unknown>;
      const icao24 = normalizeIcao24(
        stateObj.icao24 ?? stateObj.icao_24 ?? stateObj.hex ?? stateObj.radar_hex,
      );
      const longitude = toFiniteNumber(stateObj.longitude ?? stateObj.lon ?? stateObj.lng);
      const latitude = toFiniteNumber(stateObj.latitude ?? stateObj.lat);
      if (!icao24 || longitude === null || latitude === null) continue;
      normalizedStates.push({
        icao24,
        callsign: toNullableString(stateObj.callsign),
        longitude,
        latitude,
        onGround: Boolean(stateObj.on_ground ?? stateObj.onGround),
        velocityMs: toFiniteNumber(stateObj.velocity ?? stateObj.velocity_ms ?? stateObj.speed),
        trueTrackDeg: toFiniteNumber(stateObj.true_track ?? stateObj.heading),
        verticalRateMs: toFiniteNumber(stateObj.vertical_rate ?? stateObj.verticalRate),
        baroAltitudeM: toFiniteNumber(stateObj.baro_altitude ?? stateObj.baroAltitude),
        geoAltitudeM: toFiniteNumber(stateObj.geo_altitude ?? stateObj.geoAltitude),
        lastContactEpoch: toEpochSeconds(stateObj.last_contact ?? stateObj.lastContact),
        timePositionEpoch: toEpochSeconds(stateObj.time_position ?? stateObj.timePosition),
      });
    }
  }

  return normalizedStates;
};

const parseOpenSkyTrackPoints = (payload: unknown): OpenSkyTrackPoint[] => {
  const pathNode = payload && typeof payload === 'object' && !Array.isArray(payload)
    ? (
      (payload as Record<string, unknown>).path
      ?? (payload as Record<string, unknown>).track
      ?? (payload as Record<string, unknown>).states
    )
    : null;
  if (!Array.isArray(pathNode)) return [];

  const parsed: OpenSkyTrackPoint[] = [];
  for (const raw of pathNode) {
    if (Array.isArray(raw)) {
      const lat = toFiniteNumber(raw[1]);
      const lng = toFiniteNumber(raw[2]);
      if (lat === null || lng === null) continue;
      parsed.push({
        timeEpoch: toEpochSeconds(raw[0]),
        latitude: lat,
        longitude: lng,
        headingDeg: toFiniteNumber(raw[4]),
        onGround: typeof raw[5] === 'boolean' ? raw[5] : null,
      });
      continue;
    }
    if (raw && typeof raw === 'object') {
      const pointObj = raw as Record<string, unknown>;
      const lat = toFiniteNumber(pointObj.latitude ?? pointObj.lat);
      const lng = toFiniteNumber(pointObj.longitude ?? pointObj.lon ?? pointObj.lng);
      if (lat === null || lng === null) continue;
      parsed.push({
        timeEpoch: toEpochSeconds(pointObj.time ?? pointObj.timestamp ?? pointObj.epoch),
        latitude: lat,
        longitude: lng,
        headingDeg: toFiniteNumber(pointObj.true_track ?? pointObj.heading),
        onGround: typeof pointObj.on_ground === 'boolean'
          ? pointObj.on_ground
          : typeof pointObj.onGround === 'boolean'
          ? pointObj.onGround
          : null,
      });
    }
  }

  parsed.sort((left, right) => {
    if (left.timeEpoch === null && right.timeEpoch === null) return 0;
    if (left.timeEpoch === null) return -1;
    if (right.timeEpoch === null) return 1;
    return left.timeEpoch - right.timeEpoch;
  });

  const deduped: OpenSkyTrackPoint[] = [];
  for (const point of parsed) {
    const prev = deduped[deduped.length - 1];
    if (
      prev
      && Math.abs(prev.latitude - point.latitude) < 0.00001
      && Math.abs(prev.longitude - point.longitude) < 0.00001
    ) {
      continue;
    }
    deduped.push(point);
  }

  return deduped;
};

const clampOpenSkyTrackPoints = (points: OpenSkyTrackPoint[], maxPoints = OPENSKY_MAX_TRACK_POINTS) => {
  if (!Array.isArray(points) || points.length <= maxPoints) return Array.isArray(points) ? points : [];
  if (maxPoints < 2) return [points[points.length - 1]];

  const step = (points.length - 1) / (maxPoints - 1);
  const sampled: OpenSkyTrackPoint[] = [];
  for (let i = 0; i < maxPoints; i += 1) {
    const index = Math.min(points.length - 1, Math.round(i * step));
    sampled.push(points[index]);
  }
  return sampled;
};

const pickBestOpenSkyState = (
  states: OpenSkyState[],
  callsignCandidates: string[],
  callsignPrefixes: string[],
  preferredIcao24: string | null,
  fromAirport: AirportGeo | null,
  toAirport: AirportGeo | null,
  nowEpoch: number,
) => {
  if (!Array.isArray(states) || states.length === 0) return null;
  const normalizedCandidates = new Set(
    callsignCandidates
      .map((value) => normalizeCallsign(value))
      .filter((value): value is string => Boolean(value)),
  );
  const normalizedPrefixes = new Set(
    callsignPrefixes
      .map((value) => normalizeCallsignPrefix(value))
      .filter((value): value is string => Boolean(value)),
  );
  const hasRoute = Boolean(fromAirport && toAirport);
  const routeBearingDeg = hasRoute
    ? calculateBearingDeg(
      (fromAirport as AirportGeo).lat,
      (fromAirport as AirportGeo).lng,
      (toAirport as AirportGeo).lat,
      (toAirport as AirportGeo).lng,
    )
    : null;

  const scored = states.map((state) => {
    const stateCallsign = normalizeCallsign(state.callsign || '');
    const statePrefix = normalizeCallsignPrefix(state.callsign || '');
    const matchesCallsign = stateCallsign ? normalizedCandidates.has(stateCallsign) : false;
    const matchesPrefix = statePrefix ? normalizedPrefixes.has(statePrefix) : false;
    const matchesIcao24 = Boolean(preferredIcao24 && state.icao24 === preferredIcao24);
    if (!matchesCallsign && normalizedPrefixes.size > 0 && !matchesPrefix && !matchesIcao24) return null;
    if (!matchesCallsign && normalizedCandidates.size > 0 && !matchesPrefix && !matchesIcao24) return null;

    const lastContact = state.lastContactEpoch || state.timePositionEpoch || 0;
    const stalenessSec = lastContact > 0 ? Math.max(0, nowEpoch - lastContact) : Number.POSITIVE_INFINITY;
    const freshnessScore = Number.isFinite(stalenessSec) ? Math.max(0, 240 - stalenessSec) : 0;

    const routeDistanceKm = hasRoute
      ? distanceToRouteSegmentKm(state.latitude, state.longitude, fromAirport as AirportGeo, toAirport as AirportGeo)
      : Number.POSITIVE_INFINITY;
    const departureDistanceKm = fromAirport
      ? haversineDistanceKm(state.latitude, state.longitude, fromAirport.lat, fromAirport.lng)
      : Number.POSITIVE_INFINITY;
    const arrivalDistanceKm = toAirport
      ? haversineDistanceKm(state.latitude, state.longitude, toAirport.lat, toAirport.lng)
      : Number.POSITIVE_INFINITY;
    const minEndpointDistanceKm = Math.min(departureDistanceKm, arrivalDistanceKm);
    const inRouteArea = hasRoute
      ? (
        routeDistanceKm <= FLIGHT_LIVE_ROUTE_CORRIDOR_KM
        || departureDistanceKm <= FLIGHT_LIVE_AIRPORT_RADIUS_KM
        || arrivalDistanceKm <= FLIGHT_LIVE_AIRPORT_RADIUS_KM
      )
      : true;
    if (!inRouteArea && !matchesCallsign) return null;

    const headingDelta = bearingDeltaDeg(state.trueTrackDeg, routeBearingDeg);
    const headingRelaxed = minEndpointDistanceKm <= FLIGHT_LIVE_HEADING_RELAX_AIRPORT_RADIUS_KM || state.onGround;
    const headingOk = headingRelaxed || headingDelta === null || headingDelta <= FLIGHT_LIVE_HEADING_MAX_DELTA_DEG;
    if (!headingOk && !matchesCallsign) return null;

    const routeScore = Number.isFinite(routeDistanceKm) ? Math.max(0, 160 - routeDistanceKm) : 0;
    const endpointScore = Number.isFinite(minEndpointDistanceKm) ? Math.max(0, 120 - minEndpointDistanceKm) : 0;
    const headingScore = headingDelta === null ? 0 : Math.max(0, 120 - headingDelta);
    const airborneScore = state.onGround ? 0 : 80;
    return {
      state,
      matchesCallsign,
      matchesPrefix,
      matchesIcao24,
      score: (matchesCallsign ? 1_000_000 : 0)
        + (matchesPrefix ? 100_000 : 0)
        + (matchesIcao24 ? 50_000 : 0)
        + (airborneScore * 100)
        + (freshnessScore * 100)
        + (routeScore * 100)
        + (endpointScore * 50)
        + (headingScore * 60),
    };
  }).filter((entry): entry is {
    state: OpenSkyState;
    matchesCallsign: boolean;
    matchesPrefix: boolean;
    matchesIcao24: boolean;
    score: number;
  } => Boolean(entry));

  scored.sort((left, right) => right.score - left.score);
  const best = scored[0];
  if (!best) return null;
  if (!best.matchesCallsign && normalizedCandidates.size > 0 && !best.matchesPrefix && !best.matchesIcao24) return null;
  return best.state;
};

const pickFallbackOpenSkyStateByPrefixAndRoute = (
  states: OpenSkyState[],
  callsignPrefixes: string[],
  fromAirport: AirportGeo | null,
  toAirport: AirportGeo | null,
  nowEpoch: number,
) => {
  if (!Array.isArray(states) || states.length === 0 || !Array.isArray(callsignPrefixes) || callsignPrefixes.length === 0) {
    return null;
  }
  const normalizedPrefixes = new Set(
    callsignPrefixes
      .map((prefix) => normalizeCallsignPrefix(prefix))
      .filter((value): value is string => Boolean(value)),
  );
  if (!normalizedPrefixes.size) return null;

  const hasRoute = Boolean(fromAirport && toAirport);
  const ranked = states
    .map((state) => {
      const statePrefix = normalizeCallsignPrefix(state.callsign || '');
      if (!statePrefix || !normalizedPrefixes.has(statePrefix)) return null;
      const lastContact = state.lastContactEpoch || state.timePositionEpoch || 0;
      const stalenessSec = lastContact > 0 ? Math.max(0, nowEpoch - lastContact) : Number.POSITIVE_INFINITY;
      const routeDistanceKm = hasRoute
        ? distanceToRouteSegmentKm(state.latitude, state.longitude, fromAirport as AirportGeo, toAirport as AirportGeo)
        : Number.POSITIVE_INFINITY;
      const departureDistanceKm = fromAirport
        ? haversineDistanceKm(state.latitude, state.longitude, fromAirport.lat, fromAirport.lng)
        : Number.POSITIVE_INFINITY;
      const arrivalDistanceKm = toAirport
        ? haversineDistanceKm(state.latitude, state.longitude, toAirport.lat, toAirport.lng)
        : Number.POSITIVE_INFINITY;

      const inRouteArea = hasRoute
        ? (
          routeDistanceKm <= FLIGHT_LIVE_ROUTE_CORRIDOR_KM
          || departureDistanceKm <= FLIGHT_LIVE_AIRPORT_RADIUS_KM
          || arrivalDistanceKm <= FLIGHT_LIVE_AIRPORT_RADIUS_KM
        )
        : true;
      if (!inRouteArea) return null;

      const freshnessScore = Number.isFinite(stalenessSec) ? Math.max(0, 180 - stalenessSec) : 0;
      const routeScore = Number.isFinite(routeDistanceKm) ? Math.max(0, 220 - routeDistanceKm) : 0;
      const endpointScore = Number.isFinite(Math.min(departureDistanceKm, arrivalDistanceKm))
        ? Math.max(0, 180 - Math.min(departureDistanceKm, arrivalDistanceKm))
        : 0;
      const airborneScore = state.onGround ? 0 : 120;
      return {
        state,
        score: (airborneScore * 1000) + (freshnessScore * 100) + (routeScore * 10) + endpointScore,
      };
    })
    .filter((entry): entry is { state: OpenSkyState; score: number } => Boolean(entry));

  ranked.sort((left, right) => right.score - left.score);
  return ranked[0]?.state || null;
};

const pickOpenSkyStateByAircraftRegistration = async ({
  states,
  registration,
  callsignPrefixes,
  fromAirport,
  toAirport,
  nowEpoch,
}: {
  states: OpenSkyState[];
  registration: string | null;
  callsignPrefixes: string[];
  fromAirport: AirportGeo | null;
  toAirport: AirportGeo | null;
  nowEpoch: number;
}) => {
  const normalizedRegistration = normalizeAircraftRegistration(registration);
  if (!Array.isArray(states) || states.length === 0 || !normalizedRegistration) {
    return {
      state: null as OpenSkyState | null,
      lookupCalls: 0,
      matchedRegistration: null as string | null,
    };
  }

  const normalizedPrefixes = new Set(
    callsignPrefixes
      .map((prefix) => normalizeCallsignPrefix(prefix))
      .filter((value): value is string => Boolean(value)),
  );
  const hasRoute = Boolean(fromAirport && toAirport);
  if (!hasRoute && normalizedPrefixes.size === 0) {
    return {
      state: null as OpenSkyState | null,
      lookupCalls: 0,
      matchedRegistration: null as string | null,
    };
  }

  const rankedCandidates = states
    .map((state) => {
      const statePrefix = normalizeCallsignPrefix(state.callsign || '');
      const matchesPrefix = statePrefix ? normalizedPrefixes.has(statePrefix) : false;
      if (!hasRoute && normalizedPrefixes.size > 0 && !matchesPrefix) return null;

      const lastContact = state.lastContactEpoch || state.timePositionEpoch || 0;
      const stalenessSec = lastContact > 0 ? Math.max(0, nowEpoch - lastContact) : Number.POSITIVE_INFINITY;
      const freshnessScore = Number.isFinite(stalenessSec) ? Math.max(0, 180 - stalenessSec) : 0;
      const routeDistanceKm = hasRoute
        ? distanceToRouteSegmentKm(state.latitude, state.longitude, fromAirport as AirportGeo, toAirport as AirportGeo)
        : Number.POSITIVE_INFINITY;
      const departureDistanceKm = fromAirport
        ? haversineDistanceKm(state.latitude, state.longitude, fromAirport.lat, fromAirport.lng)
        : Number.POSITIVE_INFINITY;
      const arrivalDistanceKm = toAirport
        ? haversineDistanceKm(state.latitude, state.longitude, toAirport.lat, toAirport.lng)
        : Number.POSITIVE_INFINITY;
      const inRouteArea = hasRoute
        ? (
          routeDistanceKm <= FLIGHT_LIVE_ROUTE_CORRIDOR_KM
          || departureDistanceKm <= FLIGHT_LIVE_AIRPORT_RADIUS_KM
          || arrivalDistanceKm <= FLIGHT_LIVE_AIRPORT_RADIUS_KM
        )
        : true;
      if (!inRouteArea) return null;

      const minEndpointDistanceKm = Math.min(departureDistanceKm, arrivalDistanceKm);
      const routeScore = Number.isFinite(routeDistanceKm) ? Math.max(0, 220 - routeDistanceKm) : 0;
      const endpointScore = Number.isFinite(minEndpointDistanceKm)
        ? Math.max(0, 180 - minEndpointDistanceKm)
        : 0;
      const airborneScore = state.onGround ? 0 : 120;
      return {
        state,
        score: (matchesPrefix ? 800_000 : 0)
          + (airborneScore * 1000)
          + (freshnessScore * 100)
          + (routeScore * 10)
          + endpointScore,
      };
    })
    .filter((entry): entry is { state: OpenSkyState; score: number } => Boolean(entry));

  if (!rankedCandidates.length) {
    return {
      state: null as OpenSkyState | null,
      lookupCalls: 0,
      matchedRegistration: null as string | null,
    };
  }

  rankedCandidates.sort((left, right) => right.score - left.score);

  const uniqueCandidates: Array<{ state: OpenSkyState; score: number }> = [];
  const seenHex = new Set<string>();
  for (const candidate of rankedCandidates) {
    if (seenHex.has(candidate.state.icao24)) continue;
    seenHex.add(candidate.state.icao24);
    uniqueCandidates.push(candidate);
    if (uniqueCandidates.length >= OPENSKY_REGISTRATION_LOOKUP_LIMIT) break;
  }

  let lookupCalls = 0;
  const registrationMatched: Array<{ state: OpenSkyState; score: number }> = [];
  for (const candidate of uniqueCandidates) {
    lookupCalls += 1;
    let aircraft: HexDbAircraft | null = null;
    try {
      aircraft = await fetchHexDbAircraftByHex(candidate.state.icao24);
    } catch {
      aircraft = null;
    }
    const aircraftRegistration = normalizeAircraftRegistration(aircraft?.registration);
    if (!aircraftRegistration || aircraftRegistration !== normalizedRegistration) continue;
    registrationMatched.push(candidate);
  }

  registrationMatched.sort((left, right) => right.score - left.score);
  const best = registrationMatched[0];
  return {
    state: best?.state || null,
    lookupCalls,
    matchedRegistration: best ? normalizedRegistration : null,
  };
};

const pickOpenSkyStateByHexDbRoute = async ({
  states,
  callsignPrefixes,
  departureIata,
  arrivalIata,
  fromAirport,
  toAirport,
  nowEpoch,
}: {
  states: OpenSkyState[];
  callsignPrefixes: string[];
  departureIata: string | null;
  arrivalIata: string | null;
  fromAirport: AirportGeo | null;
  toAirport: AirportGeo | null;
  nowEpoch: number;
}) => {
  if (!Array.isArray(states) || states.length === 0) {
    return { state: null as OpenSkyState | null, lookupCalls: 0, matchedCallsign: null as string | null };
  }
  if (!departureIata || !arrivalIata) {
    return { state: null as OpenSkyState | null, lookupCalls: 0, matchedCallsign: null as string | null };
  }

  const normalizedPrefixes = new Set(
    callsignPrefixes
      .map((prefix) => normalizeCallsignPrefix(prefix))
      .filter((value): value is string => Boolean(value)),
  );
  if (!normalizedPrefixes.size) {
    return { state: null as OpenSkyState | null, lookupCalls: 0, matchedCallsign: null as string | null };
  }

  const hasRoute = Boolean(fromAirport && toAirport);
  const rankedCandidates = states
    .map((state) => {
      const normalizedCallsign = normalizeCallsign(state.callsign || '');
      if (!normalizedCallsign) return null;
      const prefix = normalizeCallsignPrefix(normalizedCallsign);
      if (!prefix || !normalizedPrefixes.has(prefix)) return null;

      const lastContact = state.lastContactEpoch || state.timePositionEpoch || 0;
      const stalenessSec = lastContact > 0 ? Math.max(0, nowEpoch - lastContact) : Number.POSITIVE_INFINITY;
      const freshnessScore = Number.isFinite(stalenessSec) ? Math.max(0, 180 - stalenessSec) : 0;
      const routeDistanceKm = hasRoute
        ? distanceToRouteSegmentKm(state.latitude, state.longitude, fromAirport as AirportGeo, toAirport as AirportGeo)
        : Number.POSITIVE_INFINITY;
      const departureDistanceKm = fromAirport
        ? haversineDistanceKm(state.latitude, state.longitude, fromAirport.lat, fromAirport.lng)
        : Number.POSITIVE_INFINITY;
      const arrivalDistanceKm = toAirport
        ? haversineDistanceKm(state.latitude, state.longitude, toAirport.lat, toAirport.lng)
        : Number.POSITIVE_INFINITY;
      const inRouteArea = hasRoute
        ? (
          routeDistanceKm <= FLIGHT_LIVE_ROUTE_CORRIDOR_KM
          || departureDistanceKm <= FLIGHT_LIVE_AIRPORT_RADIUS_KM
          || arrivalDistanceKm <= FLIGHT_LIVE_AIRPORT_RADIUS_KM
        )
        : true;
      if (!inRouteArea) return null;

      const routeScore = Number.isFinite(routeDistanceKm) ? Math.max(0, 220 - routeDistanceKm) : 0;
      const endpointScore = Number.isFinite(Math.min(departureDistanceKm, arrivalDistanceKm))
        ? Math.max(0, 180 - Math.min(departureDistanceKm, arrivalDistanceKm))
        : 0;
      const airborneScore = state.onGround ? 0 : 120;
      return {
        state,
        callsign: normalizedCallsign,
        score: (airborneScore * 1000) + (freshnessScore * 100) + (routeScore * 10) + endpointScore,
      };
    })
    .filter((entry): entry is { state: OpenSkyState; callsign: string; score: number } => Boolean(entry));

  if (!rankedCandidates.length) {
    return { state: null as OpenSkyState | null, lookupCalls: 0, matchedCallsign: null as string | null };
  }

  rankedCandidates.sort((left, right) => right.score - left.score);

  const uniqueCandidates: Array<{ state: OpenSkyState; callsign: string; score: number }> = [];
  const seenCallsigns = new Set<string>();
  for (const candidate of rankedCandidates) {
    if (seenCallsigns.has(candidate.callsign)) continue;
    seenCallsigns.add(candidate.callsign);
    uniqueCandidates.push(candidate);
    if (uniqueCandidates.length >= OPENSKY_ROUTE_LOOKUP_LIMIT) break;
  }

  let lookupCalls = 0;
  const routeMatched: Array<{ state: OpenSkyState; callsign: string; score: number }> = [];
  const expectedDepartureIcao = normalizeIcaoCode(fromAirport?.icao || null);
  const expectedArrivalIcao = normalizeIcaoCode(toAirport?.icao || null);

  for (const candidate of uniqueCandidates) {
    lookupCalls += 1;
    let route: HexDbRoute | null = null;
    try {
      route = await fetchHexDbRouteForCallsign(candidate.callsign);
    } catch {
      route = null;
    }
    if (!route) continue;

    const routeDepartureIata = normalizeIataCode(route.departureIata);
    const routeArrivalIata = normalizeIataCode(route.arrivalIata);
    const routeDepartureIcao = normalizeIcaoCode(route.departureIcao);
    const routeArrivalIcao = normalizeIcaoCode(route.arrivalIcao);

    const departureMatches = Boolean(
      (routeDepartureIata && routeDepartureIata === departureIata)
      || (routeDepartureIcao && expectedDepartureIcao && routeDepartureIcao === expectedDepartureIcao),
    );
    const arrivalMatches = Boolean(
      (routeArrivalIata && routeArrivalIata === arrivalIata)
      || (routeArrivalIcao && expectedArrivalIcao && routeArrivalIcao === expectedArrivalIcao),
    );
    if (!departureMatches || !arrivalMatches) continue;

    routeMatched.push(candidate);
  }

  routeMatched.sort((left, right) => right.score - left.score);
  const best = routeMatched[0];
  return {
    state: best?.state || null,
    lookupCalls,
    matchedCallsign: best?.callsign || null,
  };
};

const shouldRefreshLiveTracking = (
  payload: unknown,
  nowEpochSeconds: number,
  summary: FlightSummary | null,
) => {
  const liveTracking = extractLiveTrackingFromPayload(payload);
  const refreshIntervalSeconds = getOpenSkyRefreshIntervalSeconds(summary, liveTracking);
  if (!refreshIntervalSeconds) {
    return false;
  }

  if (!liveTracking) return true;

  const lastErrorText = toNullableString(liveTracking.last_error);
  const lastErrorAtEpoch = toEpochSeconds(liveTracking.last_error_at);
  const isRateLimited = Boolean(lastErrorText && /opensky_.*_http_429/i.test(lastErrorText));
  if (isRateLimited && lastErrorAtEpoch) {
    const retryAfterSeconds = Math.max(0, toFiniteNumber(
      readPath(liveTracking, ['rate_limit', 'retry_after_seconds']) ?? liveTracking.retry_after_seconds,
    ) || 0);
    const backoffSeconds = Math.max(OPENSKY_RATE_LIMIT_BACKOFF_SECONDS, retryAfterSeconds);
    const ageSeconds = Math.max(0, nowEpochSeconds - lastErrorAtEpoch);
    if (ageSeconds < backoffSeconds) return false;
  }

  const capturedEpoch = toEpochSeconds(
    liveTracking.captured_at ?? liveTracking.last_contact_epoch ?? liveTracking.time_position_epoch,
  );
  if (!capturedEpoch) return true;
  return (nowEpochSeconds - capturedEpoch) >= refreshIntervalSeconds;
};

const resolveFlightLiveTracking = async ({
  flightIata,
  summary,
  currentPayload,
}: {
  flightIata: string;
  summary: FlightSummary | null;
  currentPayload: Record<string, unknown> | null;
}) => {
  const now = new Date();
  const nowIso = now.toISOString();
  const nowEpoch = Math.floor(now.getTime() / 1000);

  if (!shouldRefreshLiveTracking(currentPayload, nowEpoch, summary)) {
    return {
      payloadPatch: null,
      liveLookupError: null,
      liveLookupCallCount: 0,
      openSkyCallCount: 0,
      liveLookupHttpStatus: null,
    };
  }

  const currentLiveTracking = extractLiveTrackingFromPayload(currentPayload);
  let knownIcao24 = normalizeIcao24(
    currentLiveTracking?.radar_hex
    ?? currentLiveTracking?.icao24
    ?? summary?.aircraft_icao24,
  );
  const knownAircraftRegistration = normalizeAircraftRegistration(
    currentLiveTracking?.aircraft_registration
    ?? summary?.aircraft_registration,
  );
  const callsignCandidates = buildOpenSkyCallsignCandidates(flightIata, summary);
  const callsignPrefixCandidates = buildOpenSkyCallsignPrefixCandidates(flightIata, summary);
  const normalizedCallsignCandidates = new Set(
    callsignCandidates
      .map((candidate) => normalizeCallsign(candidate))
      .filter((candidate): candidate is string => Boolean(candidate)),
  );
  let liveLookupCallCount = 0;
  let openSkyCallCount = 0;
  let resolvedRoute: HexDbRoute | null = null;

  if (!knownIcao24) {
    liveLookupCallCount += 1;
    knownIcao24 = await resolveIcao24FromAviationstack(flightIata, summary).catch(() => null);
  }

  if (!knownIcao24) {
    for (const callsign of callsignCandidates) {
      liveLookupCallCount += 1;
      try {
        const route = await fetchHexDbRouteForCallsign(callsign);
        if (route) {
          resolvedRoute = route;
          break;
        }
      } catch {
        // Keep HexDB best effort and continue with other callsign candidates.
      }
    }
  }

  const fallbackDepartureIata = normalizeIataCode(summary?.departure_airport);
  const fallbackArrivalIata = normalizeIataCode(summary?.arrival_airport);
  const departureIata = resolvedRoute?.departureIata || fallbackDepartureIata;
  const arrivalIata = resolvedRoute?.arrivalIata || fallbackArrivalIata;

  let departureAirport: AirportGeo | null = null;
  let arrivalAirport: AirportGeo | null = null;
  if (departureIata) {
    liveLookupCallCount += 1;
    try {
      departureAirport = await fetchHexDbAirportByIata(departureIata);
    } catch {
      departureAirport = null;
    }
  }
  if (arrivalIata) {
    liveLookupCallCount += 1;
    try {
      arrivalAirport = await fetchHexDbAirportByIata(arrivalIata);
    } catch {
      arrivalAirport = null;
    }
  }

  const bbox = buildFlightBbox(departureAirport, arrivalAirport);
  let openSkyToken: string | null = null;
  let openSkyTokenError: string | null = null;
  try {
    openSkyToken = await getOpenSkyAccessToken();
  } catch (error) {
    openSkyTokenError = error instanceof Error ? error.message : 'opensky_token_failed';
  }
  const hasOpenSkyOAuthSecrets = Boolean(
    `${Deno.env.get(providerConfig.openSky.clientIdEnvKey) || ''}`.trim()
    && `${Deno.env.get(providerConfig.openSky.clientSecretEnvKey) || ''}`.trim(),
  );
  if (hasOpenSkyOAuthSecrets && !openSkyToken && openSkyTokenError) {
    return {
      payloadPatch: null,
      liveLookupError: openSkyTokenError,
      liveLookupCallCount,
      openSkyCallCount,
      liveLookupHttpStatus: null,
    };
  }

  const openSkyHeaders: HeadersInit = {
    Accept: 'application/json',
  };
  if (openSkyToken) {
    openSkyHeaders.Authorization = `Bearer ${openSkyToken}`;
  }
  let openSkyLastHttpStatus: number | null = null;
  const openSkyRateLimit = {
    remaining: null as number | null,
    limit: null as number | null,
    retryAfterSeconds: null as number | null,
    resetEpochSeconds: null as number | null,
  };

  const registerOpenSkyResponse = (response: Response) => {
    openSkyLastHttpStatus = response.status;
    const headers = extractOpenSkyRateLimitFromHeaders(response.headers);
    if (headers.remaining !== null) openSkyRateLimit.remaining = headers.remaining;
    if (headers.limit !== null) openSkyRateLimit.limit = headers.limit;
    if (headers.retryAfterSeconds !== null) openSkyRateLimit.retryAfterSeconds = headers.retryAfterSeconds;
    if (headers.resetEpochSeconds !== null) openSkyRateLimit.resetEpochSeconds = headers.resetEpochSeconds;
  };

  const fetchStatesWithQuery = async (query: Record<string, string>) => {
    const statesUrl = new URL(providerConfig.openSky.statesUrl);
    Object.entries(query).forEach(([key, value]) => statesUrl.searchParams.set(key, value));
    openSkyCallCount += 1;
    const response = await fetch(statesUrl.toString(), { headers: openSkyHeaders });
    registerOpenSkyResponse(response);
    if (!response.ok) throw new Error(`opensky_states_http_${response.status}`);
    const payload = await response.json().catch(() => ({}));
    return parseOpenSkyStates(payload);
  };

  let states: OpenSkyState[] = [];
  try {
    const statesByIcao: OpenSkyState[] = [];
    const statesByBbox: OpenSkyState[] = [];
    if (knownIcao24) {
      liveLookupCallCount += 1;
      statesByIcao.push(...(await fetchStatesWithQuery({ icao24: knownIcao24 })));
      if (!statesByIcao.length && bbox) {
        liveLookupCallCount += 1;
        statesByBbox.push(...(await fetchStatesWithQuery({
          lamin: `${bbox.lamin}`,
          lomin: `${bbox.lomin}`,
          lamax: `${bbox.lamax}`,
          lomax: `${bbox.lomax}`,
        })));
      }
    } else if (bbox) {
      liveLookupCallCount += 1;
      statesByBbox.push(...(await fetchStatesWithQuery({
        lamin: `${bbox.lamin}`,
        lomin: `${bbox.lomin}`,
        lamax: `${bbox.lamax}`,
        lomax: `${bbox.lomax}`,
      })));
    }

    const mergeStates = (items: OpenSkyState[]) => {
      const merged = new Map<string, OpenSkyState>();
      for (const state of items) {
        const normalizedStateCallsign = normalizeCallsign(state.callsign || '') || '';
        const key = `${state.icao24}:${normalizedStateCallsign}`;
        const existing = merged.get(key);
        if (!existing) {
          merged.set(key, state);
          continue;
        }
        const existingTs = existing.lastContactEpoch || existing.timePositionEpoch || 0;
        const nextTs = state.lastContactEpoch || state.timePositionEpoch || 0;
        if (nextTs >= existingTs) merged.set(key, state);
      }
      return Array.from(merged.values());
    };

    states = mergeStates([...statesByIcao, ...statesByBbox]);

    const hasExactCandidateInStates = states.some((state) => {
      const normalizedStateCallsign = normalizeCallsign(state.callsign || '');
      return Boolean(normalizedStateCallsign && normalizedCallsignCandidates.has(normalizedStateCallsign));
    });

    // Long-haul flights can be far outside a route midpoint bbox (e.g. transatlantic).
    // If we have no exact candidate and no fixed icao24, pull one global states snapshot.
    if (
      OPENSKY_ENABLE_GLOBAL_STATES_FALLBACK
      && !knownIcao24
      && normalizedCallsignCandidates.size > 0
      && !hasExactCandidateInStates
    ) {
      liveLookupCallCount += 1;
      const statesGlobal = await fetchStatesWithQuery({});
      states = mergeStates([...states, ...statesGlobal]);
    }
  } catch (error) {
    return {
      payloadPatch: null,
      liveLookupError: error instanceof Error ? error.message : 'opensky_lookup_failed',
      liveLookupCallCount,
      openSkyCallCount,
      liveLookupHttpStatus: openSkyLastHttpStatus,
    };
  }

  let bestState: OpenSkyState | null = null;
  let matchStrategy: 'exact' | 'icao24' | 'callsign_route' | 'prefix_route' | 'aircraft_registration' = 'exact';
  let matchedAircraftRegistration: string | null = null;
  if (knownAircraftRegistration) {
    const registrationMatch = await pickOpenSkyStateByAircraftRegistration({
      states,
      registration: knownAircraftRegistration,
      callsignPrefixes: callsignPrefixCandidates,
      fromAirport: departureAirport,
      toAirport: arrivalAirport,
      nowEpoch,
    });
    liveLookupCallCount += registrationMatch.lookupCalls;
    if (registrationMatch.state) {
      bestState = registrationMatch.state;
      matchStrategy = 'aircraft_registration';
      matchedAircraftRegistration = registrationMatch.matchedRegistration;
    }
  }

  if (!bestState) {
    bestState = pickBestOpenSkyState(
      states,
      callsignCandidates,
      callsignPrefixCandidates,
      knownIcao24,
      departureAirport,
      arrivalAirport,
      nowEpoch,
    );
  }
  if (
    bestState
    && matchStrategy === 'exact'
    && knownIcao24
    && bestState.icao24 === knownIcao24
  ) {
    matchStrategy = 'icao24';
  }

  const matchedCallsigns = normalizedCallsignCandidates;
  const bestStateCallsign = normalizeCallsign(bestState?.callsign || '');
  const hasExactCallsignMatch = Boolean(bestStateCallsign && matchedCallsigns.has(bestStateCallsign));
  let matchedRouteCallsign: string | null = null;

  if ((!bestState || !hasExactCallsignMatch) && matchStrategy !== 'aircraft_registration') {
    const hexDbRouteMatch = await pickOpenSkyStateByHexDbRoute({
      states,
      callsignPrefixes: callsignPrefixCandidates,
      departureIata,
      arrivalIata,
      fromAirport: departureAirport,
      toAirport: arrivalAirport,
      nowEpoch,
    });
    liveLookupCallCount += hexDbRouteMatch.lookupCalls;
    if (hexDbRouteMatch.state) {
      bestState = hexDbRouteMatch.state;
      matchStrategy = 'callsign_route';
      matchedRouteCallsign = hexDbRouteMatch.matchedCallsign;
    }
  }

  if (
    bestState
    && !hasExactCallsignMatch
    && matchStrategy !== 'callsign_route'
    && matchStrategy !== 'icao24'
    && matchStrategy !== 'aircraft_registration'
  ) {
    // Reject low-confidence prefix-only state when we could not verify route by callsign.
    bestState = null;
  }

  if (!bestState && OPENSKY_ENABLE_PREFIX_ROUTE_FALLBACK) {
    const prefixFallbackState = pickFallbackOpenSkyStateByPrefixAndRoute(
      states,
      callsignPrefixCandidates,
      departureAirport,
      arrivalAirport,
      nowEpoch,
    );
    if (prefixFallbackState) {
      bestState = prefixFallbackState;
      matchStrategy = 'prefix_route';
    }
  }

  if (
    bestState
    && matchStrategy !== 'callsign_route'
    && matchStrategy !== 'aircraft_registration'
    && matchStrategy !== 'icao24'
  ) {
    const bestStateCallsign = normalizeCallsign(bestState.callsign || '');
    const bestStatePrefix = normalizeCallsignPrefix(bestState.callsign || '');
    const isExactCandidate = bestStateCallsign
      ? callsignCandidates.some((candidate) => normalizeCallsign(candidate) === bestStateCallsign)
      : false;
    const isPrefixCandidate = bestStatePrefix
      ? callsignPrefixCandidates.some((prefix) => normalizeCallsignPrefix(prefix) === bestStatePrefix)
      : false;
    matchStrategy = isExactCandidate ? 'exact' : (isPrefixCandidate ? 'prefix_route' : 'exact');
  }
  if (!bestState) {
    return {
      payloadPatch: null,
      liveLookupError: 'opensky_state_not_found',
      liveLookupCallCount,
      openSkyCallCount,
      liveLookupHttpStatus: openSkyLastHttpStatus,
    };
  }

  const secondaryEta = computeOpenSkySecondaryEta(bestState, arrivalAirport, now);

  const fetchTrackPointsWithTime = async (icao24: string, timeEpoch: number) => {
    const trackUrl = new URL(providerConfig.openSky.tracksUrl);
    trackUrl.searchParams.set('icao24', icao24);
    trackUrl.searchParams.set('time', `${timeEpoch}`);
    openSkyCallCount += 1;
    const response = await fetch(trackUrl.toString(), { headers: openSkyHeaders });
    registerOpenSkyResponse(response);
    if (!response.ok) return [];
    const payload = await response.json().catch(() => ({}));
    return parseOpenSkyTrackPoints(payload);
  };

  let trailPoints: OpenSkyTrackPoint[] = [];
  const previousTrackSyncedEpoch = toEpochSeconds(
    currentLiveTracking?.trail_synced_at ?? currentLiveTracking?.captured_at,
  );
  const canReuseTrailPoints = Boolean(
    previousTrackSyncedEpoch && (nowEpoch - previousTrackSyncedEpoch) < OPENSKY_TRACK_REFRESH_SECONDS,
  );
  try {
    if (canReuseTrailPoints) {
      trailPoints = parseOpenSkyTrackPoints({ path: readPath(currentLiveTracking || {}, ['trail_points']) });
    } else {
      liveLookupCallCount += 1;
      trailPoints = await fetchTrackPointsWithTime(bestState.icao24, nowEpoch);
    }
  } catch {
    trailPoints = [];
  }

  const latestTrackPoint = trailPoints[trailPoints.length - 1];
  const shouldAppendCurrentState = (
    !latestTrackPoint
    || haversineDistanceKm(
      latestTrackPoint.latitude,
      latestTrackPoint.longitude,
      bestState.latitude,
      bestState.longitude,
    ) > 1
  );
  if (shouldAppendCurrentState) {
    trailPoints.push({
      timeEpoch: bestState.lastContactEpoch || bestState.timePositionEpoch || nowEpoch,
      latitude: bestState.latitude,
      longitude: bestState.longitude,
      headingDeg: bestState.trueTrackDeg,
      onGround: bestState.onGround,
    });
  }
  trailPoints = clampOpenSkyTrackPoints(trailPoints);

  const payloadPatch = {
    live_tracking: {
      provider: 'opensky',
      captured_at: nowIso,
      auth_mode: openSkyToken ? 'oauth' : 'anonymous',
      last_contact_epoch: bestState.lastContactEpoch,
      time_position_epoch: bestState.timePositionEpoch,
      radar_hex: bestState.icao24,
      icao24: bestState.icao24,
      callsign: normalizeCallsign(bestState.callsign || '') || callsignCandidates[0] || flightIata,
      latitude: bestState.latitude,
      longitude: bestState.longitude,
      match_strategy: matchStrategy,
      callsign_candidates: callsignCandidates,
      callsign_prefix_candidates: callsignPrefixCandidates,
      route_matched_callsign: matchedRouteCallsign,
      aircraft_registration: knownAircraftRegistration,
      registration_matched_value: matchedAircraftRegistration,
      registration_matched_hex: matchedAircraftRegistration ? bestState.icao24 : null,
      heading_deg: bestState.trueTrackDeg,
      velocity_mps: bestState.velocityMs,
      vertical_rate_mps: bestState.verticalRateMs,
      baro_altitude_m: bestState.baroAltitudeM,
      geo_altitude_m: bestState.geoAltitudeM,
      on_ground: bestState.onGround,
      secondary_eta: secondaryEta
        ? {
            provider: 'opensky_distance_speed',
            calculated_at: nowIso,
            eta_iso: secondaryEta.etaIso,
            eta_seconds: secondaryEta.etaSeconds,
            eta_minutes: secondaryEta.etaMinutes,
            distance_km: secondaryEta.distanceKm,
            speed_mps: secondaryEta.speedMs,
            speed_kmh: secondaryEta.speedKmh,
            arrival_iata: arrivalIata,
            arrival_icao: resolvedRoute?.arrivalIcao || normalizeIcaoCode(arrivalAirport?.icao),
            arrival_latitude: arrivalAirport?.lat ?? null,
            arrival_longitude: arrivalAirport?.lng ?? null,
          }
        : null,
      trail_source: trailPoints.length > 0 ? 'opensky_tracks' : null,
      trail_synced_at: canReuseTrailPoints
        ? toNullableString(currentLiveTracking?.trail_synced_at) || toNullableString(currentLiveTracking?.captured_at)
        : nowIso,
      trail_point_count: trailPoints.length,
      trail_points: trailPoints.map((point) => ({
        time_epoch: point.timeEpoch,
        latitude: point.latitude,
        longitude: point.longitude,
        heading_deg: point.headingDeg,
        on_ground: point.onGround,
      })),
      route: {
        departure_iata: departureIata,
        arrival_iata: arrivalIata,
        departure_icao: resolvedRoute?.departureIcao || normalizeIcaoCode(departureAirport?.icao),
        arrival_icao: resolvedRoute?.arrivalIcao || normalizeIcaoCode(arrivalAirport?.icao),
      },
      search_bbox: bbox,
      rate_limit: {
        remaining: openSkyRateLimit.remaining,
        limit: openSkyRateLimit.limit,
        retry_after_seconds: openSkyRateLimit.retryAfterSeconds,
        reset_epoch_seconds: openSkyRateLimit.resetEpochSeconds,
      },
      last_http_status: openSkyLastHttpStatus,
    },
  } as Record<string, unknown>;

  return {
    payloadPatch,
    liveLookupError: null,
    liveLookupCallCount,
    openSkyCallCount,
    liveLookupHttpStatus: openSkyLastHttpStatus,
  };
};

const toRecordArray = (value: unknown): Record<string, unknown>[] => {
  if (Array.isArray(value)) {
    return value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object');
  }
  if (value && typeof value === 'object') return [value as Record<string, unknown>];
  return [];
};

const getLufthansaFlights = (payload: unknown) => {
  if (!payload || typeof payload !== 'object') return [];
  const flightsNode = readPath(payload as Record<string, unknown>, ['FlightStatusResource', 'Flights', 'Flight']);
  return toRecordArray(flightsNode);
};

const pickBestLufthansaFlightInfo = (
  items: Record<string, unknown>[],
  flightIata: string,
  rideDate: string,
) => {
  if (!Array.isArray(items) || items.length === 0) return null;

  const parsedTarget = parseFlightIata(flightIata);
  if (!parsedTarget) return items[0] || null;
  const targetRideDate = /^\d{4}-\d{2}-\d{2}$/.test(rideDate) ? rideDate : null;
  const normalizeNum = (value: string) => value.replace(/^0+/, '') || '0';
  const exactMatches = items.filter((item) => {
    const marketingCarrier = normalizeCarrierCode(readPath(item, ['MarketingCarrier', 'AirlineID']));
    const marketingNumber = normalizeNum(readStringPath(item, ['MarketingCarrier', 'FlightNumber']));
    const operatingCarrier = normalizeCarrierCode(readPath(item, ['OperatingCarrier', 'AirlineID']));
    const operatingNumber = normalizeNum(readStringPath(item, ['OperatingCarrier', 'FlightNumber']));
    return (
      (marketingCarrier === parsedTarget.airline && marketingNumber === parsedTarget.flightNumber) ||
      (operatingCarrier === parsedTarget.airline && operatingNumber === parsedTarget.flightNumber)
    );
  });
  const pool = exactMatches.length ? exactMatches : items;
  if (!targetRideDate) return pool[0] || null;

  const sameDay = pool.filter((item) => {
    const candidateMs = [
      parseIsoMs(pickLufthansaDateTime(item, 'Departure', 'Scheduled')),
      parseIsoMs(pickLufthansaDateTime(item, 'Departure', 'Estimated')),
      parseIsoMs(pickLufthansaDateTime(item, 'Arrival', 'Scheduled')),
      parseIsoMs(pickLufthansaDateTime(item, 'Arrival', 'Estimated')),
      parseIsoMs(pickLufthansaDateTime(item, 'Arrival', 'Actual')),
    ].find((value) => Number.isFinite(value));
    if (!Number.isFinite(candidateMs)) return false;
    return new Date(candidateMs as number).toISOString().slice(0, 10) === targetRideDate;
  });

  return sameDay[0] || pool[0] || null;
};

const extractLufthansaFlightSummary = (
  flightInfo: Record<string, unknown>,
  fallbackFlightIata: string,
): FlightSummary => {
  const scheduledDepartureLocal = pickLufthansaDateTime(flightInfo, 'Departure', 'Scheduled');
  const estimatedDepartureLocal = pickLufthansaDateTime(flightInfo, 'Departure', 'Estimated');
  const actualDepartureLocal = pickLufthansaDateTime(flightInfo, 'Departure', 'Actual');
  const scheduledArrivalLocal = pickLufthansaDateTime(flightInfo, 'Arrival', 'Scheduled');
  const estimatedArrivalLocal = pickLufthansaDateTime(flightInfo, 'Arrival', 'Estimated');
  const actualArrivalLocal = pickLufthansaDateTime(flightInfo, 'Arrival', 'Actual');
  const scheduledArrivalIso = toIsoDateTime(scheduledArrivalLocal);
  const estimatedArrivalIso = toIsoDateTime(estimatedArrivalLocal);
  const actualArrivalIso = toIsoDateTime(actualArrivalLocal);

  const marketingCarrier = normalizeCarrierCode(readPath(flightInfo, ['MarketingCarrier', 'AirlineID']));
  const operatingCarrier = normalizeCarrierCode(readPath(flightInfo, ['OperatingCarrier', 'AirlineID'])) ||
    extractOperatingCarrier(flightInfo);

  return {
    provider: 'lufthansa_open_api',
    flight_iata: buildFlightIata(
      marketingCarrier,
      readPath(flightInfo, ['MarketingCarrier', 'FlightNumber']),
      fallbackFlightIata,
    ),
    operating_carrier: operatingCarrier,
    operating_flight_number: normalizeFlightNumberPart(readPath(flightInfo, ['OperatingCarrier', 'FlightNumber'])),
    marketing_carrier: marketingCarrier,
    marketing_flight_number: normalizeFlightNumberPart(readPath(flightInfo, ['MarketingCarrier', 'FlightNumber'])),
    flight_status_code: pickFirstString(readPath(flightInfo, ['FlightStatus', 'Code'])),
    flight_status_description: pickFirstString(readPath(flightInfo, ['FlightStatus', 'Definition'])),
    departure_airport: pickFirstString(
      readPath(flightInfo, ['Departure', 'AirportCode']),
      readPath(flightInfo, ['Departure', 'AirportName']),
    ),
    departure_terminal: pickFirstString(
      readPath(flightInfo, ['Departure', 'Terminal', 'Name']),
      readPath(flightInfo, ['Departure', 'Terminal', 'Code']),
    ),
    departure_gate: pickFirstString(
      readPath(flightInfo, ['Departure', 'Terminal', 'Gate']),
      readPath(flightInfo, ['Departure', 'Gate']),
    ),
    arrival_airport: pickFirstString(
      readPath(flightInfo, ['Arrival', 'AirportCode']),
      readPath(flightInfo, ['Arrival', 'AirportName']),
    ),
    arrival_terminal: pickFirstString(
      readPath(flightInfo, ['Arrival', 'Terminal', 'Name']),
      readPath(flightInfo, ['Arrival', 'Terminal', 'Code']),
    ),
    arrival_gate: pickFirstString(
      readPath(flightInfo, ['Arrival', 'Terminal', 'Gate']),
      readPath(flightInfo, ['Arrival', 'Gate']),
    ),
    scheduled_departure_local: scheduledDepartureLocal,
    estimated_departure_local: estimatedDepartureLocal,
    actual_departure_local: actualDepartureLocal,
    scheduled_arrival_local: scheduledArrivalLocal,
    estimated_arrival_local: estimatedArrivalLocal,
    actual_arrival_local: actualArrivalLocal,
    aircraft_code: pickFirstString(
      readPath(flightInfo, ['Equipment', 'AircraftCode']),
      readPath(flightInfo, ['AircraftInfo', 'AircraftCode']),
    ),
    aircraft_registration: pickFirstString(
      readPath(flightInfo, ['Equipment', 'AircraftRegistration']),
      readPath(flightInfo, ['AircraftInfo', 'AircraftRegistration']),
    ),
    aircraft_icao24: null,
    delay_minutes: toDelayMinutes(scheduledArrivalIso, estimatedArrivalIso, actualArrivalIso),
  };
};

const extractAviationstackFlightSummary = (
  flightInfo: Record<string, unknown>,
  fallbackFlightIata: string,
): FlightSummary => {
  const parsedFallback = parseFlightIata(fallbackFlightIata);
  const scheduledDepartureLocal = pickFirstString(readPath(flightInfo, ['departure', 'scheduled']));
  const estimatedDepartureLocal = pickFirstString(readPath(flightInfo, ['departure', 'estimated']));
  const actualDepartureLocal = pickFirstString(readPath(flightInfo, ['departure', 'actual']));
  const scheduledArrivalLocal = pickFirstString(readPath(flightInfo, ['arrival', 'scheduled']));
  const estimatedArrivalLocal = pickFirstString(readPath(flightInfo, ['arrival', 'estimated']));
  const actualArrivalLocal = pickFirstString(readPath(flightInfo, ['arrival', 'actual']));
  const scheduledArrivalIso = toIsoDateTime(scheduledArrivalLocal);
  const estimatedArrivalIso = toIsoDateTime(estimatedArrivalLocal);
  const actualArrivalIso = toIsoDateTime(actualArrivalLocal);
  const explicitDelay = toFiniteNumber(readPath(flightInfo, ['arrival', 'delay']));
  const flightIata = pickFirstString(
    readPath(flightInfo, ['flight', 'iata']),
    fallbackFlightIata,
  ) || fallbackFlightIata;

  const marketingCarrier = normalizeCarrierCode(readPath(flightInfo, ['airline', 'iata'])) ||
    parsedFallback?.airline ||
    normalizeCarrierCode(readPath(flightInfo, ['flight', 'iata'])); // fallback for malformed payloads

  return {
    provider: 'aviationstack',
    flight_iata: flightIata,
    operating_carrier: extractOperatingCarrier(flightInfo) || marketingCarrier,
    operating_flight_number: normalizeFlightNumberPart(readPath(flightInfo, ['flight', 'number'])) ||
      parsedFallback?.flightNumber ||
      null,
    marketing_carrier: marketingCarrier,
    marketing_flight_number: normalizeFlightNumberPart(readPath(flightInfo, ['flight', 'number'])) ||
      parsedFallback?.flightNumber ||
      null,
    flight_status_code: pickFirstString(readPath(flightInfo, ['flight_status'])),
    flight_status_description: pickFirstString(readPath(flightInfo, ['flight_status'])),
    departure_airport: pickFirstString(
      readPath(flightInfo, ['departure', 'iata']),
      readPath(flightInfo, ['departure', 'airport']),
    ),
    departure_terminal: pickFirstString(readPath(flightInfo, ['departure', 'terminal'])),
    departure_gate: pickFirstString(readPath(flightInfo, ['departure', 'gate'])),
    arrival_airport: pickFirstString(
      readPath(flightInfo, ['arrival', 'iata']),
      readPath(flightInfo, ['arrival', 'airport']),
    ),
    arrival_terminal: pickFirstString(readPath(flightInfo, ['arrival', 'terminal'])),
    arrival_gate: pickFirstString(readPath(flightInfo, ['arrival', 'gate'])),
    scheduled_departure_local: scheduledDepartureLocal,
    estimated_departure_local: estimatedDepartureLocal,
    actual_departure_local: actualDepartureLocal,
    scheduled_arrival_local: scheduledArrivalLocal,
    estimated_arrival_local: estimatedArrivalLocal,
    actual_arrival_local: actualArrivalLocal,
    aircraft_code: pickFirstString(
      readPath(flightInfo, ['aircraft', 'iata']),
      readPath(flightInfo, ['aircraft', 'icao']),
    ),
    aircraft_registration: pickFirstString(
      readPath(flightInfo, ['aircraft', 'registration']),
      readPath(flightInfo, ['aircraft', 'reg_number']),
    ),
    aircraft_icao24: normalizeIcao24(
      pickFirstString(
        readPath(flightInfo, ['aircraft', 'icao24']),
        readPath(flightInfo, ['aircraft', 'icao_24']),
        readPath(flightInfo, ['aircraft', 'hex']),
      ),
    ),
    delay_minutes: explicitDelay ?? toDelayMinutes(scheduledArrivalIso, estimatedArrivalIso, actualArrivalIso),
  };
};

const getLufthansaAccessToken = async (clientId: string, clientSecret: string) => {
  if (lufthansaTokenCache && Date.now() < lufthansaTokenCache.expiresAtMs - 30_000) {
    return lufthansaTokenCache.accessToken;
  }

  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
  });

  const response = await fetch(providerConfig.lufthansa.tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: body.toString(),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`lufthansa_token_http_${response.status}`);
  }

  const accessToken = typeof payload?.access_token === 'string' ? payload.access_token : '';
  const expiresIn = asNumber(payload?.expires_in, 1800);
  if (!accessToken) {
    throw new Error('lufthansa_token_missing');
  }

  lufthansaTokenCache = {
    accessToken,
    expiresAtMs: Date.now() + Math.max(60, expiresIn) * 1000,
  };

  return accessToken;
};

const sha256 = async (input: string) => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
};

const loadSettings = async (admin: ReturnType<typeof createClient>) => {
  const defaults = {
    flightCacheTtlMinutes: 15,
    routeCacheTtlMinutes: 10,
    manualRefreshCooldownSeconds: 60,
  };
  const { data } = await admin
    .from('integration_settings')
    .select('key,value')
    .in('key', [...SETTINGS_KEYS]);
  const map = Object.fromEntries((data || []).map((row) => [row.key, row.value]));
  return {
    flightCacheTtlMinutes: asNumber(map.flight_cache_ttl_minutes, defaults.flightCacheTtlMinutes),
    routeCacheTtlMinutes: asNumber(map.route_cache_ttl_minutes, defaults.routeCacheTtlMinutes),
    manualRefreshCooldownSeconds: asNumber(map.manual_refresh_cooldown_seconds, defaults.manualRefreshCooldownSeconds),
  };
};

const recordUsage = async (
  admin: ReturnType<typeof createClient>,
  payload: {
    job_id: string | null;
    provider: string;
    action: string;
    reason: SyncReason;
    cache_hit: boolean;
    requested_by: string | null;
    http_status?: number | null;
    error_text?: string | null;
  },
) => {
  await recordUsageWithCost(admin, {
    ...payload,
    units: 1,
    unit_name: 'request',
  });
};

const getUserFromAuthHeader = async (
  supabaseUrl: string,
  supabaseAnonKey: string,
  authHeader: string,
) => {
  const userClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: {
      headers: {
        Authorization: authHeader,
      },
    },
  });
  const { data, error } = await userClient.auth.getUser();
  if (error || !data.user) throw new Error('Unauthorized');
  return data.user;
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed' });
  }

  try {
    const supabaseUrl = ensureEnv('SUPABASE_URL');
    const supabaseAnonKey = ensureEnv('SUPABASE_ANON_KEY');
    const supabaseServiceRoleKey = ensureEnv('SUPABASE_SERVICE_ROLE_KEY');

    const body = await req.json().catch(() => ({}));
    const reason = body?.reason as SyncReason;
    const forceRefresh = Boolean(body?.force_refresh);
    const bodyCurrentLat = toFiniteNumber(body?.current_location?.lat);
    const bodyCurrentLng = toFiniteNumber(body?.current_location?.lng);
    const bodyCurrentLocation =
      bodyCurrentLat !== null && bodyCurrentLng !== null ? { lat: bodyCurrentLat, lng: bodyCurrentLng } : null;

    if (reason !== 'create' && reason !== 'manual_refresh' && reason !== 'live_view') {
      return jsonResponse(400, { error: 'Invalid reason. Allowed: create | manual_refresh | live_view' });
    }

    const authHeader = req.headers.get('Authorization');
    const bearerToken = getBearerToken(authHeader);
    const tokenPayload = bearerToken ? parseJwtPayload(bearerToken) : null;
    const tokenRole = typeof tokenPayload?.role === 'string' ? tokenPayload.role : null;
    const allowUnauthenticatedLiveView = reason === 'live_view';

    let user: { id: string } | null = null;
    if (authHeader) {
      try {
        user = await getUserFromAuthHeader(supabaseUrl, supabaseAnonKey, authHeader);
      } catch {
        user = null;
      }
    }

    if (
      !user &&
      tokenRole !== 'anon' &&
      tokenRole !== 'service_role' &&
      tokenRole !== 'authenticated' &&
      !allowUnauthenticatedLiveView
    ) {
      return jsonResponse(401, { error: 'Unauthorized' });
    }

    const requestedBy = isValidUuid(body?.requested_by) ? body.requested_by : user?.id || null;
    const requestedJobIds = Array.isArray(body?.job_ids) ? body.job_ids : [];
    const jobIds = Array.from(new Set(requestedJobIds.filter((value: unknown) => isValidUuid(value))));

    if (!jobIds.length) {
      return jsonResponse(400, { error: 'job_ids must contain at least one UUID' });
    }

    const admin = createClient(supabaseUrl, supabaseServiceRoleKey);
    const settings = await loadSettings(admin);
    const allowedOperatingCarriers = parseAllowedOperatingCarriers();
    const lufthansaClientId = `${Deno.env.get(providerConfig.lufthansa.clientIdEnvKey) || ''}`.trim();
    const lufthansaClientSecret = `${Deno.env.get(providerConfig.lufthansa.clientSecretEnvKey) || ''}`.trim();
    const useLufthansaProvider = Boolean(lufthansaClientId && lufthansaClientSecret);
    const activeFlightProvider = useLufthansaProvider ? 'lufthansa_open_api' : 'aviationstack';

    const { data: jobs, error: jobsError } = await admin
      .from('jobs')
      .select(
        'id,driver_id,trip_type,pickup_address,dropoff_address,flight_number,flight_origin,ride_date,ext_last_enriched_at,ext_driver_to_pickup_polyline,ext_flight_payload,ext_driver_to_pickup_last_sync_at,ext_driver_to_dropoff_last_sync_at',
      )
      .in('id', jobIds);

    if (jobsError) {
      return jsonResponse(500, { error: jobsError.message || 'Failed to load jobs' });
    }

    const jobsById = new Map((jobs || []).map((job) => [job.id, job]));
    const now = new Date();
    const nowIso = now.toISOString();
    const processed: Array<{ job_id: string; flight: 'hit' | 'miss' | 'skip'; route: 'hit' | 'miss' | 'skip' }> = [];
    const skipped: Array<{
      job_id: string;
      why: string;
      lock_id?: string | null;
      lock_status?: string | null;
      lock_started_at?: string | null;
      lock_created_at?: string | null;
      lock_requested_by?: string | null;
      lock_error_text?: string | null;
    }> = [];
    const errors: Array<{ job_id: string; message: string }> = [];
    let externalCalls = 0;
    let cacheHits = 0;

    for (const jobId of jobIds) {
      const job = jobsById.get(jobId);
      if (!job) {
        skipped.push({ job_id: jobId, why: 'invalid' });
        continue;
      }
      const lockTtlSeconds = getRefreshLockTtlSeconds(reason);
      const staleLockCutoffIso = new Date(Date.now() - (lockTtlSeconds * 1000)).toISOString();
      await admin
        .from('job_refresh_requests')
        .update({
          status: 'failed',
          error_text: `stale_lock_released_after_${lockTtlSeconds}s`,
          finished_at: new Date().toISOString(),
        })
        .eq('job_id', jobId)
        .eq('reason', reason)
        .eq('status', 'running')
        .lt('started_at', staleLockCutoffIso);

      if (
        reason === 'manual_refresh' &&
        !forceRefresh &&
        job.ext_last_enriched_at &&
        (Date.now() - new Date(job.ext_last_enriched_at).getTime()) / 1000 < settings.manualRefreshCooldownSeconds &&
        typeof job.ext_driver_to_pickup_polyline === 'string' &&
        job.ext_driver_to_pickup_polyline.length > 0
      ) {
        skipped.push({ job_id: jobId, why: 'cooldown' });
        continue;
      }

      const { data: refreshRow, error: refreshError } = await admin
        .from('job_refresh_requests')
        .insert([
          {
            job_id: jobId,
            reason,
            requested_by: requestedBy,
            force_refresh: forceRefresh,
            status: 'running',
            started_at: nowIso,
          },
        ])
        .select('id')
        .maybeSingle();

      if (refreshError) {
        if (refreshError.code === '23505') {
          const { data: runningLock } = await admin
            .from('job_refresh_requests')
            .select('id,status,started_at,created_at,requested_by,error_text')
            .eq('job_id', jobId)
            .eq('reason', reason)
            .in('status', ['queued', 'running'])
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();
          skipped.push({
            job_id: jobId,
            why: 'already_fresh',
            lock_id: runningLock?.id || null,
            lock_status: runningLock?.status || null,
            lock_started_at: runningLock?.started_at || null,
            lock_created_at: runningLock?.created_at || null,
            lock_requested_by: runningLock?.requested_by || null,
            lock_error_text: runningLock?.error_text || null,
          });
          continue;
        }
        errors.push({ job_id: jobId, message: `refresh_request_failed: ${refreshError.message}` });
        continue;
      }

      const refreshRequestId = refreshRow?.id;
      let flightStatus: 'hit' | 'miss' | 'skip' = 'skip';
      let routeStatus: 'hit' | 'miss' | 'skip' = 'skip';
      let flightErrorText: string | null = null;
      let flightLiveLookupErrorText: string | null = null;
      let routeErrorText: string | null = null;
      let driverApproachErrorText: string | null = null;
      let driverDropoffErrorText: string | null = null;
      let flightPatch: Record<string, unknown> = {};
      let routePatch: Record<string, unknown> = {};
      let driverApproachPatch: Record<string, unknown> = {};
      let driverDropoffPatch: Record<string, unknown> = {};
      const usageRequestedBy = requestedBy || (isValidUuid(job.driver_id) ? job.driver_id : null);

      try {
        const normalizedJobFlightNumber = normalizeFlightNumber(job.flight_number);
        if (parseFlightIata(normalizedJobFlightNumber)) {
          const flightIata = normalizedJobFlightNumber;
          const flightRideDate = typeof job.ride_date === 'string' && job.ride_date ? job.ride_date : nowIso.slice(0, 10);
          const flightKey = `${flightIata}:${flightRideDate}`;
          const bypassFlightCache = Boolean(forceRefresh && reason === 'manual_refresh');

          const cachedFlight = bypassFlightCache
            ? null
            : (
              await admin
                .from('api_flight_cache')
                .select('etd,original_etd,flight_origin,payload')
                .eq('flight_key', flightKey)
                .gt('expires_at', nowIso)
                .maybeSingle()
            ).data;

          if (cachedFlight) {
            flightStatus = 'hit';
            cacheHits += 1;
            const hasFlightValues = Boolean(cachedFlight.etd || cachedFlight.original_etd || cachedFlight.flight_origin);
            flightPatch = hasFlightValues
              ? {
                  etd: cachedFlight.etd,
                  original_etd: cachedFlight.original_etd,
                  flight_origin: cachedFlight.flight_origin,
                  ext_flight_last_sync_at: nowIso,
                  ext_flight_payload: cachedFlight.payload,
                }
              : {
                  ext_flight_last_sync_at: nowIso,
                  ext_flight_payload: cachedFlight.payload,
                };
            await recordUsage(admin, {
              job_id: jobId,
              provider: activeFlightProvider,
              action: 'flight_lookup',
              reason,
              cache_hit: true,
              requested_by: usageRequestedBy,
            });
          } else {
            flightStatus = 'miss';
            let flightResolved = false;

            if (useLufthansaProvider) {
              try {
                const accessToken = await getLufthansaAccessToken(lufthansaClientId, lufthansaClientSecret);
                const collectedLufthansaFlights: Record<string, unknown>[] = [];
                let lastOkPayload: unknown = null;
                const requestLufthansaForDate = async (lookupDate: string) => {
                  externalCalls += 1;
                  const encodedFlight = encodeURIComponent(flightIata);
                  const encodedDate = encodeURIComponent(lookupDate);
                  const lufthansaFlightStatusUrl = `${providerConfig.lufthansa.flightStatusBaseUrl}/${encodedFlight}/${encodedDate}`;
                  const response = await fetch(lufthansaFlightStatusUrl, {
                    headers: {
                      Authorization: `Bearer ${accessToken}`,
                      Accept: 'application/json',
                    },
                  });
                  const payload = await response.json().catch(() => ({}));

                  await recordUsage(admin, {
                    job_id: jobId,
                    provider: activeFlightProvider,
                    action: 'flight_lookup',
                    reason,
                    cache_hit: false,
                    requested_by: usageRequestedBy,
                    http_status: response.status,
                    error_text: response.ok ? null : `HTTP ${response.status}`,
                  });

                  if (!response.ok) {
                    flightErrorText = `flight_http_${response.status}`;
                    return { ok: false, status: response.status };
                  }
                  lastOkPayload = payload;
                  const flights = getLufthansaFlights(payload);
                  if (flights.length) collectedLufthansaFlights.push(...flights);
                  return { ok: true, status: response.status, flightsCount: flights.length };
                };

                const primary = await requestLufthansaForDate(flightRideDate);
                if (!(primary.status === 429)) {
                  const shouldTryFallbackDates = primary.ok && collectedLufthansaFlights.length === 0;
                  if (shouldTryFallbackDates) {
                    for (const lookupDate of [shiftIsoDateByDays(flightRideDate, -1), shiftIsoDateByDays(flightRideDate, 1)]) {
                      const fallbackResult = await requestLufthansaForDate(lookupDate);
                      if (fallbackResult.status === 429 || collectedLufthansaFlights.length > 0) break;
                    }
                  }
                }

                const flightInfo = pickBestLufthansaFlightInfo(
                  collectedLufthansaFlights,
                  flightIata,
                  flightRideDate,
                );
                if (!flightInfo) {
                  flightErrorText = 'flight_not_found';
                } else {
                  const summary = extractLufthansaFlightSummary(flightInfo, flightIata);
                  const arrivalForEtd = summary.estimated_arrival_local ||
                    summary.actual_arrival_local ||
                    summary.scheduled_arrival_local;
                  const cacheTtlMinutes = deriveFlightCacheTtlMinutes(summary, settings.flightCacheTtlMinutes, now);
                  const expiresAt = new Date(now.getTime() + cacheTtlMinutes * 60 * 1000).toISOString();
                  const wrappedPayload = buildFlightPayload('lufthansa_open_api', lastOkPayload || {}, summary, nowIso);

                  await admin.from('api_flight_cache').upsert(
                    [
                      {
                        flight_key: flightKey,
                        flight_iata: flightIata,
                        ride_date: flightRideDate,
                        etd: toPgTime(parseIsoToHHMM(arrivalForEtd)),
                        original_etd: toPgTime(parseIsoToHHMM(summary.scheduled_arrival_local)),
                        flight_origin: summary.departure_airport,
                        payload: wrappedPayload,
                        expires_at: expiresAt,
                      },
                    ],
                    { onConflict: 'flight_key' },
                  );

                  flightPatch = {
                    etd: toPgTime(parseIsoToHHMM(arrivalForEtd)),
                    original_etd: toPgTime(parseIsoToHHMM(summary.scheduled_arrival_local)),
                    flight_origin: summary.departure_airport,
                    ext_flight_last_sync_at: nowIso,
                    ext_flight_payload: wrappedPayload,
                  };
                  flightResolved = true;
                  flightErrorText = null;
                }
              } catch (error) {
                const message = error instanceof Error ? error.message : 'lufthansa_request_failed';
                flightErrorText = message;
              }
            }

            if (!flightResolved) {
              const aviationstackApiKey = Deno.env.get(providerConfig.aviationstack.envKey);
              if (!aviationstackApiKey) {
                if (!flightErrorText) {
                  flightErrorText = `Missing ${providerConfig.aviationstack.envKey}`;
                }
              } else {
                const flightQueries: Array<Record<string, string>> = [{ flight_iata: flightIata }];
                const parsedFlight = flightIata.match(/^([A-Z0-9]{2,3})(\d{1,4}[A-Z]?)$/);
                if (parsedFlight?.[1] && parsedFlight?.[2]) {
                  flightQueries.push({ airline_iata: parsedFlight[1], flight_number: parsedFlight[2] });
                }

                for (const query of flightQueries) {
                  externalCalls += 1;
                  const flightUrl = new URL(providerConfig.aviationstack.url);
                  flightUrl.searchParams.set('access_key', aviationstackApiKey);
                  Object.entries(query).forEach(([key, value]) => flightUrl.searchParams.set(key, value));

                  const response = await fetch(flightUrl.toString());
                  const payload = await response.json().catch(() => ({}));

                  await recordUsage(admin, {
                    job_id: jobId,
                    provider: 'aviationstack',
                    action: 'flight_lookup',
                    reason,
                    cache_hit: false,
                    requested_by: usageRequestedBy,
                    http_status: response.status,
                    error_text: response.ok ? null : `HTTP ${response.status}`,
                  });

                  if (!response.ok) {
                    flightErrorText = `flight_http_${response.status}`;
                    if (response.status >= 500) continue;
                    break;
                  }

                  const flightInfo = pickBestFlightInfo(
                    Array.isArray(payload?.data) ? payload.data : [],
                    flightIata,
                    flightRideDate,
                    allowedOperatingCarriers,
                  );
                  if (!flightInfo) {
                    flightErrorText = 'flight_not_found';
                    break;
                  }

                  const summary = extractAviationstackFlightSummary(flightInfo, flightIata);
                  const arrivalForEtd = summary.estimated_arrival_local ||
                    summary.actual_arrival_local ||
                    summary.scheduled_arrival_local;
                  const etd = parseIsoToHHMM(arrivalForEtd);
                  const originalEtd = parseIsoToHHMM(summary.scheduled_arrival_local);
                  const wrappedPayload = buildFlightPayload('aviationstack', payload, summary, nowIso);
                  const cacheTtlMinutes = deriveFlightCacheTtlMinutes(summary, settings.flightCacheTtlMinutes, now);
                  const expiresAt = new Date(now.getTime() + cacheTtlMinutes * 60 * 1000).toISOString();

                  await admin.from('api_flight_cache').upsert(
                    [
                      {
                        flight_key: flightKey,
                        flight_iata: flightIata,
                        ride_date: flightRideDate,
                        etd: toPgTime(etd),
                        original_etd: toPgTime(originalEtd),
                        flight_origin: summary.departure_airport,
                        payload: wrappedPayload,
                        expires_at: expiresAt,
                      },
                    ],
                    { onConflict: 'flight_key' },
                  );

                  flightPatch = {
                    etd: toPgTime(etd),
                    original_etd: toPgTime(originalEtd),
                    flight_origin: summary.departure_airport,
                    ext_flight_last_sync_at: nowIso,
                    ext_flight_payload: wrappedPayload,
                  };
                  flightResolved = true;
                  flightErrorText = null;
                  break;
                }
              }
            }

            if (!flightResolved && flightErrorText) {
              const errorCacheTtlMinutes = Math.max(1, Math.min(settings.flightCacheTtlMinutes, 5));
              const errorExpiresAt = new Date(Date.now() + errorCacheTtlMinutes * 60 * 1000).toISOString();
              await admin.from('api_flight_cache').upsert(
                [
                  {
                    flight_key: flightKey,
                    flight_iata: flightIata,
                    ride_date: flightRideDate,
                    etd: null,
                    original_etd: null,
                    flight_origin: null,
                    payload: {
                      provider: activeFlightProvider,
                      error: flightErrorText,
                      failed_at: nowIso,
                    },
                    expires_at: errorExpiresAt,
                  },
                ],
                { onConflict: 'flight_key' },
              );
            }
          }
        }

        if (parseFlightIata(normalizedJobFlightNumber)) {
          const basePayload = toRecord(flightPatch.ext_flight_payload) || toRecord(job.ext_flight_payload);
          const summaryFromPayload = extractFlightSummaryFromPayload(basePayload);
          const liveLookup = await resolveFlightLiveTracking({
            flightIata: normalizedJobFlightNumber,
            summary: summaryFromPayload,
            currentPayload: basePayload,
          });

          if (liveLookup.liveLookupCallCount > 0) {
            externalCalls += liveLookup.liveLookupCallCount;
          }
          if (liveLookup.openSkyCallCount > 0) {
            for (let i = 0; i < liveLookup.openSkyCallCount; i += 1) {
              await recordUsage(admin, {
                job_id: jobId,
                provider: 'opensky',
                action: 'flight_live_lookup',
                reason,
                cache_hit: false,
                requested_by: usageRequestedBy,
                http_status: liveLookup.liveLookupHttpStatus,
                error_text: liveLookup.liveLookupError,
              });
            }
          } else if (liveLookup.liveLookupCallCount > 0) {
            await recordUsage(admin, {
              job_id: jobId,
              provider: 'opensky',
              action: 'flight_live_lookup',
              reason,
              cache_hit: false,
              requested_by: usageRequestedBy,
              http_status: liveLookup.liveLookupHttpStatus,
              error_text: liveLookup.liveLookupError,
            });
          }

          if (liveLookup.payloadPatch) {
            const mergedPayload: Record<string, unknown> = {
              ...(basePayload || {}),
              ...liveLookup.payloadPatch,
            };
            if (!toNullableString(mergedPayload.provider)) {
              mergedPayload.provider = summaryFromPayload?.provider || activeFlightProvider;
            }
            if (!mergedPayload.fetched_at) {
              mergedPayload.fetched_at = nowIso;
            }
            if (!mergedPayload.summary && summaryFromPayload) {
              mergedPayload.summary = summaryFromPayload;
            }

            const nextFlightPatch: Record<string, unknown> = {
              ext_flight_payload: mergedPayload,
              ext_flight_last_sync_at: nowIso,
            };
            if (!toNullableString(flightPatch.flight_origin) && summaryFromPayload?.departure_airport) {
              nextFlightPatch.flight_origin = summaryFromPayload.departure_airport;
            }
            flightPatch = {
              ...flightPatch,
              ...nextFlightPatch,
            };
          } else if (liveLookup.liveLookupError) {
            flightLiveLookupErrorText = liveLookup.liveLookupError;
            const previousLiveTracking = extractLiveTrackingFromPayload(basePayload) || {};
            const fallbackCallsignCandidates = buildOpenSkyCallsignCandidates(
              normalizedJobFlightNumber,
              summaryFromPayload,
            );
            const fallbackCallsignPrefixCandidates = buildOpenSkyCallsignPrefixCandidates(
              normalizedJobFlightNumber,
              summaryFromPayload,
            );
            const mergedPayload: Record<string, unknown> = {
              ...(basePayload || {}),
              live_tracking: {
                ...previousLiveTracking,
                provider: toNullableString(previousLiveTracking.provider) || 'opensky',
                captured_at: null,
                last_contact_epoch: null,
                time_position_epoch: null,
                radar_hex: null,
                icao24: null,
                callsign: null,
                latitude: null,
                longitude: null,
                heading_deg: null,
                on_ground: null,
                trail_point_count: 0,
                trail_points: [],
                secondary_eta: null,
                last_error: liveLookup.liveLookupError,
                last_error_at: nowIso,
                last_http_status: liveLookup.liveLookupHttpStatus ?? null,
                callsign_candidates: fallbackCallsignCandidates,
                callsign_prefix_candidates: fallbackCallsignPrefixCandidates,
                rate_limit: readPath(previousLiveTracking, ['rate_limit']) || null,
              },
            };
            if (!toNullableString(mergedPayload.provider)) {
              mergedPayload.provider = summaryFromPayload?.provider || activeFlightProvider;
            }
            mergedPayload.fetched_at = nowIso;
            if (!mergedPayload.summary && summaryFromPayload) {
              mergedPayload.summary = summaryFromPayload;
            }
            const nextFlightPatch: Record<string, unknown> = {
              ext_flight_payload: mergedPayload,
              ext_flight_last_sync_at: nowIso,
            };
            if (!toNullableString(flightPatch.flight_origin) && summaryFromPayload?.departure_airport) {
              nextFlightPatch.flight_origin = summaryFromPayload.departure_airport;
            }
            flightPatch = {
              ...flightPatch,
              ...nextFlightPatch,
            };
          }
        }

        if (
          typeof job.pickup_address === 'string' &&
          job.pickup_address.trim() &&
          typeof job.dropoff_address === 'string' &&
          job.dropoff_address.trim()
        ) {
          const departureBucket = new Date();
          departureBucket.setUTCMinutes(Math.floor(departureBucket.getUTCMinutes() / 10) * 10, 0, 0);
          const bucketIso = departureBucket.toISOString();
          const routeRawKey = `${job.pickup_address.trim().toLowerCase()}|${job.dropoff_address.trim().toLowerCase()}|${bucketIso}`;
          const routeKey = await sha256(routeRawKey);

          const { data: cachedRoute } = await admin
            .from('api_route_cache')
            .select('provider,distance_m,duration_mins,duration_in_traffic_mins,polyline,payload')
            .eq('route_key', routeKey)
            .gt('expires_at', nowIso)
            .maybeSingle();

          if (cachedRoute) {
            routeStatus = 'hit';
            cacheHits += 1;
            routePatch = {
              ext_route_provider: cachedRoute.provider,
              ext_route_distance_m: cachedRoute.distance_m,
              ext_route_duration_mins: cachedRoute.duration_mins,
              ext_route_duration_in_traffic_mins: cachedRoute.duration_in_traffic_mins,
              ext_route_polyline: cachedRoute.polyline,
              ext_route_payload: cachedRoute.payload,
            };
            await recordUsage(admin, {
              job_id: jobId,
              provider: cachedRoute.provider === TOMTOM_PROVIDER ? TOMTOM_PROVIDER : 'google_routes',
              action: 'route_lookup',
              reason,
              cache_hit: true,
              requested_by: usageRequestedBy,
            });
          } else {
            // Fahrtroute Abholung -> Ziel ueber TomTom (frueher Google Directions).
            const tomtomKey = await tomtomSchluessel(admin);
            if (!tomtomKey) {
              routeErrorText = 'Missing tomtom_routing_key';
            } else {
              routeStatus = 'miss';
              externalCalls += 1;
              const tt = await tomtomRoute(admin, tomtomKey, job.pickup_address, job.dropoff_address);
              await recordUsage(admin, {
                job_id: jobId,
                provider: TOMTOM_PROVIDER,
                action: 'route_lookup',
                reason,
                cache_hit: false,
                requested_by: usageRequestedBy,
                http_status: tt.httpStatus || null,
                error_text: tt.fehler,
              });
              if (tt.ok) {
                const expiresAt = new Date(Date.now() + settings.routeCacheTtlMinutes * 60 * 1000).toISOString();
                await admin.from('api_route_cache').upsert(
                  [
                    {
                      route_key: routeKey,
                      provider: TOMTOM_PROVIDER,
                      origin_address: job.pickup_address,
                      destination_address: job.dropoff_address,
                      departure_bucket: bucketIso,
                      distance_m: tt.distanceM,
                      duration_mins: tt.durationMins,
                      duration_in_traffic_mins: tt.durationInTrafficMins,
                      polyline: tt.polyline,
                      payload: tt.payload,
                      expires_at: expiresAt,
                    },
                  ],
                  { onConflict: 'route_key' },
                );
                routePatch = {
                  ext_route_provider: TOMTOM_PROVIDER,
                  ext_route_distance_m: tt.distanceM,
                  ext_route_duration_mins: tt.durationMins,
                  ext_route_duration_in_traffic_mins: tt.durationInTrafficMins,
                  ext_route_polyline: tt.polyline,
                  ext_route_payload: tt.payload,
                };
              } else {
                routeErrorText = tt.httpStatus ? `route_http_${tt.httpStatus}` : (tt.fehler || 'route_not_found');
              }
            }
          }
        }

        const resolveDriverRoute = async ({
          destinationAddress,
          action,
          patchType,
        }: {
          destinationAddress: string;
          action: 'driver_to_pickup_lookup' | 'driver_to_dropoff_lookup';
          patchType: 'pickup' | 'dropoff';
        }) => {
          const driverId = usageRequestedBy || (isValidUuid(job.driver_id) ? job.driver_id : null);
          if (!driverId) return { patch: {}, errorText: 'driver_id_missing' };

          let liveLat = bodyCurrentLocation?.lat ?? null;
          let liveLng = bodyCurrentLocation?.lng ?? null;
          if (liveLat === null || liveLng === null) {
            const { data: liveLocation } = await admin
              .from('driver_live_locations')
              .select('lat,lng,captured_at')
              .eq('driver_id', driverId)
              .maybeSingle();
            liveLat = toFiniteNumber(liveLocation?.lat);
            liveLng = toFiniteNumber(liveLocation?.lng);
          }
          if (!Number.isFinite(liveLat) || !Number.isFinite(liveLng)) {
            return { patch: {}, errorText: 'driver_location_missing' };
          }

          // Drossel: dieselbe Fahrt hoechstens alle 45 s neu rechnen. Die App fragt waehrend der
          // Fahrt alle paar Sekunden, die alten Werte bleiben so lange stehen.
          const letzterSync = Date.parse(String(
            patchType === 'pickup' ? job.ext_driver_to_pickup_last_sync_at || '' : job.ext_driver_to_dropoff_last_sync_at || '',
          ));
          if (Number.isFinite(letzterSync) && Date.now() - letzterSync < DRIVER_ROUTE_MIN_INTERVAL_MS) {
            return { patch: {}, errorText: null };
          }

          const departureBucket = new Date();
          departureBucket.setUTCMinutes(Math.floor(departureBucket.getUTCMinutes() / 5) * 5, 0, 0);
          const bucketIso = departureBucket.toISOString();
          const origin = `${liveLat},${liveLng}`;
          // Schluessel auf etwa 100 m gerundet, damit nahe Positionen den Speicher teilen.
          const originGerundet = `${Number(liveLat).toFixed(3)},${Number(liveLng).toFixed(3)}`;
          const routeRawKey = `${originGerundet}|${destinationAddress.trim().toLowerCase()}|${bucketIso}`;
          const routeKey = await sha256(routeRawKey);

          const { data: cachedRoute } = await admin
            .from('api_route_cache')
            .select('provider,distance_m,duration_mins,duration_in_traffic_mins,polyline,payload')
            .eq('route_key', routeKey)
            .gt('expires_at', nowIso)
            .maybeSingle();

          if (cachedRoute) {
            cacheHits += 1;
            await recordUsage(admin, {
              job_id: jobId,
              provider: cachedRoute.provider === TOMTOM_PROVIDER ? TOMTOM_PROVIDER : 'google_routes',
              action,
              reason,
              cache_hit: true,
              requested_by: driverId,
            });
            if (patchType === 'pickup') {
              return {
                patch: {
                  ext_driver_to_pickup_provider: cachedRoute.provider,
                  ext_driver_to_pickup_distance_m: cachedRoute.distance_m,
                  ext_driver_to_pickup_duration_mins: cachedRoute.duration_mins,
                  ext_driver_to_pickup_duration_in_traffic_mins: cachedRoute.duration_in_traffic_mins,
                  ext_driver_to_pickup_polyline: cachedRoute.polyline,
                  ext_driver_to_pickup_payload: cachedRoute.payload,
                  ext_driver_to_pickup_last_sync_at: nowIso,
                },
                errorText: null,
              };
            }
            return {
              patch: {
                ext_driver_to_dropoff_provider: cachedRoute.provider,
                ext_driver_to_dropoff_distance_m: cachedRoute.distance_m,
                ext_driver_to_dropoff_duration_mins: cachedRoute.duration_mins,
                ext_driver_to_dropoff_duration_in_traffic_mins: cachedRoute.duration_in_traffic_mins,
                ext_driver_to_dropoff_polyline: cachedRoute.polyline,
                ext_driver_to_dropoff_payload: cachedRoute.payload,
                ext_driver_to_dropoff_last_sync_at: nowIso,
              },
              errorText: null,
            };
          }

          const tomtomKey = await tomtomSchluessel(admin);
          if (!tomtomKey) return { patch: {}, errorText: 'Missing tomtom_routing_key' };

          externalCalls += 1;
          const tt = await tomtomRoute(admin, tomtomKey, origin, destinationAddress);
          await recordUsage(admin, {
            job_id: jobId,
            provider: TOMTOM_PROVIDER,
            action,
            reason,
            cache_hit: false,
            requested_by: driverId,
            http_status: tt.httpStatus || null,
            error_text: tt.fehler,
          });
          if (!tt.ok) {
            return { patch: {}, errorText: tt.httpStatus ? `${action}_http_${tt.httpStatus}` : `${action}_${tt.fehler}` };
          }

          const expiresAt = new Date(Date.now() + settings.routeCacheTtlMinutes * 60 * 1000).toISOString();
          await admin.from('api_route_cache').upsert(
            [
              {
                route_key: routeKey,
                provider: TOMTOM_PROVIDER,
                origin_address: origin,
                destination_address: destinationAddress,
                departure_bucket: bucketIso,
                distance_m: tt.distanceM,
                duration_mins: tt.durationMins,
                duration_in_traffic_mins: tt.durationInTrafficMins,
                polyline: tt.polyline,
                payload: tt.payload,
                expires_at: expiresAt,
              },
            ],
            { onConflict: 'route_key' },
          );

          if (patchType === 'pickup') {
            return {
              patch: {
                ext_driver_to_pickup_provider: TOMTOM_PROVIDER,
                ext_driver_to_pickup_distance_m: tt.distanceM,
                ext_driver_to_pickup_duration_mins: tt.durationMins,
                ext_driver_to_pickup_duration_in_traffic_mins: tt.durationInTrafficMins,
                ext_driver_to_pickup_polyline: tt.polyline,
                ext_driver_to_pickup_payload: tt.payload,
                ext_driver_to_pickup_last_sync_at: nowIso,
              },
              errorText: null,
            };
          }
          return {
            patch: {
              ext_driver_to_dropoff_provider: TOMTOM_PROVIDER,
              ext_driver_to_dropoff_distance_m: tt.distanceM,
              ext_driver_to_dropoff_duration_mins: tt.durationMins,
              ext_driver_to_dropoff_duration_in_traffic_mins: tt.durationInTrafficMins,
              ext_driver_to_dropoff_polyline: tt.polyline,
              ext_driver_to_dropoff_payload: tt.payload,
              ext_driver_to_dropoff_last_sync_at: nowIso,
            },
            errorText: null,
          };
        };

        if (reason === 'manual_refresh' || reason === 'live_view') {
          if (typeof job.pickup_address === 'string' && job.pickup_address.trim()) {
            const approachResult = await resolveDriverRoute({
              destinationAddress: job.pickup_address,
              action: 'driver_to_pickup_lookup',
              patchType: 'pickup',
            });
            driverApproachPatch = approachResult.patch;
            driverApproachErrorText = approachResult.errorText;
          }

          if (typeof job.dropoff_address === 'string' && job.dropoff_address.trim()) {
            const dropoffResult = await resolveDriverRoute({
              destinationAddress: job.dropoff_address,
              action: 'driver_to_dropoff_lookup',
              patchType: 'dropoff',
            });
            driverDropoffPatch = dropoffResult.patch;
            driverDropoffErrorText = dropoffResult.errorText;
          }
        }

        const nextError = [flightErrorText, flightLiveLookupErrorText, routeErrorText, driverApproachErrorText, driverDropoffErrorText]
          .filter(Boolean)
          .join('; ') || null;
        const updatePayload: Record<string, unknown> = {
          ext_last_enriched_at: nowIso,
          ext_last_enriched_by: usageRequestedBy,
          ext_last_enrich_reason: reason,
          ext_last_error: nextError,
          ...flightPatch,
          ...routePatch,
          ...driverApproachPatch,
          ...driverDropoffPatch,
        };

        const { error: updateError } = await admin.from('jobs').update(updatePayload).eq('id', jobId);
        if (updateError) {
          throw new Error(updateError.message || 'job_update_failed');
        }

        if (refreshRequestId) {
          await admin
            .from('job_refresh_requests')
            .update({ status: nextError ? 'failed' : 'done', error_text: nextError, finished_at: new Date().toISOString() })
            .eq('id', refreshRequestId);
        }

        processed.push({ job_id: jobId, flight: flightStatus, route: routeStatus });
        if (nextError) {
          errors.push({ job_id: jobId, message: nextError });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'sync_failed';
        errors.push({ job_id: jobId, message });
        if (refreshRequestId) {
          await admin
            .from('job_refresh_requests')
            .update({ status: 'failed', error_text: message, finished_at: new Date().toISOString() })
            .eq('id', refreshRequestId);
        }
      }
    }

    return jsonResponse(200, {
      processed,
      skipped,
      errors,
      usage: {
        external_calls: externalCalls,
        cache_hits: cacheHits,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unexpected error';
    const status = message === 'Unauthorized' ? 401 : 500;
    return jsonResponse(status, { error: message });
  }
});

function isValidUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_REGEX.test(value);
}
