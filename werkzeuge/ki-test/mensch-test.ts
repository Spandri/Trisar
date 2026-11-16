// Den KI-Assistenten so benutzen wie ein Mensch in der App (15.11.): ganze Gespraeche, freie und schiefe Saetze,
// verhoerte Namen. Schickt dieselben Felder wie die Web-Dispo (karten: true, modus: 'frei'), was der Testsatz
// ki-test.ts nicht tut. Prueft nichts selbst, sondern zeigt Antwort, Karte und Zeit zum Durchlesen.
//
//   cd trisar && deno run -A werkzeuge/ki-test/mensch-test.ts werkzeuge/ki-test/mensch/echt.json
//   ... --modus=regeln   wie mit Umschalter "Regeln"
//   ... --ollama=http://host:11434 --modell=qwen2.5:14b
//
// Datei: [{ "name": "...", "saetze": ["...", "..."], "markiert": ["tim"] }]. Testdaten im Speicher, echtes Modell.

// deno-lint-ignore-file no-explicit-any
import './uhr.ts';
import { kiFrage, antwortArt } from '../../fahrer/supabase/functions/dispo-admin/ki.ts';
import { SpeicherDb } from './speicherDb.ts';
import { ID, testdaten } from './testdaten.ts';

const optionen = Deno.args.filter((a) => a.startsWith('--'));
const arg = (n: string, s: string) => optionen.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3) ?? s;
const ollama = arg('ollama', 'http://100.121.170.114:11434');
const modell = arg('modell', 'qwen2.5:14b');
const modus = arg('modus', 'frei');
const NAMEN: Record<string, string> = { tim: 'Tim Schedler', marvin: 'Marvin Keller', stefano: 'Stefano Spandri', anna: 'Anna Berger' };

const zeiten: number[] = [];
for (const datei of Deno.args.filter((a) => !a.startsWith('--'))) {
  const gespraeche: { name: string; saetze: string[]; markiert?: string[] }[] = JSON.parse(await Deno.readTextFile(datei));
  for (const g of gespraeche) {
    console.log(`\n=== ${g.name}`);
    const db = new SpeicherDb(testdaten(ollama, modell, modell));
    const verlauf: { role: string; text: string }[] = [];
    let kontext: any = null;
    let offenerVorschlag: any = null;
    let letzteFahrtId: string | null = null;
    for (const frage of g.saetze) {
      const vorher = db.schreibLog.length;
      const t0 = Date.now();
      let d: any;
      try {
        d = (await kiFrage(db, {
          aktion: 'ki_frage', frage, verlauf, kontext, offenerVorschlag, letzteFahrtId, karten: true, modus,
          markierteFahrer: (g.markiert || []).map((k) => ({ id: (ID as any)[k], name: NAMEN[k] || '' })),
        }, ID.dispo)).daten;
      } catch (fehler) {
        d = { answer: `ABSTURZ: ${fehler instanceof Error ? fehler.message : fehler}` };
      }
      const s = (Date.now() - t0) / 1000;
      zeiten.push(s);
      const karten = [...(d?.aktionen || []), ...(d?.action ? [d.action] : [])];
      const karteText = karten.map((a: any) => {
        const v = a.vorschlag || a.proposal || a;
        if (a.type === 'dienst_vorschlag') return `DIENST ${v.datum} ${v.start || '-'}–${v.ende || '-'} ${(v.pausen || []).map((p: any) => `P${p.von}-${p.bis}`).join(' ')} [${(v.fahrer || []).map((f: any) => f.name).join(', ')}]${v.nurKnopf ? ' nurKnopf' : ''}`;
        if (a.type === 'booking_proposal') return `FAHRT ${v.datum} ${v.startZeit} ${v.start} → ${v.ziel} | Gast: ${v.fahrgaeste || '-'} +${v.anonymeGaeste} | Fahrer: ${(v.fahrerNamen || []).join(', ') || '-'}${v.fahrtId ? ' (Änderung)' : ''}`;
        return `${a.type} ${JSON.stringify(v).slice(0, 160)}`;
      });
      const geschrieben = db.schreibLog.slice(vorher).map((l) => `${l.art} ${l.tabelle}`);
      console.log(`> ${frage}\n  [${s.toFixed(1)} s, ${antwortArt(d, d?.kontext)}, absicht ${d?.meta?.absicht || '-'}${d?.meta?.regel ? `, regel ${d.meta.regel}` : ''}${d?.meta?.frei ? ', frei' : ''}]`
        + `\n  ${String(d?.answer || '').slice(0, 320).replace(/\n/g, ' ⏎ ')}`
        + karteText.map((k) => `\n  ▸ ${k}`).join('')
        + (d?.meta?.befehl ? `\n  befehl: ${d.meta.befehl}` : '')
        + (geschrieben.length ? `\n  ✎ ${[...new Set(geschrieben)].join(', ')} (${geschrieben.length})` : ''));
      verlauf.push({ role: 'user', text: frage }, { role: 'assistant', text: String(d?.answer || '') });
      kontext = d?.kontext ?? kontext;
      if (d?.action?.type === 'booking_proposal') {
        offenerVorschlag = d.action.proposal;
        letzteFahrtId = d.action.proposal?.fahrtId || letzteFahrtId;
      }
    }
  }
}
const sortiert = [...zeiten].sort((a, b) => a - b);
const p = (q: number) => sortiert[Math.min(sortiert.length - 1, Math.floor(q * sortiert.length))];
console.log(`\n${zeiten.length} Sätze, p50 ${p(0.5).toFixed(1)} s, p90 ${p(0.9).toFixed(1)} s, max ${p(1).toFixed(1)} s`);
