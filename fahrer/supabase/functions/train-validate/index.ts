import { corsHeaders, jsonResponse } from '../_shared/cors.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const ensureEnv = (name: string) => {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
};

const normalizeText = (value: unknown) => String(value ?? '').replace(/\s+/g, ' ').trim();

const normalizeTrainNumber = (value: unknown) =>
  normalizeText(value)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');

const normalizeRideDate = (value: unknown) => {
  const raw = normalizeText(value);
  if (!raw) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  if (/^\d{4}-\d{2}-\d{2}T/.test(raw)) return raw.slice(0, 10);
  const dot = raw.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (dot) return `${dot[3]}-${dot[2]}-${dot[1]}`;
  return '';
};

const isSyncableTrainNumber = (value: unknown) => {
  const normalized = normalizeTrainNumber(value);
  return normalized.length >= 2 && normalized.length <= 12 && /\d/.test(normalized);
};

const normalizeStationLabel = (value: string) =>
  normalizeText(value)
    .toLowerCase()
    .replace(/[.,]/g, ' ')
    .replace(/\bhauptbahnhof\b/g, 'hbf')
    .replace(/\bbahnhof\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();

const scoreName = (name: string, query: string) => {
  const left = normalizeStationLabel(name);
  const right = normalizeStationLabel(query);
  if (!left || !right) return 0;
  if (left === right) return 1000;
  if (left.includes(right)) return 700;
  if (right.includes(left)) return 500;
  const tokens = right.split(' ').filter(Boolean);
  return tokens.filter((token) => left.includes(token)).length * 40;
};

type StationCandidate = {
  name: string;
  eva: string;
  latitude: number | null;
  longitude: number | null;
};

const STATION_FALLBACKS: StationCandidate[] = [
  { name: 'München Hbf', eva: '8000261', latitude: 48.140228, longitude: 11.558335 },
  { name: 'Berlin Hbf', eva: '8011160', latitude: 52.525589, longitude: 13.369548 },
  { name: 'Hamburg Hbf', eva: '8002549', latitude: 53.552736, longitude: 10.006909 },
  { name: 'Frankfurt(Main)Hbf', eva: '8000105', latitude: 50.107145, longitude: 8.663789 },
  { name: 'Köln Hbf', eva: '8000207', latitude: 50.943029, longitude: 6.958729 },
  { name: 'Stuttgart Hbf', eva: '8000096', latitude: 48.783939, longitude: 9.181775 },
];

const toNumberOrNull = (value: unknown) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

const extractCandidates = (payload: unknown): Record<string, unknown>[] => {
  if (Array.isArray(payload)) {
    return payload.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object');
  }
  if (!payload || typeof payload !== 'object') return [];
  const record = payload as Record<string, unknown>;
  const containers = [record.result, record.stations, record.data, record.items, record.matches];
  for (const container of containers) {
    if (Array.isArray(container)) {
      return container.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object');
    }
  }
  return [record];
};

const toStationCandidate = (entry: Record<string, unknown>): StationCandidate | null => {
  const name = normalizeText(entry.NAME ?? entry.name ?? entry.stationName ?? entry.title);
  const evaFromList = Array.isArray(entry.evaNumbers)
    ? (entry.evaNumbers[0] as Record<string, unknown> | undefined)?.number
    : undefined;
  const eva = normalizeText(
    evaFromList
      ?? entry.eva
      ?? entry.evaNo
      ?? entry.eva_nr
      ?? entry.evaNumber
      ?? entry.number
      ?? entry.id,
  );
  if (!name || !eva) return null;

  const position = (entry.position && typeof entry.position === 'object') ? entry.position as Record<string, unknown> : null;
  const latitude = toNumberOrNull(position?.latitude ?? position?.lat ?? entry.latitude ?? entry.lat);
  const longitude = toNumberOrNull(position?.longitude ?? position?.lon ?? entry.longitude ?? entry.lng ?? entry.lon);

  return { name, eva, latitude, longitude };
};

const pickTargetStation = async (
  stationApiBase: string,
  headers: HeadersInit,
  query: string,
): Promise<StationCandidate | null> => {
  const url = `${stationApiBase}/stations?searchstring=${encodeURIComponent(query)}`;
  const response = await fetch(url, { headers });
  if (response.status === 404) {
    const fallback = [...STATION_FALLBACKS].sort((a, b) => scoreName(b.name, query) - scoreName(a.name, query))[0];
    return scoreName(fallback?.name || '', query) > 0 ? fallback : null;
  }
  if (!response.ok) throw new Error(`station_lookup_http_${response.status}`);
  const payload = await response.json().catch(() => null);
  const candidates = extractCandidates(payload)
    .map(toStationCandidate)
    .filter((entry): entry is StationCandidate => Boolean(entry));
  if (!candidates.length) {
    const fallback = [...STATION_FALLBACKS].sort((a, b) => scoreName(b.name, query) - scoreName(a.name, query))[0];
    return scoreName(fallback?.name || '', query) > 0 ? fallback : null;
  }
  return [...candidates].sort((a, b) => scoreName(b.name, query) - scoreName(a.name, query))[0] || null;
};

const toDbDateToken = (rideDate: string) => {
  const [year, month, day] = rideDate.split('-');
  return `${year.slice(-2)}${month}${day}`;
};

const parseDbTime = (value: string | null) => {
  const raw = normalizeText(value);
  if (!/^\d{10}$/.test(raw)) return null;
  const yy = raw.slice(0, 2);
  const mm = raw.slice(2, 4);
  const dd = raw.slice(4, 6);
  const hh = raw.slice(6, 8);
  const mi = raw.slice(8, 10);
  const year = `20${yy}`;
  return `${year}-${mm}-${dd}T${hh}:${mi}:00`;
};

const toEpoch = (isoLike: string | null) => {
  if (!isoLike) return Number.NaN;
  const value = Date.parse(isoLike);
  return Number.isFinite(value) ? value : Number.NaN;
};

const extractEtaLabel = (isoLike: string | null) => {
  const text = normalizeText(isoLike);
  const match = text.match(/T(\d{2}:\d{2})/);
  return match?.[1] || '';
};

type TrainMatch = {
  stopId: string;
  score: number;
  lineName: string;
  plannedArrival: string | null;
  predictedArrival: string | null;
  routeStops: string[];
};

type StopChange = {
  arrivalPlanned: string | null;
  arrivalChanged: string | null;
  departurePlanned: string | null;
  departureChanged: string | null;
};

const scoreTrainCandidate = (lineName: string, train: string) => {
  const normalizedLine = normalizeTrainNumber(lineName);
  const normalizedTrain = normalizeTrainNumber(train);
  if (!normalizedLine || !normalizedTrain) return 0;
  if (normalizedLine === normalizedTrain) return 1000;
  if (normalizedLine.includes(normalizedTrain) || normalizedTrain.includes(normalizedLine)) return 600;
  return 0;
};

const decodeXmlEntities = (value: string) =>
  value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, '\'')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');

const readAttr = (fragment: string, attr: string) => {
  const match = fragment.match(new RegExp(`${attr}=\"([^\"]*)\"`));
  return match?.[1] ? decodeXmlEntities(match[1]) : '';
};

const parseFchgXml = (xml: string) => {
  const stopMatches = Array.from(xml.matchAll(/<s\b[^>]*>[\s\S]*?<\/s>/g));
  const changes = new Map<string, StopChange>();

  for (const stopMatch of stopMatches) {
    const stop = stopMatch[0];
    const stopHead = stop.match(/<s\b[^>]*>/)?.[0] || '';
    const stopId = normalizeText(readAttr(stopHead, 'id'));
    if (!stopId) continue;

    const ar = stop.match(/<ar\b[^>]*\/?>/)?.[0] || '';
    const dp = stop.match(/<dp\b[^>]*\/?>/)?.[0] || '';
    changes.set(stopId, {
      arrivalPlanned: parseDbTime(readAttr(ar, 'pt') || null),
      arrivalChanged: parseDbTime(readAttr(ar, 'ct') || null),
      departurePlanned: parseDbTime(readAttr(dp, 'pt') || null),
      departureChanged: parseDbTime(readAttr(dp, 'ct') || null),
    });
  }

  return changes;
};

const parsePlanXml = (xml: string, trainNumber: string, changes: Map<string, StopChange>): TrainMatch[] => {
  const stopMatches = Array.from(xml.matchAll(/<s\b[^>]*>[\s\S]*?<\/s>/g));
  const matches: TrainMatch[] = [];

  for (const stopMatch of stopMatches) {
    const stop = stopMatch[0];
    const stopHead = stop.match(/<s\b[^>]*>/)?.[0] || '';
    const stopId = normalizeText(readAttr(stopHead, 'id'));
    if (!stopId) continue;
    const tl = stop.match(/<tl\b[^>]*\/?>/)?.[0] || '';
    const category = normalizeText(readAttr(tl, 'c'));
    const lineNo = normalizeText(readAttr(tl, 'n') || readAttr(tl, 'f'));
    const lineName = normalizeText([category, lineNo].filter(Boolean).join(' ')) || lineNo;
    const score = scoreTrainCandidate(lineName, trainNumber);
    if (score <= 0) continue;

    const ar = stop.match(/<ar\b[^>]*\/?>/)?.[0] || '';
    const dp = stop.match(/<dp\b[^>]*\/?>/)?.[0] || '';
    const ppthRaw = normalizeText(readAttr(ar, 'ppth') || readAttr(dp, 'ppth'));
    const routeStops = ppthRaw
      ? ppthRaw
        .split('|')
        .map((entry) => normalizeText(entry))
        .filter(Boolean)
      : [];
    const planArrival = parseDbTime(readAttr(ar, 'pt') || null);
    const planDeparture = parseDbTime(readAttr(dp, 'pt') || null);
    const realtimeArrival = parseDbTime(readAttr(ar, 'ct') || null);
    const realtimeDeparture = parseDbTime(readAttr(dp, 'ct') || null);
    const change = changes.get(stopId);

    const plannedArrival =
      change?.arrivalPlanned
      ?? change?.departurePlanned
      ?? planArrival
      ?? planDeparture
      ?? null;
    const predictedArrival =
      change?.arrivalChanged
      ?? change?.departureChanged
      ?? realtimeArrival
      ?? realtimeDeparture
      ?? plannedArrival;

    matches.push({
      stopId,
      score,
      lineName,
      plannedArrival,
      predictedArrival,
      routeStops,
    });
  }

  return matches;
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse(405, { error: 'Method not allowed' });

  try {
    // Eigene Anmeldepruefung (verify_jwt ist aus, weil das Gateway ES256-Tokens nicht lesen kann).
    const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
    if (!token) return jsonResponse(401, { error: 'Missing authorization header' });
    const istServer = token === Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || token === Deno.env.get('SUPABASE_ANON_KEY');
    if (!istServer) {
      const pruefer = createClient(ensureEnv('SUPABASE_URL'), ensureEnv('SUPABASE_ANON_KEY'));
      const { data, error } = await pruefer.auth.getUser(token);
      if (error || !data?.user) return jsonResponse(401, { error: 'Unauthorized' });
    }

    const body = await req.json().catch(() => ({}));
    const trainNumberRaw = normalizeText(body?.train_number);
    const rideDate = normalizeRideDate(body?.ride_date);
    const targetStation = normalizeText(body?.target_station ?? body?.target_station_hint);

    if (!trainNumberRaw) return jsonResponse(400, { error: 'train_number is required' });
    if (!rideDate) return jsonResponse(400, { error: 'ride_date is required (YYYY-MM-DD)' });
    if (!targetStation) return jsonResponse(400, { error: 'target_station is required' });
    if (!isSyncableTrainNumber(trainNumberRaw)) {
      return jsonResponse(200, {
        valid: false,
        reason: 'invalid_train_number',
        message: 'Ungültige Zugnummer.',
      });
    }

    const dbClientId = ensureEnv('DB_API_CLIENT_ID');
    const dbApiKey = ensureEnv('DB_API_KEY');
    const stationApiBase = normalizeText(Deno.env.get('DB_STATION_API_BASE_URL') || 'https://apis.deutschebahn.com/db-api-marketplace/apis/station-data/v2');
    const timetableApiBase = normalizeText(Deno.env.get('DB_TIMETABLE_API_BASE_URL') || 'https://apis.deutschebahn.com/db-api-marketplace/apis/timetables/v1');
    const headers: HeadersInit = {
      'DB-Client-Id': dbClientId,
      'DB-Api-Key': dbApiKey,
      Accept: 'application/json, application/xml;q=0.9, text/xml;q=0.8',
    };

    const station = await pickTargetStation(stationApiBase, headers, targetStation);
    if (!station) {
      return jsonResponse(200, {
        valid: false,
        reason: 'target_station_not_found',
        message: 'Ankunftsbahnhof nicht gefunden.',
      });
    }

    const dateToken = toDbDateToken(rideDate);
    const fchgUrl = `${timetableApiBase}/fchg/${encodeURIComponent(station.eva)}`;
    const fchgResponse = await fetch(fchgUrl, { headers });
    let realtimeChanges = new Map<string, StopChange>();
    if (fchgResponse.ok) {
      const fchgXml = await fchgResponse.text();
      realtimeChanges = parseFchgXml(fchgXml);
    } else if (fchgResponse.status !== 404) {
      throw new Error(`timetable_fchg_http_${fchgResponse.status}`);
    }

    const allMatches: TrainMatch[] = [];
    for (let hour = 0; hour < 24; hour += 1) {
      const hourToken = String(hour).padStart(2, '0');
      const url = `${timetableApiBase}/plan/${encodeURIComponent(station.eva)}/${dateToken}/${hourToken}`;
      const response = await fetch(url, { headers });
      if (response.status === 404) continue;
      if (!response.ok) throw new Error(`timetable_plan_http_${response.status}`);
      const xml = await response.text();
      allMatches.push(...parsePlanXml(xml, trainNumberRaw, realtimeChanges));
    }

    if (!allMatches.length) {
      return jsonResponse(200, {
        valid: false,
        reason: 'train_not_found',
        message: `Keine passende Zugankunft für ${trainNumberRaw} am ${rideDate}.`,
      });
    }

    allMatches.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const aTime = toEpoch(a.predictedArrival ?? a.plannedArrival);
      const bTime = toEpoch(b.predictedArrival ?? b.plannedArrival);
      if (Number.isFinite(aTime) && Number.isFinite(bTime)) return aTime - bTime;
      return 0;
    });

    const best = allMatches[0];
    const etaLabel = extractEtaLabel(best.predictedArrival ?? best.plannedArrival);
    const normalizedTrain = normalizeTrainNumber(trainNumberRaw);

    return jsonResponse(200, {
      valid: true,
      reason: etaLabel ? 'ok' : 'unknown_eta',
      message: 'Zug validiert.',
      train_number: normalizedTrain,
      target_station: station.name,
      eta_label: etaLabel,
      summary: {
        provider: 'deutsche_bahn_api',
        train_number: normalizedTrain,
        line_name: best.lineName || null,
        target_station_name: station.name,
        target_station_id: station.eva,
        planned_arrival: best.plannedArrival,
        predicted_arrival: best.predictedArrival,
        route_stops: best.routeStops,
      },
      live_tracking:
        Number.isFinite(station.latitude) && Number.isFinite(station.longitude)
          ? {
              provider: 'deutsche_bahn_api',
              mode: 'train',
              callsign: best.lineName || normalizedTrain,
              radar_hex: null,
              latitude: station.latitude,
              longitude: station.longitude,
              heading_deg: null,
              captured_at: new Date().toISOString(),
              on_ground: false,
              trail_points: [],
              route_stops: best.routeStops,
              position_source: 'station_fallback',
            }
          : null,
    });
  } catch (error) {
    return jsonResponse(500, {
      valid: false,
      reason: 'provider_error',
      error: error instanceof Error ? error.message : 'train_validate_failed',
    });
  }
});
