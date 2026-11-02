// Wer vor dieser Fahrt noch eine andere offene Fahrt hat, steht zum Start
// nicht dort, wo das Handy ihn gerade sieht, sondern am Ziel der vorherigen
// Fahrt. Fuer die Anfahrtszeit ist genau dieser Ort die wichtige Angabe.

const BEENDET = ['done', 'completed', 'arrived', 'beendet', 'cancelled', 'canceled', 'storniert', 'abgebrochen'];

const klein = (wert) => String(wert || '').trim().toLowerCase();

const istBeendet = (fahrt) => BEENDET.includes(klein(fahrt?.status));

// "14:30" wird zu 870. Ohne lesbare Zeit zaehlt die Fahrt nicht mit.
const minuten = (etd) => {
  const treffer = /^(\d{1,2}):(\d{2})/.exec(String(etd || '').trim());
  if (!treffer) return null;
  return Number(treffer[1]) * 60 + Number(treffer[2]);
};

export const vorherigeOffeneFahrt = (fahrten, fahrt) => {
  if (!fahrt) return null;
  const start = minuten(fahrt.etd);
  if (start == null) return null;

  // Jede Fahrt des Tages, die frueher losgeht, zaehlt mit — die Kette laeuft
  // Karte fuer Karte durch: Ziel der vorherigen ist Start der naechsten.
  const davor = (fahrten || []).filter((andere) => {
    if (!andere || andere.id === fahrt.id) return false;
    if (andere.rideDate !== fahrt.rideDate) return false;
    if (!(andere.to?.address || andere.to?.name)) return false;
    const zeit = minuten(andere.etd);
    return zeit != null && zeit < start;
  });

  davor.sort((a, b) => minuten(b.etd) - minuten(a.etd));
  const unmittelbarDavor = davor[0];
  if (!unmittelbarDavor) return null;

  // Ist genau diese Fahrt beendet oder storniert, steht der Fahrer wieder
  // frei herum — dann zaehlt sein Standort, nicht das alte Ziel.
  if (istBeendet(unmittelbarDavor)) return null;
  return unmittelbarDavor;
};

// Liegen zwei Kartenpunkte (LatLng mit lat()/lng() oder { lat, lng }) so dicht
// beieinander, dass sich ihre Pins voll ueberdecken? Dann ist es derselbe Ort.
const GLEICHER_ORT_M = 40;
const wert = (punkt, achse) => Number(typeof punkt?.[achse] === 'function' ? punkt[achse]() : punkt?.[achse]);
export const gleicherOrt = (a, b) => {
  const lat1 = wert(a, 'lat');
  const lng1 = wert(a, 'lng');
  const lat2 = wert(b, 'lat');
  const lng2 = wert(b, 'lng');
  if (![lat1, lng1, lat2, lng2].every(Number.isFinite)) return false;
  const dLat = (lat2 - lat1) * 110574;
  const dLng = (lng2 - lng1) * 111320 * Math.cos((lat1 * Math.PI) / 180);
  return Math.hypot(dLat, dLng) <= GLEICHER_ORT_M;
};

export default vorherigeOffeneFahrt;
