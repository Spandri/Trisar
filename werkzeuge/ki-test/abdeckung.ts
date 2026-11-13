// Abdeckung: was der KI-Assistent von allem, was die Dispo kann, schon steuern kann.
// Je Funktion der Dispo ein typischer Satz. Kein Pass/Fail, sondern eine Liste zum Durchsehen.
// Jeder Satz laeuft fuer sich (neue Datenbank im Speicher, kein Verlauf). Braucht Ollama.
//
//   cd trisar && deno run -A werkzeuge/ki-test/abdeckung.ts --ollama=http://100.121.170.114:11434

// deno-lint-ignore-file no-explicit-any
import { antwortArt, kiFrage } from '../../fahrer/supabase/functions/dispo-admin/ki.ts';
import { SpeicherDb } from './speicherDb.ts';
import { testdaten } from './testdaten.ts';

const arg = (name: string, standard: string) => Deno.args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? standard;
const ollama = arg('ollama', 'http://localhost:11434');

const SAETZE: [string, string][] = [
  ['Fahrt', 'Storniere die Fahrt von Herrn Engel'],
  ['Fahrt', 'Lösche die Fahrt von Julia Weber'],
  ['Fahrt', 'Markiere die Fahrt von Herrn Engel als erledigt'],
  ['Fahrt', 'Kopiere die Fahrt von Julia Weber auf morgen'],
  ['Fahrt', 'Nimm Stefano von der Fahrt von Herrn Engel runter'],
  ['Fahrt', 'Gib der Fahrt von Herrn Engel die Notiz Kindersitz'],
  ['Fahrt', 'Welche Fahrten haben noch keinen Fahrer?'],
  ['Fahrt', 'Verteile alle offenen Fahrten von morgen auf die Fahrer'],
  ['Fahrt', 'Welche Fahrten sind heute verspätet?'],
  ['Fahrgast', 'Leg den Gast Uli Hoeneß an, Telefon 0170 1234567'],
  ['Fahrgast', 'Welche Telefonnummer hat Julia Weber?'],
  ['Fahrgast', 'Ändere die Telefonnummer von Julia Weber auf 0171 999888'],
  ['Kunde', 'Leg den Kunden BMW Group an'],
  ['Kunde', 'Welche Fahrten hatte der Kunde BMW diesen Monat?'],
  ['Ort', 'Leg den Ort Messe Eingang West an, Am Messesee 2 München'],
  ['Ort', 'Welche Orte haben wir?'],
  ['Fahrer', 'Ändere die Telefonnummer von Tim auf 0151 555666'],
  ['Fahrer', 'Setz das Passwort von Tim zurück'],
  ['Fahrer', 'Gib Marvin die Fahrernummer 20'],
  ['Fahrer', 'Markier Tim mit einer roten Flagge'],
  ['Fahrer', 'Wer ist gerade im Dienst?'],
  ['Fahrer', 'Wer ist gerade frei?'],
  ['Fahrer', 'Schreib allen Fahrern: Morgen Treffpunkt 7 Uhr Halle B'],
  ['Fahrer', 'Schick Tim eine Nachricht, dass er sich melden soll'],
  ['Fahrzeug', 'Ändere das Kennzeichen von M-TR 101 auf M-TR 111'],
  ['Fahrzeug', 'Wie viel Reichweite hat M-TR 102 noch?'],
  ['Fahrzeug', 'Welches Fahrzeug ist gerade frei?'],
  ['Tracker', 'Stell alle Tracker auf fein'],
  ['Tracker', 'Wo ist das Auto M-TR 103?'],
  ['Standby', 'Lösch den Standby von Tim morgen'],
  ['Standby', 'Welche Standbys gibt es morgen?'],
  ['Standby', 'Verschieb den Standby von Tim morgen auf 12 bis 20 Uhr'],
  ['Stunden', 'Bestätige den Stundenzettel von Marvin'],
  ['Stunden', 'Exportiere die Stunden vom Oktober'],
  ['Dienst', 'Plan die Dienste für nächste Woche, jeden Tag 7 bis 15 für Tim'],
  ['Dienst', 'Wer hat morgen Dienst?'],
  ['Dienst', 'Lösch alle Dienste von Tim nächste Woche'],
  ['Planung', 'Plane die Fahrten von morgen neu'],
  ['Planung', 'Wie viele Fahrer brauche ich morgen?'],
  ['Flug', 'Wann landet LH2034 heute?'],
  ['Flug', 'Ist der Flug von Herrn Engel verspätet?'],
  ['Allgemein', 'Was kannst du alles?'],
  ['Allgemein', 'Mach das rückgängig'],
];

for (const [bereich, satz] of SAETZE) {
  const db = new SpeicherDb(testdaten(ollama, 'llama3.1:8b'));
  let zeile: string;
  try {
    const r: any = await kiFrage(db as any, { frage: satz, kontext: null, karten: true }, 'dispo');
    const d = r?.daten || {};
    const karten = (Array.isArray(d.aktionen) ? d.aktionen : []).map((a: any) => a?.type).join(',');
    zeile = `${antwortArt(d, d?.kontext)}${karten ? ` [${karten}]` : ''} | ${String(d.answer || '').replace(/\s+/g, ' ').slice(0, 160)}`;
  } catch (e) {
    zeile = `ABSTURZ ${e instanceof Error ? e.message : e}`;
  }
  console.log(`${bereich.padEnd(9)} ${satz.padEnd(62)} -> ${zeile}`);
}
