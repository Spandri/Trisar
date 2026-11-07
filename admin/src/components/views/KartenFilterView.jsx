import { useEffect, useMemo, useRef, useState } from 'react';
import BackCircleButton from '../ui/BackCircleButton';
import TrisarFooter from '../ui/TrisarFooter';
import { useI18n } from '../../i18n';
import { supabase } from '../../services/supabase';
import OrtBearbeitenView, { RadiusFeld } from './OrtBearbeitenView';
import { ortIconUrl, radienPruefen, standardSpeichern, useOrte } from '../../shared/orte';

const GREEN = '#E3F654';
const RED = '#ff6b6b';

function OutlineRow({ top, label, rightIcon = null, centered = false, h = 'h-14' }) {
  return (
    <div className={`absolute left-[20px] w-[362px] ${h} border-2 border-[#E3F654] flex items-center px-3`} style={{ top: `${top}px` }}>
      <div className={`flex-1 text-base leading-6 tracking-[0.5px] text-[#E3F654] font-medium font-['Space_Grotesk'] ${centered ? 'text-center' : ''}`}>
        {label}
      </div>
      {rightIcon ? <div className="w-10 h-10 flex items-center justify-center">{rightIcon}</div> : null}
    </div>
  );
}

function ToggleRow({ top, label, active, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="absolute left-[20px] w-[362px] h-14 border-2 border-[#E3F654] flex items-center px-3 transition-colors"
      style={{ top: `${top}px`, backgroundColor: active ? '#E3F654' : 'transparent' }}
    >
      <span className={`flex-1 text-base leading-6 tracking-[0.5px] font-medium font-['Space_Grotesk'] text-center ${active ? 'text-[#1d1c1d]' : 'text-[#E3F654]'}`}>
        {label}
      </span>
    </button>
  );
}

function InputRow({ top, label, rightIcon = null }) {
  return (
    <div
      className="absolute left-[20px] w-[362px] h-14 border-2 border-[#E3F654] flex items-center px-3"
      style={{ top: `${top}px` }}
    >
      <div className="flex-1 text-base leading-6 tracking-[0.5px] text-[#E3F654]/60 font-medium font-['Space_Grotesk']">
        {label}
      </div>
      {rightIcon ? <div className="w-10 h-10 flex items-center justify-center">{rightIcon}</div> : null}
    </div>
  );
}

function SearchInputRow({ top, value, onChange, baseLabel, searchLabel, marker }) {
  const { t } = useI18n();
  const [isFocused, setIsFocused] = useState(false);
  const showBase = isFocused || value.trim().length > 0;
  const hasValue = value.trim().length > 0;
  const inputRef = useRef(null);

  return (
    <div
      data-tutorial={marker}
      className="absolute left-[20px] w-[362px] h-14 border-2 border-[#E3F654]"
      style={{ top: `${top}px` }}
      onClick={() => inputRef.current?.focus()}
    >
      <div className="relative w-full h-full flex items-center px-3">
        <span className="shrink-0 text-base leading-6 tracking-[0.5px] text-[#E3F654]/60 font-medium font-['Space_Grotesk']">
          {showBase ? baseLabel : searchLabel}
        </span>
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          className="flex-1 h-full ml-3 pr-9 py-0 bg-transparent outline-none border-none text-base leading-6 tracking-[0.5px] text-[#E3F654] font-medium font-['Space_Grotesk']"
        />
        <div className="absolute right-[12px] top-1/2 -translate-y-1/2 w-6 h-6 flex items-center justify-center">
          {hasValue ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onChange('');
                inputRef.current?.focus();
              }}
              className="flex items-center justify-center"
              aria-label={t('filter.resetLabel', { label: baseLabel })}
            >
              <img src="/icon/_Icon_Green/clear-field-green.svg" alt="" className="w-5 h-5" />
            </button>
          ) : (
            <div className="pointer-events-none">
              <img src="/icon/_Icon_Schwarz/karten-filter-search.svg" alt="" className="w-6 h-6" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function MinutePickerRow({ top, value, onChange, options, marker }) {
  const { t } = useI18n();
  // Ein Key mit {value}-Platzhalter; fürs zweifarbige Styling wird der
  // übersetzte Text am Platzhalter aufgetrennt (keine Satzteil-Keys).
  const [beforeValue, afterValue = ''] = t('filter.afterWorkIn').split('{value}');
  return (
    <div
      data-tutorial={marker}
      className="absolute left-[20px] w-[362px] h-14 border-2 border-[#E3F654] flex items-center px-3"
      style={{ top: `${top}px` }}
    >
      <div className="relative flex-1 h-full">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full h-full bg-transparent outline-none border-none appearance-none text-transparent"
          aria-label={t('filter.afterWorkAria')}
        >
          <option value="">---</option>
          {options.map((option) => (
            <option key={option} value={option} className="text-black">
              {option}
            </option>
          ))}
        </select>
        <div className="pointer-events-none absolute left-0 top-1/2 -translate-y-1/2 text-left text-base leading-6 tracking-[0.5px] font-medium font-['Space_Grotesk']">
          {value ? (
            <>
              <span className="text-[#E3F654]/60">{beforeValue}</span>
              <span className="text-[#E3F654]">{value}</span>
              {afterValue ? <span className="text-[#E3F654]/60">{afterValue}</span> : null}
            </>
          ) : (
            <span className="text-[#E3F654]/60">{t('filter.afterWorkPlaceholder')}</span>
          )}
        </div>
      </div>
      <div className="w-10 h-10 flex items-center justify-center">
        {value ? (
          <button type="button" onClick={() => onChange('')} className="flex items-center justify-center" aria-label={t('filter.afterWorkReset')}>
            <img src="/icon/_Icon_Green/clear-field-green.svg" alt="" className="w-5 h-5" />
          </button>
        ) : (
          <img src="/icon/_Icon_Green/clock-green.svg" alt="" className="w-5 h-5" />
        )}
      </div>
    </div>
  );
}

function TwoColButton({ left, top, label, active, onClick, marker }) {
  return (
    <button
      type="button"
      data-tutorial={marker}
      onClick={onClick}
      className="absolute w-[175px] h-10 border-2 border-[#E3F654] text-base font-medium font-['Space_Grotesk'] tracking-wide transition-colors"
      style={{ left, top, backgroundColor: active ? '#E3F654' : 'transparent', color: active ? '#1d1c1d' : '#E3F654' }}
    >
      {label}
    </button>
  );
}

// Punkte bei Fahrt fuer alle OBD-Tracker (obd_tracker.stufe). Das Gateway uebernimmt die
// Stufe beim naechsten Verbinden des Trackers und quittiert sie (stufe_status).
const TRACKER_STUFEN = [
  { key: 'sparsam', label: 'filter.levelSparsam', marker: 'karte-filter-stufe-sparsam' },
  { key: 'mittel', label: 'filter.levelMittel', marker: 'karte-filter-stufe-mittel' },
  { key: 'fein', label: 'filter.levelFein', marker: 'karte-filter-stufe-fein' },
];
const STUFE_ZEILE_H = 24;

const uhrzeit = (iso) => {
  const d = iso ? new Date(iso) : null;
  if (!d || Number.isNaN(d.getTime())) return '';
  const heute = new Date().toDateString() === d.toDateString();
  const zeit = d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  return heute ? zeit : `${d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })} ${zeit}`;
};

function useTrackerStufen() {
  const [tracker, setTracker] = useState([]);
  const [fehler, setFehler] = useState('');
  const laden = async () => {
    const { data, error } = await supabase
      .from('obd_tracker')
      .select('imei, nummer, stufe, stufe_status, stufe_quittung_am, stufe_antwort')
      .order('nummer', { ascending: true });
    // Fehlt die Tabelle oder Spalte (Demo, Migration noch nicht da), bleibt der Abschnitt weg.
    if (!error && Array.isArray(data)) setTracker(data.filter((row) => row.stufe));
  };
  useEffect(() => {
    const start = setTimeout(laden, 0);
    const timer = setInterval(laden, 10_000);
    return () => {
      clearTimeout(start);
      clearInterval(timer);
    };
  }, []);
  const setzen = async (stufe) => {
    // Nur Tracker, die die Stufe noch nicht bestaetigt haben, sonst kostet es Daten ohne Nutzen.
    const imeis = tracker
      .filter((row) => row.stufe !== stufe || !['wartet', 'gesendet', 'uebernommen'].includes(row.stufe_status))
      .map((row) => row.imei);
    if (imeis.length === 0) return;
    setFehler('');
    setTracker((prev) => prev.map((row) => (imeis.includes(row.imei) ? { ...row, stufe, stufe_status: 'wartet', stufe_antwort: null } : row)));
    const { error } = await supabase.from('obd_tracker').update({ stufe }).in('imei', imeis);
    if (error) setFehler(error.message || 'error');
    laden();
  };
  return { tracker, setzen, fehler };
}

function TrackerStufeStatus({ top, row }) {
  const { t } = useI18n();
  const stufe = t(`filter.level${row.stufe.charAt(0).toUpperCase()}${row.stufe.slice(1)}`);
  let text = t('filter.levelUnknown');
  let farbe = 'text-[#E3F654]/60';
  if (row.stufe_status === 'wartet') text = t('filter.levelWaiting');
  if (row.stufe_status === 'gesendet') text = t('filter.levelSent');
  if (row.stufe_status === 'uebernommen') {
    text = t('filter.levelApplied', { time: uhrzeit(row.stufe_quittung_am) }).trim();
    farbe = 'text-[#E3F654]';
  }
  if (row.stufe_status === 'fehler') {
    text = t('filter.levelError');
    farbe = 'text-[#ff6b6b]';
  }
  return (
    <div
      className="absolute left-[20px] w-[362px] h-6 flex items-center text-sm leading-6 tracking-[0.5px] font-medium font-['Space_Grotesk']"
      style={{ top: `${top}px` }}
      title={row.stufe_antwort || ''}
    >
      <span className="text-[#E3F654] font-bold">Nr. {row.nummer}</span>
      <span className="text-[#E3F654]/60">&nbsp;· {stufe} ·&nbsp;</span>
      <span className={`truncate ${farbe}`}>{text}</span>
    </div>
  );
}

// Eigener Ort in der Liste: Icon, Name, Radien. Antippen = bearbeiten.
function OrtZeile({ top, ort, onClick }) {
  const { t } = useI18n();
  return (
    <button
      type="button"
      onClick={onClick}
      data-tutorial={`karte-filter-ort-${ort.id}`}
      className="absolute left-[20px] w-[362px] h-14 border-2 border-[#E3F654] flex items-center gap-3 px-3 text-left"
      style={{ top: `${top}px` }}
    >
      <img src={ortIconUrl(ort.icon)} alt="" className="w-[30px] h-[30px] object-contain shrink-0" />
      <span className="flex-1 min-w-0 truncate text-base leading-6 tracking-[0.5px] text-[#E3F654] font-medium font-['Space_Grotesk']">{ort.name}</span>
      <span className="shrink-0 text-sm leading-6 tracking-[0.5px] text-[#E3F654]/60 font-medium font-['Space_Grotesk']">
        {t('orte.radienKurz', { rein: ort.radius_rein_m, raus: ort.radius_raus_m })}
      </span>
    </button>
  );
}

const ORT_ZEILE_STEP = 68;

const DEFAULT_KARTEN_FILTERS = {
  driverSearch: '',
  selectedDriverIds: [],
  afterWorkMinutes: '',
  vehicleLimosine: false,
  vehicleSuv: false,
  vehicleVan: false,
  vehicleCoupe: false,
};

export default function KartenFilterView({ setView, filters = {}, onChangeFilters = () => {}, onFetchPlaceSuggestions = async () => [] }) {
  const { t } = useI18n();
  const { tracker, setzen: setzeStufe, fehler: stufeFehler } = useTrackerStufen();
  const { orte, standard } = useOrte();
  // Bearbeiteter Ort: null = Filter, {} = neuer Ort, sonst der Ort.
  const [bearbeiteterOrt, setBearbeiteterOrt] = useState(null);
  // Eingabe der Standard-Radien. null = noch nichts getippt, dann gilt der Wert aus der DB.
  const [standardEntwurf, setStandardEntwurf] = useState({ rein: null, raus: null });
  const standardRein = standardEntwurf.rein ?? String(standard.radius_rein_m);
  const standardRaus = standardEntwurf.raus ?? String(standard.radius_raus_m);
  const setStandardRein = (wert) => setStandardEntwurf((prev) => ({ ...prev, rein: wert }));
  const setStandardRaus = (wert) => setStandardEntwurf((prev) => ({ ...prev, raus: wert }));
  const [standardHinweis, setStandardHinweis] = useState('');
  const {
    driverSearch = '',
    afterWorkMinutes = '',
    vehicleLimosine = false,
    vehicleSuv = false,
    vehicleVan = false,
    vehicleCoupe = false,
  } = filters;

  const gradientStyle = useMemo(
    () => ({
      background: 'radial-gradient(ellipse 141.42% 102.21% at 0% 0%, #0048cf 0%, #00369b 11.415%, #002468 22.83%, #001b4e 28.537%, #001234 34.244%, #00091a 39.952%, #00050d 42.805%, #000000 45.659%, #000000 83.626%, #000000 100%)',
    }),
    [],
  );

  // Abschnitt "Punkte bei Fahrt" unter Feierabend, Knoepfe darunter rutschen mit.
  const gemeinsameStufe = tracker.length > 0 && tracker.every((row) => row.stufe === tracker[0].stufe) ? tracker[0].stufe : null;
  const stufeTop = 462;
  const stufeZeilenTop = stufeTop + 32 + 40 + 12;
  const stufeEnde = stufeZeilenTop + (tracker.length + (stufeFehler ? 1 : 0)) * STUFE_ZEILE_H + 20;
  // Abschnitt "Orte": Standard-Radien, eigene Orte, Ort hinzufuegen.
  const orteTop = tracker.length > 0 ? stufeEnde : 462;
  const standardLabelTop = orteTop + 32;
  const standardTop = standardLabelTop + 28;
  const standardHinweisTop = standardTop + 56 + 4;
  const orteListeTop = standardTop + 56 + (standardHinweis ? 40 : 12);
  const ortHinzufuegenTop = orteListeTop + orte.length * ORT_ZEILE_STEP;
  const saveTop = ortHinzufuegenTop + 56 + 20;
  const clearTop = saveTop + 68;
  const seitenHoehe = Math.max(834, clearTop + 56 + 120);

  const standardUebernehmen = async () => {
    if (String(standardRein) === String(standard.radius_rein_m) && String(standardRaus) === String(standard.radius_raus_m)) {
      setStandardHinweis('');
      return;
    }
    const pruefung = radienPruefen(standardRein, standardRaus);
    if (pruefung) {
      setStandardHinweis(t(pruefung === 'rein' ? 'orte.fehlerRein' : pruefung === 'raus' ? 'orte.fehlerRaus' : 'orte.fehlerRadien'));
      return;
    }
    const ergebnis = await standardSpeichern(Number(standardRein), Number(standardRaus));
    if (!ergebnis.ok) {
      setStandardHinweis(ergebnis.art === 'radien'
        ? t('orte.fehlerRadien')
        : `${t('filter.levelSaveError')}${ergebnis.meldung ? `: ${ergebnis.meldung}` : ''}`);
      return;
    }
    setStandardHinweis('');
    setStandardEntwurf({ rein: null, raus: null });
  };

  const handleBack = () => {
    if (window.history.length > 1) {
      window.history.back();
      return;
    }
    setView('karten');
  };

  const updateFilter = (key, value) => {
    onChangeFilters((prev) => {
      const base = { ...(prev || DEFAULT_KARTEN_FILTERS), [key]: value };
      if (key === 'driverSearch' && String(value || '').trim() === '') {
        base.selectedDriverIds = [];
      }
      return base;
    });
  };

  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const root = document.getElementById('root');

    const prevHtmlOverflow = html.style.overflow;
    const prevHtmlOverscroll = html.style.overscrollBehavior;
    const prevBodyOverflow = body.style.overflow;
    const prevBodyOverscroll = body.style.overscrollBehavior;
    const prevRootOverflow = root ? root.style.overflow : '';
    const prevRootOverscroll = root ? root.style.overscrollBehavior : '';

    html.style.overflow = 'hidden';
    html.style.overscrollBehavior = 'none';
    body.style.overflow = 'hidden';
    body.style.overscrollBehavior = 'none';
    if (root) {
      root.style.overflow = 'hidden';
      root.style.overscrollBehavior = 'none';
    }

    return () => {
      html.style.overflow = prevHtmlOverflow;
      html.style.overscrollBehavior = prevHtmlOverscroll;
      body.style.overflow = prevBodyOverflow;
      body.style.overscrollBehavior = prevBodyOverscroll;
      if (root) {
        root.style.overflow = prevRootOverflow;
        root.style.overscrollBehavior = prevRootOverscroll;
      }
    };
  }, []);

  if (bearbeiteterOrt) {
    return (
      <OrtBearbeitenView
        key={bearbeiteterOrt.id || 'neu'}
        ort={bearbeiteterOrt.id ? bearbeiteterOrt : null}
        onClose={() => setBearbeiteterOrt(null)}
        onFetchPlaceSuggestions={onFetchPlaceSuggestions}
      />
    );
  }

  return (
    <div className="w-[min(402px,100vw)] h-dvh relative mx-auto overflow-hidden" style={gradientStyle}>
      <div className="h-full overflow-y-auto overscroll-none pb-[70px]" style={{ touchAction: 'pan-y', WebkitOverflowScrolling: 'touch' }}>
        <div className="relative" style={{ height: `${seitenHoehe}px` }}>
          <div className="absolute inset-x-0 top-[20px]">
            <BackCircleButton onClick={handleBack} marker="karte-filter-zurueck" className="absolute left-[20px] top-[40px]" />

            <h1 data-tutorial="karte-filter" className="absolute left-[20px] top-[120px] text-[#E3F654] text-[42px] leading-[42px] font-bold font-['Space_Grotesk']">{t('filter.mapFilterTitle')}</h1>

            <SearchInputRow
              top={186}
              value={driverSearch}
              onChange={(value) => updateFilter('driverSearch', value)}
              marker="karte-filter-suche"
              baseLabel={t('filter.driver')}
              searchLabel={t('filter.driverSearchLabel')}
            />

            <TwoColButton left={20} top={266} marker="karte-filter-limosine" label={t('filter.bodyLimosine')} active={vehicleLimosine} onClick={() => updateFilter('vehicleLimosine', !vehicleLimosine)} />
            <TwoColButton left={207} top={266} marker="karte-filter-suv" label={t('filter.bodySuv')} active={vehicleSuv} onClick={() => updateFilter('vehicleSuv', !vehicleSuv)} />
            <TwoColButton left={20} top={318} marker="karte-filter-van" label={t('filter.bodyVan')} active={vehicleVan} onClick={() => updateFilter('vehicleVan', !vehicleVan)} />
            <TwoColButton left={207} top={318} marker="karte-filter-coupe" label={t('filter.bodyCoupe')} active={vehicleCoupe} onClick={() => updateFilter('vehicleCoupe', !vehicleCoupe)} />

            <MinutePickerRow
              top={382}
              marker="karte-filter-feierabend"
              value={afterWorkMinutes}
              onChange={(value) => updateFilter('afterWorkMinutes', value)}
              options={['15 min', '30 min', '45 min', '60 min', '90 min', '120 min']}
            />

            {tracker.length > 0 ? (
              <>
                <div
                  data-tutorial="karte-filter-stufe"
                  className="absolute left-[20px] w-[362px] h-6 text-base leading-6 tracking-[0.5px] text-[#E3F654]/60 font-medium font-['Space_Grotesk']"
                  style={{ top: `${stufeTop}px` }}
                >
                  {t('filter.trackerLevel')}
                </div>
                {TRACKER_STUFEN.map((stufe, index) => (
                  <button
                    key={stufe.key}
                    type="button"
                    data-tutorial={stufe.marker}
                    onClick={() => setzeStufe(stufe.key)}
                    className="absolute w-[114px] h-10 border-2 border-[#E3F654] text-base font-medium font-['Space_Grotesk'] tracking-wide transition-colors"
                    style={{
                      left: `${20 + index * 124}px`,
                      top: `${stufeTop + 32}px`,
                      backgroundColor: gemeinsameStufe === stufe.key ? '#E3F654' : 'transparent',
                      color: gemeinsameStufe === stufe.key ? '#1d1c1d' : '#E3F654',
                    }}
                  >
                    {t(stufe.label)}
                  </button>
                ))}
                {tracker.map((row, index) => (
                  <TrackerStufeStatus key={row.imei} row={row} top={stufeZeilenTop + index * STUFE_ZEILE_H} />
                ))}
                {stufeFehler ? (
                  <div
                    className="absolute left-[20px] w-[362px] h-6 text-sm leading-6 text-[#ff6b6b] font-medium font-['Space_Grotesk'] truncate"
                    style={{ top: `${stufeZeilenTop + tracker.length * STUFE_ZEILE_H}px` }}
                  >
                    {t('filter.levelSaveError')}: {stufeFehler}
                  </div>
                ) : null}
              </>
            ) : null}

            <div
              data-tutorial="karte-filter-orte"
              className="absolute left-[20px] w-[362px] h-6 text-base leading-6 tracking-[0.5px] text-[#E3F654]/60 font-medium font-['Space_Grotesk']"
              style={{ top: `${orteTop}px` }}
            >
              {t('orte.titel')}
            </div>
            <div
              className="absolute left-[20px] w-[362px] h-6 text-sm leading-6 tracking-[0.5px] text-[#E3F654]/60 font-medium font-['Space_Grotesk'] truncate"
              style={{ top: `${standardLabelTop}px` }}
            >
              {t('orte.standard')}
            </div>
            <RadiusFeld
              left={20}
              top={standardTop}
              label={t('orte.rein')}
              value={standardRein}
              onChange={setStandardRein}
              onCommit={standardUebernehmen}
              marker="karte-filter-standard-rein"
            />
            <RadiusFeld
              left={207}
              top={standardTop}
              label={t('orte.raus')}
              value={standardRaus}
              onChange={setStandardRaus}
              onCommit={standardUebernehmen}
              marker="karte-filter-standard-raus"
            />
            {standardHinweis ? (
              <div
                className="absolute left-[20px] w-[362px] h-6 text-sm leading-6 text-[#ff6b6b] font-medium font-['Space_Grotesk'] truncate"
                style={{ top: `${standardHinweisTop}px` }}
              >
                {standardHinweis}
              </div>
            ) : null}
            {orte.map((ort, index) => (
              <OrtZeile key={ort.id} ort={ort} top={orteListeTop + index * ORT_ZEILE_STEP} onClick={() => setBearbeiteterOrt(ort)} />
            ))}
            <button
              type="button"
              onClick={() => setBearbeiteterOrt({})}
              data-tutorial="karte-filter-ort-hinzufuegen"
              className="absolute left-[20px] w-[362px] h-14 border-2 border-[#E3F654] flex items-center px-3"
              style={{ top: `${ortHinzufuegenTop}px` }}
            >
              <span className="flex-1 text-left text-base leading-6 tracking-[0.5px] text-[#E3F654] font-medium font-['Space_Grotesk']">{t('orte.hinzufuegen')}</span>
              <img src="/icon/_Icon_Lime/Arrow-kurz_Trisar_Icons_01_Lime.svg" alt="" className="w-[10px] h-[13px]" />
            </button>

            <button
              type="button"
              onClick={() => setView('karten')}
              className="absolute left-[20px] w-[362px] h-14 bg-[#E3F654] border-2 border-[#E3F654] flex items-center px-3"
              style={{ top: `${saveTop}px` }}
            >
              <span className="flex-1 text-left text-[#1d1c1d] text-base font-medium font-['Space_Grotesk'] tracking-wide">{t('filter.saveFilter')}</span>
              <img src="/icon/_Icon_Schwarz/Arrow_Trisar_Icons_01.svg" alt="" className="w-[34px] h-[20px]" />
            </button>

            <button
              type="button"
              onClick={() => onChangeFilters({ ...DEFAULT_KARTEN_FILTERS })}
              className="absolute left-[20px] w-[362px] h-14 bg-[#ff6b6b] border-2 border-[#ff6b6b] flex items-center px-3"
              style={{ top: `${clearTop}px` }}
            >
              <span className="flex-1 text-left text-[#1d1c1d] text-base font-medium font-['Space_Grotesk'] tracking-wide">{t('filter.clearFilter')}</span>
              <img src="/icon/_Icon_Schwarz/Arrow_Nav_Trisar_Icons_01.svg" alt="" className="w-[34px] h-[20px]" />
            </button>
          </div>
        </div>
      </div>

      <TrisarFooter className="absolute bottom-0 left-0 right-0 h-10 bg-black" />
    </div>
  );
}
