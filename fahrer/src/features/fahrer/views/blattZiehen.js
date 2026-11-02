// Das Infoblatt der Fahrtansichten wird mit dem Finger hochgezogen.
//
// Frueher lag die Hoehe in einem useState und wurde bei jeder Mausbewegung neu
// gesetzt. Das zeichnet die ganze Ansicht (ueber tausend Zeilen Aufbau) je Bild
// neu, und beim schnellen Ziehen bleibt das Blatt hinter dem Finger zurueck.
// Jetzt laeuft das Ziehen an React vorbei: die Hoehe wird einmal je Bild direkt
// an den Elementen gesetzt. Neu gezeichnet wird erst beim Loslassen, wenn das
// Blatt auf eine der drei Stufen einrastet.
import { useCallback, useEffect, useRef, useState } from 'react';

export const BLATT_UNTEN = 25;
export const BLATT_MITTE = 50;
export const BLATT_OBEN = 85;

export function useBlattZiehen(startHoehe = BLATT_MITTE) {
  // Eingerastete Hoehe. Sie loest das Neuzeichnen aus und geht an die Karte,
  // damit die den Routenausschnitt ueber dem Blatt ausrichtet.
  const [hoehe, setHoehe] = useState(startHoehe);
  const [zieht, setZieht] = useState(false);

  const blattRef = useRef(null);
  const feldRef = useRef(null);
  const scrollRef = useRef(null);

  const hoeheRef = useRef(startHoehe);
  const startY = useRef(0);
  const startHoeheRef = useRef(startHoehe);
  const bildRef = useRef(0);
  const ziehtRef = useRef(false);
  const inhaltStartY = useRef(0);
  const inhaltObenRef = useRef(false);

  const malen = useCallback(() => {
    bildRef.current = 0;
    const wert = `${hoeheRef.current}%`;
    if (blattRef.current) blattRef.current.style.height = wert;
    if (feldRef.current) feldRef.current.style.bottom = wert;
  }, []);

  const hoeheSetzen = useCallback((wert) => {
    hoeheRef.current = Math.min(Math.max(wert, BLATT_UNTEN), BLATT_OBEN);
    if (!bildRef.current) bildRef.current = requestAnimationFrame(malen);
  }, [malen]);

  const ausZeigerHoehe = useCallback((clientY) => {
    const strecke = startY.current - clientY;
    hoeheSetzen(startHoeheRef.current + (strecke / window.innerHeight) * 100);
  }, [hoeheSetzen]);

  const ziehBeginnen = useCallback((clientY) => {
    if (!Number.isFinite(clientY)) return;
    ziehtRef.current = true;
    setZieht(true);
    startY.current = clientY;
    startHoeheRef.current = hoeheRef.current;
  }, []);

  const ziehStart = useCallback((e) => {
    ziehBeginnen(e.touches ? e.touches[0]?.clientY : e.clientY);
  }, [ziehBeginnen]);

  const ziehBewegung = useCallback((e) => {
    if (!ziehtRef.current) return;
    const y = e.touches ? e.touches[0]?.clientY : e.clientY;
    if (!Number.isFinite(y)) return;
    ausZeigerHoehe(y);
  }, [ausZeigerHoehe]);

  const ziehEnde = useCallback(() => {
    if (!ziehtRef.current) return;
    ziehtRef.current = false;
    inhaltObenRef.current = false;
    setZieht(false);
    const jetzt = hoeheRef.current;
    const ziel = jetzt > 70 ? BLATT_OBEN : (jetzt < 40 ? BLATT_UNTEN : BLATT_MITTE);
    hoeheRef.current = ziel;
    setHoehe(ziel);
  }, []);

  // Zieht man im Inhalt nach unten, obwohl er schon ganz oben steht, faehrt
  // das Blatt mit herunter statt zu scrollen.
  const inhaltStart = useCallback((e) => {
    if (!e.touches || e.touches.length === 0) return;
    inhaltStartY.current = e.touches[0].clientY;
    const roller = scrollRef.current;
    inhaltObenRef.current = !roller || roller.scrollTop <= 0;
  }, []);

  const inhaltBewegung = useCallback((e) => {
    if (ziehtRef.current || !inhaltObenRef.current) return;
    if (!e.touches || e.touches.length === 0) return;
    const roller = scrollRef.current;
    if (roller && roller.scrollTop > 0) {
      inhaltObenRef.current = false;
      return;
    }
    const y = e.touches[0].clientY;
    if (y - inhaltStartY.current <= 8) return;
    ziehBeginnen(inhaltStartY.current);
    ausZeigerHoehe(y);
  }, [ausZeigerHoehe, ziehBeginnen]);

  // Nach dem Einrasten stehen die Elemente auf dem Stand aus dem Ziehen; der
  // neue Zustand setzt sie per Stil-Attribut ohnehin, hier nur nachziehen,
  // falls React zwischendurch nichts anderes geaendert hat.
  useEffect(() => {
    hoeheRef.current = hoehe;
    malen();
  }, [hoehe, malen]);

  useEffect(() => () => {
    if (bildRef.current) cancelAnimationFrame(bildRef.current);
  }, []);

  return {
    hoehe,
    zieht,
    blattRef,
    feldRef,
    scrollRef,
    ziehStart,
    ziehBewegung,
    ziehEnde,
    inhaltStart,
    inhaltBewegung,
  };
}

export default useBlattZiehen;
