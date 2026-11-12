// Testsatz fuer den KI-Assistenten (dispo-admin, aktion ki_frage).
// Laeuft lokal mit Deno gegen eine Datenbank im Speicher und das echte Modell in Ollama.
//
//   cd trisar && deno run -A werkzeuge/ki-test/ki-test.ts
//   ... --modell=qwen2.5:14b      anderes Modell
//   ... --nur=Dienst              nur eine Gruppe (Dienst, Buchen, Ändern, Fragen, Neu, Gespräch)
//   ... --ollama=http://host:11434
//
// Ergebnis: Tabelle in der Konsole, Bericht in werkzeuge/ki-test/ergebnisse/.
// Nach jeder Aenderung am Assistenten laufen lassen, damit nichts Altes kaputtgeht.

// deno-lint-ignore-file no-explicit-any
import { kiFrage, antwortArt } from '../../fahrer/supabase/functions/dispo-admin/ki.ts';
import { SpeicherDb } from './speicherDb.ts';
import { ID, testdaten } from './testdaten.ts';
import { type Erwartung, faelle } from './faelle.ts';

const arg = (name: string, standard: string) =>
  Deno.args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? standard;
const modell = arg('modell', 'llama3.1:8b');
const ollama = arg('ollama', 'http://localhost:11434');
const nur = arg('nur', '');

const NAMEN: Record<string, string> = { [ID.tim]: 'Tim Schedler', [ID.marvin]: 'Marvin Keller', [ID.stefano]: 'Stefano Spandri', [ID.anna]: 'Anna Berger' };

// Felder eines Vorschlags als Text, damit die Pruefung einheitlich "enthaelt" nutzen kann.
const felder = (daten: any): Record<string, string> => {
  const a = daten?.action;
  if (a?.type === 'dienst_vorschlag') {
    const v = a.vorschlag || {};
    return {
      datum: String(v.datum || ''),
      start: String(v.start || ''),
      ende: String(v.ende || ''),
      pausen: (v.pausen || []).map((p: any) => `${p.von}-${p.bis}`).join(', '),
      fahrer: (v.fahrer || []).map((f: any) => f.name).join(', '),
    };
  }
  if (a?.type === 'booking_proposal') {
    const p = a.proposal || {};
    return {
      datum: String(p.datum || ''), startZeit: String(p.startZeit || ''), start: String(p.start || ''),
      ziel: String(p.ziel || ''), fahrgaeste: String(p.fahrgaeste || ''),
      fahrerNamen: (p.fahrerNamen || []).join(', '), fahrtId: String(p.fahrtId || ''),
      startOrtId: String(p.startOrtId || ''), zielOrtId: String(p.zielOrtId || ''),
    };
  }
  return {};
};

const pruefen = (daten: any, e: Erwartung): string[] => {
  const fehler: string[] = [];
  const art = antwortArt(daten, daten?.kontext);
  const erlaubt = Array.isArray(e.art) ? e.art : [e.art];
  if (!erlaubt.includes(art)) fehler.push(`Art ${art}, erwartet ${erlaubt.join('/')}`);
  const antwort = String(daten?.answer || '').toLowerCase();
  for (const w of e.enthaelt || []) if (!antwort.includes(w.toLowerCase())) fehler.push(`Antwort ohne "${w}"`);
  for (const w of e.nicht || []) if (antwort.includes(w.toLowerCase())) fehler.push(`Antwort mit "${w}"`);
  if (e.einesVon?.length && !e.einesVon.some((w) => antwort.includes(w.toLowerCase()))) {
    fehler.push(`Antwort ohne eines von ${e.einesVon.join('/')}`);
  }
  const f = felder(daten);
  for (const [k, soll] of Object.entries(e.vorschlag || {})) {
    const ist = f[k] ?? '';
    if (soll === null) { if (ist) fehler.push(`${k} soll leer sein, ist "${ist}"`); continue; }
    if (!ist.toLowerCase().includes(soll.toLowerCase())) fehler.push(`${k} "${ist}", erwartet "${soll}"`);
  }
  // Karten-Liste (karten: true): Typen der aktionen in Reihenfolge, Standby-Felder.
  if (e.karten) {
    const ist = (Array.isArray(daten?.aktionen) ? daten.aktionen : []).map((a: any) => a?.type);
    if (ist.join(',') !== e.karten.join(',')) fehler.push(`Karten ${ist.join(',') || 'keine'}, erwartet ${e.karten.join(',')}`);
  }
  const sb = (Array.isArray(daten?.aktionen) ? daten.aktionen : []).find((a: any) => a?.type === 'standby_proposal')?.standby;
  for (const [k, soll] of Object.entries(e.standby || {})) {
    const roh = sb?.[k];
    const ist = Array.isArray(roh) ? roh.join(', ') : String(roh ?? '');
    if (soll === null) { if (ist) fehler.push(`standby.${k} soll leer sein, ist "${ist}"`); continue; }
    if (!ist.toLowerCase().includes(soll.toLowerCase())) fehler.push(`standby.${k} "${ist}", erwartet "${soll}"`);
  }
  // Relative Zeit ("jetzt", "in 20 Minuten"): Abfahrt zwischen jetzt+Minuten und 10 Minuten spaeter.
  if (e.zeitNahe != null) {
    const [h, m] = String(f.startZeit || '').split(':').map(Number);
    const jetzt = new Date().toLocaleTimeString('sv-SE', { timeZone: 'Europe/Berlin' }).slice(0, 5).split(':').map(Number);
    const abstand = ((h * 60 + m) - (jetzt[0] * 60 + jetzt[1]) + 1440) % 1440;
    if (!Number.isFinite(abstand) || abstand < e.zeitNahe - 1 || abstand > e.zeitNahe + 10) fehler.push(`startZeit "${f.startZeit}" nicht ${e.zeitNahe} min ab jetzt`);
    if (f.startZeit && !/:[0-5][05]$/.test(f.startZeit)) fehler.push(`startZeit "${f.startZeit}" nicht auf 5 min gerundet`);
  }
  return fehler;
};

type Ergebnis = { fall: string; gruppe: string; schritt: number; frage: string; ok: boolean; fehler: string[]; art: string; antwort: string; felder: Record<string, string>; ms: number };
const ergebnisse: Ergebnis[] = [];

const alle = faelle().filter((f) => !nur || f.gruppe === nur);
console.log(`KI-Testsatz: ${alle.length} Fälle, Modell ${modell}, Ollama ${ollama}\n`);

for (const fall of alle) {
  const db = new SpeicherDb(testdaten(ollama, modell));
  const verlauf: { role: string; text: string }[] = [];
  let kontext: any = null;
  let offenerVorschlag: any = null;
  let letzteFahrtId: string | null = null;
  for (const [i, s] of fall.schritte.entries()) {
    const body = {
      aktion: 'ki_frage', frage: s.frage, verlauf, kontext, offenerVorschlag, letzteFahrtId,
      markierteFahrer: (s.markiert || []).map((id) => ({ id, name: NAMEN[id] || '' })),
      ...(s.karten ? { karten: true } : {}),
    };
    const beginn = Date.now();
    let daten: any;
    try {
      daten = (await kiFrage(db, body, ID.dispo)).daten;
    } catch (fehler) {
      daten = { answer: `ABSTURZ: ${fehler instanceof Error ? fehler.message : fehler}`, meta: { fehler: true } };
    }
    const ms = Date.now() - beginn;
    const fehler = pruefen(daten, s.erwartet);
    const e: Ergebnis = {
      fall: fall.name, gruppe: fall.gruppe, schritt: i + 1, frage: s.frage, ok: fehler.length === 0, fehler,
      art: antwortArt(daten, daten?.kontext), antwort: String(daten?.answer || ''), felder: felder(daten), ms,
    };
    ergebnisse.push(e);
    console.log(`${e.ok ? 'OK  ' : 'FEHL'} ${fall.gruppe.padEnd(9)} ${fall.name}${fall.schritte.length > 1 ? ` (${i + 1})` : ''}  ${(ms / 1000).toFixed(1)} s`);
    if (!e.ok) console.log(`       "${s.frage}" -> ${fehler.join(' | ')}\n       Antwort: ${e.antwort.slice(0, 160).replace(/\n/g, ' ')}`);
    // Wie die Apps: Verlauf, Kontext und offener Vorschlag gehen in den naechsten Schritt.
    verlauf.push({ role: 'user', text: s.frage }, { role: 'assistant', text: e.antwort });
    kontext = daten?.kontext ?? kontext;
    if (daten?.action?.type === 'booking_proposal') {
      offenerVorschlag = daten.action.proposal;
      letzteFahrtId = daten.action.proposal?.fahrtId || letzteFahrtId;
    }
  }
}

const gruppen = [...new Set(ergebnisse.map((e) => e.gruppe))];
const zeile = (g: string) => {
  const r = ergebnisse.filter((e) => e.gruppe === g);
  return `${g}: ${r.filter((e) => e.ok).length}/${r.length}`;
};
const ok = ergebnisse.filter((e) => e.ok).length;
console.log(`\nGesamt ${ok}/${ergebnisse.length} Schritte richtig. ${gruppen.map(zeile).join(', ')}`);

// Zeitstempel in deutscher Zeit, wie auf der Uhr.
const stempel = new Date().toLocaleString('sv-SE', { timeZone: 'Europe/Berlin' }).slice(0, 16).replace(/[: ]/g, '-');
const ordner = new URL('./ergebnisse/', import.meta.url);
await Deno.mkdir(ordner, { recursive: true });
const bericht = [
  `# KI-Testsatz ${stempel}`, '', `Modell: ${modell}`, '', `Gesamt ${ok}/${ergebnisse.length} richtig. ${gruppen.map(zeile).join(', ')}`, '',
  '| | Gruppe | Fall | Frage | Problem | Antwort | Sekunden |', '|---|---|---|---|---|---|---|',
  ...ergebnisse.map((e) => `| ${e.ok ? 'OK' : 'FEHL'} | ${e.gruppe} | ${e.fall}${e.schritt > 1 ? ` (${e.schritt})` : ''} | ${e.frage} | ${e.fehler.join('; ')} | ${e.antwort.slice(0, 140).replace(/\|/g, '/').replace(/\n/g, ' ')} | ${(e.ms / 1000).toFixed(1)} |`),
].join('\n');
await Deno.writeTextFile(new URL(`${stempel}-${modell.replace(/[:/]/g, '_')}.md`, ordner), bericht);
await Deno.writeTextFile(new URL(`${stempel}-${modell.replace(/[:/]/g, '_')}.json`, ordner), JSON.stringify(ergebnisse, null, 2));
console.log(`Bericht: werkzeuge/ki-test/ergebnisse/${stempel}-${modell.replace(/[:/]/g, '_')}.md`);
