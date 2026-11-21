// Ortsauswahl beim Buchen (18.11.2026).
// Ist Start oder Ziel unsicher (ortSuche.ts: mehrere Treffer, andere Hausnummer, nichts gefunden), kommt statt der
// Fahrtkarte erst die Frage "Welchen Start meinst du?" mit bis zu 3 Orten zum Antippen (action ort_auswahl).
// Die fertige Buchung wartet im Kontext (offeneOrtwahl) und kommt erst, wenn jeder unsichere Ort gewaehlt ist.
// Antippen schickt den ganzen Text des Orts als Nachricht. Getippt gehen auch "2", "die erste", "keiner davon"
// oder eine neue Adresse. Aeltere Apps zeigen die Orte nummeriert im Text.

// deno-lint-ignore-file no-explicit-any
import { anschriftVoll, bezugspunkt, type OrtOption, ortAufloesen, orteLaden } from './ortSuche.ts';
import { normal as normalRoh } from './dienst.ts';

// Ohne Rand und Satzzeichen ("1.", "Keiner davon.").
const normal = (t: string) => normalRoh(t).replace(/[.:\-–]/g, ' ').replace(/\s+/g, ' ').trim();

type Offen = { feld: 'start' | 'ziel'; text: string; optionen: OrtOption[]; grund?: string };
export type OffeneOrtwahl = { offen: Offen[]; daten: any; zeit: number };

const frageText = (o: Offen) => o.optionen.length
  ? (o.feld === 'start' ? 'Welchen Start meinst du?' : 'Welches Ziel meinst du?')
  // Adresssuche faellt aus (19.11.): volle Adresse geht dann ungeprueft (ortSuche.ts).
  : o.grund === 'nicht_pruefbar'
    ? `Die Adresssuche antwortet gerade nicht. Nenne ${o.feld === 'start' ? 'den Start' : 'das Ziel'} bitte mit Straße, Hausnummer, Postleitzahl und Ort.`
  : `„${o.text}“ finde ich nicht. Nenne bitte Straße und Ort ${o.feld === 'start' ? 'für den Start' : 'für das Ziel'}.`;

const aktion = (o: Offen) => ({ type: 'ort_auswahl', feld: o.feld, frage: frageText(o), optionen: o.optionen });

const ohneWahl = (k: any) => {
  const r = { ...(k || {}) };
  delete r.offeneOrtwahl;
  return r;
};

const fragen = (wahl: OffeneOrtwahl, kontext: any) => {
  const o = wahl.offen[0];
  const a = aktion(o);
  const liste = o.optionen.map((x, i) => `${i + 1}. ${x.titel}${x.zeile ? `, ${x.zeile}` : ''}`);
  return {
    answer: [a.frage, ...liste].join('\n'),
    action: a,
    aktionen: [a],
    kontext: { ...ohneWahl(kontext), offeneOrtwahl: wahl },
    meta: { regel: 'ortWahl' },
  };
};

// Auswahl fuer einen Ort von aussen starten (ortKorrektur.ts, 19.11.): "ich meinte die andere" mit mehreren Treffern.
export const ortWahlFragen = (offen: Offen[], daten: any, kontext: any) => ({ ...fragen({ offen, daten, zeit: Date.now() }, kontext) });

// Fertige Buchung mit unsicherem Ort: erst fragen. Nur bei genau einer Buchung, mehrere Auftraege bleiben wie sie sind.
export const ortWahlStarten = (ergebnis: any) => {
  const d = ergebnis?.daten;
  const unsicher: Offen[] | undefined = d?.meta?.ortWahl;
  if (!unsicher?.length || d?.action?.type !== 'booking_proposal') return ergebnis;
  const buchungen = (Array.isArray(d.aktionen) ? d.aktionen : []).filter((a: any) => a?.type === 'booking_proposal');
  if (buchungen.length > 1) return ergebnis;
  const meta = { ...(d.meta || {}) };
  delete meta.ortWahl;
  const wahl: OffeneOrtwahl = {
    offen: unsicher,
    daten: { answer: d.answer, action: d.action, aktionen: d.aktionen ?? null, modell: d.modell ?? null, meta },
    zeit: Date.now(),
  };
  return { ...ergebnis, daten: { ...fragen(wahl, d.kontext), modell: d.modell ?? null } };
};

const ORDNUNG: Record<string, number> = { erste: 0, ersten: 0, erster: 0, eins: 0, zweite: 1, zweiten: 1, zweiter: 1, zwei: 1, dritte: 2, dritten: 2, dritter: 2, drei: 2 };
const KEINER = /^(nein,?\s*)?(keine[rns]?|keins|nichts|andere[rns]?)(\s+davon|\s+von\s+denen|\s+passt)?\.?$/;
const AUFTRAG = /\b(buch\w*|fahrt\w*|dienst\w*|storn\w*|l(ö|oe)sch\w*|schick\w*|schreib\w*|wo\s+ist|wer|wann|wie\s+viele?)\b/i;

const gewaehlt = (o: Offen, text: string): OrtOption | null => {
  const n = normal(text);
  const zahl = n.match(/^(die\s+|den\s+|nummer\s+|nr\s+)?([1-5])$/);
  if (zahl) return o.optionen[Number(zahl[2]) - 1] || null;
  const wort = n.match(/^(die|den|der|das)?\s*(\w+)(\s+(adresse|ort|option))?$/);
  if (wort && ORDNUNG[wort[2]] !== undefined) return o.optionen[ORDNUNG[wort[2]]] || null;
  return o.optionen.find((x) => normal(x.wert) === n || normal(x.titel) === n
    || (x.zeile && normal(`${x.titel}, ${x.zeile}`) === n)) || null;
};

// Antwort auf die offene Ortsauswahl. null: die Nachricht ist keine Antwort darauf (neuer Auftrag, Frage).
export const ortWahlAntwort = async (admin: any, kontext: any, text: string, dispoId: string | null, standort: unknown = null) => {
  const wahl: OffeneOrtwahl | undefined = kontext?.offeneOrtwahl;
  const o = wahl?.offen?.[0];
  if (!wahl || !o || !wahl.daten?.action?.proposal) return null;
  const n = normal(text);
  if (KEINER.test(n)) {
    return fragen({ ...wahl, offen: [{ ...o, optionen: [] }, ...wahl.offen.slice(1)] }, kontext);
  }
  let wert = '';
  let ortId = '';
  let adresse = '';
  const x = gewaehlt(o, text);
  if (x) {
    wert = await anschriftVoll(admin, x, dispoId);
  } else {
    // Neue Adresse statt Auswahl ("Frankfurter Ring 227 München"). Ein neuer Auftrag beendet die Auswahl.
    if (!text.trim() || text.length > 80 || AUFTRAG.test(text) || /\?\s*$/.test(text)) return null;
    const orte = await orteLaden(admin);
    const e = await ortAufloesen(admin, text.trim(), orte, dispoId, await bezugspunkt(admin, dispoId, standort, orte));
    if (e.unsicher) return fragen({ ...wahl, offen: [{ feld: o.feld, text: text.trim(), optionen: e.unsicher, ...(e.nichtPruefbar ? { grund: 'nicht_pruefbar' } : {}) }, ...wahl.offen.slice(1)] }, kontext);
    ({ text: wert, ortId, adresse } = e);
  }
  const daten = structuredClone(wahl.daten);
  const p = daten.action.proposal;
  p[o.feld] = wert;
  p[`${o.feld}OrtId`] = ortId;
  p[`${o.feld}Adresse`] = adresse;
  daten.answer = String(daten.answer || '').split(o.text).join(wert);
  if (Array.isArray(daten.aktionen)) daten.aktionen = daten.aktionen.map((a: any) => (a?.type === 'booking_proposal' ? daten.action : a));
  const rest = wahl.offen.slice(1);
  if (rest.length) return fragen({ ...wahl, offen: rest, daten }, kontext);
  if (!daten.aktionen) delete daten.aktionen;
  return { ...daten, kontext: ohneWahl(kontext), meta: { ...(daten.meta || {}), regel: 'ortWahlFertig' } };
};
