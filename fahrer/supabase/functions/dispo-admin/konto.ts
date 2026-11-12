// Fahrerkonto anlegen (Auth-Konto + Profil). Genutzt von aktion konto_anlegen (index.ts) und vom
// KI-Assistenten (anlegen.ts), damit beide Wege gleich anlegen.

// deno-lint-ignore-file no-explicit-any

// Benutzername wie in Migration 20261105150000_benutzername.
export const NAME_MUSTER = /^[a-z0-9._-]{3,32}$/;
// Konten ohne echte E-Mail bekommen diese Adresse. Sie wird nie angeschrieben (email_confirm).
export const PLATZHALTER_DOMAIN = 'konto.trisar.de';
export const istPlatzhalter = (email: string) => email.endsWith(`@${PLATZHALTER_DOMAIN}`);

export const fehlerText = (message: string) => {
  if (/already (been )?registered|already exists/i.test(message)) return 'email_taken';
  if (/password/i.test(message) && /(short|weak|at least)/i.test(message)) return 'password_too_short';
  if (/invalid format|unable to validate email/i.test(message)) return 'email_invalid';
  return message;
};

export type KontoDaten = {
  benutzername: string;
  email?: string;
  passwort: string;
  first_name?: string;
  last_name?: string;
  // Nur vom KI-Assistenten, das Formular schreibt diese Felder danach selbst ins Profil.
  profil?: Record<string, unknown>;
};

// Legt Auth-Konto und Profil an. Schlaegt das Profil fehl, wird das Konto wieder geloescht.
export const kontoAnlegen = async (admin: any, d: KontoDaten): Promise<{ userId: string } | { fehler: string }> => {
  const name = String(d.benutzername || '').trim().toLowerCase();
  const email = String(d.email || '').trim().toLowerCase();
  if (!name && !email) return { fehler: 'login_missing' };
  if (name && !NAME_MUSTER.test(name)) return { fehler: 'username_invalid' };
  if (!d.passwort) return { fehler: 'password_missing' };
  if (d.passwort.length < 8) return { fehler: 'password_too_short' };
  if (name) {
    const { data: belegt } = await admin.from('profiles').select('id').eq('username', name).maybeSingle();
    if (belegt?.id) return { fehler: 'username_taken' };
  }
  const vor = String(d.first_name || '').trim();
  const nach = String(d.last_name || '').trim();
  const { data, error } = await admin.auth.admin.createUser({
    email: email || `${name}@${PLATZHALTER_DOMAIN}`,
    password: d.passwort,
    email_confirm: true,
    user_metadata: { first_name: vor, last_name: nach, role: 'fahrer', password_setup_required: false },
  });
  if (error || !data?.user?.id) return { fehler: fehlerText(error?.message || 'create_failed') };
  const neueId = data.user.id;
  const { error: profilFehler } = await admin.from('profiles').upsert([{
    id: neueId,
    username: name || null,
    email: email || null,
    first_name: vor || null,
    last_name: nach || null,
    role: 'fahrer',
    ...(d.profil || {}),
  }]);
  if (profilFehler) {
    await admin.auth.admin.deleteUser(neueId);
    return { fehler: profilFehler.message };
  }
  return { userId: neueId };
};
