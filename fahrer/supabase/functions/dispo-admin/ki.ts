// KI-Assistent (aktion ki_frage). Das Modell laeuft auf einem Rechner im Tailnet
// (integration_settings: ollama_url, ollama_model). Ist er aus, kommt ein Hinweis statt eines Fehlers.

// deno-lint-ignore-file no-explicit-any
import { einstellung } from './import.ts';
import { kiErstellen } from './kiKern.js';
import { dienstVorschlag, markierteFahrer } from './dienst.ts';
import { lohnVorschlag } from './lohn.ts';

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

// Art einer Antwort fuers Protokoll (ki_protokoll) und den Testsatz (werkzeuge/ki-test).
export const antwortArt = (daten: any, kontext: any = null) => {
  if (daten?.meta?.nichtErreichbar) return 'nicht_erreichbar';
  if (daten?.meta?.fehler) return 'fehler';
  const typ = daten?.action?.type;
  if (typ === 'dienst_vorschlag') return 'dienst_vorschlag';
  if (typ === 'booking_proposal') return daten.action.proposal?.fahrtId ? 'fahrt_aendern' : 'fahrt_buchen';
  if (typ) return String(typ);
  if (kontext?.rueckfrage || /\?\s*$/.test(String(daten?.answer || ''))) return 'rueckfrage';
  return 'antwort';
};

// Jede Frage protokollieren, Fehler beim Schreiben nie an die App weitergeben.
// Eintraege aelter als 30 Tage werden dabei geloescht (Fragen enthalten Namen).
const protokollieren = async (admin: any, eintrag: Record<string, unknown>) => {
  try {
    await admin.from('ki_protokoll').insert(eintrag);
    await admin.from('ki_protokoll').delete().lt('erstellt', new Date(Date.now() - 30 * 86400000).toISOString());
  } catch {
    // Protokoll ist Nebensache.
  }
};

export const kiFrage = async (admin: any, body: any, dispoId: string | null = null) => {
  const beginn = Date.now();
  const frage = String(body?.frage || '').trim().slice(0, 2000);
  const ergebnis = await kiFrageIntern(admin, body, frage);
  if (frage) {
    const d = ergebnis.daten as any;
    await protokollieren(admin, {
      dispo_id: dispoId,
      frage,
      art: antwortArt(d, d?.kontext),
      antwort: String(d?.answer || '').slice(0, 4000),
      aktion: d?.action ?? null,
      dauer_ms: Date.now() - beginn,
      modell: d?.modell ?? null,
      fehler: d?.meta?.fehlerName ?? null,
    });
  }
  return ergebnis;
};

const kiFrageIntern = async (admin: any, body: any, frage: string) => {
  if (!frage) return { status: 400, daten: { error: 'frage_fehlt' } };

  // Markierte Fahrer (Karte) in Feierabend schicken oder anfangen lassen: ohne Modell, als Vorschlag.
  const markiert = markierteFahrer(body);
  // Stundenlohn setzen oder nachschauen: Rueckfrage, "ja" speichert. Auch ohne Modell.
  const lohn = await lohnVorschlag(admin, frage, markiert, body?.kontext ?? null);
  if (lohn) return { status: 200, daten: { answer: lohn.answer, kontext: lohn.kontext } };
  const dienst = await dienstVorschlag(admin, frage, markiert);
  if (dienst) return { status: 200, daten: { ...dienst, kontext: body?.kontext ?? null } };

  // Haupt-Rechner (ollama_url, Mac mini) und Ersatz (ollama_url_ersatz, MacBook). Beide werden
  // gleichzeitig geprueft, genommen wird der erste erreichbare in dieser Reihenfolge.
  const kandidaten = [await einstellung(admin, 'ollama_url', ''), await einstellung(admin, 'ollama_url_ersatz', '')]
    .flatMap((u) => String(u || '').split(','))
    .map((u) => u.trim())
    .filter(Boolean);
  const erreichbarkeit = await Promise.all(kandidaten.map(erreichbar));
  const ollamaUrl = kandidaten.find((_, i) => erreichbarkeit[i]) || '';
  if (!ollamaUrl) {
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
      // Auf der Karte markierte Fahrer ("wo sind die drei", "was machen die markierten").
      markierteFahrer: markiert,
    });
    const daten = typeof ergebnis === 'string' ? { answer: ergebnis } : ergebnis;
    if (daten?.action?.type === 'booking_proposal') daten.action.proposal = vorschlagVereinheitlichen(daten.action.proposal);
    return { status: 200, daten: { ...daten, kontext: ki.kontext(), modell: ollamaModell } };
  } catch (fehler) {
    const name = fehler instanceof Error ? fehler.name : 'unbekannt';
    console.error('ki_frage', name);
    return { status: 200, daten: { answer: FEHLGESCHLAGEN, meta: { fehler: true, fehlerName: name }, kontext: ki.kontext(), modell: ollamaModell } };
  }
};
