// Kern des Excel-/CSV-Imports: aus rohen Tabellenzeilen Spalten erkennen und Fahrten bzw.
// Fahrgaeste bauen. Reines JavaScript ohne Abhaengigkeiten, damit dieselbe Datei auf dem
// Server (dispo-admin, Deno) und in der Demo (Browser) laeuft.
//
// Massgeblich ist die Fassung in fahrer/supabase/functions/dispo-admin/importKern.js.
// admin/src/services/importKern.js ist eine Kopie, das Ausroll-Skript prueft, dass beide gleich sind.
//
// Es gibt kein festes Schema: jede Spalte wird nach Ueberschrift und Werten bewertet. Dazu:
// - das passende Tabellenblatt wird selbst gewaehlt,
// - Fahrten ueber mehrere Zeilen (ein Gast je Zeile, Datum nur in der ersten Zeile oder als
//   Zwischenzeile) werden zusammengefasst,
// - eine einmal gepruefte Zuordnung kann als Vorlage wieder angewendet werden.

export const text = (wert) => {
  if (wert instanceof Date && !Number.isNaN(wert.getTime())) {
    const p = (n) => String(n).padStart(2, '0');
    // UTC, weil Excel-Zellen ohne Zeitzone gelesen werden.
    const std = wert.getUTCHours(); const min = wert.getUTCMinutes();
    const zeit = `${p(std)}:${p(min)}`;
    // Reine Uhrzeit-Zellen kommen als 30.12.1899 an.
    if (wert.getUTCFullYear() < 1901) return zeit;
    return `${wert.getUTCFullYear()}-${p(wert.getUTCMonth() + 1)}-${p(wert.getUTCDate())}${std || min ? ` ${zeit}` : ''}`;
  }
  return String(wert ?? '').replace(/\s+/g, ' ').trim();
};
export const schluessel = (wert) => text(wert).toLowerCase().replace(/[^a-z0-9äöüß]+/g, ' ').trim();

// ---------------------------------------------------------------------------
// Werte erkennen
// ---------------------------------------------------------------------------

const MONATE = {
  jan: 1, januar: 1, january: 1, feb: 2, februar: 2, february: 2, mär: 3, mar: 3, märz: 3, maerz: 3, march: 3,
  apr: 4, april: 4, mai: 5, may: 5, jun: 6, juni: 6, june: 6, jul: 7, juli: 7, july: 7, aug: 8, august: 8,
  sep: 9, sept: 9, september: 9, okt: 10, oct: 10, oktober: 10, october: 10, nov: 11, november: 11,
  dez: 12, dec: 12, dezember: 12, december: 12,
};

const ohneDatum = (t) => text(t)
  .replace(/\d{1,2}\.\d{1,2}\.\d{2,4}|\d{4}-\d{1,2}-\d{1,2}(?:T(?=\d))?|\d{1,2}\/\d{1,2}\/\d{2,4}/g, ' ')
  .replace(/(^|[^\d.])\d{1,2}\.\d{1,2}\.(?!\d)/g, '$1 ');

const p2 = (n) => String(n).padStart(2, '0');
const jahr4 = (j) => (String(j).length === 2 ? `20${j}` : String(j));
const gueltig = (j, m, t) => {
  const d = new Date(Date.UTC(Number(j), Number(m) - 1, Number(t)));
  return d.getUTCFullYear() === Number(j) && d.getUTCMonth() === Number(m) - 1 && d.getUTCDate() === Number(t);
};
const iso = (j, m, t) => (gueltig(jahr4(j), m, t) ? `${jahr4(j)}-${p2(m)}-${p2(t)}` : '');

// Excel speichert Tage als Zahl ab 1900 (45963 = 2025-10-31). Nur plausible Bereiche.
const excelTag = (zahl) => {
  if (!(zahl > 40000 && zahl < 60000)) return '';
  const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(zahl) * 86400000);
  return `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}`;
};

export const datumLesen = (wert) => {
  const t = text(wert);
  if (!t) return '';
  let m = t.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return iso(m[1], m[2], m[3]);
  m = t.match(/(?:^|\D)(\d{1,2})\.(\d{1,2})\.(\d{2,4})(?!\d)/);
  if (m) return iso(m[3], m[2], m[1]);
  // 16/08/2026 (europaeisch), bei Werten ueber 12 im zweiten Feld amerikanisch
  m = t.match(/(?:^|\D)(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?!\d)/);
  if (m) {
    const a = Number(m[1]); const b = Number(m[2]);
    const [tag, monat] = b > 12 ? [b, a] : [a, b];
    return iso(m[3], monat, tag);
  }
  m = t.toLowerCase().match(/(\d{1,2})\.?\s*([a-zäöü]{3,9})\.?,?\s+(\d{2,4})/);
  if (m && MONATE[m[2]]) return iso(m[3], MONATE[m[2]], m[1]);
  m = t.toLowerCase().match(/([a-zäöü]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})/);
  if (m && MONATE[m[1]]) return iso(m[3], MONATE[m[1]], m[2]);
  if (/^\d{5}(\.\d+)?$/.test(t)) return excelTag(Number(t));
  // Ohne Jahr ("Mo 12.01.", "12.1."): dieses Jahr, liegt der Tag mehr als zwei Monate zurueck das naechste.
  m = t.match(/(?:^|[^\d.])(\d{1,2})\.(\d{1,2})\.(?!\d)/);
  if (m && !/\d{1,2}[:.]\d{2}\s*(uhr|h)\b/i.test(t) && Number(m[2]) <= 12) {
    const jetzt = new Date();
    let jahr = jetzt.getFullYear();
    const kandidat = Date.UTC(jahr, Number(m[2]) - 1, Number(m[1]));
    if (kandidat < jetzt.getTime() - 61 * 86400000) jahr += 1;
    return iso(jahr, m[2], m[1]);
  }
  return '';
};

export const uhrzeitLesen = (wert) => {
  // Datumsteile zuerst entfernen, sonst wird aus "13.01.2027" die Uhrzeit 13:01.
  const t = ohneDatum(wert).trim();
  // Excel-Bruchteil eines Tages (0.5 = 12:00)
  if (/^0?\.\d+$/.test(t)) {
    const minuten = Math.round(Number(t) * 1440);
    if (minuten >= 0 && minuten < 1440) return `${p2(Math.floor(minuten / 60))}:${p2(minuten % 60)}`;
  }
  const m = t.match(/(?:^|[^\d.])(\d{1,2})[:.h](\d{2})(?:\s*(am|pm))?(?!\d)/i)
    || t.match(/^(\d{1,2})[:.](\d{2})/)
    || t.match(/^(\d{1,2})(\d{2})\s*(?:uhr|h)$/i)
    || t.match(/(?:^|\s)(\d{1,2})()\s*(am|pm|uhr)\b/i);
  if (!m) return '';
  let std = Number(m[1]);
  const min = Number(m[2] || 0);
  const halb = (m[3] || '').toLowerCase();
  if (halb === 'pm' && std < 12) std += 12;
  if (halb === 'am' && std === 12) std = 0;
  if (std > 23 || min > 59) return '';
  return `${p2(std)}:${p2(min)}`;
};



const MUSTER_UHR = (t) => /^\s*\d{1,2}[:.h]\d{2}(\s*(uhr|am|pm|h))?\s*$/i.test(t);

export const MUSTER = {
  datum: (t) => Boolean(datumLesen(t)) && !uhrzeitLesen(ohneDatum(t)),
  uhrzeit: (t) => /^\s*\d{1,2}[:.h]\d{2}(\s*(uhr|am|pm|h))?\s*$/i.test(t) || /^0?\.\d+$/.test(text(t)),
  datumUhrzeit: (t) => Boolean(datumLesen(t)) && Boolean(uhrzeitLesen(ohneDatum(t))),
  flug: (t) => /^[A-Z][A-Z0-9]\s?\d{2,4}[A-Z]?$/.test(t.toUpperCase().trim()) && !/^(ICE|IC|EC|RJ|TGV|RE|RB)\s?\d/i.test(t),
  zug: (t) => /^(ICE|IC|EC|RJ|RJX|TGV|RE|RB|NJ|FLX)\s?\d{1,5}$/i.test(t.trim()),
  flughafenCode: (t) => (/\(([A-Z]{3})\)|^[A-Z]{3}$/.test(t.trim())) && !/^(VIP|PAX|TBA|TBC|N\/A|USD|EUR)$/i.test(t.trim()),
  ort: (t) => !datumLesen(t) && !MUSTER_UHR(t) && (/(stra(ß|ss)e|str\.|platz|weg|allee|ring|gasse|damm|ufer|road|street|avenue|hotel|flughafen|airport|terminal|bahnhof|hbf|messe|zentrum|center|centre|halle|restaurant|büro|office)/i.test(t)
    || /\b\d{5}\b/.test(t) || /\b[A-ZÄÖÜ][a-zäöüß]+\s\d{1,4}[a-z]?\b/.test(t) || /\b(MUC|FRA|BER|HAM|DUS|STR|NUE|CGN)\b/.test(t)),
  name: (t0) => { const t = t0.replace(/^[^:]{2,60}:\s*/, ''); return /^([A-ZÄÖÜ][a-zäöüß'-]+\.?\s){1,3}[A-ZÄÖÜ][a-zäöüß'-]+(\s*[,;&/+]\s*([A-ZÄÖÜ][a-zäöüß'-]+\.?\s){0,3}[A-ZÄÖÜ][a-zäöüß'-]+)*$/.test(t.replace(/^(herr|frau|mr|mrs|ms|dr|prof)\.?\s+/i, '').trim())
    || /^[A-ZÄÖÜ][a-zäöüß'-]+,\s*[A-ZÄÖÜ][a-zäöüß'-]+$/.test(t.trim()); },
  anzahl: (t) => /^\d{1,2}$/.test(t.trim()) && Number(t) >= 1 && Number(t) <= 30,
  janein: (t) => /^(ja|nein|yes|no|x|true|false|1|0|y|n|✓|✔|wahr|falsch)$/i.test(t.trim()),
  email: (t) => /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(t.trim()),
  telefon: (t) => /^\+?[\d\s()/-]{7,}$/.test(t.trim()) && (t.match(/\d/g) || []).length >= 7,
  plz: (t) => /^\d{4,5}$/.test(t.trim()),
  freitext: (t) => t.trim().split(/\s+/).length >= 4,
};

const anteil = (werte, pruefung) => (werte.length ? werte.filter((w) => pruefung(w)).length / werte.length : 0);

// ---------------------------------------------------------------------------
// Zielfelder
// ---------------------------------------------------------------------------

// kopf: Woerter, die in der Ueberschrift auf das Feld hindeuten (deutsch, englisch, Kuerzel).
// werte: welche Muster die Werte haben sollten.
const FAHRT_FELDER = [
  { key: 'datumUhrzeit', kopf: ['datum uhrzeit', 'datum zeit', 'termin', 'date time', 'datetime', 'zeitpunkt', 'pickup datetime', 'pick up date time', 'abholung am', 'service datetime'], werte: ['datumUhrzeit'], belegt: ['datum', 'uhrzeit'] },
  { key: 'datum', kopf: ['datum', 'date', 'tag', 'day', 'service date', 'fahrtdatum', 'transferdatum', 'ankunftstag', 'arrival date', 'anreise', 'reisedatum', 'travel date'], werte: ['datum'] },
  { key: 'uhrzeit', kopf: ['uhrzeit', 'zeit', 'time', 'abholzeit', 'pick up time', 'pickup time', 'p u time', 'pu time', 'etd', 'abfahrt', 'abfahrtszeit', 'um', 'start time', 'departure time', 'ankunftszeit', 'arrival time', 'eta', 'landung', 'landing'], werte: ['uhrzeit'] },
  { key: 'abholort', kopf: ['abholort', 'abholung', 'abholadresse', 'von', 'start', 'startadresse', 'startort', 'pick up location', 'pickup location', 'pick up address', 'pickup address', 'pick up', 'pickup', 'p u', 'pu', 'from', 'from address', 'origin address', 'treffpunkt', 'abfahrtsort'], werte: ['ort'] },
  { key: 'zielort', kopf: ['zielort', 'ziel', 'zieladresse', 'nach', 'bis', 'drop off', 'dropoff', 'drop off location', 'drop off address', 'd o', 'do', 'destination', 'to', 'to address', 'hotel', 'unterkunft', 'ankunftsort'], werte: ['ort'] },
  { key: 'flugnummer', kopf: ['flug', 'flugnummer', 'flight', 'flight no', 'flight nr', 'flight number', 'flightnumber', 'arrival flight', 'zug flug', 'flug zug', 'flugnr', 'fl'], werte: ['flug', 'zug'] },
  { key: 'zugnummer', kopf: ['zug', 'zugnummer', 'train', 'train number', 'train no'], werte: ['zug'] },
  { key: 'herkunft', kopf: ['herkunft', 'abflugort', 'aus', 'arriving from', 'origin', 'kommt aus', 'abflughafen', 'departure airport'], werte: ['flughafenCode'] },
  { key: 'gaeste', kopf: ['gast', 'gäste', 'gaeste', 'fahrgast', 'fahrgäste', 'passagier', 'passagiere', 'guest', 'guest name', 'guests', 'passenger', 'passengers', 'passenger name', 'pax name', 'name', 'names', 'kunde', 'reisender', 'teilnehmer name', 'vip name', 'firma gäste', 'firma gaeste', 'firma gast', 'gäste firma'], werte: ['name'] },
  { key: 'anzahl', kopf: ['anzahl', 'anz', 'personen', 'pers', 'pax', 'persons', 'people', 'teilnehmer', 'number of guests', 'no of pax', 'no pax', 'gästeanzahl'], werte: ['anzahl'] },
  { key: 'vip', kopf: ['vip'], werte: ['janein'] },
  { key: 'kindersitz', kopf: ['kindersitz', 'child seat', 'kindersitze', 'baby seat', 'booster'], werte: ['janein', 'anzahl'] },
  { key: 'rollstuhl', kopf: ['rollstuhl', 'barrierefrei', 'wheelchair', 'rollstuhlgerecht', 'accessibility'], werte: ['janein'] },
  { key: 'gepaeck', kopf: ['gepäck', 'gepaeck', 'koffer', 'luggage', 'baggage', 'sondergepäck', 'bags'], werte: ['janein', 'anzahl'] },
  { key: 'notiz', kopf: ['notiz', 'notizen', 'bemerkung', 'bemerkungen', 'hinweis', 'hinweise', 'kommentar', 'note', 'notes', 'remarks', 'comment', 'comments', 'info', 'details', 'special requests', 'besonderheiten'], werte: ['freitext'] },
  // Kein eigenes Feld in jobs: beides kommt in die Notiz der Fahrt.
  { key: 'firma', kopf: ['firma', 'unternehmen', 'company', 'organisation', 'organization', 'kunde firma', 'auftraggeber'], werte: [] },
  { key: 'telefon', kopf: ['telefon', 'tel', 'phone', 'mobil', 'handy', 'mobile', 'telefonnummer', 'kontakt telefon'], werte: ['telefon'] },
];

const GAST_FELDER = [
  { key: 'vorname', kopf: ['vorname', 'first name', 'firstname', 'given name'], werte: ['name'] },
  { key: 'nachname', kopf: ['nachname', 'familienname', 'last name', 'lastname', 'surname', 'family name'], werte: ['name'] },
  { key: 'vollname', kopf: ['name', 'gast', 'kunde', 'guest', 'guest name', 'full name', 'fahrgast', 'teilnehmer'], werte: ['name'], belegt: ['vorname', 'nachname'] },
  { key: 'email', kopf: ['email', 'e mail', 'mail', 'e mail adresse'], werte: ['email'] },
  { key: 'telefon', kopf: ['telefon', 'tel', 'phone', 'mobil', 'handy', 'mobile', 'telefonnummer'], werte: ['telefon'] },
  { key: 'firma', kopf: ['firma', 'unternehmen', 'company', 'organisation', 'organization'], werte: [] },
  { key: 'strasse', kopf: ['straße', 'strasse', 'str', 'street', 'adresse', 'address'], werte: ['ort'] },
  { key: 'plz', kopf: ['plz', 'postleitzahl', 'zip', 'postcode', 'postal code'], werte: ['plz'] },
  { key: 'stadt', kopf: ['stadt', 'ort', 'city', 'town'], werte: [] },
  { key: 'sprache', kopf: ['sprache', 'language', 'lang'], werte: [] },
  { key: 'vip', kopf: ['vip'], werte: ['janein'] },
  { key: 'notiz', kopf: ['notiz', 'bemerkung', 'hinweis', 'note', 'notes', 'remarks'], werte: ['freitext'] },
];

export const felderFuer = (modus) => (modus === 'guests' ? GAST_FELDER : FAHRT_FELDER);
export const feldNamen = (modus) => felderFuer(modus).map((f) => f.key);

// Ohne diese Angaben wird aus einer Zeile keine Fahrt (bzw. kein Fahrgast).
export const pflichtFelder = (modus) => (modus === 'guests' ? ['name'] : ['datum', 'uhrzeit', 'abholort', 'zielort']);

// ---------------------------------------------------------------------------
// Kopfzeile finden
// ---------------------------------------------------------------------------

const siehtAusWieDaten = (t) => MUSTER.uhrzeit(t) || Boolean(datumLesen(t)) || /^\d+([.,]\d+)?$/.test(t) || MUSTER.flug(t);
const gefuellt = (z) => z.filter((w) => text(w)).length;

const kopfzeileFinden = (zeilen) => {
  const maxBreite = Math.max(0, ...zeilen.slice(0, 20).map(gefuellt));
  for (let i = 0; i < Math.min(zeilen.length - 1, 15); i += 1) {
    const z = zeilen[i];
    const n = gefuellt(z);
    if (n < 2 || n < maxBreite * 0.5) continue;
    const zellen = z.map(text).filter(Boolean);
    const datenhaft = zellen.filter(siehtAusWieDaten).length;
    const kurz = zellen.filter((w) => w.length <= 40).length;
    if (datenhaft === 0 && kurz === zellen.length) return i;
    // Erste breite Zeile sieht bereits wie Daten aus: es gibt keine Kopfzeile.
    if (datenhaft / zellen.length > 0.3) return -1;
  }
  return -1;
};

// ---------------------------------------------------------------------------
// Erkennung
// ---------------------------------------------------------------------------

const kopfTreffer = (titel, feld) => {
  const k = schluessel(titel);
  if (!k) return { wert: 0 };
  let bester = { wert: 0 };
  feld.kopf.forEach((wort) => {
    if (k === wort) bester = { wert: 1, wort };
    else if (bester.wert < 0.8 && (` ${k} `).includes(` ${wort} `) && wort.length >= 2) bester = { wert: wort.length <= 3 ? 0.6 : 0.8, wort };
    else if (bester.wert < 0.55 && wort.length >= 4 && k.includes(wort)) bester = { wert: 0.55, wort };
  });
  return bester;
};

const werteTreffer = (beispiele, feld) => {
  let bester = { wert: 0 };
  (feld.werte || []).forEach((art) => {
    const a = anteil(beispiele, MUSTER[art]);
    if (a > bester.wert) bester = { wert: a, art };
  });
  return bester;
};

// Signatur einer Tabelle fuer Vorlagen: normalisierte Ueberschriften, sortiert.
export const kopfSignatur = (spalten) => spalten
  .filter((s) => !s.ohneTitel)
  .map((s) => schluessel(s.titel))
  .filter(Boolean)
  .sort()
  .join('|');

// "1. Abholung: Firma / Gaeste | Adresse | Pax | Abholzeit | 2. Abholung: ... | Adresse | Pax | Abholzeit":
// dieselbe Spaltengruppe mehrfach nebeneinander. Jede Gruppe wird eine eigene Zeile, die
// uebrigen Spalten (Chauffeur, Hinweis ...) gelten fuer alle.
const ohneOrdnung = (t) => schluessel(t).replace(/^\d+\s+/, '').replace(/^(erste|zweite|dritte|vierte|1st|2nd|3rd|4th)\s+/, '');

const gruppeFinden = (titel) => {
  const norm = titel.map(ohneOrdnung);
  let beste = null;
  for (let laenge = 2; laenge <= Math.floor(norm.length / 2); laenge += 1) {
    for (let start = 0; start + 2 * laenge <= norm.length; start += 1) {
      const block = norm.slice(start, start + laenge);
      if (block.filter(Boolean).length < 2) continue;
      let wdh = 1;
      while (start + (wdh + 1) * laenge <= norm.length
        && norm.slice(start + wdh * laenge, start + (wdh + 1) * laenge).every((t, i) => t === block[i])) wdh += 1;
      if (wdh >= 2 && (!beste || laenge * wdh > beste.laenge * beste.wdh)) beste = { start, laenge, wdh };
    }
  }
  return beste;
};

const gruppenAufteilen = (titel, datenzeilen) => {
  const g = gruppeFinden(titel);
  if (!g) return { titel, datenzeilen, gruppen: 1 };
  const ende = g.start + g.laenge * g.wdh;
  const vor = [...Array(g.start).keys()];
  const nach = [...Array(Math.max(0, titel.length - ende)).keys()].map((i) => ende + i);
  const neueTitel = [
    ...vor.map((i) => titel[i]),
    ...titel.slice(g.start, g.start + g.laenge).map((t) => text(t).replace(/^\s*\d+\.\s*/, '')),
    ...nach.map((i) => titel[i]),
  ];
  const zeilen = [];
  datenzeilen.forEach((z) => {
    const teile = [];
    for (let k = 0; k < g.wdh; k += 1) {
      const block = z.slice(g.start + k * g.laenge, g.start + (k + 1) * g.laenge);
      // Leere Gruppe oder nur ein Vermerk ("Bereitschaft am Kongress") ist keine Fahrt.
      if (block.slice(1).every((w) => !text(w))) continue;
      teile.push(block);
    }
    if (!teile.length) { zeilen.push([...vor.map((i) => z[i]), ...Array(g.laenge).fill(''), ...nach.map((i) => z[i])]); return; }
    teile.forEach((block) => zeilen.push([...vor.map((i) => z[i]), ...block, ...nach.map((i) => z[i])]));
  });
  return { titel: neueTitel, datenzeilen: zeilen, gruppen: g.wdh };
};

// Tabelle in Kopf und Datenzeilen zerlegen. Datenzeilen behalten auch Zeilen mit nur einer
// Zelle (Folgezeilen mit weiterem Gast, Zwischenzeilen mit Datum).
export const tabelleZerlegen = (rohzeilen) => {
  const zeilen = (rohzeilen || []).filter((z) => Array.isArray(z) && z.some((w) => text(w)));
  if (!zeilen.length) return { kopfzeile: -1, titel: [], datenzeilen: [] };
  const kopf = kopfzeileFinden(zeilen);
  const breite = Math.max(...zeilen.map((z) => z.length));
  const titel = Array.from({ length: breite }, (_, i) => (kopf >= 0 ? text(zeilen[kopf][i]) : ''));
  // Summenzeilen am Ende ("Gesamt", "Total") gehoeren nicht zu den Daten.
  // Weitere Kopfzeilen mitten in der Tabelle (zweite Teiltabelle) auch nicht.
  const kopfWorte = new Set(titel.map(ohneOrdnung).filter(Boolean));
  const datenzeilen = zeilen.slice(kopf + 1)
    .filter((z) => !/^(gesamt|summe|total|sum)\b/i.test(text(z.find((w) => text(w)))))
    .filter((z) => {
      const zellen = z.map(ohneOrdnung).filter(Boolean);
      return !(zellen.length >= 3 && zellen.filter((t) => kopfWorte.has(t)).length >= zellen.length * 0.5);
    });
  return { kopfzeile: kopf, ...gruppenAufteilen(titel, datenzeilen) };
};

const NIE_ZUORDNEN = new Set(['nr', 'no', 'nummer', 'lfd nr', 'lfd', 'pos', 'position', 'id', 'zeile', 'row', 'fahrt nr', 'status']);

// Liefert die Spalten mit Beispielwerten, Vorschlag, Sicherheit und Begruendung.
// vorlage: { "<Ueberschrift normalisiert>": "<Feld>" } aus einem frueheren Import.
export const spaltenErkennen = (rohzeilen, modus = 'rides', { vorlage = null } = {}) => {
  const { kopfzeile, titel, datenzeilen, gruppen } = tabelleZerlegen(rohzeilen);
  if (!datenzeilen.length) return { spalten: [], datenzeilen: [], kopfzeile, signatur: '' };

  const breiteDaten = datenzeilen.filter((z) => gefuellt(z) >= 2);
  const spalten = titel.map((t, index) => {
    const beispiele = (breiteDaten.length ? breiteDaten : datenzeilen).map((z) => text(z[index])).filter(Boolean).slice(0, 40);
    return { index, titel: t || `Spalte ${index + 1}`, ohneTitel: !t, beispiele: beispiele.slice(0, 40) };
  }).filter((s) => s.beispiele.length > 0);

  const felder = felderFuer(modus);
  const signatur = kopfSignatur(spalten);

  // Vorlage: genau diese Ueberschriften wurden schon einmal geprueft und importiert.
  if (vorlage && typeof vorlage === 'object') {
    const ergebnis = spalten.map((spalte) => {
      const feld = vorlage[schluessel(spalte.titel)];
      return feld && felder.some((f) => f.key === feld)
        ? { ...spalte, vorschlag: feld, sicherheit: 1, grund: { vorlage: true } }
        : { ...spalte, vorschlag: null, sicherheit: 0, grund: { art: 'keinTreffer' } };
    });
    return { spalten: ergebnis, datenzeilen, kopfzeile, signatur, gruppen, ausVorlage: true };
  }

  const kandidaten = [];
  spalten.forEach((spalte) => {
    if (NIE_ZUORDNEN.has(schluessel(spalte.titel))) return;
    felder.forEach((feld, rang) => {
      const k = kopfTreffer(spalte.ohneTitel ? '' : spalte.titel, feld);
      const w = werteTreffer(spalte.beispiele, feld);
      // Ueberschrift wiegt schwerer. Werte bestaetigen oder tragen allein, wenn die
      // Ueberschrift fehlt oder nichtssagend ist.
      let punkte = k.wert * 0.62 + w.wert * 0.5;
      if (k.wert === 0 && !feld.werte.length) punkte = 0;
      // Nur nach Werten (ohne passende Ueberschrift) erst ab drei Beispielen, sonst Zufall.
      if (k.wert === 0 && spalte.beispiele.length < 3) punkte = 0;
      // Widerspruch: Ueberschrift passt, Werte sehen aber nach etwas anderem aus.
      if (k.wert > 0 && feld.werte.length && w.wert < 0.2) punkte *= 0.75;
      if (punkte < 0.34) return;
      kandidaten.push({ spalte, feld, punkte: Math.min(1, punkte), kopf: k, werte: w, rang });
    });
  });

  // Beste Paare zuerst vergeben, jede Spalte und jedes Feld nur einmal.
  kandidaten.sort((a, b) => (b.punkte - a.punkte) || (a.spalte.index - b.spalte.index) || (a.rang - b.rang));
  const vergebenSpalte = new Map();
  const vergebenFeld = new Set();
  kandidaten.forEach((c) => {
    if (vergebenSpalte.has(c.spalte.index)) return;
    const blockiert = [c.feld.key, ...(c.feld.belegt || [])];
    if (blockiert.some((f) => vergebenFeld.has(f))) return;
    // Datum+Uhrzeit in einer Spalte schliesst die Einzelfelder aus und umgekehrt.
    if (felder.some((f) => (f.belegt || []).includes(c.feld.key) && vergebenFeld.has(f.key))) return;
    vergebenSpalte.set(c.spalte.index, c);
    blockiert.forEach((f) => vergebenFeld.add(f));
  });

  const ergebnis = spalten.map((spalte) => {
    const c = vergebenSpalte.get(spalte.index);
    if (!c) return { ...spalte, vorschlag: null, sicherheit: 0, grund: { art: 'keinTreffer' } };
    return {
      ...spalte,
      vorschlag: c.feld.key,
      sicherheit: Math.round(c.punkte * 100) / 100,
      grund: {
        kopf: c.kopf.wert >= 0.55 ? spalte.titel : null,
        werte: c.werte.wert >= 0.5 ? c.werte.art : null,
        anteil: Math.round(c.werte.wert * 100),
      },
    };
  });

  return { spalten: ergebnis, datenzeilen, kopfzeile, signatur, gruppen };
};

// Zuordnung {spaltenIndex: feld} aus dem Erkennungsergebnis.
export const zuordnungAus = (spalten) => Object.fromEntries(spalten.filter((s) => s.vorschlag).map((s) => [s.index, s.vorschlag]));

// Fuer Vorlagen: Zuordnung nach Ueberschrift statt nach Spaltennummer.
export const vorlageAus = (spalten, zuordnung) => Object.fromEntries(
  spalten.filter((s) => !s.ohneTitel && zuordnung[s.index]).map((s) => [schluessel(s.titel), zuordnung[s.index]]),
);

// Fehlende Pflichtfelder, die keiner Spalte zugeordnet sind.
export const fehlendeZuordnung = (zuordnung, modus) => {
  const felder = new Set(Object.values(zuordnung || {}));
  if (modus === 'guests') return felder.has('vollname') || felder.has('vorname') || felder.has('nachname') ? [] : ['name'];
  const fehlt = [];
  if (!felder.has('datumUhrzeit') && !felder.has('datum')) fehlt.push('datum');
  if (!felder.has('datumUhrzeit') && !felder.has('uhrzeit')) fehlt.push('uhrzeit');
  if (!felder.has('abholort')) fehlt.push('abholort');
  if (!felder.has('zielort')) fehlt.push('zielort');
  return fehlt;
};

// Wie gut passt ein Tabellenblatt? Zaehlt die vollstaendigen Fahrten bzw. Fahrgaeste, die daraus
// entstehen (mit Datum und Ziel aus dem Dateikopf), bei Gleichstand die Sicherheit der Zuordnung.
export const blattBewerten = (blaetter, index, modus) => {
  const e = spaltenErkennen(blaetter[index].zeilen, modus);
  if (!e.spalten.length) return 0;
  const zuordnung = zuordnungAus(e.spalten);
  const kontext = kontextAus(blaetter, index, e.kopfzeile);
  const { datensaetze } = bauen(modus, e.datenzeilen, zuordnung, kontext);
  const vollstaendig = datensaetze.filter((d) => !d.fehlt.length).length;
  const sicherheit = e.spalten.reduce((s, x) => s + (x.sicherheit || 0), 0);
  return vollstaendig * 10 + sicherheit;
};

export const blattWaehlen = (blaetter, modus) => {
  let bestes = 0; let punkte = -1;
  (blaetter || []).forEach((_, i) => {
    const p = blattBewerten(blaetter, i, modus);
    if (p > punkte) { punkte = p; bestes = i; }
  });
  return bestes;
};

// ---------------------------------------------------------------------------
// Datensaetze bauen
// ---------------------------------------------------------------------------

export const ja = (w) => /^(ja|yes|x|true|1|y|✓|✔|wahr)$/i.test(text(w)) || (Number.parseInt(text(w), 10) > 0 && /^\d+$/.test(text(w)));
export const kurzname = (adresse) => text(adresse).split(',')[0] || text(adresse);
const FLUGHAFEN = /(flughafen|airport|terminal|\([A-Z]{3}\)|\bMUC\b|\bFRA\b|\bBER\b|\bHAM\b|\bDUS\b)/i;
// "LH1841", "lh 1841", "EW 7044" in einem Text. Kein "T1" und keine Postleitzahl.
const flugNummerAus = (w) => {
  const m = text(w).toUpperCase().match(/\b([A-Z]{2}|[A-Z]\d|\d[A-Z])\s?(\d{2,4})[A-Z]?\b(?!\.)/);
  // Wochentage ("Mo 12.01.") und Zugarten sind keine Fluggesellschaften.
  if (!m || /^(ICE|IC|EC|RE|RB|MO|DI|MI|DO|FR|SA|SO|TU|WE|TH|SU)$/.test(m[1])) return '';
  return `${m[1]} ${m[2]}`;
};
const STICHWORT = {
  vip: /\bvip\b/i,
  kindersitz: /kindersitz|child ?seat|baby ?seat|babyschale|booster|sitzerh(ö|oe)hung/i,
  rollstuhl: /rollstuhl|wheelchair|barrierefrei|rollator/i,
  gepaeck: /gep(ä|ae)ck|koffer|luggage|baggage|sperrgep|golfbag|ski/i,
};
const NAMEN_TRENNER = /\s*[,;&/+]\s*|\s+und\s+|\s+and\s+|\n/i;

const namenTeilen = (gaesteText) => {
  const t = text(gaesteText);
  if (!t) return [];
  // "Mueller, Hans" ist ein Name (Nachname, Vorname), keine zwei.
  if (/^[A-ZÄÖÜ][a-zäöüß'-]+,\s*[A-ZÄÖÜ][a-zäöüß'-]+$/.test(t)) {
    const [nach, vor] = t.split(/,\s*/);
    return [`${vor} ${nach}`];
  }
  const teile = t.split(/\s*[,;&/+]\s*|\n/).map((n) => n.trim()).filter(Boolean);
  const namen = [];
  teile.forEach((teil) => {
    // "Philipp und Tina Zimmermann": beide heissen Zimmermann.
    const paar = teil.split(/\s+(?:und|and)\s+/i).map((n) => n.trim()).filter(Boolean);
    if (paar.length === 2 && !/\s/.test(paar[0]) && /\s/.test(paar[1])) {
      const nachname = paar[1].split(/\s+/).pop();
      namen.push(`${paar[0]} ${nachname}`, paar[1]);
    } else namen.push(...paar);
  });
  return namen;
};

// ---------------------------------------------------------------------------
// Kontext aus der ganzen Datei
// ---------------------------------------------------------------------------

// Echte Listen schreiben Datum und Ziel oft nur einmal oben hin ("Samstag, 07.11.2026",
// "Ziel: Kongress am Park, ...") oder in ein anderes Blatt. Ortsnamen stehen in einer Zelle
// kurz ("Hotel Maximilian's") und woanders mit Anschrift.
const ZIEL_LABEL = new Set(['ziel', 'zielort', 'zieladresse', 'destination', 'veranstaltungsort', 'veranstaltung', 'location', 'venue', 'event location', 'ort der veranstaltung', 'eventlocation']);
const DATUM_LABEL = new Set(['datum', 'date', 'veranstaltungsdatum', 'event date', 'tag', 'termin']);
const NICHT_DATUM = /(stand|erstellt|gedruckt|version|as of|updated|aktualisiert)\W*$/i;

const datumImText = (t) => {
  // Daten hinter "Stand", "erstellt" usw. sind kein Fahrtdatum.
  const muster = /\d{1,2}\.\d{1,2}\.(\d{2,4})?|\d{4}-\d{2}-\d{2}/g;
  let m;
  while ((m = muster.exec(t))) {
    if (NICHT_DATUM.test(t.slice(Math.max(0, m.index - 20), m.index))) continue;
    const d = datumLesen(m[0].endsWith('.') || /\d{4}$/.test(m[0]) || m[0].includes('-') ? m[0] : `${m[0]}.`);
    if (d) return d;
  }
  return '';
};

export const kontextAus = (blaetter, blattIndex = 0, kopfzeile = -1) => {
  const kontext = { datum: '', datumQuelle: '', ziel: '', orte: {} };
  const blatt = blaetter?.[blattIndex];
  const titelZeilen = (b, bis) => (b?.zeilen || []).slice(0, Math.max(0, bis)).map((z) => z.map(text).filter(Boolean).join(' | '));

  // Datum: Titelzeilen dieses Blatts, dann sein Name, dann die ersten Zeilen der anderen Blaetter.
  const quellen = [
    ...titelZeilen(blatt, kopfzeile >= 0 ? kopfzeile : 3).map((t) => [t, 'titel']),
    [text(blatt?.name), 'blatt'],
    ...(blaetter || []).flatMap((b, i) => (i === blattIndex ? [] : [...titelZeilen(b, 3).map((t) => [t, 'datei']), [text(b.name), 'datei']])),
  ];
  for (const [t, quelle] of quellen) {
    const d = datumImText(t);
    if (d) { kontext.datum = d; kontext.datumQuelle = quelle; break; }
  }

  (blaetter || []).forEach((b) => (b.zeilen || []).forEach((z) => {
    const zellen = z.map(text).filter(Boolean);
    // Schluessel-Wert-Zeilen: "Ziel | Kongress am Park, Goegginger Str. 10, 86159 Augsburg"
    if (zellen.length === 2) {
      const label = schluessel(zellen[0]).replace(/\s*:$/, '');
      if (!kontext.ziel && ZIEL_LABEL.has(label) && /[a-zäöü]{3}/i.test(zellen[1])) kontext.ziel = zellen[1];
      if (!kontext.datum && DATUM_LABEL.has(label) && datumLesen(zellen[1])) { kontext.datum = datumLesen(zellen[1]); kontext.datumQuelle = 'datei'; }
    }
    // Orte mit Anschrift: "Hotel Maximilian's, Maximilianstr. 40" -> "hotel maximilian s"
    zellen.forEach((zelle) => {
      zelle.split(/\s+und\s+(?=[A-ZÄÖÜ])/).forEach((teil) => {
        const [kurz, ...rest] = teil.split(',').map((x) => x.trim());
        if (!rest.length || !/\d/.test(rest.join(',')) || kurz.length < 3 || kurz.length > 45 || /\d/.test(kurz)) return;
        const k = schluessel(kurz);
        const voll = [kurz, ...rest].filter(Boolean).join(', ').replace(/[\s,]+$/, '');
        if (!kontext.orte[k] || kontext.orte[k].length < voll.length) kontext.orte[k] = voll;
      });
    });
  }));
  return kontext;
};

const heuteIso = () => new Date().toISOString().slice(0, 10);

const adresseVergleich = (a) => schluessel(a).replace(/\b(str|strasse|straße)\b/g, 'str').replace(/\s+/g, ' ');
const fahrtSchluessel = (d) => [d.ride_date, d.etd, adresseVergleich(d.pickup_address), adresseVergleich(d.dropoff_address), d.flight_number || d.train_number || ''].join('#');

// Aus Datenzeilen und Zuordnung Fahrten bauen.
// Rueckgabe: { datensaetze: [{ zeilen: [Zeilennummern], daten, fehlt, hinweise }] }
// Zeilennummern zaehlen ab der ersten Datenzeile (1 = erste Zeile unter der Kopfzeile).
export const fahrtenBauen = (datenzeilen, zuordnung, kontext = null) => {
  const spalteVon = (feld) => {
    const eintrag = Object.entries(zuordnung || {}).find(([, f]) => f === feld);
    return eintrag ? Number(eintrag[0]) : null;
  };
  const wert = (zeile, feld) => {
    const i = spalteVon(feld);
    return i == null ? '' : text(zeile[i]);
  };
  const genutzteSpalten = Object.keys(zuordnung || {}).map(Number);

  const datensaetze = [];
  let tagDerGruppe = '';
  let tagAusDatei = false;
  let letzte = null;
  const nachSchluessel = new Map();

  datenzeilen.forEach((zeile, nr) => {
    const zeilenNr = nr + 1;
    const zellen = zeile.map(text).filter(Boolean);
    if (!zellen.length) { letzte = null; return; }

    // Zwischenzeile mit nur einem Datum ("Montag, 12.10.2026"): gilt fuer die folgenden Fahrten.
    if (zellen.length === 1 && datumLesen(zellen[0]) && !uhrzeitLesen(ohneDatum(zellen[0]))) {
      tagDerGruppe = datumLesen(zellen[0]);
      letzte = null;
      return;
    }

    const kombi = wert(zeile, 'datumUhrzeit');
    let datum = datumLesen(kombi) || datumLesen(wert(zeile, 'datum'));
    const uhrzeit = (kombi ? uhrzeitLesen(ohneDatum(kombi)) : '') || uhrzeitLesen(wert(zeile, 'uhrzeit'));
    // Kurzname, der woanders in der Datei mit Anschrift steht, bekommt die Anschrift.
    const ergaenzt = (ort) => (ort && !ort.includes(',') && kontext?.orte?.[schluessel(ort)]) || ort;
    const abholort = ergaenzt(wert(zeile, 'abholort'));
    let zielort = ergaenzt(wert(zeile, 'zielort'));
    // Keine Zielspalte, aber die Datei nennt ein Ziel ("Ziel: Kongress am Park, ...").
    const zielAusDatei = !zielort && spalteVon('zielort') == null && kontext?.ziel;
    if (zielAusDatei) zielort = kontext.ziel;
    const flugOderZug = wert(zeile, 'flugnummer');
    const zug = wert(zeile, 'zugnummer') || (MUSTER.zug(flugOderZug) ? flugOderZug : '');
    let flug = MUSTER.zug(flugOderZug) ? '' : flugNummerAus(flugOderZug) || flugOderZug.toUpperCase();
    // Keine Flugspalte, aber Flughafenfahrt: Flugnummer aus den uebrigen Zellen ("MUC T1 / LH1841").
    if (!flug && (FLUGHAFEN.test(abholort) || FLUGHAFEN.test(zielort))) {
      flug = [abholort, zielort, wert(zeile, 'notiz')].map((z) => flugNummerAus(z)).find(Boolean) || '';
    }
    let gaesteRoh = wert(zeile, 'gaeste');
    // "Baker Tilly: Dr. Thomas Gemmeke, Tanja Wuzik": vor dem Doppelpunkt die Firma.
    const firmaVorn = gaesteRoh.match(/^([^:]{2,60}):\s*(.+)$/);
    if (firmaVorn) gaesteRoh = firmaVorn[2];
    const inKlammern = gaesteRoh.match(/\((\d{1,2})\s*(?:pers\.?|personen|pax|p)?\)/i);
    const gaeste = namenTeilen(gaesteRoh.replace(/\(\d{1,2}[^)]*\)/g, ''));
    let anzahl = Number.parseInt(wert(zeile, 'anzahl'), 10);
    if (!Number.isFinite(anzahl) && inKlammern) anzahl = Number(inKlammern[1]);
    const hinweise = [];

    // Folgezeile: nur weitere Gaeste (oder Notiz) ohne eigene Fahrtangaben. Gehoert zur Fahrt darueber.
    const eigeneAngaben = datum || uhrzeit || abholort || (!zielAusDatei && zielort) || flug || zug;
    if (!eigeneAngaben && letzte && (gaeste.length || wert(zeile, 'notiz'))) {
      letzte.daten.passengers.push(...gaeste.filter((g) => !letzte.daten.passengers.includes(g)));
      if (wert(zeile, 'notiz')) letzte.daten.note = [letzte.daten.note, wert(zeile, 'notiz')].filter(Boolean).join(' · ');
      letzte.zeilen.push(zeilenNr);
      if (!letzte.hinweise.includes('mehrereZeilen')) letzte.hinweise.push('mehrereZeilen');
      return;
    }
    // Zeilen ohne irgendeine zugeordnete Angabe (z. B. Leerzeilen mit Formatierung) ueberspringen.
    if (!genutzteSpalten.some((i) => text(zeile[i]))) { letzte = null; return; }

    if (!datum && tagDerGruppe) { datum = tagDerGruppe; hinweise.push(tagAusDatei ? 'datumAusDatei' : 'datumUebernommen'); }
    if (zielAusDatei) hinweise.push('zielAusDatei');
    // Datum nur in der ersten Zeile eines Tages: von der Fahrt darueber uebernehmen.
    if (!datum && uhrzeit && letzte?.daten.ride_date) { datum = letzte.daten.ride_date; hinweise.push(tagAusDatei ? 'datumAusDatei' : 'datumUebernommen'); }
    // Kein Datum in der Tabelle: das Datum aus dem Kopf der Datei ("Samstag, 07.11.2026").
    if (!datum && !tagDerGruppe && kontext?.datum) { datum = kontext.datum; hinweise.push('datumAusDatei'); tagAusDatei = true; }
    else if (datum && datum !== tagDerGruppe && !hinweise.includes('datumAusDatei')) tagAusDatei = false;
    if (datum) tagDerGruppe = datum;

    const notiz = [
      (wert(zeile, 'firma') || firmaVorn?.[1]) && `Firma: ${wert(zeile, 'firma') || firmaVorn[1].trim()}`,
      wert(zeile, 'telefon') && `Tel. ${wert(zeile, 'telefon')}`,
      wert(zeile, 'notiz'),
    ].filter(Boolean).join(' · ');
    // Ja/Nein-Spalten: Ja-Woerter oder das Stichwort selbst ("Kindersitz x2"). Stichworte in der
    // Bemerkung zaehlen auch ("bitte Kindersitz").
    const flag = (feld) => ja(wert(zeile, feld)) || STICHWORT[feld].test(wert(zeile, feld)) || STICHWORT[feld].test(notiz);
    const daten = {
      ride_date: datum || null,
      etd: uhrzeit ? `${uhrzeit}:00` : null,
      original_etd: uhrzeit ? `${uhrzeit}:00` : null,
      pickup_name: kurzname(abholort) || null,
      pickup_address: abholort || null,
      dropoff_name: kurzname(zielort) || null,
      dropoff_address: zielort || null,
      flight_number: flug || null,
      flight_origin: wert(zeile, 'herkunft') || null,
      train_number: zug || null,
      passengers: gaeste,
      anzahl: Number.isFinite(anzahl) ? anzahl : null,
      is_vip: flag('vip'),
      needs_child_seat: flag('kindersitz'),
      needs_accessibility: flag('rollstuhl'),
      needs_luggage: flag('gepaeck'),
      note: notiz || null,
    };

    // Gleiche Fahrt in mehreren Zeilen (ein Gast je Zeile): zusammenfassen.
    const sch = fahrtSchluessel(daten);
    // Nur bei Namen (ein Gast je Zeile). Gleiche Fahrt ohne Namen in zwei Zeilen sind zwei Fahrzeuge.
    const gleiche = datum && uhrzeit && (abholort || zielort) && gaeste.length ? nachSchluessel.get(sch) : null;
    if (gleiche) {
      gleiche.daten.passengers.push(...gaeste.filter((g) => !gleiche.daten.passengers.includes(g)));
      if (daten.anzahl && (!gleiche.daten.anzahl || gleiche.daten.anzahl < daten.anzahl)) gleiche.daten.anzahl = daten.anzahl;
      ['is_vip', 'needs_child_seat', 'needs_accessibility', 'needs_luggage'].forEach((k) => { gleiche.daten[k] = gleiche.daten[k] || daten[k]; });
      if (daten.note && !String(gleiche.daten.note || '').includes(daten.note)) gleiche.daten.note = [gleiche.daten.note, daten.note].filter(Boolean).join(' · ');
      gleiche.zeilen.push(zeilenNr);
      if (!gleiche.hinweise.includes('mehrereZeilen')) gleiche.hinweise.push('mehrereZeilen');
      letzte = gleiche;
      return;
    }

    const satz = { zeilen: [zeilenNr], daten, fehlt: [], hinweise };
    datensaetze.push(satz);
    if (datum && uhrzeit) nachSchluessel.set(sch, satz);
    letzte = satz;
  });

  datensaetze.forEach(fahrtPruefen);
  return { datensaetze };
};

// Pflichtangaben und Auffaelligkeiten einer Fahrt (auch nach Bearbeitung in der Vorschau).
export const fahrtPruefen = (satz) => {
  const d = satz.daten;
  satz.fehlt = [];
  if (!d.ride_date) satz.fehlt.push('datum');
  if (!d.etd) satz.fehlt.push('uhrzeit');
  if (!text(d.pickup_address)) satz.fehlt.push('abholort');
  if (!text(d.dropoff_address)) satz.fehlt.push('zielort');
  const behalten = (satz.hinweise || []).filter((h) => ['mehrereZeilen', 'datumUebernommen', 'datumAusDatei', 'zielAusDatei', 'llama', 'doppelt', 'adresseUnbekannt'].includes(h));
  if (d.ride_date && d.ride_date < heuteIso()) behalten.push('vergangen');
  if (d.anzahl && d.passengers.length > d.anzahl) behalten.push('mehrNamenAlsPersonen');
  if (d.pickup_address && d.dropoff_address && adresseVergleich(d.pickup_address) === adresseVergleich(d.dropoff_address)) behalten.push('gleicheAdresse');
  satz.hinweise = [...new Set(behalten)];
  return satz;
};

// Fahrt so, wie sie in die Tabelle jobs geht (ohne note und anzahl, die gehen anders).
export const fahrtZeile = (daten) => {
  const d = { ...daten };
  const gaeste = (d.passengers || []).map(text).filter(Boolean);
  const anzahl = Number(d.anzahl) || 0;
  const zeile = {
    ride_date: d.ride_date,
    etd: d.etd,
    original_etd: d.original_etd || d.etd,
    pickup_name: text(d.pickup_name) || kurzname(d.pickup_address) || null,
    pickup_address: text(d.pickup_address) || null,
    dropoff_name: text(d.dropoff_name) || kurzname(d.dropoff_address) || null,
    dropoff_address: text(d.dropoff_address) || null,
    flight_number: text(d.flight_number) || null,
    flight_origin: text(d.flight_origin) || null,
    train_number: text(d.train_number) || null,
    passengers: gaeste,
    // jobs kennt keine Gesamtzahl: wer ueber die Namen hinaus mitfaehrt, zaehlt als anonymer Gast.
    anonymous_guests: Math.max(0, anzahl - gaeste.length),
    trip_type: d.flight_number || FLUGHAFEN.test(d.pickup_address || '') || FLUGHAFEN.test(d.dropoff_address || '') ? 'airport' : 'normal',
    is_vip: Boolean(d.is_vip),
    needs_child_seat: Boolean(d.needs_child_seat),
    needs_accessibility: Boolean(d.needs_accessibility),
    needs_luggage: Boolean(d.needs_luggage),
    status: 'pending',
    driver_response_status: 'pending',
  };
  return zeile;
};

export const gaesteBauen = (datenzeilen, zuordnung) => {
  const spalteVon = (feld) => {
    const eintrag = Object.entries(zuordnung || {}).find(([, f]) => f === feld);
    return eintrag ? Number(eintrag[0]) : null;
  };
  const wert = (zeile, feld) => {
    const i = spalteVon(feld);
    return i == null ? '' : text(zeile[i]);
  };
  const datensaetze = [];
  const gesehen = new Map();
  datenzeilen.forEach((zeile, nr) => {
    if (gefuellt(zeile) === 0) return;
    let vorname = wert(zeile, 'vorname');
    let nachname = wert(zeile, 'nachname');
    const voll = wert(zeile, 'vollname').replace(/^(herr|frau|mr|mrs|ms|dr|prof)\.?\s+/i, '');
    if (voll && !vorname && !nachname) {
      const teile = voll.includes(',') ? voll.split(',').map((s) => s.trim()).reverse() : voll.split(/\s+/);
      nachname = teile.length > 1 ? teile[teile.length - 1] : teile[0];
      vorname = teile.length > 1 ? teile.slice(0, -1).join(' ') : '';
    }
    const daten = {
      first_name: vorname,
      last_name: nachname,
      email: wert(zeile, 'email') || null,
      phone: wert(zeile, 'telefon') || null,
      company: wert(zeile, 'firma') || null,
      street: wert(zeile, 'strasse') || null,
      zip: wert(zeile, 'plz') || null,
      city: wert(zeile, 'stadt') || null,
      language: wert(zeile, 'sprache') || 'Deutsch',
      notes: wert(zeile, 'notiz') || null,
      is_vip: ja(wert(zeile, 'vip')),
      vip_status: ja(wert(zeile, 'vip')),
    };
    if (!vorname && !nachname && !daten.email) return;
    const sch = `${schluessel(vorname)}|${schluessel(nachname)}|${schluessel(daten.email)}`;
    if (gesehen.has(sch)) { gesehen.get(sch).zeilen.push(nr + 1); return; }
    const satz = { zeilen: [nr + 1], daten, fehlt: [], hinweise: [] };
    gastPruefen(satz);
    gesehen.set(sch, satz);
    datensaetze.push(satz);
  });
  return { datensaetze };
};

export const gastPruefen = (satz) => {
  const d = satz.daten;
  satz.fehlt = !text(d.first_name) && !text(d.last_name) ? ['name'] : [];
  const behalten = (satz.hinweise || []).filter((h) => ['doppelt', 'llama'].includes(h));
  if (d.email && !MUSTER.email(d.email)) behalten.push('emailUngueltig');
  satz.hinweise = [...new Set(behalten)];
  return satz;
};

export const bauen = (modus, datenzeilen, zuordnung, kontext = null) => (modus === 'guests' ? gaesteBauen(datenzeilen, zuordnung) : fahrtenBauen(datenzeilen, zuordnung, kontext));
export const pruefen = (modus, satz) => (modus === 'guests' ? gastPruefen(satz) : fahrtPruefen(satz));
