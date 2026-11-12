// Standby verschicken (Schalter "Fahrt | Standby" in Fahrt hinzufuegen): Datum, von, bis, Ort (eigene
// Orte zuerst, sonst Adresse mit Koordinaten), bestimmte Fahrer wie bei Fahrt hinzufuegen, Notiz.
// Jeder Fahrer bekommt eine eigene Anfrage zum Annehmen oder Ablehnen.

import { useEffect, useRef, useState } from 'react';
import NaviFooterKomponente from '../navigation/NaviFooterKomponente';
import BackCircleButton from '../ui/BackCircleButton';
import OrtVorschlag from '../ui/OrtVorschlag';
import { FormRow } from './FahrtAdd';
import ArtUmschalter from '../ui/ArtUmschalter';
import { orteZurEingabe, useOrte } from '../../shared/orte';
import { fahrerMarkierung } from '../../shared/fahrerMarkierung';
import { geocodeAddress } from '../../services/tomtomRoute';
import { supabase } from '../../services/supabase';
import { useI18n } from '../../i18n';
import { fahrerIdFinden, standbyAnlegen } from '../../shared/standby';

const GREEN = '#E3F654';
const ROW_STEP = 68;
const ROW_HEIGHT = 56;
const HINTERGRUND = 'radial-gradient(ellipse 141.42% 102.21% at 0% 0%, #0048cf 0%, #00369b 11.415%, #002468 22.83%, #001b4e 28.537%, #001234 34.244%, #00091a 39.952%, #00050d 42.805%, #000000 45.659%, #000000 83.626%, #000000 100%)';

const heute = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' });

// vorlage: Standby-Karte des KI-Assistenten (dispo-admin/standbyKi.ts standbyKarte) zum Bearbeiten.
export default function StandbyAdd({
  setView, onFetchPlaceSuggestions = async () => [], onGesendet = () => {}, vorlage = null, onVorlageZurueck = null,
}) {
  const { t } = useI18n();
  const { orte } = useOrte();
  const [datum, setDatum] = useState(vorlage?.datum || heute());
  const [von, setVon] = useState(vorlage?.von || '');
  const [bis, setBis] = useState(vorlage?.bis || '');
  const datumZustand = datum;
  const vonZustand = von;
  const bisZustand = bis;
  const [ort, setOrt] = useState({ text: vorlage?.ortId ? (vorlage?.ortName || '') : (vorlage?.adresse || vorlage?.ortName || ''), ortId: vorlage?.ortId || '' });
  const [vorschlaege, setVorschlaege] = useState([]);
  const [ortOffen, setOrtOffen] = useState(false);
  const [notiz, setNotiz] = useState(vorlage?.notiz || '');
  const [fehler, setFehler] = useState('');
  const [sendet, setSendet] = useState(false);
  // Auf der Karte markierte Fahrer sind schon eingetragen.
  const [fahrerNamen, setFahrerNamen] = useState(() => {
    if (vorlage) return [...(vorlage.fahrerNamen || []).filter(Boolean), ''];
    if (fahrerMarkierung.wirkt()) {
      const namen = fahrerMarkierung.lesen().fahrer.map((f) => f.name).filter(Boolean);
      if (namen.length) return [...namen, ''];
    }
    return [''];
  });
  // Eine alte Meldung verschwindet, sobald ein Feld geaendert wird.
  useEffect(() => { setFehler(''); }, [datum, von, bis, ort.text, fahrerNamen]);
  const timer = useRef(null);
  const seq = useRef(0);

  useEffect(() => () => clearTimeout(timer.current), []);

  const ortTippen = (text) => {
    setOrt({ text, ortId: '' });
    clearTimeout(timer.current);
    const q = text.trim();
    if (!q) { setVorschlaege([]); return; }
    setOrtOffen(true);
    const n = seq.current + 1;
    seq.current = n;
    timer.current = setTimeout(async () => {
      const liste = await onFetchPlaceSuggestions(q);
      if (seq.current === n) setVorschlaege(liste || []);
    }, 250);
  };
  const eigeneTreffer = ort.ortId ? [] : orteZurEingabe(orte, ort.text);

  // Leere Fahrerzeile immer am Ende.
  const fahrerSetzen = (i, wert) => setFahrerNamen((alt) => {
    const neu = alt.map((n, j) => (j === i ? wert : n));
    const gefuellt = neu.filter((n) => String(n).trim());
    return [...gefuellt, ''];
  });

  // Safari meldet Uhrzeit-Felder nicht immer an React, obwohl die Zeit angezeigt wird:
  // beim Senden darum den Wert direkt aus dem Feld nehmen, wenn der Zustand leer ist.
  const feldWert = (marker, wert) => wert || document.querySelector(`input[data-tutorial="${marker}"]`)?.value || '';

  const senden = async () => {
    setFehler('');
    const datum = feldWert('standby-datum', datumZustand);
    const von = feldWert('standby-von', vonZustand);
    const bis = feldWert('standby-bis', bisZustand);
    const fehlt = [!datum && 'Datum', !von && 'Von', !bis && 'Bis'].filter(Boolean);
    if (fehlt.length) { setFehler(`Bitte ${fehlt.join(', ')} setzen.`); return; }
    if (!ort.text.trim()) { setFehler('Bitte einen Ort wählen.'); return; }
    const namen = fahrerNamen.map((n) => String(n).trim()).filter(Boolean);
    if (!namen.length) { setFehler('Bitte mindestens einen Fahrer eintragen.'); return; }
    setSendet(true);
    try {
      // Ort: eigener Ort mit Radius, sonst Adresse suchen (Radius 150 rein, 300 raus).
      let ortDaten = null;
      const eigener = ort.ortId ? orte.find((o) => o.id === ort.ortId) : null;
      if (eigener) {
        ortDaten = {
          id: eigener.id, name: eigener.name, adresse: eigener.adresse, lat: eigener.lat, lng: eigener.lng,
          radius_rein_m: Math.max(150, eigener.radius_rein_m || 0), radius_raus_m: Math.max(300, eigener.radius_raus_m || 0),
        };
      } else if (vorlage && vorlage.lat != null && vorlage.lng != null && ort.text === (vorlage.adresse || vorlage.ortName)) {
        // Ort vom Assistenten schon gefunden (Server, TomTom D/A/CH).
        ortDaten = { name: vorlage.ortName || ort.text.split(',')[0].trim(), adresse: vorlage.adresse || ort.text, lat: vorlage.lat, lng: vorlage.lng };
      } else {
        const pos = await geocodeAddress(ort.text);
        if (!pos) { setFehler('Adresse nicht gefunden. Bitte genauer eingeben oder einen eigenen Ort wählen.'); return; }
        ortDaten = { name: ort.text.split(',')[0].trim(), adresse: ort.text, lat: pos.lat, lng: pos.lon };
      }
      const { data: profile } = await supabase.from('profiles').select('id, first_name, last_name, driver_number');
      const ids = [];
      for (const n of namen) {
        const id = fahrerIdFinden(n, profile || []);
        if (!id) { setFehler(`Fahrer „${n}“ nicht gefunden.`); return; }
        if (!ids.includes(id)) ids.push(id);
      }
      const r = await standbyAnlegen({ datum, von, bis, ort: ortDaten, notiz: notiz.trim(), fahrerIds: ids });
      if (!r.ok) { setFehler(r.fehler || 'Standby nicht gespeichert.'); return; }
      onGesendet(r.id);
    } finally {
      setSendet(false);
    }
  };

  const fahrerOben = 478;
  const notizOben = fahrerOben + (fahrerNamen.length - 1) * ROW_STEP + ROW_HEIGHT + 24;
  const ctaOben = notizOben + 224 + 24;
  const hoehe = ctaOben + ROW_HEIGHT + (fehler ? 60 : 30);

  return (
    <div className="w-[min(402px,100vw)] h-dvh relative mx-auto overflow-hidden" style={{ background: HINTERGRUND }}>
      <div className="h-full overflow-y-auto overflow-x-hidden overscroll-none pb-[151px]">
        <div className="w-[402px] relative overflow-hidden" style={{ height: `${hoehe}px`, background: HINTERGRUND }}>
          <BackCircleButton onClick={() => (onVorlageZurueck ? onVorlageZurueck() : setView('ankuenfte'))} className="absolute left-[20px] top-[60px]" />
          {!vorlage ? <ArtUmschalter standby onFahrt={() => setView('fahrtAdd')} onStandby={() => {}} /> : null}

          <div className="absolute left-[20px] top-[140px] text-[42px] leading-[42px] font-bold font-['Space_Grotesk']" style={{ color: GREEN }}>
            Standby
          </div>

          <FormRow top={206} label="Datum" value={datum} onChange={setDatum} onReset={() => setDatum('')} mode="date" marker="standby-datum" />
          <FormRow top={274} label="Von" value={von} onChange={setVon} onReset={() => setVon('')} mode="time" marker="standby-von" />
          <FormRow top={342} label="Bis" value={bis} onChange={setBis} onReset={() => setBis('')} mode="time" marker="standby-bis" />
          <FormRow
            top={410}
            label="Ort"
            value={ort.text}
            onChange={ortTippen}
            onFocus={() => setOrtOffen(true)}
            onBlur={() => setTimeout(() => setOrtOffen(false), 150)}
            onReset={() => { setOrt({ text: '', ortId: '' }); setVorschlaege([]); }}
            mode="select"
          />
          {ortOffen && (eigeneTreffer.length > 0 || vorschlaege.length > 0) ? (
            <div className="absolute left-[20px] w-[362px] max-h-[180px] overflow-y-auto rounded-2xl border border-[#4a4f22] bg-[#151607] z-[120]" style={{ top: `${410 + ROW_HEIGHT + 4}px` }}>
              {eigeneTreffer.map((o) => (
                <OrtVorschlag key={`ort-${o.id}`} ort={o} onWaehlen={(g) => { setOrt({ text: g.name, ortId: g.id }); setVorschlaege([]); setOrtOffen(false); }} />
              ))}
              {vorschlaege.map((v, i) => (
                <button
                  key={`v-${i}-${v}`}
                  type="button"
                  onMouseDown={(e) => { e.preventDefault(); setOrt({ text: v, ortId: '' }); setVorschlaege([]); setOrtOffen(false); }}
                  className="w-full px-3 py-3 text-left text-[13px] font-medium border-b last:border-b-0 border-[#2a2d15] font-['Space_Grotesk']"
                  style={{ color: GREEN }}
                >
                  {v}
                </button>
              ))}
            </div>
          ) : null}

          {fahrerNamen.map((n, i) => (
            <FormRow
              key={`fahrer-${i}`}
              top={fahrerOben + i * ROW_STEP}
              label={fahrerNamen.length > 1 ? t('fahrt.fahrerNumbered', { n: i + 1 }) : t('fahrt.fahrer')}
              value={n}
              onChange={(w) => fahrerSetzen(i, w)}
              onReset={() => fahrerSetzen(i, '')}
              mode="fahrer"
            />
          ))}

          {/* Notizen wie in Fahrt hinzufuegen: graue Flaeche, weisses Feld. */}
          <div className="absolute left-0 right-0 bg-[#1a1a1a] rounded-[12px]" style={{ top: `${notizOben}px`, height: '224px' }}>
            <div className="absolute left-[20px] right-[20px] top-[20px] bottom-[20px] bg-white overflow-hidden">
              <div className="p-4 h-full flex flex-col">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-[#1d1c1d] text-[16px] font-bold tracking-[0.5px]" style={{ fontFamily: 'Space Grotesk' }}>{t('fahrt.notizen')}</h3>
                  <img src="/icon/_Icon_Lime/Arrow-kurz_Trisar_Icons_01_Lime.svg" alt="" className="w-[10px] h-[13px]" />
                </div>
                <textarea
                  value={notiz}
                  onChange={(e) => setNotiz(e.target.value)}
                  placeholder={t('fahrt.notesPlaceholder')}
                  className="flex-1 text-[14px] text-[rgba(129,129,129,0.5)] resize-none border-none outline-none bg-transparent tracking-[0.25px]"
                  style={{ fontFamily: 'Space Grotesk' }}
                />
              </div>
            </div>
          </div>

          <button
            type="button"
            disabled={sendet}
            onClick={senden}
            className="absolute left-[20px] w-[362px] h-14 px-6 flex items-center justify-between disabled:opacity-60"
            style={{ top: `${ctaOben}px`, background: GREEN }}
          >
            <span className="text-black text-[16px] font-bold tracking-[-0.5px] font-['Space_Grotesk']">{sendet ? 'Wird gesendet …' : 'Standby senden'}</span>
            <img src="/icon/_Icon_Schwarz/Arrow_Trisar_Icons_01.svg" alt="" className="w-[34px] h-[20px]" />
          </button>
          {fehler ? (
            <div className="absolute left-[20px] w-[362px] text-[13px] font-bold text-[#ff6f63] font-['Space_Grotesk']" style={{ top: `${ctaOben + ROW_HEIGHT + 10}px` }}>{fehler}</div>
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
        activeTab="add"
      />
    </div>
  );
}
