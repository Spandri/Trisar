// Eigene Navigation der Fahrer-App (16.11., Design navi-design.png). Nur bei Fahrten mit Route von
// Dispo: Knopf "Navigation starten" im Fahrtblatt, dann Vollbild-Karte in Fahrtrichtung mit
// Abbiegehinweis, Ansage, ETA. Faehrt der Fahrer falsch, kommt die Route ueber die noch offenen
// Punkte der Dispo neu. Ohne Route von Dispo bleibt Google Maps (Tipp auf die Adresse).
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import * as maplibregl from 'maplibre-gl';
import { supabase } from '../../../shared/supabase/client';
import { karteBereitstellen } from '../../../shared/karte/maplibreKarte';
import {
  ABSEITS_FOLGE, ABSEITS_M, NEU_RECHNEN_MS,
  abNachFortschritt, ankunftText, ansagen, endArt, entfernungText, gastAnBord, hatNavigation, istAngekommen,
  naechsterHinweis, planAusAntwort, projizieren, restText, vorschauText,
} from '../../../shared/navigation/naviLogik';

const LIME = '#E2F754';
const ORANGE = '#FF9F43';
const BLAU = '#0059FF';

const vorschauZielElement = () => {
  const el = document.createElement('div');
  el.style.cssText = `width:20px;height:20px;border-radius:50%;background:${LIME};border:3px solid #000;box-sizing:border-box;pointer-events:none`;
  return el;
};

const Strich = ({ farbe, abstand = 0 }) => <span className="inline-block w-[18px] h-[4px] shrink-0" style={{ background: farbe, marginLeft: abstand }} />;

// Pfeile im 38er-Feld. Links-Formen sind die gespiegelten Rechts-Formen.
const PFEIL_FORM = {
  gerade: ['M19 34V6', 'M9 16l10-10 10 10'],
  rechts: ['M10 34V18a6 6 0 0 1 6-6h14', 'M22 4l9 8-9 8'],
  leicht_rechts: ['M13 34V22l14-14', 'M16 7h12v12'],
  scharf_rechts: ['M12 34V10l14 14', 'M26 13v12H14'],
  wenden: ['M26 34V16a8 8 0 0 0-16 0v10', 'M3 19l7 8 7-8'],
  kreisel: ['M19 34v-7', 'M19 27a7 7 0 1 1 0-14a7 7 0 0 1 0 14', 'M24 15l7-7', 'M24 8h7v7'],
  ziel: ['M11 34V5', 'M11 6h17l-4 6 4 6H11'],
};

function Pfeil({ art, farbe = LIME, groesse = 38, staerke = 4.5 }) {
  const links = String(art || '').endsWith('_links') || art === 'links';
  const form = PFEIL_FORM[String(art || '').replace('links', 'rechts')] || PFEIL_FORM[art] || PFEIL_FORM.gerade;
  return (
    <svg width={groesse} height={groesse} viewBox="0 0 38 38" fill="none" aria-hidden="true">
      <g transform={links ? 'translate(38,0) scale(-1,1)' : undefined} stroke={farbe} strokeWidth={staerke} strokeLinecap="square">
        {form.map((d) => <path key={d} d={d} />)}
      </g>
    </svg>
  );
}

const sprechen = (text, ton) => {
  if (!ton || !text || typeof window === 'undefined' || !window.speechSynthesis) return;
  try {
    const satz = new SpeechSynthesisUtterance(text);
    satz.lang = 'de-DE';
    window.speechSynthesis.speak(satz);
  } catch { /* Ansage ist Zugabe */ }
};

const fahrerElement = () => {
  const el = document.createElement('div');
  el.style.cssText = 'width:68px;height:68px;display:flex;align-items:center;justify-content:center;border-radius:50%;background:rgba(47,107,255,0.18);pointer-events:none';
  el.innerHTML = '<svg width="44" height="54" viewBox="0 0 44 54"><path d="M22 3 L41 50 L22 39 L3 50 Z" fill="#2F6BFF" stroke="#fff" stroke-width="3" stroke-linejoin="round"/></svg>';
  return el;
};

function NavigationAnsicht({ job, onClose }) {
  const feldRef = useRef(null);
  const karteRef = useRef(null);
  const linieRef = useRef(null);
  // Mit Vorschau: Anfahrt blau, darunter die Route der Dispo (Abholort bis Ziel) in Lime.
  const anfahrtRef = useRef(null);
  const vorschauRef = useRef(null);
  const vorschauZielRef = useRef(null);
  const [vorschau, setVorschau] = useState(null);
  const fahrerRef = useRef(null);
  const planRef = useRef(null);
  const standRef = useRef({ index: 0, ab: 0, abseits: 0, angesagt: false, letzteAnfrage: 0, laedt: false, merker: {}, pos: null, phase: null });
  const tonRef = useRef(true);
  const [ton, setTon] = useState(true);
  // Karte: 'folgen' (Kamera faehrt mit, Kurs oben) oder 'frei' (Nutzer hat verschoben oder die Uebersicht gewaehlt).
  const modusRef = useRef('folgen');
  const [modus, setModus] = useState('folgen');
  const kameraRef = useRef({ zoom: 16.5, geste: false, kurs: 0 });
  // zustand: warte (kein Standort) | laden | aktiv | abseits | angekommen | fehler
  const [bild, setBild] = useState({ zustand: 'warte', naechster: null, ankunft: '', rest: '', ende: 'ziel' });

  const mitGast = gastAnBord(job);
  const jobId = job?.id;

  const routeLaden = useCallback(async (pos) => {
    const stand = standRef.current;
    if (stand.laedt) return;
    stand.laedt = true;
    stand.letzteAnfrage = Date.now();
    const bisAbholung = stand.phase === 'anfahrt';
    try {
      const { data } = await supabase.functions.invoke('places-proxy', {
        body: {
          aktion: 'navi_route',
          job_id: jobId,
          lat: pos.lat,
          lng: pos.lng,
          kurs: Number.isFinite(pos.kurs) ? pos.kurs : null,
          ab: bisAbholung ? 0 : Math.max(1, stand.ab),
          bis_abholung: bisAbholung,
        },
      });
      const plan = planAusAntwort(data);
      if (!plan) {
        if (!planRef.current) setBild((alt) => ({ ...alt, zustand: 'fehler' }));
        return;
      }
      planRef.current = plan;
      stand.index = 0;
      stand.abseits = 0;
      stand.merker = {};
      const v = bisAbholung ? plan.vorschau : null;
      linieRef.current?.setPath(v ? [] : plan.punkte);
      anfahrtRef.current?.setPath(v ? plan.punkte : []);
      vorschauRef.current?.setPath(v ? v.punkte : []);
      vorschauZielRef.current?.remove();
      vorschauZielRef.current = null;
      const karte = karteRef.current?.karte;
      if (v && karte) {
        const ende = v.punkte[v.punkte.length - 1];
        vorschauZielRef.current = new maplibregl.Marker({ element: vorschauZielElement(), anchor: 'center' })
          .setLngLat([ende.lng, ende.lat]).addTo(karte);
      }
      setVorschau(v);
    } catch {
      if (!planRef.current) setBild((alt) => ({ ...alt, zustand: 'fehler' }));
    } finally {
      stand.laedt = false;
    }
  }, [jobId]);

  // Ein neuer Standort: Fortschritt, Hinweis, Ansage, Abseits, Ankunft, Kamera.
  const standort = useCallback((pos) => {
    const stand = standRef.current;
    stand.pos = pos;
    const karte = karteRef.current?.karte;
    const plan = planRef.current;
    if (!plan) {
      if (Date.now() - stand.letzteAnfrage > NEU_RECHNEN_MS || stand.letzteAnfrage === 0) {
        setBild((alt) => (alt.zustand === 'fehler' ? alt : { ...alt, zustand: 'laden' }));
        routeLaden(pos);
      }
      fahrerRef.current?.setLngLat([pos.lng, pos.lat]);
      if (modusRef.current === 'folgen' && !kameraRef.current.geste) karte?.easeTo({ center: [pos.lng, pos.lat], zoom: kameraRef.current.zoom, duration: 600 });
      return;
    }
    const p = projizieren(plan, pos, stand.index);
    if (!p) return;
    const abseits = p.abstand > ABSEITS_M;
    stand.abseits = abseits ? stand.abseits + 1 : 0;
    const istAbseits = stand.abseits >= ABSEITS_FOLGE;
    if (!abseits) {
      stand.index = p.index;
      stand.ab = abNachFortschritt(plan, p.s, stand.ab);
    }
    if (istAbseits) {
      // Einmal je Abweichung ansagen, neu anfordern nur alle paar Sekunden.
      if (!stand.angesagt) {
        stand.angesagt = true;
        sprechen('Route wird neu berechnet', tonRef.current);
      }
      if (Date.now() - stand.letzteAnfrage > NEU_RECHNEN_MS) routeLaden(pos);
    } else {
      stand.angesagt = false;
    }

    const angekommen = !istAbseits && istAngekommen(plan, p.s);
    if (!istAbseits) ansagen(plan, p.s, stand.merker).forEach((text) => sprechen(text, tonRef.current));
    const naechster = naechsterHinweis(plan, p.s);
    setBild({
      zustand: istAbseits ? 'abseits' : angekommen ? 'angekommen' : 'aktiv',
      naechster,
      ankunft: ankunftText(plan, p.s),
      rest: restText(plan, p.s),
      ende: endArt(plan),
    });

    // Auf der Route sitzt der Pfeil auf der Linie, abseits am echten Standort.
    const ort = abseits ? pos : p;
    const kurs = Number.isFinite(pos.kurs) && pos.tempo > 2 ? pos.kurs : (abseits ? kameraRef.current.kurs : p.kurs);
    if (Number.isFinite(kurs)) kameraRef.current.kurs = kurs;
    stand.ort = ort;
    // Der Pfeil haengt an der Karte und zeigt in Fahrtrichtung, auch wenn die Karte frei gedreht ist.
    fahrerRef.current?.setLngLat([ort.lng, ort.lat]);
    fahrerRef.current?.setRotation(kameraRef.current.kurs);
    // Frei verschobene Karte bleibt stehen, waehrend einer Zoom-Geste auch.
    if (modusRef.current !== 'folgen' || kameraRef.current.geste) return;
    // Kamerafahrt so lang wie der Abstand der Standorte, dann laeuft die Karte gleichmaessig mit.
    const jetzt = Date.now();
    const dauer = Math.min(1100, Math.max(250, jetzt - (stand.letzterStandort || jetzt - 1000)));
    stand.letzterStandort = jetzt;
    karte?.easeTo({
      center: [ort.lng, ort.lat], bearing: kameraRef.current.kurs, pitch: 45, zoom: kameraRef.current.zoom, duration: dauer, offset: [0, 140], easing: (x) => x,
    });
  }, [routeLaden]);

  // Karte, Linie, Fahrer-Pfeil.
  useEffect(() => {
    const KARTE = karteBereitstellen();
    if (!feldRef.current || karteRef.current) return undefined;
    const karte = new KARTE.Map(feldRef.current, { zoom: 15 });
    karteRef.current = karte;
    linieRef.current = new KARTE.Polyline({ path: [], strokeColor: LIME, strokeWeight: 11, zIndex: 2, map: karte });
    vorschauRef.current = new KARTE.Polyline({ path: [], strokeColor: LIME, strokeWeight: 8, zIndex: 1, map: karte });
    anfahrtRef.current = new KARTE.Polyline({ path: [], strokeColor: BLAU, strokeWeight: 11, zIndex: 3, map: karte });
    fahrerRef.current = new maplibregl.Marker({ element: fahrerElement(), anchor: 'center', rotationAlignment: 'map', pitchAlignment: 'viewport' })
      .setLngLat([11.5755, 48.1374]).addTo(karte.karte);
    // Bedienung wie in Navi-Apps: verschieben oder drehen loest die Karte vom Fahrer ("frei"),
    // zoomen allein aendert nur die Zoomstufe, mit der die Karte weiter folgt.
    const frei = (e) => {
      if (!e?.originalEvent) return;
      modusRef.current = 'frei';
      setModus('frei');
    };
    karte.karte.on('dragstart', frei);
    karte.karte.on('rotatestart', frei);
    karte.karte.on('pitchstart', frei);
    karte.karte.on('zoomstart', (e) => { if (e?.originalEvent) kameraRef.current.geste = true; });
    karte.karte.on('zoomend', (e) => {
      if (!e?.originalEvent && !kameraRef.current.geste) return;
      kameraRef.current.geste = false;
      if (modusRef.current === 'folgen') kameraRef.current.zoom = karte.karte.getZoom();
    });
    return () => {
      fahrerRef.current?.remove();
      fahrerRef.current = null;
      vorschauZielRef.current?.remove();
      vorschauZielRef.current = null;
      linieRef.current = null;
      anfahrtRef.current = null;
      vorschauRef.current = null;
      karte.abbauen();
      karteRef.current = null;
    };
  }, []);

  // Standort verfolgen.
  useEffect(() => {
    if (!navigator.geolocation) return undefined;
    const nr = navigator.geolocation.watchPosition(
      (g) => standort({
        lat: g.coords.latitude, lng: g.coords.longitude, kurs: g.coords.heading, tempo: g.coords.speed ?? 0,
      }),
      () => {},
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 20000 },
    );
    return () => navigator.geolocation.clearWatch(nr);
  }, [standort]);

  // Phase: vor der Abholung nur die Anfahrt, mit Gast die Route der Dispo. Wechselt sie, neu laden.
  useEffect(() => {
    const stand = standRef.current;
    const phase = mitGast ? 'fahrt' : 'anfahrt';
    if (stand.phase === phase) return;
    stand.phase = phase;
    if (phase === 'fahrt') stand.ab = Math.max(1, stand.ab);
    planRef.current = null;
    linieRef.current?.setPath([]);
    anfahrtRef.current?.setPath([]);
    vorschauRef.current?.setPath([]);
    vorschauZielRef.current?.remove();
    vorschauZielRef.current = null;
    setVorschau(null);
    stand.letzteAnfrage = 0;
    if (stand.pos) standort(stand.pos);
  }, [mitGast, standort]);

  // Bildschirm an lassen, Ansage beim Schliessen stoppen.
  useEffect(() => {
    let sperre = null;
    const holen = async () => {
      try { sperre = await navigator.wakeLock?.request('screen'); } catch { /* nicht jedes Geraet */ }
    };
    const sichtbar = () => { if (document.visibilityState === 'visible') holen(); };
    holen();
    document.addEventListener('visibilitychange', sichtbar);
    return () => {
      document.removeEventListener('visibilitychange', sichtbar);
      sperre?.release?.().catch(() => {});
      window.speechSynthesis?.cancel();
    };
  }, []);

  // Ausschnitt auf Punkte einpassen, Norden oben, Karte danach frei.
  const einpassen = (punkte) => {
    const karte = karteRef.current?.karte;
    if (!karte || punkte.length < 2) return;
    modusRef.current = 'frei';
    setModus('frei');
    const lats = punkte.map((p) => p.lat);
    const lngs = punkte.map((p) => p.lng);
    karte.fitBounds(
      [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]],
      { padding: { top: 220, bottom: 150, left: 50, right: 70 }, bearing: 0, pitch: 0, duration: 700, maxZoom: 16 },
    );
  };

  // Uebersicht: ganze restliche Route (bei der Anfahrt samt Route der Dispo). Zentrieren: zurueck zum Mitfahren.
  const uebersicht = () => {
    const plan = planRef.current;
    const stand = standRef.current;
    if (!plan) return;
    const rest = plan.punkte.slice(stand.index);
    if (stand.ort) rest.push(stand.ort);
    if (vorschau) rest.push(...vorschau.punkte);
    einpassen(rest);
  };
  const zentrieren = () => {
    modusRef.current = 'folgen';
    setModus('folgen');
    kameraRef.current.zoom = 16.5;
    kameraRef.current.geste = false;
    const ort = standRef.current.ort || standRef.current.pos;
    if (ort) {
      karteRef.current?.karte?.easeTo({
        center: [ort.lng, ort.lat], bearing: kameraRef.current.kurs, pitch: 45, zoom: 16.5, duration: 700, offset: [0, 140],
      });
    }
  };

  const tonUmschalten = () => {
    tonRef.current = !tonRef.current;
    setTon(tonRef.current);
    if (!tonRef.current) window.speechSynthesis?.cancel();
  };

  const { zustand, naechster } = bild;
  // Am Abholort mit Vorschau: ganze Route der Dispo zeigen, Anfahrt ausblenden, ETA zum Ziel.
  const amAbholort = !!vorschau && zustand === 'angekommen' && bild.ende === 'abholung';
  const einpassenRef = useRef(einpassen);
  einpassenRef.current = einpassen;
  useEffect(() => {
    if (!vorschau) return;
    anfahrtRef.current?.setPath(amAbholort ? [] : (planRef.current?.punkte || []));
    if (amAbholort) einpassenRef.current(vorschau.punkte);
  }, [amAbholort, vorschau]);
  const etaText = amAbholort
    ? new Date(Date.now() + vorschau.dauer * 1000).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
    : bild.ankunft;
  const abseits = zustand === 'abseits';
  const farbe = abseits ? ORANGE : LIME;
  const endText = bild.ende === 'abholung' ? 'Abholort erreicht' : bild.ende === 'stopp' ? 'Zwischenstopp erreicht' : 'Ziel erreicht';
  const hinweis = naechster?.hinweis;
  const gross = abseits ? 'Abseits der Route'
    : zustand === 'angekommen' ? endText
      : zustand === 'warte' ? 'Warte auf Standort'
        : zustand === 'laden' ? 'Route wird geladen'
          : zustand === 'fehler' ? 'Route konnte nicht geladen werden'
            : entfernungText(naechster?.entfernung ?? 0);
  const klein = abseits ? 'Zurück zur Route von Dispo' : zustand === 'aktiv' ? (hinweis?.kurz || '') : '';
  const pfeilArt = abseits ? 'wenden' : zustand === 'angekommen' ? 'ziel' : zustand === 'aktiv' ? hinweis?.pfeil : 'gerade';
  const langerText = abseits || zustand !== 'aktiv';

  return createPortal(
    <div className="fixed inset-0 z-[2000] bg-black flex justify-center font-['Space_Grotesk']" data-tutorial="navigation">
      <div className="relative w-[min(402px,100vw)] h-dvh overflow-hidden bg-[#0e0e0e]">
        <div ref={feldRef} className="absolute inset-0" />

        <div className="absolute left-[12px] right-[12px] top-[54px] z-[10] bg-black px-[16px] py-[14px] flex items-center gap-[14px]" style={{ border: `1.5px solid ${farbe}` }}>
          <div className="w-[64px] h-[64px] shrink-0 bg-[#242525] rounded-[16px] flex items-center justify-center">
            <Pfeil art={pfeilArt} farbe={farbe} />
          </div>
          <div className="min-w-0">
            <div className={`${langerText ? 'text-[22px] leading-[1.1]' : 'text-[32px] leading-none'} font-bold tracking-[-1px]`} style={{ color: farbe }}>{gross}</div>
            {klein ? <div className={`${abseits ? 'text-[15px]' : 'text-[18px]'} text-white font-bold tracking-[-0.5px] leading-[1.15] mt-[4px] break-words`}>{klein}</div> : null}
          </div>
        </div>

        <div className="absolute left-[12px] top-[150px] z-[10] flex flex-col items-start gap-[8px]">
          {zustand === 'aktiv' && naechster?.danach ? (
            <div className="bg-black px-[12px] py-[6px] flex items-center gap-[8px] text-[13px] font-bold text-[#ccc]" style={{ border: '1.5px solid #4a4f22', borderTop: 'none' }}>
              dann
              <Pfeil art={naechster.danach.pfeil} farbe="#ccc" groesse={16} staerke={5} />
              <span className="truncate max-w-[220px]">{naechster.danach.strasse || naechster.danach.kurz}</span>
            </div>
          ) : null}
          {vorschau ? (
            <div className="bg-black px-[12px] py-[6px] flex items-center gap-[8px] text-[13px] font-bold text-white" style={{ border: '1.5px solid #4A4F22' }}>
              {amAbholort ? (
                <>
                  <Strich farbe={LIME} />
                  <span>{['Route Dispo', vorschauText(vorschau)].filter(Boolean).join(' · ')}</span>
                </>
              ) : (
                <>
                  <Strich farbe={BLAU} />
                  <span>Anfahrt</span>
                  <Strich farbe={LIME} abstand={6} />
                  <span>Route Dispo</span>
                </>
              )}
            </div>
          ) : null}
        </div>

        <div className="absolute right-[12px] bottom-[118px] z-[10] flex flex-col gap-[10px]">
          {modus === 'frei' ? (
            <button type="button" onClick={zentrieren} aria-label="Zentrieren" className="w-[50px] h-[50px] rounded-full flex items-center justify-center" style={{ background: LIME }} data-tutorial="navi-zentrieren">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="#000" aria-hidden="true"><path d="M12 2l8 19-8-4.5L4 21z" /></svg>
            </button>
          ) : null}
          <button type="button" onClick={uebersicht} aria-label="Route anzeigen" className="w-[50px] h-[50px] rounded-full bg-[#242525] flex items-center justify-center" data-tutorial="navi-uebersicht">
            <svg width="26" height="26" viewBox="0 0 26 26" fill="none" stroke={LIME} strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
              <path d="M7 20c0-7 12-6 12-13" />
              <circle cx="7" cy="21" r="2.4" fill={LIME} stroke="none" />
              <circle cx="19" cy="5" r="2.4" fill={LIME} stroke="none" />
            </svg>
          </button>
        </div>

        <div className="absolute left-0 right-0 bottom-0 z-[10] bg-black px-[20px] pt-[16px] pb-[30px] flex items-center gap-[12px]" style={{ borderTop: `1.5px solid ${LIME}` }}>
          <div className="flex-1 min-w-0">
            <div className="text-[#868687] text-[12px] font-bold tracking-[-0.3px]">{amAbholort ? 'ETA Ziel' : 'ETA'}</div>
            <div className="flex items-baseline gap-[10px]">
              <span className="text-[32px] leading-none font-bold tracking-[-1px]" style={{ color: LIME }}>{etaText || '--:--'}</span>
              {amAbholort ? null : <span className="text-[14px] font-bold text-[#f4f5f4] opacity-60 truncate">{bild.rest}</span>}
            </div>
          </div>
          <button type="button" onClick={tonUmschalten} aria-label={ton ? 'Ansage aus' : 'Ansage an'} className="w-[56px] h-[56px] shrink-0 rounded-full bg-[#242525] flex items-center justify-center">
            <svg width="26" height="26" viewBox="0 0 26 26" fill="none" stroke={LIME} strokeWidth="2.2" aria-hidden="true">
              <path d="M4 10h4l6-5v16l-6-5H4z" />
              {ton ? <path d="M18 9a5 5 0 0 1 0 8M20.5 6a9 9 0 0 1 0 14" /> : <path d="M18 9l6 8M24 9l-6 8" />}
            </svg>
          </button>
          <button type="button" onClick={onClose} aria-label="Navigation beenden" className="w-[56px] h-[56px] shrink-0 rounded-full bg-[#ff6f63] border-2 border-black flex items-center justify-center">
            <svg width="22" height="22" viewBox="0 0 22 22" stroke="#000" strokeWidth="3" aria-hidden="true"><path d="M4 4l14 14M18 4L4 18" /></svg>
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// Knopf im Fahrtblatt (absolut gesetzt wie die uebrigen Teile des Blatts) samt Ansicht.
export default function NaviStart({ job, top }) {
  const [offen, setOffen] = useState(false);
  if (!hatNavigation(job)) return null;
  return (
    <>
      <button
        type="button"
        onClick={() => {
          // Erste Ansage direkt im Tipp: Safari gibt die Sprachausgabe nur nach einer Geste frei.
          sprechen('Navigation gestartet', true);
          setOffen(true);
        }}
        className="absolute left-[20px] right-[20px] h-[56px] bg-[#e2f754] border-2 border-[#e2f754] pl-[16px] pr-[12px] flex items-center justify-between"
        style={{ top: `${top}px` }}
        data-tutorial="navigation-starten"
      >
        <span className="text-neutral-800 text-[16px] font-medium tracking-[0.5px]">Navigation starten</span>
        <svg width="34" height="20" viewBox="0 0 34 20" fill="none" aria-hidden="true">
          <path d="M29.9128 11.9119L29.9128 12.6164L20.2915 16.2347L20.2915 19.917L34 14.4095L34 5.50789L20.2915 0.000415031L20.2915 3.68274L29.9128 7.30102L29.9128 8.00547L0 8.00547L0 11.9119L29.9128 11.9119Z" fill="#202020" />
        </svg>
      </button>
      {offen ? <NavigationAnsicht job={job} onClose={() => setOffen(false)} /> : null}
    </>
  );
}
