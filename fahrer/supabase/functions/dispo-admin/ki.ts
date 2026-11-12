// KI-Assistent (aktion ki_frage). Das Modell laeuft auf einem Rechner im Tailnet
// (integration_settings: ollama_url, ollama_model). Ist er aus, kommt ein Hinweis statt eines Fehlers.

// deno-lint-ignore-file no-explicit-any
import { einstellung } from './import.ts';
import { kiErstellen } from './kiKern.js';
import { dienstVorschlag, markierteFahrer } from './dienst.ts';
import { lohnVorschlag } from './lohn.ts';
import { anlegenVorschlag, ohnePasswort } from './anlegen.ts';
import { vorschlagOrteAufloesen } from './ortSuche.ts';
import { flugHinweis, flugPruefen } from './flugKi.ts';
import { standbyAntwort, standbyKarte, standbyKartenText, standbyTeil, standbyZurBuchung } from './standbyKi.ts';

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
  // Eigener Ort (orte): ID und Adresse, die Apps speichern sie wie bei Auswahl im Formular (ortSuche.ts).
  startOrtId: String(v?.startOrtId || '').trim(),
  startAdresse: String(v?.startAdresse || '').trim(),
  zielOrtId: String(v?.zielOrtId || '').trim(),
  zielAdresse: String(v?.zielAdresse || '').trim(),
  fahrgaeste: String(v?.fahrgaeste || '').trim(),
  anonymeGaeste: String(v?.anonymeGaeste ?? '0').trim() || '0',
  fahrerNamen: (Array.isArray(v?.fahrerNamen) ? v.fahrerNamen : []).map((n: unknown) => String(n || '').trim()).filter(Boolean),
  konvoi: String(v?.konvoi || '').trim(),
  flugnummer: String(v?.flugnummer || '').trim(),
  notes: String(v?.notes || '').trim(),
  // Nur bei Aenderung einer bestehenden Fahrt: welche Fahrt und welche Felder.
  fahrtId: v?.fahrtId ? String(v.fahrtId) : null,
  // Flug nicht bestaetigt (flugKi.ts): Buchen speichert ohne Flugpruefung.
  flugUnbestaetigt: v?.flugUnbestaetigt === true,
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
  const ergebnis = await kiFrageIntern(admin, body, frage, dispoId);
  if (frage) {
    const d = ergebnis.daten as any;
    await protokollieren(admin, {
      dispo_id: dispoId,
      frage: ohnePasswort(frage),
      art: antwortArt(d, d?.kontext),
      antwort: ohnePasswort(String(d?.answer || '')).slice(0, 4000),
      aktion: d?.action ?? null,
      dauer_ms: Date.now() - beginn,
      modell: d?.modell ?? null,
      fehler: d?.meta?.fehlerName ?? null,
    });
  }
  return ergebnis;
};

const kiFrageIntern = async (admin: any, body: any, frage: string, dispoId: string | null = null) => {
  if (!frage) return { status: 400, daten: { error: 'frage_fehlt' } };

  // Markierte Fahrer (Karte) in Feierabend schicken oder anfangen lassen: ohne Modell, als Vorschlag.
  const markiert = markierteFahrer(body);
  // Stundenlohn setzen oder nachschauen: Rueckfrage, "ja" speichert. Auch ohne Modell.
  const lohn = await lohnVorschlag(admin, frage, markiert, body?.kontext ?? null);
  if (lohn) return { status: 200, daten: { answer: lohn.answer, kontext: lohn.kontext } };
  // Fahrer oder Fahrzeug anlegen: Rueckfrage mit allen Angaben, "ja" legt an. Auch ohne Modell.
  const anlegen = await anlegenVorschlag(admin, frage, body?.kontext ?? null);
  if (anlegen) return { status: 200, daten: { answer: anlegen.answer, kontext: anlegen.kontext } };
  // Offener Standby-Vorschlag (zur Fahrt): ja, nein, Fahrer oder Endzeit nachreichen.
  const sbAntwort = await standbyAntwort(admin, frage, body?.kontext ?? null, dispoId);
  if (sbAntwort) return { status: 200, daten: { answer: sbAntwort.answer, kontext: sbAntwort.kontext } };
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
  // Apps mit Karten-Liste (karten: true) bekommen alle Vorschlaege als aktionen, auch Standby als eigene
  // Karte, und mehrere Auftraege in einer Nachricht werden einzeln vorgeschlagen.
  const karten = body?.karten === true;
  const teile = karten ? auftraegeTeilen(frage) : [frage];
  const offener = body?.offenerVorschlag && typeof body.offenerVorschlag === 'object' ? vorschlagVereinheitlichen(body.offenerVorschlag) : null;
  const letzteFahrtId = /^[0-9a-f-]{36}$/i.test(String(body?.letzteFahrtId || '')) ? String(body.letzteFahrtId).toLowerCase() : null;

  const antworten: string[] = [];
  const aktionen: any[] = [];
  let kontext: any = body?.kontext ?? null;
  let ersteDaten: any = null;
  for (const teilFrage of teile) {
    const r = await buchungsRunde({
      admin, dispoId, ollamaUrl, ollamaModell, verlauf, markiert, karten,
      prompt: teilFrage,
      kontextVorher: body?.kontext ?? null,
      // Bei mehreren Auftraegen beginnt jeder neu, sonst wuerde jeder in den offenen Vorschlag geschrieben.
      offenerVorschlag: teile.length > 1 ? null : offener,
      letzteFahrtId: teile.length > 1 ? null : letzteFahrtId,
    });
    if (r.daten?.meta?.fehler && teile.length === 1) return { status: 200, daten: { ...r.daten, kontext: r.kontext, modell: ollamaModell } };
    ersteDaten = ersteDaten || r.daten;
    if (r.daten?.answer) antworten.push(String(r.daten.answer).trim());
    aktionen.push(...r.aktionen);
    kontext = r.kontext;
  }
  if (teile.length === 1) {
    return { status: 200, daten: { ...ersteDaten, ...(karten ? { aktionen } : {}), kontext, modell: ollamaModell } };
  }
  const answer = [`Ich habe ${teile.length} Aufträge erkannt. Jeden kannst du einzeln bearbeiten und bestätigen.`,
    ...antworten.map((t, i) => `${i + 1}. ${t}`)].join('\n\n');
  return {
    status: 200,
    daten: {
      answer,
      action: aktionen.find((x) => x.type === 'booking_proposal') || null,
      aktionen,
      kontext,
      modell: ollamaModell,
    },
  };
};

// Eine Buchungsfrage durch kiKern, Orte aufloesen, Standby dazu. Liefert Antwort, Aktionen und Kontext.
const buchungsRunde = async (o: {
  admin: any; dispoId: string | null; ollamaUrl: string; ollamaModell: string; verlauf: any[]; markiert: any[];
  karten: boolean; prompt: string; kontextVorher: any; offenerVorschlag: any; letzteFahrtId: string | null;
}) => {
  const { admin, dispoId } = o;
  const ki = kiErstellen({ admin, ollamaUrl: o.ollamaUrl, ollamaModell: o.ollamaModell, kontext: o.kontextVorher });
  // Standby zur Fahrt ("davor dort Standby ab 10 Uhr"): Zeiten raus aus der Buchung, sonst wird 10:00 die
  // Abholzeit. Fehlen der Buchung noch Angaben, wartet der Wunsch im Kontext (standbyWunsch).
  const teil = standbyTeil(o.prompt);
  const wunsch = teil ? { von: teil.von, bis: teil.bis } : o.kontextVorher?.standbyWunsch ?? null;
  try {
    const ergebnis = await ki.fragen({
      prompt: teil ? teil.rest : o.prompt,
      chatHistory: o.verlauf,
      offenerVorschlag: o.offenerVorschlag,
      // iOS schickt UUIDs in Grossbuchstaben, die Datenbank liefert sie klein.
      letzteFahrtId: o.letzteFahrtId,
      // Auf der Karte markierte Fahrer ("wo sind die drei", "was machen die markierten").
      markierteFahrer: o.markiert,
    });
    const daten: any = typeof ergebnis === 'string' ? { answer: ergebnis } : ergebnis;
    const aktionen: any[] = [];
    if (daten?.action?.type === 'booking_proposal') {
      // Start und Ziel: eigener Ort oder echte Adresse statt nur des getippten Texts.
      daten.action.proposal = vorschlagVereinheitlichen(
        await vorschlagOrteAufloesen(admin, vorschlagVereinheitlichen(daten.action.proposal), dispoId),
      );
      // Flugnummer gleich pruefen: nicht bestaetigt heisst Hinweis statt Fehler beim Buchen.
      const p0 = daten.action.proposal;
      if (p0.flugnummer && p0.datum && (!p0.fahrtId || (p0.geaendert || []).includes('flugnummer'))) {
        const flug = await flugPruefen(p0.flugnummer, p0.datum, p0.startAdresse || p0.start);
        if (flug && !flug.gueltig) {
          p0.flugUnbestaetigt = true;
          daten.answer = `${String(daten.answer || '').trim()}\n\n${flugHinweis(p0.flugnummer, p0.datum, flug.grund)}`.trim();
        }
      }
      aktionen.push(daten.action);
    } else if (daten?.action) {
      aktionen.push(daten.action);
    }
    let kontext: any = ki.kontext();
    if (wunsch) {
      const p = daten?.action?.type === 'booking_proposal' ? daten.action.proposal : null;
      if (p && !p.fahrtId && p.datum && p.start) {
        if (o.karten) {
          // Eigene Karte: bearbeiten und einzeln anlegen wie eine Fahrt.
          const k = await standbyKarte(admin, wunsch, p);
          aktionen.push({ type: 'standby_proposal', standby: k });
          daten.answer = `${String(daten.answer || '').trim()}\n\n${standbyKartenText(k)}`.trim();
        } else {
          const s = await standbyZurBuchung(admin, { ...wunsch, rest: '' }, p, kontext);
          daten.answer = `${String(daten.answer || '').trim()}\n\n${s.text}`.trim();
          kontext = s.kontext;
        }
        if (kontext) delete kontext.standbyWunsch;
      } else {
        kontext = { ...(kontext || {}), standbyWunsch: wunsch };
        if (teil) daten.answer = `${String(daten.answer || '').trim()}\n\nDen Standby schlage ich vor, sobald die Fahrt vollständig ist.`.trim();
      }
    }
    return { daten, aktionen, kontext };
  } catch (fehler) {
    const name = fehler instanceof Error ? fehler.name : 'unbekannt';
    console.error('ki_frage', name);
    return { daten: { answer: FEHLGESCHLAGEN, meta: { fehler: true, fehlerName: name } }, aktionen: [], kontext: ki.kontext() };
  }
};

// Mehrere Auftraege in einer Nachricht: je Zeile, oder vor jedem neuen "buche/noch eine Fahrt".
// Nur wenn jeder Teil nach einer Buchung aussieht, sonst bleibt die Nachricht ganz.
const BUCHUNG_RE = /\b(buch\w*|fahrt|abholen|abholung|bring\w*)\b/i;
export const auftraegeTeilen = (frage: string): string[] => {
  const text = String(frage || '').trim();
  const zeilen = text.split(/\n+/).map((z) => z.replace(/^\s*(\d+[.)]|[-•*])\s*/, '').trim()).filter((z) => z.length > 3);
  if (zeilen.length >= 2 && zeilen.every((z) => BUCHUNG_RE.test(z))) return zeilen.slice(0, 6);
  const teile = text
    .split(/(?:;|\.\s+|,?\s+und\s+(?:dann\s+|au(?:ss|ß)erdem\s+|noch\s+)?|,\s*(?:dann|au(?:ss|ß)erdem)\s+)(?=(?:bitte\s+)?(?:buch\w*|noch eine fahrt|eine (?:zweite|weitere) fahrt|eine fahrt|au(?:ss|ß)erdem)\b)/i)
    .map((t) => t.trim()).filter((t) => t.length > 3);
  if (teile.length >= 2 && teile.every((t) => BUCHUNG_RE.test(t))) return teile.slice(0, 6);
  return [text];
};
