// Anmeldung mit Benutzername oder E-Mail plus Passwort.
// Mit @ direkt bei Supabase Auth, sonst ueber die Edge Function anmelden,
// die den Benutzernamen auf dem Server in die E-Mail des Kontos aufloest.
// Gleiche Datei in fahrer/src/shared und admin/src/shared.
export const anmeldenMitKennung = async (supabase, kennung, passwort) => {
  const eingabe = String(kennung || '').trim();
  if (!eingabe || !passwort) return { error: new Error('invalid_credentials') };

  if (eingabe.includes('@')) {
    const { error } = await supabase.auth.signInWithPassword({ email: eingabe, password: passwort });
    return { error: error || null };
  }

  const { data, error } = await supabase.functions.invoke('anmelden', {
    body: { kennung: eingabe, passwort },
  });
  if (error || !data?.access_token || !data?.refresh_token) {
    return { error: error || new Error('invalid_credentials') };
  }
  const { error: sitzungsFehler } = await supabase.auth.setSession({
    access_token: data.access_token,
    refresh_token: data.refresh_token,
  });
  return { error: sitzungsFehler || null };
};
