// Zwei Beispieltabellen für den Fahrten-Import in der Demo. Absichtlich
// unterschiedlich aufgebaut — andere Sprache, andere Spaltennamen, andere
// Reihenfolge, Titelzeile über der Kopfzeile, Datum und Uhrzeit in einer
// Spalte, Spalten ohne Bedeutung für TRISAR. Genau das soll die Erkennung
// ohne festes Schema auflösen.
//
// Die Daten liegen relativ zu heute, damit sie zum Datums-Versatz der Demo passen.

const tag = (plus) => {
  const d = new Date();
  d.setDate(d.getDate() + plus);
  return d;
};
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const de = (d) => `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;

export const importBeispiele = () => {
  const morgen = tag(1);
  const uebermorgen = tag(2);

  // Export eines Hotels, englisch, Komma getrennt.
  const hotel = [
    'Booking Ref,Guest Name,Pax,Service Date,Pick-up Time,Pick-up Location,Drop-off Location,Flight No.,Arriving From,VIP,Remarks',
    `BK-20931,Katharina Vogel,1,${iso(morgen)},09:40,"MUC Terminal 2, 85356 München-Flughafen","Hotel Bayerischer Hof, Promenadeplatz 2-6, 80333 München",LH 2085,Berlin (BER),yes,Please wait with name sign at arrivals`,
    `BK-20932,James Carter & Emily Carter,2,${iso(morgen)},11:15,"MUC Terminal 1, 85356 München-Flughafen","Mandarin Oriental, Neuturmstraße 1, 80331 München",BA 948,London Heathrow (LHR),no,Two large suitcases and one golf bag`,
    `BK-20933,Yuki Tanaka,1,${iso(morgen)},14:05,"MUC Terminal 2, 85356 München-Flughafen","Hotel Vier Jahreszeiten, Maximilianstraße 17, 80539 München",LH 715,Tokyo Haneda (HND),yes,`,
    `BK-20934,Sofia Rossi,1,${iso(uebermorgen)},08:30,"Hotel Bayerischer Hof, Promenadeplatz 2-6, 80333 München","MUC Terminal 2, 85356 München-Flughafen",LH 1868,Rome Fiumicino (FCO),no,Departure — guest checks out at 08:15`,
    `BK-20935,Lars Nilsson,1,${iso(uebermorgen)},17:50,"MUC Terminal 2, 85356 München-Flughafen","The Charles Hotel, Sophienstraße 28, 80333 München",SK 2663,Stockholm (ARN),no,`,
  ].join('\n');

  // Transferliste einer Agentur, deutsch, Semikolon getrennt, mit Titelzeile
  // und Leerzeile vor der eigentlichen Kopfzeile.
  const agentur = [
    'Transferliste Summit-Delegation;;;;;;;;',
    ';;;;;;;;',
    'Termin;Abholort;Zielort;Fahrgast;Anz.;Zug/Flug;Kindersitz;Bemerkung;Kostenstelle',
    `${de(morgen)} 07:20;München Hbf, Bayerstraße 10a, 80335 München;Messe München, Am Messesee 2, 81829 München;Dr. Anna Berger;1;ICE 587;nein;Treffpunkt Ausgang Nord;KST-4410`,
    `${de(morgen)} 10:45;Hotel Bayerischer Hof, Promenadeplatz 2-6, 80333 München;BMW Welt, Am Olympiapark 1, 80809 München;Familie Weber;4;;ja;Kindersitz für 3-jähriges Kind;KST-4410`,
    `${de(morgen)} 19:30;BMW Welt, Am Olympiapark 1, 80809 München;Löwenbräukeller, Nymphenburger Straße 2, 80335 München;Thomas Keller, Maria Lindner;2;;nein;Abendessen Delegation;KST-4412`,
    `${de(uebermorgen)} 06:10;Hotel Vier Jahreszeiten, Maximilianstraße 17, 80539 München;MUC Terminal 1, 85356 München-Flughafen;Jean Dupont;1;AF 1323;nein;Frühabflug, Frühstück zum Mitnehmen;KST-4410`,
  ].join('\n');

  return [
    { key: 'hotel', dateiname: 'hotel-export-arrivals.csv', inhalt: hotel },
    { key: 'agentur', dateiname: 'transferliste-summit.csv', inhalt: agentur },
  ];
};
