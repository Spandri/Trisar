// Tests ohne echte Google-Suche fuer Ortssuche nach Naehe und Korrektur im Chat (19.11.2026):
// dispo-admin/ortSuche.ts (Bezugspunkt, Entfernung, naechster Treffer), ortKorrektur.ts ("ich meinte die in Augsburg").
// Die Google-Antwort ist nachgestellt: Treffer mit distance_meters vom mitgeschickten origin.
//   cd trisar && deno test -A --no-check werkzeuge/ki-test/ort-suche-test.ts

// deno-lint-ignore-file no-explicit-any
import './zurueck/uhr-fest.ts';
import { assert, assertEquals } from 'jsr:@std/assert@1';
import { bezugspunkt, ortAufloesen } from '../../fahrer/supabase/functions/dispo-admin/ortSuche.ts';
import { alternativenMerken, ortKorrektur } from '../../fahrer/supabase/functions/dispo-admin/ortKorrektur.ts';
import { SpeicherDb } from './speicherDb.ts';
import { ID, testdaten } from './testdaten.ts';

Deno.env.set('GOOGLE_PLACES_SERVER_KEY', 'test');

// Nachgestellte Orte mit Koordinaten. Entfernung wie Google: Luftlinie vom origin.
const ORTE = [
  { wert: 'Ottilienstraße 2, Ellwangen (Jagst), Deutschland', lat: 48.96, lng: 10.13 },
  { wert: 'Ottilienstraße 2, Reutlingen, Deutschland', lat: 48.49, lng: 9.21 },
  { wert: 'Ottilienstraße 2, München-Trudering-Riem, Deutschland', lat: 48.12, lng: 11.66 },
  { wert: 'Ottilienstraße 2, Weißenhorn-Attenhofen, Deutschland', lat: 48.30, lng: 10.16 },
  { wert: 'Frühlingstraße 24, 82152 Krailling, Deutschland', lat: 48.10, lng: 11.40 },
  { wert: 'Frühlingstraße, Augsburg, Deutschland', lat: 48.37, lng: 10.90 },
  { wert: 'Frühlingstraße, Berlin, Deutschland', lat: 52.52, lng: 13.40 },
  { wert: 'Frühlingstraße, Hamburg, Deutschland', lat: 53.55, lng: 10.00 },
];
const luftlinie = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
  const r = 6371000;
  const rad = (x: number) => (x * Math.PI) / 180;
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return Math.round(2 * r * Math.asin(Math.sqrt(h)));
};
let anfragen: URL[] = [];
const echtesFetch = globalThis.fetch;
globalThis.fetch = (async (url: any, init?: any) => {
  const u = new URL(String(url?.url ?? url));
  if (u.host !== 'maps.googleapis.com') return echtesFetch(url, init);
  anfragen.push(u);
  const eingabe = (u.searchParams.get('input') || '').toLowerCase().replace(/ü/g, 'ue');
  const [lat, lng] = (u.searchParams.get('origin') || '').split(',').map(Number);
  const worte = eingabe.split(/\s+/).filter((w) => w.length >= 3);
  // Google ordnet nicht nach Entfernung, darum absichtlich Berlin zuerst.
  // Wie Google: Tippfehler "otiilien" wird verbessert, Reihenfolge nicht nach Entfernung.
  const korrigiert = worte.map((w) => w.replace('otiilien', 'ottilien'));
  const treffer = [ORTE[6], ORTE[4], ORTE[0], ORTE[1], ORTE[2], ORTE[3], ORTE[7], ORTE[5]].filter((o) => korrigiert.filter((w) => !/^(in|reutlingen)$/.test(w)).every((w) => o.wert.toLowerCase().replace(/ü/g, 'ue').replace('straße', 'str').includes(w.replace('strasse', 'str').slice(0, 6))));
  return new Response(JSON.stringify({ status: 'OK', predictions: treffer.map((o) => ({
    description: o.wert, structured_formatting: { main_text: o.wert.split(',')[0], secondary_text: o.wert.split(',').slice(1).join(',') },
    ...(Number.isFinite(lat) ? { distance_meters: luftlinie({ lat, lng }, o) } : {}),
  })) }), { status: 200 });
}) as typeof fetch;

const MUENCHEN = { lat: 48.1405, lng: 11.5735 };
const db = () => new SpeicherDb(testdaten('http://127.0.0.1:9', 'q', ''));

Deno.test('Suche: ein Wort wird gesucht, naechster Treffer zuerst, Rest als Alternativen', async () => {
  anfragen = [];
  const e = await ortAufloesen(db(), 'Frühlingstr', [], ID.dispo, MUENCHEN);
  assertEquals(e.text, 'Frühlingstraße 24, 82152 Krailling, Deutschland');
  assertEquals(e.alternativen?.map((o) => o.wert.split(',')[1].trim()), ['Augsburg', 'Berlin', 'Hamburg']);
  assertEquals(e.unsicher, undefined);
  assertEquals(anfragen[0].searchParams.get('origin'), '48.14050,11.57350');
});

Deno.test('Suche: kein Treffer heisst nachfragen, nie der getippte Text', async () => {
  const e = await ortAufloesen(db(), 'Gibtsnichtweg 5', [], ID.dispo, MUENCHEN);
  assertEquals(e.unsicher, []);
});

Deno.test('Bezugspunkt: Standort aus dispo_standort, sonst Ankuenfte, sonst Flotte', async () => {
  const d = db();
  d.tabellen.dispo_standort = [{ user_id: ID.dispo, lat: 52.52, lng: 13.40 }];
  assertEquals(await bezugspunkt(d, ID.dispo, null, []), { lat: 52.52, lng: 13.40 });
  const d2 = db();
  d2.tabellen.dispo_ankunft_melden = [{ user_id: ID.dispo, lat: 48.37, lng: 10.90 }];
  assertEquals(await bezugspunkt(d2, ID.dispo, null, []), { lat: 48.37, lng: 10.90 });
  // Aus Berlin gesucht kommt die Berliner Frühlingstraße zuerst.
  const e = await ortAufloesen(d, 'Frühlingstr', [], ID.dispo, await bezugspunkt(d, ID.dispo, null, []));
  assert(e.text.includes('Berlin'), e.text);
});

const vorschlag = { datum: '2026-11-19', startZeit: '07:00', start: 'Flughafen München General Aviation Terminal (GAT)', ziel: 'Frühlingstraße 24, 82152 Krailling, Deutschland',
  fahrgaeste: 'anonym', fahrerNamen: ['Tim Schedler'], startOrtId: '', zielOrtId: '' };
const kontextMit = async () => {
  const e = await ortAufloesen(db(), 'Frühlingstr', [], ID.dispo, MUENCHEN);
  return alternativenMerken({ action: { type: 'booking_proposal', proposal: vorschlag }, kontext: {}, meta: { ortAlternativen: { ziel: { text: 'Frühlingstr', optionen: e.alternativen } } } }).kontext;
};

Deno.test('Korrektur: "ich meinte die in Augsburg" nimmt den gemerkten Treffer', async () => {
  const kontext = await kontextMit();
  const r: any = await ortKorrektur(db(), { kontext, offenerVorschlag: vorschlag }, 'Nein, das ist das falsche Ziel, ich meinte die Straße in Augsburg', ID.dispo);
  assertEquals(r?.action?.proposal?.ziel, 'Frühlingstraße, Augsburg, Deutschland');
  assertEquals(r?.action?.proposal?.startZeit, '07:00');
  assertEquals(r?.action?.proposal?.fahrerNamen, ['Tim Schedler']);
  // Die bisherige Krailling-Adresse bleibt als Alternative, zurueck geht also auch.
  assert(r.kontext.ortAlternativen.ziel.optionen.some((o: any) => o.wert.includes('Krailling')));
});

Deno.test('Korrektur: nicht gemerkter Ort wird mit Strasse neu gesucht', async () => {
  const kontext = await kontextMit();
  kontext.ortAlternativen.ziel.optionen = kontext.ortAlternativen.ziel.optionen.filter((o: any) => !o.wert.includes('Hamburg'));
  const r: any = await ortKorrektur(db(), { kontext, offenerVorschlag: vorschlag }, 'nein ich meinte die in Hamburg', ID.dispo);
  assertEquals(r?.action?.proposal?.ziel, 'Frühlingstraße, Hamburg, Deutschland');
});

Deno.test('Korrektur: Start statt Ziel, ohne neuen Ort Auswahl, neuer Auftrag ist keine Korrektur', async () => {
  const kontext = await kontextMit();
  // Ohne Ort im Satz: Auswahl aus den gemerkten Treffern.
  const r: any = await ortKorrektur(db(), { kontext, offenerVorschlag: vorschlag }, 'Nein, das falsche Ziel', ID.dispo);
  assertEquals(r?.action?.type, 'ort_auswahl');
  // Kein Korrekturwort: neuer Auftrag, nicht anfassen.
  assertEquals(await ortKorrektur(db(), { kontext, offenerVorschlag: vorschlag }, 'Fahrt morgen nach Augsburg', ID.dispo), null);
  // Anderer offener Vorschlag: die gemerkten Treffer gehoeren nicht dazu.
  assertEquals(await ortKorrektur(db(), { kontext, offenerVorschlag: { ...vorschlag, startZeit: '09:00' } }, 'ich meinte die in Augsburg', ID.dispo), null);
});

Deno.test('Suche: Tippfehler im Strassennamen, naechster Treffer gilt (19.11. Ottilienstrasse)', async () => {
  const e = await ortAufloesen(db(), 'otiilienstrasse 2', [], ID.dispo, { lat: 48.325, lng: 11.639 });
  assertEquals(e.text, 'Ottilienstraße 2, München-Trudering-Riem, Deutschland');
  assertEquals(e.unsicher, undefined);
});

Deno.test('Suche: Strasse und Ort im Text schlagen den naeheren Treffer nur mit Strasse (19.11. Reutlingen)', async () => {
  const e = await ortAufloesen(db(), 'otiilienstrasse 2 in Reutlingen', [], ID.dispo, { lat: 48.325, lng: 11.639 });
  assertEquals(e.text, 'Ottilienstraße 2, Reutlingen, Deutschland');
});

Deno.test('Suche: nicht eindeutig heisst nachfragen, naechster oben', async () => {
  // Zwischen Augsburg und München: Krailling und Augsburg etwa gleich weit, also nachfragen.
  const e = await ortAufloesen(db(), 'Frühlingstr', [], ID.dispo, { lat: 48.25, lng: 11.20 });
  assert(e.unsicher && e.unsicher.length >= 2, JSON.stringify(e));
  assert(e.unsicher![0].distanzM! <= e.unsicher![1].distanzM!, 'naechster oben');
  // Alles weit weg (aus Wien): nachfragen.
  const w = await ortAufloesen(db(), 'Frühlingstr', [], ID.dispo, { lat: 48.21, lng: 16.37 });
  assert(w.unsicher?.length, JSON.stringify(w));
});

Deno.test('Suche: allgemeine Woerter zaehlen, gleicher Fleck ist ein Ort (19.11. Hauptbahnhof, Servus Habibi)', async () => {
  const alt = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({ predictions: [
    { description: 'Servus Habibi (Maxvorstadt), Nordendstraße, München, Deutschland', distance_meters: 21000 },
    { description: 'Hauptbahnhof, Bahnhofplatz, München-Ludwigsvorstadt-Isarvorstadt, Deutschland', distance_meters: 20100 },
    { description: 'Hauptbahnhof (U, Tram), Bayerstraße, München, Deutschland', distance_meters: 20300 },
  ] }))) as typeof fetch;
  try {
    const e = await ortAufloesen(db(), 'Hauptbahnhof in München', [], ID.dispo, { lat: 48.325, lng: 11.639 });
    assertEquals(e.text, 'Hauptbahnhof, Bahnhofplatz, München-Ludwigsvorstadt-Isarvorstadt, Deutschland');
    assertEquals(e.unsicher, undefined);
  } finally { globalThis.fetch = alt; }
});

// ---- 19.11. abends: fertige Adresse pruefen, Ausfall, Ziel um den Start --------------------------------------
import { vorschlagOrteAufloesen } from '../../fahrer/supabase/functions/dispo-admin/ortSuche.ts';
const mitGoogle = async (antwort: (u: URL) => Response | Promise<Response>, f: () => Promise<void>) => {
  const alt = globalThis.fetch;
  globalThis.fetch = (async (url: any) => antwort(new URL(String(url?.url ?? url)))) as typeof fetch;
  try { await f(); } finally { globalThis.fetch = alt; }
};
const json = (x: unknown, status = 200) => new Response(JSON.stringify(x), { status });

Deno.test('Fertige Adresse: wird geprueft, Googles Schreibweise, falsche Hausnummer heisst nachfragen', () => mitGoogle(
  () => json({ predictions: [{ description: 'Frühlingstraße 24, 82152 Krailling, Deutschland', distance_meters: 14000, place_id: 'k' }] }),
  async () => {
    let e = await ortAufloesen(db(), 'Frühlingstr. 24, 82152 Krailling', [], ID.dispo, MUENCHEN);
    assertEquals(e.text, 'Frühlingstraße 24, 82152 Krailling, Deutschland');
    e = await ortAufloesen(db(), 'Frühlingstr. 42, 82152 Krailling', [], ID.dispo, MUENCHEN);
    assert(e.unsicher, JSON.stringify(e));
  }));

Deno.test('Google faellt aus: volle Adresse bleibt, alles andere wird nachgefragt', () => mitGoogle(
  () => { throw new TypeError('Netz weg'); },
  async () => {
    const voll = await ortAufloesen(db(), 'Frühlingstr. 26, 82152 Krailling', [], ID.dispo, MUENCHEN);
    assertEquals([voll.text, voll.unsicher], ['Frühlingstr. 26, 82152 Krailling', undefined]);
    const kurz = await ortAufloesen(db(), 'Sommerstr', [], ID.dispo, MUENCHEN);
    assertEquals([kurz.unsicher, kurz.nichtPruefbar], [[], true]);
  }));

Deno.test('Ziel wird um den Start gesucht (von Reutlingen zum Hauptbahnhof)', () => {
  const origins: string[] = [];
  return mitGoogle((u) => {
    if (u.pathname.endsWith('/details/json')) return json({ result: { geometry: { location: { lat: 48.49, lng: 9.21 } } } });
    origins.push(u.searchParams.get('origin') || '');
    const ein = (u.searchParams.get('input') || '').toLowerCase();
    if (ein.includes('ottilien')) return json({ predictions: [{ description: 'Ottilienstraße 2, Reutlingen, Deutschland', distance_meters: 180000, place_id: 'r' }] });
    const vonReutlingen = (u.searchParams.get('origin') || '').startsWith('48.49');
    return json({ predictions: [
      { description: 'Hauptbahnhof, Bahnhofplatz, Reutlingen, Deutschland', distance_meters: vonReutlingen ? 900 : 181000 },
      { description: 'Hauptbahnhof, Bahnhofplatz, München, Deutschland', distance_meters: vonReutlingen ? 180000 : 20000 },
    ] });
  }, async () => {
    // Ohne eigene Orte: ein eigener Ort "Hauptbahnhof München" haette Vorrang.
    const d = db();
    d.tabellen.orte = [];
    const r: any = await vorschlagOrteAufloesen(d, { start: 'Ottilienstraße 2 in Reutlingen', ziel: 'Hauptbahnhof' }, ID.dispo, MUENCHEN);
    assertEquals(r.ziel, 'Hauptbahnhof, Bahnhofplatz, Reutlingen, Deutschland');
    assert(origins[1].startsWith('48.49'), origins.join(' / '));
  });
});
