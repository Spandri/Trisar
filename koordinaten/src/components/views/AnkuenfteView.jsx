import { useEffect, useRef, useState } from 'react';
import NaviFooterKomponente from '../navigation/NaviFooterKomponente';
import BackCircleButton from '../ui/BackCircleButton';
const MISSING_DRIVER_LABEL = 'Fahrer fehlt';
const SWIPE_ACTION_WIDTH = 90;
const SWIPE_OPEN_THRESHOLD = 36;
const SWIPE_LOCK_THRESHOLD = 8;

// Hilfsfunktion: Formatiert "Vorname Nachname" zu "V. Nachname"
const shortenName = (fullName) => {
  if (!fullName || typeof fullName !== 'string') return fullName;
  const trimmed = fullName.trim();
  if (!trimmed) return fullName;
  
  const parts = trimmed.split(/\s+/);
  if (parts.length < 2) return fullName; // Nur ein Wort, keine Änderung
  
  const firstName = parts[0];
  const lastName = parts.slice(1).join(' '); // Rest ist Nachname (kann mehrere Teile haben)
  
  if (!firstName || !lastName) return fullName;
  
  const firstInitial = firstName.charAt(0).toUpperCase();
  return `${firstInitial}. ${lastName}`;
};

const getRideDriverEntries = (ride = {}) => {
  const fromArray = Array.isArray(ride?.fahrerNamen)
    ? ride.fahrerNamen.map((entry) => String(entry || '').trim()).filter(Boolean)
    : [];
  if (fromArray.length > 0) return fromArray;
  return String(ride?.driver || '')
    .split(/\s*,\s*/g)
    .map((entry) => entry.trim())
    .filter(Boolean);
};

const extractDriverNumbers = (entries = [], fallbackDriverNumber = null) => {
  const numbers = new Set();
  entries.forEach((entry) => {
    const raw = String(entry || '').trim();
    if (!raw) return;
    const parenMatch = raw.match(/\(([^)]+)\)\s*$/);
    if (parenMatch?.[1]) numbers.add(String(parenMatch[1]).trim());
    const digitMatches = raw.match(/\d+/g) || [];
    digitMatches.forEach((token) => numbers.add(String(token).trim()));
  });
  if (fallbackDriverNumber != null && String(fallbackDriverNumber).trim()) {
    numbers.add(String(fallbackDriverNumber).trim());
  }
  return Array.from(numbers).filter(Boolean);
};

const formatDriverEntry = (entry, fallbackDriverNumber = null) => {
  const raw = String(entry || '').trim();
  if (!raw) return '';
  if (raw.toLowerCase() === MISSING_DRIVER_LABEL.toLowerCase()) return MISSING_DRIVER_LABEL;
  const parenMatch = raw.match(/\(([^)]+)\)\s*$/);
  const driverNumber = (parenMatch?.[1] || (fallbackDriverNumber == null ? '' : String(fallbackDriverNumber))).trim();
  const namePart = parenMatch ? raw.slice(0, parenMatch.index).trim() : raw;
  const shortName = shortenName(namePart);
  if (shortName && driverNumber) return `${shortName} (${driverNumber})`;
  if (shortName) return shortName;
  if (driverNumber) return driverNumber;
  return raw;
};

const normalizeDriverResponseStatus = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  if (['accepted', 'assigned', 'in_progress', 'done', 'arrived', 'completed'].includes(normalized)) return 'accepted';
  if (['refused', 'cancelled', 'canceled', 'declined', 'rejected'].includes(normalized)) return 'refused';
  return 'pending';
};

const getDriverResponseColorClass = (status) => {
  if (status === 'refused') return 'text-[#f55757]';
  if (status === 'pending') return 'text-[#ff8a00]';
  return 'text-zinc-900';
};

const SwipeActionButton = ({ icon, alt, side, position, onPress = () => {}, onReset = () => {} }) => (
  <button
    type="button"
    aria-label={alt}
    onClick={(event) => {
      event.stopPropagation();
      onReset();
      onPress();
    }}
    className={`absolute ${side}-0 ${position === 'top' ? 'top-0' : 'bottom-0'} w-[90px] h-1/2 flex items-center justify-center`}
  >
    <img src={icon} alt={alt} className="w-[36px] h-[36px] object-contain" />
  </button>
);

const RideCard = ({
  name,
  allGuestNames = [],
  anonymeGaeste = '0',
  route,
  fahrerNamen = [],
  fahrerAntworten = [],
  driverNumber,
  driver,
  note,
  time,
  status = 'default',
  variant = 'default',
  aiBooked = false,
  onClick,
  enableSwipe = false,
  onDone = () => {},
  onArchive = () => {},
  onDuplicate = () => {},
}) => {
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
  const bgColor = variant === 'variant2' ? 'bg-red-500' : 'bg-white';
  const textColor = variant === 'variant2' ? 'text-black' : 'text-zinc-900';
  const noteTextColor = variant === 'variant2' ? 'text-black' : 'text-zinc-500';
  const strikeColor = variant === 'variant2' ? 'text-neutral-800' : 'text-red-500';
  const isDateStatus = /^\d{2}\.\d{2}$/.test(String(time?.status || '').trim());
  const statusColor = variant === 'variant2' ? 'text-neutral-800' : (isDateStatus ? 'text-zinc-900' : 'text-[#59BE80]');
  
  // Namen verkürzen für Anzeige
  const driverEntries = getRideDriverEntries({ fahrerNamen, driver });
  const isMissingDriver =
    driverEntries.length === 0 ||
    driverEntries.every((entry) => String(entry || '').trim().toLowerCase() === MISSING_DRIVER_LABEL.toLowerCase());
  const displayDriver = isMissingDriver
    ? MISSING_DRIVER_LABEL
    : driverEntries
        .map((entry, index) => formatDriverEntry(entry, index === 0 ? driverNumber : null))
        .filter(Boolean)
        .join(', ');
  const driverLabel = displayDriver || MISSING_DRIVER_LABEL;
  const driverStatusList = Array.isArray(fahrerAntworten) ? fahrerAntworten : [];
  const displayDriverParts = isMissingDriver
    ? [{ text: MISSING_DRIVER_LABEL, colorClass: textColor }]
    : driverEntries
        .map((entry, index) => {
          const text = formatDriverEntry(entry, index === 0 ? driverNumber : null);
          if (!text) return null;
          const normalizedStatus = normalizeDriverResponseStatus(driverStatusList[index] || 'pending');
          return { text, colorClass: getDriverResponseColorClass(normalizedStatus) };
        })
        .filter(Boolean);
  const fallbackDriverParts = displayDriverParts.length > 0 ? displayDriverParts : [{ text: driverLabel, colorClass: textColor }];

  // Alle Gäste verkürzen und mit Komma verbinden
  const shortGuestNames = (allGuestNames && allGuestNames.length > 0)
    ? allGuestNames.map(g => shortenName(g)).join(', ')
    : shortenName(name);
  const anonCount = Number.parseInt(String(anonymeGaeste || '0'), 10);
  const hasAnonGuests = Number.isFinite(anonCount) && anonCount > 0;
  const noteLabel = String(note || '').trim() ? `Notiz: ${String(note).trim()}` : '';
  const clampOffset = (value) => Math.max(-SWIPE_ACTION_WIDTH, Math.min(SWIPE_ACTION_WIDTH, value));
  const displayedOffset = enableSwipe ? offsetX : 0;

  // Dynamische Schriftgröße basierend auf Länge
  const guestNameLength = shortGuestNames.length;
  let fontSize = '24px';
  if (guestNameLength > 45) {
    fontSize = '18px';
  } else if (guestNameLength > 30) {
    fontSize = '20px';
  }

  const handlePointerDown = (event) => {
    if (!enableSwipe) return;
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startOffset: displayedOffset,
      lockedAxis: null,
    };
    setIsDragging(true);
    if (event.currentTarget?.setPointerCapture) {
      event.currentTarget.setPointerCapture(event.pointerId);
    }
  };

  const handlePointerMove = (event) => {
    if (!enableSwipe || !isDragging || dragRef.current.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - dragRef.current.startX;
    const deltaY = event.clientY - dragRef.current.startY;
    if (!dragRef.current.lockedAxis) {
      if (Math.abs(deltaX) < SWIPE_LOCK_THRESHOLD && Math.abs(deltaY) < SWIPE_LOCK_THRESHOLD) return;
      dragRef.current.lockedAxis = Math.abs(deltaX) >= Math.abs(deltaY) ? 'x' : 'y';
    }
    if (dragRef.current.lockedAxis !== 'x') return;
    const nextOffset = clampOffset(dragRef.current.startOffset + deltaX);
    setOffsetX(nextOffset);
    if (Math.abs(nextOffset - dragRef.current.startOffset) > 6) {
      suppressNextClickRef.current = true;
    }
    event.preventDefault();
  };

  const handlePointerEnd = (event) => {
    if (!enableSwipe || dragRef.current.pointerId !== event.pointerId) return;
    if (dragRef.current.lockedAxis === 'x') {
      suppressNextClickRef.current = true;
      if (offsetX > SWIPE_OPEN_THRESHOLD) {
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
    if (enableSwipe && Math.abs(displayedOffset) > 0) {
      setOffsetX(0);
      return;
    }
    onClick?.();
  };

  return (
    <div className="relative w-full overflow-hidden">
      {enableSwipe ? (
        <>
          <div className="absolute inset-y-0 left-0 w-[90px] bg-[#e3f654]">
            <SwipeActionButton
              icon="/icon/_Icon_Schwarz/Faecher_Done.svg"
              alt="Fahrt abschliessen"
              side="left"
              position="top"
              onPress={onDone}
              onReset={() => setOffsetX(0)}
            />
            <SwipeActionButton
              icon="/icon/_Icon_Schwarz/Faecher_Archievieren.svg"
              alt="Fahrt archivieren"
              side="left"
              position="bottom"
              onPress={onArchive}
              onReset={() => setOffsetX(0)}
            />
          </div>
          <div className="absolute inset-y-0 right-0 w-[90px] bg-[#e3f654]">
            <SwipeActionButton
              icon="/icon/_Icon_Schwarz/Faecher_AddDriver.svg"
              alt="Fahrer hinzufuegen"
              side="right"
              position="top"
              onReset={() => setOffsetX(0)}
            />
            <SwipeActionButton
              icon="/icon/_Icon_Schwarz/Faecher_Duplicat.svg"
              alt="Fahrt duplizieren"
              side="right"
              position="bottom"
              onPress={onDuplicate}
              onReset={() => setOffsetX(0)}
            />
          </div>
        </>
      ) : null}
      <button
        type="button"
        onClick={handleCardClick}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        onPointerCancel={handlePointerEnd}
        aria-label={`Fahrt ${name} öffnen`}
        className={`relative z-10 w-full ${bgColor} border-none text-left overflow-hidden`}
        style={{
          transform: `translateX(${displayedOffset}px)`,
          transition: isDragging ? 'none' : 'transform 180ms ease-out',
          touchAction: enableSwipe ? 'pan-y' : 'auto',
        }}
      >
        <div className="w-full min-h-36 relative p-[18px]">
        {aiBooked ? (
          <div className="absolute left-2 top-2 z-10">
            <img
              src={variant === 'variant2' ? '/icon/_Icon_Lime/KI_Trisar_Icons_01_Lime.svg' : '/icon/_Icon_Green/KI_Trisar_Icons_01_green.svg'}
              alt=""
              className="w-[14px] h-[13px]"
            />
          </div>
        ) : null}
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0 flex flex-col gap-[5px]">
            <div
              className={`${textColor} font-bold font-['Space_Grotesk'] whitespace-normal break-words line-clamp-2`}
              style={{ fontSize }}
            >
              {shortGuestNames}
              {hasAnonGuests && (
                <span className="inline-flex items-center gap-1 ml-2 align-middle">
                  <span className="font-bold">+ {anonCount}</span>
                  <span
                    className="inline-block align-middle opacity-60 w-4 h-[18px]"
                    style={{
                      backgroundColor: 'currentColor',
                      WebkitMaskImage: "url('/icon/_Icon_Schwarz/Person_Trisar_Icons_01.svg')",
                      maskImage: "url('/icon/_Icon_Schwarz/Person_Trisar_Icons_01.svg')",
                      WebkitMaskRepeat: 'no-repeat',
                      maskRepeat: 'no-repeat',
                      WebkitMaskSize: 'contain',
                      maskSize: 'contain',
                    }}
                  />
                </span>
              )}
            </div>
            <div className={`${textColor} opacity-80 text-xs font-medium font-['Space_Grotesk'] leading-4 tracking-wide`}>{route}</div>
            <div className="text-base font-bold font-['Space_Grotesk'] leading-6 tracking-wide">
              {fallbackDriverParts.map((part, index) => (
                <span key={`${part.text}-${index}`} className={part.colorClass}>
                  {index > 0 ? ', ' : ''}
                  {part.text}
                </span>
              ))}
            </div>
            <div className={`${noteTextColor} text-xs font-medium font-['Space_Grotesk'] leading-5 tracking-tight truncate`}>{noteLabel}</div>
          </div>

          <div className="shrink-0 text-right">
            {status === 'delayed' ? (
              <div>
                <div className={`${strikeColor} text-base font-normal font-['Space_Grotesk'] line-through leading-5`}>{time.original}</div>
                <div className={`${statusColor} text-base font-bold font-['Space_Grotesk'] leading-5`}>{time.status}</div>
                <div className={`${statusColor} text-base font-normal font-['Space_Grotesk'] leading-5`}>{time.new}</div>
              </div>
            ) : (
              <div>
                <div className={`${statusColor} text-base font-bold font-['Space_Grotesk'] leading-5`}>{time.status}</div>
                <div className={`${statusColor} text-base font-normal font-['Space_Grotesk'] leading-5`}>{time.time}</div>
              </div>
            )}
          </div>
        </div>

        <div className="absolute right-4 bottom-[18px]">
          <img src="/icon/_Icon_Schwarz/Arrow_Trisar_Icons_01.svg" alt="" className="w-[34px] h-[21px] scale-[1.2]" />
        </div>
        </div>
      </button>
    </div>
  );
};

export default function AnkuenfteView({
  onBack,
  onSwitchToAbfahrten,
  onNavigateHome,
  onNavigateToFahrten,
  onNavigateToMap,
  onNavigateToAddFahrt,
  onNavigateToKi,
  onOpenFilter = () => {},
  onOpenArchive = () => {},
  onRefreshRides = () => {},
  onRideSelect = () => {},
  rides = [],
  ridesError = '',
  airportBoard = null,
  onRefreshAirportBoard = () => {},
  rideFilters = {},
  coordinatorLocation = '',
  onCoordinatorLocationChange = () => {},
  hasCoordinatorLocation = false,
  showArchiveOnly = false,
  onRideDone = () => {},
  onRideArchive = () => {},
  onRideDuplicate = () => {},
}) {
  const [searchTerm, setSearchTerm] = useState('');
  const scrollRef = useRef(null);
  const hasSearchTerm = searchTerm.trim().length > 0;

  const gradientStyle = {
    background: 'radial-gradient(ellipse 141.42% 102.21% at 0.00% -0.00%, #313701 0%, black 46%, black 84%, black 100%)',
  };

  const normalizedSearch = searchTerm.trim().toLowerCase();
  const {
    startQuery = '',
    zielQuery = '',
    date = '',
    withoutDriver = false,
    requireConfirmation = false,
    konvoi = false,
    withSpecial = false,
    includePast = false,
  } = rideFilters;
  const normalizedStartQuery = String(startQuery || '').trim().toLowerCase();
  const normalizedZielQuery = String(zielQuery || '').trim().toLowerCase();
  const selectedDate = String(date || '').trim();
  const boardItems = Array.isArray(airportBoard?.items) ? airportBoard.items : [];
  const boardError = String(airportBoard?.error || '').trim();
  const boardLoading = Boolean(airportBoard?.loading);
  const boardAirportCode = String(airportBoard?.airportCode || '').trim();
  const boardUpdatedAt = String(airportBoard?.updatedAt || '').trim();
  const boardUpdatedLabel = boardUpdatedAt
    ? new Date(boardUpdatedAt).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
    : '';

  const useDepartureTime = !hasCoordinatorLocation;

  const getRideTargetTime = (ride) => {
    const statusValue = String(ride?.aktuellerStatus || '').trim().toLowerCase();
    const isUnderway = statusValue === 'unterwegs';
    if (isUnderway) {
      return ride?.time?.arrivalTime || ride?.time?.arrivalNew || ride?.time?.new || ride?.time?.time || ride?.time?.original || '';
    }
    if (useDepartureTime) {
      if (ride?.status === 'delayed') {
        return ride?.time?.new || ride?.time?.time || ride?.time?.original || ride?.time?.arrivalNew || ride?.time?.arrivalTime || '';
      }
      return ride?.time?.time || ride?.time?.new || ride?.time?.original || ride?.time?.arrivalTime || ride?.time?.arrivalNew || '';
    }
    if (ride?.status === 'delayed') {
      return ride?.time?.arrivalNew || ride?.time?.arrivalTime || ride?.time?.new || ride?.time?.time || ride?.time?.original || '';
    }
    return ride?.time?.arrivalTime || ride?.time?.arrivalNew || ride?.time?.time || ride?.time?.new || ride?.time?.original || '';
  };

  const parseTimeToMinutes = (timeLabel) => {
    const normalized = String(timeLabel || '').trim();
    const match = normalized.match(/^(\d{1,2}):(\d{2})$/);
    if (!match) return null;
    const hours = Number.parseInt(match[1], 10);
    const minutes = Number.parseInt(match[2], 10);
    if (Number.isNaN(hours) || Number.isNaN(minutes)) return null;
    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
    return hours * 60 + minutes;
  };

  const getTodayIso = () => {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  };

  const toIsoDate = (value) => {
    const raw = String(value || '').trim();
    if (!raw) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
    const deMatch = raw.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
    if (deMatch) return `${deMatch[3]}-${deMatch[2]}-${deMatch[1]}`;
    return '';
  };

  const buildMinutesLabel = (ride) => {
    const statusValue = String(ride?.aktuellerStatus || '').trim().toLowerCase();
    if (statusValue === 'beendet') return 'Beendet';
    if (statusValue === 'stoniert') return 'Storniert';
    if (statusValue === 'unterwegs') return 'Unterwegs';
    const explicitDelay = Number(ride?.delayMins);
    if (Number.isFinite(explicitDelay) && explicitDelay > 0) {
      return `+${Math.round(explicitDelay)} min`;
    }

    const timeLabel = getRideTargetTime(ride);
    const targetMinutes = parseTimeToMinutes(timeLabel);
    if (targetMinutes == null) return '';
    const rideDateIso = toIsoDate(String(ride?.date || '').slice(0, 10));
    const todayIso = getTodayIso();
    if (rideDateIso && rideDateIso > todayIso) {
      const [, month, day] = rideDateIso.split('-');
      if (month && day) return `${day}.${month}`;
      return rideDateIso;
    }
    if (rideDateIso && rideDateIso < todayIso) return 'Überfällig';
    const now = new Date();
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    const diff = targetMinutes - nowMinutes;
    if (diff < 0) return 'Überfällig';
    if (diff === 0) return 'Jetzt';
    if (diff >= 360 && rideDateIso) {
      const [, month, day] = rideDateIso.split('-');
      if (month && day) return `${day}.${month}`;
      return rideDateIso;
    }
    if (diff >= 60) {
      const hours = Math.floor(diff / 60);
      const minutes = diff % 60;
      return `in ${hours}:${String(minutes).padStart(2, '0')} h`;
    }
    return `in ${diff} min.`;
  };

  const getRouteParts = (routeValue) => {
    const routeParts = String(routeValue || '').split(' - ');
    return {
      start: String(routeParts[0] || '').trim(),
      ziel: String(routeParts.slice(1).join(' - ') || '').trim(),
    };
  };

  const ridesWithComputedStatus = rides.map((ride) => {
    const targetTimeLabel = getRideTargetTime(ride);
    const statusLabel = buildMinutesLabel(ride);
    const statusValue = String(ride?.aktuellerStatus || '').trim().toLowerCase();
    const isUnderway = statusValue === 'unterwegs';
    return {
      ...ride,
      displayTime: ride?.status === 'delayed'
        ? {
            ...(ride.time || {}),
            original: String(
              (useDepartureTime && !isUnderway)
                ? (ride?.time?.original || ride?.time?.time || ride?.time?.new || targetTimeLabel || '--:--')
                : (ride?.time?.arrivalOriginal || ride?.time?.original || targetTimeLabel || '--:--'),
            ),
            status: statusLabel || String(ride?.time?.status || ''),
            new: String(
              (useDepartureTime && !isUnderway)
                ? (ride?.time?.new || ride?.time?.time || ride?.time?.original || targetTimeLabel || '--:--')
                : (ride?.time?.arrivalNew || ride?.time?.arrivalTime || ride?.time?.new || targetTimeLabel || '--:--'),
            ),
          }
        : {
            ...(ride.time || {}),
            status: statusLabel || String(ride?.time?.status || ''),
            time: String(
              (useDepartureTime && !isUnderway)
                ? (ride?.time?.time || ride?.time?.new || ride?.time?.original || targetTimeLabel || '--:--')
                : (ride?.time?.arrivalTime || ride?.time?.arrivalNew || ride?.time?.time || targetTimeLabel || '--:--'),
            ),
          },
      time: {
        ...(ride.time || {}),
        status: statusLabel || String(ride?.time?.status || ''),
      },
    };
  });

  const filteredRides = ridesWithComputedStatus.filter((ride) => {
    const normalizedJobStatus = String(ride?.jobStatus || '').trim().toLowerCase();
    const isArchivedRide = normalizedJobStatus === 'archived' || normalizedJobStatus === 'cancelled';
    if (showArchiveOnly && !isArchivedRide) return false;
    if (!showArchiveOnly && isArchivedRide) return false;

    const driverValue = String(ride.driver || '').trim().toLowerCase();
    const isWithoutDriverRide = driverValue === 'fahrer fehlt' || ride.variant === 'variant2';
    const isConfirmedRide = ride.confirmed == null ? !isWithoutDriverRide : Boolean(ride.confirmed);
    const { start, ziel } = getRouteParts(ride.route);
    if (withoutDriver && !isWithoutDriverRide) return false;
    if (requireConfirmation && !isConfirmedRide) return false;

    if (normalizedStartQuery && !start.toLowerCase().includes(normalizedStartQuery)) return false;
    if (normalizedZielQuery && !ziel.toLowerCase().includes(normalizedZielQuery)) return false;

    if (selectedDate) {
      const rideDate = String(ride.date || '').slice(0, 10);
      if (rideDate !== selectedDate) return false;
    }

    const hasKonvoi = String(ride.konvoi || '').trim().length > 0;
    if (konvoi && !hasKonvoi) return false;

    const hasSpecialFlag = ride.status === 'delayed';
    if (withSpecial && !hasSpecialFlag) return false;

    if (!showArchiveOnly && !includePast) {
      const rideDate = toIsoDate(String(ride.date || '').slice(0, 10));
      const todayIso = getTodayIso();
      if (rideDate && rideDate > todayIso) return true;
      if (rideDate && rideDate < todayIso) return false;
      const targetMinutes = parseTimeToMinutes(getRideTargetTime(ride));
      if (targetMinutes != null) {
        const now = new Date();
        const nowMinutes = now.getHours() * 60 + now.getMinutes();
        const rideStatus = String(ride?.aktuellerStatus || '').trim().toLowerCase();
        const isNotStarted = !['unterwegs', 'beendet', 'stoniert'].includes(rideStatus);
        if (targetMinutes < nowMinutes && !isNotStarted) return false;
      }
    }

    if (!normalizedSearch) return true;
    const rideDriverEntries = getRideDriverEntries(ride);
    const rideDriverNumbers = extractDriverNumbers(rideDriverEntries, ride.driverNumber);
    const driverNumbersJoined = rideDriverNumbers.join(' ');
    const driverHashNumbers = rideDriverNumbers.map((value) => `#${value}`).join(' ');
    const haystack = `${ride.name} ${ride.driver} ${rideDriverEntries.join(' ')} ${driverNumbersJoined} ${driverHashNumbers} ${start} ${ziel}`.toLowerCase();
    return haystack.includes(normalizedSearch);
  });
  const getRideSortMinutes = (ride) => {
    const timeLabel = String(getRideTargetTime(ride) || '').trim();
    const match = timeLabel.match(/^(\d{1,2}):(\d{2})$/);
    if (!match) return Number.POSITIVE_INFINITY;
    const hours = Number.parseInt(match[1], 10);
    const minutes = Number.parseInt(match[2], 10);
    return hours * 60 + minutes;
  };
  const getRideSortDate = (ride) => toIsoDate(String(ride?.date || '').slice(0, 10)) || '9999-12-31';
  const sortedFilteredRides = [...filteredRides].sort((a, b) => {
    const dateCompare = getRideSortDate(a).localeCompare(getRideSortDate(b));
    if (dateCompare !== 0) return dateCompare;
    return getRideSortMinutes(a) - getRideSortMinutes(b);
  });

  const mapRideToEditData = (ride) => {
    const normalizedRideId = String(ride?.rideId || ride?.id || '').trim();
    const { start, ziel } = getRouteParts(ride.route);
    const startZeit = ride.startZeit || ride.time?.new || ride.time?.time || ride.time?.original || '';
    const statusValue = ride.aktuellerStatus || (ride.driver === 'Fahrer fehlt' ? 'offen' : ride.status === 'delayed' ? 'unterwegs' : 'offen');
    const mappedDriverNames = getRideDriverEntries(ride).filter(
      (entry) => String(entry || '').trim().toLowerCase() !== MISSING_DRIVER_LABEL.toLowerCase(),
    );
    return {
      rideId: normalizedRideId,
      id: normalizedRideId,
      sourceView: 'ankuenfte',
      datum: String(ride.date || '').slice(0, 10),
      startZeit: String(startZeit),
      start: String(ride.start || start),
      ziel: String(ride.ziel || ziel),
      konvoi: ride.konvoi || '',
      anzahlFahrzeuge: String(ride.anzahlFahrzeuge || ''),
      fahrerNamen: mappedDriverNames.length > 0 ? mappedDriverNames : [''],
      anzahlFahrgaeste: String(ride.anzahlFahrgaeste || '1'),
      anonymeGaeste: String(ride.anonymeGaeste || '0'),
      fahrgaeste: ride.fahrgaeste || ride.name || '',
      flugnummer: String(ride.flugnummer || ''),
      zugnummer: String(ride.zugnummer || ''),
      anzahlKinder: String(ride.anzahlKinder || '0'),
      aktuellerStatus: statusValue,
      notes: ride.note || '',
      aiBooked: Boolean(ride.aiBooked),
    };
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

  useEffect(() => {
    let lastTouchY = 0;

    const onTouchStart = (event) => {
      if (!event.touches || event.touches.length === 0) return;
      lastTouchY = event.touches[0].clientY;
    };

    const onTouchMove = (event) => {
      const scroller = scrollRef.current;
      if (!scroller || !event.touches || event.touches.length === 0) return;

      const target = event.target;
      const isInsideScroller = target instanceof Node && scroller.contains(target);
      if (!isInsideScroller) {
        event.preventDefault();
        return;
      }

      const currentY = event.touches[0].clientY;
      const deltaY = currentY - lastTouchY;
      lastTouchY = currentY;

      const atTop = scroller.scrollTop <= 0;
      const atBottom = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 1;
      if ((atTop && deltaY > 0) || (atBottom && deltaY < 0)) {
        event.preventDefault();
      }
    };

    document.addEventListener('touchstart', onTouchStart, { passive: true });
    document.addEventListener('touchmove', onTouchMove, { passive: false });
    return () => {
      document.removeEventListener('touchstart', onTouchStart);
      document.removeEventListener('touchmove', onTouchMove);
    };
  }, []);

  return (
    <div className="w-[min(402px,100vw)] h-dvh relative mx-auto overflow-hidden" style={gradientStyle}>
      <div ref={scrollRef} className="h-full overflow-y-auto overscroll-none px-5 pt-[60px] pb-[175px]" style={{ touchAction: 'pan-y', WebkitOverflowScrolling: 'touch' }}>
        <BackCircleButton onClick={onBack} />

        <div className="mt-[30px] text-[#e3f654] text-[42px] leading-[42px] font-bold font-['Space_Grotesk']">
          {showArchiveOnly ? 'Archiv' : (hasCoordinatorLocation ? 'Meine Fahrten' : 'Alle Fahrten')}
        </div>

        <div className="mt-[22px] w-full h-14 outline outline-2 outline-[#e3f654] flex items-center px-4 gap-3">
          <span className="text-[#e3f654] text-base font-medium font-['Space_Grotesk'] opacity-70">Mein Standort</span>
          <input
            type="text"
            value={coordinatorLocation}
            onChange={(event) => onCoordinatorLocationChange(event.target.value)}
            placeholder="Ort eingeben"
            className="flex-1 bg-transparent outline-none text-[#e3f654] text-base font-medium font-['Space_Grotesk'] placeholder:text-[#e3f654] placeholder:opacity-60"
          />
          {String(coordinatorLocation || '').trim() ? (
            <button
              type="button"
              onClick={() => onCoordinatorLocationChange('')}
              aria-label="Standort löschen"
            >
              <img src="/icon/_Icon_Green/clear-x-green-24.svg" alt="" className="w-6 h-6" />
            </button>
          ) : null}
        </div>

        {hasCoordinatorLocation ? (
          <div className="mt-[12px] flex gap-[12px]">
            <button className="w-44 h-14 bg-[#e3f654] outline outline-2 outline-[#e3f654] text-black text-base font-medium font-['Space_Grotesk'] leading-6 tracking-wide px-4">
              Ankünfte
            </button>
            <button className="w-44 h-14 outline outline-2 outline-[#e3f654] text-[#e3f654] text-base font-medium font-['Space_Grotesk'] leading-6 tracking-wide px-4" onClick={onSwitchToAbfahrten}>
              Abfahrten
            </button>
          </div>
        ) : null}

        <div className="mt-[12px] flex items-center gap-[12px]">
          <button
            type="button"
            onClick={onOpenFilter}
            className={`h-14 ${!hasCoordinatorLocation ? 'w-[260px]' : 'flex-1'} bg-[#e3f654] outline outline-2 outline-[#e3f654] text-black text-base font-medium font-['Space_Grotesk'] leading-6 tracking-wide px-4 flex items-center justify-between`}
          >
            <span>Filter</span>
            <img src="/icon/_Icon_Schwarz/Filter.svg" alt="" className="w-[34px] h-[21px] object-contain" />
          </button>
          {!hasCoordinatorLocation ? (
            <button
              type="button"
              onClick={onOpenArchive}
              aria-label={showArchiveOnly ? 'Live anzeigen' : 'Archiv anzeigen'}
              className={`h-14 w-[90px] outline outline-2 outline-[#e3f654] flex items-center justify-center ${
                showArchiveOnly ? 'bg-[#e3f654]' : 'bg-black'
              }`}
            >
              <img
                src="/icon/_Icon_Lime/Archiv.svg"
                alt=""
                className={`w-8 h-8 object-contain ${showArchiveOnly ? 'brightness-0 saturate-100' : ''}`}
              />
            </button>
          ) : null}
          {hasCoordinatorLocation ? (
            <button
              type="button"
              onClick={onRefreshRides}
              aria-label="Fahrten aktualisieren"
              className="w-9 h-9 flex items-center justify-center"
            >
              <img src="/icon/_Icon_Schwarz/Arrow_Nav_Trisar_Icons_01.svg" alt="" className="w-[36px] h-[36px]" />
            </button>
          ) : null}
        </div>

        <div className="mt-[12px] w-full h-14 outline outline-2 outline-[#e3f654] flex items-center px-4">
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Kunden/Fahrer Suchen"
            className="flex-1 bg-transparent outline-none text-[#e3f654] text-base font-medium font-['Space_Grotesk'] placeholder:text-[#e3f654] placeholder:opacity-70"
          />
          <button
            type="button"
            aria-label={hasSearchTerm ? 'Suche leeren' : 'Suche'}
            onClick={() => {
              if (hasSearchTerm) setSearchTerm('');
            }}
          >
            {hasSearchTerm ? (
              <img src="/icon/_Icon_Green/clear-x-green-24.svg" alt="" className="w-6 h-6" />
            ) : (
              <img src="/icon/_Icon_Schwarz/vehicle-search.svg" alt="" className="w-6 h-6" />
            )}
          </button>
        </div>

        {ridesError ? (
          <div className="mt-4 border border-[#3a3a3a] bg-[#171717] p-3 text-[#ff8e8e] text-[12px] leading-[1.35] font-medium font-['Space_Grotesk']">
            Fahrten konnten nicht geladen werden: {ridesError}
          </div>
        ) : null}

        {hasCoordinatorLocation ? (
          <div className="mt-4 border border-[#4a4f22] bg-[#101108] p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="text-[#e3f654] text-[12px] font-bold font-['Space_Grotesk'] tracking-wide">
                Live-Board Ankünfte {boardAirportCode ? `(${boardAirportCode})` : ''}
              </div>
              <button
                type="button"
                onClick={onRefreshAirportBoard}
                className="text-[#e3f654] text-[11px] font-medium font-['Space_Grotesk'] underline"
              >
                Aktualisieren
              </button>
            </div>
            {boardUpdatedLabel ? (
              <div className="mt-1 text-[#9ea57d] text-[11px] font-medium font-['Space_Grotesk']">
                Stand: {boardUpdatedLabel}
              </div>
            ) : null}
            {boardError ? (
              <div className="mt-2 text-[#ff8e8e] text-[12px] font-medium font-['Space_Grotesk']">
                {boardError}
              </div>
            ) : null}
            {!boardError && boardLoading ? (
              <div className="mt-2 text-[#e3f654] text-[12px] font-medium font-['Space_Grotesk'] opacity-80">
                Lade Live-Flugdaten...
              </div>
            ) : null}
            {!boardError && !boardLoading && boardItems.length === 0 ? (
              <div className="mt-2 text-[#e3f654] text-[12px] font-medium font-['Space_Grotesk'] opacity-80">
                Keine Board-Einträge gefunden.
              </div>
            ) : null}
            {!boardError && boardItems.length > 0 ? (
              <div className="mt-2 space-y-1">
                {boardItems.slice(0, 5).map((item, index) => (
                  <div
                    key={`${item?.flight_number || 'flight'}-${index}`}
                    className="flex items-start justify-between gap-3 text-[12px] font-medium font-['Space_Grotesk'] text-[#e3f654]"
                  >
                    <div className="min-w-0">
                      <div className="truncate">{item?.flight_number || '---'} · {item?.route_label || '-'}</div>
                      <div className="text-[#9ea57d] truncate">
                        {item?.status_description || item?.status_code || '-'}
                        {item?.terminal ? ` · T${item.terminal}` : ''}
                        {item?.gate ? ` · G${item.gate}` : ''}
                      </div>
                    </div>
                    <div className="shrink-0">{item?.time_label || '--:--'}</div>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="mt-6 space-y-4">
          {sortedFilteredRides.map((ride, index) => (
            <RideCard
              key={ride.id || `${ride.name}-${index}`}
              {...ride}
              time={ride.displayTime || ride.time}
              enableSwipe={!hasCoordinatorLocation && !showArchiveOnly}
              onDone={() => onRideDone(ride)}
              onArchive={() => onRideArchive(ride)}
              onDuplicate={() => onRideDuplicate(ride)}
              onClick={() => onRideSelect(mapRideToEditData(ride))}
            />
          ))}
          {sortedFilteredRides.length === 0 ? (
            <div className="py-6 text-center text-[#e3f654] text-base font-medium font-['Space_Grotesk']">
              {showArchiveOnly ? 'Keine archivierten Fahrten gefunden.' : 'Keine passenden Fahrten gefunden.'}
            </div>
          ) : null}
        </div>
      </div>

      <NaviFooterKomponente
        onNavigateHome={onNavigateHome}
        onNavigateToFahrten={onNavigateToFahrten}
        onNavigateToAddFahrt={onNavigateToAddFahrt}
        onNavigateToKi={onNavigateToKi}
        onNavigateToMap={onNavigateToMap}
        activeTab="fahrten"
      />
    </div>
  );
}
