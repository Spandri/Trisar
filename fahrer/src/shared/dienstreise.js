// Dienstreise in der Fahrer-App (Tabellen dienstreise, dienstreise_fahrer; Funktionen dienstreise_antworten,
// dienstreise_beenden). Verbindung live ueber train-validate bzw. flight-validate (wie admin/src/shared/dienstreise.js).
// Gleiche Logik in iOS (DienstreiseSpeicher) und Android (DienstreiseSpeicher.kt).

import { useCallback, useEffect, useState } from 'react';
import { supabase } from './supabase/client';
import { DEMO_MODE } from '../datenquelle';
import { treffpunktIcon } from './dienstTreffpunkt';

export const hm = (wert) => String(wert || '').slice(0, 5);
export const reiseArt = (r) => (String(r?.flugnummer || '').trim() ? 'flug' : 'zug');
export const reiseNummer = (r) => String(r?.zugnummer || r?.flugnummer || '').trim();

// Kacheln: Start (Zug/Flug), Ziel (eigener Ort mit Icon, sonst nach Name).
export const startIcon = (r) => (reiseArt(r) === 'flug'
  ? '/icon/_Icon_Grau/Plain_Abflug_Trisar_Icons_01_grau.svg'
  : '/icon/_Icon_Grau/Bahnhof_Zug_Trisar_Icons_01_grau.svg');
export const zielIcon = (r) => treffpunktIcon({ ortId: r.ziel_ort_id, name: r.ziel_name, adresse: r.ziel_adresse });

// Sichtbar bis der Fahrer beendet, sonst bis zum Ende des Folgetags.
const reiseSichtbar = (r) => {
  if (r.beendet) return false;
  const ende = new Date(`${r.datum}T23:59:00`);
  ende.setDate(ende.getDate() + 1);
  return ende.getTime() > Date.now();
};

// Eigene Dienstreisen (angefragt oder angenommen, nicht beendet), live.
export const useFahrerDienstreisen = (fahrerId) => {
  const [liste, setListe] = useState([]);
  const [stand, setStand] = useState(0);
  const laden = useCallback(() => setStand((n) => n + 1), []);

  useEffect(() => {
    let aktiv = true;
    if (DEMO_MODE || !fahrerId) { Promise.resolve().then(() => { if (aktiv) setListe([]); }); return () => { aktiv = false; }; }
    (async () => {
      const { data: f, error } = await supabase.from('dienstreise_fahrer').select('*').eq('driver_id', fahrerId).in('status', ['pending', 'accepted']);
      if (error) { if (aktiv) setListe([]); return; }
      const ids = (f || []).map((x) => x.dienstreise_id);
      const { data: r } = ids.length ? await supabase.from('dienstreise').select('*').in('id', ids) : { data: [] };
      // Abschnitte (Umstiege). Fehlt die Tabelle (alte Datenbank), bleibt es bei der einen Verbindung.
      const { data: abs } = ids.length
        ? await supabase.from('dienstreise_abschnitt').select('*').in('dienstreise_id', ids).order('reihenfolge')
        : { data: [] };
      const je = new Map((r || []).map((x) => [x.id, x]));
      if (!aktiv) return;
      setListe((f || []).map((x) => ({
        ...je.get(x.dienstreise_id), ...x, id: x.dienstreise_id,
        abschnitte: (abs || []).filter((a) => a.dienstreise_id === x.dienstreise_id),
      }))
        .filter((x) => x.datum && reiseSichtbar(x))
        .sort((a, b) => `${a.datum}${a.start_zeit}`.localeCompare(`${b.datum}${b.start_zeit}`)));
    })();
    return () => { aktiv = false; };
  }, [fahrerId, stand]);

  useEffect(() => {
    if (DEMO_MODE || !fahrerId) return undefined;
    const kanal = supabase.channel(`fahrer-dienstreise-${fahrerId}-${Date.now()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'dienstreise_fahrer', filter: `driver_id=eq.${fahrerId}` }, laden)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'dienstreise' }, laden)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'dienstreise_abschnitt' }, laden)
      .subscribe();
    const sichtbar = () => { if (document.visibilityState === 'visible') laden(); };
    document.addEventListener('visibilitychange', sichtbar);
    return () => { supabase.removeChannel(kanal); document.removeEventListener('visibilitychange', sichtbar); };
  }, [fahrerId, laden]);

  const antworten = useCallback(async (id, annehmen) => {
    const { error } = await supabase.rpc('dienstreise_antworten', { p_dienstreise: id, p_annehmen: annehmen });
    if (error) window.alert(`Dienstreise konnte nicht gespeichert werden: ${error.message}`);
    laden();
  }, [laden]);

  const beenden = useCallback(async (id) => {
    const { error } = await supabase.rpc('dienstreise_beenden', { p_dienstreise: id });
    if (error) { window.alert(`Konnte nicht gespeichert werden: ${error.message}`); return false; }
    laden();
    return true;
  }, [laden]);

  return { liste, laden, antworten, beenden };
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
 * Verbindung live holen (Zug: Abfahrt am Start, Ausstieg nahe am Ziel, Strecke; Flug: Abflug, Ankunft).
 * Einheitlich: { art, nummer, abfahrt_plan, abfahrt, gleis, ankunft_plan, ankunft, ankunft_ort, strecke }
 */
export const verbindungHolen = async (r) => {
  const nummer = reiseNummer(r);
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
    strecke: r.start_lat != null && r.ziel_lat != null
      ? [{ name: r.start_name, lat: r.start_lat, lng: r.start_lng }, { name: r.ziel_name, lat: r.ziel_lat, lng: r.ziel_lng }]
      : [],
  };
};

// Live-Stand je Dienstreise, mit Rueckfall auf den Stand beim Anlegen. Alle 2 Minuten neu.
export const useVerbindung = (r) => {
  const [live, setLive] = useState(null);
  const nummer = reiseNummer(r);
  useEffect(() => {
    let aktiv = true;
    if (!r?.id || !nummer || DEMO_MODE) return undefined;
    const holen = () => verbindungHolen(r).then((v) => { if (aktiv && v && !v.fehler) setLive(v); }).catch(() => {});
    holen();
    const uhr = setInterval(holen, 120000);
    return () => { aktiv = false; clearInterval(uhr); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [r?.id, nummer, r?.datum, r?.start_name]);
  return live || r?.verbindung || null;
};

// Hoehe in der Fahrtenliste: Karte 187, bei Anfrage darunter Ablehnen/Annehmen.
export const REISE_KARTE = 187;
export const reiseBlockHoehe = (r) => (r.status === 'pending' ? REISE_KARTE + 12 + 51 : REISE_KARTE);

// MARK: Abschnitte (Umstiege)

export const abschnittIcon = (art) => ({
  bus: '/icon/_Icon_Grau/Bus_Trisar_Icons_01_grau.svg',
  ubahn: '/icon/_Icon_Grau/U_Bahn_Trisar_Icons_01_grau.svg',
  tram: '/icon/_Icon_Grau/U_Bahn_Trisar_Icons_01_grau.svg',
  flug: '/icon/_Icon_Grau/Plain_Abflug_Trisar_Icons_01_grau.svg',
}[art] || '/icon/_Icon_Grau/Bahnhof_Zug_Trisar_Icons_01_grau.svg');
const mitLive = (art) => art === 'zug' || art === 'sbahn' || art === 'flug';

/**
 * Live-Stand je Abschnitt (Zug ueber train-validate mit genauem Ausstieg, Flug ueber flight-validate),
 * alle 2 Minuten neu. Bus/U-Bahn ohne Abfrage: Zeiten aus dem Ticket. Ergebnis: key -> Verbindung.
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
        if (!mitLive(a.art) || !String(a.nummer || '').trim()) continue;
        const v = await verbindungHolen({
          id: a.id,
          datum: a.ab_datum || reise.datum,
          start_zeit: a.ab_zeit,
          start_name: a.von_name, start_lat: a.von_lat, start_lng: a.von_lng,
          ziel_bahnhof: a.nach_name || '',
          ziel_name: a.nach_name, ziel_lat: a.nach_lat, ziel_lng: a.nach_lng,
          zugnummer: a.art === 'flug' ? '' : a.nummer,
          flugnummer: a.art === 'flug' ? a.nummer : '',
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

// Ticket zum Ansehen (Link gilt 1 Stunde).
export const ticketLink = async (pfad) => {
  if (!pfad) return '';
  const { data } = await supabase.storage.from('dienstreise-tickets').createSignedUrl(pfad, 3600);
  return data?.signedUrl || '';
};

// Apple-Wallet-Pass vom Server bauen lassen (dispo-admin wallet_pass) und den Link zurueckgeben.
export const walletLink = async (reiseId) => {
  const { data, error } = await supabase.functions.invoke('dispo-admin', { body: { aktion: 'wallet_pass', dienstreise_id: reiseId } });
  if (error) return { ok: false, meldung: 'Wallet-Pass konnte nicht erstellt werden.' };
  if (!data?.ok || !data?.url) return { ok: false, meldung: data?.meldung || data?.error || 'Wallet-Pass konnte nicht erstellt werden.' };
  return { ok: true, url: data.url };
};
