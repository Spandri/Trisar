// Anmeldung der Disposition im Live-Betrieb. Die Demo braucht keine Anmeldung.
// Rein kommt nur, wer in profiles als Disposition markiert ist
// (is_dispo = true oder role dispo/admin). Alle anderen werden wieder abgemeldet.
import { useEffect, useState } from 'react';
import { supabase } from '../services/supabase';
import TrisarFooter from './ui/TrisarFooter';

const DISPO_ROLLEN = new Set(['dispo', 'dispatcher', 'admin', 'koordinator', 'coordinator']);

const istDisposition = async (userId) => {
  const { data, error } = await supabase
    .from('profiles')
    .select('role, is_dispo')
    .eq('id', userId)
    .maybeSingle();
  if (error || !data) return false;
  return data.is_dispo === true || DISPO_ROLLEN.has(String(data.role || '').toLowerCase());
};

// Supabase raeumt den Link-Anhang beim Start weg, darum hier sofort merken.
let ausMailLink = typeof window !== 'undefined' && /type=(recovery|invite)/.test(window.location.hash);

// Aussehen 1:1 wie der Login der Fahrer-App (fahrer/src/features/auth/LoginView.jsx).
const screenBg = {
  backgroundImage:
    "url(\"data:image/svg+xml;utf8,<svg viewBox='0 0 402 874' xmlns='http://www.w3.org/2000/svg' preserveAspectRatio='none'><rect x='0' y='0' height='100%' width='100%' fill='url(%23grad)' opacity='1'/><defs><radialGradient id='grad' gradientUnits='userSpaceOnUse' cx='0' cy='0' r='10' gradientTransform='matrix(40.2 87.4 -40.2 18.49 0 0)'><stop stop-color='rgba(49,55,1,1)' offset='0'/><stop stop-color='rgba(25,28,0,1)' offset='0.2283'/><stop stop-color='rgba(12,14,0,1)' offset='0.34244'/><stop stop-color='rgba(0,0,0,1)' offset='0.45659'/><stop stop-color='rgba(0,0,0,1)' offset='0.83626'/><stop stop-color='rgba(0,0,0,1)' offset='1'/></radialGradient></defs></svg>\")",
};

const eingabeKlasse = 'w-full bg-[#242525] border border-[#3a3a3a] text-[#868786] text-[15px] px-12 py-4 focus:outline-none focus:border-[#e3f754]';

const MailSymbol = () => (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M15.8333 5H4.16667C3.24619 5 2.5 5.74619 2.5 6.66667V13.3333C2.5 14.2538 3.24619 15 4.16667 15H15.8333C16.7538 15 17.5 14.2538 17.5 13.3333V6.66667C17.5 5.74619 16.7538 5 15.8333 5Z" stroke="#868786" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="m2.5 6.66669 7.5 5.83331 7.5-5.83331" stroke="#868786" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

const SchlossSymbol = () => (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M15 8.33333H5C4.07952 8.33333 3.33333 9.07952 3.33333 10V16.6667C3.33333 17.5871 4.07952 18.3333 5 18.3333H15C15.9205 18.3333 16.6667 17.5871 16.6667 16.6667V10C16.6667 9.07952 15.9205 8.33333 15 8.33333Z" stroke="#868786" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M6.66669 8.33333V5C6.66669 3.89493 7.10567 2.83512 7.88582 2.05496C8.66598 1.2748 9.72579 0.835815 10.8309 0.835815C11.936 0.835815 12.9958 1.2748 13.7759 2.05496C14.5561 2.83512 14.9951 3.89493 14.9951 5V8.33333" stroke="#868786" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

const Feld = ({ label, symbol, children }) => (
  <div className="flex flex-col gap-2">
    <label className="text-[#e3f754] text-[13px] font-medium pl-1">{label}</label>
    <div className="relative">
      <div className="absolute left-4 top-1/2 transform -translate-y-1/2 w-5 h-5">{symbol}</div>
      {children}
    </div>
  </div>
);

const Auge = ({ sichtbar, onClick }) => (
  <button
    type="button"
    className="absolute right-4 top-1/2 transform -translate-y-1/2 w-5 h-5 cursor-pointer"
    onClick={onClick}
    aria-label={sichtbar ? 'Passwort ausblenden' : 'Passwort anzeigen'}
  >
    <img
      src={sichtbar ? '/icon/_Icon_Grau/Auge_geschlossen_Trisar_Icons_01_grau.svg' : '/icon/_Icon_Grau/Auge_offen_Trisar_Icons_01_grau.svg'}
      alt=""
      className="w-5 h-5 object-contain"
    />
  </button>
);

const knopfKlasse = 'w-full bg-[#e3f754] text-black rounded-none py-4 text-[15px] font-bold hover:bg-[#d4ff28] transition-all disabled:opacity-70';

export default function AnmeldeTor({ children }) {
  // pruefen | abgemeldet | neuesPasswort | drin
  const [zustand, setZustand] = useState('pruefen');
  const [email, setEmail] = useState('');
  const [passwort, setPasswort] = useState('');
  const [fehler, setFehler] = useState('');
  const [hinweis, setHinweis] = useState('');
  const [laeuft, setLaeuft] = useState(false);
  const [passwortSichtbar, setPasswortSichtbar] = useState(false);

  useEffect(() => {
    let aktiv = true;
    const sitzungPruefen = async (session) => {
      if (!session?.user) {
        if (aktiv) setZustand('abgemeldet');
        return;
      }
      const erlaubt = await istDisposition(session.user.id);
      if (!aktiv) return;
      if (erlaubt) {
        setZustand('drin');
        return;
      }
      await supabase.auth.signOut();
      setFehler('Dieses Konto hat keinen Zugang zur Disposition.');
      setZustand('abgemeldet');
    };

    supabase.auth.getSession().then(({ data }) => {
      if (ausMailLink && data?.session) {
        if (aktiv) setZustand('neuesPasswort');
        return;
      }
      sitzungPruefen(data?.session);
    });
    const { data: abo } = supabase.auth.onAuthStateChange((ereignis, session) => {
      if (ereignis === 'SIGNED_OUT') setZustand('abgemeldet');
      // Link aus der Reset- oder Einladungs-Mail: erst neues Passwort setzen.
      if (ereignis === 'PASSWORD_RECOVERY') setZustand('neuesPasswort');
      if (ereignis === 'SIGNED_IN' && !ausMailLink) sitzungPruefen(session);
    });
    return () => {
      aktiv = false;
      abo?.subscription?.unsubscribe();
    };
  }, []);

  const anmelden = async (event) => {
    event.preventDefault();
    if (laeuft) return;
    setFehler('');
    setHinweis('');
    setLaeuft(true);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: passwort });
    setLaeuft(false);
    if (error) setFehler('E-Mail oder Passwort falsch.');
  };

  const passwortVergessen = async () => {
    setFehler('');
    const adresse = email.trim();
    if (!adresse) {
      setFehler('Bitte zuerst die E-Mail eingeben.');
      return;
    }
    await supabase.auth.resetPasswordForEmail(adresse, { redirectTo: window.location.origin });
    setHinweis('Falls das Konto existiert, ist ein Link zum Zuruecksetzen unterwegs.');
  };

  const passwortSetzen = async (event) => {
    event.preventDefault();
    setFehler('');
    if (passwort.length < 8) {
      setFehler('Mindestens 8 Zeichen.');
      return;
    }
    setLaeuft(true);
    const { data, error } = await supabase.auth.updateUser({ password: passwort });
    setLaeuft(false);
    if (error) {
      setFehler('Passwort konnte nicht gesetzt werden. Bitte Link neu anfordern.');
      return;
    }
    ausMailLink = false;
    window.history.replaceState(null, '', window.location.pathname);
    setPasswort('');
    const erlaubt = data?.user ? await istDisposition(data.user.id) : false;
    if (erlaubt) setZustand('drin');
    else {
      await supabase.auth.signOut();
      setFehler('Dieses Konto hat keinen Zugang zur Disposition.');
      setZustand('abgemeldet');
    }
  };

  if (zustand === 'drin') return children;
  if (zustand === 'pruefen') return <div className="min-h-dvh bg-black" />;

  const passwortFeld = (autoComplete, platzhalter) => (
    <Feld label={zustand === 'neuesPasswort' ? 'Neues Passwort' : 'Passwort'} symbol={<SchlossSymbol />}>
      <input
        type={passwortSichtbar ? 'text' : 'password'}
        autoComplete={autoComplete}
        value={passwort}
        onChange={(e) => setPasswort(e.target.value)}
        placeholder={platzhalter}
        className={eingabeKlasse}
      />
      <Auge sichtbar={passwortSichtbar} onClick={() => setPasswortSichtbar((prev) => !prev)} />
    </Feld>
  );

  return (
    <div
      className="flex min-h-screen min-h-dvh items-start justify-center overflow-y-auto overflow-x-hidden overscroll-none bg-black"
      style={{ WebkitTextSizeAdjust: 'none', textSizeAdjust: 'none' }}
    >
      <div className="w-[min(402px,100vw)] min-h-dvh h-[950px] relative mx-auto overflow-hidden">
        <div className="absolute inset-0" style={screenBg} />

        <div className="absolute left-5 top-[103px] w-[362px] h-[53px]">
          <img src="/icon/_Icon_Schwarz/trisar_logo.svg" alt="trisar" className="absolute left-0 top-[14px] w-[161.79px] h-6 object-contain" />
          <img src="/icon/_Icon_Schwarz/partner_x.svg" alt="" className="absolute left-[195px] top-[17px] w-5 h-5 object-contain" />
          <img src="/icon/_Icon_Schwarz/partner_logo.svg" alt="partner" className="absolute left-[249px] top-0 w-[113px] h-[53px] object-contain" />
        </div>

        <div className="absolute left-5 top-[212px] w-[362px] h-[304px]">
          {zustand === 'neuesPasswort' ? (
            <form onSubmit={passwortSetzen} className="space-y-6">
              {passwortFeld('new-password', 'mindestens 8 Zeichen')}
              <button type="submit" disabled={laeuft} className={knopfKlasse}>
                Passwort speichern
              </button>
              {fehler ? <p className="text-red-400 text-[13px] text-center font-medium">{fehler}</p> : null}
            </form>
          ) : (
            <form onSubmit={anmelden} className="space-y-6">
              <Feld label="E-Mail" symbol={<MailSymbol />}>
                <input
                  type="email"
                  autoComplete="username"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="deine@email.de"
                  className={eingabeKlasse}
                />
              </Feld>
              {passwortFeld('current-password', '••••••••')}
              <div className="text-center">
                <button type="button" onClick={passwortVergessen} className="text-[#868786] text-[13px] hover:text-[#e3f754]">
                  Passwort vergessen?
                </button>
              </div>
              <button type="submit" disabled={laeuft} className={knopfKlasse}>
                Anmelden
              </button>
              {fehler ? <p className="text-red-400 text-[13px] text-center font-medium">{fehler}</p> : null}
              {hinweis ? <p className="text-[#e3f754] text-[13px] text-center">{hinweis}</p> : null}
            </form>
          )}
        </div>

        <div className="absolute left-5 w-[362px] top-[586px]">
          <img src="/icon/_Icon_Lime/Arrow_Trisar_Icons_01_Lime.svg" alt="" className="block w-full h-auto" />
        </div>

        <TrisarFooter className="fixed bottom-0 left-1/2 -translate-x-1/2 w-[min(402px,100vw)] h-10 bg-black z-30" />
      </div>
    </div>
  );
}
