// Woher die App ihre Daten holt. Wird beim Bauen festgelegt:
//   VITE_DATENQUELLE=demo      In-Memory-Mock mit simulierten Daten (demo/demoClient.js),
//                              Datums-Auto-Shift, Tutorial-Rahmen. Standard.
//   VITE_DATENQUELLE=supabase  echtes Supabase (VITE_SUPABASE_URL, Keys aus .env.local).
// Standard ist die Demo, damit kein Build versehentlich gegen eine Datenbank laeuft.
// Direkter Vergleich, damit Vite den nicht genutzten Zweig beim Bauen entfernt.
export const DEMO_MODE = import.meta.env.VITE_DATENQUELLE !== 'supabase';
