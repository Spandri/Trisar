// DEMO-VORSCHAU: In-Memory-Mock statt echtem Supabase-Client.
// Kein Backend, keine Keys. Google-Maps-Key kommt ausschließlich aus der
// Build-Umgebung (VITE_GOOGLE_MAPS_API_KEY) — kein Fallback im Quelltext.
import { demoSupabase } from '../demo/demoClient.js';

export const supabase = demoSupabase;

export const GOOGLE_MAPS_API_KEY = String(import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '').trim();
