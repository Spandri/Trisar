// Standby (Stil wie Fahrt bearbeiten): Datum, Von, Bis, Ort, Fahrer #1, #2 ... mit Zustand
// rechts in der Zeile (Angefragt, Vor Ort, Mit Gast, Rueckweg ...), Notizen, Speichern, Standby loeschen.
// Geaenderte Zeiten bestaetigen die Fahrer einzeln, neue Fahrer bekommen eine Anfrage, × nimmt einen raus.

import { useState } from 'react';
import BackCircleButton from '../ui/BackCircleButton';
import NaviFooterKomponente from '../navigation/NaviFooterKomponente';
import { FormRow } from './FahrtAdd';
import { useI18n } from '../../i18n';
import { supabase } from '../../services/supabase';
import {
  fahrerIdFinden, fahrerName, hm, standbyFahrerDazu, standbyFahrerWeg, standbyLoeschen, useStandbys, zustandAnzeige,
} from '../../shared/standby';

const GREEN = '#E3F654';
// "S. Spandri (99)", damit der Zustand rechts daneben Platz hat.
const kurzName = (p) => {
  if (!p) return 'Fahrer';
  const n = `${p.first_name && p.last_name ? `${p.first_name[0]}. ` : (p.first_name || '')}${p.last_name || ''}`.trim();
  return `${n || 'Fahrer'}${p.driver_number != null ? ` (${p.driver_number})` : ''}`;
};
const ROW_STEP = 68;
const ROW_HEIGHT = 56;
const HINTERGRUND = 'radial-gradient(ellipse 141.42% 102.21% at 0% 0%, #0048cf 0%, #00369b 11.415%, #002468 22.83%, #001b4e 28.537%, #001234 34.244%, #00091a 39.952%, #00050d 42.805%, #000000 45.659%, #000000 83.626%, #000000 100%)';
// Zustand rechts in der Fahrerzeile (feste Klassen, damit Tailwind sie kennt).
const FARB_KLASSE = {
  '#E3F654': 'text-[#E3F654]',
  '#FFCD8A': 'text-[#FFCD8A]',
  '#FF6F63': 'text-[#FF6F63]',
  '#868687': 'text-[#868687]',
};

export default function StandbyView({ standbyId, onBack, setView = () => {} }) {
  const { t } = useI18n();
  const { liste, laden } = useStandbys();
  const s = (liste || []).find((x) => x.id === standbyId);
  const [werte, setWerte] = useState(null);
  const [neue, setNeue] = useState(['']);
  const [meldung, setMeldung] = useState('');
  const [speichert, setSpeichert] = useState(false);

  if (liste === null) return <div className="h-dvh bg-black" />;
  if (!s) {
    return (
      <div className="w-[min(402px,100vw)] h-dvh mx-auto px-5 pt-[60px]" style={{ background: HINTERGRUND }}>
        <BackCircleButton onClick={onBack} />
        <div className="mt-[30px] text-[18px] font-bold font-['Space_Grotesk']" style={{ color: GREEN }}>Standby nicht mehr vorhanden.</div>
      </div>
    );
  }

  // Formularwerte: erst die gespeicherten, nach Aenderung die eigenen.
  const w = werte || { datum: s.datum, von: hm(s.von), bis: hm(s.bis), notiz: s.notiz || '' };
  const setze = (feld) => (wert) => setWerte({ ...w, [feld]: wert });
  const neueSetzen = (i, wert) => setNeue((alt) => {
    const liste2 = alt.map((n, j) => (j === i ? wert : n)).filter((n) => String(n).trim());
    return [...liste2, ''];
  });

  const speichern = async () => {
    setSpeichert(true);
    setMeldung('');
    try {
      // Zeiten und Notiz: der Trigger macht aus geaenderten Zeiten Anfragen an die Fahrer.
      const aenderung = {};
      if (w.datum !== s.datum) aenderung.datum = w.datum;
      if (w.von !== hm(s.von)) aenderung.von = w.von;
      if (w.bis !== hm(s.bis)) aenderung.bis = w.bis;
      if ((w.notiz || '') !== (s.notiz || '')) aenderung.notiz = w.notiz || null;
      if (Object.keys(aenderung).length) {
        const { error } = await supabase.from('standby').update(aenderung).eq('id', s.id);
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
        const f = await standbyFahrerDazu(s.id, ids);
        if (f) { setMeldung(`Fahrer nicht gespeichert: ${f}`); return; }
      }
      setWerte(null);
      setNeue(['']);
      setMeldung(aenderung.von || aenderung.bis || aenderung.datum ? 'Gespeichert, die Fahrer bestätigen die neuen Zeiten.' : 'Gespeichert.');
      laden();
    } finally {
      setSpeichert(false);
    }
  };

  const fahrerWeg = async (f) => {
    if (!window.confirm(`${fahrerName(f.profil)} aus dem Standby nehmen?`)) return;
    const e = await standbyFahrerWeg(s.id, f.driver_id);
    setMeldung(e ? `Nicht gespeichert: ${e}` : `${fahrerName(f.profil)} ist raus.`);
    laden();
  };

  const loeschen = async () => {
    if (!window.confirm(`Standby ${s.ort_name} löschen? Alle Fahrer bekommen „Standby zurückgezogen“.`)) return;
    const e = await standbyLoeschen(s.id);
    if (e) { setMeldung(`Nicht gelöscht: ${e}`); return; }
    onBack();
  };

  const alleZeilen = s.fahrer.length + neue.length;
  const fahrerOben = 478;
  const notizOben = fahrerOben + (alleZeilen - 1) * ROW_STEP + ROW_HEIGHT + 24;
  const ctaOben = notizOben + 224 + 24;
  const loeschOben = ctaOben + ROW_HEIGHT + 16;
  const hoehe = loeschOben + ROW_HEIGHT + (meldung ? 70 : 40);
  const nummer = (i) => (alleZeilen > 1 ? t('fahrt.fahrerNumbered', { n: i + 1 }) : t('fahrt.fahrer'));

  return (
    <div className="w-[min(402px,100vw)] h-dvh relative mx-auto overflow-hidden" style={{ background: HINTERGRUND }}>
      <div className="h-full overflow-y-auto overflow-x-hidden overscroll-none pb-[151px]">
        <div className="w-[402px] relative overflow-hidden" style={{ height: `${hoehe}px`, background: HINTERGRUND }}>
          <BackCircleButton onClick={onBack} className="absolute left-[20px] top-[60px]" />
          <div className="absolute left-[20px] top-[140px] text-[42px] leading-[42px] font-bold font-['Space_Grotesk']" style={{ color: GREEN }}>
            Standby
          </div>

          <FormRow top={206} label="Datum" value={w.datum} onChange={setze('datum')} onReset={() => setze('datum')('')} mode="date" />
          <FormRow top={274} label="Von" value={w.von} onChange={setze('von')} onReset={() => setze('von')('')} mode="time" />
          <FormRow top={342} label="Bis" value={w.bis} onChange={setze('bis')} onReset={() => setze('bis')('')} mode="time" />
          <FormRow top={410} label="Ort" value={s.ort_name} onChange={() => {}} rightAction={{ type: 'pfeil', onClick: () => {}, ariaLabel: 'Ort' }} />

          {s.fahrer.map((f, i) => {
            const z = zustandAnzeige(f);
            return (
              <FormRow
                key={f.driver_id}
                top={fahrerOben + i * ROW_STEP}
                label={nummer(i)}
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
              top={fahrerOben + (s.fahrer.length + j) * ROW_STEP}
              label={nummer(s.fahrer.length + j)}
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
            Standby löschen
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
