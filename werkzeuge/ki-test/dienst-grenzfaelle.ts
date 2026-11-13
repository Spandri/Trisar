// Grenzfaelle fuer Dienststart/Dienstende: zeigt je Satz, was die Dienst-Regel daraus macht.
// Kein Pass/Fail, sondern eine Liste zum Durchsehen. Daten wie im KI-Testsatz:
// Stefano heute Dienst ab 08:00, Anna morgen 07:00–15:00, Tim und Marvin ohne Dienst.
//
//   cd trisar && deno run -A werkzeuge/ki-test/dienst-grenzfaelle.ts

// deno-lint-ignore-file no-explicit-any
import { kiFrage } from '../../fahrer/supabase/functions/dispo-admin/ki.ts';
import { SpeicherDb } from './speicherDb.ts';
import { testdaten } from './testdaten.ts';

const SAETZE = [
  // Start
  'Tim Dienststart morgen 7 Uhr', 'Tim fängt morgen um 7 an', 'Tim morgen ab 7', 'Tim morgen 7 Uhr', 'Schick Tim morgen um 7',
  'Tim soll morgen um 7 starten', 'Tim morgen früh um 7 beginnen', 'Dienstbeginn Tim morgen 7:15', 'Tim kommt morgen um 7',
  'Tim arbeitet morgen ab 7',
  // Ende
  'Tim Dienstende morgen 16 Uhr', 'Tim morgen Feierabend um 16', 'Tim hört morgen um 16 auf', 'Tim morgen bis 16 Uhr',
  'Tim soll morgen um 16 heimfahren', 'Schick Tim nach Hause', 'Tim morgen Schluss um 16',
  // Start und Ende
  'Tim morgen 7 bis 16', 'Tim morgen von 7 bis 16 Uhr', 'Tim morgen 7-16', 'Tim arbeitet morgen von 7 bis 16',
  'Dienststart 7 und Dienstende 16 für Tim morgen', 'Tim morgen Start 7 Ende 16',
  // Vorhandener Dienst (Stefano heute ab 08:00, Anna morgen 07:00–15:00)
  'Stefano heute 18 Uhr', 'Stefano heute bis 18 Uhr', 'Stefano Dienstende heute 18 Uhr', 'Stefano heute Feierabend',
  'Stefano heute 6 Uhr', 'Stefano Dienststart heute 9 Uhr', 'Anna morgen 17 Uhr', 'Anna morgen bis 17 Uhr',
  'Anna morgen 12 Uhr', 'Anna Dienstende morgen 13 Uhr', 'Anna morgen 6 Uhr', 'Anna Dienststart morgen 8',
  'Anna morgen 1 Uhr nachts', 'Stefano heute bis 2 Uhr nachts',
  // Relativ und ungewoehnlich
  'Tim fängt in 30 Minuten an', 'Tim Feierabend in einer Stunde', 'Tim heute halb 8', 'Tim heute 7.30',
  'Tim nächsten Montag 7 Uhr', 'Tim am 20.11. 7 bis 15', 'Tim und Marvin morgen 6 bis 14', 'Alle Fahrer morgen 8 Uhr Dienststart',
  'Tim morgen 22 bis 6', 'Tim morgen Nachtschicht 22 bis 6',
  // Sollen KEIN Dienst sein
  'Tim morgen um 7 zum Flughafen', 'Tim morgen 7 Uhr vom Hotel zum Bahnhof', 'Wann fängt Tim morgen an?',
  'Hat Anna morgen Dienst?', 'Ende in München für Tim morgen 9 Uhr', 'Neue Fahrt Tim morgen 7 Start Bahnhof Ende Messe',
];

const db = new SpeicherDb(testdaten('http://127.0.0.1:1', 'aus'));
for (const satz of SAETZE) {
  const r: any = await kiFrage(db as any, { frage: satz, kontext: null }, 'dispo');
  const d = r?.daten || {};
  const v = d?.action?.vorschlag;
  const was = v
    ? `DIENST ${v.datum} start=${v.start ?? '-'} ende=${v.ende ?? '-'}${v.pausen?.length ? ` pause=${v.pausen.map((p: any) => `${p.von}-${p.bis}`).join(',')}` : ''} | ${String(d.answer).slice(0, 110)}`
    : `${d?.action?.type || (d?.meta?.nichtErreichbar ? 'ZUM MODELL' : 'ANTWORT')} | ${String(d.answer || '').slice(0, 110)}`;
  console.log(`${satz.padEnd(48)} -> ${was}`);
}
