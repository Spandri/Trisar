import React, { useEffect, useMemo, useState } from 'react';
import TrisarFooter from '../../../components/ui/TrisarFooter';
import { PROFILE_LIGHTNING_ICON_URL, PROFILE_ROW_ARROW_ICON_URL } from '../../../shared/ui/icons';
import { useI18n } from '../../../i18n';
import ZurueckKnopf from '../../../components/ui/ZurueckKnopf';
import { DEMO_MODE } from '../../../datenquelle';

// Kennzahlen sind bisher nur Demo-Werte, live steht ein Strich bis echte Werte kommen.
const statWert = (demoWert) => (DEMO_MODE ? demoWert : '–');

const BASE_WIDTH = 402;
const BASE_HEIGHT = 875;

const screenBg = {
  backgroundImage:
    "radial-gradient(141.42% 102.21% at 0% 0%, #313701 0%, #000000 46%, #000000 84%, #000000 100%)",
};

export default function ProfilFahrerView({ setView, currentDriverName }) {
  const { t } = useI18n();
  const [scale, setScale] = useState(1);
  const [viewportHeight, setViewportHeight] = useState(
    typeof window !== 'undefined' ? window.innerHeight : BASE_HEIGHT,
  );
  const displayName = (currentDriverName || '').trim() || (DEMO_MODE ? 'Horst Engel' : '');

  useEffect(() => {
    const updateScale = () => {
      const nextViewportHeight = window.innerHeight || BASE_HEIGHT;
      setViewportHeight(nextViewportHeight);
      setScale(Math.min(window.innerWidth / BASE_WIDTH, nextViewportHeight / BASE_HEIGHT, 1));
    };
    updateScale();
    window.addEventListener('resize', updateScale);
    return () => window.removeEventListener('resize', updateScale);
  }, []);

  const frameHeight = useMemo(() => {
    const safeScale = Math.max(scale, 0.01);
    return Math.max(BASE_HEIGHT, Math.ceil(viewportHeight / safeScale));
  }, [scale, viewportHeight]);

  return (
    <div
      className="min-h-dvh w-full bg-black overflow-y-auto overscroll-none flex justify-center"
      style={{
        WebkitTextSizeAdjust: 'none',
        textSizeAdjust: 'none',
        fontFamily: 'Space Grotesk, sans-serif',
      }}
    >
      <div className="relative shrink-0" style={{ width: `${BASE_WIDTH * scale}px`, height: `${frameHeight * scale}px` }}>
        <div
          className="absolute left-0 top-0 w-[402px] origin-top-left overflow-hidden"
          style={{ ...screenBg, transform: `scale(${scale})`, height: `${frameHeight}px` }}
        >
          <ZurueckKnopf onClick={() => setView('list')} marker="profil-zurueck" />

          <div className="absolute left-[20px] top-[272px] w-[384px] h-[44px]">
            <div className="absolute left-0 top-[-28px] text-[#E2F754] text-[48px] font-bold tracking-[-0.5px] leading-none whitespace-nowrap">
              {displayName}
            </div>
            {DEMO_MODE && (
              <div className="absolute left-[1px] top-[21px] text-[#E3F654] opacity-50 text-[16px] font-medium leading-6 tracking-[0.5px] whitespace-nowrap">
                {t('misc.memberSince', { date: '20.01.25' })}
              </div>
            )}
          </div>

          <div className="absolute left-[20px] top-[329px] w-[178px] h-[115px] border-2 border-[#E3F654]" />
          <div className="absolute left-[204px] top-[329px] w-[178px] h-[115px] border-2 border-[#E3F654]" />
          <div className="absolute left-[40px] top-[400px] flex items-end gap-2">
            <span className="block text-[#E3F654] text-[36px] font-medium leading-none tracking-[0.5px]">{statWert('5234')}</span>
            <span className="block text-[#E3F654] opacity-50 text-[16px] font-medium leading-none tracking-[0.5px] -translate-y-[2px]">km</span>
          </div>
          <div className="absolute left-[224px] top-[400px] flex items-end gap-2">
            <span className="block text-[#E3F654] text-[36px] font-medium leading-none tracking-[0.5px]">{statWert('634')}</span>
            <span className="block text-[#E3F654] opacity-50 text-[16px] font-medium leading-none tracking-[0.5px] -translate-y-[2px]">{t('misc.liters')}</span>
          </div>
          <img src={PROFILE_LIGHTNING_ICON_URL} alt="" className="absolute left-[169px] top-[341px] w-4 h-5 object-contain opacity-50" />
          <img src={PROFILE_LIGHTNING_ICON_URL} alt="" className="absolute left-[353px] top-[341px] w-4 h-5 object-contain opacity-50" />

          <div className="absolute left-[20px] top-[450px] w-[178px] h-[115px] border-2 border-[#E3F654]" />
          <div className="absolute left-[204px] top-[450px] w-[178px] h-[115px] border-2 border-[#E3F654]" />
          <div className="absolute left-[40px] top-[521px] flex items-end gap-2">
            <span className="block text-[#E3F654] text-[36px] font-medium leading-none tracking-[0.5px]">{statWert('56')}</span>
            <span className="block text-[#E3F654] opacity-50 text-[16px] font-medium leading-none tracking-[0.5px] -translate-y-[2px]">{t('misc.trips')}</span>
          </div>
          <div className="absolute left-[224px] top-[521px] flex items-end gap-2">
            <span className="block text-[#E3F654] text-[36px] font-medium leading-none tracking-[0.5px]">{statWert('51')}</span>
            <span className="block text-[#E3F654] opacity-50 text-[16px] font-medium leading-none tracking-[0.5px] -translate-y-[2px]">{t('misc.hoursUnit')}</span>
          </div>
          <img src={PROFILE_LIGHTNING_ICON_URL} alt="" className="absolute left-[168px] top-[460.71px] w-4 h-5 object-contain opacity-50" />
          <img src={PROFILE_LIGHTNING_ICON_URL} alt="" className="absolute left-[353px] top-[462px] w-4 h-5 object-contain opacity-50" />

          <button
            type="button"
            onClick={() => setView('ansprechpartner')}
            data-tutorial="profil-ansprechpartner"
            className="absolute left-[21px] top-[589px] w-[360px] h-14 bg-[#E3F654] outline outline-2 outline-offset-[-1px] outline-[#E3F654]"
          >
            <div className="absolute left-4 top-1/2 -translate-y-1/2 text-[#262626] text-[16px] font-medium leading-6 tracking-[0.5px]">{t('misc.contactPersons')}</div>
            <img src={PROFILE_ROW_ARROW_ICON_URL} alt="" className="absolute right-3 top-1/2 -translate-y-1/2 w-[34px] h-[19.92px] object-contain" />
          </button>

          <button
            type="button"
            onClick={() => setView('verlauf')}
            data-tutorial="profil-verlauf"
            className="absolute left-[21px] top-[657px] w-[360px] h-14 bg-[#E3F654] outline outline-2 outline-offset-[-1px] outline-[#E3F654]"
          >
            <div className="absolute left-4 top-1/2 -translate-y-1/2 text-[#262626] text-[16px] font-medium leading-6 tracking-[0.5px]">{t('misc.history')}</div>
            <img src={PROFILE_ROW_ARROW_ICON_URL} alt="" className="absolute right-3 top-1/2 -translate-y-1/2 w-[34px] h-[19.92px] object-contain" />
          </button>

          <button
            type="button"
            onClick={() => setView('settingsFahrer')}
            data-tutorial="profil-einstellungen"
            className="absolute left-[21px] top-[737px] w-[360px] h-14 opacity-50 outline outline-2 outline-offset-[-1px] outline-[#E3F654]"
          >
            <div className="absolute inset-0 flex items-center justify-center text-[#E3F654] text-[16px] font-medium leading-6 tracking-[0.5px]">
              {t('misc.settings')}
            </div>
          </button>

          <TrisarFooter className="absolute left-0 right-0 bottom-0 h-10 bg-black" />
        </div>
      </div>
    </div>
  );
}
