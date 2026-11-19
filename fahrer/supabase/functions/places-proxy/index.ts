import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders, jsonResponse } from '../_shared/cors.ts';
import { providerConfig } from '../_shared/provider-config.ts';
import { recordUsageWithCost } from '../_shared/usage-tracking.ts';
import {
  adressenPruefen, fahrtOrte, naviAusFest, naviFolge, routeFestLesen, routeFestRechnen, routenPunkteLesen, tomtomNavi, tomtomRoute, tomtomSchluessel,
} from '../_shared/tomtom-routing.ts';
import { flughafenVorschlaege } from '../_shared/flughafen-vorschlaege.ts';

const ensureEnv = (name: string) => {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
};

const base64UrlDecode = (value: string) => {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  return atob(padded);
};

const parseJwtPayload = (token: string): Record<string, unknown> | null => {
  try {
    const parts = token.split('.');
    if (parts.length < 2) return null;
    return JSON.parse(base64UrlDecode(parts[1]));
  } catch {
    return null;
  }
};

const getBearerToken = (authHeader: string | null) => {
  if (!authHeader) return null;
  const [scheme, token] = authHeader.split(' ');
  if (!scheme || !token || scheme.toLowerCase() !== 'bearer') return null;
  return token;
};

const isValidUuid = (value: unknown): value is string =>
  typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed' });
  }

  try {
    const supabaseUrl = ensureEnv('SUPABASE_URL');
    const supabaseAnonKey = ensureEnv('SUPABASE_ANON_KEY');
    const supabaseServiceRoleKey = ensureEnv('SUPABASE_SERVICE_ROLE_KEY');
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return jsonResponse(401, { error: 'Missing authorization header' });

    const bearerToken = getBearerToken(authHeader);
    const tokenPayload = bearerToken ? parseJwtPayload(bearerToken) : null;
    // Rolle nur, wenn es wirklich der Server-Schluessel ist. Die Rolle im Token selbst ist ohne
    // Signaturpruefung faelschbar (verify_jwt ist aus, weil das Gateway ES256-Tokens nicht lesen kann).
    const tokenRole = bearerToken && bearerToken === Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
      ? 'service_role'
      : bearerToken && bearerToken === Deno.env.get('SUPABASE_ANON_KEY') ? 'anon' : null;
    void tokenPayload;

    const authClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: {
        headers: {
          Authorization: authHeader,
        },
      },
    });

    const { data: authData, error: authError } = await authClient.auth.getUser();
    const userId = authError || !authData.user ? null : authData.user.id;
    if (!userId && tokenRole !== 'anon' && tokenRole !== 'service_role') {
      return jsonResponse(401, { error: 'Unauthorized' });
    }
    const adminClient = createClient(supabaseUrl, supabaseServiceRoleKey);

    const body = await req.json().catch(() => ({}));
    // Pruefung vor dem Speichern einer Fahrt: Start, Zwischenstopps, Ziel in Fahrtreihenfolge.
    if (body?.aktion === 'adressen_pruefen') {
      const adressen = Array.isArray(body?.adressen) ? body.adressen.map((t: unknown) => String(t ?? '')).slice(0, 12) : [];
      const schluessel = await tomtomSchluessel(adminClient);
      if (!schluessel || adressen.length === 0) return jsonResponse(200, { warnungen: [] });
      return jsonResponse(200, { warnungen: await adressenPruefen(adminClient, schluessel, adressen) });
    }

    // Routen-Editor der Dispo: Route mit Routenpunkten vorab rechnen, ohne zu speichern.
    // adressen = Start, Zwischenstopps, Ziel. Nur angemeldet (kein anon).
    if (body?.aktion === 'route_vorschau') {
      if (!userId && tokenRole !== 'service_role') return jsonResponse(401, { error: 'Unauthorized' });
      const adressen = Array.isArray(body?.adressen) ? body.adressen.map((t: unknown) => String(t ?? '').trim()).filter(Boolean).slice(0, 10) : [];
      const schluessel = await tomtomSchluessel(adminClient);
      if (!schluessel || adressen.length < 2) return jsonResponse(200, { ok: false, fehler: 'keine_route' });
      // Mit Routenpunkten: die Linie, die der Editor zeigt, kommt als "fest" mit zurueck. Uebernimmt die
      // Dispo sie, speichert die App genau dieses Paket an der Fahrt (jobs.route_fest).
      const routenPunkte = routenPunkteLesen(body?.punkte);
      if (routenPunkte.length > 0) {
        const orte = await fahrtOrte(adminClient, schluessel, adressen);
        if (!orte) return jsonResponse(200, { ok: false, fehler: 'geocode_not_found' });
        const fest = await routeFestRechnen(schluessel, orte, routenPunkte);
        if (!fest) return jsonResponse(200, { ok: false, fehler: 'route_not_found' });
        const minuten = Math.ceil(fest.dauer_s / 60);
        return jsonResponse(200, {
          ok: true,
          polyline: fest.polyline,
          distanz_m: fest.laenge_m,
          dauer_min: minuten,
          dauer_verkehr_min: minuten,
          orte: orte.map((o) => ({ lat: o.lat, lng: o.lon })),
          fest,
        });
      }
      const route = await tomtomRoute(adminClient, schluessel, adressen[0], adressen[adressen.length - 1], {
        stopps: adressen.slice(1, -1),
      });
      if (!route.ok) return jsonResponse(200, { ok: false, fehler: route.fehler || 'route_not_found' });
      const p = route.payload as { von?: { lat: number; lon: number }; nach?: { lat: number; lon: number }; stopps?: Array<{ lat: number; lon: number }> };
      const ort = (x?: { lat: number; lon: number }) => (x ? { lat: x.lat, lng: x.lon } : null);
      return jsonResponse(200, {
        ok: true,
        polyline: route.polyline,
        distanz_m: route.distanceM,
        dauer_min: route.durationMins,
        dauer_verkehr_min: route.durationInTrafficMins,
        orte: [ort(p.von), ...(p.stopps || []).map(ort), ort(p.nach)],
      });
    }

    // Eigene Navigation der Fahrer-App (16.11.): Route ab Standort ueber die offenen Ziele der Fahrt.
    // ab = erste noch offene Stelle der Folge (0 = Abholung). bis_abholung = nur die Anfahrt.
    if (body?.aktion === 'navi_route') {
      if (!userId) return jsonResponse(401, { error: 'Unauthorized' });
      const jobId = isValidUuid(body?.job_id) ? body.job_id : null;
      const lat = Number(body?.lat);
      const lng = Number(body?.lng);
      if (!jobId || !Number.isFinite(lat) || !Number.isFinite(lng)) return jsonResponse(200, { ok: false, fehler: 'eingabe' });
      // Mit dem Zugang des Nutzers lesen: die Zugriffsregeln lassen nur den Fahrer der Fahrt
      // (auch Kolonne) und die Dispo durch.
      const { data: job } = await authClient.from('jobs')
        .select('id,ext_route_payload,routen_punkte,route_fest,ext_route_polyline,ext_route_distance_m,ext_route_duration_in_traffic_mins,ext_route_duration_mins').eq('id', jobId).maybeSingle();
      if (!job) return jsonResponse(200, { ok: false, fehler: 'fahrt_fehlt' });
      const folge = naviFolge(job.ext_route_payload, routenPunkteLesen(job.routen_punkte));
      if (folge.length === 0) return jsonResponse(200, { ok: false, fehler: 'route_fehlt' });
      const ab = Math.min(Math.max(0, Math.floor(Number(body?.ab) || 0)), folge.length - 1);
      const ziele = body?.bis_abholung ? folge.slice(0, 1) : folge.slice(ab);
      const schluessel = await tomtomSchluessel(adminClient);
      if (!schluessel) return jsonResponse(200, { ok: false, fehler: 'kein_schluessel' });
      const standort = { lat, lng, kurs: body?.kurs == null ? null : Number(body.kurs) };
      // Mit Gast an Bord gilt die freigegebene Route der Dispo, genau wie gespeichert.
      const fest = body?.bis_abholung ? null : routeFestLesen(job.route_fest);
      const navi = fest ? await naviAusFest(schluessel, fest, standort, Math.max(1, ab)) : await tomtomNavi(schluessel, standort, ziele);
      // Vor dem Einsteigen (17.11.): die Route der Dispo bis zum Ziel als Vorschau mitschicken, damit der
      // Fahrer sie schon bei der Anfahrt und am Abholort sieht. Die freigegebene Route, sonst die
      // gespeicherte Fahrtroute (rechnet die Routenpunkte schon ein). Kein zusaetzlicher TomTom-Abruf.
      let vorschau: { polyline: string; laenge_m: number; dauer_s: number } | null = null;
      if (body?.bis_abholung && routenPunkteLesen(job.routen_punkte).length > 0) {
        const gespeichert = routeFestLesen(job.route_fest);
        if (gespeichert) {
          vorschau = { polyline: gespeichert.polyline, laenge_m: gespeichert.laenge_m, dauer_s: gespeichert.dauer_s };
        } else if (typeof job.ext_route_polyline === 'string' && job.ext_route_polyline.length > 0) {
          const minuten = Number(job.ext_route_duration_in_traffic_mins || job.ext_route_duration_mins || 0);
          vorschau = { polyline: job.ext_route_polyline, laenge_m: Number(job.ext_route_distance_m || 0), dauer_s: minuten * 60 };
        }
      }
      return jsonResponse(200, { ...navi, anzahl_ziele: folge.length, freigabe: Boolean(fest), ...(vorschau ? { vorschau } : {}) });
    }

    const input = typeof body?.input === 'string' ? body.input.trim() : '';
    const country = typeof body?.country === 'string' && body.country.trim() ? body.country.trim().toLowerCase() : 'de';
    const requestedBy = isValidUuid(body?.requested_by) ? body.requested_by : (isValidUuid(userId) ? userId : null);

    if (input.length < 2) {
      return jsonResponse(200, { predictions: [] });
    }

    const placesKey = ensureEnv(providerConfig.googlePlaces.envKey);
    const placesUrl = new URL(providerConfig.googlePlaces.url);
    placesUrl.searchParams.set('input', input);
    placesUrl.searchParams.set('components', `country:${country}`);
    placesUrl.searchParams.set('language', 'de');
    placesUrl.searchParams.set('key', placesKey);

    const response = await fetch(placesUrl.toString());
    const payload = await response.json().catch(() => ({}));

    await recordUsageWithCost(adminClient, {
      provider: 'google-places',
      action: 'places_lookup',
      reason: 'live_view',
      cache_hit: false,
      requested_by: requestedBy,
      http_status: response.status,
      error_text: response.ok ? null : (payload?.error_message || 'Google Places request failed'),
      units: 1,
      unit_name: 'request',
    });

    if (!response.ok) {
      const feste = flughafenVorschlaege(input);
      if (feste.length) return jsonResponse(200, { predictions: feste });
      return jsonResponse(response.status, {
        error: payload?.error_message || 'Google Places request failed',
        predictions: [],
      });
    }

    const google = Array.isArray(payload?.predictions)
      ? payload.predictions.map((row: Record<string, unknown>) => ({
          description: typeof row.description === 'string' ? row.description : '',
          place_id: typeof row.place_id === 'string' ? row.place_id : '',
        }))
      : [];
    const feste = flughafenVorschlaege(input);
    const predictions = [...feste, ...google.filter((g: { description: string }) => !feste.some((f) => f.description === g.description))];

    return jsonResponse(200, { predictions });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unexpected error';
    return jsonResponse(500, { error: message, predictions: [] });
  }
});
