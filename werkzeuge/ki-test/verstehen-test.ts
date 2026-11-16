// Testsatz fuer das Verstehen per Modell (dispo-admin/verstehen.ts): Absicht und Nachrichten-Felder
// aus frei formulierten Saetzen. Echte Saetze aus ki_protokoll plus bewusst schraege Formulierungen.
//
//   cd trisar && deno run -A werkzeuge/ki-test/verstehen-test.ts --modell=qwen3:14b --ollama=http://100.121.170.114:11434
//   ... --nur=nachricht      nur Saetze mit dieser erwarteten Absicht
//
// Gibt je Fehler eine Zeile aus und am Ende Treffer, Dauer im Schnitt und die schlimmsten Verwechslungen.

// deno-lint-ignore-file no-explicit-any
import { absichtLesen, absichtMitAusnahmen, nachrichtLesen } from '../../fahrer/supabase/functions/dispo-admin/verstehen.ts';

const arg = (n: string, s: string) => Deno.args.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3) ?? s;
const modell = arg('modell', 'qwen2.5:14b');
const url = arg('ollama', 'http://localhost:11434');
const nur = arg('nur', '');

// [Satz, erwartete Absicht(en), bei nachricht: Empfaenger (Teilstring), Wort im Text]
type Fall = [string, string | string[], string[]?, string?];
const F: Fall[] = [
  // --- Nachricht ---
  ['Schicke eine Nachricht an Stefano: beeil dich bitte', 'nachricht', ['Stefano'], 'beeil'],
  ['stefano soll sich beeilen, sag ihm das mal', 'nachricht', ['Stefano'], 'beeil'],
  ['kannst du tim mitteilen dass der gast 10 min später kommt', 'nachricht', ['Tim'], '10'],
  ['an alle: morgen treffpunkt 7 uhr halle b', 'nachricht', ['alle'], 'halle b'],
  ['Gib Anna Bescheid, sie soll zum Terminal 2 fahren', 'nachricht', ['Anna'], 'terminal 2'],
  ['Push an Marvin und Tim: bitte tanken', 'nachricht', ['Marvin', 'Tim'], 'tank'],
  ['Erinner Stefano daran, das Kennzeichen-Foto hochzuladen', 'nachricht', ['Stefano'], 'foto'],
  ['tim melde dich mal bei mir', 'nachricht', ['Tim'], 'meld'],
  ['Schreib allen Fahrern, dass heute Abend Weihnachtsfeier ist', 'nachricht', ['alle'], 'weihnachtsfeier'],
  ['Schreib allen Fahrern: Morgen Treffpunkt 7 Uhr Halle B', 'nachricht', ['alle'], 'treffpunkt'],
  ['Schick Tim eine Nachricht, dass er sich melden soll', 'nachricht', ['Tim'], 'meld'],
  ['Sag Marvin, der Gast steht am Ausgang B', 'nachricht', ['Marvin'], 'ausgang b'],
  ['Informier bitte alle, dass die Messe heute früher schließt', 'nachricht', ['alle'], 'messe'],
  ['Anna soll mich zurückrufen', 'nachricht', ['Anna'], 'zurück'],
  ['Teil Stefano mit, dass sein Gast VIP ist', 'nachricht', ['Stefano'], 'vip'],
  ['frag tim ob er heute länger kann', 'nachricht', ['Tim'], 'länger'],
  ['Nachricht an alle Fahrer: Bitte Westen tragen', 'nachricht', ['alle'], 'westen'],
  ['Kannst du Marvin ausrichten, dass er zum Hotel Vier Jahreszeiten soll?', 'nachricht', ['Marvin'], 'vier jahreszeiten'],
  ['Stefano: Gast verspätet sich um 20 Minuten', 'nachricht', ['Stefano'], '20'],
  ['an tim und anna - bitte handy laden', 'nachricht', ['Tim', 'Anna'], 'handy'],
  ['Schick Tim eine Nachricht', 'nachricht', ['Tim'], ''],
  ['Gib allen durch, dass es heute Abend schneit', 'nachricht', ['alle'], 'schne'],
  // --- Fahrt neu ---
  ['Neue Fahrt Stefano am Samstag um 11:58 Start in Offenburg am Bahnhof, Ende in München Möhlstr 31', 'fahrt_neu'],
  ['Buch Tim morgen um 7 vom Hotel zum Flughafen', 'fahrt_neu'],
  ['Schick Stefano morgen um 7 zum Flughafen', 'fahrt_neu'],
  ['Erstelle eine Fahrt von Salzburg Flughafen zum Herbert von Karajan Platz in Salzburg. Morgen um 11:30 landet der Flieger mit der Kennung KK7150', 'fahrt_neu'],
  ['Schicke Stefano Spandri eine Fahrt für morgen 10:30 Uhr vom Hotel bayerischen Hof zur Allianz Arena mit dem Gast Uli Hoeneß', 'fahrt_neu'],
  ['Schick Stefano Spandri eine Fahrt von Kreillerstraße 210 zur Erner Straße 5 für jetzt', 'fahrt_neu'],
  ['Fahrt Stefano von Brudermühlstraße 2, 81371 München zu Ernastraße 5 91927 Trudering', 'fahrt_neu'],
  ['Hol Herrn Engel morgen um 9 am Hauptbahnhof ab und bring ihn zur Messe', 'fahrt_neu'],
  ['Ich brauch morgen früh um 6 ein Auto vom Bayerischen Hof zum Flughafen', 'fahrt_neu'],
  ['Erstelle eine Fahrt mit allen Fahrern morgen vom Flughafen Salzburg zum Herbert von Karajan Platz um 11:30', 'fahrt_neu'],
  ['3 Gäste um 14 Uhr vom Terminal 2 ins Hotel Vier Jahreszeiten', 'fahrt_neu'],
  ['Transfer morgen 8:15 Messe → Marienplatz für Frau Müller', 'fahrt_neu'],
  ['Kannst du für Freitag eine Abholung am Flughafen um 16 Uhr anlegen, Ziel Bayerischer Hof', 'fahrt_neu'],
  ['Morgen um 10 Abholung Hotel Mandarin Oriental, dann zur Allianz Arena', 'fahrt_neu'],
  ['Buch mir für Freitag 8 Uhr eine Fahrt vom Flughafen T2 in die Messe', 'fahrt_neu'],
  ['Flug LH2034 landet morgen 15:10, Gast Weber ins Hotel, Tim fährt', 'fahrt_neu'],
  // --- Fahrt aendern / stornieren / erledigt / kopieren / notiz ---
  ['Verschieb die Fahrt von Herrn Engel auf 11 Uhr', 'fahrt_aendern'],
  ['Setz Tim auf die Fahrt von Frau Müller', 'fahrt_aendern'],
  ['Nimm Stefano von der Fahrt von Herrn Engel runter', 'fahrt_aendern'],
  ['Ändere bei der Fahrt von Julia Weber das Ziel auf Terminal 1', 'fahrt_aendern'],
  ['Die Fahrt um 14 Uhr bitte eine halbe Stunde später', 'fahrt_aendern'],
  ['Buch auf die Fahrt alle Fahrer', 'fahrt_aendern'],
  ['Storniere die Fahrt von Herrn Engel', 'fahrt_stornieren'],
  ['Die Fahrt von Julia Weber fällt aus', 'fahrt_stornieren'],
  ['Lösche die Fahrt von Julia Weber', 'fahrt_stornieren'],
  ['Herr Engel braucht morgen doch keine Fahrt, bitte absagen', 'fahrt_stornieren'],
  ['Markiere die Fahrt von Herrn Engel als erledigt', 'fahrt_erledigt'],
  ['Die Fahrt von Frau Müller ist durch', 'fahrt_erledigt'],
  ['Kopiere die Fahrt von Julia Weber auf morgen', 'fahrt_kopieren'],
  ['Die Fahrt von Herrn Engel bitte nochmal für Freitag', 'fahrt_kopieren'],
  ['Gib der Fahrt von Herrn Engel die Notiz Kindersitz', 'fahrt_notiz'],
  ['Schreib an die Fahrt von Frau Müller: Gast hat Rollstuhl', 'fahrt_notiz'],
  // --- Dienst ---
  ['Schick Tim morgen um 7', 'dienst'],
  ['Stefano heute Feierabend um 18 Uhr', 'dienst'],
  ['Neuer dienststart für heute 22:00 für Stefano Spandri', 'dienst'],
  ['Neuer dienststart für heute 22:00 und Samstag 7:30 für Stefano Spandri', 'dienst'],
  ['Wir sagen schick Stefano Spandri für morgen wir 7:30 Uhr ein Dienstbeginn', 'dienst'],
  ['Schick Stefano dienstart für 9:00 Uhr morgen', 'dienst'],
  ['Dann schick dienstart für 9:00 Uhr', 'dienst'],
  ['Für alle Fahrer Dienstbeginn um 10:45 morgen am Flughafen Salzburg', 'dienst'],
  ['Neues Dienstende für Stefano um 00:00', 'dienst'],
  ['Schick Stefano Feierabend', 'dienst'],
  ['Schick Stefano für morgen eine Pause von 12:00-17:00 Uhr', 'dienst'],
  ['Tim kommt morgen um 7', 'dienst'],
  ['Tim morgen bis 16 Uhr', 'dienst'],
  ['Tim und Marvin morgen 6 bis 14', 'dienst'],
  ['Plan die Dienste für nächste Woche, jeden Tag 7 bis 15 für Tim', 'dienst'],
  ['Anna hört heute um 15 auf', 'dienst'],
  ['schick die alle in Feierabend', 'dienst'],
  ['Marvin fängt morgen um 6 an', 'dienst'],
  ['Pause für Anna morgen 12-13', 'dienst'],
  ['Tim nächste Woche werktags 8 bis 16', 'dienst'],
  ['Stefano soll heute um 17 Uhr Schluss machen', 'dienst'],
  // --- Dienst loeschen ---
  ['Lösch das Dienstende für Samstag Stefano', 'dienst_loeschen'],
  ['Dienst von Anna morgen absagen', 'dienst_loeschen'],
  ['Pause von Anna morgen löschen', 'dienst_loeschen'],
  ['Lösch alle Dienste von Tim nächste Woche', 'dienst_loeschen'],
  ['Tim hat morgen doch frei, streich den Dienst', 'dienst_loeschen'],
  // --- Standby ---
  ['Standby morgen 10 bis 18 am Kongress für Tim', 'standby'],
  ['Tim soll morgen von 9 bis 12 am Flughafen in Bereitschaft stehen', 'standby'],
  ['Lösch den Standby von Tim morgen', 'standby_aendern'],
  ['Verschieb den Standby von Tim morgen auf 12 bis 20 Uhr', 'standby_aendern'],
  ['Welche Standbys gibt es morgen?', ['standby_aendern', 'frage']],
  // --- Anlegen / Loeschen / Zuordnen / Bearbeiten ---
  ['Leg Fahrer Max Mustermann an, Nummer 14', 'fahrer_anlegen'],
  ['Füge Stefano Spandri als neuen Fahrer hinzu', 'fahrer_anlegen'],
  ['Marvin Bendrix Gregor Müller Tim Boberschmidt bitte all diese Fahrer als neue Fahrer einrichten', 'fahrer_anlegen'],
  ['Neues Fahrzeug Mercedes V-Klasse, Kennzeichen M-TR 105, 7 Sitze', 'fahrzeug_anlegen'],
  ['Erstelle allen Fahrern ein Fahrzeug. Alles Mercedes V Klasse', 'fahrzeug_anlegen'],
  ['Lösche den Fahrer Max Mustermann', 'loeschen'],
  ['Lösch mal bitte das Auto M-TR 105', 'loeschen'],
  ['Gib Tim das Fahrzeug M-TR 105', 'zuordnen'],
  ['Tracker 3 ins Auto M-TR 101', 'zuordnen'],
  ['Ändere die Telefonnummer von Tim auf 0151 555666', 'bearbeiten'],
  ['Gib Marvin die Fahrernummer 20', 'bearbeiten'],
  ['Markier Tim mit einer roten Flagge', 'bearbeiten'],
  ['Setz das Passwort von Tim zurück', 'bearbeiten'],
  ['Ändere das Kennzeichen von M-TR 101 auf M-TR 111', 'bearbeiten'],
  ['Stell alle Tracker auf fein', 'tracker'],
  ['Leg den Gast Uli Hoeneß an, Telefon 0170 1234567', 'gast'],
  ['Ändere die Telefonnummer von Julia Weber auf 0171 999888', ['gast', 'bearbeiten']],
  ['Leg den Ort Messe Eingang West an, Am Messesee 2 München', 'ort'],
  ['Bestätige den Stundenzettel von Marvin', 'stunden'],
  ['Exportiere die Stunden vom Oktober', 'stunden'],
  ['Geb allen Fahrern eine Stundenlohn von 30€', 'lohn'],
  ['Setze Tim auf 28,50 Euro Stundenlohn', 'lohn'],
  // --- Fragen ---
  ['Wo ist Stefano gerade?', 'frage'],
  ['Wo sind die drei gerade', 'frage'],
  ['Wann fängt Tim morgen an?', 'frage'],
  ['Hat Anna morgen Dienst?', 'frage'],
  ['Wer hat morgen Dienst?', 'frage'],
  ['Hat Stefano morgen eine Pause eingetragen?', 'frage'],
  ['Welche Fahrten haben noch keinen Fahrer?', 'frage'],
  ['Welche Fahrten sind heute verspätet?', 'frage'],
  ['Wann landet LH2034 heute?', 'frage'],
  ['Ist der Flug von Herrn Engel verspätet?', 'frage'],
  ['Wie viele Fahrer brauche ich morgen?', 'frage'],
  ['Welches Fahrzeug ist gerade frei?', 'frage'],
  ['Wie viel Reichweite hat M-TR 102 noch?', 'frage'],
  ['Welche Telefonnummer hat Julia Weber?', 'frage'],
  ['Sag mir wann Tim morgen anfängt', 'frage'],
  ['Wie viele Stunden hat Marvin diese Woche gearbeitet?', 'frage'],
  ['Welche Fahrten hatte der Kunde BMW diesen Monat?', 'frage'],
  ['Was macht Tim gerade?', 'frage'],
  ['Wo ist Joris', 'frage'],
  // --- Allgemein ---
  ['Mach das rückgängig', 'rueckgaengig'],
  ['Was kannst du alles?', 'hilfe'],
  ['ja', 'sonstiges'],
  ['danke dir', 'sonstiges'],
];

// Ungesehene Saetze (--neu): erst nach dem Schaerfen der Anleitung geschrieben, fuer einen ehrlichen Vergleich.
const NEU: Fall[] = [
  ['richte marvin aus er soll sein handy anmachen', 'nachricht', ['Marvin'], 'handy'],
  ['Alle Fahrer bitte um 18 Uhr zur Besprechung in die Zentrale', 'nachricht', ['alle'], 'besprechung'],
  ['Kann Anna Bescheid kriegen dass Gate geändert wurde, jetzt B12', 'nachricht', ['Anna'], 'b12'],
  ['ping stefano, gast wartet schon', 'nachricht', ['Stefano'], 'wartet'],
  ['Tim und Marvin sollen nach der Fahrt tanken', 'nachricht', ['Tim', 'Marvin'], 'tank'],
  ['Mitteilung an Stefano: Parkticket liegt im Handschuhfach', 'nachricht', ['Stefano'], 'parkticket'],
  ['sag anna danke für heute', 'nachricht', ['Anna'], 'danke'],
  ['Bitte gib an alle weiter, Kontrolle der Reifen morgen früh', 'nachricht', ['alle'], 'reifen'],
  ['Morgen 6:45 Abholung Frau Schmid am Rosenheimer Platz, Ziel Flughafen Terminal 1', 'fahrt_neu'],
  ['Stefano soll um 15 Uhr den Gast vom Hilton zum Hauptbahnhof bringen', 'fahrt_neu'],
  ['leg mir für übermorgen eine fahrt an, 9 uhr, messe nach marienplatz', 'fahrt_neu'],
  ['Gast Weber kommt mit LH 1835 um 17:20 an, bitte abholen und ins Hotel bringen', 'fahrt_neu'],
  ['Brauche heute Abend um 20 Uhr einen Wagen vom Restaurant Tantris nach Hause zu Herrn Engel, Leopoldstr 10', 'fahrt_neu'],
  ['Mach aus der Fahrt von Frau Schmid 7 Uhr statt 6:45', 'fahrt_aendern'],
  ['Bei der Fahrt um 15 Uhr bitte Anna statt Stefano', 'fahrt_aendern'],
  ['Herr Engel fährt doch zum Terminal 2, nicht Terminal 1', 'fahrt_aendern'],
  ['Die Abholung von Frau Schmid entfällt', 'fahrt_stornieren'],
  ['Fahrt Hilton → Hauptbahnhof canceln', 'fahrt_stornieren'],
  ['Fahrt von Herrn Engel ist abgeschlossen', 'fahrt_erledigt'],
  ['Mach die gleiche Fahrt wie heute nochmal am Montag', 'fahrt_kopieren'],
  ['Tim fängt übermorgen um halb sechs an', 'dienst'],
  ['Anna hat morgen von 8 bis 16 Uhr Schicht', 'dienst'],
  ['Marvin morgen ab Mittag', 'dienst'],
  ['Stefano heute schon um 15 Uhr Schluss', 'dienst'],
  ['Pause für Tim heute 13 bis 13:30', 'dienst'],
  ['Den Dienst von Marvin am Freitag bitte rausnehmen', 'dienst_loeschen'],
  ['Annas Pause heute ist gestrichen', 'dienst_loeschen'],
  ['Anna soll morgen ab 14 Uhr am Hauptbahnhof bereitstehen bis 18 Uhr', 'standby'],
  ['Standby von Marvin am Flughafen auf 15 bis 19 Uhr verschieben', 'standby_aendern'],
  ['Neuer Fahrer: Lena Hoffmann, Telefon 0160 1234567', 'fahrer_anlegen'],
  ['Wir haben einen neuen BMW 5er, Kennzeichen M-TR 220', 'fahrzeug_anlegen'],
  ['Fahrer Lena Hoffmann wieder entfernen', 'loeschen'],
  ['Lena fährt ab jetzt den BMW M-TR 220', 'zuordnen'],
  ['Lenas Nummer ist jetzt 0171 7654321', 'bearbeiten'],
  ['Stell den Tracker 3 auf sparsam', 'tracker'],
  ['Wo steckt Marvin?', 'frage'],
  ['Wer fährt morgen die Fahrt um 6:45?', 'frage'],
  ['Wie lange arbeitet Anna heute noch?', 'frage'],
  ['Ist LH1835 pünktlich?', 'frage'],
  ['Was steht heute noch an?', 'frage'],
];

// Ausnahmen (14.11.): wer ausgenommen ist, frei formuliert. Leere Liste: niemand darf ausgenommen sein.
//   deno run -A werkzeuge/ki-test/verstehen-test.ts --ausser --ollama=...
const AUSSER: [string, string[]][] = [
  ['Schick allen bis auf Stefano bitte ein dienstbeginn für heute 13:30 Uhr', ['Stefano']],
  ['Alle außer Tim haben morgen ab 7 Dienst', ['Tim']],
  ['Sag allen außer Tim und Marvin, dass sie tanken sollen', ['Tim', 'Marvin']],
  ['Feierabend für alle, nur Marvin nicht', ['Marvin']],
  ['Jeder fängt morgen um 8 an, Stefano ausgenommen', ['Stefano']],
  ['Schreib allen ohne Anna: Treffpunkt Halle B', ['Anna']],
  ['Alle bis auf Tim und Lisa in den Feierabend schicken', ['Tim', 'Lisa']],
  ['Stundenlohn 18 Euro für alle, ausgenommen Marvin', ['Marvin']],
  ['Lösch die Dienste morgen von allen außer Stefano', ['Stefano']],
  ['Schick alle in Feierabend außer den markierten', ['markiert']],
  ['allen fahrern dienstbeginn 6 uhr morgen nur der stefano nicht der hat frei', ['Stefano']],
  ['Bestätige alle offenen Stundenzettel außer den von Tim', ['Tim']],
  // ohne Ausnahme
  ['Schick allen Fahrern Dienstbeginn morgen 7 Uhr', []],
  ['Lösch den Fahrer Paul Berg', []],
  ['Stefano hat heute frei, lösch seinen Dienst', []],
  ['Neue Fahrt ohne Fahrer morgen 9 Uhr Hauptbahnhof zur Messe', []],
  ['Wo ist Tim?', []],
  ['Sag Stefano er soll ohne Gast zurückfahren', []],
  ['Tim und Marvin morgen 6 bis 14', []],
  // Ohne Gruppe (alle, jeder, markierte) wird nicht gefragt, eine reine Auskunft braucht keine Ausnahme.
  ['Wer hat heute außer Tim noch Dienst?', []],
];
if (Deno.args.includes('--ausser')) {
  let gut = 0;
  for (const [satz, soll] of AUSSER) {
    const t0 = Date.now();
    const r = await absichtMitAusnahmen({ url, modell }, satz);
    const ist = r.ausser.map((x) => x.toLowerCase());
    const passt = ist.length === soll.length && soll.every((x) => ist.some((y) => y.includes(x.toLowerCase())));
    if (passt) gut += 1;
    else console.log(`FEHL ${((Date.now() - t0) / 1000).toFixed(1)}s  ${satz.slice(0, 80).padEnd(80)} ausser ${JSON.stringify(r.ausser)}, erwartet ${JSON.stringify(soll)} (${r.absicht})`);
  }
  console.log(`\n${modell} Ausnahmen: ${gut}/${AUSSER.length}`);
  Deno.exit(0);
}

let ok = 0;
let ms = 0;
const verwechslung = new Map<string, number>();
const faelle = (Deno.args.includes('--neu') ? NEU : F).filter(([, a]) => !nur || (Array.isArray(a) ? a.includes(nur) : a === nur));
for (const [satz, erwartet, empf, wort] of faelle) {
  const t0 = Date.now();
  const a = await absichtLesen({ url, modell }, satz);
  let fehler = '';
  const soll = Array.isArray(erwartet) ? erwartet : [erwartet];
  if (!a || !soll.includes(a)) {
    fehler = `Absicht ${a}, erwartet ${soll.join('/')}`;
    const k = `${soll[0]} -> ${a}`;
    verwechslung.set(k, (verwechslung.get(k) || 0) + 1);
  } else if (a === 'nachricht' && empf) {
    const n = await nachrichtLesen({ url, modell }, satz);
    const e = (n?.empfaenger || []).map((x) => x.toLowerCase());
    if (!empf.every((x) => e.some((y) => y.includes(x.toLowerCase())))) fehler = `Empfänger ${JSON.stringify(n?.empfaenger)}`;
    else if (wort && !String(n?.text || '').toLowerCase().includes(wort)) fehler = `Text „${n?.text}“`;
    else if (!wort && n?.text) fehler = `Text sollte leer sein: „${n?.text}“`;
  }
  const dauer = Date.now() - t0;
  ms += dauer;
  if (!fehler) ok += 1;
  else console.log(`FEHL ${(dauer / 1000).toFixed(1)}s  ${satz.slice(0, 80).padEnd(80)} ${fehler}`);
}
console.log(`\n${modell}: ${ok}/${faelle.length} richtig (${Math.round((ok / faelle.length) * 100)} %), im Schnitt ${(ms / faelle.length / 1000).toFixed(1)} s`);
if (verwechslung.size) console.log(`Verwechslungen: ${[...verwechslung].sort((x, y) => y[1] - x[1]).map(([k, n]) => `${k} (${n})`).join(', ')}`);
