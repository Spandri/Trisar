// Einzelne Saetze gegen den KI-Assistenten pruefen (Testdaten im Speicher, echtes Modell).
//   cd trisar && deno run -A werkzeuge/ki-test/einzel.ts "Satz 1" "Satz 2"
//   ... --modus=frei   wie die App (Karten, freies Modell zuletzt)
// deno-lint-ignore-file no-explicit-any
import { kiFrage, antwortArt } from '../../fahrer/supabase/functions/dispo-admin/ki.ts';
import { SpeicherDb } from './speicherDb.ts';
import { ID, testdaten } from './testdaten.ts';

const optionen = Deno.args.filter((a) => a.startsWith('--'));
const arg = (n: string, s: string) => optionen.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3) ?? s;
const ollama = arg('ollama', 'http://100.121.170.114:11434');
const modell = arg('modell', 'qwen2.5:14b');
const verstehen = arg('verstehen', modell);
const frei = arg('modus', '') === 'frei' ? { karten: true, modus: 'frei' } : {};
for (const frage of Deno.args.filter((a) => !a.startsWith('--'))) {
  const db = new SpeicherDb(testdaten(ollama, modell, verstehen));
  const t0 = Date.now();
  const d: any = (await kiFrage(db, { aktion: 'ki_frage', frage, verlauf: [], kontext: null, offenerVorschlag: null, letzteFahrtId: null, markierteFahrer: [], ...frei }, ID.dispo)).daten;
  const a = d?.aktionen?.[0] || d?.action;
  console.log(`\n„${frage}“  (${((Date.now() - t0) / 1000).toFixed(1)} s)\n  meta: ${JSON.stringify(d?.meta?.absicht || null)} | befehl: ${d?.meta?.befehl || '-'}\n  art: ${antwortArt(d, d?.kontext)}\n  antwort: ${String(d?.answer || '').slice(0, 200).replace(/\n/g, ' ')}\n  karte: ${a ? JSON.stringify(a.proposal || a).slice(0, 300) : '-'}`);
}
