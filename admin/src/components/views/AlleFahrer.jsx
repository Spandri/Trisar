import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import NaviFooterKomponente from '../navigation/NaviFooterKomponente';
import BackCircleButton from '../ui/BackCircleButton';
import AiDienstplanView from './KiPlanerDemoView';
import DienstePlanenBlatt from './DienstePlanenBlatt';
import { DEFAULT_PLANNER_SETTINGS } from './KiPlanerSettingsView';
import { computeDemandCurve, pickBusiestDayRides } from '../../demo/planungsKurven';
import { DEMO_MODE, hasSupabaseAdminConfig, hasSupabaseConfig, supabase, supabaseAdmin } from '../../services/supabase';
import { useI18n } from '../../i18n';

const DRIVERS_RELOAD_EVENT = 'trisar:admin:drivers:reload';
const ADMIN_FALLBACK_ERROR_RE = /invalid jwt|signature is invalid|not allowed|unauthorized|permission denied|row-level security|42501/i;
let anonymousAuthUnavailable = false;

const ensureDriversRealtimeSession = async () => {
  try {
    if (anonymousAuthUnavailable) return false;
    const { data } = await supabase.auth.getSession();
    if (data?.session) return true;
    // Realtime kann mit anon/public key auch ohne aktive User-Session funktionieren.
    // Kein signInAnonymously mehr: verhindert 422-Spam, wenn anonyme Auth deaktiviert ist.
    anonymousAuthUnavailable = true;
    return true;
  } catch {
    return true;
  }
};

const MISSING_SCHEMA_SQL = `-- Falls noch nicht vorhanden:
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'fahrer';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS vehicle_id UUID REFERENCES public.vehicles(id) ON DELETE SET NULL;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS driver_number BIGINT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS driver_activity_state TEXT DEFAULT 'frei';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS service_start_time TIME;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS service_end_time TIME;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS service_start_date DATE;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS service_end_date DATE;
ALTER TABLE public.vehicles ADD COLUMN IF NOT EXISTS license_plate TEXT;
CREATE TABLE IF NOT EXISTS public.driver_service_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  service_date DATE NOT NULL,
  service_start_time TIME,
  service_end_time TIME,
  status TEXT NOT NULL DEFAULT 'pending',
  requested_by TEXT,
  refusal_reason TEXT,
  responded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);`;

const DRIVER_STATE_ACTIVE = 'aktiv';
const DRIVER_STATE_INACTIVE = 'inaktiv';
const DRIVER_STATE_FREE = 'frei';
const STATUS_FILTER_ALL = 'alle';
const STATUS_FILTER_ON_DUTY = 'im_dienst';
const STATUS_FILTER_FREE_NOW = 'frei';
const STATUS_FILTER_INCOMPLETE = 'unfertig';

const DRIVER_STATE_VISUALS = {
  [DRIVER_STATE_ACTIVE]: {
    cardBg: '#FF6F63',
    textColor: '#171717',
    numberColor: '#171717',
    chipColor: '#FF6F63',
    chipActiveBg: 'rgba(255, 111, 99, 0.18)',
  },
  [DRIVER_STATE_FREE]: {
    cardBg: '#59BE80',
    textColor: '#171717',
    numberColor: '#171717',
    chipColor: '#59BE80',
    chipActiveBg: 'rgba(89, 190, 128, 0.18)',
  },
  [DRIVER_STATE_INACTIVE]: {
    cardBg: '#E3F654',
    textColor: '#171717',
    numberColor: '#8A8A8D',
    chipColor: '#E3F654',
    chipActiveBg: 'rgba(227, 246, 84, 0.18)',
  },
};

const DRIVER_CARD_VISUALS = {
  onDuty: {
    cardBg: '#FFFFFF',
    textColor: '#171717',
    numberColor: '#171717',
  },
  free: {
    cardBg: '#59BE80',
    textColor: '#171717',
    numberColor: '#171717',
  },
  incomplete: {
    cardBg: '#FF6F63',
    textColor: '#171717',
    numberColor: '#171717',
  },
};

// Dieselbe Linie wie auf den uebrigen Dispo-Seiten: 20 px Rand, Titel 30 px
// unter dem Zurueck-Knopf, 24 px zum ersten Inhalt und zwischen Gruppen,
// 12 px zwischen Bedienelementen untereinander.
const LAYOUT_GRID = {
  contentLeft: 20,
  contentWidth: 362,
  columnWidth: 175,
  secondColumnLeft: 207,
  thirdColumnLeft: 272,
  titleTop: 140,
  subtitleTop: 216,
  statsTop: 206,
  searchTop: 428,
  createTop: 496,
  planningActionsTop: 564,
  chipsTop: 564,
  timeTop: 618,
  cardsTop: 698,
  cardStep: 96,
};

const STATUS_CHIP_WIDTH = 112;
const STATUS_CHIP_GAP = 13;

const STATUS_CHIPS = [
  { key: STATUS_FILTER_ON_DUTY, labelKey: 'fahrer.chipOnDuty', left: LAYOUT_GRID.contentLeft, top: LAYOUT_GRID.chipsTop, color: '#FFFFFF' },
  {
    key: STATUS_FILTER_FREE_NOW,
    labelKey: 'fahrer.chipFree',
    left: LAYOUT_GRID.contentLeft + STATUS_CHIP_WIDTH + STATUS_CHIP_GAP,
    top: LAYOUT_GRID.chipsTop,
    color: '#59BE80',
  },
  {
    key: STATUS_FILTER_INCOMPLETE,
    labelKey: 'fahrer.chipIncomplete',
    left: LAYOUT_GRID.contentLeft + (STATUS_CHIP_WIDTH + STATUS_CHIP_GAP) * 2,
    top: LAYOUT_GRID.chipsTop,
    color: '#FF6F63',
  },
];

const normalizeClockValue = (value) => {
  const match = String(value || '').trim().match(/^(\d{1,2}):(\d{2})/);
  if (!match) return '';
  const hours = Number.parseInt(match[1], 10);
  const minutes = Number.parseInt(match[2], 10);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return '';
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return '';
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
};

const formatClockDisplay = (value) => {
  const normalized = normalizeClockValue(value);
  if (!normalized) return '';
  return normalized;
};

const clockToMinutes = (value) => {
  const normalized = normalizeClockValue(value);
  if (!normalized) return null;
  const [hours, minutes] = normalized.split(':').map((part) => Number.parseInt(part, 10));
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  return hours * 60 + minutes;
};

const buildDailySegments = (startMinutes, endMinutes) => {
  if (!Number.isFinite(startMinutes) || !Number.isFinite(endMinutes)) return [];
  if (endMinutes >= startMinutes) return [[startMinutes, endMinutes]];
  return [
    [startMinutes, 1439],
    [0, endMinutes],
  ];
};

const hasSegmentOverlap = (segmentsA, segmentsB) =>
  segmentsA.some(([aStart, aEnd]) =>
    segmentsB.some(([bStart, bEnd]) => Math.max(aStart, bStart) <= Math.min(aEnd, bEnd)));

const formatDayMonthDisplay = (isoDate) => {
  const match = String(isoDate || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return '';
  return `${match[3]}.${match[2]}.`;
};

const getTodayIsoDate = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

// Planungshorizont der wischbaren Zeitachse: heute + 2 Folgetage
const PLANNING_HORIZON_DAYS = 3;
const PLANNING_HORIZON_HOURS = PLANNING_HORIZON_DAYS * 24;

const isoDateToUtcMs = (isoDate) => {
  const match = String(isoDate || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
};

const addDaysToIsoDate = (isoDate, days) => {
  const base = isoDateToUtcMs(isoDate);
  if (base == null) return isoDate;
  const shifted = new Date(base + days * 86400000);
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}-${String(shifted.getUTCDate()).padStart(2, '0')}`;
};

// Tagesabstand eines ISO-Datums zu heute (0 = heute, 1 = morgen, …)
const dayOffsetFromToday = (isoDate) => {
  const target = isoDateToUtcMs(isoDate);
  const today = isoDateToUtcMs(getTodayIsoDate());
  if (target == null || today == null) return null;
  return Math.round((target - today) / 86400000);
};

const normalizeDriverState = (stateValue, roleValue) => {
  const normalized = String(stateValue || '').trim().toLowerCase();
  if (['aktiv', 'active', 'in_progress', 'unterwegs'].includes(normalized)) return DRIVER_STATE_ACTIVE;
  if (['inaktiv', 'inactive'].includes(normalized)) return DRIVER_STATE_INACTIVE;
  if (['frei', 'free', 'idle', 'available'].includes(normalized)) return DRIVER_STATE_FREE;
  return DRIVER_STATE_FREE;
};

const formatServiceWindow = (t, startValue, endValue) => {
  const start = formatClockDisplay(startValue);
  const end = formatClockDisplay(endValue);
  if (!start && !end) return t('fahrer.serviceNotPlanned');
  if (start && end) return t('fahrer.serviceWindow', { start, end });
  if (start) return t('fahrer.serviceStartAt', { start });
  return t('fahrer.serviceEndAt', { end });
};

const formatServiceTimeStack = (startValue, endValue) => {
  const start = formatClockDisplay(startValue) || '--:--';
  const end = formatClockDisplay(endValue) || '--:--';
  return {
    startLine: start,
    endLine: `- ${end}`,
  };
};

const isServicePlanComplete = (driver) =>
  Boolean(normalizeClockValue(driver?.serviceStartTime) && normalizeClockValue(driver?.serviceEndTime));

const isDriverIncomplete = (driver) => {
  const hasVehicle = String(driver?.vehicle || '').trim().length > 0;
  const hasDriverNumber = String(driver?.driverNumber ?? '').trim().length > 0;
  return !hasVehicle || !hasDriverNumber || !isServicePlanComplete(driver);
};

const isDriverInServiceNow = (driver) => {
  const startMinutes = clockToMinutes(driver?.serviceStartTime);
  const endMinutes = clockToMinutes(driver?.serviceEndTime);
  if (startMinutes == null || endMinutes == null) return false;
  const now = new Date();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const segments = buildDailySegments(startMinutes, endMinutes);
  return segments.some(([segmentStart, segmentEnd]) => nowMinutes >= segmentStart && nowMinutes <= segmentEnd);
};

const normalizePlanRequestStatus = (statusValue) => {
  const normalized = String(statusValue || '').trim().toLowerCase();
  if (['cancelled', 'canceled', 'reset'].includes(normalized)) return 'cancelled';
  if (['accepted', 'assigned', 'approved'].includes(normalized)) return 'accepted';
  if (['refused', 'rejected', 'declined'].includes(normalized)) return 'refused';
  if (['pending', 'new', 'requested', 'offered'].includes(normalized)) return 'pending';
  return '';
};

const getPlanRequestStatusColor = (statusValue) => {
  const normalized = normalizePlanRequestStatus(statusValue);
  if (normalized === 'refused') return '#f55757';
  if (normalized === 'pending') return '#ff8a00';
  return '#1D1C1D';
};

const PLAN_TEMPLATES = [
  { key: 'frueh', labelKey: 'fahrer.shiftEarly', start: '06:00', end: '14:00' },
  { key: 'tag', labelKey: 'fahrer.shiftDay', start: '08:00', end: '16:00' },
  { key: 'spaet', labelKey: 'fahrer.shiftLate', start: '14:00', end: '22:00' },
  { key: 'nacht', labelKey: 'fahrer.shiftNight', start: '22:00', end: '06:00' },
];
// Dienste von Hand eintragen ("Dienste planen") ist vorerst ausgeblendet:
// Dienste entstehen in der Demo nur ueber den KI-Planer. Wieder einschalten: true.
const DIENSTE_VON_HAND = false;
const PLANNER_SETTINGS_KEY = 'trisar_planner_settings_v1';
const SELECTED_DRIVERS_STORAGE_KEY = 'trisar:admin:allefahrer:selected-driver-ids';

const SWIPE_ACTION_WIDTH = 90;
const SWIPE_OPEN_THRESHOLD = 36;
const SWIPE_TRIGGER_THRESHOLD = 124;
const SWIPE_MAX_OFFSET = 160;
const SWIPE_LOCK_THRESHOLD = 14;
const SWIPE_SUPPRESS_CLICK_THRESHOLD = 18;
const SWIPE_ICON_SIZE = 34;
const DRIVER_NAME_MAX_FONT_SIZE = 30;
const DRIVER_NAME_MIN_FONT_SIZE = 8;

const SwipeActionButton = ({ icon, alt, side, onPress, onReset, iconLeft, marker }) => (
  <button
    type="button"
    aria-label={alt}
    data-tutorial={marker}
    onClick={(event) => {
      event.stopPropagation();
      onReset();
      onPress();
    }}
    className={`absolute inset-y-0 ${side}-0`}
    style={{ width: `${SWIPE_MAX_OFFSET}px` }}
  >
    <img
      src={icon}
      alt=""
      className="absolute top-1/2 -translate-y-1/2 w-[34px] h-[34px] object-contain"
      style={{ left: `${iconLeft}px` }}
    />
  </button>
);

function DriverCard({ driver, top, onClick, isSelected, onToggleSelect }) {
  const { t } = useI18n();
  const plate = String(driver.vehicle || '').trim();
  const vehicleText = plate || t('fahrer.noVehicleAssigned');
  const driverNumberLabel = driver.driverNumber != null ? String(driver.driverNumber) : '-';
  const visual = driver?.isIncomplete
    ? DRIVER_CARD_VISUALS.incomplete
    : driver?.isInServiceNow
      ? DRIVER_CARD_VISUALS.onDuty
      : DRIVER_CARD_VISUALS.free;
  const serviceTimes = formatServiceTimeStack(driver.serviceStartTime, driver.serviceEndTime);
  const serviceTimeColor = getPlanRequestStatusColor(driver.planRequestStatus);
  const nameRef = useRef(null);
  const [nameFontSize, setNameFontSize] = useState(DRIVER_NAME_MAX_FONT_SIZE);
  const [offsetX, setOffsetX] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const dragRef = useRef({
    pointerId: null,
    startX: 0,
    startY: 0,
    startOffset: 0,
    lockedAxis: null,
  });
  const suppressNextClickRef = useRef(false);
  const clampOffset = (value) => Math.max(-SWIPE_MAX_OFFSET, Math.min(SWIPE_MAX_OFFSET, value));
  const revealedLeft = Math.max(0, offsetX);
  const revealedRight = Math.max(0, -offsetX);
  const leftIconLeft = revealedLeft / 2 - SWIPE_ICON_SIZE / 2;
  const rightIconLeft = SWIPE_MAX_OFFSET - revealedRight / 2 - SWIPE_ICON_SIZE / 2;
  const runLeftAction = () => {
    onToggleSelect?.(driver.id);
    setOffsetX(0);
  };
  const runRightAction = () => {
    onClick?.(driver);
    setOffsetX(0);
  };

  const handlePointerDown = (event) => {
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startOffset: offsetX,
      lockedAxis: null,
    };
    setIsDragging(true);
    if (event.currentTarget?.setPointerCapture) {
      event.currentTarget.setPointerCapture(event.pointerId);
    }
  };

  const handlePointerMove = (event) => {
    if (!isDragging || dragRef.current.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - dragRef.current.startX;
    const deltaY = event.clientY - dragRef.current.startY;
    if (!dragRef.current.lockedAxis) {
      if (Math.abs(deltaX) < SWIPE_LOCK_THRESHOLD && Math.abs(deltaY) < SWIPE_LOCK_THRESHOLD) return;
      dragRef.current.lockedAxis = Math.abs(deltaX) >= Math.abs(deltaY) ? 'x' : 'y';
    }
    if (dragRef.current.lockedAxis !== 'x') return;
    const nextOffset = clampOffset(dragRef.current.startOffset + deltaX);
    setOffsetX(nextOffset);
    if (Math.abs(nextOffset - dragRef.current.startOffset) > SWIPE_SUPPRESS_CLICK_THRESHOLD) {
      suppressNextClickRef.current = true;
    }
    event.preventDefault();
  };

  const handlePointerEnd = (event) => {
    if (dragRef.current.pointerId !== event.pointerId) return;
    if (dragRef.current.lockedAxis === 'x') {
      suppressNextClickRef.current = Math.abs(offsetX) > SWIPE_SUPPRESS_CLICK_THRESHOLD;
      if (offsetX >= SWIPE_TRIGGER_THRESHOLD) {
        runLeftAction();
      } else if (offsetX <= -SWIPE_TRIGGER_THRESHOLD) {
        runRightAction();
      } else if (offsetX > SWIPE_OPEN_THRESHOLD) {
        setOffsetX(SWIPE_ACTION_WIDTH);
      } else if (offsetX < -SWIPE_OPEN_THRESHOLD) {
        setOffsetX(-SWIPE_ACTION_WIDTH);
      } else {
        setOffsetX(0);
      }
    }
    if (event.currentTarget?.releasePointerCapture) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setIsDragging(false);
    dragRef.current.pointerId = null;
    dragRef.current.lockedAxis = null;
  };

  const handleCardClick = () => {
    if (suppressNextClickRef.current) {
      suppressNextClickRef.current = false;
      return;
    }
    if (Math.abs(offsetX) > 0) {
      setOffsetX(0);
      return;
    }
    onClick?.(driver);
  };

  useLayoutEffect(() => {
    setNameFontSize(DRIVER_NAME_MAX_FONT_SIZE);
  }, [driver.name]);

  useLayoutEffect(() => {
    const nameEl = nameRef.current;
    if (!nameEl) return;
    if (nameFontSize <= DRIVER_NAME_MIN_FONT_SIZE) return;
    if (nameEl.scrollWidth > nameEl.clientWidth + 1) {
      setNameFontSize((prev) => Math.max(DRIVER_NAME_MIN_FONT_SIZE, prev - 1));
    }
  }, [nameFontSize, driver.name]);

  return (
    <div className="w-[362px] h-[84px] left-[20px] absolute overflow-hidden" style={{ top: `${top}px` }}>
      <div className="absolute inset-y-0 left-0 bg-[#E3F654]" style={{ width: `${SWIPE_MAX_OFFSET}px` }}>
        <SwipeActionButton
          icon="/icon/_Icon_Schwarz/Faecher_Done.svg"
          alt={isSelected ? t('fahrer.deselectDriver', { name: driver.name }) : t('fahrer.selectDriver', { name: driver.name })}
          side="left"
          onPress={runLeftAction}
          onReset={() => setOffsetX(0)}
          iconLeft={leftIconLeft}
          marker={`fahrer-aktion-auswaehlen-${driver.id}`}
        />
      </div>
      <div className="absolute inset-y-0 right-0 bg-[#E3F654]" style={{ width: `${SWIPE_MAX_OFFSET}px` }}>
        <SwipeActionButton
          icon="/icon/_Icon_Schwarz/Edit_Trisar_Icon_01.svg"
          alt={t('fahrer.editDriver')}
          side="right"
          onPress={runRightAction}
          onReset={() => setOffsetX(0)}
          iconLeft={rightIconLeft}
          marker={`fahrer-aktion-bearbeiten-${driver.id}`}
        />
      </div>

      <div
        role="button"
        tabIndex={0}
        data-tutorial={`fahrer-${driver.id}`}
        onClick={handleCardClick}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            handleCardClick();
          }
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        onPointerCancel={handlePointerEnd}
        className="absolute inset-0 text-left transition-transform active:scale-[0.99] border-2 touch-pan-y"
        style={{
          backgroundColor: visual.cardBg,
          borderColor: isSelected ? '#E3F654' : 'transparent',
          transform: `translate3d(${offsetX}px, 0, 0)`,
          transition: isDragging ? 'none' : 'transform 220ms ease',
        }}
      >
        <div className="w-[250px] h-[60px] left-[18px] top-[12px] absolute inline-flex flex-col justify-center items-start">
          <div
            ref={nameRef}
            className="w-full whitespace-nowrap overflow-hidden text-zinc-900 font-bold font-['Space_Grotesk'] leading-[1.1]"
            style={{ fontSize: `${nameFontSize}px` }}
          >
            {driver.name}
          </div>
          <div className="truncate text-zinc-900/80 text-sm font-medium font-['Space_Grotesk'] leading-4 tracking-wide">
            {vehicleText}
          </div>
        </div>

        <div
          className="right-[18px] top-[12px] absolute text-lg font-medium font-['Space_Grotesk'] leading-5 tracking-tight"
          style={{ color: visual.numberColor }}
        >
          #{driverNumberLabel}
        </div>

        <div className="absolute right-[14px] bottom-[10px] text-right leading-[1]">
          <div className="text-[15px] font-semibold font-['Space_Grotesk'] tracking-[0.2px]" style={{ color: serviceTimeColor }}>
            {serviceTimes.startLine}
          </div>
          <div className="mt-[2px] text-[15px] font-semibold font-['Space_Grotesk'] tracking-[0.2px]" style={{ color: serviceTimeColor }}>
            {serviceTimes.endLine}
          </div>
        </div>
      </div>
    </div>
  );
}

function StatusChip({ chip, selected, onSelect }) {
  const { t } = useI18n();
  return (
    <button
      type="button"
      onClick={() => onSelect(chip.key)}
      data-tutorial={`fahrer-status-${chip.key}`}
      className="h-[42px] absolute border-2 flex justify-center items-center"
      style={{
        width: `${STATUS_CHIP_WIDTH}px`,
        left: `${chip.left}px`,
        top: `${chip.top}px`,
        borderColor: chip.color,
        color: selected ? '#171717' : chip.color,
        backgroundColor: selected ? chip.color : 'transparent',
      }}
    >
      <span className="text-base font-medium font-['Space_Grotesk'] leading-6 tracking-wide">{t(chip.labelKey)}</span>
    </button>
  );
}

function TimeField({
  timeValue,
  onTimeChange,
  dateValue,
  onDateChange,
  placeholder,
}) {
  const { t } = useI18n();
  const hasAnyValue = Boolean(timeValue || dateValue);
  const timeDisplay = formatClockDisplay(timeValue);
  const dateDisplay = formatDayMonthDisplay(dateValue);
  // Safari (macOS) zeigt für Zeit-/Datumsfelder keinen Picker-Popup:
  // showPicker() existiert dort, tut aber sichtbar nichts (ohne Fehler).
  // Deshalb: Desktop-Safari direkt ins sichtbare, tippbare Feld schicken;
  // überall sonst den nativen Picker öffnen (mit Editier-Fallback bei Fehler).
  const [editingField, setEditingField] = useState(null);

  const openPickerOrEdit = (event, fieldKey) => {
    const el = event.currentTarget;
    const ua = navigator.userAgent;
    const isDesktopSafari = /safari/i.test(ua)
      && !/chrome|chromium|crios|fxios|edg|android/i.test(ua)
      && !('ontouchstart' in window);
    if (isDesktopSafari) {
      setEditingField(fieldKey);
      return;
    }
    let opened = false;
    if (typeof el.showPicker === 'function') {
      try {
        el.showPicker();
        opened = true;
      } catch {
        opened = false;
      }
    }
    if (!opened) setEditingField(fieldKey);
  };

  return (
    <div
      role="group"
      className="w-full h-[56px] border-2 border-yellow-300 inline-flex justify-start items-center overflow-hidden px-[12px] relative bg-transparent"
    >
      {!hasAnyValue ? (
        <div className="w-full inline-flex items-center justify-between gap-[8px] text-left text-yellow-300 text-base font-medium font-['Space_Grotesk'] leading-6 tracking-wide pointer-events-none">
          <span>{placeholder}</span>
          <img src="/icon/_Icon_Lime/Uhr_Trisar_Icon_01_Lime.svg" alt="" aria-hidden="true" className="w-5 h-5 shrink-0" />
        </div>
      ) : (
        <div className="w-full inline-flex items-center justify-between gap-[6px] pr-[40px] pointer-events-none">
          <span className="flex-1 min-w-0 text-left text-yellow-300 text-[18px] font-semibold font-['Space_Grotesk'] leading-none tracking-wide">
            {timeDisplay || '--:--'}
          </span>
          <span className="w-[50px] text-right border-l border-yellow-300/40 pl-[6px] text-yellow-300/85 text-[12px] font-medium font-['Space_Grotesk'] leading-none tracking-wide">
            {dateDisplay || t('fahrer.datePlaceholderShort')}
          </span>
        </div>
      )}
      {hasAnyValue ? (
        <button
          type="button"
          onClick={() => {
            onTimeChange('');
            onDateChange('');
          }}
          className="absolute right-[4px] top-1/2 -translate-y-1/2 w-[36px] h-[36px] inline-flex items-center justify-center text-[#E3F654] text-[38px] font-bold leading-none z-20"
          aria-label={t('fahrer.resetField', { field: placeholder })}
        >
          X
        </button>
      ) : null}
      <input
        type="time"
        value={timeValue}
        onChange={(event) => {
          const nextTime = normalizeClockValue(event.target.value);
          onTimeChange(nextTime);
          if (nextTime && !dateValue) onDateChange(getTodayIsoDate());
        }}
        onClick={(event) => openPickerOrEdit(event, 'time')}
        onBlur={(event) => {
          // Safari liefert den getippten Wert erst beim Verlassen des Felds
          const nextTime = normalizeClockValue(event.target.value);
          if (nextTime !== timeValue) {
            onTimeChange(nextTime);
            if (nextTime && !dateValue) onDateChange(getTodayIsoDate());
          }
          setEditingField(null);
        }}
        className={
          editingField === 'time'
            ? "absolute inset-0 z-10 px-[12px] bg-[#0d0d05] text-yellow-300 text-[18px] font-semibold font-['Space_Grotesk'] [color-scheme:dark] outline-none"
            : `absolute top-0 bottom-0 opacity-0 cursor-pointer ${hasAnyValue ? 'left-0 right-[102px]' : 'inset-0'}`
        }
        aria-label={placeholder}
      />
      <input
        type="date"
        value={dateValue}
        onChange={(event) => onDateChange(event.target.value)}
        onClick={(event) => openPickerOrEdit(event, 'date')}
        onBlur={(event) => {
          const nextDate = String(event.target.value || '');
          if (nextDate !== dateValue) onDateChange(nextDate);
          setEditingField(null);
        }}
        className={
          editingField === 'date'
            ? "absolute inset-0 z-10 px-[12px] bg-[#0d0d05] text-yellow-300 text-[16px] font-semibold font-['Space_Grotesk'] [color-scheme:dark] outline-none"
            : `absolute top-0 bottom-0 right-[50px] w-[50px] opacity-0 cursor-pointer ${hasAnyValue ? '' : 'pointer-events-none'}`
        }
        aria-label={t('fahrer.fieldDate', { field: placeholder })}
      />
    </div>
  );
}

const CHART_START_HOUR = 6;
const CHART_END_HOUR = 23;
const CHART_HOURS = Array.from({ length: CHART_END_HOUR - CHART_START_HOUR + 1 }, (_, index) => CHART_START_HOUR + index);
const normalizeDemandProfile = (values) =>
  CHART_HOURS.map((_, index) => Math.max(0, Number.parseInt(String(values?.[index] ?? 0), 10) || 0));

function PlanningOverviewChart({
  supplySeries = [],
  ridesSeries = [],
  demandSeries = [],
  viewStart = CHART_START_HOUR,
  onViewStartChange,
  onOpenAiPlanner,
}) {
  const { t, locale } = useI18n();
  // Sichtbares Fenster (18 Stunden) aus den 72h-Reihen; per Wischen stundenweise verschiebbar
  const windowLength = CHART_HOURS.length;
  const maxViewStart = Math.max(0, supplySeries.length - windowLength);
  const clampedViewStart = Math.max(0, Math.min(maxViewStart, viewStart));
  const absHours = Array.from({ length: windowLength }, (_, i) => clampedViewStart + i);
  const hourlyDrivers = absHours.map((abs) => supplySeries[abs] || 0);
  const hourlyRides = absHours.map((abs) => ridesSeries[abs] || 0);
  const hourlyDemand = absHours.map((abs) => demandSeries[abs] || 0);

  const dragRef = useRef(null);
  const handlePointerDown = (event) => {
    dragRef.current = { startX: event.clientX, startView: clampedViewStart };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };
  const handlePointerMove = (event) => {
    if (!dragRef.current) return;
    const slotPx = (362 - 36) / windowLength;
    const deltaHours = Math.round((dragRef.current.startX - event.clientX) / slotPx);
    const next = Math.max(0, Math.min(maxViewStart, dragRef.current.startView + deltaHours));
    if (next !== clampedViewStart && typeof onViewStartChange === 'function') onViewStartChange(next);
  };
  const handlePointerUp = () => {
    dragRef.current = null;
  };

  const sideInset = 20;
  const width = 362;
  const height = 198;
  const paddingLeft = 36;
  const paddingRight = 0;
  const headerHeight = 44;
  const paddingTop = 8 + headerHeight;
  const paddingBottom = 34;
  const plotWidth = width - paddingLeft - paddingRight;
  const plotHeight = height - paddingTop - paddingBottom;
  const slotWidth = plotWidth / CHART_HOURS.length;
  const barWidth = Math.max(8, slotWidth * 0.82);
  const maxValue = Math.max(1, ...hourlyDrivers, ...hourlyRides, ...hourlyDemand);
  const scaleY = (value) => paddingTop + (plotHeight - (Math.max(0, value) / maxValue) * plotHeight);
  const baselineY = paddingTop + plotHeight;
  const yTickValues = [maxValue, Math.max(0, Math.round(maxValue / 2)), 0];
  // Datumszeile folgt dem sichtbaren Fenster (z. B. „Mo., 17.08. – Di., 18.08.“)
  const formatWindowDate = (absHour) =>
    new Intl.DateTimeFormat(locale, { weekday: 'short', day: '2-digit', month: '2-digit' })
      .format(new Date(Date.now() + Math.floor(absHour / 24) * 86400000));
  const windowStartLabel = formatWindowDate(absHours[0]);
  const windowEndLabel = formatWindowDate(absHours[absHours.length - 1]);
  const chartDateLabel = windowStartLabel === windowEndLabel
    ? t('fahrer.chartSwipeHintSingle', { date: windowStartLabel })
    : t('fahrer.chartSwipeHintRange', { start: windowStartLabel, end: windowEndLabel });
  const linePoints = CHART_HOURS.map((_, index) => {
    const centerX = paddingLeft + index * slotWidth + slotWidth / 2;
    const y = scaleY(hourlyRides[index] || 0);
    return `${centerX},${y}`;
  }).join(' ');
  const demandPoints = CHART_HOURS.map((_, index) => {
    const centerX = paddingLeft + index * slotWidth + slotWidth / 2;
    const y = scaleY(hourlyDemand[index] || 0);
    return `${centerX},${y}`;
  }).join(' ');
  const xLabels = absHours.filter((absHour) => absHour % 3 === 0);

  return (
    <div
      data-tutorial="planungsuebersicht"
      className="absolute"
      style={{ width: `${width}px`, left: `${sideInset}px`, top: `${LAYOUT_GRID.statsTop}px`, height: `${height}px` }}
    >
      <div className="absolute left-0 top-[10px] text-white text-[16px] font-semibold font-['Space_Grotesk'] tracking-[0.2px]">
        {t('fahrer.planningOverview')}
      </div>
      <div className="absolute left-0 top-[30px] text-white/70 text-[11px] font-medium font-['Space_Grotesk'] tracking-[0.2px]">
        {chartDateLabel}
      </div>
      <div className="absolute right-0 top-[10px] z-[3] flex items-center gap-[10px] text-[11px] font-medium font-['Space_Grotesk']">
        <button
          type="button"
          onClick={onOpenAiPlanner}
          data-tutorial="planer-ki-knopf"
          aria-label={t('fahrer.openAiPlanner')}
          title={t('fahrer.openAiPlanner')}
          className="w-[28px] h-[26px] text-[#E3F654] inline-flex items-center justify-center"
        >
          <img
            src="/icon/_Icon_Lime/KI_Trisar_Icons_01_Lime.svg"
            alt=""
            aria-hidden="true"
            className="w-[13px] h-[13px] object-contain"
          />
        </button>
        <span className="inline-flex items-center gap-[4px] text-[#45A8B6]">
          <span className="w-[10px] h-[10px] bg-[#45A8B6] rounded-[2px]" />
          {t('fahrer.driversLabel')}
        </span>
        <span className="inline-flex items-center gap-[4px] text-[#59BE80]">
          <span className="w-[12px] h-[2px] bg-[#59BE80]" />
          {t('fahrer.legendRides')}
        </span>
        <span className="inline-flex items-center gap-[4px] text-[#E3F654]">
          <span className="w-[12px] h-0 border-t-2 border-dashed border-[#E3F654]" />
          {t('fahrer.legendDemand')}
        </span>
      </div>

      <svg width={width} height={height} className="absolute left-0 top-0 pointer-events-none">
        <line x1={paddingLeft} y1={paddingTop} x2={paddingLeft} y2={baselineY} stroke="#6A6A6A" strokeWidth="1" />
        <line x1={paddingLeft} y1={baselineY} x2={width - paddingRight} y2={baselineY} stroke="#6A6A6A" strokeWidth="1" />
        {yTickValues.map((tickValue, index) => {
          const y = scaleY(tickValue);
          return (
            <g key={`y-tick-${index}`}>
              <line x1={paddingLeft - 4} y1={y} x2={paddingLeft} y2={y} stroke="#9A9A9A" strokeWidth="1" />
              <text
                x={paddingLeft - 8}
                y={y + 4}
                textAnchor="end"
                fontSize="11"
                fill="#B7B7B7"
                fontFamily="Space Grotesk, sans-serif"
                fontWeight="600"
              >
                {tickValue}
              </text>
            </g>
          );
        })}
        {CHART_HOURS.map((hour, index) => {
          const value = Math.max(0, Number(hourlyDrivers[index] || 0));
          const x = paddingLeft + index * slotWidth + (slotWidth - barWidth) / 2;
          const y = scaleY(value);
          const h = Math.max(0, baselineY - y);
          return (
            <rect
              key={`bar-${hour}`}
              x={x}
              y={y}
              width={barWidth}
              height={h}
              rx="3"
              fill="#45A8B6"
              opacity={value > 0 ? '0.95' : '0.2'}
            />
          );
        })}
        <polyline
          points={linePoints}
          fill="none"
          stroke="#59BE80"
          strokeWidth="3"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        <polyline
          points={demandPoints}
          fill="none"
          stroke="#E3F654"
          strokeWidth="2"
          strokeDasharray="6 4"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {xLabels.map((absHour) => {
          const index = absHour - clampedViewStart;
          const x = paddingLeft + index * slotWidth + slotWidth / 2;
          const hourOfDay = absHour % 24;
          const isMidnight = hourOfDay === 0;
          return (
            <text
              key={`label-${absHour}`}
              x={x}
              y={height - 8}
              textAnchor="middle"
              fontSize="11"
              fill={isMidnight ? '#E3F654' : '#B7B7B7'}
              fontFamily="Space Grotesk, sans-serif"
              fontWeight="600"
            >
              {isMidnight
                ? formatDayMonthDisplay(addDaysToIsoDate(getTodayIsoDate(), Math.floor(absHour / 24)))
                : t('fahrer.hourLabel', { hour: String(hourOfDay).padStart(2, '0') })}
            </text>
          );
        })}
      </svg>

      {/* Wischfläche über dem Plot: stundenweises Blättern durch die Zeitachse */}
      <div
        data-tutorial="planung-wischflaeche"
        className="absolute cursor-grab active:cursor-grabbing touch-pan-y"
        style={{ left: `${paddingLeft}px`, top: `${paddingTop}px`, width: `${plotWidth}px`, height: `${plotHeight + paddingBottom}px`, touchAction: 'pan-y' }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onPointerLeave={handlePointerUp}
        role="slider"
        aria-label={t('fahrer.moveTimeline')}
        aria-valuemin={0}
        aria-valuemax={maxViewStart}
        aria-valuenow={clampedViewStart}
      />
    </div>
  );
}

export default function AlleFahrer({ setView, onCreateDriver, onEditDriver, onNavigateToMapWithDrivers, planerDirekt = false }) {
  const { t } = useI18n();
  const [searchTerm, setSearchTerm] = useState('');
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const [isCompactDevice, setIsCompactDevice] = useState(() => window.matchMedia('(max-width: 1024px)').matches);
  const [keyboardInset, setKeyboardInset] = useState(0);
  const [statusFilter, setStatusFilter] = useState(STATUS_FILTER_ALL);
  const [startTimeFilter, setStartTimeFilter] = useState('');
  const [startDateFilter, setStartDateFilter] = useState(() => getTodayIsoDate());
  const [endTimeFilter, setEndTimeFilter] = useState('');
  const [endDateFilter, setEndDateFilter] = useState(() => getTodayIsoDate());
  const [selectedDriverIds, setSelectedDriverIds] = useState(() => {
    try {
      const raw = sessionStorage.getItem(SELECTED_DRIVERS_STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(parsed)) return [];
      return parsed.map((id) => String(id || '').trim()).filter(Boolean);
    } catch {
      return [];
    }
  });
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [isBulkPlannerOpen, setIsBulkPlannerOpen] = useState(false);
  const [isAiPlannerOpen, setIsAiPlannerOpen] = useState(planerDirekt);
  // Planungseinstellungen des KI Planers (Sitzungsdauer, wie der übrige Demo-Zustand)
  // Planungsregeln bleiben dauerhaft erhalten (localStorage) — sie sind eine
  // bewusste Einstellung des Koordinators und duerfen nicht bei jedem Oeffnen
  // oder nach einem Reload auf die Voreinstellung zurueckfallen.
  const [plannerSettings, setPlannerSettings] = useState(() => {
    try {
      const roh = window.localStorage.getItem(PLANNER_SETTINGS_KEY);
      const gespeichert = roh ? JSON.parse(roh) : null;
      // Unbekannte/neue Felder kommen aus den Voreinstellungen dazu.
      return gespeichert && typeof gespeichert === 'object'
        ? { ...DEFAULT_PLANNER_SETTINGS, ...gespeichert }
        : { ...DEFAULT_PLANNER_SETTINGS };
    } catch {
      return { ...DEFAULT_PLANNER_SETTINGS };
    }
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(PLANNER_SETTINGS_KEY, JSON.stringify(plannerSettings));
    } catch {
      // Speicher nicht verfuegbar — Einstellungen gelten dann nur fuer diese Sitzung.
    }
  }, [plannerSettings]);
  const [bulkStartTime, setBulkStartTime] = useState('');
  const [bulkEndTime, setBulkEndTime] = useState('');
  const [bulkServiceDate, setBulkServiceDate] = useState(getTodayIsoDate());
  const [isApplyingBulkPlan, setIsApplyingBulkPlan] = useState(false);
  const [bulkPlanError, setBulkPlanError] = useState('');
  const [bulkPlanSuccess, setBulkPlanSuccess] = useState('');
  const [drivers, setDrivers] = useState([]);
  const [loadingDrivers, setLoadingDrivers] = useState(true);
  const [driversError, setDriversError] = useState('');
  const [plannedRidesToday, setPlannedRidesToday] = useState([]);
  const [plannerDemandProfile, setPlannerDemandProfile] = useState(() => normalizeDemandProfile([]));
  const [isPlannerDemandCustomized, setIsPlannerDemandCustomized] = useState(false);
  const stableViewportHeightRef = useRef(window.innerHeight);
  const hasLoadedDriversRef = useRef(false);
  const preferredProfilesSelectRef = useRef('');
  const forcedResetDriverIdsRef = useRef(new Set());

  const gradientStyle = useMemo(
    () => ({
      background:
        'radial-gradient(ellipse 141.42% 102.21% at 0% 0%, #0048CF 0%, black 46%, black 84%, black 100%)',
    }),
    [],
  );

  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const root = document.getElementById('root');
    const previous = {
      html: html.style.overscrollBehavior,
      body: body.style.overscrollBehavior,
      root: root ? root.style.overscrollBehavior : '',
    };

    html.style.overscrollBehavior = 'none';
    body.style.overscrollBehavior = 'none';
    if (root) root.style.overscrollBehavior = 'none';

    return () => {
      html.style.overscrollBehavior = previous.html;
      body.style.overscrollBehavior = previous.body;
      if (root) root.style.overscrollBehavior = previous.root;
    };
  }, []);

  useEffect(() => {
    let isMounted = true;

    const mapRowsToDrivers = (rows = []) =>
      rows.map((row) => {
        const name = [row?.first_name, row?.last_name].filter(Boolean).join(' ').trim() || t('fahrer.noName');
        const vehiclePlate = row?.vehicles?.license_plate || '';
        const authRelationEmail =
          row?.auth_user?.email
          || row?.auth_users?.email
          || row?.user?.email
          || row?.users?.email
          || '';
        const id = String(row?.id || '').trim();
        return {
          id: id || '-',
          name,
          firstName: String(row?.first_name || '').trim(),
          lastName: String(row?.last_name || '').trim(),
          email: String(row?.email || authRelationEmail || '').trim(),
          vehicle: vehiclePlate,
          role: row?.role ?? null,
          is_dispo: row?.is_dispo ?? null,
          driverNumber: row?.driver_number ?? null,
          driverActivityState: row?.driver_activity_state ?? null,
          serviceStartTime: normalizeClockValue(row?.service_start_time),
          serviceEndTime: normalizeClockValue(row?.service_end_time),
          serviceStartDate: String(row?.service_start_date || '').trim(),
        };
      });

    const loadDrivers = async () => {
      if (!hasLoadedDriversRef.current) {
        setLoadingDrivers(true);
      }
      setDriversError('');

      if (!hasSupabaseConfig) {
        if (!isMounted) return;
        setDrivers([]);
        setDriversError(t('fahrer.supabaseNotConfigured'));
        setLoadingDrivers(false);
        return;
      }

      const selectWithOptionalAndEmail =
        'id, first_name, last_name, email, created_at, vehicle_id, role, is_dispo, driver_number, driver_activity_state, service_start_time, service_end_time, vehicles:vehicle_id(license_plate)';
      const selectWithOptionalWithoutEmail =
        'id, first_name, last_name, created_at, vehicle_id, role, is_dispo, driver_number, driver_activity_state, service_start_time, service_end_time, vehicles:vehicle_id(license_plate)';
      const selectBasicWithEmail =
        'id, first_name, last_name, email, created_at, vehicle_id, role, is_dispo, driver_number, vehicles:vehicle_id(license_plate)';
      const selectBasicWithoutEmail =
        'id, first_name, last_name, created_at, vehicle_id, role, is_dispo, driver_number, vehicles:vehicle_id(license_plate)';
      const candidatesBase = [
        selectWithOptionalAndEmail,
        selectWithOptionalWithoutEmail,
        selectBasicWithEmail,
        selectBasicWithoutEmail,
      ];
      const primaryClient = hasSupabaseAdminConfig ? supabaseAdmin : supabase;
      const fallbackClient = hasSupabaseAdminConfig ? supabase : supabaseAdmin;
      const candidates = preferredProfilesSelectRef.current
        ? [
            preferredProfilesSelectRef.current,
            ...candidatesBase.filter((entry) => entry !== preferredProfilesSelectRef.current),
          ]
        : candidatesBase;

      let primary = null;
      let successfulSelect = '';
      for (const selectClause of candidates) {
        let attempt = await primaryClient
          .from('profiles')
          .select(selectClause)
          .order('last_name', { ascending: true, nullsFirst: false })
          .order('first_name', { ascending: true, nullsFirst: false });
        if (attempt.error && ADMIN_FALLBACK_ERROR_RE.test(attempt.error.message || '')) {
          attempt = await fallbackClient
            .from('profiles')
            .select(selectClause)
            .order('last_name', { ascending: true, nullsFirst: false })
            .order('first_name', { ascending: true, nullsFirst: false });
        }
        if (!attempt.error) {
          primary = attempt;
          successfulSelect = selectClause;
          break;
        }
        primary = attempt;
      }

      if (!primary?.error) {
        if (!isMounted) return;
        preferredProfilesSelectRef.current = successfulSelect || preferredProfilesSelectRef.current;
        const mapped = mapRowsToDrivers(primary?.data || []);
        const driverIds = mapped.map((entry) => String(entry?.id || '').trim()).filter(Boolean);
        let latestPlanByDriver = new Map();
        if (driverIds.length > 0) {
          const planResult = await supabase
            .from('driver_service_requests')
            .select('driver_id,status,service_start_time,service_end_time,created_at')
            .in('driver_id', driverIds)
            .order('created_at', { ascending: false });
          if (!planResult.error && Array.isArray(planResult.data)) {
            latestPlanByDriver = new Map();
            planResult.data.forEach((entry) => {
              const driverId = String(entry?.driver_id || '').trim();
              if (!driverId || latestPlanByDriver.has(driverId)) return;
              latestPlanByDriver.set(driverId, {
                status: normalizePlanRequestStatus(entry?.status),
                serviceStartTime: normalizeClockValue(entry?.service_start_time),
                serviceEndTime: normalizeClockValue(entry?.service_end_time),
              });
            });
          } else if (planResult.error) {
            console.error('❌ driver_service_requests konnte nicht gelesen werden (AlleFahrer/Admin):', planResult.error);
          }
        }
        const mappedWithPlanStatus = mapped.map((entry) => {
          const plan = latestPlanByDriver.get(String(entry?.id || '').trim());
          const entryId = String(entry?.id || '').trim();
          const isForcedResetDriver = forcedResetDriverIdsRef.current.has(entryId);
          return {
            ...entry,
            planRequestStatus: isForcedResetDriver ? '' : (plan?.status || ''),
            // Zeiten in Admin "Alle Fahrer" kommen immer direkt aus profiles.
            // Requests liefern nur Status-Farbe (pending/accepted/refused), nicht die angezeigten Uhrzeiten.
            serviceStartTime: isForcedResetDriver ? '' : entry.serviceStartTime,
            serviceEndTime: isForcedResetDriver ? '' : entry.serviceEndTime,
          };
        });
        setDrivers(mappedWithPlanStatus);

        // Planungshorizont: heute bis übermorgen (wischbare Zeitachse)
        const todayIso = getTodayIsoDate();
        const horizonEndIso = addDaysToIsoDate(todayIso, PLANNING_HORIZON_DAYS - 1);
        const plannedRidesResult = await supabase
          .from('jobs')
          .select('id, ride_date, etd, status, pickup_name, pickup_address, dropoff_name, dropoff_address, ext_route_duration_mins, ext_route_duration_in_traffic_mins')
          .gte('ride_date', todayIso)
          .lte('ride_date', horizonEndIso);
        if (!plannedRidesResult.error && Array.isArray(plannedRidesResult.data) && plannedRidesResult.data.length > 0) {
          setPlannedRidesToday(plannedRidesResult.data);
        } else if (!DEMO_MODE) {
          // Im Betrieb gilt der echte Zeitraum, auch wenn er leer ist.
          setPlannedRidesToday([]);
        } else {
          // Demo-Vorschau: liegt am heutigen Tag keine Fahrt vor, zeigt die
          // Planung den fahrtenstärksten Tag des simulierten Einsatzes –
          // dieselbe Quelle nutzt auch der KI Planer.
          const allJobsResult = await supabase
            .from('jobs')
            .select('id, ride_date, etd, status, pickup_name, pickup_address, dropoff_name, dropoff_address, ext_route_duration_mins, ext_route_duration_in_traffic_mins');
          setPlannedRidesToday(pickBusiestDayRides(allJobsResult?.data));
        }

        hasLoadedDriversRef.current = true;
        setLoadingDrivers(false);
        return;
      }

      const wrongKey = /no suitable key|wrong key type|jwt|invalid api key|unauthorized/i.test(primary?.error?.message || '');
      if (wrongKey) {
        if (!isMounted) return;
        if (!hasLoadedDriversRef.current) {
          setDrivers([]);
        }
        setDriversError(t('fahrer.supabaseKeyInvalid'));
        setLoadingDrivers(false);
        return;
      }

      if (!isMounted) return;
      if (!hasLoadedDriversRef.current) {
        setDrivers([]);
      }
      const schemaMaybeMissing = /vehicle_id|license_plate|driver_number|driver_activity_state|service_start_time|service_end_time|relation .*vehicles|column .*is_dispo|column .*role/i.test(primary?.error?.message || '');
      setDriversError(
        schemaMaybeMissing
          ? t('fahrer.schemaIncomplete', { sql: MISSING_SCHEMA_SQL })
          : primary?.error?.message || t('fahrer.loadFailed'),
      );
      setLoadingDrivers(false);
    };

    loadDrivers();
    const handleDriversReload = () => {
      loadDrivers();
    };
    window.addEventListener(DRIVERS_RELOAD_EVENT, handleDriversReload);
    return () => {
      isMounted = false;
      window.removeEventListener(DRIVERS_RELOAD_EVENT, handleDriversReload);
    };
  }, []);

  useEffect(() => {
    if (!hasSupabaseConfig) return undefined;
    let isDisposed = false;
    let driversChannel = null;
    let refreshTimerId = null;
    let reconnectTimerId = null;
    let reconnectAttempts = 0;
    let isConnecting = false;

    const clearReconnectTimer = () => {
      if (reconnectTimerId) {
        window.clearTimeout(reconnectTimerId);
        reconnectTimerId = null;
      }
    };

    const clearRefreshTimer = () => {
      if (refreshTimerId) {
        window.clearTimeout(refreshTimerId);
        refreshTimerId = null;
      }
    };

    const scheduleDriversRefresh = (delayMs = 120) => {
      if (delayMs <= 0) {
        window.dispatchEvent(new Event(DRIVERS_RELOAD_EVENT));
        return;
      }
      clearRefreshTimer();
      refreshTimerId = window.setTimeout(() => {
        refreshTimerId = null;
        window.dispatchEvent(new Event(DRIVERS_RELOAD_EVENT));
      }, delayMs);
    };

    const cleanupChannel = () => {
      const channel = driversChannel;
      driversChannel = null;
      if (!channel) return;
      try {
        supabase.removeChannel(channel);
      } catch (error) {
        console.warn('⚠️ Drivers channel cleanup fehlgeschlagen:', error);
      }
    };

    const scheduleReconnect = () => {
      if (isDisposed) return;
      if (reconnectTimerId) return;
      const nextDelayMs = Math.min(5000, 500 * (2 ** reconnectAttempts));
      reconnectAttempts += 1;
      reconnectTimerId = window.setTimeout(() => {
        reconnectTimerId = null;
        connectRealtime();
      }, nextDelayMs);
    };

    const connectRealtime = async () => {
      if (isDisposed || isConnecting) return;
      isConnecting = true;
      cleanupChannel();
      try {
        await ensureDriversRealtimeSession();
        if (isDisposed) return;

        const onRealtimeChange = () => {
          scheduleDriversRefresh(0);
        };

        driversChannel = supabase
          .channel(`admin-drivers-live-${Date.now()}`)
          .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, onRealtimeChange)
          .on('postgres_changes', { event: '*', schema: 'public', table: 'vehicles' }, onRealtimeChange)
          .on('postgres_changes', { event: '*', schema: 'public', table: 'jobs' }, onRealtimeChange)
          .on('postgres_changes', { event: '*', schema: 'public', table: 'driver_service_requests' }, onRealtimeChange)
          .subscribe((status) => {
            if (isDisposed) return;
            if (status === 'SUBSCRIBED') {
              reconnectAttempts = 0;
              clearReconnectTimer();
              scheduleDriversRefresh(0);
              return;
            }
            if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
              scheduleDriversRefresh(0);
              cleanupChannel();
              scheduleReconnect();
            }
          });
      } catch (error) {
        if (!isDisposed) {
          console.error('❌ Fahrer-Realtime initialisieren fehlgeschlagen:', error);
          scheduleReconnect();
        }
      } finally {
        isConnecting = false;
      }
    };

    connectRealtime();

    const pollId = window.setInterval(() => {
      scheduleDriversRefresh(0);
    }, 60000);

    const handleVisibilityReload = () => {
      if (!document.hidden) {
        scheduleDriversRefresh(0);
        if (!driversChannel) connectRealtime();
      }
    };
    const handleFocusReload = () => {
      scheduleDriversRefresh(0);
      if (!driversChannel) connectRealtime();
    };
    document.addEventListener('visibilitychange', handleVisibilityReload);
    window.addEventListener('focus', handleFocusReload);

    return () => {
      window.clearInterval(pollId);
      document.removeEventListener('visibilitychange', handleVisibilityReload);
      window.removeEventListener('focus', handleFocusReload);
      clearReconnectTimer();
      clearRefreshTimer();
      isDisposed = true;
      cleanupChannel();
    };
  }, []);

  useEffect(() => {
    const onResize = () => setIsCompactDevice(window.matchMedia('(max-width: 1024px)').matches);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) {
      return undefined;
    }

    const updateKeyboardState = () => {
      const baseLayoutHeight = stableViewportHeightRef.current;
      const viewportBottom = viewport.height + viewport.offsetTop;
      const nextInset = Math.max(0, baseLayoutHeight - viewportBottom);
      setKeyboardInset(nextInset);

      if (nextInset < 40 && !isSearchFocused) {
        stableViewportHeightRef.current = window.innerHeight;
      }

      if (isSearchFocused) {
        window.scrollTo(0, 0);
      }
    };

    updateKeyboardState();
    viewport.addEventListener('resize', updateKeyboardState);
    viewport.addEventListener('scroll', updateKeyboardState);
    return () => {
      viewport.removeEventListener('resize', updateKeyboardState);
      viewport.removeEventListener('scroll', updateKeyboardState);
    };
  }, [isSearchFocused]);

  const visibleDrivers = useMemo(() => {
    const collator = new Intl.Collator('de', { sensitivity: 'base' });
    const base = drivers.filter((row) => {
      const role = String(row.role || '').trim().toLowerCase();
      const isDispoRole = ['dispo', 'dispatcher', 'admin', 'koordinator', 'coordinator'].includes(role);
      if (row.is_dispo === true) return false;
      if (isDispoRole) return false;
      return true;
    });

    return [...base].sort((a, b) => {
      const byLast = collator.compare(String(a.lastName || ''), String(b.lastName || ''));
      if (byLast !== 0) return byLast;
      return collator.compare(String(a.firstName || ''), String(b.firstName || ''));
    });
  }, [drivers]);

  const visibleDriversWithState = useMemo(
    () =>
      visibleDrivers.map((driver) => ({
        ...driver,
        activityState: normalizeDriverState(driver?.driverActivityState, driver?.role),
        isIncomplete: isDriverIncomplete(driver),
        isInServiceNow: isDriverInServiceNow(driver),
      })),
    [visibleDrivers],
  );

  const filteredDrivers = useMemo(() => {
    const rawSearch = String(searchTerm || '');
    const rawParts = rawSearch.split(';');
    const endsWithSemicolon = rawSearch.trimEnd().endsWith(';');
    const searchTerms = rawParts
      .map((rawPart, index) => {
        const term = String(rawPart || '').trim().toLowerCase();
        if (!term) return null;
        const hasTerminatingSemicolon = index < rawParts.length - 1 || endsWithSemicolon;
        return {
          term,
          strictNumeric: /^\d+$/.test(term) && hasTerminatingSemicolon,
        };
      })
      .filter(Boolean);

    const getTermScore = (driver, { term, strictNumeric }) => {
      const name = String(driver.name || '').toLowerCase();
      const vehicle = String(driver.vehicle || '').toLowerCase();
      const driverNumber = String(driver.driverNumber || '');

      if (strictNumeric) {
        return driverNumber === term ? 1000 : -1;
      }

      if (name === term) return 920;
      if (name.startsWith(term)) return 860;
      if (driverNumber === term) return 820;
      if (driverNumber.startsWith(term)) return 780;
      if (name.includes(term)) return 730;
      if (driverNumber.includes(term)) return 700;
      if (vehicle.startsWith(term)) return 640;
      if (vehicle.includes(term)) return 600;
      return -1;
    };

    const bySearch = searchTerms.length === 0
      ? visibleDriversWithState
      : visibleDriversWithState
          .map((driver, index) => {
            const scores = searchTerms
              .map((entry) => getTermScore(driver, entry))
              .filter((score) => score >= 0);
            if (scores.length === 0) return null;
            const bestScore = Math.max(...scores);
            const totalScore = bestScore + (scores.length - 1) * 10;
            return { driver, index, totalScore };
          })
          .filter(Boolean)
          .sort((a, b) => {
            if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore;
            return a.index - b.index;
          })
          .map((entry) => entry.driver);

    const byStatus = bySearch.filter((driver) => {
      if (statusFilter === STATUS_FILTER_ALL) return true;
      if (statusFilter === STATUS_FILTER_ON_DUTY) return driver.isInServiceNow === true;
      if (statusFilter === STATUS_FILTER_FREE_NOW) return driver.isInServiceNow === false && driver.isIncomplete !== true;
      if (statusFilter === STATUS_FILTER_INCOMPLETE) return driver.isIncomplete === true;
      return true;
    });

    return byStatus.filter((driver) => {
      if (!startTimeFilter && !endTimeFilter) return true;

      const driverStartMinutes = clockToMinutes(driver.serviceStartTime);
      const driverEndMinutes = clockToMinutes(driver.serviceEndTime);
      if (driverStartMinutes == null || driverEndMinutes == null) return false;

      // Absolutes Zeitfenster aus Datum + Uhrzeit (Minuten seit heute 00:00),
      // damit auch Fenster über Mitternacht funktionieren (17.08. 18:00 – 18.08. 02:00).
      // Die Schicht wird auf den Tag des Start-Filters gelegt; endet sie
      // uhrzeitlich vor ihrem Beginn, läuft sie in den Folgetag.
      const filterStartMinutes = clockToMinutes(startTimeFilter);
      const filterEndMinutes = clockToMinutes(endTimeFilter);
      const startDayOffset = dayOffsetFromToday(startDateFilter) ?? 0;
      const endDayOffset = dayOffsetFromToday(endDateFilter) ?? startDayOffset;

      const shiftStartAbs = startDayOffset * 1440 + driverStartMinutes;
      const shiftDuration = driverEndMinutes >= driverStartMinutes
        ? driverEndMinutes - driverStartMinutes
        : 1440 - driverStartMinutes + driverEndMinutes;
      const shiftEndAbs = shiftStartAbs + shiftDuration;

      if (filterStartMinutes != null) {
        const windowStartAbs = startDayOffset * 1440 + filterStartMinutes;
        if (shiftStartAbs < windowStartAbs) return false;
      }
      if (filterEndMinutes != null) {
        const windowEndAbs = endDayOffset * 1440 + filterEndMinutes;
        if (shiftEndAbs > windowEndAbs) return false;
      }
      return true;
    });
  }, [searchTerm, statusFilter, startTimeFilter, endTimeFilter, startDateFilter, endDateFilter, visibleDriversWithState]);

  const selectedDriverIdsSet = useMemo(() => new Set(selectedDriverIds), [selectedDriverIds]);
  const selectedDriversCount = selectedDriverIds.length;

  // 72h-Zeitachse (heute 00:00 bis übermorgen 24:00) für das wischbare Chart.
  // Fahrer-Schichten sind Uhrzeiten und wiederholen sich täglich.
  const [chartViewStartHour, setChartViewStartHour] = useState(CHART_START_HOUR);

  const supplyByAbsHour = useMemo(() => {
    const counts = Array.from({ length: PLANNING_HORIZON_HOURS }, () => 0);
    const todayIsoDate = getTodayIsoDate();
    visibleDriversWithState.forEach((driver) => {
      const startMinutes = clockToMinutes(driver?.serviceStartTime);
      const endMinutes = clockToMinutes(driver?.serviceEndTime);
      if (startMinutes == null || endMinutes == null) return;
      const segments = buildDailySegments(startMinutes, endMinutes);
      // Schicht mit Datum zählt nur an ihrem Tag; ohne Datum (manuell
      // gepflegte Zeiten) wie bisher an allen Tagen des Horizonts.
      const shiftDate = String(driver?.serviceStartDate || '').trim();
      for (let day = 0; day < PLANNING_HORIZON_DAYS; day += 1) {
        if (shiftDate && shiftDate !== addDaysToIsoDate(todayIsoDate, day)) continue;
        for (let hour = 0; hour < 24; hour += 1) {
          const hourStart = hour * 60;
          const hourEnd = Math.min(1439, hourStart + 59);
          const worksInHour = segments.some(([segmentStart, segmentEnd]) => Math.max(segmentStart, hourStart) <= Math.min(segmentEnd, hourEnd));
          if (worksInHour) counts[day * 24 + hour] += 1;
        }
      }
    });
    return counts;
  }, [visibleDriversWithState]);

  const ridesByAbsHour = useMemo(() => {
    const counts = Array.from({ length: PLANNING_HORIZON_HOURS }, () => 0);
    const excludedStatuses = new Set(['done', 'completed', 'arrived', 'archived', 'cancelled', 'canceled', 'refused', 'rejected']);
    plannedRidesToday.forEach((ride) => {
      const status = String(ride?.status || '').trim().toLowerCase();
      if (excludedStatuses.has(status)) return;
      const dayOffset = dayOffsetFromToday(ride?.ride_date);
      if (dayOffset == null || dayOffset < 0 || dayOffset >= PLANNING_HORIZON_DAYS) return;
      const match = String(ride?.etd || '').trim().match(/^(\d{1,2}):(\d{2})/);
      if (!match) return;
      const hour = Number.parseInt(match[1], 10);
      if (!Number.isFinite(hour) || hour < 0 || hour > 23) return;
      counts[dayOffset * 24 + hour] += 1;
    });
    return counts;
  }, [plannedRidesToday]);

  const demandByAbsHour = useMemo(
    () => computeDemandCurve(supplyByAbsHour, ridesByAbsHour),
    [supplyByAbsHour, ridesByAbsHour],
  );

  // Planungstag = Tag, in dem die Mitte des sichtbaren Chart-Fensters liegt.
  const planningDayIndex = useMemo(
    () => Math.max(0, Math.min(PLANNING_HORIZON_DAYS - 1, Math.floor((chartViewStartHour + CHART_HOURS.length / 2) / 24))),
    [chartViewStartHour],
  );
  const planningDayIso = useMemo(() => addDaysToIsoDate(getTodayIsoDate(), planningDayIndex), [planningDayIndex]);
  const ridesOfPlanningDay = useMemo(
    () => plannedRidesToday.filter((ride) => String(ride?.ride_date || '').trim() === planningDayIso),
    [plannedRidesToday, planningDayIso],
  );

  const hourlyDriverCounts = useMemo(
    () => CHART_HOURS.map((hour) => supplyByAbsHour[planningDayIndex * 24 + hour] || 0),
    [supplyByAbsHour, planningDayIndex],
  );

  const hourlyPlannedRideCounts = useMemo(() => {
    const counts = CHART_HOURS.map(() => 0);
    const excludedStatuses = new Set(['done', 'completed', 'arrived', 'archived', 'cancelled', 'canceled', 'refused', 'rejected']);
    ridesOfPlanningDay.forEach((ride) => {
      const status = String(ride?.status || '').trim().toLowerCase();
      if (excludedStatuses.has(status)) return;
      const match = String(ride?.etd || '').trim().match(/^(\d{1,2}):(\d{2})/);
      if (!match) return;
      const hour = Number.parseInt(match[1], 10);
      if (!Number.isFinite(hour) || hour < CHART_START_HOUR || hour > CHART_END_HOUR) return;
      counts[hour - CHART_START_HOUR] += 1;
    });
    return counts;
  }, [ridesOfPlanningDay]);

  useEffect(() => {
    if (isPlannerDemandCustomized) return;
    // Gleiche Bedarfsformel wie im KI Planer, damit beide Charts übereinstimmen
    setPlannerDemandProfile(normalizeDemandProfile(computeDemandCurve(hourlyDriverCounts, hourlyPlannedRideCounts)));
  }, [hourlyDriverCounts, hourlyPlannedRideCounts, isPlannerDemandCustomized]);

  const clearSelection = () => {
    setSelectedDriverIds([]);
  };

  // Demo-Tutorial: eine Auswahl aus einem frueheren Durchlauf leeren, ohne die
  // Ansicht zu verlassen — der Finger soll nie springen, sondern immer gehen.
  useEffect(() => {
    const anZustand = (event) => {
      if (event?.detail?.fahrerAuswahlLeeren !== true) return;
      setSelectedDriverIds([]);
      setIsSelectionMode(false);
      setIsBulkPlannerOpen(false);
    };
    window.addEventListener('trisar:tutorial-zustand', anZustand);
    return () => window.removeEventListener('trisar:tutorial-zustand', anZustand);
  }, []);

  const toggleDriverSelection = (driverId) => {
    if (!driverId) return;
    setSelectedDriverIds((prev) => (prev.includes(driverId) ? prev.filter((id) => id !== driverId) : [...prev, driverId]));
    setBulkPlanSuccess('');
    setBulkPlanError('');
  };

  useEffect(() => {
    try {
      const normalized = Array.from(
        new Set((selectedDriverIds || []).map((id) => String(id || '').trim()).filter(Boolean)),
      );
      sessionStorage.setItem(SELECTED_DRIVERS_STORAGE_KEY, JSON.stringify(normalized));
    } catch {
      // Ignore storage errors silently
    }
  }, [selectedDriverIds]);

  const handleNavigateToMap = () => {
    const normalizedSelectedIds = Array.from(
      new Set((selectedDriverIds || []).map((id) => String(id || '').trim()).filter(Boolean)),
    );
    const selectedNames = visibleDriversWithState
      .filter((driver) => normalizedSelectedIds.includes(String(driver?.id || '').trim()))
      .map((driver) => String(driver?.name || '').trim())
      .filter(Boolean);
    if (typeof onNavigateToMapWithDrivers === 'function') {
      onNavigateToMapWithDrivers(normalizedSelectedIds, selectedNames);
      return;
    }
    setView('karten');
  };

  const selectAllFilteredDrivers = () => {
    const ids = filteredDrivers.map((driver) => driver.id).filter(Boolean);
    setSelectedDriverIds(ids);
    setBulkPlanSuccess('');
    setBulkPlanError('');
  };

  const applyBulkPlanning = async () => {
    setBulkPlanError('');
    setBulkPlanSuccess('');

    if (selectedDriverIds.length === 0) {
      setBulkPlanError(t('fahrer.selectAtLeastOne'));
      return;
    }

    const nextStart = normalizeClockValue(bulkStartTime);
    const nextEnd = normalizeClockValue(bulkEndTime);
    const nextDate = String(bulkServiceDate || '').trim();
    const hasStart = Boolean(nextStart);
    const hasEnd = Boolean(nextEnd);
    const isResetRequest = !hasStart && !hasEnd;
    console.log('🧪 applyBulkPlanning debug:', {
      selectedDriverIds,
      bulkStartTime,
      bulkEndTime,
      normalizedStart: nextStart,
      normalizedEnd: nextEnd,
      isResetRequest,
      bulkServiceDate,
    });
    const hasValidDate = /^\d{4}-\d{2}-\d{2}$/.test(nextDate);
    if (!isResetRequest && !hasValidDate) {
      setBulkPlanError(t('fahrer.setValidDate'));
      return;
    }
    const effectiveDate = hasValidDate ? nextDate : getTodayIsoDate();

    if (!hasSupabaseConfig) {
      setBulkPlanError(t('fahrer.supabaseNotConfiguredTimes'));
      return;
    }

    setIsApplyingBulkPlan(true);
    try {
      const writeClient = hasSupabaseAdminConfig ? supabaseAdmin : supabase;
      const targetDriverIds = selectedDriverIds
        .map((driverId) => String(driverId || '').trim())
        .filter(Boolean);

      if (!isResetRequest) {
        const requestRows = targetDriverIds
          .map((driverId) => ({
            driver_id: driverId,
            service_date: effectiveDate,
            service_start_time: hasStart ? nextStart : null,
            service_end_time: hasEnd ? nextEnd : null,
            status: 'pending',
            requested_by: 'admin-app',
          }));

        const { error } = await writeClient
          .from('driver_service_requests')
          .insert(requestRows);

        if (error) {
          const schemaMaybeMissing = /service_start_time|service_end_time|service_date|driver_service_requests/i.test(error.message || '');
          setBulkPlanError(
            schemaMaybeMissing
              ? t('fahrer.schemaIncomplete', { sql: MISSING_SCHEMA_SQL })
              : error.message || t('fahrer.requestsSaveFailed'),
          );
          return;
        }
      }

      let profileUpdateError = null;
      const profileUpdatePayload = isResetRequest
        ? {
            service_start_time: null,
            service_end_time: null,
            service_start_date: null,
            service_end_date: null,
          }
        : {
            ...(hasStart ? { service_start_time: nextStart, service_start_date: effectiveDate } : {}),
            ...(hasEnd ? { service_end_time: nextEnd, service_end_date: effectiveDate } : {}),
          };
      const profileUpdateWithDates = await writeClient
        .from('profiles')
        .update(profileUpdatePayload)
        .in('id', targetDriverIds);
      if (profileUpdateWithDates.error) {
        const fallbackWithoutDatesPayload = isResetRequest
          ? {
              service_start_time: null,
              service_end_time: null,
            }
          : {
              ...(hasStart ? { service_start_time: nextStart } : {}),
              ...(hasEnd ? { service_end_time: nextEnd } : {}),
            };
        const fallbackWithoutDates = await writeClient
          .from('profiles')
          .update(fallbackWithoutDatesPayload)
          .in('id', targetDriverIds);
        profileUpdateError = fallbackWithoutDates.error;
      }
      if (profileUpdateError) {
        const schemaMaybeMissing = /service_start_time|service_end_time|service_start_date|service_end_date|profiles/i.test(
          profileUpdateError.message || '',
        );
        setBulkPlanError(
          schemaMaybeMissing
            ? t('fahrer.profilesSchemaCheck', { sql: MISSING_SCHEMA_SQL })
            : profileUpdateError.message || t('fahrer.profileUpdateFailedAfterSave'),
        );
        return;
      }

      if (isResetRequest) {
        targetDriverIds.forEach((driverId) => forcedResetDriverIdsRef.current.add(driverId));
        const verifyResetResult = await writeClient
          .from('profiles')
          .select('id,service_start_time,service_end_time')
          .in('id', targetDriverIds);
        console.log('🧪 reset verify profiles:', verifyResetResult?.data || [], verifyResetResult?.error || null);
        window.setTimeout(async () => {
          try {
            const delayedVerify = await writeClient
              .from('profiles')
              .select('id,service_start_time,service_end_time')
              .in('id', targetDriverIds);
            console.log('🧪 reset verify profiles (delayed +2s):', delayedVerify?.data || [], delayedVerify?.error || null);
          } catch (error) {
            console.log('🧪 reset verify profiles (delayed +2s) failed:', error);
          }
        }, 2000);
        setDrivers((prev) =>
          (prev || []).map((driver) => {
            const driverId = String(driver?.id || '').trim();
            if (!targetDriverIds.includes(driverId)) return driver;
            return {
              ...driver,
              serviceStartTime: '',
              serviceEndTime: '',
              planRequestStatus: '',
            };
          }),
        );
        setBulkPlanSuccess(t('fahrer.planResetSuccess', { n: selectedDriverIds.length }));
      } else if (hasStart && hasEnd) {
        targetDriverIds.forEach((driverId) => forcedResetDriverIdsRef.current.delete(driverId));
        setBulkPlanSuccess(t('fahrer.planRequestsSent', { n: selectedDriverIds.length }));
      } else if (hasStart) {
        targetDriverIds.forEach((driverId) => forcedResetDriverIdsRef.current.delete(driverId));
        setBulkPlanSuccess(t('fahrer.startRequestsSent', { n: selectedDriverIds.length }));
      } else {
        targetDriverIds.forEach((driverId) => forcedResetDriverIdsRef.current.delete(driverId));
        setBulkPlanSuccess(t('fahrer.endRequestsSent', { n: selectedDriverIds.length }));
      }
      window.dispatchEvent(new Event(DRIVERS_RELOAD_EVENT));
      setIsSelectionMode(false);
      clearSelection();
      setIsBulkPlannerOpen(false);
    } finally {
      setIsApplyingBulkPlan(false);
    }
  };

  // `allowEmpty`: beim Zuruecknehmen der letzten Uebernahme bleibt keine Zeile
  // uebrig — dann soll die Tagesplanung geleert und die Fahrerprofile
  // zurueckgesetzt werden, statt mit einem Fehler abzubrechen.
  const applyAiPlannerSuggestions = async ({ serviceDate, rows, allowEmpty = false }) => {
    const targetRows = (Array.isArray(rows) ? rows : [])
      .map((row) => ({
        driverId: String(row?.driverId || '').trim(),
        serviceStart: normalizeClockValue(row?.serviceStart),
        serviceEnd: normalizeClockValue(row?.serviceEnd),
        // TRISAR-Engine: Fahrten und Fahrzeug des Dienstes (fehlt beim alten Planer)
        rideIds: (Array.isArray(row?.rideIds) ? row.rideIds : []).map((id) => String(id || '').trim()).filter(Boolean),
        vehicleId: String(row?.vehicleId || '').trim(),
      }))
      .filter((row) => row.driverId && row.serviceStart && row.serviceEnd);

    if (targetRows.length === 0 && !allowEmpty) {
      return { ok: false, error: t('fahrer.noValidSuggestions') };
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(serviceDate || '').trim())) {
      return { ok: false, error: t('fahrer.chooseValidDate') };
    }
    if (!hasSupabaseConfig) {
      return { ok: false, error: t('fahrer.supabaseNotConfiguredShort') };
    }

    const writeClient = hasSupabaseAdminConfig ? supabaseAdmin : supabase;
    try {
      const targetDriverIds = Array.from(new Set(targetRows.map((row) => row.driverId)));
      const previousAiPlanResult = await writeClient
        .from('driver_service_requests')
        .select('driver_id')
        .eq('service_date', serviceDate)
        .eq('requested_by', 'admin-app-ai-planner');
      const previousAiDriverIds = !previousAiPlanResult.error && Array.isArray(previousAiPlanResult.data)
        ? Array.from(
            new Set(
              previousAiPlanResult.data
                .map((row) => String(row?.driver_id || '').trim())
                .filter(Boolean),
            ),
          )
        : [];

      let cleanupAiPlanResult = await writeClient
        .from('driver_service_requests')
        .delete()
        .eq('service_date', serviceDate)
        .eq('requested_by', 'admin-app-ai-planner');
      if (cleanupAiPlanResult.error) {
        cleanupAiPlanResult = await writeClient
          .from('driver_service_requests')
          .update({
            status: 'cancelled',
            updated_at: new Date().toISOString(),
          })
          .eq('service_date', serviceDate)
          .eq('requested_by', 'admin-app-ai-planner');
      }
      if (cleanupAiPlanResult.error) {
        return {
          ok: false,
          error: cleanupAiPlanResult.error.message || t('fahrer.aiPlanOverwriteFailed'),
        };
      }

      if (targetDriverIds.length > 0) {
        let cleanupTargetRequestsResult = await writeClient
          .from('driver_service_requests')
          .delete()
          .eq('service_date', serviceDate)
          .in('driver_id', targetDriverIds);
        if (cleanupTargetRequestsResult.error) {
          cleanupTargetRequestsResult = await writeClient
            .from('driver_service_requests')
            .update({
              status: 'cancelled',
              updated_at: new Date().toISOString(),
            })
            .eq('service_date', serviceDate)
            .in('driver_id', targetDriverIds);
        }
        if (cleanupTargetRequestsResult.error) {
          return {
            ok: false,
            error: cleanupTargetRequestsResult.error.message || t('fahrer.planOverwriteFailed'),
          };
        }
      }

      const requestRows = targetRows.map((row) => ({
        driver_id: row.driverId,
        service_date: serviceDate,
        service_start_time: row.serviceStart,
        service_end_time: row.serviceEnd,
        status: 'pending',
        requested_by: 'admin-app-ai-planner',
      }));

      const requestInsert = requestRows.length > 0
        ? await writeClient.from('driver_service_requests').insert(requestRows)
        : { error: null };
      if (requestInsert.error) {
        const schemaMaybeMissing = /service_start_time|service_end_time|service_date|driver_service_requests/i.test(requestInsert.error.message || '');
        return {
          ok: false,
          error: schemaMaybeMissing
            ? t('fahrer.schemaIncomplete', { sql: MISSING_SCHEMA_SQL })
            : requestInsert.error.message || t('fahrer.requestsSaveFailed'),
        };
      }

      for (const row of targetRows) {
        const withDates = await writeClient
          .from('profiles')
          .update({
            service_start_time: row.serviceStart,
            service_end_time: row.serviceEnd,
            service_start_date: serviceDate,
            service_end_date: serviceDate,
          })
          .eq('id', row.driverId);
        if (!withDates.error) continue;

        const withoutDates = await writeClient
          .from('profiles')
          .update({
            service_start_time: row.serviceStart,
            service_end_time: row.serviceEnd,
          })
          .eq('id', row.driverId);
        if (withoutDates.error) {
          return {
            ok: false,
            error: withoutDates.error.message || t('fahrer.profileUpdateFailed'),
          };
        }
      }

      const staleDriverIds = previousAiDriverIds.filter((driverId) => !targetDriverIds.includes(driverId));
      if (staleDriverIds.length > 0) {
        let resetStaleProfilesResult = await writeClient
          .from('profiles')
          .update({
            service_start_time: null,
            service_end_time: null,
            service_start_date: null,
            service_end_date: null,
          })
          .in('id', staleDriverIds);
        if (resetStaleProfilesResult.error) {
          resetStaleProfilesResult = await writeClient
            .from('profiles')
            .update({
              service_start_time: null,
              service_end_time: null,
            })
            .in('id', staleDriverIds);
        }
        if (resetStaleProfilesResult.error) {
          return {
            ok: false,
            error: resetStaleProfilesResult.error.message || t('fahrer.timesResetFailed'),
          };
        }
        staleDriverIds.forEach((driverId) => forcedResetDriverIdsRef.current.add(driverId));
      }

      // Fahrten an Fahrer und Fahrzeug vergeben. Fruehere Vergaben des Planers an
      // diesem Tag, die nicht mehr im Plan stehen, werden wieder geoeffnet.
      const geplanteFahrten = new Set(targetRows.flatMap((row) => row.rideIds));
      const fruehere = await writeClient
        .from('jobs')
        .select('id')
        .eq('ride_date', serviceDate)
        .eq('assigned_by', 'trisar-engine');
      const zuOeffnen = (!fruehere.error && Array.isArray(fruehere.data) ? fruehere.data : [])
        .map((job) => String(job?.id || '')).filter((id) => id && !geplanteFahrten.has(id));
      if (zuOeffnen.length > 0) {
        await writeClient.from('jobs')
          .update({ driver_id: null, vehicle_id: null, status: 'pending', assigned_by: null })
          .in('id', zuOeffnen);
      }
      for (const row of targetRows) {
        if (!row.rideIds.length) continue;
        const vergabe = { driver_id: row.driverId, status: 'assigned', assigned_by: 'trisar-engine' };
        if (row.vehicleId) vergabe.vehicle_id = row.vehicleId;
        // eslint-disable-next-line no-await-in-loop
        const jobUpdate = await writeClient.from('jobs').update(vergabe).in('id', row.rideIds);
        if (jobUpdate.error) {
          return { ok: false, error: jobUpdate.error.message || t('fahrer.aiPlanSaveFailed') };
        }
      }

      targetRows.forEach((row) => forcedResetDriverIdsRef.current.delete(row.driverId));
      window.dispatchEvent(new Event(DRIVERS_RELOAD_EVENT));
      // Fahrtenliste in App.jsx neu laden (die Demo-Datenbank meldet keine Live-Aenderungen).
      window.dispatchEvent(new CustomEvent('trisar:fahrten-geaendert'));
      return { ok: true, message: t('fahrer.aiPlanSaved', { n: targetRows.length }) };
    } catch (error) {
      return { ok: false, error: error?.message || t('fahrer.aiPlanSaveFailed') };
    }
  };

  const cardsStartTop = LAYOUT_GRID.cardsTop;
  const cardStep = LAYOUT_GRID.cardStep;
  const calculatedContentHeight = Math.max(1364, cardsStartTop + Math.max(filteredDrivers.length, 1) * cardStep + 220);
  const isMobileKeyboardMode = isCompactDevice && isSearchFocused && keyboardInset > 80;
  const hasSearchTerm = searchTerm.trim().length > 0;

  return (
    <div className="w-[min(402px,100vw)] h-dvh relative mx-auto overflow-hidden overscroll-none" style={gradientStyle}>
      <div className="h-full overflow-y-auto overflow-x-hidden overscroll-none">
        <div className="relative" style={{ minHeight: `${calculatedContentHeight}px` }}>
          <div className="absolute left-[20px] top-[60px]">
            <BackCircleButton onClick={() => setView('list')} marker="fahrer-zurueck" />
          </div>

          <div data-tutorial="fahrer-liste" className="absolute text-[#E3F654] text-[42px] leading-[42px] font-bold font-['Space_Grotesk']" style={{ left: `${LAYOUT_GRID.contentLeft}px`, top: `${LAYOUT_GRID.titleTop}px` }}>
            {t('fahrer.title')}
          </div>

          <PlanningOverviewChart
            supplySeries={supplyByAbsHour}
            ridesSeries={ridesByAbsHour}
            demandSeries={demandByAbsHour}
            viewStart={chartViewStartHour}
            onViewStartChange={setChartViewStartHour}
            onOpenAiPlanner={() => setIsAiPlannerOpen(true)}
          />

          <div
            className="absolute h-[56px] border-2 border-yellow-300 overflow-hidden"
            style={{ width: `${LAYOUT_GRID.contentWidth}px`, left: `${LAYOUT_GRID.contentLeft}px`, top: `${LAYOUT_GRID.searchTop}px` }}
          >
            <div className="relative w-full h-full flex items-center px-[12px]">
              <span className="shrink-0 text-base leading-6 tracking-wide text-yellow-300/60 font-medium font-['Space_Grotesk']">
                {isSearchFocused || searchTerm.trim().length > 0 ? t('fahrer.driversLabel') : t('fahrer.searchPlaceholder')}
              </span>
              <input
                value={searchTerm}
                data-tutorial="fahrer-suche"
                onChange={(event) => setSearchTerm(event.target.value)}
                onFocus={() => setIsSearchFocused(true)}
                onBlur={() => setIsSearchFocused(false)}
                className="flex-1 h-full ml-3 pr-9 py-0 bg-transparent border-none outline-none text-yellow-300/85 text-base font-medium font-['Space_Grotesk'] leading-6 tracking-wide"
              />
              <div className="absolute right-[12px] top-1/2 -translate-y-1/2">
                {hasSearchTerm ? (
                  <button
                    type="button"
                    onClick={() => setSearchTerm('')}
                    aria-label={t('fahrer.resetSearch')}
                    className="w-6 h-6 flex items-center justify-center"
                  >
                    <img src="/icon/_Icon_Green/clear-field-green.svg" alt="" className="w-5 h-5" />
                  </button>
                ) : (
                  <img src="/icon/_Icon_Schwarz/alle-fahrer-search.svg" alt="" className="w-6 h-6" />
                )}
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={() => {
              if (onCreateDriver) {
                onCreateDriver();
                return;
              }
              setView('fahrerErstellen');
            }}
            className="absolute h-[56px] bg-[#E3F654] border-2 border-[#E3F654] inline-flex justify-start items-center overflow-hidden px-[12px]"
            style={{ width: `${LAYOUT_GRID.contentWidth}px`, left: `${LAYOUT_GRID.contentLeft}px`, top: `${LAYOUT_GRID.createTop}px` }}
          >
            <span className="text-neutral-800 text-base font-medium font-['Space_Grotesk'] leading-6 tracking-wide">{t('fahrer.createDriver')}</span>
            <img src="/icon/_Icon_Schwarz/Arrow_Trisar_Icons_01.svg" alt="" className="w-[34px] h-[21px] ml-auto" />
          </button>

          {/* Rahmen um die Status-Chips (Tutorial-Hervorhebung); Chips relativ dazu */}
          <div
            data-tutorial="fahrer-status"
            className="absolute h-[42px]"
            style={{ width: `${LAYOUT_GRID.contentWidth}px`, left: `${LAYOUT_GRID.contentLeft}px`, top: `${LAYOUT_GRID.chipsTop}px` }}
          >
            {STATUS_CHIPS.map((chip) => (
              <StatusChip
                key={chip.key}
                chip={{ ...chip, left: chip.left - LAYOUT_GRID.contentLeft, top: chip.top - LAYOUT_GRID.chipsTop }}
                selected={statusFilter === chip.key}
                onSelect={(key) => setStatusFilter((prev) => (prev === key ? STATUS_FILTER_ALL : key))}
              />
            ))}
          </div>

          <div
            className="absolute grid grid-cols-2 gap-[12px]"
            style={{ width: `${LAYOUT_GRID.contentWidth}px`, left: `${LAYOUT_GRID.contentLeft}px`, top: `${LAYOUT_GRID.timeTop}px` }}
          >
            <TimeField
              timeValue={startTimeFilter}
              onTimeChange={setStartTimeFilter}
              dateValue={startDateFilter}
              onDateChange={setStartDateFilter}
              placeholder={t('fahrer.startPlaceholder')}
            />
            <TimeField
              timeValue={endTimeFilter}
              onTimeChange={setEndTimeFilter}
              dateValue={endDateFilter}
              onDateChange={setEndDateFilter}
              placeholder={t('fahrer.endPlaceholder')}
            />
          </div>

          {loadingDrivers ? (
            <div
              className="absolute text-[#E3F654] text-base font-medium font-['Space_Grotesk']"
              style={{ width: `${LAYOUT_GRID.contentWidth}px`, left: `${LAYOUT_GRID.contentLeft}px`, top: `${cardsStartTop}px` }}
            >
              {t('fahrer.loadingDrivers')}
            </div>
          ) : null}

          {!loadingDrivers && driversError ? (
            <div
              className="absolute bg-[#171717] border border-[#3A3A3A] p-4 whitespace-pre-line text-[#FF8E8E] text-[13px] leading-[1.4] font-medium font-['Space_Grotesk']"
              style={{ width: `${LAYOUT_GRID.contentWidth}px`, left: `${LAYOUT_GRID.contentLeft}px`, top: `${cardsStartTop}px` }}
            >
              {driversError}
            </div>
          ) : null}

          {!loadingDrivers && !driversError && filteredDrivers.length === 0 ? (
            <div
              className="absolute h-[84px] bg-[#0e0e0e] border border-[#2a2a2a] flex items-center px-[12px] text-[#E3F654] text-base font-medium font-['Space_Grotesk']"
              style={{ width: `${LAYOUT_GRID.contentWidth}px`, left: `${LAYOUT_GRID.contentLeft}px`, top: `${cardsStartTop}px` }}
            >
              {t('fahrer.noneForFilter')}
            </div>
          ) : null}

          {!loadingDrivers && !driversError
            ? filteredDrivers.map((driver, index) => (
                <DriverCard
                  key={driver.id}
                  driver={driver}
                  top={cardsStartTop + index * cardStep}
                  onClick={(driverRow) => {
                    if (isSelectionMode || selectedDriversCount > 0) {
                      toggleDriverSelection(driverRow.id);
                      return;
                    }
                    onEditDriver?.(driverRow);
                  }}
                  isSelected={selectedDriverIdsSet.has(driver.id)}
                  onToggleSelect={toggleDriverSelection}
                />
              ))
            : null}
        </div>
      </div>

      {bulkPlanSuccess ? (
        <div className="absolute left-[20px] right-[20px] bottom-[108px] bg-[#59BE80] text-[#0C0C0C] text-sm font-semibold font-['Space_Grotesk'] px-[12px] py-[10px]">
          {bulkPlanSuccess}
        </div>
      ) : null}

      {selectedDriversCount > 0 && !isBulkPlannerOpen ? (
        <div className="absolute right-[24px] bottom-[160px] z-[160] flex items-center gap-[10px]">
          <button
            type="button"
            onClick={() => {
              clearSelection();
              setIsSelectionMode(false);
              setBulkPlanError('');
              setBulkPlanSuccess('');
            }}
            aria-label={t('fahrer.clearSelection')}
            data-tutorial="auswahl-aufheben"
            className="w-[54px] h-[54px] rounded-full bg-[#E3F654] text-[#1D1C1D] text-[26px] font-bold leading-none flex items-center justify-center"
          >
            X
          </button>
          {DIENSTE_VON_HAND ? (
          <button
            type="button"
            onClick={() => {
              setIsBulkPlannerOpen(true);
              setBulkPlanError('');
              setBulkPlanSuccess('');
            }}
            data-tutorial="dienste-planen-knopf"
            className="h-[54px] px-[20px] border-2 border-[#E3F654] bg-black text-[#E3F654] text-base font-medium font-['Space_Grotesk'] leading-6 tracking-wide"
          >
            {t('fahrer.plan')}
          </button>
          ) : null}
        </div>
      ) : null}

      {DIENSTE_VON_HAND && isBulkPlannerOpen ? (
        <div className="absolute inset-0 z-[120]">
          <button
            type="button"
            onClick={() => setIsBulkPlannerOpen(false)}
            className="absolute inset-0 bg-black/55"
            aria-label={t('fahrer.closePlanner')}
          />
          <DienstePlanenBlatt
            t={t}
            anzahl={selectedDriversCount}
            tage={Array.from({ length: PLANNING_HORIZON_DAYS }, (_, i) => {
              const iso = addDaysToIsoDate(getTodayIsoDate(), i);
              const d = new Date(`${iso}T12:00:00`);
              return {
                iso,
                wochentag: i === 0 ? 'Heute' : d.toLocaleDateString('de-DE', { weekday: 'short' }),
                datum: d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' }),
              };
            })}
            datum={bulkServiceDate}
            onDatum={setBulkServiceDate}
            start={bulkStartTime}
            onStart={(wert) => { setBulkStartTime(wert); setBulkPlanError(''); setBulkPlanSuccess(''); }}
            ende={bulkEndTime}
            onEnde={(wert) => { setBulkEndTime(wert); setBulkPlanError(''); setBulkPlanSuccess(''); }}
            vorlagen={PLAN_TEMPLATES}
            fehler={bulkPlanError}
            speichert={isApplyingBulkPlan}
            onAnwenden={applyBulkPlanning}
            onSchliessen={() => setIsBulkPlannerOpen(false)}
          />
        </div>
      ) : null}

      {/* Ist der Planer offen, bringt er seine eigene Leiste mit. */}
      {!isMobileKeyboardMode && !isBulkPlannerOpen && !isAiPlannerOpen ? (
        <NaviFooterKomponente
          onNavigateHome={() => setView('list')}
          onNavigateToFahrten={() => setView('ankuenfte')}
          onNavigateToVehicles={() => setView('fahrzeugListe')}
          onNavigateToProfile={() => setView('alleFahrer')}
          onNavigateToAddFahrt={() => setView('fahrtAdd')}
          onNavigateToKi={() => setView('kiAssistent')}
          onNavigateToPlanung={() => setView('kiPlaner')}
          onNavigateToMap={handleNavigateToMap}
          activeTab={planerDirekt ? 'planung' : 'profile'}
        />
      ) : null}

      {isAiPlannerOpen ? (
        <AiDienstplanView
          // Kam man ueber Planung auf der Startansicht, geht es dorthin zurueck,
          // nicht in die Fahrerliste, die man nie gesehen hat.
          onClose={() => (planerDirekt ? setView?.('list') : setIsAiPlannerOpen(false))}
          navi={(
            <NaviFooterKomponente
              onNavigateHome={() => setView('list')}
              onNavigateToFahrten={() => setView('ankuenfte')}
              onNavigateToVehicles={() => setView('fahrzeugListe')}
              onNavigateToProfile={() => setView('alleFahrer')}
              onNavigateToAddFahrt={() => setView('fahrtAdd')}
              onNavigateToKi={() => setView('kiAssistent')}
              onNavigateToPlanung={() => setView('kiPlaner')}
              onNavigateToMap={handleNavigateToMap}
              activeTab="planung"
            />
          )}
          drivers={visibleDriversWithState}
          rides={ridesOfPlanningDay}
          allRides={plannedRidesToday}
          serviceDate={planningDayIso}
          supplySeries={supplyByAbsHour}
          ridesSeries={ridesByAbsHour}
          initialViewStart={chartViewStartHour}
          hourlyDriverCounts={hourlyDriverCounts}
          hourlyRideCounts={hourlyPlannedRideCounts}
          initialDemandProfile={plannerDemandProfile}
          initialDemandCustomized={isPlannerDemandCustomized}
          onDemandProfileChange={(nextProfile) => setPlannerDemandProfile(normalizeDemandProfile(nextProfile))}
          onDemandCustomizedChange={(nextValue) => setIsPlannerDemandCustomized(Boolean(nextValue))}
          totalDriverCount={Array.isArray(drivers) ? drivers.length : 0}
          plannerSettings={plannerSettings}
          onChangePlannerSettings={setPlannerSettings}
          onApplySuggestions={applyAiPlannerSuggestions}
        />
      ) : null}
    </div>
  );
}
