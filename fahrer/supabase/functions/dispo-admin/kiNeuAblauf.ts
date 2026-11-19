// Umbau KI-Assistent (18.11., reports/KI Assistent Umbau Plan.md): neuer Ablauf
// "Modell übersetzt, Code rechnet, Code prüft, Dispo bestätigt". Laeuft nur mit integration_settings
// ki_ablauf = 'neu' (Standard aus). Angeschlossen in ki.ts an zwei Stellen: vor den Regeln (neuVorbereiten)
// und danach (neuNachpruefen). Die Regeln bauen weiter die Karten, bekommen aber einen festen Befehl mit
// ausgerechnetem Datum, Uhrzeit und vollen Namen statt des Originalsatzes.
//
//   1. Modell uebersetzt  -> Formular wie geschrieben (kiNeuFormular.ts)
//   2. Code loest auf     -> Datum, Uhrzeit, Fahrer, Fahrt (kiNeuAufloesen.ts)
//   3. Code prueft        -> vor dem Befehl (hier) und am fertigen Vorschlag (kiNeuPruefen.ts)
//   4. Karte / Rueckfrage -> Dispo bestaetigt
//
// Kein stiller Rueckfall: Ist das Modell aus oder zu langsam, wird bei Auftraegen nichts geraten.

// deno-lint-ignore-file no-explicit-any
import { datumAufloesen, fahrerLaden, fahrtAufloesen, fahrtenLaden, imSatz, klein, namenAufloesen, type Person, zeitAufloesen } from './kiNeuAufloesen.ts';
import { felderNichtImSatz, FORMULAR_FUER, formularLesen, type Modell } from './kiNeuFormular.ts';
import { AUSNAHME_WORT, betroffenAus, type Erwartung, fahrerImSatz, FUERWORT_IM_SATZ, GRUND_TEXT, GRUPPE_WORT, loeschenGesagt, ohneNotizText, pruefen, stornoGesagt, unbekannteNamen, vorschauText } from './kiNeuPruefen.ts';
import { jetztBerlin, plusTage } from './dienst.ts';
import { standbyTeil } from './standbyKi.ts';

type Fahrer = { id: string; name: string };
export type NeuKontext = { verlauf: any[]; kontext: any; markiert: Fahrer[]; letzteFahrtId: string | null; offenerVorschlag: any; gespraech: () => Promise<Fahrer[]> };
export type NeuVorbereitet = {
  antwort?: { answer: string; regel: string };
  befehl?: string | null;
  nachricht?: { empfaenger: string[]; text: string } | null;
  markiert?: Fahrer[] | null;
  letzteFahrtId?: string | null;
  erwartung: Erwartung;
  formular?: any;
  ms?: number;
};

export const NICHT_VERFUEGBAR = 'Das Sprachmodell ist gerade nicht verfügbar. Aufträge führe ich deshalb nicht aus, damit nichts falsch gespeichert wird. Fragen beantworte ich weiter. Änderungen gehen solange über die normalen Formulare in der Dispo.';
const NICHTS = 'Ich habe nichts geändert.';

const SCHREIB_ABSICHTEN = new Set(['nachricht', 'fahrt_neu', 'fahrt_aendern', 'fahrt_stornieren', 'fahrt_erledigt', 'fahrt_kopieren', 'fahrt_notiz',
  'dienst', 'dienst_loeschen', 'standby', 'standby_aendern', 'fahrer_anlegen', 'fahrzeug_anlegen', 'loeschen', 'zuordnen', 'bearbeiten', 'tracker', 'gast', 'ort', 'stunden', 'lohn', 'rueckgaengig']);
export const istAuftrag = (absicht: string | null) => !!absicht && SCHREIB_ABSICHTEN.has(absicht);

const de = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
const TAG_IM_SATZ = /\b(today|tonight|tomorrow|yesterday|heute|morgen|(ü|ue)bermorgen|gestern|vorgestern|montags?|dienstags?|mittwochs?|donnerstags?|freitags?|samstags?|sonntags?|woche|wochen|tagen)\b|\b[0-3]?\d\.[01]?\d\.|\b[0-3]?\d\.\s+(januar|februar|m(ä|ae)rz|april|mai|juni|juli|august|september|oktober|november|dezember)/i;
const ZEIT_IM_SATZ = /\d|\b(halb|viertel|dreiviertel|mittags?|mitternacht|jetzt|sofort)\b|\b(ein|eins|zwei|drei|vier|f(ü|ue)nf|sechs|sieben|acht|neun|zehn|elf|zw(ö|oe)lf)\s+uhr\b/i;

const leer = (x: unknown) => !String(x ?? '').trim();
const liste = (x: unknown): string[] => (Array.isArray(x) ? x : leer(x) ? [] : [x]).map((v) => String(v ?? '').trim()).filter(Boolean);
const rueck = (answer: string, regel: string, e: Erwartung): NeuVorbereitet => ({ antwort: { answer, regel }, erwartung: e });
const leereErwartung = (absicht: string): Erwartung => ({ absicht, fahrerIds: null, tage: null, zeiten: null, feierabend: false, fahrtId: null, loeschenErlaubt: false, stornoErlaubt: false });

// Fahrer aus fahrer_text und ausser_text: Gruppe minus Ausgenommene, nie geraten.
type Ziel = { fahrer: Person[]; alle: boolean; antwort?: string };
const zieleAufloesen = async (f: any, frage: string, personen: Person[], c: NeuKontext, feld = 'fahrer_text', pflicht = true): Promise<Ziel> => {
  const namen = namenAufloesen(liste(f?.[feld]), personen);
  const aus = namenAufloesen(liste(f?.ausser_text), personen);
  const nichtGefunden = [...namen.fehler, ...aus.fehler].filter((x) => x.art !== 'fuerwort');
  if (nichtGefunden.length) {
    const t = nichtGefunden.map((x) => (x.art === 'mehrdeutig'
      ? `„${x.text}“ passt auf mehrere Fahrer (${x.kandidaten.map((p) => p.name).join(', ')})`
      : `den Fahrer „${x.text}“ finde ich nicht`)).join(', ');
    return { fahrer: [], alle: false, antwort: `${t[0].toUpperCase()}${t.slice(1)}. Nenne bitte den Namen wie in der Fahrerliste. ${NICHTS}` };
  }
  // Name im Satz, den das Formular nicht hat ("Feierabend für Klaus" mit leerem fahrer_text).
  const fremd = unbekannteNamen(frage, personen).filter((n) => !liste(f?.gast_text).some((g) => klein(g).includes(klein(n))));
  if (fremd.length) return { fahrer: [], alle: false, antwort: `Den Fahrer „${fremd.join('“, „')}“ finde ich nicht. Nenne bitte den Namen wie in der Fahrerliste. ${NICHTS}` };
  const ausgenommen = new Set([...aus.personen.map((p) => p.id), ...(aus.markierte ? c.markiert.map((m) => m.id) : [])]);
  // Ausnahme-Sperre: Ausnahmewort im Satz, aber nichts ausgenommen gelesen, oder ausgenommen ohne Gruppe.
  if (AUSNAHME_WORT.test(frage) && GRUPPE_WORT.test(frage) && !ausgenommen.size) {
    return { fahrer: [], alle: false, antwort: `Bei „alle außer …“ bin ich nicht sicher, wer ausgenommen ist. Nenne die Fahrer bitte einzeln. ${NICHTS}` };
  }
  if (ausgenommen.size && !namen.alle && !namen.markierte) {
    return { fahrer: [], alle: false, antwort: `Ich bin nicht sicher, wer gemeint ist und wer ausgenommen. Nenne die Fahrer bitte einzeln. ${NICHTS}` };
  }
  let fahrer: Person[] = [];
  if (namen.alle) fahrer = personen;
  else if (namen.markierte) fahrer = personen.filter((p) => c.markiert.some((m) => m.id === p.id));
  fahrer = [...fahrer, ...namen.personen];
  if (!fahrer.length && !namen.alle) {
    // Kein Name: markierte Fahrer oder, bei einem Fuerwort, der Fahrer aus dem Gespraech.
    if (c.markiert.length) fahrer = personen.filter((p) => c.markiert.some((m) => m.id === p.id));
    else if (FUERWORT_IM_SATZ.test(frage) || namen.fehler.some((x) => x.art === 'fuerwort')) {
      const g = await c.gespraech();
      if (g.length) fahrer = personen.filter((p) => g.some((x) => x.id === p.id));
    }
  }
  fahrer = [...new Map(fahrer.filter((p) => !ausgenommen.has(p.id)).map((p) => [p.id, p])).values()];
  if (!fahrer.length && pflicht) return { fahrer: [], alle: false, antwort: `Für welchen Fahrer? Nenne bitte den Namen. ${NICHTS}` };
  return { fahrer, alle: namen.alle && !ausgenommen.size };
};

const tagAufloesen = (text: string, frage: string, neu: boolean): { iso?: string; woche?: { von: string; bis: string }; antwort?: string } => {
  const j = jetztBerlin();
  if (leer(text)) {
    // Kein Tag gelesen: nur dann heute, wenn auch im Satz keiner steht. Sonst hat das Modell ihn uebersehen.
    if (TAG_IM_SATZ.test(frage)) return { antwort: `Welchen Tag meinst du genau? ${NICHTS}` };
    return { iso: j.datum };
  }
  const d = datumAufloesen(text, j, neu);
  // Gegenprobe am ganzen Satz: Ergibt er eindeutig einen anderen Tag, hat das Modell etwas weggelassen
  // ("letzten Freitag" als "Freitag" abgeschrieben). Dann nachfragen.
  const ganz = datumAufloesen(frage, j, neu);
  if ('iso' in d && 'iso' in ganz && ganz.iso !== d.iso) return { antwort: `Welchen Tag meinst du genau, ${de(ganz.iso)} oder ${de(d.iso)}? ${NICHTS}` };
  if ('iso' in d) return { iso: d.iso };
  if ('von' in d) return { woche: { von: d.von, bis: d.bis } };
  if (d.fehler === 'unmoeglich') return { antwort: `„${text}“ gibt es nicht im Kalender. ${NICHTS}` };
  if (d.fehler === 'widerspruch') return { antwort: `„${text}“ passt nicht zusammen. Welcher Tag ist gemeint? ${NICHTS}` };
  return { antwort: `„${text}“ verstehe ich nicht als Tag. Nenne den Tag bitte als Datum oder Wochentag. ${NICHTS}` };
};
type Uhr = { art: 'leer' } | { art: 'zeit'; hhmm: string } | { art: 'spanne'; von: string; bis: string } | { art: 'fehler'; antwort: string };
const uhrAufloesen = (text: string): Uhr => {
  if (leer(text)) return { art: 'leer' };
  const z = zeitAufloesen(text, jetztBerlin());
  if ('hhmm' in z) return { art: 'zeit', hhmm: z.hhmm };
  if ('von' in z) return { art: 'spanne', von: z.von, bis: z.bis };
  return { art: 'fehler', antwort: `„${text}“ ist mir als Uhrzeit nicht genau genug. Nenne die Uhrzeit bitte genau, z. B. 7:45. ${NICHTS}` };
};

const namenText = (z: Ziel) => (z.alle ? 'für alle Fahrer' : z.fahrer.map((p) => p.name).join(' und '));
const alsFahrer = (z: Ziel): Fahrer[] => z.fahrer.map((p) => ({ id: p.id, name: p.name }));

// Namen im Formular auf die Woerter im Satz zurueckfuehren: Schreibt das Modell "Tim Schedler" und im Satz steht
// "Tim", gilt "Tim". Steht im Satz "Tim Boberschmidt", gilt genau das (und wird nicht gefunden), nie der volle
// Name aus der Liste. "markierte" ohne "markiert" im Satz, aber mit "alle", wird "alle".
const NICHT_NACHNAME = /^(soll|sollen|hat|ist|kommt|faehrt|fährt|heute|morgen|uebermorgen|übermorgen|bitte|und|oder|mit|von|vom|um|ab|bis|am|an|auf|in|für|fuer|bei|zum|zur|dienst\w*|feierabend|fahrt\w*|uhr|ein|eine|einen|den|die|der|das|dem|nicht|auch|schon|noch)$/i;
export const namenAufSatz = (f: any, frage: string) => {
  const woerter = frage.split(/[^\p{L}\p{N}-]+/u).filter(Boolean);
  const kurz = (wert: string): string => {
    if (imSatz(wert, frage)) return wert;
    if (/^markiert/i.test(wert) && !/markiert/i.test(frage) && GRUPPE_WORT.test(frage)) return 'alle';
    const teile = klein(wert).split(/\s+/).filter((w) => w.length >= 2);
    const i = woerter.findIndex((w) => teile.some((t) => klein(w) === t || klein(w) === `${t}s`));
    if (i < 0) return wert;
    const naechstes = woerter[i + 1] || '';
    const mitNachname = /^\p{Lu}/u.test(naechstes) && !NICHT_NACHNAME.test(naechstes) && !TAG_IM_SATZ.test(naechstes);
    return mitNachname ? `${woerter[i]} ${naechstes}` : woerter[i];
  };
  // "eine Stunde früher als Anna": Anna ist der Vergleich, nicht gemeint.
  const vergleich = [...frage.matchAll(/\bals\s+(\p{Lu}[\p{L}]+)/gu)].map((m) => klein(m[1]));
  for (const k of ['fahrer_text', 'ausser_text', 'empfaenger_text', 'neu_fahrer_text']) {
    if (Array.isArray(f?.[k]) && f[k].length > 1) f[k] = f[k].filter((v: unknown) => !vergleich.includes(klein(String(v ?? '')).split(/\s+/)[0]));
    if (Array.isArray(f?.[k])) f[k] = f[k].map((v: unknown) => kurz(String(v ?? '')));
    else if (typeof f?.[k] === 'string' && f[k].trim()) f[k] = kurz(f[k]);
  }
};

export const neuVorbereiten = async (admin: any, vm: Modell | null, absicht: string, frage: string, c: NeuKontext): Promise<NeuVorbereitet> => {
  const e = leereErwartung(absicht);
  const art = FORMULAR_FUER[absicht];
  if (!art) return { erwartung: e };
  // Eine Frage ("Kann Marvin die Fahrt um 18 Uhr übernehmen?") baut keinen Befehl. Geprueft wird das Ergebnis trotzdem.
  if (/\?\s*$/.test(frage)) return { erwartung: e };
  // Folgesatz zu einer offenen Buchung ("9 Uhr", "zur Messe"): die Buchung in kiKern fuehrt das Gespraech weiter,
  // geprueft wird danach trotzdem.
  if (absicht === 'fahrt_neu' && (c.offenerVorschlag || c.kontext?.offeneBuchung)) return { erwartung: e };
  const personen = await fahrerLaden(admin);
  // Fahrerliste nur bei neuen Fahrten (Fahrer und Gast trennen). Sonst schrieb das Modell volle Namen ab, die so
  // nicht im Satz stehen ("Tim" wurde "Tim Schedler").
  const fl = await formularLesen(vm, absicht, frage, 20000, absicht === 'fahrt_neu' ? personen.map((p) => p.name) : []);
  if ('fehler' in fl) {
    return rueck(fl.fehler === 'frist' ? `Das Sprachmodell hat gerade zu lange gebraucht. ${NICHTS} Sag es bitte gleich noch einmal.` : NICHT_VERFUEGBAR, `neuModell_${fl.fehler}`, e);
  }
  const f = fl.formular || {};
  // Steht ein Feld nicht im Satz, hat das Modell es erfunden. Bei Namen (Fahrer, Ausnahmen, Empfaenger, Gaeste) ist
  // das gefaehrlich, also Rueckfrage. Tag, Uhrzeit, Ort, Notiz werden verworfen und gelten als leer: Der Code nimmt
  // dann denselben Weg wie ohne Angabe (kein Tag im Satz heisst heute, keine Uhrzeit heisst nachfragen).
  // Mit Pflichtfeldern schrieb qwen sonst gern "heute" in datum_text (18.11.).
  const NAME_FELD = /^(fahrer_text|ausser_text|empfaenger_text|gast_text|neu_fahrer_text)$/;
  namenAufSatz(f, frage);
  const nichtImSatz = felderNichtImSatz(f, frage);
  const verworfen = nichtImSatz.filter((x) => !NAME_FELD.test(x.split(':')[0]));
  for (const x of verworfen) {
    const [k, ...wert] = x.split(':');
    const w = wert.join(':').trim();
    const leeren = (o: any) => { if (o && typeof o === 'object') for (const kk of Object.keys(o)) { if (kk === k && String(o[kk]).trim() === w) o[kk] = ''; else if (typeof o[kk] === 'object') leeren(o[kk]); } };
    leeren(f);
  }
  const fehlt = nichtImSatz.filter((x) => NAME_FELD.test(x.split(':')[0]));
  if (fehlt.length) return { ...rueck(`Ich bin nicht sicher, ob ich dich richtig verstanden habe. Sag es bitte noch einmal mit Namen, Tag und Uhrzeit. ${NICHTS}`, 'neuNichtImSatz', e), formular: { ...f, nicht_im_satz: fehlt }, ms: fl.ms };
  const fertig = (x: Partial<NeuVorbereitet>): NeuVorbereitet => ({ erwartung: e, formular: f, ms: fl.ms, ...x });

  if (absicht === 'dienst' || absicht === 'standby') {
    const z = await zieleAufloesen(f, frage, personen, c);
    if (z.antwort) return fertig({ antwort: { answer: z.antwort, regel: 'neuFahrer' } });
    e.fahrerIds = z.fahrer.map((p) => p.id);
    if (absicht === 'standby') {
      const t = tagAufloesen(f.datum_text, frage, true);
      if (t.antwort || !t.iso) return fertig({ antwort: { answer: t.antwort || `Welcher Tag? ${NICHTS}`, regel: 'neuTag' } });
      const u = uhrAufloesen(f.zeit_text);
      if (u.art === 'fehler') return fertig({ antwort: { answer: u.antwort, regel: 'neuZeit' } });
      if (u.art === 'leer') return fertig({ antwort: { answer: `Von wann bis wann soll der Standby gehen? ${NICHTS}`, regel: 'neuZeit' } });
      const [von, bis] = u.art === 'zeit' ? [u.hhmm, ''] : [u.von, u.bis];
      e.tage = [t.iso];
      e.zeiten = [von, bis].filter(Boolean);
      const ort = String(f.ort_text || '').trim();
      return fertig({ befehl: `Standby am ${de(t.iso)} ${von}${bis ? `-${bis}` : ''}${ort ? ` am ${ort}` : ''} für ${z.alle ? 'alle Fahrer' : namenText(z)}`, markiert: alsFahrer(z) });
    }
    const tage = (Array.isArray(f.tage) && f.tage.length ? f.tage : [{}]).slice(0, 14);
    const teile: string[] = [];
    e.tage = [];
    e.zeiten = [];
    for (const tag of tage) {
      const t = tagAufloesen(tag?.datum_text, frage, true);
      if (t.antwort) return fertig({ antwort: { answer: t.antwort, regel: 'neuTag' } });
      if (!t.iso) return fertig({ antwort: { answer: `Dienste für eine ganze Woche bitte je Tag nennen. ${NICHTS}`, regel: 'neuTag' } });
      const stuecke: string[] = [];
      const feierabend = /feierabend|heim|nach hause|schluss|^jetzt$|^sofort$/i.test(String(tag?.ende_text || '')) && !/\d/.test(String(tag?.ende_text || ''));
      for (const [feld, wort] of [['start_text', 'Dienststart'], ['pause_von_text', 'Pause'], ['ende_text', 'Dienstende'], ['zeit_text', 'um']] as const) {
        if (feld === 'ende_text' && feierabend) { stuecke.push('Feierabend'); e.feierabend = true; continue; }
        const u = uhrAufloesen(tag?.[feld]);
        if (u.art === 'fehler') return fertig({ antwort: { answer: u.antwort, regel: 'neuZeit' } });
        if (u.art === 'leer') continue;
        if (u.art === 'spanne') {
          // "von 8 bis 16" in einem Feld: Start und Ende.
          stuecke.push(feld === 'pause_von_text' ? `Pause ${u.von} bis ${u.bis}` : `Dienststart ${u.von} Dienstende ${u.bis}`);
          e.zeiten.push(u.von, u.bis);
          continue;
        }
        let s = `${wort} ${u.hhmm}`;
        if (feld === 'pause_von_text') {
          const b = uhrAufloesen(tag?.pause_bis_text);
          if (b.art === 'zeit') { s += ` bis ${b.hhmm}`; e.zeiten.push(b.hhmm); }
        }
        stuecke.push(s);
        e.zeiten.push(u.hhmm);
      }
      if (!stuecke.length) {
        // Uhrzeit im Satz, aber nicht gelesen: nicht raten, nicht die aktuelle Uhr nehmen.
        if (ZEIT_IM_SATZ.test(frage)) return fertig({ antwort: { answer: `Welche Uhrzeit meinst du genau, und ist es Start oder Ende? ${NICHTS}`, regel: 'neuZeit' } });
        if (/feierabend|heim|nach hause|schluss|dienstende/i.test(frage)) { stuecke.push('Feierabend'); e.feierabend = true; }
        else return fertig({ antwort: { answer: `Um wie viel Uhr? Zum Beispiel „Dienststart morgen 7:00“. ${NICHTS}`, regel: 'neuZeit' } });
      }
      e.tage.push(t.iso);
      teile.push(`am ${de(t.iso)} ${stuecke.join(' ')}`);
    }
    return fertig({ befehl: `${namenText(z)} ${teile.join(' und ')}`.replace(/^für alle Fahrer/, 'für alle Fahrer'), markiert: alsFahrer(z) });
  }

  if (absicht === 'dienst_loeschen') {
    const z = await zieleAufloesen(f, frage, personen, c);
    if (z.antwort) return fertig({ antwort: { answer: z.antwort, regel: 'neuFahrer' } });
    e.fahrerIds = z.fahrer.map((p) => p.id);
    e.loeschenErlaubt = true;
    // Ohne Loesch-Wort ("Anna ist morgen krank") nichts entfernen, sondern fragen.
    if (!/l(ö|oe)sch|entfern|streich|\bweg\b|raus|aufheb|absag|\bfrei\b|nicht\s+mehr/i.test(ohneNotizText(frage))) {
      return fertig({ antwort: { answer: `Soll ich dafür etwas löschen? Dann sag es bitte ausdrücklich, z. B. „Lösch den Dienst von ${z.fahrer[0]?.vor || 'Anna'} morgen“. ${NICHTS}`, regel: 'neuOhneLoeschwort' } });
    }
    const t = leer(f.datum_text) ? (TAG_IM_SATZ.test(frage) ? { antwort: `Welchen Tag meinst du genau? ${NICHTS}` } : { iso: '' }) : tagAufloesen(f.datum_text, frage, false);
    if ((t as any).antwort) return fertig({ antwort: { answer: (t as any).antwort, regel: 'neuTag' } });
    const was = ({ dienst: 'den Dienst', start: 'den Dienststart', ende: 'das Dienstende', pausen: 'die Pausen' } as Record<string, string>)[String(f.was)] || 'den Dienst';
    let wann = '';
    if ((t as any).iso) { wann = ` am ${de((t as any).iso)}`; e.tage = [(t as any).iso]; }
    else if ((t as any).woche) {
      const w = (t as any).woche;
      const j = jetztBerlin().datum;
      wann = w.von > j ? ' nächste Woche' : ' diese Woche';
      e.tage = Array.from({ length: 7 }, (_, i) => plusTage(w.von, i));
    }
    return fertig({ befehl: `Lösche ${was} von ${z.alle ? 'allen Fahrern' : namenText(z)}${wann}`, markiert: alsFahrer(z) });
  }

  if (absicht === 'nachricht') {
    const z = await zieleAufloesen(f, frage, personen, c, 'empfaenger_text', false);
    if (z.antwort) return fertig({ antwort: { answer: z.antwort, regel: 'neuFahrer' } });
    e.fahrerIds = z.fahrer.map((p) => p.id);
    return fertig({ befehl: null, nachricht: { empfaenger: z.alle ? ['alle'] : z.fahrer.map((p) => p.name), text: String(f.text || '').trim() } });
  }

  if (absicht === 'lohn') {
    const z = await zieleAufloesen(f, frage, personen, c);
    if (z.antwort) return fertig({ antwort: { answer: z.antwort, regel: 'neuFahrer' } });
    e.fahrerIds = z.fahrer.map((p) => p.id);
    // Mit Ausnahme die Fahrer einzeln nennen, sonst setzt die Lohn-Regel ihn fuer alle.
    const betrag = String(f.betrag_text || '').trim();
    const befehl = !z.alle && liste(f.ausser_text).length && betrag ? `Stundenlohn ${betrag} für ${namenText(z)}` : null;
    return fertig({ befehl, markiert: alsFahrer(z) });
  }

  if (absicht === 'fahrt_neu') {
    // Fahrer, den das Modell als Gast gelesen hat ("Tim Schedler morgen um 10 …"): eindeutiger Fahrername im
    // Gast-Feld ohne Fahrer-Feld wird Fahrer. Mit Herr/Frau davor bleibt es ein Gast.
    if (!liste(f.fahrer_text).length) {
      const alsFahrer = liste(f.gast_text).filter((g) => !/^(herrn?|frau|dr)\b/i.test(g) && namenAufloesen([g], personen).personen.length === 1);
      if (alsFahrer.length) { f.fahrer_text = alsFahrer; f.gast_text = liste(f.gast_text).filter((g) => !alsFahrer.includes(g)); }
    }
    const fahrerTexte = liste(f.fahrer_text);
    const z = fahrerTexte.length || liste(f.ausser_text).length ? await zieleAufloesen(f, frage, personen, c) : { fahrer: [] as Person[], alle: false } as Ziel;
    if (z.antwort) return fertig({ antwort: { answer: z.antwort, regel: 'neuFahrer' } });
    // Unbekannter Fahrer ohne fahrer_text ("mit Paul"): nicht still ohne Fahrer buchen.
    const fremd = unbekannteNamen(frage, personen).filter((n) => /\b(mit|fahrer)\s+/i.test(frage.slice(Math.max(0, frage.indexOf(n) - 8), frage.indexOf(n)))
      && !liste(f.gast_text).some((g) => klein(g).includes(klein(n))));
    if (fremd.length) return fertig({ antwort: { answer: `Den Fahrer „${fremd.join('“, „')}“ finde ich nicht. Nenne bitte den Namen wie in der Fahrerliste. ${NICHTS}`, regel: 'neuFahrer' } });
    e.fahrerIds = z.fahrer.map((p) => p.id);
    const t = tagAufloesen(f.datum_text, frage, true);
    if (t.antwort) return fertig({ antwort: { answer: t.antwort, regel: 'neuTag' } });
    if (!t.iso) return fertig({ antwort: { answer: `Welcher Tag? ${NICHTS}`, regel: 'neuTag' } });
    e.tage = [t.iso];
    // Standby-Zeit ("davor Standby ab 10:00") ist nicht die Abfahrt. Hat das Modell sie genommen, gilt die andere
    // Uhrzeit im Satz ("landet um 15:10").
    const sbZeit = standbyTeil(frage);
    let zeitText = String(f.zeit_text || '');
    if (sbZeit) {
      const gelesen = uhrAufloesen(zeitText);
      if (gelesen.art === 'zeit' && gelesen.hhmm === sbZeit.von) {
        const andere = sbZeit.rest.match(/\b(?:um|ab)\s+(\d{1,2}(?:[:.]\d{2})?)\s*(?:uhr)?/i);
        zeitText = andere ? andere[1] : '';
      }
    }
    const u = uhrAufloesen(zeitText);
    if (u.art === 'fehler') return fertig({ antwort: { answer: u.antwort, regel: 'neuZeit' } });
    let zeit = '';
    if (u.art === 'zeit') { zeit = ` um ${u.hhmm}`; e.zeiten = [u.hhmm]; }
    else if (u.art === 'spanne') { zeit = ` zwischen ${u.von} und ${u.bis}`; e.zeiten = [u.von, u.bis]; }
    else if (ZEIT_IM_SATZ.test(frage.replace(/\b\d{5}\b|\b\d+\s*(personen|gäste|gaeste|leute|autos)\b|\b(terminal|t)\s*\d\b|\b\d{1,3}\s*,|str(\.|aße|asse)\s*\d+/gi, ' ')) && !/\boffen\b|nicht\s+fest|unbestimmt/i.test(frage)) {
      return fertig({ antwort: { answer: `Um wie viel Uhr soll die Fahrt starten? ${NICHTS}`, regel: 'neuZeit' } });
    } else e.zeiten = [];
    const start = String(f.start_text || '').trim();
    const ziel = String(f.ziel_text || '').trim();
    const gast = liste(f.gast_text).map((g) => g.replace(/^Herrn\s/, 'Herr ')).join(' und ');
    const wer = z.alle ? 'mit allen Fahrern' : z.fahrer.length ? `Fahrer ${z.fahrer.map((p) => p.name).join(' und ')}` : '';
    const befehl = [`Neue Fahrt am ${de(t.iso)}${zeit}`, start ? `von ${start}` : '', ziel ? `nach ${ziel}` : '']
      .filter(Boolean).join(' ') + (gast ? `, Gast ${gast}` : '') + (wer ? `, ${wer}` : '');
    // Standby zur Fahrt ("davor dort Standby ab 10 Uhr") liest die Buchung aus dem Befehl (standbyKi.ts), also mitgeben.
    // Ebenso Flugnummer, Kindersitz und Personenzahl, die stehen nicht im Formular.
    const sb = standbyTeil(frage);
    const flug = frage.match(/\b([A-Z][A-Z0-9]|[0-9][A-Z])\s?(\d{2,4})\b/);
    const anzahl = frage.match(/\b(\d{1,2}|zwei|drei|vier|f(ü|ue)nf|sechs|sieben|acht|neun|zehn)\s+(personen|g(ä|ae)ste|leute|fahrg(ä|ae)ste)\b/i);
    const zusatz = [
      flug ? `Flug ${flug[1]}${flug[2]}` : '',
      /kindersitz/i.test(frage) ? 'mit Kindersitz' : '',
      anzahl ? `${anzahl[1]} ${anzahl[3]}` : '',
      sb ? `davor dort Standby ab ${sb.von}${sb.bis ? ` bis ${sb.bis}` : ''}` : '',
    ].filter(Boolean);
    return fertig({ befehl: [befehl, ...zusatz].join(', '), markiert: alsFahrer(z) });
  }

  // Vorhandene Fahrt: stornieren, erledigt, kopieren, Notiz, aendern.
  const j = jetztBerlin().datum;
  const fahrerZiel = liste(f.fahrer_text).length ? namenAufloesen(liste(f.fahrer_text), personen) : null;
  if (fahrerZiel?.fehler.some((x) => x.art !== 'fuerwort')) {
    const x = fahrerZiel.fehler[0];
    return fertig({ antwort: { answer: `${x.art === 'mehrdeutig' ? `„${x.text}“ passt auf mehrere Fahrer` : `Den Fahrer „${x.text}“ finde ich nicht`}. ${NICHTS}`, regel: 'neuFahrer' } });
  }
  const t = leer(f.datum_text) ? null : tagAufloesen(f.datum_text, frage, false);
  if (t?.antwort) return fertig({ antwort: { answer: t.antwort, regel: 'neuTag' } });
  const u = uhrAufloesen(f.zeit_text);
  if (u.art === 'fehler') return fertig({ antwort: { answer: u.antwort, regel: 'neuZeit' } });
  const fahrten = await fahrtenLaden(admin, t?.iso || plusTage(j, -1), t?.iso || plusTage(j, 60));
  let r = fahrtAufloesen(fahrten, {
    gast: String(f.gast_text || ''), fahrerIds: fahrerZiel?.personen.map((p) => p.id), datum: t?.iso || null,
    zeit: u.art === 'zeit' ? u.hhmm : null, ort: String(f.ort_text || ''), letzteFahrtId: c.letzteFahrtId,
  });
  // "Die 14 Uhr Fahrt soll Anna fahren": Anna ist der neue Fahrer, nicht das Erkennungsmerkmal.
  if ('fehler' in r && r.fehler === 'keine' && absicht === 'fahrt_aendern' && fahrerZiel?.personen.length && !liste(f.neu_fahrer_text).length) {
    const ohneFahrer = fahrtAufloesen(fahrten, { gast: String(f.gast_text || ''), datum: t?.iso || null, zeit: u.art === 'zeit' ? u.hhmm : null, ort: String(f.ort_text || ''), letzteFahrtId: c.letzteFahrtId });
    if ('fahrt' in ohneFahrer) { r = ohneFahrer; f.neu_fahrer_text = f.fahrer_text; f.fahrer_text = ''; }
  }
  if ('fehler' in r) {
    if (r.fehler === 'mehrere') {
      const zeile = (x: any) => `- ${x.datum === j ? 'heute' : de(x.datum).slice(0, 6)} ${x.zeit} ${x.von} → ${x.nach}${x.gaeste.length ? `, ${x.gaeste.join(', ')}` : ''}`;
      return fertig({ antwort: { answer: `Mehrere Fahrten passen:\n${r.liste.slice(0, 6).map(zeile).join('\n')}\nNenne noch Tag, Uhrzeit oder Gast. ${NICHTS}`, regel: 'neuFahrtMehrere' } });
    }
    return fertig({ antwort: { answer: r.fehler === 'keine' ? `Diese Fahrt finde ich nicht. ${NICHTS}` : `Welche Fahrt meinst du? Nenne Gast, Fahrer, Tag oder Uhrzeit. ${NICHTS}`, regel: 'neuFahrtKeine' } });
  }
  e.fahrtId = r.fahrt.id.toLowerCase();
  e.fahrerIds = [];
  if (absicht === 'fahrt_stornieren') {
    e.stornoErlaubt = true;
    if (!stornoGesagt(frage)) return fertig({ antwort: { answer: `Soll die Fahrt storniert werden? Dann sag es bitte ausdrücklich mit „stornieren“. ${NICHTS}`, regel: 'neuOhneStornowort' } });
    e.loeschenErlaubt = /endg(ü|ue)ltig|komplett/i.test(frage) && loeschenGesagt(frage);
    return fertig({ befehl: e.loeschenErlaubt ? 'Lösche die Fahrt endgültig' : 'Storniere die Fahrt', letzteFahrtId: r.fahrt.id });
  }
  if (absicht === 'fahrt_erledigt') return fertig({ befehl: 'Markiere die Fahrt als erledigt', letzteFahrtId: r.fahrt.id });
  if (absicht === 'fahrt_notiz') {
    // Text der Notiz woertlich aus dem Satz (hinter dem Doppelpunkt), sonst aus dem Formular.
    const i = frage.search(/(?<!\d):(?!\d)/);
    const text = i >= 0 ? frage.slice(i + 1).trim() : String(f.notiz_text || '').trim();
    if (!text) return fertig({ antwort: { answer: `Was soll in der Notiz stehen? ${NICHTS}`, regel: 'neuNotiz' } });
    return fertig({ befehl: `Notiz zu der Fahrt: ${text}`, letzteFahrtId: r.fahrt.id });
  }
  if (absicht === 'fahrt_kopieren') {
    const ziel = leer(f.neu_datum_text) ? null : tagAufloesen(f.neu_datum_text, frage, true);
    if (ziel?.antwort) return fertig({ antwort: { answer: ziel.antwort, regel: 'neuTag' } });
    if (ziel?.iso) e.tage = null;
    return fertig({ befehl: ziel?.iso ? `Kopiere die Fahrt auf den ${de(ziel.iso)}` : 'Kopiere die Fahrt', letzteFahrtId: r.fahrt.id });
  }
  // fahrt_aendern: Die Buchung in kiKern liest die Aenderung aus dem Satz, bezogen auf die aufgeloeste Fahrt.
  // Geprueft wird danach: dieselbe Fahrt, neue Zeit und neuer Fahrer wie gelesen.
  const neuZeit = uhrAufloesen(f.neu_zeit_text);
  if (neuZeit.art === 'fehler') return fertig({ antwort: { answer: neuZeit.antwort, regel: 'neuZeit' } });
  e.zeiten = neuZeit.art === 'zeit' ? [neuZeit.hhmm, r.fahrt.zeit] : null;
  if (liste(f.neu_fahrer_text).length) {
    const n = namenAufloesen(liste(f.neu_fahrer_text), personen);
    if (n.fehler.length) return fertig({ antwort: { answer: `Den Fahrer „${n.fehler[0].text}“ finde ich nicht. ${NICHTS}`, regel: 'neuFahrer' } });
    e.fahrerIds = [...n.personen.map((p) => p.id), ...(r.fahrt.fahrerId ? [r.fahrt.fahrerId] : [])];
  } else e.fahrerIds = r.fahrt.fahrerId ? [r.fahrt.fahrerId] : [];
  return fertig({ befehl: null, letzteFahrtId: r.fahrt.id });
};

// Am fertigen Ergebnis der Regeln: passt es zum Satz? Sonst Rueckfrage statt Vorschlag. Ab drei Betroffenen Liste.
export const neuNachpruefen = async (admin: any, treffer: any, e: Erwartung, frage: string, c: NeuKontext, kontextVorher: any) => {
  if (!treffer?.daten) return treffer;
  const personen = await fahrerLaden(admin);
  // Ohne Formular (andere Absicht): erlaubt ist, wer im Satz steht, markiert ist oder per Fuerwort gemeint ist.
  const erw: Erwartung = { ...e };
  if (!erw.fahrerIds) {
    const ids = new Set(fahrerImSatz(frage, personen).map((p) => p.id));
    if (GRUPPE_WORT.test(frage) && !AUSNAHME_WORT.test(frage)) personen.forEach((p) => ids.add(p.id));
    c.markiert.forEach((m) => ids.add(m.id));
    if (!ids.size && FUERWORT_IM_SATZ.test(frage)) (await c.gespraech()).forEach((g) => ids.add(g.id));
    erw.fahrerIds = [...ids];
    erw.loeschenErlaubt = erw.loeschenErlaubt || ['loeschen', 'dienst_loeschen', 'standby_aendern'].includes(e.absicht);
    erw.stornoErlaubt = erw.stornoErlaubt || e.absicht === 'fahrt_stornieren';
  }
  // Nur was dieser Schritt neu vorschlaegt zaehlt, nicht eine alte offene Rueckfrage im Kontext.
  const neuKontext = { ...(treffer.daten.kontext || {}) };
  for (const k of Object.keys(neuKontext)) {
    if (/^offene|^offener|^offenes/.test(k) && JSON.stringify({ ...(neuKontext[k] || {}), zeit: 0 }) === JSON.stringify({ ...(kontextVorher?.[k] || {}), zeit: 0 })) delete neuKontext[k];
  }
  const b = betroffenAus({ ...treffer.daten, kontext: neuKontext }, personen);
  const gruende = pruefen(b, erw, frage);
  if (gruende.length) {
    const kontext = { ...(treffer.daten.kontext || {}) };
    for (const k of Object.keys(kontext)) if (/^offene|^offener|^offenes/.test(k) && neuKontext[k]) delete kontext[k];
    return { status: 200, daten: {
      answer: `Das mache ich so nicht: ${gruende.map((g) => GRUND_TEXT[g] || g).join(', ')}. ${NICHTS} Sag es bitte noch einmal mit Namen, Tag und Uhrzeit.`,
      kontext, meta: { ...(treffer.daten.meta || {}), regel: 'neuPruefer', neu: { gruende, vorher: String(treffer.daten.answer || '').slice(0, 300) } },
    } };
  }
  const vorschau = b.anzahl >= 3 ? vorschauText(b, personen) : '';
  if (vorschau && !b.fahrerIds.every((id) => String(treffer.daten.answer || '').includes(personen.find((p) => p.id === id)?.name || '\u0000'))) {
    treffer.daten = { ...treffer.daten, answer: `${String(treffer.daten.answer || '').trim()}\n\n${vorschau}`, meta: { ...(treffer.daten.meta || {}), vorschau: true } };
  }
  return treffer;
};

// Kein stiller Rueckfall: Ohne Absicht vom Modell (aus, zu langsam) duerfen die Regeln Fragen beantworten,
// aber keinen Auftrag vorschlagen.
export const ohneModellNurFragen = (treffer: any, kontextVorher: any) => {
  if (!treffer?.daten) return treffer;
  const d = treffer.daten;
  const karten = [...(Array.isArray(d.aktionen) ? d.aktionen : []), ...(d.action ? [d.action] : [])].filter((a: any) => a?.type && a.type !== 'booking_needs_clarification');
  const neu = Object.keys(d.kontext || {}).filter((k) => /^offene|^offener|^offenes/.test(k) && d.kontext[k]
    && JSON.stringify({ ...d.kontext[k], zeit: 0 }) !== JSON.stringify({ ...(kontextVorher?.[k] || {}), zeit: 0 }));
  if (!karten.length && !neu.length) return treffer;
  const kontext = { ...(d.kontext || {}) };
  neu.forEach((k) => delete kontext[k]);
  return { status: 200, daten: { answer: NICHT_VERFUEGBAR, kontext, meta: { ...(d.meta || {}), regel: 'neuOhneModell' } } };
};
