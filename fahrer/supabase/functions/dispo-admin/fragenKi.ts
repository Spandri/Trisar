// Feste Antworten des KI-Assistenten ohne Modell, aus den Tabellen gerechnet:
//   Dienst und Pausen: "Hat Stefano morgen eine Pause eingetragen?", "Wann faengt Tim morgen an?", "Wann hat Anna Feierabend?"
//   Stundenzettel:     "Wie viele Stunden hat Tim diese Woche?", "Wer hat seinen Stundenzettel noch nicht abgegeben?",
//                      "Welche Stundenzettel sind noch offen?"
// Dazu gespraechsFahrer: der Fahrer, um den es gerade ging ("Dann schick Dienststart fuer 9 Uhr").

// deno-lint-ignore-file no-explicit-any
import { alleFahrer, datumAusText, genannteFahrer, jetztBerlin, normal, plusTage, tagLesbar } from './dienst.ts';

type Fahrer = { id: string; name: string };
const FRIST_MS = 20 * 60 * 1000;

// Fahrer aus dem Gespraech: einer, oder mehrere, wenn "alle/die/ihnen" sie meint. Sonst keiner.
export const gespraechsFahrer = async (admin: any, kontext: any, text: string): Promise<Fahrer[]> => {
  const ids: string[] = Array.isArray(kontext?.letzteFahrer) ? kontext.letzteFahrer.map(String) : [];
  if (!ids.length || Date.now() - Number(kontext?.updatedAt || 0) > FRIST_MS) return [];
  const mehrere = /\b(alle|allen|ihnen|denen|die beiden|beide|die drei)\b/.test(normal(text));
  if (ids.length > 1 && !mehrere) return [];
  const { data } = await admin.from('profiles').select('id, first_name, last_name').in('id', ids.slice(0, 20));
  return (Array.isArray(data) ? data : []).map((p: any) => ({ id: String(p.id), name: [p.first_name, p.last_name].filter(Boolean).join(' ') }));
};

const hm = (t: unknown) => (t ? String(t).slice(0, 5) : '');
const uhrIso = (iso: string) => new Date(iso).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' });
const dauer = (min: number) => `${Math.floor(min / 60)}:${String(Math.round(min % 60)).padStart(2, '0')} h`;
const FRAGE_START = /^\s*(hat|haben|wann|welche\w*|wie|gibt|ist|sind|wer|zeig\w*|nenn\w*|liste\w*)\b/;

// ---- Dienst und Pausen -------------------------------------------------------------------------------

const dienstLaden = async (admin: any, ids: string[], datum: string) => {
  const { data } = await admin.from('driver_service_requests')
    .select('id, driver_id, service_date, service_start_time, service_end_time, status, created_at')
    .in('driver_id', ids).eq('service_date', datum);
  const neueste = new Map<string, any>();
  for (const d of (Array.isArray(data) ? data : []).filter((x: any) => ['pending', 'accepted'].includes(String(x.status)))) {
    const alt = neueste.get(d.driver_id);
    if (!alt || String(d.created_at) > String(alt.created_at)) neueste.set(d.driver_id, d);
  }
  const dienstIds = [...neueste.values()].map((d) => d.id);
  const { data: p } = dienstIds.length ? await admin.from('dienst_pausen').select('dienst_id, pausen').in('dienst_id', dienstIds) : { data: [] };
  const pausen = new Map<string, any[]>((Array.isArray(p) ? p : []).map((r: any) => [String(r.dienst_id), Array.isArray(r.pausen) ? r.pausen : []]));
  return { neueste, pausen };
};

const pausenText = (liste: any[]) => liste
  .map((x) => `${hm(x?.von)}${x?.bis ? `–${hm(x.bis)}` : ''}`)
  .filter((t) => t && t !== '–').join(', ');

export const dienstFrage = async (admin: any, frage: string, kontext: any): Promise<string | null> => {
  const text = normal(frage);
  const istFrage = FRAGE_START.test(text) || /\?\s*$/.test(frage);
  if (!istFrage) return null;
  const pause = /\bpause/.test(text);
  const anfang = /\b(faengt|fangt|beginnt|anfang\w*|dienstbeginn|dienststart|startet)\b/.test(text);
  const ende = /\b(feierabend|hoert|hort|dienstende|endet|schluss)\b/.test(text);
  // "Hat Anna morgen Dienst?", "Arbeitet Tim heute?": ganzer Dienst des Tages.
  // "Hat Stefano die Dienstzeit angenommen?" (ki_protokoll 13.11.) zaehlt mit.
  const allgemein = /\b(dienst\w*|schicht\w*|arbeitet|arbeiten)\b/.test(text);
  if (!pause && !anfang && !ende && !allgemein) return null;
  if (/\bfahrt\b/.test(text)) return null;
  const genannt = await genannteFahrer(admin, text);
  // "Ist Joris noch im Dienst?", "Ist gerade irgendein Fahrer im Dienst?": Ja oder Nein bezogen auf jetzt.
  const jetztFrage = /\b(noch|gerade|jetzt|aktuell|momentan|zurzeit|derzeit)\b/.test(text)
    && /\b(im dienst|dienst|arbeitet|arbeiten|unterwegs|aktiv)\b/.test(text)
    && !/\b(morgen|uebermorgen|gestern|montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag)\b/.test(text)
    && !pause && !anfang && !ende;
  if (jetztFrage) {
    const irgendwer = !genannt.length && /\b(wer|irgend\w*|jemand|einer|fahrer|alle|welche\w*|niemand|keiner)\b/.test(text);
    const liste = genannt.length ? genannt : irgendwer ? await alleFahrer(admin) : await gespraechsFahrer(admin, kontext, text);
    if (liste.length) return await jetztImDienst(admin, liste, genannt.length > 0 || !irgendwer, /^\s*wer\b/.test(text));
  }
  // "Wer hat morgen Dienst?": alle Fahrer, nur die mit Dienst nennen. "Wer ist gerade im Dienst" beantwortet kiKern.
  const werAlle = !genannt.length && /^\s*wer\b/.test(text) && !/\b(gerade|jetzt|aktuell|momentan)\b/.test(text);
  const fahrer = genannt.length ? genannt : werAlle ? await alleFahrer(admin) : await gespraechsFahrer(admin, kontext, text);
  if (!fahrer.length) return null;
  const { datum: heute } = jetztBerlin();
  const datum = datumAusText(text, heute);
  const tag = tagLesbar(datum, heute);
  const { neueste, pausen } = await dienstLaden(admin, fahrer.map((f) => f.id), datum);
  if (werAlle) {
    const mit = fahrer.filter((f) => neueste.get(f.id));
    if (!mit.length) return `${tag.replace(/^./, (c) => c.toUpperCase())} hat niemand Dienst eingetragen.`;
    return `${tag.replace(/^./, (c) => c.toUpperCase())} Dienst (${mit.length}):\n${mit.map((f) => {
      const d = neueste.get(f.id);
      const p = pausenText(pausen.get(String(d.id)) || []);
      return `- ${f.name}: ${hm(d.service_start_time) || '?'}–${hm(d.service_end_time) || 'offen'}${p ? `, Pause ${p}` : ''}${String(d.status) === 'accepted' ? '' : ' (noch nicht bestätigt)'}`;
    }).join('\n')}`;
  }
  return fahrer.map((f) => {
    const d = neueste.get(f.id);
    if (!d) return `${f.name} hat ${tag} keinen Dienst eingetragen.`;
    const offen = String(d.status) === 'accepted' ? '' : ' (noch nicht bestätigt)';
    const start = hm(d.service_start_time);
    const end = hm(d.service_end_time);
    const p = pausenText(pausen.get(String(d.id)) || []);
    if (pause) {
      return p ? `${f.name} hat ${tag} Pause ${p}${offen}. Dienst ${start || '?'}–${end || 'offen'}.`
        : `${f.name} hat ${tag} keine Pause eingetragen. Dienst ${start || '?'}–${end || 'offen'}${offen}.`;
    }
    if (anfang && !ende) return start ? `${f.name} fängt ${tag} um ${start} an${offen}.` : `${f.name} hat ${tag} noch keinen Dienststart eingetragen.`;
    if (ende && !anfang) return end ? `${f.name} hat ${tag} um ${end} Feierabend${offen}.` : `${f.name} hat ${tag} noch kein Dienstende eingetragen${start ? ` (Start ${start})` : ''}.`;
    return `${f.name} hat ${tag} Dienst ${start || '?'}–${end || 'offen'}${p ? `, Pause ${p}` : ''}${offen}.`;
  }).join('\n');
};

// Wo steht ein Fahrer gerade? Dienst von heute (und ein Nachtdienst von gestern, der ueber Mitternacht geht).
const zuMin = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const jetztImDienst = async (admin: any, fahrer: Fahrer[], einzeln: boolean, werFrage = false) => {
  const { datum: heute, minuten: jetzt } = jetztBerlin();
  const ids = fahrer.map((f) => f.id);
  const [h, g] = await Promise.all([dienstLaden(admin, ids, heute), dienstLaden(admin, ids, plusTage(heute, -1))]);
  const stand = fahrer.map((f) => {
    const gestern = g.neueste.get(f.id);
    // Nachtdienst von gestern, der erst heute endet (Ende vor Start).
    if (gestern?.service_start_time && gestern?.service_end_time) {
      const s = zuMin(hm(gestern.service_start_time));
      const e = zuMin(hm(gestern.service_end_time));
      if (e < s && jetzt < e) return { f, im: true, text: `Ja, ${f.name} ist seit gestern ${hm(gestern.service_start_time)} im Dienst, Dienstende ${hm(gestern.service_end_time)}.`, ende: hm(gestern.service_end_time) };
    }
    const d = h.neueste.get(f.id);
    // Datumsgrenze: Dienst von gestern ohne Ende laeuft ueber Mitternacht weiter, solange heute keiner eingetragen ist.
    if (!d && gestern?.service_start_time && !gestern?.service_end_time) {
      const offenG = String(gestern.status) === 'accepted' ? '' : ' (Dienst noch nicht bestätigt)';
      return { f, im: true, text: `Ja, ${f.name} ist seit gestern ${hm(gestern.service_start_time)} im Dienst, noch ohne Dienstende${offenG}.` };
    }
    if (!d || !d.service_start_time) return { f, im: false, text: `Nein, ${f.name} hat heute keinen Dienst eingetragen.` };
    const start = hm(d.service_start_time);
    const end = hm(d.service_end_time);
    const s = zuMin(start);
    const e = end ? zuMin(end) : null;
    const uebernacht = e !== null && e < s;
    if (jetzt < s) return { f, im: false, text: `Nein, ${f.name} fängt heute erst um ${start} an.` };
    if (e !== null && !uebernacht && jetzt >= e) return { f, im: false, text: `Nein, ${f.name} hat seit ${end} Dienstende.`, warEnde: end };
    const offen = String(d.status) === 'accepted' ? '' : ' (Dienst noch nicht bestätigt)';
    const pause = (h.pausen.get(String(d.id)) || []).find((p: any) => p?.von && p?.bis && zuMin(hm(p.von)) <= jetzt && jetzt < zuMin(hm(p.bis)));
    if (pause) return { f, im: true, text: `Ja, ${f.name} ist im Dienst, gerade Pause bis ${hm(pause.bis)}${offen}.`, ende: end };
    return { f, im: true, text: `Ja, ${f.name} ist seit ${start} im Dienst, ${end ? `Dienstende ${end}` : 'noch ohne Dienstende'}${offen}.`, ende: end };
  });
  if (einzeln) return stand.map((x) => x.text).join('\n');
  const im = stand.filter((x) => x.im);
  if (!im.length) {
    const letzte = stand.filter((x: any) => x.warEnde).sort((a: any, b: any) => b.warEnde.localeCompare(a.warEnde))[0] as any;
    return `${werFrage ? 'Gerade' : 'Nein, gerade'} ist niemand im Dienst.${letzte ? ` Zuletzt hatte ${letzte.f.name} um ${letzte.warEnde} Dienstende.` : ''}`;
  }
  return `${werFrage ? 'Gerade' : 'Ja, gerade'} im Dienst (${im.length}):\n${im.map((x: any) => `- ${x.f.name}${x.ende ? ` bis ${x.ende}` : ', noch ohne Dienstende'}`).join('\n')}`;
};

// ---- Stundenzettel -----------------------------------------------------------------------------------

const MONATE = ['januar', 'februar', 'maerz', 'april', 'mai', 'juni', 'juli', 'august', 'september', 'oktober', 'november', 'dezember'];

// Zeitraum aus der Frage: heute, gestern, diese/letzte Woche, dieser/letzter Monat, im <Monat>. Standard: diese Woche.
const zeitraum = (text: string, heute: string) => {
  const wochentag = (new Date(`${heute}T12:00:00Z`).getUTCDay() + 6) % 7; // Mo = 0
  const montag = plusTage(heute, -wochentag);
  if (/\bgestern\b/.test(text)) return { von: plusTage(heute, -1), bis: plusTage(heute, -1), name: 'gestern' };
  if (/\bheute\b/.test(text)) return { von: heute, bis: heute, name: 'heute' };
  if (/\b(letzte|vorige|vergangene)\w*\s+woche\b/.test(text)) return { von: plusTage(montag, -7), bis: plusTage(montag, -1), name: 'letzte Woche' };
  const monatIdx = MONATE.findIndex((m) => new RegExp(`\\b${m}\\b`).test(text));
  const jahr = Number(heute.slice(0, 4));
  const monatBereich = (j: number, m: number) => {
    const von = `${j}-${String(m + 1).padStart(2, '0')}-01`;
    const naechster = m === 11 ? `${j + 1}-01-01` : `${j}-${String(m + 2).padStart(2, '0')}-01`;
    return { von, bis: plusTage(naechster, -1) };
  };
  if (monatIdx >= 0) {
    const j = monatIdx > Number(heute.slice(5, 7)) - 1 ? jahr - 1 : jahr;
    return { ...monatBereich(j, monatIdx), name: `im ${MONATE[monatIdx].replace('ae', 'ä').replace(/^./, (c) => c.toUpperCase())}` };
  }
  const m = Number(heute.slice(5, 7)) - 1;
  if (/\b(letzte|vorige|vergangene)\w*\s+monat\b/.test(text)) return { ...monatBereich(m === 0 ? jahr - 1 : jahr, (m + 11) % 12), name: 'letzten Monat' };
  if (/\bmonat\b/.test(text)) return { ...monatBereich(jahr, m), name: 'diesen Monat' };
  return { von: montag, bis: heute, name: 'diese Woche' };
};

export const stundenFrage = async (admin: any, frage: string, kontext: any): Promise<string | null> => {
  const text = normal(frage);
  if (!/\b(stunden\w*|stundenzettel\w*|zettel)\b/.test(text)) return null;
  if (/\b(stundenlohn|lohn|euro)\b/.test(text)) return null;
  const istFrage = FRAGE_START.test(text) || /\?\s*$/.test(frage);
  if (!istFrage) return null;
  const { datum: heute } = jetztBerlin();

  // "Wer hat seinen Stundenzettel noch nicht abgegeben?": Dienst bestaetigt, vorbei, kein Zettel.
  if (/\bnicht\b.*\b(abgegeben|eingereicht|ausgefuellt|erfasst|gemacht|geschickt)\b|\bfehl\w*\b/.test(text)) {
    const r = /\b(heute|gestern|woche|monat)\b/.test(text) || MONATE.some((m) => text.includes(m)) ? zeitraum(text, heute) : { von: plusTage(heute, -7), bis: heute, name: 'in den letzten 7 Tagen' };
    const { data: dienste } = await admin.from('driver_service_requests')
      .select('id, driver_id, service_date, service_end_time, status').eq('status', 'accepted').gte('service_date', r.von).lte('service_date', r.bis);
    const liste = (Array.isArray(dienste) ? dienste : []).filter((d: any) => d.service_date < heute || (d.service_end_time && hm(d.service_end_time) <= uhrIso(new Date().toISOString())));
    if (!liste.length) return `Keine abgeschlossenen Dienste ${r.name}.`;
    const { data: zettel } = await admin.from('stundenzettel').select('dienst_id, driver_id, datum').gte('datum', r.von).lte('datum', r.bis);
    const hat = new Set((Array.isArray(zettel) ? zettel : []).map((z: any) => `${z.driver_id}|${z.datum}`));
    const fehlend = liste.filter((d: any) => !hat.has(`${d.driver_id}|${d.service_date}`));
    if (!fehlend.length) return `Alle Stundenzettel ${r.name} sind abgegeben.`;
    const { data: p } = await admin.from('profiles').select('id, first_name, last_name').in('id', [...new Set(fehlend.map((d: any) => d.driver_id))]);
    const name = new Map((Array.isArray(p) ? p : []).map((x: any) => [x.id, [x.first_name, x.last_name].filter(Boolean).join(' ')]));
    const zeilen = fehlend.sort((a: any, b: any) => String(a.service_date).localeCompare(String(b.service_date)))
      .map((d: any) => `- ${name.get(d.driver_id) || 'Fahrer'}: ${tagLesbar(d.service_date, heute)}`);
    return `Noch kein Stundenzettel ${r.name} (${fehlend.length}):\n${zeilen.join('\n')}`;
  }

  // "Welche Stundenzettel sind noch offen / nicht bestaetigt?"
  if (/\b(offen|bestaetig\w*|pruef\w*|freigeben|freigabe)\b/.test(text) && !/\bwie viele stunden\b/.test(text)) {
    const { data } = await admin.from('stundenzettel').select('driver_id, datum, arbeits_min, angepasst').eq('status', 'eingereicht').order('datum').limit(50);
    const liste = Array.isArray(data) ? data : [];
    if (!liste.length) return 'Keine offenen Stundenzettel, alle sind bestätigt.';
    const { data: p } = await admin.from('profiles').select('id, first_name, last_name').in('id', [...new Set(liste.map((z: any) => z.driver_id))]);
    const name = new Map((Array.isArray(p) ? p : []).map((x: any) => [x.id, [x.first_name, x.last_name].filter(Boolean).join(' ')]));
    return `Noch nicht bestätigt (${liste.length}):\n${liste.map((z: any) => `- ${name.get(z.driver_id) || 'Fahrer'}: ${tagLesbar(z.datum, heute)}, ${dauer(Number(z.arbeits_min) || 0)}${z.angepasst ? ', vom Fahrer angepasst' : ''}`).join('\n')}`;
  }

  // "Wie viele Stunden hat Tim diese Woche?" (ein Fahrer oder alle)
  if (!/\b(wie viele|wieviel|wie viel|stunden hat|stunden haben|arbeitszeit|gearbeitet)\b/.test(text)) return null;
  const r = zeitraum(text, heute);
  const genannt = await genannteFahrer(admin, text);
  const fahrer = genannt.length ? genannt : await gespraechsFahrer(admin, kontext, text);
  let abfrage = admin.from('stundenzettel').select('driver_id, datum, arbeits_min, status').gte('datum', r.von).lte('datum', r.bis);
  if (fahrer.length) abfrage = abfrage.in('driver_id', fahrer.map((f) => f.id));
  const { data } = await abfrage;
  const zettel = (Array.isArray(data) ? data : []).filter((z: any) => z.status !== 'zurueckgewiesen');
  const summe = new Map<string, { min: number; tage: number; offen: number }>();
  for (const z of zettel) {
    const s = summe.get(z.driver_id) || { min: 0, tage: 0, offen: 0 };
    s.min += Number(z.arbeits_min) || 0;
    s.tage += 1;
    if (z.status === 'eingereicht') s.offen += 1;
    summe.set(z.driver_id, s);
  }
  const ids = fahrer.length ? fahrer.map((f) => f.id) : [...summe.keys()];
  if (!ids.length) return `${r.name.replace(/^./, (c) => c.toUpperCase())} gibt es keine Stundenzettel.`;
  const { data: p } = await admin.from('profiles').select('id, first_name, last_name').in('id', ids);
  const name = new Map((Array.isArray(p) ? p : []).map((x: any) => [x.id, [x.first_name, x.last_name].filter(Boolean).join(' ')]));
  const zeile = (id: string) => {
    const s = summe.get(id);
    if (!s) return `${name.get(id) || 'Fahrer'}: ${r.name} keine Stundenzettel.`;
    return `${name.get(id) || 'Fahrer'}: ${dauer(s.min)} an ${s.tage === 1 ? '1 Tag' : `${s.tage} Tagen`}${s.offen ? `, davon ${s.offen} noch nicht bestätigt` : ''}.`;
  };
  if (ids.length === 1) {
    const s = summe.get(ids[0]);
    const n = name.get(ids[0]) || 'Fahrer';
    if (!s) return `${n} hat ${r.name} keine Stundenzettel.`;
    return `${n} hat ${r.name} ${dauer(s.min)} an ${s.tage === 1 ? '1 Tag' : `${s.tage} Tagen`}${s.offen ? `, davon ${s.offen} noch nicht bestätigt` : ''}.`;
  }
  const gesamt = [...summe.values()].reduce((a, s) => a + s.min, 0);
  return `Stunden ${r.name} (aus Stundenzetteln), gesamt ${dauer(gesamt)}:\n${ids.sort((a, b) => (summe.get(b)?.min || 0) - (summe.get(a)?.min || 0)).map((id) => `- ${zeile(id)}`).join('\n')}`;
};
