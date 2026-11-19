import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import TrisarFooter from '../../ui/TrisarFooter';
import Bildschirmtastatur from '../../ui/Bildschirmtastatur';
import { tasteFuer, vorschlaegeFuer, ebeneFuer } from '../../ui/tastaturHelfer';
import { useI18n } from '../../../i18n';
import ZurueckKnopf from '../../ui/ZurueckKnopf';
import Fotogalerie from './Fotogalerie';
import FotoQuelleBlatt from './FotoQuelleBlatt';
import KameraBlatt from './KameraBlatt';
import { formLaden, ansichtSchluessel, drehBildAdresse } from '../../../shared/fahrzeugForm';

const BASE_WIDTH = 402;
const BASE_HEIGHT = 864;

const screenBg = {
  backgroundImage:
    "url(\"data:image/svg+xml;utf8,<svg viewBox='0 0 402 864' xmlns='http://www.w3.org/2000/svg' preserveAspectRatio='none'><rect x='0' y='0' height='100%' width='100%' fill='url(%23grad)' opacity='1'/><defs><radialGradient id='grad' gradientUnits='userSpaceOnUse' cx='0' cy='0' r='10' gradientTransform='matrix(40.2 86.4 -40.2 18.279 0 -1.9185e-13)'><stop stop-color='rgba(49,55,1,1)' offset='0'/><stop stop-color='rgba(25,28,0,1)' offset='0.2283'/><stop stop-color='rgba(12,14,0,1)' offset='0.34244'/><stop stop-color='rgba(0,0,0,1)' offset='0.45659'/><stop stop-color='rgba(0,0,0,1)' offset='0.83626'/><stop stop-color='rgba(0,0,0,1)' offset='1'/></radialGradient></defs></svg>\")",
};

// Im Demo-Rahmen (iPhone auf dem Desktop) gibt es keine echte Tastatur — dort
// faehrt die Bildschirmtastatur hoch wie im Login-Trailer.
const imRahmen = () => {
  try { return typeof window !== 'undefined' && window.parent && window.parent !== window; } catch { return false; }
};

// So viele Aufnahmen haengen hoechstens an einer Meldung.
const MAX_FOTOS = 3;

// Senkrechter Aufbau des Blatts (402 x 864).
const FOTO_TOP = 186;
const FOTO_HOEHE = 150;
const STELLE_TOP = 348;
const STELLE_HOEHE = 300;
// Mit drehbarem Auto braucht der Kasten "Stelle" Platz fuer Pfeile und Hinweis: Foto 30 px flacher.
const DREH_FOTO_HOEHE = 120;
const DREH_STELLE_TOP = 318;
const DREH_STELLE_HOEHE = 330;
const DREH_BUEHNE_HOEHE = 140;
const NOTIZ_TOP = 660;
const NOTIZ_HOEHE = 92;
const KNOPF_TOP = 764;
const INNENRAND = 20;
// Hoehe der Zeichenflaeche im Kasten "Stelle": Kasten minus Rand, Polster und
// Kopfzeile. Fest gesetzt, weil eine SVG ohne feste Hoehe ihre eigene
// Wunschhoehe durchdrueckt und den Kasten auseinanderzieht.
const WAGEN_FELD_HOEHE = 150;
// Bildschirmtastatur: Vorschlagsleiste 44, vier Tastenreihen 4*44 + 3*11,
// Streifen 34 -> 297 aufgerundet.
const TASTATUR_HOEHE = 297;
const TASTATUR_ABSTAND = 20;

// Aufsicht des Fahrzeugs, Front oben. Bewusst flaechig und gerade gezeichnet,
// keine Schatten und keine Verlaeufe — wie die uebrigen TRISAR-Zeichen.
const WAGEN = { breite: 120, hoehe: 240 };

// Neun Felder ueber der Aufsicht: drei Reihen (Front, Seite, Heck) mal drei
// Spalten (links, Mitte, rechts). Der Name entsteht aus beidem.
const REIHEN = [
  { bis: WAGEN.hoehe / 3, zeile: 'front' },
  { bis: (WAGEN.hoehe / 3) * 2, zeile: 'seite' },
  { bis: WAGEN.hoehe, zeile: 'heck' },
];
const SPALTEN = [
  { bis: WAGEN.breite / 3, seite: 'links' },
  { bis: (WAGEN.breite / 3) * 2, seite: 'mitte' },
  { bis: WAGEN.breite, seite: 'rechts' },
];

// Der Kreis der Markierung darf nicht ueber den Rand der Zeichnung hinaus —
// sonst schneidet ihn die SVG-Flaeche an. Fuer die Benennung zaehlt weiter der
// Punkt, an dem wirklich getippt wurde.
const MARKE_R = 17;
const MARKE_RAND = MARKE_R + 2;
const imBild = (wert, laenge) => Math.min(laenge - MARKE_RAND, Math.max(MARKE_RAND, wert));

// Kuerzel der neun Felder — dieselbe Sprache wie im bestehenden Bericht:
// "VL – Reifen", "VR – Tuer", "R – Spiegel".
const ZONEN_SCHLUESSEL = {
  'front-links': 'misc.zoneFL', 'front-mitte': 'misc.zoneF', 'front-rechts': 'misc.zoneFR',
  'seite-links': 'misc.zoneL', 'seite-mitte': 'misc.zoneRoof', 'seite-rechts': 'misc.zoneR',
  'heck-links': 'misc.zoneBL', 'heck-mitte': 'misc.zoneB', 'heck-rechts': 'misc.zoneBR',
};

// Bauteile zur Auswahl — der zweite Teil der Bezeichnung.
const BAUTEILE = [
  { kennung: 'reifen', schluessel: 'misc.partTyre' },
  { kennung: 'felge', schluessel: 'misc.partRim' },
  { kennung: 'tuer', schluessel: 'misc.partDoor' },
  { kennung: 'stossstange', schluessel: 'misc.partBumper' },
  { kennung: 'spiegel', schluessel: 'misc.partMirror' },
  { kennung: 'scheibe', schluessel: 'misc.partGlass' },
  { kennung: 'lack', schluessel: 'misc.partPaint' },
  { kennung: 'innenraum', schluessel: 'misc.partInterior' },
];

const feldFuer = (x, y) => {
  const reihe = REIHEN.find((r) => y <= r.bis) || REIHEN[REIHEN.length - 1];
  const spalte = SPALTEN.find((s) => x <= s.bis) || SPALTEN[SPALTEN.length - 1];
  return { zeile: reihe.zeile, seite: spalte.seite };
};

// Ohne onWaehlen nur zur Anzeige (Schadensbericht): kleiner, nicht antippbar.
export const WagenAufsicht = ({ punkt, onWaehlen, hoehe = WAGEN_FELD_HOEHE }) => {
  const ref = useRef(null);

  const tippen = (e) => {
    if (!onWaehlen) return;
    const flaeche = ref.current?.getBoundingClientRect();
    if (!flaeche || !flaeche.width) return;
    const x = ((e.clientX - flaeche.left) / flaeche.width) * WAGEN.breite;
    const y = ((e.clientY - flaeche.top) / flaeche.height) * WAGEN.hoehe;
    onWaehlen({ x, y, ...feldFuer(x, y) });
  };

  return (
    <svg
      ref={ref}
      viewBox={`0 0 ${WAGEN.breite} ${WAGEN.hoehe}`}
      preserveAspectRatio="xMidYMid meet"
      onClick={tippen}
      data-tutorial={onWaehlen ? 'schaden-stelle' : undefined}
      style={{ height: `${hoehe}px`, width: `${(hoehe * WAGEN.breite) / WAGEN.hoehe}px`, cursor: onWaehlen ? 'pointer' : 'default', flexShrink: 0 }}
    >
      {/* Raeder */}
      <rect x="5" y="40" width="13" height="36" fill="#1c1c1d" />
      <rect x="102" y="40" width="13" height="36" fill="#1c1c1d" />
      <rect x="5" y="164" width="13" height="36" fill="#1c1c1d" />
      <rect x="102" y="164" width="13" height="36" fill="#1c1c1d" />
      {/* Aussenspiegel */}
      <rect x="6" y="84" width="14" height="9" fill="#1c1c1d" />
      <rect x="100" y="84" width="14" height="9" fill="#1c1c1d" />
      {/* Karosserie */}
      <rect x="16" y="4" width="88" height="232" rx="24" fill="#f7f7f7" stroke="#1c1c1d" strokeWidth="3" />
      {/* Scheiben flaechig schwarz, Dach frei — wie die uebrigen TRISAR-Zeichen */}
      <path d="M31 100 L89 100 L83 72 L37 72 Z" fill="#1c1c1d" />
      <path d="M31 148 L89 148 L83 178 L37 178 Z" fill="#1c1c1d" />
      {/* Neun Trefferfelder, nur fuer das Tutorial: sie nehmen keine Beruehrung
          an (der Finger tippt weiter frei auf den Wagen), lassen sich aber
          einzeln ansteuern. */}
      {REIHEN.map((reihe, zi) => SPALTEN.map((spalte, si) => {
        const x = si * (WAGEN.breite / 3);
        const y = zi * (WAGEN.hoehe / 3);
        return (
          <rect
            key={`${reihe.zeile}-${spalte.seite}`}
            x={x}
            y={y}
            width={WAGEN.breite / 3}
            height={WAGEN.hoehe / 3}
            fill="transparent"
            pointerEvents="none"
            data-tutorial={onWaehlen ? `schaden-stelle-${reihe.zeile}-${spalte.seite}` : undefined}
            onClick={(e) => {
              e.stopPropagation();
              onWaehlen({
                x: x + WAGEN.breite / 6,
                y: y + WAGEN.hoehe / 6,
                zeile: reihe.zeile,
                seite: spalte.seite,
              });
            }}
          />
        );
      }))}
      {punkt ? (
        <>
          <circle
            cx={imBild(punkt.x, WAGEN.breite)}
            cy={imBild(punkt.y, WAGEN.hoehe)}
            r={MARKE_R}
            fill="#e3f754"
            stroke="#1c1c1d"
            strokeWidth="2.5"
          />
          <circle cx={imBild(punkt.x, WAGEN.breite)} cy={imBild(punkt.y, WAGEN.hoehe)} r="5" fill="#1c1c1d" />
        </>
      ) : null}
    </svg>
  );
};

// Drehbares Auto zum Markieren (Modelle mit Form, werkzeuge/fahrzeugbilder/form-bauen.py). Der Punkt
// sitzt auf der Karosserie und dreht mit, solange die Stelle zu sehen ist. Ist sie verdeckt, blendet er
// aus, "Zur Markierung" dreht zurueck. marke = { ansicht, bild: [u, v] im Drehbild, p: [x, y, z] in m }.
const MARKE_ROT = '#ff2d2d';
const Marke = ({ x, y, gross = true }) => {
  const d = gross ? 30 : 18;
  return (
    <div
      className="absolute pointer-events-none rounded-full"
      style={{
        left: `${x - d / 2}px`, top: `${y - d / 2}px`, width: `${d}px`, height: `${d}px`,
        border: `${gross ? 3 : 2}px solid ${MARKE_ROT}`, background: 'rgba(255,45,45,0.25)',
      }}
    >
      <div className="absolute rounded-full" style={{ left: '50%', top: '50%', width: '6px', height: '6px', margin: '-3px', background: MARKE_ROT }} />
    </div>
  );
};

// Wo das Drehbild (wie object-fit: contain) in einer Flaeche W x H liegt
const bildRahmen = (satz, W, H) => {
  const a = satz.breite / satz.hoehe;
  const w = Math.min(W, H * a);
  const h = w / a;
  return { x: (W - w) / 2, y: (H - h) / 2, w, h };
};

const DrehPfeil = ({ links, onClick, label }) => (
  <button
    type="button"
    aria-label={label}
    onClick={onClick}
    className="shrink-0 w-[40px] h-[30px] border border-[#dddcdc] bg-white flex items-center justify-center"
  >
    <svg width="9" height="14" viewBox="0 0 9 14" style={{ transform: links ? 'none' : 'scaleX(-1)' }}>
      <path d="M7.5 1.5 L2 7 L7.5 12.5" stroke="#1d1c1c" strokeWidth="2.2" fill="none" />
    </svg>
  </button>
);

export const DrehStelle = ({ satz, form, marke, onMarke }) => {
  const { t } = useI18n();
  const N = satz.info.bilder;
  const START = satz.info.start;
  const [pos, setPos] = useState(marke ? marke.ansicht : START);
  const posRef = useRef(pos);
  const buehneRef = useRef(null);
  const [flaeche, setFlaeche] = useState({ w: 0, h: 0 });
  const zug = useRef({ x0: null, p0: 0, bewegt: false, anim: 0 });

  const setzen = (p) => { posRef.current = p; setPos(p); };
  const k = ((Math.round(pos) % N) + N) % N;

  useLayoutEffect(() => {
    const el = buehneRef.current;
    if (!el) return undefined;
    const messen = () => setFlaeche({ w: el.clientWidth, h: el.clientHeight });
    messen();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(messen) : null;
    ro?.observe(el);
    return () => ro?.disconnect();
  }, []);

  // alle Ansichten vorladen, sonst ruckelt das Drehen
  useEffect(() => {
    for (let i = 0; i < N; i += 1) { const im = new Image(); im.src = drehBildAdresse(satz, i); }
    return () => cancelAnimationFrame(zug.current.anim);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [satz.modell, satz.lack, N]);

  const drehenNach = (ziel) => {
    cancelAnimationFrame(zug.current.anim);
    const von = posRef.current;
    let d = (((ziel - Math.round(von)) % N) + N) % N;
    if (d > N / 2) d -= N;
    const nach = Math.round(von) + d;
    const t0 = performance.now();
    const dauer = 220 + Math.abs(d) * 30;
    const schritt = (jetzt) => {
      const q = Math.min((jetzt - t0) / dauer, 1);
      setzen(von + (nach - von) * (1 - (1 - q) ** 3));
      if (q < 1) zug.current.anim = requestAnimationFrame(schritt);
    };
    zug.current.anim = requestAnimationFrame(schritt);
  };

  const rahmen = bildRahmen(satz, flaeche.w, flaeche.h);
  const sicht = marke ? (marke.ansicht === k ? marke.bild : form.sichtbar(marke.p, k)) : null;

  const runter = (e) => {
    cancelAnimationFrame(zug.current.anim);
    zug.current = { ...zug.current, x0: e.clientX, p0: posRef.current, bewegt: false };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const ziehen = (e) => {
    const z = zug.current;
    if (z.x0 === null) return;
    if (Math.abs(e.clientX - z.x0) > 6) z.bewegt = true;
    if (z.bewegt) setzen(z.p0 + (e.clientX - z.x0) / 9);
  };
  const los = (e) => {
    const z = zug.current;
    if (z.x0 === null) return;
    z.x0 = null;
    const fertig = Math.round(posRef.current);
    setzen(fertig);
    if (z.bewegt || e.type === 'pointercancel') return;
    // Tippen: Strahl durch den Bildpunkt, erster Treffer auf dem Auto
    const b = buehneRef.current.getBoundingClientRect();
    const u = ((e.clientX - b.left - rahmen.x) / rahmen.w) * satz.breite;
    const v = ((e.clientY - b.top - rahmen.y) / rahmen.h) * satz.hoehe;
    const ansicht = ((fertig % N) + N) % N;
    const P = form.treffen(ansicht, u, v);
    if (P) onMarke({ ansicht, bild: [u, v], p: P });
  };

  let hinweis = t('misc.damageRotateHint');
  if (marke && sicht) hinweis = marke.ansicht === k ? t('misc.damageSpotRetap') : t('misc.damageSpotMoves');

  return (
    <>
      <div
        ref={buehneRef}
        data-tutorial="schaden-stelle"
        className="relative overflow-hidden select-none cursor-grab active:cursor-grabbing mt-[6px]"
        style={{ height: `${DREH_BUEHNE_HOEHE}px`, touchAction: 'pan-y' }}
        onPointerDown={runter}
        onPointerMove={ziehen}
        onPointerUp={los}
        onPointerCancel={los}
      >
        <img
          src={drehBildAdresse(satz, k)}
          alt=""
          draggable={false}
          className="absolute pointer-events-none"
          style={{ left: `${rahmen.x}px`, top: `${rahmen.y}px`, width: `${rahmen.w}px`, height: `${rahmen.h}px`, maxWidth: 'none' }}
        />
        {sicht ? <Marke x={rahmen.x + (sicht[0] / satz.breite) * rahmen.w} y={rahmen.y + (sicht[1] / satz.hoehe) * rahmen.h} /> : null}
      </div>
      <div className="flex items-center justify-between mt-[6px]" style={{ fontFamily: 'Space Grotesk' }}>
        <DrehPfeil links label={t('misc.rotateLeft')} onClick={() => drehenNach(k - 4)} />
        <div className="flex flex-col items-center min-w-0 px-[6px] leading-[14px]">
          <span className="text-[#1d1c1c] text-[12px] font-bold tracking-[-0.3px]">{t(ansichtSchluessel(k))}</span>
          {marke && !sicht ? (
            <span className="flex items-center gap-[6px] text-[#9a9a9a] text-[10px] whitespace-nowrap">
              {t('misc.damageSpotHidden')}
              <button
                type="button"
                onClick={() => drehenNach(marke.ansicht)}
                className="bg-[#e3f754] text-black text-[10px] font-bold px-[8px] leading-[16px]"
              >
                {t('misc.damageToSpot')}
              </button>
            </span>
          ) : (
            <span className="text-[#9a9a9a] text-[10px] whitespace-nowrap">{hinweis}</span>
          )}
        </div>
        <DrehPfeil label={t('misc.rotateRight')} onClick={() => drehenNach(k + 4)} />
      </div>
    </>
  );
};

// Kleines Bild fuer den Schadensbericht: das Auto in der Ansicht, in der markiert wurde, mit Punkt.
// Nur zeigen, wenn die Meldung zum Bildsatz des Fahrzeugs passt (passtZuSatz).
export const StelleAnsicht = ({ satz, stelle, breite = 150, hoehe = 70 }) => {
  const r = bildRahmen(satz, breite, hoehe);
  return (
    <div className="relative shrink-0" style={{ width: `${breite}px`, height: `${hoehe}px` }}>
      <img
        src={drehBildAdresse(satz, stelle.ansicht)}
        alt=""
        className="absolute"
        style={{ left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px`, maxWidth: 'none' }}
      />
      <Marke gross={false} x={r.x + (stelle.bild[0] / satz.breite) * r.w} y={r.y + (stelle.bild[1] / satz.hoehe) * r.h} />
    </div>
  );
};

const PfeilIcon = () => (
  <svg width="34" height="20" viewBox="0 0 34 20" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M29.9128 11.911L29.9128 12.6154L20.2915 16.2337L20.2915 19.916L34 14.4085L34 10.6942L34 10.0218L34 5.50692L20.2915 -0.000561531L20.2915 3.68176L29.9128 7.30005L29.9128 8.00449L-1.09799e-06 8.0045L-9.12036e-07 10.0218L-8.50053e-07 10.6942L-7.37893e-07 11.911L29.9128 11.911Z" fill="#1c1c1d" />
  </svg>
);

const KameraIcon = () => (
  <svg width="34" height="28" viewBox="0 0 34 28" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M2 7H10L13 2H21L24 7H32V26H2V7Z" stroke="#1c1c1d" strokeWidth="2.5" fill="none" />
    <circle cx="17" cy="16" r="6.5" stroke="#1c1c1d" strokeWidth="2.5" fill="none" />
  </svg>
);

// Kopfzeile eines weissen Kastens: links die Bezeichnung, rechts der Stand.
const Kopf = ({ titel, wert }) => (
  <>
    <div className="flex items-baseline justify-between">
      <span className="text-[#dddcdc] text-[15px] font-bold tracking-[-0.5px]" style={{ fontFamily: 'Space Grotesk' }}>
        {titel}
      </span>
      {wert ? (
        <span className="text-[#1d1c1c] text-[14px] font-bold tracking-[-0.5px]" style={{ fontFamily: 'Space Grotesk' }}>
          {wert}
        </span>
      ) : null}
    </div>
    <div className="w-full h-[1px] bg-[#dddcdc] mt-[8px]" />
  </>
);

const SchadenMelden = ({ onClose, onConfirm, satz = null }) => {
  const { t } = useI18n();
  // Drehbares Auto, wenn es fuer das Modell eine Form gibt, sonst die Aufsicht wie bisher
  const [form, setForm] = useState(null);
  useEffect(() => {
    let aktiv = true;
    formLaden(satz).then((f) => { if (aktiv) setForm(f); });
    return () => { aktiv = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [satz?.modell]);
  const mitDreh = Boolean(satz && form);
  const [marke, setMarke] = useState(null);
  const markieren = (m) => {
    setMarke(m);
    setPunkt({ ...form.aufsicht(m.p), ...form.bereich(m.p) });
  };
  const fotoHoehe = mitDreh ? DREH_FOTO_HOEHE : FOTO_HOEHE;
  const stelleTop = mitDreh ? DREH_STELLE_TOP : STELLE_TOP;
  const stelleHoehe = mitDreh ? DREH_STELLE_HOEHE : STELLE_HOEHE;
  const [fotos, setFotos] = useState([]);
  // 'quelle' = die Abfrage des Geraets (Kamera oder Mediathek), 'galerie' = die
  // Mediathek selbst. Beides nur im Demo-Rahmen; auf dem Handy macht das
  // Betriebssystem das mit seinen eigenen Blaettern.
  const [auswahl, setAuswahl] = useState(null);
  const [punkt, setPunkt] = useState(null);
  const [bauteil, setBauteil] = useState(null);
  const [text, setText] = useState('');
  const [tastaturOben, setTastaturOben] = useState(false);
  const dateiRef = useRef(null);

  // Die Bauteile stehen in einer Reihe, die breiter ist als die Karte. Damit
  // man sieht, dass rechts noch Lack, Scheibe und Innenraum warten, laeuft die
  // Kante dort weich aus. Am Ende der Reihe faellt sie weg, links kommt sie
  // dazu, sobald man geschoben hat.
  const teileRef = useRef(null);
  const [teileRand, setTeileRand] = useState({ links: false, rechts: true });

  const teileGescrollt = () => {
    const reihe = teileRef.current;
    if (!reihe) return;
    const links = reihe.scrollLeft > 4;
    const rechts = reihe.scrollLeft + reihe.clientWidth < reihe.scrollWidth - 4;
    setTeileRand((alt) => (alt.links === links && alt.rechts === rechts ? alt : { links, rechts }));
  };

  useEffect(() => { teileGescrollt(); }, []);

  const AUSLAUF = 28;
  const teileMaske = (() => {
    if (!teileRand.links && !teileRand.rechts) return 'none';
    const anfang = teileRand.links ? `transparent, #000 ${AUSLAUF}px` : '#000 0';
    const ende = teileRand.rechts ? `#000 calc(100% - ${AUSLAUF}px), transparent` : '#000 100%';
    return `linear-gradient(to right, ${anfang}, ${ende})`;
  })();

  // Faehrt die Tastatur hoch, schiebt sich das Blatt so weit nach oben, dass
  // das Textfeld 20 px ueber der Tastatur endet — wie auf dem iPhone.
  const sichtbareHoehe = typeof window !== 'undefined' ? window.innerHeight : BASE_HEIGHT;
  // Das Blatt fuellt den Schirm von oben bis unten; der Inhalt haengt am
  // oberen Rand, ein Streifen bleibt nirgends stehen.
  const feldUnten = NOTIZ_TOP + NOTIZ_HOEHE - INNENRAND;
  const tastaturKante = sichtbareHoehe - TASTATUR_HOEHE - TASTATUR_ABSTAND;
  const verschiebung = tastaturOben ? Math.max(0, Math.round(feldUnten - tastaturKante)) : 0;

  const [getipptesZeichen, setGetipptesZeichen] = useState('');
  const [tastaturEbene, setTastaturEbene] = useState('abc');
  useEffect(() => {
    if (!getipptesZeichen) return undefined;
    const id = setTimeout(() => setGetipptesZeichen(''), 110);
    return () => clearTimeout(id);
  }, [getipptesZeichen]);

  const textAendern = (e) => {
    const neu = e.target.value;
    const zeichen = neu.length > text.length ? neu[neu.length - 1] : '';
    setText(neu);
    if (imRahmen()) setTastaturOben(true);
    if (zeichen) {
      setGetipptesZeichen(zeichen);
      const ebene = ebeneFuer(zeichen, false);
      if (ebene) setTastaturEbene(ebene);
    }
  };

  // Auf dem Handy fragt das Betriebssystem selbst, ob Kamera oder Mediathek.
  // Im Demo-Rahmen gibt es weder das eine noch das andere — dort werden die
  // Blaetter des iPhones nachgebaut, damit das Aussuchen zu sehen ist.
  const fotoAufnehmen = () => {
    if (imRahmen()) {
      setAuswahl('quelle');
      return;
    }
    dateiRef.current?.click();
  };

  // Fotos verkleinert als data-URL speichern (wie die iOS- und Android-App). Eine blob:-Adresse
  // gibt es nur in diesem Browser, die Dispo saehe sonst nie ein Bild.
  const alsDatenURL = (datei) => new Promise((fertig) => {
    const bild = new Image();
    const adresse = URL.createObjectURL(datei);
    bild.onload = () => {
      const s = Math.min(1, 900 / Math.max(bild.width, bild.height));
      const leinwand = document.createElement('canvas');
      leinwand.width = Math.round(bild.width * s);
      leinwand.height = Math.round(bild.height * s);
      leinwand.getContext('2d').drawImage(bild, 0, 0, leinwand.width, leinwand.height);
      URL.revokeObjectURL(adresse);
      fertig(leinwand.toDataURL('image/jpeg', 0.6));
    };
    bild.onerror = () => { URL.revokeObjectURL(adresse); fertig(null); };
    bild.src = adresse;
  });

  const dateiGewaehlt = async (e) => {
    const dateien = [...(e.target.files || [])].slice(0, MAX_FOTOS);
    if (!dateien.length) return;
    const bilder = (await Promise.all(dateien.map(alsDatenURL))).filter(Boolean);
    if (bilder.length) setFotos(bilder);
  };

  // "VL", mit gewaehltem Bauteil "VL – Felge".
  const kuerzel = punkt ? t(ZONEN_SCHLUESSEL[`${punkt.zeile}-${punkt.seite}`]) : '';
  const teilName = bauteil ? t(BAUTEILE.find((b) => b.kennung === bauteil).schluessel) : '';
  const stelleName = [kuerzel, teilName].filter(Boolean).join(' – ');

  const bereit = Boolean(punkt);

  return (
    <div
      // Der Verlauf liegt auf der ganzen Flaeche, nicht auf dem 864 px hohen
      // Inhaltsblock: ist das Fenster niedriger oder faehrt der Block wegen der
      // Tastatur nach oben, wurde der helle Bogen oben sonst abgeschnitten.
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm"
      style={screenBg}
    >
      <div
        className="relative mx-auto max-w-md w-full h-full"
        style={{
          width: `${BASE_WIDTH}px`,
          minHeight: `${BASE_HEIGHT}px`,
          transform: `translateY(-${verschiebung}px)`,
          transition: 'transform 460ms cubic-bezier(0.22,1,0.36,1)',
        }}
      >
        <ZurueckKnopf onClick={() => { setTastaturOben(false); onClose?.(); }} marker="schaden-zurueck" />

        <h1
          className="absolute left-[20px] right-[20px] top-[122px] text-[#e3f754] text-[42px] font-bold tracking-[-0.5px] leading-[42px]"
          style={{ fontFamily: 'Space Grotesk' }}
        >
          {t('misc.reportDamage')}
        </h1>

        {/* Foto */}
        <div className="absolute left-0 right-0 bg-[#1a1a1a] rounded-[12px]" style={{ top: `${FOTO_TOP}px`, height: `${fotoHoehe}px` }}>
          <button
            type="button"
            onClick={fotoAufnehmen}
            data-tutorial="schaden-foto"
            className="absolute left-[20px] right-[20px] top-[20px] bottom-[20px] bg-white overflow-hidden flex items-center justify-center gap-[12px]"
          >
            {fotos.length ? (
              <div className="w-full h-full flex gap-[2px]">
                {fotos.map((url) => (
                  <img key={url} src={url} alt="" className="flex-1 min-w-0 h-full object-cover" />
                ))}
              </div>
            ) : (
              <>
                <KameraIcon />
                <span
                  className="text-[#1d1c1c] text-[15px] font-bold tracking-[-0.5px]"
                  style={{ fontFamily: 'Space Grotesk' }}
                >
                  {t('misc.takePhoto')}
                </span>
              </>
            )}
          </button>
          {fotos.length ? (
            <span
              className="absolute right-[28px] bottom-[28px] bg-[#e3f754] text-black text-[11px] font-bold tracking-[-0.5px] px-[10px] py-[4px] pointer-events-none"
              style={{ fontFamily: 'Space Grotesk' }}
            >
              {t('misc.retakePhoto')}
            </span>
          ) : null}
          <input ref={dateiRef} type="file" accept="image/*" capture="environment" multiple onChange={dateiGewaehlt} className="hidden" />
        </div>

        {/* Stelle */}
        <div className="absolute left-0 right-0 bg-[#1a1a1a] rounded-[12px]" style={{ top: `${stelleTop}px`, height: `${stelleHoehe}px` }}>
          <div className="absolute left-[20px] right-[20px] top-[20px] bottom-[20px] bg-white p-[16px] flex flex-col">
            <Kopf titel={t('misc.damageSpot')} wert={stelleName || t(mitDreh ? 'misc.damageSpotHint3d' : 'misc.damageSpotHint')} />
            {mitDreh ? (
              <DrehStelle satz={satz} form={form} marke={marke} onMarke={markieren} />
            ) : (
              <div className="flex items-start justify-center pt-[8px]" style={{ height: `${WAGEN_FELD_HOEHE + 8}px` }}>
                <WagenAufsicht punkt={punkt} onWaehlen={setPunkt} />
              </div>
            )}

            {/* Bauteil — zweiter Teil der Bezeichnung, wie im Bericht */}
            <div
              ref={teileRef}
              onScroll={teileGescrollt}
              className={`${mitDreh ? 'mt-[10px]' : 'mt-[16px]'} flex gap-[6px] overflow-x-auto`}
              style={{
                scrollbarWidth: 'none',
                // Ausgeblendete Kanten zeigen, dass links oder rechts noch
                // Bauteile stehen. Ist die Reihe am Ende, faellt die Kante weg.
                maskImage: teileMaske,
                WebkitMaskImage: teileMaske,
                scrollBehavior: 'smooth',
              }}
            >
              {BAUTEILE.map((b) => {
                const an = bauteil === b.kennung;
                return (
                  <button
                    key={b.kennung}
                    type="button"
                    onClick={() => setBauteil(an ? null : b.kennung)}
                    data-tutorial={`schaden-teil-${b.kennung}`}
                    className="shrink-0 h-[30px] px-[10px] border text-[12px] font-bold tracking-[-0.5px]"
                    style={{
                      fontFamily: 'Space Grotesk',
                      background: an ? '#e3f754' : '#ffffff',
                      borderColor: an ? '#1c1c1d' : '#dddcdc',
                      color: '#1d1c1c',
                    }}
                  >
                    {t(b.schluessel)}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Notiz */}
        <div className="absolute left-0 right-0 bg-[#1a1a1a] rounded-[12px]" style={{ top: `${NOTIZ_TOP}px`, height: `${NOTIZ_HOEHE}px` }}>
          <div className="absolute left-[20px] right-[20px] top-[20px] bottom-[20px] bg-white overflow-hidden">
            <textarea
              value={text}
              data-tutorial="schaden-text"
              onChange={textAendern}
              onFocus={() => { if (imRahmen()) setTastaturOben(true); }}
              onClick={() => { if (imRahmen()) setTastaturOben(true); }}
              onBlur={() => setTastaturOben(false)}
              placeholder={t('misc.writePlaceholder')}
              className="w-full h-full p-[14px] text-[14px] text-[rgba(0,0,0,0.9)] placeholder:text-[rgba(129,129,129,0.5)] resize-none border-none outline-none bg-transparent tracking-[0.25px]"
              style={{ fontFamily: 'Space Grotesk' }}
            />
          </div>
        </div>

        {auswahl === 'quelle' ? (
          <FotoQuelleBlatt
            onClose={() => setAuswahl(null)}
            onGalerie={() => setAuswahl('galerie')}
            onKamera={() => setAuswahl('kamera')}
          />
        ) : null}

        {auswahl === 'kamera' ? (
          <KameraBlatt
            bild={`${import.meta.env.BASE_URL}schaden/felge-01.jpg`}
            onClose={() => setAuswahl(null)}
            onAufnahme={(url) => {
              setFotos([url]);
              setAuswahl(null);
            }}
          />
        ) : null}

        {auswahl === 'galerie' ? (
          <Fotogalerie
            onClose={() => setAuswahl(null)}
            onConfirm={(gewaehlt) => {
              setFotos(gewaehlt.slice(0, MAX_FOTOS));
              setAuswahl(null);
            }}
          />
        ) : null}

        {/* Abschicken */}
        <button
          type="button"
          disabled={!bereit}
          data-tutorial="schaden-abschicken"
          className="absolute left-[20px] right-[20px] flex items-center justify-between px-6"
          style={{
            top: `${KNOPF_TOP}px`,
            height: '56px',
            background: bereit ? '#e3f754' : '#3a3a3a',
          }}
          onClick={() => {
            if (!bereit) return;
            setTastaturOben(false);
            // Genaue Stelle fuer Dispo und Fahrzeugseite: Aufsicht 120 x 240, Front oben. Mit drehbarem
            // Auto dazu Modell, Ansicht, Bildpunkt im Drehbild und Punkt am Auto (mm).
            const genau = {
              x: punkt.x,
              y: punkt.y,
              ...(bauteil ? { bauteil } : {}),
              ...(mitDreh && marke ? {
                modell: satz.modell,
                ansicht: marke.ansicht,
                bild: marke.bild.map((w) => Math.round(w * 10) / 10),
                p: marke.p.map((w) => Math.round(w * 1000)),
              } : {}),
            };
            onConfirm?.({ stelle: stelleName, beschreibung: text, fotos, genau });
          }}
        >
          <span
            className="text-[16px] font-bold tracking-[-0.5px]"
            style={{ fontFamily: 'Space Grotesk', color: bereit ? '#000000' : '#868786' }}
          >
            {t('misc.sendDamage')}
          </span>
          {bereit ? <PfeilIcon /> : null}
        </button>
      </div>

      {/* Fussleiste und Tastatur stehen fest — ausserhalb des verschobenen Inhalts. */}
      <TrisarFooter className="fixed bottom-0 left-0 right-0 h-10 bg-black z-30" />
      <Bildschirmtastatur
        oben={tastaturOben}
        aktiveTaste={tasteFuer(getipptesZeichen)}
        ebene={tastaturEbene}
        vorschlaege={vorschlaegeFuer(text)}
      />

    </div>
  );
};

export default SchadenMelden;
