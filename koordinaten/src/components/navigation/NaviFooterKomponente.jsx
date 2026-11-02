import Navibar from './Navibar';
import TrisarFooter from '../ui/TrisarFooter';

export default function NaviFooterKomponente({
  className,
  onNavigateToFahrten,
  onNavigateHome,
  onNavigateToAddFahrt,
  onNavigateToKi,
  onNavigateToMap,
  activeTab = 'home',
}) {
  return (
    <>
      <div
        className={`fixed left-1/2 -translate-x-1/2 w-[min(402px,100vw)] h-[111px] z-40 pointer-events-none touch-none overscroll-none ${className || ''}`}
        style={{ bottom: '40px' }}
      >
        <div className="absolute inset-0 bg-black rounded-tl-[12px] rounded-tr-[12px]" />
        <Navibar
          className="absolute left-[20px] top-[12px] w-[362px] h-[78px] pointer-events-auto"
          onNavigateToFahrten={onNavigateToFahrten}
          onNavigateHome={onNavigateHome}
          onNavigateToAddFahrt={onNavigateToAddFahrt}
          onNavigateToKi={onNavigateToKi}
          onNavigateToMap={onNavigateToMap}
          activeTab={activeTab}
        />
      </div>
      <TrisarFooter
        className="fixed bottom-0 left-1/2 -translate-x-1/2 w-[min(402px,100vw)] h-10 bg-black z-30"
      />
    </>
  );
}
