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
