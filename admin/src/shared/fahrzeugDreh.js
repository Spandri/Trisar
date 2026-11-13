// Modelle und Lacke, fuer die die Fahrer-App eine 360-Grad-Ansicht hat (public/fahrzeug-dreh/fahrzeug-dreh.json,
// erzeugt mit werkzeuge/fahrzeugbilder/dreh-einbauen.py). Beim Fahrzeug anlegen/bearbeiten als Vorschlaege
// fuer Marke/Modell und Farbe. Passen brand_model und color, nimmt die Fahrer-App die Bilderreihe.

let infoVersprechen = null;

export function drehInfoLaden() {
  if (!infoVersprechen) {
    infoVersprechen = fetch(`${import.meta.env.BASE_URL || '/'}fahrzeug-dreh/fahrzeug-dreh.json`)
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
  }
  return infoVersprechen;
}

// klein, Umlaute ausgeschrieben, nur Buchstaben und Ziffern: "V-Klasse 250 d" -> "vklasse250d"
export const glatt = (s) => String(s || '').toLowerCase()
  .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
  .replace(/[^a-z0-9]/g, '');

// Modell, zu dem brand_model gehoert (gleiche Regel wie in der Fahrer-App), sonst null.
export function drehModell(info, brandModel) {
  const m = glatt(brandModel);
  if (!info || !m) return null;
  // laengstes passendes Modellwort gewinnt ("sklasselang" vor "sklasse")
  let treffer = null; let laenge = 0;
  for (const x of info.modelle || []) for (const w of x.modell || []) if (w.length > laenge && m.includes(w)) { treffer = x; laenge = w.length; }
  return treffer;
}

// Lack, zu dem color gehoert, sonst null.
export function drehLack(modell, color) {
  const f = glatt(color);
  if (!modell || !f) return null;
  const treffer = modell.farben.find(([wort]) => f.includes(wort));
  return treffer ? (modell.lackliste || []).find((l) => l.code === treffer[1]) || null : null;
}

// Vorschlaege fuer Marke/Modell: jedes Wort der Eingabe kommt im Namen vor. Leere Eingabe: alle.
export function modellVorschlaege(info, eingabe) {
  if (!info) return [];
  const woerter = String(eingabe || '').split(/\s+/).map(glatt).filter(Boolean);
  return (info.modelle || [])
    .filter((m) => woerter.every((w) => glatt(m.name).includes(w)))
    .filter((m) => m.name !== String(eingabe || '').trim())
    .map((m) => m.name);
}

// Vorschlaege fuer Farbe: nur wenn das Modell bekannt ist, dann dessen Lacke.
export function farbVorschlaege(info, brandModel, eingabe) {
  const modell = drehModell(info, brandModel);
  if (!modell) return [];
  const e = glatt(eingabe);
  return (modell.lackliste || [])
    .filter((l) => !e || glatt(l.name).includes(e))
    .filter((l) => l.name !== String(eingabe || '').trim());
}

// Seitenbild (Front nach rechts) des passenden Lacks fuer Fahrzeugliste und Fahrzeug bearbeiten, sonst ''.
export function seitenBild(info, brandModel, color) {
  const modell = drehModell(info, brandModel);
  const lack = drehLack(modell, color);
  return modell && lack ? `${import.meta.env.BASE_URL || '/'}fahrzeug-dreh/${modell.id}-${lack.code}-seite.webp` : '';
}
