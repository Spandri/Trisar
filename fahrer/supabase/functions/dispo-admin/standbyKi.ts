// Standby per KI-Assistent zusammen mit einer Fahrt:
//   "Buche Tim morgen vom Salzburg Flughafen zum Kongress, der Flug landet um 14:30, davor dort Standby ab 10:00 Uhr"
// Die Fahrt kommt wie immer als Karte (Buchen-Knopf). Dazu schlaegt der Assistent einen Standby vor:
// Ort = Abholort der Fahrt, Datum = Fahrtdatum, von = "ab ...", bis = "bis ..." oder die Abholzeit,
// Fahrer = Fahrer der Fahrt. Wie beim Stundenlohn (lohn.ts) wird erst nach "ja" gespeichert, die offene
// Rueckfrage reist im Kontext (offenerStandby), daher ohne neuen App-Build. Fehlt der Fahrer oder die
// Endzeit, fragt der Assistent danach.

// deno-lint-ignore-file no-explicit-any
import { geocode, tomtomSchluessel } from '../_shared/tomtom-routing.ts';

const FRIST_MS = 30 * 60 * 1000;
const DISPO_ROLLEN = new Set(['dispo', 'dispatcher', 'admin', 'koordinator', 'coordinator', 'pruefung']);

const normal = (text: string) => ` ${String(text || '').toLowerCase()
  .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
  .replace(/[^a-z0-9:.,\- ]+/g, ' ').replace(/\s+/g, ' ')} `;

const STANDBY_RE = /\bstand[\s-]?by\b/i;
const JA_RE = /^\s*(ja|jo|jap|japp|yes|ok|okay|okey|klar|genau|passt|stimmt|richtig|mach(s|e)?( das)?|machen|speicher(n|e)?|anleg\w*|leg (es|ihn) an|bestaetig(e|en|t)?|in ordnung|gerne|bitte|los)\b/;
const NEIN_RE = /^\s*(nein|ne|nee|nope|nicht|abbrechen|abbruch|stopp?|lass(e|en)? (es|das)|vergiss|verwerfen|doch nicht|kein standby|ohne standby)\b/;
const ZEIT = '(\\d{1,2})(?:[:.](\\d{2}))?\\s*(?:uhr|h)?';

const hm = (h: string, m?: string) => {
  const s = Number(h);
  const mi = Number(m || 0);
  if (!(s >= 0 && s <= 24 && mi >= 0 && mi < 60)) return '';
  return `${String(s % 24).padStart(2, '0')}:${String(mi).padStart(2, '0')}`;
};

export type StandbyTeil = { von: string; bis: string; rest: string };

// Standby-Teil aus der Frage: Zeiten "ab/von 10", "bis 14:30" rund um das Wort Standby. Der Rest geht
// ohne diese Zeiten an die Buchung, sonst nimmt die Buchung 10:00 als Abholzeit.
export const standbyTeil = (frage: string): StandbyTeil | null => {
  const roh = String(frage || '');
  const m = roh.match(STANDBY_RE);
  if (!m || m.index === undefined) return null;
  const beginn = Math.max(0, m.index - 45);
  const ende = Math.min(roh.length, m.index + m[0].length + 60);
  const fenster = roh.slice(beginn, ende);
  const vonM = fenster.match(new RegExp(`\\b(?:ab|von|seit)\\s+${ZEIT}`, 'i'));
  const bisM = fenster.match(new RegExp(`\\bbis\\s+(?:um\\s+)?${ZEIT}`, 'i'));
  const von = vonM ? hm(vonM[1], vonM[2]) : '';
  const bis = bisM ? hm(bisM[1], bisM[2]) : '';
  let teil = fenster;
  for (const t of [vonM?.[0], bisM?.[0]]) if (t) teil = teil.replace(t, ' ');
  teil = teil.replace(STANDBY_RE, ' ').replace(/\b(und\s+)?(davor|vorher|zuvor)\s+(dort|da|vor ort)?\b/gi, ' ');
  const rest = `${roh.slice(0, beginn)}${teil}${roh.slice(ende)}`.replace(/\s+/g, ' ').replace(/\s+([,.])/g, '$1').trim();
  return { von, bis, rest };
};

type Fahrer = { id: string; name: string };
type Ort = { id: string | null; name: string; adresse: string | null; lat: number; lng: number; rein: number; raus: number };
type Offen = { datum: string; von: string; bis: string; ort: Ort | null; ortText: string; fahrer: Fahrer[]; zeit: number };

const fahrerAlle = async (admin: any): Promise<(Fahrer & { nr: string; vor: string; nach: string })[]> => {
  const { data } = await admin.from('profiles').select('id, first_name, last_name, driver_number, role');
  return (Array.isArray(data) ? data : [])
    .filter((p: any) => !DISPO_ROLLEN.has(String(p?.role || '').toLowerCase()))
    .map((p: any) => ({
      id: String(p.id), name: [p.first_name, p.last_name].filter(Boolean).join(' ').trim(),
      nr: p.driver_number == null ? '' : String(p.driver_number), vor: normal(p.first_name).trim(), nach: normal(p.last_name).trim(),
    }));
};

// Fahrer aus Namen der Buchung ("Tim Schedler", "Fahrer #113") oder aus einer Antwort ("Tim", "Nummer 113").
const fahrerFinden = async (admin: any, namen: string[], text = ''): Promise<Fahrer[]> => {
  const alle = await fahrerAlle(admin);
  const gefunden = new Map<string, Fahrer>();
  for (const n of namen) {
    const nr = String(n).match(/#\s*(\d+)|\((\d+)\)/);
    const f = nr ? alle.find((a) => a.nr === (nr[1] || nr[2])) : alle.find((a) => normal(a.name).trim() === normal(n).trim());
    if (f) gefunden.set(f.id, { id: f.id, name: f.name });
  }
  const t = normal(text);
  if (t.trim()) {
    const hat = (w: string) => w.length >= 2 && new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(t);
    for (const feld of ['vor', 'nach'] as const) {
      const zahl = new Map<string, number>();
      alle.forEach((a) => a[feld] && zahl.set(a[feld], (zahl.get(a[feld]) || 0) + 1));
      alle.forEach((a) => { if (a[feld] && zahl.get(a[feld]) === 1 && hat(a[feld])) gefunden.set(a.id, { id: a.id, name: a.name }); });
    }
    for (const m of t.matchAll(/\b(?:fahrer|nr|nummer)\s*(\d{1,4})\b/g)) {
      const f = alle.find((a) => a.nr === m[1]);
      if (f) gefunden.set(f.id, { id: f.id, name: f.name });
    }
  }
  return [...gefunden.values()];
};

// Ort der Abholung: eigener Ort mit Radius, sonst Adresse per TomTom (wie StandbyAdd.jsx: 150 rein, 300 raus).
const ortFinden = async (admin: any, text: string, ortId: string): Promise<Ort | null> => {
  if (ortId) {
    const { data: o } = await admin.from('orte').select('id, name, adresse, lat, lng, radius_rein_m, radius_raus_m').eq('id', ortId).maybeSingle();
    if (o && Number.isFinite(Number(o.lat)) && Number.isFinite(Number(o.lng))) {
      return { id: String(o.id), name: o.name, adresse: o.adresse ?? null, lat: Number(o.lat), lng: Number(o.lng),
        rein: Math.max(150, Number(o.radius_rein_m) || 0), raus: Math.max(300, Number(o.radius_raus_m) || 0) };
    }
  }
  if (!text.trim()) return null;
  const schluessel = await tomtomSchluessel(admin).catch(() => '');
  if (!schluessel) return null;
  const p = await geocode(admin, schluessel, text).catch(() => null);
  if (!p) return null;
  return { id: null, name: text.split(',')[0].trim(), adresse: text, lat: p.lat, lng: p.lon, rein: 150, raus: 300 };
};

const datumText = (iso: string) => {
  const [j, m, t] = iso.split('-');
  return j && m && t ? `${Number(t)}.${Number(m)}.` : iso;
};

const offenText = (o: Offen) => {
  const fehlt = [!o.ort && 'den Ort', !o.bis && 'bis wann', !o.fahrer.length && 'welcher Fahrer'].filter(Boolean);
  const kopf = `Dazu Standby: ${o.ort?.name || o.ortText || 'Ort offen'}, ${datumText(o.datum)} ${o.von}–${o.bis || '?'}`
    + `${o.fahrer.length ? `, ${o.fahrer.map((f) => f.name).join(', ')}` : ''}.`;
  if (fehlt.length) {
    const frage = !o.ort ? 'Den Ort habe ich nicht gefunden. Leg den Standby bitte in Fahrt hinzufügen an.'
      : `Für den Standby fehlt noch ${fehlt.join(' und ')}. Sag es mir, z. B. ${!o.bis ? '„bis 14:30“' : '„Tim“'}.`;
    return `${kopf}\n${frage}`;
  }
  return `${kopf}\nMit „ja“ lege ich den Standby an, die Fahrt buchst du wie immer über die Karte.`;
};

const ohneOffenen = (kontext: any) => {
  const k = { ...(kontext || {}) };
  delete k.offenerStandby;
  return k;
};

// Nach einer Buchung mit Standby-Teil: Vorschlag bauen. Liefert Text zum Anhaengen und den neuen Kontext.
export const standbyZurBuchung = async (admin: any, teil: StandbyTeil, proposal: any, kontext: any) => {
  if (!teil.von) {
    return { text: 'Ab wann soll der Standby sein? Sag z. B. „Standby ab 10 Uhr“.', kontext };
  }
  const o: Offen = {
    datum: String(proposal?.datum || ''),
    von: teil.von,
    bis: teil.bis || String(proposal?.startZeit || ''),
    ort: await ortFinden(admin, String(proposal?.startAdresse || proposal?.start || ''), String(proposal?.startOrtId || '')),
    ortText: String(proposal?.start || ''),
    fahrer: await fahrerFinden(admin, Array.isArray(proposal?.fahrerNamen) ? proposal.fahrerNamen : []),
    zeit: Date.now(),
  };
  if (o.bis && o.bis <= o.von) {
    return { text: `Der Standby ab ${o.von} endet vor dem Start (bis ${o.bis}). Sag mir die richtigen Zeiten, z. B. „Standby von 10 bis 14 Uhr“.`, kontext };
  }
  return { text: offenText(o), kontext: { ...ohneOffenen(kontext), offenerStandby: o } };
};

const speichern = async (admin: any, o: Offen, dispoId: string | null) => {
  const ort = o.ort as Ort;
  const { data, error } = await admin.from('standby').insert({
    datum: o.datum, von: o.von, bis: o.bis,
    ort_id: ort.id, ort_name: ort.name, adresse: ort.adresse, lat: ort.lat, lng: ort.lng,
    radius_rein_m: ort.rein, radius_raus_m: ort.raus,
    ...(dispoId ? { erstellt_von: dispoId } : {}),
  }).select('id').single();
  if (error || !data?.id) return `Der Standby wurde nicht gespeichert (${error?.message || 'unbekannt'}).`;
  const { error: f } = await admin.from('standby_fahrer').insert(o.fahrer.map((x) => ({ standby_id: data.id, driver_id: x.id })));
  if (f) {
    await admin.from('standby').delete().eq('id', data.id);
    return `Der Standby wurde nicht gespeichert (${f.message}).`;
  }
  return `Standby angelegt: ${ort.name}, ${datumText(o.datum)} ${o.von}–${o.bis}. ${o.fahrer.map((x) => x.name).join(', ')} ${o.fahrer.length === 1 ? 'bekommt' : 'bekommen'} die Anfrage.`;
};

// Antwort auf einen offenen Standby-Vorschlag: ja, nein, Fahrer oder Endzeit nachreichen.
export const standbyAntwort = async (admin: any, frage: string, kontext: any, dispoId: string | null) => {
  const o: Offen | undefined = kontext?.offenerStandby;
  if (!o || Date.now() - Number(o.zeit || 0) > FRIST_MS || !o.datum || !o.von) return null;
  const roh = String(frage || '').trim();
  const text = normal(roh);
  // Neue Auftraege ("Buche Tim morgen ...") gehen an die Buchung, nicht in den Standby.
  if (roh.length > 80 || /\b(buch\w*|fahrt\w*|aender\w*|verschieb\w*|storn\w*)\b/.test(text)) return null;
  if (NEIN_RE.test(text)) return { answer: 'Okay, kein Standby angelegt.', kontext: ohneOffenen(kontext) };
  const komplett = o.ort && o.bis && o.fahrer.length;
  if (JA_RE.test(text) && !/\?/.test(roh)) {
    if (!komplett) return { answer: offenText(o).replace(/^Dazu /, ''), kontext };
    return { answer: await speichern(admin, o, dispoId), kontext: ohneOffenen(kontext) };
  }
  // Nachtrag: Endzeit oder Fahrer.
  const neu: Offen = { ...o, zeit: Date.now() };
  let geaendert = false;
  const bisM = roh.match(new RegExp(`\\bbis\\s+(?:um\\s+)?${ZEIT}`, 'i'));
  const vonM = roh.match(new RegExp(`\\b(?:ab|von)\\s+${ZEIT}`, 'i'));
  if (bisM) { neu.bis = hm(bisM[1], bisM[2]); geaendert = true; }
  if (vonM) { neu.von = hm(vonM[1], vonM[2]); geaendert = true; }
  const fahrer = await fahrerFinden(admin, [], roh);
  if (fahrer.length) { neu.fahrer = fahrer; geaendert = true; }
  if (!geaendert) return null;
  if (neu.bis && neu.bis <= neu.von) return { answer: `Bis ${neu.bis} liegt vor ${neu.von}. Sag mir eine spätere Endzeit.`, kontext: { ...kontext, offenerStandby: o } };
  return { answer: offenText(neu).replace(/^Dazu /, ''), kontext: { ...ohneOffenen(kontext), offenerStandby: neu } };
};

// ---- Standby als eigene Karte (Apps mit karten: true) -------------------------------------------------
// Die App zeigt die Karte mit Buchen und Bearbeiten (Standby-Formular vorausgefuellt) und speichert selbst
// wie in "Fahrt hinzufuegen". fehlt nennt, was die Karte noch braucht (dann nur Bearbeiten).
export type StandbyKarte = {
  datum: string; von: string; bis: string;
  ortName: string; ortId: string; adresse: string; lat: number | null; lng: number | null; radiusRein: number; radiusRaus: number;
  fahrerNamen: string[]; fahrerIds: string[]; notiz: string; fehlt: string[];
};

export const standbyKarte = async (admin: any, wunsch: { von: string; bis: string }, proposal: any): Promise<StandbyKarte> => {
  const ortText = String(proposal?.startAdresse || proposal?.start || '');
  const ort = await ortFinden(admin, ortText, String(proposal?.startOrtId || ''));
  const fahrer = await fahrerFinden(admin, Array.isArray(proposal?.fahrerNamen) ? proposal.fahrerNamen : []);
  const bis = wunsch.bis || String(proposal?.startZeit || '');
  const k: StandbyKarte = {
    datum: String(proposal?.datum || ''),
    von: wunsch.von,
    bis,
    ortName: ort?.name || String(proposal?.start || '').split(',')[0].trim(),
    ortId: ort?.id || '',
    adresse: ort?.adresse || ortText,
    lat: ort ? ort.lat : null,
    lng: ort ? ort.lng : null,
    radiusRein: ort?.rein || 150,
    radiusRaus: ort?.raus || 300,
    fahrerNamen: fahrer.map((f) => f.name),
    fahrerIds: fahrer.map((f) => f.id),
    notiz: '',
    fehlt: [],
  };
  if (!k.von) k.fehlt.push('von');
  if (!k.bis) k.fehlt.push('bis');
  if (k.von && k.bis && k.bis <= k.von) k.fehlt.push('zeiten');
  if (k.lat == null) k.fehlt.push('ort');
  if (!k.fahrerIds.length) k.fehlt.push('fahrer');
  return k;
};

const FEHLT_TEXT: Record<string, string> = {
  von: 'die Startzeit', bis: 'die Endzeit', zeiten: 'eine Endzeit nach der Startzeit', ort: 'ein gefundener Ort', fahrer: 'ein Fahrer',
};

export const standbyKartenText = (k: StandbyKarte) => {
  const kopf = `Dazu Standby: ${k.ortName}, ${datumText(k.datum)} ${k.von || '?'}–${k.bis || '?'}`
    + `${k.fahrerNamen.length ? `, ${k.fahrerNamen.join(', ')}` : ''}.`;
  if (!k.fehlt.length) return `${kopf} Bestätige ihn auf seiner Karte.`;
  return `${kopf} Es fehlt noch ${k.fehlt.map((f) => FEHLT_TEXT[f] || f).join(' und ')}. Ergänze das über Bearbeiten auf der Karte.`;
};
