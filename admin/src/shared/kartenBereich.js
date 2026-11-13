// Eigener Kartenbereich der Dispo (13.11.): frei gezeichneter Umriss, auf den "Maps" zoomt.
// Persoenlich, in public.dispo_kartenbereich (eine Zeile je Benutzer). Gleich in iOS und Android.
import { useEffect, useState } from 'react';
import { supabase } from '../services/supabase';
import { DEMO_MODE } from '../datenquelle';

const SPEICHER = 'trisar_kartenbereich_v1';
let punkte = null;
const hoerer = new Set();
const melden = () => hoerer.forEach((h) => h(punkte));

const gueltig = (liste) => (Array.isArray(liste)
  ? liste.filter((p) => Array.isArray(p) && Number.isFinite(Number(p[0])) && Number.isFinite(Number(p[1])))
    .map((p) => [Number(p[0]), Number(p[1])])
  : []);

const lokalLesen = () => {
  try { const w = gueltig(JSON.parse(localStorage.getItem(SPEICHER) || 'null')); return w.length >= 3 ? w : null; } catch { return null; }
};
const lokalSchreiben = (w) => {
  try { if (w) localStorage.setItem(SPEICHER, JSON.stringify(w)); else localStorage.removeItem(SPEICHER); } catch { /* egal */ }
};

punkte = lokalLesen();

const benutzer = async () => (await supabase.auth.getUser()).data?.user?.id || null;

export const kartenBereich = {
  lesen: () => punkte,
  abonnieren: (h) => { hoerer.add(h); return () => hoerer.delete(h); },
  laden: async () => {
    if (DEMO_MODE) return punkte;
    const id = await benutzer();
    if (!id) return punkte;
    const { data, error } = await supabase.from('dispo_kartenbereich').select('punkte').eq('user_id', id).maybeSingle();
    if (error) return punkte;
    const w = gueltig(data?.punkte);
    punkte = w.length >= 3 ? w : null;
    lokalSchreiben(punkte);
    melden();
    return punkte;
  },
  // Gibt eine Fehlermeldung zurueck oder null.
  speichern: async (neu) => {
    const w = gueltig(neu).map(([lng, lat]) => [Math.round(lng * 1e6) / 1e6, Math.round(lat * 1e6) / 1e6]);
    if (w.length < 3) return 'Bereich zu klein.';
    punkte = w; lokalSchreiben(w); melden();
    if (DEMO_MODE) return null;
    const id = await benutzer();
    if (!id) return 'Nicht angemeldet.';
    const { error } = await supabase.from('dispo_kartenbereich')
      .upsert({ user_id: id, punkte: w, aktualisiert: new Date().toISOString() }, { onConflict: 'user_id' });
    return error ? error.message : null;
  },
  loeschen: async () => {
    punkte = null; lokalSchreiben(null); melden();
    if (DEMO_MODE) return null;
    const id = await benutzer();
    if (!id) return null;
    const { error } = await supabase.from('dispo_kartenbereich').delete().eq('user_id', id);
    return error ? error.message : null;
  },
};

export const useKartenBereich = () => {
  const [w, setW] = useState(punkte);
  useEffect(() => {
    const ab = kartenBereich.abonnieren(setW);
    kartenBereich.laden();
    return ab;
  }, []);
  return w;
};

// Linie aus Bildschirmpunkten ausduennen: Punkte naeher als `abstand` px fallen weg, hoechstens `max` bleiben.
export const pfadAusduennen = (pfad, abstand = 6, max = 240) => {
  const aus = [];
  for (const p of pfad) {
    const l = aus[aus.length - 1];
    if (!l || Math.hypot(p.x - l.x, p.y - l.y) >= abstand) aus.push(p);
  }
  if (aus.length <= max) return aus;
  const schritt = aus.length / max;
  return Array.from({ length: max }, (_, i) => aus[Math.floor(i * schritt)]);
};
