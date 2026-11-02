import { useEffect, useMemo, useRef, useState } from 'react';
import BackCircleButton from '../ui/BackCircleButton';
import { planDriverShiftsWithOllama } from '../../services/kiDriverPlanner';
import { hasSupabaseAdminConfig, hasSupabaseConfig, supabase, supabaseAdmin } from '../../services/supabase';

const CHART_START_HOUR = 6;
const CHART_END_HOUR = 23;
const CHART_HOURS = Array.from({ length: CHART_END_HOUR - CHART_START_HOUR + 1 }, (_, index) => CHART_START_HOUR + index);
const normalizeDemandProfile = (values) =>
  CHART_HOURS.map((_, index) => Math.max(0, Number.parseInt(String(values?.[index] ?? 0), 10) || 0));

const normalizeClockValue = (value) => {
  const text = String(value || '').trim();
  const match = text.match(/^(\d{1,2}):(\d{2})/) || text.match(/T(\d{1,2}):(\d{2})/) || text.match(/(\d{1,2}):(\d{2})/);
  if (!match) return '';
  const groups = match.slice(1).filter((part) => part != null);
  const hours = Number.parseInt(groups[0], 10);
  const minutes = Number.parseInt(groups[1], 10);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return '';
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return '';
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
};

const getTodayIsoDate = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};

const buildHourlyRideCounts = (targetRides) => {
  const counts = CHART_HOURS.map(() => 0);
  (Array.isArray(targetRides) ? targetRides : []).forEach((ride) => {
    const etd = normalizeClockValue(ride?.etd);
    if (!etd) return;
    const hour = Number.parseInt(etd.split(':')[0], 10);
    if (!Number.isFinite(hour)) return;
    const slot = hour - CHART_START_HOUR;
    if (slot < 0 || slot >= counts.length) return;
    counts[slot] += 1;
  });
  return counts;
};

const filterRidesByDate = (rideList, targetDate, todayIsoDate) =>
  (Array.isArray(rideList) ? rideList : []).filter((ride) => {
    const rideDate = String(ride?.ride_date || '').trim();
    if (!rideDate) return targetDate === todayIsoDate;
    return rideDate === targetDate;
  });

export default function AiDienstplanView({
  onClose,
  drivers = [],
  rides = [],
  hourlyDriverCounts = [],
  hourlyRideCounts = [],
  initialDemandProfile = [],
  initialDemandCustomized = false,
  onDemandProfileChange,
  onDemandCustomizedChange,
  onApplySuggestions,
}) {
  const todayIsoDate = useMemo(() => getTodayIsoDate(), []);
  const [serviceDate, setServiceDate] = useState(getTodayIsoDate());
  const [maxWorkHours, setMaxWorkHours] = useState(10);
  const [minWorkHours, setMinWorkHours] = useState(4);
  const [minPauseHours, setMinPauseHours] = useState(3);
  const [bufferMinutes, setBufferMinutes] = useState(20);
  const [demandProfile, setDemandProfile] = useState(() => {
    const initial = normalizeDemandProfile(initialDemandProfile);
    if (initialDemandCustomized || initial.some((value) => value > 0)) return initial;
    return normalizeDemandProfile(hourlyRideCounts);
  });
  const demandProfileRef = useRef(
    (() => {
      const initial = normalizeDemandProfile(initialDemandProfile);
      if (initialDemandCustomized || initial.some((value) => value > 0)) return initial;
      return normalizeDemandProfile(hourlyRideCounts);
    })(),
  );
  const [draggingIndex, setDraggingIndex] = useState(null);
  const draggingIndexRef = useRef(null);
  const [isDemandCustomized, setIsDemandCustomized] = useState(Boolean(initialDemandCustomized));
  const isDemandCustomizedRef = useRef(Boolean(initialDemandCustomized));
  const [suggestions, setSuggestions] = useState([]);
  const [vehicles, setVehicles] = useState([]);
  const [fleetKpis, setFleetKpis] = useState(null);
  const [expandedSuggestionIds, setExpandedSuggestionIds] = useState(() => new Set());

  useEffect(() => {
    let cancelled = false;
    const loadVehicles = async () => {
      if (!hasSupabaseConfig) return;
      let result = await supabase.from('vehicles').select('*').order('brand_model', { ascending: true });
      if ((result.error || (Array.isArray(result.data) ? result.data : []).length === 0) && hasSupabaseAdminConfig) {
        result = await supabaseAdmin.from('vehicles').select('*').order('brand_model', { ascending: true });
      }
      if (!cancelled && !result.error && Array.isArray(result.data)) {
        setVehicles(result.data);
      }
    };
    loadVehicles();
    return () => {
      cancelled = true;
    };
  }, []);
  const [warnings, setWarnings] = useState([]);
  const [unassignedRideIds, setUnassignedRideIds] = useState([]);
  const [sourceLabel, setSourceLabel] = useState('');
  const [isPlanning, setIsPlanning] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [isRidesLoading, setIsRidesLoading] = useState(false);
  const [planningLog, setPlanningLog] = useState([]);
  const [ridesForServiceDate, setRidesForServiceDate] = useState(() =>
    filterRidesByDate(rides, getTodayIsoDate(), getTodayIsoDate()),
  );

  const rideDetailsById = useMemo(() => {
    const map = new Map();
    (Array.isArray(ridesForServiceDate) ? ridesForServiceDate : []).forEach((ride) => {
      const id = String(ride?.id || '').trim();
      if (!id) return;
      const pickup = String(ride?.pickup_name || ride?.pickup_address || 'Unbekannt').trim();
      const dropoff = String(ride?.dropoff_name || ride?.dropoff_address || 'Unbekannt').trim();
      const etd = normalizeClockValue(ride?.etd);
      map.set(id, { pickup, dropoff, etd });
    });
    return map;
  }, [ridesForServiceDate]);

  const markDemandCustomized = () => {
    if (isDemandCustomizedRef.current) return;
    isDemandCustomizedRef.current = true;
    setIsDemandCustomized(true);
    if (typeof onDemandCustomizedChange === 'function') onDemandCustomizedChange(true);
  };

  const resetDemandCustomization = () => {
    isDemandCustomizedRef.current = false;
    setIsDemandCustomized(false);
    if (typeof onDemandCustomizedChange === 'function') onDemandCustomizedChange(false);
  };

  const appendPlanningLog = (text) => {
    const line = String(text || '').trim();
    if (!line) return;
    const timestamp = new Date().toLocaleTimeString('de-DE', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    setPlanningLog((prev) => [...prev.slice(-17), `[${timestamp}] ${line}`]);
  };

  const setDemandProfileWithRef = (nextOrUpdater) => {
    setDemandProfile((prev) => {
      const computed = typeof nextOrUpdater === 'function' ? nextOrUpdater(prev) : nextOrUpdater;
      const normalized = normalizeDemandProfile(Array.isArray(computed) ? computed : []);
      demandProfileRef.current = normalized;
      if (typeof onDemandProfileChange === 'function') onDemandProfileChange(normalized);
      return normalized;
    });
  };

  const driverNameById = useMemo(() => {
    const map = new Map();
    (Array.isArray(drivers) ? drivers : []).forEach((driver, index) => {
      const id = String(driver?.id || '').trim();
      if (!id) return;
      const name = String(driver?.name || '').trim() || `Fahrer #${index + 1}`;
      map.set(id, name);
    });
    return map;
  }, [drivers]);

  useEffect(() => {
    let isCancelled = false;
    const fallbackFromProps = filterRidesByDate(rides, serviceDate, todayIsoDate);
    const loadRidesForDate = async () => {
      if (!hasSupabaseConfig) {
        setRidesForServiceDate(fallbackFromProps);
        return;
      }
      setIsRidesLoading(true);
      try {
        const readClient = hasSupabaseAdminConfig ? supabaseAdmin : supabase;
        const result = await readClient
          .from('jobs')
          .select('id, ride_date, etd, status, pickup_name, pickup_address, dropoff_name, dropoff_address, ext_route_duration_mins, ext_route_duration_in_traffic_mins')
          .eq('ride_date', serviceDate);
        if (isCancelled) return;
        if (result.error) {
          setRidesForServiceDate(fallbackFromProps);
          return;
        }
        setRidesForServiceDate(Array.isArray(result.data) ? result.data : []);
      } finally {
        if (!isCancelled) setIsRidesLoading(false);
      }
    };
    loadRidesForDate();
    return () => {
      isCancelled = true;
    };
  }, [rides, serviceDate, todayIsoDate]);

  const baseDemandProfile = useMemo(() => {
    const rideBasedCounts = buildHourlyRideCounts(ridesForServiceDate);
    const hasRideCounts = rideBasedCounts.some((value) => value > 0);
    if (hasRideCounts) return rideBasedCounts;
    if (serviceDate === todayIsoDate) {
      return CHART_HOURS.map((_, index) => Math.max(0, Number.parseInt(String(hourlyRideCounts[index] || 0), 10) || 0));
    }
    return CHART_HOURS.map(() => 0);
  }, [ridesForServiceDate, serviceDate, todayIsoDate, hourlyRideCounts]);

  useEffect(() => {
    if (isDemandCustomizedRef.current) return;
    setDemandProfileWithRef(baseDemandProfile);
  }, [baseDemandProfile]);

  const chartGeometry = useMemo(() => {
    const width = 356;
    const height = 220;
    const paddingLeft = 44;
    const paddingRight = 14;
    const paddingTop = 26;
    const paddingBottom = 38;
    const plotWidth = width - paddingLeft - paddingRight;
    const plotHeight = height - paddingTop - paddingBottom;
    const slotWidth = plotWidth / CHART_HOURS.length;
    const maxValue = Math.max(1, ...hourlyDriverCounts, ...demandProfile);
    return {
      width,
      height,
      paddingLeft,
      paddingRight,
      paddingTop,
      paddingBottom,
      plotWidth,
      plotHeight,
      slotWidth,
      maxValue,
      baselineY: paddingTop + plotHeight,
    };
  }, [hourlyDriverCounts, demandProfile]);

  const toY = (value) => {
    const normalized = Math.max(0, Number(value) || 0);
    return chartGeometry.paddingTop + (chartGeometry.plotHeight - (normalized / chartGeometry.maxValue) * chartGeometry.plotHeight);
  };

  const toDemandValueFromPointer = (clientY, target) => {
    const rect = target.getBoundingClientRect();
    const y = clientY - rect.top;
    const clampedY = Math.max(chartGeometry.paddingTop, Math.min(chartGeometry.baselineY, y));
    const normalized = (chartGeometry.baselineY - clampedY) / chartGeometry.plotHeight;
    return Math.max(0, Math.round(normalized * chartGeometry.maxValue));
  };

  const toDemandIndexFromPointer = (clientX, target) => {
    const rect = target.getBoundingClientRect();
    const x = clientX - rect.left;
    const minX = chartGeometry.paddingLeft;
    const maxX = chartGeometry.width - chartGeometry.paddingRight;
    const clampedX = Math.max(minX, Math.min(maxX, x));
    const rawIndex = Math.floor((clampedX - chartGeometry.paddingLeft) / chartGeometry.slotWidth);
    return Math.max(0, Math.min(CHART_HOURS.length - 1, rawIndex));
  };

  const yTickValues = useMemo(() => {
    const max = chartGeometry.maxValue;
    const half = Math.max(0, Math.round(max / 2));
    const quarter = Math.max(0, Math.round(max / 4));
    return Array.from(new Set([0, quarter, half, max])).sort((a, b) => b - a);
  }, [chartGeometry.maxValue]);

  const contentMinHeight = useMemo(() => {
    const suggestionRowsHeight = suggestions.length === 0 ? 76 : (suggestions.length * 168);
    return Math.max(1720, 930 + 28 + suggestionRowsHeight + 80);
  }, [suggestions.length]);

  const updateDemandFromCoordinates = (clientX, clientY, target) => {
    markDemandCustomized();
    const nextIndex = toDemandIndexFromPointer(clientX, target);
    const nextValue = toDemandValueFromPointer(clientY, target);
    const previousIndex = draggingIndexRef.current;
    setDemandProfileWithRef((prev) => {
      const next = [...prev];
      if (previousIndex != null && previousIndex !== nextIndex) {
        const from = Math.min(previousIndex, nextIndex);
        const to = Math.max(previousIndex, nextIndex);
        for (let i = from; i <= to; i += 1) {
          next[i] = nextValue;
        }
      } else {
        next[nextIndex] = nextValue;
      }
      return next;
    });
    draggingIndexRef.current = nextIndex;
    setDraggingIndex(nextIndex);
  };

  const handlePlan = async () => {
    setError('');
    setSuccess('');
    setPlanningLog([]);
    appendPlanningLog('Planung gestartet.');
    const demandForPlanning = Array.isArray(demandProfileRef.current) ? demandProfileRef.current : demandProfile;
    appendPlanningLog(`Aktive Bedarfslinie: Summe ${demandForPlanning.reduce((sum, value) => sum + (Number(value) || 0), 0)}.`);
    appendPlanningLog(`Regeln: minArbeit=${minWorkHours}h, maxArbeit=${maxWorkHours}h, minPause=${minPauseHours}h, Puffer=${bufferMinutes}min.`);
    setIsPlanning(true);
    try {
      const result = await planDriverShiftsWithOllama({
        drivers: (Array.isArray(drivers) ? drivers : []).map((driver) => ({
          id: String(driver?.id || '').trim(),
          name: String(driver?.name || '').trim(),
          service_start_time: normalizeClockValue(driver?.serviceStartTime),
          service_end_time: normalizeClockValue(driver?.serviceEndTime),
        })),
        rides: ridesForServiceDate,
        vehicles,
        serviceDate,
        settings: {
          maxWorkHours,
          minWorkHours,
          minPauseHours,
          bufferMinutes,
        },
        demandProfile: demandForPlanning,
        onProgress: appendPlanningLog,
      });

      const vehiclePlanByDriverId = new Map(
        (Array.isArray(result?.vehicle_plans) ? result.vehicle_plans : [])
          .map((plan) => [String(plan?.driver_id || '').trim(), plan])
          .filter(([driverId]) => Boolean(driverId)),
      );

      const normalizedSuggestions = (Array.isArray(result?.suggestions) ? result.suggestions : []).map((entry, index) => {
        const driverId = String(entry?.driver_id || '').trim();
        const fallbackName = driverNameById.get(driverId) || `Fahrer #${index + 1}`;
        const vehiclePlan = vehiclePlanByDriverId.get(driverId) || null;
        return {
          id: `${driverId || `driver-${index}`}-${index}`,
          driverId,
          driverName: String(entry?.driver_name || '').trim() || fallbackName,
          serviceStart: normalizeClockValue(entry?.service_start),
          serviceEnd: normalizeClockValue(entry?.service_end),
          assignedRidesCount: Math.max(0, Number.parseInt(String(entry?.assigned_rides_count || 0), 10) || 0),
          assignedRideIds: Array.isArray(entry?.assigned_ride_ids) ? entry.assigned_ride_ids : [],
          note: String(entry?.note || '').trim(),
          vehicleLabel: String(vehiclePlan?.vehicle_label || '').trim(),
          vehicleIsEv: Boolean(vehiclePlan?.is_ev),
          shiftKm: Number.isFinite(Number(vehiclePlan?.shift_km)) ? Number(vehiclePlan.shift_km) : null,
          chargeStopCount: Array.isArray(vehiclePlan?.charge_stops) ? vehiclePlan.charge_stops.length : 0,
          vehicleNote: String(vehiclePlan?.note || '').trim(),
          accepted: true,
        };
      });

      setSuggestions(normalizedSuggestions);
      setFleetKpis(result?.fleet_kpis || null);
      setExpandedSuggestionIds(new Set());
      setWarnings(Array.isArray(result?.warnings) ? result.warnings : []);
      setUnassignedRideIds(Array.isArray(result?.unassigned_ride_ids) ? result.unassigned_ride_ids : []);
      setSourceLabel(String(result?.source || 'heuristic'));
      appendPlanningLog(`Solver-Quelle (final): ${String(result?.source || 'heuristic')}.`);
      appendPlanningLog(`Planung abgeschlossen. Quelle: ${String(result?.source || 'heuristic')}.`);
    } catch (planError) {
      setError(planError?.message || 'KI-Plan konnte nicht erzeugt werden.');
      appendPlanningLog(`Fehler: ${planError?.message || 'KI-Plan konnte nicht erzeugt werden.'}`);
    } finally {
      setIsPlanning(false);
    }
  };

  const handleApply = async () => {
    if (typeof onApplySuggestions !== 'function') return;
    setError('');
    setSuccess('');
    const acceptedRows = suggestions
      .filter((entry) => entry.accepted)
      .map((entry) => ({
        driverId: String(entry.driverId || '').trim(),
        driverName: String(entry.driverName || '').trim(),
        serviceStart: normalizeClockValue(entry.serviceStart),
        serviceEnd: normalizeClockValue(entry.serviceEnd),
      }))
      .filter((entry) => entry.driverId && entry.serviceStart && entry.serviceEnd);
    if (acceptedRows.length === 0) {
      setError('Bitte mindestens einen Vorschlag mit gültigen Zeiten auswählen.');
      return;
    }
    setIsApplying(true);
    try {
      const result = await onApplySuggestions({
        serviceDate,
        rows: acceptedRows,
      });
      if (!result?.ok) {
        setError(result?.error || 'Vorschläge konnten nicht übernommen werden.');
        return;
      }
      setSuccess(result?.message || `Dienstplan für ${acceptedRows.length} Fahrer übernommen.`);
    } finally {
      setIsApplying(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[240] bg-black">
      <div className="w-[min(402px,100vw)] h-dvh relative mx-auto overflow-hidden" style={{ background: 'radial-gradient(ellipse 141.42% 102.21% at 0% 0%, #0048CF 0%, black 46%, black 84%, black 100%)' }}>
        <div className="h-full overflow-y-auto overflow-x-hidden pb-[40px]">
          <div className="relative" style={{ minHeight: `${contentMinHeight}px` }}>
          <div className="absolute left-[20px] top-[60px] z-20">
            <BackCircleButton onClick={onClose} />
          </div>

          <div className="absolute left-[24px] top-[140px]">
            <div className="text-[#E3F654] text-[36px] leading-[1] font-bold font-['Space_Grotesk']">KI Planer</div>
            <div className="mt-[8px] text-white/70 text-[13px] font-medium font-['Space_Grotesk']">
              CP-SAT Dienst- und Fahrzeugplanung mit editierbarer Fahrtenlinie
            </div>
          </div>

          <div className="absolute left-[24px] top-[220px] w-[356px] bg-[#0F0F0F] outline outline-2 outline-offset-[-1px] outline-[#E3F654]/40 px-[10px] py-[10px]">
            <div className="flex items-center justify-between">
              <div className="text-[#E3F654] text-[13px] font-semibold font-['Space_Grotesk']">Planungsdiagramm</div>
              <button
                type="button"
                onClick={() => {
                  setDemandProfileWithRef(baseDemandProfile);
                  resetDemandCustomization();
                }}
                className="h-[24px] px-[8px] border border-[#E3F654]/60 text-[#E3F654] text-[10px] font-semibold font-['Space_Grotesk']"
              >
                Bedarf reset
              </button>
            </div>
            <div className="mt-[2px] text-white/45 text-[10px] font-medium font-['Space_Grotesk']">
              Fahrten am {serviceDate}: {isRidesLoading ? 'lade ...' : ridesForServiceDate.length} | Linie: {isDemandCustomized ? 'manuell' : 'auto'}
            </div>
            <svg
              width={chartGeometry.width}
              height={chartGeometry.height}
              className="mt-[6px]"
              style={{ touchAction: 'none' }}
              onPointerDown={(event) => {
                event.preventDefault();
                draggingIndexRef.current = toDemandIndexFromPointer(event.clientX, event.currentTarget);
                updateDemandFromCoordinates(event.clientX, event.clientY, event.currentTarget);
                event.currentTarget.setPointerCapture(event.pointerId);
              }}
              onPointerMove={(event) => {
                if (draggingIndexRef.current == null) return;
                updateDemandFromCoordinates(event.clientX, event.clientY, event.currentTarget);
              }}
              onPointerUp={() => {
                draggingIndexRef.current = null;
                setDraggingIndex(null);
              }}
              onPointerCancel={() => {
                draggingIndexRef.current = null;
                setDraggingIndex(null);
              }}
              onPointerLeave={() => {
                if (draggingIndexRef.current == null) return;
                draggingIndexRef.current = null;
                setDraggingIndex(null);
              }}
              onTouchStart={(event) => {
                const touch = event.touches?.[0];
                if (!touch) return;
                event.preventDefault();
                draggingIndexRef.current = toDemandIndexFromPointer(touch.clientX, event.currentTarget);
                updateDemandFromCoordinates(touch.clientX, touch.clientY, event.currentTarget);
              }}
              onTouchMove={(event) => {
                const touch = event.touches?.[0];
                if (!touch || draggingIndexRef.current == null) return;
                event.preventDefault();
                updateDemandFromCoordinates(touch.clientX, touch.clientY, event.currentTarget);
              }}
              onTouchEnd={() => {
                draggingIndexRef.current = null;
                setDraggingIndex(null);
              }}
              onClick={(event) => {
                if (draggingIndexRef.current != null) return;
                updateDemandFromCoordinates(event.clientX, event.clientY, event.currentTarget);
                draggingIndexRef.current = null;
                setDraggingIndex(null);
              }}
            >
              <line
                x1={chartGeometry.paddingLeft}
                y1={chartGeometry.paddingTop}
                x2={chartGeometry.paddingLeft}
                y2={chartGeometry.baselineY}
                stroke="#666"
                strokeWidth="1"
              />
              <line
                x1={chartGeometry.paddingLeft}
                y1={chartGeometry.baselineY}
                x2={chartGeometry.width - chartGeometry.paddingRight}
                y2={chartGeometry.baselineY}
                stroke="#666"
                strokeWidth="1"
              />
              {yTickValues.map((tick) => {
                const y = toY(tick);
                return (
                  <g key={`y-tick-${tick}`}>
                    <line
                      x1={chartGeometry.paddingLeft}
                      y1={y}
                      x2={chartGeometry.width - chartGeometry.paddingRight}
                      y2={y}
                      stroke="#3A3A3A"
                      strokeWidth="1"
                      strokeDasharray="2 3"
                    />
                    <text
                      x={chartGeometry.paddingLeft - 8}
                      y={y + 3}
                      textAnchor="end"
                      fontSize="10"
                      fill="#AFAFAF"
                      fontFamily="Space Grotesk, sans-serif"
                    >
                      {tick}
                    </text>
                  </g>
                );
              })}
              <text
                x={12}
                y={chartGeometry.paddingTop + chartGeometry.plotHeight / 2}
                textAnchor="middle"
                fontSize="10"
                fill="#9A9A9A"
                fontFamily="Space Grotesk, sans-serif"
                transform={`rotate(-90 12 ${chartGeometry.paddingTop + chartGeometry.plotHeight / 2})`}
              >
                Anzahl (Fahrer/Fahrten)
              </text>
              {CHART_HOURS.map((hour, index) => {
                const x = chartGeometry.paddingLeft + index * chartGeometry.slotWidth + chartGeometry.slotWidth / 2;
                const barValue = Math.max(0, Number(hourlyDriverCounts[index] || 0));
                const barY = toY(barValue);
                const barHeight = Math.max(0, chartGeometry.baselineY - barY);
                const lineY = toY(demandProfile[index] || 0);
                return (
                  <g key={`slot-${hour}`}>
                    <rect
                      x={x - 6}
                      y={barY}
                      width={12}
                      height={barHeight}
                      rx={2}
                      fill="#45A8B6"
                      opacity={0.92}
                    />
                    <circle
                      cx={x}
                      cy={lineY}
                      r={draggingIndex === index ? 7 : 5}
                      fill="#E3F654"
                      stroke="#202020"
                      strokeWidth={1.5}
                    />
                    {hour % 3 === 0 ? (
                      <text x={x} y={chartGeometry.height - 16} textAnchor="middle" fontSize="10" fill="#AFAFAF" fontFamily="Space Grotesk, sans-serif">
                        {`${String(hour).padStart(2, '0')}:00`}
                      </text>
                    ) : null}
                  </g>
                );
              })}
              <polyline
                points={CHART_HOURS.map((_, index) => {
                  const x = chartGeometry.paddingLeft + index * chartGeometry.slotWidth + chartGeometry.slotWidth / 2;
                  const y = toY(demandProfile[index] || 0);
                  return `${x},${y}`;
                }).join(' ')}
                fill="none"
                stroke="#59BE80"
                strokeWidth={2.5}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <text
                x={chartGeometry.paddingLeft + chartGeometry.plotWidth / 2}
                y={chartGeometry.height - 3}
                textAnchor="middle"
                fontSize="10"
                fill="#9A9A9A"
                fontFamily="Space Grotesk, sans-serif"
              >
                Uhrzeit (h)
              </text>
            </svg>
          </div>

          <div className="absolute left-[24px] top-[488px] w-[356px] grid grid-cols-2 gap-[10px]">
            <label className="border-2 border-[#E3F654]/55 bg-[#111] px-[8px] py-[8px]">
              <span className="block text-[#E3F654]/80 text-[10px] font-medium font-['Space_Grotesk']">Max Arbeit (h)</span>
              <input
                type="number"
                min="1"
                max="16"
                step="0.5"
                value={maxWorkHours}
                onChange={(event) => setMaxWorkHours(Math.max(1, Number.parseFloat(event.target.value) || 1))}
                className="mt-[4px] w-full bg-transparent text-[#E3F654] text-[16px] font-semibold font-['Space_Grotesk'] outline-none"
              />
            </label>
            <label className="border-2 border-[#E3F654]/55 bg-[#111] px-[8px] py-[8px]">
              <span className="block text-[#E3F654]/80 text-[10px] font-medium font-['Space_Grotesk']">Min Arbeit (h)</span>
              <input
                type="number"
                min="0"
                max="16"
                step="0.5"
                value={minWorkHours}
                onChange={(event) => setMinWorkHours(Math.max(0, Number.parseFloat(event.target.value) || 0))}
                className="mt-[4px] w-full bg-transparent text-[#E3F654] text-[16px] font-semibold font-['Space_Grotesk'] outline-none"
              />
            </label>
            <label className="border-2 border-[#E3F654]/55 bg-[#111] px-[8px] py-[8px]">
              <span className="block text-[#E3F654]/80 text-[10px] font-medium font-['Space_Grotesk']">Min Pause (h)</span>
              <input
                type="number"
                min="0"
                max="12"
                step="0.5"
                value={minPauseHours}
                onChange={(event) => setMinPauseHours(Math.max(0, Number.parseFloat(event.target.value) || 0))}
                className="mt-[4px] w-full bg-transparent text-[#E3F654] text-[16px] font-semibold font-['Space_Grotesk'] outline-none"
              />
            </label>
            <label className="border-2 border-[#E3F654]/55 bg-[#111] px-[8px] py-[8px]">
              <span className="block text-[#E3F654]/80 text-[10px] font-medium font-['Space_Grotesk']">Puffer (min)</span>
              <input
                type="number"
                min="0"
                max="180"
                step="5"
                value={bufferMinutes}
                onChange={(event) => setBufferMinutes(Math.max(0, Number.parseInt(event.target.value, 10) || 0))}
                className="mt-[4px] w-full bg-transparent text-[#E3F654] text-[16px] font-semibold font-['Space_Grotesk'] outline-none"
              />
            </label>
          </div>

          <div className="absolute left-[24px] top-[646px] w-[356px] border-2 border-[#E3F654]/55 bg-[#111] px-[10px] py-[8px]">
            <span className="block text-[#E3F654]/80 text-[10px] font-medium font-['Space_Grotesk']">Service-Datum</span>
            <input
              type="date"
              value={serviceDate}
              onChange={(event) => {
                setServiceDate(String(event.target.value || '').trim());
                resetDemandCustomization();
              }}
              className="mt-[4px] w-full bg-transparent text-[#E3F654] text-[16px] font-semibold font-['Space_Grotesk'] outline-none"
            />
          </div>

          <div className="absolute left-[24px] top-[716px] w-[356px] grid grid-cols-2 gap-[10px]">
            <button
              type="button"
              onClick={handlePlan}
              disabled={isPlanning}
              className="h-[44px] border-2 border-[#E3F654] text-[#E3F654] text-[14px] font-semibold font-['Space_Grotesk'] disabled:opacity-60"
            >
              {isPlanning ? 'Plane ...' : 'KI Plan erzeugen'}
            </button>
            <button
              type="button"
              onClick={handleApply}
              disabled={isApplying || suggestions.length === 0}
              className="h-[44px] bg-[#E3F654] text-[#151515] text-[14px] font-semibold font-['Space_Grotesk'] disabled:opacity-60"
            >
              {isApplying ? 'Übernehme ...' : 'Auswahl übernehmen'}
            </button>
          </div>

          <div className="absolute left-[24px] top-[768px] w-[356px] h-[138px] border-2 border-[#E3F654]/45 bg-[#0f0f0f] px-[8px] py-[7px] overflow-y-auto">
            <div className="flex items-center justify-between">
              <div className="text-[#E3F654] text-[12px] font-semibold font-['Space_Grotesk']">KI Live-Protokoll</div>
              {sourceLabel ? (
                <div className="text-[#8DFFAF] text-[11px] font-medium font-['Space_Grotesk']">Quelle: {sourceLabel}</div>
              ) : null}
            </div>
            {isPlanning ? (
              <div className="mt-[4px] text-[#8DFFAF] text-[11px] font-medium font-['Space_Grotesk']">KI denkt und plant ...</div>
            ) : null}
            {error ? (
              <div className="mt-[4px] text-[#FF8E8E] text-[11px] whitespace-pre-line font-medium font-['Space_Grotesk']">{error}</div>
            ) : null}
            {success ? (
              <div className="mt-[4px] text-[#8DFFAF] text-[11px] whitespace-pre-line font-medium font-['Space_Grotesk']">{success}</div>
            ) : null}
            {warnings.length > 0 ? (
              <div className="mt-[4px] text-[#FFCD8A] text-[11px] whitespace-pre-line font-medium font-['Space_Grotesk']">
                {warnings.map((warning) => `• ${warning}`).join('\n')}
              </div>
            ) : null}
            {unassignedRideIds.length > 0 ? (
              <div className="mt-[4px] text-[#FFCD8A] text-[10px] font-medium font-['Space_Grotesk'] break-all">
                Nicht zugewiesen: {unassignedRideIds.join(', ')}
              </div>
            ) : null}
            <div className="mt-[5px] space-y-[3px]">
              {planningLog.length === 0 ? (
                <div className="text-white/55 text-[10px] font-medium font-['Space_Grotesk']">Noch kein Lauf gestartet.</div>
              ) : planningLog.map((line, index) => (
                <div key={`${line}-${index}`} className="text-white/75 text-[10px] leading-[1.3] font-medium font-['Space_Grotesk']">{line}</div>
              ))}
            </div>
          </div>

          <div className="absolute left-[24px] top-[930px] w-[356px] pb-[44px]">
            <div className="text-[#E3F654] text-[16px] font-semibold font-['Space_Grotesk']">Vorschläge</div>
            {fleetKpis ? (
              <div className="mt-[4px] text-white/60 text-[11px] font-medium font-['Space_Grotesk']">
                Flotte: {fleetKpis.ev_shift_count} EV / {fleetKpis.combustion_shift_count} Verbrenner
                {fleetKpis.unassigned_shift_count > 0 ? ` / ${fleetKpis.unassigned_shift_count} ohne Fahrzeug` : ''}
                {' · '}{fleetKpis.total_km} km · CO₂ gespart: {fleetKpis.co2_saved_kg} kg
              </div>
            ) : null}
            <div className="mt-[8px] space-y-[8px]">
              {suggestions.length === 0 ? (
                <div className="text-white/60 text-[12px] font-medium font-['Space_Grotesk']">
                  Noch keine KI-Vorschläge vorhanden.
                </div>
              ) : suggestions.map((row) => (
                <div key={row.id} className={`border-2 px-[10px] py-[8px] ${row.accepted ? 'border-[#59BE80] bg-[#102018]' : 'border-[#3D3D3D] bg-[#101010]'}`}>
                  <div className="flex items-center justify-between gap-[8px]">
                    <div>
                      <div className="text-[#E3F654] text-[13px] font-semibold font-['Space_Grotesk']">{row.driverName}</div>
                      <div className="text-white/60 text-[11px] font-medium font-['Space_Grotesk']">{row.assignedRidesCount} Einsätze</div>
                    </div>
                    <div className="flex items-center gap-[6px]">
                      <button
                        type="button"
                        onClick={() => {
                          setSuggestions((prev) => prev.map((entry) => (entry.id === row.id ? { ...entry, accepted: true } : entry)));
                        }}
                        className={`w-[30px] h-[30px] border-2 ${row.accepted ? 'border-[#59BE80] text-[#59BE80]' : 'border-white/30 text-white/70'}`}
                        aria-label="Vorschlag annehmen"
                      >
                        ✓
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setSuggestions((prev) => prev.map((entry) => (entry.id === row.id ? { ...entry, accepted: false } : entry)));
                        }}
                        className={`w-[30px] h-[30px] border-2 ${!row.accepted ? 'border-[#FF6F63] text-[#FF6F63]' : 'border-white/30 text-white/70'}`}
                        aria-label="Vorschlag ablehnen"
                      >
                        X
                      </button>
                    </div>
                  </div>

                  <div className="mt-[8px] grid grid-cols-2 gap-[8px]">
                    <input
                      type="time"
                      value={row.serviceStart}
                      onChange={(event) => {
                        const value = normalizeClockValue(event.target.value);
                        setSuggestions((prev) => prev.map((entry) => (entry.id === row.id ? { ...entry, serviceStart: value } : entry)));
                      }}
                      className="h-[34px] border-2 border-[#E3F654]/50 bg-black text-[#E3F654] text-[14px] font-semibold font-['Space_Grotesk'] px-[8px] outline-none"
                    />
                    <input
                      type="time"
                      value={row.serviceEnd}
                      onChange={(event) => {
                        const value = normalizeClockValue(event.target.value);
                        setSuggestions((prev) => prev.map((entry) => (entry.id === row.id ? { ...entry, serviceEnd: value } : entry)));
                      }}
                      className="h-[34px] border-2 border-[#E3F654]/50 bg-black text-[#E3F654] text-[14px] font-semibold font-['Space_Grotesk'] px-[8px] outline-none"
                    />
                  </div>
                  {row.vehicleLabel ? (
                    <div className="mt-[6px] text-[11px] font-medium font-['Space_Grotesk']">
                      <span className={row.vehicleIsEv ? 'text-[#8DFFAF]' : 'text-white/75'}>
                        {row.vehicleIsEv ? 'EV' : 'Verbrenner'} · {row.vehicleLabel}
                      </span>
                      <span className="text-white/50">
                        {row.shiftKm != null ? ` · ${row.shiftKm} km` : ''}
                        {row.chargeStopCount > 0 ? ` · ${row.chargeStopCount} Ladestopp(s)` : ''}
                      </span>
                    </div>
                  ) : null}
                  {row.vehicleNote ? (
                    <div className="mt-[2px] text-white/45 text-[10px] font-medium font-['Space_Grotesk']">{row.vehicleNote}</div>
                  ) : null}
                  {row.note ? (
                    <div className="mt-[6px] text-white/55 text-[11px] font-medium font-['Space_Grotesk']">{row.note}</div>
                  ) : null}
                  {Array.isArray(row.assignedRideIds) && row.assignedRideIds.length > 0 ? (
                    <div className="mt-[8px]">
                      <button
                        type="button"
                        onClick={() => {
                          setExpandedSuggestionIds((prev) => {
                            const next = new Set(prev);
                            if (next.has(row.id)) next.delete(row.id);
                            else next.add(row.id);
                            return next;
                          });
                        }}
                        className="text-[#8DFFAF] text-[11px] font-semibold font-['Space_Grotesk']"
                      >
                        {expandedSuggestionIds.has(row.id) ? 'Fahrten ausblenden' : 'Fahrten anzeigen'}
                      </button>
                      {expandedSuggestionIds.has(row.id) ? (
                        <div className="mt-[6px] space-y-[4px]">
                          {row.assignedRideIds.map((rideId) => {
                            const details = rideDetailsById.get(String(rideId || '').trim());
                            return (
                              <div key={`${row.id}-${rideId}`} className="border border-white/15 bg-black/35 px-[6px] py-[5px]">
                                <div className="text-white/70 text-[10px] font-medium font-['Space_Grotesk']">{String(rideId || '').trim()}</div>
                                <div className="text-[#E3F654] text-[11px] leading-[1.25] font-medium font-['Space_Grotesk']">
                                  {details ? `${details.pickup} -> ${details.dropoff}` : 'Fahrtdaten nicht gefunden'}
                                </div>
                                {details?.etd ? (
                                  <div className="text-white/60 text-[10px] font-medium font-['Space_Grotesk']">ETD: {details.etd}</div>
                                ) : null}
                              </div>
                            );
                          })}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
          </div>
        </div>
      </div>
    </div>
  );
}
