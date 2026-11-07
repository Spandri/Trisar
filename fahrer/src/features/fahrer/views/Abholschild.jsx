import React, { useEffect, useState } from 'react';
import { useI18n } from '../../../i18n';

// Abholschild: Vollbild mit den Gaestenamen, gross und gedreht. Der Fahrer haelt
// das Handy quer hoch, der Gast liest seinen Namen von weitem.
// Hochkant-Ansicht: Text liegt quer (Oberkante des Textes an der linken Handykante).
// Liegt das Handy schon quer (Browser hat mitgedreht), bleibt der Text ungedreht.
// Ein Tipp aufs Schild dreht es um 180 Grad, falls die Handykante gerade falsch
// herum ist. Das X schliesst.
const istQuerformat = () => window.innerWidth > window.innerHeight;

export default function Abholschild({ namen, onClose }) {
  const { t } = useI18n();
  const [quer, setQuer] = useState(istQuerformat);
  const [umgedreht, setUmgedreht] = useState(false);
  const liste = (Array.isArray(namen) ? namen : [])
    .map((name) => String(name || '').trim())
    .filter(Boolean);

  useEffect(() => {
    const beiTaste = (event) => {
      if (event.key === 'Escape') onClose?.();
    };
    const beiGroesse = () => setQuer(istQuerformat());
    window.addEventListener('keydown', beiTaste);
    window.addEventListener('resize', beiGroesse);
    return () => {
      window.removeEventListener('keydown', beiTaste);
      window.removeEventListener('resize', beiGroesse);
    };
  }, [onClose]);

  // Schriftgroesse so, dass der laengste Name auf die lange Kante passt und alle
  // Zeilen zusammen auf die kurze Kante.
  const laengster = Math.max(1, ...liste.map((name) => name.length));
  const zeilen = Math.max(1, liste.length);
  const schriftgroesse = `min(${(150 / laengster).toFixed(2)}dvmax, ${(72 / zeilen).toFixed(2)}dvmin, 160px)`;
  const basisWinkel = quer ? 0 : -90;
  const winkel = basisWinkel + (umgedreht ? 180 : 0);

  return (
    <div
      className="fixed inset-0 z-[100] bg-black select-none"
      onClick={() => setUmgedreht((wert) => !wert)}
      data-tutorial="abholschild"
    >
      <div
        className="absolute left-1/2 top-1/2 flex flex-col items-center justify-center text-center gap-[0.15em]"
        style={{
          width: '100dvmax',
          height: '100dvmin',
          transform: `translate(-50%, -50%) rotate(${winkel}deg)`,
          fontSize: schriftgroesse,
        }}
      >
        {liste.map((name, idx) => (
          <div
            key={`schild-${idx}-${name}`}
            className="text-[#e2f754] font-bold tracking-[-0.04em] leading-[1.1] whitespace-nowrap px-[0.3em]"
          >
            {name}
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onClose?.();
        }}
        aria-label={t('abholschild.schliessen')}
        className="absolute right-[16px] w-[50px] h-[50px] rounded-full border border-[#747474] text-[#e2f754] text-[30px] leading-none flex items-center justify-center"
        style={{ top: 'max(16px, env(safe-area-inset-top))' }}
      >
        ×
      </button>
    </div>
  );
}
