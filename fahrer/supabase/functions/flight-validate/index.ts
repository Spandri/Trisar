import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders, jsonResponse } from '../_shared/cors.ts';
import { providerConfig } from '../_shared/provider-config.ts';

type FlightProviderName = 'lufthansa_open_api' | 'aviationstack';

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

const normalizeFlightNumber = (value: unknown) => {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, '').toUpperCase().trim();
};

const normalizeCarrierCode = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toUpperCase();
  if (!normalized || !/^[A-Z0-9]{2,3}$/.test(normalized)) return null;
  return normalized;
};

const normalizeAirportIata = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toUpperCase();
  if (!normalized) return null;
  if (/^[A-Z]{3}$/.test(normalized)) return normalized;
  const match = normalized.match(/\b([A-Z]{3})\b/);
  return match?.[1] || null;
};

const normalizeRideDate = (value: unknown) => {
  if (typeof value !== 'string') return new Date().toISOString().slice(0, 10);
  const normalized = value.trim().slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return normalized;
  return new Date().toISOString().slice(0, 10);
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

const parseFlightIata = (flightIata: string) => {
  const parsed = flightIata.toUpperCase().match(/^([A-Z0-9]{2,3})(\d{1,4}[A-Z]?)$/);
  if (!parsed?.[1] || !parsed?.[2]) return null;
  return { airline: parsed[1], flightNumber: parsed[2].replace(/^0+/, '') };
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

const extractLufthansaArrivalAirportCode = (item: Record<string, unknown>) =>
  normalizeAirportIata(
    pickFirstString(
      readPath(item, ['Arrival', 'AirportCode']),
      readPath(item, ['Arrival', 'AirportName']),
    ),
  );

const extractAviationstackArrivalAirportCode = (item: Record<string, unknown>) =>
  normalizeAirportIata(
    pickFirstString(
      readPath(item, ['arrival', 'iata']),
      readPath(item, ['arrival', 'airport']),
    ),
  );

type PickFlightResult = {
  flight: Record<string, unknown> | null;
  reason: 'ok' | 'multiple_matches' | 'arrival_airport_mismatch' | 'flight_not_found';
  candidateCount: number;
  candidates?: Record<string, unknown>[];
};

const pickBestLufthansaFlightInfo = (
  items: Record<string, unknown>[],
  flightIata: string,
  allowedOperatingCarriers: Set<string>,
  requireLhGroup: boolean,
  targetAirportIata: string | null,
  selectedArrivalScheduled = '',
): PickFlightResult => {
  if (!Array.isArray(items) || items.length === 0) {
    return { flight: null, reason: 'flight_not_found', candidateCount: 0 };
  }
  const parsedTarget = parseFlightIata(flightIata);
  const matchingByNumber = items.filter((item) => {
    if (!parsedTarget) return true;
    const marketingCarrier = normalizeCarrierCode(readPath(item, ['MarketingCarrier', 'AirlineID']));
    const marketingFlightNumber = readStringPath(item, ['MarketingCarrier', 'FlightNumber']).replace(/^0+/, '');
    const operatingCarrier = normalizeCarrierCode(readPath(item, ['OperatingCarrier', 'AirlineID']));
    const operatingFlightNumber = readStringPath(item, ['OperatingCarrier', 'FlightNumber']).replace(/^0+/, '');
    return (
      (marketingCarrier === parsedTarget.airline && marketingFlightNumber === parsedTarget.flightNumber) ||
      (operatingCarrier === parsedTarget.airline && operatingFlightNumber === parsedTarget.flightNumber)
    );
  });
  const byNumberPool = matchingByNumber.length > 0 ? matchingByNumber : items;
  const candidatePool = requireLhGroup
    ? byNumberPool.filter((item) => {
      const operatingCarrier = extractOperatingCarrier(item);
      return Boolean(operatingCarrier && allowedOperatingCarriers.has(operatingCarrier));
    })
    : byNumberPool;

  if (candidatePool.length === 0) {
    return { flight: null, reason: 'flight_not_found', candidateCount: 0 };
  }

  if (selectedArrivalScheduled) {
    const bySelected = candidatePool.filter(
      (item) => pickLufthansaDateTime(item, 'Arrival', 'Scheduled') === selectedArrivalScheduled,
    );
    if (bySelected.length >= 1) {
      return { flight: bySelected[0], reason: 'ok', candidateCount: candidatePool.length };
    }
  }

  const normalizedTargetAirport = normalizeAirportIata(targetAirportIata);
  if (normalizedTargetAirport) {
    const byArrivalAirport = candidatePool.filter(
      (item) => extractLufthansaArrivalAirportCode(item) === normalizedTargetAirport,
    );
    if (byArrivalAirport.length === 1) {
      return { flight: byArrivalAirport[0], reason: 'ok', candidateCount: candidatePool.length };
    }
    if (byArrivalAirport.length > 1) {
      return { flight: null, reason: 'multiple_matches', candidateCount: byArrivalAirport.length, candidates: byArrivalAirport };
    }
    return { flight: null, reason: 'arrival_airport_mismatch', candidateCount: candidatePool.length };
  }

  if (candidatePool.length > 1) {
    return { flight: null, reason: 'multiple_matches', candidateCount: candidatePool.length, candidates: candidatePool };
  }

  return { flight: candidatePool[0] || null, reason: 'ok', candidateCount: candidatePool.length };
};

const pickBestAviationstackFlightInfo = (
  items: Record<string, unknown>[],
  flightIata: string,
  rideDate: string,
  allowedOperatingCarriers: Set<string>,
  requireLhGroup: boolean,
  targetAirportIata: string | null,
  selectedArrivalScheduled = '',
): PickFlightResult => {
  if (!Array.isArray(items) || items.length === 0) {
    return { flight: null, reason: 'flight_not_found', candidateCount: 0 };
  }
  const targetIata = flightIata.toUpperCase();
  const byCode = items.filter((item) => readStringPath(item, ['flight', 'iata']).toUpperCase() === targetIata);
  const byCodePool = byCode.length > 0 ? byCode : items;
  const byDate = byCodePool.filter((item) => readStringPath(item, ['flight_date']).slice(0, 10) === rideDate);
  const byDatePool = byDate.length > 0 ? byDate : byCodePool;
  const candidatePool = requireLhGroup
    ? byDatePool.filter((item) => {
      const operatingCarrier = extractOperatingCarrier(item);
      return Boolean(operatingCarrier && allowedOperatingCarriers.has(operatingCarrier));
    })
    : byDatePool;

  if (candidatePool.length === 0) {
    return { flight: null, reason: 'flight_not_found', candidateCount: 0 };
  }

  if (selectedArrivalScheduled) {
    const bySelected = candidatePool.filter(
      (item) => pickFirstString(readPath(item, ['arrival', 'scheduled'])) === selectedArrivalScheduled,
    );
    if (bySelected.length >= 1) {
      return { flight: bySelected[0], reason: 'ok', candidateCount: candidatePool.length };
    }
  }

  const normalizedTargetAirport = normalizeAirportIata(targetAirportIata);
  if (normalizedTargetAirport) {
    const byArrivalAirport = candidatePool.filter(
      (item) => extractAviationstackArrivalAirportCode(item) === normalizedTargetAirport,
    );
    if (byArrivalAirport.length === 1) {
      return { flight: byArrivalAirport[0], reason: 'ok', candidateCount: candidatePool.length };
    }
    if (byArrivalAirport.length > 1) {
      return { flight: null, reason: 'multiple_matches', candidateCount: byArrivalAirport.length, candidates: byArrivalAirport };
    }
    return { flight: null, reason: 'arrival_airport_mismatch', candidateCount: candidatePool.length };
  }

  if (candidatePool.length > 1) {
    return { flight: null, reason: 'multiple_matches', candidateCount: candidatePool.length, candidates: candidatePool };
  }

  return { flight: candidatePool[0] || null, reason: 'ok', candidateCount: candidatePool.length };
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

const summarizeLufthansaFlight = (flightInfo: Record<string, unknown>, fallbackFlightIata: string) => {
  const scheduledArrivalLocal = pickLufthansaDateTime(flightInfo, 'Arrival', 'Scheduled');
  const estimatedArrivalLocal = pickLufthansaDateTime(flightInfo, 'Arrival', 'Estimated');
  const actualArrivalLocal = pickLufthansaDateTime(flightInfo, 'Arrival', 'Actual');
  return {
    provider: 'lufthansa_open_api' as FlightProviderName,
    flight_iata: pickFirstString(
      `${normalizeCarrierCode(readPath(flightInfo, ['MarketingCarrier', 'AirlineID'])) || ''}${
        readStringPath(flightInfo, ['MarketingCarrier', 'FlightNumber']).replace(/^0+/, '')
      }`,
      fallbackFlightIata,
    ),
    operating_carrier: extractOperatingCarrier(flightInfo),
    marketing_carrier: normalizeCarrierCode(readPath(flightInfo, ['MarketingCarrier', 'AirlineID'])),
    flight_status_code: pickFirstString(readPath(flightInfo, ['FlightStatus', 'Code'])),
    flight_status_description: pickFirstString(readPath(flightInfo, ['FlightStatus', 'Definition'])),
    departure_airport: pickFirstString(
      readPath(flightInfo, ['Departure', 'AirportCode']),
      readPath(flightInfo, ['Departure', 'AirportName']),
    ),
    arrival_airport: pickFirstString(
      readPath(flightInfo, ['Arrival', 'AirportCode']),
      readPath(flightInfo, ['Arrival', 'AirportName']),
    ),
    departure_terminal: pickFirstString(readPath(flightInfo, ['Departure', 'Terminal', 'Name'])),
    departure_gate: pickFirstString(
      readPath(flightInfo, ['Departure', 'Terminal', 'Gate']),
      readPath(flightInfo, ['Departure', 'Gate']),
    ),
    arrival_terminal: pickFirstString(readPath(flightInfo, ['Arrival', 'Terminal', 'Name'])),
    arrival_gate: pickFirstString(
      readPath(flightInfo, ['Arrival', 'Terminal', 'Gate']),
      readPath(flightInfo, ['Arrival', 'Gate']),
    ),
    scheduled_arrival_local: scheduledArrivalLocal,
    estimated_arrival_local: estimatedArrivalLocal,
    actual_arrival_local: actualArrivalLocal,
    aircraft_code: pickFirstString(
      readPath(flightInfo, ['Equipment', 'AircraftCode']),
      readPath(flightInfo, ['AircraftInfo', 'AircraftCode']),
    ),
    delay_minutes: toDelayMinutes(
      toIsoDateTime(scheduledArrivalLocal),
      toIsoDateTime(estimatedArrivalLocal),
      toIsoDateTime(actualArrivalLocal),
    ),
  };
};

const summarizeAviationstackFlight = (flightInfo: Record<string, unknown>, fallbackFlightIata: string) => {
  const scheduledArrivalLocal = pickFirstString(readPath(flightInfo, ['arrival', 'scheduled']));
  const estimatedArrivalLocal = pickFirstString(readPath(flightInfo, ['arrival', 'estimated']));
  const actualArrivalLocal = pickFirstString(readPath(flightInfo, ['arrival', 'actual']));
  const explicitDelay = readPath(flightInfo, ['arrival', 'delay']);
  const parsedExplicitDelay = typeof explicitDelay === 'number'
    ? explicitDelay
    : typeof explicitDelay === 'string'
      ? Number(explicitDelay)
      : NaN;

  return {
    provider: 'aviationstack' as FlightProviderName,
    flight_iata: pickFirstString(readPath(flightInfo, ['flight', 'iata']), fallbackFlightIata),
    operating_carrier: extractOperatingCarrier(flightInfo),
    marketing_carrier: normalizeCarrierCode(readPath(flightInfo, ['airline', 'iata'])),
    flight_status_code: pickFirstString(readPath(flightInfo, ['flight_status'])),
    flight_status_description: pickFirstString(readPath(flightInfo, ['flight_status'])),
    departure_airport: pickFirstString(
      readPath(flightInfo, ['departure', 'iata']),
      readPath(flightInfo, ['departure', 'airport']),
    ),
    arrival_airport: pickFirstString(
      readPath(flightInfo, ['arrival', 'iata']),
      readPath(flightInfo, ['arrival', 'airport']),
    ),
    departure_terminal: pickFirstString(readPath(flightInfo, ['departure', 'terminal'])),
    departure_gate: pickFirstString(readPath(flightInfo, ['departure', 'gate'])),
    arrival_terminal: pickFirstString(readPath(flightInfo, ['arrival', 'terminal'])),
    arrival_gate: pickFirstString(readPath(flightInfo, ['arrival', 'gate'])),
    scheduled_arrival_local: scheduledArrivalLocal,
    estimated_arrival_local: estimatedArrivalLocal,
    actual_arrival_local: actualArrivalLocal,
    aircraft_code: pickFirstString(
      readPath(flightInfo, ['aircraft', 'iata']),
      readPath(flightInfo, ['aircraft', 'icao']),
    ),
    delay_minutes: Number.isFinite(parsedExplicitDelay)
      ? Math.round(parsedExplicitDelay)
      : toDelayMinutes(
        toIsoDateTime(scheduledArrivalLocal),
        toIsoDateTime(estimatedArrivalLocal),
        toIsoDateTime(actualArrivalLocal),
      ),
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
    // Rolle nur, wenn es wirklich der Server-Schluessel ist. Die Rolle im Token selbst ist ohne
    // Signaturpruefung faelschbar (verify_jwt ist aus, weil das Gateway ES256-Tokens nicht lesen kann).
    const tokenRole = bearerToken && bearerToken === Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
      ? 'service_role'
      : bearerToken && bearerToken === Deno.env.get('SUPABASE_ANON_KEY') ? 'anon' : null;
    void tokenPayload;

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
    const flightNumber = normalizeFlightNumber(body?.flight_number);
    const rideDate = normalizeRideDate(body?.ride_date);
    const targetAirportIata = normalizeAirportIata(body?.target_airport_iata);
    const selectedArrivalScheduled = typeof body?.selected_arrival_scheduled === 'string'
      ? body.selected_arrival_scheduled.trim()
      : '';
    const requireLufthansaGroup = body?.require_lufthansa_group !== false;
    const allowedOperatingCarriers = parseAllowedOperatingCarriers();

    if (!flightNumber) {
      return jsonResponse(400, { error: 'flight_number is required' });
    }
    if (!parseFlightIata(flightNumber)) {
      return jsonResponse(200, {
        valid: false,
        reason: 'invalid_format',
        message: 'Ungueltiges Flugnummer-Format. Beispiel: LH1625',
        flight_number: flightNumber,
        ride_date: rideDate,
      });
    }

    const lufthansaClientId = `${Deno.env.get(providerConfig.lufthansa.clientIdEnvKey) || ''}`.trim();
    const lufthansaClientSecret = `${Deno.env.get(providerConfig.lufthansa.clientSecretEnvKey) || ''}`.trim();

    const resultBase = {
      valid: false,
      flight_number: flightNumber,
      ride_date: rideDate,
      require_lufthansa_group: requireLufthansaGroup,
      target_airport_iata: targetAirportIata,
      allowed_operating_carriers: Array.from(allowedOperatingCarriers),
      checked_at: new Date().toISOString(),
    };
    let lufthansaFallbackReason: string | null = null;
    let lufthansaFallbackHttpStatus: number | null = null;

    if (lufthansaClientId && lufthansaClientSecret) {
      try {
        const token = await getLufthansaAccessToken(lufthansaClientId, lufthansaClientSecret);
        const url = `${providerConfig.lufthansa.flightStatusBaseUrl}/${encodeURIComponent(flightNumber)}/${encodeURIComponent(rideDate)}`;
        const response = await fetch(url, {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/json',
          },
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          if (response.status >= 500) {
            lufthansaFallbackReason = `flight_http_${response.status}`;
            lufthansaFallbackHttpStatus = response.status;
          } else {
          return jsonResponse(200, {
            ...resultBase,
            provider: 'lufthansa_open_api',
            reason: `flight_http_${response.status}`,
            message: `Lufthansa API antwortet mit HTTP ${response.status}.`,
            http_status: response.status,
          });
          }
        } else {
          const flights = getLufthansaFlights(payload);
          if (!flights.length) {
            return jsonResponse(200, {
              ...resultBase,
              provider: 'lufthansa_open_api',
              reason: 'flight_not_found',
              message: 'Kein Flug fuer Datum/Flugnummer gefunden.',
            });
          }

          const pickedFlight = pickBestLufthansaFlightInfo(
            flights,
            flightNumber,
            allowedOperatingCarriers,
            requireLufthansaGroup,
            targetAirportIata,
            selectedArrivalScheduled,
          );

          if (!pickedFlight.flight) {
            const firstOperatingCarrier = extractOperatingCarrier(flights[0]);
            const isMultipleMatches = pickedFlight.reason === 'multiple_matches';
            const isArrivalMismatch = pickedFlight.reason === 'arrival_airport_mismatch';
            return jsonResponse(200, {
              ...resultBase,
              provider: 'lufthansa_open_api',
              reason: isMultipleMatches
                ? 'multiple_matches'
                : isArrivalMismatch
                ? 'arrival_airport_mismatch'
                : requireLufthansaGroup
                ? 'codeshare_or_external_operating_carrier'
                : 'flight_not_found',
              message: isMultipleMatches
                ? 'Mehrere Flüge mit derselben Flugnummer gefunden. Bitte Ziel-Flughafen angeben.'
                : isArrivalMismatch
                ? 'Kein Flug mit passendem Ziel-Flughafen gefunden.'
                : requireLufthansaGroup
                ? 'Flug gefunden, aber nicht von Lufthansa Group operiert (OperatingCarrier).'
                : 'Kein passender Flug gefunden.',
              operating_carrier: firstOperatingCarrier,
              candidate_count: pickedFlight.candidateCount,
              ...(isMultipleMatches
                ? {
                  candidates: (pickedFlight.candidates || [])
                    .slice(0, 8)
                    .map((candidate) => summarizeLufthansaFlight(candidate, flightNumber)),
                }
                : {}),
            });
          }

          const summary = summarizeLufthansaFlight(pickedFlight.flight, flightNumber);
          return jsonResponse(200, {
            ...resultBase,
            valid: true,
            provider: 'lufthansa_open_api',
            reason: 'ok',
            message: 'Flug ist validiert.',
            operating_carrier: summary.operating_carrier,
            is_lufthansa_group_operated: Boolean(
              summary.operating_carrier && allowedOperatingCarriers.has(summary.operating_carrier),
            ),
            candidate_count: pickedFlight.candidateCount,
            summary,
          });
        }
      } catch (error) {
        lufthansaFallbackReason = error instanceof Error ? error.message : 'lufthansa_validation_failed';
      }
    }

    const aviationstackApiKey = `${Deno.env.get(providerConfig.aviationstack.envKey) || ''}`.trim();
    if (!aviationstackApiKey) {
      return jsonResponse(200, {
        ...resultBase,
        provider: 'aviationstack',
        reason: `missing_${providerConfig.aviationstack.envKey.toLowerCase()}`,
        message: `Missing ${providerConfig.aviationstack.envKey}`,
      });
    }

    const parsedFlight = parseFlightIata(flightNumber);
    const queries: Array<Record<string, string>> = [{ flight_iata: flightNumber }];
    if (parsedFlight?.airline && parsedFlight?.flightNumber) {
      queries.push({ airline_iata: parsedFlight.airline, flight_number: parsedFlight.flightNumber });
    }

    for (const query of queries) {
      const flightUrl = new URL(providerConfig.aviationstack.url);
      flightUrl.searchParams.set('access_key', aviationstackApiKey);
      Object.entries(query).forEach(([key, value]) => flightUrl.searchParams.set(key, value));

      const response = await fetch(flightUrl.toString());
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        continue;
      }

      const rows = Array.isArray(payload?.data) ? payload.data : [];
      const pickedFlight = pickBestAviationstackFlightInfo(
        rows,
        flightNumber,
        rideDate,
        allowedOperatingCarriers,
        requireLufthansaGroup,
        targetAirportIata,
        selectedArrivalScheduled,
      );

      if (!pickedFlight.flight) {
        if (pickedFlight.reason === 'multiple_matches') {
          return jsonResponse(200, {
            ...resultBase,
            provider: 'aviationstack',
            reason: 'multiple_matches',
            message: 'Mehrere Flüge mit derselben Flugnummer gefunden. Bitte Ziel-Flughafen angeben.',
            candidate_count: pickedFlight.candidateCount,
            candidates: (pickedFlight.candidates || [])
              .slice(0, 8)
              .map((candidate) => summarizeAviationstackFlight(candidate, flightNumber)),
          });
        }
        if (pickedFlight.reason === 'arrival_airport_mismatch') {
          return jsonResponse(200, {
            ...resultBase,
            provider: 'aviationstack',
            reason: 'arrival_airport_mismatch',
            message: 'Kein Flug mit passendem Ziel-Flughafen gefunden.',
            candidate_count: pickedFlight.candidateCount,
          });
        }
        continue;
      }

      const summary = summarizeAviationstackFlight(pickedFlight.flight, flightNumber);
      return jsonResponse(200, {
        ...resultBase,
        valid: true,
        provider: 'aviationstack',
        reason: lufthansaFallbackReason ? 'ok_fallback_aviationstack' : 'ok',
        message: lufthansaFallbackReason
          ? 'Flug ist validiert (Aviationstack Fallback).'
          : 'Flug ist validiert.',
        fallback_from_provider: lufthansaFallbackReason ? 'lufthansa_open_api' : null,
        fallback_reason: lufthansaFallbackReason,
        fallback_http_status: lufthansaFallbackHttpStatus,
        operating_carrier: summary.operating_carrier,
        is_lufthansa_group_operated: Boolean(
          summary.operating_carrier && allowedOperatingCarriers.has(summary.operating_carrier),
        ),
        candidate_count: pickedFlight.candidateCount,
        summary,
      });
    }

    return jsonResponse(200, {
      ...resultBase,
      provider: 'aviationstack',
      fallback_from_provider: lufthansaFallbackReason ? 'lufthansa_open_api' : null,
      fallback_reason: lufthansaFallbackReason,
      fallback_http_status: lufthansaFallbackHttpStatus,
      reason: requireLufthansaGroup
        ? 'codeshare_or_external_operating_carrier'
        : 'flight_not_found',
      message: requireLufthansaGroup
        ? 'Flug gefunden, aber nicht von Lufthansa Group operiert (OperatingCarrier).'
        : 'Kein Flug fuer Datum/Flugnummer gefunden.',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected error';
    const status = message === 'Unauthorized' ? 401 : 500;
    return jsonResponse(status, { error: message });
  }
});
