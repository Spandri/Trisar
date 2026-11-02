import { useEffect, useMemo, useRef, useState } from 'react';
// Pin der Kolleginnen und Kollegen nach Figma (Trisar_App_01, Knoten 2557:11949):
// TRISAR-Lime mit weissem Rand und Stiel, darin die Fahrernummer — wie in der
// Dispo. Der blaue Kreis bleibt dem eigenen Standort vorbehalten.
const KOLLEGE_PIN_URL = '/icon/_Icon_Karte/Kollege_Pin_Trisar_01_lime.svg';
const PIN_BREITE = 35;
const PIN_HOEHE = 41.1367;

// Standorte der Kolleginnen und Kollegen in einer Kolonnenfahrt.
//
// Regel: Ein Fahrer sieht die Standorte der anderen Kolonnenfahrer ab
// 30 Minuten vor Fahrtbeginn, bis die Fahrt beendet ist — damit man sich
// absprechen kann. Ausserhalb dieses Fensters werden keine Standorte gezeigt.
//
// Hinweis fuer das Produkt: Hier wird nur die Anzeige gesteuert. Dass die
// Standorte ausserhalb des Fensters gar nicht erst beim Fahrer ankommen, muss
// die Datenbank regeln (Zugriffsregel auf driver_live_locations).

export const KOLLEGEN_VORLAUF_MIN = 30;

const BEENDET = new Set(['done', 'completed', 'arrived', 'beendet', 'cancelled', 'canceled', 'refused', 'storniert']);

const fahrtbeginn = (job) => {
  const datum = String(job?.rideDate || '').slice(0, 10);
  const zeit = String(job?.etd || '').match(/^(\d{1,2}):(\d{2})/);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datum) || !zeit) return null;
  const [j, m, t] = datum.split('-').map(Number);
  const beginn = new Date(j, m - 1, t, Number(zeit[1]), Number(zeit[2]), 0, 0);
  return Number.isNaN(beginn.getTime()) ? null : beginn.getTime();
};

export const kollegenFensterOffen = (job, jetzt = Date.now()) => {
  if (!job?.isKolonne) return false;
  if (BEENDET.has(String(job?.status || '').trim().toLowerCase())) return false;
  const beginn = fahrtbeginn(job);
  if (beginn == null) return false;
  return jetzt >= beginn - KOLLEGEN_VORLAUF_MIN * 60000;
};

// Uhr, die jede halbe Minute weiterschaltet — so oeffnet sich das Fenster
// auch, waehrend die Ansicht offen ist.
const useHalbminutenTakt = () => {
  const [jetzt, setJetzt] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setJetzt(Date.now()), 30000);
    return () => window.clearInterval(id);
  }, []);
  return jetzt;
};

// Kollegen mit Standort, sofern das Fenster offen ist; sonst leer.
export const useKollegenStandorte = (job) => {
  const jetzt = useHalbminutenTakt();
  const offen = kollegenFensterOffen(job, jetzt);
  const schluessel = offen
    ? (job?.kolonneDrivers || [])
      .filter((d) => d?.standort)
      .map((d) => `${d.id}:${d.standort.lat}:${d.standort.lng}`)
      .join('|')
    : '';
  return useMemo(() => {
    if (!offen) return [];
    return (job?.kolonneDrivers || [])
      .filter((d) => d?.standort && Number.isFinite(d.standort.lat) && Number.isFinite(d.standort.lng))
      .map((d) => ({ id: d.id, name: d.name, nummer: d.driverNumber, lat: d.standort.lat, lng: d.standort.lng }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schluessel]);
};

// Beschriftung im Pin: Fahrernummer (Space Grotesk Bold 15 px, #1a1a1a),
// ohne Nummer die Anfangsbuchstaben.
const beschriftung = (kollege) => {
  const nummer = kollege?.nummer == null ? '' : String(kollege.nummer).trim();
  if (nummer) return { text: nummer, color: '#1a1a1a', fontSize: '15px', fontWeight: '700' };
  const kuerzel = String(kollege?.name || '').split(/\s+/).filter(Boolean).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  return kuerzel ? { text: kuerzel, color: '#1a1a1a', fontSize: '13px', fontWeight: '700' } : undefined;
};

// Setzt die Marker der Kollegen auf die Karte und bezieht sie in den
// Kartenausschnitt ein. Laeuft neben dem Aufbau der Route, damit sich die
// Karte nicht neu aufbaut, wenn das Fenster aufgeht.
// abhaengig: Werte, bei denen die Ansicht ihre Karte neu aufbaut — dann
// muessen auch die Marker neu gesetzt werden.
export const useKollegenMarker = ({ mapInstanceRef, routeBoundsRef, kollegen, getFitPadding, sheetHeight, abhaengig = [] }) => {
  const markerRef = useRef([]);
  const kollegenRef = useRef(kollegen);
  kollegenRef.current = kollegen;

  useEffect(() => {
    let versuche = 0;
    let timer = null;
    const setzen = () => {
      const map = mapInstanceRef.current;
      if (!map || !window.trisarKarte) {
        if (versuche < 40) { versuche += 1; timer = window.setTimeout(setzen, 150); }
        return;
      }
      markerRef.current.forEach((m) => m.setMap(null));
      markerRef.current = kollegen.map((k) => new window.trisarKarte.Marker({
        position: { lat: k.lat, lng: k.lng },
        map,
        title: k.name,
        icon: {
          url: KOLLEGE_PIN_URL,
          scaledSize: new window.trisarKarte.Size(PIN_BREITE, PIN_HOEHE),
          // Der Pin steht mit der Spitze auf dem Standort.
          anchor: new window.trisarKarte.Point(PIN_BREITE / 2, PIN_HOEHE),
          labelOrigin: new window.trisarKarte.Point(PIN_BREITE / 2, 17.5),
        },
        label: beschriftung(k),
        zIndex: 305,
      }));
      const bounds = routeBoundsRef.current;
      if (kollegen.length && bounds && typeof bounds.extend === 'function') {
        kollegen.forEach((k) => bounds.extend({ lat: k.lat, lng: k.lng }));
        map.fitBounds(bounds, getFitPadding(sheetHeight));
      }
    };
    setzen();
    return () => {
      if (timer) window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kollegen, ...abhaengig]);

  useEffect(() => () => {
    markerRef.current.forEach((m) => m.setMap(null));
    markerRef.current = [];
  }, []);

  // Für den ersten Zuschnitt der Route: Kollegen gleich mit einbeziehen.
  return kollegenRef;
};
