// Datenquelle je nach Build (siehe ../datenquelle.js): Demo-Mock oder echtes Supabase.
// Google-Maps-Key kommt ausschliesslich aus der Build-Umgebung
// (VITE_GOOGLE_MAPS_API_KEY), kein Fallback im Quelltext.
import { createClient } from '@supabase/supabase-js';
import { demoSupabase } from '../demo/demoClient.js';
import { DEMO_MODE } from '../datenquelle.js';

const envOrDefault = (value, fallback) => {
  if (!value) return fallback;
  if (typeof value === 'string' && value.trim().toLowerCase().startsWith('your_')) return fallback;
  return value;
};

const createLiveClient = () => {
  const SUPABASE_URL = envOrDefault(import.meta.env.VITE_SUPABASE_URL, 'http://localhost:54321');
  const RESOLVED_SUPABASE_URL = SUPABASE_URL.startsWith('/')
    ? `${window.location.origin}${SUPABASE_URL}`
    : SUPABASE_URL;
  // Oeffentlich bekannter Service-Schluessel der lokalen Supabase-CLI (iss: supabase-demo).
  const SUPABASE_KEY = envOrDefault(
    import.meta.env.VITE_SUPABASE_KEY,
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyAgCiAgICAicm9sZSI6ICJzZXJ2aWNlX3JvbGUiLAogICAgImlzcyI6ICJzdXBhYmFzZS1kZW1vIiwKICAgICJpYXQiOiAxNjQxNzY5MjAwLAogICAgImV4cCI6IDE3OTk1MzU2MDAKfQ.DaYlNEoUrrEn2Ig7tqibS-PHK5vgusbcbo7X36XVt4Q',
  );
  return createClient(RESOLVED_SUPABASE_URL, SUPABASE_KEY);
};

export const supabase = DEMO_MODE ? demoSupabase : createLiveClient();
export { DEMO_MODE };

export const GOOGLE_MAPS_API_KEY = String(import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '').trim();
