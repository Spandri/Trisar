// TomTom-Anbindung für die Fahrt-Simulation: Adressen zu Koordinaten
// auflösen (Search API), echte Straßenrouten rechnen (Routing API) und ein
// statisches Kartenbild liefern (Map Display API). Alles im Browser mit dem
// öffentlichen Key aus VITE_TOMTOM_API_KEY (developer.tomtom.com, Freemium).
//
// Ohne Key liefern die Funktionen null — die Simulation fällt dann auf die
// schematische Rasterkarte zurück.

const KEY = String(import.meta.env.VITE_TOMTOM_API_KEY || '').trim();

export const hasTomTomKey = () => KEY.length > 0;

// München als Suchanker, damit mehrdeutige Adressen richtig aufgelöst werden.
const MUC = { lat: 48.137, lon: 11.575 };

const geocodeCache = new Map();

// Ortsnamen aus der Disposition sind teils Kuerzel ("MUC Terminal 2") oder
// reine Strassennamen ohne Stadt. TomTom loest solche Texte sonst falsch auf —
// "MUC Terminal 2" landete in der Terminalstrasse bei Burghausen, 95 km weg.
const normalizeQuery = (text) => {
  let q = String(text || '').trim();
  q = q.replace(/\bMUC\b\s*/i, 'Flughafen München ');
  q = q.replace(/\bFJS\b\s*/i, 'Flughafen München ');
  if (/^\s*terminal\s*\d/i.test(q)) q = `Flughafen München ${q}`;
  if (/\bhbf\b/i.test(q)) q = q.replace(/\bhbf\b/i, 'Hauptbahnhof');
  // Ohne Stadtangabe: München ergaenzen, damit Strassennamen eindeutig sind.
  if (!/münchen|muenchen|flughafen|airport|starnberg|garching|grünwald|gruenwald|dachau|freising|erding|ismaning|unterföhring|oberding/i.test(q)) {
    q = `${q}, München`;
  }
  return q.replace(/\s+/g, ' ').trim();
};

// Plausibilitaetsgrenze: der Fuhrpark bedient den Grossraum Muenchen. Treffer
// weiter draussen sind fast immer Fehlauflösungen gleichlautender Strassen.
const MAX_DISTANCE_KM = 120;
const distanceKm = (a, b) => {
  const dLat = (b.lat - a.lat) * 111.32;
  const dLon = (b.lon - a.lon) * 111.32 * Math.cos(((a.lat + b.lat) / 2) * Math.PI / 180);
  return Math.hypot(dLat, dLon);
};

const fetchPosition = async (endpoint, q) => {
  const url = `https://api.tomtom.com/search/2/${endpoint}/${encodeURIComponent(q)}.json`
    + `?key=${KEY}&limit=1&lat=${MUC.lat}&lon=${MUC.lon}&countrySet=DE&language=de-DE`;
  let res = await fetch(url);
  if (res.status === 429) {
    // Freemium-Ratelimit: einmal kurz warten und erneut versuchen.
    await new Promise((r) => setTimeout(r, 450));
    res = await fetch(url);
  }
  if (!res.ok) return null;
  const data = await res.json();
  const pos = data?.results?.[0]?.position;
  return pos && Number.isFinite(pos.lat) && Number.isFinite(pos.lon)
    ? { lat: pos.lat, lon: pos.lon }
    : null;
};

// Kaskade: 1. Adress-Geocoding des vollen Texts, 2. nur der Adressteil nach
// dem letzten Komma ("Hotel X, Maximilianstrasse 17" -> "Maximilianstrasse 17
// München"), 3. Fuzzy-POI-Suche (findet z.B. "Löwenbräukeller" ohne Adresse).
export async function geocodeAddress(query) {
  const roh = String(query || '').trim();
  if (!KEY || !roh) return null;
  if (geocodeCache.has(roh)) return geocodeCache.get(roh);
  const q = normalizeQuery(roh);
  const plausibel = (p) => p && distanceKm(MUC, p) <= MAX_DISTANCE_KM;

  let value = null;
  try {
    // Reihenfolge: normalisierte Adresse, dann Fuzzy-Suche (findet POIs wie
    // "Löwenbräukeller"), dann der reine Adressteil hinter dem Komma.
    const versuche = [
      () => fetchPosition('geocode', q),
      () => fetchPosition('search', q),
      () => fetchPosition('search', roh),
    ];
    if (roh.includes(',')) {
      const adressteil = roh.slice(roh.lastIndexOf(',') + 1).trim();
      if (adressteil.length > 3) versuche.push(() => fetchPosition('geocode', normalizeQuery(adressteil)));
    }
    for (const versuch of versuche) {
      // eslint-disable-next-line no-await-in-loop
      const treffer = await versuch();
      if (plausibel(treffer)) { value = treffer; break; }
      if (treffer && !value) value = null; // unplausibler Treffer wird verworfen
    }
  } catch {
    value = null;
  }
  geocodeCache.set(roh, value);
  return value;
}

// Eine Route über alle Wegpunkte; die Antwort enthält je Abschnitt (leg)
// die echte Straßen-Polylinie. legs[i] verbindet points[i] mit points[i+1].
export async function routeThrough(points) {
  if (!KEY || !Array.isArray(points) || points.length < 2) return null;
  try {
    const locations = points.map((p) => `${p.lat},${p.lon}`).join(':');
    const url = `https://api.tomtom.com/routing/1/calculateRoute/${locations}/json`
      + `?key=${KEY}&traffic=false&travelMode=car&routeRepresentation=polyline`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`route ${res.status}`);
    const data = await res.json();
    const legs = data?.routes?.[0]?.legs;
    if (!Array.isArray(legs) || legs.length === 0) return null;
    // Neben der Geometrie auch die ECHTE Fahrzeit je Abschnitt zurueckgeben —
    // die Simulation braucht sie, um Fahrten und Leerfahrten zeitlich richtig
    // hintereinander zu legen.
    return legs.map((leg) => ({
      pts: (leg.points || []).map((pt) => ({ lat: pt.latitude, lon: pt.longitude })),
      minutes: Math.max(1, Math.round(Number(leg?.summary?.travelTimeInSeconds || 0) / 60)),
      // Echte Streckenlaenge — Grundlage fuer den Ladestand je Fahrt.
      km: Number(leg?.summary?.lengthInMeters || 0) / 1000,
    }));
  } catch {
    return null;
  }
}

// --- Web-Mercator: deterministische Projektion auf das statische Kartenbild.
export const TILE_SIZE = 512;
const mercX = (lon) => (lon + 180) / 360;
const mercY = (lat) => {
  const r = (lat * Math.PI) / 180;
  return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2;
};

// Kartenausschnitt (center + zoom) so wählen, dass alle Punkte mit Rand ins
// Bild passen; Rückgabe enthält eine project(lat, lon) -> {x, y} in Pixeln.
export function fitStaticMap(points, widthPx, heightPx, paddingPx = 44, zoomDelta = 0, centerOverride = null) {
  const xs = points.map((p) => mercX(p.lon));
  const ys = points.map((p) => mercY(p.lat));
  const minX = Math.min(...xs); const maxX = Math.max(...xs);
  const minY = Math.min(...ys); const maxY = Math.max(...ys);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;

  const spanX = Math.max(maxX - minX, 1e-6);
  const spanY = Math.max(maxY - minY, 1e-6);
  const usableW = widthPx - 2 * paddingPx;
  const usableH = heightPx - 2 * paddingPx;
  // Die Static Image API rendert mit 512-px-Kacheln, die Weltbreite bei Zoom z
  // ist also 512 * 2^z. Mit der ueblichen 256er-Annahme lag die Projektion um
  // Faktor 2 daneben und die Route passte nicht zur Karte (empirisch gemessen:
  // zwei um 256 px versetzte Bilder decken sich nur bei TILE = 512 exakt).
  const TILE = 512;
  const zRaw = Math.min(
    Math.log2(usableW / (spanX * TILE)),
    Math.log2(usableH / (spanY * TILE)),
  );
  // Die Static Image API akzeptiert nur GANZZAHLIGE Zoomstufen (Dezimalzoom
  // liefert HTTP 400) — floor sorgt dafuer, dass alles sicher ins Bild passt.
  // zoomDelta erlaubt Hinein-/Herauszoomen relativ zur eingepassten Stufe.
  const zoom = Math.max(3, Math.min(18, Math.floor(zRaw) + Math.round(zoomDelta)));
  const world = TILE * (2 ** zoom);

  // Beim Zoomen kann ein anderer Mittelpunkt gesetzt werden (Mercator-Anteile).
  const ccx = centerOverride ? centerOverride.x : cx;
  const ccy = centerOverride ? centerOverride.y : cy;

  const centerLon = ccx * 360 - 180;
  const centerLat = (Math.atan(Math.sinh(Math.PI * (1 - 2 * ccy))) * 180) / Math.PI;

  const project = (lat, lon) => ({
    x: (mercX(lon) - ccx) * world + widthPx / 2,
    y: (mercY(lat) - ccy) * world + heightPx / 2,
  });

  const imageUrl = `https://api.tomtom.com/map/1/staticimage?key=${KEY}`
    + `&zoom=${zoom}&center=${centerLon.toFixed(6)},${centerLat.toFixed(6)}`
    + `&width=${widthPx}&height=${heightPx}&format=png&layer=basic&style=main&view=Unified&language=de-DE`;

  // Mercator-Mittelpunkt mitgeben, damit der Aufrufer beim Zoomen zentrieren kann.
  return { imageUrl, project, zoom, center: { x: ccx, y: ccy }, fittedCenter: { x: cx, y: cy } };
}
