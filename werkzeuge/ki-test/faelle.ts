// Testfaelle fuer den KI-Assistenten. Jeder Fall ist ein Gespraech aus einem oder mehreren Schritten.
// erwartet beschreibt, was der Assistent tun SOLL (nicht was er heute tut). Rote Faelle zeigen,
// wo er noch versagt. Neue echte Fehler aus ki_protokoll hier als Fall ergaenzen.
//
// art:        dienst_vorschlag | fahrt_buchen | fahrt_aendern | rueckfrage | antwort |
//             booking_needs_clarification (mehrere erlaubt als Liste)
// enthaelt:   alle diese Woerter muessen in der Antwort stehen (Gross/Klein egal)
// einesVon:   mindestens eines davon muss in der Antwort stehen
// nicht:      keines dieser Woerter darf in der Antwort stehen
// zeitNahe:   startZeit liegt so viele Minuten nach jetzt (bis 10 min Spielraum), auf 5 min gerundet
// vorschlag:  Felder im Vorschlag (Dienst: datum/start/ende/pausen/fahrer, Fahrt: datum/startZeit/start/ziel/
//             fahrgaeste/fahrerNamen/fahrtId). Text-Werte: muss enthalten sein. null: muss leer sein.

import { ID, tagBerlin } from './testdaten.ts';

export type Erwartung = {
  art: string | string[];
  enthaelt?: string[];
  einesVon?: string[];
  nicht?: string[];
  zeitNahe?: number;
  vorschlag?: Record<string, string | null>;
  karten?: string[];
  standby?: Record<string, string | null>;
};
export type Schritt = { frage: string; erwartet: Erwartung; markiert?: string[]; karten?: boolean };
export type Fall = { name: string; gruppe: string; schritte: Schritt[] };

const naechsterWochentag = (ziel: number) => {
  // 0 = Sonntag ... 5 = Freitag, immer in der Zukunft (nicht heute)
  for (let i = 1; i <= 7; i += 1) {
    const iso = tagBerlin(i);
    if (new Date(`${iso}T12:00:00Z`).getUTCDay() === ziel) return iso;
  }
  return tagBerlin(7);
};

const wochentag = (iso: string) => ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'][new Date(`${iso}T12:00:00Z`).getUTCDay()];

export const faelle = (): Fall[] => {
  const heute = tagBerlin(0);
  const morgen = tagBerlin(1);
  const uebermorgen = tagBerlin(2);
  const freitag = naechsterWochentag(5);
  const samstag = naechsterWochentag(6);
  const ein = (name: string, gruppe: string, frage: string, erwartet: Erwartung, markiert?: string[]): Fall =>
    ({ name, gruppe, schritte: [{ frage, erwartet, markiert }] });

  return [
    // --- Stundenlohn: nie sofort schreiben, erst Rueckfrage, "ja" speichert ---
    { name: 'Stundenlohn fuer alle, dann ja', gruppe: 'Stundenlohn', schritte: [
      { frage: 'Geb allen Fahrern eine Stundenlohn von 30€',
        erwartet: { art: 'antwort', enthaelt: ['30,00', 'speichern'], nicht: ['Alle 4 Fahrer:'] } },
      { frage: 'ja', erwartet: { art: 'antwort', enthaelt: ['Gespeichert', '30,00'] } },
    ] },
    { name: 'Stundenlohn fuer einen, dann nein', gruppe: 'Stundenlohn', schritte: [
      { frage: 'Setze Tim auf 28,50 Euro Stundenlohn', erwartet: { art: 'antwort', enthaelt: ['28,50', 'Tim', 'speichern'] } },
      { frage: 'nein', erwartet: { art: 'antwort', enthaelt: ['nichts geändert'] } },
    ] },
    ein('Stundenlohn ohne Betrag fragt nach', 'Stundenlohn', 'Ändere den Stundenlohn von Marvin',
      { art: 'antwort', enthaelt: ['Betrag'] }),
    ein('Stundenlohn absurd hoch wird abgelehnt', 'Stundenlohn', 'Gib allen Fahrern 3000 € Stundenlohn',
      { art: 'antwort', enthaelt: ['unwahrscheinlich'], nicht: ['speichern'] }),

    // --- Fahrer und Fahrzeuge anlegen: erst Rueckfrage, "ja" legt an ---
    { name: 'Fahrer anlegen, dann ja', gruppe: 'Anlegen', schritte: [
      { frage: 'Leg Fahrer Max Mustermann an, Nummer 14, Telefon 0151 2345678',
        erwartet: { art: 'antwort', enthaelt: ['Max Mustermann', 'max.mustermann', '14', '0151 2345678', 'speichere'] } },
      { frage: 'ja', erwartet: { art: 'antwort', enthaelt: ['Angelegt', 'max.mustermann', 'Passwort'] } },
    ] },
    { name: 'Fahrer anlegen, Benutzername nachreichen, nein', gruppe: 'Anlegen', schritte: [
      { frage: 'Erstelle einen neuen Fahrer namens Ali Yilmaz', erwartet: { art: 'antwort', enthaelt: ['Ali Yilmaz', 'ali.yilmaz'] } },
      { frage: 'Benutzername ayilmaz', erwartet: { art: 'antwort', enthaelt: ['ayilmaz'], nicht: ['ali.yilmaz'] } },
      { frage: 'nein', erwartet: { art: 'antwort', enthaelt: ['nichts angelegt'] } },
    ] },
    ein('Fahrernummer schon vergeben', 'Anlegen', 'Neuer Fahrer Lena Fischer mit Nummer 113',
      { art: 'antwort', enthaelt: ['113', 'Tim'] }),
    ein('Fahrer ohne Nachnamen fragt nach', 'Anlegen', 'Leg einen neuen Fahrer an',
      { art: 'antwort', enthaelt: ['Vor- und Nachnamen'] }),
    ein('Frage nach neuen Fahrern legt nichts an', 'Anlegen', 'Welche Fahrer sind neu?',
      { art: ['antwort', 'rueckfrage'], nicht: ['Neuer Fahrer:'] }),
    { name: 'Fahrzeug anlegen, Sitze aendern, ja', gruppe: 'Anlegen', schritte: [
      { frage: 'Neues Fahrzeug Mercedes V-Klasse, Kennzeichen M-TR 105, 7 Sitze, schwarz, Diesel',
        erwartet: { art: 'antwort', enthaelt: ['Mercedes V-Klasse', 'M-TR 105', '7', 'schwarz', 'Diesel'] } },
      { frage: '8 Sitze', erwartet: { art: 'antwort', enthaelt: ['Sitze: 8', 'M-TR 105'] } },
      { frage: 'ja', erwartet: { art: 'antwort', enthaelt: ['Angelegt', 'M-TR 105'] } },
    ] },
    ein('Fahrzeug Kurzform', 'Anlegen', 'leg ein auto an: BMW 5er M-TR 104',
      { art: 'antwort', enthaelt: ['BMW 5er', 'M-TR 104'] }),
    ein('Kennzeichen schon vergeben', 'Anlegen', 'Lege das Fahrzeug Audi A8 mit Kennzeichen M-TR 101 an',
      { art: 'antwort', enthaelt: ['M-TR 101', 'gibt es schon'] }),

    // --- Standby zur Fahrt: Fahrt als Karte, Standby nach "ja" ---
    { name: 'Fahrt mit Standby davor, dann ja', gruppe: 'Standby', schritte: [
      { frage: 'Buche Tim morgen um 14:30 vom Flughafen München Terminal 2 zum Bayerischer Hof, davor dort Standby ab 10:00 Uhr',
        erwartet: { art: 'fahrt_buchen', enthaelt: ['Standby', '10:00', '14:30', 'Tim'],
          vorschlag: { startZeit: '14:30', start: 'Terminal 2', startOrtId: 'o4', fahrerNamen: 'Tim' } } },
      { frage: 'ja', erwartet: { art: 'antwort', enthaelt: ['Standby angelegt', 'Tim'] } },
    ] },
    { name: 'Standby ohne Fahrer fragt nach', gruppe: 'Standby', schritte: [
      { frage: 'Buche morgen um 16 Uhr eine Fahrt von der Messe zum Hauptbahnhof, vorher Standby an der Messe ab 12 Uhr',
        erwartet: { art: 'fahrt_buchen', enthaelt: ['Standby', '12:00', 'Fahrer'], vorschlag: { startZeit: '16:00' } } },
      { frage: 'Marvin', erwartet: { art: 'antwort', enthaelt: ['Marvin', '12:00', '16:00', 'ja'] } },
      { frage: 'nein', erwartet: { art: 'antwort', enthaelt: ['kein Standby'] } },
    ] },
    ein('Standby wie getippt mit Flug', 'Standby', 'Buche Tim morgen vom Flughafen München Terminal 2 zum Hotel Vier Jahreszeiten, der Flug LH2471 landet um 15:10 und davor dort standby von ab 10:00 uhr',
      { art: 'fahrt_buchen', enthaelt: ['Standby', '10:00', '15:10'], vorschlag: { startZeit: '15:10', startOrtId: 'o4', ziel: 'Vier Jahreszeiten' } }),
    ein('Standby mit eigener Endzeit', 'Standby', 'Buche Anna morgen 18 Uhr vom Hotel Vier Jahreszeiten zur Messe, davor Standby von 15 bis 17:30',
      { art: 'fahrt_buchen', enthaelt: ['15:00', '17:30'], vorschlag: { startZeit: '18:00' } }),

    // --- Karten-Liste (neue Apps): Standby als eigene Karte, mehrere Auftraege einzeln ---
    { name: 'Karten: Fahrt und Standby', gruppe: 'Karten', schritte: [
      { karten: true, frage: 'Buche Tim morgen um 14:30 vom Flughafen München Terminal 2 zum Bayerischer Hof, davor dort Standby ab 10:00 Uhr',
        erwartet: { art: 'fahrt_buchen', karten: ['booking_proposal', 'standby_proposal'],
          standby: { von: '10:00', bis: '14:30', ortId: 'o4', fahrerNamen: 'Tim', fehlt: null }, vorschlag: { startZeit: '14:30' } } },
    ] },
    { name: 'Karten: Standby ohne Fahrer', gruppe: 'Karten', schritte: [
      { karten: true, frage: 'Buche morgen um 16 Uhr eine Fahrt von der Messe zum Hauptbahnhof, vorher Standby an der Messe ab 12 Uhr',
        erwartet: { art: 'fahrt_buchen', karten: ['booking_proposal', 'standby_proposal'], standby: { von: '12:00', bis: '16:00', fehlt: 'fahrer' } } },
    ] },
    { name: 'Karten: zwei Fahrten in einer Nachricht', gruppe: 'Karten', schritte: [
      { karten: true, frage: 'Buche Tim morgen um 9 Uhr vom Hauptbahnhof zur Messe und buche Anna morgen um 18 Uhr vom Hotel Vier Jahreszeiten zum Bayerischer Hof',
        erwartet: { art: 'fahrt_buchen', karten: ['booking_proposal', 'booking_proposal'], enthaelt: ['2 Aufträge'] } },
    ] },
    { name: 'Karten: zwei Zeilen mit Standby', gruppe: 'Karten', schritte: [
      { karten: true, frage: 'Buche Tim morgen 14:30 vom Flughafen München Terminal 2 zum Bayerischer Hof, davor dort Standby ab 11 Uhr\nBuche Marvin morgen 20 Uhr von der Messe zum Hauptbahnhof',
        erwartet: { art: 'fahrt_buchen', karten: ['booking_proposal', 'standby_proposal', 'booking_proposal'] } },
    ] },
    ein('Ohne Karten bleibt eine Nachricht ganz', 'Karten', 'Buche Tim morgen um 9 Uhr vom Hauptbahnhof zur Messe und buche Anna morgen um 18 Uhr vom Hotel Vier Jahreszeiten zum Bayerischer Hof',
      { art: ['fahrt_buchen', 'rueckfrage', 'antwort', 'booking_needs_clarification'], nicht: ['Aufträge erkannt'] }),

    // --- Echte Fehlsaetze aus ki_protokoll 12.11. ---
    ein('Schick eine Fahrt fuer jetzt', 'Protokoll', 'Schick Stefano Spandri eine Fahrt von Kreillerstraße 210 zur Erner Straße 5 für jetzt',
      { art: 'fahrt_buchen', vorschlag: { start: 'Kreillerstraße 210', ziel: 'Erner Straße 5', fahrerNamen: 'Stefano' }, zeitNahe: 0 }),
    ein('Schicke eine Fahrt fuer morgen', 'Protokoll', 'Schicke Stefano Spandri eine Fahrt für morgen 10:30 Uhr vom Hotel Bayerischer Hof zur Messe mit dem Gast Weber',
      { art: 'fahrt_buchen', vorschlag: { datum: morgen, startZeit: '10:30', start: 'Bayerischer Hof', ziel: 'Messe', fahrerNamen: 'Stefano', fahrgaeste: 'Weber' } }),
    ein('Fahrt Fahrer von nach', 'Protokoll', 'Fahrt Stefano morgen 9 Uhr von Brudermühlstraße 2, 81371 München zu Ernastraße 5, 81829 München',
      { art: 'fahrt_buchen', vorschlag: { start: 'Brudermühlstraße 2, 81371', ziel: 'Ernastraße 5, 81829', fahrerNamen: 'Stefano', startZeit: '09:00' } }),
    ein('Fahrt Fahrer von nach ohne Zeit fragt nach', 'Protokoll', 'Fahrt Stefano von Brudermühlstraße 2, 81371 München zu Ernastraße 5 81829 München',
      { art: ['booking_needs_clarification', 'rueckfrage', 'antwort'], enthaelt: ['Uhr'], nicht: ['keine Informationen'] }),
    ein('Wo sind die markierten', 'Protokoll', 'Wo sind die drei gerade',
      { art: 'antwort', enthaelt: ['Tim', 'Stefano', 'Marvin'], nicht: ['Die drei sind'] }, [ID.tim, ID.stefano, ID.marvin]),
    ein('Pause eingetragen', 'Protokoll', 'Hat Stefano morgen eine Pause eingetragen?',
      { art: 'antwort', einesVon: ['Pause', 'Dienst'], nicht: ['nicht in den Daten'] }),
    { name: 'Zwei Fahrer anlegen, ja', gruppe: 'Protokoll', schritte: [
      { frage: 'kannst du fahrer Fertel garlo erstellen und fahrer Marvin hallo', erwartet: { art: 'antwort', enthaelt: ['Fertel Garlo', 'Marvin Hallo', 'alle'] } },
      { frage: 'ja', erwartet: { art: 'antwort', enthaelt: ['Angelegt: Fertel Garlo', 'Angelegt: Marvin Hallo'] } },
    ] },
    ein('Zwei Namen ein Fahrer-Wort', 'Protokoll', 'Leg Max Muster und Lisa Lang als Fahrer an',
      { art: 'antwort', enthaelt: ['Max Muster', 'Lisa Lang'] }),
    ein('Zwei Fahrzeuge', 'Protokoll', 'Leg zwei Autos an: BMW 5er M-TR 107 und Audi A8 M-TR 108',
      { art: 'antwort', enthaelt: ['BMW 5er', 'M-TR 107', 'Audi A8', 'M-TR 108'] }),
    { name: 'Karten: zwei Fahrer', gruppe: 'Protokoll', schritte: [
      { karten: true, frage: 'Leg Fahrer Fertel Garlo und Fahrer Marvin Hallo an', erwartet: { art: 'antwort', karten: ['fahrer_proposal', 'fahrer_proposal'] } },
    ] },

    // --- Dienst-, Pausen- und Stundenfragen ---
    ein('Pause eingetragen ja', 'Fragen2', 'Hat Anna morgen eine Pause eingetragen?', { art: 'antwort', enthaelt: ['11:30', '12:00'] }),
    ein('Pause eingetragen nein', 'Fragen2', 'Hat Stefano heute eine Pause?', { art: 'antwort', enthaelt: ['keine Pause'] }),
    ein('Wann faengt an', 'Fragen2', 'Wann fängt Anna morgen an?', { art: 'antwort', enthaelt: ['07:00'] }),
    ein('Wann Feierabend', 'Fragen2', 'Wann hat Anna morgen Feierabend?', { art: 'antwort', enthaelt: ['15:00'] }),
    ein('Stunden heute einer', 'Fragen2', 'Wie viele Stunden hat Tim heute?', { art: 'antwort', enthaelt: ['8:00 h'] }),
    ein('Stunden heute alle', 'Fragen2', 'Wie viele Stunden haben die Fahrer heute gearbeitet?', { art: 'antwort', enthaelt: ['14:30 h', 'Marvin', 'Tim'] }),
    ein('Offene Stundenzettel', 'Fragen2', 'Welche Stundenzettel sind noch offen?', { art: 'antwort', enthaelt: ['Marvin', '6:30 h'], nicht: ['Tim'] }),
    { name: 'Dienst fuer Fahrer aus dem Gespraech', gruppe: 'Fragen2', schritte: [
      { frage: 'Wo ist Stefano?', erwartet: { art: 'antwort', enthaelt: ['Stefano'] } },
      { frage: 'Dann schick Dienststart für morgen 9:00 Uhr', erwartet: { art: 'dienst_vorschlag', vorschlag: { start: '09:00', fahrer: 'Stefano' } } },
    ] },

    // --- Fahrzeug und Tracker zuordnen ---
    { name: 'Fahrzeug an Fahrer, ja', gruppe: 'Zuordnen', schritte: [
      { frage: 'Gib Marvin das Fahrzeug M-TR 102', erwartet: { art: 'antwort', enthaelt: ['Marvin', 'M-TR 102', 'Tim', 'ja'] } },
      { frage: 'ja', erwartet: { art: 'antwort', enthaelt: ['Gespeichert', 'Marvin', 'M-TR 102'] } },
    ] },
    { name: 'Tracker ins Auto, nein', gruppe: 'Zuordnen', schritte: [
      { frage: 'Steck Tracker 4 in den M-TR 103', erwartet: { art: 'antwort', enthaelt: ['Tracker 4', 'M-TR 103'] } },
      { frage: 'nein', erwartet: { art: 'antwort', enthaelt: ['nichts geändert'] } },
    ] },
    ein('Tracker umstecken nennt bisheriges Auto', 'Zuordnen', 'Tracker 3 ins Auto M-TR 103', { art: 'antwort', enthaelt: ['Tracker 3', 'M-TR 103', 'M-TR 101'] }),
    ein('Unbekanntes Kennzeichen', 'Zuordnen', 'Gib Tim den M-XY 999', { art: 'antwort', enthaelt: ['finde ich nicht'] }),

    // --- Standby ohne Fahrt ---
    { name: 'Standby allein, ja', gruppe: 'Standby2', schritte: [
      { frage: 'Standby morgen 10-18 Uhr an der Messe für Tim und Marvin', erwartet: { art: 'antwort', enthaelt: ['Messe München', '10:00', '18:00', 'Tim', 'Marvin', 'ja'] } },
      { frage: 'ja', erwartet: { art: 'antwort', enthaelt: ['Standby angelegt'] } },
    ] },
    { name: 'Karten: Standby allein', gruppe: 'Standby2', schritte: [
      { karten: true, frage: 'Standby übermorgen von 9 bis 13 Uhr am Bayerischer Hof für Anna',
        erwartet: { art: 'antwort', karten: ['standby_proposal'], standby: { von: '09:00', bis: '13:00', ortId: 'o1', fahrerNamen: 'Anna', fehlt: null } } },
    ] },
    ein('Standby allein ohne Fahrer fragt nach', 'Standby2', 'Standby morgen ab 10 bis 16 Uhr am Hauptbahnhof',
      { art: 'antwort', enthaelt: ['Fahrer'] }),

    // --- Loeschen: Rueckfrage, nur "löschen" loescht ---
    { name: 'Fahrer loeschen, ja reicht nicht, loeschen', gruppe: 'Loeschen', schritte: [
      { frage: 'Lösche den Fahrer Marvin Keller', erwartet: { art: 'antwort', enthaelt: ['Marvin Keller', 'endgültig', 'löschen'] } },
      { frage: 'ja', erwartet: { art: 'antwort', enthaelt: ['„löschen“'], nicht: ['gelöscht.'] } },
      { frage: 'löschen', erwartet: { art: 'antwort', enthaelt: ['Marvin Keller gelöscht'] } },
    ] },
    { name: 'Fahrzeug loeschen, nein', gruppe: 'Loeschen', schritte: [
      { frage: 'Lösche das Fahrzeug M-TR 103', erwartet: { art: 'antwort', enthaelt: ['BMW X5', 'M-TR 103', 'löschen'] } },
      { frage: 'nein', erwartet: { art: 'antwort', enthaelt: ['nichts gelöscht'] } },
    ] },
    ein('Alle loeschen geht nicht', 'Loeschen', 'Lösche alle Fahrzeuge', { art: 'antwort', enthaelt: ['einzeln'] }),
    ein('Zwei Fahrer loeschen', 'Loeschen', 'Entferne die Fahrer Tim Schedler und Anna Berger', { art: 'antwort', enthaelt: ['Tim Schedler', 'Anna Berger'] }),
    ein('Fahrt loeschen bleibt bei der Fahrt', 'Loeschen', 'Lösche die Fahrt von Tim', { art: 'antwort', enthaelt: ['Fahrt'], nicht: ['endgültig löschen'] }),

    // --- Dienste ---
    ein('Dienst Start und Ende morgen', 'Dienst', 'Schick Tim morgen 7 bis 15 Uhr',
      { art: 'dienst_vorschlag', vorschlag: { datum: morgen, start: '07:00', ende: '15:00', fahrer: 'Tim' } }),
    // Ausnahmen (ki_protokoll 14.11.: "bis auf Stefano" schickte Stefano trotzdem den Dienst)
    ein('Dienst an alle bis auf einen', 'Ausnahme', 'Schick allen bis auf Stefano bitte ein dienstbeginn für heute 13:30 Uhr',
      { art: 'dienst_vorschlag', enthaelt: ['ohne Stefano'], nicht: ['bei Stefano'], vorschlag: { datum: heute, start: '13:30' } }),
    ein('Dienst an alle, einer ausgenommen, anders gesagt', 'Ausnahme', 'Morgen fangen alle um 8 an, nur Tim nicht',
      { art: 'dienst_vorschlag', enthaelt: ['ohne Tim'], vorschlag: { datum: morgen, start: '08:00' } }),
    ein('Feierabend fuer alle ausser zwei', 'Ausnahme', 'Schick alle Fahrer in den Feierabend außer Tim und Marvin',
      { art: 'dienst_vorschlag', enthaelt: ['ohne Tim', 'Marvin'] }),
    { name: 'Nachricht an alle ausser einem', gruppe: 'Ausnahme', schritte: [
      { frage: 'Sag allen außer Tim, dass sie heute tanken sollen', erwartet: { art: 'antwort', enthaelt: ['ohne Tim', 'tank'], nicht: ['alle 4 Fahrer'] } },
    ] },
    ein('Stundenlohn fuer alle ausser einem', 'Ausnahme', 'Stundenlohn 25 Euro für alle Fahrer, ausgenommen Marvin',
      { art: 'antwort', enthaelt: ['25,00', 'ohne Marvin', 'speichern'] }),
    ein('Kein falsches Ausnehmen beim Loeschen', 'Ausnahme', 'Stefano hat heute frei, lösch seinen Dienst',
      { art: ['antwort', 'rueckfrage'], enthaelt: ['Stefano'], nicht: ['ohne Stefano'] }),
    // Datum und Aenderungen (15.11., ki_protokoll 13.-15.11.)
    ein('Aendern von X auf Y nimmt Y', 'Datum', 'Änder den Dienststart von Stefano heute von 8:00 auf 6:30',
      { art: 'dienst_vorschlag', vorschlag: { datum: heute, start: '06:30' } }),
    ein('Dienstende verschieben ist kein Loeschen', 'Datum', 'Verschieb Stefanos Dienstende heute auf 17 Uhr',
      { art: 'dienst_vorschlag', vorschlag: { ende: '17:00' }, nicht: ['entfernen'] }),
    ein('Heutiger Wochentag meint naechste Woche', 'Datum', `Tim Dienststart ${['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'][new Date(`${heute}T12:00:00Z`).getUTCDay()]} 9 Uhr`,
      { art: 'dienst_vorschlag', vorschlag: { datum: tagBerlin(7), start: '09:00' } }),
    ein('Wochentag nie in der Vergangenheit', 'Datum', `Tim Dienststart ${['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'][new Date(`${tagBerlin(-1)}T12:00:00Z`).getUTCDay()]} 9 Uhr`,
      { art: 'dienst_vorschlag', vorschlag: { datum: tagBerlin(6), start: '09:00' } }),
    ein('Start nach altem Ende: Ende faellt weg', 'Datum', 'Anna Dienststart morgen 16 Uhr',
      { art: 'dienst_vorschlag', enthaelt: ['fällt weg'], vorschlag: { datum: morgen, start: '16:00' } }),
    ein('Fuer alle ohne erfundene Ausnahmen', 'Datum', 'Dienststart für alle Fahrer morgen um 10:30',
      { art: 'dienst_vorschlag', nicht: ['ohne'], vorschlag: { datum: morgen, start: '10:30' } }),
    ein('Dienststart von gestern loeschen', 'Datum', 'Lösche den Dienststart von Stefano von gestern',
      { art: 'antwort', enthaelt: ['gestern'] }),
    ein('Fahrt mit allen ausser einem', 'Datum', 'Neue Fahrt morgen um 14:30 mit allen Fahrern außer Marvin, vom Hauptbahnhof zum Flughafen',
      { art: 'fahrt_buchen', enthaelt: ['ohne Marvin'], nicht: ['Fahrer Marvin'] }),
    // Nachts (nur mit --uhr=01:30 --nur=Nacht laufen lassen): "morgen" meint das heutige Datum.
    ein('Nachts: morgen ist heute (Dienst)', 'Nacht', 'Dienststart für Tim morgen um 10:30',
      { art: 'dienst_vorschlag', vorschlag: { datum: heute, start: '10:30' } }),
    ein('Nachts: morgen ist heute (Fahrt)', 'Nacht', 'Neue Fahrt morgen um 10 Uhr vom Hauptbahnhof zur Messe München',
      { art: 'fahrt_buchen', vorschlag: { datum: heute } }),
    ein('Dienst ab Uhrzeit heute', 'Dienst', 'Dienst für Marvin heute ab 14 Uhr',
      { art: 'dienst_vorschlag', vorschlag: { datum: heute, start: '14:00', fahrer: 'Marvin' } }),
    ein('Vorhandener Dienst, Uhrzeit nachts', 'Dienst', 'Schick Stefano heute 00:30',
      { art: 'dienst_vorschlag', enthaelt: ['Dienstende'], vorschlag: { ende: '00:30', start: null } }),
    ein('Pause im vorhandenen Dienst', 'Dienst', 'Stefano Pause von 12 bis 12:30',
      { art: 'dienst_vorschlag', vorschlag: { pausen: '12:00' } }),
    ein('Feierabend mit Uhrzeit', 'Dienst', 'Anna Feierabend um 18 Uhr',
      { art: 'dienst_vorschlag', vorschlag: { ende: '18:00', fahrer: 'Anna' } }),
    ein('Fahrer per Nummer', 'Dienst', 'Schick Fahrer 113 heute 16:00',
      { art: 'dienst_vorschlag', vorschlag: { start: '16:00', fahrer: 'Tim' } }),
    ein('Zwei Fahrer gleicher Dienst', 'Dienst', 'Tim und Marvin morgen 6 bis 14',
      { art: 'dienst_vorschlag', vorschlag: { start: '06:00', ende: '14:00', fahrer: 'Marvin' } }),
    ein('Gleicher Start schon eingetragen', 'Dienst', 'Schick Stefano heute 8 Uhr',
      { art: ['antwort', 'rueckfrage'], enthaelt: ['schon'] }),
    ein('Umgangssprache: morgen früh', 'Dienst', 'schick tim morgen früh 7',
      { art: 'dienst_vorschlag', vorschlag: { datum: morgen, start: '07:00' } }),
    ein('Umgangssprache: Schluss machen', 'Dienst', 'Tim soll heute um 17 Uhr Schluss machen',
      { art: 'dienst_vorschlag', vorschlag: { ende: '17:00', fahrer: 'Tim' } }),
    ein('Pause mit Bindestrich', 'Dienst', 'Pause für Anna morgen 12-13',
      { art: 'dienst_vorschlag', vorschlag: { pausen: '12:00', datum: morgen } }),
    ein('Umgangssprache: fängt an', 'Dienst', 'Marvin fängt morgen um 6 an',
      { art: 'dienst_vorschlag', vorschlag: { start: '06:00', datum: morgen } }),
    ein('Markierte Fahrer in Feierabend', 'Dienst', 'schick die alle in Feierabend',
      { art: 'dienst_vorschlag', vorschlag: { fahrer: 'Marvin' } }, [ID.tim, ID.marvin]),

    // --- Neue Fahrten ---
    ein('Buchung komplett', 'Buchen', 'Buche morgen 9:00 vom Hauptbahnhof zum Flughafen Terminal 2 für Julia Weber',
      { art: 'fahrt_buchen', vorschlag: { datum: morgen, startZeit: '09:00', start: 'Hauptbahnhof', ziel: 'Flughafen', fahrgaeste: 'Weber' } }),
    ein('Buchen nimmt eigene Orte mit ID', 'Buchen', 'Buche morgen um 10 Uhr eine Fahrt vom Bayerischer Hof zur Messe',
      { art: 'fahrt_buchen', vorschlag: { startZeit: '10:00', start: 'Hotel Bayerischer Hof', startOrtId: 'o1', ziel: 'Messe München', zielOrtId: 'o5' } }),
    // 13.11.: "soll ... fahren" wurde als Zuweisung einer vorhandenen Fahrt gelesen ("keine anstehende Fahrt").
    ein('Buchen per Fahr-Verb', 'Buchen', 'stefano soll vom flughafen münchen zum Flughafen salzburg fahren um 20:30 ohne gast',
      { art: 'fahrt_buchen', vorschlag: { startZeit: '20:30', start: 'Flughafen', ziel: 'Salzburg' } }),
    ein('Buchen fährt mit Strecke', 'Buchen', 'Stefano fährt um 20:30 vom Flughafen München nach Salzburg Flughafen, ohne Gast',
      { art: 'fahrt_buchen', vorschlag: { startZeit: '20:30', ziel: 'Salzburg' } }),
    ein('Buchen fremder Ort ohne Ort-ID', 'Buchen', 'Buche morgen um 9 Uhr eine Fahrt von Vier Jahreszeiten nach Salzburg Flughafen',
      { art: 'fahrt_buchen', vorschlag: { start: 'Hotel Vier Jahreszeiten', startOrtId: 'o6', ziel: 'Salzburg', zielOrtId: null } }),
    ein('Buchung mit Fahrer und Gästezahl', 'Buchen', 'Neue Fahrt heute 20 Uhr Messe nach Bayerischer Hof, 2 Gäste, Fahrer Tim',
      { art: 'fahrt_buchen', vorschlag: { startZeit: '20:00', start: 'Messe', ziel: 'Bayerischer Hof', fahrerNamen: 'Tim' } }),
    ein('Buchung übermorgen', 'Buchen', 'Fahrt für Julia Weber übermorgen 11:30 Flughafen T1 zum Hotel Vier Jahreszeiten',
      { art: 'fahrt_buchen', vorschlag: { datum: uebermorgen, startZeit: '11:30', ziel: 'Vier Jahreszeiten' } }),
    ein('Buchung ohne Ziel fragt nach', 'Buchen', 'Ich brauche ein Auto morgen um 7 vom Hotel Bayerischer Hof',
      { art: ['booking_needs_clarification', 'rueckfrage'], einesVon: ['ziel', 'wohin'] }),
    ein('Buchung Wochentag', 'Buchen', 'Buch mir für Freitag 8 Uhr eine Fahrt vom Flughafen T2 in die Messe',
      { art: 'fahrt_buchen', vorschlag: { datum: freitag, startZeit: '08:00', ziel: 'Messe' } }),
    ein('Buchung als Abholung formuliert', 'Buchen', 'Hol Herrn Engel um 16 Uhr am Flughafen ab und bring ihn ins Hotel Bayerischer Hof',
      { art: 'fahrt_buchen', vorschlag: { startZeit: '16:00', start: 'Flughafen', ziel: 'Bayerischer Hof', fahrgaeste: 'Engel' } }),
    // Echte Fehler aus ki_protokoll (11.11.): als Aenderung bzw. vom Modell abgelehnt.
    ein('Protokoll: Schicke X eine Fahrt', 'Buchen', 'Schicke Stefano Spandri eine Fahrt für morgen 10:30 Uhr vom Hotel bayerischen Hof zur Allianz Arena mit dem Gast Uli Hoeneß',
      { art: 'fahrt_buchen', vorschlag: { datum: morgen, startZeit: '10:30', start: 'Hotel Bayerischer Hof', ziel: 'Allianz Arena', fahrgaeste: 'Uli Hoeneß', fahrerNamen: 'Stefano Spandri' } }),
    ein('Protokoll: Fahrt für jetzt', 'Buchen', 'Schick Stefano Spandri eine Fahrt von Kreillerstraße 210 zur Erner Straße 5 für jetzt',
      { art: 'fahrt_buchen', zeitNahe: 0, vorschlag: { datum: heute, start: 'Kreillerstraße 210', ziel: 'Erner Straße 5', fahrerNamen: 'Stefano Spandri', fahrgaeste: null } }),
    ein('Gib X eine Fahrt', 'Buchen', 'Gib Tim eine Fahrt morgen um 8 vom Hauptbahnhof zur Messe',
      { art: 'fahrt_buchen', vorschlag: { datum: morgen, startZeit: '08:00', start: 'Hauptbahnhof', ziel: 'Messe', fahrerNamen: 'Tim Schedler' } }),
    ein('Plan für X eine Fahrt', 'Buchen', 'Plan für Anna eine Fahrt übermorgen 15:00 vom Hotel Vier Jahreszeiten zum Flughafen Terminal 1 mit Herrn Engel',
      { art: 'fahrt_buchen', vorschlag: { datum: uebermorgen, startZeit: '15:00', ziel: 'Terminal 1', fahrerNamen: 'Anna Berger', fahrgaeste: 'Engel' } }),
    ein('Fahrt in 20 Minuten', 'Buchen', 'Schick Marvin in 20 Minuten eine Fahrt vom Hauptbahnhof zum Hotel Bayerischer Hof',
      { art: 'fahrt_buchen', zeitNahe: 20, vorschlag: { start: 'Hauptbahnhof', ziel: 'Bayerischer Hof', fahrerNamen: 'Marvin' } }),
    ein('Buchung warnt bei Überschneidung', 'Buchen', 'Gib Stefano eine Fahrt heute 14:15 von der Messe München zum Hauptbahnhof',
      { art: 'fahrt_buchen', enthaelt: ['Achtung'], vorschlag: { startZeit: '14:15', fahrerNamen: 'Stefano' } }),
    ein('Schick X zu einem Ort, Start fehlt', 'Buchen', 'Schick Tim morgen um 7 zum Flughafen Terminal 2',
      { art: ['booking_needs_clarification', 'rueckfrage'], einesVon: ['abgeholt', 'start'] }),
    ein('Verbteil gehört nicht zum Ziel', 'Buchen', 'Trag mir eine Fahrt für morgen 9 Uhr vom Hauptbahnhof zum Flughafen T1 ein',
      { art: 'fahrt_buchen', nicht: [' ein,', ' ein.'], vorschlag: { datum: morgen, startZeit: '09:00', ziel: 'Flughafen München Terminal 1' } }),
    ein('Zwei Gäste und Flugnummer', 'Buchen', 'Neue Fahrt morgen 8 Uhr Flughafen T2 nach Messe für Herrn Müller und Frau Weber, Flug LH 2034',
      { art: 'fahrt_buchen', enthaelt: ['LH2034'], nicht: ['Flug LH,'], vorschlag: { startZeit: '08:00', fahrgaeste: 'Weber', ziel: 'Messe' } }),
    ein('Trag eine neue Fahrt ein', 'Buchen', 'Trag eine neue Fahrt ein: morgen 12 Uhr vom Flughafen Terminal 2 zum Hotel Bayerischer Hof, 2 Gäste',
      { art: 'fahrt_buchen', vorschlag: { datum: morgen, startZeit: '12:00', start: 'Terminal 2', ziel: 'Bayerischer Hof', fahrerNamen: null } }),

    // --- Fahrten ändern ---
    ein('Uhrzeit über Gastnamen', 'Ändern', 'Verschieb die Fahrt von Herrn Engel auf 11 Uhr',
      { art: 'fahrt_aendern', vorschlag: { fahrtId: ID.fahrtEngel, startZeit: '11:00' } }),
    ein('Fahrer über Uhrzeit', 'Ändern', 'Die 14 Uhr Fahrt soll Anna fahren',
      { art: 'fahrt_aendern', vorschlag: { fahrtId: ID.fahrtMueller, fahrerNamen: 'Anna' } }),
    ein('Ziel ändern', 'Ändern', 'Ändere bei der Fahrt von Julia Weber das Ziel auf Terminal 1',
      { art: 'fahrt_aendern', vorschlag: { fahrtId: ID.fahrtMorgen, ziel: 'Terminal 1' } }),
    ein('Offene Fahrt vergeben', 'Ändern', 'Gib die offene Fahrt um 18 Uhr Marvin',
      { art: 'fahrt_aendern', vorschlag: { fahrtId: ID.fahrtOffen, fahrerNamen: 'Marvin' } }),
    ein('Schick X auf die Fahrt', 'Ändern', 'Schick Marvin auf die offene Fahrt um 18 Uhr',
      { art: 'fahrt_aendern', vorschlag: { fahrtId: ID.fahrtOffen, fahrerNamen: 'Marvin' } }),
    ein('Plan X für die Fahrt ein', 'Ändern', 'Plan Anna für die 14 Uhr Fahrt ein',
      { art: 'fahrt_aendern', vorschlag: { fahrtId: ID.fahrtMueller, fahrerNamen: 'Anna' } }),
    ein('Änderung warnt bei Überschneidung', 'Ändern', 'Verschieb die Fahrt von Herrn Müller auf 11 Uhr',
      { art: 'fahrt_aendern', enthaelt: ['Achtung', '14:00 → 11:00'], vorschlag: { fahrtId: ID.fahrtMueller, startZeit: '11:00' } }),
    ein('Stornieren nur mit Hinweis', 'Ändern', 'Storniere die Fahrt von Herrn Müller',
      { art: ['antwort', 'rueckfrage'], einesVon: ['stornier', 'bearbeiten'] }),

    // --- Fragen ---
    // 13.11.: "noch im Dienst" heisst jetzt, nicht "von wann bis wann".
    ein('Noch im Dienst ja', 'Fragen', 'Ist Stefano noch im Dienst?', { art: 'antwort', enthaelt: ['Ja', 'seit 08:00'] }),
    ein('Noch im Dienst nein', 'Fragen', 'Ist Anna noch im Dienst', { art: 'antwort', enthaelt: ['Nein'] }),
    ein('Irgendwer im Dienst', 'Fragen', 'Ist irgendein Fahrer aktuell noch im Dienst', { art: 'antwort', enthaelt: ['Stefano'] }),
    ein('Anzahl Fahrten heute', 'Fragen', 'Wie viele Fahrten haben wir heute?', { art: 'antwort', enthaelt: ['4'] }),
    ein('Fahrten eines Fahrers', 'Fragen', 'Welche Fahrten hat Stefano heute?', { art: 'antwort', enthaelt: ['10:30', '14:00'] }),
    ein('Wer fährt einen Gast', 'Fragen', 'Wer fährt Herrn Engel?', { art: 'antwort', enthaelt: ['Stefano'] }),
    ein('Offene Fahrten', 'Fragen', 'Welche Fahrten sind noch ohne Fahrer?', { art: 'antwort', enthaelt: ['18:00'] }),
    ein('Offene Fahrten anders gefragt', 'Fragen', 'Gibt es noch offene Fahrten?', { art: 'antwort', enthaelt: ['18:00', 'Messe'] }),
    ein('Fahrten eines Tages', 'Fragen', 'Gib mir die Fahrten von morgen', { art: 'antwort', enthaelt: ['07:15', 'Anna'] }),
    ein('Fahrten zu einem Ziel', 'Fragen', 'Welche Fahrten gehen heute zum Flughafen?', { art: 'antwort', enthaelt: ['10:30'], nicht: ['14:00'] }),
    ein('Wer fährt um eine Uhrzeit', 'Fragen', 'Wer fährt die 18 Uhr Fahrt?', { art: 'antwort', enthaelt: ['keinen Fahrer'] }),
    ein('Hat X Zeit', 'Fragen', 'Hat Anna morgen Zeit?', { art: 'antwort', enthaelt: ['07:15', 'Frei'] }),
    ein('Wer ist frei um', 'Neu', 'Wer ist frei um 18 Uhr?', { art: 'antwort', enthaelt: ['Marvin', 'Anna'] }),
    ein('Fahrer morgen', 'Fragen', 'Was macht Anna morgen?', { art: 'antwort', enthaelt: ['07:15', 'Flughafen'] }),
    ein('Fahrzeug eines Fahrers', 'Fragen', 'Welches Auto hat Tim?', { art: 'antwort', einesVon: ['V-Klasse', 'M-TR 102'] }),
    ein('Fahrt über Ziel finden', 'Fragen', 'Wann ist die Fahrt zum Flughafen morgen?', { art: 'antwort', enthaelt: ['07:15'] }),
    ein('Uhrzeit eines Fahrers', 'Fragen', 'Wann fährt Tim heute?', { art: 'antwort', enthaelt: ['09:00'] }),
    ein('Alle Fahrer', 'Fragen', 'Zeig mir alle Fahrer', { art: 'antwort', enthaelt: ['Stefano', 'Tim', 'Marvin', 'Anna'] }),
    ein('Wer ist im Dienst', 'Fragen', 'Welche Fahrer sind heute im Dienst?', { art: 'antwort', enthaelt: ['Stefano'], nicht: ['Anna', 'Marvin'] }),
    // Standort: echter Fehler aus ki_protokoll ("Stefano Spandri ist derzeit in München.").
    ein('Protokoll: Wo ist Stefano', 'Fragen', 'Wo ist Stefano', { art: 'antwort', enthaelt: ['Bayerischer Hof', 'Signal'], nicht: ['derzeit in München'] }),
    ein('Standort mit laufender Fahrt', 'Fragen', 'Wo ist Tim gerade?', { art: 'antwort', enthaelt: ['Hauptbahnhof', 'Vier Jahreszeiten'] }),
    ein('Standort ohne Signal', 'Fragen', 'Wo ist Marvin?', { art: 'antwort', enthaelt: ['kein Standort'] }),
    ein('Standort aller Fahrer', 'Fragen', 'Wo sind alle Fahrer?', { art: 'antwort', enthaelt: ['Stefano', 'Bayerischer Hof', 'Tim', 'Hauptbahnhof'] }),

    // --- Neue Fähigkeiten (TODO-Liste), erwartet rot bis gebaut ---
    ein('Tagesfrage: wer hat Luft', 'Neu', 'Wer hat heute noch Luft?', { art: 'antwort', einesVon: ['Marvin', 'Anna'] }),
    ein('Konflikt prüfen', 'Neu', 'Schafft Stefano die 14 Uhr Fahrt nach der um 10:30?', { art: 'antwort', enthaelt: ['ja', 'puffer'], nicht: ['nein'] }),
    ein('Konflikt: geht nicht', 'Neu', 'Schafft Anna übermorgen die 8 Uhr Fahrt nach der um 7?', { art: 'antwort', enthaelt: ['nein'] }),
    ein('Konflikt: kann X übernehmen', 'Neu', 'Kann Marvin die Fahrt um 18 Uhr übernehmen?', { art: 'antwort', enthaelt: ['ja', 'Marvin'] }),
    ein('Fahrervorschlag', 'Neu', 'Wer kann die offene Fahrt um 18 Uhr übernehmen?', { art: 'antwort', enthaelt: ['Marvin', 'Anna', 'Tim'] }),

    // --- Absicht: Fahrt gegen Dienst, Dienst loeschen, mehrere Tage, alle Fahrer, Namenslisten (ki_protokoll 12.11.) ---
    ein('Neue Fahrt mit Start/Ende-Woertern ist kein Dienst', 'Absicht',
      'Neue Fahrt Stefano am Samstag um 11:58 Start in Offenburg am Bahnhof, Ende in München Möhlstr 31',
      { art: ['fahrt_buchen', 'booking_needs_clarification'], nicht: ['Dienst'], vorschlag: { datum: samstag, startZeit: '11:58' } }),
    ein('Fahrt mit Start am Ort und Ziel', 'Absicht', 'Fahrt für Tim morgen um 9 Uhr, Start am Hauptbahnhof München, Ziel Flughafen München',
      { art: ['fahrt_buchen', 'booking_needs_clarification'], nicht: ['Dienst'] }),
    ein('Schick Fahrer eine Fahrt vom Hotel zur Arena mit Gast', 'Absicht',
      'Schicke Stefano Spandri eine Fahrt für morgen 10:30 Uhr vom Hotel Bayerischer Hof zur Allianz Arena mit dem Gast Uli Hoeneß',
      { art: ['fahrt_buchen', 'booking_needs_clarification'], nicht: ['kann keine'], vorschlag: { datum: morgen, startZeit: '10:30' } }),
    ein('Schick Fahrer eine Fahrt fuer jetzt', 'Absicht', 'Schick Stefano Spandri eine Fahrt von Kreillerstraße 210 zur Erner Straße 5 für jetzt',
      { art: ['fahrt_buchen', 'booking_needs_clarification'], nicht: ['kann keine'] }),
    ein('Ausdruecklich Dienststart bleibt Start', 'Absicht', 'Neuer Dienststart für heute 22:00 für Stefano',
      { art: 'dienst_vorschlag', vorschlag: { start: '22:00', ende: null }, nicht: ['als Dienstende', 'Pause'] }),
    ein('Start mit Uhrzeit ist Dienst', 'Absicht', 'Start morgen um 7 für Tim',
      { art: 'dienst_vorschlag', vorschlag: { start: '07:00', datum: morgen } }),
    ein('Tippfehler dienstart', 'Absicht', 'Schick Marvin dienstart für 9:00 Uhr morgen',
      { art: 'dienst_vorschlag', vorschlag: { start: '09:00', datum: morgen, fahrer: 'Marvin' } }),
    ein('Alle Fahrer Dienstbeginn', 'Absicht', 'Für alle Fahrer Dienstbeginn um 10:45 morgen am Flughafen Salzburg',
      { art: 'dienst_vorschlag', vorschlag: { start: '10:45', datum: morgen, fahrer: 'Tim' }, enthaelt: ['alle 4 Fahrer'] }),
    { name: 'Zwei Tage in einer Nachricht, dann ja', gruppe: 'Absicht', schritte: [
      { frage: 'Neuer Dienststart für heute 22:00 und morgen 7:30 für Tim',
        erwartet: { art: 'antwort', enthaelt: ['2 Dienste', '22:00', '07:30', 'ja'] } },
      { frage: 'ja', erwartet: { art: 'antwort', enthaelt: ['heute: gesendet', 'morgen: gesendet'] } },
    ] },
    { name: 'Dienstende loeschen, dann ja', gruppe: 'Absicht', schritte: [
      { frage: 'Lösch das Dienstende für morgen bei Anna', erwartet: { art: 'antwort', enthaelt: ['Anna Berger', '07:00–15:00', 'Dienstende entfernen'] } },
      { frage: 'ja', erwartet: { art: 'antwort', enthaelt: ['Dienstende entfernt', 'erledigt'] } },
      { frage: 'Hat Anna morgen Dienst?', erwartet: { art: 'antwort', enthaelt: ['07:00'], nicht: ['15:00'] } },
    ] },
    { name: 'Dienst absagen, dann nein', gruppe: 'Absicht', schritte: [
      { frage: 'Dienst von Anna morgen absagen', erwartet: { art: 'antwort', enthaelt: ['ganzen Dienst löschen'] } },
      { frage: 'nein', erwartet: { art: 'antwort', enthaelt: ['nichts geändert'] } },
    ] },
    { name: 'Dienststart von gestern loeschen (Tippfehler dienstart)', gruppe: 'Absicht', schritte: [
      { frage: 'Lösche dienstart von Stefano von gestern', erwartet: { art: 'antwort', enthaelt: ['gestern', '22:00–23:30', 'Dienststart entfernen'], nicht: ['heute'] } },
      { frage: 'ja', erwartet: { art: 'antwort', enthaelt: ['Dienststart entfernt', 'gestern'] } },
    ] },
    ein('Dienst letzten Freitag abfragen', 'Absicht', 'Hatte Stefano gestern Dienst?', { art: 'antwort', enthaelt: ['22:00'] }),
    ein('Pause loeschen', 'Absicht', 'Pause von Anna morgen löschen', { art: 'antwort', enthaelt: ['Pausen entfernen'] }),
    ein('Feierabend loeschen ohne Ende, nie Fahrer loeschen', 'Absicht', 'Lösche Stefanos Feierabend heute',
      { art: 'antwort', enthaelt: ['kein Dienstende'], nicht: ['endgültig'] }),
    { name: 'Namensliste ohne Auftrag, dann ja', gruppe: 'Absicht', schritte: [
      { frage: 'Marvin Bendrix  Gregor Müller  Konrad Skurej', erwartet: { art: 'antwort', enthaelt: ['als neue Fahrer anlegen'] } },
      { karten: true, frage: 'ja', erwartet: { art: 'antwort', karten: ['fahrer_proposal', 'fahrer_proposal', 'fahrer_proposal'] } },
    ] },
    ein('Fahrt mit allen Fahrern', 'Absicht', 'Erstelle eine Fahrt mit allen Fahrern morgen um 11:30 vom Flughafen Salzburg zum Herbert von Karajan Platz in Salzburg',
      { art: 'fahrt_buchen', enthaelt: ['alle 4 Fahrer'], vorschlag: { fahrerNamen: 'Anna Berger' } }),
    // Ein Fahrzeug je Fahrer (Stefano, Tim, Anna haben eins, Marvin nicht).
    { name: 'Allen Fahrern ein Fahrzeug, Karten', gruppe: 'Absicht', schritte: [
      { karten: true, frage: 'Erstelle allen Fahrern ein Fahrzeug. Alles Mercedes V Klasse',
        erwartet: { art: 'antwort', karten: ['fahrzeug_proposal'], enthaelt: ['Marvin Keller', 'schon ein Fahrzeug'] } },
    ] },
    { name: 'Allen Fahrern auch mit Fahrzeug', gruppe: 'Absicht', schritte: [
      { karten: true, frage: 'Erstelle allen Fahrern ein Fahrzeug Mercedes V-Klasse, auch die mit Fahrzeug',
        erwartet: { art: 'antwort', karten: ['fahrzeug_proposal', 'fahrzeug_proposal', 'fahrzeug_proposal', 'fahrzeug_proposal'], enthaelt: ['4 Fahrzeuge'] } },
    ] },
    { name: 'Fahrzeug fuer einen Fahrer ohne Karten, dann ja', gruppe: 'Absicht', schritte: [
      { frage: 'Neues Fahrzeug BMW X5 für Marvin, Kennzeichen M-TR 150', erwartet: { art: 'antwort', enthaelt: ['BMW X5', 'Fahrer: Marvin Keller', 'M-TR 150'] } },
      { frage: 'ja', erwartet: { art: 'antwort', enthaelt: ['Angelegt', 'für Marvin Keller'] } },
      { frage: 'Welches Auto fährt Marvin?', erwartet: { art: 'antwort', enthaelt: ['M-TR 150'] } },
    ] },
    ein('Jedem Fahrer ohne Modell fragt nach', 'Absicht', 'Kannst du für jeden Fahrer ein Fahrzeug erstellen',
      { art: 'antwort', enthaelt: ['Marke und welches Modell'] }),
    // Dienststart/Dienstende-Grenzfaelle (werkzeuge/ki-test/dienst-grenzfaelle.ts).
    ein('Dienststart und Dienstende mit nackten Zahlen', 'Absicht', 'Dienststart 7 und Dienstende 16 für Tim morgen',
      { art: 'dienst_vorschlag', vorschlag: { start: '07:00', ende: '16:00' } }),
    ein('Ende vor Start genannt', 'Absicht', 'Tim morgen Ende 16 Start 7', { art: 'dienst_vorschlag', vorschlag: { start: '07:00', ende: '16:00' } }),
    ein('Name und Uhrzeit ist Dienststart', 'Absicht', 'Tim kommt morgen um 7', { art: 'dienst_vorschlag', vorschlag: { start: '07:00', ende: null } }),
    ein('bis Uhrzeit ist Dienstende', 'Absicht', 'Tim morgen bis 16 Uhr', { art: 'dienst_vorschlag', vorschlag: { start: null, ende: '16:00' } }),
    ein('Uhrzeit mitten im Dienst fragt nach', 'Absicht', 'Anna morgen 12 Uhr', { art: ['antwort', 'rueckfrage'], enthaelt: ['mitten im Dienst'] }),
    ein('Ende in Ort ist kein Dienst', 'Absicht', 'Ende in München für Tim morgen 9 Uhr', { art: ['fahrt_buchen', 'booking_needs_clarification', 'rueckfrage', 'antwort'], nicht: ['Dienststart'] }),
    // Fehlgriffe aus werkzeuge/ki-test/abdeckung.ts (13.11.)
    ein('Nachricht mit Uhrzeit ist kein Dienst', 'Fehlgriff', 'Schreib allen Fahrern: Morgen Treffpunkt 7 Uhr Halle B', { art: ['antwort', 'rueckfrage'], nicht: ['Dienststart'] }),
    ein('Kunde BMW ist kein Fahrzeug', 'Fehlgriff', 'Leg den Kunden BMW Group an', { art: 'antwort', enthaelt: ['Kunden'], nicht: ['Fahrzeug, prüfe'] }),
    ein('Gast anlegen fragt nach', 'Fehlgriff', 'Leg den Gast Uli Hoeneß an, Telefon 0170 1234567', { art: 'antwort', enthaelt: ['Neuer Gast'] }),
    ein('Telefon eines Gastes', 'Fehlgriff', 'Welche Telefonnummer hat Julia Weber?', { art: 'antwort', enthaelt: ['+49 170 333'] }),
    ein('Firma eines Gastes', 'Fehlgriff', 'Bei welcher Firma ist Julia Weber?', { art: 'antwort', enthaelt: ['BMW Group'] }),
    ein('Telefon eines Fahrers bleibt Fahrer', 'Fehlgriff', 'Welche Telefonnummer hat Tim?', { art: 'antwort', enthaelt: ['+49 151 2'] }),
    ein('Standbys anzeigen', 'Fehlgriff', 'Welche Standbys gibt es morgen?', { art: 'antwort', enthaelt: ['Kongress', '10:00–18:00', 'Tim Schedler'] }),
    { name: 'Standby fuer einen Fahrer loeschen, dann ja', gruppe: 'Fehlgriff', schritte: [
      { frage: 'Lösch den Standby von Tim morgen', erwartet: { art: 'antwort', enthaelt: ['Tim Schedler aus dem Standby', 'anderen bleiben'], nicht: ['Es fehlt'] } },
      { frage: 'ja', erwartet: { art: 'antwort', enthaelt: ['aus dem Standby raus'] } },
      { frage: 'Welche Standbys gibt es morgen?', erwartet: { art: 'antwort', enthaelt: ['Marvin Keller'], nicht: ['Tim Schedler'] } },
    ] },
    { name: 'Standby verschieben, dann ja', gruppe: 'Fehlgriff', schritte: [
      { frage: 'Verschieb den Standby von Tim morgen auf 12 bis 20 Uhr', erwartet: { art: 'antwort', enthaelt: ['12:00–20:00', 'ändern'], nicht: ['Es fehlt'] } },
      { frage: 'ja', erwartet: { art: 'antwort', enthaelt: ['jetzt 12:00–20:00'] } },
    ] },
    { name: 'Dienste fuer ganze Woche, dann ja', gruppe: 'Fehlgriff', schritte: [
      { frage: 'Plan die Dienste für nächste Woche, jeden Tag 7 bis 15 für Tim', erwartet: { art: 'antwort', enthaelt: ['7 Dienste', 'Tim Schedler', '07:00', '15:00', 'ja'] } },
      { frage: 'ja', erwartet: { art: 'antwort', enthaelt: ['gesendet'], nicht: ['nicht gesendet'] } },
      { frage: 'Lösch alle Dienste von Tim nächste Woche', erwartet: { art: 'antwort', enthaelt: ['ganzen Dienst löschen', '7 Dienste', 'ja, löschen'] } },
      // Ab 3 Diensten reicht ein blosses "ja" nicht (15.11.).
      { frage: 'ja', erwartet: { art: 'antwort', enthaelt: ['Zur Sicherheit'], nicht: ['erledigt'] } },
      { frage: 'ja, löschen', erwartet: { art: 'antwort', enthaelt: ['Dienst gelöscht', 'erledigt'] } },
    ] },
    ein('Dienste werktags', 'Fehlgriff', 'Tim nächste Woche werktags 8 bis 16', { art: 'antwort', enthaelt: ['5 Dienste'] }),
    ein('Notiz an Fahrt ist keine Gaeste-Frage', 'Fehlgriff', 'Gib der Fahrt von Herrn Engel die Notiz Kindersitz', { art: ['antwort', 'rueckfrage', 'fahrt_aendern'], nicht: ['keine besonderen Hinweise'] }),
    ein('Wer hat morgen Dienst', 'Fehlgriff', 'Wer hat morgen Dienst?', { art: 'antwort', enthaelt: ['Anna Berger', '07:00–15:00'], nicht: ['Tim'] }),
    // --- Steuern: alles, was die Dispo kann (werkzeuge/ki-test/abdeckung.ts) ---
    { name: 'Fahrt stornieren, dann rueckgaengig', gruppe: 'Steuern', schritte: [
      { frage: 'Storniere die Fahrt von Herrn Engel', erwartet: { art: 'antwort', enthaelt: ['10:30', 'Horst Engel', 'stornieren?'] } },
      { frage: 'ja', erwartet: { art: 'antwort', enthaelt: ['Storniert'] } },
      { frage: 'Mach das rückgängig', erwartet: { art: 'antwort', enthaelt: ['Rückgängig gemacht'] } },
    ] },
    { name: 'Fahrt loeschen braucht loeschen', gruppe: 'Steuern', schritte: [
      { frage: 'Lösche die Fahrt von Julia Weber endgültig', erwartet: { art: 'antwort', enthaelt: ['endgültig löschen', '„löschen“'] } },
      { frage: 'ja', erwartet: { art: 'antwort', enthaelt: ['„löschen“'] } },
      { frage: 'löschen', erwartet: { art: 'antwort', enthaelt: ['Gelöscht'] } },
    ] },
    { name: 'Fahrt erledigt', gruppe: 'Steuern', schritte: [
      { frage: 'Markiere die Fahrt von Herrn Engel als erledigt', erwartet: { art: 'antwort', enthaelt: ['als erledigt markieren'] } },
      { frage: 'ja', erwartet: { art: 'antwort', enthaelt: ['Erledigt'] } },
    ] },
    { name: 'Fahrt kopieren', gruppe: 'Steuern', schritte: [
      { frage: 'Kopiere die Fahrt von Herrn Engel auf übermorgen', erwartet: { art: 'antwort', enthaelt: ['kopieren', 'ohne Fahrer'] } },
      { frage: 'ja', erwartet: { art: 'antwort', enthaelt: ['Kopiert'] } },
    ] },
    { name: 'Notiz an Fahrt', gruppe: 'Steuern', schritte: [
      { frage: 'Gib der Fahrt von Herrn Engel die Notiz Kindersitz', erwartet: { art: 'antwort', enthaelt: ['„Kindersitz“'] } },
      { frage: 'ja', erwartet: { art: 'antwort', enthaelt: ['Notiz gespeichert'] } },
    ] },
    ein('Fahrt mehrdeutig fragt nach', 'Steuern', 'Storniere die Fahrt von Stefano', { art: 'antwort', enthaelt: ['Mehrere Fahrten'] }),
    { name: 'Nachricht an alle', gruppe: 'Steuern', schritte: [
      { frage: 'Schreib allen Fahrern: Morgen Treffpunkt 7 Uhr Halle B', erwartet: { art: 'antwort', enthaelt: ['alle 4 Fahrer', 'Treffpunkt 7 Uhr Halle B'], nicht: ['Dienststart'] } },
      { frage: 'ja', erwartet: { art: 'antwort', enthaelt: ['Gesendet'] } },
    ] },
    ein('Nachricht an einen', 'Steuern', 'Schick Tim eine Nachricht, dass er sich melden soll', { art: 'antwort', einesVon: ['melde', 'melden'], enthaelt: ['Tim Schedler'] }),
    { name: 'Telefon Fahrer aendern, dann rueckgaengig', gruppe: 'Steuern', schritte: [
      { frage: 'Ändere die Telefonnummer von Tim auf 0151 555666', erwartet: { art: 'antwort', enthaelt: ['Tim Schedler', '0151 555666'] } },
      { frage: 'ja', erwartet: { art: 'antwort', enthaelt: ['Gespeichert'] } },
      { frage: 'Welche Telefonnummer hat Tim?', erwartet: { art: 'antwort', enthaelt: ['0151 555666'] } },
      { frage: 'rückgängig', erwartet: { art: 'antwort', enthaelt: ['Rückgängig gemacht'] } },
      { frage: 'Welche Telefonnummer hat Tim?', erwartet: { art: 'antwort', enthaelt: ['+49 151 2'] } },
    ] },
    ein('Fahrernummer', 'Steuern', 'Gib Marvin die Fahrernummer 20', { art: 'antwort', enthaelt: ['Fahrernummer 20'] }),
    ein('Fahrernummer belegt', 'Steuern', 'Gib Marvin die Fahrernummer 113', { art: 'antwort', enthaelt: ['hat schon Tim'] }),
    ein('Flagge', 'Steuern', 'Markier Tim mit einer roten Flagge', { art: 'antwort', enthaelt: ['Flagge 2 (Pink)'] }),
    ein('Passwort', 'Steuern', 'Setz das Passwort von Tim zurück', { art: 'antwort', enthaelt: ['neues Passwort erzeugen', 'abgemeldet'] }),
    ein('Passwort alle verweigert', 'Steuern', 'Setz das Passwort von allen Fahrern zurück', { art: 'antwort', enthaelt: ['nur einzeln'] }),
    ein('Kennzeichen aendern', 'Steuern', 'Ändere das Kennzeichen von M-TR 101 auf M-TR 111', { art: 'antwort', enthaelt: ['M-TR 111', 'BMW 7er'] }),
    ein('Reichweite', 'Steuern', 'Wie viel Reichweite hat M-TR 102 noch?', { art: 'antwort', enthaelt: ['312 km', '54 %'] }),
    ein('Tracker-Stufe', 'Steuern', 'Stell alle Tracker auf fein', { art: 'antwort', enthaelt: ['Stufe fein', 'Datenvolumen'] }),
    { name: 'Gast anlegen', gruppe: 'Steuern', schritte: [
      { frage: 'Leg den Gast Uli Hoeneß an, Telefon 0170 1234567', erwartet: { art: 'antwort', enthaelt: ['Uli Hoeneß', '0170 1234567'] } },
      { frage: 'ja', erwartet: { art: 'antwort', enthaelt: ['Gast angelegt'] } },
      { frage: 'Welche Telefonnummer hat Uli Hoeneß?', erwartet: { art: 'antwort', enthaelt: ['0170 1234567'] } },
    ] },
    ein('Gast Telefon aendern', 'Steuern', 'Ändere die Telefonnummer von Julia Weber auf 0171 999888', { art: 'antwort', enthaelt: ['Julia Weber', '0171 999888'] }),
    ein('Stundenzettel bestaetigen', 'Steuern', 'Bestätige den Stundenzettel von Marvin', { art: 'antwort', enthaelt: ['Marvin Keller', '6:30 h', 'bestätige'] }),
    ein('Stunden-Export zeigt Weg', 'Steuern', 'Exportiere die Stunden vom Oktober', { art: 'antwort', enthaelt: ['Export'] }),
    ein('Wie viele Fahrer', 'Steuern', 'Wie viele Fahrer brauche ich heute?', { art: 'antwort', enthaelt: ['gleichzeitig'] }),
    ein('Hilfe', 'Steuern', 'Was kannst du alles?', { art: 'antwort', enthaelt: ['stornieren', 'rückgängig'] }),
    ein('Rueckgaengig ohne Aenderung', 'Steuern', 'Mach das rückgängig', { art: 'antwort', enthaelt: ['nichts geändert'] }),
    ein('Verspaetete Fahrten', 'Steuern', 'Welche Fahrten sind heute verspätet?', { art: 'antwort', einesVon: ['Verspätet', 'keine Fahrt verspätet'] }),
    ein('Freie Fahrzeuge', 'Steuern', 'Welches Fahrzeug ist gerade frei?', { art: 'antwort', einesVon: ['Keinem Fahrer zugeordnet', 'Alle Fahrzeuge sind'] }),
    ein('Fahrten eines Kunden', 'Steuern', 'Welche Fahrten hatte der Kunde BMW diesen Monat?', { art: 'antwort', enthaelt: ['Julia Weber'] }),
    ein('Nachricht mit dass', 'Steuern', 'Schick Tim eine Nachricht, dass er pünktlich sein soll', { art: 'antwort', enthaelt: ['Tim Schedler', 'pünktlich'] }),
    ein('Nachricht an mit Doppelpunkt', 'Steuern', 'Schicke eine Nachricht an Stefano: beeil dich bitte', { art: 'antwort', enthaelt: ['Stefano Spandri', 'beeil dich bitte'] }),
    { name: 'Nachricht ohne Empfaenger, dann Name', gruppe: 'Steuern', schritte: [
      { frage: 'Schreib eine Nachricht: Treffpunkt Halle B', erwartet: { art: 'antwort', enthaelt: ['An wen', 'Treffpunkt Halle B'] } },
      { frage: 'Stefano', erwartet: { art: 'antwort', enthaelt: ['Push an Stefano Spandri', 'Treffpunkt Halle B'] } },
      { frage: 'ja', erwartet: { art: 'antwort', enthaelt: ['Gesendet'] } },
    ] },
    { name: 'Nachricht ohne Text, dann Text', gruppe: 'Steuern', schritte: [
      { frage: 'Schick Tim eine Nachricht', erwartet: { art: ['antwort', 'rueckfrage'], enthaelt: ['Was soll', 'Tim Schedler'] } },
      { frage: 'Bitte zum Terminal 2 kommen', erwartet: { art: 'antwort', enthaelt: ['Push an Tim Schedler', 'Terminal 2'] } },
    ] },
    ein('Namensliste bekannter Fahrer', 'Absicht', 'Tim Schedler Anna Berger', { art: 'antwort', enthaelt: ['schon Fahrer'] }),
    // --- Frei formuliert: Felder liest das Modell (verstehen.ts befehlAusFeldern), nur mit --verstehen sinnvoll ---
    ein('Frei: halb 8 morgen', 'Frei', 'tim soll morgen um halb acht anfangen', { art: 'dienst_vorschlag', vorschlag: { start: '07:30', datum: morgen, fahrer: 'Tim' } }),
    ein('Frei: viertel nach sechs', 'Frei', 'Marvin übermorgen viertel nach sechs bis halb drei', { art: 'dienst_vorschlag', vorschlag: { start: '06:15', ende: '14:30', datum: uebermorgen } }),
    ein('Frei: Feierabend jetzt', 'Frei', 'Tim kann jetzt nach Hause gehen', { art: 'dienst_vorschlag', vorschlag: { start: null } }),
    ein('Frei: Schicht mit Pause', 'Frei', 'Tim morgen Schicht 7 bis 16, Mittagspause 12 bis halb eins', { art: 'dienst_vorschlag', vorschlag: { start: '07:00', ende: '16:00', pausen: '12:00-12:30' } }),
    ein('Frei: Wochentag', 'Frei', 'Anna arbeitet nächsten Montag von 9 bis 17', { art: 'dienst_vorschlag', vorschlag: { start: '09:00', ende: '17:00', fahrer: 'Anna' } }),
    { name: 'Frei: Dienst von gestern weg', gruppe: 'Frei', schritte: [
      { frage: 'stefanos schicht gestern war doch nicht, bitte raus damit', erwartet: { art: 'antwort', enthaelt: ['gestern', 'Dienst löschen'] } },
    ] },
    ein('Frei: nur Dienstende weg', 'Frei', 'bei Anna morgen das Ende rausnehmen, die bleibt offen', { art: 'antwort', enthaelt: ['Anna Berger', 'Dienstende entfernen'] }),
    ein('Frei: Pause weg', 'Frei', 'Anna braucht morgen keine Pause', { art: 'antwort', enthaelt: ['Pausen entfernen'] }),
    ein('Frei: Standby anzeigen', 'Frei', 'wer steht morgen alles auf standby?', { art: 'antwort', enthaelt: ['Kongress'] }),
    ein('Frei: Standby verschieben', 'Frei', 'den standby morgen bitte erst ab 12 und dafür bis 20', { art: 'antwort', enthaelt: ['12:00–20:00'] }),
    ein('Frei: Fahrt absagen', 'Frei', 'Herr Engel hat abgesagt, die Fahrt um halb elf fällt weg', { art: 'antwort', enthaelt: ['Horst Engel', 'stornieren?'] }),
    ein('Frei: Fahrt erledigt', 'Frei', 'Engel ist abgeliefert, kannst die Fahrt abhaken', { art: 'antwort', enthaelt: ['als erledigt markieren'] }),
    ein('Frei: Fahrt kopieren', 'Frei', 'die Fahrt von Frau Weber brauch ich nächsten Montag nochmal genauso', { art: 'antwort', enthaelt: ['kopieren', 'Julia Weber'] }),
    ein('Frei: Notiz', 'Frei', 'bei der Engel-Fahrt bitte vermerken: Gast hat zwei Koffer', { art: 'antwort', enthaelt: ['zwei Koffer'] }),
    // --- Gespräche über mehrere Schritte ---
    { name: 'Liste, dann zweite verschieben', gruppe: 'Gespräch', schritte: [
      { frage: 'Welche Fahrten hat Stefano heute?', erwartet: { art: 'antwort', enthaelt: ['10:30'] } },
      { frage: 'Verschieb die zweite auf 15 Uhr', erwartet: { art: 'fahrt_aendern', vorschlag: { fahrtId: ID.fahrtMueller, startZeit: '15:00' } } },
    ] },
    { name: 'Buchung ergänzen', gruppe: 'Gespräch', schritte: [
      { frage: 'Buche morgen 9 Uhr Hauptbahnhof zum Flughafen Terminal 2', erwartet: { art: ['fahrt_buchen', 'booking_needs_clarification'] } },
      { frage: 'Für Markus Müller, Fahrer Anna', erwartet: { art: 'fahrt_buchen', vorschlag: { startZeit: '09:00', fahrgaeste: 'Müller', fahrerNamen: 'Anna' } } },
    ] },
    { name: 'Änderung korrigieren', gruppe: 'Gespräch', schritte: [
      { frage: 'Verschieb die Fahrt von Herrn Engel auf 11 Uhr', erwartet: { art: 'fahrt_aendern', vorschlag: { startZeit: '11:00' } } },
      { frage: 'doch lieber 11:30', erwartet: { art: 'fahrt_aendern', vorschlag: { fahrtId: ID.fahrtEngel, startZeit: '11:30' } } },
    ] },
    { name: 'Standort der beiden', gruppe: 'Gespräch', schritte: [
      { frage: 'Was machen Stefano und Tim heute?', erwartet: { art: 'antwort', enthaelt: ['10:30', '14:00', '09:00'] } },
      { frage: 'Wo sind die beiden gerade?', erwartet: { art: 'antwort', enthaelt: ['Bayerischer Hof', 'Hauptbahnhof'], nicht: ['Marvin', 'Anna'] } },
    ] },
    { name: 'Buchung: fehlendes Ziel nachreichen', gruppe: 'Gespräch', schritte: [
      { frage: 'Ich brauche ein Auto morgen um 7 vom Hotel Bayerischer Hof', erwartet: { art: ['booking_needs_clarification', 'rueckfrage'] } },
      { frage: 'Zum Flughafen Terminal 2', erwartet: { art: 'fahrt_buchen', vorschlag: { datum: morgen, startZeit: '07:00', start: 'Bayerischer Hof', ziel: 'Terminal 2' } } },
    ] },
    { name: 'Vorschlag übernehmen', gruppe: 'Gespräch', schritte: [
      { frage: 'Wer kann die offene Fahrt um 18 Uhr übernehmen?', erwartet: { art: 'antwort', enthaelt: ['Anna'] } },
      { frage: 'Gib die Fahrt Anna', erwartet: { art: 'fahrt_aendern', vorschlag: { fahrtId: ID.fahrtOffen, fahrerNamen: 'Anna' } } },
    ] },
    { name: 'Neue Frage statt Auswahl', gruppe: 'Gespräch', schritte: [
      { frage: 'Verschieb die Fahrt von Stefano auf 16 Uhr', erwartet: { art: 'rueckfrage' } },
      { frage: 'Wo ist Stefano?', erwartet: { art: 'antwort', enthaelt: ['Bayerischer Hof'] } },
    ] },
    { name: 'Rückfrage beantworten', gruppe: 'Gespräch', schritte: [
      { frage: 'Verschieb die Fahrt von Stefano auf 16 Uhr', erwartet: { art: 'rueckfrage' } },
      { frage: 'die um 14 Uhr', erwartet: { art: 'fahrt_aendern', vorschlag: { fahrtId: ID.fahrtMueller, startZeit: '16:00' } } },
    ] },

    // --- Mensch (15.11.): Fehler aus dem ki_protokoll und dem Test wie in der App (mensch-test.ts) ---
    ein('Pause setzt kein Dienstende', 'Mensch', 'Pause für Anna morgen von 12 bis 12:30',
      { art: 'dienst_vorschlag', vorschlag: { datum: morgen, pausen: '12:00-12:30', ende: null, start: null }, nicht: ['Dienstende'] }),
    ein('Pause mit Dauer', 'Mensch', 'stefano 30 min pause um 13 uhr',
      { art: 'dienst_vorschlag', vorschlag: { datum: heute, pausen: '13:00-13:30', ende: null }, nicht: ['Dienstende'] }),
    ein('Pause jetzt', 'Mensch', 'tim macht jetzt pause',
      { art: 'dienst_vorschlag', vorschlag: { datum: heute, ende: null, start: null, fahrer: 'Tim' }, enthaelt: ['Pause 11:'], nicht: ['Dienstende'] }),
    ein('Tippfehler morgn', 'Mensch', 'tim morgn ab 7', { art: 'dienst_vorschlag', vorschlag: { datum: morgen, start: '07:00', fahrer: 'Tim' } }),
    ein('Verhoert Dienst statt', 'Mensch', 'Schick Stefano Spandri den Dienst statt für 23:30 Uhr heute',
      { art: 'dienst_vorschlag', vorschlag: { datum: heute, start: '23:30', ende: null } }),
    // Wochentag von morgen und heute, damit der Fall an jedem Tag gilt (am 15.11. stand hier fest "Montag").
    ein('Wochentag von morgen ist morgen', 'Mensch', `Habe ausversehen den Dienststart für alle am ${wochentag(morgen)} eingetragen um 10:30, bitte den löschen`,
      { art: 'antwort', enthaelt: ['Anna Berger', 'morgen'] }),
    ein('Wochentag von heute meint beim Löschen heute', 'Mensch', `Habe ausversehen den Dienststart für alle am ${wochentag(heute)} eingetragen, bitte den löschen`,
      { art: 'antwort', enthaelt: ['Stefano Spandri', 'heute'] }),
    ein('Kein Dienst am Tag, klarer Satz', 'Mensch', 'Lösch den Dienst von Marvin morgen', { art: 'antwort', enthaelt: ['Marvin Keller hat morgen keinen Dienst'] }),
    ein('Fahrzeug-Frage nein', 'Mensch', 'Bekommt Tim den BMW', { art: 'antwort', enthaelt: ['Nein', 'Mercedes V-Klasse', 'M-TR 102'], nicht: ['Ja, Tim'] }),
    ein('Fahrzeug-Frage ja', 'Mensch', 'Fährt Tim den Mercedes?', { art: 'antwort', enthaelt: ['Ja, Tim Schedler fährt Mercedes V-Klasse'] }),
    ein('Wer fährt das Modell', 'Mensch', 'Wer fährt den X5', { art: 'antwort', enthaelt: ['BMW X5 (M-TR 103)', 'Anna Berger'] }),
    ein('Fahrt am zum', 'Mensch', 'Stefano soll Heute um 20:30 Uhr am Flughafen München zum Flughafen in Salzburg fahren ohne Gast',
      { art: 'fahrt_buchen', vorschlag: { datum: heute, startZeit: '20:30', start: 'Flughafen München', ziel: 'Salzburg', fahrerNamen: 'Stefano' }, nicht: ['ohne Gast', 'keine anstehende'] }),
    ein('Fahrt mit allen ausser einem, frei gesagt', 'Mensch', 'Heute am Sonntag den 15. November alle Fahrer außer außer Marvin von der Messe München zum Flughafen München um 14:30',
      { art: 'fahrt_buchen', vorschlag: { startZeit: '14:30', start: 'Messe', fahrerNamen: 'Tim' }, enthaelt: ['ohne Marvin'] }),
    ein('Fahrt halb 4 klein getippt', 'Mensch', 'brauch ne fahrt um halb 4 vom bayerischen hof zum flughafen für herrn engel, tim fährt',
      { art: 'fahrt_buchen', vorschlag: { startZeit: '15:30', start: 'Bayerischer Hof', fahrgaeste: 'Engel', fahrerNamen: 'Tim' } }),
    { name: 'Zweite Fahrt ist eine neue', gruppe: 'Mensch', schritte: [
      { frage: 'Erstelle eine Fahrt heute am Sonntag um 15:00 vom Hotel Bayerischer Hof zur Messe mit 3 Personen', erwartet: { art: 'fahrt_buchen', vorschlag: { startZeit: '15:00' } } },
      { frage: 'Dann 17:00 Messe zu Flughafen München t2 1 Person mit Marvin als Fahrer  Der Gast ist sekura Jun',
        erwartet: { art: 'fahrt_buchen', vorschlag: { startZeit: '17:00', start: 'Messe', fahrerNamen: 'Marvin' }, nicht: ['angepasst'] } },
    ] },
    { name: 'Korrektur bleibt Korrektur', gruppe: 'Mensch', schritte: [
      { frage: 'Erstelle eine Fahrt heute um 15:00 vom Hotel Bayerischer Hof zur Messe mit 3 Personen', erwartet: { art: 'fahrt_buchen' } },
      { frage: 'doch lieber 16 uhr', erwartet: { art: 'fahrt_buchen', vorschlag: { startZeit: '16:00', start: 'Bayerischer Hof' }, enthaelt: ['angepasst'] } },
    ] },
    { name: 'Buchen Schritt fuer Schritt, Heute ist kein Ziel', gruppe: 'Mensch', schritte: [
      { frage: 'Buche', erwartet: { art: 'booking_needs_clarification' } },
      { frage: 'Heute', erwartet: { art: 'booking_needs_clarification', nicht: ['nach Heute'] } },
      { frage: 'Heute 20:30 Uhr', erwartet: { art: 'booking_needs_clarification', enthaelt: ['20:30'], nicht: ['nach Heute'] } },
      { frage: 'vom Hauptbahnhof', erwartet: { art: 'booking_needs_clarification', enthaelt: ['Hauptbahnhof'] } },
      { frage: 'zur Messe', erwartet: { art: 'fahrt_buchen', vorschlag: { startZeit: '20:30', start: 'Hauptbahnhof', ziel: 'Messe' } } },
    ] },
    { name: 'Getipptes Ja nach Karte erfindet nichts', gruppe: 'Mensch', schritte: [
      { frage: 'Dienststart für Tim morgen um 7', erwartet: { art: 'dienst_vorschlag' } },
      { frage: 'Ja', erwartet: { art: 'antwort', enthaelt: ['Knopf'], nicht: ['gesendet', 'geändert.'] } },
      { frage: 'Ok dann schick Tim heim', erwartet: { art: 'dienst_vorschlag', vorschlag: { datum: heute, fahrer: 'Tim' }, enthaelt: ['Dienstende'] } },
    ] },
    ein('Zwei Dienste in einem Satz', 'Mensch', 'tim morgen 8 bis 16 und anna morgen 9 bis 17',
      { art: 'dienst_vorschlag', vorschlag: { start: '08:00', ende: '16:00', fahrer: 'Tim' }, enthaelt: ['Noch nicht bearbeitet', 'anna morgen 9 bis 17'], nicht: ['Anna Berger'] }),
    ein('Zwei Fahrer ein Dienst bleibt einer', 'Mensch', 'Tim und Anna morgen 8 bis 16',
      { art: 'dienst_vorschlag', vorschlag: { start: '08:00', ende: '16:00', fahrer: 'Anna' }, nicht: ['Noch nicht bearbeitet'] }),
    ein('Gruss ohne Modell', 'Mensch', 'Hallo', { art: ['antwort', 'rueckfrage'], enthaelt: ['Was kann ich für dich tun'] }),
    // --- Härte (15.11.): Befunde aus dem Haertetest ---
    { name: 'Neuer Auftrag statt ja', gruppe: 'Härte', schritte: [
      { frage: 'Lösch den Dienst von Anna morgen', erwartet: { art: 'antwort', enthaelt: ['löschen?'] } },
      { frage: 'Bitte gib Tim morgen 7 Uhr Dienststart', erwartet: { art: 'dienst_vorschlag', vorschlag: { start: '07:00', fahrer: 'Tim' }, enthaelt: ['verworfen'], nicht: ['gelöscht'] } },
    ] },
    { name: 'Nein plus neuer Auftrag', gruppe: 'Härte', schritte: [
      { frage: 'Lösch den Dienst von Anna morgen', erwartet: { art: 'antwort' } },
      { frage: 'Nein, gib ihr lieber Dienststart 9 Uhr morgen', erwartet: { art: 'dienst_vorschlag', vorschlag: { start: '09:00', fahrer: 'Anna' } } },
    ] },
    ein('Ohne Bezug keine erfundenen Zeiten', 'Härte', 'und für anna auch', { art: ['antwort', 'rueckfrage'], nicht: ['23:59', '00:00', 'alle 4 Fahrer'] }),
    ein('Fahrt in der Vergangenheit warnt', 'Härte', 'Fahrt gestern um 9 vom Hauptbahnhof zum Flughafen', { art: 'fahrt_buchen', enthaelt: ['Vergangenheit'] }),
    ein('Zuordnen frei gesagt', 'Härte', 'ordne Marvin das Auto M-TR 103 zu', { art: 'antwort', enthaelt: ['Marvin Keller', 'M-TR 103', 'ja'] }),
    ein('Zuordnen ueber Modell', 'Härte', 'Marvin fährt ab jetzt den BMW X5', { art: 'antwort', enthaelt: ['Marvin Keller', 'M-TR 103'] }),
    ein('Tracker ueber Modell', 'Härte', 'steck den Tracker 4 in den X5', { art: 'antwort', enthaelt: ['Tracker 4', 'M-TR 103'] }),
    ein('Gast anlegen frei gesagt', 'Härte', 'leg einen gast an: Dr. Peter Lang, BMW, 0172 999888', { art: 'antwort', enthaelt: ['Neuer Gast', 'Peter Lang'] }),
    ein('Kindersitz-Frage', 'Härte', 'braucht frau weber einen kindersitz', { art: 'antwort', enthaelt: ['Kindersitz'], nicht: ['nicht in den Daten', 'nicht vorhanden'] }),
    ein('Bereitstehen ist Standby', 'Härte', 'Tim soll morgen von 10 bis 18 am Bayerischen Hof bereitstehen', { art: ['antwort', 'rueckfrage'], enthaelt: ['Standby', '10:00', '18:00', 'Tim'] }),
    ein('Nachricht mit frei', 'Härte', 'Schreib allen dass morgen frei ist', { art: 'antwort', enthaelt: ['Push an alle', 'frei'], nicht: ['löschen'] }),
    ein('Ausnahme nicht im Push-Text', 'Härte', 'Sag allen außer Tim, dass sie heute tanken sollen', { art: 'antwort', enthaelt: ['ohne Tim'], nicht: ['außer du', 'außer Tim,'] }),
    // 16.11.: 24 Uhr, Fahrzeug nach Marke, Fragen ohne Bezug.
    ein('24 Uhr als Ende', 'Härte', 'Dienstende für Tim heute 24 Uhr', { art: 'dienst_vorschlag', vorschlag: { ende: '00:00', fahrer: 'Tim' } }),
    ein('Bis 24 Uhr', 'Härte', 'Tim Dienst morgen von 16 bis 24 Uhr', { art: 'dienst_vorschlag', vorschlag: { start: '16:00', ende: '00:00', fahrer: 'Tim' } }),
    ein('24 Uhr als Beginn', 'Härte', 'Dienststart für Tim morgen um 24 Uhr', { art: 'antwort', enthaelt: ['nicht eindeutig'] }),
    { name: 'Marke mit zwei Fahrzeugen', gruppe: 'Härte', schritte: [
      { frage: 'Gib Tim den BMW', erwartet: { art: ['antwort', 'rueckfrage'], enthaelt: ['Welches Fahrzeug', 'M-TR 101', 'M-TR 103'] } },
      { frage: 'den 7er', erwartet: { art: ['antwort', 'rueckfrage'], enthaelt: ['Tim Schedler bekommt BMW 7er', 'ja'] } },
    ] },
    ein('Frage ohne Bezug', 'Härte', 'Was macht der gerade', { art: ['antwort', 'rueckfrage'], enthaelt: ['Wen meinst du'], nicht: ['Stefano', 'Anna'] }),
    { name: 'Folgefrage mit Bezug', gruppe: 'Härte', schritte: [
      { frage: 'Wie viele Stunden hat Tim heute', erwartet: { art: 'antwort', enthaelt: ['Tim'] } },
      { frage: 'Was macht der gerade', erwartet: { art: ['antwort', 'rueckfrage'], nicht: ['Wen meinst du'] } },
    ] },
    ein('Unbekannter Name', 'Härte', 'Wo ist der Band gerade', { art: ['antwort', 'rueckfrage'], enthaelt: ['„Band“ finde ich nicht'] }),
    ein('Auftrag ohne Regel bleibt ehrlich', 'Mensch', 'Kannst du Tim auf die zwei Flughafen Fahrten hinzufügen?',
      { art: ['antwort', 'rueckfrage', 'fahrt_aendern'], nicht: ['hinzugefügt', 'erledigt', 'wird gebucht'] }),
  ];
};
