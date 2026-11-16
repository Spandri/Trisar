// Routenpunkte einer Fahrt (jobs.routen_punkte, 15.11.): die Dispo legt die Route ueber Punkte fest.
// Ein Punkt ist {lat, lng, nach}. nach = Abschnitt: 0 = Start bis erster Zwischenstopp (ohne Stopps: Ziel),
// k = nach Zwischenstopp k. Die Liste steht in Fahrtreihenfolge.
// Google Maps nimmt 9 Zwischenziele, Abholung und Stopps zaehlen mit.
import { DEMO_MODE, supabase } from '../services/supabase';

export const GOOGLE_ZWISCHENZIELE = 9;

export const maxRoutenPunkte = (anzahlStopps = 0) => Math.max(0, GOOGLE_ZWISCHENZIELE - 1 - anzahlStopps);

export const routenPunkteLesen = (wert) => (
  Array.isArray(wert)
    ? wert
      .map((p) => ({ lat: Number(p?.lat), lng: Number(p?.lng ?? p?.lon), nach: Math.max(0, Math.floor(Number(p?.nach) || 0)) }))
      .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng))
    : []
);

// Kennung der Adressen, zu denen die Punkte gesetzt wurden. Aendert sie sich, passen die Punkte nicht mehr.
export const routenBasis = (start, stopps = [], ziel) => [start, ...stopps, ziel].map((t) => String(t || '').trim().toLowerCase()).join('|');

const meter = (a, b) => {
  const dLat = (b.lat - a.lat) * 111320;
  const dLng = (b.lng - a.lng) * 111320 * Math.cos(((a.lat + b.lat) / 2) * Math.PI / 180);
  return Math.hypot(dLat, dLng);
};

// Alle Wegpunkte in Fahrtreihenfolge: Start, Punkte(0), Stopp 1, Punkte(1), ..., Ziel.
// orte = [Start, ...Stopps, Ziel] als {lat, lng} (null erlaubt).
export const wegpunkteFolge = (orte, punkte) => {
  const stopps = orte.slice(1, -1);
  const folge = [{ art: 'start', ort: orte[0] }];
  for (let abschnitt = 0; abschnitt <= stopps.length; abschnitt += 1) {
    punkte.forEach((p, index) => { if (Math.min(p.nach, stopps.length) === abschnitt) folge.push({ art: 'punkt', ort: p, index, nach: abschnitt }); });
    if (abschnitt < stopps.length) folge.push({ art: 'stopp', ort: stopps[abschnitt], nach: abschnitt + 1 });
  }
  folge.push({ art: 'ziel', ort: orte[orte.length - 1] });
  return folge;
};

// Neuer Punkt x: dort einfuegen, wo er den kleinsten Umweg macht (Luftlinie).
export const punktEinfuegen = (orte, punkte, x) => {
  const folge = wegpunkteFolge(orte, punkte).filter((w) => w.ort && Number.isFinite(w.ort.lat));
  let bester = null;
  for (let i = 0; i < folge.length - 1; i += 1) {
    const p = folge[i];
    const q = folge[i + 1];
    const kosten = meter(p.ort, x) + meter(x, q.ort) - meter(p.ort, q.ort);
    if (!bester || kosten < bester.kosten) bester = { kosten, i };
  }
  if (!bester) return [...punkte, { ...x, nach: 0 }];
  const davor = folge[bester.i];
  // Abschnitt: nach einem Stopp k ist es k, nach Start 0, nach einem Punkt dessen Abschnitt.
  const nach = davor.art === 'start' ? 0 : davor.nach;
  const neu = { lat: x.lat, lng: x.lng, nach };
  // In der Liste direkt hinter dem Vorgaenger-Punkt bzw. vor dem ersten Punkt des Abschnitts.
  const liste = [...punkte];
  if (davor.art === 'punkt') liste.splice(davor.index + 1, 0, neu);
  else {
    const erster = liste.findIndex((p) => p.nach >= nach);
    liste.splice(erster === -1 ? liste.length : erster, 0, neu);
  }
  return liste;
};

// Vorschau vom Server (places-proxy route_vorschau). Fehler -> null.
export async function routeVorschau(adressen, punkte = []) {
  if (DEMO_MODE) return null;
  try {
    const { data } = await supabase.functions.invoke('places-proxy', {
      body: { aktion: 'route_vorschau', adressen, punkte },
    });
    return data?.ok ? data : null;
  } catch {
    return null;
  }
}

export const dekodierePolyline = (encoded) => {
  if (!encoded || typeof encoded !== 'string') return [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  const punkte = [];
  const wert = () => {
    let b = 0;
    let shift = 0;
    let result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    return (result & 1) ? ~(result >> 1) : (result >> 1);
  };
  while (index < encoded.length) {
    lat += wert();
    lng += wert();
    punkte.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }
  return punkte;
};
