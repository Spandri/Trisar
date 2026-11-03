import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../../i18n';
import { DEMO_MODE } from '../../datenquelle';

const dividerSrc = '/icon/_Icon_Schwarz/nav-divider.svg';
const locationActiveSrc = '/icon/_Icon_Lime/Pin_Nav_Trisar_Icons_01_Lime.svg';
const locationInactiveSrc = '/icon/_Icon_Grau/Pin_Nav_Trisar_Icons_01_grau.svg';
// Planung traegt das bisherige KI-Zeichen, der KI-Assistent sein eigenes
// (Figma Trisar_App_01, 2569-12503 grau / 2569-12504 ausgewaehlt).
const planungActiveSrc = '/icon/_Icon_Lime/KI_Trisar_Icons_01_Lime.svg';
const planungInactiveSrc = '/icon/_Icon_Grau/KI_Trisar_Icons_01_grau.svg';
const kiAssistentActiveSrc = '/icon/_Icon_Lime/KI_Assistent_Trisar_Icons_01_Lime.svg';
const kiAssistentInactiveSrc = '/icon/_Icon_Grau/KI_Assistent_Trisar_Icons_01_grau.svg';
const homeActiveSrc = '/icon/_Icon_Lime/House_Nav_Trisar_01_Lime.svg';
const homeInactiveSrc = '/icon/_Icon_Grau/House_Nav_Trisar_01_grau.svg';
const vehicleActiveSrc = '/icon/_Icon_Lime/Vehicle_Nav_Trisar_01_Lime.svg';
const vehicleInactiveSrc = '/icon/_Icon_Grau/Vehicle_Nav_Trisar_01_grau.svg';
const fahrtenActiveSrc = '/icon/_Icon_Lime/Arrow_Nav_Trisar_Icons_01_Lime.svg';
const fahrtenInactiveSrc = '/icon/_Icon_Grau/Arrow_Nav_Trisar_Icons_01_grau.svg';
const profileActiveSrc = '/icon/_Icon_Lime/Person_Trisar_Icons_01_Lime.svg';
const profileInactiveSrc = '/icon/_Icon_Grau/Person_Trisar_Icons_01_grau.svg';
const LONG_PRESS_MS = 450;

const noCalloutStyle = {
  WebkitTouchCallout: 'none',
  WebkitUserSelect: 'none',
  userSelect: 'none',
};

// Ein Feld der Leiste mit Schnellwahl: Antippen oeffnet die vorne liegende
// Wahl, langes Druecken klappt die uebrigen darueber auf. Die anderen
// Moeglichkeiten liegen klein oben im Feld. Die zuletzt gewaehlte bleibt
// gespeichert.
function SchnellwahlKnopf({
  optionen,
  aktiverKey,
  speicherSchluessel,
  standardKey,
  tutorialMarker,
  ariaLabel,
  feldStil,
  menueLinks,
  resetEreignis,
}) {
  const schluessel = new Set(optionen.map((option) => option.key));
  const [menueOffen, setMenueOffen] = useState(false);
  const [hoverKey, setHoverKey] = useState(null);
  const [gewaehlterKey, setGewaehlterKey] = useState(() => {
    if (typeof window === 'undefined') return standardKey;
    const gespeichert = window.localStorage.getItem(speicherSchluessel) || '';
    return schluessel.has(gespeichert) ? gespeichert : standardKey;
  });
  const timerRef = useRef(null);
  const langGedruecktRef = useRef(false);
  const naechstenKlickUnterdrueckenRef = useRef(false);
  const druckAktivRef = useRef(false);
  const menueRef = useRef(null);
  const knopfRef = useRef(null);
  const optionRefs = useRef({});

  const vorneKey = aktiverKey && schluessel.has(aktiverKey) ? aktiverKey : gewaehlterKey;
  const vorne = optionen.find((option) => option.key === vorneKey) || optionen[0];
  const weitere = optionen.filter((option) => option.key !== vorne.key);
  const merken = (key) => {
    if (!schluessel.has(key) || typeof window === 'undefined') return;
    window.localStorage.setItem(speicherSchluessel, key);
  };

  const waehlen = (option) => {
    setGewaehlterKey(option.key);
    merken(option.key);
    setMenueOffen(false);
    setHoverKey(null);
    option.onSelect?.();
  };

  const timerLoeschen = () => {
    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const optionAnStelle = (x, y) => weitere.find((option) => {
    const node = optionRefs.current[option.key];
    if (!node) return false;
    const r = node.getBoundingClientRect();
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  }) || null;

  useEffect(() => () => {
    druckAktivRef.current = false;
    timerLoeschen();
  }, []);

  useEffect(() => {
    if (aktiverKey && schluessel.has(aktiverKey)) merken(aktiverKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aktiverKey]);

  // Demo-Tutorial: beim Zuruecksetzen steht das Feld wieder auf seiner Vorgabe.
  useEffect(() => {
    if (!resetEreignis) return undefined;
    const anZustand = (event) => {
      // true = Vorgabe, ein Schluessel = genau diese Wahl nach vorn.
      const ziel = resetEreignis(event?.detail || {});
      if (!ziel) return;
      setGewaehlterKey(typeof ziel === 'string' && schluessel.has(ziel) ? ziel : standardKey);
      setMenueOffen(false);
      setHoverKey(null);
    };
    window.addEventListener('trisar:tutorial-zustand', anZustand);
    return () => window.removeEventListener('trisar:tutorial-zustand', anZustand);
  }, [resetEreignis, standardKey]);

  useEffect(() => {
    if (!menueOffen) return undefined;
    const draussen = (event) => {
      if (menueRef.current?.contains(event.target) || knopfRef.current?.contains(event.target)) return;
      setMenueOffen(false);
      setHoverKey(null);
    };
    document.addEventListener('pointerdown', draussen, true);
    return () => document.removeEventListener('pointerdown', draussen, true);
  }, [menueOffen]);

  // Menue ueber dem Feld: je weitere Moeglichkeit ein runder Platz (64 px) mit
  // Trennstrich dazwischen, wie beim Fahrten-Feld.
  const menueHoehe = weitere.length * 69 + 6;

  return (
    <>
      <button
        ref={knopfRef}
        data-tutorial={tutorialMarker}
        // Demo-Tutorial: welche Moeglichkeit vorne steht und welche es gibt. Der
        // Finger zieht damit die richtige hoch, statt das Zeichen umzustellen.
        data-schnellwahl-vorne={vorne.tutorialMarker}
        data-schnellwahl-optionen={optionen.map((option) => option.tutorialMarker).join(' ')}
        onPointerDown={(event) => {
          druckAktivRef.current = true;
          event.currentTarget?.setPointerCapture?.(event.pointerId);
          timerLoeschen();
          langGedruecktRef.current = false;
          timerRef.current = window.setTimeout(() => {
            langGedruecktRef.current = true;
            setMenueOffen(true);
            if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') navigator.vibrate(20);
          }, LONG_PRESS_MS);
        }}
        onPointerMove={(event) => {
          if (!menueOffen || !druckAktivRef.current) return;
          setHoverKey(optionAnStelle(event.clientX, event.clientY)?.key || null);
        }}
        onPointerUp={(event) => {
          timerLoeschen();
          druckAktivRef.current = false;
          if (!menueOffen) return;
          const perZug = optionAnStelle(event.clientX, event.clientY);
          if (perZug) {
            naechstenKlickUnterdrueckenRef.current = true;
            langGedruecktRef.current = false;
            waehlen(perZug);
            return;
          }
          setHoverKey(null);
          if (langGedruecktRef.current) {
            // Nach dem Loslassen bleibt das Menue offen, antippen geht weiter.
            naechstenKlickUnterdrueckenRef.current = true;
            window.setTimeout(() => { naechstenKlickUnterdrueckenRef.current = false; }, 0);
            langGedruecktRef.current = false;
          }
        }}
        onPointerCancel={() => {
          timerLoeschen();
          druckAktivRef.current = false;
          setHoverKey(null);
        }}
        onContextMenu={(event) => event.preventDefault()}
        onClick={() => {
          if (naechstenKlickUnterdrueckenRef.current) {
            naechstenKlickUnterdrueckenRef.current = false;
            return;
          }
          if (menueOffen) {
            setMenueOffen(false);
            setHoverKey(null);
            langGedruecktRef.current = false;
            return;
          }
          if (langGedruecktRef.current) {
            langGedruecktRef.current = false;
            return;
          }
          vorne.onSelect?.();
        }}
        className="absolute top-[8px] h-[64px] flex items-center justify-center cursor-pointer touch-manipulation"
        style={feldStil}
        aria-label={ariaLabel}
      >
        {weitere.map((option, index) => (
          <img
            key={`klein-${option.key}`}
            src={option.icon}
            alt=""
            draggable={false}
            className={`${option.iconClass} pointer-events-none select-none absolute top-[7px] opacity-60 scale-[0.58] ${index === 1 ? 'right-[7px]' : 'left-[7px]'}`}
          />
        ))}
        <img
          src={vorne.icon}
          alt=""
          draggable={false}
          className={`${vorne.iconClass} pointer-events-none select-none transition-all duration-300 ease-out scale-110`}
        />
      </button>

      {menueOffen ? (
        <div
          ref={menueRef}
          data-tutorial={`${tutorialMarker}-menue`}
          className="absolute -translate-x-1/2 w-20 pointer-events-none"
          style={{ left: menueLinks, top: `${-menueHoehe - 2}px`, height: `${menueHoehe}px` }}
        >
          <div className="absolute inset-0 bg-[#1e1e1e] rounded-[39px]" />
          {weitere.map((option, index) => (
            <div
              key={`platz-${option.key}`}
              className="absolute left-1/2 -translate-x-1/2 w-16 h-16 opacity-10 bg-stone-900 rounded-[100px]"
              style={{ top: `${5 + index * 69}px` }}
            />
          ))}
          {weitere.slice(1).map((option, index) => (
            <div
              key={`strich-${option.key}`}
              className="absolute left-1/2 -translate-x-1/2 w-8 h-0 opacity-50 border-t border-[#54545A]"
              style={{ top: `${72 + index * 69}px` }}
            />
          ))}
          {weitere.map((option, index) => (
            <button
              key={option.key}
              type="button"
              data-tutorial={option.tutorialMarker}
              onPointerDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
                waehlen(option);
              }}
              onClick={() => waehlen(option)}
              ref={(node) => { optionRefs.current[option.key] = node; }}
              className="absolute left-1/2 -translate-x-1/2 w-[42px] h-[42px] flex items-center justify-center transition-all duration-200 pointer-events-auto"
              style={{ top: `${16 + index * 69}px` }}
              aria-label={option.label || option.key}
            >
              <img
                src={option.icon}
                alt=""
                draggable={false}
                className={`${option.iconClass} pointer-events-none select-none opacity-60 transition-transform duration-150 ease-out ${hoverKey === option.key ? 'scale-130' : 'scale-100'}`}
              />
            </button>
          ))}
        </div>
      ) : null}
    </>
  );
}

export default function Navibar({
  className,
  onNavigateToFahrten,
  onNavigateHome,
  onNavigateToAddFahrt,
  onNavigateToKi,
  onNavigateToPlanung,
  onNavigateToMap,
  onNavigateToVehicles,
  onNavigateToProfile,
  activeTab = 'home',
}) {
  const { t } = useI18n();

  const isHomeActive = activeTab === 'home';
  const isMapActive = activeTab === 'map';
  const isAddActive = activeTab === 'add';

  const fahrtenOptionen = [
    {
      key: 'vehicles',
      tutorialMarker: 'navi-fahrzeuge',
      icon: activeTab === 'vehicles' ? vehicleActiveSrc : vehicleInactiveSrc,
      iconClass: 'w-6 h-6',
      onSelect: onNavigateToVehicles,
    },
    {
      key: 'fahrten',
      tutorialMarker: 'navi-alle-fahrten',
      icon: activeTab === 'fahrten' ? fahrtenActiveSrc : fahrtenInactiveSrc,
      iconClass: 'w-6 h-[23px]',
      onSelect: onNavigateToFahrten,
    },
    {
      key: 'profile',
      tutorialMarker: 'navi-fahrer',
      icon: activeTab === 'profile' ? profileActiveSrc : profileInactiveSrc,
      iconClass: 'w-[23px] h-[23px]',
      onSelect: onNavigateToProfile,
    },
  ];

  // Zweites Feld von rechts: Planung oder KI-Assistent.
  const kiOptionen = [
    {
      key: 'planung',
      label: t('home.planning'),
      tutorialMarker: 'navi-planung',
      icon: activeTab === 'planung' ? planungActiveSrc : planungInactiveSrc,
      iconClass: 'w-[23px] h-[23px]',
      onSelect: onNavigateToPlanung,
    },
    {
      key: 'ki',
      label: t('nav.aiAssistant'),
      tutorialMarker: 'navi-ki-assistent',
      icon: activeTab === 'ki' ? kiAssistentActiveSrc : kiAssistentInactiveSrc,
      // 51 x 34 im Figma, auf die Hoehe der uebrigen Zeichen gebracht.
      iconClass: 'w-[35px] h-[23px]',
      onSelect: onNavigateToKi,
    },
  ];

  return (
    <div
      className={className}
      style={noCalloutStyle}
      data-tutorial="navi-balken"
      onContextMenu={(event) => event.preventDefault()}
      onDragStart={(event) => event.preventDefault()}
    >
      <div className="absolute bg-[#1e1e1e] inset-[1.28%_22.38%_1.28%_0] rounded-[39px]" />
      <div className="absolute bg-[#111217] border border-[#3b3f47] inset-[1.28%_0_1.28%_78.45%] rounded-[39px]" />
      <div className="absolute bg-[#1e1e1e] inset-[10.26%_80.94%_10.26%_1.93%] opacity-10 rounded-[100px]" />
      <div className="absolute bg-[#1e1e1e] inset-[10.26%_62.15%_10.26%_20.99%] opacity-10 rounded-[100px]" />
      <div className="absolute bg-[#1e1e1e] inset-[10.26%_43.09%_10.26%_39.78%] opacity-10 rounded-[100px]" />
      <div
        className="absolute inset-[5.13%_1.1%_5.13%_79.56%] rounded-[100px]"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml;utf8,<svg viewBox='0 0 70 70' xmlns='http://www.w3.org/2000/svg' preserveAspectRatio='none'><rect x='0' y='0' height='100%' width='100%' fill='url(%23grad)' opacity='1'/><defs><radialGradient id='grad' gradientUnits='userSpaceOnUse' cx='0' cy='0' r='10' gradientTransform='matrix(9.884 14.405 -12.623 0.30866 12 12)'><stop stop-color='rgba(0,72,207,1)' offset='0'/><stop stop-color='rgba(0,54,155,1)' offset='0.17081'/><stop stop-color='rgba(0,36,104,1)' offset='0.34162'/><stop stop-color='rgba(0,27,78,1)' offset='0.42702'/><stop stop-color='rgba(0,18,52,1)' offset='0.51243'/><stop stop-color='rgba(0,9,26,1)' offset='0.59783'/><stop stop-color='rgba(0,5,13,1)' offset='0.64054'/><stop stop-color='rgba(0,0,0,1)' offset='0.68324'/><stop stop-color='rgba(0,0,0,1)' offset='0.83626'/><stop stop-color='rgba(0,0,0,1)' offset='1'/></radialGradient></defs></svg>\")",
        }}
      />
      <div className="absolute bg-[#1e1e1e] inset-[10.26%_24.31%_10.26%_58.56%] opacity-10 rounded-[100px]" />

      {/* Vertikale Trennstriche zwischen Buttons */}
      <div className="absolute inset-[28.21%_80.11%_28.21%_19.89%]">
        <div className="absolute inset-[0_-0.25px]">
          <img src={dividerSrc} alt="" draggable={false} className="w-full h-full pointer-events-none select-none" />
        </div>
      </div>
      <div className="absolute inset-[28.21%_61.33%_28.21%_38.67%]">
        <div className="absolute inset-[0_-0.25px]">
          <img src={dividerSrc} alt="" draggable={false} className="w-full h-full pointer-events-none select-none" />
        </div>
      </div>
      <div className="absolute inset-[28.21%_41.99%_28.21%_58.01%]">
        <div className="absolute inset-[0_-0.25px]">
          <img src={dividerSrc} alt="" draggable={false} className="w-full h-full pointer-events-none select-none" />
        </div>
      </div>

      <button
        onClick={() => onNavigateToMap?.()}
        data-tutorial="navi-karte"
        className="absolute left-[20.99%] top-[8px] w-[17.68%] h-[64px] flex items-center justify-center cursor-pointer touch-manipulation"
        aria-label={t('nav.map')}
      >
        <img
          src={isMapActive ? locationActiveSrc : locationInactiveSrc}
          alt=""
          draggable={false}
          className={`w-[23px] h-[23px] pointer-events-none select-none transition-all duration-300 ease-out ${isMapActive ? 'scale-110' : 'scale-90'}`}
        />
      </button>

      <button
        onClick={() => onNavigateHome?.()}
        data-tutorial="navi-home"
        className="absolute left-[1.93%] top-[8px] w-[17.96%] h-[64px] flex items-center justify-center cursor-pointer touch-manipulation"
        aria-label={t('nav.home')}
      >
        <img
          src={isHomeActive ? homeActiveSrc : homeInactiveSrc}
          alt=""
          draggable={false}
          className={`w-6 h-6 pointer-events-none select-none transition-all duration-300 ease-out ${isHomeActive ? 'scale-110' : 'scale-90'}`}
        />
      </button>

      <SchnellwahlKnopf
        optionen={fahrtenOptionen}
        aktiverKey={activeTab}
        speicherSchluessel="admin_nav_quick_selected_v1"
        standardKey="fahrten"
        tutorialMarker="navi-fahrten"
        ariaLabel={t('nav.allRides')}
        feldStil={{ left: '39.78%', width: '18.78%' }}
        menueLinks="49.17%"
        // Demo-Tutorial: beim Zuruecksetzen (oder mit schnellwahl: 'fahrten')
        // steht der Knopf wieder auf "Alle Fahrten".
        resetEreignis={(detail) => detail.reset === true || detail.schnellwahl === 'fahrten'}
      />

      <SchnellwahlKnopf
        optionen={kiOptionen}
        aktiverKey={activeTab}
        speicherSchluessel="admin_nav_ki_selected_v1"
        // Im Betrieb ist der Assistent noch nicht freigeschaltet: vorne die Planung.
        standardKey={DEMO_MODE ? 'ki' : 'planung'}
        tutorialMarker="navi-ki"
        ariaLabel={t('nav.aiAssistant')}
        feldStil={{ left: '58.56%', width: '17.68%' }}
        menueLinks="67.4%"
        resetEreignis={(detail) => (detail.reset === true ? 'ki' : detail.schnellwahlKi)}
      />

      <button
        onClick={() => onNavigateToAddFahrt?.()}
        data-tutorial="navi-plus"
        className="absolute left-[79.56%] top-[4px] w-[19.34%] h-[70px] flex items-center justify-center cursor-pointer touch-manipulation"
        aria-label={t('nav.addRide')}
      >
        <svg
          viewBox="0 0 24 24"
          aria-hidden="true"
          className={`size-6 transition-all duration-300 ease-out ${isAddActive ? 'scale-125' : 'scale-100'}`}
        >
          <circle cx="12" cy="12" r="9" stroke="#FFFFFF" strokeWidth="1.7" fill="none" />
          <path d="M12 8V16M8 12H16" stroke="#FFFFFF" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
    </div>
  );
}
