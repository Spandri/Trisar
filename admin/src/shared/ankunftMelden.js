// "Ankuenfte bei mir" (17.11.2026, Kundenwunsch): Schalter im Fahrten Filter. Die Dispo bekommt
// Fahrzeuge zu ihrem Ort gemeldet (Push "in 5 min bei dir" und "angekommen"), und die Listen zeigen
// mit dem Schalter nur Fahrten zu diesem Ort: Ankuenfte = Ziel bei mir, Abfahrten = Abholung bei mir.
// Ort = einmal uebernommener Standort des Geraets oder ein eigener Ort (orte).
// Gespeichert auf dem Server (dispo_ankunft_melden, je Konto), weil der push-dienst die Meldungen
// auch bei geschlossener App schickt. Restzeiten rechnet der Server (rpc ankunft_bei_mir), gleich
// fuer Web, iOS und Android. Migration 20261117140000_ankunft_bei_mir.
// Stufe 2 (20261117160000): Ort automatisch (gespeicherter Ort, an dem ich bin, sonst mein Standort,
// laufend nachgefuehrt solange die App offen ist) und Melden "sobald unterwegs" (minuten = 0).
import { useSyncExternalStore } from 'react';
import { supabase } from '../services/supabase';
import { DEMO_MODE } from '../datenquelle';
import { abstandM, eigenerStandort, standortAbonnieren } from './eigenerStandort';

// 0 = sobald unterwegs
export const MINUTEN_AUSWAHL = [0, 1, 2, 3, 5, 10, 15, 20, 30, 45, 60];
// Automatik schreibt den eigenen Standort erst nach so viel Bewegung neu (ohne Ort).
const NACHFUEHREN_M = 100;
const LISTE_TAKT_MS = 30_000;

// Eigene kleine Uebersetzung, damit die grossen Sprachdateien unberuehrt bleiben.
const TEXTE = {
  de: {
    schalter: 'Ankünfte bei mir',
    ort: 'Ort',
    melden: 'Melden',
    vorAnkunft: 'vor Ankunft',
    meinStandort: 'Mein Standort',
    automatisch: 'Automatisch',
    hier: 'hier',
    sobaldUnterwegs: 'sobald unterwegs',
    standortLaedt: 'Standort wird geholt …',
    standortFehlt: 'Standort nicht verfügbar. Bitte einen Ort wählen.',
    da: 'da',
    fehler: 'Speichern hat nicht geklappt.',
  },
  en: {
    schalter: 'Arrivals at my place',
    ort: 'Place',
    melden: 'Notify',
    vorAnkunft: 'before arrival',
    meinStandort: 'My location',
    automatisch: 'Automatic',
    hier: 'here',
    sobaldUnterwegs: 'as soon as on the way',
    standortLaedt: 'Getting location …',
    standortFehlt: 'Location not available. Please choose a place.',
    da: 'here',
    fehler: 'Saving failed.',
  },
};
export const ankunftText = (locale, schluessel, werte = {}) => {
  const sprache = String(locale || 'de').slice(0, 2).toLowerCase();
  const satz = (TEXTE[sprache] || TEXTE.en)[schluessel] || TEXTE.de[schluessel] || schluessel;
  return satz.replace(/\{(\w+)\}/g, (_, k) => String(werte[k] ?? ''));
};

const LEER = {
  geladen: false,
  vorhanden: false, // Tabelle da (Migration eingespielt)
  an: false,
  automatisch: true,
  ortId: null,
  ortName: '',
  lat: null,
  lng: null,
  umkreisM: 300,
  minuten: 5,
  beiAnkunft: true,
  fehler: '',
};

let stand = { ...LEER };
// job_id -> { art, restMin, geschaetzt, angekommen }, getrennt nach art
let liste = { ziel: new Map(), abholung: new Map(), zeit: 0 };
let orte = [];
const hoerer = new Set();
const melden = () => hoerer.forEach((fn) => fn());
const abonnieren = (fn) => {
  hoerer.add(fn);
  takt();
  return () => { hoerer.delete(fn); takt(); };
};

const ausZeile = (z) => ({
  an: Boolean(z?.an),
  automatisch: z?.automatisch !== false,
  ortId: z?.ort_id || null,
  ortName: z?.ort_name || '',
  lat: Number.isFinite(Number(z?.lat)) && z?.lat != null ? Number(z.lat) : null,
  lng: Number.isFinite(Number(z?.lng)) && z?.lng != null ? Number(z.lng) : null,
  umkreisM: Number(z?.umkreis_m) || 300,
  minuten: Number.isFinite(Number(z?.minuten)) && z?.minuten != null ? Number(z.minuten) : 5,
  beiAnkunft: z?.bei_ankunft !== false,
});

const nutzerId = async () => {
  const { data } = await supabase.auth.getSession();
  return data?.session?.user?.id || null;
};

let ladeVersprechen = null;
export const ankunftLaden = () => {
  if (DEMO_MODE) return Promise.resolve();
  if (ladeVersprechen) return ladeVersprechen;
  ladeVersprechen = (async () => {
    const uid = await nutzerId();
    if (!uid) { ladeVersprechen = null; return; }
    const [zeile, ortListe] = await Promise.all([
      supabase.from('dispo_ankunft_melden').select('*').eq('user_id', uid).maybeSingle(),
      supabase.from('orte').select('id, name, lat, lng').order('name'),
    ]);
    orte = (ortListe.data || []).filter((o) => Number.isFinite(Number(o.lat)) && Number.isFinite(Number(o.lng)));
    if (zeile.error) {
      // Migration fehlt noch: Schalter ausblenden statt Fehler zeigen.
      stand = { ...LEER, geladen: true, vorhanden: false };
    } else {
      stand = { ...LEER, ...(zeile.data ? ausZeile(zeile.data) : {}), geladen: true, vorhanden: true };
    }
    melden();
    takt();
    automatikPruefen();
    if (stand.an) listeLaden();
  })().catch(() => { ladeVersprechen = null; });
  return ladeVersprechen;
};

export const ankunftSetzen = async (aenderung) => {
  const vorher = stand;
  stand = { ...stand, ...aenderung, fehler: '' };
  if (!stand.an) liste = { ziel: new Map(), abholung: new Map(), zeit: 0 };
  melden();
  const uid = await nutzerId();
  if (!uid) return;
  const { error } = await supabase.from('dispo_ankunft_melden').upsert({
    user_id: uid,
    an: stand.an,
    automatisch: stand.automatisch,
    ort_id: stand.ortId,
    ort_name: stand.ortName || null,
    lat: stand.lat,
    lng: stand.lng,
    umkreis_m: stand.umkreisM,
    minuten: stand.minuten,
    bei_ankunft: stand.beiAnkunft,
  }, { onConflict: 'user_id' });
  if (error) {
    stand = { ...vorher, fehler: 'fehler' };
    melden();
    return;
  }
  takt();
  automatikPruefen();
  if (stand.an) listeLaden();
};

// Ort fuer Automatik: gespeicherter Ort im Umkreis (der naechste), sonst der eigene Standort.
export const automatikZiel = (pos, umkreisM = stand.umkreisM) => {
  let bester = null;
  for (const o of orte) {
    const m = abstandM(pos, { lat: Number(o.lat), lng: Number(o.lng) });
    if (m <= umkreisM && (!bester || m < bester.m)) bester = { o, m };
  }
  if (bester) return { ortId: bester.o.id, ortName: bester.o.name, lat: Number(bester.o.lat), lng: Number(bester.o.lng) };
  return { ortId: null, ortName: '', lat: pos.lat, lng: pos.lng };
};

// Solange Schalter an und Automatik gewaehlt: Standort verfolgen und Ort nachfuehren.
let automatikAbo = null;
const positionNeu = (pos) => {
  if (!pos || !stand.an || !stand.automatisch) return;
  const ziel = automatikZiel(pos);
  const gleicherOrt = ziel.ortId && ziel.ortId === stand.ortId;
  const kaumBewegt = !ziel.ortId && !stand.ortId && stand.lat != null
    && abstandM(ziel, { lat: stand.lat, lng: stand.lng }) < NACHFUEHREN_M;
  if (gleicherOrt || kaumBewegt) return;
  ortNachfuehren(ziel);
};

// Nur die Orts-Felder schreiben und nur, wenn auf dem Server Schalter und Automatik noch an sind.
// Sonst wuerde ein Fenster mit altem Stand eine Aenderung von einem anderen Geraet ueberschreiben
// (17.11.: Schalter war in der iOS-App aus, ein offenes Web-Fenster hat ihn wieder eingeschaltet).
const ortNachfuehren = async (ziel) => {
  const uid = await nutzerId();
  if (!uid) return;
  const { data, error } = await supabase.from('dispo_ankunft_melden')
    .update({ ort_id: ziel.ortId, ort_name: ziel.ortName || null, lat: ziel.lat, lng: ziel.lng })
    .eq('user_id', uid).eq('an', true).eq('automatisch', true)
    .select('user_id');
  if (error) return;
  if (!data?.length) {
    // Woanders aus- oder umgestellt: Stand neu vom Server holen.
    ladeVersprechen = null;
    await ankunftLaden();
    return;
  }
  stand = { ...stand, ...ziel };
  melden();
  listeLaden();
};
function automatikPruefen() {
  const soll = stand.an && stand.automatisch && !DEMO_MODE;
  if (soll && !automatikAbo) {
    let letzte = null;
    automatikAbo = standortAbonnieren(() => {
      const pos = eigenerStandort();
      if (pos && pos !== letzte) { letzte = pos; positionNeu(pos); }
    });
  }
  if (!soll && automatikAbo) { automatikAbo(); automatikAbo = null; }
}

// Standort des Geraets einmal holen. Gibt { lat, lng } oder null.
export const standortHolen = () => new Promise((fertig) => {
  if (!navigator?.geolocation) { fertig(null); return; }
  navigator.geolocation.getCurrentPosition(
    (pos) => fertig({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
    () => fertig(null),
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 },
  );
});

export const listeLaden = async () => {
  if (DEMO_MODE || !stand.an) return;
  const { data, error } = await supabase.rpc('ankunft_bei_mir');
  if (error) return;
  const neu = { ziel: new Map(), abholung: new Map(), zeit: Date.now() };
  for (const z of data || []) {
    const ziel = z.art === 'abholung' ? neu.abholung : neu.ziel;
    ziel.set(String(z.job_id), {
      restMin: z.rest_min == null ? null : Number(z.rest_min),
      geschaetzt: Boolean(z.geschaetzt),
      angekommen: Boolean(z.angekommen),
    });
  }
  liste = neu;
  melden();
};

// Liste alle 30 s neu holen, solange jemand zuschaut und der Schalter an ist.
let taktId = null;
function takt() {
  const soll = hoerer.size > 0 && stand.an && !DEMO_MODE;
  if (soll && !taktId) taktId = window.setInterval(listeLaden, LISTE_TAKT_MS);
  if (!soll && taktId) { window.clearInterval(taktId); taktId = null; }
}

export const useAnkunftMelden = () => useSyncExternalStore(abonnieren, () => stand);
export const useAnkunftListe = () => useSyncExternalStore(abonnieren, () => liste);
export const ankunftOrte = () => orte;

// Eintrag einer Fahrt in der Liste. arten: welche Listen zaehlen (Ankuenfte beide, Abfahrten nur Abholung).
export const ankunftEintrag = (l, id, arten = ['ziel', 'abholung']) => {
  const schluessel = String(id || '');
  for (const art of arten) {
    const e = l?.[art]?.get(schluessel);
    if (e) return { ...e, art };
  }
  return null;
};

// Reihenfolge mit Schalter: erst unterwegs nach Restzeit, dann geplante (0 = gleich), zuletzt angekommene.
export const ankunftRang = (e) => {
  if (!e) return 3;
  if (e.angekommen) return 2;
  return e.restMin == null ? 1 : 0;
};

// Anzeige der Restzeit: "da", "5 min", "ca. 5 min" oder leer.
// "Mein Standort" in Alle Fahrten (17.11.): Name des gespeicherten Orts, in dem ich gerade stehe
// (Umkreis wie Automatik), sonst null.
export const ortHier = async () => {
  await ankunftLaden();
  const pos = eigenerStandort() || await standortHolen();
  if (!pos) return null;
  const ziel = automatikZiel(pos);
  return ziel.ortId ? ziel.ortName : null;
};

// Anzeige der Melden-Auswahl
export const minutenText = (m, locale) => (m === 0 ? ankunftText(locale, 'sobaldUnterwegs') : `${m} min`);

export const restText = (eintrag, locale) => {
  if (!eintrag) return '';
  if (eintrag.angekommen) return ankunftText(locale, 'da');
  if (eintrag.restMin == null) return '';
  return `${eintrag.geschaetzt ? 'ca. ' : ''}${Math.max(1, eintrag.restMin)} min`;
};
