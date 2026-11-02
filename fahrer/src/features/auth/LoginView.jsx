import React, { useState } from 'react';
import TrisarFooter from '../../components/ui/TrisarFooter';
import {
  PARTNER_LOGO_URL,
  PARTNER_X_URL,
  PASSWORD_EYE_CLOSED_ICON_URL,
  PASSWORD_EYE_OPEN_ICON_URL,
  RIDE_ARROW_RIGHT_URL,
  TRISAR_LOGO_URL,
} from '../../shared/ui/icons';
import { DEMO_MODE } from '../../datenquelle';

const screenBg = {
  backgroundImage:
    "url(\"data:image/svg+xml;utf8,<svg viewBox='0 0 402 874' xmlns='http://www.w3.org/2000/svg' preserveAspectRatio='none'><rect x='0' y='0' height='100%' width='100%' fill='url(%23grad)' opacity='1'/><defs><radialGradient id='grad' gradientUnits='userSpaceOnUse' cx='0' cy='0' r='10' gradientTransform='matrix(40.2 87.4 -40.2 18.49 0 0)'><stop stop-color='rgba(49,55,1,1)' offset='0'/><stop stop-color='rgba(25,28,0,1)' offset='0.2283'/><stop stop-color='rgba(12,14,0,1)' offset='0.34244'/><stop stop-color='rgba(0,0,0,1)' offset='0.45659'/><stop stop-color='rgba(0,0,0,1)' offset='0.83626'/><stop stop-color='rgba(0,0,0,1)' offset='1'/></radialGradient></defs></svg>\")",
};

import Bildschirmtastatur from '../../components/ui/Bildschirmtastatur';
import { tasteFuer, vorschlaegeFuer } from '../../components/ui/tastaturHelfer';

const LoginView = ({
  email,
  password,
  setEmail,
  setPassword,
  onLogin,
  onForgotPassword,
  authError,
  // Demo-Trailer: Tastatur einblenden, Anmelde-Knopf gedrueckt zeigen.
  tastaturOben = false,
  knopfGedrueckt = false,
  // Demo-Trailer: Zeichen, dessen Taste gerade angeschlagen wird.
  getipptesZeichen = null,
  tastaturEbene = 'abc',
  tastaturMail = false,
}) => {
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);

  return (
    <div
      className="flex min-h-screen min-h-dvh items-start justify-center overflow-y-auto overflow-x-hidden overscroll-none bg-black"
      style={{ WebkitTextSizeAdjust: 'none', textSizeAdjust: 'none' }}
    >
      <div className="w-[min(402px,100vw)] min-h-dvh h-[950px] relative mx-auto overflow-hidden">
        <div className="absolute inset-0" style={screenBg} />

        <div className="absolute left-5 top-[103px] w-[362px] h-[53px]">
          <img src={TRISAR_LOGO_URL} alt="trisar" className="absolute left-0 top-[14px] w-[161.79px] h-6 object-contain" />
          {/* Kundenlogo (trisar x Kunde) nur im Live-Betrieb, die Demo zeigt nur trisar. */}
          {!DEMO_MODE ? (
            <>
              <img src={PARTNER_X_URL} alt="" className="absolute left-[195px] top-[17px] w-5 h-5 object-contain" />
              <img src={PARTNER_LOGO_URL} alt="partner" className="absolute left-[249px] top-0 w-[113px] h-[53px] object-contain" />
            </>
          ) : null}
        </div>

        <div className="absolute left-5 top-[212px] w-[362px] h-[304px]">
          <form onSubmit={onLogin} className="space-y-6">
            <div className="flex flex-col gap-2">
              <label className="text-[#e3f754] text-[13px] font-medium pl-1">
                E-Mail
              </label>
              <div className="relative">
                <div className="absolute left-4 top-1/2 transform -translate-y-1/2 w-5 h-5">
                  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M15.8333 5H4.16667C3.24619 5 2.5 5.74619 2.5 6.66667V13.3333C2.5 14.2538 3.24619 15 4.16667 15H15.8333C16.7538 15 17.5 14.2538 17.5 13.3333V6.66667C17.5 5.74619 16.7538 5 15.8333 5Z" stroke="#868786" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                    <path d="m2.5 6.66669 7.5 5.83331 7.5-5.83331" stroke="#868786" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </div>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="deine@email.de"
                  className="w-full bg-[#242525] border border-[#3a3a3a] text-[#868786] text-[15px] px-12 py-4 focus:outline-none focus:border-[#e3f754]"
                />
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <label className="text-[#e3f754] text-[13px] font-medium pl-1">
                Passwort
              </label>
              <div className="relative">
                <div className="absolute left-4 top-1/2 transform -translate-y-1/2 w-5 h-5">
                  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M15 8.33333H5C4.07952 8.33333 3.33333 9.07952 3.33333 10V16.6667C3.33333 17.5871 4.07952 18.3333 5 18.3333H15C15.9205 18.3333 16.6667 17.5871 16.6667 16.6667V10C16.6667 9.07952 15.9205 8.33333 15 8.33333Z" stroke="#868786" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                    <path d="M6.66669 8.33333V5C6.66669 3.89493 7.10567 2.83512 7.88582 2.05496C8.66598 1.2748 9.72579 0.835815 10.8309 0.835815C11.936 0.835815 12.9958 1.2748 13.7759 2.05496C14.5561 2.83512 14.9951 3.89493 14.9951 5V8.33333" stroke="#868786" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </div>
                <input
                  type={isPasswordVisible ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full bg-[#242525] border border-[#3a3a3a] text-[#868786] text-[15px] px-12 py-4 focus:outline-none focus:border-[#e3f754]"
                />
                <button
                  type="button"
                  className="absolute right-4 top-1/2 transform -translate-y-1/2 w-5 h-5 cursor-pointer"
                  onClick={() => setIsPasswordVisible((prev) => !prev)}
                  aria-label={isPasswordVisible ? 'Passwort ausblenden' : 'Passwort anzeigen'}
                >
                  <img
                    src={isPasswordVisible ? PASSWORD_EYE_CLOSED_ICON_URL : PASSWORD_EYE_OPEN_ICON_URL}
                    alt=""
                    className="w-5 h-5 object-contain"
                  />
                </button>
              </div>
            </div>

            <div className="text-center">
              <button
                type="button"
                onClick={() => onForgotPassword?.()}
                className="text-[#868786] text-[13px] hover:text-[#e3f754]"
              >
                Passwort vergessen?
              </button>
            </div>

            <button 
              type="submit" 
              style={knopfGedrueckt ? { transform: 'scale(0.97)', filter: 'brightness(0.85)' } : undefined}
              className="w-full bg-[#e3f754] text-black rounded-none py-4 text-[15px] font-bold hover:bg-[#d4ff28] transition-all"
            >
              Anmelden
            </button>

            {authError && (
              <p className="text-red-400 text-[13px] text-center font-medium">
                {authError}
              </p>
            )}
          </form>
        </div>

        <div className="absolute left-5 w-[362px] top-[586px]">
          <img src={RIDE_ARROW_RIGHT_URL} alt="" className="block w-full h-auto" />
        </div>

        <Bildschirmtastatur
          oben={tastaturOben}
          aktiveTaste={tasteFuer(getipptesZeichen)}
          ebene={tastaturEbene}
          istMail={tastaturMail}
          vorschlaege={tastaturMail ? vorschlaegeFuer(email) : []}
        />

        <TrisarFooter className="fixed bottom-0 left-1/2 -translate-x-1/2 w-[min(402px,100vw)] h-10 bg-black z-30" />
      </div>
    </div>
  );
};

export default LoginView;
