import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { zeitZuTeilen } from './iosZeitHelfer';

// Zeitauswahl mit dem Werkzeug des Geraets.
//
// Auf einem echten Telefon oeffnet ein unsichtbares <input type="time"> die
// Zeitauswahl des Betriebssystems. In der Demo laeuft die App aber in einem
// simulierten iPhone auf dem Desktop — dort sieht die Zeitauswahl deshalb aus
// wie auf dem iPhone: Popover mit zwei Scrollraedern (Stunde, Minute).
//
//   <IosZeitauswahl wert="14:30" offen onAendern onSchliessen anker={{x,y}} />

const ZEILE = 32;           // Zeilenhoehe eines Rads (UIPickerView)
const SICHTBAR = 7;         // sichtbare Zeilen
const RAD_HOEHE = ZEILE * SICHTBAR; // 224
const WIEDERHOLUNGEN = 21;  // Endlosrad: Werte mehrfach hintereinander

const pad2 = (n) => String(n).padStart(2, '0');

function Rad({ anzahl, wert, onWert, beschriftung }) {
  const feldRef = useRef(null);
  const ruheTimer = useRef(0);
  const mitte = Math.floor(WIEDERHOLUNGEN / 2);

  // Zeilen je nach Abstand zur Mitte kippen und abblenden — wie die Walze.
  const zeichnen = useCallback(() => {
    const feld = feldRef.current;
    if (!feld) return;
    const pos = feld.scrollTop / ZEILE;
    const erste = Math.max(0, Math.floor(pos) - 5);
    const letzte = Math.min(feld.children.length - 1, Math.ceil(pos) + 5);
    for (let i = erste; i <= letzte; i += 1) {
      const zeile = feld.children[i];
      if (!zeile) continue;
      const abstand = i - pos;
      const winkel = Math.max(-80, Math.min(80, abstand * 20));
      zeile.style.transform = `rotateX(${-winkel}deg)`;
      zeile.style.opacity = String(Math.max(0.15, 1 - Math.abs(abstand) * 0.24));
    }
  }, []);

  const aufWertSpringen = useCallback((v) => {
    const feld = feldRef.current;
    if (!feld) return;
    feld.scrollTop = (mitte * anzahl + v) * ZEILE;
    zeichnen();
  }, [anzahl, mitte, zeichnen]);

  useLayoutEffect(() => {
    aufWertSpringen(wert);
    // nur beim Oeffnen setzen, sonst springt das Rad waehrend des Drehens
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onScroll = () => {
    zeichnen();
    window.clearTimeout(ruheTimer.current);
    ruheTimer.current = window.setTimeout(() => {
      const feld = feldRef.current;
      if (!feld) return;
      const index = Math.round(feld.scrollTop / ZEILE);
      const v = ((index % anzahl) + anzahl) % anzahl;
      // Unauffaellig in die mittlere Wiederholung zurueck, damit es endlos bleibt.
      if (Math.abs(index - (mitte * anzahl + v)) > anzahl * 3) aufWertSpringen(v);
      onWert(v);
    }, 110);
  };

  useEffect(() => () => window.clearTimeout(ruheTimer.current), []);

  const zeilen = [];
  for (let r = 0; r < WIEDERHOLUNGEN; r += 1) {
    for (let v = 0; v < anzahl; v += 1) {
      zeilen.push(
        <div
          key={`${r}-${v}`}
          className="ios-rad-zeile"
          onClick={() => {
            const feld = feldRef.current;
            if (feld) feld.scrollTo({ top: (r * anzahl + v) * ZEILE, behavior: 'smooth' });
          }}
        >
          {pad2(v)}
        </div>,
      );
    }
  }

  return (
    <div
      ref={feldRef}
      className="ios-rad"
      role="listbox"
      aria-label={beschriftung}
      onScroll={onScroll}
    >
      {zeilen}
    </div>
  );
}

export default function IosZeitauswahl({
  offen,
  wert,
  onAendern,
  onSchliessen,
  anker = { x: 20, y: 220 },
  breite = 250,
  beschriftungStunde = 'Stunde',
  beschriftungMinute = 'Minute',
  textZuruecksetzen = 'Zurücksetzen',
  textFertig = 'Fertig',
}) {
  const teile = zeitZuTeilen(wert) || { h: 12, m: 0 };
  const stand = useRef(teile);

  useEffect(() => {
    if (offen) stand.current = zeitZuTeilen(wert) || { h: 12, m: 0 };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offen]);

  if (!offen) return null;

  const setzen = (neu) => {
    stand.current = { ...stand.current, ...neu };
    onAendern?.(`${pad2(stand.current.h)}:${pad2(stand.current.m)}`);
  };

  return (
    <div className="absolute inset-0 z-[90]" onClick={onSchliessen} role="presentation">
      <div
        className="ios-zeit-popover"
        style={{ left: `${anker.x}px`, top: `${anker.y}px`, width: `${breite}px` }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
      >
        <div className="ios-zeit-kopf">
          <button type="button" onClick={() => { onAendern?.(''); onSchliessen?.(); }}>{textZuruecksetzen}</button>
          <button type="button" className="fertig" onClick={() => { setzen({}); onSchliessen?.(); }}>{textFertig}</button>
        </div>
        <div className="ios-zeit-raeder" style={{ height: `${RAD_HOEHE}px` }}>
          <div className="ios-zeit-auswahl" style={{ top: `${(RAD_HOEHE - 34) / 2}px` }} />
          <Rad anzahl={24} wert={teile.h} beschriftung={beschriftungStunde} onWert={(h) => setzen({ h })} />
          <Rad anzahl={60} wert={teile.m} beschriftung={beschriftungMinute} onWert={(m) => setzen({ m })} />
        </div>
      </div>
    </div>
  );
}
