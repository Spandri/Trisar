import { useState } from 'react';
import BackCircleButton from '../ui/BackCircleButton';
import TrisarFooter from '../ui/TrisarFooter';
import {
  ereignisAendern, ereignisAusText, ereignisEntfernen, ereignisHinzufuegen, ereignisWiederherstellen,
  ereignisseFuerTag, entfernteEreignisse, useEreignisAenderungen, useRisikoDaten,
} from '../../demo/risikoErgebnisse';
import { DUNKEL, LIME, ROT } from './risikoFarben';

// Ereignisse eines Einsatztages: was die Engine automatisch eingerechnet hat
// (mit Quelle) und was die Disposition ergaenzt, anpasst oder entfernt.
// Eigene Aenderungen rechnet die Demo nicht neu, das sagt die Seite auch.

const HINTERGRUND = {
  backgroundImage:
    "url(\"data:image/svg+xml;utf8,<svg viewBox='0 0 402 873' xmlns='http://www.w3.org/2000/svg' preserveAspectRatio='none'><rect x='0' y='0' height='100%' width='100%' fill='url(%23grad)' opacity='1'/><defs><radialGradient id='grad' gradientUnits='userSpaceOnUse' cx='0' cy='0' r='10' gradientTransform='matrix(43.25 96.3 -44.344 19.869 1.3947e-15 1.9384e-13)'><stop stop-color='rgba(49,55,1,1)' offset='0'/><stop stop-color='rgba(25,28,0,1)' offset='0.2283'/><stop stop-color='rgba(12,14,0,1)' offset='0.34244'/><stop stop-color='rgba(0,0,0,1)' offset='0.45659'/><stop stop-color='rgba(0,0,0,1)' offset='0.6782'/><stop stop-color='rgba(0,6,16,1)' offset='0.69832'/><stop stop-color='rgba(0,11,32,1)' offset='0.71843'/><stop stop-color='rgba(0,22,64,1)' offset='0.75865'/><stop stop-color='rgba(0,33,96,1)' offset='0.79888'/><stop stop-color='rgba(0,45,128,1)' offset='0.8391'/><stop stop-color='rgba(0,67,191,1)' offset='0.91955'/><stop stop-color='rgba(0,89,255,1)' offset='1'/></radialGradient></defs></svg>\")",
  backgroundSize: '100% 100%',
  backgroundRepeat: 'no-repeat',
};

const datumText = (iso) => new Date(`${iso}T12:00:00`)
  .toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'short' });

const plusMin = (wirkung) => {
  const m = String(wirkung || '').match(/\+(\d+)\s*min/);
  return m ? Number(m[1]) : null;
};

function Zeile({ label, wert }) {
  return (
    <>
      <span className="opacity-55">{label}</span>
      <span className="font-medium">{wert}</span>
    </>
  );
}

function Knopf({ children, onClick, art = 'rand' }) {
  const stil = {
    rand: { border: `2px solid ${DUNKEL}`, color: DUNKEL, background: 'transparent' },
    rot: { border: `2px solid ${ROT}`, color: ROT, background: 'transparent' },
    voll: { border: `2px solid ${LIME}`, color: '#000', background: LIME },
    grau: { border: '2px solid #c9c9c9', color: '#888', background: 'transparent' },
  }[art];
  return (
    <button type="button" onClick={onClick} className="flex-1 h-[36px] text-[13px] font-medium" style={stil}>
      {children}
    </button>
  );
}

function EreignisKarte({ e, iso }) {
  const [bearbeiten, setBearbeiten] = useState(false);
  const zusatzAlt = plusMin(e.wirkung);
  const [von, setVon] = useState(e.von || '');
  const [bis, setBis] = useState(e.bis || '');
  const [zusatz, setZusatz] = useState(zusatzAlt ?? '');
  const eigen = e.quelleArt === 'eigen';

  const speichern = () => {
    const werte = {};
    // Zeit nur ersetzen, wenn sie geaendert wurde (sonst blieben zwei Fenster nicht erhalten)
    if (von && bis && (von !== (e.von || '') || bis !== (e.bis || ''))) Object.assign(werte, { von, bis, zeit: `${von}–${bis}` });
    if (zusatzAlt != null && zusatz !== '' && Number(zusatz) !== zusatzAlt) {
      werte.wirkung = e.wirkung.replace(/\+\d+\s*min/, `+${Number(zusatz)} min`);
    }
    if (Object.keys(werte).length) ereignisAendern(iso, e.id, werte);
    setBearbeiten(false);
  };

  return (
    <div
      className="bg-[#fefffe] px-[16px] py-[14px]"
      style={{ color: DUNKEL, outline: bearbeiten ? `2px solid ${LIME}` : 'none', outlineOffset: '-2px' }}
    >
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-bold px-[6px] py-[2px]" style={{ background: eigen ? LIME : '#e9e9e9' }}>
          {eigen ? 'von dir' : e.angepasst ? 'automatisch · angepasst' : 'automatisch'}
        </span>
        {e.fahrten != null ? <span className="text-[12px] font-bold">{`${e.fahrten} ${e.fahrten === 1 ? 'Fahrt' : 'Fahrten'}`}</span> : null}
      </div>
      <p className="text-[18px] font-bold tracking-[-0.3px] mt-[8px]">{e.titel}</p>
      {e.zusatz ? <p className="text-[12px] opacity-60">{e.zusatz}</p> : null}
      <div className="grid gap-x-[8px] gap-y-[3px] mt-[8px] text-[12px] leading-[16px]" style={{ gridTemplateColumns: '64px 1fr' }}>
        <Zeile label="Zeit" wert={e.zeit} />
        <Zeile label="Wirkung" wert={e.wirkung} />
        <Zeile label="Quelle" wert={e.quelle} />
      </div>

      {bearbeiten ? (
        <div className="mt-[10px] bg-[#f3f3f3] px-[12px] py-[10px] text-[13px]">
          <p className="text-[11px] opacity-60 mb-[6px]">Wird angepasst</p>
          <label className="flex items-center gap-[8px] h-[32px]">
            <span className="w-[40px] opacity-55">Zeit</span>
            <input type="time" value={von} onChange={(ev) => setVon(ev.target.value)} className="bg-white px-[6px] h-[28px] border border-[#d9d9d9]" />
            <span className="opacity-40">–</span>
            <input type="time" value={bis} onChange={(ev) => setBis(ev.target.value)} className="bg-white px-[6px] h-[28px] border border-[#d9d9d9]" />
          </label>
          {zusatzAlt != null ? (
            <label className="flex items-center gap-[8px] h-[32px]">
              <span className="w-[40px] opacity-55">bis +</span>
              <input
                type="number"
                min="0"
                max="120"
                value={zusatz}
                onChange={(ev) => setZusatz(ev.target.value)}
                className="bg-white px-[6px] h-[28px] w-[64px] border border-[#d9d9d9]"
              />
              <span>min</span>
            </label>
          ) : null}
        </div>
      ) : null}

      <div className="flex gap-[8px] mt-[12px]">
        {bearbeiten ? (
          <>
            <Knopf art="voll" onClick={speichern}>Speichern</Knopf>
            <Knopf art="grau" onClick={() => setBearbeiten(false)}>Abbrechen</Knopf>
          </>
        ) : (
          <>
            <Knopf onClick={() => setBearbeiten(true)}>Anpassen</Knopf>
            <Knopf art="rot" onClick={() => ereignisEntfernen(iso, e.id)}>Entfernen</Knopf>
          </>
        )}
      </div>
    </div>
  );
}

function Ergaenzen({ iso }) {
  const [offen, setOffen] = useState(false);
  const [text, setText] = useState('');
  const [entwurf, setEntwurf] = useState(null);
  const [fehler, setFehler] = useState('');

  const senden = () => {
    const e = ereignisAusText(text);
    if (!e) { setFehler('Beschreibe kurz, was passiert und wann.'); return; }
    setFehler('');
    setEntwurf(e);
  };

  if (!offen) {
    return (
      <button
        type="button"
        onClick={() => setOffen(true)}
        className="relative w-full h-[56px] border-2 border-[#e2f754] bg-black overflow-hidden isolate flex items-center justify-between pl-[22px] pr-[26px]"
      >
        <span className="planen-farbe" aria-hidden="true" />
        <span className="relative z-[1] text-[16px] font-medium tracking-[0.5px]" style={{ color: LIME }}>Ereignis ergänzen</span>
        <img src="/icon/_Icon_Lime/Planen_Sparkle_Lime.svg" alt="" className="relative z-[1] w-[24px] h-[24px]" />
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-[12px]">
      <div className="flex items-center justify-center gap-[8px]">
        <img src="/icon/_Icon_Lime/Planen_Sparkle_Lime.svg" alt="" className="w-[14px]" />
        <span className="text-[10px] font-bold" style={{ color: LIME }}>Ereignis ergänzen</span>
      </div>
      {entwurf ? (
        <>
          <div className="w-[314px] max-w-full ml-auto px-[12px] pt-[12px] pb-[8px] text-black text-[16px] font-medium leading-[20px] rounded-tl-2xl rounded-tr-2xl rounded-bl-2xl rounded-br-md" style={{ background: LIME }}>
            {entwurf.text}
          </div>
          <div className="w-[314px] max-w-full p-[12px] bg-[#242525] rounded-tl-2xl rounded-tr-2xl rounded-bl-md rounded-br-2xl outline outline-1 outline-offset-[-1px] outline-[#3A3A3A] text-white text-[14px] leading-[19px]">
            <div className="bg-[#fefffe] px-[14px] py-[12px] flex flex-col gap-[4px]" style={{ color: DUNKEL }}>
              <span className="text-[13px]">{entwurf.kachel.name}</span>
              <span className="text-[32px] font-bold leading-[36px] tracking-[-0.5px]">{entwurf.kachel.gross}</span>
              <span className="text-[12px]">{entwurf.titel}</span>
            </div>
            <p className="mt-[10px] text-[12px] opacity-70">Die Demo rechnet eigene Ereignisse nicht neu. In der App fließen sie in die nächste Planung ein.</p>
            <div className="flex gap-[8px] mt-[10px]">
              <button
                type="button"
                className="flex-1 h-[36px] text-[13px] font-bold"
                style={{ background: LIME, color: '#000' }}
                onClick={() => { ereignisHinzufuegen(iso, entwurf); setEntwurf(null); setText(''); setOffen(false); }}
              >
                Übernehmen
              </button>
              <button
                type="button"
                className="flex-1 h-[36px] text-[13px] font-medium border border-[#5a5a5a]"
                onClick={() => setEntwurf(null)}
              >
                Verwerfen
              </button>
            </div>
          </div>
        </>
      ) : null}
      {!entwurf ? (
        <form
          onSubmit={(ev) => { ev.preventDefault(); senden(); }}
          className="h-[56px] border-2 flex items-center gap-[10px] pl-[18px] pr-[12px]"
          style={{ borderColor: LIME }}
        >
          <input
            value={text}
            onChange={(ev) => { setText(ev.target.value); setFehler(''); }}
            placeholder="Ludwigstraße 14 bis 18 Uhr gesperrt"
            className="flex-1 min-w-0 bg-transparent text-[16px] text-white placeholder:text-[#8f9a3a] outline-none"
            autoFocus
          />
          <button type="submit" aria-label="Senden" className="shrink-0">
            <img src="/icon/_Icon_Planung/weiter_gross.svg" alt="" className="w-[34px] h-[21px] rotate-180" />
          </button>
        </form>
      ) : null}
      {fehler ? <p className="text-[13px]" style={{ color: ROT }}>{fehler}</p> : null}
    </div>
  );
}

export default function EreignisseView({ tagIso, onZurueck }) {
  const d = useRisikoDaten();
  useEreignisAenderungen();
  const liste = ereignisseFuerTag(d, tagIso);
  const entfernt = entfernteEreignisse(d, tagIso);
  const auto = liste.filter((e) => e.quelleArt === 'auto').length;
  const eigene = liste.length - auto;

  return (
    <div className="absolute inset-0 z-[80] bg-black" data-tutorial="planer-ereignisse">
      <div aria-hidden="true" className="absolute inset-0 pointer-events-none" style={HINTERGRUND} />
      <div className="relative h-dvh w-full overflow-y-auto overflow-x-hidden overscroll-none">
        <div className="mx-auto w-[min(402px,100vw)] px-[20px] pt-[40px] pb-[160px]">
          <BackCircleButton onClick={onZurueck} marker="planer-ereignisse-zurueck" />
          <p className="mt-[50px] text-[42px] leading-[42px] font-bold" style={{ color: LIME }}>Ereignisse</p>
          <p className="mt-[8px] text-[14px]" style={{ color: 'rgba(227,246,84,.5)' }}>
            {`${datumText(tagIso)} · ${auto} automatisch gefunden${eigene ? ` · ${eigene} von dir` : ''}`}
          </p>
          <div className="mt-[22px] flex flex-col gap-[12px]">
            {liste.map((e) => <EreignisKarte key={`${e.id}-${e.zeit}-${e.wirkung}`} e={e} iso={tagIso} />)}
            {!liste.length ? (
              <p className="text-[14px]" style={{ color: LIME }}>Für diesen Tag sind keine Ereignisse eingetragen.</p>
            ) : null}
          </div>
          {entfernt.length ? (
            <div className="mt-[14px] text-[12px] leading-[18px]" style={{ color: 'rgba(227,246,84,.7)' }}>
              {entfernt.map((e) => (
                <p key={e.id}>
                  {`Entfernt: ${e.titel} · `}
                  <button type="button" className="underline" onClick={() => ereignisWiederherstellen(tagIso, e.id)}>wiederherstellen</button>
                </p>
              ))}
            </div>
          ) : null}
          <div className="mt-[18px]"><Ergaenzen iso={tagIso} /></div>
          <p className="mt-[10px] text-[11px] leading-[15px] text-center" style={{ color: 'rgba(227,246,84,.5)' }}>
            Eintippen, was passiert und wann. Die Demo zeigt den Plan der Engine ohne eigene Änderungen.
          </p>
        </div>
      </div>
      {/* Die Seite liegt ueber der Fusszeile der App, deshalb eine eigene. */}
      <TrisarFooter className="fixed bottom-0 left-1/2 -translate-x-1/2 w-[min(402px,100vw)] h-10 bg-black z-[90]" />
    </div>
  );
}
