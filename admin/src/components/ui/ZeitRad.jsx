// Drehrad wie bei Apple: Stunden und Minuten in 15-Minuten-Schritten, unten eingeblendet, "Fertig" schliesst.
// Gemeinsam fuer die Stundenerfassung der Dispo und "Dienste planen".
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const LIME = '#E3F654';
const schrift = { fontFamily: 'Space Grotesk' };
const RAD_ZEILE = 40;
const STUNDEN = Array.from({ length: 24 }, (_, i) => i);
const MINUTEN = [0, 15, 30, 45];
const zwei = (n) => String(n).padStart(2, '0');

function Rad({ werte, wert, setze }) {
  const ref = useRef(null);
  const timer = useRef(null);
  useEffect(() => {
    const i = Math.max(0, werte.indexOf(wert));
    if (ref.current) ref.current.scrollTop = i * RAD_ZEILE;
  // Nur beim Oeffnen auf den Startwert stellen, danach bestimmt das Drehen.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const gedreht = () => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const el = ref.current;
      if (!el) return;
      const i = Math.min(werte.length - 1, Math.max(0, Math.round(el.scrollTop / RAD_ZEILE)));
      setze(werte[i]);
    }, 80);
  };
  return (
    <div
      ref={ref}
      onScroll={gedreht}
      className="relative w-[90px] overflow-y-scroll overscroll-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      style={{ height: RAD_ZEILE * 5, scrollSnapType: 'y mandatory', maskImage: 'linear-gradient(transparent, #000 35%, #000 65%, transparent)', WebkitMaskImage: 'linear-gradient(transparent, #000 35%, #000 65%, transparent)' }}
    >
      <div style={{ height: RAD_ZEILE * 2 }} />
      {werte.map((w) => (
        <div
          key={w}
          onClick={() => { ref.current?.scrollTo({ top: werte.indexOf(w) * RAD_ZEILE, behavior: 'smooth' }); }}
          className="flex items-center justify-center text-[24px] font-bold text-white cursor-pointer"
          style={{ ...schrift, height: RAD_ZEILE, scrollSnapAlign: 'center' }}
        >
          {zwei(w)}
        </div>
      ))}
      <div style={{ height: RAD_ZEILE * 2 }} />
    </div>
  );
}

// leeren (optional): Knopf links, z. B. "Nicht senden", setzt das Feld wieder auf --:--.
export default function ZeitRad({ wert, setWert, schliessen, leeren = null, leerenText = 'Nicht senden' }) {
  const [h0, m0] = String(wert || '00:00').split(':').map(Number);
  // Auf die naechste Viertelstunde, damit das Rad einrastet.
  const gesamt = Math.round(((h0 || 0) * 60 + (m0 || 0)) / 15) * 15 % 1440;
  const [h, setH] = useState(Math.floor(gesamt / 60));
  const [m, setM] = useState(gesamt % 60);
  // setWert ist bei jedem Zeichnen neu: ueber eine Ref aufrufen, sonst laeuft der Effekt endlos.
  const setzen = useRef(setWert);
  useEffect(() => { setzen.current = setWert; });
  const start = useRef(`${zwei(Math.floor(gesamt / 60))}:${zwei(gesamt % 60)}`);
  useEffect(() => {
    const neu = `${zwei(h)}:${zwei(m)}`;
    if (neu !== start.current) { start.current = neu; setzen.current(neu); }
  }, [h, m]);
  return createPortal(
    <div className="fixed inset-0 z-[300] bg-black/60 flex items-end justify-center" onClick={schliessen}>
      <div className="w-[min(402px,100vw)] bg-[#1c1c1e] rounded-t-[14px] pb-[34px]" onClick={(e) => e.stopPropagation()}>
        <div className={`h-[48px] px-5 flex items-center border-b border-white/10 ${leeren ? 'justify-between' : 'justify-end'}`}>
          {leeren ? (
            <button type="button" onClick={() => { leeren(); schliessen(); }} className="text-[17px] font-bold" style={{ ...schrift, color: '#FF6F63' }}>{leerenText}</button>
          ) : null}
          <button type="button" onClick={schliessen} className="text-[17px] font-bold" style={{ ...schrift, color: LIME }}>Fertig</button>
        </div>
        <div className="relative mt-[12px] flex justify-center items-center gap-[4px]">
          <div className="absolute left-[20px] right-[20px] rounded-[8px] bg-white/10 pointer-events-none" style={{ top: RAD_ZEILE * 2, height: RAD_ZEILE }} />
          <Rad werte={STUNDEN} wert={h} setze={setH} />
          <span className="text-[24px] font-bold text-white" style={schrift}>:</span>
          <Rad werte={MINUTEN} wert={m} setze={setM} />
        </div>
      </div>
    </div>,
    document.body,
  );
}

