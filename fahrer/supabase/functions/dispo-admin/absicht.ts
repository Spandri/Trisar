// Grobe Absicht einer Nachricht, bevor die festen Regeln (Dienst, Standby, Zuordnen, Fragen) laufen.
//
// Hintergrund (ki_protokoll 12.11.): "Neue Fahrt Stefano am Samstag um 11:58 Start in Offenburg am Bahnhof,
// Ende in München Möhlstr 31" wurde als Dienst gelesen, weil "Start" und "Ende" auch Dienst-Woerter sind.
// Ein klarer Fahrtauftrag geht deshalb direkt zur Buchung.

import { normal } from './dienst.ts';

const NEUE_FAHRT = /\b(neue[nrs]?|eine|ne|einen|noch eine|weitere)\s+(neue\s+|weitere\s+|zweite\s+)?(fahrt|tour|transfer|abholung|buchung)\b/;
const FAHRT_VERB = /\bbuch(e|en|t|st)?\b|\bfahrt\s+(anlegen|erstellen|buchen|eintragen|planen)\b|^\s*(eine\s+|neue\s+)?fahrt\b/;
const FAHR_VERB = /\b(fahr(en|t|e|st)?|faehr(t|st)|bring(en|t|e|st)?|abhol\w*|chauffier\w*)\b/;
const UHRZEIT = /\b(um|ab|gegen)\s+\d{1,2}([:.]\d{2})?\b|\b\d{1,2}[:.]\d{2}\b|\b\d{1,2}\s*uhr\b/;
const AENDERN = /\b(aender|verschieb|korrigier|statt|anstatt|stattdessen|tausch|wechsel|uebernimm|uebernehm)\w*/;
const FAHRT_WORT = /\b(fahrt|tour|transfer|abholung|abholen|hol\w*\s.*\bab)\b/;
// Strecke: "von X nach Y", "vom Bahnhof zum Hotel", "Start in Offenburg ... Ende in München", "ab X bis Y".
const STRECKE = /\b(von|vom|ab|start\w*\s+(in|im|am|an|ab|bei|beim|vom)|abholung\s+(in|im|am|an|bei|beim|vom))\b\s+\D.*\b(nach|zum|zur|zu|ins|ende|ziel\w*|bis\s+(zum|zur|nach))\b/;
const FRAGE = /^\s*(wann|wer|wie|was|wo|welche\w*|hat|haben|ist|sind|gibt|zeig\w*|liste\w*)\b/;

// true: die Nachricht ist ein Auftrag fuer eine neue Fahrt (oder aendert eine), kein Dienst/Standby/Zuordnen.
export const istFahrtAuftrag = (frage: string) => {
  const text = normal(frage);
  if (FRAGE.test(text) && /\?\s*$/.test(String(frage || ''))) return false;
  if (NEUE_FAHRT.test(text) || FAHRT_VERB.test(text)) return true;
  if (FAHRT_WORT.test(text) && STRECKE.test(text)) return true;
  // "Stefano soll vom Flughafen zum Hauptbahnhof fahren um 20:30", "Bring Frau X vom Hotel zur Messe um 9":
  // Fahr-Verb + Strecke + Uhrzeit ist eine neue Fahrt, solange nichts geaendert werden soll.
  return FAHR_VERB.test(text) && STRECKE.test(text) && UHRZEIT.test(text) && !AENDERN.test(text);
};

// "Start in Offenburg am Bahnhof, Ende in München Möhlstr 31" in die Form, die die Buchung sicher liest:
// "von Offenburg am Bahnhof, nach München Möhlstr 31". Nur wenn danach ein Ort folgt, nicht eine Zeit.
const NICHT_ZEIT = '(?!(?:montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag|heute|morgen|übermorgen|um\\b|ab\\b|auf\\b|der\\b|des\\b|dem\\b|\\d))';
const START_ORT = new RegExp(`\\b(?:start(?:punkt|ort)?|abfahrt(?:sort)?|abholung|abholort|beginn)\\s*(?::\\s*|\\s+(?:in|im|am|an|ab|bei|beim|vom|von)\\s+|\\s+)${NICHT_ZEIT}`, 'gi');
const ZIEL_ORT = new RegExp(`\\b(?:ende|ziel(?:ort)?|endpunkt|zieladresse|ankunft(?:sort)?)\\s*(?::\\s*|\\s+(?:in|im|am|an|bei|beim)\\s+|\\s+)${NICHT_ZEIT}`, 'gi');
export const streckeVereinfachen = (frage: string) => {
  const roh = String(frage || '');
  // Nur fuer neue Fahrten. "Ändere bei der Fahrt das Ziel auf Terminal 1" bleibt, wie es ist.
  if (!istFahrtAuftrag(roh) || /\b(änder|aender|verschieb|korrigier|setz)\w*/i.test(roh)) return roh;
  return roh.replace(START_ORT, 'von ').replace(ZIEL_ORT, 'nach ').replace(/,\s*nach /g, ' nach ');
};

// Eine neue Fahrt so umschreiben, dass die Buchung sie sicher liest (15.11., aus dem ki_protokoll):
// - "um halb 4" -> "um 15:30 Uhr", "viertel nach 6" -> "06:15 Uhr" (Stunden 1 bis 5 gelten als nachmittags)
// - "am Flughafen München zum Flughafen Salzburg" -> "von Flughafen München zum ..."
// - "17:00 Messe zu Flughafen T2" -> "17:00 von Messe nach Flughafen T2"
// - "... fahren ohne Gast" am Ende faellt weg (ohne Gast ist der Normalfall)
// Nur fuer neue Fahrten aufrufen, nie fuer Aenderungen.
const stunde = (n: number) => String(n >= 1 && n <= 5 ? n + 12 : n).padStart(2, '0');
export const buchungGlaetten = (frage: string) => {
  let t = String(frage || '');
  if (/\b(änder|aender|verschieb|korrigier)\w*/i.test(t)) return t;
  if (!/\b\d{1,2}[:.]\d{2}\b/.test(t)) {
    t = t.replace(/\b(um\s+|gegen\s+|ab\s+)?halb\s+(\d{1,2})\b(?!\s*[:.]\d)/i, (_a, vor, n) => {
      const h = Number(n) - 1 < 1 ? 12 : Number(n) - 1;
      return `${vor || 'um '}${stunde(h)}:30 Uhr`;
    });
    t = t.replace(/\b(um\s+|gegen\s+|ab\s+)?viertel\s+nach\s+(\d{1,2})\b/i, (_a, vor, n) => `${vor || 'um '}${stunde(Number(n))}:15 Uhr`);
    t = t.replace(/\b(um\s+|gegen\s+|ab\s+)?viertel\s+vor\s+(\d{1,2})\b/i, (_a, vor, n) => `${vor || 'um '}${stunde(Number(n) - 1 < 1 ? 12 : Number(n) - 1)}:45 Uhr`);
  }
  // "für herrn engel" klein getippt: Anrede und Name gross, damit der Gast erkannt wird.
  t = t.replace(/\b(herrn?|frau)\s+([a-zäöü])([\wäöüß-]+)/g, (_a, anrede, a1, rest) => `${anrede[0].toUpperCase()}${anrede.slice(1)} ${a1.toUpperCase()}${rest}`);
  t = t.replace(/\s+ohne\s+(gast|gäste|gaeste|fahrgast|fahrgäste|passagier\w*)\b/gi, '');
  t = t.replace(/\s+fahren\s*([.!]*)$/i, '$1');
  const hatVon = /\b(von|vom|ab)\s+\D/i.test(t.replace(/\bab\s+\d/gi, ''));
  if (!hatVon && /\b(zum|zur|nach|zu)\s+\S/i.test(t)) {
    // "am/beim X zum Y": Ort vor dem Ziel ist der Start.
    const mitAm = t.replace(new RegExp(`\\b(am|an der|an dem|beim|bei der|im)\\s+${NICHT_ZEIT}(?=[^,]*\\b(zum|zur|nach|zu)\\b)`, 'i'), 'von ');
    if (mitAm !== t) t = mitAm;
    // "17:00 Messe zu Flughafen": Ort zwischen Uhrzeit und Ziel ist der Start.
    else t = t.replace(/(\b\d{1,2}[:.]\d{2}(?:\s*uhr)?)\s+(?!uhr\b)([A-ZÄÖÜ][\wäöüßÄÖÜ.\- ]{1,40}?)\s+(zu|zum|zur|nach)\s+/i, '$1 von $2 nach ');
  }
  return t.replace(/^\s*(dann|und dann|danach|außerdem|ausserdem)\s+/i, '');
};
