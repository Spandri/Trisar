const dividerSrc = '/icon/_Icon_Schwarz/nav-divider.svg';
const locationActiveSrc = '/icon/_Icon_Lime/Pin_Nav_Trisar_Icons_01_Lime.svg';
const locationInactiveSrc = '/icon/_Icon_Grau/Pin_Nav_Trisar_Icons_01_grau.svg';
const kiActiveSrc = '/icon/_Icon_Lime/KI_Trisar_Icons_01_Lime.svg';
const kiInactiveSrc = '/icon/_Icon_Grau/KI_Trisar_Icons_01_grau.svg';
const addCircleSrc = '/icon/_Icon_Schwarz/nav-add-circle.svg';
const homeActiveSrc = '/icon/_Icon_Lime/House_Nav_Trisar_01_Lime.svg';
const homeInactiveSrc = '/icon/_Icon_Grau/House_Nav_Trisar_01_grau.svg';
const fahrtenActiveSrc = '/icon/_Icon_Lime/Arrow_Nav_Trisar_Icons_01_Lime.svg';
const fahrtenInactiveSrc = '/icon/_Icon_Grau/Arrow_Nav_Trisar_Icons_01_grau.svg';

export default function Navibar({
  className,
  onNavigateToFahrten,
  onNavigateHome,
  onNavigateToAddFahrt,
  onNavigateToKi,
  onNavigateToMap,
  activeTab = 'home',
}) {
  const isHomeActive = activeTab === 'home';
  const isFahrtenActive = activeTab === 'fahrten';
  const isMapActive = activeTab === 'map';
  const isKiActive = activeTab === 'ki';
  const isAddActive = activeTab === 'add';

  return (
    <div className={className}>
      <div className="absolute bg-[#1e1e1e] inset-[1.28%_22.38%_1.28%_0] rounded-[39px]" />
      <div className="absolute bg-[#1e1e1e] inset-[1.28%_0_1.28%_78.45%] rounded-[39px]" />
      <div className="absolute bg-[#1e1e1e] inset-[10.26%_80.94%_10.26%_1.93%] opacity-10 rounded-[100px]" />
      <div className="absolute bg-[#1e1e1e] inset-[10.26%_62.15%_10.26%_20.99%] opacity-10 rounded-[100px]" />
      <div className="absolute bg-[#1e1e1e] inset-[10.26%_43.09%_10.26%_39.78%] opacity-10 rounded-[100px]" />
      <div className="absolute bg-[#e3f654] inset-[5.13%_1.1%_5.13%_79.56%] rounded-[100px]" />
      <div className="absolute bg-[#1e1e1e] inset-[10.26%_24.31%_10.26%_58.56%] opacity-10 rounded-[100px]" />

      {/* Vertikale Trennstriche zwischen Buttons */}
      <div className="absolute inset-[28.21%_80.11%_28.21%_19.89%]">
        <div className="absolute inset-[0_-0.25px]">
          <img src={dividerSrc} alt="" className="w-full h-full" />
        </div>
      </div>
      <div className="absolute inset-[28.21%_61.33%_28.21%_38.67%]">
        <div className="absolute inset-[0_-0.25px]">
          <img src={dividerSrc} alt="" className="w-full h-full" />
        </div>
      </div>
      <div className="absolute inset-[28.21%_41.99%_28.21%_58.01%]">
        <div className="absolute inset-[0_-0.25px]">
          <img src={dividerSrc} alt="" className="w-full h-full" />
        </div>
      </div>

      <button
        onClick={onNavigateToMap}
        className="absolute left-[39.78%] top-[8px] w-[18.78%] h-[64px] flex items-center justify-center cursor-pointer touch-manipulation"
        aria-label="Karte"
      >
        <img
          src={isMapActive ? locationActiveSrc : locationInactiveSrc}
          alt=""
          className={`w-[23px] h-[23px] transition-all duration-300 ease-out ${isMapActive ? 'scale-110' : 'scale-90'}`}
        />
      </button>
      
      <button
        onClick={onNavigateHome}
        className="absolute left-[1.93%] top-[8px] w-[17.96%] h-[64px] flex items-center justify-center cursor-pointer touch-manipulation"
        aria-label="Home"
      >
        <img
          src={isHomeActive ? homeActiveSrc : homeInactiveSrc}
          alt=""
          className={`w-6 h-6 transition-all duration-300 ease-out ${isHomeActive ? 'scale-110' : 'scale-90'}`}
        />
      </button>

      <button 
        onClick={onNavigateToFahrten}
        className="absolute left-[20.99%] top-[8px] w-[17.68%] h-[64px] flex items-center justify-center cursor-pointer touch-manipulation"
        aria-label="Alle Fahrten"
      >
        <img
          src={isFahrtenActive ? fahrtenActiveSrc : fahrtenInactiveSrc}
          alt=""
          className={`w-6 h-[23px] transition-all duration-300 ease-out ${isFahrtenActive ? 'scale-110' : 'scale-90'}`}
        />
      </button>
      
      <button
        onClick={onNavigateToKi}
        className="absolute left-[58.56%] top-[8px] w-[17.68%] h-[64px] flex items-center justify-center cursor-pointer touch-manipulation"
        aria-label="KI-Assistent"
      >
        <img
          src={isKiActive ? kiActiveSrc : kiInactiveSrc}
          alt=""
          className={`w-[23px] h-[23px] transition-all duration-300 ease-out ${isKiActive ? 'scale-110' : 'scale-90'}`}
        />
      </button>

      <button
        onClick={onNavigateToAddFahrt}
        className="absolute left-[79.56%] top-[4px] w-[19.34%] h-[70px] flex items-center justify-center cursor-pointer touch-manipulation"
        aria-label="Fahrt hinzufügen"
      >
        <img
          src={addCircleSrc}
          alt=""
          className={`size-6 transition-all duration-300 ease-out ${isAddActive ? 'scale-150' : 'scale-100'}`}
        />
      </button>
    </div>
  );
}
