// Grobe Absicht einer Nachricht, bevor die festen Regeln (Dienst, Standby, Zuordnen, Fragen) laufen.
//
// Hintergrund (ki_protokoll 12.11.): "Neue Fahrt Stefano am Samstag um 11:58 Start in Offenburg am Bahnhof,
// Ende in München Möhlstr 31" wurde als Dienst gelesen, weil "Start" und "Ende" auch Dienst-Woerter sind.
// Ein klarer Fahrtauftrag geht deshalb direkt zur Buchung.

import { normal } from './dienst.ts';

const NEUE_FAHRT = /\b(neue[nrs]?|eine|ne|einen|noch eine|weitere)\s+(neue\s+|weitere\s+|zweite\s+)?(fahrt|tour|transfer|abholung|buchung)\b/;
const FAHRT_VERB = /\bbuch(e|en|t|st)?\b|\bfahrt\s+(anlegen|erstellen|buchen|eintragen|planen)\b|^\s*(eine\s+|neue\s+)?fahrt\b/;
const FAHRT_WORT = /\b(fahrt|tour|transfer|abholung|abholen|hol\w*\s.*\bab)\b/;
// Strecke: "von X nach Y", "vom Bahnhof zum Hotel", "Start in Offenburg ... Ende in München", "ab X bis Y".
const STRECKE = /\b(von|vom|ab|start\w*\s+(in|im|am|an|ab|bei|beim|vom)|abholung\s+(in|im|am|an|bei|beim|vom))\b\s+\D.*\b(nach|zum|zur|zu|ins|ende|ziel\w*|bis\s+(zum|zur|nach))\b/;
const FRAGE = /^\s*(wann|wer|wie|was|wo|welche\w*|hat|haben|ist|sind|gibt|zeig\w*|liste\w*)\b/;

// true: die Nachricht ist ein Auftrag fuer eine neue Fahrt (oder aendert eine), kein Dienst/Standby/Zuordnen.
export const istFahrtAuftrag = (frage: string) => {
  const text = normal(frage);
  if (FRAGE.test(text) && /\?\s*$/.test(String(frage || ''))) return false;
  if (NEUE_FAHRT.test(text) || FAHRT_VERB.test(text)) return true;
  return FAHRT_WORT.test(text) && STRECKE.test(text);
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
