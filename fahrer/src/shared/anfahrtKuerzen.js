// Gefahrenen Teil der Anfahrtslinie abschneiden, ohne neue Route zu rechnen.
// Sucht den Punkt der Linie, der dem Fahrer am naechsten liegt, und liefert
// seinen Index plus den Abstand in Metern. Liegt der Fahrer weiter als die
// Toleranz von der Linie weg, ist er von der Route abgekommen.
const zuPunkt = (wert) => {
  if (!wert) return null;
  const lat = typeof wert.lat === 'function' ? wert.lat() : Number(wert.lat);
  const lng = typeof wert.lng === 'function' ? wert.lng() : Number(wert.lng);
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
};

const abstandMeter = (a, b) => {
  const r = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(h));
};

export const naechsterPunktAufPfad = (pfad, fahrer) => {
  const punkte = (Array.isArray(pfad) ? pfad : []).map(zuPunkt).filter(Boolean);
  const ziel = zuPunkt(fahrer);
  if (!punkte.length || !ziel) return { index: -1, abstand: Infinity, punkte };
  let besterIndex = 0;
  let besterAbstand = Infinity;
  punkte.forEach((punkt, index) => {
    const abstand = abstandMeter(punkt, ziel);
    if (abstand < besterAbstand) {
      besterAbstand = abstand;
      besterIndex = index;
    }
  });
  return { index: besterIndex, abstand: besterAbstand, punkte };
};

// Neuer Linienverlauf: vom Fahrer bis zum Ende der Route.
export const anfahrtAbFahrer = (pfad, fahrer, toleranzMeter = 200) => {
  const { index, abstand, punkte } = naechsterPunktAufPfad(pfad, fahrer);
  if (index < 0) return { abseits: false, pfad: null };
  if (abstand > toleranzMeter) return { abseits: true, pfad: null };
  return { abseits: false, pfad: [zuPunkt(fahrer), ...punkte.slice(index + 1)] };
};
