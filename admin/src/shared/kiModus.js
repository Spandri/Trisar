// Umschalter Regeln/Frei im KI-Assistenten (13.11.): "frei" laesst reine Fragen vom Modell mit den
// Live-Daten beantworten (dispo-admin freiKi.ts), Aktionen bleiben bei den Regeln. Pro Geraet gemerkt.
import { useEffect, useState } from 'react';

const SCHLUESSEL = 'trisar_ki_modus';
const hoerer = new Set();

export const kiModusLesen = () => {
  // Standard ist "frei" (Wunsch 13.11.), "regeln" nur wenn ausdruecklich gewaehlt.
  try { return window.localStorage.getItem(SCHLUESSEL) === 'regeln' ? 'regeln' : 'frei'; } catch { return 'frei'; }
};

export const kiModusSetzen = (modus) => {
  const neu = modus === 'regeln' ? 'regeln' : 'frei';
  try { window.localStorage.setItem(SCHLUESSEL, neu); } catch { /* privater Modus */ }
  hoerer.forEach((h) => h(neu));
};

export const useKiModus = () => {
  const [modus, setModus] = useState(kiModusLesen);
  useEffect(() => {
    hoerer.add(setModus);
    return () => { hoerer.delete(setModus); };
  }, []);
  return [modus, kiModusSetzen];
};
