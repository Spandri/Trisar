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
};
export type Schritt = { frage: string; erwartet: Erwartung; markiert?: string[] };
export type Fall = { name: string; gruppe: string; schritte: Schritt[] };

const naechsterWochentag = (ziel: number) => {
  // 0 = Sonntag ... 5 = Freitag, immer in der Zukunft (nicht heute)
  for (let i = 1; i <= 7; i += 1) {
    const iso = tagBerlin(i);
    if (new Date(`${iso}T12:00:00Z`).getUTCDay() === ziel) return iso;
  }
  return tagBerlin(7);
};

export const faelle = (): Fall[] => {
  const heute = tagBerlin(0);
  const morgen = tagBerlin(1);
  const uebermorgen = tagBerlin(2);
  const freitag = naechsterWochentag(5);
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

    // --- Dienste ---
    ein('Dienst Start und Ende morgen', 'Dienst', 'Schick Tim morgen 7 bis 15 Uhr',
      { art: 'dienst_vorschlag', vorschlag: { datum: morgen, start: '07:00', ende: '15:00', fahrer: 'Tim' } }),
    ein('Dienst ab Uhrzeit heute', 'Dienst', 'Dienst für Marvin heute ab 14 Uhr',
      { art: 'dienst_vorschlag', vorschlag: { datum: heute, start: '14:00', fahrer: 'Marvin' } }),
    ein('Vorhandener Dienst, Uhrzeit nachts', 'Dienst', 'Schick Stefano heute 00:30',
      { art: 'dienst_vorschlag', enthaelt: ['schon Dienst'], vorschlag: { ende: '00:30', start: null } }),
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
  ];
};
