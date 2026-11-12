// Standby am Event-Ort in der Fahrer-App (Tabellen standby, standby_fahrer; Funktionen standby_antworten,
// standby_melden). Gleiche Logik in iOS (StandbySpeicher) und Android (StandbySpeicher.kt).

import { useCallback, useEffect, useState } from 'react';
import { supabase } from './supabase/client';
import { DEMO_MODE } from '../datenquelle';

export const hm = (wert) => String(wert || '').slice(0, 5);

// Ende des Standby (fuer den Fahrer): eigene Zeiten nach abgelehnter Aenderung, Nacht ueber Mitternacht.
export const standbyEnde = (s) => {
  const von = hm(s.von_eigen || s.von);
  const bis = hm(s.bis_eigen || s.bis);
  const ende = new Date(`${s.datum}T${bis}:00`);
  if (bis <= von) ende.setDate(ende.getDate() + 1);
  return ende;
};
export const standbyBeginn = (s) => new Date(`${s.datum}T${hm(s.von_eigen || s.von)}:00`);

// Eigene Standbys (angefragt oder angenommen, Ende nicht vorbei), live.
export const useFahrerStandbys = (fahrerId) => {
  const [liste, setListe] = useState([]);
  const [stand, setStand] = useState(0);
  const laden = useCallback(() => setStand((n) => n + 1), []);

  useEffect(() => {
    let aktiv = true;
    if (DEMO_MODE || !fahrerId) { Promise.resolve().then(() => { if (aktiv) setListe([]); }); return () => { aktiv = false; }; }
    (async () => {
      const { data: f, error } = await supabase.from('standby_fahrer').select('*').eq('driver_id', fahrerId).in('status', ['pending', 'accepted']);
      if (error) { if (aktiv) setListe([]); return; }
      const ids = (f || []).map((x) => x.standby_id);
      const { data: s } = ids.length ? await supabase.from('standby').select('*').in('id', ids) : { data: [] };
      const je = new Map((s || []).map((x) => [x.id, x]));
      if (!aktiv) return;
      setListe((f || []).map((x) => ({ ...je.get(x.standby_id), ...x, id: x.standby_id })).filter((x) => x.datum)
        .filter((x) => standbyEnde(x).getTime() > Date.now() - 2 * 3600000)
        .sort((a, b) => standbyBeginn(a) - standbyBeginn(b)));
    })();
    return () => { aktiv = false; };
  }, [fahrerId, stand]);

  useEffect(() => {
    if (DEMO_MODE || !fahrerId) return undefined;
    const kanal = supabase.channel(`fahrer-standby-${fahrerId}-${Date.now()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'standby_fahrer', filter: `driver_id=eq.${fahrerId}` }, laden)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'standby' }, laden)
      .subscribe();
    const sichtbar = () => { if (document.visibilityState === 'visible') laden(); };
    document.addEventListener('visibilitychange', sichtbar);
    return () => { supabase.removeChannel(kanal); document.removeEventListener('visibilitychange', sichtbar); };
  }, [fahrerId, laden]);

  const antworten = useCallback(async (id, annehmen) => {
    const { error } = await supabase.rpc('standby_antworten', { p_standby: id, p_annehmen: annehmen });
    if (error) window.alert(`Standby konnte nicht gespeichert werden: ${error.message}`);
    laden();
  }, [laden]);

  const melden = useCallback(async (id, art) => {
    // Sofort anzeigen, die Datenbank bestaetigt per Realtime.
    const neu = { gast_drin: 'mit_gast', abgesetzt: 'rueckweg', zurueck: 'vor_ort' }[art];
    setListe((alt) => alt.map((x) => (x.id === id ? { ...x, zustand: neu, zustand_seit: new Date().toISOString() } : x)));
    const { error } = await supabase.rpc('standby_melden', { p_standby: id, p_art: art });
    if (error) window.alert(`Konnte nicht gespeichert werden: ${error.message}`);
    laden();
  }, [laden]);

  return { liste, laden, antworten, melden };
};

// Hoehe der Karte samt Knoepfen (fuer die feste Liste der Fahrer-App).
export const STANDBY_KARTE = 198;
export const STANDBY_ZUSTAND_ZEILE = 37;
export const standbyVorbei = (s) => standbyEnde(s).getTime() <= Date.now();
export const standbyBlockHoehe = (s) => {
  if (s.status === 'pending') return STANDBY_KARTE + 12 + 51;
  if (standbyVorbei(s)) return STANDBY_KARTE;
  if (s.zustand === 'mit_gast') return STANDBY_KARTE + STANDBY_ZUSTAND_ZEILE + 12 + 56;
  if (s.zustand === 'vor_ort') return STANDBY_KARTE + 12 + 56;
  if (s.zustand === 'rueckweg') return STANDBY_KARTE + 12 + 51;
  return STANDBY_KARTE;
};
