import { hasSupabaseAdminConfig, supabase, supabaseAdmin } from './supabase';
import { DEMO_MODE } from '../datenquelle';

const ADMIN_FALLBACK_ERROR_RE = /invalid jwt|signature is invalid|not allowed|unauthorized|permission denied/i;
const MISSING_COLUMN_RE = /column .* does not exist|could not find the ['"]?.+['"]? column/i;
const MISSING_TABLE_RE = /relation .* does not exist|table .* does not exist|could not find the ['"]?.+['"]? table/i;
const DEFAULT_MODEL = 'llama3.1:8b';
const DB_SNAPSHOT_CACHE_MS = 90_000;
const MAX_HISTORY_MESSAGES = 4;
const MAX_HISTORY_TEXT_CHARS = 300;
const MAX_OUTPUT_TOKENS = 480;

let cachedSnapshot = null;
let cachedSnapshotAt = 0;
let coordinatorReadAnonUnavailable = false;
let coordinatorReadSessionPromise = null;
let conversationContext = {
  lastDriverId: null,
  lastDriverName: '',
  lastDriverNumber: null,
  lastRideId: null,
  lastRideDate: '',
  lastRideEtd: '',
  lastRideFrom: '',
  lastRideTo: '',
  updatedAt: 0,
};

export const invalidateDatabaseAssistantCache = () => {
  cachedSnapshot = null;
  cachedSnapshotAt = 0;
};

const envOrDefault = (value, fallback) => {
  if (!value) return fallback;
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  if (!trimmed || trimmed.toLowerCase().startsWith('your_')) return fallback;
  return trimmed;
};

const KI_PROVIDER = envOrDefault(import.meta.env.VITE_KI_PROVIDER, 'ollama');
const OLLAMA_URL = envOrDefault(import.meta.env.VITE_OLLAMA_URL, '/ollama');
const OLLAMA_MODEL = envOrDefault(import.meta.env.VITE_OLLAMA_MODEL, DEFAULT_MODEL);
const OLLAMA_EMBED_MODEL = envOrDefault(import.meta.env.VITE_OLLAMA_EMBED_MODEL, '');
const OLLAMA_EMBED_ENDPOINT = envOrDefault(import.meta.env.VITE_OLLAMA_EMBED_ENDPOINT, '/api/embeddings');
const PGVECTOR_ENABLED = String(envOrDefault(import.meta.env.VITE_PGVECTOR_ENABLED, 'false')).toLowerCase() === 'true';
const RAG_MATCH_COUNT = Number.parseInt(envOrDefault(import.meta.env.VITE_RAG_MATCH_COUNT, '8'), 10) || 8;
const RAG_MIN_SIMILARITY = Number.parseFloat(envOrDefault(import.meta.env.VITE_RAG_MIN_SIMILARITY, '0.42')) || 0.42;

const normalizeRole = (value) => String(value || '').trim().toLowerCase();
const normalizeText = (value) => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/\s+/g, ' ')
  .trim();

const isAllDataPrompt = (prompt) => {
  const text = String(prompt || '').toLowerCase();
  return (
    text.includes('alle information') ||
    text.includes('alle daten') ||
    text.includes('gesamte datenbank') ||
    text.includes('komplett') ||
    text.includes('vollständig') ||
    text.includes('vollstaendig')
  );
};

const isAllDriversPrompt = (prompt) => {
  const text = normalizeText(prompt);
  return (
    /(alle|saemtliche|sämtliche|komplette|vollstaendige|vollständige|wirklich alle).*(fahrer)/.test(text) ||
    /(fahrer).*(alle|saemtliche|sämtliche|komplette|vollstaendige|vollständige)/.test(text)
  );
};

const toText = (value) => {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return '';
  }
};

const shorten = (value, maxChars = MAX_HISTORY_TEXT_CHARS) => {
  const text = String(value || '');
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}…`;
};

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

const queryTable = async (table, select, options = {}) => {
  const {
    orderBy = null,
    ascending = true,
    limit = null,
    queryClient = supabase,
  } = options;

  let query = queryClient.from(table).select(select);
  if (orderBy) query = query.order(orderBy, { ascending });
  if (Number.isFinite(limit) && limit > 0) query = query.limit(limit);
  return query;
};

const queryTableWithFallback = async (table, selectCandidates, options = {}) => {
  const candidates = Array.isArray(selectCandidates) ? selectCandidates : [selectCandidates];
  let lastError = null;

  const runWithClient = async (client, selectValue) => {
    const result = await queryTable(table, selectValue, { ...options, queryClient: client });
    return result;
  };

  for (let index = 0; index < candidates.length; index += 1) {
    const selectValue = candidates[index];
    let result = await runWithClient(supabase, selectValue);
    if (
      result.error &&
      !hasSupabaseAdminConfig &&
      ADMIN_FALLBACK_ERROR_RE.test(result.error.message || '')
    ) {
      await ensureCoordinatorReadSession();
      result = await runWithClient(supabase, selectValue);
    }
    if (result.error && hasSupabaseAdminConfig && ADMIN_FALLBACK_ERROR_RE.test(result.error.message || '')) {
      result = await runWithClient(supabaseAdmin, selectValue);
    }

    if (!result.error) {
      return { data: result.data || [], error: null };
    }

    lastError = result.error;
    const hasMoreCandidates = index < candidates.length - 1;
    const isMissingColumn = MISSING_COLUMN_RE.test(result.error?.message || '');
    if (!(hasMoreCandidates && isMissingColumn)) break;
  }

  return { data: [], error: lastError };
};

const loadDatabaseSnapshot = async ({ includeAll = false, forceRefresh = false } = {}) => {
  const now = Date.now();
  if (!forceRefresh && !includeAll && cachedSnapshot && (now - cachedSnapshotAt) < DB_SNAPSHOT_CACHE_MS) {
    return cachedSnapshot;
  }

  const perTableLimit = includeAll ? 1000 : 500;
  const [jobsResult, profilesResult, vehiclesResult, guestsResult, jobGuestsResult, notesResult, convoyAssignmentsResult, convoysResult, liveLocationsResult] = await Promise.all([
    queryTableWithFallback('jobs', [
      'id, ride_date, etd, status, driver_id, convoy_id, pickup_name, pickup_address, dropoff_name, dropoff_address, passengers, anonymous_guests',
    ], { orderBy: 'ride_date', ascending: true, limit: perTableLimit }),
    queryTableWithFallback('profiles', [
      'id, first_name, last_name, phone, role, is_dispo, driver_number, vehicle_id, service_start_time, service_end_time',
      'id, first_name, last_name, phone, role, is_dispo, driver_number, vehicle_id',
    ], { orderBy: 'last_name', ascending: true, limit: perTableLimit }),
    queryTableWithFallback('vehicles', [
      'id, license_plate, brand_model, trim, color',
      'id, license_plate, brand_model, trim',
    ], { orderBy: 'license_plate', ascending: true, limit: perTableLimit }),
    queryTableWithFallback('guests', ['*'], { orderBy: 'last_name', ascending: true, limit: perTableLimit }),
    queryTableWithFallback('job_guests', ['job_id, guest_id, is_main_contact'], { limit: includeAll ? 1000 : 300 }),
    queryTableWithFallback('job_notes', ['*'], { limit: includeAll ? 1000 : 300 }),
    queryTableWithFallback('convoy_assignments', ['job_id, driver_id, response_status'], { limit: includeAll ? 1000 : 300 }),
    queryTableWithFallback('convoys', ['id, name'], { orderBy: 'name', ascending: true, limit: includeAll ? 300 : 120 }),
    queryTableWithFallback('driver_live_locations', ['driver_id, lat, lng, captured_at, active_job_id'], { limit: includeAll ? 1000 : 300 }),
  ]);

  const normalizedNotesResult = notesResult.error && MISSING_TABLE_RE.test(notesResult.error?.message || '')
    ? { data: [], error: null }
    : notesResult;

  const resultByTable = {
    jobs: jobsResult.data,
    profiles: profilesResult.data,
    vehicles: vehiclesResult.data,
    guests: guestsResult.data,
    job_guests: jobGuestsResult.data,
    job_notes: normalizedNotesResult.data,
    convoy_assignments: convoyAssignmentsResult.data,
    convoys: convoysResult.data,
    driver_live_locations: liveLocationsResult.data,
  };

  const errors = [
    jobsResult.error && `jobs: ${jobsResult.error.message}`,
    profilesResult.error && `profiles: ${profilesResult.error.message}`,
    vehiclesResult.error && `vehicles: ${vehiclesResult.error.message}`,
    guestsResult.error && `guests: ${guestsResult.error.message}`,
    jobGuestsResult.error && `job_guests: ${jobGuestsResult.error.message}`,
    normalizedNotesResult.error && `job_notes: ${normalizedNotesResult.error.message}`,
    convoyAssignmentsResult.error && `convoy_assignments: ${convoyAssignmentsResult.error.message}`,
    convoysResult.error && `convoys: ${convoysResult.error.message}`,
    liveLocationsResult.error && `driver_live_locations: ${liveLocationsResult.error.message}`,
  ].filter(Boolean);

  const filteredProfiles = (resultByTable.profiles || []).filter((profile) => {
    // Dispo-Recht (is_dispo) macht niemanden zum Nicht-Fahrer. Nur die Rolle entscheidet.
    const role = normalizeRole(profile?.role);
    return !['dispo', 'dispatcher', 'admin', 'koordinator', 'coordinator', 'pruefung'].includes(role);
  });

  const snapshot = {
    meta: {
      generated_at: new Date().toISOString(),
      include_all: includeAll,
      counts: {
        jobs: resultByTable.jobs.length,
        profiles: resultByTable.profiles.length,
        fahrer_profile: filteredProfiles.length,
        vehicles: resultByTable.vehicles.length,
        guests: resultByTable.guests.length,
        job_guests: resultByTable.job_guests.length,
    job_notes: resultByTable.job_notes.length,
        convoy_assignments: resultByTable.convoy_assignments.length,
        convoys: resultByTable.convoys.length,
        driver_live_locations: resultByTable.driver_live_locations.length,
      },
      partial_errors: errors,
    },
    data: {
      jobs: resultByTable.jobs,
      profiles: resultByTable.profiles,
      fahrer_profiles: filteredProfiles,
      vehicles: resultByTable.vehicles,
      guests: resultByTable.guests,
      job_guests: resultByTable.job_guests,
      job_notes: resultByTable.job_notes,
      convoy_assignments: resultByTable.convoy_assignments,
      convoys: resultByTable.convoys,
      driver_live_locations: resultByTable.driver_live_locations,
    },
  };

  if (!includeAll) {
    cachedSnapshot = snapshot;
    cachedSnapshotAt = now;
  }

  return snapshot;
};

const buildSystemPrompt = () => `
Du bist der KI-Assistent der Trisar Koordinator-App.
Regeln:
- Antworte auf Deutsch, klar und knapp.
- Nutze ausschliesslich die gelieferten Daten als Quelle (DB-SNAPSHOT und SEMANTISCHE TREFFER).
- Du hast in dieser App explizit Leserechte auf die bereitgestellten DB-Daten (inkl. Kontaktdaten), wenn sie im Snapshot enthalten sind.
- Wenn Information fehlt, sage das explizit.
- Erfinde keine IDs, Zeiten, Namen oder Status.
- Falls die Frage eine Schreibaktion verlangt, antworte mit:
  "Schreibzugriff ist vorbereitet, aber in dieser Version noch deaktiviert."
- Gib Antworten bevorzugt als kurze Stichpunkte, wenn mehrere Fakten genannt werden.
- Wenn du unsicher bist, stelle genau eine Rückfrage.
- Schreibe keine Denk-/Analyse-Einleitung wie "Lass uns die Daten durchgehen".
- Gib direkt das Ergebnis aus den Daten aus.
`;

const compactProfiles = (rows) => (rows || []).map((row) => ({
  id: row?.id,
  first_name: row?.first_name || '',
  last_name: row?.last_name || '',
  driver_number: row?.driver_number ?? null,
  phone: row?.phone || '',
  vehicle_id: row?.vehicle_id || null,
  role: row?.role || '',
  service_start_time: row?.service_start_time || '',
  service_end_time: row?.service_end_time || '',
}));

const compactJobs = (rows) => (rows || []).map((row) => ({
  id: row?.id,
  ride_date: row?.ride_date || '',
  etd: row?.etd || '',
  status: row?.status || '',
  driver_id: row?.driver_id || null,
  convoy_id: row?.convoy_id || null,
  pickup_name: row?.pickup_name || '',
  dropoff_name: row?.dropoff_name || '',
  anonymous_guests: row?.anonymous_guests ?? 0,
}));

const compactVehicles = (rows) => (rows || []).map((row) => ({
  id: row?.id,
  license_plate: row?.license_plate || '',
  brand_model: row?.brand_model || '',
  trim: row?.trim || '',
  color: row?.color || '',
}));

const getGuestAddress = (row) => {
  if (row?.address) return String(row.address).trim();
  return [row?.street, row?.street_number, row?.zip, row?.city]
    .filter((value) => String(value || '').trim().length > 0)
    .join(' ')
    .trim();
};

const compactGuests = (rows) => (rows || []).map((row) => ({
  id: row?.id,
  first_name: row?.first_name || '',
  last_name: row?.last_name || '',
  phone: row?.phone || '',
  address: getGuestAddress(row),
}));

const compactJobGuests = (rows) => (rows || []).map((row) => ({
  job_id: row?.job_id || null,
  guest_id: row?.guest_id || null,
  is_main_contact: Boolean(row?.is_main_contact),
}));

const compactJobNotes = (rows) => (rows || []).map((row) => ({
  id: row?.id || null,
  job_id: row?.job_id || null,
  note: shorten(row?.note || row?.note_text || '', 120),
}));

const compactConvoyAssignments = (rows) => (rows || []).map((row) => ({
  job_id: row?.job_id || null,
  driver_id: row?.driver_id || null,
  response_status: row?.response_status || '',
}));

const compactConvoys = (rows) => (rows || []).map((row) => ({
  id: row?.id || null,
  name: row?.name || '',
}));

const compactLiveLocations = (rows) => (rows || []).map((row) => ({
  driver_id: row?.driver_id || null,
  lat: row?.lat ?? null,
  lng: row?.lng ?? null,
  active_job_id: row?.active_job_id || null,
}));

const inferTableNeedsFromPrompt = (prompt) => {
  const text = normalizeText(prompt);
  const needs = new Set();
  if (/fahrer|fahrernummer|dienststart|dienstende|standort|aktiv|inaktiv|frei/.test(text)) {
    needs.add('profiles');
    needs.add('vehicles');
    needs.add('driver_live_locations');
  }
  if (/fahrt|fahrten|abfahrt|ankunft|job|route|eta|etd/.test(text)) {
    needs.add('jobs');
    needs.add('convoy_assignments');
    needs.add('convoys');
    needs.add('job_notes');
  }
  if (/gast|gaeste|gäste|kunde|kunden|passagier/.test(text)) {
    needs.add('guests');
    needs.add('job_guests');
    needs.add('jobs');
  }
  if (/fahrzeug|kennzeichen|auto|wagen/.test(text)) {
    needs.add('vehicles');
    needs.add('profiles');
  }
  if (needs.size === 0) {
    needs.add('profiles');
    needs.add('jobs');
    needs.add('guests');
  }
  return needs;
};

const toIsoDateString = (date = new Date()) => date.toISOString().slice(0, 10);

const formatCapturedAtLocal = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return '';
  return new Intl.DateTimeFormat('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(parsed);
};

const matchesAny = (value, tokens = []) => {
  const text = normalizeText(value);
  if (!text) return false;
  return tokens.some((token) => text.includes(token));
};

const extractDateHint = (prompt) => {
  const text = normalizeText(prompt);

  const explicitDateMatch = String(prompt || '').match(/\b(\d{1,2})\.(\d{1,2})(?:\.(\d{2,4}))?\b/);
  if (explicitDateMatch) {
    const day = Number.parseInt(explicitDateMatch[1], 10);
    const month = Number.parseInt(explicitDateMatch[2], 10);
    const rawYear = explicitDateMatch[3];
    let year = new Date().getFullYear();
    if (rawYear) {
      const parsedYear = Number.parseInt(rawYear, 10);
      if (Number.isFinite(parsedYear)) {
        year = rawYear.length === 2 ? (2000 + parsedYear) : parsedYear;
      }
    }
    if (
      Number.isFinite(day) && Number.isFinite(month) && Number.isFinite(year)
      && day >= 1 && day <= 31 && month >= 1 && month <= 12
    ) {
      const iso = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      return { type: 'date', value: iso };
    }
  }

  if (/\bheute\b/.test(text)) return { type: 'date', value: toIsoDateString() };
  if (/\bmorgen\b/.test(text)) {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return { type: 'date', value: toIsoDateString(d) };
  }
  if (/\bgestern\b/.test(text)) {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return { type: 'date', value: toIsoDateString(d) };
  }
  return null;
};

const isBookingPrompt = (prompt) => {
  const text = normalizeText(prompt);
  return /(buch|buchen|buche|anlegen|erstelle|erstellen|neue fahrt|fahrt anlegen|fahrt buchen|reservier)/.test(text);
};

const filterSnapshotByPrompt = (snapshot, prompt) => {
  const text = normalizeText(prompt);
  const dateHint = extractDateHint(prompt);
  const tokens = text.split(' ').filter(Boolean);
  const data = snapshot?.data || {};

  const filtered = { ...data };
  if (Array.isArray(data.jobs) && (dateHint || /fahrt|abfahrt|ankunft|job/.test(text))) {
    filtered.jobs = data.jobs.filter((job) => {
      if (dateHint?.type === 'date') {
        return String(job?.ride_date || '').startsWith(dateHint.value);
      }
      return matchesAny(job?.pickup_name, tokens) || matchesAny(job?.dropoff_name, tokens);
    });
  }
  if (Array.isArray(data.profiles) && /fahrer|fahrernummer|profil|name/.test(text)) {
    filtered.profiles = data.profiles.filter((profile) => matchesAny(`${profile?.first_name} ${profile?.last_name}`, tokens));
  }
  if (Array.isArray(data.vehicles) && /fahrzeug|kennzeichen|auto|wagen/.test(text)) {
    filtered.vehicles = data.vehicles.filter((vehicle) => matchesAny(vehicle?.license_plate, tokens) || matchesAny(vehicle?.brand_model, tokens));
  }
  if (Array.isArray(data.guests) && /gast|gaeste|gäste|kunde|kunden|passagier/.test(text)) {
    filtered.guests = data.guests.filter((guest) => (
      matchesAny(`${guest?.first_name} ${guest?.last_name}`, tokens)
      || matchesAny(getGuestAddress(guest), tokens)
    ));
  }

  return { ...snapshot, data: filtered };
};

const buildCompactSnapshotForLlm = (snapshot, prompt, includeAll = false) => {
  const needs = inferTableNeedsFromPrompt(prompt);
  const rowLimit = includeAll ? 200 : 40;
  const take = (rows) => (Array.isArray(rows) ? rows.slice(0, rowLimit) : []);
  const data = snapshot?.data || {};

  const compactData = {};
  if (needs.has('profiles')) compactData.profiles = compactProfiles(take(data.fahrer_profiles || data.profiles));
  if (needs.has('jobs')) compactData.jobs = compactJobs(take(data.jobs));
  if (needs.has('vehicles')) compactData.vehicles = compactVehicles(take(data.vehicles));
  if (needs.has('guests')) compactData.guests = compactGuests(take(data.guests));
  if (needs.has('job_guests')) compactData.job_guests = compactJobGuests(take(data.job_guests));
  if (needs.has('job_notes')) compactData.job_notes = compactJobNotes(take(data.job_notes));
  if (needs.has('convoy_assignments')) compactData.convoy_assignments = compactConvoyAssignments(take(data.convoy_assignments));
  if (needs.has('convoys')) compactData.convoys = compactConvoys(take(data.convoys));
  if (needs.has('driver_live_locations')) compactData.driver_live_locations = compactLiveLocations(take(data.driver_live_locations));

  return {
    meta: {
      generated_at: snapshot?.meta?.generated_at,
      counts: snapshot?.meta?.counts || {},
      partial_errors: snapshot?.meta?.partial_errors || [],
      included_tables: Object.keys(compactData),
      row_limit_per_table: rowLimit,
    },
    data: compactData,
  };
};

const hasLikelyReadAccessIssue = (snapshot) => {
  const counts = snapshot?.meta?.counts || {};
  const coreTotal = Number(counts.profiles || 0)
    + Number(counts.jobs || 0)
    + Number(counts.guests || 0)
    + Number(counts.vehicles || 0);
  return coreTotal === 0;
};

const isAccessQuestion = (prompt) => {
  const text = normalizeText(prompt);
  return /zugriff|datenbankzugriff|db zugriff|hast du zugriff|kannst du.*datenbank/.test(text);
};

const getDriverDisplayName = (profile) => [profile?.first_name, profile?.last_name].filter(Boolean).join(' ').trim();

const resolveDriverByNumberOrIndex = (drivers, requestedNumber) => {
  const num = Number(requestedNumber);
  if (!Number.isFinite(num) || num <= 0) return null;
  const byDriverNumber = (Array.isArray(drivers) ? drivers : [])
    .find((entry) => Number(entry?.driver_number) === num) || null;
  if (byDriverNumber) return byDriverNumber;
  const sortedDrivers = [...(Array.isArray(drivers) ? drivers : [])]
    .filter((entry) => getDriverDisplayName(entry))
    .sort((a, b) => getDriverDisplayName(a).localeCompare(getDriverDisplayName(b), 'de'));
  return sortedDrivers[num - 1] || null;
};

const updateConversationDriverContext = (driver) => {
  if (!driver) return;
  conversationContext = {
    ...conversationContext,
    lastDriverId: driver?.id || null,
    lastDriverName: getDriverDisplayName(driver) || '',
    lastDriverNumber: Number.isFinite(Number(driver?.driver_number)) ? Number(driver?.driver_number) : null,
    updatedAt: Date.now(),
  };
};

const updateConversationRideContext = (ride) => {
  if (!ride) return;
  conversationContext = {
    ...conversationContext,
    lastRideId: ride?.id || null,
    lastRideDate: String(ride?.ride_date || '').trim(),
    lastRideEtd: String(ride?.etd || '').trim(),
    lastRideFrom: String(ride?.pickup_name || ride?.pickup_address || '').trim(),
    lastRideTo: String(ride?.dropoff_name || ride?.dropoff_address || '').trim(),
    updatedAt: Date.now(),
  };
};

const readConversationDriverContext = (drivers = []) => {
  if (!conversationContext?.updatedAt) return null;
  if ((Date.now() - conversationContext.updatedAt) > (60 * 60 * 1000)) return null;
  const byId = drivers.find((entry) => entry?.id && entry.id === conversationContext.lastDriverId);
  if (byId) return byId;
  if (conversationContext.lastDriverNumber != null) {
    const byNumber = drivers.find((entry) => Number(entry?.driver_number) === conversationContext.lastDriverNumber);
    if (byNumber) return byNumber;
  }
  if (conversationContext.lastDriverName) {
    return findBestDriverByName(drivers, conversationContext.lastDriverName);
  }
  return null;
};

const readConversationRideContext = (jobs = []) => {
  if (!conversationContext?.updatedAt) return null;
  if ((Date.now() - conversationContext.updatedAt) > (60 * 60 * 1000)) return null;
  if (!Array.isArray(jobs) || jobs.length === 0) return null;

  const byId = jobs.find((job) => job?.id && job.id === conversationContext.lastRideId);
  if (byId) return byId;

  const byDateTime = jobs.find((job) => {
    const sameDate = String(job?.ride_date || '').trim() === conversationContext.lastRideDate;
    const sameTime = String(job?.etd || '').trim() === conversationContext.lastRideEtd;
    const sameFrom = String(job?.pickup_name || job?.pickup_address || '').trim() === conversationContext.lastRideFrom;
    const sameTo = String(job?.dropoff_name || job?.dropoff_address || '').trim() === conversationContext.lastRideTo;
    return sameDate && (sameTime || (sameFrom && sameTo));
  });
  if (byDateTime) return byDateTime;

  return null;
};

const extractLikelyDriverName = (prompt) => {
  const raw = String(prompt || '').trim();
  const directPatterns = [
    /fahrernummer\s+hat\s+(.+)$/i,
    /fahrernummer\s+von\s+(.+)$/i,
    /fahrer\s*nummer\s+hat\s+(.+)$/i,
    /fahrer\s*nummer\s+von\s+(.+)$/i,
  ];
  for (const pattern of directPatterns) {
    const match = raw.match(pattern);
    if (!match?.[1]) continue;
    return match[1].replace(/[?!.,;:]+$/g, '').trim();
  }
  return '';
};

const extractLikelyDriverReferenceName = (prompt) => {
  const raw = String(prompt || '').trim();
  if (!raw) return '';

  const patterns = [
    /telefon(?:nummer)?\s+von\s+(.+)$/i,
    /handy(?:nummer)?\s+von\s+(.+)$/i,
    /mobil(?:nummer)?\s+von\s+(.+)$/i,
    /name\s+von\s+fahrer\s+#?\s*\d+\s*[:-]?\s*(.+)$/i,
    /fahrer\s+hei(?:ss|ß)t\s+(.+)$/i,
  ];

  for (const pattern of patterns) {
    const match = raw.match(pattern);
    const value = String(match?.[1] || '').replace(/[?!.,;:]+$/g, '').trim();
    if (value) return value;
  }

  return '';
};

const findBestDriverByName = (drivers, nameQuery) => {
  const query = normalizeText(nameQuery);
  if (!query) return null;
  const tokens = query.split(' ').filter(Boolean);
  let best = null;
  let bestScore = 0;

  drivers.forEach((driver) => {
    const fullName = normalizeText(getDriverDisplayName(driver));
    if (!fullName) return;
    const first = normalizeText(driver?.first_name || '');
    const last = normalizeText(driver?.last_name || '');
    let score = 0;

    if (fullName === query) score = 100;
    else if (fullName.includes(query) || query.includes(fullName)) score = 80;
    else if (tokens.length > 0 && tokens.every((token) => fullName.includes(token))) score = 70;
    else if (last && query === last) score = 60;
    else if (first && query === first) score = 40;

    if (score > bestScore) {
      best = driver;
      bestScore = score;
    }
  });

  return bestScore > 0 ? best : null;
};

const extractRequestedDriverNumber = (prompt) => {
  const raw = String(prompt || '').trim();
  if (!raw) return null;

  const patterns = [
    /fahrernummer\s*#?\s*(\d{1,4})\b/i,
    /fahrer\s*nummer\s*#?\s*(\d{1,4})\b/i,
    /fahrer\s*nr\.?\s*#?\s*(\d{1,4})\b/i,
    /fahrer\s+hat\s+(?:die\s+)?(\d{1,4})\b/i,
    /der\s+fahrer\s+hat\s+(?:die\s+)?(\d{1,4})\b/i,
    /fahrer\s+hat\s+(?:die\s+)?nummer\s*#?\s*(\d{1,4})\b/i,
    /fahrer\s+hat\s+(?:die\s+)?fahrernummer\s*#?\s*(\d{1,4})\b/i,
    /nummer\s+(\d{1,4})\b.*fahrer/i,
    /fahrer.*\bnummer\s*#?\s*(\d{1,4})\b/i,
    /fahrer\s+(\d{1,4})\b/i,
    /den\s+fahrer\s+(\d{1,4})\b/i,
    /fahrer\s+#\s*(\d{1,4})\b/i,
    /\b(\d{1,4})\.\s*fahrer\b/i,
  ];

  for (const pattern of patterns) {
    const match = raw.match(pattern);
    const parsed = Number.parseInt(match?.[1] || '', 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return null;
};

const findDriverFromHistory = (drivers, chatHistory = []) => {
  if (!Array.isArray(chatHistory) || chatHistory.length === 0) return null;
  const ordered = [...chatHistory].reverse();
  for (const message of ordered) {
    const text = toText(message?.text || message?.content || '').trim();
    if (!text) continue;

    const num = extractRequestedDriverNumber(text);
    if (num) {
      const matchByNumber = drivers.find((entry) => Number(entry?.driver_number) === num);
      if (matchByNumber) return matchByNumber;
    }

    const driverMention = text.match(/fahrer\s*#?\s*(\d{1,4})/i);
    if (driverMention?.[1]) {
      const parsed = Number.parseInt(driverMention[1], 10);
      const matchByNumber = drivers.find((entry) => Number(entry?.driver_number) === parsed);
      if (matchByNumber) return matchByNumber;
    }

    const nameHint = extractLikelyDriverName(text);
    if (nameHint) {
      const matchByName = findBestDriverByName(drivers, nameHint);
      if (matchByName) return matchByName;
    }

    const assistantPattern = text.match(/fahrer\s*#?\s*(\d{1,4})\s+ist\s+([a-zA-ZÄÖÜäöüß\s-]+)/i);
    if (assistantPattern?.[2]) {
      const byAssistantName = findBestDriverByName(drivers, assistantPattern[2]);
      if (byAssistantName) return byAssistantName;
    }

    const matchFromWholeText = findBestDriverByName(drivers, text);
    if (matchFromWholeText) return matchFromWholeText;
  }
  return null;
};

const buildDirectIntentAnswer = ({ prompt, snapshot, chatHistory = [] }) => {
  const text = normalizeText(prompt);
  const drivers = Array.isArray(snapshot?.data?.fahrer_profiles) ? snapshot.data.fahrer_profiles : [];
  const jobs = Array.isArray(snapshot?.data?.jobs) ? snapshot.data.jobs : [];
  const guests = Array.isArray(snapshot?.data?.guests) ? snapshot.data.guests : [];
  const vehicles = Array.isArray(snapshot?.data?.vehicles) ? snapshot.data.vehicles : [];
  const liveLocations = Array.isArray(snapshot?.data?.driver_live_locations) ? snapshot.data.driver_live_locations : [];
  const hasAccessIssue = hasLikelyReadAccessIssue(snapshot);
  const dateHint = extractDateHint(prompt);
  const contextualDriver = readConversationDriverContext(drivers);

  if (hasAccessIssue) return null;

  if (/(wie viel|wieviel|wie viele|anzahl).*(fahrer)/.test(text)) {
    return `Es gibt ${drivers.length} Fahrer in der Datenbank.`;
  }

  if (
    dateHint?.type === 'date'
    && /(fahrt|fahrten)/.test(text)
    && /(gibt es|gibts|haben wir|hast du|wie viele|anzahl|fuer|für|am)/.test(text)
  ) {
    const dayJobs = jobs.filter((job) => String(job?.ride_date || '').startsWith(dateHint.value));
    const displayDate = `${dateHint.value.slice(8, 10)}.${dateHint.value.slice(5, 7)}.${dateHint.value.slice(0, 4)}`;
    if (dayJobs.length === 0) {
      return `Für den ${displayDate} gibt es keine Fahrten.`;
    }
    if (dayJobs.length === 1) {
      const first = dayJobs[0];
      updateConversationRideContext(first);
      const from = String(first?.pickup_name || first?.pickup_address || '-').trim();
      const to = String(first?.dropoff_name || first?.dropoff_address || '-').trim();
      const etd = String(first?.etd || '--:--').trim();
      return `Ja, am ${displayDate} gibt es 1 Fahrt (${etd}) von ${from} nach ${to}.`;
    }
    if (dayJobs.length > 0) {
      updateConversationRideContext(dayJobs[0]);
    }
    return `Ja, am ${displayDate} gibt es ${dayJobs.length} Fahrten.`;
  }

  const contextualRide = readConversationRideContext(jobs);
  const asksRideDriver = /(wer|welcher).*(fahrer)|fahrer\??$/.test(text);
  const asksRideGuests = /(welche|wer|und).*(gaeste|gäste|gast|passagiere|kunden)|gaeste\??$|gäste\??$/.test(text);

  if (contextualRide && asksRideDriver) {
    const directDriverId = String(contextualRide?.driver_id || '').trim();
    let driver = directDriverId
      ? drivers.find((entry) => String(entry?.id || '').trim() === directDriverId)
      : null;

    if (!driver) {
      const assignments = Array.isArray(snapshot?.data?.convoy_assignments) ? snapshot.data.convoy_assignments : [];
      const accepted = assignments.find((row) => (
        String(row?.job_id || '').trim() === String(contextualRide?.id || '').trim()
        && String(row?.response_status || '').toLowerCase() === 'accepted'
      ));
      if (accepted?.driver_id) {
        driver = drivers.find((entry) => String(entry?.id || '').trim() === String(accepted.driver_id).trim()) || null;
      }
    }

    if (!driver) {
      return 'Für diese Fahrt ist aktuell kein Fahrer zugeordnet.';
    }
    updateConversationDriverContext(driver);
    const name = getDriverDisplayName(driver) || 'Unbekannter Fahrer';
    const number = driver?.driver_number == null || String(driver.driver_number).trim() === ''
      ? ''
      : ` (#${String(driver.driver_number).trim()})`;
    return `Der Fahrer ist ${name}${number}.`;
  }

  if (contextualRide && asksRideGuests) {
    const guestsDirectory = Array.isArray(snapshot?.data?.guests) ? snapshot.data.guests : [];
    const jobGuests = Array.isArray(snapshot?.data?.job_guests) ? snapshot.data.job_guests : [];
    const currentJobId = String(contextualRide?.id || '').trim();
    const linkedGuestIds = jobGuests
      .filter((row) => String(row?.job_id || '').trim() === currentJobId)
      .map((row) => String(row?.guest_id || '').trim())
      .filter(Boolean);

    const linkedNames = linkedGuestIds
      .map((guestId) => guestsDirectory.find((g) => String(g?.id || '').trim() === guestId))
      .filter(Boolean)
      .map((guest) => [guest?.first_name, guest?.last_name].filter(Boolean).join(' ').trim())
      .filter(Boolean);

    const passengerObj = contextualRide?.passengers && typeof contextualRide.passengers === 'object'
      ? contextualRide.passengers
      : {};
    const passengerNames = Object.values(passengerObj)
      .map((value) => String(value || '').trim())
      .filter(Boolean);

    const names = Array.from(new Set([...linkedNames, ...passengerNames]));
    if (names.length === 0) {
      return 'Für diese Fahrt sind keine Gäste hinterlegt.';
    }
    return `Gäste dieser Fahrt (${names.length}): ${names.join(', ')}.`;
  }

  if (isAllDriversPrompt(prompt)) {
    const sortedDrivers = [...drivers]
      .filter((entry) => getDriverDisplayName(entry))
      .sort((a, b) => getDriverDisplayName(a).localeCompare(getDriverDisplayName(b), 'de'));
    if (sortedDrivers.length === 0) return 'Ich finde aktuell keine Fahrer in der Datenbank.';
    const lines = sortedDrivers.map((entry, index) => {
      const driverName = getDriverDisplayName(entry);
      const driverNumber = entry?.driver_number == null || String(entry.driver_number).trim() === ''
        ? ''
        : ` (#${String(entry.driver_number).trim()})`;
      return `${index + 1}. ${driverName}${driverNumber}`;
    });
    return `Alle ${sortedDrivers.length} Fahrer:\n${lines.join('\n')}`;
  }

  const requestedDriverNumber = extractRequestedDriverNumber(prompt);
  const requestedDriverByNumber = requestedDriverNumber
    ? resolveDriverByNumberOrIndex(drivers, requestedDriverNumber)
    : null;

  if (requestedDriverByNumber) {
    updateConversationDriverContext(requestedDriverByNumber);
  }

  if (
    requestedDriverNumber
    && /fahrer/.test(text)
    && !/(telefon|telefonnummer|handy|mobil|rufnummer|kennzeichen|fahrzeug|auto|wagen|wo ist|standort|position|live|genau)/.test(text)
  ) {
    if (requestedDriverByNumber) {
      const driverName = getDriverDisplayName(requestedDriverByNumber) || 'Unbekannter Fahrer';
      return `Fahrer #${requestedDriverNumber} ist ${driverName}.`;
    }
    const byIndex = resolveDriverByNumberOrIndex(drivers, requestedDriverNumber);
    if (byIndex) {
      updateConversationDriverContext(byIndex);
      const driverName = getDriverDisplayName(byIndex);
      const driverNumber = byIndex?.driver_number == null || String(byIndex.driver_number).trim() === ''
        ? ''
        : ` (Fahrernummer #${String(byIndex.driver_number).trim()})`;
      return `Der ${requestedDriverNumber}. Fahrer (alphabetisch) ist ${driverName}${driverNumber}.`;
    }
    return `Ich finde keinen Fahrer mit Nummer ${requestedDriverNumber}. Insgesamt habe ich ${drivers.length} Fahrerprofile.`;
  }

  const phoneIntent = /(telefon|telefonnummer|handy|mobil|mobilnummer|rufnummer)/.test(text);
  const vehicleIntent = /(kennzeichen|fahrzeug|auto|wagen)/.test(text);
  const hasDriverReferencePronoun = /\b(er|sie|ihn|ihm|dieser|die person|der|den|dem)\b/.test(text);
  const hasLocationKeyword = /(wo ist|standort|position|live|letzte[rsmn]?\s+standort|letzten\s+standort)/.test(text);
  const hasDriverReference = Boolean(
    requestedDriverByNumber
    || contextualDriver
    || /fahrer/.test(text)
    || hasDriverReferencePronoun,
  );
  const locationIntent = hasLocationKeyword && hasDriverReference;

  if (phoneIntent || vehicleIntent || locationIntent) {
    let match = requestedDriverByNumber;
    if (!match) {
      const nameCandidate = extractLikelyDriverReferenceName(prompt) || extractLikelyDriverName(prompt);
      if (nameCandidate) match = findBestDriverByName(drivers, nameCandidate);
    }
    if (!match) {
      // Folgefragen ohne erneute Namensnennung (z. B. "und welche telefonnummer?")
      // sollen automatisch auf den zuletzt besprochenen Fahrer gehen.
      match = readConversationDriverContext(drivers) || findDriverFromHistory(drivers, chatHistory);
    }
    if (!match) {
      return 'Bitte nenne den Fahrer eindeutig, z. B. "Fahrer #15" oder den Namen.';
    }

    updateConversationDriverContext(match);
    const driverName = getDriverDisplayName(match) || 'Unbekannter Fahrer';

    if (phoneIntent) {
      const phone = String(match?.phone || '').trim();
      return phone ? `Die Telefonnummer von ${driverName} ist ${phone}.` : `Für ${driverName} ist keine Telefonnummer hinterlegt.`;
    }

    if (vehicleIntent) {
      const vehicle = vehicles.find((entry) => entry?.id && entry.id === match?.vehicle_id);
      if (!vehicle) return `Für ${driverName} ist aktuell kein Fahrzeug zugeordnet.`;
      const plate = String(vehicle?.license_plate || '').trim();
      const model = [vehicle?.brand_model, vehicle?.trim].filter(Boolean).join(' ').trim();
      if (!plate && !model) return `Für ${driverName} sind keine Fahrzeugdetails hinterlegt.`;
      if (plate && model) return `${driverName} fährt ${model} mit Kennzeichen ${plate}.`;
      if (plate) return `${driverName} hat das Kennzeichen ${plate}.`;
      return `${driverName} fährt ${model}.`;
    }

    if (locationIntent) {
      const latest = [...liveLocations]
        .filter((row) => row?.driver_id && row.driver_id === match?.id)
        .sort((a, b) => String(b?.captured_at || '').localeCompare(String(a?.captured_at || '')))[0];
      if (!latest) {
        const latestAny = [...liveLocations]
          .filter((row) => row?.captured_at)
          .sort((a, b) => String(b?.captured_at || '').localeCompare(String(a?.captured_at || '')))[0];
        const hasVehicleAssigned = Boolean(String(match?.vehicle_id || '').trim());
        if (liveLocations.length === 0) {
          if (!hasVehicleAssigned) {
            return `Für ${driverName} habe ich aktuell keinen Live-Standort. In driver_live_locations gibt es derzeit keine Datensätze und dem Fahrer ist kein Fahrzeug zugeordnet.`;
          }
          return `Für ${driverName} habe ich aktuell keinen Live-Standort. In driver_live_locations gibt es derzeit keine Datensätze.`;
        }
        if (!hasVehicleAssigned) {
          return `Für ${driverName} habe ich aktuell keinen Live-Standort. Dem Fahrer ist aktuell kein Fahrzeug zugeordnet.`;
        }
        if (latestAny) {
          const anyDriver = drivers.find((entry) => String(entry?.id || '').trim() === String(latestAny?.driver_id || '').trim()) || null;
          const anyDriverName = getDriverDisplayName(anyDriver) || 'ein anderer Fahrer';
          const anyCapturedAt = formatCapturedAtLocal(latestAny?.captured_at);
          if (anyCapturedAt) {
            return `Für ${driverName} habe ich aktuell keinen Live-Standort. Der letzte Telemetrie-Datensatz im System ist von ${anyDriverName} am ${anyCapturedAt}.`;
          }
        }
        return `Für ${driverName} habe ich aktuell keinen Live-Standort.`;
      }
      const lat = latest?.lat == null ? '-' : String(latest.lat);
      const lng = latest?.lng == null ? '-' : String(latest.lng);
      const capturedAtLabel = formatCapturedAtLocal(latest?.captured_at);
      if (latest?.lat == null || latest?.lng == null) {
        if (capturedAtLabel) {
          return `Der letzte Standort von ${driverName} wurde am ${capturedAtLabel} erfasst, aber ohne Koordinaten.`;
        }
        return `Für ${driverName} habe ich aktuell keinen Live-Standort mit Koordinaten.`;
      }
      if (capturedAtLabel) {
        return `Der letzte Standort von ${driverName} ist ${lat}, ${lng} (erfasst am ${capturedAtLabel}).`;
      }
      return `Der letzte Standort von ${driverName} ist ${lat}, ${lng}.`;
    }
  }

  if (/(wie viel|wieviel|wie viele|anzahl).*(fahrten).*(heute)|heute.*(wie viel|wieviel|wie viele|anzahl).*(fahrten)/.test(text)) {
    const todayIso = toIsoDateString();
    const todayJobs = jobs.filter((job) => String(job?.ride_date || '').startsWith(todayIso));
    return `Heute sind ${todayJobs.length} Fahrten in der Datenbank.`;
  }

  if (/(wie viel|wieviel|wie viele|anzahl).*(offen|offene|pending).*(fahrten)|offene fahrten/.test(text)) {
    const openStatuses = new Set(['pending', 'new', 'offered', 'requested', 'assigned_pending']);
    const openCount = jobs.filter((job) => openStatuses.has(String(job?.status || '').toLowerCase())).length;
    return `Es gibt ${openCount} offene Fahrten.`;
  }

  if (/(wie viel|wieviel|wie viele|anzahl).*(gaeste|gäste|gast|kunden|kunde|passagiere)/.test(text)) {
    return `Es gibt ${guests.length} Gäste in der Datenbank.`;
  }

  if (/(fahrernummer|fahrer nummer)/.test(text)) {
    const nameCandidate = extractLikelyDriverReferenceName(prompt) || extractLikelyDriverName(prompt);
    const match = findBestDriverByName(drivers, nameCandidate || prompt);
    if (!match) return 'Ich finde keinen passenden Fahrer in der Datenbank.';
    updateConversationDriverContext(match);
    const driverName = getDriverDisplayName(match) || 'Unbekannter Fahrer';
    const driverNumber = match?.driver_number == null || String(match.driver_number).trim() === ''
      ? 'nicht hinterlegt'
      : `#${String(match.driver_number).trim()}`;
    return `Die Fahrernummer von ${driverName} ist ${driverNumber}.`;
  }

  return null;
};

const buildDeterministicAnswer = ({ prompt, snapshot, chatHistory = [] }) => {
  const text = normalizeText(prompt);
  const drivers = Array.isArray(snapshot?.data?.fahrer_profiles) ? snapshot.data.fahrer_profiles : [];
  const hasAccessIssue = hasLikelyReadAccessIssue(snapshot);

  if (isAccessQuestion(prompt)) {
    if (hasAccessIssue) {
      return 'Aktuell bekomme ich keine Datensätze aus Supabase (wahrscheinlich Session/RLS oder falsche Supabase-URL).';
    }
    return `Ja, ich habe Lesezugriff. Aktuell sehe ich ${drivers.length} Fahrerprofile.`;
  }

  if (isAllDriversPrompt(prompt)) {
    if (hasAccessIssue) {
      return 'Ich bekomme gerade keine Fahrer-Daten aus der Datenbank (Zugriff/Session prüfen).';
    }
    const sortedDrivers = [...drivers]
      .filter((entry) => getDriverDisplayName(entry))
      .sort((a, b) => getDriverDisplayName(a).localeCompare(getDriverDisplayName(b), 'de'));
    if (sortedDrivers.length === 0) {
      return 'Ich finde aktuell keine Fahrer in der Datenbank.';
    }
    const lines = sortedDrivers.map((entry, index) => {
      const driverName = getDriverDisplayName(entry);
      const driverNumber = entry?.driver_number == null || String(entry.driver_number).trim() === ''
        ? ''
        : ` (#${String(entry.driver_number).trim()})`;
      return `${index + 1}. ${driverName}${driverNumber}`;
    });
    return `Alle ${sortedDrivers.length} Fahrer:\n${lines.join('\n')}`;
  }

  if (/(wie viel|wieviel|wie viele|anzahl).*(fahrer)/.test(text)) {
    if (hasAccessIssue) {
      return 'Ich bekomme gerade keine Fahrer-Daten aus der Datenbank (Zugriff/Session prüfen).';
    }
    return `Es gibt ${drivers.length} Fahrer in der Datenbank.`;
  }

  const isPhoneQuestion = /(telefon|telefonnummer|handy|mobil|mobilnummer|rufnummer)/.test(text);
  if (isPhoneQuestion) {
    if (hasAccessIssue) {
      return 'Ich kann aktuell keine Fahrerprofile lesen (Zugriff/Session prüfen).';
    }

    const requestedDriverNumberForPhone = extractRequestedDriverNumber(prompt);
    let match = null;

    if (requestedDriverNumberForPhone) {
      match = resolveDriverByNumberOrIndex(drivers, requestedDriverNumberForPhone);
    }

    if (!match) {
      const nameCandidate = extractLikelyDriverReferenceName(prompt) || extractLikelyDriverName(prompt);
      if (nameCandidate) {
        match = findBestDriverByName(drivers, nameCandidate);
      }
    }

    if (!match && /\b(sein|seine|ihn|ihm|die person|dieser fahrer)\b/.test(text)) {
      match = findDriverFromHistory(drivers, chatHistory);
    }

    if (!match) {
      return 'Bitte nenne den Fahrer eindeutig, z. B. "Telefonnummer von Fahrer #15" oder "Telefonnummer von Anja Werner".';
    }

    const driverName = getDriverDisplayName(match) || 'Unbekannter Fahrer';
    const phone = String(match?.phone || '').trim();
    if (!phone) {
      return `Für ${driverName} ist keine Telefonnummer hinterlegt.`;
    }
    return `Die Telefonnummer von ${driverName} ist ${phone}.`;
  }

  const requestedDriverNumber = extractRequestedDriverNumber(prompt);
  if (requestedDriverNumber && /fahrer/.test(text)) {
    if (hasAccessIssue) {
      return 'Ich kann aktuell keine Fahrerprofile lesen (Zugriff/Session prüfen).';
    }

    const byDriverNumber = resolveDriverByNumberOrIndex(drivers, requestedDriverNumber);
    if (byDriverNumber) {
      const driverName = getDriverDisplayName(byDriverNumber) || 'Unbekannter Fahrer';
      return `Fahrer #${requestedDriverNumber} ist ${driverName}.`;
    }

    return `Ich finde keinen Fahrer mit Nummer ${requestedDriverNumber}. Insgesamt habe ich ${drivers.length} Fahrerprofile.`;
  }

  if (/fahrernummer|fahrer nummer/.test(text)) {
    if (hasAccessIssue) {
      return 'Ich kann aktuell keine Fahrerprofile lesen (Zugriff/Session prüfen).';
    }
    const nameCandidate = extractLikelyDriverName(prompt);
    const match = findBestDriverByName(drivers, nameCandidate || prompt);
    if (!match) return 'Ich finde keinen passenden Fahrer in der Datenbank.';
    const driverName = getDriverDisplayName(match) || 'Unbekannter Fahrer';
    const driverNumber = match?.driver_number == null || String(match.driver_number).trim() === ''
      ? 'nicht hinterlegt'
      : `#${String(match.driver_number).trim()}`;
    return `Die Fahrernummer von ${driverName} ist ${driverNumber}.`;
  }

  if (/(nenne|gib|zeige).*(einen|1).*(fahrer)/.test(text)) {
    const first = [...drivers]
      .sort((a, b) => getDriverDisplayName(a).localeCompare(getDriverDisplayName(b), 'de'))
      .find((entry) => getDriverDisplayName(entry));
    if (!first) return 'Ich finde aktuell keinen Fahrer in der Datenbank.';
    const driverName = getDriverDisplayName(first);
    const driverNumber = first?.driver_number == null || String(first.driver_number).trim() === ''
      ? ''
      : ` (Fahrernummer #${String(first.driver_number).trim()})`;
    return `Ein Fahrer ist ${driverName}${driverNumber}.`;
  }

  return '';
};

const callOllamaGenerate = async ({ systemPrompt, userPrompt, dbSnapshot, chatHistory = [], semanticMatches = [] }) => {
  const historyText = chatHistory
    .slice(-MAX_HISTORY_MESSAGES)
    .map((msg) => `${msg.role === 'assistant' ? 'ASSISTANT' : 'USER'}: ${shorten(toText(msg.text), MAX_HISTORY_TEXT_CHARS)}`)
    .join('\n');
  const dbJson = JSON.stringify(dbSnapshot);
  const semanticText = Array.isArray(semanticMatches) && semanticMatches.length > 0
    ? semanticMatches.map((row) => `- [${row.source_table}:${row.source_id}] ${row.content}`).join('\n')
    : '(leer)';
  const promptText = [
    systemPrompt,
    '',
    'CHAT-HISTORIE:',
    historyText || '(leer)',
    '',
    'SEMANTISCHE TREFFER:',
    semanticText,
    '',
    'DB-SNAPSHOT:',
    dbJson,
    '',
    `AKTUELLE USER-FRAGE: ${userPrompt}`,
  ].join('\n');

  const endpoint = `${OLLAMA_URL.replace(/\/$/, '')}/api/generate`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      prompt: promptText,
      stream: false,
      options: {
        temperature: 0.2,
        num_predict: MAX_OUTPUT_TOKENS,
      },
    }),
  });

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const message = data?.error || `Ollama API Fehler (${response.status})`;
    throw new Error(message);
  }

  const text = String(data?.response || '').trim();
  if (!text) {
    throw new Error('Ollama hat keine Antwort geliefert.');
  }
  if (looksLikeBadAssistantStyle(text)) {
    const strictPrompt = [
      systemPrompt,
      '',
      'WICHTIG: Antworte jetzt maximal in 3 kurzen Saetzen auf DEUTSCH.',
      'Nutze ausschliesslich die gelieferten Daten als Quelle.',
      'Keine Analyse-Einleitung, kein Code, kein JSON.',
      '',
      `FRAGE: ${userPrompt}`,
      '',
      'SEMANTISCHE TREFFER:',
      semanticText,
      '',
      'DB-SNAPSHOT (kurz):',
      JSON.stringify(dbSnapshot),
    ].join('\n');
    const retryResponse = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        prompt: strictPrompt,
        stream: false,
        options: {
          temperature: 0.1,
          num_predict: 220,
        },
      }),
    });
    const retryData = await retryResponse.json().catch(() => null);
    const retryText = String(retryData?.response || '').trim();
    if (retryText && !looksLikeBadAssistantStyle(retryText)) return retryText;
  }
  return text;
};

const createEmbedding = async (text) => {
  if (!OLLAMA_EMBED_MODEL) {
    throw new Error('VITE_OLLAMA_EMBED_MODEL fehlt (z. B. "nomic-embed-text").');
  }
  const endpoint = `${OLLAMA_URL.replace(/\/$/, '')}${OLLAMA_EMBED_ENDPOINT.startsWith('/') ? '' : '/'}${OLLAMA_EMBED_ENDPOINT}`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: OLLAMA_EMBED_MODEL,
      prompt: text,
    }),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const message = data?.error || `Ollama Embedding Fehler (${response.status})`;
    throw new Error(message);
  }
  const embedding = data?.embedding;
  if (!Array.isArray(embedding) || embedding.length === 0) {
    throw new Error('Ollama Embedding fehlt.');
  }
  return embedding;
};

const fetchSemanticMatches = async (queryEmbedding, matchCount = 8) => {
  let result = await supabase.rpc('match_ai_documents', {
    query_embedding: queryEmbedding,
    match_count: matchCount,
  });
  if (result.error && hasSupabaseAdminConfig && ADMIN_FALLBACK_ERROR_RE.test(result.error.message || '')) {
    result = await supabaseAdmin.rpc('match_ai_documents', {
      query_embedding: queryEmbedding,
      match_count: matchCount,
    });
  }
  if (result.error) {
    throw new Error(`pgvector Fehler: ${result.error.message || 'Unbekannt'}`);
  }
  const rows = Array.isArray(result.data) ? result.data : [];
  return rows
    .map((row) => ({
      ...row,
      similarity: Number.isFinite(Number(row?.similarity)) ? Number(row.similarity) : 0,
    }))
    .filter((row) => row.similarity >= RAG_MIN_SIMILARITY);
};

const toTimeMinutes = (value) => {
  const match = String(value || '').trim().match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const h = Number.parseInt(match[1], 10);
  const m = Number.parseInt(match[2], 10);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  return h * 60 + m;
};

const extractFirstJsonObject = (text) => {
  const raw = String(text || '');
  const start = raw.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  for (let i = start; i < raw.length; i += 1) {
    const ch = raw[i];
    if (ch === '{') depth += 1;
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        return raw.slice(start, i + 1);
      }
    }
  }
  return null;
};

const normalizeBookingDate = (value, prompt) => {
  const raw = String(value || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const dateHint = extractDateHint(prompt);
  if (dateHint?.type === 'date' && /^\d{4}-\d{2}-\d{2}$/.test(dateHint.value)) return dateHint.value;
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
};

const normalizeBookingTime = (value) => {
  const match = String(value || '').trim().match(/^(\d{1,2}):(\d{2})/);
  if (!match) return '';
  const h = Number.parseInt(match[1], 10);
  const m = Number.parseInt(match[2], 10);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return '';
  if (h < 0 || h > 23 || m < 0 || m > 59) return '';
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};

const callOllamaRideBookingPlanner = async ({ prompt, chatHistory = [], snapshot }) => {
  const endpoint = `${OLLAMA_URL.replace(/\/$/, '')}/api/generate`;
  const compact = buildCompactSnapshotForLlm(snapshot, prompt, false);
  const recentHistory = (Array.isArray(chatHistory) ? chatHistory : [])
    .slice(-4)
    .map((msg) => `${msg.role === 'assistant' ? 'assistant' : 'user'}: ${shorten(toText(msg?.text), 180)}`)
    .join('\n');

  const plannerPrompt = [
    'Du extrahierst Buchungsdaten fuer eine neue Fahrt aus Nutzertext.',
    'Gib NUR ein JSON-Objekt zurueck, ohne Erklaerung.',
    'Format:',
    '{"intent":"booking_proposal","needs_clarification":false,"missing_fields":[],"clarification_question":"","ride":{"ride_date":"YYYY-MM-DD","etd":"HH:MM","pickup_name":"","dropoff_name":"","guest_names":[],"anonymous_guests":0,"driver_names":[],"convoy_name":"","flight_number":"","note":""}}',
    'Wenn Angaben fehlen, setze needs_clarification=true und missing_fields.',
    'Erfinde keine Werte. Nur Daten aus Frage/History nutzen.',
    '',
    'CHAT:',
    recentHistory || '(leer)',
    '',
    'KOMPAKTE DATEN:',
    JSON.stringify(compact),
    '',
    `USER-FRAGE: ${prompt}`,
  ].join('\n');

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      prompt: plannerPrompt,
      stream: false,
      options: { temperature: 0.0, num_predict: 320 },
    }),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) return null;
  const raw = String(data?.response || '').trim();
  const jsonBlock = extractFirstJsonObject(raw);
  if (!jsonBlock) return null;
  try {
    return JSON.parse(jsonBlock);
  } catch {
    return null;
  }
};

const sanitizeRideBookingProposal = (proposal, prompt) => {
  const ride = proposal?.ride && typeof proposal.ride === 'object' ? proposal.ride : {};
  const start = String(ride.pickup_name || ride.start || '').trim();
  const ziel = String(ride.dropoff_name || ride.ziel || '').trim();
  const rideDate = normalizeBookingDate(ride.ride_date, prompt);
  const etd = normalizeBookingTime(ride.etd || ride.startZeit || '');
  const guestNames = Array.isArray(ride.guest_names)
    ? Array.from(new Set(ride.guest_names.map((v) => sanitizeGuestName(v)).filter(Boolean)))
    : [];
  const driverNames = Array.isArray(ride.driver_names)
    ? ride.driver_names.map((v) => String(v || '').trim()).filter(Boolean)
    : [];
  const anonymousGuests = Math.max(0, Number.parseInt(String(ride.anonymous_guests ?? 0), 10) || 0);
  const missingFields = [];
  if (!start) missingFields.push('start');
  if (!ziel) missingFields.push('ziel');
  if (!etd) missingFields.push('startZeit');

  const needsClarification = Boolean(proposal?.needs_clarification) || missingFields.length > 0;
  const explicitMissing = Array.isArray(proposal?.missing_fields)
    ? proposal.missing_fields.map((field) => String(field || '').trim()).filter(Boolean)
    : [];
  const mergedMissing = Array.from(new Set([...missingFields, ...explicitMissing]));

  const clarificationQuestion = String(proposal?.clarification_question || '').trim()
    || `Für die Buchung fehlen noch: ${mergedMissing.join(', ')}.`;

  return {
    needsClarification,
    clarificationQuestion,
    missingFields: mergedMissing,
    payload: {
      datum: rideDate,
      startZeit: etd,
      start,
      ziel,
      fahrgaeste: guestNames.join(', '),
      anonymeGaeste: String(anonymousGuests),
      fahrerNamen: driverNames,
      konvoi: String(ride.convoy_name || '').trim(),
      flugnummer: String(ride.flight_number || '').trim(),
      notes: String(ride.note || '').trim(),
      aktuellerStatus: 'offen',
    },
  };
};

const buildRideBookingProposal = async ({ prompt, chatHistory = [], snapshot }) => {
  const raw = await callOllamaRideBookingPlanner({ prompt, chatHistory, snapshot });
  if (!raw) return null;
  return sanitizeRideBookingProposal(raw, prompt);
};

const mergeBookingProposals = (primary, fallback) => {
  if (!primary && !fallback) return null;
  if (!primary) return fallback;
  if (!fallback) return primary;

  const mergedPayload = {
    ...primary.payload,
    datum: String(primary?.payload?.datum || fallback?.payload?.datum || '').trim(),
    startZeit: String(primary?.payload?.startZeit || fallback?.payload?.startZeit || '').trim(),
    start: String(primary?.payload?.start || fallback?.payload?.start || '').trim(),
    ziel: String(primary?.payload?.ziel || fallback?.payload?.ziel || '').trim(),
    fahrgaeste: String(primary?.payload?.fahrgaeste || fallback?.payload?.fahrgaeste || '').trim(),
    fahrerNamen: Array.isArray(primary?.payload?.fahrerNamen) && primary.payload.fahrerNamen.length > 0
      ? primary.payload.fahrerNamen
      : (Array.isArray(fallback?.payload?.fahrerNamen) ? fallback.payload.fahrerNamen : []),
    konvoi: String(primary?.payload?.konvoi || fallback?.payload?.konvoi || '').trim(),
    flugnummer: String(primary?.payload?.flugnummer || fallback?.payload?.flugnummer || '').trim(),
    notes: String(primary?.payload?.notes || fallback?.payload?.notes || '').trim(),
  };

  const mergedMissingFields = Array.from(new Set([
    ...(Array.isArray(primary?.missingFields) ? primary.missingFields : []),
    ...(Array.isArray(fallback?.missingFields) ? fallback.missingFields : []),
  ])).filter((field) => {
    if (field === 'start') return !mergedPayload.start;
    if (field === 'ziel') return !mergedPayload.ziel;
    if (field === 'startZeit') return !mergedPayload.startZeit;
    return true;
  });

  return {
    ...primary,
    payload: mergedPayload,
    missingFields: mergedMissingFields,
    needsClarification: mergedMissingFields.length > 0,
    clarificationQuestion: mergedMissingFields.length > 0
      ? String(primary?.clarificationQuestion || fallback?.clarificationQuestion || `Für die Buchung fehlen noch: ${mergedMissingFields.join(', ')}.`).trim()
      : '',
  };
};

const extractBookingTimeFromPrompt = (prompt) => {
  const match = String(prompt || '').match(/\b(\d{1,2}:\d{2})\b/);
  return normalizeBookingTime(match?.[1] || '');
};

const extractBookingRouteFromPrompt = (prompt) => {
  const raw = String(prompt || '').trim();
  if (!raw) return { start: '', ziel: '' };

  const pattern = /\b(von|vom|ab|aus)\s+(.+?)\s+(?:nach|zum|zur|ins|in die|in den)\s+(.+?)(?=(?:\s+mit\b|\s+und\b|\s+der\s+gast\b|\s+gast\s+hei(?:ss|ß)t\b|\s+fahrer\b|[.!?]|$))/i;
  const match = raw.match(pattern);
  if (match?.[2] && match?.[3]) {
    return {
      start: String(match[2]).trim(),
      ziel: String(match[3]).trim(),
    };
  }
  return { start: '', ziel: '' };
};

const sanitizeGuestName = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return '';

  return raw
    .replace(/^["'`]+|["'`]+$/g, '')
    .replace(/^(?:der|die|das)\s+gast\s+(?:hei(?:ss|ß)t|ist)\s+/i, '')
    .replace(/^gast\s+(?:hei(?:ss|ß)t|ist)\s+/i, '')
    .replace(/^(?:hei(?:ss|ß)t|ist)\s+/i, '')
    .replace(/\s+(?:und|,)\s+(?:nehm(?:e|en|t)|nimm|mit)\b.*$/i, '')
    .replace(/\s+(?:und|,)\s+fahrer\b.*$/i, '')
    .replace(/[.,;:!?]+$/g, '')
    .trim();
};

const extractBookingGuestNameFromPrompt = (prompt) => {
  const raw = String(prompt || '').trim();
  if (!raw) return '';
  const patterns = [
    /\bgast\s+hei(?:ss|ß)t\s+(.+?)(?=(?:\s+und\b|\s+mit\b|\s+fahrer\b|[.!?]|$))/i,
    /\bmit\s+(?:dem|den|der|einem|einer)?\s*gast\s+(.+?)(?=(?:\s+und\b|[.!?]|$))/i,
    /\bgast\s+(.+?)(?=(?:\s+und\b|[.!?]|$))/i,
  ];
  for (const pattern of patterns) {
    const match = raw.match(pattern);
    const name = sanitizeGuestName(match?.[1] || '');
    if (name) return name;
  }
  return '';
};

const buildRuleBasedBookingProposal = ({ prompt, snapshot }) => {
  const rideDate = normalizeBookingDate('', prompt);
  const startZeit = extractBookingTimeFromPrompt(prompt);
  const route = extractBookingRouteFromPrompt(prompt);
  const guestName = extractBookingGuestNameFromPrompt(prompt);
  const requestedDriverNumber = extractRequestedDriverNumber(prompt);
  const drivers = Array.isArray(snapshot?.data?.fahrer_profiles) ? snapshot.data.fahrer_profiles : [];
  const matchedDriver = requestedDriverNumber
    ? resolveDriverByNumberOrIndex(drivers, requestedDriverNumber)
    : null;
  const driverDisplay = matchedDriver
    ? (() => {
        const name = getDriverDisplayName(matchedDriver);
        if (!name) return `Fahrer #${requestedDriverNumber}`;
        return `${name} (${requestedDriverNumber})`;
      })()
    : (requestedDriverNumber ? `Fahrer #${requestedDriverNumber}` : '');

  const missingFields = [];
  if (!route.start) missingFields.push('start');
  if (!route.ziel) missingFields.push('ziel');
  if (!startZeit) missingFields.push('startZeit');

  return {
    needsClarification: missingFields.length > 0,
    clarificationQuestion: missingFields.length > 0
      ? `Für die Buchung fehlen noch: ${missingFields.join(', ')}.`
      : '',
    missingFields,
    payload: {
      datum: rideDate,
      startZeit,
      start: route.start,
      ziel: route.ziel,
      fahrgaeste: guestName,
      anonymeGaeste: '0',
      fahrerNamen: driverDisplay ? [driverDisplay] : [],
      konvoi: '',
      flugnummer: '',
      notes: '',
      aktuellerStatus: 'offen',
    },
  };
};

const BAD_STYLE_RE = /```|import\s+json|lass\s+uns|muessten\s+wir|müssten\s+wir|moeglicher\s+ansatz|möglicher\s+ansatz|in\s+python|python:|this\s+is\s+a\s+json|javascript\s+object\s+notation|here'?s\s+a\s+breakdown|data\s+structure|array\s+of\s+objects|it\s+appears\s+to\s+be\s+a\s+data\s+dump/i;
const LOW_CONFIDENCE_ANSWER_RE = /(keine\s+(spezifischen\s+)?informationen|keine\s+daten|nichts?\s+gefunden|nicht\s+gefunden|kann\s+ich\s+nicht\s+finden)/i;

const looksLikeBadAssistantStyle = (text) => {
  const raw = String(text || '').trim();
  if (!raw) return true;
  if (BAD_STYLE_RE.test(raw)) return true;
  if (/^\s*(this|here|it)\b/i.test(raw) && /(\bjson\b|\bjavascript\b|\bbreakdown\b|\bstructure\b)/i.test(raw)) return true;
  if (raw.length > 900) return true;
  return false;
};

const buildSemanticFallbackAnswer = (semanticMatches, userPrompt = '') => {
  const matches = (Array.isArray(semanticMatches) ? semanticMatches : [])
    .filter((row) => String(row?.content || '').trim())
    .filter((row) => !/readme/i.test(String(row?.source_id || '')));
  if (matches.length === 0) return '';

  const isObdQuery = /(obd|teltonika|dns|port|fallback|tracker|tcp)/i.test(String(userPrompt || ''));
  const ranked = [...matches].sort((a, b) => {
    const aKey = String(a?.source_id || '').toLowerCase();
    const bKey = String(b?.source_id || '').toLowerCase();
    const aScore = Number(aKey.includes('obd') || aKey.includes('teltonika')) * 10 + Number(a?.similarity || 0);
    const bScore = Number(bKey.includes('obd') || bKey.includes('teltonika')) * 10 + Number(b?.similarity || 0);
    return bScore - aScore;
  });
  const combined = ranked.slice(0, 6).map((row) => String(row?.content || '')).join('\n');

  if (isObdQuery) {
    const host = (combined.match(/\bobd\.trisar\.de\b/i) || combined.match(/\b[a-z0-9.-]+\.trisar\.de\b/i) || [])[0] || 'obd.trisar.de';
    const port = (combined.match(/\bport\b[^0-9]{0,8}(\d{2,5})/i) || [])[1] || '5027';
    const protocol = ((combined.match(/\b(tcp|udp|mqtt)\b/i) || [])[1] || 'TCP').toUpperCase();
    const tlsRaw = ((combined.match(/\btls(?:\/dtls)?\b[^a-zA-Z]{0,12}(none|tls\/dtls|deaktiviert|aktiviert)/i) || [])[1] || 'none').toLowerCase();
    const tls = tlsRaw === 'none' ? 'None' : tlsRaw.toUpperCase();
    const hasDnsOnly = /dns\s*only|graue?\s*wolke/i.test(combined);
    const hasPortForward = /portforward|port forwarding|weiterleitung/i.test(combined);
    const hasBackupHint = /second server|backup|fallback|ausfall/i.test(combined);
    return [
      'Kurze Checkliste (intern):',
      `1. Verbindung: Host \`${host}\`, Port \`${port}\`, Protokoll \`${protocol}\`, TLS \`${tls}\`.`,
      `2. DNS: \`${host}\` als \`DNS only\` (graue Wolke) betreiben.${hasDnsOnly ? '' : ' (Bitte in Cloudflare prüfen).'}`,
      `3. Netzwerk: Router-Portweiterleitung \`TCP ${port}\` auf den Gateway/Docker-Host.${hasPortForward ? '' : ' (Portforwarding aktivieren).'}`,
      `4. Fallback bei Ausfall: ${hasBackupHint ? 'Secondary Server/Backup im Tracker nutzen und lokale Datenspeicherung aktiv lassen.' : 'Secondary Server (Backup) im Tracker konfigurieren und Replay nach Reconnect sicherstellen.'}`,
    ].join('\n');
  }

  const lines = ranked.slice(0, 3).map((row, index) => {
    const content = String(row?.content || '')
      .replace(/\s+/g, ' ')
      .replace(/^#+\s*/g, '')
      .trim()
      .slice(0, 180);
    return content ? `${index + 1}. ${content}` : '';
  }).filter(Boolean);
  return lines.length ? `Kurze Checkliste (intern):\n${lines.join('\n')}` : '';
};

const shouldForceStructuredRagAnswer = (answer, semanticMatches, userPrompt = '') => {
  const promptText = String(userPrompt || '');
  const answerText = String(answer || '');
  const hasRelevantPrompt = /(obd|teltonika|dns|port|fallback|tracker|tcp)/i.test(promptText);
  if (!hasRelevantPrompt) return false;
  if (!Array.isArray(semanticMatches) || semanticMatches.length === 0) return false;
  if (/rag-docs\//i.test(answerText)) return true;
  if (/^ich habe dazu passende interne regeln gefunden:/i.test(answerText.trim())) return true;
  if (/#\s*(dispatch-regeln|obd\s*\/\s*teltonika)/i.test(answerText)) return true;
  return false;
};

const buildPlannerSchema = (snapshot) => {
  const data = snapshot?.data || {};
  const schema = {};
  Object.entries(data).forEach(([table, rows]) => {
    if (!Array.isArray(rows)) return;
    const first = rows.find((row) => row && typeof row === 'object') || {};
    schema[table] = Object.keys(first).slice(0, 40);
  });
  return schema;
};

const sanitizeQueryPlan = (plan, snapshot) => {
  if (!plan || typeof plan !== 'object') return null;
  const data = snapshot?.data || {};
  const tables = Object.keys(data).filter((key) => Array.isArray(data[key]));
  const table = tables.includes(plan.table) ? plan.table : null;
  if (!table) return null;

  const operationRaw = String(plan.operation || 'list').toLowerCase();
  const operation = ['list', 'count', 'distinct'].includes(operationRaw) ? operationRaw : 'list';
  const select = Array.isArray(plan.select)
    ? plan.select.map((field) => String(field || '').trim()).filter(Boolean).slice(0, 12)
    : [];
  const filters = Array.isArray(plan.filters)
    ? plan.filters
      .map((f) => ({
        field: String(f?.field || '').trim(),
        op: String(f?.op || '').trim().toLowerCase(),
        value: f?.value,
      }))
      .filter((f) => f.field && f.op)
      .slice(0, 8)
    : [];
  const sort = plan?.sort && typeof plan.sort === 'object'
    ? {
        field: String(plan.sort.field || '').trim(),
        direction: String(plan.sort.direction || 'asc').toLowerCase() === 'desc' ? 'desc' : 'asc',
      }
    : null;
  const rawLimit = Number.parseInt(String(plan.limit || ''), 10);
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 200) : 50;

  return { table, operation, select, filters, sort, limit };
};

const evaluateFilter = (rowValue, op, filterValue) => {
  const textValue = rowValue == null ? '' : String(rowValue);
  const textNeedle = filterValue == null ? '' : String(filterValue);
  const normValue = normalizeText(textValue);
  const normNeedle = normalizeText(textNeedle);

  if (op === 'eq') return normValue === normNeedle;
  if (op === 'neq') return normValue !== normNeedle;
  if (op === 'contains') return normValue.includes(normNeedle);
  if (op === 'starts_with') return normValue.startsWith(normNeedle);
  if (op === 'in') {
    const parts = normNeedle.split(',').map((v) => v.trim()).filter(Boolean);
    return parts.includes(normValue);
  }
  if (op === 'gt' || op === 'gte' || op === 'lt' || op === 'lte') {
    const a = Number(textValue);
    const b = Number(textNeedle);
    if (Number.isFinite(a) && Number.isFinite(b)) {
      if (op === 'gt') return a > b;
      if (op === 'gte') return a >= b;
      if (op === 'lt') return a < b;
      return a <= b;
    }
    if (op === 'gt') return textValue > textNeedle;
    if (op === 'gte') return textValue >= textNeedle;
    if (op === 'lt') return textValue < textNeedle;
    return textValue <= textNeedle;
  }
  if (op === 'time_gt' || op === 'time_gte' || op === 'time_lt' || op === 'time_lte') {
    const a = toTimeMinutes(textValue);
    const b = toTimeMinutes(textNeedle);
    if (a == null || b == null) return false;
    if (op === 'time_gt') return a > b;
    if (op === 'time_gte') return a >= b;
    if (op === 'time_lt') return a < b;
    return a <= b;
  }
  if (op === 'is_null') return rowValue == null || String(rowValue).trim() === '';
  if (op === 'not_null') return !(rowValue == null || String(rowValue).trim() === '');
  return true;
};

const executeQueryPlan = (snapshot, plan) => {
  const rowsRaw = Array.isArray(snapshot?.data?.[plan.table]) ? snapshot.data[plan.table] : [];
  const missingFields = new Set();

  let rows = rowsRaw.filter((row) => {
    if (!row || typeof row !== 'object') return false;
    return plan.filters.every((filter) => {
      if (!(filter.field in row)) {
        missingFields.add(filter.field);
        return true;
      }
      return evaluateFilter(row[filter.field], filter.op, filter.value);
    });
  });

  if (plan.sort?.field) {
    const { field, direction } = plan.sort;
    rows = [...rows].sort((a, b) => {
      const av = a?.[field];
      const bv = b?.[field];
      if (av == null && bv == null) return 0;
      if (av == null) return direction === 'asc' ? -1 : 1;
      if (bv == null) return direction === 'asc' ? 1 : -1;
      const cmp = String(av).localeCompare(String(bv), 'de', { numeric: true, sensitivity: 'base' });
      return direction === 'asc' ? cmp : -cmp;
    });
  }

  if (plan.operation === 'count') {
    return { type: 'count', value: rows.length, table: plan.table, missingFields: [...missingFields] };
  }

  if (plan.operation === 'distinct') {
    const field = plan.select[0] || '';
    if (!field) return null;
    const values = Array.from(new Set(rows.map((row) => String(row?.[field] ?? '').trim()).filter(Boolean)));
    return {
      type: 'distinct',
      field,
      table: plan.table,
      values: values.slice(0, plan.limit),
      total: values.length,
      missingFields: [...missingFields],
    };
  }

  const selectedFields = plan.select.length > 0
    ? plan.select
    : Object.keys(rows[0] || {}).slice(0, 8);

  const projected = rows.slice(0, plan.limit).map((row) => {
    const result = {};
    selectedFields.forEach((field) => {
      result[field] = row?.[field];
    });
    return result;
  });

  return {
    type: 'list',
    table: plan.table,
    rows: projected,
    total: rows.length,
    selectedFields,
    missingFields: [...missingFields],
  };
};

const compactExecutionForResponder = (execution) => {
  if (!execution) return null;
  if (execution.type === 'count') {
    return { type: 'count', table: execution.table, value: execution.value };
  }
  if (execution.type === 'distinct') {
    return {
      type: 'distinct',
      table: execution.table,
      field: execution.field,
      total: execution.total,
      values: (execution.values || []).slice(0, 20),
    };
  }
  if (execution.type === 'list') {
    const selectedFields = Array.isArray(execution.selectedFields) ? execution.selectedFields.slice(0, 8) : [];
    const rows = Array.isArray(execution.rows) ? execution.rows.slice(0, 8).map((row) => {
      const out = {};
      selectedFields.forEach((field) => {
        const value = row?.[field];
        out[field] = value == null ? null : String(value).slice(0, 90);
      });
      return out;
    }) : [];
    return {
      type: 'list',
      table: execution.table,
      total: execution.total,
      selectedFields,
      rows,
    };
  }
  return null;
};

const callOllamaQueryPlanner = async ({ prompt, chatHistory = [], snapshot }) => {
  const schema = buildPlannerSchema(snapshot);
  const recentHistory = (Array.isArray(chatHistory) ? chatHistory : [])
    .slice(-3)
    .map((msg) => `${msg.role === 'assistant' ? 'assistant' : 'user'}: ${shorten(toText(msg?.text), 160)}`)
    .join('\n');

  const plannerPrompt = [
    'Du bist ein SQL-Query-Planer fuer ein JSON-Datenmodell.',
    'Erzeuge NUR ein JSON-Objekt ohne Erklaerung.',
    'Schema:',
    JSON.stringify(schema),
    '',
    'Erlaubte Operationen: list, count, distinct',
    'Erlaubte Filter-Operatoren: eq, neq, contains, starts_with, in, gt, gte, lt, lte, time_gt, time_gte, time_lt, time_lte, is_null, not_null',
    'Format:',
    '{"table":"...","operation":"list|count|distinct","select":["..."],"filters":[{"field":"...","op":"...","value":"..."}],"sort":{"field":"...","direction":"asc|desc"},"limit":50}',
    '',
    'Wenn etwas unklar ist, waehle den wahrscheinlichsten Plan statt Freitext.',
    '',
    'CHAT:',
    recentHistory || '(leer)',
    '',
    `FRAGE: ${prompt}`,
  ].join('\n');

  const endpoint = `${OLLAMA_URL.replace(/\/$/, '')}/api/generate`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      prompt: plannerPrompt,
      stream: false,
      options: { temperature: 0.0, num_predict: 220 },
    }),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) return null;
  const raw = String(data?.response || '').trim();
  const jsonBlock = extractFirstJsonObject(raw);
  if (!jsonBlock) return null;
  try {
    return JSON.parse(jsonBlock);
  } catch {
    return null;
  }
};

const runPlannedQueryAnswer = async ({ prompt, chatHistory, snapshot }) => {
  const planRaw = await callOllamaQueryPlanner({ prompt, chatHistory, snapshot });
  const plan = sanitizeQueryPlan(planRaw, snapshot);
  if (!plan) return null;
  const execution = executeQueryPlan(snapshot, plan);
  return execution;
};

const hasPlannedExecutionData = (execution) => {
  if (!execution || typeof execution !== 'object') return false;
  if (execution.type === 'count') return true;
  if (execution.type === 'distinct') {
    const total = Number(execution.total || 0);
    const values = Array.isArray(execution.values) ? execution.values.length : 0;
    return total > 0 || values > 0;
  }
  if (execution.type === 'list') {
    const total = Number(execution.total || 0);
    const rows = Array.isArray(execution.rows) ? execution.rows.length : 0;
    return total > 0 || rows > 0;
  }
  return false;
};

const callOllamaPlannedResultResponder = async ({ prompt, execution }) => {
  if (!execution) return null;
  const endpoint = `${OLLAMA_URL.replace(/\/$/, '')}/api/generate`;
  const compactExecution = compactExecutionForResponder(execution);
  const responderPrompt = [
    'Du bist der KI-Assistent der Trisar Koordinator-App.',
    'Formuliere eine NATUERLICHE, kurze und direkte Antwort auf Deutsch (maximal 3 kurze Saetze).',
    'Nutze nur die Ergebnisdaten unten.',
    'Verboten: Code, JSON, SQL, Python, "Lass uns...", "wir muessen analysieren", Schritt-fuer-Schritt-Erklaerungen.',
    'Antworte direkt mit dem Ergebnis.',
    'Wenn keine Treffer: sage klar, dass nichts gefunden wurde.',
    '',
    `Frage: ${prompt}`,
    '',
    'Ausgefuehrtes Ergebnis:',
    JSON.stringify(compactExecution),
  ].join('\n');

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      prompt: responderPrompt,
      stream: false,
      options: { temperature: 0.2, num_predict: 240 },
    }),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) return null;
  const text = String(data?.response || '').trim();
  if (looksLikeBadAssistantStyle(text)) return null;
  return text || null;
};

// --- DEMO-VORSCHAU: geskripteter KI-Assistent ----------------------------
// Das lokale Sprachmodell ist in der Online-Demo nicht erreichbar. Statt einer
// pauschalen Absage erkennt der Assistent genau eine Beispielanfrage (die das
// Tutorial eintippt) und liefert dafuer eine echte Buchungs-Vorschau im selben
// Format wie der LLM-Planer. Alle anderen Nachrichten bekommen einen festen,
// uebersetzten Hinweis (answerKey, die View uebersetzt).
export const KI_DEMO_ANFRAGE = 'Bitte buche morgen um 10:30 eine Fahrt für Katharina Vogel vom Hotel Bayerischer Hof zum Flughafen München Terminal 2.';

const KI_DEMO_TIPP_VERZOEGERUNG_MS = 1300;
const KI_DEMO_HINWEIS_VERZOEGERUNG_MS = 900;
const KI_DEMO_ZEIT = '10:30';
const KI_DEMO_GAST = 'Katharina Vogel';
const KI_DEMO_START = 'Hotel Bayerischer Hof';
// Kurzname wie bei den uebrigen Flughafenfahrten (orte.json kennt ihn, Karte und
// Distanzen funktionieren) — passt auch in die Vorschaukarte ohne Ueberlappung.
const KI_DEMO_ZIEL = 'MUC Terminal 2';
// Bevorzugte Fahrer (bekannt aus der Summit-Kolonne, alle mit Fahrzeug).
// Stefano Spandri ist morgen bereits mehrfach verplant und bleibt aussen vor.
const KI_DEMO_FAHRER_KANDIDATEN = ['Aaron Adler', 'Simone Schäfer', 'Elif Şahin'];
// Mindestabstand zu anderen Fahrten des Fahrers am selben Tag.
const KI_DEMO_KONFLIKT_PUFFER_MIN = 120;

const normalizeDemoPrompt = (value) => String(value || '')
  .toLowerCase()
  .replace(/\s+/g, ' ')
  .trim()
  .replace(/[\s.!?…]+$/g, '')
  .trim();

export const isKiDemoAnfrage = (prompt) => normalizeDemoPrompt(prompt) === normalizeDemoPrompt(KI_DEMO_ANFRAGE);

const wait = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

// "Morgen" auf Basis der lokalen Uhr — genauso rechnet die Datumsverschiebung
// im Demo-Client (Basistag = lokales Heute) und die Fahrtenliste.
const getLocalTomorrowIsoDate = () => {
  const now = new Date();
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;
};

const pickKiDemoDriver = async (rideDate) => {
  const fallback = { name: KI_DEMO_FAHRER_KANDIDATEN[0], vehicle: '' };
  try {
    const { data: profiles } = await supabase.from('profiles').select('id, first_name, last_name, vehicle_id');
    const { data: dayJobs } = await supabase.from('jobs').select('id, driver_id, etd').eq('ride_date', rideDate);
    const jobIds = (dayJobs || []).map((job) => job.id);
    const { data: assignments } = jobIds.length > 0
      ? await supabase.from('convoy_assignments').select('job_id, driver_id').in('job_id', jobIds)
      : { data: [] };
    const etdByJobId = new Map((dayJobs || []).map((job) => [String(job.id), job.etd]));
    const demoMinutes = toTimeMinutes(KI_DEMO_ZEIT);
    const busyMinutesByDriver = new Map();
    const addBusy = (driverId, etd) => {
      const minutes = toTimeMinutes(etd);
      if (!driverId || minutes == null) return;
      const key = String(driverId);
      if (!busyMinutesByDriver.has(key)) busyMinutesByDriver.set(key, []);
      busyMinutesByDriver.get(key).push(minutes);
    };
    (dayJobs || []).forEach((job) => addBusy(job.driver_id, job.etd));
    (assignments || []).forEach((row) => addBusy(row.driver_id, etdByJobId.get(String(row.job_id))));

    for (const candidateName of KI_DEMO_FAHRER_KANDIDATEN) {
      const profile = (profiles || []).find((row) => getDriverDisplayName(row) === candidateName);
      if (!profile) continue;
      const busy = busyMinutesByDriver.get(String(profile.id)) || [];
      const hasConflict = demoMinutes != null
        && busy.some((minutes) => Math.abs(minutes - demoMinutes) < KI_DEMO_KONFLIKT_PUFFER_MIN);
      if (hasConflict) continue;
      let vehicle = '';
      if (profile.vehicle_id) {
        const { data: vehicleRow } = await supabase
          .from('vehicles')
          .select('brand_model, trim, license_plate')
          .eq('id', profile.vehicle_id)
          .maybeSingle();
        if (vehicleRow) {
          const model = [vehicleRow.brand_model, vehicleRow.trim].filter(Boolean).join(' ');
          vehicle = vehicleRow.license_plate ? `${model} (${vehicleRow.license_plate})` : model;
        }
      }
      return { name: candidateName, vehicle };
    }
  } catch {
    // Demo: bei Fehlern mit dem Standardfahrer weiter
  }
  return fallback;
};

const buildKiDemoBookingAnswer = async () => {
  const rideDate = getLocalTomorrowIsoDate();
  const driver = await pickKiDemoDriver(rideDate);
  // Gleiche Struktur wie die Antwort des LLM-Buchungsplaners, damit derselbe
  // Parser (sanitizeRideBookingProposal) die Vorschau erzeugt.
  const plannerResult = {
    intent: 'booking_proposal',
    needs_clarification: false,
    missing_fields: [],
    clarification_question: '',
    ride: {
      ride_date: rideDate,
      etd: KI_DEMO_ZEIT,
      pickup_name: KI_DEMO_START,
      dropoff_name: KI_DEMO_ZIEL,
      guest_names: [KI_DEMO_GAST],
      anonymous_guests: 0,
      driver_names: [driver.name],
      convoy_name: '',
      flight_number: '',
      note: '',
    },
  };
  const proposal = sanitizeRideBookingProposal(plannerResult, KI_DEMO_ANFRAGE);
  const answerVars = {
    guest: KI_DEMO_GAST,
    date: `${rideDate.slice(8, 10)}.${rideDate.slice(5, 7)}.`,
    time: KI_DEMO_ZEIT,
    start: KI_DEMO_START,
    ziel: KI_DEMO_ZIEL,
    driver: driver.name,
    vehicle: driver.vehicle || 'BMW',
  };
  return {
    answer: `Gern. Ich habe die Fahrt für ${answerVars.guest} vorbereitet: morgen, ${answerVars.date}, um ${answerVars.time} Uhr, ${answerVars.start} → ${answerVars.ziel}. ${answerVars.driver} ist zu der Zeit frei und fährt den ${answerVars.vehicle}. Soll ich die Fahrt so buchen?`,
    answerKey: 'assist.demoBookingAnswer',
    answerVars,
    action: {
      type: 'booking_proposal',
      proposal: proposal.payload,
    },
    meta: { demo: true },
  };
};

// Weitere Beispielfragen der Demo. Die Antworten kommen aus den aktuellen
// Demo-Daten, nicht aus festen Texten: wer im Tutorial vorher etwas veraendert
// hat, sieht das auch hier.
export const KI_DEMO_FRAGE_OHNE_FAHRER = 'Welche Fahrten haben morgen noch keinen Fahrer?';
export const KI_DEMO_FRAGE_AKKU = 'Welche Fahrzeuge müssen heute noch laden oder tanken?';

const formatiereDatum = (iso) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.`;
const kurzerOrt = (name, adresse) => String(name || adresse || '').split(',')[0].trim() || '–';

const antwortOhneFahrer = async () => {
  const morgen = getLocalTomorrowIsoDate();
  const { data: fahrten } = await supabase
    .from('jobs')
    .select('id, etd, pickup_name, pickup_address, dropoff_name, dropoff_address, driver_id, status')
    .eq('ride_date', morgen);
  const { data: zuweisungen } = await supabase.from('convoy_assignments').select('job_id');
  const mitKolonne = new Set((zuweisungen || []).map((row) => String(row.job_id)));
  const offen = (fahrten || [])
    .filter((fahrt) => !fahrt.driver_id && !mitKolonne.has(String(fahrt.id)) && String(fahrt.status || '').toLowerCase() !== 'cancelled')
    .sort((a, b) => String(a.etd || '').localeCompare(String(b.etd || '')));
  if (!offen.length) {
    return { answer: `Morgen, ${formatiereDatum(morgen)}, sind alle Fahrten vergeben.`, meta: { demo: true } };
  }
  const beispiele = offen.slice(0, 3)
    .map((fahrt) => `${String(fahrt.etd || '').slice(0, 5)} Uhr: ${kurzerOrt(fahrt.pickup_name, fahrt.pickup_address)} → ${kurzerOrt(fahrt.dropoff_name, fahrt.dropoff_address)}`)
    .join('\n');
  return {
    answer: `Morgen, ${formatiereDatum(morgen)}, sind ${offen.length} Fahrten noch ohne Fahrer. Die nächsten sind:\n${beispiele}\nSoll ich passende freie Fahrer vorschlagen?`,
    meta: { demo: true },
  };
};

const antwortAkku = async () => {
  const { data: fahrzeuge } = await supabase
    .from('vehicles')
    .select('license_plate, brand_model, trim, fuel_type, battery_fuel_percent, range_km');
  const knapp = (fahrzeuge || [])
    .filter((fz) => Number.isFinite(Number(fz.battery_fuel_percent)) && Number(fz.battery_fuel_percent) < 30)
    .map((fz) => ({
      ...fz,
      prozent: Math.round(Number(fz.battery_fuel_percent)),
      // range_km ist die volle Reichweite, uebrig ist ihr Anteil am Stand.
      rest: Math.round(((Number(fz.range_km) || 0) * Number(fz.battery_fuel_percent)) / 100),
      elektrisch: /elektro|hybrid/i.test(String(fz.fuel_type || '')),
    }))
    .sort((a, b) => a.rest - b.rest);
  if (!knapp.length) {
    return { answer: 'Alle Fahrzeuge sind mindestens zu 30 % geladen oder getankt. Heute muss keines an die Säule.', meta: { demo: true } };
  }
  const zeile = (fz) => `${fz.license_plate || '–'} (${[fz.brand_model, fz.trim].filter(Boolean).join(' ')}): ${fz.prozent} %, noch etwa ${fz.rest} km`;
  const laden = knapp.filter((fz) => fz.elektrisch);
  const tanken = knapp.filter((fz) => !fz.elektrisch);
  const block = (titel, liste) => {
    if (!liste.length) return '';
    const mehr = liste.length > 3 ? `\nund ${liste.length - 3} weitere` : '';
    return `${titel} (${liste.length}):\n${liste.slice(0, 3).map(zeile).join('\n')}${mehr}`;
  };
  return {
    answer: [
      `${knapp.length} Fahrzeuge stehen unter 30 %. Die knappsten zuerst.`,
      block('Laden', laden),
      block('Tanken', tanken),
      'Am besten vor der nächsten längeren Fahrt erledigen.',
    ].filter(Boolean).join('\n\n'),
    meta: { demo: true },
  };
};

// Telefonnummer eines Fahrers ueber seine Nummer, etwa "Welche Telefonnummer
// hat Fahrer 10?". Die Nummer steht in der Antwort, die Ansicht macht sie klickbar.
export const KI_DEMO_FRAGE_TELEFON = 'Welche Telefonnummer hat Fahrer 10?';
const TELEFON_FRAGE_RE = /telefon(?:nummer)?|handynummer|nummer von|erreiche/i;
const FAHRERNUMMER_RE = /fahrer(?:in)?\s*(?:nr\.?|nummer)?\s*#?\s*(\d{1,3})/i;

const antwortTelefon = async (prompt) => {
  const treffer = String(prompt || '').match(FAHRERNUMMER_RE);
  const nummer = treffer ? Number(treffer[1]) : null;
  if (!Number.isFinite(nummer)) return null;
  const { data: profile } = await supabase
    .from('profiles')
    .select('first_name, last_name, phone, driver_number, role, is_dispo')
    .eq('driver_number', nummer);
  const fahrer = (profile || []).find((row) => row.is_dispo !== true) || (profile || [])[0];
  if (!fahrer) {
    return { answer: `Eine Fahrerin oder einen Fahrer mit der Nummer ${nummer} gibt es nicht.`, meta: { demo: true } };
  }
  const name = getDriverDisplayName(fahrer) || `Fahrer ${nummer}`;
  if (!String(fahrer.phone || '').trim()) {
    return { answer: `Fahrer ${nummer} ist ${name}. Eine Telefonnummer ist nicht hinterlegt.`, meta: { demo: true } };
  }
  return {
    answer: `Fahrer ${nummer} ist ${name}.\nTelefon: ${String(fahrer.phone).trim()}`,
    meta: { demo: true },
  };
};

const DEMO_FRAGEN = [
  {
    frage: KI_DEMO_FRAGE_TELEFON,
    passt: (text) => TELEFON_FRAGE_RE.test(text) && FAHRERNUMMER_RE.test(text),
    antwort: antwortTelefon,
  },
  { frage: KI_DEMO_FRAGE_OHNE_FAHRER, antwort: antwortOhneFahrer },
  { frage: KI_DEMO_FRAGE_AKKU, antwort: antwortAkku },
];

export const askDatabaseAssistant = async ({ prompt, chatHistory = [] }) => {
  const trimmedPrompt = String(prompt || '').trim();
  if (!trimmedPrompt) return 'Bitte stelle eine Frage.';

  // Im Betrieb gibt es noch kein angebundenes Modell. Die Beispielantworten
  // unten sind fuer die Demo gebaut (Beispielbuchung, feste Fragen), also hier
  // fuer jede Nachricht nur der Hinweis.
  if (!DEMO_MODE) {
    await wait(KI_DEMO_HINWEIS_VERZOEGERUNG_MS);
    return { answer: 'Der Assistent ist im Testbetrieb noch nicht freigeschaltet.', meta: { testbetrieb: true } };
  }

  // DEMO-VORSCHAU: kein LLM — nur die Beispielanfrage wird beantwortet.
  if (isKiDemoAnfrage(trimmedPrompt)) {
    const [result] = await Promise.all([buildKiDemoBookingAnswer(), wait(KI_DEMO_TIPP_VERZOEGERUNG_MS)]);
    return result;
  }
  const beispielFrage = DEMO_FRAGEN.find((eintrag) => (
    normalizeDemoPrompt(eintrag.frage) === normalizeDemoPrompt(trimmedPrompt)
    || (typeof eintrag.passt === 'function' && eintrag.passt(trimmedPrompt))
  ));
  if (beispielFrage) {
    try {
      const antwort = await beispielFrage.antwort(trimmedPrompt);
      if (antwort) return antwort;
    } catch {
      // Demo: faellt auf den Hinweis unten zurueck
    }
  }
  await wait(KI_DEMO_HINWEIS_VERZOEGERUNG_MS);
  return {
    answer: 'Das ist eine Demo-Version. Auf freie Nachrichten kann der KI-Assistent hier leider nicht antworten. Eine Beispielbuchung zeigt das Tutorial.',
    answerKey: 'assist.demoNotice',
    meta: { demo: true },
  };

  if (KI_PROVIDER !== 'ollama') {
    throw new Error(`Unbekannter KI Provider "${KI_PROVIDER}". Unterstützt: "ollama".`);
  }

  const normalizedPrompt = normalizeText(trimmedPrompt);
  const includeAll = isAllDataPrompt(trimmedPrompt) || isAllDriversPrompt(trimmedPrompt);
  const shouldForceRefresh = /\b(aktuell|live|jetzt|gerade|neueste|sofort)\b/.test(normalizedPrompt);
  const snapshotRaw = await loadDatabaseSnapshot({ includeAll, forceRefresh: shouldForceRefresh });

  if (isBookingPrompt(trimmedPrompt)) {
    const ruleBasedProposal = buildRuleBasedBookingProposal({
      prompt: trimmedPrompt,
      snapshot: snapshotRaw,
    });
    const llmProposal = await buildRideBookingProposal({
      prompt: trimmedPrompt,
      chatHistory,
      snapshot: snapshotRaw,
    });
    const hasRequired = (candidate) => Boolean(
      candidate?.payload?.start
      && candidate?.payload?.ziel
      && candidate?.payload?.startZeit,
    );
    const proposal = hasRequired(llmProposal)
      ? mergeBookingProposals(llmProposal, ruleBasedProposal)
      : hasRequired(ruleBasedProposal)
        ? ruleBasedProposal
        : mergeBookingProposals(llmProposal, ruleBasedProposal);
    if (proposal) {
      if (proposal.needsClarification) {
        return {
          answer: proposal.clarificationQuestion || 'Ich brauche noch ein paar Angaben zur Buchung.',
          action: {
            type: 'booking_needs_clarification',
            missingFields: proposal.missingFields || [],
          },
          meta: snapshotRaw.meta,
        };
      }
      return {
        answer: 'Ich habe eine Buchungs-Vorschau vorbereitet. Soll ich die Fahrt so buchen?',
        action: {
          type: 'booking_proposal',
          proposal: proposal.payload,
        },
        meta: snapshotRaw.meta,
      };
    }
  }

  const directIntentAnswer = buildDirectIntentAnswer({ prompt: trimmedPrompt, snapshot: snapshotRaw, chatHistory });
  if (directIntentAnswer) {
    return {
      answer: directIntentAnswer,
      meta: snapshotRaw.meta,
    };
  }

  try {
    const plannedExecution = await runPlannedQueryAnswer({ prompt: trimmedPrompt, chatHistory, snapshot: snapshotRaw });
    if (plannedExecution && hasPlannedExecutionData(plannedExecution)) {
      const naturalPlannedAnswer = await callOllamaPlannedResultResponder({
        prompt: trimmedPrompt,
        execution: plannedExecution,
      });
      if (LOW_CONFIDENCE_ANSWER_RE.test(String(naturalPlannedAnswer || ''))) {
        throw new Error('Planned answer low confidence');
      }
      return {
        answer: naturalPlannedAnswer || 'Ich konnte aus den gefundenen Daten keine natürliche Antwort formulieren.',
        meta: snapshotRaw.meta,
      };
    }
  } catch {
    // fall through to existing pipeline
  }

  const snapshot = filterSnapshotByPrompt(snapshotRaw, trimmedPrompt);
  const deterministic = buildDeterministicAnswer({ prompt: trimmedPrompt, snapshot, chatHistory });
  if (deterministic) {
    return {
      answer: deterministic,
      meta: snapshot.meta,
    };
  }
  const compactSnapshot = buildCompactSnapshotForLlm(snapshot, trimmedPrompt, includeAll);
  const systemPrompt = buildSystemPrompt();
  let semanticMatches = [];
  if (PGVECTOR_ENABLED) {
    try {
      const embedding = await createEmbedding(trimmedPrompt);
      semanticMatches = await fetchSemanticMatches(embedding, RAG_MATCH_COUNT);
    } catch {
      semanticMatches = [];
    }
  }
  const answer = await callOllamaGenerate({
    systemPrompt,
    userPrompt: trimmedPrompt,
    dbSnapshot: compactSnapshot,
    chatHistory,
    semanticMatches,
  });
  const shouldUseSemanticFallback = (
    (semanticMatches.length > 0 && LOW_CONFIDENCE_ANSWER_RE.test(String(answer || '')))
    || shouldForceStructuredRagAnswer(answer, semanticMatches, trimmedPrompt)
  );
  const resolvedAnswer = shouldUseSemanticFallback
    ? (buildSemanticFallbackAnswer(semanticMatches, trimmedPrompt) || answer)
    : answer;
  return {
    answer: resolvedAnswer,
    meta: {
      ...snapshot.meta,
      rag: {
        enabled: PGVECTOR_ENABLED,
        min_similarity: RAG_MIN_SIMILARITY,
        match_count: semanticMatches.length,
        sources: semanticMatches.slice(0, 6).map((row) => ({
          source_table: row?.source_table || '',
          source_id: row?.source_id || '',
          similarity: Number(row?.similarity || 0),
        })),
      },
    },
  };
};
