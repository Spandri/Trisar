import { useEffect, useMemo, useRef, useState } from 'react';
import BackCircleButton from '../ui/BackCircleButton';
import { GesamtWalletKarte, GESAMT_KARTE_HOEHE, TAGES_KARTE_HOEHE, TagesWalletKarte } from './EinsatzWalletKarte';
import { walletWerte } from './einsatzWallet';
import { useI18n } from '../../i18n';

// KI Einsatzplanung, Hauptansicht nach der Planung: alle Tage des Einsatzes.
// Umsetzung von Figma Trisar_App_01 / Node 2571:12781 (Tageskarte) und
// 2596:12648 (Gesamtkarte), je 402 x 873.
//   - Karten wischen: die Karte folgt dem Finger, kippt dabei raeumlich weg
//     und rastet mit einer Feder auf der naechsten Karte ein
//   - als letzte Karte der ganze Einsatz
//   - Tipp auf eine Tageskarte oeffnet die Planung dieses Tages
//   - jede Karte laesst sich als Bild teilen: der ganze Bildschirm mit
//     Hintergrund und Karte, aber ohne Knoepfe, Punkte und Navigationsleiste
//   - "Neue Planung" fuehrt in den Kalender

const LIME = '#e3f654';
const BASIS_BREITE = 402;
const BASIS_HOEHE = 873;

const TAGES_KARTE_OBEN = 127;
const GESAMT_KARTE_OBEN = 159;
const PUNKTE_OBEN_TAG = 580;
const PUNKTE_OBEN_GESAMT = 568;
const KNOPF_OBEN = 629;

// Wischflaeche: vom Zurueck-Knopf bis unter die Punkte.
const WISCH_OBEN = 100;
const WISCH_HOEHE = 500;

// Karussell
const KIPP_GRAD = 38;          // Drehung um die Hochachse je Karte Abstand
const SCHRUMPFEN = 0.16;       // kleiner werden je Karte Abstand
const VERSATZ = 402;           // Verschiebung je Karte Abstand
const FEDER_STEIFE = 240;
const FEDER_DAEMPFUNG = 0.78;  // < 1: leichtes Nachschwingen beim Einrasten
const KLICK_SCHWELLE = 6;      // ab so vielen Pixeln ist es ein Wischen

const HINTERGRUND_SVG = "<svg viewBox='0 0 402 873' xmlns='http://www.w3.org/2000/svg' preserveAspectRatio='none'><rect x='0' y='0' height='100%' width='100%' fill='url(#grad)' opacity='1'/><defs><radialGradient id='grad' gradientUnits='userSpaceOnUse' cx='0' cy='0' r='10' gradientTransform='matrix(43.25 96.3 -44.344 19.869 1.3947e-15 1.9384e-13)'><stop stop-color='rgba(49,55,1,1)' offset='0'/><stop stop-color='rgba(25,28,0,1)' offset='0.2283'/><stop stop-color='rgba(12,14,0,1)' offset='0.34244'/><stop stop-color='rgba(0,0,0,1)' offset='0.45659'/><stop stop-color='rgba(0,0,0,1)' offset='0.6782'/><stop stop-color='rgba(0,6,16,1)' offset='0.69832'/><stop stop-color='rgba(0,11,32,1)' offset='0.71843'/><stop stop-color='rgba(0,22,64,1)' offset='0.75865'/><stop stop-color='rgba(0,33,96,1)' offset='0.79888'/><stop stop-color='rgba(0,45,128,1)' offset='0.8391'/><stop stop-color='rgba(0,67,191,1)' offset='0.91955'/><stop stop-color='rgba(0,89,255,1)' offset='1'/></radialGradient></defs></svg>";
const HINTERGRUND_URL = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(HINTERGRUND_SVG)}`;
const HINTERGRUND = {
  backgroundImage: `url("${HINTERGRUND_URL}")`,
  backgroundSize: '100% 100%',
  backgroundRepeat: 'no-repeat',
};

// --- Bild zum Teilen ---------------------------------------------------------
// Der Bildschirm wird auf ein Canvas nachgezeichnet: Hintergrund und die Karte
// an ihrer Stelle — Zurueck, Teilen, Punkte, Knoepfe und Leiste bleiben weg.

const BILD_FAKTOR = 3;

const bildLaden = (src) => new Promise((resolve, reject) => {
  const bild = new Image();
  bild.onload = () => resolve(bild);
  bild.onerror = reject;
  bild.src = src;
});

const bildschirmZeichnen = async ({ gesamt, titel, wallet, t }) => {
  const canvas = document.createElement('canvas');
  canvas.width = BASIS_BREITE * BILD_FAKTOR;
  canvas.height = BASIS_HOEHE * BILD_FAKTOR;
  const ctx = canvas.getContext('2d');
  ctx.scale(BILD_FAKTOR, BILD_FAKTOR);

  try {
    await Promise.all([
      document.fonts?.load('700 32px "Space Grotesk"'),
      document.fonts?.load('500 22px "Space Grotesk"'),
    ]);
  } catch {
    // Ohne Schrift zeichnet das Canvas mit der Ersatzschrift.
  }

  const pfad = gesamt
    ? { rahmen: 'gesamt_rahmen', logo: 'gesamt_logo', strich: 'gesamt_strich', kurz: 'gesamt_strich_kurz' }
    : { rahmen: 'wallet', logo: 'wallet_logo', strich: 'wallet_strich', kurz: 'wallet_strich' };
  const [grund, rahmen, logo, strich, kurz] = await Promise.all([
    bildLaden(HINTERGRUND_URL),
    ...[pfad.rahmen, pfad.logo, pfad.strich, pfad.kurz].map((name) => bildLaden(`/icon/_Icon_Planung/${name}.svg`)),
  ]);

  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, BASIS_BREITE, BASIS_HOEHE);
  ctx.drawImage(grund, 0, 0, BASIS_BREITE, BASIS_HOEHE);

  const x0 = 20;
  const y0 = gesamt ? GESAMT_KARTE_OBEN : TAGES_KARTE_OBEN;
  const farbe = gesamt ? LIME : '#000';
  ctx.drawImage(rahmen, x0, y0, 362, gesamt ? GESAMT_KARTE_HOEHE : TAGES_KARTE_HOEHE);
  ctx.drawImage(logo, x0 + 117, y0 + 26, 128.081, 19);
  if (gesamt) {
    ctx.drawImage(kurz, x0 + 32, y0 + 78.5, 35.5, 1);
    ctx.drawImage(kurz, x0 + 295, y0 + 78.5, 35.5, 1);
  } else {
    ctx.drawImage(strich, x0 + 29, y0 + 78.5, 70.5, 1);
    ctx.drawImage(strich, x0 + 260, y0 + 78.5, 70.5, 1);
  }
  const preisOben = gesamt ? 346.5 : 396.5;
  ctx.drawImage(strich, x0 + 33, y0 + preisOben, 70.5, 1);
  ctx.drawImage(strich, x0 + 260, y0 + preisOben, 70.5, 1);

  if ('letterSpacing' in ctx) ctx.letterSpacing = '0.5px';
  ctx.fillStyle = farbe;
  ctx.textBaseline = 'middle';

  const text = (inhalt, x, y, { groesse, gewicht = 500, ausrichtung = 'left', deckkraft = 1 }) => {
    ctx.globalAlpha = deckkraft;
    ctx.font = `${gewicht} ${groesse}px "Space Grotesk", sans-serif`;
    ctx.textAlign = ausrichtung;
    ctx.fillText(inhalt, x, y);
    ctx.globalAlpha = 1;
  };

  text(titel, x0 + 181, y0 + 79, { groesse: 18, gewicht: 700, ausrichtung: 'center' });

  const zeilen = [
    ...(gesamt ? [] : [[t('planer.walletStart'), wallet.start, t('planer.walletEnd'), wallet.ende]]),
    [t('planer.walletDrivers'), wallet.fahrer, t('planer.walletCustomers'), wallet.kunden],
    [t('planer.walletAvg'), wallet.schnitt, t('planer.walletRides'), wallet.fahrten],
    [t('planer.walletKm'), wallet.km, null, wallet.co2],
  ];
  const labelOben = gesamt ? 129 : 111;
  zeilen.forEach(([lLabel, lWert, rLabel, rWert], zeile) => {
    const labelY = y0 + labelOben + zeile * 68;
    const wertY = labelY + 24;
    text(lLabel, x0 + 20, labelY, { groesse: 13, deckkraft: 0.4 });
    text(lWert, x0 + 20, wertY, { groesse: 22 });
    if (rLabel) {
      text(rLabel, x0 + 342, labelY, { groesse: 13, ausrichtung: 'right', deckkraft: 0.4 });
    } else {
      // "CO2 Verbrauch" mit kleiner 2, rechtsbuendig auf einer Grundlinie.
      const rest = ` ${t('planer.walletCo2')}`;
      ctx.font = '500 13px "Space Grotesk", sans-serif';
      const breiteCo = ctx.measureText('CO').width;
      const breiteRest = ctx.measureText(rest).width;
      ctx.font = '500 8.385px "Space Grotesk", sans-serif';
      const breiteZwei = ctx.measureText('2').width;
      let x = x0 + 342 - (breiteCo + breiteZwei + breiteRest);
      ctx.textBaseline = 'alphabetic';
      const grundlinie = labelY + 4.5;
      text('CO', x, grundlinie, { groesse: 13, deckkraft: 0.4 });
      x += breiteCo;
      text('2', x, grundlinie, { groesse: 8.385, deckkraft: 0.4 });
      x += breiteZwei;
      text(rest, x, grundlinie, { groesse: 13, deckkraft: 0.4 });
      ctx.textBaseline = 'middle';
    }
    text(rWert, x0 + 342, wertY, { groesse: 22, ausrichtung: 'right' });
  });

  text(t('planer.walletVat'), x0 + 181, y0 + preisOben - 24.5, { groesse: 13, ausrichtung: 'center', deckkraft: 0.4 });
  text(wallet.preis, x0 + 181, y0 + preisOben + 0.5, { groesse: 32, gewicht: 700, ausrichtung: 'center' });

  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
};

function Punkte({ anzahl, aktiv, top, onWaehlen, t }) {
  const breite = (anzahl - 1) * 17 + 7;
  return (
    <div
      className="absolute"
      data-tutorial="planer-uebersicht-punkte"
      style={{ left: `${201 - breite / 2}px`, top: `${top}px`, width: `${breite}px`, height: '7px', transition: 'top 420ms cubic-bezier(0.22, 1, 0.36, 1)' }}
    >
      {Array.from({ length: anzahl }, (_, i) => (
        <button
          key={i}
          type="button"
          onClick={() => onWaehlen(i)}
          aria-label={i === anzahl - 1 ? t('planer.overviewTotal') : t('planer.overviewDay', { n: i + 1 })}
          aria-current={i === aktiv ? 'true' : undefined}
          // Tippflaeche groesser als der Punkt
          className="absolute -top-[8px] w-[17px] h-[23px] flex items-center justify-center"
          style={{ left: `${i * 17 - 5}px` }}
        >
          <span
            className="block w-[7px] h-[7px] rounded-full"
            style={{
              background: LIME,
              opacity: i === aktiv ? 1 : 0.25,
              transform: `scale(${i === aktiv ? 1.15 : 1})`,
              transition: 'opacity 260ms ease, transform 260ms ease',
            }}
          />
        </button>
      ))}
    </div>
  );
}

export default function EinsatzplanungUebersicht({
  tage,               // ISO-Tage des Einsatzes
  vorschlaegeJeTag,   // { [iso]: Vorschlaege ohne abgelehnte }
  startIndex = 0,
  onZurueck,
  onNeuePlanung,
  onTagOeffnen,       // (index) => void
}) {
  const { t, locale } = useI18n();
  const [scale, setScale] = useState(1);
  const anzahl = tage.length + 1;
  const letzte = anzahl - 1;
  const anfang = Math.max(0, Math.min(startIndex, letzte));
  const [aktiv, setAktiv] = useState(anfang);
  const [teilt, setTeilt] = useState(false);
  const gesamtAktiv = aktiv === letzte;

  // Karussell-Zustand ausserhalb von React: pro Bild nur Transformationen setzen.
  const karteRefs = useRef([]);
  const lage = useRef({ pos: anfang, tempo: 0, ziel: anfang, rahmen: 0, zeit: 0 });
  const zug = useRef(null);
  const gewischt = useRef(false);
  const scaleRef = useRef(1);
  const aktivRef = useRef(anfang);
  scaleRef.current = scale;

  useEffect(() => {
    const aktualisieren = () => setScale(Math.min(window.innerWidth / BASIS_BREITE, 1));
    aktualisieren();
    window.addEventListener('resize', aktualisieren);
    return () => window.removeEventListener('resize', aktualisieren);
  }, []);

  const tagesTitel = useMemo(() => {
    const format = new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', month: 'short' });
    return tage.map((iso) => format.format(new Date(`${iso}T12:00:00`)));
  }, [locale, tage]);

  const gesamtTitel = useMemo(() => {
    if (!tage.length) return '';
    const format = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' });
    const von = format.format(new Date(`${tage[0]}T12:00:00`));
    const bis = format.format(new Date(`${tage[tage.length - 1]}T12:00:00`));
    return tage.length > 1 ? `${von} – ${bis}` : von;
  }, [locale, tage]);

  const tagesWallets = useMemo(() => tage.map((iso) => walletWerte(vorschlaegeJeTag[iso] || [])), [tage, vorschlaegeJeTag]);
  const gesamtWallet = useMemo(() => walletWerte(tage.flatMap((iso) => vorschlaegeJeTag[iso] || [])), [tage, vorschlaegeJeTag]);

  // --- Karussell ---------------------------------------------------------------

  // Jede Karte steht abhaengig vom Abstand zur aktuellen Lage: zur Seite
  // verschoben, um die Hochachse gekippt, kleiner und blasser.
  const anwenden = (pos) => {
    karteRefs.current.forEach((el, i) => {
      if (!el) return;
      const d = i - pos;
      const ad = Math.min(Math.abs(d), 1.4);
      el.style.transform = `translate3d(${d * VERSATZ}px, 0, ${-ad * 120}px) rotateY(${-Math.sign(d) * ad * KIPP_GRAD}deg) scale(${1 - ad * SCHRUMPFEN})`;
      el.style.opacity = String(Math.max(0, 1 - ad * 0.45));
      el.style.visibility = Math.abs(d) > 1.35 ? 'hidden' : 'visible';
      el.style.zIndex = String(100 - Math.round(Math.abs(d) * 10));
    });
    const naechste = Math.max(0, Math.min(letzte, Math.round(pos)));
    if (naechste !== aktivRef.current) {
      aktivRef.current = naechste;
      setAktiv(naechste);
    }
  };

  const federStoppen = () => {
    if (lage.current.rahmen) cancelAnimationFrame(lage.current.rahmen);
    lage.current.rahmen = 0;
  };

  // Gedaempfte Feder zur Zielkarte; nimmt den Schwung vom Wischen mit.
  const einrasten = (ziel) => {
    federStoppen();
    const l = lage.current;
    l.ziel = Math.max(0, Math.min(letzte, ziel));
    // Im Hintergrund laufen keine Bilder — dann direkt setzen.
    if (document.visibilityState === 'hidden') {
      l.pos = l.ziel;
      l.tempo = 0;
      anwenden(l.pos);
      return;
    }
    const daempfung = 2 * Math.sqrt(FEDER_STEIFE) * FEDER_DAEMPFUNG;
    l.zeit = performance.now();
    const schritt = (jetzt) => {
      const dt = Math.min(0.032, (jetzt - l.zeit) / 1000);
      l.zeit = jetzt;
      const kraft = -FEDER_STEIFE * (l.pos - l.ziel) - daempfung * l.tempo;
      l.tempo += kraft * dt;
      l.pos += l.tempo * dt;
      if (Math.abs(l.pos - l.ziel) < 0.0005 && Math.abs(l.tempo) < 0.005) {
        l.pos = l.ziel;
        l.tempo = 0;
        anwenden(l.pos);
        l.rahmen = 0;
        return;
      }
      anwenden(l.pos);
      l.rahmen = requestAnimationFrame(schritt);
    };
    l.rahmen = requestAnimationFrame(schritt);
  };

  useEffect(() => {
    anwenden(lage.current.pos);
    return federStoppen;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const beiDruck = (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    federStoppen();
    gewischt.current = false;
    zug.current = {
      id: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      startPos: lage.current.pos,
      proben: [{ x: e.clientX, zeit: performance.now() }],
      waagerecht: null,
    };
  };

  const beiZug = (e) => {
    const z = zug.current;
    if (!z || z.id !== e.pointerId) return;
    const dx = e.clientX - z.startX;
    const dy = e.clientY - z.startY;
    if (z.waagerecht == null) {
      if (Math.abs(dx) < KLICK_SCHWELLE && Math.abs(dy) < KLICK_SCHWELLE) return;
      z.waagerecht = Math.abs(dx) >= Math.abs(dy);
      if (!z.waagerecht) {
        // Senkrecht: die Seite scrollt, das Karussell bleibt stehen.
        zug.current = null;
        einrasten(Math.round(lage.current.pos));
        return;
      }
      gewischt.current = true;
      try {
        e.currentTarget.setPointerCapture?.(e.pointerId);
      } catch {
        // Zeiger schon weg — das Wischen laeuft trotzdem weiter.
      }
    }
    const breite = BASIS_BREITE * scaleRef.current;
    let pos = z.startPos - dx / breite;
    // Am Anfang und Ende gibt die Bahn nur widerwillig nach.
    if (pos < 0) pos = -(1 - 1 / (1 - pos * 0.9)) * 0.35;
    if (pos > letzte) pos = letzte + (1 - 1 / (1 + (pos - letzte) * 0.9)) * 0.35;
    lage.current.pos = pos;
    lage.current.tempo = 0;
    const jetzt = performance.now();
    z.proben.push({ x: e.clientX, zeit: jetzt });
    while (z.proben.length > 2 && jetzt - z.proben[0].zeit > 90) z.proben.shift();
    anwenden(pos);
  };

  const beiLoslassen = (e) => {
    const z = zug.current;
    if (!z || z.id !== e.pointerId) return;
    zug.current = null;
    if (!z.waagerecht) return;
    const breite = BASIS_BREITE * scaleRef.current;
    const erste = z.proben[0];
    const letzteProbe = z.proben[z.proben.length - 1];
    const dauer = Math.max(1, letzteProbe.zeit - erste.zeit);
    const tempo = -((letzteProbe.x - erste.x) / dauer) * 1000 / breite; // Karten je Sekunde
    const l = lage.current;
    // Schwung entscheidet mit: ein kurzer Wisch reicht fuer die naechste Karte.
    let ziel = Math.round(l.pos + tempo * 0.18);
    ziel = Math.max(Math.round(z.startPos) - 1, Math.min(Math.round(z.startPos) + 1, ziel));
    l.tempo = Math.max(-8, Math.min(8, tempo));
    einrasten(ziel);
  };

  const zuKarte = (index) => {
    lage.current.tempo = 0;
    einrasten(index);
  };

  // Pfeiltasten und waagerechtes Scrollen (Trackpad) blaettern ebenfalls.
  const radSumme = useRef(0);
  const radSperre = useRef(0);
  const beimRad = (e) => {
    if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
    const jetzt = performance.now();
    if (jetzt < radSperre.current) return;
    radSumme.current += e.deltaX;
    if (Math.abs(radSumme.current) > 40) {
      zuKarte(aktivRef.current + Math.sign(radSumme.current));
      radSumme.current = 0;
      radSperre.current = jetzt + 450;
    }
  };

  useEffect(() => {
    const taste = (e) => {
      if (e.key === 'ArrowRight') zuKarte(aktivRef.current + 1);
      if (e.key === 'ArrowLeft') zuKarte(aktivRef.current - 1);
    };
    window.addEventListener('keydown', taste);
    return () => window.removeEventListener('keydown', taste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- Teilen --------------------------------------------------------------------

  const teilen = async () => {
    if (teilt) return;
    setTeilt(true);
    const index = aktivRef.current;
    const gesamt = index === letzte;
    try {
      const blob = await bildschirmZeichnen({
        gesamt,
        titel: gesamt ? gesamtTitel : tagesTitel[index],
        wallet: gesamt ? gesamtWallet : tagesWallets[index],
        t,
      });
      if (!blob) return;
      const name = gesamt
        ? `trisar-einsatz-${tage[0]}${tage.length > 1 ? `_${tage[tage.length - 1]}` : ''}.png`
        : `trisar-planung-${tage[index]}.png`;
      const datei = new File([blob], name, { type: 'image/png' });
      if (navigator.canShare?.({ files: [datei] })) {
        try {
          await navigator.share({ files: [datei], title: `TRISAR · ${gesamt ? gesamtTitel : tagesTitel[index]}` });
        } catch (fehler) {
          if (fehler?.name !== 'AbortError') throw fehler;
        }
        return;
      }
      // Ohne Teilen-Dialog (z. B. am Desktop) wird das Bild gespeichert.
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = name;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 4000);
    } catch (fehler) {
      console.warn('Karte teilen fehlgeschlagen', fehler);
    } finally {
      setTeilt(false);
    }
  };

  return (
    <div className="absolute inset-0 z-[60] bg-black" data-tutorial="planer-uebersicht">
      <div
        className="h-dvh w-full overflow-y-auto overflow-x-hidden overscroll-none flex justify-center"
        style={{ WebkitTextSizeAdjust: 'none', textSizeAdjust: 'none', fontFamily: 'Space Grotesk, sans-serif' }}
      >
        <div className="relative shrink-0 overflow-hidden" style={{ width: `${BASIS_BREITE * scale}px`, height: `${BASIS_HOEHE * scale}px` }}>
          <div
            className="absolute left-0 top-0 w-[402px] origin-top-left"
            style={{ ...HINTERGRUND, height: `${BASIS_HOEHE}px`, transform: `scale(${scale})` }}
          >
            <BackCircleButton onClick={onZurueck} className="absolute left-[20px] top-[60px] z-[2]" marker="planer-uebersicht-zurueck" />

            <button
              type="button"
              onClick={teilen}
              disabled={teilt}
              aria-label={gesamtAktiv ? t('planer.shareTotal') : t('planer.shareDay', { tag: tagesTitel[aktiv] })}
              data-tutorial="planer-uebersicht-teilen"
              className="absolute left-[324px] top-[60px] w-[50px] h-[50px] z-[2] transition-opacity duration-200"
              style={{ opacity: teilt ? 0.5 : 1 }}
            >
              <img src="/icon/_Icon_Planung/teilen_pfeil.svg" alt="" className="absolute left-[18px] top-[12px] block w-[13px] h-[17px]" />
              <img src="/icon/_Icon_Planung/teilen_schale.svg" alt="" className="absolute left-[15px] top-[23px] block w-[19px] h-[14px]" />
            </button>

            {/* Karten */}
            <div
              className="absolute left-0 w-[402px] select-none"
              style={{ top: `${WISCH_OBEN}px`, height: `${WISCH_HOEHE}px`, perspective: '1100px', touchAction: 'pan-y' }}
              onPointerDown={beiDruck}
              onPointerMove={beiZug}
              onPointerUp={beiLoslassen}
              onPointerCancel={beiLoslassen}
              onWheel={beimRad}
              // Nach einem Wischen keinen Tipp ausloesen.
              onClickCapture={(e) => {
                if (gewischt.current) {
                  e.stopPropagation();
                  e.preventDefault();
                  gewischt.current = false;
                }
              }}
              onDragStart={(e) => e.preventDefault()}
            >
              {tage.map((iso, i) => (
                <div
                  key={iso}
                  ref={(el) => { karteRefs.current[i] = el; }}
                  className="absolute left-[20px] w-[362px] will-change-transform"
                  style={{ top: `${TAGES_KARTE_OBEN - WISCH_OBEN}px`, height: `${TAGES_KARTE_HOEHE}px`, transformOrigin: '50% 50%' }}
                >
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => onTagOeffnen(i)}
                    onKeyDown={(e) => { if (e.key === 'Enter') onTagOeffnen(i); }}
                    aria-label={t('planer.overviewOpenDay', { tag: tagesTitel[i] })}
                    data-tutorial={`planer-uebersicht-tag-${i}`}
                    className="absolute inset-0 cursor-pointer"
                  >
                    <TagesWalletKarte titel={tagesTitel[i]} wallet={tagesWallets[i]} className="left-0 top-0 pointer-events-none" />
                  </div>
                </div>
              ))}
              <div
                ref={(el) => { karteRefs.current[letzte] = el; }}
                className="absolute left-[20px] w-[362px] will-change-transform"
                style={{ top: `${GESAMT_KARTE_OBEN - WISCH_OBEN}px`, height: `${GESAMT_KARTE_HOEHE}px`, transformOrigin: '50% 50%' }}
              >
                <GesamtWalletKarte
                  titel={gesamtTitel}
                  wallet={gesamtWallet}
                  marker="planer-uebersicht-gesamt"
                  className="left-0 top-0 pointer-events-none"
                />
              </div>
            </div>

            <Punkte
              anzahl={anzahl}
              aktiv={aktiv}
              top={gesamtAktiv ? PUNKTE_OBEN_GESAMT : PUNKTE_OBEN_TAG}
              onWaehlen={zuKarte}
              t={t}
            />

            <button
              type="button"
              onClick={onNeuePlanung}
              data-tutorial="planer-neue-planung"
              className="absolute left-[112px] w-[178px] h-[51px] border-2 border-solid flex items-center justify-center"
              style={{ top: `${KNOPF_OBEN}px`, borderColor: LIME }}
            >
              <span className="text-[24px] font-bold tracking-[-0.5px] leading-[normal] whitespace-nowrap" style={{ color: LIME }}>{t('planer.newPlanning')}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
