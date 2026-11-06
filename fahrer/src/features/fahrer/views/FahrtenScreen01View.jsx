import React, { useEffect, useMemo, useRef, useState } from 'react';
import TrisarFooter from '../../../components/ui/TrisarFooter';
import CancelRideSheet from './CancelRideSheet';
import { useI18n } from '../../../i18n';
import {
  RIDE_ADDRESS_URL,
  RIDE_AIRPORT_START_URL,
  RIDE_AIRPORT_URL,
  RIDE_ARROW_RIGHT_URL,
  RIDE_CONVOY_URL,
  RIDE_HOTEL_URL,
  TOP_RIGHT_TEAM_URL,
  TRISAR_LOGO_URL,
} from '../../../shared/ui/icons';
import { FahrzeugKarte } from '../../../shared/FahrzeugKarte';

const BASE_WIDTH = 402;
const BASE_HEIGHT = 874;
const PAGE_OFFSET_Y = 40;

const screenBg = {
  backgroundImage:
    "url(\"data:image/svg+xml;utf8,<svg viewBox='0 0 402 874' xmlns='http://www.w3.org/2000/svg' preserveAspectRatio='none'><rect x='0' y='0' height='100%' width='100%' fill='url(%23grad)' opacity='1'/><defs><radialGradient id='grad' gradientUnits='userSpaceOnUse' cx='0' cy='0' r='10' gradientTransform='matrix(40.2 87.4 -40.2 18.49 0 0)'><stop stop-color='rgba(49,55,1,1)' offset='0'/><stop stop-color='rgba(25,28,0,1)' offset='0.2283'/><stop stop-color='rgba(12,14,0,1)' offset='0.34244'/><stop stop-color='rgba(0,0,0,1)' offset='0.45659'/><stop stop-color='rgba(0,0,0,1)' offset='0.83626'/><stop stop-color='rgba(0,0,0,1)' offset='1'/></radialGradient></defs></svg>\")",
};


const DAY_IN_MS = 24 * 60 * 60 * 1000;

const toLocalDateValue = (input = new Date()) => {
  const date = input instanceof Date ? input : new Date(input);
  const timezoneOffsetMs = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - timezoneOffsetMs).toISOString().slice(0, 10);
};

const normalizeRideDate = (value) => (/^\d{4}-\d{2}-\d{2}$/.test(value || '') ? value : toLocalDateValue());

const parseRideDate = (value) => {
  const normalized = normalizeRideDate(value);
  const [year, month, day] = normalized.split('-').map(Number);
  return new Date(year, month - 1, day);
};

const formatRideDayLabel = (value, t, locale) => {
  const targetDate = parseRideDate(value);
  const today = parseRideDate(toLocalDateValue());
  const diffDays = Math.round((targetDate.getTime() - today.getTime()) / DAY_IN_MS);
  if (diffDays === 0) return t('screens.today');
  if (diffDays === 1) return t('screens.tomorrow');
  if (diffDays === -1) return t('screens.yesterday');
  return targetDate.toLocaleDateString(locale, { day: '2-digit', month: '2-digit' });
};

// Beschriftung der Trennzeile: Wochentag und Tag.Monat, z. B. "Mittwoch 18.09."
const formatDividerLabel = (value, locale) => {
  const datum = parseRideDate(value);
  const wochentag = datum.toLocaleDateString(locale, { weekday: 'long' });
  // toLocaleDateString liefert im Deutschen bereits "12.09." mit Schlusspunkt.
  const tagMonat = datum.toLocaleDateString(locale, { day: '2-digit', month: '2-digit' });
  return `${wochentag} ${tagMonat}`.replace(/\.*$/, '.');
};

const pickRideIcon = (value = '', isStart = false) => {
  const text = String(value).toLowerCase();
  const hotelPattern = /\b(hotel|resort|hostel|inn|motel|guesthouse|suite|aparthotel|residence)\b/;
  if (text.includes('muc') || text.includes('flughafen') || text.includes('airport') || text.includes('terminal')) {
    return isStart ? RIDE_AIRPORT_START_URL : RIDE_AIRPORT_URL;
  }
  if (hotelPattern.test(text)) return RIDE_HOTEL_URL;
  return RIDE_ADDRESS_URL;
};

const getShortFormattedAddress = (location) => {
  if (!location || typeof location !== 'object') return '';
  const preferred = [
    location.shortFormattedAddress,
    location.short_formatted_address,
    location.shortFormatted,
    location.short_formatted,
  ];
  for (const value of preferred) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
};

const normalizeLocationLabel = (value, fallback = '') => {
  if (!value || typeof value !== 'string') return fallback;
  return value.replace(/\s+/g, ' ').trim();
};

const getDisplayLocationName = (location, fallback = '') => {
  if (!location || typeof location !== 'object') return fallback;
  const shortFormatted = getShortFormattedAddress(location);
  if (shortFormatted) return normalizeLocationLabel(shortFormatted, fallback);

  if (typeof location.name === 'string' && location.name.trim()) {
    return normalizeLocationLabel(location.name.trim(), fallback);
  }

  if (typeof location.address === 'string' && location.address.trim()) {
    const firstSegment = location.address.split(',')[0]?.trim() || location.address.trim();
    return normalizeLocationLabel(firstSegment, fallback);
  }

  return fallback;
};

// Fahrzeugkarte: top 118, Hoehe 268 mit allen Angaben, ohne Bild/VIN/Kacheln kuerzer.
const VEHICLE_CARD_TOP = 118;
const VEHICLE_CARD_HEIGHT = 268;
const CARD_HEIGHT = 187;

// Kartenhoehe: 187 reicht fuer zwei Zeilen Ortsname. Laengere Namen machen die Karte
// hoeher (Text ab 127, 20 je Zeile, 20 Rand unten), damit nichts ueber den Rand laeuft.
// Gemessen in einer unsichtbaren Spalte mit derselben Schrift und Breite (129) wie in der Karte.
const zeilenSpeicher = new Map();
let messSpalte = null;
const ortZeilen = (text) => {
  const wert = String(text || '');
  if (!wert || typeof document === 'undefined') return 1;
  if (zeilenSpeicher.has(wert)) return zeilenSpeicher.get(wert);
  if (!messSpalte) {
    messSpalte = document.createElement('div');
    messSpalte.setAttribute('aria-hidden', 'true');
    Object.assign(messSpalte.style, {
      position: 'absolute', left: '-9999px', top: '0', visibility: 'hidden', width: '129px',
      fontFamily: 'Space Grotesk', fontSize: '16px', fontWeight: '700', letterSpacing: '-0.5px',
      lineHeight: '20px', overflowWrap: 'break-word', wordBreak: 'break-word',
    });
    document.body.appendChild(messSpalte);
  }
  messSpalte.textContent = wert;
  const zeilen = Math.max(1, Math.round(messSpalte.getBoundingClientRect().height / 20));
  // Erst merken, wenn die Schrift geladen ist, sonst misst die Ersatzschrift.
  if (!document.fonts || document.fonts.status === 'loaded') zeilenSpeicher.set(wert, zeilen);
  return zeilen;
};
const kartenHoehe = (job) => Math.max(
  CARD_HEIGHT,
  147 + 20 * Math.max(
    ortZeilen(getDisplayLocationName(job?.from, 'Unbekannt')),
    ortZeilen(getDisplayLocationName(job?.to, 'Unbekannt')),
  ),
);
const CARD_GAP = 12;
const ACTION_GAP = 12;
const ACTION_HEIGHT = 51;
const AFTER_ACTION_GAP = 24;
// Tageswechsel zwischen zwei Auftragskarten (Figma 793-6387): eine Zeile mit
// Wochentag und Datum, links und rechts von duennen Linien flankiert.
// 44 statt 56, weil oberhalb bereits der normale Kartenabstand von 12 px steht.
const DAY_DIVIDER_GAP_TOP = 44;
const DAY_DIVIDER_HEIGHT = 32;
const DAY_DIVIDER_GAP_BOTTOM = 56;
const DAY_DIVIDER_BLOCK = DAY_DIVIDER_GAP_TOP + DAY_DIVIDER_HEIGHT + DAY_DIVIDER_GAP_BOTTOM;
// Ganz oben steht immer eine Tageszeile (ueber der Dienstanfrage oder der ersten
// Fahrt), mit gleicher Luft darueber wie darunter. Die erste Karte folgt danach.
const FIXED_FOOTER_HEIGHT = 40;
const FIXED_FOOTER_CLEARANCE = 64;
// Dienstplan-Anfrage: 19 Luft + 38 Dienststart + 20 Abstand + 24 Dienstende
// + 19 Luft = 120 px Inhalt, plus 2 px Rand oben und unten. Links 12 px Luft.
const SERVICE_REQUEST_CARD_HEIGHT = 124;
const SERVICE_REQUEST_BLOCK_HEIGHT = SERVICE_REQUEST_CARD_HEIGHT + ACTION_GAP + ACTION_HEIGHT;
const SERVICE_REQUEST_CARD_GAP = 12;
// Luft zwischen Dienstplan-Anfrage und der ersten Auftragskarte desselben Tages.
const SERVICE_REQUEST_LIST_GAP = 48;
// Angenommene Anfragen zeigen keine Knoepfe mehr und sind entsprechend flacher.
const serviceBlockHeight = (request) => (request.angenommen ? SERVICE_REQUEST_CARD_HEIGHT : SERVICE_REQUEST_BLOCK_HEIGHT);

const PENDING_JOB_STATUSES = new Set(['pending', 'new', 'offered', 'requested', 'assigned_pending']);
const PENDING_CONVOY_RESPONSES = new Set(['pending', 'new', 'offered', 'requested']);

const canRespond = (job) => {
  if (!job) return false;
  if (job.isKolonne) {
    return PENDING_CONVOY_RESPONSES.has((job.myResponseStatus || 'pending').toLowerCase());
  }
  return PENDING_JOB_STATUSES.has((job.status || '').toLowerCase());
};

const parseClockToMinutes = (value) => {
  const match = String(value || '').trim().match(/^(\d{1,2}):(\d{2})/);
  if (!match) return Number.POSITIVE_INFINITY;
  const hours = Number.parseInt(match[1], 10);
  const minutes = Number.parseInt(match[2], 10);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return Number.POSITIVE_INFINITY;
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return Number.POSITIVE_INFINITY;
  return hours * 60 + minutes;
};

const sortJobsByDateAndTime = (jobs) =>
  [...(Array.isArray(jobs) ? jobs : [])].sort((a, b) => {
    const dateA = parseRideDate(a?.rideDate).getTime();
    const dateB = parseRideDate(b?.rideDate).getTime();
    if (dateA !== dateB) return dateA - dateB;

    const timeA = parseClockToMinutes(a?.etd || a?.originalEtd);
    const timeB = parseClockToMinutes(b?.etd || b?.originalEtd);
    if (timeA !== timeB) return timeA - timeB;

    return String(a?.id || '').localeCompare(String(b?.id || ''));
  });

const tagSchluessel = (job) => {
  const roh = String(job?.rideDate || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(roh) ? roh : '';
};

// Die Liste ist nach Tagen gegliedert. Jeder Tag beginnt mit seiner Zeile
// (Linie — Wochentag Datum — Linie), darunter die Dienstzeiten dieses Tages und
// danach seine Fahrten. So gehoert die Dienstplan-Anfrage sichtbar zu dem Tag,
// fuer den sie gilt, statt pauschal ganz oben zu stehen.
const buildListenLayout = (jobs, anfragen, fahrzeugKarteHoehe = VEHICLE_CARD_HEIGHT) => {
  const anfragenProTag = new Map();
  (anfragen || []).forEach((request) => {
    const tag = String(request?.date || '').slice(0, 10);
    if (!tag) return;
    if (!anfragenProTag.has(tag)) anfragenProTag.set(tag, []);
    anfragenProTag.get(tag).push(request);
  });

  const zeilen = [];
  const dienste = [];
  const fahrten = [];
  const offeneTage = new Set(anfragenProTag.keys());
  let cursorTop = VEHICLE_CARD_TOP + fahrzeugKarteHoehe + DAY_DIVIDER_GAP_BOTTOM;

  const tagBeginnen = (tag, istErster) => {
    if (!istErster) cursorTop += DAY_DIVIDER_GAP_TOP;
    zeilen.push({ top: cursorTop, datum: tag });
    cursorTop += DAY_DIVIDER_HEIGHT + DAY_DIVIDER_GAP_BOTTOM;
    const tagesAnfragen = anfragenProTag.get(tag) || [];
    tagesAnfragen.forEach((request, i) => {
      dienste.push({ request, top: cursorTop });
      cursorTop += serviceBlockHeight(request);
      if (i < tagesAnfragen.length - 1) cursorTop += SERVICE_REQUEST_CARD_GAP;
    });
    if (tagesAnfragen.length) cursorTop += SERVICE_REQUEST_LIST_GAP;
    offeneTage.delete(tag);
  };

  let letzterTag = null;
  (jobs || []).forEach((job, index) => {
    const tag = tagSchluessel(job);
    if (tag && tag !== letzterTag) {
      tagBeginnen(tag, index === 0);
      letzterTag = tag;
    }
    const cardTop = cursorTop;
    const withAction = canRespond(job);
    const cardHeight = kartenHoehe(job);
    const actionTop = withAction ? cardTop + cardHeight + ACTION_GAP : null;
    cursorTop = withAction
      ? actionTop + ACTION_HEIGHT + AFTER_ACTION_GAP
      : cardTop + cardHeight + CARD_GAP;
    fahrten.push({ cardTop, actionTop, cardHeight });
  });

  // Dienstzeiten fuer Tage ohne Fahrten gehen nicht verloren, sie haengen
  // chronologisch hinten an.
  Array.from(offeneTage).sort().forEach((tag) => {
    tagBeginnen(tag, zeilen.length === 0);
  });

  return { zeilen, dienste, fahrten, unterkante: cursorTop };
};

const RideCard = ({ job, layout, topOffset = 0, onOpen, onAction, onSheetOpen, actionBusy, tutorialId, ungelesen = 0 }) => {
  const { t, locale } = useI18n();
  const cardTop = layout.cardTop - topOffset;
  const actionTop = layout.actionTop !== null ? layout.actionTop - topOffset : null;
  const iconLeftTop = cardTop + 42;
  const iconRightTop = cardTop + 42;
  const iconCenterY = iconLeftTop + 35;
  const locationLeftTop = cardTop + 127;
  const fromName = job?.from?.name || 'Unbekannt';
  const toName = job?.to?.name || 'Unbekannt';
  const fromDisplayName = getDisplayLocationName(job?.from, t('screens.unknown'));
  const toDisplayName = getDisplayLocationName(job?.to, t('screens.unknown'));
  const fromIconLabel = `${fromName} ${job?.from?.address || ''} ${fromDisplayName}`;
  const toIconLabel = `${toName} ${job?.to?.address || ''} ${toDisplayName}`;
  const etd = job?.etd || '--:--';
  const originalEtd = job?.originalEtd || '';
  const isAirportRide = job?.tripType === 'airport';
  const isTrainRide = job?.tripType === 'train'
    || Boolean(String(job?.trainNumber || '').trim())
    || /^([A-Z]{1,4}\s*)?\d{2,5}$/.test(String(job?.flight || '').trim().toUpperCase());
  const showEtdMeta = isAirportRide || isTrainRide;
  const showPlan = showEtdMeta && Boolean(originalEtd);
  const dayLabel = formatRideDayLabel(job?.rideDate, t, locale);
  const isAccepted = job?.isKolonne
    ? String(job?.myResponseStatus || '').toLowerCase() === 'accepted'
    : String(job?.status || '').toLowerCase() === 'assigned';

  return (
    <>
      {/* Card Background */}
      <div 
        className={`absolute left-5 w-[362px] bg-[#1a1a1a] cursor-pointer touch-manipulation${isAccepted ? ' border-2 border-[#e3f754]' : ''}`}
        style={{ top: cardTop, height: layout.cardHeight || CARD_HEIGHT }}
        onClick={onOpen}
        data-tutorial={tutorialId}
      />
      
      {/* Day Label — Mindestbreite 90px (wie Design), wächst aber mit längeren
          Übersetzungen ("Aujourd'hui") symmetrisch um die Kartenmitte. */}
      <div
        className="absolute min-w-[90px] h-[29px] px-[10px] gap-[10px] bg-[#e3f754] flex items-center justify-center pointer-events-none"
        style={{ left: '201px', top: cardTop, transform: 'translateX(-50%)' }}
      >
        <span className="text-black text-[18px] font-bold tracking-[-0.5px] leading-none" style={{ fontFamily: 'Space Grotesk' }}>
          {dayLabel}
        </span>
        {/* Kolonnenfahrt: zwei Fahrzeuge hintereinander, direkt neben dem Tag.
            Massgeblich ist die Kolonnen-Kennung, nicht isKolonne: das steht auch
            bei einer angebotenen Einzelfahrt auf wahr, weil die ueber dieselbe
            Zuweisungstabelle laeuft. */}
        {Boolean(job?.convoyId) && (
          <img src={RIDE_CONVOY_URL} alt="" className="w-[23px] h-[18px] object-contain" />
        )}
      </div>

      {/* Ungelesene Nachrichten im Kolonnen-Chat: Plakette auf der oberen
          rechten Ecke der Karte, wie im Design ueber den Rand hinausragend. */}
      {ungelesen > 0 && (
        <div
          className="absolute w-[28px] h-[28px] rounded-full bg-[#ff6e63] flex items-center justify-center pointer-events-none"
          style={{ left: '354px', top: cardTop - 12 }}
        >
          <span className="text-[#1a1a1a] text-[18px] font-bold leading-none" style={{ fontFamily: 'Space Grotesk' }}>
            {ungelesen > 9 ? '9+' : ungelesen}
          </span>
        </div>
      )}

      {/* Left Icon Container */}
      <div 
        className="absolute w-[70px] h-[70px] bg-[#242525] rounded-[12px] flex items-center justify-center pointer-events-none"
        style={{ left: '53px', top: iconLeftTop }}
      >
        <img src={pickRideIcon(fromIconLabel, true)} alt="" className="w-[30px] h-[30px] object-contain" />
      </div>

      {/* Right Icon Container */}
      <div 
        className="absolute w-[70px] h-[70px] bg-[#242525] rounded-[12px] flex items-center justify-center pointer-events-none"
        style={{ left: '276px', top: iconRightTop }}
      >
        <img src={pickRideIcon(toIconLabel)} alt="" className="w-[30px] h-[30px] object-contain" />
      </div>

      {/* ETD/Time Display */}
      {showEtdMeta && (
        <div 
          className="absolute text-[#868786] text-[10px] font-bold tracking-[-0.5px] text-center pointer-events-none"
          style={{ left: '50%', transform: 'translateX(-50%)', top: iconCenterY - 30, width: '40px', fontFamily: 'Space Grotesk' }}
        >
          {t('screens.etd')}
        </div>
      )}
      
      <div 
        className="absolute w-[100px] text-[#e2f754] text-[30px] font-bold tracking-[-0.5px] leading-none text-center pointer-events-none"
        style={{ left: '50%', transform: 'translate(-50%, -50%)', top: iconCenterY, fontFamily: 'Space Grotesk' }}
      >
        {etd}
      </div>

      {showPlan && (
        <div 
          className="absolute text-[#f4f5f4] opacity-50 text-[10px] text-center tracking-[-0.5px] pointer-events-none"
          style={{ left: '50%', transform: 'translateX(-50%)', top: iconCenterY + 18, width: '64px', fontFamily: 'Space Grotesk' }}
        >
          {t('screens.planTime', { time: originalEtd })}
        </div>
      )}

      {/* Location Names + Arrow */}
      <div
        className="absolute left-[40px] right-[39px] pointer-events-none grid grid-cols-[minmax(0,1fr)_29px_minmax(0,1fr)] gap-x-[18px] items-center"
        style={{ top: locationLeftTop, fontFamily: 'Space Grotesk' }}
      >
        <div className="text-left text-white text-[16px] font-bold tracking-[-0.5px] leading-[20px] break-words min-w-0">
          {fromDisplayName}
        </div>
        <div className="w-[29px] h-[20px] flex items-center justify-center">
          <img src={RIDE_ARROW_RIGHT_URL} alt="" className="w-[29px] h-[20px] object-contain scale-[1.15]" />
        </div>
        <div className="text-right text-white text-[16px] font-bold tracking-[-0.5px] leading-[20px] break-words min-w-0">
          {toDisplayName}
        </div>
      </div>

      {layout.actionTop !== null && (
        <>
          <button
            type="button"
            onClick={() => onSheetOpen(job.id, 'refuse')}
            disabled={actionBusy}
            data-tutorial={`fahrt-ablehnen-${job.id}`}
            className="absolute w-[178px] h-[51px] border-2 border-[#ff6f63] flex items-center justify-center"
            style={{ left: '20px', top: `${actionTop}px` }}
          >
            <span className="text-[#ff6f63] text-[24px] font-bold tracking-[-0.5px] leading-none" style={{ fontFamily: 'Space Grotesk' }}>
              {t('screens.refuse')}
            </span>
          </button>
          <button
            type="button"
            onClick={() => onAction(job.id, 'accept')}
            disabled={actionBusy}
            data-tutorial={`fahrt-annehmen-${job.id}`}
            className="absolute w-[178px] h-[51px] bg-[#e3f754] flex items-center justify-center"
            style={{ left: '204px', top: `${actionTop}px` }}
          >
            <span className="text-black text-[24px] font-bold tracking-[-0.5px] leading-none" style={{ fontFamily: 'Space Grotesk' }}>
              {t('screens.accept')}
            </span>
          </button>
        </>
      )}
    </>
  );
};

const VehicleBlock = ({ vehicle, onOpen, onHoehe }) => {
  const { t } = useI18n();
  return (
    <FahrzeugKarte
      vehicle={vehicle}
      titel={vehicle?.license_plate || t('screens.noPlate')}
      top={118}
      onClick={onOpen}
      onHoehe={onHoehe}
      aria-label={t('screens.openVehicle')}
      data-tutorial="fahrzeugkarte"
    />
  );
};

const FahrtenScreen01View = ({
  jobs,
  setView,
  setSelectedJob,
  handleJobAction,
  currentVehicle,
  onOpenProfile,
  handleRefreshAll,
  serviceRequests = [],
  onServiceRequestAction,
  serviceActionBusyId = null,
  unreadByChat = {},
}) => {
  const { t, locale } = useI18n();
  const [scale, setScale] = useState(1);
  const [viewportHeight, setViewportHeight] = useState(
    typeof window !== 'undefined' ? window.innerHeight : BASE_HEIGHT,
  );
  const [actionBusy, setActionBusy] = useState(false);
  const [localJobs, setLocalJobs] = useState([]);
  const [newTopJobIds, setNewTopJobIds] = useState([]);
  const [showCancelSheet, setShowCancelSheet] = useState(false);
  const [selectedAction, setSelectedAction] = useState(null);
  const [targetJobId, setTargetJobId] = useState(null);
  const previousJobIdsRef = useRef(new Set());

  useEffect(() => {
    const updateScale = () => {
      const nextViewportHeight = window.innerHeight || BASE_HEIGHT;
      setViewportHeight(nextViewportHeight);
      setScale(Math.min(window.innerWidth / BASE_WIDTH, nextViewportHeight / BASE_HEIGHT, 1));
    };
    updateScale();
    window.addEventListener('resize', updateScale);
    return () => window.removeEventListener('resize', updateScale);
  }, []);

  useEffect(() => {
    const previousBodyOverflow = document.body.style.overflow;
    const previousHtmlOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousHtmlOverflow;
    };
  }, []);

  // Update local jobs when props change and detect newly arrived offered rides.
  useEffect(() => {
    const incomingJobs = Array.isArray(jobs) ? jobs : [];
    setLocalJobs(incomingJobs);

    const previousIds = previousJobIdsRef.current;
    const currentIds = new Set(
      incomingJobs
        .map((job) => String(job?.id || '').trim())
        .filter(Boolean),
    );
    // Beim ersten Laden ist noch nichts bekannt — sonst gaelten alle offenen
    // Fahrten als "gerade eingetroffen" und wuerden nach oben sortiert. Das
    // Hochziehen ist nur fuer Anfragen gedacht, die waehrend der Sitzung
    // hereinkommen; sonst stuende die Liste nicht mehr chronologisch.
    const ersterLauf = previousIds.size === 0;
    const freshlyArrivedIds = ersterLauf ? [] : incomingJobs
      .filter((job) => {
        const id = String(job?.id || '').trim();
        if (!id) return false;
        if (previousIds.has(id)) return false;
        return canRespond(job);
      })
      .map((job) => String(job?.id || '').trim());

    setNewTopJobIds((prev) => {
      const stillPendingFromPrev = prev.filter(
        (id) => currentIds.has(id)
          && incomingJobs.some((job) => String(job?.id || '').trim() === id && canRespond(job)),
      );
      return Array.from(new Set([...freshlyArrivedIds, ...stillPendingFromPrev]));
    });

    previousJobIdsRef.current = currentIds;
  }, [jobs]);

  const visibleJobs = useMemo(() => {
    const sorted = sortJobsByDateAndTime(localJobs);
    if (!newTopJobIds.length) return sorted;

    const priorityOrder = new Map(newTopJobIds.map((id, index) => [id, index]));
    const priorityJobs = [];
    const otherJobs = [];

    sorted.forEach((job) => {
      const id = String(job?.id || '').trim();
      if (id && priorityOrder.has(id) && canRespond(job)) {
        priorityJobs.push(job);
      } else {
        otherJobs.push(job);
      }
    });

    priorityJobs.sort((a, b) => {
      const aIndex = priorityOrder.get(String(a?.id || '').trim()) ?? Number.MAX_SAFE_INTEGER;
      const bIndex = priorityOrder.get(String(b?.id || '').trim()) ?? Number.MAX_SAFE_INTEGER;
      return aIndex - bIndex;
    });

    return [...priorityJobs, ...otherJobs];
  }, [localJobs, newTopJobIds]);
  const activeServiceRequests = useMemo(
    () =>
      (Array.isArray(serviceRequests) ? serviceRequests : [])
        .filter((entry) => ['pending', 'accepted'].includes(String(entry?.status || 'pending').toLowerCase()))
        .map((entry) => ({
          id: String(entry?.id || '').trim(),
          // Wie bei den Auftragskarten: angenommen = Rand, keine Knoepfe mehr.
          angenommen: String(entry?.status || 'pending').toLowerCase() === 'accepted',
          date: String(entry?.serviceDate || entry?.service_date || '').trim(),
          startTime: String(entry?.serviceStartTime || entry?.service_start_time || '').trim(),
          endTime: String(entry?.serviceEndTime || entry?.service_end_time || '').trim(),
        }))
        .filter((entry) => entry.id),
    [serviceRequests],
  );

  const frameHeight = useMemo(() => {
    const safeScale = Math.max(scale, 0.01);
    return Math.max(BASE_HEIGHT, Math.ceil(viewportHeight / safeScale));
  }, [scale, viewportHeight]);

  // Nach dem Laden der Schrift neu messen (Kartenhoehe haengt an den Zeilen der Ortsnamen).
  const [schriftGeladen, setSchriftGeladen] = useState(() => typeof document === 'undefined' || !document.fonts || document.fonts.status === 'loaded');
  useEffect(() => {
    if (schriftGeladen || !document.fonts) return undefined;
    let aktiv = true;
    document.fonts.ready.then(() => { if (aktiv) setSchriftGeladen(true); });
    return () => { aktiv = false; };
  }, [schriftGeladen]);
  const [fahrzeugKartenHoehe, setFahrzeugKartenHoehe] = useState(VEHICLE_CARD_HEIGHT);
  const listenLayout = useMemo(
    () => buildListenLayout(visibleJobs, activeServiceRequests, fahrzeugKartenHoehe),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [visibleJobs, activeServiceRequests, schriftGeladen, fahrzeugKartenHoehe],
  );
  const rideLayouts = listenLayout.fahrten;
  const ridesBottom = listenLayout.unterkante;
  const sheetContentHeight = useMemo(
    () => Math.max(
      frameHeight + PAGE_OFFSET_Y,
      ridesBottom + AFTER_ACTION_GAP + FIXED_FOOTER_CLEARANCE + PAGE_OFFSET_Y,
    ),
    [frameHeight, ridesBottom],
  );
  const hasSheetScroll = sheetContentHeight > (frameHeight + PAGE_OFFSET_Y);

  const openCancelSheet = (jobId, action) => {
    setTargetJobId(jobId);
    setSelectedAction(action);
    setShowCancelSheet(true);
  };

  const closeCancelSheet = () => {
    setShowCancelSheet(false);
    setTargetJobId(null);
    setSelectedAction(null);
  };

  const runAction = async (jobId, action, refusalReason = null) => {
    if (!jobId || actionBusy) return;

    try {
      setActionBusy(true);

      // Bei accept: Job lokal auf assigned setzen, damit Buttons sofort verschwinden
      if (action === 'accept') {
        const normalizedJobId = String(jobId || '').trim();
        if (normalizedJobId) {
          setNewTopJobIds((prev) => prev.filter((id) => id !== normalizedJobId));
        }
        setLocalJobs((prev) =>
          prev.map((job) => (job.id === jobId ? { ...job, status: 'assigned' } : job)),
        );
      }

      // Bei refuse: Job sofort aus der lokalen Liste entfernen
      if (action === 'refuse') {
        const normalizedJobId = String(jobId || '').trim();
        if (normalizedJobId) {
          setNewTopJobIds((prev) => prev.filter((id) => id !== normalizedJobId));
        }
        setLocalJobs(prev => prev.filter(job => job.id !== jobId));
      }

      const ok = await handleJobAction(jobId, action, { refusalReason });

      if (!ok) {
        // Bei Fehler und accept: lokalen Stand zurücksetzen
        if (action === 'accept') {
          const normalizedJobId = String(jobId || '').trim();
          if (normalizedJobId) {
            const failedJob = (Array.isArray(jobs) ? jobs : []).find((job) => String(job?.id || '').trim() === normalizedJobId);
            if (failedJob && canRespond(failedJob)) {
              setNewTopJobIds((prev) => Array.from(new Set([normalizedJobId, ...prev])));
            }
          }
          setLocalJobs(Array.isArray(jobs) ? jobs : []);
        }
        // Bei Fehler und refuse: Job wieder hinzufügen
        if (action === 'refuse') {
          setLocalJobs(Array.isArray(jobs) ? jobs : []);
        }
        return;
      }

      // Refresh der Job-Liste
      if (typeof handleRefreshAll === 'function') {
        await handleRefreshAll();
      }

    } catch (error) {
      console.error(`Fehler bei Job Action ${action}:`, error);
      // Bei Fehler und accept: lokalen Stand zurücksetzen
      if (action === 'accept') {
        const normalizedJobId = String(jobId || '').trim();
        if (normalizedJobId) {
          const failedJob = (Array.isArray(jobs) ? jobs : []).find((job) => String(job?.id || '').trim() === normalizedJobId);
          if (failedJob && canRespond(failedJob)) {
            setNewTopJobIds((prev) => Array.from(new Set([normalizedJobId, ...prev])));
          }
        }
        setLocalJobs(Array.isArray(jobs) ? jobs : []);
      }
      // Bei Fehler und refuse: Job wieder hinzufügen
      if (action === 'refuse') {
        setLocalJobs(Array.isArray(jobs) ? jobs : []);
      }
    } finally {
      setActionBusy(false);
    }
  };

  const openDetails = (job) => {
    if (!job) return;
    setSelectedJob({
      ...job,
      __openToken: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    });
    setView('details');
  };

  return (
    <div
      className="fixed inset-0 h-dvh w-full bg-black overflow-hidden flex justify-center items-start overscroll-none"
      style={{ WebkitTextSizeAdjust: 'none', textSizeAdjust: 'none' }}
    >
      <div className="relative shrink-0 overflow-hidden" style={{ width: `${BASE_WIDTH * scale}px`, height: `${frameHeight * scale}px` }}>
        <div className="absolute left-0 top-0 w-[402px] origin-top-left" style={{ transform: `scale(${scale})`, height: `${frameHeight}px` }}>
          <div
            className={`absolute inset-0 overflow-x-hidden ${hasSheetScroll ? 'overflow-y-auto overscroll-none' : 'overflow-y-hidden overscroll-none'}`}
            style={{ WebkitOverflowScrolling: 'touch' }}
          >
            <div className="relative w-[402px]" style={{ height: `${sheetContentHeight}px` }}>
              <div className="absolute left-0 top-0 w-[402px]" style={{ ...screenBg, height: `${frameHeight}px` }} />

              <div className="absolute left-0 top-[20px] w-[402px] fahrten-sanft">
                <div className="absolute left-5 top-[70px] w-[162px] h-6">
                  <img src={TRISAR_LOGO_URL} alt="trisar" className="w-full h-full object-contain" />
                </div>

                <button type="button" onClick={onOpenProfile} data-tutorial="profil-knopf" className="absolute right-5 top-[40px] w-[52px] h-[52px] rounded-full border border-[#8f8f90] flex items-center justify-center">
                  <img src={TOP_RIGHT_TEAM_URL} alt="" className="w-[24px] h-[24px] object-contain opacity-90" />
                </button>

                <VehicleBlock vehicle={currentVehicle} onOpen={() => setView('vehicle')} onHoehe={setFahrzeugKartenHoehe} />

                {listenLayout.zeilen.map((zeile) => (
                  <div
                    key={`tag-${zeile.datum}`}
                    className="absolute left-5 right-5 flex items-center justify-between pointer-events-none"
                    style={{ top: zeile.top, height: DAY_DIVIDER_HEIGHT }}
                  >
                    {/* Kurze Striche aussen, Text mittig — beide Striche gleich breit,
                        damit der Text zentriert bleibt. */}
                    <span className="w-[44px] h-[2px] bg-[#e3f754] shrink-0" />
                    <span className="text-[#e3f754] text-[26px] font-bold tracking-[-0.5px] whitespace-nowrap" style={{ fontFamily: 'Space Grotesk' }}>
                      {formatDividerLabel(zeile.datum, locale)}
                    </span>
                    <span className="w-[44px] h-[2px] bg-[#e3f754] shrink-0" />
                  </div>
                ))}

                {listenLayout.dienste.map(({ request, top }, index) => {
                  const isBusy = serviceActionBusyId === request.id;
                  return (
                    <div key={request.id}>
                      <div
                        // Rand immer 2 px breit, damit der graue Bereich und der Inhalt beim
                        // Annehmen nicht um die Randbreite springen — nur die Farbe wechselt.
                        className={`absolute left-5 w-[362px] bg-[#1a1a1a] border-2 px-[12px] pt-[19px] pb-[19px] transition-colors duration-300 ${request.angenommen ? 'border-[#e3f754]' : 'border-transparent'}`}
                        style={{ top: `${top}px`, height: `${SERVICE_REQUEST_CARD_HEIGHT}px` }}
                        data-tutorial={index === 0 ? 'dienstanfrage' : undefined}
                      >
                        {request.startTime ? (
                          <div className="text-[#E3F654] text-[38px] leading-none font-bold font-['Space_Grotesk']">
                            {t('screens.serviceStart', { time: request.startTime.slice(0, 5) })}
                          </div>
                        ) : null}
                        {request.endTime ? (
                          <div className="mt-[20px] text-[#FF6F63] text-[24px] leading-none font-bold font-['Space_Grotesk']">
                            {t('screens.serviceEnd', { time: request.endTime.slice(0, 5) })}
                          </div>
                        ) : null}
                      </div>
                      {!request.angenommen && (
                      <>
                      <button
                        type="button"
                        onClick={() => onServiceRequestAction?.(request.id, 'refuse')}
                        disabled={isBusy}
                        data-tutorial={index === 0 ? 'dienstanfrage-ablehnen' : undefined}
                        className="absolute w-[178px] h-[51px] border-2 border-[#ff6f63] flex items-center justify-center disabled:opacity-60"
                        style={{ left: '20px', top: `${top + SERVICE_REQUEST_CARD_HEIGHT + ACTION_GAP}px` }}
                      >
                        <span className="text-[#ff6f63] text-[24px] font-bold tracking-[-0.5px] leading-none" style={{ fontFamily: 'Space Grotesk' }}>
                          {t('screens.refuse')}
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => onServiceRequestAction?.(request.id, 'accept')}
                        disabled={isBusy}
                        data-tutorial={index === 0 ? 'dienstanfrage-annehmen' : undefined}
                        className="absolute w-[178px] h-[51px] bg-[#e3f754] flex items-center justify-center disabled:opacity-60"
                        style={{ left: '204px', top: `${top + SERVICE_REQUEST_CARD_HEIGHT + ACTION_GAP}px` }}
                      >
                        <span className="text-black text-[24px] font-bold tracking-[-0.5px] leading-none" style={{ fontFamily: 'Space Grotesk' }}>
                          {t('screens.accept')}
                        </span>
                      </button>
                      </>
                      )}
                    </div>
                  );
                })}

                {visibleJobs.map((job, index) => (
                  <RideCard
                    key={job.id}
                    job={job}
                    layout={rideLayouts[index]}
                    tutorialId={`fahrt-${job.id}`}
                    ungelesen={job?.convoyId ? (unreadByChat?.[`group:${job.convoyId}`] || 0) : 0}
                    onOpen={() => openDetails(job)}
                    onAction={runAction}
                    onSheetOpen={openCancelSheet}
                    actionBusy={actionBusy}
                  />
                ))}

              </div>
            </div>
          </div>

          <div
            className="absolute left-0 right-0 bottom-0 h-10 z-20 bg-black"
            style={{ height: `${FIXED_FOOTER_HEIGHT}px` }}
          >
            <TrisarFooter className="relative w-full h-10 bg-black" />
          </div>
        </div>
      </div>
      
      {/* Cancel Ride Sheet */}
      {showCancelSheet && (
        <CancelRideSheet 
          onClose={closeCancelSheet}
          onConfirm={(notes) => {
            // Schließe Sheet und führe Aktion aus
            closeCancelSheet();
            if (targetJobId && selectedAction) {
              runAction(targetJobId, selectedAction, notes);
            }
          }}
        />
      )}
    </div>
  );
};

export default FahrtenScreen01View;
