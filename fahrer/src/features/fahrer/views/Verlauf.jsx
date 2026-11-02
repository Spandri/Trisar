import React, { useEffect, useState } from 'react';
import TrisarFooter from '../../../components/ui/TrisarFooter';
import { useI18n } from '../../../i18n';
import ZurueckKnopf from '../../../components/ui/ZurueckKnopf';

const BASE_WIDTH = 402;
const CONTENT_SHIFT = 43;
const BASE_HEIGHT = 1481 + CONTENT_SHIFT;
const STATUS_ROW_HEIGHT = 48;
const FIRST_SHIFT_END_TOP = 488 + CONTENT_SHIFT;
const SECOND_SHIFT_START_TOP = 563 + CONTENT_SHIFT;
const SECOND_SHIFT_END_TOP = 1104 + CONTENT_SHIFT;
const THIRD_SHIFT_START_TOP = 1179 + CONTENT_SHIFT;
const FIRST_DIVIDER_TOP = FIRST_SHIFT_END_TOP + STATUS_ROW_HEIGHT + (SECOND_SHIFT_START_TOP - (FIRST_SHIFT_END_TOP + STATUS_ROW_HEIGHT)) / 2;
const SECOND_DIVIDER_TOP = SECOND_SHIFT_END_TOP + STATUS_ROW_HEIGHT + (THIRD_SHIFT_START_TOP - (SECOND_SHIFT_END_TOP + STATUS_ROW_HEIGHT)) / 2;

const screenBg = {
  backgroundImage:
    'radial-gradient(141.42% 102.21% at 0% 0%, #313701 0%, #000000 46%, #000000 84%, #000000 100%)',
};

const EntryCard = ({ top, dateLabel, names, multiLine = false }) => (
  <div className="absolute left-[20px] w-[362px]" style={{ top: `${top}px` }}>
    <div className={`w-full bg-white overflow-hidden flex flex-col justify-center ${multiLine ? 'h-28' : 'h-24'}`}>
      <div className="self-stretch flex-1 px-4 py-2.5 rounded inline-flex justify-start items-center gap-3">
        <div className="flex-1 min-h-8 inline-flex flex-col justify-center items-start gap-[5px]">
          <div className="self-stretch text-zinc-900/80 text-sm font-medium leading-4 tracking-wide">{dateLabel}</div>
          <div className={`self-stretch text-zinc-900 text-2xl font-bold tracking-wide ${multiLine ? 'leading-7' : 'leading-6'}`}>
            {names.map((name, idx) => (
              <React.Fragment key={`${dateLabel}-${name}-${idx}`}>
                {idx > 0 ? <br /> : null}
                {name}
              </React.Fragment>
            ))}
          </div>
        </div>
      </div>
    </div>
  </div>
);

const StatusRow = ({ top, label, color }) => (
  <div className="absolute left-[20px] w-[362px]" style={{ top: `${top}px` }}>
    <div className="w-full h-12 min-h-12 outline outline-1 outline-offset-[-1px] flex flex-col justify-center items-start overflow-hidden" style={{ outlineColor: color }}>
      <div className="self-stretch flex-1 px-4 py-2.5 rounded inline-flex justify-start items-center gap-3">
        <div className="flex-1 min-h-8 inline-flex flex-col justify-center items-start">
          <div className="self-stretch text-2xl font-bold leading-6 tracking-wide" style={{ color }}>
            {label}
          </div>
        </div>
      </div>
    </div>
  </div>
);

export default function Verlauf({ setView }) {
  const { t } = useI18n();
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const updateScale = () => {
      setScale(Math.min(window.innerWidth / BASE_WIDTH, 1));
    };
    updateScale();
    window.addEventListener('resize', updateScale);
    return () => window.removeEventListener('resize', updateScale);
  }, []);

  return (
    <>
    <div
      className="h-dvh w-full bg-black overflow-y-auto overscroll-none flex justify-center"
      style={{
        WebkitTextSizeAdjust: 'none',
        textSizeAdjust: 'none',
        fontFamily: 'Space Grotesk, sans-serif',
        touchAction: 'pan-y',
        WebkitOverflowScrolling: 'touch',
      }}
    >
      <div className="relative shrink-0" style={{ width: `${BASE_WIDTH * scale}px`, height: `${BASE_HEIGHT * scale}px` }}>
        <div
          className="absolute left-0 top-0 w-[402px] h-[1524px] origin-top-left overflow-hidden"
          style={{ ...screenBg, transform: `scale(${scale})` }}
        >
          <div className="absolute left-0 top-[218px] w-[402px] h-[1046px] bg-zinc-900 rounded-tl-xl rounded-tr-xl" />

          <ZurueckKnopf onClick={() => setView('profilFahrer')} marker="verlauf-zurueck" />

          <h1 className="absolute left-[20px] top-[140px] text-[#E3F654] text-[42px] leading-[42px] font-bold tracking-[-0.5px]">
            {t('misc.history')}
          </h1>

          <StatusRow top={199 + CONTENT_SHIFT} label={t('misc.shiftStart', { time: '15:30' })} color="#E3F654" />
          <EntryCard top={262 + CONTENT_SHIFT} dateLabel="22.01.2026     16:00 - 18:00" names={['Horst Engel']} />
          <EntryCard top={364 + CONTENT_SHIFT} dateLabel="22.01.2026     18:30 - 20:00" names={['Horst Engel', 'Marknus Müller']} multiLine />
          <StatusRow top={FIRST_SHIFT_END_TOP} label={t('misc.shiftEnd', { time: '20:30' })} color="#ff6f63" />

          <StatusRow top={SECOND_SHIFT_START_TOP} label={t('misc.shiftStart', { time: '17:30' })} color="#E3F654" />
          <EntryCard top={626 + CONTENT_SHIFT} dateLabel="21.01.2026     18:00 - 22:00" names={['Horst Engel', 'Marknus Müller']} multiLine />
          <EntryCard top={744 + CONTENT_SHIFT} dateLabel="21.01.2026     18:00 - 22:00" names={['Horst Engel', 'Marknus Müller']} multiLine />
          <EntryCard top={862 + CONTENT_SHIFT} dateLabel="21.01.2026     18:00 - 22:00" names={['Horst Engel', 'Marknus Müller']} multiLine />
          <EntryCard top={980 + CONTENT_SHIFT} dateLabel="21.01.2026     18:00 - 22:00" names={['Horst Engel', 'Marknus Müller']} multiLine />
          <StatusRow top={SECOND_SHIFT_END_TOP} label={t('misc.shiftEnd', { time: '22:30' })} color="#ff6f63" />

          <StatusRow top={THIRD_SHIFT_START_TOP} label={t('misc.shiftStart', { time: '17:30' })} color="#E3F654" />
          <EntryCard top={1242 + CONTENT_SHIFT} dateLabel="20.01.2026     18:00 - 20:00" names={['Horst Engel', 'Marknus Müller']} multiLine />
          <StatusRow top={1366 + CONTENT_SHIFT} label={t('misc.shiftEnd', { time: '22:30' })} color="#ff6f63" />

          <div className="absolute left-[112px] w-44 h-0 border-t border-[#E3F654]" style={{ top: `${FIRST_DIVIDER_TOP}px` }} />
          <div className="absolute left-[112px] w-44 h-0 border-t border-[#E3F654]" style={{ top: `${SECOND_DIVIDER_TOP}px` }} />

        </div>
      </div>
    </div>
    {/* Footer fest am unteren Rand — ausserhalb des skalierten Inhalts, weil
        position: fixed sich sonst am transform-Elternteil ausrichten wuerde. */}
    <TrisarFooter className="fixed bottom-0 left-1/2 -translate-x-1/2 w-[min(402px,100vw)] h-10 bg-black z-30" />
    </>
  );
}
