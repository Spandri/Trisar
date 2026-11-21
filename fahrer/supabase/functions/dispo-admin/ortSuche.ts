// Start und Ziel eines Buchungsvorschlags des KI-Assistenten aufloesen, bevor er an die App geht.
//   1. Eigener Ort (Tabelle orte, Karten Filter): "Kongress" -> Ort "Kongress am Park" mit ID und Adresse.
//      Die Apps speichern dann pickup_ort_id und die Adresse des Orts, wie bei Auswahl im Formular.
//   2. Sonst Adresssuche wie im Formular (Google Places, D/A/CH, feste Flughaefen zuerst):
//      "Salzburg Flughafen" -> "Salzburg Airport W. A. Mozart (SZG), Innsbrucker Bundesstraße, Salzburg, Österreich".
//   3. Ohne Schluessel bleibt der Text, wie er war. Unpassende oder keine Treffer: Auswahl in der App
//      (ortWahl.ts, 18.11.). Mehrere passende: der naechste zum Standort der Dispo, die anderen fuer die
//      Korrektur im Chat (ortKorrektur.ts, 19.11.).
// Ist der Text schon eine Adresse mit Postleitzahl oder Hausnummer, wird nicht gesucht.

// deno-lint-ignore-file no-explicit-any
import { providerConfig } from '../_shared/provider-config.ts';
import { recordUsageWithCost } from '../_shared/usage-tracking.ts';
import { flughafenVorschlaege } from '../_shared/flughafen-vorschlaege.ts';

export type Ort = { id: string; name: string; adresse: string | null; lat?: number | null; lng?: number | null };
export type OrtErgebnis = { text: string; ortId: string; adresse: string };

const FUELL = new Set(['am', 'an', 'der', 'die', 'das', 'den', 'dem', 'des', 'im', 'in', 'zum', 'zur', 'und', 'bei', 'von', 'vom', 'the']);

const normal = (t: string) => String(t || '').toLowerCase()
  .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
const stamm = (t: string) => normal(t).split(' ').filter((w) => w.length >= 2 && !FUELL.has(w));

// Woerter, die allein nichts ueber den Ort sagen (fuer den Abgleich Suchtext gegen Treffer).
const ALLGEMEIN = new Set(['hotel', 'flughafen', 'airport', 'bahnhof', 'hauptbahnhof', 'messe', 'terminal', 'restaurant', 'strasse', 'platz', 'zeit', 'einer', 'einem', 'eine', 'unbestimmten']);

const enthaeltAlle = (gross: string[], klein: string[]) => klein.length > 0 && klein.every((w) => gross.includes(w));

// Eigener Ort zum Text: gleicher Name, Name ganz im Text ("Kongress am Park Augsburg"), Text ganz im Namen
// ("Kongress") oder gleiche Adresse. Nur bei genau einem Treffer, bei mehreren nur der mit gleichem Namen.
export const eigenerOrt = (text: string, orte: Ort[]): Ort | null => {
  const t = stamm(text);
  if (!t.length) return null;
  const tn = normal(text);
  const gleich = orte.filter((o) => normal(o.name) === tn || (o.adresse && normal(o.adresse) === tn));
  if (gleich.length === 1) return gleich[0];
  const passend = orte.filter((o) => {
    const n = stamm(o.name);
    return n.length > 0 && (enthaeltAlle(t, n) || enthaeltAlle(n, t));
  });
  if (passend.length === 1) return passend[0];
  const genau = passend.filter((o) => {
    const n = stamm(o.name);
    return n.length === t.length && enthaeltAlle(n, t);
  });
  return genau.length === 1 ? genau[0] : null;
};

// Sieht schon nach fertiger Adresse aus: Postleitzahl, oder Strasse mit Hausnummer und Komma.
// Oder schon ein Suchtreffer ("..., Salzburg, Österreich").
const istAdresse = (text: string) => /\b\d{4,5}\b/.test(text) || (/,/.test(text) && /\b\d{1,4}[a-z]?\b/i.test(text))
  || /,\s*(Deutschland|Österreich|Oesterreich|Schweiz|Germany|Austria|Switzerland)\s*$/i.test(text);

const suchCache = new Map<string, { wert: OrtOption[]; zeit: number }>();

// Gegend der Flotte: Mitte (Median) der letzten Fahrer-Standorte, sonst der eigenen Orte. Die Adresssuche
// bevorzugt Treffer dort (16.11.: "Hotel Andaz" ohne Stadt wurde das Andaz in Wien statt das in München).
// Kein hartes Limit, Orte mit Stadt im Text ("Hotel Sacher Wien") werden weiter gefunden.
type Punkt = { lat: number; lng: number };
const mittelpunkt = (punkte: any[]): Punkt | null => {
  const mit = punkte.filter((o) => o?.lat != null && o?.lng != null && Number.isFinite(Number(o.lat)) && Number.isFinite(Number(o.lng)));
  if (mit.length < 3) return null;
  const mitte = (werte: number[]) => [...werte].sort((a, b) => a - b)[Math.floor(werte.length / 2)];
  return { lat: mitte(mit.map((o) => Number(o.lat))), lng: mitte(mit.map((o) => Number(o.lng))) };
};
let gegendMerk: { wert: Punkt | null; zeit: number } | null = null;
export const flottenGegend = async (admin: any, orte: Ort[]): Promise<Punkt | null> => {
  if (gegendMerk && Date.now() - gegendMerk.zeit < 3600_000) return gegendMerk.wert;
  let wert: Punkt | null = null;
  try {
    const seit = new Date(Date.now() - 30 * 86400_000).toISOString();
    const { data } = await admin.from('driver_live_locations').select('lat, lng').gte('captured_at', seit).limit(500);
    wert = mittelpunkt(Array.isArray(data) ? data : []);
  } catch { /* ohne Standorte: eigene Orte */ }
  wert = wert || mittelpunkt(orte);
  gegendMerk = { wert, zeit: Date.now() };
  return wert;
};

// Ein Treffer der Adresssuche: ganzer Text (wird gespeichert), Name und Zeile darunter fuer die Auswahl in der App.
// distanzM (19.11.): Entfernung zum Bezugspunkt (Dispo), wenn bekannt.
export type OrtOption = { wert: string; titel: string; zeile: string; distanzM?: number | null; placeId?: string };
export type { Punkt };

// Bezugspunkt fuer die Suche (19.11.): Standort der Dispo aus dispo_standort (schreiben die Apps, solange sie ihn
// ohnehin holen), sonst der Ort aus "Ankünfte bei mir" (dispo_ankunft_melden), sonst die Mitte der Flotte.
// So kommt bei "Frühlingstr" erst die in München, dann Augsburg, dann Berlin. mitgeschickt: falls ein Aufruf
// selbst einen Punkt mitgibt, gilt der zuerst.
export const punktOk = (p: any): Punkt | null => {
  const lat = Number(p?.lat);
  const lng = Number(p?.lng ?? p?.lon);
  return p && Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0) ? { lat, lng } : null;
};
export const bezugspunkt = async (admin: any, dispoId: string | null, mitgeschickt: unknown, orte: Ort[]): Promise<Punkt | null> => {
  const app = punktOk(mitgeschickt);
  if (app) return app;
  if (dispoId) {
    for (const tabelle of ['dispo_standort', 'dispo_ankunft_melden']) {
      try {
        const { data } = await admin.from(tabelle).select('lat, lng').eq('user_id', dispoId).maybeSingle();
        const p = punktOk(data);
        if (p) return p;
      } catch { /* naechste Quelle */ }
    }
  }
  return flottenGegend(admin, orte);
};

// Liefert bis zu 5 Treffer. null: keine Suche moeglich (kein Schluessel, Fehler), dann bleibt der Text, wie er war.
// null: keine Suche moeglich (kein Schluessel, Google lehnt ab, z. B. Testsatz). 'ausfall' (19.11.): Google antwortet
// nicht oder mit Serverfehler. Dann wird nicht still der getippte Text genommen (ortAufloesen).
export const adresseSuchen = async (admin: any, text: string, dispoId: string | null, nahe: Punkt | null = null): Promise<OrtOption[] | null | 'ausfall'> => {
  const schluessel = String(Deno.env.get(providerConfig.googlePlaces.envKey) || '').trim();
  if (!schluessel) return null;
  const k = `${normal(text)}|${nahe ? `${nahe.lat.toFixed(2)},${nahe.lng.toFixed(2)}` : ''}`;
  const alt = suchCache.get(k);
  if (alt && Date.now() - alt.zeit < 6 * 3600_000) return alt.wert;
  const url = new URL(providerConfig.googlePlaces.url);
  url.searchParams.set('input', text);
  url.searchParams.set('components', 'country:de|country:at|country:ch');
  url.searchParams.set('language', 'de');
  if (nahe) {
    url.searchParams.set('location', `${nahe.lat.toFixed(4)},${nahe.lng.toFixed(4)}`);
    url.searchParams.set('radius', '80000');
    // origin liefert je Treffer distance_meters, danach wird sortiert (naechster zuerst).
    url.searchParams.set('origin', `${nahe.lat.toFixed(5)},${nahe.lng.toFixed(5)}`);
  }
  url.searchParams.set('key', schluessel);
  try {
    const antwort = await fetch(url.toString(), { signal: AbortSignal.timeout(5000) });
    const daten = await antwort.json().catch(() => ({}));
    await recordUsageWithCost(admin, {
      provider: 'google-places', action: 'places_lookup', reason: 'ki_assistent', cache_hit: false,
      requested_by: dispoId, http_status: antwort.status,
      error_text: antwort.ok ? null : (daten?.error_message || 'Google Places request failed'), units: 1, unit_name: 'request',
    }).catch(() => null);
    if (antwort.status >= 500) return 'ausfall';
    if (!antwort.ok || !Array.isArray(daten?.predictions)) return null;
    const liste: OrtOption[] = daten.predictions.slice(0, 5).map((p: any) => {
      const wert = String(p?.description || '').trim();
      const titel = String(p?.structured_formatting?.main_text || wert.split(',')[0] || '').trim();
      const zeile = String(p?.structured_formatting?.secondary_text || wert.split(',').slice(1).join(',') || '').trim().replace(/,\s*(Deutschland|Österreich|Schweiz)$/, '');
      const d = Number(p?.distance_meters);
      return { wert, titel, zeile, distanzM: Number.isFinite(d) ? d : null, ...(p?.place_id ? { placeId: String(p.place_id) } : {}) };
    }).filter((o: OrtOption) => o.wert);
    suchCache.set(k, { wert: liste, zeit: Date.now() });
    return liste;
  } catch {
    return 'ausfall';
  }
};

// Google Place Details zu einem Treffer (19.11. Koordinaten, 20.11. auch die ganze Anschrift).
// Eine Abfrage je Treffer, gemerkt je place_id.
type Details = { punkt: Punkt | null; anschrift: string };
const detailCache = new Map<string, Details>();
const placeDetails = async (admin: any, id: string, dispoId: string | null): Promise<Details | null> => {
  const schluessel = String(Deno.env.get(providerConfig.googlePlaces.envKey) || '').trim();
  if (!id || !schluessel) return null;
  if (detailCache.has(id)) return detailCache.get(id)!;
  try {
    const url = new URL('https://maps.googleapis.com/maps/api/place/details/json');
    url.searchParams.set('place_id', id);
    url.searchParams.set('fields', 'geometry,formatted_address');
    url.searchParams.set('language', 'de');
    url.searchParams.set('key', schluessel);
    const antwort = await fetch(url.toString(), { signal: AbortSignal.timeout(4000) });
    const daten = await antwort.json().catch(() => ({}));
    await recordUsageWithCost(admin, {
      provider: 'google-places', action: 'place_details', reason: 'ki_assistent', cache_hit: false,
      requested_by: dispoId, http_status: antwort.status, error_text: antwort.ok ? null : 'Google Place Details failed', units: 1, unit_name: 'request',
    }).catch(() => null);
    if (!antwort.ok || daten?.status !== 'OK') return null;
    const l = daten?.result?.geometry?.location;
    const d: Details = {
      punkt: punktOk({ lat: l?.lat, lng: l?.lng }),
      anschrift: String(daten?.result?.formatted_address || '').trim().replace(/,\s*(Deutschland|Germany)$/i, ''),
    };
    detailCache.set(id, d);
    return d;
  } catch {
    return null;
  }
};

// Koordinaten eines Ergebnisses: eigener Ort aus orte, sonst Google Place Details.
// Damit wird das Ziel um den Start gesucht ("von Reutlingen zum Hauptbahnhof" ist Reutlingen Hbf).
export const ortPunkt = async (admin: any, e: { ortId?: string; placeId?: string }, orte: Ort[], dispoId: string | null): Promise<Punkt | null> => {
  if (e.ortId) {
    const o = orte.find((x) => x.id === e.ortId);
    return punktOk(o);
  }
  return (await placeDetails(admin, String(e.placeId || ''), dispoId))?.punkt ?? null;
};

// Ganze Anschrift eines Google-Treffers (20.11.): Autocomplete liefert "Wöllinger Wirtshaus, Johann-Clanze-Straße,
// München, Deutschland" ohne Hausnummer und PLZ, Karte und Route lagen dann auf der Strassenmitte. Gespeichert wird
// "Wöllinger Wirtshaus, Johann-Clanze-Straße 112, 81369 München". Ohne Details bleibt der Text, wie er war.
export const anschriftVoll = async (admin: any, o: { wert: string; titel?: string; placeId?: string }, dispoId: string | null): Promise<string> => {
  const d = o.placeId ? await placeDetails(admin, o.placeId, dispoId) : null;
  if (!d?.anschrift) return o.wert;
  const name = String(o.titel || '').trim();
  const strasse = d.anschrift.split(',')[0].trim();
  const mitName = name && !normal(d.anschrift).includes(normal(name)) && !normal(name).startsWith(normal(strasse));
  return mitName ? `${name}, ${d.anschrift}` : d.anschrift;
};

// Hausnummer im Text ("Franz Josef Straße 48"), Postleitzahlen zaehlen nicht.
const hausnummer = (t: string) => String(t || '').match(/\b(\d{1,4}\s?[a-z]?)\b(?!\d)/i)?.[1]?.replace(/\s/g, '').toLowerCase() || '';

// Ort aufloesen. unsicher (18.11.): mehrere passende Treffer, Treffer mit anderer Hausnummer, kein passender oder gar
// kein Treffer. Dann waehlt der Disponent (Auswahl in der App), statt dass still der erste Treffer genommen wird
// (14:32 wurde aus "Avalon Emil Frey Frankfurter Ring" das Volvo-Haus in der Moosacher Strasse).
// Ort aufloesen (19.11.): Suche um den Bezugspunkt (Dispo), auch bei einem einzelnen Wort ("Frühlingstr").
// Passende Treffer nach Entfernung. Ist der naechste eindeutig (siehe unten), gilt er direkt und die uebrigen kommen
// als alternativen zurueck. Sagt die Dispo danach "ich meinte die in Augsburg", tauscht ortKorrektur.ts darauf.
// Sonst unsicher: Auswahl in der App (ortWahl.ts), naechster oben. Kein Treffer: unsicher mit leerer Liste
// ("finde ich nicht"), nie still der getippte Text.
export const ortAufloesen = async (admin: any, text: string, orte: Ort[], dispoId: string | null = null, nahe: Punkt | null = null): Promise<OrtErgebnis & { unsicher?: OrtOption[]; alternativen?: OrtOption[]; placeId?: string; nichtPruefbar?: boolean }> => {
  const roh = String(text || '').trim();
  if (!roh) return { text: roh, ortId: '', adresse: '' };
  const eigen = eigenerOrt(roh, orte);
  if (eigen) return { text: eigen.name, ortId: eigen.id, adresse: String(eigen.adresse || '') };
  // Feste Flughafen-Texte vor allem anderen, auch einzeln ("GAT", 18.11.).
  const fest = flughafenVorschlaege(roh);
  if (fest.length) return { text: fest[0].description, ortId: '', adresse: '' };
  // Auch eine fertig getippte Adresse wird gegen die Suche geprueft (19.11.): Tippfehler, falsche Hausnummer oder
  // falscher Ort fuehren zur Auswahl, ein eindeutiger Treffer ersetzt den Text in Googles Schreibweise.
  const fertig = istAdresse(roh);
  const punkt = nahe ?? await flottenGegend(admin, orte);
  const liste = await adresseSuchen(admin, roh, dispoId, punkt);
  // Keine Suche moeglich (kein Schluessel, Google lehnt ab): Text bleibt, die Karte zeigt ihn zum Pruefen.
  if (liste === null) return { text: roh, ortId: '', adresse: '' };
  // Google faellt aus (19.11.): eine vollstaendige Adresse mit Postleitzahl bleibt ungeprueft, alles andere wird
  // nachgefragt, nie still der getippte Text.
  if (liste === 'ausfall') return fertig ? { text: roh, ortId: '', adresse: '' } : { text: roh, ortId: '', adresse: '', unsicher: [], nichtPruefbar: true };
  // Der Treffer muss zum Text passen (16.11.): aus dem Satzrest "einer unbestimmten Zeit zum Hotel Andaz" machte die
  // Suche ein Hotel in Wien. Passen heisst ein gemeinsames Wort und, wenn im Text eine steht, dieselbe Hausnummer.
  const worte = stamm(roh).filter((w) => w.length >= 4 && !ALLGEMEIN.has(w));
  const nr = hausnummer(roh);
  const nachNaehe = (a: OrtOption, b: OrtOption) => (a.distanzM ?? Infinity) - (b.distanzM ?? Infinity);
  // Wie viele Woerter des Texts im Treffer stehen, Tippfehler zaehlen nicht ("otiilienstrasse" ist die Ottilienstraße).
  // Nennt der Text auch den Ort ("otiilienstrasse 2 in Reutlingen"), schlagen Treffer mit Strasse UND Ort die naeheren
  // mit nur der Strasse (19.11.: sonst wurde es Weißenhorn, weil naeher). Erst danach entscheidet die Entfernung.
  // Gleich klingende Schreibweisen angleichen (Josef/Joseph, Mayer/Meier).
  const klang = (x: string) => x.replace(/ph/g, 'f').replace(/th/g, 't').replace(/ai/g, 'ei').replace(/y/g, 'i').replace(/(.)\1/g, '$1');
  // Gezaehlt werden auch allgemeine Woerter ("Hauptbahnhof", "Messe"): sonst passte zu "Hauptbahnhof in München"
  // jeder Münchner Treffer gleich gut, auch das Lokal "Servus Habibi" (19.11.).
  const zaehlWorte = stamm(roh).filter((w) => w.length >= 4);
  const treffend = (o: OrtOption) => {
    const t = klang(normal(o.wert));
    const woerterT = t.split(' ');
    return zaehlWorte.map(klang).filter((w) => t.includes(w) || t.includes(w.slice(0, 5))
      || woerterT.some((x) => x.length >= 4 && abstand(w, x) <= Math.max(1, Math.floor(Math.min(w.length, x.length) / 6)))).length;
  };
  const kandidaten = liste.filter((o) => !nr || ` ${normal(o.wert)} `.includes(` ${nr} `)).map((o) => ({ o, n: treffend(o) }));
  const bestes = Math.max(0, ...kandidaten.map((k) => k.n));
  const passend = (zaehlWorte.length ? kandidaten.filter((k) => k.n === bestes && bestes > 0) : kandidaten).map((k) => k.o).sort(nachNaehe);
  // Direkt nehmen nur, wenn es eindeutig ist (19.11., User: "bei Unsicherheit MUSS er nachfragen"): ein einziger
  // passender Treffer, oder der naechste liegt hoechstens 50 km von der Dispo und der zweitnaechste mindestens doppelt
  // so weit und mindestens 20 km weiter. Sonst Auswahl, nach Naehe sortiert.
  const [a, b] = passend;
  // Alle passenden praktisch am selben Fleck (Hauptbahnhof, Hauptbahnhof S/U, Bahnhofplatz): ein Ort, der naechste gilt.
  const selberFleck = passend.length > 1 && passend.every((o) => o.distanzM != null)
    && Math.max(...passend.map((o) => o.distanzM!)) - Math.min(...passend.map((o) => o.distanzM!)) <= 1_000;
  const eindeutig = passend.length === 1 || selberFleck || (a?.distanzM != null && b?.distanzM != null
    && a.distanzM <= 50_000 && b.distanzM >= 2 * a.distanzM && b.distanzM - a.distanzM >= 20_000);
  if (eindeutig) {
    const andere = [...passend.slice(1), ...liste.filter((o) => !passend.includes(o)).sort(nachNaehe)].slice(0, 5);
    return { text: await anschriftVoll(admin, passend[0], dispoId), ortId: '', adresse: '', ...(passend[0].placeId ? { placeId: passend[0].placeId } : {}), ...(andere.length ? { alternativen: andere } : {}) };
  }
  // Auswahl ebenfalls nach Naehe, der naechste oben.
  return { text: roh, ortId: '', adresse: '', unsicher: (passend.length ? passend : [...liste].sort(nachNaehe)).slice(0, 3) };
};

// Tippfehler-Abstand zweier Woerter (Einfuegen, Loeschen, Ersetzen).
const abstand = (a: string, b: string) => {
  if (a === b) return 0;
  const z = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    let vorher = z[0];
    z[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const merk = z[j];
      z[j] = Math.min(z[j] + 1, z[j - 1] + 1, vorher + (a[i - 1] === b[j - 1] ? 0 : 1));
      vorher = merk;
    }
  }
  return z[b.length];
};
export const orteLaden = async (admin: any): Promise<Ort[]> => {
  const { data, error } = await admin.from('orte').select('id, name, adresse, lat, lng').limit(1000);
  return error || !Array.isArray(data) ? [] : data.map((o: any) => ({ id: String(o.id), name: String(o.name || ''), adresse: o.adresse ?? null, lat: o.lat ?? null, lng: o.lng ?? null }));
};

// Buchungsvorschlag (vorschlagVereinheitlichen in ki.ts): Start und Ziel aufloesen. Bei Aenderungen nur
// die geaenderten Felder. Immer neu, auch mit Ort-ID: der offene Vorschlag kommt aus der App zurueck und
// das Modell kann Start oder Ziel dabei geaendert haben.
export const vorschlagOrteAufloesen = async (admin: any, v: any, dispoId: string | null = null, standort: unknown = null) => {
  const geaendert: string[] = Array.isArray(v?.geaendert) ? v.geaendert : [];
  const felder = (['start', 'ziel'] as const).filter((f) => v?.[f] && (!v?.fahrtId || geaendert.includes(f)));
  if (!felder.length) return v;
  const orte = await orteLaden(admin);
  const neu = { ...v };
  // Unsichere Orte (18.11.): Feld, getippter Text und Auswahl. ki.ts fragt dann nach, statt zu buchen.
  const unsicher: Array<{ feld: 'start' | 'ziel'; text: string; optionen: OrtOption[]; grund?: string }> = [];
  const alternativen: Record<string, { text: string; optionen: OrtOption[] }> = {};
  const nahe = await bezugspunkt(admin, dispoId, standort, orte);
  // Erst der Start, dann das Ziel um den Start (19.11.): "von Reutlingen zum Hauptbahnhof" sucht den Bahnhof in
  // Reutlingen zuerst. Ohne Koordinaten vom Start gilt der Standort der Dispo.
  let umStart: Punkt | null = null;
  for (const f of felder) {
    const e = await ortAufloesen(admin, v[f], orte, dispoId, f === 'ziel' && umStart ? umStart : nahe);
    if (e.alternativen?.length) alternativen[f] = { text: String(v[f]), optionen: e.alternativen };
    neu[f] = e.text;
    neu[`${f}OrtId`] = e.ortId;
    neu[`${f}Adresse`] = e.adresse;
    if (e.unsicher) unsicher.push({ feld: f, text: String(v[f]), optionen: e.unsicher, ...(e.nichtPruefbar ? { grund: 'nicht_pruefbar' } : {}) });
    else if (f === 'start') umStart = await ortPunkt(admin, e, orte, dispoId);
  }
  unsicher.sort((a, b) => (a.feld === 'start' ? -1 : 1) - (b.feld === 'start' ? -1 : 1));
  if (unsicher.length) Object.defineProperty(neu, 'ortUnsicher', { value: unsicher, enumerable: false });
  if (Object.keys(alternativen).length) Object.defineProperty(neu, 'ortAlternativen', { value: alternativen, enumerable: false });
  return neu;
};
