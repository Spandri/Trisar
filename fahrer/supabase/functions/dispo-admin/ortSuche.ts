// Start und Ziel eines Buchungsvorschlags des KI-Assistenten aufloesen, bevor er an die App geht.
//   1. Eigener Ort (Tabelle orte, Karten Filter): "Kongress" -> Ort "Kongress am Park" mit ID und Adresse.
//      Die Apps speichern dann pickup_ort_id und die Adresse des Orts, wie bei Auswahl im Formular.
//   2. Sonst Adresssuche wie im Formular (Google Places, D/A/CH, feste Flughaefen zuerst):
//      "Salzburg Flughafen" -> "Salzburg Airport W. A. Mozart (SZG), Innsbrucker Bundesstraße, Salzburg, Österreich".
//   3. Ohne Treffer oder ohne Schluessel bleibt der Text, wie er war.
// Ist der Text schon eine Adresse mit Postleitzahl oder Hausnummer, wird nicht gesucht.

// deno-lint-ignore-file no-explicit-any
import { providerConfig } from '../_shared/provider-config.ts';
import { recordUsageWithCost } from '../_shared/usage-tracking.ts';
import { flughafenVorschlaege } from '../_shared/flughafen-vorschlaege.ts';

export type Ort = { id: string; name: string; adresse: string | null };
export type OrtErgebnis = { text: string; ortId: string; adresse: string };

const FUELL = new Set(['am', 'an', 'der', 'die', 'das', 'den', 'dem', 'des', 'im', 'in', 'zum', 'zur', 'und', 'bei', 'von', 'vom', 'the']);

const normal = (t: string) => String(t || '').toLowerCase()
  .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
const stamm = (t: string) => normal(t).split(' ').filter((w) => w.length >= 2 && !FUELL.has(w));

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

const suchCache = new Map<string, { wert: string; zeit: number }>();

const adresseSuchen = async (admin: any, text: string, dispoId: string | null): Promise<string> => {
  const feste = flughafenVorschlaege(text);
  if (feste.length) return feste[0].description;
  const schluessel = String(Deno.env.get(providerConfig.googlePlaces.envKey) || '').trim();
  if (!schluessel) return '';
  const k = normal(text);
  const alt = suchCache.get(k);
  if (alt && Date.now() - alt.zeit < 6 * 3600_000) return alt.wert;
  const url = new URL(providerConfig.googlePlaces.url);
  url.searchParams.set('input', text);
  url.searchParams.set('components', 'country:de|country:at|country:ch');
  url.searchParams.set('language', 'de');
  url.searchParams.set('key', schluessel);
  try {
    const antwort = await fetch(url.toString(), { signal: AbortSignal.timeout(5000) });
    const daten = await antwort.json().catch(() => ({}));
    await recordUsageWithCost(admin, {
      provider: 'google-places', action: 'places_lookup', reason: 'ki_assistent', cache_hit: false,
      requested_by: dispoId, http_status: antwort.status,
      error_text: antwort.ok ? null : (daten?.error_message || 'Google Places request failed'), units: 1, unit_name: 'request',
    }).catch(() => null);
    const erster = Array.isArray(daten?.predictions) ? String(daten.predictions[0]?.description || '') : '';
    suchCache.set(k, { wert: erster, zeit: Date.now() });
    return erster;
  } catch {
    return '';
  }
};

export const ortAufloesen = async (admin: any, text: string, orte: Ort[], dispoId: string | null = null): Promise<OrtErgebnis> => {
  const roh = String(text || '').trim();
  if (!roh) return { text: roh, ortId: '', adresse: '' };
  const eigen = eigenerOrt(roh, orte);
  if (eigen) return { text: eigen.name, ortId: eigen.id, adresse: String(eigen.adresse || '') };
  // Einzelne Woerter ("Messe", "Flughafen") sind ohne Stadt zu ungenau fuer die Suche.
  if (istAdresse(roh) || stamm(roh).length < 2) return { text: roh, ortId: '', adresse: '' };
  const gefunden = await adresseSuchen(admin, roh, dispoId);
  return { text: gefunden || roh, ortId: '', adresse: '' };
};

export const orteLaden = async (admin: any): Promise<Ort[]> => {
  const { data, error } = await admin.from('orte').select('id, name, adresse').limit(1000);
  return error || !Array.isArray(data) ? [] : data.map((o: any) => ({ id: String(o.id), name: String(o.name || ''), adresse: o.adresse ?? null }));
};

// Buchungsvorschlag (vorschlagVereinheitlichen in ki.ts): Start und Ziel aufloesen. Bei Aenderungen nur
// die geaenderten Felder. Immer neu, auch mit Ort-ID: der offene Vorschlag kommt aus der App zurueck und
// das Modell kann Start oder Ziel dabei geaendert haben.
export const vorschlagOrteAufloesen = async (admin: any, v: any, dispoId: string | null = null) => {
  const geaendert: string[] = Array.isArray(v?.geaendert) ? v.geaendert : [];
  const felder = (['start', 'ziel'] as const).filter((f) => v?.[f] && (!v?.fahrtId || geaendert.includes(f)));
  if (!felder.length) return v;
  const orte = await orteLaden(admin);
  const neu = { ...v };
  await Promise.all(felder.map(async (f) => {
    const e = await ortAufloesen(admin, v[f], orte, dispoId);
    neu[f] = e.text;
    neu[`${f}OrtId`] = e.ortId;
    neu[`${f}Adresse`] = e.adresse;
  }));
  return neu;
};
