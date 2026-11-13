// KI-Assistent (aktion ki_frage). Das Modell laeuft auf einem Rechner im Tailnet
// (integration_settings: ollama_url, ollama_model). Ist er aus, kommt ein Hinweis statt eines Fehlers.

// deno-lint-ignore-file no-explicit-any
import { einstellung } from './import.ts';
import { kiErstellen } from './kiKern.js';
import { alleFahrer, dienstVorschlag, markierteFahrer } from './dienst.ts';
import { lohnVorschlag } from './lohn.ts';
import { anlegenVorschlag, ohnePasswort } from './anlegen.ts';
import { vorschlagOrteAufloesen } from './ortSuche.ts';
import { flugHinweis, flugPruefen } from './flugKi.ts';
import { zuordnenVorschlag } from './zuordnenKi.ts';
import { istFahrtAuftrag, streckeVereinfachen } from './absicht.ts';
import { dienstLoeschenVorschlag, dienstOffenAntwort } from './dienstAendernKi.ts';
import { namenListe } from './namenKi.ts';
import { gastFrage, nochNichtAnlegen, standbyAendern } from './weitereKi.ts';
import { fahrtenSteuern } from './fahrtenKi.ts';
import { steuern } from './steuernKi.ts';
import { type Absicht, absichtLesen, befehlAusFeldern, darf, nachrichtLesen } from './verstehen.ts';
import { loeschenVorschlag } from './loeschenKi.ts';
import { dienstFrage, gespraechsFahrer, stundenFrage } from './fragenKi.ts';
import { standbyAllein, standbyAntwort, standbyKarte, standbyKartenText, standbyTeil, standbyZurBuchung } from './standbyKi.ts';

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

  // Verstehen per Modell (verstehen.ts): erst die Absicht, danach laufen nur die passenden Regeln.
  // Kurze Antworten auf eine offene Rueckfrage ("ja", "Stefano", "löschen") gehen ohne Modell an die Regeln.
  const k0 = body?.kontext || {};
  const offeneRueckfrage = Object.keys(k0).some((x) => /^offene|^offener|^offenes|^standbyWunsch$/.test(x) && k0[x]);
  const kurzeAntwort = frage.length <= 40 && (offeneRueckfrage || /^\s*(ja|jo|ok|okay|nein|ne|nee|passt|genau|klar|bitte|löschen|loeschen)\b/i.test(frage));
  const verlaufKurz = (Array.isArray(body?.verlauf) ? body.verlauf : []).slice(-4)
    .map((m: any) => ({ role: m?.role === 'assistant' ? 'assistant' : 'user', text: String(m?.text || '').slice(0, 500) }));
  let absicht: Absicht | null = null;
  const verstehenModell = await einstellung(admin, 'ollama_model_verstehen', '');
  const verstehenUrl = String(await einstellung(admin, 'ollama_url', '')).split(',')[0].trim();
  const vm = verstehenModell && verstehenUrl ? { url: verstehenUrl, modell: verstehenModell } : null;
  // Erst kurz pruefen, ob der Mac mini da ist, sonst wartet jede Frage auf die Zeitgrenze.
  if (vm && !kurzeAntwort && await erreichbar(vm.url)) absicht = await absichtLesen(vm, frage, verlaufKurz);
  // Standby nur, wenn der Satz auch davon spricht ("Pause von Anna löschen" ist kein Standby).
  if ((absicht === 'standby' || absicht === 'standby_aendern') && !/stand.?by|bereitschaft|bereit\s*(stehen|halten)|warten/i.test(frage)) absicht = null;
  const nachrichtFelder = absicht === 'nachricht' ? await nachrichtLesen(vm, frage) : null;
  // Felder per Modell (Tag, Fahrer, Zeiten, welche Fahrt) als fester Befehl fuer die Regeln. Null: Originalsatz.
  const befehl = await befehlAusFeldern(vm, absicht, frage, verlaufKurz);

  // Feste Regeln, gefiltert nach der Absicht. Findet keine etwas, laufen sie noch einmal ungefiltert,
  // damit eine falsch gelesene Absicht keine passende Regel verdeckt (ausser bei Fahrten, die gehen zum Modell).
  const regeln = async (absicht: Absicht | null, frage: string): Promise<any> => {
    // Stundenlohn setzen oder nachschauen: Rueckfrage, "ja" speichert. Auch ohne Modell.
    const lohn = darf('lohn', absicht) ? await lohnVorschlag(admin, frage, markiert, body?.kontext ?? null) : null;
    if (lohn) return { status: 200, daten: { answer: lohn.answer, kontext: lohn.kontext } };
    // Nur Namen ohne Auftrag: nachfragen, ob sie als neue Fahrer angelegt werden sollen.
    const namen = !darf('namen', absicht) ? null : await namenListe(admin, frage, body?.kontext ?? null, body?.karten === true);
    if (namen) return { status: 200, daten: { answer: namen.answer, kontext: namen.kontext, ...((namen as any).aktionen ? { aktionen: (namen as any).aktionen } : {}) } };
    // Steuern: Nachricht, Fahrer/Fahrzeug/Tracker/Gast/Ort aendern und anlegen, Stunden, Planung, rueckgaengig, Hilfe.
    const st = darf('steuern', absicht) ? await steuern(admin, frage, body?.kontext ?? null, dispoId, nachrichtFelder, absicht) : null;
    if (st) return { status: 200, daten: { answer: st.answer, kontext: st.kontext } };
    // Fahrten: stornieren, loeschen, erledigt, kopieren, Notiz, verspaetet, Flugstatus.
    const lf = /^[0-9a-f-]{36}$/i.test(String(body?.letzteFahrtId || '')) ? String(body.letzteFahrtId).toLowerCase() : null;
    const fs = darf('fahrten', absicht) ? await fahrtenSteuern(admin, frage, body?.kontext ?? null, lf) : null;
    if (fs) return { status: 200, daten: { answer: fs.answer, kontext: fs.kontext } };
    // Kunden, Gaeste, Orte anlegen gibt es im Chat noch nicht: ehrlich sagen statt z. B. "BMW Group" als Fahrzeug.
    const nochNicht = nochNichtAnlegen(frage);
    if (nochNicht) return { status: 200, daten: { answer: nochNicht, kontext: body?.kontext ?? null } };
    // Fahrer oder Fahrzeug anlegen: Rueckfrage mit allen Angaben, "ja" legt an. Auch ohne Modell.
    const anlegen = darf('anlegen', absicht) ? await anlegenVorschlag(admin, frage, body?.kontext ?? null, body?.karten === true) : null;
    if (anlegen) return { status: 200, daten: { answer: anlegen.answer, kontext: anlegen.kontext, ...(anlegen.aktionen ? { aktionen: anlegen.aktionen } : {}) } };
    // Offene Rueckfrage zu Diensten: mehrere Dienste senden oder Dienst/Dienstende/Pause loeschen.
    const dienstOffen = await dienstOffenAntwort(admin, frage, body?.kontext ?? null);
    if (dienstOffen) return { status: 200, daten: { answer: dienstOffen.answer, kontext: dienstOffen.kontext } };
    // Standby anzeigen, loeschen oder verschieben (sonst wuerde "Lösch den Standby" einen neuen anlegen).
    const sbAendern = darf('standbyAendern', absicht) ? await standbyAendern(admin, frage, body?.kontext ?? null) : null;
    if (sbAendern) return { status: 200, daten: { answer: sbAendern.answer, kontext: sbAendern.kontext } };
    // Dienst, Dienstende, Dienststart oder Pause loeschen. Vor dem Fahrer-Loeschen, damit "Lösch Stefanos
    // Dienstende" nie als Fahrer loeschen gelesen wird.
    const dienstWeg = !darf('dienstLoeschen', absicht) ? null : await dienstLoeschenVorschlag(admin, frage, body?.kontext ?? null,
      markiert.length ? markiert : await gespraechsFahrer(admin, body?.kontext ?? null, frage));
    if (dienstWeg) return { status: 200, daten: { answer: dienstWeg.answer, kontext: dienstWeg.kontext } };
    // Fahrer oder Fahrzeug loeschen: Rueckfrage mit allen Folgen, erst "löschen" loescht.
    const loeschen = darf('loeschen', absicht) ? await loeschenVorschlag(admin, frage, body?.kontext ?? null, dispoId) : null;
    if (loeschen) return { status: 200, daten: { answer: loeschen.answer, kontext: loeschen.kontext } };
    // Klarer Fahrtauftrag ("Neue Fahrt ... Start in Offenburg, Ende in München"): direkt zur Buchung, die
    // Regeln fuer Dienst, Standby ohne Fahrt, Zuordnen und Fragen bleiben aussen vor.
    const fahrt = absicht ? /^fahrt_/.test(absicht) : istFahrtAuftrag(frage);
    // Fahrzeug einem Fahrer oder Tracker einem Fahrzeug zuordnen: Rueckfrage, "ja" speichert.
    const zuordnung = (fahrt && !body?.kontext?.offeneZuordnung) || !darf('zuordnen', absicht) ? null : await zuordnenVorschlag(admin, frage, body?.kontext ?? null);
    if (zuordnung) return { status: 200, daten: { answer: zuordnung.answer, kontext: zuordnung.kontext } };
    // Offener Standby-Vorschlag (zur Fahrt): ja, nein, Fahrer oder Endzeit nachreichen.
    const sbAntwort = await standbyAntwort(admin, frage, body?.kontext ?? null, dispoId);
    if (sbAntwort) return { status: 200, daten: { answer: sbAntwort.answer, kontext: sbAntwort.kontext } };
    // Fragen zu Dienst, Pausen und Stundenzetteln: aus den Tabellen, ohne Modell.
    if (!fahrt) {
      // Gaeste: Telefon, E-Mail, Adresse, Firma, Hinweise (vorher als Fahrer gelesen).
      const gast = darf('gastFrage', absicht) ? await gastFrage(admin, frage) : null;
      if (gast) return { status: 200, daten: { answer: gast, kontext: body?.kontext ?? null } };
      const dienstAntwortText = darf('dienstFrage', absicht) ? await dienstFrage(admin, frage, body?.kontext ?? null) : null;
      if (dienstAntwortText) return { status: 200, daten: { answer: dienstAntwortText, kontext: body?.kontext ?? null } };
      const stundenAntwort = await stundenFrage(admin, frage, body?.kontext ?? null);
      if (stundenAntwort) return { status: 200, daten: { answer: stundenAntwort, kontext: body?.kontext ?? null } };
    }
    // Standby ohne Fahrt, vor dem Dienst: "10-18 fuer Tim" waere sonst ein Dienst. Standby ohne Fahrt ("Standby morgen 10-18 am Kongress fuer Tim"): Karte oder Rueckfrage mit "ja".
    const sbAllein = fahrt || !darf('standbyAllein', absicht) ? null : await standbyAllein(admin, frage, markiert, body?.kontext ?? null, body?.karten === true);
    if (sbAllein) return { status: 200, daten: { answer: sbAllein.answer, kontext: sbAllein.kontext, ...(sbAllein.aktionen ? { aktionen: sbAllein.aktionen } : {}) } };
    // Dienst senden: markierte Fahrer, sonst der Fahrer, um den es gerade ging ("Dann schick Dienststart fuer 9").
    const fuerDienst = fahrt ? [] : markiert.length ? markiert : await gespraechsFahrer(admin, body?.kontext ?? null, frage);
    const dienst = fahrt || !darf('dienst', absicht) ? null : await dienstVorschlag(admin, frage, fuerDienst, body?.kontext ?? null);
    if (dienst) return { status: 200, daten: { ...dienst, kontext: (dienst as any).kontext ?? body?.kontext ?? null } };
    return null;
  };
  const originalFrage = frage;
  const treffer = await regeln(absicht, befehl || frage)
    || (absicht && !['fahrt_neu', 'fahrt_aendern', 'sonstiges'].includes(absicht) ? await regeln(null, originalFrage) : null);
  if (treffer && befehl) treffer.daten = { ...treffer.daten, meta: { ...(treffer.daten?.meta || {}), absicht, befehl } };
  if (treffer) return treffer;

  // Haupt-Rechner (ollama_url, Mac mini) und Ersatz (ollama_url_ersatz, MacBook). Beide werden
  // gleichzeitig geprueft, genommen wird der erste erreichbare in dieser Reihenfolge.
  const haupt = String(await einstellung(admin, 'ollama_url', '')).split(',').map((u) => u.trim()).filter(Boolean);
  const ersatz = String(await einstellung(admin, 'ollama_url_ersatz', '')).split(',').map((u) => u.trim()).filter(Boolean);
  const kandidaten = [...haupt, ...ersatz];
  const erreichbarkeit = await Promise.all(kandidaten.map(erreichbar));
  const ollamaUrl = kandidaten.find((_, i) => erreichbarkeit[i]) || '';
  if (!ollamaUrl) {
    return { status: 200, daten: { answer: NICHT_ERREICHBAR, meta: { nichtErreichbar: true } } };
  }

  const verlauf = (Array.isArray(body?.verlauf) ? body.verlauf : [])
    .slice(-8)
    .map((m: any) => ({ role: m?.role === 'assistant' ? 'assistant' : 'user', text: String(m?.text || '').slice(0, 2000) }));
  // Der Ersatz-Rechner (MacBook) hat ein eigenes Modell (ollama_model_ersatz), dort liegt kein qwen.
  const ollamaModell = ersatz.includes(ollamaUrl) && !haupt.includes(ollamaUrl)
    ? await einstellung(admin, 'ollama_model_ersatz', 'llama3.1:8b')
    : await einstellung(admin, 'ollama_model', 'llama3.1:8b');
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
      // "Start in X, Ende in Y" als "von X nach Y", damit Start und Ziel sicher erkannt werden.
      prompt: streckeVereinfachen(teil ? teil.rest : o.prompt),
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
      // "Fahrt mit allen Fahrern": alle Fahrer eintragen (das Modell laesst sie sonst leer, ki_protokoll 12.11.).
      if (!p0.fahrtId && /\b(mit\s+)?(alle[nm]?|saemtliche[n]?|sämtliche[n]?)\s+(unseren?\s+)?fahrer(n|innen)?\b/i.test(o.prompt)) {
        const alle = (await alleFahrer(admin)).map((f) => f.name).filter(Boolean);
        if (alle.length) {
          p0.fahrerNamen = alle;
          daten.answer = String(daten.answer || '').replace(/noch ohne Fahrer/, `alle ${alle.length} Fahrer`);
        }
      }
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
