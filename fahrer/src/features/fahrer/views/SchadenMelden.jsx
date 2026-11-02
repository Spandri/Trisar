import React, { useEffect, useRef, useState } from 'react';
import TrisarFooter from '../../../components/ui/TrisarFooter';
import Bildschirmtastatur from '../../../components/ui/Bildschirmtastatur';
import { tasteFuer, vorschlaegeFuer, ebeneFuer } from '../../../components/ui/tastaturHelfer';
import { useI18n } from '../../../i18n';
import ZurueckKnopf from '../../../components/ui/ZurueckKnopf';
import Fotogalerie from './Fotogalerie';
import FotoQuelleBlatt from './FotoQuelleBlatt';
import KameraBlatt from './KameraBlatt';

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

const WagenAufsicht = ({ punkt, onWaehlen }) => {
  const ref = useRef(null);

  const tippen = (e) => {
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
      data-tutorial="schaden-stelle"
      style={{ height: `${WAGEN_FELD_HOEHE}px`, width: `${(WAGEN_FELD_HOEHE * WAGEN.breite) / WAGEN.hoehe}px`, cursor: 'pointer' }}
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
            data-tutorial={`schaden-stelle-${reihe.zeile}-${spalte.seite}`}
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

const SchadenMelden = ({ onClose, onConfirm }) => {
  const { t } = useI18n();
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

  const dateiGewaehlt = (e) => {
    const dateien = [...(e.target.files || [])].slice(0, MAX_FOTOS);
    if (dateien.length) setFotos(dateien.map((d) => URL.createObjectURL(d)));
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
        <div className="absolute left-0 right-0 bg-[#1a1a1a] rounded-[12px]" style={{ top: `${FOTO_TOP}px`, height: `${FOTO_HOEHE}px` }}>
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
        <div className="absolute left-0 right-0 bg-[#1a1a1a] rounded-[12px]" style={{ top: `${STELLE_TOP}px`, height: `${STELLE_HOEHE}px` }}>
          <div className="absolute left-[20px] right-[20px] top-[20px] bottom-[20px] bg-white p-[16px] flex flex-col">
            <Kopf titel={t('misc.damageSpot')} wert={stelleName || t('misc.damageSpotHint')} />
            <div className="flex items-start justify-center pt-[8px]" style={{ height: `${WAGEN_FELD_HOEHE + 8}px` }}>
              <WagenAufsicht punkt={punkt} onWaehlen={setPunkt} />
            </div>

            {/* Bauteil — zweiter Teil der Bezeichnung, wie im Bericht */}
            <div
              ref={teileRef}
              onScroll={teileGescrollt}
              className="mt-[16px] flex gap-[6px] overflow-x-auto"
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
            onConfirm?.({ stelle: stelleName, beschreibung: text, fotos });
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
