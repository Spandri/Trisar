// Stabilitaet und Last des KI-Assistenten (15.11.):
//   cd trisar && deno run -A werkzeuge/ki-test/stabil-test.ts                jeden Satz 5-mal, gleiche Antwort?
//   ... --mal=3                                                               Zahl der Wiederholungen
//   ... --gleichzeitig=3                                                      so viele Fragen zugleich (mehrere Disponenten)
// Zeigt je Satz, wie viele verschiedene Ergebnisse es gab, und die Zeiten. Testdaten im Speicher, echtes Modell.

// deno-lint-ignore-file no-explicit-any
import './uhr.ts';
import { kiFrage } from '../../fahrer/supabase/functions/dispo-admin/ki.ts';
import { SpeicherDb } from './speicherDb.ts';
import { ID, testdaten } from './testdaten.ts';

const arg = (n: string, s: string) => Deno.args.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3) ?? s;
const ollama = arg('ollama', 'http://100.121.170.114:11434');
const modell = arg('modell', 'qwen2.5:14b');
const mal = Number(arg('mal', '5'));
const gleichzeitig = Number(arg('gleichzeitig', '0'));

const SAETZE = [
  'Schick alle Fahrer in den Feierabend außer Tim und Marvin',
  'Lösch alle Dienste von Tim',
  'Schick allen bis auf Stefano bitte ein dienstbeginn für heute 13:30 Uhr',
  'Dienststart für alle Fahrer morgen um 10:30',
  'Tim soll morgen nicht um 7 anfangen sondern um 9',
  'Pause für Anna morgen von 12 bis 12:30',
  'Stefano soll Heute um 20:30 Uhr am Flughafen München zum Flughafen in Salzburg fahren ohne Gast',
  'Neue Fahrt morgen um 14:30 mit allen Fahrern außer Marvin, vom Hauptbahnhof zum Flughafen',
  'Sag allen außer Tim, dass sie heute tanken sollen',
  'kein Dienst für Anna morgen',
  'Tim morgen 7 bis 15, Pause 12 bis halb eins',
  'storniere die fahrt von frau weber morgen',
];

const frage1 = async (frage: string) => {
  const db = new SpeicherDb(testdaten(ollama, modell, modell));
  const t0 = Date.now();
  const d: any = (await kiFrage(db, { aktion: 'ki_frage', frage, verlauf: [], kontext: null, offenerVorschlag: null, letzteFahrtId: null, markierteFahrer: [], karten: true, modus: 'frei' }, ID.dispo)).daten;
  const a = d?.action || d?.aktionen?.[0];
  const v = a?.vorschlag || a?.proposal;
  const kern = a?.type === 'dienst_vorschlag'
    ? `DIENST ${v.datum} ${v.start || '-'}–${v.ende || '-'} ${(v.pausen || []).map((p: any) => `P${p.von}-${p.bis}`).join(' ')} [${(v.fahrer || []).map((f: any) => f.name.split(' ')[0]).sort().join(',')}]`
    : a?.type === 'booking_proposal'
    ? `FAHRT ${v.datum} ${v.startZeit} ${v.start} → ${v.ziel} [${(v.fahrerNamen || []).map((n: string) => n.split(' ')[0]).sort().join(',')}]`
    : `TEXT ${String(d?.answer || '').replace(/\s+/g, ' ').slice(0, 110)}`;
  return { kern, s: (Date.now() - t0) / 1000 };
};

if (gleichzeitig > 1) {
  console.log(`${gleichzeitig} Fragen zugleich, ${mal} Runden`);
  const zeiten: number[] = [];
  for (let r = 0; r < mal; r += 1) {
    const gruppe = Array.from({ length: gleichzeitig }, (_, i) => SAETZE[(r * gleichzeitig + i) % SAETZE.length]);
    const erg = await Promise.all(gruppe.map(frage1));
    erg.forEach((e, i) => { zeiten.push(e.s); console.log(`  ${e.s.toFixed(1).padStart(5)} s  ${gruppe[i].slice(0, 60).padEnd(60)}  ${e.kern.slice(0, 110)}`); });
  }
  zeiten.sort((a, b) => a - b);
  console.log(`\np50 ${zeiten[Math.floor(zeiten.length / 2)].toFixed(1)} s, max ${zeiten[zeiten.length - 1].toFixed(1)} s`);
} else {
  let stabil = 0;
  for (const frage of SAETZE) {
    const erg: { kern: string; s: number }[] = [];
    for (let i = 0; i < mal; i += 1) erg.push(await frage1(frage));
    const arten = new Map<string, number>();
    erg.forEach((e) => arten.set(e.kern, (arten.get(e.kern) || 0) + 1));
    if (arten.size === 1) stabil += 1;
    console.log(`${arten.size === 1 ? '✓' : '✗'} ${frage}  (${erg.map((e) => e.s.toFixed(1)).join(' / ')} s)`);
    [...arten].forEach(([k, n]) => console.log(`    ${n}× ${k}`));
  }
  console.log(`\n${stabil}/${SAETZE.length} Sätze jedes Mal gleich`);
}
