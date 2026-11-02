// Antworten der Gäste auf Rad- und U-Bahn-Angebote in der Demo.
//
// In der Vorabplanung ist jedes Angebot offen: Die Engine schlägt den Umstieg
// vor, entscheiden tut der Gast in seiner App. Im Rundgang nimmt der Gast in der
// Gast-Ansicht an. Der Rahmen schickt die Antwort dann hierher:
//   { trisar: 'demo', cmd: 'angebot', ride: '<ride_id>', antwort: 'zugesagt' | 'abgelehnt' }
// Die Antworten leben nur in diesem Browser-Tab (sessionStorage).
import { useEffect, useState } from 'react';

const SPEICHER = 'trisar_angebot_antworten_v1';

const lesen = () => {
  try { return JSON.parse(window.sessionStorage.getItem(SPEICHER) || '{}') || {}; } catch { return {}; }
};
let antworten = typeof window !== 'undefined' ? lesen() : {};
const hoerer = new Set();

export const angebotAntwort = (rideId) => antworten[String(rideId)] || 'offen';

export const angebotAntwortSetzen = (rideId, antwort) => {
  antworten = { ...antworten, [String(rideId)]: antwort };
  try { window.sessionStorage.setItem(SPEICHER, JSON.stringify(antworten)); } catch { /* nur im Speicher */ }
  hoerer.forEach((f) => f());
};

if (typeof window !== 'undefined') {
  window.addEventListener('message', (e) => {
    const d = e?.data;
    if (d && d.trisar === 'demo' && d.cmd === 'angebot' && d.ride && (d.antwort === 'zugesagt' || d.antwort === 'abgelehnt')) {
      angebotAntwortSetzen(d.ride, d.antwort);
    }
  });
  // Tutorial: ein Schritt kann die Antwort des Gasts setzen oder zuruecknehmen,
  // zustand: { angebot: { ride: '<ride_id>', antwort: 'zugesagt' | 'offen' } }.
  window.addEventListener('trisar:tutorial-zustand', (e) => {
    const a = e?.detail?.angebot;
    if (a && a.ride && ['zugesagt', 'abgelehnt', 'offen'].includes(a.antwort)) angebotAntwortSetzen(a.ride, a.antwort);
  });
}

// Neu rendern, sobald ein Gast antwortet.
export const useAngebotAntworten = () => {
  const [, setN] = useState(0);
  useEffect(() => {
    const f = () => setN((n) => n + 1);
    hoerer.add(f);
    return () => { hoerer.delete(f); };
  }, []);
};
