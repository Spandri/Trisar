// Stundenlohn per KI-Assistent: "Gib allen Fahrern 30 € Stundenlohn", "Setze Tim auf 28,50 €",
// "Wie hoch ist der Stundenlohn von Marvin?". Ohne Modell, die Regel liest Betrag und Fahrer aus der Frage.
//
// Aenderungen werden nie sofort geschrieben: erst kommt eine Rueckfrage mit Betrag und Fahrern,
// "ja" im Chat speichert (profiles.stundenlohn), "nein" verwirft. Die offene Rueckfrage reist im
// Gespraechs-Kontext mit (offenerLohn), so geht es in Web, iOS und Android ohne neuen App-Build.

// deno-lint-ignore-file no-explicit-any

import { ausnahmen, ausnahmenText, ohneAusnahmen } from './ausnahmen.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DISPO_ROLLEN = new Set(['dispo', 'dispatcher', 'admin', 'koordinator', 'coordinator', 'pruefung']);
const FRIST_MS = 15 * 60 * 1000;
const MIN_EURO = 5;
const MAX_EURO = 200;

type Fahrer = { id: string; name: string; lohn: number | null; nr: string; vor: string; nach: string };

const normal = (text: string) => ` ${String(text || '').toLowerCase()
  .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
  .replace(/[^a-z0-9:.,\- ]+/g, ' ')
  .replace(/\s+/g, ' ')} `;

const LOHN_RE = /stundenlohn|stundensatz|stundenverguetung|stundengeld|\blohn\b|\bgehalt\b|verguetung|bezahlung|verdien|(euro|eur)\s*(pro|je|die|in der)\s*stunde|(pro|je)\s*stunde|\/\s*h\b/;
const JA_RE = /^\s*(ja|jo|jap|japp|yes|ok|okay|okey|klar|genau|passt|stimmt|richtig|mach(s|e)?( das)?|machen|speicher(n|e)?|bestaetig(e|en|t)?|uebernehm(e|en)|in ordnung|gerne|bitte|sicher|los)\b/;
const NEIN_RE = /^\s*(nein|ne|nee|nope|nicht|abbrechen|abbruch|stopp?|lass(e|en)? (es|das)|vergiss|verwerfen|doch nicht)\b/;
const FRAGE_RE = /\?|\b(wie|was|wieviel|wie viel|welche|welcher|zeig|zeige|nenn|nenne|sag|sage)\b/;
const ALLE_RE = /\b(allen|alle|jedem|jeden|jeder|saemtlichen|saemtliche|ihnen allen)\b/;
const MARKIERTE_RE = /\b(markiert\w*|ausgewaehlt\w*|diese[nm]?|die drei|die zwei|die beiden)\b/;

const euro = (n: number) => `${n.toFixed(2).replace('.', ',')} €`;
const zahl = (text: string) => Number(text.replace(',', '.'));

// Betrag aus dem Rohtext: "30€", "30,50 Euro", "von 30", "auf 28.5". Ohne Waehrungszeichen nur nach Praeposition.
const betragAusText = (roh: string): number | null => {
  const mitZeichen = roh.match(/(?<![\d.,])(\d{1,4}(?:[.,]\d{1,2})?)\s*(?:€|eur\b|euro\b)/i);
  if (mitZeichen) return zahl(mitZeichen[1]);
  const mitWort = roh.match(/\b(?:von|auf|mit|bei|betraegt|beträgt|ist|sind|:|=)\s*(\d{1,4}(?:[.,]\d{1,2})?)\b(?!\s*[.:]\s*\d)/i);
  if (mitWort) return zahl(mitWort[1]);
  const mitStunde = roh.match(/(?<![\d.,])(\d{1,4}(?:[.,]\d{1,2})?)\s*(?:pro|je|die|in der|\/)\s*(?:stunde|h)\b/i);
  if (mitStunde) return zahl(mitStunde[1]);
  return null;
};

const fahrerLaden = async (admin: any): Promise<Fahrer[]> => {
  const { data, error } = await admin.from('profiles').select('id, first_name, last_name, driver_number, role, stundenlohn');
  if (error || !Array.isArray(data)) return [];
  return data
    .filter((p: any) => !DISPO_ROLLEN.has(String(p?.role || '').toLowerCase()))
    .map((p: any) => ({
      id: String(p.id),
      name: [p.first_name, p.last_name].filter(Boolean).join(' ').trim() || `Fahrer ${p.driver_number ?? ''}`.trim(),
      lohn: p.stundenlohn == null ? null : Number(p.stundenlohn),
      nr: p.driver_number == null ? '' : String(p.driver_number).trim(),
      vor: normal(p.first_name).trim(),
      nach: normal(p.last_name).trim(),
    }));
};

// Fahrer, die im Text mit Namen oder Nummer genannt sind (Vor- oder Nachname nur, wenn eindeutig).
const genannt = (fahrer: Fahrer[], text: string): Fahrer[] => {
  const enthaelt = (wort: string) => wort.length >= 2 && new RegExp(`\\b${wort.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(text);
  const gefunden = new Map<string, Fahrer>();
  for (const f of fahrer) {
    const voll = `${f.vor} ${f.nach}`.trim();
    if (voll.includes(' ') && enthaelt(voll)) gefunden.set(f.id, f);
  }
  for (const feld of ['vor', 'nach'] as const) {
    const zaehler = new Map<string, number>();
    fahrer.forEach((f) => f[feld] && zaehler.set(f[feld], (zaehler.get(f[feld]) || 0) + 1));
    for (const f of fahrer) {
      if (gefunden.has(f.id) || !f[feld] || zaehler.get(f[feld]) !== 1) continue;
      if (enthaelt(f[feld])) gefunden.set(f.id, f);
    }
  }
  for (const m of text.matchAll(/\b(?:fahrer|nr|nummer)\s*(\d{1,4})\b/g)) {
    const f = fahrer.find((x) => x.nr === m[1]);
    if (f) gefunden.set(f.id, f);
  }
  return [...gefunden.values()];
};

const namenText = (liste: Fahrer[]) => (liste.length <= 6
  ? liste.map((f) => f.name).join(', ')
  : `${liste.slice(0, 5).map((f) => f.name).join(', ')} und ${liste.length - 5} weitere`);

export type LohnAntwort = { answer: string; kontext: any } | null;

const ohneOffenen = (kontext: any) => {
  const k = { ...(kontext || {}) };
  delete k.offenerLohn;
  return k;
};

export const lohnVorschlag = async (admin: any, frage: string, markiert: { id: string; name: string }[], kontext: any): Promise<LohnAntwort> => {
  const roh = String(frage || '').trim();
  const text = normal(roh);
  const offen = kontext?.offenerLohn;
  const offenGueltig = offen && Array.isArray(offen.ids) && offen.ids.length && Number.isFinite(Number(offen.betrag))
    && Date.now() - Number(offen.zeit || 0) < FRIST_MS;

  // Antwort auf die Rueckfrage.
  if (offenGueltig && roh.length <= 60) {
    if (NEIN_RE.test(text)) {
      return { answer: 'Okay, ich habe nichts geändert.', kontext: ohneOffenen(kontext) };
    }
    if (JA_RE.test(text) && !FRAGE_RE.test(text)) {
      const ids = offen.ids.filter((id: string) => UUID.test(id));
      const betrag = Number(offen.betrag);
      const { data, error } = await admin.from('profiles').update({ stundenlohn: betrag }).in('id', ids).select('id');
      if (error) {
        return { answer: `Das Speichern hat nicht geklappt (${error.message}). Es wurde nichts geändert.`, kontext: ohneOffenen(kontext) };
      }
      const n = Array.isArray(data) ? data.length : 0;
      return {
        answer: `Gespeichert: Stundenlohn ${euro(betrag)} für ${n === 1 ? '1 Fahrer' : `${n} Fahrer`}.`,
        kontext: ohneOffenen(kontext),
      };
    }
  }

  // "ja" auf eine Rueckfrage, die schon zu lange her ist: nicht still speichern.
  if (offen && !offenGueltig && roh.length <= 60 && JA_RE.test(text) && !FRAGE_RE.test(text)) {
    return { answer: 'Die Rückfrage ist schon zu lange her. Sag mir bitte noch einmal, welchen Stundenlohn ich für wen setzen soll.', kontext: ohneOffenen(kontext) };
  }

  if (!LOHN_RE.test(text)) return null;

  // Ausgenommene ("alle außer Tim") fallen weg, siehe ausnahmen.ts.
  const fahrer = ohneAusnahmen(admin, await fahrerLaden(admin));
  let ziel: Fahrer[] = genannt(fahrer, text);
  let meinung = '';
  if (!ziel.length && ALLE_RE.test(text)) {
    ziel = fahrer;
    meinung = 'alle';
  } else if (!ziel.length && markiert.length && (MARKIERTE_RE.test(text) || !ALLE_RE.test(text))) {
    const ids = new Set(markiert.map((m) => m.id));
    ziel = fahrer.filter((f) => ids.has(f.id.toLowerCase()));
    meinung = 'markierte';
  }

  // Negativer Betrag (16.11.): "Stundenlohn minus 5 Euro" und "-12 Euro" wurden als 5 und 12 Euro vorgeschlagen.
  if (/\bminus\s*\d/i.test(roh) || /(^|\s)[-−]\d+(?:[.,]\d+)?\s*(€|euro|eur)\b/i.test(roh)) {
    return { answer: `Ein negativer Stundenlohn geht nicht. Nenne bitte einen Betrag zwischen ${MIN_EURO} und ${MAX_EURO} €. Ich habe nichts geändert.`, kontext: ohneOffenen(kontext) };
  }
  const betrag = betragAusText(roh);

  // Nur nachschauen: "Wie hoch ist der Stundenlohn von Tim?"
  if (betrag == null || (FRAGE_RE.test(text) && !/\b(setz|setze|gib|geb|gebe|erhoeh|erhoehe|aender|aendere|stell|stelle|mach|mache|trag|trage)\b/.test(text))) {
    const liste = ziel.length ? ziel : fahrer;
    if (!liste.length) return { answer: 'Ich finde keine Fahrer in der Datenbank.', kontext: ohneOffenen(kontext) };
    if (betrag == null && !FRAGE_RE.test(text) && !ziel.length) {
      return { answer: 'Welcher Stundenlohn soll es sein und für wen? Zum Beispiel: „Gib allen Fahrern 30 € Stundenlohn“ oder „Setze Tim auf 28,50 €“.', kontext: ohneOffenen(kontext) };
    }
    if (betrag == null && !FRAGE_RE.test(text)) {
      return { answer: `Welcher Betrag soll für ${namenText(ziel)} gelten? Zum Beispiel „30 €“.`, kontext: ohneOffenen(kontext) };
    }
    const zeilen = [...liste].sort((a, b) => a.name.localeCompare(b.name, 'de'))
      .map((f) => `${f.name}: ${f.lohn == null ? 'nicht gesetzt' : euro(f.lohn)}`);
    return { answer: `Stundenlohn ${ziel.length ? '' : 'aller Fahrer '}(${liste.length}):\n${zeilen.join('\n')}`, kontext: ohneOffenen(kontext) };
  }

  if (!Number.isFinite(betrag) || betrag < MIN_EURO || betrag > MAX_EURO) {
    return {
      answer: `${euro(betrag)} pro Stunde kommt mir unwahrscheinlich vor. Ich nehme nur Beträge zwischen ${MIN_EURO} und ${MAX_EURO} €. Schreib den Betrag bitte noch einmal.`,
      kontext: ohneOffenen(kontext),
    };
  }
  if (!ziel.length) {
    return {
      answer: `Für wen soll der Stundenlohn ${euro(betrag)} gelten? Nenne Namen oder schreibe „allen Fahrern“. Auf der Karte markierte Fahrer gehen auch.`,
      kontext: ohneOffenen(kontext),
    };
  }

  const bisher = ziel.filter((f) => f.lohn != null);
  const gleich = ziel.filter((f) => f.lohn === betrag);
  const neu = ziel.filter((f) => f.lohn !== betrag);
  if (!neu.length) {
    return { answer: `${ziel.length === 1 ? `${ziel[0].name} hat` : 'Alle genannten Fahrer haben'} schon ${euro(betrag)}. Es ist nichts zu ändern.`, kontext: ohneOffenen(kontext) };
  }
  const wer = meinung === 'alle'
    ? (ausnahmen(admin).length ? `${ziel.length > 3 ? `${ziel.length} Fahrer` : namenText(ziel)}${ausnahmenText(admin)}` : `alle ${ziel.length} Fahrer`)
    : meinung === 'markierte'
      ? (ziel.length === 1 ? `den markierten Fahrer (${ziel[0].name})` : `die ${ziel.length} markierten Fahrer (${namenText(ziel)})`)
      : ziel.length === 1 ? ziel[0].name : `${ziel.length} Fahrer (${namenText(ziel)})`;
  const hinweis = bisher.length
    ? ` Bisher: ${bisher.slice(0, 4).map((f) => `${f.name} ${euro(f.lohn as number)}`).join(', ')}${bisher.length > 4 ? ' …' : ''}.`
    : ' Bisher ist bei niemandem ein Stundenlohn gesetzt.';
  return {
    answer: `Ich setze den Stundenlohn auf ${euro(betrag)} für ${wer}.${hinweis}${gleich.length ? ` ${gleich.length} haben den Wert schon.` : ''}\n\nSoll ich das speichern? Antworte mit „ja“ oder „nein“.`,
    kontext: { ...(kontext || {}), offenerLohn: { betrag, ids: neu.map((f) => f.id), zeit: Date.now() } },
  };
};
