// Ort im Chat korrigieren (19.11.2026).
// Die Ortssuche nimmt bei mehreren passenden Treffern den naechsten zum Standort der Dispo (ortSuche.ts) und merkt
// sich die uebrigen im Kontext (ortAlternativen). Sagt die Dispo danach "nein, falsches Ziel, ich meinte die in
// Augsburg" oder "die Frühlingstraße in Augsburg", wird der Vorschlag auf den passenden Treffer umgestellt. Gibt es
// keinen gemerkten, wird mit Strasse und Ort neu gesucht. Passt mehreres oder gar nichts: Auswahl wie in ortWahl.ts.
// Gilt im alten und im neuen Ablauf (aufgerufen aus kiFrage, vor allem anderen).

// deno-lint-ignore-file no-explicit-any
import { type OrtOption, ortAufloesen, orteLaden, bezugspunkt } from './ortSuche.ts';
import { jetztBerlin, tagLesbar } from './dienst.ts';
import { ortWahlFragen } from './ortWahl.ts';

type Feld = 'start' | 'ziel';
export type OrtAlternativen = { start?: { text: string; optionen: OrtOption[] }; ziel?: { text: string; optionen: OrtOption[] }; vorschlag?: any; zeit: number };

const FRIST_MS = 30 * 60_000;
const normal = (t: unknown) => String(t ?? '').toLowerCase()
  .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
  .replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

// Nur Saetze, die einen Ort zuruecknehmen. "Fahrt nach Augsburg" allein ist ein neuer Auftrag, keine Korrektur.
export const KORREKTUR_RE = /\b(falsch\w*|ich\s+mein\w*|meinte|gemeint|sondern|nicht\s+(die|das|den|der|diese[nrs]?|in|im)\b|eine\s+andere|die\s+andere|den\s+anderen|das\s+andere)/i;
const STOP = new Set(['nein', 'ne', 'nee', 'falsch', 'falsche', 'falsches', 'falscher', 'ziel', 'start', 'ich', 'meinte', 'meine', 'mein', 'gemeint',
  'die', 'das', 'den', 'der', 'dem', 'des', 'in', 'im', 'nach', 'von', 'vom', 'zum', 'zur', 'nicht', 'sondern', 'bitte', 'doch', 'andere', 'anderen',
  'anderes', 'ort', 'adresse', 'eine', 'einen', 'ist', 'war', 'wars', 'und', 'aber', 'ja', 'okay', 'ok', 'hab', 'habe', 'gesagt', 'diese', 'dieser',
  'strasse', 'str', 'weg', 'platz', 'bei', 'aus', 'mit', 'fuer', 'auf', 'da', 'dort', 'hin', 'abholung', 'abholort', 'zielort']);

const feldAus = (text: string, alt: OrtAlternativen): Feld => {
  if (/\b(start\w*|abhol\w*|abfahrt\w*|losfahr\w*|von\s+wo)\b/i.test(text)) return 'start';
  if (/\b(ziel\w*|wohin|bring\w*|hinfahr\w*)\b/i.test(text)) return 'ziel';
  if (alt.start && !alt.ziel) return 'start';
  return 'ziel';
};

const vorschlagText = (p: any) => {
  const heute = jetztBerlin().datum;
  const tag = /^\d{4}-\d{2}-\d{2}$/.test(String(p?.datum || '')) ? tagLesbar(p.datum, heute) : String(p?.datum || '');
  const fahrer = Array.isArray(p?.fahrerNamen) && p.fahrerNamen.length ? `, Fahrer ${p.fahrerNamen.join(', ')}` : ', noch ohne Fahrer';
  return `Vorschlag: ${tag}${p?.startZeit ? ` um ${p.startZeit}` : ''}, ${p?.start || '?'} → ${p?.ziel || '?'}`
    + `${p?.fahrgaeste ? `, Gast ${p.fahrgaeste}` : ''}${fahrer}.\nSoll ich die Fahrt so buchen?`;
};

// Gehoeren die gemerkten Treffer zu dem Vorschlag, der gerade offen ist?
const gleicherVorschlag = (a: any, b: any) => !!a && !!b && normal(a.start) === normal(b.start) && normal(a.ziel) === normal(b.ziel)
  && String(a.datum || '') === String(b.datum || '') && String(a.startZeit || '') === String(b.startZeit || '');

export const ortKorrektur = async (admin: any, body: any, text: string, dispoId: string | null) => {
  const kontext = body?.kontext && typeof body.kontext === 'object' ? body.kontext : {};
  const alt: OrtAlternativen | undefined = kontext.ortAlternativen;
  if (!alt || Date.now() - Number(alt.zeit || 0) > FRIST_MS || !KORREKTUR_RE.test(text) || text.length > 160) return null;
  const offen = body?.offenerVorschlag && typeof body.offenerVorschlag === 'object' ? body.offenerVorschlag : null;
  if (offen && alt.vorschlag && !gleicherVorschlag(offen, alt.vorschlag)) return null;
  const p = offen || alt.vorschlag;
  if (!p) return null;
  const feld = feldAus(text, alt);
  const gemerkt = alt[feld];
  const woerter = normal(text).split(' ').filter((w) => w.length >= 3 && !STOP.has(w) && !/^\d+$/.test(w));
  const neuerKontext = (vorschlag: any, optionen: OrtOption[]) => ({
    ...kontext, ortAlternativen: { ...alt, [feld]: { text: gemerkt?.text || String(p[feld] || ''), optionen }, vorschlag, zeit: Date.now() },
  });
  const auswahl = (optionen: OrtOption[], suchText: string) => ortWahlFragen(
    [{ feld, text: suchText, optionen: optionen.slice(0, 3) }],
    { answer: vorschlagText(p), action: { type: 'booking_proposal', proposal: p }, aktionen: [{ type: 'booking_proposal', proposal: p }], meta: {} },
    kontext,
  );

  let wert = '';
  let ortId = '';
  let adresse = '';
  if (!woerter.length) {
    // "Nein, das falsche Ziel" ohne neuen Ort: die gemerkten Treffer zur Auswahl.
    if (gemerkt?.optionen.length) return auswahl(gemerkt.optionen, gemerkt.text);
    return { answer: `Welches ${feld === 'start' ? 'Start' : 'Ziel'} meinst du? Nenne Straße und Ort.`, kontext, meta: { regel: 'ortKorrektur' } };
  }
  const passt = (o: OrtOption) => woerter.every((w) => normal(o.wert).includes(w) || normal(o.wert).includes(w.slice(0, 5)));
  const treffer = (gemerkt?.optionen || []).filter(passt);
  if (treffer.length === 1) {
    wert = treffer[0].wert;
  } else if (treffer.length > 1) {
    return auswahl(treffer, gemerkt?.text || String(p[feld] || ''));
  } else {
    // Nicht unter den gemerkten: Strasse aus dem bisherigen Text plus die neuen Woerter suchen
    // ("Frühlingstr" + "Augsburg"). Steht im Satz schon eine Strasse, reicht der Satz.
    const strasse = String(gemerkt?.text || p[feld] || '').split(',')[0].trim();
    const neuText = text.replace(/^\s*(nein|ne|nee)\b[,.!\s]*/i, '').replace(KORREKTUR_RE, ' ').replace(/\b(das|die|den|der)\s+(falsche\w*\s+)?(ziel|start)\b/gi, ' ').replace(/\s+/g, ' ').trim();
    const hatStrasse = /(str(\.|asse|aße)?|weg|platz|allee|ring|gasse)\b/i.test(neuText);
    const suche = hatStrasse ? neuText : `${strasse} ${woerter.join(' ')}`;
    const orte = await orteLaden(admin);
    const e = await ortAufloesen(admin, suche, orte, dispoId, await bezugspunkt(admin, dispoId, body?.standort, orte));
    if (e.unsicher) return auswahl(e.unsicher, suche);
    ({ text: wert, ortId, adresse } = e);
  }
  if (!wert || normal(wert) === normal(p[feld])) {
    return { answer: `Das ist schon ${feld === 'start' ? 'der Start' : 'das Ziel'}: ${p[feld]}. Nenne Straße und Ort, wenn ein anderer Ort gemeint ist.`, kontext, meta: { regel: 'ortKorrektur' } };
  }
  const vorher = String(p[feld] || '');
  const neu = { ...p, [feld]: wert, [`${feld}OrtId`]: ortId, [`${feld}Adresse`]: adresse };
  const rest = [...(gemerkt?.optionen || []).filter((o) => o.wert !== wert), ...(vorher ? [{ wert: vorher, titel: vorher.split(',')[0], zeile: vorher.split(',').slice(1).join(',').trim() }] : [])];
  const action = { type: 'booking_proposal', proposal: neu };
  return {
    answer: `Geändert: ${feld === 'start' ? 'Start' : 'Ziel'} jetzt ${wert}.\n${vorschlagText(neu)}`,
    action,
    aktionen: [action],
    kontext: neuerKontext(neu, rest.slice(0, 5)),
    meta: { regel: 'ortKorrektur', feld },
  };
};

// Treffer aus der Buchung (meta.ortAlternativen) im Kontext merken, zusammen mit dem Vorschlag. Ein neuer Vorschlag
// ohne Alternativen loescht die alten, damit eine spaetere Korrektur nie einen fremden Vorschlag aendert.
export const alternativenMerken = (daten: any) => {
  if (!daten || typeof daten !== 'object') return daten;
  const meta = daten.meta || {};
  const a = meta.ortAlternativen;
  const p = daten.action?.type === 'booking_proposal' ? daten.action.proposal : null;
  if (!p && !a) return daten;
  const kontext = { ...(daten.kontext || {}) };
  if (a && p) kontext.ortAlternativen = { ...a, vorschlag: p, zeit: Date.now() };
  else if (p) delete kontext.ortAlternativen;
  const m = { ...meta };
  delete m.ortAlternativen;
  return { ...daten, kontext, meta: m };
};
