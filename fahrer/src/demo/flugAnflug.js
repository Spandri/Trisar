import { useEffect, useMemo, useState } from 'react';

// Demo: Live-Position des Fluges auf der Karte der Flughafenfahrt.
//
// Im Betrieb kommen Position, Richtung und Spur des Flugzeugs aus dem
// Flug-Tracking (ext_flight_payload.live_tracking). Die Demo hat keine echten
// Flugdaten — hier wird der Flug deshalb nach der Uhr nachgerechnet, so wie
// ein Tracking ihn zeigen wuerde:
//
//   - Landung (Aufsetzen auf der Nordbahn 26R) = ETD der Fahrt
//   - rueckwaerts gerechnet: Endanflug, Gegenanflug, Sinkflug, Reiseflug auf dem
//     Grosskreis, Steigflug und Start am Abflughafen; nach der Landung Ausrollen
//     und Rollen zum Gate an Terminal 2
//   - vor dem Start gibt es noch keine Position, nach dem Andocken steht das
//     Flugzeug noch eine Viertelstunde am Gate
//   - die Spur beginnt am Abflughafen und reicht bis zur aktuellen Position
//
// Echtzeit, kein Zeitraffer. Nichts davon ist echt, aber jede Position ist
// plausibel fuer genau diesen Moment.

const MUC = { lat: 48.3538, lng: 11.7861 };
const M_JE_GRAD_LAT = 110574;
const M_JE_GRAD_LNG = 111320 * Math.cos((MUC.lat * Math.PI) / 180);
const ERDRADIUS_M = 6371000;

const TAKT_MS = 1000;
const AM_GATE_NACH_ANKUNFT_MIN = 15;
// Die Karte zeichnet hoechstens 90 Spurpunkte (normalizeFlightTrailPath).
const MAX_SPURPUNKTE = 88;

// Abflughaefen (Lat, Lng).
const FLUGHAEFEN = {
  BER: [52.366, 13.503], TXL: [52.560, 13.288], HAM: [53.630, 9.988], DUS: [51.289, 6.767],
  FRA: [50.037, 8.562], CGN: [50.866, 7.143], STR: [48.690, 9.222], HAJ: [52.461, 9.685],
  BRE: [53.047, 8.787], LEJ: [51.424, 12.236], DRS: [51.134, 13.767], NUE: [49.499, 11.078],
  LHR: [51.470, -0.454], LGW: [51.153, -0.182], CDG: [49.009, 2.548], ORY: [48.723, 2.379],
  AMS: [52.310, 4.768], BRU: [50.901, 4.484], ZRH: [47.458, 8.555], GVA: [46.238, 6.109],
  VIE: [48.110, 16.570], FCO: [41.800, 12.239], MXP: [45.630, 8.723], MAD: [40.498, -3.567],
  BCN: [41.297, 2.078], LIS: [38.774, -9.134], ATH: [37.936, 23.947], IST: [41.262, 28.742],
  ARN: [59.652, 17.919], CPH: [55.618, 12.656], OSL: [60.194, 11.100], HEL: [60.317, 24.963],
  WAW: [52.166, 20.967], PRG: [50.101, 14.260], BUD: [47.439, 19.262], DXB: [25.253, 55.365],
  DOH: [25.273, 51.608], JFK: [40.641, -73.778], EWR: [40.690, -74.174], ORD: [41.978, -87.905],
  HND: [35.549, 139.780], NRT: [35.772, 140.393], SIN: [1.364, 103.991], PEK: [40.080, 116.585],
};

const STAEDTE = {
  berlin: 'BER', hamburg: 'HAM', 'düsseldorf': 'DUS', dusseldorf: 'DUS', frankfurt: 'FRA',
  'köln': 'CGN', koeln: 'CGN', cologne: 'CGN', stuttgart: 'STR', hannover: 'HAJ', london: 'LHR',
  paris: 'CDG', amsterdam: 'AMS', 'zürich': 'ZRH', zurich: 'ZRH', wien: 'VIE', vienna: 'VIE',
  rom: 'FCO', rome: 'FCO', madrid: 'MAD', barcelona: 'BCN', stockholm: 'ARN', tokyo: 'HND',
  dubai: 'DXB', 'new york': 'JFK', istanbul: 'IST', kopenhagen: 'CPH', copenhagen: 'CPH',
};

const FLUGHAFEN_TEXT = /flughafen|airport|terminal|\bmuc\b/i;

const RAD = Math.PI / 180;

const abflughafen = (herkunft) => {
  const text = String(herkunft || '').trim();
  const code = text.match(/\(([A-Z]{3})\)/)?.[1] || (/^[A-Z]{3}$/.test(text) ? text : null);
  if (code && FLUGHAEFEN[code]) return FLUGHAEFEN[code];
  const klein = text.toLowerCase();
  const stadt = Object.keys(STAEDTE).find((name) => klein.includes(name));
  if (stadt) return FLUGHAEFEN[STAEDTE[stadt]];
  return FLUGHAEFEN.FRA; // ohne Angabe: ein Inlandsflug
};

// --- Geometrie ---------------------------------------------------------------

const lokalZuPunkt = ({ x, y }) => ({ lat: MUC.lat + y / M_JE_GRAD_LAT, lng: MUC.lng + x / M_JE_GRAD_LNG });

const abstandM = (a, b) => {
  const dLat = (b.lat - a.lat) * RAD;
  const dLng = (b.lng - a.lng) * RAD;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLng / 2) ** 2;
  return 2 * ERDRADIUS_M * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
};

const kurs = (a, b) => {
  const y = Math.sin((b.lng - a.lng) * RAD) * Math.cos(b.lat * RAD);
  const x = Math.cos(a.lat * RAD) * Math.sin(b.lat * RAD) - Math.sin(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.cos((b.lng - a.lng) * RAD);
  return ((Math.atan2(y, x) / RAD) + 360) % 360;
};

// Punkt auf dem Grosskreis zwischen a und b (anteil 0..1).
const grosskreis = (a, b, anteil) => {
  const d = abstandM(a, b) / ERDRADIUS_M;
  if (d < 1e-9) return { lat: a.lat, lng: a.lng };
  const A = Math.sin((1 - anteil) * d) / Math.sin(d);
  const B = Math.sin(anteil * d) / Math.sin(d);
  const x = A * Math.cos(a.lat * RAD) * Math.cos(a.lng * RAD) + B * Math.cos(b.lat * RAD) * Math.cos(b.lng * RAD);
  const y = A * Math.cos(a.lat * RAD) * Math.sin(a.lng * RAD) + B * Math.cos(b.lat * RAD) * Math.sin(b.lng * RAD);
  const z = A * Math.sin(a.lat * RAD) + B * Math.sin(b.lat * RAD);
  return { lat: Math.atan2(z, Math.sqrt(x * x + y * y)) / RAD, lng: Math.atan2(y, x) / RAD };
};

// Nordbahn 08L/26R: Kurs 082/262, 4 km lang. Ortsfeste Meter um den Flughafen.
// quer > 0 liegt rechts der Achse in Richtung 082, also suedlich.
const BAHN_RICHTUNG = { x: Math.sin(82 * RAD), y: Math.cos(82 * RAD) };
const BAHN_MITTE = { x: 0, y: 1150 };
const aufBahnlinie = (abstandVonMitte, quer = 0) => ({
  x: BAHN_MITTE.x + BAHN_RICHTUNG.x * abstandVonMitte + BAHN_RICHTUNG.y * quer,
  y: BAHN_MITTE.y + BAHN_RICHTUNG.y * abstandVonMitte - BAHN_RICHTUNG.x * quer,
});

// Zentripetaler Catmull-Rom (alpha 0,5): weiche Kurven ohne Ueberschwingen.
const kurvenStueck = (p0, p1, p2, p3, schritte) => {
  const knoten = (a, b) => Math.max(1e-6, Math.hypot(b.x - a.x, b.y - a.y) ** 0.5);
  const t1 = knoten(p0, p1);
  const t2 = t1 + knoten(p1, p2);
  const t3 = t2 + knoten(p2, p3);
  const mische = (a, b, ta, tb, t) => ({
    x: ((tb - t) * a.x + (t - ta) * b.x) / (tb - ta),
    y: ((tb - t) * a.y + (t - ta) * b.y) / (tb - ta),
  });
  const punkte = [];
  for (let s = 0; s < schritte; s += 1) {
    const t = t1 + (t2 - t1) * (s / schritte);
    const a1 = mische(p0, p1, 0, t1, t);
    const a2 = mische(p1, p2, t1, t2, t);
    const a3 = mische(p2, p3, t2, t3, t);
    const b1 = mische(a1, a2, 0, t2, t);
    const b2 = mische(a2, a3, t1, t3, t);
    punkte.push(mische(b1, b2, t1, t2, t));
  }
  return punkte;
};

// --- Flugweg -----------------------------------------------------------------

// Geschwindigkeiten ueber Grund in m/s.
const V_ABHEBEN = 80;
const V_REISE = 225;          // ca. 810 km/h
const STEIGSTRECKE_M = 140000;
const SINKSTRECKE_M = 160000;
const EINFLUG_M = 55000;      // Beginn des Anflugverfahrens vor München

const flugwegBauen = (herkunft) => {
  const [hLat, hLng] = abflughafen(herkunft);
  const start = { lat: hLat, lng: hLng };
  const kursZumStart = kurs(MUC, start);

  // Anflugverfahren in ortsfesten Metern: vom Einflugpunkt (Richtung
  // Abflughafen) in den Gegenanflug auf dessen Seite der Bahn, Eindrehen in den
  // Endanflug, dann gerade auf der verlaengerten Bahnachse bis zum Gate.
  const einflug = { x: Math.sin(kursZumStart * RAD) * EINFLUG_M, y: Math.cos(kursZumStart * RAD) * EINFLUG_M };
  const achseY = BAHN_MITTE.y + (einflug.x - BAHN_MITTE.x) * (BAHN_RICHTUNG.y / BAHN_RICHTUNG.x);
  const quer = einflug.y >= achseY ? -1 : 1; // -1 = noerdlich der Bahnachse
  const anflug = [
    { ...einflug, v: 165 },
    { ...aufBahnlinie(34000, quer * 9000), v: 125 },
    { ...aufBahnlinie(24000, quer * 1200), v: 100 },
    { ...aufBahnlinie(16000), v: 82, gerade: true },
    { ...aufBahnlinie(2000), v: 72, gerade: true },    // Schwelle 26R
    { ...aufBahnlinie(1650), v: 69, gerade: true, aufsetzen: true },
    { ...aufBahnlinie(-350), v: 14, gerade: true },    // ausgerollt
    { ...aufBahnlinie(-550, 450), v: 9 },              // abrollen nach Sueden
    { x: -250, y: 450, v: 8 },
    { x: 650, y: 160, v: 5 },
    { x: 900, y: 40, v: 0.8 },                         // Gate Terminal 2
  ];

  // Vor dem Einflugpunkt ein Hilfspunkt auf der Linie zum Abflughafen: so geht
  // der Reiseflug ohne Knick in die erste Kurve ueber.
  const davor = { x: einflug.x * 1.4, y: einflug.y * 1.4 };
  const anflugDicht = [];
  for (let i = 0; i < anflug.length - 1; i += 1) {
    const p1 = anflug[i];
    const p2 = anflug[i + 1];
    const laenge = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    const schritte = Math.max(4, Math.min(60, Math.round(laenge / 250)));
    const stueck = p1.gerade && p2.gerade
      ? Array.from({ length: schritte }, (_, s) => ({ x: p1.x + (p2.x - p1.x) * (s / schritte), y: p1.y + (p2.y - p1.y) * (s / schritte) }))
      : kurvenStueck(i === 0 ? davor : anflug[i - 1], p1, p2, anflug[Math.min(anflug.length - 1, i + 2)], schritte);
    stueck.forEach((p, s) => anflugDicht.push({
      ...lokalZuPunkt(p),
      v: p1.v + (p2.v - p1.v) * (s / schritte),
      anflug: true,
      aufsetzen: s === 0 && p1.aufsetzen,
    }));
  }
  const ende = anflug[anflug.length - 1];
  anflugDicht.push({ ...lokalZuPunkt(ende), v: ende.v, anflug: true });

  // Vom Abflughafen zum Einflugpunkt auf dem Grosskreis, mit Steig- und Sinkflug.
  const einflugPunkt = anflugDicht[0];
  const reiseLaenge = abstandM(start, einflugPunkt);
  const reiseSchritte = Math.max(8, Math.min(400, Math.round(reiseLaenge / 5000)));
  const reise = [];
  for (let s = 0; s < reiseSchritte; s += 1) {
    const anteil = s / reiseSchritte;
    const gelegen = reiseLaenge * anteil;
    const steigen = V_ABHEBEN + (V_REISE - V_ABHEBEN) * Math.min(1, gelegen / STEIGSTRECKE_M) ** 0.6;
    const sinken = anflug[0].v + (V_REISE - anflug[0].v) * Math.min(1, (reiseLaenge - gelegen) / SINKSTRECKE_M);
    reise.push({ ...grosskreis(start, einflugPunkt, anteil), v: Math.min(steigen, sinken) });
  }

  // Strecke und Zeit ab dem Abheben.
  const punkte = [...reise, ...anflugDicht];
  let strecke = 0;
  let zeit = 0;
  const weg = punkte.map((p, i) => {
    if (i > 0) {
      const vorher = punkte[i - 1];
      const ds = abstandM(vorher, p);
      strecke += ds;
      zeit += ds / Math.max(3, (p.v + vorher.v) / 2);
    }
    return { ...p, strecke, zeit };
  });

  // Spur: auf dem Reiseweg gleichmaessig ausgeduennt, im Anflug dichter.
  const reiseAbstand = Math.max(15000, reiseLaenge / 40);
  let letzte = -Infinity;
  weg.forEach((p) => {
    const abstand = p.anflug ? 1200 : reiseAbstand;
    if (p.strecke - letzte >= abstand) {
      p.spur = true;
      letzte = p.strecke;
    }
  });

  // Flugzeit bis zum Aufsetzen — daran haengt die Uhr (Landung = ETD).
  const landung = weg.find((p) => p.aufsetzen).zeit;
  return { weg, dauer: zeit, landung };
};

const stelleBei = (weg, zeit) => {
  let lo = 0;
  let hi = weg.length - 1;
  if (zeit >= weg[hi].zeit) return { index: hi, anteil: 0 };
  while (hi - lo > 1) {
    const mitte = (lo + hi) >> 1;
    if (weg[mitte].zeit <= zeit) lo = mitte; else hi = mitte;
  }
  const a = weg[lo];
  const b = weg[hi];
  return { index: lo, anteil: b.zeit > a.zeit ? (zeit - a.zeit) / (b.zeit - a.zeit) : 0 };
};

const punktBeiStrecke = (weg, strecke) => {
  let lo = 0;
  let hi = weg.length - 1;
  if (strecke <= 0) return weg[0];
  if (strecke >= weg[hi].strecke) return weg[hi];
  while (hi - lo > 1) {
    const mitte = (lo + hi) >> 1;
    if (weg[mitte].strecke <= strecke) lo = mitte; else hi = mitte;
  }
  const a = weg[lo];
  const b = weg[hi];
  const anteil = b.strecke > a.strecke ? (strecke - a.strecke) / (b.strecke - a.strecke) : 0;
  return { lat: a.lat + (b.lat - a.lat) * anteil, lng: a.lng + (b.lng - a.lng) * anteil };
};

const zustandBei = (flugweg, sekundenSeitAbheben) => {
  const { weg } = flugweg;
  const { index, anteil } = stelleBei(weg, sekundenSeitAbheben);
  const a = weg[index];
  const b = weg[Math.min(weg.length - 1, index + 1)];
  const hier = { lat: a.lat + (b.lat - a.lat) * anteil, lng: a.lng + (b.lng - a.lng) * anteil };
  // Richtung ueber ein Wegstueck vor und hinter dem Flugzeug — je schneller,
  // desto laenger. So dreht die Nase in Kurven und beim Abrollen weich mit,
  // statt an jedem Wegpunkt zu springen.
  const strecke = a.strecke + (b.strecke - a.strecke) * anteil;
  const v = a.v + (b.v - a.v) * anteil;
  const halb = Math.min(1500, Math.max(40, v * 4));
  const gesamt = weg[weg.length - 1].strecke;
  const von = punktBeiStrecke(weg, Math.max(0, Math.min(strecke - halb, gesamt - 2 * halb)));
  const nach = punktBeiStrecke(weg, Math.min(gesamt, Math.max(strecke + halb, 2 * halb)));
  const richtung = kurs(von, nach);

  let spur = weg.slice(0, index + 1).filter((p, i) => i === 0 || p.spur);
  if (spur.length > MAX_SPURPUNKTE - 1) {
    const schritt = (spur.length - 1) / (MAX_SPURPUNKTE - 2);
    spur = Array.from({ length: MAX_SPURPUNKTE - 1 }, (_, i) => spur[Math.round(i * schritt)]);
  }
  const trail = [...spur.map((p) => ({ lat: p.lat, lng: p.lng })), hier];
  return { coords: { ...hier, headingDeg: richtung }, trail };
};

// Landezeit aus Datum und ETD der Fahrt (Ortszeit).
const landungMs = (job) => {
  const datum = String(job?.rideDate || '').slice(0, 10);
  const zeit = String(job?.etd || '').match(/^(\d{1,2}):(\d{2})/);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datum) || !zeit) return null;
  const [j, m, t] = datum.split('-').map(Number);
  const wert = new Date(j, m - 1, t, Number(zeit[1]), Number(zeit[2]), 0, 0).getTime();
  return Number.isNaN(wert) ? null : wert;
};

const ankommenderFlug = (job) => {
  if (!job) return false;
  if (String(job?.trainNumber || '').trim()) return false;
  const flug = String(job?.flight || job?.flightNumber || job?.extFlightNumber || '').trim();
  if (!flug || flug === 'STADTFAHRT') return false;
  const abholort = `${job?.from?.address || ''} ${job?.from?.name || ''}`;
  return FLUGHAFEN_TEXT.test(abholort);
};

// Liefert { coords, trail } fuer die Karte oder null, solange der Flug weder in
// der Luft noch am Gate ist. aktiv = false, sobald echte Live-Daten vorliegen.
export const useDemoAnflug = (job, aktiv = true) => {
  const zeigen = aktiv && ankommenderFlug(job);
  const herkunft = job?.flightOrigin || '';
  const landung = zeigen ? landungMs(job) : null;
  const flugweg = useMemo(() => (landung ? flugwegBauen(herkunft) : null), [landung, herkunft]);
  const [jetzt, setJetzt] = useState(() => Date.now());

  useEffect(() => {
    if (!flugweg) return undefined;
    const id = window.setInterval(() => setJetzt(Date.now()), TAKT_MS);
    return () => window.clearInterval(id);
  }, [flugweg]);

  return useMemo(() => {
    if (!flugweg || !landung) return null;
    const abheben = landung - flugweg.landung * 1000;
    const amGate = abheben + flugweg.dauer * 1000;
    if (jetzt < abheben) return null;
    if (jetzt > amGate + AM_GATE_NACH_ANKUNFT_MIN * 60000) return null;
    return zustandBei(flugweg, (jetzt - abheben) / 1000);
  }, [flugweg, landung, jetzt]);
};

// Fuer Pruefungen ausserhalb von React.
export const _demoFlugweg = { flugwegBauen, zustandBei };
