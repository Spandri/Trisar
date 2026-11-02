import { useEffect, useMemo } from 'react';
import BackCircleButton from '../ui/BackCircleButton';
import TrisarFooter from '../ui/TrisarFooter';

const GREEN = '#E3F654';
const FIELD_START_TOP = 163;
const ROW_STEP = 68;
const GAP_AFTER_DATE = 24;
const DEFAULT_ROW_GAP = ROW_STEP - 56;
const EXTRA_PUSH_AFTER_DATE = GAP_AFTER_DATE - DEFAULT_ROW_GAP;
const GAP_BEFORE_SAVE = 24;
const EXTRA_PUSH_BEFORE_SAVE = GAP_BEFORE_SAVE - DEFAULT_ROW_GAP;
const TOGGLE_START_TOP = FIELD_START_TOP + ROW_STEP * 3 + EXTRA_PUSH_AFTER_DATE;
const BUTTON_TOP = FIELD_START_TOP + ROW_STEP * 8 + EXTRA_PUSH_AFTER_DATE + EXTRA_PUSH_BEFORE_SAVE;
const BUTTON_HEIGHT = 56;
const FOOTER_GAP = 30;
const FOOTER_HEIGHT = 40;
const CONTENT_OFFSET_TOP = 40;

function InputRow({ top, label, value, onChange, onReset, type = 'text' }) {
  const hasValue = String(value || '').trim().length > 0;

  return (
    <div
      className="absolute left-[21px] w-[362px] h-14 outline outline-2 outline-offset-[-1px] outline-[#E3F654] inline-flex justify-start items-center gap-1 overflow-hidden"
      style={{ top: `${top}px` }}
    >
      <div className="relative flex-1 self-stretch p-1 flex justify-start items-center">
        <div className="flex-1 self-stretch px-3 pr-10 flex justify-start items-center gap-4 min-w-0">
          <div className="shrink-0 opacity-50 text-[16px] font-medium leading-6 tracking-[0.5px]" style={{ color: GREEN, fontFamily: 'Space Grotesk' }}>
            {label}
          </div>
          <input
            type={type}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            className="w-full min-w-0 bg-transparent border-none outline-none text-[16px] font-medium leading-6 tracking-[0.5px]"
            style={{ color: GREEN, fontFamily: 'Space Grotesk' }}
            lang={type === 'date' ? 'de-DE' : undefined}
          />
        </div>
        {hasValue ? (
          <button
            type="button"
            onClick={onReset}
            className="absolute right-[12px] top-1/2 -translate-y-1/2 flex items-center justify-center"
            aria-label={`${label} zurücksetzen`}
          >
            <img src="/icon/_Icon_Green/clear-field-green.svg" alt="" className="w-5 h-5" />
          </button>
        ) : (
          <div className="absolute right-[12px] top-1/2 -translate-y-1/2 flex items-center justify-center pointer-events-none">
            <img src="/icon/_Icon_Lime/Arrow-kurz_Trisar_Icons_01_Lime.svg" alt="" className="w-[10px] h-[13px]" />
          </div>
        )}
      </div>
    </div>
  );
}

function ToggleRow({ top, label, active, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="absolute left-[21px] w-[362px] h-14 outline outline-2 outline-offset-[-1px] outline-[#E3F654] inline-flex justify-start items-center gap-1 overflow-hidden transition-colors"
      style={{ top: `${top}px`, backgroundColor: active ? '#E3F654' : 'transparent' }}
    >
      <div className="flex-1 self-stretch p-1 flex justify-start items-center">
        <div className="flex-1 self-stretch px-3 flex items-center gap-2.5 justify-center">
          <div
            className={`justify-center text-base font-medium font-['Space_Grotesk'] leading-6 tracking-wide ${active ? 'text-neutral-800 opacity-100' : 'text-[#E3F654] opacity-100'}`}
          >
            {label}
          </div>
        </div>
      </div>
    </button>
  );
}

export default function FahrtenFilter({ setView, filters = {}, onChangeFilters = () => {} }) {
  const {
    startQuery = '',
    zielQuery = '',
    date = '',
    withoutDriver = false,
    requireConfirmation = false,
    konvoi = false,
    withSpecial = false,
    includePast = false,
  } = filters;

  const gradientStyle = useMemo(
    () => ({
      background: 'radial-gradient(ellipse 141.42% 102.21% at 0.00% -0.00%, #313701 0%, black 46%, black 84%, black 100%)',
    }),
    [],
  );
  const footerTop = BUTTON_TOP + BUTTON_HEIGHT + FOOTER_GAP;
  const contentHeight = CONTENT_OFFSET_TOP + footerTop + FOOTER_HEIGHT;
  const updateFilter = (key, value) => onChangeFilters((prev) => ({ ...prev, [key]: value }));

  const handleBack = () => {
    if (window.history.length > 1) {
      window.history.back();
      return;
    }
    setView('ankuenfte');
  };

  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const root = document.getElementById('root');

    const prevHtmlOverflow = html.style.overflow;
    const prevHtmlOverscroll = html.style.overscrollBehavior;
    const prevBodyOverflow = body.style.overflow;
    const prevBodyOverscroll = body.style.overscrollBehavior;
    const prevRootOverflow = root ? root.style.overflow : '';
    const prevRootOverscroll = root ? root.style.overscrollBehavior : '';

    html.style.overflow = 'hidden';
    html.style.overscrollBehavior = 'none';
    body.style.overflow = 'hidden';
    body.style.overscrollBehavior = 'none';
    if (root) {
      root.style.overflow = 'hidden';
      root.style.overscrollBehavior = 'none';
    }

    return () => {
      html.style.overflow = prevHtmlOverflow;
      html.style.overscrollBehavior = prevHtmlOverscroll;
      body.style.overflow = prevBodyOverflow;
      body.style.overscrollBehavior = prevBodyOverscroll;
      if (root) {
        root.style.overflow = prevRootOverflow;
        root.style.overscrollBehavior = prevRootOverscroll;
      }
    };
  }, []);

  return (
    <div className="w-[min(402px,100vw)] h-dvh relative mx-auto overflow-hidden" style={gradientStyle}>
      <div className="h-full overflow-y-auto overscroll-none" style={{ touchAction: 'pan-y', WebkitOverflowScrolling: 'touch' }}>
        <div className="relative w-full" style={{ height: `${contentHeight}px` }}>
          <div className="absolute inset-x-0 top-10">
            <BackCircleButton onClick={handleBack} className="absolute left-[20px] top-[20px]" />

            <div className="absolute left-[20px] top-[97px] text-[#E3F654] text-[42px] leading-[42px] font-bold font-['Space_Grotesk']">
              Fahrten Filter
            </div>

            <InputRow
              top={FIELD_START_TOP}
              label="Start"
              value={startQuery}
              onChange={(value) => updateFilter('startQuery', value)}
              onReset={() => updateFilter('startQuery', '')}
            />
            <InputRow
              top={FIELD_START_TOP + ROW_STEP}
              label="Ziel"
              value={zielQuery}
              onChange={(value) => updateFilter('zielQuery', value)}
              onReset={() => updateFilter('zielQuery', '')}
            />
            <InputRow
              top={FIELD_START_TOP + ROW_STEP * 2}
              label="Datum"
              value={date}
              onChange={(value) => updateFilter('date', value)}
              onReset={() => updateFilter('date', '')}
              type="date"
            />

            <ToggleRow
              top={TOGGLE_START_TOP}
              label="ohne Fahrer*in"
              active={withoutDriver}
              onClick={() => updateFilter('withoutDriver', !withoutDriver)}
            />
            <ToggleRow
              top={TOGGLE_START_TOP + ROW_STEP}
              label="Fahrbestätigung"
              active={requireConfirmation}
              onClick={() => updateFilter('requireConfirmation', !requireConfirmation)}
            />
            <ToggleRow
              top={TOGGLE_START_TOP + ROW_STEP * 2}
              label="Konvoi"
              active={konvoi}
              onClick={() => updateFilter('konvoi', !konvoi)}
            />
            <ToggleRow
              top={TOGGLE_START_TOP + ROW_STEP * 3}
              label="mit Besonderheiten"
              active={withSpecial}
              onClick={() => updateFilter('withSpecial', !withSpecial)}
            />
            <ToggleRow
              top={TOGGLE_START_TOP + ROW_STEP * 4}
              label="auch vergangene"
              active={includePast}
              onClick={() => updateFilter('includePast', !includePast)}
            />

            <button
              type="button"
              onClick={handleBack}
              className="absolute left-[21px] w-[362px] h-14 bg-[#E3F654] outline outline-2 outline-offset-[-1px] outline-[#E3F654] inline-flex justify-start items-center gap-1 overflow-hidden"
              style={{ top: `${BUTTON_TOP}px` }}
            >
              <div className="flex-1 self-stretch p-1 flex justify-start items-center">
                <div className="flex-1 self-stretch px-3 flex justify-start items-center gap-2.5">
                  <div className="justify-center text-neutral-800 text-base font-medium font-['Space_Grotesk'] leading-6 tracking-wide">Filter Speicher</div>
                </div>
              </div>
              <div className="mr-4 flex items-center justify-center">
        <img src="/icon/_Icon_Schwarz/Arrow_Trisar_Icons_01.svg" alt="" className="w-[34px] h-[20px]" />
              </div>
            </button>

            <TrisarFooter className="absolute left-0 right-0 h-10 bg-black" style={{ top: `${footerTop}px` }} />
          </div>
        </div>
      </div>
    </div>
  );
}
