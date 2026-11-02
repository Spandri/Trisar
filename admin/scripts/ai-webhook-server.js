import fs from 'fs';
import http from 'http';
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

const getEnv = (key, fallback = '') => process.env[key] || fallback;

const SUPABASE_URL = getEnv('VITE_SUPABASE_URL', getEnv('SUPABASE_URL', ''));
const SUPABASE_KEY = getEnv('VITE_SUPABASE_KEY', getEnv('SUPABASE_SERVICE_ROLE_KEY', ''));
const OLLAMA_URL = (getEnv('VITE_OLLAMA_URL', 'http://localhost:11434').startsWith('/'))
  ? 'http://localhost:11434'
  : getEnv('VITE_OLLAMA_URL', 'http://localhost:11434');
const OLLAMA_EMBED_MODEL = getEnv('VITE_OLLAMA_EMBED_MODEL', 'nomic-embed-text');
const PORT = Number.parseInt(getEnv('AI_WEBHOOK_PORT', '8787'), 10);

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Fehlende Supabase Config. Setze VITE_SUPABASE_URL und VITE_SUPABASE_KEY in .env.local');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const fetchEmbedding = async (text) => {
  const response = await fetch(`${OLLAMA_URL.replace(/\/$/, '')}/api/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: OLLAMA_EMBED_MODEL, prompt: text }),
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

const buildDocFromRow = (table, row) => {
  if (!row) return null;
  if (table === 'profiles') {
    return {
      source_table: 'profiles',
      source_id: String(row.id),
      content: `Fahrer ${row.first_name || ''} ${row.last_name || ''} | Telefon ${row.phone || ''} | Fahrernummer ${row.driver_number ?? ''} | Rolle ${row.role ?? ''} | Fahrzeug ${row.vehicle_id ?? ''}`.trim(),
      meta: { role: row.role ?? null, driver_number: row.driver_number ?? null, vehicle_id: row.vehicle_id ?? null },
    };
  }
  if (table === 'vehicles') {
    return {
      source_table: 'vehicles',
      source_id: String(row.id),
      content: `Fahrzeug ${row.license_plate || ''} ${row.brand_model || ''} ${row.trim || ''} Farbe ${row.color || ''}`.trim(),
      meta: { license_plate: row.license_plate || '', color: row.color || '' },
    };
  }
  if (table === 'jobs') {
    return {
      source_table: 'jobs',
      source_id: String(row.id),
      content: `Fahrt am ${row.ride_date || ''} ${row.etd || ''} | Status ${row.status || ''} | Fahrer ${row.driver_id || ''} | Konvoi ${row.convoy_id || ''} | Abholung ${row.pickup_name || ''} ${row.pickup_address || ''} | Ziel ${row.dropoff_name || ''} ${row.dropoff_address || ''} | Passagiere ${row.passengers ?? ''} | Anonyme Gäste ${row.anonymous_guests ?? ''}`.trim(),
      meta: { ride_date: row.ride_date || '', status: row.status || '' },
    };
  }
  if (table === 'guests') {
    return {
      source_table: 'guests',
      source_id: String(row.id),
      content: `Gast ${row.first_name || ''} ${row.last_name || ''} | Telefon ${row.phone || ''} | Adresse ${row.address || ''}`.trim(),
      meta: { phone: row.phone || '' },
    };
  }
  if (table === 'driver_live_locations') {
    return {
      source_table: 'driver_live_locations',
      source_id: `${row.driver_id || ''}:${row.captured_at || ''}`,
      content: `Fahrer ${row.driver_id || ''} Standort ${row.lat ?? ''},${row.lng ?? ''} | Zeit ${row.captured_at || ''} | Aktive Fahrt ${row.active_job_id || ''}`.trim(),
      meta: { driver_id: row.driver_id || null, active_job_id: row.active_job_id || null },
    };
  }
  if (table === 'job_notes') {
    return {
      source_table: 'job_notes',
      source_id: String(row.id),
      content: `Notiz zu Fahrt ${row.job_id || ''}: ${row.note || ''}`.trim(),
      meta: { job_id: row.job_id || null },
    };
  }
  if (table === 'job_guests') {
    return {
      source_table: 'job_guests',
      source_id: `${row.job_id || ''}:${row.guest_id || ''}`,
      content: `Fahrt ${row.job_id || ''} Gast ${row.guest_id || ''} | Hauptkontakt ${row.is_main_contact ? 'ja' : 'nein'}`.trim(),
      meta: { job_id: row.job_id || null, guest_id: row.guest_id || null },
    };
  }
  if (table === 'convoy_assignments') {
    return {
      source_table: 'convoy_assignments',
      source_id: `${row.job_id || ''}:${row.driver_id || ''}`,
      content: `Konvoi Zuweisung Fahrt ${row.job_id || ''} Fahrer ${row.driver_id || ''} | Status ${row.response_status || ''}`.trim(),
      meta: { job_id: row.job_id || null, driver_id: row.driver_id || null },
    };
  }
  if (table === 'convoys') {
    return {
      source_table: 'convoys',
      source_id: String(row.id),
      content: `Konvoi ${row.name || ''}`.trim(),
      meta: { name: row.name || '' },
    };
  }
  return null;
};

const upsertDoc = async (doc) => {
  const embedding = await fetchEmbedding(doc.content);
  const { error } = await supabase
    .from('ai_documents')
    .upsert({ ...doc, embedding }, { onConflict: 'source_table,source_id' });
  if (error) throw error;
};

const deleteDoc = async (doc) => {
  if (!doc) return;
  const { error } = await supabase
    .from('ai_documents')
    .delete()
    .eq('source_table', doc.source_table)
    .eq('source_id', doc.source_id);
  if (error) throw error;
};

const server = http.createServer(async (req, res) => {
  if (req.method !== 'POST' || req.url !== '/webhook') {
    res.writeHead(404);
    res.end('Not found');
    return;
  }

  let body = '';
  req.on('data', (chunk) => { body += chunk; });
  req.on('end', async () => {
    try {
      const payload = JSON.parse(body || '{}');
      const table = payload.table;
      const type = payload.type;
      const record = payload.record || payload.new_record || null;
      const oldRecord = payload.old_record || null;

      const doc = buildDocFromRow(table, record);
      const oldDoc = buildDocFromRow(table, oldRecord);

      if (type === 'DELETE') {
        await deleteDoc(oldDoc || doc);
      } else {
        if (doc) await upsertDoc(doc);
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: error?.message || 'Unknown error' }));
    }
  });
});

server.listen(PORT, () => {
  console.log(`AI webhook server läuft auf http://localhost:${PORT}/webhook`);
});
