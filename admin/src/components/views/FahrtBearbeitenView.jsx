import { useEffect, useRef, useState } from 'react';
import BackCircleButton from '../ui/BackCircleButton';
import TrisarFooter from '../ui/TrisarFooter';
import FahrerAutocomplete from '../ui/FahrerAutocomplete';
import FahrgastAutocomplete from '../ui/FahrgastAutocomplete';
import { useI18n } from '../../i18n';
import OrtVorschlag from '../ui/OrtVorschlag';
import ZwischenstoppVorschlaege from '../ui/ZwischenstoppVorschlaege';
import { adressWarnung, fahrerFuersSpeichern, gleicheZeilen, useZwischenstopps, zeilenMitFreier } from '../../shared/fahrtZeilen';
import { orteZurEingabe, useOrte } from '../../shared/orte';
import { demoAlert, demoConfirm, tutorialLaeuft } from '../ui/demoDialoge';
import RisikoAbschnitt from './RisikoAbschnitt';
import { fahrerPasst, risikoFahrt, risikoTag, useRisikoDaten } from '../../demo/risikoErgebnisse';
import { DEMO_MODE } from '../../datenquelle';

const GREEN = '#E3F654';
// Erstes Feld 24 px unter dem Titel (140 + 42 + 24 = 206), Reihen alle 68 px.
const ROW_START_TOP = 410;
const ROW_STEP = 68;
const ROW_HEIGHT = 56;

const formatFlightCandidateLabel = (candidate, t) => {
  const dep = String(candidate?.departure_airport || '').trim();
  const arr = String(candidate?.arrival_airport || '').trim();
  const sched = String(candidate?.scheduled_arrival_local || '').trim();
  const dateMatch = sched.match(/^(\d{4})-(\d{2})-(\d{2})/);
  const timeMatch = sched.match(/T(\d{2}:\d{2})/);
  const route = [dep, arr].filter(Boolean).join(' → ');
  const arrivalLabel = [dateMatch ? `${dateMatch[3]}.${dateMatch[2]}.` : '', timeMatch ? timeMatch[1] : '']
    .filter(Boolean)
    .join(' ');
  return [route, arrivalLabel ? t('fahrt.arrivalLabel', { time: arrivalLabel }) : ''].filter(Boolean).join(' · ');
};
const NOTES_GAP = 24;
const CTA_GAP = 24;
const SECONDARY_CTA_GAP = 12;
const FOOTER_GAP = 30;
const FOOTER_HEIGHT = 40;

const inputRowClass =
  'w-[362px] h-14 absolute border-2 inline-flex justify-start items-center gap-1 overflow-hidden';

const normalizeGuestRows = (values = []) => {
  const filled = values
    .map((value) => String(value || '').trim())
    .filter(Boolean);
  return [...filled, ''];
};

const EMPTY_FORM_VALUES = {
  datum: '',
  startZeit: '',
  start: '',
  ziel: '',
  startOrtId: '',
  startAdresse: '',
  zielOrtId: '',
  zielAdresse: '',
  flugnummer: '',
  zugnummer: '',
  konvoi: '',
  anzahlKinder: '',
  anonymeGaeste: '',
  fahrgaeste: '',
  aktuellerStatus: '',
  anzahlFahrzeuge: '',
};

const normalizeFieldValue = (value) => (value == null ? '' : String(value));

function buildInitialFormValues(initialData = {}) {
  return {
    ...EMPTY_FORM_VALUES,
    datum: normalizeFieldValue(initialData.datum || initialData.date || initialData.rideDate),
    startZeit: normalizeFieldValue(initialData.startZeit),
    // Fahrt mit eigenem Ort: im Feld steht der Ortsname, die gespeicherte Adresse bleibt dahinter.
    start: normalizeFieldValue(initialData.startOrtId ? (initialData.startOrtName || initialData.start) : initialData.start),
    ziel: normalizeFieldValue(initialData.zielOrtId ? (initialData.zielOrtName || initialData.ziel) : initialData.ziel),
    startOrtId: normalizeFieldValue(initialData.startOrtId),
    startAdresse: initialData.startOrtId ? normalizeFieldValue(initialData.start) : '',
    zielOrtId: normalizeFieldValue(initialData.zielOrtId),
    zielAdresse: initialData.zielOrtId ? normalizeFieldValue(initialData.ziel) : '',
    flugnummer: normalizeFieldValue(initialData.flugnummer || initialData.flightNumber),
    zugnummer: normalizeFieldValue(initialData.zugnummer || initialData.trainNumber),
    konvoi: normalizeFieldValue(initialData.konvoi),
    anzahlKinder: normalizeFieldValue(initialData.anzahlKinder),
    anonymeGaeste: normalizeFieldValue(initialData.anonymeGaeste),
    fahrgaeste: normalizeFieldValue(initialData.fahrgaeste),
    aktuellerStatus: normalizeFieldValue(initialData.aktuellerStatus),
    anzahlFahrzeuge: normalizeFieldValue(initialData.anzahlFahrzeuge),
  };
}

function buildInitialDriverNames(initialData = {}) {
  if (Array.isArray(initialData.fahrerNamen) && initialData.fahrerNamen.length > 0) {
    return initialData.fahrerNamen.map((name) => normalizeFieldValue(name));
  }
  if (initialData.fahrer != null && String(initialData.fahrer).trim().length > 0) {
    return [normalizeFieldValue(initialData.fahrer)];
  }
  return [''];
}

function buildInitialGuestNames(initialData = {}) {
  const fahrgaesteStr = normalizeFieldValue(initialData.fahrgaeste);
  const names = fahrgaesteStr
    .split(/[\n,;]+/g)
    .map((name) => name.trim())
    .filter(Boolean);
  return names.length > 0 ? [...names, ''] : [''];
}

// Ist der Flug-/Zugdienst nicht erreichbar (Demo), zeigt die Zeile die
// gespeicherte Zeit der Fahrt — aber nur, solange die Nummer unveraendert ist.
const gespeicherteZeitFuer = (nummer, gespeicherteNummer, startZeit) => {
  const kompakt = (wert) => String(wert || '').replace(/\s+/g, '').toUpperCase().trim();
  if (!kompakt(nummer) || kompakt(nummer) !== kompakt(gespeicherteNummer)) return '';
  const treffer = String(startZeit || '').match(/^(\d{1,2}):(\d{2})/);
  return treffer ? `${treffer[1].padStart(2, '0')}:${treffer[2]}` : '';
};

function FormRow({
  top,
  label,
  value,
  onChange,
  onReset,
  onFocus,
  onBlur,
  mode = 'text',
  options = [],
  optionLabels = null,
  emptyValues = [],
  etaIndicator = null,
  rightAction = null,
  marker,
}) {
  const { t, locale } = useI18n();
  const normalizedValue = String(value || '').trim().toLowerCase();
  const isFilled =
    normalizedValue.length > 0 &&
    !emptyValues.some((emptyValue) => String(emptyValue).trim().toLowerCase() === normalizedValue);

  return (
    <div
      className={inputRowClass}
      style={{ left: '20px', top: `${top}px`, borderColor: GREEN }}
      // Ganze Zeile samt Beschriftung — fuer die Hervorhebung im Tutorial.
      data-tutorial={marker ? `zeile-${marker}` : undefined}
    >
      <div className="relative flex-1 self-stretch p-1 flex justify-start items-center">
        <div className={`flex-1 self-stretch px-3 ${etaIndicator?.text ? 'pr-16' : 'pr-10'} flex justify-start items-center gap-4 min-w-0`}>
          <div
            className="shrink-0 opacity-50 text-[16px] font-medium leading-6 tracking-[0.5px]"
            style={{ color: GREEN, fontFamily: 'Space Grotesk' }}
          >
            {label}
          </div>
          {mode === 'select' ? (
            <input
              data-tutorial={marker}
              value={value}
              onChange={(e) => onChange(e.target.value)}
              onFocus={onFocus}
              onBlur={onBlur}
              placeholder=""
              className="w-full min-w-0 bg-transparent border-none outline-none text-[16px] font-medium leading-6 tracking-[0.5px]"
              style={{ color: GREEN, fontFamily: 'Space Grotesk' }}
            />
          ) : mode === 'time' ? (
            <input
              data-tutorial={marker}
              type="time"
              value={value}
              onChange={(e) => onChange(e.target.value)}
              step="60"
              className="w-full min-w-0 bg-transparent border-none outline-none text-[16px] font-medium leading-6 tracking-[0.5px]"
              style={{ color: GREEN, fontFamily: 'Space Grotesk' }}
              lang={locale}
            />
          ) : mode === 'date' ? (
            <input
              data-tutorial={marker}
              type="date"
              value={value}
              onChange={(e) => onChange(e.target.value)}
              className="w-full min-w-0 bg-transparent border-none outline-none text-[16px] font-medium leading-6 tracking-[0.5px]"
              style={{ color: GREEN, fontFamily: 'Space Grotesk' }}
              lang={locale}
            />
          ) : mode === 'number' ? (
            <input
              data-tutorial={marker}
              type="number"
              value={value}
              onChange={(e) => onChange(e.target.value)}
              min="0"
              step="1"
              inputMode="numeric"
              className="w-full min-w-0 bg-transparent border-none outline-none text-[16px] font-medium leading-6 tracking-[0.5px]"
              style={{ color: GREEN, fontFamily: 'Space Grotesk' }}
            />
          ) : mode === 'dropdown' ? (
            <select
              data-tutorial={marker}
              value={value}
              onChange={(e) => onChange(e.target.value)}
              className="w-full min-w-0 bg-transparent border-none outline-none appearance-none text-[16px] font-medium leading-6 tracking-[0.5px]"
              style={{ color: GREEN, fontFamily: 'Space Grotesk' }}
            >
              <option value=""></option>
              {options.map((option) => (
                <option key={option} value={option}>
                  {optionLabels?.[option] ?? option}
                </option>
              ))}
            </select>
          ) : mode === 'fahrer' ? (
            <FahrerAutocomplete
              data-tutorial={marker}
              value={value}
              onChange={onChange}
              placeholder=""
              className="w-full min-w-0 bg-transparent border-none outline-none text-[16px] font-medium leading-6 tracking-[0.5px]"
              style={{ color: GREEN, fontFamily: 'Space Grotesk' }}
            />
          ) : mode === 'fahrgast' ? (
            <FahrgastAutocomplete
              data-tutorial={marker}
              value={value}
              onChange={onChange}
              placeholder=""
              className="w-full min-w-0 bg-transparent border-none outline-none text-[16px] font-medium leading-6 tracking-[0.5px]"
              style={{ color: GREEN, fontFamily: 'Space Grotesk' }}
            />
          ) : (
            <input
              data-tutorial={marker}
              value={value}
              onChange={(e) => onChange(e.target.value)}
              placeholder=""
              className="w-full min-w-0 bg-transparent border-none outline-none text-[16px] font-medium leading-6 tracking-[0.5px]"
              style={{ color: GREEN, fontFamily: 'Space Grotesk' }}
            />
          )}
        </div>
        <div className="absolute right-[12px] top-1/2 -translate-y-1/2 flex items-center gap-2">
          {etaIndicator?.text ? (
            etaIndicator.onClick ? (
              <button
                type="button"
                onClick={etaIndicator.onClick}
                className={`text-[12px] font-bold font-['Space_Grotesk'] underline underline-offset-2 ${etaIndicator.colorClass || 'text-[#808080]'}`}
                aria-label={t('fahrt.etaOpenSelection', { eta: etaIndicator.text })}
              >
                {etaIndicator.text}
              </button>
            ) : (
              <div
                className={`text-[12px] font-bold font-['Space_Grotesk'] ${etaIndicator.colorClass || 'text-[#808080]'}`}
                aria-label={t('fahrt.etaValue', { eta: etaIndicator.text })}
              >
                {etaIndicator.text}
              </div>
            )
          ) : null}
          {rightAction ? (
            <button
              type="button"
              onClick={rightAction.onClick}
              className={`flex items-center w-5 h-5 ${rightAction.type === 'check' || rightAction.type === 'x' ? 'justify-center' : 'justify-end'}`}
              aria-label={rightAction.ariaLabel || label}
            >
              {rightAction.type === 'check' ? (
                <span className="text-[#59BE80] text-[16px] leading-none font-bold">✓</span>
              ) : rightAction.type === 'x' ? (
                <span className="text-[#f55757] text-[16px] leading-none font-bold">✕</span>
              ) : (
                <img src="/icon/_Icon_Lime/Arrow-kurz_Trisar_Icons_01_Lime.svg" alt="" className="w-[10px] h-[13px]" />
              )}
            </button>
          ) : isFilled ? (
            <button
              type="button"
              onClick={onReset || (() => onChange(''))}
              className="flex items-center justify-center"
              aria-label={t('fahrt.resetField', { label })}
            >
              <img src="/icon/_Icon_Green/clear-field-green.svg" alt="" className="w-5 h-5" />
            </button>
          ) : (
            <div className="pointer-events-none">
              {mode === 'select' || mode === 'dropdown' ? (
                <img src="/icon/_Icon_Lime/Arrow-kurz_Trisar_Icons_01_Lime.svg" alt="" className="w-[10px] h-[13px]" />
              ) : (
                <img src="/icon/_Icon_Lime/Arrow-kurz_Trisar_Icons_01_Lime.svg" alt="" className="w-[10px] h-[13px]" />
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function FahrtBearbeitenView({
  setView,
  initialData = null,
  title = null,
  submitLabel = null,
  onSave = async () => ({ ok: true }),
  onDelete = async () => false,
  onFetchPlaceSuggestions = async () => [],
  onValidateFlight = async () => ({ status: 'empty', etaLabel: '', valid: false, startLocation: '' }),
  onValidateTrain = async () => ({ status: 'empty', etaLabel: '', valid: false, startLocation: '' }),
}) {
  const { t } = useI18n();
  const { orte } = useOrte();
  const resolvedTitle = title ?? t('fahrt.editTitle');
  const resolvedSubmitLabel = submitLabel ?? t('fahrt.submitEdit');
  const [notes, setNotes] = useState(() => normalizeFieldValue(initialData?.notes));
  const [fahrerNamen, setFahrerNamen] = useState(() => buildInitialDriverNames(initialData || {}));
  const [fahrgaesteNamen, setFahrgaesteNamen] = useState(() => buildInitialGuestNames(initialData || {}));
  const [formValues, setFormValues] = useState(() => buildInitialFormValues(initialData || {}));
  // Risiko je Fahrt (nur an den Tagen, die die Engine gerechnet hat)
  const risikoDaten = useRisikoDaten();
  const [risikoHoehe, setRisikoHoehe] = useState(0);
  const risikoDatum = (() => {
    const roh = normalizeFieldValue(initialData?.datum || initialData?.date).slice(0, 10);
    const de = roh.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
    return de ? `${de[3]}-${de[2]}-${de[1]}` : roh;
  })();
  // Nur in der Demo: die Risikodaten sind vorab gerechnet, nicht aus dem Betrieb.
  const risikoDieserFahrt = DEMO_MODE && /^\d{4}-\d{2}-\d{2}$/.test(risikoDatum)
    ? risikoFahrt(risikoDaten, risikoDatum, initialData?.rideId || initialData?.id)
    : null;
  const fahrtGeplant = fahrerPasst(risikoDieserFahrt, Array.isArray(initialData?.fahrerNamen) ? initialData.fahrerNamen : []);
  const [placePredictions, setPlacePredictions] = useState({ start: [], ziel: [] });
  const stopps = useZwischenstopps({ start: formValues.start, anfang: initialData?.zwischenstopps || [], onFetchPlaceSuggestions, t });
  const [activeAddressField, setActiveAddressField] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const [flightEtaIndicator, setFlightEtaIndicator] = useState({ text: '', colorClass: 'text-[#808080]' });
  const [flightValidationState, setFlightValidationState] = useState({
    status: 'empty',
    etaLabel: '',
    valid: false,
    startLocation: '',
  });
  const [appliedFlightNumber, setAppliedFlightNumber] = useState('');
  const [flightCandidates, setFlightCandidates] = useState([]);
  const [showFlightCandidates, setShowFlightCandidates] = useState(false);
  const [flightAirportOverride, setFlightAirportOverride] = useState('');
  const [flightScheduledOverride, setFlightScheduledOverride] = useState('');
  const [trainEtaIndicator, setTrainEtaIndicator] = useState({ text: '', colorClass: 'text-[#808080]' });
  const [trainValidationState, setTrainValidationState] = useState({
    status: 'empty',
    etaLabel: '',
    valid: false,
    startLocation: '',
  });
  const [appliedTrainNumber, setAppliedTrainNumber] = useState('');

  const gespeicherteFlugnummer = normalizeFieldValue(initialData?.flugnummer || initialData?.flightNumber);
  const gespeicherteZugnummer = normalizeFieldValue(initialData?.zugnummer || initialData?.trainNumber);
  const gespeicherteStartZeit = normalizeFieldValue(initialData?.startZeit);

  useEffect(() => {
    setNotes(normalizeFieldValue(initialData?.notes));
    setFahrerNamen(buildInitialDriverNames(initialData || {}));
    setFahrgaesteNamen(buildInitialGuestNames(initialData || {}));
    setFormValues(buildInitialFormValues(initialData || {}));
    stopps.zuruecksetzen(initialData?.zwischenstopps || []);
    setFlightEtaIndicator({ text: '', colorClass: 'text-[#808080]' });
    setFlightValidationState({ status: 'empty', etaLabel: '', valid: false, startLocation: '' });
    setAppliedFlightNumber('');
    setFlightCandidates([]);
    setShowFlightCandidates(false);
    setFlightAirportOverride('');
    setFlightScheduledOverride('');
    setTrainEtaIndicator({ text: '', colorClass: 'text-[#808080]' });
    setTrainValidationState({ status: 'empty', etaLabel: '', valid: false, startLocation: '' });
    setAppliedTrainNumber('');
  }, [initialData]);

  const updateField = (key, value) => {
    setFormValues((prev) => ({ ...prev, [key]: value }));
  };
  // Flug-/Zugpruefung mit der Adresse, bei eigenem Ort nicht mit seinem Namen.
  const pruefStart = formValues.startAdresse || formValues.start;
  const showVehicleCount = String(formValues.konvoi || '').trim().length > 0;
  const parsedVehicleCount = Number.parseInt(formValues.anzahlFahrzeuge, 10);
  const fahrerPlaetze = showVehicleCount ? Math.max(1, Number.isNaN(parsedVehicleCount) ? 1 : parsedVehicleCount) : 1;
  const filledGuestNames = fahrgaesteNamen.map((name) => String(name || '').trim()).filter(Boolean);
  const _filledGuestCount = filledGuestNames.length;
  const predictionRequestRef = useRef(null);
  const predictionSeqRef = useRef(0);
  const flightValidationSeqRef = useRef(0);
  const trainValidationSeqRef = useRef(0);

  // Fahrer eingetragen: darunter kommt eine freie Zeile fuer den naechsten.
  useEffect(() => {
    setFahrerNamen((prev) => {
      const next = zeilenMitFreier(prev, { mindestens: fahrerPlaetze });
      return gleicheZeilen(next, prev) ? prev : next;
    });
  }, [fahrerNamen, fahrerPlaetze]);

  useEffect(() => {
    setFahrgaesteNamen((prev) => {
      const normalized = normalizeGuestRows(prev);
      const unchanged = normalized.length === prev.length && normalized.every((value, index) => value === prev[index]);
      return unchanged ? prev : normalized;
    });
  }, [fahrgaesteNamen]);

  useEffect(() => () => {
    if (predictionRequestRef.current) clearTimeout(predictionRequestRef.current);
  }, []);

  useEffect(() => {
    setFlightAirportOverride('');
    setFlightScheduledOverride('');
    setShowFlightCandidates(false);
  }, [formValues.flugnummer]);

  useEffect(() => {
    const flightValue = String(formValues.flugnummer || '').trim();
    const normalizedFlightValue = flightValue.replace(/\s+/g, '').toUpperCase();
    if (!flightValue) {
      setFlightEtaIndicator({ text: '', colorClass: 'text-[#808080]' });
      setFlightValidationState({ status: 'empty', etaLabel: '', valid: false, startLocation: '' });
      setAppliedFlightNumber('');
      setFlightCandidates([]);
      setShowFlightCandidates(false);
      return undefined;
    }

    let isCancelled = false;
    const requestId = flightValidationSeqRef.current + 1;
    flightValidationSeqRef.current = requestId;

    const timer = setTimeout(async () => {
      const result = await onValidateFlight(flightValue, formValues.datum, flightAirportOverride || pruefStart, flightScheduledOverride);
      if (isCancelled || requestId !== flightValidationSeqRef.current) return;
      const status = String(result?.status || 'invalid');
      const etaLabel = String(result?.etaLabel || '').trim();
      const startLocation = String(result?.startLocation || '').trim();
      const valid = Boolean(result?.valid) || status === 'ok' || status === 'unknown_eta';
      setFlightValidationState({ status, etaLabel, valid, startLocation });

      if (status === 'multi') {
        setFlightCandidates(Array.isArray(result?.candidates) ? result.candidates : []);
      } else {
        setFlightCandidates([]);
        setShowFlightCandidates(false);
      }

      if (status === 'ok' && etaLabel) {
        setFlightEtaIndicator({ text: etaLabel, colorClass: 'text-[#808080]' });
      } else if (status === 'multi') {
        setFlightEtaIndicator({ text: 'Multi', colorClass: 'text-[#f55757]' });
      } else if (status === 'unavailable' && !etaLabel) {
        setFlightEtaIndicator({
          text: gespeicherteZeitFuer(flightValue, gespeicherteFlugnummer, gespeicherteStartZeit),
          colorClass: 'text-[#808080]',
        });
      } else {
        setFlightEtaIndicator({ text: etaLabel || 'NaN', colorClass: 'text-[#f55757]' });
      }
      if (appliedFlightNumber && normalizedFlightValue !== appliedFlightNumber) {
        setAppliedFlightNumber('');
      }
    }, 350);

    return () => {
      isCancelled = true;
      clearTimeout(timer);
    };
  }, [formValues.flugnummer, formValues.datum, pruefStart, flightAirportOverride, flightScheduledOverride, onValidateFlight, appliedFlightNumber, gespeicherteFlugnummer, gespeicherteStartZeit]);

  useEffect(() => {
    const trainValue = String(formValues.zugnummer || '').trim();
    const normalizedTrainValue = trainValue.replace(/\s+/g, '').toUpperCase();
    if (!trainValue) {
      setTrainEtaIndicator({ text: '', colorClass: 'text-[#808080]' });
      setTrainValidationState({ status: 'empty', etaLabel: '', valid: false, startLocation: '' });
      setAppliedTrainNumber('');
      return undefined;
    }

    let isCancelled = false;
    const requestId = trainValidationSeqRef.current + 1;
    trainValidationSeqRef.current = requestId;

    const timer = setTimeout(async () => {
      const result = await onValidateTrain(trainValue, formValues.datum, pruefStart);
      if (isCancelled || requestId !== trainValidationSeqRef.current) return;
      const status = String(result?.status || 'invalid');
      const etaLabel = String(result?.etaLabel || '').trim();
      const startLocation = String(result?.startLocation || '').trim();
      const valid = Boolean(result?.valid) || status === 'ok' || status === 'unknown_eta';
      setTrainValidationState({ status, etaLabel, valid, startLocation });

      if (status === 'ok' && etaLabel) {
        setTrainEtaIndicator({ text: etaLabel, colorClass: 'text-[#808080]' });
      } else if (status === 'unavailable') {
        setTrainEtaIndicator({
          text: gespeicherteZeitFuer(trainValue, gespeicherteZugnummer, gespeicherteStartZeit),
          colorClass: 'text-[#808080]',
        });
      } else if (status === 'multi') {
        setTrainEtaIndicator({ text: 'Multi', colorClass: 'text-[#f55757]' });
      } else {
        setTrainEtaIndicator({ text: 'NaN', colorClass: 'text-[#f55757]' });
      }
      if (appliedTrainNumber && normalizedTrainValue !== appliedTrainNumber) {
        setAppliedTrainNumber('');
      }
    }, 350);

    return () => {
      isCancelled = true;
      clearTimeout(timer);
    };
  }, [formValues.zugnummer, formValues.datum, pruefStart, onValidateTrain, appliedTrainNumber, gespeicherteZugnummer, gespeicherteStartZeit]);

  // Frei getippt: der gewaehlte eigene Ort gilt nicht mehr.
  const fetchAddressPredictions = (input, field) => {
    setFormValues((prev) => ({ ...prev, [field]: input, [`${field}OrtId`]: '', [`${field}Adresse`]: '' }));
    const trimmedInput = String(input || '').trim();
    if (predictionRequestRef.current) {
      clearTimeout(predictionRequestRef.current);
    }
    if (!trimmedInput) {
      setPlacePredictions((prev) => ({ ...prev, [field]: [] }));
      setActiveAddressField((prev) => (prev === field ? null : prev));
      return;
    }
    setActiveAddressField(field);
    const requestSeq = predictionSeqRef.current + 1;
    predictionSeqRef.current = requestSeq;
    predictionRequestRef.current = setTimeout(async () => {
      const options = await onFetchPlaceSuggestions(trimmedInput);
      if (predictionSeqRef.current !== requestSeq) return;
      setPlacePredictions((prev) => ({ ...prev, [field]: options }));
    }, 250);
  };

  // Eigener Ort gewaehlt: Name ins Feld, Adresse und Ort-ID gehen mit zum Speichern.
  const ortWaehlen = (field, ort) => {
    setFormValues((prev) => ({ ...prev, [field]: ort.name, [`${field}OrtId`]: ort.id, [`${field}Adresse`]: ort.adresse }));
    setPlacePredictions((prev) => ({ ...prev, [field]: [] }));
    setActiveAddressField(null);
  };
  const adresseLeeren = (field) => {
    setFormValues((prev) => ({ ...prev, [field]: '', [`${field}OrtId`]: '', [`${field}Adresse`]: '' }));
    setPlacePredictions((prev) => ({ ...prev, [field]: [] }));
  };
  const ortTreffer = {
    start: formValues.startOrtId ? [] : orteZurEingabe(orte, formValues.start),
    ziel: formValues.zielOrtId ? [] : orteZurEingabe(orte, formValues.ziel),
  };

  const normalizedFlightNumber = String(formValues.flugnummer || '').replace(/\s+/g, '').toUpperCase().trim();
  const isFlightApplied = Boolean(appliedFlightNumber && normalizedFlightNumber === appliedFlightNumber);
  const canApplyFlight = Boolean(
    normalizedFlightNumber &&
    (flightValidationState.valid || flightValidationState.status === 'ok' || flightValidationState.status === 'unknown_eta'),
  );

  const handleFlightAction = () => {
    if (isFlightApplied) {
      setAppliedFlightNumber('');
      updateField('flugnummer', '');
      return;
    }
    if (!canApplyFlight) return;

    const etaLabel = String(flightValidationState.etaLabel || '').trim();
    const startLocation = String(flightValidationState.startLocation || '').trim();
    const resolvedStartZeit = etaLabel && etaLabel !== 'NaN' ? etaLabel : '';
    if (!resolvedStartZeit && !startLocation) {
      demoAlert(t('fahrt.flightMissingEta'));
      return;
    }

    setFormValues((prev) => ({
      ...prev,
      startZeit: resolvedStartZeit || prev.startZeit,
      start: startLocation || prev.start,
      ...(startLocation ? { startOrtId: '', startAdresse: '' } : {}),
    }));
    setAppliedFlightNumber(normalizedFlightNumber);
  };

  const flightRightAction = {
    type: isFlightApplied ? 'x' : canApplyFlight ? 'check' : 'arrow',
    onClick: handleFlightAction,
    ariaLabel: isFlightApplied ? t('fahrt.flightDataReset') : canApplyFlight ? t('fahrt.flightDataApply') : t('fahrt.flightNumberCheck'),
  };

  const normalizedTrainNumber = String(formValues.zugnummer || '').replace(/\s+/g, '').toUpperCase().trim();
  const isTrainApplied = Boolean(appliedTrainNumber && normalizedTrainNumber === appliedTrainNumber);
  const canApplyTrain = Boolean(
    normalizedTrainNumber &&
    (trainValidationState.valid || trainValidationState.status === 'ok' || trainValidationState.status === 'unknown_eta'),
  );

  const handleTrainAction = () => {
    if (isTrainApplied) {
      setAppliedTrainNumber('');
      updateField('zugnummer', '');
      return;
    }
    if (!canApplyTrain) return;

    const etaLabel = String(trainValidationState.etaLabel || '').trim();
    const startLocation = String(trainValidationState.startLocation || '').trim();
    const resolvedStartZeit = etaLabel && etaLabel !== 'NaN' ? etaLabel : '';
    if (!resolvedStartZeit && !startLocation) {
      demoAlert(t('fahrt.trainMissingEta'));
      return;
    }

    setFormValues((prev) => ({
      ...prev,
      startZeit: resolvedStartZeit || prev.startZeit,
      start: startLocation || prev.start,
      ...(startLocation ? { startOrtId: '', startAdresse: '' } : {}),
    }));
    setAppliedTrainNumber(normalizedTrainNumber);
  };

  const trainRightAction = {
    type: isTrainApplied ? 'x' : canApplyTrain ? 'check' : 'arrow',
    onClick: handleTrainAction,
    ariaLabel: isTrainApplied ? t('fahrt.trainDataReset') : canApplyTrain ? t('fahrt.trainDataApply') : t('fahrt.trainNumberCheck'),
  };

  const rows = [
    ...stopps.rows,
    { key: 'ziel', label: t('fahrt.ziel'), mode: 'select', options: placePredictions.ziel, marker: 'feld-ziel' },
    {
      key: 'flugnummer',
      label: t('fahrt.flugnummer'),
      mode: 'text',
      marker: 'feld-flug',
      etaIndicator: normalizedFlightNumber
        ? {
          ...flightEtaIndicator,
          onClick: flightEtaIndicator.text === 'Multi' && flightCandidates.length > 0
            ? () => setShowFlightCandidates((prev) => !prev)
            : undefined,
        }
        : null,
      rightAction: flightRightAction,
    },
    {
      key: 'zugnummer',
      label: t('fahrt.zugnummer'),
      mode: 'text',
      marker: 'feld-zug',
      etaIndicator: normalizedTrainNumber ? trainEtaIndicator : null,
      rightAction: trainRightAction,
    },
    { key: 'konvoi', label: t('fahrt.konvoi'), mode: 'text', marker: 'feld-konvoi' },
    ...(showVehicleCount ? [{ key: 'anzahlFahrzeuge', label: t('fahrt.anzahlFahrzeuge'), mode: 'number', options: ['1', '2', '3', '4'], marker: 'feld-fahrzeuge' }] : []),
    ...fahrerNamen.map((_, index) => ({
      key: `fahrer-${index}`,
      label: showVehicleCount || fahrerNamen.length > 1 ? t('fahrt.fahrerNumbered', { n: index + 1 }) : t('fahrt.fahrer'),
      mode: 'fahrer',
      marker: index === 0 ? 'feld-fahrer' : `feld-fahrer-${index + 1}`,
      value: fahrerNamen[index] || '',
      onChange: (value) =>
        setFahrerNamen((prev) => {
          const next = [...prev];
          next[index] = value;
          return next;
        }),
      onReset: () =>
        setFahrerNamen((prev) => {
          const next = [...prev];
          next[index] = '';
          return next;
        }),
    })),
    ...fahrgaesteNamen.map((name, index) => ({
      key: `fahrgast-${index}`,
      label: index === 0 ? (String(fahrgaesteNamen[0] || '').trim().length > 0 ? t('fahrt.gastNumbered', { n: 1 }) : t('fahrt.fahrgaeste')) : t('fahrt.gastNumbered', { n: index + 1 }),
      mode: 'fahrgast',
      marker: index === 0 ? 'feld-gaeste' : `feld-gaeste-${index + 1}`,
      value: name,
      onChange: (value) =>
        setFahrgaesteNamen((prev) => {
          const next = [...prev];
          next[index] = value;
          return next;
        }),
      onReset: () =>
        setFahrgaesteNamen((prev) => {
          const next = [...prev];
          next[index] = '';
          return next;
        }),
    })),
    { key: 'anonymeGaeste', label: t('fahrt.anonymeGaeste'), mode: 'number', options: ['0', '1', '2', '3', '4', '5', '6', '7', '8'], marker: 'feld-anonyme-gaeste' },
    { key: 'anzahlKinder', label: t('fahrt.anzahlKinder'), mode: 'number', options: ['0', '1', '2', '3', '4', '5'], marker: 'feld-kinder' },
    {
      key: 'aktuellerStatus',
      label: t('fahrt.aktuellerStatus'),
      mode: 'dropdown',
      marker: 'feld-status',
      options: ['offen', 'beendet', 'stoniert', 'unterwegs'],
      optionLabels: {
        offen: t('fahrt.statusOffen'),
        beendet: t('fahrt.statusBeendet'),
        stoniert: t('fahrt.statusStoniert'),
        unterwegs: t('fahrt.statusUnterwegs'),
      },
    },
  ];

  const lastRowTop = ROW_START_TOP + (rows.length - 1) * ROW_STEP;
  const startRowTop = 342;
  const zielRowTop = ROW_START_TOP + stopps.rows.length * ROW_STEP;
  const risikoTop = lastRowTop + ROW_HEIGHT + NOTES_GAP;
  const notesTop = risikoTop + (risikoDieserFahrt && risikoHoehe ? risikoHoehe + NOTES_GAP : 0);
  const ctaTop = notesTop + 224 + CTA_GAP;
  const cancelTop = ctaTop + ROW_HEIGHT + SECONDARY_CTA_GAP;
  const footerTop = cancelTop + ROW_HEIGHT + FOOTER_GAP;
  const contentHeight = footerTop + FOOTER_HEIGHT;

  const handleBack = () => {
    if (window.history.length > 1) {
      window.history.back();
      return;
    }
    setView('list');
  };

  const handleSave = async () => {
    if (isSaving) return;
    const hasKonvoi = String(formValues.konvoi || '').trim().length > 0;
    const requestedVehicleCount = Number.parseInt(String(formValues.anzahlFahrzeuge || '').trim(), 10);
    const driverSlotsToSave = hasKonvoi
      ? Math.max(1, Number.isNaN(requestedVehicleCount) ? 1 : requestedVehicleCount)
      : 1;
    const fahrerNamenForSave = fahrerFuersSpeichern(fahrerNamen, driverSlotsToSave);

    const zwischenstopps = stopps.gefuellt;
    setIsSaving(true);
    const warnung = await adressWarnung([formValues.startAdresse || formValues.start, ...zwischenstopps, formValues.zielAdresse || formValues.ziel], t);
    setIsSaving(false);
    if (warnung && !demoConfirm(warnung)) return;

    const payload = {
      ...initialData,
      ...formValues,
      konvoi: hasKonvoi ? String(formValues.konvoi || '').trim() : '',
      anzahlFahrzeuge: hasKonvoi ? String(formValues.anzahlFahrzeuge || '').trim() : '',
      fahrgaeste: filledGuestNames.join('; '),
      anonymeGaeste: String(formValues.anonymeGaeste || '0'),
      fahrerNamen: fahrerNamenForSave,
      zwischenstopps,
      flugZielFlughafen: flightAirportOverride,
      flugAnkunftGeplant: flightScheduledOverride,
      notes,
    };
    setIsSaving(true);
    try {
      const result = await onSave(payload);
      if (!result?.ok) {
        demoAlert(t('fahrt.saveError', { error: result?.error || t('fahrt.unknownError') }));
        return;
      }
    } finally {
      setIsSaving(false);
    }
    if (window.history.length > 1) {
      window.history.back();
      return;
    }
    setView(initialData?.sourceView || 'ankuenfte');
  };

  const handleCancelRide = async () => {
    const rideId = initialData?.rideId;
    if (!rideId) return;
    const confirmed = demoConfirm(t('fahrt.confirmCancelRide'));
    if (!confirmed) return;
    const deleted = await onDelete(rideId);
    if (!deleted) return;
    if (window.history.length > 1) {
      window.history.back();
      return;
    }
    setView(initialData?.sourceView || 'ankuenfte');
  };

  return (
    <div
      className="w-[min(402px,100vw)] h-dvh relative mx-auto overflow-hidden"
      style={{ background: 'radial-gradient(ellipse 141.42% 102.21% at 0% 0%, #0048cf 0%, #00369b 11.415%, #002468 22.83%, #001b4e 28.537%, #001234 34.244%, #00091a 39.952%, #00050d 42.805%, #000000 45.659%, #000000 83.626%, #000000 100%)' }}
    >
      <div className="h-full overflow-y-auto overflow-x-hidden overscroll-none">
        <div
          className="w-[402px] relative overflow-hidden"
          style={{
            height: `${contentHeight}px`,
            background: 'radial-gradient(ellipse 141.42% 102.21% at 0% 0%, #0048cf 0%, #00369b 11.415%, #002468 22.83%, #001b4e 28.537%, #001234 34.244%, #00091a 39.952%, #00050d 42.805%, #000000 45.659%, #000000 83.626%, #000000 100%)',
          }}
        >
          <BackCircleButton onClick={handleBack} className="absolute left-[20px] top-[60px]" marker="bearbeiten-zurueck" />

          <div className="w-100 h-14 left-[20px] top-[140px] absolute">
              <div data-tutorial="fahrt-bearbeiten" className="left-0 top-0 absolute text-[42px] leading-[42px] font-bold font-['Space_Grotesk']" style={{ color: GREEN }}>
              {resolvedTitle}
              </div>
          </div>

          <FormRow
            top={206}
            label={t('fahrt.datum')}
            value={formValues.datum}
            onChange={(value) => updateField('datum', value)}
            onReset={() => updateField('datum', '')}
            mode="date"
            marker="feld-datum"
          />

          <FormRow
            top={274}
            label={t('fahrt.startZeit')}
            value={formValues.startZeit}
            onChange={(value) => updateField('startZeit', value)}
            onReset={() => updateField('startZeit', '')}
            mode="time"
            marker="feld-zeit"
          />

          <FormRow
            top={342}
            label={t('fahrt.start')}
            fieldKey="start"
            value={formValues.start}
            onChange={(value) => fetchAddressPredictions(value, 'start')}
            onFocus={() => setActiveAddressField('start')}
            onBlur={() => setTimeout(() => {
              // Im Tutorial verlaesst der Finger das Feld vor dem Antippen des Vorschlags.
              if (tutorialLaeuft()) return;
              setActiveAddressField((prev) => (prev === 'start' ? null : prev));
            }, 120)}
            onReset={() => adresseLeeren('start')}
            mode="select"
            options={placePredictions.start}
            marker="feld-start"
          />

          {activeAddressField === 'start' && (placePredictions.start.length > 0 || ortTreffer.start.length > 0) && (
            <div
              className="absolute left-[20px] w-[362px] max-h-[180px] overflow-y-auto rounded-2xl border border-[#4a4f22] bg-[#151607] z-[120]"
              style={{ top: `${startRowTop + ROW_HEIGHT + 4}px` }}
            >
              {ortTreffer.start.map((ort, index) => (
                <OrtVorschlag key={`start-ort-${ort.id}`} ort={ort} marker={`vorschlag-eigener-ort-${index}`} onWaehlen={(gewaehlt) => ortWaehlen('start', gewaehlt)} />
              ))}
              {placePredictions.start.map((option, index) => (
                <button
                  key={`start-option-${index}-${option}`}
                  type="button"
                  data-tutorial={`vorschlag-ort-${index}`}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    setFormValues((prev) => ({ ...prev, start: option, startOrtId: '', startAdresse: '' }));
                    setPlacePredictions((prev) => ({ ...prev, start: [] }));
                    setActiveAddressField(null);
                  }}
                  onClick={() => {
                    setFormValues((prev) => ({ ...prev, start: option, startOrtId: '', startAdresse: '' }));
                    setPlacePredictions((prev) => ({ ...prev, start: [] }));
                    setActiveAddressField(null);
                  }}
                  className="w-full px-3 py-3 text-left text-[13px] font-medium border-b last:border-b-0 border-[#2a2d15]"
                  style={{ color: GREEN, fontFamily: 'Space Grotesk' }}
                >
                  {option}
                </button>
              ))}
            </div>
          )}

          {rows.map((row, index) => {
            return (
              <FormRow
                key={row.key}
                fieldKey={row.key}
                top={ROW_START_TOP + index * ROW_STEP}
                label={row.label}
                value={row.value ?? formValues[row.key]}
                onChange={(value) => {
                  if (row.onChange) {
                    row.onChange(value);
                    return;
                  }
                  if (row.key === 'ziel') {
                    fetchAddressPredictions(value, 'ziel');
                    return;
                  }
                  if (row.key !== 'konvoi') {
                    if (row.key === 'flugnummer') {
                      setAppliedFlightNumber('');
                    }
                    if (row.key === 'zugnummer') {
                      setAppliedTrainNumber('');
                    }
                    updateField(row.key, value);
                    return;
                  }

                  const trimmed = String(value || '').trim();
                  if (trimmed.length === 0) {
                    setFormValues((prev) => ({ ...prev, konvoi: '', anzahlFahrzeuge: '' }));
                    return;
                  }

                  updateField('konvoi', value);
                }}
                onReset={() => {
                  if (row.onReset) {
                    row.onReset();
                    return;
                  }
                  if (row.key === 'anzahlKinder') {
                    updateField(row.key, '');
                    return;
                  }
                  if (row.key === 'anonymeGaeste') {
                    updateField(row.key, '');
                    return;
                  }
                  if (row.key === 'ziel') {
                    adresseLeeren('ziel');
                    return;
                  }
                  if (row.key === 'konvoi') {
                    setFormValues((prev) => ({ ...prev, konvoi: '', anzahlFahrzeuge: '' }));
                    return;
                  }
                  if (row.key === 'flugnummer') {
                    setAppliedFlightNumber('');
                  }
                  if (row.key === 'zugnummer') {
                    setAppliedTrainNumber('');
                  }
                  updateField(row.key, '');
                }}
                onFocus={row.onFocus || (row.key === 'ziel' ? () => setActiveAddressField('ziel') : undefined)}
                onBlur={row.onBlur || (row.key === 'ziel' ? () => setTimeout(() => {
                  if (tutorialLaeuft()) return;
                  setActiveAddressField((prev) => (prev === 'ziel' ? null : prev));
                }, 120) : undefined)}
                mode={row.mode}
                options={row.options}
                optionLabels={row.optionLabels}
                etaIndicator={row.etaIndicator}
                rightAction={row.rightAction}
                marker={row.marker}
              />
            );
          })}

          {showFlightCandidates && flightCandidates.length > 0 && (
            <div
              className="absolute left-[20px] w-[362px] max-h-[220px] overflow-y-auto rounded-2xl border border-[#4a4f22] bg-[#151607] z-[130]"
              style={{ top: `${ROW_START_TOP + rows.findIndex((r) => r.key === 'flugnummer') * ROW_STEP + ROW_HEIGHT + 4}px` }}
            >
              <div
                className="px-3 pt-3 pb-1 text-[11px] font-bold uppercase tracking-wide opacity-60"
                style={{ color: GREEN, fontFamily: 'Space Grotesk' }}
              >
                {(() => {
                  const raw = String(formValues.datum || '').trim();
                  const deMatch = raw.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
                  const iso = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : deMatch ? `${deMatch[3]}-${deMatch[2]}-${deMatch[1]}` : '';
                  const hasMatch = Boolean(iso) && flightCandidates.some((c) => String(c?.scheduled_arrival_local || '').startsWith(iso));
                  return hasMatch
                    ? t('fahrt.multipleFlightsFound')
                    : t('fahrt.noFlightDataForDate', { date: raw || t('fahrt.datum') });
                })()}
              </div>
              {flightCandidates.map((candidate, index) => (
                <button
                  key={`flight-candidate-${index}-${candidate?.arrival_airport || ''}`}
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    const arrival = String(candidate?.arrival_airport || '').trim().toUpperCase();
                    const scheduled = String(candidate?.scheduled_arrival_local || '').trim();
                    if (arrival) setFlightAirportOverride(arrival);
                    if (scheduled) setFlightScheduledOverride(scheduled);
                    setFlightEtaIndicator({ text: '…', colorClass: 'text-[#808080]' });
                    setShowFlightCandidates(false);
                  }}
                  className="w-full px-3 py-3 text-left text-[13px] font-medium border-b last:border-b-0 border-[#2a2d15]"
                  style={{ color: GREEN, fontFamily: 'Space Grotesk' }}
                >
                  {formatFlightCandidateLabel(candidate, t) || t('fahrt.flightNumbered', { n: index + 1 })}
                </button>
              ))}
            </div>
          )}

          <ZwischenstoppVorschlaege panel={stopps.panel} top={ROW_START_TOP + (stopps.panel?.index ?? 0) * ROW_STEP + ROW_HEIGHT + 4} />

          {activeAddressField === 'ziel' && (placePredictions.ziel.length > 0 || ortTreffer.ziel.length > 0) && (
            <div
              className="absolute left-[20px] w-[362px] max-h-[180px] overflow-y-auto rounded-2xl border border-[#4a4f22] bg-[#151607] z-[120]"
              style={{ top: `${zielRowTop + ROW_HEIGHT + 4}px` }}
            >
              {ortTreffer.ziel.map((ort, index) => (
                <OrtVorschlag key={`ziel-ort-${ort.id}`} ort={ort} marker={`vorschlag-eigener-ort-${index}`} onWaehlen={(gewaehlt) => ortWaehlen('ziel', gewaehlt)} />
              ))}
              {placePredictions.ziel.map((option, index) => (
                <button
                  key={`ziel-option-${index}-${option}`}
                  type="button"
                  data-tutorial={`vorschlag-ort-${index}`}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    setFormValues((prev) => ({ ...prev, ziel: option, zielOrtId: '', zielAdresse: '' }));
                    setPlacePredictions((prev) => ({ ...prev, ziel: [] }));
                    setActiveAddressField(null);
                  }}
                  onClick={() => {
                    setFormValues((prev) => ({ ...prev, ziel: option, zielOrtId: '', zielAdresse: '' }));
                    setPlacePredictions((prev) => ({ ...prev, ziel: [] }));
                    setActiveAddressField(null);
                  }}
                  className="w-full px-3 py-3 text-left text-[13px] font-medium border-b last:border-b-0 border-[#2a2d15]"
                  style={{ color: GREEN, fontFamily: 'Space Grotesk' }}
                >
                  {option}
                </button>
              ))}
            </div>
          )}

          {risikoDieserFahrt ? (
            <RisikoAbschnitt
              fahrt={risikoDieserFahrt}
              geplant={fahrtGeplant}
              verlaeufe={risikoTag(risikoDaten, risikoDatum)?.verlaeufe}
              onHoehe={setRisikoHoehe}
              style={{ top: `${risikoTop}px` }}
            />
          ) : null}

          {/* Notes Section */}
          <div
            className="absolute left-0 right-0 bg-[#1a1a1a] rounded-[12px]"
            style={{ top: `${notesTop}px`, height: '224px' }}
          >
            <div
              className="absolute left-[20px] right-[20px] top-[20px] bottom-[20px] bg-white overflow-hidden"
            >
              <div className="p-4 h-full flex flex-col">
                <div className="flex items-center justify-between mb-2">
                  <h3
                    className="text-[#1d1c1d] text-[16px] font-bold tracking-[0.5px]"
                    style={{ fontFamily: 'Space Grotesk' }}
                  >
                    {t('fahrt.notizen')}
                  </h3>
                  <img src="/icon/_Icon_Lime/Arrow-kurz_Trisar_Icons_01_Lime.svg" alt="" className="w-[10px] h-[13px]" />
                </div>

                <textarea
                  data-tutorial="feld-notiz"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder={t('fahrt.notesPlaceholder')}
                  className="flex-1 text-[14px] text-[rgba(129,129,129,0.5)] resize-none border-none outline-none bg-transparent tracking-[0.25px]"
                  style={{ fontFamily: 'Space Grotesk' }}
                />
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={handleSave}
            data-tutorial="bearbeiten-speichern"
            disabled={isSaving}
            data-show-1st-trailing-icon="true"
            data-show-2nd-trailing-icon="false"
            data-show-avatar="False"
            data-show-leading-icon="false"
            data-state="Enabled"
            className="w-[362px] h-14 left-[20px] absolute inline-flex justify-start items-center gap-1 overflow-hidden bg-[#E3F654] border-2 border-[#E3F654] disabled:opacity-70"
            style={{ top: `${ctaTop}px` }}
          >
            <div className="flex-1 self-stretch p-1 flex justify-start items-center">
              <div className="flex-1 self-stretch px-3 flex justify-start items-center gap-2.5">
                <div className="justify-center text-neutral-800 text-base font-medium font-['Space_Grotesk'] leading-6 tracking-wide">{isSaving ? t('fahrt.saving') : resolvedSubmitLabel}</div>
              </div>
            </div>
            <div className="mr-4 flex items-center justify-center">
              <img src="/icon/_Icon_Schwarz/Arrow_Trisar_Icons_01.svg" alt="" className="w-[34px] h-[20px]" />
            </div>
          </button>

          <button
            type="button"
            onClick={handleCancelRide}
            data-tutorial="bearbeiten-stornieren"
            className="w-[362px] h-14 left-[20px] absolute inline-flex justify-center items-center bg-[#221313] border-2 border-[#f55757] text-[#f55757] text-base font-medium font-['Space_Grotesk'] leading-6 tracking-wide"
            style={{ top: `${cancelTop}px` }}
          >
            {t('fahrt.cancelRide')}
          </button>

        </div>
      </div>

      {/* Footer fest am unteren Rand der Ansicht, nicht im Scrollbereich. */}
      <TrisarFooter className="absolute bottom-0 left-0 right-0 h-10 bg-black z-[60]" />
    </div>
  );
}
