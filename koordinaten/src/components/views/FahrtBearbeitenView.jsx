import { useEffect, useRef, useState } from 'react';
import BackCircleButton from '../ui/BackCircleButton';
import TrisarFooter from '../ui/TrisarFooter';
import FahrerAutocomplete from '../ui/FahrerAutocomplete';
import FahrgastAutocomplete from '../ui/FahrgastAutocomplete';

const GREEN = '#E3F654';
const ROW_START_TOP = 398;
const ROW_STEP = 68;
const ROW_HEIGHT = 56;
const NOTES_GAP = 30;
const CTA_GAP = 24;
const SECONDARY_CTA_GAP = 12;
const FOOTER_GAP = 30;
const FOOTER_HEIGHT = 40;

const inputRowClass =
  'w-[362px] h-14 absolute outline outline-2 outline-offset-[-1px] inline-flex justify-start items-center gap-1 overflow-hidden';

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
    start: normalizeFieldValue(initialData.start),
    ziel: normalizeFieldValue(initialData.ziel),
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
  emptyValues = [],
  etaIndicator = null,
  rightAction = null,
}) {
  const normalizedValue = String(value || '').trim().toLowerCase();
  const isFilled =
    normalizedValue.length > 0 &&
    !emptyValues.some((emptyValue) => String(emptyValue).trim().toLowerCase() === normalizedValue);

  return (
    <div className={inputRowClass} style={{ left: '20px', top: `${top}px`, outlineColor: GREEN }}>
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
              type="time"
              value={value}
              onChange={(e) => onChange(e.target.value)}
              step="60"
              className="w-full min-w-0 bg-transparent border-none outline-none text-[16px] font-medium leading-6 tracking-[0.5px]"
              style={{ color: GREEN, fontFamily: 'Space Grotesk' }}
              lang="de-DE"
            />
          ) : mode === 'date' ? (
            <input
              type="date"
              value={value}
              onChange={(e) => onChange(e.target.value)}
              className="w-full min-w-0 bg-transparent border-none outline-none text-[16px] font-medium leading-6 tracking-[0.5px]"
              style={{ color: GREEN, fontFamily: 'Space Grotesk' }}
              lang="de-DE"
            />
          ) : mode === 'number' ? (
            <input
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
              value={value}
              onChange={(e) => onChange(e.target.value)}
              className="w-full min-w-0 bg-transparent border-none outline-none appearance-none text-[16px] font-medium leading-6 tracking-[0.5px]"
              style={{ color: GREEN, fontFamily: 'Space Grotesk' }}
            >
              <option value=""></option>
              {options.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          ) : mode === 'fahrer' ? (
            <FahrerAutocomplete
              value={value}
              onChange={onChange}
              placeholder=""
              className="w-full min-w-0 bg-transparent border-none outline-none text-[16px] font-medium leading-6 tracking-[0.5px]"
              style={{ color: GREEN, fontFamily: 'Space Grotesk' }}
            />
          ) : mode === 'fahrgast' ? (
            <FahrgastAutocomplete
              value={value}
              onChange={onChange}
              placeholder=""
              className="w-full min-w-0 bg-transparent border-none outline-none text-[16px] font-medium leading-6 tracking-[0.5px]"
              style={{ color: GREEN, fontFamily: 'Space Grotesk' }}
            />
          ) : (
            <input
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
            <div
              className={`text-[12px] font-bold font-['Space_Grotesk'] ${etaIndicator.colorClass || 'text-[#808080]'}`}
              aria-label={`ETA ${etaIndicator.text}`}
            >
              {etaIndicator.text}
            </div>
          ) : null}
          {rightAction ? (
            <button
              type="button"
              onClick={rightAction.onClick}
              className="flex items-center justify-center w-5 h-5"
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
              aria-label={`${label} zurücksetzen`}
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
  title = 'Fahrt bearbeiten',
  submitLabel = 'Bearbeitung speichern',
  onSave = async () => ({ ok: true }),
  onDelete = async () => false,
  onFetchPlaceSuggestions = async () => [],
  onValidateFlight = async () => ({ status: 'empty', etaLabel: '', valid: false, startLocation: '' }),
  onValidateTrain = async () => ({ status: 'empty', etaLabel: '', valid: false, startLocation: '' }),
}) {
  const [notes, setNotes] = useState(() => normalizeFieldValue(initialData?.notes));
  const [fahrerNamen, setFahrerNamen] = useState(() => buildInitialDriverNames(initialData || {}));
  const [fahrgaesteNamen, setFahrgaesteNamen] = useState(() => buildInitialGuestNames(initialData || {}));
  const [formValues, setFormValues] = useState(() => buildInitialFormValues(initialData || {}));
  const [placePredictions, setPlacePredictions] = useState({ start: [], ziel: [] });
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
  const [trainEtaIndicator, setTrainEtaIndicator] = useState({ text: '', colorClass: 'text-[#808080]' });
  const [trainValidationState, setTrainValidationState] = useState({
    status: 'empty',
    etaLabel: '',
    valid: false,
    startLocation: '',
  });
  const [appliedTrainNumber, setAppliedTrainNumber] = useState('');

  useEffect(() => {
    setNotes(normalizeFieldValue(initialData?.notes));
    setFahrerNamen(buildInitialDriverNames(initialData || {}));
    setFahrgaesteNamen(buildInitialGuestNames(initialData || {}));
    setFormValues(buildInitialFormValues(initialData || {}));
    setFlightEtaIndicator({ text: '', colorClass: 'text-[#808080]' });
    setFlightValidationState({ status: 'empty', etaLabel: '', valid: false, startLocation: '' });
    setAppliedFlightNumber('');
    setTrainEtaIndicator({ text: '', colorClass: 'text-[#808080]' });
    setTrainValidationState({ status: 'empty', etaLabel: '', valid: false, startLocation: '' });
    setAppliedTrainNumber('');
  }, [initialData]);

  const updateField = (key, value) => {
    setFormValues((prev) => ({ ...prev, [key]: value }));
  };
  const showVehicleCount = String(formValues.konvoi || '').trim().length > 0;
  const parsedVehicleCount = Number.parseInt(formValues.anzahlFahrzeuge, 10);
  const fahrerCount = showVehicleCount ? Math.max(1, Number.isNaN(parsedVehicleCount) ? 1 : parsedVehicleCount) : 1;
  const filledGuestNames = fahrgaesteNamen.map((name) => String(name || '').trim()).filter(Boolean);
  const _filledGuestCount = filledGuestNames.length;
  const predictionRequestRef = useRef(null);
  const predictionSeqRef = useRef(0);
  const flightValidationSeqRef = useRef(0);
  const trainValidationSeqRef = useRef(0);

  useEffect(() => {
    setFahrerNamen((prev) => {
      const next = [...prev];
      if (next.length < fahrerCount) {
        return [...next, ...Array.from({ length: fahrerCount - next.length }, () => '')];
      }
      if (next.length > fahrerCount) {
        return next.slice(0, fahrerCount);
      }
      return next;
    });
  }, [fahrerCount]);

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
    const flightValue = String(formValues.flugnummer || '').trim();
    const normalizedFlightValue = flightValue.replace(/\s+/g, '').toUpperCase();
    if (!flightValue) {
      setFlightEtaIndicator({ text: '', colorClass: 'text-[#808080]' });
      setFlightValidationState({ status: 'empty', etaLabel: '', valid: false, startLocation: '' });
      setAppliedFlightNumber('');
      return undefined;
    }

    let isCancelled = false;
    const requestId = flightValidationSeqRef.current + 1;
    flightValidationSeqRef.current = requestId;

    const timer = setTimeout(async () => {
      const result = await onValidateFlight(flightValue, formValues.datum, formValues.start);
      if (isCancelled || requestId !== flightValidationSeqRef.current) return;
      const status = String(result?.status || 'invalid');
      const etaLabel = String(result?.etaLabel || '').trim();
      const startLocation = String(result?.startLocation || '').trim();
      const valid = Boolean(result?.valid) || status === 'ok' || status === 'unknown_eta';
      setFlightValidationState({ status, etaLabel, valid, startLocation });

      if (status === 'ok' && etaLabel) {
        setFlightEtaIndicator({ text: etaLabel, colorClass: 'text-[#808080]' });
      } else if (status === 'multi') {
        setFlightEtaIndicator({ text: 'Multi', colorClass: 'text-[#f55757]' });
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
  }, [formValues.flugnummer, formValues.datum, formValues.start, onValidateFlight, appliedFlightNumber]);

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
      const result = await onValidateTrain(trainValue, formValues.datum, formValues.start);
      if (isCancelled || requestId !== trainValidationSeqRef.current) return;
      const status = String(result?.status || 'invalid');
      const etaLabel = String(result?.etaLabel || '').trim();
      const startLocation = String(result?.startLocation || '').trim();
      const valid = Boolean(result?.valid) || status === 'ok' || status === 'unknown_eta';
      setTrainValidationState({ status, etaLabel, valid, startLocation });

      if (status === 'ok' && etaLabel) {
        setTrainEtaIndicator({ text: etaLabel, colorClass: 'text-[#808080]' });
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
  }, [formValues.zugnummer, formValues.datum, formValues.start, onValidateTrain, appliedTrainNumber]);

  const fetchAddressPredictions = (input, field) => {
    updateField(field, input);
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
      window.alert('Für diesen Flug fehlen ETA und Ankunftsort.');
      return;
    }

    setFormValues((prev) => ({
      ...prev,
      startZeit: resolvedStartZeit || prev.startZeit,
      start: startLocation || prev.start,
    }));
    setAppliedFlightNumber(normalizedFlightNumber);
  };

  const flightRightAction = {
    type: isFlightApplied ? 'x' : canApplyFlight ? 'check' : 'arrow',
    onClick: handleFlightAction,
    ariaLabel: isFlightApplied ? 'Flugdaten zurücksetzen' : canApplyFlight ? 'Flugdaten übernehmen' : 'Flugnummer prüfen',
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
      window.alert('Für diesen Zug fehlen ETA und Ankunftsort.');
      return;
    }

    setFormValues((prev) => ({
      ...prev,
      startZeit: resolvedStartZeit || prev.startZeit,
      start: startLocation || prev.start,
    }));
    setAppliedTrainNumber(normalizedTrainNumber);
  };

  const trainRightAction = {
    type: isTrainApplied ? 'x' : canApplyTrain ? 'check' : 'arrow',
    onClick: handleTrainAction,
    ariaLabel: isTrainApplied ? 'Zugdaten zurücksetzen' : canApplyTrain ? 'Zugdaten übernehmen' : 'Zugnummer prüfen',
  };

  const rows = [
    { key: 'ziel', label: 'Ziel', mode: 'select', options: placePredictions.ziel },
    {
      key: 'flugnummer',
      label: 'Flugnummer',
      mode: 'text',
      etaIndicator: normalizedFlightNumber ? flightEtaIndicator : null,
      rightAction: flightRightAction,
    },
    {
      key: 'zugnummer',
      label: 'Zugnummer',
      mode: 'text',
      etaIndicator: normalizedTrainNumber ? trainEtaIndicator : null,
      rightAction: trainRightAction,
    },
    { key: 'konvoi', label: 'Konvoi', mode: 'text' },
    ...(showVehicleCount ? [{ key: 'anzahlFahrzeuge', label: 'Anzahl Fahrzeuge', mode: 'number', options: ['1', '2', '3', '4'] }] : []),
    ...Array.from({ length: fahrerCount }, (_, index) => ({
      key: `fahrer-${index}`,
      label: showVehicleCount ? `Fahrer #${index + 1}` : 'Fahrer',
      mode: 'fahrer',
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
      label: index === 0 ? (String(fahrgaesteNamen[0] || '').trim().length > 0 ? 'Gast #1' : 'Fahrgäste') : `Gast #${index + 1}`,
      mode: 'fahrgast',
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
    { key: 'anonymeGaeste', label: 'Anonyme Gäste', mode: 'number', options: ['0', '1', '2', '3', '4', '5', '6', '7', '8'] },
    { key: 'anzahlKinder', label: 'Anzahl Kinder', mode: 'number', options: ['0', '1', '2', '3', '4', '5'] },
    { key: 'aktuellerStatus', label: 'aktueller Status', mode: 'dropdown', options: ['offen', 'beendet', 'stoniert', 'unterwegs'] },
  ];

  const lastRowTop = ROW_START_TOP + (rows.length - 1) * ROW_STEP;
  const startRowTop = 330;
  const zielRowTop = ROW_START_TOP;
  const notesTop = lastRowTop + ROW_HEIGHT + NOTES_GAP;
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
    const normalizedDriverNames = (Array.isArray(fahrerNamen) ? fahrerNamen : [])
      .map((name) => String(name || '').trim());
    const fahrerNamenForSave = normalizedDriverNames.slice(0, driverSlotsToSave);
    while (fahrerNamenForSave.length < driverSlotsToSave) {
      fahrerNamenForSave.push('');
    }

    const payload = {
      ...initialData,
      ...formValues,
      konvoi: hasKonvoi ? String(formValues.konvoi || '').trim() : '',
      anzahlFahrzeuge: hasKonvoi ? String(formValues.anzahlFahrzeuge || '').trim() : '',
      fahrgaeste: filledGuestNames.join('; '),
      anonymeGaeste: String(formValues.anonymeGaeste || '0'),
      fahrerNamen: fahrerNamenForSave,
      notes,
    };
    setIsSaving(true);
    try {
      const result = await onSave(payload);
      if (!result?.ok) {
        window.alert(`Fahrt konnte nicht gespeichert werden: ${result?.error || 'Unbekannter Fehler'}`);
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
    const confirmed = window.confirm('Fahrt wirklich stonieren und löschen?');
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
      style={{ background: 'radial-gradient(ellipse 141.42% 102.21% at 0% 0%, #313701 0%, #000 46%, #000 84%, #000 100%)' }}
    >
      <div className="h-full overflow-y-auto overflow-x-hidden overscroll-none">
        <div
          className="w-[402px] relative overflow-hidden"
          style={{
            height: `${contentHeight}px`,
            background: 'radial-gradient(ellipse 141.42% 102.21% at 0% 0%, #313701 0%, #000 46%, #000 84%, #000 100%)',
          }}
        >
          <BackCircleButton onClick={handleBack} className="absolute left-[20px] top-[60px]" />

          <div className="w-100 h-14 left-[20px] top-[140px] absolute">
              <div className="left-0 top-0 absolute text-[42px] leading-[42px] font-bold font-['Space_Grotesk']" style={{ color: GREEN }}>
              {title}
              </div>
          </div>

          <FormRow
            top={194}
            label="Datum"
            value={formValues.datum}
            onChange={(value) => updateField('datum', value)}
            onReset={() => updateField('datum', '')}
            mode="date"
          />

          <FormRow
            top={262}
            label="Start Zeit"
            value={formValues.startZeit}
            onChange={(value) => updateField('startZeit', value)}
            onReset={() => updateField('startZeit', '')}
            mode="time"
          />

          <FormRow
            top={330}
            label="Start"
            fieldKey="start"
            value={formValues.start}
            onChange={(value) => fetchAddressPredictions(value, 'start')}
            onFocus={() => setActiveAddressField('start')}
            onBlur={() => setTimeout(() => setActiveAddressField((prev) => (prev === 'start' ? null : prev)), 120)}
            onReset={() => {
              updateField('start', '');
              setPlacePredictions((prev) => ({ ...prev, start: [] }));
            }}
            mode="select"
            options={placePredictions.start}
          />

          {activeAddressField === 'start' && placePredictions.start.length > 0 && (
            <div
              className="absolute left-[20px] w-[362px] max-h-[180px] overflow-y-auto rounded-2xl border border-[#4a4f22] bg-[#151607] z-[120]"
              style={{ top: `${startRowTop + ROW_HEIGHT + 4}px` }}
            >
              {placePredictions.start.map((option, index) => (
                <button
                  key={`start-option-${index}-${option}`}
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    updateField('start', option);
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
                    updateField('ziel', '');
                    setPlacePredictions((prev) => ({ ...prev, ziel: [] }));
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
                onFocus={row.key === 'ziel' ? () => setActiveAddressField('ziel') : undefined}
                onBlur={row.key === 'ziel' ? () => setTimeout(() => setActiveAddressField((prev) => (prev === 'ziel' ? null : prev)), 120) : undefined}
                mode={row.mode}
                options={row.options}
                etaIndicator={row.etaIndicator}
                rightAction={row.rightAction}
              />
            );
          })}

          {activeAddressField === 'ziel' && placePredictions.ziel.length > 0 && (
            <div
              className="absolute left-[20px] w-[362px] max-h-[180px] overflow-y-auto rounded-2xl border border-[#4a4f22] bg-[#151607] z-[120]"
              style={{ top: `${zielRowTop + ROW_HEIGHT + 4}px` }}
            >
              {placePredictions.ziel.map((option, index) => (
                <button
                  key={`ziel-option-${index}-${option}`}
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    updateField('ziel', option);
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
                    Notizen
                  </h3>
                  <img src="/icon/_Icon_Lime/Arrow-kurz_Trisar_Icons_01_Lime.svg" alt="" className="w-[10px] h-[13px]" />
                </div>

                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Schreiben..."
                  className="flex-1 text-[14px] text-[rgba(129,129,129,0.5)] resize-none border-none outline-none bg-transparent tracking-[0.25px]"
                  style={{ fontFamily: 'Space Grotesk' }}
                />
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={handleSave}
            disabled={isSaving}
            data-show-1st-trailing-icon="true"
            data-show-2nd-trailing-icon="false"
            data-show-avatar="False"
            data-show-leading-icon="false"
            data-state="Enabled"
            className="w-[362px] h-14 left-[20px] absolute inline-flex justify-start items-center gap-1 overflow-hidden bg-[#E3F654] outline outline-2 outline-offset-[-1px] outline-[#E3F654] disabled:opacity-70"
            style={{ top: `${ctaTop}px` }}
          >
            <div className="flex-1 self-stretch p-1 flex justify-start items-center">
              <div className="flex-1 self-stretch px-3 flex justify-start items-center gap-2.5">
                <div className="justify-center text-neutral-800 text-base font-medium font-['Space_Grotesk'] leading-6 tracking-wide">{isSaving ? 'Speichern ...' : submitLabel}</div>
              </div>
            </div>
            <div className="mr-4 flex items-center justify-center">
              <img src="/icon/_Icon_Schwarz/Arrow_Trisar_Icons_01.svg" alt="" className="w-[34px] h-[20px]" />
            </div>
          </button>

          <button
            type="button"
            onClick={handleCancelRide}
            className="w-[362px] h-14 left-[20px] absolute inline-flex justify-center items-center bg-[#221313] outline outline-2 outline-offset-[-1px] outline-[#f55757] text-[#f55757] text-base font-medium font-['Space_Grotesk'] leading-6 tracking-wide"
            style={{ top: `${cancelTop}px` }}
          >
            Fahrt stonieren
          </button>

          <TrisarFooter className="absolute left-0 right-0 h-10 bg-black" style={{ top: `${footerTop}px` }} />
        </div>
      </div>

    </div>
  );
}
