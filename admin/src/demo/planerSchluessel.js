// Fingerabdruck einer Planer-Anfrage.
//
// Gemeinsam genutzt von der Demo (Suche nach dem vorab gerechneten Ergebnis)
// und vom Skript, das die echten CP-SAT-Ergebnisse einbaut. Erfasst genau die
// Felder, die der Planer (admin-app-lokal/optimizer) auswertet — gleicher
// Fingerabdruck heisst: der Planer bekommt dieselbe Aufgabe.
//
// Fahrt-IDs zaehlen bewusst nicht: Fahrten, die erst in der Demo entstehen
// (z. B. im Tutorial), haben bei jedem Besuch eine neue zufaellige ID. Sie
// werden ueber ihren Inhalt wiedererkannt (fahrtMerkmalHash).
// Keine Imports — das Einbau-Skript laedt diese Datei direkt in Node.

// cyrb53: schneller 53-Bit-Hash, reicht zum Wiedererkennen voellig.
export const hash53 = (text) => {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  const str = String(text);
  for (let i = 0; i < str.length; i += 1) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
};

const wert = (w) => {
  if (w === undefined || w === null || w === '') return null;
  if (typeof w === 'number') return Number.isFinite(w) ? Number(w.toFixed(3)) : null;
  if (typeof w === 'boolean') return w;
  return String(w).trim();
};

const EINSTELLUNGS_FELDER = ['mode', 'maxWorkHours', 'minWorkHours', 'minPauseHours', 'bufferMinutes', 'rideDurationMinutes', 'qualityGapPercent', 'splitShifts'];

export const einstellungsSchluessel = (settings = {}) => JSON.stringify(
  EINSTELLUNGS_FELDER.map((feld) => wert(settings?.[feld])),
);

export const fahrerKennung = (fahrer) => String(fahrer?.driver_id || fahrer?.id || '').trim();

// Alles, was der Planer von einem Fahrer liest — ausser ID und Ruhezeitfenster.
const fahrerProfil = (f) => [
  wert(f?.availability_max_hours),
  wert(f?.service_start_time || f?.serviceStartTime),
  wert(f?.service_end_time || f?.serviceEndTime),
  wert(f?.is_vip_qualified),
  wert(f?.historical_worked_hours),
  wert(f?.legal_max_hours),
  wert(f?.min_shift_hours),
  wert(f?.start_zone),
  wert(f?.end_zone),
  wert(f?.is_ev),
  wert(f?.ev_range_km),
];

export const fahrerProfilHash = (fahrer) => hash53(JSON.stringify(fahrerProfil(fahrer)));

export const fahrerFenster = (f) => ({
  frueh: f?.earliest_start_minute ?? f?.rest_until ?? null,
  spaet: f?.latest_end_minute ?? f?.must_end_by ?? null,
});

// Alles, was der Planer von einer Fahrt liest — ausser der ID und dem Datum
// (die Demo verschiebt ihre Daten taeglich; geplant werden ohnehin nur
// Fahrten des Planungstags, der Abstand steckt in "tag").
const fahrtMerkmal = (r) => JSON.stringify([
  wert(r?.status),
  wert(r?.etd || r?.start_time),
  wert(r?.pickup_address || r?.start_address),
  wert(r?.dropoff_address || r?.end_address),
  wert(r?.duration_minutes),
  wert(r?.ext_route_duration_in_traffic_mins),
  wert(r?.ext_route_duration_mins),
  wert(r?.is_vip_ride),
  wert(r?.pickup_name),
  wert(r?.dropoff_name),
  wert(r?.start_poi_type),
]);

export const fahrtMerkmalHash = (fahrt) => hash53(fahrtMerkmal(fahrt));

const fahrzeugMerkmal = (v) => [
  String(v?.id || v?.vehicle_id || '').trim(),
  wert(v?.brand_model),
  wert(v?.trim),
  wert(v?.license_plate),
  wert(v?.fuel_type),
  wert(v?.range_km),
  wert(v?.ev_range_km),
  wert(v?.battery_fuel_percent),
];

const liste = (x) => (Array.isArray(x) ? x : []);

// tag: Abstand des Planungstags zu "heute" in Tagen (die Demo verschiebt ihre
// Daten taeglich, der Abstand bleibt gleich).
export const anfrageSchluessel = ({ tag, settings, drivers, rides, vehicles }) => ({
  tag,
  einstellungen: einstellungsSchluessel(settings),
  fahrer: hash53(JSON.stringify(liste(drivers).map((f) => [fahrerKennung(f), ...fahrerProfil(f)]))),
  ruhe: hash53(JSON.stringify(
    liste(drivers)
      .map((f) => [fahrerKennung(f), fahrerFenster(f).frueh, fahrerFenster(f).spaet])
      .filter(([, frueh, spaet]) => frueh != null || spaet != null)
      .sort((a, b) => a[0].localeCompare(b[0])),
  )),
  fahrten: hash53(JSON.stringify(liste(rides).map(fahrtMerkmal).sort())),
  fahrzeuge: hash53(JSON.stringify(liste(vehicles).map(fahrzeugMerkmal))),
});

export const OHNE_RUHEZEITEN = hash53('[]');

export const isoTag = (datum = new Date()) => `${datum.getFullYear()}-${String(datum.getMonth() + 1).padStart(2, '0')}-${String(datum.getDate()).padStart(2, '0')}`;

export const tagAbstand = (serviceDate, heuteIso) => Math.round(
  (new Date(`${serviceDate}T12:00:00`) - new Date(`${heuteIso}T12:00:00`)) / 86400000,
);
