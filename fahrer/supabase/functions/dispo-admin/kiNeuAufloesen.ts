// Umbau KI-Assistent, Phase 2 (18.11., reports/KI Assistent Umbau Plan.md): Aufloeser im Code.
// Das Modell schreibt nur ab, was im Satz steht ("übernächsten Freitag", "dreiviertel 7", "Brnuo"). Hier wird
// daraus Datum, Uhrzeit, Fahrer, Gast und Fahrt. Reiner Code, jeder Teil mit eigenen Tests ohne Modell
// (werkzeuge/ki-test/neu-aufloesen-test.ts). Was nicht eindeutig ist, liefert einen Fehler fuer eine Rueckfrage,
// nie einen geratenen Wert.

// deno-lint-ignore-file no-explicit-any

export type Jetzt = { datum: string; minuten: number };

export const klein = (x: unknown) => String(x ?? '').toLowerCase()
  .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
  .normalize('NFD').replace(/[̀-ͯ]/g, '');

const plus = (iso: string, n: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const wochentag = (iso: string) => new Date(`${iso}T12:00:00Z`).getUTCDay();
const gueltig = (j: number, m: number, t: number) => {
  const d = new Date(Date.UTC(j, m - 1, t, 12));
  return d.getUTCFullYear() === j && d.getUTCMonth() === m - 1 && d.getUTCDate() === t;
};
const iso = (j: number, m: number, t: number) => `${j}-${String(m).padStart(2, '0')}-${String(t).padStart(2, '0')}`;

// Nachts vor 05:00 gehoert die Nacht noch zum Vortag: "morgen" meint dann das heutige Kalenderdatum.
export const NACHT_BIS = 5 * 60;

const ZAHLWORT: Record<string, number> = {
  null: 0, ein: 1, eins: 1, eine: 1, einer: 1, einem: 1, einen: 1, zwei: 2, drei: 3, vier: 4, fuenf: 5, sechs: 6, sieben: 7,
  acht: 8, neun: 9, zehn: 10, elf: 11, zwoelf: 12, dreizehn: 13, vierzehn: 14, fuenfzehn: 15, sechzehn: 16, siebzehn: 17,
  achtzehn: 18, neunzehn: 19, zwanzig: 20, dreissig: 30, vierzig: 40, fuenfzig: 50,
};
const zahl = (w: string): number | null => (/^\d+$/.test(w) ? Number(w) : w in ZAHLWORT ? ZAHLWORT[w] : null);
const ZAHL_RE = `(\\d+|${Object.keys(ZAHLWORT).join('|')})`;

const WT = ['sonntag', 'montag', 'dienstag', 'mittwoch', 'donnerstag', 'freitag', 'samstag'];
const WT_RE = `(${WT.join('|')})s?`;
const MONATE = ['januar', 'februar', 'maerz', 'april', 'mai', 'juni', 'juli', 'august', 'september', 'oktober', 'november', 'dezember'];
const MONAT_KURZ: Record<string, number> = { jan: 1, feb: 2, mrz: 3, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, okt: 10, nov: 11, dez: 12 };

export type DatumErgebnis = { iso: string; art: 'tag' } | { von: string; bis: string; art: 'woche' } | { fehler: 'leer' | 'unklar' | 'unmoeglich' | 'widerspruch'; text: string };

// Montag der Woche, in der iso liegt.
const montag = (d: string) => plus(d, -((wochentag(d) + 6) % 7));

// Datum aus dem Text, den das Modell abgeschrieben hat (datum_text). neu = es wird etwas angelegt (Dienst,
// Fahrt): dann meint der heutige Wochentag den in 7 Tagen. Beim Aendern, Loeschen und Fragen ist heute gemeint.
export const datumAufloesen = (text: string, jetzt: Jetzt, neu = true): DatumErgebnis => {
  const t = ` ${klein(text).replace(/[,;!?]/g, ' ').replace(/\s+/g, ' ').trim()} `;
  if (!t.trim()) return { fehler: 'leer', text };
  const heute = jetzt.datum;
  const nacht = jetzt.minuten < NACHT_BIS;
  const kandidaten: string[] = [];
  let erkannt = false;
  const dazu = (d: string) => { kandidaten.push(d); erkannt = true; };

  // Ganze Woche ("nächste Woche", "diese Woche") ohne Tag dazu.
  const wocheM = t.match(/\b(naechste|kommende|diese|uebernaechste)\s+woche\b/);
  if (wocheM && !new RegExp(`\\b${WT_RE}\\b`).test(t) && !/\b(in|vor)\s+/.test(t)) {
    const m0 = montag(heute);
    const start = wocheM[1] === 'diese' ? m0 : wocheM[1] === 'uebernaechste' ? plus(m0, 14) : plus(m0, 7);
    return { von: start, bis: plus(start, 6), art: 'woche' };
  }

  // Anker: Angaben, die genau einen Tag nennen. Ein Wochentag daneben wird nur noch geprueft ("heute, Mittwoch",
  // "Sonntag den 15. November"), passt er nicht, ist es ein Widerspruch.
  const anker: string[] = [];
  // Englische Tageswoerter (Diktat oder Gaeste-Text): nie stillschweigend heute ("Book a ride tomorrow").
  if (/\b(today|tonight)\b/.test(t)) anker.push(heute);
  if (/\btomorrow\b/.test(t)) anker.push(plus(heute, nacht ? 0 : 1));
  if (/\byesterday\b/.test(t)) anker.push(plus(heute, -1));
  if (/\bheute\b/.test(t)) anker.push(heute);
  if (/\buebermorgen\b/.test(t)) anker.push(plus(heute, nacht ? 1 : 2));
  else if (/\bmorgen\b/.test(t) && !/\bheute\s+morgen\b/.test(t)) anker.push(plus(heute, nacht ? 0 : 1));
  if (/\bvorgestern\b/.test(t)) anker.push(plus(heute, -2));
  else if (/\bgestern\b/.test(t)) anker.push(plus(heute, -1));
  const inTagen = t.match(new RegExp(`\\bin\\s+${ZAHL_RE}\\s+tag(en)?\\b`));
  if (inTagen) anker.push(plus(heute, zahl(inTagen[1]) ?? NaN));
  // Festes Datum: "3.12.", "03.12.2026", "24.12", "15. November", "am 3."
  for (const m of t.matchAll(/\b(\d{1,2})\.\s?(\d{1,2})\.?(\d{2,4})?(?![\d:])/g)) {
    const tag = Number(m[1]);
    const monat = Number(m[2]);
    if (monat < 1 || monat > 12) continue;
    let jahr = m[3] ? Number(m[3].length === 2 ? `20${m[3]}` : m[3]) : Number(heute.slice(0, 4));
    if (!gueltig(jahr, monat, tag)) return { fehler: 'unmoeglich', text };
    // Ohne Jahr und mehr als zwei Monate vorbei: naechstes Jahr ("am 3.1." im November).
    if (!m[3] && iso(jahr, monat, tag) < plus(heute, -60)) jahr += 1;
    anker.push(iso(jahr, monat, tag));
  }
  for (const m of t.matchAll(new RegExp(`\\b(\\d{1,2})\\.?\\s+(${MONATE.join('|')}|${Object.keys(MONAT_KURZ).join('|')})\\.?\\b(\\s+(\\d{4}))?`, 'g'))) {
    const tag = Number(m[1]);
    const monat = MONATE.includes(m[2]) ? MONATE.indexOf(m[2]) + 1 : MONAT_KURZ[m[2]];
    let jahr = m[4] ? Number(m[4]) : Number(heute.slice(0, 4));
    if (!gueltig(jahr, monat, tag)) return { fehler: 'unmoeglich', text };
    if (!m[4] && iso(jahr, monat, tag) < plus(heute, -60)) jahr += 1;
    anker.push(iso(jahr, monat, tag));
  }
  if (!anker.length) {
    const nurTag = t.match(/\b(?:am|den|zum)\s+(\d{1,2})\.(?![\d:])/);
    if (nurTag) {
      const tag = Number(nurTag[1]);
      let [j, m] = [Number(heute.slice(0, 4)), Number(heute.slice(5, 7))];
      if (iso(j, m, tag) < heute) { m += 1; if (m > 12) { m = 1; j += 1; } }
      if (!gueltig(j, m, tag)) return { fehler: 'unmoeglich', text };
      anker.push(iso(j, m, tag));
    }
  }
  anker.forEach(dazu);

  // "in zwei Wochen", "in drei Wochen am Dienstag".
  const inWochen = t.match(new RegExp(`\\bin\\s+${ZAHL_RE}\\s+woche(n)?\\b`));
  const wtM = [...t.matchAll(new RegExp(`\\b(naechste[nmrs]?|kommende[nmrs]?|uebernaechste[nmrs]?|diese[nmrs]?|letzte[nmrs]?|vergangene[nmrs]?|vorige[nmrs]?)?\\s*${WT_RE}\\b`, 'g'))];
  const naechsteWoche = /\bnaechste\s+woche\b/.test(t);
  if (inWochen) {
    const ziel = plus(heute, 7 * (zahl(inWochen[1]) ?? NaN));
    if (wtM.length === 1) dazu(plus(montag(ziel), (WT.indexOf(wtM[0][2]) + 6) % 7));
    else if (!wtM.length) dazu(ziel);
    else return { fehler: 'unklar', text };
  } else if (anker.length) {
    // Wochentag neben einem Anker: nur pruefen.
    for (const m of wtM) if (!m[1] && anker.some((a) => wochentag(a) !== WT.indexOf(m[2]))) return { fehler: 'widerspruch', text };
  } else {
    for (const m of wtM) {
      const zusatz = m[1] || '';
      const ziel = WT.indexOf(m[2]);
      const heuteWt = wochentag(heute);
      let abstand = (ziel - heuteWt + 7) % 7;
      if (/^(letzte|vergangene|vorige)/.test(zusatz)) { dazu(plus(heute, -(abstand === 0 ? 7 : 7 - abstand))); continue; }
      if (/^diese/.test(zusatz)) { dazu(plus(montag(heute), (ziel + 6) % 7)); continue; }
      if (naechsteWoche) { dazu(plus(plus(montag(heute), 7), (ziel + 6) % 7)); continue; }
      // Heutiger Wochentag: nachts und beim Aendern ist heute gemeint, beim Anlegen der in 7 Tagen.
      // "nächsten Mittwoch" am Mittwoch ist immer der in 7 Tagen.
      if (abstand === 0) abstand = !zusatz && (nacht || !neu) ? 0 : 7;
      if (/^uebernaechste/.test(zusatz)) abstand += 7;
      dazu(plus(heute, abstand));
    }
  }
  if (!erkannt) return { fehler: 'unklar', text };
  // Mehrere Angaben muessen auf denselben Tag fallen ("heute am Sonntag", "Sonntag den 15. November").
  const tage = [...new Set(kandidaten)];
  if (tage.length > 1 || tage.some((d) => !/^\d{4}-\d{2}-\d{2}$/.test(d))) return { fehler: 'widerspruch', text };
  return { iso: tage[0], art: 'tag' };
};

export type ZeitErgebnis = { hhmm: string; art: 'zeit'; relativ?: boolean } | { von: string; bis: string; art: 'spanne' } | { fehler: 'leer' | 'unklar' | 'unmoeglich'; text: string };

const hhmm = (h: number, m: number) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
const aufFuenf = (min: number) => Math.ceil(min / 5) * 5;

// Tageszeit-Woerter im Text, gelten fuer alle Zeiten darin.
const tageszeit = (t: string): 'abend' | 'mittag' | 'frueh' | 'nacht' | '' =>
  /\b(abends?|nachmittags?|pm|spaet)\b|\bheute\s+abend\b/.test(t) ? 'abend'
    : /\bmittags?\b/.test(t) ? 'mittag'
      : /\b(frueh|morgens|vormittags?|am)\b/.test(t) ? 'frueh'
        : /\bnachts?\b/.test(t) ? 'nacht' : '';

// Eine Zeitangabe ohne Spanne: "7", "7:30", "halb 8", "dreiviertel 7", "viertel nach 6", "zehn vor 8".
const einzelZeit = (roh: string, tz: string): { h: number; m: number } | 'unklar' | null => {
  const t = roh.trim();
  if (!t) return null;
  if (/\bkurz\s+(vor|nach)\b|\bgegen\b|\bca\b|\bungefaehr\b|\betwa\b/.test(t)) return 'unklar';
  let h: number | null = null;
  let m = 0;
  let x: RegExpMatchArray | null;
  const vorNach = t.match(new RegExp(`\\b${ZAHL_RE}\\s+(nach|vor)\\s+(halb\\s+)?${ZAHL_RE}\\b`));
  if ((x = t.match(/\b(\d{1,2})[:.](\d{2})\b/))) { h = Number(x[1]); m = Number(x[2]); }
  else if ((x = t.match(/\b(\d{1,2})\s*uhr\s*(\d{1,2})\b/))) { h = Number(x[1]); m = Number(x[2]); }
  else if (vorNach && !/viertel/.test(t)) {
    // "zehn nach 8", "fünf vor halb 9"
    const min = zahl(vorNach[1]) ?? NaN;
    const std = zahl(vorNach[4]) ?? NaN;
    if (min >= 30) return 'unklar';
    const basis = vorNach[3] ? (std - 1) * 60 + 30 : std * 60;
    const ges = vorNach[2] === 'nach' ? basis + min : basis - min;
    h = Math.floor(ges / 60); m = ges % 60;
  }
  else if ((x = t.match(new RegExp(`\\bdreiviertel\\s+${ZAHL_RE}\\b`)))) { h = (zahl(x[1]) ?? NaN) - 1; m = 45; }
  else if ((x = t.match(new RegExp(`\\bviertel\\s+nach\\s+${ZAHL_RE}\\b`)))) { h = zahl(x[1]); m = 15; }
  else if ((x = t.match(new RegExp(`\\bviertel\\s+vor\\s+${ZAHL_RE}\\b`)))) { h = (zahl(x[1]) ?? NaN) - 1; m = 45; }
  else if ((x = t.match(new RegExp(`\\bviertel\\s+${ZAHL_RE}\\b`)))) { h = (zahl(x[1]) ?? NaN) - 1; m = 15; }
  else if ((x = t.match(new RegExp(`\\bhalb\\s+${ZAHL_RE}\\b`)))) { h = (zahl(x[1]) ?? NaN) - 1; m = 30; }
  else if ((x = t.match(new RegExp(`\\b(?:um|ab|bis|gegen)?\\s*${ZAHL_RE}\\s*(uhr|h)?\\b`)))) h = zahl(x[1]);
  else if (/\bmitternacht\b/.test(t)) { h = 0; m = 0; }
  else if (/\bmittags?\b/.test(t)) { h = 12; m = 0; }
  if (h == null || !Number.isFinite(h)) return null;
  if (h === 24 && m === 0) h = 0;
  if (h < 0 || h > 23 || m < 0 || m > 59) return 'unklar';
  // Tag oder Nacht aus dem Zusammenhang. "acht" heisst 08:00, "heute Abend um acht" 20:00.
  if (tz === 'abend' && h >= 1 && h <= 11) h += 12;
  else if (tz === 'mittag' && h >= 1 && h <= 5) h += 12;
  else if (tz === 'nacht' && h >= 8 && h <= 11) h += 12;
  return { h, m };
};

export const zeitAufloesen = (text: string, jetzt: Jetzt): ZeitErgebnis => {
  let t = ` ${klein(text).replace(/[,;!?]/g, ' ').replace(/\s+/g, ' ').trim()} `;
  if (!t.trim()) return { fehler: 'leer', text };
  // Bezug auf jetzt steht ausdruecklich im Text ("jetzt", "in zwei Stunden"), nur dann zaehlt die Uhr.
  if (/^\s*(jetzt|sofort|gleich|asap)\s*$/.test(t)) return { hhmm: (() => { const x = aufFuenf(jetzt.minuten); return hhmm(Math.floor(x / 60) % 24, x % 60); })(), art: 'zeit', relativ: true };
  const rel = t.match(new RegExp(`\\bin\\s+(einer\\s+halben|einer\\s+viertel|${ZAHL_RE}(?:\\s*,\\s*5|\\s+einhalb)?)\\s+(stunden?|minuten?|min)\\b`));
  if (rel) {
    const menge = rel[1].includes('halben') ? 0.5 : rel[1].includes('viertel') ? 0.25 : (zahl(rel[1].split(/\s/)[0]) ?? NaN) + (/einhalb|,\s*5/.test(rel[1]) ? 0.5 : 0);
    const min = /stunde/.test(rel[3]) ? menge * 60 : menge;
    if (!Number.isFinite(min) || min <= 0 || min > 24 * 60) return { fehler: 'unklar', text };
    const x = aufFuenf(jetzt.minuten + min);
    return { hhmm: hhmm(Math.floor(x / 60) % 24, x % 60), art: 'zeit', relativ: true };
  }
  // Dauer statt Uhrzeit ("eine Stunde früher als Anna", "30 Minuten später"): keine Uhrzeit, Rueckfrage.
  if (/\b(stunden?|minuten?|min)\b/.test(t) || /\b(frueher|spaeter|vorher|nachher)\b/.test(t)) return { fehler: 'unklar', text };
  const tz = tageszeit(t);
  t = t.replace(/\buhr\b(?!\s*\d)/g, ' ');
  // Spannen: "von 8 bis 16", "8-16", "zwischen 15 und 16", "10 bis 18".
  const sp = t.match(/^(.*?)\b(?:zwischen\s+(.+?)\s+(?:und|bis)\s+(.+)|von\s+(.+?)\s+bis\s+(.+)|(\d{1,2}(?:[:.]\d{2})?)\s*(?:-|–|bis)\s*(\d{1,2}(?:[:.]\d{2})?))\s*$/);
  if (sp) {
    const a = einzelZeit(sp[2] || sp[4] || sp[6] || '', tz);
    const b = einzelZeit(sp[3] || sp[5] || sp[7] || '', tz);
    if (a === 'unklar' || b === 'unklar' || !a || !b) return { fehler: 'unklar', text };
    // "zwischen 6 und 8 abends" gilt fuer beide, "8 bis 16" braucht nichts.
    return { von: hhmm(a.h, a.m), bis: hhmm(b.h, b.m), art: 'spanne' };
  }
  const z = einzelZeit(t, tz);
  if (z === 'unklar') return { fehler: 'unklar', text };
  if (!z) return { fehler: 'unklar', text };
  return { hhmm: hhmm(z.h, z.m), art: 'zeit' };
};

// ---- Namen ---------------------------------------------------------------------------------------
export type Person = { id: string; vor: string; nach: string; nummer?: string | null; name: string };
export type NamenErgebnis = { personen: Person[]; fehler: { text: string; art: 'unbekannt' | 'mehrdeutig' | 'fuerwort'; kandidaten: Person[] }[]; alle: boolean; markierte: boolean };

export const abstand = (a: string, b: string) => {
  if (a === b) return 0;
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j += 1) d[0][j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
};
// Erlaubter Tippfehler-Abstand je Wortlaenge: kurze Namen nur exakt, "Brnuo" (5) einer, ab 8 Buchstaben zwei.
const grenze = (n: number) => (n <= 3 ? 0 : n <= 7 ? 1 : 2);
// Gleich klingende Schreibweisen vor dem Vergleich angleichen: Stephano/Stefano, Marwin/Marvin, Maier/Meier.
const klang = (x: string) => klein(x).replace(/ph/g, 'f').replace(/th/g, 't').replace(/w/g, 'v').replace(/ck/g, 'k').replace(/c(?=[aou])/g, 'k')
  .replace(/dt\b/g, 't').replace(/ie/g, 'i').replace(/y/g, 'i').replace(/ai/g, 'ei').replace(/(.)\1/g, '$1');
const aehnlich = (wort: string, name: string) => {
  const w = klein(wort);
  const n = klein(name);
  if (!w || !n) return false;
  // Genitiv-s ("Annas", "Stefanos") zaehlt als derselbe Name.
  if (w === n || w === `${n}s` || n === `${w}s`) return true;
  // Grenze nach der echten Laenge, nicht nach der angeglichenen ("Anna" wird "ana").
  return abstand(klang(w), klang(n)) <= grenze(Math.min(w.length, n.length));
};

const FUERWORT = /^(er|ihn|ihm|sie|ihr|ihnen|der|die|den|dem|denen|dieser|diese|diesen|derselbe|beide|beiden|die beiden|selbe)$/;
const TITEL = /\b(herrn?|frau|fahrer(in)?|dr|prof|chauffeur|der|die|den|dem|von|vom)\b\.?/g;
const ALLE = /^(alle|allen|alle fahrer|allen fahrern|jeder|jeden|jedem|saemtliche|alle anderen|allen anderen|die anderen|den anderen|alle uebrigen|alle\s+\w+)$/;

// Fahrer- oder Gastnamen aus Textfeldern gegen die Datenbank. Mehrdeutig und unbekannt werden nie geraten.
export const namenAufloesen = (texte: string[], personen: Person[]): NamenErgebnis => {
  const erg: NamenErgebnis = { personen: [], fehler: [], alle: false, markierte: false };
  for (const roh of texte) {
    const text = klein(roh).replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    if (/markiert/.test(text)) { erg.markierte = true; continue; }
    if (ALLE.test(text) && !/^alle\s+(?!fahrer|anderen|uebrigen)/.test(text)) { erg.alle = true; continue; }
    if (FUERWORT.test(text)) { erg.fehler.push({ text: roh, art: 'fuerwort', kandidaten: [] }); continue; }
    const nr = text.match(/^(?:nr|nummer|fahrer)?\s*#?(\d{1,4})$/);
    if (nr) {
      const p = personen.filter((x) => String(x.nummer ?? '') === nr[1]);
      if (p.length === 1) erg.personen.push(p[0]); else erg.fehler.push({ text: roh, art: p.length ? 'mehrdeutig' : 'unbekannt', kandidaten: p });
      continue;
    }
    const woerter = text.replace(TITEL, ' ').split(' ').filter((w) => w.length >= 2);
    if (!woerter.length) { erg.fehler.push({ text: roh, art: 'unbekannt', kandidaten: [] }); continue; }
    // Stufe 3: Vor- und Nachname, Stufe 2: ein Name exakt, Stufe 1: ein Name mit Tippfehler.
    const stufe = (p: Person) => {
      const vor = klein(p.vor);
      const nach = klein(p.nach);
      if (woerter.length >= 2) {
        // Zwei Woerter muessen beide passen. "Tim Boberschmidt" ist nicht Tim Schedler.
        const [a, b] = [woerter[0], woerter[woerter.length - 1]];
        if (aehnlich(a, vor) && aehnlich(b, nach)) return a === vor && b === nach ? 4 : 3;
        if (aehnlich(a, nach) && aehnlich(b, vor)) return 3;
        // Verhoerter Nachname nach passendem Vornamen ("Stefanos Bandy" fuer Stefano Spandri): Abstand bis zur
        // Haelfte, wie namenAngleichen.ts. Gilt nur, wenn der Vorname genau eine Person trifft (siehe unten).
        if (aehnlich(a, vor) && b.length >= 4 && abstand(klang(b), klang(nach)) <= Math.floor(klang(nach).length / 2)) return 1;
        return 0;
      }
      const w = woerter[0];
      if (w === vor || w === nach || w === `${vor}s` || w === `${nach}s`) return 2;
      if (aehnlich(w, vor) || aehnlich(w, nach)) return 1;
      return 0;
    };
    const bewertet = personen.map((p) => ({ p, s: stufe(p) })).filter((x) => x.s > 0);
    const best = Math.max(0, ...bewertet.map((x) => x.s));
    const treffer = bewertet.filter((x) => x.s === best).map((x) => x.p);
    if (treffer.length === 1) erg.personen.push(treffer[0]);
    else erg.fehler.push({ text: roh, art: treffer.length ? 'mehrdeutig' : 'unbekannt', kandidaten: treffer });
  }
  erg.personen = [...new Map(erg.personen.map((p) => [p.id, p])).values()];
  return erg;
};

const DISPO_ROLLEN = new Set(['dispo', 'admin', 'pruefung', 'disponent', 'koordinator']);
export const fahrerLaden = async (admin: any): Promise<Person[]> => {
  const { data } = await admin.from('profiles').select('id, first_name, last_name, driver_number, role, is_dispo');
  return (Array.isArray(data) ? data : [])
    .filter((p: any) => !DISPO_ROLLEN.has(String(p?.role || '').toLowerCase()) && !p?.is_dispo)
    .map((p: any) => ({ id: String(p.id), vor: String(p.first_name || ''), nach: String(p.last_name || ''), nummer: p.driver_number == null ? null : String(p.driver_number), name: [p.first_name, p.last_name].filter(Boolean).join(' ') }));
};

// ---- Fahrt-Bezug ---------------------------------------------------------------------------------
export type Fahrt = { id: string; datum: string; zeit: string; fahrerId: string | null; gaeste: string[]; von: string; nach: string; status: string };
export type FahrtErgebnis = { fahrt: Fahrt } | { fehler: 'keine' | 'mehrere' | 'ohne_angabe'; liste: Fahrt[] };

export const fahrtenLaden = async (admin: any, von: string, bis: string): Promise<Fahrt[]> => {
  const { data } = await admin.from('jobs').select('*').gte('ride_date', von).lte('ride_date', bis);
  const { data: jg } = await admin.from('job_guests').select('job_id, guest_id');
  const { data: gaeste } = await admin.from('guests').select('id, first_name, last_name');
  const gastName = new Map((Array.isArray(gaeste) ? gaeste : []).map((g: any) => [String(g.id), [g.first_name, g.last_name].filter(Boolean).join(' ')]));
  return (Array.isArray(data) ? data : [])
    .filter((j: any) => !['cancelled', 'done', 'deleted'].includes(String(j.status)))
    .map((j: any) => ({
      id: String(j.id), datum: String(j.ride_date), zeit: String(j.etd || '').slice(0, 5), fahrerId: j.driver_id ? String(j.driver_id) : null,
      gaeste: [...(Array.isArray(j.passengers) ? j.passengers.map(String) : []),
        ...(Array.isArray(jg) ? jg : []).filter((x: any) => String(x.job_id) === String(j.id)).map((x: any) => gastName.get(String(x.guest_id)) || '')].filter(Boolean),
      von: String(j.pickup_name || j.pickup_address || ''), nach: String(j.dropoff_name || j.dropoff_address || ''), status: String(j.status),
    }));
};

// Welche vorhandene Fahrt gemeint ist. Jede Angabe muss passen, mehrere Treffer heisst Rueckfrage.
export const fahrtAufloesen = (fahrten: Fahrt[], a: { gast?: string; fahrerIds?: string[]; datum?: string | null; zeit?: string | null; ort?: string; letzteFahrtId?: string | null }): FahrtErgebnis => {
  const gast = klein(a.gast || '').replace(TITEL, ' ').trim();
  const ort = klein(a.ort || '').trim();
  const hatAngabe = !!(gast || a.fahrerIds?.length || a.datum || a.zeit || ort);
  if (!hatAngabe) {
    const f = a.letzteFahrtId ? fahrten.find((x) => x.id === a.letzteFahrtId) : null;
    return f ? { fahrt: f } : { fehler: 'ohne_angabe', liste: [] };
  }
  const passt = fahrten.filter((f) => {
    if (gast && !f.gaeste.some((g) => klein(g).split(/\s+/).some((w) => gast.split(/\s+/).some((x) => x.length >= 3 && aehnlich(x, w))))) return false;
    if (a.fahrerIds?.length && !a.fahrerIds.includes(String(f.fahrerId))) return false;
    if (a.datum && f.datum !== a.datum) return false;
    if (a.zeit && f.zeit !== a.zeit) return false;
    if (ort && !klein(`${f.von} ${f.nach}`).includes(ort)) return false;
    return true;
  });
  if (passt.length === 1) return { fahrt: passt[0] };
  return { fehler: passt.length ? 'mehrere' : 'keine', liste: passt };
};

// ---- Steht im Satz? ------------------------------------------------------------------------------
// Jedes Textfeld des Formulars muss im Satz vorkommen: als Wortfolge, Woerter mit kleinem Tippfehler erlaubt.
export const imSatz = (wert: string, satz: string) => {
  const w = klein(wert).replace(/[^a-z0-9: ]+/g, ' ').split(/\s+/).filter(Boolean);
  if (!w.length) return true;
  const s = klein(satz).replace(/[^a-z0-9: ]+/g, ' ').split(/\s+/).filter(Boolean);
  // Uhrzeiten "07:30" stehen im Satz oft als "7:30" oder "7.30".
  const gleich = (a: string, b: string) => a === b || a.replace(/^0(\d)/, '$1') === b.replace(/^0(\d)/, '$1') || (a.length >= 4 && aehnlich(a, b));
  for (let i = 0; i + w.length <= s.length; i += 1) if (w.every((x, k) => gleich(x, s[i + k]))) return true;
  // Woerter in anderer Reihenfolge oder mit Fuellwort dazwischen: alle muessen einzeln vorkommen.
  return w.every((x) => s.some((y) => gleich(x, y)));
};
