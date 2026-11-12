// Admin-Aufgaben der Disposition, die den service_role-Schluessel brauchen.
// Der Schluessel bleibt hier auf dem Server. Aufrufen darf nur, wer angemeldet
// und in profiles als Disposition markiert ist.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders, jsonResponse } from '../_shared/cors.ts';
import { importAktion } from './import.ts';
import { kiFrage } from './ki.ts';
import { anlegenAusKarte } from './anlegen.ts';
import { dienstSenden } from './dienst.ts';
import { stundenExport } from './stunden.ts';
import { NAME_MUSTER, PLATZHALTER_DOMAIN, fehlerText, istPlatzhalter, kontoAnlegen, kontoLoeschen } from './konto.ts';

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

    // Stundenerfassung: Excel-Export (siehe stunden.ts).
    if (body?.aktion === 'stunden_export') {
      const { status, daten } = await stundenExport(admin, body);
      return jsonResponse(status, daten);
    }

    // KI-Assistent (siehe ki.ts).
    if (body?.aktion === 'ki_frage') {
      const { status, daten } = await kiFrage(admin, body, aufrufer.user.id);
      return jsonResponse(status, daten);
    }

    // Karte des KI-Assistenten bestaetigt: Fahrer oder Fahrzeug anlegen (siehe anlegen.ts).
    if (body?.aktion === 'ki_anlegen') {
      const { status, daten } = await anlegenAusKarte(admin, body);
      return jsonResponse(status, daten);
    }

    // Dienststart oder Dienstende fuer markierte Fahrer (siehe dienst.ts).
    if (body?.aktion === 'dienst_senden') {
      const { status, daten } = await dienstSenden(admin, body);
      return jsonResponse(status, daten);
    }

    // Excel-/CSV-Import (siehe import.ts).
    if (typeof body?.aktion === 'string' && body.aktion.startsWith('import_')) {
      const { status, daten } = await importAktion(admin, body, aufrufer.user.id);
      return jsonResponse(status, daten);
    }

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

    if (body?.aktion === 'konto_anlegen' || body?.aktion === 'konto_aendern') {
      const anlegen = body.aktion === 'konto_anlegen';
      const userId = anlegen ? '' : String(body.user_id || '').trim();
      if (!anlegen && !userId) return jsonResponse(400, { error: 'user_id_missing' });

      const hatName = typeof body.benutzername === 'string';
      const name = hatName ? body.benutzername.trim().toLowerCase() : '';
      const email = String(body.email || '').trim().toLowerCase();
      const passwort = typeof body.passwort === 'string' ? body.passwort : '';

      if (anlegen && !name && !email) return jsonResponse(400, { error: 'login_missing' });
      if (name && !NAME_MUSTER.test(name)) return jsonResponse(400, { error: 'username_invalid' });
      if (anlegen && !passwort) return jsonResponse(400, { error: 'password_missing' });
      if (passwort && passwort.length < 8) return jsonResponse(400, { error: 'password_too_short' });

      if (name) {
        const { data: belegt } = await admin
          .from('profiles')
          .select('id')
          .eq('username', name)
          .maybeSingle();
        if (belegt?.id && belegt.id !== userId) return jsonResponse(400, { error: 'username_taken' });
      }

      if (anlegen) {
        const ergebnis = await kontoAnlegen(admin, {
          benutzername: name, email, passwort,
          first_name: String(body.first_name || ''), last_name: String(body.last_name || ''),
        });
        if ('fehler' in ergebnis) return jsonResponse(400, { error: ergebnis.fehler });
        return jsonResponse(200, { user_id: ergebnis.userId });
      }

      // Bestehendes Konto: nur geaenderte Teile setzen.
      const { data: bisher, error: bisherFehler } = await admin.auth.admin.getUserById(userId);
      if (bisherFehler || !bisher?.user) return jsonResponse(404, { error: 'user_not_found' });
      const authAenderung: Record<string, unknown> = {};
      if (passwort) authAenderung.password = passwort;
      const altMail = String(bisher.user.email || '').toLowerCase();
      if (email && email !== altMail) {
        authAenderung.email = email;
        authAenderung.email_confirm = true;
      } else if (!email && name && istPlatzhalter(altMail) && altMail !== `${name}@${PLATZHALTER_DOMAIN}`) {
        authAenderung.email = `${name}@${PLATZHALTER_DOMAIN}`;
        authAenderung.email_confirm = true;
      }
      if (Object.keys(authAenderung).length) {
        const { error } = await admin.auth.admin.updateUserById(userId, authAenderung);
        if (error) return jsonResponse(400, { error: fehlerText(error.message) });
      }
      // Neues Passwort: alle Sitzungen beenden, die Apps zeigen sofort den Login.
      if (passwort) await admin.rpc('konto_abmelden_jetzt', { p_user: userId, p_grund: 'passwort' });
      if (hatName) {
        if (!name && istPlatzhalter(String(authAenderung.email || altMail))) {
          return jsonResponse(400, { error: 'login_missing' });
        }
        const { error } = await admin.from('profiles').update({ username: name || null }).eq('id', userId);
        if (error) return jsonResponse(400, { error: error.message });
      }
      return jsonResponse(200, { user_id: userId });
    }

    // Fahrer endgueltig loeschen: Auth-Konto weg, alles am Profil faellt per ON DELETE CASCADE
    // mit (Standorte, Tracker-Zuordnung, Stunden, Push, ...). Fahrten bleiben, nur ohne Fahrer.
    if (body?.aktion === 'konto_loeschen') {
      const userId = String(body.user_id || '').trim();
      if (!userId) return jsonResponse(400, { error: 'user_id_missing' });
      if (userId === aufrufer.user.id) return jsonResponse(400, { error: 'self_delete' });
      const ergebnis = await kontoLoeschen(admin, userId);
      if ('fehler' in ergebnis) return jsonResponse(400, { error: ergebnis.fehler });
      if (ergebnis.schonGeloescht) return jsonResponse(200, { user_id: userId, schon_geloescht: true });
      return jsonResponse(200, { user_id: userId });
    }

    return jsonResponse(400, { error: 'unknown_action' });
  } catch (error) {
    return jsonResponse(500, { error: error instanceof Error ? error.message : String(error) });
  }
});
