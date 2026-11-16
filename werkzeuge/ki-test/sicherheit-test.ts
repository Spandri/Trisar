// Sicherheits-Sperren des KI-Assistenten (15.11.), ohne Modell, laeuft in Sekunden:
//   cd trisar && deno run -A werkzeuge/ki-test/sicherheit-test.ts
//
// Prueft, was nie passieren darf, wenn das Modell aus ist oder seine Frist reisst:
// - "alle außer X" wird nie zu "nur X" (Ausnahme-Sperre, ki.ts)
// - fehlt die Uhrzeit, setzt er nie still die aktuelle Uhrzeit ein (dienst.ts)
// - ab 3 Diensten loescht ein blosses "ja" nichts (dienstAendernKi.ts)

// deno-lint-ignore-file no-explicit-any
import './uhr.ts';
import { kiFrage } from '../../fahrer/supabase/functions/dispo-admin/ki.ts';
import { SpeicherDb } from './speicherDb.ts';
import { ID, tagBerlin, testdaten } from './testdaten.ts';

type Schritt = { frage: string; enthaelt?: string[]; nicht?: string[]; geloescht?: number; keinSchreiben?: boolean };
const faelle: { name: string; schritte: Schritt[] }[] = [
  { name: 'bis auf Stefano ohne Modell', schritte: [{ frage: 'Schick allen bis auf Stefano bitte ein dienstbeginn für heute 13:30 Uhr', enthaelt: ['rate ich nicht', 'nichts geändert'], nicht: ['senden?'] }] },
  { name: 'ausgenommen Marvin ohne Modell', schritte: [{ frage: 'Stundenlohn 25 Euro für alle Fahrer, ausgenommen Marvin', enthaelt: ['rate ich nicht'], nicht: ['für Marvin'] }] },
  { name: 'alle außer Tim ohne Modell', schritte: [{ frage: 'Schick alle Fahrer in den Feierabend außer Tim', enthaelt: ['rate ich nicht'] }] },
  { name: 'Ohne Ausnahme-Wort laeuft normal', schritte: [{ frage: 'Dienststart für alle Fahrer morgen um 10:30', enthaelt: ['10:30', 'senden?'], nicht: ['rate ich nicht'] }] },
  { name: 'Keine Uhrzeit, kein jetzt', schritte: [{ frage: 'tim soll morgen anfangen', enthaelt: ['wie viel Uhr'], nicht: ['11:0', '11:1'] }] },
  { name: 'Ende rausnehmen setzt keine Zeit', schritte: [{ frage: 'bei Anna morgen das Ende rausnehmen, die bleibt offen', enthaelt: ['nichts geändert'], nicht: ['Dienstende 1'] }] },
  { name: 'Feierabend heute ohne Zeit ist jetzt', schritte: [{ frage: 'schick Tim in den Feierabend', enthaelt: ['Dienstende', 'senden?'] }] },
  { name: 'Drei Dienste loeschen braucht ja, löschen', schritte: [
    { frage: 'Lösch morgen die Dienste von allen Fahrern', enthaelt: ['3 Dienste', 'ja, löschen'] },
    { frage: 'ja', enthaelt: ['Zur Sicherheit'], geloescht: 0 },
    { frage: 'ja, löschen', enthaelt: ['erledigt'], geloescht: 3 },
  ] },
  // Bestaetigungs-Sperre (15.11., Haertetest): ein neuer Satz ist kein "ja" zur offenen Rueckfrage.
  { name: 'Neuer Auftrag loescht keinen Dienst', schritte: [
    { frage: 'Lösch den Dienst von Anna morgen', enthaelt: ['löschen?'] },
    { frage: 'Bitte gib Tim morgen 7 Uhr Dienststart', enthaelt: ['verworfen'], nicht: ['gelöscht'], keinSchreiben: true },
  ] },
  { name: 'Frage speichert keinen Stundenlohn', schritte: [
    { frage: 'Stundenlohn 30 Euro für alle Fahrer', enthaelt: ['speichern?'] },
    { frage: 'Passt das mit Tim morgen um 8?', nicht: ['Gespeichert'], keinSchreiben: true },
  ] },
  { name: 'Anderes Loeschen bestaetigt nicht', schritte: [
    { frage: 'Lösch den Dienst von Anna morgen' },
    { frage: 'Lösch alle Gäste', nicht: ['Dienst gelöscht'], keinSchreiben: true },
  ] },
  { name: 'Schick ist kein ja zur Nachricht', schritte: [
    { frage: 'Schreib allen: morgen Westen anziehen', enthaelt: ['Push an alle'] },
    { frage: 'Schick Tim in den Feierabend', nicht: ['Gesendet'], keinSchreiben: true },
  ] },
  { name: 'Echtes ja mit Tu-Wort bestaetigt weiter', schritte: [
    { frage: 'Lösch den Dienst von Anna morgen' },
    { frage: 'ja bitte löschen', enthaelt: ['erledigt'], geloescht: 1 },
  ] },
  { name: 'Unmoegliche Uhrzeit', schritte: [{ frage: 'Dienststart für Tim morgen um 25 Uhr', enthaelt: ['gibt es nicht', 'nichts geändert'], keinSchreiben: true }] },
  { name: 'Unmoegliches Datum', schritte: [{ frage: 'Tim Dienststart am 30.02. um 8', enthaelt: ['30.02. gibt es nicht'] }] },
  { name: 'Pause endet vor Beginn', schritte: [{ frage: 'Pause für Anna morgen von 12 bis 11', enthaelt: ['vor ihrem Beginn'] }] },
  { name: 'Geldbetrag ist keine Uhrzeit', schritte: [{ frage: 'Stundenlohn 22.50 Euro für Tim', enthaelt: ['22,50'] }] },
  // 16.11.: 24 Uhr, Fahrzeug nach Marke, Fragen ohne Bezug.
  { name: '24 Uhr als Ende ist Mitternacht', schritte: [{ frage: 'Dienstende für Tim heute 24 Uhr', enthaelt: ['Dienstende 00:00', 'senden?'] }] },
  { name: 'Bis 24 behaelt das Ende', schritte: [{ frage: 'Dienst für Tim morgen von 16 bis 24 Uhr', enthaelt: ['16:00', '00:00'] }] },
  { name: '24 Uhr als Beginn fragt nach', schritte: [{ frage: 'Dienststart für Tim morgen um 24 Uhr', enthaelt: ['nicht eindeutig', 'nichts geändert'], keinSchreiben: true }] },
  { name: '24 Euro bleibt Geld', schritte: [{ frage: 'Stundenlohn 24 Euro für Tim', enthaelt: ['24,00'] }] },
  { name: 'Marke mit zwei Fahrzeugen fragt nach', schritte: [
    { frage: 'Gib Tim den BMW', enthaelt: ['Welches Fahrzeug', 'M-TR 101', 'M-TR 103'], nicht: ['Fahrt'], keinSchreiben: true },
    { frage: 'den X5', enthaelt: ['Tim Schedler bekommt BMW X5', 'ja'], keinSchreiben: true },
    { frage: 'ja', enthaelt: ['Gespeichert'] },
  ] },
  { name: 'Fahrzeugwahl gilt nicht fuer neuen Satz', schritte: [
    { frage: 'Gib Tim den BMW', enthaelt: ['Welches Fahrzeug'] },
    { frage: 'schick Tim in den Feierabend', enthaelt: ['Dienstende', 'senden?'], nicht: ['Welches Fahrzeug'] },
    { frage: 'den X5', nicht: ['bekommt BMW X5'], keinSchreiben: true },
  ] },
  { name: 'Marke mit einem Fahrzeug gilt', schritte: [{ frage: 'Gib Anna den Mercedes', enthaelt: ['Anna Berger bekommt Mercedes V-Klasse (M-TR 102)'], keinSchreiben: true }] },
  { name: 'Waschen ist kein Zuordnen', schritte: [{ frage: 'Tim soll den BMW waschen', nicht: ['Welches Fahrzeug', 'bekommt'] }] },
  { name: 'Frage ohne Bezug raet nicht', schritte: [{ frage: 'Was macht der gerade', enthaelt: ['Wen meinst du'], nicht: ['Stefano', 'Tim', 'Anna', 'Marvin'] }] },
  { name: 'Sie ohne Bezug raet nicht', schritte: [{ frage: 'Hat sie schon Feierabend', enthaelt: ['Wen meinst du'], nicht: ['Anna'] }] },
  { name: 'Unbekannter Name ist nicht der letzte Fahrer', schritte: [
    { frage: 'Wo ist Tim gerade', enthaelt: ['Tim Schedler'] },
    { frage: 'Wo ist der Band gerade', enthaelt: ['„Band“ finde ich nicht'], nicht: ['Tim Schedler'] },
    { frage: 'Und wo ist er jetzt', enthaelt: ['Tim Schedler'] },
  ] },
  { name: 'Fahrzeug-Frage aus den Daten, nein', schritte: [{ frage: 'Bekommt Tim den BMW', enthaelt: ['Nein, Tim Schedler fährt Mercedes V-Klasse (M-TR 102)', 'BMW 7er (M-TR 101) fährt Stefano Spandri'], keinSchreiben: true }] },
  { name: 'Fahrzeug-Frage aus den Daten, ja', schritte: [{ frage: 'Fährt Tim den Mercedes?', enthaelt: ['Ja, Tim Schedler fährt Mercedes V-Klasse (M-TR 102)'] }] },
  { name: 'Wer faehrt das Modell', schritte: [{ frage: 'Wer fährt den X5', enthaelt: ['BMW X5 (M-TR 103) fährt Anna Berger'] }] },
  { name: 'Kein Dienst, klarer Satz', schritte: [{ frage: 'Lösch den Dienst von Marvin heute', enthaelt: ['Marvin Keller hat heute keinen Dienst'], nicht: ['Keiner der Fahrer'] }] },
  { name: 'Ein Dienst loeschen geht mit ja', schritte: [
    { frage: 'Lösch den Dienst von Anna morgen' },
    { frage: 'ja', enthaelt: ['erledigt'], geloescht: 1 },
  ] },
];

let ok = 0;
for (const fall of faelle) {
  // Ohne Modell: falsche Adresse, kein Verstehen-Modell.
  const daten: any = testdaten('http://127.0.0.1:9', 'kein', '');
  const morgen = tagBerlin(1);
  daten.driver_service_requests.push(
    { id: 'dienst-tim-morgen', driver_id: ID.tim, service_date: morgen, service_start_time: '08:00:00', service_end_time: '16:00:00', status: 'accepted', created_at: new Date().toISOString() },
    { id: 'dienst-marvin-morgen', driver_id: ID.marvin, service_date: morgen, service_start_time: '09:00:00', service_end_time: '17:00:00', status: 'pending', created_at: new Date().toISOString() },
  );
  const db = new SpeicherDb(daten);
  let kontext: any = null;
  const fehler: string[] = [];
  for (const s of fall.schritte) {
    const vorher = db.schreibLog.length;
    const d: any = (await kiFrage(db, { aktion: 'ki_frage', frage: s.frage, verlauf: [], kontext, offenerVorschlag: null, letzteFahrtId: null, markierteFahrer: [] }, ID.dispo)).daten;
    kontext = d?.kontext ?? kontext;
    const antwort = String(d?.answer || '');
    const klein = antwort.toLowerCase();
    for (const w of s.enthaelt || []) if (!klein.includes(w.toLowerCase())) fehler.push(`„${s.frage}“ fehlt „${w}“: ${antwort.slice(0, 160)}`);
    for (const w of s.nicht || []) if (klein.includes(w.toLowerCase())) fehler.push(`„${s.frage}“ enthält „${w}“: ${antwort.slice(0, 160)}`);
    if (s.keinSchreiben) {
      const w = db.schreibLog.slice(vorher).filter((l) => l.tabelle !== 'ki_protokoll');
      if (w.length) fehler.push(`„${s.frage}“ hat geschrieben: ${w.map((l) => `${l.art} ${l.tabelle}`).join(', ')}`);
    }
    if (s.geloescht !== undefined) {
      const n = db.schreibLog.slice(vorher).filter((l) => l.tabelle === 'driver_service_requests').length;
      if ((s.geloescht === 0 && n) || (s.geloescht > 0 && n < s.geloescht)) fehler.push(`„${s.frage}“ ${n} Schreibzugriffe statt ${s.geloescht}`);
    }
  }
  if (fehler.length) console.log(`✗ ${fall.name}\n   ${fehler.join('\n   ')}`);
  else { ok += 1; console.log(`✓ ${fall.name}`); }
}
console.log(`\n${ok}/${faelle.length} Sicherheitsfälle bestanden`);
if (ok < faelle.length) Deno.exit(1);
