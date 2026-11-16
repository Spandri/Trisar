// Dienstreise (Stil wie Standby): Datum, Start Zeit, Start, Ziel, Zug/Flug mit Live-Stand, Fahrer #1, #2 ...
// mit Zustand rechts (Angefragt, Angenommen, Abgelehnt, Beendet), Notizen, Speichern, Dienstreise loeschen.
// Geaenderte Zeit bestaetigen die Fahrer neu (Trigger), neue Fahrer bekommen eine Anfrage, × nimmt einen raus.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import BackCircleButton from '../ui/BackCircleButton';
import NaviFooterKomponente from '../navigation/NaviFooterKomponente';
import { FormRow } from './FahrtAdd';
import { useI18n } from '../../i18n';
import { supabase } from '../../services/supabase';
import { fahrerIdFinden, fahrerName } from '../../shared/standby';
import {
  dienstreiseFahrerDazu, dienstreiseFahrerWeg, dienstreiseLoeschen, hm, minutenSpaet, reiseZustand, ticketLink,
  useAbschnittVerbindungen, useDienstreisen, verbindungHolen, zeitFarbe,
} from '../../shared/dienstreise';
import { reiseLage } from '../../shared/reiseLage';
import { HalteListe, SpaetKachel } from '../ui/ZugHalte';

const GREEN = '#E3F654';
const kurzName = (p) => {
  if (!p) return 'Fahrer';
  const n = `${p.first_name && p.last_name ? `${p.first_name[0]}. ` : (p.first_name || '')}${p.last_name || ''}`.trim();
  return `${n || 'Fahrer'}${p.driver_number != null ? ` (${p.driver_number})` : ''}`;
};
const ROW_STEP = 68;
const ROW_HEIGHT = 56;
const HINTERGRUND = 'radial-gradient(ellipse 141.42% 102.21% at 0% 0%, #0048cf 0%, #00369b 11.415%, #002468 22.83%, #001b4e 28.537%, #001234 34.244%, #00091a 39.952%, #00050d 42.805%, #000000 45.659%, #000000 83.626%, #000000 100%)';
const FARB_KLASSE = {
  '#E3F654': 'text-[#E3F654]',
  '#FF6F63': 'text-[#FF6F63]',
  '#868687': 'text-[#868687]',
};

export default function DienstreiseView({ reiseId, onBack, setView = () => {} }) {
  const { t } = useI18n();
  const { liste, laden } = useDienstreisen();
  const r = (liste || []).find((x) => x.id === reiseId);
  const [werte, setWerte] = useState(null);
  const [neue, setNeue] = useState(['']);
  const [meldung, setMeldung] = useState('');
  const [speichert, setSpeichert] = useState(false);
  const [live, setLive] = useState(null);

  // Verbindung live holen (Abfahrt, Gleis, Ankunft), sonst Stand beim Anlegen.
  const nummer = r ? (r.zugnummer || r.flugnummer || '') : '';
  useEffect(() => {
    let aktiv = true;
    if (!r || !nummer) return undefined;
    verbindungHolen(r).then((v) => { if (aktiv) setLive(v); }).catch(() => {});
    return () => { aktiv = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [r?.id, nummer, r?.datum, r?.start_name]);

  // Mit Umstiegen: Live-Stand je Abschnitt (Zeiten, Verspaetung, Halte).
  const mitTeilen = Array.isArray(r?.abschnitte) && r.abschnitte.length > 1;
  const liveJe = useAbschnittVerbindungen(mitTeilen ? r : null);
  const [jetzt, setJetzt] = useState(() => Date.now());
  useEffect(() => { const uhr = setInterval(() => setJetzt(Date.now()), 30000); return () => clearInterval(uhr); }, []);
  // Laufender/gefahrener Abschnitt (fuer die Halte): wie in der Fahrer-App ueber reiseLage.
  const vEinzeln = live && !live.fehler ? live : r?.verbindung;
  const lageStatus = useMemo(() => {
    if (!r) return [];
    const teileLage = mitTeilen ? r.abschnitte : [{
      id: 'haupt', art: r.flugnummer ? 'flug' : 'zug',
      von_lat: r.start_lat, von_lng: r.start_lng, nach_lat: r.ziel_lat, nach_lng: r.ziel_lng,
      ab_datum: r.datum, ab_zeit: r.start_zeit, an_zeit: null,
    }];
    return reiseLage({ teile: teileLage, liveJe: mitTeilen ? liveJe : { haupt: vEinzeln || {} }, datum: r.datum, jetzt })?.status || [];
  }, [r, mitTeilen, liveJe, vEinzeln, jetzt]);
  // Abschnitte samt aufgeklappter Halte sind verschieden hoch: Hoehe messen, alles darunter rueckt nach.
  const [blockHoehe, setBlockHoehe] = useState(0);
  const beobachter = useRef(null);
  const blockRef = useCallback((el) => {
    beobachter.current?.disconnect();
    beobachter.current = null;
    if (!el) { setBlockHoehe(0); return; }
    setBlockHoehe(el.offsetHeight);
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(() => setBlockHoehe(el.offsetHeight));
      ro.observe(el);
      beobachter.current = ro;
    }
  }, []);

  if (liste === null) return <div className="h-dvh bg-black" />;
  if (!r) {
    return (
      <div className="w-[min(402px,100vw)] h-dvh mx-auto px-5 pt-[60px]" style={{ background: HINTERGRUND }}>
        <BackCircleButton onClick={onBack} />
        <div className="mt-[30px] text-[18px] font-bold font-['Space_Grotesk']" style={{ color: GREEN }}>Dienstreise nicht mehr vorhanden.</div>
      </div>
    );
  }

  const v = vEinzeln;
  const verbindungText = (() => {
    if (!nummer) return null;
    if (live?.fehler && !r.verbindung) return { text: 'nicht gefunden', colorClass: 'text-[#FF6F63]' };
    if (!v) return { text: 'prüfe …', colorClass: 'text-[#868687]' };
    // Verspaetet: Zeit orange, daneben "+5" (Entwurf 14.11.), puenktlich Lime.
    const spaetAb = minutenSpaet(v.abfahrt_plan, v.abfahrt);
    const spaetAn = minutenSpaet(v.ankunft_plan, v.ankunft);
    return {
      text: `ab ${v.abfahrt}${v.ankunft ? ` · an ${v.ankunft}` : ''}`,
      colorClass: 'text-[#E3F654]',
      inhalt: (
        <span className="flex items-center gap-[4px] whitespace-nowrap">
          ab <span style={{ color: zeitFarbe(spaetAb) }}>{v.abfahrt}</span><SpaetKachel min={spaetAb} />
          {v.ankunft ? <> · an <span style={{ color: zeitFarbe(spaetAn) }}>{v.ankunft}</span><SpaetKachel min={spaetAn} /></> : null}
        </span>
      ),
    };
  })();

  const w = werte || { datum: r.datum, zeit: hm(r.start_zeit), notiz: r.notiz || '' };
  const setze = (feld) => (wert) => setWerte({ ...w, [feld]: wert });
  const neueSetzen = (i, wert) => setNeue((alt) => [...alt.map((n, j) => (j === i ? wert : n)).filter((n) => String(n).trim()), '']);

  const speichern = async () => {
    setSpeichert(true);
    setMeldung('');
    try {
      const aenderung = {};
      if (w.datum !== r.datum) aenderung.datum = w.datum;
      if (w.zeit !== hm(r.start_zeit)) aenderung.start_zeit = w.zeit;
      if ((w.notiz || '') !== (r.notiz || '')) aenderung.notiz = w.notiz || null;
      if (Object.keys(aenderung).length) {
        const { error } = await supabase.from('dienstreise').update(aenderung).eq('id', r.id);
        if (error) { setMeldung(`Nicht gespeichert: ${error.message}`); return; }
      }
      const namen = neue.map((n) => String(n).trim()).filter(Boolean);
      if (namen.length) {
        const { data: profile } = await supabase.from('profiles').select('id, first_name, last_name, driver_number');
        const ids = [];
        for (const n of namen) {
          const id = fahrerIdFinden(n, profile || []);
          if (!id) { setMeldung(`Fahrer „${n}“ nicht gefunden.`); return; }
          ids.push(id);
        }
        const f = await dienstreiseFahrerDazu(r.id, ids);
        if (f) { setMeldung(`Fahrer nicht gespeichert: ${f}`); return; }
      }
      setWerte(null);
      setNeue(['']);
      setMeldung(aenderung.datum || aenderung.start_zeit ? 'Gespeichert, die Fahrer bestätigen die neue Zeit.' : 'Gespeichert.');
      laden();
    } finally {
      setSpeichert(false);
    }
  };

  const fahrerWeg = async (f) => {
    if (!window.confirm(`${fahrerName(f.profil)} aus der Dienstreise nehmen?`)) return;
    const e = await dienstreiseFahrerWeg(r.id, f.driver_id);
    setMeldung(e ? `Nicht gespeichert: ${e}` : `${fahrerName(f.profil)} ist raus.`);
    laden();
  };

  const loeschen = async () => {
    if (!window.confirm(`Dienstreise ${r.start_name} → ${r.ziel_name} löschen? Alle Fahrer bekommen „Dienstreise zurückgezogen“.`)) return;
    const e = await dienstreiseLoeschen(r.id);
    if (e) { setMeldung(`Nicht gelöscht: ${e}`); return; }
    onBack();
  };

  const nurLesen = { onChange: () => {}, rightAction: { type: 'pfeil', onClick: () => {}, ariaLabel: '' } };
  const alleZeilen = r.fahrer.length + neue.length;
  // Mit Umstiegen: je Abschnitt eine Zeile (Nummer | Zeit Start → Ziel), sonst Start, Ziel, Nummer wie bisher.
  const teile = mitTeilen ? r.abschnitte : null;
  const teileOben = 342;
  // Gemessene Hoehe (Abschnitte bzw. Halte des Zuges), vor dem ersten Messen wie bisher.
  const zielOben = teile ? teileOben + (blockHoehe || teile.length * ROW_STEP - (ROW_STEP - ROW_HEIGHT)) + (ROW_STEP - ROW_HEIGHT) : 410;
  const ticketOben = (teile ? zielOben + ROW_STEP : 206 + 5 * ROW_STEP + blockHoehe);
  const fahrerOben = ticketOben + (r.ticket_pfad ? ROW_STEP : 0);
  const ticketOeffnen = async () => {
    const url = await ticketLink(r.ticket_pfad);
    if (url) window.open(url, '_blank', 'noopener');
    else setMeldung('Ticket konnte nicht geöffnet werden.');
  };
  const notizOben = fahrerOben + (alleZeilen - 1) * ROW_STEP + ROW_HEIGHT + 24;
  const ctaOben = notizOben + 224 + 24;
  const loeschOben = ctaOben + ROW_HEIGHT + 16;
  const hoehe = loeschOben + ROW_HEIGHT + (meldung ? 70 : 40);
  const nummerLabel = (i) => (alleZeilen > 1 ? t('fahrt.fahrerNumbered', { n: i + 1 }) : t('fahrt.fahrer'));

  return (
    <div className="w-[min(402px,100vw)] h-dvh relative mx-auto overflow-hidden" style={{ background: HINTERGRUND }}>
      <div className="h-full overflow-y-auto overflow-x-hidden overscroll-none pb-[151px]">
        <div className="w-[402px] relative overflow-hidden" style={{ height: `${hoehe}px`, background: HINTERGRUND }}>
          <BackCircleButton onClick={onBack} className="absolute left-[20px] top-[60px]" />
          <div className="absolute left-[20px] top-[140px] text-[42px] leading-[42px] font-bold font-['Space_Grotesk']" style={{ color: GREEN }}>
            Dienstreise
          </div>

          <FormRow top={206} label="Datum" value={w.datum} onChange={setze('datum')} onReset={() => setze('datum')('')} mode="date" />
          <FormRow top={274} label="Start Zeit" value={w.zeit} onChange={setze('zeit')} onReset={() => setze('zeit')('')} mode="time" />
          {teile ? (
            <>
              {/* Je Abschnitt: Nummer | Abfahrt Start → Ankunft Ziel, verspaetet orange mit "+5", darunter die Halte. */}
              <div ref={blockRef} className="absolute left-[20px] w-[362px] flex flex-col font-['Space_Grotesk']" style={{ top: `${teileOben}px`, gap: `${ROW_STEP - ROW_HEIGHT}px` }}>
                {teile.map((a, i) => {
                  const lv = liveJe[a.id];
                  const ab = lv?.abfahrt || hm(a.ab_zeit);
                  const an = lv?.ankunft || hm(a.an_zeit);
                  const spaetAb = minutenSpaet(lv?.abfahrt_plan, lv?.abfahrt);
                  const spaetAn = minutenSpaet(lv?.ankunft_plan, lv?.ankunft);
                  const gleis = lv?.gleis || a.gleis_ab;
                  return (
                    <div key={a.id}>
                      <div className="w-[362px] h-14 border-2 flex items-center gap-[8px] px-[16px] overflow-hidden text-[16px] font-medium leading-6 tracking-[0.5px]" style={{ borderColor: GREEN }}>
                        <span className="shrink-0 opacity-50" style={{ color: GREEN }}>{a.nummer || `Abschnitt ${i + 1}`}</span>
                        <span className="flex-1 min-w-0 flex items-center gap-[4px] overflow-hidden whitespace-nowrap">
                          {ab ? <span className="shrink-0" style={{ color: zeitFarbe(spaetAb) }}>{ab}</span> : null}
                          <SpaetKachel min={spaetAb} />
                          <span className="min-w-0 truncate" style={{ color: GREEN }}>{a.von_name}</span>
                          <span className="shrink-0" style={{ color: GREEN }}>→</span>
                          {an ? <span className="shrink-0" style={{ color: zeitFarbe(spaetAn) }}>{an}</span> : null}
                          <SpaetKachel min={spaetAn} />
                          <span className="min-w-0 truncate" style={{ color: GREEN }}>{a.nach_name || ''}</span>
                        </span>
                        {gleis ? <span className="shrink-0 text-[12px] font-bold text-[#868687]">Gl. {gleis}</span> : null}
                      </div>
                      <HalteListe halte={lv?.halte} status={lageStatus[i]} abfahrt={ab} jetzt={jetzt} />
                    </div>
                  );
                })}
              </div>
              <FormRow top={zielOben} label="Ziel" value={r.ziel_name} {...nurLesen} />
            </>
          ) : (
            <>
              <FormRow top={342} label="Start" value={r.start_name} {...nurLesen} />
              <FormRow top={410} label="Ziel" value={r.ziel_name} {...nurLesen} />
              <FormRow
                top={478}
                label={r.flugnummer ? 'Flugnummer' : 'Zugnummer'}
                value={nummer || '–'}
                {...nurLesen}
                etaIndicator={verbindungText}
              />
              {/* Halte des Zuges unter der Zugnummer (nur wenn der Server sie liefert). */}
              {!r.flugnummer && v?.halte?.length ? (
                <div ref={blockRef} className="absolute left-[20px] w-[362px] font-['Space_Grotesk']" style={{ top: `${478 + ROW_HEIGHT}px` }}>
                  <HalteListe halte={v.halte} status={lageStatus[0]} abfahrt={v.abfahrt} jetzt={jetzt} />
                </div>
              ) : null}
            </>
          )}
          {r.ticket_pfad ? (
            <FormRow
              top={ticketOben}
              label="Ticket"
              value={r.ticket_name || 'Ticket.pdf'}
              onChange={() => {}}
              rightAction={{ type: 'pfeil', onClick: ticketOeffnen, ariaLabel: 'Ticket öffnen' }}
            />
          ) : null}

          {r.fahrer.map((f, i) => {
            const z = reiseZustand(f);
            return (
              <FormRow
                key={f.driver_id}
                top={fahrerOben + i * ROW_STEP}
                label={nummerLabel(i)}
                value={kurzName(f.profil)}
                onChange={() => {}}
                onReset={() => fahrerWeg(f)}
                etaIndicator={{ text: z.text, colorClass: FARB_KLASSE[z.farbe] }}
              />
            );
          })}
          {neue.map((n, j) => (
            <FormRow
              key={`neu-${j}`}
              top={fahrerOben + (r.fahrer.length + j) * ROW_STEP}
              label={nummerLabel(r.fahrer.length + j)}
              value={n}
              onChange={(wert) => neueSetzen(j, wert)}
              onReset={() => neueSetzen(j, '')}
              mode="fahrer"
            />
          ))}

          <div className="absolute left-0 right-0 bg-[#1a1a1a] rounded-[12px]" style={{ top: `${notizOben}px`, height: '224px' }}>
            <div className="absolute left-[20px] right-[20px] top-[20px] bottom-[20px] bg-white overflow-hidden">
              <div className="p-4 h-full flex flex-col">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-[#1d1c1d] text-[16px] font-bold tracking-[0.5px]" style={{ fontFamily: 'Space Grotesk' }}>{t('fahrt.notizen')}</h3>
                  <img src="/icon/_Icon_Lime/Arrow-kurz_Trisar_Icons_01_Lime.svg" alt="" className="w-[10px] h-[13px]" />
                </div>
                <textarea
                  value={w.notiz}
                  onChange={(e) => setze('notiz')(e.target.value)}
                  placeholder={t('fahrt.notesPlaceholder')}
                  className="flex-1 text-[14px] text-[rgba(129,129,129,0.5)] resize-none border-none outline-none bg-transparent tracking-[0.25px]"
                  style={{ fontFamily: 'Space Grotesk' }}
                />
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={speichern}
            disabled={speichert}
            className="w-[362px] h-14 left-[20px] absolute inline-flex justify-start items-center gap-1 overflow-hidden bg-[#E3F654] border-2 border-[#E3F654] disabled:opacity-70"
            style={{ top: `${ctaOben}px` }}
          >
            <div className="flex-1 self-stretch p-1 flex justify-start items-center">
              <div className="flex-1 self-stretch px-3 flex justify-start items-center gap-2.5">
                <div className="justify-center text-neutral-800 text-base font-medium font-['Space_Grotesk'] leading-6 tracking-wide">{speichert ? t('fahrt.saving') : 'Speichern'}</div>
              </div>
            </div>
            <div className="mr-4 flex items-center justify-center">
              <img src="/icon/_Icon_Schwarz/Arrow_Trisar_Icons_01.svg" alt="" className="w-[34px] h-[20px]" />
            </div>
          </button>

          <button
            type="button"
            onClick={loeschen}
            className="w-[362px] h-14 left-[20px] absolute inline-flex justify-center items-center bg-[#221313] border-2 border-[#f55757] text-[#f55757] text-base font-medium font-['Space_Grotesk'] leading-6 tracking-wide"
            style={{ top: `${loeschOben}px` }}
          >
            Dienstreise löschen
          </button>

          {meldung ? (
            <div className="absolute left-[20px] w-[362px] text-[13px] font-bold text-white/70 font-['Space_Grotesk']" style={{ top: `${loeschOben + ROW_HEIGHT + 12}px` }}>{meldung}</div>
          ) : null}
        </div>
      </div>
      <NaviFooterKomponente
        onNavigateHome={() => setView('list')}
        onNavigateToFahrten={() => setView('ankuenfte')}
        onNavigateToVehicles={() => setView('fahrzeugListe')}
        onNavigateToProfile={() => setView('alleFahrer')}
        onNavigateToAddFahrt={() => setView('fahrtAdd')}
        onNavigateToKi={() => setView('kiAssistent')}
        onNavigateToPlanung={() => setView('kiPlaner')}
        onNavigateToMap={() => setView('karten')}
        activeTab="fahrten"
      />
    </div>
  );
}
