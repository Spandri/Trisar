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

// General Aviation Terminal MUC (18.11.), Punkt aus dem Google-Treffer "Munich Aviation Service, Allgemeine Luftfahrt".
const MUC_GAT = { lat: 48.357773, lon: 11.802015 };

const flughafen = (adresse: string) => {
  if (/\bGAT\b|general[ -]?aviation|allgemeine luftfahrt/i.test(adresse) && /flughafen|airport|muc|m(ü|ue)nchen|\bGAT\b/i.test(adresse)) {
    return { ...MUC_GAT };
  }
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
  // geo2 (20.11.): alte Eintraege lagen bei "Name, Strasse, Ort" auf der Strassenmitte (siehe unten).
  const key = await sha256(`tomtom-geo2|${norm}${ankerTeil}`);
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
  // Kennt geocode nur die Strasse (keine Hausnummer im Text), vor der Strasse steht aber ein Name
  // ("Wöllinger Wirtshaus, Johann-Clanze-Straße, München"), lag der Punkt auf der Strassenmitte, rund 1 km
  // neben dem Lokal (20.11.). Dann zaehlt der Ort aus search, wenn er an derselben Strasse liegt.
  const holen = async (art: string) => {
    const url = `https://api.tomtom.com/search/2/${art}/${encodeURIComponent(adresse.trim())}.json`
      + `?key=${schluessel}&limit=1${umkreis}&countrySet=DE,AT,CH&language=de-DE`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const json = await res.json().catch(() => ({}));
    return json?.results?.[0] || null;
  };
  const nurStrasse = (r: any) => r?.type === 'Street' && !r?.address?.streetNumber;
  const mitName = (() => {
    const erster = adresse.split(',')[0]?.trim() || '';
    return adresse.includes(',') && !/\d/.test(erster) && !/(str\.?|stra(ß|ss)e|weg|platz|allee|gasse|ring|damm|ufer)$/i.test(erster);
  })();
  for (const art of ['geocode', 'search']) {
    let treffer = await holen(art);
    if (art === 'geocode' && nurStrasse(treffer) && mitName) {
      const ort = await holen('search');
      const gleicheStrasse = ort?.address?.streetName && ort.address.streetName === treffer?.address?.streetName;
      if (gleicheStrasse && Number.isFinite(ort?.position?.lat) && Number.isFinite(ort?.position?.lon)) treffer = ort;
    }
    const json = { results: treffer ? [treffer] : [] };
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

// Routenpunkt der Dispo (jobs.routen_punkte): nach = Abschnitt, 0 = Start bis erster Stopp, k = nach Stopp k.
export type RoutenPunkt = { lat: number; lng: number; nach: number };

export const routenPunkteLesen = (wert: unknown): RoutenPunkt[] => (
  Array.isArray(wert)
    ? wert.map((p) => ({ lat: Number(p?.lat), lng: Number(p?.lng ?? p?.lon), nach: Math.max(0, Math.floor(Number(p?.nach) || 0)) }))
      .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180)
      .slice(0, 8)
    : []
);

// TomTom-Wegpunkt als Kreis: die Route laeuft hindurch, ohne dort zu halten.
export const ROUTENPUNKT_RADIUS_M = 30;
export const weicherPunkt = (lat: number, lng: number) => `circle(${lat.toFixed(6)},${lng.toFixed(6)},${ROUTENPUNKT_RADIUS_M})`;

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
  optionen: { stopps?: string[]; ohneAnker?: boolean; routenPunkte?: RoutenPunkt[] } = {},
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
  // Routenpunkte der Dispo in ihren Abschnitt einreihen: Start, Punkte(0), Stopp 1, Punkte(1), ..., Ziel.
  const routenPunkte = (optionen.routenPunkte || []).map((p) => ({ ...p, nach: Math.min(p.nach, stoppPunkte.length) }));
  // Routenpunkte gehen weich mit (Kreis): durchfahren ohne Halt, kein Wenden wegen der Strassenseite.
  const folge: string[] = [`${a.lat},${a.lon}`];
  for (let abschnitt = 0; abschnitt <= stoppPunkte.length; abschnitt += 1) {
    routenPunkte.filter((p) => p.nach === abschnitt).forEach((p) => folge.push(weicherPunkt(p.lat, p.lng)));
    if (abschnitt < stoppPunkte.length) folge.push(`${stoppPunkte[abschnitt].lat},${stoppPunkte[abschnitt].lon}`);
  }
  folge.push(`${b.lat},${b.lon}`);
  const url = `https://api.tomtom.com/routing/1/calculateRoute/${folge.map(encodeURIComponent).join(':')}/json`
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
    payload: {
      provider: TOMTOM_PROVIDER, summary: s, von: a, nach: b,
      ...(stoppPunkte.length ? { stopps: stoppPunkte } : {}),
      ...(routenPunkte.length ? { routen_punkte: routenPunkte } : {}),
    },
  };
};


// ---------------------------------------------------------------------------------------------
// Eigene Navigation der Fahrer-App (16.11.): nur bei Fahrten mit Route von Dispo (routen_punkte).
// Google Maps laesst sich per Link keine Route vorgeben, deshalb fuehrt die App selbst:
// Route ab Standort des Fahrers ueber die noch offenen Punkte, mit Abbiegehinweisen von TomTom.
// ---------------------------------------------------------------------------------------------

export type NaviZiel = { lat: number; lng: number; art: 'abholung' | 'stopp' | 'punkt' | 'ziel'; ab: number };

// Alle Ziele der Fahrt in Fahrtreihenfolge: Abholung, Punkte(0), Stopp 1, Punkte(1), ..., Ziel.
// ab = Stelle in dieser Folge. Die App merkt sich, bis wohin sie gekommen ist.
export const naviFolge = (
  payload: { von?: Punkt; nach?: Punkt; stopps?: Punkt[] } | null | undefined,
  routenPunkte: RoutenPunkt[],
): NaviZiel[] => {
  const von = payload?.von;
  const nach = payload?.nach;
  if (!von || !nach || !Number.isFinite(von.lat) || !Number.isFinite(nach.lat)) return [];
  const stopps = Array.isArray(payload?.stopps) ? payload.stopps : [];
  const folge: Array<Omit<NaviZiel, 'ab'>> = [{ lat: von.lat, lng: von.lon, art: 'abholung' }];
  for (let abschnitt = 0; abschnitt <= stopps.length; abschnitt += 1) {
    routenPunkte.filter((p) => Math.min(p.nach, stopps.length) === abschnitt)
      .forEach((p) => folge.push({ lat: p.lat, lng: p.lng, art: 'punkt' }));
    if (abschnitt < stopps.length) folge.push({ lat: stopps[abschnitt].lat, lng: stopps[abschnitt].lon, art: 'stopp' });
  }
  folge.push({ lat: nach.lat, lng: nach.lon, art: 'ziel' });
  return folge.map((z, ab) => ({ ...z, ab }));
};

// TomTom-Manoever -> Pfeil der App. Die Apps zeichnen nur diese wenigen Formen.
const NAVI_PFEIL: Record<string, string> = {
  DEPART: 'start', STRAIGHT: 'gerade', FOLLOW: 'gerade',
  KEEP_RIGHT: 'leicht_rechts', BEAR_RIGHT: 'leicht_rechts', TURN_RIGHT: 'rechts', SHARP_RIGHT: 'scharf_rechts',
  KEEP_LEFT: 'leicht_links', BEAR_LEFT: 'leicht_links', TURN_LEFT: 'links', SHARP_LEFT: 'scharf_links',
  MAKE_UTURN: 'wenden', TRY_MAKE_UTURN: 'wenden',
  ENTER_MOTORWAY: 'leicht_rechts', ENTER_FREEWAY: 'leicht_rechts', ENTER_HIGHWAY: 'leicht_rechts', ENTRANCE_RAMP: 'leicht_rechts',
  TAKE_EXIT: 'leicht_rechts', MOTORWAY_EXIT_RIGHT: 'leicht_rechts', MOTORWAY_EXIT_LEFT: 'leicht_links',
  SWITCH_PARALLEL_ROAD: 'leicht_rechts', SWITCH_MAIN_ROAD: 'leicht_links',
  ROUNDABOUT_CROSS: 'kreisel', ROUNDABOUT_RIGHT: 'kreisel', ROUNDABOUT_LEFT: 'kreisel', ROUNDABOUT_BACK: 'kreisel',
  TAKE_FERRY: 'gerade',
  ARRIVE: 'ziel', ARRIVE_LEFT: 'ziel', ARRIVE_RIGHT: 'ziel',
  WAYPOINT_LEFT: 'ziel', WAYPOINT_RIGHT: 'ziel', WAYPOINT_REACHED: 'ziel',
};

const NAVI_KURZ: Record<string, string> = {
  gerade: 'geradeaus', rechts: 'rechts', links: 'links', leicht_rechts: 'rechts halten', leicht_links: 'links halten',
  scharf_rechts: 'scharf rechts', scharf_links: 'scharf links', wenden: 'wenden', start: 'losfahren',
};

const zielText = (art: NaviZiel['art'], seite: string) => {
  const wo = seite === 'LEFT' ? ' Er liegt auf der linken Seite' : seite === 'RIGHT' ? ' Er liegt auf der rechten Seite' : '';
  if (art === 'abholung') return { kurz: 'Abholort', text: `Sie haben den Abholort erreicht.${wo}` };
  if (art === 'stopp') return { kurz: 'Zwischenstopp', text: `Sie haben den Zwischenstopp erreicht.${wo}` };
  return { kurz: 'Ziel', text: `Sie haben das Ziel erreicht.${wo.replace('Er liegt', 'Es liegt')}` };
};

export type NaviHinweis = { m: number; t: number; pfeil: string; kurz: string; text: string; strasse: string };
export type NaviRoute = {
  ok: boolean;
  fehler?: string;
  polyline?: string;
  laenge_m?: number;
  dauer_s?: number;
  hinweise?: NaviHinweis[];
  // Halte und Routenpunkte auf dieser Route: m = Meter ab Start der Route, ab = Stelle in der Folge.
  wegpunkte?: Array<{ m: number; ab: number; art: NaviZiel['art'] }>;
};

const meterZwischen = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
  const dLat = (b.lat - a.lat) * 111320;
  const dLng = (b.lng - a.lng) * 111320 * Math.cos(((a.lat + b.lat) / 2) * Math.PI / 180);
  return Math.hypot(dLat, dLng);
};

// Route ab Standort ueber die Ziele (in Reihenfolge). Halte (Abholung, Stopp, Ziel) sind feste
// Wegpunkte, Routenpunkte weiche. Braucht nur den Schluessel, keine Datenbank.
export const tomtomNavi = async (
  schluessel: string,
  standort: { lat: number; lng: number; kurs?: number | null },
  ziele: NaviZiel[],
): Promise<NaviRoute> => {
  if (ziele.length === 0) return { ok: false, fehler: 'keine_ziele' };
  // Schon am einzigen Ziel (Fahrer steht am Abholort): keine Route noetig, die App zeigt "erreicht".
  if (ziele.length === 1 && meterZwischen(standort, ziele[0]) < 40) {
    const z = ziele[0];
    const laenge = Math.max(1, Math.round(meterZwischen(standort, z)));
    return {
      ok: true,
      polyline: kodierePolyline([{ lat: standort.lat, lng: standort.lng }, { lat: z.lat, lng: z.lng }]),
      laenge_m: laenge,
      dauer_s: 0,
      hinweise: [{ m: laenge, t: 0, pfeil: 'ziel', strasse: '', ...zielText(z.art, '') }],
      wegpunkte: [{ m: laenge, ab: z.ab, art: z.art }],
    };
  }
  const orte = [
    `${standort.lat.toFixed(6)},${standort.lng.toFixed(6)}`,
    ...ziele.map((z) => (z.art === 'punkt' ? weicherPunkt(z.lat, z.lng) : `${z.lat.toFixed(6)},${z.lng.toFixed(6)}`)),
  ];
  const kurs = Number(standort.kurs);
  const url = `https://api.tomtom.com/routing/1/calculateRoute/${orte.map(encodeURIComponent).join(':')}/json`
    + `?key=${schluessel}&traffic=true&travelMode=car&routeRepresentation=polyline&instructionsType=text&language=de-DE`
    // Fahrtrichtung mitgeben: sonst schickt TomTom ein fahrendes Auto gern erst einmal zum Wenden.
    + (Number.isFinite(kurs) && kurs >= 0 && kurs < 360 ? `&vehicleHeading=${Math.round(kurs)}` : '');
  const res = await fetch(url);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, fehler: `HTTP ${res.status}` };
  const route = json?.routes?.[0];
  const s = route?.summary;
  if (!s) return { ok: false, fehler: 'route_not_found' };
  const punkte: Array<{ lat: number; lng: number }> = (route?.legs || []).flatMap(
    (leg: { points?: Array<{ latitude: number; longitude: number }> }) => (leg?.points || []).map((p) => ({ lat: p.latitude, lng: p.longitude })),
  );
  if (punkte.length < 2) return { ok: false, fehler: 'route_not_found' };

  // Meter entlang der Linie je Stuetzpunkt, damit jeder Wegpunkt seine Stelle auf der Route bekommt.
  const strecke: number[] = [0];
  for (let i = 1; i < punkte.length; i += 1) strecke.push(strecke[i - 1] + meterZwischen(punkte[i - 1], punkte[i]));
  const laenge = Number(s.lengthInMeters || strecke[strecke.length - 1]);
  const faktor = strecke[strecke.length - 1] > 0 ? laenge / strecke[strecke.length - 1] : 1;
  let abIndex = 0;
  const wegpunkte = ziele.map((z, nr) => {
    if (nr === ziele.length - 1) return { m: Math.round(laenge), ab: z.ab, art: z.art };
    let bester = abIndex;
    let abstand = Infinity;
    for (let i = abIndex; i < punkte.length; i += 1) {
      const d = meterZwischen(punkte[i], z);
      if (d < abstand) { abstand = d; bester = i; }
    }
    abIndex = bester;
    return { m: Math.round(strecke[bester] * faktor), ab: z.ab, art: z.art };
  });

  // Hinweise: Halte in der Sprache der App, Routenpunkte gibt es als Kreis gar nicht erst.
  const halte = ziele.filter((z) => z.art !== 'punkt');
  let halt = 0;
  const hinweise: NaviHinweis[] = [];
  for (const h of (route?.guidance?.instructions || []) as Array<Record<string, unknown>>) {
    const art = String(h.maneuver || '');
    const pfeil = NAVI_PFEIL[art] || 'gerade';
    const strasse = String(h.street || '').trim();
    const basis = { m: Math.round(Number(h.routeOffsetInMeters || 0)), t: Math.round(Number(h.travelTimeInSeconds || 0)), pfeil, strasse };
    if (art.startsWith('WAYPOINT') || art.startsWith('ARRIVE')) {
      const ziel = halte[Math.min(halt, halte.length - 1)];
      halt += 1;
      const seite = art.endsWith('LEFT') ? 'LEFT' : art.endsWith('RIGHT') ? 'RIGHT' : '';
      hinweise.push({ ...basis, pfeil: 'ziel', ...zielText(ziel?.art || 'ziel', seite) });
      continue;
    }
    const ausfahrt = Number(h.roundaboutExitNumber);
    const kurz = pfeil === 'kreisel'
      ? (Number.isFinite(ausfahrt) && ausfahrt > 0 ? `Kreisel, ${ausfahrt}. Ausfahrt` : 'Kreisel')
      : `${NAVI_KURZ[pfeil] || 'geradeaus'}${strasse && pfeil !== 'start' ? ` auf ${strasse}` : ''}`;
    hinweise.push({ ...basis, kurz, text: String(h.message || kurz) });
  }

  return {
    ok: true,
    polyline: kodierePolyline(punkte),
    laenge_m: Math.round(laenge),
    dauer_s: Math.round(Number(s.travelTimeInSeconds || 0)),
    hinweise,
    wegpunkte,
  };
};


// ---------------------------------------------------------------------------------------------
// Freigegebene Route (16.11., jobs.route_fest): die Dispo sieht im Routen-Editor genau eine Linie und
// uebernimmt sie. Diese Linie samt Abbiegehinweisen wird gespeichert und dem Fahrer genau so gezeigt.
// TomTom rechnet danach nur noch die Anfahrt und, wenn der Fahrer sich verfaehrt, den Weg zurueck
// auf die freigegebene Route.
// ---------------------------------------------------------------------------------------------

export type RouteFest = {
  v: number;
  polyline: string;
  laenge_m: number;
  dauer_s: number;
  hinweise: NaviHinweis[];
  wegpunkte: Array<{ m: number; ab: number; art: NaviZiel['art'] }>;
  punkte: RoutenPunkt[];
  erstellt: string;
};

export const routeFestLesen = (wert: unknown): RouteFest | null => {
  const f = wert as RouteFest | null;
  return f && typeof f.polyline === 'string' && f.polyline.length > 0 && Array.isArray(f.hinweise) && Array.isArray(f.wegpunkte)
    && Number(f.laenge_m) > 0 ? f : null;
};

// Start, Stopps, Ziel als Koordinaten (wie die Fahrtroute sie findet). null, wenn eine Adresse fehlt.
export const fahrtOrte = async (admin: AdminClient, schluessel: string, adressen: string[]): Promise<Punkt[] | null> => {
  const { punkte } = await geocodeFahrt(admin, schluessel, adressen.map((t) => t.trim()).filter(Boolean));
  return punkte.length >= 2 && punkte.every(Boolean) ? punkte as Punkt[] : null;
};

// Route Abholung -> Ziel ueber Stopps und Routenpunkte, mit Abbiegehinweisen. Das ist die Linie,
// die der Editor zeigt und die bei "Uebernehmen" gespeichert wird.
export const routeFestRechnen = async (schluessel: string, orte: Punkt[], routenPunkte: RoutenPunkt[]): Promise<RouteFest | null> => {
  const folge = naviFolge({ von: orte[0], nach: orte[orte.length - 1], stopps: orte.slice(1, -1) }, routenPunkte);
  if (folge.length < 2) return null;
  const navi = await tomtomNavi(schluessel, { lat: folge[0].lat, lng: folge[0].lng }, folge.slice(1));
  if (!navi.ok || !navi.polyline) return null;
  return {
    v: 1,
    polyline: navi.polyline,
    laenge_m: navi.laenge_m || 0,
    dauer_s: navi.dauer_s || 0,
    hinweise: navi.hinweise || [],
    wegpunkte: navi.wegpunkte || [],
    punkte: routenPunkte,
    erstellt: new Date().toISOString(),
  };
};

export const dekodierePolyline = (text: string): Array<{ lat: number; lng: number }> => {
  let index = 0;
  let lat = 0;
  let lng = 0;
  const punkte: Array<{ lat: number; lng: number }> = [];
  const wert = () => {
    let b = 0;
    let shift = 0;
    let result = 0;
    do {
      b = text.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20 && index < text.length + 1);
    return (result & 1) ? ~(result >> 1) : (result >> 1);
  };
  while (index < text.length) {
    lat += wert();
    lng += wert();
    punkte.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }
  return punkte;
};

const FEST_NAH_M = 50; // so nah an der freigegebenen Linie gilt der Fahrer als darauf
const FEST_EINSTIEG_M = 250; // so weit voraus fuehrt TomTom zurueck auf die Linie
const FEST_ANSCHLUSS_M = 400; // ab hier laeuft wieder die freigegebene Linie

// Navigation auf der freigegebenen Route ab Standort des Fahrers.
// Auf der Linie: der Rest der Freigabe, ohne TomTom. Daneben: TomTom nur fuer das Stueck zurueck
// auf die Linie (ein Stueck voraus, damit niemand wenden muss), danach wieder die Freigabe.
// ab = erste noch offene Stelle der Folge, davor wird nicht mehr gesucht (Schleifen).
export const naviAusFest = async (
  schluessel: string,
  fest: RouteFest,
  standort: { lat: number; lng: number; kurs?: number | null },
  ab: number,
): Promise<NaviRoute> => {
  const punkte = dekodierePolyline(fest.polyline);
  if (punkte.length < 2) return { ok: false, fehler: 'route_fehlt' };
  const strecke: number[] = [0];
  for (let i = 1; i < punkte.length; i += 1) strecke.push(strecke[i - 1] + meterZwischen(punkte[i - 1], punkte[i]));
  const linie = strecke[strecke.length - 1];
  const laenge = Number(fest.laenge_m) || linie;
  const faktor = linie > 0 ? laenge / linie : 1;
  const m = (i: number) => strecke[i] * faktor;
  const abM = Math.max(0, ...fest.wegpunkte.filter((w) => w.ab < ab && w.art !== 'ziel').map((w) => w.m)) - 30;

  // Naechste Stelle der Linie ab dem schon erreichten Wegpunkt.
  const kos = Math.cos(standort.lat * Math.PI / 180);
  let nah = { abstand: Infinity, index: 0, anteil: 0, s: 0 };
  for (let i = 0; i < punkte.length - 1; i += 1) {
    if (m(i + 1) < abM) continue;
    const a = punkte[i];
    const b = punkte[i + 1];
    const bx = (b.lng - a.lng) * 111320 * kos;
    const by = (b.lat - a.lat) * 111320;
    const px = (standort.lng - a.lng) * 111320 * kos;
    const py = (standort.lat - a.lat) * 111320;
    const lang2 = bx * bx + by * by;
    const anteil = lang2 > 0 ? Math.min(1, Math.max(0, (px * bx + py * by) / lang2)) : 0;
    const abstand = Math.hypot(px - anteil * bx, py - anteil * by);
    if (abstand < nah.abstand) nah = { abstand, index: i, anteil, s: m(i) + anteil * (m(i + 1) - m(i)) };
  }

  // Stelle s auf der Linie als Punkt, und die Fahrzeit bis dorthin.
  const punktBei = (s: number) => {
    let i = 0;
    while (i < punkte.length - 2 && m(i + 1) < s) i += 1;
    const lang = m(i + 1) - m(i);
    const anteil = lang > 0 ? Math.min(1, Math.max(0, (s - m(i)) / lang)) : 0;
    return { index: i, lat: punkte[i].lat + anteil * (punkte[i + 1].lat - punkte[i].lat), lng: punkte[i].lng + anteil * (punkte[i + 1].lng - punkte[i].lng) };
  };
  const zeitBei = (s: number) => {
    const h = fest.hinweise;
    if (h.length < 2) return fest.dauer_s * Math.min(1, s / Math.max(1, laenge));
    let i = 0;
    while (i < h.length - 2 && h[i + 1].m <= s) i += 1;
    const anteil = h[i + 1].m > h[i].m ? Math.min(1, Math.max(0, (s - h[i].m) / (h[i + 1].m - h[i].m))) : 1;
    return h[i].t + anteil * (h[i + 1].t - h[i].t);
  };

  // Rest der Freigabe ab Stelle s. versatz = Meter, zeit = Sekunden, die davor schon liegen (Rueckweg).
  const rest = (s: number, davor: Array<{ lat: number; lng: number }>, hinweiseDavor: NaviHinweis[], versatz: number, zeit: number): NaviRoute => {
    const start = punktBei(s);
    const linieRest = [...davor, { lat: start.lat, lng: start.lng }, ...punkte.slice(start.index + 1)];
    const t0 = zeitBei(s);
    return {
      ok: true,
      polyline: kodierePolyline(linieRest),
      laenge_m: Math.round(versatz + laenge - s),
      dauer_s: Math.round(zeit + Math.max(0, fest.dauer_s - t0)),
      hinweise: [
        ...hinweiseDavor,
        ...fest.hinweise.filter((h) => h.m > s + 5 && h.pfeil !== 'start')
          .map((h) => ({ ...h, m: Math.round(versatz + h.m - s), t: Math.round(zeit + Math.max(0, h.t - t0)) })),
      ],
      wegpunkte: fest.wegpunkte.filter((w) => w.m > s - 30 || w.art === 'ziel')
        .map((w) => ({ ...w, m: Math.round(versatz + Math.max(0, w.m - s)) })),
    };
  };

  if (nah.abstand <= FEST_NAH_M) return rest(nah.s, [], [], 0, 0);

  // Abseits: zurueck auf die Linie. Kurz vor dem Ziel direkt dorthin.
  const letzter = punkte[punkte.length - 1];
  if (laenge - nah.s < FEST_ANSCHLUSS_M + 100) {
    const zielAb = fest.wegpunkte[fest.wegpunkte.length - 1]?.ab ?? ab;
    return tomtomNavi(schluessel, standort, [{ lat: letzter.lat, lng: letzter.lng, art: 'ziel', ab: zielAb }]);
  }
  const einstieg = punktBei(nah.s + FEST_EINSTIEG_M);
  const anschlussS = nah.s + FEST_ANSCHLUSS_M;
  const anschluss = punktBei(anschlussS);
  const zurueck = await tomtomNavi(schluessel, standort, [
    { lat: einstieg.lat, lng: einstieg.lng, art: 'punkt', ab: -1 },
    { lat: anschluss.lat, lng: anschluss.lng, art: 'ziel', ab: -1 },
  ]);
  if (!zurueck.ok || !zurueck.polyline) return zurueck;
  const weg = dekodierePolyline(zurueck.polyline);
  // Die Ankunft am Anschlusspunkt ist kein Ziel: weglassen, es geht auf der Freigabe weiter.
  const hinweise = (zurueck.hinweise || []).filter((h) => h.pfeil !== 'ziel');
  return rest(anschlussS, weg.slice(0, -1), hinweise, zurueck.laenge_m || 0, zurueck.dauer_s || 0);
};
