// Probe: kann das Modell Absicht und Felder sicher aus frei formulierten Saetzen lesen?
// Ollama mit JSON-Schema (format), Temperatur 0. Misst Treffer und Dauer je Satz.
//
//   cd trisar && deno run -A werkzeuge/ki-test/absicht-modell.ts --modell=qwen2.5:14b --ollama=http://100.121.170.114:11434

// deno-lint-ignore-file no-explicit-any
const arg = (n: string, s: string) => Deno.args.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3) ?? s;
const modell = arg('modell', 'qwen2.5:14b');
const ollama = arg('ollama', 'http://localhost:11434');

const SCHEMA = {
  type: 'object',
  properties: {
    absicht: { type: 'string', enum: ['nachricht', 'fahrt_neu', 'fahrt_aendern', 'fahrt_stornieren', 'dienst', 'dienst_loeschen', 'standby', 'frage', 'sonstiges'] },
    empfaenger: { type: 'array', items: { type: 'string' }, description: 'Namen der Fahrer, an die eine Nachricht geht, oder ["alle"]' },
    text: { type: 'string', description: 'Wortlaut der Nachricht an den Fahrer, in direkter Anrede' },
  },
  required: ['absicht', 'empfaenger', 'text'],
};
const SYSTEM = `Du liest Nachrichten eines Disponenten an seinen Assistenten in einer Fahrdienst-App und bestimmst die Absicht.

nachricht: Der Disponent will, dass ein Fahrer etwas erfährt oder tun soll, und der Assistent soll es ihm ausrichten.
Typische Formen: "sag X ...", "gib X Bescheid ...", "erinner X ...", "X soll ...", "schreib X ...", "X melde dich", "an alle: ...", "Push an X: ...".
Auch wenn der Inhalt eine Fahranweisung ist ("sie soll zum Terminal 2 fahren"), ist es eine nachricht, solange keine neue Fahrt mit Zeit und Strecke gebucht wird.
Dann: empfaenger = Namen wie geschrieben oder ["alle"], text = was der Fahrer liest, möglichst mit den Worten des Disponenten, in direkter Anrede, ohne Namen am Anfang, ohne "dass er".

fahrt_neu: neue Fahrt buchen, mit Ziel oder Strecke ("Buch ...", "Schick X um 7 zum Flughafen").
dienst: Dienstzeiten eines Fahrers (Dienststart, Feierabend, "Schick X morgen um 7" ohne Ziel ist ein Dienststart).
fahrt_aendern, fahrt_stornieren, dienst_loeschen, standby, frage (Frage an den Assistenten), sonstiges.
Bei allem außer nachricht: empfaenger = [] und text = "".

Beispiele:
"sag Paul er soll vorne warten" -> nachricht ["Paul"] "Bitte vorne warten."
"Lisa ruf mich an" -> nachricht ["Lisa"] "Ruf mich an."
"erinnere alle an die Westen" -> nachricht ["alle"] "Denkt an die Westen."
"Schick Paul morgen um 6" -> dienst
"Schick Paul morgen um 6 zum Bahnhof" -> fahrt_neu
"Wann kommt Paul?" -> frage`;

const FAELLE: [string, string, string[], string][] = [
  ['Schicke eine Nachricht an Stefano: beeil dich bitte', 'nachricht', ['Stefano'], 'beeil'],
  ['stefano soll sich beeilen, sag ihm das mal', 'nachricht', ['Stefano'], 'beeil'],
  ['kannst du tim mitteilen dass der gast 10 min später kommt', 'nachricht', ['Tim'], '10'],
  ['an alle: morgen treffpunkt 7 uhr halle b', 'nachricht', ['alle'], 'halle b'],
  ['Gib Anna Bescheid, sie soll zum Terminal 2 fahren', 'nachricht', ['Anna'], 'terminal 2'],
  ['Push an Marvin und Tim: bitte tanken', 'nachricht', ['Marvin', 'Tim'], 'tank'],
  ['Erinner Stefano daran, das Kennzeichen-Foto hochzuladen', 'nachricht', ['Stefano'], 'foto'],
  ['tim melde dich mal bei mir', 'nachricht', ['Tim'], 'meld'],
  ['Schreib allen Fahrern, dass heute Abend Weihnachtsfeier ist', 'nachricht', ['alle'], 'weihnachtsfeier'],
  ['Buch Tim morgen um 7 vom Hotel zum Flughafen', 'fahrt_neu', [], ''],
  ['Schick Stefano morgen um 7 zum Flughafen', 'fahrt_neu', [], ''],
  ['Schick Tim morgen um 7', 'dienst', [], ''],
  ['Stefano heute Feierabend um 18 Uhr', 'dienst', [], ''],
  ['Storniere die Fahrt von Herrn Engel', 'fahrt_stornieren', [], ''],
  ['Wo ist Stefano gerade?', 'frage', [], ''],
  ['Sag mir wann Tim morgen anfängt', 'frage', [], ''],
];

let ok = 0;
let ms = 0;
for (const [satz, absicht, empf, wort] of FAELLE) {
  const t0 = Date.now();
  const r = await fetch(`${ollama}/api/chat`, {
    method: 'POST',
    body: JSON.stringify({ model: modell, stream: false, format: SCHEMA, options: { temperature: 0 },
      messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: satz }] }),
  });
  const d = await r.json();
  const dauer = Date.now() - t0;
  ms += dauer;
  let j: any = {};
  try { j = JSON.parse(d?.message?.content || '{}'); } catch { /* leer */ }
  const empfOk = absicht !== 'nachricht' || empf.every((e) => (j.empfaenger || []).some((x: string) => x.toLowerCase().includes(e.toLowerCase())));
  const textOk = !wort || String(j.text || '').toLowerCase().includes(wort);
  const richtig = j.absicht === absicht && empfOk && textOk;
  if (richtig) ok += 1;
  console.log(`${richtig ? 'OK  ' : 'FEHL'} ${(dauer / 1000).toFixed(1)}s  ${satz.padEnd(62)} -> ${j.absicht} ${JSON.stringify(j.empfaenger)} „${j.text}“`);
}
console.log(`\n${modell}: ${ok}/${FAELLE.length} richtig, im Schnitt ${(ms / FAELLE.length / 1000).toFixed(1)} s`);
