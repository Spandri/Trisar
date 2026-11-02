import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { engineTag } from '../../demo/engineErgebnisse';
import { ereignisseFuerTag, risikoOption, risikoTag, useEreignisAenderungen, useRisikoDaten } from '../../demo/risikoErgebnisse';
import { EreignisKacheln, PufferDash } from './RisikoBausteine';
import { demoStore } from '../../demo/demoClient';
import { angebotAntwort, useAngebotAntworten } from '../../demo/angebotAntworten';

// TRISAR-Engine in der Tagesplanung (zwischen Optionen und Dienstkarten):
//   - gewählte Option mit Kennzahlen, Vor- und Nachteilen im Vergleich
//   - vorhergesagte Verkehrsereignisse (z. B. Heimspiel Allianz Arena)
//   - Rad-/U-Bahn-Angebote, die vorab an Standardgäste gehen
//   (Die Störung am Einsatztag meldet der KI-Assistent, siehe NeuplanungView.)
// Die Höhe meldet der Block nach oben, damit die Karten darunter anschließen.

const LIME = '#e3f654';
const GRUEN = '#59be80';
const ROT = '#ff6f63';
const DUNKEL = '#1c1c1d';

const zahl = (n, stellen = 0) => (Number.isFinite(Number(n))
  ? Number(n).toLocaleString('de-DE', { minimumFractionDigits: stellen, maximumFractionDigits: stellen })
  : '–');
const uhr = (min) => `${String(Math.floor(min / 60) % 24).padStart(2, '0')}:${String(Math.round(min) % 60).padStart(2, '0')}`;

// Antwort der Gäste: In der Vorabplanung ist jedes Angebot offen, der Gast
// entscheidet in seiner App (siehe demo/angebotAntworten.js).
const antwort = (rideId) => angebotAntwort(rideId);
const zugesagt = (rideId) => antwort(rideId) === 'zugesagt';
const ANTWORT_FARBE = { zugesagt: GRUEN, abgelehnt: ROT };
const ort = (name) => String(name || '').split(',')[0];
const umstiegName = (a) => ort(a.umstieg).replace(/^U /, 'U-Bahn ');
// Vergleich mit dem Auto an einem Tag mit viel Verkehr (jeder 5. Tagesverlauf).
const vergleichViel = (min) => {
  if (min == null) return '';
  if (min === 0) return 'bei viel Verkehr gleich schnell';
  return `bei viel Verkehr ${Math.abs(min)} min ${min > 0 ? 'schneller' : 'langsamer'}`;
};

// Gäste der Fahrt aus den Demo-Daten: Namen, sonst nur die Anzahl.
const gaesteText = (job) => {
  const p = job?.passengers;
  const namen = Array.isArray(p) ? p : (p && typeof p === 'object' ? Object.values(p) : []);
  if (namen.length) return namen.join(', ');
  const n = Number(p) || 1;
  return n === 1 ? '1 Gast' : `${n} Gäste`;
};

function Kennzahl({ label, wert }) {
  return (
    <div className="flex flex-col">
      <span className="text-[11px] leading-[14px] tracking-[0.5px] opacity-60">{label}</span>
      <span className="text-[16px] font-bold leading-[20px] tabular-nums">{wert}</span>
    </div>
  );
}

function Ereignis({ e, umfahrung }) {
  const fenster = e.profil.map(([a, b]) => `${uhr(a)}–${uhr(b)}`);
  const max = Math.max(...e.profil.map(([, , x, y]) => Math.max(x, y)));
  return (
    <div className="border border-solid px-[14px] py-[12px] text-[12px] leading-[17px] tracking-[0.3px]" style={{ borderColor: LIME, color: LIME }}>
      <p className="font-bold text-[13px]">{e.bekannt ? 'Vorhersage' : 'Störung'}: {e.name}</p>
      <p className="mt-[4px] opacity-90">
        {e.art === 'grossveranstaltung'
          ? `A9 im Münchner Norden (Fröttmaning, Kreuz Nord) belastet ${fenster[0].split('–')[0]}–${fenster[1].split('–')[1]} und nach Abpfiff ${fenster[2].split('–')[0]}–${fenster[fenster.length - 1].split('–')[1]}, bis +${max} min.`
          : `A9 Richtung München ab ${fenster[0].split('–')[0]}, bis +${max} min, Auflösung bis ${fenster[fenster.length - 1].split('–')[1]}.`}
        {' '}
        {e.bekannt
          ? `Die Engine plant das vorab ein${umfahrung ? `: ${umfahrung} Fahrten über die Flughafentangente Ost, mehr Luft vor Folgeabholungen` : ': mehr Luft vor Folgeabholungen'}.`
          : 'War vorab nicht bekannt.'}
      </p>
      <p className="mt-[4px] text-[10px] opacity-60">Planungsannahme nach Polizei München, Mobilitätsreferat, Unfallbeispielen A9/A92. Kein Messwert.</p>
    </div>
  );
}

export default function EngineBlock({ tagIso, eintrag, onHoehe, laeuft, onEreignisse, onPuffer }) {
  const risiko = useRisikoDaten();
  useEreignisAenderungen();
  useAngebotAntworten();
  const ref = useRef(null);
  const [tag, setTag] = useState(null);
  const [angebotOffen, setAngebotOffen] = useState(null);

  useEffect(() => {
    let aktiv = true;
    engineTag(tagIso).then((d) => { if (aktiv) setTag(d); });
    return () => { aktiv = false; };
  }, [tagIso]);

  useLayoutEffect(() => {
    if (!ref.current || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(() => onHoehe?.(ref.current?.offsetHeight || 0));
    ro.observe(ref.current);
    onHoehe?.(ref.current.offsetHeight || 0);
    return () => ro.disconnect();
  }, [onHoehe]);

  const engine = eintrag?.engine || null;
  const kz = engine?.kennzahlen || null;
  const optionen = tag?.optionen || {};
  const angebote = useMemo(() => (Array.isArray(tag?.angebote) ? tag.angebote : []), [tag]);
  const zusagen = angebote.filter((a) => zugesagt(a.ride_id));
  const kmGespart = zusagen.reduce((s, a) => s + a.km_gespart, 0);
  const angeboteSortiert = useMemo(() => [...angebote].sort((x, y) => x.abfahrt.localeCompare(y.abfahrt)), [angebote]);
  const gewaehltesAngebot = angebote.find((a) => a.ride_id === angebotOffen) || null;
  const angebotDetail = useMemo(() => {
    if (!gewaehltesAngebot) return null;
    const id = gewaehltesAngebot.ride_id;
    const job = (demoStore?.jobs || []).find((j) => j.id === id) || null;
    // rideIds enthält auch die zweite Fahrt einer Sammelfahrt (rides fasst sie zusammen).
    const dienst = (eintrag?.suggestions || []).find((v) => (v.rideIds || (v.rides || []).map((r) => r.id)).includes(id)) || null;
    return { job, dienst };
  }, [gewaehltesAngebot, eintrag]);
  const ereignisse = Array.isArray(engine?.ereignisse) ? engine.ereignisse : [];
  const umfahrung = engine?.fahrten ? Object.values(engine.fahrten).filter((f) => f.route === 'FTO').length : 0;
  // Vergleich nur, wenn der gespeicherte Plan des bisherigen Planers zu den heutigen Fahrten passt.
  const alt = tag?.bisheriger_planer?.passend === false ? null : (tag?.bisheriger_planer || null);
  const leerVergleich = (() => {
    if (!alt?.leer_km || kz?.leer_km == null) return '';
    const prozent = Math.round((1 - kz.leer_km / alt.leer_km) * 100);
    const richtung = prozent >= 0 ? `${prozent} % weniger` : `${-prozent} % mehr`;
    return `Leer-km: bisher ${zahl(alt.leer_km)}, jetzt ${zahl(kz.leer_km)}, ${richtung}.`;
  })();
  const kacheln = ereignisseFuerTag(risiko, tagIso);
  const pufferOption = engine ? risikoOption(risiko, tagIso, engine.option) : null;

  if (!engine && !tag) return <div ref={ref} />;

  return (
    <div ref={ref} className="absolute left-[20px] w-[362px] flex flex-col gap-[12px]" style={{ top: '540px', opacity: laeuft ? 0.3 : 1 }} data-tutorial="planer-engine">
      {kz ? (
        <div data-tutorial="planer-engine-karte" className="bg-[#fefffe] px-[18px] py-[16px] flex flex-col gap-[10px]" style={{ color: DUNKEL }}>
          <div className="flex items-baseline justify-between">
            <p className="text-[20px] font-bold tracking-[-0.3px]">{engine.titel}</p>
            {engine.standard ? <span className="text-[11px] font-bold px-[6px] py-[2px]" style={{ background: LIME }}>Standard</span> : null}
          </div>
          <div className="grid grid-cols-3 gap-y-[8px] gap-x-[10px]">
            <Kennzahl label="Fahrer/Fahrzeuge" wert={zahl(kz.fahrzeuge)} />
            <Kennzahl label="km gesamt" wert={zahl(kz.km)} />
            <Kennzahl label="CO₂" wert={`${zahl(kz.co2_kg)} kg`} />
            <Kennzahl label="Kosten" wert={`${zahl(kz.kosten_eur)} €`} />
            <Kennzahl label="elektrisch" wert={`${zahl(kz.e_anteil_km * 100)} %`} />
            <Kennzahl label="Sammelfahrten" wert={zahl(kz.sammelfahrten)} />
          </div>
          <div className="text-[12px] leading-[16px]" style={{ color: GRUEN }}>
            {kz.puenktlich_abholung >= 1 ? (
              <>
                <span className="font-bold">Jede Abholung pünktlich</span>
                {`, geprüft in ${kz.szenarien_test} neuen Tagesverläufen (Flugverspätung, Stau, Gast später). `}
              </>
            ) : kz.puenktlich_abholung_nachgesteuert != null ? (
              <>
                {/* Standard: Verspaetung ist Abwaegung, am Einsatztag wird nachgesteuert (wie Antrags-Simulation) */}
                <span className="font-bold">
                  {kz.puenktlich_abholung_nachgesteuert >= 1
                    ? 'Jede Abholung pünktlich'
                    : `Pünktlich abgeholt ${zahl(Math.floor(kz.puenktlich_abholung_nachgesteuert * 10000) / 100, 2)} %`}
                </span>
                {` mit Nachsteuern am Einsatztag, ohne Eingriff ${zahl(kz.puenktlich_abholung * 100, 1)} %. Geprüft in ${kz.szenarien_test} neuen Tagesverläufen. `}
              </>
            ) : (
              <>
                {/* zwei Nachkommastellen, damit 99,97 % nicht als 100,0 % erscheint */}
                <span className="font-bold">{`Pünktlich ${zahl(kz.puenktlich_abholung * 100, 2)} %`}</span>
                {` der Abholungen in ${kz.szenarien_test} neuen Tagesverläufen (Flugverspätung, Stau, Gast später). `}
              </>
            )}
            {kz.mittlere_reserve_min != null && kz.mittlere_reserve_min >= 0 ? `Luft vor Folgeabholungen im Mittel ${kz.mittlere_reserve_min} min.` : ''}
          </div>
          {alt?.puenktlich_abholung != null ? (
            <div className="text-[12px] leading-[16px] opacity-80">
              {`Bisheriger Planer (feste Fahrtdauer, 20 min Puffer): ${alt.fahrer} Dienste${alt.offen ? `, ${alt.offen} Fahrten offen` : ''}, ${zahl(alt.puenktlich_abholung * 100, 1)} % pünktlich im selben Verkehrsmodell.`}
              {leerVergleich ? ` ${leerVergleich}` : ''}
            </div>
          ) : null}
          {(engine.vorteile?.length || engine.nachteile?.length) ? (
            <ul className="text-[12px] leading-[17px] flex flex-col gap-[2px]">
              {(engine.vorteile || []).map((v) => <li key={v}><span style={{ color: GRUEN }} className="font-bold">+ </span>{v}</li>)}
              {(engine.nachteile || []).map((v) => <li key={v}><span style={{ color: ROT }} className="font-bold">– </span>{v}</li>)}
            </ul>
          ) : null}
          {Object.keys(optionen).length > 1 ? (
            <div
              className="grid gap-[6px] pt-[6px] border-t border-solid border-[#d9d9d9] text-[11px] leading-[14px] tabular-nums"
              style={{ gridTemplateColumns: `repeat(${Object.keys(optionen).length}, minmax(0, 1fr))` }}
            >
              {Object.entries(optionen).map(([key, a]) => {
                const k = a.engine.kennzahlen;
                const aktiv = key === engine.option;
                return (
                  <div key={key} className="flex flex-col" style={{ opacity: aktiv ? 1 : 0.6 }}>
                    <span className="font-bold">{a.engine.titel}</span>
                    <span>{`${k.fahrzeuge} Fz · ${zahl(k.co2_kg)} kg`}</span>
                    <span>{`${zahl(k.kosten_eur)} €`}</span>
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>
      ) : null}

      {kacheln.length ? (
        <div className="flex flex-col gap-[10px] mt-[10px]">
          <p className="text-[16px] font-bold" style={{ color: LIME }}>Vorhersage</p>
          <EreignisKacheln ereignisse={kacheln} klein onOeffnen={() => onEreignisse?.(tagIso)} marker="planer-vorhersage" />
        </div>
      ) : ereignisse.map((e) => <Ereignis key={e.name} e={e} umfahrung={umfahrung} />)}

      {pufferOption ? (
        <div className="mt-[14px]">
          <PufferDash
            option={pufferOption}
            ereignisAnzahl={(risikoTag(risiko, tagIso)?.ereignisse || []).length}
            onOeffnen={() => onPuffer?.(tagIso, engine?.option || 'standard', engine?.titel)}
          />
        </div>
      ) : null}

      {angebote.length ? (
        <div className="flex flex-col gap-[10px] mt-[10px]">
          <div className="flex items-baseline justify-between" style={{ color: LIME }}>
            <p className="text-[16px] font-bold">Rad & U-Bahn</p>
            <span className="text-[12px] opacity-75">{zusagen.length ? `${zahl(kmGespart)} km gespart` : `${angebote.length} ${angebote.length === 1 ? 'Angebot' : 'Angebote'} an Gäste`}</span>
          </div>
          <div className="flex gap-[12px] overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {angeboteSortiert.map((a) => {
              const status = antwort(a.ride_id);
              const offen = angebotOffen === a.ride_id;
              return (
                <button
                  key={a.ride_id}
                  type="button"
                  data-tutorial={`angebot-${a.ride_id}`}
                  onClick={() => setAngebotOffen(offen ? null : a.ride_id)}
                  className="shrink-0 flex flex-col justify-between text-left border-2 border-solid"
                  style={{
                    width: '130px',
                    height: '98px',
                    padding: '10px 12px',
                    borderColor: offen ? '#fefffe' : LIME,
                    background: offen ? '#fefffe' : 'transparent',
                    color: offen ? DUNKEL : LIME,
                  }}
                >
                  <span className="text-[11px] leading-[13px]">{a.modus === 'rad' ? 'Leihrad' : 'U-Bahn'}</span>
                  <span className="text-[24px] font-bold leading-[28px] tracking-[-0.5px] tabular-nums">{a.abfahrt}</span>
                  <span className="text-[11px] leading-[13px]" style={{ color: offen ? undefined : ANTWORT_FARBE[status] }}>{status}</span>
                </button>
              );
            })}
          </div>
          {gewaehltesAngebot ? (
            <div data-tutorial="angebot-detail" className="bg-[#fefffe] px-[14px] py-[12px] text-[12px] leading-[17px] flex flex-col gap-[4px]" style={{ color: DUNKEL }}>
              <div className="flex justify-between gap-[8px] text-[13px]">
                <span>{gaesteText(angebotDetail?.job)}</span>
                <span style={{ color: ANTWORT_FARBE[antwort(gewaehltesAngebot.ride_id)] }}>{antwort(gewaehltesAngebot.ride_id)}</span>
              </div>
              <span className="opacity-75">
                {`${gewaehltesAngebot.abfahrt} ${ort(angebotDetail?.job?.pickup_name)} → ${ort(angebotDetail?.job?.dropoff_name)}`}
              </span>
              <span className="opacity-75">
                {angebotDetail?.dienst
                  ? `${angebotDetail.dienst.name} fährt bis ${umstiegName(gewaehltesAngebot)} (${gewaehltesAngebot.auto_bis_min} min)`
                  : `Fahrer bis ${umstiegName(gewaehltesAngebot)}: noch nicht eingeplant`}
              </span>
              <span className="opacity-75">
                {`Danach ${gewaehltesAngebot.modus === 'rad' ? 'Leihrad' : 'U-Bahn'} ${gewaehltesAngebot.weiter_min} min. Gesamt ${gewaehltesAngebot.gesamt_min} statt ${gewaehltesAngebot.auto_min} min, ${vergleichViel(gewaehltesAngebot.vorsprung_viel_verkehr_min)}.`}
              </span>
              {antwort(gewaehltesAngebot.ride_id) === 'zugesagt' ? (
                // Kleine Neuplanung nach der Zusage: das Auto faehrt nur noch bis zum Umsteigepunkt.
                <span data-tutorial="angebot-neuplanung" className="mt-[4px] px-[6px] py-[4px] font-bold" style={{ background: LIME, color: '#000' }}>
                  {`Neu geplant: ${angebotDetail?.dienst?.name || 'Der Fahrer'} fährt nur noch ${gewaehltesAngebot.auto_bis_min} statt ${gewaehltesAngebot.auto_min} min, ${zahl(gewaehltesAngebot.km_gespart)} km weniger.`}
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

    </div>
  );
}
