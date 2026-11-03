import Navibar from './Navibar';
import TrisarFooter from '../ui/TrisarFooter';

export default function NaviFooterKomponente({
  className,
  onNavigateToFahrten,
  onNavigateHome,
  onNavigateToAddFahrt,
  onNavigateToKi,
  onNavigateToPlanung,
  onNavigateToMap,
  onNavigateToVehicles,
  onNavigateToProfile,
  activeTab = 'home',
}) {
  return (
    <>
      <div
        data-tutorial="navi-leiste"
        data-feste-leiste=""
        className={`fixed left-1/2 -translate-x-1/2 w-[min(402px,100vw)] h-[131px] z-[80] pointer-events-none touch-none overscroll-none ${className || ''}`}
        // 1 px tiefer als der Footer hoch ist: Leiste und Footer ueberlappen, sonst
        // blitzt im verkleinerten Demo-Rahmen eine Haarlinie der Inhalte durch.
        style={{ bottom: '39px' }}
      >
        {/* Ecken gerade: abgerundet schienen dort die weissen Karten durch.
            Oben laeuft der Hintergrund weich aus, statt die Karten mit harter
            Kante mitten im Text abzuschneiden. Ab der Leiste ist er ganz schwarz. */}
        <div className="absolute inset-0" style={{ background: 'linear-gradient(to bottom, rgba(0,0,0,0) 0, #000 32px)' }} />
        <Navibar
          className="absolute left-[20px] top-[32px] w-[362px] h-[78px] pointer-events-auto"
          onNavigateToFahrten={onNavigateToFahrten}
          onNavigateHome={onNavigateHome}
          onNavigateToAddFahrt={onNavigateToAddFahrt}
          onNavigateToKi={onNavigateToKi}
          onNavigateToPlanung={onNavigateToPlanung}
          onNavigateToMap={onNavigateToMap}
          onNavigateToVehicles={onNavigateToVehicles}
          onNavigateToProfile={onNavigateToProfile}
          activeTab={activeTab}
        />
      </div>
      <TrisarFooter
        className="fixed bottom-0 left-1/2 -translate-x-1/2 w-[min(402px,100vw)] h-10 bg-black z-[70]"
      />
    </>
  );
}
