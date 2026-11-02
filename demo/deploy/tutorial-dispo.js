// Schritte des Dispositions-Tutorials — Texte auf Deutsch, für Disponentinnen
// und Disponenten geschrieben, nicht für Technik. Gemeinsam gepflegt.
//
// Die Variablennamen TRISAR_TUTORIAL_ORTE_DISPO und TRISAR_TUTORIAL_DISPO
// bitte beibehalten — der Rahmen (deploy/index.html) liest genau diese beiden.
//
// Felder je Schritt: wie in tutorial-fahrer.js beschrieben, dazu:
//   zustand    { reset: true } setzt gespeicherte Oberflaechen-Einstellungen der
//              Disposition zurueck (Sprache, Schnellwahl, KI-Chat, Planer, Karte);
//              { ansicht: '<view>' } wechselt ohne Klick die Ansicht
//   aktion     zusätzlich { ziehen: '<marker>', dx: -120, dy: 0, nach: ms } —
//              der Finger zieht das Element seitlich (z. B. Wischkarte, um die
//              Knöpfe darunter freizulegen). dx und dy in px, beide optional.
//   abschluss  true = Knöpfe des Fahrer-Tutorials, oder eine Liste eigener Knöpfe:
//                [{ label: 'Zur Fahrer-App', ziel: 'fahrer' },
//                 { label: 'Disposition frei erkunden', ziel: 'frei' }]
//              ziel 'fahrer' / 'admin'  Tutorial beenden und App wechseln
//                                       (dort steht dann "Tutorial starten")
//              ziel 'dispo'             zur Disposition wechseln und deren Tutorial starten
//              ziel 'frei'              Tutorial beenden, in der App bleiben
//              Der erste Knopf ist hervorgehoben, ausser ein Eintrag setzt primaer: true/false.

(function () {
  // Demo-Daten, auf die sich das Tutorial bezieht (siehe admin-app-demo/src/demo/data)
  var FAHRT_VIP = '19f25ddb-af39-519c-961b-3902848a0671';        // 14:30 MUC Terminal 2 → Hotel Bayerischer Hof, LH 2085, VIP Katharina Vogel
  var FAHRT_OFFEN = '011ac7d9-f03d-5677-a76d-ae2bda3d7bdb';      // 16:24 MUC Terminal 2 → Sophienstraße, Antwort des Fahrers offen
  var FAHRER_ADRIAN = '40849666-dcd1-5e11-9de1-e90a85a98062';    // Adrian Meyer #36, steht oben in der Fahrerliste
  var FAHRER_DENNIS = '0c8aa21c-1730-505e-b03b-06607611672e';    // Dennis Meyer #38
  var FAHRZEUG_STEFANO = '7e6a0245-9821-4265-8ef7-f9dbd26d48a8'; // M ST 2154, 100 %
  var FAHRZEUG_KNAPP = '516bc2b5-c1ef-45fa-b4d5-0763eef4502d';   // M-A 215H, 16 % — knappe Reichweite
  var KUNDIN_VOGEL = '6a208955-2a32-5b1b-9f3b-cd6c436497be';     // Katharina Vogel, VIP
  var FAHRER_STEFANO = '0012ce3e-dc52-423a-824d-39ab4ce592c7';   // Stefano Spandri #1, heute mit Fahrten

  // Beispielfragen, auf die der KI-Assistent der Demo aus den aktuellen Daten
  // antwortet (KI_DEMO_FRAGE_* in admin-app-demo/src/services/kiAssistant.js).
  var KI_FRAGE_TELEFON = 'Welche Telefonnummer hat Fahrer 10?';
  var KI_FRAGE_OHNE_FAHRER = 'Welche Fahrten haben morgen noch keinen Fahrer?';
  var KI_FRAGE_AKKU = 'Welche Fahrzeuge müssen heute noch laden oder tanken?';

  // Genau dieser Satz loest im KI-Assistenten die Beispielbuchung aus
  // (KI_DEMO_ANFRAGE in admin-app-demo/src/services/kiAssistant.js).
  var KI_ANFRAGE = 'Bitte buche morgen um 10:30 eine Fahrt für Katharina Vogel vom Hotel Bayerischer Hof zum Flughafen München Terminal 2.';

  // Heutiges Datum im Format des Datumsfelds (JJJJ-MM-TT, Ortszeit).
  var jetzt = new Date();
  var HEUTE = jetzt.getFullYear() + '-' + String(jetzt.getMonth() + 1).padStart(2, '0') + '-' + String(jetzt.getDate()).padStart(2, '0');

  // Karte der Ansichten der Disposition (Aufbau wie TRISAR_TUTORIAL_ORTE).
  // Die Startansicht heisst wie in der Fahrer-App 'list'. Ansichten werden
  // beim Wechsel ausgehaengt, eine Kennung je Ansicht genuegt deshalb.
  window.TRISAR_TUTORIAL_ORTE_DISPO = {
    list: { kennung: 'dispo-start' },

    fahrten: { von: 'list', hin: 'navi-alle-fahrten', zurueck: 'fahrten-zurueck', kennung: 'fahrten-liste' },
    fahrtenFilter: { von: 'fahrten', hin: 'fahrten-filter-knopf', zurueck: 'filter-zurueck', kennung: 'fahrten-filter' },
    fahrtBearbeiten: { von: 'fahrten', hin: 'fahrt-' + FAHRT_VIP, zurueck: 'bearbeiten-zurueck', kennung: 'fahrt-bearbeiten' },
    fahrtAnlegen: { von: 'list', hin: 'navi-plus', zurueck: 'anlegen-zurueck', kennung: 'fahrt-anlegen' },

    fahrer: { von: 'list', hin: 'start-fahrer', zurueck: 'fahrer-zurueck', kennung: 'fahrer-liste' },
    // Der KI-Planer oeffnet ohne Einsatz direkt den Kalender (wie ausserhalb des Tutorials).
    planer: { von: 'fahrer', hin: 'planer-ki-knopf', zurueck: 'planer-kalender-zurueck', kennung: 'planer-kalender' },
    // Einsatzplanung: Kalender (Zeitraum) und Tagesplanung liegen als Ebenen
    // ueber dem KI-Planer. In die Tagesplanung geht es nur mit gewaehltem Tag,
    // darum waehlt der Schritt ihn selbst.
    planerBedarf: { von: 'planer', hin: 'planer-kalender-weiter', zurueck: 'planer-bedarf-zurueck', kennung: 'planer-bedarf' },
    planerTag: { von: 'planerBedarf', hin: 'planer-bedarf-weiter', zurueck: 'planer-tag-zurueck', kennung: 'planer-tagesplanung' },

    karte: { von: 'list', hin: 'navi-karte', zurueck: 'karte-zurueck', kennung: 'karte-ansicht' },
    kartenFilter: { von: 'karte', hin: 'karte-filter-knopf', zurueck: 'karte-filter-zurueck', kennung: 'karte-filter' },
    fahrzeuge: { von: 'list', hin: 'start-fahrzeuge', zurueck: 'fahrzeuge-zurueck', kennung: 'fahrzeuge-liste' },
    kunden: { von: 'list', hin: 'start-kunden', zurueck: 'kunden-zurueck', kennung: 'kunden-liste' },
    ki: { von: 'list', hin: 'navi-ki-assistent', zurueck: 'ki-zurueck', kennung: 'ki-assistent' },
    // Neuplanung nach einer Stoerung: aus der Meldung im KI-Assistenten heraus.
    neuplanung: { von: 'ki', hin: 'ki-neuplanung', zurueck: 'planer-neuplanung-zurueck', kennung: 'planer-neuplanung' },
  };

  window.TRISAR_TUTORIAL_DISPO = [
    // ---------- Start ----------
    {
      kategorie: 'Überblick',
      pfad: ['Disposition', 'Startseite'],
      ort: 'list',
      // Gespeicherte Einstellungen frueherer Besuche zuruecksetzen, damit
      // jeder Durchlauf gleich aussieht.
      zustand: { reset: true },
      fokus: null,
      text: 'Auf der Startseite der Disposition steht der Einsatz auf einen Blick. Angezeigt werden CO₂-Emissionen und Einsatzkosten seit Einsatzbeginn sowie der Zugang zu Planung, Fahrern, Kunden und Fahrzeugen.',
    },
    {
      kategorie: 'Navigation',
      pfad: ['Startseite', 'Navigationsleiste'],
      ort: 'list',
      // Ohne Abdunkeln: die aufgeklappten Moeglichkeiten liegen ueber der Leiste.
      fokus: null,
      // Der Finger haelt das mittlere Feld gedrueckt, zieht nach oben auf die
      // Fahrer und laesst los, die Fahrerliste oeffnet sich. Dort dasselbe im
      // Feld daneben mit der Planung, der KI Planer oeffnet sich. Zum Schluss
      // zurueck zur Startseite.
      aktion: [
        // Steht die Moeglichkeit nicht vorne, zieht der Finger sie hoch.
        { klick: 'navi-fahrer', nach: 150 },
        { klick: 'navi-planung', nach: 1400 },
        { klick: 'navi-home', nach: 1800 },
      ],
      text: 'Die Leiste unten bleibt auf jeder Seite stehen. Das Haus führt zur Startseite, der Pin zur Karte mit allen Fahrern und das Plus legt eine neue Fahrt an. Zwei Felder sind mehrfach belegt. Das mittlere öffnet Fahrten, Fahrer oder Fahrzeuge, das daneben die Planung oder den KI-Assistenten. Zum Wechseln das Feld gedrückt halten, nach oben ziehen und loslassen. Die gewählte Seite öffnet sich sofort und bleibt vorne im Feld.',
    },

    // ---------- Fahrten ----------
    {
      kategorie: 'Fahrten',
      pfad: ['Startseite', 'Alle Fahrten'],
      ort: 'fahrten',
      fokus: 'fahrt-' + FAHRT_VIP,
      text: 'Alle Fahrten erscheinen als Karten mit Gästen, Strecke, zugeteiltem Fahrer und Zeit. Verschiebt sich eine Fahrt, steht die ursprüngliche Zeit durchgestrichen daneben.',
    },
    {
      kategorie: 'Fahrerantwort',
      pfad: ['Alle Fahrten', 'Fahrerantwort'],
      ort: 'fahrten',
      // Beide Karten als ein Ausschnitt — um die einzelne Namenszeile waere der
      // Rand zu eng und schnitte die Zeilen darueber und darunter an.
      fokus: [['fahrt-' + FAHRT_VIP, 'fahrt-' + FAHRT_OFFEN]],
      // Der Finger zeigt die beiden Fahrernamen.
      aktion: [
        { umkreisen: '[data-tutorial="fahrt-fahrer-' + FAHRT_VIP + '"]', runden: 1, nach: 1200 },
        { umkreisen: '[data-tutorial="fahrt-fahrer-' + FAHRT_OFFEN + '"]', runden: 1, nach: 200 },
      ],
      text: 'Die Farbe des Fahrernamens zeigt die Antwort auf die Fahrt. Schwarz steht für bestätigt, orange für noch offen und rot für abgelehnt. Abgelehnte Fahrten lassen sich so sofort erkennen und neu vergeben.',
    },
    {
      kategorieLinks: 'Suchen',
      kategorieRechts: 'Filtern',
      pfad: ['Alle Fahrten', 'Filter'],
      ort: 'fahrten',
      fokus: ['fahrten-suche', 'fahrten-filter-knopf'],
      // Nach dem Hervorheben oeffnet der Finger den Filter.
      aktion: { klick: 'fahrten-filter-knopf', nach: 1800, ortDanach: 'fahrtenFilter' },
      // Die Schalter selbst — die Huelle darum ist bildschirmbreit.
      fokusDanach: [['filter-schalter-ohne-fahrer', 'filter-schalter-bestaetigung', 'filter-schalter-konvoi', 'filter-schalter-besonderheiten', 'filter-schalter-vergangene']],
      links: 'Über die Suche lassen sich Fahrten nach Kunde oder Fahrer finden.',
      rechts: 'Der Filter grenzt die Liste ein, etwa auf Fahrten ohne Fahrer, mit Konvoi oder mit Besonderheiten.',
    },
    {
      kategorie: 'Wischen',
      pfad: ['Alle Fahrten', 'Schnellaktionen'],
      ort: 'fahrten',
      // Erst die Karte ins Bild holen, dann zur Seite wischen.
      aktion: [
        { scrollZu: 'fahrt-' + FAHRT_OFFEN, nach: 400 },
        { ziehen: 'fahrt-' + FAHRT_OFFEN, dx: 120, dy: 0, nach: 300 },
      ],
      fokusDanach: [['fahrt-aktion-erledigt-' + FAHRT_OFFEN, 'fahrt-aktion-archiv-' + FAHRT_OFFEN]],
      text: 'Wird eine Fahrtkarte zur Seite gewischt, lässt sich die Fahrt direkt als erledigt markieren oder archivieren. In die andere Richtung wird sie dupliziert.',
    },
    {
      kategorie: 'Fahrt bearbeiten',
      pfad: ['Alle Fahrten', 'Fahrt bearbeiten'],
      ort: 'fahrtBearbeiten',
      fokus: [['zeile-feld-datum', 'zeile-feld-zeit', 'zeile-feld-start', 'zeile-feld-ziel']],
      text: 'Ein Tipp auf eine Karte öffnet die Fahrt mit allen Angaben. Jede Änderung liegt sofort beim Fahrer vor.',
    },
    {
      kategorie: 'Flug',
      pfad: ['Fahrt bearbeiten', 'Flugnummer'],
      ort: 'fahrtBearbeiten',
      fokus: 'zeile-feld-flug',
      text: 'Bei Flughafenfahrten wird die Flugnummer hinterlegt. Verspätet sich der Flug, verschieben sich Abholzeit und Ankunft automatisch, auch in der Fahrer-App.',
    },
    {
      kategorie: 'Fahrt anlegen',
      pfad: ['Startseite', 'Fahrt anlegen'],
      ort: 'fahrtAnlegen',
      fokus: null,
      // Der Finger fuellt eine Fahrt aus und speichert sie.
      aktion: [
        { klick: 'anlegen-datum', tippen: HEUTE, nach: 700 },
        { klick: 'anlegen-zeit', tippen: '18:45', nach: 200 },
        { klick: 'anlegen-start', tippen: 'Hotel Bayerischer Hof', nach: 200 },
        { klick: 'vorschlag-ort-0', nach: 500 },
        { klick: 'anlegen-ziel', tippen: 'Flughafen München', nach: 200 },
        { klick: 'vorschlag-ort-0', nach: 500 },
        { klick: 'anlegen-fahrer', tippen: 'Dennis', nach: 200 },
        { klick: 'vorschlag-fahrer-' + FAHRER_DENNIS, nach: 500 },
        { klick: 'anlegen-speichern', nach: 500, ortDanach: 'fahrten' },
      ],
      text: 'Mit dem Plus entsteht eine neue Fahrt: Datum, Uhrzeit, Start, Ziel und Fahrer eintragen und speichern. Die Fahrt steht danach in der Liste und kommt beim Fahrer als Angebot an.',
    },
    {
      kategorieLinks: 'Konvoi',
      kategorieRechts: 'Import',
      pfad: ['Fahrt anlegen', 'Konvoi & Import'],
      ort: 'fahrtAnlegen',
      fokus: ['zeile-anlegen-konvoi', 'import-knopf'],
      links: 'Fahren mehrere Fahrzeuge für eine Gruppe, wird ein Konvoi angelegt. Jedes Fahrzeug bekommt dann einen eigenen Fahrer.',
      rechts: 'Viele Fahrten auf einmal kommen per Excel- oder CSV-Import ins System, statt jede einzeln einzutragen.',
    },

    // ---------- Fahrer & Dienstplan ----------
    {
      kategorie: 'Planungsübersicht',
      pfad: ['Startseite', 'Fahrer Liste'],
      ort: 'fahrer',
      fokus: 'planungsuebersicht',
      // Der Finger wischt durch die Stunden des Tages.
      aktion: [
        { ziehen: 'planung-wischflaeche', dx: -160, dy: 0, nach: 1400 },
      ],
      text: 'Die Planungsübersicht vergleicht über den Tag, wie viele Fahrer im Dienst sind und wie viele Fahrten anstehen. So fallen Engpässe auf, bevor sie entstehen.',
    },
    {
      kategorie: 'Fahrerliste',
      pfad: ['Fahrer Liste', 'Fahrer'],
      ort: 'fahrer',
      fokus: ['fahrer-status', 'fahrer-' + FAHRER_ADRIAN],
      text: 'Jeder Fahrer steht mit Fahrzeug, Nummer und Dienstzeiten in der Liste. Über Im Dienst, Frei und Unfertig lässt sich die Liste eingrenzen.',
    },
    // "Dienste planen" (von Hand) ist vorerst ausgeblendet, siehe DIENSTE_VON_HAND in AlleFahrer.jsx.

    // ---------- KI-Planer ----------
    {
      kategorie: 'KI-Planer',
      pfad: ['Fahrer Liste', 'KI-Planer'],
      // Ohne fertigen Einsatz oeffnet der KI-Planer direkt den Kalender.
      ort: 'planer',
      fokus: 'planer-kalender',
      text: 'Der KI-Planer beginnt mit dem Kalender. Die Disposition wählt den Zeitraum des Einsatzes, bis zu drei Tage voraus. Wählbar sind die Tage, an denen Fahrten anstehen.',
    },
    {
      kategorie: 'Einsatzplanung',
      pfad: ['KI-Planer', 'Einsatzplanung'],
      ort: 'planer',
      // Der Schritt bereitet sich selbst vor: im Kalender morgen waehlen und
      // die Planung starten. So stehen Vorschlaege auch dann da, wenn man von
      // hinten hierher kommt.
      aktion: [
        { klick: 'planer-tag-1', nach: 700 },
        { klick: 'planer-kalender-weiter', nach: 600, ortDanach: 'planerBedarf' },
        // Bedarfsuebersicht: gerechnet wird erst mit dem Pfeil.
        { klick: 'planer-bedarf-weiter', nach: 1400, ortDanach: 'planerTag' },
      ],
      // Nur das Tagesdiagramm (Fahrer gegen Bedarf): die Dienstvorschlaege liegen
      // seit dem Engine-Block weit unten und kommen als eigener Schritt ("Vorschläge").
      // 'planer-strategie' gibt es auch in der Planer-Ansicht dahinter, deshalb nicht.
      fokus: 'planer-tag-diagramm',
      fokusNachAktion: true,
      text: 'Mit einem Tipp entstehen Dienstvorschläge für den gewählten Zeitraum. Die TRISAR-Engine rechnet Stau, Flugverspätungen und Großveranstaltungen vorab ein und senkt CO₂ und Kosten gemeinsam. Standard plant knapp und steuert am Einsatztag nach, Sicher deckt mit mehr Fahrzeugen auch seltene Störungen vorab ab.',
    },

    // ---------- TRISAR-Engine in der Tagesplanung (Stadttag) ----------
    // Werte aus admin-app-demo/src/demo/data/engine-ergebnisse.json, Stand 02.11.2026.
    {
      kategorie: 'TRISAR-Engine',
      pfad: ['Einsatzplanung', 'Engine'],
      ort: 'planerTag',
      zustand: { planerTag: 1 },
      fokus: 'planer-engine-karte',
      text: 'Die Engine plant Fahrzeuge, Fahrerdienste, Ladefenster und Verkehrsart aller Fahrten in einer Rechnung, mit CO₂ und Kosten als Ziel. Darunter der Vergleich mit der Planung wie heute, mit festen 20 min Puffer je Fahrt.',
    },
    {
      kategorieLinks: 'Vorhersage',
      kategorieRechts: 'Puffer je Fahrt',
      pfad: ['Einsatzplanung', 'Risiko'],
      ort: 'planerTag',
      zustand: { planerTag: 1 },
      fokus: ['planer-vorhersage', 'planer-puffer-dash'],
      links: 'Vor dem Einsatztag sammelt die Engine, was der Tag bringt: Flugankünfte mit Verspätung, Bahnankünfte, Verkehr je Stunde, Großveranstaltungen.',
      rechts: 'Daraus rechnet sie für jede Fahrt das Risiko. Puffer gibt es nur dort, wo er gebraucht wird, statt überall gleich.',
    },
    {
      kategorie: 'Rad & U-Bahn',
      pfad: ['Einsatzplanung', 'Umstieg'],
      ort: 'planerTag',
      // Heute (Basistag): hier liegen die Rad-Angebote. Antwort des Gasts zuruecksetzen,
      // damit der Schritt immer gleich aussieht.
      zustand: { planerTag: 0, angebot: { ride: 'demo-h001', antwort: 'offen' } },
      aktion: [
        { scrollZu: 'angebot-demo-h001', nach: 500 },
        { klick: 'angebot-demo-h001', nach: 800 },
      ],
      fokus: [['angebot-demo-h001', 'angebot-detail']],
      fokusNachAktion: true,
      text: 'Ist viel Verkehr vorhergesagt, schlägt die Engine Standardgästen vor, ab einem Umsteigepunkt mit Leihrad oder U-Bahn weiterzufahren, wenn das deutlich schneller ist. In der Vorabplanung bleibt das ein Angebot. Entscheiden tut der Gast.',
    },
    {
      kategorie: 'Zusage',
      pfad: ['Umstieg', 'Neu geplant'],
      ort: 'planerTag',
      zustand: { planerTag: 0, angebot: { ride: 'demo-h001', antwort: 'zugesagt' } },
      fokus: [['angebot-demo-h001', 'angebot-detail']],
      text: 'Sagt der Gast in seiner App zu, plant TRISAR die Fahrt neu: Das Auto fährt nur noch bis U Nordfriedhof, der Gast ist 10 Minuten früher am Ziel und das Auto fährt 5,6 km weniger.',
    },
    {
      kategorie: 'Vorschläge',
      pfad: ['Einsatzplanung', 'Vorschläge'],
      ort: 'planerTag',
      zustand: { planerTag: 1 },
      aktion: [
        { scrollZu: 'planer-vorschlag-0', nach: 400 },
        // Annehmen und Ablehnen nur zeigen: ein angenommener Vorschlag
        // verschwindet, die Hervorhebung spraenge sonst auf den naechsten Fahrer.
        { umkreisen: '[data-tutorial="planer-vorschlag-0-ablehnen"]', runden: 1, nach: 1400 },
        { umkreisen: '[data-tutorial="planer-vorschlag-0-annehmen"]', runden: 1, nach: 200 },
      ],
      fokus: [['planer-vorschlag-0', 'planer-vorschlag-0-ablehnen', 'planer-vorschlag-0-annehmen']],
      fokusNachAktion: 1,
      text: 'Darunter steht für jeden Fahrer ein Dienstvorschlag mit seinen Fahrten. Jeder Vorschlag lässt sich einzeln annehmen oder ablehnen.',
    },
    {
      kategorie: 'Plan annehmen',
      pfad: ['Einsatzplanung', 'Annehmen'],
      ort: 'planerTag',
      // Direkt nach unten springen statt an allen Vorschlaegen vorbeizuwischen.
      zustand: { planerTag: 1, planerZu: 'planer-tag-accept' },
      aktion: [
        { klick: 'planer-tag-accept', nach: 900 },
      ],
      fokus: 'planer-tag-accept',
      text: 'Mit accept wird der ganze Tag übernommen. Jeder Fahrer bekommt seinen Dienst als Anfrage in die Fahrer-App.',
    },
    {
      kategorie: 'Störung am Einsatztag',
      pfad: ['KI-Assistent', 'Störung'],
      ort: 'ki',
      // Stoerung am Stadttag (morgen) sicher im Assistenten, auch wenn accept uebersprungen wurde.
      // Direkt in den Assistenten, statt sich rueckwaerts durch die Planung zu klicken.
      zustand: { stoerungTag: 1, ansicht: 'kiAssistent' },
      fokus: [['ki-antwort', 'ki-neuplanung']],
      text: 'Am Einsatztag sperrt ein Unfall die A9. Der KI-Assistent meldet die Störung, erklärt kurz die Folgen und hat schon eine Neuplanung vorbereitet.',
    },
    {
      kategorieLinks: 'Neuplanung',
      kategorieRechts: 'Übernehmen',
      pfad: ['Störung', 'Neuplanung'],
      ort: 'neuplanung',
      fokus: 'neuplanung-vergleich',
      aktion: [
        { scrollZu: 'planer-neuplanung-uebernehmen', nach: 1600 },
        { umkreisen: '[data-tutorial="planer-neuplanung-uebernehmen"]', runden: 1, nach: 300 },
      ],
      fokusDanach: [['neuplanung-aenderungen', 'planer-neuplanung-uebernehmen']],
      links: 'Der Planer zeigt nur, was sich ändert, mit dem Vergleich: ohne Eingriff 3 Gäste zu spät, nach der Neuplanung keiner. Mit festen Puffern wären es 38 gewesen, 23 davon schon ohne Unfall.',
      rechts: '4 Fahrten bekommen einen anderen Fahrer. Die Disposition übernimmt mit einem Tipp oder lehnt ab.',
    },

    // ---------- Karte ----------
    // Die Karte wird der Reihe nach gezeigt, ohne Spruenge: jeder Schritt macht
    // dort weiter, wo der vorige aufgehoert hat, und die Kamera faehrt weich.
    {
      kategorie: 'Karte',
      pfad: ['Startseite', 'Karte'],
      ort: 'karte',
      // Kommt man zurueck, ist kein Fahrer mehr gewaehlt.
      zustand: { karteAbwaehlen: true },
      fokus: null,
      // Ein Tipp auf das Kartensymbol holt alle Fahrer ins Bild.
      aktion: [
        { klick: 'navi-karte', nach: 1200 },
      ],
      text: 'Die Karte zeigt alle Fahrer live. Rot fahren aktive Fahrer mit Gast, gelb sind inaktive Fahrer auf dem Weg zur nächsten Fahrt, grün sind freie Fahrer. Im Pin steht die Fahrernummer. Dicht beieinander fasst ein weißer Kreis die Fahrer mit ihrer Anzahl zusammen. Ein Tipp auf das Kartensymbol unten holt alle wieder ins Bild.',
    },
    {
      kategorie: 'Status',
      pfad: ['Karte', 'Status'],
      ort: 'karte',
      fokus: 'karte-status',
      // Erst nur die aktiven Fahrer, dann kommen inaktive und freie dazu.
      aktion: [
        { klick: 'karte-status-aktiv', nach: 1400 },
        { klick: 'karte-status-inaktiv', nach: 1800 },
        { klick: 'karte-status-frei', nach: 1800 },
      ],
      text: 'Oben steht, wie viele Fahrer gerade aktiv, inaktiv oder frei sind. Ein Tipp auf einen Status zeigt nur diese Fahrer. Weitere Tipps nehmen die übrigen wieder dazu.',
    },
    {
      kategorie: 'Inaktiv-Fenster',
      pfad: ['Karte', 'Inaktiv-Fenster'],
      ort: 'karte',
      fokus: null,
      aktion: [
        { lange: 'karte-status-inaktiv', nach: 900 },
      ],
      fokusDanach: [['karte-status', 'karte-inaktiv-fenster']],
      text: 'Gedrückt halten auf Inaktiv öffnet das Inaktiv-Fenster. Dort wird eingestellt, wie viele Stunden vor seiner nächsten Fahrt ein Fahrer als inaktiv zählt. Liegt die Fahrt später, gilt er bis dahin als frei.',
    },
    {
      kategorie: 'Fahrer suchen',
      pfad: ['Karte', 'Filter'],
      ort: 'karte',
      fokus: null,
      aktion: [
        { klick: 'karte-inaktiv-schliessen', nach: 700 },
        { klick: 'karte-filter-knopf', nach: 700, ortDanach: 'kartenFilter' },
      ],
      fokusDanach: 'karte-filter-suche',
      text: 'Über den Filter oben rechts lassen sich einzelne Fahrer suchen. Die Karte zeigt dann nur noch diese Fahrer.',
    },
    {
      kategorie: 'Route',
      pfad: ['Karte', 'Route'],
      ort: 'karte',
      // Kommt man von hinten zurueck, zuerst die Auswahl aufheben, sonst hebt
      // der Tipp auf den Fahrer sie auf.
      zustand: { karteAbwaehlen: true },
      fokus: null,
      // Steckt der Fahrer in einer Gruppe, tippt der Finger zuerst die Gruppe
      // an, die Karte faehrt hinein, dann den Fahrer.
      aktion: [
        { klick: 'karte-fahrer-' + FAHRER_STEFANO, nach: 900 },
      ],
      // Der frei sichtbare Teil der Karte ueber dem zugeklappten Blatt.
      fokusDanach: 'karte-frei',
      text: 'Ein Tipp auf eine Gruppe fährt hinein, ein Tipp auf einen Fahrer zeigt seine Fahrt. Die übrigen Fahrer treten zurück. Gestrichelt die Anfahrt zum Gast, blau der Weg zum Ziel, jeweils mit der Dauer. Der schon gefahrene Teil wird blass.',
    },
    {
      kategorie: 'Fahrerdetails',
      pfad: ['Karte', 'Fahrer'],
      ort: 'karte',
      fokus: null,
      aktion: [
        // Das Blatt am Griff hochziehen.
        { ziehen: 'karte-blatt-griff', dy: -460, nach: 700 },
      ],
      // Vom Kennzeichen bis zu den Dienstzeiten, ohne Griff und Markieren-Knopf.
      fokusDanach: [['karte-blatt-kennzeichen', 'karte-blatt-dienst']],
      text: 'Wird das Blatt hochgezogen, stehen dort Fahrzeug, Name und Telefonnummer, die nächste Fahrt und die Dienstzeiten des Fahrers. Die Nummer lässt sich direkt anrufen.',
    },
    {
      kategorie: 'Fahrerprofil',
      pfad: ['Fahrer', 'Profil'],
      ort: 'karte',
      fokus: null,
      aktion: [
        { klick: 'karte-blatt-name', nach: 900 },
        { klick: 'karte-profil-zurueck', nach: 3200 },
      ],
      text: 'Ein Tipp auf den Namen öffnet das Profil des Fahrers mit Foto und Kontakt. Zurück geht es wieder zum Blatt.',
    },

    // ---------- Stammdaten ----------
    {
      kategorie: 'Fahrzeuge',
      pfad: ['Startseite', 'Fahrzeugliste'],
      ort: 'fahrzeuge',
      // Die beiden Karten liegen direkt uebereinander — ein gemeinsamer Ausschnitt,
      // zwei einzelne wuerden sich im schmalen Spalt ueberlappen.
      fokus: [['fahrzeug-' + FAHRZEUG_STEFANO, 'fahrzeug-' + FAHRZEUG_KNAPP]],
      text: 'Die Fahrzeugliste zeigt Antrieb, Farbe, Ladestand und Sitzplätze. Fahrzeuge mit knapper Reichweite fallen dadurch sofort auf.',
    },
    {
      kategorie: 'Kunden',
      pfad: ['Startseite', 'Kunden Liste'],
      ort: 'kunden',
      fokus: 'kunden-suche',
      // Statt lange zu scrollen wird die Kundin gesucht.
      aktion: { klick: 'kunden-suche', tippen: 'Vogel', nach: 900 },
      fokusDanach: 'kunde-' + KUNDIN_VOGEL,
      text: 'Unter Kunden stehen alle Fahrgäste mit ihren Kontaktdaten und Besonderheiten wie VIP, Kindersitz oder Rollstuhl. Kundenlisten lassen sich ebenfalls importieren.',
    },

    // ---------- KI-Assistent ----------
    {
      kategorie: 'KI-Assistent',
      pfad: ['Startseite', 'KI-Assistent'],
      ort: 'ki',
      fokus: null,
      // Zwei Fragen zum Einsatz, zuletzt eine Buchung per Nachricht. Der
      // Assistent denkt jeweils 3 s nach, bevor die Antwort dasteht.
      aktion: [
        // Name und Telefonnummer eines Fahrers, die Nummer ist direkt anrufbar.
        { klick: 'ki-eingabe', tippen: KI_FRAGE_TELEFON, nach: 700 },
        { klick: 'ki-senden', nach: 300 },
        { umkreisen: '[data-tutorial="ki-telefon"]', runden: 1, nach: 3800 },
        { klick: 'ki-eingabe', tippen: KI_FRAGE_OHNE_FAHRER, nach: 600 },
        { klick: 'ki-senden', nach: 300 },
        { umkreisen: '[data-tutorial="ki-antwort"]', runden: 1, nach: 3800 },
        { klick: 'ki-eingabe', tippen: KI_FRAGE_AKKU, nach: 600 },
        { klick: 'ki-senden', nach: 300 },
        { umkreisen: '[data-tutorial="ki-antwort"]', runden: 1, nach: 3800 },
        { klick: 'ki-eingabe', tippen: KI_ANFRAGE, nach: 600 },
        { klick: 'ki-senden', nach: 300 },
        { klick: 'ki-buchen', nach: 3800 },
      ],
      fokusDanach: 'ki-vorschlag',
      text: 'Der KI-Assistent beantwortet Fragen zum Einsatz direkt aus den aktuellen Daten, etwa wie ein Fahrer zu erreichen ist, welche Fahrten noch keinen Fahrer haben oder welche Fahrzeuge laden oder tanken müssen. Telefonnummern lassen sich direkt antippen. Fahrten lassen sich hier auch per Nachricht buchen. Aus der Nachricht entsteht ein Buchungsvorschlag, der mit einem Tipp übernommen wird.',
    },

    // ---------- Abschluss ----------
    {
      kategorie: 'Abschluss',
      pfad: ['Disposition'],
      ort: 'list',
      fokus: null,
      text: 'Das war die Disposition. Hier entstehen die Fahrten, die in der Fahrer-App ankommen. Das Fahrer-Tutorial zeigt die andere Seite, alternativ lässt sich die Disposition jetzt frei ausprobieren.',
      abschluss: [
        { label: 'Zur Fahrer-App', ziel: 'fahrer' },
        { label: 'Disposition frei erkunden', ziel: 'frei' },
      ],
    },
  ];

  // Markierungen sitzen in der Disposition buendig auf dem Element — ohne
  // Abstand drumherum. Ein Schritt kann mit eigenem luft-Wert abweichen.
  window.TRISAR_TUTORIAL_DISPO.forEach(function (schritt) {
    if (schritt.luft == null) schritt.luft = 0;
  });
})();
