import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import NaviFooterKomponente from '../navigation/NaviFooterKomponente';
import BackCircleButton from '../ui/BackCircleButton';
import { hasSupabaseConfig, supabase } from '../../services/supabase';

const DRIVERS_RELOAD_EVENT = 'trisar:ko:drivers:reload';
const SELECTED_DRIVERS_STORAGE_KEY = 'trisar:ko:allefahrer:selected-driver-ids';
let anonymousAuthUnavailable = false;

const ensureDriversRealtimeSession = async () => {
  try {
    if (anonymousAuthUnavailable) return false;
    const { data } = await supabase.auth.getSession();
    if (data?.session) return true;
    // Kein signInAnonymously mehr: verhindert 422-Spam bei deaktivierter anonymer Auth.
    anonymousAuthUnavailable = true;
    return false;
  } catch {
    return false;
  }
};

const MISSING_SCHEMA_SQL = `-- Falls noch nicht vorhanden:
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'fahrer';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS vehicle_id UUID REFERENCES public.vehicles(id) ON DELETE SET NULL;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS driver_number BIGINT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS service_start_time TIME;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS service_end_time TIME;
ALTER TABLE public.vehicles ADD COLUMN IF NOT EXISTS license_plate TEXT;`;

const normalizeClockValue = (value) => {
  const match = String(value || '').trim().match(/^(\d{1,2}):(\d{2})/);
  if (!match) return '';
  const hours = Number.parseInt(match[1], 10);
  const minutes = Number.parseInt(match[2], 10);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return '';
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return '';
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
};

const formatClockDisplay = (value) => normalizeClockValue(value);

const formatServiceTimeStack = (startValue, endValue) => {
  const start = formatClockDisplay(startValue) || '--:--';
  const end = formatClockDisplay(endValue) || '--:--';
  return {
    startLine: start,
    endLine: `- ${end}`,
  };
};

const normalizePlanRequestStatus = (statusValue) => {
  const normalized = String(statusValue || '').trim().toLowerCase();
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

const SWIPE_ACTION_WIDTH = 90;
const SWIPE_OPEN_THRESHOLD = 36;
const SWIPE_TRIGGER_THRESHOLD = 124;
const SWIPE_MAX_OFFSET = 160;
const SWIPE_LOCK_THRESHOLD = 14;
const SWIPE_SUPPRESS_CLICK_THRESHOLD = 18;
const SWIPE_ICON_SIZE = 34;
const DRIVER_NAME_MAX_FONT_SIZE = 30;
const DRIVER_NAME_MIN_FONT_SIZE = 8;

const SwipeActionButton = ({ icon, alt, side, onPress, onReset, iconLeft }) => (
  <button
    type="button"
    aria-label={alt}
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

function DriverCard({ driver, isSelected = false, onToggleSelect = () => {}, onEdit = () => {} }) {
  const plate = String(driver.vehicle || '').trim();
  const vehicleText = plate || 'Kein Fahrzeug zugewiesen';
  const driverNumberLabel = driver.driverNumber != null ? String(driver.driverNumber) : '-';
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
    onToggleSelect(driver);
    setOffsetX(0);
  };
  const runRightAction = () => {
    onEdit?.(driver);
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
    onEdit?.(driver);
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
    <div className="w-[360px] h-[87px] relative text-left overflow-hidden">
      <div className="absolute inset-y-0 left-0 bg-[#E3F654]" style={{ width: `${SWIPE_MAX_OFFSET}px` }}>
        <SwipeActionButton
          icon="/icon/_Icon_Schwarz/Faecher_Done.svg"
          alt={isSelected ? `${driver.name} demarkieren` : `${driver.name} markieren`}
          side="left"
          onPress={runLeftAction}
          onReset={() => setOffsetX(0)}
          iconLeft={leftIconLeft}
        />
      </div>
      <div className="absolute inset-y-0 right-0 bg-[#E3F654]" style={{ width: `${SWIPE_MAX_OFFSET}px` }}>
        <SwipeActionButton
          icon="/icon/_Icon_Schwarz/Edit_Trisar_Icon_01.svg"
          alt="Fahrer bearbeiten"
          side="right"
          onPress={runRightAction}
          onReset={() => setOffsetX(0)}
          iconLeft={rightIconLeft}
        />
      </div>

      <div
        role="button"
        tabIndex={0}
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
        className="absolute inset-0 bg-[#f4f4f4] border-2 touch-pan-y"
        style={{
          borderColor: isSelected ? '#E3F654' : 'transparent',
          transform: `translate3d(${offsetX}px, 0, 0)`,
          transition: isDragging ? 'none' : 'transform 220ms ease',
        }}
      >
        <div
          ref={nameRef}
          className="absolute left-[22px] top-[12px] w-[250px] whitespace-nowrap overflow-hidden text-[#1d1c1d] leading-[1] font-bold font-['Space_Grotesk']"
          style={{ fontSize: `${nameFontSize}px` }}
        >
          {driver.name}
        </div>
        <div className="absolute left-[22px] top-[55px] text-[#54545a] text-[16px] leading-[1] font-medium font-['Space_Grotesk'] tracking-[0.5px]">
          {vehicleText}
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

export default function AlleFahrer({ setView, onCreateDriver, onEditDriver, onNavigateToMapWithDrivers }) {
  const [searchTerm, setSearchTerm] = useState('');
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const [isCompactDevice, setIsCompactDevice] = useState(() => window.matchMedia('(max-width: 1024px)').matches);
  const [keyboardInset, setKeyboardInset] = useState(0);
  const [drivers, setDrivers] = useState([]);
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
  const [loadingDrivers, setLoadingDrivers] = useState(true);
  const [driversError, setDriversError] = useState('');
  const stableViewportHeightRef = useRef(window.innerHeight);
  const hasLoadedDriversRef = useRef(false);
  const preferredProfilesSelectRef = useRef('');

  const gradientStyle = useMemo(
    () => ({
      background: 'radial-gradient(ellipse 141.42% 102.21% at 0.00% -0.00%, #313701 0%, black 46%, black 84%, black 100%)',
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
        const name = [row?.first_name, row?.last_name].filter(Boolean).join(' ').trim() || 'Ohne Name';
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
          serviceStartTime: normalizeClockValue(row?.service_start_time),
          serviceEndTime: normalizeClockValue(row?.service_end_time),
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
        setDriversError(
          'Supabase nicht konfiguriert. Bitte in koordinaten-app-lokal/.env.local setzen:\nVITE_SUPABASE_URL=https://<project-ref>.supabase.co\nVITE_SUPABASE_ANON_KEY=<anon-public-key>',
        );
        setLoadingDrivers(false);
        return;
      }

      const selectWithAuthRelation = 'id, first_name, last_name, email, created_at, vehicle_id, role, is_dispo, driver_number, service_start_time, service_end_time, vehicles:vehicle_id(license_plate), auth_user:auth.users!profiles_id_fkey(email)';
      const selectWithEmail = 'id, first_name, last_name, email, created_at, vehicle_id, role, is_dispo, driver_number, service_start_time, service_end_time, vehicles:vehicle_id(license_plate)';
      const selectWithoutEmail = 'id, first_name, last_name, created_at, vehicle_id, role, is_dispo, driver_number, service_start_time, service_end_time, vehicles:vehicle_id(license_plate)';
      const candidatesBase = [selectWithAuthRelation, selectWithEmail, selectWithoutEmail];
      const candidates = preferredProfilesSelectRef.current
        ? [
            preferredProfilesSelectRef.current,
            ...candidatesBase.filter((entry) => entry !== preferredProfilesSelectRef.current),
          ]
        : candidatesBase;

      let primary = null;
      let successfulSelect = '';
      for (const selectClause of candidates) {
        const attempt = await supabase
          .from('profiles')
          .select(selectClause)
          .order('last_name', { ascending: true, nullsFirst: false })
          .order('first_name', { ascending: true, nullsFirst: false });
        if (!attempt.error) {
          primary = attempt;
          successfulSelect = selectClause;
          break;
        }
        primary = attempt;
      }

      if (!primary.error) {
        if (!isMounted) return;
        preferredProfilesSelectRef.current = successfulSelect || preferredProfilesSelectRef.current;
        const mapped = mapRowsToDrivers(primary.data || []);
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
            console.error('❌ driver_service_requests konnte nicht gelesen werden (AlleFahrer/Koordinator):', planResult.error);
          }
        }
        const mappedWithPlanStatus = mapped.map((entry) => {
          const plan = latestPlanByDriver.get(String(entry?.id || '').trim());
          return {
            ...entry,
            planRequestStatus: plan?.status || '',
            serviceStartTime: plan?.serviceStartTime || entry.serviceStartTime,
            serviceEndTime: plan?.serviceEndTime || entry.serviceEndTime,
          };
        });
        setDrivers(mappedWithPlanStatus);
        hasLoadedDriversRef.current = true;
        setLoadingDrivers(false);
        return;
      }

      const wrongKey = /no suitable key|wrong key type|jwt|invalid api key|unauthorized/i.test(primary.error.message || '');
      if (wrongKey) {
        if (!isMounted) return;
        if (!hasLoadedDriversRef.current) {
          setDrivers([]);
        }
        setDriversError(
          'Supabase-Key ist ungültig oder falscher Typ. Nutze den anon public key (nicht service_role) in koordinaten-app-lokal/.env.local als VITE_SUPABASE_ANON_KEY.',
        );
        setLoadingDrivers(false);
        return;
      }
      if (!isMounted) return;
      if (!hasLoadedDriversRef.current) {
        setDrivers([]);
      }
      const schemaMaybeMissing = /vehicle_id|license_plate|driver_number|service_start_time|service_end_time|relation .*vehicles|column .*is_dispo|column .*role/i.test(primary.error.message || '');
      setDriversError(schemaMaybeMissing ? `DB-Schema unvollständig. Bitte ausführen:\n${MISSING_SCHEMA_SQL}` : primary.error.message || 'Fahrer konnten nicht geladen werden.');
      setLoadingDrivers(false);
      return;
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
          .channel(`ko-drivers-live-${Date.now()}`)
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
    if (searchTerms.length === 0) return visibleDrivers;

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

    return visibleDrivers
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
  }, [searchTerm, visibleDrivers]);

  const selectedDriverIdSet = useMemo(
    () => new Set((selectedDriverIds || []).map((id) => String(id || '').trim()).filter(Boolean)),
    [selectedDriverIds],
  );

  const selectedDriversCount = selectedDriverIdSet.size;

  const handleBack = () => {
    setView('list');
  };

  const handleToggleDriverSelection = (driver) => {
    const driverId = String(driver?.id || '').trim();
    if (!driverId) return;
    setSelectedDriverIds((prev) => {
      const normalized = new Set((prev || []).map((id) => String(id || '').trim()).filter(Boolean));
      if (normalized.has(driverId)) {
        normalized.delete(driverId);
      } else {
        normalized.add(driverId);
      }
      return Array.from(normalized);
    });
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
    const selected = Array.from(selectedDriverIdSet);
    const selectedNames = visibleDrivers
      .filter((driver) => selectedDriverIdSet.has(String(driver?.id || '').trim()))
      .map((driver) => String(driver?.name || '').trim())
      .filter(Boolean);
    if (typeof onNavigateToMapWithDrivers === 'function') {
      onNavigateToMapWithDrivers(selected, selectedNames);
      return;
    }
    setView('karten');
  };

  const isMobileKeyboardMode = isCompactDevice && isSearchFocused && keyboardInset > 80;
  const hasSearchTerm = searchTerm.trim().length > 0;

  return (
    <div className="w-[min(402px,100vw)] h-dvh relative mx-auto overflow-hidden overscroll-none" style={gradientStyle}>
      <div className="h-full overflow-y-auto overflow-x-hidden overscroll-none px-[20px] pt-[60px] pb-[175px]">
        <BackCircleButton onClick={handleBack} />

        <h1 className="mt-[30px] text-[#E3F654] text-[42px] leading-[42px] font-bold font-['Space_Grotesk']">Alle Fahrer</h1>

        <div className="mt-[24px] w-[360px] h-[56px] border-2 border-[#E3F654] flex items-center justify-between px-[16px]">
          <input
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            onFocus={() => setIsSearchFocused(true)}
            onBlur={() => setIsSearchFocused(false)}
            placeholder="Fahrer Suchen"
            className="w-full bg-transparent border-none outline-none text-[#E3F654] text-[16px] font-medium font-['Space_Grotesk'] placeholder:text-[#E3F654] placeholder:opacity-90 tracking-[0.5px]"
          />
          {hasSearchTerm ? (
            <button
              type="button"
              onClick={() => setSearchTerm('')}
              aria-label="Fahrer-Suche zurücksetzen"
              className="w-[38px] h-[38px] flex items-center justify-center"
            >
              <img src="/icon/_Icon_Green/clear-field-green.svg" alt="" className="w-5 h-5" />
            </button>
          ) : (
            <img src="/icon/_Icon_Schwarz/alle-fahrer-search.svg" alt="" className="w-[38px] h-[38px]" />
          )}
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
          className="mt-[12px] w-[360px] h-[56px] bg-[#E3F654] border-2 border-[#E3F654] flex items-center justify-between px-[16px]"
        >
          <span className="text-[#1d1c1d] text-[16px] font-medium font-['Space_Grotesk'] tracking-[0.5px]">Fahrer erstellen</span>
          <img src="/icon/_Icon_Schwarz/Arrow_Trisar_Icons_01.svg" alt="" className="w-[34px] h-[21px]" />
        </button>

        {selectedDriversCount > 0 ? (
          <div className="mt-[10px] w-[360px] text-[#E3F654] text-[14px] leading-[1.2] font-medium font-['Space_Grotesk']">
            {selectedDriversCount} Fahrer markiert
          </div>
        ) : null}

        <div className="mt-[24px] space-y-[12px]">
          {loadingDrivers ? (
            <div className="text-[#E3F654] text-[16px] font-medium font-['Space_Grotesk']">Fahrer werden geladen ...</div>
          ) : null}
          {!loadingDrivers && driversError ? (
            <div className="bg-[#171717] border border-[#3a3a3a] p-4 whitespace-pre-line text-[#ff8e8e] text-[13px] leading-[1.4] font-medium font-['Space_Grotesk']">
              {driversError}
            </div>
          ) : null}
          {!loadingDrivers && !driversError && filteredDrivers.length === 0 ? (
            <div className="text-[#E3F654] text-[16px] font-medium font-['Space_Grotesk']">
              Keine Fahrer sichtbar. Prüfe bitte, ob in `profiles` Fahrer mit `is_dispo = false` existieren, `driver_number` gepflegt ist und ob RLS den Zugriff erlaubt.
            </div>
          ) : null}
          {filteredDrivers.map((driver) => (
            <DriverCard
              key={driver.id}
              driver={driver}
              isSelected={selectedDriverIdSet.has(String(driver?.id || '').trim())}
              onToggleSelect={handleToggleDriverSelection}
              onEdit={(driverRow) => {
                if (selectedDriversCount > 0) {
                  handleToggleDriverSelection(driverRow);
                  return;
                }
                onEditDriver?.(driverRow);
              }}
            />
          ))}
        </div>
      </div>

      {!isMobileKeyboardMode ? (
        <NaviFooterKomponente
          onNavigateHome={() => setView('list')}
          onNavigateToFahrten={() => setView('ankuenfte')}
          onNavigateToAddFahrt={() => setView('fahrtAdd')}
          onNavigateToKi={() => setView('kiAssistent')}
          onNavigateToMap={handleNavigateToMap}
          activeTab="home"
        />
      ) : null}
    </div>
  );
}
