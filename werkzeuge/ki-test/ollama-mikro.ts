// Kleine Versuche direkt gegen Ollama, ohne den Assistenten (15.11.). Nutzt den echten Absicht-Prompt aus
// verstehen.ts und die Saetze aus verstehen-test.ts (aus dem Quelltext gelesen, nichts wird geaendert).
//
//   cd trisar && deno run -A werkzeuge/ki-test/ollama-mikro.ts --ollama=http://100.121.170.114:11434 --modell=qwen2.5:14b
//   ... --versuch=laden     Kaltstart und Neuladen bei wechselndem num_ctx (4096 <-> 8192)
//   ... --versuch=format    Absicht mit format=Schema (live) / format="json" / ohne format, Treffer und Dauer
//   ... --jeder=3           nur jeden n-ten Satz (format)
//
// Achtung: --versuch=laden entlaedt das Modell einmal (keep_alive 0). Danach wird es wieder geladen.

// deno-lint-ignore-file no-explicit-any
const arg = (n: string, s: string) => Deno.args.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3) ?? s;
const url = arg('ollama', 'http://localhost:11434').replace(/\/$/, '');
const modell = arg('modell', 'qwen2.5:14b');
const versuch = arg('versuch', 'format');
const jeder = Number(arg('jeder', '3')) || 1;

const quelle = await Deno.readTextFile(new URL('../../fahrer/supabase/functions/dispo-admin/verstehen.ts', import.meta.url));
const ABSICHT_SYSTEM = quelle.match(/const ABSICHT_SYSTEM = `([\s\S]*?)`;/)![1];
const ABSICHTEN = [...quelle.match(/export const ABSICHTEN = \[([\s\S]*?)\] as const/)![1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
const testQuelle = await Deno.readTextFile(new URL('./verstehen-test.ts', import.meta.url));
// Nur der Hauptsatz F (bis "const NEU"), Zeilen der Form ['Satz', 'absicht' oder ['a','b'], ...]
const fTeil = testQuelle.slice(testQuelle.indexOf('const F: Fall[]'), testQuelle.indexOf('const NEU'));
const SAETZE: [string, string[]][] = [...fTeil.matchAll(/^\s*\['((?:[^'\\]|\\.)*)',\s*(\[[^\]]*\]|'[a-z_]+')/gm)]
  .map((m) => [m[1].replace(/\\'/g, "'"), m[2].startsWith('[') ? [...m[2].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]) : [m[2].slice(1, -1)]]);

const ns = (x: unknown) => Math.round(Number(x || 0) / 1e6);
const chat = async (body: any) => {
  const t0 = performance.now();
  const r = await fetch(`${url}/api/chat`, { method: 'POST', body: JSON.stringify({ stream: false, model: modell, think: false, ...body }) });
  const d = await r.json();
  return { ms: Math.round(performance.now() - t0), load: ns(d?.load_duration), pTok: d?.prompt_eval_count || 0, pMs: ns(d?.prompt_eval_duration), eTok: d?.eval_count || 0, eMs: ns(d?.eval_duration), text: String(d?.message?.content || '') };
};
const absicht = (satz: string, format: any, numCtx = 4096, extra = '') => chat({
  format, keep_alive: '60m', options: { temperature: 0, num_ctx: numCtx },
  messages: [{ role: 'system', content: ABSICHT_SYSTEM + extra }, { role: 'user', content: satz }],
});

if (versuch === 'laden') {
  console.log(`Modell ${modell}, ${url}`);
  // 1. Warm, gleicher Kontext
  const warm = await absicht('Wo ist Tim?', { type: 'object', properties: { absicht: { type: 'string', enum: ABSICHTEN } }, required: ['absicht'] });
  console.log(`warm (num_ctx 4096):            ${warm.ms} ms, Laden ${warm.load} ms, Prompt ${warm.pTok} Tok in ${warm.pMs} ms, Antwort ${warm.eTok} Tok in ${warm.eMs} ms`);
  const warm2 = await absicht('Wo ist Marvin?', { type: 'object', properties: { absicht: { type: 'string', enum: ABSICHTEN } }, required: ['absicht'] });
  console.log(`warm, zweiter Satz:             ${warm2.ms} ms, Laden ${warm2.load} ms, Prompt ${warm2.pTok} Tok in ${warm2.pMs} ms`);
  // 2. Wechsel auf num_ctx 8192 (wie kiKern) und zurueck
  for (const [i, c] of [8192, 4096, 8192, 4096].entries()) {
    const r = await absicht(`Wo ist Anna? (${i})`, { type: 'object', properties: { absicht: { type: 'string', enum: ABSICHTEN } }, required: ['absicht'] }, c);
    console.log(`Wechsel auf num_ctx ${c}:       ${r.ms} ms, Laden ${r.load} ms`);
  }
  // 3. Kaltstart: entladen, dann gleiche Anfrage
  await fetch(`${url}/api/generate`, { method: 'POST', body: JSON.stringify({ model: modell, keep_alive: 0 }) }).then((r) => r.text());
  await new Promise((r) => setTimeout(r, 1500));
  const kalt = await absicht('Wo ist Tim?', { type: 'object', properties: { absicht: { type: 'string', enum: ABSICHTEN } }, required: ['absicht'] });
  console.log(`kalt (nach Entladen):           ${kalt.ms} ms, Laden ${kalt.load} ms`);
  const danach = await absicht('Wo ist Tim?', { type: 'object', properties: { absicht: { type: 'string', enum: ABSICHTEN } }, required: ['absicht'] });
  console.log(`direkt danach, gleicher Satz:   ${danach.ms} ms, Prompt ${danach.pTok} Tok in ${danach.pMs} ms (Prompt-Cache)`);
  Deno.exit(0);
}

if (versuch === 'format') {
  const auswahl = SAETZE.filter((_, i) => i % jeder === 0);
  console.log(`Modell ${modell}, ${auswahl.length} von ${SAETZE.length} Saetzen`);
  const SCHEMA = { type: 'object', properties: { absicht: { type: 'string', enum: ABSICHTEN } }, required: ['absicht'] };
  const varianten: [string, any, string][] = [
    ['schema (live)', SCHEMA, ''],
    ['json', 'json', '\n\nAntworte nur als JSON: {"absicht": "<eine der Absichten oben>"}'],
    ['ohne format', undefined, '\n\nAntworte nur mit dem Namen der Absicht, ein Wort, ohne Erklärung.'],
  ];
  // Varianten je Satz abwechselnd, damit Last von aussen alle Varianten gleich trifft.
  const stat = varianten.map(() => ({ ok: 0, ungueltig: 0, ms: [] as number[], eTok: [] as number[], innen: [] as number[] }));
  for (const [satz, soll] of auswahl) {
    for (const [i, [, format, extra]] of varianten.entries()) {
      const r = await absicht(satz, format, 4096, extra);
      const st = stat[i];
      st.ms.push(r.ms); st.eTok.push(r.eTok); st.innen.push(r.ms - r.pMs - r.eMs);
      let a = '';
      if (format) { try { a = String(JSON.parse(r.text)?.absicht || ''); } catch { a = ''; } }
      else a = r.text.trim().toLowerCase().replace(/[^a-z_]/g, '');
      if (!ABSICHTEN.includes(a)) st.ungueltig += 1;
      if (soll.includes(a)) st.ok += 1;
    }
  }
  for (const [i, [name]] of varianten.entries()) {
    const st = stat[i];
    const q = (w: number[], p: number) => [...w].sort((x, y) => x - y)[Math.min(w.length - 1, Math.floor(p * w.length))];
    console.log(`${name.padEnd(14)} ${st.ok}/${auswahl.length} richtig, ungueltig ${st.ungueltig}, p50 ${q(st.ms, 0.5)} ms, p90 ${q(st.ms, 0.9)} ms, max ${Math.max(...st.ms)} ms, Antwort-Tokens Mittel ${(st.eTok.reduce((a, b) => a + b, 0) / st.eTok.length).toFixed(1)}, Zeit ausser Prompt+Antwort p50 ${q(st.innen, 0.5)} ms`);
  }
}
