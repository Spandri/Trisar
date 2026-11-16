// Dienstreise (Tabellen dienstreise, dienstreise_fahrer, Migration 20261113220000).
// Laden mit Realtime, Anlegen, Fahrer dazu/weg, Loeschen, Verbindung (Zug/Flug) holen.
// Gleiche Logik in iOS und Android.

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../services/supabase';
import { DEMO_MODE } from '../datenquelle';
import { fahrerName } from './standby';

export const REISE_LIME = '#E3F654';
export const REISE_ROT = '#FF6F63';
export const REISE_GRAU = '#868687';

export const hm = (wert) => String(wert || '').slice(0, 5);

// Zustand eines Fahrers als Text und Farbe (Dispo-Uebersicht).
export const reiseZustand = (f) => {
  if (f.status === 'pending') return { text: 'Angefragt', farbe: REISE_GRAU };
  if (f.status === 'refused') return { text: 'Abgelehnt', farbe: REISE_ROT };
  if (f.beendet) return { text: 'Beendet', farbe: REISE_GRAU };
  return { text: 'Angenommen', farbe: REISE_LIME };
};

const verbindungsNummer = (r) => String(r?.zugnummer || r?.flugnummer || '').trim();
export const reiseArt = (r) => (String(r?.flugnummer || '').trim() ? 'flug' : 'zug');

// Dienstreisen ab gestern mit ihren Fahrern, live aktualisiert.
export const useDienstreisen = () => {
  const [liste, setListe] = useState(null);
  const [stand, setStand] = useState(0);
  const laden = useCallback(() => setStand((n) => n + 1), []);

  useEffect(() => {
    let aktiv = true;
    if (DEMO_MODE) { Promise.resolve().then(() => { if (aktiv) setListe([]); }); return () => { aktiv = false; }; }
    (async () => {
      const gestern = new Date(Date.now() - 86400000).toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' });
      const { data: r } = await supabase.from('dienstreise').select('*').gte('datum', gestern).order('datum').order('start_zeit');
      const ids = (r || []).map((x) => x.id);
      const { data: f } = ids.length ? await supabase.from('dienstreise_fahrer').select('*').in('dienstreise_id', ids) : { data: [] };
      // Abschnitte (Umstiege). Fehlt die Tabelle noch (alte Datenbank), bleibt es bei der einen Verbindung.
      const { data: abs } = ids.length
        ? await supabase.from('dienstreise_abschnitt').select('*').in('dienstreise_id', ids).order('reihenfolge')
        : { data: [] };
      const fahrerIds = [...new Set((f || []).map((x) => x.driver_id))];
      const { data: p } = fahrerIds.length
        ? await supabase.from('profiles').select('id, first_name, last_name, driver_number').in('id', fahrerIds)
        : { data: [] };
      const profilJe = new Map((p || []).map((x) => [x.id, x]));
      if (!aktiv) return;
      setListe((r || []).map((x) => ({
        ...x,
        abschnitte: (abs || []).filter((a) => a.dienstreise_id === x.id),
        fahrer: (f || []).filter((y) => y.dienstreise_id === x.id)
          .map((y) => ({ ...y, profil: profilJe.get(y.driver_id) || null }))
          .sort((a, b) => fahrerName(a.profil).localeCompare(fahrerName(b.profil))),
      })));
    })();
    return () => { aktiv = false; };
  }, [stand]);

  useEffect(() => {
    if (DEMO_MODE) return undefined;
    const kanal = supabase.channel(`dispo-dienstreise-${Date.now()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'dienstreise' }, laden)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'dienstreise_fahrer' }, laden)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'dienstreise_abschnitt' }, laden)
      .subscribe();
    return () => { supabase.removeChannel(kanal); };
  }, [laden]);

  return { liste, laden };
};

// Kommt noch oder ist heute.
export const reiseAktuell = (r) => {
  const heute = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' });
  if (r.datum >= heute) return true;
  return r.fahrer.some((f) => f.status === 'accepted' && !f.beendet);
};

// Farbe einer Ist-Zeit (Entwurf 14.11.): orange bei Verspaetung, sonst Lime.
export const zeitFarbe = (spaet) => (spaet > 0 ? '#F0997B' : '#E3F654');

/**
 * Gleis live gegen Ticket bzw. Fahrplan (15.11.): { gleis, vorher }. vorher leer = unveraendert.
 * Ohne Live-Gleis bleibt das Ticket-Gleis. Gleich in iOS (DienstreiseVerbindung.gleisStand) und Android.
 */
export const gleisStand = (live, ticket, fahrplan) => {
  const l = String(live || '').trim();
  const t = String(ticket || '');
  const plan = t || String(fahrplan || '');
  if (!l) return { gleis: t, vorher: '' };
  return { gleis: l, vorher: plan && plan !== l ? plan : '' };
};

/**
 * Verspaetung in Minuten (Ist minus Plan, HH:MM), ueber Mitternacht gerechnet. 0 wenn puenktlich oder unbekannt,
 * negativ wenn zu frueh.
 */
export const minutenSpaet = (plan, ist) => {
  const m = (v) => {
    const t = /^(\d{1,2}):(\d{2})/.exec(String(v || ''));
    return t ? Number(t[1]) * 60 + Number(t[2]) : null;
  };
  const p = m(plan); const i = m(ist);
  if (p == null || i == null) return 0;
  let d = i - p;
  if (d < -720) d += 1440;
  if (d > 720) d -= 1440;
  // Negativ = zu frueh (14.11.: gruene Kachel "-2").
  return d;
};

/**
 * Verbindung live holen: Zug ueber train-validate (Abfahrt am Start, Ausstieg nahe am Ziel, Strecke),
 * Flug ueber flight-validate. Ergebnis einheitlich:
 * { art, nummer, abfahrt_plan, abfahrt, gleis, ankunft_plan, ankunft, ankunft_ort, ziel_bahnhof, strecke: [{name,lat,lng}] }
 */
export const verbindungHolen = async (r) => {
  const nummer = verbindungsNummer(r);
  if (!nummer) return null;
  if (reiseArt(r) === 'zug') {
    const { data, error } = await supabase.functions.invoke('train-validate', {
      body: {
        train_number: nummer,
        ride_date: r.datum,
        // Zwischenhalte (ohne Start/Ziel) fuer die Halte-Liste am Abschnitt.
        mit_halten: true,
        start_station: r.start_name,
        // Abfahrt erst ab der Startzeit suchen (weniger Abfragen bei der Bahn).
        ...(r.start_zeit ? { start_zeit: hm(r.start_zeit) } : {}),
        // Abschnitt mit bekanntem Ausstieg (Ticket): genau dort, sonst Halt am naechsten zum Ziel.
        ...(r.ziel_bahnhof ? { target_station: r.ziel_bahnhof }
          : r.ziel_lat != null && r.ziel_lng != null ? { target_lat: r.ziel_lat, target_lng: r.ziel_lng } : {}),
      },
    });
    if (error || !data?.valid) return { art: 'zug', nummer, fehler: data?.message || error?.message || 'Zug nicht gefunden.' };
    const s = data.summary || {};
    return {
      art: 'zug',
      nummer: s.line_name || nummer,
      abfahrt_plan: hm(String(s.planned_departure || '').slice(11)),
      abfahrt: data.etd_label || hm(String(s.predicted_departure || '').slice(11)),
      gleis: data.departure_platform || '',
      // Nur live (15.11.): Abfahrtsgleis laut Fahrplan, Ankunftsgleis live und laut Fahrplan.
      gleis_plan: s.departure_platform_planned || '',
      gleis_an: s.arrival_platform || '',
      gleis_an_plan: s.arrival_platform_planned || '',
      ankunft_plan: hm(String(s.planned_arrival || '').slice(11)),
      ankunft: data.eta_label || '',
      ankunft_ort: s.target_station_name || data.target_station || '',
      strecke: (data.strecke || []).filter((h) => h.lat != null && h.lng != null).map((h) => ({ name: h.name, lat: h.lat, lng: h.lng })),
      // Verlauf entlang der Gleise ([lng, lat] je Punkt), fehlt wenn der Schienen-Router nicht antwortet.
      linie: Array.isArray(data.strecke_linie) ? data.strecke_linie : [],
      // Zwischenhalte [{ name, an_plan, an, ab_plan, ab, gleis }], leer wenn der Server sie nicht liefert.
      halte: Array.isArray(data.halte) ? data.halte : [],
    };
  }
  const { data, error } = await supabase.functions.invoke('flight-validate', {
    body: { flight_number: nummer, ride_date: r.datum, require_lufthansa_group: false },
  });
  if (error || !data?.valid) return { art: 'flug', nummer, fehler: data?.message || error?.message || 'Flug nicht gefunden.' };
  const s = data.summary || {};
  const uhr = (v) => hm(String(v || '').replace(' ', 'T').split('T')[1] || '');
  return {
    art: 'flug',
    nummer: s.flight_iata || nummer,
    abfahrt_plan: uhr(s.scheduled_departure_local),
    abfahrt: uhr(s.actual_departure_local || s.estimated_departure_local || s.scheduled_departure_local),
    gleis: [s.departure_terminal ? `Terminal ${s.departure_terminal}` : '', s.departure_gate ? `Gate ${s.departure_gate}` : ''].filter(Boolean).join(' · '),
    ankunft_plan: uhr(s.scheduled_arrival_local),
    ankunft: uhr(s.actual_arrival_local || s.estimated_arrival_local || s.scheduled_arrival_local),
    ankunft_ort: s.arrival_airport || '',
    // Flug: Bogen vom Start zum Ziel der Dienstreise (wie die Flugbahn bei Fahrten).
    strecke: r.start_lat != null && r.ziel_lat != null
      ? [{ name: r.start_name, lat: r.start_lat, lng: r.start_lng }, { name: r.ziel_name, lat: r.ziel_lat, lng: r.ziel_lng }]
      : [],
  };
};

export const dienstreiseAnlegen = async ({
  id = null, datum, startZeit, start, ziel, zugnummer, flugnummer, notiz, fahrerIds,
  abschnitte = [], ticket = null, reisender = '', auftragsnummer = '',
}) => {
  const reise = {
    ...(id ? { id } : {}),
    datum,
    start_zeit: startZeit,
    start_ort_id: start.id || null,
    start_name: start.name,
    start_adresse: start.adresse || null,
    start_lat: start.lat ?? null,
    start_lng: start.lng ?? null,
    ziel_ort_id: ziel.id || null,
    ziel_name: ziel.name,
    ziel_adresse: ziel.adresse || null,
    ziel_lat: ziel.lat ?? null,
    ziel_lng: ziel.lng ?? null,
    zugnummer: zugnummer || null,
    flugnummer: flugnummer || null,
    notiz: notiz || null,
    ...(ticket?.pfad ? { ticket_pfad: ticket.pfad, ticket_name: ticket.name || 'Ticket.pdf' } : {}),
    ...(reisender ? { reisender } : {}),
    ...(auftragsnummer ? { auftragsnummer } : {}),
  };
  // Stand der Verbindung beim Anlegen merken (Rueckfall, falls die Abfrage spaeter nicht klappt).
  const verbindung = await verbindungHolen(reise).catch(() => null);
  const { data, error } = await supabase.from('dienstreise').insert({
    ...reise,
    verbindung: verbindung && !verbindung.fehler ? verbindung : null,
    verbindung_stand: verbindung && !verbindung.fehler ? new Date().toISOString() : null,
  }).select('id').single();
  if (error) return { ok: false, fehler: error.message };
  // Abschnitte vor den Fahrern speichern: die Fahrer bekommen die Push erst, wenn alles da ist.
  if (abschnitte.length) {
    const { error: a } = await supabase.from('dienstreise_abschnitt').insert(abschnitte.map((x, i) => ({
      dienstreise_id: data.id,
      reihenfolge: i,
      art: x.art || 'zug',
      nummer: x.nummer || null,
      von_name: x.von_name,
      von_lat: x.von_lat ?? null,
      von_lng: x.von_lng ?? null,
      ab_datum: x.ab_datum || datum,
      ab_zeit: x.ab_zeit || null,
      gleis_ab: x.gleis_ab || null,
      nach_name: x.nach_name || null,
      nach_lat: x.nach_lat ?? null,
      nach_lng: x.nach_lng ?? null,
      an_datum: x.an_datum || null,
      an_zeit: x.an_zeit || null,
      gleis_an: x.gleis_an || null,
      hinweis: x.hinweis || null,
    })));
    if (a) return { ok: false, fehler: a.message };
  }
  const { error: f } = await supabase.from('dienstreise_fahrer').insert(fahrerIds.map((fid) => ({ dienstreise_id: data.id, driver_id: fid })));
  if (f) return { ok: false, fehler: f.message };
  return { ok: true, id: data.id, verbindung };
};

export const dienstreiseFahrerDazu = async (id, fahrerIds) => {
  const { error } = await supabase.from('dienstreise_fahrer').upsert(
    fahrerIds.map((d) => ({ dienstreise_id: id, driver_id: d })),
    { onConflict: 'dienstreise_id,driver_id', ignoreDuplicates: true },
  );
  return error ? error.message : '';
};

export const dienstreiseFahrerWeg = async (id, driverId) => {
  const { error } = await supabase.from('dienstreise_fahrer').delete().eq('dienstreise_id', id).eq('driver_id', driverId);
  return error ? error.message : '';
};

export const dienstreiseLoeschen = async (id) => {
  // Erst die Fahrer (Push "zurueckgezogen"), dann die Reise.
  await supabase.from('dienstreise_fahrer').delete().eq('dienstreise_id', id);
  const { error } = await supabase.from('dienstreise').delete().eq('id', id);
  return error ? error.message : '';
};

// Art eines Abschnitts aus der Nummer: Bus/U-Bahn/Tram ohne Live-Abfrage, Flug = zwei Buchstaben + Ziffern.
export const abschnittArt = (nummer) => {
  const n = String(nummer || '').trim().toUpperCase();
  if (!n) return 'zug';
  if (/^BUS\b/.test(n)) return 'bus';
  if (/^U\s?\d|^U-?BAHN/.test(n)) return 'ubahn';
  if (/^(STR|TRAM)\b/.test(n)) return 'tram';
  if (/^S\s?\d/.test(n)) return 'sbahn';
  if (/^(ICE|IC|EC|ECE|RJX?|NJ|EN|TGV|FLX|WB|RE|RB|IRE|MEX|ALX|BRB|ARV|ERB|AG)\s?\d/.test(n)) return 'zug';
  if (/^[A-Z0-9]{2}\s?\d{1,4}[A-Z]?$/.test(n)) return 'flug';
  return 'zug';
};
export const mitLiveAbfrage = (art) => art === 'zug' || art === 'sbahn' || art === 'flug';

// Ticket in die Ablage legen (Ordner = ID der Dienstreise) und vom Server lesen lassen.
export const ticketHochladenUndLesen = async (reiseId, datei) => {
  const endung = /\.pdf$/i.test(datei.name) ? 'pdf' : (datei.type.split('/')[1] || 'pdf');
  const pfad = `${reiseId}/ticket.${endung}`;
  const { error } = await supabase.storage.from('dienstreise-tickets').upload(pfad, datei, { upsert: true, contentType: datei.type || 'application/pdf' });
  if (error) return { ok: false, fehler: `Hochladen fehlgeschlagen: ${error.message}` };
  const { data, error: e } = await supabase.functions.invoke('dispo-admin', { body: { aktion: 'ticket_lesen', pfad } });
  if (e) return { ok: true, pfad, name: datei.name, gelesen: null, fehler: 'Ticket gespeichert, aber nicht gelesen.' };
  return { ok: true, pfad, name: datei.name, gelesen: data?.erkannt ? data : null, fehler: data?.erkannt ? '' : (data?.meldung || '') };
};

// Ticket zum Ansehen (Link gilt 1 Stunde).
export const ticketLink = async (pfad) => {
  if (!pfad) return '';
  const { data } = await supabase.storage.from('dienstreise-tickets').createSignedUrl(pfad, 3600);
  return data?.signedUrl || '';
};

/**
 * Live-Stand je Abschnitt einer Dienstreise (Zug ueber train-validate mit genauem Ausstieg, Flug ueber
 * flight-validate), alle 2 Minuten neu. Gleich wie fahrer/src/shared/dienstreise.js. Ergebnis: ID -> Verbindung.
 */
export const useAbschnittVerbindungen = (reise) => {
  const [je, setJe] = useState({});
  const teile = reise?.abschnitte || [];
  const schluessel = teile.map((a) => `${a.id}|${a.nummer}|${a.ab_zeit}`).join(',');
  useEffect(() => {
    let aktiv = true;
    if (!teile.length || DEMO_MODE) return undefined;
    const holen = async () => {
      for (const a of teile) {
        const art = a.art || abschnittArt(a.nummer);
        if (!mitLiveAbfrage(art) || !String(a.nummer || '').trim()) continue;
        const v = await verbindungHolen({
          datum: a.ab_datum || reise.datum,
          start_zeit: a.ab_zeit,
          start_name: a.von_name, start_lat: a.von_lat, start_lng: a.von_lng,
          ziel_bahnhof: a.nach_name || '',
          ziel_name: a.nach_name, ziel_lat: a.nach_lat, ziel_lng: a.nach_lng,
          zugnummer: art === 'flug' ? '' : a.nummer,
          flugnummer: art === 'flug' ? a.nummer : '',
        }).catch(() => null);
        if (aktiv && v && !v.fehler) setJe((alt) => ({ ...alt, [a.id]: v }));
      }
    };
    holen();
    const uhr = setInterval(holen, 120000);
    return () => { aktiv = false; clearInterval(uhr); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reise?.id, schluessel]);
  return je;
};

// Laeuft die Dienstreise fuer diesen Fahrer gerade (angenommen, nicht beendet, 30 min vor Start bis 2 h nach Ankunft)?
export const reiseLaeuft = (r, f, jetzt = Date.now()) => {
  if (!r || !f || f.status !== 'accepted' || f.beendet) return false;
  const start = new Date(`${r.datum}T${hm(r.start_zeit)}:00`).getTime();
  if (!Number.isFinite(start) || jetzt < start - 30 * 60000) return false;
  const teile = r.abschnitte || [];
  const letzter = teile[teile.length - 1];
  let ende = letzter?.an_zeit ? new Date(`${letzter.an_datum || letzter.ab_datum || r.datum}T${hm(letzter.an_zeit)}:00`).getTime() : NaN;
  if (Number.isFinite(ende) && ende < start) ende += 24 * 3600000;
  const bis = Number.isFinite(ende) ? ende + 2 * 3600000 : start + 18 * 3600000;
  return jetzt < bis;
};
