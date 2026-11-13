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
"Paul: Gast kommt 10 Minuten später" -> ["Paul"] "Gast kommt 10 Minuten später."`;

const NACHRICHT_SCHEMA = {
  type: 'object',
  properties: { empfaenger: { type: 'array', items: { type: 'string' } }, text: { type: 'string' } },
  required: ['empfaenger', 'text'],
};

type Modell = { url: string; modell: string };

// Ein Aufruf mit Schema. null bei Fehler oder Zeitueberschreitung.
const lesen = async (m: Modell, system: string, nachricht: string, schema: any, verlauf: { role: string; text: string }[] = [], frist = 20000) => {
  try {
    const r = await fetch(`${m.url.replace(/\/$/, '')}/api/chat`, {
      method: 'POST',
      signal: AbortSignal.timeout(frist),
      body: JSON.stringify({
        model: m.modell, stream: false, format: schema, keep_alive: '60m', think: false,
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
    return JSON.parse(String(d?.message?.content || ''));
  } catch {
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

export const nachrichtLesen = async (m: Modell | null, frage: string): Promise<{ empfaenger: string[]; text: string } | null> => {
  if (!m?.url || !m.modell) return null;
  const j = await lesen(m, NACHRICHT_SYSTEM, frage, NACHRICHT_SCHEMA);
  if (!j || !Array.isArray(j.empfaenger)) return null;
  return { empfaenger: j.empfaenger.map((x: unknown) => String(x || '').trim()).filter(Boolean), text: String(j.text || '').trim() };
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

import { jetztBerlin, plusTage } from './dienst.ts';

const WT = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
// Kalender fuer das Modell: 7 Tage zurueck bis 21 Tage voraus, damit "Samstag", "gestern", "nächsten Dienstag" sicher werden.
const kalender = () => {
  const { datum: heute } = jetztBerlin();
  const zeilen: string[] = [];
  for (let i = -7; i <= 21; i += 1) {
    const d = plusTage(heute, i);
    const wt = WT[new Date(`${d}T12:00:00Z`).getUTCDay()];
    const name = i === 0 ? ' (heute)' : i === 1 ? ' (morgen)' : i === 2 ? ' (übermorgen)' : i === -1 ? ' (gestern)' : i === -2 ? ' (vorgestern)' : '';
    zeilen.push(`${d} ${wt}${name}`);
  }
  return `Kalender:\n${zeilen.join('\n')}\nEin Wochentag ohne Zusatz meint den nächsten (heute eingeschlossen), "letzten Montag" den vergangenen.`;
};

const DATUM = /^\d{4}-\d{2}-\d{2}$/;
const UHR = /^([01]\d|2[0-3]):[0-5]\d$/;
const datumOk = (d: unknown) => (DATUM.test(String(d || '')) ? String(d) : '');
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
  if (n.some((x) => /^(alle|allen|alle fahrer)$/i.test(x))) return 'alle Fahrer';
  return n.join(' und ');
};

const FAHRER_FELD = { type: 'array', items: { type: 'string' } };

const DIENST_SYSTEM = `Der Disponent setzt Dienstzeiten für Fahrer. Lies die Felder.
fahrer: Namen wie geschrieben, ["alle"] für alle Fahrer, [] wenn keiner genannt ist (dann gilt der Fahrer aus dem Gespräch).
tage: je genanntem Tag ein Eintrag. datum als JJJJ-MM-TT aus dem Kalender. Kein Tag genannt: heute.
  start: Dienststart als HH:MM, nur wenn als Start gemeint ("Dienststart", "fängt an", "ab", "kommt um", "beginnt", "von 7 bis 15" ist start 07:00).
  ende: Dienstende als HH:MM, nur wenn als Ende gemeint ("Feierabend", "Schluss", "bis", "hört auf", "Dienstende").
  pause_von, pause_bis: eine Pause als HH:MM, sonst leer. Pause ohne Ende: pause_bis leer.
  zeit_ohne_art: eine Uhrzeit, bei der nicht gesagt ist, ob Start oder Ende ("Tim heute 18 Uhr"), sonst leer.
  Feierabend ohne Uhrzeit: ende "jetzt".
  "halb 8" ist 07:30, "viertel nach 6" 06:15, "mittags" 12:00. Nachts nach Mitternacht bleibt der Tag.
Leere Felder als "".`;
const ZEIT = { type: 'string' };
const DIENST_SCHEMA = {
  type: 'object',
  properties: {
    fahrer: FAHRER_FELD,
    tage: { type: 'array', items: { type: 'object', properties: {
      datum: { type: 'string' }, start: ZEIT, ende: ZEIT, pause_von: ZEIT, pause_bis: ZEIT, zeit_ohne_art: ZEIT,
    }, required: ['datum', 'start', 'ende', 'pause_von', 'pause_bis', 'zeit_ohne_art'] } },
  },
  required: ['fahrer', 'tage'],
};

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
export const befehlAusFeldern = async (m: Modell | null, absicht: Absicht | null, frage: string, verlauf: { role: string; text: string }[] = []): Promise<string | null> => {
  if (!m?.url || !m.modell || !absicht) return null;
  const sys = (s: string) => `${s}\n\n${kalender()}`;

  if (absicht === 'dienst') {
    const j = await lesen(m, sys(DIENST_SYSTEM), frage, DIENST_SCHEMA, verlauf);
    const tage = (Array.isArray(j?.tage) ? j.tage : []).filter((t: any) => datumOk(t?.datum)).slice(0, 14);
    if (!tage.length) return null;
    const wer = namenText(j?.fahrer);
    // Start oder Ende nur, wenn es im Satz auch so steht. Sonst ist es eine Uhrzeit ohne Art, und die Regel
    // fragt bei einem vorhandenen Dienst nach (Start, Ende oder Pause?), statt dass das Modell raet.
    const t0 = frage.toLowerCase();
    const startWort = /start|beginn|anfang|fängt|faengt|\bab\b|kommt|\bvon\b|\d\s*(-|–|bis)\s*\d|schicht|arbeitet/.test(t0);
    const endeWort = /\bbis\b|ende|feierabend|schluss|aufh|hört|hoert|heim|hause|\d\s*(-|–)\s*\d/.test(t0);
    const teile = tage.map((t: any) => {
      let start = uhrOk(t.start);
      let ende = String(t.ende).trim().toLowerCase() === 'jetzt' ? 'jetzt' : uhrOk(t.ende);
      let ohneArt = uhrOk(t.zeit_ohne_art);
      if (start && !startWort && !ende) { ohneArt = ohneArt || start; start = ''; }
      if (ende && ende !== 'jetzt' && !endeWort && !start) { ohneArt = ohneArt || ende; ende = ''; }
      const pv = uhrOk(t.pause_von);
      const pb = uhrOk(t.pause_bis);
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

  if (absicht === 'dienst_loeschen') {
    const j = await lesen(m, sys(DIENST_LOESCHEN_SYSTEM), frage, DIENST_LOESCHEN_SCHEMA, verlauf);
    if (!j?.was) return null;
    const wort = { dienst: 'den Dienst', start: 'den Dienststart', ende: 'das Dienstende', pausen: 'die Pausen' }[String(j.was)] || 'den Dienst';
    const wer = namenText(j.fahrer);
    const wann = j.woche === 'naechste' ? ' nächste Woche' : j.woche === 'diese' ? ' diese Woche' : datumOk(j.datum) ? ` am ${de(j.datum)}` : '';
    return `Lösche ${wort}${wer ? ` von ${wer}` : ''}${wann}`;
  }

  if (absicht === 'standby_aendern') {
    const j = await lesen(m, sys(STANDBY_AENDERN_SYSTEM), frage, STANDBY_AENDERN_SCHEMA, verlauf);
    if (!j?.aktion) return null;
    const wer = namenText(j.fahrer);
    const wann = datumOk(j.datum) ? ` am ${de(j.datum)}` : '';
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
    const welche = `die Fahrt${gast ? ` von ${gast}` : fahrer ? ` von ${fahrer}` : ''}${datumOk(j.datum) ? ` am ${de(j.datum)}` : ''}${uhrOk(j.uhrzeit) ? ` um ${uhrOk(j.uhrzeit)}` : ''}`;
    if (welche === 'die Fahrt') return null;
    // Endgueltig loeschen nur, wenn es woertlich dasteht, nie nur weil das Modell es meint.
    if (absicht === 'fahrt_stornieren') return j.endgueltig && /endg(ü|ue)ltig|komplett|ganz\s+(weg|l(ö|oe)sch)/i.test(frage) ? `Lösche ${welche} endgültig` : `Storniere ${welche}`;
    if (absicht === 'fahrt_erledigt') return `Markiere ${welche} als erledigt`;
    if (absicht === 'fahrt_kopieren') return datumOk(j.zieldatum) ? `Kopiere ${welche} auf den ${de(j.zieldatum)}` : `Kopiere ${welche}`;
    return String(j.notiz || '').trim() ? `Setze eine Notiz zur ${welche.replace(/^die Fahrt/, 'Fahrt')}: ${String(j.notiz).trim()}` : null;
  }
  return null;
};
