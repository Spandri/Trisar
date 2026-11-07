// Kurzform einer Adresse fuer die Anzeige in der Fahrt.
// OpenStreetMap (Nominatim) liefert Adressen als "153, Thalkirchner Straße, Sendling, München, ...",
// also mit der Hausnummer vorne. Daraus wird "Thalkirchner Straße 153". Sonst zaehlt der erste
// Abschnitt vor dem Komma, wie bisher.
const HAUSNUMMER = /^\d+\s?[a-zA-Z]?(\s*[-/]\s*\d+\s?[a-zA-Z]?)?$/;

export const kurzAdresse = (text) => {
  const roh = String(text || '').trim();
  if (!roh) return '';
  const teile = roh.split(',').map((teil) => teil.trim()).filter(Boolean);
  if (!teile.length) return roh;
  if (HAUSNUMMER.test(teile[0]) && teile[1]) return `${teile[1]} ${teile[0]}`;
  return teile[0];
};

// Adresse in Normalform: Hausnummer hinter die Strasse, Abschnitte mit Komma.
const adresseNormal = (text) => {
  const teile = String(text || '').split(',').map((teil) => teil.trim()).filter(Boolean);
  if (teile.length > 1 && HAUSNUMMER.test(teile[0])) return [`${teile[1]} ${teile[0]}`, ...teile.slice(2)].join(', ');
  return teile.join(', ');
};

// Zieltext fuer Google Maps. Name und Adresse nur dann beide, wenn der Name nicht schon
// in der Adresse steckt. Sonst stand dieselbe Adresse zweimal im Link und Google fand nichts.
export const adresseFuerNavigation = (name, address) => {
  const nameText = String(name || '').trim();
  const adresse = adresseNormal(address);
  if (!nameText) return adresse;
  if (!adresse) return adresseNormal(nameText);
  const nameNormal = adresseNormal(nameText).toLowerCase();
  if (adresse.toLowerCase().includes(nameText.toLowerCase()) || adresse.toLowerCase() === nameNormal) return adresse;
  return `${nameText}, ${adresse}`;
};
