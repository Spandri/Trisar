import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useI18n } from '../i18n';
import { karteBereitstellen } from '../shared/karte/maplibreKarte';

// Kopie von components/views/EinsatzTagKarte.jsx nur fuer die separate MSC-Seite (msc.html),
// erweitert um Ladestopps: vorschlag.ladungen = [{ von, bis, lat, lng, name, kw, socVor, socNach }]
// erscheinen als eigener Zustand "laden" mit dem Lade-Pin (gruen mit Blitz).

// KI Einsatzplanung: der geplante Tag auf der Karte.
// Oeffnet sich aus der Tagesplanung ueber das Kartensymbol der Navigation und
// spielt alle Fahrten des Tages im Zeitraffer ab — jeder Fahrer faehrt seinen
// Plan auf echten Strassen: Anfahrt zum Gast (gelb), Fahrt mit Gast (rot),
// danach frei (gruen). Aufbau wie die Kartenansicht der Disposition; wo dort
// die Statusleiste (aktiv, inaktiv, frei) steht, liegt hier die Zeitleiste mit
// dem Tempo 1x, 2x, 4x.

const LIME = '#e3f654';
const ZUSTAND_FARBE = { aktiv: '#FF6F63', inaktiv: '#E3F654', frei: '#59BE80', laden: '#59BE80' };

const PIN_URLS = {
  aktiv: '/icon/_Icon_Karte/Fahrer_Pin_Trisar_01_rot.svg',
  inaktiv: '/icon/_Icon_Karte/Fahrer_Pin_Trisar_01_gelb.svg',
  frei: '/icon/_Icon_Karte/Fahrer_Pin_Trisar_01_gruen.svg',
  laden: '/icon/_Icon_Karte/Fahrer_Pin_Trisar_01_laden.svg',
};
const LADE_PIN_HOEHE = 51;
const LADE_KREIS_MITTE = 26.5;
const PUNKT_URLS = {
  aktiv: '/icon/_Icon_Karte/Fahrer_Punkt_Trisar_01_rot.svg',
  frei: '/icon/_Icon_Karte/Fahrer_Punkt_Trisar_01_gruen.svg',
};
const KEGEL_URL = '/icon/_Icon_Karte/Fahrtrichtung_Kegel_Trisar_01.svg';
const PIN_BREITE = 35;
const PIN_HOEHE = 41.1367;
const KEGEL_BREITE = 60.7094;
const KEGEL_HOEHE = 50.5079;
const NAHANSICHT_BREITE_M = 3000;
const ABGEBLENDET = 0.3;

// Rand beim Einpassen: oben Knoepfe und Zeitleiste, unten die Navigation.
const RAND = { top: 250, right: 32, bottom: 200, left: 32 };

// 1x = 6 Minuten Tageszeit je Sekunde, wie in der Fahrt-Simulation.
const MINUTEN_JE_SEKUNDE = 6;
const TEMPI = [1, 2, 4];

// Routendienst schonen: zwei Anfragen gleichzeitig, kurze Pause dazwischen.
const GLEICHZEITIG = 2;
const PAUSE_MS = 220;
const ANNAHME_FAHRT_MIN = 25;

const pad2 = (n) => String(n).padStart(2, '0');
const uhrZuMin = (wert) => {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(wert || '').trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};
const minZuUhr = (min) => {
  const m = Math.max(0, Math.floor(min));
  return `${pad2(Math.floor(m / 60) % 24)}:${pad2(m % 60)}`;
};

const bogen = (grad) => (grad * Math.PI) / 180;
const abstandMeter = (a, b) => {
  const dLat = bogen(b.lat - a.lat);
  const dLng = bogen(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(bogen(a.lat)) * Math.cos(bogen(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
};
const richtungGrad = (a, b) => {
  const y = Math.sin(bogen(b.lng - a.lng)) * Math.cos(bogen(b.lat));
  const x = Math.cos(bogen(a.lat)) * Math.sin(bogen(b.lat))
    - Math.sin(bogen(a.lat)) * Math.cos(bogen(b.lat)) * Math.cos(bogen(b.lng - a.lng));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
};
const streckeAus = (pfad) => {
  const summen = [0];
  for (let i = 1; i < pfad.length; i += 1) summen.push(summen[i - 1] + abstandMeter(pfad[i - 1], pfad[i]));
  return { pfad, summen, laenge: summen[summen.length - 1] || 0 };
};
// Luftlinie mal Umwegfaktor bei 30 km/h — bis die echte Strecke da ist.
const schaetzMinuten = (a, b) => Math.max(4, Math.round(((abstandMeter(a, b) * 1.35) / 1000 / 30) * 60));

const punktAuf = (strecke, anteil) => {
  const { pfad, summen, laenge } = strecke;
  if (pfad.length === 1 || laenge <= 0) return { ...pfad[0], grad: null };
  const ziel = Math.max(0, Math.min(1, anteil)) * laenge;
  let i = 1;
  while (i < summen.length - 1 && summen[i] < ziel) i += 1;
  const a = pfad[i - 1];
  const b = pfad[i];
  const f = (ziel - summen[i - 1]) / Math.max(1e-6, summen[i] - summen[i - 1]);
  const hier = { lat: a.lat + (b.lat - a.lat) * f, lng: a.lng + (b.lng - a.lng) * f };
  // Richtung ueber die naechsten 25 m, damit sie in Kurven nicht zappelt.
  let j = i;
  while (j < summen.length - 1 && summen[j] < ziel + 25) j += 1;
  return { ...hier, grad: richtungGrad(hier, pfad[j]) };
};

const wegSchluessel = (a, b) => `${a.lat.toFixed(5)},${a.lng.toFixed(5)}>${b.lat.toFixed(5)},${b.lng.toFixed(5)}`;

// Tagesplan eines Fahrers: Abschnitte mit Zeit, Zustand und Strecke.
//   anfahrt (inaktiv) — direkt nach Dienstbeginn bzw. der letzten Fahrt zum Abholort
//   warten  (inaktiv) — am Abholort, bis der Gast kommt
//   fahrt   (aktiv)   — Gast an Bord
//   frei    (frei)    — keine Fahrt mehr, Dienst laeuft noch
const planBauen = ({ vorschlag, start, orte, wege }) => {
  const fahrten = (vorschlag.rides || [])
    .map((r) => ({
      ...r,
      etdMin: uhrZuMin(r.etd),
      ab: orte.get(r.adresseAb) || orte.get(r.pickup) || null,
      ziel: orte.get(r.adresseZiel) || orte.get(r.dropoff) || null,
    }))
    .filter((r) => r.etdMin != null && r.ab && r.ziel)
    .sort((a, b) => a.etdMin - b.etdMin);
  if (!fahrten.length) return null;

  const dienstBeginn = vorschlag.startMinutes ?? Math.max(0, fahrten[0].etdMin - 45);
  const abschnitte = [];
  const dauer = (a, b) => wege.get(wegSchluessel(a, b))?.minuten ?? schaetzMinuten(a, b);
  let ort = start || fahrten[0].ab;
  let zeit = dienstBeginn;

  const ladungen = (vorschlag.ladungen || []).map((l) => ({ ...l, punkt: { lat: l.lat, lng: l.lng } }));
  let li = 0;
  const ladenBis = (grenze) => {
    // Ladestopps, die vor der naechsten Abholung beginnen: hinfahren, laden, dort bleiben
    while (li < ladungen.length && ladungen[li].von <= grenze) {
      const l = ladungen[li];
      li += 1;
      if (abstandMeter(ort, l.punkt) > 60) {
        const hin = dauer(ort, l.punkt);
        const los = Math.max(zeit, l.von - hin);
        if (los > zeit) abschnitte.push({ art: 'frei', von: zeit, bis: los, a: ort, b: ort });
        abschnitte.push({ art: 'anfahrt', von: los, bis: los + hin, a: ort, b: l.punkt, fahrt: null, laden: l });
        zeit = los + hin;
      }
      const beginn = Math.max(zeit, l.von);
      abschnitte.push({ art: 'laden', von: beginn, bis: Math.max(beginn + 1, l.bis), a: l.punkt, b: l.punkt, laden: l });
      zeit = Math.max(beginn + 1, l.bis);
      ort = l.punkt;
    }
  };

  fahrten.forEach((f) => {
    ladenBis(f.etdMin - 1);
    // Sofort losfahren und am Abholort auf den Gast warten — nicht erst
    // stehen bleiben und dann knapp vor der Abholzeit ankommen.
    if (abstandMeter(ort, f.ab) > 60) {
      const anfahrt = dauer(ort, f.ab);
      abschnitte.push({ art: 'anfahrt', von: zeit, bis: zeit + anfahrt, a: ort, b: f.ab, fahrt: f });
      zeit += anfahrt;
    }
    const beginn = Math.max(zeit, f.etdMin);
    if (beginn > zeit) abschnitte.push({ art: 'warten', von: zeit, bis: beginn, a: f.ab, b: f.ab, fahrt: f });
    const fahrzeit = wege.get(wegSchluessel(f.ab, f.ziel))?.minuten ?? (f.durationMinutes || ANNAHME_FAHRT_MIN);
    abschnitte.push({ art: 'fahrt', von: beginn, bis: beginn + fahrzeit, a: f.ab, b: f.ziel, fahrt: f });
    zeit = beginn + fahrzeit;
    ort = f.ziel;
  });

  ladenBis(Infinity);
  const dienstEnde = Math.max(vorschlag.endMinutes ?? zeit, zeit);
  if (dienstEnde > zeit) abschnitte.push({ art: 'frei', von: zeit, bis: dienstEnde, a: ort, b: ort });
  return { abschnitte, beginn: dienstBeginn, ende: dienstEnde, fahrten };
};

const ZUSTAND_JE_ART = { warten: 'inaktiv', anfahrt: 'inaktiv', fahrt: 'aktiv', frei: 'frei', laden: 'laden' };

const standBei = (plan, minute, wege) => {
  if (!plan || minute < plan.beginn || minute > plan.ende) return null;
  const abschnitt = plan.abschnitte.find((s) => minute >= s.von && minute <= s.bis) || plan.abschnitte[plan.abschnitte.length - 1];
  const zustand = ZUSTAND_JE_ART[abschnitt.art];
  if (abschnitt.a === abschnitt.b || abschnitt.art === 'warten' || abschnitt.art === 'frei' || abschnitt.art === 'laden') {
    return { lat: abschnitt.a.lat, lng: abschnitt.a.lng, grad: null, faehrt: false, zustand, abschnitt };
  }
  const weg = wege.get(wegSchluessel(abschnitt.a, abschnitt.b));
  const strecke = weg?.strecke || streckeAus([abschnitt.a, abschnitt.b]);
  const anteil = (minute - abschnitt.von) / Math.max(0.001, abschnitt.bis - abschnitt.von);
  const punkt = punktAuf(strecke, anteil);
  return { lat: punkt.lat, lng: punkt.lng, grad: punkt.grad, faehrt: anteil > 0 && anteil < 1, zustand, abschnitt, strecke };
};

// Gefahrene Kilometer bis zu einer Minute: fertige Abschnitte ganz, der
// laufende anteilig. Ohne echte Strecke gilt die Luftlinie mal Umwegfaktor.
const kmBis = (plan, minute, wege) => {
  if (!plan || minute <= plan.beginn) return 0;
  let meter = 0;
  plan.abschnitte.forEach((s) => {
    if ((s.art !== 'fahrt' && s.art !== 'anfahrt') || s.a === s.b || minute <= s.von) return;
    const laenge = wege.get(wegSchluessel(s.a, s.b))?.strecke?.laenge ?? abstandMeter(s.a, s.b) * 1.35;
    const anteil = Math.min(1, (minute - s.von) / Math.max(0.001, s.bis - s.von));
    meter += laenge * anteil;
  });
  return meter / 1000;
};

const kmText = (km) => `${new Intl.NumberFormat('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(km)} km`;

const kurzOrt = (text) => {
  const teile = String(text || '').split(',').map((s) => s.trim()).filter(Boolean);
  return teile[0] || '';
};

export default function EinsatzTagKarte({ tagIso, vorschlaege = [], drivers = [], kameraSignal = 0, onZurueck }) {
  const { t, locale } = useI18n();
  const feldRef = useRef(null);
  const karteRef = useRef(null);
  const [karteBereit, setKarteBereit] = useState(false);

  const [orte, setOrte] = useState(() => new Map());
  const [orteFertig, setOrteFertig] = useState(false);
  const wegeRef = useRef(new Map());
  const [wegeStand, setWegeStand] = useState(0);

  const [laeuft, setLaeuft] = useState(false);
  const [tempo, setTempo] = useState(1);
  const [tempoPuls, setTempoPuls] = useState(0);
  const [fertig, setFertig] = useState(false);
  const [gewaehlt, setGewaehlt] = useState(null);
  const [anzeige, setAnzeige] = useState(null); // Infozeile des gewaehlten Fahrers
  // Ohne Auswahl: wie viele Fahrer gerade aktiv, inaktiv, frei sind.
  const [zaehler, setZaehler] = useState({ aktiv: 0, inaktiv: 0, frei: 0, laden: 0 });
  const kmGesamtRef = useRef(null);
  const kmFahrerRef = useRef(null);

  const minuteRef = useRef(0);
  const uhrRef = useRef(null);
  const knopfRef = useRef(null);
  const fuellungRef = useRef(null);
  const spurRef = useRef(null);
  const gewaehltRef = useRef(null);
  gewaehltRef.current = gewaehlt;

  const markerRef = useRef(new Map()); // id -> { marker, kegel, form, deckung }
  const routeRef = useRef({ linie: null, schluessel: '' });

  const datum = useMemo(
    () => new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(`${tagIso}T12:00:00`)),
    [locale, tagIso],
  );

  const fahrerInfo = useMemo(() => {
    const map = new Map();
    (Array.isArray(drivers) ? drivers : []).forEach((d) => {
      if (d?.id) map.set(String(d.id), d);
    });
    return map;
  }, [drivers]);

  // --- Karte -----------------------------------------------------------------
  useEffect(() => {
    karteBereitstellen();
    if (!feldRef.current || karteRef.current) return undefined;
    const karte = new window.trisarKarte.Map(feldRef.current, {
      center: { lat: 48.137154, lng: 11.576124 },
      zoom: 11,
      disableDefaultUI: true,
      clickableIcons: false,
      gestureHandling: 'greedy',
    });
    karte.addListener('click', (event) => {
      if (event?.domEvent?.target?.closest?.('.maplibregl-marker')) return;
      setGewaehlt(null);
    });
    karteRef.current = karte;
    setKarteBereit(true);
    const marker = markerRef.current;
    return () => {
      marker.forEach(({ marker: m, kegel }) => { m.setMap(null); kegel?.setMap(null); });
      marker.clear();
      routeRef.current.linie?.setMap(null);
      karteRef.current = null;
    };
  }, []);

  // --- Orte der Fahrten -------------------------------------------------------
  const adressen = useMemo(() => {
    const menge = new Set();
    vorschlaege.forEach((v) => (v.rides || []).forEach((r) => {
      [r.adresseAb, r.adresseZiel].forEach((a) => { if (String(a || '').trim()) menge.add(a); });
    }));
    return [...menge];
  }, [vorschlaege]);

  useEffect(() => {
    if (!karteBereit) return undefined;
    let aktivLauf = true;
    const geocoder = new window.trisarKarte.Geocoder();
    const suchen = (adresse) => new Promise((resolve) => {
      geocoder.geocode({ address: adresse }, (ergebnis, status) => {
        const pos = status === 'OK' ? ergebnis?.[0]?.geometry?.location : null;
        resolve(pos ? { lat: pos.lat(), lng: pos.lng() } : null);
      });
    });
    (async () => {
      const gefunden = new Map();
      for (const adresse of adressen) {
        const punkt = await suchen(adresse);
        if (!aktivLauf) return;
        if (punkt) gefunden.set(adresse, punkt);
      }
      setOrte(gefunden);
      setOrteFertig(true);
    })();
    return () => { aktivLauf = false; };
  }, [karteBereit, adressen]);

  // --- Plaene ---------------------------------------------------------------------
  const plaene = useMemo(() => {
    if (!orteFertig) return [];
    return vorschlaege
      .map((v) => {
        const info = fahrerInfo.get(String(v.driverId));
        const lat = Number(info?.lat);
        const lng = Number(info?.lng);
        const start = Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
        const plan = planBauen({ vorschlag: v, start, orte, wege: wegeRef.current });
        if (!plan) return null;
        return {
          id: String(v.driverId || v.id),
          name: v.name,
          nummer: info?.driverNumber ?? null,
          plan,
        };
      })
      .filter(Boolean);
    // wegeStand: neue Strecken aendern die Fahrzeiten
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orteFertig, orte, vorschlaege, fahrerInfo, wegeStand]);
  const plaeneRef = useRef(plaene);
  plaeneRef.current = plaene;

  const zeitraum = useMemo(() => {
    if (!plaene.length) return { von: 6 * 60, bis: 22 * 60 };
    const von = Math.min(...plaene.map((p) => p.plan.beginn));
    const bis = Math.max(...plaene.map((p) => p.plan.ende));
    return { von: Math.floor(von / 30) * 30, bis: Math.ceil(bis / 30) * 30 };
  }, [plaene]);
  const zeitraumRef = useRef(zeitraum);
  zeitraumRef.current = zeitraum;

  // Fahrtbeginne als feine Striche auf der Zeitleiste.
  const fahrtStriche = useMemo(() => {
    const spanne = Math.max(1, zeitraum.bis - zeitraum.von);
    return plaene.flatMap((p) => p.plan.fahrten.map((f) => (f.etdMin - zeitraum.von) / spanne))
      .filter((x) => x >= 0 && x <= 1);
  }, [plaene, zeitraum]);

  // --- Strecken nachladen -----------------------------------------------------------
  const offenRef = useRef(new Set());
  useEffect(() => {
    if (!karteBereit || !plaene.length) return undefined;
    let aktivLauf = true;
    const dienst = new window.trisarKarte.DirectionsService();
    const alle = [];
    plaene.forEach((p) => p.plan.abschnitte.forEach((s) => {
      if ((s.art === 'anfahrt' || s.art === 'fahrt') && s.a !== s.b) {
        const schluessel = wegSchluessel(s.a, s.b);
        if (!wegeRef.current.has(schluessel) && !offenRef.current.has(schluessel)) {
          alle.push({ schluessel, a: s.a, b: s.b, von: s.von });
        }
      }
    }));
    // Doppelte zusammenfassen.
    const warteschlange = [...new Map(alle.map((e) => [e.schluessel, e])).values()];
    if (!warteschlange.length) return undefined;
    warteschlange.forEach((e) => offenRef.current.add(e.schluessel));

    const naechster = () => {
      // Was bald gefahren wird, zuerst.
      const jetzt = minuteRef.current;
      warteschlange.sort((x, y) => {
        const dx = x.von < jetzt - 20 ? 10000 + x.von : Math.abs(x.von - jetzt);
        const dy = y.von < jetzt - 20 ? 10000 + y.von : Math.abs(y.von - jetzt);
        return dx - dy;
      });
      return warteschlange.shift();
    };

    let neu = 0;
    let buendelTimer = null;
    const melden = () => {
      if (buendelTimer) return;
      buendelTimer = window.setTimeout(() => {
        buendelTimer = null;
        if (aktivLauf && neu) { neu = 0; setWegeStand((s) => s + 1); }
      }, 700);
    };

    const arbeiter = async () => {
      while (aktivLauf && warteschlange.length) {
        const eintrag = naechster();
        const ergebnis = await new Promise((resolve) => {
          dienst.route({ origin: eintrag.a, destination: eintrag.b }, (res) => resolve(res));
        });
        offenRef.current.delete(eintrag.schluessel);
        const route = ergebnis?.routes?.[0];
        const pfad = (route?.overview_path || []).map((p) => ({ lat: p.lat(), lng: p.lng() }));
        if (!ergebnis?.notloesung && pfad.length >= 2) {
          const sekunden = Number(route.legs?.[0]?.duration?.value) || 0;
          wegeRef.current.set(eintrag.schluessel, {
            strecke: streckeAus(pfad),
            minuten: Math.max(3, Math.round(sekunden / 60)),
          });
          neu += 1;
          melden();
        }
        await new Promise((r) => { window.setTimeout(r, PAUSE_MS); });
      }
    };
    for (let i = 0; i < GLEICHZEITIG; i += 1) arbeiter();
    return () => {
      aktivLauf = false;
      if (buendelTimer) window.clearTimeout(buendelTimer);
      warteschlange.forEach((e) => offenRef.current.delete(e.schluessel));
    };
  }, [karteBereit, plaene]);

  // --- Kamera ------------------------------------------------------------------------
  const einpassen = useCallback(() => {
    const karte = karteRef.current;
    if (!karte || !orte.size) return;
    const grenzen = new window.trisarKarte.LatLngBounds();
    orte.forEach((p) => grenzen.extend(p));
    if (!grenzen.isEmpty()) karte.fitBounds(grenzen, RAND);
  }, [orte]);

  useEffect(() => {
    if (orteFertig) einpassen();
  }, [orteFertig, einpassen]);

  const ersterSignal = useRef(kameraSignal);
  useEffect(() => {
    if (kameraSignal === ersterSignal.current) return;
    setGewaehlt(null);
    einpassen();
  }, [kameraSignal, einpassen]);

  // --- Zeichnen ------------------------------------------------------------------------
  const zeichnen = useCallback(() => {
    const karte = karteRef.current;
    if (!karte || !window.trisarKarte) return;
    const minute = minuteRef.current;
    const { von, bis } = zeitraumRef.current;
    const anteil = Math.max(0, Math.min(1, (minute - von) / Math.max(1, bis - von)));
    if (uhrRef.current) uhrRef.current.textContent = minZuUhr(minute);
    if (knopfRef.current) knopfRef.current.style.left = `${anteil * 100}%`;
    if (fuellungRef.current) fuellungRef.current.style.transform = `scaleX(${anteil})`;

    const nah = (karte.getBreiteMeter?.() ?? Infinity) <= NAHANSICHT_BREITE_M;
    const auswahl = gewaehltRef.current;
    const K = window.trisarKarte;
    const gesehen = new Set();
    let auswahlStand = null;
    const anzahl = { aktiv: 0, inaktiv: 0, frei: 0, laden: 0 };
    let kmAlle = 0;

    plaeneRef.current.forEach((p) => {
      const stand = standBei(p.plan, minute, wegeRef.current);
      const km = kmBis(p.plan, minute, wegeRef.current);
      kmAlle += km;
      if (auswahl === p.id && kmFahrerRef.current) kmFahrerRef.current.textContent = kmText(km);
      let eintrag = markerRef.current.get(p.id);
      if (!stand) {
        if (eintrag) { eintrag.marker.setVisible(false); eintrag.kegel?.setVisible(false); }
        return;
      }
      gesehen.add(p.id);
      anzahl[stand.zustand] += 1;
      const istAuswahl = auswahl === p.id;
      if (istAuswahl) auswahlStand = { ...stand, p };
      const mitRichtung = stand.faehrt && stand.grad != null && stand.zustand !== 'frei' && (nah || istAuswahl);
      const form = `${stand.zustand}|${mitRichtung ? 'punkt' : 'pin'}`;

      if (!eintrag) {
        const marker = new K.Marker({ position: stand, map: karte, zIndex: 1000 });
        marker.setLabel({ text: p.nummer != null ? String(p.nummer) : '?', color: '#1A1A1A', fontSize: '15px', fontWeight: '700' });
        marker.addListener('click', () => setGewaehlt((alt) => (alt === p.id ? null : p.id)));
        marker.element?.setAttribute?.('data-tutorial', `tageskarte-fahrer-${p.id}`);
        eintrag = { marker, kegel: null, form: '', deckung: 1 };
        markerRef.current.set(p.id, eintrag);
      }
      const { marker } = eintrag;
      marker.setVisible(true);
      marker.setPosition(stand);
      if (eintrag.form !== form) {
        eintrag.form = form;
        let icon;
        if (mitRichtung && stand.zustand === 'inaktiv') {
          icon = {
            url: PIN_URLS.inaktiv,
            scaledSize: new K.Size(PIN_BREITE, PIN_HOEHE),
            ausschnitt: new K.Size(PIN_BREITE, PIN_BREITE),
            anchor: new K.Point(PIN_BREITE / 2, PIN_BREITE / 2),
            labelOrigin: new K.Point(PIN_BREITE / 2, PIN_BREITE / 2),
          };
        } else if (mitRichtung) {
          icon = {
            url: PUNKT_URLS[stand.zustand],
            scaledSize: new K.Size(PIN_BREITE, PIN_BREITE),
            anchor: new K.Point(PIN_BREITE / 2, PIN_BREITE / 2),
            labelOrigin: new K.Point(PIN_BREITE / 2, PIN_BREITE / 2),
          };
        } else if (stand.zustand === 'laden') {
          icon = {
            url: PIN_URLS.laden,
            scaledSize: new K.Size(PIN_BREITE, LADE_PIN_HOEHE),
            anchor: new K.Point(PIN_BREITE / 2, LADE_PIN_HOEHE),
            labelOrigin: new K.Point(PIN_BREITE / 2, LADE_KREIS_MITTE),
          };
        } else {
          icon = {
            url: PIN_URLS[stand.zustand],
            scaledSize: new K.Size(PIN_BREITE, PIN_HOEHE),
            anchor: new K.Point(PIN_BREITE / 2, PIN_HOEHE),
            labelOrigin: new K.Point(PIN_BREITE / 2, PIN_BREITE / 2),
          };
        }
        marker.setIcon(icon);
      }
      const deckung = auswahl && !istAuswahl ? ABGEBLENDET : 1;
      if (eintrag.deckung !== deckung) {
        eintrag.deckung = deckung;
        marker.setOpacity(deckung);
      }
      marker.setZIndex(istAuswahl ? 2000 : (stand.zustand === 'aktiv' ? 1200 : 1000));

      if (mitRichtung) {
        if (!eintrag.kegel) {
          eintrag.kegel = new K.Marker({
            position: stand,
            map: karte,
            icon: {
              url: KEGEL_URL,
              scaledSize: new K.Size(KEGEL_BREITE, KEGEL_HOEHE),
              anchor: new K.Point(KEGEL_BREITE / 2, KEGEL_HOEHE),
              rotation: stand.grad,
            },
            zIndex: 990,
          });
        }
        eintrag.kegel.setVisible(true);
        eintrag.kegel.setPosition(stand);
        eintrag.kegel.setRotation(stand.grad);
        eintrag.kegel.setOpacity(deckung);
        eintrag.kegel.setZIndex(istAuswahl ? 1990 : 990);
      } else if (eintrag.kegel) {
        eintrag.kegel.setVisible(false);
      }
    });

    markerRef.current.forEach((eintrag, id) => {
      if (!gesehen.has(id)) { eintrag.marker.setVisible(false); eintrag.kegel?.setVisible(false); }
    });

    // Strecke des gewaehlten Fahrers: blau mit Gast, gelb gestrichelt zum Gast.
    const route = routeRef.current;
    const abschnitt = auswahlStand?.abschnitt;
    const ziel = abschnitt && (abschnitt.art === 'fahrt' || abschnitt.art === 'anfahrt') && abschnitt.a !== abschnitt.b
      ? { a: abschnitt.a, b: abschnitt.b, art: abschnitt.art }
      : null;
    const weg = ziel ? wegeRef.current.get(wegSchluessel(ziel.a, ziel.b)) : null;
    const schluessel = ziel ? `${auswahlStand.p.id}|${wegSchluessel(ziel.a, ziel.b)}|${Boolean(weg)}` : '';
    if (schluessel !== route.schluessel) {
      route.linie?.setMap(null);
      route.linie = null;
      route.schluessel = schluessel;
      if (ziel) {
        const pfad = (weg?.strecke?.pfad || [ziel.a, ziel.b]);
        route.linie = ziel.art === 'fahrt'
          ? new K.Polyline({ path: pfad, strokeColor: '#0059FF', strokeOpacity: 1, strokeWeight: 6, map: karte, zIndex: 300 })
          : new K.Polyline({
            path: pfad,
            strokeColor: LIME,
            strokeOpacity: 0,
            strokeWeight: 5,
            icons: [{ icon: { path: 'M 0,-1 0,1', strokeOpacity: 1, scale: 4, strokeColor: LIME }, offset: '0', repeat: '12px' }],
            map: karte,
            zIndex: 301,
          });
      }
    }

    if (kmGesamtRef.current) kmGesamtRef.current.textContent = kmText(kmAlle);
    setZaehler((alt) => (alt.aktiv === anzahl.aktiv && alt.inaktiv === anzahl.inaktiv && alt.frei === anzahl.frei
      && alt.laden === anzahl.laden ? alt : anzahl));

    // Infozeile nur bei Wechsel neu setzen.
    const info = auswahlStand
      ? `${auswahlStand.p.id}|${auswahlStand.abschnitt.art}|${auswahlStand.abschnitt.fahrt?.etd || auswahlStand.abschnitt.laden?.von || ''}`
      : '';
    setAnzeige((alt) => {
      if ((alt?.schluessel || '') === info) return alt;
      if (!auswahlStand) return null;
      const s = auswahlStand.abschnitt;
      return {
        schluessel: info,
        nummer: auswahlStand.p.nummer,
        name: auswahlStand.p.name,
        zustand: auswahlStand.zustand,
        art: s.art,
        fahrt: s.fahrt ? { etd: s.fahrt.etd, ab: kurzOrt(s.fahrt.pickup || s.fahrt.adresseAb), ziel: kurzOrt(s.fahrt.dropoff || s.fahrt.adresseZiel) } : null,
        laden: s.laden ? { ...s.laden, ort: kurzOrt(s.laden.name), bisUhr: minZuUhr(s.laden.bis) } : null,
      };
    });
  }, []);

  // Nach neuen Plaenen, Strecken oder Auswahl sofort neu zeichnen.
  useEffect(() => { if (karteBereit) zeichnen(); }, [karteBereit, plaene, gewaehlt, zeichnen]);
  // Neu eingeblendete Zeilen bekommen ihre Kilometer sofort, auch wenn die Uhr steht.
  const anzeigeDa = Boolean(anzeige);
  useEffect(() => { if (karteBereit) zeichnen(); }, [karteBereit, anzeigeDa, anzeige?.nummer, orteFertig, zeichnen]);

  // Beim Zoomen zwischen Pin und Punkt mit Richtung wechseln.
  useEffect(() => {
    const karte = karteRef.current;
    if (!karteBereit || !karte) return undefined;
    const horcher = karte.addListener('zoom_changed', () => zeichnen());
    return () => horcher?.remove?.();
  }, [karteBereit, zeichnen]);

  // Start: am Beginn des Tages, dann automatisch los.
  // Nachladende Strecken aendern die Plaene — der Start darf davon nicht
  // abgebrochen werden, darum haengt sein Zeitgeber nur am Schliessen.
  const gestartet = useRef(false);
  const startTimer = useRef(0);
  useEffect(() => {
    if (!plaene.length || gestartet.current) return;
    gestartet.current = true;
    minuteRef.current = zeitraum.von;
    zeichnen();
    startTimer.current = window.setTimeout(() => setLaeuft(true), 900);
  }, [plaene, zeitraum, zeichnen]);
  useEffect(() => () => window.clearTimeout(startTimer.current), []);

  // --- Uhr ---------------------------------------------------------------------------------
  const tempoRef = useRef(tempo);
  tempoRef.current = tempo;
  useEffect(() => {
    if (!laeuft) return undefined;
    let rahmen = 0;
    let zuletzt = null;
    let intervall = 0;
    const weiter = (jetzt) => {
      if (zuletzt == null) zuletzt = jetzt;
      const dt = Math.min(0.1, (jetzt - zuletzt) / 1000);
      zuletzt = jetzt;
      const { bis } = zeitraumRef.current;
      const naechste = minuteRef.current + dt * MINUTEN_JE_SEKUNDE * tempoRef.current;
      if (naechste >= bis) {
        minuteRef.current = bis;
        zeichnen();
        setLaeuft(false);
        setFertig(true);
        return false;
      }
      minuteRef.current = naechste;
      zeichnen();
      return true;
    };
    const bild = (jetzt) => { if (weiter(jetzt)) rahmen = requestAnimationFrame(bild); };
    rahmen = requestAnimationFrame(bild);
    // Im verdeckten Fenster laufen keine Bilder — dann im Takt weiter.
    intervall = window.setInterval(() => {
      if (document.visibilityState === 'hidden') weiter(performance.now());
      else zuletzt = zuletzt ?? performance.now();
    }, 250);
    return () => { cancelAnimationFrame(rahmen); window.clearInterval(intervall); };
  }, [laeuft, zeichnen]);

  const abspielen = () => {
    if (fertig) {
      minuteRef.current = zeitraumRef.current.von;
      setFertig(false);
      zeichnen();
    }
    setLaeuft((l) => !l);
  };

  const tempoWechseln = () => {
    setTempo((alt) => TEMPI[(TEMPI.indexOf(alt) + 1) % TEMPI.length]);
    setTempoPuls((n) => n + 1);
  };

  // Zeitleiste ziehen: waehrend des Ziehens steht die Uhr.
  const ziehen = useRef(null);
  const minuteAus = (clientX) => {
    const box = spurRef.current?.getBoundingClientRect();
    if (!box || box.width <= 0) return null;
    const anteil = Math.max(0, Math.min(1, (clientX - box.left) / box.width));
    const { von, bis } = zeitraumRef.current;
    return von + anteil * (bis - von);
  };
  const ziehStart = (e) => {
    const minute = minuteAus(e.clientX);
    if (minute == null) return;
    try { e.currentTarget.setPointerCapture?.(e.pointerId); } catch { /* egal */ }
    ziehen.current = { liefVorher: laeuft };
    setLaeuft(false);
    setFertig(false);
    minuteRef.current = minute;
    zeichnen();
  };
  const ziehZug = (e) => {
    if (!ziehen.current) return;
    const minute = minuteAus(e.clientX);
    if (minute == null) return;
    minuteRef.current = minute;
    zeichnen();
  };
  const ziehEnde = () => {
    if (!ziehen.current) return;
    const { liefVorher } = ziehen.current;
    ziehen.current = null;
    if (liefVorher) setLaeuft(true);
  };

  const ohneFahrten = orteFertig && !plaene.length;

  return (
    <div className="absolute inset-0 z-[70] flex justify-center bg-black" data-tutorial="planer-tageskarte">
      <div className="w-[min(402px,100vw)] h-dvh relative overflow-hidden overscroll-none" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>
        <div ref={feldRef} className="absolute inset-0" />

        <button
          type="button"
          onClick={onZurueck}
          data-tutorial="tageskarte-zurueck"
          aria-label={t('karten.back')}
          className="absolute top-[60px] left-[20px] z-20 w-[50px] h-[50px] touch-none select-none"
        >
          <span className="block w-[50px] h-[50px] rounded-full bg-black overflow-hidden">
            <img src="/icon/_Icon_Karte/Backbutton_Karte.svg?v=2" alt="" className="w-[50px] h-[50px] object-contain" />
          </span>
        </button>

        {/* Datum des Tages, rechts oben in der Hoehe des Zurueck-Knopfs */}
        <div className="absolute top-[60px] right-[20px] z-20 h-[50px] px-[18px] rounded-full bg-black flex items-center">
          <span className="text-[16px] font-bold leading-none tracking-[0.5px] whitespace-nowrap" style={{ color: LIME }}>{datum}</span>
        </div>

        {/* Zeitleiste an der Stelle der Statusleiste */}
        <div
          data-tutorial="tageskarte-zeitleiste"
          className="absolute left-1/2 -translate-x-1/2 top-[142px] z-20 w-[362px] h-11 bg-black rounded-xl pl-[8px] pr-[6px] flex items-center"
        >
          <button
            type="button"
            onClick={abspielen}
            disabled={!plaene.length}
            aria-label={laeuft ? t('planer.dayMapPause') : t('planer.dayMapPlay')}
            data-tutorial="tageskarte-abspielen"
            className="w-[32px] h-[32px] flex items-center justify-center shrink-0 disabled:opacity-30"
          >
            {laeuft ? (
              <svg viewBox="0 0 14 16" className="w-[12px] h-[14px]" fill={LIME}><rect x="1" y="0" width="4" height="16" rx="1" /><rect x="9" y="0" width="4" height="16" rx="1" /></svg>
            ) : fertig ? (
              <svg viewBox="0 0 18 18" className="w-[16px] h-[16px]" fill="none" stroke={LIME} strokeWidth="2.4" strokeLinecap="round"><path d="M3.5 9a5.5 5.5 0 1 0 1.9-4.2" /><path d="M2.8 2.5v3.6h3.6" /></svg>
            ) : (
              <svg viewBox="0 0 14 16" className="w-[12px] h-[14px] ml-[2px]" fill={LIME}><path d="M1.5 1.2v13.6a.8.8 0 0 0 1.2.7l10.6-6.8a.8.8 0 0 0 0-1.4L2.7.5a.8.8 0 0 0-1.2.7z" /></svg>
            )}
          </button>

          <span
            ref={uhrRef}
            className="w-[54px] shrink-0 text-white text-base leading-none font-bold tabular-nums"
          >
            {minZuUhr(zeitraum.von)}
          </span>

          <div
            ref={spurRef}
            role="slider"
            tabIndex={0}
            aria-label={t('planer.dayMapTimeline')}
            aria-valuemin={zeitraum.von}
            aria-valuemax={zeitraum.bis}
            onPointerDown={ziehStart}
            onPointerMove={ziehZug}
            onPointerUp={ziehEnde}
            onPointerCancel={ziehEnde}
            onKeyDown={(e) => {
              const schritt = e.shiftKey ? 30 : 5;
              if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                const { von, bis } = zeitraumRef.current;
                minuteRef.current = Math.max(von, Math.min(bis, minuteRef.current + (e.key === 'ArrowLeft' ? -schritt : schritt)));
                zeichnen();
              }
            }}
            className="relative flex-1 h-full mx-[8px] cursor-ew-resize touch-none select-none"
          >
            {/* Grundlinie, gefahrener Teil, Fahrtbeginne */}
            <span className="absolute left-0 right-0 top-1/2 -translate-y-1/2 h-[2px] rounded-full bg-white/20" />
            {fahrtStriche.map((x, i) => (
              <span
                key={`strich-${i}`}
                className="absolute top-1/2 w-px h-[8px] -translate-y-1/2 bg-white/25 pointer-events-none"
                style={{ left: `${x * 100}%` }}
              />
            ))}
            <span
              ref={fuellungRef}
              className="absolute left-0 right-0 top-1/2 -translate-y-1/2 h-[2px] rounded-full origin-left pointer-events-none"
              style={{ background: LIME, transform: 'scaleX(0)' }}
            />
            <span
              ref={knopfRef}
              className="absolute top-1/2 w-3 h-3 -translate-x-1/2 -translate-y-1/2 rounded-full border border-[#202020] pointer-events-none"
              style={{ left: '0%', background: LIME, boxShadow: '0 0 0 3px rgba(227,246,84,0.18)' }}
            />
          </div>

          <button
            type="button"
            onClick={tempoWechseln}
            aria-label={t('planer.dayMapSpeed', { n: tempo })}
            data-tutorial="tageskarte-tempo"
            className="w-[40px] h-[32px] shrink-0 flex items-center justify-center"
          >
            <span
              key={tempoPuls}
              className="text-base leading-none font-bold tabular-nums tageskarte-tempo"
              style={{ color: LIME }}
            >
              {`${tempo}x`}
            </span>
          </button>
        </div>

        {/* Gewaehlter Fahrer: Name und Kilometer, darunter was er gerade tut */}
        {anzeige ? (
          <div
            key={anzeige.nummer ?? anzeige.name}
            data-tutorial="tageskarte-fahrer-info"
            className="absolute left-1/2 -translate-x-1/2 top-[194px] z-20 w-[362px] bg-black rounded-xl px-[16px] pt-[14px] pb-[12px] tageskarte-einblenden"
          >
            <div className="flex items-center gap-[10px]">
              <span className="w-3 h-3 rounded-full border border-[#202020] shrink-0" style={{ backgroundColor: ZUSTAND_FARBE[anzeige.zustand], transition: 'background-color 300ms ease' }} />
              <span className="min-w-0 text-white text-base leading-none font-bold truncate">
                {anzeige.nummer != null ? `${anzeige.nummer} ` : ''}
                <span className="font-normal">{anzeige.name}</span>
              </span>
              <span ref={kmFahrerRef} className="ml-auto shrink-0 text-base leading-none font-bold tabular-nums" style={{ color: LIME }}>0,0 km</span>
            </div>
            <p className="mt-[8px] pl-[22px] text-[13px] leading-[18px] text-white/60">
              {anzeige.laden ? (
                <>
                  {anzeige.art === 'laden' ? 'Lädt' : 'Fährt zum Laden'}
                  {' · '}<span className="font-bold text-white">{anzeige.laden.ort}</span>
                  {` · ${anzeige.laden.kw} kW · Akku ${anzeige.laden.socVor} → ${anzeige.laden.socNach} % · bis ${anzeige.laden.bisUhr}`}
                </>
              ) : anzeige.art === 'frei' || !anzeige.fahrt ? t('planer.dayMapFree') : (
                <>
                  {anzeige.art !== 'fahrt' ? `${anzeige.art === 'anfahrt' ? t('planer.dayMapOnTheWay') : t('planer.dayMapWaiting')} · ` : ''}
                  <span className="font-bold text-white">{t('planer.dayMapClock', { zeit: anzeige.fahrt.etd })}</span>
                  {anzeige.art === 'fahrt'
                    ? ` · ${anzeige.fahrt.ab} – ${anzeige.fahrt.ziel}`
                    : ` · ${anzeige.fahrt.ab}`}
                </>
              )}
            </p>
          </div>
        ) : null}

        {/* Ohne Auswahl: Lage des Tages zu diesem Zeitpunkt */}
        {!anzeige && orteFertig && !ohneFahrten ? (
          <div
            data-tutorial="tageskarte-lage"
            className={`absolute left-1/2 -translate-x-1/2 top-[194px] z-20 w-[362px] h-11 bg-black rounded-xl px-[16px] flex items-center ${zaehler.laden > 0 ? "gap-[9px]" : "gap-[14px]"} tageskarte-einblenden`}
          >
            {['aktiv', 'inaktiv', 'frei', 'laden'].filter((z) => z !== 'laden' || zaehler.laden > 0).map((zustand) => (
              <span key={zustand} className="flex items-center gap-[6px] whitespace-nowrap">
                <span className="w-3 h-3 rounded-full border border-[#202020]" style={{ backgroundColor: ZUSTAND_FARBE[zustand] }} />
                <span className="text-white text-base leading-none font-bold tabular-nums">{zaehler[zustand]}</span>
                <span className="text-white/60 text-[13px] leading-none">
                  {zustand === 'laden' ? 'lädt' : t(zustand === 'aktiv' ? 'planer.dayMapActive' : zustand === 'inaktiv' ? 'planer.dayMapInactive' : 'planer.dayMapFree')}
                </span>
              </span>
            ))}
            <span ref={kmGesamtRef} className="ml-auto shrink-0 text-base leading-none font-bold tabular-nums" style={{ color: LIME }}>0,0 km</span>
          </div>
        ) : null}

        {!orteFertig || ohneFahrten ? (
          <div className="absolute left-1/2 -translate-x-1/2 top-[194px] z-20 w-[362px] h-11 bg-black rounded-xl px-[16px] flex items-center justify-center">
            <span className="text-[13px] font-medium tracking-[0.5px]" style={{ color: LIME }}>
              {ohneFahrten ? t('planer.dayMapEmpty') : t('planer.dayMapLoading')}
            </span>
          </div>
        ) : null}
      </div>
    </div>
  );
}
