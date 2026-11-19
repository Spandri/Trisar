import KiModusSchalter from './KiModusSchalter';
import { DEMO_MODE } from '../../datenquelle';
import { useEffect, useRef, useState } from 'react';
import {
  erkennungStarten, istJa, istNein, pegelStarten, spracheMoeglich, vorlesen,
} from '../../shared/sprache';

// Voice-Modus des KI-Assistenten (Design abgenommen 13.11.).
// Kugel mit dem Verlauf des Planungs-Knopfs. Zuhoeren: bewegt sich mit der Stimme.
// Denkt: dreht und wirbelt, mal mehr Blau, mal mehr Gelb. Spricht: Farben stehen,
// die Kugel atmet mit, Ringe laufen. Rueckfrage: weisse Karte, „ja“ oder „nein“.

// Hoehen der Balken aus der Aufnahme von „TRISAR“ (Screenshot vom User).
const TRISAR_BALKEN_KLEIN = [0.3, 0.38, 0.97, 1, 0.82, 0.5, 0.68, 0.44, 0.16];

export function SprechenKnopf({ onClick, className = '' }) {
  return (
    <button
      type="button"
      aria-label="Sprechen"
      title="Sprechen"
      onClick={onClick}
      onMouseDown={(e) => e.preventDefault()}
      className={`w-12 h-12 shrink-0 rounded-full border-[1.5px] border-[#E3F654] bg-black/40 flex items-center justify-center gap-[2px] active:scale-95 transition-transform ${className}`}
    >
      {TRISAR_BALKEN_KLEIN.map((v, i) => (
        <span key={i} className="block w-[2px] rounded-full bg-[#E3F654]" style={{ height: `${Math.max(2, Math.round(v * 24))}px` }} />
      ))}
    </button>
  );
}

const verlaufBei = (m) => `linear-gradient(90deg, rgba(0,89,255,0.78) 0%, rgba(0,89,255,0.78) ${(m - 24.5).toFixed(1)}%, #000 ${m.toFixed(1)}%, hsl(66 44% 58%) ${(m + 64.5).toFixed(1)}%)`;

function Kugel({ modus, pegelRef, onClick, groesse = 200 }) {
  const huelleRef = useRef(null);
  const farbeRef = useRef(null);
  const modusRef = useRef(modus);
  useEffect(() => { modusRef.current = modus; }, [modus]);

  useEffect(() => {
    const ruhig = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const z = {
      t: 0, glatt: 0, winkel: 22.66, dw: 0, dx: 0, dy: 0, mitte: 55.9, zx: 0, zy: 0, zm: 55.9, zw: 1,
    };
    let rahmen = 0;
    const schritt = () => {
      const m = modusRef.current;
      z.t += 1;
      z.glatt += ((pegelRef.current || 0) - z.glatt) * 0.18;
      let s = 1;
      if (m === 'hoeren' || m === 'frage') {
        z.dw = z.glatt * 2.2;
        s = 1 + z.glatt * 0.12;
        z.dx = Math.sin(z.t / 23) * z.glatt * 40;
        z.dy = Math.cos(z.t / 31) * z.glatt * 40;
      } else if (m === 'sprechen') {
        z.dw *= 0.85;
        s = 1 + z.glatt * 0.1;
        z.dx *= 0.9;
        z.dy *= 0.9;
      } else if (m === 'denken') {
        if (z.t % 45 === 0) {
          z.zx = (Math.random() - 0.5) * 140;
          z.zy = (Math.random() - 0.5) * 140;
          z.zm = 40 + Math.random() * 32;
          z.zw = (Math.random() < 0.5 ? -1 : 1) * (2 + Math.random() * 5);
        }
        z.dx += (z.zx - z.dx) * 0.05;
        z.dy += (z.zy - z.dy) * 0.05;
        z.dw += (z.zw - z.dw) * 0.06;
        s = 1 + Math.sin(z.t / 11) * 0.05;
      } else {
        z.dw *= 0.9;
        z.dx *= 0.95;
        z.dy *= 0.95;
      }
      z.mitte += ((m === 'denken' ? z.zm : 55.9) - z.mitte) * (m === 'denken' ? 0.04 : 0.03);
      if (ruhig) { z.dw = 0; z.dx = 0; z.dy = 0; s = 1; }
      z.winkel += z.dw;
      if (farbeRef.current) {
        farbeRef.current.style.background = verlaufBei(z.mitte);
        farbeRef.current.style.transform = `translate(${z.dx.toFixed(1)}px, ${z.dy.toFixed(1)}px) rotate(${z.winkel.toFixed(2)}deg)`;
      }
      if (huelleRef.current) huelleRef.current.style.transform = `scale(${s.toFixed(3)})`;
      rahmen = window.requestAnimationFrame(schritt);
    };
    rahmen = window.requestAnimationFrame(schritt);
    return () => window.cancelAnimationFrame(rahmen);
  }, [pegelRef]);

  return (
    <div className="relative transition-[width,height] duration-300" style={{ width: `${groesse}px`, height: `${groesse}px` }}>
      {modus === 'sprechen' ? (
        <>
          <span className="sprach-ring" />
          <span className="sprach-ring sprach-ring-2" />
        </>
      ) : null}
      <button
        type="button"
        ref={huelleRef}
        onClick={onClick}
        aria-label={modus === 'sprechen' ? 'Unterbrechen' : 'Kugel'}
        className="absolute inset-0 rounded-full overflow-hidden isolate border-2 border-[#e2f754]"
        style={{ filter: modus === 'stumm' ? 'grayscale(1) brightness(0.6)' : 'none' }}
      >
        <span ref={farbeRef} className="absolute left-1/2 top-1/2 w-[480px] h-[480px] -ml-[240px] -mt-[240px] will-change-transform" />
      </button>
    </div>
  );
}

const STATUS = {
  hoeren: 'Ich höre zu',
  denken: 'Einen Moment',
  sprechen: 'Spricht, zum Unterbrechen Kugel antippen',
  hoerenText: 'Ich höre zu, Kugel antippen schickt sofort ab',
  frage: 'Ich höre zu, sag „ja“ oder „nein“',
  stumm: 'Mikro aus',
  fehler: '',
};

// onSenden(text) -> Promise<{ text, offen }>, offen = { titel, zeile } wenn eine Bestaetigung wartet.
// onJa() / onNein() -> Promise<{ text, offen }> fuer Karten, die im Chat bestaetigt werden.
// vorschlag: die Karten der juengsten Antwort mit ihren Knoepfen, gerendert wie im Chat.
// vorschlagOffen: wartet davon noch etwas auf Bestaetigung (Knopf oder „ja“)?
export default function SprachModus({
  onSenden, onJa, onNein, onSchliessen, vorschlag = null, vorschlagId = null, vorschlagOffen = false,
}) {
  const [modus, setModus] = useState('hoeren');
  const [zeile, setZeile] = useState('');
  const [gehoert, setGehoert] = useState('');
  const [zeileHell, setZeileHell] = useState(false);
  const [offen, setOffen] = useState(null);
  const [fehler, setFehler] = useState(() => (spracheMoeglich() ? '' : 'Dieser Browser kann keine Sprache erkennen. Bitte Chrome nutzen.'));
  const [stumm, setStumm] = useState(false);
  const pegelRef = useRef(0);
  const stimmeRef = useRef(0);
  const offenRef = useRef(null);
  const propsRef = useRef({});
  const ablaufRef = useRef(null);
  useEffect(() => {
    propsRef.current = { onSenden, onJa, onNein };
  }, [onSenden, onJa, onNein]);

  // Der ganze Ablauf lebt in einem Objekt, das beim Oeffnen einmal entsteht.
  // So greifen Mikro, Erkennung und Vorlesen nie auf veraltete Zustaende zu.
  useEffect(() => {
    let lebt = true;
    let erkennung = null;
    let mikro = null;
    let vorleser = null;
    let ruhe = false;
    let beschaeftigt = false; // denkt oder spricht gerade, dann nicht zuhoeren

    const zuhoerenStoppen = () => {
      erkennung?.stoppen();
      erkennung = null;
      mikro?.stoppen();
      mikro = null;
      pegelRef.current = 0;
    };

    const offenSetzen = (o) => { offenRef.current = o; setOffen(o); };

    let zuhoeren;
    const sprechen = async (antwort) => {
      if (!lebt) return;
      offenSetzen(antwort?.offen || null);
      setZeile(antwort?.text || '');
      setZeileHell(true);
      setModus('sprechen');
      const v = vorlesen(antwort?.text || '', { onPegel: (pg) => { pegelRef.current = pg; } });
      vorleser = v;
      await v.fertig;
      if (vorleser !== v || !lebt) return;
      vorleser = null;
      beschaeftigt = false;
      zuhoeren(antwort?.offen ? 'frage' : 'hoeren');
    };

    const satzVerarbeiten = async (satz) => {
      beschaeftigt = true;
      zuhoerenStoppen();
      setZeile(satz);
      setZeileHell(false);
      setModus('denken');
      let antwort;
      try {
        const wartet = offenRef.current;
        const p = propsRef.current;
        if (wartet?.lokal && istJa(satz)) antwort = await p.onJa();
        else if (wartet?.lokal && istNein(satz)) antwort = await p.onNein();
        else antwort = await p.onSenden(satz);
      } catch (e) {
        antwort = { text: `Das hat nicht geklappt. ${e?.message || ''}`.trim() };
      }
      await sprechen(antwort);
    };

    zuhoeren = async (naechster = 'hoeren') => {
      if (!lebt) return;
      zuhoerenStoppen();
      if (ruhe) { setModus('stumm'); return; }
      setModus(naechster);
      if (naechster === 'hoeren') setZeile('');
      setGehoert('');
      const m = await pegelStarten((pg) => {
        pegelRef.current = pg;
        if (pg > 0.12) stimmeRef.current = Date.now();
      });
      if (!lebt || ruhe) { m.stoppen(); return; }
      mikro = m;
      if (!m.erlaubt) {
        setFehler('Kein Zugriff aufs Mikrofon. Bitte in den Browser-Einstellungen erlauben.');
        return;
      }
      stimmeRef.current = 0;
      erkennung = erkennungStarten({
        letzteStimme: () => stimmeRef.current,
        frage: naechster === 'frage',
        onZwischen: (txt) => {
          setGehoert(txt);
          if (naechster === 'hoeren') { setZeile(txt); setZeileHell(false); }
        },
        onSatz: (s) => { satzVerarbeiten(s); },
        onFehler: (f) => {
          if (f === 'not-allowed' || f === 'service-not-allowed') setFehler('Spracherkennung ist nicht erlaubt.');
          else if (f === 'nicht_unterstuetzt') setFehler('Dieser Browser kann keine Sprache erkennen. Bitte Chrome nutzen.');
        },
      });
    };

    ablaufRef.current = {
      jetztSenden() { erkennung?.jetztSenden(); },
      // Ja/Nein-Knopf an der Rueckfrage (18.11.): wie gesprochenes "ja" bzw. "nein", auch mitten im Vorlesen.
      knopf(ja) {
        if (!offenRef.current) return;
        if (vorleser) { vorleser.stoppen(); vorleser = null; }
        else if (beschaeftigt) return;
        satzVerarbeiten(ja ? 'ja' : 'nein');
      },
      unterbrechen() {
        if (!vorleser) return;
        vorleser.stoppen();
        vorleser = null;
        beschaeftigt = false;
        zuhoeren(offenRef.current ? 'frage' : 'hoeren');
      },
      // Ein Vorschlag wurde per Knopf erledigt: Rueckfrage beenden, normal weiter zuhoeren.
      offenLoesen() {
        if (!offenRef.current?.lokal) return;
        offenSetzen(null);
        if (!beschaeftigt && !ruhe && !vorleser) zuhoeren('hoeren');
      },
      stummSetzen(an) {
        ruhe = an;
        if (an) { zuhoerenStoppen(); setModus((m) => (m === 'hoeren' || m === 'frage' ? 'stumm' : m)); }
        else if (!beschaeftigt) zuhoeren(offenRef.current ? 'frage' : 'hoeren');
      },
    };

    if (spracheMoeglich()) zuhoeren('hoeren');
    return () => {
      lebt = false;
      zuhoerenStoppen();
      vorleser?.stoppen();
      window.speechSynthesis?.cancel();
    };
  }, []);

  // Per Knopf bestaetigt oder verworfen: Ergebnis kurz stehen lassen, dann weiter wie normal.
  useEffect(() => {
    if (vorschlagOffen || !offen?.lokal || offen.id !== vorschlagId) return undefined;
    const t = window.setTimeout(() => ablaufRef.current?.offenLoesen(), 2500);
    return () => window.clearTimeout(t);
  }, [vorschlagOffen, offen, vorschlagId]);

  const mitKarten = Boolean(vorschlag && offen?.lokal && offen.id === vorschlagId);

  const kugelTippen = () => {
    if (modus === 'sprechen') ablaufRef.current?.unterbrechen();
    else if (modus === 'hoeren' || modus === 'frage') ablaufRef.current?.jetztSenden();
  };

  const mikroUmschalten = () => {
    const an = !stumm;
    setStumm(an);
    ablaufRef.current?.stummSetzen(an);
  };

  const status = fehler || (modus === 'hoeren' && zeile ? STATUS.hoerenText : STATUS[modus]) || '';

  return (
    <div className="absolute inset-0 z-[80] bg-black flex flex-col items-center font-['Space_Grotesk'] text-white">
      <div className="mt-[72px] inline-flex items-center gap-2">
        <img src="/icon/_Icon_Lime/KI_Trisar_Icons_01_Lime.svg" alt="" className="w-[14px] h-[13px]" />
        <span className="text-[#E3F654] text-[10px] font-bold leading-4">KI Assistent</span>
      </div>
      {!DEMO_MODE ? <KiModusSchalter className="mt-[14px]" /> : null}
      <div className={`${DEMO_MODE ? 'mt-[56px]' : 'mt-[18px]'} h-5 text-[13px] text-center px-6 ${fehler ? 'text-[#ff6f63]' : 'text-[#a0a0a0]'}`}>{status}</div>
      <div className={mitKarten ? 'mt-[20px]' : 'mt-[40px]'}>
        <Kugel modus={modus} pegelRef={pegelRef} onClick={kugelTippen} groesse={mitKarten ? 120 : 200} />
      </div>
      {mitKarten ? (
        <>
          {/* Was gerade gehoert wird, wie beim normalen Zuhoeren */}
          <div className="mt-[12px] w-[calc(100%-48px)] max-w-[340px] min-h-[24px] text-center text-[15px] leading-[22px] font-medium text-[#a0a0a0]">
            {modus === 'frage' || modus === 'hoeren' ? gehoert : ''}
          </div>
          {/* Die Vorschlaege wie im Chat: Karte antippen, Buchen, Nicht buchen. */}
          <div className="mt-[8px] w-full flex-1 min-h-0 overflow-y-auto overscroll-contain px-[20px] pb-[130px] flex flex-col items-center">
            {offen?.titel ? (
              <div className="w-full max-w-[362px] bg-white text-black p-[16px] mb-[12px] text-[17px] leading-[22px] font-bold break-words whitespace-pre-line">{offen.titel}</div>
            ) : null}
            {vorschlag}
          </div>
        </>
      ) : offen && (modus === 'frage' || modus === 'sprechen' || modus === 'denken') ? (
        <>
          {/* Bis knapp ueber Mikro und X, langer Text scrollt (18.11.). */}
          <div className="mt-[36px] w-[calc(100%-40px)] max-w-[362px] min-h-0 max-h-[calc(100%-630px)] overflow-y-auto overscroll-contain bg-white text-black p-[16px] shrink">
            <div className="text-[20px] leading-[24px] font-bold break-words">{offen.titel}</div>
            {offen.zeile ? <div className="mt-[4px] text-xs leading-4 font-medium opacity-80 break-words">{offen.zeile}</div> : null}
          </div>
          {/* Ja/Nein wie Annehmen/Ablehnen (Neuplanung): Nein rot umrandet, Ja lime. Nur bei Ja/Nein-Fragen (19.11.). */}
          {offen.jaNein === false ? null : <div className={`mt-[12px] w-[calc(100%-40px)] max-w-[362px] flex gap-[6px] shrink-0 ${modus === 'denken' ? 'opacity-40' : ''}`}>
            <button type="button" onClick={() => ablaufRef.current?.knopf(false)}
              className="flex-1 h-[51px] border-2 border-[#FF6F63] text-[#FF6F63] text-[24px] font-bold tracking-[-0.5px]">Nein</button>
            <button type="button" onClick={() => ablaufRef.current?.knopf(true)}
              className="flex-1 h-[51px] bg-[#E3F654] text-black text-[24px] font-bold tracking-[-0.5px]">Ja</button>
          </div>}
          {/* Was gerade gehoert wird, wie beim normalen Zuhoeren */}
          <div className="mt-[16px] w-[calc(100%-48px)] max-w-[340px] min-h-[24px] text-center text-[17px] leading-[24px] font-medium text-[#a0a0a0]">
            {modus === 'frage' ? gehoert : ''}
          </div>
        </>
      ) : (
        <div
          className={`mt-[36px] w-[calc(100%-48px)] max-w-[340px] min-h-[72px] max-h-[calc(100%-560px)] overflow-y-auto overscroll-contain text-center text-[17px] leading-[24px] font-medium ${zeileHell ? 'text-white' : 'text-[#a0a0a0]'}`}
          style={{ userSelect: 'text', WebkitUserSelect: 'text' }}
        >
          {zeile}
        </div>
      )}
      <div className="absolute bottom-[44px] left-0 right-0 flex justify-center gap-[36px]">
        <button
          type="button"
          aria-label={stumm ? 'Mikro an' : 'Mikro aus'}
          onClick={mikroUmschalten}
          className={`w-[56px] h-[56px] rounded-full bg-[#242525] border flex items-center justify-center ${modus === 'stumm' ? 'border-[#ff6f63] text-[#ff6f63]' : 'border-[#3A3A3A] text-white'}`}
        >
          <svg viewBox="0 0 24 24" className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="9" y="3" width="6" height="11" rx="3" />
            <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
            {modus === 'stumm' ? <path d="M4 4l16 16" /> : null}
          </svg>
        </button>
        <button
          type="button"
          aria-label="Beenden"
          onClick={onSchliessen}
          className="w-[56px] h-[56px] rounded-full border-2 border-[#ff6f63] text-[#ff6f63] flex items-center justify-center"
        >
          <svg viewBox="0 0 24 24" className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>
    </div>
  );
}
