// Standby am Event-Ort (Tabellen standby, standby_fahrer, standby_ereignis, Migration 20261112060000).
// Laden mit Realtime, Anlegen, Zeiten aendern, Fahrer dazu/weg, Loeschen. Gleiche Logik in iOS und Android.

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../services/supabase';
import { DEMO_MODE } from '../datenquelle';

export const STANDBY_LIME = '#E3F654';
export const STANDBY_ROT = '#FF6F63';
export const STANDBY_ORANGE = '#FFCD8A';
export const STANDBY_GRAU = '#868687';

const heuteBerlin = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' });
export const hm = (wert) => String(wert || '').slice(0, 5);
export const uhrIso = (iso) => (iso ? new Date(iso).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' }) : '');

// Zustand eines Fahrers als Text und Farbe (Dispo-Uebersicht).
export const zustandAnzeige = (f) => {
  if (f.status === 'pending') return { text: f.vorher ? 'Änderung angefragt' : 'Angefragt', farbe: STANDBY_GRAU };
  if (f.status === 'refused') return { text: 'Abgelehnt', farbe: STANDBY_ROT };
  const seit = f.zustand_seit ? ` seit ${uhrIso(f.zustand_seit)}` : '';
  if (f.zustand === 'vor_ort') return { text: `Vor Ort${seit}`, farbe: STANDBY_LIME };
  if (f.zustand === 'mit_gast') return { text: `Mit Gast${seit}`, farbe: STANDBY_ORANGE };
  if (f.zustand === 'rueckweg') return { text: `Auf Rückweg${seit}`, farbe: STANDBY_LIME };
  return { text: 'Angenommen', farbe: STANDBY_LIME };
};

// Fahrerzeile "Vorname Nachname (12)" aus FahrerAutocomplete einer Profil-ID zuordnen.
export const fahrerIdFinden = (wert, profile) => {
  const text = String(wert || '').trim();
  if (!text) return null;
  const nr = text.match(/\((\d+)\)\s*$/)?.[1] || (/^\d+$/.test(text) ? text : '');
  if (nr) {
    const p = profile.find((x) => String(x.driver_number ?? '') === nr);
    if (p) return p.id;
  }
  const name = text.replace(/\s*\(\d+\)\s*$/, '').trim().toLowerCase();
  const p = profile.find((x) => `${x.first_name || ''} ${x.last_name || ''}`.trim().toLowerCase() === name);
  return p ? p.id : null;
};

export const fahrerName = (p) => (p ? `${p.first_name || ''} ${p.last_name || ''}`.trim() || 'Fahrer' : 'Fahrer');

// Standbys ab heute (und gestern, falls ueber Mitternacht) mit ihren Fahrern, live aktualisiert.
export const useStandbys = () => {
  const [liste, setListe] = useState(null);
  const [stand, setStand] = useState(0);
  const laden = useCallback(() => setStand((n) => n + 1), []);

  useEffect(() => {
    let aktiv = true;
    if (DEMO_MODE) { Promise.resolve().then(() => { if (aktiv) setListe([]); }); return () => { aktiv = false; }; }
    (async () => {
      const gestern = new Date(Date.now() - 86400000).toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' });
      const { data: s } = await supabase.from('standby').select('*').gte('datum', gestern).order('datum').order('von');
      const ids = (s || []).map((x) => x.id);
      const { data: f } = ids.length ? await supabase.from('standby_fahrer').select('*').in('standby_id', ids) : { data: [] };
      const fahrerIds = [...new Set((f || []).map((x) => x.driver_id))];
      const { data: p } = fahrerIds.length
        ? await supabase.from('profiles').select('id, first_name, last_name, driver_number').in('id', fahrerIds)
        : { data: [] };
      const profilJe = new Map((p || []).map((x) => [x.id, x]));
      if (!aktiv) return;
      setListe((s || []).map((x) => ({
        ...x,
        fahrer: (f || []).filter((y) => y.standby_id === x.id)
          .map((y) => ({ ...y, profil: profilJe.get(y.driver_id) || null }))
          .sort((a, b) => fahrerName(a.profil).localeCompare(fahrerName(b.profil))),
      })));
    })();
    return () => { aktiv = false; };
  }, [stand]);

  // Realtime: jede Aenderung an Standby oder Fahrerzustand laedt neu.
  useEffect(() => {
    if (DEMO_MODE) return undefined;
    const kanal = supabase.channel(`dispo-standby-${Date.now()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'standby' }, laden)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'standby_fahrer' }, laden)
      .subscribe();
    return () => { supabase.removeChannel(kanal); };
  }, [laden]);

  return { liste, laden };
};

// Laeuft gerade oder kommt noch (Ende nicht vorbei).
export const standbyAktuell = (s) => {
  const ende = new Date(`${s.datum}T${hm(s.bis)}:00`);
  const start = new Date(`${s.datum}T${hm(s.von)}:00`);
  if (ende <= start) ende.setDate(ende.getDate() + 1);
  // Grobe Pruefung in lokaler Zeit (Dispo sitzt in Berlin).
  return ende.getTime() > Date.now() || s.datum >= heuteBerlin();
};

export const standbyAnlegen = async ({ datum, von, bis, ort, notiz, fahrerIds }) => {
  const { data, error } = await supabase.from('standby').insert({
    datum, von, bis,
    ort_id: ort.id || null,
    ort_name: ort.name,
    adresse: ort.adresse || null,
    lat: ort.lat,
    lng: ort.lng,
    radius_rein_m: ort.radius_rein_m || 150,
    radius_raus_m: ort.radius_raus_m || 300,
    notiz: notiz || null,
  }).select('id').single();
  if (error) return { ok: false, fehler: error.message };
  const { error: f } = await supabase.from('standby_fahrer').insert(fahrerIds.map((id) => ({ standby_id: data.id, driver_id: id })));
  if (f) return { ok: false, fehler: f.message };
  return { ok: true, id: data.id };
};

export const standbyZeitenAendern = async (id, von, bis) => {
  const { error } = await supabase.from('standby').update({ von, bis }).eq('id', id);
  return error ? error.message : '';
};

export const standbyFahrerDazu = async (id, fahrerIds) => {
  const { error } = await supabase.from('standby_fahrer').upsert(
    fahrerIds.map((d) => ({ standby_id: id, driver_id: d, status: 'pending' })), { onConflict: 'standby_id,driver_id' },
  );
  return error ? error.message : '';
};

export const standbyFahrerWeg = async (id, driverId) => {
  const { error } = await supabase.from('standby_fahrer').delete().eq('standby_id', id).eq('driver_id', driverId);
  return error ? error.message : '';
};

export const standbyLoeschen = async (id) => {
  // Erst die Fahrer (jeder bekommt "Standby zurückgezogen"), dann den Standby.
  await supabase.from('standby_fahrer').delete().eq('standby_id', id);
  const { error } = await supabase.from('standby').delete().eq('id', id);
  return error ? error.message : '';
};

// ---- Standby-Fahrten fuer Alle Fahrten -------------------------------------------------------------
// Aus den Ereignissen je Fahrer: gast_drin = losgefahren, abgesetzt = Rueckweg, zurueck = wieder am Event.
// Faehrt er auf dem Rueckweg mit neuem Gast los (gast_drin), endet die alte Fahrt und eine neue beginnt.
export const fahrtenBilden = (ereignisse) => {
  const fahrten = [];
  const offen = new Map();
  [...(ereignisse || [])].sort((a, b) => new Date(a.zeit) - new Date(b.zeit)).forEach((e) => {
    const k = `${e.standby_id}|${e.driver_id}`;
    const f = offen.get(k);
    if (e.art === 'gast_drin') {
      if (f) { f.ende = e.zeit; offen.delete(k); }
      const neu = { id: `${k}|${e.id}`, standby_id: e.standby_id, driver_id: e.driver_id, start: e.zeit, abgesetzt: null, zurueck: null, ende: null };
      fahrten.push(neu);
      offen.set(k, neu);
    } else if (e.art === 'abgesetzt' && f) {
      f.abgesetzt = e.zeit;
      f.absetzLat = e.lat;
      f.absetzLng = e.lng;
    } else if (e.art === 'zurueck' && f) {
      f.zurueck = e.zeit;
      f.ende = e.zeit;
      offen.delete(k);
    }
  });
  return fahrten.map((f) => ({ ...f, status: f.zurueck ? 'zurueck' : f.ende ? 'beendet' : f.abgesetzt ? 'rueckweg' : 'unterwegs' }));
};

// Ereignisse der laufenden Standbys live. Die Ankunft zurueck am Event rechnet der Server mit TomTom
// (standby_fahrer.rueck_ankunft, Migration 20261112130000), kommt per Realtime mit useStandbys.
export const useStandbyFahrten = (standbys) => {
  const [ereignisse, setEreignisse] = useState([]);
  const [stand, setStand] = useState(0);
  const ids = (standbys || []).map((s) => s.id).join(',');

  useEffect(() => {
    let aktiv = true;
    if (DEMO_MODE || !ids) { Promise.resolve().then(() => { if (aktiv) setEreignisse([]); }); return () => { aktiv = false; }; }
    supabase.from('standby_ereignis').select('*').in('standby_id', ids.split(',')).order('zeit').then(({ data }) => {
      if (aktiv) setEreignisse(data || []);
    });
    return () => { aktiv = false; };
  }, [ids, stand]);

  useEffect(() => {
    if (DEMO_MODE || !ids) return undefined;
    const kanal = supabase.channel(`dispo-standby-ereignis-${Date.now()}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'standby_ereignis' }, () => setStand((n) => n + 1))
      .subscribe();
    return () => { supabase.removeChannel(kanal); };
  }, [ids]);

  const ankunftVon = (f) => {
    if (f.status !== 'rueckweg') return null;
    const s = (standbys || []).find((x) => x.id === f.standby_id);
    return s?.fahrer?.find((y) => y.driver_id === f.driver_id)?.rueck_ankunft || null;
  };
  return fahrtenBilden(ereignisse).map((f) => ({ ...f, ankunft: ankunftVon(f) }));
};
