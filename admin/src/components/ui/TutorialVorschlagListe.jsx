import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

// Vorschlagsliste fuer Fahrer- und Fahrgastfelder waehrend des Demo-Tutorials.
//
// Im normalen Betrieb schlagen die Felder ueber ein natives <datalist> vor —
// dessen Eintraege liegen nicht im DOM und lassen sich vom Tutorial-Finger
// nicht antippen. Solange das Tutorial laeuft, erscheint stattdessen diese
// Liste (gleiche Optik wie die Adressvorschlaege) mit data-tutorial-Markern.
// Sie haengt am body, weil die Formularzeilen ihren Inhalt abschneiden
// (overflow-hidden), und folgt dem Feld pro Frame, falls gescrollt wird.

const GREEN = '#E3F654';
const ZEILEN_BREITE_MIN = 300;

// Die Formularzeile (362 px) statt nur das Eingabefeld als Anker nehmen,
// damit die Liste so breit ist wie die Zeile darueber.
const ankerRechteck = (input) => {
  let el = input;
  for (let i = 0; i < 6 && el; i += 1) {
    const r = el.getBoundingClientRect();
    if (r.width >= ZEILEN_BREITE_MIN) return r;
    el = el.parentElement;
  }
  return input.getBoundingClientRect();
};

export default function TutorialVorschlagListe({ inputRef, offen, eintraege = [], onWahl, onSchliessen }) {
  const [pos, setPos] = useState(null);

  useEffect(() => {
    if (!offen) return undefined;
    let raf = 0;
    let zuletzt = '';
    const messen = () => {
      const input = inputRef?.current;
      if (input) {
        const r = ankerRechteck(input);
        const schluessel = [r.left, r.bottom, r.width].map(Math.round).join(',');
        if (schluessel !== zuletzt) {
          zuletzt = schluessel;
          setPos({ left: r.left, top: r.bottom + 4, width: r.width });
        }
      }
      raf = requestAnimationFrame(messen);
    };
    raf = requestAnimationFrame(messen);
    return () => cancelAnimationFrame(raf);
  }, [offen, inputRef]);

  // Tipp ausserhalb von Feld und Liste schliesst die Liste.
  useEffect(() => {
    if (!offen) return undefined;
    const anDruck = (event) => {
      const input = inputRef?.current;
      const ziel = event.target;
      if (input && input.contains(ziel)) return;
      if (ziel instanceof Element && ziel.closest('[data-tutorial-vorschlagliste]')) return;
      onSchliessen?.();
    };
    document.addEventListener('pointerdown', anDruck, true);
    return () => document.removeEventListener('pointerdown', anDruck, true);
  }, [offen, inputRef, onSchliessen]);

  if (!offen || !pos || eintraege.length === 0) return null;

  return createPortal(
    <div
      data-tutorial-vorschlagliste=""
      className="fixed max-h-[180px] overflow-y-auto rounded-2xl border border-[#4a4f22] bg-[#151607]"
      style={{ left: `${pos.left}px`, top: `${pos.top}px`, width: `${pos.width}px`, zIndex: 300 }}
    >
      {eintraege.map((eintrag) => (
        <button
          key={eintrag.key}
          type="button"
          data-tutorial={eintrag.marker}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onWahl?.(eintrag)}
          className="w-full px-3 py-3 text-left text-[13px] font-medium border-b last:border-b-0 border-[#2a2d15]"
          style={{ color: GREEN, fontFamily: 'Space Grotesk' }}
        >
          {eintrag.label}
        </button>
      ))}
    </div>,
    document.body,
  );
}
