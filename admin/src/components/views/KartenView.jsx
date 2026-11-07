import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import NaviFooterKomponente from '../navigation/NaviFooterKomponente';
import { hasSupabaseAdminConfig, supabase, supabaseAdmin } from '../../services/supabase';
import { useI18n } from '../../i18n';
import FahrzeugTelemetrie from '../ui/FahrzeugTelemetrie';
import { berechneEta, berechneAbfahrt, restFahrzeit } from '../../shared/etaBerechnung';
import { adresseAufloesen, karteBereitstellen } from '../../shared/karte/maplibreKarte';
import { FahrSimulation } from '../../demo/fahrSimulation';
import { DEMO_MODE } from '../../datenquelle';
import { useRoutenStandort } from '../../shared/routenStandort';
import { ortIconUrl, ortNachId, useOrte } from '../../shared/orte';
import { ortKreiseAusblenden, ortKreiseZeigen, ortSchildBauen } from '../../shared/karte/ortKreise';

const envOrDefault = (value, fallback) => {
  if (!value) return fallback;
  if (typeof value === 'string' && value.trim().toLowerCase().startsWith('your_')) return fallback;
  return value;
};


const SHEET_MAX_TOP_GAP_PX = 54;
const SHEET_SNAP_THRESHOLD = 36;
const SHEET_PEEK_PX = 34;
const NAV_AND_FOOTER_COVER_PX = 190;
const NAV_BLOCK_OFFSET_PX = 120;
const NAV_TOP_FROM_BOTTOM_PX = 151;
const ADMIN_FALLBACK_ERROR_RE = /invalid jwt|signature is invalid|not allowed|unauthorized|permission denied/i;
const MISSING_CONVOY_ASSIGNMENTS_TABLE_RE = /relation .*convoy_assignments|table .*convoy_assignments|does not exist/i;
const MISSING_COLUMN_RE = /column .* does not exist|could not find the ['"]?.+['"]? column/i;
const MISSING_DRIVER_ACTIVITY_STATE_COLUMN_RE = /column .*driver_activity_state|could not find the ['"]?driver_activity_state['"]? column/i;
const MISSING_DRIVER_SERVICE_COLUMN_RE = /column .*service_start_time|column .*service_end_time|could not find the ['"]?service_start_time['"]? column|could not find the ['"]?service_end_time['"]? column/i;
const MISSING_JOBS_ROUTE_COLUMN_RE = /column .*route|could not find the ['"]?route['"]? column/i;
const MISSING_JOBS_EXT_COLUMN_RE = /column .*ext_route_|column .*ext_driver_to_pickup_|could not find the ['"]?ext_route_|could not find the ['"]?ext_driver_to_pickup_/i;
const JOBS_SELECT_FULL = 'id, driver_id, ride_date, etd, status, route, pickup_name, pickup_address, dropoff_name, dropoff_address, ext_route_duration_mins, ext_route_duration_in_traffic_mins, ext_route_polyline, ext_driver_to_pickup_duration_mins, ext_driver_to_pickup_duration_in_traffic_mins, ext_driver_to_pickup_polyline, ext_driver_to_dropoff_duration_mins, ext_driver_to_dropoff_duration_in_traffic_mins, ext_driver_to_dropoff_last_sync_at';
const JOBS_SELECT_NO_ROUTE = 'id, driver_id, ride_date, etd, status, pickup_name, pickup_address, dropoff_name, dropoff_address, ext_route_duration_mins, ext_route_duration_in_traffic_mins, ext_route_polyline, ext_driver_to_pickup_duration_mins, ext_driver_to_pickup_duration_in_traffic_mins, ext_driver_to_pickup_polyline, ext_driver_to_dropoff_duration_mins, ext_driver_to_dropoff_duration_in_traffic_mins, ext_driver_to_dropoff_last_sync_at';
const JOBS_SELECT_BASE = 'id, driver_id, ride_date, etd, status, pickup_name, pickup_address, dropoff_name, dropoff_address';
// Nur die Punkte aus den TomTom-Payloads, nicht die ganzen JSON-Objekte.
const JOBS_SELECT_PUNKTE = 'route_von:ext_route_payload->von, route_nach:ext_route_payload->nach, anfahrt_nach:ext_driver_to_pickup_payload->nach, zielfahrt_nach:ext_driver_to_dropoff_payload->nach';
const JOBS_SELECT_PREFERENCE_KEY = 'koordinator_karten_jobs_select_preference';
const IN_QUERY_BATCH_SIZE = 30;
const EDGE_FUNCTIONS = {
  externalSync: 'external-sync',
};
const LIVE_DRIVERS_REFRESH_INTERVAL_MS = 15000;
const LIVE_ROUTE_SYNC_INTERVAL_MS = 12000;
const DRIVER_MAP_CACHE_KEY = 'admin_karten_driver_cache_v1';
const MAP_CAMERA_CACHE_KEY = 'admin_karten_camera_v1';
const ROUTE_REQUEST_CACHE_KEY = 'admin_karten_route_cache_v1';
const ROUTE_REQUEST_CACHE_MAX_ENTRIES = 120;
let lastDriverMapCache = [];
let lastMapCameraCache = null;
let lastRouteRequestCache = new Map();

const readDriverMapCache = () => {
  if (Array.isArray(lastDriverMapCache) && lastDriverMapCache.length > 0) return lastDriverMapCache;
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(DRIVER_MAP_CACHE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    lastDriverMapCache = parsed;
    return parsed;
  } catch {
    return [];
  }
};

const writeDriverMapCache = (drivers) => {
  const safe = Array.isArray(drivers) ? drivers : [];
  lastDriverMapCache = safe;
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(DRIVER_MAP_CACHE_KEY, JSON.stringify(safe));
  } catch {
    // ignore storage issues
  }
};

const readMapCameraCache = () => {
  if (
    lastMapCameraCache
    && Number.isFinite(Number(lastMapCameraCache.lat))
    && Number.isFinite(Number(lastMapCameraCache.lng))
    && Number.isFinite(Number(lastMapCameraCache.zoom))
  ) {
    return lastMapCameraCache;
  }
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(MAP_CAMERA_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const lat = Number(parsed?.lat);
    const lng = Number(parsed?.lng);
    const zoom = Number(parsed?.zoom);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(zoom)) return null;
    lastMapCameraCache = { lat, lng, zoom };
    return lastMapCameraCache;
  } catch {
    return null;
  }
};

const writeMapCameraCache = (map) => {
  if (!map || typeof map.getCenter !== 'function' || typeof map.getZoom !== 'function') return;
  const center = map.getCenter();
  const zoom = Number(map.getZoom());
  const lat = Number(center?.lat?.());
  const lng = Number(center?.lng?.());
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(zoom)) return;
  const next = { lat, lng, zoom };
  lastMapCameraCache = next;
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(MAP_CAMERA_CACHE_KEY, JSON.stringify(next));
  } catch {
    // ignore storage issues
  }
};

const normalizeRouteLocationForKey = (value) => {
  if (value && typeof value === 'object' && Number.isFinite(Number(value.lat)) && Number.isFinite(Number(value.lng))) {
    return `${Number(value.lat).toFixed(5)},${Number(value.lng).toFixed(5)}`;
  }
  return String(value || '').trim().toLowerCase();
};

const buildRouteRequestCacheKey = (origin, destination, waypoints = []) => {
  const normalizedWaypoints = (Array.isArray(waypoints) ? waypoints : [])
    .map((entry) => normalizeRouteLocationForKey(entry?.location))
    .filter(Boolean)
    .join('|');
  return [
    normalizeRouteLocationForKey(origin),
    normalizeRouteLocationForKey(destination),
    normalizedWaypoints,
  ].join('::');
};

const readRouteRequestCache = () => {
  if (lastRouteRequestCache instanceof Map && lastRouteRequestCache.size > 0) return lastRouteRequestCache;
  if (typeof window === 'undefined') return new Map();
  try {
    const raw = window.sessionStorage.getItem(ROUTE_REQUEST_CACHE_KEY);
    if (!raw) return new Map();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Map();
    const restored = new Map(parsed);
    lastRouteRequestCache = restored;
    return restored;
  } catch {
    return new Map();
  }
};

const writeRouteRequestCache = (cacheMap) => {
  if (!(cacheMap instanceof Map)) return;
  lastRouteRequestCache = cacheMap;
  if (typeof window === 'undefined') return;
  try {
    const entries = Array.from(cacheMap.entries()).slice(-ROUTE_REQUEST_CACHE_MAX_ENTRIES);
    window.sessionStorage.setItem(ROUTE_REQUEST_CACHE_KEY, JSON.stringify(entries));
  } catch {
    // ignore storage issues
  }
};

const readJobsSelectPreference = () => {
  try {
    const raw = window.localStorage.getItem(JOBS_SELECT_PREFERENCE_KEY);
    if (raw === 'full' || raw === 'no_route' || raw === 'base') return raw;
  } catch {
    // ignore storage access issues
  }
  return 'base';
};

const writeJobsSelectPreference = (value) => {
  try {
    if (value === 'full' || value === 'no_route' || value === 'base') {
      window.localStorage.setItem(JOBS_SELECT_PREFERENCE_KEY, value);
    }
  } catch {
    // ignore storage access issues
  }
};

const chunkArray = (items, chunkSize = IN_QUERY_BATCH_SIZE) => {
  const safe = Array.isArray(items) ? items : [];
  if (safe.length === 0) return [];
  const size = Math.max(1, Number.parseInt(String(chunkSize), 10) || IN_QUERY_BATCH_SIZE);
  const chunks = [];
  for (let i = 0; i < safe.length; i += size) {
    chunks.push(safe.slice(i, i + size));
  }
  return chunks;
};

let coordinatorReadAnonUnavailable = false;
let coordinatorReadSessionPromise = null;
let jobsSelectPreference = readJobsSelectPreference();

const getSupabaseErrorText = (error) => [
  error?.message,
  error?.details,
  error?.hint,
  error?.code,
  error?.status,
  error?.statusText,
].filter(Boolean).join(' | ');
const DRIVER_STATE_ACTIVE = 'aktiv';
const DRIVER_STATE_INACTIVE = 'inaktiv';
const DRIVER_STATE_FREE = 'frei';
const ALL_DRIVER_STATES = [DRIVER_STATE_ACTIVE, DRIVER_STATE_INACTIVE, DRIVER_STATE_FREE];
// Nur in der Demo: feste Zahl aktiver/inaktiver Fahrer mit zugeteilten Fahrten.
// Im Betrieb gilt der echte Zustand aus den Daten.
const MAP_DEMO_STATE_OVERRIDE = {
  enabled: DEMO_MODE,
  activeCount: 40,
  inactiveCount: 50,
};
const DRIVER_STATE_COLORS = {
  [DRIVER_STATE_ACTIVE]: '#FF6F63',
  [DRIVER_STATE_INACTIVE]: '#E3F654',
  [DRIVER_STATE_FREE]: '#59BE80',
};

const normalizeJobStatus = (value) => String(value || '').trim().toLowerCase();
const OPEN_JOB_STATUSES = ['pending', 'assigned', 'offen', 'new', 'requested', 'offered', 'zugewiesen'];
const ACTIVE_JOB_STATUSES = ['at_pickup', 'pickup', 'beim_pickup', 'beim pickup', 'in_progress', 'started', 'unterwegs', 'active', 'ongoing', 'on_trip'];
const isOpenJobStatus = (value) => OPEN_JOB_STATUSES.includes(normalizeJobStatus(value));
const isActiveJobStatus = (value) => ACTIVE_JOB_STATUSES.includes(normalizeJobStatus(value));
const isTripInProgressStatus = (value) => ['in_progress', 'started', 'unterwegs', 'active', 'ongoing', 'on_trip'].includes(normalizeJobStatus(value));
const isDoneOrCancelledStatus = (value) => ['done', 'completed', 'arrived', 'cancelled', 'canceled', 'refused', 'stoniert'].includes(normalizeJobStatus(value));
const normalizeDriverActivityState = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return null;
  if (['aktiv', 'active', 'in_progress', 'unterwegs'].includes(normalized)) return DRIVER_STATE_ACTIVE;
  if (['inaktiv', 'inactive'].includes(normalized)) return DRIVER_STATE_INACTIVE;
  if (['frei', 'free', 'idle', 'available'].includes(normalized)) return DRIVER_STATE_FREE;
  return null;
};
// Demo: Die Beispieldaten haben fast nur noch nicht verplante Fahrten. Damit
// man beim Antippen eines aktiven oder inaktiven Fahrers seine Fahrt mit Anfahrt
// zum Gast und Weg zum Ziel sieht, bekommt er in der Karte eine offene Fahrt von
// heute zugeteilt. Die Daten selbst bleiben unberuehrt.
const DEMO_FAHRT_ZUTEILUNG = new Map();
// Im Betrieb keine simulierte Bewegung: niemand bekommt eine Strecke, jeder
// Fahrer steht an seinem gespeicherten Standort (driver_live_locations).
const KEINE_BEWEGUNG = {
  fahrten: new Map(),
  fahrerSetzen: () => {},
  anfordern: () => {},
  stand: () => null,
  pfad: () => null,
  restMinuten: () => null,
  aufraeumen: () => {},
};
const applyMapDemoStateOverride = (drivers, { offeneFahrten = [], t = (key) => key } = {}) => {
  const list = Array.isArray(drivers) ? drivers : [];
  if (!MAP_DEMO_STATE_OVERRIDE.enabled || list.length === 0) return list;

  const sorted = [...list].sort((a, b) => {
    const aName = String(a?.name || '').trim().toLowerCase();
    const bName = String(b?.name || '').trim().toLowerCase();
    if (aName !== bName) return aName.localeCompare(bName, 'de');
    return String(a?.id || '').localeCompare(String(b?.id || ''), 'de');
  });

  const activeCount = Math.max(0, Number.parseInt(String(MAP_DEMO_STATE_OVERRIDE.activeCount || 0), 10) || 0);
  const inactiveCount = Math.max(0, Number.parseInt(String(MAP_DEMO_STATE_OVERRIDE.inactiveCount || 0), 10) || 0);
  const activeIds = new Set(sorted.slice(0, activeCount).map((entry) => String(entry?.id || '').trim()).filter(Boolean));
  const inactiveIds = new Set(
    sorted
      .slice(activeCount, activeCount + inactiveCount)
      .map((entry) => String(entry?.id || '').trim())
      .filter(Boolean),
  );

  let naechsteFahrt = 0;
  const vergeben = new Set([...DEMO_FAHRT_ZUTEILUNG.values()]);
  const mitDemoFahrt = (entry, driverState) => {
    if (entry.activeRide || !offeneFahrten.length) return { ...entry, driverState };
    // Einmal zugeteilt bleibt die Fahrt beim Fahrer. Sonst wechselte sie beim
    // Nachladen alle 15 s, sobald eine fruehere Fahrt in der Vergangenheit liegt.
    const id = String(entry?.id || '').trim();
    let job = offeneFahrten.find((kandidat) => String(kandidat?.id) === DEMO_FAHRT_ZUTEILUNG.get(id));
    if (!job) {
      const frei = offeneFahrten.filter((kandidat) => !vergeben.has(String(kandidat?.id)));
      job = frei.length ? frei[naechsteFahrt % frei.length] : offeneFahrten[naechsteFahrt % offeneFahrten.length];
      naechsteFahrt += 1;
      DEMO_FAHRT_ZUTEILUNG.set(id, String(job?.id));
      vergeben.add(String(job?.id));
    }
    const aktiv = driverState === DRIVER_STATE_ACTIVE;
    return {
      ...entry,
      driverState,
      activeRide: buildDriverActiveRide(job, t),
      rideInfo: buildDriverRideInfo({ activeJob: aktiv ? job : null, nextJob: aktiv ? null : job, allJobs: [job], t }),
    };
  };

  // Zuteilung in fester Reihenfolge (nach Namen), Rueckgabe in der alten.
  const ergebnis = new Map(sorted.map((entry) => {
    const id = String(entry?.id || '').trim();
    if (activeIds.has(id)) return [id, mitDemoFahrt(entry, DRIVER_STATE_ACTIVE)];
    if (inactiveIds.has(id)) return [id, mitDemoFahrt(entry, DRIVER_STATE_INACTIVE)];
    return [id, { ...entry, driverState: DRIVER_STATE_FREE }];
  }));
  return list.map((entry) => ergebnis.get(String(entry?.id || '').trim()) || entry);
};
const toIsoDate = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  if (/^\d{4}-\d{2}-\d{2}T/.test(raw)) return raw.slice(0, 10);
  const dotMatch = raw.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (dotMatch) return `${dotMatch[3]}-${dotMatch[2]}-${dotMatch[1]}`;
  return '';
};
const toClockTime = (value) => {
  const match = String(value || '').trim().match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const hours = Number.parseInt(match[1], 10);
  const minutes = Number.parseInt(match[2], 10);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return { hours, minutes };
};
const toDateTimeFromRide = (rideDate, etd) => {
  const isoDate = toIsoDate(rideDate);
  const timeParts = toClockTime(etd);
  if (!isoDate || !timeParts) return null;
  const [year, month, day] = isoDate.split('-').map((part) => Number.parseInt(part, 10));
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
  return new Date(year, month - 1, day, timeParts.hours, timeParts.minutes, 0, 0);
};

const formatDuration = (mins, t) => {
  const value = Number(mins || 0);
  if (!Number.isFinite(value) || value <= 0) return t('karten.durationMinutes', { n: 0 });
  if (value < 60) return t('karten.durationMinutes', { n: value });
  const hours = Math.floor(value / 60);
  const minutes = value % 60;
  return t('karten.durationHours', { h: hours, m: String(minutes).padStart(2, '0') });
};

const toPositiveMinutes = (...values) => {
  for (const value of values) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.ceil(parsed);
    }
  }
  return 0;
};

const decodeGooglePolyline = (encoded) => {
  if (!encoded || typeof encoded !== 'string') return [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  const points = [];
  while (index < encoded.length) {
    let b = 0;
    let shift = 0;
    let result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dlat = (result & 1) ? ~(result >> 1) : (result >> 1);
    lat += dlat;
    shift = 0;
    result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dlng = (result & 1) ? ~(result >> 1) : (result >> 1);
    lng += dlng;
    points.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }
  return points;
};

const addMinutesToClock = (timeLabel, minsToAdd) => {
  const parts = toClockTime(timeLabel);
  const minutesDelta = Number(minsToAdd);
  if (!parts || !Number.isFinite(minutesDelta)) return null;
  const date = new Date();
  date.setHours(parts.hours, parts.minutes, 0, 0);
  date.setMinutes(date.getMinutes() + minutesDelta);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
};

const formatClockLabel = (value, fallback = '--:--') => {
  const parts = toClockTime(value);
  if (!parts) return fallback;
  return `${String(parts.hours).padStart(2, '0')}:${String(parts.minutes).padStart(2, '0')}`;
};

const toCompactLocationLabel = (value) => {
  const text = String(value || '').trim();
  if (!text) return '';
  return text.split(',')[0].trim() || text;
};

const extractLocationLabel = (name, address) => {
  const safeName = toCompactLocationLabel(name);
  if (safeName) return safeName;
  const safeAddress = String(address || '').trim();
  if (!safeAddress) return '-';
  return toCompactLocationLabel(safeAddress) || safeAddress;
};

const getRoutePartsFromJob = (job) => {
  const routeParts = String(job?.route || '')
    .split(' - ')
    .map((part) => String(part || '').trim())
    .filter(Boolean);
  const start = routeParts[0] || '';
  const end = routeParts.length > 1 ? routeParts.slice(1).join(' - ') : '';
  return { start, end };
};

const getPickupValuesFromJob = (job) => {
  const routeParts = getRoutePartsFromJob(job);
  const name = String(job?.pickup_name || '').trim() || routeParts.start;
  const address = String(job?.pickup_address || '').trim();
  return { name, address };
};

const getDropoffValuesFromJob = (job) => {
  const routeParts = getRoutePartsFromJob(job);
  const name = String(job?.dropoff_name || '').trim() || routeParts.end;
  const address = String(job?.dropoff_address || '').trim();
  return { name, address };
};

// Ortstyp und Icon wie in der Fahrer-App (Flughafen, Hotel, Adresse).
const RIDE_ICON_AIRPORT = '/icon/_Icon_Grau/Plain_Abflug_Trisar_Icons_01_grau.svg';
const RIDE_ICON_AIRPORT_START = '/icon/_Icon_Grau/Plain_Landen_Trisar_Icons_01_grau.svg';
const RIDE_ICON_HOTEL = '/icon/_Icon_Grau/House_Nav_Trisar_01_grau.svg';
const RIDE_ICON_ADDRESS = '/icon/_Icon_Grau/Pin_Nav_Trisar_Icons_01_grau.svg';
const ortsArt = (name, address) => {
  const text = `${name || ''} ${address || ''}`.toLowerCase();
  if (/\b(flughafen|airport|terminal|muc|fra|ber|ham|dus|str|cgn)\b/.test(text)) return 'airport';
  if (/\b(hotel|resort|hostel|inn|motel|guesthouse|suite|aparthotel|residence)\b/.test(text)) return 'hotel';
  return 'address';
};
const ortsIcon = (art, isStart) => {
  if (art === 'airport') return isStart ? RIDE_ICON_AIRPORT_START : RIDE_ICON_AIRPORT;
  if (art === 'hotel') return RIDE_ICON_HOTEL;
  return RIDE_ICON_ADDRESS;
};
const ORTS_LABEL_KEY = { airport: 'karten.locationAirport', hotel: 'karten.locationHotel', address: 'karten.locationAddress' };
const jobFuerEta = (job) => (job ? {
  status: job.status,
  etd: formatClockLabel(job.etd, ''),
  rideDate: String(job.ride_date || '').slice(0, 10),
  extDriverToDropoffDurationMins: job.ext_driver_to_dropoff_duration_mins,
  extDriverToDropoffDurationInTrafficMins: job.ext_driver_to_dropoff_duration_in_traffic_mins,
  extDriverToDropoffLastSyncAt: job.ext_driver_to_dropoff_last_sync_at,
} : null);

const buildDriverRideInfo = ({
  activeJob = null,
  nextJob = null,
  allJobs = [],
  serviceStartTime = null,
  serviceEndTime = null,
  t,
}) => {
  const rideJob = activeJob || nextJob || null;
  const nextTime = rideJob ? formatClockLabel(rideJob?.etd || nextJob?.etd, '--:--') : '--:--';
  const routeDurationMins = toPositiveMinutes(
    rideJob?.ext_route_duration_in_traffic_mins,
    rideJob?.ext_route_duration_mins,
  );
  const jetzt = new Date();
  const etaJob = jobFuerEta(rideJob);
  const abfahrt = rideJob ? (berechneAbfahrt(etaJob, jetzt) || nextTime) : '--:--';
  const computedEta = rideJob ? berechneEta(etaJob, routeDurationMins, jetzt) : null;
  const fahrMinuten = rideJob ? restFahrzeit(etaJob, routeDurationMins, jetzt) : 0;
  const pickupValues = getPickupValuesFromJob(rideJob);
  const dropoffValues = getDropoffValuesFromJob(rideJob);
  const startArt = ortsArt(pickupValues.name, pickupValues.address);
  const zielArt = ortsArt(dropoffValues.name, dropoffValues.address);
  // Eigener Ort der Fahrt: sein Icon gewinnt vor dem Textmuster.
  const startOrt = ortNachId(rideJob?.pickup_ort_id);
  const zielOrt = ortNachId(rideJob?.dropoff_ort_id);
  const sortedDriverJobs = (Array.isArray(allJobs) ? allJobs : [])
    .map((job) => ({ job, dateTime: toDateTimeFromRide(job?.ride_date, job?.etd) }))
    .filter((entry) => Boolean(entry?.dateTime))
    .sort((a, b) => a.dateTime.getTime() - b.dateTime.getTime());
  const firstJob = sortedDriverJobs[0]?.job || null;
  const lastJob = sortedDriverJobs[sortedDriverJobs.length - 1]?.job || null;
  const lastJobDurationMins = toPositiveMinutes(
    lastJob?.ext_route_duration_in_traffic_mins,
    lastJob?.ext_route_duration_mins,
  );
  const serviceStartLabel = formatClockLabel(serviceStartTime || firstJob?.etd, '--:--');
  const serviceEndBase = serviceEndTime || addMinutesToClock(formatClockLabel(lastJob?.etd, '--:--'), lastJobDurationMins) || lastJob?.etd;
  const serviceEndLabel = formatClockLabel(serviceEndBase, '--:--');
  return {
    dienststart: serviceStartLabel,
    dienstende: serviceEndLabel,
    nextStart: abfahrt,
    nextEnd: computedEta || '--:--',
    driveMins: fahrMinuten,
    unterwegs: Boolean(rideJob) && ['in_progress', 'unterwegs', 'started', 'on_trip', 'ongoing', 'active'].includes(String(rideJob?.status || '').trim().toLowerCase()),
    from: rideJob
      ? {
          type: startOrt ? t('orte.eigenerOrt') : t(ORTS_LABEL_KEY[startArt]),
          icon: startOrt ? ortIconUrl(startOrt.icon) : ortsIcon(startArt, true),
          label: extractLocationLabel(pickupValues.name, pickupValues.address),
        }
      : { type: '-', label: t('karten.noActiveRide') },
    to: rideJob
      ? {
          type: zielOrt ? t('orte.eigenerOrt') : t(ORTS_LABEL_KEY[zielArt]),
          icon: zielOrt ? ortIconUrl(zielOrt.icon) : ortsIcon(zielArt, false),
          label: extractLocationLabel(dropoffValues.name, dropoffValues.address),
        }
      : { type: '-', label: '-' },
  };
};

const buildLocationQuery = (name, address) => {
  const safeName = String(name || '').trim();
  const safeAddress = String(address || '').trim();
  if (safeName && safeAddress && safeName !== safeAddress) return `${safeName}, ${safeAddress}`;
  return safeName || safeAddress || '';
};

// Koordinaten, die die Fahrt schon mitbringt, in der Reihenfolge wie
// trisar_evaluate_job_status: Pin des eigenen Orts, dann der TomTom-Payload der
// Fahrt (von/nach), dann die Anfahrts-Payloads. Erst ohne sie wird die Adresse gesucht.
const punktAus = (wert) => {
  if (!wert || typeof wert !== 'object') return null;
  const lat = Number(wert.lat);
  const lng = Number(wert.lng ?? wert.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) return null;
  return { lat, lng };
};
const fahrtPunkte = (job) => {
  const startOrt = ortNachId(job?.pickup_ort_id);
  const zielOrt = ortNachId(job?.dropoff_ort_id);
  return {
    von: punktAus(startOrt) || punktAus(job?.route_von) || punktAus(job?.ext_route_payload?.von)
      || punktAus(job?.anfahrt_nach) || punktAus(job?.ext_driver_to_pickup_payload?.nach),
    nach: punktAus(zielOrt) || punktAus(job?.route_nach) || punktAus(job?.ext_route_payload?.nach)
      || punktAus(job?.zielfahrt_nach) || punktAus(job?.ext_driver_to_dropoff_payload?.nach),
  };
};

const buildDriverActiveRide = (job, t) => {
  if (!job) return null;
  const punkte = fahrtPunkte(job);
  const pickupValues = getPickupValuesFromJob(job);
  const dropoffValues = getDropoffValuesFromJob(job);
  const fromQuery = buildLocationQuery(pickupValues.name, pickupValues.address);
  const toQuery = buildLocationQuery(dropoffValues.name, dropoffValues.address);
  if (!fromQuery || !toQuery) return null;
  const extRouteDurationMins = toPositiveMinutes(job?.ext_route_duration_mins);
  const extRouteDurationInTrafficMins = toPositiveMinutes(job?.ext_route_duration_in_traffic_mins);
  const extDriverToPickupDurationMins = toPositiveMinutes(job?.ext_driver_to_pickup_duration_mins);
  const extDriverToPickupDurationInTrafficMins = toPositiveMinutes(job?.ext_driver_to_pickup_duration_in_traffic_mins);
  return {
    id: String(job?.id || '').trim() || null,
    status: normalizeJobStatus(job?.status),
    from: {
      type: t('karten.pickup'),
      label: extractLocationLabel(pickupValues.name, pickupValues.address),
      query: fromQuery,
      ...(punkte.von || {}),
    },
    to: {
      type: t('karten.destination'),
      label: extractLocationLabel(dropoffValues.name, dropoffValues.address),
      query: toQuery,
      ...(punkte.nach || {}),
    },
    via: [],
    extRoutePolyline: String(job?.ext_route_polyline || '').trim(),
    extRouteDurationMins,
    extRouteDurationInTrafficMins,
    extDriverToPickupPolyline: String(job?.ext_driver_to_pickup_polyline || '').trim(),
    extDriverToPickupDurationMins,
    extDriverToPickupDurationInTrafficMins,
  };
};

const getMinSheetPercent = () => {
  const viewportHeight = window.innerHeight || 874;
  const minSheetPx = Math.max(34, (NAV_TOP_FROM_BOTTOM_PX - NAV_BLOCK_OFFSET_PX) + SHEET_PEEK_PX);
  return (minSheetPx / viewportHeight) * 100;
};
const getMaxSheetPercent = () => {
  const viewportHeight = window.innerHeight || 874;
  const maxSheetPx = Math.max(0, viewportHeight - NAV_BLOCK_OFFSET_PX - SHEET_MAX_TOP_GAP_PX);
  return (maxSheetPx / viewportHeight) * 100;
};

// Fahrer auf der Karte nach Figma (Trisar_App_01): Pin mit Fahrernummer in
// der Zustandsfarbe (2557-11941). Faehrt der Fahrer und ist er ausgewaehlt oder
// die Karte nur noch rund 1 km breit, wird aus dem Pin ein Punkt mit einem
// Kegel in Fahrtrichtung (2557-11855, 2557-11892). Rot = aktiv, Gelb =
// inaktiv, Gruen = frei.
const DRIVER_PIN_URLS = {
  [DRIVER_STATE_ACTIVE]: '/icon/_Icon_Karte/Fahrer_Pin_Trisar_01_rot.svg',
  [DRIVER_STATE_INACTIVE]: '/icon/_Icon_Karte/Fahrer_Pin_Trisar_01_gelb.svg',
  [DRIVER_STATE_FREE]: '/icon/_Icon_Karte/Fahrer_Pin_Trisar_01_gruen.svg',
};
const DRIVER_PUNKT_URLS = {
  [DRIVER_STATE_ACTIVE]: '/icon/_Icon_Karte/Fahrer_Punkt_Trisar_01_rot.svg',
  [DRIVER_STATE_FREE]: '/icon/_Icon_Karte/Fahrer_Punkt_Trisar_01_gruen.svg',
};
const FAHRTRICHTUNG_KEGEL_URL = '/icon/_Icon_Karte/Fahrtrichtung_Kegel_Trisar_01.svg';
// Zurueck, Filter und Statusleiste liegen oben ueber der Karte (bis 186 px).
// Beim Einpassen aller Fahrer bleibt darunter frei, damit kein Pin verdeckt ist.
const KNOEPFE_OBEN_PX = 200;
const GRUPPE_KREIS_URL = '/icon/_Icon_Karte/Gruppe_Kreis_Trisar_01.svg';
const PIN_BREITE = 35;
const PIN_HOEHE = 41.1367;
const KEGEL_BREITE = 60.7094;
const KEGEL_HOEHE = 50.5079;
// Ab dieser sichtbaren Kartenbreite zeigen fahrende Fahrer ihre Richtung.
const NAHANSICHT_BREITE_M = 3000;
// Etwas frueher schon Strecken holen, damit die Fahrer beim Heranzoomen
// bereits unterwegs sind.
const SIMULATION_BREITE_M = 3000;

// Deckkraft der nicht fokussierten Fahrer, solange ein Fahrer ausgewählt ist.
const DIMMED_MARKER_OPACITY = 0.3;
// Groesste Zoomstufe beim Einpassen auf alle Fahrer (Karten-Knopf erneut tippen).
const ALLE_FAHRER_MAX_ZOOM = 13.5;
// Letzter bekannter Zuendungsstand je Fahrer, damit nur ein Wechsel neu laedt.
const zuendungStand = new Map();

// Zuendung aus (laut Tracker): nur das Weiss des Markers (Ring, Stiel) auf 70 %,
// die Statusfarbe bleibt voll. Eigene SVG-Varianten mit Endung _zuendung_aus.
const zuendungsVariante = (url, zuendungAus) => (zuendungAus && url ? url.replace(/\.svg$/, '_zuendung_aus.svg') : url);

const createDriverMarkerIcon = (googleMaps, driverState, mitRichtung = false, zuendungAus = false) => {
  // Fuer Gelb gibt es im Figma keinen eigenen Punkt: der Kreis des gelben Pins
  // ist derselbe, also wird nur seine Spitze abgeschnitten.
  if (mitRichtung && driverState === DRIVER_STATE_INACTIVE) {
    return {
      url: zuendungsVariante(DRIVER_PIN_URLS[DRIVER_STATE_INACTIVE], zuendungAus),
      scaledSize: new googleMaps.Size(PIN_BREITE, PIN_HOEHE),
      ausschnitt: new googleMaps.Size(PIN_BREITE, PIN_BREITE),
      anchor: new googleMaps.Point(PIN_BREITE / 2, PIN_BREITE / 2),
      labelOrigin: new googleMaps.Point(PIN_BREITE / 2, PIN_BREITE / 2),
    };
  }
  const punkt = mitRichtung ? DRIVER_PUNKT_URLS[driverState] : null;
  if (punkt) {
    return {
      url: zuendungsVariante(punkt, zuendungAus),
      scaledSize: new googleMaps.Size(PIN_BREITE, PIN_BREITE),
      anchor: new googleMaps.Point(PIN_BREITE / 2, PIN_BREITE / 2),
      labelOrigin: new googleMaps.Point(PIN_BREITE / 2, PIN_BREITE / 2),
    };
  }
  return {
    url: zuendungsVariante(DRIVER_PIN_URLS[driverState] || DRIVER_PIN_URLS[DRIVER_STATE_FREE], zuendungAus),
    scaledSize: new googleMaps.Size(PIN_BREITE, PIN_HOEHE),
    anchor: new googleMaps.Point(PIN_BREITE / 2, PIN_HOEHE),
    labelOrigin: new googleMaps.Point(PIN_BREITE / 2, PIN_BREITE / 2),
  };
};

const createDriverMarkerLabel = (driverNumber) => ({
  text: driverNumber != null && String(driverNumber).trim() ? String(driverNumber) : '?',
  color: '#1A1A1A',
  fontSize: '15px',
  fontWeight: '700',
});

const createRichtungIcon = (googleMaps, grad) => ({
  url: FAHRTRICHTUNG_KEGEL_URL,
  scaledSize: new googleMaps.Size(KEGEL_BREITE, KEGEL_HOEHE),
  // Das schmale Ende sitzt auf dem Fahrer, das breite zeigt in Fahrtrichtung.
  anchor: new googleMaps.Point(KEGEL_BREITE / 2, KEGEL_HOEHE),
  rotation: grad,
});

// Gruppe nach Figma 2563-12242: weisser Kreis mit der Anzahl, aber nicht
// groesser als ein Fahrer auf der Karte (35 px). Die Schrift ist im selben
// Verhaeltnis kleiner (25 px bei 60 px Kreis ergibt 15 px). Gezaehlt wird in
// Fuenferschritten: ab 5 Fahrern, 7 Fahrer zeigen 5, 12 zeigen 10.
const GRUPPE_AB = 5;
const createDriverClusterIcon = (googleMaps) => ({
  url: GRUPPE_KREIS_URL,
  scaledSize: new googleMaps.Size(PIN_BREITE, PIN_BREITE),
  anchor: new googleMaps.Point(PIN_BREITE / 2, PIN_BREITE / 2),
  labelOrigin: new googleMaps.Point(PIN_BREITE / 2, PIN_BREITE / 2),
});

const createDriverClusterLabel = (clusterSize) => ({
  text: String(Math.floor(clusterSize / GRUPPE_AB) * GRUPPE_AB),
  color: '#000000',
  fontSize: '15px',
  fontWeight: '700',
});

const _createRidePointMarkerIcon = (googleMaps) => ({
  path: googleMaps.SymbolPath.CIRCLE,
  scale: 7,
  fillColor: '#E3F654',
  fillOpacity: 1,
  strokeColor: '#111111',
  strokeOpacity: 1,
  strokeWeight: 3,
});

// Abholort (rot, Gast) und Ziel (Schachbrett) nach Figma 2557-11967.
const createPickupMarkerIcon = (googleMaps) => ({
  url: '/icon/_Icon_Karte/Abholort_Pin_Trisar_01_rot.svg',
  scaledSize: new googleMaps.Size(PIN_BREITE, PIN_HOEHE),
  anchor: new googleMaps.Point(PIN_BREITE / 2, PIN_HOEHE),
});

const createFinishFlagIcon = (googleMaps) => ({
  url: '/icon/_Icon_Karte/Ziel_Pin_Trisar_01.svg',
  scaledSize: new googleMaps.Size(PIN_BREITE, PIN_HOEHE),
  anchor: new googleMaps.Point(PIN_BREITE / 2, PIN_HOEHE),
});

const createDashedLineSymbol = () => ({
  path: 'M 0,-1 0,1',
  strokeOpacity: 1,
  scale: 4,
  strokeColor: '#E3F654',
});

const ensureCoordinatorReadSession = async () => {
  if (coordinatorReadAnonUnavailable) return false;
  if (coordinatorReadSessionPromise) return coordinatorReadSessionPromise;

  coordinatorReadSessionPromise = (async () => {
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      if (sessionData?.session) return true;
      // Kein signInAnonymously mehr: verhindert 422-Spam bei deaktivierter anonymer Auth.
      coordinatorReadAnonUnavailable = true;
      return true;
    } catch {
      return true;
    } finally {
      coordinatorReadSessionPromise = null;
    }
  })();

  try {
    return await coordinatorReadSessionPromise;
  } catch {
    return false;
  }
};

function GoogleMapSurface({ drivers, selectedDriver, onDriverSelect, onMapEmptyClick, sheetPercent, onRouteMetricsChange = () => {}, resetCameraSignal = 0, orte = [], gewaehlterOrtId = null, onOrtToggle = () => {} }) {
  const { t } = useI18n();
  const mapRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const onDriverSelectRef = useRef(onDriverSelect);
  const initializedResetSignalRef = useRef(false);
  const markersByDriverRef = useRef(new Map());
  const clusterMarkersRef = useRef([]);
  const directionsServiceRef = useRef(null);
  const routeOverlaysRef = useRef([]);
  const routeBoundsRef = useRef(null);
  const routeFitStateRef = useRef({ key: '', fitted: false });
  const [mapReady, setMapReady] = useState(false);
  // Fahrtrichtung: Kegel je Fahrer und die aktuelle Form des Markers (Pin
  // oder Punkt), damit das Bild nur beim Wechsel neu aufgebaut wird.
  const kegelByDriverRef = useRef(new Map());
  // Route des gewaehlten Fahrers in Teilen (Anfahrt, Fahrt), je als noch zu
  // fahrende Linie und als schon gefahrene, blasse Linie dahinter.
  const routenTeileRef = useRef([]);
  const routenFortschrittRef = useRef({ teil: 0, index: 0 });
  // Meldet, wenn der Fahrer von seiner gezeichneten Route abgekommen ist (dann neu rechnen).
  const abseitsMeldenRef = useRef(null);
  const formByDriverRef = useRef(new Map());
  const driversRef = useRef(drivers);
  const selectedIdRef = useRef('');
  // Kolonnenfahrer der Fahrt des gewaehlten Fahrers — sie treten nicht zurueck.
  const kolonneIdsRef = useRef(new Set());
  // Woher Standort, Richtung und Tempo kommen. In der Demo die Simulation,
  // im Betrieb die OBD-Werte des Fahrzeugs (heading_deg, speed_mps).
  const bewegungRef = useRef(null);
  const [geplantFuerAuswahl, setGeplantFuerAuswahl] = useState(0);
  // Im Betrieb kommt der Standort aus den Live-Daten der Fahrer. So laeuft der
  // Routen-Fortschritt (gefahrener Teil blass, Rest ab dem Auto) auch ohne Simulation.
  if (!bewegungRef.current && !DEMO_MODE) {
    bewegungRef.current = {
      ...KEINE_BEWEGUNG,
      stand: (id) => {
        const driver = (driversRef.current || []).find((entry) => String(entry?.id || '').trim() === String(id || '').trim());
        const lat = Number(driver?.lat);
        const lng = Number(driver?.lng);
        return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
      },
    };
  }
  if (!bewegungRef.current) {
    bewegungRef.current = new FahrSimulation({
      beiGeplant: (id) => {
        if (id === selectedIdRef.current) setGeplantFuerAuswahl((stand) => stand + 1);
      },
      wegSuchen: (von, bis, ueber) => new Promise((resolve) => {
        const dienst = directionsServiceRef.current || (window.trisarKarte ? new window.trisarKarte.DirectionsService() : null);
        if (!dienst) { resolve(null); return; }
        dienst.route(
          { origin: von, destination: bis, waypoints: ueber.map((location) => ({ location })), travelMode: 'DRIVING' },
          (ergebnis, status) => {
            // Luftlinie als Notloesung taugt nicht zum Fahren: dann spaeter neu.
            if (status !== 'OK' || ergebnis?.notloesung) { resolve(null); return; }
            const pfad = ergebnis?.routes?.[0]?.overview_path || [];
            resolve(pfad.map((punkt) => ({ lat: punkt.lat(), lng: punkt.lng() })));
          },
        );
      }),
      ortSuchen: (text) => adresseAufloesen(text),
    });
  }

  useEffect(() => {
    driversRef.current = drivers;
    selectedIdRef.current = String(selectedDriver?.id || '').trim();
    kolonneIdsRef.current = new Set(selectedDriver?.activeRide?.kolonnenFahrerIds || []);
    bewegungRef.current.fahrerSetzen((drivers || []).map((driver) => ({
      ...driver,
      activeRide: driver.activeRide
        ? { ...driver.activeRide, gastNochAbholen: isOpenJobStatus(driver.activeRide.status) }
        : null,
    })));
  }, [drivers, selectedDriver?.id]);

  // Marker eines Fahrers auf Stand bringen: Position aus der Bewegung, Form
  // (Pin oder Punkt mit Kegel) aus Zoom, Auswahl und ob er gerade faehrt.
  const fahrerDarstellen = useCallback((driver) => {
    const map = mapInstanceRef.current;
    if (!map || !window.trisarKarte || !driver) return;
    const id = String(driver.id || '').trim();
    const marker = markersByDriverRef.current.get(id);
    if (!marker) return;

    const stand = bewegungRef.current.stand(id);
    if (stand) marker.setPosition({ lat: stand.lat, lng: stand.lng });

    const selectedId = selectedIdRef.current;
    const isSelected = selectedId === id;
    const inKolonne = kolonneIdsRef.current.has(id);
    const isDimmed = Boolean(selectedId) && !isSelected && !inKolonne;
    const nah = (map.getBreiteMeter?.() ?? Infinity) <= NAHANSICHT_BREITE_M;
    const faehrt = Boolean(stand && stand.speedMps > 0);
    const mitRichtung = faehrt && driver.driverState !== DRIVER_STATE_FREE && (isSelected || nah);
    const form = `${driver.driverState}|${mitRichtung ? 'punkt' : 'pin'}|${driver.zuendungAus ? 'aus' : 'an'}`;
    if (formByDriverRef.current.get(id) !== form) {
      formByDriverRef.current.set(id, form);
      marker.setIcon(createDriverMarkerIcon(window.trisarKarte, driver.driverState, mitRichtung, driver.zuendungAus));
    }

    let kegel = kegelByDriverRef.current.get(id);
    const sichtbar = mitRichtung && Boolean(marker.karte);
    if (!sichtbar) {
      if (kegel) {
        kegel.setMap(null);
        kegelByDriverRef.current.delete(id);
      }
      return;
    }
    if (!kegel) {
      kegel = new window.trisarKarte.Marker({
        position: { lat: stand.lat, lng: stand.lng },
        map,
        icon: createRichtungIcon(window.trisarKarte, stand.headingDeg),
        zIndex: isSelected ? 1990 : 990,
      });
      kegelByDriverRef.current.set(id, kegel);
    } else {
      kegel.setPosition({ lat: stand.lat, lng: stand.lng });
      kegel.setRotation(stand.headingDeg);
    }
    kegel.setOpacity(isDimmed ? DIMMED_MARKER_OPACITY : 1);
    kegel.setZIndex(isSelected ? 1990 : (isDimmed ? 190 : (inKolonne ? 1490 : 990)));
  }, []);

  useEffect(() => {
    onDriverSelectRef.current = onDriverSelect;
  }, [onDriverSelect]);

  const onMapEmptyClickRef = useRef(onMapEmptyClick);
  useEffect(() => {
    onMapEmptyClickRef.current = onMapEmptyClick;
  }, [onMapEmptyClick]);

  // Eigene Orte der Dispo als Icon-Marker. Klick zeigt die Radien als Kreise
  // samt Schild (Name, Radien), erneuter Klick oder Klick auf die Karte blendet aus.
  const ortMarkerRef = useRef(new Map());
  const ortSchildRef = useRef(null);
  const onOrtToggleRef = useRef(onOrtToggle);
  useEffect(() => {
    onOrtToggleRef.current = onOrtToggle;
  }, [onOrtToggle]);

  const hasActiveRide = Boolean(selectedDriver?.activeRide);

  const fitAllDriverMarkers = useCallback(() => {
    const map = mapInstanceRef.current;
    if (!map || !window.trisarKarte) return;

    const bounds = new window.trisarKarte.LatLngBounds();
    markersByDriverRef.current.forEach((marker) => {
      const pos = marker?.getPosition?.();
      if (pos) bounds.extend(pos);
    });

    if (!bounds.isEmpty()) {
      // Nicht naeher als ein Stadtviertel: bei nur einem Fahrer zoomt die Karte
      // sonst bis auf Hausnummern heran.
      map.fitBounds(bounds, { top: KNOEPFE_OBEN_PX, right: 24, bottom: NAV_AND_FOOTER_COVER_PX, left: 24 }, { maxZoom: ALLE_FAHRER_MAX_ZOOM });
    }
  }, []);

  const fitRouteBounds = useCallback(
    (bounds) => {
      const map = mapInstanceRef.current;
      if (!map || !bounds || !hasActiveRide) return;

      const viewportHeight = window.innerHeight || 874;
      const minPercent = getMinSheetPercent();
      const sheetPx = Math.round(viewportHeight * (Math.max(minPercent, Math.min(getMaxSheetPercent(), sheetPercent)) / 100));
      const paddingBottom = NAV_AND_FOOTER_COVER_PX + sheetPx + 10;
      // Oben liegen Zurueck-Knopf und Statusleiste (bis ~190 px) ueber der Karte —
      // die Route darunter einpassen, sonst verschwinden Ziel oder Abholort dahinter.
      // Bei aufgezogenem Blatt bleibt weniger Hoehe, dann entsprechend weniger Rand.
      const paddingTop = Math.max(88, Math.min(210, viewportHeight - paddingBottom - 140));
      map.fitBounds(bounds, { top: paddingTop, right: 40, bottom: paddingBottom, left: 40 });
    },
    [hasActiveRide, sheetPercent],
  );

  const clearRouteOverlays = useCallback(() => {
    routeOverlaysRef.current.forEach((overlay) => {
      if (typeof overlay?.setMap === 'function') overlay.setMap(null);
      if (typeof overlay?.close === 'function') overlay.close();
    });
    routeOverlaysRef.current = [];
    routeBoundsRef.current = null;
    routenTeileRef.current = [];
    routenFortschrittRef.current = { teil: 0, index: 0 };
  }, []);

  // Schon gefahrenen Teil der Route abblenden: der Fahrer wird auf seine
  // Route gelegt (nur vorwaerts, damit Schleifen nicht zurueckspringen), alles
  // davor wird zur blassen Linie.
  const routenFortschrittAktualisieren = useCallback(() => {
    const teile = routenTeileRef.current;
    const id = selectedIdRef.current;
    if (!teile.length || !id) return;
    const stand = bewegungRef.current.stand(id);
    if (!stand) return;
    const meter = (a, b) => {
      const dx = (b.lng - a.lng) * Math.cos((a.lat * Math.PI) / 180) * 111320;
      const dy = (b.lat - a.lat) * 110540;
      return Math.hypot(dx, dy);
    };
    const naechster = (teil, ab, ganz = false) => {
      let index = -1;
      let abstand = Infinity;
      const bis = ganz ? teil.pfad.length : Math.min(teil.pfad.length, ab + 150);
      for (let i = ab; i < bis; i += 1) {
        const d = meter(stand, teil.pfad[i]);
        if (d < abstand) { abstand = d; index = i; }
      }
      return { index, abstand };
    };

    const fortschritt = routenFortschrittRef.current;
    let teil = teile[fortschritt.teil];
    if (!teil) return;
    // Beim ersten Mal kann der Fahrer schon mitten auf der Linie sein.
    let treffer = naechster(teil, fortschritt.index, !fortschritt.gefunden);
    if (treffer.abstand <= 60) fortschritt.gefunden = true;
    const folgeteil = teile[fortschritt.teil + 1];
    if (folgeteil && fortschritt.index >= teil.pfad.length - 3) {
      const weiter = naechster(folgeteil, 0);
      if (weiter.abstand < 40) {
        teil.gefahren.setPath(teil.pfad);
        teil.rest.setPath([]);
        teil.schild?.entfernen();
        fortschritt.teil += 1;
        fortschritt.index = 0;
        teil = folgeteil;
        treffer = weiter;
      }
    }
    // Mehr als 200 m neben der Linie: Route passt nicht mehr, neu rechnen lassen.
    if (treffer.index < 0 || treffer.abstand > 200) abseitsMeldenRef.current?.({ lat: stand.lat, lng: stand.lng });
    if (treffer.index < 0 || treffer.abstand > 60) return;
    fortschritt.index = Math.max(fortschritt.index, treffer.index);
    const hier = { lat: stand.lat, lng: stand.lng };
    teil.gefahren.setPath([...teil.pfad.slice(0, fortschritt.index + 1), hier]);
    const rest = [hier, ...teil.pfad.slice(fortschritt.index + 1)];
    teil.rest.setPath(rest);
    teil.schild?.verschieben(rest[Math.floor(rest.length / 2)]);
  }, []);

  const clearClusterMarkers = useCallback(() => {
    clusterMarkersRef.current.forEach((marker) => marker.setMap(null));
    clusterMarkersRef.current = [];
  }, []);

  const updateDriverClusters = useCallback(() => {
    const map = mapInstanceRef.current;
    if (!map || !window.trisarKarte) return;

    // Im Fokus-Modus bleibt der gewählte Fahrer immer als eigener Marker
    // sichtbar (nie in einem Cluster) und die Cluster treten zurück.
    const focusedId = String(selectedDriver?.id || '').trim();
    const hasFocus = Boolean(focusedId);
    // Die Kolonnenkollegen des gewaehlten Fahrers ebenso: nie im Cluster.
    const immerEinzeln = new Set([focusedId, ...(selectedDriver?.activeRide?.kolonnenFahrerIds || [])].filter(Boolean));

    const zoom = map.getZoom();
    const projection = map.getProjection?.();
    if (!projection || typeof zoom !== 'number') return;

    const pixelFactor = 2 ** zoom;
    const entries = drivers
      .filter((driver) => !immerEinzeln.has(String(driver?.id || '').trim()))
      .map((driver) => {
        const marker = markersByDriverRef.current.get(driver.id);
        const position = marker?.getPosition?.();
        if (!marker || !position) return null;
        const worldPoint = projection.fromLatLngToPoint(position);
        return {
          id: String(driver.id),
          marker,
          position,
          x: worldPoint.x * pixelFactor,
          y: worldPoint.y * pixelFactor,
        };
      })
      .filter(Boolean);

    clearClusterMarkers();
    entries.forEach((entry) => entry.marker.setMap(map));
    // Der fokussierte Marker ist oben aus den Cluster-Kandidaten gefallen —
    // hier sicherstellen, dass er (auch nach früherem Clustern) sichtbar ist.
    if (hasFocus) {
      immerEinzeln.forEach((einzelId) => {
        const einzelMarker = markersByDriverRef.current.get(einzelId);
        if (einzelMarker) einzelMarker.setMap(map);
      });
    }

    const clustered = new Set();
    // Zu einer Gruppe werden Fahrer erst, wenn sich ihre Pins (35 px breit)
    // auf dem Bildschirm beruehren wuerden.
    const clusterRadiusPx = PIN_BREITE + 1;

    for (let i = 0; i < entries.length; i += 1) {
      if (clustered.has(i)) continue;
      const base = entries[i];
      const group = [base];
      const mitglieder = [i];

      for (let j = i + 1; j < entries.length; j += 1) {
        if (clustered.has(j)) continue;
        const candidate = entries[j];
        const dx = base.x - candidate.x;
        const dy = base.y - candidate.y;
        if (Math.hypot(dx, dy) <= clusterRadiusPx) {
          group.push(candidate);
          mitglieder.push(j);
        }
      }

      // Gruppen erst ab fuenf Fahrern. Weniger bleiben einzeln stehen und
      // koennen noch zu einer groesseren Gruppe in der Naehe gehoeren.
      if (group.length < GRUPPE_AB) continue;
      mitglieder.forEach((index) => clustered.add(index));

      group.forEach((entry) => entry.marker.setMap(null));
      const centerLat = group.reduce((sum, entry) => sum + entry.position.lat(), 0) / group.length;
      const centerLng = group.reduce((sum, entry) => sum + entry.position.lng(), 0) / group.length;
      const clusterBounds = new window.trisarKarte.LatLngBounds();
      group.forEach((entry) => clusterBounds.extend(entry.position));

      const clusterMarker = new window.trisarKarte.Marker({
        position: { lat: centerLat, lng: centerLng },
        map,
        icon: createDriverClusterIcon(window.trisarKarte),
        label: createDriverClusterLabel(group.length),
        clickable: true,
        abblenden: hasFocus ? DIMMED_MARKER_OPACITY : 1,
        zIndex: hasFocus ? 210 : 1450,
      });
      clusterMarker.addListener('click', () => {
        if (clusterBounds.isEmpty()) return;
        const currentZoom = map.getZoom() || 12;
        map.fitBounds(clusterBounds, { top: KNOEPFE_OBEN_PX, right: 24, bottom: NAV_AND_FOOTER_COVER_PX, left: 24 });
        // Liegen die Fahrer fast aufeinander, aendert der Ausschnitt kaum etwas:
        // dann nach der Fahrt noch zwei Stufen weich hineinzoomen.
        window.setTimeout(() => {
          const nextZoom = map.getZoom() || currentZoom;
          if (nextZoom <= currentZoom + 0.5) {
            if (typeof map.zoomTo === 'function') map.zoomTo(Math.min(20, currentZoom + 2));
            else map.setZoom(Math.min(20, currentZoom + 2));
          }
        }, 800);
      });
      // Demo-Tutorial: die Gruppe oeffnet die Pins dieser Fahrer. Der Finger
      // tippt sie an, wenn der gesuchte Fahrer darin steckt.
      clusterMarker.element?.setAttribute?.('data-tutorial', 'karte-gruppe');
      clusterMarker.element?.setAttribute?.('data-oeffnet', group.map((entry) => `karte-fahrer-${entry.id}`).join(' '));

      clusterMarkersRef.current.push(clusterMarker);
    }
  }, [clearClusterMarkers, drivers, selectedDriver?.id]);

  useEffect(() => {
    let cancelled = false;

    const initMap = () => {
      if (cancelled || !window.trisarKarte || !mapRef.current || mapInstanceRef.current) return;
      const cachedCamera = readMapCameraCache();

      const map = new window.trisarKarte.Map(mapRef.current, {
        center: cachedCamera
          ? { lat: Number(cachedCamera.lat), lng: Number(cachedCamera.lng) }
          : { lat: 48.137154, lng: 11.576124 },
        zoom: cachedCamera ? Number(cachedCamera.zoom) : 12,
        disableDefaultUI: true,
        clickableIcons: false,
        gestureHandling: 'greedy',
      });

      mapInstanceRef.current = map;
      // Tipp auf die leere Karte hebt die Auswahl eines Fahrers auf. Pins und
      // Gruppen liegen als Marker-Elemente ueber der Karte — deren Klicks
      // kommen hier ebenfalls an und werden uebergangen.
      map.addListener('click', (event) => {
        const ziel = event?.domEvent?.target;
        if (ziel?.closest?.('.maplibregl-marker')) return;
        onMapEmptyClickRef.current?.();
      });
      directionsServiceRef.current = new window.trisarKarte.DirectionsService();
      setMapReady(true);
    };



    // Die Kartenschicht steckt im Bundle, es wird nichts mehr nachgeladen.
    karteBereitstellen();
    initMap();

    return () => {
      cancelled = true;
      writeMapCameraCache(mapInstanceRef.current);
      clearRouteOverlays();
      clearClusterMarkers();
      markersByDriverRef.current.forEach((marker) => marker.setMap(null));
      markersByDriverRef.current.clear();
      kegelByDriverRef.current.forEach((kegel) => kegel.setMap(null));
      kegelByDriverRef.current.clear();
      formByDriverRef.current.clear();
      mapInstanceRef.current = null;
      directionsServiceRef.current = null;
      setMapReady(false);
    };
  }, [clearClusterMarkers, clearRouteOverlays]);

  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!mapReady || !map || !window.trisarKarte) return;
    const vorhanden = ortMarkerRef.current;
    const ids = new Set();
    (Array.isArray(orte) ? orte : []).forEach((ort) => {
      if (!Number.isFinite(Number(ort?.lat)) || !Number.isFinite(Number(ort?.lng))) return;
      ids.add(ort.id);
      const icon = {
        url: ortIconUrl(ort.icon, ort.id === gewaehlterOrtId),
        scaledSize: new window.trisarKarte.Size(28, 28),
        anchor: new window.trisarKarte.Point(14, 14),
      };
      const position = { lat: Number(ort.lat), lng: Number(ort.lng) };
      let eintrag = vorhanden.get(ort.id);
      if (!eintrag) {
        const marker = new window.trisarKarte.Marker({ position, map, icon, title: ort.name, zIndex: 40 });
        marker.addListener('click', (event) => {
          event?.stopPropagation?.();
          onOrtToggleRef.current?.(ort.id);
        });
        eintrag = { marker, url: icon.url };
        vorhanden.set(ort.id, eintrag);
      } else {
        eintrag.marker.setPosition(position);
        eintrag.marker.setTitle(ort.name);
        if (eintrag.url !== icon.url) {
          eintrag.marker.setIcon(icon);
          eintrag.url = icon.url;
        }
      }
    });
    vorhanden.forEach((eintrag, id) => {
      if (ids.has(id)) return;
      eintrag.marker.setMap(null);
      vorhanden.delete(id);
    });
  }, [mapReady, orte, gewaehlterOrtId]);

  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!mapReady || !map) return;
    const ort = (Array.isArray(orte) ? orte : []).find((eintrag) => eintrag.id === gewaehlterOrtId) || null;
    if (!ortSchildRef.current) ortSchildRef.current = ortSchildBauen();
    if (!ort) {
      ortKreiseAusblenden(map);
      ortSchildRef.current.ausblenden();
      return;
    }
    ortKreiseZeigen(map, ort);
    ortSchildRef.current.zeigen(map, ort, t('orte.radienKurz', { rein: ort.radius_rein_m, raus: ort.radius_raus_m }));
  }, [mapReady, orte, gewaehlterOrtId, t]);

  useEffect(() => () => {
    ortMarkerRef.current.forEach((eintrag) => eintrag.marker.setMap(null));
    ortMarkerRef.current.clear();
    ortSchildRef.current?.ausblenden();
  }, []);

  useEffect(() => {
    if (!mapReady || !window.trisarKarte) return;
    const map = mapInstanceRef.current;
    if (!map) return;

    const driversById = new Map(drivers.map((entry) => [String(entry?.id || '').trim(), entry]));
    markersByDriverRef.current.forEach((marker, id) => {
      if (driversById.has(id)) return;
      marker.setMap(null);
      markersByDriverRef.current.delete(id);
      // Mit dem Fahrer (z. B. Gruppe im Filter ausgeblendet) auch seinen
      // Richtungskegel entfernen, sonst bleibt er allein auf der Karte stehen.
      const kegel = kegelByDriverRef.current.get(id);
      if (kegel) {
        kegel.setMap(null);
        kegelByDriverRef.current.delete(id);
      }
      formByDriverRef.current.delete(id);
    });

    const kolonneIds = new Set(selectedDriver?.activeRide?.kolonnenFahrerIds || []);
    drivers.forEach((driver) => {
      const id = String(driver?.id || '').trim();
      if (!id) return;
      const isSelected = selectedDriver?.id === id;
      // Fokus-Modus: ist ein Fahrer gewählt, treten alle anderen zurück
      // (blass und unter die Routenlinien), damit die Route frei liegt.
      // Ausnahme Kolonne: die Kollegen derselben Fahrt bleiben voll sichtbar.
      const inKolonne = kolonneIds.has(id);
      const isDimmed = Boolean(selectedDriver?.id) && !isSelected && !inKolonne;
      const markerOpacity = isDimmed ? DIMMED_MARKER_OPACITY : 1;
      const markerZIndex = isSelected ? 2000 : (isDimmed ? 200 : (inKolonne ? 1500 : 1000));
      let marker = markersByDriverRef.current.get(id);

      if (!marker) {
        marker = new window.trisarKarte.Marker({
          position: { lat: Number(driver.lat), lng: Number(driver.lng) },
          map,
          title: driver.name,
          icon: createDriverMarkerIcon(window.trisarKarte, driver.driverState, false, driver.zuendungAus),
          label: createDriverMarkerLabel(driver.driverNumber),
          // Blass, aber deckend: die Strasse darunter scheint nicht durch.
          abblenden: markerOpacity,
          zIndex: markerZIndex,
        });
        marker.addListener('click', () => {
          onDriverSelectRef.current?.(id);
        });
        // Kennung fuer das Demo-Tutorial am DOM-Element des Markers. Liegt der
        // Fahrer in einem Cluster, ist das Element nicht im DOM — dafuer gibt es
        // window.__TRISAR_KARTE_FAHRER_WAEHLEN (siehe KartenView).
        marker.element?.setAttribute?.('data-tutorial', `karte-fahrer-${id}`);
        markersByDriverRef.current.set(id, marker);
        formByDriverRef.current.set(id, `${driver.driverState}|pin|${driver.zuendungAus ? 'aus' : 'an'}`);
      } else {
        // Faehrt der Fahrer in der Bewegung schon, bleibt seine Position von
        // dort; sonst gilt der gespeicherte Standort.
        if (!bewegungRef.current.stand(id)) marker.setPosition({ lat: Number(driver.lat), lng: Number(driver.lng) });
        marker.setTitle(driver.name);
        marker.setLabel(createDriverMarkerLabel(driver.driverNumber));
        marker.setAbblenden(markerOpacity);
        marker.setZIndex(markerZIndex);
      }
    });

    // Alle aktiven und inaktiven Fahrer fahren; der gewaehlte kommt zuerst dran.
    bewegungRef.current.anfordern(drivers.map((driver) => String(driver.id)));
    if (selectedDriver?.id) bewegungRef.current.anfordern([String(selectedDriver.id)], { vorne: true });
    updateDriverClusters();
    drivers.forEach((driver) => fahrerDarstellen(driver));
  }, [drivers, fahrerDarstellen, mapReady, selectedDriver?.id, updateDriverClusters]);

  // Wer gerade im Bild ist, bekommt seine Strecke zuerst, sobald man naeher
  // herangeht; die uebrigen folgen nach und nach.
  const sichtbareAnfordern = useCallback(() => {
    const map = mapInstanceRef.current;
    if (!map || (map.getBreiteMeter?.() ?? Infinity) > SIMULATION_BREITE_M) return;
    const grenzen = map.getBounds?.();
    const imBild = (driversRef.current || [])
      .filter((driver) => grenzen?.contains?.({ lat: Number(driver.lat), lng: Number(driver.lng) }))
      .map((driver) => String(driver.id));
    bewegungRef.current.anfordern(imBild, { vorne: true });
  }, []);

  // Bewegung laufend nachfuehren.
  useEffect(() => {
    if (!mapReady) return undefined;
    let bild = 0;
    let letzteAnforderung = 0;
    let letzterFortschritt = 0;
    let letzteBewegung = 0;
    let letzteGruppen = 0;
    const schritt = (zeit) => {
      bild = window.requestAnimationFrame(schritt);
      const map = mapInstanceRef.current;
      if (!map) return;
      const liste = driversRef.current || [];
      if (zeit - letzteAnforderung > 1000) {
        letzteAnforderung = zeit;
        sichtbareAnfordern();
      }
      // Weit herausgezoomt bewegt sich ein Fahrer kaum einen Pixel je Sekunde,
      // da reicht ein Nachfuehren alle 400 ms. Nah dran jedes Bild.
      const nah = (map.getBreiteMeter?.() ?? Infinity) <= SIMULATION_BREITE_M;
      if (nah || zeit - letzteBewegung > 400) {
        letzteBewegung = zeit;
        const bewegt = bewegungRef.current.fahrten;
        liste.forEach((driver) => {
          if (bewegt.has(String(driver.id))) fahrerDarstellen(driver);
        });
      }
      // Fahrer ziehen auseinander und zusammen: Gruppen alle 6 s neu bilden.
      // Oefter liesse Pins am Rand einer Gruppe staendig auf- und abtauchen.
      if (zeit - letzteGruppen > 6000) {
        letzteGruppen = zeit;
        updateDriverClusters();
      }
      if (zeit - letzterFortschritt > 250) {
        letzterFortschritt = zeit;
        routenFortschrittAktualisieren();
      }
    };
    bild = window.requestAnimationFrame(schritt);
    return () => window.cancelAnimationFrame(bild);
  }, [fahrerDarstellen, mapReady, routenFortschrittAktualisieren, sichtbareAnfordern, updateDriverClusters]);

  useEffect(() => {
    if (!mapReady) return;
    const map = mapInstanceRef.current;
    if (!map) return undefined;

    const refreshClusters = () => {
      updateDriverClusters();
      sichtbareAnfordern();
      (driversRef.current || []).forEach((driver) => fahrerDarstellen(driver));
      writeMapCameraCache(map);
    };

    const zoomListener = map.addListener('zoom_changed', refreshClusters);
    const idleListener = map.addListener('idle', refreshClusters);
    refreshClusters();

    return () => {
      zoomListener?.remove?.();
      idleListener?.remove?.();
    };
  }, [fahrerDarstellen, mapReady, sichtbareAnfordern, updateDriverClusters]);

  useEffect(() => {
    if (!mapReady) return;
    if (!initializedResetSignalRef.current) {
      initializedResetSignalRef.current = true;
      return;
    }
    routeFitStateRef.current = { key: '', fitted: false };
    fitAllDriverMarkers();
    const map = mapInstanceRef.current;
    if (map) {
      window.setTimeout(() => writeMapCameraCache(map), 160);
    }
  }, [fitAllDriverMarkers, mapReady, resetCameraSignal]);

  // Die Linien folgen dem Auto ueber den Routen-Fortschritt (ohne neue Route). Nur wenn der
  // Fahrer mehr als 200 m von der Route abkommt, wird neu gerechnet, hoechstens alle 15 s.
  const [abseitsPunkt, setAbseitsPunkt] = useState(null);
  abseitsMeldenRef.current = (punkt) => setAbseitsPunkt(punkt);
  const routenStandort = useRoutenStandort(abseitsPunkt?.lat, abseitsPunkt?.lng);

  useEffect(() => {
    if (!mapReady || !window.trisarKarte) return;

    clearRouteOverlays();
    onRouteMetricsChange(null);

    const map = mapInstanceRef.current;
    if (!map) return;

    if (!selectedDriver?.activeRide) {
      routeFitStateRef.current = { key: '', fitted: false };
      return;
    }

    const ride = selectedDriver.activeRide;
    const routeFitKey = [
      String(selectedDriver?.id || ''),
      String(ride?.id || ''),
      String(ride?.status || ''),
      String(ride?.from?.query || ''),
      String(ride?.to?.query || ''),
      String(ride?.from?.lat ?? ''),
      String(ride?.from?.lng ?? ''),
      String(ride?.to?.lat ?? ''),
      String(ride?.to?.lng ?? ''),
      String(ride?.extDriverToPickupPolyline || ''),
      String(ride?.extRoutePolyline || ''),
    ].join('|');
    if (routeFitStateRef.current.key !== routeFitKey) {
      routeFitStateRef.current = { key: routeFitKey, fitted: false };
    }
    const rideStatus = normalizeJobStatus(ride?.status);
    // Aktive Fahrer haben den Gast schon an Bord: fuer sie gibt es keine Anfahrt.
    const shouldRenderApproachRoute = isOpenJobStatus(rideStatus) && selectedDriver?.driverState !== DRIVER_STATE_ACTIVE;
    const directionsService = directionsServiceRef.current;
    if (!directionsService) return;
    const hasLatLng = (point) => Number.isFinite(Number(point?.lat)) && Number.isFinite(Number(point?.lng));
    const toDirectionsLocation = (point) => {
      if (hasLatLng(point)) {
        return {
          lat: Number(point.lat),
          lng: Number(point.lng),
        };
      }
      const query = String(point?.query || point?.label || '').trim();
      return query || null;
    };
    const pickupLocation = toDirectionsLocation(ride?.from);
    const dropoffLocation = toDirectionsLocation(ride?.to);
    const bewegterStand = bewegungRef.current.stand(String(selectedDriver?.id || ''));
    const driverLiveOrigin = bewegterStand
      ? { lat: bewegterStand.lat, lng: bewegterStand.lng }
      : (hasLatLng(selectedDriver) ? { lat: Number(selectedDriver.lat), lng: Number(selectedDriver.lng) } : null);
    const extApproachPath = decodeGooglePolyline(String(ride?.extDriverToPickupPolyline || '').trim());
    const extTripPath = decodeGooglePolyline(String(ride?.extRoutePolyline || '').trim());
    const extApproachMinutes = toPositiveMinutes(ride?.extDriverToPickupDurationInTrafficMins, ride?.extDriverToPickupDurationMins);
    const extTripMinutes = toPositiveMinutes(ride?.extRouteDurationInTrafficMins, ride?.extRouteDurationMins);
    const hasExtFallbackRoute = extApproachPath.length >= 2 || extTripPath.length >= 2;
    if (!pickupLocation && !dropoffLocation && !hasExtFallbackRoute) {
      fitAllDriverMarkers();
      return;
    }

    const routeIncludesDriverToPickup = Boolean(shouldRenderApproachRoute && driverLiveOrigin && pickupLocation);

    const registerOverlay = (overlay) => {
      if (!overlay) return;
      routeOverlaysRef.current.push(overlay);
    };
    const openDurationLabel = (position, text, backgroundColor, textColor = '#FFFFFF') => {
      if (!position || !text) return;
      const latLng = position instanceof window.trisarKarte.LatLng
        ? position
        : new window.trisarKarte.LatLng(Number(position?.lat), Number(position?.lng));
      if (!Number.isFinite(latLng.lat()) || !Number.isFinite(latLng.lng())) return;

      const labelOverlay = new window.trisarKarte.OverlayView();
      labelOverlay.onAdd = function onAdd() {
        const div = document.createElement('div');
        div.style.position = 'absolute';
        div.style.transform = 'translate(-50%, -100%)';
        div.style.pointerEvents = 'none';
        div.style.background = backgroundColor;
        div.style.color = textColor;
        div.style.padding = '6px 12px';
        div.style.borderRadius = '9999px';
        div.style.fontFamily = 'Space Grotesk, sans-serif';
        div.style.fontWeight = '800';
        div.style.fontSize = '13px';
        div.style.whiteSpace = 'nowrap';
        div.style.boxShadow = '0 6px 18px rgba(0,0,0,0.35)';
        div.style.zIndex = '360';
        div.textContent = text;
        this._div = div;
        const panes = this.getPanes();
        panes?.floatPane?.appendChild(div);
      };
      let ort = latLng;
      labelOverlay.draw = function draw() {
        const projection = this.getProjection();
        const div = this._div;
        if (!projection || !div) return;
        const pixel = projection.fromLatLngToDivPixel(ort);
        if (!pixel) return;
        div.style.left = `${pixel.x}px`;
        div.style.top = `${pixel.y}px`;
      };
      labelOverlay.onRemove = function onRemove() {
        const div = this._div;
        if (div?.parentNode) div.parentNode.removeChild(div);
        this._div = null;
      };
      labelOverlay.setMap(map);
      registerOverlay(labelOverlay);
      return {
        verschieben: (punkt) => {
          if (!punkt || !Number.isFinite(punkt.lat) || !Number.isFinite(punkt.lng)) return;
          ort = new window.trisarKarte.LatLng(punkt.lat, punkt.lng);
          labelOverlay.draw();
        },
        entfernen: () => labelOverlay.setMap(null),
      };
    };
    const routeRequestCache = readRouteRequestCache();
    const requestRoute = (origin, destination, waypoints = []) =>
      new Promise((resolve) => {
        const cacheKey = buildRouteRequestCacheKey(origin, destination, waypoints);
        const cached = routeRequestCache.get(cacheKey);
        if (cached && cached.status === 'OK') {
          resolve(cached);
          return;
        }
        directionsService.route(
          {
            origin,
            destination,
            waypoints,
            travelMode: window.trisarKarte.TravelMode.DRIVING,
            drivingOptions: { departureTime: new Date(), trafficModel: 'bestguess' },
          },
          (result, status) => {
            if (status === 'OK' && result?.routes?.[0]) {
              const route = result.routes[0];
              const routeLegs = route.legs || [];
              const path = (route.overview_path || [])
                .map((point) => ({
                  lat: typeof point?.lat === 'function' ? point.lat() : Number(point?.lat),
                  lng: typeof point?.lng === 'function' ? point.lng() : Number(point?.lng),
                }))
                .filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lng));
              const durationSeconds = routeLegs.reduce(
                (sum, leg) => sum + (leg?.duration_in_traffic?.value || leg?.duration?.value || 0),
                0,
              );
              const cachedPayload = {
                status,
                path,
                durationSeconds,
                startLocation: path[0] || null,
                endLocation: path[path.length - 1] || null,
              };
              routeRequestCache.set(cacheKey, cachedPayload);
              if (routeRequestCache.size > ROUTE_REQUEST_CACHE_MAX_ENTRIES) {
                const oldestKey = routeRequestCache.keys().next().value;
                if (oldestKey) routeRequestCache.delete(oldestKey);
              }
              writeRouteRequestCache(routeRequestCache);
              resolve(cachedPayload);
              return;
            }
            resolve({ status, path: [], durationSeconds: 0, startLocation: null, endLocation: null });
          },
        );
      });
    const combinedBounds = new window.trisarKarte.LatLngBounds();
    const extendPathBounds = (path = []) => {
      path.forEach((point) => combinedBounds.extend(point));
    };
    let pickupMarkerRendered = false;

    const drawPickupMarker = (position) => {
      if (!position) return;
      const pickupMarker = new window.trisarKarte.Marker({
        position,
        map,
        icon: createPickupMarkerIcon(window.trisarKarte),
        zIndex: 320,
      });
      registerOverlay(pickupMarker);
      pickupMarkerRendered = true;
    };

    const drawFinishMarker = (position) => {
      if (!position) return;
      const finishMarker = new window.trisarKarte.Marker({
        position,
        map,
        icon: createFinishFlagIcon(window.trisarKarte),
        zIndex: 320,
      });
      registerOverlay(finishMarker);
    };

    // Zu jeder Routenlinie eine zweite fuer den schon gefahrenen Teil. Sie
    // beginnt leer und waechst hinter dem Fahrer mit. Die blaue Fahrt wird
    // dort gestrichelt (wie die Anfahrt), damit der Weg vom Abholort bis zum
    // Fahrer sichtbar bleibt. Die gelbe Anfahrt ist schon gestrichelt und
    // wird hinter dem Fahrer nur blass.
    const routeTeilMerken = (path, linie) => {
      const istBlau = String(linie.optionen?.strokeColor || '').toUpperCase() === '#0059FF'
        && !(Array.isArray(linie.optionen?.icons) && linie.optionen.icons.length);
      const gefahren = new window.trisarKarte.Polyline({
        ...linie.optionen,
        ...(istBlau
          ? { icons: [{ icon: { ...createDashedLineSymbol(), strokeColor: '#0059FF' }, offset: '0', repeat: '12px' }], strokeWeight: 5, linienDeckkraft: 0.8 }
          : { linienDeckkraft: 0.25 }),
        path: [],
        map,
      });
      registerOverlay(gefahren);
      routenTeileRef.current.push({ pfad: path, rest: linie, gefahren });
    };
    // Das Dauer-Schild gehoert zum zuletzt gemerkten Routenteil und wandert
    // mit der Mitte der noch zu fahrenden Linie.
    const schildAnLetztenTeil = (schild) => {
      const teil = routenTeileRef.current[routenTeileRef.current.length - 1];
      if (teil && schild) teil.schild = schild;
    };

    const drawApproachRoute = (path, durationMins, driverPosition, pickupPosition) => {
      if (!Array.isArray(path) || path.length < 2) return;
      extendPathBounds(path);
      const dashedLine = new window.trisarKarte.Polyline({
        path,
        geodesic: true,
        strokeColor: '#E3F654',
        strokeOpacity: 0,
        strokeWeight: 5,
        icons: [{ icon: createDashedLineSymbol(), offset: '0', repeat: '12px' }],
        map,
        zIndex: 301,
      });
      registerOverlay(dashedLine);
      routeTeilMerken(path, dashedLine);
      // Der Anfang der Anfahrt ist der gewaehlte Fahrer selbst: sein Punkt mit
      // Richtungskegel steht dort schon, ein zweites Zeichen braucht es nicht.
      if (durationMins > 0) {
        schildAnLetztenTeil(openDurationLabel(path[Math.floor(path.length / 2)] || driverPosition, formatDuration(durationMins, t), '#E3F654', '#111111'));
      }
      if (pickupPosition) {
        drawPickupMarker(pickupPosition);
      } else if (path[path.length - 1]) {
        drawPickupMarker(path[path.length - 1]);
      }
    };

    const drawTripRouteFallback = (path, durationMins) => {
      if (!Array.isArray(path) || path.length < 2) return;
      extendPathBounds(path);
      const polyline = new window.trisarKarte.Polyline({
        path,
        geodesic: true,
        strokeColor: '#0059FF',
        strokeOpacity: 1,
        strokeWeight: 6,
        map,
        zIndex: 300,
      });
      registerOverlay(polyline);
      routeTeilMerken(path, polyline);

      if (!pickupMarkerRendered) {
        drawPickupMarker(path[0]);
      }
      drawFinishMarker(path[path.length - 1]);

      if (durationMins > 0) {
        schildAnLetztenTeil(openDurationLabel(path[Math.floor(path.length / 2)] || path[0], formatDuration(durationMins, t), '#0059FF'));
      }
    };
    let cancelled = false;

    (async () => {
      let approachMinutes = null;
      let tripMinutes = null;
      let approachRendered = false;
      let tripRendered = false;

      // Faehrt der Fahrer schon in der Simulation, wird genau sein Weg gezeichnet:
      // bei aktiven der Weg vom Abholort ueber ihn zum Ziel, bei inaktiven die
      // Anfahrt zum Abholort. Der schon gefahrene Teil wird dann blass.
      const auswahlId = String(selectedDriver?.id || '');
      const simPfad = bewegungRef.current.pfad(auswahlId);
      if (simPfad && simPfad.length >= 2) {
        const restMinuten = bewegungRef.current.restMinuten(auswahlId) || 0;
        if (selectedDriver?.driverState === DRIVER_STATE_ACTIVE) {
          tripMinutes = restMinuten;
          drawTripRouteFallback(simPfad, restMinuten);
          tripRendered = true;
        } else {
          approachMinutes = restMinuten;
          drawApproachRoute(simPfad, restMinuten, simPfad[0], simPfad[simPfad.length - 1]);
          approachRendered = true;
        }
      }

      if (shouldRenderApproachRoute && !approachRendered && extApproachPath.length >= 2) {
        approachMinutes = extApproachMinutes > 0 ? extApproachMinutes : approachMinutes;
        drawApproachRoute(
          extApproachPath,
          Number.isFinite(approachMinutes) ? approachMinutes : 0,
          driverLiveOrigin || extApproachPath[0],
          extApproachPath[extApproachPath.length - 1],
        );
        approachRendered = true;
      }
      if (shouldRenderApproachRoute && !approachRendered && driverLiveOrigin && pickupLocation) {
        const approachResult = await requestRoute(driverLiveOrigin, pickupLocation, []);
        if (cancelled) return;
        if (approachResult.status === 'OK' && approachResult.path?.length >= 2) {
          const path = approachResult.path;
          approachMinutes = Math.ceil((approachResult.durationSeconds || 0) / 60);
          drawApproachRoute(path, approachMinutes, driverLiveOrigin, approachResult.endLocation || null);
          approachRendered = true;
        }
      }

      // Gast an Bord: blaue Linie ab dem Fahrer zum Ziel, nicht die gespeicherte Strecke ab Abholort.
      // Weicht er mehr als 200 m ab (abseits), kommt ein neuer routenStandort und es wird neu gerechnet.
      const unterwegsAbFahrer = isTripInProgressStatus(rideStatus) && Boolean(driverLiveOrigin) && Boolean(dropoffLocation);
      const tripOrigin = unterwegsAbFahrer
        ? (Number.isFinite(Number(routenStandort?.lat)) && Number.isFinite(Number(routenStandort?.lng))
          ? { lat: Number(routenStandort.lat), lng: Number(routenStandort.lng) }
          : driverLiveOrigin)
        : pickupLocation;

      if (!tripRendered && !unterwegsAbFahrer && extTripPath.length >= 2) {
        tripMinutes = extTripMinutes > 0 ? extTripMinutes : tripMinutes;
        drawTripRouteFallback(extTripPath, Number.isFinite(tripMinutes) ? tripMinutes : 0);
        tripRendered = true;
      }
      if (!tripRendered && tripOrigin && dropoffLocation) {
        const tripWaypoints = (ride?.via || [])
          .map((point) => toDirectionsLocation(point))
          .filter(Boolean)
          .map((location) => ({ location, stopover: false }));
        const tripResult = await requestRoute(tripOrigin, dropoffLocation, unterwegsAbFahrer ? [] : tripWaypoints);
        if (cancelled) return;
        if (tripResult.status === 'OK' && tripResult.path?.length >= 2) {
          const path = tripResult.path;
          extendPathBounds(path);
          const polyline = new window.trisarKarte.Polyline({
            path,
            geodesic: true,
            strokeColor: '#0059FF',
            strokeOpacity: 1,
            strokeWeight: 6,
            map,
            zIndex: 300,
          });
          registerOverlay(polyline);
          routeTeilMerken(path, polyline);

          tripMinutes = Math.ceil((tripResult.durationSeconds || 0) / 60);
          if (tripMinutes > 0) {
            schildAnLetztenTeil(openDurationLabel(path[Math.floor(path.length / 2)] || path[0], formatDuration(tripMinutes, t), '#0059FF'));
          }

          if (!routeIncludesDriverToPickup && !unterwegsAbFahrer && tripResult.startLocation) {
            drawPickupMarker(tripResult.startLocation);
          }

          if (tripResult.endLocation) {
            drawFinishMarker(tripResult.endLocation);
          }
          tripRendered = true;
        }
      }

      if (cancelled) return;

      onRouteMetricsChange({
        driverId: selectedDriver.id,
        approachMinutes: Number.isFinite(approachMinutes) ? approachMinutes : null,
        tripMinutes: Number.isFinite(tripMinutes) ? tripMinutes : null,
      });

      // Kolonne: die Standorte der Kollegen gehoeren mit ins Bild.
      (selectedDriver?.activeRide?.kolonnenFahrerIds || []).forEach((kollegeId) => {
        const kollege = (driversRef.current || []).find((entry) => String(entry?.id || '').trim() === kollegeId);
        const lat = Number(kollege?.lat);
        const lng = Number(kollege?.lng);
        if (Number.isFinite(lat) && Number.isFinite(lng)) combinedBounds.extend({ lat, lng });
      });
      if (!combinedBounds.isEmpty()) {
        routeBoundsRef.current = combinedBounds;
        if (!routeFitStateRef.current.fitted) {
          fitRouteBounds(combinedBounds);
          window.setTimeout(() => {
            if (!cancelled && routeBoundsRef.current === combinedBounds) {
              fitRouteBounds(combinedBounds);
            }
          }, 140);
          routeFitStateRef.current = { key: routeFitStateRef.current.key, fitted: true };
        }
      } else {
        fitAllDriverMarkers();
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    clearRouteOverlays,
    fitAllDriverMarkers,
    fitRouteBounds,
    mapReady,
    onRouteMetricsChange,
    selectedDriver?.id,
    selectedDriver?.activeRide?.id,
    selectedDriver?.activeRide?.status,
    selectedDriver?.activeRide?.from?.query,
    selectedDriver?.activeRide?.to?.query,
    selectedDriver?.activeRide?.from?.lat,
    selectedDriver?.activeRide?.from?.lng,
    selectedDriver?.activeRide?.to?.lat,
    selectedDriver?.activeRide?.to?.lng,
    selectedDriver?.activeRide?.extDriverToPickupPolyline,
    selectedDriver?.activeRide?.extRoutePolyline,
    routenStandort?.lat,
    routenStandort?.lng,
    geplantFuerAuswahl,
    t,
  ]);

  useEffect(() => {
    if (!mapReady || !hasActiveRide || !routeBoundsRef.current) return;
    fitRouteBounds(routeBoundsRef.current);
  }, [fitRouteBounds, hasActiveRide, mapReady, sheetPercent]);

  useEffect(() => {
    if (!mapReady) return;

    const handleResize = () => {
      if (hasActiveRide && routeBoundsRef.current) {
        fitRouteBounds(routeBoundsRef.current);
      }
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [fitAllDriverMarkers, fitRouteBounds, hasActiveRide, mapReady]);

  return <div ref={mapRef} data-tutorial="karte-ansicht" className="absolute inset-0" />;
}

function DriverProfilePopup({ driver, onClose }) {
  const { t } = useI18n();
  const phoneLink = `tel:${String(driver?.phone || '').replace(/[\s()-]/g, '')}`;
  const hasPhone = String(driver?.phone || '').trim().length > 0;
  const firstName = String(driver?.name || '').trim().split(/\s+/)[0] || t('karten.driverFallback');
  const avatarUrl = String(driver?.avatarUrl || driver?.image || driver?.avatar_url || '').trim();

  return (
    <div data-tutorial="karte-profil" className="absolute inset-0 z-50 bg-black/95 flex items-center justify-center px-[20px]" onClick={onClose}>
      <div className="w-full max-w-[362px]" onClick={(event) => event.stopPropagation()}>
        <button
          type="button"
          data-tutorial="karte-profil-zurueck"
          onClick={onClose}
          aria-label={t('karten.back')}
          className="w-[54px] h-[54px] mb-[18px] rounded-full border-2 border-[#E3F654] bg-black/85 flex items-center justify-center"
        >
          <img src="/icon/_Icon_Lime/Arrow_Trisar_Icons_01_Lime.svg" alt="" className="w-[29px] h-[18px] object-contain rotate-180" />
        </button>

        <div className="w-full border-2 border-[#E3F654] bg-black pt-[18px] pb-[18px]">
          <div className="mx-auto w-[138px] h-[138px] bg-[#1f2023] flex items-center justify-center overflow-hidden">
            {avatarUrl ? (
              <img
                src={avatarUrl}
                alt={t('karten.profileImageAlt', { name: driver?.name || t('karten.driverFallback') })}
                className="w-full h-full object-cover"
              />
            ) : (
              <img
                src="/icon/_Icon_Schwarz/Person_Trisar_Icons_01.svg"
                alt=""
                className="w-[82px] h-[82px] opacity-75"
              />
            )}
          </div>

          <div className="mt-[18px] text-center text-[#E3F654] text-[30px] leading-[1] font-bold font-['Space_Grotesk']">
            {driver?.name || t('karten.driverFallback')}
          </div>
          <div className="mt-[18px] text-center text-[#D6D6D6] text-[30px] leading-[1] font-bold font-['Space_Grotesk']">
            {driver?.plate || '-'}
          </div>
          <div className="text-center text-[#D6D6D6] text-[20px] leading-[1.1] font-normal font-['Space_Grotesk']">
            {driver?.vehicle || '-'}
          </div>
          {driver?.id ? <FahrzeugTelemetrie driverId={driver.id} /> : null}
        </div>

        <a
          href={hasPhone ? phoneLink : undefined}
          onClick={(event) => {
            event.stopPropagation();
            if (!hasPhone) event.preventDefault();
          }}
          className={`mt-[18px] h-[48px] w-full bg-[#E3F654] px-4 flex items-center justify-center relative text-[16px] leading-none font-medium font-['Space_Grotesk'] ${
            hasPhone ? 'text-[#1d1c1d]' : 'text-[#5f6130] pointer-events-none'
          }`}
        >
          <span>{t('karten.callDriver', { name: firstName })}</span>
          <img
            src="/icon/_Icon_Schwarz/contact-phone.svg"
            alt=""
            className="w-[22px] h-[22px] absolute right-[14px] top-1/2 -translate-y-1/2"
          />
        </a>
      </div>
    </div>
  );
}

function ActiveRideSheet({ driver, sheetPercent, setSheetPercent }) {
  const { t } = useI18n();
  const ride = driver?.rideInfo || {
    dienststart: '--:--',
    dienstende: '--:--',
    nextStart: '--:--',
    nextEnd: '--:--',
    from: { type: '-', label: t('karten.noActiveRide') },
    to: { type: '-', label: '-' },
  };
  const [isDragging, setIsDragging] = useState(false);
  const dragStartYRef = useRef(0);
  const dragStartHeightRef = useRef(sheetPercent);
  const dragMovedRef = useRef(false);
  const sheetTouchStartYRef = useRef(0);
  const sheetTouchStartedAtTopRef = useRef(false);
  const sheetRef = useRef(null);
  const scrollRef = useRef(null);
  const nameBlockRef = useRef(null);
  const [nameSnapPercent, setNameSnapPercent] = useState(null);
  const [showDriverPopup, setShowDriverPopup] = useState(false);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    setShowDriverPopup(false);
  }, [driver?.id]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const beginDrag = useCallback(
    (clientY) => {
      dragStartYRef.current = clientY;
      dragStartHeightRef.current = sheetPercent;
      dragMovedRef.current = false;
      setIsDragging(true);
    },
    [sheetPercent],
  );

  const updateSheetHeightFromClientY = useCallback(
    (clientY) => {
      if (!Number.isFinite(clientY)) return;
      const viewportHeight = window.innerHeight || 874;
      const deltaY = dragStartYRef.current - clientY;
      if (Math.abs(deltaY) > 3) dragMovedRef.current = true;
      const deltaPercent = (deltaY / viewportHeight) * 100;
      const maxPercent = getMaxSheetPercent();
      let next = dragStartHeightRef.current + deltaPercent;
      next = Math.max(getMinSheetPercent(), Math.min(maxPercent, next));
      setSheetPercent(next);
    },
    [setSheetPercent],
  );

  const handleSheetContentTouchStart = useCallback((event) => {
    if (!event.touches || event.touches.length === 0) return;
    sheetTouchStartYRef.current = event.touches[0].clientY;
    const scroller = scrollRef.current;
    sheetTouchStartedAtTopRef.current = !scroller || scroller.scrollTop <= 0;
  }, []);

  const handleSheetContentTouchMove = useCallback(
    (event) => {
      if (isDragging) return;
      if (!sheetTouchStartedAtTopRef.current) return;
      if (!event.touches || event.touches.length === 0) return;

      const scroller = scrollRef.current;
      if (scroller && scroller.scrollTop > 0) {
        sheetTouchStartedAtTopRef.current = false;
        return;
      }

      const currentY = event.touches[0].clientY;
      const pullDown = currentY - sheetTouchStartYRef.current;
      if (pullDown <= 8) return;

      beginDrag(sheetTouchStartYRef.current);
      updateSheetHeightFromClientY(currentY);
      if (event.cancelable) event.preventDefault();
    },
    [beginDrag, isDragging, updateSheetHeightFromClientY],
  );

  useEffect(() => {
    const updateNameSnap = () => {
      if (!scrollRef.current || !nameBlockRef.current) return;
      const viewportHeight = window.innerHeight || 874;
      const scrollOffset = scrollRef.current.offsetTop || 0;
      const nameOffset = nameBlockRef.current.offsetTop + nameBlockRef.current.offsetHeight;
      const snapPx = scrollOffset + nameOffset;
      const minPercent = getMinSheetPercent();
      const maxPercent = getMaxSheetPercent();
      const percent = (snapPx / viewportHeight) * 100;
      const clamped = Math.max(minPercent, Math.min(maxPercent, percent));
      setNameSnapPercent(clamped);
    };

    updateNameSnap();
    window.addEventListener('resize', updateNameSnap);
    return () => window.removeEventListener('resize', updateNameSnap);
  }, []);

  useEffect(() => {
    if (!isDragging) return undefined;

    const onMouseMove = (event) => {
      updateSheetHeightFromClientY(event.clientY);
    };

    const onTouchMove = (event) => {
      if (event.cancelable) event.preventDefault();
      updateSheetHeightFromClientY(event.touches[0].clientY);
    };

    const onEnd = () => {
      setIsDragging(false);
      sheetTouchStartedAtTopRef.current = false;
      if (!dragMovedRef.current) {
        dragMovedRef.current = false;
        return;
      }
      setSheetPercent((prev) => {
        const maxPercent = getMaxSheetPercent();
        const minPercent = getMinSheetPercent();
        if (typeof nameSnapPercent !== 'number') {
          if (prev > 70) return maxPercent;
          if (prev < 40) return minPercent;
          return Math.min(Math.max(50, minPercent), maxPercent);
        }

        if (prev >= nameSnapPercent) {
          return Math.min(prev, maxPercent);
        }

        const points = [minPercent, nameSnapPercent];
        let closest = points[0];
        let closestDist = Math.abs(prev - closest);
        points.forEach((point) => {
          const dist = Math.abs(prev - point);
          if (dist < closestDist) {
            closest = point;
            closestDist = dist;
          }
        });
        return closest;
      });
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onEnd);
    window.addEventListener('touchmove', onTouchMove, { passive: false });
    window.addEventListener('touchend', onEnd);
    window.addEventListener('touchcancel', onEnd);

    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onEnd);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onEnd);
      window.removeEventListener('touchcancel', onEnd);
    };
  }, [isDragging, nameSnapPercent, setSheetPercent, updateSheetHeightFromClientY]);

  return (
    <div
      ref={sheetRef}
      data-tutorial="karte-blatt"
      className={`absolute left-0 right-0 z-30 bg-[#17181b] rounded-t-[12px] shadow-[0_-10px_40px_rgba(0,0,0,0.5)] flex flex-col ${
        isDragging ? '' : 'transition-[height] duration-300 ease-out'
      }`}
      style={{ bottom: `${NAV_BLOCK_OFFSET_PX}px`, height: `${sheetPercent}%` }}
    >
      <button
        type="button"
        onClick={() => {
          if (dragMovedRef.current) {
            dragMovedRef.current = false;
            return;
          }
          const minPercent = getMinSheetPercent();
          const maxPercent = getMaxSheetPercent();
          if (sheetPercent <= minPercent + 1) {
            setSheetPercent(maxPercent);
            return;
          }
          if (sheetPercent >= maxPercent - 1) {
            setSheetPercent(minPercent);
          }
        }}
        onMouseDown={(event) => {
          event.preventDefault();
          beginDrag(event.clientY);
        }}
        onTouchStart={(event) => {
          beginDrag(event.touches[0].clientY);
        }}
        data-tutorial="karte-blatt-griff"
        className="w-full pt-[18px] pb-[18px] flex justify-center cursor-grab active:cursor-grabbing touch-none"
        aria-label={t('karten.dragPanel')}
      >
        <span className="w-[87px] h-[6px] bg-[#E3F654]" />
      </button>

      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto overscroll-none px-5 pb-[30px]"
        style={{ touchAction: 'pan-y', WebkitOverflowScrolling: 'touch' }}
        onTouchStart={handleSheetContentTouchStart}
        onTouchMove={handleSheetContentTouchMove}
        onTouchEnd={() => {
          sheetTouchStartedAtTopRef.current = false;
        }}
        onTouchCancel={() => {
          sheetTouchStartedAtTopRef.current = false;
        }}
      >
        <button
          type="button"
          className="w-full h-14 border-2 border-[#E3F654] flex items-center justify-center gap-[10px] text-[#E3F654] text-[32px] font-bold font-['Space_Grotesk'] tracking-[-0.5px]"
        >
          {t('karten.mark')}
          <img src="/icon/_Icon_Schwarz/Stern_Trisar_Icon_01_schwarz.svg" alt="" className="w-[17px] h-[18px]" />
        </button>

        <div data-tutorial="karte-blatt-kennzeichen" className="mt-3 w-full bg-white py-[10px] text-center">
          <div className="text-[#1d1c1d] text-[30px] leading-[1] font-bold tracking-[-0.8px] font-['Space_Grotesk']">{driver.plate}</div>
          <div className="mt-[4px] text-[#1d1c1d]/35 text-[16px] leading-[1] font-bold tracking-[-0.5px] font-['Space_Grotesk']">{driver.vehicle}</div>
        </div>

        <div ref={nameBlockRef} className="mt-3 w-full h-[96px] bg-[#E3F654] px-[18px] overflow-hidden flex flex-col justify-center gap-[5px]">
          <button
            type="button"
            onClick={() => setShowDriverPopup(true)}
            data-tutorial="karte-blatt-name"
            className="block w-full text-left text-[#1d1c1d] text-[30px] leading-[1] font-bold tracking-[-0.8px] font-['Space_Grotesk'] truncate"
            style={{ fontSize: '30px', fontWeight: 700, lineHeight: 1 }}
          >
            {driver.name}
          </button>
          <a
            href={`tel:${String(driver.phone || '').replace(/[\\s()-]/g, '')}`}
            className="block text-[#1d1c1d] text-[16px] leading-6 font-bold tracking-wide font-['Space_Grotesk']"
            style={{ fontSize: '16px', fontWeight: 700, lineHeight: '24px' }}
          >
            {driver.phone}
          </a>
        </div>

        <h3 className="mt-[36px] text-[#E3F654] text-[22px] leading-[0.95] font-bold tracking-[-1px] font-['Space_Grotesk']">{t('karten.nextRide')}</h3>

        <div className="mt-3 grid grid-cols-2 gap-6">
          <div>
            <div className="text-[#868687] text-[12px] leading-[1] font-bold tracking-[-0.3px] font-['Space_Grotesk']">{t('karten.etd')}</div>
            <div className="mt-[8px] text-[#E3F654] text-[42px] leading-[0.9] font-bold tracking-[-1px] font-['Space_Grotesk']">{ride.nextStart}</div>
          </div>
          <div className="text-right">
            <div className="text-[#868687] text-[12px] leading-[1] font-bold tracking-[-0.3px] font-['Space_Grotesk']">{t('karten.eta')}</div>
            <div className="mt-[8px] text-[#E3F654] text-[42px] leading-[0.9] font-bold tracking-[-1px] font-['Space_Grotesk']">{ride.nextEnd}</div>
            <div className="mt-[6px] text-[#f4f5f4] text-[12px] font-bold tracking-[-0.5px] opacity-50 font-['Space_Grotesk']">
              {ride.driveMins > 0 ? t('karten.driveMins', { mins: ride.driveMins }) : (ride.unterwegs && ride.nextEnd !== '--:--' ? t('karten.driveMins', { mins: '<1' }) : t('karten.driveUnknown'))}
            </div>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-[64px_1fr_64px] items-center gap-4">
          <div className="h-[64px] bg-[#242525] rounded-[16px] flex items-center justify-center">
            {ride.from.icon ? <img src={ride.from.icon} alt="" className="w-[30px] h-[30px] object-contain" /> : null}
          </div>
          <div className="flex justify-center">
            <img src="/icon/_Icon_Lime/Arrow_Trisar_Icons_01_Lime.svg" alt="" className="w-[59px] h-[38px] object-contain" />
          </div>
          <div className="h-[64px] bg-[#242525] rounded-[16px] flex items-center justify-center">
            {ride.to.icon ? <img src={ride.to.icon} alt="" className="w-[30px] h-[30px] object-contain" /> : null}
          </div>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-6">
          <div>
            <div className="text-[#868687] text-[12px] leading-[1.1] font-bold tracking-[-0.4px] font-['Space_Grotesk']">{ride.from.type}</div>
            <div className="mt-[4px] text-white text-[18px] leading-[1.05] font-bold tracking-[-0.5px] font-['Space_Grotesk']">{ride.from.label}</div>
          </div>
          <div className="text-right">
            <div className="text-[#868687] text-[12px] leading-[1.1] font-bold tracking-[-0.4px] font-['Space_Grotesk']">{ride.to.type}</div>
            <div className="mt-[4px] text-white text-[18px] leading-[1.05] font-bold tracking-[-0.5px] font-['Space_Grotesk']">{ride.to.label}</div>
          </div>
        </div>

        <div data-tutorial="karte-blatt-dienst" className="mt-6 mb-[30px] grid grid-cols-2 gap-6">
          <div>
            <div className="text-[#868687] text-[12px] leading-[1] font-bold tracking-[-0.3px] font-['Space_Grotesk']">{t('karten.serviceStart')}</div>
            <div className="mt-[8px] text-[#E3F654] text-[42px] leading-[0.9] font-bold tracking-[-1px] font-['Space_Grotesk']">{ride.dienststart}</div>
          </div>
          <div className="text-right">
            <div className="text-[#868687] text-[12px] leading-[1] font-bold tracking-[-0.3px] font-['Space_Grotesk']">{t('karten.serviceEnd')}</div>
            <div className="mt-[8px] text-[#E3F654] text-[42px] leading-[0.9] font-bold tracking-[-1px] font-['Space_Grotesk']">{ride.dienstende}</div>
          </div>
        </div>
      </div>

      {showDriverPopup ? (
        <DriverProfilePopup
          driver={driver}
          onClose={() => setShowDriverPopup(false)}
        />
      ) : null}
    </div>
  );
}

const formatLookaheadHoursLabel = (hoursValue, locale) => {
  const safeHours = Math.max(0, Math.min(8, Number(hoursValue) || 0));
  const rounded = Math.round(safeHours * 10) / 10;
  if (Number.isInteger(rounded)) return `${rounded}h`;
  return `${rounded.toLocaleString(locale || 'de-DE')}h`;
};

function DriverQuickFilterBar({ counts, selectedFilters, onToggle, onInactiveLongPress }) {
  const { t } = useI18n();
  const items = [
    { key: DRIVER_STATE_ACTIVE, label: t('karten.stateActive'), color: DRIVER_STATE_COLORS[DRIVER_STATE_ACTIVE] },
    { key: DRIVER_STATE_INACTIVE, label: t('karten.stateInactive'), color: DRIVER_STATE_COLORS[DRIVER_STATE_INACTIVE] },
    { key: DRIVER_STATE_FREE, label: t('karten.stateFree'), color: DRIVER_STATE_COLORS[DRIVER_STATE_FREE] },
  ];
  const longPressTimerRef = useRef(null);
  const longPressTriggeredRef = useRef(false);

  const clearLongPress = () => {
    if (longPressTimerRef.current) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  useEffect(() => () => clearLongPress(), []);

  return (
    <div data-tutorial="karte-status" className="absolute left-1/2 -translate-x-1/2 top-[142px] z-20 w-[362px] h-11 bg-black rounded-xl px-[16px] flex items-center justify-between">
      {items.map((item) => {
        const selected = selectedFilters.includes(item.key);
        return (
          <button
            key={item.key}
            type="button"
            onClick={() => {
              if (longPressTriggeredRef.current) {
                longPressTriggeredRef.current = false;
                return;
              }
              onToggle(item.key);
            }}
            onPointerDown={(event) => {
              if (item.key !== DRIVER_STATE_INACTIVE) return;
              if (event.pointerType === 'mouse' && event.button !== 0) return;
              longPressTriggeredRef.current = false;
              clearLongPress();
              longPressTimerRef.current = window.setTimeout(() => {
                longPressTriggeredRef.current = true;
                if (typeof onInactiveLongPress === 'function') onInactiveLongPress();
              }, 450);
            }}
            onPointerUp={clearLongPress}
            onPointerLeave={clearLongPress}
            onPointerCancel={clearLongPress}
            data-tutorial={`karte-status-${item.key}`}
            className={`flex items-center gap-[6px] ${selected ? 'opacity-100' : 'opacity-20'}`}
          >
            <span
              className="w-3 h-3 rounded-full border border-[#202020]"
              style={{ backgroundColor: item.color }}
            />
            <span className="text-white text-base leading-none font-['Space_Grotesk']">
              <span className="font-bold">{item.label} </span>
              <span className="font-normal">({counts[item.key] || 0})</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

export default function KartenView({ setView, filters = {} }) {
  const { t, locale } = useI18n();
  const [drivers, setDrivers] = useState(() => readDriverMapCache());
  const [driversError, setDriversError] = useState('');
  const [selectedDriverId, setSelectedDriverId] = useState(null);
  const [routeMetrics, setRouteMetrics] = useState(null);
  const [resetCameraSignal, setResetCameraSignal] = useState(0);
  const [quickFilters, setQuickFilters] = useState([...ALL_DRIVER_STATES]);
  const [sheetPercent, setSheetPercent] = useState(getMinSheetPercent());
  const [inactiveLookaheadHours, setInactiveLookaheadHours] = useState(1);
  const [showInactiveLookaheadSlider, setShowInactiveLookaheadSlider] = useState(false);
  const normalizedDriverSearchTerms = useMemo(
    () =>
      String(filters?.driverSearch || '')
        .split(';')
        .map((term) => String(term || '').trim().toLowerCase())
        .filter(Boolean),
    [filters?.driverSearch],
  );
  const selectedDriverIdsFilter = useMemo(
    () => new Set(
      (Array.isArray(filters?.selectedDriverIds) ? filters.selectedDriverIds : [])
        .map((id) => String(id || '').trim())
        .filter(Boolean),
    ),
    [filters?.selectedDriverIds],
  );

  const gradientStyle = useMemo(
    () => ({
      background:
        'radial-gradient(ellipse 141.42% 102.21% at 0% 0%, #0048cf 0%, #00369b 11.415%, #002468 22.83%, #001b4e 28.537%, #001234 34.244%, #00091a 39.952%, #00050d 42.805%, #000000 45.659%, #000000 83.626%, #000000 100%)',
    }),
    [],
  );

  useEffect(() => {
    let mounted = true;
    let refreshInFlight = false;

    const loadDriversFromDb = async () => {
      setDriversError('');
      try {
        // Auf neuen Geraeten ohne bestehende Session liefert RLS oft leere Live-Standorte.
        // Wenn kein Admin-Key verfuegbar ist, versuchen wir zuerst eine anonyme Session.
        if (!hasSupabaseAdminConfig) {
          await ensureCoordinatorReadSession();
        }

        const profileSelectBase = 'id, first_name, last_name, phone, role, is_dispo, vehicle_id, driver_number, vehicles:vehicle_id(license_plate, brand_model, trim)';
        const profileSelectWithAvatar = `${profileSelectBase}, avatar_url`;
        const profileSelectCandidates = [
          `${profileSelectWithAvatar}, driver_activity_state, service_start_time, service_end_time`,
          `${profileSelectWithAvatar}, driver_activity_state`,
          `${profileSelectWithAvatar}, service_start_time, service_end_time`,
          profileSelectWithAvatar,
          `${profileSelectBase}, driver_activity_state, service_start_time, service_end_time`,
          `${profileSelectBase}, driver_activity_state`,
          `${profileSelectBase}, service_start_time, service_end_time`,
          profileSelectBase,
        ];
        const queryProfiles = async (selectString) => {
          let result = await supabase.from('profiles').select(selectString);
          if (result.error && ADMIN_FALLBACK_ERROR_RE.test(result.error.message || '')) {
            result = await supabaseAdmin.from('profiles').select(selectString);
          }
          return result;
        };

        let profileResult = null;
        for (let index = 0; index < profileSelectCandidates.length; index += 1) {
          const selectString = profileSelectCandidates[index];
          profileResult = await queryProfiles(selectString);
          if (!profileResult.error) break;

          const errorText = getSupabaseErrorText(profileResult.error);
          const isMissingColumnError = MISSING_DRIVER_ACTIVITY_STATE_COLUMN_RE.test(errorText)
            || MISSING_DRIVER_SERVICE_COLUMN_RE.test(errorText)
            || MISSING_COLUMN_RE.test(errorText)
            || Number(profileResult.status) === 400;
          const hasMoreFallbacks = index < profileSelectCandidates.length - 1;
          if (!isMissingColumnError || !hasMoreFallbacks) break;
        }
        if (profileResult.error) throw profileResult.error;

        let liveResult = await supabase.from('driver_live_locations').select('driver_id, lat, lng, captured_at, active_job_id');
        if (liveResult.error && ADMIN_FALLBACK_ERROR_RE.test(liveResult.error.message || '')) {
          liveResult = await supabaseAdmin.from('driver_live_locations').select('driver_id, lat, lng, captured_at, active_job_id');
        }
        if (!liveResult.error && (liveResult.data || []).length === 0) {
          const maybeAdminLive = await supabaseAdmin.from('driver_live_locations').select('driver_id, lat, lng, captured_at, active_job_id');
          if (!maybeAdminLive.error && (maybeAdminLive.data || []).length > 0) {
            liveResult = maybeAdminLive;
          }
        }
        if (liveResult.error) throw liveResult.error;

        // Zuendung aus dem OBD-Tracker (vehicle_telemetry_live). Fehlt die Tabelle
        // oder das Recht, bleibt alles wie bisher.
        let zuendungRows = [];
        {
          let telemResult = await supabase.from('vehicle_telemetry_live').select('driver_id, ignition, captured_at');
          if ((telemResult.error || (telemResult.data || []).length === 0) && hasSupabaseAdminConfig) {
            const adminTelem = await supabaseAdmin.from('vehicle_telemetry_live').select('driver_id, ignition, captured_at');
            if (!adminTelem.error) telemResult = adminTelem;
          }
          if (!telemResult.error) zuendungRows = telemResult.data || [];
        }
        const zuendungByDriver = new Map(zuendungRows.map((row) => [String(row?.driver_id || '').trim(), row?.ignition]));
        zuendungByDriver.forEach((wert, fahrerId) => zuendungStand.set(fahrerId, wert));

        const now = new Date();
        const lookaheadMs = Math.max(0, Number(inactiveLookaheadHours) || 0) * 60 * 60 * 1000;

        const queryJobs = async (selectString) => {
          let result = await supabase
            .from('jobs')
            .select(selectString)
            .order('ride_date', { ascending: true })
            .order('etd', { ascending: true });
          if (result.error && ADMIN_FALLBACK_ERROR_RE.test(result.error.message || '')) {
            result = await supabaseAdmin
              .from('jobs')
              .select(selectString)
              .order('ride_date', { ascending: true })
              .order('etd', { ascending: true });
          }
          return result;
        };

        const selectCandidates = jobsSelectPreference === 'full'
          ? [
              { mode: 'full', value: JOBS_SELECT_FULL },
              { mode: 'no_route', value: JOBS_SELECT_NO_ROUTE },
              { mode: 'base', value: JOBS_SELECT_BASE },
            ]
          : jobsSelectPreference === 'no_route'
            ? [
                { mode: 'no_route', value: JOBS_SELECT_NO_ROUTE },
                { mode: 'base', value: JOBS_SELECT_BASE },
              ]
            : [
                { mode: 'base', value: JOBS_SELECT_BASE },
              ];

        let jobsResult = null;
        for (let index = 0; index < selectCandidates.length; index += 1) {
          const candidate = selectCandidates[index];
          jobsResult = await queryJobs(candidate.value);
          if (!jobsResult.error) {
            jobsSelectPreference = candidate.mode;
            writeJobsSelectPreference(candidate.mode);
            break;
          }
          const errorText = getSupabaseErrorText(jobsResult.error);
          const isMissingColumnError = MISSING_JOBS_ROUTE_COLUMN_RE.test(errorText)
            || MISSING_JOBS_EXT_COLUMN_RE.test(errorText)
            || MISSING_COLUMN_RE.test(errorText)
            || Number(jobsResult.status) === 400;
          const hasMoreFallbacks = index < selectCandidates.length - 1;
          if (!isMissingColumnError || !hasMoreFallbacks) break;
        }
        if (jobsResult.error) throw jobsResult.error;

        const jobRows = jobsResult.data || [];
        const jobIds = jobRows.map((row) => String(row?.id || '').trim()).filter(Boolean);
        const runInBatches = async ({ ids, queryChunk, tolerateError = null }) => {
          if (!ids.length) return { data: [], error: null };
          const merged = [];
          const batches = chunkArray(ids, IN_QUERY_BATCH_SIZE);
          for (const batch of batches) {
            const result = await queryChunk(batch);
            if (result.error) {
              if (typeof tolerateError === 'function' && tolerateError(result.error)) {
                return { data: [], error: null };
              }
              return result;
            }
            merged.push(...(result.data || []));
          }
          return { data: merged, error: null };
        };

        // Eigene Orte der Fahrten (Icon in der Fahrtinfo, Pin fuer die Route) und die
        // Koordinaten aus den TomTom-Payloads. Eigene Abfrage, damit die Spaltenauswahl
        // oben nicht zurueckfaellt, solange die Migration fehlt. Fehlen die Payloads,
        // nur die Orte.
        const ortSpalten = 'id, pickup_ort_id, dropoff_ort_id';
        const punktSpalten = `${ortSpalten}, ${JOBS_SELECT_PUNKTE}`;
        let ortZuordnungResult = await runInBatches({
          ids: jobIds,
          queryChunk: (batch) => supabase.from('jobs').select(punktSpalten).in('id', batch),
        });
        if (ortZuordnungResult.error) {
          ortZuordnungResult = await runInBatches({
            ids: jobIds,
            queryChunk: (batch) => supabase.from('jobs').select(ortSpalten).in('id', batch),
            tolerateError: () => true,
          });
        }
        const ortZuordnung = new Map((ortZuordnungResult.data || []).map((row) => [String(row?.id || ''), row]));
        jobRows.forEach((row) => {
          const zuordnung = ortZuordnung.get(String(row?.id || ''));
          if (!zuordnung) return;
          row.pickup_ort_id = zuordnung.pickup_ort_id || null;
          row.dropoff_ort_id = zuordnung.dropoff_ort_id || null;
          ['route_von', 'route_nach', 'anfahrt_nach', 'zielfahrt_nach'].forEach((feld) => {
            if (zuordnung[feld]) row[feld] = zuordnung[feld];
          });
        });

        const convoyAssignmentsResult = await runInBatches({
          ids: jobIds,
          queryChunk: async (batch) => {
            let result = await supabase
              .from('convoy_assignments')
              .select('job_id, driver_id, response_status')
              .in('job_id', batch);
            if (result.error && ADMIN_FALLBACK_ERROR_RE.test(result.error.message || '')) {
              result = await supabaseAdmin
                .from('convoy_assignments')
                .select('job_id, driver_id, response_status')
                .in('job_id', batch);
            }
            return result;
          },
          tolerateError: (error) => MISSING_CONVOY_ASSIGNMENTS_TABLE_RE.test(error?.message || ''),
        });
        if (convoyAssignmentsResult.error) throw convoyAssignmentsResult.error;

        if (!mounted) return;

        const profileRows = profileResult.data || [];
        const liveRows = liveResult.data || [];
        const convoyAssignments = convoyAssignmentsResult.data || [];
        const visibleProfiles = profileRows.filter((row) => {
          const role = String(row?.role || '').trim().toLowerCase();
          const isDispoRole = ['dispo', 'dispatcher', 'admin', 'koordinator', 'coordinator', 'pruefung'].includes(role);
          // Dispo-Recht (is_dispo) macht niemanden zum Nicht-Fahrer. Nur die Rolle entscheidet.
          if (isDispoRole) return false;
          return true;
        });
        const profileById = new Map(visibleProfiles.map((row) => [String(row.id || ''), row]));
        // Ausgeblendete Konten (Dispo, Pruefkonto) auch ohne Profil nicht als Punkt zeigen.
        const hiddenIds = new Set(profileRows.filter((row) => !visibleProfiles.includes(row)).map((row) => String(row.id || '')));
        const jobById = new Map(jobRows.map((job) => [String(job?.id || '').trim(), job]));
        const jobsByDriverId = new Map();
        const addJobForDriver = (driverId, job) => {
          const normalizedDriverId = String(driverId || '').trim();
          if (!normalizedDriverId || !job) return;
          if (!jobsByDriverId.has(normalizedDriverId)) jobsByDriverId.set(normalizedDriverId, []);
          jobsByDriverId.get(normalizedDriverId).push(job);
        };

        jobRows.forEach((job) => addJobForDriver(job?.driver_id, job));
        // Wer faehrt in welcher Kolonne mit? Gilt fuer Fahrten mit Kolonne oder
        // mehreren zugewiesenen Fahrern; abgelehnte Zuweisungen zaehlen nicht.
        const kolonnenFahrerByJob = new Map();
        convoyAssignments.forEach((row) => {
          if (normalizeJobStatus(row?.response_status || 'pending') === 'refused') return;
          const jobId = String(row?.job_id || '').trim();
          const fahrerId = String(row?.driver_id || '').trim();
          if (!jobId || !fahrerId) return;
          if (!kolonnenFahrerByJob.has(jobId)) kolonnenFahrerByJob.set(jobId, new Set());
          kolonnenFahrerByJob.get(jobId).add(fahrerId);
        });
        jobRows.forEach((job) => {
          const jobId = String(job?.id || '').trim();
          const fahrerId = String(job?.driver_id || '').trim();
          if (jobId && fahrerId && kolonnenFahrerByJob.has(jobId)) kolonnenFahrerByJob.get(jobId).add(fahrerId);
        });
        convoyAssignments.forEach((row) => {
          const responseStatus = normalizeJobStatus(row?.response_status || 'pending');
          if (responseStatus === 'refused') return;
          const job = jobById.get(String(row?.job_id || '').trim());
          if (!job) return;
          addJobForDriver(row?.driver_id, job);
        });

        const nowMs = now.getTime();

        const mapped = liveRows
          .map((row) => {
            const id = String(row?.driver_id || '').trim();
            const lat = Number(row?.lat);
            const lng = Number(row?.lng);
            if (!id || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
            if (hiddenIds.has(id)) return null;

            const profile = profileById.get(id);
            const name = [profile?.first_name, profile?.last_name].filter(Boolean).join(' ').trim() || t('karten.driverWithId', { id: id.slice(0, 8) });
            const avatarUrl = String(profile?.avatar_url || '').trim();
            const plate = String(profile?.vehicles?.license_plate || '').trim() || '-';
            const brandModel = String(profile?.vehicles?.brand_model || '').trim();
            const trim = String(profile?.vehicles?.trim || '').trim();
            const vehicle = [brandModel, trim].filter(Boolean).join(' ').trim() || t('karten.vehicleFallback');
            const driverJobs = jobsByDriverId.get(id) || [];
            const liveActiveJobId = String(row?.active_job_id || '').trim();
            const activeJobByStatus = driverJobs.find((job) => isActiveJobStatus(job?.status));
            const liveActiveJob = liveActiveJobId ? jobById.get(liveActiveJobId) : null;
            const hasActiveByLive = Boolean(liveActiveJob && isActiveJobStatus(liveActiveJob?.status));
            const activeJob = activeJobByStatus || (hasActiveByLive ? liveActiveJob : null);
            const hasActiveRide = Boolean(activeJob);
            const upcomingJobs = driverJobs
              .filter((job) => !isDoneOrCancelledStatus(job?.status) && !isActiveJobStatus(job?.status))
              .map((job) => ({ job, dateTime: toDateTimeFromRide(job?.ride_date, job?.etd) }))
              .filter((entry) => Boolean(entry.dateTime))
              .sort((a, b) => a.dateTime.getTime() - b.dateTime.getTime());
            const nextUpcomingEntry = upcomingJobs.find((entry) => entry.dateTime.getTime() >= nowMs) || upcomingJobs[0] || null;
            const nextUpcomingJob = nextUpcomingEntry?.job || null;
            const nextUpcomingMs = nextUpcomingEntry?.dateTime ? nextUpcomingEntry.dateTime.getTime() : null;
            const hasJobWithinLookahead = nextUpcomingMs != null && nextUpcomingMs >= nowMs && nextUpcomingMs <= (nowMs + lookaheadMs);
            const computedDriverState = hasActiveRide
              ? DRIVER_STATE_ACTIVE
              : hasJobWithinLookahead
                ? DRIVER_STATE_INACTIVE
                : DRIVER_STATE_FREE;
            const driverState = computedDriverState;
            const rideInfo = buildDriverRideInfo({
              activeJob,
              nextJob: nextUpcomingJob,
              allJobs: driverJobs,
              serviceStartTime: profile?.service_start_time,
              serviceEndTime: profile?.service_end_time,
              t,
            });
            const routeJob = activeJob || nextUpcomingJob || null;
            const kolonnenFahrer = kolonnenFahrerByJob.get(String(routeJob?.id || '').trim());
            const fahrtOhneKolonne = buildDriverActiveRide(routeJob, t);
            const activeRide = fahrtOhneKolonne && kolonnenFahrer && (kolonnenFahrer.size > 1 || routeJob?.convoy_id)
              ? { ...fahrtOhneKolonne, kolonnenFahrerIds: Array.from(kolonnenFahrer) }
              : fahrtOhneKolonne;

            return {
              id,
              name,
              avatarUrl,
              zuendungAus: zuendungByDriver.get(id) === false,
              driverNumber: profile?.driver_number ?? null,
              phone: String(profile?.phone || '').trim(),
              plate,
              vehicle,
              lat,
              lng,
              driverState,
              nextJobAt: nextUpcomingEntry?.dateTime ? nextUpcomingEntry.dateTime.toISOString() : null,
              rideInfo,
              activeRide,
            };
          })
          .filter(Boolean);

        if (mapped.length === 0 && visibleProfiles.length > 0) {
          setDriversError(t('karten.noLiveLocationsError'));
        }

        if (mapped.length > 0) {
          // Offene, noch nicht verplante Fahrten ab jetzt, die fruehesten zuerst.
          const offen = jobRows
            .filter((job) => !String(job?.driver_id || '').trim() && isOpenJobStatus(job?.status))
            .map((job) => ({ job, zeit: toDateTimeFromRide(job?.ride_date, job?.etd)?.getTime?.() ?? null }))
            .filter((eintrag) => eintrag.zeit != null)
            .sort((a, b) => a.zeit - b.zeit);
          const abJetzt = offen.filter((eintrag) => eintrag.zeit >= nowMs).map((eintrag) => eintrag.job);
          const displayDrivers = applyMapDemoStateOverride(mapped, {
            offeneFahrten: abJetzt.length ? abJetzt : offen.map((eintrag) => eintrag.job),
            t,
          });
          const counts = displayDrivers.reduce(
            (acc, entry) => {
              const state = String(entry?.driverState || '');
              if (state === DRIVER_STATE_ACTIVE) acc.aktiv += 1;
              else if (state === DRIVER_STATE_INACTIVE) acc.inaktiv += 1;
              else acc.frei += 1;
              return acc;
            },
            { aktiv: 0, inaktiv: 0, frei: 0 },
          );
          console.info('🧪 Karten Demo-Statusverteilung:', counts, 'total=', displayDrivers.length);
          setDrivers(displayDrivers);
          writeDriverMapCache(displayDrivers);
        }
        setSelectedDriverId((prev) => (mapped.some((entry) => entry.id === prev) ? prev : null));
      } catch (error) {
        if (!mounted) return;
        setDriversError(t('karten.loadDriversError', { message: error.message }));
      }
    };

    // Kommt waehrend eines Ladens eine Aenderung (z. B. die Fahrzeit kurz nach dem
    // Losfahren), wird danach noch einmal geladen, statt sie zu verwerfen.
    let refreshPending = false;
    const refreshDrivers = async () => {
      if (refreshInFlight) {
        refreshPending = true;
        return;
      }
      refreshInFlight = true;
      try {
        do {
          refreshPending = false;
          await loadDriversFromDb();
        } while (refreshPending && mounted);
      } finally {
        refreshInFlight = false;
      }
    };
    // Zurueck in den Tab (Handy, Safari): sofort frisch laden.
    const onVisible = () => {
      if (document.visibilityState === 'visible') refreshDrivers();
    };
    document.addEventListener('visibilitychange', onVisible);

    refreshDrivers();

    const refreshChannel = supabase
      .channel('ko-karten-live-refresh')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'driver_live_locations' }, () => {
        refreshDrivers();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'vehicle_telemetry_live' }, (payload) => {
        // Nur bei Wechsel der Zuendung neu laden, nicht bei jedem Datensatz.
        const fahrerId = String(payload?.new?.driver_id || '').trim();
        if (!fahrerId || zuendungStand.get(fahrerId) === payload?.new?.ignition) return;
        zuendungStand.set(fahrerId, payload?.new?.ignition);
        refreshDrivers();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'jobs' }, () => {
        refreshDrivers();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'convoy_assignments' }, () => {
        refreshDrivers();
      })
      .subscribe();

    const intervalId = window.setInterval(refreshDrivers, LIVE_DRIVERS_REFRESH_INTERVAL_MS);

    return () => {
      mounted = false;
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', onVisible);
      supabase.removeChannel(refreshChannel);
    };
  }, [inactiveLookaheadHours, t]);

  useEffect(() => {
    const htmlEl = document.documentElement;
    const bodyEl = document.body;
    const prevHtmlOverscroll = htmlEl.style.overscrollBehaviorY;
    const prevBodyOverscroll = bodyEl.style.overscrollBehaviorY;

    htmlEl.style.overscrollBehaviorY = 'none';
    bodyEl.style.overscrollBehaviorY = 'none';

    return () => {
      htmlEl.style.overscrollBehaviorY = prevHtmlOverscroll;
      bodyEl.style.overscrollBehaviorY = prevBodyOverscroll;
    };
  }, []);

  const driversMatchingSelection = useMemo(() => {
    if (selectedDriverIdsFilter.size === 0) return drivers;
    return drivers.filter((driver) => selectedDriverIdsFilter.has(String(driver?.id || '').trim()));
  }, [drivers, selectedDriverIdsFilter]);

  const driversMatchingSearch = useMemo(() => {
    if (normalizedDriverSearchTerms.length === 0) return driversMatchingSelection;
    return driversMatchingSelection.filter((driver) => {
      const rawNumber = driver?.driverNumber == null ? '' : String(driver.driverNumber).trim();
      const hashNumber = rawNumber ? `#${rawNumber}` : '';
      const haystack = [
        driver?.name,
        driver?.plate,
        driver?.phone,
        driver?.vehicle,
        rawNumber,
        hashNumber,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return normalizedDriverSearchTerms.some((term) => haystack.includes(term));
    });
  }, [driversMatchingSelection, normalizedDriverSearchTerms]);

  const driverCounts = useMemo(() => {
    const initial = {
      [DRIVER_STATE_ACTIVE]: 0,
      [DRIVER_STATE_INACTIVE]: 0,
      [DRIVER_STATE_FREE]: 0,
    };
    driversMatchingSearch.forEach((driver) => {
      const state = driver?.driverState;
      if (!Object.prototype.hasOwnProperty.call(initial, state)) return;
      initial[state] += 1;
    });
    return initial;
  }, [driversMatchingSearch]);

  const filteredDrivers = useMemo(
    () => driversMatchingSearch.filter((driver) => quickFilters.includes(driver?.driverState)),
    [driversMatchingSearch, quickFilters],
  );

  useEffect(() => {
    setSelectedDriverId((prev) => (filteredDrivers.some((entry) => entry.id === prev) ? prev : null));
  }, [filteredDrivers]);

  const selectedDriver = useMemo(
    () => filteredDrivers.find((driver) => driver.id === selectedDriverId) || null,
    [filteredDrivers, selectedDriverId],
  );

  const selectedDriverForSheet = useMemo(() => {
    if (!selectedDriver) return null;
    const metrics = routeMetrics && routeMetrics.driverId === selectedDriver.id ? routeMetrics : null;
    const tripMinutes = Number.isFinite(metrics?.tripMinutes) ? Number(metrics.tripMinutes) : null;
    const rideInfo = selectedDriver.rideInfo || {
      dienststart: '--:--',
      dienstende: '--:--',
      nextStart: '--:--',
      nextEnd: '--:--',
      from: { type: '-', label: '-' },
      to: { type: '-', label: '-' },
    };
    const etd = String(rideInfo.nextStart || '').trim();
    const computedEta = tripMinutes != null ? addMinutesToClock(etd, tripMinutes) : null;
    // Unterwegs, aber noch keine Fahrzeit aus der Datenbank: die auf der Karte
    // berechnete Restfahrzeit nehmen statt "jetzt" und "<1 min".
    if (rideInfo.unterwegs && !(Number(rideInfo.driveMins) > 0) && tripMinutes != null && tripMinutes > 0) {
      const jetzt = new Date();
      const ankunft = new Date(jetzt.getTime() + tripMinutes * 60_000);
      const uhr = `${String(ankunft.getHours()).padStart(2, '0')}:${String(ankunft.getMinutes()).padStart(2, '0')}`;
      return { ...selectedDriver, rideInfo: { ...rideInfo, nextEnd: uhr, driveMins: tripMinutes } };
    }
    return {
      ...selectedDriver,
      rideInfo: {
        ...rideInfo,
        nextEnd: (rideInfo.nextEnd && rideInfo.nextEnd !== '--:--') ? rideInfo.nextEnd : (computedEta || '--:--'),
      },
    };
  }, [routeMetrics, selectedDriver]);

  const selectedDriverRef = useRef(null);
  useEffect(() => {
    selectedDriverRef.current = selectedDriver;
  }, [selectedDriver]);

  useEffect(() => {
    const activeRideJobId = String(selectedDriver?.activeRide?.id || '').trim();
    if (!activeRideJobId) return undefined;

    let cancelled = false;
    const syncLiveRoute = async () => {
      if (cancelled) return;
      const latestDriver = selectedDriverRef.current;
      const currentLat = Number(latestDriver?.lat);
      const currentLng = Number(latestDriver?.lng);
      const currentLocation = Number.isFinite(currentLat) && Number.isFinite(currentLng)
        ? { lat: currentLat, lng: currentLng }
        : null;

      try {
        await supabase.functions.invoke(EDGE_FUNCTIONS.externalSync, {
          body: {
            reason: 'live_view',
            job_ids: [activeRideJobId],
            requested_by: null,
            current_location: currentLocation,
          },
        });
      } catch (error) {
        console.warn('KartenView live_view sync fehlgeschlagen:', error?.message || error);
      }
    };

    // Manual-only mode: keep one sync on explicit view/action entry.
    syncLiveRoute();
    // Auto refresh disabled to reduce Google API usage:
    // const intervalId = window.setInterval(syncLiveRoute, LIVE_ROUTE_SYNC_INTERVAL_MS);
    return () => {
      cancelled = true;
      // if (intervalId) window.clearInterval(intervalId);
    };
  }, [selectedDriver?.activeRide?.id]);

  const handleBack = () => {
    setView('list');
  };

  const { orte } = useOrte();
  const [gewaehlterOrtId, setGewaehlterOrtId] = useState(null);
  const handleOrtToggle = useCallback((ortId) => {
    setGewaehlterOrtId((prev) => (prev === ortId ? null : ortId));
  }, []);

  const handleSelectDriver = useCallback((driverId) => {
    // Zweiter Klick auf denselben Fahrer hebt den Fokus wieder auf.
    setSelectedDriverId((prev) => (prev === driverId ? null : driverId));
    setRouteMetrics(null);
    setSheetPercent(getMinSheetPercent());
  }, []);

  // Tipp auf die leere Karte: Auswahl aufheben und Blatt schliessen.
  const handleMapEmptyClick = useCallback(() => {
    setGewaehlterOrtId(null);
    setSelectedDriverId(null);
    setRouteMetrics(null);
    setSheetPercent(getMinSheetPercent());
  }, []);

  // Demo-Tutorial: Auswahl aufheben und Blatt schliessen, ohne die Karte zu
  // verlassen (statt ueber die Startseite neu hineinzuspringen).
  useEffect(() => {
    const anZustand = (event) => {
      if (event?.detail?.karteAbwaehlen !== true) return;
      setSelectedDriverId(null);
      setRouteMetrics(null);
      setSheetPercent(getMinSheetPercent());
    };
    window.addEventListener('trisar:tutorial-zustand', anZustand);
    return () => window.removeEventListener('trisar:tutorial-zustand', anZustand);
  }, []);

  // Demo-Tutorial: Fahrer gezielt waehlen, auch wenn sein Marker gerade in
  // einem Cluster steckt und deshalb nicht angetippt werden kann. Waehlt immer
  // aus (kein Umschalten wie beim zweiten Klick auf denselben Marker).
  useEffect(() => {
    window.__TRISAR_KARTE_FAHRER_WAEHLEN = (driverId) => {
      const id = String(driverId || '').trim();
      if (!id) return false;
      setSelectedDriverId(id);
      setRouteMetrics(null);
      setSheetPercent(getMinSheetPercent());
      return true;
    };
    return () => {
      delete window.__TRISAR_KARTE_FAHRER_WAEHLEN;
    };
  }, []);

  const handleMapNavPress = useCallback(() => {
    setSelectedDriverId(null);
    setRouteMetrics(null);
    setSheetPercent(getMinSheetPercent());
    setResetCameraSignal((prev) => prev + 1);
  }, []);

  const toggleQuickFilter = useCallback((stateKey) => {
    if (!ALL_DRIVER_STATES.includes(stateKey)) return;
    setQuickFilters((prev) => {
      const current = Array.isArray(prev) ? prev.filter((key) => ALL_DRIVER_STATES.includes(key)) : [];
      const currentSet = new Set(current);

      // Wenn aktuell "alle" aktiv sind und ein Zustand geklickt wird:
      // zeige nur den geklickten Zustand.
      if (currentSet.size === ALL_DRIVER_STATES.length) {
        return [stateKey];
      }

      if (currentSet.has(stateKey)) {
        currentSet.delete(stateKey);
      } else {
        currentSet.add(stateKey);
      }

      const next = ALL_DRIVER_STATES.filter((key) => currentSet.has(key));
      // Nie leer lassen: wenn alles abgewählt wurde, zurück auf "alle".
      if (next.length === 0) return [...ALL_DRIVER_STATES];
      return next;
    });
    setSheetPercent(getMinSheetPercent());
  }, []);

  return (
    <div className="w-[min(402px,100vw)] h-dvh relative mx-auto overflow-hidden overscroll-none" style={gradientStyle}>
      <GoogleMapSurface
        drivers={filteredDrivers}
        selectedDriver={selectedDriver}
        onDriverSelect={handleSelectDriver}
        onMapEmptyClick={handleMapEmptyClick}
        sheetPercent={selectedDriver ? sheetPercent : 0}
        onRouteMetricsChange={setRouteMetrics}
        resetCameraSignal={resetCameraSignal}
        orte={orte}
        gewaehlterOrtId={gewaehlterOrtId}
        onOrtToggle={handleOrtToggle}
      />

      {driversError ? (
        <div className="absolute left-5 right-5 top-[196px] z-20 bg-[#171717] border border-[#3a3a3a] p-3 whitespace-pre-line text-[#ff8e8e] text-[12px] leading-[1.35] font-medium font-['Space_Grotesk']">
          {driversError}
        </div>
      ) : null}

      <button
        type="button"
        onClick={handleBack}
        data-tutorial="karte-zurueck"
        aria-label={t('karten.back')}
        onTouchMove={(event) => event.preventDefault()}
        className="absolute top-[60px] left-[20px] z-20 w-[50px] h-[50px] touch-none select-none"
      >
        {/* Schwarzer Kreis als Unterlage, sonst schimmert am weichen
            Aussenrand die helle Karte durch. */}
        <span className="block w-[50px] h-[50px] rounded-full bg-black overflow-hidden">
          <img src="/icon/_Icon_Karte/Backbutton_Karte.svg?v=2" alt="" className="w-[50px] h-[50px] object-contain" />
        </span>
      </button>

      <button
        type="button"
        onClick={() => setView('kartenFilter')}
        data-tutorial="karte-filter-knopf"
        aria-label={t('karten.filter')}
        onTouchMove={(event) => event.preventDefault()}
        className="absolute top-[60px] right-[20px] z-20 w-[50px] h-[50px] flex items-center justify-center touch-none select-none"
      >
        <img src="/icon/_Icon_Schwarz/karten-layer-button.svg" alt="" className="w-[50px] h-[50px]" />
      </button>

      <DriverQuickFilterBar
        counts={driverCounts}
        selectedFilters={quickFilters}
        onToggle={toggleQuickFilter}
        onInactiveLongPress={() => setShowInactiveLookaheadSlider((prev) => !prev)}
      />

      {showInactiveLookaheadSlider ? (
        <div data-tutorial="karte-inaktiv-fenster" className="absolute left-1/2 -translate-x-1/2 top-[190px] z-20 w-[362px] bg-black/90 border border-[#2c2c2c] rounded-xl px-3 py-3">
          <button
            type="button"
            data-tutorial="karte-inaktiv-schliessen"
            onClick={() => setShowInactiveLookaheadSlider(false)}
            className="absolute right-2 top-2 w-7 h-7 flex items-center justify-center text-[#E3F654] text-[20px] leading-none font-bold"
            aria-label={t('karten.closeInactiveSlider')}
          >
            ×
          </button>
          <div className="flex items-center justify-between text-[13px] font-medium font-['Space_Grotesk'] text-[#E3F654]">
            <span>{t('karten.inactiveWindow')}</span>
            <span>{formatLookaheadHoursLabel(inactiveLookaheadHours, locale)}</span>
          </div>
          <input
            type="range"
            min="0"
            max="8"
            step="0.5"
            value={inactiveLookaheadHours}
            onChange={(event) => setInactiveLookaheadHours(Number(event.target.value))}
            className="mt-2 w-full accent-[#E3F654]"
            aria-label={t('karten.inactiveWindowHours')}
          />
          <div className="mt-1 flex items-center justify-between text-[11px] font-medium font-['Space_Grotesk'] text-[#8a8a8d]">
            <span>0h</span>
            <span>8h</span>
          </div>
        </div>
      ) : null}

      {/* Nur fuers Tutorial: der frei sichtbare Teil der Karte ueber dem Blatt —
          dort liegt die Route des gewaehlten Fahrers. */}
      <div
        aria-hidden="true"
        data-tutorial="karte-frei"
        className="absolute left-0 right-0 top-0 pointer-events-none"
        style={{ bottom: selectedDriverForSheet ? `calc(${NAV_BLOCK_OFFSET_PX}px + ${sheetPercent}%)` : `${NAV_BLOCK_OFFSET_PX}px` }}
      />

      {selectedDriverForSheet ? (
        <ActiveRideSheet
          driver={selectedDriverForSheet}
          sheetPercent={sheetPercent}
          setSheetPercent={setSheetPercent}
        />
      ) : null}

      <NaviFooterKomponente
        onNavigateHome={() => setView('list')}
        onNavigateToFahrten={() => setView('ankuenfte')}
        onNavigateToVehicles={() => setView('fahrzeugListe')}
        onNavigateToProfile={() => setView('alleFahrer')}
        onNavigateToMap={handleMapNavPress}
        onNavigateToAddFahrt={() => setView('fahrtAdd')}
        onNavigateToKi={() => setView('kiAssistent')}
        onNavigateToPlanung={() => setView('kiPlaner')}
        activeTab="map"
      />
    </div>
  );
}
