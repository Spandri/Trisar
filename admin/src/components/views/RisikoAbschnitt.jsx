import { useLayoutEffect, useRef } from 'react';
import { BISHER_PUFFER_MIN } from '../../demo/risikoErgebnisse';
import { FahrzeitVerteilung } from './RisikoBausteine';
import { DUNKEL, GRUEN, KLASSE_FARBE } from './risikoFarben';

// "Was dieser Fahrt passieren kann" in Fahrt bearbeiten: Fahrzeit ueber alle
// Verlaeufe, Ursachen und was die Engine dafuer eingeplant hat. Die Hoehe meldet
// der Abschnitt nach oben, damit Notizen und Knoepfe darunter anschliessen.

const haeufigkeit = (anteil) => {
  const n = Math.round(anteil * 10);
  return n >= 1 ? `${n} von 10` : 'selten';
};

export default function RisikoAbschnitt({ fahrt, geplant, verlaeufe = 500, onHoehe, style }) {
  const ref = useRef(null);

  useLayoutEffect(() => {
    if (!ref.current || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(() => onHoehe?.(ref.current?.offsetHeight || 0));
    ro.observe(ref.current);
    onHoehe?.(ref.current.offsetHeight || 0);
    return () => ro.disconnect();
  }, [onHoehe]);

  const fz = fahrt.fahrzeit;
  const luft = fahrt.luft;
  const zeilen = [
    ...(fahrt.ereignis ? [{
      name: `${fahrt.ereignis.name.replace(', Allianz Arena', '')} eingeplant`,
      unter: fahrt.ereignis.route === 'FTO' ? 'Route über Flughafentangente Ost · Planungsannahme' : 'Planungsannahme',
      rechts: 'vorhergesagt',
      bis: `+${fahrt.ereignis.min} min`,
    }] : []),
    ...fahrt.ursachen.map((u) => ({ name: u.name, unter: '', rechts: haeufigkeit(u.anteil), bis: `bis +${u.bis_min} min` })),
  ];

  return (
    <div ref={ref} className="absolute left-0 right-0 bg-[#1a1a1a] rounded-[12px] p-[20px]" style={style} data-tutorial="fahrt-risiko">
      <div className="bg-white px-[16px] py-[16px]" style={{ color: DUNKEL }}>
        <div className="flex items-center justify-between gap-[10px]">
          <h3 className="text-[16px] font-bold tracking-[0.5px]">Was dieser Fahrt passieren kann</h3>
          <span className="shrink-0 text-[11px] font-bold px-[6px] py-[2px]" style={{ background: KLASSE_FARBE[fahrt.klasse] }}>
            {fahrt.klasse}
          </span>
        </div>

        <p className="text-[11px] opacity-60 mt-[12px]">{`Fahrzeit in ${verlaeufe} Verläufen`}</p>
        <div className="mt-[4px] overflow-hidden"><FahrzeitVerteilung fahrzeit={fz} breite={330} /></div>
        <p className="text-[13px] leading-[18px] mt-[6px]">
          {'Normal '}<b>{`${fz.p50} min`}</b>{', in 9 von 10 Verläufen höchstens '}<b>{`${fz.p90} min`}</b>.
        </p>

        <div className="mt-[10px]">
          {zeilen.length ? zeilen.map((z) => (
            <div key={z.name} className="flex justify-between items-start gap-[10px] py-[9px] border-t border-[#d9d9d9] text-[13px] leading-[17px]">
              <div>
                {z.name}
                {z.unter ? <p className="text-[11px] opacity-60">{z.unter}</p> : null}
              </div>
              <div className="text-right whitespace-nowrap">
                <b>{z.rechts}</b>
                <p className="text-[11px] opacity-60">{z.bis}</p>
              </div>
            </div>
          )) : (
            <p className="py-[9px] border-t border-[#d9d9d9] text-[13px]">In den Verläufen kaum Schwankung.</p>
          )}
        </div>

        {geplant ? (
          <div className="border-t border-[#d9d9d9] pt-[10px] text-[13px] leading-[22px]">
            {luft ? (
              <>
                <div className="flex justify-between"><span>Eingeplanter Puffer</span><b>{`${luft.puffer} min`}</b></div>
                <div className="flex justify-between opacity-50"><span>Bisher pauschal</span><span>{`${BISHER_PUFFER_MIN} min`}</span></div>
                <div className="flex justify-between gap-[10px]">
                  <span className="shrink-0">{`Folgefahrt ${luft.folge_abfahrt}`}</span>
                  <b className="text-right" style={{ color: luft.folge_puenktlich === luft.verlaeufe ? GRUEN : DUNKEL }}>
                    {luft.folge_puenktlich === luft.verlaeufe
                      ? 'in allen Verläufen pünktlich'
                      : `in ${luft.folge_puenktlich} von ${luft.verlaeufe} pünktlich`}
                  </b>
                </div>
              </>
            ) : (
              <div className="flex justify-between"><span>Puffer</span><span className="opacity-60">letzte Fahrt im Dienst</span></div>
            )}
          </div>
        ) : (
          <p className="border-t border-[#d9d9d9] pt-[10px] text-[12px] leading-[16px] opacity-60">
            Den Puffer legt die Engine fest, wenn die Fahrt nach ihrem Plan eingeteilt ist.
          </p>
        )}
        <p className="text-[10px] opacity-50 mt-[10px]">Planungsannahmen, keine Messwerte.</p>
      </div>
    </div>
  );
}
