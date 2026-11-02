import React, { useEffect, useMemo, useState } from 'react';
import TrisarFooter from '../../components/ui/TrisarFooter';
import {
  PARTNER_LOGO_URL,
  PARTNER_X_URL,
  RIDE_ARROW_RIGHT_URL,
  TRISAR_LOGO_URL,
} from '../../shared/ui/icons';
import { DEMO_MODE } from '../../datenquelle';

const screenBg = {
  backgroundImage:
    "url(\"data:image/svg+xml;utf8,<svg viewBox='0 0 402 874' xmlns='http://www.w3.org/2000/svg' preserveAspectRatio='none'><rect x='0' y='0' height='100%' width='100%' fill='url(%23grad)' opacity='1'/><defs><radialGradient id='grad' gradientUnits='userSpaceOnUse' cx='0' cy='0' r='10' gradientTransform='matrix(40.2 87.4 -40.2 18.49 0 0)'><stop stop-color='rgba(49,55,1,1)' offset='0'/><stop stop-color='rgba(25,28,0,1)' offset='0.2283'/><stop stop-color='rgba(12,14,0,1)' offset='0.34244'/><stop stop-color='rgba(0,0,0,1)' offset='0.45659'/><stop stop-color='rgba(0,0,0,1)' offset='0.83626'/><stop stop-color='rgba(0,0,0,1)' offset='1'/></radialGradient></defs></svg>\")",
};

const RESEND_COOLDOWN_MS = 10 * 60 * 1000;

const LinkVersendetView = ({
  onSendResetLink,
  onBackToLogin,
  authError,
  lastResetLinkSentAt,
}) => {
  const [nowTs, setNowTs] = useState(
    typeof lastResetLinkSentAt === 'number' ? lastResetLinkSentAt : 0,
  );

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNowTs(Date.now());
    }, 1000);

    return () => window.clearInterval(timer);
  }, []);

  const remainingMs = useMemo(() => {
    if (typeof lastResetLinkSentAt !== 'number') return 0;
    const elapsed = nowTs - lastResetLinkSentAt;
    return Math.max(0, RESEND_COOLDOWN_MS - elapsed);
  }, [lastResetLinkSentAt, nowTs]);

  const canResend = remainingMs <= 0;
  const remainingSeconds = Math.ceil(remainingMs / 1000);
  const minutes = String(Math.floor(remainingSeconds / 60)).padStart(2, '0');
  const seconds = String(remainingSeconds % 60).padStart(2, '0');
  const resendButtonText = canResend
    ? 'E-Mail erneut senden'
    : `E-Mail erneut senden in ${minutes}:${seconds}`;

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
          {/* Kundenlogo nur im Live-Betrieb, die Demo zeigt nur trisar. */}
          {!DEMO_MODE ? <img src={PARTNER_LOGO_URL} alt="partner" className="absolute left-[249px] top-0 w-[113px] h-[53px] object-contain" /> : null}
        </div>

        <div className="absolute left-5 top-[214px] w-[362px]">
          <div className="text-[#e3f754] text-[24px] leading-[30px] font-bold tracking-[-0.5px]">Link versendet!</div>
          <p className="mt-4 text-[#868786] text-[12px] leading-[18px] font-medium tracking-[-0.2px]">
            Wir haben dir einen Link zum Zurücksetzen deines Passworts an deine E-Mail-Adresse gesendet. Bitte
            überprüfe auch deinen Spam-Ordner.
          </p>

          <div className="mt-8 space-y-6">
            <button
              type="button"
              onClick={() => onSendResetLink?.()}
              disabled={!canResend}
              className={`w-full rounded-none py-4 text-[15px] font-bold transition-colors ${
                canResend
                  ? 'bg-[#e3f754] text-black hover:bg-[#d4ff28]'
                  : 'bg-[#646540] text-black/65 cursor-not-allowed'
              }`}
            >
              {resendButtonText}
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
          </div>

          <div className="mt-[70px]">
            <img src={RIDE_ARROW_RIGHT_URL} alt="" className="block w-full h-auto" />
          </div>
        </div>

        <TrisarFooter className="fixed bottom-0 left-1/2 -translate-x-1/2 w-[min(402px,100vw)] h-10 bg-black z-30" />
      </div>
    </div>
  );
};

export default LinkVersendetView;
