// Tests ohne Modell fuer Pruefer und neuen Ablauf (dispo-admin/kiNeuPruefen.ts, kiNeuAblauf.ts, Umbau 18.11.).
// Das Modell wird nachgestellt: Absicht und Formular stehen je Fall fest, auch absichtlich falsche Formulare,
// damit die Sperren greifen muessen. Feste Uhr Mi 18.11.2026 11:00.
//   cd trisar && deno test -A werkzeuge/ki-test/neu-pruefen-test.ts

// deno-lint-ignore-file no-explicit-any
import './zurueck/uhr-fest.ts';
import { assert, assertEquals } from 'jsr:@std/assert@1';
import { kiFrage } from '../../fahrer/supabase/functions/dispo-admin/ki.ts';
import { modellFreigeben } from '../../fahrer/supabase/functions/dispo-admin/verstehen.ts';
import { betroffenAus, ohneNotizText, pruefen, stornoGesagt, unbekannteNamen } from '../../fahrer/supabase/functions/dispo-admin/kiNeuPruefen.ts';
import { felderNichtImSatz, jsonLesen } from '../../fahrer/supabase/functions/dispo-admin/kiNeuFormular.ts';
import { SpeicherDb } from './speicherDb.ts';
import { ID, testdaten } from './testdaten.ts';

const LEUTE = [
  { id: 's', vor: 'Stefano', nach: 'Spandri', nummer: '1', name: 'Stefano Spandri' },
  { id: 't', vor: 'Tim', nach: 'Schedler', nummer: '113', name: 'Tim Schedler' },
  { id: 'a', vor: 'Anna', nach: 'Berger', nummer: '5', name: 'Anna Berger' },
];

Deno.test('Pruefer: Notiztext zaehlt nie als Auftrag', () => {
  assertEquals(ohneNotizText('Notiz zur Fahrt von Müller: Gast will, dass wir die Rückfahrt stornieren'), 'Notiz zur Fahrt von Müller');
  assertEquals(stornoGesagt('Notiz zur Fahrt von Müller: bitte stornieren'), false);
  assertEquals(stornoGesagt('Storniere die Fahrt von Müller'), true);
  assertEquals(stornoGesagt('Frau Weber fährt morgen doch nicht'), true);
  assertEquals(stornoGesagt('Ändere die Fahrt von Müller auf 15 Uhr'), false);
});

Deno.test('Pruefer: unbekannter Name nach für/an/mit', () => {
  assertEquals(unbekannteNamen('Feierabend für Klaus', LEUTE), ['Klaus']);
  assertEquals(unbekannteNamen('Feierabend für Stephano', LEUTE), []);
  assertEquals(unbekannteNamen('Dienststart für Tim morgen um 9', LEUTE), []);
  // Mit Herr/Frau ist es ein Gast.
  assertEquals(unbekannteNamen('Fahrt für Herrn Schmidt mit Paul', LEUTE), ['Paul']);
  assertEquals(unbekannteNamen('Dienststart für alle Fahrer morgen', LEUTE), []);
});

Deno.test('Pruefer: Ergebnis gegen Erwartung', () => {
  const e = { absicht: 'dienst', fahrerIds: ['s', 'a'], tage: ['2026-11-18'], zeiten: ['16:00'], feierabend: false, fahrtId: null, loeschenErlaubt: false, stornoErlaubt: false };
  const karte = (fahrer: string[], datum: string, ende: string) => ({ action: { type: 'dienst_vorschlag', vorschlag: { fahrer: fahrer.map((id) => ({ id })), datum, ende } } });
  assertEquals(pruefen(betroffenAus(karte(['s', 'a'], '2026-11-18', '16:00'), LEUTE), e, 'x'), []);
  // "alle außer Tim" wurde "nur Tim": falscher Fahrer.
  assertEquals(pruefen(betroffenAus(karte(['t'], '2026-11-18', '16:00'), LEUTE), e, 'x'), ['fahrer']);
  assertEquals(pruefen(betroffenAus(karte(['s'], '2026-11-19', '16:00'), LEUTE), e, 'x'), ['tag']);
  // Uhrzeit aus der aktuellen Uhr (11:05) statt aus dem Satz.
  assertEquals(pruefen(betroffenAus(karte(['s'], '2026-11-18', '11:05'), LEUTE), e, 'x'), ['uhrzeit']);
  // Storno in einer offenen Rueckfrage, ohne Storno-Wort im Satz.
  const storno = { kontext: { offeneFahrtAktion: { art: 'storno', id: 'f1' } } };
  assertEquals(pruefen(betroffenAus(storno, LEUTE), { ...e, fahrerIds: null, tage: null, zeiten: null }, 'Notiz zur Fahrt: bitte stornieren'), ['storno']);
});

Deno.test('Formular: abgebrochene Antwort retten', () => {
  assertEquals(jsonLesen('{"datum_text": "Samstag", "zeit_text": "11:58\u201d, "}'), { datum_text: 'Samstag', zeit_text: '11:58' });
  assertEquals(jsonLesen('{"a": 1}'), { a: 1 });
  assertEquals(jsonLesen(JSON.stringify({ zeit_text: '14 Uhr","neu_fahrer_text":"Anna' })), { zeit_text: '14 Uhr', neu_fahrer_text: 'Anna' });
  assertEquals(jsonLesen('Unsinn'), null);
});

Deno.test('Formular: Felder muessen im Satz stehen', () => {
  assertEquals(felderNichtImSatz({ fahrer_text: ['Tim'], tage: [{ datum_text: 'morgen', start_text: '9' }] }, 'Dienststart für Tim um 9'), ['datum_text: morgen']);
  assertEquals(felderNichtImSatz({ fahrer_text: ['alle'], ausser_text: ['Tim'] }, 'Feierabend für allen außer Tim'), []);
  assertEquals(felderNichtImSatz({ empfaenger_text: ['Tim'], text: 'Bitte tanken.' }, 'Sag Tim er soll tanken'), []);
});

// ---- Ganzer Ablauf mit nachgestelltem Modell -----------------------------------------------------
let antworten: { absicht: string; formular?: any } | null = null;
const echtesFetch = globalThis.fetch;
globalThis.fetch = (async (url: any, init?: any) => {
  const u = String(url?.url ?? url);
  if (/\/api\/version$/.test(u)) return antworten ? new Response('{}', { status: 200 }) : Promise.reject(new TypeError('aus'));
  if (/\/api\/chat$/.test(u)) {
    if (!antworten) throw new TypeError('aus');
    const b = JSON.parse(String(init?.body || '{}'));
    const inhalt = b?.format?.properties?.absicht ? { absicht: antworten.absicht } : (antworten.formular ?? {});
    return new Response(JSON.stringify({ message: { content: JSON.stringify(inhalt) } }), { status: 200 });
  }
  return echtesFetch(url, init);
}) as typeof fetch;

const NAME: Record<string, string> = { [ID.tim]: 'Tim', [ID.anna]: 'Anna', [ID.stefano]: 'Stefano', [ID.marvin]: 'Marvin' };
const lauf = async (schritte: { satz: string; absicht?: string; formular?: any; aus?: boolean }[], markiert: string[] = []) => {
  const daten = testdaten('http://modell.test:11434', 'qwen2.5:14b', 'qwen2.5:14b');
  daten.integration_settings.push({ key: 'ki_ablauf', value: 'neu' });
  const db = new SpeicherDb(daten);
  let kontext: any = null;
  const verlauf: any[] = [];
  let d: any = null;
  for (const s of schritte) {
    antworten = s.aus ? null : { absicht: s.absicht || 'frage', formular: s.formular };
    modellFreigeben();
    d = (await kiFrage(db, { aktion: 'ki_frage', frage: s.satz, verlauf, kontext, karten: true, modus: 'frei',
      markierteFahrer: markiert.map((id) => ({ id, name: NAME[id] })) }, ID.dispo)).daten;
    verlauf.push({ role: 'user', text: s.satz }, { role: 'assistant', text: String(d?.answer || '') });
    kontext = d?.kontext ?? kontext;
  }
  const karte = (d?.aktionen || []).find((a: any) => a.type === 'dienst_vorschlag')?.vorschlag || (d?.action?.type === 'dienst_vorschlag' ? d.action.vorschlag : null);
  return { d, karte, fahrer: (karte?.fahrer || []).map((f: any) => NAME[f.id] || f.name).sort() };
};

Deno.test('Ablauf: Ausnahme richtig gelesen trifft nur die anderen', async () => {
  const r = await lauf([{ satz: 'Schick allen außer Tim und Marvin Feierabend um 16 Uhr', absicht: 'dienst',
    formular: { fahrer_text: ['alle'], ausser_text: ['Tim', 'Marvin'], tage: [{ ende_text: '16 Uhr' }] } }]);
  assertEquals(r.fahrer, ['Anna', 'Stefano']);
  assertEquals(r.karte.ende, '16:00');
  assertEquals(r.karte.datum, '2026-11-18');
});

Deno.test('Ablauf: umgedrehte Ausnahme vom Modell wird gesperrt', async () => {
  const r = await lauf([{ satz: 'Schick allen außer Tim und Marvin Feierabend um 16 Uhr', absicht: 'dienst',
    formular: { fahrer_text: ['Tim', 'Marvin'], tage: [{ ende_text: '16 Uhr' }] } }]);
  assertEquals(r.karte, null);
  assert(/nicht sicher|nichts geändert/i.test(r.d.answer), r.d.answer);
});

Deno.test('Ablauf: unbekannter Name weicht nie auf den Fahrer aus dem Gespraech aus', async () => {
  for (const formular of [{ fahrer_text: ['Klaus'], tage: [{ ende_text: 'Feierabend' }] }, { fahrer_text: [], tage: [{ ende_text: 'Feierabend' }] }]) {
    const r = await lauf([{ satz: 'Wo ist Anna gerade', absicht: 'frage' }, { satz: 'Feierabend für Klaus', absicht: 'dienst', formular }]);
    assertEquals(r.karte, null);
    assert(/Klaus/.test(r.d.answer), r.d.answer);
  }
});

Deno.test('Ablauf: Fuerwort nimmt den Fahrer aus dem Gespraech', async () => {
  const r = await lauf([{ satz: 'Wo ist Anna gerade', absicht: 'frage' },
    { satz: 'Dann schick ihr Dienststart morgen um 9', absicht: 'dienst', formular: { fahrer_text: ['ihr'], tage: [{ datum_text: 'morgen', start_text: '9' }] } }]);
  assertEquals(r.fahrer, ['Anna']);
  assertEquals(r.karte.start, '09:00');
});

Deno.test('Ablauf: dreiviertel, viertel und Wochenangaben rechnet der Code', async () => {
  // glaetten.ts schreibt "dreiviertel 7" schon vor dem Modell als "viertel vor 7".
  let r = await lauf([{ satz: 'Dienststart für Tim morgen um dreiviertel 7', absicht: 'dienst', formular: { fahrer_text: ['Tim'], tage: [{ datum_text: 'morgen', start_text: 'viertel vor 7' }] } }]);
  assertEquals([r.karte?.datum, r.karte?.start], ['2026-11-19', '06:45']);
  r = await lauf([{ satz: 'Dienststart für Tim in drei Wochen am Dienstag um 9', absicht: 'dienst', formular: { fahrer_text: ['Tim'], tage: [{ datum_text: 'in drei Wochen am Dienstag', start_text: '9' }] } }]);
  assertEquals([r.karte?.datum, r.karte?.start], ['2026-12-08', '09:00']);
  r = await lauf([{ satz: 'Dienststart für Tim übernächsten Freitag um 9', absicht: 'dienst', formular: { fahrer_text: ['Tim'], tage: [{ datum_text: 'übernächsten Freitag', start_text: '9' }] } }]);
  assertEquals(r.karte?.datum, '2026-11-27');
});

Deno.test('Ablauf: erfundener Name ist ein Modellfehler, erfundener Tag wird verworfen', async () => {
  let r = await lauf([{ satz: 'Dienststart um 9 für Tim', absicht: 'dienst', formular: { fahrer_text: ['Anna'], tage: [{ start_text: '9' }] } }]);
  assertEquals(r.karte, null);
  assertEquals(r.d.meta?.regel, 'neuNichtImSatz');
  // "morgen" steht nicht im Satz: verworfen, es gilt heute wie ohne Tag.
  r = await lauf([{ satz: 'Dienststart für Tim um 9', absicht: 'dienst', formular: { fahrer_text: ['Tim'], tage: [{ datum_text: 'morgen', start_text: '9' }] } }]);
  assertEquals(r.karte?.datum, '2026-11-18');
});

Deno.test('Ablauf: Uhrzeit nie aus der aktuellen Uhr', async () => {
  const r = await lauf([{ satz: 'Bei Anna morgen das Ende rausnehmen', absicht: 'dienst', formular: { fahrer_text: ['Anna'], tage: [{ datum_text: 'morgen' }] } }]);
  assertEquals(r.karte, null);
  assert(!/11:0\d/.test(r.d.answer), r.d.answer);
});

Deno.test('Ablauf: Notiztext wird nie zum Storno', async () => {
  const r = await lauf([{ satz: 'Notiz zur Fahrt von Müller: Gast will, dass wir die Rückfahrt stornieren', absicht: 'fahrt_stornieren', formular: { gast_text: 'Müller', notiz_text: 'Gast will, dass wir die Rückfahrt stornieren' } }]);
  assertEquals(r.d.kontext?.offeneFahrtAktion?.art, 'notiz');
  assertEquals(r.d.kontext?.offeneFahrtAktion?.id, ID.fahrtMueller);
});

Deno.test('Ablauf: Storno ohne Storno-Wort fragt nach', async () => {
  const r = await lauf([{ satz: 'Die Fahrt von Herrn Engel ist erledigt', absicht: 'fahrt_stornieren', formular: { gast_text: 'Herrn Engel' } }]);
  assertEquals(r.d.kontext?.offeneFahrtAktion, undefined);
});

Deno.test('Ablauf: mehrere passende Fahrten heisst Rueckfrage', async () => {
  const r = await lauf([{ satz: 'Storniere die Fahrt von Stefano', absicht: 'fahrt_stornieren', formular: { fahrer_text: 'Stefano' } }]);
  assertEquals(r.d.kontext?.offeneFahrtAktion, undefined);
  assert(/Mehrere Fahrten/.test(r.d.answer), r.d.answer);
});

Deno.test('Ablauf: ab drei Betroffenen Liste in der Antwort', async () => {
  const r = await lauf([{ satz: 'Schick allen bis auf Stefano Dienstbeginn heute 13:30', absicht: 'dienst',
    formular: { fahrer_text: ['allen'], ausser_text: ['Stefano'], tage: [{ datum_text: 'heute', start_text: '13:30' }] } }]);
  assertEquals(r.fahrer, ['Anna', 'Marvin', 'Tim']);
  assert(/Betroffen sind 3 Fahrer|Anna Berger.*Marvin Keller.*Tim Schedler|Tim Schedler.*Marvin Keller.*Anna Berger/s.test(r.d.answer), r.d.answer);
});

Deno.test('Ablauf: Modell aus, Auftrag wird nicht geraten, Frage geht', async () => {
  let r = await lauf([{ satz: 'Dienststart für Tim morgen um 9', aus: true }]);
  assertEquals(r.karte, null);
  assertEquals(r.d.meta?.regel, 'neuOhneModell');
  r = await lauf([{ satz: 'Wo ist Tim gerade', aus: true }]);
  assert(/Tim/.test(r.d.answer) && r.d.meta?.regel !== 'neuOhneModell', r.d.answer);
});

Deno.test('Ablauf: Schalter aus laesst den alten Ablauf unberuehrt', async () => {
  const daten = testdaten('http://modell.test:11434', 'qwen2.5:14b', 'qwen2.5:14b');
  const db = new SpeicherDb(daten);
  antworten = { absicht: 'dienst' };
  const d = (await kiFrage(db, { aktion: 'ki_frage', frage: 'Dienststart für Tim morgen um halb 8', verlauf: [], kontext: null, karten: true }, ID.dispo)).daten;
  assertEquals(d?.meta?.neu, undefined);
});

Deno.test('Ablauf: Gegenprobe Tag und Vergleich', async () => {
  // Modell laesst "letzten" weg: der ganze Satz ergibt den 13.11., also Rueckfrage.
  let r = await lauf([{ satz: 'Dienststart für Tim letzten Freitag um 10', absicht: 'dienst', formular: { fahrer_text: ['Tim'], tage: [{ datum_text: 'Freitag', start_text: '10' }] } }]);
  assertEquals(r.karte, null);
  // "früher als Anna": Anna ist nur Vergleich, und eine Dauer ist keine Uhrzeit.
  r = await lauf([{ satz: 'Tim fängt morgen eine Stunde früher an als Anna', absicht: 'dienst', formular: { fahrer_text: ['Tim', 'Anna'], tage: [{ datum_text: 'morgen', start_text: 'eine Stunde früher' }] } }]);
  assertEquals(r.karte, null);
  // Englisches "tomorrow" wird nie heute.
  r = await lauf([{ satz: 'Book a ride tomorrow at 9 am, driver Tim', absicht: 'dienst', formular: { fahrer_text: ['Tim'], tage: [{ start_text: '9 am' }] } }]);
  assert(r.karte === null || r.karte.datum === '2026-11-19', JSON.stringify(r.karte));
});
