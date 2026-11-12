// Flaggen an Fahrern (Figma Koordinator_Screen_Map 2832:12528): drei Flaggen in Cyan, Violett und Koenigsblau
// (die Farben aus dem Figma waren neben den Fahrerfarben schlecht lesbar). In der Datenbank neutral flagge1..3.
// Die Dispo waehlt Fahrer aus (Karte oder Alle Fahrer) und tippt eine Flagge an. Sie fuellt sich,
// sobald alle Ausgewaehlten sie tragen. Erneut tippen nimmt sie wieder weg.
// Gespeichert in profiles.flagge (Migration 20261112090000_fahrer_flagge), eine Flagge je Fahrer.
import { supabase, supabaseAdmin, hasSupabaseAdminConfig } from '../services/supabase';

const ORDNER = '/icon/_Icon_Flaggen';

export const FLAGGEN = [
  { id: 'flagge1', name: 'Flagge 1 (Cyan)', farbe: '#00D5FF', umriss: `${ORDNER}/Flagge_1.svg`, voll: `${ORDNER}/Flagge_1_Voll.svg` },
  { id: 'flagge2', name: 'Flagge 2 (Violett)', farbe: '#8A2BFF', umriss: `${ORDNER}/Flagge_2.svg`, voll: `${ORDNER}/Flagge_2_Voll.svg` },
  { id: 'flagge3', name: 'Flagge 3 (Königsblau)', farbe: '#1B2FD6', umriss: `${ORDNER}/Flagge_3.svg`, voll: `${ORDNER}/Flagge_3_Voll.svg` },
];
// Duenne schwarze Umrandung fuer Flaggen auf farbigem Grund (Fahrerkarte, Marker). Vier Schatten ohne Weichzeichner.
export const FLAGGE_UMRISS = 'drop-shadow(0.8px 0 0 #000) drop-shadow(-0.8px 0 0 #000) drop-shadow(0 0.8px 0 #000) drop-shadow(0 -0.8px 0 #000)';
// Am Marker zusaetzlich ein weicher Schatten nach unten rechts, damit sie wie aufgesteckt wirkt.
export const FLAGGE_UMRISS_PLASTISCH = `${FLAGGE_UMRISS} drop-shadow(1px 2px 1.5px rgba(0,0,0,0.55))`;
// Aufgelegt: Umrandung plus kurzer Schatten nach unten, als laege sie auf der Karte.
export const FLAGGE_UMRISS_AUFGELEGT = `${FLAGGE_UMRISS} drop-shadow(0.5px 1.5px 1px rgba(0,0,0,0.45))`;
export const FLAGGE_KREIS_URL = `${ORDNER}/Flagge_Kreis.svg`;

const NACH_ID = new Map(FLAGGEN.map((f) => [f.id, f]));
export const flaggeNachId = (id) => NACH_ID.get(String(id || '').trim().toLowerCase()) || null;
export const flaggeId = (wert) => flaggeNachId(wert)?.id || null;

// Zustand der Knoepfe: gefuellt, wenn jeder Ausgewaehlte diese Flagge hat.
// flaggenVon: Map oder Funktion id -> Flagge der Fahrer.
export const alleHabenFlagge = (ids, flaggeVon, flagge) => ids.length > 0 && ids.every((id) => flaggeVon(id) === flagge);

// Setzt (flagge = id) oder entfernt (flagge = null) die Flagge bei den Fahrern. Gibt { ok, fehler } zurueck.
export const flaggeSetzen = async (ids, flagge) => {
  const liste = [...new Set((ids || []).map((id) => String(id || '').trim()).filter(Boolean))];
  if (!liste.length) return { ok: false, fehler: 'Kein Fahrer ausgewählt.' };
  const wert = flaggeId(flagge);
  const versuch = async (client) => client.from('profiles').update({ flagge: wert }).in('id', liste).select('id');
  let antwort = await versuch(supabase);
  if ((antwort.error || !(antwort.data || []).length) && hasSupabaseAdminConfig) {
    const zweite = await versuch(supabaseAdmin);
    if (!zweite.error) antwort = zweite;
  }
  if (antwort.error) return { ok: false, fehler: antwort.error.message || 'Speichern hat nicht geklappt.' };
  return { ok: true, anzahl: (antwort.data || []).length };
};
