// KI-Assistent (aktion ki_frage). Das Modell laeuft auf einem Rechner im Tailnet
// (integration_settings: ollama_url, ollama_model). Ist er aus, kommt ein Hinweis statt eines Fehlers.

// deno-lint-ignore-file no-explicit-any
import { einstellung } from './import.ts';
import { kiErstellen } from './kiKern.js';

const NICHT_ERREICHBAR = 'Der Assistent ist gerade nicht erreichbar, weil der Rechner mit dem Modell aus ist oder keine Verbindung hat.';
const FEHLGESCHLAGEN = 'Der Assistent konnte gerade nicht antworten. Bitte versuch es gleich noch einmal.';

const erreichbar = async (url: string) => {
  try {
    const r = await fetch(`${url.replace(/\/$/, '')}/api/version`, { signal: AbortSignal.timeout(4000) });
    return r.ok;
  } catch {
    return false;
  }
};

// Alle Apps bekommen dieselben Felder, immer als Text.
const vorschlagVereinheitlichen = (v: any) => ({
  datum: String(v?.datum || '').trim(),
  startZeit: String(v?.startZeit || '').trim(),
  start: String(v?.start || '').trim(),
  ziel: String(v?.ziel || '').trim(),
  fahrgaeste: String(v?.fahrgaeste || '').trim(),
  anonymeGaeste: String(v?.anonymeGaeste ?? '0').trim() || '0',
  fahrerNamen: (Array.isArray(v?.fahrerNamen) ? v.fahrerNamen : []).map((n: unknown) => String(n || '').trim()).filter(Boolean),
  konvoi: String(v?.konvoi || '').trim(),
  flugnummer: String(v?.flugnummer || '').trim(),
  notes: String(v?.notes || '').trim(),
  // Nur bei Aenderung einer bestehenden Fahrt: welche Fahrt und welche Felder.
  fahrtId: v?.fahrtId ? String(v.fahrtId) : null,
  geaendert: Array.isArray(v?.geaendert) ? v.geaendert.map(String) : [],
});

export const kiFrage = async (admin: any, body: any) => {
  const frage = String(body?.frage || '').trim().slice(0, 2000);
  if (!frage) return { status: 400, daten: { error: 'frage_fehlt' } };

  const ollamaUrl = await einstellung(admin, 'ollama_url', '');
  if (!ollamaUrl || !(await erreichbar(ollamaUrl))) {
    return { status: 200, daten: { answer: NICHT_ERREICHBAR, meta: { nichtErreichbar: true } } };
  }

  const verlauf = (Array.isArray(body?.verlauf) ? body.verlauf : [])
    .slice(-8)
    .map((m: any) => ({ role: m?.role === 'assistant' ? 'assistant' : 'user', text: String(m?.text || '').slice(0, 2000) }));
  const ollamaModell = await einstellung(admin, 'ollama_model', 'llama3.1:8b');
  const ki = kiErstellen({ admin, ollamaUrl, ollamaModell, kontext: body?.kontext });

  try {
    const ergebnis = await ki.fragen({
      prompt: frage,
      chatHistory: verlauf,
      offenerVorschlag: body?.offenerVorschlag && typeof body.offenerVorschlag === 'object' ? vorschlagVereinheitlichen(body.offenerVorschlag) : null,
      // iOS schickt UUIDs in Grossbuchstaben, die Datenbank liefert sie klein.
      letzteFahrtId: /^[0-9a-f-]{36}$/i.test(String(body?.letzteFahrtId || '')) ? String(body.letzteFahrtId).toLowerCase() : null,
    });
    const daten = typeof ergebnis === 'string' ? { answer: ergebnis } : ergebnis;
    if (daten?.action?.type === 'booking_proposal') daten.action.proposal = vorschlagVereinheitlichen(daten.action.proposal);
    return { status: 200, daten: { ...daten, kontext: ki.kontext() } };
  } catch (fehler) {
    console.error('ki_frage', fehler instanceof Error ? fehler.name : 'unbekannt');
    return { status: 200, daten: { answer: FEHLGESCHLAGEN, meta: { fehler: true }, kontext: ki.kontext() } };
  }
};
