import React, { useEffect, useState } from 'react';
import TrisarFooter from '../ui/TrisarFooter';
import BackCircleButton from '../ui/BackCircleButton';
import { useI18n } from '../../i18n';

const BASE_WIDTH = 402;
const BASE_HEIGHT = 875;
const PROFILE_LIGHTNING_ICON_URL = '/icon/_Icon_Lime/Blitz_Trisar_Icons_01_Lime.svg';
const PROFILE_ROW_ARROW_ICON_URL = '/icon/_Icon_Schwarz/Arrow_Trisar_Icons_01.svg';

const screenBg = {
  backgroundImage:
    'radial-gradient(ellipse 141.42% 102.21% at 0% 0%, #0048cf 0%, #00369b 11.415%, #002468 22.83%, #001b4e 28.537%, #001234 34.244%, #00091a 39.952%, #00050d 42.805%, #000000 45.659%, #000000 83.626%, #000000 100%)',
};

export default function ProfilKoordinatorView({ setView, currentCoordinatorName }) {
  const { t } = useI18n();
  const [scale, setScale] = useState(1);
  const displayName = (currentCoordinatorName || '').trim() || 'Samira Chengula';

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
    <>
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
          <BackCircleButton onClick={() => setView('list')} className="absolute left-[20px] top-[60px]" marker="profil-zurueck" />

          <div data-tutorial="profil-ansicht" className="absolute left-[20px] top-[272px] w-[384px] h-[44px]">
            {/* Der Name haengt mit seiner Unterkante ueber dem Datum: passt er nicht
                in eine Zeile, bricht der Nachname in eine zweite Zeile um und der
                Name waechst nach oben, statt rechts abgeschnitten zu werden. */}
            <div className="absolute left-0 bottom-[24px] w-[362px] text-[#E2F754] text-[48px] font-bold tracking-[-0.5px] leading-none break-words">
              {displayName}
            </div>
            <div className="absolute left-[1px] top-[21px] text-[#E3F654] opacity-50 text-[16px] font-medium leading-6 tracking-[0.5px] whitespace-nowrap">
              {t('sonstige.seit', { date: '20.01.25' })}
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
            <span className="block text-[#E3F654] opacity-50 text-[16px] font-medium leading-none tracking-[0.5px] -translate-y-[2px]">{t('sonstige.liter')}</span>
          </div>
          <img src={PROFILE_LIGHTNING_ICON_URL} alt="" className="absolute left-[169px] top-[341px] w-4 h-5 object-contain opacity-50" />
          <img src={PROFILE_LIGHTNING_ICON_URL} alt="" className="absolute left-[353px] top-[341px] w-4 h-5 object-contain opacity-50" />

          <div className="absolute left-[20px] top-[450px] w-[178px] h-[115px] border-2 border-[#E3F654]" />
          <div className="absolute left-[204px] top-[450px] w-[178px] h-[115px] border-2 border-[#E3F654]" />
          <div className="absolute left-[40px] top-[521px] flex items-end gap-2">
            <span className="block text-[#E3F654] text-[36px] font-medium leading-none tracking-[0.5px]">56</span>
            <span className="block text-[#E3F654] opacity-50 text-[16px] font-medium leading-none tracking-[0.5px] -translate-y-[2px]">{t('sonstige.fahrten')}</span>
          </div>
          <div className="absolute left-[224px] top-[521px] flex items-end gap-2">
            <span className="block text-[#E3F654] text-[36px] font-medium leading-none tracking-[0.5px]">51</span>
            <span className="block text-[#E3F654] opacity-50 text-[16px] font-medium leading-none tracking-[0.5px] -translate-y-[2px]">{t('sonstige.stunden')}</span>
          </div>
          <img src={PROFILE_LIGHTNING_ICON_URL} alt="" className="absolute left-[168px] top-[460.71px] w-4 h-5 object-contain opacity-50" />
          <img src={PROFILE_LIGHTNING_ICON_URL} alt="" className="absolute left-[353px] top-[462px] w-4 h-5 object-contain opacity-50" />

          <button
            type="button"
            onClick={() => setView('ansprechpartner')}
            data-tutorial="profil-ansprechpartner"
            className="absolute left-[21px] top-[589px] w-[360px] h-14 bg-[#E3F654] border-2 border-[#E3F654]"
          >
            <div className="absolute left-4 top-1/2 -translate-y-1/2 text-[#262626] text-[16px] font-medium leading-6 tracking-[0.5px]">{t('sonstige.ansprechpartner')}</div>
            <img src={PROFILE_ROW_ARROW_ICON_URL} alt="" className="absolute right-3 top-1/2 -translate-y-1/2 w-[34px] h-[19.92px] object-contain" />
          </button>

          <button
            type="button"
            onClick={() => setView('verlauf')}
            data-tutorial="profil-verlauf"
            className="absolute left-[21px] top-[657px] w-[360px] h-14 bg-[#E3F654] border-2 border-[#E3F654]"
          >
            <div className="absolute left-4 top-1/2 -translate-y-1/2 text-[#262626] text-[16px] font-medium leading-6 tracking-[0.5px]">{t('sonstige.verlauf')}</div>
            <img src={PROFILE_ROW_ARROW_ICON_URL} alt="" className="absolute right-3 top-1/2 -translate-y-1/2 w-[34px] h-[19.92px] object-contain" />
          </button>

          <button
            type="button"
            onClick={() => setView('settingsKoordinator')}
            data-tutorial="profil-einstellungen"
            className="absolute left-[21px] top-[737px] w-[360px] h-14 opacity-50 border-2 border-[#E3F654]"
          >
            <div className="absolute inset-0 flex items-center justify-center text-[#E3F654] text-[16px] font-medium leading-6 tracking-[0.5px]">
              {t('sonstige.einstellungen')}
            </div>
          </button>

        </div>
      </div>
    </div>
    {/* Footer fest am unteren Rand — ausserhalb des skalierten Inhalts, weil
        position: fixed sich sonst am transform-Elternteil ausrichten wuerde. */}
    <TrisarFooter className="fixed bottom-0 left-1/2 -translate-x-1/2 w-[min(402px,100vw)] h-10 bg-black z-[70]" />
    </>
  );
}
