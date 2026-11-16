// Ausfaelle des Modell-Rechners durchspielen (15.11.): Was antwortet der Assistent, und wie lange wartet man,
// wenn Ollama aus ist, haengt, Fehler liefert oder Unsinn schreibt? Ein falsches Ollama laeuft dafuer hier im
// Prozess, die Datenbank ist im Speicher. Zeigt Antwort und Wartezeit zum Durchlesen.
//
//   cd trisar && deno run -A werkzeuge/ki-test/ausfall-test.ts
//   ... --nur=haengt        nur eine Art (aus, haengt, fehler500, unsinn, leer)

// deno-lint-ignore-file no-explicit-any
import './uhr.ts';
import { kiFrage, antwortArt } from '../../fahrer/supabase/functions/dispo-admin/ki.ts';
import { SpeicherDb } from './speicherDb.ts';
import { ID, testdaten } from './testdaten.ts';
import { modellFreigeben } from '../../fahrer/supabase/functions/dispo-admin/verstehen.ts';

// Hier laeuft die Sicherung wie im Betrieb (2 Minuten).
Deno.env.set('KI_SPERRE_MS', '120000');

const nur = Deno.args.find((a) => a.startsWith('--nur='))?.slice(6) || '';
let art = 'haengt';
const PORT = 11999;
const server = Deno.serve({ port: PORT, onListen: () => {} }, async (req) => {
  const pfad = new URL(req.url).pathname;
  if (pfad === '/api/version' || pfad === '/api/tags') return Response.json({ version: 'falsch', models: [] });
  if (art === 'haengt') {
    // Antwortet nie, bis der Aufrufer abbricht.
    await new Promise((fertig) => req.signal.addEventListener('abort', fertig));
    return new Response('', { status: 499 });
  }
  if (art === 'fehler500') return new Response('model runner has unexpectedly stopped', { status: 500 });
  if (art === 'unsinn') return Response.json({ message: { content: 'Gerne! Hier ist ein Gedicht über Autos.' }, response: 'Gerne! Hier ist ein Gedicht über Autos.' });
  return Response.json({ message: { content: '' }, response: '' });
});

const SAETZE = [
  'Dienststart für Tim morgen um 7',
  'Schick alle Fahrer in den Feierabend außer Tim',
  'Wo ist Stefano gerade',
  'Neue Fahrt morgen um 9 vom Hauptbahnhof zum Flughafen für Herrn Engel',
  'Hallo',
  'Welche Fahrten sind noch offen',
];
for (const a of ['aus', 'haengt', 'fehler500', 'unsinn', 'leer'].filter((x) => !nur || x === nur)) {
  art = a;
  modellFreigeben();
  const url = a === 'aus' ? 'http://127.0.0.1:9' : `http://127.0.0.1:${PORT}`;
  console.log(`\n=== Ollama ${a}`);
  for (const frage of SAETZE) {
    const db = new SpeicherDb(testdaten(url, 'qwen2.5:14b', 'qwen2.5:14b'));
    const t0 = Date.now();
    let d: any;
    try {
      d = (await kiFrage(db, { aktion: 'ki_frage', frage, verlauf: [], kontext: null, offenerVorschlag: null, letzteFahrtId: null, markierteFahrer: [], karten: true, modus: 'frei' }, ID.dispo)).daten;
    } catch (fehler) {
      d = { answer: `ABSTURZ: ${fehler instanceof Error ? fehler.message : fehler}` };
    }
    console.log(`> ${frage}\n  [${((Date.now() - t0) / 1000).toFixed(1)} s, ${antwortArt(d, d?.kontext)}] ${String(d?.answer || '').slice(0, 200).replace(/\n/g, ' ⏎ ')}`);
  }
}
// Haengende Anfragen halten den Server offen, daher hart beenden.
server.shutdown();
Deno.exit(0);
