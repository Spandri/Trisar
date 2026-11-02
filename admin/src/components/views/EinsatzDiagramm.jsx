import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../../i18n';

// Tagesdiagramm der Einsatzplanung nach Figma 2588:12036: Legende, Raster mit
// vier Abschnitten, Fahrer als Balken, Bedarf (weiss, Punkte lime/rot) und
// gebuchte Fahrten (blau), 20 Stunden von 06:00 bis 01:00.
//
// In der Bedarfsuebersicht ist der Bedarf ziehbar: nach oben, wenn mehr Fahrer
// gebraucht werden, als die Buchungen zeigen, nach unten bis 0. Waehrend des
// Ziehens bleibt die Skala stehen (der Punkt bleibt unter dem Finger) und der
// Punkt darf ueber das Raster hinaus; beim Loslassen passt sich die y-Achse
// weich an.
//
//   oben  y-Mitte der Legende (Tagesplanung: 194). Alles andere haengt daran.

const LIME = '#e3f654';
const GRUEN = '#59be80';
const ROT = '#ff6f63';
const BLAU = '#0059ff';

const DIAGRAMM_ERSTE_STUNDE = 6;

const BALKEN_X0 = 66;
const BALKEN_ABSTAND = 16;
const BALKEN_BREITE = 12;
const REF_LEGENDE = 194;   // Figma-Koordinaten, auf die sich das SVG bezieht
const RASTER_OBEN = 240;
const RASTER_SCHRITT = 50;
const NULLLINIE = 440;
const BALKEN_UNTEN = 437;
const SVG_HOEHE = 470;

const pad2 = (n) => String(n).padStart(2, '0');

const schoeneSchrittweite = (spitze) => {
  const roh = Math.max(1, spitze) / 4;
  return [1, 2, 5, 10, 20, 25, 50, 100].find((s) => s >= roh) || Math.ceil(roh / 100) * 100;
};

export default function EinsatzDiagramm({
  oben = REF_LEGENDE,
  bedarf,
  gebucht,
  fahrer,
  bedarfBasis = null,
  ziehbar = false,
  onBedarf,
  marker,
}) {
  const { t } = useI18n();
  const svgRef = useRef(null);
  const ziehRef = useRef(null);
  const [ziehIndex, setZiehIndex] = useState(null);
  const [festSchritt, setFestSchritt] = useState(null);

  const spitze = Math.max(...bedarf, ...gebucht, ...fahrer, 4);
  const schrittFrei = schoeneSchrittweite(spitze);
  // Waehrend des Ziehens bleibt die Skala stehen, sonst springt der Punkt.
  const schritt = festSchritt ?? schrittFrei;
  const zielMax = schritt * 4;
  // Angezeigte Skala gleitet zur Zielskala, statt zu springen.
  const [anzeigeMax, setAnzeigeMax] = useState(zielMax);
  const anzeigeRef = useRef(zielMax);
  useEffect(() => {
    const von = anzeigeRef.current;
    if (von === zielMax) return undefined;
    const beginn = performance.now();
    let bild = 0;
    const schrittAnimation = (jetzt) => {
      const f = Math.min(1, (jetzt - beginn) / 380);
      const weich = 1 - (1 - f) ** 3;
      const wert = von + (zielMax - von) * weich;
      anzeigeRef.current = wert;
      setAnzeigeMax(wert);
      if (f < 1) bild = requestAnimationFrame(schrittAnimation);
    };
    bild = requestAnimationFrame(schrittAnimation);
    return () => cancelAnimationFrame(bild);
  }, [zielMax]);
  const max = zielMax;
  const wertY = (v) => NULLLINIE - (v / anzeigeMax) * 200;
  const slotMitte = (i) => BALKEN_X0 + i * BALKEN_ABSTAND + 6;
  const versatz = oben - REF_LEGENDE;

  const wertAusZeiger = (event) => {
    const svg = svgRef.current;
    if (!svg) return null;
    const box = svg.getBoundingClientRect();
    const y = ((event.clientY - box.top) / box.height) * SVG_HOEHE;
    return Math.round(((NULLLINIE - y) / 200) * (ziehRef.current ? ziehRef.current.schritt * 4 : max));
  };

  const ziehStart = (i, event) => {
    if (!ziehbar) return;
    event.preventDefault();
    try { event.currentTarget.setPointerCapture?.(event.pointerId); } catch { /* Zeiger schon weg */ }
    ziehRef.current = { i, schritt };
    setFestSchritt(schritt);
    setZiehIndex(i);
  };
  const ziehen = (event) => {
    const zug = ziehRef.current;
    if (!zug) return;
    const roh = wertAusZeiger(event);
    if (roh == null) return;
    // Nach unten bis 0, nach oben auch ueber das Raster hinaus.
    const wert = Math.max(0, Math.min(999, roh));
    if (wert !== bedarf[zug.i]) onBedarf?.(zug.i, wert);
  };
  const ziehEnde = () => {
    ziehRef.current = null;
    setFestSchritt(null);
    setZiehIndex(null);
  };

  const legende = (links, text) => (
    <div className="absolute -translate-y-1/2 text-[12px] font-medium leading-[16px] tracking-[0.5px] whitespace-nowrap" style={{ left: `${links}px`, top: `${oben}px`, color: LIME }}>
      {text}
    </div>
  );

  return (
    <>
      {legende(16, t('planer.legendDrivers'))}
      <span className="absolute w-[12px] h-[12px]" style={{ left: '66px', top: `${oben - 6}px`, background: GRUEN }} />
      {legende(102, t('planer.legendDemand'))}
      <span className="absolute w-[12px] h-[12px] rounded-full border border-black" style={{ left: '195px', top: `${oben - 6}px`, background: LIME }} />
      <span className="absolute w-[12px] h-[12px] rounded-full border border-black" style={{ left: '219px', top: `${oben - 6}px`, background: ROT }} />
      {legende(253, t('planer.legendBooked'))}
      <span className="absolute w-[9px] h-[2px]" style={{ left: '370px', top: `${oben - 1}px`, background: BLAU }} />

      <svg
        ref={svgRef}
        data-tutorial={marker}
        className="absolute left-0"
        style={{ top: `${versatz}px`, overflow: 'visible', pointerEvents: ziehbar ? 'auto' : 'none', touchAction: ziehbar ? 'none' : 'auto' }}
        width="402"
        height={SVG_HOEHE}
        viewBox={`0 0 402 ${SVG_HOEHE}`}
        onPointerMove={ziehen}
        onPointerUp={ziehEnde}
        onPointerCancel={ziehEnde}
      >
        {[0, 1, 2, 3, 4].map((k) => (
          <g key={`raster-${k}`}>
            <line x1="20" x2="382" y1={RASTER_OBEN + k * RASTER_SCHRITT + 0.5} y2={RASTER_OBEN + k * RASTER_SCHRITT + 0.5} stroke={LIME} strokeWidth="1" />
            <text x="20" y={228 + k * RASTER_SCHRITT} dominantBaseline="central" fill={LIME} fontSize="16" fontWeight="500" letterSpacing="0.5" fontFamily="Space Grotesk">
              {max - k * schritt}
            </text>
          </g>
        ))}
        {fahrer.map((v, i) => {
          if (v <= 0) return null;
          const h = Math.max(BALKEN_BREITE, (Math.min(v, anzeigeMax) / anzeigeMax) * 200 - 3);
          return <rect key={`balken-${i}`} x={BALKEN_X0 + i * BALKEN_ABSTAND} y={BALKEN_UNTEN - h} width={BALKEN_BREITE} height={h} fill={GRUEN} />;
        })}
        {/* Berechneter Bedarf, gestrichelt, wo per Hand erhoeht wurde */}
        {bedarfBasis ? bedarf.map((v, i) => (v !== Math.round(bedarfBasis[i] ?? 0) ? (
          <line
            key={`basis-${i}`}
            x1={slotMitte(i)}
            x2={slotMitte(i)}
            y1={wertY(bedarfBasis[i] ?? 0)}
            y2={wertY(v)}
            stroke={LIME}
            strokeWidth="1.5"
            strokeDasharray="2 3"
            opacity="0.7"
          />
        ) : null)) : null}
        <polyline
          points={bedarf.map((v, i) => `${slotMitte(i) + 0.5},${wertY(v)}`).join(' ')}
          fill="none"
          stroke="white"
          strokeWidth="2"
        />
        <polyline
          points={gebucht.map((v, i) => `${slotMitte(i) - 0.5},${wertY(v)}`).join(' ')}
          fill="none"
          stroke={BLAU}
          strokeWidth="2"
        />
        {bedarf.map((v, i) => {
          const differenz = bedarfBasis ? v - Math.round(bedarfBasis[i] ?? 0) : 0;
          const erhoeht = differenz !== 0;
          const aktiv = ziehIndex === i;
          return (
            <g key={`punkt-${i}`}>
              <circle
                cx={slotMitte(i)}
                cy={wertY(v)}
                r={aktiv ? 6.5 : 4.5}
                fill={v > fahrer[i] ? ROT : LIME}
                stroke={erhoeht ? 'white' : 'black'}
                strokeWidth={erhoeht ? 1.5 : 1}
                style={{ transition: 'r 120ms ease' }}
              />
              {erhoeht ? (
                <text x={slotMitte(i)} y={differenz > 0 ? wertY(v) - 11 : wertY(v) + 19} textAnchor="middle" fill={LIME} fontSize="10" fontWeight="700" fontFamily="Space Grotesk">
                  {differenz > 0 ? `+${differenz}` : `−${Math.abs(differenz)}`}
                </text>
              ) : null}
              {ziehbar ? (
                <rect
                  x={slotMitte(i) - 8}
                  y={Math.min(RASTER_OBEN, wertY(v)) - 14}
                  width="16"
                  height={NULLLINIE - Math.min(RASTER_OBEN, wertY(v)) + 18}
                  fill="transparent"
                  style={{ cursor: 'ns-resize' }}
                  data-tutorial={marker ? `${marker}-punkt-${i}` : undefined}
                  onPointerDown={(event) => ziehStart(i, event)}
                />
              ) : null}
            </g>
          );
        })}
        {[0, 1, 2, 3, 4, 5, 6].map((k) => {
          const x = slotMitte(k * 3) - 0.5;
          return (
            <g key={`tick-${k}`}>
              <line x1={x} x2={x} y1="439.5" y2="446.5" stroke={LIME} strokeWidth="2" />
              <text x={x} y="455" dominantBaseline="central" textAnchor="middle" fill={LIME} fontSize="11" fontWeight="500" letterSpacing="0.5" fontFamily="Space Grotesk">
                {`${pad2((DIAGRAMM_ERSTE_STUNDE + k * 3) % 24)}:00`}
              </text>
            </g>
          );
        })}
      </svg>
    </>
  );
}
