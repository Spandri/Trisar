// Vorhandener Dienst (driver_service_requests + dienst_pausen + dienst_aenderung + dienst_treffpunkt) fuer Dienste planen.
import { supabase } from '../services/supabase';

// Vorhandener Dienst eines Fahrers an einem Tag (letzte nicht abgelehnte Zeile) mit Pausen und
// gemerktem angenommenem Stand. Fuer das Vorausfuellen bei genau einem Fahrer und einem Tag.
export async function dienstBestandLaden(fahrerId, tag) {
  const { data } = await supabase.from('driver_service_requests')
    .select('id, service_start_time, service_end_time, status, created_at')
    .eq('driver_id', fahrerId).eq('service_date', tag).order('created_at', { ascending: false }).limit(5);
  const d = (data || []).find((x) => String(x.status || '').toLowerCase() !== 'refused');
  if (!d) return null;
  const [{ data: p }, { data: a }, { data: tp }] = await Promise.all([
    supabase.from('dienst_pausen').select('pausen').eq('dienst_id', d.id).maybeSingle(),
    supabase.from('dienst_aenderung').select('vorher').eq('dienst_id', d.id).maybeSingle(),
    // Treffpunkt und Notiz (dienst_treffpunkt). Fehlt die Tabelle noch, bleibt es leer.
    supabase.from('dienst_treffpunkt').select('ort_id, name, adresse, notiz').eq('dienst_id', d.id).maybeSingle()
      .then((r) => r, () => ({ data: null })),
  ]);
  const hm = (x) => String(x || '').slice(0, 5);
  const pausenVon = (liste) => (Array.isArray(liste) ? liste : []).map((x) => ({ von: hm(x.von), bis: hm(x.bis) })).filter((x) => x.von && x.bis);
  return {
    id: d.id,
    start: hm(d.service_start_time),
    ende: hm(d.service_end_time),
    pausen: pausenVon(p?.pausen),
    treffpunkt: tp ? { text: tp.ort_id ? (tp.name || '') : (tp.adresse || tp.name || ''), ortId: tp.ort_id || '' } : { text: '', ortId: '' },
    notiz: tp?.notiz || '',
    angenommen: String(d.status || '').toLowerCase() === 'accepted',
    vorher: a?.vorher ? { start: hm(a.vorher.start), ende: hm(a.vorher.ende), pausen: pausenVon(a.vorher.pausen) } : null,
  };
}
export const pausenText = (liste) => JSON.stringify((liste || []).filter((p) => p.von && p.bis).map((p) => [p.von, p.bis]));

