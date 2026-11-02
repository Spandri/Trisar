// Gemeinsame Kurvenlogik für Planungsübersicht (Alle Fahrer) und KI Planer,
// damit beide Charts identische Daten zeigen.

export const CHART_START_HOUR = 6;
export const CHART_END_HOUR = 23;
export const CHART_HOURS = Array.from(
  { length: CHART_END_HOUR - CHART_START_HOUR + 1 },
  (_, i) => CHART_START_HOUR + i,
);

// Bedarf an Fahrern: leitet sich ausschließlich aus der Fahrtenlast ab
// (geglättet über die Nachbarstunden, da Fahrten inkl. Puffer in die
// Folgestunde hineinreichen). Bewusst UNABHÄNGIG vom vorhandenen Personal –
// nur so kann eine Schichtvergabe den Bedarf sichtbar decken.
// Arbeitet auf Reihen beliebiger Länge (18h-Fenster ebenso wie 72h-Zeitachse).
export const computeDemandCurve = (supply, booked) => {
  const length = Math.max(
    Array.isArray(supply) ? supply.length : 0,
    Array.isArray(booked) ? booked.length : 0,
    CHART_HOURS.length,
  );
  const hours = Array.from({ length });
  const safeBooked = hours.map((_, i) => Math.max(0, Number(booked?.[i]) || 0));
  return hours.map((_, i) => {
    const prev = safeBooked[i - 1] ?? 0;
    const next = safeBooked[i + 1] ?? 0;
    // Ohne gebuchte Fahrt kein Bedarf: die Glaettung ueber die Nachbarstunden
    // soll keine Fahrer fuer leere Stunden fordern.
    if (safeBooked[i] === 0) return 0;
    return Math.max(safeBooked[i], Math.round((prev + 2 * safeBooked[i] + next) / 4));
  });
};

// Fahrtenstärkster Tag aus einer Fahrtenliste (Demo-Fallback, wenn der
// angezeigte Tag keine Fahrten hat).
export const pickBusiestDayRides = (jobs) => {
  const byDate = new Map();
  (Array.isArray(jobs) ? jobs : []).forEach((job) => {
    const date = String(job?.ride_date || '').trim();
    if (!date) return;
    if (!byDate.has(date)) byDate.set(date, []);
    byDate.get(date).push(job);
  });
  let best = [];
  byDate.forEach((list) => {
    if (list.length > best.length) best = list;
  });
  return best;
};
