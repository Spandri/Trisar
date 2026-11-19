// Umbau KI-Assistent, Phase 1 (18.11., reports/KI Assistent Umbau Plan.md): Formular "wie geschrieben".
// Das Modell schreibt je Absicht nur ab, was im Satz steht: datum_text "übernächsten Freitag", zeit_text
// "dreiviertel 7", fahrer_text ["Brnuo"], ausser_text ["Tim"]. Keine Daten, Uhrzeiten oder IDs vom Modell,
// gerechnet wird in kiNeuAufloesen.ts. Jedes Textfeld muss im Satz stehen, sonst ist es ein Modellfehler.
// Der Absicht-Prompt (verstehen.ts) bleibt unveraendert, Beispiele stehen hier hinten im Formular-Prompt.

// deno-lint-ignore-file no-explicit-any
import { modellGeht, modellGesperrt, modellSperren } from './verstehen.ts';
import { imSatz } from './kiNeuAufloesen.ts';

export type Modell = { url: string; modell: string; aus?: boolean };

const T = { type: 'string' };
const LISTE = { type: 'array', items: { type: 'string' } };
const REGEL = 'Schreib jede Angabe genau so ab, wie sie im Satz steht. Rechne nichts aus, wandle nichts um, ergänze nichts aus dem Gespräch. Felder ohne Angabe im Satz weglassen.';

// Je Absicht: Prompt und Schema. Schluessel sprechend und so benannt, dass alphabetische Reihenfolge passt
// (Ollama sortiert Schema-Schluessel auf manchen Wegen, Issue #18717).
const FORMULARE: Record<string, { system: string; schema: any }> = {
  dienst: {
    system: `Der Disponent setzt Dienstzeiten für Fahrer. ${REGEL}
fahrer_text: Namen der Fahrer wie geschrieben. ["alle"] wenn alle Fahrer gemeint sind, ["markierte"] für die markierten. Leer, wenn kein Name im Satz steht ("ihm", "ihr", "er").
ausser_text: ausgenommene Fahrer wie geschrieben ("alle außer Tim", "bis auf Lisa"), sonst weglassen.
tage: je genanntem Tag ein Eintrag. Kein Tag im Satz: ein Eintrag ohne datum_text.
  datum_text: der Tag wie geschrieben.
  start_text: Uhrzeit für Dienststart, Anfang, Beginn wie geschrieben.
  ende_text: Uhrzeit für Dienstende, Feierabend, Schluss wie geschrieben. Feierabend ohne Uhrzeit: "Feierabend".
  pause_von_text, pause_bis_text: Pause wie geschrieben.
  zeit_text: Uhrzeit, bei der nicht gesagt ist, ob Start oder Ende.

Beispiele:
"Schick Paul übermorgen um dreiviertel 7 Dienststart" -> {"fahrer_text":["Paul"],"tage":[{"datum_text":"übermorgen","start_text":"dreiviertel 7"}]}
"Feierabend für alle außer Lisa und Paul" -> {"ausser_text":["Lisa","Paul"],"fahrer_text":["alle"],"tage":[{"ende_text":"Feierabend"}]}
"Lisa nächsten Montag von 8 bis 16, Pause 12 bis halb 1" -> {"fahrer_text":["Lisa"],"tage":[{"datum_text":"nächsten Montag","ende_text":"16","pause_bis_text":"halb 1","pause_von_text":"12","start_text":"8"}]}
"Paul hört heute um 17 Uhr auf" -> {"fahrer_text":["Paul"],"tage":[{"datum_text":"heute","ende_text":"17 Uhr"}]}
"Dann schick ihm Dienststart für 9" -> {"fahrer_text":[],"tage":[{"start_text":"9"}]}
"Lisa heute 18 Uhr" -> {"fahrer_text":["Lisa"],"tage":[{"datum_text":"heute","zeit_text":"18 Uhr"}]}`,
    schema: { type: 'object', properties: { ausser_text: LISTE, fahrer_text: LISTE, tage: { type: 'array', items: { type: 'object', properties: {
      datum_text: T, ende_text: T, pause_bis_text: T, pause_von_text: T, start_text: T, zeit_text: T } } } }, required: ['fahrer_text', 'tage'] },
  },
  dienst_loeschen: {
    system: `Der Disponent will einen eingetragenen Dienst oder einen Teil davon entfernen. ${REGEL}
fahrer_text: Namen wie geschrieben, ["alle"] für alle, leer wenn kein Name im Satz steht.
ausser_text: ausgenommene Fahrer wie geschrieben, sonst weglassen.
was: "dienst" (ganzer Dienst, frei, krank, Urlaub), "start" (nur Dienststart), "ende" (nur Dienstende), "pausen".
datum_text: der Tag oder die Woche wie geschrieben.

Beispiele:
"Lösch das Dienstende von Paul am Freitag" -> {"datum_text":"am Freitag","fahrer_text":["Paul"],"was":"ende"}
"Lisa hat nächste Woche Urlaub" -> {"datum_text":"nächste Woche","fahrer_text":["Lisa"],"was":"dienst"}
"Streich die Pause von Paul morgen" -> {"datum_text":"morgen","fahrer_text":["Paul"],"was":"pausen"}`,
    schema: { type: 'object', properties: { ausser_text: LISTE, datum_text: T, fahrer_text: LISTE, was: { type: 'string', enum: ['dienst', 'start', 'ende', 'pausen'] } }, required: ['fahrer_text', 'was'] },
  },
  nachricht: {
    system: `Der Disponent will Fahrern eine Mitteilung schicken. Empfänger genau wie geschrieben, nichts ergänzen.
empfaenger_text: Namen der Fahrer wie geschrieben, ["alle"] wenn alle gemeint sind, leer wenn keiner genannt ist.
ausser_text: ausgenommene Fahrer wie geschrieben, sonst weglassen.
text: was der Fahrer lesen soll, mit den Worten des Disponenten, in direkter Anrede, ohne Namen am Anfang, ohne "dass er". Leer, wenn noch kein Inhalt genannt ist.

Beispiele:
"sag Paul er soll vorne warten" -> {"empfaenger_text":["Paul"],"text":"Bitte vorne warten."}
"Sag allen außer Lisa, dass sie tanken sollen" -> {"ausser_text":["Lisa"],"empfaenger_text":["alle"],"text":"Bitte tanken."}
"Nachricht an Paul und Lisa: Tanken nicht vergessen" -> {"empfaenger_text":["Paul","Lisa"],"text":"Tanken nicht vergessen."}`,
    schema: { type: 'object', properties: { ausser_text: LISTE, empfaenger_text: LISTE, text: T }, required: ['empfaenger_text', 'text'] },
  },
  fahrt: {
    system: `Der Disponent meint eine vorhandene Fahrt und will sie stornieren, als erledigt markieren, kopieren, eine Notiz anhängen oder ändern. ${REGEL}
Woran man die Fahrt erkennt: gast_text (Gast wie geschrieben), fahrer_text (Fahrer wie geschrieben), datum_text (Tag der Fahrt), zeit_text (bisherige Abfahrt der Fahrt), ort_text (Start oder Ziel der Fahrt).
Was neu sein soll: neu_zeit_text (neue Abfahrt), neu_fahrer_text (neuer Fahrer, "Anna soll fahren", "gib die Fahrt Anna"), neu_ziel_text (neues Ziel), neu_datum_text (Zieltag beim Kopieren oder Verschieben).
notiz_text: nur bei einer Notiz deren Text wörtlich.
Schreib alle Felder, "" wenn leer.

Beispiele:
"Verschieb die Fahrt von Frau Kurz auf 11" -> {"gast_text":"Frau Kurz","neu_zeit_text":"11"}
"Storniere die 14 Uhr Fahrt von Paul" -> {"fahrer_text":"Paul","zeit_text":"14 Uhr"}
"Gib die 9 Uhr Fahrt Lisa" -> {"neu_fahrer_text":"Lisa","zeit_text":"9 Uhr"}
"Die Fahrt von Herrn Berg morgen macht Lisa" -> {"datum_text":"morgen","gast_text":"Herrn Berg","neu_fahrer_text":"Lisa"}
"Kopier die Fahrt zum Flughafen auf Freitag" -> {"neu_datum_text":"Freitag","ort_text":"Flughafen"}`,
    // Alle Felder Pflicht (18.11.): ohne Pflichtfelder schrieb das Modell die restlichen Felder escaped in einen Wert
    // ('"zeit_text":"14 Uhr\\",\\"neu_fahrer_text\\":\\"Anna"') oder hoerte nach dem ersten auf.
    schema: { type: 'object', properties: { datum_text: T, fahrer_text: T, gast_text: T, neu_datum_text: T, neu_fahrer_text: T, neu_zeit_text: T, neu_ziel_text: T, notiz_text: T, ort_text: T, zeit_text: T },
      required: ['datum_text', 'fahrer_text', 'gast_text', 'neu_datum_text', 'neu_fahrer_text', 'neu_zeit_text', 'neu_ziel_text', 'notiz_text', 'ort_text', 'zeit_text'] },
  },
  fahrt_neu: {
    system: `Der Disponent bucht eine neue Fahrt. ${REGEL}
Fahrer und Gäste trennen. Fahrer sind die Chauffeure aus der Fahrerliste unten. Gäste sind die Fahrgäste ("Herr Engel", "Frau Kurz", "Gast ist Max Berg").
datum_text: Tag wie geschrieben, sonst "".
zeit_text: Abfahrt oder Zeitraum wie geschrieben ("dreiviertel 7", "zwischen 15 und 16 Uhr", "in zwei Stunden"), sonst "".
start_text: Abholort wie geschrieben, ohne "vom", "von", "ab", sonst "".
ziel_text: Ziel wie geschrieben, ohne "zum", "zur", "nach", sonst "".
gast_text: Gäste wie geschrieben, sonst [].
fahrer_text: Fahrer wie geschrieben, nur wenn ein Fahrer genannt ist ("mit Paul", "Fahrer Paul", "Paul soll fahren", "Paul fährt"). ["alle"] nur, wenn "alle" im Satz steht. Sonst []. Ein Fahrer ist nie ein Gast.
ausser_text: ausgenommene Fahrer ("alle außer Paul"), sonst [].
Schreib alle Felder, mit "" oder [] wenn leer, und nur gerade Anführungszeichen.

Beispiele:
"Fahrt morgen um dreiviertel 7 vom Hotel Adler zur Messe für Frau Kurz mit Paul" -> {"ausser_text":[],"datum_text":"morgen","fahrer_text":["Paul"],"gast_text":["Frau Kurz"],"start_text":"Hotel Adler","zeit_text":"dreiviertel 7","ziel_text":"Messe"}
"Herr Berg muss übermorgen um 6:45 vom Bahnhof zum Terminal 1, Lisa soll fahren" -> {"ausser_text":[],"datum_text":"übermorgen","fahrer_text":["Lisa"],"gast_text":["Herr Berg"],"start_text":"Bahnhof","zeit_text":"6:45","ziel_text":"Terminal 1"}
"Neue Fahrt heute um 18 Uhr vom Bahnhof zum Hotel Adler" -> {"ausser_text":[],"datum_text":"heute","fahrer_text":[],"gast_text":[],"start_text":"Bahnhof","zeit_text":"18 Uhr","ziel_text":"Hotel Adler"}`,
    schema: { type: 'object', properties: { ausser_text: LISTE, datum_text: T, fahrer_text: LISTE, gast_text: LISTE, start_text: T, zeit_text: T, ziel_text: T },
      required: ['ausser_text', 'datum_text', 'fahrer_text', 'gast_text', 'start_text', 'zeit_text', 'ziel_text'] },
  },
  standby: {
    system: `Der Disponent legt einen Standby an: Fahrer warten an einem Ort bereit, ohne Fahrt. ${REGEL}
fahrer_text: Namen wie geschrieben, ["alle"] für alle. ausser_text: ausgenommene Fahrer. datum_text: Tag wie geschrieben.
zeit_text: Zeitraum wie geschrieben ("10 bis 18", "ab 14 Uhr"). ort_text: Ort wie geschrieben.`,
    schema: { type: 'object', properties: { ausser_text: LISTE, datum_text: T, fahrer_text: LISTE, ort_text: T, zeit_text: T }, required: ['ausser_text', 'datum_text', 'fahrer_text', 'ort_text', 'zeit_text'] },
  },
  lohn: {
    system: `Der Disponent setzt den Stundenlohn von Fahrern. ${REGEL}
fahrer_text: Namen wie geschrieben, ["alle"] für alle. ausser_text: ausgenommene Fahrer. betrag_text: Betrag wie geschrieben.`,
    schema: { type: 'object', properties: { ausser_text: LISTE, betrag_text: T, fahrer_text: LISTE }, required: ['fahrer_text'] },
  },
};
export const FORMULAR_FUER: Record<string, string> = {
  dienst: 'dienst', dienst_loeschen: 'dienst_loeschen', nachricht: 'nachricht', fahrt_neu: 'fahrt_neu', standby: 'standby', lohn: 'lohn',
  fahrt_aendern: 'fahrt', fahrt_stornieren: 'fahrt', fahrt_erledigt: 'fahrt', fahrt_kopieren: 'fahrt', fahrt_notiz: 'fahrt',
};

export type FormularErgebnis = { formular: any; ms: number } | { fehler: 'frist' | 'modell' | 'kein_formular'; ms: number };

// Ein Modellaufruf mit Schema, wie in verstehen.ts (gleiche Sperre, num_ctx 4096, sonst laedt das Modell neu).
// Kein Gespraechsverlauf: das Formular darf nur aus dem Satz kommen.
// Antwort lesen. Am 18.11. schrieb das Modell '{"datum_text": "Samstag", "zeit_text": "11:58”, "}': gueltiges JSON,
// aber das typografische Anfuehrungszeichen beendete den Wert in Gedanken, und die restlichen Felder fehlten.
// Werte werden am typografischen Zeichen abgeschnitten, Pflichtfelder im Schema erzwingen den Rest.
const putzen = (x: any): any => (typeof x === 'string' ? x.replace(/[\u201c\u201d\u201e].*$/s, '').replace(/",\s*"\w+_text"\s*:.*$/s, '').trim()
  : Array.isArray(x) ? x.map(putzen).filter((v) => v !== '') : x && typeof x === 'object' ? Object.fromEntries(Object.entries(x).map(([k, v]) => [k, putzen(v)])) : x);
// Felder, die das Modell escaped in einen Wert geschrieben hat, wieder herausholen.
const entpacken = (o: any): any => {
  if (!o || typeof o !== 'object' || Array.isArray(o)) return o;
  const neu: any = { ...o };
  for (const [k, v] of Object.entries(o)) {
    if (typeof v !== 'string' || !/",\s*"\w+_text"\s*:/.test(v)) continue;
    try { Object.assign(neu, JSON.parse(`{"${k}":"${v}"}`)); } catch { /* bleibt geputzt */ }
  }
  return neu;
};
export const jsonLesen = (roh: string): any => {
  try { return putzen(entpacken(JSON.parse(roh))); } catch { /* reparieren */ }
  const t = roh.replace(/[\u201c\u201d\u201e]/g, '"').trim().replace(/,\s*"?\s*$/, '');
  for (const ende of ['}', '"}', ']}', '"]}', '}]}', '"}]}']) { try { return putzen(JSON.parse(t + ende)); } catch { /* weiter */ } }
  return null;
};

export const formularLesen = async (m: Modell | null, absicht: string, frage: string, frist = 20000, fahrerNamen: string[] = []): Promise<FormularErgebnis> => {
  const t0 = Date.now();
  const f = FORMULARE[FORMULAR_FUER[absicht] || ''];
  if (!f) return { fehler: 'kein_formular', ms: 0 };
  if (!m?.url || !m.modell || m.aus || modellGesperrt()) return { fehler: 'modell', ms: 0 };
  try {
    const r = await fetch(`${m.url.replace(/\/$/, '')}/api/chat`, {
      method: 'POST',
      signal: AbortSignal.timeout(frist),
      body: JSON.stringify({
        model: m.modell, stream: false, format: f.schema, keep_alive: -1, think: false,
        options: { temperature: 0, num_ctx: 4096 },
        // Fahrerliste hinten (Prompt-Cache bleibt fuer den festen Teil), damit Fahrer und Gast getrennt werden.
        messages: [{ role: 'system', content: fahrerNamen.length ? `${f.system}\n\nFahrerliste: ${fahrerNamen.join(', ')}.` : f.system }, { role: 'user', content: frage }],
      }),
    });
    if (!r.ok) return { fehler: 'modell', ms: Date.now() - t0 };
    const d = await r.json();
    modellGeht();
    const formular = jsonLesen(String(d?.message?.content || '{}'));
    if (!formular || typeof formular !== 'object') return { fehler: 'modell', ms: Date.now() - t0 };
    return { formular, ms: Date.now() - t0 };
  } catch (fehler) {
    if (fehler instanceof Error && /timeout|abort/i.test(`${fehler.name} ${fehler.message}`)) { m.aus = true; modellSperren(); return { fehler: 'frist', ms: Date.now() - t0 }; }
    return { fehler: 'modell', ms: Date.now() - t0 };
  }
};

// Alle Textfelder, die im Satz stehen muessen. "text" der Nachricht darf umformuliert sein, "was" ist eine Auswahl.
const FREI = new Set(['text', 'was']);
const ORT_FELD = new Set(['start_text', 'ziel_text', 'ort_text', 'neu_ziel_text', 'gast_text']);
export const felderNichtImSatz = (formular: any, frage: string): string[] => {
  const fehlt: string[] = [];
  const pruefen = (k: string, v: unknown) => {
    if (FREI.has(k) || v == null) return;
    if (Array.isArray(v)) { v.forEach((x) => pruefen(k, x)); return; }
    if (typeof v === 'object') { Object.entries(v as any).forEach(([k2, v2]) => pruefen(k2, v2)); return; }
    const s = String(v).trim();
    if (!s) return;
    // Gruppenwoerter stehen oft gebeugt im Satz ("allen", "die markierten Fahrer").
    if (/^(alle|markierte)$/i.test(s) && new RegExp(s === 'alle' ? '\\b(alle\\w*|jede\\w*|s(ä|ae)mtliche\\w*)\\b' : 'markiert', 'i').test(frage)) return;
    if (/^feierabend$/i.test(s) && /feierabend|heim|nach hause|schluss|dienstende|ende/i.test(frage)) return;
    // Orte und Gaeste schreibt das Modell gern in der Grundform ("Hotel Bayerischer Hof" statt "vom Bayerischen Hof"):
    // dort reicht ein tragendes Wort. Namen, Tage und Uhrzeiten muessen ganz im Satz stehen.
    // start_text ist bei der Fahrt ein Ort, beim Dienst eine Uhrzeit: nur Text mit Buchstaben-Woertern gilt als Ort.
    const tragend = String(s).split(/\s+/).filter((w) => w.length >= 4 && /\p{L}{4}/u.test(w));
    if (ORT_FELD.has(k) && tragend.length) { if (!tragend.some((w) => imSatz(w, frage))) fehlt.push(`${k}: ${s}`); return; }
    if (!imSatz(s, frage)) fehlt.push(`${k}: ${s}`);
  };
  Object.entries(formular || {}).forEach(([k, v]) => pruefen(k, v));
  return fehlt;
};
