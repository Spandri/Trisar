import { useEffect, useMemo, useRef, useState } from 'react';
import BackCircleButton from '../ui/BackCircleButton';
import EinsatzDiagramm from './EinsatzDiagramm';
import EngineBlock from './EngineBlock';
import { TagesWalletKarte } from './EinsatzWalletKarte';
import { walletWerte } from './einsatzWallet';
import { useI18n } from '../../i18n';

// KI Einsatzplanung, Schritt 2: ein Tag des gewaehlten Zeitraums.
// Umsetzung von Figma Trisar_App_01 / Node 2588:12036 (402 x 2898).
//   - Punkte oben/unten: Tage des Zeitraums, aktiver Tag voll
//   - Diagramm des Tages (Fahrer, Bedarf, gebuchte Fahrten), 06–01 Uhr
//   - Strategie: Ausgewogen / Effizient / Konservativ
//   - Vorschlaege: offen (gross, mit Fahrten) oder uebernommen (kompakt)
//   - Wallet-Karte: Kennzahlen des Tagesplans, laufend aus den Vorschlaegen
//   - accept uebernimmt den ganzen Tag, die Pfeile blaettern

const LIME = '#e3f654';
const GRUEN = '#59be80';
const ROT = '#ff6f63';

// Hintergrund wie im Kalender (Figma 2571:12506): oben Lime, nach unten in
// TRISAR-Blau, oben rechts ein schmaler blauer Rand. Er steht fest hinter der
// Seite und fuellt immer den sichtbaren Bildschirm — der Inhalt scrollt darueber.
const HINTERGRUND = {
  backgroundImage:
    "url(\"data:image/svg+xml;utf8,<svg viewBox='0 0 402 873' xmlns='http://www.w3.org/2000/svg' preserveAspectRatio='none'><rect x='0' y='0' height='100%' width='100%' fill='url(%23grad)' opacity='1'/><defs><radialGradient id='grad' gradientUnits='userSpaceOnUse' cx='0' cy='0' r='10' gradientTransform='matrix(43.25 96.3 -44.344 19.869 1.3947e-15 1.9384e-13)'><stop stop-color='rgba(49,55,1,1)' offset='0'/><stop stop-color='rgba(25,28,0,1)' offset='0.2283'/><stop stop-color='rgba(12,14,0,1)' offset='0.34244'/><stop stop-color='rgba(0,0,0,1)' offset='0.45659'/><stop stop-color='rgba(0,0,0,1)' offset='0.6782'/><stop stop-color='rgba(0,6,16,1)' offset='0.69832'/><stop stop-color='rgba(0,11,32,1)' offset='0.71843'/><stop stop-color='rgba(0,22,64,1)' offset='0.75865'/><stop stop-color='rgba(0,33,96,1)' offset='0.79888'/><stop stop-color='rgba(0,45,128,1)' offset='0.8391'/><stop stop-color='rgba(0,67,191,1)' offset='0.91955'/><stop stop-color='rgba(0,89,255,1)' offset='1'/></radialGradient></defs></svg>\")",
  backgroundSize: '100% 100%',
  backgroundRepeat: 'no-repeat',
};

const BASIS_BREITE = 402;

// Diagramm (Figma-Koordinaten)
const SLOTS = 20;             // 20 Stunden: 06:00 – 01:00
const ERSTE_STUNDE = 6;

// Strategie-Reiter
// Mitte der Reiter: zwei Optionen (Standard, Sicher) auf der 402 breiten Seite.
const REITER_X = [120, 282];
const REITER_Y = 502.5;

// Karten
const KARTEN_OBEN = 574;
const OFFEN_BIS_KNOPF = 17;
const OFFEN_NACH_KNOPF = 8;
const ERLEDIGT_HOEHE = 117;
const ERLEDIGT_BIS_KNOPF = 16;
const ERLEDIGT_NACH_KNOPF = 17;
const KNOPF_HOEHE = 51;
const MAX_FAHRTZEILEN = 5;
const WALLET_ABSTAND = 160;


function Punkte({ anzahl, aktiv, top }) {
  const breite = (anzahl - 1) * 17 + 7;
  return (
    <div className="absolute pointer-events-none" style={{ left: `${201 - breite / 2}px`, top: `${top}px`, width: `${breite}px`, height: '7px' }}>
      {Array.from({ length: anzahl }, (_, i) => (
        <span
          key={i}
          className="absolute top-0 w-[7px] h-[7px] rounded-full"
          style={{ left: `${i * 17}px`, background: LIME, opacity: i === aktiv ? 1 : 0.25 }}
        />
      ))}
    </div>
  );
}

// Status der Tage nach Figma 2596:12383: 12-px-Punkte im 22-px-Abstand,
// gruen = Tag bestaetigt (accept), grau = noch offen; weisser Rand 1 px.
function StatusPunkte({ status, top }) {
  const anzahl = status.length;
  const breite = (anzahl - 1) * 22 + 12;
  return (
    <div
      className="absolute pointer-events-none"
      data-tutorial="planer-tag-status"
      style={{ left: `${201 - breite / 2}px`, top: `${top}px`, width: `${breite}px`, height: '12px' }}
    >
      {status.map((bestaetigt, i) => (
        <span
          key={i}
          className="absolute top-0 w-[12px] h-[12px] rounded-full"
          style={{
            left: `${i * 22}px`,
            background: bestaetigt ? '#59be80' : '#888989',
            boxShadow: 'inset 0 0 0 1px #ffffff',
            transition: 'background-color 400ms ease',
          }}
        />
      ))}
    </div>
  );
}

// Adresse wie in Figma: "Strasse Nr, PLZ" (ohne Ort und Ortsname davor).
const kurzeAdresse = (text) => {
  const teile = String(text || '').split(',').map((teil) => teil.trim()).filter(Boolean);
  const plzIndex = teile.findIndex((teil) => /^\d{5}\b/.test(teil));
  if (plzIndex > 0) return `${teile[plzIndex - 1]}, ${teile[plzIndex].slice(0, 5)}`;
  return teile.length ? teile[0] : '';
};

function Fahrtzeile({ fahrt, mitte }) {
  return (
    <div
      className="absolute left-[18px] w-[285px] -translate-y-1/2 text-[12px] leading-[16px] tracking-[0.5px] overflow-hidden"
      style={{ top: `${mitte}px`, color: 'rgba(29,28,29,0.8)', maxHeight: '32px', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}
    >
      <span className="font-bold">{`${fahrt.etd} `}</span>
      <span className="font-normal">– </span>
      <span className="font-normal tracking-[1px]">{`${kurzeAdresse(fahrt.adresseAb) || fahrt.pickup} – ${kurzeAdresse(fahrt.adresseZiel) || fahrt.dropoff}`}</span>
      <span className="font-normal"> – </span>
      <span className="font-bold">{fahrt.ankunft}</span>
      {fahrt.sammel ? <span className="font-bold" style={{ color: '#2d6cff' }}> · Sammelfahrt</span> : null}
      {fahrt.route === 'FTO' ? <span className="font-bold" style={{ color: '#2d6cff' }}> · über Flughafentangente Ost</span> : null}
    </div>
  );
}

export default function EinsatzplanungTag({
  tage,
  index,
  heuteIso,
  eintrag,            // plannedByDay[tag]
  strategien,         // [{ key, labelKey }]
  strategieKey,
  laeuft,
  planLog,
  abgelehnt,          // Set
  uebernommen,        // Set
  supplyAll,
  bookedAll,
  demandAll,
  fehler,
  onZurueck,
  onIndex,
  onStrategie,
  onAnnehmen,
  onAblehnen,
  onRueckgaengig,
  onTagAnnehmen,
  onOeffnen,
  tagesStatus = [],   // je Tag: true = bestaetigt
  onNeuplanungZeigen,
  onEreignisse,
  onPuffer,
}) {
  const { t, locale } = useI18n();
  const [scale, setScale] = useState(1);
  const scrollRef = useRef(null);
  const tagIso = tage[index];
  const [engineHoehe, setEngineHoehe] = useState(0);
  const kartenOben = KARTEN_OBEN + (engineHoehe ? engineHoehe + 24 : 0);

  useEffect(() => {
    const aktualisieren = () => setScale(Math.min(window.innerWidth / BASIS_BREITE, 1));
    aktualisieren();
    window.addEventListener('resize', aktualisieren);
    return () => window.removeEventListener('resize', aktualisieren);
  }, []);

  // Beim Blaettern oben beginnen.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [index]);

  const titel = useMemo(
    () => new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(`${tagIso}T12:00:00`)),
    [locale, tagIso],
  );
  const tagIndex = Math.round((new Date(`${tagIso}T12:00:00`) - new Date(`${heuteIso}T12:00:00`)) / 86400000);

  const vorschlaege = useMemo(() => (eintrag?.suggestions || []).filter((v) => !abgelehnt.has(v.id)), [eintrag, abgelehnt]);
  const offene = vorschlaege.filter((v) => !uebernommen.has(v.id));
  const erledigte = vorschlaege.filter((v) => uebernommen.has(v.id));
  const reihenfolge = [...offene, ...erledigte];

  // --- Diagramm -----------------------------------------------------------
  const diagramm = useMemo(() => {
    const stunden = Array.from({ length: SLOTS }, (_, i) => ERSTE_STUNDE + i);
    const basis = tagIndex * 24;
    // Mit Plan: so viele Fahrzeuge sind in der Stunde hoechstens gleichzeitig
    // unterwegs. Eine Sammelfahrt belegt ein Fahrzeug, nicht eines je Fahrt.
    // Ohne Plan die Schaetzung aus der Fahrtenlast.
    const minute = (hhmm) => {
      const [hh, mm] = String(hhmm || '').split(':').map(Number);
      return Number.isFinite(hh) ? hh * 60 + (mm || 0) : null;
    };
    const belegt = vorschlaege.map((v) => (Array.isArray(v.rides) ? v.rides : [])
      .map((r) => [minute(r.etd), minute(r.etd) + (Number(r.durationMinutes) || 0)])
      .filter(([a]) => a != null));
    const bedarf = vorschlaege.length
      ? stunden.map((h) => {
        let spitze = 0;
        for (let m = h * 60; m < (h + 1) * 60; m += 5) {
          spitze = Math.max(spitze, belegt.filter((fz) => fz.some(([a, e]) => a <= m && e > m)).length);
        }
        return spitze;
      })
      : stunden.map((h) => Math.max(0, Number(demandAll?.[basis + h]) || 0));
    const gebucht = stunden.map((h) => Math.max(0, Number(bookedAll?.[basis + h]) || 0));
    // Fahrer im Dienst laut Tagesplan; ohne Plan der bestehende Bestand.
    // Ein Dienst zaehlt fuer jede Stunde, in die er faellt (wie die gebuchten
    // Fahrten), nicht nur zur halben Stunde.
    const fahrer = vorschlaege.length
      ? stunden.map((h) => vorschlaege.filter((v) => {
        const start = v.startMinutes ?? 0;
        const ende = v.endMinutes ?? start;
        return start < (h + 1) * 60 && ende > h * 60;
      }).length)
      : stunden.map((h) => Math.max(0, Number(supplyAll?.[basis + h]) || 0));
    return { stunden, bedarf, gebucht, fahrer };
  }, [tagIndex, demandAll, bookedAll, supplyAll, vorschlaege]);

  // --- Wallet ---------------------------------------------------------------
  const wallet = useMemo(() => walletWerte(vorschlaege), [vorschlaege]);

  // --- Layout der Karten ------------------------------------------------------
  const karten = [];
  let y = kartenOben;
  reihenfolge.forEach((v, position) => {
    const erledigt = uebernommen.has(v.id);
    if (erledigt) {
      karten.push({ v, position, erledigt, top: y, hoehe: ERLEDIGT_HOEHE, knopfTop: y + ERLEDIGT_HOEHE + ERLEDIGT_BIS_KNOPF });
      y += ERLEDIGT_HOEHE + ERLEDIGT_BIS_KNOPF + KNOPF_HOEHE + ERLEDIGT_NACH_KNOPF;
    } else {
      const rides = Array.isArray(v.rides) ? v.rides : [];
      const zeilen = rides.length > MAX_FAHRTZEILEN ? MAX_FAHRTZEILEN + 1 : Math.max(1, rides.length);
      const hoehe = 171 + (zeilen - 1) * 40;
      karten.push({ v, position, erledigt, top: y, hoehe, zeilen, knopfTop: y + hoehe + OFFEN_BIS_KNOPF });
      y += hoehe + OFFEN_BIS_KNOPF + KNOPF_HOEHE + OFFEN_NACH_KNOPF;
    }
  });
  const kartenEnde = karten.length
    ? karten[karten.length - 1].knopfTop + KNOPF_HOEHE
    : kartenOben + 60;
  const walletTop = kartenEnde + WALLET_ABSTAND;
  const hoehe = walletTop + 769;

  const strategie = strategien.find((s) => s.key === strategieKey) || strategien[0];
  const hatVorher = index > 0;
  const hatNachher = index < tage.length - 1;
  const tagFertig = vorschlaege.length > 0 && offene.length === 0;

  return (
    <div className="absolute inset-0 z-[60] bg-black" data-tutorial="planer-tagesplanung">
      <div aria-hidden="true" className="absolute inset-0 pointer-events-none" style={HINTERGRUND} />
      <div
        ref={scrollRef}
        className="relative h-dvh w-full overflow-y-auto overflow-x-hidden overscroll-none flex justify-center"
        style={{ WebkitTextSizeAdjust: 'none', textSizeAdjust: 'none', fontFamily: 'Space Grotesk, sans-serif' }}
      >
        <div className="relative shrink-0" style={{ width: `${BASIS_BREITE * scale}px`, height: `${hoehe * scale}px` }}>
          <div
            className="absolute left-0 top-0 w-[402px] origin-top-left"
            style={{ height: `${hoehe}px`, transform: `scale(${scale})` }}
          >
            <BackCircleButton onClick={onZurueck} className="absolute left-[20px] top-[40px]" marker="planer-tag-zurueck" />
            <Punkte anzahl={tage.length} aktiv={index} top={61} />

            <div
              className="absolute left-1/2 -translate-x-1/2 -translate-y-1/2 text-[24px] font-bold leading-[24px] tracking-[0.5px] whitespace-nowrap"
              style={{ top: '134px', color: LIME }}
            >
              {titel}
            </div>

            <EinsatzDiagramm
              oben={194}
              bedarf={diagramm.bedarf}
              gebucht={diagramm.gebucht}
              fahrer={diagramm.fahrer}
              marker="planer-tag-diagramm"
            />

            {/* Strategie — der Rahmen dient nur der Tutorial-Hervorhebung */}
            <div data-tutorial="planer-strategie" className="absolute left-[10px] w-[382px] h-[41px] pointer-events-none" style={{ top: `${REITER_Y - 20.5}px` }} />
            <div>
              {strategien.map((s, i) => {
                const aktiv = s.key === strategieKey;
                return (
                  <button
                    key={s.key}
                    type="button"
                    onClick={() => onStrategie(s.key)}
                    disabled={laeuft}
                    data-tutorial={`planer-strategie-${s.key}`}
                    className="absolute -translate-x-1/2 -translate-y-1/2 h-[40px] flex items-center justify-center"
                    style={{ left: `${REITER_X[i]}px`, top: `${REITER_Y}px`, width: '124px' }}
                  >
                    <span className="text-[16px] font-medium leading-[24px] tracking-[0.5px] whitespace-nowrap" style={{ color: LIME, opacity: aktiv ? 1 : 0.5 }}>
                      {t(s.labelKey)}
                    </span>
                    {aktiv ? (
                      <>
                        <span className="absolute w-[2px] h-[23px]" style={{ left: `${62 - 58.5}px`, top: '8.5px', background: LIME }} />
                        <span className="absolute w-[2px] h-[23px]" style={{ left: `${62 + 56.5}px`, top: '8.5px', background: LIME }} />
                      </>
                    ) : null}
                  </button>
                );
              })}
            </div>

            <EngineBlock
              tagIso={tagIso}
              eintrag={eintrag}
              laeuft={laeuft}
              onHoehe={setEngineHoehe}
              onNeuplanungZeigen={(antwort) => onNeuplanungZeigen?.(tagIso, antwort)}
              onEreignisse={onEreignisse}
              onPuffer={onPuffer}
            />

            {fehler ? (
              <div className="absolute left-[20px] w-[362px] text-[12px] font-medium tracking-[0.5px]" style={{ top: `${kartenOben - 34}px`, color: ROT }}>{fehler}</div>
            ) : null}

            {/* Vorschlaege */}
            {laeuft ? (
              // In der freien Zeile zwischen Reitern und Karten, damit nichts verdeckt wird.
              <div
                className="absolute left-[20px] w-[362px] -translate-y-1/2 text-center text-[12px] font-medium leading-[16px] tracking-[0.5px] overflow-hidden text-ellipsis whitespace-nowrap"
                style={{ top: `${kartenOben - 30}px`, color: LIME }}
              >
                {planLog || t('planer.planningInProgress')}
              </div>
            ) : null}
            {!laeuft && reihenfolge.length === 0 ? (
              <div className="absolute left-[20px] w-[362px] text-center text-[16px] font-medium tracking-[0.5px] opacity-60" style={{ top: `${kartenOben + 20}px`, color: LIME }}>
                {t('planer.emptyDay')}
              </div>
            ) : null}

            {karten.map(({ v, position, erledigt, top, hoehe: kartenHoehe, knopfTop }) => {
              const rides = Array.isArray(v.rides) ? v.rides : [];
              const sichtbar = rides.length > MAX_FAHRTZEILEN ? rides.slice(0, MAX_FAHRTZEILEN) : rides;
              return (
                <div key={v.id} style={{ opacity: laeuft ? 0.3 : 1, pointerEvents: laeuft ? 'none' : 'auto' }} className="transition-opacity duration-300">
                  <div
                    role="button"
                    tabIndex={0}
                    data-tutorial={`planer-vorschlag-${position}`}
                    onClick={() => onOeffnen(v, position)}
                    onKeyDown={(e) => { if (e.key === 'Enter') onOeffnen(v, position); }}
                    className="absolute left-[20px] w-[362px] bg-[#fefffe] overflow-hidden cursor-pointer"
                    style={{ top: `${top}px`, height: `${kartenHoehe}px` }}
                  >
                    <p className="absolute left-[18px] top-[18px] w-[262px] overflow-hidden text-ellipsis whitespace-nowrap text-[30px] font-bold tracking-[-0.5px] leading-[normal] text-[#1c1c1d]">
                      {`#${position + 1} ${v.name}`}
                    </p>
                    <div className="absolute right-[19px] -translate-y-1/2 text-right text-[15px] font-bold leading-[20px] text-black whitespace-nowrap" style={{ top: '44px' }}>
                      <p>{v.start}</p>
                      <p>{`– ${v.end}`}</p>
                    </div>
                    <div className="absolute right-[19px] -translate-y-1/2 text-right text-[15px] font-bold leading-[20px] whitespace-nowrap" style={{ top: '77px', color: GRUEN }}>
                      {`${v.hours}h`}
                    </div>

                    {!erledigt ? (
                      <>
                        {sichtbar.length ? sichtbar.map((fahrt, k) => (
                          <Fahrtzeile key={`${v.id}-${k}`} fahrt={fahrt} mitte={87 + k * 40} />
                        )) : (
                          <div className="absolute left-[18px] w-[285px] -translate-y-1/2 text-[12px] leading-[16px] tracking-[0.5px]" style={{ top: '87px', color: 'rgba(29,28,29,0.8)' }}>
                            {t('planer.standbyFallback')}
                          </div>
                        )}
                        {rides.length > MAX_FAHRTZEILEN ? (
                          <div className="absolute left-[18px] w-[285px] -translate-y-1/2 text-[12px] font-bold leading-[16px] tracking-[0.5px]" style={{ top: `${87 + MAX_FAHRTZEILEN * 40}px`, color: 'rgba(29,28,29,0.8)' }}>
                            {t('planer.moreRides', { n: rides.length - MAX_FAHRTZEILEN })}
                          </div>
                        ) : null}
                        <span className="absolute left-[17.5px] w-[324px] h-px" style={{ top: `${kartenHoehe - 52}px`, background: '#7e817f' }} />
                      </>
                    ) : null}

                    <div
                      className="absolute left-[18px] w-[226px] -translate-y-1/2 text-[12px] font-bold leading-[16px] text-black opacity-50 overflow-hidden text-ellipsis whitespace-nowrap"
                      style={{ top: `${kartenHoehe - (erledigt ? 18 : 27)}px` }}
                    >
                      {v.vehicleLabel ? `${v.vehicleIsEv ? 'EV – ' : ''}${v.vehicleLabel}` : t('planer.vehicleOpen')}
                    </div>
                    <div
                      className="absolute right-[18px] -translate-y-1/2 text-[12px] font-bold leading-[16px] text-black opacity-50 whitespace-nowrap"
                      style={{ top: `${kartenHoehe - (erledigt ? 18 : 27)}px` }}
                    >
                      {v.shiftKm != null ? `${v.shiftKm} km` : ''}
                    </div>
                  </div>

                  {erledigt ? (
                    <>
                      <button
                        type="button"
                        onClick={() => onRueckgaengig(v)}
                        data-tutorial={`planer-vorschlag-${position}-zuruecknehmen`}
                        aria-label={t('planer.undoAccept', { name: v.name })}
                        className="absolute left-[20px] w-[54px] h-[50.29px]"
                        style={{ top: `${knopfTop}px` }}
                      >
                        <img src="/icon/_Icon_Planung/x_knopf.svg" alt="" className="block w-full h-full" />
                      </button>
                      <div
                        className="absolute left-[82px] w-[300px] h-[51px] bg-[#e3f654] flex items-center justify-center gap-[10px]"
                        style={{ top: `${knopfTop}px` }}
                      >
                        <span className="text-black text-[24px] font-bold tracking-[-0.5px] leading-[normal] whitespace-nowrap">{t('planer.acceptedTitle')}</span>
                        <img src="/icon/_Icon_Planung/haken.svg" alt="" className="block w-[24.66px] h-[29.04px]" />
                      </div>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => onAblehnen(v.id)}
                        data-tutorial={`planer-vorschlag-${position}-ablehnen`}
                        className="absolute left-[20px] w-[178px] h-[51px] border-2 border-solid flex items-center justify-center"
                        style={{ top: `${knopfTop}px`, borderColor: ROT }}
                      >
                        <span className="text-[24px] font-bold tracking-[-0.5px] leading-[normal] whitespace-nowrap" style={{ color: ROT }}>{t('planer.refuse')}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => onAnnehmen(v)}
                        data-tutorial={`planer-vorschlag-${position}-annehmen`}
                        className="absolute left-[204px] w-[178px] h-[51px] bg-[#e3f654] border-2 border-solid border-[#e3f654] flex items-center justify-center"
                        style={{ top: `${knopfTop}px` }}
                      >
                        <span className="text-black text-[24px] font-bold tracking-[-0.5px] leading-[normal] whitespace-nowrap">{t('planer.accept')}</span>
                      </button>
                    </>
                  )}
                </div>
              );
            })}

            {/* Wallet-Karte */}
            <TagesWalletKarte titel={titel} wallet={wallet} marker="planer-wallet" className="left-[20px]" style={{ top: `${walletTop}px` }} />

            {/* Abschluss des Tages */}
            <div
              className="absolute left-1/2 -translate-x-1/2 -translate-y-1/2 text-[26px] font-medium leading-[24px] tracking-[0.5px] whitespace-nowrap"
              style={{ top: `${walletTop + 473}px`, color: LIME }}
            >
              {t(strategie.labelKey)}
            </div>
            <button
              type="button"
              onClick={() => hatVorher && onIndex(index - 1)}
              disabled={!hatVorher}
              data-tutorial="planer-tag-vorher"
              aria-label={t('planer.previousDay')}
              className="absolute left-[10px] w-[65px] h-[48px] flex items-center justify-center"
              style={{ top: `${walletTop + 509}px` }}
            >
              <img src={hatVorher ? '/icon/_Icon_Planung/weiter_gross.svg' : '/icon/_Icon_Planung/zurueck_gross.svg'} alt="" className="block w-[45px] h-[28px]" />
            </button>
            {/* accept fuellt sich von links, sobald der Tag uebernommen ist — und
                bleibt gefuellt wie die uebrigen accept-Knoepfe. */}
            <button
              type="button"
              onClick={() => { if (!tagFertig && !laeuft && offene.length) onTagAnnehmen(tagIso); }}
              disabled={laeuft || (!tagFertig && offene.length === 0)}
              aria-pressed={tagFertig}
              data-tutorial="planer-tag-accept"
              className="absolute left-[112px] w-[178px] h-[51px] border-2 border-solid flex items-center justify-center overflow-hidden disabled:opacity-50"
              style={{ top: `${walletTop + 507}px`, borderColor: LIME, cursor: tagFertig ? 'default' : 'pointer' }}
            >
              <span
                aria-hidden="true"
                className="absolute inset-0 origin-left"
                style={{
                  background: LIME,
                  transform: `scaleX(${tagFertig ? 1 : 0})`,
                  transition: 'transform 560ms cubic-bezier(0.65, 0, 0.35, 1)',
                }}
              />
              <span
                className="relative text-[24px] font-bold tracking-[-0.5px] leading-[normal] whitespace-nowrap"
                style={{ color: tagFertig ? '#000' : LIME, transition: 'color 260ms ease 220ms' }}
              >
                {t('planer.acceptDay')}
              </span>
            </button>
            <button
              type="button"
              onClick={() => hatNachher && onIndex(index + 1)}
              disabled={!hatNachher}
              data-tutorial="planer-tag-weiter"
              aria-label={t('planer.nextDay')}
              className="absolute left-[327px] w-[65px] h-[48px] flex items-center justify-center"
              style={{ top: `${walletTop + 509}px` }}
            >
              <img src={hatNachher ? '/icon/_Icon_Planung/weiter_gross.svg' : '/icon/_Icon_Planung/zurueck_gross.svg'} alt="" className="block w-[45px] h-[28px] rotate-180" />
            </button>
            <StatusPunkte status={tage.map((_, i) => Boolean(tagesStatus[i]))} top={walletTop + 579.5} />
          </div>
        </div>
      </div>
    </div>
  );
}
