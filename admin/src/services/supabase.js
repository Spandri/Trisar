// DEMO-VORSCHAU: statt echtem Supabase läuft hier ein In-Memory-Mock
// mit simulierten Daten. Kein Backend, keine Keys, keine Persistenz.
import { demoSupabase, DEMO_MODE } from '../demo/demoClient.js';

export const hasSupabaseConfig = true;
export const hasSupabaseAdminConfig = true;

export const supabase = demoSupabase;
export const supabaseAdmin = demoSupabase;
export { DEMO_MODE };
