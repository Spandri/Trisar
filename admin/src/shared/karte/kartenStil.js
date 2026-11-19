// Kartenstil (17.11.): Dunkel (Carto Dark Matter, Standard), Hell (Carto Positron), Farbig
// (Carto Voyager), Satellit (Esri World Imagery mit Strassennamen). Umschalten im Karten Filter,
// je Geraet gemerkt (localStorage), gleich wie iOS und Android. Alle offenen Karten wechseln
// sofort. Satellit braucht den Esri-Schluessel (RPC karten_schluessel, nur Dispo), ohne ihn
// gibt es den Knopf nicht. Auf hellen Stilen bekommen die Zeichen einen weissen Rand.
import { useSyncExternalStore } from 'react';
import { DEMO_MODE, supabase } from '../../services/supabase';

export const STILE = ['dunkel', 'hell', 'farbig', 'satellit'];
export const STIL_STANDARD = 'dunkel';

const CARTO = {
  dunkel: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
  hell: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
  farbig: 'https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json',
};
const ESRI_SATELLIT = 'https://basemapstyles-api.arcgis.com/arcgis/rest/services/styles/v2/styles/arcgis/imagery';

const SCHLUESSEL = 'trisar.karte.stil';

const lesen = () => {
  try {
    const wert = window.localStorage.getItem(SCHLUESSEL);
    return STILE.includes(wert) ? wert : STIL_STANDARD;
  } catch {
    return STIL_STANDARD;
  }
};

let stand = { stil: lesen(), esri: null };
const hoerer = new Set();
const melden = () => hoerer.forEach((fn) => fn());
const abonnieren = (fn) => { hoerer.add(fn); return () => hoerer.delete(fn); };

export const kartenStilAbonnieren = abonnieren;
export const useKartenStil = () => useSyncExternalStore(abonnieren, () => stand);

export const kartenStilSetzen = (stil) => {
  if (!STILE.includes(stil) || stil === stand.stil) return;
  stand = { ...stand, stil };
  try { window.localStorage.setItem(SCHLUESSEL, stil); } catch { /* privat, egal */ }
  melden();
};

// Esri-Schluessel einmal holen (nach dem Anmelden erneut versuchen, falls noch keiner da ist).
let holt = false;
export const kartenSchluesselLaden = () => {
  if (DEMO_MODE || stand.esri || holt) return;
  holt = true;
  supabase.rpc('karten_schluessel').then(({ data, error }) => {
    holt = false;
    if (error || !data) return;
    stand = { ...stand, esri: data };
    melden();
  });
};

export const satellitMoeglich = (s = stand) => Boolean(s.esri);

// Wirksamer Stil: Satellit ohne Schluessel faellt auf Dunkel zurueck.
export const wirksamerStil = (s = stand) => (s.stil === 'satellit' && !s.esri ? STIL_STANDARD : s.stil);

export const stilAdresse = (s = stand) => {
  const stil = wirksamerStil(s);
  if (stil === 'satellit') return `${ESRI_SATELLIT}?token=${encodeURIComponent(s.esri)}&language=de`;
  return CARTO[stil];
};

export const stilIstHell = (s = stand) => wirksamerStil(s) !== 'dunkel';

export const aktuellerStand = () => stand;

// Esri (17.11.): Im Satelliten-Stil haben die Quellen eine Kachel-Liste (tiles, mit Schluessel) UND eine url
// auf den ArcGIS-Dienst. Mit url holt MapLibre dort ein Kachelverzeichnis, bekommt aber Esris eigenes
// Format ohne Kacheln und laedt gar nichts. Darum url entfernen, wo tiles da ist.
export const esriQuellenRichten = (stil) => {
  if (!stil?.sources) return stil;
  const quellen = Object.fromEntries(Object.entries(stil.sources).map(([k, q]) => {
    if (!q || !Array.isArray(q.tiles) || !q.tiles.length || !q.url) return [k, q];
    const { url: _url, ...rest } = q;
    return [k, rest];
  }));
  return { ...stil, sources: quellen };
};

// Weisser Rand um die Zeichen auf hellen Karten, damit Lime und Gelb nicht im Grund verschwinden.
if (typeof document !== 'undefined' && !document.getElementById('trisar-karten-stil')) {
  const regel = document.createElement('style');
  regel.id = 'trisar-karten-stil';
  regel.textContent = '.trisar-karte-hell .trisar-zeichen > img:first-child{filter:drop-shadow(0 0 1px #fff) drop-shadow(0 0 1px #fff) drop-shadow(0 0 0.5px #fff)}';
  document.head.appendChild(regel);
}
