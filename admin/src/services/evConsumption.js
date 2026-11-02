// Realistischer Energieverbrauch der E-Fahrzeuge für die Fahrt-Simulation.
//
// Datenbasis: ev-database.org (Real-World-Werte, keine WLTP-Laborwerte).
// EVDB definiert dort ausdrücklich:
//   Cold weather = -10 °C mit Heizung,  Mild weather = +23 °C ohne Klimaanlage.
//   Highway-Werte gelten für konstant 110 km/h.
// Zwischen diesen beiden Stützpunkten wird linear interpoliert; ausserhalb
// wird NICHT extrapoliert, sondern auf den jeweiligen Randwert begrenzt.
//
// Quellen:
//   iX M70  https://ev-database.org/car/3111/BMW-iX-M70-xDrive
//   i7 M70  https://ev-database.org/car/1838/BMW-i7-M70-xDrive
//   iX3 40  https://ev-database.org/car/3505/BMW-iX3-40

export const COLD_C = -10;
export const MILD_C = 23;

// usableKwh = nutzbare Akkukapazität; Verbrauch in Wh/km.
const MODELLE = [
  {
    match: /ix\s*m70/i,
    name: 'BMW iX M70',
    usableKwh: 108.9,
    cityCold: 220, cityMild: 153,
    highwayCold: 303, highwayMild: 237,
  },
  {
    match: /i7\s*m70/i,
    name: 'BMW i7 M70',
    usableKwh: 101.7,
    cityCold: 214, cityMild: 148,
    highwayCold: 286, highwayMild: 224,
  },
  {
    match: /ix3/i,
    name: 'BMW iX3 40',
    usableKwh: 82.6,
    cityCold: 172, cityMild: 114,
    highwayCold: 229, highwayMild: 178,
  },
];

export const findEvModel = (brandModel, trim) => {
  const text = `${brandModel || ''} ${trim || ''}`.trim();
  return MODELLE.find((m) => m.match.test(text)) || null;
};

// Linear zwischen zwei Stützpunkten, ohne Extrapolation.
const mix = (kalt, mild, anteilMild) => kalt + (mild - kalt) * Math.max(0, Math.min(1, anteilMild));

// Temperaturanteil: 0 = -10 °C (Winterwert), 1 = +23 °C (Sommerwert).
export const temperatureFactor = (celsius) => {
  if (!Number.isFinite(celsius)) return 1;
  return Math.max(0, Math.min(1, (celsius - COLD_C) / (MILD_C - COLD_C)));
};

// Fahrprofil aus der Durchschnittsgeschwindigkeit eines Abschnitts:
// bis 50 km/h reiner Stadtwert, ab 90 km/h reiner Autobahnwert (EVDB misst
// Highway bei 110 km/h), dazwischen linear gemischt.
export const highwayShare = (km, minutes) => {
  if (!(km > 0) || !(minutes > 0)) return 0;
  const kmh = km / (minutes / 60);
  return Math.max(0, Math.min(1, (kmh - 50) / 40));
};

// Verbrauch eines Abschnitts in Wh/km.
export const consumptionWhPerKm = (modell, celsius, km, minutes) => {
  if (!modell) return null;
  const warm = temperatureFactor(celsius);
  const city = mix(modell.cityCold, modell.cityMild, warm);
  const highway = mix(modell.highwayCold, modell.highwayMild, warm);
  return mix(city, highway, highwayShare(km, minutes));
};

// Verbrauchte Akkuprozente für einen Abschnitt.
export const percentUsed = (modell, celsius, km, minutes) => {
  const wh = consumptionWhPerKm(modell, celsius, km, minutes);
  if (wh == null || !(km > 0)) return 0;
  return ((wh * km) / 1000 / modell.usableKwh) * 100;
};

// Tagesmitteltemperatur (München) über Open-Meteo — ohne API-Schlüssel.
export async function fetchDayTemperature(dayIso, lat = 48.137, lon = 11.575) {
  const tag = String(dayIso || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tag)) return null;
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}`
      + `&daily=temperature_2m_max,temperature_2m_min&timezone=auto&start_date=${tag}&end_date=${tag}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const max = Number(data?.daily?.temperature_2m_max?.[0]);
    const min = Number(data?.daily?.temperature_2m_min?.[0]);
    if (!Number.isFinite(max) || !Number.isFinite(min)) return null;
    return (max + min) / 2;
  } catch {
    return null;
  }
}
