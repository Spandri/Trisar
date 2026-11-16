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
  /** Gleis bei Ankunft: geaendert (cp) vor geplant (pp). */
  arrivalPlatform: string | null;
  arrivalPlatformPlanned: string | null;
};

/** Abfahrt am Startbahnhof (Dienstreise): Zeit, Gleis und die folgenden Halte. */
type DepartureMatch = {
  stopId: string;
  score: number;
  lineName: string;
  plannedDeparture: string | null;
  predictedDeparture: string | null;
  platform: string | null;
  platformPlanned: string | null;
  nextStops: string[];
};

type StopChange = {
  arrivalPlanned: string | null;
  arrivalChanged: string | null;
  departurePlanned: string | null;
  departureChanged: string | null;
  arrivalPlatform: string | null;
  departurePlatform: string | null;
  departurePath: string[];
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
      arrivalPlatform: normalizeText(readAttr(ar, 'cp')) || null,
      departurePlatform: normalizeText(readAttr(dp, 'cp')) || null,
      departurePath: splitPath(readAttr(dp, 'cpth')),
    });
  }

  return changes;
};

const splitPath = (raw: string) =>
  normalizeText(raw)
    ? normalizeText(raw).split('|').map((entry) => normalizeText(entry)).filter(Boolean)
    : [];

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

    const arrivalPlatformPlanned = normalizeText(readAttr(ar, 'pp')) || null;
    matches.push({
      stopId,
      score,
      lineName,
      plannedArrival,
      predictedArrival,
      routeStops,
      arrivalPlatform: change?.arrivalPlatform || normalizeText(readAttr(ar, 'cp')) || arrivalPlatformPlanned,
      arrivalPlatformPlanned,
    });
  }

  return matches;
};

/** Wie parsePlanXml, aber fuer die Abfahrt (dp) am Startbahnhof. */
const parseDepartureXml = (xml: string, trainNumber: string, changes: Map<string, StopChange>): DepartureMatch[] => {
  const stopMatches = Array.from(xml.matchAll(/<s\b[^>]*>[\s\S]*?<\/s>/g));
  const matches: DepartureMatch[] = [];

  for (const stopMatch of stopMatches) {
    const stop = stopMatch[0];
    const stopHead = stop.match(/<s\b[^>]*>/)?.[0] || '';
    const stopId = normalizeText(readAttr(stopHead, 'id'));
    if (!stopId) continue;
    const dp = stop.match(/<dp\b[^>]*\/?>/)?.[0] || '';
    // Endet der Zug hier, gibt es keine Abfahrt.
    if (!dp) continue;
    const tl = stop.match(/<tl\b[^>]*\/?>/)?.[0] || '';
    const category = normalizeText(readAttr(tl, 'c'));
    const lineNo = normalizeText(readAttr(tl, 'n') || readAttr(tl, 'f'));
    const lineName = normalizeText([category, lineNo].filter(Boolean).join(' ')) || lineNo;
    const score = scoreTrainCandidate(lineName, trainNumber);
    if (score <= 0) continue;

    const change = changes.get(stopId);
    const plannedDeparture = change?.departurePlanned ?? parseDbTime(readAttr(dp, 'pt') || null);
    const predictedDeparture = change?.departureChanged ?? parseDbTime(readAttr(dp, 'ct') || null) ?? plannedDeparture;
    const platformPlanned = normalizeText(readAttr(dp, 'pp')) || null;
    const changedPath = change?.departurePath?.length ? change.departurePath : splitPath(readAttr(dp, 'cpth'));
    matches.push({
      stopId,
      score,
      lineName,
      plannedDeparture,
      predictedDeparture,
      platform: change?.departurePlatform || normalizeText(readAttr(dp, 'cp')) || platformPlanned,
      platformPlanned,
      nextStops: changedPath.length ? changedPath : splitPath(readAttr(dp, 'ppth')),
    });
  }

  return matches;
};

// MARK: Koordinaten der Halte (Strecke auf der Karte)

/**
 * Gleislinie fuer die Karte: eigener OSRM nur mit Schienen (werkzeuge/schienennetz, Container
 * trisar-osrm-schiene). Die Halte sind Zwischenziele, an ihnen darf gewendet werden (Kopfbahnhof).
 * Klappt das nicht (Dienst aus, Halt ohne Gleis in der Naehe), fehlt nur die Linie.
 */
/** Linie vereinfachen (Douglas-Peucker): Punkte naeher als toleranz (Grad, 0.00015 ~ 15 m) fallen weg. */
const vereinfachen = (punkte: [number, number][], toleranz = 0.00015): [number, number][] => {
  if (punkte.length < 3) return punkte;
  const behalten = new Uint8Array(punkte.length);
  behalten[0] = 1;
  behalten[punkte.length - 1] = 1;
  const stapel: [number, number][] = [[0, punkte.length - 1]];
  while (stapel.length) {
    const [a, b] = stapel.pop()!;
    const [x1, y1] = punkte[a];
    const [x2, y2] = punkte[b];
    const dx = x2 - x1;
    const dy = y2 - y1;
    const laenge = Math.hypot(dx, dy) || 1e-12;
    let weitester = -1;
    let max = 0;
    for (let i = a + 1; i < b; i += 1) {
      const d = Math.abs(dy * punkte[i][0] - dx * punkte[i][1] + x2 * y1 - y2 * x1) / laenge;
      if (d > max) { max = d; weitester = i; }
    }
    if (weitester >= 0 && max > toleranz) {
      behalten[weitester] = 1;
      stapel.push([a, weitester], [weitester, b]);
    }
  }
  return punkte.filter((_, i) => behalten[i]);
};

const gleisLinie = async (halte: Halt[]): Promise<[number, number][] | null> => {
  const punkte = halte.filter((h) => h.lat != null && h.lng != null);
  if (punkte.length < 2) return null;
  const basis = normalizeText(Deno.env.get('TRISAR_SCHIENEN_OSRM_URL') || 'http://trisar-osrm-schiene:5000');
  const koordinaten = punkte.map((h) => `${h.lng},${h.lat}`).join(';');
  // Halt kann ein paar hundert Meter neben dem Gleis liegen (Empfangsgebaeude): Suchradius je Punkt.
  const radien = punkte.map(() => '1500').join(';');
  try {
    const r = await fetch(`${basis}/route/v1/train/${koordinaten}?overview=full&geometries=geojson&continue_straight=false&radiuses=${radien}`, {
      signal: AbortSignal.timeout(6000),
    });
    if (!r.ok) return null;
    const daten = await r.json();
    const linie = daten?.routes?.[0]?.geometry?.coordinates;
    if (!Array.isArray(linie) || linie.length < 2) return null;
    // Auf 5 Nachkommastellen (ca. 1 m) kuerzen, das haelt die Antwort klein.
    return vereinfachen(linie as [number, number][])
      .map(([lng, lat]) => [Math.round(lng * 1e5) / 1e5, Math.round(lat * 1e5) / 1e5] as [number, number]);
  } catch {
    return null;
  }
};

const abstandKm = (lat1: number, lng1: number, lat2: number, lng2: number) => {
  const r = Math.PI / 180;
  const dLat = (lat2 - lat1) * r;
  const dLng = (lng2 - lng1) * r;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLng / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(a));
};

type Halt = { name: string; eva: string | null; lat: number | null; lng: number | null };

/** Je Laufzeit der Funktion: Halte nicht bei jedem Aufruf neu nachschlagen. */
const haltCache = new Map<string, Halt>();

/**
 * Grenze der Bahn-API: 60 Aufrufe je Minute. Ein Aufruf dieser Funktion bleibt deutlich darunter,
 * sonst bricht die Bahn ab und die Funktion laeuft in die Zeitgrenze (13.11.: ICE 2518 bis Hamburg).
 */
let bahnAufrufe = 0;
const BAHN_HOECHSTENS = 40;
const bahnHolen = (url: string, init: RequestInit, zeitgrenzeMs = 15000) => {
  bahnAufrufe += 1;
  return fetch(url, { ...init, signal: AbortSignal.timeout(zeitgrenzeMs) });
};

/** Dauerhafter Speicher der Bahnhofskoordinaten (Tabelle bahnhof_ort): jeder Bahnhof nur einmal bei der Bahn. */
const speicher = (() => {
  const url = Deno.env.get('SUPABASE_URL');
  const schluessel = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  return url && schluessel ? createClient(url, schluessel, { auth: { persistSession: false } }) : null;
})();

/**
 * Fahrplan-Namen ("Frankfurt(Main)Hbf") kennt die Stationsdatenbank nicht als Suchtext. Darum erst
 * ueber die Fahrplan-API die EVA-Nummer holen, dann ueber die Stationsdatenbank die Koordinaten.
 * Bahnhoefe im Ausland stehen dort nicht: die bleiben ohne Koordinaten.
 */
const haltOrten = async (name: string, timetableApiBase: string, stationApiBase: string, headers: HeadersInit): Promise<Halt> => {
  const schluessel = normalizeStationLabel(name);
  const bekannt = haltCache.get(schluessel);
  if (bekannt) return bekannt;
  const halt: Halt = { name, eva: null, lat: null, lng: null };
  // Budget fuer diesen Aufruf aufgebraucht: ohne Koordinaten weiter (die Linie laesst den Halt aus).
  if (bahnAufrufe >= BAHN_HOECHSTENS) return halt;
  try {
    const r = await bahnHolen(`${timetableApiBase}/station/${encodeURIComponent(name)}`, { headers });
    if (r.ok) {
      const xml = await r.text();
      const eintraege = Array.from(xml.matchAll(/<station\b[^>]*\/?>/g)).map((m) => ({
        name: readAttr(m[0], 'name'),
        eva: readAttr(m[0], 'eva'),
      })).filter((e) => e.eva);
      const treffer = eintraege.find((e) => normalizeStationLabel(e.name) === schluessel) || eintraege[0];
      if (treffer) halt.eva = treffer.eva;
    }
    if (halt.eva) {
      const s = await bahnHolen(`${stationApiBase}/stations?eva=${encodeURIComponent(halt.eva)}`, {
        headers: { ...(headers as Record<string, string>), Accept: 'application/json' },
      });
      if (s.ok) {
        const daten = await s.json().catch(() => null);
        for (const station of extractCandidates(daten)) {
          const nummern = Array.isArray(station.evaNumbers) ? station.evaNumbers as Record<string, unknown>[] : [];
          const passend = nummern.find((n) => String(n.number) === halt.eva) || nummern.find((n) => n.isMain) || nummern[0];
          const punkt = (passend?.geographicCoordinates as Record<string, unknown> | undefined)?.coordinates;
          if (Array.isArray(punkt) && punkt.length >= 2) {
            halt.lng = toNumberOrNull(punkt[0]);
            halt.lat = toNumberOrNull(punkt[1]);
            break;
          }
        }
      }
    }
  } catch {
    // Ohne Koordinaten weiter: die Linie laeuft dann ueber die uebrigen Halte.
  }
  // Nur Erfolge dauerhaft merken, ein Netzfehler soll beim naechsten Aufruf neu versucht werden.
  if (halt.lat != null) haltCache.set(schluessel, halt);
  return halt;
};

/** Bekannte Bahnhoefe aus dem Speicher in den Zwischenspeicher holen (eine Abfrage fuer alle). */
const ausSpeicherLaden = async (namen: string[]) => {
  const fehlen = [...new Set(namen.map(normalizeStationLabel))].filter((k) => k && !haltCache.has(k));
  if (!speicher || !fehlen.length) return;
  const { data } = await speicher.from('bahnhof_ort').select('schluessel, name, eva, lat, lng').in('schluessel', fehlen);
  for (const z of data || []) {
    haltCache.set(z.schluessel, { name: z.name, eva: z.eva, lat: z.lat, lng: z.lng });
  }
};

const inSpeicherMerken = async (halte: Halt[]) => {
  const neu = halte.filter((h) => h.lat != null && h.eva).map((h) => ({
    schluessel: normalizeStationLabel(h.name), name: h.name, eva: h.eva, lat: h.lat, lng: h.lng,
  }));
  if (!speicher || !neu.length) return;
  await speicher.from('bahnhof_ort').upsert(neu, { onConflict: 'schluessel' });
};

/**
 * Halte nacheinander in kleinen Gruppen orten. Mit Ziel (lat/lng): aufhoeren, sobald der Zug sich
 * nach dem naechsten Halt wieder deutlich vom Ziel entfernt (dort steigt man aus).
 */
const halteOrten = async (
  namen: string[], timetableApiBase: string, stationApiBase: string, headers: HeadersInit,
  ziel: { lat: number; lng: number } | null = null,
) => {
  await ausSpeicherLaden(namen).catch(() => {});
  const ergebnis: Halt[] = [];
  let besterAbstand = Number.POSITIVE_INFINITY;
  let weiterWeg = 0;
  for (let i = 0; i < namen.length; i += 4) {
    const gruppe = await Promise.all(namen.slice(i, i + 4).map((n) => haltOrten(n, timetableApiBase, stationApiBase, headers)));
    ergebnis.push(...gruppe);
    if (ziel) {
      for (const h of gruppe) {
        if (h.lat == null || h.lng == null) continue;
        const a = abstandKm(h.lat, h.lng, ziel.lat, ziel.lng);
        if (a < besterAbstand) { besterAbstand = a; weiterWeg = 0; } else if (a > besterAbstand + 30) weiterWeg += 1;
      }
      if (weiterWeg >= 2) break;
    }
  }
  inSpeicherMerken(ergebnis).catch(() => {});
  return ergebnis;
};

// MARK: Zwischenhalte (ausklappbare Halte-Liste in der App, wie DB Navigator)

/** Zeiten als "HH:MM" (Ortszeit). an/ab = Ist-Zeit aus fchg (ct), sonst Planzeit. */
type ZwischenHalt = {
  name: string;
  an_plan: string | null;
  an: string | null;
  ab_plan: string | null;
  ab: string | null;
  gleis: string | null;
};

/** Je Zug, Datum, Start und Ziel 90 s merken: die Apps fragen alle 2 min. */
const halteCache = new Map<string, { bis: number; halte: ZwischenHalt[] }>();
const HALTE_CACHE_MS = 90_000;
/** Eigenes Unterbudget der Halte-Liste (Bahn-API: 60 Aufrufe je Minute). */
const HALTE_HOECHSTENS = 25;
/** Nach dieser Zeit liefert die Liste, was sie bis dahin hat (Funktion soll unter ca. 20 s bleiben). */
const HALTE_ZEITGRENZE_MS = 8000;

const uhrzeit = (isoLike: string | null) => extractEtaLabel(isoLike) || null;

/**
 * Zeiten der Halte zwischen Start und Ziel. Je Halt die Stunde linear zwischen Abfahrt und Ankunft
 * schaetzen, plan/{eva}/{datum}/{stunde} und fchg/{eva} zugleich holen, den Zug per Nummer suchen
 * (sonst rohe fchg = Ersatzzug, dann Nachbarstunde). Ohne EVA oder Budget: nur der Name.
 * Zeiten sind naive Ortszeit ("YYYY-MM-DDTHH:MM:00"), darum hier durchgehend als UTC gerechnet.
 */
const zwischenhalteLaden = async (
  namen: string[], evas: (string | null)[], zugNummer: string,
  abfahrtPlan: string | null, ankunftPlan: string | null,
  timetableApiBase: string, headers: HeadersInit,
): Promise<{ halte: ZwischenHalt[]; vollstaendig: boolean }> => {
  const halte: ZwischenHalt[] = namen.map((name) => ({ name, an_plan: null, an: null, ab_plan: null, ab: null, gleis: null }));
  const t0 = toEpoch(abfahrtPlan ? `${abfahrtPlan}Z` : null);
  const t1 = toEpoch(ankunftPlan ? `${ankunftPlan}Z` : null);
  if (!halte.length || !Number.isFinite(t0) || !Number.isFinite(t1) || t1 < t0) return { halte, vollstaendig: true };

  // Gesamtgrenze bleibt unter 60/min, auch wenn Start/Ziel schon viel verbraucht haben.
  let budget = Math.min(HALTE_HOECHSTENS, Math.max(0, BAHN_HOECHSTENS + 15 - bahnAufrufe));
  const leer = new Map<string, StopChange>();
  const textHolen = async (url: string) => {
    try {
      const r = await bahnHolen(url, { headers }, 6000);
      return r.ok ? await r.text() : '';
    } catch {
      return '';
    }
  };
  const planUrl = (eva: string, ms: number) => {
    const iso = new Date(ms).toISOString();
    return `${timetableApiBase}/plan/${encodeURIComponent(eva)}/${toDbDateToken(iso.slice(0, 10))}/${iso.slice(11, 13)}`;
  };

  /** Den Zug in einem XML finden: Ankunft (parsePlanXml) und Abfahrt (parseDepartureXml) je stopId, naechster zur Schaetzung. */
  const finden = (xml: string, schaetzung: number) => {
    if (!xml) return null;
    const je = new Map<string, { an?: TrainMatch; ab?: DepartureMatch }>();
    for (const m of parsePlanXml(xml, zugNummer, leer)) {
      if (m.score >= 1000) je.set(m.stopId, { ...je.get(m.stopId), an: m });
    }
    for (const m of parseDepartureXml(xml, zugNummer, leer)) {
      if (m.score >= 1000) je.set(m.stopId, { ...je.get(m.stopId), ab: m });
    }
    let bester: { stopId: string; an?: TrainMatch; ab?: DepartureMatch } | null = null;
    let besterAbstand = 4 * 3600_000;
    for (const [stopId, eintrag] of je) {
      const zeit = toEpoch(`${eintrag.an?.plannedArrival ?? eintrag.ab?.plannedDeparture}Z`);
      const abstand = Math.abs(zeit - schaetzung);
      if (Number.isFinite(abstand) && abstand <= besterAbstand) { bester = { stopId, ...eintrag }; besterAbstand = abstand; }
    }
    return bester;
  };

  const einHalt = async (i: number) => {
    const eva = evas[i];
    // Erster Durchgang braucht zwei Aufrufe (plan + fchg). In Fahrtreihenfolge vergeben.
    if (!eva || budget < 2) return;
    budget -= 2;
    const schaetzung = t0 + (t1 - t0) * (i + 1) / (halte.length + 1);
    const [planXml, fchgXml] = await Promise.all([
      textHolen(planUrl(eva, schaetzung)),
      textHolen(`${timetableApiBase}/fchg/${encodeURIComponent(eva)}`),
    ]);
    let treffer = finden(planXml, schaetzung) || finden(fchgXml, schaetzung);
    // Schaetzung daneben: Nachbarstunde, die naehere zuerst.
    const minute = new Date(schaetzung).getUTCMinutes();
    const nachbarn = minute < 30 ? [-1, 1] : [1, -1];
    for (const n of nachbarn) {
      if (treffer || budget < 1) break;
      budget -= 1;
      treffer = finden(await textHolen(planUrl(eva, schaetzung + n * 3600_000)), schaetzung);
    }
    if (!treffer) return;
    const aenderung = fchgXml ? parseFchgXml(fchgXml).get(treffer.stopId) : undefined;
    const anPlan = treffer.an?.plannedArrival ?? null;
    const abPlan = treffer.ab?.plannedDeparture ?? null;
    halte[i] = {
      name: halte[i].name,
      an_plan: uhrzeit(anPlan),
      an: uhrzeit(aenderung?.arrivalChanged ?? anPlan),
      ab_plan: uhrzeit(abPlan),
      ab: uhrzeit(aenderung?.departureChanged ?? abPlan),
      gleis: aenderung?.arrivalPlatform || aenderung?.departurePlatform
        || treffer.an?.arrivalPlatform || treffer.ab?.platform || null,
    };
  };

  let zeitUm: ReturnType<typeof setTimeout> | undefined;
  const fertig = await Promise.race([
    Promise.all(halte.map((_, i) => einHalt(i))).then(() => true),
    new Promise<boolean>((resolve) => { zeitUm = setTimeout(() => resolve(false), HALTE_ZEITGRENZE_MS); }),
  ]);
  clearTimeout(zeitUm);
  // Kopie: spaet eintreffende Antworten aendern die gelieferte Liste nicht mehr.
  return { halte: halte.map((h) => ({ ...h })), vollstaendig: fertig };
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
    let targetStation = normalizeText(body?.target_station ?? body?.target_station_hint);
    // Dienstreise: Abfahrt am Startbahnhof. Ziel darf dann fehlen (Ausstieg = Halt am naechsten zu
    // target_lat/target_lng, sonst Endbahnhof). Alte Aufrufe ohne start_station laufen wie bisher.
    const startStationQuery = normalizeText(body?.start_station);
    const zielLat = toNumberOrNull(body?.target_lat);
    const zielLng = toNumberOrNull(body?.target_lng);
    const mitStrecke = Boolean(startStationQuery) || body?.mit_strecke === true;
    // Zwischenhalte mit Zeiten (ausklappbare Liste), nur mit Start und Ziel.
    const mitHalten = body?.mit_halten === true;
    // Startzeit der Dienstreise ("HH:MM"): Abfahrt erst ab einer Stunde vorher suchen.
    const startStunde = /^\d{1,2}:\d{2}/.test(normalizeText(body?.start_zeit)) ? Number(normalizeText(body.start_zeit).split(':')[0]) : null;
    bahnAufrufe = 0;

    if (!trainNumberRaw) return jsonResponse(400, { error: 'train_number is required' });
    if (!rideDate) return jsonResponse(400, { error: 'ride_date is required (YYYY-MM-DD)' });
    if (!targetStation && !startStationQuery) return jsonResponse(400, { error: 'target_station or start_station is required' });
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

    const dateToken = toDbDateToken(rideDate);
    // Live-Aenderungen eines Bahnhofs. Die rohe Antwort enthaelt auch Zuege, die im Fahrplan fehlen
    // (Ersatz- und Sonderzuege, z. B. ICE 2518 statt ICE 618 am 13.11.): die stehen nur hier, mit <tl>.
    let letzteAenderungenXml = '';
    const aenderungenLaden = async (eva: string) => {
      letzteAenderungenXml = '';
      const fchgResponse = await bahnHolen(`${timetableApiBase}/fchg/${encodeURIComponent(eva)}`, { headers });
      if (fchgResponse.ok) {
        letzteAenderungenXml = await fchgResponse.text();
        return parseFchgXml(letzteAenderungenXml);
      }
      if (fchgResponse.status !== 404) throw new Error(`timetable_fchg_http_${fchgResponse.status}`);
      return new Map<string, StopChange>();
    };
    const amTag = (iso: string | null, ...tage: string[]) => Boolean(iso) && tage.some((t) => String(iso).startsWith(t));
    const folgetagIso = (() => {
      const d = new Date(`${rideDate}T12:00:00Z`);
      d.setUTCDate(d.getUTCDate() + 1);
      return d.toISOString().slice(0, 10);
    })();

    // 1. Abfahrt am Startbahnhof (nur Dienstreise).
    let startStation: StationCandidate | null = null;
    let abfahrt: DepartureMatch | null = null;
    let abfahrtStunde = 0;
    if (startStationQuery) {
      startStation = await pickTargetStation(stationApiBase, headers, startStationQuery);
      if (!startStation) {
        return jsonResponse(200, { valid: false, reason: 'start_station_not_found', message: 'Abfahrtsbahnhof nicht gefunden.' });
      }
      const startAenderungen = await aenderungenLaden(startStation.eva);
      // Erst die Zuege nur aus den Live-Aenderungen (Ersatzzug), dann der Fahrplan.
      const abfahrten: DepartureMatch[] = parseDepartureXml(letzteAenderungenXml, trainNumberRaw, startAenderungen)
        .filter((a) => a.score >= 1000 && amTag(a.plannedDeparture ?? a.predictedDeparture, rideDate));
      const ab = startStunde != null ? Math.max(0, Math.min(23, startStunde - 1)) : 0;
      const stunden = [...Array.from({ length: 24 - ab }, (_, i) => ab + i), ...Array.from({ length: ab }, (_, i) => i)];
      for (const hour of stunden) {
        if (abfahrten.length) { abfahrtStunde = Number((abfahrten[0].plannedDeparture || '').slice(11, 13)) || 0; break; }
        if (bahnAufrufe >= BAHN_HOECHSTENS) break;
        const url = `${timetableApiBase}/plan/${encodeURIComponent(startStation.eva)}/${dateToken}/${String(hour).padStart(2, '0')}`;
        const response = await bahnHolen(url, { headers });
        if (response.status === 404) continue;
        if (!response.ok) throw new Error(`timetable_plan_http_${response.status}`);
        abfahrten.push(...parseDepartureXml(await response.text(), trainNumberRaw, startAenderungen));
        // Frueheste genaue Abfahrt gefunden: die restlichen Stunden sparen (Grenze der Bahn-API).
        if (abfahrten.some((a) => a.score >= 1000)) { abfahrtStunde = hour; break; }
      }
      if (!abfahrten.length) {
        return jsonResponse(200, {
          valid: false,
          reason: 'train_not_found_at_start',
          message: `${trainNumberRaw} fährt am ${rideDate} nicht ab ${startStation.name}.`,
        });
      }
      abfahrten.sort((a, b) => b.score - a.score
        || toEpoch(a.plannedDeparture) - toEpoch(b.plannedDeparture));
      abfahrt = abfahrten[0];
      if (!abfahrtStunde) abfahrtStunde = Number((abfahrt.plannedDeparture || '').slice(11, 13)) || 0;
    }

    // Ohne Ziel: Ausstieg am Halt, der dem Ziel der Dienstreise am naechsten liegt, sonst Endbahnhof.
    let folgeHalte: Halt[] = [];
    let zielStationDirekt: StationCandidate | null = null;
    if (abfahrt && mitStrecke) {
      // Mit Zielname nur bis zu diesem Halt, mit Zielkoordinaten bis der Zug sich wieder entfernt.
      const bisIndex = targetStation
        ? abfahrt.nextStops.findIndex((n) => scoreName(n, targetStation) >= 500)
        : -1;
      const namen = bisIndex >= 0 ? abfahrt.nextStops.slice(0, bisIndex + 1) : abfahrt.nextStops;
      folgeHalte = await halteOrten(namen, timetableApiBase, stationApiBase, headers,
        zielLat != null && zielLng != null ? { lat: zielLat, lng: zielLng } : null);
    }
    if (!targetStation && abfahrt) {
      let bester: Halt | null = null;
      if (zielLat != null && zielLng != null) {
        for (const h of folgeHalte) {
          if (h.lat == null || h.lng == null) continue;
          if (!bester || abstandKm(h.lat, h.lng, zielLat, zielLng) < abstandKm(bester.lat!, bester.lng!, zielLat, zielLng)) bester = h;
        }
      }
      targetStation = bester?.name || abfahrt.nextStops[abfahrt.nextStops.length - 1] || '';
      if (!targetStation) {
        return jsonResponse(200, { valid: false, reason: 'train_ends_at_start', message: `${trainNumberRaw} endet in ${startStation?.name}.` });
      }
      // Fahrplan-Namen findet die Stationssuche nicht: Halt der Strecke direkt mit seiner EVA-Nummer nehmen.
      const zielHalt = bester || (mitStrecke ? folgeHalte[folgeHalte.length - 1] : null)
        || await haltOrten(targetStation, timetableApiBase, stationApiBase, headers);
      if (zielHalt?.eva) {
        zielStationDirekt = { name: zielHalt.name, eva: zielHalt.eva, latitude: zielHalt.lat, longitude: zielHalt.lng };
      }
    }

    // 2. Ankunft am Ziel (wie bisher).
    const station = zielStationDirekt || await pickTargetStation(stationApiBase, headers, targetStation);
    if (!station) {
      return jsonResponse(200, {
        valid: false,
        reason: 'target_station_not_found',
        message: 'Ankunftsbahnhof nicht gefunden.',
      });
    }

    const realtimeChanges = await aenderungenLaden(station.eva);

    // Ersatz-/Sonderzug nur in den Live-Aenderungen: dort zuerst suchen (bei Dienstreise auch Folgetag).
    const allMatches: TrainMatch[] = parsePlanXml(letzteAenderungenXml, trainNumberRaw, realtimeChanges)
      .filter((m) => m.score >= 1000 && amTag(m.plannedArrival ?? m.predictedArrival, rideDate, ...(abfahrt ? [folgetagIso] : [])));
    const ausAenderungen = allMatches.length > 0;
    // Mit Abfahrt: erst ab deren Stunde suchen und bei der ersten genauen Ankunft aufhoeren.
    for (let hour = abfahrt ? abfahrtStunde : 0; hour < 24 && !ausAenderungen; hour += 1) {
      const hourToken = String(hour).padStart(2, '0');
      const url = `${timetableApiBase}/plan/${encodeURIComponent(station.eva)}/${dateToken}/${hourToken}`;
      const response = await fetch(url, { headers });
      if (response.status === 404) continue;
      if (!response.ok) throw new Error(`timetable_plan_http_${response.status}`);
      const xml = await response.text();
      allMatches.push(...parsePlanXml(xml, trainNumberRaw, realtimeChanges));
      if (abfahrt && allMatches.some((m) => m.score >= 1000)) break;
    }
    // Dienstreise ueber Mitternacht (Abfahrt 23:49, Ankunft 00:30): Ankunft am Folgetag suchen.
    if (abfahrt && !allMatches.some((m) => m.score >= 1000)) {
      const folgetag = new Date(`${rideDate}T12:00:00Z`);
      folgetag.setUTCDate(folgetag.getUTCDate() + 1);
      const folgeToken = toDbDateToken(folgetag.toISOString().slice(0, 10));
      for (let hour = 0; hour < Math.min(12, abfahrtStunde + 1); hour += 1) {
        if (bahnAufrufe >= BAHN_HOECHSTENS + 10) break;
        const response = await bahnHolen(`${timetableApiBase}/plan/${encodeURIComponent(station.eva)}/${folgeToken}/${String(hour).padStart(2, '0')}`, { headers });
        if (response.status === 404) continue;
        if (!response.ok) break;
        allMatches.push(...parsePlanXml(await response.text(), trainNumberRaw, realtimeChanges));
        if (allMatches.some((m) => m.score >= 1000)) break;
      }
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

    // Strecke fuer die Karte: Halte mit Koordinaten, vom Start (oder Ursprung des Zugs) bis zum Ziel.
    let strecke: Halt[] | undefined;
    let streckeLinie: [number, number][] | null = null;
    // Index des Ziels in den Folgehalten der Abfahrt.
    const zielIndex = abfahrt
      ? abfahrt.nextStops.reduce((bestIndex, name, i) => {
        const punkte = scoreName(name, station.name);
        return punkte > (bestIndex.punkte) ? { i, punkte } : bestIndex;
      }, { i: abfahrt.nextStops.length - 1, punkte: 0 }).i
      : -1;
    if (mitStrecke) {
      if (abfahrt && startStation) {
        const start = await haltOrten(startStation.name, timetableApiBase, stationApiBase, headers);
        strecke = [start, ...folgeHalte.slice(0, zielIndex + 1)];
      } else {
        strecke = await halteOrten([...best.routeStops, station.name], timetableApiBase, stationApiBase, headers);
      }
      streckeLinie = await gleisLinie(strecke);
    }

    // Zwischenhalte ohne Start und Ziel, in Fahrtreihenfolge.
    let halte: ZwischenHalt[] | undefined;
    if (mitHalten && abfahrt && startStation && zielIndex >= 0 && scoreName(abfahrt.nextStops[zielIndex] || '', station.name) > 0) {
      const schluessel = [normalizedTrain, rideDate, startStation.eva, station.eva].join('|');
      const gemerkt = halteCache.get(schluessel);
      if (gemerkt && gemerkt.bis > Date.now()) {
        halte = gemerkt.halte;
      } else {
        const namen = abfahrt.nextStops.slice(0, zielIndex);
        // EVA aus den georteten Folgehalten (gleiche Reihenfolge), sonst aus dem Zwischenspeicher bahnhof_ort.
        const evas = namen.map((name, i) => folgeHalte[i]?.eva ?? haltCache.get(normalizeStationLabel(name))?.eva ?? null);
        const ergebnis = await zwischenhalteLaden(namen, evas, trainNumberRaw,
          abfahrt.plannedDeparture, best.plannedArrival, timetableApiBase, headers);
        halte = ergebnis.halte;
        if (ergebnis.vollstaendig) {
          const jetzt = Date.now();
          for (const [k, v] of halteCache) if (v.bis <= jetzt) halteCache.delete(k);
          halteCache.set(schluessel, { bis: jetzt + HALTE_CACHE_MS, halte });
        }
      }
    }

    return jsonResponse(200, {
      valid: true,
      reason: etaLabel ? 'ok' : 'unknown_eta',
      message: 'Zug validiert.',
      train_number: normalizedTrain,
      target_station: station.name,
      eta_label: etaLabel,
      ...(abfahrt ? {
        etd_label: extractEtaLabel(abfahrt.predictedDeparture ?? abfahrt.plannedDeparture),
        departure_platform: abfahrt.platform,
      } : {}),
      ...(strecke ? { strecke } : {}),
      ...(strecke && streckeLinie ? { strecke_linie: streckeLinie } : {}),
      ...(halte ? { halte } : {}),
      summary: {
        provider: 'deutsche_bahn_api',
        train_number: normalizedTrain,
        line_name: best.lineName || null,
        target_station_name: station.name,
        target_station_id: station.eva,
        planned_arrival: best.plannedArrival,
        predicted_arrival: best.predictedArrival,
        route_stops: best.routeStops,
        arrival_platform: best.arrivalPlatform,
        arrival_platform_planned: best.arrivalPlatformPlanned,
        ...(abfahrt && startStation ? {
          start_station_name: startStation.name,
          start_station_id: startStation.eva,
          planned_departure: abfahrt.plannedDeparture,
          predicted_departure: abfahrt.predictedDeparture,
          departure_platform: abfahrt.platform,
          departure_platform_planned: abfahrt.platformPlanned,
          next_stops: abfahrt.nextStops,
        } : {}),
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
