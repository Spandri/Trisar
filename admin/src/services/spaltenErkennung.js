// Spalten einer beliebigen Tabelle erkennen und auf Fahrten bzw. Fahrgäste
// abbilden. Es gibt kein festes Schema: jede Spalte wird nach zwei Merkmalen
// bewertet — was in der Überschrift steht und wie die Werte darunter aussehen
// (Uhrzeiten, Flugnummern, Orte, Namen, Ja/Nein …). Daraus entsteht ein
// Vorschlag mit Sicherheit und Begründung, den die Disposition prüft und
// ändern kann, bevor importiert wird.
//
// In der Demo läuft die Erkennung vollständig im Browser; die Datei verlässt
// das Gerät nicht.

import * as XLSX from 'xlsx';

const text = (wert) => {
  if (wert instanceof Date && !Number.isNaN(wert.getTime())) {
    const p = (n) => String(n).padStart(2, '0');
    return `${wert.getFullYear()}-${p(wert.getMonth() + 1)}-${p(wert.getDate())} ${p(wert.getHours())}:${p(wert.getMinutes())}`;
  }
  return String(wert ?? '').trim();
};
const schluessel = (wert) => text(wert).toLowerCase().replace(/[^a-z0-9äöüß]+/g, ' ').trim();

// ---------------------------------------------------------------------------
// Datei lesen
// ---------------------------------------------------------------------------

const trennzeichen = (inhalt) => {
  const zeilen = String(inhalt || '').split(/\r?\n/).filter((z) => z.trim()).slice(0, 6);
  const zaehle = (sep) => zeilen.reduce((summe, z) => summe + (z.split(sep).length - 1), 0);
  const [bestes] = [';', ',', '\t', '|'].map((sep) => [sep, zaehle(sep)]).sort((a, b) => b[1] - a[1]);
  return bestes[1] > 0 ? bestes[0] : ';';
};

const zeilenAusMappe = (mappe) => {
  const blatt = mappe.SheetNames[0];
  if (!blatt) return [];
  return XLSX.utils.sheet_to_json(mappe.Sheets[blatt], { header: 1, blankrows: false, defval: '', raw: false });
};

export const tabelleAusText = (inhalt) => {
  const sauber = String(inhalt || '').replace(/^﻿/, '');
  // raw: Werte so lassen, wie sie in der Datei stehen — sonst schreibt die
  // Bibliothek Datumsangaben ins amerikanische Format um (9/5/26).
  return zeilenAusMappe(XLSX.read(sauber, { type: 'string', raw: true, FS: trennzeichen(sauber) }));
};

export const tabelleLesen = async (datei) => {
  const name = String(datei?.name || '').toLowerCase();
  const istText = /\.(csv|txt|tsv)$/.test(name) || /csv|text\/plain/.test(String(datei?.type || ''));
  if (istText) return tabelleAusText(await datei.text());
  const puffer = await datei.arrayBuffer();
  return zeilenAusMappe(XLSX.read(puffer, { type: 'array', cellDates: true, raw: false }));
};

// ---------------------------------------------------------------------------
// Werte erkennen
// ---------------------------------------------------------------------------

const MONATE = {
  jan: 1, januar: 1, january: 1, feb: 2, februar: 2, february: 2, mär: 3, mar: 3, märz: 3, maerz: 3, march: 3,
  apr: 4, april: 4, mai: 5, may: 5, jun: 6, juni: 6, june: 6, jul: 7, juli: 7, july: 7, aug: 8, august: 8,
  sep: 9, sept: 9, september: 9, okt: 10, oct: 10, oktober: 10, october: 10, nov: 11, november: 11,
  dez: 12, dec: 12, dezember: 12, december: 12,
};

const p2 = (n) => String(n).padStart(2, '0');
const jahr4 = (j) => (String(j).length === 2 ? `20${j}` : String(j));

export const datumLesen = (wert) => {
  const t = text(wert);
  if (!t) return '';
  let m = t.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${p2(m[2])}-${p2(m[3])}`;
  m = t.match(/(\d{1,2})\.(\d{1,2})\.(\d{2,4})/);
  if (m) return `${jahr4(m[3])}-${p2(m[2])}-${p2(m[1])}`;
  // 16/08/2026 (europäisch) — bei Werten über 12 im zweiten Feld amerikanisch
  m = t.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (m) {
    const a = Number(m[1]); const b = Number(m[2]);
    const [tag, monat] = b > 12 ? [b, a] : [a, b];
    return `${jahr4(m[3])}-${p2(monat)}-${p2(tag)}`;
  }
  m = t.toLowerCase().match(/(\d{1,2})\.?\s+([a-zäöü]{3,9})\.?\s+(\d{2,4})/);
  if (m && MONATE[m[2]]) return `${jahr4(m[3])}-${p2(MONATE[m[2]])}-${p2(m[1])}`;
  return '';
};

export const uhrzeitLesen = (wert) => {
  const t = text(wert);
  const m = t.match(/(?:^|[^\d.])(\d{1,2})[:.h](\d{2})(?:\s*(am|pm))?(?!\d)/i) || t.match(/^(\d{1,2})[:.](\d{2})/);
  if (!m) return '';
  let std = Number(m[1]);
  const min = Number(m[2]);
  const halb = (m[3] || '').toLowerCase();
  if (halb === 'pm' && std < 12) std += 12;
  if (halb === 'am' && std === 12) std = 0;
  if (std > 23 || min > 59) return '';
  return `${p2(std)}:${p2(min)}`;
};

const MUSTER = {
  datum: (t) => Boolean(datumLesen(t)) && !/\d{1,2}[:.]\d{2}\s*(uhr|am|pm)?$/i.test(t.replace(/^\S+\s*/, '').trim() || 'x'),
  uhrzeit: (t) => /^\s*\d{1,2}[:.h]\d{2}(\s*(uhr|am|pm))?\s*$/i.test(t),
  datumUhrzeit: (t) => Boolean(datumLesen(t)) && Boolean(uhrzeitLesen(t.replace(/\d{1,2}\.\d{1,2}\.\d{2,4}|\d{4}-\d{1,2}-\d{1,2}/, ''))),
  flug: (t) => /^[A-Z][A-Z0-9]\s?\d{2,4}[A-Z]?$/.test(t.toUpperCase().trim()) && !/^(ICE|IC|EC|RJ|TGV|RE|RB)\s?\d/i.test(t),
  zug: (t) => /^(ICE|IC|EC|RJ|RJX|TGV|RE|RB|NJ|FLX)\s?\d{1,5}$/i.test(t.trim()),
  flughafenCode: (t) => /\(([A-Z]{3})\)|^[A-Z]{3}$/.test(t.trim()),
  ort: (t) => /(stra(ß|ss)e|str\.|platz|weg|allee|ring|gasse|damm|ufer|road|street|avenue|hotel|flughafen|airport|terminal|bahnhof|hbf|messe|zentrum|center)/i.test(t)
    || /\b\d{5}\b/.test(t) || /\b[A-ZÄÖÜ][a-zäöüß]+\s\d{1,4}[a-z]?\b/.test(t),
  name: (t) => /^([A-ZÄÖÜ][a-zäöüß'-]+\.?\s){1,3}[A-ZÄÖÜ][a-zäöüß'-]+(\s*[,;&/]\s*([A-ZÄÖÜ][a-zäöüß'-]+\.?\s){1,3}[A-ZÄÖÜ][a-zäöüß'-]+)*$/.test(t.replace(/^(herr|frau|mr|mrs|ms|dr)\.?\s+/i, '').trim()),
  anzahl: (t) => /^\d{1,2}$/.test(t.trim()) && Number(t) >= 1 && Number(t) <= 30,
  janein: (t) => /^(ja|nein|yes|no|x|true|false|1|0|y|n|✓|✔)$/i.test(t.trim()),
  email: (t) => /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(t.trim()),
  telefon: (t) => /^\+?[\d\s()/-]{7,}$/.test(t.trim()) && (t.match(/\d/g) || []).length >= 7,
  plz: (t) => /^\d{4,5}$/.test(t.trim()),
  freitext: (t) => t.trim().split(/\s+/).length >= 4,
};

const anteil = (werte, pruefung) => {
  if (!werte.length) return 0;
  return werte.filter((w) => pruefung(w)).length / werte.length;
};

// ---------------------------------------------------------------------------
// Zielfelder
// ---------------------------------------------------------------------------

// kopf: Wörter, die in der Überschrift auf das Feld hindeuten (deutsch,
// englisch, typische Kürzel). werte: welche Muster die Werte haben sollten.
const FAHRT_FELDER = [
  { key: 'datumUhrzeit', kopf: ['datum uhrzeit', 'datum zeit', 'termin', 'date time', 'datetime', 'zeitpunkt', 'pickup datetime', 'abholung am'], werte: ['datumUhrzeit'], belegt: ['datum', 'uhrzeit'] },
  { key: 'datum', kopf: ['datum', 'date', 'tag', 'day', 'service date', 'fahrtdatum', 'transferdatum', 'ankunftstag', 'arrival date'], werte: ['datum'] },
  { key: 'uhrzeit', kopf: ['uhrzeit', 'zeit', 'time', 'abholzeit', 'pick up time', 'pickup time', 'etd', 'abfahrt', 'um', 'start time'], werte: ['uhrzeit'] },
  { key: 'abholort', kopf: ['abholort', 'abholung', 'abholadresse', 'von', 'start', 'startadresse', 'pick up location', 'pickup location', 'pick up', 'pickup', 'from address', 'origin address', 'treffpunkt'], werte: ['ort'] },
  { key: 'zielort', kopf: ['zielort', 'ziel', 'zieladresse', 'nach', 'bis', 'drop off', 'dropoff', 'drop off location', 'destination', 'to address', 'hotel'], werte: ['ort'] },
  { key: 'flugnummer', kopf: ['flug', 'flugnummer', 'flight', 'flight no', 'flight number', 'flightnumber', 'arrival flight', 'zug flug', 'flug zug'], werte: ['flug', 'zug'] },
  { key: 'zugnummer', kopf: ['zug', 'zugnummer', 'train', 'train number'], werte: ['zug'] },
  { key: 'herkunft', kopf: ['herkunft', 'abflugort', 'aus', 'arriving from', 'from', 'origin', 'kommt aus', 'abflughafen'], werte: ['flughafenCode'] },
  { key: 'gaeste', kopf: ['gast', 'gäste', 'gaeste', 'fahrgast', 'fahrgäste', 'passagier', 'passagiere', 'guest', 'guest name', 'guests', 'passenger', 'passengers', 'name', 'kunde', 'reisender'], werte: ['name'] },
  { key: 'anzahl', kopf: ['anzahl', 'anz', 'personen', 'pax', 'persons', 'people', 'teilnehmer', 'number of guests'], werte: ['anzahl'] },
  { key: 'vip', kopf: ['vip'], werte: ['janein'] },
  { key: 'kindersitz', kopf: ['kindersitz', 'child seat', 'kindersitze', 'baby seat'], werte: ['janein'] },
  { key: 'rollstuhl', kopf: ['rollstuhl', 'barrierefrei', 'wheelchair', 'rollstuhlgerecht', 'accessibility'], werte: ['janein'] },
  { key: 'gepaeck', kopf: ['gepäck', 'gepaeck', 'koffer', 'luggage', 'baggage', 'sondergepäck'], werte: ['janein', 'anzahl'] },
  { key: 'notiz', kopf: ['notiz', 'notizen', 'bemerkung', 'bemerkungen', 'hinweis', 'hinweise', 'kommentar', 'note', 'notes', 'remarks', 'comment', 'comments', 'info'], werte: ['freitext'] },
];

const GAST_FELDER = [
  { key: 'vorname', kopf: ['vorname', 'first name', 'firstname', 'given name'], werte: ['name'] },
  { key: 'nachname', kopf: ['nachname', 'familienname', 'last name', 'lastname', 'surname'], werte: ['name'] },
  { key: 'vollname', kopf: ['name', 'gast', 'kunde', 'guest', 'guest name', 'full name', 'fahrgast'], werte: ['name'], belegt: ['vorname', 'nachname'] },
  { key: 'email', kopf: ['email', 'e mail', 'mail', 'e mail adresse'], werte: ['email'] },
  { key: 'telefon', kopf: ['telefon', 'tel', 'phone', 'mobil', 'handy', 'mobile'], werte: ['telefon'] },
  { key: 'firma', kopf: ['firma', 'unternehmen', 'company', 'organisation', 'organization'], werte: [] },
  { key: 'strasse', kopf: ['straße', 'strasse', 'str', 'street', 'adresse', 'address'], werte: ['ort'] },
  { key: 'plz', kopf: ['plz', 'postleitzahl', 'zip', 'postcode', 'postal code'], werte: ['plz'] },
  { key: 'stadt', kopf: ['stadt', 'ort', 'city', 'town'], werte: [] },
  { key: 'sprache', kopf: ['sprache', 'language', 'lang'], werte: [] },
  { key: 'vip', kopf: ['vip'], werte: ['janein'] },
  { key: 'notiz', kopf: ['notiz', 'bemerkung', 'hinweis', 'note', 'notes', 'remarks'], werte: ['freitext'] },
];

export const felderFuer = (modus) => (modus === 'guests' ? GAST_FELDER : FAHRT_FELDER);

// ---------------------------------------------------------------------------
// Kopfzeile finden
// ---------------------------------------------------------------------------

const siehtAusWieDaten = (t) => MUSTER.uhrzeit(t) || Boolean(datumLesen(t)) || /^\d+([.,]\d+)?$/.test(t) || MUSTER.flug(t);

const kopfzeileFinden = (zeilen) => {
  const gefuellt = (z) => z.filter((w) => text(w)).length;
  const maxBreite = Math.max(0, ...zeilen.slice(0, 15).map(gefuellt));
  for (let i = 0; i < Math.min(zeilen.length - 1, 12); i += 1) {
    const z = zeilen[i];
    const n = gefuellt(z);
    if (n < 2 || n < maxBreite * 0.6) continue;
    const zellen = z.map(text).filter(Boolean);
    const datenhaft = zellen.filter(siehtAusWieDaten).length;
    const kurz = zellen.filter((w) => w.length <= 40).length;
    if (datenhaft === 0 && kurz === zellen.length) return i;
    // Erste Zeile sieht bereits wie Daten aus: es gibt keine Kopfzeile.
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
    else if (bester.wert < 0.8 && (` ${k} `).includes(` ${wort} `)) bester = { wert: 0.8, wort };
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

// Liefert die Spalten mit Beispielwerten, Vorschlag, Sicherheit und Begründung.
export const spaltenErkennen = (rohzeilen, modus = 'rides') => {
  const zeilen = (rohzeilen || []).filter((z) => Array.isArray(z) && z.some((w) => text(w)));
  if (!zeilen.length) return { spalten: [], datenzeilen: [], kopfzeile: -1 };

  const kopf = kopfzeileFinden(zeilen);
  const breite = Math.max(...zeilen.map((z) => z.length));
  const titel = Array.from({ length: breite }, (_, i) => (kopf >= 0 ? text(zeilen[kopf][i]) : ''));
  const datenzeilen = zeilen.slice(kopf + 1).filter((z) => z.filter((w) => text(w)).length >= 2);

  const spalten = titel.map((t, index) => {
    const beispiele = datenzeilen.map((z) => text(z[index])).filter(Boolean).slice(0, 30);
    return { index, titel: t || `Spalte ${index + 1}`, ohneTitel: !t, beispiele };
  }).filter((s) => s.beispiele.length > 0);

  const felder = felderFuer(modus);
  const kandidaten = [];
  spalten.forEach((spalte) => {
    felder.forEach((feld, rang) => {
      const k = kopfTreffer(spalte.ohneTitel ? '' : spalte.titel, feld);
      const w = werteTreffer(spalte.beispiele, feld);
      // Überschrift wiegt schwerer; Werte bestätigen oder tragen allein, wenn
      // die Überschrift fehlt oder nichtssagend ist.
      let punkte = k.wert * 0.62 + w.wert * 0.5;
      if (k.wert === 0 && !feld.werte.length) punkte = 0;
      // Widerspruch: Überschrift passt, Werte sehen aber nach etwas anderem aus.
      if (k.wert > 0 && feld.werte.length && w.wert < 0.2) punkte *= 0.75;
      if (punkte < 0.34) return;
      kandidaten.push({ spalte, feld, punkte: Math.min(1, punkte), kopf: k, werte: w, rang });
    });
  });

  // Beste Paare zuerst vergeben — jede Spalte und jedes Feld nur einmal.
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

  return { spalten: ergebnis, datenzeilen, kopfzeile: kopf };
};

// ---------------------------------------------------------------------------
// Datensätze bauen
// ---------------------------------------------------------------------------

const ja = (w) => /^(ja|yes|x|true|1|y|✓|✔)$/i.test(text(w));
const kurzname = (adresse) => text(adresse).split(',')[0] || text(adresse);
const FLUGHAFEN = /(flughafen|airport|terminal|\([A-Z]{3}\)|\bMUC\b|\bFRA\b|\bBER\b)/i;

export const fahrtenBauen = (datenzeilen, zuordnung) => {
  const spalteVon = (feld) => {
    const eintrag = Object.entries(zuordnung).find(([, f]) => f === feld);
    return eintrag ? Number(eintrag[0]) : null;
  };
  const wert = (zeile, feld) => {
    const i = spalteVon(feld);
    return i == null ? '' : text(zeile[i]);
  };

  const fertig = [];
  const unvollstaendig = [];
  datenzeilen.forEach((zeile, nr) => {
    const kombi = wert(zeile, 'datumUhrzeit');
    const datum = datumLesen(kombi) || datumLesen(wert(zeile, 'datum'));
    const uhrzeit = (kombi ? uhrzeitLesen(kombi.replace(/\d{1,2}\.\d{1,2}\.\d{2,4}|\d{4}-\d{1,2}-\d{1,2}/, '')) : '') || uhrzeitLesen(wert(zeile, 'uhrzeit'));
    const abholort = wert(zeile, 'abholort');
    const zielort = wert(zeile, 'zielort');
    const flugOderZug = wert(zeile, 'flugnummer');
    const zug = wert(zeile, 'zugnummer') || (MUSTER.zug(flugOderZug) ? flugOderZug : '');
    const flug = MUSTER.zug(flugOderZug) ? '' : flugOderZug.toUpperCase().replace(/^([A-Z0-9]{2})\s?(\d)/, '$1 $2');
    const gaesteText = wert(zeile, 'gaeste');
    const gaeste = gaesteText ? gaesteText.split(/\s*[,;&/]\s*|\s+und\s+|\s+and\s+/i).filter(Boolean) : [];
    const anzahl = Number.parseInt(wert(zeile, 'anzahl'), 10);
    const gepaeck = wert(zeile, 'gepaeck');

    const fehlt = [];
    if (!datum) fehlt.push('datum');
    if (!uhrzeit) fehlt.push('uhrzeit');
    if (!abholort) fehlt.push('abholort');
    if (!zielort) fehlt.push('zielort');

    const datensatz = {
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
      passenger_count: Number.isFinite(anzahl) ? anzahl : (gaeste.length || null),
      trip_type: flug || FLUGHAFEN.test(abholort) || FLUGHAFEN.test(zielort) ? 'airport' : 'normal',
      is_vip: ja(wert(zeile, 'vip')),
      needs_child_seat: ja(wert(zeile, 'kindersitz')),
      needs_accessibility: ja(wert(zeile, 'rollstuhl')),
      needs_luggage: ja(gepaeck) || Number.parseInt(gepaeck, 10) > 0,
      note: wert(zeile, 'notiz') || null,
      status: 'pending',
      driver_response_status: 'pending',
    };
    if (fehlt.length) unvollstaendig.push({ zeile: nr + 1, fehlt, datensatz });
    else fertig.push(datensatz);
  });
  return { fertig, unvollstaendig };
};

export const gaesteBauen = (datenzeilen, zuordnung) => {
  const spalteVon = (feld) => {
    const eintrag = Object.entries(zuordnung).find(([, f]) => f === feld);
    return eintrag ? Number(eintrag[0]) : null;
  };
  const wert = (zeile, feld) => {
    const i = spalteVon(feld);
    return i == null ? '' : text(zeile[i]);
  };
  const fertig = [];
  const unvollstaendig = [];
  datenzeilen.forEach((zeile, nr) => {
    let vorname = wert(zeile, 'vorname');
    let nachname = wert(zeile, 'nachname');
    const voll = wert(zeile, 'vollname').replace(/^(herr|frau|mr|mrs|ms|dr)\.?\s+/i, '');
    if (voll && !vorname && !nachname) {
      const teile = voll.includes(',') ? voll.split(',').map((s) => s.trim()).reverse() : voll.split(/\s+/);
      nachname = teile.length > 1 ? teile[teile.length - 1] : teile[0];
      vorname = teile.length > 1 ? teile.slice(0, -1).join(' ') : '';
    }
    const datensatz = {
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
    if (!vorname && !nachname) unvollstaendig.push({ zeile: nr + 1, fehlt: ['name'], datensatz });
    else fertig.push(datensatz);
  });
  return { fertig, unvollstaendig };
};
