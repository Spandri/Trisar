import BackCircleButton from '../ui/BackCircleButton';
import TrisarFooter from '../ui/TrisarFooter';
import { demoStore } from '../../demo/demoClient';
import { GRUEN, LIME, ROT } from './risikoFarben';

// Neuplanung am Einsatztag: Der Tag ist vorab geplant und angenommen, dann
// kommt eine Störung. Diese Seite zeigt nur die Änderungen der Neuplanung,
// die Disposition übernimmt oder lehnt sie ab. Werte aus engine-ergebnisse.json
// (Tag "stoerung", gerechnet mit werkzeuge/engine/stoerung_neu.py).

const HINTERGRUND = {
  backgroundImage:
    "url(\"data:image/svg+xml;utf8,<svg viewBox='0 0 402 873' xmlns='http://www.w3.org/2000/svg' preserveAspectRatio='none'><rect x='0' y='0' height='100%' width='100%' fill='url(%23grad)' opacity='1'/><defs><radialGradient id='grad' gradientUnits='userSpaceOnUse' cx='0' cy='0' r='10' gradientTransform='matrix(43.25 96.3 -44.344 19.869 1.3947e-15 1.9384e-13)'><stop stop-color='rgba(49,55,1,1)' offset='0'/><stop stop-color='rgba(25,28,0,1)' offset='0.2283'/><stop stop-color='rgba(12,14,0,1)' offset='0.34244'/><stop stop-color='rgba(0,0,0,1)' offset='0.45659'/><stop stop-color='rgba(0,0,0,1)' offset='0.6782'/><stop stop-color='rgba(0,6,16,1)' offset='0.69832'/><stop stop-color='rgba(0,11,32,1)' offset='0.71843'/><stop stop-color='rgba(0,22,64,1)' offset='0.75865'/><stop stop-color='rgba(0,33,96,1)' offset='0.79888'/><stop stop-color='rgba(0,45,128,1)' offset='0.8391'/><stop stop-color='rgba(0,67,191,1)' offset='0.91955'/><stop stop-color='rgba(0,89,255,1)' offset='1'/></radialGradient></defs></svg>\")",
  backgroundSize: '100% 100%',
  backgroundRepeat: 'no-repeat',
};

const datumText = (iso) => new Date(`${iso}T12:00:00`)
  .toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'short' });
const ort = (name) => String(name || '').split(',')[0];

// Gäste der Fahrt: Namen aus den Demo-Daten, sonst die Anzahl.
const gaeste = (job) => {
  const p = job?.passengers;
  const namen = Array.isArray(p) ? p : (p && typeof p === 'object' ? Object.values(p) : []);
  if (namen.length) return namen.join(', ');
  const n = Number(p) || 1;
  return n === 1 ? '1 Gast' : `${n} Gäste`;
};

function Vergleich({ titel, n, unter }) {
  return (
    <div className="bg-[#2a2a2b] px-[8px] py-[8px]">
      <p className="text-[10px] leading-[13px] opacity-70">{titel}</p>
      <p className="text-[15px] font-bold" style={{ color: n ? ROT : GRUEN }}>{n == null ? '–' : `${n} zu spät`}</p>
      <p className="text-[10px] leading-[13px] opacity-70">{unter}</p>
    </div>
  );
}

export default function NeuplanungView({ tagIso, stoerung: st, bisher, status, fehler, laeuft, onUebernehmen, onAblehnen, onZurueck }) {
  const jobs = demoStore?.jobs || [];
  const spaet = st?.ohne_neuplanung?.spaete_abholungen || {};
  // Erst die Fahrten, die ohne Eingriff zu spät wären, dann die Folgetausche.
  const aenderungen = [...(st?.aenderungen || [])].sort((a, b) => {
    const sa = a.ride_ids.some((id) => spaet[id] != null) ? 0 : 1;
    const sb = b.ride_ids.some((id) => spaet[id] != null) ? 0 : 1;
    return sa - sb || a.abfahrt.localeCompare(b.abfahrt);
  });
  const stau = Object.keys(st?.spaetere_ankunft || {}).length;

  return (
    <div className="absolute inset-0 z-[80] bg-black" data-tutorial="planer-neuplanung">
      <div aria-hidden="true" className="absolute inset-0 pointer-events-none" style={HINTERGRUND} />
      <div className="relative h-dvh w-full overflow-y-auto overflow-x-hidden overscroll-none">
        <div className="mx-auto w-[min(402px,100vw)] px-[20px] pt-[40px] pb-[160px] text-white">
          <BackCircleButton onClick={onZurueck} marker="planer-neuplanung-zurueck" />
          <p className="mt-[50px] text-[42px] leading-[42px] font-bold" style={{ color: LIME }}>Neuplanung</p>
          <p className="mt-[8px] text-[14px]" style={{ color: 'rgba(227,246,84,.5)' }}>{`${datumText(tagIso)} · Meldung ${st?.meldung || ''} Uhr`}</p>

          {!st ? (
            <p className="mt-[24px] text-[14px]" style={{ color: LIME }}>Für diesen Tag liegt keine Störung vor.</p>
          ) : (
            <>
              <div data-tutorial="neuplanung-vergleich" className="mt-[24px] border border-solid px-[14px] py-[12px] text-[12px] leading-[17px]" style={{ borderColor: ROT }}>
                <p className="font-bold text-[13px]" style={{ color: ROT }}>{st.ereignis.name.split(' (')[0]}</p>
                <div className="mt-[10px] grid grid-cols-3 gap-[6px]">
                  <Vergleich
                    titel="Bisheriger Planer"
                    n={bisher?.stoerung_spaet ? Object.keys(bisher.stoerung_spaet).length : null}
                    unter={bisher?.normal_spaet ? `ohne Unfall ${Object.keys(bisher.normal_spaet).length}` : 'nicht gerechnet'}
                  />
                  <Vergleich
                    titel="TRISAR ohne Eingriff"
                    n={st.ohne_neuplanung.anzahl}
                    unter={st.ohne_neuplanung.anzahl ? `bis ${Math.max(...Object.values(spaet))} min` : 'Reserve hält'}
                  />
                  <Vergleich
                    titel="nach Neuplanung"
                    n={st.mit_neuplanung.anzahl}
                    unter={`${st.aenderungen.length} Fahrten neu`}
                  />
                </div>
                {stau ? <p className="mt-[8px] opacity-70">{`${stau} Gäste stehen selbst im Stau. Sie und das Ziel werden automatisch informiert.`}</p> : null}
              </div>

              <p className="mt-[24px] text-[13px] font-bold" style={{ color: LIME }}>{`Vorgeschlagene Änderungen (${aenderungen.length})`}</p>
              <div data-tutorial="neuplanung-aenderungen" className="mt-[10px] flex flex-col gap-[10px]">
                {aenderungen.map((a) => {
                  const job = jobs.find((j) => j.id === a.ride_ids[0]) || {};
                  const min = a.ride_ids.map((id) => spaet[id]).find((x) => x != null);
                  return (
                    <div key={a.ride_ids.join('-')} className="bg-[#fefffe] text-[#1c1c1d] px-[18px] py-[14px]" style={{ boxShadow: `inset 0 0 0 4px ${LIME}` }}>
                      <div className="flex items-start justify-between gap-[10px]">
                        <p className="text-[20px] font-bold leading-[24px]">{gaeste(job)}</p>
                        <p className="text-[15px] font-bold">{a.abfahrt}</p>
                      </div>
                      <p className="mt-[4px] text-[12px] leading-[16px] opacity-80">
                        {`${ort(job.pickup_name || job.pickup_address) || a.von.split(' → ')[0]} → ${ort(job.dropoff_name || job.dropoff_address) || a.von.split(' → ')[1]}`}
                      </p>
                      <p className="mt-[8px] text-[14px] leading-[18px]">
                        <span className="line-through opacity-50">{a.alter_fahrer || '–'}</span>
                        <span className="font-bold">{`  →  ${a.neuer_fahrer}`}</span>
                        {a.reservefahrzeug ? <span className="font-bold"> · Bereitschaft</span> : null}
                      </p>
                      <p className="mt-[6px] text-[12px] leading-[16px]">
                        {min != null
                          ? <><span className="font-bold" style={{ color: ROT }}>{`wäre ${min} min zu spät`}</span>, jetzt pünktlich</>
                          : <span className="opacity-70">Folge des Tauschs, bleibt pünktlich</span>}
                      </p>
                    </div>
                  );
                })}
              </div>

              {fehler ? <p className="mt-[12px] text-[12px]" style={{ color: ROT }}>{fehler}</p> : null}

              {status ? (
                <div data-tutorial="neuplanung-status" className="mt-[20px] h-[51px] flex items-center justify-center gap-[10px]" style={status === 'uebernommen' ? { background: LIME } : { border: `2px solid ${ROT}` }}>
                  <span className="text-[22px] font-bold tracking-[-0.5px]" style={{ color: status === 'uebernommen' ? '#000' : ROT }}>
                    {status === 'uebernommen' ? 'Übernommen, Fahrer informiert' : 'Abgelehnt'}
                  </span>
                </div>
              ) : (
                <div className="mt-[20px] flex gap-[6px]">
                  <button
                    type="button"
                    onClick={onAblehnen}
                    disabled={laeuft}
                    className="flex-1 h-[51px] border-2 border-solid flex items-center justify-center"
                    style={{ borderColor: ROT }}
                  >
                    <span className="text-[24px] font-bold tracking-[-0.5px]" style={{ color: ROT }}>Ablehnen</span>
                  </button>
                  <button
                    type="button"
                    onClick={onUebernehmen}
                    disabled={laeuft}
                    data-tutorial="planer-neuplanung-uebernehmen"
                    className="flex-1 h-[51px] flex items-center justify-center"
                    style={{ background: LIME, opacity: laeuft ? 0.5 : 1 }}
                  >
                    <span className="text-black text-[24px] font-bold tracking-[-0.5px]">Übernehmen</span>
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
      {/* Die Seite liegt ueber der Fusszeile der App, deshalb eine eigene. */}
      <TrisarFooter className="fixed bottom-0 left-1/2 -translate-x-1/2 w-[min(402px,100vw)] h-10 bg-black z-[90]" />
    </div>
  );
}
