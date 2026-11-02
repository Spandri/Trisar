import React from 'react';
import TrisarFooter from '../../components/ui/TrisarFooter';
import {
  PARTNER_LOGO_URL,
  PARTNER_X_URL,
  RIDE_ARROW_RIGHT_URL,
  TRISAR_LOGO_URL,
} from '../../shared/ui/icons';

const screenBg = {
  backgroundImage:
    "url(\"data:image/svg+xml;utf8,<svg viewBox='0 0 402 874' xmlns='http://www.w3.org/2000/svg' preserveAspectRatio='none'><rect x='0' y='0' height='100%' width='100%' fill='url(%23grad)' opacity='1'/><defs><radialGradient id='grad' gradientUnits='userSpaceOnUse' cx='0' cy='0' r='10' gradientTransform='matrix(40.2 87.4 -40.2 18.49 0 0)'><stop stop-color='rgba(49,55,1,1)' offset='0'/><stop stop-color='rgba(25,28,0,1)' offset='0.2283'/><stop stop-color='rgba(12,14,0,1)' offset='0.34244'/><stop stop-color='rgba(0,0,0,1)' offset='0.45659'/><stop stop-color='rgba(0,0,0,1)' offset='0.83626'/><stop stop-color='rgba(0,0,0,1)' offset='1'/></radialGradient></defs></svg>\")",
};

const PasswortSetzenView = ({
  password,
  confirmPassword,
  setPassword,
  setConfirmPassword,
  onSubmit,
  onBackToLogin,
  authError,
}) => {
  const handleSubmit = (event) => {
    event.preventDefault();
    onSubmit?.();
  };

  return (
    <div
      className="flex min-h-screen min-h-dvh items-start justify-center overflow-y-auto overflow-x-hidden overscroll-none bg-black"
      style={{ WebkitTextSizeAdjust: 'none', textSizeAdjust: 'none' }}
    >
      <div className="w-[min(402px,100vw)] min-h-dvh h-[950px] relative mx-auto overflow-hidden">
        <div className="absolute inset-0" style={screenBg} />

        <div className="absolute left-5 top-[103px] w-[362px] h-[53px]">
          <img src={TRISAR_LOGO_URL} alt="trisar" className="absolute left-0 top-[14px] w-[161.79px] h-6 object-contain" />
          <img src={PARTNER_X_URL} alt="" className="absolute left-[195px] top-[17px] w-5 h-5 object-contain" />
          <img src={PARTNER_LOGO_URL} alt="partner" className="absolute left-[249px] top-0 w-[113px] h-[53px] object-contain" />
        </div>

        <div className="absolute left-5 top-[214px] w-[362px]">
          <div className="text-[#e3f754] text-[24px] leading-[30px] font-bold tracking-[-0.5px]">Passwort setzen</div>
          <p className="mt-4 text-[#868786] text-[12px] leading-[18px] font-medium tracking-[-0.2px]">
            Setze jetzt dein neues Passwort. Danach kannst du dich normal in der Fahrer-App anmelden.
          </p>

          <form onSubmit={handleSubmit} className="mt-8 space-y-6">
            <div className="flex flex-col gap-2">
              <label className="text-[#e3f754] text-[13px] font-medium pl-1">Neues Passwort</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword?.(e.target.value)}
                placeholder="Mindestens 8 Zeichen"
                className="w-full bg-[#242525] border border-[#3a3a3a] text-[#868786] text-[15px] px-4 py-4 focus:outline-none focus:border-[#e3f754]"
              />
            </div>

            <div className="flex flex-col gap-2">
              <label className="text-[#e3f754] text-[13px] font-medium pl-1">Passwort wiederholen</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword?.(e.target.value)}
                placeholder="Passwort wiederholen"
                className="w-full bg-[#242525] border border-[#3a3a3a] text-[#868786] text-[15px] px-4 py-4 focus:outline-none focus:border-[#e3f754]"
              />
            </div>

            <button
              type="submit"
              className="w-full bg-[#e3f754] text-black rounded-none py-4 text-[15px] font-bold hover:bg-[#d4ff28] transition-colors"
            >
              Passwort speichern
            </button>

            {authError && (
              <p className="text-red-400 text-[13px] text-center font-medium">{authError}</p>
            )}

            <button
              type="button"
              onClick={() => onBackToLogin?.()}
              className="w-full text-center text-[#868786] text-[13px] font-medium hover:text-[#e3f754]"
            >
              Zurück zur Anmeldung
            </button>
          </form>

          <div className="mt-[70px]">
            <img src={RIDE_ARROW_RIGHT_URL} alt="" className="block w-full h-auto" />
          </div>
        </div>

        <TrisarFooter className="fixed bottom-0 left-1/2 -translate-x-1/2 w-[min(402px,100vw)] h-10 bg-black z-30" />
      </div>
    </div>
  );
};

export default PasswortSetzenView;
