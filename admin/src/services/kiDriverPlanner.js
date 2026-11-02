// Einmalig ueber die TomTom-Matrix berechnete Streckenkilometer je Ortspaar.
// Ersetzt die grobe Zonenschaetzung des Solvers (Zonenminuten x 45 km/h).
import distanceData from '../demo/data/distances.json';
// Tageszeit-Faktoren aus dem historischen Verkehrsmuster von TomTom
// (gemessen ueber repraesentative Strecken, 1.0 = Tagesmedian).
import trafficFactors from '../demo/data/traffic_factors.json';
import { echtenPlanFinden } from '../demo/planerErgebnisse';
import { enginePlanFinden } from '../demo/engineErgebnisse';

const DEFAULT_MODEL = 'llama3.1:8b';
const DEFAULT_RIDE_DURATION_MINUTES = 80;
const DEFAULT_DEMAND_START_HOUR = 6;

const envOrDefault = (value, fallback) => {
  if (!value) return fallback;
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  if (!trimmed || trimmed.toLowerCase().startsWith('your_')) return fallback;
  return trimmed;
};

const KI_PROVIDER = envOrDefault(import.meta.env.VITE_KI_PROVIDER, 'cp_sat');
const OLLAMA_URL = envOrDefault(import.meta.env.VITE_OLLAMA_URL, '/ollama');
const OLLAMA_MODEL = envOrDefault(import.meta.env.VITE_OLLAMA_MODEL, DEFAULT_MODEL);
const PLANNER_URL = envOrDefault(import.meta.env.VITE_PLANNER_URL, '/planner');
// Start- und Endort der Fahrer fuer die Leerfahrten (Ort aus der TomTom-Tabelle).
const PLANER_ZENTRALE = 'München Hauptbahnhof, Bayerstraße 10a';
const OLLAMA_PLANNER_SCHEMA = {
  type: 'object',
  properties: {
    suggestions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          driver_id: { type: 'string' },
          driver_name: { type: 'string' },
          service_start: { type: 'string' },
          service_end: { type: 'string' },
          assigned_ride_ids: { type: 'array', items: { type: 'string' } },
          assigned_rides_count: { type: 'number' },
          note: { type: 'string' },
        },
        required: ['driver_id', 'service_start', 'service_end'],
      },
    },
    unassigned_ride_ids: { type: 'array', items: { type: 'string' } },
    warnings: { type: 'array', items: { type: 'string' } },
  },
  required: ['suggestions'],
};

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

const clockToMinutes = (value) => {
  const normalized = normalizeClockValue(value);
  if (!normalized) return null;
  const [hours, minutes] = normalized.split(':').map((part) => Number.parseInt(part, 10));
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  return hours * 60 + minutes;
};

const minutesToClock = (value) => {
  const minutes = Math.max(0, Math.min(1439, Number.parseInt(String(value || 0), 10) || 0));
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};

const expandWindowToMinDuration = (startMinutes, endMinutes, minDurationMinutes, maxDurationMinutes) => {
  if (!Number.isFinite(startMinutes) || !Number.isFinite(endMinutes)) return [startMinutes, endMinutes];
  const minDuration = Math.max(0, Number.parseInt(String(minDurationMinutes || 0), 10) || 0);
  const maxDuration = Math.max(minDuration, Number.parseInt(String(maxDurationMinutes || minDuration), 10) || minDuration);
  let start = startMinutes;
  let end = endMinutes;
  let duration = Math.max(0, end - start);
  if (duration > maxDuration) {
    end = start + maxDuration;
    duration = maxDuration;
  }
  if (duration >= minDuration) return [start, end];

  let missing = minDuration - duration;
  const addBefore = Math.floor(missing / 2);
  const addAfter = missing - addBefore;
  start = Math.max(0, start - addBefore);
  end = Math.min(1439, end + addAfter);
  duration = Math.max(0, end - start);

  if (duration < minDuration) {
    missing = minDuration - duration;
    if (start === 0) {
      end = Math.min(1439, end + missing);
    } else if (end === 1439) {
      start = Math.max(0, start - missing);
    }
  }

  duration = Math.max(0, end - start);
  if (duration > maxDuration) {
    end = start + maxDuration;
    if (end > 1439) {
      const overflow = end - 1439;
      end = 1439;
      start = Math.max(0, start - overflow);
    }
  }
  return [start, end];
};

const normalizeRides = (rides, bufferMinutes, rideDurationMinutes) => {
  const excludedStatuses = new Set(['done', 'completed', 'arrived', 'archived', 'cancelled', 'canceled', 'refused', 'rejected']);
  return (Array.isArray(rides) ? rides : [])
    .map((ride) => {
      const etdText = String(ride?.etd || '').trim();
      const etdMinutes = clockToMinutes(etdText);
      if (etdMinutes == null) return null;
      const status = String(ride?.status || '').trim().toLowerCase();
      if (excludedStatuses.has(status)) return null;
      const start = Math.max(0, etdMinutes - bufferMinutes);
      const end = Math.min(1439, etdMinutes + rideDurationMinutes + bufferMinutes);
      return {
        id: String(ride?.id || '').trim(),
        etd: normalizeClockValue(etdText),
        etdMinutes,
        startMinutes: start,
        endMinutes: end,
        synthetic: false,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.startMinutes - b.startMinutes);
};

const normalizeDemandProfile = (demandProfile) =>
  (Array.isArray(demandProfile) ? demandProfile : []).map((value) => Math.max(0, Number.parseInt(String(value || 0), 10) || 0));

const mergeAiAndHeuristicSuggestions = (aiResult, heuristicResult) => {
  const aiSuggestions = Array.isArray(aiResult?.suggestions) ? aiResult.suggestions : [];
  const heuristicSuggestions = Array.isArray(heuristicResult?.suggestions) ? heuristicResult.suggestions : [];
  const heuristicByDriver = new Map(
    heuristicSuggestions.map((entry) => [String(entry?.driver_id || '').trim(), entry]).filter(([driverId]) => Boolean(driverId)),
  );
  const aiByDriver = new Map(
    aiSuggestions.map((entry) => [String(entry?.driver_id || '').trim(), entry]).filter(([driverId]) => Boolean(driverId)),
  );

  const mergedSuggestions = heuristicSuggestions.map((heuristicEntry) => {
    const driverId = String(heuristicEntry?.driver_id || '').trim();
    const aiEntry = aiByDriver.get(driverId);
    const aiStart = normalizeClockValue(aiEntry?.service_start);
    const aiEnd = normalizeClockValue(aiEntry?.service_end);
    const heuristicStart = normalizeClockValue(heuristicEntry?.service_start);
    const heuristicEnd = normalizeClockValue(heuristicEntry?.service_end);
    const aiRideIds = Array.isArray(aiEntry?.assigned_ride_ids) ? aiEntry.assigned_ride_ids : [];
    const heuristicRideIds = Array.isArray(heuristicEntry?.assigned_ride_ids) ? heuristicEntry.assigned_ride_ids : [];
    const rideIds = aiRideIds.length > 0 ? aiRideIds : heuristicRideIds;
    const rideCount = Math.max(
      rideIds.length,
      Number.parseInt(String(aiEntry?.assigned_rides_count || 0), 10) || 0,
      Number.parseInt(String(heuristicEntry?.assigned_rides_count || 0), 10) || 0,
    );
    const noteParts = [String(aiEntry?.note || '').trim(), String(heuristicEntry?.note || '').trim()].filter(Boolean);
    return {
      ...heuristicEntry,
      ...(aiEntry || {}),
      driver_id: driverId,
      driver_name: String(aiEntry?.driver_name || heuristicEntry?.driver_name || '').trim(),
      service_start: aiStart || heuristicStart,
      service_end: aiEnd || heuristicEnd,
      assigned_ride_ids: rideIds,
      assigned_rides_count: rideCount,
      note: noteParts.join(' | '),
    };
  });

  const alreadyIncluded = new Set(mergedSuggestions.map((entry) => String(entry?.driver_id || '').trim()));
  const extraAi = aiSuggestions.filter((entry) => !alreadyIncluded.has(String(entry?.driver_id || '').trim()));
  const suggestions = [...mergedSuggestions, ...extraAi];

  const warnings = [
    ...(Array.isArray(aiResult?.warnings) ? aiResult.warnings : []),
    ...(Array.isArray(heuristicResult?.warnings) ? heuristicResult.warnings : []),
  ];

  return {
    source: aiResult?.source || 'ollama',
    suggestions,
    warnings,
    unassigned_ride_ids: Array.from(new Set([
      ...(Array.isArray(aiResult?.unassigned_ride_ids) ? aiResult.unassigned_ride_ids : []),
      ...(Array.isArray(heuristicResult?.unassigned_ride_ids) ? heuristicResult.unassigned_ride_ids : []),
    ])),
  };
};

const buildSyntheticRidesFromDemand = ({
  normalizedRides,
  demandProfile,
  bufferMinutes,
  rideDurationMinutes,
  startHour = DEFAULT_DEMAND_START_HOUR,
  maxSyntheticPerHour = Number.POSITIVE_INFINITY,
  maxSyntheticTotal = Number.POSITIVE_INFINITY,
}) => {
  const demand = normalizeDemandProfile(demandProfile);
  if (demand.length === 0) return [];
  const existingPerHour = demand.map(() => 0);
  normalizedRides.forEach((ride) => {
    const hour = Math.floor((Number(ride?.etdMinutes) || 0) / 60);
    const slotIndex = hour - startHour;
    if (slotIndex < 0 || slotIndex >= existingPerHour.length) return;
    existingPerHour[slotIndex] += 1;
  });

  const synthetic = [];
  let totalSynthetic = 0;
  demand.forEach((targetCount, slotIndex) => {
    if (totalSynthetic >= maxSyntheticTotal) return;
    const deficit = Math.max(0, targetCount - (existingPerHour[slotIndex] || 0));
    if (deficit <= 0) return;
    const boundedDeficit = Math.min(deficit, Math.max(0, Math.floor(maxSyntheticPerHour)));
    if (boundedDeficit <= 0) return;
    const hour = startHour + slotIndex;
    const etdMinutes = hour * 60;
    for (let i = 0; i < boundedDeficit; i += 1) {
      if (totalSynthetic >= maxSyntheticTotal) break;
      synthetic.push({
        id: `synthetic-${hour}-${i + 1}`,
        etd: `${String(hour).padStart(2, '0')}:00`,
        etdMinutes,
        startMinutes: Math.max(0, etdMinutes - bufferMinutes),
        endMinutes: Math.min(1439, etdMinutes + rideDurationMinutes + bufferMinutes),
        synthetic: true,
      });
      totalSynthetic += 1;
    }
  });
  return synthetic;
};

const buildDemandBasedSuggestions = ({
  normalizedDrivers,
  demandProfile,
  maxWorkMinutes,
  minWorkMinutes,
  minPauseMinutes,
  startHour = DEFAULT_DEMAND_START_HOUR,
}) => {
  const normalizedDemand = normalizeDemandProfile(demandProfile);
  const totalDemand = normalizedDemand.reduce((sum, value) => sum + value, 0);
  if (totalDemand <= 0 || normalizedDrivers.length === 0) return null;

  const stateByDriver = new Map(
    normalizedDrivers.map((driver) => [
      driver.driverId,
      {
        ...driver,
        firstStart: null,
        lastEnd: null,
        currentBlockStart: null,
        totalWorkMinutes: 0,
        coveredSlots: 0,
        slotIndexes: new Set(),
      },
    ]),
  );

  let uncoveredDemandSlots = 0;
  normalizedDemand.forEach((requiredDrivers, slotIndex) => {
    if (!requiredDrivers) return;
    const slotStart = (startHour + slotIndex) * 60;
    const slotEnd = Math.min(1439, slotStart + 60);
    for (let copy = 0; copy < requiredDrivers; copy += 1) {
      let bestState = null;
      let bestScore = Number.POSITIVE_INFINITY;

      normalizedDrivers.forEach((driver) => {
        const current = stateByDriver.get(driver.driverId);
        if (!current) return;
        if (current.slotIndexes.has(slotIndex)) return;

        const previousEnd = current.lastEnd;
        const gap = previousEnd == null ? null : slotStart - previousEnd;
        if (gap != null && gap < 0) return;
        const extendsCurrentBlock = gap != null && gap < minPauseMinutes;
        const blockStart = extendsCurrentBlock
          ? (current.currentBlockStart ?? current.firstStart ?? slotStart)
          : slotStart;
        const projectedBlockDuration = slotEnd - blockStart;
        if (projectedBlockDuration > maxWorkMinutes) return;

        const score = (current.totalWorkMinutes * 10) + (gap == null ? 0 : gap * 0.2) + current.order;
        if (score < bestScore) {
          bestScore = score;
          bestState = current;
        }
      });

      if (!bestState) {
        uncoveredDemandSlots += 1;
        continue;
      }

      const previousEnd = bestState.lastEnd;
      const gap = previousEnd == null ? null : slotStart - previousEnd;
      const extendsCurrentBlock = gap != null && gap < minPauseMinutes;
      bestState.slotIndexes.add(slotIndex);
      bestState.coveredSlots += 1;
      bestState.totalWorkMinutes += slotEnd - slotStart;
      if (bestState.firstStart == null || slotStart < bestState.firstStart) bestState.firstStart = slotStart;
      if (bestState.lastEnd == null || slotEnd > bestState.lastEnd) bestState.lastEnd = slotEnd;
      if (bestState.currentBlockStart == null || !extendsCurrentBlock) bestState.currentBlockStart = slotStart;
    }
  });

  const suggestions = normalizedDrivers.map((driver) => {
    const state = stateByDriver.get(driver.driverId);
    const workHours = state?.totalWorkMinutes ? (state.totalWorkMinutes / 60).toFixed(1) : '0.0';
    let serviceStartMinutes = state?.firstStart;
    let serviceEndMinutes = state?.lastEnd;
    if (serviceStartMinutes != null && serviceEndMinutes != null) {
      [serviceStartMinutes, serviceEndMinutes] = expandWindowToMinDuration(
        serviceStartMinutes,
        serviceEndMinutes,
        minWorkMinutes,
        maxWorkMinutes,
      );
    }
    return {
      driver_id: driver.driverId,
      driver_name: driver.driverName,
      service_start: serviceStartMinutes == null ? '' : minutesToClock(serviceStartMinutes),
      service_end: serviceEndMinutes == null ? '' : minutesToClock(serviceEndMinutes),
      assigned_ride_ids: [],
      assigned_rides_count: state?.coveredSlots || 0,
      note: state?.coveredSlots
        ? `Bedarfslinie: ${state.coveredSlots}h geplant (${workHours}h Dienst).`
        : 'Kein Dienstfenster aus Bedarfslinie zugewiesen.',
    };
  });

  const warnings = [];
  if (uncoveredDemandSlots > 0) {
    warnings.push(`${uncoveredDemandSlots} Bedarfsslot(s) konnten nicht abgedeckt werden.`);
  }
  return {
    source: 'heuristic',
    suggestions: suggestions.filter((entry) => Boolean(entry?.service_start && entry?.service_end)),
    unassigned_ride_ids: [],
    warnings,
  };
};

const buildHeuristicSuggestions = ({
  drivers,
  rides,
  demandProfile,
  maxWorkMinutes,
  minWorkMinutes,
  minPauseMinutes,
  bufferMinutes,
  rideDurationMinutes,
}) => {
  const normalizedDrivers = (Array.isArray(drivers) ? drivers : [])
    .map((driver, index) => ({
      driverId: String(driver?.id || '').trim(),
      driverName: String(driver?.name || '').trim() || `Fahrer #${index + 1}`,
      order: index,
    }))
    .filter((driver) => Boolean(driver.driverId));

  const normalizedRides = normalizeRides(rides, bufferMinutes, rideDurationMinutes);
  const syntheticRides = buildSyntheticRidesFromDemand({
    normalizedRides,
    demandProfile,
    bufferMinutes,
    rideDurationMinutes,
  });
  const allRides = [...normalizedRides, ...syntheticRides].sort((a, b) => a.startMinutes - b.startMinutes);
  if (allRides.length === 0) {
    const demandBased = buildDemandBasedSuggestions({
      normalizedDrivers,
      demandProfile,
      maxWorkMinutes,
      minWorkMinutes,
      minPauseMinutes,
    });
    if (demandBased) return demandBased;
  }
  const stateByDriver = new Map(
    normalizedDrivers.map((driver) => [
      driver.driverId,
      {
        ...driver,
        rides: [],
        firstStart: null,
        lastEnd: null,
        currentBlockStart: null,
      },
    ]),
  );

  const unassignedRideIds = [];

  allRides.forEach((ride) => {
    let bestDriver = null;
    let bestScore = Number.POSITIVE_INFINITY;

    normalizedDrivers.forEach((driver) => {
      const current = stateByDriver.get(driver.driverId);
      if (!current) return;
      if (current.rides.length === 0) {
        const score = 5000 + (current.order * 20);
        if (score < bestScore) {
          bestScore = score;
          bestDriver = current;
        }
        return;
      }

      const nextStart = Math.min(current.firstStart ?? ride.startMinutes, ride.startMinutes);
      const nextEnd = Math.max(current.lastEnd ?? ride.endMinutes, ride.endMinutes);
      const nextSpan = nextEnd - nextStart;
      if (nextSpan > maxWorkMinutes) return;
      const gap = ride.startMinutes - (current.lastEnd ?? ride.startMinutes);
      if (gap < 0) return;

      const expandsLongPause = gap >= minPauseMinutes ? gap - minPauseMinutes : 0;
      const currentSpan = Math.max(0, (current.lastEnd ?? ride.endMinutes) - (current.firstStart ?? ride.startMinutes));
      const spanGrowth = Math.max(0, nextSpan - currentSpan);
      const score = (spanGrowth * 10) + (expandsLongPause * 1.2) + (current.order * 0.5);
      if (score < bestScore) {
        bestScore = score;
        bestDriver = current;
      }
    });

    if (!bestDriver) {
      if (ride.id && !ride.synthetic) unassignedRideIds.push(ride.id);
      return;
    }

    const previousEnd = bestDriver.lastEnd;
    const gap = previousEnd == null ? null : ride.startMinutes - previousEnd;
    const extendsCurrentBlock = gap != null && gap < minPauseMinutes;

    bestDriver.rides.push(ride);
    if (bestDriver.firstStart == null || ride.startMinutes < bestDriver.firstStart) {
      bestDriver.firstStart = ride.startMinutes;
    }
    if (bestDriver.lastEnd == null || ride.endMinutes > bestDriver.lastEnd) {
      bestDriver.lastEnd = ride.endMinutes;
    }
    if (bestDriver.currentBlockStart == null) {
      bestDriver.currentBlockStart = ride.startMinutes;
    } else if (!extendsCurrentBlock) {
      bestDriver.currentBlockStart = ride.startMinutes;
    }
  });

  const suggestions = normalizedDrivers.map((driver) => {
    const state = stateByDriver.get(driver.driverId);
    const ridesForDriver = state?.rides || [];
    let firstStart = state?.firstStart;
    let lastEnd = state?.lastEnd;
    if (firstStart != null && lastEnd != null) {
      [firstStart, lastEnd] = expandWindowToMinDuration(
        firstStart,
        lastEnd,
        minWorkMinutes,
        maxWorkMinutes,
      );
    }
    const slotCount = ridesForDriver.length;
    const realRideIds = ridesForDriver
      .map((ride) => ride.id)
      .filter((rideId) => Boolean(rideId) && !String(rideId).startsWith('synthetic-'));
    return {
      driver_id: driver.driverId,
      driver_name: driver.driverName,
      service_start: firstStart == null ? '' : minutesToClock(firstStart),
      service_end: lastEnd == null ? '' : minutesToClock(lastEnd),
      assigned_ride_ids: realRideIds,
      assigned_rides_count: slotCount,
      note: slotCount > 0
        ? `Heuristik: ${slotCount} Slot(s) inkl. ${bufferMinutes}min Puffer.`
        : 'Keine Fahrt zugewiesen.',
    };
  });

  return {
    source: 'heuristic',
    suggestions: suggestions.filter((entry) => Boolean(entry?.service_start && entry?.service_end)),
    unassigned_ride_ids: Array.from(new Set(unassignedRideIds)),
    warnings: unassignedRideIds.length > 0
      ? [`${unassignedRideIds.length} Fahrt(en) konnten nicht konfliktfrei zugewiesen werden.`]
      : [],
  };
};

const extractFirstJsonObject = (raw) => {
  const start = raw.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  for (let i = start; i < raw.length; i += 1) {
    const char = raw[i];
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) return raw.slice(start, i + 1);
    }
  }
  return null;
};

const normalizeAiResponse = (payload, knownDrivers, knownRideIds) => {
  if (!payload || typeof payload !== 'object') return null;
  const knownDriverEntries = (Array.isArray(knownDrivers) ? knownDrivers : [])
    .map((driver, index) => ({
      id: String(driver?.id || '').trim(),
      name: String(driver?.name || '').trim(),
      index,
    }))
    .filter((driver) => Boolean(driver.id));
  const knownDriverIds = new Set(knownDriverEntries.map((driver) => driver.id));
  const driverNameToId = new Map(
    knownDriverEntries
      .map((driver) => [driver.name.toLowerCase(), driver.id])
      .filter(([name]) => Boolean(name)),
  );
  const fallbacksByOrder = knownDriverEntries.map((entry) => entry.id);

  let suggestionsRaw = [];
  if (Array.isArray(payload?.suggestions)) {
    suggestionsRaw = payload.suggestions;
  } else if (Array.isArray(payload)) {
    suggestionsRaw = payload;
  } else if (payload?.suggestions && typeof payload.suggestions === 'object') {
    suggestionsRaw = Object.values(payload.suggestions);
  } else if (Array.isArray(payload?.assignments)) {
    suggestionsRaw = payload.assignments;
  } else if (Array.isArray(payload?.plan)) {
    suggestionsRaw = payload.plan;
  } else if (Array.isArray(payload?.driver_plans)) {
    suggestionsRaw = payload.driver_plans;
  } else if (Array.isArray(payload?.drivers)) {
    suggestionsRaw = payload.drivers;
  } else if (Array.isArray(payload?.dienstplan)) {
    suggestionsRaw = payload.dienstplan;
  } else {
    const candidateArray = Object.values(payload).find((value) => {
      if (!Array.isArray(value) || value.length === 0) return false;
      const first = value[0];
      if (!first || typeof first !== 'object') return false;
      const keys = Object.keys(first).map((key) => key.toLowerCase());
      return keys.some((key) => key.includes('driver') || key.includes('fahrer') || key.includes('service') || key.includes('start'));
    });
    if (Array.isArray(candidateArray)) suggestionsRaw = candidateArray;
  }

  const usedDriverIds = new Set();
  const suggestions = suggestionsRaw
    .map((entry, index) => {
      const directDriverId = String(
        entry?.driver_id
        || entry?.driverId
        || entry?.fahrer_id
        || entry?.id
        || '',
      ).trim();
      const driverName = String(
        entry?.driver_name
        || entry?.driverName
        || entry?.fahrer_name
        || entry?.name
        || '',
      ).trim();
      let driverId = directDriverId;
      if (!driverId || !knownDriverIds.has(driverId)) {
        const byName = driverNameToId.get(driverName.toLowerCase());
        if (byName) driverId = byName;
      }
      if (!driverId || !knownDriverIds.has(driverId)) {
        const fallbackId = fallbacksByOrder[index];
        if (fallbackId && !usedDriverIds.has(fallbackId)) driverId = fallbackId;
      }
      if (!driverId || !knownDriverIds.has(driverId)) return null;
      usedDriverIds.add(driverId);

      const serviceStart = normalizeClockValue(
        entry?.service_start
        || entry?.serviceStart
        || entry?.start
        || entry?.start_time,
      );
      const serviceEnd = normalizeClockValue(
        entry?.service_end
        || entry?.serviceEnd
        || entry?.end
        || entry?.end_time,
      );
      const assignedRideIds = Array.isArray(entry?.assigned_ride_ids)
        ? entry.assigned_ride_ids.map((rideId) => String(rideId || '').trim()).filter((rideId) => knownRideIds.has(rideId))
        : [];
      return {
        driver_id: driverId,
        driver_name: driverName,
        service_start: serviceStart,
        service_end: serviceEnd,
        assigned_ride_ids: Array.from(new Set(assignedRideIds)),
        assigned_rides_count: Number.parseInt(
          String(entry?.assigned_rides_count || entry?.assignedRidesCount || assignedRideIds.length),
          10,
        ) || assignedRideIds.length,
        note: String(entry?.note || '').trim(),
      };
    })
    .filter(Boolean);
  if (suggestions.length === 0) return null;

  const warnings = Array.isArray(payload?.warnings)
    ? payload.warnings.map((value) => String(value || '').trim()).filter(Boolean)
    : [];
  const unassignedRideIds = Array.isArray(payload?.unassigned_ride_ids)
    ? payload.unassigned_ride_ids.map((rideId) => String(rideId || '').trim()).filter((rideId) => knownRideIds.has(rideId))
    : [];
  return {
    source: 'ollama',
    suggestions,
    warnings,
    unassigned_ride_ids: Array.from(new Set(unassignedRideIds)),
  };
};

const parsePlannerJsonPayload = (rawText) => {
  const raw = String(rawText || '').trim();
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return { suggestions: parsed };
    if (parsed && typeof parsed === 'object') return parsed;
  } catch {
    // ignore and continue with fallback extractors
  }

  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    try {
      const parsed = JSON.parse(fenced[1].trim());
      if (Array.isArray(parsed)) return { suggestions: parsed };
      if (parsed && typeof parsed === 'object') return parsed;
    } catch {
      // ignore and continue
    }
  }

  const objectBlock = extractFirstJsonObject(raw);
  if (!objectBlock) return null;
  try {
    const parsed = JSON.parse(objectBlock);
    if (Array.isArray(parsed)) return { suggestions: parsed };
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
};

const extractResponsePayloadText = (data) => {
  const candidates = [
    data?.response,
    data?.message?.content,
    data?.output_text,
    data?.content,
  ];
  for (const value of candidates) {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (value && typeof value === 'object') {
      try {
        const text = JSON.stringify(value);
        if (text && text !== '{}' && text !== '[]') return text;
      } catch {
        // ignore
      }
    }
  }
  return '';
};

const safeJsonParse = (text) => {
  try {
    return JSON.parse(String(text || ''));
  } catch {
    return null;
  }
};

// Echte Fahrzeit einer Fahrt: gemessene Basiszeit des Ortspaars, skaliert mit
// dem Verkehrsfaktor der Abfahrtsstunde. Ohne Treffer bleibt es beim Wert aus
// den Fahrtdaten bzw. der Annahme aus den Planungsregeln.
const echteFahrzeit = (ride) => {
  const von = String(ride?.pickup_name || ride?.pickup_address || '').trim();
  const nach = String(ride?.dropoff_name || ride?.dropoff_address || '').trim();
  if (!von || !nach) return null;
  const tabelle = distanceData?.minuten || {};
  const basis = tabelle[`${von}|${nach}`] ?? tabelle[`${nach}|${von}`];
  if (!Number.isFinite(Number(basis))) return null;
  const stunde = Number(String(ride?.etd || '').slice(0, 2));
  const faktor = Number(trafficFactors?.stundenFaktor?.[stunde]) || 1;
  return Math.max(5, Math.round(Number(basis) * faktor));
};

const mitEchtenFahrzeiten = (rides) => (Array.isArray(rides) ? rides : []).map((ride) => {
  const minuten = echteFahrzeit(ride);
  return minuten == null ? ride : { ...ride, duration_minutes: minuten };
});

const callCpSatPlanner = async ({
  drivers,
  rides,
  vehicles,
  serviceDate,
  settings,
  demandProfile,
  onProgress,
}) => {
  const logProgress = (text) => {
    if (typeof onProgress === 'function' && text) onProgress(String(text));
  };

  const endpoint = `${PLANNER_URL.replace(/\/$/, '')}/solve`;
  logProgress(`Endpoint: ${endpoint}`);
  logProgress('Sende Anfrage an CP-SAT Planner ...');
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      drivers,
      rides: mitEchtenFahrzeiten(rides),
      vehicles: Array.isArray(vehicles) ? vehicles : [],
      distances: distanceData?.km || {},
      // Leerfahrten zwischen den Fahrten mit den echten TomTom-Fahrzeiten je
      // Ortspaar; Fahrer starten und enden an der Zentrale.
      travelMinutes: distanceData?.minuten || {},
      depot: PLANER_ZENTRALE,
      serviceDate,
      settings,
      demandProfile,
    }),
  });
  const contentType = String(response.headers.get('content-type') || '').toLowerCase();
  const bodyText = await response.text();
  const payload = safeJsonParse(bodyText);
  if (!response.ok) {
    throw new Error(payload?.error || `CP-SAT Planner API Fehler (${response.status})`);
  }
  if (!payload || typeof payload !== 'object') {
    const trimmed = String(bodyText || '').trim();
    const looksHtml = contentType.includes('text/html') || /^<!doctype html>|^<html/i.test(trimmed);
    if (looksHtml) {
      throw new Error('Planner Endpoint liefert HTML statt JSON (Proxy/URL prüfen).');
    }
    throw new Error('Planner Endpoint liefert kein JSON.');
  }
  return payload;
};

const callOllamaPlanner = async ({
  drivers,
  rides,
  serviceDate,
  settings,
  demandProfile,
  heuristicDraft,
  onProgress,
}) => {
  const logProgress = (text) => {
    if (typeof onProgress === 'function' && text) onProgress(String(text));
  };
  const endpoint = `${OLLAMA_URL.replace(/\/$/, '')}/api/generate`;
  logProgress(`Endpoint: ${endpoint}`);
  const basePrompt = [
    'Du bist ein Dispo-Optimierer fuer Fahrerplanung.',
    'Ziel: effiziente Fahrer-Einteilung.',
    'Wenn keine Fahrten vorhanden sind, plane nur mit hourly_demand_profile sinnvolle Dienstzeiten.',
    'Plane keine unnoetig kurzen Einzelpausen und halte min_pause_stunden ein.',
    'Regeln (muss eingehalten werden):',
    `- max_arbeitsdauer_stunden: ${settings.maxWorkHours}`,
    `- min_arbeitsdauer_stunden: ${settings.minWorkHours}`,
    `- min_pause_stunden: ${settings.minPauseHours}`,
    `- puffer_minuten_zwischen_fahrten: ${settings.bufferMinutes}`,
    '',
    'Gib NUR JSON zurueck, kein Text davor/danach.',
    'Format:',
    '{"suggestions":[{"driver_id":"","driver_name":"","service_start":"HH:MM","service_end":"HH:MM","assigned_ride_ids":[],"assigned_rides_count":0,"note":""}],"unassigned_ride_ids":[],"warnings":[]}',
    '',
    `service_date: ${serviceDate}`,
    `drivers: ${JSON.stringify(drivers)}`,
    `rides: ${JSON.stringify(rides)}`,
    `hourly_demand_profile: ${JSON.stringify(demandProfile)}`,
    `heuristic_draft: ${JSON.stringify(heuristicDraft)}`,
  ].join('\n');

  const requestOllama = async ({ promptText, forceJsonFormat = true }) => {
    logProgress(`Sende Anfrage an Ollama (${OLLAMA_MODEL}) ...`);
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        prompt: promptText,
        stream: false,
        ...(forceJsonFormat ? { format: OLLAMA_PLANNER_SCHEMA } : {}),
        options: { temperature: 0.1, num_predict: 1200 },
      }),
    });
    const contentType = String(response.headers.get('content-type') || '').toLowerCase();
    const bodyText = await response.text();
    const data = safeJsonParse(bodyText);
    if (!response.ok) {
      throw new Error(data?.error || `Ollama API Fehler (${response.status})`);
    }

    if (!data || typeof data !== 'object') {
      const trimmed = String(bodyText || '').trim();
      const looksHtml = contentType.includes('text/html') || /^<!doctype html>|^<html/i.test(trimmed);
      if (looksHtml) {
        throw new Error('Ollama Endpoint liefert HTML statt JSON (Proxy/URL prüfen).');
      }
      const preview = trimmed.slice(0, 180).replace(/\s+/g, ' ');
      throw new Error(`Ollama Endpoint liefert kein JSON (content-type: ${contentType || '-'}, preview: ${preview || 'leer'}).`);
    }

    const raw = extractResponsePayloadText(data);
    if (!raw) {
      const keys = Object.keys(data).slice(0, 12).join(', ');
      throw new Error(`Ollama JSON ohne Antworttext (keys: ${keys || 'keine'}).`);
    }

    logProgress(`Antwort empfangen (${raw.length} Zeichen).`);
    return raw;
  };

  let raw = '';
  let jsonFormatUnsupported = false;
  try {
    logProgress('Versuche JSON-Schema-Modus (format=schema) ...');
    raw = await requestOllama({ promptText: basePrompt, forceJsonFormat: true });
  } catch (error) {
    const message = String(error?.message || '');
    jsonFormatUnsupported = /format|unknown field|invalid field|cannot unmarshal/i.test(message);
    if (!jsonFormatUnsupported) throw error;
    logProgress('JSON-Modus nicht unterstützt, fallback ohne format=json.');
  }

  if (jsonFormatUnsupported) {
    raw = await requestOllama({ promptText: basePrompt, forceJsonFormat: false });
  }

  logProgress('Prüfe und parse JSON-Antwort ...');
  let parsed = parsePlannerJsonPayload(raw);
  if (parsed) return parsed;

  logProgress('Erste Antwort nicht verwertbar, starte strengen JSON-Retry ...');
  const strictRetryPrompt = [
    basePrompt,
    '',
    'WICHTIG: Gib exakt ein gueltiges JSON-Objekt zurueck.',
    'Kein Markdown, keine Kommentare, keine Erklaerung, kein Fliesstext.',
    'Beginne direkt mit "{" und ende mit "}".',
  ].join('\n');

  raw = await requestOllama({ promptText: strictRetryPrompt, forceJsonFormat: !jsonFormatUnsupported });
  parsed = parsePlannerJsonPayload(raw);
  if (parsed) return parsed;

  const preview = raw.slice(0, 200).replace(/\s+/g, ' ').trim();
  throw new Error(preview ? `Ollama Antwort ohne JSON: ${preview}` : 'Ollama Antwort ohne JSON.');
};

export const planDriverShiftsWithOllama = async ({
  drivers,
  rides,
  vehicles,
  serviceDate,
  settings,
  demandProfile,
  onProgress,
}) => {
  const logProgress = (text) => {
    if (typeof onProgress === 'function' && text) onProgress(String(text));
  };
  const demandSum = normalizeDemandProfile(demandProfile).reduce((sum, value) => sum + value, 0);
  logProgress(`Input: Fahrer=${Array.isArray(drivers) ? drivers.length : 0}, Fahrten=${Array.isArray(rides) ? rides.length : 0}, BedarfSumme=${demandSum}.`);
  const normalizedSettings = {
    maxWorkHours: Math.max(1, Number.parseFloat(String(settings?.maxWorkHours ?? 10)) || 10),
    minWorkHours: Math.max(0, Number.parseFloat(String(settings?.minWorkHours ?? 4)) || 0),
    minPauseHours: Math.max(0, Number.parseFloat(String(settings?.minPauseHours ?? 3)) || 0),
    bufferMinutes: Math.max(0, Number.parseInt(String(settings?.bufferMinutes ?? 20), 10) || 0),
    rideDurationMinutes: Math.max(20, Number.parseInt(String(settings?.rideDurationMinutes ?? DEFAULT_RIDE_DURATION_MINUTES), 10) || DEFAULT_RIDE_DURATION_MINUTES),
    // Zielfunktion und Abbruchkriterium des CP-SAT-Solvers: gerechnet wird bis
    // zur gewünschten Lösungsgüte (Abstand zum Optimum in %), nicht auf Zeit.
    mode: String(settings?.mode || 'balanced'),
    qualityGapPercent: Math.max(0, Number.parseFloat(String(settings?.qualityGapPercent ?? 0)) || 0),
  };
  normalizedSettings.minWorkHours = Math.min(normalizedSettings.maxWorkHours, normalizedSettings.minWorkHours);

  const heuristic = buildHeuristicSuggestions({
    drivers,
    rides,
    demandProfile,
    maxWorkMinutes: normalizedSettings.maxWorkHours * 60,
    minWorkMinutes: normalizedSettings.minWorkHours * 60,
    minPauseMinutes: normalizedSettings.minPauseHours * 60,
    bufferMinutes: normalizedSettings.bufferMinutes,
    rideDurationMinutes: normalizedSettings.rideDurationMinutes,
  });

  if (KI_PROVIDER === 'cp_sat' || KI_PROVIDER === 'solver' || KI_PROVIDER === 'optimizer') {
    try {
      const normalizedRidesForDemand = normalizeRides(
        rides,
        normalizedSettings.bufferMinutes,
        normalizedSettings.rideDurationMinutes,
      );
      const syntheticRides = buildSyntheticRidesFromDemand({
        normalizedRides: normalizedRidesForDemand,
        demandProfile,
        bufferMinutes: normalizedSettings.bufferMinutes,
        rideDurationMinutes: normalizedSettings.rideDurationMinutes,
        maxSyntheticPerHour: 3,
        maxSyntheticTotal: 54,
      }).map((ride) => ({
        id: String(ride?.id || '').trim(),
        ride_date: serviceDate,
        etd: String(ride?.etd || '').trim(),
        status: 'open',
      }));
      const ridesForCpSat = (Array.isArray(rides) ? rides : []).length > 0
        ? rides
        : syntheticRides;
      if ((Array.isArray(rides) ? rides : []).length === 0 && syntheticRides.length > 0) {
        logProgress(`Keine echten Fahrten. Erzeuge ${syntheticRides.length} Demand-Fahrten (CP-SAT-Cap aktiv).`);
      }

      logProgress('Solver-Modus: CP-SAT aktiv.');
      logProgress('Starte CP-SAT Optimierer ...');
      // Demo: der Planer-Server ist nicht erreichbar. Vorab mit dem echten
      // CP-SAT-Planer gerechnete Ergebnisse fuer genau diese Eingaben nutzen
      // (siehe demo/planerErgebnisse.js); nur ohne Treffer bleibt die Heuristik.
      // Gleiche Eingaben wie die Anfrage an den Planer (mit echten Fahrzeiten).
      // TRISAR-Engine (Optionen Standard und Sicher): vorab gerechnet,
      // siehe demo/engineErgebnisse.js. Sonst die bisherigen CP-SAT-Ergebnisse.
      const enginePlan = await enginePlanFinden({ serviceDate, mode: normalizedSettings.mode, rides: ridesForCpSat });
      if (enginePlan) logProgress('TRISAR-Engine: Szenarien, Fahrzeugketten, Ladeplan.');
      const echterPlan = enginePlan || await echtenPlanFinden({
        serviceDate,
        settings: normalizedSettings,
        drivers,
        rides: mitEchtenFahrzeiten(ridesForCpSat),
        vehicles: Array.isArray(vehicles) ? vehicles : [],
      });
      if (echterPlan) {
        console.debug(`[planer] ${serviceDate}: vorab gerechnetes CP-SAT-Ergebnis (${echterPlan.treffer})`);
        // Kurze Rechenpause, damit der Ablauf wie eine echte Planung wirkt.
        const fahrtenAnzahl = Array.isArray(ridesForCpSat) ? ridesForCpSat.length : 0;
        await new Promise((fertig) => setTimeout(fertig, Math.min(4200, 1400 + fahrtenAnzahl * 8)));
      }
      const cpSatRaw = echterPlan ? echterPlan.antwort : await callCpSatPlanner({
        drivers,
        rides: ridesForCpSat,
        vehicles,
        serviceDate,
        settings: normalizedSettings,
        demandProfile,
        onProgress: logProgress,
      });
      const suggestions = Array.isArray(cpSatRaw?.suggestions) ? cpSatRaw.suggestions : [];
      const warnings = Array.isArray(cpSatRaw?.warnings) ? cpSatRaw.warnings : [];
      const unassigned = Array.isArray(cpSatRaw?.unassigned_ride_ids) ? cpSatRaw.unassigned_ride_ids : [];
      const vehiclePlans = Array.isArray(cpSatRaw?.vehicle_plans) ? cpSatRaw.vehicle_plans : [];
      logProgress(`Solver-Quelle bestätigt: ${String(cpSatRaw?.source || 'cp_sat')}.`);
      logProgress(`CP-SAT Plan erstellt (Vorschläge: ${suggestions.length}).`);
      if (vehiclePlans.length > 0) {
        const evCount = vehiclePlans.filter((plan) => plan?.is_ev).length;
        logProgress(`Fahrzeugplanung: ${vehiclePlans.length} Schichten mit Fahrzeug, davon ${evCount} EV.`);
      }
      return {
        source: String(cpSatRaw?.source || 'cp_sat'),
        suggestions,
        warnings,
        unassigned_ride_ids: unassigned,
        kpis: cpSatRaw?.kpis || null,
        vehicle_plans: vehiclePlans,
        fleet_kpis: cpSatRaw?.fleet_kpis || null,
        tunnel: cpSatRaw?.tunnel || null,
        engine: cpSatRaw?.engine || null,
      };
    } catch (error) {
      const errorMessage = String(error?.message || 'unbekannter Fehler');
      logProgress(`CP-SAT fehlgeschlagen: ${errorMessage}`);
      logProgress(`Solver-Quelle gewechselt: heuristic (Fallback, BedarfSumme=${demandSum}).`);
      return {
        ...heuristic,
        source: 'heuristic',
        warnings: [
          ...heuristic.warnings,
          `CP-SAT nicht verfügbar (${errorMessage}). Heuristik verwendet.`,
          'Hinweis: Prüfe ob der Planner-Container läuft (Port 8790, Proxy /planner).',
        ],
      };
    }
  }

  if (KI_PROVIDER !== 'ollama') {
    logProgress(`KI Provider "${KI_PROVIDER}" nicht unterstützt, nutze Heuristik.`);
    return {
      ...heuristic,
      source: 'heuristic',
      warnings: [...heuristic.warnings, `KI Provider "${KI_PROVIDER}" nicht unterstützt. Heuristik verwendet.`],
    };
  }

  const knownDrivers = (Array.isArray(drivers) ? drivers : []).map((driver) => ({
    id: String(driver?.id || '').trim(),
    name: String(driver?.name || '').trim(),
  }));
  const knownRideIds = new Set((Array.isArray(rides) ? rides : []).map((ride) => String(ride?.id || '').trim()).filter(Boolean));

  try {
    logProgress('Starte KI-Planung mit Ollama ...');
    const ollamaRaw = await callOllamaPlanner({
      drivers,
      rides,
      serviceDate,
      settings: normalizedSettings,
      demandProfile,
      heuristicDraft: heuristic,
      onProgress: logProgress,
    });
    const parsed = normalizeAiResponse(ollamaRaw, knownDrivers, knownRideIds);
    if (!parsed) {
      const keys = Object.keys(ollamaRaw || {}).slice(0, 8).join(', ');
      if (keys) logProgress(`Antwort-Keys: ${keys}`);
      logProgress('Ollama-Antwort erkannt, aber Planstruktur nicht kompatibel. Heuristik aktiv.');
      return {
        ...heuristic,
        source: 'heuristic',
        warnings: [...heuristic.warnings, 'Ollama lieferte kein verwertbares JSON. Heuristik verwendet.'],
      };
    }
    const merged = mergeAiAndHeuristicSuggestions(parsed, heuristic);
    logProgress(`KI-Plan erfolgreich erstellt (Vorschläge: ${merged.suggestions.length}).`);
    return merged;
  } catch (error) {
    const errorMessage = String(error?.message || 'unbekannter Fehler');
    const extraHints = [];
    if (/html statt json|kein json|proxy\/url/i.test(errorMessage)) {
      extraHints.push('Hinweis: Wenn die App nicht ueber Vite-Dev-Server laeuft, funktioniert VITE_OLLAMA_URL=/ollama meist nicht.');
      extraHints.push('Setze dann VITE_OLLAMA_URL auf eine erreichbare Ollama-URL (z. B. http://127.0.0.1:11434 bei lokalem HTTP).');
    }
    logProgress(`Ollama fehlgeschlagen: ${error?.message || 'unbekannter Fehler'}`);
    logProgress(`Heuristik-Fallback aktiv (BedarfSumme=${demandSum}).`);
    return {
      ...heuristic,
      source: 'heuristic',
      warnings: [
        ...heuristic.warnings,
        `Ollama nicht verfügbar (${errorMessage}). Heuristik verwendet.`,
        ...extraHints,
      ],
    };
  }
};
