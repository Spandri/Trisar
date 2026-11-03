// Risiko je Fahrt fuer die Demo: vorab aus denselben 500 Verlaeufen gerechnet,
// mit denen die Engine geplant hat (werkzeuge/engine/risiko_export.py,
// Ergebnis in data/risiko-ergebnisse.json). Dazu die Ereignisse des Tages und
// was die Disposition daran aendert. Eigene Aenderungen leben nur im Browser-Tab
// und werden in der Demo nicht neu gerechnet.
import { useEffect, useState } from 'react';
import { tagIndex } from './engineErgebnisse';

let versprechen = null;
let daten = null;
const laden = () => {
  if (!versprechen) {
    versprechen = import('./data/risiko-ergebnisse.json')
      .then((modul) => { daten = modul?.default || modul; return daten; })
      .catch(() => null);
  }
  return versprechen;
};

export const BISHER_PUFFER_MIN = 20;

// Tag und Option (Standard oder Sicher). null, wenn der Tag nicht gerechnet ist.
export const risikoTag = (d, dayIso) => d?.tage?.[String(tagIndex(dayIso))] || null;
export const risikoOption = (d, dayIso, option = 'standard') => {
  const tag = risikoTag(d, dayIso);
  return tag?.optionen?.[option] || tag?.optionen?.standard || null;
};
export const risikoFahrt = (d, dayIso, rideId, option = 'standard') => (
  risikoOption(d, dayIso, option)?.fahrten?.[String(rideId || '')] || null
);

// Daten laden und neu rendern, sobald sie da sind.
export const useRisikoDaten = () => {
  const [d, setD] = useState(daten);
  useEffect(() => {
    let aktiv = true;
    if (!daten) laden().then((x) => { if (aktiv) setD(x); });
    return () => { aktiv = false; };
  }, []);
  return d;
};

// Hauptgrund einer Fahrt in wenigen Worten: spuerbares Ereignis vor der haeufigsten Ursache.
export const risikoGrund = (f) => {
  if (!f) return '';
  if (f.ereignis && (f.ereignis.min >= 5 || !f.ursachen?.length)) {
    return `${f.ereignis.name.replace(', Allianz Arena', '')}${f.ereignis.route === 'FTO' ? ', über FTO' : ''}`;
  }
  return f.ursachen?.[0]?.name || 'kaum Schwankung';
};

// Puffer gilt nur fuer den Plan der Engine: passt der eingetragene Fahrer dazu?
// Vergleich ueber den Nachnamen ("V. Schulte (78)" passt zu "Volker Schulte").
const nachname = (name) => String(name || '').replace(/\(.*\)/, '').trim().split(/\s+/).pop()?.toLowerCase() || '';
// Lage einer laufenden Fahrt. Die Demo hat keine Live-Daten: Sie zieht je
// Fahrt einen festen Verlauf aus derselben Fahrzeit-Verteilung (p10, p50, p90),
// mit der das Risiko gerechnet ist. Ergebnis: Minuten gegenueber dem Plan und
// ein kurzer Text, wie ihn im Betrieb Verkehrsdaten und Fahrzeug liefern.
const festerZufall = (text) => {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 10000) / 10000;
};
export const liveLage = (f, rideId) => {
  const z = f?.fahrzeit;
  if (!z || !Number.isFinite(z.plan) || !Number.isFinite(z.p50)) return null;
  const q = 0.05 + 0.9 * festerZufall(String(rideId || ''));
  const wert = q < 0.5
    ? z.p10 + (z.p50 - z.p10) * ((q - 0.05) / 0.45)
    : z.p50 + (z.p90 - z.p50) * ((q - 0.5) / 0.45);
  const min = Math.round(wert - z.plan);
  if (min >= 3) {
    const grund = f.ereignis?.min >= 5 ? f.ereignis.name.split(',')[0] : 'Mehr Verkehr';
    return { min, klasse: min >= 10 ? 'hoch' : 'mittel', text: `${grund} · ${min} min später` };
  }
  if (min <= -3) return { min, klasse: 'niedrig', text: `Weniger Verkehr · ${-min} min früher` };
  return { min, klasse: 'niedrig', text: 'Läuft nach Plan' };
};

// Lage einer Fahrt in den naechsten Stunden: nur was man vorher schon sieht,
// also Verkehr, Ereignisse und verspaetete Fluege oder Zuege. Ob ein Gast
// spaeter bereit ist, weiss vorher niemand, das zaehlt hier nicht.
export const NAH_STUNDEN = 3;
export const naheLage = (f) => {
  if (!f || f.klasse === 'niedrig') return '';
  if (f.ereignis?.min >= 5) return f.ereignis.name.split(',')[0].replace('Starker Verkehr', 'Verkehr');
  const namen = (f.ursachen || []).map((u) => u.name);
  if (namen.some((n) => n.startsWith('Flug'))) return 'Flug verspätet';
  if (namen.includes('Zug verspätet')) return 'Zug verspätet';
  if (namen.includes('Mehr Verkehr als üblich')) return 'Verkehr nimmt zu';
  return '';
};

export const fahrerPasst = (f, eintraege) => {
  const soll = nachname(f?.fahrer);
  return Boolean(soll) && (eintraege || []).some((e) => nachname(e) === soll);
};

export const KLASSE_TEXT = { hoch: 'Risiko hoch', mittel: 'Risiko mittel', niedrig: 'Risiko niedrig' };

// --- Ereignisse: automatisch gefundene plus Aenderungen der Disposition --------
// { [iso]: { entfernt: [id], geaendert: { [id]: { zeit, wirkung } }, eigene: [ereignis] } }
const aenderungen = {};
const hoerer = new Set();
const melden = () => hoerer.forEach((f) => f());
const tagAenderung = (iso) => {
  if (!aenderungen[iso]) aenderungen[iso] = { entfernt: [], geaendert: {}, eigene: [] };
  return aenderungen[iso];
};

const stunde = (hhmm, auf = false) => {
  const [h, m] = String(hhmm || '').split(':').map(Number);
  if (!Number.isFinite(h)) return '';
  const wert = auf && m > 0 ? h + 1 : h;
  return String(wert % 24 === 0 && wert > 0 ? 24 : wert).padStart(2, '0');
};

// Kachelwerte: Name, Zeitfenster gross, eine Zeile Wirkung.
const kachel = (e) => {
  if (e.kachel) return e.kachel;
  const gross = e.zeit === 'ganztägig' ? 'ganztags' : `${stunde(e.von)}–${stunde(e.bis, true)}`;
  const klein = {
    heimspiel: `A9 Nord · bis +${(e.wirkung.match(/\+(\d+)/) || [])[1] || '?'} min`,
    messe: `Zufahrt Messe · bis +${(e.wirkung.match(/\+(\d+)/) || [])[1] || '?'} min`,
    innenstadt: `Altstadt · bis +${(e.wirkung.match(/\+(\d+)/) || [])[1] || '?'} min`,
    fluege: `${e.fahrten} Fahrten · Verspätung`,
    zuege: `${e.fahrten} ${e.fahrten === 1 ? 'Fahrt' : 'Fahrten'} · Verspätung`,
    verkehr: 'Muster je Stunde',
  }[e.id] || e.wirkung;
  return { name: e.kurz || e.titel, gross, klein };
};

export const ereignisseFuerTag = (d, iso) => {
  const auto = risikoTag(d, iso)?.ereignisse || [];
  const a = aenderungen[iso] || { entfernt: [], geaendert: {}, eigene: [] };
  const liste = auto
    .filter((e) => !a.entfernt.includes(e.id))
    .map((e) => {
      const g = a.geaendert[e.id];
      const neu = g ? { ...e, ...g, angepasst: true } : { ...e };
      if (g) delete neu.kachel;
      return { ...neu, quelleArt: 'auto', kachelWerte: kachel(neu) };
    });
  return [
    ...liste,
    ...a.eigene.map((e) => ({ ...e, quelleArt: 'eigen', kachelWerte: kachel(e) })),
  ];
};

export const entfernteEreignisse = (d, iso) => {
  const a = aenderungen[iso];
  if (!a) return [];
  return (risikoTag(d, iso)?.ereignisse || []).filter((e) => a.entfernt.includes(e.id));
};

export const ereignisEntfernen = (iso, id) => {
  const a = tagAenderung(iso);
  if (a.eigene.some((e) => e.id === id)) a.eigene = a.eigene.filter((e) => e.id !== id);
  else if (!a.entfernt.includes(id)) a.entfernt = [...a.entfernt, id];
  melden();
};

export const ereignisWiederherstellen = (iso, id) => {
  const a = tagAenderung(iso);
  a.entfernt = a.entfernt.filter((x) => x !== id);
  melden();
};

export const ereignisAendern = (iso, id, werte) => {
  const a = tagAenderung(iso);
  const eigen = a.eigene.find((e) => e.id === id);
  if (eigen) a.eigene = a.eigene.map((e) => (e.id === id ? { ...e, ...werte } : e));
  else a.geaendert = { ...a.geaendert, [id]: { ...(a.geaendert[id] || {}), ...werte } };
  melden();
};

export const ereignisHinzufuegen = (iso, ereignis) => {
  const a = tagAenderung(iso);
  a.eigene = [...a.eigene, ereignis];
  melden();
};

// Neu rendern, wenn die Disposition Ereignisse aendert.
export const useEreignisAenderungen = () => {
  const [, setN] = useState(0);
  useEffect(() => {
    const f = () => setN((n) => n + 1);
    hoerer.add(f);
    return () => { hoerer.delete(f); };
  }, []);
};

// Freitext der Disposition grob deuten: Uhrzeiten "14 bis 18", "14-18 Uhr", "14:30–18:00".
export const ereignisAusText = (text) => {
  const t = String(text || '').trim();
  if (!t) return null;
  const m = t.match(/(\d{1,2})(?::(\d{2}))?\s*(?:Uhr)?\s*(?:bis|-|–)\s*(\d{1,2})(?::(\d{2}))?/i);
  const zeit = (h, mm) => `${String(Number(h)).padStart(2, '0')}:${mm || '00'}`;
  const von = m ? zeit(m[1], m[2]) : '';
  const bis = m ? zeit(m[3], m[4]) : '';
  const art = /sperr/i.test(t) ? 'Sperrung' : /demo|kundgebung/i.test(t) ? 'Demonstration'
    : /baustelle/i.test(t) ? 'Baustelle' : /stau|unfall/i.test(t) ? 'Verkehr' : 'Ereignis';
  const ort = (t.match(/([A-ZÄÖÜ][\wäöüß-]*(?:straße|strasse|str\.|platz|ring|allee|weg|brücke|tunnel))/) || [])[1]
    || (t.match(/\b(A\s?\d{1,3})\b/) || [])[1] || '';
  return {
    id: `eigen-${Date.now()}`,
    art: 'eigen',
    titel: [art, ort].filter(Boolean).join(' '),
    kurz: art,
    von,
    bis,
    zeit: von ? `${von}–${bis}` : 'ganztägig',
    wirkung: ort ? `${ort} meiden` : 'Wirkung bei der nächsten Planung prüfen',
    quelle: `Disposition, ${new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}`,
    text: t,
    fahrten: null,
    kachel: {
      name: art,
      gross: von ? `${von.slice(0, 2)}–${bis.slice(0, 2)}` : 'ganztags',
      klein: ort || 'von dir',
    },
  };
};

export default laden;
