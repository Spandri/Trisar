// Anmeldung mit Benutzername oder E-Mail plus Passwort.
// Der Benutzername wird hier auf dem Server in die E-Mail des Kontos aufgeloest,
// damit der Browser nie erfaehrt, welche E-Mail zu welchem Benutzernamen gehoert.
// Antwort bei Erfolg: die Sitzung von Supabase Auth (access_token, refresh_token, ...).
// Bei falschem Namen oder Passwort immer dieselbe Antwort.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders, jsonResponse } from '../_shared/cors.ts';

const ensureEnv = (name: string) => {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
};

const FALSCH = { error: 'invalid_credentials' };

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return jsonResponse(405, { error: 'method_not_allowed' });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const kennung = String(body?.kennung || '').trim().toLowerCase();
    const passwort = String(body?.passwort || '');
    if (!kennung || !passwort) return jsonResponse(400, FALSCH);

    const url = ensureEnv('SUPABASE_URL');
    let email = kennung;

    if (!kennung.includes('@')) {
      const serviceKey = Deno.env.get('TRISAR_SERVICE_ROLE_KEY') || ensureEnv('SUPABASE_SERVICE_ROLE_KEY');
      const admin = createClient(url, serviceKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { data: profil } = await admin
        .from('profiles')
        .select('id')
        .eq('username', kennung)
        .maybeSingle();
      if (!profil?.id) return jsonResponse(400, FALSCH);
      const { data: konto } = await admin.auth.admin.getUserById(profil.id);
      if (!konto?.user?.email) return jsonResponse(400, FALSCH);
      email = konto.user.email;
    }

    const oeffentlich = createClient(url, ensureEnv('SUPABASE_ANON_KEY'), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await oeffentlich.auth.signInWithPassword({ email, password: passwort });
    if (error || !data?.session) return jsonResponse(400, FALSCH);

    const s = data.session;
    return jsonResponse(200, {
      access_token: s.access_token,
      refresh_token: s.refresh_token,
      expires_in: s.expires_in,
      expires_at: s.expires_at,
      token_type: s.token_type,
      user: s.user,
    });
  } catch (error) {
    return jsonResponse(500, { error: error instanceof Error ? error.message : String(error) });
  }
});
