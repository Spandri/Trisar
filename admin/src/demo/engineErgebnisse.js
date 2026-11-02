// Vorab gerechnete Ergebnisse der TRISAR-Engine fuer die Demo.
//
// Die Engine (werkzeuge/engine, CP-SAT mit Szenarien) plant jeden Demo-Tag in
// zwei Optionen: Standard (CO2 und Kosten gemeinsam, Verspaetung als Abwaegung,
// Nachsteuern am Einsatztag) und Sicher (jeder Anschluss haelt in 499 von 500
// Verlaeufen). Dazu kommen Rad-/OePNV-Angebote an Standardgaeste und eine
// vorgerechnete Stoerung am Einsatztag (Unfall A9). Die Demo-Daten sind erfunden,
// Verkehrsereignisse sind Planungsannahmen.
// Erzeugt mit werkzeuge/engine/demo_lauf.py, Ergebnis in data/engine-ergebnisse.json.

export const ENGINE_OPTIONEN = ['standard', 'sicher'];

let versprechen = null;
const laden = () => {
  if (!versprechen) {
    versprechen = import('./data/engine-ergebnisse.json')
      .then((modul) => modul?.default || modul)
      .catch(() => null);
  }
  return versprechen;
};

const pad2 = (n) => String(n).padStart(2, '0');
const heuteIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
};

// Demo: Basistag = heute, +1 = Stadttag, +2 = Messetag (demoClient.js verschiebt die Daten).
export const tagIndex = (dayIso) => Math.round(
  (new Date(`${dayIso}T12:00:00`) - new Date(`${heuteIso()}T12:00:00`)) / 86400000,
);

export const istEngineOption = (mode) => ENGINE_OPTIONEN.includes(String(mode || ''));

// Alles zum Tag: Optionen, Angebote, Stoerung. null, wenn nicht gerechnet.
export const engineTag = async (dayIso) => {
  const d = await laden();
  return d?.tage?.[String(tagIndex(dayIso))] || null;
};

// Antwort im Format des Planers fuer Tag und Option. Fahrten, die es in der
// Demo nicht mehr gibt, fallen heraus; neue Fahrten bleiben offen.
export const enginePlanFinden = async ({ serviceDate, mode, rides }) => {
  if (!istEngineOption(mode)) return null;
  const tag = await engineTag(serviceDate);
  const antwort = tag?.optionen?.[mode];
  if (!antwort) return null;
  const vorhanden = new Set((Array.isArray(rides) ? rides : []).map((r) => String(r?.id || '').trim()));
  const kopie = JSON.parse(JSON.stringify(antwort));
  if (vorhanden.size) {
    kopie.suggestions = kopie.suggestions
      .map((s) => ({ ...s, assigned_ride_ids: s.assigned_ride_ids.filter((id) => vorhanden.has(id)) }))
      .map((s) => ({ ...s, assigned_rides_count: s.assigned_ride_ids.length }));
    const geplant = new Set(kopie.suggestions.flatMap((s) => s.assigned_ride_ids));
    kopie.unassigned_ride_ids = [...vorhanden].filter((id) => !geplant.has(id));
    kopie.kpis = { ...kopie.kpis, unassigned_ride_count: kopie.unassigned_ride_ids.length };
  }
  return { antwort: kopie, treffer: 'engine' };
};

export default enginePlanFinden;
