// KI-Assistent (aktion ki_frage). Das Modell laeuft auf einem Rechner im Tailnet
// (integration_settings: ollama_url, ollama_model). Ist er aus, kommt ein Hinweis statt eines Fehlers.

// deno-lint-ignore-file no-explicit-any
import { einstellung } from './import.ts';
import { kiErstellen } from './kiKern.js';
import { alleFahrer, dienstVorschlag, genannteFahrer, jetztBerlin, markierteFahrer, normal } from './dienst.ts';
import { ausnahmen, ausnahmenSetzen, ausnahmenText, ohneAusnahmen } from './ausnahmen.ts';
import { lohnVorschlag } from './lohn.ts';
import { anlegenVorschlag, ohnePasswort } from './anlegen.ts';
import { vorschlagOrteAufloesen } from './ortSuche.ts';
import { ortWahlAntwort, ortWahlStarten } from './ortWahl.ts';
import { alternativenMerken, ortKorrektur } from './ortKorrektur.ts';
import { flugHinweis, flugPruefen } from './flugKi.ts';
import { fahrzeugwahlAntwort, zuordnenVorschlag } from './zuordnenKi.ts';
import { buchungGlaetten, istFahrtAuftrag, streckeVereinfachen } from './absicht.ts';
import { namenAngleichen } from './namenAngleichen.ts';
import { glaetten, nurDeutsch, unmoeglich } from './glaetten.ts';
import { dienstLoeschenVorschlag, dienstOffenAntwort } from './dienstAendernKi.ts';
import { namenListe } from './namenKi.ts';
import { gastFrage, nochNichtAnlegen, standbyAendern } from './weitereKi.ts';
import { fahrtenSteuern } from './fahrtenKi.ts';
import { steuern } from './steuernKi.ts';
import { type Absicht, absichtLesen, absichtMitAusnahmen, AUSNAHME_RE, befehlAusFeldern, darf, GRUPPE_RE, modellGesperrt, modellSperren, nachrichtLesen } from './verstehen.ts';
// Umbau 18.11. (reports/KI Assistent Umbau Plan.md): neuer Ablauf nur mit integration_settings ki_ablauf = 'neu'.
import { neuNachpruefen, neuVorbereiten, type NeuVorbereitet, ohneModellNurFragen } from './kiNeuAblauf.ts';
import type { Erwartung as NeuErwartung } from './kiNeuPruefen.ts';
type NeuHalter = { aktiv?: boolean; erwartung?: NeuErwartung | null; modellFehlt?: boolean; markiert?: any[]; formular?: any; ms?: number };
import { loeschenVorschlag } from './loeschenKi.ts';
import { freieAntwort } from './freiKi.ts';
import { dienstFrage, gespraechsFahrer, stundenFrage } from './fragenKi.ts';
import { standbyAllein, standbyAntwort, standbyKarte, standbyKartenText, standbyTeil, standbyZurBuchung } from './standbyKi.ts';

const NICHT_ERREICHBAR = 'Der Assistent ist gerade nicht erreichbar, weil der Rechner mit dem Modell aus ist oder keine Verbindung hat.';
// Ausnahme-Sperre (15.11.): "alle außer Tim" ohne gelesene Felder nie den Regeln ueberlassen, die drehen es um
// (Messung 15.11.: "allen bis auf Stefano" ergab nur Stefano, "ausgenommen Marvin" nur Marvin).
const AUSNAHME_UNSICHER = 'Bei „alle außer …“ rate ich nicht, weil das Modell gerade nicht geantwortet hat. Sag es bitte gleich noch einmal oder nenne die Fahrer einzeln. Ich habe nichts geändert.';
const ZU_LANGSAM = 'Das Sprachmodell hat gerade zu lange gebraucht. Ich habe nichts geändert. Sag es bitte gleich noch einmal.';
const NICHT_VERSTANDEN = 'Das kann ich so nicht ausführen, deshalb habe ich nichts geändert. Formuliere es bitte anders. Mit „Was kannst du alles?“ zeige ich dir, was geht.';
const FEHLGESCHLAGEN = 'Der Assistent konnte gerade nicht antworten. Bitte versuch es gleich noch einmal.';

// Bestaetigungs-Sperre (15.11., Haertetest): Jede Regel wertete nur das erste Wort als "ja" (ja, ok, bitte, mach,
// schick, lösch, passt ...). Ein neuer Satz bestaetigte so die offene Rueckfrage: "Bitte gib Tim morgen 7 Uhr
// Dienststart" loeschte Annas Dienst, "Passt das mit Tim morgen um 8?" speicherte einen Stundenlohn fuer alle.
// Jetzt gilt als Bestaetigung nur ein Satz, der ausser Zustimmung, Fuellwoertern und dem Tu-Wort nichts enthaelt
// ("ja", "ja, löschen", "ok mach das", "senden"). Alles andere verwirft die offene Rueckfrage und wird neu gelesen.
const BESTAETIGBAR = ['offeneSteuerung', 'offeneDienste', 'offenerStandby', 'offeneDienstLoeschung', 'offenesAnlegen',
  'offeneZuordnung', 'offeneStandbyAenderung', 'offenesLoeschen', 'offenerLohn', 'offeneFahrtAktion', 'offeneNamen'];
const JA_ANFANG = /^(ja|jo|jap|japp|jawohl|jup|yes|ok|okay|okey|klar|genau|passt|stimmt|richtig|gerne|gern|bitte|sicher|los|mach\w*|send\w*|schick\w*|l(ö|oe)sch\w*|storn\w*|speicher\w*|anleg\w*|leg|lege|best(ä|ae)tig\w*|(ü|ue)bernehm\w*|buch\w*)$/;
const NUR_JA = /^(ja|jo|jap|japp|jawohl|jup|yes|ok|okay|okey|klar|genau)$/;
const TU_WORT = new Set(['löschen', 'lösche', 'lösch', 'loeschen', 'loesche', 'loesch', 'senden', 'sende', 'schick', 'schicke', 'schicks', 'ab',
  'speichern', 'speicher', 'speichere', 'ändern', 'ändere', 'aendern', 'aendere', 'bestätigen', 'bestätige', 'bestaetigen', 'bestaetige',
  'stornieren', 'storniere', 'anlegen', 'leg', 'lege', 'an', 'ihn', 'sie', 'die', 'den', 'übernehmen', 'uebernehmen', 'buchen', 'buche',
  'in', 'ordnung', 'sicher', 'los', 'raus', 'weg', 'alle', 'beide', 'abbrechen', 'abbruch', 'stopp', 'stop', 'vergiss', 'verwerfen', 'lass', 'behalten',
  'stimmt', 'richtig', 'passt', 'einverstanden', 'unbedingt', 'natürlich', 'natuerlich', 'ja', 'nein']);
const woerter = (frage: string) => frage.toLowerCase().replace(/[^a-zäöüß ]+/g, ' ').split(/\s+/).filter(Boolean);
const reineBestaetigung = (frage: string) => {
  const w = woerter(frage);
  return w.length > 0 && w.length <= 8 && !/\d/.test(frage)
    && w.every((x) => JA_WORT.test(x) || NEIN_WORT.test(x) || FUELL.has(x) || TU_WORT.has(x));
};
// Liefert den neu zu lesenden Satz, wenn die Nachricht wie ein "ja" beginnt, aber mehr enthaelt. Sonst null.
const neuerSatzStattJa = (frage: string): string | null => {
  const w = woerter(frage);
  if (w.length < 3 || !(JA_ANFANG.test(w[0]) || NEIN_WORT.test(w[0])) || reineBestaetigung(frage)) return null;
  // "Ok dann schick Tim heim", "Nein, schick lieber Marvin heim": das Ja oder Nein vorweg faellt weg.
  return NUR_JA.test(w[0]) || NEIN_WORT.test(w[0]) ? frage.replace(/^\s*\S+[\s,;:.!-]*(dann\s+|und\s+|aber\s+)?/i, '').trim() || frage : frage;
};

// Gruss und Funktionsprobe ohne Modell (15.11.): "Hallo" brauchte 3 bis 8 s, im Protokoll bis zu 55 s,
// und bei haengendem Modell kam nach 72 s ein Fehler. Gerade der erste Satz im Voice-Modus ist oft so einer.
const smalltalk = (frage: string): string | null => {
  const t = frage.toLowerCase().replace(/[^a-zäöüß' ]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!t || t.split(' ').length > 7) return null;
  if (/^(hallo |hi |hey |na |und )?wie geht('?s| es)( dir| euch)?( gerade| heute| so)?$/.test(t)) return 'Gut, danke. Was kann ich für dich tun?';
  if (/^(hallo |hi |hey )?((kannst|hörst|hoerst) du mich( hören| hoeren)?|bist du (da|noch da|dran)|hört mich jemand|test( test)?|funktionierst du)$/.test(t)) return 'Ja, ich höre dich. Was kann ich für dich tun?';
  if (/^(hallo|hi|hey|servus|moin( moin)?|grüß gott|gruess gott|grüß dich|guten (morgen|tag|abend)|hallo zusammen)( trisar| assistent)?$/.test(t)) return 'Hallo! Was kann ich für dich tun?';
  if (/^(ok |okay |super |top |alles klar |perfekt )?(danke|dankeschön|danke schön|danke dir|vielen dank|besten dank|merci)( dir| schön| sehr)?$/.test(t)) return 'Gerne.';
  return null;
};

// Nur Zustimmung oder Ablehnung ohne weiteren Inhalt ("Ja genau so machen wir's", "nee doch nicht").
// "Ok dann schick Tim heim" ist das nicht: nach den Fuellwoertern bleibt ein Auftrag uebrig.
const JA_WORT = /^(ja|jo|jap|japp|jawohl|jup|yes|ok|okay|okey|klar|genau|passt|stimmt|richtig)$/;
const NEIN_WORT = /^(nein|ne|nee|noe|nö|nope)$/;
const FUELL = new Set(['so', 'machen', 'mach', 'wir', 'wirs', 's', 'es', 'das', 'bitte', 'gerne', 'gern', 'doch', 'nicht', 'dann', 'ist',
  'gut', 'danke', 'super', 'alles', 'schon', 'mal', 'halt', 'eben', 'auch', 'lieber', 'perfekt', 'prima', 'top', 'jetzt', 'aber', 'und']);
const nurBestaetigung = (frage: string): 'ja' | 'nein' | null => {
  const w = frage.toLowerCase().replace(/[^a-zäöüß ]+/g, ' ').split(/\s+/).filter(Boolean);
  if (!w.length || w.length > 8 || /\d/.test(frage)) return null;
  const art = NEIN_WORT.test(w[0]) ? 'nein' : JA_WORT.test(w[0]) ? 'ja' : null;
  if (!art) return null;
  return w.every((x) => JA_WORT.test(x) || NEIN_WORT.test(x) || FUELL.has(x)) ? art : null;
};

// Ergebnis kurz merken (15.11.): Ist der Rechner aus, kostete die Pruefung bei jeder Frage 4 s.
// Erreichbar gilt 20 s, nicht erreichbar 60 s.
const ERREICHBAR = new Map<string, { ok: boolean; bis: number }>();
const erreichbar = async (url: string) => {
  const gemerkt = ERREICHBAR.get(url);
  if (gemerkt && Date.now() < gemerkt.bis) return gemerkt.ok;
  let ok = false;
  try {
    const r = await fetch(`${url.replace(/\/$/, '')}/api/version`, { signal: AbortSignal.timeout(3000) });
    ok = r.ok;
  } catch {
    ok = false;
  }
  ERREICHBAR.set(url, { ok, bis: Date.now() + (ok ? 20000 : 60000) });
  return ok;
};
// Feste Antworten ohne Modell (16.11., aus dem ki_protokoll):
// - Dienstreise: Der Assistent kennt sie noch nicht. "Kannst du eine Dienstreise einrichten?" wurde als Dienst-Frage
//   zum zuletzt genannten Fahrer gelesen, "Dienstreise für Tim morgen um 8" ergab einen Dienststart-Vorschlag.
// - "Von wem wurdest du gebaut": das Modell nannte nach 25 s seinen Hersteller, einmal einen falschen.
// - Fragen nach Dateien, Schlüsseln, Passwörtern: klare Auskunft, dass er darauf keinen Zugriff hat.
const DIENSTREISE_ANTWORT = 'Dienstreisen kann ich noch nicht anlegen, ändern oder auswerten. Das geht in der Dispo bei „Fahrt hinzufügen“, dort oben auf „Dienstreise“ umschalten. Ich habe nichts geändert.';
const WER_BIN_ICH = 'Ich bin der TRISAR-Assistent für die Dispo. Ich laufe auf eurem eigenen Rechner und sehe nur die Dispo-Daten, keine Dateien und keine Schlüssel.';
// Rechte, Rollen, Ortung, Abmelden (16.11.): dafuer gibt es keine Regel. Vorher machte die Fahrt-Aenderung daraus
// Unsinn: "Gib Marvin Admin-Rechte" schlug Marvin als Fahrer einer Fahrt vor, "Schalte die Ortung für Tim ab"
// trug Tim als Gast ein.
const RECHTE_ANTWORT = 'Rechte, Rollen, Ortung und Anmeldung kann ich nicht ändern. Das geht nur in der Dispo beim jeweiligen Fahrer. Ich habe nichts geändert.';
// "Tausch die Fahrer der Fahrten von Engel und Tim" trug Tim als zweiten Fahrer ein, statt zu tauschen.
const TAUSCH_ANTWORT = 'Fahrer zwischen Fahrten tauschen kann ich nicht in einem Schritt. Sag mir je Fahrt, wer sie übernimmt, zum Beispiel „Gib die Fahrt von Herrn Engel Tim“. Ich habe nichts geändert.';
const ZUGRIFF_ANTWORT = 'Ich sehe nur die Dispo-Daten, also Fahrer, Fahrzeuge, Fahrten, Dienste, Gäste und Orte. Auf Dateien, Schlüssel und Passwörter habe ich keinen Zugriff.';
const festeAntwort = (frage: string): { answer: string; regel: string } | null => {
  const t = normal(frage).trim();
  // "Schreib Tim, dass seine Dienstreise um 8 startet" bleibt eine Nachricht, eine Notiz bleibt eine Notiz.
  const nachricht = /^(bitte\s+)?(schreib\w*|sag\w*|richte\w*|erinner\w*|informier\w*|benachrichtig\w*|teil\w*)\b/.test(t) || /\bnotiz\b/.test(t);
  if (/\b(dienstreise\w*|geschaeftsreise\w*)\b/.test(t) && !nachricht) return { answer: DIENSTREISE_ANTWORT, regel: 'dienstreise' };
  if (/\b(wer|was) bist du\b|\bvon wem (wurdest|bist) du\b|\bwer hat dich\b|\bwelches (sprach)?modell (bist|nutzt|verwendest) du\b|\bbist du (chatgpt|gpt|claude|gemini|qwen|llama|eine ki|ein bot|ein mensch|ein roboter)\b|\bwie heisst du\b/.test(t)) {
    return { answer: WER_BIN_ICH, regel: 'werBinIch' };
  }
  if (!nachricht && !/^(wer|welche\w*|wie|wo|wann|hat|haben|ist|sind|darf|duerfen)\b/.test(t) && !/\?\s*$/.test(frage)) {
    if (/\b(admin\w*|(dispo|zugriffs|schreib|lese|benutzer|nutzer|sonder)\w*[- ]?rechten?|rechte\s+(geben|entziehen|vergeben|wegnehmen)|berechtigung\w*|zum disponent\w*|zur disponent\w*|als disponent\w*|zum dispo|als dispo)\b/.test(t)
      || (/\b(ortung|standortfreigabe|gps)\b/.test(t) && /\b(schalt\w*|stell\w*|mach\w*|deaktivier\w*|aktivier\w*|sperr\w*|aus|ab|an|ein)\b/.test(t))
      || /\b(meld\w*|logg\w*)\b.*\b(ab|aus)\b/.test(t) && /\b(app|fahrer|alle)\b/.test(t) && !/\b(dienst|krank|urlaub)\b/.test(t)) {
      return { answer: RECHTE_ANTWORT, regel: 'rechte' };
    }
    if (/\b(tausch\w*|vertausch\w*)\b/.test(t) && /\bfahrer\b/.test(t) && /\b(fahrten|untereinander|miteinander)\b/.test(t)) return { answer: TAUSCH_ANTWORT, regel: 'tauschen' };
  }
  const sucht = /^(siehst|hast|kannst|kennst|auf welche|welche|wo|zeig|gib|nenn|ich suche|ich brauche|was ist|wie lautet|und|den|die|das)\b/.test(t) || /\?\s*$/.test(frage);
  const geheim = /\b(env|datei|dateien|api.?key|api.?schluessel|token|passwort|passwoerter|zugangsdaten|quellcode|datenbank\w*|datenbaenke)\b/.test(t)
    || (/\bschluessel\w*\b/.test(t) && /\b(api|tomtom|tom tom|google|supabase|geheim\w*|lizenz|zugriff|server)\b/.test(t))
    || (/\bzugriff\b/.test(t) && /\bdu\b/.test(t));
  if (sucht && geheim && !/\b(leg\w*|anleg\w*|setz\w*|aender\w*|erstell\w*|neue[nrs]?)\b/.test(t)) return { answer: ZUGRIFF_ANTWORT, regel: 'zugriff' };
  return null;
};
// Frage mit "er", "sie", "der" ohne jeden Bezug (16.11.): Das freie Modell nannte dann einfach einen Fahrer
// ("Was macht der gerade" ergab Stefano, "Hat sie schon Feierabend" ergab Anna). Dann nachfragen.
const WEN_MEINST_DU = 'Wen meinst du? Nenne bitte den Namen oder markiere den Fahrer auf der Karte.';
const PRONOMEN_RE = /\b(er|ihn|ihm|sie|ihr|ihnen)\b|\b(der|die|den|dem)\s*$|\b(macht|ist|steckt|bleibt|kommt|faehrt|hat|braucht|arbeitet|steht|wartet)\s+(der|die)\s+(gerade|jetzt|aktuell|momentan|heute|noch|schon|denn|eigentlich|so|da|hin)\b(?!\s+\w+(e|en|er|es)\s+[a-z])/;
const HAENGT = 'Das Sprachmodell antwortet gerade nicht. Dienste, Fahrten, Nachrichten und Standort-Fragen gehen weiter, formuliere sie bitte direkt, zum Beispiel „Dienststart für Tim morgen um 7“. Freie Fragen gehen in ein paar Minuten wieder.';

// Alle Apps bekommen dieselben Felder, immer als Text.
const vorschlagVereinheitlichen = (v: any) => ({
  datum: String(v?.datum || '').trim(),
  startZeit: String(v?.startZeit || '').trim(),
  // Start Zeitraum ("zwischen 15 und 16 Uhr", 16.11.): Ende des Zeitraums, die Apps speichern es als etd_bis.
  startZeitBis: /^\d{2}:\d{2}$/.test(String(v?.startZeitBis || '').trim()) ? String(v.startZeitBis).trim() : '',
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

// Mehrere Dienst-Auftraege fuer verschiedene Fahrer in einem Satz ("Tim morgen 8 bis 16 und Anna morgen 9 bis 17",
// "Schick Tim in den Feierabend und sag Marvin, er soll um 14 Uhr anfangen"). Die Dienst-Regel kennt nur einen
// Auftrag je Nachricht: vorher bekam Anna Tims Zeiten, oder der zweite Teil fiel still weg (15.11.).
// Liefert die Teile, wenn jeder einen eigenen Fahrer und eine eigene Angabe hat, sonst null.
const DIENST_TEIL = /\d|feierabend|schluss|dienst\w*|pause|anfangen|\bfrei\b|\bheim\b|nach\s+hause/i;
const dienstTeile = async (admin: any, frage: string): Promise<string[] | null> => {
  if (BUCHUNG_RE.test(frage) || GRUPPE_RE.test(frage) || /stand.?by|\b(von|vom)\b.*\b(nach|zum|zur)\b/i.test(frage)) return null;
  const teile = frage.split(/\s+und\s+|;\s*|\.\s+(?=\S)/i).map((t) => t.trim()).filter((t) => t.length > 3);
  if (teile.length < 2 || teile.length > 4) return null;
  const gesehen = new Set<string>();
  for (const t of teile) {
    if (!DIENST_TEIL.test(t)) return null;
    const fahrer = await genannteFahrer(admin, normal(t));
    if (!fahrer.length || fahrer.some((f) => gesehen.has(f.id))) return null;
    fahrer.forEach((f) => gesehen.add(f.id));
  }
  return teile;
};

export const kiFrage = async (admin: any, body: any, dispoId: string | null = null) => {
  const beginn = Date.now();
  const frage = String(body?.frage || '').trim().slice(0, 2000);
  // Tippfehler und Verhoerer glaetten („Dienst statt“, „morgn“), dann falsch gehoerte Namen („Stefano Baldri“)
  // auf die echten Namen angleichen.
  const glatt = glaetten(frage);
  // Unmoegliche Uhrzeit, Datum oder Pause: nachfragen statt umdeuten.
  const geht_nicht = frage ? unmoeglich(glatt.text, Number(jetztBerlin().datum.slice(0, 4))) : null;
  if (geht_nicht) {
    await protokollieren(admin, { dispo_id: dispoId, frage: ohnePasswort(frage), art: 'antwort', antwort: geht_nicht, aktion: null, dauer_ms: Date.now() - beginn, modell: null, fehler: null });
    return { status: 200, daten: { answer: geht_nicht, kontext: body?.kontext ?? null, meta: { regel: 'unmoeglich' } } };
  }
  const namen = frage ? await namenAngleichen(admin, glatt.text) : { text: frage, ersetzt: [] as string[] };
  let k0 = body?.kontext && typeof body.kontext === 'object' ? body.kontext : {};
  // Bestaetigungs-Sperre: neuer Satz statt "ja" verwirft die offene, bestaetigbare Rueckfrage.
  let text = namen.text;
  let verworfen = false;
  if (BESTAETIGBAR.some((k) => k0[k])) {
    const neu = neuerSatzStattJa(text);
    if (neu) {
      k0 = { ...k0 };
      BESTAETIGBAR.forEach((k) => delete k0[k]);
      body = { ...body, kontext: k0 };
      text = neu;
      verworfen = true;
    }
  }
  // Offene Frage "Welches Fahrzeug meinst du" (zuordnenKi.ts): Ist die Nachricht keine Antwort darauf, faellt
  // sie weg. Sonst gingen die naechsten kurzen Saetze als Antwort ohne Verstehen an die Regeln.
  if (k0.offeneFahrzeugwahl && !fahrzeugwahlAntwort(k0, text)) {
    k0 = { ...k0 };
    delete k0.offeneFahrzeugwahl;
    body = { ...body, kontext: k0 };
  }
  // Offene Ortsauswahl (ortWahl.ts): Antwort darauf fuehrt die wartende Buchung weiter, sonst faellt sie weg.
  if (k0.offeneOrtwahl) {
    const w0 = await ortWahlAntwort(admin, k0, text, dispoId, body?.standort);
    const w = w0 ? alternativenMerken(w0) : w0;
    if (w) {
      await protokollieren(admin, { dispo_id: dispoId, frage: ohnePasswort(frage), art: antwortArt(w, w.kontext), antwort: String(w.answer || '').slice(0, 4000), aktion: w.action ?? null, dauer_ms: Date.now() - beginn, modell: null, fehler: null });
      return { status: 200, daten: w };
    }
    k0 = { ...k0 };
    delete k0.offeneOrtwahl;
    body = { ...body, kontext: k0 };
  }
  // Ort im Chat korrigieren (ortKorrektur.ts, 19.11.): "nein, ich meinte die Frühlingstraße in Augsburg".
  const korrektur = frage ? await ortKorrektur(admin, body, text, dispoId) : null;
  if (korrektur) {
    await protokollieren(admin, { dispo_id: dispoId, frage: ohnePasswort(frage), art: antwortArt(korrektur, korrektur.kontext), antwort: String(korrektur.answer || '').slice(0, 4000), aktion: (korrektur as any).action ?? null, dauer_ms: Date.now() - beginn, modell: null, fehler: null });
    return { status: 200, daten: korrektur };
  }
  const rueckfrageOffen = Object.keys(k0).some((x) => /^offene|^offener|^offenes/.test(x) && k0[x]);
  const teile = frage && !rueckfrageOffen ? await dienstTeile(admin, text) : null;
  // Neuer Ablauf (ki_ablauf = 'neu'): kiFrageIntern fuellt den Halter, die Pruefung am fertigen Ergebnis laeuft
  // hier an einer Stelle fuer alle Wege (Regeln, Buchung, freies Modell).
  const neuHalter: NeuHalter = {};
  const ergebnisRoh = await kiFrageIntern(admin, body, teile ? teile[0] : text, dispoId, neuHalter);
  const ergebnisGeprueft = !neuHalter.aktiv ? ergebnisRoh
    : neuHalter.modellFehlt ? ohneModellNurFragen(ergebnisRoh, body?.kontext ?? null)
    : neuHalter.erwartung ? await neuNachpruefen(admin, ergebnisRoh, neuHalter.erwartung, teile ? teile[0] : text, {
      verlauf: [], kontext: body?.kontext ?? null, markiert: neuHalter.markiert || [], letzteFahrtId: null, offenerVorschlag: null,
      gespraech: () => gespraechsFahrer(admin, body?.kontext ?? null, teile ? teile[0] : text),
    }, body?.kontext ?? null)
    : ergebnisRoh;
  // Unsicherer Ort in einer einzelnen Buchung: erst die Auswahl (ortWahl.ts), die Buchung wartet im Kontext.
  const ergebnis0 = teile ? ergebnisGeprueft : ortWahlStarten(ergebnisGeprueft);
  // Uebrige Treffer der Ortssuche fuer eine Korrektur im Chat merken (ortKorrektur.ts).
  const ergebnis = ergebnis0?.daten ? { ...ergebnis0, daten: alternativenMerken(ergebnis0.daten) } : ergebnis0;
  if (neuHalter.aktiv && ergebnis?.daten) {
    (ergebnis.daten as any).meta = { ...((ergebnis.daten as any).meta || {}), neu: { ...(((ergebnis.daten as any).meta || {}).neu || {}), formular: neuHalter.formular ?? null, ms: neuHalter.ms ?? null } };
  }
  if (verworfen && ergebnis?.daten) {
    (ergebnis.daten as any).answer = `${String((ergebnis.daten as any).answer || '').trim()}\n\nDie vorige Rückfrage habe ich verworfen, dafür wurde nichts geändert.`;
    (ergebnis.daten as any).meta = { ...((ergebnis.daten as any).meta || {}), rueckfrageVerworfen: true };
  }
  if (teile && ergebnis?.daten) {
    const rest = teile.slice(1).map((t) => `„${t}“`).join(' und ');
    (ergebnis.daten as any).answer = `${String((ergebnis.daten as any).answer || '').trim()}\n\nDas waren ${teile.length} Aufträge, ich mache einen nach dem anderen. Noch nicht bearbeitet: ${rest}. Schick mir das danach einzeln.`;
    (ergebnis.daten as any).meta = { ...((ergebnis.daten as any).meta || {}), weitereAuftraege: teile.slice(1) };
  }
  const ersetzt = [...glatt.ersetzt, ...namen.ersetzt];
  if (ersetzt.length && ergebnis?.daten) {
    (ergebnis.daten as any).meta = { ...((ergebnis.daten as any).meta || {}), namen: ersetzt };
  }
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

const kiFrageIntern = async (admin: any, body: any, frage: string, dispoId: string | null = null, neuHalter: NeuHalter = {}) => {
  if (!frage) return { status: 400, daten: { error: 'frage_fehlt' } };
  const anfang = Date.now();

  // Markierte Fahrer (Karte) in Feierabend schicken oder anfangen lassen: ohne Modell, als Vorschlag.
  let markiert = markierteFahrer(body);

  // Verstehen per Modell (verstehen.ts): erst die Absicht, danach laufen nur die passenden Regeln.
  // Kurze Antworten auf eine offene Rueckfrage ("ja", "Stefano", "löschen") gehen ohne Modell an die Regeln.
  const k0 = body?.kontext || {};
  const offeneRueckfrage = Object.keys(k0).some((x) => /^offene|^offener|^offenes|^standbyWunsch$/.test(x) && k0[x]);
  // Ohne offene Rueckfrage zaehlt nur eine reine Zustimmung oder Ablehnung als kurze Antwort. "Ok dann schick
  // Tim heim" ist ein Auftrag und geht zum Verstehen (15.11.: ging vorher ohne Verstehen ans freie Modell).
  const kurzeAntwort = frage.length <= 40 && (offeneRueckfrage || !!nurBestaetigung(frage));
  const verlaufKurz = (Array.isArray(body?.verlauf) ? body.verlauf : []).slice(-4)
    .map((m: any) => ({ role: m?.role === 'assistant' ? 'assistant' : 'user', text: String(m?.text || '').slice(0, 500) }));
  const gruss = offeneRueckfrage ? null : smalltalk(frage);
  if (gruss) return { status: 200, daten: { answer: gruss, kontext: body?.kontext ?? null, meta: { regel: 'smalltalk' } } };
  const fest = offeneRueckfrage ? null : festeAntwort(frage);
  if (fest) return { status: 200, daten: { answer: fest.answer, kontext: body?.kontext ?? null, meta: { regel: fest.regel } } };
  let absicht: Absicht | null = null;
  const verstehenModell = await einstellung(admin, 'ollama_model_verstehen', '');
  const verstehenUrl = String(await einstellung(admin, 'ollama_url', '')).split(',')[0].trim();
  const vm: { url: string; modell: string; aus?: boolean } | null = verstehenModell && verstehenUrl ? { url: verstehenUrl, modell: verstehenModell } : null;
  // Erst kurz pruefen, ob der Mac mini da ist, sonst wartet jede Frage auf die Zeitgrenze.
  let ausser: string[] = [];
  // Neuer Ablauf: nur die Absicht vom Modell, Ausnahmen kommen aus dem Formular (kiNeuFormular.ts).
  const neuAn = String(await einstellung(admin, 'ki_ablauf', 'alt')).trim() === 'neu';
  if (vm && !kurzeAntwort && await erreichbar(vm.url)) ({ absicht, ausser } = neuAn ? { absicht: await absichtLesen(vm, frage, verlaufKurz), ausser: [] } : await absichtMitAusnahmen(vm, frage, verlaufKurz));
  if (neuAn && !kurzeAntwort) Object.assign(neuHalter, { aktiv: true, modellFehlt: !absicht, markiert: markierteFahrer(body) });
  // Dienst loeschen nur, wenn der Satz es auch sagt. Sonst ist es ein Dienst setzen oder aendern
  // ("Feierabend für alle außer Tim", "Verschieb das Dienstende auf 17", ki_protokoll 14.11. 01:13).
  if (absicht === 'dienst_loeschen' && !/l(ö|oe)sch|entfern|streich|absag|\bweg\b|raus|\bfrei\b|\bkein\w*|storn|aufheb|zur(ü|ue)ck|nicht mehr/i.test(frage)) absicht = 'dienst';
  // "Schreib allen, dass morgen frei ist", "Sag Tim: morgen kein Dienst" ist eine Nachricht, auch wenn im Text
  // Dienst-Woerter stehen (15.11.: wurde als Dienst loeschen gelesen).
  if (absicht && absicht !== 'nachricht'
    && /^\s*(bitte\s+)?(schreib\w*|sag\w*|richte\w*|erinner\w*|informier\w*|benachrichtig\w*|teil\w*)\b[^.?!]{0,40}(\bdass\b|\bdas\b|:)/i.test(frage)
    && !/\b(fahrt|notiz)\b/i.test(frage.split(/\bdass\b|:/i)[0])) absicht = 'nachricht';
  // "Notiz zur Fahrt von Müller: Gast will, dass wir die Rückfahrt stornieren" (16.11.): Was hinter dem
  // Doppelpunkt steht, ist der Text der Notiz und nie ein Auftrag. Vorher wurde daraus eine Storno-Rückfrage,
  // und das folgende „ja“ stornierte die Fahrt.
  const notizSatz = /^\s*(bitte\s+)?(neue\s+)?(notiz|vermerk|hinweis|anmerkung)\b[^:]*\b(fahrt|buchung|abholung)\b[^:]*(?<!\d):(?!\d)/i.test(frage);
  if (notizSatz && absicht && absicht !== 'fahrt_notiz') absicht = 'fahrt_notiz';
  // Eine W-Frage ist eine Frage, auch wenn das Modell im Gespraech einen Auftrag daraus liest
  // (15.11.: "welche fahrten sind noch offen" nach einer anderen Frage wurde als Auftrag abgewiesen).
  if (absicht && /^(fahrt_|dienst|loeschen|bearbeiten|nachricht)/.test(absicht)
    && /^\s*(wer|welche[rsmn]?|wie\s*viel\w*|wo|wann|warum|wieso)\b/i.test(frage)) absicht = 'frage';
  // "Schick Tim heim" ist Feierabend, keine neue Fahrt nach Hause (15.11.).
  if (absicht === 'fahrt_neu' && /\b(heim|nach\s+hause|feierabend)\b/i.test(frage) && !/\b(von|vom|zum|zur|fahrt)\b/i.test(frage)) absicht = 'dienst';
  // Ausgenommene Fahrer ("allen bis auf Stefano"): auflösen und für diese Anfrage ablegen. alleFahrer und
  // genannteFahrer lassen sie dann überall weg (ausnahmen.ts), markierte ebenso.
  const sperre = (regel: string) => ({ status: 200, daten: { answer: AUSNAHME_UNSICHER, kontext: body?.kontext ?? null, meta: { absicht, regel } } });
  const ausnahmeImSatz = !kurzeAntwort && !offeneRueckfrage && GRUPPE_RE.test(frage) && AUSNAHME_RE.test(frage);
  // Modell aus oder Frist gerissen, im Satz aber eine Gruppe, ein Ausnahme-Wort und ein Fahrername: nachfragen.
  if (ausnahmeImSatz && !absicht && (await genannteFahrer(admin, normal(frage))).length) return sperre('ausnahmeOhneModell');
  if (ausser.length) {
    const mitMarkierten = ausser.some((x) => /markiert/i.test(x));
    const namen = ausser.filter((x) => !/markiert/i.test(x));
    // Ausgenommener Name ohne passenden Fahrer: sonst gaelte die Aktion still fuer alle.
    const unbekannt: string[] = [];
    for (const n of namen) if (!(await genannteFahrer(admin, normal(n))).length) unbekannt.push(n);
    if (unbekannt.length) {
      return { status: 200, daten: { answer: `Wen meinst du mit „${unbekannt.join('“, „')}“? Diesen Fahrer finde ich nicht. Ich habe nichts geändert.`, kontext: body?.kontext ?? null, meta: { absicht, regel: 'ausnahmeUnbekannt' } } };
    }
    const weg = [...(namen.length ? await genannteFahrer(admin, normal(namen.join(' und '))) : []), ...(mitMarkierten ? markiert : [])];
    if (weg.length) {
      ausnahmenSetzen(admin, weg);
      markiert = ohneAusnahmen(admin, markiert);
    }
  }
  const markiertVorher = markierteFahrer(body);
  // Umschalter "Frei" (13.11.): reine Auskunft beantwortet das Modell selbst mit den Live-Daten.
  // Aktionen und Antworten auf offene Rueckfragen bleiben bei den Regeln.
  // Regeln zuerst (15.11.): Auch im Frei-Modus antworten erst die festen Regeln und die gerechneten Antworten
  // (Standort mit Signal-Alter, Stunden, wer hat Zeit). Das freie Modell kommt nur dran, wenn keine passt.
  // Vorher ging jede Frage zuerst ans Modell und die Antworten waren ungenauer und langsamer.
  const freiModus = body?.modus === 'frei' && !!vm && !kurzeAntwort && !offeneRueckfrage && (absicht === 'frage' || absicht === 'sonstiges');
  if (freiModus) {
    // Dienstfragen ("Arbeitet Stefano gerade noch?", "Hat er die Dienstzeit angenommen?") aus den echten
    // Diensten beantworten, nicht vom freien Modell (ki_protokoll 13.11.: "nur Fahrten erledigt").
    const dienstAntwort = await dienstFrage(admin, frage, body?.kontext ?? null);
    if (dienstAntwort) return { status: 200, daten: { answer: dienstAntwort, kontext: body?.kontext ?? null, meta: { frei: true, absicht, regel: 'dienstFrage' } } };
  }
  // Ohne ein Wort fuers Aendern ist es ein neuer Standby ("sollen sich ab 14 bis 20 Uhr an der Messe bereithalten").
  if (absicht === 'standby_aendern' && !/l(ö|oe)sch|verschieb|verleg|(ä|ae)nder|zeig|welche|gibt\s+es|absag|streich|\bweg\b|raus|storn|aufheb|k(ü|ue)rz|verl(ä|ae)nger|\?/i.test(frage)) absicht = 'standby';
  // Standby nur, wenn der Satz auch davon spricht ("Pause von Anna löschen" ist kein Standby).
  if ((absicht === 'standby' || absicht === 'standby_aendern') && !/stand.?by|bereitschaft|bereit\s*(stehen|halten)|warten/i.test(frage)) absicht = null;
  // Neuer Ablauf: Formular lesen, aufloesen, vor dem Befehl pruefen (kiNeuAblauf.ts).
  let neu: NeuVorbereitet | null = null;
  // Mehrere Fahrten in einer Nachricht teilt die Buchung selbst auf, der neue Befehl gilt nur fuer eine.
  if (neuHalter.aktiv && absicht && !(absicht === 'fahrt_neu' && body?.karten === true && auftraegeTeilen(frage).length > 1)) {
    neu = await neuVorbereiten(admin, vm, absicht, frage, {
      verlauf: verlaufKurz, kontext: body?.kontext ?? null, markiert,
      letzteFahrtId: /^[0-9a-f-]{36}$/i.test(String(body?.letzteFahrtId || '')) ? String(body.letzteFahrtId).toLowerCase() : null,
      offenerVorschlag: body?.offenerVorschlag ?? null, gespraech: () => gespraechsFahrer(admin, body?.kontext ?? null, frage),
    });
    Object.assign(neuHalter, { erwartung: neu.erwartung, formular: neu.formular, ms: neu.ms });
    if (neu.antwort) {
      neuHalter.erwartung = null;
      return { status: 200, daten: { answer: neu.antwort.answer, kontext: body?.kontext ?? null, meta: { absicht, regel: neu.antwort.regel } } };
    }
    if (neu.markiert) markiert = neu.markiert;
    if (neu.letzteFahrtId) body = { ...body, letzteFahrtId: neu.letzteFahrtId };
  }
  const neuGefuehrt = !!neu?.formular;
  const nachrichtFelder = neu && 'nachricht' in neu ? neu.nachricht ?? null : absicht === 'nachricht' ? await nachrichtLesen(vm, frage, ausser) : null;
  // Felder per Modell (Tag, Fahrer, Zeiten, welche Fahrt) als fester Befehl fuer die Regeln. Null: Originalsatz.
  // Notiz-Satz: der Originalsatz geht an die Regel, damit der Text der Notiz wörtlich bleibt.
  const befehl = neuGefuehrt ? (neu?.befehl ?? null) : notizSatz ? null : await befehlAusFeldern(vm, absicht, frage, verlaufKurz, ausser, admin);
  // Absicherung: Ist ein Ausgenommener laut den Feldern selbst gemeint ("Lösch Stefanos Dienst") und keine
  // Gruppe ("alle") genannt, war die Ausnahme falsch gelesen. Dann gilt sie nicht.
  const feldText = befehl || (nachrichtFelder ? nachrichtFelder.empfaenger.join(' und ') : '');
  if (feldText && ausnahmen(admin).length && !/\balle\b/i.test(feldText)) {
    const imBefehl = await genannteFahrer(admin, normal(feldText));
    const ziel = ausnahmen(admin).filter((f) => normal(feldText).includes(normal(f.name.split(' ')[0]).trim()));
    if (!imBefehl.length && ziel.length) {
      ausnahmenSetzen(admin, []);
      markiert = markiertVorher;
    }
  }

  // Absicht verstanden, dann riss beim Lesen der Felder die Frist (Andrang oder Modell haengt): Die Regeln laesen
  // den Originalsatz nur halb ("Tim morgen 7 bis 15, Pause 12 bis halb eins" verlor im Lasttest die Pause).
  // Dann lieber ehrlich abbrechen als einen halben Vorschlag zeigen.
  if (vm?.aus && absicht && !befehl && !['frage', 'sonstiges', 'hilfe', 'fahrt_neu', 'fahrt_aendern'].includes(absicht)) {
    return { status: 200, daten: { answer: ZU_LANGSAM, kontext: body?.kontext ?? null, meta: { absicht, regel: 'felderFrist' } } };
  }
  // Ausnahme gesetzt, aber die Felder fehlen (Frist gerissen): die Regeln laesen den Originalsatz und koennten
  // die Ausnahme umdrehen. Dann lieber nachfragen.
  if (ausnahmen(admin).length && ((!befehl && ['dienst', 'dienst_loeschen', 'standby_aendern'].includes(String(absicht)))
    || (absicht === 'nachricht' && !nachrichtFelder))) return sperre('ausnahmeOhneFelder');

  // Feste Regeln, gefiltert nach der Absicht. Findet keine etwas, laufen sie noch einmal ungefiltert,
  // damit eine falsch gelesene Absicht keine passende Regel verdeckt (ausser bei Fahrten, die gehen zum Modell).
  const regeln = async (absicht: Absicht | null, frage: string): Promise<any> => {
    // Antwort auf "Welches Fahrzeug meinst du" zuerst, damit keine andere Regel "den X5" liest.
    if (body?.kontext?.offeneFahrzeugwahl) {
      const wahl = await zuordnenVorschlag(admin, frage, body.kontext);
      if (wahl) return { status: 200, daten: { answer: wahl.answer, kontext: wahl.kontext } };
    }
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
    const dienst = fahrt || !darf('dienst', absicht) ? null : await dienstVorschlag(admin, frage, fuerDienst, body?.kontext ?? null, !markiert.length);
    if (dienst) return { status: 200, daten: { ...dienst, kontext: (dienst as any).kontext ?? body?.kontext ?? null } };
    return null;
  };
  // Unbekannter Fahrername (16.11.): Nennt der Satz einen Namen, den es nicht gibt, darf die Dienst-Regel nicht
  // still den Fahrer nehmen, um den es zuletzt ging. "Wo ist Anna" und dann "Feierabend für Klaus" traf sonst Anna
  // und hiess auch noch "markierter Fahrer". Fürwörter ("ihm", "die beiden") bleiben beim Fahrer aus dem Gespräch.
  if (befehl && absicht === 'dienst' && !markiert.length && !ausser.length) {
    const wer = (befehl.match(/^(.*?)\s*\bam \d{2}\.\d{2}\.\d{4}\b/)?.[1] || '').replace(/^für\s+/i, '').trim();
    const KEIN_NAME_WORT = /^(er|ihn|ihm|sie|ihr|ihnen|der|die|den|dem|denen|dieser|diese|diesen|beide|beiden|die beiden|alle|allen|alle fahrer|jeder|jeden|derselbe|dieselben|fahrer|den fahrer|der fahrer|die fahrer)$/;
    const unbekannt: string[] = [];
    for (const name of wer.split(/\s*(?:,|\bund\b|&)\s*/).map((x) => x.trim()).filter(Boolean)) {
      const n = normal(name).trim();
      if (!n || KEIN_NAME_WORT.test(n) || !normal(frage).includes(n)) continue;
      // Nur eine Nummer ("113", "#113"): als Fahrernummer suchen.
      const suche = /^#?\d{1,4}$/.test(n) ? ` fahrer ${n.replace('#', '')} ` : ` ${n} `;
      if (!(await genannteFahrer(admin, suche)).length) unbekannt.push(name);
    }
    if (unbekannt.length) {
      return { status: 200, daten: {
        answer: `Den Fahrer „${unbekannt.join('“, „')}“ finde ich nicht. Nenne bitte den Namen wie in der Fahrerliste oder die Fahrernummer. Ich habe nichts geändert.`,
        kontext: body?.kontext ?? null, meta: { absicht, regel: 'fahrerUnbekannt', befehl } } };
    }
  }
  const originalFrage = frage;
  const treffer = await regeln(absicht, befehl || frage)
    // Neuer Ablauf: kein zweiter Lauf ohne Absicht mit dem Originalsatz, das waere ein stiller Rueckfall.
    || (absicht && !neuGefuehrt && !['fahrt_neu', 'fahrt_aendern', 'sonstiges'].includes(absicht) ? await regeln(null, originalFrage) : null);
  if (treffer && befehl) treffer.daten = { ...treffer.daten, meta: { ...(treffer.daten?.meta || {}), absicht, befehl } };
  if (treffer) return treffer;

  // Blosses "ja" oder "nein", zu dem auf dem Server nichts offen ist (15.11.): Karten bestaetigt nur der Knopf.
  // Vorher ging es ans freie Modell, das nach 16 s "Die Fahrt wird gebucht" erfand, ohne dass etwas passierte.
  const nurJaNein = nurBestaetigung(frage);
  if (nurJaNein) {
    return { status: 200, daten: {
      answer: nurJaNein === 'nein'
        ? 'Okay. Ich habe nichts geändert. Einen offenen Vorschlag verwirfst du über „Abbrechen“ an der Karte.'
        : 'Dazu ist bei mir gerade nichts offen. Einen Vorschlag bestätigst du über den Knopf an der Karte.',
      kontext: body?.kontext ?? null, meta: { regel: 'nurJaNein' } } };
  }

  // Haupt-Rechner (ollama_url, Mac mini) und Ersatz (ollama_url_ersatz, MacBook). Beide werden
  // gleichzeitig geprueft, genommen wird der erste erreichbare in dieser Reihenfolge.
  const haupt = String(await einstellung(admin, 'ollama_url', '')).split(',').map((u) => u.trim()).filter(Boolean);
  const ersatz = String(await einstellung(admin, 'ollama_url_ersatz', '')).split(',').map((u) => u.trim()).filter(Boolean);
  const kandidaten = [...haupt, ...ersatz];
  const erreichbarkeit = await Promise.all(kandidaten.map(erreichbar));
  const ollamaUrl = kandidaten.find((_, i) => erreichbarkeit[i]) || '';
  // Kein Modell-Rechner erreichbar: Die gerechneten Antworten und die Buchung per Regel gehen trotzdem
  // (15.11.: "Wo ist Stefano" meldete "nicht erreichbar", obwohl die Antwort kein Modell braucht).
  const nichtErreichbar = { status: 200, daten: { answer: NICHT_ERREICHBAR, meta: { nichtErreichbar: true } } };

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
  // Neuer Ablauf: eine neue Fahrt bekommt den festen Befehl mit ausgerechnetem Tag und Uhrzeit.
  // Mehrere Auftraege in einer Nachricht bleiben beim Teilen der Buchung, der Befehl gilt nur fuer einen.
  const teile = neuGefuehrt && absicht === 'fahrt_neu' && befehl && (!karten || auftraegeTeilen(frage).length === 1) ? [befehl] : karten ? auftraegeTeilen(frage) : [frage];
  const offener = body?.offenerVorschlag && typeof body.offenerVorschlag === 'object' ? vorschlagVereinheitlichen(body.offenerVorschlag) : null;
  const letzteFahrtId = /^[0-9a-f-]{36}$/i.test(String(body?.letzteFahrtId || '')) ? String(body.letzteFahrtId).toLowerCase() : null;

  const antworten: string[] = [];
  const aktionen: any[] = [];
  let kontext: any = body?.kontext ?? null;
  let ersteDaten: any = null;
  for (const teilFrage of teile) {
    const runde = (ohneModell: boolean) => buchungsRunde({
      admin, dispoId, ollamaUrl, ollamaModell, verlauf, markiert, karten, zeitraum: body?.zeitraum === true, ohneModell, beginn: anfang,
      prompt: teilFrage,
      absicht: teile.length > 1 ? null : absicht,
      kontextVorher: body?.kontext ?? null,
      // Bei mehreren Auftraegen beginnt jeder neu, sonst wuerde jeder in den offenen Vorschlag geschrieben.
      offenerVorschlag: teile.length > 1 ? null : offener,
      letzteFahrtId: teile.length > 1 ? null : letzteFahrtId,
    });
    // Ein Auftrag (keine Frage) geht nie ans freie Modell: das kann nichts aendern, die Antwort waere wertlos
    // und kostete 12 s. Findet keine Regel etwas, kommt gleich die ehrliche Antwort.
    const auftrag = teile.length === 1 && !!absicht && !['frage', 'sonstiges', 'hilfe'].includes(absicht);
    // "er", "sie", "der" ohne jeden Bezug: kein Name im Satz, niemand markiert, kein Fahrer und keine Fahrt aus
    // dem Gespraech, kein Name im Verlauf. Dann fragt er nach, statt das Modell raten zu lassen.
    const bezugFehlt = async () => {
      if (teile.length !== 1 || auftrag || offeneRueckfrage || markiert.length || letzteFahrtId || offener) return false;
      if (!PRONOMEN_RE.test(normal(frage).trim())) return false;
      const k = body?.kontext || {};
      if (k.lastDriverId || (Array.isArray(k.letzteFahrer) && k.letzteFahrer.length)) return false;
      if ((await genannteFahrer(admin, normal(frage))).length) return false;
      const vorher = verlaufKurz.map((m: any) => m.text).join(' ');
      if (/\b(herr|herrn|frau|dr\.?|gast|fahrgast)\s+[A-ZÄÖÜ]/.test(vorher)) return false;
      return !(await genannteFahrer(admin, normal(vorher))).length;
    };
    const wenMeinstDu = () => ({ status: 200, daten: { answer: WEN_MEINST_DU, kontext: body?.kontext ?? null, meta: { absicht, regel: 'ohneBezug' } } });
    let r = await runde(freiModus || !ollamaUrl || modellGesperrt() || auftrag);
    if (r.daten?.meta?.ohneModell && auftrag) {
      return { status: 200, daten: { answer: NICHT_VERSTANDEN, kontext: r.kontext ?? body?.kontext ?? null, meta: { absicht, regel: 'auftragOhneRegel' } } };
    }
    if (r.daten?.meta?.ohneModell) {
      // Keine gerechnete Antwort. Ohne Rechner ist hier Schluss, im Frei-Modus antwortet jetzt das Modell.
      if (await bezugFehlt()) return wenMeinstDu();
      if (!ollamaUrl) return nichtErreichbar;
      if (modellGesperrt()) return { status: 200, daten: { answer: HAENGT, kontext: body?.kontext ?? null, meta: { modellHaengt: true } } };
      const frei = vm ? await freieAntwort(admin, vm, frage, verlaufKurz) : null;
      if (frei) return { status: 200, daten: { answer: frei, kontext: body?.kontext ?? null, modell: vm!.modell, meta: { frei: true, absicht } } };
      r = await runde(false);
    }
    // Umschalter "Regeln": dort antwortet das Modell in kiKern (meta.rag). Gleiche Sperre.
    if (r.daten?.meta?.rag && !r.aktionen.length && await bezugFehlt()) return wenMeinstDu();
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
  karten: boolean; zeitraum?: boolean; prompt: string; kontextVorher: any; offenerVorschlag: any; letzteFahrtId: string | null; standort?: unknown;
  absicht?: string | null; ohneModell?: boolean; beginn?: number;
}) => {
  const { admin, dispoId } = o;
  // Haengt das Modell, bekommt kiKern keine Adresse: die Buchungs-Hilfe per Modell faellt sofort weg statt zu warten.
  // Frist: Kong bricht nach 60 s ab, also bleibt kiKern nur, was vom Verstehen uebrig ist.
  const ki = kiErstellen({
    admin, ollamaUrl: modellGesperrt() ? '' : o.ollamaUrl, ollamaModell: o.ollamaModell, kontext: o.kontextVorher,
    fristMs: Math.max(8000, 50000 - (Date.now() - (o.beginn || Date.now()))),
  });
  // Standby zur Fahrt ("davor dort Standby ab 10 Uhr"): Zeiten raus aus der Buchung, sonst wird 10:00 die
  // Abholzeit. Fehlen der Buchung noch Angaben, wartet der Wunsch im Kontext (standbyWunsch).
  const teil = standbyTeil(o.prompt);
  const wunsch = teil ? { von: teil.von, bis: teil.bis } : o.kontextVorher?.standbyWunsch ?? null;
  try {
    const ergebnis = await ki.fragen({
      // "Start in X, Ende in Y" als "von X nach Y", damit Start und Ziel sicher erkannt werden.
      prompt: ((p: string) => streckeVereinfachen(o.absicht === 'fahrt_neu' || istFahrtAuftrag(p) ? buchungGlaetten(p) : p))(teil ? teil.rest : o.prompt),
      chatHistory: o.verlauf,
      offenerVorschlag: o.offenerVorschlag,
      // iOS schickt UUIDs in Grossbuchstaben, die Datenbank liefert sie klein.
      letzteFahrtId: o.letzteFahrtId,
      // Auf der Karte markierte Fahrer ("wo sind die drei", "was machen die markierten").
      markierteFahrer: o.markiert,
      // Vom Modell verstandene Absicht: "fahrt_neu" gilt auch, wenn die Muster in kiKern den Satz nicht kennen.
      absicht: o.absicht,
      ohneModell: o.ohneModell === true,
    });
    const daten: any = typeof ergebnis === 'string' ? { answer: ergebnis } : ergebnis;
    // Ein Auftrag, den keine Regel ausfuehren konnte, landet beim freien Modell (meta.rag). Das kann nichts
    // aendern, behauptete es aber manchmal ("Tim macht jetzt Pause", "Die Fahrt wird gebucht"). Dann ehrlich sein.
    if (daten?.meta?.rag && typeof daten.answer === 'string') daten.answer = nurDeutsch(daten.answer) ?? 'Das weiß ich nicht. Dazu habe ich keine Daten.';
    if (daten?.meta?.rag && !daten.action && o.absicht && !['frage', 'sonstiges', 'hilfe'].includes(o.absicht)) {
      daten.answer = NICHT_VERSTANDEN;
      daten.meta = { ...daten.meta, regel: 'auftragOhneRegel' };
    }
    const aktionen: any[] = [];
    if (daten?.action?.type === 'booking_proposal') {
      // Start und Ziel: eigener Ort oder echte Adresse statt nur des getippten Texts.
      const vorher = vorschlagVereinheitlichen(daten.action.proposal);
      const aufgeloest = await vorschlagOrteAufloesen(admin, vorher, dispoId, o.standort);
      daten.action.proposal = vorschlagVereinheitlichen(aufgeloest);
      // Unsicherer Ort (18.11.): kiFrage fragt nach (ortWahl.ts), statt still den ersten Treffer zu nehmen.
      const unsicher = (aufgeloest as any).ortUnsicher;
      if (unsicher?.length) daten.meta = { ...(daten.meta || {}), ortWahl: unsicher };
      const alternativen = (aufgeloest as any).ortAlternativen;
      if (alternativen) daten.meta = { ...(daten.meta || {}), ortAlternativen: alternativen };
      // Text und Karte zeigen denselben Ort (14:32: Text "Franz Josef Straße 48", Karte "Terminal 2").
      for (const f of ['start', 'ziel'] as const) {
        const alt = vorher[f];
        const jetzt = daten.action.proposal[f];
        if (alt && jetzt && alt !== jetzt && typeof daten.answer === 'string') daten.answer = daten.answer.split(alt).join(jetzt);
      }
      // Flugnummer gleich pruefen: nicht bestaetigt heisst Hinweis statt Fehler beim Buchen.
      const p0 = daten.action.proposal;
      // Start Zeitraum (16.11.): Apps, die startZeitBis schon speichern (zeitraum: true), tragen ihn an der Fahrt
      // ein. Aeltere Apps kennen das Feld nicht, dort steht der Zeitraum in der Notiz, damit er nicht verloren geht.
      if (!p0.fahrtId && p0.startZeitBis && !o.zeitraum) {
        const satz = `Abfahrt zwischen ${p0.startZeit} und ${p0.startZeitBis}`;
        if (!p0.notes.includes(satz)) p0.notes = [p0.notes, satz].filter(Boolean).join('\n');
        daten.answer = String(daten.answer || '').replace(/\nSoll ich die Fahrt so buchen\?/, `\nDen Zeitraum schreibe ich in die Notiz, als Start Zeit steht ${p0.startZeit}.\nSoll ich die Fahrt so buchen?`);
      }
      // "Fahrt mit allen Fahrern": alle Fahrer eintragen (das Modell laesst sie sonst leer, ki_protokoll 12.11.).
      if (!p0.fahrtId && /\b(mit\s+)?(alle[nm]?|saemtliche[n]?|sämtliche[n]?)\s+(unseren?\s+)?fahrer(n|innen)?\b/i.test(o.prompt)) {
        const alle = (await alleFahrer(admin)).map((f) => f.name).filter(Boolean);
        if (alle.length) {
          p0.fahrerNamen = alle;
          // Text an die echte Liste anpassen: "noch ohne Fahrer" oder ein vom Modell gesetzter Fahrer
          // ("Fahrer Marvin Keller", 15.11. 01:44 bei "alle außer Marvin"). Hinweise zu Ausgenommenen fallen weg.
          const weg = ausnahmen(admin);
          const wer = `${weg.length ? `${alle.length} Fahrer` : `alle ${alle.length} Fahrer`}${ausnahmenText(admin)}`;
          let text = String(daten.answer || '');
          text = /noch ohne Fahrer/.test(text) ? text.replace(/noch ohne Fahrer/, wer) : text.replace(/\bFahrer(in)?\s+[^.?]*?(?=\.|\s+Achtung|\s+Soll)/, wer);
          for (const f of weg) {
            text = text.replace(new RegExp(`\\s*Achtung[^.]*${f.name.split(' ')[0]}[^.]*\\.[^.]*?(?=\\s+Soll|$)`, 'g'), '');
          }
          daten.answer = text;
        }
      }
      // Neue Fahrt in der Vergangenheit ("Fahrt gestern um 9", "heute um 3 Uhr" am Vormittag): deutlich sagen.
      if (!p0.fahrtId && /^\d{4}-\d{2}-\d{2}$/.test(p0.datum) && /^\d{2}:\d{2}/.test(p0.startZeit)) {
        const jetzt = jetztBerlin();
        const min = Number(p0.startZeit.slice(0, 2)) * 60 + Number(p0.startZeit.slice(3, 5));
        if (p0.datum < jetzt.datum || (p0.datum === jetzt.datum && min < jetzt.minuten - 10)) {
          daten.answer = `${String(daten.answer || '').trim()}\n\nAchtung, diese Zeit liegt in der Vergangenheit.`;
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
    // Frist gerissen: Modell 2 Minuten ueberspringen, damit die naechsten Fragen nicht auch warten.
    if (/timeout|abort/i.test(name)) modellSperren();
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
