// Demo-Vorschau: In-Memory-Ersatz für den Supabase-Client.
// Alle Daten sind simuliert und leben nur im Browser-Tab (Reload = Zurücksetzen).

import profiles from './data/profiles.json';
import jobs from './data/jobs.json';
import vehicles from './data/vehicles.json';
import guests from './data/guests.json';
import convoys from './data/convoys.json';
import convoy_assignments from './data/convoy_assignments.json';
import job_notes from './data/job_notes.json';
import job_guests from './data/job_guests.json';
import driver_service_requests from './data/driver_service_requests.json';
import jobs_archive from './data/jobs_archive.json';
import driver_live_locations from './data/driver_live_locations.json';
import driver_location_history from './data/driver_location_history.json';
import messages from './data/messages.json';
import vehicle_damages from './data/vehicle_damages.json';
import chat_reads from './data/chat_reads.json';

const clone = (v) => JSON.parse(JSON.stringify(v));

const scrubGuest = (g) => ({
  ...g,
  notes: g.notes && /schwieriger/i.test(g.notes) ? null : g.notes,
  note_text: g.note_text && /schwieriger/i.test(g.note_text) ? null : g.note_text,
});

const store = {
  profiles: clone(profiles),
  jobs: clone(jobs),
  vehicles: clone(vehicles),
  guests: clone(guests).map(scrubGuest),
  convoys: clone(convoys),
  convoy_assignments: clone(convoy_assignments),
  job_notes: clone(job_notes),
  job_guests: clone(job_guests),
  driver_service_requests: clone(driver_service_requests),
  jobs_archive: clone(jobs_archive),
  driver_live_locations: clone(driver_live_locations),
  driver_location_history: clone(driver_location_history),
  messages: clone(messages),
  vehicle_damages: clone(vehicle_damages),
  chat_reads: clone(chat_reads),
};

// --- Datumsverschiebung -------------------------------------------------
// Alle Datums-/Zeitstempel werden so verschoben, dass DEMO_BASE_DATE immer
// "heute" ist. Die Rohdaten sind auf dieses Basisdatum kalibriert:
// Basistag = wenige Fahrten (Stefano), Basistag+1 = Stadttag (124 Fahrten),
// Basistag+2 = Messetag Riem (323 Fahrten). Damit zeigt die Demo dauerhaft
// heute/morgen/übermorgen statt eines fixen Datums.
const DEMO_BASE_DATE = '2026-08-16';

const DATE_PREFIX_RE = /^(\d{4})-(\d{2})-(\d{2})([T ].*)?$/;

const shiftIsoDateString = (value, deltaDays) => {
  const match = DATE_PREFIX_RE.exec(value);
  if (!match) return value;
  const base = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  const shifted = new Date(base + deltaDays * 86400000);
  const datePart = `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}-${String(shifted.getUTCDate()).padStart(2, '0')}`;
  return `${datePart}${match[4] || ''}`;
};

const shiftDatesDeep = (node, deltaDays) => {
  if (Array.isArray(node)) {
    node.forEach((entry, index) => {
      if (typeof entry === 'string') node[index] = shiftIsoDateString(entry, deltaDays);
      else shiftDatesDeep(entry, deltaDays);
    });
    return;
  }
  if (node && typeof node === 'object') {
    Object.keys(node).forEach((key) => {
      const value = node[key];
      if (typeof value === 'string') node[key] = shiftIsoDateString(value, deltaDays);
      else shiftDatesDeep(value, deltaDays);
    });
  }
};

(() => {
  const match = DATE_PREFIX_RE.exec(DEMO_BASE_DATE);
  const now = new Date();
  const todayUtc = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const baseUtc = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  const deltaDays = Math.round((todayUtc - baseUtc) / 86400000);
  if (deltaDays !== 0) shiftDatesDeep(store, deltaDays);
})();

// --- Kolonnenfahrt ins Zeitfenster legen ---------------------------------
// Kolonnenfahrer sehen die Standorte ihrer Kollegen ab 30 Minuten vor der
// Fahrt bis zu deren Ende. Damit das in der Demo zu jeder Uhrzeit zu sehen ist,
// faehrt die Beispiel-Kolonne (Summit-Delegation) 15 Minuten nach dem Laden am
// Hotel los — zum Flughafen, wo der Fahrer danach LH 411 abholt (siehe unten);
// die Standorte ihrer Fahrer gelten als gerade eben erfasst.
const DEMO_KOLONNEN_FAHRT = '4ce042be-fe4e-5551-af45-60feb881d279';
const DEMO_KOLONNE_VORLAUF_MIN = 15;
const DEMO_KOLONNE_FAHRZEIT_MIN = 38;
const DEMO_FLUGHAFEN = {
  name: 'Flughafen München Terminal 2',
  adresse: 'Flughafen München Terminal 2, Terminalstraße Mitte 18, 85356 München-Flughafen',
};
// Katharina Vogel kommt erst mit LH 411 an — in der Kolonne zum Flughafen
// faehrt statt ihrer Elena Rossi.
const DEMO_GAST_VOGEL = '6a208955-2a32-5b1b-9f3b-cd6c436497be';
const DEMO_GAST_ROSSI = '7da39435-8f96-53c3-95af-bf4dcbea1319';
(() => {
  const job = store.jobs.find((eintrag) => eintrag.id === DEMO_KOLONNEN_FAHRT);
  if (!job) return;
  job.dropoff_name = DEMO_FLUGHAFEN.name;
  job.dropoff_address = DEMO_FLUGHAFEN.adresse;
  job.ext_route_duration_mins = DEMO_KOLONNE_FAHRZEIT_MIN;
  job.ext_route_duration_in_traffic_mins = DEMO_KOLONNE_FAHRZEIT_MIN;
  const rossi = store.guests.find((gast) => gast.id === DEMO_GAST_ROSSI);
  const rossiName = rossi ? `${rossi.first_name} ${rossi.last_name}` : 'Elena Rossi';
  if (rossi) { rossi.is_vip = true; rossi.vip_status = true; }
  job.passengers = (job.passengers || []).map((name) => (name === 'Katharina Vogel' ? rossiName : name));
  store.job_guests.forEach((eintrag) => {
    if (eintrag.job_id === DEMO_KOLONNEN_FAHRT && eintrag.guest_id === DEMO_GAST_VOGEL) eintrag.guest_id = DEMO_GAST_ROSSI;
  });
  store.convoy_assignments.forEach((zuweisung) => {
    if (zuweisung.job_id !== DEMO_KOLONNEN_FAHRT) return;
    zuweisung.guest_ids = (zuweisung.guest_ids || []).map((id) => (id === DEMO_GAST_VOGEL ? DEMO_GAST_ROSSI : id));
    zuweisung.guest_names = (zuweisung.guest_names || []).map((name) => (name === 'Katharina Vogel' ? rossiName : name));
  });
  const start = new Date(Date.now() + DEMO_KOLONNE_VORLAUF_MIN * 60000);
  start.setMinutes(Math.ceil(start.getMinutes() / 5) * 5, 0, 0);
  const p2 = (n) => String(n).padStart(2, '0');
  const zeit = `${p2(start.getHours())}:${p2(start.getMinutes())}:00`;
  job.ride_date = `${start.getFullYear()}-${p2(start.getMonth() + 1)}-${p2(start.getDate())}`;
  job.etd = zeit;
  if ('original_etd' in job) job.original_etd = zeit;
  const fahrer = new Set(store.convoy_assignments
    .filter((zuweisung) => zuweisung.job_id === DEMO_KOLONNEN_FAHRT)
    .map((zuweisung) => zuweisung.driver_id));
  const jetzt = new Date().toISOString();
  // Die Kollegen stehen kurz vor der Fahrt schon in der Naehe des Abholorts
  // (Hotel Bayerischer Hof) — ein paar hundert Meter bis gut einen Kilometer
  // entfernt, wie man es 20 Minuten vor einer Kolonnenfahrt erwarten wuerde.
  const KOLLEGEN_NAHE_ABHOLORT = [
    { lat: 48.1398, lng: 11.5647 }, // Karlsplatz (Stachus), ca. 700 m
    { lat: 48.1355, lng: 11.5818 }, // Isartor, ca. 800 m
    { lat: 48.1462, lng: 11.5791 }, // Odeonsplatz Nord, ca. 750 m
  ];
  let naechsteNaehe = 0;
  store.driver_live_locations.forEach((standort) => {
    if (!fahrer.has(standort.driver_id)) return;
    standort.captured_at = jetzt;
    standort.updated_at = jetzt;
    // Der eigene Fahrer der Fahrt behaelt seinen Standort (seine Anfahrt).
    if (standort.driver_id === job.driver_id) return;
    const naehe = KOLLEGEN_NAHE_ABHOLORT[naechsteNaehe % KOLLEGEN_NAHE_ABHOLORT.length];
    naechsteNaehe += 1;
    standort.lat = naehe.lat;
    standort.lng = naehe.lng;
  });
})();

// --- Flugfahrt ins Zeitfenster legen ---------------------------------------
// Die Karte der Flughafenfahrt zeigt den Flug nach der Uhr (demo/flugAnflug.js):
// vor dem Abheben gar nicht, danach dort, wo er gerade waere, gelandet wird um
// ETD. Die Kolonne endet am Flughafen; der Flug landet 1,5 Stunden nach dem
// Laden, der Fahrer wartet dort also schon. Der Flug kommt aus New York (in den
// Rohdaten LH 2085 aus Berlin): bei gut acht Stunden Flugzeit ist das Flugzeug
// beim Start der Demo bzw. des Tutorials immer schon in der Luft — ein
// Inlandsflug waere 1,5 Stunden vor der Landung noch nicht gestartet. Die geplante Ankunft liegt
// 20 Minuten frueher (Verspaetung wie in den Daten).
// Die Anschlussfahrt ab dem Flughafen behaelt ihren Abstand, damit die Anfahrt
// aus der vorherigen Fahrt weiter an diesem Paar zu sehen ist.
const DEMO_FLUG_FAHRT = '19f25ddb-af39-519c-961b-3902848a0671';
const DEMO_ANSCHLUSS_FAHRT = '011ac7d9-f03d-5677-a76d-ae2bda3d7bdb';
const DEMO_FLUG_VORLAUF_MIN = 90;
const DEMO_FLUG_NUMMER = 'LH 411';
const DEMO_FLUG_HERKUNFT = 'New York (JFK)';
const DEMO_FLUG_VERSPAETUNG_MIN = 20;
const DEMO_ANSCHLUSS_ABSTAND_MIN = 114;
(() => {
  const p2 = (n) => String(n).padStart(2, '0');
  const setzen = (job, zeitpunkt, planMin = 0) => {
    const zeit = (d) => `${p2(d.getHours())}:${p2(d.getMinutes())}:00`;
    job.ride_date = `${zeitpunkt.getFullYear()}-${p2(zeitpunkt.getMonth() + 1)}-${p2(zeitpunkt.getDate())}`;
    job.etd = zeit(zeitpunkt);
    if ('original_etd' in job) job.original_etd = zeit(new Date(zeitpunkt.getTime() - planMin * 60000));
  };
  const flug = store.jobs.find((eintrag) => eintrag.id === DEMO_FLUG_FAHRT);
  if (!flug) return;
  flug.flight_number = DEMO_FLUG_NUMMER;
  flug.flight_origin = DEMO_FLUG_HERKUNFT;
  const ankunft = new Date(Date.now() + DEMO_FLUG_VORLAUF_MIN * 60000);
  ankunft.setMinutes(Math.ceil(ankunft.getMinutes() / 5) * 5, 0, 0);
  setzen(flug, ankunft, DEMO_FLUG_VERSPAETUNG_MIN);
  const anschluss = store.jobs.find((eintrag) => eintrag.id === DEMO_ANSCHLUSS_FAHRT);
  if (anschluss) setzen(anschluss, new Date(ankunft.getTime() + DEMO_ANSCHLUSS_ABSTAND_MIN * 60000));
})();

// Chat-Nachrichten tragen statt fester Uhrzeiten ein 'minuten_vorher'. So
// liegt die Unterhaltung immer kurz vor dem Moment, in dem jemand die Demo
// anschaut — sonst stuenden 17:52-Nachrichten ueber einer Antwort von 12:06.
(() => {
  const jetzt = Date.now();
  (store.messages || []).forEach((eintrag) => {
    const vor = Number(eintrag?.minuten_vorher);
    if (!Number.isFinite(vor)) return;
    eintrag.created_at = new Date(jetzt - vor * 60000).toISOString();
  });
})();

// Der Lesestand der Chats liegt im localStorage und wuerde einen Neustart der
// Demo ueberleben. Dann stuende die Plakette mit den ungelesenen Nachrichten
// nach dem ersten Besuch des Kolonnen-Chats nie wieder da. Beim Laden also
// zuruecksetzen, wie alle anderen Demo-Daten auch.
(() => {
  try {
    Object.keys(localStorage)
      .filter((schluessel) => schluessel.startsWith('trisar-last-read-'))
      .forEach((schluessel) => localStorage.removeItem(schluessel));
  } catch (fehler) { /* kein localStorage, dann gibt es auch keinen Lesestand */ }
})();

const uuid = () =>
  (globalThis.crypto?.randomUUID
    ? globalThis.crypto.randomUUID()
    : 'demo-' + Math.random().toString(36).slice(2) + Date.now().toString(36));

const cmp = (a, b) => {
  if (a == null && b == null) return 0;
  if (a == null) return -1;
  if (b == null) return 1;
  const na = Number(a);
  const nb = Number(b);
  if (!Number.isNaN(na) && !Number.isNaN(nb) && String(a).trim() !== '' && String(b).trim() !== '') {
    return na - nb;
  }
  return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
};

const looseEq = (a, b) => {
  if (a === b) return true;
  if (a == null || b == null) return false;
  return String(a) === String(b);
};

const ilikeToRegex = (pattern) =>
  new RegExp('^' + String(pattern).replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.') + '$', 'i');

class DemoQuery {
  constructor(table) {
    this.table = table;
    this.filters = [];
    this.orderBys = [];
    this.limitN = null;
    this.rangeFromTo = null;
    this.mode = 'select';
    this.payload = null;
    this.upsertOptions = null;
    this.wantSingle = false;
    this.wantMaybeSingle = false;
    this.returning = false;
    this.selectStr = '*';
    this.countMode = null;
    this.headOnly = false;
  }

  select(cols = '*', opts = {}) {
    if (this.mode === 'select') {
      this.selectStr = cols || '*';
      if (opts.count) this.countMode = opts.count;
      if (opts.head) this.headOnly = true;
    } else {
      this.returning = true;
      this.selectStr = cols || '*';
    }
    return this;
  }

  insert(rows) { this.mode = 'insert'; this.payload = rows; return this; }
  update(values) { this.mode = 'update'; this.payload = values; return this; }
  upsert(rows, opts = {}) { this.mode = 'upsert'; this.payload = rows; this.upsertOptions = opts; return this; }
  delete() { this.mode = 'delete'; return this; }

  eq(col, val) { this.filters.push((r) => looseEq(r[col], val)); return this; }
  neq(col, val) { this.filters.push((r) => !looseEq(r[col], val)); return this; }
  is(col, val) { this.filters.push((r) => r[col] === val || (val === null && r[col] == null)); return this; }
  in(col, vals) {
    const set = new Set((vals || []).map((v) => String(v)));
    this.filters.push((r) => r[col] != null && set.has(String(r[col])));
    return this;
  }
  gt(col, val) { this.filters.push((r) => cmp(r[col], val) > 0); return this; }
  gte(col, val) { this.filters.push((r) => cmp(r[col], val) >= 0); return this; }
  lt(col, val) { this.filters.push((r) => cmp(r[col], val) < 0); return this; }
  lte(col, val) { this.filters.push((r) => cmp(r[col], val) <= 0); return this; }
  like(col, pattern) { const re = ilikeToRegex(pattern); this.filters.push((r) => re.test(String(r[col] ?? ''))); return this; }
  ilike(col, pattern) { return this.like(col, pattern); }
  match(obj) {
    Object.entries(obj || {}).forEach(([k, v]) => this.eq(k, v));
    return this;
  }
  contains(col, value) {
    this.filters.push((r) => {
      const cell = r[col];
      if (Array.isArray(cell) && Array.isArray(value)) return value.every((v) => cell.map(String).includes(String(v)));
      if (cell && typeof cell === 'object' && value && typeof value === 'object') {
        return Object.entries(value).every(([k, v]) => looseEq(cell[k], v));
      }
      return false;
    });
    return this;
  }
  overlaps(col, vals) {
    const set = new Set((vals || []).map(String));
    this.filters.push((r) => Array.isArray(r[col]) && r[col].some((v) => set.has(String(v))));
    return this;
  }
  not(col, op, val) {
    if (op === 'is') this.filters.push((r) => !(r[col] === val || (val === null && r[col] == null)));
    else if (op === 'eq') this.filters.push((r) => !looseEq(r[col], val));
    return this;
  }
  or() { return this; } // Demo: OR-Filter ungefiltert durchlassen

  order(col, opts = {}) { this.orderBys.push({ col, ascending: opts.ascending !== false }); return this; }
  limit(n) { this.limitN = n; return this; }
  range(from, to) { this.rangeFromTo = [from, to]; return this; }
  single() { this.wantSingle = true; return this; }
  maybeSingle() { this.wantMaybeSingle = true; return this; }
  throwOnError() { return this; }

  _rows() {
    if (!store[this.table]) store[this.table] = [];
    return store[this.table];
  }

  _filtered() {
    return this._rows().filter((r) => this.filters.every((f) => f(r)));
  }

  _embed(rows) {
    if (!/\(/.test(this.selectStr)) return rows;
    let out = rows;
    // Spezialfall: auth_user:auth.users(email) auf profiles
    if (/auth\.users/.test(this.selectStr)) {
      out = out.map((r) => ({ ...r, auth_user: { email: r.email ?? null } }));
    }
    // Generische Fremdschlüssel-Embeds wie vehicles:vehicle_id(license_plate)
    const embeds = [...this.selectStr.matchAll(/([a-zA-Z_]+):([a-zA-Z_]+_id)\(([^)]*)\)/g)];
    if (embeds.length) {
      out = out.map((row) => {
        const next = { ...row };
        embeds.forEach(([, alias, fkCol]) => {
          const table = `${fkCol.slice(0, -3)}s`;
          const target = (store[table] || []).find((r) => String(r?.id) === String(row?.[fkCol]));
          next[alias] = target ? { ...target } : null;
        });
        return next;
      });
    }
    return out;
  }

  _finalize(rows) {
    let out = this._embed(clone(rows));
    for (let i = this.orderBys.length - 1; i >= 0; i -= 1) {
      const { col, ascending } = this.orderBys[i];
      out.sort((a, b) => (ascending ? cmp(a[col], b[col]) : cmp(b[col], a[col])));
    }
    if (this.rangeFromTo) out = out.slice(this.rangeFromTo[0], this.rangeFromTo[1] + 1);
    if (this.limitN != null) out = out.slice(0, this.limitN);
    return out;
  }

  _execute() {
    try {
      if (this.mode === 'select') {
        const rows = this._finalize(this._filtered());
        const count = this.countMode ? rows.length : null;
        if (this.headOnly) return { data: null, error: null, count };
        if (this.wantSingle) {
          if (rows.length === 0) {
            return { data: null, error: { code: 'PGRST116', message: 'Row not found (Demo)' }, count };
          }
          return { data: rows[0], error: null, count };
        }
        if (this.wantMaybeSingle) return { data: rows[0] ?? null, error: null, count };
        return { data: rows, error: null, count };
      }

      if (this.mode === 'insert') {
        const rows = (Array.isArray(this.payload) ? this.payload : [this.payload]).map((r) => {
          const row = { ...r };
          if (row.id == null) row.id = uuid();
          if (row.created_at == null) row.created_at = new Date().toISOString();
          return row;
        });
        this._rows().push(...clone(rows));
        return this._returnMutation(rows);
      }

      if (this.mode === 'update') {
        const targets = this._filtered();
        targets.forEach((r) => Object.assign(r, clone(this.payload), { updated_at: new Date().toISOString() }));
        return this._returnMutation(targets);
      }

      if (this.mode === 'upsert') {
        const conflictCols = String(this.upsertOptions?.onConflict || 'id').split(',').map((s) => s.trim());
        const rows = Array.isArray(this.payload) ? this.payload : [this.payload];
        const touched = [];
        rows.forEach((incoming) => {
          const existing = this._rows().find((r) => conflictCols.every((c) => looseEq(r[c], incoming[c])));
          if (existing) {
            Object.assign(existing, clone(incoming), { updated_at: new Date().toISOString() });
            touched.push(existing);
          } else {
            const row = { id: incoming.id ?? uuid(), created_at: new Date().toISOString(), ...clone(incoming) };
            this._rows().push(row);
            touched.push(row);
          }
        });
        return this._returnMutation(touched);
      }

      if (this.mode === 'delete') {
        const targets = new Set(this._filtered());
        const removed = [...targets];
        store[this.table] = this._rows().filter((r) => !targets.has(r));
        return this._returnMutation(removed);
      }

      return { data: null, error: { message: `Demo: unbekannter Modus ${this.mode}` } };
    } catch (err) {
      return { data: null, error: { message: err?.message || 'Demo-Fehler' } };
    }
  }

  _returnMutation(rows) {
    if (!this.returning) return { data: null, error: null, count: rows.length };
    const out = clone(rows);
    if (this.wantSingle || this.wantMaybeSingle) return { data: out[0] ?? null, error: null };
    return { data: out, error: null };
  }

  then(resolve, reject) { return Promise.resolve(this._execute()).then(resolve, reject); }
  catch(fn) { return this.then((v) => v, fn); }
  finally(fn) { return this.then().finally(fn); }
}

// --- Auth ---------------------------------------------------------------

const DEMO_DRIVER_ID = '0012ce3e-dc52-423a-824d-39ab4ce592c7';
const demoProfile = store.profiles.find((p) => p.id === DEMO_DRIVER_ID) || {};
const DEMO_USER = {
  id: DEMO_DRIVER_ID,
  email: demoProfile.email || 'demo@trisar-demo.de',
  user_metadata: {
    full_name: [demoProfile.first_name, demoProfile.last_name].filter(Boolean).join(' ') || 'Demo Nutzer',
  },
};

const buildSession = () => ({
  access_token: 'demo-token',
  token_type: 'bearer',
  user: DEMO_USER,
});

const authListeners = new Set();

const demoAuth = {
  async getSession() { return { data: { session: buildSession() }, error: null }; },
  async getUser() { return { data: { user: DEMO_USER }, error: null }; },
  async signInWithPassword() {
    const session = buildSession();
    authListeners.forEach((cb) => cb('SIGNED_IN', session));
    return { data: { session, user: DEMO_USER }, error: null };
  },
  async signOut() {
    authListeners.forEach((cb) => cb('SIGNED_OUT', null));
    return { error: null };
  },
  onAuthStateChange(cb) {
    authListeners.add(cb);
    setTimeout(() => cb('SIGNED_IN', buildSession()), 0);
    return { data: { subscription: { unsubscribe: () => authListeners.delete(cb) } } };
  },
  async resetPasswordForEmail() { return { data: {}, error: null }; },
  // Admin-API (Fahrer erstellen/bearbeiten): liefert Nutzer aus den Demo-Profilen
  admin: {
    async getUserById(id) {
      const profile = store.profiles.find((p) => String(p?.id || '') === String(id || ''));
      if (!profile) return { data: { user: null }, error: { message: 'User nicht gefunden (Demo)' } };
      return { data: { user: { id: profile.id, email: profile.email || 'demo@trisar-demo.de' } }, error: null };
    },
    async createUser(attributes) {
      return { data: { user: { id: uuid(), email: attributes?.email || 'neu@trisar-demo.de' } }, error: null };
    },
    async inviteUserByEmail(email) {
      return { data: { user: { id: uuid(), email } }, error: null };
    },
  },
  async updateUser() { return { data: { user: DEMO_USER }, error: null }; },
  async verifyOtp() { return { data: { session: buildSession(), user: DEMO_USER }, error: null }; },
  async exchangeCodeForSession() { return { data: { session: buildSession() }, error: null }; },
};

// --- Edge Functions / RPC / Realtime ------------------------------------

const DEMO_UNAVAILABLE = 'Demo-Modus: externe Live-Dienste sind in dieser Vorschau deaktiviert.';

const demoFunctions = {
  async invoke(name) {
    const n = String(name || '');
    if (/external-sync|externalSync/i.test(n)) return { data: { ok: true, synced: 0, demo: true }, error: null };
    if (/places/i.test(n)) return { data: { predictions: [] }, error: null };
    return { data: null, error: { message: DEMO_UNAVAILABLE } };
  },
};

const makeChannel = (name) => {
  const channel = {
    topic: name,
    on() { return channel; },
    subscribe(cb) {
      if (typeof cb === 'function') setTimeout(() => cb('SUBSCRIBED'), 0);
      return channel;
    },
    unsubscribe() { return Promise.resolve('ok'); },
  };
  return channel;
};

const makeClient = () => ({
  from: (table) => new DemoQuery(table),
  rpc: async () => ({ data: [], error: null }),
  auth: demoAuth,
  functions: demoFunctions,
  channel: makeChannel,
  removeChannel: () => Promise.resolve('ok'),
  removeAllChannels: () => Promise.resolve('ok'),
  storage: {
    from: () => ({
      upload: async () => ({ data: null, error: { message: DEMO_UNAVAILABLE } }),
      getPublicUrl: () => ({ data: { publicUrl: '' } }),
      download: async () => ({ data: null, error: { message: DEMO_UNAVAILABLE } }),
    }),
  },
});

export const demoSupabase = makeClient();
export const demoStore = store;
export const DEMO_MODE = true;
