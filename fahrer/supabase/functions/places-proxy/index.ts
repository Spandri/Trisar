import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders, jsonResponse } from '../_shared/cors.ts';
import { providerConfig } from '../_shared/provider-config.ts';
import { recordUsageWithCost } from '../_shared/usage-tracking.ts';

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
      return jsonResponse(response.status, {
        error: payload?.error_message || 'Google Places request failed',
        predictions: [],
      });
    }

    const predictions = Array.isArray(payload?.predictions)
      ? payload.predictions.map((row: Record<string, unknown>) => ({
          description: typeof row.description === 'string' ? row.description : '',
          place_id: typeof row.place_id === 'string' ? row.place_id : '',
        }))
      : [];

    return jsonResponse(200, { predictions });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unexpected error';
    return jsonResponse(500, { error: message, predictions: [] });
  }
});
