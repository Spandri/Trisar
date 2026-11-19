// Web-Dispo waechst mit dem Bildschirm (19.11.2026).
// Alle Ansichten sind fuer eine Handy-Spalte von 402 px gebaut (w-[min(402px,100vw)], 362 px Inhalt).
// Statt 50 Ansichten umzubauen, wird #root per transform: scale vergroessert oder verkleinert
// (bis 19.11. abends CSS zoom, das zeichnete die Karte in aelterem Safari falsch, iPad 2018):
// - Handy: Spalte fuellt genau die Breite (360 px Handy: nichts mehr abgeschnitten, 430 px: kein Rand).
// - Tablet/Laptop: bis 1,5-fach (603 px), aber nur so weit, dass mindestens 700 px Hoehe bleiben.
// Damit Hoehen weiter stimmen, liefern window.innerWidth/innerHeight und --app-h Werte in App-Pixeln
// (echte Pixel / Zoom). getBoundingClientRect und clientX bleiben echte Pixel, passen also zueinander.
// In der Demo aus (Tutorial-Rahmen rechnet mit echten Pixeln), lokal zum Testen mit ?wachsen=1.
import { DEMO_MODE } from './datenquelle.js';

const BASIS_BREITE = 402;
const MAX_ZOOM = 1.5;
const MIN_HOEHE = 700;
const HANDY_BIS = 600;

let zoom = 1;
export const bildschirmZoom = () => zoom;

const echt = (name) => {
  const d = Object.getOwnPropertyDescriptor(window, name);
  return d?.get ? () => d.get.call(window) : null;
};

const aktiv = !DEMO_MODE || new URLSearchParams(window.location.search).has('wachsen');
const echteBreite = aktiv ? echt('innerWidth') : null;
const echteHoehe = aktiv ? echt('innerHeight') : null;

const berechnen = (b, h) => {
  if (b < HANDY_BIS) return b / BASIS_BREITE;
  return Math.max(1, Math.min(b / BASIS_BREITE, h / MIN_HOEHE, MAX_ZOOM));
};

const anwenden = () => {
  const b = echteBreite();
  const h = echteHoehe();
  zoom = Math.round(berechnen(b, h) * 1000) / 1000;
  const html = document.documentElement;
  html.style.setProperty('--app-h', `${h / zoom}px`);
  html.style.setProperty('--app-w', `${b / zoom}px`);
  html.classList.add('wachsen');
  // #root ist so gross wie der Bildschirm in App-Pixeln und wird auf echte Groesse skaliert.
  // Fixierte Elemente darin (Navi, Fenster) beziehen sich dadurch auf #root, nicht auf das Fenster.
  const wurzel = document.getElementById('root');
  if (wurzel) {
    Object.assign(wurzel.style, {
      position: 'fixed', top: '0', left: '0', overflow: 'hidden',
      width: `${b / zoom}px`, height: `${h / zoom}px`,
      transform: zoom === 1 ? 'none' : `scale(${zoom})`, transformOrigin: '0 0',
    });
  }
};

if (echteBreite && echteHoehe) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, get: () => echteBreite() / zoom });
  Object.defineProperty(window, 'innerHeight', { configurable: true, get: () => echteHoehe() / zoom });
  anwenden();
  window.addEventListener('resize', anwenden);
}
