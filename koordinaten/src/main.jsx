import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.jsx';
import splashVideo from './assets/loadScreen.mp4';

const BOOT_MAX_MS = 6000;

function BootSplashGate() {
  const [videoDone, setVideoDone] = useState(false);
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

  const showSplash = !(videoDone && pageLoaded);

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

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BootSplashGate />
  </StrictMode>,
);
