import React, { useEffect, useState, useRef } from 'react';
import { anfahrtAbFahrer } from '../../../shared/anfahrtKuerzen';
import { useRoutenStandort } from '../../../shared/routenStandort';
import { kurzAdresse } from '../../../shared/adresseKurz';
import TrisarFooter from '../../../components/ui/TrisarFooter';
import { useI18n } from '../../../i18n';
import { useKollegenMarker, useKollegenStandorte } from '../kollegenStandorte';
import { useBlattZiehen } from './blattZiehen';
import CancelRideSheet from './CancelRideSheet';
import Abholschild from './Abholschild';
import FahrtBeenden from './FahrtBeenden';
import NotizSend from './NotizSend';
import {
  MAP_FLIGHT_AIRCRAFT_URL,
  MAP_START_FLAG_URL,
  MAP_START_PICKUP_URL,
  MAP_FAHRER_STANDORT_URL,
  MAP_PERSON_PIN_URL,
  MAP_FLAG_PIN_URL,
  RIDE_ADDRESS_URL,
  RIDE_AIRPORT_START_URL,
  RIDE_AIRPORT_URL,
  RIDE_HOTEL_URL,
} from '../../../shared/ui/icons';
import { karteBereitstellen } from '../../../shared/karte/maplibreKarte';
import { gleicherOrt } from '../../../shared/utils/vorherigeFahrt';
import { useDemoAnflug } from '../../../demo/flugAnflug';
import { DEMO_MODE } from '../../../datenquelle';
import { getRouteNavigationUrl } from '../../../shared/utils/navigation';
import { ortIconFuer } from '../../../shared/orte';
const envOrDefault = (value, fallback) => {
  if (!value) return fallback;
  if (typeof value === 'string' && value.trim().toLowerCase().startsWith('your_')) return fallback;
  return value;
};
const envFlagEnabled = (value, fallback = false) => {
  const raw = String(value ?? '').trim().toLowerCase();
  if (!raw) return fallback;
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
};
const SHOW_DRIVER_DEBUG_OVERLAY = envFlagEnabled(import.meta.env.VITE_SHOW_DRIVER_DEBUG_OVERLAY, false);
const MAP_DEFAULT_CENTER = { lat: 48.1215, lng: 11.6644 };

const formatDuration = (mins, t) => {
  if (!mins || mins <= 0) return t('kolonneF.durationMin', { m: 0 });
  if (mins < 60) return t('kolonneF.durationMin', { m: mins });
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return t('kolonneF.durationHours', { h, m: String(m).padStart(2, '0') });
};

const addMinutesToTime = (timeStr, minsToAdd) => {
  if (!timeStr || !/^\d{2}:\d{2}$/.test(timeStr)) return null;
  const [hours, minutes] = timeStr.split(':').map(Number);
  const date = new Date();
  date.setHours(hours);
  date.setMinutes(minutes + Number(minsToAdd || 0));
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
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

const getDisplayLocationName = (location, fallback = 'Unbekannt') => {
  if (!location || typeof location !== 'object') return fallback;
  const shortFormatted = getShortFormattedAddress(location);
  if (shortFormatted) return shortFormatted;

  if (typeof location.name === 'string' && location.name.trim()) return kurzAdresse(location.name) || location.name.trim();

  if (typeof location.address === 'string' && location.address.trim()) {
    return kurzAdresse(location.address) || location.address.trim();
  }

  return fallback;
};

const getLocationTypeLabel = (location, t) => {
  const text = `${location?.name || ''} ${location?.address || ''}`.toLowerCase();
  const airportPattern = /\b(flughafen|airport|terminal|muc|fra|ber|ham|dus|str|cgn)\b/;
  const hotelPattern = /\b(hotel|resort|hostel|inn|motel|guesthouse|suite|aparthotel|residence)\b/;
  if (airportPattern.test(text)) return t('kolonneF.typeAirport');
  if (hotelPattern.test(text)) return t('kolonneF.typeHotel');
  return t('kolonneF.typeAddress');
};

const toUniqueNameList = (values) => {
  const cleaned = (Array.isArray(values) ? values : [])
    .map((value) => `${value || ''}`.trim())
    .filter(Boolean);
  return Array.from(new Set(cleaned));
};

const getMarkerTypes = (badges) => {
  const normalized = new Set((Array.isArray(badges) ? badges : []).map((badge) => `${badge || ''}`.toLowerCase()));
  const hasOneOf = (keys) => keys.some((key) => normalized.has(key));
  const markerTypes = [];

  if (hasOneOf(['accessibility', 'rollstuhl', 'wheelchair', 'needs_accessibility'])) markerTypes.push('accessibility');
  if (hasOneOf(['vip', 'is_vip'])) markerTypes.push('vip');
  if (hasOneOf(['child_seat', 'child_seat2', 'child', 'kinder', 'needs_child_seat', 'needs_second_child_seat'])) markerTypes.push('child');
  if (hasOneOf(['luggage', 'gepaeck', 'gepäck', 'needs_luggage', 'baggage'])) markerTypes.push('luggage');

  return markerTypes;
};

const isRideStartedStatus = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  return ['at_pickup', 'beim_pickup', 'beim pickup', 'in_progress', 'started', 'unterwegs', 'active', 'ongoing', 'on_trip', 'done', 'completed', 'arrived'].includes(normalized);
};

const formatLastLocationPushLabel = (value, t, locale) => {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return t('kolonneF.pushNone');
  return t('kolonneF.pushAt', {
    time: date.toLocaleTimeString(locale, {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }),
  });
};

const formatJobStatusLabel = (value, t) => {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return t('kolonneF.statusNone');
  if (['pending', 'new', 'offen', 'requested', 'offered', 'assigned', 'zugewiesen'].includes(normalized)) return t('kolonneF.statusOpen');
  if (['at_pickup', 'beim_pickup', 'beim pickup'].includes(normalized)) return t('kolonneF.statusAtPickup');
  if (['in_progress', 'unterwegs', 'started', 'on_trip', 'ongoing', 'active'].includes(normalized)) return t('kolonneF.statusWithGuest');
  if (['done', 'completed', 'arrived', 'beendet'].includes(normalized)) return t('kolonneF.statusCompleted');
  if (['cancelled', 'canceled', 'refused', 'stoniert', 'storniert'].includes(normalized)) return t('kolonneF.statusCancelled');
  return t('kolonneF.statusOther', { value: String(value || '').trim() });
};

const formatLocationSourceLabel = (value, t) => {
  const source = String(value || '').trim();
  if (!source) return t('kolonneF.sourceUnknown');
  return t('kolonneF.source', { source });
};

const formatFlightTrackingLabel = (value, t, locale) => {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return t('kolonneF.flightNoSignal');
  return t('kolonneF.flightPushAt', {
    time: date.toLocaleTimeString(locale, {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }),
  });
};

const formatOpenSkyEtaLabel = (etaIsoValue, etaMinutesValue, t, locale) => {
  const etaDate = etaIsoValue ? new Date(etaIsoValue) : null;
  if (!etaDate || Number.isNaN(etaDate.getTime())) return t('kolonneF.openSkyEtaNone');
  const etaTime = etaDate.toLocaleTimeString(locale, {
    hour: '2-digit',
    minute: '2-digit',
  });
  const mins = Number(etaMinutesValue);
  if (Number.isFinite(mins) && mins > 0) {
    return t('kolonneF.openSkyEtaWithMins', { time: etaTime, mins: Math.round(mins) });
  }
  return t('kolonneF.openSkyEta', { time: etaTime });
};

const hasRenderableLatLng = (lat, lng) => {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return false;
  if (Math.abs(lat) < 0.0001 && Math.abs(lng) < 0.0001) return false;
  return true;
};

const toFiniteCoord = (coord) => {
  const lat = Number(coord?.lat);
  const lng = Number(coord?.lng);
  if (!hasRenderableLatLng(lat, lng)) return null;
  return { lat, lng };
};

const decodeGooglePolyline = (encoded) => {
  if (!encoded || typeof encoded !== 'string') return [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  const points = [];
  while (index < encoded.length) {
    let b = 0;
    let shift = 0;
    let result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dLat = (result & 1) ? ~(result >> 1) : (result >> 1);
    lat += dLat;
    shift = 0;
    result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dLng = (result & 1) ? ~(result >> 1) : (result >> 1);
    lng += dLng;
    points.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }
  return points;
};

const _getPickupCoordFromJob = (job) => {
  const routePolyline = String(job?.extRoutePolyline || '').trim();
  const approachPolyline = String(job?.extDriverToPickupPolyline || '').trim();
  const routePoints = decodeGooglePolyline(routePolyline);
  const approachPoints = decodeGooglePolyline(approachPolyline);
  const pickupFromRoute = routePoints.length > 0 ? routePoints[0] : null;
  const pickupFromApproach = approachPoints.length > 0 ? approachPoints[approachPoints.length - 1] : null;
  return toFiniteCoord(pickupFromRoute) || toFiniteCoord(pickupFromApproach);
};

const _getDistanceMeters = (a, b) => {
  const from = toFiniteCoord(a);
  const to = toFiniteCoord(b);
  if (!from || !to) return null;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const earthRadiusM = 6371000;
  const dLat = toRad(to.lat - from.lat);
  const dLng = toRad(to.lng - from.lng);
  const lat1 = toRad(from.lat);
  const lat2 = toRad(to.lat);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return earthRadiusM * (2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h)));
};

const getEffectiveFlightEtaMinutes = (job) => {
  const etaMinsRaw = Number(job?.flightLiveSecondaryEtaMins);
  if (Number.isFinite(etaMinsRaw)) return etaMinsRaw;
  const etaIsoRaw = `${job?.flightLiveSecondaryEtaIso || job?.flightEstimatedArrivalIso || job?.flightScheduledArrivalIso || ''}`.trim();
  if (!etaIsoRaw) return null;
  const etaDate = new Date(etaIsoRaw);
  if (Number.isNaN(etaDate.getTime())) return null;
  return (etaDate.getTime() - Date.now()) / 60000;
};

const toJobDateTimeMs = (job) => {
  const dateRaw = String(job?.date || '').trim();
  const timeRaw = String(job?.time || '').trim();
  const timeMatch = timeRaw.match(/^(\d{1,2}):(\d{2})$/);
  if (!dateRaw || !timeMatch) return null;
  const hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);

  let year = null;
  let month = null;
  let day = null;

  const isoDateMatch = dateRaw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (isoDateMatch) {
    year = Number(isoDateMatch[1]);
    month = Number(isoDateMatch[2]);
    day = Number(isoDateMatch[3]);
  } else {
    const deDateMatch = dateRaw.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
    if (!deDateMatch) return null;
    day = Number(deDateMatch[1]);
    month = Number(deDateMatch[2]);
    year = Number(deDateMatch[3]);
  }

  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
  const dt = new Date(year, month - 1, day, hour, minute, 0, 0);
  const ts = dt.getTime();
  return Number.isFinite(ts) ? ts : null;
};

const TRAIN_ICON_URL = '/icon/_Icon_Schwarz/train.svg';
const TRAIN_ICON_BASE_ORIENTATION_DEG = 90; // train.svg points to the right (east) by default
const TRAIN_VIRTUAL_ROUTE_OFFSET_LNG = 0.03;
const TRAIN_VIRTUAL_LOOKAHEAD_MIN = 90;

const interpolateCoord = (from, to, t) => ({
  lat: from.lat + ((to.lat - from.lat) * t),
  lng: from.lng + ((to.lng - from.lng) * t),
});

const getBearingDeg = (from, to) => {
  const a = toFiniteCoord(from);
  const b = toFiniteCoord(to);
  if (!a || !b) return 90;
  const y = Math.sin((b.lng - a.lng) * (Math.PI / 180)) * Math.cos(b.lat * (Math.PI / 180));
  const x = Math.cos(a.lat * (Math.PI / 180)) * Math.sin(b.lat * (Math.PI / 180))
    - Math.sin(a.lat * (Math.PI / 180)) * Math.cos(b.lat * (Math.PI / 180)) * Math.cos((b.lng - a.lng) * (Math.PI / 180));
  const brng = Math.atan2(y, x) * (180 / Math.PI);
  return (brng + 360) % 360;
};

const _buildVirtualTrainTracking = (job, targetCoord) => {
  const target = toFiniteCoord(targetCoord);
  if (!target) return null;
  const isTrainRide = Boolean(String(job?.trainNumber || '').trim())
    || String(job?.flightLiveMode || '').trim().toLowerCase() === 'train';
  if (!isTrainRide) return null;

  const routeStops = Array.isArray(job?.flightLiveRouteStops) ? job.flightLiveRouteStops : [];
  const stopCount = Math.max(2, routeStops.length || 0);
  const lookaheadMinutes = Math.max(TRAIN_VIRTUAL_LOOKAHEAD_MIN, Math.min(240, stopCount * 10));
  const start = { lat: target.lat, lng: target.lng - TRAIN_VIRTUAL_ROUTE_OFFSET_LNG };
  const etaMins = getEffectiveFlightEtaMinutes(job);
  const departureMs = toJobDateTimeMs(job);
  const etaIsoRaw = `${job?.flightLiveSecondaryEtaIso || job?.flightEstimatedArrivalIso || job?.flightScheduledArrivalIso || ''}`.trim();
  const etaMs = etaIsoRaw ? new Date(etaIsoRaw).getTime() : NaN;
  let clampedProgress = 0.45;

  if (Number.isFinite(departureMs) && Number.isFinite(etaMs) && etaMs > departureMs + (5 * 60 * 1000)) {
    const nowMs = Date.now();
    if (nowMs <= departureMs) {
      clampedProgress = 0.02;
    } else if (nowMs >= etaMs) {
      clampedProgress = 0.97;
    } else {
      const timelineProgress = (nowMs - departureMs) / (etaMs - departureMs);
      clampedProgress = Math.min(0.97, Math.max(0.02, timelineProgress));
    }
  } else if (Number.isFinite(etaMins)) {
    clampedProgress = Math.min(0.97, Math.max(0.02, 1 - (etaMins / lookaheadMinutes)));
  }

  const current = interpolateCoord(start, target, clampedProgress);
  const stopPoints = Array.from({ length: stopCount }, (_, index) => {
    const ratio = index / Math.max(1, stopCount - 1);
    const point = interpolateCoord(start, target, ratio);
    return { lat: point.lat, lng: point.lng };
  });
  const routeBearing = getBearingDeg(start, target);
  const headingDeg = routeBearing - TRAIN_ICON_BASE_ORIENTATION_DEG;
  return {
    coords: { ...current, headingDeg },
    trail: stopPoints.length > 1 ? stopPoints : [start, current, target],
    stopPoints,
  };
};

const getPlanOrFlightPhaseLabel = (job, plannedTime) => {
  const fallbackLabel = `Plan: ${plannedTime || '--:--'}`;
  const isAirportRide = `${job?.tripType || ''}`.trim().toLowerCase() === 'airport';
  if (!isAirportRide) return { text: fallbackLabel, isStatus: false };

  const statusCode = `${job?.flightStatusCode || ''}`.trim().toUpperCase();
  const statusTranslations = {
    CD: 'cancelled',
    DP: 'departed',
    LD: 'landed',
    RT: 'rerouted',
    NA: 'no status',
  };
  if (statusCode) {
    const translated = statusTranslations[statusCode];
    return { text: translated || statusCode, isStatus: true };
  }
  return { text: fallbackLabel, isStatus: false };
};

const FLIGHT_ICON_SIZE = 46;

const normalizeHeadingDeg = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return ((parsed % 360) + 360) % 360;
};

const createFlightOverlay = (map, initialCoords, initialHeadingDeg = 0) => {
  if (!map || !window.trisarKarte) return null;
  const initialLat = Number(initialCoords?.lat);
  const initialLng = Number(initialCoords?.lng);
  if (!Number.isFinite(initialLat) || !Number.isFinite(initialLng)) return null;

  let latLng = new window.trisarKarte.LatLng(initialLat, initialLng);
  let headingDeg = normalizeHeadingDeg(initialHeadingDeg);
  let containerEl = null;
  const overlay = new window.trisarKarte.OverlayView();

  const updateTransform = () => {
    if (!containerEl) return;
    containerEl.style.transform = `translate(-50%, -50%) rotate(${headingDeg}deg)`;
  };

  overlay.onAdd = () => {
    containerEl = document.createElement('div');
    containerEl.style.position = 'absolute';
    containerEl.style.width = `${FLIGHT_ICON_SIZE}px`;
    containerEl.style.height = `${FLIGHT_ICON_SIZE}px`;
    containerEl.style.pointerEvents = 'none';
    containerEl.style.zIndex = '330';
    // Demo-Tutorial: der Schritt "Flug live" hebt das Flugzeug hervor.
    containerEl.setAttribute('data-tutorial', 'flugzeug');
    updateTransform();

    const img = document.createElement('img');
    img.src = MAP_FLIGHT_AIRCRAFT_URL;
    img.alt = '';
    img.style.width = '100%';
    img.style.height = '100%';
    img.style.objectFit = 'contain';
    img.style.display = 'block';
    img.style.filter = 'drop-shadow(0 1px 3px rgba(0, 0, 0, 0.45))';

    containerEl.appendChild(img);
    const panes = overlay.getPanes();
    panes?.overlayLayer?.appendChild(containerEl);
  };

  overlay.draw = () => {
    const projection = overlay.getProjection();
    if (!projection || !containerEl) return;
    const pixel = projection.fromLatLngToDivPixel(latLng);
    if (!pixel) return;
    containerEl.style.left = `${pixel.x}px`;
    containerEl.style.top = `${pixel.y}px`;
    updateTransform();
  };

  overlay.onRemove = () => {
    if (containerEl?.parentNode) containerEl.parentNode.removeChild(containerEl);
    containerEl = null;
  };

  overlay.setMap(map);

  return {
    setPosition(nextCoords) {
      const next = toFiniteCoord(nextCoords);
      if (!next) return;
      latLng = new window.trisarKarte.LatLng(next.lat, next.lng);
      overlay.draw();
    },
    setHeading(nextHeadingDeg) {
      headingDeg = normalizeHeadingDeg(nextHeadingDeg);
      overlay.draw();
    },
    setMap(nextMap) {
      overlay.setMap(nextMap);
    },
  };
};

const _createTrainOverlay = (map, initialCoords, initialHeadingDeg = 0) => {
  if (!map || !window.trisarKarte) return null;
  const initialLat = Number(initialCoords?.lat);
  const initialLng = Number(initialCoords?.lng);
  if (!Number.isFinite(initialLat) || !Number.isFinite(initialLng)) return null;

  let latLng = new window.trisarKarte.LatLng(initialLat, initialLng);
  let headingDeg = normalizeHeadingDeg(initialHeadingDeg);
  let containerEl = null;
  const overlay = new window.trisarKarte.OverlayView();

  const updateTransform = () => {
    if (!containerEl) return;
    containerEl.style.transform = `translate(-50%, -50%) rotate(${headingDeg}deg)`;
  };

  overlay.onAdd = () => {
    containerEl = document.createElement('div');
    containerEl.style.position = 'absolute';
    containerEl.style.width = `${FLIGHT_ICON_SIZE}px`;
    containerEl.style.height = `${FLIGHT_ICON_SIZE}px`;
    containerEl.style.pointerEvents = 'none';
    containerEl.style.zIndex = '330';
    updateTransform();

    const img = document.createElement('img');
    img.src = TRAIN_ICON_URL;
    img.alt = '';
    img.style.width = '100%';
    img.style.height = '100%';
    img.style.objectFit = 'contain';
    img.style.display = 'block';
    img.style.filter = 'drop-shadow(0 1px 3px rgba(0, 0, 0, 0.45))';
    containerEl.appendChild(img);
    const panes = overlay.getPanes();
    panes?.overlayLayer?.appendChild(containerEl);
  };

  overlay.draw = () => {
    const projection = overlay.getProjection();
    if (!projection || !containerEl) return;
    const pixel = projection.fromLatLngToDivPixel(latLng);
    if (!pixel) return;
    containerEl.style.left = `${pixel.x}px`;
    containerEl.style.top = `${pixel.y}px`;
    updateTransform();
  };

  overlay.onRemove = () => {
    if (containerEl?.parentNode) containerEl.parentNode.removeChild(containerEl);
    containerEl = null;
  };

  overlay.setMap(map);
  return {
    setPosition(nextCoords) {
      const next = toFiniteCoord(nextCoords);
      if (!next) return;
      latLng = new window.trisarKarte.LatLng(next.lat, next.lng);
      overlay.draw();
    },
    setHeading(nextHeadingDeg) {
      headingDeg = normalizeHeadingDeg(nextHeadingDeg);
      overlay.draw();
    },
    setMap(nextMap) {
      overlay.setMap(nextMap);
    },
  };
};

const normalizeFlightTrailPath = (trail) => {
  if (!Array.isArray(trail)) return [];
  const normalized = trail
    .map((point) => {
      return toFiniteCoord({
        lat: point?.lat ?? point?.latitude,
        lng: point?.lng ?? point?.longitude ?? point?.lon,
      });
    })
    .filter(Boolean);

  const deduped = [];
  for (const point of normalized) {
    const prev = deduped[deduped.length - 1];
    if (prev && Math.abs(prev.lat - point.lat) < 0.00001 && Math.abs(prev.lng - point.lng) < 0.00001) continue;
    deduped.push(point);
  }
  return deduped.slice(-90);
};

const MARKER_ICON_URLS = {
  vip: "/icon/_Icon_Lime/Stern_Trisar_Icon_01_Lime.svg",
  child: "/icon/_Icon_Lime/Kind_Trisar_Icons_01_Lime.svg",
  luggage: "/icon/_Icon_Lime/Gepäck_viel_Trisar_Icons_01_Lime.svg",
  accessibility: "/icon/_Icon_Lime/Rollstuhl_Trisar_Icons_01_Lime.svg",
};

const MarkerIcon = ({ type }) => {
  const src = MARKER_ICON_URLS[type] || MARKER_ICON_URLS.accessibility;
  return <img src={src} alt="" className="w-[58px] h-[58px] object-contain" />;
};

// Fahrernummer im blauen Standortpunkt (Figma 2557-12230): weiss, 20 px fett.
const fahrerNummerBeschriftung = (nummer) => {
  const text = nummer == null ? '' : String(nummer).trim();
  return text ? { text, color: '#FFFFFF', fontSize: '20px', fontWeight: '700' } : undefined;
};

const GoogleMapComponent = ({ origin, destination, driverCoords, fahrerNummer = '', flightCoords, flightTrail, onDurationUpdate, openToken, sheetHeight = 50, showApproachRoute = true, tripFromDriver = false, anfahrtStart = '', standortPunktZeigen = true, kollegen = [] }) => {
  // Anfahrt folgt dem Auto: Die gelbe Linie wird bei jedem Standort am gefahrenen Teil
  // abgeschnitten (kostet nichts). Nur wenn der Fahrer mehr als 200 m von der Route
  // abkommt, wird neu gerechnet, gedrosselt auf hoechstens alle 15 s.
  const anfahrtLinieRef = useRef(null);
  // Blaue Linie, wenn sie beim Fahrer beginnt (Gast an Bord): wird genauso gekuerzt.
  const fahrtLinieRef = useRef(null);
  const [abseitsPunkt, setAbseitsPunkt] = useState(null);
  const routenStandort = useRoutenStandort(abseitsPunkt?.lat, abseitsPunkt?.lng);
  const { t } = useI18n();
  const mapRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const routeBoundsRef = useRef(null);
  const driverMarkerRef = useRef(null);
  const flightMarkerRef = useRef(null);
  const flightTrailPolylineRef = useRef(null);
  const previousSheetHeightRef = useRef(sheetHeight);

  const getFitPadding = (sheetPercent = 50) => {
    const viewportHeight = window.innerHeight || 874;
    const normalizedSheet = Math.min(Math.max(Number(sheetPercent) || 50, 25), 85);
    const sheetPx = Math.round(viewportHeight * (normalizedSheet / 100));
    return {
      // Stehen Kollegen-Pins auf der Karte, ragt ihr Kopf ueber den Standort
      // hinaus — oben Platz fuer die Pin-Hoehe lassen, sonst wird er angeschnitten.
      top: 44 + ((kollegen || []).length ? 42 : 0),
      left: 28,
      right: 28,
      bottom: Math.max(170, sheetPx + 12),
    };
  };

  useEffect(() => {
    let cancelled = false;
    let initialized = false;
    const cleanupRefs = [];
    anfahrtLinieRef.current = null;
    fahrtLinieRef.current = null;

    const initMap = () => {
      if (cancelled || initialized) return;
      if (!window.trisarKarte || !mapRef.current) return;
      initialized = true;

      mapRef.current.innerHTML = '';
      const resolvedDriverCoords = toFiniteCoord(driverCoords);
      const baseResolvedFlightCoord = toFiniteCoord(flightCoords);
      const resolvedFlightCoords = baseResolvedFlightCoord
        ? {
            ...baseResolvedFlightCoord,
            headingDeg: Number(flightCoords?.headingDeg),
          }
        : null;
      const resolvedFlightTrailPath = normalizeFlightTrailPath(flightTrail);
      const map = new window.trisarKarte.Map(mapRef.current, {
        center: resolvedDriverCoords || MAP_DEFAULT_CENTER,
        zoom: 12,
        disableDefaultUI: true,
        styles: [
          { featureType: 'all', elementType: 'labels.text.fill', stylers: [{ color: '#334155' }] },
          { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#e2e8f0' }] },
          { featureType: 'landscape', elementType: 'geometry', stylers: [{ color: '#f8fafc' }] },
          { featureType: 'poi', elementType: 'labels', stylers: [{ visibility: 'off' }] },
        ],
      });
      mapInstanceRef.current = map;
      const trafficLayer = new window.trisarKarte.TrafficLayer();
      trafficLayer.setMap(map);

      const directionsService = new window.trisarKarte.DirectionsService();
      const combinedBounds = new window.trisarKarte.LatLngBounds();
      const personPinIcon = {
        url: MAP_PERSON_PIN_URL,
        scaledSize: new window.trisarKarte.Size(35, 41.1367),
        anchor: new window.trisarKarte.Point(17.5, 41.1367),
      };
      const flagIcon = {
        url: MAP_FLAG_PIN_URL,
        scaledSize: new window.trisarKarte.Size(35, 41.1367),
        anchor: new window.trisarKarte.Point(17.5, 41.1367),
      };
      // Gleiche Fahne wie beim Ziel, nur gruen gefuellt: hier startet die
      // Anfahrt, weil der Fahrer aus einer frueheren Fahrt kommt.
      const startFlaggenIcon = {
        url: MAP_START_FLAG_URL,
        scaledSize: new window.trisarKarte.Size(35, 41.1367),
        anchor: new window.trisarKarte.Point(17.5, 41.1367),
      };
      // Endet die vorherige Fahrt genau am Abholort, liegen Startfahne und
      // Abholort aufeinander: dann ein gemeinsamer gruener Pin mit Gast.
      const startAbholIcon = {
        url: MAP_START_PICKUP_URL,
        scaledSize: new window.trisarKarte.Size(35, 41.1367),
        anchor: new window.trisarKarte.Point(17.5, 41.1367),
      };
      let abholMarker = null;
      const dashedLineSymbol = {
        path: 'M 0,-1 0,1',
        strokeOpacity: 1,
        scale: 4,
        strokeColor: '#E3F654',
      };
      if (resolvedDriverCoords && standortPunktZeigen && !anfahrtStart) {
        const driverMarker = new window.trisarKarte.Marker({
          position: resolvedDriverCoords,
          map,
          icon: {
            url: MAP_FAHRER_STANDORT_URL,
            scaledSize: new window.trisarKarte.Size(35, 35),
            anchor: new window.trisarKarte.Point(17.5, 17.5),
            labelOrigin: new window.trisarKarte.Point(17.5, 17.5),
          },
          label: fahrerNummerBeschriftung(fahrerNummer),
          zIndex: 1000, // Auto-Standort immer ueber den Minuten-Schildern (deren Ebene liegt bei 400)
        });
        driverMarkerRef.current = driverMarker;
        cleanupRefs.push(driverMarker);
      }

      if (resolvedFlightCoords) {
        const flightOverlay = createFlightOverlay(
          map,
          { lat: resolvedFlightCoords.lat, lng: resolvedFlightCoords.lng },
          resolvedFlightCoords.headingDeg,
        );
        if (flightOverlay) {
          flightMarkerRef.current = flightOverlay;
          cleanupRefs.push(flightOverlay);
        }
        combinedBounds.extend({ lat: resolvedFlightCoords.lat, lng: resolvedFlightCoords.lng });
      }
      if (resolvedFlightTrailPath.length > 1) {
        const trailPolyline = new window.trisarKarte.Polyline({
          path: resolvedFlightTrailPath,
          geodesic: true,
          strokeColor: '#E3F654',
          strokeOpacity: 0.95,
          strokeWeight: 3,
          zIndex: 325,
          map,
        });
        flightTrailPolylineRef.current = trailPolyline;
        cleanupRefs.push(trailPolyline);
      }
      // Anfahrt (gelb) und Fahrt (blau) liegen an ihren Routenmitten — bei kurzer
      // Anfahrt oder sich ueberlagernden Wegen koennen die beiden Zeitblasen
      // uebereinander liegen. Danach werden sie senkrecht auseinandergeschoben,
      // damit beide lesbar bleiben.
      const dauerLabels = [];
      const LABEL_LUFT = 8;
      const entzerreDauerLabels = () => {
        const sichtbare = dauerLabels
          .filter((div) => div && div.isConnected && div.offsetWidth > 0)
          .map((div) => {
            div.dataset.dy = '0';
            div.style.transform = 'translate(-50%, -100%)';
            return {
              div,
              x: parseFloat(div.style.left) || 0,
              y: parseFloat(div.style.top) || 0,
              b: div.offsetWidth,
              h: div.offsetHeight,
            };
          })
          .sort((a, b) => a.y - b.y);

        sichtbare.forEach((label, i) => {
          let dy = 0;
          for (let j = 0; j < i; j += 1) {
            const oben = sichtbare[j];
            const obenDy = Number(oben.div.dataset.dy) || 0;
            // Beide Blasen sitzen mit ihrer Unterkante auf dem Ankerpunkt.
            const obenUnten = oben.y - obenDy;
            const obenOben = obenUnten - oben.h;
            const meinUnten = label.y - dy;
            const meinOben = meinUnten - label.h;
            const ueberlapptWaagerecht = Math.abs(label.x - oben.x) < (label.b + oben.b) / 2 + LABEL_LUFT;
            const ueberlapptSenkrecht = meinOben < obenUnten + LABEL_LUFT && meinUnten > obenOben - LABEL_LUFT;
            if (ueberlapptWaagerecht && ueberlapptSenkrecht) {
              dy = label.y - (obenOben - LABEL_LUFT);
            }
          }
          if (dy !== 0) {
            label.div.dataset.dy = String(dy);
            label.div.style.transform = `translate(-50%, calc(-100% - ${dy}px))`;
          }
        });
      };

      const openDurationLabel = (position, text, backgroundColor, textColor = '#FFFFFF') => {
        if (!position || !text) return;
        const latLng = position instanceof window.trisarKarte.LatLng
          ? position
          : new window.trisarKarte.LatLng(Number(position?.lat), Number(position?.lng));
        if (!Number.isFinite(latLng.lat()) || !Number.isFinite(latLng.lng())) return;

        const labelOverlay = new window.trisarKarte.OverlayView();
        labelOverlay.onAdd = function onAdd() {
          const div = document.createElement('div');
          div.style.position = 'absolute';
          // Der senkrechte Versatz wird beim Entzerren gesetzt (siehe unten).
          div.dataset.dy = '0';
          div.style.transform = 'translate(-50%, -100%)';
          div.style.pointerEvents = 'none';
          div.style.background = backgroundColor;
          div.style.color = textColor;
          div.style.padding = '6px 12px';
          div.style.borderRadius = '9999px';
          div.style.fontFamily = 'Space Grotesk, sans-serif';
          div.style.fontWeight = '800';
          div.style.fontSize = '13px';
          div.style.whiteSpace = 'nowrap';
          div.style.boxShadow = '0 6px 18px rgba(0,0,0,0.35)';
          div.style.zIndex = '360';
          div.textContent = text;
          this._div = div;
          dauerLabels.push(div);
          const panes = this.getPanes();
          panes?.floatPane?.appendChild(div);
        };
        labelOverlay.draw = function draw() {
          const projection = this.getProjection();
          const div = this._div;
          if (!projection || !div) return;
          const pixel = projection.fromLatLngToDivPixel(latLng);
          if (!pixel) return;
          div.style.left = `${pixel.x}px`;
          div.style.top = `${pixel.y}px`;
          entzerreDauerLabels();
        };
        labelOverlay.onRemove = function onRemove() {
          const div = this._div;
          if (div?.parentNode) div.parentNode.removeChild(div);
          this._div = null;
        };
        labelOverlay.setMap(map);
        cleanupRefs.push(labelOverlay);
      };

      const calculateRoute = (from, to, color, isDriver = false, hideStartMarker = false) =>
        new Promise((resolve) => {
          directionsService.route(
            {
              origin: from,
              destination: to,
              travelMode: window.trisarKarte.TravelMode.DRIVING,
              drivingOptions: { departureTime: new Date(), trafficModel: 'bestguess' },
            },
            (result, status) => {
              if (status !== 'OK' || !result?.routes?.[0]) {
                console.error('[RouteMap] DirectionsService Fehler', { status, from, to, isDriver });
                resolve(false);
                return;
              }

              const route = result.routes[0].legs[0];
              const path = result.routes[0].overview_path || [];
              path.forEach((point) => combinedBounds.extend(point));

              if (isDriver) {
                const approachMins = Math.ceil((route.duration_in_traffic?.value || route.duration?.value || 0) / 60);

                if (anfahrtStart && gleicherOrt(route.start_location, route.end_location)) {
                  if (abholMarker) {
                    abholMarker.setIcon(startAbholIcon);
                  } else {
                    abholMarker = new window.trisarKarte.Marker({
                      position: route.end_location,
                      map,
                      icon: startAbholIcon,
                      zIndex: 305,
                    });
                    cleanupRefs.push(abholMarker);
                  }
                } else if (anfahrtStart) {
                  const startFahne = new window.trisarKarte.Marker({
                    position: route.start_location,
                    map,
                    icon: startFlaggenIcon,
                    zIndex: 305,
                  });
                  cleanupRefs.push(startFahne);
                }

                // Endet die vorherige Fahrt am Abholort, gibt es nichts zu
                // fahren: dann steht dort nur der gruene Pin, ohne Linie und ohne "0 min".
                if (approachMins > 0) {
                  const dashedLine = new window.trisarKarte.Polyline({
                    path,
                    geodesic: true,
                    strokeColor: '#E3F654',
                    strokeOpacity: 0,
                    strokeWeight: 5,
                    icons: [{ icon: dashedLineSymbol, offset: '0', repeat: '12px' }],
                    map,
                    zIndex: 301,
                  });
                  cleanupRefs.push(dashedLine);
                  anfahrtLinieRef.current = { linie: dashedLine, pfad: path.slice() };

                  openDurationLabel(
                    path[Math.floor(path.length / 2)] || from,
                    formatDuration(approachMins, t),
                    '#E3F654',
                    '#111111',
                  );
                }
              } else {
                const routeRenderer = new window.trisarKarte.DirectionsRenderer({
                  map,
                  suppressMarkers: true,
                  preserveViewport: true,
                  polylineOptions: { strokeColor: '#0059FF', strokeWeight: 6 },
                });
                routeRenderer.setDirections(result);
                cleanupRefs.push(routeRenderer);
                if (hideStartMarker && routeRenderer.linie) {
                  fahrtLinieRef.current = { linie: routeRenderer.linie, pfad: (result.routes[0].overview_path || []).slice() };
                }

                const mins = Math.ceil((route.duration_in_traffic?.value || route.duration?.value || 0) / 60);
                if (onDurationUpdate) onDurationUpdate(mins);

                const endMarker = new window.trisarKarte.Marker({
                  position: route.end_location,
                  map,
                  icon: flagIcon,
                  zIndex: 300,
                });
                cleanupRefs.push(endMarker);
                if (!hideStartMarker) {
                  const startMarker = new window.trisarKarte.Marker({
                    position: route.start_location,
                    map,
                    icon: personPinIcon,
                    zIndex: 300,
                  });
                  cleanupRefs.push(startMarker);
                  abholMarker = startMarker;
                }

                const labelText = formatDuration(mins, t);
                openDurationLabel(path[Math.floor(path.length / 2)] || route.start_location, labelText, color);
              }

              resolve(true);
            },
          );
        });

      const loadRoutes = async () => {
        const tripOrigin = (tripFromDriver && resolvedDriverCoords) ? resolvedDriverCoords : origin;
        if (!tripOrigin || !destination) return;
        await calculateRoute(tripOrigin, destination, '#0059FF', false, tripFromDriver);
        const anfahrtVon = anfahrtStart || resolvedDriverCoords;
        if (showApproachRoute && anfahrtVon) {
          await calculateRoute(anfahrtVon, origin, '#E3F654', true);
        }
        // Kollegen der Kolonne gleich mit in den Ausschnitt nehmen.
        (kollegenRef.current || []).forEach((k) => combinedBounds.extend({ lat: k.lat, lng: k.lng }));
        if (!combinedBounds.isEmpty()) {
          routeBoundsRef.current = combinedBounds;
          const padding = getFitPadding(sheetHeight);
          map.fitBounds(combinedBounds, padding);
          window.setTimeout(() => {
            if (cancelled) return;
            map.fitBounds(combinedBounds, padding);
          }, 180);
        }
      };

      loadRoutes();
    };



    // Die Kartenschicht steckt im Bundle, es wird nichts mehr nachgeladen.
    karteBereitstellen();
    initMap();

    return () => {
      cancelled = true;
      mapInstanceRef.current = null;
      routeBoundsRef.current = null;
      driverMarkerRef.current = null;
      flightMarkerRef.current = null;
      flightTrailPolylineRef.current = null;
      cleanupRefs.forEach((ref) => {
        if (typeof ref.setMap === 'function') ref.setMap(null);
        if (typeof ref.close === 'function') ref.close();
      });
    };
  }, [origin, destination, onDurationUpdate, openToken, showApproachRoute, tripFromDriver, anfahrtStart, standortPunktZeigen, routenStandort?.lat, routenStandort?.lng, t]);

  useEffect(() => {
    const lat = Number(driverCoords?.lat);
    const lng = Number(driverCoords?.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    // Gelbe Anfahrt oder blaue Fahrt ab Fahrer: die Linie, die gerade beim Auto beginnt.
    const eintrag = anfahrtLinieRef.current || fahrtLinieRef.current;
    if (!eintrag) return;
    const { abseits, pfad } = anfahrtAbFahrer(eintrag.pfad, { lat, lng });
    if (abseits) {
      setAbseitsPunkt({ lat, lng });
      return;
    }
    if (pfad && pfad.length >= 2) eintrag.linie.setPath(pfad);
  }, [driverCoords?.lat, driverCoords?.lng]);

  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !window.trisarKarte) return;
    // Beginnt die Anfahrt am Ziel einer frueheren Fahrt, steht dort die gruene
    // Startfahne — der blaue Standortpunkt entfaellt dann.
    const nextDriverCoord = (anfahrtStart || !standortPunktZeigen) ? null : toFiniteCoord(driverCoords);
    if (!nextDriverCoord) {
      if (driverMarkerRef.current && typeof driverMarkerRef.current.setMap === 'function') {
        driverMarkerRef.current.setMap(null);
      }
      driverMarkerRef.current = null;
      return;
    }
    if (!driverMarkerRef.current) {
      driverMarkerRef.current = new window.trisarKarte.Marker({
        position: nextDriverCoord,
        map,
        icon: {
          url: MAP_FAHRER_STANDORT_URL,
          scaledSize: new window.trisarKarte.Size(35, 35),
          anchor: new window.trisarKarte.Point(17.5, 17.5),
          labelOrigin: new window.trisarKarte.Point(17.5, 17.5),
        },
        label: fahrerNummerBeschriftung(fahrerNummer),
        zIndex: 1000, // Auto-Standort immer ueber den Minuten-Schildern (deren Ebene liegt bei 400)
      });
      return;
    }
    driverMarkerRef.current.setPosition(nextDriverCoord);
  }, [driverCoords?.lat, driverCoords?.lng, anfahrtStart, standortPunktZeigen]);

  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !window.trisarKarte) return;
    const nextFlightCoord = toFiniteCoord(flightCoords);
    if (!nextFlightCoord) {
      if (flightMarkerRef.current && typeof flightMarkerRef.current.setMap === 'function') {
        flightMarkerRef.current.setMap(null);
      }
      flightMarkerRef.current = null;
      return;
    }
    if (!flightMarkerRef.current) {
      flightMarkerRef.current = createFlightOverlay(
        map,
        nextFlightCoord,
        flightCoords?.headingDeg,
      );
      return;
    }
    flightMarkerRef.current.setPosition(nextFlightCoord);
    if (typeof flightMarkerRef.current.setHeading === 'function') {
      flightMarkerRef.current.setHeading(flightCoords?.headingDeg);
    }
  }, [flightCoords?.lat, flightCoords?.lng, flightCoords?.headingDeg]);

  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !window.trisarKarte) return;
    const nextPath = normalizeFlightTrailPath(flightTrail);
    if (nextPath.length < 2) {
      if (flightTrailPolylineRef.current && typeof flightTrailPolylineRef.current.setMap === 'function') {
        flightTrailPolylineRef.current.setMap(null);
      }
      flightTrailPolylineRef.current = null;
      return;
    }
    if (!flightTrailPolylineRef.current) {
      flightTrailPolylineRef.current = new window.trisarKarte.Polyline({
        path: nextPath,
        geodesic: true,
        strokeColor: '#E3F654',
        strokeOpacity: 0.95,
        strokeWeight: 3,
        zIndex: 325,
        map,
      });
      return;
    }
    flightTrailPolylineRef.current.setPath(nextPath);
  }, [flightTrail]);

  useEffect(() => {
    const map = mapInstanceRef.current;
    const bounds = routeBoundsRef.current;
    const previousSheetHeight = Number(previousSheetHeightRef.current);
    previousSheetHeightRef.current = sheetHeight;
    if (!map || !bounds || typeof bounds.isEmpty !== 'function' || bounds.isEmpty()) return;
    // In BEIDE Richtungen neu einpassen: wird das Blatt heruntergezogen, waechst
    // die Kartenflaeche — bisher blieb der Ausschnitt stehen und die Route klebte
    // oben, waehrend unten Platz frei blieb.
    if (!Number.isFinite(previousSheetHeight) || sheetHeight === previousSheetHeight) return;

    const padding = getFitPadding(sheetHeight);
    const timer = window.setTimeout(() => {
      map.fitBounds(bounds, padding);
    }, 60);
    return () => window.clearTimeout(timer);
  }, [sheetHeight]);

  // Standorte der Kolonnenkollegen — nur im Zeitfenster rund um die Fahrt.
  const kollegenRef = useKollegenMarker({
    mapInstanceRef,
    routeBoundsRef,
    kollegen,
    getFitPadding,
    sheetHeight,
    abhaengig: [origin, destination, openToken, showApproachRoute, tripFromDriver, anfahrtStart, standortPunktZeigen],
  });

  // Dunkler Grund, damit vor dem ersten Kartenbild kein heller Kasten steht.
  return <div ref={mapRef} className="w-full h-full relative bg-[#101112]" />;
};

export function RouteMapTop({ job, onBack, showBack = true, onDurationUpdate, openToken, sheetHeight }) {
  const { t, locale } = useI18n();
  const kollegen = useKollegenStandorte(job);
  const origin = job?.from?.address
    || job?.from?.name
    || job?.from?.shortFormattedAddress
    || job?.from?.short_formatted_address
    || '';
  const destination = job?.to?.address
    || job?.to?.name
    || job?.to?.shortFormattedAddress
    || job?.to?.short_formatted_address
    || '';
  const parsedDriverLat = Number(job?.driverLiveLat);
  const parsedDriverLng = Number(job?.driverLiveLng);
  const driverCoords = toFiniteCoord({ lat: parsedDriverLat, lng: parsedDriverLng });
  const parsedFlightLat = Number(job?.flightLiveLat);
  const parsedFlightLng = Number(job?.flightLiveLng);
  const parsedFlightHeading = Number(job?.flightLiveHeadingDeg);
  const backendFlightTrail = Array.isArray(job?.flightLiveTrail) ? job.flightLiveTrail : [];
  const baseFlightCoord = toFiniteCoord({ lat: parsedFlightLat, lng: parsedFlightLng });
  const isTrainRide = Boolean(String(job?.trainNumber || '').trim())
    || String(job?.flightLiveMode || '').trim().toLowerCase() === 'train';
  // Demo: ohne echte Live-Daten fliegt ein simulierter Anflug auf München.
  // Simulierter Anflug nur in der Demo, live ohne Tracking-Position kein Flugzeug.
  const demoAnflug = useDemoAnflug(job, DEMO_MODE && !isTrainRide && !baseFlightCoord);
  const flightCoords = (isTrainRide ? null : baseFlightCoord)
    ? {
        ...(isTrainRide ? null : baseFlightCoord),
        headingDeg: Number.isFinite(parsedFlightHeading) ? parsedFlightHeading : 0,
      }
    : (demoAnflug?.coords || null);
  const flightTrail = isTrainRide ? [] : (baseFlightCoord ? backendFlightTrail : (demoAnflug?.trail || []));
  const showApproachRoute = !isRideStartedStatus(job?.status);
  const tripFromDriver = !showApproachRoute;
  // Haengt vor dieser Fahrt noch eine unbeendete, faengt die Anfahrt an deren
  // Ziel an — wo der Fahrer gerade steht, ist dann nicht die wichtige Zahl.
  const vorherigesZiel = job?.vorherigeFahrt?.to?.address
    || job?.vorherigeFahrt?.to?.name
    || '';
  const anfahrtStart = vorherigesZiel;
  const lastPushLabel = formatLastLocationPushLabel(job?.driverLiveCapturedAt, t, locale);
  const jobStatusLabel = formatJobStatusLabel(job?.status, t);
  const sourceLabel = formatLocationSourceLabel(job?.driverLiveSource, t);
  const radarLabel = String(job?.flightRadarHex || '').trim();
  const callsignLabel = String(job?.flightCallsign || '').trim().toUpperCase();
  const flightTrackingLabel = formatFlightTrackingLabel(job?.flightLiveCapturedAt, t, locale);
  const flightStatusLabel = radarLabel ? t('kolonneF.radar', { value: radarLabel }) : t('kolonneF.radarNone');
  const flightCallsignStatusLabel = callsignLabel ? t('kolonneF.callsign', { value: callsignLabel }) : t('kolonneF.callsignNone');
  const flightOpenSkyEtaLabel = formatOpenSkyEtaLabel(
    job?.flightLiveSecondaryEtaIso,
    job?.flightLiveSecondaryEtaMins,
    t,
    locale,
  );
  const syncErrorLabel = String(job?.extLastError || '').trim();

  return (
    <div className="absolute inset-0">
      <GoogleMapComponent
        origin={origin}
        destination={destination}
        driverCoords={driverCoords}
        fahrerNummer={job?.driverNumber}
        flightCoords={flightCoords}
        flightTrail={flightTrail}
        onDurationUpdate={onDurationUpdate}
        openToken={openToken}
        sheetHeight={sheetHeight}
        showApproachRoute={showApproachRoute}
        tripFromDriver={tripFromDriver}
        anfahrtStart={anfahrtStart}
        standortPunktZeigen={!vorherigesZiel}
        kollegen={kollegen}
      />
      {showBack && (
        <button
          type="button"
          onClick={onBack}
          className="absolute left-[20px] top-[60px] w-[50px] h-[50px] z-40 shadow-[0_4px_16px_rgba(0,0,0,0.45)] rounded-full active:scale-90"
        >
          <MapBackIcon />
        </button>
      )}
      {SHOW_DRIVER_DEBUG_OVERLAY && (
        <div
          className="absolute right-[20px] top-[60px] z-40 px-3 py-1.5 rounded-xl border border-[#3b3b3b] bg-black/70 text-[#b8b8b8] text-[10px] font-bold tracking-[0.3px] font-['Space_Grotesk'] text-right leading-[1.15]"
          aria-label={t('kolonneF.debugAria', { push: lastPushLabel, status: jobStatusLabel, source: sourceLabel })}
        >
          <div>{lastPushLabel}</div>
          <div className="mt-[2px] text-[#8f8f8f]">{jobStatusLabel}</div>
          <div className="mt-[2px] text-[#8f8f8f]">{sourceLabel}</div>
          <div className="mt-[4px] text-[#c4f44f]">{flightStatusLabel}</div>
          <div className="mt-[2px] text-[#8f8f8f]">{flightCallsignStatusLabel}</div>
          <div className="mt-[2px] text-[#8f8f8f]">{flightTrackingLabel}</div>
          <div className="mt-[2px] text-[#8f8f8f]">{flightOpenSkyEtaLabel}</div>
          {syncErrorLabel && <div className="mt-[4px] text-[#ff7d7d]">{t('kolonneF.syncError', { error: syncErrorLabel })}</div>}
        </div>
      )}
    </div>
  );
}

// Chat bubble icon component
const ChatBubbleIcon = () => (
  <img src="/icon/_Icon_Schwarz/Chat_Konnvoi_Trisar_Icons_01.svg" alt="" className="w-[24px] h-[24px] object-contain" />
);

// Arrow icon for buttons
const ArrowIcon = () => (
  <svg width="34" height="20" viewBox="0 0 34 20" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M29.9128 11.9119L29.9128 12.6164L20.2915 16.2347L20.2915 19.917L34 14.4095L34 10.6952L34 10.0227L34 5.50789L20.2915 0.000415031L20.2915 3.68274L29.9128 7.30102L29.9128 8.00547L-1.09799e-06 8.00547L-9.12036e-07 10.0227L-8.50053e-07 10.6952L-7.37893e-07 11.9119L29.9128 11.9119Z" fill="url(#paint0_linear_482_5036)"/>
    <defs>
      <linearGradient id="paint0_linear_482_5036" x1="17" y1="19.917" x2="17" y2="0.000415304" gradientUnits="userSpaceOnUse">
        <stop stopColor="#202020"/>
        <stop offset="1"/>
      </linearGradient>
    </defs>
  </svg>
);

const MapBackIcon = () => (
  // Hinter dem Symbol liegt ein schwarzer Kreis. Der Aussenrand des Symbols
  // wird weich gezeichnet und ist dort halb durchsichtig — ohne die Unterlage
  // schimmert die helle Karte durch und der Knopf bekommt einen hellen Saum.
  <span className="block w-[50px] h-[50px] rounded-full bg-black overflow-hidden">
    <img src="/icon/_Icon_Karte/Backbutton_Karte.svg?v=2" alt="" className="w-[50px] h-[50px] object-contain" />
  </span>
);

function ConvoyDriverPopup({ driver, onClose }) {
  const { t } = useI18n();
  const phoneLink = `tel:${String(driver?.phone || '').replace(/[\s()-]/g, '')}`;
  const hasPhone = String(driver?.phone || '').trim().length > 0;
  const firstName = String(driver?.name || '').trim().split(/\s+/)[0] || t('kolonneF.driverFallback');
  const avatarUrl = String(driver?.avatarUrl || driver?.image || driver?.avatar_url || '').trim();

  return (
    <div className="absolute inset-0 z-[70] bg-black/95 flex items-center justify-center px-[20px]" onClick={onClose}>
      <div className="w-full max-w-[362px]" onClick={(event) => event.stopPropagation()}>
        <button
          type="button"
          onClick={onClose}
          aria-label={t('kolonneF.back')}
          className="w-[54px] h-[54px] mb-[18px] rounded-full border-2 border-[#E3F654] bg-black/85 flex items-center justify-center"
        >
          <img src="/icon/_Icon_Lime/Arrow_Trisar_Icons_01_Lime.svg" alt="" className="w-[29px] h-[18px] object-contain rotate-180" />
        </button>

        <div className="w-full border-2 border-[#E3F654] bg-black pt-[18px] pb-[18px]">
          <div className="mx-auto w-[138px] h-[138px] bg-[#1f2023] flex items-center justify-center overflow-hidden">
            {avatarUrl ? (
              <img
                src={avatarUrl}
                alt={t('kolonneF.profileImageAlt', { name: driver?.name || t('kolonneF.driverFallback') })}
                className="w-full h-full object-cover"
              />
            ) : (
              <img
                src="/icon/_Icon_Schwarz/Person_Trisar_Icons_01.svg"
                alt=""
                className="w-[82px] h-[82px] opacity-75"
              />
            )}
          </div>

          <div className="mt-[18px] text-center text-[#E3F654] text-[30px] leading-[1] font-bold font-['Space_Grotesk']">
            {driver?.name || t('kolonneF.driverFallback')}
          </div>
          <div className="mt-[18px] text-center text-[#D6D6D6] text-[30px] leading-[1] font-bold font-['Space_Grotesk']">
            {driver?.plate || '-'}
          </div>
          <div className="text-center text-[#D6D6D6] text-[20px] leading-[1.1] font-normal font-['Space_Grotesk']">
            {driver?.vehicle || '-'}
          </div>
        </div>

        <a
          href={hasPhone ? phoneLink : undefined}
          onClick={(event) => {
            event.stopPropagation();
            if (!hasPhone) event.preventDefault();
          }}
          className={`mt-[18px] h-[48px] w-full bg-[#E3F654] px-4 flex items-center justify-center relative text-[16px] leading-none font-medium font-['Space_Grotesk'] ${
            hasPhone ? 'text-[#1d1c1d]' : 'text-[#5f6130] pointer-events-none'
          }`}
        >
          <span>{t('kolonneF.callDriver', { name: firstName })}</span>
          <img
            src="/icon/_Icon_Schwarz/contact-phone.svg"
            alt=""
            className="w-[22px] h-[22px] absolute right-[14px] top-1/2 -translate-y-1/2"
          />
        </a>
      </div>
    </div>
  );
}

export default function KoloneFlughafen({ job, setView, onCancelRide, onEndRide, onSendRideNote, ungeleseneNachrichten = 0 }) {
  const { t, locale } = useI18n();
  // --- DRAG & DROP LOGIK ---
  // Ziehen laeuft ueber blattZiehen: waehrend der Bewegung wird nur der Stil
  // gesetzt, neu gezeichnet wird erst beim Einrasten.
  const {
    hoehe: sheetHeight,
    zieht: isDragging,
    blattRef,
    feldRef,
    scrollRef: sheetScrollRef,
    ziehStart: handleDragStart,
    ziehBewegung: handleDragMove,
    ziehEnde: handleDragEnd,
    inhaltStart: handleSheetContentTouchStart,
    inhaltBewegung: handleSheetContentTouchMove,
  } = useBlattZiehen(50);
  const [showCancelSheet, setShowCancelSheet] = useState(false);
  // Abholschild: Gaestenamen gross und gedreht, oeffnet per Tipp auf die Gaeste.
  const [showAbholschild, setShowAbholschild] = useState(false);
  const [showEndRideSheet, setShowEndRideSheet] = useState(false);
  const [showNoteSendSheet, setShowNoteSendSheet] = useState(false);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [endRideBusy, setEndRideBusy] = useState(false);
  const [noteSendBusy, setNoteSendBusy] = useState(false);
  const [selectedConvoyDriver, setSelectedConvoyDriver] = useState(null);
  const mapOpenToken = job?.__openToken || job?.id || 'default';
  const [liveRouteDurationMins, setLiveRouteDurationMins] = useState(null);

  useEffect(() => {
    setLiveRouteDurationMins(null);
  }, [job?.id, job?.from?.address, job?.to?.address, job?.__openToken]);
  

  const openCancelSheet = () => {
    setShowEndRideSheet(false);
    setShowNoteSendSheet(false);
    setShowCancelSheet(true);
  };
  const closeCancelSheet = () => {
    if (cancelBusy) return;
    setShowCancelSheet(false);
  };
  const confirmCancelRide = async (notes) => {
    if (!job?.id || cancelBusy) return;
    if (typeof onCancelRide !== 'function') {
      setShowCancelSheet(false);
      return;
    }
    try {
      setCancelBusy(true);
      const ok = await onCancelRide(job.id, notes);
      if (ok) setShowCancelSheet(false);
    } finally {
      setCancelBusy(false);
    }
  };

  const openEndRideSheet = () => {
    setShowCancelSheet(false);
    setShowNoteSendSheet(false);
    setShowEndRideSheet(true);
  };
  const closeEndRideSheet = () => {
    if (endRideBusy) return;
    setShowEndRideSheet(false);
  };
  const confirmEndRide = async (notes) => {
    if (endRideBusy) return;
    if (typeof onEndRide !== 'function') {
      setShowEndRideSheet(false);
      return;
    }
    try {
      setEndRideBusy(true);
      const ok = await onEndRide(job?.id, notes);
      if (ok) setShowEndRideSheet(false);
    } finally {
      setEndRideBusy(false);
    }
  };

  const openNoteSendSheet = () => {
    setShowCancelSheet(false);
    setShowEndRideSheet(false);
    setShowNoteSendSheet(true);
  };
  const closeNoteSendSheet = () => {
    if (noteSendBusy) return;
    setShowNoteSendSheet(false);
  };
  const confirmNoteSend = async (notes) => {
    if (noteSendBusy) return;
    if (typeof onSendRideNote !== 'function') {
      setShowNoteSendSheet(false);
      return;
    }
    try {
      setNoteSendBusy(true);
      const ok = await onSendRideNote(job?.id, notes);
      if (ok) setShowNoteSendSheet(false);
    } finally {
      setNoteSendBusy(false);
    }
  };

  const fromName = getDisplayLocationName(job?.from, 'München MUC');
  const toName = getDisplayLocationName(job?.to, 'Bayrischer Hof');
  // Beide Adressen oeffnen dieselbe Route: Standort -> Gast -> Endort.
  const routeNavUrl = getRouteNavigationUrl(job?.from, job?.to);
  const fromNavUrl = routeNavUrl;
  const toNavUrl = routeNavUrl;
  const fromTypeLabel = getLocationTypeLabel(job?.from, t);
  const toTypeLabel = getLocationTypeLabel(job?.to, t);
  const rawKolonneName = `${job?.kolonneName || job?.convoyName || ''}`.trim();
  const cleanedKolonneName = rawKolonneName
    .replace(/^\s*kolonn?e?\s*/i, '')
    .replace(/^[:\-–]\s*/, '')
    .trim();
  const kolonneButtonLabel = cleanedKolonneName ? t('kolonneF.kolonneNamed', { name: cleanedKolonneName }) : t('kolonneF.kolonne');
  const rawFlightNumber = `${job?.flight || job?.flightNumber || job?.extFlightNumber || ''}`.trim();
  const flightNumber = rawFlightNumber && rawFlightNumber !== 'STADTFAHRT' ? rawFlightNumber : '---';
  const flightOrigin = `${job?.flightOrigin || job?.from?.city || ''}`.trim();
  const etdTime = job?.etd || '--:--';
  const plannedTime = `${job?.originalEtd || ''}`.trim();
  const plannedLineState = getPlanOrFlightPhaseLabel(job, plannedTime);
  const planLineText = t('kolonneF.planLine', { time: plannedTime || '--:--' });
  const flightPhaseText = plannedLineState.isStatus ? plannedLineState.text : '';
  const routeDurationMins = Number(
    (Number.isFinite(liveRouteDurationMins) && liveRouteDurationMins > 0)
      ? liveRouteDurationMins
      : (job?.extRouteDurationInTrafficMins || job?.extRouteDurationMins || 0),
  );
  const etaTime = addMinutesToTime(etdTime, routeDurationMins) || job?.eta || '--:--';
  const driveLabel = routeDurationMins > 0 ? t('kolonneF.driveDuration', { duration: formatDuration(routeDurationMins, t) }) : t('kolonneF.driveDurationNone');
  const guestNames = toUniqueNameList([
    ...(Array.isArray(job?.kolonneGuests) ? job.kolonneGuests : []),
    ...(Array.isArray(job?.passengers) ? job.passengers : []),
  ]);
  const driverNames = toUniqueNameList(
    (Array.isArray(job?.kolonneDrivers) ? job.kolonneDrivers : []).map(
      (driver) => driver?.name || driver?.fullName || driver?.driverName || '',
    ),
  );
  const convoyDriverRows = (() => {
    const source = Array.isArray(job?.kolonneDrivers) ? job.kolonneDrivers : [];
    const mapped = source
      .map((driver) => {
        const safe = driver && typeof driver === 'object' ? driver : {};
        const name = String(safe?.name || safe?.fullName || safe?.driverName || '').trim();
        const phone = String(safe?.phone || safe?.phoneNumber || safe?.mobile || '').trim();
        const explicitPlate = String(
          safe?.plate
          || safe?.licensePlate
          || safe?.license_plate
          || safe?.kennzeichen
          || safe?.vehicle?.license_plate
          || safe?.vehiclePlate
          || '',
        ).trim();
        const explicitVehicle = String(
          safe?.vehicle
          || safe?.vehicleModel
          || safe?.model
          || safe?.carModel
          || safe?.vehicle?.brand_model
          || safe?.vehicleName
          || '',
        ).trim();
        const carLabel = String(safe?.car || '').trim();
        const carMatch = carLabel.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
        const vehicleFromCar = carMatch?.[1] ? String(carMatch[1]).trim() : '';
        const plateFromCar = carMatch?.[2] ? String(carMatch[2]).trim() : '';
        const vehicle = explicitVehicle || vehicleFromCar || (carMatch ? '' : carLabel);
        const plate = explicitPlate || plateFromCar;
        const avatarUrl = String(
          safe?.avatarUrl
          || safe?.image
          || safe?.avatar_url
          || safe?.avatar
          || safe?.profileImage
          || '',
        ).trim();
        if (!name) return null;
        return { name, phone, plate, vehicle, avatarUrl, disabled: false };
      })
      .filter(Boolean);

    const unique = [];
    const seen = new Set();
    mapped.forEach((entry) => {
      const key = entry.name.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      unique.push(entry);
    });
    if (unique.length > 0) return unique;
    if (driverNames.length > 0) {
      return driverNames.map((name) => ({ name, phone: '', plate: '', vehicle: '', avatarUrl: '', disabled: false }));
    }
    return [{ name: t('kolonneF.noDrivers'), phone: '', plate: '', vehicle: '', avatarUrl: '', disabled: true }];
  })();
  const visibleGuestNames = guestNames.length ? guestNames : [t('kolonneF.noGuests')];
  useEffect(() => {
    setSelectedConvoyDriver(null);
  }, [job?.id]);
  const markerTypes = getMarkerTypes(job?.badges);
  const notes = (Array.isArray(job?.notes) ? job.notes : [])
    .map((note) => {
      const text = `${note?.text || note?.note_text || ''}`.trim();
      if (!text) return null;

      // Verfasser mitnehmen — er steht rechts neben Zeit und Datum.
      const autor = `${note?.autor || note?.author_name || ''}`.trim();
      const rawTime = `${note?.time || ''}`.trim();
      const rawDate = `${note?.date || ''}`.trim();
      if (rawTime || rawDate) {
        return { time: rawTime, date: rawDate, text, autor };
      }

      const createdAt = note?.createdAt || note?.created_at;
      if (createdAt) {
        const dateObj = new Date(createdAt);
        if (!Number.isNaN(dateObj.getTime())) {
          return {
            time: dateObj.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }),
            date: dateObj.toLocaleDateString(locale),
            text,
            autor,
          };
        }
      }

      return { time: '', date: '', text, autor };
    })
    .filter(Boolean);

  const AFTER_GUESTS_SHIFT = -81;
  const SECTION_TITLE_TO_FIRST_ROW_GAP = 50;
  const LIST_ROW_HEIGHT = 51;
  const LIST_ROW_STEP = 57; // 51 row + 6 gap
  const GUEST_TO_DRIVER_TITLE_GAP = 30;
  const DRIVER_TO_NOTES_TITLE_GAP = 60;
  const NOTES_TITLE_TO_FIRST_NOTE_GAP = 64;
  const NOTE_ROW_STEP = 64;
  const NOTE_ROW_HEIGHT = 40; // 16(time/date) + 6(gap) + 18(text)
  const NOTES_TO_FIRST_ACTION_GAP = 54;
  const ACTION_BUTTON_STEP = 80; // 56 button + 24 gap
  const guestRowCount = visibleGuestNames.length;
  const driverRowCount = convoyDriverRows.length;
  const GUESTS_TITLE_TOP = 563 + AFTER_GUESTS_SHIFT;
  const GUEST_ROW_TOP = GUESTS_TITLE_TOP + SECTION_TITLE_TO_FIRST_ROW_GAP;
  const guestLastRowBottom = GUEST_ROW_TOP + ((guestRowCount - 1) * LIST_ROW_STEP) + LIST_ROW_HEIGHT;
  const DRIVER_TITLE_TOP = guestLastRowBottom + GUEST_TO_DRIVER_TITLE_GAP;
  const DRIVER_ROW_TOP = DRIVER_TITLE_TOP + SECTION_TITLE_TO_FIRST_ROW_GAP;
  const driverLastRowBottom = DRIVER_ROW_TOP + ((driverRowCount - 1) * LIST_ROW_STEP) + LIST_ROW_HEIGHT;

  const hasNotes = notes.length > 0;
  const NOTES_TITLE_TOP = driverLastRowBottom + DRIVER_TO_NOTES_TITLE_GAP;
  const NOTE_FIRST_TOP = NOTES_TITLE_TOP + NOTES_TITLE_TO_FIRST_NOTE_GAP;
  const NO_NOTES_ACTION_TOP1 = NOTES_TITLE_TOP;

  // Notizen koennen mehrzeilig sein; ihre Hoehe wird gemessen, damit weder
  // Notizen ineinanderlaufen noch die Knoepfe darunter zu frueh kommen.
  // Bis zur ersten Messung gilt die alte Schaetzung aus festen Zeilenschritten.
  const notesRef = useRef(null);
  const [notesHeight, setNotesHeight] = useState(0);
  useEffect(() => {
    const el = notesRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver((eintraege) => {
      const h = eintraege[0]?.contentRect?.height;
      if (Number.isFinite(h)) setNotesHeight(h);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [notes.length]);
  const geschaetzteNotizhoehe = ((notes.length - 1) * NOTE_ROW_STEP) + NOTE_ROW_HEIGHT;
  const lastNoteBottom = hasNotes
    ? NOTE_FIRST_TOP + (notesHeight > 0 ? notesHeight : geschaetzteNotizhoehe)
    : 0;
  const actionTop1 = hasNotes
    ? lastNoteBottom + NOTES_TO_FIRST_ACTION_GAP
    : NO_NOTES_ACTION_TOP1;
  const actionTop2 = actionTop1 + ACTION_BUTTON_STEP;
  const actionTop3 = actionTop2 + ACTION_BUTTON_STEP;
  const actionTop4 = actionTop3 + ACTION_BUTTON_STEP;

  const CONTENT_SHIFT_Y = 24; // matches -translate-y-[24px]
  const SCROLL_BOTTOM_PADDING = 24; // matches pb-6
  const FOOTER_HEIGHT = 40;
  const SUPPORT_TO_FOOTER_GAP = 30;
  const requiredBottomForActions =
    actionTop4 + 56 - CONTENT_SHIFT_Y + FOOTER_HEIGHT + SUPPORT_TO_FOOTER_GAP - SCROLL_BOTTOM_PADDING;
  const contentHeight = requiredBottomForActions;

  return (
    // Die Event-Listener für das BEWEGEN und LOSLASSEN liegen auf dem äußersten Container
    <div 
      className="flex flex-col h-screen bg-[#0a0a0a] max-w-md mx-auto relative overflow-hidden font-['Space_Grotesk'] text-white"
      // Marke je Fahrt: daran erkennt das Tutorial, welche Fahrt offen ist.
      data-tutorial={`fahrt-detail-${job?.id || ''}`}
      style={{ touchAction: isDragging ? 'none' : 'pan-y' }}
      onMouseMove={handleDragMove} 
      onMouseUp={handleDragEnd} 
      onTouchMove={handleDragMove} 
      onTouchEnd={handleDragEnd}
      onMouseLeave={handleDragEnd} // Falls die Maus das Fenster verlässt
    >
      {/* Map Background */}
      <div className="flex-1 relative">
        {/* Nur der FREIE Teil der Karte — das Infoblatt liegt darueber, die
            Kartenflaeche selbst ist immer bildschirmhoch. Das Tutorial hebt
            damit genau den sichtbaren Ausschnitt hervor. */}
        <div
          aria-hidden="true"
          data-tutorial="karte"
          ref={feldRef}
          className="absolute left-0 right-0 top-0 pointer-events-none"
          style={{ bottom: `${sheetHeight}%` }}
        />
        <RouteMapTop
          job={job}
          onBack={() => setView?.('list')}
          showBack={false}
          onDurationUpdate={setLiveRouteDurationMins}
          openToken={mapOpenToken}
          sheetHeight={sheetHeight}
        />
        <button type="button" onClick={() => setView?.('list')} className="absolute left-[20px] top-[60px] w-[50px] h-[50px] z-40 shadow-[0_4px_16px_rgba(0,0,0,0.45)] rounded-full" data-tutorial="details-zurueck">
          <MapBackIcon />
        </button>
      </div>
      
      {/* Sliding Content Panel */}
      <div 
        ref={blattRef}
        className={`absolute bottom-0 left-0 right-0 bg-[#1a1a1a] rounded-t-[20px] z-30 flex flex-col shadow-[0_-10px_40px_rgba(0,0,0,0.5)] will-change-[height] ${!isDragging ? 'transition-[height] duration-[320ms] ease-[cubic-bezier(0.22,1,0.36,1)]' : ''}`}
        style={{ height: `${sheetHeight}%` }} // Die Höhe wird jetzt vom State gesteuert!
      >
        {/* Pull indicator / Drag Handle (Hier greift man an) */}
        <div 
          className="w-full pt-[18px] pb-[18px] flex justify-center cursor-grab active:cursor-grabbing"
          onMouseDown={handleDragStart} 
          onTouchStart={handleDragStart}
          data-tutorial="blatt-griff"
        >
          <div className="w-[87px] h-[6px] bg-[#e2f754]" />
        </div>

        {/* Scrollbarer Content (flex-1 füllt den restlichen Platz des Panels) */}
        <div
          ref={sheetScrollRef}
          className="pb-6 flex-1 overflow-y-auto overscroll-none custom-scrollbar"
          onTouchStart={handleSheetContentTouchStart}
          onTouchMove={handleSheetContentTouchMove}
        >
          <div className="relative w-full mx-auto" style={{ height: `${contentHeight}px` }}>
            <button
              type="button"
              onClick={() => setView?.('kolonnenChat')}
              className="absolute left-[20px] right-[20px] top-[18px] h-[45px] z-20 bg-[#e2f754] pl-[12px] pr-[12px] flex items-center justify-between"
             data-tutorial="kolonnen-chat">
              <span className="text-neutral-800 text-[18px] font-bold tracking-[-0.5px]">
                {kolonneButtonLabel}
              </span>
              <ChatBubbleIcon />
              {ungeleseneNachrichten > 0 && (
                // Nach Figma: roter Kreis mit 28 px, mittig auf der oberen
                // rechten Ecke des gelben Balkens.
                <span
                  data-tutorial="kolonnen-chat-neu"
                  className="absolute -top-[14px] -right-[14px] w-[28px] h-[28px] rounded-full bg-[#ff6e63] text-black text-[14px] font-bold leading-[28px] text-center"
                >
                  {ungeleseneNachrichten > 9 ? '9+' : ungeleseneNachrichten}
                </span>
              )}
            </button>

            <div className="absolute inset-0 -translate-y-[24px]">
            <div className="absolute left-[20px] top-[111px] text-[#868687] text-[12px] font-bold tracking-[-0.3px]">{t('kolonneF.etd')}</div>
            <div className="absolute right-[20px] top-[111px] text-right text-[#868687] text-[12px] font-bold tracking-[-0.3px]">{t('kolonneF.eta')}</div>
            <div className="absolute left-[20px] top-[129px] text-[#e2f754] text-[32px] leading-[0.88] font-bold tracking-[-1px]">{etdTime}</div>
            <div className="absolute right-[20px] top-[129px] text-right text-[#e2f754] text-[32px] leading-[0.88] font-bold tracking-[-1px]">{etaTime}</div>
            <div className="absolute left-[20px] top-[156px] text-[#f4f5f4] text-[12px] font-bold tracking-[-0.5px] opacity-50 line-through">{planLineText}</div>
            <div className="absolute left-[20px] top-[174px] text-[#f4f5f4] text-[12px] font-bold tracking-[-0.5px] opacity-70">{flightPhaseText}</div>
            <div className="absolute right-[20px] top-[156px] text-right text-[#f4f5f4] text-[12px] font-bold tracking-[-0.5px] opacity-50">{driveLabel}</div>


            {markerTypes.length > 0 && (
              <div className="absolute right-[20px] top-[386px] flex items-center gap-[8px]">
                {markerTypes.map((type) => (
                  <MarkerIcon key={`marker-${type}`} type={type} />
                ))}
              </div>
            )}
            <div className="absolute left-[20px] top-[424px] text-[#f4f5f4] text-[16px] leading-[16px] font-bold tracking-[-0.5px] opacity-50">{flightOrigin ? t('kolonneF.fromOrigin', { origin: flightOrigin }) : ''}</div>

            <div className="absolute left-[20px] top-[211px] w-[64px] h-[64px] bg-[#242525] rounded-[16px] flex items-center justify-center">
              <img src={ortIconFuer(job?.from) || pickRideIcon(`${job?.from?.name || ''} ${job?.from?.address || ''} ${getDisplayLocationName(job?.from, "")}`, true)} alt="" className="w-[30px] h-[30px] object-contain" />
            </div>

            <div className="absolute left-1/2 -translate-x-1/2 top-[231px] w-[59px] h-[38px] flex items-center justify-center">
              <img src="/icon/_Icon_Lime/Arrow_Trisar_Icons_01_Lime.svg" alt="" className="w-[59px] h-[38px] object-contain" />
            </div>

            <div className="absolute right-[20px] top-[211px] w-[64px] h-[64px] bg-[#242525] rounded-[16px] flex items-center justify-center">
              <img src={ortIconFuer(job?.to) || pickRideIcon(`${job?.to?.name || ''} ${job?.to?.address || ''} ${getDisplayLocationName(job?.to, "")}`)} alt="" className="w-[30px] h-[30px] object-contain" />
            </div>

            <div className="absolute left-[20px] right-[20px] top-[289px] grid grid-cols-[minmax(0,1fr)_18px_minmax(0,1fr)] items-start">
              <div className="min-w-0">
                <div className="text-[#868786] text-[14px] font-bold tracking-[-0.5px]">{fromTypeLabel}</div>
                {fromNavUrl
                  ? <a href={fromNavUrl} target="_blank" rel="noopener noreferrer" className="text-white text-[18px] font-bold tracking-[-0.5px] leading-[1.15] break-words block underline decoration-[#e2f754] decoration-2 underline-offset-4 active:opacity-70">{fromName}</a>
                  : <div className="text-white text-[18px] font-bold tracking-[-0.5px] leading-[1.15] break-words">{fromName}</div>}
              </div>
              <div aria-hidden="true" />
              <div className="min-w-0 text-right">
                <div className="text-[#868786] text-[14px] font-bold tracking-[-0.5px]">{toTypeLabel}</div>
                {toNavUrl
                  ? <a href={toNavUrl} target="_blank" rel="noopener noreferrer" className="text-white text-[18px] font-bold tracking-[-0.5px] leading-[1.15] break-words block underline decoration-[#e2f754] decoration-2 underline-offset-4 active:opacity-70">{toName}</a>
                  : <div className="text-white text-[18px] font-bold tracking-[-0.5px] leading-[1.15] break-words">{toName}</div>}
              </div>
            </div>

            <div className="absolute left-[20px] top-[386px] text-[#f4f5f4] text-[42px] leading-[0.88] font-bold tracking-[-1px]">{flightNumber}</div>

            <div className="absolute left-[20px] text-[#e2f754] text-[32px] leading-[32px] font-bold tracking-[-1px]" style={{ top: `${GUESTS_TITLE_TOP}px` }}>{t('kolonneF.guests')}</div>
            {visibleGuestNames.map((name, idx) => (
              <div key={`guest-${idx}-${name}`} className="absolute left-[20px] right-[20px] h-[51px] bg-[#242425] px-[12px] flex items-center cursor-pointer" data-tutorial="gast" role="button" onClick={() => { if (guestNames.length) setShowAbholschild(true); }} style={{ top: `${GUEST_ROW_TOP + (idx * LIST_ROW_STEP)}px` }}>
                <span className="text-[#e2f754] text-[18px] font-bold tracking-[-0.5px]">{name}</span>
              </div>
            ))}

            {/* Unsichtbares Rechteck ueber Ueberschrift und allen Fahrerzeilen —
                das Tutorial hebt damit den ganzen Block hervor, nicht nur die
                erste Zeile. */}
            <div
              aria-hidden="true"
              data-tutorial="kolonnen-fahrer"
              className="absolute left-[20px] right-[20px] pointer-events-none"
              style={{ top: `${DRIVER_TITLE_TOP}px`, height: `${driverLastRowBottom - DRIVER_TITLE_TOP}px` }}
            />
            <div className="absolute left-[20px] text-[#e2f754] text-[32px] leading-[32px] font-bold tracking-[-1px]" style={{ top: `${DRIVER_TITLE_TOP}px` }}>{t('kolonneF.driversTitle')}</div>
            {convoyDriverRows.map((driver, idx) => (
              <button
                key={`driver-${idx}-${driver.name}`}
                type="button"
                onClick={() => {
                  if (driver.disabled) return;
                  setSelectedConvoyDriver(driver);
                }}
                className={`absolute left-[20px] right-[20px] h-[51px] bg-[#e2f754] px-[12px] flex items-center text-left ${driver.disabled ? 'opacity-70 cursor-default' : ''}`}
                style={{ top: `${DRIVER_ROW_TOP + (idx * LIST_ROW_STEP)}px` }}
              >
                <span className="text-[#242425] text-[18px] font-bold tracking-[-0.5px]">{driver.name}</span>
              </button>
            ))}

            {hasNotes && (
              <>
                <div className="absolute left-[20px] text-[#e2f754] text-[58px] leading-[52px] font-bold tracking-[-1px]" style={{ top: `${NOTES_TITLE_TOP}px` }}>{t('kolonneF.note')}</div>
                <div ref={notesRef} className="absolute left-[20px] right-[20px] flex flex-col gap-[24px]" style={{ top: `${NOTE_FIRST_TOP}px` }}>
                  {notes.map((note, idx) => (
                    <div key={`${idx}-${note.time}-${note.date}-${note.text}`} className="flex flex-col gap-[6px]" data-tutorial="notiz-eintrag">
                      <div className="flex items-center text-[#868786] text-[16px] leading-[16px] font-bold tracking-[-0.5px]">
                        <span>{note.time}</span>
                        {note.date ? <span className="ml-[44px]">{note.date}</span> : null}
                        {/* Verfasser rechtsbuendig, sonst wie Zeit und Datum. */}
                        {note.autor ? <span className="ml-auto text-right">{note.autor}</span> : null}
                      </div>
                      <div className="text-[#f4f5f4] text-[18px] leading-[18px] font-bold tracking-[-0.5px]">{note.text}</div>
                    </div>
                  ))}
                </div>
              </>
            )}

            <button type="button" onClick={openEndRideSheet} className="absolute left-[20px] right-[20px] h-[56px] bg-[#ff6f63] border-2 border-[#ff6f63] pl-[16px] pr-[12px] flex items-center justify-between" style={{ top: `${actionTop1}px` }}>
              <span className="text-neutral-800 text-[16px] font-medium tracking-[0.5px]">{t('kolonneF.endRide')}</span>
              <ArrowIcon />
            </button>
            <button type="button" onClick={openCancelSheet} className="absolute left-[20px] right-[20px] h-[56px] bg-[#e2f754] border-2 border-[#e2f754] pl-[16px] pr-[12px] flex items-center justify-between" style={{ top: `${actionTop2}px` }}>
              <span className="text-neutral-800 text-[16px] font-medium tracking-[0.5px]">{t('kolonneF.cancel')}</span>
              <ArrowIcon />
            </button>
            <button type="button" onClick={openNoteSendSheet} className="absolute left-[20px] right-[20px] h-[56px] bg-[#e2f754] border-2 border-[#e2f754] pl-[16px] pr-[12px] flex items-center justify-between" style={{ top: `${actionTop3}px` }}>
              <span className="text-neutral-800 text-[16px] font-medium tracking-[0.5px]">{t('kolonneF.rideNote')}</span>
              <ArrowIcon />
            </button>
            <button type="button" onClick={() => setView?.('ansprechpartnerDetails')} className="absolute left-[20px] right-[20px] h-[56px] border-2 border-[#e2f754] px-[16px] flex items-center justify-center" style={{ top: `${actionTop4}px` }}>
              <span className="text-[#e2f754] opacity-50 text-[16px] font-medium tracking-[0.5px]">{t('kolonneF.support')}</span>
            </button>
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <TrisarFooter className="fixed bottom-0 left-0 right-0 h-10 bg-black z-30" />

      {showAbholschild && (
        <Abholschild namen={guestNames} onClose={() => setShowAbholschild(false)} />
      )}
      {showCancelSheet && (
        <CancelRideSheet
          onClose={closeCancelSheet}
          onConfirm={confirmCancelRide}
        />
      )}
      {showEndRideSheet && (
        <FahrtBeenden
          onClose={closeEndRideSheet}
          onConfirm={confirmEndRide}
        />
      )}
      {showNoteSendSheet && (
        <NotizSend
          onClose={closeNoteSendSheet}
          onConfirm={confirmNoteSend}
        />
      )}
      {selectedConvoyDriver ? (
        <ConvoyDriverPopup
          driver={selectedConvoyDriver}
          onClose={() => setSelectedConvoyDriver(null)}
        />
      ) : null}
      
      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 0px; background: transparent; }
      `}</style>
    </div>
  );
}
