// Demo-Vorschau: Einsatz-Kennzahlen (CO2, Kosten) aus dem simulierten Fahrtenbestand.
// Die Fahrten der Demo tragen kaum Routendaten, daher werden Distanz und Dauer aus
// dem Fahrttyp abgeleitet. Alle Annahmen stehen hier explizit, damit die angezeigten
// Zahlen nachvollziehbar bleiben und nicht frei gegriffen wirken.

import jobs from './data/jobs.json';
import jobsArchive from './data/jobs_archive.json';

// Streckenannahmen für den Einsatzraum München (Hin- bzw. Zielfahrt, ohne Rückweg)
const KM_JE_FAHRT = {
  airport: 40, // Innenstadt <-> Flughafen MUC
  normal: 12, // Fahrt innerhalb des Stadtgebiets
  default: 20, // archivierte Fahrten ohne hinterlegten Typ
};

// Fahrzeit in Minuten, analog zum Fahrttyp
const MINUTEN_JE_FAHRT = {
  airport: 55,
  normal: 25,
  default: 40,
};

const LEERFAHRT_FAKTOR = 1.3; // An- und Abfahrten der Fahrzeuge zwischen den Aufträgen
const STANDBY_FAKTOR = 1.5; // Bereitstellungs- und Wartezeit der Fahrer je Auftrag

const CO2_KG_JE_KM = 0.195; // Oberklasse-Benziner (E10), Realverbrauch ca. 8,4 l/100 km
const FAHRERKOSTEN_JE_STUNDE = 28; // Bruttolohn inkl. Lohnnebenkosten
const FAHRZEUGKOSTEN_JE_KM = 0.45; // Leasing, Kraftstoff, Versicherung, Wartung

const alleFahrten = [...jobs, ...jobsArchive];

const summe = alleFahrten.reduce(
  (acc, fahrt) => {
    const typ = fahrt?.trip_type;
    const km = fahrt?.ext_route_distance_m
      ? fahrt.ext_route_distance_m / 1000
      : KM_JE_FAHRT[typ] ?? KM_JE_FAHRT.default;
    const minuten = fahrt?.ext_route_duration_mins
      ?? MINUTEN_JE_FAHRT[typ]
      ?? MINUTEN_JE_FAHRT.default;
    return { km: acc.km + km, minuten: acc.minuten + minuten };
  },
  { km: 0, minuten: 0 },
);

const gesamtKm = summe.km * LEERFAHRT_FAKTOR;
const gesamtStunden = (summe.minuten * STANDBY_FAKTOR) / 60;

const co2Kg = gesamtKm * CO2_KG_JE_KM;
const kostenEuro = gesamtStunden * FAHRERKOSTEN_JE_STUNDE + gesamtKm * FAHRZEUGKOSTEN_JE_KM;

const deDE = (wert, optionen) => new Intl.NumberFormat('de-DE', optionen).format(wert);

export const einsatzKennzahlen = {
  fahrten: alleFahrten.length,
  km: Math.round(gesamtKm),
  co2Kg: Math.round(co2Kg),
  kostenEuro: Math.round(kostenEuro),
  // Anzeigefertig: CO2 ab 1000 kg in Tonnen, Kosten auf 10 EUR gerundet
  co2Anzeige:
    co2Kg >= 1000
      ? `${deDE(co2Kg / 1000, { maximumFractionDigits: 1 })} t`
      : `${deDE(Math.round(co2Kg))} kg`,
  kostenAnzeige: `${deDE(Math.round(kostenEuro / 10) * 10)} €`,
};

export default einsatzKennzahlen;
