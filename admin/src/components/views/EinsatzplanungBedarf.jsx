import { useEffect, useMemo, useState } from 'react';
import BackCircleButton from '../ui/BackCircleButton';
import EinsatzDiagramm from './EinsatzDiagramm';
import { EreignisKacheln } from './RisikoBausteine';
import { ereignisseFuerTag, useEreignisAenderungen, useRisikoDaten } from '../../demo/risikoErgebnisse';
import { useI18n } from '../../i18n';

// KI Einsatzplanung, Schritt 2: Bedarf pruefen und per Hand anpassen.
// Zwischen Kalender und Tagesplanung stehen die Diagramme aller gewaehlten Tage
// untereinander, getrennt durch die Datumszeile der Fahrer-App (Striche links
// und rechts). Der Bedarf laesst sich pro Stunde nach oben oder unten ziehen: "gebucht ist
// wenig, aber ich weiss, dass da noch Fahrer gebraucht werden". Erst mit dem
// Pfeil unten wird geplant.

const LIME_TRENNER = '#e3f754';
const LIME_HALB = 'rgba(227,246,84,0.5)';
const BASIS_BREITE = 402;
const STUNDEN = Array.from({ length: 20 }, (_, i) => 6 + i);

// Abstaende: Datumszeile 32 hoch wie in der Fahrer-App; darunter wie in der
// Tagesplanung (Datum-Mitte 134 -> Legende 194 -> Uhrzeiten 455), danach
// 100 px bis zur naechsten Datumszeile.
const ERSTER_TRENNER = 118;
const TRENNER_HOEHE = 32;
const TRENNER_BIS_LEGENDE = 76;
const LEGENDE_BIS_UHRZEIT = 261;
const NACH_DIAGRAMM = 106; // halbe Uhrzeit-Zeile + 100 — Tage deutlich getrennt
const BLOCK = TRENNER_BIS_LEGENDE + LEGENDE_BIS_UHRZEIT + NACH_DIAGRAMM;
// Ereignisse des Tages unter dem Diagramm: Ueberschrift 40 px unter der
// Uhrzeit-Zeile, Kacheln (132 hoch) 32 px darunter, dann wie sonst 100 px Abstand.
const EREIGNIS_TITEL = 40;
const EREIGNIS_KACHELN = 72;
const EREIGNIS_HOEHE = EREIGNIS_KACHELN + 132 + 106 - NACH_DIAGRAMM;

// Hintergrund wie Kalender und Tagesplanung, fest hinter der Seite.
const HINTERGRUND = {
  backgroundImage:
    "url(\"data:image/svg+xml;utf8,<svg viewBox='0 0 402 873' xmlns='http://www.w3.org/2000/svg' preserveAspectRatio='none'><rect x='0' y='0' height='100%' width='100%' fill='url(%23grad)' opacity='1'/><defs><radialGradient id='grad' gradientUnits='userSpaceOnUse' cx='0' cy='0' r='10' gradientTransform='matrix(43.25 96.3 -44.344 19.869 1.3947e-15 1.9384e-13)'><stop stop-color='rgba(49,55,1,1)' offset='0'/><stop stop-color='rgba(25,28,0,1)' offset='0.2283'/><stop stop-color='rgba(12,14,0,1)' offset='0.34244'/><stop stop-color='rgba(0,0,0,1)' offset='0.45659'/><stop stop-color='rgba(0,0,0,1)' offset='0.6782'/><stop stop-color='rgba(0,6,16,1)' offset='0.69832'/><stop stop-color='rgba(0,11,32,1)' offset='0.71843'/><stop stop-color='rgba(0,22,64,1)' offset='0.75865'/><stop stop-color='rgba(0,33,96,1)' offset='0.79888'/><stop stop-color='rgba(0,45,128,1)' offset='0.8391'/><stop stop-color='rgba(0,67,191,1)' offset='0.91955'/><stop stop-color='rgba(0,89,255,1)' offset='1'/></radialGradient></defs></svg>\")",
  backgroundSize: '100% 100%',
  backgroundRepeat: 'no-repeat',
};

// Datumszeile wie in der Fahrer-App: "Mittwoch 16.09."
const trennerText = (iso, locale) => {
  const datum = new Date(`${iso}T12:00:00`);
  const wochentag = datum.toLocaleDateString(locale, { weekday: 'long' });
  const tagMonat = datum.toLocaleDateString(locale, { day: '2-digit', month: '2-digit' });
  return `${wochentag} ${tagMonat}`.replace(/\.*$/, '.');
};

export default function EinsatzplanungBedarf({
  tage,
  heuteIso,
  supplyAll,
  bookedAll,
  demandBasis,      // berechneter Bedarf (72 h ab heute 00:00)
  anpassungen,      // { [iso]: { [stunde]: wert } }
  onAnpassen,       // (iso, stunde, wert)
  onZuruecksetzen,
  onZurueck,
  onWeiter,
  onEreignisse,
}) {
  const { t, locale } = useI18n();
  const [scale, setScale] = useState(1);
  const risiko = useRisikoDaten();
  useEreignisAenderungen();

  useEffect(() => {
    const aktualisieren = () => setScale(Math.min(window.innerWidth / BASIS_BREITE, 1));
    aktualisieren();
    window.addEventListener('resize', aktualisieren);
    return () => window.removeEventListener('resize', aktualisieren);
  }, []);

  const ereignisseJeTag = Object.fromEntries(tage.map((iso) => [iso, ereignisseFuerTag(risiko, iso)]));
  const tops = [];
  tage.forEach((iso, i) => {
    tops.push(i === 0 ? ERSTER_TRENNER
      : tops[i - 1] + BLOCK + (ereignisseJeTag[tage[i - 1]].length ? EREIGNIS_HOEHE : 0));
  });
  const topsSchluessel = tops.join(',');

  const bloecke = useMemo(() => tage.map((iso, position) => {
    const tagIndex = Math.round((new Date(`${iso}T12:00:00`) - new Date(`${heuteIso}T12:00:00`)) / 86400000);
    const basis = tagIndex * 24;
    const wert = (reihe, h) => Math.max(0, Number(reihe?.[basis + h]) || 0);
    const bedarfBasis = STUNDEN.map((h) => wert(demandBasis, h));
    const eigene = anpassungen?.[iso] || {};
    return {
      iso,
      top: Number(topsSchluessel.split(',')[position]),
      bedarfBasis,
      // Eigener Wert ersetzt den berechneten — hoeher oder niedriger.
      bedarf: STUNDEN.map((h, i) => (eigene[h] != null ? Math.max(0, Number(eigene[h]) || 0) : Math.round(bedarfBasis[i]))),
      gebucht: STUNDEN.map((h) => wert(bookedAll, h)),
      fahrer: STUNDEN.map((h) => wert(supplyAll, h)),
    };
  }), [tage, heuteIso, demandBasis, bookedAll, supplyAll, anpassungen, topsSchluessel]);

  const letzteUhrzeit = tops[tops.length - 1] + TRENNER_BIS_LEGENDE + LEGENDE_BIS_UHRZEIT;
  const hinweisY = letzteUhrzeit + 56 + (ereignisseJeTag[tage[tage.length - 1]]?.length ? EREIGNIS_HOEHE : 0);
  const fussY = hinweisY + 48;
  const hoehe = fussY + 14 + 180;
  const angepasst = Object.values(anpassungen || {}).some((tag) => Object.keys(tag || {}).length > 0);

  return (
    <div className="absolute inset-0 z-[60] bg-black" data-tutorial="planer-bedarf">
      <div aria-hidden="true" className="absolute inset-0 pointer-events-none" style={HINTERGRUND} />
      <div
        className="relative h-dvh w-full overflow-y-auto overflow-x-hidden overscroll-none flex justify-center"
        style={{ WebkitTextSizeAdjust: 'none', textSizeAdjust: 'none', fontFamily: 'Space Grotesk, sans-serif' }}
      >
        <div className="relative shrink-0" style={{ width: `${BASIS_BREITE * scale}px`, height: `${hoehe * scale}px` }}>
          <div className="absolute left-0 top-0 w-[402px] origin-top-left" style={{ height: `${hoehe}px`, transform: `scale(${scale})` }}>
            <BackCircleButton onClick={onZurueck} className="absolute left-[20px] top-[40px]" marker="planer-bedarf-zurueck" />

            {bloecke.map((block, position) => (
              <div key={block.iso}>
                <div
                  className="absolute left-[20px] right-[20px] flex items-center justify-between pointer-events-none"
                  style={{ top: `${block.top}px`, height: `${TRENNER_HOEHE}px` }}
                >
                  <span className="w-[44px] h-[2px] shrink-0" style={{ background: LIME_TRENNER }} />
                  <span className="text-[26px] font-bold tracking-[-0.5px] whitespace-nowrap" style={{ color: LIME_TRENNER }}>
                    {trennerText(block.iso, locale)}
                  </span>
                  <span className="w-[44px] h-[2px] shrink-0" style={{ background: LIME_TRENNER }} />
                </div>
                <EinsatzDiagramm
                  oben={block.top + TRENNER_BIS_LEGENDE}
                  bedarf={block.bedarf}
                  bedarfBasis={block.bedarfBasis}
                  gebucht={block.gebucht}
                  fahrer={block.fahrer}
                  ziehbar
                  marker={`planer-bedarf-diagramm-${position}`}
                  onBedarf={(i, wert) => onAnpassen(block.iso, STUNDEN[i], wert)}
                />
                {ereignisseJeTag[block.iso].length ? (
                  <>
                    <p
                      className="absolute left-[20px] text-[20px] font-bold leading-[24px] tracking-[-0.3px]"
                      style={{ top: `${block.top + TRENNER_BIS_LEGENDE + LEGENDE_BIS_UHRZEIT + EREIGNIS_TITEL - 12}px`, color: LIME_TRENNER }}
                    >
                      Ereignisse
                    </p>
                    <div
                      className="absolute left-[20px] w-[362px]"
                      style={{ top: `${block.top + TRENNER_BIS_LEGENDE + LEGENDE_BIS_UHRZEIT + EREIGNIS_KACHELN}px` }}
                    >
                      <EreignisKacheln
                        ereignisse={ereignisseJeTag[block.iso]}
                        onOeffnen={() => onEreignisse?.(block.iso)}
                        marker={`planer-bedarf-ereignisse-${position}`}
                      />
                    </div>
                  </>
                ) : null}
              </div>
            ))}

            <div
              className="absolute left-[20px] w-[362px] -translate-y-1/2 text-center text-[12px] font-medium leading-[16px] tracking-[0.5px]"
              style={{ top: `${hinweisY}px`, color: LIME_HALB }}
            >
              {t('planer.demandHint')}
            </div>

            <button
              type="button"
              onClick={onZuruecksetzen}
              disabled={!angepasst}
              data-tutorial="planer-bedarf-zuruecksetzen"
              className="absolute left-1/2 -translate-x-1/2 -translate-y-1/2 text-[14px] font-medium leading-[24px] tracking-[0.5px] whitespace-nowrap disabled:opacity-40"
              style={{ top: `${fussY}px`, color: LIME_HALB }}
            >
              {t('planer.reset')}
            </button>
            <button
              type="button"
              onClick={onWeiter}
              data-tutorial="planer-bedarf-weiter"
              aria-label={t('planer.startPlanning')}
              className="absolute left-[309px] w-[65px] h-[48px] flex items-center justify-center"
              style={{ top: `${fussY - 24}px` }}
            >
              <img src="/icon/_Icon_Planung/weiter_gross.svg" alt="" className="block w-[45px] h-[28px] rotate-180" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
