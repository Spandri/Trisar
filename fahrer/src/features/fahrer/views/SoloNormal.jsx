import React, { useEffect, useState, useRef } from 'react';
import { anfahrtAbFahrer } from '../../../shared/anfahrtKuerzen';
import { useRoutenStandort } from '../../../shared/routenStandort';
import { kurzAdresse } from '../../../shared/adresseKurz';
import { berechneEta, useJetzt } from '../../../shared/etaBerechnung';
import { useI18n } from '../../../i18n';
import { useBlattZiehen } from './blattZiehen';
import TrisarFooter from '../../../components/ui/TrisarFooter';
import CancelRideSheet from './CancelRideSheet';
import Abholschild from './Abholschild';
import FahrtBeenden from './FahrtBeenden';
import NotizSend from './NotizSend';
import {
  MAP_FLAG_PIN_URL,
  MAP_START_FLAG_URL,
  MAP_START_PICKUP_URL,
  MAP_FAHRER_STANDORT_URL,
  MAP_PERSON_PIN_URL,
  RIDE_ADDRESS_URL,
  RIDE_AIRPORT_START_URL,
  RIDE_AIRPORT_URL,
  RIDE_HOTEL_URL,
} from '../../../shared/ui/icons';
import { karteBereitstellen } from '../../../shared/karte/maplibreKarte';
import { gleicherOrt } from '../../../shared/utils/vorherigeFahrt';
import { getRouteNavigationUrl } from '../../../shared/utils/navigation';
import { ortIconFuer } from '../../../shared/orte';
const envOrDefault = (value, fallback) => {
  if (!value) return fallback;
  if (typeof value === 'string' && value.trim().toLowerCase().startsWith('your_')) return fallback;
  return value;
};
const MAP_DEFAULT_CENTER = { lat: 48.1215, lng: 11.6644 };
// Technisches Kaestchen (letzter Positions-Push, Status, Quelle) nur auf Wunsch —
// wie in den Flughafen-Varianten hinter VITE_SHOW_DRIVER_DEBUG_OVERLAY.
const SHOW_DRIVER_DEBUG_OVERLAY = ['1', 'true', 'yes', 'on'].includes(
  String(import.meta.env.VITE_SHOW_DRIVER_DEBUG_OVERLAY || '').trim().toLowerCase(),
);

const formatDuration = (mins) => {
  if (!mins || mins <= 0) return '0 min';
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h}:${String(m).padStart(2, '0')} h`;
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
  if (airportPattern.test(text)) return t('fahrt.locationAirport');
  if (hotelPattern.test(text)) return t('fahrt.locationHotel');
  return t('fahrt.locationAddress');
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
  if (!date || Number.isNaN(date.getTime())) return t('fahrt.pushUnknown');
  return t('fahrt.pushTime', {
    time: date.toLocaleTimeString(locale, {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }),
  });
};

const formatJobStatusLabel = (value, t) => {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return t('fahrt.statusNone');
  if (['pending', 'new', 'offen', 'requested', 'offered', 'assigned', 'zugewiesen'].includes(normalized)) return t('fahrt.statusOpen');
  if (['at_pickup', 'beim_pickup', 'beim pickup'].includes(normalized)) return t('fahrt.statusAtPickup');
  if (['in_progress', 'unterwegs', 'started', 'on_trip', 'ongoing', 'active'].includes(normalized)) return t('fahrt.statusWithGuest');
  if (['done', 'completed', 'arrived', 'beendet'].includes(normalized)) return t('fahrt.statusDone');
  if (['cancelled', 'canceled', 'refused', 'stoniert', 'storniert'].includes(normalized)) return t('fahrt.statusCancelled');
  return t('fahrt.statusValue', { value: String(value || '').trim() });
};
const formatLocationSourceLabel = (value, t) => {
  const source = String(value || '').trim();
  if (!source) return t('fahrt.sourceUnknown');
  return t('fahrt.source', { source });
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

const GoogleMapComponent = ({ origin, destination, driverCoords, fahrerNummer = '', onDurationUpdate, openToken, sheetHeight = 50, showApproachRoute = true, tripFromDriver = false, anfahrtStart = '', standortPunktZeigen = true }) => {
  // Anfahrt folgt dem Auto: Die gelbe Linie wird bei jedem Standort am gefahrenen Teil
  // abgeschnitten (kostet nichts). Nur wenn der Fahrer mehr als 200 m von der Route
  // abkommt, wird neu gerechnet, gedrosselt auf hoechstens alle 15 s.
  const anfahrtLinieRef = useRef(null);
  // Blaue Linie, wenn sie beim Fahrer beginnt (Gast an Bord): wird genauso gekuerzt.
  const fahrtLinieRef = useRef(null);
  const [abseitsPunkt, setAbseitsPunkt] = useState(null);
  const routenStandort = useRoutenStandort(abseitsPunkt?.lat, abseitsPunkt?.lng);
  const mapRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const routeBoundsRef = useRef(null);
  const driverMarkerRef = useRef(null);
  const previousSheetHeightRef = useRef(sheetHeight);

  const getFitPadding = (sheetPercent = 50) => {
    const viewportHeight = window.innerHeight || 874;
    const normalizedSheet = Math.min(Math.max(Number(sheetPercent) || 50, 25), 85);
    const sheetPx = Math.round(viewportHeight * (normalizedSheet / 100));
    return {
      top: 44,
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
      const hasLiveDriverCoords = (
        driverCoords
        && Number.isFinite(driverCoords.lat)
        && Number.isFinite(driverCoords.lng)
      );
      const resolvedDriverCoords = hasLiveDriverCoords ? driverCoords : null;

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
                    formatDuration(approachMins),
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

                const labelText = formatDuration(mins);
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
      cleanupRefs.forEach((ref) => {
        if (typeof ref.setMap === 'function') ref.setMap(null);
        if (typeof ref.close === 'function') ref.close();
      });
    };
  }, [origin, destination, onDurationUpdate, openToken, showApproachRoute, tripFromDriver, anfahrtStart, standortPunktZeigen, routenStandort?.lat, routenStandort?.lng]);

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
    const marker = driverMarkerRef.current;
    if (!marker) return;
    const nextLat = Number(driverCoords?.lat);
    const nextLng = Number(driverCoords?.lng);
    if (!Number.isFinite(nextLat) || !Number.isFinite(nextLng)) return;
    marker.setPosition({ lat: nextLat, lng: nextLng });
  }, [driverCoords?.lat, driverCoords?.lng]);

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

  // Dunkler Grund, damit vor dem ersten Kartenbild kein heller Kasten steht.
  return <div ref={mapRef} className="w-full h-full relative bg-[#101112]" />;
};

export function RouteMapTop({ job, onBack, showBack = true, onDurationUpdate, openToken, sheetHeight }) {
  const { t, locale } = useI18n();
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
  const driverCoords = Number.isFinite(parsedDriverLat) && Number.isFinite(parsedDriverLng)
    ? { lat: parsedDriverLat, lng: parsedDriverLng }
    : null;
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

  return (
    <div className="absolute inset-0">
      <GoogleMapComponent
        origin={origin}
        destination={destination}
        driverCoords={driverCoords}
        fahrerNummer={job?.driverNumber}
        onDurationUpdate={onDurationUpdate}
        openToken={openToken}
        sheetHeight={sheetHeight}
        showApproachRoute={showApproachRoute}
        tripFromDriver={tripFromDriver}
        anfahrtStart={anfahrtStart}
        standortPunktZeigen={!vorherigesZiel}
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
          aria-label={t('fahrt.lastPushAria', { push: lastPushLabel, status: jobStatusLabel, source: sourceLabel })}
        >
          <div>{lastPushLabel}</div>
          <div className="mt-[2px] text-[#8f8f8f]">{jobStatusLabel}</div>
          <div className="mt-[2px] text-[#8f8f8f]">{sourceLabel}</div>
        </div>
      )}
    </div>
  );
}

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

export default function SoloNormal({ job, setView, onCancelRide, onEndRide, onSendRideNote }) {
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
  const mapOpenToken = job?.__openToken || job?.id || 'default';
  const [liveRouteDurationMins, setLiveRouteDurationMins] = useState(null);
  const jetztFuerEta = useJetzt();

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
  const etdTime = job?.etd || '--:--';
  const routeDurationMins = Number(
    (Number.isFinite(liveRouteDurationMins) && liveRouteDurationMins > 0)
      ? liveRouteDurationMins
      : (job?.extRouteDurationInTrafficMins || job?.extRouteDurationMins || 0),
  );
  const etaTime = berechneEta(job, routeDurationMins, jetztFuerEta) || addMinutesToTime(etdTime, routeDurationMins) || job?.eta || '--:--';
  const driveLabel = routeDurationMins > 0 ? t('fahrt.driveDuration', { duration: formatDuration(routeDurationMins) }) : t('fahrt.driveDurationUnknown');
  const guestNames = toUniqueNameList([
    ...(Array.isArray(job?.kolonneGuests) ? job.kolonneGuests : []),
    ...(Array.isArray(job?.passengers) ? job.passengers : []),
  ]);
  const visibleGuestNames = guestNames.length ? guestNames : [t('fahrt.noGuests')];
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
  const LOCATION_BLOCK_TOP = 289;
  const LOCATION_BLOCK_HEIGHT = 64;
  const LOCATION_TO_GUESTS_GAP_NO_MARKERS = 42;
  const SECTION_TITLE_TO_FIRST_ROW_GAP = 50;
  const LIST_ROW_HEIGHT = 51;
  const LIST_ROW_STEP = 57; // 51 row + 6 gap
  const GUEST_TO_NOTES_TITLE_GAP = 30;
  const NOTES_TITLE_TO_FIRST_NOTE_GAP = 64;
  const NOTE_ROW_STEP = 64;
  const NOTE_ROW_HEIGHT = 40; // 16(time/date) + 6(gap) + 18(text)
  const NOTES_TO_FIRST_ACTION_GAP = 54;
  const ACTION_BUTTON_STEP = 80; // 56 button + 24 gap
  const guestRowCount = visibleGuestNames.length;
  const hasMarkers = markerTypes.length > 0;
  const GUESTS_TITLE_TOP = hasMarkers
    ? 563 + AFTER_GUESTS_SHIFT
    : LOCATION_BLOCK_TOP + LOCATION_BLOCK_HEIGHT + LOCATION_TO_GUESTS_GAP_NO_MARKERS;
  const GUEST_ROW_TOP = GUESTS_TITLE_TOP + SECTION_TITLE_TO_FIRST_ROW_GAP;
  const guestLastRowBottom = GUEST_ROW_TOP + ((guestRowCount - 1) * LIST_ROW_STEP) + LIST_ROW_HEIGHT;

  const hasNotes = notes.length > 0;
  const NOTES_TITLE_TOP = guestLastRowBottom + GUEST_TO_NOTES_TITLE_GAP;
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

  const CONTENT_SHIFT_Y = 111; // ETD top(111) - shift = 0; plus 42px handle area => 42px from sheet top
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
            <div className="absolute inset-0 -translate-y-[111px]">
            {/* Unsichtbarer Anker fuer das Tutorial: umfasst ETD und ETA samt
                der Zeilen darueber und darunter. */}
            <div className="absolute left-[20px] top-[111px] text-[#868687] text-[12px] font-bold tracking-[-0.3px]" data-tutorial="etd-label">{t('fahrt.etd')}</div>
            <div className="absolute right-[20px] top-[111px] text-right text-[#868687] text-[12px] font-bold tracking-[-0.3px]" data-tutorial="eta-label">{t('fahrt.eta')}</div>
            <div className="absolute left-[20px] top-[129px] text-[#e2f754] text-[32px] leading-[0.88] font-bold tracking-[-1px]" data-tutorial="etd-zeit">{etdTime}</div>
            <div className="absolute right-[20px] top-[129px] text-right text-[#e2f754] text-[32px] leading-[0.88] font-bold tracking-[-1px]" data-tutorial="eta-zeit">{etaTime}</div>
            <div className="absolute right-[20px] top-[156px] text-right text-[#f4f5f4] text-[12px] font-bold tracking-[-0.5px] opacity-50" data-tutorial="eta-dauer">{driveLabel}</div>


            {markerTypes.length > 0 && (
              <div className="absolute left-[20px] top-[386px] flex items-center gap-[8px]">
                {markerTypes.map((type) => (
                  <MarkerIcon key={`marker-${type}`} type={type} />
                ))}
              </div>
            )}

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

            <div className="absolute left-[20px] text-[#e2f754] text-[32px] leading-[32px] font-bold tracking-[-1px]" style={{ top: `${GUESTS_TITLE_TOP}px` }} data-tutorial="gaeste">{t('fahrt.guests')}</div>
            {visibleGuestNames.map((name, idx) => (
              <div key={`guest-${idx}-${name}`} className="absolute left-[20px] right-[20px] h-[51px] bg-[#242425] px-[12px] flex items-center cursor-pointer" data-tutorial="gast" role="button" onClick={() => { if (guestNames.length) setShowAbholschild(true); }} style={{ top: `${GUEST_ROW_TOP + (idx * LIST_ROW_STEP)}px` }}>
                <span className="text-[#e2f754] text-[18px] font-bold tracking-[-0.5px]">{name}</span>
              </div>
            ))}

            {hasNotes && (
              <>
                <div className="absolute left-[20px] text-[#e2f754] text-[58px] leading-[52px] font-bold tracking-[-1px]" style={{ top: `${NOTES_TITLE_TOP}px` }} data-tutorial="notizen">{t('fahrt.note')}</div>
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

            <button type="button" onClick={openEndRideSheet} className="absolute left-[20px] right-[20px] h-[56px] bg-[#ff6f63] border-2 border-[#ff6f63] pl-[16px] pr-[12px] flex items-center justify-between" style={{ top: `${actionTop1}px` }} data-tutorial="fahrt-beenden">
              <span className="text-neutral-800 text-[16px] font-medium tracking-[0.5px]">{t('fahrt.endRide')}</span>
              <ArrowIcon />
            </button>
            <button type="button" onClick={openCancelSheet} className="absolute left-[20px] right-[20px] h-[56px] bg-[#e2f754] border-2 border-[#e2f754] pl-[16px] pr-[12px] flex items-center justify-between" style={{ top: `${actionTop2}px` }} data-tutorial="stornieren">
              <span className="text-neutral-800 text-[16px] font-medium tracking-[0.5px]">{t('fahrt.cancel')}</span>
              <ArrowIcon />
            </button>
            <button type="button" onClick={openNoteSendSheet} className="absolute left-[20px] right-[20px] h-[56px] bg-[#e2f754] border-2 border-[#e2f754] pl-[16px] pr-[12px] flex items-center justify-between" style={{ top: `${actionTop3}px` }} data-tutorial="notiz-senden">
              <span className="text-neutral-800 text-[16px] font-medium tracking-[0.5px]">{t('fahrt.rideNote')}</span>
              <ArrowIcon />
            </button>
            <button type="button" onClick={() => setView?.('ansprechpartnerDetails')} className="absolute left-[20px] right-[20px] h-[56px] border-2 border-[#e2f754] px-[16px] flex items-center justify-center" style={{ top: `${actionTop4}px` }} data-tutorial="support">
              <span className="text-[#e2f754] opacity-50 text-[16px] font-medium tracking-[0.5px]">{t('fahrt.support')}</span>
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
      
      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 0px; background: transparent; }
      `}</style>
    </div>
  );
}
