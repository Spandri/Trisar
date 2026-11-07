import { useEffect, useRef, useState } from 'react';

// Standort, von dem aus die Anfahrtsroute gerechnet wird. Er wandert nur mit, wenn der
// Fahrer deutlich weiter ist (ab minMeter) und seit der letzten Berechnung minSekunden
// vergangen sind. So folgt die gelbe Linie dem Auto, ohne bei jedem Tracker-Paket neu
// zu rechnen. Die Route kommt von OSRM (kostenlos), trotzdem kein Dauerfeuer.
const abstandMeter = (a, b) => {
  const r = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(h));
};

export const useRoutenStandort = (lat, lng, { minMeter = 80, minSekunden = 15 } = {}) => {
  const [standort, setStandort] = useState(null);
  const letzterRef = useRef({ punkt: null, zeit: 0 });
  const timerRef = useRef(null);

  useEffect(() => {
    const neu = { lat: Number(lat), lng: Number(lng) };
    if (!Number.isFinite(neu.lat) || !Number.isFinite(neu.lng)) return undefined;
    const uebernehmen = () => {
      letzterRef.current = { punkt: neu, zeit: Date.now() };
      setStandort(neu);
    };
    const { punkt, zeit } = letzterRef.current;
    if (!punkt) {
      uebernehmen();
      return undefined;
    }
    if (abstandMeter(punkt, neu) < minMeter) return undefined;
    const wartezeit = minSekunden * 1000 - (Date.now() - zeit);
    if (wartezeit <= 0) {
      uebernehmen();
      return undefined;
    }
    // Weit genug, aber zu frueh: nach Ablauf der Sperre nachziehen.
    window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(uebernehmen, wartezeit);
    return () => window.clearTimeout(timerRef.current);
  }, [lat, lng, minMeter, minSekunden]);

  return standort;
};
