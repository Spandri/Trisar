import React, { useEffect, useState } from 'react';
import RoleRouter from './app/RoleRouter';
import LoginView from './features/auth/LoginView';
import { ebeneFuer } from './components/ui/tastaturHelfer';
import LinkVersendetView from './features/auth/LinkVersendetView';
import PasswortVergessenView from './features/auth/PasswortVergessenView';
import RegistrierungView from './features/auth/RegistrierungView';
import { useAuthSession, TRAILER_AKTIV, trailerFreigabe } from './features/auth/useAuthSession';
import TutorialBridge from './demo/TutorialBridge';
import { beiUeberspringen } from './demo/ueberspringen';

const RESEND_COOLDOWN_MS = 10 * 60 * 1000;

// Zugangsdaten, die der Demo-Trailer sichtbar eintippt.
const DEMO_TRAILER_MAIL = 'stefano.spandri@trisar.de';
const DEMO_TRAILER_PASS = 'trisar2026';

const App = () => {
  const {
    authError,
    authLoading,
    clearAuthError,
    profileRole,
    requiresPasswordSetup,
    sendPasswordResetEmail,
    setNewPassword,
    session,
    signInWithPassword,
    signOut,
  } = useAuthSession();
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [newPassword, setNewPasswordInput] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [authScreen, setAuthScreen] = useState('login');
  const [lastResetLinkSentAt, setLastResetLinkSentAt] = useState(null);
  // Demo-Trailer: Tastatur faehrt hoch, Zugangsdaten werden sichtbar
  // eingetippt, danach meldet sich die App selbst an. Laeuft nur bei
  // ?trailer=1 — beim Wechsel zwischen Dispo und Fahrer nicht erneut.
  const [tastaturOben, setTastaturOben] = useState(false);
  const [knopfGedrueckt, setKnopfGedrueckt] = useState(false);
  // Zeichen, dessen Taste gerade angeschlagen wird — laesst die Bildschirm-
  // tastatur beim Tippen sichtbar mitgehen.
  const [getipptesZeichen, setGetipptesZeichen] = useState(null);
  // Welche Tastaturebene gerade zu sehen ist und ob das E-Mail-Feld dran ist
  // (dort blendet iOS zusaetzlich @ und . ein).
  const [tastaturEbene, setTastaturEbene] = useState('abc');
  const [tastaturMail, setTastaturMail] = useState(true);

  // Startet erst nach der Logo-Animation (siehe main.jsx).
  const [splashFertig, setSplashFertig] = useState(
    () => typeof window !== 'undefined' && Boolean(window.__TRISAR_SPLASH_FERTIG),
  );
  useEffect(() => {
    if (splashFertig) return undefined;
    const melde = () => setSplashFertig(true);
    window.addEventListener('trisar:splash-fertig', melde);
    return () => window.removeEventListener('trisar:splash-fertig', melde);
  }, [splashFertig]);

  useEffect(() => {
    if (!TRAILER_AKTIV || authLoading || session || !splashFertig) return undefined;
    let abgebrochen = false;
    // Easter Egg: Doppelklick oder Esc springt ans Ende des Trailers. Der
    // laufende Schlaf wird dabei sofort geweckt, damit der Ablauf nicht erst
    // seinen Takt zu Ende wartet.
    let sprung = false;
    let wecken = null;
    const loesen = beiUeberspringen(() => {
      sprung = true;
      if (wecken) wecken();
    });
    const schlafen = (ms) => new Promise((r) => {
      if (sprung) { r(); return; }
      const id = setTimeout(() => { wecken = null; r(); }, ms);
      wecken = () => { clearTimeout(id); wecken = null; r(); };
    });
    // Eine Taste sichtbar anschlagen: kurz eingedrueckt, dann los.
    const anschlagen = async (zeichen, proZeichen) => {
      if (sprung) return;
      setGetipptesZeichen(zeichen);
      const druck = Math.min(90, Math.max(45, proZeichen * 0.55));
      await schlafen(druck);
      if (abgebrochen) return;
      setGetipptesZeichen(null);
      await schlafen(Math.max(0, proZeichen - druck));
    };

    const tippen = async (setzen, text, proZeichen, istMail) => {
      let ebene = 'abc';
      setTastaturMail(istMail);
      setTastaturEbene(ebene);
      for (let i = 1; i <= text.length; i += 1) {
        if (abgebrochen || sprung) return;
        const zeichen = text[i - 1];
        const noetig = ebeneFuer(zeichen, istMail);
        if (noetig && noetig !== ebene) {
          // Erst die Umschalttaste druecken, dann wechselt die Ebene — 123 und
          // ABC schreiben nichts, sie blaettern nur um.
          // eslint-disable-next-line no-await-in-loop
          await anschlagen(noetig === 'zahlen' ? '123' : 'ABC', proZeichen);
          if (abgebrochen) return;
          ebene = noetig;
          setTastaturEbene(ebene);
          // eslint-disable-next-line no-await-in-loop
          await schlafen(140);
          if (abgebrochen) return;
        }
        setzen(text.slice(0, i));
        // eslint-disable-next-line no-await-in-loop
        await anschlagen(zeichen, proZeichen);
      }
    };
    const ablauf = async () => {
      await schlafen(1100);
      if (abgebrochen || sprung) return;
      setTastaturOben(true);
      await schlafen(900);
      await tippen(setLoginEmail, DEMO_TRAILER_MAIL, 105, true);
      await schlafen(700);
      await tippen(setLoginPassword, DEMO_TRAILER_PASS, 150, false);
      await schlafen(650);
      if (abgebrochen || sprung) return;
      setGetipptesZeichen(null);
      setKnopfGedrueckt(true);
      setTastaturOben(false);
      await schlafen(620);
      if (abgebrochen || sprung) return;
      setKnopfGedrueckt(false);
    };

    (async () => {
      await ablauf();
      if (abgebrochen) return;
      if (sprung) {
        // Uebersprungen: die Maske so hinterlassen, wie der Trailer sie
        // abgegeben haette — ausgefuellt, Tastatur unten, Knopf nicht gedrueckt.
        setGetipptesZeichen(null);
        setTastaturOben(false);
        setKnopfGedrueckt(false);
        setLoginEmail(DEMO_TRAILER_MAIL);
      }
      // Freigabe: ab jetzt darf die Demo-Anmeldung greifen.
      trailerFreigabe.wert = true;
      await signInWithPassword({ email: DEMO_TRAILER_MAIL, password: DEMO_TRAILER_PASS });
      setLoginPassword('');
      try {
        window.parent?.postMessage({ trisar: 'trailer-fertig' }, '*');
      } catch {
        // Kein Rahmen vorhanden — die App laeuft eigenstaendig weiter.
      }
    })();
    return () => { abgebrochen = true; loesen(); };
  }, [authLoading, session, signInWithPassword, splashFertig]);

  const handleLogin = async (e) => {
    e.preventDefault();
    const ok = await signInWithPassword({ email: loginEmail, password: loginPassword });
    if (ok) setLoginPassword('');
  };

  const openForgotPassword = () => {
    clearAuthError();
    setAuthScreen('forgotPassword');
  };

  const backToLogin = () => {
    clearAuthError();
    setAuthScreen('login');
  };

  const handleSendResetLink = async () => {
    if (
      authScreen === 'linkSent' &&
      typeof lastResetLinkSentAt === 'number' &&
      Date.now() - lastResetLinkSentAt < RESEND_COOLDOWN_MS
    ) {
      return;
    }

    const ok = await sendPasswordResetEmail({
      email: loginEmail,
      redirectTo: window.location.origin,
    });
    if (!ok) return;
    setLastResetLinkSentAt(Date.now());
    setAuthScreen('linkSent');
  };

  const handleSetPassword = async () => {
    clearAuthError();
    if (newPassword !== confirmPassword) {
      return;
    }
    const ok = await setNewPassword({ password: newPassword });
    if (!ok) return;
    const inviteEmail = String(session?.user?.email || '').trim();
    if (inviteEmail) setLoginEmail(inviteEmail);
    setLoginPassword(newPassword);
    setNewPasswordInput('');
    setConfirmPassword('');
    await signOut();
    setAuthScreen('login');
  };

  if (authLoading) {
    return <div className="min-h-screen bg-[#0a0a0a]" />;
  }

  if (requiresPasswordSetup) {
    const inviteEmail = String(session?.user?.email || loginEmail || '').trim();
    return (
      <RegistrierungView
        email={inviteEmail}
        password={newPassword}
        confirmPassword={confirmPassword}
        setPassword={setNewPasswordInput}
        setConfirmPassword={setConfirmPassword}
        onRegister={(event) => {
          event.preventDefault();
          handleSetPassword();
        }}
        authError={
          newPassword && confirmPassword && newPassword !== confirmPassword
            ? 'Passwörter stimmen nicht überein.'
            : authError
        }
      />
    );
  }

  if (!session) {
    if (authScreen === 'forgotPassword') {
      return (
        <PasswortVergessenView
          email={loginEmail}
          setEmail={setLoginEmail}
          onSendResetLink={handleSendResetLink}
          onBackToLogin={backToLogin}
          authError={authError}
        />
      );
    }
    if (authScreen === 'linkSent') {
      return (
        <LinkVersendetView
          onSendResetLink={handleSendResetLink}
          onBackToLogin={backToLogin}
          authError={authError}
          lastResetLinkSentAt={lastResetLinkSentAt}
        />
      );
    }

    return (
      <LoginView
        email={loginEmail}
        password={loginPassword}
        setEmail={setLoginEmail}
        setPassword={setLoginPassword}
        onLogin={handleLogin}
        onForgotPassword={openForgotPassword}
        authError={authError}
        tastaturOben={tastaturOben}
        knopfGedrueckt={knopfGedrueckt}
        getipptesZeichen={getipptesZeichen}
        tastaturEbene={tastaturEbene}
        tastaturMail={tastaturMail}
      />
    );
  }

  return (
    <>
      <RoleRouter session={session} profileRole={profileRole} />
      <TutorialBridge />
    </>
  );
};

export default App;
