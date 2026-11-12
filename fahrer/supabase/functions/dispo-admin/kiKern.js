// KI-Assistent der Disposition. Web, iOS und Android rufen alle dispo-admin mit aktion ki_frage auf.
// Herausgeloest aus admin/src/services/kiAssistant.js. Alles liegt in kiErstellen, damit sich gleichzeitige
// Anfragen weder Gespraechskontext noch Daten teilen.
// deno-lint-ignore-file

const ALT_ANONYM_RE = /^anonymer?\s+fahrgast(?:\s+\d+)?$/i;
const anonymeAnzahl = (wert) => {
  const n = Number.parseInt(String(wert ?? '0'), 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
};
// Wie admin/src/shared/gaesteAnzeige.js.
const gaesteTeile = (namen, anonym) => {
  const roh = (Array.isArray(namen) ? namen : []).map((name) => String(name || '').trim()).filter(Boolean);
  const altAnonym = roh.filter((name) => ALT_ANONYM_RE.test(name)).length;
  const echteNamen = Array.from(new Set(roh.filter((name) => !ALT_ANONYM_RE.test(name))));
  return { namen: echteNamen, anonym: Math.max(anonymeAnzahl(anonym), altAnonym) };
};

// Date, dessen UTC-Felder die aktuelle Uhrzeit in Deutschland zeigen.
const jetztBerlin = () => {
  const teile = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date()).map((t) => [t.type, t.value]));
  return new Date(Date.UTC(+teile.year, +teile.month - 1, +teile.day, +teile.hour, +teile.minute, +teile.second));
};

export const kiErstellen = ({ admin, ollamaUrl, ollamaModell, kontext, fristMs = 52000 }) => {
// Normalisierter Text, also ohne Umlaute. "andere" allein waere auch das Wort fuer "weitere".
const AENDERN_RE = /\bfug(e|en|t)?\b.*\bhinzu\b|\btrag(e)?\b.*\bein\b|\bsetz(e)?\b.*\b(fahrer|als|auf)\b|\b(entferne|losche|storniere|verschiebe|aktualisiere)\b|^(bitte\s+)?andere\b|\b(andern|aktualisieren|verschieben|stornieren|loschen)\b.*(bitte|kannst|\?)|\b(kannst du|bitte)\b.*\b(andern|aktualisieren|verschieben|stornieren|loschen)\b/;
const ANPASSUNG_RE = /\b(fahrer|ziel|start|abfahrt|gast|fur|auf \d|\d{1,2}(:\d{2})? ?uhr|\d{1,2}:\d{2})\b/;
const STORNIEREN_RE = /\b(storniere|stornieren|losche|loschen)\b/;
// Kurzformen und Umgangssprache: "verschieb", "verleg", "gib die Fahrt Marvin", "soll Anna fahren", "uebernimmt".
const AENDERN_KURZ_RE = /\bverschieb\b|\bverleg(e|en)?\b|\bgib\b|\bsoll\b.*\bfahren\b|\bubernimmt\b|\bubernehmen soll\b/;
// Fahrer auf eine vorhandene Fahrt schicken: "Schick Tim auf die 18 Uhr Fahrt", "Plan Marvin fuer die offene Fahrt ein".
const ZUWEISEN_RE = /\b(schick|schicke|plan|plane|teil|teile|nimm)\b.*\b(die|der|den|diese|dieser|zur)\b(\s+[a-z0-9:]+){0,3}\s+fahrt\b|\b(die|der|diese)\b(\s+[a-z0-9:]+){0,3}\s+fahrt\b.*\b(schick|schicke|plan|plane|teil|teile)\b/;
// Korrektur eines gerade gezeigten Vorschlags: "doch lieber 11:30".
const KORREKTUR_RE = /\b(doch|lieber|stattdessen|besser|eher|nein)\b/;
const FRAGE_OHNE_FAHRER_RE = /\b(kein|keine|keinen|ohne)\b.*\bfahrer\b/;
const supabase = admin;
const supabaseAdmin = admin;
const hasSupabaseAdminConfig = false;

// Kong bricht nach 60 s ab. Alle Modellaufrufe einer Frage teilen sich eine Frist.
const frist = Date.now() + fristMs;
const fetch = (url, optionen = {}) => globalThis.fetch(url, {
  ...optionen,
  signal: AbortSignal.timeout(Math.max(1000, frist - Date.now())),
});

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
  // Alle im Gespraech genannten Fahrten (neueste zuerst), die zuletzt gezeigte Liste und eine offene Rueckfrage.
  fahrten: [],
  letzteListe: [],
  letzteFahrer: [],
  fokusMehrdeutig: false,
  rueckfrage: null,
  ...(kontext && typeof kontext === 'object' ? kontext : {}),
};
if (!Array.isArray(conversationContext.fahrten)) conversationContext.fahrten = [];
if (!Array.isArray(conversationContext.letzteListe)) conversationContext.letzteListe = [];
if (!Array.isArray(conversationContext.letzteFahrer)) conversationContext.letzteFahrer = [];


const OLLAMA_URL = ollamaUrl;
const OLLAMA_MODEL = ollamaModell || DEFAULT_MODEL;
const OLLAMA_EMBED_MODEL = '';
const OLLAMA_EMBED_ENDPOINT = '/api/embeddings';
const PGVECTOR_ENABLED = false;
const RAG_MATCH_COUNT = 8;
const RAG_MIN_SIMILARITY = 0.42;

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
    ab = null,
  } = options;

  let query = queryClient.from(table).select(select);
  // ab: [spalte, wert], nur Zeilen ab diesem Wert (z. B. keine alten Fahrten, sonst fuellen sie das Limit).
  if (Array.isArray(ab)) query = query.gte(ab[0], ab[1]);
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
      // Routendauer und Koordinaten fuer Konfliktpruefung, Fahrervorschlag und Standort.
      'id, ride_date, etd, status, driver_id, convoy_id, pickup_name, pickup_address, dropoff_name, dropoff_address, passengers, anonymous_guests, pickup_ort_id, dropoff_ort_id, ext_route_duration_mins, ext_route_duration_in_traffic_mins, ext_route_distance_m, route_von:ext_route_payload->von, route_nach:ext_route_payload->nach',
      'id, ride_date, etd, status, driver_id, convoy_id, pickup_name, pickup_address, dropoff_name, dropoff_address, passengers, anonymous_guests, ext_route_duration_mins',
      'id, ride_date, etd, status, driver_id, convoy_id, pickup_name, pickup_address, dropoff_name, dropoff_address, passengers, anonymous_guests',
    ], { orderBy: 'ride_date', ascending: true, limit: perTableLimit, ab: ['ride_date', tagPlus(-7)] }),
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
  // Eigene Orte (Karten Filter) und Dienste ab gestern. Fehlt eine Tabelle, bleibt sie leer.
  const [orteResult, diensteResult] = await Promise.all([
    queryTableWithFallback('orte', ['id, name, adresse, lat, lng, radius_rein_m, radius_raus_m'], { limit: 1000 }),
    queryTableWithFallback('driver_service_requests', ['id, driver_id, service_date, service_start_time, service_end_time, status, created_at'], {
      orderBy: 'created_at', ascending: false, limit: 1000, ab: ['service_date', tagPlus(-1)],
    }),
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
      orte: orteResult.error ? [] : orteResult.data,
      dienste: diensteResult.error ? [] : diensteResult.data,
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
Jetzt ist ${jetztBerlin().toISOString().slice(0, 16).replace('T', ' ')} Uhr (Deutschland).
Regeln:
- Fahrten stehen fertig in fahrten_uebersicht. Die Zahl der passenden Fahrten steht in anzahl, zaehle nicht selbst. Ist anzahl 0, gibt es im genannten Zeitraum keine passende Fahrt.
- Nenne nie IDs. Nenne Fahrer, Orte und Uhrzeiten.
- Worueber gerade gesprochen wurde, steht in im_gespraech_genannt, die erste Zeile ist die zuletzt genannte Fahrt. Mit 'die Fahrt', 'dort' oder 'die' ist diese gemeint.
- Antworte auf Deutsch, klar und knapp.
- Nutze ausschliesslich die gelieferten Daten als Quelle (DB-SNAPSHOT und SEMANTISCHE TREFFER).
- Du hast in dieser App explizit Leserechte auf die bereitgestellten DB-Daten (inkl. Kontaktdaten), wenn sie im Snapshot enthalten sind.
- Wenn Information fehlt, sage das explizit.
- Erfinde keine IDs, Zeiten, Namen oder Status.
- Du aenderst selbst nichts. Ist eine Buchung, Aenderung oder ein Dienst gemeint, frage in einem Satz nach, welche Fahrt oder welcher Fahrer und was genau passieren soll.
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

const toIsoDateString = (date = jetztBerlin()) => date.toISOString().slice(0, 10);
const tagPlus = (tage) => {
  const d = jetztBerlin();
  d.setUTCDate(d.getUTCDate() + tage);
  return toIsoDateString(d);
};

const formatCapturedAtLocal = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return '';
  return new Intl.DateTimeFormat('de-DE', {
    timeZone: 'Europe/Berlin',
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
    let year = jetztBerlin().getUTCFullYear();
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

  if (/\bubermorgen\b/.test(text)) {
    const d = jetztBerlin();
    d.setUTCDate(d.getUTCDate() + 2);
    return { type: 'date', value: toIsoDateString(d) };
  }
  // Wochentag: der naechste kommende (heute zaehlt mit, "naechsten" schiebt eine Woche weiter).
  const wochentag = text.match(/\b(sonntag|montag|dienstag|mittwoch|donnerstag|freitag|samstag)\b/);
  if (wochentag) {
    const ziel = ['sonntag', 'montag', 'dienstag', 'mittwoch', 'donnerstag', 'freitag', 'samstag'].indexOf(wochentag[1]);
    const d = jetztBerlin();
    let plus = (ziel - d.getUTCDay() + 7) % 7;
    if (plus === 0 && /\bnachste[nmrs]?\s+/.test(text)) plus = 7;
    d.setUTCDate(d.getUTCDate() + plus);
    return { type: 'date', value: toIsoDateString(d) };
  }
  if (/\bheute\b/.test(text)) return { type: 'date', value: toIsoDateString() };
  if (/\bmorgen\b/.test(text)) {
    const d = jetztBerlin();
    d.setUTCDate(d.getUTCDate() + 1);
    return { type: 'date', value: toIsoDateString(d) };
  }
  if (/\bgestern\b/.test(text)) {
    const d = jetztBerlin();
    d.setUTCDate(d.getUTCDate() - 1);
    return { type: 'date', value: toIsoDateString(d) };
  }
  return null;
};

const isBookingPrompt = (prompt) => {
  const text = normalizeText(prompt);
  if (/(buch|buchen|buche|anlegen|erstelle|erstellen|neue fahrt|fahrt anlegen|fahrt buchen|reservier)/.test(text)) return true;
  // "Schick Stefano eine Fahrt ...", "Gib Tim eine Fahrt ...", "Plan fuer Anna eine Fahrt ...", "Trag eine Fahrt ein":
  // eine NEUE Fahrt (unbestimmter Artikel). "die Fahrt" meint dagegen eine vorhandene.
  const neueFahrt = /\b(eine|ne|einen|noch eine|neue[nr]?)\s+(neue\s+|weitere\s+)?(fahrt|tour|transfer|abholung)\b/.test(text);
  if (neueFahrt && /^(kannst|konntest|wurdest|kann man)\b/.test(text)) return true;
  if (/\?\s*$/.test(String(prompt || ''))) return false;
  if (neueFahrt && !/^(wer|wann|wie|was|wo|welche|hat|ist|gibt)\b/.test(text)) return true;
  // "Schick Tim morgen um 7 zum Flughafen": Fahrer irgendwohin schicken ist eine neue Fahrt, solange keine
  // vorhandene ("die Fahrt") und kein Dienst gemeint ist.
  if (/^(bitte\s+)?(schick|schicke|plan|plane)\b/.test(text)
    && /\b(nach|zum|zur|ins|in die|vom|von der)\b/.test(text)
    && !/\b(die|der|den|diese|dieser)\b(\s+[a-z0-9:]+){0,3}\s+fahrt\b/.test(text)
    && !/dienst|schicht|feierabend|pause|nach hause|heim/.test(text)) return true;
  // "Hol Herrn Engel ... ab", "Ich brauche ein Auto ...", "Fahrt fuer Julia Weber morgen 11:30 ..."
  return /\bhol\b.*\bab\b|\babholen\b.*\b(und|bring)/.test(text)
    || /\bbrauch(e|en)?\b.*\b(auto|wagen|fahrzeug|fahrt|fahrer)\b/.test(text)
    || /^(eine\s+)?fahrt\s+(fur|ab|von|um|morgen|heute|ubermorgen)\b/.test(text);
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

  // Findet der Wortvergleich nichts, bleibt die ganze Liste. Das Modell sucht dann selbst.
  ['profiles', 'vehicles', 'guests'].forEach((tabelle) => {
    if (Array.isArray(filtered[tabelle]) && filtered[tabelle].length === 0) filtered[tabelle] = data[tabelle];
  });

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

const GEMERKTE_FAHRTEN = 30;
const fahrtenMerken = (ids) => {
  const neu = ids.filter(Boolean).map(String);
  conversationContext.fahrten = Array.from(new Set([...neu, ...conversationContext.fahrten])).slice(0, GEMERKTE_FAHRTEN);
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
    fokusMehrdeutig: false,
  };
  fahrtenMerken([ride?.id]);
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

// Fahrer, deren Vor- oder Nachname in der Frage steht.
const genannteFahrer = (snapshot, prompt) => {
  const woerter = normalizeText(prompt).split(/[^a-z0-9]+/);
  return (snapshot?.data?.fahrer_profiles || []).filter((profil) => [profil?.first_name, profil?.last_name].some((name) => {
    const n = normalizeText(name);
    return n.length >= 3 && !['fahrer', 'fahrt'].includes(n) && (woerter.includes(n) || woerter.includes(`${n}s`));
  }));
};

const buildDirectIntentAnswer = ({ prompt, snapshot, chatHistory = [] }) => {
  // Fragen nach fehlenden Fahrern beantwortet das Modell aus der Fahrtenuebersicht.
  if (FRAGE_OHNE_FAHRER_RE.test(normalizeText(prompt))) return null;
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

  // Fahrzeug eines Fahrers direkt aus den Daten, nicht vom Modell (das hat Fahrzeuge verwechselt).
  if (/\b(auto|fahrzeug|wagen|kennzeichen)\b/.test(text) && /\b(welche[nsrm]?|was fur|hat|fahrt)\b/.test(text)) {
    const gemeint = genannteFahrer(snapshot, prompt);
    if (gemeint.length) {
      const nachId = new Map(vehicles.map((v) => [v.id, v]));
      return gemeint.map((profil) => {
        const v = nachId.get(profil.vehicle_id);
        const name = getDriverDisplayName(profil);
        if (!v) return `${name} hat kein Fahrzeug zugewiesen.`;
        const modell = [v.brand_model, v.trim].filter(Boolean).join(' ');
        return `${name} fährt ${modell || 'ein Fahrzeug'}${v.license_plate ? ` (${v.license_plate})` : ''}.`;
      }).join('\n');
    }
  }

  if (/(wie viel|wieviel|wie viele|anzahl).*(fahrer)/.test(text)) {
    return `Es gibt ${drivers.length} Fahrer in der Datenbank.`;
  }

  if (
    dateHint?.type === 'date'
    && /(fahrt|fahrten)/.test(text)
    && /(gibt es|gibts|haben wir|hast du|wie viele|anzahl|fuer|für|am)/.test(text)
    && genannteFahrer(snapshot, prompt).length === 0
    && uhrzeitenIn(prompt).length === 0
  ) {
    const dayJobs = jobs.filter((job) => String(job?.ride_date || '').startsWith(dateHint.value) && aktiveFahrt(job));
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
      return `Am ${displayDate} gibt es 1 Fahrt (${etd}) von ${from} nach ${to}.`;
    }
    if (dayJobs.length > 0) {
      // Mehrere Fahrten: keine davon ist "die Fahrt".
      fahrtenMerken(dayJobs.slice(0, 10).map((job) => job.id));
      conversationContext.letzteListe = dayJobs.slice(0, 10).map((job) => job.id);
      conversationContext.fokusMehrdeutig = true;
    }
    return `Am ${displayDate} gibt es ${dayJobs.length} Fahrten.`;
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

    const { namen: names, anonym } = gaesteTeile([...linkedNames, ...passengerNames], contextualRide?.anonymous_guests);
    const anonymText = anonym === 1 ? '1 anonymer Gast' : `${anonym} anonyme Gäste`;
    if (names.length === 0) {
      if (anonym > 0) return `Für diese Fahrt ist kein Gastname hinterlegt, nur ${anonymText}.`;
      return 'Für diese Fahrt sind keine Gäste hinterlegt.';
    }
    if (anonym > 0) return `Gäste dieser Fahrt (${names.length} + ${anonym}): ${names.join(', ')} und ${anonymText}.`;
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

  const nurFlottenfrage = vehicleIntent && !phoneIntent && !locationIntent && !hasDriverReference;
  if (nurFlottenfrage && /\b(welche|alle|liste|haben wir|wie viele)\b/.test(text)) {
    const fahrzeuge = Array.isArray(snapshot?.data?.vehicles) ? snapshot.data.vehicles : [];
    if (fahrzeuge.length === 0) return 'Ich finde aktuell keine Fahrzeuge in der Datenbank.';
    const zeilen = fahrzeuge.map((fahrzeug) => `- ${[fahrzeug?.license_plate, fahrzeug?.brand_model, fahrzeug?.trim].filter(Boolean).join(', ')}`);
    return `Wir haben ${fahrzeuge.length} Fahrzeuge:\n${zeilen.join('\n')}`;
  }
  if (!nurFlottenfrage && (phoneIntent || vehicleIntent || locationIntent)) {
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
      keep_alive: '30m',
      options: { num_ctx: 8192,
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
      keep_alive: '30m',
        options: { num_ctx: 8192,
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
  // Das Datum aus der Frage gilt vor dem Modell, das Vergangenes erfindet.
  const dateHint = extractDateHint(prompt);
  if (dateHint?.type === 'date' && /^\d{4}-\d{2}-\d{2}$/.test(dateHint.value)) return dateHint.value;
  const heute = jetztBerlin().toISOString().slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw) && raw >= heute) return raw;
  return heute;
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
    `HEUTE: ${jetztBerlin().toISOString().slice(0, 10)}`,
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
      keep_alive: '30m',
      options: { num_ctx: 8192, temperature: 0.0, num_predict: 320 },
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
  // Nur Fahrer, die wirklich in der Frage stehen.
  const frageText = normalizeText(prompt);
  const driverNames = Array.isArray(ride.driver_names)
    ? ride.driver_names.map((v) => String(v || '').trim()).filter((name) => (
      name && normalizeText(name).split(' ').some((teil) => teil.length >= 3 && frageText.includes(teil))
    ))
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
  if (match) return normalizeBookingTime(match[1]);
  const mitUhr = uhrzeitenIn(prompt)[0];
  if (mitUhr) return mitUhr;
  const um = normalizeText(prompt).match(/\bum (\d{1,2})\b/);
  return um ? uhrzeitAus(um[1], 0) : '';
};

// Verbteile am Satzende gehoeren nicht zum Ort: "zum Flughafen T1 ein", "zum Hauptbahnhof schicken".
const VERB_REST_RE = /\s+(ein|an|ab|zu|hin|bitte|schicken|buchen|eintragen|anlegen|planen|bringen|fahren|geben|setzen|holen|abholen|einplanen|reservieren)$/i;
const ohneVerbReste = (route) => {
  const weg = (ort) => {
    let t = String(ort || '').trim();
    while (VERB_REST_RE.test(t)) t = t.replace(VERB_REST_RE, '').trim();
    return t;
  };
  return { start: weg(route.start), ziel: weg(route.ziel) };
};

const extractBookingRouteFromPrompt = (prompt) => {
  const raw = String(prompt || '').trim();
  if (!raw) return { start: '', ziel: '' };

  const ende = '(?=(?:\\s+mit\\b|\\s+und\\b|\\s+fahrer\\b|\\s+f(?:ü|ue)r\\b|\\s+um\\s+\\d|\\s+(?:heute|morgen|übermorgen|jetzt|sofort|gleich)\\b|,|[.!?]|$))';
  // "am Flughafen ab und bring ihn ins Hotel": zuerst, sonst haelt die naechste Regel "ab und bring ihn" fuer den Start.
  const abholen = raw.match(new RegExp(`\\b(?:am|an der|an dem|vom|von der|beim)\\s+(.+?)\\s+ab\\b.*?\\b(?:nach|zum|zur|ins|in die|in den)\\s+(.+?)${ende}`, 'i'));
  if (abholen) return ohneVerbReste({ start: abholen[1].trim(), ziel: abholen[2].trim() });
  // Ein Ort endet vor "mit", "und", "fuer", "um 10", "morgen", "10 Uhr", Komma oder Satzende.
  const pattern = /\b(von|vom|ab|aus)\s+(.+?)\s+(?:nach|zum|zur|ins|in die|in den)\s+(.+?)(?=(?:\s+mit\b|\s+und\b|\s+der\s+gast\b|\s+gast\s+hei(?:ss|ß)t\b|\s+fahrer\b|\s+f(?:ü|ue)r\b|\s+um\s+\d|\s+(?:heute|morgen|übermorgen|jetzt|sofort|gleich)\b|\s+\d{1,2}(?::\d{2})?\s*uhr\b|,|[.!?]|$))/i;
  const match = raw.match(pattern);
  if (match?.[2] && match?.[3] && !/^(und|bring|mit)\b/i.test(match[2])) {
    return ohneVerbReste({
      start: String(match[2]).trim(),
      ziel: String(match[3]).trim(),
    });
  }
  // "einen Wagen am Hauptbahnhof zum Hotel"
  const amOrt = raw.match(new RegExp(`\\b(?:am|an der|an dem|beim|vor dem|vor der)\\s+(?!(?:montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag|morgen|abend|vormittag|nachmittag|wochenende|\\d))(.+?)\\s+(?:nach|zum|zur|ins|in die|in den)\\s+(.+?)${ende}`, 'i'));
  if (amOrt) return ohneVerbReste({ start: amOrt[1].trim(), ziel: amOrt[2].trim() });
  // "11:30 Flughafen T1 zum Hotel Vier Jahreszeiten" (Ort direkt nach der Uhrzeit)
  const nachZeit = raw.match(new RegExp(`\\d(?::\\d{2})?(?:\\s*uhr)?\\s+(?!(?:mit|und|fur|für|uhr)\\b)(.+?)\\s+(?:nach|zum|zur|ins|in die|in den)\\s+(.+?)${ende}`, 'i'));
  if (nachZeit) return ohneVerbReste({ start: nachZeit[1].trim(), ziel: nachZeit[2].trim() });
  // Nur Abholort: "vom Hotel Bayerischer Hof" -> Ziel fehlt, es wird nachgefragt.
  const nurStart = raw.match(new RegExp(`\\b(?:vom|von der|von dem|ab)\\s+(?!\\d)(.+?)${ende}`, 'i'));
  // Nur Ziel: "zum Flughafen" -> Start fehlt, es wird nachgefragt.
  const nurZiel = raw.match(new RegExp(`\\b(?:nach|zum|zur|ins|in die|in den)\\s+(.+?)${ende}`, 'i'));
  return ohneVerbReste({ start: nurStart ? nurStart[1].trim() : '', ziel: nurZiel && !nurStart ? nurZiel[1].trim() : '' });
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

const extractBookingGuestNameFromPrompt = (prompt, fahrer = []) => {
  const raw = String(prompt || '').trim();
  if (!raw) return '';
  const patterns = [
    /\bgast\s+hei(?:ss|ß)t\s+(.+?)(?=(?:\s+und\b|\s+mit\b|\s+fahrer\b|[.!?]|$))/i,
    /\bmit\s+(?:dem|den|der|einem|einer)?\s*gast\s+(.+?)(?=(?:\s+und\b|\s+f(?:ü|ue)r\b|\s+fahrer\b|,|[.!?]|$))/i,
    /\bg(?:ä|ae)ste\s+(?:sind\s+)?((?:Herrn?\s+|Frau\s+)?[A-ZÄÖÜ][\p{L}-]+(?:\s+[A-ZÄÖÜ][\p{L}-]+)?(?:\s*(?:,|und)\s*(?:Herrn?\s+|Frau\s+)?[A-ZÄÖÜ][\p{L}-]+(?:\s+[A-ZÄÖÜ][\p{L}-]+)?)*)/u,
    /\bgast\s+(.+?)(?=(?:\s+und\b|\s+f(?:ü|ue)r\b|\s+fahrer\b|,|[.!?]|$))/i,
    /\bmit\s+((?:Herrn?|Frau)\s+[A-ZÄÖÜ][\p{L}-]+(?:\s+[A-ZÄÖÜ][\p{L}-]+)?)/u,
    /\b(?:für|fuer)\s+((?:(?:Herrn?|Frau|Dr\.?)\s+[A-ZÄÖÜ][\p{L}-]+(?:\s+[A-ZÄÖÜ][\p{L}-]+)?|[A-ZÄÖÜ][\p{L}-]+\s+[A-ZÄÖÜ][\p{L}-]+)(?:\s*(?:,|und)\s*(?:(?:Herrn?|Frau|Dr\.?)\s+[A-ZÄÖÜ][\p{L}-]+(?:\s+[A-ZÄÖÜ][\p{L}-]+)?|[A-ZÄÖÜ][\p{L}-]+\s+[A-ZÄÖÜ][\p{L}-]+))*)/u,
    /\b[Hh]ol(?:e|t)?\s+((?:Herrn?|Frau)\s+[A-ZÄÖÜ][\p{L}-]+(?:\s+[A-ZÄÖÜ][\p{L}-]+)?)/u,
  ];
  for (const pattern of patterns) {
    const match = raw.match(pattern);
    const name = sanitizeGuestName(match?.[1] || '').replace(/\s+und\s+/g, ', ')
      .split(/\s*,\s*/).filter((teil) => teil && !/^(flug|flugnummer|terminal|hotel|gate|fahrer|fahrerin)\b/i.test(teil)).join(', ');
    // Ein Fahrername ist kein Gast ("Plan fuer Stefano Spandri eine Fahrt").
    if (name && !istFahrerName(name, fahrer)) return name;
  }
  return '';
};

// "jetzt", "sofort", "gleich", "in 20 Minuten", "in einer Stunde": Datum und Uhrzeit ab jetzt,
// auf die naechsten 5 Minuten aufgerundet. Nur wenn keine feste Uhrzeit dasteht.
const relativeBuchungszeit = (prompt) => {
  const text = normalizeText(prompt);
  let plus = null;
  const inMin = text.match(/\bin\s+(\d{1,3})\s*(min|minuten)\b/);
  const inStd = text.match(/\bin\s+(einer|einer halben|1|2|3|zwei|drei)\s*(std|stunde|stunden)\b/);
  if (inMin) plus = Number(inMin[1]);
  else if (inStd) plus = { einer: 60, 'einer halben': 30, 1: 60, 2: 120, 3: 180, zwei: 120, drei: 180 }[inStd[1]];
  else if (/\b(jetzt|sofort|gleich|asap|umgehend|so schnell wie moglich)\b/.test(text)) plus = 0;
  if (plus == null) return null;
  const d = jetztBerlin();
  const min = d.getUTCHours() * 60 + d.getUTCMinutes() + (d.getUTCSeconds() > 0 ? 1 : 0) + plus;
  const gerundet = Math.ceil(min / 5) * 5;
  const tag = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) + gerundet * 60000);
  return { datum: tag.toISOString().slice(0, 10), zeit: tag.toISOString().slice(11, 16) };
};

const istFahrerName = (name, fahrer = []) => {
  const n = normalizeText(name);
  return Boolean(n) && fahrer.some((p) => normalizeText(getDriverDisplayName(p)) === n);
};

const buildRuleBasedBookingProposal = ({ prompt, snapshot }) => {
  const daten = snapshot?.data || {};
  // "jetzt" gilt nur ohne feste Uhrzeit und ohne anderen Tag ("Buche jetzt eine Fahrt fuer morgen" fragt nach der Zeit).
  const tagInFrage = extractDateHint(prompt);
  let relativ = uhrzeitenIn(prompt).length ? null : relativeBuchungszeit(prompt);
  if (relativ && tagInFrage?.type === 'date' && tagInFrage.value !== relativ.datum) relativ = null;
  const rideDate = relativ ? relativ.datum : normalizeBookingDate('', prompt);
  const startZeit = relativ ? relativ.zeit : extractBookingTimeFromPrompt(prompt);
  const roheRoute = extractBookingRouteFromPrompt(prompt);
  const route = { start: ortVereinheitlichen(roheRoute.start, daten), ziel: ortVereinheitlichen(roheRoute.ziel, daten) };
  const drivers = Array.isArray(daten.fahrer_profiles) ? daten.fahrer_profiles : [];
  const guestName = extractBookingGuestNameFromPrompt(prompt, drivers);
  // Fahrer nur aus der Frage: per Nummer oder Name. Namen in Gast, Start und Ziel zaehlen nicht.
  let rest = String(prompt || '');
  [guestName, roheRoute.start, roheRoute.ziel].filter(Boolean).forEach((teil) => { rest = rest.split(teil).join(' '); });
  const requestedDriverNumber = extractRequestedDriverNumber(rest);
  const perNummer = requestedDriverNumber ? resolveDriverByNumberOrIndex(drivers, requestedDriverNumber) : null;
  const perName = genannteFahrer(snapshot, rest);
  const fahrerNamen = Array.from(new Set([...(perNummer ? [perNummer] : []), ...perName].map(getDriverDisplayName).filter(Boolean)));
  if (!fahrerNamen.length && requestedDriverNumber) fahrerNamen.push(`Fahrer #${requestedDriverNumber}`);
  // "2 Gäste", "3 Personen": ohne Namen anonyme Gaeste, mit Namen der Rest.
  const anzahl = normalizeText(prompt).match(/\b(\d{1,2})\s*(gaste|personen|fahrgaste|pax|leute)\b/);
  const namenAnzahl = guestName ? guestName.split(',').filter((n) => n.trim()).length : 0;
  const anonym = anzahl ? Math.max(0, Number(anzahl[1]) - namenAnzahl) : 0;
  const flug = /\bflug/i.test(prompt) ? String(prompt).match(/\b([A-Z]{2}|[A-Z]\d|\d[A-Z])\s?(\d{2,4})\b/) : null;

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
      anonymeGaeste: String(anonym),
      fahrerNamen,
      konvoi: '',
      flugnummer: flug ? `${flug[1]}${flug[2]}` : '',
      notes: '',
      aktuellerStatus: 'offen',
    },
  };
};

// Fehlende Buchungsangaben aus dem Modell uebernehmen, aber nur, was in Frage oder Verlauf wirklich steht.
const MODELL_ORT_STOP = new Set(['auto', 'wagen', 'fahrzeug', 'fahrt', 'fahrer', 'taxi', 'gast']);
const buchungErgaenzen = (regel, modell, prompt, chatHistory, daten) => {
  if (!modell?.payload) return regel;
  const quellen = normalizeText([prompt, ...(Array.isArray(chatHistory) ? chatHistory : [])
    .filter((m) => m?.role !== 'assistant').slice(-2).map((m) => toText(m?.text))].join(' '));
  const steht = (wert) => {
    const n = normalizeText(wert);
    return n.length >= 3 && !MODELL_ORT_STOP.has(n) && quellen.includes(n);
  };
  const p = { ...regel.payload };
  const m = modell.payload;
  if (!p.start && steht(m.start)) p.start = ortVereinheitlichen(m.start, daten);
  if (!p.ziel && steht(m.ziel)) p.ziel = ortVereinheitlichen(m.ziel, daten);
  // Start gleich Ziel kommt vom Modell (es kopiert den einzigen Ort): dann bleibt fehlend, was die Regel nicht hatte.
  if (p.ziel && p.start && normalizeText(p.ziel) === normalizeText(p.start)) {
    p.start = regel.payload.start;
    p.ziel = regel.payload.ziel;
  }
  const stunde = String(m.startZeit || '').match(/^(\d{2}):/)?.[1];
  if (!p.startZeit && stunde && new RegExp(`\\b0?${Number(stunde)}\\b`).test(quellen)) p.startZeit = m.startZeit;
  if (!p.fahrgaeste && m.fahrgaeste) {
    const gaeste = m.fahrgaeste.split(',').map((n) => n.trim()).filter((n) => steht(n) && !istFahrerName(n, daten?.fahrer_profiles || []));
    p.fahrgaeste = gaeste.join(', ');
  }
  if (!p.flugnummer && m.flugnummer && steht(m.flugnummer)) p.flugnummer = m.flugnummer;
  const fehlend = [];
  if (!p.start) fehlend.push('start');
  if (!p.ziel) fehlend.push('ziel');
  if (!p.startZeit) fehlend.push('startZeit');
  return { ...regel, payload: p, missingFields: fehlend, needsClarification: fehlend.length > 0 };
};

// Antwort auf eine Buchung: Rueckfrage (und merken, was schon da ist) oder Vorschlag.
const buchungsAntwort = (proposal, snapshot) => {
  if (proposal.needsClarification) {
    conversationContext.offeneBuchung = { payload: proposal.payload, missing: proposal.missingFields || [], zeit: Date.now() };
    return {
      answer: buchungsRueckfrage(proposal.payload, proposal.missingFields || []),
      action: { type: 'booking_needs_clarification', missingFields: proposal.missingFields || [] },
      meta: snapshot.meta,
    };
  }
  conversationContext.offeneBuchung = null;
  return {
    answer: buchungsText(proposal.payload, snapshot.data),
    action: { type: 'booking_proposal', proposal: proposal.payload },
    meta: snapshot.meta,
  };
};

// Fehlende Angaben einer offenen Buchung aus der Antwort lesen. null, wenn die Antwort nichts dazu sagt.
const buchungFortsetzen = (offen, prompt, snapshot) => {
  const daten = snapshot?.data || {};
  const teil = buildRuleBasedBookingProposal({ prompt, snapshot }).payload;
  const p = { ...offen.payload, fahrerNamen: [...(offen.payload.fahrerNamen || [])] };
  let neu = false;
  const setze = (feld, wert) => { if (wert && JSON.stringify(p[feld]) !== JSON.stringify(wert)) { p[feld] = wert; neu = true; } };
  if (extractDateHint(prompt)?.type === 'date') setze('datum', teil.datum);
  if (uhrzeitenIn(prompt).length || /\bum \d/.test(normalizeText(prompt)) || relativeBuchungszeit(prompt)) setze('startZeit', teil.startZeit);
  setze('start', teil.start);
  setze('ziel', teil.ziel);
  setze('fahrgaeste', teil.fahrgaeste);
  if (teil.fahrerNamen.length) setze('fahrerNamen', teil.fahrerNamen);
  if (Number(teil.anonymeGaeste) > 0) setze('anonymeGaeste', teil.anonymeGaeste);
  // Nur ein Ort als Antwort ("Hotel Bayerischer Hof", "zum Flughafen"): gehoert in das fehlende Feld.
  if (!neu) {
    const wohin = /^(zum|zur|nach|ins|in die|in den)\b/i.test(prompt);
    const woher = /^(vom|von der|von|ab|aus)\b/i.test(prompt);
    const ort = prompt.replace(/^(zum|zur|nach|ins|in die|in den|vom|von der|von|ab|aus)\s+/i, '').replace(/[.!]+$/, '').trim();
    const fehlt = offen.missing || [];
    if (ort && ort.split(/\s+/).length <= 6 && !/^(ja|nein|ok|okay|passt|danke|abbrechen|stopp?)\b/i.test(ort)) {
      if (woher || (!wohin && fehlt.includes('start') && !fehlt.includes('ziel'))) setze('start', ortVereinheitlichen(ort, daten));
      else if (wohin || fehlt.includes('ziel')) setze('ziel', ortVereinheitlichen(ort, daten));
    }
  }
  if (!neu) return null;
  const missingFields = ['start', 'ziel', 'startZeit'].filter((feld) => !p[feld]);
  return { payload: p, missingFields, needsClarification: missingFields.length > 0 };
};

// Was die Frage zur Buchung offen laesst, als eine Frage in Worten.
const buchungsRueckfrage = (payload, fehlend) => {
  const bekannt = [
    payload.datum ? tagWort(payload.datum) : '',
    payload.startZeit ? `um ${payload.startZeit}` : '',
    payload.start ? `ab ${payload.start}` : '',
    payload.ziel ? `nach ${payload.ziel}` : '',
  ].filter(Boolean).join(' ');
  const fragen = [];
  if (fehlend.includes('start')) fragen.push('Wo soll der Gast abgeholt werden?');
  if (fehlend.includes('ziel')) fragen.push('Wohin soll die Fahrt gehen (Ziel)?');
  if (fehlend.includes('startZeit')) fragen.push('Um wie viel Uhr?');
  return `${bekannt ? `Fahrt ${bekannt}: ` : ''}${fragen.join(' ')}`;
};

// Kurze Zusammenfassung der Buchung plus Warnung, wenn der Fahrer dann schon eine Fahrt hat.
const buchungsText = (payload, daten) => {
  const teile = [`${datumMitTag(payload.datum)} um ${payload.startZeit}`, `${payload.start} → ${payload.ziel}`];
  if (payload.fahrgaeste) teile.push(`Gast ${payload.fahrgaeste}`);
  if (payload.flugnummer) teile.push(`Flug ${payload.flugnummer}`);
  if (Number(payload.anonymeGaeste) > 0) teile.push(`${payload.anonymeGaeste} ${Number(payload.anonymeGaeste) === 1 ? 'Gast' : 'Gäste'} ohne Namen`);
  teile.push(payload.fahrerNamen?.length ? `Fahrer ${payload.fahrerNamen.join(', ')}` : 'noch ohne Fahrer');
  const warnungen = [];
  (payload.fahrerNamen || []).forEach((name) => {
    const profil = (daten?.fahrer_profiles || []).find((p) => getDriverDisplayName(p) === name);
    if (!profil || !payload.startZeit) return;
    const probe = { id: 'neu', ride_date: payload.datum, etd: `${payload.startZeit}:00`, status: 'pending', pickup_name: payload.start, dropoff_name: payload.ziel };
    const pruefung = passtInTag(profil.id, probe, daten);
    if (!pruefung.ok) warnungen.push(`Achtung, das passt bei ${name} nicht: ${pruefung.gruende.find((g) => /spät/.test(g)) || 'zu der Zeit ist schon eine Fahrt eingetragen'}.`);
  });
  return `Vorschlag: ${teile.join(', ')}.${warnungen.length ? `\n${warnungen.join('\n')}` : ''}\nSoll ich die Fahrt so buchen?`;
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

// Fahrten als fertige Zeilen mit Namen. Das Modell soll weder IDs verknuepfen noch selbst zaehlen.
const fahrtenFuerModell = (snapshot, prompt) => {
  const daten = snapshot?.data || {};
  const heute = jetztBerlin().toISOString().slice(0, 10);
  const hinweis = extractDateHint(prompt);
  const tag = hinweis?.type === 'date' ? hinweis.value : null;
  const genannt = genannteFahrer(snapshot, prompt);
  const genanntIds = new Set(genannt.map((profil) => profil.id));
  const namen = new Map((daten.profiles || []).map((profil) => [profil.id, getDriverDisplayName(profil)]));
  const konvoi = new Map();
  (daten.convoy_assignments || []).forEach((zeile) => {
    if (!konvoi.has(zeile.job_id)) konvoi.set(zeile.job_id, []);
    konvoi.get(zeile.job_id).push(zeile.driver_id);
  });
  const fahrerVon = (job) => Array.from(new Set([job?.driver_id, ...(konvoi.get(job?.id) || [])].filter(Boolean)));
  const nurOhneFahrer = FRAGE_OHNE_FAHRER_RE.test(normalizeText(prompt));
  const passt = (job) => (tag ? job?.ride_date === tag : String(job?.ride_date || '') >= heute)
    && (!nurOhneFahrer || fahrerVon(job).length === 0)
    && (genanntIds.size === 0 || fahrerVon(job).some((id) => genanntIds.has(id)));
  const alleTreffer = (daten.jobs || []).filter(passt)
    .sort((a, b) => `${a.ride_date} ${a.etd}`.localeCompare(`${b.ride_date} ${b.etd}`));
  // Steht eine Uhrzeit in der Frage und passt eine Fahrt dazu, geht es um diese.
  const uhrzeit = uhrzeitenIn(prompt)[0];
  const zurUhrzeit = uhrzeit ? alleTreffer.filter((job) => String(job.etd || '').slice(0, 5) === uhrzeit) : [];
  const sortiert = zurUhrzeit.length ? zurUhrzeit : alleTreffer;
  const gaeste = (job) => {
    const roh = Array.isArray(job?.passengers) ? job.passengers.join(', ') : String(job?.passengers || '');
    return roh.trim() || 'keine Namen';
  };
  const zeile = (job) => [
    `${job.ride_date} ${String(job.etd || '').slice(0, 5)}`,
    `Fahrer: ${fahrerVon(job).map((id) => namen.get(id) || 'unbekannt').join(', ') || 'keiner'}`,
    `Von: ${job.pickup_name || job.pickup_address || '-'}`,
    `Nach: ${job.dropoff_name || job.dropoff_address || '-'}`,
    `Status: ${job.status || '-'}`,
    `Gaeste: ${gaeste(job)}`,
  ].join(' | ');
  const nachId = new Map((daten.jobs || []).map((job) => [job.id, job]));
  const imGespraech = conversationContext.fahrten.slice(0, 8).map((id) => nachId.get(id)).filter(Boolean);
  // Eine Fahrt: die ist ab jetzt gemeint. Mehrere: bei "die Fahrt" muss nachgefragt werden.
  // Rueckfragen wie "dieser Fahrt" suchen nichts Neues und duerfen den Bezug nicht verschieben.
  const suchtFahrten = Boolean(tag || genannt.length || uhrzeit || /\b(welche|alle|liste)\b.*\bfahrten\b/.test(normalizeText(prompt)));
  if (!suchtFahrten) {
    // Bezug bleibt wie er ist.
  } else if (sortiert.length === 1) {
    updateConversationRideContext(sortiert[0]);
  } else if (sortiert.length > 1) {
    fahrtenMerken(sortiert.slice(0, 10).map((job) => job.id));
    conversationContext.letzteListe = sortiert.slice(0, 10).map((job) => job.id);
    conversationContext.fokusMehrdeutig = true;
  }
  if (genannt.length === 1) updateConversationDriverContext(genannt[0]);
  return {
    genannt: genannt.length > 0,
    im_gespraech_genannt: imGespraech.map(zeile),
    zeitraum: tag ? `nur ${tag}` : `ab ${heute}`,
    fahrer_filter: genannt.map(getDriverDisplayName),
    anzahl: sortiert.length,
    fahrten: sortiert.slice(0, 40).map(zeile),
  };
};

// Namen der Gaeste einer Fahrt: verknuepfte Gaeste und Freitext aus passengers.
const gaesteDerFahrt = (job, daten) => {
  const verzeichnis = new Map((daten?.guests || []).map((gast) => [gast.id, gast]));
  const verknuepft = (daten?.job_guests || [])
    .filter((zeile) => zeile.job_id === job.id)
    .map((zeile) => verzeichnis.get(zeile.guest_id))
    .filter(Boolean)
    .map((gast) => [gast.first_name, gast.last_name].filter(Boolean).join(' ').trim());
  const roh = Array.isArray(job?.passengers) ? job.passengers : Object.values(job?.passengers || {});
  return gaesteTeile([...verknuepft, ...roh.map((name) => String(name || ''))], job?.anonymous_guests).namen;
};

// Kolonnen-Zuordnungen je Fahrt einmal pro Datenstand aufbauen (sonst je Fahrt die ganze Liste durchsuchen).
const kolonneJeFahrt = new WeakMap();
const fahrerDerFahrt = (job, daten) => {
  const liste = daten?.convoy_assignments || [];
  let index = kolonneJeFahrt.get(liste);
  if (!index) {
    index = new Map();
    liste.forEach((zeile) => {
      if (!index.has(zeile.job_id)) index.set(zeile.job_id, []);
      index.get(zeile.job_id).push(zeile.driver_id);
    });
    kolonneJeFahrt.set(liste, index);
  }
  return Array.from(new Set([job?.driver_id, ...(index.get(job?.id) || [])].filter(Boolean)));
};

const uhrzeitAus = (stunde, minute) => {
  const h = Number(stunde);
  const m = Number(minute || 0);
  if (!Number.isInteger(h) || !Number.isInteger(m) || h > 23 || m > 59) return '';
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};

const uhrzeitenIn = (text) => Array.from(
  String(text).matchAll(/(?<![\d.:])(\d{1,2})(?:[:.](\d{2}))?\s*uhr\b|(?<![\d.:])(\d{1,2}):(\d{2})\b/gi),
).map((treffer) => uhrzeitAus(treffer[1] ?? treffer[3], treffer[2] ?? treffer[4])).filter(Boolean);

// Liest aus dem Satz, was sich aendern soll und woran die Fahrt zu erkennen ist. Nur Werte, die wirklich dastehen.
const aenderungLesen = (prompt, snapshot) => {
  const roh = String(prompt || '').trim();
  const text = normalizeText(roh);
  const fahrerAlle = snapshot?.data?.fahrer_profiles || [];
  const aenderung = {};
  const merkmale = {};

  // Datum: "auf morgen" ist neu, jedes andere Datum beschreibt die Fahrt.
  const aufDatum = roh.match(/\bauf\s+(morgen|heute|\d{1,2}\.\d{1,2}(?:\.\d{2,4})?)/i);
  if (aufDatum) {
    const wert = extractDateHint(aufDatum[1]);
    if (wert?.type === 'date') aenderung.datum = wert.value;
  }
  const merkmalDatum = extractDateHint(aufDatum ? roh.replace(aufDatum[0], ' ') : roh);
  if (merkmalDatum?.type === 'date') merkmale.datum = merkmalDatum.value;

  // Uhrzeit: "auf 11 Uhr" ist neu, "die Fahrt um 14:30" beschreibt die Fahrt.
  const aufZeit = roh.match(/\bauf\s+(\d{1,2})(?::(\d{2}))?(\s*uhr\b)?(?![\d.])/i);
  const zeitWort = /(abfahrt|uhrzeit|verschieb|start ?zeit|\bzeit\b)/.test(text);
  let zeiten = uhrzeitenIn(roh);
  if (aufZeit && (aufZeit[2] || aufZeit[3] || zeitWort)) {
    aenderung.startZeit = uhrzeitAus(aufZeit[1], aufZeit[2]);
    zeiten = uhrzeitenIn(roh.replace(aufZeit[0], ' '));
    if (zeiten[0]) merkmale.startZeit = zeiten[0];
  } else if ((zeitWort || KORREKTUR_RE.test(text)) && zeiten.length === 1) {
    aenderung.startZeit = zeiten[0];
  } else if (zeiten[0]) {
    merkmale.startZeit = zeiten[0];
  }

  // Fahrer: "Fahrt von Tim" beschreibt die Fahrt, die uebrigen genannten aendern sich.
  const fahrerZuWort = (wort) => wort && fahrerAlle.find((profil) => [profil.first_name, profil.last_name]
    .some((name) => normalizeText(name) === normalizeText(wort)));
  const vonFahrer = fahrerZuWort(text.match(/\bfahrt\s+von\s+([a-z0-9-]+)/)?.[1] || '');
  if (vonFahrer) merkmale.fahrerId = vonFahrer.id;
  const stattFahrer = fahrerZuWort(text.match(/\bstatt\s+([a-z0-9-]+)/)?.[1] || '');
  const genannt = genannteFahrer(snapshot, roh).filter((profil) => profil.id !== vonFahrer?.id);
  const entfernen = /\b(entferne|entfernen|ohne|raus|streiche|nimm)\b/.test(text);
  const zielFahrer = genannt.filter((profil) => profil.id !== stattFahrer?.id);
  const uebergeben = /\bgib\b|\bsoll\b.*\bfahren\b|\bubernimmt\b|\bubernehmen\b|\b(schick|schicke|plan|plane|teil|teile)\b/.test(text);
  if (genannt.length && (entfernen || stattFahrer || uebergeben || /(fahrer|hinzu|trag|setz)/.test(text))) {
    aenderung.fahrer = {
      entfernen: entfernen ? genannt.map(getDriverDisplayName) : (stattFahrer ? [getDriverDisplayName(stattFahrer)] : []),
      dazu: entfernen ? [] : zielFahrer.map(getDriverDisplayName),
      ersetzen: !entfernen && !stattFahrer && (uebergeben || /\bsetz/.test(text)) && !/\bhinzu\b/.test(text),
    };
  }

  // Gast
  const gast = (roh.match(/\b[Gg]ast\s+(?:ist\s+|heisst\s+|heißt\s+)?((?:[A-ZÄÖÜ][\p{L}-]+\s*){1,3})/u)?.[1]
    || roh.match(/\b(?:[Ff]ür|[Ff]uer)\s+((?:Herrn?\s+|Frau\s+)?[A-ZÄÖÜ][\p{L}-]+(?:\s+[A-ZÄÖÜ][\p{L}-]+)?)/u)?.[1])?.trim();
  if (gast) {
    aenderung.gast = {
      name: gast,
      entfernen,
      ersetzen: !entfernen && !/\bhinzu\b/.test(text),
    };
  }

  // Start und Ziel
  const ortAus = (woerter) => roh.match(new RegExp(
    `\\b(?:${woerter})\\b\\s*(?:der fahrt\\s*)?(?:ist|auf|zu|soll|:|=)\\s*(?:jetzt\\s+)?(.+?)(?=\\s+und\\s+|[.!?]|\\s+(?:ändern|aendern|setzen|sein)\\s*[.!?]*$|$)`,
    'i',
  ))?.[1]?.trim() || '';
  const start = ortAus('start|abholort|abholung');
  const ziel = ortAus('ziel|zieladresse');
  if (start) aenderung.start = ortVereinheitlichen(start, snapshot?.data);
  if (ziel) aenderung.ziel = ortVereinheitlichen(ziel, snapshot?.data);

  return { aenderung, merkmale, woerter: text.split(/[^a-z0-9]+/).filter((wort) => wort.length >= 4), gastName: gast || '' };
};

const fahrtKurz = (job, daten, namen) => {
  const fahrer = fahrerDerFahrt(job, daten).map((id) => namen.get(id)).filter(Boolean).join(', ') || 'kein Fahrer';
  return `- ${job.ride_date.slice(8, 10)}.${job.ride_date.slice(5, 7)}. ${String(job.etd || '').slice(0, 5)}, ${job.pickup_name || job.pickup_address || '-'} nach ${job.dropoff_name || job.dropoff_address || '-'}, ${fahrer}`;
};

const ORDNUNGSZAHLEN = {
  erste: 0, ersten: 0, zweite: 1, zweiten: 1, dritte: 2, dritten: 2, vierte: 3, vierten: 3, funfte: 4, funften: 4,
  sechste: 5, sechsten: 5, siebte: 6, siebten: 6, achte: 7, achten: 7, neunte: 8, neunten: 8, zehnte: 9, zehnten: 9,
};

// "die zweite", "die letzte", "die um 14:30", "die von Tim": genau eine Fahrt aus einer Liste, sonst null.
const fahrtAuswaehlen = (prompt, jobs, daten) => {
  const text = normalizeText(prompt);
  const woerter = text.split(/[^a-z0-9]+/).filter(Boolean);
  const ordnung = woerter.find((wort) => wort in ORDNUNGSZAHLEN);
  if (ordnung) return jobs[ORDNUNGSZAHLEN[ordnung]] || null;
  if (woerter.includes('letzte') || woerter.includes('letzten')) return jobs[jobs.length - 1] || null;
  const namen = new Map((daten.profiles || []).map((profil) => [profil.id, getDriverDisplayName(profil)]));
  const zeit = uhrzeitenIn(prompt)[0] || (text.match(/\bum (\d{1,2})\b/) ? uhrzeitAus(text.match(/\bum (\d{1,2})\b/)[1], 0) : '');
  const inhalt = woerter.filter((wort) => wort.length >= 3 && !['die', 'der', 'das', 'von', 'fahrt', 'mit', 'bitte', 'nach', 'uhr', 'zum', 'zur'].includes(wort));
  const treffer = jobs.filter((job) => {
    if (zeit && String(job.etd || '').slice(0, 5) !== zeit) return false;
    if (inhalt.length === 0 || zeit) return Boolean(zeit);
    const teile = normalizeText([
      ...gaesteDerFahrt(job, daten),
      ...fahrerDerFahrt(job, daten).map((id) => namen.get(id)),
      job.pickup_name, job.dropoff_name,
    ].filter(Boolean).join(' ')).split(/[^a-z0-9]+/);
    return inhalt.some((wort) => teile.includes(wort));
  });
  return treffer.length === 1 ? treffer[0] : null;
};

// Rueckfrage stellen und merken, worum es ging. Die naechste Antwort wird dann darauf bezogen.
const rueckfrageStellen = (prompt, jobs, answer, meta) => {
  conversationContext.rueckfrage = { prompt, ids: jobs.slice(0, 40).map((job) => job.id), zeit: Date.now() };
  return { answer, meta };
};

const aenderungVorschlagen = ({ prompt, snapshot, offenerVorschlag, letzteFahrtId, fixeFahrtId = null }) => {
  const daten = snapshot?.data || {};
  const namen = new Map((daten.profiles || []).map((profil) => [profil.id, getDriverDisplayName(profil)]));
  const { aenderung, merkmale, woerter, gastName } = aenderungLesen(prompt, snapshot);
  if (Object.keys(aenderung).length === 0) {
    return {
      answer: 'Was genau soll sich ändern? Zum Beispiel: „Setze Tim als Fahrer“, „Verschiebe auf 11 Uhr“ oder „Ziel auf MUC Terminal 2“.',
      meta: snapshot?.meta,
    };
  }

  const heute = jetztBerlin().toISOString().slice(0, 10);
  const gastWoerter = new Set(normalizeText(gastName).split(' '));
  const offen = (job) => !['done', 'cancelled'].includes(String(job?.status || '')) && String(job?.ride_date || '') >= heute;
  const passtGast = (job) => {
    const teile = gaesteDerFahrt(job, daten).flatMap((name) => normalizeText(name).split(' '));
    return woerter.some((wort) => !gastWoerter.has(wort) && teile.includes(wort));
  };
  const kommend = (daten.jobs || []).filter(offen);
  const mitGast = kommend.filter(passtGast);
  const hatMerkmal = Boolean(merkmale.datum || merkmale.startZeit || merkmale.fahrerId || mitGast.length);

  const nachId = new Map((daten.jobs || []).map((zeile) => [zeile.id, zeile]));
  const zuletztGezeigt = conversationContext.letzteListe.map((id) => nachId.get(id)).filter(Boolean);
  const verweistAufListe = Object.keys(ORDNUNGSZAHLEN).concat('letzte', 'letzten')
    .some((wort) => normalizeText(prompt).split(/[^a-z0-9]+/).includes(wort));

  // Ist gerade eine neue Buchung offen, gelten Angaben ohne ausdruecklichen Fahrt-Bezug fuer sie.
  const neueBuchungOffen = Boolean(offenerVorschlag && !offenerVorschlag.fahrtId)
    && !/\bfahrt\s+(von|um|mit|am)\b/.test(normalizeText(prompt)) && !verweistAufListe;
  // Korrektur des gerade gezeigten Vorschlags ("doch lieber 11:30"): nicht nach einer anderen Fahrt suchen.
  const korrigiert = Boolean(offenerVorschlag) && KORREKTUR_RE.test(normalizeText(prompt)) && !merkmale.fahrerId && !mitGast.length;

  let job = null;
  if (fixeFahrtId) {
    job = nachId.get(fixeFahrtId) || null;
  } else if (neueBuchungOffen || korrigiert) {
    job = null;
  } else if (verweistAufListe && zuletztGezeigt.length) {
    job = fahrtAuswaehlen(prompt, zuletztGezeigt, daten);
    if (!job) return { answer: 'So viele Fahrten waren in der Liste nicht. Nenne Uhrzeit oder Gast.', meta: snapshot?.meta };
  } else if (hatMerkmal) {
    const treffer = (mitGast.length ? mitGast : kommend).filter((zeile) => (
      (!merkmale.datum || zeile.ride_date === merkmale.datum)
      && (!merkmale.startZeit || String(zeile.etd || '').slice(0, 5) === merkmale.startZeit)
      && (!merkmale.fahrerId || fahrerDerFahrt(zeile, daten).includes(merkmale.fahrerId))
    )).sort((a, b) => `${a.ride_date} ${a.etd}`.localeCompare(`${b.ride_date} ${b.etd}`));
    if (treffer.length === 0) return { answer: 'Ich finde keine anstehende Fahrt, die dazu passt.', meta: snapshot?.meta };
    // Unter mehreren Treffern gewinnt die, ueber die gerade gesprochen wurde.
    const besprochen = treffer.filter((zeile) => conversationContext.fahrten.slice(0, 10).includes(zeile.id));
    if (treffer.length > 1 && besprochen.length !== 1) {
      conversationContext.letzteListe = treffer.slice(0, 10).map((zeile) => zeile.id);
      return rueckfrageStellen(
        prompt,
        treffer,
        `Dazu passen ${treffer.length} Fahrten. Welche meinst du?\n${treffer.slice(0, 5).map((zeile) => fahrtKurz(zeile, daten, namen)).join('\n')}`,
        snapshot?.meta,
      );
    }
    job = treffer.length === 1 ? treffer[0] : besprochen[0];
  } else if (!offenerVorschlag) {
    if (conversationContext.fokusMehrdeutig && zuletztGezeigt.length > 1) {
      return rueckfrageStellen(
        prompt,
        zuletztGezeigt,
        `Welche dieser Fahrten meinst du?\n${zuletztGezeigt.slice(0, 5).map((zeile) => fahrtKurz(zeile, daten, namen)).join('\n')}`,
        snapshot?.meta,
      );
    }
    const bekannteId = String(conversationContext.lastRideId || letzteFahrtId || conversationContext.fahrten[0] || '').trim();
    job = nachId.get(bekannteId) || null;
    if (!job) {
      return rueckfrageStellen(
        prompt,
        kommend.sort((a, b) => `${a.ride_date} ${a.etd}`.localeCompare(`${b.ride_date} ${b.etd}`)),
        'Welche Fahrt meinst du? Nenne Uhrzeit, Gast oder Fahrer.',
        snapshot?.meta,
      );
    }
  }

  const basis = job
    ? {
      fahrtId: job.id,
      geaendert: [],
      datum: job.ride_date,
      startZeit: String(job.etd || '').slice(0, 5),
      start: job.pickup_name || job.pickup_address || '',
      ziel: job.dropoff_name || job.dropoff_address || '',
      fahrgaeste: gaesteDerFahrt(job, daten).join(', '),
      anonymeGaeste: String(job.anonymous_guests ?? 0),
      fahrerNamen: fahrerDerFahrt(job, daten).map((id) => namen.get(id)).filter(Boolean),
      konvoi: '',
      flugnummer: '',
      notes: '',
    }
    : { ...offenerVorschlag, geaendert: offenerVorschlag.geaendert || [] };

  const neu = { ...basis, fahrerNamen: [...(basis.fahrerNamen || [])], geaendert: [...basis.geaendert] };
  const setzen = (feld, wert) => {
    if (JSON.stringify(neu[feld]) === JSON.stringify(wert)) return;
    neu[feld] = wert;
    if (!neu.geaendert.includes(feld)) neu.geaendert.push(feld);
  };
  ['datum', 'startZeit', 'start', 'ziel'].forEach((feld) => {
    if (aenderung[feld]) setzen(feld, aenderung[feld]);
  });
  if (aenderung.fahrer) {
    const weg = new Set(aenderung.fahrer.entfernen);
    const bleibt = aenderung.fahrer.ersetzen ? [] : neu.fahrerNamen.filter((name) => !weg.has(name));
    setzen('fahrerNamen', Array.from(new Set([...bleibt, ...aenderung.fahrer.dazu])));
  }
  if (aenderung.gast) {
    const bisher = String(neu.fahrgaeste || '').split(/[,;]/).map((name) => name.trim()).filter(Boolean);
    const { name, entfernen, ersetzen } = aenderung.gast;
    let liste = [...bisher, name];
    if (entfernen) liste = bisher.filter((eintrag) => normalizeText(eintrag) !== normalizeText(name));
    else if (ersetzen) liste = [name];
    setzen('fahrgaeste', Array.from(new Set(liste)).join(', '));
  }

  if (neu.geaendert.length === basis.geaendert.length && JSON.stringify(neu) === JSON.stringify({ ...basis, fahrerNamen: basis.fahrerNamen || [] })) {
    return { answer: 'Das ist bei dieser Fahrt schon so eingetragen.', meta: snapshot?.meta };
  }
  if (job) updateConversationRideContext(job);
  // Was sich aendert, alt -> neu, damit die Dispo vor dem Speichern sieht, ob die richtige Fahrt gemeint ist.
  const FELDNAMEN = { datum: 'Datum', startZeit: 'Abfahrt', start: 'Start', ziel: 'Ziel', fahrgaeste: 'Gäste', fahrerNamen: 'Fahrer' };
  const wert = (feld, v) => {
    if (feld === 'fahrerNamen') return (v || []).join(', ') || 'keiner';
    if (feld === 'datum') return v ? datumMitTag(v) : '-';
    return String(v || '') || '-';
  };
  const unterschiede = neu.geaendert.filter((feld) => FELDNAMEN[feld] && !basis.geaendert.includes(feld))
    .map((feld) => `${FELDNAMEN[feld]}: ${wert(feld, basis[feld])} → ${wert(feld, neu[feld])}`);
  const welche = job ? `${datumMitTag(job.ride_date)} ${String(job.etd || '').slice(0, 5)} ${startName(job)} → ${zielName(job)}` : '';
  // Passt die geaenderte Fahrt noch zu den anderen Fahrten der Fahrer?
  if (neu.startZeit && neu.datum && (neu.geaendert.some((f) => ['datum', 'startZeit', 'fahrerNamen', 'start', 'ziel'].includes(f)))) {
    const probe = {
      ...(job || {}), id: job?.id || 'neu', ride_date: neu.datum, etd: `${neu.startZeit}:00`, pickup_name: neu.start, dropoff_name: neu.ziel,
      ...(job && neu.start !== basis.start ? { route_von: null, pickup_ort_id: null, ext_route_duration_mins: null, ext_route_duration_in_traffic_mins: null } : {}),
      ...(job && neu.ziel !== basis.ziel ? { route_nach: null, dropoff_ort_id: null, ext_route_duration_mins: null, ext_route_duration_in_traffic_mins: null } : {}),
    };
    (neu.fahrerNamen || []).forEach((name) => {
      const profil = (daten.fahrer_profiles || []).find((p) => getDriverDisplayName(p) === name);
      if (!profil) return;
      const pruefung = passtInTag(profil.id, probe, daten);
      if (!pruefung.ok) unterschiede.push(`Achtung, das passt bei ${name} nicht: ${pruefung.gruende.find((g) => /spät/.test(g)) || 'Überschneidung'}`);
    });
  }
  return {
    answer: neu.fahrtId
      ? `Änderung an der Fahrt ${welche}:\n${unterschiede.map((z) => `- ${z}`).join('\n')}\nSoll ich die Fahrt so speichern?`
      : `Vorschlag angepasst${unterschiede.length ? ` (${unterschiede.join(', ')})` : ''}. Soll ich die Fahrt so buchen?`,
    action: { type: 'booking_proposal', proposal: neu },
    meta: snapshot?.meta,
  };
};

// ---------------------------------------------------------------------------------------------
// Feste Antworten ohne Modell: Standort, Tagesplan eines Fahrers, Konflikt, Fahrervorschlag,
// Dienst und freie Fahrer. Alles wird hier gerechnet, das Modell erfindet sonst Zeiten und Fahrer.
// ---------------------------------------------------------------------------------------------

const ABGESAGT = new Set(['cancelled', 'canceled', 'refused', 'storniert', 'stoniert']);
const BEENDET = new Set(['done', 'completed', 'arrived', 'beendet']);
const BEIM_GAST = new Set(['at_pickup', 'pickup', 'beim_pickup', 'beim pickup']);
const UNTERWEGS = new Set(['in_progress', 'unterwegs', 'started', 'on_trip', 'ongoing', 'active']);
// Nach der Ankunft: Gast aussteigen lassen, Gepaeck. Danach ist der Fahrer frei.
const AUSSTEIGEN_MIN = 10;
const FRAGEWORT_RE = /^(wo|wer|was|wie|wann|welche[rsmn]?|wieso|warum|hat|ist|sind|gibt|schafft|schaffen|kann|konnte|reicht|passt|klappt)\b/;

const statusText = (status) => {
  const s = String(status || '').toLowerCase();
  if (ABGESAGT.has(s)) return 'storniert';
  if (BEENDET.has(s)) return 'beendet';
  if (BEIM_GAST.has(s)) return 'beim Gast';
  if (UNTERWEGS.has(s)) return 'unterwegs zum Ziel';
  if (s === 'pending' || s === 'offen' || s === 'new' || s === 'requested') return 'offen';
  return 'noch nicht gestartet';
};

const minutenAus = (hhmm) => {
  const m = String(hhmm || '').match(/^(\d{1,2}):(\d{2})/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};
const uhrAusMinuten = (min) => {
  const t = ((Math.round(min) % 1440) + 1440) % 1440;
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
};
const dauerText = (min) => {
  const m = Math.max(0, Math.round(min));
  if (m < 60) return `${m} min`;
  return m % 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${Math.floor(m / 60)} h`;
};
const datumKurz = (iso) => `${String(iso).slice(8, 10)}.${String(iso).slice(5, 7)}.`;
const WOCHENTAGE = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
// "morgen (Do 12.11.)", "Fr 13.11."
const datumMitTag = (iso) => {
  const wt = WOCHENTAGE[new Date(`${iso}T12:00:00Z`).getUTCDay()] || '';
  const kurz = `${wt} ${datumKurz(iso)}`.trim();
  if (iso === tagPlus(0)) return `heute, ${kurz}`;
  if (iso === tagPlus(1)) return `morgen, ${kurz}`;
  return kurz;
};
const tagWort = (iso) => {
  if (iso === tagPlus(0)) return 'heute';
  if (iso === tagPlus(1)) return 'morgen';
  if (iso === tagPlus(-1)) return 'gestern';
  return `am ${datumKurz(iso)}`;
};
const jetztMinuten = () => {
  const j = jetztBerlin();
  return j.getUTCHours() * 60 + j.getUTCMinutes();
};

// Luftlinie in km.
const luftlinieKm = (a, b) => {
  if (!a || !b) return null;
  const r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r;
  const dLng = (b.lng - a.lng) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
};
// Fahrzeit aus der Luftlinie geschaetzt: Umweg-Faktor 1,35, in der Stadt langsam, ueber Land schneller.
const fahrzeitSchaetzen = (km) => {
  if (km == null) return null;
  const strasse = km * 1.35;
  const tempo = strasse < 4 ? 18 : strasse < 20 ? 28 : 50;
  return Math.ceil((strasse / tempo) * 60 + 3);
};

// Woerter eines Ortsnamens, grob auf den Stamm gebracht ("bayerischen" = "bayerischer").
const ORT_FUELLWOERTER = new Set(['der', 'die', 'das', 'dem', 'den', 'zum', 'zur', 'vom', 'von', 'im', 'in', 'am', 'an', 'beim', 'bei']);
const ortStamm = (name) => normalizeText(name).replace(/\bt\s?([1-9])\b/g, 'terminal $1').split(/[^a-z0-9]+/)
  .filter((wort) => wort && !ORT_FUELLWOERTER.has(wort))
  .map((wort) => (wort.length > 4 ? wort.replace(/(en|er|es|em|e|n|s)$/, '') : wort));

const koordinate = (lat, lng) => {
  const a = Number(lat);
  const b = Number(lng);
  return Number.isFinite(a) && Number.isFinite(b) && (a !== 0 || b !== 0) ? { lat: a, lng: b } : null;
};

// Bekannte Orte: eigene Orte und Abhol-/Zielorte der Fahrten (mit Koordinaten, wenn die Route sie hat).
const bekannteOrte = (daten) => {
  const orte = (daten?.orte || []).map((ort) => ({
    name: String(ort.name || '').trim(), adresse: String(ort.adresse || '').trim(), punkt: koordinate(ort.lat, ort.lng),
    radius: Number(ort.radius_raus_m) || 150, eigen: true, id: ort.id,
  })).filter((ort) => ort.name);
  const ausFahrten = [];
  (daten?.jobs || []).forEach((job) => {
    [[job.pickup_name, job.pickup_address, job.route_von], [job.dropoff_name, job.dropoff_address, job.route_nach]].forEach(([name, adresse, route]) => {
      const n = String(name || adresse || '').trim();
      if (!n) return;
      ausFahrten.push({ name: n, adresse: String(adresse || '').trim(), punkt: koordinate(route?.lat, route?.lon ?? route?.lng), radius: 150, eigen: false });
    });
  });
  return [...orte, ...ausFahrten];
};

// Getippten Ort auf einen bekannten Namen bringen ("Hotel bayerischen Hof" -> "Hotel Bayerischer Hof").
// Nur bei eindeutigem Treffer, sonst bleibt der Text wie getippt.
const ortVereinheitlichen = (text, daten) => {
  const roh = String(text || '').trim();
  const stamm = ortStamm(roh);
  if (!stamm.length) return roh;
  const namen = Array.from(new Set(bekannteOrte(daten).map((ort) => ort.name)));
  const gleich = namen.filter((name) => {
    const s = ortStamm(name);
    return s.length === stamm.length && s.every((wort) => stamm.includes(wort));
  });
  if (gleich.length === 1) return gleich[0];
  if (gleich.length > 1) return roh;
  // Bekannter Name mit mehr Woertern ("Messe" -> "Messe München", "Flughafen T1" -> "Flughafen München Terminal 1"):
  // ein Wort mehr, oder bei mindestens zwei getippten Woertern beliebig viele, jeweils nur bei genau einem Treffer.
  const mehr = namen.filter((name) => {
    const s = ortStamm(name);
    return s.length > stamm.length && (s.length === stamm.length + 1 || stamm.length >= 2) && stamm.every((wort) => s.includes(wort));
  });
  return mehr.length === 1 ? mehr[0] : roh;
};

// Koordinate eines Abhol- oder Zielorts: Route, gewaehlter Ort, sonst eigener Ort mit gleichem Namen.
const ortPunkt = (job, seite, daten) => {
  const route = seite === 'start' ? job?.route_von : job?.route_nach;
  const ausRoute = koordinate(route?.lat, route?.lon ?? route?.lng);
  if (ausRoute) return ausRoute;
  const ortId = seite === 'start' ? job?.pickup_ort_id : job?.dropoff_ort_id;
  const orte = daten?.orte || [];
  const gewaehlt = ortId ? orte.find((ort) => ort.id === ortId) : null;
  if (gewaehlt) return koordinate(gewaehlt.lat, gewaehlt.lng);
  const name = seite === 'start' ? (job?.pickup_name || job?.pickup_address) : (job?.dropoff_name || job?.dropoff_address);
  const stamm = ortStamm(name);
  if (!stamm.length) return null;
  const passend = orte.filter((ort) => {
    const s = ortStamm(ort.name);
    return s.length && s.every((wort) => stamm.includes(wort)) && stamm.every((wort) => s.includes(wort));
  });
  return passend.length === 1 ? koordinate(passend[0].lat, passend[0].lng) : null;
};

const startName = (job) => job?.pickup_name || job?.pickup_address || 'unbekannter Start';
const zielName = (job) => job?.dropoff_name || job?.dropoff_address || 'unbekanntes Ziel';

// Dauer einer Fahrt in Minuten und woher die Zahl kommt.
const fahrtDauer = (job, daten) => {
  const verkehr = Number(job?.ext_route_duration_in_traffic_mins);
  if (Number.isFinite(verkehr) && verkehr > 0) return { min: verkehr, quelle: 'Route mit Verkehr' };
  const route = Number(job?.ext_route_duration_mins);
  if (Number.isFinite(route) && route > 0) return { min: route, quelle: 'Route' };
  const schaetzung = fahrzeitSchaetzen(luftlinieKm(ortPunkt(job, 'start', daten), ortPunkt(job, 'ziel', daten)));
  if (schaetzung) return { min: schaetzung, quelle: 'geschätzt aus der Entfernung' };
  return { min: 45, quelle: 'pauschal, keine Routendaten' };
};

// Anfahrt vom Ziel einer Fahrt zum Start der naechsten.
const anfahrtDauer = (vorher, nachher, daten) => {
  const a = ortPunkt(vorher, 'ziel', daten);
  const b = ortPunkt(nachher, 'start', daten);
  const km = luftlinieKm(a, b);
  if (km != null) return { min: fahrzeitSchaetzen(km), quelle: 'geschätzt', km };
  const von = ortStamm(vorher?.dropoff_name || vorher?.dropoff_address).join(' ');
  if (von && von === ortStamm(nachher?.pickup_name || nachher?.pickup_address).join(' ')) return { min: 5, quelle: 'gleicher Ort' };
  return { min: 30, quelle: 'pauschal, Ort ohne Koordinaten' };
};

const fahrtBeginn = (job) => minutenAus(job?.etd);
const fahrtEnde = (job, daten) => {
  const beginn = fahrtBeginn(job);
  return beginn == null ? null : beginn + fahrtDauer(job, daten).min + AUSSTEIGEN_MIN;
};

const aktiveFahrt = (job) => !ABGESAGT.has(String(job?.status || '').toLowerCase());
const fahrtenDesFahrers = (fahrerId, datum, daten) => (daten?.jobs || [])
  .filter((job) => job.ride_date === datum && aktiveFahrt(job) && fahrerDerFahrt(job, daten).includes(fahrerId))
  .sort((a, b) => String(a.etd || '').localeCompare(String(b.etd || '')));

// Dienst eines Fahrers an einem Tag: juengste offene oder angenommene Anfrage.
const dienstAm = (fahrerId, datum, daten) => {
  const zeile = (daten?.dienste || [])
    .filter((d) => d.driver_id === fahrerId && d.service_date === datum && ['pending', 'accepted'].includes(String(d.status)))
    .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))[0];
  if (!zeile) return null;
  return {
    start: zeile.service_start_time ? String(zeile.service_start_time).slice(0, 5) : null,
    ende: zeile.service_end_time ? String(zeile.service_end_time).slice(0, 5) : null,
    angenommen: String(zeile.status) === 'accepted',
  };
};
const dienstText = (d) => {
  if (!d) return 'kein Dienst eingetragen';
  const zeit = d.start && d.ende ? `${d.start}–${d.ende}` : d.start ? `ab ${d.start}` : `bis ${d.ende}`;
  return `Dienst ${zeit}${d.angenommen ? '' : ', noch nicht bestätigt'}`;
};

const gastText = (job, daten) => {
  const namen = gaesteDerFahrt(job, daten);
  const anonym = anonymeAnzahl(job?.anonymous_guests);
  const teile = [];
  if (namen.length) teile.push(namen.join(', '));
  if (anonym) teile.push(namen.length ? `+${anonym}` : `${anonym} ${anonym === 1 ? 'Gast' : 'Gäste'} ohne Namen`);
  return teile.join(' ');
};
const fahrtZeile = (job, daten, mitFahrer = false) => {
  const namen = new Map((daten?.profiles || []).map((p) => [p.id, getDriverDisplayName(p)]));
  const fahrer = fahrerDerFahrt(job, daten).map((id) => namen.get(id)).filter(Boolean).join(', ');
  const gast = gastText(job, daten);
  return `- ${String(job.etd || '').slice(0, 5)} ${startName(job)} → ${zielName(job)}`
    + `${gast ? `, ${gast}` : ''}${mitFahrer ? `, ${fahrer || 'noch kein Fahrer'}` : ''} (${statusText(job.status)})`;
};

// Passt die Fahrt in den Tag des Fahrers? Prueft die Fahrt davor, die danach und den Dienst.
const passtInTag = (fahrerId, job, daten) => {
  const beginn = fahrtBeginn(job);
  const ende = fahrtEnde(job, daten);
  const andere = fahrtenDesFahrers(fahrerId, job.ride_date, daten).filter((f) => f.id !== job.id);
  const vorher = andere.filter((f) => (fahrtBeginn(f) ?? 0) <= beginn).pop() || null;
  const nachher = andere.find((f) => (fahrtBeginn(f) ?? 0) > beginn) || null;
  const gruende = [];
  let ok = true;
  let puffer = null;
  if (vorher) {
    const frei = fahrtEnde(vorher, daten);
    const anfahrt = anfahrtDauer(vorher, job, daten);
    const da = frei + anfahrt.min;
    puffer = beginn - da;
    if (puffer < 0) {
      ok = false;
      gruende.push(`die ${String(vorher.etd).slice(0, 5)}-Fahrt davor endet erst gegen ${uhrAusMinuten(frei)}, mit Anfahrt am Start gegen ${uhrAusMinuten(da)}, also ${dauerText(-puffer)} zu spät`);
    } else {
      gruende.push(`nach der ${String(vorher.etd).slice(0, 5)}-Fahrt (frei gegen ${uhrAusMinuten(frei)}) bleiben ${dauerText(puffer)} Puffer`);
    }
  }
  if (nachher) {
    const anfahrt = anfahrtDauer(job, nachher, daten);
    const da = ende + anfahrt.min;
    const rest = (fahrtBeginn(nachher) ?? 0) - da;
    if (rest < 0) {
      ok = false;
      gruende.push(`danach wäre die ${String(nachher.etd).slice(0, 5)}-Fahrt nicht zu schaffen (${dauerText(-rest)} zu spät)`);
    } else if (rest < 30) {
      gruende.push(`bis zur ${String(nachher.etd).slice(0, 5)}-Fahrt bleiben nur ${dauerText(rest)}`);
    }
    puffer = puffer == null ? rest : Math.min(puffer, rest);
  }
  const dienst = dienstAm(fahrerId, job.ride_date, daten);
  let imDienst = false;
  if (dienst) {
    const ds = minutenAus(dienst.start);
    const de = minutenAus(dienst.ende);
    const nachtEnde = de != null && ds != null && de < ds;
    imDienst = (ds == null || beginn >= ds) && (de == null || nachtEnde || ende <= de);
    if (!imDienst) gruende.push(`liegt außerhalb des Dienstes (${dienstText(dienst).replace('Dienst ', '')})`);
  }
  return { ok, gruende, puffer, dienst, imDienst, anzahl: andere.length, vorher, nachher };
};

// Gedachte Fahrt ohne Ort, um zu pruefen, wer zu einer Uhrzeit frei ist.
const probeFahrt = (datum, zeit) => ({ id: 'probe', ride_date: datum, etd: `${zeit}:00`, status: 'pending', pickup_name: '', dropoff_name: '' });
const PROBE_MIN = 45;

// Wer ist zu einer Uhrzeit frei (ohne bestimmte Fahrt)?
const freiZurZeit = (datum, zeit, daten, nur = null) => {
  const probe = probeFahrt(datum, zeit);
  const fahrer = nur || daten?.fahrer_profiles || [];
  const ergebnis = fahrer.map((p) => ({ profil: p, ...passtInTag(p.id, probe, daten) }));
  const zeile = (k) => {
    const teile = [k.dienst ? (k.imDienst ? `im Dienst (${dienstText(k.dienst).replace('Dienst ', '')})` : dienstText(k.dienst)) : 'kein Dienst eingetragen'];
    if (k.vorher) teile.push(`davor ${String(k.vorher.etd).slice(0, 5)}-Fahrt, frei ab etwa ${uhrAusMinuten(fahrtEnde(k.vorher, daten))} in ${zielName(k.vorher)}`);
    if (k.nachher) teile.push(`danach ${String(k.nachher.etd).slice(0, 5)} ab ${startName(k.nachher)}`);
    if (!k.vorher && !k.nachher) teile.push(`${tagWort(datum)} keine Fahrt`);
    return `${getDriverDisplayName(k.profil)}: ${teile.join(', ')}`;
  };
  return { ergebnis, zeile };
};

// Fahrer aus Frage, Gespraech oder Markierung. "die drei", "die beiden", "alle" beziehen sich auf die letzte Liste.
const fahrerAusBezug = (prompt, daten, markierte = []) => {
  const text = normalizeText(prompt);
  const alleFahrer = daten?.fahrer_profiles || [];
  const genannt = genannteFahrer({ data: daten }, prompt);
  if (genannt.length) return genannt;
  if (/\b(alle|jeder|jede)\b/.test(text)) return null;
  const markiertIds = new Set((markierte || []).map((f) => String(f?.id || '').toLowerCase()));
  if (markiertIds.size) return alleFahrer.filter((p) => markiertIds.has(String(p.id).toLowerCase()));
  // Mehrzahl ("wo sind die drei", "die beiden") meint die zuletzt genannten Fahrer, Einzahl ("wo ist er") den letzten.
  const liste = (conversationContext.letzteFahrer || []).map((id) => alleFahrer.find((p) => p.id === id)).filter(Boolean);
  const mehrzahl = /\bwo (sind|stecken|befinden)\b|\b(beide|beiden|drei|vier|funf|sechs|diese|die anderen)\b/.test(text);
  if (mehrzahl) return liste;
  const einer = readConversationDriverContext(alleFahrer);
  if (einer && /\b(er|sie|ihn|ihm|der fahrer|die fahrerin|dieser)\b/.test(text)) return [einer];
  return [];
};
// Fahrer in der Reihenfolge, in der sie in der Frage stehen.
const reihenfolgeInFrage = (liste, prompt) => {
  const text = ` ${normalizeText(prompt)} `;
  const stelle = (p) => Math.min(...[p.first_name, p.last_name].map((n) => {
    const i = text.search(new RegExp(`[^a-z0-9]${normalizeText(n).replace(/[.*+?^${}()|[\]\\]/g, '')}s?[^a-z0-9]`));
    return i < 0 ? 9999 : i;
  }));
  return [...liste].sort((a, b) => stelle(a) - stelle(b));
};
const fahrerMerken = (liste) => {
  conversationContext.letzteFahrer = liste.map((p) => p.id).slice(0, 20);
  if (liste.length === 1) updateConversationDriverContext(liste[0]);
  conversationContext.updatedAt = Date.now();
};

const signalText = (capturedAt) => {
  const zeit = new Date(String(capturedAt || ''));
  if (Number.isNaN(zeit.getTime())) return { text: 'Zeit des Signals unbekannt', alt: true };
  const min = Math.floor((Date.now() - zeit.getTime()) / 60000);
  if (min < 1) return { text: 'Signal gerade eben', alt: false };
  if (min < 60) return { text: `Signal vor ${min} min`, alt: min > 15 };
  const uhr = new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit' }).format(zeit);
  const tag = zeit.toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' });
  return { text: `kein Signal seit ${tag === tagPlus(0) ? '' : `${datumKurz(tag)} `}${uhr}`, alt: true };
};

// Ort eines Punkts in Worten: am eigenen Ort, nahe einem bekannten Ort, sonst Koordinaten.
const ortBeschreiben = (punkt, daten) => {
  const kandidaten = bekannteOrte(daten).filter((ort) => ort.punkt)
    .map((ort) => ({ ...ort, km: luftlinieKm(punkt, ort.punkt) }))
    .sort((a, b) => a.km - b.km || Number(b.eigen) - Number(a.eigen));
  const naechster = kandidaten[0];
  if (naechster && naechster.km * 1000 <= Math.max(naechster.radius, 150)) {
    return `am ${naechster.name}${naechster.adresse && !naechster.name.includes(naechster.adresse) ? `, ${naechster.adresse}` : ''}`;
  }
  if (naechster && naechster.km <= 3) {
    const abstand = naechster.km < 1 ? `${Math.round(naechster.km * 10) * 100} m` : `${naechster.km.toFixed(1).replace('.', ',')} km`;
    return `etwa ${abstand} vom ${naechster.name}`;
  }
  return `bei ${punkt.lat.toFixed(4)}, ${punkt.lng.toFixed(4)} (kein bekannter Ort in der Nähe)`;
};

const standortZeile = (profil, daten) => {
  const name = getDriverDisplayName(profil);
  const heute = tagPlus(0);
  const live = (daten?.driver_live_locations || [])
    .filter((z) => z.driver_id === profil.id)
    .sort((a, b) => String(b.captured_at || '').localeCompare(String(a.captured_at || '')))[0];
  const teile = [];
  if (live && koordinate(live.lat, live.lng)) {
    const signal = signalText(live.captured_at);
    teile.push(`${name} ist ${signal.alt ? 'zuletzt gesehen ' : ''}${ortBeschreiben(koordinate(live.lat, live.lng), daten)} (${signal.text}).`);
  } else {
    teile.push(`${name}: kein Standort vorhanden (kein Signal von App oder Tracker).`);
  }
  const nachId = new Map((daten?.jobs || []).map((job) => [job.id, job]));
  const heutige = fahrtenDesFahrers(profil.id, heute, daten);
  const laufend = (live?.active_job_id && nachId.get(live.active_job_id))
    || heutige.find((job) => BEIM_GAST.has(String(job.status)) || UNTERWEGS.has(String(job.status)));
  if (laufend && aktiveFahrt(laufend) && !BEENDET.has(String(laufend.status))) {
    teile.push(`Aktuelle Fahrt: ${String(laufend.etd || '').slice(0, 5)} ${startName(laufend)} → ${zielName(laufend)} (${statusText(laufend.status)}).`);
  } else {
    const jetzt = jetztMinuten();
    const naechste = heutige.find((job) => (fahrtBeginn(job) ?? 0) >= jetzt && !BEENDET.has(String(job.status)));
    teile.push(naechste
      ? `Gerade keine Fahrt, nächste um ${String(naechste.etd).slice(0, 5)} ab ${startName(naechste)}.`
      : 'Gerade keine Fahrt, heute keine weitere.');
  }
  return teile.join(' ');
};

const STANDORT_RE = /\bwo\s+(ist|sind|steckt|stecken|befindet|befinden|fahrt|fahren|war|waren)\b|\bstandort|\bposition\b|\bwo gerade\b/;

const standortAntwort = (prompt, daten, markierte) => {
  const text = normalizeText(prompt);
  if (!STANDORT_RE.test(text)) return null;
  // Orte, Fahrten oder Gaeste ("Wo ist die Messe", "wo faehrt die 14 Uhr Fahrt hin") sind keine Standortfrage.
  if (/\bfahrt\b|\bhin\b|\bgast\b|\bgaste\b/.test(text) && !genannteFahrer({ data: daten }, prompt).length) return null;
  let fahrer = fahrerAusBezug(prompt, daten, markierte);
  if (fahrer === null) {
    const heute = tagPlus(0);
    fahrer = (daten?.fahrer_profiles || []).filter((p) => dienstAm(p.id, heute, daten)
      || (daten?.driver_live_locations || []).some((z) => z.driver_id === p.id)
      || fahrtenDesFahrers(p.id, heute, daten).length);
    if (!fahrer.length) return 'Heute ist kein Fahrer im Dienst und kein Standort vorhanden.';
  }
  if (!fahrer.length) {
    // "Wo ist die Messe?" ist keine Frage nach einem Fahrer. Nur bei "er", "die beiden" usw. nachfragen.
    if (/\b(er|ihn|beide|beiden|drei|vier|fahrer|fahrerin|fahrern)\b|\bwo sind\b/.test(text)) return 'Welchen Fahrer meinst du? Nenne den Namen oder markiere die Fahrer auf der Karte.';
    return null;
  }
  fahrerMerken(fahrer);
  const sortiert = [...fahrer].sort((a, b) => getDriverDisplayName(a).localeCompare(getDriverDisplayName(b), 'de'));
  return sortiert.map((p) => standortZeile(p, daten)).join('\n');
};

// "Was macht Anna morgen?", "Welche Fahrten hat Stefano heute?", "Wann fährt Tim?"
const TAGESPLAN_RE = /\b(was macht|was machen|was hat|was haben|welche fahrten|welche fahrt|fahrten hat|fahrten haben|fahrten von|wann fahrt|wann fahren|was steht|wie sieht|tagesplan|programm|plan von|termine)\b/;

// "diese Woche", "naechste Woche", "die naechsten Tage": Liste von Tagen, sonst null.
const zeitraumTage = (prompt) => {
  const text = normalizeText(prompt);
  const heute = jetztBerlin();
  const wt = (heute.getUTCDay() + 6) % 7; // 0 = Montag
  const reihe = (von, bis) => Array.from({ length: bis - von + 1 }, (_, i) => tagPlus(von + i));
  if (/\b(diese|dieser) woche\b|\bdie woche\b/.test(text)) return reihe(0, 6 - wt);
  if (/\b(nachste|nachsten|kommende|kommenden) woche\b/.test(text)) return reihe(7 - wt, 13 - wt);
  const tage = text.match(/\b(?:die |in den )?(?:nachsten|kommenden) (\d|zwei|drei|vier|funf|sechs|sieben)? ?tage\b/);
  if (tage) {
    const n = { zwei: 2, drei: 3, vier: 4, funf: 5, sechs: 6, sieben: 7 }[tage[1]] || Number(tage[1]) || 7;
    return reihe(0, Math.min(14, n) - 1);
  }
  return null;
};

const tagesplanAntwort = (prompt, daten) => {
  const text = normalizeText(prompt);
  const zeitFrage = /\b(hat|ist|haben|sind)\b.*\b(zeit|frei|luft)\b/.test(text);
  if (!TAGESPLAN_RE.test(text) && !zeitFrage) return null;
  const tage = zeitraumTage(prompt);
  if (tage) {
    const fahrerListe = reihenfolgeInFrage(genannteFahrer({ data: daten }, prompt), prompt);
    if (!fahrerListe.length) return null;
    fahrerMerken(fahrerListe);
    const gezeigt = [];
    const absaetze = fahrerListe.map((profil) => {
      const tageMitFahrt = tage.map((tag) => ({ tag, fahrten: fahrtenDesFahrers(profil.id, tag, daten) })).filter((t) => t.fahrten.length);
      gezeigt.push(...tageMitFahrt.flatMap((t) => t.fahrten));
      const summe = tageMitFahrt.reduce((n, t) => n + t.fahrten.length, 0);
      if (!summe) return `${getDriverDisplayName(profil)} hat von ${datumMitTag(tage[0])} bis ${datumMitTag(tage[tage.length - 1])} keine Fahrten.`;
      return [`${getDriverDisplayName(profil)} hat von ${datumMitTag(tage[0])} bis ${datumMitTag(tage[tage.length - 1])} ${summe === 1 ? '1 Fahrt' : `${summe} Fahrten`}:`,
        ...tageMitFahrt.flatMap((t) => t.fahrten.map((job) => fahrtZeile(job, daten).replace(/^- /, `- ${datumMitTag(t.tag)} `)))].join('\n');
    });
    if (gezeigt.length > 1) {
      fahrtenMerken(gezeigt.slice(0, 10).map((job) => job.id));
      conversationContext.letzteListe = gezeigt.slice(0, 10).map((job) => job.id);
      conversationContext.fokusMehrdeutig = true;
    } else if (gezeigt.length === 1) updateConversationRideContext(gezeigt[0]);
    return absaetze.join('\n\n');
  }
  if (/\b(auto|fahrzeug|wagen|kennzeichen|telefon|handy|nummer)\b/.test(text)) return null;
  const fahrer = reihenfolgeInFrage(genannteFahrer({ data: daten }, prompt), prompt);
  if (!fahrer.length) return null;
  const hinweis = extractDateHint(prompt);
  const ohneTag = hinweis?.type !== 'date';
  const datum = ohneTag ? tagPlus(0) : hinweis.value;
  const alleFahrten = [];
  const absaetze = fahrer.map((profil) => {
    const name = getDriverDisplayName(profil);
    let fahrten = fahrtenDesFahrers(profil.id, datum, daten);
    let tag = datum;
    if (!fahrten.length && ohneTag) {
      // Ohne Datum und heute nichts: die naechste kommende Fahrt.
      const kommend = (daten?.jobs || []).filter((job) => job.ride_date > datum && aktiveFahrt(job) && fahrerDerFahrt(job, daten).includes(profil.id))
        .sort((a, b) => `${a.ride_date} ${a.etd}`.localeCompare(`${b.ride_date} ${b.etd}`));
      if (kommend.length) {
        tag = kommend[0].ride_date;
        fahrten = kommend.filter((job) => job.ride_date === tag);
      }
    }
    const dienst = dienstAm(profil.id, tag, daten);
    alleFahrten.push(...fahrten);
    if (!fahrten.length) {
      return `${name} hat ${tagWort(datum)} keine Fahrten (${dienstText(dienst)})${zeitFrage ? ', ist also frei' : ''}.`;
    }
    const kopf = `${name} hat ${tagWort(tag)}${tag !== datum ? ' (heute keine)' : ''} ${fahrten.length === 1 ? '1 Fahrt' : `${fahrten.length} Fahrten`} (${dienstText(dienst)}):`;
    const zeilen = [kopf, ...fahrten.map((job) => fahrtZeile(job, daten))];
    if (zeitFrage) {
      // Freie Zeiten: vor der ersten Fahrt, Luecken ab 60 min und nach der letzten.
      const frei = [`vor ${String(fahrten[0].etd).slice(0, 5)}`];
      fahrten.slice(0, -1).forEach((job, i) => {
        const ab = fahrtEnde(job, daten);
        const bis = fahrtBeginn(fahrten[i + 1]) - anfahrtDauer(job, fahrten[i + 1], daten).min;
        if (bis - ab >= 60) frei.push(`${uhrAusMinuten(ab)}–${uhrAusMinuten(bis)}`);
      });
      frei.push(`ab etwa ${uhrAusMinuten(fahrtEnde(fahrten[fahrten.length - 1], daten))}`);
      zeilen.push(`Frei: ${frei.join(', ')}.`);
    }
    return zeilen.join('\n');
  });
  fahrerMerken(fahrer);
  if (alleFahrten.length === 1) {
    updateConversationRideContext(alleFahrten[0]);
  } else if (alleFahrten.length > 1) {
    fahrtenMerken(alleFahrten.slice(0, 10).map((job) => job.id));
    conversationContext.letzteListe = alleFahrten.slice(0, 10).map((job) => job.id);
    conversationContext.fokusMehrdeutig = true;
  }
  return absaetze.join('\n\n');
};

// Fahrten eines Tages zu einer Uhrzeit ("die 14 Uhr Fahrt", "um 18"), optional nur die eines Fahrers.
const zeitenAusFrage = (prompt) => {
  const zeiten = uhrzeitenIn(prompt);
  const text = normalizeText(prompt);
  for (const treffer of text.matchAll(/\b(?:um|gegen|ab)\s+(\d{1,2})\b(?![:.]\d)(?!\s*uhr)/g)) {
    const zeit = uhrzeitAus(treffer[1], 0);
    if (zeit && !zeiten.includes(zeit)) zeiten.push(zeit);
  }
  return zeiten;
};
const fahrtenZurZeit = (zeit, datum, daten, filter = () => true) => (daten?.jobs || [])
  .filter((job) => job.ride_date === datum && aktiveFahrt(job) && String(job.etd || '').slice(0, 5) === zeit && filter(job));

// "Schafft Stefano die 14 Uhr Fahrt nach der um 10:30?"
const KONFLIKT_RE = /\b(schafft|schaffen|schaff|reicht|klappt|passt|geht sich|uberschneid\w*|konflikt\w*|kollidier\w*)\b|^(kann|konnte)\b.*\b(ubernehmen|fahren|machen|noch)\b|^(hat|ist)\b.*\b(zeit|frei)\b/;

const konfliktAntwort = (prompt, daten) => {
  const text = normalizeText(prompt);
  if (!KONFLIKT_RE.test(text)) return null;
  const zeiten = zeitenAusFrage(prompt);
  if (!zeiten.length && !/\bfahrt/.test(text)) return null;
  const hinweis = extractDateHint(prompt);
  const datum = hinweis?.type === 'date' ? hinweis.value : tagPlus(0);
  const genannt = genannteFahrer({ data: daten }, prompt);
  const namen = new Map((daten?.profiles || []).map((p) => [p.id, getDriverDisplayName(p)]));
  // Fahrten zu den genannten Zeiten, bevorzugt die des genannten Fahrers.
  const fahrten = zeiten.map((zeit) => {
    const alle = fahrtenZurZeit(zeit, datum, daten);
    const vomFahrer = genannt.length ? alle.filter((job) => fahrerDerFahrt(job, daten).some((id) => genannt.some((p) => p.id === id))) : [];
    return { zeit, treffer: vomFahrer.length ? vomFahrer : alle };
  });
  const fehlt = fahrten.find((f) => f.treffer.length === 0);
  // "Hat Anna um 18 Uhr Zeit?": keine Fahrt zu der Zeit, also pruefen, ob sie frei ist.
  const freiFrage = /\b(zeit|frei)\b/.test(text) && !/\bfahrt\b/.test(text);
  if (genannt.length && zeiten.length === 1 && (freiFrage || (fehlt && /\b(kann|konnte|schafft|passt)\b/.test(text)))) {
    const { ergebnis, zeile } = freiZurZeit(datum, zeiten[0], daten, genannt);
    fahrerMerken(genannt);
    return ergebnis.map((k) => `${k.ok ? 'Ja' : 'Nein'}, ${getDriverDisplayName(k.profil)} ${k.ok ? 'hat' : 'hat keine'} Zeit ${tagWort(datum)} um ${zeiten[0]}`
      + ` (gerechnet mit etwa ${PROBE_MIN} min).\n- ${k.ok ? zeile(k).replace(/^[^:]+: /, '') : k.gruende.join('\n- ')}`).join('\n');
  }
  if (fehlt) return `Ich finde ${tagWort(datum)} keine Fahrt um ${fehlt.zeit}.`;
  const mehrdeutig = fahrten.find((f) => f.treffer.length > 1);
  if (mehrdeutig) {
    return `Um ${mehrdeutig.zeit} gibt es ${mehrdeutig.treffer.length} Fahrten. Welche meinst du?\n${mehrdeutig.treffer.map((job) => fahrtZeile(job, daten, true)).join('\n')}`;
  }
  const jobs = fahrten.map((f) => f.treffer[0]).sort((a, b) => String(a.etd).localeCompare(String(b.etd)));
  let fahrer = genannt[0] || null;
  if (!fahrer) {
    const id = jobs.map((job) => fahrerDerFahrt(job, daten)[0]).find(Boolean);
    fahrer = (daten?.fahrer_profiles || []).find((p) => p.id === id) || null;
  }
  if (!fahrer) return 'Welcher Fahrer soll die Fahrt übernehmen? Nenne den Namen.';
  const name = getDriverDisplayName(fahrer);
  fahrerMerken([fahrer]);

  // Zwei Fahrten genannt: die Abfolge direkt pruefen.
  if (jobs.length >= 2) {
    const [erste, zweite] = jobs;
    const dauer = fahrtDauer(erste, daten);
    const frei = fahrtEnde(erste, daten);
    const anfahrt = anfahrtDauer(erste, zweite, daten);
    const da = frei + anfahrt.min;
    const puffer = (fahrtBeginn(zweite) ?? 0) - da;
    const zwischen = fahrtenDesFahrers(fahrer.id, datum, daten)
      .filter((job) => job.etd > erste.etd && job.etd < zweite.etd);
    const rechnung = [
      `Die ${String(erste.etd).slice(0, 5)}-Fahrt ${startName(erste)} → ${zielName(erste)} dauert etwa ${dauerText(dauer.min)} (${dauer.quelle}), mit ${AUSSTEIGEN_MIN} min zum Aussteigen ist ${name.split(' ')[0]} gegen ${uhrAusMinuten(frei)} frei.`,
      `Anfahrt zu ${startName(zweite)} etwa ${dauerText(anfahrt.min)} (${anfahrt.quelle}), Ankunft gegen ${uhrAusMinuten(da)}.`,
    ];
    let urteil;
    if (puffer < 0) urteil = `Nein, ${name} schafft die ${String(zweite.etd).slice(0, 5)}-Fahrt nach der um ${String(erste.etd).slice(0, 5)} nicht, es fehlen etwa ${dauerText(-puffer)}.`;
    else if (puffer < 15) urteil = `Knapp: ${name} schafft die ${String(zweite.etd).slice(0, 5)}-Fahrt nach der um ${String(erste.etd).slice(0, 5)} nur mit ${dauerText(puffer)} Puffer.`;
    else urteil = `Ja, ${name} schafft die ${String(zweite.etd).slice(0, 5)}-Fahrt nach der um ${String(erste.etd).slice(0, 5)}, es bleiben etwa ${dauerText(puffer)} Puffer.`;
    if (zwischen.length) rechnung.push(`Achtung: dazwischen hat ${name} noch ${zwischen.map((job) => `die ${String(job.etd).slice(0, 5)}-Fahrt`).join(', ')}.`);
    const nichtSeine = jobs.filter((job) => !fahrerDerFahrt(job, daten).includes(fahrer.id));
    if (nichtSeine.length) rechnung.push(`Hinweis: ${nichtSeine.map((job) => `die ${String(job.etd).slice(0, 5)}-Fahrt`).join(' und ')} ist ${nichtSeine.length > 1 ? 'sind' : 'ist'} nicht ${name} zugewiesen.`.replace(' ist sind', ' sind'));
    return [urteil, ...rechnung].join('\n');
  }

  // Eine Fahrt genannt: passt sie in den Tag des Fahrers?
  const job = jobs[0];
  if (!job) return null;
  const pruefung = passtInTag(fahrer.id, job, daten);
  const kann = /^(kann|konnte)\b/.test(text);
  const fahrtName = `die ${String(job.etd).slice(0, 5)}-Fahrt ${startName(job)} → ${zielName(job)}`;
  const kopf = pruefung.ok
    ? (kann ? `Ja, ${name} kann ${fahrtName} übernehmen.` : `Ja, ${name} schafft ${fahrtName}.`)
    : (kann ? `Nein, ${name} kann ${fahrtName} nicht übernehmen.` : `Nein, ${name} schafft ${fahrtName} nicht.`);
  const gruende = pruefung.gruende.length ? [...pruefung.gruende] : [`keine andere Fahrt ${tagWort(datum)}, die sich damit überschneidet`];
  if (!pruefung.dienst) gruende.push(`${tagWort(datum)} ist für ${name} kein Dienst eingetragen`);
  if (!fahrerDerFahrt(job, daten).includes(fahrer.id)) {
    const andere = fahrerDerFahrt(job, daten).map((id) => namen.get(id)).filter(Boolean);
    gruende.push(andere.length ? `die Fahrt hat bisher ${andere.join(', ')}` : 'die Fahrt hat noch keinen Fahrer');
  }
  return `${kopf}\n${gruende.map((g) => `- ${g.charAt(0).toUpperCase()}${g.slice(1)}`).join('\n')}`;
};

// Vorschlag fuer eine Fahrt: alle Fahrer, die ohne Ueberschneidung koennen, mit Grund.
const kandidatenFuer = (job, daten) => (daten?.fahrer_profiles || [])
  .filter((p) => !fahrerDerFahrt(job, daten).includes(p.id))
  .map((p) => ({ profil: p, ...passtInTag(p.id, job, daten) }));

const kandidatGrund = (k, job, daten) => {
  const teile = [k.dienst ? (k.imDienst ? `im Dienst (${dienstText(k.dienst).replace('Dienst ', '')})` : dienstText(k.dienst)) : 'kein Dienst eingetragen'];
  if (k.vorher) {
    const anfahrt = anfahrtDauer(k.vorher, job, daten);
    teile.push(`vorher ${String(k.vorher.etd).slice(0, 5)} nach ${zielName(k.vorher)}, ${k.puffer != null ? `${dauerText(k.puffer)} Puffer` : 'frei'}${anfahrt.quelle === 'gleicher Ort' || (anfahrt.km != null && anfahrt.km < 1) ? ', steht schon dort' : ''}`);
  } else {
    teile.push(k.anzahl ? `${k.anzahl} andere ${k.anzahl === 1 ? 'Fahrt' : 'Fahrten'} an dem Tag, keine Überschneidung` : 'an dem Tag keine Fahrt');
  }
  return teile.join(', ');
};

const VORSCHLAG_RE = /\bwer\b.*\b(kann|konnte|konnen|hat zeit|ist frei|sind frei|ubernimmt|ubernehmen|fahrt|fahren|soll)\b|\b(vorschlag|vorschlagen|empfiehl\w*|wen soll|welche[rn]? fahrer)\b.*\b(fahrt|ubernehm\w*|fahren)\b/;

const vorschlagAntwort = (prompt, daten) => {
  const text = normalizeText(prompt);
  if (!VORSCHLAG_RE.test(text)) return null;
  if (!/\b(fahrt|ubernehm\w*|um \d{1,2}|\d{1,2} uhr|\d{1,2}:\d\d)\b/.test(text)) return null;
  // "Wer faehrt Herrn Engel?" fragt nach dem eingetragenen Fahrer, nicht nach einem Vorschlag.
  if (/\bwer\b\s+(fahrt|fahren|hat|ubernimmt|macht)\b/.test(text) && !/\b(kann|konnte|konnen|soll|frei|zeit|offene|ohne fahrer)\b/.test(text)) return null;
  const zeiten = zeitenAusFrage(prompt);
  const hinweis = extractDateHint(prompt);
  const datum = hinweis?.type === 'date' ? hinweis.value : tagPlus(0);
  const nurOffen = /\b(offene|offen|ohne fahrer|unbesetzte)\b/.test(text);
  // "Wer ist frei um 18 Uhr?" ohne bestimmte Fahrt: gerechnet mit einer gedachten Fahrt von 45 min ohne Ort.
  if (zeiten.length && !/\bfahrt\b/.test(text) && !nurOffen) {
    const { ergebnis, zeile } = freiZurZeit(datum, zeiten[0], daten);
    const frei = ergebnis.filter((k) => k.ok).sort((a, b) => Number(b.imDienst) - Number(a.imDienst)
      || Number(Boolean(b.dienst)) - Number(Boolean(a.dienst)) || getDriverDisplayName(a.profil).localeCompare(getDriverDisplayName(b.profil), 'de'));
    const besetzt = ergebnis.filter((k) => !k.ok);
    fahrerMerken(frei.map((k) => k.profil));
    if (!frei.length) return `${tagWort(datum).replace(/^./, (c) => c.toUpperCase())} um ${zeiten[0]} ist kein Fahrer frei.\n${besetzt.map((k) => `- ${getDriverDisplayName(k.profil)}: ${k.gruende[0] || 'Überschneidung'}`).join('\n')}`;
    return `Frei ${tagWort(datum)} um ${zeiten[0]} (gerechnet mit etwa ${PROBE_MIN} min, Ort noch offen):\n${frei.map((k) => `- ${zeile(k)}`).join('\n')}${besetzt.length ? `\nNicht frei: ${besetzt.map((k) => getDriverDisplayName(k.profil)).join(', ')}.` : ''}`;
  }
  let treffer = [];
  if (zeiten.length) {
    treffer = fahrtenZurZeit(zeiten[0], datum, daten, (job) => !nurOffen || fahrerDerFahrt(job, daten).length === 0);
  } else if (nurOffen) {
    treffer = (daten?.jobs || []).filter((job) => job.ride_date === datum && aktiveFahrt(job) && fahrerDerFahrt(job, daten).length === 0);
  } else {
    const kontextFahrt = readConversationRideContext(daten?.jobs || []);
    if (kontextFahrt && /\b(die|diese|der)\s+fahrt\b/.test(text)) treffer = [kontextFahrt];
  }
  if (!treffer.length) return zeiten.length ? `Ich finde ${tagWort(datum)} keine ${nurOffen ? 'offene ' : ''}Fahrt um ${zeiten[0]}.` : null;
  if (treffer.length > 1) {
    return `Dazu passen ${treffer.length} Fahrten. Welche meinst du?\n${treffer.slice(0, 6).map((job) => fahrtZeile(job, daten, true)).join('\n')}`;
  }
  const job = treffer[0];
  updateConversationRideContext(job);
  const alle = kandidatenFuer(job, daten);
  const frei = alle.filter((k) => k.ok)
    // Zuerst wer im Dienst ist, dann mit Dienst, dann wer am naechsten steht bzw. am meisten Puffer hat.
    .sort((a, b) => Number(b.imDienst) - Number(a.imDienst)
      || Number(Boolean(b.dienst)) - Number(Boolean(a.dienst))
      || (a.vorher && b.vorher ? anfahrtDauer(a.vorher, job, daten).min - anfahrtDauer(b.vorher, job, daten).min : 0)
      || getDriverDisplayName(a.profil).localeCompare(getDriverDisplayName(b.profil), 'de'));
  const besetzt = alle.filter((k) => !k.ok);
  const kopf = `Für die ${String(job.etd).slice(0, 5)}-Fahrt ${startName(job)} → ${zielName(job)} (${tagWort(job.ride_date)}, Dauer etwa ${dauerText(fahrtDauer(job, daten).min)}):`;
  if (!frei.length) {
    fahrerMerken([]);
    return `${kopf}\nKein Fahrer ist frei, alle haben eine Überschneidung.\n${besetzt.slice(0, 5).map((k) => `- ${getDriverDisplayName(k.profil)}: ${k.gruende[0] || 'Überschneidung'}`).join('\n')}`;
  }
  fahrerMerken(frei.map((k) => k.profil));
  const zeilen = frei.slice(0, 6).map((k, i) => `${i + 1}. ${getDriverDisplayName(k.profil)}: ${kandidatGrund(k, job, daten)}`);
  const nein = besetzt.length ? `\nNicht frei: ${besetzt.map((k) => getDriverDisplayName(k.profil)).join(', ')}.` : '';
  return `${kopf}\n${zeilen.join('\n')}${nein}\nSoll ich einen davon eintragen? Schreib z. B. „Gib die Fahrt ${getDriverDisplayName(frei[0].profil).split(' ')[0]}“.`;
};

// "Welche Fahrer sind heute im Dienst?"
const dienstAntwort = (prompt, daten) => {
  const text = normalizeText(prompt);
  if (!/\b(im dienst|dienst haben|hat dienst|haben dienst|arbeiten|arbeitet|eingeteilt|schicht)\b/.test(text)) return null;
  if (!/\b(wer|welche|welcher|wie viele|wieviele|ist|sind|hat)\b/.test(text)) return null;
  const hinweis = extractDateHint(prompt);
  const datum = hinweis?.type === 'date' ? hinweis.value : tagPlus(0);
  const genannt = genannteFahrer({ data: daten }, prompt);
  const fahrer = genannt.length ? genannt : (daten?.fahrer_profiles || []);
  const mitDienst = fahrer.map((p) => ({ p, d: dienstAm(p.id, datum, daten) })).filter((x) => x.d);
  const jetzt = jetztMinuten();
  const zeile = ({ p, d }) => {
    const ende = minutenAus(d.ende);
    const vorbei = datum === tagPlus(0) && ende != null && ende < jetzt && (minutenAus(d.start) ?? 0) < ende;
    const anzahl = fahrtenDesFahrers(p.id, datum, daten).length;
    return `- ${getDriverDisplayName(p)}: ${dienstText(d).replace('Dienst ', '')}${vorbei ? ', schon Feierabend' : ''}, ${anzahl === 1 ? '1 Fahrt' : `${anzahl} Fahrten`}`;
  };
  if (genannt.length) {
    fahrerMerken(genannt);
    return genannt.map((p) => {
      const d = dienstAm(p.id, datum, daten);
      return d ? `${getDriverDisplayName(p)} hat ${tagWort(datum)} ${dienstText(d)}.` : `${getDriverDisplayName(p)} hat ${tagWort(datum)} keinen Dienst eingetragen.`;
    }).join('\n');
  }
  const ohneDienstMitFahrt = fahrer.filter((p) => !mitDienst.some((x) => x.p.id === p.id) && fahrtenDesFahrers(p.id, datum, daten).length);
  fahrerMerken(mitDienst.map((x) => x.p));
  const teile = [mitDienst.length
    ? `${tagWort(datum).replace(/^./, (c) => c.toUpperCase())} im Dienst (${mitDienst.length}):\n${mitDienst.map(zeile).join('\n')}`
    : `${tagWort(datum).replace(/^./, (c) => c.toUpperCase())} ist kein Fahrer im Dienst eingetragen.`];
  if (ohneDienstMitFahrt.length) {
    teile.push(`Ohne Dienst, aber mit Fahrten: ${ohneDienstMitFahrt.map((p) => `${getDriverDisplayName(p)} (${fahrtenDesFahrers(p.id, datum, daten).length})`).join(', ')}.`);
  }
  return teile.join('\n');
};

// "Wer hat heute noch Luft?", "Wer ist gerade frei?"
const luftAntwort = (prompt, daten) => {
  const text = normalizeText(prompt);
  if (!/\b(luft|frei|zeit|kapazitat|verfugbar|nichts zu tun|wenig zu tun)\b/.test(text)) return null;
  if (!/\bwer\b|\bwelche[rn]?\s+fahrer\b/.test(text)) return null;
  if (zeitenAusFrage(prompt).length || /\bfahrt\b/.test(text)) return null; // dann ist eine bestimmte Fahrt gemeint
  const hinweis = extractDateHint(prompt);
  const datum = hinweis?.type === 'date' ? hinweis.value : tagPlus(0);
  const ab = datum === tagPlus(0) ? jetztMinuten() : 0;
  const liste = (daten?.fahrer_profiles || []).map((p) => {
    const rest = fahrtenDesFahrers(p.id, datum, daten).filter((job) => (fahrtEnde(job, daten) ?? 0) > ab && !BEENDET.has(String(job.status)));
    const dienst = dienstAm(p.id, datum, daten);
    const laufend = rest.find((job) => (fahrtBeginn(job) ?? 0) <= ab);
    return { p, rest, dienst, laufend };
  }).sort((a, b) => a.rest.length - b.rest.length
    || Number(Boolean(b.dienst)) - Number(Boolean(a.dienst))
    || getDriverDisplayName(a.p).localeCompare(getDriverDisplayName(b.p), 'de'));
  const zeile = ({ p, rest, dienst, laufend }) => {
    const fahrten = rest.length ? `noch ${rest.length === 1 ? '1 Fahrt' : `${rest.length} Fahrten`} (${rest.map((job) => String(job.etd).slice(0, 5)).join(', ')})` : `${datum === tagPlus(0) ? 'heute' : tagWort(datum)} keine Fahrt mehr`;
    return `- ${getDriverDisplayName(p)}: ${fahrten}${laufend ? ', gerade unterwegs' : ''}, ${dienstText(dienst)}`;
  };
  const meisteLuft = liste.filter((x) => x.rest.length === liste[0]?.rest.length);
  fahrerMerken(meisteLuft.map((x) => x.p));
  return `Am meisten Luft ${tagWort(datum)}${datum === tagPlus(0) ? ` ab ${uhrAusMinuten(ab)}` : ''}: ${meisteLuft.map((x) => getDriverDisplayName(x.p)).join(', ')}.\n${liste.map(zeile).join('\n')}`;
};

// "Wer fährt die 18 Uhr Fahrt?", "Wer hat die Fahrt um 10:30?"
const zeitFahrerAntwort = (prompt, daten) => {
  const text = normalizeText(prompt);
  if (!/^wer\s+(fahrt|hat|ubernimmt|macht|ist auf)\b/.test(text) || !/\bfahrt\b/.test(text)) return null;
  if (/\b(kann|konnte|soll|frei|zeit)\b/.test(text)) return null;
  const zeiten = zeitenAusFrage(prompt);
  if (zeiten.length !== 1) return null;
  const hinweis = extractDateHint(prompt);
  const datum = hinweis?.type === 'date' ? hinweis.value : tagPlus(0);
  const jobs = fahrtenZurZeit(zeiten[0], datum, daten);
  if (!jobs.length) return `Ich finde ${tagWort(datum)} keine Fahrt um ${zeiten[0]}.`;
  const namen = new Map((daten?.profiles || []).map((p) => [p.id, getDriverDisplayName(p)]));
  if (jobs.length === 1) updateConversationRideContext(jobs[0]);
  return jobs.map((job) => {
    const fahrer = fahrerDerFahrt(job, daten).map((id) => namen.get(id)).filter(Boolean);
    const fahrt = `Die ${String(job.etd).slice(0, 5)}-Fahrt ${startName(job)} → ${zielName(job)}`;
    return fahrer.length ? `${fahrt} fährt ${fahrer.join(', ')}.` : `${fahrt} hat noch keinen Fahrer.`;
  }).join('\n');
};

// "Wer fährt Herrn Engel?": eingetragener Fahrer der Fahrten dieses Gastes.
const gastFahrerAntwort = (prompt, daten) => {
  const text = normalizeText(prompt);
  if (!/^wer\s+(fahrt|holt|bringt|ubernimmt)\b/.test(text)) return null;
  const heute = tagPlus(0);
  const woerter = text.split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !['wer', 'fahrt', 'holt', 'bringt', 'herrn', 'herr', 'frau', 'heute', 'morgen', 'den', 'die', 'der', 'gast', 'ubernimmt', 'ab'].includes(w));
  if (!woerter.length) return null;
  const hinweis = extractDateHint(prompt);
  const jobs = (daten?.jobs || []).filter((job) => aktiveFahrt(job)
    && (hinweis?.type === 'date' ? job.ride_date === hinweis.value : job.ride_date >= heute)
    && gaesteDerFahrt(job, daten).some((name) => normalizeText(name).split(' ').some((teil) => woerter.includes(teil))))
    .sort((a, b) => `${a.ride_date} ${a.etd}`.localeCompare(`${b.ride_date} ${b.etd}`));
  if (!jobs.length) return null;
  const namen = new Map((daten?.profiles || []).map((p) => [p.id, getDriverDisplayName(p)]));
  if (jobs.length === 1) updateConversationRideContext(jobs[0]);
  else {
    fahrtenMerken(jobs.slice(0, 10).map((job) => job.id));
    conversationContext.letzteListe = jobs.slice(0, 10).map((job) => job.id);
    conversationContext.fokusMehrdeutig = true;
  }
  return jobs.slice(0, 6).map((job) => {
    const fahrer = fahrerDerFahrt(job, daten).map((id) => namen.get(id)).filter(Boolean).join(', ');
    return `${fahrer ? `${fahrer} fährt` : 'Noch kein Fahrer für'} ${gaesteDerFahrt(job, daten).join(', ')}: ${tagWort(job.ride_date)} ${String(job.etd).slice(0, 5)} ${startName(job)} → ${zielName(job)}.`;
  }).join('\n');
};

// "Welche Fahrten sind noch ohne Fahrer?", "Gibt es offene Fahrten?"
const ohneFahrerAntwort = (prompt, daten) => {
  const text = normalizeText(prompt);
  if (!(FRAGE_OHNE_FAHRER_RE.test(text) || /\b(offene[nr]?|unbesetzte[n]?)\s+fahrt/.test(text))) return null;
  if (!/\b(welche|wie viele|wieviele|gibt|zeig|liste|haben wir|sind|noch|alle)\b/.test(text)) return null;
  if (/\b(wer|ubernehm\w*)\b/.test(text)) return null;
  const hinweis = extractDateHint(prompt);
  const heute = tagPlus(0);
  const jobs = (daten?.jobs || []).filter((job) => aktiveFahrt(job) && !BEENDET.has(String(job.status).toLowerCase())
    && (hinweis?.type === 'date' ? job.ride_date === hinweis.value : job.ride_date >= heute)
    && fahrerDerFahrt(job, daten).length === 0)
    .sort((a, b) => `${a.ride_date} ${a.etd}`.localeCompare(`${b.ride_date} ${b.etd}`));
  const zeitraum = hinweis?.type === 'date' ? tagWort(hinweis.value) : 'ab heute';
  if (!jobs.length) return `Es gibt ${zeitraum} keine Fahrt ohne Fahrer.`;
  if (jobs.length === 1) updateConversationRideContext(jobs[0]);
  else {
    fahrtenMerken(jobs.slice(0, 10).map((job) => job.id));
    conversationContext.letzteListe = jobs.slice(0, 10).map((job) => job.id);
    conversationContext.fokusMehrdeutig = true;
  }
  const zeilen = jobs.slice(0, 20).map((job) => fahrtZeile(job, daten).replace(/^- /, `- ${datumMitTag(job.ride_date)} `));
  return `${jobs.length === 1 ? '1 Fahrt' : `${jobs.length} Fahrten`} ohne Fahrer ${zeitraum}:\n${zeilen.join('\n')}${jobs.length > 20 ? `\n… und ${jobs.length - 20} weitere.` : ''}`;
};

// Ortsfilter aus der Frage: "zum Flughafen" (Ziel), "vom Hauptbahnhof" (Start). null, wenn keiner da ist.
const ortsFilter = (prompt) => {
  const roh = String(prompt || '');
  const ende = '(?=\\s+(?:heute|morgen|übermorgen|uebermorgen|diese|nächste|naechste|am|um|gegen|ab|von|vom|nach|zum|zur|mit|und)\\b|[?.!,]|$)';
  const ziel = roh.match(new RegExp(`\\b(?:nach|zum|zur|ins|in die|in den)\\s+(.+?)${ende}`, 'i'))?.[1] || '';
  const start = roh.match(new RegExp(`\\b(?:vom|von der|von dem|von|aus|ab dem|ab der)\\s+(?!\\d|heute|morgen|übermorgen|uebermorgen|gestern|montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag|diese|nächste|naechste)(.+?)${ende}`, 'i'))?.[1] || '';
  const woerter = (ort) => ortStamm(ort).filter((w) => !['munch', 'munchen', 'gehen', 'geht', 'fahren', 'fahrt'].includes(w));
  if (!ziel && !start) return null;
  const passt = (name, w) => !w.length || w.every((wort) => ortStamm(name).includes(wort));
  const zw = woerter(ziel);
  const sw = woerter(start);
  return {
    text: [start ? `ab ${start}` : '', ziel ? `nach ${ziel}` : ''].filter(Boolean).join(' '),
    pruefen: (job) => passt(job.dropoff_name || job.dropoff_address, zw) && passt(job.pickup_name || job.pickup_address, sw),
  };
};

// "Gib mir die Fahrten von morgen", "Welche Fahrten gibt es heute?", "Wann ist die Fahrt zum Flughafen morgen?"
const tageslisteAntwort = (prompt, daten) => {
  const text = normalizeText(prompt);
  const mehrere = /\bfahrten\b/.test(text)
    && /\b(welche|zeig|zeige|gib|liste|nenn|nenne|alle|was steht|gibt es|gibts|haben wir|ubersicht|wie viele|wieviele|anzahl|gehen|wann)\b/.test(text);
  const wannEine = /\bwann\b.*\bfahrt\b/.test(text);
  if (!mehrere && !wannEine) return null;
  // Gast oder Fahrer: dann sucht die Frage etwas anderes (Tagesplan, Gast, Modell).
  if (/\b(mit|gast|gaste|fur|fahrer|fahrerin)\b/.test(text)) return null;
  if (genannteFahrer({ data: daten }, prompt).length) return null;
  const filter = ortsFilter(prompt);
  if (/\b(nach|zum|zur|ins|vom|aus)\b/.test(text) && !filter) return null;
  const hinweis = extractDateHint(prompt);
  let tage = zeitraumTage(prompt) || (hinweis?.type === 'date' ? [hinweis.value] : null);
  if (!tage && (filter || wannEine)) tage = Array.from({ length: 7 }, (_, i) => tagPlus(i));
  if (!tage) return null;
  if (wannEine && !filter) return null;
  const jobs = (daten?.jobs || []).filter((job) => tage.includes(job.ride_date) && aktiveFahrt(job) && (!filter || filter.pruefen(job)))
    .sort((a, b) => `${a.ride_date} ${a.etd}`.localeCompare(`${b.ride_date} ${b.etd}`));
  if (filter) {
    const bereich = tage.length === 1 ? datumMitTag(tage[0]) : `von ${datumMitTag(tage[0])} bis ${datumMitTag(tage[tage.length - 1])}`;
    if (!jobs.length) return `Ich finde ${bereich} keine Fahrt ${filter.text}.`;
    if (jobs.length === 1) updateConversationRideContext(jobs[0]);
    else {
      fahrtenMerken(jobs.slice(0, 10).map((job) => job.id));
      conversationContext.letzteListe = jobs.slice(0, 10).map((job) => job.id);
      conversationContext.fokusMehrdeutig = true;
    }
    return `${jobs.length === 1 ? '1 Fahrt' : `${jobs.length} Fahrten`} ${filter.text}, ${bereich}:\n${jobs.slice(0, 25).map((job) => fahrtZeile(job, daten, true).replace(/^- /, `- ${datumMitTag(job.ride_date)} `)).join('\n')}`;
  }
  const bereich = tage.length === 1 ? datumMitTag(tage[0]) : `${datumMitTag(tage[0])} bis ${datumMitTag(tage[tage.length - 1])}`;
  if (!jobs.length) return `${bereich.replace(/^./, (c) => c.toUpperCase())}: keine Fahrten.`;
  if (jobs.length === 1) updateConversationRideContext(jobs[0]);
  else {
    fahrtenMerken(jobs.slice(0, 10).map((job) => job.id));
    conversationContext.letzteListe = jobs.slice(0, 10).map((job) => job.id);
    conversationContext.fokusMehrdeutig = true;
  }
  const ohne = jobs.filter((job) => fahrerDerFahrt(job, daten).length === 0).length;
  const zeilen = jobs.slice(0, 25).map((job) => fahrtZeile(job, daten, true).replace(/^- /, tage.length > 1 ? `- ${datumMitTag(job.ride_date)} ` : '- '));
  return `${bereich.replace(/^./, (c) => c.toUpperCase())}: ${jobs.length === 1 ? '1 Fahrt' : `${jobs.length} Fahrten`}${ohne ? `, davon ${ohne} ohne Fahrer` : ''}.\n${zeilen.join('\n')}${jobs.length > 25 ? `\n… und ${jobs.length - 25} weitere.` : ''}`;
};

// Alle festen Antworten der Reihe nach. Gibt Text oder null.
const festeAntwort = (prompt, daten, markierte) => {
  for (const regel of [
    () => ohneFahrerAntwort(prompt, daten),
    () => standortAntwort(prompt, daten, markierte),
    () => konfliktAntwort(prompt, daten),
    () => vorschlagAntwort(prompt, daten),
    () => dienstAntwort(prompt, daten),
    () => luftAntwort(prompt, daten),
    () => zeitFahrerAntwort(prompt, daten),
    () => gastFahrerAntwort(prompt, daten),
    () => tagesplanAntwort(prompt, daten),
    () => tageslisteAntwort(prompt, daten),
  ]) {
    const antwort = regel();
    if (antwort) return antwort;
  }
  return null;
};

const askDatabaseAssistant = async ({ prompt, chatHistory = [], offenerVorschlag = null, letzteFahrtId = null, markierteFahrer = [] }) => {
  const trimmedPrompt = String(prompt || '').trim();
  if (!trimmedPrompt) return 'Bitte stelle eine Frage.';

  // Seit der letzten Frage neu gebucht: dann ist ab jetzt diese Fahrt gemeint.
  if (letzteFahrtId && !conversationContext.fahrten.includes(letzteFahrtId)) {
    fahrtenMerken([letzteFahrtId]);
    conversationContext.lastRideId = letzteFahrtId;
    conversationContext.fokusMehrdeutig = false;
    conversationContext.updatedAt = Date.now();
  }

  // Aenderungen erkennt die Regel und schlaegt sie als Karte vor. Gespeichert wird erst nach der Bestaetigung.
  const frageNorm = normalizeText(trimmedPrompt);
  const mitFragezeichen = /\?\s*$/.test(trimmedPrompt);
  const buchung = isBookingPrompt(trimmedPrompt);
  const zeigWunsch = /^(bitte\s+)?(gib|zeig|zeige|nenn|nenne|liste|schick|schicke)\s+(mir|uns)\b/.test(frageNorm)
    && !/\b(eine|neue)\s+fahrt\b/.test(frageNorm);
  const istAenderung = !buchung && !zeigWunsch && (
    AENDERN_RE.test(frageNorm)
    || (AENDERN_KURZ_RE.test(frageNorm) && !mitFragezeichen)
    || (ZUWEISEN_RE.test(frageNorm) && !mitFragezeichen && !FRAGEWORT_RE.test(frageNorm))
    || (offenerVorschlag && !mitFragezeichen && !FRAGEWORT_RE.test(frageNorm) && ANPASSUNG_RE.test(frageNorm))
  );
  if (istAenderung) {
    if (STORNIEREN_RE.test(frageNorm)) {
      return 'Stornieren oder löschen geht nur direkt an der Fahrt. Tippe im Chat auf „Fahrt bearbeiten“ oder öffne sie unter Alle Fahrten.';
    }
    conversationContext.rueckfrage = null;
    const daten = await loadDatabaseSnapshot({ includeAll: false, forceRefresh: true });
    return aenderungVorschlagen({ prompt: trimmedPrompt, snapshot: daten, offenerVorschlag, letzteFahrtId });
  }

  // Antwort auf eine offene Rueckfrage: die urspruengliche Aenderung auf die gewaehlte Fahrt anwenden.
  // Eine neue Frage ("Wo ist Stefano?") ist keine Auswahl.
  const rueckfrage = conversationContext.rueckfrage;
  if (rueckfrage) {
    conversationContext.rueckfrage = null;
    const neueFrage = mitFragezeichen || (FRAGEWORT_RE.test(frageNorm) && !/^(die|der|den)\b/.test(frageNorm));
    if (!neueFrage && !buchung && Date.now() - Number(rueckfrage.zeit || 0) < 15 * 60 * 1000 && trimmedPrompt.length <= 80) {
      const daten = await loadDatabaseSnapshot({ includeAll: false, forceRefresh: true });
      const nachId = new Map((daten.data.jobs || []).map((job) => [job.id, job]));
      const auswahl = (rueckfrage.ids || []).map((id) => nachId.get(id)).filter(Boolean);
      const gewaehlt = fahrtAuswaehlen(trimmedPrompt, auswahl, daten.data);
      if (gewaehlt) {
        return aenderungVorschlagen({ prompt: rueckfrage.prompt, snapshot: daten, offenerVorschlag: null, letzteFahrtId, fixeFahrtId: gewaehlt.id });
      }
    }
  }

  const normalizedPrompt = normalizeText(trimmedPrompt);
  const includeAll = isAllDataPrompt(trimmedPrompt) || isAllDriversPrompt(trimmedPrompt);
  const shouldForceRefresh = /\b(aktuell|live|jetzt|gerade|neueste|sofort|wo)\b/.test(normalizedPrompt);
  const snapshotRaw = await loadDatabaseSnapshot({ includeAll, forceRefresh: shouldForceRefresh });

  // Antwort auf eine Rueckfrage zur Buchung ("Wohin?" -> "Zum Flughafen T2"): in die offene Buchung uebernehmen.
  const offeneBuchung = conversationContext.offeneBuchung;
  conversationContext.offeneBuchung = null;
  if (!buchung && offeneBuchung?.payload && Date.now() - Number(offeneBuchung.zeit || 0) < 15 * 60 * 1000
    && !mitFragezeichen && !FRAGEWORT_RE.test(frageNorm) && trimmedPrompt.length <= 160) {
    const ergaenzt = buchungFortsetzen(offeneBuchung, trimmedPrompt, snapshotRaw);
    if (ergaenzt) return buchungsAntwort(ergaenzt, snapshotRaw);
  }

  if (buchung) {
    // Die Regel liest Datum, Zeit, Orte, Gast und Fahrer aus der Frage. Das Modell hilft nur, wenn etwas fehlt,
    // und auch dann zaehlen nur Werte, die wirklich in der Frage stehen.
    const regel = buildRuleBasedBookingProposal({ prompt: trimmedPrompt, snapshot: snapshotRaw });
    let proposal = regel;
    if (regel.needsClarification) {
      const llmProposal = await buildRideBookingProposal({ prompt: trimmedPrompt, chatHistory, snapshot: snapshotRaw }).catch(() => null);
      proposal = buchungErgaenzen(regel, llmProposal, trimmedPrompt, chatHistory, snapshotRaw.data);
    }
    return buchungsAntwort(proposal, snapshotRaw);
  }

  // Standort, Tagesplan, Konflikt, Fahrervorschlag, Dienst: gerechnet, ohne Modell.
  const fest = festeAntwort(trimmedPrompt, snapshotRaw.data, markierteFahrer);
  if (fest) return { answer: fest, meta: snapshotRaw.meta };

  const directIntentAnswer = buildDirectIntentAnswer({ prompt: trimmedPrompt, snapshot: snapshotRaw, chatHistory });
  if (directIntentAnswer) {
    return {
      answer: directIntentAnswer,
      meta: snapshotRaw.meta,
    };
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
  const fahrtenDaten = fahrtenFuerModell(snapshotRaw, trimmedPrompt);
  const { genannt: fahrerGenannt, ...fahrtenTeil } = fahrtenDaten;
  if (FRAGE_OHNE_FAHRER_RE.test(normalizeText(trimmedPrompt))) {
    const zeilen = fahrtenTeil.fahrten.map((zeile) => `- ${zeile.replace(' | Fahrer: keiner', '')}`);
    return {
      answer: zeilen.length
        ? `${fahrtenTeil.anzahl} Fahrten ohne Fahrer (${fahrtenTeil.zeitraum}):\n${zeilen.join('\n')}`
        : `Es gibt keine Fahrt ohne Fahrer (${fahrtenTeil.zeitraum}).`,
      meta: snapshot.meta,
    };
  }
  if (compactSnapshot.data.jobs || fahrerGenannt) compactSnapshot.data.fahrten_uebersicht = fahrtenTeil;
  delete compactSnapshot.data.jobs;
  delete compactSnapshot.data.job_guests;
  delete compactSnapshot.data.convoy_assignments;
  delete compactSnapshot.meta.counts;
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

return { fragen: askDatabaseAssistant, kontext: () => conversationContext };
};
