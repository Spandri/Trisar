import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// TomTom statt Google fuer Fahrzeiten (Routing mit Live-Verkehr) und Adress-Koordinaten.
// Die Apps lesen nur Strecke, Dauer und eine Linie im Google-Polyline-Format. Deshalb
// wird die TomTom-Linie hier in dieses Format umgerechnet und die Apps bleiben unveraendert.

type AdminClient = ReturnType<typeof createClient>;

export const TOMTOM_PROVIDER = 'tomtom';
const GEOCODE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
// Mitte Muenchen: Suchergebnisse in der Naehe werden bevorzugt.
const MUC = { lat: 48.137, lon: 11.575 };

let schluesselCache: { wert: string; zeit: number } | null = null;

// Schluessel aus der Umgebung, sonst aus integration_settings (nur service_role liest dort).
export const tomtomSchluessel = async (admin: AdminClient): Promise<string> => {
  const env = String(Deno.env.get('TOMTOM_ROUTING_SERVER_KEY') || '').trim();
  if (env) return env;
  if (schluesselCache && Date.now() - schluesselCache.zeit < 5 * 60_000) return schluesselCache.wert;
  const { data } = await admin.from('integration_settings').select('value').eq('key', 'tomtom_routing_key').maybeSingle();
  const wert = typeof data?.value === 'string' ? data.value.trim() : '';
  schluesselCache = { wert, zeit: Date.now() };
  return wert;
};

const sha256 = async (input: string) => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
};

// Google-Polyline-Kodierung (Genauigkeit 1e5), wie decodeGooglePolyline in den Apps.
export const kodierePolyline = (punkte: Array<{ lat: number; lng: number }>) => {
  let letzteLat = 0;
  let letzteLng = 0;
  let text = '';
  const wert = (v: number) => {
    let s = v < 0 ? ~(v << 1) : v << 1;
    let teil = '';
    while (s >= 0x20) {
      teil += String.fromCharCode((0x20 | (s & 0x1f)) + 63);
      s >>= 5;
    }
    return teil + String.fromCharCode(s + 63);
  };
  for (const p of punkte) {
    const lat = Math.round(p.lat * 1e5);
    const lng = Math.round(p.lng * 1e5);
    text += wert(lat - letzteLat) + wert(lng - letzteLng);
    letzteLat = lat;
    letzteLng = lng;
  }
  return text;
};

const koordinatenAusText = (text: string) => {
  const m = /^\s*(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)\s*$/.exec(text);
  return m ? { lat: Number(m[1]), lon: Number(m[2]) } : null;
};

// Flughaefen fest: TomTom macht aus "MUC Terminal 2" sonst einen Ort bei Altoetting.
// Terminal-Vorfahrten, geprueft auf der Karte.
// Flughaefen fest: TomTom macht aus "MUC Terminal 2" sonst einen Ort bei Altoetting.
// Kuerzel nur in Grossbuchstaben ("STR" ja, "Str." als Strasse nein), Namen ohne Gross/klein.
const FLUGHAEFEN: Array<{ kuerzel: string; name: RegExp; lat: number; lon: number; t1?: { lat: number; lon: number } }> = [
  { kuerzel: 'MUC', name: /flughafen m(ü|ue)nchen|munich airport|franz[- ]josef[- ]strau(ß|ss)/i, lat: 48.35337, lon: 11.78606,
    t1: { lat: 48.35345, lon: 11.78175 } },
  { kuerzel: 'FRA', name: /flughafen frankfurt|frankfurt airport/i, lat: 50.05073, lon: 8.57062 },
  { kuerzel: 'NUE', name: /flughafen n(ü|ue)rnberg|nuremberg airport/i, lat: 49.49868, lon: 11.06694 },
  { kuerzel: 'STR', name: /flughafen stuttgart|stuttgart airport/i, lat: 48.69004, lon: 9.19214 },
  { kuerzel: 'BER', name: /flughafen berlin|berlin brandenburg airport/i, lat: 52.36484, lon: 13.51007 },
  { kuerzel: 'FMM', name: /flughafen memmingen|memmingen airport|allg(ä|ae)u airport/i, lat: 47.98880, lon: 10.23950 },
];

const flughafen = (adresse: string) => {
  // Kuerzel klein geschrieben nur zusammen mit Terminal/Flughafen/Airport ("muc terminal 2").
  const mitHinweis = /terminal|flughafen|airport|\bt\s*[12]\b/i.test(adresse);
  const f = FLUGHAEFEN.find((x) => new RegExp(`\\b${x.kuerzel}\\b`, mitHinweis ? 'i' : '').test(adresse) || x.name.test(adresse));
  if (!f) return null;
  if (f.t1 && /\b(terminal|t)\s*1\b/i.test(adresse)) return { ...f.t1 };
  return { lat: f.lat, lon: f.lon };
};

// Eigener Ort der Dispo (Tabelle orte, gleiche Regel wie die automatische Zuordnung in der DB).
const eigenerOrt = async (admin: AdminClient, adresse: string) => {
  const { data: id } = await admin.rpc('trisar_ort_finden', { p_adresse: adresse, p_lat: null, p_lng: null });
  let ortId = typeof id === 'string' ? id : null;
  if (!ortId) {
    const { data: perName } = await admin.from('orte').select('id').ilike('name', adresse.trim()).limit(1).maybeSingle();
    ortId = perName?.id || null;
  }
  if (!ortId) return null;
  const { data: ort } = await admin.from('orte').select('lat, lng').eq('id', ortId).maybeSingle();
  const lat = Number(ort?.lat);
  const lon = Number(ort?.lng);
  return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
};

type Punkt = { lat: number; lon: number };

// Suchradius um die anderen Punkte der Fahrt, wenn eine Adresse keine Stadt nennt.
const ANKER_RADIUS_M = 60000;

const luftlinieKm = (a: Punkt, b: Punkt) => {
  const r = Math.PI / 180;
  const x = (b.lon - a.lon) * r * Math.cos(((a.lat + b.lat) / 2) * r);
  const y = (b.lat - a.lat) * r;
  return Math.sqrt(x * x + y * y) * 6371;
};

// Nennt die Adresse eine Stadt oder Postleitzahl? "Hotel X, Maximilianstr. 40" nicht:
// das fand die Suche in Muenchen statt in Augsburg (Einsatz 07.11., 57 km daneben).
export const hatStadt = (adresse: string) => {
  const text = adresse.trim();
  if (/\b\d{5}\b/.test(text)) return true;
  const teile = text.split(',').map((t) => t.trim()).filter(Boolean)
    .filter((t) => !/^(deutschland|germany|(ö|oe)sterreich|austria|schweiz|switzerland)$/i.test(t));
  if (teile.length < 2) return false;
  const letzter = teile[teile.length - 1];
  return !/\d/.test(letzter) && !/(str\.?|stra(ß|ss)e|weg|platz|allee|gasse|ring|damm|ufer)$/i.test(letzter);
};

// Sicher bekannte Punkte: Koordinaten im Text, eigener Ort, bekannter Flughafen.
const festerPunkt = async (admin: AdminClient, adresse: string): Promise<Punkt | null> => {
  const direkt = koordinatenAusText(adresse);
  if (direkt) return direkt;
  if (!adresse.trim()) return null;
  const ort = await eigenerOrt(admin, adresse).catch(() => null);
  if (ort) return ort;
  return flughafen(adresse);
};

// TomTom-Suche, 30 Tage in api_route_cache. Mit Anker nur im Umkreis des Ankers.
const tomtomSuche = async (
  admin: AdminClient,
  schluessel: string,
  adresse: string,
  anker: Punkt | null,
): Promise<Punkt | null> => {
  const norm = adresse.trim().toLowerCase();
  if (!norm) return null;
  const ankerTeil = anker ? `|${anker.lat.toFixed(1)},${anker.lon.toFixed(1)}` : '';
  const key = await sha256(`tomtom-geo|${norm}${ankerTeil}`);
  const { data: alt } = await admin
    .from('api_route_cache')
    .select('payload')
    .eq('route_key', key)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle();
  const lat0 = Number(alt?.payload?.lat);
  const lon0 = Number(alt?.payload?.lon);
  if (Number.isFinite(lat0) && Number.isFinite(lon0)) return { lat: lat0, lon: lon0 };

  const umkreis = anker
    ? `&lat=${anker.lat}&lon=${anker.lon}&radius=${ANKER_RADIUS_M}`
    : `&lat=${MUC.lat}&lon=${MUC.lon}`;
  for (const art of ['geocode', 'search']) {
    const url = `https://api.tomtom.com/search/2/${art}/${encodeURIComponent(adresse.trim())}.json`
      + `?key=${schluessel}&limit=1${umkreis}&countrySet=DE&language=de-DE`;
    const res = await fetch(url);
    if (!res.ok) continue;
    const json = await res.json().catch(() => ({}));
    const pos = json?.results?.[0]?.position;
    if (Number.isFinite(pos?.lat) && Number.isFinite(pos?.lon)) {
      await admin.from('api_route_cache').upsert([{
        route_key: key,
        provider: 'tomtom_geocode',
        origin_address: adresse.trim(),
        destination_address: '',
        payload: { lat: pos.lat, lon: pos.lon, address: json?.results?.[0]?.address?.freeformAddress || null },
        expires_at: new Date(Date.now() + GEOCODE_TTL_MS).toISOString(),
      }], { onConflict: 'route_key' });
      return { lat: pos.lat, lon: pos.lon };
    }
  }
  return null;
};

// Adresse -> Koordinaten. Reihenfolge: Koordinaten im Text, eigener Ort, bekannter Flughafen,
// dann TomTom. Mit Anker zuerst im Umkreis der anderen Fahrtpunkte, dann ohne Einschraenkung.
export const geocode = async (
  admin: AdminClient,
  schluessel: string,
  adresse: string,
  anker: Punkt | null = null,
): Promise<Punkt | null> => {
  const fest = await festerPunkt(admin, adresse);
  if (fest) return fest;
  if (anker) {
    const nah = await tomtomSuche(admin, schluessel, adresse, anker);
    if (nah) return nah;
  }
  return tomtomSuche(admin, schluessel, adresse, null);
};

// Alle Punkte einer Fahrt. Adressen ohne Stadt werden im Umkreis des ersten sicheren Punkts gesucht.
const geocodeFahrt = async (admin: AdminClient, schluessel: string, adressen: string[]) => {
  const feste = await Promise.all(adressen.map((a) => festerPunkt(admin, a)));
  const sicher = await Promise.all(adressen.map((a, i) => (
    feste[i] ?? (hatStadt(a) ? tomtomSuche(admin, schluessel, a, null) : Promise.resolve(null))
  )));
  const anker = sicher.find(Boolean) ?? null;
  const punkte = await Promise.all(adressen.map((a, i) => (
    sicher[i] ?? geocode(admin, schluessel, a, anker)
  )));
  return { feste, sicher, anker, punkte };
};

export type AdressWarnung = { adresse: string; grund: 'nicht_gefunden' | 'ohne_stadt' | 'weit_weg'; km?: number };

// Pruefung vor dem Speichern: findet die Fahrt jeden Punkt, und passt eine Adresse ohne Stadt dazu?
export const adressenPruefen = async (
  admin: AdminClient,
  schluessel: string,
  eingabe: string[],
): Promise<AdressWarnung[]> => {
  const adressen = eingabe.map((a) => a.trim()).filter(Boolean);
  const { feste, sicher, anker, punkte } = await geocodeFahrt(admin, schluessel, adressen);
  const warnungen: AdressWarnung[] = [];
  for (let i = 0; i < adressen.length; i += 1) {
    const adresse = adressen[i];
    if (!punkte[i]) {
      warnungen.push({ adresse, grund: 'nicht_gefunden' });
    } else if (!feste[i] && !sicher[i]) {
      if (!anker) warnungen.push({ adresse, grund: 'ohne_stadt' });
      else {
        const km = Math.round(luftlinieKm(punkte[i] as Punkt, anker));
        if (km > ANKER_RADIUS_M / 1000) warnungen.push({ adresse, grund: 'weit_weg', km });
      }
    }
  }
  return warnungen;
};

export type TomtomRoute = {
  ok: boolean;
  httpStatus: number;
  fehler: string | null;
  distanceM: number;
  durationMins: number;
  durationInTrafficMins: number;
  polyline: string | null;
  payload: Record<string, unknown>;
};

// Route mit aktuellem Verkehr. durationMins = ohne Verkehr, durationInTrafficMins = mit.
// Fahrtroute: mit Zwischenstopps, Adressen ohne Stadt im Umkreis der anderen Punkte.
// Anfahrt ab Fahrerstandort (ohneAnker): der Fahrer darf nicht zum Suchzentrum werden.
export const tomtomRoute = async (
  admin: AdminClient,
  schluessel: string,
  von: string,
  nach: string,
  optionen: { stopps?: string[]; ohneAnker?: boolean } = {},
): Promise<TomtomRoute> => {
  const leer = { distanceM: 0, durationMins: 0, durationInTrafficMins: 0, polyline: null, payload: {} };
  const stopps = (optionen.stopps || []).map((t) => t.trim()).filter(Boolean);
  const wegpunkte = optionen.ohneAnker
    ? await Promise.all([von, ...stopps, nach].map((t) => geocode(admin, schluessel, t)))
    : (await geocodeFahrt(admin, schluessel, [von, ...stopps, nach])).punkte;
  if (wegpunkte.some((p) => !p)) return { ok: false, httpStatus: 0, fehler: 'geocode_not_found', ...leer };
  const a = wegpunkte[0] as Punkt;
  const b = wegpunkte[wegpunkte.length - 1] as Punkt;
  const stoppPunkte = wegpunkte.slice(1, -1) as Punkt[];
  const url = `https://api.tomtom.com/routing/1/calculateRoute/${(wegpunkte as Punkt[]).map((p) => `${p.lat},${p.lon}`).join(':')}/json`
    + `?key=${schluessel}&traffic=true&travelMode=car&routeRepresentation=polyline&computeTravelTimeFor=all`;
  const res = await fetch(url);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, httpStatus: res.status, fehler: `HTTP ${res.status}`, ...leer };
  const route = json?.routes?.[0];
  const s = route?.summary;
  if (!s) return { ok: false, httpStatus: res.status, fehler: 'route_not_found', ...leer };
  const punkte = (route?.legs || []).flatMap((leg: { points?: Array<{ latitude: number; longitude: number }> }) =>
    (leg?.points || []).map((p) => ({ lat: p.latitude, lng: p.longitude })));
  const ohneVerkehr = Number(s.noTrafficTravelTimeInSeconds || s.travelTimeInSeconds || 0);
  const mitVerkehr = Number(s.liveTrafficIncidentsTravelTimeInSeconds || s.travelTimeInSeconds || 0);
  return {
    ok: true,
    httpStatus: res.status,
    fehler: null,
    distanceM: Number(s.lengthInMeters || 0),
    durationMins: Math.ceil(ohneVerkehr / 60),
    durationInTrafficMins: Math.ceil(mitVerkehr / 60),
    polyline: punkte.length >= 2 ? kodierePolyline(punkte) : null,
    // Nur die Zusammenfassung speichern, die Punkte stehen schon in der Linie.
    payload: { provider: TOMTOM_PROVIDER, summary: s, von: a, nach: b, ...(stoppPunkte.length ? { stopps: stoppPunkte } : {}) },
  };
};
