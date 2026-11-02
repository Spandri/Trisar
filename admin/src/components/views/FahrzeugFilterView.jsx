import { useEffect, useMemo } from 'react';
import BackCircleButton from '../ui/BackCircleButton';
import TrisarFooter from '../ui/TrisarFooter';
import { useI18n } from '../../i18n';

// Fahrzeug-Filter im Stil des Karten-Filters (KartenFilterView), ohne
// Fahrersuche und "Feierabend in" — dafür mit Sortierung.

function TwoColButton({ left, top, label, active, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="absolute w-[175px] h-10 border-2 border-[#E3F654] text-base font-medium font-['Space_Grotesk'] tracking-wide transition-colors"
      style={{ left, top, backgroundColor: active ? '#E3F654' : 'transparent', color: active ? '#1d1c1d' : '#E3F654' }}
    >
      {label}
    </button>
  );
}

function SectionLabel({ top, label }) {
  return (
    <div
      className="absolute left-[20px] w-[362px] text-[#E3F654]/60 text-[13px] leading-4 tracking-[0.5px] font-medium font-['Space_Grotesk']"
      style={{ top: `${top}px` }}
    >
      {label}
    </div>
  );
}

// labelKey wird erst im Render mit t() aufgelöst (kein Hook auf Modulebene).
export const SORT_OPTIONS = [
  { key: 'plate', labelKey: 'filter.sortPlate' },
  { key: 'model', labelKey: 'filter.sortModel' },
  { key: 'fill', labelKey: 'filter.sortFill' },
  { key: 'seats', labelKey: 'filter.sortSeats' },
];

export const DEFAULT_FAHRZEUG_FILTERS = {
  search: '',
  vehicleLimosine: false,
  vehicleSuv: false,
  vehicleVan: false,
  vehicleCoupe: false,
  sortKey: 'plate',
  sortDesc: false,
};

export default function FahrzeugFilterView({ setView, filters = {}, onChangeFilters = () => {} }) {
  const { t } = useI18n();
  const {
    vehicleLimosine = false,
    vehicleSuv = false,
    vehicleVan = false,
    vehicleCoupe = false,
    sortKey = 'plate',
    sortDesc = false,
  } = filters;

  const gradientStyle = useMemo(
    () => ({
      background: 'radial-gradient(ellipse 141.42% 102.21% at 0% 0%, #0048cf 0%, #00369b 11.415%, #002468 22.83%, #001b4e 28.537%, #001234 34.244%, #00091a 39.952%, #00050d 42.805%, #000000 45.659%, #000000 83.626%, #000000 100%)',
    }),
    [],
  );

  const handleBack = () => {
    if (window.history.length > 1) {
      window.history.back();
      return;
    }
    setView('fahrzeugListe');
  };

  const updateFilter = (key, value) => {
    onChangeFilters((prev) => ({ ...(prev || DEFAULT_FAHRZEUG_FILTERS), [key]: value }));
  };

  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const root = document.getElementById('root');

    const prev = {
      htmlOverflow: html.style.overflow,
      htmlOverscroll: html.style.overscrollBehavior,
      bodyOverflow: body.style.overflow,
      bodyOverscroll: body.style.overscrollBehavior,
      rootOverflow: root ? root.style.overflow : '',
      rootOverscroll: root ? root.style.overscrollBehavior : '',
    };

    html.style.overflow = 'hidden';
    html.style.overscrollBehavior = 'none';
    body.style.overflow = 'hidden';
    body.style.overscrollBehavior = 'none';
    if (root) {
      root.style.overflow = 'hidden';
      root.style.overscrollBehavior = 'none';
    }

    return () => {
      html.style.overflow = prev.htmlOverflow;
      html.style.overscrollBehavior = prev.htmlOverscroll;
      body.style.overflow = prev.bodyOverflow;
      body.style.overscrollBehavior = prev.bodyOverscroll;
      if (root) {
        root.style.overflow = prev.rootOverflow;
        root.style.overscrollBehavior = prev.rootOverscroll;
      }
    };
  }, []);

  return (
    <div className="w-[min(402px,100vw)] h-dvh relative mx-auto overflow-hidden" style={gradientStyle}>
      <div className="h-full overflow-y-auto overscroll-none pb-[70px]" style={{ touchAction: 'pan-y', WebkitOverflowScrolling: 'touch' }}>
        <div className="relative h-[834px]">
          <div className="absolute inset-x-0 top-[20px]">
            <BackCircleButton onClick={handleBack} className="absolute left-[20px] top-[40px]" />

            <h1 className="absolute left-[20px] top-[120px] text-[#E3F654] text-[42px] leading-[42px] font-bold font-['Space_Grotesk']">{t('filter.vehicleFilterTitle')}</h1>

            <SectionLabel top={186} label={t('filter.bodyType')} />
            <TwoColButton left={20} top={210} label={t('filter.bodyLimosine')} active={vehicleLimosine} onClick={() => updateFilter('vehicleLimosine', !vehicleLimosine)} />
            <TwoColButton left={207} top={210} label={t('filter.bodySuv')} active={vehicleSuv} onClick={() => updateFilter('vehicleSuv', !vehicleSuv)} />
            <TwoColButton left={20} top={262} label={t('filter.bodyVan')} active={vehicleVan} onClick={() => updateFilter('vehicleVan', !vehicleVan)} />
            <TwoColButton left={207} top={262} label={t('filter.bodyCoupe')} active={vehicleCoupe} onClick={() => updateFilter('vehicleCoupe', !vehicleCoupe)} />

            <SectionLabel top={326} label={t('filter.sortBy')} />
            {SORT_OPTIONS.map((option, index) => (
              <TwoColButton
                key={option.key}
                left={index % 2 === 0 ? 20 : 207}
                top={350 + Math.floor(index / 2) * 52}
                label={t(option.labelKey)}
                active={sortKey === option.key}
                onClick={() => updateFilter('sortKey', option.key)}
              />
            ))}

            <TwoColButton left={20} top={466} label={t('filter.sortAZ')} active={!sortDesc} onClick={() => updateFilter('sortDesc', false)} />
            <TwoColButton left={207} top={466} label={t('filter.sortZA')} active={sortDesc} onClick={() => updateFilter('sortDesc', true)} />

            <button
              type="button"
              onClick={() => setView('fahrzeugListe')}
              className="absolute left-[20px] top-[530px] w-[362px] h-14 bg-[#E3F654] border-2 border-[#E3F654] flex items-center px-3"
            >
              <span className="flex-1 text-left text-[#1d1c1d] text-base font-medium font-['Space_Grotesk'] tracking-wide">{t('filter.saveFilter')}</span>
              <img src="/icon/_Icon_Schwarz/Arrow_Trisar_Icons_01.svg" alt="" className="w-[34px] h-[20px]" />
            </button>

            <button
              type="button"
              onClick={() => onChangeFilters({ ...DEFAULT_FAHRZEUG_FILTERS })}
              className="absolute left-[20px] top-[598px] w-[362px] h-14 bg-[#ff6b6b] border-2 border-[#ff6b6b] flex items-center px-3"
            >
              <span className="flex-1 text-left text-[#1d1c1d] text-base font-medium font-['Space_Grotesk'] tracking-wide">{t('filter.clearFilter')}</span>
              <img src="/icon/_Icon_Schwarz/Arrow_Nav_Trisar_Icons_01.svg" alt="" className="w-[34px] h-[20px]" />
            </button>
          </div>
        </div>
      </div>

      <TrisarFooter className="absolute bottom-0 left-0 right-0 h-10 bg-black" />
    </div>
  );
}
