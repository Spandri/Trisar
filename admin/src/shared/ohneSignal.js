// Fahrer lange ohne Signal (15.11., Pilotkunde): Wer laenger als die Schwelle keinen Standort
// mehr schickt (App oder OBD-Tracker, captured_at in driver_live_locations), verschwindet von
// der Dispo-Karte. Im Karten-Filter: Stunden-Feld fuer die Schwelle und daneben der Knopf
// "Ausblenden" (aus = alle zeigen, gespeichert als zeigen). Je Geraet gemerkt (localStorage),
// gleich wie iOS und Android.
import { useSyncExternalStore } from 'react';

// Schwelle in Minuten gespeichert, im Filter in Stunden eingetippt (0,25 bis 24 h).
export const SCHWELLE_MIN = 15;
export const SCHWELLE_MAX = 1440;
export const SCHWELLE_STANDARD = 30;

const SCHLUESSEL = 'trisar.karte.ohneSignal';

const lesen = () => {
  try {
    const roh = JSON.parse(window.localStorage.getItem(SCHLUESSEL) || '{}');
    const minuten = Number(roh?.minuten);
    return {
      minuten: Number.isFinite(minuten) ? Math.max(SCHWELLE_MIN, Math.min(SCHWELLE_MAX, minuten)) : SCHWELLE_STANDARD,
      zeigen: roh?.zeigen === true,
    };
  } catch {
    return { minuten: SCHWELLE_STANDARD, zeigen: false };
  }
};

let stand = lesen();
// Zuletzt auf der Karte ausgeblendete Fahrer (fuer die Zeile im Filter), nur im Speicher.
let ausgeblendet = [];
const hoerer = new Set();
const melden = () => hoerer.forEach((fn) => fn());
const abonnieren = (fn) => { hoerer.add(fn); return () => hoerer.delete(fn); };

export const ohneSignalSetzen = (aenderung) => {
  stand = { ...stand, ...aenderung };
  try { window.localStorage.setItem(SCHLUESSEL, JSON.stringify(stand)); } catch { /* privat, egal */ }
  melden();
};

export const ausgeblendetMerken = (liste) => {
  const alt = ausgeblendet.map((f) => `${f.id}|${f.letztesSignal}`).join(',');
  const neu = liste.map((f) => `${f.id}|${f.letztesSignal}`).join(',');
  if (alt === neu) return;
  ausgeblendet = liste;
  melden();
};

export const useOhneSignal = () => useSyncExternalStore(abonnieren, () => stand);
export const useAusgeblendet = () => useSyncExternalStore(abonnieren, () => ausgeblendet);

// Zu lange still? Ohne Zeitstempel zaehlt nicht (Demo, alte Zeilen).
export const zuLangeOhneSignal = (letztesSignal, minuten, jetztMs = Date.now()) => {
  if (!letztesSignal) return false;
  const zeit = new Date(letztesSignal).getTime();
  if (!Number.isFinite(zeit)) return false;
  return jetztMs - zeit >= minuten * 60000;
};

// Minuten als Stunden mit Komma: 30 -> "0,5", 90 -> "1,5", 15 -> "0,25".
export const stundenText = (minuten) => String(Number((minuten / 60).toFixed(2))).replace('.', ',');

// "1,5" / "1.5" / "2" -> Minuten (auf 0,25 bis 24 h begrenzt), sonst null.
export const stundenLesen = (text) => {
  const h = Number(String(text || '').trim().replace(',', '.'));
  if (!Number.isFinite(h) || h <= 0) return null;
  return Math.max(SCHWELLE_MIN, Math.min(SCHWELLE_MAX, Math.round(h * 60)));
};
