// Hintergrund ueber den ganzen Bildschirm (19.11.2026).
// Die Ansichten sind eine 402-px-Spalte mit eigenem Verlauf. Auf Tablet/Laptop blieben links und rechts
// schwarze Raender. Hier wird der sichtbare Verlauf einer Spalte auf die naechste Flaeche gelegt, die
// den ganzen Bildschirm breit ist (die App selbst oder ein Vollbild-Fenster wie der Filter), als ein
// Lauf ohne Kante am Spaltenrand. Die Spalte und die Ebenen dazwischen werden durchsichtig.
// Ansichten mit Karte bleiben schwarz (der Verlauf liegt dort nur unsichtbar hinter der Karte).
// Nur wenn die Seite mitwaechst (html.wachsen, bildschirm.js), also nicht in der Demo.
import { bildschirmZoom } from './bildschirm.js';
// Haengt sich selbst ein (main.jsx), die Flaeche liegt als eigene Ebene hinter #root.

const SPALTE = '[class*="min(402px"]';
const MARKE = 'data-hintergrund-breit';
const BEMALT = 'data-hintergrund-flaeche';
const gemerkt = new WeakMap();

const bildVon = (e) => {
  if (gemerkt.has(e)) return gemerkt.get(e);
  if (e.hasAttribute(BEMALT)) return null;
  const s = getComputedStyle(e);
  const v = s.backgroundImage && s.backgroundImage !== 'none' ? { bild: s.backgroundImage, farbe: s.backgroundColor } : null;
  if (v) gemerkt.set(e, v);
  return v;
};

// Startpunkte: aeussere Spalten und Vollbild-Fenster (fixed inset-0).
const startpunkte = (host) => {
  const spalten = [...host.querySelectorAll(SPALTE)].filter((e) => !e.parentElement?.closest(SPALTE));
  const fenster = [...host.querySelectorAll('[class*="inset-0"]')]
    .filter((e) => e.parentElement !== host && getComputedStyle(e).position === 'fixed');
  return [...spalten, ...fenster];
};

// Oberste Flaeche mit Verlauf, die die Spalte ganz bedeckt (bis 5 Ebenen tief).
const verlaufIn = (start, spaltenBreite) => {
  let treffer = null;
  const gehen = (e, tiefe, oben) => {
    const r = e.getBoundingClientRect();
    if (r.width < spaltenBreite * 0.95 || Math.abs(r.top - oben) > 4) return;
    if (e.classList.contains('maplibregl-map')) { treffer = 'karte'; return; }
    if (bildVon(e)) treffer = e;
    if (tiefe < 5) for (const k of e.children) gehen(k, tiefe + 1, oben);
  };
  gehen(start, 0, start.getBoundingClientRect().top);
  return treffer;
};

export const hintergrundBreitStarten = () => {
  const wurzel = document.getElementById('root');
  if (!wurzel || !document.documentElement.classList.contains('wachsen')) return;
  const ebene = document.createElement('div');
  ebene.setAttribute('aria-hidden', 'true');
  Object.assign(ebene.style, {
    position: 'fixed', inset: '0', zIndex: '-1', pointerEvents: 'none',
    backgroundSize: '100% 100%', backgroundRepeat: 'no-repeat',
  });
  wurzel.parentNode.insertBefore(ebene, wurzel);
  let geplant = 0;
  let markiert = new Set();
  let bemalt = new Map(); // Flaeche -> vorheriger Inline-Hintergrund

  const anwenden = () => {
    geplant = 0;
    // Aeusserste App-Flaeche (App oder Anmeldung) ist schwarz und laege sonst ueber der Ebene.
    const host = wurzel.firstElementChild;
    if (!host) return;
    host.setAttribute(MARKE, '');
    const spalte = host.querySelector(SPALTE);
    const spaltenBreite = spalte ? spalte.getBoundingClientRect().width : 0;
    const neuMarkiert = new Set([host]);
    const neuBemalt = new Map();
    if (spaltenBreite > 0) {
      // getBoundingClientRect misst echte Pixel, innerWidth ist in App-Pixeln (bildschirm.js).
      const vollBreit = window.innerWidth * bildschirmZoom() * 0.98;
      for (const start of startpunkte(host)) {
        const g = verlaufIn(start, spaltenBreite);
        if (!g || g === 'karte') continue;
        // Naechste Flaeche nach oben, die den ganzen Bildschirm breit ist. Die App selbst = eigene Ebene.
        let a = g;
        const dazwischen = [];
        while (a && a !== host && a.getBoundingClientRect().width < vollBreit) {
          dazwischen.push(a);
          a = a.parentElement;
        }
        if (!a) continue;
        dazwischen.forEach((e) => neuMarkiert.add(e));
        neuBemalt.set(a === host ? ebene : a, bildVon(g));
      }
    }
    markiert.forEach((e) => { if (!neuMarkiert.has(e)) e.removeAttribute(MARKE); });
    neuMarkiert.forEach((e) => e.setAttribute(MARKE, ''));
    bemalt.forEach((vorher, e) => {
      if (neuBemalt.has(e)) return;
      if (e === ebene) {
        e.style.backgroundImage = 'none';
        e.style.backgroundColor = '';
      } else {
        e.style.backgroundImage = vorher.bild;
        e.style.backgroundSize = vorher.groesse;
        e.style.backgroundColor = vorher.farbe;
        e.removeAttribute(BEMALT);
      }
    });
    const bisher = bemalt;
    bemalt = new Map();
    neuBemalt.forEach((v, e) => {
      bemalt.set(e, bisher.get(e) || { bild: e.style.backgroundImage, groesse: e.style.backgroundSize, farbe: e.style.backgroundColor });
      e.style.backgroundImage = v.bild;
      e.style.backgroundSize = '100% 100%';
      // Unter dem Verlauf immer deckend, sonst schiene bei Fenstern die Ansicht darunter durch.
      e.style.backgroundColor = /rgba\(.*,\s*0\)|transparent/.test(v.farbe) ? '#000' : v.farbe;
      if (e !== ebene) e.setAttribute(BEMALT, '');
    });
    markiert = neuMarkiert;
  };
  const planen = () => {
    // Kein requestAnimationFrame: das laeuft in verdeckten Fenstern nicht.
    if (!geplant) geplant = window.setTimeout(anwenden, 0);
  };

  planen();
  new MutationObserver(planen).observe(wurzel, { childList: true, subtree: true });
  window.addEventListener('resize', planen);
};
