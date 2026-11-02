import { createClient } from '@supabase/supabase-js';

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

const SUPABASE_URL = envOrDefault(import.meta.env.VITE_SUPABASE_URL, 'http://localhost:54321');
const RESOLVED_SUPABASE_URL = SUPABASE_URL.startsWith('/')
  ? `${window.location.origin}${SUPABASE_URL}`
  : SUPABASE_URL;
const LOCAL_SUPABASE_ADMIN_JWT =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyAgCiAgICAicm9sZSI6ICJzZXJ2aXNlX3JvbGUiLAogICAgImlzcyI6ICJzdXBhYmFzZS1kZW1vIiwKICAgICJpYXQiOiAxNjQxNzY5MjAwLAogICAgImV4cCI6IDE3OTk1MzU2MDAKfQ.DaYlNEoUrrEn2Ig7tqibS-PHK5vgusbcbo7X36XVt4Q';
const isLocalSupabase = /127\.0\.0\.1:54321|localhost:54321/.test(RESOLVED_SUPABASE_URL);
const SUPABASE_ANON_KEY = envOrDefault(
  import.meta.env.VITE_SUPABASE_ANON_KEY,
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0',
);
const rawAdminKey = normalizeEnvValue(import.meta.env.VITE_SUPABASE_KEY);
const SUPABASE_ADMIN_KEY = rawAdminKey || (isLocalSupabase ? LOCAL_SUPABASE_ADMIN_JWT : SUPABASE_ANON_KEY);
const hasProvidedUrl = typeof import.meta.env.VITE_SUPABASE_URL === 'string' && import.meta.env.VITE_SUPABASE_URL.trim().length > 0;
const hasProvidedAnonKey = typeof import.meta.env.VITE_SUPABASE_ANON_KEY === 'string' && import.meta.env.VITE_SUPABASE_ANON_KEY.trim().length > 0;
const hasProvidedAdminKey = rawAdminKey.length > 0 || isLocalSupabase;
export const hasSupabaseConfig = hasProvidedUrl && hasProvidedAnonKey;
export const hasSupabaseAdminConfig = hasProvidedUrl && hasProvidedAdminKey;

export const supabase = createClient(RESOLVED_SUPABASE_URL, SUPABASE_ANON_KEY);
export const supabaseAdmin = createClient(RESOLVED_SUPABASE_URL, SUPABASE_ADMIN_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
});
