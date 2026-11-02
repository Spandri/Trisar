// Der Name einer Kolonne kommt aus den Daten oft schon mit Gattungswort
// davor ("Kolonne Summit-Delegation", "Konvoi Delegation Berlin"). Wo die
// Oberflaeche das Wort selbst davorsetzt, stuende es doppelt; im Chat-Kopf
// soll ueberhaupt nur der Eigenname stehen. Diese Funktion schaelt das
// Gattungswort in allen Sprachen der App ab.
const GATTUNG = /^\s*(kolonn?e?|konvoi|konvoy|convoy|convoi|convoglio)\b\s*[:\-–]?\s*/i;

export const kolonnenNameKurz = (name) => String(name || '').trim().replace(GATTUNG, '').trim();

export default kolonnenNameKurz;
