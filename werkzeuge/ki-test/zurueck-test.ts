// Messung auf dem zurueckgehaltenen Topf (Phase 0 des Umbaus, reports/KI Assistent Umbau Plan.md).
// An diesen Saetzen wird nie entwickelt, nur gemessen. Saetze und Erwartungen: werkzeuge/ki-test/zurueck/*.json.
//
//   cd trisar && deno run -A werkzeuge/ki-test/zurueck-test.ts --ablauf=alt \
//     --verstehen=qwen2.5:14b --modell=qwen2.5:14b --ollama=http://100.121.170.114:11434
//   ... --ablauf=neu          neuer Ablauf (integration_settings ki_ablauf = neu)
//   ... --nur=protokoll       nur eine Datei aus zurueck/
//   ... --gruppe=K4           nur Gespraeche, deren Name so beginnt
//
// Bewertung je Satz: richtig, rueckfrage (Aktion erwartet, aber nichts vorgeschlagen), falsch, gefaehrlich.
// Gefaehrlich heisst: falscher Fahrer, falscher Tag, umgedrehte Ausnahme, Storno oder Loeschen das nicht gemeint war.
// Was ein Vorschlag bewirkt, wird gemessen statt geraten: Karten werden gelesen, offene Rueckfragen werden auf einer
// Kopie der Datenbank mit "ja" (danach "löschen") bestaetigt und die Aenderung an den Tabellen ausgewertet.
// Feste Uhr Mi 18.11.2026 11:00 (zurueck/uhr-fest.ts), sonst stimmen "morgen" und "übernächsten Freitag" nicht.

// deno-lint-ignore-file no-explicit-any
import './zurueck/uhr-fest.ts';
import { kiFrage, antwortArt } from '../../fahrer/supabase/functions/dispo-admin/ki.ts';
import { modellFreigeben } from '../../fahrer/supabase/functions/dispo-admin/verstehen.ts';
import { SpeicherDb } from './speicherDb.ts';
import { ID, testdaten } from './testdaten.ts';

// Erreichbarkeit (ki.ts prueft /api/version mit 3 s Frist und merkt sich ein Nein 60 s lang): Im ersten Lauf am
// 18.11. riss die Pruefung einmal, danach lief der ganze Rest in unter 60 s ohne Modell. Gemessen wird hier das
// Verstehen, nicht die Leitung. Darum antwortet /api/version im Test immer sofort mit ok. Fristen der
// eigentlichen Modellaufrufe bleiben echt.
const echtesFetch = globalThis.fetch;
globalThis.fetch = ((url: any, init?: any) => (/\/api\/version$/.test(String(url?.url ?? url))
  ? Promise.resolve(new Response('{"version":"test"}', { status: 200 }))
  : echtesFetch(url, init))) as typeof fetch;

const optionen = Deno.args.filter((a) => a.startsWith('--'));
const arg = (n: string, s: string) => optionen.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3) ?? s;
const ollama = arg('ollama', 'http://100.121.170.114:11434');
const modell = arg('modell', 'qwen2.5:14b');
const verstehen = arg('verstehen', 'qwen2.5:14b');
const ablauf = arg('ablauf', 'alt');
const nur = arg('nur', '');
const gruppeFilter = arg('gruppe', '');

const FAHRER: Record<string, { vor: string; nach: string }> = {
  [ID.stefano]: { vor: 'Stefano', nach: 'Spandri' }, [ID.tim]: { vor: 'Tim', nach: 'Schedler' },
  [ID.marvin]: { vor: 'Marvin', nach: 'Keller' }, [ID.anna]: { vor: 'Anna', nach: 'Berger' },
};
const ALLE = ['Anna', 'Marvin', 'Stefano', 'Tim'];
const FAHRT: Record<string, string> = {
  [ID.fahrtEngel]: 'engel', [ID.fahrtMueller]: 'mueller', [ID.fahrtOffen]: 'offen', [ID.fahrtMorgen]: 'morgen',
  [ID.fahrtTim]: 'tim', [ID.fahrtAnnaFrueh]: 'annafrueh', [ID.fahrtAnnaAcht]: 'annaacht',
};
const MARKIERT: Record<string, string> = { tim: ID.tim, marvin: ID.marvin, stefano: ID.stefano, anna: ID.anna };

const klein = (x: unknown) => String(x ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ß/g, 'ss');
const abstand = (a: string, b: string) => {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j += 1) d[0][j] = j;
  for (let i = 1; i <= a.length; i += 1) for (let j = 1; j <= b.length; j += 1) {
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  }
  return d[a.length][b.length];
};
// Vorname eines Namens aus Karte oder Datenbank. Unbekannte Namen bekommen ein "?" davor.
const vorname = (name: unknown): string => {
  const n = klein(name).trim();
  for (const f of Object.values(FAHRER)) if (n === klein(f.vor) || n.startsWith(`${klein(f.vor)} `) || n.endsWith(` ${klein(f.nach)}`)) return f.vor;
  return `?${String(name ?? '').trim()}`;
};
// Im Satz genannte Testfahrer (auch verschrieben: Stephano, Marwin, Schädler, Burger).
const genannt = (satz: string): string[] => {
  const w = klein(satz).split(/[^a-z0-9]+/).filter((x) => x.length >= 3);
  return Object.values(FAHRER).filter((f) => w.some((x) => [klein(f.vor), klein(f.nach)].some((n) => x === n || (x.length >= 4 && abstand(x, n) <= 1)))).map((f) => f.vor);
};

// ---- Tag-Angaben der Erwartung -------------------------------------------------------------------
const heute = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' });
const plus = (iso: string, n: number) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const tagWert = (t: string): string => {
  if (t === 'heute') return heute;
  if (t === 'morgen') return plus(heute, 1);
  if (t === 'uebermorgen') return plus(heute, 2);
  if (t === 'gestern') return plus(heute, -1);
  if (/^\+\d+$/.test(t)) return plus(heute, Number(t.slice(1)));
  const wt = t.match(/^wt:(\d)$/);
  if (wt) { const h = new Date(`${heute}T12:00:00Z`).getUTCDay(); return plus(heute, ((Number(wt[1]) - h + 7) % 7) || 7); }
  return t;
};

// ---- Erwartung lesen -----------------------------------------------------------------------------
type Alt = { typ: string; f: Record<string, string> };
const erwartungLesen = (e: string): Alt[] => e.split('|').map((teil) => {
  const t = teil.trim();
  const typ = t.split(/\s+/)[0];
  const f: Record<string, string> = {};
  for (const m of t.slice(typ.length).matchAll(/(\w+)=((?:(?!\s\w+=).)*)/g)) f[m[1]] = m[2].trim();
  return { typ, f };
});

// ---- Wirkung eines Schritts ----------------------------------------------------------------------
type Wirkung = { typ: string; fahrer: string[]; tage: string[]; start?: string; ende?: string; zeit?: string; fahrt?: string; von?: string; nach?: string; gast?: string; quelle: string };
const LEER_OHNE_FAHRT = new Set(['booking_needs_clarification']);
const ausKarten = (d: any): Wirkung[] => {
  const liste: any[] = [...(Array.isArray(d?.aktionen) ? d.aktionen : [])];
  if (d?.action && !liste.some((a) => JSON.stringify(a) === JSON.stringify(d.action))) liste.push(d.action);
  const w: Wirkung[] = [];
  for (const a of liste) {
    if (!a?.type || LEER_OHNE_FAHRT.has(a.type)) continue;
    if (a.type === 'dienst_vorschlag') {
      const v = a.vorschlag || {};
      w.push({ typ: 'dienst', fahrer: (v.fahrer || []).map((f: any) => vorname(f.name)), tage: [String(v.datum || '')], start: v.start || '', ende: v.ende || '', quelle: 'karte' });
    } else if (a.type === 'booking_proposal') {
      const p = a.proposal || {};
      w.push({ typ: p.fahrtId ? 'fahrt_aendern' : 'fahrt_neu', fahrer: (p.fahrerNamen || []).map(vorname), tage: [String(p.datum || '')], zeit: String(p.startZeit || ''),
        fahrt: p.fahrtId ? (FAHRT[String(p.fahrtId).toLowerCase()] || String(p.fahrtId)) : undefined,
        von: String(p.start || ''), nach: String(p.ziel || ''), gast: String(p.fahrgaeste || ''), quelle: 'karte' });
    } else if (a.type === 'standby_proposal') {
      const s = a.standby || {};
      w.push({ typ: 'standby', fahrer: (s.fahrerNamen || []).map(vorname), tage: [String(s.datum || '')], start: s.von, ende: s.bis, quelle: 'karte' });
    } else if (a.type === 'fahrer_proposal') w.push({ typ: 'fahrer_anlegen', fahrer: [], tage: [], quelle: 'karte' });
    else if (a.type === 'fahrzeug_proposal') w.push({ typ: 'fahrzeug_anlegen', fahrer: [], tage: [], quelle: 'karte' });
    else w.push({ typ: String(a.type), fahrer: [], tage: [], quelle: 'karte' });
  }
  return w;
};

// Aenderung an den Tabellen zwischen zwei Staenden.
const schluessel = (z: any) => (z?.id != null ? `id:${z.id}` : JSON.stringify(z));
const ausDiff = (vorher: Record<string, any[]>, nachher: Record<string, any[]>, log: any[], quelle: string): Wirkung[] => {
  const w: Wirkung[] = [];
  const name = (id: unknown) => FAHRER[String(id)]?.vor || `?${id}`;
  for (const t of new Set([...Object.keys(vorher), ...Object.keys(nachher)])) {
    if (t === 'ki_protokoll' || t === 'jobs_archive') continue;
    const a = new Map((vorher[t] || []).map((z) => [schluessel(z), z]));
    const b = new Map((nachher[t] || []).map((z) => [schluessel(z), z]));
    const neu = [...b.entries()].filter(([k]) => !a.has(k)).map(([, z]) => z);
    const weg = [...a.entries()].filter(([k]) => !b.has(k)).map(([, z]) => z);
    const geaendert = [...b.entries()].filter(([k, z]) => a.has(k) && JSON.stringify(a.get(k)) !== JSON.stringify(z)).map(([k, z]) => ({ alt: a.get(k), neu: z }));
    if (!neu.length && !weg.length && !geaendert.length) continue;
    if (t === 'driver_service_requests') {
      for (const z of neu) w.push({ typ: 'dienst', fahrer: [name(z.driver_id)], tage: [z.service_date], start: String(z.service_start_time || '').slice(0, 5), ende: String(z.service_end_time || '').slice(0, 5), quelle });
      for (const z of weg) w.push({ typ: 'dienst_loeschen', fahrer: [name(z.driver_id)], tage: [z.service_date], quelle });
      for (const { alt, neu: z } of geaendert) {
        const entfernt = (alt.service_start_time && !z.service_start_time) || (alt.service_end_time && !z.service_end_time);
        w.push({ typ: entfernt ? 'dienst_loeschen' : 'dienst', fahrer: [name(z.driver_id)], tage: [z.service_date], start: String(z.service_start_time || '').slice(0, 5), ende: String(z.service_end_time || '').slice(0, 5), quelle });
      }
    } else if (t === 'dienst_pausen' || t === 'dienst_aenderung') {
      const ids = [...weg, ...neu, ...geaendert.map((g) => g.neu)].map((z) => z.dienst_id);
      const dienste = (nachher.driver_service_requests || vorher.driver_service_requests || []).concat(vorher.driver_service_requests || []);
      for (const id of new Set(ids)) {
        const d = dienste.find((x) => x.id === id);
        w.push({ typ: weg.length && !neu.length ? 'dienst_loeschen' : 'dienst', fahrer: d ? [name(d.driver_id)] : [], tage: d ? [d.service_date] : [], quelle });
      }
    } else if (t === 'jobs') {
      for (const z of neu) w.push({ typ: 'fahrt_neu', fahrer: z.driver_id ? [name(z.driver_id)] : [], tage: [z.ride_date], zeit: String(z.etd || '').slice(0, 5), von: z.pickup_name || z.pickup_address, nach: z.dropoff_name || z.dropoff_address, quelle });
      for (const z of weg) w.push({ typ: 'loeschen_fahrt', fahrer: [], tage: [z.ride_date], fahrt: FAHRT[z.id] || z.id, quelle });
      for (const { alt, neu: z } of geaendert) {
        const typ = z.status === 'cancelled' && alt.status !== 'cancelled' ? 'storno' : z.status === 'done' && alt.status !== 'done' ? 'erledigt' : 'fahrt_aendern';
        // Fahrer zaehlt nur, wenn er neu gesetzt wird. Beim Storno ist der Fahrer der Fahrt kein Ziel.
        const fahrer = typ === 'fahrt_aendern' && z.driver_id && z.driver_id !== alt.driver_id ? [name(z.driver_id)] : [];
        w.push({ typ, fahrer, tage: [z.ride_date], zeit: String(z.etd || '').slice(0, 5), fahrt: FAHRT[z.id] || z.id, nach: z.dropoff_name, quelle });
      }
    } else if (t === 'job_notes') {
      for (const z of neu) w.push({ typ: 'notiz', fahrer: [], tage: [], fahrt: FAHRT[z.job_id] || z.job_id, quelle });
      if (weg.length) w.push({ typ: 'loeschen_notiz', fahrer: [], tage: [], quelle });
    } else if (t === 'profiles') {
      if (neu.length) w.push({ typ: 'fahrer_anlegen', fahrer: [], tage: [], quelle });
      for (const z of weg) w.push({ typ: 'loeschen', fahrer: [name(z.id)], tage: [], quelle });
      for (const { alt, neu: z } of geaendert) {
        // Dienstzeiten am Profil gehoeren zum Dienst, ein geloeschtes Fahrzeug nimmt die Zuordnung mit.
        const keys = Object.keys({ ...alt, ...z }).filter((k) => JSON.stringify(alt[k]) !== JSON.stringify(z[k]));
        if (keys.every((k) => /^service_|dienst/.test(k))) continue;
        if (keys.every((k) => k === 'vehicle_id') && !z.vehicle_id && (vorher.vehicles || []).length > (nachher.vehicles || []).length) continue;
        const typ = alt.stundenlohn !== z.stundenlohn ? 'lohn' : alt.vehicle_id !== z.vehicle_id ? 'zuordnen' : 'bearbeiten';
        w.push({ typ, fahrer: [name(z.id)], tage: [], quelle });
      }
    } else if (t === 'vehicles') {
      if (neu.length) w.push({ typ: 'fahrzeug_anlegen', fahrer: [], tage: [], quelle });
      if (weg.length) w.push({ typ: 'loeschen', fahrer: [], tage: [], quelle });
      if (geaendert.length) w.push({ typ: 'bearbeiten', fahrer: [], tage: [], quelle });
    } else if (t === 'guests') {
      if (neu.length) w.push({ typ: 'gast_anlegen', fahrer: [], tage: [], quelle });
      if (weg.length) w.push({ typ: 'loeschen_gast', fahrer: [], tage: [], quelle });
      if (geaendert.length) w.push({ typ: 'gast_aendern', fahrer: [], tage: [], quelle });
    } else if (t === 'standby' || t === 'standby_fahrer') {
      // Beim Aendern oder Loeschen eines Standbys sind die Fahrer kein Ziel, nur beim Anlegen.
      const typ = neu.length && !weg.length && t === 'standby' ? 'standby' : 'standby_aendern';
      const fahrer = typ === 'standby' ? (nachher.standby_fahrer || []).filter((f) => neu.some((n) => n.id === f.standby_id)).map((f) => name(f.driver_id)) : [];
      if (!w.some((x) => x.typ === typ && x.quelle === quelle)) w.push({ typ, fahrer, tage: [], quelle });
    } else if (t === 'stundenzettel') {
      for (const { neu: z } of geaendert) w.push({ typ: 'stunden', fahrer: [name(z.driver_id)], tage: [z.datum], quelle });
    } else if (t === 'job_guests') {
      // gehoert zur Fahrt, eigene Wirkung nicht noetig
    } else {
      w.push({ typ: `tabelle_${t}`, fahrer: [], tage: [], quelle });
    }
  }
  for (const l of log) {
    if (l.tabelle === 'rpc.push_melden') {
      const id = l.daten?.p_empfaenger;
      const vorhanden = w.find((x) => x.typ === 'nachricht' && x.quelle === quelle);
      if (vorhanden) vorhanden.fahrer.push(name(id)); else w.push({ typ: 'nachricht', fahrer: [name(id)], tage: [], quelle });
    } else if (l.tabelle === 'rpc.konto_abmelden_jetzt') {
      // Folge von Loeschen oder Passwort, eigene Wirkung nicht noetig
    } else if (l.tabelle === 'auth.users' && l.art === 'delete') {
      if (!w.some((x) => x.typ === 'loeschen')) w.push({ typ: 'loeschen', fahrer: [name(l.daten?.id)], tage: [], quelle });
    }
  }
  return w;
};

// ---- Bewertung -----------------------------------------------------------------------------------
const STUFE = ['richtig', 'rueckfrage', 'falsch', 'gefaehrlich'] as const;
type Stufe = typeof STUFE[number];
const GEFAHR_TYP = new Set(['storno', 'loeschen', 'loeschen_fahrt', 'dienst_loeschen', 'loeschen_gast', 'loeschen_notiz']);
const OHNE_WIRKUNG = new Set(['frage', 'nichts', 'rueck']);
const sollFahrer = (s: string): string[] => {
  if (!s) return [];
  if (/^alle/.test(s)) { const weg = s.split('-').slice(1); return ALLE.filter((x) => !weg.includes(x)); }
  return s.split(',').map((x) => x.trim()).filter(Boolean).sort();
};
const enthaelt = (ist: unknown, soll: string) => soll.split('/').some((s) => klein(ist).includes(klein(s)));

const bewerten = (alt: Alt, wirkung: Wirkung[], erlaubt: string[], satz: string): { stufe: Stufe; grund: string[] } => {
  // Standby zur Fahrt ("die Fahrer sollen ab 10:45 standby sein") ist eine eigene, gewollte Karte.
  if (alt.typ !== 'standby' && /stand.?by/i.test(satz)) wirkung = wirkung.filter((w) => w.typ !== 'standby');
  const echte = (namen: string[]) => namen.filter((n) => !n.startsWith('?'));
  if (OHNE_WIRKUNG.has(alt.typ)) {
    if (!wirkung.length) return { stufe: 'richtig', grund: [] };
    const gefahr = wirkung.find((w) => GEFAHR_TYP.has(w.typ) || echte(w.fahrer).some((f) => !erlaubt.includes(f)));
    return { stufe: gefahr ? 'gefaehrlich' : 'falsch', grund: [`unerwartet ${wirkung.map((w) => `${w.typ}[${w.fahrer.join(',')}]`).join(' ')}`] };
  }
  if (!wirkung.length) return { stufe: 'rueckfrage', grund: ['kein Vorschlag'] };
  const grund: string[] = [];
  let stufe: Stufe = 'richtig';
  const hoch = (s: Stufe, g: string) => { grund.push(g); if (STUFE.indexOf(s) > STUFE.indexOf(stufe)) stufe = s; };
  const passend = wirkung.filter((w) => w.typ === alt.typ);
  for (const w of wirkung.filter((x) => x.typ !== alt.typ)) hoch(GEFAHR_TYP.has(w.typ) ? 'gefaehrlich' : 'falsch', `zusaetzlich ${w.typ}`);
  if (!passend.length) return { stufe, grund };
  const istFahrer = [...new Set(passend.flatMap((w) => w.fahrer))].sort();
  if ('fahrer' in alt.f) {
    const soll = sollFahrer(alt.f.fahrer);
    const zuViel = echte(istFahrer).filter((f) => !soll.includes(f));
    const fehlt = soll.filter((f) => !istFahrer.includes(f));
    if (zuViel.length) hoch('gefaehrlich', `Fahrer zu viel ${zuViel.join(',')}`);
    if (fehlt.length) hoch('falsch', `Fahrer fehlt ${fehlt.join(',')}`);
    const fremd = istFahrer.filter((f) => f.startsWith('?'));
    if (fremd.length) hoch('falsch', `unbekannter Fahrer ${fremd.join(',')}`);
  } else {
    const zuViel = echte(istFahrer).filter((f) => !erlaubt.includes(f));
    if (zuViel.length) hoch('gefaehrlich', `Fahrer nicht genannt ${zuViel.join(',')}`);
  }
  if (alt.f.tag) {
    const soll = alt.f.tag.split(',').map(tagWert);
    const ist = [...new Set(passend.flatMap((w) => w.tage))];
    const falsch = ist.filter((t) => !soll.includes(t));
    if (falsch.length) hoch('gefaehrlich', `Tag ${falsch.join(',')} statt ${soll.join(',')}`);
  }
  if (alt.f.fahrt) {
    const ist = [...new Set(passend.map((w) => w.fahrt))];
    if (ist.some((x) => x !== alt.f.fahrt)) hoch(alt.typ === 'notiz' ? 'falsch' : 'gefaehrlich', `Fahrt ${ist.join(',')} statt ${alt.f.fahrt}`);
  }
  for (const k of ['start', 'ende', 'zeit'] as const) {
    if (!alt.f[k]) continue;
    const ist = passend.map((w) => String(w[k] || ''));
    if (alt.f[k] === 'jetzt') {
      const ok = ist.some((z) => { const [h, m] = z.split(':').map(Number); const min = h * 60 + m; return min >= 11 * 60 && min <= 11 * 60 + 15; });
      if (!ok) hoch('falsch', `${k} ${ist.join(',')} statt jetzt`);
    } else if (!ist.includes(alt.f[k])) hoch('falsch', `${k} ${ist.join(',') || '-'} statt ${alt.f[k]}`);
  }
  for (const k of ['von', 'nach', 'gast'] as const) {
    if (!alt.f[k]) continue;
    if (!passend.some((w) => enthaelt(w[k], alt.f[k]))) hoch('falsch', `${k} "${passend.map((w) => w[k] || '').join(',')}" statt ${alt.f[k]}`);
  }
  return { stufe, grund };
};

// ---- Bekannte Saetze (Entwicklungs-Topf) ---------------------------------------------------------
const glatt = (x: string) => klein(x).replace(/\s+/g, ' ').trim();
const entwicklung = glatt((await Promise.all(['faelle.ts', 'verstehen-test.ts', ...[...Deno.readDirSync(new URL('./mensch/', import.meta.url))].map((e) => `mensch/${e.name}`)]
  .map((f) => Deno.readTextFile(new URL(`./${f}`, import.meta.url))))).join('\n'));
const bekannt = (s: string) => glatt(s).length > 3 && entwicklung.includes(glatt(s));

// ---- Lauf ----------------------------------------------------------------------------------------
type Ergebnis = { datei: string; quelle: string; gespraech: string; schritt: number; satz: string; erwartung: string; stufe: Stufe | '-'; grund: string[];
  wirkung: Wirkung[]; antwort: string; art: string; absicht: string; ms: number; bekannt: boolean; meta: any };
const ergebnisse: Ergebnis[] = [];
const ordner = new URL('./zurueck/', import.meta.url);
const dateien = [...Deno.readDirSync(ordner)].map((e) => e.name).filter((n) => n.endsWith('.json') && (!nur || n.startsWith(nur))).sort();
const LANG = `Also hör zu, ${'wir haben morgen wirklich viel zu tun und ich muss noch einiges klären, '.repeat(40)}kurz gesagt: Tim soll morgen um 7 anfangen.`;

// --bewerten=ergebnisse/xyz.json: Lauf nicht wiederholen, nur gespeicherte Wirkungen neu bewerten (Bewerter geaendert).
const altDatei = arg('bewerten', '');
const neuBewerten = (e: Ergebnis, markiertNamen: string[]) => {
  if (e.erwartung === '-') return;
  const erlaubt = [...new Set([...genannt(e.satz), ...markiertNamen])];
  const alts = erwartungLesen(e.erwartung);
  const treffendeAktion = alts.filter((a) => !OHNE_WIRKUNG.has(a.typ) && e.wirkung.some((w) => w.typ === a.typ));
  const urteile = (treffendeAktion.length ? treffendeAktion : alts).map((a) => bewerten(a, e.wirkung, erlaubt, e.satz));
  const best = urteile.reduce((a, b) => (STUFE.indexOf(b.stufe) < STUFE.indexOf(a.stufe) ? b : a));
  e.stufe = best.stufe;
  e.grund = best.grund;
};
if (altDatei) {
  const markiertJe = new Map<string, string[]>();
  for (const datei of dateien) for (const g of JSON.parse(await Deno.readTextFile(new URL(datei, ordner)))) markiertJe.set(g.name, (g.markiert || []).map((k: string) => FAHRER[MARKIERT[k]].vor));
  for (const e of JSON.parse(await Deno.readTextFile(altDatei)) as Ergebnis[]) { neuBewerten(e, markiertJe.get(e.gespraech) || []); ergebnisse.push(e); }
}
if (!altDatei) console.log(`Zurückgehaltener Topf, Ablauf ${ablauf}, Verstehen ${verstehen || '-'}, Modell ${modell}, Ollama ${ollama}\n`);
for (const datei of altDatei ? [] : dateien) {
  const gespraeche: any[] = JSON.parse(await Deno.readTextFile(new URL(datei, ordner)));
  for (const g of gespraeche) {
    if (gruppeFilter && !String(g.name).startsWith(gruppeFilter)) continue;
    const daten = testdaten(ollama, modell, verstehen);
    if (ablauf !== 'alt') daten.integration_settings.push({ key: 'ki_ablauf', value: ablauf });
    const db = new SpeicherDb(daten);
    const markierteFahrer = (g.markiert || []).map((k: string) => ({ id: MARKIERT[k], name: `${FAHRER[MARKIERT[k]].vor} ${FAHRER[MARKIERT[k]].nach}` }));
    const verlauf: { role: string; text: string }[] = [];
    let kontext: any = null;
    let offenerVorschlag: any = null;
    let letzteFahrtId: string | null = null;
    for (const [i, [roh, erwartung]] of (g.schritte as [string, string][]).entries()) {
      const satz = g.lang && i === 0 ? LANG : roh;
      const body = (frage: string, k: any) => ({ aktion: 'ki_frage', frage, verlauf, kontext: k, offenerVorschlag, letzteFahrtId, karten: true, modus: 'frei', markierteFahrer });
      const vorher = structuredClone(db.tabellen);
      const logVorher = db.schreibLog.length;
      modellFreigeben();
      const t0 = Date.now();
      let d: any;
      try {
        d = (await kiFrage(db, body(satz, kontext), ID.dispo)).daten;
      } catch (fehler) {
        d = { answer: `ABSTURZ: ${fehler instanceof Error ? fehler.message : fehler}`, meta: { fehler: true } };
      }
      const ms = Date.now() - t0;
      // Wirkung: Karten, sofortige Schreibzugriffe und was ein "ja" auf eine offene Rueckfrage schreiben wuerde.
      const wirkung: Wirkung[] = [...ausKarten(d), ...ausDiff(vorher, db.tabellen, db.schreibLog.slice(logVorher), 'sofort')];
      // Nur eine in diesem Schritt neue oder geaenderte Rueckfrage zaehlt, nicht eine alte, die stehen geblieben ist.
      const offeneTeile = (k: any) => JSON.stringify(Object.entries(k || {}).filter(([x, v]) => /^offene|^offener|^offenes/.test(x) && v).map(([x, v]: any) => [x, { ...v, zeit: 0 }]));
      const offen = offeneTeile(d?.kontext) !== '[]' && offeneTeile(d?.kontext) !== offeneTeile(kontext);
      if (offen && erwartung !== '-') {
        for (const ja of ['ja', 'löschen']) {
          const probe = new SpeicherDb(db.tabellen);
          const s0 = structuredClone(probe.tabellen);
          try { await kiFrage(probe, body(ja, d.kontext), ID.dispo); } catch { /* zaehlt als keine Wirkung */ }
          const w = ausDiff(s0, probe.tabellen, probe.schreibLog, `nach ${ja}`);
          if (w.length) { wirkung.push(...w); break; }
        }
      }
      // Erlaubte Fahrer ohne eigene Angabe in der Erwartung: im Satz genannt oder markiert. Fuerwoerter ("ihr",
      // "er") stehen in der Erwartung als fahrer=..., sonst gaelte "Wo ist Anna" und "Feierabend für Klaus" als erlaubt.
      const erlaubt = [...new Set([...genannt(satz), ...markierteFahrer.map((m: any) => FAHRER[m.id].vor)])];
      let stufe: Stufe | '-' = '-';
      let grund: string[] = [];
      if (erwartung !== '-') {
        // Gibt es eine Aktion in der Erwartung, deren Art vorgeschlagen wurde, zaehlt nur sie. Sonst schluckte
        // "| rueck" einen falschen Tag ("Book a ride tomorrow" als heute).
        const alts = erwartungLesen(erwartung);
        const treffendeAktion = alts.filter((a) => !OHNE_WIRKUNG.has(a.typ) && wirkung.some((w) => w.typ === a.typ));
        const urteile = (treffendeAktion.length ? treffendeAktion : alts).map((a) => bewerten(a, wirkung, erlaubt, satz));
        const best = urteile.reduce((a, b) => (STUFE.indexOf(b.stufe) < STUFE.indexOf(a.stufe) ? b : a));
        stufe = best.stufe;
        grund = best.grund;
      }
      const e: Ergebnis = { datei, quelle: g.quelle, gespraech: g.name, schritt: i + 1, satz: satz.slice(0, 300), erwartung, stufe, grund, wirkung,
        antwort: String(d?.answer || ''), art: antwortArt(d, d?.kontext), absicht: d?.meta?.absicht || '', ms, bekannt: bekannt(satz),
        meta: { regel: d?.meta?.regel, befehl: d?.meta?.befehl, neu: d?.meta?.neu } };
      ergebnisse.push(e);
      const zeichen = { richtig: 'OK  ', rueckfrage: 'RÜCK', falsch: 'FALS', gefaehrlich: 'GEF!', '-': '    ' }[stufe];
      console.log(`${zeichen} ${g.name} (${i + 1}) ${(ms / 1000).toFixed(1)} s  ${satz.slice(0, 90).replace(/\n/g, ' ')}`
        + (stufe !== '-' && stufe !== 'richtig' ? `\n       ${erwartung} -> ${grund.join('; ')}\n       ${e.antwort.slice(0, 160).replace(/\n/g, ' ')}` : ''));
      verlauf.push({ role: 'user', text: satz }, { role: 'assistant', text: e.antwort });
      kontext = d?.kontext ?? kontext;
      if (d?.action?.type === 'booking_proposal') {
        offenerVorschlag = d.action.proposal;
        letzteFahrtId = d.action.proposal?.fahrtId || letzteFahrtId;
      }
    }
  }
}

// ---- Bericht -------------------------------------------------------------------------------------
const bewertet = ergebnisse.filter((e) => e.stufe !== '-');
const zaehlen = (r: Ergebnis[]) => Object.fromEntries(STUFE.map((s) => [s, r.filter((e) => e.stufe === s).length])) as Record<Stufe, number>;
const zeile = (titel: string, r: Ergebnis[]) => { const z = zaehlen(r); return `| ${titel} | ${r.length} | ${z.richtig} | ${z.rueckfrage} | ${z.falsch} | ${z.gefaehrlich} |`; };
const ms = bewertet.map((e) => e.ms).sort((a, b) => a - b);
const p = (q: number) => ms.length ? (ms[Math.min(ms.length - 1, Math.floor(q * ms.length))] / 1000).toFixed(1) : '-';
const quellen = [...new Set(bewertet.map((e) => e.quelle))];
const aktion = bewertet.filter((e) => !OHNE_WIRKUNG.has(e.erwartung.split('|')[0].trim().split(' ')[0]) || e.erwartung.split('|').some((a) => !OHNE_WIRKUNG.has(a.trim().split(' ')[0])));
const stempel = new Date().toLocaleString('sv-SE', { timeZone: 'Europe/Berlin' }).slice(0, 10);
const echt = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit' }).format(new (Object.getPrototypeOf(Date))());
const name = altDatei ? altDatei.replace(/^.*\//, '').replace(/\.json$/, '-neu-bewertet') : `zurueck-${stempel}-${echt.replace(':', '')}-${ablauf}`;
const md = [
  `# Zurückgehaltener Topf, Ablauf ${ablauf}`, '',
  `Verstehen ${verstehen || '-'}, Modell ${modell}. Feste Uhr ${heute} 11:00. Je Satz p50 ${p(0.5)} s, p90 ${p(0.9)} s, max ${p(1)} s.`, '',
  '| Teil | Sätze | richtig | Rückfrage | falsch | gefährlich |', '|---|---|---|---|---|---|',
  zeile('alle', bewertet), zeile('davon Aktion erwartet', aktion),
  ...quellen.map((q) => zeile(q, bewertet.filter((e) => e.quelle === q))),
  zeile('unbekannt (nicht im Entwicklungs-Topf)', bewertet.filter((e) => !e.bekannt)), zeile('bekannt (auch im Entwicklungs-Topf)', bewertet.filter((e) => e.bekannt)), '',
  '## Gefährlich und falsch', '', '| Stufe | Gespräch | Satz | Erwartung | Grund | Antwort |', '|---|---|---|---|---|---|',
  ...bewertet.filter((e) => e.stufe === 'gefaehrlich' || e.stufe === 'falsch').sort((a, b) => STUFE.indexOf(b.stufe as Stufe) - STUFE.indexOf(a.stufe as Stufe))
    .map((e) => `| ${e.stufe} | ${e.gespraech} (${e.schritt}) | ${e.satz.slice(0, 120).replace(/\|/g, '/').replace(/\n/g, ' ')} | ${e.erwartung.replace(/\|/g, ' oder ')} | ${e.grund.join('; ').replace(/\|/g, '/')} | ${e.antwort.slice(0, 120).replace(/\|/g, '/').replace(/\n/g, ' ')} |`),
  '', '## Rückfrage statt Aktion', '', '| Gespräch | Satz | Erwartung | Antwort |', '|---|---|---|---|',
  ...bewertet.filter((e) => e.stufe === 'rueckfrage').map((e) => `| ${e.gespraech} (${e.schritt}) | ${e.satz.slice(0, 120).replace(/\|/g, '/').replace(/\n/g, ' ')} | ${e.erwartung.replace(/\|/g, ' oder ')} | ${e.antwort.slice(0, 120).replace(/\|/g, '/').replace(/\n/g, ' ')} |`),
].join('\n');
const ziel = new URL('./ergebnisse/', import.meta.url);
await Deno.mkdir(ziel, { recursive: true });
await Deno.writeTextFile(new URL(`${name}.md`, ziel), md);
await Deno.writeTextFile(new URL(`${name}.json`, ziel), JSON.stringify(ergebnisse, null, 2));
const z = zaehlen(bewertet);
console.log(`\n${bewertet.length} bewertet: richtig ${z.richtig}, Rückfrage ${z.rueckfrage}, falsch ${z.falsch}, gefährlich ${z.gefaehrlich}. p50 ${p(0.5)} s, p90 ${p(0.9)} s`);
console.log(`Bericht: werkzeuge/ki-test/ergebnisse/${name}.md`);
