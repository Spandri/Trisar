// Schritte des Fahrer-App-Tutorials — Texte auf Deutsch, für Fahrerinnen und
// Fahrer geschrieben, nicht für Technik. Gemeinsam gepflegt.
//
// Felder je Schritt:
//   kategorie  Bereich, steht lime über dem Text
//   kategorieLinks / kategorieRechts  optionale getrennte Überschriften je Textseite
//   pfad       Array, wird als "A ← B ← C" angezeigt (wo man gerade ist)
//   ort        Wohin der Finger navigiert (Schlüssel aus ORTE weiter unten).
//              Die Brücke fährt den Weg selbst: erst über die Zurück-Knöpfe
//              heraus, dann über die Knöpfe hinein. Es wird nie gesprungen.
//   zustand    nur noch für Datenkorrekturen:
//                patches  Demo-Daten zurücksetzen, damit ← immer den gleichen Stand zeigt
//   fokus      data-tutorial-Marker in der App; null = ganze Ansicht, nichts abgedunkelt
//   fokusDanach  zweiter Marker: nach den Aktionen wandert die Hervorhebung
//              dorthin (waehrend der Bewegung ist nichts hervorgehoben)
//   text       ein Text, Seite wechselt automatisch von Schritt zu Schritt
//   links      Text fest links vom iPhone
//   rechts     Text fest rechts vom iPhone   (links + rechts = beide Seiten)
//   luft       Abstand zwischen Schrift und Ausschnittkante (Vorgabe 8 px)
//   aktion     { klick: '<marker>', nach: ms, tippen: 'Text', ortDanach: '<ort>' }
//              oder eine Liste davon — der Finger fährt hin und drückt;
//              { scrollZu: '<marker>', nach: ms } wischt stattdessen dorthin
//   symboleLinks / symboleRechts  Icon-Namen (siehe SYMBOL_ICON_URLS im Rahmen) —
//              werden als Reihe unter dem jeweiligen Text angezeigt
//   abschluss  true beim letzten Schritt: zeigt "Weiter zur Disposition" und
//              "Fahrer frei erkunden" unter dem Text

(function () {
  // Demo-Daten, auf die sich das Tutorial bezieht (siehe fahrer-app-demo/src/demo/data)
  var FAHRT_OFFEN = '011ac7d9-f03d-5677-a76d-ae2bda3d7bdb';      // 16:24 MUC Terminal 2 → Sophienstraße, LH2017, wird angeboten
  var FAHRT_OFFEN_ZUWEISUNG = 'f0bc5fd9-c3d1-47c5-9c08-1eb1c17d03c4';
  var FAHRT_FLUG = '19f25ddb-af39-519c-961b-3902848a0671';       // in 1,5 h: MUC Terminal 2 → Hotel Bayerischer Hof, LH 411 aus New York, VIP
  var FAHRT_KOLONNE = '4ce042be-fe4e-5551-af45-60feb881d279';    // in 15 min: Hotel Bayerischer Hof → Flughafen, Kolonne
  var DIENSTANFRAGE = 'a7d3f9e1-2b4c-4d5e-8f60-71a2b3c4d5e6';

  var fahrtWiederOffen = [
    { table: 'convoy_assignments', id: FAHRT_OFFEN_ZUWEISUNG, set: { response_status: 'pending', responded_at: null, refusal_reason: null } },
    { table: 'jobs', id: FAHRT_OFFEN, set: { status: 'pending', driver_response_status: 'pending' } },
  ];
  var anfrageWiederOffen = [
    { table: 'driver_service_requests', id: DIENSTANFRAGE, set: { status: 'pending', responded_at: null, refusal_reason: null } },
  ];

  // Karte der Ansichten: wie man hinein- und wieder herauskommt. Die Brücke
  // berechnet daraus den Klickweg zwischen zwei Schritten.
  //   von      übergeordnete Ansicht
  //   hin      Knopf, der von dort hineinführt
  //   zurueck  Knopf, der wieder heraus führt
  //   kennung  Marker, die nur an diesem Ort sichtbar sind — daran erkennt die
  //            Brücke vor jedem Schritt, wo sie wirklich steht, und prüft die Ankunft
  window.TRISAR_TUTORIAL_ORTE = {
    list: { kennung: 'fahrzeugkarte' },
    fahrzeug: { von: 'list', hin: 'fahrzeugkarte', zurueck: 'fahrzeug-zurueck', kennung: 'fahrzeug-zurueck' },
    schadenBlatt: { von: 'fahrzeug', hin: 'schaden-melden', zurueck: 'schaden-zurueck', kennung: 'schaden-zurueck' },

    fahrtFlug: { von: 'list', hin: 'fahrt-' + FAHRT_FLUG, zurueck: 'details-zurueck', kennung: ['details-zurueck', 'fahrt-detail-' + FAHRT_FLUG] },
    notizBlatt: { von: 'fahrtFlug', hin: 'notiz-senden', zurueck: 'notiz-zurueck', kennung: 'notiz-zurueck' },

    // Die 16:24-Fahrt wurde im Tutorial gerade angenommen. Sie beginnt am
    // Flughafen, waehrend die 14:30-Fahrt am Bayerischen Hof endet — daran
    // laesst sich die Anfahrt aus der vorherigen Fahrt zeigen.
    fahrtAnschluss: { von: 'list', hin: 'fahrt-' + FAHRT_OFFEN, zurueck: 'details-zurueck', kennung: ['details-zurueck', 'fahrt-detail-' + FAHRT_OFFEN] },

    fahrtKolonne: { von: 'list', hin: 'fahrt-' + FAHRT_KOLONNE, zurueck: 'details-zurueck', kennung: ['details-zurueck', 'fahrt-detail-' + FAHRT_KOLONNE] },
    kolonnenChat: { von: 'fahrtKolonne', hin: 'kolonnen-chat', zurueck: 'kolonnenchat-zurueck', kennung: 'kolonnenchat-zurueck' },

    profil: { von: 'list', hin: 'profil-knopf', zurueck: 'profil-zurueck', kennung: 'profil-zurueck' },
    verlauf: { von: 'profil', hin: 'profil-verlauf', zurueck: 'verlauf-zurueck', kennung: 'verlauf-zurueck' },
    ansprechpartner: { von: 'profil', hin: 'profil-ansprechpartner', zurueck: 'ansprechpartner-zurueck', kennung: 'ansprechpartner-zurueck' },
    einstellungen: { von: 'profil', hin: 'profil-einstellungen', zurueck: 'einstellungen-zurueck', kennung: 'einstellungen-zurueck' },
  };

  window.TRISAR_TUTORIAL_FAHRER = [
    // ---------- Start ----------
    {
      kategorie: 'Überblick',
      pfad: ['Login', 'Fahrer Dashboard'],
      ort: 'list',
      zustand: { patches: anfrageWiederOffen },
      fokus: null,
      text: 'Auf der Startseite stehen alle Informationen für den Dienst bereit. Angezeigt werden das zugeteilte Fahrzeug und die anstehenden Fahrten, sortiert nach Zeitpunkt.',
    },
    {
      kategorie: 'Fahrzeug',
      pfad: ['Fahrer Dashboard', 'Fahrzeugkarte'],
      ort: 'list',
      fokus: 'fahrzeugkarte',
      text: 'Die Fahrzeugkarte enthält Kennzeichen, Fahrgestellnummer und ein Bild des zugeteilten Fahrzeugs.',
    },
    {
      kategorieLinks: 'Quickfacts',
      kategorieRechts: 'Reichweite',
      pfad: ['Fahrer Dashboard', 'Fahrzeugkarte', 'Quickfacts'],
      ort: 'list',
      fokus: 'kacheln',
      links: 'Die Quickfacts zeigen Antrieb, Farbe, Ladestand mit Reichweite und vorhandene Sitzplätze.',
      rechts: 'Die Reichweitenanzeige ordnet die verfügbare Reserve ein. Grün steht für ausreichend Reichweite, orange für eine knappe Reserve und rot für Handlungsbedarf.',
    },
    {
      kategorie: 'Fahrzeugansicht',
      pfad: ['Fahrer Dashboard', 'Fahrzeugansicht'],
      ort: 'fahrzeug',
      fokus: null,
      aktion: { scrollZu: 'schadensbericht', nach: 2600 },
      text: 'Hinter der Fahrzeugkarte liegt die Detailansicht. Dort sind der aktuelle Standort, technische Angaben und bekannte Schäden hinterlegt.',
    },
    {
      kategorie: 'Schaden',
      pfad: ['Fahrzeugansicht', 'Schaden melden'],
      ort: 'schadenBlatt',
      fokus: null,
      aktion: [
        { klick: 'schaden-foto', nach: 1400 },
        { klick: 'schaden-quelle-galerie', nach: 1000 },
        { klick: 'schaden-galerie-1', nach: 1000 },
        { klick: 'schaden-galerie-2', nach: 500 },
        { klick: 'schaden-galerie-3', nach: 500 },
        { klick: 'schaden-galerie-ok', nach: 800 },
        { klick: 'schaden-stelle-front-links', nach: 1000 },
        { klick: 'schaden-teil-felge', nach: 700 },
        { klick: 'schaden-text', nach: 900, tippen: 'Felgenschaden vorne links' },
        { klick: 'schaden-abschicken', nach: 1200, ortDanach: 'fahrzeug' },
      ],
      text: 'Ein Schaden wird direkt aus der Fahrzeugansicht gemeldet. Dazu wird die betroffene Stelle angetippt, mit Fotos versehen und kurz beschrieben. Die Meldung liegt anschließend sofort im Schadensbericht und bei der Disposition vor.',
    },

    // ---------- Dienstplan ----------
    {
      kategorie: 'Dienstplan',
      pfad: ['Fahrer Dashboard', 'Dienstplan-Anfrage'],
      ort: 'list',
      zustand: { patches: anfrageWiederOffen },
      fokus: ['dienstanfrage', 'dienstanfrage-ablehnen', 'dienstanfrage-annehmen'],
      aktion: { klick: 'dienstanfrage-annehmen', nach: 2800 },
      text: 'Offene Dienstanfragen werden direkt auf dem Dashboard angezeigt. Mit der Bestätigung wird der Dienst in den Dienstplan übernommen.',
    },

    // ---------- Fahrten ----------
    {
      kategorie: 'Fahrten',
      pfad: ['Fahrer Dashboard', 'Auftragskarte'],
      ort: 'list',
      zustand: { patches: fahrtWiederOffen },
      fokus: 'fahrt-' + FAHRT_OFFEN,
      text: 'Die kommenden Fahrten erscheinen als Auftragskarten in kompakter Vorschau. Ein Klick öffnet die vollständigen Details.',
    },
    {
      kategorie: 'Fahrten',
      pfad: ['Fahrer Dashboard', 'Fahrt annehmen'],
      ort: 'list',
      zustand: { patches: fahrtWiederOffen },
      // Beide Knoepfe der angebotenen Fahrt, je ein eigener Ausschnitt.
      fokus: ['fahrt-ablehnen-' + FAHRT_OFFEN, 'fahrt-annehmen-' + FAHRT_OFFEN],
      aktion: { klick: 'fahrt-annehmen-' + FAHRT_OFFEN, nach: 2600 },
      text: 'Angebotene Fahrten werden bestätigt oder abgelehnt. Die Disposition erhält die Antwort unmittelbar und kann abgelehnte Fahrten neu vergeben.',
    },

    // ---------- Eine Fahrt im Detail ----------
    {
      kategorie: 'Fahrt',
      pfad: ['Fahrer Dashboard', 'Fahrtdetails'],
      ort: 'fahrtFlug',
      fokus: null,
      text: 'Zu jeder Fahrt gibt es eine Detailansicht mit Karte und Infoblatt. Anfahrt und Route sind eingezeichnet, alle weiteren Angaben stehen darunter.',
    },
    {
      kategorie: 'Fahrt',
      pfad: ['Fahrtdetails', 'Zeiten'],
      ort: 'fahrtFlug',
      fokus: [
        ['etd-label', 'etd-zeit', 'etd-plan', 'etd-phase'],
        ['eta-label', 'eta-zeit', 'eta-dauer'],
      ],
      luft: 15,
      text: 'Jede Fahrt hat eine geplante Abholzeit und eine berechnete Ankunftszeit. Bei Flughafenabholungen verschieben sich beide bei einer Verspätung automatisch mit dem Flug, sodass Fahrer und Disposition immer die gültige Zeit sehen.',
    },
    {
      kategorieLinks: 'Infoblatt',
      kategorieRechts: 'Karte',
      pfad: ['Fahrtdetails', 'Karte'],
      ort: 'fahrtFlug',
      // Erst ziehen, dann die freigelegte Karte hervorheben — der Fokus wird
      // nach der Aktion gesetzt, sonst laege er noch auf der halben Karte.
      fokus: 'karte',
      fokusNachAktion: true,
      // Der Finger zieht das Infoblatt am Griff nach unten, damit die Karte frei liegt.
      aktion: [{ ziehen: 'blatt-griff', dy: 260, nach: 800 }],
      links: 'Das Infoblatt lässt sich am Griff nach unten ziehen.',
      rechts: 'Die gelb gestrichelte Linie zeigt die Anfahrt zum Abholort, die durchgezogene blaue die Fahrt zum Ziel. An beiden Strecken steht jeweils die Dauer im aktuellen Verkehr.',
    },
    {
      kategorie: 'Flug',
      pfad: ['Fahrtdetails', 'Flug live'],
      ort: 'fahrtFlug',
      // Das Blatt liegt nach dem Karten-Schritt unten, das Flugzeug ist frei.
      // Erst hervorheben, dann kreist der Zeiger zweimal um die Maschine.
      fokus: 'flugzeug',
      aktion: [{ umkreisen: '[data-tutorial="flugzeug"]', runden: 2, nach: 400 }],
      text: 'Bei Flughafenabholungen ist der Flug live auf der Karte zu sehen. Das Flugzeug zeigt, wo die Maschine gerade ist, die Linie dahinter die bisherige Strecke. So weiß der Fahrer schon unterwegs, wann gelandet wird, und muss nicht selbst nachschauen.',
    },
    {
      kategorieLinks: 'Anschluss',
      kategorieRechts: 'Startfahne',
      pfad: ['Fahrtdetails', 'Anfahrt'],
      ort: 'fahrtAnschluss',
      // Blatt herunterziehen, dann die freigelegte Karte hervorheben.
      fokus: 'karte',
      // 1 = gleich nach dem Ziehen hervorheben, noch bevor der Zeiger die
      // Fahnen umkreist. Sonst kaeme die Markierung erst Sekunden spaeter.
      fokusNachAktion: 1,
      aktion: [
        { ziehen: 'blatt-griff', dy: 260, nach: 800 },
        // Zeiger umkreist erst die gruene Startfahne, dann die Zielfahne.
        { umkreisen: 'img[src*="Start_Flagge"]', runden: 2, nach: 500 },
        { umkreisen: 'img[src*="Ziel_Flagge"]', runden: 2, nach: 300 },
      ],
      links: 'Läuft davor noch eine Fahrt, beginnt die Anfahrt an deren Ziel und nicht am aktuellen Standort. So hängt der ganze Tag zusammen, denn jede Fahrt startet dort, wo die vorherige endet. Ist die vorherige Fahrt beendet oder storniert, zählt wieder der eigene Standort.',
      rechts: 'Die grüne Fahne zeigt diesen Startpunkt. Der blaue Standortpunkt bleibt dann weg, weil er für die Planung nichts aussagt. Endet die vorherige Fahrt genau am Abholort, steht dort ein grüner Pin mit Gast, zu fahren gibt es dann nichts.',
    },
    {
      // Zwei Themen nebeneinander, darum je eine eigene Ueberschrift.
      kategorieLinks: 'Flug',
      kategorieRechts: 'Besonderheiten',
      pfad: ['Fahrtdetails', 'Flug'],
      ort: 'fahrtFlug',
      // Nach dem Karten-Schritt liegt das Blatt unten — der Finger zieht es
      // zuerst wieder ganz nach oben, sonst waeren Flug und Symbole verdeckt.
      // Das Hochziehen ist das Allererste in diesem Schritt: es laeuft vor
      // Text und Hervorhebung, ohne Wartezeit.
      aktionZuerst: true,
      aktion: [{ ziehen: 'blatt-griff', dy: -540, nach: 0 }],
      // Erste Gruppe: Flugnummer + Abflugort (passend zum linken Text).
      // Danach die beiden Symbole einzeln (passend zum rechten Text).
      fokus: [['flugnummer', 'flugort'], 'badge-vip', 'badge-gepaeck'],
      // Erst hervorheben, wenn das Blatt oben steht.
      fokusNachAktion: true,
      // Icons liegen eng nebeneinander (8 px Abstand) — Standard-Luft (8 px)
      // liesse die beiden Ausschnitte ueberlappen und zu einem verschmelzen.
      luft: 3,
      links: 'Bei Flughafenfahrten sind Flugnummer und Abflugort direkt bei der Fahrt hinterlegt.',
      rechts: 'Die Disposition kann eine Fahrt mit Symbolen für Rollstuhl, VIP-Status, Kindersitz oder Gepäck markieren. So ist der Fahrer schon vor der Ankunft auf die besonderen Anforderungen vorbereitet.',
      symboleRechts: ['accessibility', 'vip', 'child', 'luggage'],
    },
    {
      kategorie: 'Fahrt',
      pfad: ['Fahrtdetails', 'Gäste'],
      ort: 'fahrtFlug',
      // Ueberschrift und alle Gastzeilen als EIN Ausschnitt.
      fokus: [['gaeste', 'gast']],
      text: 'Hier stehen die Gäste, die abgeholt werden. Hinweise der Disposition finden sich darunter unter Notiz.',
    },
    {
      // Vier Knoepfe, je ein eigener Ausschnitt; zwei Texte mit eigener Ueberschrift.
      kategorieLinks: 'Beenden & Stornieren',
      kategorieRechts: 'Notiz & Support',
      pfad: ['Fahrtdetails', 'Aktionen'],
      ort: 'fahrtFlug',
      fokus: ['fahrt-beenden', 'stornieren', 'notiz-senden', 'support'],
      links: 'Mit Fahrt beenden wird die Fahrt abgeschlossen und der Disposition als erledigt gemeldet. Stornieren gibt die Fahrt mit einer Begründung zurück, damit die Disposition sie neu vergeben kann.',
      rechts: 'Über Notiz zur Fahrt erhält die Disposition eine Nachricht zum jeweiligen Auftrag. Support führt direkt zu den Ansprechpartnern in Hotline und Disposition.',
    },
    {
      kategorie: 'Fahrt',
      pfad: ['Fahrtdetails', 'Notiz'],
      ort: 'notizBlatt',
      // Nach dem Abschicken zeigt der Fokus auf den Notizbereich der Fahrt,
      // damit man die gerade geschriebene Notiz dort stehen sieht.
      fokus: [['notizen', 'notiz-eintrag']],
      fokusNachAktion: true,
      aktion: [
        { klick: 'notiz-text', nach: 700, tippen: 'Gast hat zwei zusätzliche Koffer, bin 5 Minuten später am Hotel.' },
        // Das Abschicken schliesst das Blatt — danach stehen wir wieder in der Fahrt.
        { klick: 'notiz-abschicken', nach: 600, ortDanach: 'fahrtFlug' },
      ],
      text: 'Willst du der Disposition etwas zu dieser Fahrt mitteilen, schreibst du eine Notiz. Sie erscheint sofort bei der Fahrt, bei dir und in der Disposition.',
    },
    // ---------- Kolonne ----------
    {
      kategorie: 'Kolonne',
      pfad: ['Fahrtdetails', 'Kolonne'],
      ort: 'fahrtKolonne',
      fokus: 'kolonnen-fahrer',
      text: 'Fahren mehrere Fahrzeuge für eine Gruppe, wird die Kolonne angezeigt, also alle Kollegen mit ihren Gästen. Ein Tipp auf einen Namen zeigt Fahrzeug, Kennzeichen und Telefonnummer für den direkten Anruf.',
    },
    {
      kategorie: 'Kolonne',
      pfad: ['Fahrtdetails', 'Kolonnen-Chat'],
      ort: 'kolonnenChat',
      fokus: null,
      // Antwort wird live getippt und abgeschickt — wie Login und Notiz.
      aktion: [
        { klick: 'kolonnenchat-feld', nach: 900, tippen: 'Passt. Ich fahre mit Frau Rossi vor, ihr folgt.' },
        { klick: 'kolonnenchat-senden', nach: 700 },
      ],
      text: 'Im Kolonnen-Chat erfolgt die Abstimmung, wer wo steht und wer vorfährt. Nachrichten kommen sofort bei allen in der Kolonne an.',
    },

    // ---------- Profil ----------
    {
      kategorie: 'Profil',
      pfad: ['Fahrer Dashboard', 'Profil'],
      ort: 'profil',
      fokus: null,
      text: 'Oben rechts geht es zum Profil mit Name, Kilometern, Fahrten und Stunden. Von hier aus besteht Zugang zu Ansprechpartnern, Verlauf und Einstellungen.',
    },
    {
      kategorie: 'Profil',
      pfad: ['Profil', 'Verlauf'],
      ort: 'verlauf',
      fokus: null,
      text: 'Der Verlauf zeigt die vergangenen Dienste mit Dienstbeginn, den gefahrenen Fahrten samt Gästen und Dienstende.',
    },
    {
      kategorie: 'Profil',
      pfad: ['Profil', 'Ansprechpartner'],
      ort: 'ansprechpartner',
      // Nichts hervorheben — die ganze Seite bleibt hell, der Finger wischt
      // nur einmal durch: Hotline, Disposition, Kundenbetreuung.
      fokus: null,
      aktion: [
        { scrollZu: 'support-kontakt', nach: 3200 },
        { scrollZu: 'support-kontakt-2', nach: 2000 },
      ],
      text: 'Unter Ansprechpartner finden sich die Hotline sowie die Kontakte in Disposition und Kundenbetreuung. Ein Tipp auf Get in touch ruft direkt an.',
    },
    {
      kategorie: 'Profil',
      pfad: ['Profil', 'Einstellungen'],
      ort: 'einstellungen',
      fokus: null,
      aktion: { klick: 'einstellungen-sprache', nach: 900 },
      text: 'In den Einstellungen werden die eigenen Daten gepflegt und die Sprache gewählt, die ganze App wechselt sofort. Auch die Abmeldung erfolgt hier.',
    },

    // ---------- Abschluss ----------
    {
      kategorie: 'Abschluss',
      pfad: ['Fahrer Dashboard'],
      ort: 'list',
      fokus: null,
      abschluss: true,
      text: 'Das war die Fahrer-App. Die andere Seite ist die Disposition, in der die Fahrten entstehen, die hier ankommen. Das passende Tutorial gibt Aufschluss, alternativ lässt sich die App jetzt frei ausprobieren.',
    },
  ];
})();
