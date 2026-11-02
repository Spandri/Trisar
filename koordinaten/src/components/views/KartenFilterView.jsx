import { useEffect, useMemo, useRef, useState } from 'react';
import BackCircleButton from '../ui/BackCircleButton';
import TrisarFooter from '../ui/TrisarFooter';

const GREEN = '#E3F654';
const RED = '#ff6b6b';

function OutlineRow({ top, label, rightIcon = null, centered = false, h = 'h-14' }) {
  return (
    <div className={`absolute left-[20px] w-[362px] ${h} outline outline-2 outline-offset-[-1px] outline-[#E3F654] flex items-center px-3`} style={{ top: `${top}px` }}>
      <div className={`flex-1 text-base leading-6 tracking-[0.5px] text-[#E3F654] font-medium font-['Space_Grotesk'] ${centered ? 'text-center' : ''}`}>
        {label}
      </div>
      {rightIcon ? <div className="w-10 h-10 flex items-center justify-center">{rightIcon}</div> : null}
    </div>
  );
}

function ToggleRow({ top, label, active, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="absolute left-[20px] w-[362px] h-14 outline outline-2 outline-offset-[-1px] outline-[#E3F654] flex items-center px-3 transition-colors"
      style={{ top: `${top}px`, backgroundColor: active ? '#E3F654' : 'transparent' }}
    >
      <span className={`flex-1 text-base leading-6 tracking-[0.5px] font-medium font-['Space_Grotesk'] text-center ${active ? 'text-[#1d1c1d]' : 'text-[#E3F654]'}`}>
        {label}
      </span>
    </button>
  );
}

function InputRow({ top, label, rightIcon = null }) {
  return (
    <div
      className="absolute left-[20px] w-[362px] h-14 outline outline-2 outline-offset-[-1px] outline-[#E3F654] flex items-center px-3"
      style={{ top: `${top}px` }}
    >
      <div className="flex-1 text-base leading-6 tracking-[0.5px] text-[#E3F654]/60 font-medium font-['Space_Grotesk']">
        {label}
      </div>
      {rightIcon ? <div className="w-10 h-10 flex items-center justify-center">{rightIcon}</div> : null}
    </div>
  );
}

function SearchInputRow({ top, value, onChange, baseLabel, searchLabel }) {
  const [isFocused, setIsFocused] = useState(false);
  const showBase = isFocused || value.trim().length > 0;
  const hasValue = value.trim().length > 0;
  const inputRef = useRef(null);

  return (
    <div
      className="absolute left-[20px] w-[362px] h-14 outline outline-2 outline-offset-[-1px] outline-[#E3F654]"
      style={{ top: `${top}px` }}
      onClick={() => inputRef.current?.focus()}
    >
      <div className="relative w-full h-full flex items-center px-3">
        <span className="shrink-0 text-base leading-6 tracking-[0.5px] text-[#E3F654]/60 font-medium font-['Space_Grotesk']">
          {showBase ? baseLabel : searchLabel}
        </span>
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          className="flex-1 h-full ml-3 pr-9 py-0 bg-transparent outline-none border-none text-base leading-6 tracking-[0.5px] text-[#E3F654] font-medium font-['Space_Grotesk']"
        />
        <div className="absolute right-[12px] top-1/2 -translate-y-1/2 w-6 h-6 flex items-center justify-center">
          {hasValue ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onChange('');
                inputRef.current?.focus();
              }}
              className="flex items-center justify-center"
              aria-label={`${baseLabel} zurücksetzen`}
            >
              <img src="/icon/_Icon_Green/clear-field-green.svg" alt="" className="w-5 h-5" />
            </button>
          ) : (
            <div className="pointer-events-none">
              <img src="/icon/_Icon_Schwarz/karten-filter-search.svg" alt="" className="w-6 h-6" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function MinutePickerRow({ top, value, onChange, options }) {
  return (
    <div
      className="absolute left-[20px] w-[362px] h-14 outline outline-2 outline-offset-[-1px] outline-[#E3F654] flex items-center px-3"
      style={{ top: `${top}px` }}
    >
      <div className="relative flex-1 h-full">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full h-full bg-transparent outline-none border-none appearance-none text-transparent"
          aria-label="Feierabend in Minuten"
        >
          <option value="">---</option>
          {options.map((option) => (
            <option key={option} value={option} className="text-black">
              {option}
            </option>
          ))}
        </select>
        <div className="pointer-events-none absolute left-0 top-1/2 -translate-y-1/2 text-left text-base leading-6 tracking-[0.5px] font-medium font-['Space_Grotesk']">
          {value ? (
            <>
              <span className="text-[#E3F654]/60">Feierabend in </span>
              <span className="text-[#E3F654]">{value}</span>
            </>
          ) : (
            <span className="text-[#E3F654]/60">Feierabend in ... min</span>
          )}
        </div>
      </div>
      <div className="w-10 h-10 flex items-center justify-center">
        {value ? (
          <button type="button" onClick={() => onChange('')} className="flex items-center justify-center" aria-label="Feierabend zurücksetzen">
            <img src="/icon/_Icon_Green/clear-field-green.svg" alt="" className="w-5 h-5" />
          </button>
        ) : (
          <img src="/icon/_Icon_Green/clock-green.svg" alt="" className="w-5 h-5" />
        )}
      </div>
    </div>
  );
}

function TwoColButton({ left, top, label, active, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="absolute w-[176px] h-10 outline outline-2 outline-offset-[-1px] outline-[#E3F654] text-base font-medium font-['Space_Grotesk'] tracking-wide transition-colors"
      style={{ left, top, backgroundColor: active ? '#E3F654' : 'transparent', color: active ? '#1d1c1d' : '#E3F654' }}
    >
      {label}
    </button>
  );
}

const DEFAULT_KARTEN_FILTERS = {
  driverSearch: '',
  selectedDriverIds: [],
  afterWorkMinutes: '',
  vehicleLimosine: false,
  vehicleSuv: false,
  vehicleVan: false,
  vehicleCoupe: false,
};

export default function KartenFilterView({ setView, filters = {}, onChangeFilters = () => {} }) {
  const {
    driverSearch = '',
    afterWorkMinutes = '',
    vehicleLimosine = false,
    vehicleSuv = false,
    vehicleVan = false,
    vehicleCoupe = false,
  } = filters;

  const gradientStyle = useMemo(
    () => ({
      background: 'radial-gradient(ellipse 141.42% 102.21% at 0.00% -0.00%, #313701 0%, black 46%, black 84%, black 100%)',
    }),
    [],
  );

  const handleBack = () => {
    if (window.history.length > 1) {
      window.history.back();
      return;
    }
    setView('karten');
  };

  const updateFilter = (key, value) => {
    onChangeFilters((prev) => {
      const base = { ...(prev || DEFAULT_KARTEN_FILTERS), [key]: value };
      if (key === 'driverSearch' && String(value || '').trim() === '') {
        base.selectedDriverIds = [];
      }
      return base;
    });
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
      <div className="h-full overflow-y-auto overscroll-none pb-[70px]" style={{ touchAction: 'pan-y', WebkitOverflowScrolling: 'touch' }}>
        <div className="relative h-[834px]">
          <div className="absolute inset-x-0 top-[20px]">
            <BackCircleButton onClick={handleBack} className="absolute left-[20px] top-[40px]" />

            <h1 className="absolute left-[20px] top-[97px] text-[#E3F654] text-[42px] leading-[42px] font-bold font-['Space_Grotesk']">Karten Filter</h1>

            <SearchInputRow
              top={163}
              value={driverSearch}
              onChange={(value) => updateFilter('driverSearch', value)}
              baseLabel="Fahrer"
              searchLabel="Fahrer Suchen"
            />

            <TwoColButton left={20} top={243} label="Limosine" active={vehicleLimosine} onClick={() => updateFilter('vehicleLimosine', !vehicleLimosine)} />
            <TwoColButton left={206} top={243} label="SUV" active={vehicleSuv} onClick={() => updateFilter('vehicleSuv', !vehicleSuv)} />
            <TwoColButton left={20} top={295} label="VAN" active={vehicleVan} onClick={() => updateFilter('vehicleVan', !vehicleVan)} />
            <TwoColButton left={206} top={295} label="Coupe" active={vehicleCoupe} onClick={() => updateFilter('vehicleCoupe', !vehicleCoupe)} />

            <MinutePickerRow
              top={359}
              value={afterWorkMinutes}
              onChange={(value) => updateFilter('afterWorkMinutes', value)}
              options={['15 min', '30 min', '45 min', '60 min', '90 min', '120 min']}
            />

            <button
              type="button"
              onClick={() => setView('karten')}
              className="absolute left-[20px] top-[439px] w-[362px] h-14 bg-[#E3F654] outline outline-2 outline-offset-[-1px] outline-[#E3F654] flex items-center px-3"
            >
              <span className="flex-1 text-left text-[#1d1c1d] text-base font-medium font-['Space_Grotesk'] tracking-wide">Filter Speicher</span>
              <img src="/icon/_Icon_Schwarz/Arrow_Trisar_Icons_01.svg" alt="" className="w-[34px] h-[20px]" />
            </button>

            <button
              type="button"
              onClick={() => onChangeFilters({ ...DEFAULT_KARTEN_FILTERS })}
              className="absolute left-[20px] top-[507px] w-[362px] h-14 bg-[#ff6b6b] outline outline-2 outline-offset-[-1px] outline-[#ff6b6b] flex items-center px-3"
            >
              <span className="flex-1 text-left text-[#1d1c1d] text-base font-medium font-['Space_Grotesk'] tracking-wide">Filter Löschen</span>
              <img src="/icon/_Icon_Schwarz/Arrow_Nav_Trisar_Icons_01.svg" alt="" className="w-[34px] h-[20px]" />
            </button>
          </div>
        </div>
      </div>

      <TrisarFooter className="absolute bottom-0 left-0 right-0 h-10 bg-black" />
    </div>
  );
}
