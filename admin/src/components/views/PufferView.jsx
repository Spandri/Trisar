import { useState } from 'react';
import BackCircleButton from '../ui/BackCircleButton';
import {
  BISHER_PUFFER_MIN, ereignisseFuerTag, risikoGrund, risikoOption, risikoTag, useEreignisAenderungen, useRisikoDaten,
} from '../../demo/risikoErgebnisse';
import { LuftFaecher, PufferStreuung } from './RisikoBausteine';
import { DUNKEL, GRUEN, LIME, ROT } from './risikoFarben';

// Detailseite zum Dash "Puffer je Fahrt": wie viel Luft die Engine je Fahrt
// freihaelt, wie knapp es ueber den Tag wird und welche Fahrten das hoechste
// Risiko tragen. Alle Werte aus risiko-ergebnisse.json.

const HINTERGRUND = {
  backgroundImage:
    "url(\"data:image/svg+xml;utf8,<svg viewBox='0 0 402 873' xmlns='http://www.w3.org/2000/svg' preserveAspectRatio='none'><rect x='0' y='0' height='100%' width='100%' fill='url(%23grad)' opacity='1'/><defs><radialGradient id='grad' gradientUnits='userSpaceOnUse' cx='0' cy='0' r='10' gradientTransform='matrix(43.25 96.3 -44.344 19.869 1.3947e-15 1.9384e-13)'><stop stop-color='rgba(49,55,1,1)' offset='0'/><stop stop-color='rgba(25,28,0,1)' offset='0.2283'/><stop stop-color='rgba(12,14,0,1)' offset='0.34244'/><stop stop-color='rgba(0,0,0,1)' offset='0.45659'/><stop stop-color='rgba(0,0,0,1)' offset='0.6782'/><stop stop-color='rgba(0,6,16,1)' offset='0.69832'/><stop stop-color='rgba(0,11,32,1)' offset='0.71843'/><stop stop-color='rgba(0,22,64,1)' offset='0.75865'/><stop stop-color='rgba(0,33,96,1)' offset='0.79888'/><stop stop-color='rgba(0,45,128,1)' offset='0.8391'/><stop stop-color='rgba(0,67,191,1)' offset='0.91955'/><stop stop-color='rgba(0,89,255,1)' offset='1'/></radialGradient></defs></svg>\")",
  backgroundSize: '100% 100%',
  backgroundRepeat: 'no-repeat',
};

// Nicht auf 100 aufrunden, solange noch einzelne Abholungen zu spät sind.
const prozent = (x) => (x >= 1 ? '100' : (Math.floor(x * 10000) / 100).toLocaleString('de-DE'));

const datumText = (iso) => new Date(`${iso}T12:00:00`)
  .toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'short' });

function Kachel({ label, wert, unter, farbe = LIME }) {
  return (
    <div className="border-2 border-solid px-[16px] py-[14px] flex flex-col gap-[2px]" style={{ borderColor: farbe, color: farbe }}>
      <span className="text-[13px]">{label}</span>
      <span className="text-[32px] font-bold leading-[36px] tracking-[-0.5px]">{wert}</span>
      <span className="text-[12px] leading-[15px]">{unter}</span>
    </div>
  );
}

export default function PufferView({ tagIso, option = 'standard', optionTitel = 'Standard', onZurueck }) {
  const d = useRisikoDaten();
  useEreignisAenderungen();
  const [alle, setAlle] = useState(false);
  const o = risikoOption(d, tagIso, option);
  const ereignisse = ereignisseFuerTag(d, tagIso);
  const knapp = o?.knappste_stunde;
  const [stunde, setStunde] = useState(null);
  const gewaehlt = o?.faecher?.find((s) => s.h === stunde && s.n) || null;
  const hoch = o ? o.hoch.map((id) => ({ id, ...o.fahrten[id] })) : [];
  const gesamt = o ? Object.keys(o.fahrten).length : 0;

  return (
    <div className="absolute inset-0 z-[80] bg-black" data-tutorial="planer-puffer">
      <div aria-hidden="true" className="absolute inset-0 pointer-events-none" style={HINTERGRUND} />
      <div className="relative h-dvh w-full overflow-y-auto overflow-x-hidden overscroll-none">
        <div className="mx-auto w-[min(402px,100vw)] px-[20px] pt-[40px] pb-[160px]">
          <BackCircleButton onClick={onZurueck} marker="planer-puffer-zurueck" />
          <p className="mt-[50px] text-[42px] leading-[42px] font-bold" style={{ color: LIME }}>Puffer je Fahrt</p>
          <p className="mt-[8px] text-[14px]" style={{ color: 'rgba(227,246,84,.5)' }}>{`${datumText(tagIso)} · ${optionTitel}`}</p>

          {!o ? (
            <p className="mt-[24px] text-[14px]" style={{ color: LIME }}>Für diesen Tag liegt keine Rechnung der Engine vor.</p>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-[12px] mt-[24px]">
                <Kachel label="Puffer Ø" wert={`${o.puffer_mittel} min`} unter={`bisher mind. ${BISHER_PUFFER_MIN} min, plus Wartezeit`} />
                <Kachel label="Hohes Risiko" wert={o.hoch.length} unter={`von ${gesamt} Fahrten`} farbe={o.hoch.length ? ROT : LIME} />
              </div>

              <div className="border-2 border-solid px-[16px] py-[14px] mt-[12px]" style={{ borderColor: LIME, color: LIME }}>
                <div className="flex items-baseline justify-between">
                  <p className="text-[16px] font-bold">Wie knapp wird es?</p>
                  <p className="text-[11px] opacity-75">{`${risikoTag(d, tagIso)?.verlaeufe || 500} Verläufe des Tages`}</p>
                </div>
                <div className="mt-[10px]"><LuftFaecher faecher={o.faecher} gewaehlt={stunde} onWaehlen={setStunde} /></div>
                <div className="flex gap-[12px] mt-[6px] text-[11px] items-center">
                  <span className="flex items-center gap-[4px]"><i className="inline-block w-[14px] h-[2px] bg-white" />Median</span>
                  <span className="flex items-center gap-[4px]">
                    <i className="inline-block w-[34px] h-[9px]" style={{ background: 'linear-gradient(90deg,rgba(227,246,84,.08),rgba(227,246,84,.75) 50%,rgba(227,246,84,.08))' }} />
                    90-%-Bereich
                  </span>
                  <span className="flex items-center gap-[4px]"><i className="inline-block w-[14px] h-[9px]" style={{ background: 'rgba(255,111,99,.7)' }} />zu spät</span>
                </div>
                <p className="mt-[8px] text-[12px] leading-[16px] text-white opacity-85">
                  {gewaehlt
                    ? <><b>{`${gewaehlt.h}–${gewaehlt.h + 1} Uhr`}</b>{` · ${gewaehlt.p50} min Luft · ${gewaehlt.spaet >= 0.01 ? `${Math.round(gewaehlt.spaet * 100)} % zu spät` : 'pünktlich'}`}</>
                    : 'Tippe auf eine Stunde.'}
                </p>
                {knapp != null ? (
                  <p className="mt-[8px] text-[13px] text-white">
                    {'Am knappsten '}<b>{`${knapp}–${knapp + 1} Uhr`}</b>.
                    {o.puenktlich_abholung != null ? <>{' Mit Nachsteuern '}<b>{`${prozent(o.puenktlich_abholung)} %`}</b>{' pünktlich abgeholt.'}</> : null}
                  </p>
                ) : null}
              </div>

              <div className="border-2 border-solid px-[16px] py-[14px] mt-[12px]" style={{ borderColor: LIME, color: LIME }}>
                <PufferStreuung fahrten={o.fahrten} ereignisse={ereignisse} />
                <div className="flex gap-[12px] flex-wrap mt-[6px] text-[11px]">
                  <span><span style={{ color: GRUEN }}>●</span> niedrig</span>
                  <span>● mittel</span>
                  <span><span style={{ color: ROT }}>●</span> hoch</span>
                  <span className="text-white">{`- - bisher mind. ${BISHER_PUFFER_MIN} min`}</span>
                </div>
                <p className="mt-[8px] text-[13px] text-white">
                  {`Jeder Punkt ist ein Anschluss. ${o.unter_bisher} haben weniger als ${BISHER_PUFFER_MIN} min, ${o.ueber_bisher} mehr.`}
                </p>
              </div>

              {hoch.length ? (
                <div className="bg-[#fefffe] px-[18px] pt-[16px] pb-[8px] mt-[12px]" style={{ color: DUNKEL }}>
                  <p className="text-[16px] font-bold">Hohes Risiko</p>
                  {(alle ? hoch : hoch.slice(0, 3)).map((f) => (
                    <div key={f.id} className="flex justify-between items-start gap-[10px] py-[9px] border-t border-[#d9d9d9] mt-[8px] first-of-type:mt-[8px] text-[13px] leading-[17px]">
                      <div>
                        <b>{f.abfahrt}</b>{` ${f.von} – ${f.nach}`}
                        <p className="text-[11px] opacity-60">
                          {`${risikoGrund(f)}${f.luft ? ` · Puffer ${f.luft.puffer} min` : ' · letzte Fahrt im Dienst'}`}
                        </p>
                      </div>
                      <span className="text-[11px] font-bold px-[6px] py-[2px] shrink-0" style={{ background: ROT }}>hoch</span>
                    </div>
                  ))}
                  {hoch.length > 3 ? (
                    <button type="button" className="text-[13px] py-[8px] underline" onClick={() => setAlle((a) => !a)}>
                      {alle ? 'Weniger anzeigen' : `Alle ${hoch.length} ansehen`}
                    </button>
                  ) : null}
                </div>
              ) : null}

              <p className="mt-[10px] text-[10px] leading-[14px]" style={{ color: 'rgba(227,246,84,.6)' }}>
                {`${risikoTag(d, tagIso)?.verlaeufe || 500} Verläufe des Tages. Puffer = Zeit, die die Engine zwischen zwei Fahrten über die normale Fahrzeit hinaus freihält. Flug- und Zugverspätung nach Pünktlichkeitsstatistik 2025, Spieltagsfaktoren angenommen. Keine Messwerte.`}
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
