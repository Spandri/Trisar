import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

const ROOT = path.resolve(process.cwd());
const ENV_PATH = path.join(ROOT, '.env.local');

const loadEnvFile = (filePath) => {
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, 'utf8');
  content.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) return;
    const key = trimmed.slice(0, eqIndex).trim();
    const value = trimmed.slice(eqIndex + 1).trim().replace(/^"|"$/g, '');
    if (!process.env[key]) {
      process.env[key] = value;
    }
  });
};

loadEnvFile(ENV_PATH);

const getEnv = (key, fallback = '') => {
  const value = process.env[key];
  if (!value) return fallback;
  return value;
};

const SUPABASE_URL = getEnv('VITE_SUPABASE_URL', getEnv('SUPABASE_URL', ''));
const SUPABASE_KEY = getEnv('VITE_SUPABASE_KEY', getEnv('SUPABASE_SERVICE_ROLE_KEY', ''));
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Fehlende Supabase Config. Setze VITE_SUPABASE_URL und VITE_SUPABASE_KEY in .env.local');
  process.exit(1);
}

let OLLAMA_URL = getEnv('VITE_OLLAMA_URL', 'http://localhost:11434');
if (OLLAMA_URL.startsWith('/')) {
  OLLAMA_URL = 'http://localhost:11434';
}
const OLLAMA_EMBED_MODEL = getEnv('VITE_OLLAMA_EMBED_MODEL', 'nomic-embed-text');

const args = new Set(process.argv.slice(2));
const LIMIT_ARG = process.argv.find((arg) => arg.startsWith('--limit='));
const TABLES_ARG = process.argv.find((arg) => arg.startsWith('--tables='));
const LIMIT = LIMIT_ARG ? Number.parseInt(LIMIT_ARG.split('=')[1], 10) : null;
const ONLY_TABLES = TABLES_ARG ? TABLES_ARG.split('=')[1].split(',').map((t) => t.trim()).filter(Boolean) : null;
const DRY_RUN = args.has('--dry-run');
const TRUNCATE = args.has('--truncate');

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const fetchEmbedding = async (text) => {
  const response = await fetch(`${OLLAMA_URL.replace(/\/$/, '')}/api/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: OLLAMA_EMBED_MODEL,
      prompt: text,
    }),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(data?.error || `Ollama Embedding Fehler (${response.status})`);
  }
  if (!Array.isArray(data?.embedding) || data.embedding.length === 0) {
    throw new Error('Ollama Embedding leer.');
  }
  return data.embedding;
};

const upsertBatch = async (rows) => {
  if (!rows.length) return;
  const { error } = await supabase
    .from('ai_documents')
    .upsert(rows, { onConflict: 'source_table,source_id' });
  if (error) throw error;
};

const buildDocs = (table, rows, mapper) => {
  return rows
    .map((row) => mapper(row))
    .filter((doc) => doc && doc.content && doc.source_id);
};

const tables = [
  {
    name: 'profiles',
    select: 'id, first_name, last_name, phone, role, is_dispo, driver_number, vehicle_id',
    map: (row) => ({
      source_table: 'profiles',
      source_id: String(row.id),
      content: `Fahrer ${row.first_name || ''} ${row.last_name || ''} | Telefon ${row.phone || ''} | Fahrernummer ${row.driver_number ?? ''} | Rolle ${row.role ?? ''} | Fahrzeug ${row.vehicle_id ?? ''}`.trim(),
      meta: { role: row.role ?? null, driver_number: row.driver_number ?? null, vehicle_id: row.vehicle_id ?? null },
    }),
  },
  {
    name: 'vehicles',
    select: 'id, license_plate, brand_model, trim, color',
    map: (row) => ({
      source_table: 'vehicles',
      source_id: String(row.id),
      content: `Fahrzeug ${row.license_plate || ''} ${row.brand_model || ''} ${row.trim || ''} Farbe ${row.color || ''}`.trim(),
      meta: { license_plate: row.license_plate || '', color: row.color || '' },
    }),
  },
  {
    name: 'jobs',
    select: 'id, ride_date, etd, status, driver_id, convoy_id, pickup_name, pickup_address, dropoff_name, dropoff_address, passengers, anonymous_guests',
    map: (row) => ({
      source_table: 'jobs',
      source_id: String(row.id),
      content: `Fahrt am ${row.ride_date || ''} ${row.etd || ''} | Status ${row.status || ''} | Fahrer ${row.driver_id || ''} | Konvoi ${row.convoy_id || ''} | Abholung ${row.pickup_name || ''} ${row.pickup_address || ''} | Ziel ${row.dropoff_name || ''} ${row.dropoff_address || ''} | Passagiere ${row.passengers ?? ''} | Anonyme Gäste ${row.anonymous_guests ?? ''}`.trim(),
      meta: { ride_date: row.ride_date || '', status: row.status || '' },
    }),
  },
  {
    name: 'guests',
    select: 'id, first_name, last_name, phone, address',
    map: (row) => ({
      source_table: 'guests',
      source_id: String(row.id),
      content: `Gast ${row.first_name || ''} ${row.last_name || ''} | Telefon ${row.phone || ''} | Adresse ${row.address || ''}`.trim(),
      meta: { phone: row.phone || '' },
    }),
  },
  {
    name: 'driver_live_locations',
    select: 'driver_id, lat, lng, captured_at, active_job_id',
    map: (row) => ({
      source_table: 'driver_live_locations',
      source_id: `${row.driver_id || ''}:${row.captured_at || ''}`,
      content: `Fahrer ${row.driver_id || ''} Standort ${row.lat ?? ''},${row.lng ?? ''} | Zeit ${row.captured_at || ''} | Aktive Fahrt ${row.active_job_id || ''}`.trim(),
      meta: { driver_id: row.driver_id || null, active_job_id: row.active_job_id || null },
    }),
  },
  {
    name: 'job_notes',
    select: 'id, job_id, note',
    map: (row) => ({
      source_table: 'job_notes',
      source_id: String(row.id),
      content: `Notiz zu Fahrt ${row.job_id || ''}: ${row.note || ''}`.trim(),
      meta: { job_id: row.job_id || null },
    }),
  },
  {
    name: 'job_guests',
    select: 'job_id, guest_id, is_main_contact',
    map: (row) => ({
      source_table: 'job_guests',
      source_id: `${row.job_id || ''}:${row.guest_id || ''}`,
      content: `Fahrt ${row.job_id || ''} Gast ${row.guest_id || ''} | Hauptkontakt ${row.is_main_contact ? 'ja' : 'nein'}`.trim(),
      meta: { job_id: row.job_id || null, guest_id: row.guest_id || null },
    }),
  },
  {
    name: 'convoy_assignments',
    select: 'job_id, driver_id, response_status',
    map: (row) => ({
      source_table: 'convoy_assignments',
      source_id: `${row.job_id || ''}:${row.driver_id || ''}`,
      content: `Konvoi Zuweisung Fahrt ${row.job_id || ''} Fahrer ${row.driver_id || ''} | Status ${row.response_status || ''}`.trim(),
      meta: { job_id: row.job_id || null, driver_id: row.driver_id || null },
    }),
  },
  {
    name: 'convoys',
    select: 'id, name',
    map: (row) => ({
      source_table: 'convoys',
      source_id: String(row.id),
      content: `Konvoi ${row.name || ''}`.trim(),
      meta: { name: row.name || '' },
    }),
  },
];

const run = async () => {
  if (TRUNCATE) {
    await supabase.from('ai_documents').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    console.log('ai_documents geleert.');
  }

  const selectedTables = ONLY_TABLES
    ? tables.filter((t) => ONLY_TABLES.includes(t.name))
    : tables;

  let totalDocs = 0;
  for (const table of selectedTables) {
    const query = supabase.from(table.name).select(table.select);
    if (Number.isFinite(LIMIT) && LIMIT > 0) query.limit(LIMIT);
    const { data, error } = await query;
    if (error) throw error;

    const docs = buildDocs(table.name, data || [], table.map);
    totalDocs += docs.length;

    if (DRY_RUN) {
      console.log(`${table.name}: ${docs.length} docs`);
      continue;
    }

    const batch = [];
    for (const doc of docs) {
      const embedding = await fetchEmbedding(doc.content);
      batch.push({ ...doc, embedding });
      if (batch.length >= 50) {
        await upsertBatch(batch);
        batch.length = 0;
      }
    }
    if (batch.length) await upsertBatch(batch);
    console.log(`${table.name}: ${docs.length} docs gespeichert`);
  }

  console.log(`Fertig. Total: ${totalDocs} docs.`);
};

run().catch((error) => {
  console.error('Sync Fehler:', error?.message || error);
  process.exit(1);
});
