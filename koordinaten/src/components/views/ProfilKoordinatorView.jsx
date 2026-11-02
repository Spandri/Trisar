import React, { useEffect, useState } from 'react';
import TrisarFooter from '../ui/TrisarFooter';
import BackCircleButton from '../ui/BackCircleButton';

const BASE_WIDTH = 402;
const BASE_HEIGHT = 875;
const PROFILE_LIGHTNING_ICON_URL = '/icon/_Icon_Lime/Blitz_Trisar_Icons_01_Lime.svg';
const PROFILE_ROW_ARROW_ICON_URL = '/icon/_Icon_Schwarz/Arrow_Trisar_Icons_01.svg';

const screenBg = {
  backgroundImage:
    'radial-gradient(141.42% 102.21% at 0% 0%, #313701 0%, #000000 46%, #000000 84%, #000000 100%)',
};

export default function ProfilKoordinatorView({ setView, currentCoordinatorName }) {
  const [scale, setScale] = useState(1);
  const displayName = (currentCoordinatorName || '').trim() || 'Stefano';

  useEffect(() => {
    const updateScale = () => {
      setScale(Math.min(window.innerWidth / BASE_WIDTH, 1));
    };
    updateScale();
    window.addEventListener('resize', updateScale);
    return () => window.removeEventListener('resize', updateScale);
  }, []);

  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const previousStyles = {
      htmlOverflow: html.style.overflow,
      htmlOverscrollBehavior: html.style.overscrollBehavior,
      bodyOverflow: body.style.overflow,
      bodyOverscrollBehavior: body.style.overscrollBehavior,
      bodyTouchAction: body.style.touchAction,
    };

    html.style.overflow = 'hidden';
    html.style.overscrollBehavior = 'none';
    body.style.overflow = 'hidden';
    body.style.overscrollBehavior = 'none';
    body.style.touchAction = 'none';

    return () => {
      html.style.overflow = previousStyles.htmlOverflow;
      html.style.overscrollBehavior = previousStyles.htmlOverscrollBehavior;
      body.style.overflow = previousStyles.bodyOverflow;
      body.style.overscrollBehavior = previousStyles.bodyOverscrollBehavior;
      body.style.touchAction = previousStyles.bodyTouchAction;
    };
  }, []);

  return (
    <div
      className="fixed inset-0 bg-black overflow-hidden flex justify-center overscroll-none select-none"
      style={{
        WebkitTextSizeAdjust: 'none',
        textSizeAdjust: 'none',
        fontFamily: 'Space Grotesk, sans-serif',
        touchAction: 'none',
      }}
    >
      <div className="relative shrink-0" style={{ width: `${BASE_WIDTH * scale}px`, height: `${BASE_HEIGHT * scale}px` }}>
        <div
          className="absolute left-0 top-0 w-[402px] h-[875px] origin-top-left overflow-hidden"
          style={{ ...screenBg, transform: `scale(${scale})` }}
        >
          <BackCircleButton onClick={() => setView('list')} className="absolute left-[20px] top-[60px]" />

          <div className="absolute left-[20px] top-[272px] w-[384px] h-[44px]">
            <div className="absolute left-0 top-[-28px] text-[#E2F754] text-[48px] font-bold tracking-[-0.5px] leading-none whitespace-nowrap">
              {displayName}
            </div>
            <div className="absolute left-[1px] top-[21px] text-[#E3F654] opacity-50 text-[16px] font-medium leading-6 tracking-[0.5px] whitespace-nowrap">
              Seit 20.01.25
            </div>
          </div>

          <div className="absolute left-[20px] top-[329px] w-[178px] h-[115px] border-2 border-[#E3F654]" />
          <div className="absolute left-[204px] top-[329px] w-[178px] h-[115px] border-2 border-[#E3F654]" />
          <div className="absolute left-[40px] top-[400px] flex items-end gap-2">
            <span className="block text-[#E3F654] text-[36px] font-medium leading-none tracking-[0.5px]">5234</span>
            <span className="block text-[#E3F654] opacity-50 text-[16px] font-medium leading-none tracking-[0.5px] -translate-y-[2px]">km</span>
          </div>
          <div className="absolute left-[224px] top-[400px] flex items-end gap-2">
            <span className="block text-[#E3F654] text-[36px] font-medium leading-none tracking-[0.5px]">634</span>
            <span className="block text-[#E3F654] opacity-50 text-[16px] font-medium leading-none tracking-[0.5px] -translate-y-[2px]">Liter</span>
          </div>
          <img src={PROFILE_LIGHTNING_ICON_URL} alt="" className="absolute left-[169px] top-[341px] w-4 h-5 object-contain opacity-50" />
          <img src={PROFILE_LIGHTNING_ICON_URL} alt="" className="absolute left-[353px] top-[341px] w-4 h-5 object-contain opacity-50" />

          <div className="absolute left-[20px] top-[450px] w-[178px] h-[115px] border-2 border-[#E3F654]" />
          <div className="absolute left-[204px] top-[450px] w-[178px] h-[115px] border-2 border-[#E3F654]" />
          <div className="absolute left-[40px] top-[521px] flex items-end gap-2">
            <span className="block text-[#E3F654] text-[36px] font-medium leading-none tracking-[0.5px]">56</span>
            <span className="block text-[#E3F654] opacity-50 text-[16px] font-medium leading-none tracking-[0.5px] -translate-y-[2px]">Fahrten</span>
          </div>
          <div className="absolute left-[224px] top-[521px] flex items-end gap-2">
            <span className="block text-[#E3F654] text-[36px] font-medium leading-none tracking-[0.5px]">51</span>
            <span className="block text-[#E3F654] opacity-50 text-[16px] font-medium leading-none tracking-[0.5px] -translate-y-[2px]">Stunden</span>
          </div>
          <img src={PROFILE_LIGHTNING_ICON_URL} alt="" className="absolute left-[168px] top-[460.71px] w-4 h-5 object-contain opacity-50" />
          <img src={PROFILE_LIGHTNING_ICON_URL} alt="" className="absolute left-[353px] top-[462px] w-4 h-5 object-contain opacity-50" />

          <button
            type="button"
            onClick={() => setView('ansprechpartner')}
            className="absolute left-[21px] top-[589px] w-[360px] h-14 bg-[#E3F654] outline outline-2 outline-offset-[-1px] outline-[#E3F654]"
          >
            <div className="absolute left-4 top-1/2 -translate-y-1/2 text-[#262626] text-[16px] font-medium leading-6 tracking-[0.5px]">Ansprechpartner</div>
            <img src={PROFILE_ROW_ARROW_ICON_URL} alt="" className="absolute right-3 top-1/2 -translate-y-1/2 w-[34px] h-[19.92px] object-contain" />
          </button>

          <button
            type="button"
            onClick={() => setView('verlauf')}
            className="absolute left-[21px] top-[657px] w-[360px] h-14 bg-[#E3F654] outline outline-2 outline-offset-[-1px] outline-[#E3F654]"
          >
            <div className="absolute left-4 top-1/2 -translate-y-1/2 text-[#262626] text-[16px] font-medium leading-6 tracking-[0.5px]">Verlauf</div>
            <img src={PROFILE_ROW_ARROW_ICON_URL} alt="" className="absolute right-3 top-1/2 -translate-y-1/2 w-[34px] h-[19.92px] object-contain" />
          </button>

          <button
            type="button"
            onClick={() => setView('settingsKoordinator')}
            className="absolute left-[21px] top-[737px] w-[360px] h-14 opacity-50 outline outline-2 outline-offset-[-1px] outline-[#E3F654]"
          >
            <div className="absolute inset-0 flex items-center justify-center text-[#E3F654] text-[16px] font-medium leading-6 tracking-[0.5px]">
              Einstellungen
            </div>
          </button>

          <TrisarFooter className="absolute left-0 right-0 bottom-0 h-10 bg-black" />
        </div>
      </div>
    </div>
  );
}
