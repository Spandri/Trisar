// Glocke je Fahrt (17.11.2026): Die Dispo wischt eine Fahrt auf und tippt die Glocke. Dann bekommt sie
// zu dieser Fahrt Meldungen (beim Gast, mit Gast unterwegs, 5 min vor Ankunft, angekommen). Die Karte
// zeigt oben rechts eine kleine Glocke. Nochmal tippen nimmt sie wieder weg.
// Tabelle fahrt_glocke je Konto, Meldungen schickt der push-dienst (push_fahrt_glocke).
// Migration 20261117180000_fahrt_glocke.
import { useSyncExternalStore } from 'react';
import { supabase } from '../services/supabase';
import { DEMO_MODE } from '../datenquelle';

let glocken = new Set();
let geladen = false;
const hoerer = new Set();
const melden = () => hoerer.forEach((fn) => fn());
const abonnieren = (fn) => { hoerer.add(fn); return () => hoerer.delete(fn); };

const nutzerId = async () => {
  const { data } = await supabase.auth.getSession();
  return data?.session?.user?.id || null;
};

let ladeVersprechen = null;
export const glockenLaden = () => {
  if (DEMO_MODE || geladen) return Promise.resolve();
  if (ladeVersprechen) return ladeVersprechen;
  ladeVersprechen = (async () => {
    const uid = await nutzerId();
    if (!uid) return;
    const { data, error } = await supabase.from('fahrt_glocke').select('job_id').eq('user_id', uid);
    if (error) return; // Migration fehlt noch
    glocken = new Set((data || []).map((z) => String(z.job_id)));
    geladen = true;
    melden();
  })().finally(() => { ladeVersprechen = null; });
  return ladeVersprechen;
};

// Glocke an oder aus. Sofort sichtbar, bei Fehler zurueck.
export const glockeUmschalten = async (jobId) => {
  const id = String(jobId || '');
  if (!id || DEMO_MODE) return;
  const uid = await nutzerId();
  if (!uid) return;
  const war = glocken.has(id);
  const neu = new Set(glocken);
  if (war) neu.delete(id); else neu.add(id);
  glocken = neu;
  melden();
  const { error } = war
    ? await supabase.from('fahrt_glocke').delete().eq('user_id', uid).eq('job_id', id)
    : await supabase.from('fahrt_glocke').insert({ user_id: uid, job_id: id });
  if (error) {
    const zurueck = new Set(glocken);
    if (war) zurueck.add(id); else zurueck.delete(id);
    glocken = zurueck;
    melden();
  }
};

export const useGlocken = () => useSyncExternalStore(abonnieren, () => glocken);
