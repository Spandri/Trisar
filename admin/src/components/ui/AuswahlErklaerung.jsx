// Kurzer Erklaertext beim Einschalten der Mehrfachauswahl auf der Karte
// (Figma Koordinator_Screen_Map 2832:12528): Karte dahinter fast schwarz,
// Text mittig, fett und normal gemischt. Verschwindet nach ein paar Sekunden
// oder beim Antippen.
import { useEffect, useRef } from 'react';
import { useI18n } from '../../i18n';

const DAUER_MS = 6000;

// "**fett**" im Text als <strong>, Absaetze bei Leerzeile.
export const mitFett = (text) => String(text || '').split('**').map((teil, i) => (
  i % 2 === 1 ? <strong key={i} className="font-bold text-white">{teil}</strong> : <span key={i}>{teil}</span>
));

export default function AuswahlErklaerung({ onFertig }) {
  const { t } = useI18n();
  // onFertig kommt oft als neue Funktion je Render, die Zeit soll trotzdem nur einmal laufen.
  const fertigRef = useRef(onFertig);
  fertigRef.current = onFertig;
  useEffect(() => {
    const timer = window.setTimeout(() => fertigRef.current?.(), DAUER_MS);
    return () => window.clearTimeout(timer);
  }, []);
  return (
    <button
      type="button"
      onClick={onFertig}
      className="auswahl-erklaerung absolute inset-0 z-[30] flex items-center justify-center bg-black/80 px-[57px] pb-[107px]"
    >
      <span className="w-[287px] text-center text-white/85 text-[16px] font-normal leading-[24px] tracking-[0.5px] whitespace-pre-line font-['Space_Grotesk']">
        {mitFett(t('auswahl.erklaerung'))}
      </span>
    </button>
  );
}
