// Routen-Editor der Dispo (15.11., Design route-design.png): Vollbild-Karte ueber dem Fahrt-Formular.
// Karte antippen setzt einen Routenpunkt, Punkt antippen entfernt ihn, Punkte lassen sich ziehen.
// Grau gestrichelt die schnellste Route, Lime die Route ueber die Punkte. Gespeichert wird erst
// mit der Fahrt, "Uebernehmen" gibt die Punkte nur ans Formular zurueck.
import { useEffect, useMemo, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import { useI18n } from '../../i18n';
import { adresseAufloesen, karteBereitstellen } from '../../shared/karte/maplibreKarte';
import {
  dekodierePolyline, maxRoutenPunkte, punktEinfuegen, routeVorschau, wegpunkteFolge,
} from '../../shared/routenPunkte';

const LIME = '#E3F654';
const SCHRIFT = { fontFamily: 'Space Grotesk' };

const markerElement = (art, text) => {
  const el = document.createElement('div');
  const gross = art === 'start' || art === 'ziel' ? 32 : art === 'stopp' ? 26 : 22;
  Object.assign(el.style, {
    width: `${gross}px`,
    height: `${gross}px`,
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontFamily: 'Space Grotesk',
    fontWeight: '700',
    fontSize: art === 'stopp' ? '13px' : '15px',
    color: '#000',
    boxSizing: 'border-box',
    background: art === 'punkt' ? '#000' : art === 'stopp' ? '#fff' : LIME,
    border: art === 'punkt' ? `4px solid ${LIME}` : 'none',
    cursor: art === 'punkt' ? 'grab' : 'default',
  });
  if (text) el.textContent = text;
  return el;
};

const kmText = (meter) => `${(Number(meter || 0) / 1000).toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} km`;

export default function RoutenEditor({ adressen: adressenAnfang, anfang = [], anfangFest = null, onUebernehmen, onAbbrechen }) {
  // Adressen gelten fuer die ganze Sitzung des Editors (das Formular darunter aendert sich nicht).
  const [adressen] = useState(adressenAnfang);
  const { t } = useI18n();
  const feldRef = useRef(null);
  const karteRef = useRef(null);
  const linienRef = useRef({ schnell: null, aktuell: null });
  const markerRef = useRef([]);
  const gezoomtRef = useRef(false);
  const laufRef = useRef(0);
  const [punkte, setPunkte] = useState(() => anfang.map((p) => ({ ...p })));
  const [orte, setOrte] = useState(() => adressen.map(() => null));
  const [schnell, setSchnell] = useState(null);
  // Vorschau zur aktuellen Punktliste. fuer = Punktliste, zu der sie gehoert. fest = Paket des Servers,
  // das bei "Uebernehmen" unveraendert an der Fahrt gespeichert wird (jobs.route_fest): genau diese Linie
  // bekommt der Fahrer. Beim Oeffnen gilt die schon freigegebene Route, solange die Punkte gleich bleiben.
  const [aktuell, setAktuell] = useState(() => (anfangFest?.polyline && anfang.length ? {
    ok: true,
    polyline: anfangFest.polyline,
    distanz_m: anfangFest.laenge_m,
    dauer_verkehr_min: Math.ceil(Number(anfangFest.dauer_s || 0) / 60),
    fest: anfangFest,
    fuer: JSON.stringify(anfang.map((p) => ({ ...p }))),
  } : null));
  const [meldung, setMeldung] = useState('');

  const anzahlStopps = Math.max(0, adressen.length - 2);
  const hoechstens = maxRoutenPunkte(anzahlStopps);
  const punkteRef = useRef(punkte);
  punkteRef.current = punkte;
  const orteRef = useRef(orte);
  orteRef.current = orte;

  // Karte einmal anlegen.
  useEffect(() => {
    const KARTE = karteBereitstellen();
    if (!feldRef.current || karteRef.current) return undefined;
    const karte = new KARTE.Map(feldRef.current, { zoom: 11 });
    karteRef.current = karte;
    linienRef.current.schnell = new KARTE.Polyline({
      path: [], strokeColor: '#666666', strokeWeight: 5, icons: [{ icon: { strokeColor: '#666666' } }], zIndex: 1, map: karte,
    });
    linienRef.current.aktuell = new KARTE.Polyline({ path: [], strokeColor: LIME, strokeWeight: 7, zIndex: 2, map: karte });
    karte.addListener('click', (event) => {
      if (event?.domEvent?.target?.closest?.('.maplibregl-marker')) return;
      const lat = Number(event?.latLng?.lat?.());
      const lng = Number(event?.latLng?.lng?.());
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
      if (punkteRef.current.length >= hoechstens) {
        setMeldung(t('route.hoechstens', { n: hoechstens }));
        return;
      }
      setMeldung('');
      setPunkte((alt) => punktEinfuegen(orteRef.current, alt, { lat, lng }));
    });
    return () => {
      markerRef.current.forEach((m) => m.remove());
      markerRef.current = [];
      karte.abbauen();
      karteRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Schnellste Route einmal (liefert auch die Orte). Demo ohne Server: Orte aus der Ortstabelle.
  useEffect(() => {
    let aktiv = true;
    (async () => {
      const antwort = await routeVorschau(adressen, []);
      if (!aktiv) return;
      if (antwort) {
        setSchnell(antwort);
        setOrte(antwort.orte || adressen.map(() => null));
        return;
      }
      const gefunden = await Promise.all(adressen.map((a) => adresseAufloesen(a)));
      if (aktiv) setOrte(gefunden);
    })();
    return () => { aktiv = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Route ueber die Punkte, kurz entprellt.
  const punkteKey = JSON.stringify(punkte);
  useEffect(() => {
    if (punkte.length === 0 || aktuell?.fuer === punkteKey) return undefined;
    laufRef.current += 1;
    const lauf = laufRef.current;
    const timer = setTimeout(async () => {
      const antwort = await routeVorschau(adressen, punkte);
      // Auch ohne Antwort (Demo, Ausfall) merken, dass fuer diese Punkte gerechnet wurde.
      if (laufRef.current === lauf) setAktuell({ ...(antwort || { ok: false }), fuer: punkteKey });
    }, 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [punkteKey, adressen]);
  // Passt die Vorschau zu den Punkten auf der Karte? Erst dann darf uebernommen werden.
  const vorschau = punkte.length > 0 && aktuell?.fuer === punkteKey ? aktuell : null;
  const bereit = punkte.length === 0 || Boolean(vorschau);

  // Linien zeichnen. Ohne Punkte ist die schnellste Route die Lime-Linie.
  const folge = useMemo(() => wegpunkteFolge(orte, punkte), [orte, punkte]);
  useEffect(() => {
    const { schnell: grau, aktuell: lime } = linienRef.current;
    if (!grau || !lime) return;
    const schnellPfad = dekodierePolyline(schnell?.polyline);
    // Ohne Server (Demo) oder solange gerechnet wird: gerade Linie durch alle Punkte.
    const gerade = folge.map((w) => w.ort).filter((o) => o && Number.isFinite(o.lat));
    const vorschauPfad = dekodierePolyline(vorschau?.polyline);
    const aktuellPfad = punkte.length ? (vorschauPfad.length ? vorschauPfad : gerade) : (schnellPfad.length ? schnellPfad : gerade);
    grau.setPath(punkte.length ? schnellPfad : []);
    lime.setPath(aktuellPfad);
  }, [schnell, vorschau, folge, punkte.length]);

  // Marker: A, Stopps, Routenpunkte (ziehbar, Tipp entfernt), B.
  useEffect(() => {
    const karte = karteRef.current;
    if (!karte) return;
    markerRef.current.forEach((m) => m.remove());
    markerRef.current = [];
    let stoppNr = 0;
    folge.forEach((w) => {
      if (!w.ort || !Number.isFinite(w.ort.lat)) return;
      if (w.art === 'stopp') stoppNr += 1;
      const text = w.art === 'start' ? 'A' : w.art === 'ziel' ? 'B' : w.art === 'stopp' ? String(stoppNr) : '';
      const el = markerElement(w.art, text);
      const marker = new maplibregl.Marker({ element: el, anchor: 'center', draggable: w.art === 'punkt' })
        .setLngLat([w.ort.lng, w.ort.lat])
        .addTo(karte.karte);
      if (w.art === 'punkt') {
        let gezogen = false;
        marker.on('dragstart', () => { gezogen = true; });
        marker.on('dragend', () => {
          const stelle = marker.getLngLat();
          setPunkte((alt) => alt.map((p, i) => (i === w.index ? { ...p, lat: stelle.lat, lng: stelle.lng } : p)));
          setTimeout(() => { gezogen = false; }, 0);
        });
        el.addEventListener('click', (e) => {
          e.stopPropagation();
          if (gezogen) return;
          setMeldung('');
          setPunkte((alt) => alt.filter((_, i) => i !== w.index));
        });
      }
      markerRef.current.push(marker);
    });
    // Beim ersten Mal auf die ganze Fahrt zoomen.
    const bekannte = folge.map((w) => w.ort).filter((o) => o && Number.isFinite(o.lat));
    if (!gezoomtRef.current && bekannte.length >= 2) {
      gezoomtRef.current = true;
      const lats = bekannte.map((o) => o.lat);
      const lngs = bekannte.map((o) => o.lng);
      const zoomen = () => karte.karte.fitBounds(
        [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]],
        { padding: { top: 150, bottom: 240, left: 50, right: 50 }, duration: 0, maxZoom: 15 },
      );
      karte.bereit(zoomen);
    }
  }, [folge]);

  const angepasst = punkte.length > 0;
  const werte = angepasst ? (vorschau?.ok ? vorschau : null) : schnell;
  const minuten = (w) => Number(w?.dauer_verkehr_min ?? w?.dauer_min ?? 0);
  const mehr = angepasst && vorschau?.ok && schnell ? minuten(vorschau) - minuten(schnell) : null;
  const frei = Math.max(0, hoechstens - punkte.length);

  return (
    <div className="absolute inset-0 z-[600] bg-[#0e0e0e]" data-tutorial="routen-editor">
      <div ref={feldRef} className="absolute inset-0" />

      <button
        type="button"
        onClick={onAbbrechen}
        aria-label="Zurück"
        className="absolute top-[60px] left-[20px] z-[10] w-[50px] h-[50px]"
      >
        <span className="block w-[50px] h-[50px] rounded-full bg-black overflow-hidden">
          <img src="/icon/_Icon_Karte/Backbutton_Karte.svg?v=2" alt="" className="w-[50px] h-[50px] object-contain" />
        </span>
      </button>

      <button
        type="button"
        onClick={() => { setPunkte([]); setMeldung(''); }}
        aria-label={t('route.schnellsteKnopf')}
        className="absolute top-[60px] right-[20px] z-[10] w-[50px] h-[50px] rounded-full flex items-center justify-center text-[24px] font-bold text-black"
        style={{ background: LIME, ...SCHRIFT }}
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M4 12a8 8 0 1 0 2.4-5.7" />
          <path d="M4 4v4.5h4.5" />
        </svg>
      </button>

      <div
        className="absolute top-[62px] left-[84px] right-[84px] z-[10] rounded-[14px] px-[10px] py-[8px] text-center text-[12.5px] leading-[1.3] text-white pointer-events-none"
        style={{ background: 'rgba(0,0,0,0.85)', ...SCHRIFT }}
      >
        {t('route.hinweisTippen')} <b style={{ color: LIME }}>{t('route.routenpunkt')}</b>
        <br />
        {t('route.hinweisEntfernen')}
        <br />
        <span className="text-[#999]">{t('route.hinweisGrau')}</span>
      </div>

      <div
        className="absolute left-0 right-0 bottom-0 z-[10] bg-black px-[18px] pt-[16px] pb-[30px]"
        style={{ borderTop: `1.5px solid ${LIME}`, ...SCHRIFT }}
      >
        <div className="flex justify-between items-baseline text-[15px] text-white mb-[6px]">
          <span>
            {angepasst ? t('route.angepasst') : t('route.schnellste')}{' '}
            <b className="text-[20px]" style={{ color: LIME }}>{werte ? kmText(werte.distanz_m) : '…'}</b>
          </span>
          <span>
            <b className="text-[20px]" style={{ color: LIME }}>{werte ? `${minuten(werte)} min` : ''}</b>
            {mehr != null ? <span className="text-[#aaa]">{` (${mehr >= 0 ? '+' : ''}${mehr})`}</span> : null}
          </span>
        </div>
        <div className="text-[12.5px] leading-[1.35] text-[#aaa] mb-[14px]">
          {meldung || (angepasst
            ? `${punkte.length === 1 ? t('route.infoPunkt', { frei }) : t('route.infoPunkte', { n: punkte.length, frei })} ${t('route.infoGoogle')}`
            : `${t('route.infoKeine', { n: hoechstens })} ${t('route.infoGoogle')}`)}
        </div>
        <div className="flex gap-[10px]">
          <button
            type="button"
            onClick={() => { setPunkte([]); setMeldung(''); }}
            className="flex-1 h-[52px] text-[16px] font-bold bg-transparent"
            style={{ border: `1.5px solid ${LIME}`, color: LIME, ...SCHRIFT }}
          >
            {t('route.zuruecksetzen')}
          </button>
          <button
            type="button"
            disabled={!bereit}
            onClick={() => onUebernehmen(punkte, punkte.length ? (vorschau?.fest ?? null) : null)}
            className={`flex-1 h-[52px] text-[16px] font-bold text-black ${bereit ? '' : 'opacity-40'}`}
            style={{ background: LIME, ...SCHRIFT }}
          >
            {t('route.uebernehmen')}
          </button>
        </div>
      </div>
    </div>
  );
}
