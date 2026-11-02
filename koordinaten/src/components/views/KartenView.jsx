import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import NaviFooterKomponente from '../navigation/NaviFooterKomponente';
import { hasSupabaseAdminConfig, supabase, supabaseAdmin } from '../../services/supabase';

const envOrDefault = (value, fallback) => {
  if (!value) return fallback;
  if (typeof value === 'string' && value.trim().toLowerCase().startsWith('your_')) return fallback;
  return value;
};

const GOOGLE_MAPS_API_KEY = envOrDefault(
  import.meta.env.VITE_GOOGLE_MAPS_API_KEY,
  '',
);

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
const JOBS_SELECT_FULL = 'id, driver_id, ride_date, etd, status, route, pickup_name, pickup_address, dropoff_name, dropoff_address, ext_route_duration_mins, ext_route_duration_in_traffic_mins, ext_route_polyline, ext_driver_to_pickup_duration_mins, ext_driver_to_pickup_duration_in_traffic_mins, ext_driver_to_pickup_polyline';
const JOBS_SELECT_NO_ROUTE = 'id, driver_id, ride_date, etd, status, pickup_name, pickup_address, dropoff_name, dropoff_address, ext_route_duration_mins, ext_route_duration_in_traffic_mins, ext_route_polyline, ext_driver_to_pickup_duration_mins, ext_driver_to_pickup_duration_in_traffic_mins, ext_driver_to_pickup_polyline';
const JOBS_SELECT_BASE = 'id, driver_id, ride_date, etd, status, pickup_name, pickup_address, dropoff_name, dropoff_address';
const JOBS_SELECT_PREFERENCE_KEY = 'koordinator_karten_jobs_select_preference';
const IN_QUERY_BATCH_SIZE = 30;
const EDGE_FUNCTIONS = {
  externalSync: 'external-sync',
};
const LIVE_DRIVERS_REFRESH_INTERVAL_MS = 15000;
const LIVE_ROUTE_SYNC_INTERVAL_MS = 12000;
const DRIVER_MAP_CACHE_KEY = 'koordinaten_karten_driver_cache_v1';
const MAP_CAMERA_CACHE_KEY = 'koordinaten_karten_camera_v1';
const ROUTE_REQUEST_CACHE_KEY = 'koordinaten_karten_route_cache_v1';
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
const DRIVER_STATE_COLORS = {
  [DRIVER_STATE_ACTIVE]: '#FF6F63',
  [DRIVER_STATE_INACTIVE]: '#E3F654',
  [DRIVER_STATE_FREE]: '#59BE80',
};
const DRIVER_MARKER_BASE_WIDTH = 35;
const DRIVER_MARKER_BASE_HEIGHT = 42;
const DRIVER_MARKER_UNSELECTED_SCALE = 0.9;
const DRIVER_MARKER_SELECTED_SCALE = 1.2;
const USER_LOCATION_DOT_URL = '/icon/_Icon_Schwarz/karten-user-location-dot.svg';

const normalizeJobStatus = (value) => String(value || '').trim().toLowerCase();
const OPEN_JOB_STATUSES = ['pending', 'assigned', 'offen', 'new', 'requested', 'offered', 'zugewiesen'];
const ACTIVE_JOB_STATUSES = ['at_pickup', 'pickup', 'beim_pickup', 'beim pickup', 'in_progress', 'started', 'unterwegs', 'active', 'ongoing', 'on_trip'];
const isOpenJobStatus = (value) => OPEN_JOB_STATUSES.includes(normalizeJobStatus(value));
const isActiveJobStatus = (value) => ACTIVE_JOB_STATUSES.includes(normalizeJobStatus(value));
const isDoneOrCancelledStatus = (value) => ['done', 'completed', 'arrived', 'cancelled', 'canceled', 'refused', 'stoniert'].includes(normalizeJobStatus(value));
const normalizeDriverActivityState = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return null;
  if (['aktiv', 'active', 'in_progress', 'unterwegs'].includes(normalized)) return DRIVER_STATE_ACTIVE;
  if (['inaktiv', 'inactive'].includes(normalized)) return DRIVER_STATE_INACTIVE;
  if (['frei', 'free', 'idle', 'available'].includes(normalized)) return DRIVER_STATE_FREE;
  return null;
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

const formatDuration = (mins) => {
  const value = Number(mins || 0);
  if (!Number.isFinite(value) || value <= 0) return '0 min';
  if (value < 60) return `${value} min`;
  const hours = Math.floor(value / 60);
  const minutes = value % 60;
  return `${hours}:${String(minutes).padStart(2, '0')} h`;
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

const buildDriverRideInfo = ({
  activeJob = null,
  nextJob = null,
  allJobs = [],
  serviceStartTime = null,
  serviceEndTime = null,
}) => {
  const rideJob = activeJob || nextJob || null;
  const nextTime = rideJob ? formatClockLabel(rideJob?.etd || nextJob?.etd, '--:--') : '--:--';
  const routeDurationMins = toPositiveMinutes(
    rideJob?.ext_route_duration_in_traffic_mins,
    rideJob?.ext_route_duration_mins,
  );
  const computedEta = routeDurationMins > 0 ? addMinutesToClock(nextTime, routeDurationMins) : null;
  const pickupValues = getPickupValuesFromJob(rideJob);
  const dropoffValues = getDropoffValuesFromJob(rideJob);
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
    nextStart: nextTime,
    nextEnd: computedEta || '--:--',
    from: rideJob
      ? {
          type: 'Abholung',
          label: extractLocationLabel(pickupValues.name, pickupValues.address),
        }
      : { type: '-', label: 'Keine aktive Fahrt' },
    to: rideJob
      ? {
          type: 'Ziel',
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

const buildDriverActiveRide = (job) => {
  if (!job) return null;
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
      type: 'Abholung',
      label: extractLocationLabel(pickupValues.name, pickupValues.address),
      query: fromQuery,
    },
    to: {
      type: 'Ziel',
      label: extractLocationLabel(dropoffValues.name, dropoffValues.address),
      query: toQuery,
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

const DRIVER_PIN_URLS = {
  [DRIVER_STATE_ACTIVE]: '/icon/_Icon_Karte/karten-driver-pin-active.svg',
  [DRIVER_STATE_INACTIVE]: '/icon/_Icon_Karte/karten-driver-pin-inactive.svg',
  [DRIVER_STATE_FREE]: '/icon/_Icon_Karte/karten-driver-pin-free.svg',
};

const createDriverMarkerIcon = (googleMaps, driverState, isSelected) => {
  const url = DRIVER_PIN_URLS[driverState] || DRIVER_PIN_URLS[DRIVER_STATE_FREE];
  const scale = isSelected ? DRIVER_MARKER_SELECTED_SCALE : DRIVER_MARKER_UNSELECTED_SCALE;
  const width = Math.round(DRIVER_MARKER_BASE_WIDTH * scale);
  const height = Math.round(DRIVER_MARKER_BASE_HEIGHT * scale);
  return {
    url,
    scaledSize: new googleMaps.Size(width, height),
    size: new googleMaps.Size(width, height),
    anchor: new googleMaps.Point(width / 2, height - 1),
    labelOrigin: new googleMaps.Point(width / 2, Math.round((17.5 / DRIVER_MARKER_BASE_HEIGHT) * height)),
  };
};

const createDriverMarkerLabel = (driverNumber, isSelected) => ({
  text: driverNumber != null && String(driverNumber).trim() ? String(driverNumber) : '?',
  color: '#1D1C1D',
  fontSize: isSelected ? '19px' : '13px',
  fontWeight: '700',
});

const createDriverClusterIcon = (googleMaps, clusterSize) => ({
  path: googleMaps.SymbolPath.CIRCLE,
  scale: Math.max(16, Math.min(22, 15 + Math.min(Number(clusterSize) || 0, 20) * 0.28)),
  fillColor: '#17181b',
  fillOpacity: 1,
  strokeColor: '#232425',
  strokeOpacity: 1,
  strokeWeight: 3,
});

const createDriverClusterLabel = (clusterSize) => ({
  text: `${clusterSize}+`,
  color: '#FFFFFF',
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

const createPickupMarkerIcon = (googleMaps) => ({
  url: '/icon/_Icon_Karte/Pin_Flagge_Trisar_01_rot.svg',
  scaledSize: new googleMaps.Size(30, 38),
  anchor: new googleMaps.Point(15, 37),
});

const createFinishFlagIcon = (googleMaps) => ({
  url: '/icon/_Icon_Karte/Ziel_Flagge_Trisar_01_sw.svg',
  scaledSize: new googleMaps.Size(26, 38),
  anchor: new googleMaps.Point(5, 36),
});

const createDashedLineSymbol = () => ({
  path: 'M 0,-1 0,1',
  strokeOpacity: 1,
  scale: 4,
  strokeColor: '#facc15',
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
      return false;
    } catch {
      return false;
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

function GoogleMapSurface({ drivers, selectedDriver, onDriverSelect, sheetPercent, onRouteMetricsChange = () => {}, resetCameraSignal = 0 }) {
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

  useEffect(() => {
    onDriverSelectRef.current = onDriverSelect;
  }, [onDriverSelect]);

  const hasActiveRide = Boolean(selectedDriver?.activeRide);

  const fitAllDriverMarkers = useCallback(() => {
    const map = mapInstanceRef.current;
    if (!map || !window.google?.maps) return;

    const bounds = new window.google.maps.LatLngBounds();
    markersByDriverRef.current.forEach((marker) => {
      const pos = marker?.getPosition?.();
      if (pos) bounds.extend(pos);
    });

    if (!bounds.isEmpty()) {
      map.fitBounds(bounds, { top: 88, right: 24, bottom: NAV_AND_FOOTER_COVER_PX, left: 24 });
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
      map.fitBounds(bounds, { top: 88, right: 24, bottom: paddingBottom, left: 24 });
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
  }, []);

  const clearClusterMarkers = useCallback(() => {
    clusterMarkersRef.current.forEach((marker) => marker.setMap(null));
    clusterMarkersRef.current = [];
  }, []);

  const updateDriverClusters = useCallback(() => {
    const map = mapInstanceRef.current;
    if (!map || !window.google?.maps) return;

    const zoom = map.getZoom();
    const projection = map.getProjection?.();
    if (!projection || typeof zoom !== 'number') return;

    const pixelFactor = 2 ** zoom;
    const entries = drivers
      .map((driver) => {
        const marker = markersByDriverRef.current.get(driver.id);
        const position = marker?.getPosition?.();
        if (!marker || !position) return null;
        const worldPoint = projection.fromLatLngToPoint(position);
        return {
          marker,
          position,
          x: worldPoint.x * pixelFactor,
          y: worldPoint.y * pixelFactor,
        };
      })
      .filter(Boolean);

    clearClusterMarkers();
    entries.forEach((entry) => entry.marker.setMap(map));

    const clustered = new Set();
    // Cluster only when driver dots would visually overlap.
    // Unselected driver marker: scale=8 (radius) + stroke.
    const clusterRadiusPx = 18;

    for (let i = 0; i < entries.length; i += 1) {
      if (clustered.has(i)) continue;
      const base = entries[i];
      const group = [base];
      clustered.add(i);

      for (let j = i + 1; j < entries.length; j += 1) {
        if (clustered.has(j)) continue;
        const candidate = entries[j];
        const dx = base.x - candidate.x;
        const dy = base.y - candidate.y;
        if (Math.hypot(dx, dy) <= clusterRadiusPx) {
          group.push(candidate);
          clustered.add(j);
        }
      }

      if (group.length <= 1) continue;

      group.forEach((entry) => entry.marker.setMap(null));
      const centerLat = group.reduce((sum, entry) => sum + entry.position.lat(), 0) / group.length;
      const centerLng = group.reduce((sum, entry) => sum + entry.position.lng(), 0) / group.length;
      const clusterBounds = new window.google.maps.LatLngBounds();
      group.forEach((entry) => clusterBounds.extend(entry.position));

      const clusterMarker = new window.google.maps.Marker({
        position: { lat: centerLat, lng: centerLng },
        map,
        icon: createDriverClusterIcon(window.google.maps, group.length),
        label: createDriverClusterLabel(group.length),
        clickable: true,
        zIndex: 1450,
      });
      clusterMarker.addListener('click', () => {
        if (clusterBounds.isEmpty()) return;
        const currentZoom = map.getZoom() || 12;
        map.fitBounds(clusterBounds, { top: 88, right: 24, bottom: NAV_AND_FOOTER_COVER_PX, left: 24 });
        window.setTimeout(() => {
          const nextZoom = map.getZoom() || currentZoom;
          if (nextZoom <= currentZoom) {
            map.setZoom(Math.min(20, currentZoom + 2));
          }
        }, 140);
      });

      clusterMarkersRef.current.push(clusterMarker);
    }
  }, [clearClusterMarkers, drivers]);

  useEffect(() => {
    let cancelled = false;
    let scriptEl = null;
    let intervalId = null;

    const initMap = () => {
      if (cancelled || !window.google?.maps || !mapRef.current || mapInstanceRef.current) return;
      const cachedCamera = readMapCameraCache();

      const map = new window.google.maps.Map(mapRef.current, {
        center: cachedCamera
          ? { lat: Number(cachedCamera.lat), lng: Number(cachedCamera.lng) }
          : { lat: 48.137154, lng: 11.576124 },
        zoom: cachedCamera ? Number(cachedCamera.zoom) : 12,
        disableDefaultUI: true,
        clickableIcons: false,
        gestureHandling: 'greedy',
      });

      mapInstanceRef.current = map;
      directionsServiceRef.current = new window.google.maps.DirectionsService();
      setMapReady(true);
    };

    const tryInit = () => {
      if (window.google?.maps) initMap();
    };

    const handleScriptLoad = () => {
      tryInit();
      if (intervalId) window.clearInterval(intervalId);
    };

    if (window.google?.maps) {
      initMap();
    } else {
      scriptEl = document.getElementById('google-maps-script')
        || document.querySelector('script[src*="maps.googleapis.com/maps/api/js"]');

      if (!scriptEl) {
        scriptEl = document.createElement('script');
        scriptEl.id = 'google-maps-script';
        scriptEl.src = `https://maps.googleapis.com/maps/api/js?key=${GOOGLE_MAPS_API_KEY}&libraries=places`;
        scriptEl.async = true;
        scriptEl.defer = true;
        document.head.appendChild(scriptEl);
      }

      scriptEl.addEventListener('load', handleScriptLoad);
      intervalId = window.setInterval(tryInit, 250);
    }

    return () => {
      cancelled = true;
      if (intervalId) window.clearInterval(intervalId);
      if (scriptEl) scriptEl.removeEventListener('load', handleScriptLoad);
      writeMapCameraCache(mapInstanceRef.current);
      clearRouteOverlays();
      clearClusterMarkers();
      markersByDriverRef.current.forEach((marker) => marker.setMap(null));
      markersByDriverRef.current.clear();
      mapInstanceRef.current = null;
      directionsServiceRef.current = null;
      setMapReady(false);
    };
  }, [clearClusterMarkers, clearRouteOverlays]);

  useEffect(() => {
    if (!mapReady || !window.google?.maps) return;
    const map = mapInstanceRef.current;
    if (!map) return;

    const driversById = new Map(drivers.map((entry) => [String(entry?.id || '').trim(), entry]));
    markersByDriverRef.current.forEach((marker, id) => {
      if (driversById.has(id)) return;
      marker.setMap(null);
      markersByDriverRef.current.delete(id);
    });

    drivers.forEach((driver) => {
      const id = String(driver?.id || '').trim();
      if (!id) return;
      const isSelected = selectedDriver?.id === id;
      let marker = markersByDriverRef.current.get(id);

      if (!marker) {
        marker = new window.google.maps.Marker({
          position: { lat: Number(driver.lat), lng: Number(driver.lng) },
          map,
          title: driver.name,
          icon: createDriverMarkerIcon(window.google.maps, driver.driverState, isSelected),
          label: createDriverMarkerLabel(driver.driverNumber, isSelected),
          zIndex: isSelected ? 1300 : 1000,
        });
        marker.addListener('click', () => {
          onDriverSelectRef.current?.(id);
        });
        markersByDriverRef.current.set(id, marker);
      } else {
        marker.setPosition({ lat: Number(driver.lat), lng: Number(driver.lng) });
        marker.setTitle(driver.name);
        marker.setIcon(createDriverMarkerIcon(window.google.maps, driver.driverState, isSelected));
        marker.setLabel(createDriverMarkerLabel(driver.driverNumber, isSelected));
        marker.setZIndex(isSelected ? 1300 : 1000);
      }
    });

    updateDriverClusters();
  }, [drivers, mapReady, selectedDriver?.id, updateDriverClusters]);

  useEffect(() => {
    if (!mapReady) return;
    const map = mapInstanceRef.current;
    if (!map) return undefined;

    const refreshClusters = () => {
      updateDriverClusters();
      writeMapCameraCache(map);
    };

    const zoomListener = map.addListener('zoom_changed', refreshClusters);
    const idleListener = map.addListener('idle', refreshClusters);
    refreshClusters();

    return () => {
      zoomListener?.remove?.();
      idleListener?.remove?.();
    };
  }, [mapReady, updateDriverClusters]);

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

  useEffect(() => {
    if (!mapReady || !window.google?.maps) return;

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
      String(ride?.extDriverToPickupPolyline || ''),
      String(ride?.extRoutePolyline || ''),
    ].join('|');
    if (routeFitStateRef.current.key !== routeFitKey) {
      routeFitStateRef.current = { key: routeFitKey, fitted: false };
    }
    const rideStatus = normalizeJobStatus(ride?.status);
    const shouldRenderApproachRoute = isOpenJobStatus(rideStatus);
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
    const driverLiveOrigin = hasLatLng(selectedDriver)
      ? { lat: Number(selectedDriver.lat), lng: Number(selectedDriver.lng) }
      : null;
    const shouldStartTripFromDriver = isActiveJobStatus(rideStatus) && Boolean(driverLiveOrigin && dropoffLocation);
    const tripOriginLocation = shouldStartTripFromDriver ? driverLiveOrigin : pickupLocation;
    const extApproachPath = decodeGooglePolyline(String(ride?.extDriverToPickupPolyline || '').trim());
    const extTripPath = decodeGooglePolyline(String(ride?.extRoutePolyline || '').trim());
    const extApproachMinutes = toPositiveMinutes(ride?.extDriverToPickupDurationInTrafficMins, ride?.extDriverToPickupDurationMins);
    const extTripMinutes = toPositiveMinutes(ride?.extRouteDurationInTrafficMins, ride?.extRouteDurationMins);
    const hasExtFallbackRoute = extApproachPath.length >= 2 || extTripPath.length >= 2;
    if (!tripOriginLocation && !dropoffLocation && !hasExtFallbackRoute) {
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
      const latLng = position instanceof window.google.maps.LatLng
        ? position
        : new window.google.maps.LatLng(Number(position?.lat), Number(position?.lng));
      if (!Number.isFinite(latLng.lat()) || !Number.isFinite(latLng.lng())) return;

      const labelOverlay = new window.google.maps.OverlayView();
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
      labelOverlay.draw = function draw() {
        const projection = this.getProjection();
        const div = this._div;
        if (!projection || !div) return;
        const pixel = projection.fromLatLngToDivPixel(latLng);
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
            travelMode: window.google.maps.TravelMode.DRIVING,
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
    const combinedBounds = new window.google.maps.LatLngBounds();
    const extendPathBounds = (path = []) => {
      path.forEach((point) => combinedBounds.extend(point));
    };
    let pickupMarkerRendered = false;

    const drawDriverLocationMarker = (position) => {
      if (!position) return;
      const driverMarker = new window.google.maps.Marker({
        position,
        map,
        icon: {
          url: USER_LOCATION_DOT_URL,
          scaledSize: new window.google.maps.Size(30, 30),
          anchor: new window.google.maps.Point(15, 15),
        },
        zIndex: 310,
      });
      registerOverlay(driverMarker);
    };

    const drawPickupMarker = (position) => {
      if (!position) return;
      const pickupMarker = new window.google.maps.Marker({
        position,
        map,
        icon: createPickupMarkerIcon(window.google.maps),
        zIndex: 320,
      });
      registerOverlay(pickupMarker);
      pickupMarkerRendered = true;
    };

    const drawFinishMarker = (position) => {
      if (!position) return;
      const finishMarker = new window.google.maps.Marker({
        position,
        map,
        icon: createFinishFlagIcon(window.google.maps),
        zIndex: 320,
      });
      registerOverlay(finishMarker);
    };

    const drawApproachRoute = (path, durationMins, driverPosition, pickupPosition) => {
      if (!Array.isArray(path) || path.length < 2) return;
      extendPathBounds(path);
      const dashedLine = new window.google.maps.Polyline({
        path,
        geodesic: true,
        strokeColor: '#facc15',
        strokeOpacity: 0,
        strokeWeight: 5,
        icons: [{ icon: createDashedLineSymbol(), offset: '0', repeat: '12px' }],
        map,
        zIndex: 301,
      });
      registerOverlay(dashedLine);
      drawDriverLocationMarker(driverPosition || path[0] || null);
      if (durationMins > 0) {
        openDurationLabel(path[Math.floor(path.length / 2)] || driverPosition, formatDuration(durationMins), '#facc15', '#111111');
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
      const polyline = new window.google.maps.Polyline({
        path,
        geodesic: true,
        strokeColor: '#3b82f6',
        strokeOpacity: 1,
        strokeWeight: 6,
        map,
        zIndex: 300,
      });
      registerOverlay(polyline);

      if (!pickupMarkerRendered) {
        drawPickupMarker(path[0]);
      }
      drawFinishMarker(path[path.length - 1]);

      if (durationMins > 0) {
        openDurationLabel(path[Math.floor(path.length / 2)] || path[0], formatDuration(durationMins), '#3b82f6');
      }
    };
    let cancelled = false;

    (async () => {
      let approachMinutes = null;
      let tripMinutes = null;
      let approachRendered = false;
      let tripRendered = false;

      if (shouldRenderApproachRoute && extApproachPath.length >= 2) {
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

      if (!shouldStartTripFromDriver && extTripPath.length >= 2) {
        tripMinutes = extTripMinutes > 0 ? extTripMinutes : tripMinutes;
        drawTripRouteFallback(extTripPath, Number.isFinite(tripMinutes) ? tripMinutes : 0);
        tripRendered = true;
      }
      if (!tripRendered && tripOriginLocation && dropoffLocation) {
        const tripWaypoints = (ride?.via || [])
          .map((point) => toDirectionsLocation(point))
          .filter(Boolean)
          .map((location) => ({ location, stopover: false }));
        const tripResult = await requestRoute(tripOriginLocation, dropoffLocation, tripWaypoints);
        if (cancelled) return;
        if (tripResult.status === 'OK' && tripResult.path?.length >= 2) {
          const path = tripResult.path;
          extendPathBounds(path);
          const polyline = new window.google.maps.Polyline({
            path,
            geodesic: true,
            strokeColor: '#3b82f6',
            strokeOpacity: 1,
            strokeWeight: 6,
            map,
            zIndex: 300,
          });
          registerOverlay(polyline);

          tripMinutes = Math.ceil((tripResult.durationSeconds || 0) / 60);
          if (tripMinutes > 0) {
            openDurationLabel(path[Math.floor(path.length / 2)] || path[0], formatDuration(tripMinutes), '#3b82f6');
          }

          if (shouldStartTripFromDriver) {
            drawDriverLocationMarker(tripResult.startLocation || driverLiveOrigin);
          } else if (!routeIncludesDriverToPickup && tripResult.startLocation) {
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
    selectedDriver?.activeRide?.extDriverToPickupPolyline,
    selectedDriver?.activeRide?.extRoutePolyline,
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

  return <div ref={mapRef} className="absolute inset-0" />;
}

function DriverProfilePopup({ driver, onClose }) {
  const phoneLink = `tel:${String(driver?.phone || '').replace(/[\s()-]/g, '')}`;
  const hasPhone = String(driver?.phone || '').trim().length > 0;
  const firstName = String(driver?.name || '').trim().split(/\s+/)[0] || 'Fahrer';
  const avatarUrl = String(driver?.avatarUrl || driver?.image || driver?.avatar_url || '').trim();

  return (
    <div className="absolute inset-0 z-50 bg-black/95 flex items-center justify-center px-[20px]" onClick={onClose}>
      <div className="w-full max-w-[362px]" onClick={(event) => event.stopPropagation()}>
        <button
          type="button"
          onClick={onClose}
          aria-label="Zurück"
          className="w-[54px] h-[54px] mb-[18px] rounded-full border-2 border-[#E3F654] bg-black/85 flex items-center justify-center"
        >
          <img src="/icon/_Icon_Lime/Arrow_Trisar_Icons_01_Lime.svg" alt="" className="w-[29px] h-[18px] object-contain rotate-180" />
        </button>

        <div className="w-full border-2 border-[#E3F654] bg-black pt-[18px] pb-[18px]">
          <div className="mx-auto w-[138px] h-[138px] bg-[#1f2023] flex items-center justify-center overflow-hidden">
            {avatarUrl ? (
              <img
                src={avatarUrl}
                alt={`Profilbild von ${driver?.name || 'Fahrer'}`}
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
            {driver?.name || 'Fahrer'}
          </div>
          <div className="mt-[18px] text-center text-[#D6D6D6] text-[30px] leading-[1] font-bold font-['Space_Grotesk']">
            {driver?.plate || '-'}
          </div>
          <div className="text-center text-[#D6D6D6] text-[20px] leading-[1.1] font-normal font-['Space_Grotesk']">
            {driver?.vehicle || '-'}
          </div>
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
          <span>{`${firstName} anrufen`}</span>
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
  const ride = driver?.rideInfo || {
    dienststart: '--:--',
    dienstende: '--:--',
    nextStart: '--:--',
    nextEnd: '--:--',
    from: { type: '-', label: 'Keine aktive Fahrt' },
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
        className="w-full pt-[18px] pb-[18px] flex justify-center cursor-grab active:cursor-grabbing touch-none"
        aria-label="Panel ziehen"
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
          Markieren
          <img src="/icon/_Icon_Schwarz/Stern_Trisar_Icon_01_schwarz.svg" alt="" className="w-[17px] h-[18px]" />
        </button>

        <div className="mt-3 w-full bg-white py-[10px] text-center">
          <div className="text-[#1d1c1d] text-[30px] leading-[1] font-bold tracking-[-0.8px] font-['Space_Grotesk']">{driver.plate}</div>
          <div className="mt-[4px] text-[#1d1c1d]/35 text-[16px] leading-[1] font-bold tracking-[-0.5px] font-['Space_Grotesk']">{driver.vehicle}</div>
        </div>

        <div ref={nameBlockRef} className="mt-3 w-full h-[96px] bg-[#E3F654] px-[18px] overflow-hidden flex flex-col justify-center gap-[5px]">
          <button
            type="button"
            onClick={() => setShowDriverPopup(true)}
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

        <h3 className="mt-[36px] text-[#E3F654] text-[22px] leading-[0.95] font-bold tracking-[-1px] font-['Space_Grotesk']">Nächste Fahrt</h3>

        <div className="mt-3 grid grid-cols-2 gap-6">
          <div>
            <div className="mt-[8px] text-[#E3F654] text-[42px] leading-[0.9] font-bold tracking-[-1px] font-['Space_Grotesk']">{ride.nextStart}</div>
          </div>
          <div className="text-right">
            <div className="mt-[8px] text-[#E3F654] text-[42px] leading-[0.9] font-bold tracking-[-1px] font-['Space_Grotesk']">{ride.nextEnd}</div>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-[64px_1fr_64px] items-center gap-4">
          <div className="h-[64px] bg-[#242525] rounded-[14px] flex items-center justify-center">
            <img src="/icon/_Icon_Schwarz/Arrow_Nav_Trisar_Icons_01.svg" alt="" className="w-[31px] h-[24px]" />
          </div>
          <div className="flex justify-center">
            <img src="/icon/_Icon_Schwarz/Arrow_Nav_Trisar_Icons_01.svg" alt="" className="w-[59px] h-[38px]" />
          </div>
          <div className="h-[64px] bg-[#242525] rounded-[14px] flex items-center justify-center">
            <img src="/icon/_Icon_Schwarz/House_Nav_Trisar_01.svg" alt="" className="w-[32px] h-[27px]" />
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

        <div className="mt-6 mb-[30px] grid grid-cols-2 gap-6">
          <div>
            <div className="text-[#868687] text-[12px] leading-[1] font-bold tracking-[-0.3px] font-['Space_Grotesk']">Dienststart</div>
            <div className="mt-[8px] text-[#E3F654] text-[42px] leading-[0.9] font-bold tracking-[-1px] font-['Space_Grotesk']">{ride.dienststart}</div>
          </div>
          <div className="text-right">
            <div className="text-[#868687] text-[12px] leading-[1] font-bold tracking-[-0.3px] font-['Space_Grotesk']">Dienstende</div>
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

const formatLookaheadHoursLabel = (hoursValue) => {
  const safeHours = Math.max(0, Math.min(8, Number(hoursValue) || 0));
  const rounded = Math.round(safeHours * 10) / 10;
  if (Number.isInteger(rounded)) return `${rounded}h`;
  return `${String(rounded).replace('.', ',')}h`;
};

function DriverQuickFilterBar({ counts, selectedFilters, onToggle, onInactiveLongPress }) {
  const items = [
    { key: DRIVER_STATE_ACTIVE, label: 'Aktiv', color: DRIVER_STATE_COLORS[DRIVER_STATE_ACTIVE] },
    { key: DRIVER_STATE_INACTIVE, label: 'Inaktiv', color: DRIVER_STATE_COLORS[DRIVER_STATE_INACTIVE] },
    { key: DRIVER_STATE_FREE, label: 'Frei', color: DRIVER_STATE_COLORS[DRIVER_STATE_FREE] },
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
    <div className="absolute left-1/2 -translate-x-1/2 top-[142px] z-20 w-[362px] h-11 bg-black rounded-xl px-[16px] flex items-center justify-between">
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
        'radial-gradient(ellipse 141.42% 102.21% at 0.00% -0.00%, #313701 0%, black 46%, black 84%, black 100%)',
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
          const isDispoRole = ['dispo', 'dispatcher', 'admin', 'koordinator', 'coordinator'].includes(role);
          if (row?.is_dispo === true) return false;
          if (isDispoRole) return false;
          return true;
        });
        const profileById = new Map(visibleProfiles.map((row) => [String(row.id || ''), row]));
        const jobById = new Map(jobRows.map((job) => [String(job?.id || '').trim(), job]));
        const jobsByDriverId = new Map();
        const addJobForDriver = (driverId, job) => {
          const normalizedDriverId = String(driverId || '').trim();
          if (!normalizedDriverId || !job) return;
          if (!jobsByDriverId.has(normalizedDriverId)) jobsByDriverId.set(normalizedDriverId, []);
          jobsByDriverId.get(normalizedDriverId).push(job);
        };

        jobRows.forEach((job) => addJobForDriver(job?.driver_id, job));
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

            const profile = profileById.get(id);
            const name = [profile?.first_name, profile?.last_name].filter(Boolean).join(' ').trim() || `Fahrer ${id.slice(0, 8)}`;
            const avatarUrl = String(profile?.avatar_url || '').trim();
            const plate = String(profile?.vehicles?.license_plate || '').trim() || '-';
            const brandModel = String(profile?.vehicles?.brand_model || '').trim();
            const trim = String(profile?.vehicles?.trim || '').trim();
            const vehicle = [brandModel, trim].filter(Boolean).join(' ').trim() || 'Fahrzeug';
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
            });
            const routeJob = activeJob || nextUpcomingJob || null;
            const activeRide = buildDriverActiveRide(routeJob);

            return {
              id,
              name,
              avatarUrl,
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
          setDriversError('Keine Live-Fahrerstandorte sichtbar. Bitte Anmeldung/Session und RLS-Policy fuer `driver_live_locations` pruefen.');
        }

        if (mapped.length > 0) {
          setDrivers(mapped);
          writeDriverMapCache(mapped);
        }
        setSelectedDriverId((prev) => (mapped.some((entry) => entry.id === prev) ? prev : null));
      } catch (error) {
        if (!mounted) return;
        setDriversError(`Fahrer-Standorte konnten nicht geladen werden: ${error.message}`);
      }
    };

    const refreshDrivers = async () => {
      if (refreshInFlight) return;
      refreshInFlight = true;
      try {
        await loadDriversFromDb();
      } finally {
        refreshInFlight = false;
      }
    };

    refreshDrivers();

    const refreshChannel = supabase
      .channel('ko-karten-live-refresh')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'driver_live_locations' }, () => {
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
      supabase.removeChannel(refreshChannel);
    };
  }, [inactiveLookaheadHours]);

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
    return {
      ...selectedDriver,
      rideInfo: {
        ...rideInfo,
        nextEnd: computedEta || rideInfo.nextEnd || '--:--',
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

  const handleSelectDriver = useCallback((driverId) => {
    setSelectedDriverId(driverId);
    setRouteMetrics(null);
    setSheetPercent(getMinSheetPercent());
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
        sheetPercent={selectedDriver ? sheetPercent : 0}
        onRouteMetricsChange={setRouteMetrics}
        resetCameraSignal={resetCameraSignal}
      />

      {driversError ? (
        <div className="absolute left-5 right-5 top-[196px] z-20 bg-[#171717] border border-[#3a3a3a] p-3 whitespace-pre-line text-[#ff8e8e] text-[12px] leading-[1.35] font-medium font-['Space_Grotesk']">
          {driversError}
        </div>
      ) : null}

      <button
        type="button"
        onClick={handleBack}
        aria-label="Zurück"
        onTouchMove={(event) => event.preventDefault()}
        className="absolute top-[60px] left-[20px] z-20 w-[50px] h-[50px] touch-none select-none"
      >
        <img src="/icon/_Icon_Karte/Backbutton_Karte.svg" alt="" className="w-[50px] h-[50px] object-contain" />
      </button>

      <button
        type="button"
        onClick={() => setView('kartenFilter')}
        aria-label="Filter"
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
        <div className="absolute left-1/2 -translate-x-1/2 top-[190px] z-20 w-[362px] bg-black/90 border border-[#2c2c2c] rounded-xl px-3 py-3">
          <button
            type="button"
            onClick={() => setShowInactiveLookaheadSlider(false)}
            className="absolute right-2 top-2 w-7 h-7 flex items-center justify-center text-[#E3F654] text-[20px] leading-none font-bold"
            aria-label="Inaktiv-Slider schließen"
          >
            ×
          </button>
          <div className="flex items-center justify-between text-[13px] font-medium font-['Space_Grotesk'] text-[#E3F654]">
            <span>Inaktiv-Fenster</span>
            <span>{formatLookaheadHoursLabel(inactiveLookaheadHours)}</span>
          </div>
          <input
            type="range"
            min="0"
            max="8"
            step="0.5"
            value={inactiveLookaheadHours}
            onChange={(event) => setInactiveLookaheadHours(Number(event.target.value))}
            className="mt-2 w-full accent-[#E3F654]"
            aria-label="Inaktiv-Fenster in Stunden"
          />
          <div className="mt-1 flex items-center justify-between text-[11px] font-medium font-['Space_Grotesk'] text-[#8a8a8d]">
            <span>0h</span>
            <span>8h</span>
          </div>
        </div>
      ) : null}

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
        onNavigateToMap={handleMapNavPress}
        onNavigateToAddFahrt={() => setView('fahrtAdd')}
        onNavigateToKi={() => setView('kiAssistent')}
        activeTab="map"
      />
    </div>
  );
}
