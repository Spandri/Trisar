// Fahrer und Fahrzeuge per KI-Assistent anlegen:
//   "Leg Fahrer Max Mustermann an, Nummer 12, Telefon 0151 2345678"
//   "Neues Fahrzeug Mercedes V-Klasse, Kennzeichen M-TR 105, 7 Sitze, schwarz, Diesel"
// Ohne Modell, die Regel liest die Angaben aus dem Satz. Wie beim Stundenlohn (lohn.ts) wird nie sofort
// geschrieben: erst kommt eine Rueckfrage mit allen Angaben, "ja" legt an, "nein" verwirft. Solange die
// Rueckfrage offen ist, kann man Angaben nachreichen ("Benutzername mmuster", "Kennzeichen M-TR 106").
// Die offene Rueckfrage reist im Gespraechs-Kontext (offenesAnlegen), daher ohne neuen App-Build.
//
// Fahrer: Benutzername ist vorname.nachname, wenn keiner genannt ist. Ohne Passwort im Satz wird beim
// Speichern eines erzeugt und genau einmal angezeigt. Im Protokoll (ki_protokoll) steht es nie.

// deno-lint-ignore-file no-explicit-any
import { kontoAnlegen, NAME_MUSTER } from './konto.ts';

const FRIST_MS = 15 * 60 * 1000;

const normal = (text: string) => ` ${String(text || '').toLowerCase()
  .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
  .replace(/[^a-z0-9:.,@+\- ]+/g, ' ')
  .replace(/\s+/g, ' ')} `;

const STARK_RE = /\b(leg|lege|legt|legst|anlegen|anleg\w*|erstell\w*|hinzufueg\w*|fueg\w*|registrier\w*|einricht\w*|aufnehm\w*)\b/;
const NEU_RE = /\bneu(e|en|er|es)?\b/;
const VERB_RE = new RegExp(`${STARK_RE.source}|${NEU_RE.source}`);
// Fragen ("Welche Fahrer sind neu?", "Wie lege ich ein Auto an?") sind kein Auftrag. "Kannst du ... anlegen?" schon.
const FRAGE_RE = /^\s*(wer|wie|was|welche\w*|wann|wo|wieviel|gibt|hat|haben|sind|ist|zeig\w*|liste\w*)\b/;
const BITTE_RE = /^\s*(kannst|koenntest|kann|wuerdest|bitte)\b/;
const FAHRER_RE = /\bfahrer(in)?\b/;
const FAHRZEUG_RE = /\b(fahrzeug|auto|wagen|kfz|pkw|van|kennzeichen)\b/;
// Saetze ueber Fahrten, Dienste oder Lohn gehoeren nicht hierher ("neue Fahrt mit Fahrer Tim").
const ANDERES_RE = /\b(fahrt|fahrten|buch\w*|dienst\w*|stundenlohn|lohn|feierabend|abholung|abholen|flughafen)\b/;
const JA_RE = /^\s*(ja|jo|jap|japp|yes|ok|okay|okey|klar|genau|passt|stimmt|richtig|mach(s|e)?( das)?|machen|speicher(n|e)?|anleg\w*|leg (es|ihn|sie) an|bestaetig(e|en|t)?|in ordnung|gerne|bitte|los)\b/;
const NEIN_RE = /^\s*(nein|ne|nee|nope|nicht|abbrechen|abbruch|stopp?|lass(e|en)? (es|das)|vergiss|verwerfen|doch nicht)\b/;

const STOPP = new Set(['leg', 'lege', 'legt', 'an', 'anlegen', 'erstelle', 'erstell', 'erstellen', 'ein', 'einen', 'eine', 'neu', 'neue', 'neuen',
  'neuer', 'neues', 'fahrer', 'fahrerin', 'bitte', 'mit', 'namens', 'name', 'heisst', 'der', 'die', 'das', 'den', 'dem', 'und', 'als', 'fuer',
  'hinzu', 'hinzufuegen', 'fuege', 'fueg', 'registriere', 'nimm', 'auf', 'aufnehmen', 'mach', 'mache', 'mal', 'noch', 'jetzt', 'kannst',
  'du', 'ich', 'moechte', 'will', 'wir', 'brauchen', 'brauche', 'hat', 'ist', 'sein', 'seine', 'ihr', 'ihre', 'er', 'sie', 'es', 'konto',
  'login', 'zugang', 'app', 'trisar', 'herr', 'frau', 'von', 'im', 'in', 'zum', 'zur', 'system']);

// ---- Fahrer ---------------------------------------------------------------------------------------

type FahrerDaten = { vor: string; nach: string; benutzername: string; passwort: string; nummer: string; telefon: string; email: string };

const gross = (w: string) => w.split('-').map((t) => (t ? t[0].toUpperCase() + t.slice(1) : t)).join('-');
const umschrift = (t: string) => t.toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
  .normalize('NFD').replace(/[̀-ͯ]/g, '');
const benutzerVorschlag = (vor: string, nach: string) => umschrift(`${vor}.${nach}`).replace(/\s+/g, '').replace(/[^a-z0-9._-]/g, '').slice(0, 32);

// Felder aus dem Rohtext. Gibt die Felder und den Rest ohne diese Stellen zurueck (fuer den Namen).
const fahrerFelder = (roh: string) => {
  let rest = ` ${roh} `;
  const nimm = (re: RegExp) => {
    const m = rest.match(re);
    if (!m) return '';
    rest = rest.replace(m[0], ' ');
    return m[1];
  };
  const passwort = nimm(/\b(?:passwort|kennwort|pw)\s*(?:ist|lautet|:|=)?\s*(\S+)/i);
  const benutzername = nimm(/\bbenutzer(?:name)?\s*(?:ist|lautet|:|=)?\s*([A-Za-z0-9._-]+)/i).toLowerCase();
  const email = nimm(/(?:e-?mail\s*(?:ist|:|=)?\s*)?\b([^\s@,;]+@[^\s@,;]+\.[a-z]{2,})\b/i).toLowerCase();
  const telefon = nimm(/(?:\b(?:telefon|tel\.?|handy|mobil|nummer)\s*(?:ist|:|=)?\s*)?(\+?\d[\d /-]{5,}\d)/i).replace(/\s+/g, ' ').trim();
  const nummer = nimm(/\b(?:fahrer)?(?:nummer|nr\.?)\s*(?:ist|:|=)?\s*(\d{1,4})\b/i) || nimm(/\((\d{1,4})\)/);
  const nameAngabe = nimm(/\b(?:namens|name|heisst|heißt)\b\s*(?:ist|:|=)?\s*([A-Za-zÄÖÜäöüßÀ-ÿ' -]{3,60})$/i);
  return { passwort, benutzername, email, telefon, nummer, rest: nameAngabe || rest };
};

const nameAus = (text: string, max = 2) => {
  const woerter = text.split(/[\s,.;:!?]+/).filter(Boolean)
    .filter((w) => /^[A-Za-zÄÖÜäöüßÀ-ÿ'-]{2,}$/.test(w) && !STOPP.has(normal(w).trim()));
  if (woerter.length < 2) return null;
  const teile = woerter.slice(0, max).map(gross);
  return { vor: teile[0], nach: teile.slice(1).join(' ') };
};

const fahrerText = (d: FahrerDaten) => [
  `Neuer Fahrer: ${d.vor} ${d.nach}`,
  `Benutzername: ${d.benutzername}`,
  `Passwort: ${d.passwort ? 'wie angegeben' : 'erzeuge ich beim Speichern'}`,
  ...(d.nummer ? [`Fahrernummer: ${d.nummer}`] : []),
  ...(d.telefon ? [`Telefon: ${d.telefon}`] : []),
  ...(d.email ? [`E-Mail: ${d.email}`] : []),
  '',
  'Soll ich den Fahrer so anlegen? Mit „ja“ speichere ich ihn. Ändern kannst du vorher noch, z. B. „Benutzername mmuster“ oder „Nummer 14“.',
].join('\n');

// Prueft Benutzername, Nummer und Passwort. Liefert Fehlertext oder ''.
const fahrerPruefen = async (admin: any, d: FahrerDaten) => {
  if (!NAME_MUSTER.test(d.benutzername)) {
    return `Der Benutzername „${d.benutzername}“ geht nicht. Erlaubt sind 3 bis 32 Zeichen aus Kleinbuchstaben, Zahlen, Punkt, Strich und Unterstrich.`;
  }
  if (d.passwort && d.passwort.length < 8) return 'Das Passwort braucht mindestens 8 Zeichen.';
  const { data: belegt } = await admin.from('profiles').select('id').eq('username', d.benutzername).maybeSingle();
  if (belegt?.id) return `Den Benutzernamen „${d.benutzername}“ gibt es schon. Sag mir einen anderen, z. B. „Benutzername ${d.benutzername}2“.`;
  if (d.nummer) {
    const { data: hat } = await admin.from('profiles').select('id, first_name, last_name').eq('driver_number', Number(d.nummer)).maybeSingle();
    if (hat?.id) return `Die Fahrernummer ${d.nummer} hat schon ${[hat.first_name, hat.last_name].filter(Boolean).join(' ')}. Sag mir eine andere Nummer.`;
  }
  return '';
};

// Freier Benutzername: vorname.nachname, sonst mit 2, 3 ... dahinter.
const freierBenutzername = async (admin: any, basis: string) => {
  const b = (basis || 'fahrer').slice(0, 30);
  for (let i = 1; i < 20; i += 1) {
    const name = i === 1 ? b : `${b}${i}`;
    const { data } = await admin.from('profiles').select('id').eq('username', name).maybeSingle();
    if (!data?.id) return name;
  }
  return `${b}${Date.now() % 1000}`;
};

// Gut lesbar und abtippbar: ohne 0/O, 1/l/I.
const passwortErzeugen = () => {
  const zeichen = 'abcdefghjkmnpqrstuvwxyz23456789';
  const z = crypto.getRandomValues(new Uint8Array(8));
  const teil = Array.from(z, (n) => zeichen[n % zeichen.length]).join('');
  return `${teil.slice(0, 4)}-${teil.slice(4)}`;
};

const fahrerSpeichern = async (admin: any, d: FahrerDaten) => {
  const passwort = d.passwort || passwortErzeugen();
  const ergebnis = await kontoAnlegen(admin, {
    benutzername: d.benutzername,
    email: d.email,
    passwort,
    first_name: d.vor,
    last_name: d.nach,
    profil: {
      is_dispo: false,
      ...(d.nummer ? { driver_number: Number(d.nummer) } : {}),
      ...(d.telefon ? { phone: d.telefon } : {}),
      language: 'Deutsch',
    },
  });
  if ('fehler' in ergebnis) {
    const grund = ergebnis.fehler === 'email_taken' ? 'die E-Mail gibt es schon'
      : ergebnis.fehler === 'username_taken' ? 'den Benutzernamen gibt es schon' : ergebnis.fehler;
    return `Das Anlegen hat nicht geklappt (${grund}). Es wurde nichts gespeichert.`;
  }
  return [
    `Angelegt: ${d.vor} ${d.nach}${d.nummer ? ` (${d.nummer})` : ''}.`,
    `Login für die Fahrer-App: Benutzername ${d.benutzername}, Passwort ${d.passwort ? 'wie angegeben' : passwort}.`,
    ...(d.passwort ? [] : ['Das Passwort zeige ich nicht noch einmal, gib es dem Fahrer gleich weiter.']),
    'Fahrzeug, Adresse und Stundenlohn kannst du unter Fahrer bearbeiten ergänzen.',
  ].join('\n');
};

// ---- Fahrzeug -------------------------------------------------------------------------------------

type FahrzeugDaten = { modell: string; ausstattung: string; kennzeichen: string; sitze: string; farbe: string; kraftstoff: string; vin: string };

const MARKEN = ['mercedes-benz', 'mercedes', 'bmw', 'audi', 'vw', 'volkswagen', 'tesla', 'skoda', 'opel', 'ford', 'toyota', 'porsche',
  'range rover', 'land rover', 'volvo', 'hyundai', 'kia', 'cupra', 'seat', 'renault', 'peugeot', 'citroen', 'fiat', 'nissan', 'mazda',
  'lexus', 'jaguar', 'bentley', 'rolls-royce', 'maybach', 'byd', 'polestar', 'mini', 'genesis', 'nio', 'smart', 'dacia', 'jeep', 'cadillac'];
const FARBEN = ['dunkelblau', 'dunkelgrau', 'hellgrau', 'anthrazit', 'schwarz', 'weiss', 'grau', 'silber', 'blau', 'rot', 'gruen', 'beige', 'braun', 'gelb', 'gold'];
const KRAFTSTOFF: [RegExp, string][] = [[/\bplug-?in\b/, 'Plug-in-Hybrid'], [/\bhybrid\b/, 'Hybrid'], [/\b(elektro\w*|e-auto|ev|strom)\b/, 'Elektro'],
  [/\bdiesel\b/, 'Diesel'], [/\bbenzin\w*\b/, 'Benzin']];
const AUSSTATTUNG: [RegExp, string][] = [[/\blimousine\b/, 'Limousine'], [/\bkleinbus\b/, 'Kleinbus'], [/\bsuv\b/, 'SUV'], [/\bkombi\b/, 'Kombi'],
  [/\bvan\b/, 'Van'], [/\bcabrio\w*\b/, 'Cabrio'], [/\bbus\b/, 'Bus']];
const MODELL_ENDE = new Set(['mit', 'kennzeichen', 'an', 'und', 'als', 'in', 'farbe', 'sitze', 'sitzer', 'plaetze', 'bitte', 'fuer', 'kraftstoff',
  'anlegen', 'hinzufuegen', 'erstellen', 'vin', 'fahrgestellnummer']);

const fahrzeugFelder = (roh: string) => {
  let rest = ` ${roh} `;
  const nimm = (re: RegExp) => {
    const m = rest.match(re);
    if (!m) return null;
    rest = rest.replace(m[0], ' ');
    return m;
  };
  const k = nimm(/\bkennzeichen\s*(?:ist|:|=)?\s*([a-zäöü]{1,3})[- ]?([a-z]{1,2})[- ]?(\d{1,4})([eh])?\b/i)
    || nimm(/\b([a-zäöü]{1,3})[- ]([a-z]{1,2})[- ]?(\d{1,4})([eh])?\b/i);
  const kennzeichen = k ? `${k[1].toUpperCase()}-${k[2].toUpperCase()} ${k[3]}${(k[4] || '').toUpperCase()}` : '';
  const vin = (nimm(/\b(?:vin|fahrgestellnummer)?\s*:?\s*([A-HJ-NPR-Z0-9]{17})\b/i)?.[1] || '').toUpperCase();
  const s = nimm(/\b(\d{1,2})\s*-?\s*(?:sitz\w*|plaetze|plätze|sitzplaetze|sitzplätze|personen)\b/i);
  const sitze = s ? s[1] : '';
  const n = normal(rest);
  const farbe = FARBEN.find((f) => new RegExp(`\\b${f}\\b`).test(n)) || '';
  const kraftstoff = KRAFTSTOFF.find(([re]) => re.test(n))?.[1] || '';
  const ausstattung = AUSSTATTUNG.find(([re]) => re.test(n))?.[1] || '';
  return { kennzeichen, vin, sitze, farbe: farbe ? farbe.replace('ss', 'ß').replace('ue', 'ü') : '', kraftstoff, ausstattung, rest };
};

// Marke und Modell: ab der Marke bis zum ersten Fuellwort, sonst nach "Fahrzeug/Auto".
const modellAus = (rest: string) => {
  const woerter = rest.split(/[\s,;]+/).filter(Boolean);
  const klein = woerter.map((w) => normal(w).trim().replace(/[:.]+$/, ''));
  let start = klein.findIndex((w, i) => MARKEN.includes(w) || MARKEN.includes(`${w} ${klein[i + 1] || ''}`));
  if (start < 0) {
    const nach = klein.findIndex((w) => /^(fahrzeug|auto|wagen|kfz|pkw)$/.test(w));
    if (nach < 0) return '';
    start = nach + 1;
  }
  const teile: string[] = [];
  for (let i = start; i < woerter.length && teile.length < 4; i += 1) {
    const w = klein[i];
    if (!w || MODELL_ENDE.has(w) || STOPP.has(w) || FARBEN.includes(w) || /^(diesel|benzin|elektro|hybrid)$/.test(w)) {
      if (teile.length) break;
      continue;
    }
    teile.push(/^[a-z]/.test(woerter[i]) && woerter[i].length > 3 ? gross(woerter[i]) : woerter[i]);
  }
  const t = teile.join(' ').replace(/^(vw)\b/i, 'VW').replace(/^bmw\b/i, 'BMW');
  return t;
};

const fahrzeugText = (d: FahrzeugDaten) => [
  `Neues Fahrzeug: ${d.modell}${d.ausstattung ? ` (${d.ausstattung})` : ''}`,
  `Kennzeichen: ${d.kennzeichen || 'keins angegeben'}`,
  ...(d.sitze ? [`Sitze: ${d.sitze}`] : []),
  ...(d.farbe ? [`Farbe: ${d.farbe}`] : []),
  ...(d.kraftstoff ? [`Kraftstoff: ${d.kraftstoff}`] : []),
  ...(d.vin ? [`VIN: ${d.vin}`] : []),
  '',
  'Soll ich das Fahrzeug so anlegen? Mit „ja“ speichere ich es. Ändern kannst du vorher noch, z. B. „Kennzeichen M-TR 106“ oder „8 Sitze“.',
].join('\n');

const fahrzeugPruefen = async (admin: any, d: FahrzeugDaten) => {
  if (!d.modell) return 'Welche Marke und welches Modell? Zum Beispiel „Neues Fahrzeug Mercedes V-Klasse, Kennzeichen M-TR 105“.';
  if (d.kennzeichen) {
    const { data } = await admin.from('vehicles').select('id, brand_model').eq('license_plate', d.kennzeichen).maybeSingle();
    if (data?.id) return `Das Kennzeichen ${d.kennzeichen} gibt es schon (${data.brand_model || 'Fahrzeug'}). Es wurde nichts angelegt.`;
  }
  return '';
};

const fahrzeugSpeichern = async (admin: any, d: FahrzeugDaten) => {
  const { error } = await admin.from('vehicles').insert([{
    brand_model: d.modell,
    trim: d.ausstattung || null,
    license_plate: d.kennzeichen || null,
    seat_count: d.sitze ? Number(d.sitze) : null,
    color: d.farbe || null,
    fuel_type: d.kraftstoff || null,
    vin: d.vin || null,
  }]);
  if (error) return `Das Anlegen hat nicht geklappt (${error.message}). Es wurde nichts gespeichert.`;
  return `Angelegt: ${d.modell}${d.kennzeichen ? ` (${d.kennzeichen})` : ''}. Tracker und Fahrer ordnest du unter Fahrzeug bzw. Fahrer bearbeiten zu.`;
};

// ---- Ablauf ---------------------------------------------------------------------------------------

export type AnlegenAntwort = { answer: string; kontext: any; aktionen?: any[] } | null;

const ohneOffenes = (kontext: any) => {
  const k = { ...(kontext || {}) };
  delete k.offenesAnlegen;
  return k;
};
const mitOffenem = (kontext: any, art: 'fahrer' | 'fahrzeug', daten: any) => ({ ...ohneOffenes(kontext), offenesAnlegen: { art, daten, zeit: Date.now() } });

// Nachgereichte Angaben in eine offene Rueckfrage uebernehmen. Liefert null, wenn nichts erkannt wurde.
const fahrerNachtrag = (alt: FahrerDaten, roh: string): FahrerDaten | null => {
  const f = fahrerFelder(roh);
  const name = /\b(name|heisst|heißt)\b/i.test(roh) ? nameAus(f.rest, 3) : null;
  const neu = { ...alt };
  let geaendert = false;
  for (const feld of ['passwort', 'benutzername', 'email', 'telefon', 'nummer'] as const) {
    if (f[feld]) { neu[feld] = f[feld]; geaendert = true; }
  }
  if (name) {
    const autoName = alt.benutzername === benutzerVorschlag(alt.vor, alt.nach);
    neu.vor = name.vor;
    neu.nach = name.nach;
    if (autoName && !f.benutzername) neu.benutzername = benutzerVorschlag(name.vor, name.nach);
    geaendert = true;
  }
  return geaendert ? neu : null;
};

const fahrzeugNachtrag = (alt: FahrzeugDaten, roh: string): FahrzeugDaten | null => {
  const f = fahrzeugFelder(roh);
  const modell = /\b(modell|marke|typ)\b/i.test(roh) ? modellAus(f.rest.replace(/\b(modell|marke|typ)\b\s*(ist|:)?/i, ' fahrzeug ')) : '';
  const neu = { ...alt };
  let geaendert = false;
  for (const feld of ['kennzeichen', 'vin', 'sitze', 'farbe', 'kraftstoff', 'ausstattung'] as const) {
    if (f[feld]) { neu[feld] = f[feld]; geaendert = true; }
  }
  if (modell) { neu.modell = modell; geaendert = true; }
  return geaendert ? neu : null;
};

export const anlegenVorschlag = async (admin: any, frage: string, kontext: any, karten = false): Promise<AnlegenAntwort> => {
  const roh = String(frage || '').trim();
  const text = normal(roh);
  const offen = kontext?.offenesAnlegen;
  const offenGueltig = offen && (offen.art === 'fahrer' || offen.art === 'fahrzeug') && offen.daten
    && Date.now() - Number(offen.zeit || 0) < FRIST_MS;

  // Mehrere offen: "ja" legt alle an, die passen, "nein" verwirft alle.
  if (offen?.art === 'mehrere' && Array.isArray(offen.liste) && Date.now() - Number(offen.zeit || 0) < FRIST_MS && roh.length <= 60) {
    if (NEIN_RE.test(text)) return { answer: 'Okay, ich habe nichts angelegt.', kontext: ohneOffenes(kontext) };
    if (JA_RE.test(text) && !/\?/.test(roh)) {
      const ergebnisse: string[] = [];
      for (const e of offen.liste) {
        const fehler = e.art === 'fahrer' ? await fahrerPruefen(admin, e.daten) : await fahrzeugPruefen(admin, e.daten);
        if (fehler) { ergebnisse.push(`Nicht angelegt: ${fehler}`); continue; }
        ergebnisse.push(e.art === 'fahrer' ? await fahrerSpeichern(admin, e.daten) : await fahrzeugSpeichern(admin, e.daten));
      }
      return { answer: ergebnisse.join('\n\n'), kontext: ohneOffenes(kontext) };
    }
  }

  if (offenGueltig) {
    if (roh.length <= 60 && NEIN_RE.test(text)) {
      return { answer: 'Okay, ich habe nichts angelegt.', kontext: ohneOffenes(kontext) };
    }
    if (roh.length <= 60 && JA_RE.test(text) && !/\?/.test(roh)) {
      if (offen.art === 'fahrer') {
        const fehler = await fahrerPruefen(admin, offen.daten);
        if (fehler) return { answer: fehler, kontext: mitOffenem(kontext, 'fahrer', offen.daten) };
        return { answer: await fahrerSpeichern(admin, offen.daten), kontext: ohneOffenes(kontext) };
      }
      const fehler = await fahrzeugPruefen(admin, offen.daten);
      if (fehler) return { answer: fehler, kontext: ohneOffenes(kontext) };
      return { answer: await fahrzeugSpeichern(admin, offen.daten), kontext: ohneOffenes(kontext) };
    }
    // Angaben nachreichen, solange kein neuer Auftrag drinsteht.
    if (!VERB_RE.test(text) || roh.length <= 60) {
      if (offen.art === 'fahrer') {
        const neu = fahrerNachtrag(offen.daten, roh);
        if (neu) {
          const fehler = await fahrerPruefen(admin, neu);
          return { answer: fehler || fahrerText(neu), kontext: mitOffenem(kontext, 'fahrer', neu) };
        }
      } else {
        const neu = fahrzeugNachtrag(offen.daten, roh);
        if (neu) {
          const fehler = await fahrzeugPruefen(admin, neu);
          return { answer: fehler || fahrzeugText(neu), kontext: fehler ? ohneOffenes(kontext) : mitOffenem(kontext, 'fahrzeug', neu) };
        }
      }
    }
  }

  // Neuer Auftrag: Verb + Fahrer/Fahrzeug, nichts ueber Fahrten oder Dienste.
  const auftrag = (STARK_RE.test(text) || NEU_RE.test(text)) && !FRAGE_RE.test(text) && (!/\?/.test(roh) || BITTE_RE.test(text));
  if (!auftrag || ANDERES_RE.test(text)) return null;
  const istFahrzeug = FAHRZEUG_RE.test(text) || MARKEN.some((m) => new RegExp(`\\b${m}\\b`).test(text));
  const istFahrer = FAHRER_RE.test(text);
  if (!istFahrzeug && !istFahrer) return null;

  // Mehrere in einem Satz: "Fahrer Fertel Garlo und Fahrer Marvin Hallo", "zwei Autos: BMW 5er M-TR 104, Audi A8 M-TR 106",
  // je Zeile einer. Jeder Teil wird fuer sich gelesen.
  const teile = anlegenTeilen(roh, istFahrzeug && !istFahrer ? 'fahrzeug' : istFahrer && !istFahrzeug ? 'fahrer' : null);
  const entwuerfe: Entwurf[] = [];
  for (const teil of teile) {
    const e = await entwurfAus(admin, teil.text, teil.art, entwuerfe);
    if (e) entwuerfe.push(e);
  }
  if (!entwuerfe.length) {
    if (istFahrer && !istFahrzeug) {
      return { answer: 'Wie heißt der neue Fahrer? Sag mir Vor- und Nachnamen, z. B. „Leg Fahrer Max Mustermann an, Nummer 14“.', kontext: ohneOffenes(kontext) };
    }
    if (istFahrzeug && !istFahrer) {
      return { answer: 'Welche Marke und welches Modell? Zum Beispiel „Neues Fahrzeug Mercedes V-Klasse, Kennzeichen M-TR 105“.', kontext: ohneOffenes(kontext) };
    }
    return null;
  }

  // Apps mit Karten: jede Anlage als eigene Karte, Buchen legt sie an (aktion ki_anlegen), Bearbeiten oeffnet das Formular.
  if (karten) {
    const aktionen = entwuerfe.map((e) => (e.art === 'fahrer'
      ? { type: 'fahrer_proposal', fahrer: { ...e.daten, fehler: e.fehler || '' } }
      : { type: 'fahrzeug_proposal', fahrzeug: { ...e.daten, fehler: e.fehler || '' } }));
    const kopf = entwuerfe.length === 1
      ? (entwuerfe[0].art === 'fahrer' ? 'Neuer Fahrer, prüfe die Karte und bestätige sie.' : 'Neues Fahrzeug, prüfe die Karte und bestätige es.')
      : `Ich habe ${entwuerfe.length} Einträge vorbereitet. Jeden bestätigst du einzeln auf seiner Karte.`;
    const fehler = entwuerfe.filter((e) => e.fehler).map((e) => `${e.titel}: ${e.fehler}`);
    return { answer: [kopf, ...entwuerfe.filter((e) => e.hinweis).map((e) => e.hinweis), ...fehler].join('\n'), kontext: ohneOffenes(kontext), aktionen };
  }

  if (entwuerfe.length === 1) {
    const e = entwuerfe[0];
    if (e.art === 'fahrzeug' && e.fehler) return { answer: e.fehler, kontext: ohneOffenes(kontext) };
    const text2 = e.art === 'fahrer' ? fahrerText(e.daten) : fahrzeugText(e.daten);
    return { answer: e.fehler || `${e.hinweis ? `${e.hinweis}\n` : ''}${text2}`, kontext: mitOffenem(kontext, e.art, e.daten) };
  }
  // Mehrere ohne Karten: Liste, "ja" legt alle an, die passen.
  const zeilen = entwuerfe.map((e, i) => `${i + 1}. ${e.titel}${e.fehler ? ` (geht nicht: ${e.fehler})` : ''}`);
  return {
    answer: `Ich lege an:\n${zeilen.join('\n')}\n\nMit „ja“ lege ich alle an, die passen. Mit „nein“ nichts.`,
    kontext: { ...ohneOffenes(kontext), offenesAnlegen: { art: 'mehrere', liste: entwuerfe.map((e) => ({ art: e.art, daten: e.daten })), zeit: Date.now() } },
  };
};

type Entwurf = { art: 'fahrer' | 'fahrzeug'; daten: any; titel: string; fehler: string; hinweis: string };

// Teile einer Nachricht: je Zeile, sonst an "und"/"," vor Fahrer/Fahrzeug/Marke/Kennzeichen, sonst bei
// Fahrern an "und" zwischen zwei Namen ("Leg Max Muster und Lisa Lang als Fahrer an").
const anlegenTeilen = (roh: string, art: 'fahrer' | 'fahrzeug' | null): { text: string; art: 'fahrer' | 'fahrzeug' | null }[] => {
  const zeilen = roh.split(/\n+/).map((z) => z.replace(/^\s*(\d+[.)]|[-•*])\s*/, '').trim()).filter((z) => z.length > 2);
  const artVon = (t: string): 'fahrer' | 'fahrzeug' | null => {
    const n = normal(t);
    if (FAHRER_RE.test(n) && !FAHRZEUG_RE.test(n)) return 'fahrer';
    if (FAHRZEUG_RE.test(n) || MARKEN.some((m) => new RegExp(`\\b${m}\\b`).test(n)) || /\b[a-z]{1,3}-[a-z]{1,2} ?\d/i.test(t)) return 'fahrzeug';
    return null;
  };
  let teile = zeilen.length > 1 ? zeilen : roh
    .split(/\s*(?:,|\bund\b|\bsowie\b)\s*(?=(?:(?:noch\s+)?(?:einen?|den|die|das|ein)\s+)?(?:(?:neuen?|neues|weiteren?|zweiten?)\s+)?(?:fahrer(?:in)?|fahrzeug|auto|wagen)\b)/i)
    .map((t) => t.trim()).filter(Boolean);
  if (teile.length === 1 && art === 'fahrer') {
    // "Max Muster und Lisa Lang": zwei Namen mit je zwei Woertern.
    const zwei = roh.match(/^(.*?\b)([A-ZÄÖÜ][\wäöüß'-]+\s+[A-ZÄÖÜ][\wäöüß'-]+)\s+und\s+([A-ZÄÖÜ][\wäöüß'-]+\s+[A-ZÄÖÜ][\wäöüß'-]+)(.*)$/);
    if (zwei) teile = [`${zwei[1]}${zwei[2]}${zwei[4]}`, `fahrer ${zwei[3]}`];
  }
  if (teile.length === 1 && art === 'fahrzeug') {
    // Mehrere Kennzeichen: an jedem Komma oder "und" vor einer Marke trennen.
    const nachMarke = roh.split(new RegExp(`\\s*(?:,|\\bund\\b)\\s*(?=(?:${MARKEN.map((m) => m.replace(/[-]/g, '\\-')).join('|')})\\b)`, 'i')).map((t) => t.trim()).filter(Boolean);
    if (nachMarke.length > 1) teile = nachMarke;
  }
  let letzte = art;
  return teile.slice(0, 10).map((t) => {
    const a = artVon(t) || letzte;
    letzte = a;
    return { text: t, art: a };
  });
};

const entwurfAus = async (admin: any, teil: string, art: 'fahrer' | 'fahrzeug' | null, bisher: Entwurf[]): Promise<Entwurf | null> => {
  if (art === 'fahrzeug') {
    const f = fahrzeugFelder(teil);
    const d: FahrzeugDaten = {
      modell: modellAus(f.rest) || modellAus(`fahrzeug ${f.rest}`), ausstattung: f.ausstattung, kennzeichen: f.kennzeichen, sitze: f.sitze,
      farbe: f.farbe, kraftstoff: f.kraftstoff, vin: f.vin,
    };
    if (!d.modell && !d.kennzeichen) return null;
    let fehler = await fahrzeugPruefen(admin, d);
    if (!fehler && d.kennzeichen && bisher.some((e) => e.art === 'fahrzeug' && e.daten.kennzeichen === d.kennzeichen)) fehler = `Kennzeichen ${d.kennzeichen} steht doppelt.`;
    return { art: 'fahrzeug', daten: d, titel: `${d.modell || 'Fahrzeug'}${d.kennzeichen ? ` (${d.kennzeichen})` : ''}`, fehler, hinweis: '' };
  }
  if (art === 'fahrer') {
    const f = fahrerFelder(teil);
    const name = nameAus(f.rest);
    if (!name) return null;
    const vergeben = new Set(bisher.filter((e) => e.art === 'fahrer').map((e) => e.daten.benutzername));
    let benutzername = f.benutzername || await freierBenutzername(admin, benutzerVorschlag(name.vor, name.nach));
    for (let i = 2; vergeben.has(benutzername) && i < 20; i += 1) benutzername = `${benutzerVorschlag(name.vor, name.nach)}${i}`;
    const d: FahrerDaten = {
      vor: name.vor, nach: name.nach, benutzername,
      passwort: f.passwort, nummer: f.nummer, telefon: f.telefon, email: f.email,
    };
    const fehler = await fahrerPruefen(admin, d);
    const { data: gleich } = await admin.from('profiles').select('id').ilike('first_name', d.vor).ilike('last_name', d.nach).limit(1);
    const hinweis = Array.isArray(gleich) && gleich.length ? `Hinweis: Einen Fahrer ${d.vor} ${d.nach} gibt es schon.` : '';
    return { art: 'fahrer', daten: d, titel: `${d.vor} ${d.nach} (Benutzername ${d.benutzername})`, fehler, hinweis };
  }
  return null;
};

// Karte bestaetigt (aktion ki_anlegen aus den Apps): pruefen und anlegen. Antwort mit Text (Passwort einmal).
export const anlegenAusKarte = async (admin: any, body: any) => {
  const art = body?.art === 'fahrzeug' ? 'fahrzeug' : body?.art === 'fahrer' ? 'fahrer' : '';
  const roh = body?.daten || {};
  if (art === 'fahrer') {
    const d: FahrerDaten = {
      vor: String(roh.vor || '').trim(), nach: String(roh.nach || '').trim(),
      benutzername: String(roh.benutzername || '').trim().toLowerCase(), passwort: String(roh.passwort || ''),
      nummer: String(roh.nummer || '').trim(), telefon: String(roh.telefon || '').trim(), email: String(roh.email || '').trim().toLowerCase(),
    };
    if (!d.vor || !d.nach) return { status: 400, daten: { ok: false, text: 'Vor- und Nachname fehlen.' } };
    const fehler = await fahrerPruefen(admin, d);
    if (fehler) return { status: 200, daten: { ok: false, text: fehler } };
    const text = await fahrerSpeichern(admin, d);
    return { status: 200, daten: { ok: /^Angelegt/.test(text), text } };
  }
  if (art === 'fahrzeug') {
    const d: FahrzeugDaten = {
      modell: String(roh.modell || '').trim(), ausstattung: String(roh.ausstattung || '').trim(), kennzeichen: String(roh.kennzeichen || '').trim().toUpperCase(),
      sitze: String(roh.sitze || '').trim(), farbe: String(roh.farbe || '').trim(), kraftstoff: String(roh.kraftstoff || '').trim(), vin: String(roh.vin || '').trim(),
    };
    const fehler = await fahrzeugPruefen(admin, d);
    if (fehler) return { status: 200, daten: { ok: false, text: fehler } };
    const text = await fahrzeugSpeichern(admin, d);
    return { status: 200, daten: { ok: /^Angelegt/.test(text), text } };
  }
  return { status: 400, daten: { ok: false, text: 'Unbekannte Art.' } };
};

// Passwoerter fuer das Protokoll unkenntlich machen.
export const ohnePasswort = (text: string) => String(text || '')
  .replace(/\b(passwort|kennwort|pw)(\s*(?:ist|lautet|:|=)?\s*)(?!wie angegeben|erzeuge)\S+/gi, '$1$2***');
