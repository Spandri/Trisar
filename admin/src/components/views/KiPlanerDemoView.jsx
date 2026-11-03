import { cloneElement, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import BackCircleButton from '../ui/BackCircleButton';
import FahrtSimulationView from './FahrtSimulationView';
import TrisarFooter from '../ui/TrisarFooter';
import { computeDemandCurve } from '../../demo/planungsKurven';
import { planDriverShiftsWithOllama } from '../../services/kiDriverPlanner';
import { supabase } from '../../services/supabase';
import { DEMO_MODE } from '../../datenquelle';
import { useI18n } from '../../i18n';
import KiPlanerSettingsView, { DEFAULT_PLANNER_SETTINGS } from './KiPlanerSettingsView';
import EinsatzplanungKalender from './EinsatzplanungKalender';
import EinsatzplanungTag from './EinsatzplanungTag';
import EreignisseView from './EreignisseView';
import PufferView from './PufferView';
import NeuplanungView from './NeuplanungView';
import { engineTag } from '../../demo/engineErgebnisse';
import {
  neuplanungStatus, neuplanungStatusSetzen, neuplanungZielLesen, neuplanungZielLoeschen,
} from '../../demo/stoerungDemo';
import EinsatzplanungBedarf from './EinsatzplanungBedarf';
import EinsatzplanungUebersicht from './EinsatzplanungUebersicht';
import EinsatzTagKarte from './EinsatzTagKarte';
import { tutorialLaeuft } from '../ui/demoDialoge';

// KI Planer (Demo-Vorschau) – Umsetzung des Figma-Designs Trisar_App_01 / Node 2094:12368.
// Chart ist über den 3-Tage-Planungshorizont wischbar; der Planungstag folgt dem
// sichtbaren Fenster. Schichten werden erst über accept vergeben (onApplySuggestions).

const BASE_WIDTH = 402;
const WINDOW_HOURS = 24; // Diagramm zeigt immer einen ganzen Einsatztag
const HORIZON_DAYS = 3;
const HORIZON_HOURS = HORIZON_DAYS * 24;
const WINDOW_SLOTS = Array.from({ length: WINDOW_HOURS }, (_, i) => i);
const DAY_HOURS = Array.from({ length: 18 }, (_, i) => 6 + i); // 06–23 Uhr für Bedarfsprofil

const TRISAR_LIME = '#e3f654';
const TRISAR_TITLE = '#e2f754';
const TRISAR_GREEN = '#59be80';
const TRISAR_RED = '#ff6f63';
const TRISAR_BLUE = '#0059ff';

const screenBg = {
  backgroundImage:
    'radial-gradient(ellipse 141.42% 102.21% at 0% 0%, #0048cf 0%, #00369b 11.415%, #002468 22.83%, #001b4e 28.537%, #001234 34.244%, #00091a 39.952%, #00050d 42.805%, #000000 45.659%, #000000 83.626%, #000000 100%)',
};

// Strategien = echte Planer-Einstellungen (max./min. Arbeitszeit, Pausen,
// Puffer) plus Größe des Fahrerpools, aus dem der Algorithmus wählen darf.
// Die drei Strategien setzen das ZIEL des Solvers (mode) und dazu passende
// Regeln. Der `mode` fehlte bisher — dadurch rechneten alle drei Knoepfe mit
// derselben Zielfunktion und unterschieden sich kaum.
//   cost          = wenige Fahrer, Kosten zuerst
//   balanced      = Ausgleich zwischen Kosten, Fairness und Service
//   service_level = Abdeckung und Puffer zuerst
// Der Fahrerpool bleibt unangetastet: dafuer gibt es einen eigenen Regler.
// Optionen der TRISAR-Engine (vorab gerechnet, demo/engineErgebnisse.js), wie im
// Antrag (1.2): CO2 und Kosten sind gemeinsam Ziel, gewaehlt wird die Sicherheit vorab.
//   standard = Verspaetung als Abwaegung ueber die Verlaeufe, Nachsteuern am Einsatztag
//   sicher   = jeder Anschluss haelt in 499 von 500 Verlaeufen, dafuer mehr Fahrzeuge
const STRATEGIES = [
  {
    key: 'standard',
    labelKey: 'planer.optionStandard',
    settings: { mode: 'standard', maxWorkHours: 10, minWorkHours: 3, minPauseHours: 3, bufferMinutes: 0 },
  },
  {
    key: 'sicher',
    labelKey: 'planer.optionSicher',
    settings: { mode: 'sicher', maxWorkHours: 10, minWorkHours: 3, minPauseHours: 3, bufferMinutes: 0 },
  },
];

const pad2 = (value) => String(value).padStart(2, '0');

const normalizeClock = (value) => {
  const match = String(value || '').match(/(\d{1,2}):(\d{2})/);
  if (!match) return '';
  return `${pad2(Number.parseInt(match[1], 10))}:${match[2]}`;
};

const clockToMinutes = (clock) => {
  const normalized = normalizeClock(clock);
  if (!normalized) return null;
  const [h, m] = normalized.split(':').map((part) => Number.parseInt(part, 10));
  return h * 60 + m;
};

const getTodayIso = () => {
  const now = new Date();
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
};

const addDaysToIso = (iso, days) => {
  const [y, m, d] = iso.split('-').map(Number);
  const shifted = new Date(Date.UTC(y, m - 1, d) + days * 86400000);
  return `${shifted.getUTCFullYear()}-${pad2(shifted.getUTCMonth() + 1)}-${pad2(shifted.getUTCDate())}`;
};

const formatDayLabel = (iso, locale) =>
  new Intl.DateTimeFormat(locale, { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' })
    .format(new Date(`${iso}T12:00:00`));

// Gesetzliche Ruhezeit zwischen zwei Schichten (§ 5 ArbZG).
// Ruhezeit zwischen zwei Einsatztagen (§ 5 ArbZG). Voreinstellung 11 h,
// über die Planungsregeln einstellbar.
const REST_HOURS_DEFAULT = 11;

// Auswahl beim Start der Einsatzplanung: wie viele Tage ab dem angezeigten
// Tag geplant werden sollen.
const PLANNING_RANGES = [
  { key: 'day', labelKey: 'planer.rangeDay', days: 1 },
  { key: 'two', labelKey: 'planer.rangeTwoDays', days: 2 },
  { key: 'all', labelKey: 'planer.rangeAllDays', days: 3 },
];

const EXCLUDED_RIDE_STATUSES = new Set(['done', 'completed', 'arrived', 'archived', 'cancelled', 'canceled', 'refused', 'rejected']);

// Planer-Ergebnis (echte Heuristik aus kiDriverPlanner) in Kartendaten übersetzen
const mapPlannerSuggestions = (plannerResult, rides, strategyKey, dayIso, t) => {
  const rideById = new Map(
    (Array.isArray(rides) ? rides : []).map((ride) => [String(ride?.id || '').trim(), ride]),
  );
  // Fahrzeugpläne (Stage 2 des CP-SAT-Backends) je Fahrer; bei Heuristik leer.
  const vehiclePlanByDriverId = new Map(
    (Array.isArray(plannerResult?.vehicle_plans) ? plannerResult.vehicle_plans : [])
      .map((plan) => [String(plan?.driver_id || '').trim(), plan])
      .filter(([driverId]) => Boolean(driverId)),
  );
  const entries = (Array.isArray(plannerResult?.suggestions) ? plannerResult.suggestions : [])
    .filter((entry) => entry?.service_start && entry?.service_end);
  // Geteilte Dienste: gleiche driver_id taucht zweimal auf (Früh- + Spätblock).
  const blockCountByDriverId = new Map();
  entries.forEach((entry) => {
    const driverId = String(entry?.driver_id || '').trim();
    if (driverId) blockCountByDriverId.set(driverId, (blockCountByDriverId.get(driverId) || 0) + 1);
  });
  return entries
    .map((entry, index) => {
      const start = normalizeClock(entry.service_start);
      const end = normalizeClock(entry.service_end);
      const startMinutes = clockToMinutes(start) ?? 0;
      // Dienst ueber Mitternacht ("16:57–00:03"): Ende zaehlt zum Folgetag.
      const endeRoh = clockToMinutes(end) ?? startMinutes;
      const endMinutes = endeRoh < startMinutes ? endeRoh + 24 * 60 : endeRoh;
      const hoursRaw = Math.max(0, (endMinutes - startMinutes) / 60);
      const hours = Math.round(hoursRaw * 2) / 2;
      const assigned = (Array.isArray(entry.assigned_ride_ids) ? entry.assigned_ride_ids : [])
        .map((id) => rideById.get(String(id || '').trim()))
        .filter(Boolean)
        .map((ride) => {
          const engineFahrt = plannerResult?.engine?.fahrten?.[String(ride?.id || '').trim()] || null;
          const etd = normalizeClock(ride?.etd);
          // Echte Fahrzeit inkl. Stauprognose, falls hinterlegt; sonst nach Fahrttyp
          // wie in demo/einsatzKennzahlen.js.
          const durationMinutes = Number(ride?.ext_route_duration_in_traffic_mins)
            || Number(ride?.ext_route_duration_mins) || null;
          const dauerAnzeige = durationMinutes || (ride?.trip_type === 'airport' ? 55 : 25);
          const etdMinuten = clockToMinutes(etd);
          return {
            etd,
            pickup: String(ride?.pickup_name || ride?.pickup_address || '').trim(),
            dropoff: String(ride?.dropoff_name || ride?.dropoff_address || '').trim(),
            adresseAb: String(ride?.pickup_address || ride?.pickup_name || '').trim(),
            adresseZiel: String(ride?.dropoff_address || ride?.dropoff_name || '').trim(),
            ankunft: etdMinuten == null ? '' : normalizeClock(`${Math.floor((etdMinuten + dauerAnzeige) / 60) % 24}:${pad2((etdMinuten + dauerAnzeige) % 60)}`),
            passengers: Number(ride?.passengers) || 1,
            km: Number(ride?.ext_route_distance_m) > 0
              ? Number(ride.ext_route_distance_m) / 1000
              : (ride?.trip_type === 'airport' ? 40 : 12),
            durationMinutes,
            id: String(ride?.id || '').trim(),
            sammel: Boolean(engineFahrt?.sammel),
            route: engineFahrt?.route || null,
            reserveMin: Number.isFinite(Number(engineFahrt?.reserve_min)) ? Number(engineFahrt.reserve_min) : null,
          };
        })
        .filter((ride) => ride.etd && ride.pickup && ride.dropoff)
        .sort((a, b) => a.etd.localeCompare(b.etd));
      const stops = assigned.slice(0, 3).map((ride) => `${ride.etd} ${ride.pickup} - ${ride.dropoff}`);
      if (assigned.length > 3) stops.push(t('planer.moreRides', { n: assigned.length - 3 }));
      // Geteilte Dienste: der Spätblock läuft solverseitig unter "<id>#B" —
      // auch sein Fahrzeugplan. Hinweis als erste Kartenzeile; erkannt über
      // split_block bzw. doppelt vorkommende driver_id (nicht über den
      // deutschen note-Text des Servers).
      const entryDriverId = String(entry.driver_id || '').trim();
      if (entry.split_block === 'late') {
        stops.unshift(t('planer.splitShiftLate'));
      } else if (entryDriverId && (blockCountByDriverId.get(entryDriverId) || 0) > 1) {
        stops.unshift(t('planer.splitShiftEarly'));
      }
      const vehicleKey = entry.split_block === 'late'
        ? `${entryDriverId}#B`
        : entryDriverId;
      const vehiclePlan = vehiclePlanByDriverId.get(vehicleKey) || null;
      return {
        // Für die Fahrt-Simulation: alle Fahrten und Ladestopps des Vorschlags.
        rides: assigned,
        chargeStops: Array.isArray(vehiclePlan?.charge_stops) ? vehiclePlan.charge_stops : [],
        id: `${dayIso}-${strategyKey}-${entry.driver_id || index}-${start}`,
        dayIso,
        driverId: entryDriverId,
        name: String(entry.driver_name || '').trim() || t('planer.driverFallback', { n: index + 1 }),
        start,
        end,
        hours: Number.isInteger(hours) ? `${hours}` : hours.toFixed(1).replace('.', ','),
        stops,
        startMinutes,
        endMinutes,
        vehicleLabel: String(vehiclePlan?.vehicle_label || '').trim(),
        vehicleIsEv: Boolean(vehiclePlan?.is_ev),
        vehicleId: String(vehiclePlan?.vehicle_id || '').trim(),
        shiftKm: Number.isFinite(Number(vehiclePlan?.shift_km)) ? Math.round(Number(vehiclePlan.shift_km)) : null,
        chargeStopCount: Array.isArray(vehiclePlan?.charge_stops) ? vehiclePlan.charge_stops.length : 0,
        rideIds: (Array.isArray(entry.assigned_ride_ids) ? entry.assigned_ride_ids : []).map((id) => String(id || '').trim()),
        minRangeReserveKm: Number.isFinite(Number(vehiclePlan?.min_range_reserve_km)) ? Math.round(Number(vehiclePlan.min_range_reserve_km)) : null,
      };
    })
    .sort((a, b) => a.startMinutes - b.startMinutes);
};

// Planungsergebnisse überleben nicht nur das Schließen des Planers, sondern
// auch einen Reload: sie liegen zusätzlich im sessionStorage. Ein teuer
// gerechneter Solver-Lauf darf nicht durch einen versehentlichen Reload
// verloren gehen. Der Schlüssel trägt das heutige Datum, damit die
// Demo-Datumsverschiebung nicht zu Ergebnissen am falschen Tag führt.
const PLAN_STORAGE_KEY = 'trisar_planer_cache_v1';

const readPlanStorage = () => {
  try {
    const raw = window.sessionStorage.getItem(PLAN_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.today !== getTodayIso()) return null;
    return parsed;
  } catch {
    return null;
  }
};

const writePlanStorage = (planned, accepted, dismissed, einsatz) => {
  try {
    window.sessionStorage.setItem(PLAN_STORAGE_KEY, JSON.stringify({
      today: getTodayIso(),
      planned,
      accepted,
      dismissed: [...dismissed],
      acceptedIds: [...acceptedIdsCache],
      einsatz,
    }));
  } catch {
    // Speicher voll oder nicht verfügbar — Planung bleibt dann nur im Speicher.
  }
};

// Akzeptierte Schichten überleben das Schließen des Planers (Seiten-Session):
// der Apply-Hook ERSETZT die Tagesplanung, also müssen frühere Accepts des
// Tages auch nach einem Remount noch mitgesendet werden. Reload leert den
// Cache zusammen mit dem restlichen In-Memory-Demo-Store — konsistent.
const gespeichert = typeof window !== 'undefined' ? readPlanStorage() : null;

const acceptedByDayCache = { ...(gespeichert?.accepted || {}) };

// Planungsergebnisse je Tag (dayIso -> { suggestions, source, gap, fleetKpis }).
// Bleiben erhalten, auch wenn Vorschläge noch nicht akzeptiert wurden und der
// Planer zwischendurch geschlossen wird. Erst der Reload leert sie, zusammen
// mit dem restlichen In-Memory-Demo-Store.
const plannedByDayCache = { ...(gespeichert?.planned || {}) };
// Verworfene Vorschläge (refuse) — ebenfalls über Remounts hinweg gemerkt.
const dismissedIdsCache = new Set(gespeichert?.dismissed || []);
// Akzeptierte Vorschläge: bleiben sichtbar, aber als übernommen markiert.
const acceptedIdsCache = new Set(gespeichert?.acceptedIds || []);

// Nach jeder Änderung an den Caches den Speicher nachziehen.
// Zuletzt fertig geplanter Einsatz ({ tage, auswahl }) — danach die Hauptansicht
// der Planung (Uebersicht mit allen Tageskarten und der Gesamtkarte).
let einsatzCache = gespeichert?.einsatz || null;

const persistPlanCaches = () => writePlanStorage(plannedByDayCache, acceptedByDayCache, dismissedIdsCache, einsatzCache);

// Abstand des Inhalts zur Oberkante. Der Planer stand 20 px hoeher als die
// uebrigen Seiten (Zurueck-Knopf bei 40 statt 60).
const KOPF_VERSATZ = 20;
// Titel bei 140 wie auf allen Dispo-Seiten (30 px unter dem Zurueck-Knopf); der
// Inhalt darunter beginnt 24 px unter dem Titel. Die Datumszeile lag vorher
// direkt am Titel an — alles darunter rueckt deshalb um diesen Betrag nach.
const UNTER_TITEL_VERSATZ = 38;
const CHART_TOP_SCREEN = 190;
const PLOT_BASE_Y = 228;
const PLOT_HEIGHT = 200;
const PLOT_LEFT = 66;
const PLOT_RIGHT = 382;
const SLOT_WIDTH = (PLOT_RIGHT - PLOT_LEFT - 9) / (WINDOW_HOURS - 1);

// KI-Funken als Inline-SVG (Quelle: /icon/_Icon_Schwarz/KI_Funken_Trisar_01.svg).
// Nur inline lassen sich die beiden Sterne getrennt animieren: großer Stern
// links unten, kleiner rechts oben — sie pulsieren gegenläufig.
function KiSparkleIcon({ isAnimating = false, className = '' }) {
  const starClass = isAnimating ? 'trisar-sparkle-star' : '';
  const starOffsetClass = isAnimating ? 'trisar-sparkle-star trisar-sparkle-star--offset' : '';
  return (
    <svg viewBox="0 0 29 29.1386" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
      <g className={starClass}>
        <path d="M12.0833 29.0701C12.0833 29.0701 11.2722 16.9868 0 16.9868" stroke="#030202" strokeWidth="2" strokeMiterlimit="10" vectorEffect="non-scaling-stroke" />
        <path d="M12.0833 4.90347C12.0833 4.90347 12.8945 16.9868 24.1667 16.9868" stroke="#030202" strokeWidth="2" strokeMiterlimit="10" vectorEffect="non-scaling-stroke" />
        <path d="M12.0833 4.90347C12.0833 4.90347 11.2722 16.9868 0 16.9868" stroke="#030202" strokeWidth="2" strokeMiterlimit="10" vectorEffect="non-scaling-stroke" />
        <path d="M12.0833 29.0701C12.0833 29.0701 12.8945 16.9868 24.1667 16.9868" stroke="#030202" strokeWidth="2" strokeMiterlimit="10" vectorEffect="non-scaling-stroke" />
      </g>
      <g className={starOffsetClass}>
        <path d="M22.9583 12.1535C22.9583 12.1535 22.5522 6.1118 16.9167 6.1118" stroke="#010000" strokeWidth="2" strokeMiterlimit="10" vectorEffect="non-scaling-stroke" />
        <path d="M22.9583 12.1535C22.9583 12.1535 23.3645 6.1118 29 6.1118" stroke="#030202" strokeWidth="2" strokeMiterlimit="10" vectorEffect="non-scaling-stroke" />
        <path d="M22.9583 0.0701343C22.9583 0.0701343 22.5522 6.1118 16.9167 6.1118" stroke="#010000" strokeWidth="2" strokeMiterlimit="10" vectorEffect="non-scaling-stroke" />
        <path d="M22.9583 0.0701343C22.9583 0.0701343 23.3645 6.1118 29 6.1118" stroke="#030202" strokeWidth="2" strokeMiterlimit="10" vectorEffect="non-scaling-stroke" />
      </g>
    </svg>
  );
}

export default function KiPlanerDemoView({
  onClose,
  drivers = [],
  // Gesamtzahl der Fahrer im Bestand — begrenzt den Fahrerpool-Regler,
  // unabhaengig von einer aktiven Filterung der Fahrerliste.
  totalDriverCount = 0,
  allRides = [],
  supplySeries = [],
  ridesSeries = [],
  initialViewStart = 6,
  onApplySuggestions,
  plannerSettings = DEFAULT_PLANNER_SETTINGS,
  onChangePlannerSettings = () => {},
  // Navigationsleiste der App. Liegt sie vor, steht sie unten wie auf den
  // uebrigen Seiten, statt nur der Fusszeile.
  navi = null,
}) {
  const { t, locale } = useI18n();
  const [scale, setScale] = useState(1);
  const [strategyKey, setStrategyKey] = useState('standard');
  const [showSettings, setShowSettings] = useState(false);
  // Ablauf der Einsatzplanung: Kalender (Zeitraum) -> Tagesplanung
  // Mit einem fertigen Einsatz ist die Uebersicht die Hauptansicht, ohne Einsatz
  // geht es direkt in den Kalender — ausser im Tutorial, das vom KI-Planer aus startet.
  const [ablauf, setAblauf] = useState(() => {
    // Auch im Tutorial: ohne Einsatz direkt der Kalender, nie die alte Planer-Ansicht.
    return einsatzCache?.tage?.length ? 'uebersicht' : 'kalender';
  }); // null | 'uebersicht' | 'kalender' | 'bedarf' | 'tag'
  const [einsatz, setEinsatz] = useState(() => einsatzCache);
  // Karte, auf der die Uebersicht steht (beim Zurueckkommen aus einem Tag)
  const [uebersichtIndex, setUebersichtIndex] = useState(0);
  // Tagesplanung aus der Uebersicht geoeffnet: zurueck geht es dorthin.
  const [tagAusUebersicht, setTagAusUebersicht] = useState(false);
  // Tagesplanung -> Kartensymbol: alle Fahrten des Tages auf der Karte abspielen.
  const [tagesKarte, setTagesKarte] = useState(false);
  const [tagesKarteSignal, setTagesKarteSignal] = useState(0);
  // Per Hand erhoehter Bedarf: { [iso]: { [stunde]: wert } }
  const [bedarfAnpassung, setBedarfAnpassung] = useState({});
  const [kalenderAuswahl, setKalenderAuswahl] = useState(() => einsatzCache?.auswahl || null);
  const [planTage, setPlanTage] = useState(() => einsatzCache?.tage || []);
  const [planTagIndex, setPlanTagIndex] = useState(0);
  const [planungTag, setPlanungTag] = useState(null);
  const [simEntry, setSimEntry] = useState(null);
  const [ereignisseTag, setEreignisseTag] = useState(null); // Seite "Ereignisse" fuer diesen Tag
  const [pufferSeite, setPufferSeite] = useState(null);     // { tag, option, titel }
  // Neuplanung nach einer Störung, geöffnet über den Link im KI-Assistenten:
  // { iso, tag (Engine-Ergebnis), status, fehler, laeuft }
  const [neuplanung, setNeuplanung] = useState(() => {
    const iso = neuplanungZielLesen();
    return iso ? { iso, tag: null, status: neuplanungStatus(iso), fehler: '', laeuft: false } : null;
  });
  const neuplanungIso = neuplanung?.iso || null;
  useEffect(() => {
    neuplanungZielLoeschen();
    if (!neuplanungIso) return undefined;
    let aktiv = true;
    engineTag(neuplanungIso).then((tag) => {
      if (aktiv) setNeuplanung((n) => (n && n.iso === neuplanungIso ? { ...n, tag } : n));
    });
    return () => { aktiv = false; };
  }, [neuplanungIso]);
  const [isPlanning, setIsPlanning] = useState(false);
  const [dismissedIds, setDismissedIds] = useState(() => new Set(dismissedIdsCache));
  const [acceptedIds, setAcceptedIds] = useState(() => new Set(acceptedIdsCache));
  const [plannedByDay, setPlannedByDay] = useState(() => ({ ...plannedByDayCache }));
  const [planLog, setPlanLog] = useState('');
  const [applyError, setApplyError] = useState('');
  const [vehicles, setVehicles] = useState([]);

  // Welche Engine hat geplant: 'cp_sat' (echter Solver) oder 'heuristic'

  // Erreichte Lösungsgüte des letzten Laufs (Restlücke zum Optimum)

  const [acceptedByDay, setAcceptedByDay] = useState(() => ({ ...acceptedByDayCache }));
  // Sichtbares Chart-Fenster in absoluten Stunden (0 = heute 00:00)
  const [viewStart, setViewStart] = useState(() => {
    // Immer auf einen Tagesbeginn ausrichten (0, 24, 48 …)
    const numeric = Number(initialViewStart);
    const startHour = Number.isFinite(numeric) ? numeric : 0;
    const day = Math.max(0, Math.min(HORIZON_DAYS - 1, Math.floor(startHour / 24)));
    return day * 24;
  });

  useEffect(() => {
    const updateScale = () => setScale(Math.min(window.innerWidth / BASE_WIDTH, 1));
    updateScale();
    window.addEventListener('resize', updateScale);
    return () => window.removeEventListener('resize', updateScale);
  }, []);

  // Fahrzeugpool für Stage 2 der Planung (Fahrzeugzuteilung im Backend)
  useEffect(() => {
    let cancelled = false;
    const loadVehicles = async () => {
      const result = await supabase.from('vehicles').select('*');
      if (!cancelled && !result?.error && Array.isArray(result?.data)) {
        setVehicles(result.data);
      }
    };
    loadVehicles();
    return () => {
      cancelled = true;
    };
  }, []);

  const strategy = STRATEGIES.find((entry) => entry.key === strategyKey) || STRATEGIES[0];
  // Horizont ankert an heute – die Abs-Stunden-Serien des Parents sind ab
  // heute 00:00 indexiert.
  const todayIso = useMemo(() => getTodayIso(), []);

  // Serien über den gesamten Horizont; Bedarf über die gemeinsame Formel,
  // damit Planungsübersicht und KI Planer identische Kurven zeigen.
  const supplyAll = useMemo(
    () => Array.from({ length: HORIZON_HOURS }, (_, i) => Math.max(0, Number(supplySeries?.[i]) || 0)),
    [supplySeries],
  );
  const bookedAll = useMemo(
    () => Array.from({ length: HORIZON_HOURS }, (_, i) => Math.max(0, Number(ridesSeries?.[i]) || 0)),
    [ridesSeries],
  );
  const demandAll = useMemo(() => computeDemandCurve(supplyAll, bookedAll), [supplyAll, bookedAll]);
  // Bedarf inklusive der Anpassungen aus der Bedarfsuebersicht (hoeher oder niedriger).
  const demandAngepasst = useMemo(() => {
    const reihe = [...demandAll];
    Object.entries(bedarfAnpassung).forEach(([iso, stunden]) => {
      const tagNr = Math.round((new Date(`${iso}T12:00:00`) - new Date(`${getTodayIso()}T12:00:00`)) / 86400000);
      Object.entries(stunden || {}).forEach(([stunde, wert]) => {
        const index = tagNr * 24 + Number(stunde);
        if (index >= 0 && index < reihe.length) reihe[index] = Math.max(0, Number(wert) || 0);
      });
    });
    return reihe;
  }, [demandAll, bedarfAnpassung]);

  const absHours = useMemo(
    () => WINDOW_SLOTS.map((i) => viewStart + i),
    [viewStart],
  );
  const supply = absHours.map((abs) => supplyAll[abs] || 0);
  const booked = absHours.map((abs) => bookedAll[abs] || 0);
  const demand = absHours.map((abs) => demandAll[abs] || 0);

  // Planungstag = Tag der Fenstermitte
  const planningDayIndex = Math.max(0, Math.min(HORIZON_DAYS - 1, Math.round(viewStart / 24)));
  const planningDayIso = useMemo(() => addDaysToIso(todayIso, planningDayIndex), [todayIso, planningDayIndex]);

  const ridesOfDay = useMemo(
    () => (Array.isArray(allRides) ? allRides : []).filter(
      (ride) => String(ride?.ride_date || '').trim() === planningDayIso
        && !EXCLUDED_RIDE_STATUSES.has(String(ride?.status || '').trim().toLowerCase()),
    ),
    [allRides, planningDayIso],
  );
  // Der Planer verteilt nur offene Fahrten (ohne zugewiesenen Fahrer)
  const openRidesOfDay = useMemo(
    () => ridesOfDay.filter((ride) => !String(ride?.driver_id || '').trim()),
    [ridesOfDay],
  );
  const demandProfileOfDay = useMemo(
    () => DAY_HOURS.map((hour) => demandAll[planningDayIndex * 24 + hour] || 0),
    [demandAll, planningDayIndex],
  );

  // Y-Achse passt sich dem sichtbaren Fenster an (wie in der
  // Planungsübersicht auf „Alle Fahrer“)
  const { yMax, yStep } = useMemo(() => {
    const peak = Math.max(10, ...supply, ...demand, ...booked);
    const step = peak <= 20 ? 5 : peak <= 50 ? 10 : 20;
    return { yMax: Math.ceil(peak / step) * step, yStep: step };
  }, [supply, demand, booked]);

  const valueToY = (value) => PLOT_BASE_Y - (value / yMax) * PLOT_HEIGHT;
  const slotX = (index) => PLOT_LEFT + index * SLOT_WIDTH;
  const slotCenterX = (index) => slotX(index) + 4.5;

  // Aktuelle Werte für die Planung ohne Effect-Abhängigkeit (verhindert
  // Auto-Neuplanung durch Live-Updates der Fahrerliste)
  const driversRef = useRef(drivers);
  driversRef.current = drivers;
  const openRidesRef = useRef(openRidesOfDay);
  openRidesRef.current = openRidesOfDay;
  const demandRef = useRef(demandProfileOfDay);
  demandRef.current = demandProfileOfDay;
  const strategyRef = useRef(strategy);
  strategyRef.current = strategy;
  const settingsRef = useRef(plannerSettings);
  settingsRef.current = plannerSettings;
  const allRidesRef = useRef(allRides);
  allRidesRef.current = allRides;
  const demandAllRef = useRef(demandAll);
  // Berechneter Bedarf ohne Handanpassung — zum Erkennen, wo per Hand erhoeht wurde.
  const demandBasisRef = useRef(demandAll);
  demandBasisRef.current = demandAll;
  demandAllRef.current = demandAngepasst;
  const planningDayRef = useRef(planningDayIso);
  planningDayRef.current = planningDayIso;
  const vehiclesRef = useRef(vehicles);
  vehiclesRef.current = vehicles;

  // Lauf-Token gegen Races: Wischt man während einer laufenden Planung
  // weiter, gewinnt immer der zuletzt gestartete Lauf – ältere Läufe dürfen
  // weder Vorschläge committen noch den Spinner beenden.
  const planRunIdRef = useRef(0);

  // Ruhezeitfenster für einen Planungstag: Wer am Vortag spät aufgehört hat,
  // darf erst nach 11 h wieder starten; wer am Folgetag früh anfängt, muss
  // entsprechend früher Schluss machen (§ 5 ArbZG).
  const buildRestWindows = (dayIso, shiftsByDay, restHours = REST_HOURS_DEFAULT) => {
    const prevDay = addDaysToIso(dayIso, -1);
    const nextDay = addDaysToIso(dayIso, 1);
    const windows = new Map();

    (shiftsByDay[prevDay] || []).forEach((shift) => {
      const end = clockToMinutes(shift.end);
      if (end == null) return;
      const entry = windows.get(shift.driverId) || {};
      // Vortagsende liegt 1440 min vor dem Planungstag. Bei geteilten
      // Diensten zählt der späteste Block.
      const candidate = end - 1440 + restHours * 60;
      entry.earliest_start_minute = Math.max(entry.earliest_start_minute ?? candidate, candidate);
      windows.set(shift.driverId, entry);
    });

    (shiftsByDay[nextDay] || []).forEach((shift) => {
      const start = clockToMinutes(shift.start);
      if (start == null) return;
      const entry = windows.get(shift.driverId) || {};
      // Bei geteilten Diensten zählt der früheste Folgetagsblock.
      const candidate = start + 1440 - restHours * 60;
      entry.latest_end_minute = Math.min(entry.latest_end_minute ?? candidate, candidate);
      windows.set(shift.driverId, entry);
    });

    return windows;
  };

  // Plant einen einzelnen Tag und liefert Vorschläge + Rohergebnis zurück.
  const planSingleDay = async (dayIso, restWindows, activeSettings, activeStrategy, zeitfenster = null) => {
    // ALLE offenen Fahrten des Tages planen — auch solche, die bereits einem
    // Fahrer zugeordnet sind. Der Planer erstellt einen Vorschlag fuer den
    // ganzen Tag; bisher wurden zugewiesene Fahrten uebersprungen, wodurch an
    // ruhigen Tagen (alle Fahrten schon verteilt) nur Bereitschaft heraus kam.
    // Zeitfenster aus der Einsatzplanung: am ersten Tag erst ab der Startzeit,
    // am letzten Tag nur bis zur Endzeit.
    const imZeitfenster = (ride) => {
      const etd = normalizeClock(ride?.etd);
      if (!zeitfenster || !etd) return true;
      if (zeitfenster.startZeit && dayIso === zeitfenster.von && etd < zeitfenster.startZeit) return false;
      if (zeitfenster.endZeit && dayIso === zeitfenster.bis && etd > zeitfenster.endZeit) return false;
      return true;
    };
    const ridesOfDay = (Array.isArray(allRidesRef.current) ? allRidesRef.current : []).filter(
      (ride) => String(ride?.ride_date || '').trim() === dayIso
        && !EXCLUDED_RIDE_STATUSES.has(String(ride?.status || '').trim().toLowerCase())
        && imZeitfenster(ride),
    );
    const dayIndex = Math.max(0, Math.min(HORIZON_DAYS - 1, Math.round(
      (new Date(`${dayIso}T12:00:00`) - new Date(`${getTodayIso()}T12:00:00`)) / 86400000,
    )));
    const demandOfDay = DAY_HOURS.map((hour) => demandAllRef.current[dayIndex * 24 + hour] || 0);

    const driverRows = (Array.isArray(driversRef.current) ? driversRef.current : [])
      .slice(0, activeSettings.driverPool)
      .map((driver) => {
        const window = restWindows.get(String(driver?.id || '').trim()) || {};
        return { ...driver, ...window };
      });

    const result = await planDriverShiftsWithOllama({
      drivers: driverRows,
      rides: ridesOfDay,
      vehicles: vehiclesRef.current,
      serviceDate: dayIso,
      settings: {
        maxWorkHours: activeSettings.maxWorkHours,
        minWorkHours: activeSettings.minWorkHours,
        bufferMinutes: activeSettings.bufferMinutes,
        rideDurationMinutes: activeSettings.rideDurationMinutes,
        qualityGapPercent: activeSettings.qualityGapPercent,
        mode: activeSettings.mode,
      },
      demandProfile: demandOfDay,
      onProgress: (text) => {
        const raw = String(text);
        const input = raw.match(/^Input: Fahrer=(\d+), Fahrten=(\d+)/);
        if (input) {
          setPlanLog(t('planer.planLogInput', { day: formatDayLabel(dayIso, locale), drivers: input[1], rides: input[2] }));
        } else if (/Heuristik|Plan erstellt|Vorschläge/i.test(raw) && !/Provider|unterstützt/i.test(raw)) {
          setPlanLog(t('planer.planLogShifts', { day: formatDayLabel(dayIso, locale) }));
        }
      },
    });

    const suggestions = mapPlannerSuggestions(result, ridesOfDay, activeStrategy.key, dayIso, t);
    return {
      result,
      rides: ridesOfDay,
      rideCount: ridesOfDay.length,
      suggestions: [
        ...suggestions,
        ...bereitschaftFuerHandbedarf(dayIso, suggestions, driverRows, activeSettings, activeStrategy),
      ].sort((a, b) => a.startMinutes - b.startMinutes),
    };
  };

  // Handbedarf aus der Bedarfsuebersicht (heuristisch): Wo der Bedarf per Hand
  // erhoeht wurde und der Plan ihn nicht deckt, kommen Bereitschaftsdienste
  // freier Fahrer dazu. Stunde fuer Stunde: fehlende Fahrer = erhoehter Bedarf
  // minus Fahrer im Plan. Zusammenhaengende Luecken werden zu Diensten zwischen
  // Mindest- und Hoechstarbeitszeit; Ruhezeitfenster der Fahrer bleiben gewahrt.
  const bereitschaftFuerHandbedarf = (dayIso, suggestions, driverRows, activeSettings, activeStrategy) => {
    const tagNr = Math.round((new Date(`${dayIso}T12:00:00`) - new Date(`${getTodayIso()}T12:00:00`)) / 86400000);
    const stunden = Array.from({ length: 20 }, (_, i) => 6 + i);
    const imDienst = (minute) => suggestions.filter((v) => minute >= (v.startMinutes ?? 0) && minute < (v.endMinutes ?? 0)).length;
    const fehlend = stunden.map((stunde) => {
      const index = tagNr * 24 + stunde;
      const angepasst = Number(demandAllRef.current[index]) || 0;
      const basis = Number(demandBasisRef.current[index]) || 0;
      if (angepasst <= basis) return 0;
      return Math.max(0, Math.round(angepasst) - imDienst(stunde * 60 + 30));
    });
    if (!fehlend.some((n) => n > 0)) return [];

    const minStunden = Math.max(1, Number(activeSettings.minWorkHours) || 3);
    const maxStunden = Math.max(minStunden, Number(activeSettings.maxWorkHours) || 8);
    const belegt = new Set(suggestions.map((v) => v.driverId).filter(Boolean));
    const frei = (Array.isArray(driverRows) ? driverRows : []).filter((d) => d?.id && !belegt.has(String(d.id)));
    const dienste = [];
    const offen = [...fehlend];
    let sicherung = 0;
    while (offen.some((n) => n > 0) && sicherung < 200) {
      sicherung += 1;
      const erste = offen.findIndex((n) => n > 0);
      let letzte = erste;
      while (letzte + 1 < offen.length && offen[letzte + 1] > 0 && letzte - erste + 1 < maxStunden) letzte += 1;
      // Auf Mindestdauer bringen: erst nach hinten, dann nach vorn verlaengern.
      while (letzte - erste + 1 < minStunden && letzte + 1 < offen.length) letzte += 1;
      let anfang = erste;
      while (letzte - anfang + 1 < minStunden && anfang > 0) anfang -= 1;
      const startMinuten = stunden[anfang] * 60;
      const endMinuten = (stunden[letzte] + 1) * 60;
      const fahrerIndex = frei.findIndex((d) => (d.earliest_start_minute == null || d.earliest_start_minute <= startMinuten)
        && (d.latest_end_minute == null || d.latest_end_minute >= endMinuten));
      if (fahrerIndex < 0) break;
      const [fahrer] = frei.splice(fahrerIndex, 1);
      for (let i = anfang; i <= letzte; i += 1) offen[i] = Math.max(0, offen[i] - 1);
      const start = normalizeClock(`${Math.floor(startMinuten / 60)}:${pad2(startMinuten % 60)}`);
      const end = normalizeClock(`${Math.floor(endMinuten / 60) % 24}:${pad2(endMinuten % 60)}`);
      const stundenAnzahl = (endMinuten - startMinuten) / 60;
      dienste.push({
        rides: [],
        chargeStops: [],
        standby: true,
        id: `${dayIso}-${activeStrategy.key}-bereitschaft-${fahrer.id}-${start}`,
        dayIso,
        driverId: String(fahrer.id),
        name: String(fahrer.name || '').trim() || t('planer.driverFallback', { n: dienste.length + 1 }),
        start,
        end,
        hours: Number.isInteger(stundenAnzahl) ? `${stundenAnzahl}` : stundenAnzahl.toFixed(1).replace('.', ','),
        stops: [t('planer.standbyFallback')],
        startMinutes: startMinuten,
        endMinutes: endMinuten,
        vehicleLabel: '',
        vehicleIsEv: false,
        vehicleId: '',
        shiftKm: null,
        chargeStopCount: 0,
      });
    }
    return dienste;
  };

  // Plant den gewählten Zeitraum Tag für Tag. Jeder geplante Tag geht als
  // Ruhezeit-Randbedingung in den nächsten ein.
  const runPlanning = async (optionen = 1) => {
    const auftrag = typeof optionen === 'number' ? { rangeDays: optionen } : (optionen || {});
    const rangeDays = auftrag.rangeDays || 1;
    const runId = planRunIdRef.current + 1;
    planRunIdRef.current = runId;
    setIsPlanning(true);
    setPlanLog('');
    setApplyError('');
    const startedAt = performance.now();
    const MIN_PLAN_MS = 1400;
    const activeStrategy = auftrag.strategie || strategyRef.current;
    const activeSettings = {
      ...DEFAULT_PLANNER_SETTINGS,
      ...(settingsRef.current || {}),
      // Die gewählte Engine-Option bestimmt das Ziel, auch wenn die gespeicherten
      // Regeln noch einen alten Modus tragen.
      ...(activeStrategy?.settings?.mode ? { mode: activeStrategy.settings.mode } : {}),
      ...(auftrag.strategie ? auftrag.strategie.settings : {}),
    };
    const firstDay = planningDayRef.current;

    try {
      if (!Array.isArray(vehiclesRef.current) || vehiclesRef.current.length === 0) {
        const vehicleResult = await supabase.from('vehicles').select('*');
        if (!vehicleResult?.error && Array.isArray(vehicleResult?.data)) {
          vehiclesRef.current = vehicleResult.data;
          setVehicles(vehicleResult.data);
        }
      }

      // Bereits vergebene Schichten sind gesetzt und begrenzen die Ruhezeit.
      const shiftsByDay = { ...acceptedByDayCache };
      const collected = [];
      let lastResult = null;

      const startIndex = Math.round(
        (new Date(`${firstDay}T12:00:00`) - new Date(`${getTodayIso()}T12:00:00`)) / 86400000,
      );
      const days = [];
      if (Array.isArray(auftrag.tage)) {
        days.push(...auftrag.tage);
      } else {
        for (let offset = 0; offset < rangeDays; offset += 1) {
          const index = startIndex + offset;
          if (index < 0 || index >= HORIZON_DAYS) continue;
          days.push(addDaysToIso(getTodayIso(), index));
        }
      }

      for (const dayIso of days) {
        const restWindows = buildRestWindows(
          dayIso,
          shiftsByDay,
          Number(activeSettings.restHours) > 0 ? Number(activeSettings.restHours) : REST_HOURS_DEFAULT,
        );
        // eslint-disable-next-line no-await-in-loop
        setPlanungTag(dayIso);
        const dayPlan = await planSingleDay(dayIso, restWindows, activeSettings, activeStrategy, auftrag.zeitfenster || null);
        if (planRunIdRef.current !== runId) return;
        collected.push(...dayPlan.suggestions);
        lastResult = dayPlan.result;

        // Ergebnis am Tag festhalten — auch ohne accept bleibt es erhalten.
        const entry = {
          strategyKey: activeStrategy.key,
          suggestions: dayPlan.suggestions,
          source: String(dayPlan.result?.source || ''),
          gap: Number.isFinite(Number(dayPlan.result?.kpis?.optimality_gap))
            ? Number(dayPlan.result.kpis.optimality_gap)
            : null,
          solverStatus: String(dayPlan.result?.kpis?.solver_status || ''),
          // Offene Fahrten sichtbar machen: der Solver meldet sie, bisher
          // landeten sie nicht im Tagesergebnis und die Zeile blieb leer.
          unassignedCount: Number(dayPlan.result?.kpis?.unassigned_ride_count || 0),
          rideCount: Number(dayPlan.rideCount || 0),
          tunnel: dayPlan.result?.tunnel || null,
          fleetKpis: dayPlan.result?.fleet_kpis || null,
          engine: dayPlan.result?.engine || null,
        };
        // Neu geplante Vorschlaege dieses Tages wieder sichtbar und offen —
        // sofort, damit fruehere Tage des Zeitraums schon bearbeitet werden
        // koennen, waehrend spaetere noch rechnen.
        dayPlan.suggestions.forEach((suggestion) => {
          dismissedIdsCache.delete(suggestion.id);
          acceptedIdsCache.delete(suggestion.id);
        });
        plannedByDayCache[dayIso] = entry;
        persistPlanCaches();
        setPlannedByDay((prev) => ({ ...prev, [dayIso]: entry }));
        setDismissedIds(new Set(dismissedIdsCache));
        setAcceptedIds(new Set(acceptedIdsCache));

        // Für den nächsten Tag zählt, was hier geplant wurde.
        shiftsByDay[dayIso] = dayPlan.suggestions.map((suggestion) => ({
          driverId: suggestion.driverId,
          start: suggestion.start,
          end: suggestion.end,
        }));
      }

      const remaining = MIN_PLAN_MS - (performance.now() - startedAt);
      if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));
      if (planRunIdRef.current !== runId) return;

    } catch {
      if (planRunIdRef.current === runId) setPlanLog(t('planer.planFailed'));
    } finally {
      if (planRunIdRef.current === runId) {
        setIsPlanning(false);
        setPlanLog('');
        setPlanungTag(null);
      }
    }
  };

  // Geplant wird ausschließlich auf Knopfdruck ("KI Einsatzplanung").
  // Kein Automatiklauf beim Wischen, beim Öffnen oder nach dem Ändern von
  // Einstellungen — sonst wären teuer errechnete Ergebnisse sofort weg.

  // Es wird immer nur die Planung des angezeigten Tages gezeigt.
  const dayPlan = plannedByDay[planningDayIso] || null;
  const daySuggestions = dayPlan?.suggestions || [];
  // Akzeptierte bleiben sichtbar; nur abgelehnte verschwinden. Übernommene
  // Vorschläge rutschen ans Ende und sind dort nach Fahrernummer sortiert.
  const driverNumberById = useMemo(() => {
    const map = new Map();
    (Array.isArray(drivers) ? drivers : []).forEach((d) => {
      const nr = Number(d?.driverNumber);
      if (d?.id) map.set(String(d.id), Number.isFinite(nr) ? nr : Number.MAX_SAFE_INTEGER);
    });
    return map;
  }, [drivers]);

  const suggestions = daySuggestions
    .filter((entry) => !dismissedIds.has(entry.id))
    .slice()
    .sort((a, b) => {
      const aA = acceptedIds.has(a.id);
      const bA = acceptedIds.has(b.id);
      if (aA !== bA) return aA ? 1 : -1;
      if (aA) {
        const nrA = driverNumberById.get(String(a.driverId)) ?? Number.MAX_SAFE_INTEGER;
        const nrB = driverNumberById.get(String(b.driverId)) ?? Number.MAX_SAFE_INTEGER;
        if (nrA !== nrB) return nrA - nrB;
      }
      return (a.startMinutes ?? 0) - (b.startMinutes ?? 0);
    });
  const planSource = dayPlan?.source || '';
  // Fahrten ohne Fahrer des angezeigten Tages (kommt aus der Solver-Antwort).
  const unassignedCount = dayPlan?.unassignedCount || 0;
  const plannedRideCount = dayPlan?.rideCount || 0;
  const planGap = dayPlan?.gap ?? null;
  const solverStatus = dayPlan?.solverStatus || '';
  // KI-Korridor: Vorstufe hat den Suchraum abgesteckt (Variablenreduktion).
  const tunnelInfo = dayPlan?.tunnel || null;
  const fleetKpis = dayPlan?.fleetKpis || null;

  // Je Tag des Zeitraums: true = alle nicht abgelehnten Vorschlaege uebernommen.
  const tagesStatus = useMemo(() => planTage.map((iso) => {
    const offen = (plannedByDay[iso]?.suggestions || []).filter((entry) => !dismissedIds.has(entry.id));
    return offen.length > 0 && offen.every((entry) => acceptedIds.has(entry.id));
  }), [planTage, plannedByDay, dismissedIds, acceptedIds]);
  const alleTageFertig = tagesStatus.length > 0 && tagesStatus.every(Boolean);

  // Ist jeder Tag des Zeitraums geplant, geht es in die Uebersicht des
  // Einsatzes — nach einem Moment, damit der letzte accept sichtbar bleibt.
  useEffect(() => {
    if (ablauf !== 'tag' || tagAusUebersicht || !alleTageFertig || isPlanning || tutorialLaeuft()) return undefined;
    const timer = window.setTimeout(() => {
      einsatzCache = { tage: [...planTage], auswahl: kalenderAuswahl };
      persistPlanCaches();
      setEinsatz(einsatzCache);
      setUebersichtIndex(0);
      setAblauf('uebersicht');
    }, 1200);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ablauf, tagAusUebersicht, alleTageFertig, isPlanning]);

  // Die Tageskarte gehoert zur Tagesplanung: verlaesst man sie, schliesst sie.
  useEffect(() => {
    if (ablauf !== 'tag') setTagesKarte(false);
  }, [ablauf]);

  const handlePlan = () => {
    if (isPlanning) return;
    setAblauf('kalender');
  };

  // Tage mit gebuchten Fahrten — nur sie sind im Kalender waehlbar.
  const tageMitFahrten = useMemo(() => new Set(
    (Array.isArray(allRides) ? allRides : [])
      .filter((ride) => !EXCLUDED_RIDE_STATUSES.has(String(ride?.status || '').trim().toLowerCase()))
      .map((ride) => String(ride?.ride_date || '').trim())
      .filter((iso) => {
        const index = Math.round((new Date(`${iso}T12:00:00`) - new Date(`${todayIso}T12:00:00`)) / 86400000);
        return index >= 0 && index < HORIZON_DAYS;
      }),
  ), [allRides, todayIso]);

  // Kalender -> Planung des Zeitraums, danach der erste Tag.
  const zeitraumPlanen = (auswahl) => {
    const tage = [];
    for (let iso = auswahl.von; iso <= auswahl.bis; iso = addDaysToIso(iso, 1)) {
      if (tageMitFahrten.has(iso)) tage.push(iso);
    }
    if (!tage.length) return;
    setKalenderAuswahl(auswahl);
    setPlanTage(tage);
    setPlanTagIndex(0);
    setTagAusUebersicht(false);
    // Erst den Bedarf aller Tage zeigen; gerechnet wird danach.
    setAblauf('bedarf');
  };

  const bedarfAnpassen = (iso, stunde, wert) => {
    setBedarfAnpassung((alt) => ({ ...alt, [iso]: { ...(alt[iso] || {}), [stunde]: wert } }));
  };

  // Bedarfsuebersicht -> Tagesplanung: jetzt wird der Zeitraum geplant.
  const bedarfWeiter = () => {
    if (!planTage.length) return;
    setPlanTagIndex(0);
    setAblauf('tag');
    runPlanning({ tage: planTage, zeitfenster: kalenderAuswahl });
  };

  const tagWechseln = (index) => {
    setPlanTagIndex(index);
    const iso = planTage[index];
    if (iso) {
      const tagNr = Math.round((new Date(`${iso}T12:00:00`) - new Date(`${todayIso}T12:00:00`)) / 86400000);
      setViewStart(Math.max(0, Math.min(HORIZON_DAYS - 1, tagNr)) * 24);
    }
  };

  // Rundgang: direkt zu einem Tag der Tagesplanung springen ({ planerTag: <Tagesnummer, 0 = heute> }
  // im Zustand eines Tutorial-Schritts), statt bis zu den Pfeilen unten zu wischen.
  const tagWechselnRef = useRef(tagWechseln);
  tagWechselnRef.current = tagWechseln;
  const planTageRef = useRef(planTage);
  planTageRef.current = planTage;
  const ablaufRef = useRef(ablauf);
  ablaufRef.current = ablauf;
  const planungLaeuftRef = useRef(isPlanning);
  planungLaeuftRef.current = isPlanning;
  // Kommt der Wunsch, bevor die Tagesplanung steht (der Schritt navigiert erst
  // danach hin), wartet er, bis Tag und Plan da sind.
  const tagWunschRef = useRef(null);
  const runPlanningRef = useRef(null);
  runPlanningRef.current = runPlanning;
  const tagWunschAnwenden = useCallback(() => {
    const nr = tagWunschRef.current;
    if (!Number.isFinite(nr) || ablaufRef.current !== 'tag' || planungLaeuftRef.current) return;
    const index = planTageRef.current.findIndex((iso) => (
      Math.round((new Date(`${iso}T12:00:00`) - new Date(`${todayIso}T12:00:00`)) / 86400000) === nr
    ));
    if (index < 0) {
      // Tag noch nicht im Zeitraum: dazunehmen und nur ihn rechnen (vorab gerechnete
      // Engine-Ergebnisse, geht schnell). Danach greift der Wunsch beim naechsten Durchlauf.
      const iso = addDaysToIso(todayIso, nr);
      const tage = [...planTageRef.current, iso].sort();
      setPlanTage(tage);
      runPlanningRef.current?.({ tage: [iso], zeitfenster: null });
      return;
    }
    tagWunschRef.current = null;
    tagWechselnRef.current(index);
  }, [todayIso]);
  useEffect(() => {
    const anZustand = (e) => {
      // Tutorial: { planerZu: '<marker>' } springt ohne langes Wischen zu einem
      // Element der Tagesplanung (z. B. accept ganz unten).
      const ziel = e?.detail?.planerZu;
      if (typeof ziel === 'string' && ziel) {
        setTimeout(() => document.querySelector(`[data-tutorial="${ziel}"]`)?.scrollIntoView({ block: 'center' }), 250);
      }
      const nr = e?.detail?.planerTag;
      if (!Number.isFinite(nr)) return;
      tagWunschRef.current = nr;
      tagWunschAnwenden();
    };
    window.addEventListener('trisar:tutorial-zustand', anZustand);
    return () => window.removeEventListener('trisar:tutorial-zustand', anZustand);
  }, [tagWunschAnwenden]);
  useEffect(() => { tagWunschAnwenden(); }, [ablauf, isPlanning, planTage, tagWunschAnwenden]);

  // Uebersicht -> Tagesplanung des gewaehlten Tages.
  const einsatzTagOeffnen = (index) => {
    if (!einsatz?.tage?.[index]) return;
    const iso = einsatz.tage[index];
    setPlanTage(einsatz.tage);
    setKalenderAuswahl(einsatz.auswahl || null);
    setPlanTagIndex(index);
    const tagNr = Math.round((new Date(`${iso}T12:00:00`) - new Date(`${todayIso}T12:00:00`)) / 86400000);
    setViewStart(Math.max(0, Math.min(HORIZON_DAYS - 1, tagNr)) * 24);
    setUebersichtIndex(index);
    setTagAusUebersicht(true);
    setAblauf('tag');
  };

  // Strategie in der Tagesplanung: nur diesen Tag mit dem Preset neu planen.
  const tagesStrategie = (key) => {
    if (isPlanning) return;
    const preset = STRATEGIES.find((entry) => entry.key === key);
    const iso = planTage[planTagIndex];
    if (!preset || !iso) return;
    setStrategyKey(key);
    onChangePlannerSettings({ ...DEFAULT_PLANNER_SETTINGS, ...(plannerSettings || {}), ...preset.settings });
    runPlanning({ tage: [iso], zeitfenster: kalenderAuswahl, strategie: preset });
  };

  // Neuplanung uebernehmen: der neue Plan ersetzt den angenommenen Tag. Gezeigt
  // werden nur die Aenderungen, uebernommen wird der ganze neue Tagesplan.
  const neuplanungUebernehmen = async () => {
    const iso = neuplanung?.iso;
    const st = neuplanung?.tag?.stoerung;
    if (!iso || !st || typeof onApplySuggestions !== 'function') return;
    setNeuplanung((n) => ({ ...n, laeuft: true, fehler: '' }));
    const ridesOfDay = (Array.isArray(allRidesRef.current) ? allRidesRef.current : [])
      .filter((ride) => String(ride?.ride_date || '').trim() === iso);
    const basis = plannedByDay[iso]?.strategyKey || 'standard';
    const suggestions = mapPlannerSuggestions(st.antwort, ridesOfDay, `${basis}-neu`, iso, t);
    const rows = suggestions.filter((entry) => entry.driverId).map((entry) => ({
      driverId: entry.driverId, serviceStart: entry.start, serviceEnd: entry.end, rideIds: entry.rideIds || [], vehicleId: entry.vehicleId || '',
    }));
    const result = await onApplySuggestions({ serviceDate: iso, rows });
    if (!result?.ok) {
      setNeuplanung((n) => ({ ...n, laeuft: false, fehler: result?.error || t('planer.applyFailed') }));
      return;
    }
    const entry = {
      ...(plannedByDay[iso] || {}),
      strategyKey: basis,
      suggestions,
      engine: { ...(st.antwort.engine || {}), neuplanung: true },
      neueFahrten: st.aenderungen.flatMap((a) => a.ride_ids),
    };
    plannedByDayCache[iso] = entry;
    acceptedByDayCache[iso] = rows;
    suggestions.forEach((v) => { dismissedIdsCache.delete(v.id); acceptedIdsCache.add(v.id); });
    persistPlanCaches();
    setPlannedByDay((prev) => ({ ...prev, [iso]: entry }));
    setAcceptedByDay((prev) => ({ ...prev, [iso]: rows }));
    setDismissedIds(new Set(dismissedIdsCache));
    setAcceptedIds(new Set(acceptedIdsCache));
    neuplanungStatusSetzen(iso, 'uebernommen');
    setNeuplanung((n) => ({ ...n, laeuft: false, status: 'uebernommen' }));
  };

  // accept unten: alle offenen Vorschlaege des Tages auf einmal uebernehmen.
  const tagAnnehmen = async (dayIso) => {
    if (tagGesperrt(dayIso) || typeof onApplySuggestions !== 'function') return;
    const offen = (plannedByDay[dayIso]?.suggestions || [])
      .filter((entry) => !dismissedIds.has(entry.id) && !acceptedIds.has(entry.id) && entry.driverId);
    if (!offen.length) return;
    const bisher = (acceptedByDay[dayIso] || []).filter(
      (row) => !offen.some((entry) => entry.driverId === row.driverId && entry.start === row.serviceStart),
    );
    const rows = [...bisher, ...offen.map((entry) => ({ driverId: entry.driverId, serviceStart: entry.start, serviceEnd: entry.end, rideIds: entry.rideIds || [], vehicleId: entry.vehicleId || '' }))];
    const result = await onApplySuggestions({ serviceDate: dayIso, rows });
    if (!result?.ok) {
      setApplyError(result?.error || t('planer.applyFailed'));
      return;
    }
    acceptedByDayCache[dayIso] = rows;
    offen.forEach((entry) => acceptedIdsCache.add(entry.id));
    persistPlanCaches();
    setAcceptedByDay((current) => ({ ...current, [dayIso]: rows }));
    setAcceptedIds(new Set(acceptedIdsCache));
    setApplyError('');
    // Kein automatisches Weiterblaettern: zum naechsten Tag geht es ueber den Pfeil.
  };

  const handleStrategy = (key) => {
    if (isPlanning) return;
    const preset = STRATEGIES.find((entry) => entry.key === key);
    setStrategyKey(key);
    // Presets schreiben in die Planungseinstellungen — der Einstellungsdialog
    // zeigt danach genau die Werte, mit denen geplant wird.
    if (preset) {
      // Fahrerpool und Guetevorgabe bleiben erhalten — beides stellt der
      // Koordinator ueber die Planungsregeln selbst ein.
      onChangePlannerSettings({
        ...DEFAULT_PLANNER_SETTINGS,
        ...(plannerSettings || {}),
        ...preset.settings,
      });
      setPlanLog(t('planer.strategyApplied'));
    }
  };

  // Übernahme zurücknehmen: Markierung entfernen und die Dienstzeit des
  // Fahrers wieder aus der Tagesplanung herausnehmen.
  // Gesperrt ist nur der Tag, der gerade gerechnet wird.
  const tagGesperrt = (dayIso) => isPlanning && (!planungTag || planungTag === dayIso);

  const handleUndoAccept = async (entry) => {
    if (tagGesperrt(entry.dayIso || planningDayIso)) return;
    const dayIso = entry.dayIso || planningDayIso;
    const rows = (acceptedByDay[dayIso] || []).filter(
      (row) => !(row.driverId === entry.driverId && row.serviceStart === entry.start),
    );
    if (typeof onApplySuggestions === 'function') {
      const result = await onApplySuggestions({ serviceDate: dayIso, rows, allowEmpty: true });
      if (!result?.ok) {
        setApplyError(result?.error || t('planer.applyFailed'));
        return;
      }
    }
    acceptedByDayCache[dayIso] = rows;
    acceptedIdsCache.delete(entry.id);
    persistPlanCaches();
    setAcceptedByDay((current) => ({ ...current, [dayIso]: rows }));
    setAcceptedIds(new Set(acceptedIdsCache));
    setApplyError('');
  };

  const dismiss = (id) => {
    const dayIso = String(id).slice(0, 10);
    if (tagGesperrt(/^\d{4}-\d{2}-\d{2}$/.test(dayIso) ? dayIso : planningDayIso)) return; // während Neuplanung sind die Karten nur Vorschau
    // Auch im Modul-Cache merken, damit ein refuse das Schließen überlebt.
    dismissedIdsCache.add(id);
    persistPlanCaches();
    setDismissedIds((current) => {
      const next = new Set(current);
      next.add(id);
      return next;
    });
  };

  // accept: Schicht wirklich vergeben. Der Apply-Hook ersetzt die komplette
  // Tagesplanung, deshalb werden alle bisher akzeptierten Schichten des Tages
  // mitgegeben (akkumulierend statt überschreibend).
  const handleAccept = async (entry) => {
    if (tagGesperrt(entry.dayIso || planningDayIso)) return; // während Neuplanung sind die Karten nur Vorschau
    if (!entry.driverId || typeof onApplySuggestions !== 'function') {
      dismiss(entry.id);
      return;
    }
    // Immer der Tag, für den der Vorschlag berechnet wurde – nicht der
    // gerade sichtbare (schützt vor Accept direkt nach einem Wisch).
    const dayIso = entry.dayIso || planningDayIso;
    const existing = (acceptedByDay[dayIso] || []).filter(
      (row) => row.driverId !== entry.driverId || row.serviceStart !== entry.start,
    );
    const rows = [...existing, { driverId: entry.driverId, serviceStart: entry.start, serviceEnd: entry.end, rideIds: entry.rideIds || [], vehicleId: entry.vehicleId || '' }];
    const result = await onApplySuggestions({ serviceDate: dayIso, rows });
    if (result?.ok) {
      acceptedByDayCache[dayIso] = rows;
      persistPlanCaches();
      setAcceptedByDay((current) => ({ ...current, [dayIso]: rows }));
      setApplyError('');
      // Akzeptierte Vorschläge bleiben in der Liste stehen — sie werden als
      // übernommen markiert, statt zu verschwinden. Nur "refuse" blendet aus.
      acceptedIdsCache.add(entry.id);
      persistPlanCaches();
      setAcceptedIds(new Set(acceptedIdsCache));
    } else {
      setApplyError(result?.error || t('planer.applyFailed'));
    }
  };

  // Wischen: Chart horizontal ziehen, Planungstag folgt dem Fenster
  const dragRef = useRef(null);
  const handlePointerDown = (event) => {
    dragRef.current = { startX: event.clientX, startView: viewStart };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };
  const handlePointerMove = (event) => {
    if (!dragRef.current) return;
    // Wischen blättert tageweise: das Fenster bleibt immer ein voller Tag.
    const deltaHours = (dragRef.current.startX - event.clientX) / SLOT_WIDTH;
    const rawStart = dragRef.current.startView + deltaHours;
    const day = Math.max(0, Math.min(HORIZON_DAYS - 1, Math.round(rawStart / 24)));
    const next = day * 24;
    if (next !== viewStart) setViewStart(next);
  };
  const handlePointerUp = () => {
    dragRef.current = null;
    // Nach dem Loslassen sauber auf den Tagesbeginn einrasten.
    setViewStart((prev) => Math.max(0, Math.min(HORIZON_DAYS - 1, Math.round(prev / 24))) * 24);
  };

  // Karten rücken nach unten, wenn die Flotten-KPI-Zeile sichtbar ist.
  const CARDS_TOP = !applyError && planSource && !isPlanning ? 600 : 576;
  const CARD_BLOCK_HEIGHT = 232;
  const cardsHeight = Math.max(1, suggestions.length) * CARD_BLOCK_HEIGHT;
  // Mit Navigationsleiste braucht der Inhalt unten Platz, damit sich die
  // letzten Karten noch ueber sie hinaus scrollen lassen.
  const BASE_HEIGHT = KOPF_VERSATZ + UNTER_TITEL_VERSATZ + CARDS_TOP + cardsHeight + 60 + (navi ? 111 : 0);

  const dayLabel = formatDayLabel(planningDayIso, locale);

  // Solver-Statuszeile aus vollständigen t()-Phrasen zusammensetzen.
  const solverLineSegments = [];
  if (!applyError && planSource && !isPlanning) {
    if (planSource === 'cp_sat') {
      solverLineSegments.push(tunnelInfo ? t('planer.solverCpSatTunnel') : t('planer.solverCpSat'));
      if (planGap != null) {
        // OPTIMAL heisst hier: Gueteziel erreicht (relative Luecke). Alles andere
        // ist ein Abbruch am Zeitlimit — auch im Korridor.
        if (solverStatus === 'OPTIMAL' && tunnelInfo) {
          solverLineSegments.push(t('planer.solverGapTunnel', { gap: (planGap * 100).toFixed(1) }));
        } else if (solverStatus === 'OPTIMAL') {
          solverLineSegments.push(t('planer.solverGap', { gap: (planGap * 100).toFixed(1) }));
        } else {
          solverLineSegments.push(t('planer.solverGapMissed', { gap: (planGap * 100).toFixed(0) }));
        }
      }
    } else {
      solverLineSegments.push(t('planer.solverHeuristic'));
    }
    if (tunnelInfo) {
      solverLineSegments.push(t('planer.tunnelNarrowed', {
        from: Math.round(tunnelInfo.full_arc_pairs / 100) / 10,
        to: Math.round(tunnelInfo.tunnel_arc_pairs / 100) / 10,
      }));
    }
    if (unassignedCount > 0) {
      solverLineSegments.push(t('planer.ridesUnassigned', { unassigned: unassignedCount, total: plannedRideCount }));
    } else if (plannedRideCount > 0) {
      solverLineSegments.push(t('planer.ridesAllCovered', { total: plannedRideCount }));
    }
    if (fleetKpis) {
      solverLineSegments.push(fleetKpis.unassigned_shift_count > 0
        ? t('planer.fleetSummaryUnassigned', {
          ev: fleetKpis.ev_shift_count,
          combustion: fleetKpis.combustion_shift_count,
          unassigned: fleetKpis.unassigned_shift_count,
        })
        : t('planer.fleetSummary', {
          ev: fleetKpis.ev_shift_count,
          combustion: fleetKpis.combustion_shift_count,
        }));
      solverLineSegments.push(t('planer.fleetKm', { km: Math.round(fleetKpis.total_km) }));
      if (fleetKpis.co2_saved_kg > 0) {
        solverLineSegments.push(t('planer.fleetCo2', { kg: fleetKpis.co2_saved_kg }));
      }
    }
  }

  return (
    <div className="fixed inset-0 z-[240] bg-black">
      <div
        className="h-dvh w-full bg-black overflow-y-auto overflow-x-hidden overscroll-none flex justify-center"
        // Unter Kalender und Tagesplanung ausgeblendet: sonst gaebe es Tutorial-
        // Marker wie planer-strategie doppelt.
        style={{
          display: ablauf !== null ? 'none' : undefined,
          WebkitTextSizeAdjust: 'none',
          WebkitOverflowScrolling: 'touch',
          textSizeAdjust: 'none',
          fontFamily: 'Space Grotesk, sans-serif',
        }}
      >
        <div className="relative shrink-0" style={{ width: `${BASE_WIDTH * scale}px`, height: `${BASE_HEIGHT * scale}px` }}>
          <div
            className="absolute left-0 top-0 w-[402px] origin-top-left"
            style={{ ...screenBg, transform: `scale(${scale})`, height: `${BASE_HEIGHT}px` }}
          >
            {/* Der ganze Inhalt sitzt KOPF_VERSATZ tiefer: Zurueck-Knopf bei 60 wie auf
                den uebrigen Seiten. Der Hintergrund bleibt oben an der Kante. */}
            <div className="absolute left-0 w-[402px]" style={{ top: `${KOPF_VERSATZ}px` }}>
            <BackCircleButton onClick={onClose} className="absolute left-[20px] top-[40px]" marker="planer-zurueck" />

            {/* Filter-Icon (dekorativ, wie im Design) */}
            <button
              type="button"
              onClick={() => setShowSettings(true)}
              data-tutorial="planer-einstellungen-knopf"
              aria-label={t('planer.settingsAria')}
              className="absolute right-[20px] top-[40px] w-[50px] h-[50px] rounded-full bg-[#e3f654] flex items-center justify-center"
            >
              <img src="/icon/_Icon_Schwarz/Filter.svg" alt="" className="w-[34px] h-[21px] object-contain" />
            </button>

            <div data-tutorial="ki-planer" className="absolute left-[20px] top-[120px] text-[42px] font-bold tracking-[-0.5px] leading-none whitespace-nowrap" style={{ color: TRISAR_TITLE }}>
              {t('planer.title')}
            </div>
            {/* Alles unter dem Titel: 20 px Luft zum Titel wie auf "Alle Fahrer". */}
            <div className="absolute left-0 w-[402px]" style={{ top: `${UNTER_TITEL_VERSATZ}px` }}>
            {/* Datumszeile im Stil der Planungsübersicht (Alle Fahrer) */}
            <div className="absolute left-[20px] top-[148px] text-white/70 text-[11px] font-medium font-['Space_Grotesk'] tracking-[0.2px] whitespace-nowrap">
              {t('planer.swipeHint', { day: dayLabel })}
            </div>

            {/* Legende */}
            <div className="absolute left-[20px] top-[164px] w-[362px] flex items-center justify-between text-[12px] font-medium tracking-[0.5px]" style={{ color: TRISAR_LIME }}>
              <span className="flex items-center gap-[8px]">
                {t('planer.legendDrivers')}
                <span className="inline-block w-[12px] h-[12px]" style={{ background: TRISAR_GREEN }} />
              </span>
              <span className="flex items-center gap-[6px]">
                {t('planer.legendDemand')}
                <span className="inline-block w-[10px] h-[10px] rounded-full border border-black" style={{ background: TRISAR_LIME }} />
                <span className="inline-block w-[10px] h-[10px] rounded-full border border-black" style={{ background: TRISAR_RED }} />
              </span>
              <span className="flex items-center gap-[6px]">
                {t('planer.legendBooked')}
                <span className="inline-block w-[9px] h-[2px]" style={{ background: TRISAR_BLUE }} />
              </span>
            </div>

            {/* Chart (wischbar über den 3-Tage-Horizont) */}
            <svg
              data-tutorial="planer-diagramm"
              className="absolute left-0"
              style={{ top: `${CHART_TOP_SCREEN}px` }}
              width="402"
              height="265"
              viewBox="0 0 402 265"
            >
              {Array.from({ length: yMax / yStep + 1 }, (_, step) => {
                const value = yStep * step;
                const y = valueToY(value);
                return (
                  <g key={value}>
                    <line x1="20" x2="382" y1={y} y2={y} stroke={TRISAR_LIME} strokeWidth="1" />
                    <text x="20" y={y - 6} fill={TRISAR_LIME} fontSize="16" fontWeight="500" letterSpacing="0.5">
                      {value}
                    </text>
                  </g>
                );
              })}

              {/* Tagesgrenzen */}
              {absHours.map((abs, index) => (abs % 24 === 0 && index > 0 ? (
                <line
                  key={`day-${abs}`}
                  x1={slotX(index) - SLOT_WIDTH / 2 + 4.5}
                  x2={slotX(index) - SLOT_WIDTH / 2 + 4.5}
                  y1={valueToY(yMax)}
                  y2={PLOT_BASE_Y + 8}
                  stroke={TRISAR_LIME}
                  strokeWidth="1"
                  strokeDasharray="3 4"
                  opacity="0.7"
                />
              ) : null))}

              {WINDOW_SLOTS.map((index) => {
                const height = (supply[index] / yMax) * PLOT_HEIGHT;
                if (height <= 0) return null;
                return (
                  <rect
                    key={absHours[index]}
                    x={slotX(index)}
                    y={PLOT_BASE_Y - height}
                    width="9"
                    height={height}
                    fill={TRISAR_GREEN}
                  />
                );
              })}

              {/* Bedarfslinie (weiß) mit Punkten */}
              <polyline
                points={WINDOW_SLOTS.map((index) => `${slotCenterX(index)},${valueToY(demand[index])}`).join(' ')}
                fill="none"
                stroke="white"
                strokeWidth="1.5"
              />
              {/* Gebuchte Fahrten (blau) */}
              <polyline
                points={WINDOW_SLOTS.map((index) => `${slotCenterX(index)},${valueToY(booked[index])}`).join(' ')}
                fill="none"
                stroke={TRISAR_BLUE}
                strokeWidth="2"
              />
              {WINDOW_SLOTS.map((index) => (
                <circle
                  key={absHours[index]}
                  cx={slotCenterX(index)}
                  cy={valueToY(demand[index])}
                  r="4.5"
                  fill={demand[index] > supply[index] ? TRISAR_RED : TRISAR_LIME}
                  stroke="black"
                />
              ))}

              {absHours.map((abs, index) => (abs % 3 === 0 ? (
                <g key={`tick-${abs}`}>
                  <line x1={slotCenterX(index)} x2={slotCenterX(index)} y1={PLOT_BASE_Y + 1.5} y2={PLOT_BASE_Y + 8.5} stroke={TRISAR_LIME} strokeWidth="2" />
                  <text x={slotCenterX(index)} y={PLOT_BASE_Y + 24} fill={TRISAR_LIME} fontSize="11" fontWeight="500" letterSpacing="0.5" textAnchor="middle">
                    {`${pad2(abs % 24)}:00`}
                  </text>
                </g>
              ) : null))}
            </svg>

            {/* Wischfläche über dem Plot */}
            <div
              data-tutorial="planer-wischflaeche"
              className="absolute cursor-grab active:cursor-grabbing"
              style={{
                left: '20px',
                top: `${CHART_TOP_SCREEN}px`,
                width: '362px',
                height: '250px',
                touchAction: 'pan-y',
              }}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
            />

            {/* KI Einsatzplanung */}
            <button
              type="button"
              onClick={handlePlan}
              data-tutorial="planer-starten"
              className="absolute left-[20px] top-[461px] w-[362px] h-[56px] bg-[#e3f654] flex items-center justify-between px-[16px]"
            >
              <span className="text-black text-[16px] font-medium tracking-[0.5px] max-w-[300px] overflow-hidden text-ellipsis whitespace-nowrap">
                {isPlanning ? (planLog || t('planer.planningInProgress')) : t('planer.planButton')}
              </span>
              <KiSparkleIcon isAnimating={isPlanning} className="w-[29px] h-[29px]" />
            </button>

            {/* Strategie-Umschalter */}
            <div data-tutorial="planer-strategie" className="absolute left-[20px] top-[528px] w-[362px] flex justify-between">
              {STRATEGIES.map((entry) => {
                const isActive = entry.key === strategyKey;
                return (
                  <button
                    key={entry.key}
                    type="button"
                    onClick={() => handleStrategy(entry.key)}
                    data-tutorial={`planer-strategie-${entry.key}`}
                    className="h-[40px] border-2 border-[#e3f654] flex items-center justify-center text-[16px] font-medium tracking-[0.5px]"
                    style={{
                      width: `${(362 - 12 * (STRATEGIES.length - 1)) / STRATEGIES.length}px`,
                      ...(isActive ? { background: TRISAR_LIME, color: '#000' } : { color: TRISAR_LIME }),
                    }}
                  >
                    {t(entry.labelKey)}
                  </button>
                );
              })}
            </div>

            {applyError ? (
              <div className="absolute left-[20px] top-[572px] w-[362px] text-[12px] font-medium tracking-[0.5px]" style={{ color: TRISAR_RED }}>
                {applyError}
              </div>
            ) : planSource && !isPlanning ? (
              <div className="absolute left-[20px] top-[572px] w-[362px] text-[11px] font-medium tracking-[0.4px] text-white/60">
                {solverLineSegments.join(' · ')}
              </div>
            ) : null}

            {/* Schichtvorschläge */}
            {suggestions.length === 0 && !isPlanning ? (
              <div className="absolute left-[20px] w-[362px] text-center text-[16px] font-medium tracking-[0.5px] opacity-60" style={{ top: `${CARDS_TOP + 40}px`, color: TRISAR_LIME }}>
                {daySuggestions.length === 0
                  ? t('planer.emptyNotPlanned')
                  : t('planer.emptyAllHandled')}
              </div>
            ) : null}
            {/* Rahmen um alle Vorschlaege fuer die Tutorial-Hervorhebung (klickt nichts ab) */}
            {suggestions.length > 0 ? (
              <div
                data-tutorial="planer-vorschlaege"
                className="absolute left-[20px] w-[362px] pointer-events-none"
                style={{ top: `${CARDS_TOP}px`, height: `${suggestions.length * CARD_BLOCK_HEIGHT - 32}px` }}
              />
            ) : null}
            {suggestions.map((entry, position) => {
              const top = CARDS_TOP + position * CARD_BLOCK_HEIGHT;
              const istAkzeptiert = acceptedIds.has(entry.id);
              return (
                <div
                  key={entry.id}
                  className="absolute left-0 w-[402px] transition-opacity duration-300"
                  style={{ top: `${top}px`, opacity: isPlanning ? 0.3 : 1, pointerEvents: isPlanning ? 'none' : 'auto' }}
                >
                  <div
                    className="absolute left-[20px] top-0 w-[362px] h-[144px] bg-[#fefffe] overflow-hidden cursor-pointer"
                    data-tutorial={`planer-vorschlag-${position}`}
                    role="button"
                    tabIndex={0}
                    aria-label={t('sim.openAria', { name: entry.name })}
                    onClick={() => setSimEntry({ ...entry, position: position + 1, rideDurationMinutes: settingsRef.current?.rideDurationMinutes })}
                    onKeyDown={(e) => { if (e.key === 'Enter') setSimEntry({ ...entry, position: position + 1, rideDurationMinutes: settingsRef.current?.rideDurationMinutes }); }}
                  >
                    <p className="absolute left-[18px] top-[14px] max-w-[250px] overflow-hidden text-ellipsis whitespace-nowrap text-[#1c1c1d] text-[30px] font-bold tracking-[-0.5px]">
                      {`#${position + 1} ${entry.name}`}
                    </p>
                    <div className="absolute left-[18px] top-[56px] w-[251px] text-[12px] font-medium tracking-[0.5px] leading-[16px] text-[rgba(29,28,29,0.8)]">
                      {entry.stops.length ? (
                        entry.stops.map((stop) => (
                          <p key={stop} className="overflow-hidden text-ellipsis whitespace-nowrap">{stop}</p>
                        ))
                      ) : (
                        <p>{t('planer.standbyFallback')}</p>
                      )}
                    </div>
                    <div className="absolute right-[18px] top-[32px] text-right text-[15px] font-bold leading-[20px] text-[#1d1c1d]">
                      <p>{entry.start}</p>
                      <p>-{entry.end}</p>
                      <p style={{ color: TRISAR_GREEN }}>{`${entry.hours}h`}</p>
                    </div>
                    {entry.vehicleLabel ? (
                      <div className="absolute left-[18px] right-[18px] bottom-[6px] flex items-center justify-between text-[11px] font-medium tracking-[0.3px] leading-[14px] text-[rgba(29,28,29,0.65)]">
                        <span className="max-w-[240px] overflow-hidden text-ellipsis whitespace-nowrap">
                          {entry.vehicleIsEv ? 'EV · ' : ''}{entry.vehicleLabel}
                        </span>
                        <span className="whitespace-nowrap">
                          {entry.shiftKm != null ? `${entry.shiftKm} km` : ''}
                          {entry.chargeStopCount > 0 ? ` · ${t('planer.chargeStops', { n: entry.chargeStopCount })}` : ''}
                        </span>
                      </div>
                    ) : null}
                  </div>
                  {/* Übernommene Vorschläge zeigen statt der Buttons einen
                      Status — die Planung bleibt so sichtbar. */}
                  {istAkzeptiert ? (
                    <>
                      {/* Kleines X links: Übernahme wieder zurücknehmen. */}
                      <button
                        type="button"
                        onClick={() => handleUndoAccept(entry)}
                        data-tutorial={`planer-vorschlag-${position}-zuruecknehmen`}
                        aria-label={t('planer.undoAccept', { name: entry.name })}
                        className="absolute w-[51px] h-[51px] border-2 border-[#ff6f63] flex items-center justify-center"
                        style={{ left: '20px', top: '149px' }}
                      >
                        <svg viewBox="0 0 24 24" className="w-[20px] h-[20px]" fill="none" stroke="#ff6f63" strokeWidth="3" strokeLinecap="round">
                          <path d="M6 6l12 12M18 6L6 18" />
                        </svg>
                      </button>
                      <div
                        className="absolute w-[303px] h-[51px] bg-[#e3f754] flex items-center justify-center gap-[8px]"
                        style={{ left: '79px', top: '149px' }}
                      >
                        <svg viewBox="0 0 24 24" className="w-[20px] h-[20px]" fill="none" stroke="#101010" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M5 13l4 4L19 7" />
                        </svg>
                        <span className="text-black text-[20px] font-bold tracking-[-0.5px] leading-none" style={{ fontFamily: 'Space Grotesk' }}>
                          {t('planer.accepted')}
                        </span>
                      </div>
                    </>
                  ) : (
                  <>
                  <button
                    type="button"
                    onClick={() => dismiss(entry.id)}
                    data-tutorial={`planer-vorschlag-${position}-ablehnen`}
                    className="absolute w-[178px] h-[51px] border-2 border-[#ff6f63] flex items-center justify-center"
                    style={{ left: '20px', top: '149px' }}
                  >
                    <span className="text-[#ff6f63] text-[24px] font-bold tracking-[-0.5px] leading-none" style={{ fontFamily: 'Space Grotesk' }}>
                      {t('planer.refuse')}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleAccept(entry)}
                    data-tutorial={`planer-vorschlag-${position}-annehmen`}
                    className="absolute w-[178px] h-[51px] bg-[#e3f754] flex items-center justify-center"
                    style={{ left: '204px', top: '149px' }}
                  >
                    <span className="text-black text-[24px] font-bold tracking-[-0.5px] leading-none" style={{ fontFamily: 'Space Grotesk' }}>
                      {t('planer.accept')}
                    </span>
                  </button>
                  </>
                  )}
                </div>
              );
            })}

            </div>
            </div>
          </div>
        </div>
      </div>

      {ablauf === 'uebersicht' && einsatz?.tage?.length ? (
        <EinsatzplanungUebersicht
          key={`uebersicht-${uebersichtIndex}`}
          tage={einsatz.tage}
          vorschlaegeJeTag={Object.fromEntries(einsatz.tage.map((iso) => [
            iso,
            (plannedByDay[iso]?.suggestions || []).filter((entry) => !dismissedIds.has(entry.id)),
          ]))}
          startIndex={uebersichtIndex}
          onZurueck={onClose}
          onNeuePlanung={() => setAblauf('kalender')}
          onTagOeffnen={einsatzTagOeffnen}
        />
      ) : null}

      {ablauf === 'kalender' ? (
        <EinsatzplanungKalender
          heuteIso={todayIso}
          tageMitFahrten={tageMitFahrten}
          anfang={kalenderAuswahl}
          onZurueck={() => {
            if (einsatz?.tage?.length) setAblauf('uebersicht');
            else onClose?.();
          }}
          onEinstellungen={() => setShowSettings(true)}
          onWeiter={zeitraumPlanen}
        />
      ) : null}

      {ablauf === 'bedarf' && planTage.length ? (
        <EinsatzplanungBedarf
          tage={planTage}
          heuteIso={todayIso}
          supplyAll={supplyAll}
          bookedAll={bookedAll}
          demandBasis={demandAll}
          anpassungen={bedarfAnpassung}
          onAnpassen={bedarfAnpassen}
          onZuruecksetzen={() => setBedarfAnpassung({})}
          onZurueck={() => setAblauf('kalender')}
          onWeiter={bedarfWeiter}
          onEreignisse={setEreignisseTag}
        />
      ) : null}

      {ablauf === 'tag' && planTage.length ? (
        <EinsatzplanungTag
          tage={planTage}
          index={Math.min(planTagIndex, planTage.length - 1)}
          heuteIso={todayIso}
          eintrag={plannedByDay[planTage[Math.min(planTagIndex, planTage.length - 1)]] || null}
          strategien={STRATEGIES}
          strategieKey={plannedByDay[planTage[Math.min(planTagIndex, planTage.length - 1)]]?.strategyKey || strategyKey}
          laeuft={isPlanning && (!planungTag || planungTag === planTage[Math.min(planTagIndex, planTage.length - 1)] || !plannedByDay[planTage[Math.min(planTagIndex, planTage.length - 1)]])}
          planLog={planLog}
          abgelehnt={dismissedIds}
          uebernommen={acceptedIds}
          supplyAll={supplyAll}
          bookedAll={bookedAll}
          demandAll={demandAngepasst}
          fehler={applyError}
          onZurueck={() => {
            if (tagAusUebersicht) {
              setUebersichtIndex(Math.min(planTagIndex, planTage.length - 1));
              setAblauf('uebersicht');
            } else {
              setAblauf('bedarf');
            }
          }}
          onIndex={tagWechseln}
          onStrategie={tagesStrategie}
          onAnnehmen={handleAccept}
          onAblehnen={dismiss}
          onRueckgaengig={handleUndoAccept}
          onTagAnnehmen={tagAnnehmen}
          onEreignisse={setEreignisseTag}
          onPuffer={(tag, option, titel) => setPufferSeite({ tag, option, titel })}
          tagesStatus={tagesStatus}
          onOeffnen={(entry, position) => setSimEntry({ ...entry, position: position + 1, rideDurationMinutes: settingsRef.current?.rideDurationMinutes })}
        />
      ) : null}

      {ablauf === 'tag' && tagesKarte && planTage.length ? (
        <EinsatzTagKarte
          key={planTage[Math.min(planTagIndex, planTage.length - 1)]}
          tagIso={planTage[Math.min(planTagIndex, planTage.length - 1)]}
          vorschlaege={(plannedByDay[planTage[Math.min(planTagIndex, planTage.length - 1)]]?.suggestions || [])
            .filter((entry) => !dismissedIds.has(entry.id))}
          drivers={drivers}
          kameraSignal={tagesKarteSignal}
          onZurueck={() => setTagesKarte(false)}
        />
      ) : null}

      {DEMO_MODE && ereignisseTag && (ablauf === 'bedarf' || ablauf === 'tag') ? (
        <EreignisseView tagIso={ereignisseTag} onZurueck={() => setEreignisseTag(null)} />
      ) : null}

      {neuplanung ? (
        <NeuplanungView
          tagIso={neuplanung.iso}
          stoerung={neuplanung.tag?.stoerung || null}
          bisher={neuplanung.tag?.bisheriger_planer?.passend === false ? null : neuplanung.tag?.bisheriger_planer}
          status={neuplanung.status}
          fehler={neuplanung.fehler}
          laeuft={neuplanung.laeuft}
          onUebernehmen={neuplanungUebernehmen}
          onAblehnen={() => {
            neuplanungStatusSetzen(neuplanung.iso, 'abgelehnt');
            setNeuplanung((n) => ({ ...n, status: 'abgelehnt' }));
          }}
          onZurueck={() => setNeuplanung(null)}
        />
      ) : null}

      {DEMO_MODE && pufferSeite && ablauf === 'tag' ? (
        <PufferView
          tagIso={pufferSeite.tag}
          option={pufferSeite.option}
          optionTitel={pufferSeite.titel}
          onZurueck={() => setPufferSeite(null)}
        />
      ) : null}

      {simEntry ? (
        <FahrtSimulationView entry={simEntry} onClose={() => setSimEntry(null)} />
      ) : null}

      {showSettings ? (
        <KiPlanerSettingsView
          driverCount={totalDriverCount || (Array.isArray(drivers) ? drivers.length : 0)}
          settings={plannerSettings}
          onChangeSettings={onChangePlannerSettings}
          onClose={() => setShowSettings(false)}
        />
      ) : null}

      {/* Navigationsleiste bzw. Fusszeile fix am unteren Rand, wie auf den uebrigen Seiten */}
      {(navi && ablauf === 'tag'
        ? cloneElement(navi, {
          // In der Tagesplanung zeigt das Kartensymbol den geplanten Tag.
          onNavigateToMap: () => {
            if (tagesKarte) setTagesKarteSignal((n) => n + 1);
            else setTagesKarte(true);
          },
          activeTab: tagesKarte ? 'map' : navi.props.activeTab,
        })
        : navi) || (
        <div className="fixed bottom-0 left-0 right-0 z-[250] flex justify-center">
          <div className="w-[min(402px,100vw)]">
            <TrisarFooter className="relative h-10 bg-black" />
          </div>
        </div>
      )}
    </div>
  );
}
