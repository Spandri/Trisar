import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { SUPABASE_FUNCTIONS } from '../../shared/supabase/functions';
import { supabase } from '../../shared/supabase/client';
import { DEMO_MODE } from '../../datenquelle';
import KeineFahrtTrisar from '../../components/KeineFahrtTrisar';
import KeinAuto from '../../components/KeinAuto';
import TrisarFooter from '../../components/ui/TrisarFooter';
import FahrtenScreen01View from './views/FahrtenScreen01View';
import ProfilFahrerView from './views/ProfilFahrerView';
import Verlauf from './views/Verlauf';
import SettingsFahrer from './views/SettingsFahrer';
import AnsprechpartnerView from './views/AnsprechpartnerView';
import VehicleView from './views/VehicleView';
import LoginView from './views/LoginView';
import KoloneNormal from './views/KoloneNormal';
import KoloneFlughafen from './views/KoloneFlughafen';
import SoloFlughafen from './views/SoloFlughafen';
import SoloNormal from './views/SoloNormal';
import KolonnenChat from './views/KolonnenChat';
import { kolonnenNameKurz } from '../../shared/utils/kolonnenName';
import { vorherigeOffeneFahrt } from '../../shared/utils/vorherigeFahrt';
import { I18nProvider, useI18n, translate, LANGUAGE_TO_CODE, CODE_TO_LOCALE } from '../../i18n';

import { 
  Plane, 
  Building2, 
  ArrowRight, 
  Check, 
  X, 
  MapPin, 
  Clock, 
  ChevronLeft, 
  Users, 
  Star, 
  Baby, 
  Accessibility, 
  Plus, 
  Search, 
  AlertCircle, 
  UserPlus, 
  Loader2, 
  Navigation, 
  Timer, 
  RefreshCw, 
  Car, 
  Menu, 
  FileUp,
  Phone,
  MessageCircle,
  Send,
  LogOut,
  Pencil,
  ChevronDown,
  Mail,
  UserRound,
  BaggageClaim,
  CalendarDays
} from 'lucide-react';
import { MAP_FAHRER_STANDORT_URL, MAP_FLAG_PIN_URL, MAP_PERSON_PIN_URL } from '../../shared/ui/icons';

const envOrDefault = (value, fallback) => {
  if (!value) return fallback;
  if (typeof value === 'string' && value.trim().toLowerCase().startsWith('your_')) return fallback;
  return value;
};
const envFlagEnabled = (value, fallback = false) => {
  const raw = String(value ?? '').trim().toLowerCase();
  if (!raw) return fallback;
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
};


// API Keys & Konstanten
const SUPABASE_URL_FOR_DEBUG = envOrDefault(import.meta.env.VITE_SUPABASE_URL, 'http://localhost:54321');
const SUPABASE_KEY_FOR_DEBUG = envOrDefault(import.meta.env.VITE_SUPABASE_KEY, '');
const OPENSKY_DEBUG_ENABLED = envFlagEnabled(import.meta.env.VITE_OPENSKY_DEBUG_ENABLED, false);
const OPENSKY_429_CLIENT_BACKOFF_MS = 3 * 60 * 1000;
const LIVE_VIEW_SYNC_INTERVAL_MS = 60 * 1000;
const OPENSKY_MAX_LIVE_AGE_MS = 2 * 60 * 1000;
const DRIVER_COORDS = { lat: 48.1215, lng: 11.6644 }; // Friedenspromenade 24, München
const VEHICLE_IMAGE_URL = "https://larte-design.com/storage/app/media/models/bmw/x5m-competition-front-site-carbon-gray-donington.webp";
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
// Blau-weißer Standort-Dot SVG für Google Maps

// --- HILFSFUNKTIONEN ---

const addMinutesToTime = (timeStr, minsToAdd) => {
  if (!timeStr) return null;
  const [hours, minutes] = timeStr.split(':').map(Number);
  const date = new Date();
  date.setHours(hours);
  date.setMinutes(minutes + Number(minsToAdd));
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
};

const formatDuration = (mins) => {
  if (!mins || mins <= 0) return "0 min";
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h}:${String(m).padStart(2, '0')} h`;
};

const isFiniteNumber = (value) => typeof value === 'number' && Number.isFinite(value);
const isLikelyValidLatLng = (lat, lng) =>
  Number.isFinite(lat)
  && Number.isFinite(lng)
  && Math.abs(lat) <= 90
  && Math.abs(lng) <= 180
  && !(Math.abs(lat) < 0.000001 && Math.abs(lng) < 0.000001);

const getEtdColorClass = (job) => {
  if (!job.flight || job.flight === "STADTFAHRT") return "text-[#d4ff28]";
  if (!job.originalEtd) return "text-[#d4ff28]";
  const landingTime = addMinutesToTime(job.etd, -(job.waitingTime || 0));
  if (landingTime > job.originalEtd) return "text-[#ef4444]"; 
  return "text-[#d4ff28]"; 
};

const DAY_IN_MS = 24 * 60 * 60 * 1000;

const toLocalDateValue = (input = new Date()) => {
  const date = input instanceof Date ? input : new Date(input);
  const timezoneOffsetMs = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - timezoneOffsetMs).toISOString().slice(0, 10);
};

const normalizeRideDate = (value) => (/^\d{4}-\d{2}-\d{2}$/.test(value || '') ? value : toLocalDateValue());

const parseRideDate = (value) => {
  const normalized = normalizeRideDate(value);
  const [year, month, day] = normalized.split('-').map(Number);
  return new Date(year, month - 1, day);
};

const formatRideDayLabel = (value, t, locale) => {
  const targetDate = parseRideDate(value);
  const today = parseRideDate(toLocalDateValue());
  const diffDays = Math.round((targetDate.getTime() - today.getTime()) / DAY_IN_MS);
  if (diffDays === 0) return t('app.today');
  if (diffDays === 1) return t('app.tomorrow');
  if (diffDays === -1) return t('app.yesterday');
  return targetDate.toLocaleDateString(locale, { day: '2-digit', month: '2-digit' });
};

const getRideDateFromJob = (job) => normalizeRideDate(
  job?.ride_date
  || job?.pickup_date
  || job?.service_date
  || (job?.created_at ? job.created_at.slice(0, 10) : ''),
);

const isMissingColumnError = (error, columnName) => {
  const lowerMessage = `${error?.message || ''} ${error?.details || ''} ${error?.hint || ''}`.toLowerCase();
  return lowerMessage.includes(columnName.toLowerCase()) && lowerMessage.includes('column');
};

const isUuid = (value) => UUID_REGEX.test(value || '');

const normalizeTimeWithSeconds = (value) => {
  if (!value) return null;
  if (/^\d{2}:\d{2}:\d{2}$/.test(value)) return value;
  if (/^\d{2}:\d{2}$/.test(value)) return `${value}:00`;
  return null;
};

const hasSyncableFlightOnJob = (job) => {
  const flight = `${job?.flight || ''}`.trim().toUpperCase();
  return Boolean(flight) && flight !== 'STADTFAHRT';
};

const toShortFormattedAddress = (name, address) => {
  const nameText = typeof name === 'string' ? name.trim() : '';
  if (nameText) {
    const nameFirstSegment = nameText.split(',')[0]?.trim();
    if (nameFirstSegment) return nameFirstSegment;
    return nameText;
  }

  const addressText = typeof address === 'string' ? address.trim() : '';
  if (!addressText) return '';
  const firstSegment = addressText.split(',')[0]?.trim();
  return firstSegment || addressText;
};

const logOpenSkyDebug = (label, payload) => {
  if (!OPENSKY_DEBUG_ENABLED) return;
  try {
    console.log(`[OpenSky Debug] ${label}`, payload);
  } catch {
    // never break flow because of logging
  }
};

const normalizePassengerNames = (value) => {
  let rawValues = [];

  if (Array.isArray(value)) {
    rawValues = value;
  } else if (value && typeof value === 'object') {
    rawValues = Object.values(value);
  } else if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return [];
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      try {
        const parsed = JSON.parse(trimmed);
        return normalizePassengerNames(parsed);
      } catch {
        // falls through to delimiter split
      }
    }
    rawValues = trimmed.split(/[\n,;]+/g);
  } else {
    return [];
  }

  const normalized = rawValues
    .map((entry) => String(entry || '').trim())
    .filter(Boolean);

  return Array.from(new Set(normalized));
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

const OPEN_JOB_STATUSES = new Set(['pending', 'assigned', 'offen', 'new', 'requested', 'offered', 'zugewiesen']);
const AT_PICKUP_JOB_STATUSES = new Set(['at_pickup', 'beim_pickup', 'beim pickup']);
const IN_PROGRESS_JOB_STATUSES = new Set(['in_progress', 'unterwegs', 'started', 'on_trip', 'ongoing', 'active']);
const HIDDEN_JOB_STATUSES_FOR_DRIVER = new Set([
  'done', 'completed', 'arrived', 'beendet',
  'cancelled', 'canceled', 'refused', 'storniert', 'stoniert',
]);
const LIVE_ACTIVE_STATUSES = new Set([
  ...Array.from(OPEN_JOB_STATUSES),
  ...Array.from(AT_PICKUP_JOB_STATUSES),
  ...Array.from(IN_PROGRESS_JOB_STATUSES),
]);
const LIVE_LOCATION_UPSERT_INTERVAL_MS = 5000;
const LIVE_LOCATION_HISTORY_INTERVAL_MS = 15000;
// Client-seitige Statuswechsel sind aktiv, damit "Beim Pickup" -> "Unterwegs"
// sofort passiert, sobald die Bewegung vom Pickup Richtung Ziel erkannt wird.
const CLIENT_AUTO_STATUS_TRANSITIONS_ENABLED = true;
const AUTO_START_PICKUP_ENTER_RADIUS_M = 220;
const AUTO_START_PICKUP_EXIT_RADIUS_M = 280;
const AUTO_DONE_DROPOFF_RADIUS_M = 180;
const OBD_SOURCE_RE = /(teltonika|fmb\d*|obd|telematik|telematics|tracker)/i;

const normalizeStatus = (value) => String(value || '').trim().toLowerCase();
const isDriverVisibleJobStatus = (value) => !HIDDEN_JOB_STATUSES_FOR_DRIVER.has(normalizeStatus(value));

const toMinutesFromTime = (value) => {
  const match = String(value || '').match(/^(\d{1,2}):(\d{2})/);
  if (!match) return Number.MAX_SAFE_INTEGER;
  return (Number(match[1]) * 60) + Number(match[2]);
};

const toTimestamp = (value) => {
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? parsed : 0;
};

const resolveSupabaseUrlForDebug = () => (
  SUPABASE_URL_FOR_DEBUG.startsWith('/')
    ? `${window.location.origin}${SUPABASE_URL_FOR_DEBUG}`
    : SUPABASE_URL_FOR_DEBUG
);

const decodeJwtExpiry = (token) => {
  try {
    const parts = String(token || '').split('.');
    if (parts.length < 2) return null;
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    const payload = JSON.parse(atob(padded));
    const exp = Number(payload?.exp);
    return Number.isFinite(exp) ? exp : null;
  } catch {
    return null;
  }
};
const isObdLocationSource = (sourceValue) => {
  const source = String(sourceValue || '').trim().toLowerCase();
  if (!source) return false;
  return OBD_SOURCE_RE.test(source);
};

const getLiveJobPriority = (job) => {
  const status = normalizeStatus(job?.status);
  if (IN_PROGRESS_JOB_STATUSES.has(status)) return 0;
  if (AT_PICKUP_JOB_STATUSES.has(status)) return 1;
  if (OPEN_JOB_STATUSES.has(status)) return 2;
  return 9;
};

const compareLiveJobs = (left, right) => {
  const byPriority = getLiveJobPriority(left) - getLiveJobPriority(right);
  if (byPriority !== 0) return byPriority;

  const rideDateLeft = String(left?.rideDate || left?.ride_date || '');
  const rideDateRight = String(right?.rideDate || right?.ride_date || '');
  if (rideDateLeft !== rideDateRight) return rideDateLeft.localeCompare(rideDateRight);

  const etdLeft = toMinutesFromTime(left?.etd);
  const etdRight = toMinutesFromTime(right?.etd);
  if (etdLeft !== etdRight) return etdLeft - etdRight;

  return toTimestamp(left?.created_at || left?.createdAt) - toTimestamp(right?.created_at || right?.createdAt);
};

const toFiniteCoord = (coord) => {
  const lat = Number(coord?.lat);
  const lng = Number(coord?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
};

const toRadians = (value) => (value * Math.PI) / 180;

const haversineMeters = (from, to) => {
  const a = toFiniteCoord(from);
  const b = toFiniteCoord(to);
  if (!a || !b) return Number.POSITIVE_INFINITY;
  const earthRadiusM = 6371000;
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  return earthRadiusM * c;
};

const getRouteEndpointsFromJob = (job) => {
  const routePolyline = String(job?.extRoutePolyline || job?.ext_route_polyline || '').trim();
  const approachPolyline = String(job?.extDriverToPickupPolyline || job?.ext_driver_to_pickup_polyline || '').trim();
  const routePoints = decodeGooglePolyline(routePolyline);
  const approachPoints = decodeGooglePolyline(approachPolyline);
  const pickupFromRoute = routePoints.length > 0 ? routePoints[0] : null;
  const dropoffFromRoute = routePoints.length > 0 ? routePoints[routePoints.length - 1] : null;
  const pickupFromApproach = approachPoints.length > 0 ? approachPoints[approachPoints.length - 1] : null;
  return {
    pickup: toFiniteCoord(pickupFromRoute) || toFiniteCoord(pickupFromApproach),
    dropoff: toFiniteCoord(dropoffFromRoute),
  };
};

const toObjectOrNull = (value) => {
  if (!value) return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    try {
      const parsed = JSON.parse(trimmed);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  if (typeof value === 'object' && !Array.isArray(value)) return value;
  return null;
};

const extractFlightLiveTracking = (payload) => {
  const root = toObjectOrNull(payload);
  if (!root) return null;
  const live = toObjectOrNull(root.live_tracking);
  if (!live) return null;
  const lat = Number(live.latitude ?? live.lat);
  const lng = Number(live.longitude ?? live.lng ?? live.lon);
  const hasCoords = Number.isFinite(lat) && Number.isFinite(lng);
  const heading = Number(live.heading_deg ?? live.true_track_deg);
  const secondaryEta = toObjectOrNull(live.secondary_eta);
  const secondaryEtaIso = String(secondaryEta?.eta_iso || '').trim() || null;
  const secondaryEtaMinutesRaw = Number(secondaryEta?.eta_minutes);
  const trailRaw = Array.isArray(live.trail_points) ? live.trail_points : [];
  const routeStopsRaw = Array.isArray(live.route_stops)
    ? live.route_stops
    : (Array.isArray(root?.summary?.route_stops) ? root.summary.route_stops : []);
  const routeStops = routeStopsRaw
    .map((entry) => String(entry || '').trim())
    .filter(Boolean)
    .slice(0, 40);
  const trail = trailRaw
    .map((point) => {
      if (Array.isArray(point)) {
        const pointLat = Number(point[1]);
        const pointLng = Number(point[2]);
        if (!Number.isFinite(pointLat) || !Number.isFinite(pointLng)) return null;
        const pointTime = Number(point[0]);
        return {
          lat: pointLat,
          lng: pointLng,
          timeEpoch: Number.isFinite(pointTime) ? pointTime : null,
        };
      }
      const obj = toObjectOrNull(point);
      if (!obj) return null;
      const pointLat = Number(obj.latitude ?? obj.lat);
      const pointLng = Number(obj.longitude ?? obj.lng ?? obj.lon);
      if (!Number.isFinite(pointLat) || !Number.isFinite(pointLng)) return null;
      const pointTime = Number(obj.time_epoch ?? obj.time ?? obj.timestamp);
      return {
        lat: pointLat,
        lng: pointLng,
        timeEpoch: Number.isFinite(pointTime) ? pointTime : null,
      };
    })
    .filter(Boolean);
  const capturedAtRaw = String(live.captured_at || '').trim() || null;
  const capturedAtMs = capturedAtRaw ? Date.parse(capturedAtRaw) : NaN;
  const isStaleLive = Number.isFinite(capturedAtMs) && (Date.now() - capturedAtMs) > OPENSKY_MAX_LIVE_AGE_MS;
  return {
    mode: String(live.mode || '').trim().toLowerCase() || null,
    lat: hasCoords && !isStaleLive ? lat : null,
    lng: hasCoords && !isStaleLive ? lng : null,
    heading: Number.isFinite(heading) ? heading : null,
    radarHex: !isStaleLive ? (String(live.radar_hex || live.icao24 || '').trim().toLowerCase() || null) : null,
    callsign: !isStaleLive ? (String(live.callsign || '').trim().toUpperCase() || null) : null,
    capturedAt: !isStaleLive ? capturedAtRaw : null,
    onGround: typeof live.on_ground === 'boolean' ? live.on_ground : null,
    secondaryEtaIso,
    secondaryEtaMinutes: Number.isFinite(secondaryEtaMinutesRaw) ? secondaryEtaMinutesRaw : null,
    lastError: String(live.last_error || '').trim() || null,
    lastErrorAt: String(live.last_error_at || '').trim() || null,
    trail: !isStaleLive && trail.length > 1 ? trail : [],
    routeStops,
    stale: isStaleLive,
  };
};

const extractFlightSummary = (payload) => {
  const root = toObjectOrNull(payload);
  if (!root) return null;
  const summary = toObjectOrNull(root.summary);
  const raw = toObjectOrNull(root.raw);
  const firstRawFlight = (() => {
    if (!raw) return null;
    const resource = toObjectOrNull(raw.FlightStatusResource);
    const flights = toObjectOrNull(resource?.Flights);
    const flightNode = flights?.Flight;
    if (Array.isArray(flightNode)) return toObjectOrNull(flightNode[0]);
    return toObjectOrNull(flightNode);
  })();
  if (!summary && !firstRawFlight) return null;

  const statusCode = String(
    summary?.flight_status_code
    || firstRawFlight?.FlightStatus?.Code
    || '',
  ).trim().toUpperCase() || null;
  const statusDescription = String(
    summary?.flight_status_description
    || firstRawFlight?.FlightStatus?.Definition
    || '',
  ).trim() || null;
  const estimatedArrivalIso = String(
    summary?.estimated_arrival_local
    || firstRawFlight?.Arrival?.EstimatedTimeLocal?.DateTime
    || '',
  ).trim() || null;
  const actualArrivalIso = String(
    summary?.actual_arrival_local
    || firstRawFlight?.Arrival?.ActualTimeLocal?.DateTime
    || '',
  ).trim() || null;
  const scheduledArrivalIso = String(
    summary?.scheduled_arrival_local
    || firstRawFlight?.Arrival?.ScheduledTimeLocal?.DateTime
    || '',
  ).trim() || null;
  const departureAirport = String(
    summary?.departure_airport
    || firstRawFlight?.Departure?.AirportCode
    || '',
  ).trim() || null;
  return {
    statusCode,
    statusDescription,
    estimatedArrivalIso,
    actualArrivalIso,
    scheduledArrivalIso,
    departureAirport,
  };
};

const getPickupAddressQueryFromJob = (job) =>
  String(
    job?.from?.address
    || job?.from?.name
    || job?.pickup_address
    || job?.pickup_name
    || '',
  ).trim();

const getDropoffAddressQueryFromJob = (job) =>
  String(
    job?.to?.address
    || job?.to?.name
    || job?.dropoff_address
    || job?.dropoff_name
    || '',
  ).trim();

const _getCurrentPosition = () =>
  new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Geolocation nicht verfügbar.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 0,
    });
  });

const reportExternalSyncIssuesToConsole = ({ reason, jobIds, data }) => {
  const errors = Array.isArray(data?.errors) ? data.errors : [];
  const skipped = Array.isArray(data?.skipped) ? data.skipped : [];
  const errorMessages = errors
    .map((entry) => String(entry?.message || '').trim())
    .filter(Boolean);
  const skippedMessages = skipped
    .map((entry) => String(entry?.why || '').trim())
    .filter(Boolean);
  const allMessages = [...errorMessages, ...skippedMessages];
  const has429 = allMessages.some((text) => /\b429\b/.test(text));

  if (has429) {
    console.error('[external-sync][429]', {
      reason,
      jobIds,
      errors,
      skipped,
    });
  }
  if (errors.length > 0) {
    console.warn('[external-sync][errors]', {
      reason,
      jobIds,
      errors,
    });
  }
};

const invokeExternalSync = async ({ reason, jobIds, requestedBy, currentLocation = null, forceRefresh = false }) => {
  const validJobIds = (jobIds || []).filter(isUuid);
  if (!validJobIds.length) return null;
  const payload = {
    reason,
    job_ids: validJobIds,
    requested_by: requestedBy || null,
  };
  if (
    currentLocation &&
    isFiniteNumber(currentLocation.lat) &&
    isFiniteNumber(currentLocation.lng)
  ) {
    payload.current_location = {
      lat: currentLocation.lat,
      lng: currentLocation.lng,
    };
  }
  if (forceRefresh) payload.force_refresh = true;
  let accessToken = '';
  let hasSession = false;
  let tokenExpiresInSec = null;
  try {
    const sessionResult = await supabase.auth.getSession();
    accessToken = String(sessionResult?.data?.session?.access_token || '').trim();
    hasSession = Boolean(sessionResult?.data?.session);
    const exp = decodeJwtExpiry(accessToken);
    tokenExpiresInSec = Number.isFinite(exp) ? (exp - Math.floor(Date.now() / 1000)) : null;
  } catch {
    accessToken = '';
    hasSession = false;
    tokenExpiresInSec = null;
  }

  const invokeHeaders = accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined;
  const { data, error } = await supabase.functions.invoke(SUPABASE_FUNCTIONS.externalSync, {
    body: payload,
    ...(invokeHeaders ? { headers: invokeHeaders } : {}),
  });
  if (error) {
    const errorMessage = error?.message || String(error);
    console.warn('[external-sync] invoke failed', {
      reason,
      jobIds: validJobIds.length,
      hasSession,
      hasAccessToken: Boolean(accessToken),
      tokenExpiresInSec,
      message: errorMessage,
    });
    if (/\b429\b/.test(String(errorMessage))) {
      console.error('[external-sync][429][invoke-failed]', {
        reason,
        jobIds: validJobIds,
        message: errorMessage,
      });
    }

    try {
      const endpoint = `${resolveSupabaseUrlForDebug()}/functions/v1/${SUPABASE_FUNCTIONS.externalSync}`;
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(SUPABASE_KEY_FOR_DEBUG ? { apikey: SUPABASE_KEY_FOR_DEBUG } : {}),
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify(payload),
      });
      const responseText = await response.text();
      console.warn('[external-sync] debug response', {
        endpoint,
        responseUrl: response.url,
        status: response.status,
        server: response.headers.get('server'),
        via: response.headers.get('via'),
        body: responseText.slice(0, 600),
      });

      const authEndpoint = `${resolveSupabaseUrlForDebug()}/auth/v1/user`;
      const authResponse = await fetch(authEndpoint, {
        method: 'GET',
        headers: {
          ...(SUPABASE_KEY_FOR_DEBUG ? { apikey: SUPABASE_KEY_FOR_DEBUG } : {}),
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
      });
      const authText = await authResponse.text();
      console.warn('[external-sync] auth debug response', {
        endpoint: authEndpoint,
        responseUrl: authResponse.url,
        status: authResponse.status,
        server: authResponse.headers.get('server'),
        via: authResponse.headers.get('via'),
        body: authText.slice(0, 400),
      });
    } catch (debugError) {
      console.warn('[external-sync] debug fetch failed', debugError?.message || debugError);
    }
    throw error;
  }
  logOpenSkyDebug('external-sync response', {
    reason,
    jobIds: validJobIds,
    usage: data?.usage || null,
    errors: Array.isArray(data?.errors) ? data.errors : [],
    processed: Array.isArray(data?.processed) ? data.processed : [],
    skipped: Array.isArray(data?.skipped) ? data.skipped : [],
  });
  reportExternalSyncIssuesToConsole({
    reason,
    jobIds: validJobIds,
    data,
  });
  return data || null;
};

const fetchPlacesPredictions = async (input, country = 'de') => {
  const { data, error } = await supabase.functions.invoke(SUPABASE_FUNCTIONS.placesProxy, {
    body: { input, country },
  });
  if (error) throw error;
  return data?.predictions || [];
};

const insertJobsWithOptionalRideDate = async (payload) => {
  const rows = (Array.isArray(payload) ? payload : [payload]).map((row) => ({
    ...row,
    ride_date: normalizeRideDate(row.ride_date),
  }));
  const { data, error } = await supabase.from('jobs').insert(rows).select('id');
  if (error && isMissingColumnError(error, 'ride_date')) {
    const fallbackRows = rows.map((inputRow) => {
      const { ride_date, ...row } = inputRow;
      void ride_date;
      return row;
    });
    const fallbackResult = await supabase.from('jobs').insert(fallbackRows).select('id');
    if (fallbackResult.error) throw fallbackResult.error;
    return fallbackResult.data || [];
  }
  if (error) throw error;
  return data || [];
};

// --- KOMPONENTE: CHAT VIEW ---
const ChatView = ({ setView, activeChat, messages, setMessages, currentUserId }) => {
  const { t } = useI18n();
  const [inputText, setInputText] = useState('');
  const messagesEndRef = useRef(null);
  const [peerReadAt, setPeerReadAt] = useState(null);

  const chatHistory = messages[activeChat.id] || [];

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [chatHistory]);

  // Supabase: Nachrichten laden

  useEffect(() => {
    const fetchMessages = async () => {
      try {
        let query = supabase.from('messages').select('*').order('created_at', { ascending: true });
        if (activeChat.type === 'group') {
          query = query.eq('target_id', activeChat.id).eq('target_type', 'group');
        } else {
          query = query
            .eq('target_type', 'direct')
            .or(
              `and(sender_id.eq.${currentUserId},target_id.eq.${activeChat.id}),and(sender_id.eq.${activeChat.id},target_id.eq.${currentUserId})`,
            );
        }
        const { data } = await query;
        const senderIds = Array.from(new Set((data || []).map((msg) => msg.sender_id).filter(Boolean)));
        const { data: profiles } = senderIds.length
          ? await supabase.from('profiles').select('id,first_name,last_name').in('id', senderIds)
          : { data: [] };
        const profileMap = Object.fromEntries((profiles || []).map((p) => [p.id, `${p.first_name || ''} ${p.last_name || ''}`.trim()]));
        if (data && data.length > 0) {
          const formattedMsgs = data.map(msg => ({
            id: msg.id, 
            sender: msg.sender_id === currentUserId ? 'me' : (profileMap[msg.sender_id] || t('app.colleague')),
            text: msg.content, 
            time: new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            createdAt: msg.created_at,
          }));
          setMessages(prev => ({ ...prev, [activeChat.id]: formattedMsgs }));
        }
        if (activeChat.type === 'individual') {
          const { data: readRow } = await supabase
            .from('chat_reads')
            .select('last_read_at')
            .eq('user_id', activeChat.id)
            .eq('chat_type', 'direct')
            .eq('chat_id', currentUserId)
            .maybeSingle();
          setPeerReadAt(readRow?.last_read_at || null);
        } else {
          setPeerReadAt(null);
        }
      } catch (err) { console.error("Chat Fetch Error:", err); }
    };
    if (isUuid(activeChat.id)) fetchMessages();
  }, [activeChat.id, activeChat.type, currentUserId, setMessages]);

  const handleSend = async (e) => {
    e.preventDefault();
    if (!inputText.trim()) return;
    const newMsg = {
      id: Date.now(),
      sender: 'me',
      text: inputText.trim(),
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      createdAt: new Date().toISOString(),
    };
    
    // Lokales Update für schnelles Feedback
    setMessages(prev => ({
      ...prev,
      [activeChat.id]: [...(prev[activeChat.id] || []), newMsg]
    }));
    setInputText('');

    // Sende an Supabase
    if (isUuid(activeChat.id)) {
      try {
        await supabase.from('messages').insert([{
          sender_id: currentUserId,
          target_type: activeChat.type === 'group' ? 'group' : 'direct',
          target_id: activeChat.id,
          content: newMsg.text
        }]);
      } catch (err) { console.error("Send Error:", err); }
    }
  };

  return (
    <div className="flex flex-col h-screen bg-[#0a0a0a] max-w-md mx-auto relative overflow-hidden font-sans text-white">
      {/* HEADER */}
      <header className="flex items-center gap-4 bg-[#111111] p-6 border-b border-[#222224] z-20 shadow-md">
        <button onClick={() => setView(activeChat.backView || 'details')} className="bg-[#222224] p-3 rounded-xl active:scale-90 transition-transform">
          <ChevronLeft size={24} className="text-white" />
        </button>
        <div className="flex flex-col">
          <h2 className="text-xl font-black uppercase tracking-tighter text-[#d4ff28] leading-tight">{activeChat.name}</h2>
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
            {activeChat.type === 'group' ? t('app.convoyChat') : t('app.directMessage')}
          </p>
        </div>
      </header>

      {/* MESSAGES */}
      <div className="flex-1 overflow-y-auto overscroll-none p-4 space-y-4 custom-scrollbar bg-[#0a0a0a]">
        {chatHistory.length === 0 ? (
          <div className="text-center text-slate-500 font-bold text-sm mt-10">{t('app.noMessages')}<br/>{t('app.writeFirstMessage')}</div>
        ) : (
          (() => {
            let newDividerShown = false;
            return chatHistory.map(msg => {
            const isNew = activeChat.readBoundary ? new Date(msg.createdAt || 0) > new Date(activeChat.readBoundary) : false;
            const isMe = msg.sender === 'me';
            return (
              <React.Fragment key={msg.id}>
                {!newDividerShown && isNew && (
                  (() => {
                    newDividerShown = true;
                    return (
                      <div className="flex items-center gap-2 my-2">
                        <div className="flex-1 h-px bg-slate-700" />
                        <span className="text-[10px] font-black uppercase tracking-wider text-[#d4ff28]">{t('app.new')}</span>
                        <div className="flex-1 h-px bg-slate-700" />
                      </div>
                    );
                  })()
                )}
              <div className={`flex flex-col max-w-[80%] ${isMe ? 'self-end items-end ml-auto' : 'self-start items-start'}`}>
                {!isMe && activeChat.type === 'group' && (
                  <span className="text-[10px] font-black text-slate-400 ml-2 mb-1">{msg.sender}</span>
                )}
                <div className={`px-4 py-3 rounded-2xl ${isMe ? 'bg-[#d4ff28] text-black rounded-tr-sm' : 'bg-[#222224] text-white border border-slate-700 rounded-tl-sm'}`}>
                  <p className="text-sm font-bold leading-snug">{msg.text}</p>
                </div>
                <span className="text-[9px] font-bold text-slate-500 mt-1 mx-1">
                  {msg.time}
                  {isMe && activeChat.type === 'individual' && (
                    <span className="ml-2 text-[9px] text-slate-400">
                      {peerReadAt && msg.createdAt && new Date(msg.createdAt) <= new Date(peerReadAt) ? t('app.read') : t('app.sent')}
                    </span>
                  )}
                </span>
              </div>
              </React.Fragment>
            );
          });
          })()
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* INPUT */}
      <form onSubmit={handleSend} className="bg-[#111111] p-4 border-t border-[#222224] flex gap-2">
        <input 
          type="text" 
          placeholder={t('app.writeMessage')}
          className="flex-1 bg-[#222224] border border-slate-700 rounded-2xl px-4 py-3 font-bold text-white focus:outline-none focus:border-[#d4ff28] transition-colors"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
        />
        <button type="submit" disabled={!inputText.trim()} className="bg-[#d4ff28] text-black w-12 h-12 rounded-2xl flex items-center justify-center disabled:opacity-50 active:scale-95 transition-transform shrink-0">
          <Send size={20} strokeWidth={3} />
        </button>
      </form>
      {/* Footer als letzte Zeile der Spalte — bleibt unten stehen, nur der
          Nachrichtenbereich darueber scrollt. */}
      <TrisarFooter className="relative w-full h-10 bg-black shrink-0" />
    </div>
  );
};

const ChatListView = ({ chats, unreadByChat, chatLastByChat, setView, setActiveChat, getLastReadValue }) => {
  const { t } = useI18n();
  return (
  <div className="flex flex-col h-screen bg-[#0a0a0a] max-w-md mx-auto overflow-hidden font-sans text-white">
    <header className="flex items-center gap-4 bg-[#111111] p-6 border-b border-[#222224] z-20 shadow-md">
      <button onClick={() => setView('list')} className="bg-[#222224] p-3 rounded-xl active:scale-90 transition-transform">
        <ChevronLeft size={24} className="text-white" />
      </button>
      <div className="flex flex-col">
        <h2 className="text-xl font-black uppercase tracking-tighter text-[#d4ff28] leading-tight">{t('app.chats')}</h2>
        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{t('app.openConversations')}</p>
      </div>
    </header>
    <main className="flex-1 overflow-y-auto overscroll-none p-4 space-y-3 custom-scrollbar">
      {!chats.length && <div className="text-sm font-bold text-slate-500 text-center mt-10">{t('app.noChatsYet')}</div>}
      {[...chats]
        .sort((a, b) => {
          const unreadA = unreadByChat?.[`${a.type}:${a.id}`] || 0;
          const unreadB = unreadByChat?.[`${b.type}:${b.id}`] || 0;
          if (unreadA !== unreadB) return unreadB - unreadA;
          const timeA = chatLastByChat?.[`${a.type}:${a.id}`] || '';
          const timeB = chatLastByChat?.[`${b.type}:${b.id}`] || '';
          return new Date(timeB).getTime() - new Date(timeA).getTime();
        })
        .map((chat) => {
        const unread = unreadByChat?.[`${chat.type}:${chat.id}`] || 0;
        return (
          <button
            key={`${chat.type}-${chat.id}`}
            onClick={() => {
              setActiveChat({ ...chat, backView: 'chatList', readBoundary: getLastReadValue(chat.type, chat.id) });
              setView('chat');
            }}
            className="w-full bg-[#161618] border border-[#222224] rounded-2xl p-4 text-left flex items-center justify-between gap-3"
          >
            <div>
              <div className="text-sm font-black">{chat.name}</div>
              <div className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mt-1">
                {chat.type === 'group' ? t('app.convoyChat') : t('app.privateChat')}
              </div>
            </div>
            {unread > 0 && (
              <span className="min-w-5 h-5 px-1 rounded-full bg-[#d4ff28] text-black text-[10px] leading-5 text-center font-black">
                {unread > 9 ? '9+' : unread}
              </span>
            )}
          </button>
        );
      })}
    </main>
    <TrisarFooter className="relative w-full h-10 bg-black shrink-0" />
  </div>
  );
};

// --- HILFSKOMPONENTE: Google Map Detailansicht ---
const GoogleMapComponent = ({ job }) => {
  const { t } = useI18n();
  const mapRef = useRef(null);

  useEffect(() => {
    const initMap = () => {
      if (!window.trisarKarte || !mapRef.current) return;
      const map = new window.trisarKarte.Map(mapRef.current, {
        center: DRIVER_COORDS,
        zoom: 12,
        disableDefaultUI: true,
        styles: [
          { featureType: "all", elementType: "labels.text.fill", stylers: [{ color: "#334155" }] },
          { featureType: "water", elementType: "geometry", stylers: [{ color: "#e2e8f0" }] },
          { featureType: "landscape", elementType: "geometry", stylers: [{ color: "#f8fafc" }] },
          { featureType: "poi", elementType: "labels", stylers: [{ visibility: "off" }] },
        ],
      });

      const combinedBounds = new window.trisarKarte.LatLngBounds();
      const personPinIcon = {
        url: MAP_PERSON_PIN_URL,
        scaledSize: new window.trisarKarte.Size(35, 41.1367),
        anchor: new window.trisarKarte.Point(17.5, 41.1367),
      };
      const flagIcon = {
        url: MAP_FLAG_PIN_URL,
        scaledSize: new window.trisarKarte.Size(35, 41.1367),
        anchor: new window.trisarKarte.Point(17.5, 41.1367),
      };

      const driverCoords = isFiniteNumber(job?.driverLiveLat) && isFiniteNumber(job?.driverLiveLng)
        ? { lat: job.driverLiveLat, lng: job.driverLiveLng }
        : DRIVER_COORDS;

      new window.trisarKarte.Marker({
        position: driverCoords,
        map,
        // Eigener Standort nach Figma 2557-12230: blauer Kreis mit Fahrernummer.
        icon: {
          url: MAP_FAHRER_STANDORT_URL,
          scaledSize: new window.trisarKarte.Size(35, 35),
          anchor: new window.trisarKarte.Point(17.5, 17.5),
          labelOrigin: new window.trisarKarte.Point(17.5, 17.5),
        },
        label: job?.driverNumber != null ? { text: String(job.driverNumber), color: '#FFFFFF', fontSize: '20px', fontWeight: '700' } : undefined,
        zIndex: 300,
      });
      combinedBounds.extend(driverCoords);

      const flightCoords = isFiniteNumber(job?.flightLiveLat) && isFiniteNumber(job?.flightLiveLng)
        ? { lat: job.flightLiveLat, lng: job.flightLiveLng }
        : null;
      const flightHeading = isFiniteNumber(job?.flightLiveHeadingDeg) ? job.flightLiveHeadingDeg : 0;
      const flightCallsign = String(job?.flightCallsign || job?.flight || '').trim() || null;
      if (flightCoords) {
        new window.trisarKarte.Marker({
          position: flightCoords,
          map,
          icon: {
            path: window.trisarKarte.SymbolPath.FORWARD_CLOSED_ARROW,
            scale: 6,
            fillColor: '#f55757',
            fillOpacity: 0.95,
            strokeColor: '#ffffff',
            strokeWeight: 1.5,
            rotation: flightHeading,
          },
          title: flightCallsign || t('app.flightPosition'),
          zIndex: 330,
        });
        combinedBounds.extend(flightCoords);
      }

      const routePoints = decodeGooglePolyline(job?.extRoutePolyline || '');
      const approachPoints = decodeGooglePolyline(job?.extDriverToPickupPolyline || '');

      if (approachPoints.length >= 2) {
        const approachLine = new window.trisarKarte.Polyline({
          path: approachPoints,
          geodesic: true,
          strokeColor: '#E3F654',
          strokeOpacity: 0.95,
          strokeWeight: 5,
          map,
          zIndex: 301,
        });
        approachLine.getPath().forEach((p) => combinedBounds.extend(p));
        const approachDurationMins = job?.extDriverToPickupDurationInTrafficMins || job?.extDriverToPickupDurationMins || 0;
        if (approachDurationMins > 0) {
          new window.trisarKarte.InfoWindow({
            content: `<div class="custom-map-label" style="background: #E3F654; color: #111111"><span>${formatDuration(approachDurationMins)}</span></div>`,
            position: approachPoints[Math.floor(approachPoints.length / 2)],
            disableAutoPan: true,
          }).open(map);
        }
      }

      if (routePoints.length >= 2) {
        const polyline = new window.trisarKarte.Polyline({
          path: routePoints,
          geodesic: true,
          strokeColor: '#0059FF',
          strokeOpacity: 0.9,
          strokeWeight: 6,
          map,
        });
        polyline.getPath().forEach((p) => combinedBounds.extend(p));
        new window.trisarKarte.Marker({ position: routePoints[0], map, icon: personPinIcon, zIndex: 320 });
        new window.trisarKarte.Marker({ position: routePoints[routePoints.length - 1], map, icon: flagIcon, zIndex: 320 });
        const durationMins = job?.extRouteDurationInTrafficMins || job?.extRouteDurationMins || 0;
        if (durationMins > 0) {
          new window.trisarKarte.InfoWindow({
            content: `<div class="custom-map-label" style="background: #0059FF"><span>${formatDuration(durationMins)}</span><div class="eco-dot"></div></div>`,
            position: routePoints[Math.floor(routePoints.length / 2)],
            disableAutoPan: true,
          }).open(map);
        }
      }

      if (!combinedBounds.isEmpty()) {
        map.fitBounds(combinedBounds, { top: 80, bottom: 250, left: 60, right: 60 });
      }
    };

    if (window.trisarKarte) initMap();
  }, [
    job?.extRoutePolyline,
    job?.extRouteDurationInTrafficMins,
    job?.extRouteDurationMins,
    job?.extDriverToPickupPolyline,
    job?.extDriverToPickupDurationInTrafficMins,
    job?.extDriverToPickupDurationMins,
    job?.driverLiveLat,
    job?.driverLiveLng,
    job?.flightLiveLat,
    job?.flightLiveLng,
    job?.flightLiveHeadingDeg,
    job?.flightCallsign,
    job?.flight,
    t,
  ]);

  return <div ref={mapRef} className="w-full h-full relative bg-slate-100" />;
};

const DetailsView = ({ job, setView, setActiveChat, currentDriverId, unreadGroupCount = 0, onOpenGroupChat, getChatReadBoundary }) => {
  const { t, locale } = useI18n();
  const [sheetHeight, setSheetHeight] = useState(60);
  const [isDragging, setIsDragging] = useState(false);
  const driveMins = job?.extRouteDurationInTrafficMins || job?.extRouteDurationMins || 0;
  const [selectedKolonneDriver, setSelectedKolonneDriver] = useState(null); // State für Fahrer-Modal
  const otherKolonneDrivers = (job?.kolonneDrivers || []).filter((driver) => driver.id !== currentDriverId);
  const selectedBadges = (job?.badges || []).filter((badge) => ['child_seat', 'accessibility', 'luggage', 'vip'].includes(badge));
  const tripLabel = job.flight && job.flight !== "STADTFAHRT" ? job.flight : t('app.cityRide');

  const startY = useRef(0);
  const startHeight = useRef(0);
  const handleDragStart = (e) => { setIsDragging(true); startY.current = e.touches ? e.touches[0].clientY : e.clientY; startHeight.current = sheetHeight; };
  const handleDragMove = (e) => { if (!isDragging) return; setSheetHeight(Math.min(Math.max(startHeight.current + ((startY.current - (e.touches ? e.touches[0].clientY : e.clientY)) / window.innerHeight) * 100, 25), 92)); };
  const handleDragEnd = () => { setIsDragging(false); if (sheetHeight > 80) setSheetHeight(90); else if (sheetHeight < 45) setSheetHeight(30); else setSheetHeight(60); };
  const calculatedEta = driveMins > 0 ? addMinutesToTime(job.etd, driveMins) : (job.etd || "--:--");

  return (
    <div className="flex flex-col h-screen bg-[#0a0a0a] max-w-md mx-auto relative overflow-hidden font-sans text-white" onMouseMove={handleDragMove} onMouseUp={handleDragEnd} onTouchMove={handleDragMove} onTouchEnd={handleDragEnd}>
      <div className="flex-1 relative">
        <GoogleMapComponent job={job} />
        <button onClick={() => setView('list')} className="absolute top-6 left-6 bg-white p-3 rounded-2xl shadow-xl active:scale-90 z-20 text-black">
          <ChevronLeft className="w-6 h-6" />
        </button>
      </div>
      
      <div className={`absolute bottom-0 left-0 right-0 bg-[#111111] rounded-t-[40px] shadow-[0_-10px_40px_rgba(0,0,0,0.5)] flex flex-col z-30 ${!isDragging ? 'transition-all duration-300 ease-out' : ''}`} style={{ height: `${sheetHeight}%` }}>
        <div className="w-full pt-4 pb-4 cursor-grab active:cursor-grabbing flex justify-center" onMouseDown={handleDragStart} onTouchStart={handleDragStart}><div className="w-20 h-1.5 bg-[#d4ff28] rounded-full"></div></div>
        <div className="px-8 pb-12 overflow-y-auto overscroll-none flex-1 custom-scrollbar">
          <div className="mb-6 rounded-2xl border border-slate-800 bg-[#161618] px-4 py-3 flex items-center justify-between">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{t('app.rideDay')}</div>
            <div className="text-sm font-black text-[#d4ff28]">{formatRideDayLabel(job.rideDate, t, locale)}</div>
          </div>
          
          {/* ETD / ETA */}
          <div className="flex justify-between items-start mb-10">
            <div>
              <div className="text-xs font-bold text-slate-400 uppercase tracking-tighter">ETD</div>
              <div className={`text-5xl font-black leading-none mt-1 ${getEtdColorClass(job)}`}>{job.etd}</div>
              {job.originalEtd && <div className="text-sm font-bold text-slate-500 line-through mt-2 tracking-tighter">{t('app.plan', { time: job.originalEtd })}</div>}
            </div>
            <div className="text-right">
              <div className="text-xs font-bold text-slate-400 uppercase tracking-tighter">ETA</div>
              <div className="text-5xl font-black text-[#d4ff28] leading-none mt-1">{calculatedEta}</div>
              {driveMins > 0 && <div className="text-sm font-bold text-white mt-2">{t('app.driveMins', { mins: driveMins })}</div>}
            </div>
          </div>

          {/* Route */}
          <div className="flex items-center justify-between mb-10">
            <div className="flex flex-col items-center w-[100px]">
              <div className="bg-[#222224] w-24 h-24 rounded-3xl flex items-center justify-center mb-3">
                {job.from.iconType === 'plane' ? <Plane size={48} strokeWidth={1} className="text-slate-400" /> : <Building2 size={48} strokeWidth={1} className="text-slate-400" />}
              </div>
              <div className="text-xs font-bold uppercase text-center leading-tight">{job.from.name}</div>
            </div>
            <ArrowRight className="w-8 h-8 text-[#d4ff28]" strokeWidth={2} />
            <div className="flex flex-col items-center w-[100px]">
              <div className="bg-[#222224] w-24 h-24 rounded-3xl flex items-center justify-center mb-3">
                {job.to.iconType === 'plane' ? <Plane size={48} strokeWidth={1} className="text-slate-400" /> : <Building2 size={48} strokeWidth={1} className="text-slate-400" />}
              </div>
              <div className="text-xs font-bold uppercase text-center leading-tight">{job.to.name}</div>
            </div>
          </div>

          {/* Flight Info & Badges */}
          <div className="flex items-end justify-between mb-8">
            <div className="flex flex-col min-w-0 flex-1 pr-3">
              <div className="text-4xl font-black tracking-tighter uppercase leading-none text-[#d4ff28] break-all">{tripLabel}</div>
              {job.flightOrigin && <div className="text-sm font-bold text-slate-500 mt-2">{t('app.fromOrigin', { origin: job.flightOrigin })}</div>}
            </div>
            {!!selectedBadges.length && (
              <div className="flex gap-2 shrink-0">
                {selectedBadges.includes('child_seat') && <div className="w-10 h-10 rounded-xl flex items-center justify-center border-2 border-[#d4ff28] text-[#d4ff28]"><Baby size={20} /></div>}
                {selectedBadges.includes('accessibility') && <div className="w-10 h-10 rounded-xl flex items-center justify-center border-2 border-[#d4ff28] text-[#d4ff28]"><Accessibility size={20} /></div>}
                {selectedBadges.includes('luggage') && <div className="w-10 h-10 rounded-xl flex items-center justify-center border-2 border-[#d4ff28] text-[#d4ff28]"><BaggageClaim size={20} /></div>}
                {selectedBadges.includes('vip') && <div className="w-10 h-10 rounded-xl flex items-center justify-center border-2 border-[#d4ff28] text-[#d4ff28]"><Star size={20} /></div>}
              </div>
            )}
          </div>

          {/* Kolonne (Convoy) Section */}
          {job.isKolonne && (
            <div className="space-y-6 mb-10">
              <div className="flex items-center justify-between">
                <h3 className="text-3xl font-black text-[#d4ff28] tracking-tighter uppercase italic">{t('app.convoy')}</h3>
                <button 
                  onClick={() => {
                    const chat = { id: job.convoyId || '', name: kolonnenNameKurz(job.kolonneName), type: 'group', backView: 'details', readBoundary: getChatReadBoundary ? getChatReadBoundary('group', job.convoyId) : null };
                    setActiveChat(chat);
                    if (onOpenGroupChat) onOpenGroupChat(chat.id);
                    setView('chat');
                  }}
                  className="relative bg-[#222224] text-[#d4ff28] border border-slate-700 hover:border-[#d4ff28] px-4 py-2 rounded-xl flex items-center gap-2 font-bold text-xs transition-colors active:scale-95"
                >
                  <MessageCircle size={16} /> {t('app.convoyChat')}
                  {unreadGroupCount > 0 && (
                    <span className="absolute -top-2 -right-2 min-w-5 h-5 px-1 rounded-full bg-[#d4ff28] text-black text-[10px] leading-5 text-center font-black">
                      {unreadGroupCount > 9 ? '9+' : unreadGroupCount}
                    </span>
                  )}
                </button>
              </div>
              
              {/* Kolonne Gäste */}
              <div className="bg-[#222224] p-5 rounded-[25px] border border-slate-700">
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-4">{t('app.allConvoyGuests')}</div>
                <div className="flex flex-wrap gap-2">
                  {job.kolonneGuests?.map((guest, i) => (
                    <span key={i} className="bg-[#111111] text-white text-xs px-4 py-2 rounded-full font-bold border border-slate-700 flex items-center gap-2">
                      <div className="w-1.5 h-1.5 bg-[#d4ff28] rounded-full"></div>{guest}
                    </span>
                  ))}
                </div>
              </div>

              {/* Kolonne Fahrer */}
              <div className="bg-[#222224] p-5 rounded-[25px] border border-slate-700">
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-4">{t('app.moreDriversAssignments')}</div>
                <div className="space-y-3">
                  {otherKolonneDrivers.map(driver => (
                    <div key={driver.id} onClick={() => setSelectedKolonneDriver(driver)} className="flex items-center justify-between bg-[#111111] p-4 rounded-2xl cursor-pointer hover:border-[#d4ff28] border border-slate-700 transition-colors">
                      <div className="flex items-center gap-4">
                        <img src={driver.image} className="w-12 h-12 rounded-full border-2 border-slate-600 object-cover shrink-0" alt={driver.name} />
                        <div className="flex flex-col justify-center">
                          <div className="text-sm font-black text-white">{driver.name}</div>
                          <div className="text-[10px] font-bold text-slate-400 flex items-center gap-1 mt-0.5"><Car size={10} /> {driver.car}</div>
                          <div className="text-[9px] font-bold text-slate-500 mt-1 leading-tight">
                            {t('app.guests')} <span className="text-[#d4ff28]">{driver.assignedGuests?.join(', ') || t('app.none')}</span>
                          </div>
                        </div>
                      </div>
                      <ArrowRight size={18} className="text-slate-500 shrink-0 ml-2" />
                    </div>
                  ))}
                  {otherKolonneDrivers.length === 0 && (
                    <div className="text-xs font-bold text-slate-500">{t('app.noMoreDrivers')}</div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Passenger Name (eigene Gäste) */}
          {!job.isKolonne && (
            <div className="mb-10 bg-[#222224] py-4 rounded-2xl">
              <div className="text-center text-sm font-bold text-white">
                {job.passengers?.join(', ') || t('app.noGuestsListed')}
              </div>
            </div>
          )}
          {job.isKolonne && (
             <div className="mb-10 bg-[#d4ff28] py-4 rounded-2xl text-black text-center font-black uppercase text-xs tracking-widest">
                {t('app.yourGuest', { guests: job.passengers?.join(', ') || 'TBA' })}
             </div>
          )}

          {/* Notiz */}
          <div className="space-y-6">
            <h3 className="text-5xl font-black text-[#d4ff28] tracking-tighter">{t('app.note')}</h3>
            <div className="mt-6 space-y-4">
              {job.notes?.length > 0 ? job.notes.map((note, idx) => ( 
                <div key={idx} className="pb-4">
                  <div className="text-[10px] text-slate-500 font-bold mb-1">{note.time}</div>
                  <div className="text-lg font-bold text-white leading-snug">{note.text}</div>
                </div> 
              )) : <p className="text-slate-500 text-sm font-bold">{t('app.noNotes')}</p>}
            </div>
          </div>

        </div>
      </div>

      {/* Driver Detail Modal */}
      {selectedKolonneDriver && (
        <div className="fixed inset-0 bg-black/90 backdrop-blur-sm z-[110] flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-[#161618] w-full max-w-sm rounded-[40px] p-8 shadow-2xl relative border border-[#222224] text-center">
            <button onClick={() => setSelectedKolonneDriver(null)} className="absolute top-6 right-6 p-2 text-slate-400 hover:text-white bg-[#222224] rounded-full active:scale-90">
              <X size={20} strokeWidth={3} />
            </button>
            <div className="relative inline-block mt-4 mb-4">
               <img src={selectedKolonneDriver.image} className="w-32 h-32 rounded-full border-[4px] border-[#d4ff28] object-cover mx-auto" alt={selectedKolonneDriver.name} />
               <div className="absolute bottom-0 right-0 bg-[#d4ff28] text-black p-2 rounded-full border-4 border-[#161618]">
                  <Car size={16} strokeWidth={3} />
               </div>
            </div>
            <h3 className="text-3xl font-black text-white leading-tight">{selectedKolonneDriver.name}</h3>
            <p className="text-xs font-bold text-slate-400 mt-1 uppercase tracking-widest">{selectedKolonneDriver.car}</p>

            <div className="bg-[#222224] p-3 rounded-2xl mt-5 border border-slate-700">
              <p className="text-[9px] uppercase tracking-widest text-slate-400 mb-1">{t('app.assignedGuests')}</p>
              <p className="text-sm font-bold text-[#d4ff28]">{selectedKolonneDriver.assignedGuests?.join(', ') || t('app.noAssignment')}</p>
            </div>

            <div className="flex gap-3 mt-8">
              <button onClick={() => {
                  setActiveChat({ id: selectedKolonneDriver.id, name: selectedKolonneDriver.name, type: 'individual', backView: 'details', readBoundary: getChatReadBoundary ? getChatReadBoundary('individual', selectedKolonneDriver.id) : null });
                  setView('chat');
                  setSelectedKolonneDriver(null);
              }} className="flex-1 flex items-center justify-center gap-2 bg-[#222224] text-[#d4ff28] border border-[#d4ff28] py-4 rounded-2xl font-black text-sm active:scale-95 transition-transform hover:bg-[#d4ff28] hover:text-black">
                <MessageCircle size={20} /> {t('app.chat')}
              </button>
              <a href={`tel:${selectedKolonneDriver.phone.replace(/\s+/g, '')}`} className="flex-1 flex items-center justify-center gap-2 bg-[#d4ff28] text-black py-4 rounded-2xl font-black text-sm active:scale-95 transition-transform">
                <Phone size={20} fill="currentColor" /> {t('app.call')}
              </a>
            </div>
          </div>
        </div>
      )}

      <style>{`.gm-style-iw { background: transparent !important; box-shadow: none !important; padding: 0 !important; border: none !important; } .gm-style-iw-d { overflow: visible !important; padding: 0 !important; } .gm-ui-hover-effect { display: none !important; } .gm-style-iw-t::after { display: none !important; } .custom-map-label { color: white; padding: 6px 12px; border-radius: 12px; font-family: sans-serif; font-weight: 800; font-size: 13px; display: flex; align-items: center; gap: 6px; box-shadow: 0 4px 12px rgba(0,0,0,0.25); white-space: nowrap; position: relative; } .eco-dot { width: 10px; height: 10px; background: #4ade80; border-radius: 50%; border: 2px solid white; } .custom-map-label::after { content: ''; position: absolute; bottom: -6px; left: 50%; transform: translateX(-50%); width: 0; height: 0; border-left: 7px solid transparent; border-right: 7px solid transparent; border-top: 7px solid currentColor; } .custom-scrollbar::-webkit-scrollbar { width: 0px; background: transparent; }`}</style>
    </div>
  );
};

// --- ALTE ListView-KOMPONENTE WURDE ENTFERNT ---
// Bitte nutzen Sie stattdessen FahrtenScreen01View
const ListView = null;

const PassengerListView = ({ setView, passengers }) => {
  const { t } = useI18n();
  const [searchTerm, setSearchTerm] = useState('');

  const filteredPassengers = (passengers || []).filter((p) => {
    const haystack = `${p.firstName || ''} ${p.lastName || ''} ${p.email || ''}`.toLowerCase();
    return haystack.includes(searchTerm.toLowerCase());
  });

  return (
    <div className="min-h-screen max-w-md mx-auto bg-black text-white relative overflow-hidden">
      <div className="absolute -top-10 -left-32 w-80 h-80 bg-[radial-gradient(circle,_rgba(212,255,40,0.36)_0%,_rgba(212,255,40,0)_70%)] pointer-events-none" />
      <div className="relative z-10 px-6 pt-10 pb-28">
        <button
          onClick={() => setView('list')}
          className="mt-8 mb-10 w-14 h-14 rounded-full border border-slate-600 text-slate-400 flex items-center justify-center active:scale-95"
        >
          <ChevronLeft size={28} />
        </button>

        <h1 className="text-6xl font-black tracking-tighter text-[#d4ff28] mb-8">{t('app.passengersTitle')}</h1>

        <button className="w-full h-20 border-2 border-[#d4ff28] text-[#d4ff28] px-7 text-left text-4xl font-bold mb-4 flex items-center justify-between">
          <span className="text-2xl">{t('app.importCustomers')}</span>
          <FileUp size={28} />
        </button>

        <div className="w-full h-20 border-2 border-[#d4ff28] text-[#d4ff28] px-7 text-left text-4xl font-bold mb-4 flex items-center justify-between">
          <input
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder={t('app.search')}
            className="bg-transparent w-full text-2xl font-medium placeholder:text-[#d4ff28] text-[#d4ff28] focus:outline-none"
          />
          <Search size={34} />
        </div>

        <button className="w-full h-20 bg-[#d4ff28] text-black px-7 text-left text-4xl font-bold mb-4 flex items-center justify-between">
          <span className="text-2xl flex items-center gap-3">
            <Users size={28} />
            {t('app.group')}
          </span>
          <ChevronDown size={32} />
        </button>

        <button
          onClick={() => setView('passengerCreate')}
          className="w-full h-20 bg-[#d4ff28] text-black px-7 text-left text-4xl font-bold mb-7 flex items-center justify-between"
        >
          <span className="text-2xl flex items-center gap-3">
            <UserRound size={28} />
            {t('app.createPassenger')}
          </span>
          <Plus size={30} />
        </button>

        <div className="bg-[#17181c] rounded-[26px] p-4 space-y-4">
          {filteredPassengers.length === 0 && (
            <div className="bg-[#f3f3f4] text-black rounded p-6 text-center font-bold">{t('app.noPassengersFound')}</div>
          )}
          {filteredPassengers.map((passenger) => (
            <div key={passenger.id} className="bg-[#f3f3f4] text-black p-5">
              <div className="text-[18px] text-slate-600 font-medium">{t('app.sportPrice')}</div>
              <div className="flex items-start justify-between mt-2">
                <div className="min-w-0">
                  <div className="text-[44px] leading-none font-black truncate">
                    {[passenger.firstName, passenger.lastName].filter(Boolean).join(' ') || t('app.unknown')}
                  </div>
                  <div className="text-2xl text-slate-500 mt-2 truncate">{passenger.email || '-'}</div>
                </div>
                <div className="flex items-center gap-3 ml-3">
                  <span className="text-4xl font-medium">{passenger.rides ?? 0}</span>
                  <Pencil size={28} />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

const PassengerCreateView = ({ setView, newPassenger, setNewPassenger, onCreatePassenger, isSavingPassenger }) => {
  const { t } = useI18n();
  const updateField = (field, value) => setNewPassenger((prev) => ({ ...prev, [field]: value }));
  const toggleField = (field) => setNewPassenger((prev) => ({ ...prev, [field]: !prev[field] }));
  const inputClass = "w-full h-20 bg-transparent border-2 border-[#d4ff28] px-6 text-[#d4ff28] text-[40px] leading-none font-medium placeholder:text-[#d4ff28]/60 focus:outline-none";

  return (
    <div className="min-h-screen max-w-md mx-auto bg-black text-white relative overflow-hidden">
      <div className="absolute -top-10 -left-32 w-80 h-80 bg-[radial-gradient(circle,_rgba(212,255,40,0.36)_0%,_rgba(212,255,40,0)_70%)] pointer-events-none" />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onCreatePassenger();
        }}
        className="relative z-10 px-6 pt-10 pb-10"
      >
        <button
          type="button"
          onClick={() => setView('passengers')}
          className="mt-8 mb-10 w-14 h-14 rounded-full border border-slate-600 text-slate-400 flex items-center justify-center active:scale-95"
        >
          <ChevronLeft size={28} />
        </button>

        <h1 className="text-[64px] leading-[0.95] font-black tracking-tighter text-[#d4ff28] mb-8">{t('app.createPassenger')}</h1>

        <div className="grid grid-cols-2 gap-3 mb-3">
          <input value={newPassenger.firstName} onChange={(e) => updateField('firstName', e.target.value)} placeholder={t('app.firstNamePh')} className={inputClass} />
          <input value={newPassenger.lastName} onChange={(e) => updateField('lastName', e.target.value)} placeholder={t('app.lastNamePh')} className={inputClass} />
        </div>

        <div className="relative mb-3">
          <input value={newPassenger.email} onChange={(e) => updateField('email', e.target.value)} placeholder={t('app.emailPh')} className={`${inputClass} pr-16`} />
          <Mail size={26} className="absolute right-6 top-1/2 -translate-y-1/2 text-[#d4ff28]" />
        </div>

        <div className="grid grid-cols-[92px_1fr] gap-3 mb-3">
          <input value={newPassenger.countryCode} onChange={(e) => updateField('countryCode', e.target.value)} placeholder="+49" className={inputClass} />
          <input value={newPassenger.phone} onChange={(e) => updateField('phone', e.target.value)} placeholder={t('app.phonePh')} className={inputClass} />
        </div>

        <div className="grid grid-cols-[1fr_86px] gap-3 mb-3">
          <input value={newPassenger.street} onChange={(e) => updateField('street', e.target.value)} placeholder={t('app.streetPh')} className={inputClass} />
          <input value={newPassenger.streetNumber} onChange={(e) => updateField('streetNumber', e.target.value)} placeholder={t('app.streetNoPh')} className={inputClass} />
        </div>

        <div className="mb-3">
          <input value={newPassenger.city} onChange={(e) => updateField('city', e.target.value)} placeholder={t('app.cityPh')} className={inputClass} />
        </div>

        <div className="grid grid-cols-2 gap-3 mb-4">
          <input value={newPassenger.zip} onChange={(e) => updateField('zip', e.target.value)} placeholder={t('app.zipPh')} className={inputClass} />
          <button type="button" className={`${inputClass} flex items-center justify-between`}>
            <span>{newPassenger.language || 'Deutsch'}</span>
            <ChevronDown size={30} />
          </button>
        </div>

        <div className="grid grid-cols-4 gap-3 mb-5">
          <button type="button" onClick={() => toggleField('vip')} className={`h-16 rounded-xl border-2 flex items-center justify-center ${newPassenger.vip ? 'border-[#d4ff28] text-[#d4ff28]' : 'border-[#8ea23c] text-[#8ea23c]'}`}><Star size={30} /></button>
          <button type="button" onClick={() => toggleField('accessibility')} className={`h-16 rounded-xl border-2 flex items-center justify-center ${newPassenger.accessibility ? 'border-[#d4ff28] text-[#d4ff28]' : 'border-[#8ea23c] text-[#8ea23c]'}`}><Accessibility size={30} /></button>
          <button type="button" onClick={() => toggleField('childSeat')} className={`h-16 rounded-xl border-2 flex items-center justify-center ${newPassenger.childSeat ? 'border-[#d4ff28] text-[#d4ff28]' : 'border-[#8ea23c] text-[#8ea23c]'}`}><Baby size={30} /></button>
          <button type="button" onClick={() => toggleField('childSeat2')} className={`h-16 rounded-xl border-2 flex items-center justify-center ${newPassenger.childSeat2 ? 'border-[#d4ff28] text-[#d4ff28]' : 'border-[#8ea23c] text-[#8ea23c]'}`}><Baby size={30} /></button>
        </div>

        <div className="bg-[#17181c] rounded-[26px] p-4 mb-6">
          <div className="bg-[#f3f3f4] text-black p-5 min-h-[220px]">
            <div className="flex items-center justify-between">
              <span className="text-[20px] font-black">{t('app.notes')}</span>
              <Pencil size={24} />
            </div>
            <textarea
              value={newPassenger.notes}
              onChange={(e) => updateField('notes', e.target.value)}
              placeholder={t('app.writePh')}
              className="w-full mt-4 bg-transparent text-2xl text-slate-500 placeholder:text-slate-400 focus:outline-none resize-none min-h-[130px]"
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={isSavingPassenger}
          className="w-full h-20 bg-[#d4ff28] text-black px-7 text-left text-4xl font-bold mb-10 flex items-center justify-between disabled:opacity-60"
        >
          <span className="text-2xl">{isSavingPassenger ? t('app.saving') : t('app.createPassenger')}</span>
          <ArrowRight size={32} />
        </button>

        <TrisarFooter className="relative w-full h-10 bg-black" />
      </form>
    </div>
  );
};

// --- MAIN APP ---
const FahrerApp = () => {
  const [viewStack, setViewStack] = useState([{ id: 0, view: 'list' }]);
  const viewEntryIdRef = useRef(1);
  const view = viewStack[viewStack.length - 1]?.view || 'list';
  const setView = useCallback((nextView) => {
    if (!nextView || typeof nextView !== 'string') return;
    setViewStack((prev) => {
      if (!prev.length) return [{ id: viewEntryIdRef.current++, view: nextView }];
      const currentView = prev[prev.length - 1]?.view;
      if (nextView === currentView) return prev;

      // Zurück zum direkt vorherigen Screen => echten Pop (State/Scroll bleibt erhalten)
      if (prev.length > 1 && prev[prev.length - 2]?.view === nextView) {
        return prev.slice(0, -1);
      }

      // "Zur Liste" springt auf die bereits gemountete List-Instanz
      if (nextView === 'list') {
        const rootListIndex = prev.findIndex((entry) => entry.view === 'list');
        if (rootListIndex >= 0) return prev.slice(0, rootListIndex + 1);
      }

      return [...prev, { id: viewEntryIdRef.current++, view: nextView }];
    });
  }, []);
  const [selectedJob, setSelectedJob] = useState(null);
  const [_showAddModal, setShowAddModal] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [session, setSession] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [authError, setAuthError] = useState('');
  const [currentDriverName, setCurrentDriverName] = useState('');
  const [currentDriverProfile, setCurrentDriverProfile] = useState(null);
  const [currentVehicle, setCurrentVehicle] = useState(null);
  const [vehicleDamages, setVehicleDamages] = useState([]);
  const [_passengers, setPassengers] = useState([]);
  const [_isSavingPassenger, setIsSavingPassenger] = useState(false);
  const [newPassenger, setNewPassenger] = useState({
    firstName: '',
    lastName: '',
    email: '',
    countryCode: '+49',
    phone: '',
    street: '',
    streetNumber: '',
    city: '',
    zip: '',
    language: 'Deutsch',
    vip: false,
    accessibility: false,
    childSeat: false,
    childSeat2: false,
    notes: '',
  });

  // i18n: FahrerApp rendert den I18nProvider selbst, daher t/locale hier
  // direkt aus dem Profil ableiten (gleiche Logik wie im Provider).
  const langCode = LANGUAGE_TO_CODE[currentDriverProfile?.language] || 'de';
  const t = useCallback((key, vars) => translate(langCode, key, vars), [langCode]);
  const locale = CODE_TO_LOCALE[langCode] || 'de-DE';

  // CHAT STATE
  const [activeChat, setActiveChat] = useState(null);
  const [unreadByChat, setUnreadByChat] = useState({});
  const [chatLastByChat, setChatLastByChat] = useState({});
  const [messages, setMessages] = useState({
    'kolonne-1': [
      { id: 1, sender: 'Ali Yilmaz', text: 'Hey Team, ich stehe schon am Terminal 1 und warte auf meine Gäste.', time: '13:20' },
      { id: 2, sender: 'Sarah Connor', text: 'Bin noch ca. 10 Minuten entfernt. Verkehr staut sich etwas.', time: '13:22' }
    ],
    'driver-d2': [
      { id: 1, sender: 'Ali Yilmaz', text: 'Hast du das VIP-Schild für die Delegation dabei?', time: '09:00' },
      { id: 2, sender: 'me', text: 'Ja, liegt im Kofferraum. Bringe ich dir gleich rüber.', time: '09:05' }
    ]
  });

  const [jobs, setJobs] = useState([]);
  const [serviceRequests, setServiceRequests] = useState([]);
  const [serviceRequestActionBusyId, setServiceRequestActionBusyId] = useState(null);
  const [newJob, setNewJob] = useState({
    tripType: 'airport',
    from: '',
    to: '',
    flight: '',
    rideDate: toLocalDateValue(),
    etd: '20:30',
    originalEtd: '',
    flightOrigin: '',
    passengers: [],
    note: '',
    waitingTime: 30,
    vip: false,
    accessibility: false,
    child_seat: false,
    isKolonne: false,
    kolonneName: '',
    kolonneGuests: [],
    kolonneDrivers: []
  });
  const [_predictions, setPredictions] = useState({ from: [], to: [] });
  const [_activeField, setActiveField] = useState(null);
  const predictionRequestRef = useRef(null);
  const jobsRef = useRef([]);
  // Nachladefunktion aus dem Lade-Effekt, damit das Demo-Tutorial nach
  // Datenaenderungen frisch laden kann (Realtime ist in der Demo ein No-op).
  const fetchProfileAndJobsRef = useRef(null);

  // Demo-Tutorial (siehe demo/TutorialBridge): der Rahmen stellt beim Betreten
  // eines Schritts den App-Zustand her. Jeder Schritt beginnt sauber von vorn.
  //   ansicht  eine Ansicht ('list', 'vehicle', 'profilFahrer', ...)
  //   stapel   mehrere Ansichten uebereinander, z. B. ['profilFahrer', 'verlauf']
  //   jobId    Fahrt fuer 'details' / 'kolonnenChat' auswaehlen
  //   patches  [{ table, id, set }] — Demo-Daten zuruecksetzen (z. B. Fahrt wieder offen),
  //            danach wird alles neu geladen
  const tutorialLaufRef = useRef(0);
  useEffect(() => {
    const warten = (ms) => new Promise((r) => setTimeout(r, ms));
    const anZustand = async (e) => {
      const z = e?.detail || {};
      const lauf = ++tutorialLaufRef.current;
      if (Array.isArray(z.patches) && z.patches.length) {
        for (const patch of z.patches) {
          // eslint-disable-next-line no-await-in-loop
          await supabase.from(patch.table).update(patch.set).eq('id', patch.id);
        }
        await fetchProfileAndJobsRef.current?.();
      }
      if (lauf !== tutorialLaufRef.current) return;
      if (typeof z.jobId === 'string' && z.jobId) {
        let job = null;
        for (let i = 0; i < 20 && !job; i += 1) {
          job = (jobsRef.current || []).find((j) => j.id === z.jobId) || null;
          // eslint-disable-next-line no-await-in-loop
          if (!job) await warten(100);
        }
        if (lauf !== tutorialLaufRef.current) return;
        if (job) setSelectedJob({ ...job, __openToken: `${Date.now()}` });
      }
      // Ohne ausdrueckliche Ansicht bleibt die aktuelle stehen: das Tutorial
      // navigiert mit dem Cursor und schickt hier nur noch Datenkorrekturen
      // (patches). Frueher wurde dabei stillschweigend auf die Liste gesprungen.
      const ansichten = Array.isArray(z.stapel)
        ? z.stapel
        : (typeof z.ansicht === 'string' && z.ansicht ? [z.ansicht] : null);
      if (!ansichten) return;
      const oben = ansichten.filter((v) => v && v !== 'list');
      // Die Listen-Instanz bleibt erhalten (kein Neuaufbau, kein schwarzes
      // Aufblitzen); nur die Ansichten darueber werden frisch aufgebaut.
      setViewStack((prev) => {
        const wurzel = prev.find((e) => e.view === 'list') || { id: viewEntryIdRef.current++, view: 'list' };
        return [wurzel, ...oben.map((view) => ({ id: viewEntryIdRef.current++, view }))];
      });
    };
    window.addEventListener('trisar:tutorial-zustand', anZustand);
    return () => window.removeEventListener('trisar:tutorial-zustand', anZustand);
  }, []);

  // "support" in der Fussleiste fuehrt auf die Supportseite. Von wo aus, merkt
  // sich die App — der Zurueck-Pfeil dort geht wieder genau dahin.
  const [supportZurueck, setSupportZurueck] = useState('list');
  const ansichtRef = useRef('list');
  ansichtRef.current = view;
  useEffect(() => {
    const anSupport = () => {
      if (ansichtRef.current === 'supportFooter') return;
      setSupportZurueck(ansichtRef.current || 'list');
      setView('supportFooter');
    };
    window.addEventListener('trisar:support-oeffnen', anSupport);
    return () => window.removeEventListener('trisar:support-oeffnen', anSupport);
  }, [setView]);

  const selectedJobRef = useRef(null);
  const geoWatchIdRef = useRef(null);
  const lastLiveUpsertAtRef = useRef(0);
  const lastHistoryInsertAtRef = useRef(0);
  const pickupProgressRef = useRef(new Map());
  const statusTransitionLockRef = useRef(new Set());
  const geocodeCacheRef = useRef(new Map());
  const geocodeInFlightRef = useRef(new Map());
  const geocoderRef = useRef(null);

  const resolveActiveJob = useCallback((jobList) => {
    const candidates = (Array.isArray(jobList) ? jobList : [])
      .filter((job) => LIVE_ACTIVE_STATUSES.has(normalizeStatus(job?.status)));
    if (!candidates.length) return null;
    const selectedJobId = String(selectedJobRef.current?.id || '').trim();
    if (selectedJobId) {
      const selectedCandidate = candidates.find((job) => String(job?.id || '').trim() === selectedJobId);
      if (selectedCandidate) return selectedCandidate;
    }
    candidates.sort(compareLiveJobs);
    return candidates[0] || null;
  }, []);

  const geocodeWithMapsSdk = useCallback((query) => new Promise((resolve) => {
    // Die MapLibre-Kartenschicht kennt keine Adresssuche. Die Demo-Daten
    // bringen ihre Koordinaten mit, der Zweig bleibt nur als Anker stehen.
    const Geocoder = window?.trisarKarte?.Geocoder;
    if (!Geocoder) {
      resolve(null);
      return;
    }

    if (!geocoderRef.current) geocoderRef.current = new Geocoder();
    geocoderRef.current.geocode({ address: query, language: 'de' }, (results, status) => {
      if (status !== 'OK' || !Array.isArray(results) || !results[0]?.geometry?.location) {
        resolve(null);
        return;
      }

      const location = results[0].geometry.location;
      const lat = typeof location.lat === 'function' ? location.lat() : location.lat;
      const lng = typeof location.lng === 'function' ? location.lng() : location.lng;
      resolve(toFiniteCoord({ lat, lng }));
    });
  }), []);

  const geocodeAddressQuery = useCallback(async (rawQuery) => {
    const query = String(rawQuery || '').trim();
    if (!query) return null;

    const cacheKey = query.toLowerCase();
    if (geocodeCacheRef.current.has(cacheKey)) {
      return geocodeCacheRef.current.get(cacheKey) || null;
    }
    if (geocodeInFlightRef.current.has(cacheKey)) {
      return geocodeInFlightRef.current.get(cacheKey);
    }

    const requestPromise = (async () => {
      try {
        const resolved = await geocodeWithMapsSdk(query);
        geocodeCacheRef.current.set(cacheKey, resolved || null);
        return resolved;
      } catch {
        geocodeCacheRef.current.set(cacheKey, null);
        return null;
      } finally {
        geocodeInFlightRef.current.delete(cacheKey);
      }
    })();

    geocodeInFlightRef.current.set(cacheKey, requestPromise);
    return requestPromise;
  }, [geocodeWithMapsSdk]);

  const resolveJobEndpoints = useCallback(async (job) => {
    const resolvedFromPolyline = getRouteEndpointsFromJob(job);
    let pickup = resolvedFromPolyline.pickup;
    let dropoff = resolvedFromPolyline.dropoff;

    if (!pickup) {
      pickup = await geocodeAddressQuery(getPickupAddressQueryFromJob(job));
    }
    if (!dropoff) {
      dropoff = await geocodeAddressQuery(getDropoffAddressQueryFromJob(job));
    }

    return { pickup, dropoff };
  }, [geocodeAddressQuery]);

  const updateLocalJobStatus = useCallback((jobId, nextStatus) => {
    if (!jobId) return;
    setJobs((prev) =>
      (prev || []).map((job) => (
        job.id === jobId ? { ...job, status: nextStatus } : job
      )),
    );
    setSelectedJob((prev) => {
      if (!prev || prev.id !== jobId) return prev;
      return { ...prev, status: nextStatus };
    });
  }, []);

  const syncLocalDriverCoords = useCallback((lat, lng, capturedAt, source = null) => {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    setJobs((prev) =>
      (prev || []).map((job) => ({
        ...job,
        driverLiveLat: lat,
        driverLiveLng: lng,
        driverLiveCapturedAt: capturedAt,
        driverLiveSource: source || job?.driverLiveSource || null,
      })),
    );
    setSelectedJob((prev) => (
      prev
        ? {
            ...prev,
            driverLiveLat: lat,
            driverLiveLng: lng,
            driverLiveCapturedAt: capturedAt,
            driverLiveSource: source || prev?.driverLiveSource || null,
          }
        : prev
    ));
  }, []);

  const transitionJobStatus = useCallback(async (jobId, fromStatuses, toStatus) => {
    const normalizedJobId = String(jobId || '').trim();
    if (!normalizedJobId || !toStatus) return false;
    const lockKey = `${normalizedJobId}:${toStatus}`;
    if (statusTransitionLockRef.current.has(lockKey)) return false;

    statusTransitionLockRef.current.add(lockKey);
    try {
      let query = supabase.from('jobs').update({ status: toStatus }).eq('id', normalizedJobId);
      if (Array.isArray(fromStatuses)) query = query.in('status', fromStatuses);
      if (!Array.isArray(fromStatuses) && fromStatuses) query = query.eq('status', fromStatuses);
      const { data, error } = await query.select('id,status').maybeSingle();
      if (error) throw error;
      if (data?.id) {
        updateLocalJobStatus(normalizedJobId, data.status || toStatus);
        return true;
      }

      // Fallback: some environments store legacy/custom status labels
      // (e.g. "Offen"/"Unterwegs"), so the guarded equality check may miss.
      const { data: retryData, error: retryError } = await supabase
        .from('jobs')
        .update({ status: toStatus })
        .eq('id', normalizedJobId)
        .select('id,status')
        .maybeSingle();
      if (retryError) throw retryError;
      if (!retryData?.id) return false;
      updateLocalJobStatus(normalizedJobId, retryData.status || toStatus);
      return true;
    } catch (error) {
      console.error('Auto-Statuswechsel fehlgeschlagen:', error);
      return false;
    } finally {
      statusTransitionLockRef.current.delete(lockKey);
    }
  }, [updateLocalJobStatus]);

  const _applyAutoStatusForLocation = useCallback(async (point) => {
    if (!CLIENT_AUTO_STATUS_TRANSITIONS_ENABLED) return;
    const currentPoint = toFiniteCoord(point);
    if (!currentPoint) return;
    const speedMps = Number(point?.speed_mps ?? point?.speedMps);
    const speedKmh = Number.isFinite(speedMps) ? speedMps * 3.6 : null;

    const activeJob = resolveActiveJob(jobsRef.current);
    const jobId = String(activeJob?.id || '').trim();
    if (!jobId) return;

    const status = normalizeStatus(activeJob?.status);
    if (!LIVE_ACTIVE_STATUSES.has(status)) {
      pickupProgressRef.current.delete(jobId);
      return;
    }

    const endpoints = await resolveJobEndpoints(activeJob);
    const pickupDistanceM = haversineMeters(currentPoint, endpoints.pickup);
    const dropoffDistanceM = haversineMeters(currentPoint, endpoints.dropoff);

    if (OPEN_JOB_STATUSES.has(status)) {
      if (Number.isFinite(pickupDistanceM) && pickupDistanceM <= AUTO_START_PICKUP_ENTER_RADIUS_M) {
        await transitionJobStatus(jobId, Array.from(OPEN_JOB_STATUSES), 'at_pickup');
      }
      return;
    }

    if (AT_PICKUP_JOB_STATUSES.has(status)) {
      const progress = pickupProgressRef.current.get(jobId) || { pickupEntered: true };
      progress.pickupEntered = true;
      const previousPickupDistance = Number(progress.lastPickupDistanceM);
      const previousDropoffDistance = Number(progress.lastDropoffDistanceM);
      progress.lastPickupDistanceM = Number.isFinite(pickupDistanceM) ? pickupDistanceM : progress.lastPickupDistanceM;
      progress.lastDropoffDistanceM = Number.isFinite(dropoffDistanceM) ? dropoffDistanceM : progress.lastDropoffDistanceM;
      pickupProgressRef.current.set(jobId, progress);

      if (Number.isFinite(pickupDistanceM) && pickupDistanceM >= AUTO_START_PICKUP_EXIT_RADIUS_M) {
        const started = await transitionJobStatus(jobId, Array.from(AT_PICKUP_JOB_STATUSES), 'in_progress');
        if (started) pickupProgressRef.current.delete(jobId);
        return;
      }

      const isMovingAwayFromPickup = Number.isFinite(pickupDistanceM) && pickupDistanceM >= Math.max(120, AUTO_START_PICKUP_ENTER_RADIUS_M * 0.6);
      const isApproachingDropoff = Number.isFinite(dropoffDistanceM)
        && Number.isFinite(previousDropoffDistance)
        && (dropoffDistanceM + 25 < previousDropoffDistance);
      const pickupDistanceIncreasing = Number.isFinite(pickupDistanceM)
        && Number.isFinite(previousPickupDistance)
        && (pickupDistanceM >= previousPickupDistance + 25);
      const movedIntoRouteDirection = Number.isFinite(pickupDistanceM)
        && Number.isFinite(dropoffDistanceM)
        && pickupDistanceM > dropoffDistanceM;
      const isDriving = Number.isFinite(speedKmh) && speedKmh >= 8;
      if (
        (isMovingAwayFromPickup && isApproachingDropoff && isDriving)
        || (pickupDistanceIncreasing && isApproachingDropoff)
        || (isMovingAwayFromPickup && movedIntoRouteDirection)
      ) {
        const started = await transitionJobStatus(jobId, Array.from(AT_PICKUP_JOB_STATUSES), 'in_progress');
        if (started) pickupProgressRef.current.delete(jobId);
      }
      return;
    }

    if (IN_PROGRESS_JOB_STATUSES.has(status)) {
      if (Number.isFinite(dropoffDistanceM) && dropoffDistanceM <= AUTO_DONE_DROPOFF_RADIUS_M) {
        const done = await transitionJobStatus(jobId, Array.from(IN_PROGRESS_JOB_STATUSES), 'done');
        if (done) pickupProgressRef.current.delete(jobId);
      }
      return;
    }

    pickupProgressRef.current.delete(jobId);
  }, [resolveActiveJob, resolveJobEndpoints, transitionJobStatus]);

  const _persistDriverLocation = useCallback(async ({ position, source = 'driver_app_live', forceWrite = false } = {}) => {
    const driverId = session?.user?.id;
    if (!driverId || !position?.coords) return null;

    const lat = Number(position.coords.latitude);
    const lng = Number(position.coords.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

    const activeJob = resolveActiveJob(jobsRef.current);
    const activeJobId = isUuid(activeJob?.id) ? activeJob.id : null;
    const capturedAt = new Date().toISOString();
    const locationPayload = {
      driver_id: driverId,
      active_job_id: activeJobId,
      lat,
      lng,
      accuracy_m: position.coords.accuracy || null,
      speed_mps: position.coords.speed || null,
      heading_deg: position.coords.heading || null,
      source,
      captured_at: capturedAt,
    };

    syncLocalDriverCoords(lat, lng, capturedAt, source);
    const now = Date.now();
    const shouldWriteLive = forceWrite || (now - lastLiveUpsertAtRef.current >= LIVE_LOCATION_UPSERT_INTERVAL_MS);
    const shouldWriteHistory = forceWrite || (now - lastHistoryInsertAtRef.current >= LIVE_LOCATION_HISTORY_INTERVAL_MS);
    const isMissingHistoryTable = (error) => {
      const message = `${error?.message || ''} ${error?.details || ''} ${error?.hint || ''}`.toLowerCase();
      return message.includes('driver_location_history') && message.includes('does not exist');
    };

    try {
      if (shouldWriteLive) {
        const { error } = await supabase.from('driver_live_locations').upsert([locationPayload], { onConflict: 'driver_id' });
        if (error) throw error;
        lastLiveUpsertAtRef.current = now;
      }

      if (shouldWriteHistory) {
        const { error } = await supabase.from('driver_location_history').insert([
          {
            driver_id: driverId,
            job_id: activeJobId,
            lat,
            lng,
            accuracy_m: locationPayload.accuracy_m,
            speed_mps: locationPayload.speed_mps,
            heading_deg: locationPayload.heading_deg,
            source,
            captured_at: capturedAt,
          },
        ]);
        if (error && !isMissingHistoryTable(error)) throw error;
        lastHistoryInsertAtRef.current = now;
      }
    } catch (error) {
      console.error('Standort konnte nicht gespeichert werden:', error);
    }

    return locationPayload;
  }, [resolveActiveJob, session?.user?.id, syncLocalDriverCoords]);

  const refreshJobLiveFlightData = useCallback(async (jobId) => {
    const normalizedJobId = String(jobId || '').trim();
    if (!isUuid(normalizedJobId)) return;
    try {
      const { data: dbJob, error } = await supabase
        .from('jobs')
        .select('id,flight_number,etd,original_etd,flight_origin,ext_last_enriched_at,ext_last_error,ext_flight_payload')
        .eq('id', normalizedJobId)
        .maybeSingle();
      if (error || !dbJob) return;

      const flightLive = extractFlightLiveTracking(dbJob.ext_flight_payload);
      const flightSummary = extractFlightSummary(dbJob.ext_flight_payload);
      const normalizedFlightNumber = String(dbJob?.flight_number || selectedJobRef.current?.flight || '').trim().toUpperCase();
      const patch = {
        etd: dbJob.etd ? dbJob.etd.substring(0, 5) : '12:00',
        originalEtd: dbJob.original_etd ? dbJob.original_etd.substring(0, 5) : null,
        flightOrigin: dbJob.flight_origin || flightSummary?.departureAirport || null,
        extLastEnrichedAt: dbJob.ext_last_enriched_at || null,
        flightLiveMode: flightLive?.mode || null,
        flightRadarHex: flightLive?.radarHex || null,
        flightCallsign: flightLive?.callsign || null,
        flightLiveLat: Number.isFinite(flightLive?.lat) ? flightLive.lat : null,
        flightLiveLng: Number.isFinite(flightLive?.lng) ? flightLive.lng : null,
        flightLiveHeadingDeg: Number.isFinite(flightLive?.heading) ? flightLive.heading : null,
        flightLiveCapturedAt: flightLive?.capturedAt || null,
        flightLiveOnGround: typeof flightLive?.onGround === 'boolean' ? flightLive.onGround : null,
        flightLiveSecondaryEtaIso: flightLive?.secondaryEtaIso || null,
        flightLiveSecondaryEtaMins: Number.isFinite(flightLive?.secondaryEtaMinutes)
          ? flightLive.secondaryEtaMinutes
          : null,
        flightLiveTrail: Array.isArray(flightLive?.trail) ? flightLive.trail : [],
        flightLiveRouteStops: Array.isArray(flightLive?.routeStops) ? flightLive.routeStops : [],
        flightStatusCode: flightSummary?.statusCode || null,
        flightStatusDescription: flightSummary?.statusDescription || null,
        flightEstimatedArrivalIso: flightSummary?.estimatedArrivalIso || null,
        flightActualArrivalIso: flightSummary?.actualArrivalIso || null,
        flightScheduledArrivalIso: flightSummary?.scheduledArrivalIso || null,
        extLastError: String(dbJob.ext_last_error || '').trim() || null,
      };

      setJobs((prev) => (prev || []).map((job) => (job?.id === normalizedJobId ? { ...job, ...patch } : job)));
      setSelectedJob((prev) => (prev?.id === normalizedJobId ? { ...prev, ...patch } : prev));
      logOpenSkyDebug('job live payload', {
        jobId: normalizedJobId,
        flightNumber: normalizedFlightNumber || null,
        extLastError: patch.extLastError,
        liveLastError: flightLive?.lastError || null,
        liveLastErrorAt: flightLive?.lastErrorAt || null,
        radarHex: patch.flightRadarHex,
        callsign: patch.flightCallsign,
        liveLat: patch.flightLiveLat,
        liveLng: patch.flightLiveLng,
        capturedAt: patch.flightLiveCapturedAt,
        summaryStatus: patch.flightStatusCode,
      });
    } catch (error) {
      console.warn('Live-Flugdaten konnten nicht direkt aktualisiert werden:', error?.message || error);
    }
  }, []);

  useEffect(() => {
    jobsRef.current = jobs || [];
    const activeJobIds = new Set((jobs || []).map((job) => String(job?.id || '')));
    Array.from(pickupProgressRef.current.keys()).forEach((jobId) => {
      if (!activeJobIds.has(jobId)) pickupProgressRef.current.delete(jobId);
    });
  }, [jobs]);

  useEffect(() => {
    selectedJobRef.current = selectedJob || null;
  }, [selectedJob]);

  useEffect(() => {
    const selectedJobId = String(selectedJob?.id || '').trim();
    const fallbackDriverId = String(selectedJob?.driverId || selectedJob?.driver_id || '').trim();
    const requestedBy = isUuid(session?.user?.id) ? session.user.id : (isUuid(fallbackDriverId) ? fallbackDriverId : null);
    if (!isUuid(selectedJobId) || view !== 'details') return undefined;

    let cancelled = false;
    const syncLiveRoute = async () => {
      if (cancelled) return;
      if (document.visibilityState !== 'visible') {
        logOpenSkyDebug('sync skipped (tab hidden)', { reason: 'live_view', jobId: selectedJobId });
        return;
      }
      const latestJob = selectedJobRef.current;
      const latestJobId = String(latestJob?.id || '').trim();
      if (!latestJobId || latestJobId !== selectedJobId) {
        logOpenSkyDebug('sync skipped (job mismatch)', {
          reason: 'live_view',
          selectedJobId,
          latestJobId: latestJobId || null,
        });
        return;
      }
      if (!hasSyncableFlightOnJob(latestJob)) {
        logOpenSkyDebug('sync skipped (no active flight)', {
          reason: 'live_view',
          jobId: selectedJobId,
          flight: String(latestJob?.flight || '').trim().toUpperCase() || null,
        });
        return;
      }
      const lastError = String(latestJob?.extLastError || '').toLowerCase();
      const hasOpenSky429 = lastError.includes('opensky_states_http_429');
      const lastEnrichedAtMs = Date.parse(String(latestJob?.extLastEnrichedAt || ''));
      if (
        hasOpenSky429
        && Number.isFinite(lastEnrichedAtMs)
        && (Date.now() - lastEnrichedAtMs) < OPENSKY_429_CLIENT_BACKOFF_MS
      ) {
        logOpenSkyDebug('sync skipped (client 429 backoff)', {
          reason: 'live_view',
          jobId: selectedJobId,
          flight: String(latestJob?.flight || '').trim().toUpperCase() || null,
          extLastError: latestJob?.extLastError || null,
          extLastEnrichedAt: latestJob?.extLastEnrichedAt || null,
          backoffMs: OPENSKY_429_CLIENT_BACKOFF_MS,
        });
        return;
      }
      const lat = Number(latestJob?.driverLiveLat);
      const lng = Number(latestJob?.driverLiveLng);
      const currentLocation = isLikelyValidLatLng(lat, lng) ? { lat, lng } : null;
      try {
        logOpenSkyDebug('sync request', {
          reason: 'live_view',
          jobId: selectedJobId,
          flight: String(latestJob?.flight || '').trim().toUpperCase() || null,
          currentLocation,
        });
        await invokeExternalSync({
          reason: 'live_view',
          jobIds: [selectedJobId],
          requestedBy,
          currentLocation,
        });
        await refreshJobLiveFlightData(selectedJobId);
      } catch (error) {
        console.warn('Live-Route-Sync (Detailsansicht) fehlgeschlagen:', error?.message || error);
      }
    };

    // Manual-only mode: keep one sync on explicit details entry.
    syncLiveRoute();
    // Auto/background refresh disabled to reduce Google API usage:
    // const intervalId = window.setInterval(syncLiveRoute, LIVE_VIEW_SYNC_INTERVAL_MS);
    // const visibilityHandler = () => {
    //   if (document.visibilityState === 'visible') syncLiveRoute();
    // };
    // document.addEventListener('visibilitychange', visibilityHandler);
    return () => {
      cancelled = true;
      // if (intervalId) window.clearInterval(intervalId);
      // document.removeEventListener('visibilitychange', visibilityHandler);
    };
  }, [refreshJobLiveFlightData, session?.user?.id, selectedJob?.id, view]);

  useEffect(() => {
    if (session?.user?.id) return;
    pickupProgressRef.current.clear();
    statusTransitionLockRef.current.clear();
    geocodeCacheRef.current.clear();
    geocodeInFlightRef.current.clear();
    geocoderRef.current = null;
    lastLiveUpsertAtRef.current = 0;
    lastHistoryInsertAtRef.current = 0;
  }, [session?.user?.id]);

  const getLastReadKey = (userId, chatType, chatId) => `trisar-last-read-${userId}-${chatType}-${chatId}`;
  const getLastReadValue = (chatType, chatId) => {
    const userId = session?.user?.id;
    if (!userId || !chatId) return null;
    return localStorage.getItem(getLastReadKey(userId, chatType, chatId));
  };
  const availableChats = useMemo(() => {
    const ownId = session?.user?.id;
    const map = new Map();
    (jobs || []).forEach((job) => {
      if (job?.isKolonne && job?.convoyId) {
        map.set(`group:${job.convoyId}`, { id: job.convoyId, name: kolonnenNameKurz(job.kolonneName) || t('app.convoy'), type: 'group' });
      }
      (job?.kolonneDrivers || []).forEach((driver) => {
        if (!driver?.id || driver.id === ownId) return;
        map.set(`individual:${driver.id}`, { id: driver.id, name: driver.name || t('app.driver'), type: 'individual' });
      });
    });
    return Array.from(map.values());
  }, [jobs, session?.user?.id, t]);

  useEffect(() => {
    const bootstrapAuth = async () => {
      try {
        const sessionPromise = supabase.auth.getSession();
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Auth timeout while loading session.')), 8000),
        );
        const { data } = await Promise.race([sessionPromise, timeoutPromise]);
        setSession(data?.session || null);
      } catch (error) {
        setSession(null);
        setAuthError(error?.message || t('app.authInitFailed'));
      } finally {
        setAuthLoading(false);
      }
    };
    bootstrapAuth();

    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession || null);
      setAuthError('');
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    // Fahrer-App soll keine Handy-Standorte mehr pushen.
    if (geoWatchIdRef.current !== null && typeof navigator !== 'undefined' && navigator.geolocation) {
      navigator.geolocation.clearWatch(geoWatchIdRef.current);
      geoWatchIdRef.current = null;
    }
    return undefined;
  }, [session?.user?.id]);

  useEffect(() => {
    if (!session?.user?.id) {
      setJobs([]);
      setServiceRequests([]);
      setCurrentDriverName('');
      setCurrentDriverProfile(null);
      setCurrentVehicle(null);
      setVehicleDamages([]);
      setPassengers([]);
      return undefined;
    }

    const driverId = session.user.id;

    const fetchProfileAndJobs = async () => {
      try {
        const loadOwnLiveLocations = async () => {
          const candidates = [
            'lat,lng,active_job_id,captured_at,updated_at,source',
            'lat,lng,active_job_id,captured_at,source',
            'lat,lng,active_job_id,captured_at,updated_at',
            'lat,lng,active_job_id,captured_at',
          ];
          for (const selectValue of candidates) {
            const result = await supabase
              .from('driver_live_locations')
              .select(selectValue)
              .eq('driver_id', driverId)
              .limit(50);
            if (!result.error) return result.data || [];
          }
          return [];
        };

        const [{ data: profile }, { data: ownProfileFull }, { data: directJobs }, { data: convoyLinks }, { data: allGuests }, { data: allProfiles }, { data: allVehicles }, ownLiveLocations, serviceRequestsResult, { data: kollegenStandorte }] = await Promise.all([
          supabase.from('profiles').select('first_name,last_name,vehicle_id').eq('id', driverId).maybeSingle(),
          supabase.from('profiles').select('*').eq('id', driverId).maybeSingle(),
          supabase
            .from('jobs')
            .select('*')
            .eq('driver_id', driverId)
            .neq('status', 'cancelled')
            .neq('status', 'refused')
            .order('created_at', { ascending: false }),
          supabase
            .from('convoy_assignments')
            .select('job_id,response_status')
            .eq('driver_id', driverId)
            .then((r) => (r.error ? { data: [] } : r)),
          supabase.from('guests').select('*'),
          supabase.from('profiles').select('id,first_name,last_name,phone,avatar_url,vehicle_id,driver_number'),
          supabase.from('vehicles').select('id,brand_model,license_plate,image_url'),
          loadOwnLiveLocations(),
          supabase
            .from('driver_service_requests')
            .select('id,service_date,service_start_time,service_end_time,status,created_at')
            .eq('driver_id', driverId)
            .in('status', ['pending', 'accepted'])
            .order('created_at', { ascending: false })
            .then((r) => {
              if (!r.error) return r;
              if (String(r.error?.message || '').includes('driver_service_requests')) return { data: [] };
              return r;
            }),
          // Standorte der Kollegen — gezeigt werden sie nur in Kolonnenfahrten
          // und nur im Zeitfenster rund um die Fahrt (siehe Kolonnen-Ansichten).
          supabase
            .from('driver_live_locations')
            .select('driver_id,lat,lng,captured_at')
            .neq('driver_id', driverId)
            .then((r) => (r.error ? { data: [] } : r)),
        ]);
        const standortVon = Object.fromEntries((kollegenStandorte || [])
          .filter((row) => Number.isFinite(Number(row?.lat)) && Number.isFinite(Number(row?.lng)))
          .map((row) => [row.driver_id, { lat: Number(row.lat), lng: Number(row.lng), erfasst: row.captured_at || null }]));
        const toTimestamp = (value) => {
          const date = value ? new Date(value) : null;
          return date && !Number.isNaN(date.getTime()) ? date.getTime() : 0;
        };
        const ownLiveLocationRows = (Array.isArray(ownLiveLocations) ? ownLiveLocations : [])
          .filter((row) => Number.isFinite(Number(row?.lat)) && Number.isFinite(Number(row?.lng)))
          .sort((a, b) => {
            const tsA = toTimestamp(a?.captured_at) || toTimestamp(a?.updated_at);
            const tsB = toTimestamp(b?.captured_at) || toTimestamp(b?.updated_at);
            return tsB - tsA;
          });
        const ownLiveLocation = ownLiveLocationRows.find((row) => isObdLocationSource(row?.source)) || null;
        const convoyJobIds = Array.from(
          new Set(
            (convoyLinks || [])
              .filter((row) => (row.response_status || 'pending') !== 'refused')
              .map((row) => row.job_id)
              .filter(Boolean),
          ),
        );
        const { data: convoyJobs } = convoyJobIds.length
          ? await supabase
              .from('jobs')
              .select('*')
              .in('id', convoyJobIds)
              .neq('status', 'cancelled')
              .order('created_at', { ascending: false })
          : { data: [] };
        const jobsById = new Map();
        [...(directJobs || []), ...(convoyJobs || [])].forEach((job) => jobsById.set(job.id, job));
        const allVisibleJobs = Array.from(jobsById.values())
          .filter((job) => isDriverVisibleJobStatus(job?.status))
          // Live: nie abgeschlossene Altfahrten (Fahrtdatum vor gestern) ausblenden, DB bleibt unveraendert.
          .filter((job) => DEMO_MODE || getRideDateFromJob(job) >= toLocalDateValue(Date.now() - DAY_IN_MS))
          .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

        const profileMap = Object.fromEntries((allProfiles || []).map((p) => [p.id, p]));
        const vehicleMap = Object.fromEntries((allVehicles || []).map((v) => [v.id, v]));
        const guestMap = Object.fromEntries((allGuests || []).map((g) => [g.id, g]));
        setPassengers(
          (allGuests || []).map((g) => ({
            id: g.id,
            firstName: g.first_name || '',
            lastName: g.last_name || '',
            email: g.email || '',
            rides: g.rides_count ?? g.trip_count ?? g.ride_count ?? 0,
            notes: g.notes || '',
          })),
        );

        if (profile?.vehicle_id) {
          const [{ data: vehicle }, { data: damages }] = await Promise.all([
            supabase.from('vehicles').select('*').eq('id', profile.vehicle_id).maybeSingle(),
            supabase.from('vehicle_damages').select('*').eq('vehicle_id', profile.vehicle_id).order('report_date', { ascending: false }),
          ]);
          setCurrentVehicle(vehicle || null);
          setVehicleDamages(damages || []);
        } else {
          setCurrentVehicle(null);
          setVehicleDamages([]);
        }

        const formattedJobs = await Promise.all((allVisibleJobs || []).map(async (dbJob) => {
          const [{ data: notes }, { data: links }, { data: convoy }] = await Promise.all([
            supabase.from('job_notes').select('note_text,created_at,author_name').eq('job_id', dbJob.id).order('created_at', { ascending: false }),
            supabase.from('job_guests').select('guest_id').eq('job_id', dbJob.id),
            dbJob.convoy_id ? supabase.from('convoys').select('name').eq('id', dbJob.convoy_id).maybeSingle() : Promise.resolve({ data: null }),
          ]);
          const assignmentWithNames = await supabase
            .from('convoy_assignments')
            .select('driver_id,guest_ids,guest_names,response_status')
            .eq('job_id', dbJob.id);
          let assignments = assignmentWithNames.data || [];
          if (assignmentWithNames.error && assignmentWithNames.error.message?.includes('guest_names')) {
            const assignmentFallback = await supabase
              .from('convoy_assignments')
              .select('driver_id,guest_ids,response_status')
              .eq('job_id', dbJob.id);
            assignments = (assignmentFallback.data || []).map((row) => ({ ...row, guest_names: [] }));
          } else if (assignmentWithNames.error) {
            assignments = [];
          }

          const linkedGuestRows = (links || []).map((l) => guestMap[l.guest_id]).filter(Boolean);
          const linkedPassengers = linkedGuestRows
            .map((g) => `${g.first_name} ${g.last_name}`.trim())
            .filter(Boolean);
          const fallbackPassengers = normalizePassengerNames(dbJob.passengers);
          const passengers = linkedPassengers.length ? linkedPassengers : fallbackPassengers;
          const kolonneDrivers = (assignments || []).map((a) => {
            const p = profileMap[a.driver_id];
            const v = p?.vehicle_id ? vehicleMap[p.vehicle_id] : null;
            return {
              id: a.driver_id,
              name: p ? `${p.first_name || ''} ${p.last_name || ''}`.trim() : t('app.driver'),
              driverNumber: p?.driver_number ?? null,
              standort: a.driver_id === driverId ? null : (standortVon[a.driver_id] || null),
              phone: p?.phone || '',
              image: p?.avatar_url || `https://ui-avatars.com/api/?name=${encodeURIComponent((p?.first_name || 'Fahrer'))}&background=111111&color=d4ff28`,
              car: v ? `${v.brand_model} (${v.license_plate})` : t('app.noVehicle'),
              responseStatus: a.response_status || 'pending',
              assignedGuests: [
                ...(a.guest_ids || []).map((gid) => guestMap[gid]).filter(Boolean).map((g) => `${g.first_name} ${g.last_name}`.trim()),
                ...((a.guest_names || []).filter(Boolean)),
              ],
            };
          });
          const allKolonneGuests = Array.from(new Set(kolonneDrivers.flatMap((d) => d.assignedGuests)));
          const linkedAssignmentGuests = (assignments || [])
            .flatMap((a) => (a.guest_ids || []).map((gid) => guestMap[gid]).filter(Boolean));
          const hasVip = Boolean(
            dbJob.is_vip
            || linkedGuestRows.some((g) => g.is_vip === true)
            || linkedAssignmentGuests.some((g) => g.is_vip === true),
          );
          const hasChildSeat = Boolean(
            dbJob.needs_child_seat
            || dbJob.needs_second_child_seat
            || linkedGuestRows.some((g) => g.needs_child_seat === true || g.needs_second_child_seat === true)
            || linkedAssignmentGuests.some((g) => g.needs_child_seat === true || g.needs_second_child_seat === true),
          );
          const hasAccessibility = Boolean(
            dbJob.needs_accessibility
            || linkedGuestRows.some((g) => g.needs_accessibility === true)
            || linkedAssignmentGuests.some((g) => g.needs_accessibility === true),
          );
          const hasLuggage = Boolean(
            dbJob.needs_luggage
            || linkedGuestRows.some((g) => g.needs_luggage === true)
            || linkedAssignmentGuests.some((g) => g.needs_luggage === true),
          );
          const myAssignment = kolonneDrivers.find((d) => d.id === driverId);
          const hasConvoyAssignments = Array.isArray(assignments) && assignments.length > 0;
          const isConvoyLikeJob = Boolean(dbJob.convoy_id || hasConvoyAssignments);
          if (isConvoyLikeJob && myAssignment?.responseStatus === 'refused') {
            return null;
          }
          const flightLive = extractFlightLiveTracking(dbJob.ext_flight_payload);
          const flightSummary = extractFlightSummary(dbJob.ext_flight_payload);

          return {
            id: dbJob.id,
            tripType: dbJob.trip_type,
            from: {
              name: dbJob.pickup_name,
              iconType: dbJob.trip_type === 'airport' ? 'plane' : 'building',
              address: dbJob.pickup_address,
              shortFormattedAddress: toShortFormattedAddress(dbJob.pickup_name, dbJob.pickup_address),
            },
            to: {
              name: dbJob.dropoff_name,
              iconType: 'building',
              address: dbJob.dropoff_address,
              shortFormattedAddress: toShortFormattedAddress(dbJob.dropoff_name, dbJob.dropoff_address),
            },
            trainNumber: dbJob.train_number || null,
            rideDate: getRideDateFromJob(dbJob),
            etd: dbJob.etd ? dbJob.etd.substring(0, 5) : '12:00',
            originalEtd: dbJob.original_etd ? dbJob.original_etd.substring(0, 5) : null,
            flight: dbJob.flight_number || dbJob.train_number || 'STADTFAHRT',
            flightOrigin: dbJob.flight_origin || flightSummary?.departureAirport || null,
            flightLiveMode: flightLive?.mode || null,
            flightRadarHex: flightLive?.radarHex || null,
            flightCallsign: flightLive?.callsign || null,
            flightLiveLat: Number.isFinite(flightLive?.lat) ? flightLive.lat : null,
            flightLiveLng: Number.isFinite(flightLive?.lng) ? flightLive.lng : null,
            flightLiveHeadingDeg: Number.isFinite(flightLive?.heading) ? flightLive.heading : null,
            flightLiveCapturedAt: flightLive?.capturedAt || null,
            flightLiveOnGround: typeof flightLive?.onGround === 'boolean' ? flightLive.onGround : null,
            flightLiveSecondaryEtaIso: flightLive?.secondaryEtaIso || null,
            flightLiveSecondaryEtaMins: Number.isFinite(flightLive?.secondaryEtaMinutes)
              ? flightLive.secondaryEtaMinutes
              : null,
            flightLiveTrail: Array.isArray(flightLive?.trail) ? flightLive.trail : [],
            flightLiveRouteStops: Array.isArray(flightLive?.routeStops) ? flightLive.routeStops : [],
            flightStatusCode: flightSummary?.statusCode || null,
            flightStatusDescription: flightSummary?.statusDescription || null,
            flightEstimatedArrivalIso: flightSummary?.estimatedArrivalIso || null,
            flightActualArrivalIso: flightSummary?.actualArrivalIso || null,
            flightScheduledArrivalIso: flightSummary?.scheduledArrivalIso || null,
            extLastError: String(dbJob.ext_last_error || '').trim() || null,
            status: dbJob.status,
            passengers: myAssignment?.assignedGuests?.length ? myAssignment.assignedGuests : (passengers.length ? passengers : (dbJob.passengers || [])),
            waitingTime: dbJob.waiting_time_mins || 0,
            extRouteProvider: dbJob.ext_route_provider || null,
            extRouteDistanceM: dbJob.ext_route_distance_m || null,
            extRouteDurationMins: dbJob.ext_route_duration_mins || 0,
            extRouteDurationInTrafficMins: dbJob.ext_route_duration_in_traffic_mins || 0,
            extRoutePolyline: dbJob.ext_route_polyline || '',
            extDriverToPickupDurationMins: dbJob.ext_driver_to_pickup_duration_mins || 0,
            extDriverToPickupDurationInTrafficMins: dbJob.ext_driver_to_pickup_duration_in_traffic_mins || 0,
            extDriverToPickupPolyline: dbJob.ext_driver_to_pickup_polyline || '',
            extLastEnrichedAt: dbJob.ext_last_enriched_at || null,
            // Fahrernummer fuer den eigenen Standortpunkt auf der Karte.
            driverNumber: ownProfileFull?.driver_number ?? null,
            driverLiveLat: isFiniteNumber(ownLiveLocation?.lat) ? ownLiveLocation.lat : null,
            driverLiveLng: isFiniteNumber(ownLiveLocation?.lng) ? ownLiveLocation.lng : null,
            driverLiveCapturedAt: ownLiveLocation?.updated_at || ownLiveLocation?.captured_at || null,
            driverLiveSource: ownLiveLocation?.source || null,
            badges: [
              ...(hasVip ? ['vip'] : []),
              ...(hasChildSeat ? ['child_seat'] : []),
              ...(hasAccessibility ? ['accessibility'] : []),
              ...(hasLuggage ? ['luggage'] : []),
            ],
            notes: (notes || []).map((n) => {
              const createdAt = n.created_at || null;
              const dateObj = createdAt ? new Date(createdAt) : null;
              const validDate = dateObj && !Number.isNaN(dateObj.getTime()) ? dateObj : null;
              return {
                time: validDate ? validDate.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }) : '',
                date: validDate ? validDate.toLocaleDateString(locale) : '',
                text: n.note_text || '',
                autor: n.author_name || '',
                createdAt,
              };
            }),
            isKolonne: isConvoyLikeJob,
            convoyId: dbJob.convoy_id || null,
            kolonneName: convoy?.name || t('app.convoy'),
            kolonneGuests: allKolonneGuests.length ? allKolonneGuests : passengers,
            kolonneDrivers,
            myResponseStatus: myAssignment?.responseStatus || 'pending',
          };
        }));

        const nextJobs = (formattedJobs || []).filter(Boolean);
        setJobs(nextJobs);
        jobsRef.current = nextJobs;
        setServiceRequests(Array.isArray(serviceRequestsResult?.data) ? serviceRequestsResult.data : []);
        setSelectedJob((prev) => {
          if (!prev?.id) return prev;
          const refreshed = nextJobs.find((job) => job.id === prev.id);
          if (!refreshed) return null;
          return {
            ...refreshed,
            __openToken: prev.__openToken,
          };
        });
        const fullName = [profile?.first_name, profile?.last_name].filter(Boolean).join(' ');
        setCurrentDriverName(fullName || session.user.email || '');
        setCurrentDriverProfile({
          firstName: ownProfileFull?.first_name || profile?.first_name || '',
          lastName: ownProfileFull?.last_name || profile?.last_name || '',
          email: ownProfileFull?.email || session?.user?.email || '',
          phone: ownProfileFull?.phone || '',
          street: ownProfileFull?.street || '',
          streetNumber: ownProfileFull?.street_number || '',
          city: ownProfileFull?.city || '',
          zip: ownProfileFull?.zip || '',
          language: ownProfileFull?.language || '',
          avatarUrl: ownProfileFull?.avatar_url || '',
        });

        if (isFiniteNumber(ownLiveLocation?.lat) && isFiniteNumber(ownLiveLocation?.lng)) {
          _applyAutoStatusForLocation({
            lat: Number(ownLiveLocation.lat),
            lng: Number(ownLiveLocation.lng),
            speed_mps: Number(ownLiveLocation?.speed_mps),
          }).catch(() => {});
        }
      } catch {
        setJobs([]);
        setServiceRequests([]);
        setCurrentDriverProfile(null);
        setPassengers([]);
      }
    };
    fetchProfileAndJobsRef.current = fetchProfileAndJobs;

    fetchProfileAndJobs();

    const channel = supabase
      .channel(`driver-jobs-${driverId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'jobs' }, () => {
        fetchProfileAndJobs();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'convoy_assignments', filter: `driver_id=eq.${driverId}` }, () => {
        fetchProfileAndJobs();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'driver_service_requests', filter: `driver_id=eq.${driverId}` }, () => {
        fetchProfileAndJobs();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'driver_live_locations', filter: `driver_id=eq.${driverId}` }, (payload) => {
        const source = String(payload?.new?.source || '').trim().toLowerCase();
        if (!isObdLocationSource(source)) return;
        const nextLat = Number(payload?.new?.lat);
        const nextLng = Number(payload?.new?.lng);
        if (!Number.isFinite(nextLat) || !Number.isFinite(nextLng)) return;
        const capturedAt = payload?.new?.updated_at || payload?.new?.captured_at || new Date().toISOString();
        syncLocalDriverCoords(nextLat, nextLng, capturedAt, payload?.new?.source || null);
        _applyAutoStatusForLocation({
          lat: nextLat,
          lng: nextLng,
          speed_mps: Number(payload?.new?.speed_mps),
        }).catch(() => {});
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [session, syncLocalDriverCoords, _applyAutoStatusForLocation, t, locale]);

  const markChatRead = async (chatType, chatId) => {
    const userId = session?.user?.id;
    if (!userId || !chatId) return;
    const nowIso = new Date().toISOString();
    localStorage.setItem(getLastReadKey(userId, chatType, chatId), nowIso);
    setUnreadByChat((prev) => ({ ...prev, [`${chatType}:${chatId}`]: 0 }));
    await supabase
      .from('chat_reads')
      .upsert(
        [{ user_id: userId, chat_type: chatType === 'group' ? 'group' : 'direct', chat_id: chatId, last_read_at: nowIso }],
        { onConflict: 'user_id,chat_type,chat_id' },
      )
      .then(() => {})
      .catch(() => {});
  };

  const refreshUnreadChatState = async () => {
    const userId = session?.user?.id;
    if (!userId || !availableChats.length) {
      setUnreadByChat({});
      setChatLastByChat({});
      return;
    }
    const nextUnread = {};
    const nextLast = {};
    await Promise.all(
      availableChats.map(async (chat) => {
        const key = `${chat.type}:${chat.id}`;
        try {
          const lastRead = localStorage.getItem(getLastReadKey(userId, chat.type, chat.id));
          let unreadQuery;
          let lastQuery;
          if (chat.type === 'group') {
            unreadQuery = supabase
              .from('messages')
              .select('id', { count: 'exact', head: true })
              .eq('target_type', 'group')
              .eq('target_id', chat.id)
              .neq('sender_id', userId);
            lastQuery = supabase
              .from('messages')
              .select('created_at')
              .eq('target_type', 'group')
              .eq('target_id', chat.id)
              .order('created_at', { ascending: false })
              .limit(1);
          } else {
            unreadQuery = supabase
              .from('messages')
              .select('id', { count: 'exact', head: true })
              .eq('target_type', 'direct')
              .eq('sender_id', chat.id)
              .eq('target_id', userId);
            lastQuery = supabase
              .from('messages')
              .select('created_at')
              .eq('target_type', 'direct')
              .or(`and(sender_id.eq.${userId},target_id.eq.${chat.id}),and(sender_id.eq.${chat.id},target_id.eq.${userId})`)
              .order('created_at', { ascending: false })
              .limit(1);
          }
          if (lastRead) unreadQuery = unreadQuery.gt('created_at', lastRead);
          const [{ count }, { data: lastRows }] = await Promise.all([unreadQuery, lastQuery]);
          nextUnread[key] = count || 0;
          nextLast[key] = lastRows?.[0]?.created_at || '';
        } catch {
          nextUnread[key] = 0;
          nextLast[key] = '';
        }
      }),
    );
    setUnreadByChat(nextUnread);
    setChatLastByChat(nextLast);
  };

  useEffect(() => {
    refreshUnreadChatState();
  }, [availableChats, session?.user?.id]);

  useEffect(() => {
    if (!session?.user?.id) return undefined;
    const channel = supabase
      .channel(`driver-messages-${session.user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, () => {
        refreshUnreadChatState();
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [session?.user?.id, availableChats]);

  useEffect(() => {
    if (view === 'chat' && activeChat?.id) {
      markChatRead(activeChat.type, activeChat.id);
    }
    // Den Kolonnen-Chat oeffnet man direkt aus der Fahrt heraus, dabei wird
    // kein activeChat gesetzt — sonst bliebe die Plakette stehen.
    if (view === 'kolonnenChat' && selectedJob?.convoyId) {
      markChatRead('group', selectedJob.convoyId);
    }
  }, [view, activeChat?.id, activeChat?.type, selectedJob?.convoyId, session?.user?.id]);

  const addVehicleDamage = async (part, description, images) => {
    const bilder = Array.isArray(images) ? images.filter(Boolean) : [images].filter(Boolean);
    if (!currentVehicle?.id) return;
    const heute = new Date().toISOString().slice(0, 10);
    // Dieselbe Meldung nicht zweimal eintragen — etwa wenn das Tutorial den
    // Schritt erneut vorfuehrt oder der Knopf doppelt getroffen wird.
    const schonGemeldet = vehicleDamages.some((d) => d.report_date === heute
      && d.part_name === part && d.description === description);
    if (schonGemeldet) return;
    await supabase.from('vehicle_damages').insert([
      {
        vehicle_id: currentVehicle.id,
        report_date: heute,
        part_name: part,
        description,
        image_url: bilder[0] || null,
        image_urls: bilder,
        reported_by_driver: true,
      },
    ]);
    const { data: damages } = await supabase.from('vehicle_damages').select('*').eq('vehicle_id', currentVehicle.id).order('report_date', { ascending: false });
    setVehicleDamages(damages || []);
  };

  const resetNewPassenger = () => {
    setNewPassenger({
      firstName: '',
      lastName: '',
      email: '',
      countryCode: '+49',
      phone: '',
      street: '',
      streetNumber: '',
      city: '',
      zip: '',
      language: 'Deutsch',
      vip: false,
      accessibility: false,
      childSeat: false,
      childSeat2: false,
      notes: '',
    });
  };

  const _handleCreatePassenger = async () => {
    if (!newPassenger.firstName.trim() || !newPassenger.lastName.trim()) {
      window.alert(t('app.firstLastNameRequired'));
      return;
    }

    const fullPayload = {
      first_name: newPassenger.firstName.trim(),
      last_name: newPassenger.lastName.trim(),
      email: newPassenger.email.trim() || null,
      phone: `${newPassenger.countryCode || '+49'} ${newPassenger.phone || ''}`.trim(),
      street: newPassenger.street.trim() || null,
      street_number: newPassenger.streetNumber.trim() || null,
      city: newPassenger.city.trim() || null,
      zip: newPassenger.zip.trim() || null,
      language: newPassenger.language || 'Deutsch',
      notes: newPassenger.notes.trim() || null,
      is_vip: !!newPassenger.vip,
      needs_accessibility: !!newPassenger.accessibility,
      needs_child_seat: !!newPassenger.childSeat,
      needs_second_child_seat: !!newPassenger.childSeat2,
    };

    setIsSavingPassenger(true);
    try {
      const attempts = [
        fullPayload,
        {
          first_name: fullPayload.first_name,
          last_name: fullPayload.last_name,
          email: fullPayload.email,
          phone: fullPayload.phone,
        },
        {
          first_name: fullPayload.first_name,
          last_name: fullPayload.last_name,
        },
      ];

      let savedGuest = null;
      for (const payload of attempts) {
        const { data, error } = await supabase.from('guests').insert([payload]).select('*').single();
        if (!error) {
          savedGuest = data;
          break;
        }
      }

      if (!savedGuest) throw new Error('insert_failed');

      setPassengers((prev) => [
        {
          id: savedGuest.id || Date.now(),
          firstName: savedGuest.first_name || newPassenger.firstName.trim(),
          lastName: savedGuest.last_name || newPassenger.lastName.trim(),
          email: savedGuest.email || newPassenger.email.trim(),
          rides: savedGuest.rides_count ?? savedGuest.trip_count ?? 0,
          notes: savedGuest.notes || newPassenger.notes,
        },
        ...prev,
      ]);

      resetNewPassenger();
      setView('passengers');
    } catch {
      window.alert(t('app.passengerSaveFailed'));
    } finally {
      setIsSavingPassenger(false);
    }
  };

  useEffect(() => () => {
    if (predictionRequestRef.current) {
      clearTimeout(predictionRequestRef.current);
    }
  }, []);

  const _handleImportExcel = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (event) => {
      const content = event.target.result;
      const lines = content.split('\n');
      const newImportedJobs = [];
      const csvSplitRegex = /,(?=(?:(?:[^"]*"){2})*[^"]*$)/;

      const isAirport = (str) => /flughafen|muc|airport|terminal/i.test(str);

      for (let i = 1; i < lines.length; i++) {
        if (!lines[i].trim()) continue;
        const cols = lines[i].split(csvSplitRegex);
        if (cols.length >= 4) {
          const type = cols[0]?.trim().toLowerCase() === 'airport' ? 'airport' : 'normal';
          const start = cols[1]?.replace(/"/g, '')?.trim() || "Unbekannt";
          const target = cols[2]?.replace(/"/g, '')?.trim() || "Unbekannt";
          let time = cols[3]?.trim();
          const flight = cols[4]?.replace(/"/g, '')?.trim()?.toUpperCase(); 
          const guestsStr = cols[5]?.replace(/"/g, '')?.trim();
          const noteStr = cols[6]?.replace(/"/g, '')?.trim();

          const etd = time || "12:00";
          const originalEtd = null;
          const flightOrigin = "";

          newImportedJobs.push({
            id: Date.now() + i,
            from: {
              name: start.split(',')[0],
              iconType: isAirport(start) ? 'plane' : 'building',
              address: start,
              shortFormattedAddress: toShortFormattedAddress(start.split(',')[0], start),
            },
            to: {
              name: target.split(',')[0],
              iconType: isAirport(target) ? 'plane' : 'building',
              address: target,
              shortFormattedAddress: toShortFormattedAddress(target.split(',')[0], target),
            },
            rideDate: toLocalDateValue(),
            etd: etd,
            originalEtd: originalEtd,
            flightOrigin: flightOrigin,
            flight: type === 'airport' ? (flight || 'LH999') : 'STADTFAHRT',
            status: 'pending',
            passengers: guestsStr ? guestsStr.split(',').map(g => g.trim()) : ['Gast'], 
            waitingTime: type === 'airport' ? 30 : 0,
            notes: noteStr ? [{ time: t('app.import'), text: noteStr }] : [],
            extRouteDurationMins: 0,
            extRouteDurationInTrafficMins: 0,
            extRoutePolyline: '',
          });
        }
      }
      
      setJobs(prev => [...newImportedJobs, ...prev]);

      // Speichere in Supabase (optional, falls gewünscht)
      try {
        const dbJobs = newImportedJobs.map(j => ({
           trip_type: j.flight !== 'STADTFAHRT' ? 'airport' : 'normal',
           pickup_name: j.from.name,
           pickup_address: j.from.address,
           dropoff_name: j.to.name,
           dropoff_address: j.to.address,
           flight_number: j.flight !== 'STADTFAHRT' ? j.flight : null,
           flight_origin: j.flightOrigin,
           ride_date: normalizeRideDate(j.rideDate),
           etd: normalizeTimeWithSeconds(j.etd),
           original_etd: normalizeTimeWithSeconds(j.originalEtd),
           passengers: j.passengers
        }));
        const insertedJobs = await insertJobsWithOptionalRideDate(dbJobs);
        const insertedIds = (insertedJobs || []).map((row) => row.id).filter(isUuid);
        if (insertedIds.length) {
          await invokeExternalSync({
            reason: 'create',
            jobIds: insertedIds,
            requestedBy: session?.user?.id,
          });
        }
      } catch (err) {
        console.error("Fehler beim Speichern in Supabase:", err);
      }
    };
    reader.readAsText(file);
  };

  const _handleAddJob = async (e) => {
    e.preventDefault();
    const selectedRideDate = normalizeRideDate(newJob.rideDate);
    const finalEtd = newJob.tripType === 'airport' ? addMinutesToTime(newJob.etd, newJob.waitingTime) : newJob.etd;
    const isAirport = (str) => /flughafen|muc|airport|terminal/i.test(str);
    const fromIconType = newJob.tripType === 'airport' || isAirport(newJob.from) ? 'plane' : 'building';
    const toIconType = isAirport(newJob.to) ? 'plane' : 'building';
    const ownPassengers = newJob.passengers?.length ? newJob.passengers : ['Gast'];
    const extraKolonneGuests = (newJob.kolonneGuests || []).filter(Boolean);
    const allKolonneGuests = Array.from(new Set([...ownPassengers, ...extraKolonneGuests]));
    const kolonneDrivers = (newJob.kolonneDrivers || []).map((driver, idx) => ({
      ...driver,
      id: driver.id || `d-${Date.now()}-${idx}`,
      image: driver.image || `https://ui-avatars.com/api/?name=${encodeURIComponent(driver.name || 'Fahrer')}&background=111111&color=d4ff28`,
      assignedGuests: driver.assignedGuests || []
    }));

    const job = { 
      id: Date.now(), 
      from: {
        name: newJob.from.split(',')[0],
        iconType: fromIconType,
        address: newJob.from,
        shortFormattedAddress: toShortFormattedAddress(newJob.from.split(',')[0], newJob.from),
      },
      to: {
        name: newJob.to.split(',')[0],
        iconType: toIconType,
        address: newJob.to,
        shortFormattedAddress: toShortFormattedAddress(newJob.to.split(',')[0], newJob.to),
      },
      rideDate: selectedRideDate,
      etd: finalEtd, 
      originalEtd: newJob.originalEtd, 
      flightOrigin: newJob.flightOrigin, 
      flight: newJob.tripType === 'airport' ? (newJob.flight || 'LH999') : 'STADTFAHRT', 
      status: 'pending', 
      passengers: ownPassengers,
      waitingTime: Number(newJob.waitingTime) || 0,
      extRouteDurationMins: 0,
      extRouteDurationInTrafficMins: 0,
      extRoutePolyline: '',
      badges: [...(newJob.vip ? ['vip'] : []), ...(newJob.child_seat ? ['child_seat'] : []), ...(newJob.accessibility ? ['accessibility'] : [])],
      notes: newJob.note ? [{ time: new Date().toLocaleDateString(locale), text: newJob.note }] : [],
      isKolonne: !!newJob.isKolonne,
      kolonneName: newJob.isKolonne ? (newJob.kolonneName.trim() || t('app.convoyRouteName', { from: newJob.from.split(',')[0], to: newJob.to.split(',')[0] })) : null,
      kolonneGuests: newJob.isKolonne ? allKolonneGuests : [],
      kolonneDrivers: newJob.isKolonne ? kolonneDrivers : []
    };
    
    // Lokales Update
    setJobs(prev => [job, ...prev]);
    setShowAddModal(false);
    setNewJob({
      tripType: 'airport',
      from: '',
      to: '',
      flight: '',
      rideDate: toLocalDateValue(),
      etd: '20:30',
      originalEtd: '',
      flightOrigin: '',
      passengers: [],
      note: '',
      waitingTime: 30,
      vip: false,
      accessibility: false,
      child_seat: false,
      isKolonne: false,
      kolonneName: '',
      kolonneGuests: [],
      kolonneDrivers: []
    });

    // Supabase Update
    try {
      const insertedJobs = await insertJobsWithOptionalRideDate({
         trip_type: newJob.tripType,
         pickup_name: job.from.name,
         pickup_address: job.from.address,
         dropoff_name: job.to.name,
         dropoff_address: job.to.address,
         flight_number: job.flight !== 'STADTFAHRT' ? job.flight : null,
         ride_date: selectedRideDate,
         etd: normalizeTimeWithSeconds(finalEtd),
         original_etd: normalizeTimeWithSeconds(job.originalEtd),
         waiting_time_mins: newJob.waitingTime,
         is_vip: newJob.vip,
         needs_child_seat: newJob.child_seat,
         needs_accessibility: newJob.accessibility,
         passengers: ownPassengers
      });
      const insertedIds = (insertedJobs || []).map((row) => row.id).filter(isUuid);
      if (insertedIds.length) {
        await invokeExternalSync({
          reason: 'create',
          jobIds: insertedIds,
          requestedBy: session?.user?.id,
        });
      }
    } catch (err) {
      console.error("Fehler beim Speichern des Jobs in Supabase:", err);
    }
  };

  const handleJobAction = async (id, action, options = {}) => {
    const selected = jobs.find((j) => j.id === id);
    if (!selected) return false;
    const isConvoyJob = Boolean(
      selected?.isKolonne
      || selected?.convoyId
      || (Array.isArray(selected?.kolonneDrivers) && selected.kolonneDrivers.length > 0),
    );
    const nextStatus = action === 'accept' ? 'assigned' : 'refused';
    const convoyStatus = action === 'accept' ? 'accepted' : 'refused';
    const ownDriverId = session?.user?.id;
    if (!ownDriverId) {
      window.alert(t('app.notLoggedIn'));
      return false;
    }
    const refusalReason = action === 'refuse'
      ? (options?.refusalReason?.trim() || 'Fahrer hat die Fahrt abgelehnt.')
      : null;

    if (isConvoyJob) {
      if (action === 'refuse') {
        setJobs((prev) => prev.filter((j) => j.id !== id));
      } else {
        setJobs((prev) =>
          prev.map((j) =>
            j.id === id
              ? {
                  ...j,
                  myResponseStatus: convoyStatus,
                  kolonneDrivers: (j.kolonneDrivers || []).map((d) =>
                    d.id === ownDriverId ? { ...d, responseStatus: convoyStatus } : d,
                  ),
                }
              : j,
          ),
        );
      }
    } else if (action === 'accept') {
      setJobs((prev) => prev.map((j) => (j.id === id ? { ...j, status: 'assigned' } : j)));
    } else {
      setJobs((prev) => prev.filter((j) => j.id !== id));
    }

    try {
      if (isConvoyJob) {
        const assignmentPayload = {
          job_id: id,
          driver_id: ownDriverId,
          response_status: convoyStatus,
          responded_at: new Date().toISOString(),
          refusal_reason: refusalReason,
        };

        let assignmentWrite = await supabase
          .from('convoy_assignments')
          .upsert([assignmentPayload], { onConflict: 'job_id,driver_id' })
          .select('job_id,driver_id,response_status')
          .maybeSingle();

        if (assignmentWrite.error && (assignmentWrite.error.message?.includes('responded_at') || assignmentWrite.error.message?.includes('refusal_reason'))) {
          assignmentWrite = await supabase
            .from('convoy_assignments')
            .upsert([
              {
                job_id: id,
                driver_id: ownDriverId,
                response_status: convoyStatus,
              },
            ], { onConflict: 'job_id,driver_id' })
            .select('job_id,driver_id,response_status')
            .maybeSingle();
        }

        if (assignmentWrite.error && (assignmentWrite.error.message?.includes('response_status') || assignmentWrite.error.message?.includes('responded_at') || assignmentWrite.error.message?.includes('refusal_reason'))) {
          window.alert(t('app.sqlUpdateRequired'));
          return false;
        }
        if (assignmentWrite.error) throw assignmentWrite.error;
        if (!assignmentWrite.data) throw new Error(t('app.convoyResponseSaveFailed'));
      } else {
        const jobUpdatePayload = {
          status: nextStatus,
          refused_by_driver_id: action === 'refuse' ? ownDriverId : null,
          refusal_reason: action === 'refuse' ? refusalReason : null,
          driver_response_status: action === 'accept' ? 'accepted' : 'refused',
          driver_responded_at: new Date().toISOString(),
        };
        const { data: updatedJob, error } = await supabase
          .from('jobs')
          .update(jobUpdatePayload)
          .eq('id', id)
          .eq('driver_id', ownDriverId)
          .select('id,status')
          .maybeSingle();
        if (error && (error.message?.includes('refusal_reason') || error.message?.includes('refused_by_driver_id') || error.message?.includes('driver_response'))) {
          const fallback = await supabase
            .from('jobs')
            .update({ status: nextStatus })
            .eq('id', id)
            .eq('driver_id', ownDriverId)
            .select('id,status')
            .maybeSingle();
          if (fallback.error) throw fallback.error;
          if (!fallback.data) throw new Error(t('app.statusUpdateBlocked'));
        } else if (error) {
          throw error;
        } else if (!updatedJob) {
          throw new Error(t('app.statusUpdateBlocked'));
        }
      }

      if (action === 'accept' && isUuid(id)) {
        try {
          await invokeExternalSync({
            reason: 'live_view',
            jobIds: [id],
            requestedBy: ownDriverId,
            currentLocation: null,
          });
          await refreshJobLiveFlightData(id);
        } catch (syncError) {
          console.warn('Live-Route-Sync nach Annahme fehlgeschlagen:', syncError?.message || syncError);
        }
      }

      return true;
    } catch (err) {
      window.alert(t('app.actionSaveFailed', { message: err?.message || t('app.unknownError') }));
      console.error('Fehler beim Aktualisieren des Job-Status:', err);
      return false;
    }
  };

  const handleServiceRequestAction = useCallback(async (requestId, action) => {
    const normalizedRequestId = String(requestId || '').trim();
    const ownDriverId = String(session?.user?.id || '').trim();
    const normalizedAction = String(action || '').trim().toLowerCase();
    if (!isUuid(normalizedRequestId) || !isUuid(ownDriverId)) return false;
    if (!['accept', 'refuse'].includes(normalizedAction)) return false;

    const request = (Array.isArray(serviceRequests) ? serviceRequests : [])
      .find((entry) => String(entry?.id || '').trim() === normalizedRequestId);
    if (!request) return false;

    setServiceRequestActionBusyId(normalizedRequestId);
    try {
      const nextStatus = normalizedAction === 'accept' ? 'accepted' : 'refused';
      const requestPayload = {
        status: nextStatus,
        responded_at: new Date().toISOString(),
        refusal_reason: normalizedAction === 'refuse' ? 'Fahrer hat den Dienstplan abgelehnt.' : null,
      };
      const { error: requestError } = await supabase
        .from('driver_service_requests')
        .update(requestPayload)
        .eq('id', normalizedRequestId)
        .eq('driver_id', ownDriverId);
      if (requestError) throw requestError;

      if (normalizedAction === 'accept') {
        const profilePayload = {
          service_start_time: request.service_start_time || null,
          service_end_time: request.service_end_time || null,
          service_start_date: request.service_date || null,
          service_end_date: request.service_date || null,
        };
        let profileWrite = await supabase
          .from('profiles')
          .update(profilePayload)
          .eq('id', ownDriverId);
        if (profileWrite.error && (profileWrite.error.message?.includes('service_start_date') || profileWrite.error.message?.includes('service_end_date'))) {
          profileWrite = await supabase
            .from('profiles')
            .update({
              service_start_time: request.service_start_time || null,
              service_end_time: request.service_end_time || null,
            })
            .eq('id', ownDriverId);
        }
        if (profileWrite.error) throw profileWrite.error;
      }

      setServiceRequests((prev) => (Array.isArray(prev) ? prev : [])
        .map((entry) => (String(entry?.id || '').trim() === normalizedRequestId ? { ...entry, status: nextStatus } : entry))
        .filter((entry) => String(entry?.status || '').toLowerCase() !== 'refused'));
      return true;
    } catch (error) {
      console.error('Dienstplan-Anfrage Aktion fehlgeschlagen:', error);
      window.alert(t('app.serviceRequestSaveFailed', { message: error?.message || t('app.unknownError') }));
      return false;
    } finally {
      setServiceRequestActionBusyId(null);
    }
  }, [serviceRequests, session?.user?.id, t]);

  const _fetchPredictions = (input, field) => {
    setNewJob(prev => ({ ...prev, [field]: input }));
    const trimmedInput = (input || '').trim();
    if (predictionRequestRef.current) {
      clearTimeout(predictionRequestRef.current);
    }
    if (!trimmedInput) {
      setPredictions(prev => ({ ...prev, [field]: [] }));
      return;
    }
    predictionRequestRef.current = setTimeout(async () => {
      try {
        const rows = await fetchPlacesPredictions(trimmedInput, 'de');
        setPredictions(prev => ({ ...prev, [field]: rows }));
      } catch {
        setPredictions(prev => ({ ...prev, [field]: [] }));
      }
    }, 250);
  };

  const _selectPrediction = (p, f) => {
    setNewJob(prev => ({ ...prev, [f]: p.description })); 
    setPredictions(prev => ({ ...prev, [f]: [] })); 
    setActiveField(null); 
  };

  const handleRefreshAll = async () => {
    setIsRefreshing(true);
    try {
      const requestedBy = session?.user?.id;
      if (requestedBy) {
        const visibleJobIds = (jobsRef.current || []).map((job) => job.id).filter(isUuid);
        if (visibleJobIds.length) {
          await invokeExternalSync({
            reason: 'manual_refresh',
            jobIds: visibleJobIds,
            requestedBy,
            currentLocation: null,
          });
        }
      }
    } catch (err) {
      console.error('Fehler bei manuellem Refresh:', err);
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setAuthError('');
    const { error } = await supabase.auth.signInWithPassword({
      email: loginEmail.trim(),
      password: loginPassword,
    });
    if (error) {
      setAuthError(error.message);
      return;
    }
    setLoginPassword('');
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    viewEntryIdRef.current = 1;
    setViewStack([{ id: 0, view: 'list' }]);
    setSelectedJob(null);
  };

  const handleSaveDriverProfile = async (patch) => {
    const userId = session?.user?.id;
    if (!userId || !patch || typeof patch !== 'object') return;

    const updates = {};
    if (Object.prototype.hasOwnProperty.call(patch, 'firstName')) updates.first_name = patch.firstName || null;
    if (Object.prototype.hasOwnProperty.call(patch, 'lastName')) updates.last_name = patch.lastName || null;
    if (Object.prototype.hasOwnProperty.call(patch, 'phone')) updates.phone = patch.phone || null;
    if (Object.prototype.hasOwnProperty.call(patch, 'street')) updates.street = patch.street || null;
    if (Object.prototype.hasOwnProperty.call(patch, 'streetNumber')) updates.street_number = patch.streetNumber || null;
    if (Object.prototype.hasOwnProperty.call(patch, 'city')) updates.city = patch.city || null;
    if (Object.prototype.hasOwnProperty.call(patch, 'zip')) updates.zip = patch.zip || null;
    if (Object.prototype.hasOwnProperty.call(patch, 'language')) updates.language = patch.language || null;
    if (Object.prototype.hasOwnProperty.call(patch, 'avatarUrl')) updates.avatar_url = patch.avatarUrl || null;
    // E-Mail liegt bei Supabase Auth (auth.users), nicht zwingend in public.profiles.
    // Deshalb hier bewusst nicht in profiles schreiben.

    if (Object.keys(updates).length > 0) {
      const { error } = await supabase.from('profiles').update(updates).eq('id', userId);
      if (error) {
        console.error('Profil konnte nicht gespeichert werden:', error);
        window.alert(t('app.profileSaveFailed'));
        return;
      }
    }

    if (
      Object.prototype.hasOwnProperty.call(patch, 'email')
      && patch.email
      && patch.email !== session?.user?.email
    ) {
      try {
        await supabase.auth.updateUser({ email: patch.email });
      } catch (authErr) {
        console.error('Auth-E-Mail Update fehlgeschlagen:', authErr);
      }
    }

    setCurrentDriverProfile((prev) => ({ ...(prev || {}), ...patch }));
    if (
      Object.prototype.hasOwnProperty.call(patch, 'firstName')
      || Object.prototype.hasOwnProperty.call(patch, 'lastName')
    ) {
      const fullName = [patch.firstName ?? currentDriverProfile?.firstName, patch.lastName ?? currentDriverProfile?.lastName]
        .filter(Boolean)
        .join(' ');
      if (fullName) setCurrentDriverName(fullName);
    }
  };

  const unreadChatTotal = Object.values(unreadByChat || {}).reduce((sum, value) => sum + (value || 0), 0);
  // Live: Profil (und Fahrzeug) auch ohne Fahrten erreichbar, die Demo bleibt wie bisher.
  const noTripsProfileHandler = DEMO_MODE ? undefined : () => setView('profilFahrer');
  const noTripsVehicleHandler = DEMO_MODE ? undefined : () => setView('vehicle');
  const noTripsScreen = currentVehicle
    ? <KeineFahrtTrisar currentVehicle={currentVehicle} onLogout={handleLogout} onOpenProfile={noTripsProfileHandler} onOpenVehicle={noTripsVehicleHandler} />
    : <KeinAuto onLogout={handleLogout} onOpenProfile={noTripsProfileHandler} />;

  const pushLocalJobNote = useCallback((jobId, noteRow) => {
    const normalizedJobId = String(jobId || '').trim();
    const noteText = String(noteRow?.note_text || noteRow?.text || '').trim();
    if (!normalizedJobId || !noteText) return;
    const createdAt = noteRow?.created_at || noteRow?.createdAt || new Date().toISOString();
    const autor = noteRow?.author_name || noteRow?.autor || '';
    const localNote = { text: noteText, autor, createdAt };
    setJobs((prev) => (prev || []).map((job) => (
      job?.id === normalizedJobId
        ? { ...job, notes: [localNote, ...(Array.isArray(job?.notes) ? job.notes : [])] }
        : job
    )));
    setSelectedJob((prev) => (
      prev?.id === normalizedJobId
        ? { ...prev, notes: [localNote, ...(Array.isArray(prev?.notes) ? prev.notes : [])] }
        : prev
    ));
  }, []);

  const persistJobNote = useCallback(async (jobId, noteText) => {
    const normalizedJobId = String(jobId || '').trim();
    const normalizedNote = String(noteText || '').trim();
    if (!isUuid(normalizedJobId) || !normalizedNote) return null;
    const autor = currentDriverName || '';
    const { data, error } = await supabase
      .from('job_notes')
      .insert([{ job_id: normalizedJobId, note_text: normalizedNote, author_name: autor }])
      .select('id,note_text,created_at,author_name')
      .maybeSingle();
    if (error) throw error;
    return data || { note_text: normalizedNote, author_name: autor, created_at: new Date().toISOString() };
  }, [currentDriverName]);

  const handleCancelFromDetails = async (jobId, refusalReason) => {
    const ok = await handleJobAction(jobId, 'refuse', { refusalReason });
    if (!ok) return false;
    if (typeof handleRefreshAll === 'function') {
      await handleRefreshAll();
    }
    setView('list');
    return true;
  };

  const handleEndRideFromDetails = useCallback(async (jobId, notes) => {
    const normalizedJobId = String(jobId || '').trim();
    const ownDriverId = session?.user?.id;
    if (!isUuid(normalizedJobId) || !isUuid(ownDriverId)) return false;
    const noteText = String(notes || '').trim();

    try {
      const primaryUpdate = await supabase
        .from('jobs')
        .update({ status: 'done' })
        .eq('id', normalizedJobId)
        .eq('driver_id', ownDriverId)
        .select('id,status')
        .maybeSingle();

      if (primaryUpdate.error) throw primaryUpdate.error;

      if (!primaryUpdate.data) {
        const assignment = await supabase
          .from('convoy_assignments')
          .select('job_id,response_status')
          .eq('job_id', normalizedJobId)
          .eq('driver_id', ownDriverId)
          .maybeSingle();
        if (assignment.error) throw assignment.error;
        const responseStatus = String(assignment.data?.response_status || '').trim().toLowerCase();
        if (!assignment.data || responseStatus === 'refused') {
          throw new Error(t('app.endRideNoAssignment'));
        }

        const convoyUpdate = await supabase
          .from('jobs')
          .update({ status: 'done' })
          .eq('id', normalizedJobId)
          .select('id,status')
          .maybeSingle();
        if (convoyUpdate.error) throw convoyUpdate.error;
        if (!convoyUpdate.data) throw new Error(t('app.endRideSaveFailed'));
      }

      if (noteText) {
        const noteRow = await persistJobNote(normalizedJobId, noteText);
        if (noteRow) pushLocalJobNote(normalizedJobId, noteRow);
      }

      setJobs((prev) => (prev || []).filter((job) => job?.id !== normalizedJobId));
      setSelectedJob((prev) => (prev?.id === normalizedJobId ? null : prev));
      setView('list');
      return true;
    } catch (error) {
      console.error('Fahrt beenden fehlgeschlagen:', error);
      window.alert(t('app.endRideFailed', { message: error?.message || t('app.unknownError') }));
      return false;
    }
  }, [persistJobNote, pushLocalJobNote, session?.user?.id, t]);

  const handleSendRideNoteFromDetails = useCallback(async (jobId, notes) => {
    const normalizedJobId = String(jobId || '').trim();
    const noteText = String(notes || '').trim();
    if (!isUuid(normalizedJobId) || !noteText) return false;
    try {
      const noteRow = await persistJobNote(normalizedJobId, noteText);
      if (noteRow) pushLocalJobNote(normalizedJobId, noteRow);
      return true;
    } catch (error) {
      console.error('Fahrtnotiz senden fehlgeschlagen:', error);
      window.alert(t('app.noteSaveFailed', { message: error?.message || t('app.unknownError') }));
      return false;
    }
  }, [persistJobNote, pushLocalJobNote, t]);

  const hasFlightNumber = (job) => {
    const flight = `${job?.flight || ''}`.trim().toUpperCase();
    return Boolean(flight) && flight !== 'STADTFAHRT';
  };
  const hasKolonneColleagues = (job, ownDriverId) => {
    if (!job?.isKolonne && !job?.convoyId) return false;
    const drivers = Array.isArray(job?.kolonneDrivers) ? job.kolonneDrivers : [];
    if (!drivers.length) return false;
    const isActive = (driver) => `${driver?.responseStatus || ''}`.toLowerCase() !== 'refused';
    const hasAssignedGuests = (driver) => Array.isArray(driver?.assignedGuests) && driver.assignedGuests.length > 0;

    const otherBookedDrivers = drivers.filter((driver) => {
      if (!driver?.id) return false;
      if (ownDriverId && driver.id === ownDriverId) return false;
      if (!isActive(driver)) return false;
      return hasAssignedGuests(driver);
    });
    if (otherBookedDrivers.length > 0) return true;

    return drivers.some((driver) => {
      if (!driver?.id) return false;
      if (ownDriverId && driver.id === ownDriverId) return false;
      return isActive(driver);
    });
  };
  const renderDetailsSheet = () => {
    if (!selectedJob) return noTripsScreen;
    // Steht vor dieser Fahrt noch eine offene, haengt deren Ziel an der Fahrt:
    // die Karte laesst die Anfahrt dann dort beginnen statt am Standort.
    const vorgaenger = vorherigeOffeneFahrt(jobs, selectedJob);
    const fahrtMitVorlauf = vorgaenger ? { ...selectedJob, vorherigeFahrt: vorgaenger } : selectedJob;
    const withFlightNumber = hasFlightNumber(selectedJob);
    const withKolonneColleagues = hasKolonneColleagues(selectedJob, session?.user?.id);
    // Ungelesene Nachrichten im Kolonnen-Chat dieser Fahrt.
    const ungeleseneKolonnenNachrichten = selectedJob?.convoyId
      ? (unreadByChat?.[`group:${selectedJob.convoyId}`] || 0)
      : 0;

    if (withFlightNumber && withKolonneColleagues) {
      return (
        <KoloneFlughafen
          job={fahrtMitVorlauf}
          setView={setView}
          ungeleseneNachrichten={ungeleseneKolonnenNachrichten}
          onCancelRide={handleCancelFromDetails}
          onEndRide={handleEndRideFromDetails}
          onSendRideNote={handleSendRideNoteFromDetails}
        />
      );
    }
    if (withFlightNumber) {
      return (
        <SoloFlughafen
          job={fahrtMitVorlauf}
          setView={setView}
          onCancelRide={handleCancelFromDetails}
          onEndRide={handleEndRideFromDetails}
          onSendRideNote={handleSendRideNoteFromDetails}
        />
      );
    }
    if (withKolonneColleagues) {
      return (
        <KoloneNormal
          job={fahrtMitVorlauf}
          setView={setView}
          ungeleseneNachrichten={ungeleseneKolonnenNachrichten}
          onCancelRide={handleCancelFromDetails}
          onEndRide={handleEndRideFromDetails}
          onSendRideNote={handleSendRideNoteFromDetails}
        />
      );
    }
    return (
      <SoloNormal
        job={fahrtMitVorlauf}
        setView={setView}
        onCancelRide={handleCancelFromDetails}
        onEndRide={handleEndRideFromDetails}
        onSendRideNote={handleSendRideNoteFromDetails}
      />
    );
  };

  if (authLoading) {
    return <div className="min-h-screen bg-[#0a0a0a]" />;
  }

  if (!session) {
    return (
      <LoginView
        email={loginEmail}
        password={loginPassword}
        setEmail={setLoginEmail}
        setPassword={setLoginPassword}
        onLogin={handleLogin}
        authError={authError}
      />
    );
  }

  const renderViewScreen = (viewName) => {
    switch (viewName) {
      case 'keineFahrt':
        return noTripsScreen;
      case 'list':
        return jobs && jobs.length === 0
          ? noTripsScreen
          : <FahrtenScreen01View jobs={jobs} setView={setView} setSelectedJob={setSelectedJob} handleJobAction={handleJobAction} handleRefreshAll={handleRefreshAll} isRefreshing={isRefreshing} onLogout={handleLogout} onOpenChats={() => setView('chatList')} unreadChatTotal={unreadChatTotal} currentVehicle={currentVehicle} onOpenProfile={() => setView('profilFahrer')} serviceRequests={serviceRequests} onServiceRequestAction={handleServiceRequestAction} serviceActionBusyId={serviceRequestActionBusyId} unreadByChat={unreadByChat} />;
      case 'vehicle':
        return <VehicleView setView={setView} vehicle={currentVehicle} damages={vehicleDamages} onAddDamage={addVehicleDamage} />;
      case 'details':
        return renderDetailsSheet();
      case 'chat':
        return <ChatView setView={setView} activeChat={activeChat} messages={messages} setMessages={setMessages} currentUserId={session?.user?.id} />;
      case 'chatList':
        return <ChatListView chats={availableChats} unreadByChat={unreadByChat} chatLastByChat={chatLastByChat} setView={setView} setActiveChat={setActiveChat} getLastReadValue={(type, id) => getLastReadValue(type, id)} />;
      case 'profilFahrer':
        return <ProfilFahrerView setView={setView} currentDriverName={currentDriverName} jobs={jobs} />;
      case 'verlauf':
        return <Verlauf setView={setView} />;
      case 'settingsFahrer':
        return <SettingsFahrer setView={setView} onLogout={handleLogout} profileData={currentDriverProfile} onSaveProfile={handleSaveDriverProfile} />;
      case 'ansprechpartner':
        return <AnsprechpartnerView setView={setView} />;
      case 'ansprechpartnerDetails':
        return <AnsprechpartnerView setView={setView} backView="details" />;
      case 'supportFooter':
        return <AnsprechpartnerView setView={setView} backView={supportZurueck} />;
      case 'kolonnenChat':
        return <KolonnenChat setView={setView} selectedJob={selectedJob} messages={messages} setMessages={setMessages} currentUserId={session?.user?.id} />;
      default:
        return jobs && jobs.length === 0
          ? noTripsScreen
          : <FahrtenScreen01View jobs={jobs} setView={setView} setSelectedJob={setSelectedJob} handleJobAction={handleJobAction} handleRefreshAll={handleRefreshAll} isRefreshing={isRefreshing} onLogout={handleLogout} onOpenChats={() => setView('chatList')} unreadChatTotal={unreadChatTotal} currentVehicle={currentVehicle} onOpenProfile={() => setView('profilFahrer')} serviceRequests={serviceRequests} onServiceRequestAction={handleServiceRequestAction} serviceActionBusyId={serviceRequestActionBusyId} unreadByChat={unreadByChat} />;
    }
  };

  return (
    <I18nProvider language={currentDriverProfile?.language || 'Deutsch'}>
      <div className="antialiased bg-black min-h-screen">
        {viewStack.map((entry, idx) => {
          const isActive = idx === viewStack.length - 1;
          return (
            <div key={entry.id} className={isActive ? 'block' : 'hidden'}>
              {renderViewScreen(entry.view)}
            </div>
          );
        })}
      </div>
    </I18nProvider>
  );
};

export {
  ChatListView,
  ChatView,
  DetailsView,
  LoginView,
  PassengerCreateView,
  PassengerListView,
  VehicleView,
};

export default FahrerApp;
