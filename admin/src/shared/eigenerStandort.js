// Eigener Standort der Dispo (17.11.2026): solange die Seite offen ist und jemand zuschaut
// (Dispo-Karte, "Ankuenfte bei mir" mit Ort automatisch), laufend vom Browser geholt.
// Bleibt im Geraet. Auf der Karte als normaler blauer Standortpunkt.
import { useSyncExternalStore } from 'react';
import { DEMO_MODE } from '../datenquelle';

let stand = null; // { lat, lng, genau, zeit }
const hoerer = new Set();
let wacheId = null;

const melden = () => hoerer.forEach((fn) => fn());

const starten = () => {
  if (wacheId != null || DEMO_MODE || typeof navigator === 'undefined' || !navigator.geolocation) return;
  wacheId = navigator.geolocation.watchPosition(
    (pos) => {
      stand = {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        genau: Number.isFinite(pos.coords.accuracy) ? pos.coords.accuracy : null,
        zeit: Date.now(),
      };
      melden();
    },
    () => { /* ohne Erlaubnis bleibt der Punkt weg */ },
    { enableHighAccuracy: true, maximumAge: 15000, timeout: 30000 },
  );
};

const stoppen = () => {
  if (wacheId == null) return;
  navigator.geolocation.clearWatch(wacheId);
  wacheId = null;
};

export const standortAbonnieren = (fn) => {
  hoerer.add(fn);
  starten();
  return () => {
    hoerer.delete(fn);
    if (!hoerer.size) stoppen();
  };
};

export const eigenerStandort = () => stand;
export const useEigenerStandort = () => useSyncExternalStore(standortAbonnieren, () => stand);

// Luftlinie in Metern
export const abstandM = (a, b) => {
  const r = 6371000;
  const rad = (g) => (g * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(h));
};
