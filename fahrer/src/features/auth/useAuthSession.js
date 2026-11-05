import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../shared/supabase/client';
import { anmeldenMitKennung } from '../../shared/anmeldung';

// Demo-Trailer: bis zur Freigabe bleibt die Sitzung bewusst leer.
export const TRAILER_AKTIV = typeof window !== 'undefined'
  && new URLSearchParams(window.location.search).get('trailer') === '1';
export const trailerFreigabe = { wert: !TRAILER_AKTIV };

const PASSWORD_SETUP_PENDING_KEY = 'trisar_password_setup_pending';

const readAuthTypeFromLocation = () => {
  const hashParams = new URLSearchParams(String(window.location.hash || '').replace(/^#/, ''));
  const queryParams = new URLSearchParams(String(window.location.search || '').replace(/^\?/, ''));
  return String(hashParams.get('type') || queryParams.get('type') || '').trim().toLowerCase();
};

const readAuthLinkTokenHash = () => {
  const hashParams = new URLSearchParams(String(window.location.hash || '').replace(/^#/, ''));
  const queryParams = new URLSearchParams(String(window.location.search || '').replace(/^\?/, ''));
  return String(hashParams.get('token_hash') || queryParams.get('token_hash') || '').trim();
};

const readAuthLinkCode = () => {
  const hashParams = new URLSearchParams(String(window.location.hash || '').replace(/^#/, ''));
  const queryParams = new URLSearchParams(String(window.location.search || '').replace(/^\?/, ''));
  return String(hashParams.get('code') || queryParams.get('code') || '').trim();
};

const isPasswordSetupLinkType = (value) => value === 'recovery' || value === 'invite';

const isPasswordSetupRequiredByMetadata = (session) =>
  Boolean(
    session?.user?.user_metadata?.password_setup_required
    || session?.user?.app_metadata?.password_setup_required,
  );

const cleanupAuthUrlParams = () => {
  const rawHash = String(window.location.hash || '').replace(/^#/, '');
  if (!rawHash) return;
  const params = new URLSearchParams(rawHash);
  const keysToDelete = [
    'access_token',
    'refresh_token',
    'token',
    'token_type',
    'type',
    'expires_in',
    'expires_at',
  ];
  let changed = false;
  keysToDelete.forEach((key) => {
    if (params.has(key)) {
      params.delete(key);
      changed = true;
    }
  });
  if (!changed) return;
  const nextHash = params.toString();
  const nextUrl = `${window.location.pathname}${window.location.search}${nextHash ? `#${nextHash}` : ''}`;
  window.history.replaceState({}, document.title, nextUrl);
};

const normalizeRole = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === 'dispo' ? 'dispo' : 'fahrer';
};

const deriveRoleFromSession = (session) => {
  const metadataRole =
    session?.user?.app_metadata?.role ||
    session?.user?.user_metadata?.role ||
    session?.user?.app_metadata?.user_role ||
    session?.user?.user_metadata?.user_role;

  if (!metadataRole) return null;
  return normalizeRole(metadataRole);
};

export const useAuthSession = () => {
  const [session, setSession] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState('');
  const [profileRole, setProfileRole] = useState('fahrer');
  const [requiresPasswordSetup, setRequiresPasswordSetup] = useState(false);

  useEffect(() => {
    const bootstrapAuth = async () => {
      try {
        const authTypeFromUrl = readAuthTypeFromLocation();
        const tokenHashFromUrl = readAuthLinkTokenHash();
        const codeFromUrl = readAuthLinkCode();
        const isSetupLink = isPasswordSetupLinkType(authTypeFromUrl) || Boolean(tokenHashFromUrl) || Boolean(codeFromUrl);

        if (isSetupLink) {
          window.localStorage.setItem(PASSWORD_SETUP_PENDING_KEY, '1');
        }

        if (codeFromUrl) {
          await supabase.auth.exchangeCodeForSession(codeFromUrl);
        } else if (tokenHashFromUrl && isPasswordSetupLinkType(authTypeFromUrl)) {
          await supabase.auth.verifyOtp({
            type: authTypeFromUrl,
            token_hash: tokenHashFromUrl,
          });
        }

        const sessionPromise = supabase.auth.getSession();
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Auth timeout while loading session.')), 8000),
        );
        const { data } = await Promise.race([sessionPromise, timeoutPromise]);
        // Demo-Trailer (?trailer=1): Anmeldung zunaechst zuruecknehmen, damit
        // der echte Login-Screen sichtbar wird und sich selbst ausfuellen kann.
        const nextSession = TRAILER_AKTIV ? null : (data?.session || null);
        const isPendingLocally = window.localStorage.getItem(PASSWORD_SETUP_PENDING_KEY) === '1';
        setSession(nextSession);
        setRequiresPasswordSetup(
          Boolean(nextSession && (
            isPasswordSetupLinkType(readAuthTypeFromLocation())
            || isPendingLocally
            || isPasswordSetupRequiredByMetadata(nextSession)
          )),
        );
      } catch (error) {
        setSession(null);
        setAuthError(error?.message || 'Auth konnte nicht initialisiert werden.');
      } finally {
        setAuthLoading(false);
      }
    };

    bootstrapAuth();

    const { data: listener } = supabase.auth.onAuthStateChange((event, newSession) => {
      // Waehrend des Trailers keine Automatik-Anmeldung durchlassen.
      if (TRAILER_AKTIV && !trailerFreigabe.wert) return;
      setSession(newSession || null);
      setAuthError('');
      if (event === 'PASSWORD_RECOVERY') {
        window.localStorage.setItem(PASSWORD_SETUP_PENDING_KEY, '1');
        setRequiresPasswordSetup(true);
        return;
      }
      if (newSession) {
        const isPendingLocally = window.localStorage.getItem(PASSWORD_SETUP_PENDING_KEY) === '1';
        setRequiresPasswordSetup(Boolean(isPendingLocally || isPasswordSetupRequiredByMetadata(newSession)));
      }
      if (!newSession) {
        setRequiresPasswordSetup(false);
      }
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    const userId = session?.user?.id;
    if (!userId) {
      setProfileRole('fahrer');
      return;
    }

    const roleFromSession = deriveRoleFromSession(session);
    if (roleFromSession) {
      setProfileRole(roleFromSession);
      return;
    }

    let cancelled = false;

    const loadRoleFromProfile = async () => {
      const { data } = await supabase
        .from('profiles')
        .select('role,is_dispo')
        .eq('id', userId)
        .maybeSingle();

      if (cancelled) return;

      const role = data?.role ? normalizeRole(data.role) : data?.is_dispo ? 'dispo' : 'fahrer';
      setProfileRole(role);
    };

    loadRoleFromProfile().catch(() => {
      if (!cancelled) setProfileRole('fahrer');
    });

    return () => {
      cancelled = true;
    };
  }, [session]);

  const signInWithPassword = async ({ email, password }) => {
    setAuthError('');
    const { error } = await anmeldenMitKennung(supabase, email, password);
    if (error) {
      setAuthError('Benutzername, E-Mail oder Passwort falsch.');
      return false;
    }
    return true;
  };

  const sendPasswordResetEmail = async ({ email, redirectTo } = {}) => {
    setAuthError('');
    const trimmedEmail = String(email || '').trim();
    if (!trimmedEmail) {
      setAuthError('Bitte gib eine E-Mail-Adresse ein.');
      return false;
    }

    const { data: emailExists, error: emailExistsError } = await supabase.rpc(
      'email_exists_for_password_reset',
      { p_email: trimmedEmail },
    );
    if (emailExistsError) {
      setAuthError('E-Mail-Pruefung fehlgeschlagen.');
      return false;
    }
    if (!emailExists) {
      setAuthError('Diese E-Mail-Adresse ist nicht registriert.');
      return false;
    }

    const resolvedRedirectTo = String(redirectTo || window.location.origin).trim();
    const options = resolvedRedirectTo ? { redirectTo: resolvedRedirectTo } : undefined;
    const { error } = await supabase.auth.resetPasswordForEmail(trimmedEmail, options);
    if (error) {
      setAuthError(error.message || 'Passwort-Reset fehlgeschlagen.');
      return false;
    }
    return true;
  };

  const signOut = async () => {
    // Nur dieses Geraet abmelden. Standard waere 'global' und wuerde auch die Dispo-Sitzung
    // desselben Kontos auf anderen Geraeten killen (gleicher Account fuer Fahrer-App und Dispo).
await supabase.auth.signOut({ scope: 'local' });
    const isPendingLocally = window.localStorage.getItem(PASSWORD_SETUP_PENDING_KEY) === '1';
    setRequiresPasswordSetup(isPendingLocally);
  };

  const clearAuthError = () => setAuthError('');

  const setNewPassword = async ({ password } = {}) => {
    setAuthError('');
    const nextPassword = String(password || '');
    if (nextPassword.length < 8) {
      setAuthError('Passwort muss mindestens 8 Zeichen haben.');
      return false;
    }
    const { error } = await supabase.auth.updateUser({
      password: nextPassword,
      data: { password_setup_required: false },
    });
    if (error) {
      setAuthError(error.message || 'Passwort konnte nicht gesetzt werden.');
      return false;
    }
    cleanupAuthUrlParams();
    window.localStorage.removeItem(PASSWORD_SETUP_PENDING_KEY);
    setRequiresPasswordSetup(false);
    return true;
  };

  return useMemo(
    () => ({
      authError,
      authLoading,
      profileRole,
      requiresPasswordSetup,
      session,
      clearAuthError,
      sendPasswordResetEmail,
      setNewPassword,
      signInWithPassword,
      signOut,
    }),
    [authError, authLoading, profileRole, requiresPasswordSetup, session],
  );
};

export { normalizeRole };
