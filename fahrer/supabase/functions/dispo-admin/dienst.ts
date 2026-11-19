// Dienste per KI-Assistent: Dienststart, Pause und Dienstende fuer Fahrer.
//
// Erkennt Saetze wie
//   "schick die alle in Feierabend"              (markierte Fahrer, Dienstende jetzt)
//   "Schick Stefano heute 00:30"                 (Dienststart)
//   "Dienst fuer Stefano morgen 7 bis 15 Uhr"    (Start und Ende)
//   "Stefano Pause von 12 bis 12:30"             (Pause im Dienst des Tages)
//   "Anna und Fahrer 12 Dienstende Freitag 18 Uhr"
// Fahrer: im Text genannte Namen oder Fahrernummern, sonst die auf der Karte markierten.
// Antwort ohne Modell als Vorschlag (action.type 'dienst_vorschlag'); erst der Knopf in
// der App schickt ihn ab, mit aktion 'dienst_senden'. Geht auch, wenn das Modell aus ist.
//
// dienst_senden schreibt dasselbe wie "Dienste planen": je Fahrer und Tag eine Anfrage in
// driver_service_requests (nur was gesetzt ist), die Zeit am Profil, Pausen in dienst_pausen.
// Nur eine Pause ohne Start/Ende haengt an der juengsten Anfrage des Fahrers fuer den Tag.

// deno-lint-ignore-file no-explicit-any

import { ausnahmen, ausnahmenText, ohneAusnahmen } from './ausnahmen.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UHRZEIT = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATUM = /^\d{4}-\d{2}-\d{2}$/;
const DISPO_ROLLEN = new Set(['dispo', 'dispatcher', 'admin', 'koordinator', 'coordinator', 'pruefung']);

type Fahrer = { id: string; name: string };
type Pause = { von: string; bis: string };

export const normal = (text: string) => ` ${String(text || '').toLowerCase()
  .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
  .replace(/[^a-z0-9:.\-– ]+/g, ' ')
  .replace(/\s+/g, ' ')} `;

// Datum oder Uhrzeit nach einem Wort: dann ist "Start am Samstag" ein Dienst, "Start am Bahnhof" ein Ort.
const ZEIT_FOLGT = '(?:montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag|heute|morgen|uebermorgen|um|ab|\\d)';
// Steht ein Ort hinter start/ende/beginn ("Start in Offenburg", "Ende am Bahnhof"), ist es Start/Ziel einer Fahrt
// und kein Dienst (ki_protokoll 12.11.).
const OHNE_ORT = `(?!\\s+(?:in|im|am|an|ab|bei|beim|vom|von|zum|zur|ist|:)\\s+(?!${ZEIT_FOLGT}))`;
const ENDE_RE = new RegExp(`feierabend|dienstende|dienst\\s*ende|dienst\\s*(be)?enden|schicht\\s*ende|nach\\s*hause|heim\\s*schick|heimfahren|schluss\\s+machen|ausstempeln|\\bende\\b${OHNE_ORT}`);
// "dienstart" ist ein haeufiger Tippfehler fuer Dienststart.
const START_RE = new RegExp(`dienststart|dienstart|dienst\\s+start|dienstbeginn|dienst\\s*(be)?ginnen|dienst\\s+starten|anfangen|einstempeln|in\\s+den\\s+dienst|\\bstart\\b${OHNE_ORT}|\\bbeginn\\b${OHNE_ORT}|\\banfang\\b${OHNE_ORT}|\\bfaengt\\b|\\bbeginnt\\b`);
const DIENST_RE = /dienst|schicht|feierabend|pause|stempel/;
// Schwache Hinweise, nur wenn ein Fahrer und eine Uhrzeit ohne Fahrt-Woerter dastehen ("Tim kommt morgen um 7",
// "Stefano heute bis 18 Uhr"). Allein machen sie keinen Dienst.
const SCHWACH_START = /\b(starten|startet|beginnen|kommt|kommen|arbeitet|arbeiten|faengt)\b|\bab\s+(halb\s+)?\d/;
const SCHWACH_ENDE = /\bhoer\w*\b.*\bauf\b|\bschluss\b|\bbis\s+(halb\s+)?\d|\baufhoer\w*/;
const SCHICK_RE = /\b(schick|schicke|schickt|sende|setz|setze|plan|plane)\b/;
// Ohne Dienst-Wort klingt "schick X um 10 zum Flughafen" nach einer Fahrt, nicht nach einem Dienst.
const FAHRT_RE = /fahrt|buch|abhol|flughafen|terminal|hotel|bahnhof|\bzum\b|\bzur\b|\bnach\b|gast|gaeste/;

// Datum und Uhrzeit in Deutschland.
export const jetztBerlin = () => {
  const teile = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date()).map((t) => [t.type, t.value]));
  return { datum: `${teile.year}-${teile.month}-${teile.day}`, minuten: Number(teile.hour) * 60 + Number(teile.minute) };
};
export const plusTage = (iso: string, n: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
export const uhr = (min: number) => {
  const x = ((min % 1440) + 1440) % 1440;
  return `${String(Math.floor(x / 60)).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`;
};
const zuMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
// Nachts (00:00 bis 05:00) gelten "heute" und "morgen" als unsicher, siehe datumAusText.
export const nachts = (heute: string) => {
  const j = jetztBerlin();
  return j.datum === heute && j.minuten < 5 * 60;
};
// Tag fuer Vorschlaege: nachts immer mit Wochentag und Datum ("heute, So 15.11."), damit klar ist, welcher gemeint ist.
export const tagKlar = (iso: string, heute: string) => {
  const t = tagLesbar(iso, heute);
  if (!nachts(heute) || /\d/.test(t)) return t;
  const d = new Date(`${iso}T12:00:00Z`);
  return `${t}, ${['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'][d.getUTCDay()]} ${iso.slice(8, 10)}.${iso.slice(5, 7)}.`;
};
export const tagLesbar = (iso: string, heute: string) => {
  if (iso === heute) return 'heute';
  if (iso === plusTage(heute, 1)) return 'morgen';
  if (iso === plusTage(heute, -1)) return 'gestern';
  const d = new Date(`${iso}T12:00:00Z`);
  return `${['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'][d.getUTCDay()]} ${iso.slice(8, 10)}.${iso.slice(5, 7)}.`;
};

const WOCHENTAGE = ['sonntag', 'montag', 'dienstag', 'mittwoch', 'donnerstag', 'freitag', 'samstag'];
// heute, morgen, uebermorgen, Wochentag (naechster nach heute), 14.11. / 14.11.2026
// Ein Tag ist im Text genannt (auch gestern, vorgestern, "letzten Montag").
export const TAG_RE = /\b(heute|morgen|uebermorgen|gestern|vorgestern|montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag)\b|\b[0-3]?\d\.[01]?\d\./;
// neu: es wird etwas Neues angelegt (Dienst, Standby, Kopie). Dann meint der heutige Wochentag den in 7 Tagen.
// Ohne neu (vorhandene Fahrt, Frage, Loeschen) bleibt heute eingeschlossen.
// Abstand in Wochen oder Tagen und "übernächsten Freitag" (16.11.): rechnen statt dem Modell glauben.
// "in drei Wochen am Dienstag" ergab Mi 16.12. und Mi 02.12. statt Di 08.12., "übernächsten Freitag" den nächsten.
// Mit Wochentag: der Wochentag in der Woche (Montag bis Sonntag), in der der Tag in n Wochen liegt.
const ZAHLWORT: Record<string, number> = { ein: 1, eine: 1, einer: 1, einem: 1, zwei: 2, drei: 3, vier: 4, fuenf: 5, sechs: 6, sieben: 7, acht: 8, neun: 9, zehn: 10 };
export const relativDatum = (roh: string, heute: string): string | null => {
  const t = String(roh || '').toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue');
  const zahl = (w: string) => (/^\d+$/.test(w) ? Number(w) : ZAHLWORT[w] ?? 0);
  const heuteTag = new Date(`${heute}T12:00:00Z`).getUTCDay();
  const wt = WOCHENTAGE.findIndex((w) => new RegExp(`\\b${w}s?\\b`).test(t));
  const wochen = t.match(/\bin\s+(\d{1,2}|ein|einer|zwei|drei|vier|fuenf|sechs|sieben|acht)\s+wochen?\b/);
  if (wochen) {
    const n = zahl(wochen[1]);
    if (n < 1 || n > 52) return null;
    const basis = plusTage(heute, 7 * n);
    if (wt < 0) return basis;
    const montag = plusTage(basis, -((heuteTag + 6) % 7));
    return plusTage(montag, (wt + 6) % 7);
  }
  const tage = t.match(/\bin\s+(\d{1,3}|zwei|drei|vier|fuenf|sechs|sieben|acht|neun|zehn)\s+tagen\b/);
  if (tage) {
    const n = zahl(tage[1]);
    return n >= 1 && n <= 365 ? plusTage(heute, n) : null;
  }
  if (wt >= 0 && /\buebernaechste[nmrs]?\b/.test(t) && !/\bwoche\b/.test(t)) return plusTage(heute, (((wt - heuteTag + 7) % 7) || 7) + 7);
  return null;
};

export const datumAusText = (text: string, heute: string, neu = false) => {
  if (/\bvorgestern\b/.test(text)) return plusTage(heute, -2);
  if (/\bgestern\b/.test(text)) return plusTage(heute, -1);
  const relativ = relativDatum(text, heute);
  if (relativ) return relativ;
  // "letzten Montag", "vergangenen Freitag": der zuletzt gewesene Tag, nie heute.
  const letzter = text.match(/\b(letzte[nmrs]?|vergangene[nmrs]?|vorige[nmrs]?)\s+(montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag)\b/);
  if (letzter) {
    const ziel = WOCHENTAGE.indexOf(letzter[2]);
    const heuteTag = new Date(`${heute}T12:00:00Z`).getUTCDay();
    return plusTage(heute, -(((heuteTag - ziel + 7) % 7) || 7));
  }
  // Datumsgrenze (15.11.): nachts vor 05:00 meint "morgen" den Tag nach dem Schlafen, also das heutige
  // Kalenderdatum (01:46 "Dienststart morgen 10:30" war Sonntag gemeint, gebucht wurde Montag).
  const nacht = nachts(heute);
  if (/\buebermorgen\b/.test(text)) return plusTage(heute, nacht ? 1 : 2);
  if (/\bmorgen\b/.test(text)) return plusTage(heute, nacht ? 0 : 1);
  const tagMonat = text.match(/\b([0-3]?\d)\.([01]?\d)\.(\d{4})?/);
  if (tagMonat) {
    const jahr = tagMonat[3] ? Number(tagMonat[3]) : Number(heute.slice(0, 4));
    let iso = `${jahr}-${String(tagMonat[2]).padStart(2, '0')}-${String(tagMonat[1]).padStart(2, '0')}`;
    if (!tagMonat[3] && iso < heute) iso = `${jahr + 1}${iso.slice(4)}`;
    if (DATUM.test(iso)) return iso;
  }
  // Wochentag: der naechste ab heute. Bei neu und heutigem Wochentag der in 7 Tagen (fuer heute sagt man
  // "heute"), ausser "heute" steht dabei ("heute Samstag").
  const heuteTag = new Date(`${heute}T12:00:00Z`).getUTCDay();
  for (let i = 0; i < 7; i += 1) {
    // Nachts vor 05:00 meint der heutige Wochentag heute ("am Sonntag um 9" um 01:30 am Sonntag), nicht in 7 Tagen.
    if (new RegExp(`\\b${WOCHENTAGE[i]}\\b`).test(text)) return plusTage(heute, ((i - heuteTag + 7) % 7) || (neu && !nacht && !/\bheute\b/.test(text) ? 7 : 0));
  }
  return heute;
};

// Alle Uhrzeiten mit Position: "12:30", "12.30", "12 uhr", "um 7", "halb 8".
// Datumsangaben wie "14.11." werden vorher entfernt.
export const zeitenAusText = (text: string) => {
  const ohneDatum = text.replace(/\b[0-3]?\d\.[01]?\d\.(\d{4})?/g, (m) => ' '.repeat(m.length));
  const treffer: { pos: number; zeit: string }[] = [];
  const H = '([01]?\\d|2[0-3])';
  const M = '(?:[:.]([0-5]\\d))?';
  // Bereich zuerst: "7-15", "07:00 bis 15:30", "von 8 bis 16 uhr"
  const bereich = new RegExp(`\\b${H}${M}\\s*(?:uhr\\s*)?(?:-|–|bis)\\s*${H}${M}\\b`, 'g');
  const belegt: [number, number][] = [];
  let m: RegExpExecArray | null;
  while ((m = bereich.exec(ohneDatum))) {
    treffer.push({ pos: m.index, zeit: uhr(Number(m[1]) * 60 + Number(m[2] || 0)) });
    treffer.push({ pos: m.index + 1, zeit: uhr(Number(m[3]) * 60 + Number(m[4] || 0)) });
    belegt.push([m.index, m.index + m[0].length]);
  }
  const frei = (von: number, bis: number) => !belegt.some(([a, b]) => von < b && bis > a);
  // "morgen frueh 7": Zahl nach frueh/vormittags zaehlt als Uhrzeit.
  const einzel = new RegExp(`\\bhalb\\s+${H}\\b|\\b${H}[:.]([0-5]\\d)\\b|\\b${H}\\s*uhr\\b|\\b(?:um|ab|von|bis|gegen|frueh|vormittags|nachmittags|abends|nachts|heute|morgen|uebermorgen|start|beginn|anfang|ende|feierabend|schluss|dienststart|dienstart|dienstbeginn|dienstende|schichtbeginn|schichtende)\\s+${H}${M}\\b`, 'g');
  while ((m = einzel.exec(ohneDatum))) {
    if (!frei(m.index, m.index + m[0].length)) continue;
    let min: number;
    if (m[1]) min = (Number(m[1]) - 1) * 60 + 30;
    else if (m[2]) min = Number(m[2]) * 60 + Number(m[3]);
    else if (m[4]) min = Number(m[4]) * 60;
    else min = Number(m[5]) * 60 + Number(m[6] || 0);
    treffer.push({ pos: m.index, zeit: uhr(min) });
  }
  return treffer.sort((x, y) => x.pos - y.pos);
};
// "in 30 min", "in einer stunde" relativ zu jetzt.
const relativeZeit = (text: string, jetzt: number) => {
  const inMin = text.match(/\bin\s+(\d{1,3})\s*(min|minuten)\b/);
  if (inMin) return uhr(jetzt + Number(inMin[1]));
  const inStd = text.match(/\bin\s+(einer|\d{1,2})\s*(std|stunde|stunden)\b/);
  if (inStd) return uhr(jetzt + (inStd[1] === 'einer' ? 1 : Number(inStd[1])) * 60);
  return null;
};

export const markierteFahrer = (body: any): Fahrer[] => (Array.isArray(body?.markierteFahrer) ? body.markierteFahrer : [])
  .slice(0, 100)
  .map((f: any) => ({ id: String(f?.id || '').trim().toLowerCase(), name: String(f?.name || '').trim().slice(0, 80) }))
  .filter((f: any) => UUID.test(f.id));

// Fahrer, die im Text mit Namen oder Nummer genannt sind.
export const genannteFahrer = async (admin: any, text: string): Promise<Fahrer[]> => {
  const { data, error } = await admin.from('profiles').select('id, first_name, last_name, driver_number, role');
  if (error || !Array.isArray(data)) return [];
  const fahrer = data
    .filter((p: any) => !DISPO_ROLLEN.has(String(p?.role || '').toLowerCase()))
    .map((p: any) => ({
      id: String(p.id),
      name: [p.first_name, p.last_name].filter(Boolean).join(' ').trim(),
      vor: normal(p.first_name).trim(),
      nach: normal(p.last_name).trim(),
      nr: p.driver_number == null ? '' : String(p.driver_number).trim(),
    }));
  // "Stefanos Dienst": Genitiv-s zaehlt mit.
  const enthaelt = (wort: string) => wort.length >= 2 && new RegExp(`\\b${wort.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}s?\\b`).test(text);
  const gefunden = new Map<string, Fahrer>();
  for (const f of fahrer) {
    const voll = `${f.vor} ${f.nach}`.trim();
    if (voll.includes(' ') && enthaelt(voll)) gefunden.set(f.id, { id: f.id, name: f.name });
  }
  // Vor- oder Nachname allein nur, wenn er eindeutig ist.
  for (const feld of ['vor', 'nach'] as const) {
    const zaehler = new Map<string, number>();
    fahrer.forEach((f: any) => f[feld] && zaehler.set(f[feld], (zaehler.get(f[feld]) || 0) + 1));
    for (const f of fahrer) {
      if (gefunden.has(f.id) || !f[feld] || zaehler.get(f[feld]) !== 1) continue;
      if (enthaelt(f[feld])) gefunden.set(f.id, { id: f.id, name: f.name });
    }
  }
  for (const m of text.matchAll(/\b(?:fahrer|nr|nummer)\s*(\d{1,4})\b/g)) {
    const f = fahrer.find((x: any) => x.nr === m[1]);
    if (f) gefunden.set(f.id, { id: f.id, name: f.name });
  }
  // Ausgenommene (ausnahmen.ts) fallen weg. "Alle" kommt nie von hier, nur aus "alle" im Satz oder den
  // Modell-Feldern, damit ein falsch gelesenes "ausser" nie alle Fahrer trifft.
  return ohneAusnahmen(admin, [...gefunden.values()]);
};

type Bestehend = { id: string; start: string | null; ende: string | null; status: string };

// Juengster Dienst je Fahrer an dem Tag, der noch gilt (offen oder angenommen).
const bestehendeDienste = async (admin: any, ids: string[], datum: string) => {
  const ergebnis = new Map<string, Bestehend>();
  if (!ids.length) return ergebnis;
  const { data, error } = await admin.from('driver_service_requests')
    .select('id, driver_id, service_start_time, service_end_time, status, created_at')
    .in('driver_id', ids).eq('service_date', datum).in('status', ['pending', 'accepted'])
    .order('created_at', { ascending: false });
  if (error || !Array.isArray(data)) return ergebnis;
  for (const d of data) {
    const id = String(d.driver_id);
    if (ergebnis.has(id)) continue;
    ergebnis.set(id, {
      id: String(d.id),
      start: d.service_start_time ? String(d.service_start_time).slice(0, 5) : null,
      ende: d.service_end_time ? String(d.service_end_time).slice(0, 5) : null,
      status: String(d.status),
    });
  }
  return ergebnis;
};

const dienstText = (b: Bestehend) => {
  const zeit = b.start && b.ende ? `${b.start}–${b.ende}` : (b.start ? `ab ${b.start}` : `bis ${b.ende}`);
  return `${zeit}${b.status === 'accepted' ? ', angenommen' : ', noch nicht bestätigt'}`;
};

// Altes Dienstende liegt vor (oder auf) dem neuen Start und ist kein Ende nach Mitternacht (vor 06:00).
const altesEndeVorStart = (b: Bestehend, start: string) => !!b.ende && zuMin(b.ende) <= zuMin(start) && zuMin(b.ende) >= 6 * 60;

// Was eine Angabe bei schon vorhandenem Dienst bedeutet. Ein einzelner "Start" nach dem
// Dienstbeginn ist meist das Ende, in der Nacht (vor 06:00) ebenso; mitten im Dienst eine Pause.
const aufVorhandenen = (b: Bestehend, start: string | null, ende: string | null, pausen: Pause[], ausdruecklichStart = false) => {
  if (!start || ende || pausen.length) return { start, ende, pausen, frage: '' };
  const t = zuMin(start);
  if (b.start && t === zuMin(b.start)) return null; // gleicher Start: nichts zu tun
  // "Dienststart 22:00" ausdruecklich gesagt: das ist der Start, nicht geraten Ende oder Pause.
  if (ausdruecklichStart) {
    if (altesEndeVorStart(b, start)) return { start, ende: null, pausen, frage: '', hinweis: `Das alte Dienstende ${b.ende} liegt davor und fällt weg. ` };
    return { start, ende: null, pausen, frage: b.start ? `Dienststart von ${b.start} auf ${start} ändern?` : `${start} als Dienststart?` };
  }
  if (b.start && !b.ende) {
    if (t > zuMin(b.start) || t < 6 * 60) return { start: null, ende: start, pausen, frage: `${start} als Dienstende?` };
    return { start, ende: null, pausen, frage: `Dienststart von ${b.start} auf ${start} vorverlegen?` };
  }
  if (b.start && b.ende) {
    if (t < zuMin(b.start) && t >= 6 * 60) return { start, ende: null, pausen, frage: `Dienststart von ${b.start} auf ${start} vorverlegen?` };
    if (t > zuMin(b.ende) || t < 6 * 60) return { start: null, ende: start, pausen, frage: `Dienstende von ${b.ende} auf ${start} verschieben?` };
    // Mitten im Dienst ohne Wort dazu: nicht raten, sondern fragen (kein Vorschlag zum Senden).
    return { start: null, ende: null, pausen, frage: '', unklar: `${start} liegt mitten im Dienst. Meinst du das Dienstende („Dienstende ${start}“) oder eine Pause („Pause ${start} bis ${uhr(t + 30)}“)?` };
  }
  // nur Ende vorhanden
  if (b.ende && t < zuMin(b.ende)) return { start, ende: null, pausen, frage: `${start} als Dienststart?` };
  return { start: null, ende: start, pausen, frage: `Dienstende von ${b.ende} auf ${start} verschieben?` };
};

// "alle Fahrer", "allen Fahrern", "jedem Fahrer": alle Fahrer (ohne Dispo- und Pruefkonten).
const ALLE_FAHRER_RE = /\b(alle[nm]?|saemtliche[n]?)\s+(unseren?\s+)?fahrer(n|innen)?\b|\bjede[nmr]?\s+fahrer\b/;
export const alleFahrer = async (admin: any): Promise<Fahrer[]> => {
  const { data } = await admin.from('profiles').select('id, first_name, last_name, role');
  return (Array.isArray(data) ? data : [])
    .filter((p: any) => !DISPO_ROLLEN.has(String(p?.role || '').toLowerCase()))
    .map((p: any) => ({ id: String(p.id), name: [p.first_name, p.last_name].filter(Boolean).join(' ').trim() }))
    // Ausgenommene ("alle außer Tim") fallen weg, siehe ausnahmen.ts.
    .filter((f: Fahrer) => !ausnahmen(admin).some((a) => a.id.toLowerCase() === f.id.toLowerCase()));
};

// Tage im Text: "heute 22:00 und Samstag 7:30" sind zwei Dienste. Getrennt wird nur an "und" oder ",",
// nicht an "bis" ("von heute bis morgen").
const TAG_WORT = new RegExp(`\\b(heute|morgen|uebermorgen|${WOCHENTAGE.join('|')}|[0-3]?\\d\\.[01]?\\d\\.(\\d{4})?)`, 'g');
const tageTeilen = (text: string, heute: string): string[] => {
  const treffer = [...text.matchAll(TAG_WORT)].map((m) => ({ pos: m.index!, datum: datumAusText(` ${m[0]} `, heute, true) }));
  if (new Set(treffer.map((t) => t.datum)).size < 2) return [text];
  const schnitte: number[] = [];
  for (let i = 1; i < treffer.length; i += 1) {
    if (treffer[i].datum === treffer[i - 1].datum) continue;
    const zwischen = text.slice(treffer[i - 1].pos, treffer[i].pos);
    const m = zwischen.match(/(?:\s(?:und|sowie)\s|,)(?!.*(?:\s(?:und|sowie)\s|,))/);
    if (!m || /\bbis\b/.test(zwischen.slice(m.index!))) return [text];
    schnitte.push(treffer[i - 1].pos + m.index!);
  }
  const teile: string[] = [];
  let von = 0;
  for (const s of schnitte) { teile.push(text.slice(von, s)); von = s; }
  teile.push(text.slice(von));
  return teile.map((t) => ` ${t.replace(/^\s*(,|und|sowie)\s*/, '')} `);
};

type Vorschlag = { datum: string; start: string | null; ende: string | null; pausen: Pause[]; fahrer: Fahrer[] };
const vorschlagText = (v: Vorschlag, heute: string) => [
  v.start ? `Dienststart ${v.start}` : '',
  ...v.pausen.map((p) => `Pause ${p.von}–${p.bis}`),
  v.ende ? `Dienstende ${v.ende}` : '',
].filter(Boolean).join(', ') + ` ${tagLesbar(v.datum, heute)}`;

// "naechste Woche", "diese Woche", "kommende Woche": Montag bis Sonntag als ISO-Daten. Sonst null.
export const wocheBereich = (text: string, heute: string): { von: string; bis: string } | null => {
  const m = text.match(/\b(naechste|kommende|diese|dieser)\s+woche\b/);
  if (!m) return null;
  const wt = (new Date(`${heute}T12:00:00Z`).getUTCDay() + 6) % 7; // Mo = 0
  const montag = plusTage(heute, -wt + (m[1] === 'diese' || m[1] === 'dieser' ? 0 : 7));
  return { von: montag, bis: plusTage(montag, 6) };
};
// Welche Tage der Woche: "werktags", "Mo-Fr", "Montag bis Freitag" = 5 Tage, "jeden Tag", "taeglich", "ganze Woche" = 7.
export const wochenTage = (text: string, w: { von: string; bis: string }, heute: string): string[] | null => {
  const fuenf = /\b(werktags|werktage|mo\s*-\s*fr|mo\s+bis\s+fr|montag\s+bis\s+freitag)\b/.test(text);
  const sieben = /\b(jeden\s+tag|taeglich|ganze[n]?\s+woche|alle\s+tage|montag\s+bis\s+sonntag|mo\s*-\s*so)\b/.test(text);
  if (!fuenf && !sieben) return null;
  const tage = Array.from({ length: fuenf ? 5 : 7 }, (_, i) => plusTage(w.von, i));
  return tage.filter((t) => t >= heute);
};

// Vorschlag, wenn die Frage einen Dienst (Start, Pause, Ende) fuer Fahrer meint. Sonst null.
// Mehrere Tage in einer Nachricht: Liste mit Rueckfrage, "ja" sendet alle (kontext.offeneDienste).
// ausGespraech (16.11.): Die Fahrer kommen nicht von der Karte, sondern aus dem Gespräch ("Dann schick ihr
// Dienststart …"). Die Antwort nennt sie dann nur beim Namen, nicht "den markierten Fahrer".
export const dienstVorschlag = async (admin: any, frage: string, markiert: Fahrer[], kontext: any = null, ausGespraech = false) => {
  const text = normal(frage);
  const { datum: heute } = jetztBerlin();
  // Ganze Woche: "Plan die Dienste für nächste Woche, jeden Tag 7 bis 15 für Tim"
  const woche = wocheBereich(text, heute);
  const wochentage = woche ? wochenTage(text, woche, heute) : null;
  if (woche && wochentage?.length) {
    const ohneTage = text.replace(/\b(naechste|kommende|diese|dieser)\s+woche\b|\b(werktags|werktage|jeden\s+tag|taeglich|ganze[n]?\s+woche|alle\s+tage)\b|\b(mo|montag)\s*(-|bis)\s*(fr|freitag|so|sonntag)\b/g, ' ');
    const basis = await dienstEinTag(admin, ` dienst ${ohneTage} `, markiert, null, true);
    if (!basis || !('fahrer' in basis)) return null;
    const fahrer = basis.fahrer as Fahrer[];
    const vorschlaege: Vorschlag[] = [];
    for (const tag of wochentage) {
      const r = await dienstEinTag(admin, ` dienst ${ohneTage} am ${tag.slice(8, 10)}.${tag.slice(5, 7)}.${tag.slice(0, 4)} `, markiert, fahrer);
      if (!r) continue;
      if (!r.action) return { answer: String(r.answer || '') };
      const v = r.action.vorschlag;
      vorschlaege.push({ datum: v.datum, start: v.start, ende: v.ende, pausen: v.pausen, fahrer: v.fahrer });
    }
    if (!vorschlaege.length) return null;
    const k = { ...(kontext || {}) };
    delete k.offeneDienstLoeschung;
    return {
      answer: `Ich habe ${vorschlaege.length} Dienste für ${fahrer.map((f) => f.name).join(', ')} erkannt:\n${vorschlaege.map((v, i) => `${i + 1}. ${vorschlagText(v, heute)}`).join('\n')}\n\nMit „ja“ sende ich alle. Mit „nein“ breche ich ab.`,
      kontext: { ...k, offeneDienste: { liste: vorschlaege.map((v) => ({ ...v, fahrerIds: v.fahrer.map((f) => f.id) })), zeit: Date.now() } },
    };
  }
  const tage = tageTeilen(text, heute);
  if (tage.length < 2) return dienstEinTag(admin, text, markiert, null, false, ausGespraech);
  // Art (Start/Ende/Pause) und Fahrer gelten fuer alle Teile, wenn sie nur einmal genannt sind.
  const alle = await dienstEinTag(admin, text, markiert, null, true);
  if (!alle || !('fahrer' in alle)) return dienstEinTag(admin, text, markiert, null, false, ausGespraech);
  const fahrer = alle.fahrer as Fahrer[];
  const vorschlaege: Vorschlag[] = [];
  let art = '';
  for (const teil of tage) {
    const eigeneArt = /dienstende|feierabend|\bende\b|schluss/.test(teil) ? ' dienstende ' : (/start|beginn|anfang|dienstart/.test(teil) ? ' dienststart ' : '');
    art = eigeneArt || art || (/dienstende|feierabend|\bende\b/.test(text) && !/start|beginn/.test(text) ? ' dienstende ' : ' dienststart ');
    const r = await dienstEinTag(admin, `${teil}${eigeneArt ? '' : art}`, markiert, fahrer);
    if (!r) continue;
    if (!('action' in r) || !r.action) return { answer: String(r.answer || '') };
    const v = r.action.vorschlag;
    vorschlaege.push({ datum: v.datum, start: v.start, ende: v.ende, pausen: v.pausen, fahrer: v.fahrer });
  }
  if (vorschlaege.length < 2) return dienstEinTag(admin, text, markiert, null, false, ausGespraech);
  const namen = fahrer.map((f) => f.name).join(', ');
  const k = { ...(kontext || {}) };
  delete k.offeneDienstLoeschung;
  return {
    answer: `Ich habe ${vorschlaege.length} Dienste für ${namen} erkannt:\n${vorschlaege.map((v, i) => `${i + 1}. ${vorschlagText(v, heute)}`).join('\n')}\n\nMit „ja“ sende ich alle. Mit „nein“ breche ich ab.`,
    kontext: { ...k, offeneDienste: { liste: vorschlaege.map((v) => ({ ...v, fahrerIds: v.fahrer.map((f) => f.id) })), zeit: Date.now() } },
  };
};

// Ein Tag. fahrerFix: Fahrer schon bekannt (mehrere Tage). nurFahrer: nur die Fahrer bestimmen.
const dienstEinTag = async (admin: any, text: string, markiert: Fahrer[], fahrerFix: Fahrer[] | null = null, nurFahrer = false, ausGespraech = false): Promise<any> => {
  // Fragen ("Wann faengt Tim an?") sind keine Dienst-Auftraege.
  if (/^(wann|wer|wie|was|welche|welcher|welches|wo|ob|hat|ist|sind)\b/.test(text.trim())) return null;
  // "Ende in München", "Start am Bahnhof" ohne Dienst-Wort: Ort einer Fahrt, kein Dienst.
  if (!DIENST_RE.test(text) && new RegExp(`\\b(start|ende|ziel|beginn|abholung)\\s+(in|im|am|an|bei|beim|vom|von|zum|zur)\\s+(?!${ZEIT_FOLGT})`).test(text)) return null;
  const hatDienstWort = DIENST_RE.test(text) || ENDE_RE.test(text) || START_RE.test(text);
  // "Tim und Marvin morgen 6 bis 14": Zeitspanne mit Fahrernamen ohne Fahrt-Woerter ist ein Dienst.
  const nurSpanne = !hatDienstWort && !SCHICK_RE.test(text) && !FAHRT_RE.test(text)
    && /\b\d{1,2}([:.]\d{2})?\s*(uhr\s*)?(-|–|bis)\s*\d{1,2}/.test(text);
  // "Tim morgen 7 Uhr", "Stefano heute bis 18 Uhr", "Tim kommt morgen um 7": Fahrer + Uhrzeit, kurz, ohne Fahrt-Woerter.
  const nameUndZeit = !hatDienstWort && !nurSpanne && !FAHRT_RE.test(text) && text.trim().length <= 90
    && zeitenAusText(text).length > 0 && !/\b(standby|lohn|stundenlohn|euro|tracker|kennzeichen|fahrzeug|auto)\b/.test(text)
    // "Schreib allen Fahrern: Morgen Treffpunkt 7 Uhr" ist eine Nachricht, kein Dienst.
    && !/\b(schreib\w*|nachricht\w*|sag\w*|mitteil\w*|info\w*|treffpunkt|erinner\w*|frag\w*)\b/.test(text);
  if (!hatDienstWort && !SCHICK_RE.test(text) && !nurSpanne && !nameUndZeit) return null;
  if (!hatDienstWort && FAHRT_RE.test(text)) return null;

  const genannt = fahrerFix || (ALLE_FAHRER_RE.test(text) ? await alleFahrer(admin) : await genannteFahrer(admin, text));
  if ((nurSpanne || (nameUndZeit && !SCHICK_RE.test(text))) && !genannt.length) return null;
  let fahrer = genannt.length ? genannt : markiert;
  if (!fahrer.length) return null;
  if (nurFahrer) return { fahrer };
  let nachtHinweis = '';

  const { datum: heute, minuten: jetzt } = jetztBerlin();
  let datum = datumAusText(text, heute, true);
  const zeiten = zeitenAusText(text);

  // Pause: Zeiten nach dem Wort "pause" (bis zum naechsten Dienst-Wort).
  const pausen: Pause[] = [];
  const pausenPos = text.search(/\bpause/);
  let restZeiten = zeiten;
  // Text ohne den Pausen-Teil: "Pause von 12 bis 12:30" ist kein Dienstende (15.11.: setzte das Ende auf jetzt).
  let ohnePause = text;
  if (pausenPos >= 0) {
    const naechstes = text.slice(pausenPos + 5).search(/dienst|start|beginn|ende|feierabend|anfang/);
    const pausenEnde = naechstes >= 0 ? pausenPos + 5 + naechstes : text.length;
    ohnePause = `${text.slice(0, pausenPos)} ${text.slice(pausenEnde)}`;
    const inPause = zeiten.filter((z) => z.pos > pausenPos && z.pos < pausenEnde);
    restZeiten = zeiten.filter((z) => !(z.pos > pausenPos && z.pos < pausenEnde));
    if (inPause.length) {
      const von = inPause[0].zeit;
      const dauer = text.slice(pausenPos).match(/\b(\d{1,3})\s*(min|minuten)\b/);
      const bis = inPause[1]?.zeit || uhr(zuMin(von) + (dauer ? Number(dauer[1]) : 30));
      pausen.push({ von, bis });
    } else if (datum === heute && /\b(jetzt|sofort|gleich|gerade)\b/.test(text)) {
      // "Tim macht jetzt Pause": ab jetzt, 30 Minuten oder die genannte Dauer (15.11.: ging ans freie Modell,
      // das "macht jetzt Pause" antwortete, ohne etwas einzutragen).
      const von = uhr(Math.ceil(jetzt / 5) * 5);
      const dauer = text.slice(pausenPos).match(/\b(\d{1,3})\s*(min|minuten)\b/) || text.match(/\b(\d{1,3})\s*(min|minuten)\b/);
      pausen.push({ von, bis: uhr(zuMin(von) + (dauer ? Number(dauer[1]) : 30)) });
    }
  }

  // Aenderung "von 7:30 auf 6:30", "verschieb auf 17 Uhr": nur die neue Zeit zaehlt (ki_protokoll 14.11. 01:12).
  const aufPos = text.search(/\bauf\s+(halb\s+)?\d/);
  if (aufPos >= 0 && restZeiten.some((z) => z.pos > aufPos)) restZeiten = restZeiten.filter((z) => z.pos > aufPos);

  let start: string | null = null;
  let ende: string | null = null;
  const relativ = relativeZeit(text, jetzt);
  const bereich = /\d\s*(?:-|–|bis)\s*\d|\bvon\b.*\bbis\b/.test(text) && restZeiten.length >= 2;
  if (bereich) {
    start = restZeiten[0].zeit;
    ende = restZeiten[1].zeit;
  } else {
    const einzel = restZeiten[0]?.zeit || relativ;
    // Eine Zahl, die keine erkannte Uhrzeit ist ("Dienststart 7 Komma 5"): nachfragen statt "jetzt" nehmen.
    const ohneDatum = text.replace(/\b[0-3]?\d\.[01]?\d\.(\d{4})?/g, ' ').replace(/\bfahrer\s*\d+/g, ' ').replace(/\bin\s+\d+\s*(min\w*|std|stunde\w*)/g, ' ');
    if (!einzel && /\b\d{1,2}\b/.test(ohneDatum) && !pausen.length) {
      return { answer: 'Um wie viel Uhr genau? Zum Beispiel „Dienststart morgen 7:00“ oder „Dienstende 16 Uhr“.' };
    }
    const startWort = START_RE.test(ohnePause) || SCHWACH_START.test(ohnePause);
    const endeWort = ENDE_RE.test(ohnePause) || SCHWACH_ENDE.test(ohnePause);
    // Ohne Uhrzeit gilt "jetzt" nur, wenn der Satz es so meint: heute und "jetzt", "sofort" oder Feierabend
    // ("schick die alle in Feierabend"). Sonst nie die aktuelle Uhrzeit einsetzen (Messung 15.11.: "um halb acht
    // anfangen" und "das Ende rausnehmen" wurden zur aktuellen Uhrzeit).
    let jetztErlaubt = true;
    if (!einzel && (startWort || endeWort)) {
      if (!pausen.length && endeWort && /\b(raus\w*|entfern\w*|l(ö|oe)sch\w*|weg\w*|offen)\b/.test(text)) {
        return { answer: 'Ein Dienstende herausnehmen kann ich hier noch nicht. Das geht im Dienstplan. Ich habe nichts geändert.' };
      }
      const jetztGemeint = datum === heute && (/\b(jetzt|sofort|gleich|direkt|ab\s+sofort)\b/.test(text) || (endeWort && /feierabend|schluss|nach\s*hause|heim|ausstempeln/.test(text)) || (startWort && /in\s+den\s+dienst|einstempeln/.test(text)));
      if (!jetztGemeint && !pausen.length) return { answer: 'Um wie viel Uhr genau? Zum Beispiel „Dienststart morgen 7:00“ oder „Dienstende 16 Uhr“.' };
      // Mit Pause im Satz bleibt es bei der Pause, Start oder Ende ohne Uhrzeit kommen nicht dazu.
      if (!jetztGemeint) jetztErlaubt = false;
    }
    const jetztGerundet = jetztErlaubt ? uhr(Math.ceil(jetzt / 5) * 5) : null;
    if (endeWort && !startWort) ende = einzel || jetztGerundet;
    else if (startWort || (einzel && !pausen.length)) start = einzel || jetztGerundet;
    if (endeWort && startWort && restZeiten.length >= 2) {
      // Zeit hinter dem jeweiligen Wort: "Ende 16 Start 7" ist Start 7, Ende 16.
      const posStart = text.search(new RegExp(START_RE.source + '|' + SCHWACH_START.source));
      const posEnde = text.search(new RegExp(ENDE_RE.source + '|' + SCHWACH_ENDE.source));
      const nach = (pos: number) => restZeiten.find((z) => z.pos >= pos)?.zeit;
      start = nach(posStart) || restZeiten[0].zeit;
      ende = (posEnde > posStart ? nach(posEnde) : restZeiten.find((z) => z.pos >= posEnde && z.pos < posStart)?.zeit) || restZeiten[1].zeit;
      if (start === ende) { start = restZeiten[0].zeit; ende = restZeiten[1].zeit; }
    }
  }
  if (!start && !ende && !pausen.length) return null;

  // Datumsgrenze (15.11.): Nachts vor 06:00 meinen Dienstende und Pause ohne Start den Dienst, der gestern
  // begann und noch laeuft (Veranstaltungen ueber Mitternacht), nicht einen neuen Dienst fuer heute.
  if (datum === heute && jetzt < 6 * 60 && !start && (ende || pausen.length)) {
    const gestern = plusTage(heute, -1);
    const [heuteDa, gesternDa] = await Promise.all([
      bestehendeDienste(admin, fahrer.map((f) => f.id), heute),
      bestehendeDienste(admin, fahrer.map((f) => f.id), gestern),
    ]);
    const laeuft = (b: Bestehend | undefined) => !!b && (!b.ende || (!!b.start && zuMin(b.ende) < zuMin(b.start)));
    const nachtDienst = fahrer.filter((f) => !heuteDa.has(f.id) && laeuft(gesternDa.get(f.id)));
    // "Dienstende für alle heute 01:00" (15.11. 01:48): die laufenden Dienste von gestern beenden. Wer keinen
    // laufenden Dienst hat, bekommt kein Dienstende ohne Dienst, er wird nur genannt.
    if (nachtDienst.length) {
      const rest = fahrer.filter((f) => !nachtDienst.includes(f));
      if (rest.length) nachtHinweis = `${rest.map((f) => f.name).join(', ')} ${rest.length === 1 ? 'hat' : 'haben'} keinen laufenden Dienst und ${rest.length === 1 ? 'bekommt' : 'bekommen'} nichts. `;
      fahrer = nachtDienst;
      datum = gestern;
    }
  }

  // Vorhandene Dienste des Tages beachten: kein zweiter Dienststart, sondern den Dienst aendern.
  const tag = tagKlar(datum, heute);
  const bestehend = await bestehendeDienste(admin, fahrer.map((f) => f.id), datum);
  const mit = fahrer.filter((f) => bestehend.has(f.id));
  const ohne = fahrer.filter((f) => !bestehend.has(f.id));
  let hinweis = '';
  let rueckfrage = '';
  // Ausdruecklich Dienststart/Dienstende genannt: vorhandene Dienste werden geaendert, die anderen neu angelegt.
  const ausdruecklich = START_RE.test(text) || ENDE_RE.test(text);
  if (mit.length && ohne.length && ausdruecklich) {
    // Wird nur ergaenzt (Dienstende zu einem Dienst ohne Ende), muss niemand etwas erfahren. Erwaehnt wird
    // nur, wo ein schon eingetragener Wert ueberschrieben wird.
    hinweis = ueberschrieben(mit, start, ende);
  } else if (mit.length && ohne.length && !(pausen.length && !start && !ende)) {
    return {
      answer: `${mit.map((f) => `${f.name} hat ${tag} schon Dienst (${dienstText(bestehend.get(f.id)!)})`).join(', ')}, ${ohne.map((f) => f.name).join(', ')} noch nicht. Bitte für beide Gruppen getrennt schicken, dann kann ich den vorhandenen Dienst ändern und den neuen anlegen.`,
    };
  }
  if (mit.length && !ohne.length) {
    const nurStart = (START_RE.test(text) || SCHWACH_START.test(text)) && !ENDE_RE.test(text) && !SCHWACH_ENDE.test(text) && !pausen.length;
    const ergebnisse = mit.map((f) => aufVorhandenen(bestehend.get(f.id)!, start, ende, pausen, nurStart));
    const vorhandenText = mit.map((f) => `${f.name} hat ${tag} schon Dienst (${dienstText(bestehend.get(f.id)!)})`).join(', ');
    const unklar = ergebnisse.find((e: any) => e?.unklar) as any;
    if (unklar) return { answer: `${mit.map((f) => `${f.name} hat ${tag} schon Dienst (${dienstText(bestehend.get(f.id)!)})`).join(', ')}. ${unklar.unklar}` };
    if (ergebnisse.some((e) => e === null)) {
      return { answer: `${vorhandenText}. Der Dienststart ${start} ist schon eingetragen, ich ändere nichts.` };
    }
    const schluessel = (e: any) => JSON.stringify([e.start, e.ende, e.pausen]);
    if (new Set(ergebnisse.map(schluessel)).size > 1) {
      return { answer: `${vorhandenText}. Die Dienste sind verschieden, bitte jeden Fahrer einzeln schicken.` };
    }
    ({ start, ende } = ergebnisse[0]!);
    pausen.splice(0, pausen.length, ...ergebnisse[0]!.pausen);
    hinweis = ueberschrieben(mit, start, ende) + String((ergebnisse[0] as any)?.hinweis || '');
    // Rueckfrage nur, wenn die Zeit geraten wurde ("20:00" ohne Start/Ende-Wort). Ausdruecklich genannt: keine.
    rueckfrage = ausdruecklich ? '' : ergebnisse[0]!.frage;
  }

  function ueberschrieben(liste: typeof fahrer, s: string | null, e: string | null) {
    const teile = liste.map((f) => {
      const b = bestehend.get(f.id)!;
      const t = [
        s && b.start && b.start !== s ? `Dienststart ${b.start} → ${s}` : '',
        e && b.ende && b.ende !== e ? `Dienstende ${b.ende} → ${e}` : '',
      ].filter(Boolean);
      return t.length ? `${f.name} ${t.join(', ')}` : '';
    }).filter(Boolean);
    return teile.length ? `Geändert wird bei ${teile.join(', ')}. ` : '';
  }
  const namen = fahrer.map((f) => f.name).filter(Boolean);
  const wer = nachtHinweis ? (fahrer.length > 3 ? `${fahrer.length} Fahrer mit laufendem Dienst` : namen.join(', '))
    : genannt.length
    ? (ausnahmen(admin).length ? `${genannt.length > 3 ? `${genannt.length} Fahrer` : namen.join(', ')}${ausnahmenText(admin)}`
      : !fahrerFix && ALLE_FAHRER_RE.test(text) && genannt.length > 3 ? `alle ${genannt.length} Fahrer` : namen.join(', '))
    : ausGespraech ? namen.join(', ')
    : `${fahrer.length === 1 ? 'den markierten Fahrer' : `die ${fahrer.length} markierten Fahrer`} (${namen.join(', ')})`;
  // Nachts das Ende zum Dienst von gestern (18.11. 01:23): "Dienstende 01:25 gestern, Di 17.11." klang nach
  // einem Ende gestern frueh. Gemeint ist heute 01:25, der Dienst ist vom 17.11.
  const endeHeute = !!ende && datum === plusTage(heute, -1) && nachts(heute);
  const tagText = endeHeute
    ? `(Dienst vom ${['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'][new Date(`${datum}T12:00:00Z`).getUTCDay()]} ${datum.slice(8, 10)}.${datum.slice(5, 7)}.)`
    : tag;
  const teile = [
    start ? `Dienststart ${start}` : '',
    ...pausen.map((p) => `Pause ${p.von}–${p.bis}`),
    ende ? `Dienstende ${endeHeute ? 'heute ' : ''}${ende}` : '',
  ].filter(Boolean);
  // art/zeit fuer aeltere App-Versionen, die nur Start oder Ende kennen.
  const art = start && !ende && !pausen.length ? 'start' : (ende && !start && !pausen.length ? 'ende' : 'dienst');
  return {
    answer: rueckfrage
      ? `${rueckfrage.replace(/\?$/, '')} ${tag} für ${wer}? ${hinweis}`.trim()
      : `${teile.join(', ')} ${tagText} für ${wer}. ${hinweis}${nachtHinweis}Soll ich das senden?`,
    action: {
      type: 'dienst_vorschlag',
      // nurKnopf (15.11.): Mit Ausnahme ("alle außer Tim") bestaetigt im Voice-Modus kein gesprochenes "ja",
      // nur der Knopf, damit der Disponent die Fahrerliste sieht.
      vorschlag: { art, zeit: ende || start || '', datum, start, ende, pausen, fahrer, nurKnopf: ausnahmen(admin).length > 0 },
    },
  };
};

// aktion 'dienst_senden': { datum, start?, ende?, pausen?: [{von,bis}], fahrerIds: [] }
// Aeltere Apps schicken { art: 'start'|'ende', zeit } statt start/ende.
export const dienstSenden = async (admin: any, body: any) => {
  const zeitOderNull = (wert: unknown) => (UHRZEIT.test(String(wert || '')) ? String(wert) : null);
  let start = zeitOderNull(body?.start);
  let ende = zeitOderNull(body?.ende);
  if (!start && !ende && body?.art === 'start') start = zeitOderNull(body?.zeit);
  if (!start && !ende && body?.art === 'ende') ende = zeitOderNull(body?.zeit);
  const pausen = (Array.isArray(body?.pausen) ? body.pausen : [])
    .map((p: any) => ({ art: 'fest', von: zeitOderNull(p?.von), bis: zeitOderNull(p?.bis) }))
    .filter((p: any) => p.von && p.bis && p.von !== p.bis)
    .slice(0, 4);
  const datum = DATUM.test(String(body?.datum || '')) ? String(body.datum) : jetztBerlin().datum;
  const ids = Array.from(new Set((Array.isArray(body?.fahrerIds) ? body.fahrerIds : [])
    .map((id: unknown) => String(id || '').trim().toLowerCase())
    .filter((id: string) => UUID.test(id)))).slice(0, 100) as string[];
  if ((!start && !ende && !pausen.length) || !ids.length) return { status: 400, daten: { error: 'eingabe_ungueltig' } };

  const { data: profile, error: profilFehler } = await admin.from('profiles').select('id').in('id', ids);
  if (profilFehler) return { status: 500, daten: { error: profilFehler.message } };
  const gueltig = (profile || []).map((p: any) => String(p.id));
  if (!gueltig.length) return { status: 400, daten: { error: 'keine_fahrer' } };

  const jetzt = new Date().toISOString();
  let dienstIds: string[] = [];
  let ohneDienst = 0;
  let geaendert = 0;

  if (start || ende) {
    // Wie "Dienste planen" (15.11.): je Fahrer eine neue offene Anfrage. Hat er an dem Tag schon einen Dienst,
    // uebernimmt der Datenbank-Trigger (trisar_dienst_ein_pro_tag_vorher/_nachher) die fehlenden Zeiten und
    // Pausen, merkt sich den angenommenen Stand (dienst_aenderung) und ersetzt die alte Zeile. Der Fahrer
    // bestaetigt die Aenderung, beim Ablehnen gilt wieder der alte Stand. Vorher wurde die Zeile direkt
    // ueberschrieben und blieb "angenommen", ohne dass der Fahrer etwas bestaetigt hatte (ki_protokoll 14.11.).
    const vorhanden = await bestehendeDienste(admin, gueltig, datum);
    for (const [, b] of vorhanden) {
      // Neuer Start nach dem alten Ende (nicht ueber Mitternacht): ein neuer Dienst, das alte Ende gilt nicht mehr.
      // Sonst entstuende "22:45–20:00" (13.11.).
      if (start && !ende && altesEndeVorStart(b, start)) {
        await admin.from('dienst_pausen').delete().eq('dienst_id', b.id);
        await admin.from('dienst_aenderung').delete().eq('dienst_id', b.id);
        const { error: weg } = await admin.from('driver_service_requests').delete().eq('id', b.id);
        if (weg) return { status: 500, daten: { error: weg.message } };
      }
    }
    const neuIds = gueltig;
    const { data: neu, error: anfrageFehler } = neuIds.length ? await admin.from('driver_service_requests').insert(neuIds.map((id: string) => ({
      driver_id: id,
      service_date: datum,
      service_start_time: start,
      service_end_time: ende,
      status: 'pending',
      requested_by: 'ki-assistent',
    }))).select('id') : { data: [], error: null };
    if (anfrageFehler) return { status: 500, daten: { error: anfrageFehler.message } };
    dienstIds = [...dienstIds, ...(neu || []).map((d: any) => String(d.id))];
    geaendert = vorhanden.size;

    const profilFelder = {
      ...(start ? { service_start_time: start, service_start_date: datum } : {}),
      ...(ende ? { service_end_time: ende, service_end_date: datum } : {}),
    };
    const { error: updateFehler } = await admin.from('profiles').update(profilFelder).in('id', gueltig);
    if (updateFehler) return { status: 500, daten: { error: updateFehler.message } };
  } else {
    // Nur Pause: an den juengsten Dienst des Fahrers an diesem Tag haengen (nicht abgelehnt).
    const { data: dienste, error } = await admin.from('driver_service_requests')
      .select('id, driver_id, created_at, status')
      .in('driver_id', gueltig).eq('service_date', datum).neq('status', 'refused')
      .order('created_at', { ascending: false });
    if (error) return { status: 500, daten: { error: error.message } };
    const juengster = new Map<string, string>();
    (dienste || []).forEach((d: any) => { if (!juengster.has(String(d.driver_id))) juengster.set(String(d.driver_id), String(d.id)); });
    dienstIds = [...juengster.values()];
    ohneDienst = gueltig.length - dienstIds.length;
    if (!dienstIds.length) return { status: 200, daten: { ok: false, error: 'An diesem Tag hat keiner der Fahrer einen Dienst. Erst Dienststart oder Dienstende senden.' } };
  }

  if (pausen.length && dienstIds.length) {
    // Vorhandene Pausen eines Dienstes bleiben, neue kommen dazu.
    const { data: alt } = await admin.from('dienst_pausen').select('dienst_id, pausen').in('dienst_id', dienstIds);
    const altNachId = new Map<string, any[]>((alt || []).map((r: any) => [String(r.dienst_id), Array.isArray(r.pausen) ? r.pausen : []]));
    const { error: pausenFehler } = await admin.from('dienst_pausen').upsert(dienstIds.map((id) => ({
      dienst_id: id,
      pausen: [...(altNachId.get(id) || []), ...pausen],
      aktualisiert: jetzt,
    })));
    if (pausenFehler) return { status: 500, daten: { error: `Pause nicht gespeichert: ${pausenFehler.message}` } };
  }

  return { status: 200, daten: { ok: true, anzahl: dienstIds.length || gueltig.length, geaendert, ohneDienst, datum, start, ende, pausen } };
};
