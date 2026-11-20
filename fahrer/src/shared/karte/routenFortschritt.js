// Gefahrenen Teil einer Route abtrennen, ohne die Route neu zu berechnen.
// Der Fahrer wird auf den naechsten Punkt der Linie gelegt. Die Suche laeuft
// nur vorwaerts ab dem letzten Treffer, damit Schleifen nicht zurueckspringen.
// Gleiche Logik wie in der Dispo-Karte (KartenView, routenFortschrittAktualisieren).

const meterZwischen = (a, b) => {
  const dx = (b.lng - a.lng) * Math.cos((a.lat * Math.PI) / 180) * 111320;
  const dy = (b.lat - a.lat) * 110540;
  return Math.hypot(dx, dy);
};

// fortschritt: { index, gefunden } wird vom Aufrufer gehalten und hier fortgeschrieben.
// Rueckgabe null, wenn der Fahrer nicht auf der Linie ist (weiter als maxAbstand).
export const routeTeilen = (pfad, position, fortschritt, { maxAbstand = 60, suchfenster = 150 } = {}) => {
  if (!Array.isArray(pfad) || pfad.length < 2 || !position || !fortschritt) return null;
  const ab = Math.max(0, Number(fortschritt.index) || 0);
  // Beim ersten Mal kann der Fahrer schon mitten auf der Linie sein: ganze Linie absuchen.
  const bis = fortschritt.gefunden ? Math.min(pfad.length, ab + suchfenster) : pfad.length;
  let index = -1;
  let abstand = Infinity;
  for (let i = ab; i < bis; i += 1) {
    const d = meterZwischen(position, pfad[i]);
    if (d < abstand) { abstand = d; index = i; }
  }
  if (index < 0 || abstand > maxAbstand) {
    // Fahrer gerade neben der Linie (Umweg, GPS-Streuung): letzten bekannten Stand behalten,
    // sonst springt die Linie wieder auf volle Laenge zurueck.
    if (!fortschritt.gefunden) return null;
    const i = Math.min(ab, pfad.length - 1);
    return { index: i, abstand: null, gefahren: pfad.slice(0, i + 1), rest: pfad.slice(i) };
  }
  fortschritt.gefunden = true;
  fortschritt.index = Math.max(ab, index);
  const hier = { lat: position.lat, lng: position.lng };
  return {
    index: fortschritt.index,
    abstand,
    gefahren: [...pfad.slice(0, fortschritt.index + 1), hier],
    rest: [hier, ...pfad.slice(fortschritt.index + 1)],
  };
};

export const istAmEnde = (pfad, fortschritt) => Boolean(fortschritt?.gefunden)
  && Array.isArray(pfad) && fortschritt.index >= pfad.length - 3;
