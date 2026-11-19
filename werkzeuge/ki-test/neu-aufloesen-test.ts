// Tests ohne Modell fuer die Aufloeser des neuen Ablaufs (dispo-admin/kiNeuAufloesen.ts, Phase 2 Umbau 18.11.).
//   cd trisar && deno test -A werkzeuge/ki-test/neu-aufloesen-test.ts
import { assertEquals } from 'jsr:@std/assert@1';
import { datumAufloesen, fahrtAufloesen, imSatz, namenAufloesen, type Person, zeitAufloesen } from '../../fahrer/supabase/functions/dispo-admin/kiNeuAufloesen.ts';

// Mittwoch 18.11.2026, 11:00 und nachts 01:30.
const TAG = { datum: '2026-11-18', minuten: 11 * 60 };
const NACHT = { datum: '2026-11-18', minuten: 90 };
const d = (text: string, j = TAG, neu = true) => {
  const e = datumAufloesen(text, j, neu);
  return 'iso' in e ? e.iso : 'von' in e ? `${e.von}..${e.bis}` : `!${e.fehler}`;
};
const z = (text: string, j = TAG) => {
  const e = zeitAufloesen(text, j);
  return 'hhmm' in e ? e.hhmm : 'von' in e ? `${e.von}-${e.bis}` : `!${e.fehler}`;
};

Deno.test('Datum: einfache Tage', () => {
  assertEquals(d('heute'), '2026-11-18');
  assertEquals(d('morgen'), '2026-11-19');
  assertEquals(d('morgen früh'), '2026-11-19');
  assertEquals(d('übermorgen'), '2026-11-20');
  assertEquals(d('gestern'), '2026-11-17');
  assertEquals(d('vorgestern'), '2026-11-16');
  assertEquals(d('heute Abend'), '2026-11-18');
  assertEquals(d('heute morgen'), '2026-11-18');
  assertEquals(d(''), '!leer');
  assertEquals(d('irgendwann'), '!unklar');
  assertEquals(d('tomorrow'), '2026-11-19');
  assertEquals(d('today'), '2026-11-18');
});

Deno.test('Datum: Wochentage', () => {
  assertEquals(d('am Freitag'), '2026-11-20');
  assertEquals(d('Freitag'), '2026-11-20');
  assertEquals(d('nächsten Montag'), '2026-11-23');
  assertEquals(d('kommenden Sonntag'), '2026-11-22');
  assertEquals(d('übernächsten Freitag'), '2026-11-27');
  assertEquals(d('letzten Freitag'), '2026-11-13');
  assertEquals(d('vergangenen Mittwoch'), '2026-11-11');
  assertEquals(d('nächste Woche Dienstag'), '2026-11-24');
  assertEquals(d('diesen Samstag'), '2026-11-21');
  // Heutiger Wochentag: neu = in 7 Tagen, aendern = heute, nachts = heute.
  assertEquals(d('am Mittwoch'), '2026-11-25');
  assertEquals(d('am Mittwoch', TAG, false), '2026-11-18');
  assertEquals(d('am Mittwoch', NACHT), '2026-11-18');
  assertEquals(d('nächsten Mittwoch'), '2026-11-25');
});

Deno.test('Datum: in X Tagen und Wochen', () => {
  assertEquals(d('in 10 Tagen'), '2026-11-28');
  assertEquals(d('in drei Tagen'), '2026-11-21');
  assertEquals(d('in zwei Wochen'), '2026-12-02');
  assertEquals(d('in drei Wochen am Dienstag'), '2026-12-08');
  assertEquals(d('in einer Woche'), '2026-11-25');
});

Deno.test('Datum: feste Angaben', () => {
  assertEquals(d('am 24.12.'), '2026-12-24');
  assertEquals(d('24.12.2026'), '2026-12-24');
  assertEquals(d('am 3.1.'), '2027-01-03');
  assertEquals(d('am 17.11.'), '2026-11-17');
  assertEquals(d('15. November'), '2026-11-15');
  assertEquals(d('am 31.11.'), '!unmoeglich');
  assertEquals(d('am 25.'), '2026-11-25');
  assertEquals(d('am 3.'), '2026-12-03');
});

Deno.test('Datum: Widersprueche und Pruefung mit Wochentag', () => {
  assertEquals(d('heute am Sonntag'), '!widerspruch');
  assertEquals(d('heute Mittwoch'), '2026-11-18');
  assertEquals(d('Sonntag den 15. November'), '2026-11-15');
  assertEquals(d('heute am Sonntag den 15. November'), '!widerspruch');
  assertEquals(d('morgen, Donnerstag'), '2026-11-19');
});

Deno.test('Datum: Nacht vor 05:00', () => {
  assertEquals(d('morgen', NACHT), '2026-11-18');
  assertEquals(d('heute', NACHT), '2026-11-18');
  assertEquals(d('übermorgen', NACHT), '2026-11-19');
});

Deno.test('Datum: ganze Woche', () => {
  assertEquals(d('nächste Woche'), '2026-11-23..2026-11-29');
  assertEquals(d('diese Woche'), '2026-11-16..2026-11-22');
});

Deno.test('Uhrzeit: Ziffern', () => {
  assertEquals(z('7'), '07:00');
  assertEquals(z('um 7 Uhr'), '07:00');
  assertEquals(z('7:30'), '07:30');
  assertEquals(z('7.30 Uhr'), '07:30');
  assertEquals(z('07:30'), '07:30');
  assertEquals(z('7 Uhr 30'), '07:30');
  assertEquals(z('22:45 Uhr'), '22:45');
  assertEquals(z('00:15'), '00:15');
  assertEquals(z('24 Uhr'), '00:00');
  assertEquals(z('25 Uhr'), '!unklar');
  assertEquals(z(''), '!leer');
});

Deno.test('Uhrzeit: süddeutsch und Worte', () => {
  assertEquals(z('halb 8'), '07:30');
  assertEquals(z('halb acht'), '07:30');
  assertEquals(z('viertel 8'), '07:15');
  assertEquals(z('dreiviertel 7'), '06:45');
  assertEquals(z('Viertel nach 3'), '03:15');
  assertEquals(z('viertel nach sieben'), '07:15');
  assertEquals(z('viertel vor 8'), '07:45');
  assertEquals(z('zehn nach 8'), '08:10');
  assertEquals(z('fünf vor halb 9'), '08:25');
  assertEquals(z('kurz vor 8'), '!unklar');
  assertEquals(z('gegen 8'), '!unklar');
  // Dauer ist keine Uhrzeit.
  assertEquals(z('eine Stunde früher'), '!unklar');
  assertEquals(z('20 Minuten später'), '!unklar');
  assertEquals(z('acht'), '08:00');
  assertEquals(z('mittags'), '12:00');
  assertEquals(z('Mitternacht'), '00:00');
});

Deno.test('Uhrzeit: Tag und Nacht aus Zusammenhang', () => {
  assertEquals(z('heute Abend um acht'), '20:00');
  assertEquals(z('Viertel nach 3 nachmittags'), '15:15');
  assertEquals(z('um 5 in der Früh'), '05:00');
  assertEquals(z('morgens um 6'), '06:00');
  assertEquals(z('um 2 mittags'), '14:00');
  assertEquals(z('um 10 nachts'), '22:00');
  assertEquals(z('um 2 nachts'), '02:00');
  assertEquals(z('9 am'), '09:00');
  assertEquals(z('9 pm'), '21:00');
});

Deno.test('Uhrzeit: relativ nur wenn es dasteht', () => {
  assertEquals(z('jetzt'), '11:00');
  assertEquals(z('in zwei Stunden'), '13:00');
  assertEquals(z('in 20 Minuten'), '11:20');
  assertEquals(z('in einer halben Stunde'), '11:30');
  assertEquals(z('in 7 Minuten'), '11:10');
});

Deno.test('Uhrzeit: Spannen', () => {
  assertEquals(z('von 8 bis 16'), '08:00-16:00');
  assertEquals(z('8-16'), '08:00-16:00');
  assertEquals(z('zwischen 15 und 16 Uhr'), '15:00-16:00');
  assertEquals(z('zwischen 9:30 und 10:15 Uhr'), '09:30-10:15');
  assertEquals(z('zwischen 18 bis 19 Uhr'), '18:00-19:00');
  assertEquals(z('10 bis 18'), '10:00-18:00');
  assertEquals(z('von halb 8 bis 16 Uhr'), '07:30-16:00');
  assertEquals(z('im Zeitraum von 7:00 bis 8:00'), '07:00-08:00');
});

const LEUTE: Person[] = [
  { id: 's', vor: 'Stefano', nach: 'Spandri', nummer: '1', name: 'Stefano Spandri' },
  { id: 't', vor: 'Tim', nach: 'Schedler', nummer: '113', name: 'Tim Schedler' },
  { id: 'm', vor: 'Marvin', nach: 'Keller', nummer: '112', name: 'Marvin Keller' },
  { id: 'a', vor: 'Anna', nach: 'Berger', nummer: '5', name: 'Anna Berger' },
  { id: 'b', vor: 'Bruno', nach: 'Lang', nummer: '7', name: 'Bruno Lang' },
  { id: 't2', vor: 'Tina', nach: 'Kaiser', nummer: '8', name: 'Tina Kaiser' },
];
const n = (...texte: string[]) => {
  const e = namenAufloesen(texte, LEUTE);
  return [...e.personen.map((p) => p.id), ...e.fehler.map((f) => `!${f.art}:${f.text}`), ...(e.alle ? ['ALLE'] : []), ...(e.markierte ? ['MARKIERT'] : [])].join(' ');
};

Deno.test('Namen: exakt, Teil, Tippfehler', () => {
  assertEquals(n('Tim'), 't');
  assertEquals(n('Tim Schedler'), 't');
  assertEquals(n('Herrn Keller'), 'm');
  assertEquals(n('Stefanos'), 's');
  assertEquals(n('Stephano'), 's');
  assertEquals(n('Marwin'), 'm');
  assertEquals(n('Brnuo'), 'b');
  assertEquals(n('Anna Burger'), 'a');
  assertEquals(n('Tim Schädler'), 't');
  assertEquals(n('Fahrer 113'), 't');
  assertEquals(n('113'), 't');
  // Verhoerter Nachname nach passendem Vornamen.
  assertEquals(n('Stefanos Bandy'), 's');
  assertEquals(n('Stefano Bandi'), 's');
});

Deno.test('Namen: unbekannt, mehrdeutig, nie raten', () => {
  assertEquals(n('Klaus'), '!unbekannt:Klaus');
  assertEquals(n('Paula'), '!unbekannt:Paula');
  assertEquals(n('Joris'), '!unbekannt:Joris');
  // Anderer Nachname ist eine andere Person.
  assertEquals(n('Tim Boberschmidt'), '!unbekannt:Tim Boberschmidt');
  assertEquals(n('Marvin Bendrix'), '!unbekannt:Marvin Bendrix');
  // "Tin" liegt einen Buchstaben von Tim und Tina: kurz, also nur exakt.
  assertEquals(n('Tin'), '!unbekannt:Tin');
  assertEquals(n('Fahrer 999'), '!unbekannt:Fahrer 999');
});

Deno.test('Namen: Gruppen und Fuerwoerter', () => {
  assertEquals(n('alle'), 'ALLE');
  assertEquals(n('alle Fahrer'), 'ALLE');
  assertEquals(n('die markierten'), 'MARKIERT');
  assertEquals(n('ihr'), '!fuerwort:ihr');
  assertEquals(n('Tim', 'Anna'), 't a');
});

Deno.test('Fahrt-Bezug', () => {
  const F = [
    { id: 'e', datum: '2026-11-18', zeit: '10:30', fahrerId: 's', gaeste: ['Horst Engel'], von: 'Hotel Bayerischer Hof', nach: 'Flughafen T2', status: 'assigned' },
    { id: 'mu', datum: '2026-11-18', zeit: '14:00', fahrerId: 's', gaeste: ['Markus Müller'], von: 'Flughafen T1', nach: 'Messe München', status: 'assigned' },
    { id: 'w', datum: '2026-11-19', zeit: '07:15', fahrerId: 'a', gaeste: ['Julia Weber'], von: 'Hotel Bayerischer Hof', nach: 'Flughafen T2', status: 'assigned' },
  ];
  const f = (a: any) => { const e = fahrtAufloesen(F, a); return 'fahrt' in e ? e.fahrt.id : `!${e.fehler}:${e.liste.length}`; };
  assertEquals(f({ gast: 'Herrn Engel' }), 'e');
  assertEquals(f({ gast: 'Müller' }), 'mu');
  assertEquals(f({ gast: 'Mueller' }), 'mu');
  assertEquals(f({ fahrerIds: ['s'] }), '!mehrere:2');
  assertEquals(f({ fahrerIds: ['s'], zeit: '14:00' }), 'mu');
  assertEquals(f({ gast: 'Schmidt' }), '!keine:0');
  assertEquals(f({ fahrerIds: ['m'], datum: '2026-11-18' }), '!keine:0');
  assertEquals(f({ ort: 'flughafen' }), '!mehrere:3');
  assertEquals(f({ gast: 'Weber', datum: '2026-11-19' }), 'w');
  assertEquals(f({ letzteFahrtId: 'w' }), 'w');
  assertEquals(f({}), '!ohne_angabe:0');
});

Deno.test('Steht im Satz', () => {
  assertEquals(imSatz('übernächsten Freitag', 'Dienststart für Tim übernächsten Freitag um 9'), true);
  assertEquals(imSatz('dreiviertel 7', 'Fahrt morgen um dreiviertel 7 vom Hof'), true);
  assertEquals(imSatz('Brnuo', 'Feierabend für Brnuo'), true);
  assertEquals(imSatz('07:30', 'Dienststart 7:30 morgen'), true);
  assertEquals(imSatz('Anna', 'Annas Dienst morgen endet um 13 Uhr'), true);
  assertEquals(imSatz('Anna', 'Feierabend für Klaus'), false);
  assertEquals(imSatz('morgen', 'Dann schick Dienststart für 9'), false);
});
