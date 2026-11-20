// Eine Regel fuer alle Stellen, an denen Gaeste einer Fahrt angezeigt werden.
// Nur anonyme Gaeste: "1 Anonymer Gast" bzw. "N Anonyme Gäste".
// Namen und anonyme: Namen wie bisher, die anonymen kommen als "+ N" dazu.
// Weder noch: "Keine Gäste". Der Startort ist nie ein Gastname.

// Alte Eintraege wie "Anonymer Fahrgast 2" in passengers zaehlen als anonym.
export const ALT_ANONYM_RE = /^anonymer?\s+fahrgast(?:\s+\d+)?$/i;

export const anonymeAnzahl = (wert) => {
  const n = Number.parseInt(String(wert ?? '0'), 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

// Namen bereinigen und alte Anonym-Eintraege in die Anzahl uebernehmen.
export const gaesteTeile = (namen, anonym) => {
  const roh = (Array.isArray(namen) ? namen : [])
    .map((name) => String(name || '').trim())
    .filter(Boolean);
  const altAnonym = roh.filter((name) => ALT_ANONYM_RE.test(name)).length;
  const echteNamen = Array.from(new Set(roh.filter((name) => !ALT_ANONYM_RE.test(name))));
  return { namen: echteNamen, anonym: Math.max(anonymeAnzahl(anonym), altAnonym) };
};

export const anonymeGaesteText = (anzahl, t) => {
  const n = anonymeAnzahl(anzahl);
  return n === 1 ? t('gaeste.anonymEins') : t('gaeste.anonymViele', { n });
};

// Ganzer Text in einer Zeile, z. B. fuer Titel oder Antworten.
export const gaesteText = (namen, anonym, t, { trenner = ', ' } = {}) => {
  const teile = gaesteTeile(namen, anonym);
  if (teile.namen.length && teile.anonym) return `${teile.namen.join(trenner)} + ${teile.anonym}`;
  if (teile.namen.length) return teile.namen.join(trenner);
  if (teile.anonym) return anonymeGaesteText(teile.anonym, t);
  return t('gaeste.keine');
};

// Abholschild: Vornamen abgekuerzt, Titel und Nachname bleiben.
// "Simone Müller" -> "S. Müller", "Dr. Hans Peter Meier" -> "Dr. H. P. Meier",
// "Hans-Peter Meier" -> "H.-P. Meier", "Anna von Berg" -> "A. von Berg", "Müller, Simone" -> "S. Müller".
// Ein einzelnes Wort (nur Nachname oder Firma) bleibt, wie es ist.
// Gleiche Regel in ios-fahrer (Abholschild.schildName) und android (schildName).
const TITEL_RE = /^(dr|prof|herr|frau|mr|mrs|ms|miss|sir|dipl|ing|mag|med|rer|nat|phil|hon|familie|family|fam|firma|team|gruppe|group)\.?$|\.$/i;
const NAMENSZUSATZ = new Set(['von', 'van', 'de', 'der', 'den', 'del', 'da', 'di', 'du', 'la', 'le', 'ten', 'ter', 'vom', 'zu', 'zur', 'zum', 'af', 'al', 'bin', 'el']);

const vornameKurz = (wort) => wort
  .split('-')
  .filter(Boolean)
  .map((teil) => `${Array.from(teil)[0].toLocaleUpperCase('de-DE')}.`)
  .join('-');

export const schildName = (eingabe) => {
  let text = String(eingabe || '').trim().replace(/\s+/g, ' ');
  // "Nachname, Vorname" -> "Vorname Nachname"
  const komma = text.match(/^([^,]+),\s*([^,]+)$/);
  if (komma) text = `${komma[2]} ${komma[1]}`;
  const woerter = text.split(' ').filter(Boolean);
  if (woerter.length < 2) return text;

  const titel = [];
  while (woerter.length > 1 && TITEL_RE.test(woerter[0])) titel.push(woerter.shift());
  if (woerter.length < 2) return [...titel, ...woerter].join(' ');

  // Nachname: das letzte Wort, samt Namenszusaetzen davor ("von Berg", "van der Meer").
  let nachnameAb = woerter.length - 1;
  while (nachnameAb > 1 && NAMENSZUSATZ.has(woerter[nachnameAb - 1].toLowerCase())) nachnameAb -= 1;
  const vornamen = woerter.slice(0, nachnameAb).map(vornameKurz);
  return [...titel, ...vornamen, ...woerter.slice(nachnameAb)].join(' ');
};

// Zeilen fuer Gaestelisten: jeder Name eine Zeile, die anonymen als eigene Zeile.
// Mit Namen davor steht "+ N Anonyme Gäste", ohne Namen nur "N Anonyme Gäste".
export const gaesteZeilen = (namen, anonym, t, keineText) => {
  const teile = gaesteTeile(namen, anonym);
  const zeilen = [...teile.namen];
  if (teile.anonym) {
    const text = anonymeGaesteText(teile.anonym, t);
    zeilen.push(teile.namen.length ? `+ ${text}` : text);
  }
  return zeilen.length ? zeilen : [keineText || t('gaeste.keine')];
};
