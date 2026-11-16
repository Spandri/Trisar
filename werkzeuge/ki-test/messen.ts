// Zeitmessung um den KI-Testsatz (ki-test.ts), ohne den Assistenten zu aendern (15.11.).
// Faengt im Testprozess alle Aufrufe an Ollama ab (globalThis.fetch), ordnet sie dem Testschritt zu
// und schreibt eine Messdatei mit Gesamtzeit, Modellzeit, Ladezeit und Tokens je Schritt.
//
//   cd trisar && deno run -A werkzeuge/ki-test/messen.ts --modell=qwen2.5:14b --verstehen=qwen2.5:14b \
//     --ollama=http://100.121.170.114:11434 --etikett=baseline
//
// Alle Optionen von ki-test.ts gelten weiter (--nur, --uhr, ...). Zusaetzlich nur fuer Versuche,
// wirken nur in diesem Prozess auf die Anfragen an Ollama:
//   --ctx=4096              num_ctx in allen Ollama-Aufrufen setzen (live: verstehen 4096, kiKern 8192)
//   --keepalive=60m         keep_alive in allen Aufrufen setzen (live: verstehen 60m, kiKern 30m)
//   --planerformat=schema   Buchungs-Planer in kiKern mit Ollama-format (JSON-Schema) statt freiem Text
//   --planerformat=json     ... mit format "json"
//   --etikett=name          Name der Messdatei
//
// Ergebnis: werkzeuge/ki-test/messungen/<zeit>-<etikett>.json und .md (p50/p90/max, Modell vs. Rest).

// deno-lint-ignore-file no-explicit-any
const arg = (n: string, s: string) => Deno.args.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3) ?? s;
const ctx = Number(arg('ctx', '0')) || 0;
const keepalive = arg('keepalive', '');
const planerformat = arg('planerformat', '');
const etikett = arg('etikett', 'messung');

type Aufruf = {
  art: string; pfad: string; modell: string; ms: number; ok: boolean; promptZeichen: number; numCtx: number | null;
  load_ms: number; prompt_tokens: number; prompt_ms: number; eval_tokens: number; eval_ms: number; total_ms: number;
};
const offen: Aufruf[] = [];
const schritte: { zeile: string; ok: boolean; ms: number; aufrufe: Aufruf[] }[] = [];
let schrittBeginn = performance.now();
let eigenerBericht = '';

// Welcher Aufruf ist es? An festen Stuecken der Prompts erkennbar.
const artVon = (pfad: string, body: any) => {
  if (pfad.endsWith('/api/version')) return 'erreichbar';
  const sys = String(body?.messages?.[0]?.content || body?.prompt || '');
  if (sys.startsWith('Du liest Nachrichten eines Disponenten')) return 'v_absicht';
  if (sys.startsWith('Der Disponent spricht eine Gruppe')) return 'v_ausser';
  if (sys.startsWith('Der Disponent will Fahrern eine Mitteilung')) return 'v_nachricht';
  if (sys.startsWith('Der Disponent setzt Dienstzeiten')) return 'v_dienst';
  if (sys.startsWith('Der Disponent will einen eingetragenen Dienst')) return 'v_dienst_loeschen';
  if (sys.startsWith('Der Disponent will einen vorhandenen Standby')) return 'v_standby';
  if (sys.startsWith('Der Disponent meint eine vorhandene Fahrt')) return 'v_fahrt';
  if (sys.startsWith('Du extrahierst Buchungsdaten')) return 'k_planer';
  if (pfad.endsWith('/api/generate')) return /WICHTIG: Antworte jetzt maximal/.test(sys) ? 'k_generate_retry' : 'k_generate';
  if (pfad.endsWith('/api/chat')) return 'frei_oder_anderes';
  return 'anderes';
};

const PLANER_SCHEMA = {
  type: 'object',
  properties: {
    intent: { type: 'string' }, needs_clarification: { type: 'boolean' },
    missing_fields: { type: 'array', items: { type: 'string' } }, clarification_question: { type: 'string' },
    ride: { type: 'object', properties: {
      ride_date: { type: 'string' }, etd: { type: 'string' }, pickup_name: { type: 'string' }, dropoff_name: { type: 'string' },
      guest_names: { type: 'array', items: { type: 'string' } }, anonymous_guests: { type: 'integer' },
      driver_names: { type: 'array', items: { type: 'string' } }, convoy_name: { type: 'string' },
      flight_number: { type: 'string' }, note: { type: 'string' },
    }, required: ['ride_date', 'etd', 'pickup_name', 'dropoff_name', 'guest_names', 'driver_names'] },
  },
  required: ['intent', 'needs_clarification', 'missing_fields', 'ride'],
};

const echtFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = (async (eingabe: any, optionen: any = {}) => {
  const url = typeof eingabe === 'string' ? eingabe : eingabe instanceof URL ? eingabe.href : eingabe.url;
  if (!/:11434\//.test(url)) return echtFetch(eingabe, optionen);
  const pfad = new URL(url).pathname;
  let body: any = null;
  try { body = optionen?.body ? JSON.parse(String(optionen.body)) : null; } catch { body = null; }
  const art = artVon(pfad, body);
  if (body && (pfad.endsWith('/api/chat') || pfad.endsWith('/api/generate'))) {
    if (ctx) body.options = { ...(body.options || {}), num_ctx: ctx };
    if (keepalive) body.keep_alive = keepalive;
    if (art === 'k_planer' && planerformat) body.format = planerformat === 'json' ? 'json' : PLANER_SCHEMA;
    optionen = { ...optionen, body: JSON.stringify(body) };
  }
  const t0 = performance.now();
  const a: Aufruf = {
    art, pfad, modell: String(body?.model || ''), ms: 0, ok: false,
    promptZeichen: body ? JSON.stringify(body.messages || body.prompt || '').length : 0, numCtx: body?.options?.num_ctx ?? null,
    load_ms: 0, prompt_tokens: 0, prompt_ms: 0, eval_tokens: 0, eval_ms: 0, total_ms: 0,
  };
  try {
    const r = await echtFetch(eingabe, optionen);
    if (art !== 'erreichbar') {
      const d = await r.clone().json().catch(() => null);
      const ns = (x: unknown) => Math.round(Number(x || 0) / 1e6);
      a.load_ms = ns(d?.load_duration); a.prompt_tokens = Number(d?.prompt_eval_count || 0); a.prompt_ms = ns(d?.prompt_eval_duration);
      a.eval_tokens = Number(d?.eval_count || 0); a.eval_ms = ns(d?.eval_duration); a.total_ms = ns(d?.total_duration);
    }
    a.ok = r.ok;
    a.ms = Math.round(performance.now() - t0);
    offen.push(a);
    return r;
  } catch (f) {
    a.ms = Math.round(performance.now() - t0);
    offen.push(a);
    throw f;
  }
}) as typeof fetch;

// Schrittgrenze: ki-test.ts schreibt je Schritt eine Zeile mit "OK  " oder "FEHL" am Anfang.
const echtLog = console.log.bind(console);
console.log = (...x: any[]) => {
  const zeile = String(x[0] ?? '');
  // Eigener Bericht von ki-test.ts (nur diesen anfassen, andere Laeufe koennen gleichzeitig schreiben).
  const b = zeile.match(/^Bericht: werkzeuge\/ki-test\/ergebnisse\/(.+)\.md$/);
  if (b) eigenerBericht = b[1];
  if (/^(OK  |FEHL) /.test(zeile)) {
    const jetzt = performance.now();
    schritte.push({ zeile: zeile.trim(), ok: zeile.startsWith('OK'), ms: Math.round(jetzt - schrittBeginn), aufrufe: offen.splice(0) });
    schrittBeginn = jetzt;
  }
  echtLog(...x);
};

// ki-test.ts benennt seinen Bericht nach der Testuhr (11:00 + Laufzeit) und ueberschreibt so fruehere
// Berichte mit gleichem Namen. Darum: Ordner vorher sichern, danach nur den eigenen Bericht (Name aus der
// Zeile "Bericht: ...") nach messungen/ verschieben und einen gleichnamigen alten Stand wiederherstellen.
// Nie andere Dateien anfassen: ein zweiter Testlauf kann gleichzeitig in ergebnisse/ schreiben.
const EchtDate = Date;
const ergebnisOrdner = new URL('./ergebnisse/', import.meta.url);
const vorher = new Map<string, string>();
for await (const e of Deno.readDir(ergebnisOrdner)) if (e.isFile) vorher.set(e.name, await Deno.readTextFile(new URL(e.name, ergebnisOrdner)));

const beginn = performance.now();
await import('./ki-test.ts');
const gesamt = Math.round(performance.now() - beginn);
console.log = echtLog;

// Auswertung
const q = (werte: number[], p: number) => {
  const s = [...werte].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : 0;
};
const modellMs = (s: typeof schritte[number]) => s.aufrufe.filter((a) => a.art !== 'erreichbar').reduce((n, a) => n + a.ms, 0);
const reihe = (name: string, w: number[]) => `| ${name} | ${w.length} | ${q(w, 0.5)} | ${q(w, 0.9)} | ${Math.max(0, ...w)} | ${Math.round(w.reduce((a, b) => a + b, 0) / Math.max(1, w.length))} |`;
const schrittMs = schritte.map((s) => s.ms);
const mitModell = schritte.filter((s) => s.aufrufe.some((a) => a.art !== 'erreichbar'));
const ohneModell = schritte.filter((s) => !s.aufrufe.some((a) => a.art !== 'erreichbar'));
const alleAufrufe = schritte.flatMap((s) => s.aufrufe).filter((a) => a.art !== 'erreichbar');
const arten = [...new Set(alleAufrufe.map((a) => a.art))].sort();
const nachArt = arten.map((art) => {
  const r = alleAufrufe.filter((a) => a.art === art);
  const m = (f: (a: Aufruf) => number) => Math.round(r.reduce((n, a) => n + f(a), 0) / r.length);
  return `| ${art} | ${r.length} | ${q(r.map((a) => a.ms), 0.5)} | ${q(r.map((a) => a.ms), 0.9)} | ${Math.max(...r.map((a) => a.ms))} | ${m((a) => a.load_ms)} | ${r.filter((a) => a.load_ms > 1000).length} | ${m((a) => a.prompt_tokens)} | ${m((a) => a.eval_tokens)} | ${m((a) => a.promptZeichen)} | ${[...new Set(r.map((a) => a.numCtx))].join('/')} |`;
});
const anzahlVerteilung = new Map<number, number>();
for (const s of schritte) {
  const n = s.aufrufe.filter((a) => a.art !== 'erreichbar').length;
  anzahlVerteilung.set(n, (anzahlVerteilung.get(n) || 0) + 1);
}
const okAnzahl = schritte.filter((s) => s.ok).length;
const stempel = new EchtDate().toLocaleString('sv-SE', { timeZone: 'Europe/Berlin' }).slice(0, 16).replace(/[: ]/g, '-');
const bericht = [
  `# Messung ${etikett} ${stempel}`, '',
  `Argumente: ${Deno.args.join(' ')}`, '',
  `Schritte ${schritte.length}, richtig ${okAnzahl}, Gesamtdauer ${(gesamt / 60000).toFixed(1)} min`, '',
  '## Dauer je Schritt (ms)', '', '| Auswahl | n | p50 | p90 | max | Mittel |', '|---|---|---|---|---|---|',
  reihe('alle Schritte', schrittMs),
  reihe('Schritte mit Modell', mitModell.map((s) => s.ms)),
  reihe('Schritte ohne Modell', ohneModell.map((s) => s.ms)),
  reihe('davon Modellzeit (mit Modell)', mitModell.map(modellMs)),
  reihe('davon Rest (mit Modell)', mitModell.map((s) => s.ms - modellMs(s))),
  '', `Modellaufrufe je Schritt: ${[...anzahlVerteilung].sort((a, b) => a[0] - b[0]).map(([n, k]) => `${n} Aufrufe: ${k}x`).join(', ')}`, '',
  '## Aufrufe nach Art', '', '| Art | n | p50 ms | p90 ms | max ms | Ladezeit Mittel ms | Neu geladen (>1 s) | Prompt-Tokens Mittel | Antwort-Tokens Mittel | Prompt-Zeichen Mittel | num_ctx |', '|---|---|---|---|---|---|---|---|---|---|---|',
  ...nachArt,
  '', '## Langsamste Schritte', '',
  ...[...schritte].sort((a, b) => b.ms - a.ms).slice(0, 15).map((s) => `- ${(s.ms / 1000).toFixed(1)} s, Modell ${(modellMs(s) / 1000).toFixed(1)} s (${s.aufrufe.filter((a) => a.art !== 'erreichbar').map((a) => `${a.art} ${(a.ms / 1000).toFixed(1)}s${a.load_ms > 1000 ? ` Laden ${(a.load_ms / 1000).toFixed(1)}s` : ''}`).join(', ')}): ${s.zeile}`),
].join('\n');
const ordner = new URL('./messungen/', import.meta.url);
await Deno.mkdir(ordner, { recursive: true });
for (const endung of eigenerBericht ? ['.md', '.json'] : []) {
  const name = `${eigenerBericht}${endung}`;
  const neu = await Deno.readTextFile(new URL(name, ergebnisOrdner)).catch(() => null);
  if (neu == null) continue;
  await Deno.writeTextFile(new URL(`${stempel}-${etikett}-ergebnis${endung}`, ordner), neu);
  // Gab es den Namen schon vor dem Lauf, alten Stand zurueck, sonst die eigene Datei entfernen.
  if (vorher.has(name)) await Deno.writeTextFile(new URL(name, ergebnisOrdner), vorher.get(name)!);
  else await Deno.remove(new URL(name, ergebnisOrdner));
}
await Deno.writeTextFile(new URL(`${stempel}-${etikett}.md`, ordner), bericht);
await Deno.writeTextFile(new URL(`${stempel}-${etikett}.json`, ordner), JSON.stringify({ argumente: Deno.args, gesamt, schritte }, null, 2));
echtLog(`\n${bericht}\n\nMessung: werkzeuge/ki-test/messungen/${stempel}-${etikett}.md`);
