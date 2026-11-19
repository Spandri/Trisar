// Nur eine Liste von Namen ohne Auftrag ("Marvin Bendrix  Gregor Müller  Tim Boberschmidt ..."):
// nachfragen statt raten. Vorher ging das ans Modell, das eine Antwort aus dem Verlauf erfunden hat
// (ki_protokoll 12.11.). Unbekannte Namen: "Als neue Fahrer anlegen?", "ja" bereitet die Karten vor.

// deno-lint-ignore-file no-explicit-any
import { anlegenVorschlag } from './anlegen.ts';
import { normal } from './dienst.ts';

const FRIST_MS = 15 * 60 * 1000;
const JA_RE = /^\s*(ja|jo|jap|japp|yes|ok|okay|klar|genau|passt|gerne|bitte|mach(s|e)?|anleg\w*|leg (sie|die) an)\b/;
const NEIN_RE = /^\s*(nein|ne|nee|nope|nicht|abbrechen|stopp?|vergiss|doch nicht)\b/;
const WORT = "[A-ZÄÖÜ][a-zäöüß'-]+";

// Keine Namen (16.11.: "Den Tom Tom Schlüssel" wurde als zwei neue Fahrer "Den Tom" und "Tom Schlüssel" angeboten).
// Artikel, Fürwörter, Fragewörter, Befehlswörter und häufige Sachwörter, wie sie am Satzanfang oder nach der
// Spracherkennung gross geschrieben stehen.
const KEIN_NAME = new Set(['der', 'die', 'das', 'den', 'dem', 'des', 'ein', 'eine', 'einen', 'einem', 'einer', 'mein', 'meine', 'meinen',
  'dein', 'deine', 'unser', 'unsere', 'ich', 'du', 'er', 'sie', 'es', 'wir', 'ihr', 'wer', 'was', 'wo', 'wann', 'wie', 'warum', 'welche',
  'welcher', 'welches', 'welchen', 'und', 'oder', 'aber', 'auch', 'noch', 'nur', 'nicht', 'kein', 'keine', 'bitte', 'danke', 'hallo', 'ja', 'nein',
  'mit', 'ohne', 'fuer', 'von', 'vom', 'zum', 'zur', 'nach', 'bei', 'auf', 'aus', 'in', 'im', 'an', 'am', 'um', 'bis',
  'zeig', 'zeige', 'gib', 'such', 'suche', 'mach', 'mache', 'schick', 'schicke', 'loesch', 'loesche', 'leg', 'lege', 'sag', 'sage', 'schreib', 'ruf',
  'heute', 'morgen', 'gestern', 'jetzt', 'gerade', 'alle', 'allen', 'jeder', 'jemand', 'niemand',
  'schluessel', 'datei', 'dateien', 'daten', 'datenbank', 'passwort', 'server', 'auto', 'autos', 'fahrzeug', 'fahrzeuge', 'wagen', 'fahrt', 'fahrten',
  'fahrer', 'dienst', 'dienste', 'dienstreise', 'tracker', 'karte', 'liste', 'kunde', 'kunden', 'gast', 'gaeste', 'hotel', 'flughafen', 'bahnhof',
  'messe', 'terminal', 'uhr', 'standort', 'adresse', 'nummer', 'telefon', 'nachricht', 'pause', 'feierabend', 'standby', 'route', 'ticket', 'zug']);

const namenAus = (roh: string): string[] | null => {
  const t = roh.trim();
  // Nur Namen, Leerzeichen, Kommas, Zeilen, "und": keine Verben, keine Zahlen.
  if (!new RegExp(`^(?:${WORT}(?:[\\s,]+|$))+$`).test(t.replace(/\s+und\s+/g, ' , '))) return null;
  const woerter = t.replace(/,|\bund\b/g, ' ').split(/\s+/).filter(Boolean);
  if (woerter.length < 4 || woerter.length % 2 !== 0 || woerter.length > 24) return null;
  if (woerter.some((w) => KEIN_NAME.has(normal(w).trim()))) return null;
  // Zweimal dasselbe Wort hintereinander ("Tom Tom") ist kein Vor- und Nachname.
  if (woerter.some((w, i) => i + 1 < woerter.length && normal(w).trim() === normal(woerter[i + 1]).trim())) return null;
  const namen: string[] = [];
  for (let i = 0; i < woerter.length; i += 2) namen.push(`${woerter[i]} ${woerter[i + 1]}`);
  return namen;
};

export const namenListe = async (admin: any, frage: string, kontext: any, karten: boolean) => {
  const roh = String(frage || '').trim();
  const offen = kontext?.offeneNamen;
  if (offen && Date.now() - Number(offen.zeit || 0) < FRIST_MS && roh.length <= 40) {
    const k = { ...(kontext || {}) };
    delete k.offeneNamen;
    const text = normal(roh);
    if (NEIN_RE.test(text)) return { answer: 'Okay, ich lege niemanden an.', kontext: k };
    if (JA_RE.test(text)) {
      const auftrag = `Leg ${offen.namen.map((n: string) => `Fahrer ${n}`).join(' und ')} an`;
      return await anlegenVorschlag(admin, auftrag, k, karten);
    }
  }
  const namen = namenAus(roh);
  if (!namen) return null;
  const { data } = await admin.from('profiles').select('first_name, last_name');
  const bekannt = new Set((Array.isArray(data) ? data : []).map((p: any) => normal(`${p.first_name || ''} ${p.last_name || ''}`).trim()));
  const neu = namen.filter((n) => !bekannt.has(normal(n).trim()));
  const da = namen.filter((n) => bekannt.has(normal(n).trim()));
  const daText = da.length ? `${da.join(', ')} ${da.length === 1 ? 'ist' : 'sind'} schon Fahrer. ` : '';
  if (!neu.length) return { answer: `${daText}Was soll ich mit ihnen machen? Zum Beispiel einen Dienst schicken oder eine Fahrt buchen.`, kontext };
  return {
    answer: `${daText}Soll ich ${neu.join(', ')} als neue Fahrer anlegen? Mit „ja“ bereite ich ${neu.length === 1 ? 'den Fahrer' : 'die Fahrer'} zum Bestätigen vor.`,
    kontext: { ...(kontext || {}), offeneNamen: { namen: neu, zeit: Date.now() } },
  };
};
