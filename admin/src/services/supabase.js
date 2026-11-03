// Datenquelle je nach Build (siehe ../datenquelle.js): Demo-Mock oder echtes Supabase.
import { createClient } from '@supabase/supabase-js';
import { demoSupabase } from '../demo/demoClient.js';
import { DEMO_MODE } from '../datenquelle.js';

const envOrDefault = (value, fallback) => {
  if (!value) return fallback;
  if (typeof value === 'string' && value.trim().toLowerCase().startsWith('your_')) return fallback;
  return value;
};
const normalizeEnvValue = (value) => {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (trimmed.toLowerCase().startsWith('your_')) return '';
  return trimmed;
};

const createLiveClients = () => {
  const SUPABASE_URL = envOrDefault(import.meta.env.VITE_SUPABASE_URL, 'http://localhost:54321');
  const RESOLVED_SUPABASE_URL = SUPABASE_URL.startsWith('/')
    ? `${window.location.origin}${SUPABASE_URL}`
    : SUPABASE_URL;
  // Nur der oeffentliche Schluessel kommt in den Browser. Rechte bekommt die
  // Disposition ueber ihre Anmeldung (AnmeldeTor) und die Regeln in der DB,
  // Admin-Aufgaben wie Fahrer einladen laufen ueber die Funktion dispo-admin.
  const SUPABASE_ANON_KEY = normalizeEnvValue(import.meta.env.VITE_SUPABASE_ANON_KEY);
  const client = createClient(RESOLVED_SUPABASE_URL, SUPABASE_ANON_KEY || 'fehlt');
  const hasConfig = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
  return {
    hasConfig,
    hasAdminConfig: hasConfig,
    client,
    // Frueher ein eigener Client mit service_role-Schluessel. Jetzt derselbe
    // angemeldete Client, damit die vielen Rueckfall-Stellen weiter laufen.
    admin: client,
  };
};

const live = DEMO_MODE ? null : createLiveClients();

export const hasSupabaseConfig = DEMO_MODE ? true : live.hasConfig;
export const hasSupabaseAdminConfig = DEMO_MODE ? true : live.hasAdminConfig;

export const supabase = DEMO_MODE ? demoSupabase : live.client;
export const supabaseAdmin = DEMO_MODE ? demoSupabase : live.admin;
// Disposition abmelden (Einstellungen). Das AnmeldeTor zeigt danach wieder den Login.
export const abmelden = () => supabase.auth.signOut();
export { DEMO_MODE };
