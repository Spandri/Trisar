// Dienstreise, angetippt in der Fahrtenliste (Entwurf 13.11., Aufbau wie eine Flughafen-Fahrt):
// oben die Karte mit der Strecke (Zug ueber die Halte, Flug als Bogen), Startnadel und Zielflagge,
// darunter das ziehbare Blatt: Abfahrt (Gleis/Gate) | Ankunft, Kacheln Start -> Ziel, grosse Zug-
// bzw. Flugnummer, Notiz der Dispo, "Dienstreise beenden". Zeiten live ueber die Bahn- bzw. Flugabfrage.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useI18n } from '../../../i18n';
import { useBlattZiehen } from './blattZiehen';
import TrisarFooter from '../../../components/ui/TrisarFooter';
import { getNavigationUrl } from '../../../shared/utils/navigation';
import { KARTEN_STIL_DUNKEL } from '../../../shared/karte/maplibreKarte';
import {
  abschnittIcon, gleisStand, hm, minutenSpaet, reiseArt, reiseNummer, startIcon, ticketLink, useAbschnittVerbindungen, useVerbindung, walletLink,
  zeitFarbe, zielIcon,
} from '../../../shared/dienstreise';
import { HalteListe, SpaetKachel } from './ZugHalte';

const ORANGE = '#F0997B';

// Gleis rechts in der Zeile (15.11.): geaendert altes Gleis grau durchgestrichen, neues Orange.
const GleisRechts = ({ stand, grau }) => (stand.gleis ? (
  <span className="text-[13px] font-bold shrink-0 flex gap-[4px]">
    {stand.vorher ? <span className="line-through" style={{ color: grau }}>{stand.vorher}</span> : null}
    <span style={{ color: stand.vorher ? ORANGE : grau }}>Gl. {stand.gleis}</span>
  </span>
) : <span className="text-[13px] font-bold shrink-0" />);
import { fahrzeugIcon, fahrzeugMarkerElement, reiseLage, umstiegMarkerElement, umstiegPunkte, verspaetungMin } from '../../../shared/reiseLage';

const LIME = '#e2f754';
// Feste leere Liste, sonst zeichnet die Karte bei jedem Rendern neu.
const KEINE_GLEISE = [];
const GRAU = '#868786';

const MapBackIcon = () => (
  <span className="block w-[50px] h-[50px] rounded-full bg-black overflow-hidden">
    <img src="/icon/_Icon_Karte/Backbutton_Karte.svg?v=2" alt="" className="w-[50px] h-[50px] object-contain" />
  </span>
);

// Flug: Bogen zwischen zwei Punkten (wie die Flugbahn bei Fahrten), sonst gerade Linie ueber die Halte.
const bogen = (a, b, schritte = 48) => {
  const punkte = [];
  const dx = b.lng - a.lng;
  const dy = b.lat - a.lat;
  for (let i = 0; i <= schritte; i += 1) {
    const t = i / schritte;
    const hoehe = Math.sin(Math.PI * t) * Math.hypot(dx, dy) * 0.18;
    punkte.push([a.lng + dx * t, a.lat + dy * t + hoehe]);
  }
  return punkte;
};

const markerBild = (src, breite, hoehe) => {
  const el = document.createElement('div');
  el.style.width = `${breite}px`;
  el.style.height = `${hoehe}px`;
  el.style.backgroundImage = `url(${src})`;
  el.style.backgroundSize = 'contain';
  el.style.backgroundRepeat = 'no-repeat';
  return el;
};

const BLAU = '#0059FF';
const GEFAHREN = '#5c5c5c';
const linienDaten = (pfad) => ({ type: 'FeatureCollection', features: pfad && pfad.length >= 2 ? [{ type: 'Feature', geometry: { type: 'LineString', coordinates: pfad }, properties: {} }] : [] });

/**
 * Karte der Dienstreise (Entwurf 14.11.): durchgehende blaue Linie, gefahrenes Stueck grau, darauf das
 * Fahrzeug (Bus/U-Bahn/Zug/Flug) mit dem Fahrer-Punkt (Nummer) und einer Zeile Text, Umstiege als weisse
 * Ringe, Zielflagge. Eingepasst wird nur, wenn sich die Strecke aendert, nicht bei jeder Bewegung.
 */
function StreckenKarte({ reise, lage, ziel, umstiege = KEINE_GLEISE, sheetHeight, fahrerNummer, text }) {
  const feld = useRef(null);
  const karte = useRef(null);
  const marker = useRef([]);
  const fahrzeug = useRef(null);
  const eingepasst = useRef('');

  useEffect(() => {
    if (!feld.current) return undefined;
    const k = new maplibregl.Map({
      container: feld.current,
      style: KARTEN_STIL_DUNKEL,
      center: [reise.start_lng ?? 11.5755, reise.start_lat ?? 48.1374],
      zoom: 5,
      attributionControl: { compact: true },
      renderWorldCopies: false,
    });
    karte.current = k;
    eingepasst.current = '';
    return () => { k.remove(); karte.current = null; fahrzeug.current = null; };
  }, [reise.id, reise.start_lat, reise.start_lng]);

  useEffect(() => {
    const k = karte.current;
    if (!k || !lage) return undefined;
    const zeichnen = () => {
      const quelle = (id, pfad, farbe) => {
        if (k.getSource(id)) k.getSource(id).setData(linienDaten(pfad));
        else {
          k.addSource(id, { type: 'geojson', data: linienDaten(pfad) });
          k.addLayer({ id, type: 'line', source: id, layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': farbe, 'line-width': 6 } });
        }
      };
      quelle('reise-offen', lage.offen, BLAU);
      quelle('reise-gefahren', lage.gefahren, GEFAHREN);

      marker.current.forEach((m) => m.remove());
      marker.current = [];
      umstiege.forEach((u) => {
        // Umstieg: Fahrzeug des naechsten Abschnitts mit "U2 ab 06:56".
        const el = umstiegMarkerElement({ art: u.art, text: u.text });
        marker.current.push(new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat([u.lng, u.lat]).addTo(k));
      });
      if (ziel) marker.current.push(new maplibregl.Marker({ element: markerBild('/icon/_Icon_Karte/Ziel_Pin_Trisar_01.svg', 35, 41), anchor: 'bottom' }).setLngLat([ziel.lng, ziel.lat]).addTo(k));

      // Fahrzeug mit Fahrer: neu bauen, wenn Art/Text/Nummer wechseln, sonst nur verschieben.
      if (lage.position) {
        const schluessel = `${lage.art}|${fahrerNummer}|${text}`;
        if (!fahrzeug.current || fahrzeug.current.schluessel !== schluessel) {
          fahrzeug.current?.marker.remove();
          const m = new maplibregl.Marker({ element: fahrzeugMarkerElement({ art: lage.art, nummer: fahrerNummer, text }), anchor: 'center' })
            .setLngLat([lage.position.lng, lage.position.lat]).addTo(k);
          fahrzeug.current = { marker: m, schluessel };
        } else {
          fahrzeug.current.marker.setLngLat([lage.position.lng, lage.position.lat]);
        }
      }

      // Einpassen nur bei neuer Strecke (z. B. wenn die Gleislinie dazukommt).
      const alle = [...lage.gesamt, ...(ziel ? [[ziel.lng, ziel.lat]] : []), ...(lage.position ? [[lage.position.lng, lage.position.lat]] : [])];
      const schluessel = `${reise.id}|${lage.gesamt.length}|${sheetHeight}`;
      if (alle.length >= 2 && eingepasst.current !== schluessel) {
        eingepasst.current = schluessel;
        const grenzen = alle.reduce((bb, p) => bb.extend(p), new maplibregl.LngLatBounds(alle[0], alle[0]));
        const unten = Math.round((window.innerHeight || 800) * (sheetHeight || 50) / 100) + 40;
        k.fitBounds(grenzen, { padding: { top: 120, bottom: unten, left: 60, right: 60 }, duration: 0, maxZoom: 13 });
      }
    };
    if (k.isStyleLoaded()) zeichnen();
    else k.once('load', zeichnen);
    return undefined;
  }, [reise.id, lage, ziel, umstiege, sheetHeight, fahrerNummer, text]);

  return <div ref={feld} className="absolute inset-0" />;
}

export default function DienstreiseDetail({ reise, setView, onBeenden, fahrerNummer = null, standort = null }) {
  const { t, locale } = useI18n();
  const {
    hoehe: sheetHeight, zieht: isDragging, blattRef, feldRef, scrollRef,
    ziehStart, ziehBewegung, ziehEnde, inhaltStart, inhaltBewegung,
  } = useBlattZiehen(50);
  const v = useVerbindung(reise);
  const teile = reise.abschnitte || KEINE_GLEISE;
  const mehrere = teile.length > 1;
  const liveJe = useAbschnittVerbindungen(mehrere ? reise : null);
  // Ohne Umstiege: die Reise als ein Abschnitt (Flug als Bogen, Zug ueber Gleise/Halte).
  const teileLage = useMemo(() => (mehrere ? teile : [{
    id: 'haupt',
    art: reiseArt(reise),
    nummer: reiseNummer(reise),
    von_name: reise.start_name, von_lat: reise.start_lat, von_lng: reise.start_lng,
    nach_name: reise.ziel_name, nach_lat: reise.ziel_lat, nach_lng: reise.ziel_lng,
    ab_datum: reise.datum, ab_zeit: reise.start_zeit, an_zeit: null,
  }]), [mehrere, teile, reise]);
  const liveLage = useMemo(() => {
    if (mehrere) return liveJe;
    const flugBogen = reiseArt(reise) === 'flug' && reise.start_lat != null && reise.ziel_lat != null
      ? bogen({ lat: reise.start_lat, lng: reise.start_lng }, { lat: reise.ziel_lat, lng: reise.ziel_lng }) : null;
    return { haupt: { ...(v || {}), ...(flugBogen ? { linie: flugBogen } : {}) } };
  }, [mehrere, liveJe, v, reise]);
  // Alle 30 s neu einordnen (errechnete Position wandert mit der Uhr).
  const [jetzt, setJetzt] = useState(() => Date.now());
  useEffect(() => { const uhr = setInterval(() => setJetzt(Date.now()), 30000); return () => clearInterval(uhr); }, []);
  const lage = useMemo(() => reiseLage({ teile: teileLage, liveJe: liveLage, datum: reise.datum, standort, jetzt }),
    [teileLage, liveLage, reise.datum, standort, jetzt]);
  const fahrzeugText = (() => {
    const a = lage?.aktuell;
    if (!a) return '';
    const live = liveLage[a.id];
    if (lage.vorStart || lage.imUmstieg) return `${a.nummer || ''} ab ${live?.abfahrt || hm(a.ab_zeit)}`.trim();
    const spaet = verspaetungMin(live);
    return `${a.nummer || ''}${spaet ? ` · +${spaet} min` : ''}`.trim();
  })();
  const zielPunkt = reise.ziel_lat != null ? { lat: reise.ziel_lat, lng: reise.ziel_lng } : null;
  const umstiege = useMemo(() => (mehrere ? umstiegPunkte(teile, liveJe) : KEINE_GLEISE), [mehrere, teile, liveJe]);
  const ersterLive = mehrere ? liveJe[teile[0].id] : null;
  const letzter = mehrere ? teile[teile.length - 1] : null;
  const letzterLive = mehrere ? liveJe[letzter.id] : null;
  const flug = reiseArt(reise) === 'flug';
  const nummer = v?.nummer || reiseNummer(reise);
  // Ganze Reise: Abfahrt des ersten, Ankunft des letzten Abschnitts.
  const oben = mehrere ? {
    abfahrt: ersterLive?.abfahrt || hm(teile[0].ab_zeit),
    abfahrtPlan: ersterLive?.abfahrt_plan || '',
    ankunft: letzterLive?.ankunft || hm(letzter.an_zeit) || '--:--',
    ankunftPlan: letzterLive?.ankunft_plan || '',
    gleis: ersterLive?.gleis || teile[0].gleis_ab || '',
    ankunftOrt: [letzter.nach_name, (() => {
      const g = gleisStand(letzterLive?.gleis_an, letzter.gleis_an, letzterLive?.gleis_an_plan).gleis;
      return g ? `Gl. ${g}` : '';
    })()].filter(Boolean).join(' · '),
    unterStart: teile[0].von_name,
  } : null;
  const abfahrt = oben ? oben.abfahrt : (v?.abfahrt || hm(reise.start_zeit));
  const abfahrtPlanRoh = oben ? oben.abfahrtPlan : v?.abfahrt_plan;
  const abfahrtSpaet = minutenSpaet(abfahrtPlanRoh, abfahrt);
  const ankunft = oben ? oben.ankunft : (v?.ankunft || '--:--');
  const ankunftPlanRoh = oben ? oben.ankunftPlan : v?.ankunft_plan;
  const ankunftSpaet = minutenSpaet(ankunftPlanRoh, ankunft);
  const gleisRoh = oben ? oben.gleis : v?.gleis;
  const gleis = gleisRoh ? (flug ? gleisRoh : `Gleis ${gleisRoh}`) : '';
  const ankunftOrt = oben ? oben.ankunftOrt : v?.ankunft_ort;
  // Wallet nur auf iPhone, iPad und Mac anbieten (Apple Wallet).
  const apple = typeof navigator !== 'undefined' && /iPhone|iPad|Macintosh/.test(navigator.userAgent || '');
  const [walletLaedt, setWalletLaedt] = useState(false);
  const zurWallet = async () => {
    setWalletLaedt(true);
    try {
      const r = await walletLink(reise.id);
      if (r.ok) window.location.href = r.url;
      else window.alert(r.meldung);
    } finally {
      setWalletLaedt(false);
    }
  };
  const ticketOeffnen = async () => {
    const url = await ticketLink(reise.ticket_pfad);
    if (url) window.open(url, '_blank', 'noopener');
    else window.alert('Ticket konnte nicht geöffnet werden.');
  };
  const navStart = getNavigationUrl({ name: reise.start_name, address: reise.start_adresse || reise.start_name, lat: reise.start_lat, lng: reise.start_lng });
  const navZiel = getNavigationUrl({ name: reise.ziel_name, address: reise.ziel_adresse || reise.ziel_name, lat: reise.ziel_lat, lng: reise.ziel_lng });
  const erstellt = reise.geaendert || reise.erstellt ? new Date(reise.geaendert || reise.erstellt) : null;
  const notizZeit = erstellt && !Number.isNaN(erstellt.getTime())
    ? { zeit: erstellt.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }), datum: erstellt.toLocaleDateString(locale) }
    : { zeit: '', datum: '' };

  const beenden = async () => {
    if (!window.confirm('Dienstreise beenden?')) return;
    const ok = await onBeenden(reise.id);
    if (ok) setView?.('list');
  };

  const ortSpalte = (icon, titel, name, url, rechts) => (
    <div className={`min-w-0 flex flex-col ${rechts ? 'items-end text-right' : 'items-start text-left'}`}>
      <div className="w-[64px] h-[64px] bg-[#242525] rounded-[16px] flex items-center justify-center">
        <img src={icon} alt="" className="w-[30px] h-[30px] object-contain" />
      </div>
      <div className="mt-[24px] text-[14px] font-bold tracking-[-0.5px]" style={{ color: GRAU }}>{titel}</div>
      {url
        ? <a href={url} target="_blank" rel="noopener noreferrer" className="text-white text-[18px] font-bold tracking-[-0.5px] leading-[1.15] break-words underline decoration-[#e2f754] decoration-2 underline-offset-4 active:opacity-70">{name}</a>
        : <div className="text-white text-[18px] font-bold tracking-[-0.5px] leading-[1.15] break-words">{name}</div>}
    </div>
  );

  return (
    <div
      className="flex flex-col h-screen bg-[#0a0a0a] max-w-md mx-auto relative overflow-hidden font-['Space_Grotesk'] text-white"
      data-tutorial={`dienstreise-detail-${reise.id}`}
      onMouseMove={ziehBewegung}
      onMouseUp={ziehEnde}
      onTouchMove={ziehBewegung}
      onTouchEnd={ziehEnde}
      onMouseLeave={ziehEnde}
    >
      <div className="flex-1 relative">
        <div aria-hidden="true" ref={feldRef} className="absolute left-0 right-0 top-0 pointer-events-none" style={{ bottom: `${sheetHeight}%` }} />
        <StreckenKarte reise={reise} lage={lage} ziel={zielPunkt} umstiege={umstiege} sheetHeight={sheetHeight} fahrerNummer={fahrerNummer} text={fahrzeugText} />
        <button type="button" onClick={() => setView?.('list')} className="absolute left-[20px] top-[60px] w-[50px] h-[50px] z-40 shadow-[0_4px_16px_rgba(0,0,0,0.45)] rounded-full" aria-label="Zurück">
          <MapBackIcon />
        </button>
      </div>

      <div
        ref={blattRef}
        className={`absolute bottom-0 left-0 right-0 bg-[#1a1a1a] rounded-t-[20px] z-30 flex flex-col shadow-[0_-10px_40px_rgba(0,0,0,0.5)] will-change-[height] ${!isDragging ? 'transition-[height] duration-[320ms] ease-[cubic-bezier(0.22,1,0.36,1)]' : ''}`}
        style={{ height: `${sheetHeight}%` }}
      >
        <div className="w-full pt-[18px] pb-[18px] flex justify-center cursor-grab active:cursor-grabbing" onMouseDown={ziehStart} onTouchStart={ziehStart}>
          <div className="w-[87px] h-[6px] bg-[#e2f754]" />
        </div>

        <div ref={scrollRef} className="pb-6 flex-1 overflow-y-auto overscroll-none custom-scrollbar" onTouchStart={inhaltStart} onTouchMove={inhaltBewegung}>
          <div className="px-[20px]">
            {/* Wie ETD/ETA einer Fahrt: Beschriftung klein grau, Zeit gross in Lime, darunter Gleis bzw. Ankunftsort. */}
            <div className="flex items-start justify-between">
              <div>
                <div className="text-[12px] font-bold tracking-[-0.3px]" style={{ color: GRAU }}>{flug ? 'Abflug' : 'Abfahrt'}</div>
                {/* Verspaetet: Zeit orange, daneben "+5" (Entwurf 14.11.), puenktlich Lime ohne Kachel. */}
                <div className="mt-[6px] flex items-center gap-[8px]">
                  <span className="text-[32px] leading-[0.88] font-bold tracking-[-1px]" style={{ color: abfahrtSpaet ? zeitFarbe(abfahrtSpaet) : LIME }}>{abfahrt}</span>
                  <SpaetKachel min={abfahrtSpaet} />
                </div>
                {oben?.unterStart ? <div className="mt-[4px] text-[12px] font-bold" style={{ color: GRAU }}>{oben.unterStart}</div> : null}
                {gleis ? <div className="mt-[4px] text-[12px] font-bold" style={{ color: GRAU }}>{gleis}</div> : null}
              </div>
              <div className="text-right">
                <div className="text-[12px] font-bold tracking-[-0.3px]" style={{ color: GRAU }}>Ankunft</div>
                <div className="mt-[6px] flex items-center justify-end gap-[8px]">
                  <span className="text-[32px] leading-[0.88] font-bold tracking-[-1px]" style={{ color: ankunftSpaet ? zeitFarbe(ankunftSpaet) : LIME }}>{ankunft}</span>
                  <SpaetKachel min={ankunftSpaet} />
                </div>
                {ankunftOrt ? <div className="mt-[4px] text-[12px] font-bold" style={{ color: GRAU }}>{ankunftOrt}</div> : null}
              </div>
            </div>

            <div className="mt-[40px] grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-start gap-x-[12px]">
              {ortSpalte(startIcon(reise), flug ? 'Abflug' : 'Bahnhof', reise.start_name, navStart, false)}
              <img src="/icon/_Icon_Lime/Arrow_Trisar_Icons_01_Lime.svg" alt="" className="w-[46px] h-[26px] mt-[19px] object-contain" />
              {ortSpalte(zielIcon(reise), 'Ziel', reise.ziel_name, navZiel, true)}
            </div>

            {mehrere ? (
              <div className="mt-[40px]">
                <div className="text-[42px] leading-[40px] font-bold tracking-[-1px]" style={{ color: LIME }}>Verbindung</div>
                {teile.map((a, i) => {
                  const live = liveJe[a.id];
                  const ab = live?.abfahrt || hm(a.ab_zeit);
                  const an = live?.ankunft || hm(a.an_zeit);
                  const spaetAb = minutenSpaet(live?.abfahrt_plan, live?.abfahrt);
                  const spaetAn = minutenSpaet(live?.ankunft_plan, live?.ankunft);
                  const naechster = teile[i + 1];
                  const umstieg = naechster
                    ? (() => {
                      const m = (x) => { const t2 = String(x || '').match(/^(\d{1,2}):(\d{2})/); return t2 ? Number(t2[1]) * 60 + Number(t2[2]) : null; };
                      const nAb = m(liveJe[naechster.id]?.abfahrt || hm(naechster.ab_zeit));
                      const dAn = m(an);
                      return nAb != null && dAn != null ? (nAb - dAn + 1440) % 1440 : null;
                    })()
                    : null;
                  // Gleis live gegen Ticket/Fahrplan (15.11.), geaendert in Orange.
                  const gleisAb = gleisStand(live?.gleis, a.gleis_ab, live?.gleis_plan);
                  const gleisAn = gleisStand(live?.gleis_an, a.gleis_an, live?.gleis_an_plan);
                  const nl = naechster ? liveJe[naechster.id] : null;
                  const nGleis = naechster ? gleisStand(nl?.gleis, naechster.gleis_ab, nl?.gleis_plan) : null;
                  return (
                    <React.Fragment key={a.id}>
                      {/* Laufender Abschnitt hervorgehoben (JETZT), erledigte blass mit "gefahren" (Entwurf 14.11.). */}
                      <div className="flex gap-[14px] items-start mt-[22px]" style={{ opacity: lage?.status?.[i] === 'fertig' ? 0.45 : 1 }}>
                        <div
                          className="w-[52px] h-[52px] rounded-[14px] flex items-center justify-center shrink-0 box-border"
                          style={lage?.status?.[i] === 'jetzt' ? { background: '#000', border: `2.5px solid ${LIME}` } : { background: '#242525' }}
                        >
                          <img src={lage?.status?.[i] === 'jetzt' ? fahrzeugIcon(a.art) : abschnittIcon(a.art)} alt="" className="w-[26px] h-[26px] object-contain" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex justify-between items-center gap-[8px]">
                            <span className="text-white text-[22px] font-bold tracking-[-0.5px]">{a.nummer || ''}</span>
                            {lage?.status?.[i] === 'jetzt' ? (
                              <span className="text-[12px] font-bold text-black px-[8px] py-[3px] whitespace-nowrap" style={{ background: LIME }}>JETZT</span>
                            ) : lage?.status?.[i] === 'fertig' ? (
                              <span className="text-[12px] font-bold whitespace-nowrap" style={{ color: GRAU }}>✓ gefahren</span>
                            ) : null}
                          </div>
                          <div className="flex justify-between mt-[6px] gap-[8px]">
                            <span className="text-[18px] font-bold min-w-0 flex items-center gap-[6px] flex-wrap">
                              <span style={{ color: spaetAb ? zeitFarbe(spaetAb) : LIME }}>{ab}</span>
                              <SpaetKachel min={spaetAb} />
                              <span className="text-white">{a.von_name}</span>
                            </span>
                            <GleisRechts stand={gleisAb} grau={GRAU} />
                          </div>
                          <div className="flex justify-between mt-[2px] gap-[8px]">
                            <span className="text-[18px] font-bold min-w-0 flex items-center gap-[6px] flex-wrap">
                              <span style={{ color: spaetAn ? zeitFarbe(spaetAn) : LIME }}>{an}</span>
                              <SpaetKachel min={spaetAn} />
                              <span className="text-white">{a.nach_name || ''}</span>
                            </span>
                            <GleisRechts stand={gleisAn} grau={GRAU} />
                          </div>
                          {/* Zwischenhalte (nur Zug, wenn der Server sie liefert). */}
                          <HalteListe halte={live?.halte} status={lage?.status?.[i]} abfahrt={ab} jetzt={jetzt} />
                        </div>
                      </div>
                      {naechster ? (
                        <div className="flex items-center gap-[10px] mt-[18px] ml-[66px]">
                          <span className="w-[20px] h-[2px]" style={{ background: LIME }} />
                          <span className="text-[14px] font-bold" style={{ color: GRAU }}>
                            Umstieg{umstieg != null ? ` ${umstieg} min` : ''}
                            {gleisAn.gleis && nGleis?.gleis ? (
                              <>
                                {' · Gleis '}
                                <span style={{ color: gleisAn.vorher ? ORANGE : GRAU }}>{gleisAn.gleis}</span>
                                {' → '}
                                <span style={{ color: nGleis.vorher ? ORANGE : GRAU }}>{nGleis.gleis}</span>
                              </>
                            ) : null}
                          </span>
                        </div>
                      ) : null}
                    </React.Fragment>
                  );
                })}
              </div>
            ) : nummer ? (
              <div className="mt-[44px]">
                <div className="text-[58px] leading-[52px] font-bold tracking-[-1px] text-white">{nummer}</div>
                {v?.ankunft_ort ? <div className="mt-[6px] text-[18px] font-bold tracking-[-0.5px]" style={{ color: GRAU }}>Nach: {v.ankunft_ort}</div> : null}
                {!flug ? <HalteListe halte={v?.halte} status={lage?.status?.[0]} abfahrt={abfahrt} jetzt={jetzt} /> : null}
              </div>
            ) : null}

            {reise.notiz ? (
              <>
                <div className="mt-[40px] text-[58px] leading-[52px] font-bold tracking-[-1px]" style={{ color: LIME }}>{t('fahrt.note')}</div>
                <div className="mt-[12px] flex flex-col gap-[6px]">
                  <div className="flex items-center text-[16px] leading-[16px] font-bold tracking-[-0.5px]" style={{ color: GRAU }}>
                    <span>{notizZeit.zeit}</span>
                    {notizZeit.datum ? <span className="ml-[44px]">{notizZeit.datum}</span> : null}
                    <span className="ml-auto text-right">Dispo</span>
                  </div>
                  <div className="text-[#f4f5f4] text-[18px] leading-[22px] font-bold tracking-[-0.5px] whitespace-pre-line break-words">{reise.notiz}</div>
                </div>
              </>
            ) : null}

            {reise.ticket_pfad ? (
              <button type="button" onClick={ticketOeffnen} className="mt-[20px] w-full flex items-center gap-[14px] border-2 border-[#e2f754] px-[14px] py-[12px] text-left active:opacity-70">
                <img src="/icon/_Icon_Grau/Ticket_Trisar_Icons_01_grau.svg" alt="" className="w-[30px] h-[30px] object-contain" />
                <div className="flex-1 min-w-0">
                  <div className="text-white text-[18px] font-bold">Ticket (PDF)</div>
                  <div className="text-[13px] font-bold truncate" style={{ color: GRAU }}>
                    {[reise.auftragsnummer ? `Auftrag ${reise.auftragsnummer}` : '', reise.reisender].filter(Boolean).join(' · ') || (reise.ticket_name || '')}
                  </div>
                </div>
                <img src="/icon/_Icon_Lime/Arrow-kurz_Trisar_Icons_01_Lime.svg" alt="" className="w-[10px] h-[13px]" />
              </button>
            ) : null}
            {reise.ticket_pfad && apple ? (
              <button
                type="button"
                onClick={zurWallet}
                disabled={walletLaedt}
                className="mt-[12px] w-full h-[48px] rounded-[10px] bg-black flex items-center justify-center text-white text-[16px] font-semibold disabled:opacity-60"
                style={{ fontFamily: '-apple-system, Helvetica, sans-serif' }}
              >
                {walletLaedt ? 'Wird erstellt …' : 'Zu Apple Wallet hinzufügen'}
              </button>
            ) : null}

            {reise.status === 'accepted' ? (
              <button type="button" onClick={beenden} className="mt-[48px] w-full h-[56px] bg-[#ff6f63] flex items-center justify-between pl-[18px] pr-[16px]">
                <span className="text-black text-[18px] font-medium tracking-[0.5px]">Dienstreise beenden</span>
                <img src="/icon/_Icon_Schwarz/Arrow_Trisar_Icons_01.svg" alt="" className="w-[34px] h-[19px]" />
              </button>
            ) : null}

            <div className="h-[60px]" />
          </div>
          <TrisarFooter className="relative w-full h-10 bg-[#1a1a1a]" />
        </div>
      </div>
    </div>
  );
}
