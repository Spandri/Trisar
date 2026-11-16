// Dienstreise, Zugabschnitt (Entwurf 14.11.): Verspaetung auf einen Blick (Zeit orange + Kachel "+5")
// und die Zwischenhalte zum Ausklappen mit Strahl links (gefahren Lime, Rest grau, aktueller Halt als Ring).
// Gleich in fahrer/src/features/fahrer/views/ZugHalte.jsx.
import React, { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { minutenSpaet, zeitFarbe } from '../../shared/dienstreise';

const LIME_ZEIT = '#E3F654';
const ORANGE = '#F0997B';
const OFFEN = '#5c5c5c';
const GRAU_TEXT = '#868687';

// Kleine Kachel "+5" rechts neben einer verspaeteten Zeit, nichts bei puenktlich.
export function SpaetKachel({ min, gefahren = false, className = '' }) {
  if (!min) return null;
  // Spaet orange "+5", zu frueh gruen "-2" (14.11.).
  const frueh = min < 0;
  return (
    <span
      className={`inline-block shrink-0 text-[13px] leading-[16px] font-bold whitespace-nowrap align-middle ${className}`}
      style={{ background: gefahren ? '#3a3a3a' : (frueh ? '#59BE80' : ORANGE), color: gefahren ? GRAU_TEXT : '#000', borderRadius: 8, padding: '2px 8px' }}
    >
      {frueh ? `\u2212${-min}` : `+${min}`}
    </span>
  );
}

const minuten = (v) => {
  const t = /^(\d{1,2}):(\d{2})/.exec(String(v || ''));
  return t ? Number(t[1]) * 60 + Number(t[2]) : null;
};

/**
 * Halte eines Zugabschnitts zum Ausklappen.
 * @param halte   [{ name, an_plan, an, ab_plan, ab, gleis }] ohne Start/Ziel
 * @param status  'fertig' | 'jetzt' | 'offen' (Abschnitt gefahren, laeuft gerade, kommt noch)
 * @param abfahrt Ist-Abfahrt des Abschnitts (HH:MM), Bezug fuer Fahrten ueber Mitternacht
 * @param jetzt   Zeitpunkt in ms (vom Aufrufer, alle 30 s neu)
 */
export function HalteListe({ halte, status = 'offen', abfahrt = '', jetzt }) {
  const [offen, setOffen] = useState(false);
  if (!Array.isArray(halte) || !halte.length) return null;

  // Gefahren: Ist-Zeit (ab, sonst an) liegt vor jetzt. Gerechnet ab der Abfahrt des Abschnitts.
  const d = new Date(jetzt);
  const jetztMin = d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;
  const basis = minuten(abfahrt) ?? minuten(halte[0].ab || halte[0].an) ?? 0;
  const seit = (m) => (m - basis + 1440) % 1440;
  const gefahren = halte.map((h) => {
    if (status === 'fertig') return true;
    if (status !== 'jetzt') return false;
    const m = minuten(h.ab || h.an);
    return m != null && seit(m) < seit(jetztMin);
  });
  const aktuell = status === 'jetzt' ? gefahren.indexOf(false) : -1;

  const kachel = (inhalt, oben) => (
    <button
      type="button"
      onClick={() => setOffen(!offen)}
      className="w-full mt-[12px] bg-[#242525] rounded-[10px] px-[14px] py-[10px] flex items-center gap-[8px] text-left active:opacity-70"
    >
      <ChevronDown size={18} strokeWidth={3} color={LIME_ZEIT} style={{ transform: oben ? 'rotate(180deg)' : 'none' }} />
      <span className="text-[16px] font-bold tracking-[-0.3px]" style={{ color: LIME_ZEIT }}>{inhalt}</span>
    </button>
  );

  if (!offen) return kachel(`${halte.length} Halte`, false);

  return (
    <>
      <div className="mt-[12px]">
        {halte.map((h, i) => {
          const weg = gefahren[i];
          const hier = i === aktuell;
          const zeit = h.ab || h.an || '';
          const plan = h.ab ? h.ab_plan : h.an_plan;
          const spaet = minutenSpaet(plan, zeit);
          // Strahl: Stueck vor dem Halt gefahren, wenn der vorige Halt gefahren ist (erster: Abschnitt laeuft).
          const vorher = i === 0 ? status !== 'offen' : gefahren[i - 1];
          const nachher = weg;
          return (
            <div key={`${h.name}-${i}`} className="relative flex items-center gap-[12px] min-h-[40px]">
              <div className="relative w-[20px] self-stretch shrink-0 flex items-center justify-center">
                <span className="absolute left-1/2 -translate-x-1/2 top-0 h-1/2 w-[3px]" style={{ background: vorher ? LIME_ZEIT : OFFEN }} />
                <span className="absolute left-1/2 -translate-x-1/2 bottom-0 h-1/2 w-[3px]" style={{ background: nachher ? LIME_ZEIT : OFFEN }} />
                {hier ? (
                  <span className="relative w-[20px] h-[20px] rounded-full box-border bg-[#1a1a1a]" style={{ border: `3px solid ${LIME_ZEIT}` }} />
                ) : (
                  <span className="relative w-[12px] h-[12px] rounded-full" style={{ background: weg ? LIME_ZEIT : OFFEN }} />
                )}
              </div>
              <span className="flex-1 min-w-0 text-[16px] font-bold tracking-[-0.3px] truncate" style={{ color: weg ? GRAU_TEXT : '#fff' }}>{h.name}</span>
              {zeit ? (
                <span className="shrink-0 flex items-center gap-[6px]">
                  <span className="text-[16px] font-bold" style={{ color: weg ? GRAU_TEXT : zeitFarbe(spaet) }}>{zeit}</span>
                  <SpaetKachel min={spaet} gefahren={weg} />
                </span>
              ) : null}
            </div>
          );
        })}
      </div>
      {kachel('Halte', true)}
    </>
  );
}
