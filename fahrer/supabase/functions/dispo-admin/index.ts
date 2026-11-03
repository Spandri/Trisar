// Admin-Aufgaben der Disposition, die den service_role-Schluessel brauchen.
// Der Schluessel bleibt hier auf dem Server. Aufrufen darf nur, wer angemeldet
// und in profiles als Disposition markiert ist.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders, jsonResponse } from '../_shared/cors.ts';

const DISPO_ROLLEN = new Set(['dispo', 'dispatcher', 'admin', 'koordinator', 'coordinator']);

const ensureEnv = (name: string) => {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return jsonResponse(405, { error: 'method_not_allowed' });
  }

  try {
    // TRISAR_SERVICE_ROLE_KEY: aktueller Schluessel (ES256) aus functions/.env.
    // SUPABASE_SERVICE_ROLE_KEY der lokalen CLI ist noch HS256 und wird von Auth abgelehnt.
    const serviceKey = Deno.env.get('TRISAR_SERVICE_ROLE_KEY') || ensureEnv('SUPABASE_SERVICE_ROLE_KEY');
    const admin = createClient(ensureEnv('SUPABASE_URL'), serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    const { data: aufrufer, error: aufruferFehler } = await admin.auth.getUser(token);
    if (aufruferFehler || !aufrufer?.user) {
      return jsonResponse(401, { error: 'not_signed_in' });
    }
    const { data: profil } = await admin
      .from('profiles')
      .select('role, is_dispo')
      .eq('id', aufrufer.user.id)
      .maybeSingle();
    const istDispo = profil?.is_dispo === true || DISPO_ROLLEN.has(String(profil?.role || '').toLowerCase());
    if (!istDispo) {
      return jsonResponse(403, { error: 'not_dispo' });
    }

    const body = await req.json().catch(() => ({}));

    if (body?.aktion === 'fahrer_einladen') {
      const email = String(body.email || '').trim().toLowerCase();
      if (!email) return jsonResponse(400, { error: 'email_missing' });
      const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
        redirectTo: typeof body.redirectTo === 'string' ? body.redirectTo : undefined,
        data: {
          first_name: String(body.first_name || '').trim(),
          last_name: String(body.last_name || '').trim(),
          role: 'fahrer',
          password_setup_required: true,
        },
      });
      if (error) return jsonResponse(400, { error: error.message });
      return jsonResponse(200, { user_id: data?.user?.id || null });
    }

    return jsonResponse(400, { error: 'unknown_action' });
  } catch (error) {
    return jsonResponse(500, { error: error instanceof Error ? error.message : String(error) });
  }
});
