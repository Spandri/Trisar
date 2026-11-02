// Fahrt-Simulation: Tagesansicht eines KI-Vorschlags. Öffnet sich per Tipp auf
// eine Vorschlagskarte im KI Planer und spielt die geplante Route des Fahrers
// im Zeitraffer ab.
//
// Die Karte ist IMMER die echte TomTom-Karte mit den echten Straßenrouten
// (Geocoding + Routing + statisches Kartenbild, VITE_TOMTOM_API_KEY).
// Es gibt bewusst KEINEN schematischen Fallback: ohne Key oder bei einem
// API-Fehler zeigt die Fläche einen klaren Hinweis.

import { useEffect, useMemo, useRef, useState } from 'react';
import TrisarFooter from '../ui/TrisarFooter';
import { supabase } from '../../services/supabase';
import { useI18n } from '../../i18n';
import { hasTomTomKey, geocodeAddress, routeThrough } from '../../services/tomtomRoute';
import { findEvModel, percentUsed, fetchDayTemperature } from '../../services/evConsumption';
import { karteBereitstellen } from '../../shared/karte/maplibreKarte';

const TRISAR_LIME = '#e3f754';
// Die Karte ist eine echte, frei verschieb- und zoombare Karte wie in der
// Kartenansicht; die Routen darauf sind die echten TomTom-Strassenrouten.

// Farben und Pins wie auf der Dispo-Karte (KartenView): Fahrt mit Gast blau,
// Leerfahrt als gelb gestrichelte Anfahrt.
const ROUTE_BLAU = '#0059FF';
const LEER_GELB = '#E3F654';
const ZUSTAND_FARBE = { gast: '#FF6F63', leer: '#E3F654', laden: '#59BE80' };
// Rand beim Einpassen wie auf der Tageskarte: oben Knoepfe und Leisten, unten
// die Fahrerleiste ueber der Fusszeile.
const KARTEN_RAND = { top: 262, right: 32, bottom: 190, left: 32 };
const TEMPI = [1, 2, 4];
const PIN_BREITE = 35;
const PIN_HOEHE = 41.1367;
const STOPP_PIN_URL = '/icon/_Icon_Karte/Fahrer_Pin_Trisar_01_gruen.svg';
// Abholorte naeher als das zaehlen als ein Ort (ein Pin mit mehreren Nummern).
const GLEICHER_ORT_M = 40;

const abstandM = (a, b) => Math.hypot(
  (b.lat - a.lat) * 110574,
  (b.lon - a.lon) * 111320 * Math.cos((a.lat * Math.PI) / 180),
);

// Adresse wie auf den Vorschlagskarten: "Strasse Nr, PLZ".
const kurzeAdresse = (text) => {
  const teile = String(text || '').split(',').map((teil) => teil.trim()).filter(Boolean);
  const plzIndex = teile.findIndex((teil) => /^\d{5}\b/.test(teil));
  if (plzIndex > 0) return `${teile[plzIndex - 1]}, ${teile[plzIndex].slice(0, 5)}`;
  return teile.length ? teile[0] : '';
};

const clockToMin = (value) => {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(value || '').trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

const minToClock = (min) => {
  const m = Math.max(0, Math.round(min));
  return `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};


// Position auf einer Geo-Polylinie bei Anteil p (0..1), längenproportional.
const pointOnPolyline = (pts, p) => {
  if (!Array.isArray(pts) || pts.length === 0) return null;
  if (pts.length === 1) return pts[0];
  const dists = [0];
  for (let i = 1; i < pts.length; i += 1) {
    dists.push(dists[i - 1] + Math.hypot(pts[i].lon - pts[i - 1].lon, pts[i].lat - pts[i - 1].lat));
  }
  const total = dists[dists.length - 1];
  if (total <= 0) return pts[0];
  const ziel = Math.max(0, Math.min(1, p)) * total;
  for (let i = 1; i < pts.length; i += 1) {
    if (dists[i] >= ziel) {
      const f = (ziel - dists[i - 1]) / Math.max(1e-9, dists[i] - dists[i - 1]);
      return {
        lat: pts[i - 1].lat + (pts[i].lat - pts[i - 1].lat) * f,
        lon: pts[i - 1].lon + (pts[i].lon - pts[i - 1].lon) * f,
      };
    }
  }
  return pts[pts.length - 1];
};

export default function FahrtSimulationView({ entry, onClose }) {
  const { t, locale } = useI18n();
  const [phone, setPhone] = useState('');
  const [fahrerNummer, setFahrerNummer] = useState('');
  // Startet pausiert: erst auf Play laeuft die Simulation los.
  const [playing, setPlaying] = useState(false);
  // true, sobald die Simulation einmal lief (steuert Liste vs. Fahrtkarte).
  const [gestartet, setGestartet] = useState(false);
  // true, wenn die Route durchgelaufen ist — bleibt stehen statt neu zu starten.
  const [fertig, setFertig] = useState(false);
  const [speed, setSpeed] = useState(2);
  const [tempoPuls, setTempoPuls] = useState(0);
  const [simMin, setSimMin] = useState(() => clockToMin(entry?.start) ?? 360);
  const rafRef = useRef(null);
  const lastTsRef = useRef(null);
  const [dot, setDot] = useState(null);
  // Echte Karte (TomTom): { imageUrl, stations: [{x,y,art,label}], legs: [{art,pts,vonMin,bisMin}] }
  const [real, setReal] = useState(null);
  const mapRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const [mapReady, setMapReady] = useState(false);
  const overlaysRef = useRef([]);
  const fahrerMarkerRef = useRef(null);

  const dienstStart = clockToMin(entry?.start) ?? 360;
  const dienstEnd = clockToMin(entry?.end) ?? dienstStart + 480;

  useEffect(() => {
    let alive = true;
    (async () => {
      const res = await supabase.from('profiles').select('*').eq('id', entry?.driverId).maybeSingle?.()
        ?? await supabase.from('profiles').select('*').eq('id', entry?.driverId);
      const row = res?.data && !Array.isArray(res.data) ? res.data : (res?.data || [])[0];
      if (alive) {
        setPhone(String(row?.phone || '').trim());
        setFahrerNummer(row?.driver_number != null ? String(row.driver_number).trim() : '');
      }
    })();
    return () => { alive = false; };
  }, [entry?.driverId]);

  // Google-Karte laden (identische Mechanik wie in der Kartenansicht).
  useEffect(() => {
    let cancelled = false;

    const initMap = () => {
      if (cancelled || !window.trisarKarte || !mapRef.current || mapInstanceRef.current) return;
      mapInstanceRef.current = new window.trisarKarte.Map(mapRef.current, {
        center: { lat: 48.137154, lng: 11.576124 },
        zoom: 11,
        disableDefaultUI: true,
        clickableIcons: false,
        gestureHandling: 'greedy',
      });
      setMapReady(true);
    };

    // Die Kartenschicht steckt im Bundle, es wird nichts mehr nachgeladen.
    karteBereitstellen();
    initMap();

    return () => {
      cancelled = true;
      overlaysRef.current.forEach((o) => o.setMap(null));
      overlaysRef.current = [];
      fahrerMarkerRef.current?.setMap(null);
      fahrerMarkerRef.current = null;
      mapInstanceRef.current = null;
      setMapReady(false);
    };
  }, []);

  // Fahrzeugdaten fuer den Ladestand (nur relevant bei E-Fahrzeugen).
  const [vehicle, setVehicle] = useState(null);
  useEffect(() => {
    if (!entry?.vehicleId || !entry?.vehicleIsEv) { setVehicle(null); return undefined; }
    let alive = true;
    (async () => {
      const res = await supabase.from('vehicles').select('*');
      const row = (res?.data || []).find((v) => String(v?.id || '') === entry.vehicleId);
      if (alive) setVehicle(row || null);
    })();
    return () => { alive = false; };
  }, [entry?.vehicleId, entry?.vehicleIsEv]);

  // Aussentemperatur des Planungstags (Open-Meteo, ohne API-Schluessel) —
  // sie entscheidet zwischen Winter- und Sommerverbrauch.
  const [tempC, setTempC] = useState(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      const t = await fetchDayTemperature(entry?.dayIso);
      if (alive) setTempC(t);
    })();
    return () => { alive = false; };
  }, [entry?.dayIso]);

  // Fahrplan des Tages (zeitliche Wahrheit für Uhr, Balken, weisse Karte).
  const plan = useMemo(() => {
    const rides = (Array.isArray(entry?.rides) ? entry.rides : [])
      .map((ride, i) => ({
        nr: i + 1,
        etd: ride.etd,
        von: ride.pickup,
        nach: ride.dropoff,
        startMin: clockToMin(ride.etd),
        // Echte Fahrzeit der Fahrt; nur wenn keine hinterlegt ist, greift die
        // Annahme aus den Planungsregeln.
        endMin: (clockToMin(ride.etd) ?? 0)
          + (Number(ride.durationMinutes) || Number(entry?.rideDurationMinutes) || 80),
      }))
      .filter((r) => r.startMin != null)
      .sort((a, b) => a.startMin - b.startMin);

    const charge = (Array.isArray(entry?.chargeStops) ? entry.chargeStops : []).map((stop) => {
      const st = new Date(stop.start);
      const en = new Date(stop.end);
      return {
        startMin: st.getHours() * 60 + st.getMinutes(),
        endMin: en.getHours() * 60 + en.getMinutes(),
        station: String(stop.station_name || '').trim(),
        kmGained: Number(stop.km_gained || 0),
      };
    }).filter((c) => Number.isFinite(c.startMin) && Number.isFinite(c.endMin) && c.endMin > c.startMin);

    // Leerfahrtminuten = Luecken zwischen aufeinanderfolgenden Fahrten.
    let leerMinuten = 0;
    for (let i = 1; i < rides.length; i += 1) {
      leerMinuten += Math.max(0, rides[i].startMin - rides[i - 1].endMin);
    }
    // Ladezeit zaehlt nicht als Leerfahrt.
    charge.forEach((c) => { leerMinuten = Math.max(0, leerMinuten - (c.endMin - c.startMin)); });

    return { rides, charge, leerMinuten };
  }, [entry, dienstStart]);

  // Echte Karte laden: Geocoding aller Stationen, EIN Routing-Call über alle
  // Wegpunkte, Projektion auf das statische Kartenbild.
  useEffect(() => {
    if (!hasTomTomKey()) { setReal({ status: 'kein-key' }); return undefined; }
    if (plan.rides.length === 0) { setReal({ status: 'keine-fahrten' }); return undefined; }
    setReal({ status: 'laedt' });
    let alive = true;
    (async () => {
      try {
        // Nur Fahrten, deren BEIDE Orte aufloesbar sind, kommen auf die
        // Karte — ein einzelner unbekannter Ortsname bricht die Route nicht
        // mehr ab (die Fahrt bleibt im Zeitbalken sichtbar).
        const kartenFahrten = [];
        for (const ride of plan.rides) {
          // eslint-disable-next-line no-await-in-loop
          const von = await geocodeAddress(ride.von);
          // eslint-disable-next-line no-await-in-loop
          const nach = await geocodeAddress(ride.nach);
          if (von && nach) kartenFahrten.push({ ride, von, nach });
        }
        if (kartenFahrten.length === 0) { if (alive) setReal({ status: 'fehler' }); return; }
        const coords = [];
        kartenFahrten.forEach(({ ride, von, nach }) => {
          coords.push({ art: 'abhol', ride, ...von });
          coords.push({ art: 'ziel', ride, ...nach });
        });
        const legsLatLon = await routeThrough(coords);
        if (!legsLatLon || !alive) { if (alive) setReal({ status: 'fehler' }); return; }

        const allePunkte = legsLatLon.flatMap((l) => l.pts);

        // Zeitleiste STRENG SEQUENZIELL aus den echten TomTom-Fahrzeiten:
        // legs[i] verbindet coords[i] mit coords[i+1] (gerade i = Gastfahrt,
        // ungerade i = Leerfahrt zur naechsten Abholung). Die frueher
        // verwendete Pauschaldauer von 80 min ergab negative Leerfahrt-
        // Fenster — der Punkt sprang dann ohne Leerfahrt zur naechsten Fahrt.
        const legs = [];
        let cursor = kartenFahrten[0].ride.startMin;
        legsLatLon.forEach((leg, i) => {
          const rideIdx = Math.floor(i / 2);
          const gast = i % 2 === 0;
          const ride = kartenFahrten[rideIdx]?.ride;
          const next = kartenFahrten[rideIdx + 1]?.ride;
          if (gast && Number.isFinite(ride?.startMin)) cursor = Math.max(cursor, ride.startMin);
          const vonMin = cursor;
          const bisMin = vonMin + leg.minutes;
          legs.push({ art: gast ? 'gast' : 'leer', vonMin, bisMin, pts: leg.pts, km: leg.km || 0 });
          // Nach der Leerfahrt ggf. bis zur geplanten Abholzeit warten.
          cursor = !gast && Number.isFinite(next?.startMin) ? Math.max(bisMin, next.startMin) : bisMin;
        });

        const stations = coords
          .map((c, i) => ({ lat: c.lat, lon: c.lon, art: c.art, nr: c.ride.nr, key: i }))
          .filter((st) => st.art === 'abhol');

        if (alive) setReal({ status: 'ok', legs, stations, allePunkte, endeMin: legs[legs.length - 1]?.bisMin ?? null });
      } catch {
        if (alive) setReal({ status: 'fehler' });
      }
    })();
    return () => { alive = false; };
  }, [plan]);

  // Zeitfenster der Simulation: erste Abholung bis Ende der echten Route,
  // sonst der geplante Dienst.
  const simStart = real?.status === 'ok' && real.legs.length ? real.legs[0].vonMin : dienstStart;
  const simEnde = real?.status === 'ok' && real.endeMin != null
    ? Math.max(real.endeMin, simStart + 30)
    : dienstEnd;

  // Simulationsuhr.
  useEffect(() => {
    if (!playing) { lastTsRef.current = null; return undefined; }
    const tick = (ts) => {
      rafRef.current = null;
      if (lastTsRef.current == null) lastTsRef.current = ts;
      const dt = Math.min(0.5, (ts - lastTsRef.current) / 1000);
      lastTsRef.current = ts;
      setSimMin((prev) => {
        // 1x = 6 Sim-Minuten pro Sekunde (halbes Tempo der frueheren Stufe),
        // 2x entspricht dem frueheren 1x, 4x ist doppelt so schnell.
        const next = prev + dt * 6 * speed;
        if (next >= simEnde) {
          // Ende der Route: stehenbleiben, nicht neu starten.
          setPlaying(false);
          setFertig(true);
          return simEnde;
        }
        return next;
      });
      if (document.visibilityState !== 'hidden') rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    // Im verdeckten Fenster laufen keine Bilder — dann im Takt weiter, wie auf
    // der Tageskarte.
    const takt = window.setInterval(() => {
      if (document.visibilityState === 'hidden') tick(performance.now());
      else if (rafRef.current == null) rafRef.current = requestAnimationFrame(tick);
    }, 250);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      window.clearInterval(takt);
      lastTsRef.current = null;
    };
  }, [playing, speed, simStart, simEnde]);

  // Ganze Tagesroute auf die Karte zeichnen — Abschnitt fuer Abschnitt, von
  // Abholort zu Abholort — und den Ausschnitt auf den ganzen Tag einpassen.
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!mapReady || !map || real?.status !== 'ok') return;
    overlaysRef.current.forEach((o) => o.setMap(null));
    overlaysRef.current = [];

    real.legs.forEach((leg) => {
      const gast = leg.art === 'gast';
      const linie = new window.trisarKarte.Polyline({
        path: leg.pts.map((p) => ({ lat: p.lat, lng: p.lon })),
        map,
        strokeColor: gast ? ROUTE_BLAU : LEER_GELB,
        strokeOpacity: gast ? 0.9 : 0,
        strokeWeight: gast ? 6 : 5,
        icons: gast ? undefined : [{
          icon: { path: 'M 0,-1 0,1', strokeOpacity: 1, scale: 4, strokeColor: LEER_GELB },
          offset: '0',
          repeat: '12px',
        }],
        zIndex: gast ? 302 : 301,
      });
      overlaysRef.current.push(linie);
    });

    // Gruene Pins mit der Fahrtnummer. Mehrere Abholungen am selben Ort teilen
    // sich einen Pin ("1/3"), statt sich gegenseitig zu verdecken.
    const orte = [];
    real.stations.forEach((st) => {
      const ort = orte.find((o) => abstandM(o, st) <= GLEICHER_ORT_M);
      if (ort) ort.nummern.push(st.nr);
      else orte.push({ lat: st.lat, lon: st.lon, nummern: [st.nr] });
    });
    orte.forEach((ort, i) => {
      const text = ort.nummern.join('/');
      const marker = new window.trisarKarte.Marker({
        position: { lat: ort.lat, lng: ort.lon },
        map,
        zIndex: 320 + (orte.length - i),
        icon: {
          url: STOPP_PIN_URL,
          scaledSize: new window.trisarKarte.Size(PIN_BREITE, PIN_HOEHE),
          anchor: new window.trisarKarte.Point(PIN_BREITE / 2, PIN_HOEHE),
          labelOrigin: new window.trisarKarte.Point(PIN_BREITE / 2, PIN_BREITE / 2),
        },
        label: { text, color: '#1A1A1A', fontSize: text.length > 3 ? '11px' : '15px', fontWeight: '700' },
      });
      overlaysRef.current.push(marker);
    });

    const bounds = new window.trisarKarte.LatLngBounds();
    real.allePunkte.forEach((p) => bounds.extend({ lat: p.lat, lng: p.lon }));
    // Oben Platz fuer Legende und Pins, die ueber ihrem Punkt stehen.
    if (!bounds.isEmpty()) map.fitBounds(bounds, KARTEN_RAND);
  }, [mapReady, real]);

  // Kamera folgt der Simulation: vor dem Start und nach dem Ende der ganze Tag,
  // waehrend des Laufs die aktuelle Fahrt samt Leerfahrt zur naechsten
  // Abholung. Eine lange Fahrt ins Umland zoomt heraus, kurze Fahrten im
  // Zentrum zoomen hinein — so bleibt jede Fahrt erkennbar.
  const KAMERA_MS = 1400;
  const kameraZiel = useMemo(() => {
    if (real?.status !== 'ok' || !real.legs.length) return null;
    if (!gestartet || fertig) return 'tag';
    let idx = real.legs.findIndex((l) => simMin >= l.vonMin && simMin <= l.bisMin);
    if (idx < 0) idx = real.legs.findIndex((l) => simMin < l.vonMin);
    if (idx < 0) idx = real.legs.length - 1;
    // Gerade Abschnitte sind Fahrten mit Gast, der ungerade danach die Leerfahrt.
    return Math.floor(idx / 2);
  }, [real, gestartet, fertig, simMin]);

  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!mapReady || !map || kameraZiel == null || real?.status !== 'ok') return;
    const punkte = kameraZiel === 'tag'
      ? real.allePunkte
      : [...(real.legs[kameraZiel * 2]?.pts || []), ...(real.legs[kameraZiel * 2 + 1]?.pts || [])];
    if (!punkte.length) return;
    const bounds = new window.trisarKarte.LatLngBounds();
    punkte.forEach((p) => bounds.extend({ lat: p.lat, lng: p.lon }));
    const ecken = bounds.alsEcken?.();
    if (map.karte && ecken) {
      // Laenger und ruhiger als die Standardfahrt der Karte.
      map.karte.fitBounds(ecken, { padding: KARTEN_RAND, duration: KAMERA_MS, maxZoom: 14.5, essential: true });
    } else {
      map.fitBounds(bounds, KARTEN_RAND);
    }
  }, [kameraZiel, mapReady, real]);

  // Fahrer als Punkt mit seiner Nummer, in der Farbe der Dispo-Karte: rot mit
  // Gast, gelb auf Leerfahrt, gruen beim Laden. Folgt der Simulationszeit.
  const fahrerZustand = useMemo(() => {
    if (plan.charge.some((c) => simMin >= c.startMin && simMin <= c.endMin)) return 'laden';
    if (real?.status !== 'ok') return 'leer';
    const leg = real.legs.find((l) => simMin >= l.vonMin && simMin <= l.bisMin);
    return leg?.art === 'gast' ? 'gast' : 'leer';
  }, [simMin, plan.charge, real]);

  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!mapReady || !map) return;
    if (!dot) { fahrerMarkerRef.current?.setMap(null); return; }
    const icon = fahrerZustand === 'leer'
      ? {
        // Fuer Gelb gibt es keinen eigenen Punkt: Kreis des gelben Pins, Spitze abgeschnitten.
        url: '/icon/_Icon_Karte/Fahrer_Pin_Trisar_01_gelb.svg',
        scaledSize: new window.trisarKarte.Size(PIN_BREITE, PIN_HOEHE),
        ausschnitt: new window.trisarKarte.Size(PIN_BREITE, PIN_BREITE),
        anchor: new window.trisarKarte.Point(PIN_BREITE / 2, PIN_BREITE / 2),
        labelOrigin: new window.trisarKarte.Point(PIN_BREITE / 2, PIN_BREITE / 2),
      }
      : {
        url: fahrerZustand === 'laden' ? '/icon/_Icon_Karte/Fahrer_Punkt_Trisar_01_gruen.svg' : '/icon/_Icon_Karte/Fahrer_Punkt_Trisar_01_rot.svg',
        scaledSize: new window.trisarKarte.Size(PIN_BREITE, PIN_BREITE),
        anchor: new window.trisarKarte.Point(PIN_BREITE / 2, PIN_BREITE / 2),
        labelOrigin: new window.trisarKarte.Point(PIN_BREITE / 2, PIN_BREITE / 2),
      };
    const label = { text: fahrerNummer || '•', color: '#1A1A1A', fontSize: '15px', fontWeight: '700' };
    if (!fahrerMarkerRef.current) {
      fahrerMarkerRef.current = new window.trisarKarte.Marker({ map, zIndex: 400, icon, label });
      fahrerMarkerRef.current.zustand = fahrerZustand;
    } else if (fahrerMarkerRef.current.zustand !== fahrerZustand) {
      fahrerMarkerRef.current.setIcon(icon);
      fahrerMarkerRef.current.zustand = fahrerZustand;
    }
    if (fahrerMarkerRef.current.labelText !== label.text) {
      fahrerMarkerRef.current.setLabel(label);
      fahrerMarkerRef.current.labelText = label.text;
    }
    fahrerMarkerRef.current.setMap(map);
    fahrerMarkerRef.current.setPosition({ lat: dot.lat, lng: dot.lon });
  }, [dot, mapReady, fahrerZustand, fahrerNummer]);

  // Sobald die echte Route steht, startet die Uhr an ihrem Anfang.
  useEffect(() => {
    if (real?.status === 'ok' && real.legs.length) {
      setSimMin(real.legs[0].vonMin);
      setGestartet(false);
      setFertig(false);
      setPlaying(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [real]);

  // Wie die Tageskarte: sobald die Route steht, laeuft die Simulation kurz
  // danach von selbst los.
  useEffect(() => {
    if (real?.status !== 'ok' || !real.legs.length) return undefined;
    const timer = window.setTimeout(() => { setGestartet(true); setPlaying(true); }, 900);
    return () => window.clearTimeout(timer);
  }, [real]);

  // Fahrerpunkt: echte Karte -> Interpolation auf der Strassen-Polylinie;
  // Fallback -> Punkt auf dem SVG-Segment.
  useEffect(() => {
    if (real?.status === 'ok') {
      const legs = real.legs;
      let active = legs.findIndex((l) => simMin >= l.vonMin && simMin <= l.bisMin);
      if (active < 0) active = legs.findIndex((l) => simMin < l.vonMin);
      if (active < 0) active = legs.length - 1;
      const leg = legs[active];
      if (!leg) { setDot(null); return; }
      const span = Math.max(1, leg.bisMin - leg.vonMin);
      const p = Math.max(0, Math.min(1, (simMin - leg.vonMin) / span));
      setDot(pointOnPolyline(leg.pts, p));
      return;
    }
    setDot(null);
  }, [simMin, plan, real]);

  const aktiv = useMemo(() => {
    const laden = plan.charge.find((c) => simMin >= c.startMin && simMin <= c.endMin);
    if (laden) return { art: 'laden', laden };
    if (real?.status === 'ok') {
      // Legs alternieren: gerade = Gastfahrt k, ungerade = Leerfahrt danach.
      const idx = real.legs.findIndex((l) => simMin >= l.vonMin && simMin <= l.bisMin);
      const leg = real.legs[idx];
      if (leg?.art === 'gast') {
        const fahrt = plan.rides[Math.floor(idx / 2)];
        if (fahrt) return { art: 'gast', fahrt, vonMin: leg.vonMin, bisMin: leg.bisMin };
      }
      return { art: 'leer' };
    }
    const fahrt = plan.rides.find((r) => simMin >= r.startMin && simMin <= r.endMin);
    if (fahrt) return { art: 'gast', fahrt, vonMin: fahrt.startMin, bisMin: fahrt.endMin };
    return { art: 'leer' };
  }, [simMin, plan, real]);

  // Zeitleiste von der ersten Abholung bis zum Ende der Route.
  const spanne = Math.max(1, simEnde - simStart);
  const anteilBei = (m) => Math.max(0, Math.min(1, (m - simStart) / spanne));
  const fahrtStriche = plan.rides.map((r) => anteilBei(r.startMin));

  // Ladestand beim Start jeder Fahrt: vom Startwert des Fahrzeugs ausgehend
  // die echten Streckenkilometer der bis dahin gefahrenen Abschnitte auf die
  // Reichweite umlegen; Ladestopps schreiben ihre gewonnenen km gut.
  const ladestaende = useMemo(() => {
    if (!entry?.vehicleIsEv || real?.status !== 'ok' || !vehicle) return null;
    const modell = findEvModel(vehicle.brand_model, vehicle.trim);
    if (!modell) return null;
    const start = Number.isFinite(Number(vehicle.battery_fuel_percent)) ? Number(vehicle.battery_fuel_percent) : 100;
    const werte = [];
    let prozent = start;
    real.legs.forEach((leg, i) => {
      if (leg.art === 'gast') werte[Math.floor(i / 2)] = Math.max(0, Math.min(100, Math.round(prozent)));
      // Verbrauch nach ev-database.org: Stadt/Autobahn nach Durchschnitts-
      // tempo des Abschnitts, Winter/Sommer nach Aussentemperatur.
      prozent -= percentUsed(modell, tempC, leg.km || 0, leg.bisMin - leg.vonMin);
      plan.charge.forEach((c) => {
        if (c.endMin > leg.vonMin && c.endMin <= leg.bisMin) {
          const gewonnenKm = Number(c.kmGained || 0);
          // Nachgeladene km ueber denselben Verbrauch in Prozent umrechnen.
          const zuwachs = gewonnenKm > 0
            ? percentUsed(modell, tempC, gewonnenKm, (gewonnenKm / 60) * 60)
            : 40;
          prozent = Math.min(100, prozent + zuwachs);
        }
      });
    });
    return werte;
  }, [entry?.vehicleIsEv, real, vehicle, plan.charge, tempC]);

  const ladeFarbe = (p) => (p >= 40 ? '#2e8b45' : (p >= 20 ? '#c07a10' : '#c0392b'));

  // Zeitleiste per Ziehen steuern: Pointer irgendwo auf der Spur setzt die
  // Simulationszeit; waehrend des Ziehens pausiert die Uhr und laeuft danach
  // im vorherigen Zustand weiter.
  const spurRef = useRef(null);
  const ziehZustandRef = useRef(null);

  const zeitAusPointer = (clientX) => {
    const box = spurRef.current?.getBoundingClientRect();
    if (!box || box.width <= 0) return null;
    const anteil = Math.max(0, Math.min(1, (clientX - box.left) / box.width));
    return simStart + anteil * (simEnde - simStart);
  };

  const startZiehen = (e) => {
    const zeit = zeitAusPointer(e.clientX);
    if (zeit == null) return;
    // Pointer-Capture ist nur Komfort (Ziehen ausserhalb der Spur) — schlaegt
    // es fehl, darf das den Regler nicht blockieren.
    try { e.currentTarget.setPointerCapture?.(e.pointerId); } catch { /* egal */ }
    ziehZustandRef.current = { liefVorher: playing };
    setPlaying(false);
    setGestartet(true);
    setFertig(false);
    setSimMin(zeit);
  };

  const beimZiehen = (e) => {
    if (!ziehZustandRef.current) return;
    const zeit = zeitAusPointer(e.clientX);
    if (zeit != null) setSimMin(zeit);
  };

  const endeZiehen = (e) => {
    if (!ziehZustandRef.current) return;
    try { e.currentTarget.releasePointerCapture?.(e.pointerId); } catch { /* egal */ }
    const { liefVorher } = ziehZustandRef.current;
    ziehZustandRef.current = null;
    if (liefVorher) setPlaying(true);
  };


  // Datum wie auf der Tageskarte: "Do. 17. Sept."
  const datumLabel = useMemo(() => {
    const d = entry?.dayIso ? new Date(`${entry.dayIso}T12:00:00`) : null;
    return d ? new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', month: 'short' }).format(d) : '';
  }, [entry?.dayIso, locale]);

  // Kennzahlen des Tages aus der echten Route (km, Leerfahrtminuten).
  const kmGesamt = real?.status === 'ok'
    ? Math.round(real.legs.reduce((sum, l) => sum + (l.km || 0), 0))
    : entry?.shiftKm;
  const leerGesamt = real?.status === 'ok'
    ? Math.round(real.legs.filter((l) => l.art === 'leer').reduce((sum, l) => sum + (l.bisMin - l.vonMin), 0))
    : plan.leerMinuten;
  // Bis jetzt gefahrene Kilometer (wie die km-Anzeige der Tageskarte).
  const kmBisher = real?.status === 'ok'
    ? real.legs.reduce((sum, l) => {
      if (simMin >= l.bisMin) return sum + (l.km || 0);
      if (simMin <= l.vonMin) return sum;
      return sum + (l.km || 0) * ((simMin - l.vonMin) / Math.max(1, l.bisMin - l.vonMin));
    }, 0)
    : 0;
  const kmText = (km) => `${new Intl.NumberFormat('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(km)} km`;

  // Was der Fahrer gerade tut — Zeile unter dem Namen wie auf der Tageskarte.
  const naechsteFahrt = plan.rides.find((r) => r.startMin >= simMin) || null;
  const aktivIndex = aktiv.art === 'gast' ? plan.rides.indexOf(aktiv.fahrt) : -1;
  const ladestandJetzt = !fertig && aktivIndex >= 0 ? ladestaende?.[aktivIndex] : null;

  const tempoWechseln = () => {
    setSpeed((alt) => TEMPI[(TEMPI.indexOf(alt) + 1) % TEMPI.length]);
    setTempoPuls((n) => n + 1);
  };

  return (
    <div className="fixed inset-0 z-[260] flex justify-center bg-black">
      {/* Aufbau wie die Tageskarte der Einsatzplanung: Karte ueber den ganzen
          Bildschirm, darauf Zurueck, Datum, Zeitleiste und Fahrerleisten. */}
      <div className="w-[min(402px,100vw)] h-dvh relative overflow-hidden overscroll-none" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>
        <div ref={mapRef} className="absolute inset-0" />

        <button
          type="button"
          onClick={onClose}
          aria-label={t('karten.back')}
          className="absolute top-[60px] left-[20px] z-20 w-[50px] h-[50px] touch-none select-none"
        >
          <span className="block w-[50px] h-[50px] rounded-full bg-black overflow-hidden">
            <img src="/icon/_Icon_Karte/Backbutton_Karte.svg?v=2" alt="" className="w-[50px] h-[50px] object-contain" />
          </span>
        </button>

        <div className="absolute top-[60px] right-[20px] z-20 h-[50px] px-[18px] rounded-full bg-black flex items-center">
          <span className="text-[16px] font-bold leading-none tracking-[0.5px] whitespace-nowrap" style={{ color: TRISAR_LIME }}>{datumLabel}</span>
        </div>

        {/* Zeitleiste */}
        <div className="absolute left-1/2 -translate-x-1/2 top-[142px] z-20 w-[362px] h-11 bg-black rounded-xl pl-[8px] pr-[6px] flex items-center">
          <button
            type="button"
            onClick={() => {
              if (fertig) {
                // Nach dem Durchlauf startet Play die Simulation neu.
                setSimMin(simStart);
                setFertig(false);
              }
              setGestartet(true);
              setPlaying((p) => !p);
            }}
            disabled={real?.status !== 'ok'}
            aria-label={playing ? t('sim.pause') : t('sim.play')}
            className="w-[32px] h-[32px] flex items-center justify-center shrink-0 disabled:opacity-30"
          >
            {playing ? (
              <svg viewBox="0 0 14 16" className="w-[12px] h-[14px]" fill={TRISAR_LIME}><rect x="1" y="0" width="4" height="16" rx="1" /><rect x="9" y="0" width="4" height="16" rx="1" /></svg>
            ) : fertig ? (
              <svg viewBox="0 0 18 18" className="w-[16px] h-[16px]" fill="none" stroke={TRISAR_LIME} strokeWidth="2.4" strokeLinecap="round"><path d="M3.5 9a5.5 5.5 0 1 0 1.9-4.2" /><path d="M2.8 2.5v3.6h3.6" /></svg>
            ) : (
              <svg viewBox="0 0 14 16" className="w-[12px] h-[14px] ml-[2px]" fill={TRISAR_LIME}><path d="M1.5 1.2v13.6a.8.8 0 0 0 1.2.7l10.6-6.8a.8.8 0 0 0 0-1.4L2.7.5a.8.8 0 0 0-1.2.7z" /></svg>
            )}
          </button>

          <span className="w-[54px] shrink-0 text-white text-base leading-none font-bold tabular-nums">{minToClock(simMin)}</span>

          <div
            ref={spurRef}
            onPointerDown={startZiehen}
            onPointerMove={beimZiehen}
            onPointerUp={endeZiehen}
            onPointerCancel={endeZiehen}
            role="slider"
            tabIndex={0}
            aria-label={t('sim.scrubAria')}
            aria-valuemin={Math.round(simStart)}
            aria-valuemax={Math.round(simEnde)}
            aria-valuenow={Math.round(simMin)}
            aria-valuetext={minToClock(simMin)}
            onKeyDown={(e) => {
              const schritt = e.shiftKey ? 30 : 5;
              if (e.key === 'ArrowLeft') { setPlaying(false); setGestartet(true); setSimMin((v) => Math.max(simStart, v - schritt)); }
              if (e.key === 'ArrowRight') { setPlaying(false); setGestartet(true); setFertig(false); setSimMin((v) => Math.min(simEnde, v + schritt)); }
            }}
            className="relative flex-1 h-full mx-[8px] cursor-ew-resize touch-none select-none"
          >
            <span className="absolute left-0 right-0 top-1/2 -translate-y-1/2 h-[2px] rounded-full bg-white/20" />
            {fahrtStriche.map((x, i) => (
              <span
                key={`strich-${i}`}
                className="absolute top-1/2 w-px h-[8px] -translate-y-1/2 bg-white/25 pointer-events-none"
                style={{ left: `${x * 100}%` }}
              />
            ))}
            <span
              className="absolute left-0 right-0 top-1/2 -translate-y-1/2 h-[2px] rounded-full origin-left pointer-events-none"
              style={{ background: TRISAR_LIME, transform: `scaleX(${anteilBei(simMin)})` }}
            />
            <span
              className="absolute top-1/2 w-3 h-3 -translate-x-1/2 -translate-y-1/2 rounded-full border border-[#202020] pointer-events-none"
              style={{ left: `${anteilBei(simMin) * 100}%`, background: TRISAR_LIME, boxShadow: '0 0 0 3px rgba(227,246,84,0.18)' }}
            />
          </div>

          <button
            type="button"
            onClick={tempoWechseln}
            aria-label={t('planer.dayMapSpeed', { n: speed })}
            className="w-[40px] h-[32px] shrink-0 flex items-center justify-center"
          >
            <span key={tempoPuls} className="text-base leading-none font-bold tabular-nums tageskarte-tempo" style={{ color: TRISAR_LIME }}>
              {`${speed}x`}
            </span>
          </button>
        </div>

        {/* Was der Fahrer gerade tut, mit den bisher gefahrenen Kilometern */}
        {real?.status === 'ok' ? (
          <div className="absolute left-1/2 -translate-x-1/2 top-[194px] z-20 w-[362px] bg-black rounded-xl px-[16px] pt-[14px] pb-[12px]">
            <div className="flex items-center gap-[10px]">
              <span
                className="w-3 h-3 rounded-full border border-[#202020] shrink-0"
                style={{ backgroundColor: ZUSTAND_FARBE[fahrerZustand], transition: 'background-color 300ms ease' }}
              />
              <span className="min-w-0 text-white text-base leading-none font-bold truncate">
                {fertig ? t('sim.finishedShort')
                  : aktiv.art === 'gast' ? `#${aktiv.fahrt.nr} ${minToClock(aktiv.vonMin ?? aktiv.fahrt.startMin)} – ${minToClock(aktiv.bisMin ?? aktiv.fahrt.endMin)}`
                  : aktiv.art === 'laden' ? (entry?.vehicleIsEv ? t('sim.charging') : t('sim.refueling'))
                  : naechsteFahrt ? `${t('planer.dayMapOnTheWay')} #${naechsteFahrt.nr}`
                  : t('planer.dayMapFree')}
              </span>
              {ladestandJetzt != null ? (
                <span className="shrink-0 text-[13px] leading-none font-bold tabular-nums" style={{ color: ladeFarbe(ladestandJetzt) }}>{`${ladestandJetzt} %`}</span>
              ) : null}
              <span className="ml-auto shrink-0 text-base leading-none font-bold tabular-nums" style={{ color: TRISAR_LIME }}>{kmText(kmBisher)}</span>
            </div>
            <p className="mt-[8px] pl-[22px] text-[13px] leading-[18px] text-white/60 truncate">
              {fertig ? `${plan.rides.length} ${t('sim.kpiRides')} · ${leerGesamt} ${t('sim.kpiEmpty')}`
                : aktiv.art === 'gast' ? `${kurzeAdresse(aktiv.fahrt.von) || aktiv.fahrt.von} – ${kurzeAdresse(aktiv.fahrt.nach) || aktiv.fahrt.nach}`
                : aktiv.art === 'laden' ? (aktiv.laden.station || '')
                : naechsteFahrt ? (
                  <>
                    <span className="font-bold text-white">{t('planer.dayMapClock', { zeit: naechsteFahrt.etd })}</span>
                    {` · ${kurzeAdresse(naechsteFahrt.von) || naechsteFahrt.von}`}
                  </>
                )
                : t('sim.standby')}
            </p>
          </div>
        ) : (
          <div className="absolute left-1/2 -translate-x-1/2 top-[194px] z-20 w-[362px] min-h-11 bg-black rounded-xl px-[16px] py-[12px] flex items-center justify-center">
            <span className="text-[13px] font-medium tracking-[0.5px] text-center" style={{ color: TRISAR_LIME }}>
              {real?.status === 'laedt' || !real ? t('sim.mapLoading')
                : real?.status === 'kein-key' ? t('sim.mapNoKey')
                : real?.status === 'keine-fahrten' ? t('sim.mapNoRides')
                : t('sim.mapError')}
            </span>
          </div>
        )}

        {/* Fahrer ganz unten, ueber der Fusszeile */}
        <div className="absolute left-1/2 -translate-x-1/2 bottom-[60px] z-20 w-[362px] bg-black rounded-xl px-[16px] pt-[14px] pb-[13px]">
          <div className="flex items-center gap-[10px]">
            <span className="min-w-0 text-white text-[20px] leading-[22px] font-bold truncate">
              {fahrerNummer ? <span style={{ color: TRISAR_LIME }}>{`${fahrerNummer} `}</span> : null}
              {entry?.name}
            </span>
            {phone ? (
              <a
                href={`tel:${phone.replace(/[\s()-]/g, '')}`}
                className="ml-auto shrink-0 text-[14px] leading-none font-bold tabular-nums"
                style={{ color: TRISAR_LIME }}
              >
                {phone}
              </a>
            ) : null}
          </div>
          <p className="mt-[8px] text-[13px] leading-[18px] text-white/60 truncate">
            {t('sim.serviceLine')} <span className="font-bold text-white">{entry?.start} – {entry?.end}</span>
            {entry?.vehicleLabel ? ` · ${entry.vehicleLabel}` : ''}
          </p>
          <p className="mt-[2px] text-[13px] leading-[18px] text-white/60 truncate">
            <span className="font-bold text-white tabular-nums">{plan.rides.length}</span>{` ${t('sim.kpiRides')} · `}
            {kmGesamt != null ? <><span className="font-bold text-white tabular-nums">{kmGesamt}</span>{' km · '}</> : null}
            <span className="font-bold text-white tabular-nums">{leerGesamt}</span>{` ${t('sim.kpiEmpty')} · `}
            <span className="font-bold text-white tabular-nums">{`${plan.charge.length}×`}</span>{` ${entry?.vehicleIsEv ? t('sim.kpiCharge') : t('sim.kpiRefuel')}`}
          </p>
        </div>

        <TrisarFooter className="absolute left-0 right-0 bottom-0 h-10 bg-black z-[30]" />
      </div>
    </div>
  );
}
