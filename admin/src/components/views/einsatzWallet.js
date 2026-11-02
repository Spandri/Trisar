// Kennzahlen der Wallet-Karten in der Einsatzplanung.
// Eine Tageskarte fasst die Vorschlaege eines Tages zusammen, die Gesamtkarte
// alle Tage eines Einsatzes. Kostenmodell wie in demo/einsatzKennzahlen.js.

const FAHRERKOSTEN_JE_STUNDE = 28;
const FAHRZEUGKOSTEN_JE_KM = 0.45;
const MWST = 1.19;
const CO2_KG_JE_KM_VERBRENNER = 0.195;
const CO2_KG_JE_KM_EV = 0.075; // Strommix ca. 0,38 kg/kWh x 0,2 kWh/km
const LEERFAHRT_FAKTOR = 1.3;

const pad2 = (n) => String(n).padStart(2, '0');
const minutenZuUhr = (minuten) => `${pad2(Math.floor(minuten / 60) % 24)}:${pad2(minuten % 60)}`;
const zahl = (wert, stellen = 0) => new Intl.NumberFormat('de-DE', { minimumFractionDigits: stellen, maximumFractionDigits: stellen }).format(wert);

// Rohwerte aus einer Liste von Vorschlaegen (ein oder mehrere Tage).
export const walletRohwerte = (vorschlaege = []) => {
  const fahrerIds = new Set();
  let kunden = 0;
  let fahrten = 0;
  let km = 0;
  let co2 = 0;
  let stunden = 0;
  let startMin = null;
  let endeMin = null;
  vorschlaege.forEach((v) => {
    fahrerIds.add(v.driverId || v.id);
    const rides = Array.isArray(v.rides) ? v.rides : [];
    fahrten += rides.length;
    kunden += rides.reduce((summe, r) => summe + (Number(r.passengers) || 1), 0);
    const kmSchicht = Number.isFinite(v.shiftKm) && v.shiftKm != null
      ? v.shiftKm
      : rides.reduce((summe, r) => summe + (Number(r.km) || 0), 0) * LEERFAHRT_FAKTOR;
    km += kmSchicht;
    co2 += kmSchicht * (v.vehicleIsEv ? CO2_KG_JE_KM_EV : CO2_KG_JE_KM_VERBRENNER);
    const start = v.startMinutes ?? 0;
    const ende = v.endMinutes ?? start;
    stunden += Math.max(0, (ende - start) / 60);
    startMin = startMin == null ? start : Math.min(startMin, start);
    endeMin = endeMin == null ? ende : Math.max(endeMin, ende);
  });
  const preis = (stunden * FAHRERKOSTEN_JE_STUNDE + km * FAHRZEUGKOSTEN_JE_KM) * MWST;
  return { anzahl: vorschlaege.length, fahrer: fahrerIds.size, kunden, fahrten, km, co2, preis, startMin, endeMin };
};

// Anzeigewerte der Karte.
export const walletWerte = (vorschlaege = []) => {
  const roh = walletRohwerte(vorschlaege);
  if (!roh.anzahl) {
    return { start: '–', ende: '–', fahrer: '0', kunden: '0', schnitt: '0', fahrten: '0', km: '0', co2: '0kg', preis: '0€' };
  }
  return {
    start: `${minutenZuUhr(roh.startMin)} Uhr`,
    ende: `${minutenZuUhr(roh.endeMin)} Uhr`,
    fahrer: zahl(roh.fahrer),
    kunden: zahl(roh.kunden),
    schnitt: zahl(roh.fahrer ? roh.kunden / roh.fahrer : 0, 1),
    fahrten: zahl(roh.fahrten),
    km: zahl(Math.round(roh.km)),
    co2: `${zahl(Math.round(roh.co2))}kg`,
    preis: `${zahl(Math.round(roh.preis / 10) * 10)}€`,
  };
};
