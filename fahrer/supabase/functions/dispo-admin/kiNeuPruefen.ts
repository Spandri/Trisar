// Umbau KI-Assistent, Phase 3 (18.11., reports/KI Assistent Umbau Plan.md): Pruefer vor jeder Aktion.
// Feste Pruefungen ohne zweites Modell. Sie deuten keinen Satz und bauen keinen Befehl, sie halten nur einen
// Vorschlag an, der nicht zum Satz passt. Tests ohne Modell: werkzeuge/ki-test/neu-pruefen-test.ts.

// deno-lint-ignore-file no-explicit-any
import { abstand, klein, type Person } from './kiNeuAufloesen.ts';

// Ausnahmewort: nur echte Ausnahmen, nicht "ohne Gast" oder "kein Dienst".
export const AUSNAHME_WORT = /\bau(ß|ss)er\b|\bbis\s+auf\b|\bausgenommen\b|\bausnahme\b|\bnur\s+\p{L}+\s+nicht\b|\balle[nms]?\s+(anderen|übrigen|uebrigen)\b/iu;
export const GRUPPE_WORT = /\b(alle[nms]?|jede[nmrs]?|s(ae|ä)mtliche[nm]?)\b|\bmarkiert\w*/i;

// Text einer Notiz (nach dem ersten Doppelpunkt, der keine Uhrzeit ist) zaehlt nie als Auftrag.
export const ohneNotizText = (frage: string) => {
  if (!/\b(notiz|vermerk|hinweis|anmerkung|schreib\w*\s+dazu)\b/i.test(frage)) return frage;
  const i = frage.search(/(?<!\d):(?!\d)/);
  return i >= 0 ? frage.slice(0, i) : frage;
};
export const LOESCH_WORT = /l(ö|oe)sch\w*|entfern\w*|streich\w*|\bweg\b|\braus\w*\b|aufheb\w*|zur(ü|ue)ck\s*nehm\w*/i;
export const STORNO_WORT = /storn\w*|absag\w*|cancel\w*|l(ö|oe)sch\w*|streich\w*|f(ä|ae)llt\s+aus|doch\s+nicht/i;
export const loeschenGesagt = (frage: string) => LOESCH_WORT.test(ohneNotizText(frage));
export const stornoGesagt = (frage: string) => STORNO_WORT.test(ohneNotizText(frage));

// Fahrer, die im Satz stehen (Vorname, Nachname, auch mit Tippfehler, oder "Fahrer 113").
export const fahrerImSatz = (frage: string, personen: Person[]): Person[] => {
  const w = klein(frage).replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter((x) => x.length >= 3);
  const nr = [...klein(frage).matchAll(/\b(?:fahrer|nr|nummer)\s*#?(\d{1,4})\b/g)].map((m) => m[1]);
  const passt = (x: string, n: string) => {
    const a = klein(n);
    if (!a) return false;
    if (x === a || x === `${a}s`) return true;
    const kl = (s: string) => s.replace(/ph/g, 'f').replace(/w/g, 'v').replace(/th/g, 't');
    return x.length >= 4 && abstand(kl(x), kl(a)) <= (a.length <= 7 ? 1 : 2);
  };
  return personen.filter((p) => w.some((x) => passt(x, p.vor) || passt(x, p.nach)) || (p.nummer && nr.includes(String(p.nummer))));
};

// "für Klaus", "an Paula": ein Name nach "für"/"an"/"mit", den es nicht gibt. Dann nie auf einen anderen Fahrer
// ausweichen (16.11.: "Wo ist Anna", dann "Feierabend für Klaus" traf Anna).
const KEIN_NAME = new Set(['alle', 'allen', 'jeden', 'jede', 'jeder', 'heute', 'morgen', 'uebermorgen', 'den', 'die', 'der', 'dem', 'das', 'ihn', 'ihm', 'sie', 'ihr',
  'mich', 'uns', 'euch', 'dich', 'markierten', 'fahrer', 'fahrt', 'fahrten', 'montag', 'dienstag', 'mittwoch', 'donnerstag', 'freitag', 'samstag', 'sonntag',
  'gast', 'gaeste', 'herrn', 'herr', 'frau', 'beide', 'beiden', 'einen', 'eine', 'ein', 'dienst', 'dienststart', 'dienstende', 'feierabend', 'uhr', 'halb', 'viertel',
  'dreiviertel', 'nachts', 'abends', 'morgens', 'immer', 'jetzt', 'sofort', 'mittag', 'mittags', 'naechste', 'naechsten', 'kommenden', 'diesen', 'diese', 'woche']);
export const unbekannteNamen = (frage: string, personen: Person[]): string[] => {
  const raus: string[] = [];
  // "von" fehlt bewusst ("von Gilching" ist ein Ort). Mit Herr/Frau ist es ein Gast, kein Fahrer.
  for (const m of frage.matchAll(/\b(?:für|fuer|an|mit)\s+(den\s+|die\s+|Herrn?\s+|Frau\s+|Fahrer(?:in)?\s+)?([A-ZÄÖÜ][a-zäöüß]{2,})\b/g)) {
    if (/^(herrn?|frau)\s/i.test(m[1] || '')) continue;
    const wort = klein(m[2]);
    if (KEIN_NAME.has(wort)) continue;
    if (fahrerImSatz(m[2], personen).length) continue;
    raus.push(m[2]);
  }
  return raus;
};

// Fuerwoerter, die auf den Fahrer aus dem Gespraech zeigen.
export const FUERWORT_IM_SATZ = /\b(er|ihn|ihm|sie|ihr|ihnen|die\s+beiden|beide|dem|denselben|derselbe|selben)\b|^\s*(dann|und|auch)\b/i;

export type Betroffen = { fahrerIds: string[]; tage: string[]; zeiten: string[]; art: string[]; fahrtIds: string[]; anzahl: number };
export type Erwartung = {
  absicht: string;
  fahrerIds: string[] | null;
  tage: string[] | null;
  zeiten: string[] | null;
  feierabend: boolean;
  fahrtId: string | null;
  loeschenErlaubt: boolean;
  stornoErlaubt: boolean;
};

// Was ein Ergebnis der Regeln bewirken wuerde: Karten und offene Rueckfragen.
export const betroffenAus = (daten: any, personen: Person[]): Betroffen => {
  const b: Betroffen = { fahrerIds: [], tage: [], zeiten: [], art: [], fahrtIds: [], anzahl: 0 };
  const idZuName = (n: string) => {
    const k = klein(n).trim();
    return personen.find((p) => klein(p.name) === k || klein(p.vor) === k)?.id || `?${n}`;
  };
  const karten = [...(Array.isArray(daten?.aktionen) ? daten.aktionen : []), ...(daten?.action ? [daten.action] : [])];
  for (const a of karten) {
    if (a?.type === 'dienst_vorschlag') {
      const v = a.vorschlag || {};
      b.art.push('dienst');
      b.fahrerIds.push(...(v.fahrer || []).map((f: any) => String(f.id)));
      if (v.datum) b.tage.push(String(v.datum));
      for (const z of [v.start, v.ende, ...(v.pausen || []).flatMap((p: any) => [p.von, p.bis])]) if (z) b.zeiten.push(String(z));
      b.anzahl = Math.max(b.anzahl, (v.fahrer || []).length);
    } else if (a?.type === 'booking_proposal') {
      const p = a.proposal || {};
      b.art.push(p.fahrtId ? 'fahrt_aendern' : 'fahrt_neu');
      b.fahrerIds.push(...(p.fahrerNamen || []).map(idZuName));
      if (p.datum) b.tage.push(String(p.datum));
      if (p.startZeit) b.zeiten.push(String(p.startZeit));
      if (p.fahrtId) b.fahrtIds.push(String(p.fahrtId).toLowerCase());
    } else if (a?.type === 'standby_proposal') {
      const s = a.standby || {};
      b.art.push('standby');
      b.fahrerIds.push(...(s.fahrerIds || []).map(String));
    }
  }
  const k = daten?.kontext || {};
  if (k.offeneDienste?.liste) {
    for (const v of k.offeneDienste.liste) {
      b.art.push('dienst');
      b.fahrerIds.push(...(v.fahrerIds || []).map(String));
      if (v.datum) b.tage.push(String(v.datum));
      for (const z of [v.start, v.ende]) if (z) b.zeiten.push(String(z));
      b.anzahl += (v.fahrerIds || []).length;
    }
  }
  if (k.offeneDienstLoeschung?.dienste) {
    b.art.push('dienst_loeschen');
    for (const d of k.offeneDienstLoeschung.dienste) { b.fahrerIds.push(String(d.fahrerId)); if (d.datum) b.tage.push(String(d.datum)); }
    b.anzahl = Math.max(b.anzahl, k.offeneDienstLoeschung.dienste.length);
  }
  if (k.offeneFahrtAktion) {
    b.art.push(k.offeneFahrtAktion.art === 'loeschen' ? 'loeschen' : k.offeneFahrtAktion.art === 'storno' ? 'storno' : String(k.offeneFahrtAktion.art || 'fahrt'));
    b.fahrtIds.push(String(k.offeneFahrtAktion.id).toLowerCase());
  }
  if (k.offenerLohn) { b.art.push('lohn'); b.fahrerIds.push(...(k.offenerLohn.ids || []).map(String)); b.anzahl = Math.max(b.anzahl, (k.offenerLohn.ids || []).length); }
  if (k.offeneSteuerung?.art === 'nachricht') { b.art.push('nachricht'); b.fahrerIds.push(...(k.offeneSteuerung.ids || []).map(String)); b.anzahl = Math.max(b.anzahl, (k.offeneSteuerung.ids || []).length); }
  else if (k.offeneSteuerung?.art) { b.art.push(`steuerung_${k.offeneSteuerung.art}`); if (k.offeneSteuerung.tabelle === 'profiles' && k.offeneSteuerung.id) b.fahrerIds.push(String(k.offeneSteuerung.id)); }
  if (k.offenesLoeschen) { b.art.push('loeschen'); b.fahrerIds.push(...(k.offenesLoeschen.fahrer || []).map((f: any) => String(f.id))); }
  if (k.offeneStandbyAenderung) b.art.push('standby_aendern');
  b.fahrerIds = [...new Set(b.fahrerIds)];
  b.tage = [...new Set(b.tage)];
  b.anzahl = Math.max(b.anzahl, b.fahrerIds.length);
  return b;
};

// Passt das Ergebnis zum Satz? Liefert die Gruende, warum nicht. Leer heisst: darf vorgeschlagen werden.
export const pruefen = (b: Betroffen, e: Erwartung, frage: string): string[] => {
  const g: string[] = [];
  if (e.fahrerIds) {
    const fremd = b.fahrerIds.filter((id) => !id.startsWith('?') && !e.fahrerIds!.includes(id));
    if (fremd.length) g.push('fahrer');
  }
  if (e.tage && b.tage.some((t) => !e.tage!.includes(t))) g.push('tag');
  // Uhrzeit nie aus der aktuellen Uhr: jede Zeit im Vorschlag muss aus einem Textfeld kommen. Feierabend ohne Zeit
  // ("jetzt") darf die aktuelle Zeit nehmen, weil es so gesagt wurde.
  if (e.zeiten && !e.feierabend && b.zeiten.some((z) => !e.zeiten!.includes(z))) g.push('uhrzeit');
  if (e.fahrtId && b.fahrtIds.some((id) => id !== e.fahrtId)) g.push('fahrt');
  if (b.art.includes('storno') && !(e.stornoErlaubt && stornoGesagt(frage))) g.push('storno');
  if (b.art.some((a) => a === 'loeschen' || a === 'dienst_loeschen') && !(e.loeschenErlaubt && (loeschenGesagt(frage) || e.absicht === 'dienst_loeschen' && LOESCH_ODER_FREI.test(ohneNotizText(frage))))) g.push('loeschen');
  return g;
};
const LOESCH_ODER_FREI = /l(ö|oe)sch|entfern|streich|\bweg\b|raus|aufheb|absag|\bfrei\b|nicht\s+mehr/i;

export const GRUND_TEXT: Record<string, string> = {
  fahrer: 'der Vorschlag träfe einen Fahrer, den du nicht genannt hast',
  tag: 'der Tag im Vorschlag ist ein anderer als in deinem Satz',
  uhrzeit: 'eine Uhrzeit im Vorschlag steht so nicht in deinem Satz',
  fahrt: 'der Vorschlag betrifft eine andere Fahrt',
  storno: 'Stornieren mache ich nur, wenn du es ausdrücklich sagst',
  loeschen: 'Löschen mache ich nur, wenn du es ausdrücklich sagst',
};

// Ab drei Betroffenen: Liste zeigen und ein ausdrueckliches "ja" verlangen.
export const VORSCHAU_AB = 3;
export const vorschauText = (b: Betroffen, personen: Person[]) => {
  const namen = b.fahrerIds.map((id) => personen.find((p) => p.id === id)?.name).filter(Boolean);
  if (namen.length < VORSCHAU_AB) return '';
  return `Betroffen sind ${namen.length} Fahrer: ${namen.join(', ')}. Bitte prüfe die Liste und bestätige ausdrücklich mit „ja“.`;
};
