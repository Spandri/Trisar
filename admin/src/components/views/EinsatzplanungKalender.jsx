import { useEffect, useMemo, useRef, useState } from 'react';
import BackCircleButton from '../ui/BackCircleButton';
import IosZeitauswahl from '../ui/IosZeitauswahl';
import { imDemoRahmen } from '../ui/iosZeitHelfer';
import { useI18n } from '../../i18n';

// KI Einsatzplanung, Schritt 1: Zeitraum waehlen.
// Umsetzung von Figma Trisar_App_01 / Node 2571:12506 (402 x 873).
//   - Start- und Endzeit oben, eingestellt mit der Zeitauswahl des Geraets
//   - Monatskalender: nur Tage mit gebuchten Fahrten ab heute sind waehlbar
//   - erster Tipp = Starttag, zweiter Tipp = Endtag, Band dazwischen
//   - Pfeil unten rechts startet die Planung fuer den Zeitraum

const LIME = '#e3f654';
const LIME_TITEL = '#e2f754';
const LIME_HALB = 'rgba(227,246,84,0.5)';
const LIME_VIERTEL = 'rgba(227,246,84,0.25)';
const BASIS_BREITE = 402;
const BASIS_HOEHE = 873;

// Hintergrund exakt aus Figma (radialer Verlauf: Lime oben links, Blau unten rechts).
const HINTERGRUND = {
  backgroundImage:
    "url(\"data:image/svg+xml;utf8,<svg viewBox='0 0 402 873' xmlns='http://www.w3.org/2000/svg' preserveAspectRatio='none'><rect x='0' y='0' height='100%' width='100%' fill='url(%23grad)' opacity='1'/><defs><radialGradient id='grad' gradientUnits='userSpaceOnUse' cx='0' cy='0' r='10' gradientTransform='matrix(43.25 96.3 -44.344 19.869 1.3947e-15 1.9384e-13)'><stop stop-color='rgba(49,55,1,1)' offset='0'/><stop stop-color='rgba(25,28,0,1)' offset='0.2283'/><stop stop-color='rgba(12,14,0,1)' offset='0.34244'/><stop stop-color='rgba(0,0,0,1)' offset='0.45659'/><stop stop-color='rgba(0,0,0,1)' offset='0.6782'/><stop stop-color='rgba(0,6,16,1)' offset='0.69832'/><stop stop-color='rgba(0,11,32,1)' offset='0.71843'/><stop stop-color='rgba(0,22,64,1)' offset='0.75865'/><stop stop-color='rgba(0,33,96,1)' offset='0.79888'/><stop stop-color='rgba(0,45,128,1)' offset='0.8391'/><stop stop-color='rgba(0,67,191,1)' offset='0.91955'/><stop stop-color='rgba(0,89,255,1)' offset='1'/></radialGradient></defs></svg>\")",
  backgroundSize: '100% 100%',
};

// Spaltenmitten der Wochentage und Zeilenmitten laut Figma.
const SPALTEN_X = [53, 103, 154, 204.5, 255, 305, 354.5];
const KOPF_X = [51, 102.5, 154, 205.5, 254.5, 303, 352];
const KOPF_Y = 348;
const ERSTE_ZEILE_Y = 402;
const ZEILEN_ABSTAND = 54;
const KREIS = 35;

// Zeitfelder (List item – Accordion): 178 x 56, Rahmen 2 px.
const FELD_OBEN = 158;
const FELD_HOEHE = 56;
const FELD_BREITE = 178;
const FELD_LINKS = [20, 204];

const pad2 = (n) => String(n).padStart(2, '0');
const isoAus = (jahr, monat, tag) => `${jahr}-${pad2(monat + 1)}-${pad2(tag)}`;

function Zeitfeld({ links, platzhalter, wert, onOeffnen, onNativ, marker }) {
  const nativRef = useRef(null);
  const gefuellt = Boolean(wert);
  const rahmen = imDemoRahmen();
  return (
    <div
      className="absolute"
      style={{ left: `${links}px`, top: `${FELD_OBEN}px`, width: `${FELD_BREITE}px`, height: `${FELD_HOEHE}px` }}
    >
      <button
        type="button"
        data-tutorial={marker}
        onClick={(e) => {
          if (rahmen) { onOeffnen(e.currentTarget); return; }
          const feld = nativRef.current;
          if (!feld) return;
          try { feld.showPicker?.(); } catch { feld.focus(); }
        }}
        className="absolute inset-0 border-2 border-solid flex items-center justify-between px-[16px] text-left"
        style={{ borderColor: LIME }}
      >
        <span
          className="text-[16px] font-medium leading-[24px] tracking-[0.5px] whitespace-nowrap font-['Space_Grotesk']"
          style={{ color: gefuellt ? LIME : LIME_HALB }}
        >
          {gefuellt ? `${wert} Uhr` : platzhalter}
        </span>
        <img src="/icon/_Icon_Lime/Edit_Trisar_Icon_01_Lime.svg" alt="" className="block w-[15px] h-[15px] shrink-0" />
      </button>
      {/* Echtes Geraet: Zeitauswahl des Betriebssystems */}
      {!rahmen ? (
        <input
          ref={nativRef}
          type="time"
          value={wert || ''}
          onChange={(e) => onNativ(e.target.value)}
          className="absolute inset-0 opacity-0"
          style={{ fontSize: '16px' }}
          aria-label={platzhalter}
        />
      ) : null}
    </div>
  );
}

export default function EinsatzplanungKalender({
  heuteIso,
  tageMitFahrten,
  anfang = null,
  onZurueck,
  onEinstellungen,
  onWeiter,
}) {
  const { t, locale } = useI18n();
  const [scale, setScale] = useState(1);
  const [von, setVon] = useState(anfang?.von || null);
  const [bis, setBis] = useState(anfang?.bis || null);
  const [startZeit, setStartZeit] = useState(anfang?.startZeit || '');
  const [endZeit, setEndZeit] = useState(anfang?.endZeit || '');
  const [zeitOffen, setZeitOffen] = useState(null); // 'start' | 'ende'
  const [heuteJahr, heuteMonat] = heuteIso.split('-').map(Number);
  const [monat, setMonat] = useState(() => {
    const quelle = anfang?.von || heuteIso;
    const [j, m] = quelle.split('-').map(Number);
    return { jahr: j, monat: m - 1 };
  });

  useEffect(() => {
    const aktualisieren = () => setScale(Math.min(window.innerWidth / BASIS_BREITE, 1));
    aktualisieren();
    window.addEventListener('resize', aktualisieren);
    return () => window.removeEventListener('resize', aktualisieren);
  }, []);

  const monatsName = useMemo(
    () => new Intl.DateTimeFormat(locale, { month: 'long' }).format(new Date(monat.jahr, monat.monat, 15)),
    [locale, monat],
  );
  // Wochentage kurz, Montag zuerst (M D M D F S S)
  const wochentage = useMemo(() => Array.from({ length: 7 }, (_, i) => (
    new Intl.DateTimeFormat(locale, { weekday: 'narrow' }).format(new Date(2024, 0, 1 + i))
  )), [locale]);

  const tage = useMemo(() => {
    const ersterWochentag = (new Date(monat.jahr, monat.monat, 1).getDay() + 6) % 7;
    const anzahl = new Date(monat.jahr, monat.monat + 1, 0).getDate();
    return Array.from({ length: anzahl }, (_, i) => {
      const nr = i + 1;
      const index = ersterWochentag + i;
      return { nr, iso: isoAus(monat.jahr, monat.monat, nr), spalte: index % 7, zeile: Math.floor(index / 7) };
    });
  }, [monat]);
  const zeilenAnzahl = tage.length ? tage[tage.length - 1].zeile + 1 : 5;
  // Sechs Wochen: Zeilen enger, damit "Zuruecksetzen" frei bleibt.
  const zeilenAbstand = zeilenAnzahl > 5 ? 46 : ZEILEN_ABSTAND;
  const zeileY = (zeile) => ERSTE_ZEILE_Y + zeile * zeilenAbstand;

  const waehlbar = (iso) => iso >= heuteIso && tageMitFahrten.has(iso);

  const tagTippen = (iso) => {
    if (!waehlbar(iso)) return;
    if (!von || (von && bis) || iso < von) {
      setVon(iso);
      setBis(null);
      return;
    }
    if (iso === von) { setBis(null); return; }
    setBis(iso);
  };

  const ende = bis || von;
  const imBand = (iso) => von && bis && iso >= von && iso <= bis;

  // Band je Wochenzeile (Figma: Rectangle 432/433, 25 % Lime, Enden rund).
  const baender = [];
  if (von && bis) {
    const zeilen = new Map();
    tage.forEach((tag) => {
      if (!imBand(tag.iso)) return;
      const eintrag = zeilen.get(tag.zeile) || { min: tag, max: tag };
      if (tag.spalte < eintrag.min.spalte) eintrag.min = tag;
      if (tag.spalte > eintrag.max.spalte) eintrag.max = tag;
      zeilen.set(tag.zeile, eintrag);
    });
    zeilen.forEach(({ min, max }, zeile) => {
      const beginntHier = min.iso === von;
      const endetHier = max.iso === bis;
      const links = beginntHier ? SPALTEN_X[min.spalte] : SPALTEN_X[min.spalte] - KREIS / 2;
      const rechts = endetHier ? SPALTEN_X[max.spalte] : SPALTEN_X[max.spalte] + 20.5;
      baender.push({
        key: zeile,
        links,
        breite: Math.max(0, rechts - links),
        top: zeileY(zeile) - KREIS / 2,
        rundLinks: !beginntHier,
        rundRechts: !endetHier,
      });
    });
  }

  const monatWechseln = (delta) => {
    setMonat((alt) => {
      const d = new Date(alt.jahr, alt.monat + delta, 1);
      return { jahr: d.getFullYear(), monat: d.getMonth() };
    });
  };
  const vorMonatGesperrt = monat.jahr < heuteJahr || (monat.jahr === heuteJahr && monat.monat <= heuteMonat - 1);

  const zuruecksetzen = () => {
    setVon(null);
    setBis(null);
    setStartZeit('');
    setEndZeit('');
  };

  const weiter = () => {
    if (!von) return;
    onWeiter?.({ von, bis: ende, startZeit, endZeit });
  };

  // Navigationsleiste liegt fest darueber (vom Planer gerendert).
  const hoehe = BASIS_HOEHE;

  return (
    <div className="absolute inset-0 z-[60] bg-black" data-tutorial="planer-kalender">
      <div
        className="h-dvh w-full overflow-y-auto overflow-x-hidden overscroll-none flex justify-center"
        style={{ WebkitTextSizeAdjust: 'none', textSizeAdjust: 'none', fontFamily: 'Space Grotesk, sans-serif' }}
      >
        <div className="relative shrink-0" style={{ width: `${BASIS_BREITE * scale}px`, height: `${hoehe * scale}px` }}>
          <div
            className="absolute left-0 top-0 w-[402px] origin-top-left"
            style={{ ...HINTERGRUND, height: `${hoehe}px`, transform: `scale(${scale})` }}
          >
            <BackCircleButton onClick={onZurueck} className="absolute left-[20px] top-[60px]" marker="planer-kalender-zurueck" />
            <button
              type="button"
              onClick={onEinstellungen}
              aria-label={t('planer.settingsAria')}
              className="absolute left-[332px] top-[60px] w-[50px] h-[50px]"
            >
              <img src="/icon/_Icon_Planung/filter.svg" alt="" className="block w-full h-full" />
            </button>

            <Zeitfeld
              links={FELD_LINKS[0]}
              platzhalter={t('planer.startTime')}
              wert={startZeit}
              marker="planer-startzeit"
              onOeffnen={() => setZeitOffen('start')}
              onNativ={setStartZeit}
            />
            <Zeitfeld
              links={FELD_LINKS[1]}
              platzhalter={t('planer.endTime')}
              wert={endZeit}
              marker="planer-endzeit"
              onOeffnen={() => setZeitOffen('ende')}
              onNativ={setEndZeit}
            />

            {/* Monat */}
            <button
              type="button"
              onClick={() => monatWechseln(-1)}
              disabled={vorMonatGesperrt}
              aria-label={t('planer.previousMonth')}
              className="absolute left-[53px] top-[261px] w-[46px] h-[36px] flex items-center justify-center disabled:opacity-50"
            >
              <img src="/icon/_Icon_Planung/kal_pfeil_links.svg" alt="" className="block w-[26.136px] h-[15.909px]" />
            </button>
            <div
              className="absolute left-[20px] w-[362px] text-center text-[30px] font-bold tracking-[-0.5px] leading-none whitespace-nowrap"
              style={{ top: '262px', color: LIME_TITEL }}
            >
              {monatsName}
            </div>
            <button
              type="button"
              onClick={() => monatWechseln(1)}
              aria-label={t('planer.nextMonth')}
              className="absolute left-[314px] top-[261px] w-[46px] h-[36px] flex items-center justify-center"
            >
              <img src="/icon/_Icon_Planung/kal_pfeil_links.svg" alt="" className="block w-[26.136px] h-[15.909px] rotate-180" />
            </button>

            {/* Wochentage */}
            {wochentage.map((kurz, i) => (
              <div
                key={`kopf-${i}`}
                className="absolute -translate-x-1/2 -translate-y-1/2 text-[16px] font-medium leading-[24px] tracking-[0.5px] whitespace-nowrap"
                style={{ left: `${KOPF_X[i]}px`, top: `${KOPF_Y}px`, color: LIME_HALB }}
              >
                {kurz.toUpperCase()}
              </div>
            ))}

            {/* Band zwischen Start und Ende */}
            {baender.map((band) => (
              <div
                key={`band-${band.key}`}
                className="absolute pointer-events-none"
                style={{
                  left: `${band.links}px`,
                  top: `${band.top}px`,
                  width: `${band.breite}px`,
                  height: `${KREIS}px`,
                  background: LIME,
                  opacity: 0.25,
                  borderTopLeftRadius: band.rundLinks ? '50px' : 0,
                  borderBottomLeftRadius: band.rundLinks ? '50px' : 0,
                  borderTopRightRadius: band.rundRechts ? '50px' : 0,
                  borderBottomRightRadius: band.rundRechts ? '50px' : 0,
                }}
              />
            ))}

            {/* Kreise an Start und Ende (Figma: Ellipse 101, schwarz gefuellt) */}
            {tage.filter((tag) => tag.iso === von || tag.iso === ende).map((tag) => (
              <div
                key={`kreis-${tag.iso}`}
                className="absolute pointer-events-none rounded-full"
                style={{
                  left: `${SPALTEN_X[tag.spalte] - KREIS / 2}px`,
                  top: `${zeileY(tag.zeile) - KREIS / 2}px`,
                  width: `${KREIS}px`,
                  height: `${KREIS}px`,
                  background: '#010100',
                  boxShadow: `inset 0 0 0 1px ${LIME}`,
                }}
              />
            ))}

            {/* Tage */}
            {tage.map((tag) => {
              const aktiv = waehlbar(tag.iso);
              const tagIndex = Math.round((new Date(`${tag.iso}T12:00:00`) - new Date(`${heuteIso}T12:00:00`)) / 86400000);
              return (
                <button
                  key={tag.iso}
                  type="button"
                  disabled={!aktiv}
                  onClick={() => tagTippen(tag.iso)}
                  data-tutorial={aktiv ? `planer-tag-${tagIndex}` : undefined}
                  aria-pressed={tag.iso === von || tag.iso === ende || imBand(tag.iso)}
                  className="absolute flex items-center justify-center text-[16px] font-medium leading-[24px] tracking-[0.5px] whitespace-nowrap"
                  style={{
                    left: `${SPALTEN_X[tag.spalte] - 22}px`,
                    top: `${zeileY(tag.zeile) - 22}px`,
                    width: '44px',
                    height: '44px',
                    // Nicht waehlbare Tage bei 25 % Deckkraft.
                    color: aktiv ? LIME : LIME_VIERTEL,
                    cursor: aktiv ? 'pointer' : 'default',
                  }}
                >
                  {tag.nr}
                </button>
              );
            })}

            <button
              type="button"
              onClick={zuruecksetzen}
              data-tutorial="planer-kalender-zuruecksetzen"
              className="absolute left-1/2 -translate-x-1/2 -translate-y-1/2 text-[14px] font-medium leading-[24px] tracking-[0.5px] whitespace-nowrap"
              style={{ top: '689px', color: LIME_HALB }}
            >
              {t('planer.reset')}
            </button>

            <button
              type="button"
              onClick={weiter}
              disabled={!von}
              data-tutorial="planer-kalender-weiter"
              aria-label={t('planer.startPlanning')}
              className="absolute left-[309px] top-[665px] w-[65px] h-[48px] flex items-center justify-center disabled:opacity-50 transition-opacity"
            >
              <img src="/icon/_Icon_Planung/weiter_gross.svg" alt="" className="block w-[45px] h-[28px] rotate-180" />
            </button>

            <IosZeitauswahl
              offen={zeitOffen !== null}
              wert={zeitOffen === 'ende' ? endZeit : startZeit}
              anker={{ x: zeitOffen === 'ende' ? 132 : 20, y: FELD_OBEN + FELD_HOEHE + 8 }}
              onAendern={(neu) => (zeitOffen === 'ende' ? setEndZeit(neu) : setStartZeit(neu))}
              onSchliessen={() => setZeitOffen(null)}
              beschriftungStunde={t('planer.hour')}
              beschriftungMinute={t('planer.minute')}
              textZuruecksetzen={t('planer.reset')}
              textFertig={t('planer.done')}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
