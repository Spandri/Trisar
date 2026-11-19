// Verstehen per Modell (qwen auf dem Mac mini): Absicht und Felder einer Nachricht, statt sie mit Mustern
// zu zerlegen. Ollama mit festem JSON-Schema (format) und Temperatur 0, das Modell kann nur gueltige Werte liefern.
//
// Schritt 1 absichtLesen: eine Absicht aus der festen Liste. ki.ts laesst danach nur die Regeln laufen,
//   die zu dieser Absicht passen (Fahrt wird nie mehr ein Dienst und umgekehrt).
// Schritt 2 je Absicht ein kleines Schema fuer die Felder (zuerst nachrichtLesen).
// Ausfuehren, Pruefen gegen die Datenbank und Rueckfrage bleiben im Code. Ist das Modell nicht erreichbar
// oder zu langsam, liefert alles null und die Regeln arbeiten wie bisher.
// Testsatz: werkzeuge/ki-test/verstehen-test.ts

// deno-lint-ignore-file no-explicit-any

export const ABSICHTEN = [
  'nachricht', 'fahrt_neu', 'fahrt_aendern', 'fahrt_stornieren', 'fahrt_erledigt', 'fahrt_kopieren', 'fahrt_notiz',
  'dienst', 'dienst_loeschen', 'standby', 'standby_aendern', 'fahrer_anlegen', 'fahrzeug_anlegen', 'loeschen',
  'zuordnen', 'bearbeiten', 'tracker', 'gast', 'ort', 'stunden', 'lohn', 'frage', 'rueckgaengig', 'hilfe', 'sonstiges',
] as const;
export type Absicht = typeof ABSICHTEN[number];

const ABSICHT_SYSTEM = `Du liest Nachrichten eines Disponenten an seinen Assistenten in einer Fahrdienst-App (Chauffeure, Gäste, Fahrten, Dienste) und bestimmst genau eine Absicht.

nachricht: Ein oder mehrere Fahrer sollen etwas erfahren oder tun, der Assistent soll es ausrichten ("sag X ...", "gib X Bescheid", "erinner X ...", "X soll ...", "schreib X ...", "X melde dich", "an alle: ...", "Push an X").
  Auch eine Fahranweisung als Mitteilung ("sie soll zum Terminal 2 fahren") ist nachricht, solange keine neue Fahrt mit Zeit und Strecke gebucht wird.
fahrt_neu: neue Fahrt buchen oder anlegen, mit Strecke, Ziel oder Abholung ("Buch ...", "Neue Fahrt ...", "Schick X um 7 zum Flughafen", "Start in A, Ende in B", "Hol Herrn Y ab").
fahrt_aendern: vorhandene Fahrt ändern (Zeit, Ziel, Fahrer setzen oder entfernen, Gast). "die Fahrt" mit bestimmtem Artikel meint meist eine vorhandene Fahrt ("Buch auf die Fahrt alle Fahrer").
fahrt_stornieren: Fahrt stornieren, absagen oder löschen.
fahrt_erledigt: Fahrt als erledigt markieren. fahrt_kopieren: Fahrt kopieren oder wiederholen. fahrt_notiz: Notiz an eine Fahrt.
dienst: Dienstzeiten eines Fahrers setzen oder senden (Dienststart, Dienstende, Feierabend, Pause, "X morgen 7 bis 15", "Schick X morgen um 7" ohne Ziel, "X kommt morgen um 7", "X hört um 15 auf", "schick die alle in Feierabend"). Feierabend oder Aufhören setzt ein Dienstende, das ist dienst.
dienst_loeschen: nur wenn ein eingetragener Dienst, Dienststart, Dienstende oder eine Pause entfernt werden soll (löschen, streichen, absagen, "hat doch frei").
standby: neuen Standby anlegen (Fahrer wartet in einer Zeitspanne an einem Ort, "Standby morgen 10 bis 18 am Kongress", "in Bereitschaft").
standby_aendern: einen vorhandenen Standby verschieben, löschen oder anzeigen.
fahrer_anlegen, fahrzeug_anlegen: neuen Fahrer oder neues Fahrzeug anlegen. loeschen: Fahrer oder Fahrzeug löschen.
zuordnen: nur ein Fahrzeug (Kennzeichen) einem Fahrer geben oder einen Tracker in ein Fahrzeug stecken.
bearbeiten: Daten eines Fahrers oder Fahrzeugs ändern: Telefon, Fahrernummer, Flagge oder Markierung, Passwort, Kennzeichen, Farbe, Sitze.
tracker: Tracker-Stufe stellen. gast: Gast anlegen oder Gastdaten ändern. ort: Ort anlegen.
stunden: Stundenzettel bestätigen oder zurückgeben, Stunden exportieren. lohn: Stundenlohn setzen.
frage: Frage an den Assistenten, die nur Auskunft will (wo ist, wer hat Dienst, welche Fahrten, wann landet, wie viele).
rueckgaengig: letzten Schritt rückgängig machen. hilfe: was kann der Assistent. sonstiges: alles andere, auch "ja", "nein", Danke.

Beispiele:
"sag Paul er soll vorne warten" -> nachricht
"Lisa ruf mich an" -> nachricht
"Schick Paul morgen um 6" -> dienst
"Schick Paul morgen um 6 zum Bahnhof" -> fahrt_neu
"Paul hört heute um 17 Uhr auf" -> dienst
"Neue Fahrt Paul Samstag 9 Uhr Start Hauptbahnhof Ende Messe" -> fahrt_neu
"Verschieb die Fahrt von Frau Kurz auf 11" -> fahrt_aendern
"Wann fängt Paul morgen an?" -> frage
"Lösch das Dienstende von Paul" -> dienst_loeschen
"Lösch den Fahrer Paul Berg" -> loeschen
"Gib Paul die Fahrernummer 7" -> bearbeiten
"Paul Feierabend um 16" -> dienst
"Erstelle allen Fahrern ein Fahrzeug, Audi A6" -> fahrzeug_anlegen
"Gib Paul das Auto M-AB 12" -> zuordnen`;

const NACHRICHT_SYSTEM = `Der Disponent will Fahrern eine Mitteilung schicken. Lies Empfänger und Text.
empfaenger: Namen der Fahrer genau wie geschrieben, oder ["alle"] wenn alle Fahrer gemeint sind. Leer, wenn keiner genannt ist.
text: was der Fahrer lesen soll, möglichst mit den Worten des Disponenten, in direkter Anrede, ohne Namen am Anfang, ohne "dass er". Leer, wenn noch kein Inhalt genannt ist.

Beispiele:
"sag Paul er soll vorne warten" -> ["Paul"] "Bitte vorne warten."
"Lisa ruf mich an" -> ["Lisa"] "Ruf mich an."
"erinnere alle an die Westen" -> ["alle"] "Denkt an die Westen."
"Nachricht an Paul und Lisa: Tanken nicht vergessen" -> ["Paul", "Lisa"] "Tanken nicht vergessen."
"Schick Paul eine Nachricht" -> ["Paul"] ""
"Schreib eine Nachricht: Treffpunkt Halle B" -> [] "Treffpunkt Halle B"
"Paul: Gast kommt 10 Minuten später" -> ["Paul"] "Gast kommt 10 Minuten später."
"Sag allen außer Lisa, dass sie tanken sollen" -> ["alle"] "Bitte tanken."
Wer ausgenommen ist ("außer Lisa", "bis auf Paul"), gehört nie in den Text.`;

const NACHRICHT_SCHEMA = {
  type: 'object',
  properties: { empfaenger: { type: 'array', items: { type: 'string' } }, text: { type: 'string' } },
  required: ['empfaenger', 'text'],
};

// aus: In dieser Anfrage ist schon eine Frist gerissen. Dann ruft sie das Modell nicht noch einmal (sonst
// wartete eine Frage drei Fristen hintereinander), und ki.ts raet nicht aus halben Angaben.
type Modell = { url: string; modell: string; aus?: boolean };

// Sicherung (15.11.): Haengt das Modell (Rechner an, aber keine Antwort), wartete vorher jede Frage 20 bis 40 s
// auf die Frist, "Hallo" 72 s. Nach einer gerissenen Frist gilt das Modell 2 Minuten als nicht nutzbar, alle
// Aufrufe kommen sofort leer zurueck und die Regeln antworten. Danach darf wieder ein Aufruf probieren.
// Der Zustand liegt im Speicher der Funktion. Startet sie neu, probiert sie einfach wieder.
// KI_SPERRE_MS=0 schaltet die Sicherung ab (Testsatz: eine langsame Antwort soll nicht die naechsten Faelle kippen).
const sperreMs = () => { const w = Number(Deno.env.get('KI_SPERRE_MS') ?? ''); return Number.isFinite(w) && Deno.env.get('KI_SPERRE_MS') ? w : 2 * 60 * 1000; };
let gesperrtBis = 0;
// Gesperrt wird erst nach zwei gerissenen Fristen in Folge. Eine einzelne kann auch nur Andrang sein: Der Mac mini
// rechnet eine Anfrage nach der anderen, drei Disponenten zugleich brauchten im Test bis 19 s (15.11.).
let fehlFolge = 0;
export const modellGesperrt = () => Date.now() < gesperrtBis;
export const modellSperren = () => { fehlFolge += 1; if (fehlFolge >= 2) gesperrtBis = Date.now() + sperreMs(); };
export const modellGeht = () => { fehlFolge = 0; };
export const modellFreigeben = () => { gesperrtBis = 0; fehlFolge = 0; };

// Ein Aufruf mit Schema. null bei Fehler oder Zeitueberschreitung.
// Frist 20 s: Absicht braucht normal 1 bis 3 s, Felder 3 bis 10 s, bei drei Fragen zugleich bis 19 s.
const lesen = async (m: Modell, system: string, nachricht: string, schema: any, verlauf: { role: string; text: string }[] = [], frist = 20000) => {
  if (modellGesperrt() || m.aus) return null;
  try {
    const r = await fetch(`${m.url.replace(/\/$/, '')}/api/chat`, {
      method: 'POST',
      signal: AbortSignal.timeout(frist),
      body: JSON.stringify({
        model: m.modell, stream: false, format: schema, keep_alive: -1, think: false,
        options: { temperature: 0, num_ctx: 4096 },
        messages: [
          { role: 'system', content: system },
          // Letzte Schritte des Gespraechs, damit Folgesaetze verstanden werden.
          ...verlauf.slice(-4).map((v) => ({ role: v.role === 'assistant' ? 'assistant' : 'user', content: String(v.text || '').slice(0, 500) })),
          { role: 'user', content: nachricht },
        ],
      }),
    });
    if (!r.ok) return null;
    const d = await r.json();
    modellGeht();
    return JSON.parse(String(d?.message?.content || ''));
  } catch (fehler) {
    // Nur eine gerissene Frist zaehlt. Unsinn oder ein Fehlerstatus kommen sofort zurueck und kosten keine Zeit.
    if (fehler instanceof Error && /timeout|abort/i.test(`${fehler.name} ${fehler.message}`)) { m.aus = true; modellSperren(); }
    return null;
  }
};

export const absichtLesen = async (m: Modell | null, frage: string, verlauf: { role: string; text: string }[] = []): Promise<Absicht | null> => {
  if (!m?.url || !m.modell) return null;
  const j = await lesen(m, ABSICHT_SYSTEM, frage, {
    type: 'object', properties: { absicht: { type: 'string', enum: ABSICHTEN } }, required: ['absicht'],
  }, verlauf);
  const a = String(j?.absicht || '');
  return (ABSICHTEN as readonly string[]).includes(a) ? a as Absicht : null;
};

// Ausnahmen (14.11.): eigener kleiner Aufruf, nur wenn im Satz eine Gruppe steht (alle, jeder, die markierten).
// Ein Feld im Absicht-Schritt hat dort andere Absichten verschoben ("Anna braucht morgen keine Pause").
// Ausgenommen werden kann nur aus einer Gruppe, darum ohne Gruppe gar kein Aufruf.
// Nur Gruppen von Fahrern: "alle Dienste", "jeden Tag", "alle Fahrten" sind keine (15.11.: Tim wurde
// bei "jeden Tag 7 bis 15 für Tim" als Ausnahme gelesen).
export const GRUPPE_RE = /\b(alle[nms]?|jede[nmrs]?|s(ae|ä)mtliche[nm]?)\b(?!\s+(dienst|fahrt|tag|tage|woche|stunden|pause|termin|offen|zettel|minuten|standby|auto|fahrzeug|tracker|\d))|\bmarkiert\w*|\banderen\b|\ballesamt\b/i;
const AUSSER_SYSTEM = `Der Disponent spricht eine Gruppe von Fahrern an (alle, jeder, die markierten). Werden einzelne davon ausgenommen?
ausser: Namen der ausgenommenen Fahrer wie geschrieben, "markierte" wenn die markierten ausgenommen sind, sonst [].

Beispiele:
"Schick allen bis auf Stefano Dienstbeginn heute 13:30" -> ["Stefano"]
"Sag allen außer Tim und Lisa, dass sie tanken sollen" -> ["Tim", "Lisa"]
"Feierabend für alle, nur Marvin nicht" -> ["Marvin"]
"Alle außer den markierten in den Feierabend" -> ["markierte"]
"Schick allen Fahrern Dienstbeginn morgen 7" -> []
"Erinnere alle an die Westen" -> []
"Lösch alle Dienste von Tim" -> []
"Plan jeden Tag 7 bis 15 für Tim" -> []`;
// Ausnahme-Sperre (15.11.): Eine Ausnahme gilt nur, wenn der Satz sie auch ausspricht. Ohne eines dieser Woerter
// fragt der Assistent das Modell gar nicht erst ("Lösch alle Dienste von Tim" darf nie "alle ausser Tim" werden).
export const AUSNAHME_RE = /au(ß|ss)er\b|\bbis\s+auf\b|\bausgenommen\b|\bausnahme\b|\bnicht\b|\bohne\b|\bkein(e|en|er)?\b|\balle[nms]?\s+(anderen|übrigen|uebrigen)\b/i;
export const ausserLesen = async (m: Modell | null, frage: string): Promise<string[]> => {
  if (!m?.url || !m.modell || !GRUPPE_RE.test(frage) || !AUSNAHME_RE.test(frage)) return [];
  const j = await lesen(m, AUSSER_SYSTEM, frage, { type: 'object', properties: { ausser: { type: 'array', items: { type: 'string' } } }, required: ['ausser'] });
  // Nur Namen, die wirklich im Satz stehen (15.11. 01:46: vier erfundene Ausnahmen bei "für alle Fahrer").
  const klein = (x: string) => x.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const satz = klein(frage);
  return (Array.isArray(j?.ausser) ? j.ausser : []).map((x: unknown) => String(x || '').trim()).filter(Boolean)
    .filter((x: string) => /markiert/i.test(x) ? /markiert/i.test(frage) : klein(x).split(/\s+/).some((w) => w.length >= 2 && satz.includes(w)))
    .slice(0, 20);
};

export const absichtMitAusnahmen = async (m: Modell | null, frage: string, verlauf: { role: string; text: string }[] = []): Promise<{ absicht: Absicht | null; ausser: string[] }> => {
  // Nacheinander: der Mac mini rechnet eine Anfrage nach der anderen. Parallel wartete die Absicht hinter
  // den Ausnahmen und lief in ihre Frist (15.11., Antworten nach 40 s vom freien Modell).
  const absicht = await absichtLesen(m, frage, verlauf);
  // Reine Auskunft oder Smalltalk braucht keine Ausnahmen.
  const ausser = absicht && ['frage', 'sonstiges', 'hilfe', 'rueckgaengig'].includes(absicht) ? [] : await ausserLesen(m, frage);
  return { absicht, ausser };
};

export const nachrichtLesen = async (m: Modell | null, frage: string, ausser: string[] = []): Promise<{ empfaenger: string[]; text: string } | null> => {
  if (!m?.url || !m.modell) return null;
  const j = await lesen(m, NACHRICHT_SYSTEM, frage, NACHRICHT_SCHEMA);
  if (!j || !Array.isArray(j.empfaenger)) return null;
  return { empfaenger: ohneAusser(j.empfaenger, ausser), text: String(j.text || '').trim() };
};

// Welche Regel bei welcher Absicht laufen darf. Ohne Absicht (Modell aus) laufen alle wie bisher.
const ERLAUBT: Record<string, Absicht[]> = {
  lohn: ['lohn', 'frage'],
  namen: ['fahrer_anlegen', 'sonstiges'],
  steuern: ['nachricht', 'bearbeiten', 'tracker', 'gast', 'ort', 'stunden', 'frage', 'rueckgaengig', 'hilfe', 'sonstiges'],
  fahrten: ['fahrt_stornieren', 'fahrt_erledigt', 'fahrt_kopieren', 'fahrt_notiz', 'fahrt_aendern', 'frage'],
  anlegen: ['fahrer_anlegen', 'fahrzeug_anlegen', 'zuordnen'],
  standbyAendern: ['standby_aendern', 'frage'],
  dienstLoeschen: ['dienst_loeschen'],
  loeschen: ['loeschen'],
  zuordnen: ['zuordnen'],
  dienstFrage: ['frage'],
  gastFrage: ['frage'],
  standbyAllein: ['standby'],
  dienst: ['dienst'],
};
export const darf = (regel: string, absicht: Absicht | null) => !absicht || !ERLAUBT[regel] || ERLAUBT[regel].includes(absicht);

// ---- Schritt 2: Felder je Absicht -------------------------------------------------------------------
// Das Modell liest Tag, Fahrer, Zeiten usw. aus dem frei formulierten Satz. Der Code prueft jedes Feld
// (Datum, Uhrzeit) und baut daraus einen festen Befehl ("Dienststart 07:30 am 14.11.2026 für Stefano"),
// den die vorhandenen Regeln sicher lesen. Die Regel prueft gegen die Datenbank und fragt vor dem Speichern.
// Liefert null, wenn das Modell nichts Brauchbares liefert. Dann bekommt die Regel den Originalsatz.

import { datumAusText, jetztBerlin, nachts, normal, plusTage, relativDatum, wocheBereich, wochenTage } from './dienst.ts';

const WT = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
// Kalender fuer das Modell (15.11.): erst heute und die kommenden 3 Wochen, die vergangene Woche getrennt
// darunter. Stand die Vergangenheit oben, nahm das Modell bei "Sonntag" den vergangenen (13.11.: So 08.11.).
const kalender = () => {
  const { datum: heute } = jetztBerlin();
  const zeile = (i: number) => {
    const d = plusTage(heute, i);
    const wt = WT[new Date(`${d}T12:00:00Z`).getUTCDay()];
    const name = i === 0 ? ' (heute)' : i === 1 ? ' (morgen)' : i === 2 ? ' (übermorgen)' : i === -1 ? ' (gestern)' : i === -2 ? ' (vorgestern)' : '';
    return `${d} ${wt}${name}`;
  };
  const kommend = Array.from({ length: 22 }, (_, i) => zeile(i));
  const vergangen = Array.from({ length: 7 }, (_, i) => zeile(-1 - i));
  return `Kalender ab heute:\n${kommend.join('\n')}\nVergangene Tage (nur bei gestern, vorgestern, letzten, vergangenen):\n${vergangen.join('\n')}\n`
    + 'Ein Wochentag ohne Zusatz meint den nächsten nach heute. Ist heute dieser Wochentag, ist der in 7 Tagen gemeint, für heute sagt man "heute".';
};

const DATUM = /^\d{4}-\d{2}-\d{2}$/;
const UHR = /^([01]\d|2[0-3]):[0-5]\d$/;
const datumOk = (d: unknown) => (DATUM.test(String(d || '')) ? String(d) : '');
// Sicherung fuer das Datum vom Modell: Steht ein Wochentag im Satz, ohne gestern/letzten/vergangenen und
// ohne festes Datum, liegt der Tag nach heute (gleiche Regel wie datumAusText in dienst.ts). Ein Datum vom
// Modell, das heute oder in der Vergangenheit liegt, wird auf den naechsten solchen Wochentag gesetzt.
const WT_KLEIN = ['sonntag', 'montag', 'dienstag', 'mittwoch', 'donnerstag', 'freitag', 'samstag'];
// neu: Dienst setzen. Dann meint der heutige Wochentag den in 7 Tagen. Sonst wird nur Vergangenes korrigiert.
export const tagPruefen = (iso: string, frage: string, neu = false): string => {
  if (!iso) return iso;
  const t = frage.toLowerCase();
  const { datum: heute } = jetztBerlin();
  // "in drei Wochen am Dienstag", "in 10 Tagen", "übernächsten Freitag": rechnen (16.11., siehe relativDatum).
  const relativ = relativDatum(frage, heute);
  if (relativ) return relativ;
  // "letzten Freitag": rechnen statt dem Modell glauben (13.11.: Dienstag 10.11. statt Freitag).
  if (/\b(letzte|vergangene|vorige)[nmrs]?\s+(montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag)\b/.test(t)) return datumAusText(` ${t} `, heute);
  if (/gestern|vorgestern|letzte|vergangene|vorige|\b[0-3]?\d\.[01]?\d\./.test(t)) return iso;
  // Nachts meint "morgen" das heutige Kalenderdatum (siehe datumAusText in dienst.ts).
  if (nachts(heute) && /\bmorgen\b/.test(t) && !/übermorgen|uebermorgen/.test(t) && iso === plusTage(heute, 1)) return heute;
  const wt = new Date(`${iso}T12:00:00Z`).getUTCDay();
  const genannt = WT_KLEIN.map((w, i) => (new RegExp(`\\b${w}s?\\b`).test(t) ? i : -1)).filter((i) => i >= 0);
  // Genau ein Wochentag genannt, das Modell liefert einen anderen (15.11.: "Sonntag" -> Montag 16.11.): rechnen.
  if (genannt.length === 1 && genannt[0] !== wt && !/woche/.test(t)) return datumAusText(` ${t} `, heute, neu);
  // Richtiger Wochentag, aber mehr als eine Woche entfernt (15.11.: "am Montag" wurde Montag in acht Tagen):
  // ohne "Woche", "übernächsten" oder Datum im Satz ist der naechste gemeint, also rechnen.
  if (genannt.length === 1 && iso > plusTage(heute, 7) && !/woche|übern|uebern|\bin\s+\d+\s+tagen/.test(t)) return datumAusText(` ${t} `, heute, neu);
  // Nachts vor 05:00 meint der heutige Wochentag heute ("am Sonntag um 9" um 01:30 am Sonntag), nicht in 7 Tagen.
  // Ebenso beim Loeschen, Aendern und Fragen (neu = false, 16.11.): "den Dienststart am Montag bitte löschen" an
  // einem Montag las das Modell als Montag in 7 Tagen. Wie in datumAusText bleibt heute dann eingeschlossen.
  if ((nachts(heute) || !neu) && genannt.length === 1 && genannt[0] === new Date(`${heute}T12:00:00Z`).getUTCDay()
    && iso === plusTage(heute, 7) && !/n(ä|ae)chste|kommende|woche|übern|uebern/.test(t)) return heute;
  if (iso > heute) return iso;
  if (!genannt.includes(wt)) return iso;
  if (iso === heute && (!neu || nachts(heute) || /\bheute\b/.test(t))) return iso;
  const heuteTag = new Date(`${heute}T12:00:00Z`).getUTCDay();
  return plusTage(heute, ((wt - heuteTag + 7) % 7) || (neu && !nachts(heute) ? 7 : 0));
};
const uhrOk = (u: unknown) => {
  const t = String(u || '').trim().replace('.', ':');
  const m = t.match(/^(\d{1,2})(?::(\d{2}))?$/);
  if (!m) return '';
  const r = `${m[1].padStart(2, '0')}:${m[2] || '00'}`;
  return UHR.test(r) ? r : '';
};
const de = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
const namenText = (namen: unknown) => {
  const n = (Array.isArray(namen) ? namen : []).map((x) => String(x || '').trim()).filter(Boolean);
  // "alle außer Stefano" landet manchmal so im Feld: die Ausnahme steht schon in ausser (ausnahmen.ts).
  if (n.some((x) => /^(alle|allen|alle fahrer)(\s|$)/i.test(x))) return 'alle Fahrer';
  return n.join(' und ');
};

const FAHRER_FELD = { type: 'array', items: { type: 'string' } };

// Nur gefuellte Felder (15.11.): Das Modell schreibt auf dem Mac mini rund 12 Tokens pro Sekunde, leere Felder
// kosteten bei jedem Dienst-Satz mit. Vorher 83 Antwort-Tokens und 7,5 s. Kurze Feldnamen (s, e) machten es
// ungenauer ("halb drei" als 12:30), daher bleiben die sprechenden Namen.
const DIENST_SYSTEM = `Der Disponent setzt Dienstzeiten für Fahrer. Lies die Felder.
fahrer: Namen wie geschrieben, ["alle"] für alle Fahrer, [] wenn keiner genannt ist (dann gilt der Fahrer aus dem Gespräch).
tage: je genanntem Tag ein Eintrag. datum als JJJJ-MM-TT aus dem Kalender. Kein Tag genannt: heute.
  start: Dienststart als HH:MM, nur wenn als Start gemeint ("Dienststart", "fängt an", "ab", "kommt um", "beginnt", "von 7 bis 15" ist start 07:00).
  ende: Dienstende als HH:MM, nur wenn als Ende gemeint ("Feierabend", "Schluss", "bis", "hört auf", "Dienstende").
  pause_von, pause_bis: eine Pause als HH:MM. Pause ohne Ende: nur pause_von.
  zeit_ohne_art: eine Uhrzeit, bei der nicht gesagt ist, ob Start oder Ende ("Tim heute 18 Uhr").
  Feierabend ohne Uhrzeit: ende "jetzt".
  "halb 8" ist 07:30, "viertel nach 6" 06:15, "mittags" 12:00. Nachts nach Mitternacht bleibt der Tag.
  Änderung ("von 7:30 auf 6:30", "verschieb das Ende auf 17"): nur die neue Zeit eintragen, die alte nicht.
Felder ohne Wert weglassen, nur datum ist immer da.`;
const ZEIT = { type: 'string' };
const DIENST_SCHEMA = {
  type: 'object',
  properties: {
    fahrer: FAHRER_FELD,
    tage: { type: 'array', items: { type: 'object', properties: {
      datum: { type: 'string' }, start: ZEIT, ende: ZEIT, pause_von: ZEIT, pause_bis: ZEIT, zeit_ohne_art: ZEIT,
    }, required: ['datum'] } },
  },
  required: ['fahrer', 'tage'],
};
// Kurze Felder auf die alten Namen, damit der Rest unveraendert bleibt.
const dienstTag = (t: any) => ({
  datum: String(t?.d ?? t?.datum ?? ''), start: String(t?.s ?? t?.start ?? ''), ende: String(t?.e ?? t?.ende ?? ''),
  pause_von: String(t?.pv ?? t?.pause_von ?? ''), pause_bis: String(t?.pb ?? t?.pause_bis ?? ''),
  zeit_ohne_art: String(t?.z ?? t?.zeit_ohne_art ?? ''),
});

const DIENST_LOESCHEN_SYSTEM = `Der Disponent will einen eingetragenen Dienst oder einen Teil davon entfernen. Lies die Felder.
fahrer: Namen wie geschrieben, ["alle"] für alle, [] wenn keiner genannt ist.
was: "dienst" (ganzer Dienst, absagen, frei geben), "start" (nur Dienststart), "ende" (nur Dienstende oder Feierabend), "pausen" (Pausen).
datum: JJJJ-MM-TT aus dem Kalender, "" wenn kein Tag genannt ist.
woche: "naechste" oder "diese", wenn eine ganze Woche gemeint ist, sonst "".`;
const DIENST_LOESCHEN_SCHEMA = {
  type: 'object',
  properties: { fahrer: FAHRER_FELD, was: { type: 'string', enum: ['dienst', 'start', 'ende', 'pausen'] }, datum: { type: 'string' }, woche: { type: 'string', enum: ['', 'naechste', 'diese'] } },
  required: ['fahrer', 'was', 'datum', 'woche'],
};

const STANDBY_AENDERN_SYSTEM = `Der Disponent will einen vorhandenen Standby (Fahrer wartet an einem Ort) anzeigen, löschen oder verschieben.
aktion: "anzeigen", "loeschen" oder "verschieben". fahrer: Namen wie geschrieben oder []. datum: JJJJ-MM-TT aus dem Kalender oder "".
von, bis: neue Zeiten als HH:MM beim Verschieben, sonst "".`;
const STANDBY_AENDERN_SCHEMA = {
  type: 'object',
  properties: { aktion: { type: 'string', enum: ['anzeigen', 'loeschen', 'verschieben'] }, fahrer: FAHRER_FELD, datum: { type: 'string' }, von: ZEIT, bis: ZEIT },
  required: ['aktion', 'fahrer', 'datum', 'von', 'bis'],
};

const FAHRT_SYSTEM = `Der Disponent meint eine vorhandene Fahrt. Lies, woran man sie erkennt, und was damit passieren soll.
gast: Nachname des Gastes ohne Herr/Frau ("Herrn Engel" -> "Engel"), sonst "". fahrer: Fahrername wie geschrieben, sonst "".
datum: Tag der Fahrt als JJJJ-MM-TT aus dem Kalender, "" wenn nicht genannt. uhrzeit: Abfahrt der Fahrt als HH:MM, sonst "".
zieldatum: nur beim Kopieren der neue Tag als JJJJ-MM-TT, sonst "". notiz: nur bei einer Notiz deren Text, sonst "".
endgueltig: true nur, wenn ausdrücklich endgültig oder komplett gelöscht werden soll.`;
const FAHRT_SCHEMA = {
  type: 'object',
  properties: { gast: { type: 'string' }, fahrer: { type: 'string' }, datum: { type: 'string' }, uhrzeit: ZEIT, zieldatum: { type: 'string' }, notiz: { type: 'string' }, endgueltig: { type: 'boolean' } },
  required: ['gast', 'fahrer', 'datum', 'uhrzeit', 'zieldatum', 'notiz', 'endgueltig'],
};

// Fester Befehl aus den Feldern. null: Modell aus, nichts Brauchbares, oder Absicht ohne Felder-Schritt.
// ausser: vom Modell gelesene Ausnahmen (ausserLesen). Stehen in den Feldern nur Ausgenommene, sind alle
// anderen gemeint ("Feierabend für alle außer Tim und Marvin" liefert sonst fahrer ["Tim", "Marvin"]).
const ohneAusser = (namen: unknown, ausser: string[]) => {
  const n = (Array.isArray(namen) ? namen : []).map((x) => String(x || '').trim()).filter(Boolean);
  if (!ausser.length) return n;
  const klein = (x: string) => x.toLowerCase();
  const rest = n.filter((x) => !ausser.some((a) => klein(x).includes(klein(a).split(' ')[0]) || klein(a).includes(klein(x).split(' ')[0])));
  return rest.length ? rest : ['alle'];
};
// Steht im Satz ein Tag? Sonst gilt heute, das Modell nimmt sonst gern morgen (15.11.).
const TAG_IM_SATZ = /heute|morgen|gestern|montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag|woche|werktag|täglich|taeglich|\bin\s+\S+\s+tagen\b|\b[0-3]?\d\.[01]?\d\./i;
// Weitere Felder (15.11., Haertetest): Die Regeln fuer Zuordnen, Gast und Standby kennen nur bestimmte
// Formulierungen ("Gib Marvin das Fahrzeug M-TR 103" ging, "Ordne Marvin das Auto M-TR 103 zu" nicht).
// Das Modell liest die Angaben, der Code prueft sie gegen den Satz und baut den Befehl, den die Regel kennt.
const ZUORDNEN_SYSTEM = `Der Disponent ordnet einem Fahrer ein Fahrzeug zu oder steckt einen Tracker in ein Fahrzeug. Lies die Felder.
fahrer: Name des Fahrers wie geschrieben, sonst "". kennzeichen: Kennzeichen wie geschrieben ("M-TR 103"), sonst "".
fahrzeug: Marke oder Modell, wenn kein Kennzeichen genannt ist ("BMW X5", "V-Klasse"), sonst "". tracker: Nummer des Trackers, sonst "".`;
const ZUORDNEN_SCHEMA = {
  type: 'object',
  properties: { fahrer: { type: 'string' }, kennzeichen: { type: 'string' }, fahrzeug: { type: 'string' }, tracker: { type: 'string' } },
  required: ['fahrer', 'kennzeichen', 'fahrzeug', 'tracker'],
};
const GAST_SYSTEM = `Der Disponent meint einen Gast (Fahrgast). Lies die Felder.
aktion: "anlegen" (neuen Gast anlegen), "aendern" (Daten eines Gastes ändern) oder "frage" (etwas über einen Gast wissen wollen).
vorname, nachname: wie geschrieben, ohne Herr, Frau oder Titel. firma, telefon, email: wie geschrieben, sonst "".`;
const GAST_SCHEMA = {
  type: 'object',
  properties: { aktion: { type: 'string', enum: ['anlegen', 'aendern', 'frage'] }, vorname: { type: 'string' }, nachname: { type: 'string' }, firma: { type: 'string' }, telefon: { type: 'string' }, email: { type: 'string' } },
  required: ['aktion', 'vorname', 'nachname', 'firma', 'telefon', 'email'],
};
const STANDBY_SYSTEM = `Der Disponent legt einen Standby an: Fahrer warten an einem Ort bereit, ohne Fahrt. Lies die Felder.
fahrer: Namen wie geschrieben, ["alle"] für alle, [] wenn keiner genannt ist. datum: JJJJ-MM-TT aus dem Kalender, kein Tag genannt: heute.
von, bis: Uhrzeiten als HH:MM, sonst "". ort: Ort wie geschrieben, in der Grundform ("am Bayerischen Hof" -> "Bayerischer Hof"), sonst "".`;
const STANDBY_SCHEMA = {
  type: 'object',
  properties: { fahrer: FAHRER_FELD, datum: { type: 'string' }, von: { type: 'string' }, bis: { type: 'string' }, ort: { type: 'string' } },
  required: ['fahrer', 'datum', 'von', 'bis', 'ort'],
};
// Steht der Wert im Satz? Gross/klein, Umlaute, Leerzeichen und Bindestriche egal.
const eng = (x: unknown) => String(x || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
const imSatz = (wert: unknown, frage: string) => eng(wert).length >= 2 && eng(frage).includes(eng(wert));

export const befehlAusFeldern = async (m: Modell | null, absicht: Absicht | null, frage: string, verlauf: { role: string; text: string }[] = [], ausser: string[] = [], admin: any = null): Promise<string | null> => {
  if (!m?.url || !m.modell || !absicht) return null;
  const sys = (s: string) => `${s}\n\n${kalender()}`;

  if (absicht === 'dienst') {
    // Ganze Woche ("nächste Woche werktags 8 bis 16"): Die Regel zaehlt die Tage selbst sicher ab. Das Modell
    // liess am Sonntag den Montag weg (15.11.), also bekommt die Regel den Originalsatz.
    const nt = normal(frage);
    const woche = wocheBereich(nt, jetztBerlin().datum);
    if (woche && wochenTage(nt, woche, jetztBerlin().datum)) return null;
    const j = await lesen(m, sys(DIENST_SYSTEM), frage, DIENST_SCHEMA, verlauf);
    const tage = (Array.isArray(j?.tage) ? j.tage : []).map(dienstTag).filter((t: any) => datumOk(t?.datum)).slice(0, 14)
      .map((t: any) => ({ ...t, datum: TAG_IM_SATZ.test(frage) ? tagPruefen(t.datum, frage, true) : jetztBerlin().datum }));
    if (!tage.length) return null;
    let wer = namenText(ohneAusser(j?.fahrer, ausser));
    // Nur was im Satz steht (15.11., Haertetest): "Und für Anna auch" ohne Vorgeschichte ergab "Dienststart 00:00,
    // Dienstende 23:59 für alle 4 Fahrer". "Alle" gilt nur mit einem Gruppenwort, Zeiten nur mit einer Zeitangabe.
    if (wer === 'alle Fahrer' && !GRUPPE_RE.test(frage) && !ausser.length) wer = '';
    const zeitImSatz = /\d|\bhalb\b|viertel|mittag|mitternacht|\b(ein|eins|zwei|drei|vier|fünf|fuenf|sechs|sieben|acht|neun|zehn|elf|zwölf|zwoelf)\b/i.test(frage);
    // Start oder Ende nur, wenn es im Satz auch so steht. Sonst ist es eine Uhrzeit ohne Art, und die Regel
    // fragt bei einem vorhandenen Dienst nach (Start, Ende oder Pause?), statt dass das Modell raet.
    const t0 = frage.toLowerCase();
    const startWort = /start|beginn|anfang|fängt|faengt|fangen|\bab\b|kommt|\bvon\b|\d\s*(-|–|bis)\s*\d|schicht|arbeitet/.test(t0);
    const endeWort = /\bbis\b|ende|feierabend|schluss|aufh|hört|hoert|heim|hause|\d\s*(-|–)\s*\d/.test(t0);
    const teile = tage.map((t: any) => {
      let start = zeitImSatz ? uhrOk(t.start) : '';
      let ende = String(t.ende).trim().toLowerCase() === 'jetzt' ? (/feierabend|schluss|heim|hause|aufh|fertig|ende|jetzt|sofort/.test(t0) ? 'jetzt' : '')
        : zeitImSatz ? uhrOk(t.ende) : '';
      let ohneArt = zeitImSatz ? uhrOk(t.zeit_ohne_art) : '';
      if (start && !startWort && !ende) { ohneArt = ohneArt || start; start = ''; }
      if (ende && ende !== 'jetzt' && !endeWort && !start) { ohneArt = ohneArt || ende; ende = ''; }
      const pv = zeitImSatz ? uhrOk(t.pause_von) : '';
      const pb = zeitImSatz ? uhrOk(t.pause_bis) : '';
      const frei = !start && !ende && !pv ? ohneArt : '';
      const stuecke = [
        start ? `Dienststart ${start}` : '',
        pv ? `Pause ${pv}${pb ? ` bis ${pb}` : ''}` : '',
        ende === 'jetzt' ? 'Feierabend' : ende ? `Dienstende ${ende}` : '',
        frei ? `um ${frei}` : '',
      ].filter(Boolean);
      return stuecke.length ? `am ${de(t.datum)} ${stuecke.join(' ')}` : '';
    }).filter(Boolean);
    if (!teile.length) return null;
    // Ohne genannten Fahrer bleibt der Name weg, die Regel nimmt dann markierte oder den aus dem Gespraech.
    return `${wer ? `${wer} ` : ''}${teile.join(' und ')}`.replace(/^alle Fahrer/, 'für alle Fahrer');
  }

  if (absicht === 'zuordnen') {
    const j = await lesen(m, ZUORDNEN_SYSTEM, frage, ZUORDNEN_SCHEMA, verlauf);
    if (!j) return null;
    // Kennzeichen nur in Kennzeichen-Form ("M-TR 103"). "X5" im Feld ist ein Modell.
    const istKz = (x: unknown) => /^[A-ZÄÖÜ]{1,3}[\s-]?[A-Z]{1,2}[\s-]?\d{1,4}[EH]?$/.test(String(x || '').trim().toUpperCase());
    let kz = istKz(j.kennzeichen) && imSatz(j.kennzeichen, frage) ? String(j.kennzeichen).trim().toUpperCase() : '';
    // Nur Marke oder Modell genannt ("den BMW X5"): das Kennzeichen suchen, wenn genau ein Fahrzeug passt.
    const modellWort = imSatz(j.fahrzeug, frage) ? j.fahrzeug : !kz && imSatz(j.kennzeichen, frage) ? j.kennzeichen : '';
    if (!kz && admin && modellWort) {
      const { data } = await admin.from('vehicles').select('license_plate, brand_model');
      // Jedes Wort muss im Modell vorkommen, die Reihenfolge ist egal ("7er BMW" passt auf "BMW 7er").
      const teile = String(modellWort).split(/\s+/).map(eng).filter((w) => w.length >= 2);
      const passt = (Array.isArray(data) ? data : []).filter((v: any) => v?.license_plate && teile.length && teile.every((w) => eng(v.brand_model).includes(w)));
      if (passt.length === 1) kz = String(passt[0].license_plate);
    }
    if (!kz) return null;
    const nr = String(j.tracker || '').replace(/\D/g, '');
    if (nr && new RegExp(`tracker\\s*(nr\\.?|nummer)?\\s*${nr}\\b`, 'i').test(frage)) return `Tracker ${nr} ins Auto ${kz}`;
    const fahrer = imSatz(String(j.fahrer || '').split(' ')[0], frage) ? String(j.fahrer).trim() : '';
    return fahrer ? `Gib ${fahrer} das Fahrzeug ${kz}` : null;
  }

  if (absicht === 'gast') {
    // Nur wenn der Satz von einem Gast spricht. "Leg den Kunden BMW Group an" ist kein Gast (Testfall Fehlgriff).
    if (!/\b(gast|g(ä|ae)ste|fahrgast|passagier\w*)\b/i.test(frage)) return null;
    // Nur das Anlegen braucht den festen Satz, Fragen und Aendern liest die Regel aus dem Original.
    if (!/\b(leg\w*|anleg\w*|erstell\w*|hinzuf(ü|ue)g\w*|neue[nrs]?|aufnehm\w*|nimm\w*|speicher\w*)\b/i.test(frage)) return null;
    const j = await lesen(m, GAST_SYSTEM, frage, GAST_SCHEMA, verlauf);
    if (j?.aktion !== 'anlegen' || !imSatz(j.nachname, frage)) return null;
    const gross = (x: string) => x.split(/\s+/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
    const name = [imSatz(j.vorname, frage) ? gross(String(j.vorname).trim()) : '', gross(String(j.nachname).trim())].filter(Boolean).join(' ');
    const teile = [`Leg den Gast ${name} an`];
    if (imSatz(j.firma, frage)) teile.push(`Firma ${gross(String(j.firma).trim())}`);
    if (String(j.telefon || '').replace(/\D/g, '').length >= 6 && imSatz(String(j.telefon).replace(/\D/g, ''), frage.replace(/\D/g, ''))) teile.push(`Telefon ${String(j.telefon).trim()}`);
    if (/@/.test(String(j.email || '')) && imSatz(j.email, frage)) teile.push(String(j.email).trim());
    if (/\bvip\b/i.test(frage)) teile.push('VIP');
    if (/kindersitz/i.test(frage)) teile.push('Kindersitz');
    return teile.join(', ');
  }

  if (absicht === 'standby') {
    // "Tim soll morgen von 10 bis 18 am Bayerischen Hof bereitstehen": ohne das Wort Standby las es die Dienst-Regel.
    if (/\b(buch\w*|fahrt|abhol\w*)\b/i.test(frage)) return null;
    const j = await lesen(m, sys(STANDBY_SYSTEM), frage, STANDBY_SCHEMA, verlauf);
    if (!j) return null;
    const von = uhrOk(j.von);
    const bis = uhrOk(j.bis);
    if (!von || !/\d/.test(frage)) return null;
    const wer = namenText(ohneAusser(j.fahrer, ausser));
    const tag = datumOk(j.datum) ? (TAG_IM_SATZ.test(frage) ? tagPruefen(j.datum, frage, true) : jetztBerlin().datum) : jetztBerlin().datum;
    const ort = String(j.ort || '').trim();
    return `Standby am ${de(tag)} ${von}${bis ? `-${bis}` : ''}${ort ? ` am ${ort}` : ''}${wer ? ` für ${wer}` : ''}`;
  }

  if (absicht === 'dienst_loeschen') {
    const j = await lesen(m, sys(DIENST_LOESCHEN_SYSTEM), frage, DIENST_LOESCHEN_SCHEMA, verlauf);
    if (!j?.was) return null;
    const wort = { dienst: 'den Dienst', start: 'den Dienststart', ende: 'das Dienstende', pausen: 'die Pausen' }[String(j.was)] || 'den Dienst';
    const wer = namenText(ohneAusser(j.fahrer, ausser));
    const wann = j.woche === 'naechste' ? ' nächste Woche' : j.woche === 'diese' ? ' diese Woche' : datumOk(j.datum) ? ` am ${de(tagPruefen(j.datum, frage))}` : '';
    return `Lösche ${wort}${wer ? ` von ${wer}` : ''}${wann}`;
  }

  if (absicht === 'standby_aendern') {
    const j = await lesen(m, sys(STANDBY_AENDERN_SYSTEM), frage, STANDBY_AENDERN_SCHEMA, verlauf);
    if (!j?.aktion) return null;
    const wer = namenText(j.fahrer);
    const wann = datumOk(j.datum) ? ` am ${de(tagPruefen(j.datum, frage))}` : '';
    if (j.aktion === 'anzeigen') return `Welche Standbys gibt es${wann}${wer ? ` für ${wer}` : ''}?`;
    if (j.aktion === 'loeschen') return `Lösch den Standby${wer ? ` von ${wer}` : ''}${wann}`;
    const von = uhrOk(j.von);
    const bis = uhrOk(j.bis);
    return von && bis ? `Verschieb den Standby${wer ? ` von ${wer}` : ''}${wann} auf ${von} bis ${bis}` : null;
  }

  if (['fahrt_stornieren', 'fahrt_erledigt', 'fahrt_kopieren', 'fahrt_notiz'].includes(absicht)) {
    const j = await lesen(m, sys(FAHRT_SYSTEM), frage, FAHRT_SCHEMA, verlauf);
    if (!j) return null;
    const gast = String(j.gast || '').trim();
    const fahrer = String(j.fahrer || '').trim();
    const welche = `die Fahrt${gast ? ` von ${gast}` : fahrer ? ` von ${fahrer}` : ''}${datumOk(j.datum) ? ` am ${de(tagPruefen(j.datum, frage))}` : ''}${uhrOk(j.uhrzeit) ? ` um ${uhrOk(j.uhrzeit)}` : ''}`;
    if (welche === 'die Fahrt') return null;
    // Endgueltig loeschen nur, wenn es woertlich dasteht, nie nur weil das Modell es meint.
    if (absicht === 'fahrt_stornieren') return j.endgueltig && /endg(ü|ue)ltig|komplett|ganz\s+(weg|l(ö|oe)sch)/i.test(frage) ? `Lösche ${welche} endgültig` : `Storniere ${welche}`;
    if (absicht === 'fahrt_erledigt') return `Markiere ${welche} als erledigt`;
    if (absicht === 'fahrt_kopieren') return datumOk(j.zieldatum) ? `Kopiere ${welche} auf den ${de(j.zieldatum)}` : `Kopiere ${welche}`;
    return String(j.notiz || '').trim() ? `Setze eine Notiz zur ${welche.replace(/^die Fahrt/, 'Fahrt')}: ${String(j.notiz).trim()}` : null;
  }
  return null;
};
