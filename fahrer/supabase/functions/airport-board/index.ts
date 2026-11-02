import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders, jsonResponse } from '../_shared/cors.ts';
import { providerConfig } from '../_shared/provider-config.ts';

const DEFAULT_LUFTHANSA_GROUP_OPERATING_CARRIERS = ['LH', 'VL', 'EW', 'E2', 'LX', 'OS', 'SN', 'EN', '4Y'];
let lufthansaTokenCache: { accessToken: string; expiresAtMs: number } | null = null;

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

const normalizeCarrierCode = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toUpperCase();
  if (!normalized || !/^[A-Z0-9]{2,3}$/.test(normalized)) return null;
  return normalized;
};

const parseAllowedOperatingCarriers = () => {
  const raw = Deno.env.get('LUFTHANSA_GROUP_OPERATING_CARRIERS');
  if (!raw || !raw.trim()) return new Set(DEFAULT_LUFTHANSA_GROUP_OPERATING_CARRIERS);
  const values = raw
    .split(',')
    .map((value) => normalizeCarrierCode(value))
    .filter((value): value is string => Boolean(value));
  return new Set([...DEFAULT_LUFTHANSA_GROUP_OPERATING_CARRIERS, ...values]);
};

const normalizeAirportCode = (value: unknown) => {
  if (typeof value !== 'string') return '';
  const normalized = value.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(normalized)) return '';
  return normalized;
};

const normalizeRideDate = (value: unknown) => {
  if (typeof value !== 'string') return new Date().toISOString().slice(0, 10);
  const normalized = value.trim().slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return normalized;
  return new Date().toISOString().slice(0, 10);
};

const normalizeMode = (value: unknown): 'arrivals' | 'departures' => {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === 'departures' ? 'departures' : 'arrivals';
};

const toPositiveInt = (value: unknown, fallback: number, min: number, max: number) => {
  const numeric = typeof value === 'number' ? value : Number(String(value || ''));
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, Math.round(numeric)));
};

const readPath = (obj: Record<string, unknown>, path: string[]) => {
  let current: unknown = obj;
  for (const segment of path) {
    if (!current || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
};

const readStringPath = (item: Record<string, unknown>, path: string[]) => {
  const value = readPath(item, path);
  if (typeof value !== 'string') return '';
  return value;
};

const pickFirstString = (...values: unknown[]) => {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
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
      const candidates = [
        nested.AirlineID,
        nested.airlineID,
        nested.CarrierCode,
        nested.carrierCode,
        nested.IATA,
        nested.iata,
        nested.code,
      ];
      for (const candidate of candidates) {
        const normalized = normalizeCarrierCode(candidate);
        if (normalized) return normalized;
      }
    }
  }

  return null;
};

const parseLocalTimeLabel = (value: string | null) => {
  if (!value) return '--:--';
  const match = value.match(/T(\d{2}:\d{2})/);
  if (match?.[1]) return match[1];
  const directMatch = value.match(/^(\d{2}:\d{2})/);
  return directMatch?.[1] || '--:--';
};

const toIsoDateTime = (value: unknown): string | null => {
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = Date.parse(value);
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
  const expiresIn = typeof payload?.expires_in === 'number' ? payload.expires_in : 1800;
  if (!accessToken) throw new Error('lufthansa_token_missing');

  lufthansaTokenCache = {
    accessToken,
    expiresAtMs: Date.now() + Math.max(60, expiresIn) * 1000,
  };

  return accessToken;
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

const fetchBoardPayload = async (
  mode: 'arrivals' | 'departures',
  airportCode: string,
  date: string,
  token: string,
) => {
  const baseUrl = providerConfig.lufthansa.flightStatusBaseUrl;
  const todayIso = new Date().toISOString().slice(0, 10);
  const nowUtcHour = new Date().getUTCHours();
  const bucketHour = Math.max(0, Math.min(20, Math.floor(nowUtcHour / 4) * 4));
  const preferredHour = date === todayIso ? bucketHour : 12;
  const preferredHourText = String(preferredHour).padStart(2, '0');
  const candidates = [
    `${baseUrl}/${mode}/${airportCode}/${date}T${preferredHourText}:00`,
    `${baseUrl}/${mode}/${airportCode}/${date}T12:00`,
    `${baseUrl}/${mode}/${airportCode}/${date}T08:00`,
    `${baseUrl}/${mode}/${airportCode}/${date}T16:00`,
  ];

  let lastStatus = 500;
  for (const candidate of candidates) {
    const response = await fetch(candidate, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
    });
    const payload = await response.json().catch(() => ({}));
    lastStatus = response.status;
    if (response.ok) return { ok: true, payload, status: response.status };
    if (response.status !== 404) {
      return { ok: false, payload, status: response.status };
    }
  }

  return { ok: false, payload: null, status: lastStatus };
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

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return jsonResponse(401, { error: 'Missing authorization header' });

    const bearerToken = getBearerToken(authHeader);
    const tokenPayload = bearerToken ? parseJwtPayload(bearerToken) : null;
    const tokenRole = typeof tokenPayload?.role === 'string' ? tokenPayload.role : null;

    let user: { id: string } | null = null;
    try {
      user = await getUserFromAuthHeader(supabaseUrl, supabaseAnonKey, authHeader);
    } catch {
      user = null;
    }

    if (!user && tokenRole !== 'anon' && tokenRole !== 'service_role') {
      return jsonResponse(401, { error: 'Unauthorized' });
    }

    const body = await req.json().catch(() => ({}));
    const airportCode = normalizeAirportCode(body?.airport_code);
    const mode = normalizeMode(body?.mode);
    const rideDate = normalizeRideDate(body?.date);
    const includeCodeshare = body?.include_codeshare === true;
    const limit = toPositiveInt(body?.limit, 20, 1, 100);
    if (!airportCode) {
      return jsonResponse(400, { error: 'airport_code must be a valid IATA code, e.g. MUC' });
    }

    const lufthansaClientId = `${Deno.env.get(providerConfig.lufthansa.clientIdEnvKey) || ''}`.trim();
    const lufthansaClientSecret = `${Deno.env.get(providerConfig.lufthansa.clientSecretEnvKey) || ''}`.trim();
    if (!lufthansaClientId || !lufthansaClientSecret) {
      return jsonResponse(500, {
        error: `Missing ${providerConfig.lufthansa.clientIdEnvKey} or ${providerConfig.lufthansa.clientSecretEnvKey}`,
      });
    }

    const allowedOperatingCarriers = parseAllowedOperatingCarriers();
    const token = await getLufthansaAccessToken(lufthansaClientId, lufthansaClientSecret);
    const boardResponse = await fetchBoardPayload(mode, airportCode, rideDate, token);
    if (!boardResponse.ok) {
      return jsonResponse(200, {
        airport_code: airportCode,
        date: rideDate,
        mode,
        count: 0,
        items: [],
        error: `board_http_${boardResponse.status}`,
        message: `Lufthansa API antwortet mit HTTP ${boardResponse.status}.`,
      });
    }

    const flights = getLufthansaFlights(boardResponse.payload);
    const mapped = flights
      .map((flight) => {
        const operatingCarrier = extractOperatingCarrier(flight);
        const marketingCarrier = normalizeCarrierCode(readPath(flight, ['MarketingCarrier', 'AirlineID']));
        const marketingFlightNumber = readStringPath(flight, ['MarketingCarrier', 'FlightNumber']).replace(/^0+/, '');
        const flightNumber = `${marketingCarrier || ''}${marketingFlightNumber || ''}` || null;
        const statusCode = pickFirstString(readPath(flight, ['FlightStatus', 'Code']));
        const statusDescription = pickFirstString(readPath(flight, ['FlightStatus', 'Definition']));
        const departureAirport = pickFirstString(
          readPath(flight, ['Departure', 'AirportCode']),
          readPath(flight, ['Departure', 'AirportName']),
        );
        const arrivalAirport = pickFirstString(
          readPath(flight, ['Arrival', 'AirportCode']),
          readPath(flight, ['Arrival', 'AirportName']),
        );

        const scheduledLocal = mode === 'arrivals'
          ? pickFirstString(readPath(flight, ['Arrival', 'ScheduledTimeLocal', 'DateTime']))
          : pickFirstString(readPath(flight, ['Departure', 'ScheduledTimeLocal', 'DateTime']));
        const estimatedLocal = mode === 'arrivals'
          ? pickFirstString(readPath(flight, ['Arrival', 'EstimatedTimeLocal', 'DateTime']))
          : pickFirstString(readPath(flight, ['Departure', 'EstimatedTimeLocal', 'DateTime']));
        const actualLocal = mode === 'arrivals'
          ? pickFirstString(readPath(flight, ['Arrival', 'ActualTimeLocal', 'DateTime']))
          : pickFirstString(readPath(flight, ['Departure', 'ActualTimeLocal', 'DateTime']));

        const terminal = mode === 'arrivals'
          ? pickFirstString(readPath(flight, ['Arrival', 'Terminal', 'Name']))
          : pickFirstString(readPath(flight, ['Departure', 'Terminal', 'Name']));
        const gate = mode === 'arrivals'
          ? pickFirstString(
            readPath(flight, ['Arrival', 'Terminal', 'Gate']),
            readPath(flight, ['Arrival', 'Gate']),
          )
          : pickFirstString(
            readPath(flight, ['Departure', 'Terminal', 'Gate']),
            readPath(flight, ['Departure', 'Gate']),
          );

        return {
          flight_number: flightNumber,
          marketing_carrier: marketingCarrier,
          operating_carrier: operatingCarrier,
          is_lufthansa_group_operated: Boolean(
            operatingCarrier && allowedOperatingCarriers.has(operatingCarrier),
          ),
          status_code: statusCode,
          status_description: statusDescription,
          origin: departureAirport,
          destination: arrivalAirport,
          scheduled_time_local: scheduledLocal,
          estimated_time_local: estimatedLocal,
          actual_time_local: actualLocal,
          time_label: parseLocalTimeLabel(actualLocal || estimatedLocal || scheduledLocal),
          route_label: mode === 'arrivals'
            ? `${departureAirport || '?'} -> ${airportCode}`
            : `${airportCode} -> ${arrivalAirport || '?'}`,
          terminal,
          gate,
          aircraft_code: pickFirstString(
            readPath(flight, ['Equipment', 'AircraftCode']),
            readPath(flight, ['AircraftInfo', 'AircraftCode']),
          ),
          delay_minutes: toDelayMinutes(
            toIsoDateTime(scheduledLocal),
            toIsoDateTime(estimatedLocal),
            toIsoDateTime(actualLocal),
          ),
        };
      })
      .filter((entry) => includeCodeshare || entry.is_lufthansa_group_operated)
      .sort((a, b) => String(a.time_label || '').localeCompare(String(b.time_label || '')))
      .slice(0, limit);

    return jsonResponse(200, {
      airport_code: airportCode,
      date: rideDate,
      mode,
      include_codeshare: includeCodeshare,
      count: mapped.length,
      source: 'lufthansa_open_api',
      fetched_at: new Date().toISOString(),
      items: mapped,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected error';
    const status = message === 'Unauthorized' ? 401 : 500;
    return jsonResponse(status, { error: message });
  }
});
