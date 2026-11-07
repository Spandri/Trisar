import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
// Karten laufen auf MapLibre mit dunklem Carto-Stil (siehe shared/karte).
import { karteBereitstellen } from './shared/karte/maplibreKarte';
import App from './App.jsx';
import { beiUeberspringen, wacheStarten } from './demo/ueberspringen';
import splashVideo from './assets/loadScreen.mp4';
import { DEMO_MODE } from './datenquelle';

const BOOT_MAX_MS = 6000;

// Der Demo-Rahmen (viewer) spielt den Trailer mit Logo-Animation und Login
// selbst ab. Laeuft die App darin (?nosplash=1), entfaellt ihre eigene
// Startanimation — sonst liefe sie bei jedem Wechsel zwischen Dispo- und
// Fahrer-App erneut.
const SPLASH_UNTERDRUECKT = new URLSearchParams(window.location.search).get('nosplash') === '1';

// Im Live-Betrieb laeuft die Logo-Animation nur beim allerersten Start auf
// dem Geraet. Danach merkt sich der Browser das und die App oeffnet direkt.
// In der Demo bleibt sie bei jedem Aufruf, dort gehoert sie zum Trailer.
const SPLASH_MERKEN = import.meta.env.VITE_DATENQUELLE !== 'demo';
const SPLASH_SCHLUESSEL = 'trisar:splash-gesehen';
const splashSchonGesehen = () => {
  if (!SPLASH_MERKEN) return false;
  try { return window.localStorage.getItem(SPLASH_SCHLUESSEL) === '1'; } catch { return false; }
};
const splashGesehenMerken = () => {
  if (!SPLASH_MERKEN) return;
  try { window.localStorage.setItem(SPLASH_SCHLUESSEL, '1'); } catch { /* privater Modus */ }
};

function BootSplashGate() {
  const [videoDone, setVideoDone] = useState(() => SPLASH_UNTERDRUECKT || splashSchonGesehen());
  // Easter Egg: Doppelklick oder Esc beendet Startvideo und Login-Trailer.
  const [uebersprungen, setUebersprungen] = useState(false);
  const [videoFailed, setVideoFailed] = useState(false);
  const [pageLoaded, setPageLoaded] = useState(() => document.readyState === 'complete');

  useEffect(() => {
    const timerId = window.setTimeout(() => setVideoDone(true), BOOT_MAX_MS);
    return () => window.clearTimeout(timerId);
  }, []);

  useEffect(() => {
    if (document.readyState === 'complete') {
      setPageLoaded(true);
      return undefined;
    }
    const onLoad = () => setPageLoaded(true);
    window.addEventListener('load', onLoad);
    return () => window.removeEventListener('load', onLoad);
  }, []);

  useEffect(() => wacheStarten(), []);
  useEffect(() => beiUeberspringen(() => setUebersprungen(true)), []);

  const showSplash = !uebersprungen && !(videoDone && pageLoaded);

  // Der Demo-Trailer (Login, der sich selbst ausfuellt) darf erst starten,
  // wenn die Startanimation durch ist — sonst laeuft er unsichtbar darunter ab.
  useEffect(() => {
    if (showSplash) return;
    splashGesehenMerken();
    window.__TRISAR_SPLASH_FERTIG = true;
    window.dispatchEvent(new CustomEvent('trisar:splash-fertig'));
  }, [showSplash]);

  return (
    <>
      <App />
      {showSplash ? (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 99999,
            background: '#000',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {!videoFailed ? (
            <video
              autoPlay
              muted
              playsInline
              preload="auto"
              onLoadedData={(event) => {
                try {
                  const video = event.currentTarget;
                  const playPromise = video.play?.();
                  if (playPromise && typeof playPromise.catch === 'function') {
                    playPromise.catch(() => {});
                  }
                } catch {
                  // Ignore autoplay errors, timeout fallback will hide splash.
                }
              }}
              onEnded={() => setVideoDone(true)}
              onError={() => setVideoFailed(true)}
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            >
              <source src={splashVideo} type="video/mp4" />
            </video>
          ) : (
            <div
              style={{
                position: 'absolute',
                color: '#E3F654',
                fontWeight: 700,
                letterSpacing: 0.8,
                fontSize: 20,
              }}
            >
              TRISAR
            </div>
          )}
        </div>
      ) : null}
    </>
  );
}

// index.html traegt den Demo-Titel, live ohne "Demo".
if (!DEMO_MODE) document.title = 'TRISAR – Fahrer App';

karteBereitstellen();

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BootSplashGate />
  </StrictMode>,
);
