import React, { useEffect, useMemo, useState } from 'react';
import TrisarFooter from '../../../components/ui/TrisarFooter';
import { useI18n } from '../../../i18n';
import ZurueckKnopf from '../../../components/ui/ZurueckKnopf';
import { DEMO_MODE } from '../../../datenquelle';
import { supabase } from '../../../shared/supabase/client';
import { gaesteZeilen } from '../../../shared/gaesteAnzeige';
import { StundenKarte, Tageszeile, useStundenAktionen, useStundenVerlauf, uhr, zuZeitpunkt } from './Stunden';

const BASE_WIDTH = 402;
const CONTENT_SHIFT = 43;
const BASE_HEIGHT = 1481 + CONTENT_SHIFT;
const STATUS_ROW_HEIGHT = 48;
const FIRST_SHIFT_END_TOP = 488 + CONTENT_SHIFT;
const SECOND_SHIFT_START_TOP = 563 + CONTENT_SHIFT;
const SECOND_SHIFT_END_TOP = 1104 + CONTENT_SHIFT;
const THIRD_SHIFT_START_TOP = 1179 + CONTENT_SHIFT;
const FIRST_DIVIDER_TOP = FIRST_SHIFT_END_TOP + STATUS_ROW_HEIGHT + (SECOND_SHIFT_START_TOP - (FIRST_SHIFT_END_TOP + STATUS_ROW_HEIGHT)) / 2;
const SECOND_DIVIDER_TOP = SECOND_SHIFT_END_TOP + STATUS_ROW_HEIGHT + (THIRD_SHIFT_START_TOP - (SECOND_SHIFT_END_TOP + STATUS_ROW_HEIGHT)) / 2;

const screenBg = {
  backgroundImage:
    'radial-gradient(141.42% 102.21% at 0% 0%, #313701 0%, #000000 46%, #000000 84%, #000000 100%)',
};

// Ohne top stehen Karte und Rahmenzeile im Fluss (Live-Verlauf), mit top fest im Demo-Raster.
const lage = (top) => (top == null ? { className: 'w-[362px]' } : { className: 'absolute left-[20px] w-[362px]', style: { top: `${top}px` } });

const EntryCard = ({ top, dateLabel, names, multiLine = false }) => (
  <div {...lage(top)}>
    <div className={`w-full bg-white overflow-hidden flex flex-col justify-center ${names.length > 2 ? 'py-2' : multiLine ? 'h-28' : 'h-24'}`}>
      <div className="self-stretch flex-1 px-4 py-2.5 rounded inline-flex justify-start items-center gap-3">
        <div className="flex-1 min-h-8 inline-flex flex-col justify-center items-start gap-[5px]">
          <div className="self-stretch text-zinc-900/80 text-sm font-medium leading-4 tracking-wide">{dateLabel}</div>
          <div className={`self-stretch text-zinc-900 text-2xl font-bold tracking-wide ${multiLine ? 'leading-7' : 'leading-6'}`}>
            {names.map((name, idx) => (
              <React.Fragment key={`${dateLabel}-${name}-${idx}`}>
                {idx > 0 ? <br /> : null}
                {name}
              </React.Fragment>
            ))}
          </div>
        </div>
      </div>
    </div>
  </div>
);

const StatusRow = ({ top, label, color }) => (
  <div {...lage(top)}>
    <div className="w-full h-12 min-h-12 outline outline-1 outline-offset-[-1px] flex flex-col justify-center items-start overflow-hidden" style={{ outlineColor: color }}>
      <div className="self-stretch flex-1 px-4 py-2.5 rounded inline-flex justify-start items-center gap-3">
        <div className="flex-1 min-h-8 inline-flex flex-col justify-center items-start">
          <div className="self-stretch text-2xl font-bold leading-6 tracking-wide" style={{ color }}>
            {label}
          </div>
        </div>
      </div>
    </div>
  </div>
);

const ERLEDIGT = ['done', 'completed', 'arrived', 'beendet'];

// Fahrt aus der Datenbank-Funktion verlauf_fahrten() oder (solange sie fehlt) direkt aus jobs.
const ausJob = (j) => {
  const etd = String(j.etd || j.original_etd || '').slice(0, 5);
  const abfahrt = zuZeitpunkt(j.ride_date, etd);
  const dauer = Number(j.ext_route_duration_mins);
  return {
    id: j.id,
    datum: j.ride_date,
    abfahrt,
    ankunft: abfahrt && Number.isFinite(dauer) && dauer > 0 ? new Date(new Date(abfahrt).getTime() + dauer * 60000).toISOString() : null,
    gaeste: j.passengers || [],
    anonym: j.anonymous_guests || 0,
  };
};

const useVerlaufFahrten = (tage = 60) => {
  const [fahrten, setFahrten] = useState(null);
  const [stand, setStand] = useState(0);
  useEffect(() => {
    let aktiv = true;
    (async () => {
      const { data, error } = await supabase.rpc('verlauf_fahrten', { p_tage: tage });
      if (!error) { if (aktiv) setFahrten(data || []); return; }
      // Rueckfall ohne Statusverlauf: eigene Fahrten ueber die Fahrer-RLS, Ankunft = Abfahrt + Fahrzeit.
      const uid = (await supabase.auth.getUser()).data?.user?.id;
      const ab = new Date(Date.now() - tage * 86400000).toISOString().slice(0, 10);
      const { data: jobs } = uid
        ? await supabase.from('jobs')
          .select('id, ride_date, etd, original_etd, ext_route_duration_mins, passengers, anonymous_guests, status')
          .eq('driver_id', uid).in('status', ERLEDIGT).gte('ride_date', ab)
        : { data: [] };
      if (aktiv) setFahrten((jobs || []).map(ausJob));
    })();
    return () => { aktiv = false; };
  }, [tage, stand]);
  useEffect(() => {
    const sichtbar = () => { if (document.visibilityState === 'visible') setStand((n) => n + 1); };
    document.addEventListener('visibilitychange', sichtbar);
    return () => document.removeEventListener('visibilitychange', sichtbar);
  }, []);
  return fahrten;
};

const zeitwert = (iso) => (iso ? new Date(iso).getTime() : 0);

// Tage (neueste zuerst). Im Tag chronologisch: Dienste mit ihren Fahrten als Rahmen, sonst lose Fahrten.
// Eine Fahrt gehoert zum Dienst, wenn der Stundenvorschlag sie nennt oder sie im Dienstfenster startet.
const verlaufTage = (fahrten, dienste) => {
  const rahmen = (dienste || []).map((e) => {
    const beginn = zuZeitpunkt(e.dienst.datum, e.dienst.beginn || '');
    const ende = zuZeitpunkt(e.dienst.datum, e.dienst.ende || '', beginn);
    return { art: 'dienst', datum: e.dienst.datum, start: beginn, ende, eintrag: e, ids: new Set((e.vorschlag?.fahrten || []).map((f) => f.id)), fahrten: [] };
  });
  const tage = new Map();
  const tag = (datum) => {
    if (!tage.has(datum)) tage.set(datum, []);
    return tage.get(datum);
  };
  rahmen.forEach((r) => tag(r.datum).push(r));
  (fahrten || []).forEach((f) => {
    const t = zeitwert(f.abfahrt);
    const r = rahmen.find((d) => d.ids.has(f.id))
      || rahmen.find((d) => d.start && d.ende && t >= zeitwert(d.start) && t <= zeitwert(d.ende));
    if (r) r.fahrten.push(f);
    else tag(f.datum).push({ art: 'fahrt', datum: f.datum, start: f.abfahrt, fahrt: f });
  });
  rahmen.forEach((r) => r.fahrten.sort((a, b) => zeitwert(a.abfahrt) - zeitwert(b.abfahrt)));
  return [...tage.entries()]
    .sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0))
    .map(([datum, eintraege]) => ({ datum, eintraege: eintraege.sort((a, b) => zeitwert(a.start) - zeitwert(b.start)) }));
};

const datumText = (datum) => (datum ? `${datum.slice(8, 10)}.${datum.slice(5, 7)}.${datum.slice(0, 4)}` : '');

const FahrtKarte = ({ f, t }) => {
  const namen = gaesteZeilen(f.gaeste, f.anonym, t);
  return (
    <EntryCard
      dateLabel={`${datumText(f.datum)} ${uhr(f.abfahrt)}${f.ankunft ? ` - ${uhr(f.ankunft)}` : ''}`}
      names={namen}
      multiLine={namen.length > 1}
    />
  );
};

// Live-Verlauf: erledigte Fahrten nach Tagen, Dienste aus der Stundenerfassung als Rahmen mit Stundenkarte.
function FahrtenVerlauf({ t }) {
  const fahrten = useVerlaufFahrten(60);
  const { eintraege: dienste, laden } = useStundenVerlauf(60);
  const aktionen = useStundenAktionen(laden);
  const tage = useMemo(() => verlaufTage(fahrten, dienste), [fahrten, dienste]);
  if (fahrten === null || dienste === null) return null;
  if (!tage.length) {
    return <p className="text-white/70 text-[16px] font-medium leading-6 tracking-[0.5px]">{t('misc.historyEmpty')}</p>;
  }
  return (
    <div className="flex flex-col gap-[44px]">
      {tage.map((tag) => (
        <div key={tag.datum} className="flex flex-col gap-[24px]">
          <Tageszeile datum={tag.datum} />
          <div className="flex flex-col gap-[6px]">
            {tag.eintraege.map((e) => (e.art === 'fahrt' ? <FahrtKarte key={e.fahrt.id} f={e.fahrt} t={t} /> : (
              <div key={e.eintrag.dienst.id} className="flex flex-col gap-[6px]">
                <div className="mb-[9px]"><StatusRow label={t('misc.shiftStart', { time: e.eintrag.dienst.beginn || uhr(e.start) })} color="#E3F654" /></div>
                {e.fahrten.map((f) => <FahrtKarte key={f.id} f={f} t={t} />)}
                {e.eintrag.vorbei ? (
                  <>
                    <div className="mt-[9px]"><StatusRow label={t('misc.shiftEnd', { time: e.eintrag.dienst.ende || uhr(e.ende) })} color="#ff6f63" /></div>
                    <div className="mt-[18px]">
                      <StundenKarte
                        eintrag={e.eintrag}
                        busy={aktionen.busyId === e.eintrag.dienst.id}
                        annehmen={() => aktionen.annehmen(e.eintrag)}
                        bearbeiten={() => aktionen.bearbeiten(e.eintrag)}
                        ablehnen={() => aktionen.ablehnen(e.eintrag)}
                      />
                    </div>
                  </>
                ) : (
                  <div className="mt-[9px] text-[16px] font-medium text-white/50">{t('misc.shiftRunning')}</div>
                )}
              </div>
            )))}
          </div>
        </div>
      ))}
      {aktionen.ebene}
    </div>
  );
}

export default function Verlauf({ setView }) {
  const { t } = useI18n();
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const updateScale = () => {
      setScale(Math.min(window.innerWidth / BASE_WIDTH, 1));
    };
    updateScale();
    window.addEventListener('resize', updateScale);
    return () => window.removeEventListener('resize', updateScale);
  }, []);

  // Live: erledigte Fahrten und Dienste aus der Stundenerfassung, im Fluss statt festem Raster.
  if (!DEMO_MODE) {
    return (
      <>
        <div className="h-dvh w-full overflow-y-auto overscroll-none" style={{ ...screenBg, fontFamily: 'Space Grotesk, sans-serif' }}>
          <div className="w-[min(402px,100vw)] mx-auto px-[20px] pt-[60px] pb-[90px]">
            <div className="relative h-[50px]"><ZurueckKnopf onClick={() => setView('profilFahrer')} marker="verlauf-zurueck" links={0} oben={0} /></div>
            <h1 className="mt-[30px] text-[#E3F654] text-[42px] leading-[42px] font-bold tracking-[-0.5px]">{t('misc.history')}</h1>
            <div className="mt-[24px]"><FahrtenVerlauf t={t} /></div>
          </div>
        </div>
        <TrisarFooter className="fixed bottom-0 left-1/2 -translate-x-1/2 w-[min(402px,100vw)] h-10 bg-black z-30" />
      </>
    );
  }

  return (
    <>
    <div
      className="h-dvh w-full bg-black overflow-y-auto overscroll-none flex justify-center"
      style={{
        WebkitTextSizeAdjust: 'none',
        textSizeAdjust: 'none',
        fontFamily: 'Space Grotesk, sans-serif',
        touchAction: 'pan-y',
        WebkitOverflowScrolling: 'touch',
      }}
    >
      <div className="relative shrink-0" style={{ width: `${BASE_WIDTH * scale}px`, height: `${BASE_HEIGHT * scale}px` }}>
        <div
          className="absolute left-0 top-0 w-[402px] h-[1524px] origin-top-left overflow-hidden"
          style={{ ...screenBg, transform: `scale(${scale})` }}
        >
          <div className="absolute left-0 top-[218px] w-[402px] h-[1046px] bg-zinc-900 rounded-tl-xl rounded-tr-xl" />

          <ZurueckKnopf onClick={() => setView('profilFahrer')} marker="verlauf-zurueck" />

          <h1 className="absolute left-[20px] top-[140px] text-[#E3F654] text-[42px] leading-[42px] font-bold tracking-[-0.5px]">
            {t('misc.history')}
          </h1>

          {/* Die Dienste unten sind Demo-Beispiele, live gibt es noch keinen echten Verlauf. */}
          {DEMO_MODE ? (
            <>
              <StatusRow top={199 + CONTENT_SHIFT} label={t('misc.shiftStart', { time: '15:30' })} color="#E3F654" />
              <EntryCard top={262 + CONTENT_SHIFT} dateLabel="22.01.2026     16:00 - 18:00" names={['Horst Engel']} />
              <EntryCard top={364 + CONTENT_SHIFT} dateLabel="22.01.2026     18:30 - 20:00" names={['Horst Engel', 'Marknus Müller']} multiLine />
              <StatusRow top={FIRST_SHIFT_END_TOP} label={t('misc.shiftEnd', { time: '20:30' })} color="#ff6f63" />

              <StatusRow top={SECOND_SHIFT_START_TOP} label={t('misc.shiftStart', { time: '17:30' })} color="#E3F654" />
              <EntryCard top={626 + CONTENT_SHIFT} dateLabel="21.01.2026     18:00 - 22:00" names={['Horst Engel', 'Marknus Müller']} multiLine />
              <EntryCard top={744 + CONTENT_SHIFT} dateLabel="21.01.2026     18:00 - 22:00" names={['Horst Engel', 'Marknus Müller']} multiLine />
              <EntryCard top={862 + CONTENT_SHIFT} dateLabel="21.01.2026     18:00 - 22:00" names={['Horst Engel', 'Marknus Müller']} multiLine />
              <EntryCard top={980 + CONTENT_SHIFT} dateLabel="21.01.2026     18:00 - 22:00" names={['Horst Engel', 'Marknus Müller']} multiLine />
              <StatusRow top={SECOND_SHIFT_END_TOP} label={t('misc.shiftEnd', { time: '22:30' })} color="#ff6f63" />

              <StatusRow top={THIRD_SHIFT_START_TOP} label={t('misc.shiftStart', { time: '17:30' })} color="#E3F654" />
              <EntryCard top={1242 + CONTENT_SHIFT} dateLabel="20.01.2026     18:00 - 20:00" names={['Horst Engel', 'Marknus Müller']} multiLine />
              <StatusRow top={1366 + CONTENT_SHIFT} label={t('misc.shiftEnd', { time: '22:30' })} color="#ff6f63" />

              <div className="absolute left-[112px] w-44 h-0 border-t border-[#E3F654]" style={{ top: `${FIRST_DIVIDER_TOP}px` }} />
              <div className="absolute left-[112px] w-44 h-0 border-t border-[#E3F654]" style={{ top: `${SECOND_DIVIDER_TOP}px` }} />
            </>
          ) : (
            <p className="absolute left-[20px] top-[242px] w-[362px] text-white/70 text-[16px] font-medium leading-6 tracking-[0.5px]">
              {t('misc.historyEmpty')}
            </p>
          )}

        </div>
      </div>
    </div>
    {/* Footer fest am unteren Rand — ausserhalb des skalierten Inhalts, weil
        position: fixed sich sonst am transform-Elternteil ausrichten wuerde. */}
    <TrisarFooter className="fixed bottom-0 left-1/2 -translate-x-1/2 w-[min(402px,100vw)] h-10 bg-black z-30" />
    </>
  );
}
