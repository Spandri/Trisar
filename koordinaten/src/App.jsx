import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { hasSupabaseAdminConfig, supabase, supabaseAdmin } from './services/supabase';
import HomeScreen from './components/HomeScreen';
import AlleFahrer from './components/views/AlleFahrer';
import AlleKunden from './components/views/AlleKunden';
import ProfilKoordinatorView from './components/views/ProfilKoordinatorView';
import FahrerListeView from './components/views/FahrerListeView';
import KundenListeView from './components/views/KundenListeView';
import FahrzeugeView from './components/views/FahrzeugeView';
import FahrerErstellenView from './components/views/FahrerErstellenView';
import FahrgastErstellenView from './components/views/FahrgastErstellenView';
import FahrzeugErstellenView from './components/views/FahrzeugErstellenView';
import AnsprechpartnerView from './components/views/AnsprechpartnerView';
import VerlaufView from './components/views/VerlaufView';
import SettingsViewKo from './components/views/SettingsViewKo';
import AnkuenfteView from './components/views/AnkuenfteView';
import AbfahrtenView from './components/views/AbfahrtenView';
import FahrtAdd from './components/views/FahrtAdd';
import FahrtBearbeitenView from './components/views/FahrtBearbeitenView';
import KiAssistentView from './components/views/KiAssistentView';
import KartenView from './components/views/KartenView';
import KartenFilterView from './components/views/KartenFilterView';
import FahrtenFilter from './components/views/FahrtenFilter';

const buildTodayIsoDate = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const TODAY_ISO_DATE = buildTodayIsoDate();
const EDGE_FUNCTIONS = {
  externalSync: 'external-sync',
  placesProxy: 'places-proxy',
  flightValidate: 'flight-validate',
  trainValidate: 'train-validate',
  airportBoard: 'airport-board',
};

const ADMIN_FALLBACK_ERROR_RE = /invalid jwt|signature is invalid|not allowed|unauthorized|permission denied|row-level security|42501/i;
const MISSING_DRIVER_NUMBER_COLUMN_RE = /column .*driver_number|could not find the ['"]?driver_number['"]? column/i;
const MISSING_FLIGHT_NUMBER_COLUMN_RE = /column .*flight_number|could not find the ['"]?flight_number['"]? column/i;
const MISSING_TRAIN_NUMBER_COLUMN_RE = /column .*train_number|could not find the ['"]?train_number['"]? column/i;
const MISSING_TRAIN_TIMES_COLUMNS_RE = /column .*train_planned_time|column .*train_predicted_time|could not find the ['"]?train_planned_time['"]? column|could not find the ['"]?train_predicted_time['"]? column/i;
const MISSING_JOBS_EXT_COLUMN_RE = /column .*ext_flight_payload|column .*ext_flight_last_sync_at|could not find the ['"]?ext_flight_payload['"]? column|could not find the ['"]?ext_flight_last_sync_at['"]? column/i;
const MISSING_AI_BOOKED_COLUMN_RE = /column .*ai_booked|could not find the ['"]?ai_booked['"]? column/i;
const MISSING_JOB_NOTES_TABLE_RE = /relation .*job_notes|table .*job_notes|does not exist/i;
const MISSING_CONVOY_ASSIGNMENTS_TABLE_RE = /relation .*convoy_assignments|table .*convoy_assignments|does not exist/i;
const MISSING_JOBS_ARCHIVE_TABLE_RE = /relation .*jobs_archive|table .*jobs_archive|does not exist/i;
const LEGACY_ANON_GUEST_RE = /^anonymer?\s+fahrgast(?:\s+\d+)?$/i;
const AI_BOOKING_NOTE_TAG = '[AI_BOOKED]';
const PROFILE_STORAGE_KEY = 'koordinator_profile_v1';
const DEFAULT_PROFILE_DATA = {
  firstName: 'Stefano',
  lastName: '',
  email: '',
  phone: '+49',
  street: '',
  streetNumber: '',
  city: '',
  zip: '',
  language: 'Deutsch',
  avatarUrl: '',
};
let anonymousAuthUnavailable = false;

const ensureCoordinatorWriteSession = async () => {
  try {
    if (anonymousAuthUnavailable) return false;
    const { data } = await supabase.auth.getSession();
    if (data?.session) return true;
    // Kein signInAnonymously mehr: verhindert 422-Spam bei deaktivierter anonymer Auth.
    anonymousAuthUnavailable = true;
    return false;
  } catch {
    return false;
  }
};

const normalizeLocation = (value) =>
  String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ß/g, 'ss')
    .replace(/[ä]/g, 'a')
    .replace(/[ö]/g, 'o')
    .replace(/[ü]/g, 'u')
    .replace(/ae/g, 'a')
    .replace(/oe/g, 'o')
    .replace(/ue/g, 'u')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const matchesLocation = (haystack, needle) => {
  const left = normalizeLocation(haystack);
  const right = normalizeLocation(needle);
  if (!left || !right) return false;
  return left.includes(right) || right.includes(left);
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

const normalizeClockValue = (value, fallback = '--:--') => {
  const text = String(value || '').trim();
  const match = text.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return fallback;
  const hours = Number.parseInt(match[1], 10);
  const minutes = Number.parseInt(match[2], 10);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return fallback;
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return fallback;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
};

const parseClockToMinutes = (value) => {
  const match = String(value || '').trim().match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const hours = Number.parseInt(match[1], 10);
  const minutes = Number.parseInt(match[2], 10);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return hours * 60 + minutes;
};

const addMinutesToClock = (clockValue, durationMins) => {
  const baseMinutes = parseClockToMinutes(clockValue);
  const plusMinutes = Number(durationMins);
  if (!Number.isFinite(baseMinutes) || !Number.isFinite(plusMinutes) || plusMinutes <= 0) return '';
  const total = ((baseMinutes + plusMinutes) % (24 * 60) + (24 * 60)) % (24 * 60);
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
};

const normalizeRideDateValue = (value, fallback = '') => {
  const raw = String(value || '').trim();
  if (!raw) return fallback;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const dotMatch = raw.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (dotMatch) return `${dotMatch[3]}-${dotMatch[2]}-${dotMatch[1]}`;
  if (/^\d{4}-\d{2}-\d{2}T/.test(raw)) return raw.slice(0, 10);
  return fallback;
};

const mapJobStatusToEditorStatus = (status) => {
  const value = String(status || '').trim().toLowerCase();
  if (value === 'in_progress') return 'unterwegs';
  if (value === 'done') return 'beendet';
  if (value === 'cancelled' || value === 'refused' || value === 'archived') return 'stoniert';
  return 'offen';
};

const mapEditorStatusToJobStatus = (status) => {
  const value = String(status || '').trim().toLowerCase();
  if (value === 'unterwegs') return 'in_progress';
  if (value === 'beendet') return 'done';
  if (value === 'stoniert') return 'cancelled';
  return 'pending';
};

const OPEN_LIKE_JOB_STATUSES = new Set(['pending', 'assigned', 'offen', 'new', 'requested', 'offered', 'zugewiesen', 'at_pickup', 'beim_pickup', 'beim pickup']);
const IN_PROGRESS_LIKE_JOB_STATUSES = new Set(['in_progress', 'unterwegs', 'started', 'on_trip', 'ongoing', 'active']);
const ARCHIVED_LIKE_JOB_STATUSES = new Set(['archived', 'cancelled']);

const normalizeFlightNumberValue = (value) =>
  String(value || '')
    .replace(/\s+/g, '')
    .toUpperCase()
    .trim();

const isSyncableFlightNumber = (value) => /^[A-Z0-9]{2,3}\d{1,4}[A-Z]?$/.test(normalizeFlightNumberValue(value));

const normalizeTrainNumberValue = (value) =>
  String(value || '')
    .replace(/\s+/g, '')
    .toUpperCase()
    .trim();

const isSyncableTrainNumber = (value) => {
  const normalized = normalizeTrainNumberValue(value);
  if (normalized.length < 2 || normalized.length > 12) return false;
  return /\d/.test(normalized);
};

const extractEtaFromFlightSummary = (summary) => {
  const rawValue = String(
    summary?.estimated_arrival_local ||
    summary?.actual_arrival_local ||
    summary?.scheduled_arrival_local ||
    '',
  ).trim();
  if (!rawValue) return '';
  const isoMatch = rawValue.match(/T(\d{2}:\d{2})/);
  if (isoMatch?.[1]) return isoMatch[1];
  const directMatch = rawValue.match(/^(\d{1,2}:\d{2})/);
  if (directMatch?.[1]) return normalizeClockValue(directMatch[1], '');
  return '';
};

const extractArrivalLocationFromFlightSummary = (summary) => {
  const airport = String(summary?.arrival_airport || '').trim();
  const terminal = String(summary?.arrival_terminal || '').trim();
  if (!airport && !terminal) return '';
  if (airport && terminal) return `${airport} Terminal ${terminal}`;
  return airport || `Terminal ${terminal}`;
};

const extractClockFromIsoLike = (value) => {
  const text = String(value || '').trim();
  if (!text) return '';
  const isoMatch = text.match(/T(\d{2}:\d{2})/);
  if (isoMatch?.[1]) return isoMatch[1];
  return normalizeClockValue(text, '');
};

const resolveTrainEtdValues = (trainValidationData, fallbackStartZeit = '') => {
  const summary = trainValidationData?.summary || null;
  const predictedClock = normalizeClockValue(
    trainValidationData?.eta_label || extractClockFromIsoLike(summary?.predicted_arrival),
    '',
  );
  const plannedClock = normalizeClockValue(extractClockFromIsoLike(summary?.planned_arrival), '');
  const fallbackClock = normalizeClockValue(fallbackStartZeit, '');
  const resolvedEtd = predictedClock || fallbackClock || plannedClock || '';
  const resolvedOriginal = plannedClock || fallbackClock || resolvedEtd || '';
  return {
    plannedTime: plannedClock || '',
    predictedTime: predictedClock || '',
    etd: resolvedEtd,
    originalEtd: resolvedOriginal,
  };
};

const buildTrainLivePayload = (trainValidationData, fetchedAtIso = new Date().toISOString()) => {
  const summary = trainValidationData?.summary || null;
  const live = trainValidationData?.live_tracking || null;
  const routeStops = Array.isArray(summary?.route_stops)
    ? summary.route_stops.map((entry) => String(entry || '').trim()).filter(Boolean)
    : (Array.isArray(live?.route_stops)
      ? live.route_stops.map((entry) => String(entry || '').trim()).filter(Boolean)
      : []);
  return {
    provider: 'deutsche_bahn_api',
    fetched_at: fetchedAtIso,
    summary: {
      provider: 'deutsche_bahn_api',
      flight_iata: String(summary?.train_number || '').trim() || null,
      operating_carrier: 'DB',
      operating_flight_number: String(summary?.train_number || '').trim() || null,
      marketing_carrier: 'DB',
      marketing_flight_number: String(summary?.train_number || '').trim() || null,
      flight_status_code: null,
      flight_status_description: 'Train live tracking',
      departure_airport: null,
      departure_terminal: null,
      departure_gate: null,
      arrival_airport: String(summary?.target_station_name || '').trim() || null,
      arrival_terminal: null,
      arrival_gate: null,
      scheduled_departure_local: null,
      estimated_departure_local: null,
      actual_departure_local: null,
      scheduled_arrival_local: String(summary?.planned_arrival || '').trim() || null,
      estimated_arrival_local: String(summary?.predicted_arrival || '').trim() || null,
      actual_arrival_local: null,
      aircraft_code: null,
      aircraft_registration: null,
      aircraft_icao24: null,
      delay_minutes: null,
      route_stops: routeStops,
    },
    live_tracking: live
      ? {
          provider: 'deutsche_bahn_api',
          mode: 'train',
          callsign: String(live?.callsign || summary?.line_name || summary?.train_number || '').trim() || null,
          radar_hex: null,
          latitude: Number(live?.latitude),
          longitude: Number(live?.longitude),
          heading_deg: Number.isFinite(Number(live?.heading_deg)) ? Number(live.heading_deg) : null,
          captured_at: String(live?.captured_at || fetchedAtIso),
          on_ground: false,
          trail_points: Array.isArray(live?.trail_points) ? live.trail_points : [],
          route_stops: routeStops,
        }
      : null,
  };
};

const KNOWN_AIRPORT_IATA_CODES = new Set([
  'MUC', 'FRA', 'BER', 'HAM', 'DUS', 'STR', 'CGN', 'LEJ', 'NUE', 'HAJ', 'BRE', 'DRS',
  'VIE', 'ZRH', 'GVA', 'BRU', 'LUX', 'PRG', 'WAW', 'MAD', 'BCN', 'CDG', 'AMS', 'LHR',
]);

const AIRPORT_KEYWORDS_TO_IATA = [
  ['muenchen', 'MUC'],
  ['munchen', 'MUC'],
  ['münchen', 'MUC'],
  ['frankfurt', 'FRA'],
  ['berlin brandenburg', 'BER'],
  ['hamburg', 'HAM'],
  ['duesseldorf', 'DUS'],
  ['düsseldorf', 'DUS'],
  ['stuttgart', 'STR'],
  ['koeln', 'CGN'],
  ['köln', 'CGN'],
  ['vienna', 'VIE'],
  ['wien', 'VIE'],
  ['zurich', 'ZRH'],
  ['zuerich', 'ZRH'],
  ['zürich', 'ZRH'],
  ['brussels', 'BRU'],
  ['bruessel', 'BRU'],
  ['brüssel', 'BRU'],
  ['luxembourg', 'LUX'],
];

const resolveAirportCodeFromLocation = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const upper = raw.toUpperCase();
  const parenMatch = upper.match(/\(([A-Z]{3})\)/);
  if (parenMatch?.[1] && KNOWN_AIRPORT_IATA_CODES.has(parenMatch[1])) return parenMatch[1];
  const codeCandidates = upper.match(/\b[A-Z]{3}\b/g) || [];
  for (const candidate of codeCandidates) {
    if (KNOWN_AIRPORT_IATA_CODES.has(candidate)) return candidate;
  }
  const normalized = normalizeLocation(raw)
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss');
  for (const [keyword, code] of AIRPORT_KEYWORDS_TO_IATA) {
    if (normalized.includes(keyword)) return code;
  }
  return '';
};

const invokeExternalSyncForJob = async (jobId, reason = 'create') => {
  const normalizedJobId = String(jobId || '').trim();
  if (!normalizedJobId) return { ok: false, error: 'Missing job id' };

  const body = {
    reason,
    job_ids: [normalizedJobId],
    force_refresh: true,
  };

  let invokeResult = await supabase.functions.invoke(EDGE_FUNCTIONS.externalSync, { body });
  if (invokeResult.error && hasSupabaseAdminConfig && ADMIN_FALLBACK_ERROR_RE.test(invokeResult.error.message || '')) {
    invokeResult = await supabaseAdmin.functions.invoke(EDGE_FUNCTIONS.externalSync, { body });
  }

  if (invokeResult.error) {
    return { ok: false, error: invokeResult.error.message || 'external_sync_failed' };
  }
  return { ok: true, data: invokeResult.data };
};

const invokeFlightValidation = async (flightNumber, rideDate, targetAirportHint = '') => {
  const normalizedRideDate = normalizeRideDateValue(rideDate, '');
  if (!normalizedRideDate) {
    return { ok: false, error: 'Bitte ein gültiges Datum für die Flugprüfung eingeben.' };
  }
  const normalizedTargetAirportIata = resolveAirportCodeFromLocation(targetAirportHint);

  const body = {
    flight_number: normalizeFlightNumberValue(flightNumber),
    ride_date: normalizedRideDate,
    require_lufthansa_group: false,
  };
  if (normalizedTargetAirportIata) body.target_airport_iata = normalizedTargetAirportIata;
  let invokeResult = await supabase.functions.invoke(EDGE_FUNCTIONS.flightValidate, { body });
  if (invokeResult.error && hasSupabaseAdminConfig && ADMIN_FALLBACK_ERROR_RE.test(invokeResult.error.message || '')) {
    invokeResult = await supabaseAdmin.functions.invoke(EDGE_FUNCTIONS.flightValidate, { body });
  }
  if (invokeResult.error) {
    return { ok: false, error: invokeResult.error.message || 'flight_validate_failed' };
  }
  return { ok: true, data: invokeResult.data || null };
};

const invokeTrainValidation = async (trainNumber, rideDate, targetStationHint = '') => {
  const normalizedRideDate = normalizeRideDateValue(rideDate, '');
  if (!normalizedRideDate) {
    return { ok: false, error: 'Bitte ein gültiges Datum für die Zugprüfung eingeben.' };
  }
  const body = {
    train_number: normalizeTrainNumberValue(trainNumber),
    ride_date: normalizedRideDate,
    target_station: String(targetStationHint || '').trim(),
  };
  let invokeResult = await supabase.functions.invoke(EDGE_FUNCTIONS.trainValidate, { body });
  if (invokeResult.error && hasSupabaseAdminConfig && ADMIN_FALLBACK_ERROR_RE.test(invokeResult.error.message || '')) {
    invokeResult = await supabaseAdmin.functions.invoke(EDGE_FUNCTIONS.trainValidate, { body });
  }
  if (!invokeResult.error) {
    return { ok: true, data: invokeResult.data || null };
  }

  // Optional fallback endpoint (only if explicitly configured via env).
  const fallbackUrl = String(import.meta.env.VITE_TRAIN_VALIDATE_URL || '').trim();
  const fallbackAnonKey = String(import.meta.env.VITE_TRAIN_VALIDATE_ANON_KEY || '').trim();
  if (!fallbackUrl || !fallbackAnonKey) {
    return { ok: false, error: invokeResult.error.message || 'train_validate_failed' };
  }
  try {
    const response = await fetch(fallbackUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${fallbackAnonKey}`,
        apikey: fallbackAnonKey,
      },
      body: JSON.stringify(body),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      return { ok: false, error: String(payload?.error || `train_validate_http_${response.status}`) };
    }
    return { ok: true, data: payload || null };
  } catch (fallbackError) {
    return {
      ok: false,
      error:
        invokeResult.error.message
        || fallbackError?.message
        || 'train_validate_failed',
    };
  }
};

const invokeAirportBoard = async ({ airportCode, mode, date = TODAY_ISO_DATE, limit = 8 }) => {
  const body = {
    airport_code: String(airportCode || '').trim().toUpperCase(),
    mode,
    date: normalizeRideDateValue(date, TODAY_ISO_DATE),
    limit,
    include_codeshare: false,
  };
  let invokeResult = await supabase.functions.invoke(EDGE_FUNCTIONS.airportBoard, { body });
  if (invokeResult.error && hasSupabaseAdminConfig && ADMIN_FALLBACK_ERROR_RE.test(invokeResult.error.message || '')) {
    invokeResult = await supabaseAdmin.functions.invoke(EDGE_FUNCTIONS.airportBoard, { body });
  }
  if (invokeResult.error) {
    return { ok: false, error: invokeResult.error.message || 'airport_board_failed' };
  }
  return { ok: true, data: invokeResult.data || null };
};

const ACCEPTED_DRIVER_RESPONSE_STATUSES = new Set(['accepted', 'assigned', 'in_progress', 'done', 'arrived', 'completed']);
const REFUSED_DRIVER_RESPONSE_STATUSES = new Set(['refused', 'cancelled', 'canceled', 'declined', 'rejected']);
const IN_QUERY_BATCH_SIZE = 30;

const normalizeDriverResponseStatus = (value, fallback = 'pending') => {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return fallback;
  if (ACCEPTED_DRIVER_RESPONSE_STATUSES.has(normalized)) return 'accepted';
  if (REFUSED_DRIVER_RESPONSE_STATUSES.has(normalized)) return 'refused';
  return 'pending';
};

const deriveDriverResponseFromJobStatus = (status) => normalizeDriverResponseStatus(status, 'pending');

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

const FALLBACK_PLACE_SUGGESTIONS = [
  'Flughafen München (MUC), Nordallee, München-Flughafen, Deutschland',
  'Flughafen Hamburg (HAM), Flughafenstraße, Hamburg, Deutschland',
  'Flughafen Berlin Brandenburg (BER), Willy-Brandt-Platz, Schönefeld, Deutschland',
  'Flughafen Frankfurt am Main (FRA), Frankfurt am Main, Deutschland',
  'Flughafen Stuttgart (STR), Flughafenstraße, Stuttgart, Deutschland',
  'Flughafen Düsseldorf (DUS), Flughafenstraße, Düsseldorf, Deutschland',
  'Hauptbahnhof München, Bayerstraße, München, Deutschland',
  'Hauptbahnhof Hamburg, Hachmannplatz, Hamburg, Deutschland',
  'Hauptbahnhof Berlin, Europaplatz, Berlin, Deutschland',
];

const getFallbackPlaceSuggestions = (input) => {
  const q = normalizeLocation(input);
  if (!q) return [];
  return FALLBACK_PLACE_SUGGESTIONS
    .filter((entry) => normalizeLocation(entry).includes(q))
    .slice(0, 8);
};

const fetchOsmPlaceSuggestions = async (input) => {
  const query = String(input || '').trim();
  if (!query) return [];
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=8&q=${encodeURIComponent(query)}`;
  try {
    const response = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!response.ok) return [];
    const data = await response.json();
    if (!Array.isArray(data)) return [];
    return data
      .map((entry) => String(entry?.display_name || '').trim())
      .filter(Boolean)
      .slice(0, 8);
  } catch {
    return [];
  }
};

const fetchPlacesPredictions = async (input, country = 'de') => {
  const body = { input, country };
  const { data, error } = await supabase.functions.invoke(EDGE_FUNCTIONS.placesProxy, { body });
  if (error) throw error;
  return data?.predictions || [];
};

const buildDriverFullName = (profile) =>
  [profile?.first_name, profile?.last_name]
    .filter(Boolean)
    .join(' ')
    .trim();

const extractDriverNumberToken = (value) => {
  const match = String(value || '').match(/\d+/);
  return match ? match[0] : '';
};

const _buildDriverSuggestionOptions = (profiles = []) => {
  const options = new Set();
  profiles.forEach((profile) => {
    const fullName = buildDriverFullName(profile);
    const driverNumber = profile?.driver_number == null ? '' : String(profile.driver_number).trim();

    if (fullName && driverNumber) {
      options.add(`${fullName} (${driverNumber})`);
      options.add(`${driverNumber} - ${fullName}`);
      return;
    }
    if (fullName) {
      options.add(fullName);
      return;
    }
    if (driverNumber) {
      options.add(driverNumber);
    }
  });
  return Array.from(options);
};

const isDriverProfile = (profile) => {
  const role = normalizeLocation(profile?.role || '');
  if (profile?.is_dispo === true) return false;
  return role !== 'dispo' && role !== 'dispatcher' && role !== 'admin' && role !== 'koordinator' && role !== 'coordinator';
};

const fetchDriverProfilesForLookup = async () => {
  const queryWithDriverNumber = async (client) =>
    client
      .from('profiles')
      .select('id, first_name, last_name, driver_number, role, is_dispo')
      .order('driver_number', { ascending: true, nullsFirst: false });

  const queryWithoutDriverNumber = async (client) =>
    client
      .from('profiles')
      .select('id, first_name, last_name, role, is_dispo')
      .order('first_name', { ascending: true });

  let usedFallbackWithoutDriverNumber = false;

  let profilesResult = await queryWithDriverNumber(supabase);
  if (profilesResult.error && ADMIN_FALLBACK_ERROR_RE.test(profilesResult.error.message || '')) {
    profilesResult = await queryWithDriverNumber(supabaseAdmin);
  }
  if (profilesResult.error && MISSING_DRIVER_NUMBER_COLUMN_RE.test(profilesResult.error.message || '')) {
    usedFallbackWithoutDriverNumber = true;
    profilesResult = await queryWithoutDriverNumber(supabase);
    if (profilesResult.error && ADMIN_FALLBACK_ERROR_RE.test(profilesResult.error.message || '')) {
      profilesResult = await queryWithoutDriverNumber(supabaseAdmin);
    }
  }

  if (profilesResult.error) throw profilesResult.error;

  let cleaned = (profilesResult.data || []).filter(isDriverProfile);
  if (cleaned.length > 0) return cleaned;

  // RLS kann mit dem anon client ohne Fehler leere Ergebnisse liefern.
  // Dann versuchen wir ein zweites Mal mit dem Admin-Client.
  let adminResult = usedFallbackWithoutDriverNumber
    ? await queryWithoutDriverNumber(supabaseAdmin)
    : await queryWithDriverNumber(supabaseAdmin);

  if (adminResult.error && !usedFallbackWithoutDriverNumber && MISSING_DRIVER_NUMBER_COLUMN_RE.test(adminResult.error.message || '')) {
    adminResult = await queryWithoutDriverNumber(supabaseAdmin);
  }

  if (!adminResult.error) {
    cleaned = (adminResult.data || []).filter(isDriverProfile);
  }

  return cleaned;
};

const resolveDriverIdFromInput = (input, profiles = []) => {
  const normalizedInput = normalizeLocation(input);
  if (!normalizedInput) return null;
  const inputNumber = extractDriverNumberToken(input);

  const normalizedProfiles = profiles.map((profile) => {
    const fullName = buildDriverFullName(profile);
    return {
      id: profile?.id || null,
      fullName,
      normalizedFullName: normalizeLocation(fullName),
      driverNumber: profile?.driver_number == null ? '' : String(profile.driver_number).trim(),
    };
  });

  const exactNameMatch = normalizedProfiles.find((profile) => profile.normalizedFullName && profile.normalizedFullName === normalizedInput);
  if (exactNameMatch?.id) return exactNameMatch.id;

  if (inputNumber) {
    const exactNumberMatch = normalizedProfiles.find((profile) => profile.driverNumber && profile.driverNumber === inputNumber);
    if (exactNumberMatch?.id) return exactNumberMatch.id;
  }

  const containsNameMatch = normalizedProfiles.find((profile) => profile.normalizedFullName && (normalizedInput.includes(profile.normalizedFullName) || profile.normalizedFullName.includes(normalizedInput)));
  if (containsNameMatch?.id) return containsNameMatch.id;

  if (inputNumber) {
    const containsNumberMatch = normalizedProfiles.find((profile) => profile.driverNumber && profile.driverNumber.includes(inputNumber));
    if (containsNumberMatch?.id) return containsNumberMatch.id;
  }

  return null;
};

const splitGuestNames = (value) =>
  String(value || '')
    .split(/[\n,;]+/g)
    .map((part) => part.trim())
    .filter(Boolean);

const normalizePassengerNames = (values = []) =>
  (Array.isArray(values) ? values : [values])
    .map((value) => String(value || '').trim())
    .filter(Boolean);

const extractPassengerNames = (passengers) => {
  if (Array.isArray(passengers)) return normalizePassengerNames(passengers);
  if (passengers && typeof passengers === 'object') return normalizePassengerNames(Object.values(passengers));
  if (typeof passengers === 'string') return splitGuestNames(passengers);
  return [];
};

const normalizeDriverNameList = (values = []) =>
  Array.from(
    new Set(
      (Array.isArray(values) ? values : [values])
        .map((value) => String(value || '').trim())
        .filter(Boolean),
    ),
  );

const normalizeDriverNumber = (value) => {
  if (value == null) return '';
  return String(value).trim();
};

const formatDriverNameWithNumber = (name, driverNumber) => {
  const normalizedName = String(name || '').trim();
  const normalizedDriverNumber = normalizeDriverNumber(driverNumber);
  if (normalizedName && normalizedDriverNumber) return `${normalizedName} (${normalizedDriverNumber})`;
  if (normalizedName) return normalizedName;
  if (normalizedDriverNumber) return normalizedDriverNumber;
  return '';
};

const _buildGuestSuggestionOptions = (guests = []) => {
  const options = new Set();
  guests.forEach((guest) => {
    const fullName = [guest?.first_name, guest?.last_name].filter(Boolean).join(' ').trim();
    const email = String(guest?.email || '').trim();
    if (fullName && email) {
      options.add(`${fullName} (${email})`);
      options.add(fullName);
      return;
    }
    if (fullName) {
      options.add(fullName);
      return;
    }
    if (email) {
      options.add(email);
    }
  });
  return Array.from(options);
};

const resolveGuestIdFromInput = (input, guests = []) => {
  const normalizedInput = normalizeLocation(input);
  if (!normalizedInput) return null;

  const normalizedGuests = guests.map((guest) => {
    const fullName = [guest?.first_name, guest?.last_name].filter(Boolean).join(' ').trim();
    const email = String(guest?.email || '').trim();
    return {
      id: guest?.id || null,
      normalizedFullName: normalizeLocation(fullName),
      normalizedEmail: normalizeLocation(email),
    };
  });

  const exactNameMatch = normalizedGuests.find((guest) => guest.normalizedFullName && guest.normalizedFullName === normalizedInput);
  if (exactNameMatch?.id) return exactNameMatch.id;

  const exactEmailMatch = normalizedGuests.find((guest) => guest.normalizedEmail && guest.normalizedEmail === normalizedInput);
  if (exactEmailMatch?.id) return exactEmailMatch.id;

  const containsNameMatch = normalizedGuests.find((guest) => guest.normalizedFullName && (normalizedInput.includes(guest.normalizedFullName) || guest.normalizedFullName.includes(normalizedInput)));
  if (containsNameMatch?.id) return containsNameMatch.id;

  const containsEmailMatch = normalizedGuests.find((guest) => guest.normalizedEmail && (normalizedInput.includes(guest.normalizedEmail) || guest.normalizedEmail.includes(normalizedInput)));
  if (containsEmailMatch?.id) return containsEmailMatch.id;

  return null;
};

// Main App Component
export default function App() {
  const [view, setView] = useState(() => window.history.state?.view || 'list');
  const [rideEditorData, setRideEditorData] = useState(null);
  const [driverEditorData, setDriverEditorData] = useState(null);
  const [guestEditorData, setGuestEditorData] = useState(null);
  const [vehicleEditorData, setVehicleEditorData] = useState(null);
  const [driverDirectory, setDriverDirectory] = useState([]);
  const [guestDirectory, setGuestDirectory] = useState([]);
  const [allRides, setAllRides] = useState([]);
  const [ridesError, setRidesError] = useState('');
  const [coordinatorLocation, setCoordinatorLocation] = useState('');
  const [fahrtenFilter, setFahrtenFilter] = useState({
    startQuery: '',
    zielQuery: '',
    date: '',
    withoutDriver: false,
    requireConfirmation: false,
    konvoi: false,
    withSpecial: false,
    includePast: false,
  });
  const [kartenFilter, setKartenFilter] = useState({
    driverSearch: '',
    selectedDriverIds: [],
    afterWorkMinutes: '',
    vehicleLimosine: false,
    vehicleSuv: false,
    vehicleVan: false,
    vehicleCoupe: false,
  });
  const [airportBoardState, setAirportBoardState] = useState({
    airportCode: '',
    mode: 'arrivals',
    loading: false,
    error: '',
    updatedAt: '',
    items: [],
  });
  const hostRef = useRef(null);
  const isMountedRef = useRef(true);
  const viewRef = useRef(view);
  const scrollByViewRef = useRef({});
  const ridesRefreshTimeoutRef = useRef(null);
  const ridesRefreshInFlightRef = useRef(false);
  const ridesRefreshPendingRef = useRef(false);
  const ridesLastMutationAtRef = useRef(0);
  const locallyArchivedJobIdsRef = useRef(new Set());

  useEffect(() => {
    viewRef.current = view;
  }, [view]);

  useEffect(() => {
    setFahrtenFilter((prev) => (prev?.includePast ? { ...prev, includePast: false } : prev));
  }, []);

  const getActiveScrollContainer = useCallback(() => {
    if (!hostRef.current) return null;
    return hostRef.current.querySelector('div.h-full.overflow-y-auto');
  }, []);

  const captureCurrentScroll = useCallback(() => {
    const activeView = viewRef.current;
    const container = getActiveScrollContainer();
    const scrollTop = container ? container.scrollTop : window.scrollY || 0;
    scrollByViewRef.current[activeView] = scrollTop;
    return scrollTop;
  }, [getActiveScrollContainer]);

  const navigateTo = useCallback(
    (nextView, { replace = false } = {}) => {
      if (!nextView) return;

      const currentView = viewRef.current;
      const currentScrollTop = captureCurrentScroll();
      window.history.replaceState(
        { ...(window.history.state || {}), view: currentView, scrollTop: currentScrollTop },
        '',
      );

      if (nextView === currentView) return;

      const nextScrollTop = scrollByViewRef.current[nextView] ?? 0;
      const nextState = { view: nextView, scrollTop: nextScrollTop };
      if (replace) {
        window.history.replaceState(nextState, '');
      } else {
        window.history.pushState(nextState, '');
      }
      setView(nextView);
    },
    [captureCurrentScroll],
  );

  useEffect(() => {
    const state = window.history.state || {};
    const initialView = state.view || viewRef.current || 'list';
    const initialScrollTop = typeof state.scrollTop === 'number' ? state.scrollTop : 0;
    scrollByViewRef.current[initialView] = initialScrollTop;
    window.history.replaceState({ ...state, view: initialView, scrollTop: initialScrollTop }, '');
  }, []);

  useEffect(() => {
    const onPopState = (event) => {
      captureCurrentScroll();
      const nextView = event.state?.view || 'list';
      setView(nextView);
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [captureCurrentScroll]);

  useEffect(() => {
    const restore = () => {
      const state = window.history.state || {};
      const targetScroll =
        state.view === view && typeof state.scrollTop === 'number'
          ? state.scrollTop
          : scrollByViewRef.current[view] || 0;
      const container = getActiveScrollContainer();
      if (container) {
        container.scrollTop = targetScroll;
      } else {
        window.scrollTo(0, targetScroll);
      }
    };
    requestAnimationFrame(restore);
  }, [view, getActiveScrollContainer]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const loadDriverDirectory = useCallback(async () => {
    try {
      const cleaned = await fetchDriverProfilesForLookup();
      if (!isMountedRef.current) return;
      setDriverDirectory(cleaned);
    } catch {
      if (!isMountedRef.current) return;
      setDriverDirectory([]);
    }
  }, []);

  useEffect(() => {
    loadDriverDirectory();
  }, [loadDriverDirectory]);

  const loadGuestDirectory = useCallback(async () => {
    try {
      let guestsResult = await supabase
        .from('guests')
        .select('id, first_name, last_name, email')
        .order('first_name', { ascending: true })
        .order('last_name', { ascending: true });
      if (guestsResult.error && ADMIN_FALLBACK_ERROR_RE.test(guestsResult.error.message || '')) {
        guestsResult = await supabaseAdmin
          .from('guests')
          .select('id, first_name, last_name, email')
          .order('first_name', { ascending: true })
          .order('last_name', { ascending: true });
      }
      if (guestsResult.error) throw guestsResult.error;
      const rows = guestsResult.data || [];
      if (!isMountedRef.current) return rows;
      setGuestDirectory(rows);
      return rows;
    } catch {
      if (!isMountedRef.current) return [];
      setGuestDirectory([]);
      return [];
    }
  }, []);

  useEffect(() => {
    loadGuestDirectory();
  }, [loadGuestDirectory]);

  const syncConvoyAssignmentsForJob = useCallback(async (jobId, driverIds = [], options = {}) => {
    const normalizedJobId = String(jobId || '').trim();
    if (!normalizedJobId) return false;
    const resetResponseStatus = Boolean(options?.resetResponseStatus);
    const replaceAssignments = Boolean(options?.replaceAssignments);

    const normalizedDriverIds = Array.from(
      new Set((driverIds || []).map((id) => String(id || '').trim()).filter(Boolean)),
    );
    const convoyClient = hasSupabaseAdminConfig ? supabaseAdmin : supabase;
    const fallbackClient = hasSupabaseAdminConfig ? supabase : supabaseAdmin;

    try {
      let existingResult = await convoyClient
        .from('convoy_assignments')
        .select('driver_id, response_status')
        .eq('job_id', normalizedJobId);
      if (existingResult.error && ADMIN_FALLBACK_ERROR_RE.test(existingResult.error.message || '')) {
        existingResult = await fallbackClient
          .from('convoy_assignments')
          .select('driver_id, response_status')
          .eq('job_id', normalizedJobId);
      }
      if (existingResult.error && MISSING_CONVOY_ASSIGNMENTS_TABLE_RE.test(existingResult.error.message || '')) {
        return false;
      }
      if (existingResult.error) throw existingResult.error;

      const existingDriverIds = Array.from(
        new Set(
          (existingResult.data || [])
            .map((row) => String(row?.driver_id || '').trim())
            .filter(Boolean),
        ),
      );
      const existingStatusByDriverId = new Map(
        (existingResult.data || [])
          .map((row) => {
            const driverId = String(row?.driver_id || '').trim();
            if (!driverId) return null;
            const responseStatus = String(row?.response_status || '').trim() || 'pending';
            return [driverId, responseStatus];
          })
          .filter(Boolean),
      );

      if (replaceAssignments) {
        let deleteAllBeforeUpsert = await convoyClient
          .from('convoy_assignments')
          .delete()
          .eq('job_id', normalizedJobId);
        if (deleteAllBeforeUpsert.error && ADMIN_FALLBACK_ERROR_RE.test(deleteAllBeforeUpsert.error.message || '')) {
          deleteAllBeforeUpsert = await fallbackClient
            .from('convoy_assignments')
            .delete()
            .eq('job_id', normalizedJobId);
        }
        if (deleteAllBeforeUpsert.error && !MISSING_CONVOY_ASSIGNMENTS_TABLE_RE.test(deleteAllBeforeUpsert.error.message || '')) {
          throw deleteAllBeforeUpsert.error;
        }
      }

      if (normalizedDriverIds.length > 0) {
        const upsertRows = normalizedDriverIds.map((driverId) => ({
          job_id: normalizedJobId,
          driver_id: driverId,
          response_status: resetResponseStatus ? 'pending' : (existingStatusByDriverId.get(driverId) || 'pending'),
        }));
        let upsertResult = await convoyClient
          .from('convoy_assignments')
          .upsert(upsertRows, { onConflict: 'job_id,driver_id' });
        if (upsertResult.error && ADMIN_FALLBACK_ERROR_RE.test(upsertResult.error.message || '')) {
          upsertResult = await fallbackClient
            .from('convoy_assignments')
            .upsert(upsertRows, { onConflict: 'job_id,driver_id' });
        }
        if (upsertResult.error && !MISSING_CONVOY_ASSIGNMENTS_TABLE_RE.test(upsertResult.error.message || '')) {
          throw upsertResult.error;
        }
      }

      if (normalizedDriverIds.length === 0) {
        let deleteAllResult = await convoyClient
          .from('convoy_assignments')
          .delete()
          .eq('job_id', normalizedJobId);
        if (deleteAllResult.error && ADMIN_FALLBACK_ERROR_RE.test(deleteAllResult.error.message || '')) {
          deleteAllResult = await fallbackClient
            .from('convoy_assignments')
            .delete()
            .eq('job_id', normalizedJobId);
        }
        if (deleteAllResult.error && !MISSING_CONVOY_ASSIGNMENTS_TABLE_RE.test(deleteAllResult.error.message || '')) {
          throw deleteAllResult.error;
        }
        return true;
      }

      const desiredIdSet = new Set(normalizedDriverIds);
      const staleDriverIds = existingDriverIds.filter((driverId) => !desiredIdSet.has(driverId));
      if (!replaceAssignments && staleDriverIds.length > 0) {
        let deleteStaleResult = await convoyClient
          .from('convoy_assignments')
          .delete()
          .eq('job_id', normalizedJobId)
          .in('driver_id', staleDriverIds);
        if (deleteStaleResult.error && ADMIN_FALLBACK_ERROR_RE.test(deleteStaleResult.error.message || '')) {
          deleteStaleResult = await fallbackClient
            .from('convoy_assignments')
            .delete()
            .eq('job_id', normalizedJobId)
            .in('driver_id', staleDriverIds);
        }
        if (deleteStaleResult.error && !MISSING_CONVOY_ASSIGNMENTS_TABLE_RE.test(deleteStaleResult.error.message || '')) {
          throw deleteStaleResult.error;
        }
      }

      return true;
    } catch (error) {
      console.warn('⚠️ convoy_assignments konnten nicht vollständig synchronisiert werden:', error);
      return false;
    }
  }, []);

  const [profileData, setProfileData] = useState(() => {
    try {
      const raw = window.localStorage.getItem(PROFILE_STORAGE_KEY);
      if (!raw) return { ...DEFAULT_PROFILE_DATA };
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return { ...DEFAULT_PROFILE_DATA };
      return { ...DEFAULT_PROFILE_DATA, ...parsed };
    } catch {
      return { ...DEFAULT_PROFILE_DATA };
    }
  });
  const coordinatorName = [profileData.firstName, profileData.lastName].filter(Boolean).join(' ').trim() || 'Stefano';

  useEffect(() => {
    try {
      window.localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(profileData));
    } catch {
      // Ignoriere Storage-Fehler (z. B. quota exceeded).
    }
  }, [profileData]);

  const loadRidesFromDb = useCallback(async () => {
      console.log('🚀 loadRidesFromDb wird ausgeführt...');
      setRidesError('');
      try {
        const jobSelectBase = 'id, driver_id, pickup_name, pickup_address, dropoff_name, dropoff_address, ride_date, etd, original_etd, status, convoy_id, passengers, anonymous_guests, created_at, ext_flight_payload, ext_flight_last_sync_at, train_planned_time, train_predicted_time, ext_route_duration_mins, ext_route_duration_in_traffic_mins';
        const jobSelectCandidates = [
          `${jobSelectBase}, ai_booked, flight_number, train_number`,
          `${jobSelectBase}, flight_number, train_number`,
          `${jobSelectBase}, ai_booked, train_number`,
          `${jobSelectBase}, train_number`,
          `${jobSelectBase}, ai_booked, flight_number`,
          `${jobSelectBase}, flight_number`,
          `${jobSelectBase}, ai_booked`,
          jobSelectBase,
        ];
        console.log('📊 Lade Jobs aus Supabase...');
        let jobsResult = null;
        for (const selectValue of jobSelectCandidates) {
          jobsResult = await supabase
            .from('jobs')
            .select(selectValue)
            .order('ride_date', { ascending: true })
            .order('etd', { ascending: true });
          if (jobsResult.error && ADMIN_FALLBACK_ERROR_RE.test(jobsResult.error.message || '')) {
              jobsResult = await supabaseAdmin
                .from('jobs')
                .select(selectValue)
                .order('ride_date', { ascending: true })
                .order('etd', { ascending: true });
          }
          if (!jobsResult.error) break;
          const isMissingKnownColumn =
            MISSING_FLIGHT_NUMBER_COLUMN_RE.test(jobsResult.error.message || '')
            || MISSING_AI_BOOKED_COLUMN_RE.test(jobsResult.error.message || '')
            || MISSING_TRAIN_TIMES_COLUMNS_RE.test(jobsResult.error.message || '')
            || MISSING_JOBS_EXT_COLUMN_RE.test(jobsResult.error.message || '');
          if (!isMissingKnownColumn) break;
        }
        console.log('✅ Jobs-Ergebnis:', jobsResult);
        if (jobsResult.error) {
          console.error('❌ Fehler beim Laden der Jobs:', jobsResult.error);
          throw jobsResult.error;
        }

        const jobs = jobsResult.data || [];
        console.log(`📦 ${jobs.length} Jobs geladen`);
        if (jobs.length > 0) {
          console.log('Beispiel-Job:', jobs[0]);
          console.log('🔍 Beispiel-Job passengers:', jobs[0]?.passengers);
        }
        const jobDriverIds = Array.from(new Set(jobs.map((job) => String(job?.driver_id || '').trim()).filter(Boolean)));
        const jobIds = jobs.map((job) => String(job?.id || '').trim()).filter(Boolean);
        const convoyIds = Array.from(new Set(jobs.map((job) => String(job?.convoy_id || '').trim()).filter(Boolean)));
        console.log('📋 IDs extrahiert:', { driverIds: jobDriverIds.length, jobIds: jobIds.length, convoyIds: convoyIds.length });

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

        console.log('🧩 Lade Konvoi-Zuordnungen...');
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
        console.log('✅ Konvoi-Zuordnungen geladen:', convoyAssignmentsResult.data?.length || 0);

        const convoyAssignmentDriverIds = Array.from(
          new Set(
            (convoyAssignmentsResult.data || [])
              .map((row) => String(row?.driver_id || '').trim())
              .filter(Boolean),
          ),
        );
        const driverIds = Array.from(new Set([...jobDriverIds, ...convoyAssignmentDriverIds]));

        console.log('👤 Lade Profile...');
        const profilesResult = await runInBatches({
          ids: driverIds,
          queryChunk: async (batch) => {
            let result = await supabase.from('profiles').select('id, first_name, last_name, driver_number').in('id', batch);
            if (result.error && ADMIN_FALLBACK_ERROR_RE.test(result.error.message || '')) {
              result = await supabaseAdmin.from('profiles').select('id, first_name, last_name, driver_number').in('id', batch);
            }
            return result;
          },
        });
        if (profilesResult.error) throw profilesResult.error;
        console.log('✅ Profile geladen:', profilesResult.data?.length || 0);

        console.log('👥 Lade Job-Gäste...');
        const jobGuestsResult = await runInBatches({
          ids: jobIds,
          queryChunk: async (batch) => {
            let result = await supabase.from('job_guests').select('job_id, guest_id, is_main_contact').in('job_id', batch);
            if (result.error && ADMIN_FALLBACK_ERROR_RE.test(result.error.message || '')) {
              result = await supabaseAdmin.from('job_guests').select('job_id, guest_id, is_main_contact').in('job_id', batch);
            }
            return result;
          },
        });
        if (jobGuestsResult.error) throw jobGuestsResult.error;
        console.log('✅ Job-Gäste geladen:', jobGuestsResult.data?.length || 0);

        console.log('📝 Lade Job-Notizen...');
        const jobNotesResult = await runInBatches({
          ids: jobIds,
          queryChunk: async (batch) => {
            let result = await supabase
              .from('job_notes')
              .select('job_id, note_text, created_at')
              .in('job_id', batch)
              .order('created_at', { ascending: false });
            if (result.error && ADMIN_FALLBACK_ERROR_RE.test(result.error.message || '')) {
              result = await supabaseAdmin
                .from('job_notes')
                .select('job_id, note_text, created_at')
                .in('job_id', batch)
                .order('created_at', { ascending: false });
            }
            return result;
          },
          tolerateError: (error) => MISSING_JOB_NOTES_TABLE_RE.test(error?.message || ''),
        });
        if (jobNotesResult.error) throw jobNotesResult.error;
        console.log('✅ Job-Notizen geladen:', jobNotesResult.data?.length || 0);
        let archivedJobIdsFromDb = [];
        if (jobIds.length > 0) {
          const archivedResult = await runInBatches({
            ids: jobIds,
            queryChunk: async (batch) => {
              let result = await supabase
                .from('jobs_archive')
                .select('job_id')
                .in('job_id', batch);
              if (result.error && ADMIN_FALLBACK_ERROR_RE.test(result.error.message || '')) {
                result = await supabaseAdmin
                  .from('jobs_archive')
                  .select('job_id')
                  .in('job_id', batch);
              }
              return result;
            },
            tolerateError: (error) =>
              MISSING_JOBS_ARCHIVE_TABLE_RE.test(error?.message || '')
              || /status code:\s*401|permission denied|not authorized/i.test(error?.message || ''),
          });
          if (!archivedResult.error) {
            archivedJobIdsFromDb = (archivedResult.data || [])
              .map((row) => String(row?.job_id || '').trim())
              .filter(Boolean);
          }
        }
        const archivedJobIdSet = new Set([
          ...Array.from(locallyArchivedJobIdsRef.current || []),
          ...archivedJobIdsFromDb,
        ]);
        console.log('✅ Archiv-IDs aktiv:', archivedJobIdSet.size);
        const guestIds = Array.from(new Set((jobGuestsResult.data || []).map((row) => String(row?.guest_id || '').trim()).filter(Boolean)));
        console.log('🆔 Gast-IDs extrahiert:', guestIds.length);
        const guestsResult = await runInBatches({
          ids: guestIds,
          queryChunk: async (batch) => {
            let result = await supabase.from('guests').select('id, first_name, last_name').in('id', batch);
            if (result.error && ADMIN_FALLBACK_ERROR_RE.test(result.error.message || '')) {
              result = await supabaseAdmin.from('guests').select('id, first_name, last_name').in('id', batch);
            }
            return result;
          },
        });
        if (guestsResult.error) throw guestsResult.error;
        console.log('✅ Gäste geladen:', guestsResult.data?.length || 0);

        console.log('🚐 Lade Konvois...');
        const convoysResult = await runInBatches({
          ids: convoyIds,
          queryChunk: async (batch) => {
            let result = await supabase.from('convoys').select('id, name').in('id', batch);
            if (result.error && ADMIN_FALLBACK_ERROR_RE.test(result.error.message || '')) {
              result = await supabaseAdmin.from('convoys').select('id, name').in('id', batch);
            }
            return result;
          },
        });
        if (convoysResult.error) throw convoysResult.error;
        console.log('✅ Konvois geladen:', convoysResult.data?.length || 0);

        console.log('🗺️  Erstelle Maps für Lookup...');

        const profileById = new Map((profilesResult.data || []).map((row) => [String(row.id || ''), row]));
        const guestById = new Map((guestsResult.data || []).map((row) => [String(row.id || ''), row]));
        const convoyNameById = new Map((convoysResult.data || []).map((row) => [String(row.id || ''), String(row.name || '').trim()]));
        const noteByJobId = new Map();
        (jobNotesResult.data || []).forEach((row) => {
          const jobId = String(row?.job_id || '').trim();
          if (!jobId || noteByJobId.has(jobId)) return;
          const rawText = String(row?.note_text || '').trim();
          noteByJobId.set(jobId, {
            noteText: rawText.replace(AI_BOOKING_NOTE_TAG, '').trim(),
            aiBooked: rawText.includes(AI_BOOKING_NOTE_TAG),
          });
        });

        const convoyDriverAssignmentsByJob = new Map();
        (convoyAssignmentsResult.data || []).forEach((row) => {
          const jobId = String(row?.job_id || '').trim();
          const assignmentDriverId = String(row?.driver_id || '').trim();
          const responseStatus = normalizeDriverResponseStatus(row?.response_status || 'pending');
          if (!jobId || !assignmentDriverId) return;
          if (!convoyDriverAssignmentsByJob.has(jobId)) convoyDriverAssignmentsByJob.set(jobId, []);
          convoyDriverAssignmentsByJob.get(jobId).push({ driverId: assignmentDriverId, responseStatus });
        });

        const guestLinksByJob = new Map();
        (jobGuestsResult.data || []).forEach((row) => {
          const jobId = String(row?.job_id || '').trim();
          if (!jobId) return;
          if (!guestLinksByJob.has(jobId)) guestLinksByJob.set(jobId, []);
          guestLinksByJob.get(jobId).push(row);
        });

        console.log('🔄 Starte Mapping von Jobs zu Fahrten...');
        const mappedRides = jobs.map((job) => {
          const jobId = String(job.id || '').trim();
          const driverId = String(job.driver_id || '').trim();
          const pickupName = String(job.pickup_name || '').trim();
          const pickupAddress = String(job.pickup_address || '').trim();
          const dropoffName = String(job.dropoff_name || '').trim();
          const dropoffAddress = String(job.dropoff_address || '').trim();
          const startLabel = extractLocationLabel(pickupName, pickupAddress);
          const zielLabel = extractLocationLabel(dropoffName, dropoffAddress);
          const startEditorValue = pickupAddress || pickupName || startLabel;
          const zielEditorValue = dropoffAddress || dropoffName || zielLabel;
          const route = `${startLabel} - ${zielLabel}`;
          const profile = driverId ? profileById.get(driverId) : null;
          const profileToDriverEntry = (row, fallbackId = '', responseStatus = 'pending') => {
            const name = [row?.first_name, row?.last_name].filter(Boolean).join(' ').trim();
            const driverNumber = normalizeDriverNumber(row?.driver_number);
            return {
              id: String(row?.id || fallbackId || '').trim(),
              name,
              driverNumber,
              responseStatus: normalizeDriverResponseStatus(responseStatus),
              label: formatDriverNameWithNumber(name, driverNumber),
            };
          };
          const assignmentRows = convoyDriverAssignmentsByJob.get(jobId) || [];
          const assignmentStatusByDriverId = new Map();
          assignmentRows.forEach((row) => {
            const assignmentDriverId = String(row?.driverId || '').trim();
            if (!assignmentDriverId) return;
            const nextStatus = normalizeDriverResponseStatus(row?.responseStatus || 'pending');
            const prevStatus = assignmentStatusByDriverId.get(assignmentDriverId);
            if (!prevStatus || prevStatus === 'pending') {
              assignmentStatusByDriverId.set(assignmentDriverId, nextStatus);
              return;
            }
            if (prevStatus === 'refused' && nextStatus === 'accepted') {
              assignmentStatusByDriverId.set(assignmentDriverId, nextStatus);
            }
          });
          const primaryDriverResponseStatus = assignmentStatusByDriverId.get(driverId) || deriveDriverResponseFromJobStatus(job.status);
          const primaryDriverEntry = profile ? profileToDriverEntry(profile, driverId, primaryDriverResponseStatus) : null;
          const assignmentDriverIds = Array.from(new Set(assignmentRows.map((row) => String(row?.driverId || '').trim()).filter(Boolean)));
          const assignmentDriverEntries = assignmentDriverIds
            .map((assignedDriverId) => profileToDriverEntry(
              profileById.get(assignedDriverId),
              assignedDriverId,
              assignmentStatusByDriverId.get(assignedDriverId) || 'pending',
            ))
            .filter((entry) => Boolean(entry?.label));
          const mergedDriverEntriesByKey = new Map();
          [primaryDriverEntry, ...assignmentDriverEntries]
            .filter(Boolean)
            .forEach((entry) => {
              const normalizedId = String(entry.id || '').trim();
              const normalizedName = normalizeLocation(entry.name);
              const dedupeKey = normalizedId || normalizedName;
              if (!dedupeKey) return;
              const existingEntry = mergedDriverEntriesByKey.get(dedupeKey);
              if (!existingEntry) {
                mergedDriverEntriesByKey.set(dedupeKey, entry);
                return;
              }
              const mergedStatus = normalizeDriverResponseStatus(
                existingEntry.responseStatus === 'accepted' || entry.responseStatus === 'accepted'
                  ? 'accepted'
                  : existingEntry.responseStatus === 'refused' || entry.responseStatus === 'refused'
                    ? 'refused'
                    : 'pending',
              );
              mergedDriverEntriesByKey.set(dedupeKey, {
                ...existingEntry,
                ...entry,
                label: existingEntry.label || entry.label,
                responseStatus: mergedStatus,
              });
            });
          const mergedDriverEntries = Array.from(mergedDriverEntriesByKey.values());
          const mergedDriverLabels = mergedDriverEntries
            .map((entry) => String(entry?.label || '').trim())
            .filter(Boolean);
          const mergedDriverResponses = mergedDriverEntries
            .map((entry) => normalizeDriverResponseStatus(entry?.responseStatus || 'pending'))
            .filter(Boolean);
          const mergedDriverNumbers = mergedDriverEntries
            .map((entry) => normalizeDriverNumber(entry?.driverNumber))
            .filter(Boolean);
          const hasDrivers = mergedDriverLabels.length > 0;
          const hasAcceptedDriver = mergedDriverResponses.some((statusValue) => statusValue === 'accepted');
          const driverName = hasDrivers ? mergedDriverLabels.join(', ') : 'Fahrer fehlt';
          const fahrerNamen = hasDrivers ? mergedDriverLabels : [''];
          const singleDriverNumber = hasDrivers && mergedDriverEntries.length === 1
            ? (mergedDriverEntries[0].driverNumber || null)
            : null;
          const hasConvoy = String(job.convoy_id || '').trim().length > 0 || mergedDriverEntries.length > 1;
          const vehicleCount = hasConvoy ? String(Math.max(1, mergedDriverEntries.length || 1)) : '';
          const linkedGuests = guestLinksByJob.get(jobId) || [];
          const sortedGuests = [...linkedGuests].sort((a, b) => Number(Boolean(b?.is_main_contact)) - Number(Boolean(a?.is_main_contact)));
          const firstGuest = guestById.get(String(sortedGuests[0]?.guest_id || '').trim());
          const guestNames = sortedGuests
            .map((link) => guestById.get(String(link?.guest_id || '').trim()))
            .filter(Boolean)
            .map((guest) => [guest.first_name, guest.last_name].filter(Boolean).join(' ').trim())
            .filter(Boolean);
          const guestName = [firstGuest?.first_name, firstGuest?.last_name].filter(Boolean).join(' ').trim();
          const passengerNamesRaw = extractPassengerNames(job?.passengers);
          const legacyAnonPassengerCount = passengerNamesRaw.filter((name) => LEGACY_ANON_GUEST_RE.test(name)).length;
          const passengerNames = passengerNamesRaw.filter((name) => !LEGACY_ANON_GUEST_RE.test(name));
          const explicitAnonymousCount = Math.max(0, Number.parseInt(String(job.anonymous_guests || '0'), 10) || 0);
          const totalAnonymousCount = Math.max(explicitAnonymousCount, legacyAnonPassengerCount);
          const hasPassengersObject = Array.isArray(job?.passengers)
            || (typeof job?.passengers === 'object' && job?.passengers !== null);
          console.log(`📋 Job ${jobId} - guestNames (from job_guests):`, guestNames, '| passengerNames:',passengerNames);
          // Wenn passengers als Objekt vorhanden ist (auch leer), gilt es als Source of Truth.
          const effectiveGuestNames = hasPassengersObject
            ? passengerNames
            : (guestNames.length > 0 ? guestNames : passengerNames);
          const primaryGuestName = guestName || effectiveGuestNames[0] || '';
          let etd = normalizeClockValue(job.etd, '');
          let originalEtd = normalizeClockValue(job.original_etd, '');
          const normalizedJobStatusFromRow = String(job.status || '').trim().toLowerCase();
          const normalizedJobStatus = archivedJobIdSet.has(jobId) ? 'archived' : normalizedJobStatusFromRow;
          const editorStatus = mapJobStatusToEditorStatus(normalizedJobStatus);
          const fahrgaesteText = effectiveGuestNames.join(', ');
          const flugnummer = String(job.flight_number || '').trim();
          const zugnummer = String(job.train_number || '').trim();
          const trainPlannedTime = normalizeClockValue(job.train_planned_time, '');
          const trainPredictedTime = normalizeClockValue(job.train_predicted_time, '');
          const trainSummary = (job.ext_flight_payload && typeof job.ext_flight_payload === 'object')
            ? job.ext_flight_payload.summary || null
            : null;
          if (zugnummer && trainSummary) {
            const plannedFromSummary = normalizeClockValue(
              extractClockFromIsoLike(trainSummary?.scheduled_arrival_local),
              '',
            );
            const predictedFromSummary = normalizeClockValue(
              extractClockFromIsoLike(trainSummary?.estimated_arrival_local),
              '',
            );
            if (predictedFromSummary && !trainPredictedTime) etd = predictedFromSummary;
            if (plannedFromSummary && !trainPlannedTime) originalEtd = plannedFromSummary;
          }
          if (zugnummer) {
            if (trainPredictedTime) etd = trainPredictedTime;
            if (trainPlannedTime) originalEtd = trainPlannedTime;
          }
          const isUnderway = IN_PROGRESS_LIKE_JOB_STATUSES.has(normalizedJobStatus);
          const isOpenLike = OPEN_LIKE_JOB_STATUSES.has(normalizedJobStatus);
          const rideDate = normalizeRideDateValue(job.ride_date, TODAY_ISO_DATE);
          const now = new Date();
          const nowClock = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
          const isTodayRide = rideDate === TODAY_ISO_DATE;
          const plannedEtd = originalEtd || etd || '';
          const plannedEtdMinutes = parseClockToMinutes(plannedEtd);
          const nowMinutes = parseClockToMinutes(nowClock);
          const shouldShiftEtdWithDelay = isTodayRide && isOpenLike && Number.isFinite(plannedEtdMinutes) && Number.isFinite(nowMinutes) && nowMinutes > plannedEtdMinutes;
          const delayMins = shouldShiftEtdWithDelay ? Math.max(0, nowMinutes - plannedEtdMinutes) : 0;
          const effectiveEtd = shouldShiftEtdWithDelay ? nowClock : (etd || originalEtd || '');
          const routeDurationInTrafficMins = Number(job.ext_route_duration_in_traffic_mins);
          const routeDurationMins = Number(job.ext_route_duration_mins);
          const selectedRouteDurationMins = Number.isFinite(routeDurationInTrafficMins) && routeDurationInTrafficMins > 0
            ? routeDurationInTrafficMins
            : (Number.isFinite(routeDurationMins) && routeDurationMins > 0 ? routeDurationMins : 0);
          const arrivalReferenceClock = isUnderway ? nowClock : effectiveEtd;
          const arrivalNew = addMinutesToClock(arrivalReferenceClock, selectedRouteDurationMins)
            || addMinutesToClock(effectiveEtd, selectedRouteDurationMins)
            || addMinutesToClock(originalEtd, selectedRouteDurationMins)
            || arrivalReferenceClock
            || effectiveEtd
            || originalEtd
            || '--:--';
          const arrivalOriginal = addMinutesToClock(originalEtd, selectedRouteDurationMins)
            || addMinutesToClock(effectiveEtd, selectedRouteDurationMins)
            || originalEtd
            || effectiveEtd
            || '--:--';
          const isDelayed = delayMins > 0 || Boolean(effectiveEtd && originalEtd && effectiveEtd !== originalEtd);
          const noteMeta = noteByJobId.get(jobId) || { noteText: '', aiBooked: false };
          const aiBookedFromColumn = Boolean(job?.ai_booked);

          console.log('🚗 Mappe Job:', jobId, '| Route:', route, '| Datum:', rideDate, '| Zeit:', effectiveEtd);

          return {
            id: jobId,
            sourceView: 'ankuenfte',
            name: primaryGuestName || startLabel,
            allGuestNames: effectiveGuestNames,
            route,
            startLocation: startEditorValue,
            zielLocation: zielEditorValue,
            start: startEditorValue,
            ziel: zielEditorValue,
            startZeit: effectiveEtd || originalEtd || '--:--',
            fahrerNamen,
            fahrerAntworten: hasDrivers ? mergedDriverResponses : [],
            fahrerNummern: mergedDriverNumbers,
            anonymeGaeste: String(totalAnonymousCount),
            anzahlFahrgaeste: String(Math.max(1, effectiveGuestNames.length || (primaryGuestName ? 1 : 0))),
            fahrgaeste: fahrgaesteText,
            anzahlKinder: '',
            aktuellerStatus: editorStatus,
            anzahlFahrzeuge: vehicleCount,
            driverNumber: singleDriverNumber,
            driver: driverName,
            konvoi: convoyNameById.get(String(job.convoy_id || '').trim()) || (hasConvoy ? 'Kolonne' : ''),
            flugnummer,
            zugnummer,
            note: noteMeta.noteText || '',
            aiBooked: Boolean(aiBookedFromColumn || noteMeta.aiBooked),
            time: isDelayed
              ? {
                  original: originalEtd || effectiveEtd || '--:--',
                  status: '',
                  new: effectiveEtd || originalEtd || '--:--',
                  arrivalOriginal,
                  arrivalNew,
                  arrivalTime: arrivalNew,
                }
              : {
                  status: '',
                  time: effectiveEtd || '--:--',
                  arrivalTime: arrivalNew,
                  arrivalOriginal,
                  arrivalNew,
                },
            delayMins,
            status: isDelayed ? 'delayed' : 'default',
            variant: hasDrivers ? 'default' : 'variant2',
            date: rideDate,
            confirmed: hasAcceptedDriver,
            jobStatus: normalizedJobStatus,
          };
        });

        console.log(`✨ ${mappedRides.length} Fahrten gemappt`);
        if (mappedRides.length > 0) {
          console.log('Beispiel-Fahrt:', mappedRides[0]);
        }
        setAllRides(mappedRides);
        console.log('✅ Fahrten erfolgreich geladen!');
      } catch (error) {
        console.error('❌ FEHLER beim Laden der Fahrten:', error);
        console.error('Fehler-Details:', error.message, error);
        if (!isMountedRef.current) return;
        setAllRides([]);
        setRidesError(error?.message || 'Fahrten konnten nicht geladen werden.');
      }
    }, []);

  const triggerRidesRefresh = useCallback(() => {
    if (!isMountedRef.current) return;
    if (ridesRefreshInFlightRef.current) {
      ridesRefreshPendingRef.current = true;
      return;
    }
    ridesRefreshInFlightRef.current = true;
    Promise.resolve(loadRidesFromDb())
      .finally(() => {
        ridesRefreshInFlightRef.current = false;
        if (ridesRefreshPendingRef.current) {
          ridesRefreshPendingRef.current = false;
          triggerRidesRefresh();
        }
      });
  }, [loadRidesFromDb]);

  const scheduleRidesRefresh = useCallback((delayMs = 250) => {
    if (!isMountedRef.current) return;
    if (delayMs <= 0) {
      triggerRidesRefresh();
      return;
    }
    if (ridesRefreshTimeoutRef.current) {
      window.clearTimeout(ridesRefreshTimeoutRef.current);
    }
    ridesRefreshTimeoutRef.current = window.setTimeout(() => {
      ridesRefreshTimeoutRef.current = null;
      triggerRidesRefresh();
    }, delayMs);
  }, [triggerRidesRefresh]);

  useEffect(() => {
    triggerRidesRefresh();
  }, [triggerRidesRefresh]);

  useEffect(() => {
    let isDisposed = false;
    let ridesChannel = null;
    let reconnectTimerId = null;
    let reconnectAttempts = 0;
    let isConnecting = false;

    const clearReconnectTimer = () => {
      if (reconnectTimerId) {
        window.clearTimeout(reconnectTimerId);
        reconnectTimerId = null;
      }
    };

    const cleanupChannel = () => {
      const channel = ridesChannel;
      ridesChannel = null;
      if (!channel) return;
      try {
        supabase.removeChannel(channel);
      } catch (error) {
        console.warn('⚠️ Channel cleanup fehlgeschlagen:', error);
      }
    };

    const scheduleReconnect = () => {
      if (isDisposed) return;
      if (reconnectTimerId) return;
      const nextDelayMs = Math.min(5000, 500 * (2 ** reconnectAttempts));
      reconnectAttempts += 1;
      clearReconnectTimer();
      reconnectTimerId = window.setTimeout(() => {
        reconnectTimerId = null;
        connectRealtime();
      }, nextDelayMs);
    };

    const connectRealtime = async () => {
      if (isDisposed || isConnecting) return;
      isConnecting = true;
      cleanupChannel();
      try {
        await ensureCoordinatorWriteSession();
        if (isDisposed) return;

        const onRealtimeChange = () => {
          scheduleRidesRefresh(0);
        };

        ridesChannel = supabase
          .channel(`koordinator-rides-live-${Date.now()}`)
          .on('postgres_changes', { event: '*', schema: 'public', table: 'jobs' }, onRealtimeChange)
          .on('postgres_changes', { event: '*', schema: 'public', table: 'convoy_assignments' }, onRealtimeChange)
          .on('postgres_changes', { event: '*', schema: 'public', table: 'job_guests' }, onRealtimeChange)
          .on('postgres_changes', { event: '*', schema: 'public', table: 'job_notes' }, onRealtimeChange)
          .subscribe((status) => {
            if (isDisposed) return;
            if (status === 'SUBSCRIBED') {
              reconnectAttempts = 0;
              clearReconnectTimer();
              scheduleRidesRefresh(0);
              return;
            }
            if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
              scheduleRidesRefresh(0);
              cleanupChannel();
              scheduleReconnect();
            }
          });
      } catch (error) {
        if (!isDisposed) {
          console.error('❌ Realtime initialisieren fehlgeschlagen:', error);
          scheduleReconnect();
        }
      } finally {
        isConnecting = false;
      }
    };

    connectRealtime();

    // Realtime ist primär; Polling nur als Fallback bei kurzzeitigen Socket-Problemen.
    const pollId = window.setInterval(() => {
      scheduleRidesRefresh(0);
    }, 60000);

    const onVisibilityChange = () => {
      if (!document.hidden) {
        scheduleRidesRefresh(0);
        if (!ridesChannel) connectRealtime();
      }
    };
    const onFocus = () => {
      scheduleRidesRefresh(0);
      if (!ridesChannel) connectRealtime();
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('focus', onFocus);

    return () => {
      window.clearInterval(pollId);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('focus', onFocus);
      clearReconnectTimer();
      if (ridesRefreshTimeoutRef.current) {
        window.clearTimeout(ridesRefreshTimeoutRef.current);
        ridesRefreshTimeoutRef.current = null;
      }
      ridesRefreshPendingRef.current = false;
      isDisposed = true;
      cleanupChannel();
    };
  }, [scheduleRidesRefresh]);

  const hasCoordinatorLocation = normalizeLocation(coordinatorLocation).length > 0;
  const archivedRides = useMemo(
    () => allRides.filter((ride) => ARCHIVED_LIKE_JOB_STATUSES.has(String(ride?.jobStatus || '').trim().toLowerCase())),
    [allRides],
  );
  const activeRides = useMemo(
    () => allRides.filter((ride) => !ARCHIVED_LIKE_JOB_STATUSES.has(String(ride?.jobStatus || '').trim().toLowerCase())),
    [allRides],
  );
  const ankuenfteRides = useMemo(() => {
    if (!hasCoordinatorLocation) return activeRides;
    return activeRides.filter((ride) => matchesLocation(ride?.zielLocation || '', coordinatorLocation));
  }, [activeRides, coordinatorLocation, hasCoordinatorLocation]);

  const abfahrtenRides = useMemo(() => {
    if (!hasCoordinatorLocation) return activeRides;
    return activeRides.filter((ride) => matchesLocation(ride?.startLocation || '', coordinatorLocation));
  }, [activeRides, coordinatorLocation, hasCoordinatorLocation]);
  const archivedAnkuenfteRides = useMemo(() => {
    if (!hasCoordinatorLocation) return archivedRides;
    return archivedRides.filter((ride) => matchesLocation(ride?.zielLocation || '', coordinatorLocation));
  }, [archivedRides, coordinatorLocation, hasCoordinatorLocation]);

  const archivedAbfahrtenRides = useMemo(() => {
    if (!hasCoordinatorLocation) return archivedRides;
    return archivedRides.filter((ride) => matchesLocation(ride?.startLocation || '', coordinatorLocation));
  }, [archivedRides, coordinatorLocation, hasCoordinatorLocation]);

  const resolvedAirportCode = useMemo(
    () => resolveAirportCodeFromLocation(coordinatorLocation),
    [coordinatorLocation],
  );

  const refreshAirportBoard = useCallback(async (mode = 'arrivals') => {
    const normalizedMode = mode === 'departures' ? 'departures' : 'arrivals';
    if (!hasCoordinatorLocation) {
      setAirportBoardState({
        airportCode: '',
        mode: normalizedMode,
        loading: false,
        error: '',
        updatedAt: '',
        items: [],
      });
      return;
    }
    if (!resolvedAirportCode) {
      setAirportBoardState({
        airportCode: '',
        mode: normalizedMode,
        loading: false,
        error: '',
        updatedAt: '',
        items: [],
      });
      return;
    }

    setAirportBoardState((prev) => ({
      ...prev,
      airportCode: resolvedAirportCode,
      mode: normalizedMode,
      loading: true,
      error: '',
    }));

    const boardResult = await invokeAirportBoard({
      airportCode: resolvedAirportCode,
      mode: normalizedMode,
      date: TODAY_ISO_DATE,
      limit: 8,
    });

    if (!boardResult.ok) {
      setAirportBoardState((prev) => ({
        ...prev,
        airportCode: resolvedAirportCode,
        mode: normalizedMode,
        loading: false,
        error: boardResult.error || 'Flughafenboard konnte nicht geladen werden.',
      }));
      return;
    }

    const boardError = String(boardResult.data?.error || '').trim();
    setAirportBoardState({
      airportCode: resolvedAirportCode,
      mode: normalizedMode,
      loading: false,
      error: boardError,
      updatedAt: String(boardResult.data?.fetched_at || new Date().toISOString()),
      items: Array.isArray(boardResult.data?.items) ? boardResult.data.items : [],
    });
  }, [hasCoordinatorLocation, resolvedAirportCode]);

  useEffect(() => {
    if (view !== 'ankuenfte' && view !== 'abfahrten') return undefined;
    const mode = view === 'abfahrten' ? 'departures' : 'arrivals';
    let cancelled = false;

    const runRefresh = async () => {
      if (cancelled) return;
      await refreshAirportBoard(mode);
    };

    runRefresh();
    const pollId = window.setInterval(runRefresh, 60000);
    return () => {
      cancelled = true;
      window.clearInterval(pollId);
    };
  }, [view, refreshAirportBoard]);

  const validateFlightForSave = useCallback(async (flightNumber, rideDate, targetAirportHint = '') => {
    const normalizedFlightNumber = normalizeFlightNumberValue(flightNumber);
    if (!normalizedFlightNumber) {
      return { ok: true, valid: false, skipped: true };
    }
    if (!isSyncableFlightNumber(normalizedFlightNumber)) {
      return {
        ok: false,
        error: 'Ungültige Flugnummer. Bitte z. B. LH1625 eingeben.',
      };
    }

    const normalizedRideDate = normalizeRideDateValue(rideDate, '');
    if (!normalizedRideDate) {
      return {
        ok: false,
        error: 'Bitte ein gültiges Datum eingeben, damit der Flug geprüft werden kann.',
      };
    }

    const validationResult = await invokeFlightValidation(normalizedFlightNumber, normalizedRideDate, targetAirportHint);
    if (!validationResult.ok) {
      return {
        ok: false,
        error: `Flugprüfung fehlgeschlagen: ${validationResult.error || 'Unbekannter Fehler'}`,
      };
    }

    if (!validationResult.data?.valid) {
      return {
        ok: false,
        error: validationResult.data?.message || 'Flug nicht validierbar.',
      };
    }

    return {
      ok: true,
      valid: true,
      data: validationResult.data,
    };
  }, []);

  const validateFlightForDisplay = useCallback(async (flightNumber, rideDate, targetAirportHint = '') => {
    const normalizedFlightNumber = normalizeFlightNumberValue(flightNumber);
    if (!normalizedFlightNumber) {
      return { status: 'empty', etaLabel: '', valid: false, startLocation: '' };
    }
    if (!isSyncableFlightNumber(normalizedFlightNumber)) {
      return { status: 'invalid', etaLabel: 'NaN', valid: false, startLocation: '' };
    }

    const normalizedRideDate = normalizeRideDateValue(rideDate, '');
    if (!normalizedRideDate) {
      return { status: 'missing_date', etaLabel: 'NaN', valid: false, startLocation: '' };
    }

    const validationResult = await invokeFlightValidation(normalizedFlightNumber, normalizedRideDate, targetAirportHint);
    if (!validationResult.ok) {
      return { status: 'error', etaLabel: 'NaN', valid: false, startLocation: '' };
    }
    if (validationResult.data?.reason === 'multiple_matches') {
      return { status: 'multi', etaLabel: 'Multi', valid: false, startLocation: '' };
    }
    if (!validationResult.data?.valid) {
      const provider = String(validationResult.data?.provider || '').trim();
      const fallbackReason = String(validationResult.data?.fallback_reason || '').trim();
      const etaLabel = provider === 'aviationstack' || fallbackReason ? 'AVA' : 'NaN';
      return { status: 'invalid', etaLabel, valid: false, startLocation: '' };
    }

    const summary = validationResult.data?.summary || null;
    const etaLabel = extractEtaFromFlightSummary(summary);
    const startLocation = extractArrivalLocationFromFlightSummary(summary);
    if (!etaLabel) {
      const provider = String(validationResult.data?.provider || '').trim();
      return { status: 'unknown_eta', etaLabel: provider === 'aviationstack' ? 'AVA' : 'NaN', valid: true, startLocation };
    }

    return { status: 'ok', etaLabel, valid: true, startLocation };
  }, []);

  const validateTrainForSave = useCallback(async (trainNumber, rideDate, targetStationHint = '') => {
    const normalizedTrainNumber = normalizeTrainNumberValue(trainNumber);
    if (!normalizedTrainNumber) {
      return { ok: true, valid: false, skipped: true };
    }
    if (!isSyncableTrainNumber(normalizedTrainNumber)) {
      return {
        ok: false,
        error: 'Ungültige Zugnummer. Bitte z. B. ICE515 oder RE1 eingeben.',
      };
    }

    const normalizedRideDate = normalizeRideDateValue(rideDate, '');
    if (!normalizedRideDate) {
      return {
        ok: false,
        error: 'Bitte ein gültiges Datum eingeben, damit der Zug geprüft werden kann.',
      };
    }

    const validationResult = await invokeTrainValidation(normalizedTrainNumber, normalizedRideDate, targetStationHint);
    if (!validationResult.ok) {
      return {
        ok: false,
        error: `Zugprüfung fehlgeschlagen: ${validationResult.error || 'Unbekannter Fehler'}`,
      };
    }
    if (validationResult.data?.reason === 'multiple_matches') {
      return {
        ok: false,
        error: 'Mehrere passende Züge gefunden. Bitte Zugnummer präzisieren.',
      };
    }
    if (!validationResult.data?.valid) {
      return {
        ok: false,
        error: validationResult.data?.message || 'Zug nicht validierbar.',
      };
    }

    return {
      ok: true,
      valid: true,
      data: validationResult.data,
    };
  }, []);

  const validateTrainForDisplay = useCallback(async (trainNumber, rideDate, targetStationHint = '') => {
    const normalizedTrainNumber = normalizeTrainNumberValue(trainNumber);
    if (!normalizedTrainNumber) {
      return { status: 'empty', etaLabel: '', valid: false, startLocation: '' };
    }
    if (!isSyncableTrainNumber(normalizedTrainNumber)) {
      return { status: 'invalid', etaLabel: 'NaN', valid: false, startLocation: '' };
    }

    const normalizedRideDate = normalizeRideDateValue(rideDate, '');
    if (!normalizedRideDate) {
      return { status: 'missing_date', etaLabel: 'NaN', valid: false, startLocation: '' };
    }

    const validationResult = await invokeTrainValidation(normalizedTrainNumber, normalizedRideDate, targetStationHint);
    if (!validationResult.ok) {
      return { status: 'error', etaLabel: 'NaN', valid: false, startLocation: '' };
    }
    if (validationResult.data?.reason === 'multiple_matches') {
      return { status: 'multi', etaLabel: 'Multi', valid: false, startLocation: '' };
    }
    if (!validationResult.data?.valid) {
      return { status: 'invalid', etaLabel: 'NaN', valid: false, startLocation: '' };
    }

    const etaLabel = String(validationResult.data?.eta_label || '').trim();
    const startLocation = String(validationResult.data?.target_station || '').trim();
    if (!etaLabel) {
      return { status: 'unknown_eta', etaLabel: 'NaN', valid: true, startLocation };
    }
    return { status: 'ok', etaLabel, valid: true, startLocation };
  }, []);

  const openRideEditor = useCallback(
    (rideData) => {
      const normalizedRideId = String(rideData?.rideId || rideData?.id || '').trim();
      if (!normalizedRideId) return;
      setRideEditorData({
        ...(rideData || {}),
        rideId: normalizedRideId,
        id: normalizedRideId,
      });
      navigateTo('fahrtBearbeiten');
    },
    [navigateTo],
  );

  const openRideEditorById = useCallback((rideId) => {
    const normalizedRideId = String(rideId || '').trim();
    if (!normalizedRideId) return;
    const ride = allRides.find((entry) => String(entry?.id || '').trim() === normalizedRideId);
    if (ride) {
      const routeParts = String(ride.route || '').split(' - ');
      setRideEditorData({
        rideId: normalizedRideId,
        id: normalizedRideId,
        sourceView: 'ankuenfte',
        datum: String(ride.date || '').slice(0, 10),
        startZeit: String(ride.startZeit || ride.time?.new || ride.time?.time || ride.time?.original || ''),
        start: String(ride.start || routeParts[0] || '').trim(),
        ziel: String(ride.ziel || routeParts.slice(1).join(' - ') || '').trim(),
        konvoi: ride.konvoi || '',
        anzahlFahrzeuge: String(ride.anzahlFahrzeuge || ''),
        fahrerNamen: Array.isArray(ride.fahrerNamen) && ride.fahrerNamen.length > 0 ? ride.fahrerNamen : [''],
        anzahlFahrgaeste: String(ride.anzahlFahrgaeste || '1'),
        anonymeGaeste: String(ride.anonymeGaeste || '0'),
        fahrgaeste: ride.fahrgaeste || ride.name || '',
        flugnummer: String(ride.flugnummer || ''),
        zugnummer: String(ride.zugnummer || ''),
        anzahlKinder: String(ride.anzahlKinder || '0'),
        aktuellerStatus: String(ride.aktuellerStatus || 'offen'),
        notes: String(ride.note || ''),
        aiBooked: Boolean(ride.aiBooked),
      });
      navigateTo('fahrtBearbeiten');
      return;
    }
    setRideEditorData({
      rideId: normalizedRideId,
      id: normalizedRideId,
      sourceView: 'ankuenfte',
      datum: TODAY_ISO_DATE,
      startZeit: '',
      start: '',
      ziel: '',
      konvoi: '',
      anzahlFahrzeuge: '',
      fahrerNamen: [''],
      anzahlFahrgaeste: '1',
      anonymeGaeste: '0',
      fahrgaeste: '',
      flugnummer: '',
      zugnummer: '',
      anzahlKinder: '0',
      aktuellerStatus: 'offen',
      notes: '',
      aiBooked: true,
    });
    navigateTo('fahrtBearbeiten');
  }, [allRides, navigateTo]);
  const openDriverCreate = useCallback(() => {
    setDriverEditorData(null);
    navigateTo('fahrerErstellen');
  }, [navigateTo]);

  const openDriverEditor = useCallback(
    (driverData) => {
      if (!driverData?.id) return;
      setDriverEditorData(driverData);
      navigateTo('fahrerBearbeiten');
    },
    [navigateTo],
  );
  const openGuestCreate = useCallback(() => {
    setGuestEditorData(null);
    navigateTo('fahrgastErstellen');
  }, [navigateTo]);
  const openGuestEditor = useCallback(
    (guestData) => {
      if (!guestData?.id) return;
      setGuestEditorData(guestData);
      navigateTo('fahrgastBearbeiten');
    },
    [navigateTo],
  );
  const openVehicleEditor = useCallback(
    (vehicleData) => {
      if (!vehicleData?.id) return;
      setVehicleEditorData(vehicleData);
      navigateTo('fahrzeugBearbeiten');
    },
    [navigateTo],
  );

  const handleSaveRideEdit = useCallback(async (payload) => {
    const rideId = String(
      payload?.rideId ||
      payload?.id ||
      rideEditorData?.rideId ||
      rideEditorData?.id ||
      '',
    ).trim();
    if (!rideId) return { ok: false, error: 'Ungültige Fahrt-ID.' };

    const start = String(payload?.start || '').trim();
    const ziel = String(payload?.ziel || '').trim();
    if (!start || !ziel) {
      return { ok: false, error: 'Bitte Start und Ziel ausfüllen.' };
    }

    const rideDate = normalizeRideDateValue(payload?.datum, '');
    if (!rideDate) {
      return { ok: false, error: 'Bitte ein gültiges Datum eingeben.' };
    }
    let startZeit = normalizeClockValue(payload?.startZeit, '');
    const konvoiName = String(payload?.konvoi || '').trim();
    const requestedDriverNames = normalizeDriverNameList(
      Array.isArray(payload?.fahrerNamen) && payload?.fahrerNamen.length > 0
        ? payload.fahrerNamen
        : [payload?.fahrer || ''],
    );
    const typedGuestNames = splitGuestNames(payload?.fahrgaeste);
    console.log('👥 handleSaveRideEdit - Gästeliste vor Split:', payload?.fahrgaeste);
    console.log('👥 handleSaveRideEdit - Gästeliste nach Split:', typedGuestNames);
    const anonymousCount = Math.max(0, Number.parseInt(String(payload?.anonymeGaeste || '0').trim(), 10));
    const effectiveGuestNames = [...typedGuestNames];
    console.log('👥 handleSaveRideEdit - Gesamte Gästeliste:', effectiveGuestNames);
    const normalizedFlightNumber = normalizeFlightNumberValue(payload?.flugnummer);
    const normalizedTrainNumber = normalizeTrainNumberValue(payload?.zugnummer);
    if (normalizedFlightNumber && normalizedTrainNumber) {
      return { ok: false, error: 'Bitte nur Flugnummer oder Zugnummer ausfüllen.' };
    }
    const flightValidation = await validateFlightForSave(normalizedFlightNumber, rideDate, start);
    if (!flightValidation.ok) {
      return { ok: false, error: flightValidation.error || 'Flug konnte nicht validiert werden.' };
    }
    const trainValidation = await validateTrainForSave(normalizedTrainNumber, rideDate, start);
    if (!trainValidation.ok) {
      return { ok: false, error: trainValidation.error || 'Zug konnte nicht validiert werden.' };
    }
    const hasValidatedFlight = Boolean(flightValidation.valid);
    const hasValidatedTrain = Boolean(trainValidation.valid);
    const trainEtdValues = hasValidatedTrain
      ? resolveTrainEtdValues(trainValidation.data, startZeit)
      : { plannedTime: '', predictedTime: '', etd: startZeit, originalEtd: startZeit };
    startZeit = trainEtdValues.etd || startZeit;
    const trainLivePayload = hasValidatedTrain
      ? buildTrainLivePayload(trainValidation.data, new Date().toISOString())
      : null;

    try {
      if (!hasSupabaseAdminConfig) {
        await ensureCoordinatorWriteSession();
      }

      let resolvedConvoyId = null;
      if (konvoiName) {
        let convoysResult = await supabase.from('convoys').select('id, name').ilike('name', konvoiName).limit(1);
        if (convoysResult.error && ADMIN_FALLBACK_ERROR_RE.test(convoysResult.error.message || '')) {
          convoysResult = await supabaseAdmin.from('convoys').select('id, name').ilike('name', konvoiName).limit(1);
        }
        if (convoysResult.error) throw convoysResult.error;
        resolvedConvoyId = convoysResult.data?.[0]?.id || null;
      }

      let driverLookupProfiles = Array.isArray(driverDirectory) ? driverDirectory : [];
      let resolvedDriverIds = Array.from(
        new Set(
          requestedDriverNames
            .map((name) => resolveDriverIdFromInput(name, driverLookupProfiles))
            .filter(Boolean),
        ),
      );
      if (requestedDriverNames.length > 0 && resolvedDriverIds.length < requestedDriverNames.length) {
        const latestDrivers = await fetchDriverProfilesForLookup();
        if (latestDrivers.length > 0) {
          driverLookupProfiles = latestDrivers;
          resolvedDriverIds = Array.from(
            new Set(
              requestedDriverNames
                .map((name) => resolveDriverIdFromInput(name, latestDrivers))
                .filter(Boolean),
            ),
          );
          if (isMountedRef.current && latestDrivers.length > 0) setDriverDirectory(latestDrivers);
        }
      }
      const unresolvedDriverNames = requestedDriverNames.filter((name) => !resolveDriverIdFromInput(name, driverLookupProfiles));
      if (requestedDriverNames.length > 0 && resolvedDriverIds.length === 0) {
        return {
          ok: false,
          error: `Fahrer konnte nicht zugeordnet werden: ${requestedDriverNames.join(', ')}. Bitte Fahrer aus der Vorschlagsliste wählen.`,
        };
      }
      if (unresolvedDriverNames.length > 0) {
        return {
          ok: false,
          error: `Diese Fahrer konnten nicht aufgelöst werden: ${unresolvedDriverNames.join(', ')}.`,
        };
      }
      const fallbackDriverId = String(
        payload?.driverId
        || payload?.driver_id
        || rideEditorData?.driverId
        || rideEditorData?.driver_id
        || '',
      ).trim();
      let existingJobDriverId = '';
      if (!fallbackDriverId) {
        let existingJobResult = await supabase
          .from('jobs')
          .select('driver_id')
          .eq('id', rideId)
          .maybeSingle();
        if (existingJobResult.error && ADMIN_FALLBACK_ERROR_RE.test(existingJobResult.error.message || '')) {
          existingJobResult = await supabaseAdmin
            .from('jobs')
            .select('driver_id')
            .eq('id', rideId)
            .maybeSingle();
        }
        if (!existingJobResult.error) {
          existingJobDriverId = String(existingJobResult.data?.driver_id || '').trim();
        }
      }

      const resolvedDriverId = resolvedDriverIds[0] || fallbackDriverId || existingJobDriverId || null;
      const requestedJobStatus = mapEditorStatusToJobStatus(payload?.aktuellerStatus);
      const normalizedRequestedStatus = String(requestedJobStatus || '').trim().toLowerCase();
      const shouldReRequestDriverResponse = Boolean(resolvedDriverId)
        && !['done', 'completed', 'cancelled', 'canceled', 'refused'].includes(normalizedRequestedStatus);
      const nextJobStatus = shouldReRequestDriverResponse ? 'pending' : requestedJobStatus;
      const shouldSyncConvoyAssignments = Boolean(resolvedConvoyId) || requestedDriverNames.length > 1 || resolvedDriverIds.length > 1;
      const assignmentDriverIds = shouldSyncConvoyAssignments
        ? resolvedDriverIds
        : (resolvedDriverId ? [resolvedDriverId] : []);

      const updatePayload = {
        pickup_name: start,
        pickup_address: start,
        dropoff_name: ziel,
        dropoff_address: ziel,
        ride_date: rideDate,
        etd: (hasValidatedTrain ? trainEtdValues.etd : startZeit) || null,
        original_etd: (hasValidatedTrain ? trainEtdValues.originalEtd : startZeit) || null,
        status: nextJobStatus,
        convoy_id: resolvedConvoyId,
        driver_id: resolvedDriverId,
        passengers: normalizePassengerNames(effectiveGuestNames),
        flight_number: hasValidatedFlight ? normalizedFlightNumber : null,
        train_number: hasValidatedTrain ? normalizedTrainNumber : null,
        train_planned_time: hasValidatedTrain ? (trainEtdValues.plannedTime || null) : null,
        train_predicted_time: hasValidatedTrain ? (trainEtdValues.predictedTime || null) : null,
        trip_type: hasValidatedFlight ? 'airport' : hasValidatedTrain ? 'train' : 'normal',
        ext_flight_payload: hasValidatedTrain ? trainLivePayload : hasValidatedFlight ? null : null,
        ext_flight_last_sync_at: hasValidatedTrain ? new Date().toISOString() : null,
        anonymous_guests: anonymousCount,
        ai_booked: Boolean(payload?.aiBooked ?? rideEditorData?.aiBooked),
      };

      console.log('🎯 Daten zum Speichern:');
      console.log('   effectiveGuestNames Array:', effectiveGuestNames);
      console.log('   passengers Array:', updatePayload.passengers);
      console.log('   passengers Type:', Array.isArray(updatePayload.passengers) ? 'array' : typeof updatePayload.passengers);

      const runJobUpdate = async (client, data) => (
        client
          .from('jobs')
          .update(data)
          .eq('id', rideId)
          .select('id, passengers')
      );
      const hasUpdatedRows = (result) => Array.isArray(result?.data) && result.data.length > 0;

      let updateResult = await runJobUpdate(supabase, updatePayload);
      if (
        (updateResult.error && ADMIN_FALLBACK_ERROR_RE.test(updateResult.error.message || ''))
        || (!updateResult.error && !hasUpdatedRows(updateResult) && hasSupabaseAdminConfig)
      ) {
        updateResult = await runJobUpdate(supabaseAdmin, updatePayload);
      }
      if (updateResult.error && (MISSING_FLIGHT_NUMBER_COLUMN_RE.test(updateResult.error.message || '') || MISSING_TRAIN_NUMBER_COLUMN_RE.test(updateResult.error.message || '') || MISSING_TRAIN_TIMES_COLUMNS_RE.test(updateResult.error.message || '') || MISSING_AI_BOOKED_COLUMN_RE.test(updateResult.error.message || '') || MISSING_JOBS_EXT_COLUMN_RE.test(updateResult.error.message || ''))) {
        const fallbackPayload = { ...updatePayload };
        if (MISSING_FLIGHT_NUMBER_COLUMN_RE.test(updateResult.error.message || '')) delete fallbackPayload.flight_number;
        if (MISSING_TRAIN_NUMBER_COLUMN_RE.test(updateResult.error.message || '')) delete fallbackPayload.train_number;
        if (MISSING_TRAIN_TIMES_COLUMNS_RE.test(updateResult.error.message || '')) {
          delete fallbackPayload.train_planned_time;
          delete fallbackPayload.train_predicted_time;
        }
        if (MISSING_AI_BOOKED_COLUMN_RE.test(updateResult.error.message || '')) delete fallbackPayload.ai_booked;
        if (MISSING_JOBS_EXT_COLUMN_RE.test(updateResult.error.message || '')) {
          delete fallbackPayload.ext_flight_payload;
          delete fallbackPayload.ext_flight_last_sync_at;
        }
        updateResult = await runJobUpdate(supabase, fallbackPayload);
        if (
          (updateResult.error && ADMIN_FALLBACK_ERROR_RE.test(updateResult.error.message || ''))
          || (!updateResult.error && !hasUpdatedRows(updateResult) && hasSupabaseAdminConfig)
        ) {
          updateResult = await runJobUpdate(supabaseAdmin, fallbackPayload);
        }
      }
      console.log('📤 UPDATE-Payload wurde gespeichert:', updatePayload);
      console.log('📊 UPDATE-Ergebnis:', updateResult);

      if (updateResult.error) throw updateResult.error;
      if (!hasUpdatedRows(updateResult)) {
        throw new Error('Fahrt konnte nicht aktualisiert werden (keine Schreibrechte oder Fahrt nicht gefunden).');
      }
      const updatedRow = Array.isArray(updateResult.data) ? (updateResult.data[0] || null) : null;
      if (updatedRow) {
        console.log('🔍 DEBUG - Nach UPDATE gespeichert in DB:', updatedRow.passengers || {});
      } else {
        console.log('🔍 DEBUG - UPDATE ohne Returning-Row abgeschlossen (status):', updateResult.status);
      }

      if (hasValidatedFlight) {
        const syncResult = await invokeExternalSyncForJob(rideId, 'manual_refresh');
        if (!syncResult.ok) {
          console.warn('⚠️ external-sync (ride edit) fehlgeschlagen:', syncResult.error);
        }
      }

      await syncConvoyAssignmentsForJob(
        rideId,
        assignmentDriverIds,
        { resetResponseStatus: true, replaceAssignments: true },
      );

      const noteText = String(payload?.notes || payload?.note || '').trim();
      const keepAiBookedTag = Boolean(payload?.aiBooked ?? rideEditorData?.aiBooked);
      const combinedNoteText = [keepAiBookedTag ? AI_BOOKING_NOTE_TAG : '', noteText].filter(Boolean).join('\n').trim();
      let deleteNotesResult = await supabase.from('job_notes').delete().eq('job_id', rideId);
      if (deleteNotesResult.error && ADMIN_FALLBACK_ERROR_RE.test(deleteNotesResult.error.message || '')) {
        deleteNotesResult = await supabaseAdmin.from('job_notes').delete().eq('job_id', rideId);
      }
      if (deleteNotesResult.error && !MISSING_JOB_NOTES_TABLE_RE.test(deleteNotesResult.error.message || '')) {
        throw deleteNotesResult.error;
      }

      if (combinedNoteText && !MISSING_JOB_NOTES_TABLE_RE.test(deleteNotesResult.error?.message || '')) {
        let noteResult = await supabase.from('job_notes').insert({ job_id: rideId, note_text: combinedNoteText });
        if (noteResult.error && ADMIN_FALLBACK_ERROR_RE.test(noteResult.error.message || '')) {
          noteResult = await supabaseAdmin.from('job_notes').insert({ job_id: rideId, note_text: combinedNoteText });
        }
        if (noteResult.error && !MISSING_JOB_NOTES_TABLE_RE.test(noteResult.error.message || '')) {
          throw noteResult.error;
        }
      }

      // Aktualisiere job_guests-Verknüpfungen
      let guestsForResolve = guestDirectory;
      if (guestsForResolve.length === 0) {
        const latestGuests = await loadGuestDirectory();
        guestsForResolve = Array.isArray(latestGuests) ? latestGuests : [];
      }

      // 1. Lösche alte job_guests-Einträge für diesen Job (auch wenn die neue Gästeliste leer ist)
      // Admin-Client direkt verwenden wenn verfügbar – Supabase RLS blockiert DELETE mit anon-Client
      // still (kein Fehler, aber 0 Zeilen gelöscht), weshalb die Fehler-Fallback-Logik nicht greift.
      const jobGuestsClient = hasSupabaseAdminConfig ? supabaseAdmin : supabase;
      console.log('🗑️  Lösche alte job_guests-Einträge für Job:', rideId);
      let deleteResult = await jobGuestsClient.from('job_guests').delete().eq('job_id', rideId);
      if (deleteResult.error) {
        console.warn('⚠️  DELETE fehlgeschlagen:', deleteResult.error);
        if (!hasSupabaseAdminConfig && ADMIN_FALLBACK_ERROR_RE.test(deleteResult.error.message || '')) {
          deleteResult = await supabaseAdmin.from('job_guests').delete().eq('job_id', rideId);
          console.log('🗑️  DELETE mit admin client:', deleteResult);
        }
      } else {
        console.log('✅ DELETE erfolgreich, gelöschte Zeilen:', deleteResult.count);
      }

      // 2. Erstelle NEUE job_guests-Einträge NUR FÜR AUFGELÖSTE GÄSTE
      // (Namen die nicht aufgelöst werden können, bleiben im passengers Array)
      console.log('📋 Verfügbare Gäste in guestDirectory:', guestsForResolve.length);
      
      const guestLinks = effectiveGuestNames
        .map((guestName, index) => {
          const guestId = resolveGuestIdFromInput(guestName, guestsForResolve);
          if (guestId) {
            console.log(`✅ Gast "${guestName}" -> ID: ${guestId}`);
          } else {
            console.log(`⚠️  Gast "${guestName}" -> nicht in Datenbank (wird im passengers Array gespeichert)`);
          }
          return {
            guest_id: guestId,
            is_main_contact: index === 0,
            guest_name: guestName,
          };
        });

      const validGuestLinks = guestLinks.filter((entry) => Boolean(entry.guest_id));
      console.log('👥 Gültige Gast-Links zum Speichern in job_guests:', validGuestLinks);

      const uniqueGuestLinks = [];
      const seenGuestIds = new Set();
      validGuestLinks.forEach((entry) => {
        const key = String(entry.guest_id);
        if (seenGuestIds.has(key)) {
          console.log(`  Duplikat ignoriert: ${entry.guest_name}`);
          return;
        }
        seenGuestIds.add(key);
        uniqueGuestLinks.push(entry);
      });

      console.log('👥 Eindeutige Gast-Links:', uniqueGuestLinks.length);
      if (uniqueGuestLinks.length > 0) {
        let jobGuestResult = await jobGuestsClient
          .from('job_guests')
          .upsert(
            uniqueGuestLinks.map((entry) => ({ job_id: rideId, guest_id: entry.guest_id, is_main_contact: entry.is_main_contact })),
            { onConflict: 'job_id,guest_id' },
          );
        if (jobGuestResult.error) {
          console.error('❌ job_guests INSERT-Fehler:', jobGuestResult.error);
          if (!hasSupabaseAdminConfig && ADMIN_FALLBACK_ERROR_RE.test(jobGuestResult.error.message || '')) {
            jobGuestResult = await supabaseAdmin
              .from('job_guests')
              .upsert(
                uniqueGuestLinks.map((entry) => ({ job_id: rideId, guest_id: entry.guest_id, is_main_contact: entry.is_main_contact })),
                { onConflict: 'job_id,guest_id' },
              );
            console.log('✅ job_guests INSERT mit admin client:', jobGuestResult);
          } else {
            console.error('❌ INSERT fehlgeschlagen:', jobGuestResult.error);
          }
        } else {
          console.log('✅ job_guests INSERT erfolgreich:', jobGuestResult.count, 'Zeilen');
        }
      } else {
        console.log('ℹ️  Keine aufgelösten Gäste - nur passengers Array wird verwendet');
      }

      await loadRidesFromDb();
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error?.message || 'Unbekannter Fehler' };
    }
  }, [loadRidesFromDb, driverDirectory, guestDirectory, loadGuestDirectory, rideEditorData, syncConvoyAssignmentsForJob, validateFlightForSave, validateTrainForSave]);

  const handleFetchPlaceSuggestions = useCallback(async (input) => {
    const trimmed = String(input || '').trim();
    if (!trimmed) return [];
    try {
      const predictions = await fetchPlacesPredictions(trimmed, 'de');
      const uniqueDescriptions = Array.from(new Set(
        (predictions || [])
          .map((entry) => String(entry?.description || '').trim())
          .filter(Boolean),
      ));
      const apiSuggestions = uniqueDescriptions.slice(0, 8);
      if (apiSuggestions.length > 0) return apiSuggestions;
      const osmSuggestions = await fetchOsmPlaceSuggestions(trimmed);
      if (osmSuggestions.length > 0) return osmSuggestions;
      return getFallbackPlaceSuggestions(trimmed);
    } catch {
      const osmSuggestions = await fetchOsmPlaceSuggestions(trimmed);
      if (osmSuggestions.length > 0) return osmSuggestions;
      return getFallbackPlaceSuggestions(trimmed);
    }
  }, []);

  const handleCreateRide = useCallback(async (payload, options = {}) => {
    const start = String(payload?.start || '').trim();
    const ziel = String(payload?.ziel || '').trim();
    if (!start || !ziel) {
      return { ok: false, error: 'Bitte Start und Ziel ausfüllen.' };
    }

    const rideDate = normalizeRideDateValue(payload?.datum, '');
    if (!rideDate) {
      return { ok: false, error: 'Bitte ein gültiges Datum eingeben.' };
    }
    let startZeit = normalizeClockValue(payload?.startZeit, '');
    const konvoiName = String(payload?.konvoi || '').trim();
    const requestedDriverNames = normalizeDriverNameList(
      Array.isArray(payload?.fahrerNamen) && payload?.fahrerNamen.length > 0
        ? payload.fahrerNamen
        : [payload?.fahrer || ''],
    );
    const normalizedFlightNumber = normalizeFlightNumberValue(payload?.flugnummer);
    const normalizedTrainNumber = normalizeTrainNumberValue(payload?.zugnummer);
    if (normalizedFlightNumber && normalizedTrainNumber) {
      return { ok: false, error: 'Bitte nur Flugnummer oder Zugnummer ausfüllen.' };
    }
    const flightValidation = await validateFlightForSave(normalizedFlightNumber, rideDate, start);
    if (!flightValidation.ok) {
      return { ok: false, error: flightValidation.error || 'Flug konnte nicht validiert werden.' };
    }
    const trainValidation = await validateTrainForSave(normalizedTrainNumber, rideDate, start);
    if (!trainValidation.ok) {
      return { ok: false, error: trainValidation.error || 'Zug konnte nicht validiert werden.' };
    }
    const hasValidatedFlight = Boolean(flightValidation.valid);
    const hasValidatedTrain = Boolean(trainValidation.valid);
    const trainEtdValues = hasValidatedTrain
      ? resolveTrainEtdValues(trainValidation.data, startZeit)
      : { plannedTime: '', predictedTime: '', etd: startZeit, originalEtd: startZeit };
    startZeit = trainEtdValues.etd || startZeit;
    const trainLivePayload = hasValidatedTrain
      ? buildTrainLivePayload(trainValidation.data, new Date().toISOString())
      : null;
    const typedGuestNames = splitGuestNames(payload?.fahrgaeste);
    console.log('👥 handleCreateRide - Gästeliste vor Split:', payload?.fahrgaeste);
    console.log('👥 handleCreateRide - Gästeliste nach Split:', typedGuestNames);
    const anonymousCount = Math.max(0, Number.parseInt(String(payload?.anonymeGaeste || '0').trim(), 10));
    const effectiveGuestNames = [...typedGuestNames];
    console.log('👥 handleCreateRide - Gesamte Gästeliste:', effectiveGuestNames);

    try {
      if (!hasSupabaseAdminConfig) {
        await ensureCoordinatorWriteSession();
      }

      let resolvedConvoyId = null;
      if (konvoiName) {
        let convoysResult = await supabase.from('convoys').select('id, name').ilike('name', konvoiName).limit(1);
        if (convoysResult.error && ADMIN_FALLBACK_ERROR_RE.test(convoysResult.error.message || '')) {
          convoysResult = await supabaseAdmin.from('convoys').select('id, name').ilike('name', konvoiName).limit(1);
        }
        if (convoysResult.error) throw convoysResult.error;
        resolvedConvoyId = convoysResult.data?.[0]?.id || null;
      }

      let resolvedDriverIds = Array.from(
        new Set(
          requestedDriverNames
            .map((name) => resolveDriverIdFromInput(name, driverDirectory))
            .filter(Boolean),
        ),
      );
      if (requestedDriverNames.length > 0 && resolvedDriverIds.length < requestedDriverNames.length) {
        const latestDrivers = await fetchDriverProfilesForLookup();
        if (latestDrivers.length > 0) {
          resolvedDriverIds = Array.from(
            new Set(
              requestedDriverNames
                .map((name) => resolveDriverIdFromInput(name, latestDrivers))
                .filter(Boolean),
            ),
          );
          if (isMountedRef.current && latestDrivers.length > 0) setDriverDirectory(latestDrivers);
        }
      }
      const resolvedDriverId = resolvedDriverIds[0] || null;
      const shouldSyncConvoyAssignments = Boolean(resolvedConvoyId) || requestedDriverNames.length > 1 || resolvedDriverIds.length > 1;

      const insertPayload = {
        pickup_name: start,
        pickup_address: start,
        dropoff_name: ziel,
        dropoff_address: ziel,
        ride_date: rideDate,
        etd: (hasValidatedTrain ? trainEtdValues.etd : startZeit) || null,
        original_etd: (hasValidatedTrain ? trainEtdValues.originalEtd : startZeit) || null,
        status: mapEditorStatusToJobStatus(payload?.aktuellerStatus),
        convoy_id: resolvedConvoyId,
        driver_id: resolvedDriverId,
        passengers: normalizePassengerNames(effectiveGuestNames),
        flight_number: hasValidatedFlight ? normalizedFlightNumber : null,
        train_number: hasValidatedTrain ? normalizedTrainNumber : null,
        train_planned_time: hasValidatedTrain ? (trainEtdValues.plannedTime || null) : null,
        train_predicted_time: hasValidatedTrain ? (trainEtdValues.predictedTime || null) : null,
        trip_type: hasValidatedFlight ? 'airport' : hasValidatedTrain ? 'train' : 'normal',
        ext_flight_payload: hasValidatedTrain ? trainLivePayload : null,
        ext_flight_last_sync_at: hasValidatedTrain ? new Date().toISOString() : null,
        anonymous_guests: anonymousCount,
        ai_booked: Boolean(options?.aiBooked),
      };

      let createResult = await supabase.from('jobs').insert(insertPayload).select('id').single();
      if (createResult.error && ADMIN_FALLBACK_ERROR_RE.test(createResult.error.message || '')) {
        createResult = await supabaseAdmin.from('jobs').insert(insertPayload).select('id').single();
      }
      if (createResult.error && (MISSING_FLIGHT_NUMBER_COLUMN_RE.test(createResult.error.message || '') || MISSING_TRAIN_NUMBER_COLUMN_RE.test(createResult.error.message || '') || MISSING_TRAIN_TIMES_COLUMNS_RE.test(createResult.error.message || '') || MISSING_AI_BOOKED_COLUMN_RE.test(createResult.error.message || '') || MISSING_JOBS_EXT_COLUMN_RE.test(createResult.error.message || ''))) {
        const fallbackPayload = { ...insertPayload };
        if (MISSING_FLIGHT_NUMBER_COLUMN_RE.test(createResult.error.message || '')) delete fallbackPayload.flight_number;
        if (MISSING_TRAIN_NUMBER_COLUMN_RE.test(createResult.error.message || '')) delete fallbackPayload.train_number;
        if (MISSING_TRAIN_TIMES_COLUMNS_RE.test(createResult.error.message || '')) {
          delete fallbackPayload.train_planned_time;
          delete fallbackPayload.train_predicted_time;
        }
        if (MISSING_AI_BOOKED_COLUMN_RE.test(createResult.error.message || '')) delete fallbackPayload.ai_booked;
        if (MISSING_JOBS_EXT_COLUMN_RE.test(createResult.error.message || '')) {
          delete fallbackPayload.ext_flight_payload;
          delete fallbackPayload.ext_flight_last_sync_at;
        }
        createResult = await supabase.from('jobs').insert(fallbackPayload).select('id').single();
        if (createResult.error && ADMIN_FALLBACK_ERROR_RE.test(createResult.error.message || '')) {
          createResult = await supabaseAdmin.from('jobs').insert(fallbackPayload).select('id').single();
        }
      }
      if (createResult.error) throw createResult.error;

      const newJobId = String(createResult.data?.id || '').trim();
      if (newJobId) {
        await syncConvoyAssignmentsForJob(newJobId, shouldSyncConvoyAssignments ? resolvedDriverIds : []);
        if (hasValidatedFlight) {
          const syncResult = await invokeExternalSyncForJob(newJobId, 'create');
          if (!syncResult.ok) {
            console.warn('⚠️ external-sync (ride create) fehlgeschlagen:', syncResult.error);
          }
        }
      }
      const noteText = String(payload?.notes || '').trim();
      const aiBooked = Boolean(options?.aiBooked);
      const combinedNoteText = [aiBooked ? AI_BOOKING_NOTE_TAG : '', noteText].filter(Boolean).join('\n').trim();
      if (newJobId && combinedNoteText) {
        let noteResult = await supabase.from('job_notes').insert({ job_id: newJobId, note_text: combinedNoteText });
        if (noteResult.error && ADMIN_FALLBACK_ERROR_RE.test(noteResult.error.message || '')) {
          noteResult = await supabaseAdmin.from('job_notes').insert({ job_id: newJobId, note_text: combinedNoteText });
        }
      }

      if (newJobId && effectiveGuestNames.length > 0) {
        let guestsForResolve = guestDirectory;
        if (guestsForResolve.length === 0) {
          const latestGuests = await loadGuestDirectory();
          guestsForResolve = Array.isArray(latestGuests) ? latestGuests : [];
        }

        console.log('📋 Verfügbare Gäste in guestDirectory:', guestsForResolve.length);
        
        const guestLinks = effectiveGuestNames
          .map((guestName, index) => {
            const guestId = resolveGuestIdFromInput(guestName, guestsForResolve);
            if (guestId) {
              console.log(`✅ Gast "${guestName}" -> ID: ${guestId}`);
            } else {
              console.log(`⚠️  Gast "${guestName}" -> nicht in Datenbank (wird im passengers Array gespeichert)`);
            }
            return {
              guest_id: guestId,
              is_main_contact: index === 0,
              guest_name: guestName,
            };
          });

        const validGuestLinks = guestLinks.filter((entry) => Boolean(entry.guest_id));
        console.log('👥 Gültige Gast-Links zum Speichern in job_guests:', validGuestLinks);

        const uniqueGuestLinks = [];
        const seenGuestIds = new Set();
        validGuestLinks.forEach((entry) => {
          const key = String(entry.guest_id);
          if (seenGuestIds.has(key)) {
            console.log(`  Duplikat ignoriert: ${entry.guest_name}`);
            return;
          }
          seenGuestIds.add(key);
          uniqueGuestLinks.push(entry);
        });

        console.log('👥 Eindeutige Gast-Links:', uniqueGuestLinks.length);
        if (uniqueGuestLinks.length > 0) {
          let jobGuestResult = await supabase
            .from('job_guests')
            .upsert(
              uniqueGuestLinks.map((entry) => ({ job_id: newJobId, guest_id: entry.guest_id, is_main_contact: entry.is_main_contact })),
              { onConflict: 'job_id,guest_id' },
            );
          if (jobGuestResult.error) {
            console.error('❌ job_guests INSERT-Fehler mit anon client:', jobGuestResult.error);
            if (ADMIN_FALLBACK_ERROR_RE.test(jobGuestResult.error.message || '')) {
              jobGuestResult = await supabaseAdmin
                .from('job_guests')
                .upsert(
                  uniqueGuestLinks.map((entry) => ({ job_id: newJobId, guest_id: entry.guest_id, is_main_contact: entry.is_main_contact })),
                  { onConflict: 'job_id,guest_id' },
                );
              console.log('✅ job_guests INSERT mit admin client:', jobGuestResult);
            } else {
              console.error('❌ INSERT fehlgeschlagen:', jobGuestResult.error);
            }
          } else {
            console.log('✅ job_guests INSERT erfolgreich:', jobGuestResult.count, 'Zeilen');
          }
        } else {
          console.log('ℹ️  Keine aufgelösten Gäste - nur passengers Array wird verwendet');
        }
      }

      await loadRidesFromDb();
      return { ok: true, rideId: newJobId || null };
    } catch (error) {
      return { ok: false, error: error?.message || 'Unbekannter Fehler' };
    }
  }, [loadRidesFromDb, driverDirectory, guestDirectory, loadGuestDirectory, syncConvoyAssignmentsForJob, validateFlightForSave, validateTrainForSave]);

  const handleDuplicateRide = useCallback(async (rideData) => {
    const sourceRideId = String(rideData?.id || rideData?.rideId || '').trim();
    if (!sourceRideId) return false;

    try {
      if (!hasSupabaseAdminConfig) {
        await ensureCoordinatorWriteSession();
      }

      let sourceJobResult = await supabase
        .from('jobs')
        .select('*')
        .eq('id', sourceRideId)
        .single();
      if (sourceJobResult.error && ADMIN_FALLBACK_ERROR_RE.test(sourceJobResult.error.message || '')) {
        sourceJobResult = await supabaseAdmin
          .from('jobs')
          .select('*')
          .eq('id', sourceRideId)
          .single();
      }
      if (sourceJobResult.error) throw sourceJobResult.error;

      const sourceJob = sourceJobResult.data || null;
      if (!sourceJob) throw new Error('Originalfahrt nicht gefunden.');

      const {
        id: _sourceId,
        created_at: _createdAt,
        updated_at: _updatedAt,
        ...clonedJobPayload
      } = sourceJob;

      // JSON-Spalten als neue Objekte kopieren.
      if (clonedJobPayload.passengers && typeof clonedJobPayload.passengers === 'object') {
        clonedJobPayload.passengers = { ...clonedJobPayload.passengers };
      }

      let createResult = await supabase
        .from('jobs')
        .insert(clonedJobPayload)
        .select('id')
        .single();
      if (createResult.error && ADMIN_FALLBACK_ERROR_RE.test(createResult.error.message || '')) {
        createResult = await supabaseAdmin
          .from('jobs')
          .insert(clonedJobPayload)
          .select('id')
          .single();
      }
      if (createResult.error) throw createResult.error;

      const newRideId = String(createResult.data?.id || '').trim();
      if (!newRideId) throw new Error('Duplizierte Fahrt konnte nicht angelegt werden.');

      let notesResult = await supabase
        .from('job_notes')
        .select('note_text')
        .eq('job_id', sourceRideId)
        .order('created_at', { ascending: true });
      if (notesResult.error && ADMIN_FALLBACK_ERROR_RE.test(notesResult.error.message || '')) {
        notesResult = await supabaseAdmin
          .from('job_notes')
          .select('note_text')
          .eq('job_id', sourceRideId)
          .order('created_at', { ascending: true });
      }
      if (!notesResult.error && Array.isArray(notesResult.data) && notesResult.data.length > 0) {
        const noteRows = notesResult.data
          .map((row) => ({ job_id: newRideId, note_text: String(row?.note_text || '').trim() }))
          .filter((row) => row.note_text.length > 0);
        if (noteRows.length > 0) {
          let noteInsertResult = await supabase.from('job_notes').insert(noteRows);
          if (noteInsertResult.error && ADMIN_FALLBACK_ERROR_RE.test(noteInsertResult.error.message || '')) {
            noteInsertResult = await supabaseAdmin.from('job_notes').insert(noteRows);
          }
          if (noteInsertResult.error && !MISSING_JOB_NOTES_TABLE_RE.test(noteInsertResult.error.message || '')) {
            throw noteInsertResult.error;
          }
        }
      } else if (notesResult.error && !MISSING_JOB_NOTES_TABLE_RE.test(notesResult.error.message || '')) {
        throw notesResult.error;
      }

      let jobGuestsResult = await supabase
        .from('job_guests')
        .select('guest_id, is_main_contact')
        .eq('job_id', sourceRideId);
      if (jobGuestsResult.error && ADMIN_FALLBACK_ERROR_RE.test(jobGuestsResult.error.message || '')) {
        jobGuestsResult = await supabaseAdmin
          .from('job_guests')
          .select('guest_id, is_main_contact')
          .eq('job_id', sourceRideId);
      }
      if (!jobGuestsResult.error && Array.isArray(jobGuestsResult.data) && jobGuestsResult.data.length > 0) {
        const guestRows = jobGuestsResult.data
          .map((row) => ({
            job_id: newRideId,
            guest_id: row?.guest_id,
            is_main_contact: Boolean(row?.is_main_contact),
          }))
          .filter((row) => Boolean(row.guest_id));
        if (guestRows.length > 0) {
          let guestInsertResult = await supabase
            .from('job_guests')
            .upsert(guestRows, { onConflict: 'job_id,guest_id' });
          if (guestInsertResult.error && ADMIN_FALLBACK_ERROR_RE.test(guestInsertResult.error.message || '')) {
            guestInsertResult = await supabaseAdmin
              .from('job_guests')
              .upsert(guestRows, { onConflict: 'job_id,guest_id' });
          }
          if (guestInsertResult.error) throw guestInsertResult.error;
        }
      } else if (jobGuestsResult.error) {
        throw jobGuestsResult.error;
      }

      let assignmentsResult = await supabase
        .from('convoy_assignments')
        .select('driver_id, response_status')
        .eq('job_id', sourceRideId);
      if (assignmentsResult.error && ADMIN_FALLBACK_ERROR_RE.test(assignmentsResult.error.message || '')) {
        assignmentsResult = await supabaseAdmin
          .from('convoy_assignments')
          .select('driver_id, response_status')
          .eq('job_id', sourceRideId);
      }
      if (!assignmentsResult.error && Array.isArray(assignmentsResult.data) && assignmentsResult.data.length > 0) {
        const assignmentRows = assignmentsResult.data
          .map((row) => ({
            job_id: newRideId,
            driver_id: row?.driver_id,
            response_status: String(row?.response_status || '').trim() || 'pending',
          }))
          .filter((row) => Boolean(row.driver_id));
        if (assignmentRows.length > 0) {
          let assignmentsInsertResult = await supabase
            .from('convoy_assignments')
            .upsert(assignmentRows, { onConflict: 'job_id,driver_id' });
          if (assignmentsInsertResult.error && ADMIN_FALLBACK_ERROR_RE.test(assignmentsInsertResult.error.message || '')) {
            assignmentsInsertResult = await supabaseAdmin
              .from('convoy_assignments')
              .upsert(assignmentRows, { onConflict: 'job_id,driver_id' });
          }
          if (assignmentsInsertResult.error && !MISSING_CONVOY_ASSIGNMENTS_TABLE_RE.test(assignmentsInsertResult.error.message || '')) {
            throw assignmentsInsertResult.error;
          }
        }
      } else if (assignmentsResult.error && !MISSING_CONVOY_ASSIGNMENTS_TABLE_RE.test(assignmentsResult.error.message || '')) {
        throw assignmentsResult.error;
      }

      const localDuplicate = rideData && typeof rideData === 'object'
        ? {
            ...rideData,
            id: newRideId,
            rideId: newRideId,
            sourceView: String(rideData.sourceView || 'ankuenfte'),
            allGuestNames: Array.isArray(rideData.allGuestNames) ? [...rideData.allGuestNames] : [],
            fahrerNamen: Array.isArray(rideData.fahrerNamen) ? [...rideData.fahrerNamen] : [],
            fahrerAntworten: Array.isArray(rideData.fahrerAntworten) ? [...rideData.fahrerAntworten] : [],
            fahrerNummern: Array.isArray(rideData.fahrerNummern) ? [...rideData.fahrerNummern] : [],
            time: rideData.time && typeof rideData.time === 'object' ? { ...rideData.time } : rideData.time,
          }
        : null;

      ridesLastMutationAtRef.current = Date.now();
      if (localDuplicate) {
        setAllRides((prev) => {
          const sourceIndex = prev.findIndex((ride) => String(ride?.id || '').trim() === sourceRideId);
          if (sourceIndex < 0) return [localDuplicate, ...prev];
          const next = [...prev];
          next.splice(sourceIndex + 1, 0, localDuplicate);
          return next;
        });
      }
      scheduleRidesRefresh(1200);
      return true;
    } catch (error) {
      window.alert(`Fahrt konnte nicht dupliziert werden: ${error?.message || 'Unbekannter Fehler'}`);
      return false;
    }
  }, [scheduleRidesRefresh]);

  const handleMarkRideDone = useCallback(async (rideData) => {
    const rideId = String(rideData?.id || rideData?.rideId || rideData || '').trim();
    if (!rideId) return false;

    try {
      if (!hasSupabaseAdminConfig) {
        await ensureCoordinatorWriteSession();
      }

      const runDoneUpdate = async (client) => (
        client
          .from('jobs')
          .update({ status: 'done' })
          .eq('id', rideId)
          .select('id')
      );

      let updateResult = await runDoneUpdate(supabase);
      if (updateResult.error && ADMIN_FALLBACK_ERROR_RE.test(updateResult.error.message || '')) {
        updateResult = await runDoneUpdate(supabaseAdmin);
      }
      if (updateResult.error) throw updateResult.error;
      ridesLastMutationAtRef.current = Date.now();
      setAllRides((prev) => prev.map((ride) => {
        if (String(ride?.id || '').trim() !== rideId) return ride;
        return {
          ...ride,
          aktuellerStatus: 'beendet',
          confirmed: true,
        };
      }));
      scheduleRidesRefresh(1200);
      return true;
    } catch (error) {
      window.alert(`Status konnte nicht auf abgeschlossen gesetzt werden: ${error?.message || 'Unbekannter Fehler'}`);
      return false;
    }
  }, [scheduleRidesRefresh]);

  const handleArchiveRide = useCallback(async (rideData) => {
    const rideId = String(rideData?.id || rideData?.rideId || rideData || '').trim();
    if (!rideId) return false;

    try {
      if (!hasSupabaseAdminConfig) {
        await ensureCoordinatorWriteSession();
      }

      const runArchiveUpdate = async (client) => (
        client
          .from('jobs')
          .update({ status: 'cancelled' })
          .eq('id', rideId)
          .select('id')
      );

      let updateResult = await runArchiveUpdate(supabase);
      const hasUpdatedRows = Array.isArray(updateResult?.data) ? updateResult.data.length > 0 : Boolean(updateResult?.data);
      if ((!hasUpdatedRows || (updateResult.error && ADMIN_FALLBACK_ERROR_RE.test(updateResult.error.message || ''))) && hasSupabaseAdminConfig) {
        updateResult = await runArchiveUpdate(supabaseAdmin);
      }
      if (updateResult.error) throw updateResult.error;
      const hasUpdatedRowsFinal = Array.isArray(updateResult?.data) ? updateResult.data.length > 0 : Boolean(updateResult?.data);
      if (!hasUpdatedRowsFinal) {
        throw new Error('Archivierung fehlgeschlagen: keine Zeile in jobs aktualisiert.');
      }

      const archivePayload = {
        job_id: rideId,
        archived_by: 'koordinator-app',
        snapshot: {
          rideId,
          sourceView: String(rideData?.sourceView || ''),
          date: String(rideData?.date || rideData?.datum || ''),
          start: String(rideData?.start || rideData?.startLocation || ''),
          ziel: String(rideData?.ziel || rideData?.zielLocation || ''),
          driver: String(rideData?.driver || ''),
          status: String(rideData?.jobStatus || rideData?.aktuellerStatus || ''),
          captured_at: new Date().toISOString(),
        },
      };
      const runArchiveInsert = async (client) => client.from('jobs_archive').insert(archivePayload);
      let archiveInsertResult = await runArchiveInsert(supabase);
      if (archiveInsertResult.error && ADMIN_FALLBACK_ERROR_RE.test(archiveInsertResult.error.message || '')) {
        archiveInsertResult = await runArchiveInsert(supabaseAdmin);
      }
      if (archiveInsertResult.error && !MISSING_JOBS_ARCHIVE_TABLE_RE.test(archiveInsertResult.error.message || '')) {
        console.warn('jobs_archive insert fehlgeschlagen:', archiveInsertResult.error.message || archiveInsertResult.error);
      }

      ridesLastMutationAtRef.current = Date.now();
      locallyArchivedJobIdsRef.current.add(rideId);
      setAllRides((prev) => prev.map((ride) => {
        if (String(ride?.id || '').trim() !== rideId) return ride;
        return {
          ...ride,
          jobStatus: 'cancelled',
          aktuellerStatus: 'stoniert',
        };
      }));
      scheduleRidesRefresh(1200);
      return true;
    } catch (error) {
      window.alert(`Fahrt konnte nicht archiviert werden: ${error?.message || 'Unbekannter Fehler'}`);
      return false;
    }
  }, [scheduleRidesRefresh]);

  const handleDeleteRide = useCallback(async (rideId) => {
    const normalizedId = String(rideId || '').trim();
    if (!normalizedId) return false;
    try {
      if (!hasSupabaseAdminConfig) {
        await ensureCoordinatorWriteSession();
      }

      let deleteResult = await supabase.from('jobs').delete().eq('id', normalizedId);
      if (deleteResult.error && ADMIN_FALLBACK_ERROR_RE.test(deleteResult.error.message || '')) {
        deleteResult = await supabaseAdmin.from('jobs').delete().eq('id', normalizedId);
      }
      if (deleteResult.error) throw deleteResult.error;
      setAllRides((prev) => prev.filter((ride) => String(ride?.id || '').trim() !== normalizedId));
      return true;
    } catch (error) {
      window.alert(`Fahrt konnte nicht storniert werden: ${error?.message || 'Unbekannter Fehler'}`);
      return false;
    }
  }, []);
  const appBgStyle = {
    background: 'radial-gradient(ellipse 141.42% 102.21% at 0% 0%, #313701 0%, #000000 46%, #000000 84%, #000000 100%)',
  };

  const navigateToMapWithSelectedDrivers = useCallback((driverIds = [], driverNames = []) => {
    const normalizedDriverIds = Array.from(new Set(
      (driverIds || []).map((id) => String(id || '').trim()).filter(Boolean),
    ));
    const normalizedDriverNames = Array.from(new Set(
      (driverNames || []).map((name) => String(name || '').trim()).filter(Boolean),
    ));
    setKartenFilter((prev) => ({
      ...(prev || {}),
      driverSearch: normalizedDriverNames.join('; '),
      selectedDriverIds: normalizedDriverIds,
    }));
    navigateTo('karten');
  }, [navigateTo]);

  const currentScreen = useMemo(() => {
    if (view === 'alleFahrer') {
      return (
        <AlleFahrer
          setView={navigateTo}
          onCreateDriver={openDriverCreate}
          onEditDriver={openDriverEditor}
          onNavigateToMapWithDrivers={navigateToMapWithSelectedDrivers}
        />
      );
    }
    if (view === 'alleKunden') {
      return <AlleKunden setView={navigateTo} onCreateGuest={openGuestCreate} onEditGuest={openGuestEditor} />;
    }
    if (view === 'profilKoordinator') {
      return <ProfilKoordinatorView setView={navigateTo} currentCoordinatorName={coordinatorName} />;
    }
    if (view === 'fahrerListe') {
      return <FahrerListeView setView={navigateTo} />;
    }
    if (view === 'kundenListe') {
      return <KundenListeView setView={navigateTo} />;
    }
    if (view === 'fahrzeugListe') {
      return <FahrzeugeView setView={navigateTo} onEditVehicle={openVehicleEditor} />;
    }
    if (view === 'fahrzeugErstellen') {
      return <FahrzeugErstellenView setView={navigateTo} initialVehicle={null} />;
    }
    if (view === 'fahrzeugBearbeiten') {
      return <FahrzeugErstellenView setView={navigateTo} initialVehicle={vehicleEditorData} />;
    }
    if (view === 'fahrerErstellen') {
      return <FahrerErstellenView setView={navigateTo} initialDriver={null} />;
    }
    if (view === 'fahrerBearbeiten') {
      return <FahrerErstellenView setView={navigateTo} initialDriver={driverEditorData} />;
    }
    if (view === 'fahrgastErstellen') {
      return <FahrgastErstellenView setView={navigateTo} initialGuest={null} />;
    }
    if (view === 'fahrgastBearbeiten') {
      return <FahrgastErstellenView setView={navigateTo} initialGuest={guestEditorData} />;
    }
    if (view === 'ansprechpartner') {
      return <AnsprechpartnerView setView={navigateTo} backView="profilKoordinator" />;
    }
    if (view === 'verlauf') {
      return <VerlaufView setView={navigateTo} />;
    }
    if (view === 'settingsKoordinator') {
      return (
        <SettingsViewKo
          setView={navigateTo}
          profileData={profileData}
          onSaveProfile={(patch) => setProfileData((prev) => ({ ...prev, ...patch }))}
          onLogout={() => navigateTo('list')}
        />
      );
    }
    if (view === 'ankuenfte') {
      return (
        <AnkuenfteView 
          onBack={() => navigateTo('list')}
          onSwitchToAbfahrten={() => navigateTo('abfahrten')}
          onNavigateHome={() => navigateTo('list')}
          onNavigateToFahrten={() => navigateTo('ankuenfte')}
          onNavigateToMap={() => navigateTo('karten')}
          onNavigateToAddFahrt={() => navigateTo('fahrtAdd')}
          onNavigateToKi={() => navigateTo('kiAssistent')}
          onOpenFilter={() => navigateTo('fahrtenFilter')}
          onOpenArchive={() => navigateTo('archivAnkuenfte')}
          onRideSelect={openRideEditor}
          onRideDone={handleMarkRideDone}
          onRideArchive={handleArchiveRide}
          onRideDuplicate={handleDuplicateRide}
          rides={ankuenfteRides}
          ridesError={ridesError}
          rideFilters={fahrtenFilter}
          onRefreshRides={async () => {
            await loadRidesFromDb();
            await refreshAirportBoard('arrivals');
          }}
          airportBoard={airportBoardState}
          onRefreshAirportBoard={() => refreshAirportBoard('arrivals')}
          coordinatorLocation={coordinatorLocation}
          onCoordinatorLocationChange={setCoordinatorLocation}
          hasCoordinatorLocation={hasCoordinatorLocation}
        />
      );
    }
    if (view === 'archivAnkuenfte') {
      return (
        <AnkuenfteView
          onBack={() => navigateTo('ankuenfte')}
          onSwitchToAbfahrten={() => navigateTo('archivAbfahrten')}
          onNavigateHome={() => navigateTo('list')}
          onNavigateToFahrten={() => navigateTo('ankuenfte')}
          onNavigateToMap={() => navigateTo('karten')}
          onNavigateToAddFahrt={() => navigateTo('fahrtAdd')}
          onNavigateToKi={() => navigateTo('kiAssistent')}
          onOpenFilter={() => navigateTo('fahrtenFilter')}
          onOpenArchive={() => navigateTo('ankuenfte')}
          onRideSelect={openRideEditor}
          onRideDone={handleMarkRideDone}
          onRideArchive={handleArchiveRide}
          onRideDuplicate={handleDuplicateRide}
          rides={archivedAnkuenfteRides}
          ridesError={ridesError}
          rideFilters={fahrtenFilter}
          onRefreshRides={async () => {
            await loadRidesFromDb();
            await refreshAirportBoard('arrivals');
          }}
          airportBoard={airportBoardState}
          onRefreshAirportBoard={() => refreshAirportBoard('arrivals')}
          coordinatorLocation={coordinatorLocation}
          onCoordinatorLocationChange={setCoordinatorLocation}
          hasCoordinatorLocation={hasCoordinatorLocation}
          showArchiveOnly
        />
      );
    }
    if (view === 'abfahrten') {
      return (
        <AbfahrtenView 
          onBack={() => navigateTo('list')}
          onSwitchToAnkuenfte={() => navigateTo('ankuenfte')}
          onNavigateHome={() => navigateTo('list')}
          onNavigateToFahrten={() => navigateTo('ankuenfte')}
          onNavigateToMap={() => navigateTo('karten')}
          onNavigateToAddFahrt={() => navigateTo('fahrtAdd')}
          onNavigateToKi={() => navigateTo('kiAssistent')}
          onOpenFilter={() => navigateTo('fahrtenFilter')}
          onOpenArchive={() => navigateTo('archivAbfahrten')}
          onRideSelect={openRideEditor}
          onRideDone={handleMarkRideDone}
          onRideArchive={handleArchiveRide}
          onRideDuplicate={handleDuplicateRide}
          rides={abfahrtenRides}
          ridesError={ridesError}
          rideFilters={fahrtenFilter}
          onRefreshRides={async () => {
            await loadRidesFromDb();
            await refreshAirportBoard('departures');
          }}
          airportBoard={airportBoardState}
          onRefreshAirportBoard={() => refreshAirportBoard('departures')}
          coordinatorLocation={coordinatorLocation}
          onCoordinatorLocationChange={setCoordinatorLocation}
          hasCoordinatorLocation={hasCoordinatorLocation}
        />
      );
    }
    if (view === 'archivAbfahrten') {
      return (
        <AbfahrtenView
          onBack={() => navigateTo('abfahrten')}
          onSwitchToAnkuenfte={() => navigateTo('archivAnkuenfte')}
          onNavigateHome={() => navigateTo('list')}
          onNavigateToFahrten={() => navigateTo('ankuenfte')}
          onNavigateToMap={() => navigateTo('karten')}
          onNavigateToAddFahrt={() => navigateTo('fahrtAdd')}
          onNavigateToKi={() => navigateTo('kiAssistent')}
          onOpenFilter={() => navigateTo('fahrtenFilter')}
          onOpenArchive={() => navigateTo('abfahrten')}
          onRideSelect={openRideEditor}
          onRideDone={handleMarkRideDone}
          onRideArchive={handleArchiveRide}
          onRideDuplicate={handleDuplicateRide}
          rides={archivedAbfahrtenRides}
          ridesError={ridesError}
          rideFilters={fahrtenFilter}
          onRefreshRides={async () => {
            await loadRidesFromDb();
            await refreshAirportBoard('departures');
          }}
          airportBoard={airportBoardState}
          onRefreshAirportBoard={() => refreshAirportBoard('departures')}
          coordinatorLocation={coordinatorLocation}
          onCoordinatorLocationChange={setCoordinatorLocation}
          hasCoordinatorLocation={hasCoordinatorLocation}
          showArchiveOnly
        />
      );
    }
    if (view === 'fahrtAdd') {
      return (
        <FahrtAdd
          setView={navigateTo}
          onCreateRide={handleCreateRide}
          onFetchPlaceSuggestions={handleFetchPlaceSuggestions}
          onValidateFlight={validateFlightForDisplay}
          onValidateTrain={validateTrainForDisplay}
        />
      );
    }
    if (view === 'fahrtBearbeiten') {
      return (
        <FahrtBearbeitenView
          setView={navigateTo}
          initialData={rideEditorData}
          onSave={handleSaveRideEdit}
          onDelete={handleDeleteRide}
          onFetchPlaceSuggestions={handleFetchPlaceSuggestions}
          onValidateFlight={validateFlightForDisplay}
          onValidateTrain={validateTrainForDisplay}
        />
      );
    }
    if (view === 'kiAssistent') {
      return <KiAssistentView setView={navigateTo} onCreateRide={handleCreateRide} onOpenRideEditorById={openRideEditorById} />;
    }
    if (view === 'karten') {
      return <KartenView setView={navigateTo} filters={kartenFilter} />;
    }
    if (view === 'kartenFilter') {
      return <KartenFilterView setView={navigateTo} filters={kartenFilter} onChangeFilters={setKartenFilter} />;
    }
    if (view === 'fahrtenFilter') {
      return <FahrtenFilter setView={navigateTo} filters={fahrtenFilter} onChangeFilters={setFahrtenFilter} />;
    }
    return <HomeScreen setView={navigateTo} coordinatorName={coordinatorName} />;
  }, [profileData, view, coordinatorName, navigateTo, openRideEditor, openRideEditorById, rideEditorData, driverEditorData, guestEditorData, vehicleEditorData, openDriverCreate, openDriverEditor, openGuestCreate, openGuestEditor, openVehicleEditor, navigateToMapWithSelectedDrivers, ankuenfteRides, abfahrtenRides, archivedAnkuenfteRides, archivedAbfahrtenRides, handleSaveRideEdit, handleCreateRide, handleDeleteRide, handleMarkRideDone, handleArchiveRide, handleDuplicateRide, fahrtenFilter, kartenFilter, coordinatorLocation, hasCoordinatorLocation, ridesError, loadRidesFromDb, handleFetchPlaceSuggestions, refreshAirportBoard, airportBoardState, validateFlightForDisplay, validateTrainForDisplay]);

  return (
    <div ref={hostRef} className="flex min-h-screen min-h-dvh items-start justify-center overflow-hidden" style={appBgStyle}>
      {currentScreen}
    </div>
  );
}
